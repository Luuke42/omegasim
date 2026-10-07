  // =========================================================================
  // BLE-Explorer: eigener Verbindungsweg, nur zum Erkunden
  // =========================================================================
  // Sucht Dienste und Merkmale eines Autos ab und zeigt den GATT-Baum. Er legt das
  // Auto in der Garage NICHT an und wird zum Fahren nicht gebraucht - genau deshalb
  // liegt er im Entwicklertab und nicht im Weg.

(() => {
  'use strict';

  // ---- Known / guessed BLE service UUIDs commonly used by BLE toys ----
  const GUESS_SERVICES = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style
    '0000fff0-0000-1000-8000-00805f9b34fb',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
    '0000fe59-0000-1000-8000-00805f9b34fb', // Nordic Secure DFU (legacy alias)
    '8ec90001-f315-4f60-9fb8-838830daea50', // Nordic Secure DFU
    'battery_service',
    'device_information',
    'generic_access',
    'generic_attribute',
  ];
  const customUuids = new Set();

  // CH (HYBRID-xxxxxxxxxxxx) GATT layout, identified via chrome://bluetooth-internals
  const KNOWN_UUIDS = {
    '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
    '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
    '00002a00-0000-1000-8000-00805f9b34fb': 'Device Name',
    '00002a01-0000-1000-8000-00805f9b34fb': 'Appearance',
    '00002a04-0000-1000-8000-00805f9b34fb': 'Preferred Connection Params',
    '00002aa6-0000-1000-8000-00805f9b34fb': 'Central Address Resolution',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e': 'Nordic UART Service, vermutlich Fahrzeugsteuerung',
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e': 'NUS RX, App → Auto (hier Kommandos schreiben)',
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e': 'NUS TX, Auto → App (Notify/Telemetrie)',
    '0000fe59-0000-1000-8000-00805f9b34fb': '⚠️ Nordic Secure DFU (Firmware-Update)',
    '8ec90001-f315-4f60-9fb8-838830daea50': '⚠️ Nordic Secure DFU Service',
    '8ec90003-f315-4f60-9fb8-838830daea50': '⚠️ DFU Bootloader-Trigger',
  };
  const DANGER_UUIDS = new Set([
    '0000fe59-0000-1000-8000-00805f9b34fb',
    '8ec90001-f315-4f60-9fb8-838830daea50',
    '8ec90002-f315-4f60-9fb8-838830daea50',
    '8ec90003-f315-4f60-9fb8-838830daea50',
  ]);

  let device = null, server = null;
  const charByUuid = new Map(); // uuid -> {char, service}

  const $ = (id) => document.getElementById(id);
  // Setzt nur, wenn das Element noch da ist.
  //
  // Das Cockpit zeigt seit dem Aufraeumen nur noch den Schirm; die vier Karten darunter
  // waren Doppelanzeigen desselben Zustands und sind entfernt. Ihre Kennungen werden aber
  // noch beschrieben - aus dem Fahrtakt heraus, alle 45 ms. Ein blinder Zugriff auf ein
  // fehlendes Element wuerde dort eine Ausnahme werfen und den Takt abbrechen, also
  // waehrend der Fahrt. Deshalb nicht siebzehn Mal `if (el)`, sondern zwei Setzer.
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const setSty = (id, k, v) => { const el = $(id); if (el) el.style[k] = v; };
  const logEl = $('log');
  // Hier stand ein Wrapper um #conn-dot, und in ihm ein ECHTER FEHLER:
  //
  //     const statusEl = { set textContent(v) { dot.title = String(v); ... } };
  //
  // #conn-dot gibt es im Dokument nicht mehr - der Punkt in der Kopfzeile ist beim
  // Verkleinern entfallen, und der Verbindungszustand steht heute in der Fusszeile des
  // Cockpits. dot war damit null, und der Setter fasste ihn ungeschuetzt an: jeder Aufruf
  // von setConnected() warf eine Ausnahme, also jedes Verbinden und Trennen ueber den
  // Erkundungsweg.
  //
  // Das Bemerkenswerte daran: der Kommentar in setConnected() warnt genau davor. Geschuetzt
  // waren dot und die zwei Knoepfe; uebersehen war, dass statusEl KEIN Element ist, sondern
  // ein Objektliteral. if (statusEl) ist immer wahr - es prueft den Wrapper und nicht das
  // Element, und sah dadurch aus wie ein Schutz.
  const servicesContainer = $('services-container');
  const controlSelect = $('control-char-select');

  // The 45ms heartbeat logs a line per write (~22/s) whether or not anything changed, so
  // this has to stay bounded — an unbounded log grew to tens of thousands of nodes within
  // minutes of driving and the resulting layout work stalled the main thread, which then
  // showed up as stuttering control.
  const LOG_MAX_LINES = 400;
  function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = 'l-' + cls;
    const t = new Date().toLocaleTimeString();
    line.textContent = `[${t}] ${msg}`;
    logEl.appendChild(line);
    while (logEl.childElementCount > LOG_MAX_LINES) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function bufToHex(buf) {
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }
  function bufToAscii(buf) {
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
  }
  function hexToBuf(hex) {
    const clean = hex.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16));
    return new Uint8Array(bytes);
  }

  // ---- Woran liegt es, wenn keine Autos auftauchen? ----------------------------------
  //
  // VIER FAELLE, und sie brauchen vier verschiedene Antworten. Bis v0.5.16 bekamen alle
  // dieselbe - "Web Bluetooth wird hier nicht unterstuetzt, bitte in Chrome/Edge oeffnen" -,
  // und auf einem Telefon, auf dem Chrome laeuft, schickt dieser Satz einen ans falsche
  // Ende.
  //
  // Der Fall, der wirklich vorkam: die App vom Host-Programm ueber das WLAN geladen. Web
  // Bluetooth verlangt einen SICHEREN KONTEXT, und http://192.168.x.x ist keiner - das
  // steht so im Kopf von tools/omegasim_host.py, nur eben nicht in der App. Ein Telefon
  // holt die App vom PC und hat kein navigator.bluetooth; das andere oeffnet sie ueber
  // https oder file:// und merkt nichts.
  //
  // 'aus' kann nur ASYNCHRON bestimmt werden (getAvailability liefert ein Versprechen),
  // deshalb gibt es die schnelle Fassung fuer die Anzeige und die genaue fuer den Klick.
  function bluetoothLage() {
    if (!window.isSecureContext) return 'unsicher';
    if (!navigator.bluetooth) return 'kein-api';
    return 'ok';
  }

  async function bluetoothLageGenau() {
    const l = bluetoothLage();
    if (l !== 'ok') return l;
    try {
      if (typeof navigator.bluetooth.getAvailability === 'function') {
        const da = await navigator.bluetooth.getAvailability();
        if (!da) return 'aus';
      }
    } catch (e) { /* manche Browser kennen die Abfrage nicht - dann eben nicht */ }
    return 'ok';
  }

  // Der Text zur Lage, einmal fuer Protokoll und Anzeige. Er nennt den URSPRUNG, denn
  // genau der ist im haeufigsten Fall die Ursache, und ohne ihn sucht man woanders.
  function bluetoothLageText(lage) {
    if (lage === 'unsicher') {
      return 'Bluetooth ist hier abgeschaltet, weil die Seite ueber einen unsicheren '
           + 'Ursprung geladen wurde (' + location.origin + '). Web Bluetooth erlaubt nur '
           + 'https://, http://localhost und file://. Wer die App vom Host-Programm im WLAN '
           + 'holt, hat genau diesen Fall: entweder die App direkt vom Telefon aus oeffnen '
           + '(GitHub Pages oder gespeicherte Datei), oder in chrome://flags den Eintrag '
           + '"unsafely-treat-insecure-origin-as-secure" um ' + location.origin + ' '
           + 'ergaenzen und Chrome neu starten.';
    }
    if (lage === 'kein-api') {
      return 'Dieser Browser kennt Web Bluetooth nicht. Chrome oder Edge auf Windows, '
           + 'Android oder ChromeOS - Safari und Firefox koennen es nicht.';
    }
    if (lage === 'aus') {
      return 'Der Bluetooth-Adapter ist aus oder nicht verfuegbar. Auf Android ausserdem '
           + 'pruefen, ob Chrome die Berechtigung "Geraete in der Naehe" hat.';
    }
    return '';
  }

  async function connect() {
    const lage = await bluetoothLageGenau();
    if (lage !== 'ok') {
      log(bluetoothLageText(lage), 'err');
      alert(bluetoothLageText(lage));
      return;
    }
    try {
      const optionalServices = [...GUESS_SERVICES, ...customUuids];
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'HYBRID' }],
        optionalServices,
      });
      log(`Gerät ausgewählt: ${device.name} (${device.id})`, 'info');
      device.addEventListener('gattserverdisconnected', onDisconnected);
      server = await device.gatt.connect();
      // Exactly one starter sound per successful connection. Fallback key updated to
      // match fx.json's real car keys (p992gt3r, not the old 'porsche') - see
      // tools/engine_fx.py, wo die Datei jetzt fuer alle Autos statt nur drei alte
      // Namen erzeugt wird.
      playFx(fxBuffers.start[$('sound-profile').value] || fxBuffers.start.p992gt3r, 0.85);
      log('GATT-Server verbunden.', 'info');
      await exploreServices();
    } catch (err) {
      log('Verbindungsfehler: ' + err.message, 'err');
      console.error(err);
    }
  }

  function onDisconnected() {
    log('Verbindung getrennt.', 'err');
  }

  async function disconnect() {
    if (device && device.gatt.connected) device.gatt.disconnect();
  }

  function propsToList(props) {
    const list = [];
    if (props.read) list.push('read');
    if (props.write) list.push('write');
    if (props.writeWithoutResponse) list.push('writeNoResp');
    if (props.notify) list.push('notify');
    if (props.indicate) list.push('indicate');
    if (props.broadcast) list.push('broadcast');
    return list;
  }

  async function exploreServices() {
    servicesContainer.innerHTML = '';
    charByUuid.clear();
    controlSelect.innerHTML = '<option value="">-- keine (nur Log) --</option>';

    let services;
    try {
      services = await server.getPrimaryServices();
    } catch (err) {
      log('Konnte Services nicht laden: ' + err.message, 'err');
      return;
    }

    if (services.length === 0) {
      servicesContainer.innerHTML = '<p class="muted">Keine Services gefunden (evtl. UUID-Whitelist erweitern).</p>';
    }

    for (const service of services) {
      const serviceDiv = document.createElement('div');
      serviceDiv.className = 'service';
      const head = document.createElement('div');
      head.className = 'head';
      const serviceLabel = KNOWN_UUIDS[service.uuid];
      head.innerHTML = `<span class="name">${serviceLabel ? serviceLabel : 'Service'}</span><span>${service.uuid}</span>`;
      serviceDiv.appendChild(head);

      let chars = [];
      try {
        chars = await service.getCharacteristics();
      } catch (err) {
        const errDiv = document.createElement('div');
        errDiv.className = 'char';
        errDiv.textContent = t('Fehler beim Laden der Characteristics: {m}').replace('{m}', err.message);
        serviceDiv.appendChild(errDiv);
      }

      for (const ch of chars) {
        charByUuid.set(ch.uuid, { char: ch, service });
        const props = propsToList(ch.properties);
        const isDanger = DANGER_UUIDS.has(ch.uuid);
        const charLabel = KNOWN_UUIDS[ch.uuid];
        const chDiv = document.createElement('div');
        chDiv.className = 'char';
        if (isDanger) chDiv.style.background = 'rgba(255,92,92,.08)';
        chDiv.innerHTML = `
          ${charLabel ? `<div style="font-weight:600;color:${isDanger ? 'var(--bad)' : 'var(--accent-2)'};margin-bottom:2px">${charLabel}</div>` : ''}
          <div class="uuid">${ch.uuid}</div>
          <div class="props">${props.map(p => `<span>${p}</span>`).join('')}</div>
          <div class="actions"></div>
          <div class="value" style="display:none"></div>
        `;
        const actions = chDiv.querySelector('.actions');
        const valueDiv = chDiv.querySelector('.value');

        if (props.includes('read')) {
          const btn = document.createElement('button');
          btn.textContent = 'Lesen';
          btn.onclick = async () => {
            try {
              const v = await ch.readValue();
              valueDiv.style.display = 'block';
              valueDiv.textContent = `hex: ${bufToHex(v.buffer)}  |  ascii: ${bufToAscii(v.buffer)}`;
              log(`READ ${ch.uuid}: ${bufToHex(v.buffer)}`, 'info');
            } catch (err) { log('Lesefehler: ' + err.message, 'err'); }
          };
          actions.appendChild(btn);
        }

        if (props.includes('write') || props.includes('writeNoResp')) {
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = 'Hex, z.B. 01 FF A0';
          input.style.width = '160px';
          const btn = document.createElement('button');
          btn.textContent = 'Senden';
          if (isDanger) btn.style.borderColor = 'var(--bad)';
          btn.onclick = async () => {
            if (isDanger && !confirm(
              '⚠️ Das ist der Nordic Secure DFU / Bootloader-Kanal für Firmware-Updates, nicht die Fahrzeugsteuerung.\n' +
              'Ein falscher Schreibzugriff kann das Auto in den Update-Modus versetzen oder die Firmware beschädigen.\n\n' +
              'Wirklich trotzdem schreiben?'
            )) return;
            try {
              const bytes = hexToBuf(input.value);
              if (props.includes('write')) await ch.writeValueWithResponse(bytes);
              else await ch.writeValueWithoutResponse(bytes);
              log(`WRITE ${ch.uuid}: ${bufToHex(bytes)}`, 'write');
            } catch (err) { log('Schreibfehler: ' + err.message, 'err'); }
          };
          actions.appendChild(input);
          actions.appendChild(btn);

          if (!isDanger) {
            const opt = document.createElement('option');
            opt.value = ch.uuid;
            opt.textContent = charLabel ? charLabel : `${service.uuid.slice(0, 8)}… / ${ch.uuid.slice(0, 8)}…`;
            controlSelect.appendChild(opt);
          }
        }

        if (props.includes('notify') || props.includes('indicate')) {
          const btn = document.createElement('button');
          btn.textContent = 'Notify abonnieren';
          btn.onclick = async () => {
            try {
              await ch.startNotifications();
              ch.addEventListener('characteristicvaluechanged', (e) => {
                const buf = e.target.value.buffer;
                valueDiv.style.display = 'block';
                valueDiv.textContent = `hex: ${bufToHex(buf)}  |  ascii: ${bufToAscii(buf)}`;
                log(`NOTIFY ${ch.uuid}: ${bufToHex(buf)}`, 'notify');
              });
              log(`Abonniert: ${ch.uuid}`, 'info');
              btn.disabled = true;
              btn.textContent = 'abonniert';
            } catch (err) { log('Notify-Fehler: ' + err.message, 'err'); }
          };
          actions.appendChild(btn);
        }

        serviceDiv.appendChild(chDiv);
      }

      servicesContainer.appendChild(serviceDiv);
    }

    const nusRx = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
    const nusTx = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
    if (charByUuid.has(nusRx)) {
      controlSelect.value = nusRx;
      log('Ziel-Characteristic für Steuerung automatisch auf NUS RX (6e400002) gesetzt.', 'info');
    }
    const labStatusEl = $('lab-status');
    if (labStatusEl) {
      labStatusEl.textContent = (charByUuid.has(nusRx) && charByUuid.has(nusTx))
        ? 'NUS RX/TX gefunden ✓'
        : 'NUS RX/TX nicht gefunden';
    }
    const vehicleNameEl = $('dash-vehicle-name');
    if (vehicleNameEl) vehicleNameEl.textContent = device?.name || '-';
    if (typeof ensureDashboardStatusSubscribed === 'function') ensureDashboardStatusSubscribed();
  }

  // ---- UUID input ----
  $('btn-add-uuid').onclick = () => {
    const v = $('custom-uuid').value.trim();
    if (!v) return;
    customUuids.add(v);
    log(`Custom-UUID hinzugefügt: ${v} (beim nächsten Verbinden aktiv)`, 'info');
    $('custom-uuid').value = '';
  };

  $('btn-clear-log').onclick = () => { logEl.innerHTML = ''; };
  // BESTELLT: "auto verbinden soll nur in garage tab moeglich sein" - der globale
  // Verbindungsknopf in der Kopfzeile ist damit ganz entfallen, nicht nur umgehaengt.
  // Verbunden wird jetzt ausschliesslich ueber #gar-connect in der Garage.
  $('dev-explore').onclick = connect;


  // Woerterbuch Deutsch -> Englisch. Schluessel ist der normalisierte deutsche Text
  // (Mehrfach-Leerzeichen zusammengefasst, getrimmt). Was hier fehlt, bleibt deutsch
  // stehen - das ist die Absicht, nicht ein Mangel: ein fehlender Eintrag faellt auf,
  // ein leerer Text nicht.
  const I18N_EN = {
    "Offen": "Open",
    "Vibration überhaupt": "Vibration at all",
    "Der Hauptschalter. Steht er aus, brummt nichts, egal was darunter angekreuzt ist. Seit v0.5.18 ist er standardmäßig an. Vorher stand er aus, und damit kamen auch die Vorgaben darunter nie zum Tragen – gemeldet wurde das als „Vibration geht nicht“. Wer keinen Rüttler hat, merkt von einem angeschalteten Hauptschalter nichts. Das Handy vibriert nicht mit, das Protokoll kennt dafür nichts.":
      "The master switch. With it off nothing rumbles, whatever is ticked below. Since v0.5.18 it is on by default. Before that it was off, so the defaults below never took effect either – which was reported as “vibration does not work”. If your controller has no rumble motor, an enabled master switch changes nothing. The phone does not vibrate along; the protocol has nothing for that.",
    "Rütteln testen":
      "Test the rumble",
    "Löst einen Stoß aus und schreibt daneben, was dabei vorgefunden wurde: wieviele Controller das System meldet, welche davon einen Rüttler haben, welche Zuordnung sie tragen und ob der Stoß angenommen oder abgelehnt wurde. Aus „geht nicht“ wird damit eine Messung.":
      "Fires one jolt and writes down beside it what it found: how many controllers the system reports, which of them have a rumble motor, what mapping they carry and whether the jolt was accepted or refused. That turns “does not work” into a measurement.",
    "Trigger-Vibration":
      "Trigger vibration",
    "Zusätzlich zu den Griffmotoren: regelt das ABS, brummt der linke Trigger – das ist die Bremse. Beim Schalten der rechte. Standard an. Warum experimentell: die adaptiven Trigger eines DualSense sind über die Gamepad-Schnittstelle gar nicht erreichbar, und die Effektart „trigger-rumble“ stellt Chrome vor allem für Xbox-Controller bereit. Die Zeile darunter liest aus, was dein Controller wirklich annimmt. Kann er es nicht, passiert nichts, und zwar ausdrücklich ohne ersatzweises Brummen in den Griffen – das würde vortäuschen, die Trigger hätten reagiert.":
      "On top of the grip motors: when the ABS is working the left trigger rumbles – that is the brake. When shifting, the right one. On by default. Why experimental: the adaptive triggers of a DualSense are not reachable through the gamepad interface at all, and Chrome offers the “trigger-rumble” effect type mainly for Xbox controllers. The line below reads out what your controller really accepts. If it cannot, nothing happens – deliberately with no substitute rumble in the grips, because that would pretend the triggers had responded.",
    "Was dein Controller kann":
      "What your controller can do",
    "Ausgelesen, nicht angenommen. Leer, solange kein Controller gemeldet ist – einmal eine Taste drücken.":
      "Read out, not assumed. Empty as long as no controller is reported – press a button once.",
    "Gangwechsel": "Gear change",
    "Aufprall": "Impact",
    "Neben der Bahn": "Off the track",
    "Meldungen": "Notifications",
    "Controller-Vibration": "Controller vibration",
    "Der Hauptschalter. Steht er aus, brummt nichts, egal was darunter angekreuzt ist. Standard aus, weil nicht jeder Controller einen Rüttler hat. Das Handy vibriert nicht mit, das Protokoll kennt dafür nichts.": "The master switch. With it off nothing rumbles, whatever is ticked below. Off by default, because not every controller has a rumble motor. The phone does not vibrate along, the protocol has nothing for that.",
    "Kurz und leicht bei jedem Schalten, beim Leerlauf und beim Rückwärtsgang. Sechs Gangwechsel in drei Sekunden mit einem langen Muster wären ein Presslufthammer in der Hand, deshalb 40 ms.": "Short and light on every shift, on neutral and on reverse. Six gear changes inside three seconds with a long pattern would be a pneumatic drill in the hand, hence 40 ms.",
    "Ein Puls alle 140 ms, solange das ABS regelt – das ist die Rückmeldung, an der man merkt, dass die Bremse an der Grenze arbeitet.": "A pulse every 140 ms while the ABS is working – that is the feedback that tells you the brake is at its limit.",
    "Der stärkste Stoß, und er hängt seit v0.5.15 an der WUCHT: gerechnet wird mit dem Tempo im Moment des Einschlags. Ein Einschlag bei Höchstgeschwindigkeit soll sich nicht anfühlen wie ein Anstupsen in der Boxengasse. Auch der schwächste Aufprall brummt jetzt kräftiger als bisher.": "The strongest jolt, and since v0.5.15 it depends on the FORCE of the impact: the speed at the moment of the hit is what counts. An impact at top speed should not feel like a nudge in the pit lane. Even the weakest impact now rumbles harder than before.",
    "Ein schwaches Dauerbrummen, solange das Auto neben der Bahn meldet – nach Schotter, nicht nach Aufprall. Standard aus: es ist ein ZUSTAND und kein Ereignis, und nach fünf Sekunden nervt es. Unabhängig von der Drosselung unter Allgemein.": "A faint continuous rumble while the car reports being off the track – like gravel, not like an impact. Off by default: it is a STATE and not an event, and after five seconds it grates. Independent of the throttle cap under General.",
    "Einfahrt, Beginn der Arbeit, fertig, und ein leiser Puls, solange man in der Gasse rollt.": "Entry, start of work, done, and a quiet pulse while rolling down the lane.",
    "Wetterwechsel und leerer Tank. Standard aus: das sind Nachrichten und keine Kräfte am Auto – wer sie will, bekommt sie hier.": "Weather changes and an empty tank. Off by default: these are messages and not forces at the car – if you want them, here they are.",
    "Meldet Byte 12 den Wert 0x00, ist das Auto neben der Bahn: dann wird das Gas auf 45 % gedeckelt. Das leichte Brummen dazu hängt allein am Schalter „Neben der Bahn“ unter Controller-Vibration, dieser hier allein an der Drosselung – bis v0.4.55 war es eine Option mit zwei Hälften, und wer die Drosselung abschaltete, verlor auch die Rückmeldung. Wirkt nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus ist der Streckensensor aus und Byte 12 stände dauernd auf 0x00.": "If byte 12 reports 0x00 the car is off the track: the throttle is then capped at 45 %. The faint rumble that goes with it hangs on the “Off the track” switch under Controller vibration alone, this one on the throttle cap alone – up to v0.4.55 it was one option with two halves, and turning off the cap also lost the feedback. Only works in the “On the track” setting: in printout mode the track sensor is off and byte 12 would sit at 0x00 permanently.",
    "Bremsarbeit heizt zwei Scheiben, vorn und hinten getrennt nach der Bremsbalance. Ab etwa 520 °C sinkt die Bremswirkung, bei 780 °C um höchstens 35 % – der Bremsweg wird dann wirklich länger. Eine einzelne Vollbremsung aus 250 km/h erreicht aus kalten Scheiben gemessen 241 °C vorn und fadet nicht; nach acht Bremsungen sind es 710 °C, das Fading liegt bei 16 % und der Bremsweg ist 9 % länger. Die alten Zahlen an dieser Stelle (183 °C und 806 °C) stammten aus einem Prüflauf, der eine Bremsung im Dauer-Schaltzustand maß – siehe v0.5.13.": "Braking heats two discs, front and rear separately according to the brake balance. From about 520 °C the braking effect drops, at 780 °C by at most 35 % – the braking distance then really does get longer. A single full stop from 250 km/h from cold discs measures 241 °C at the front and does not fade; after eight stops it is 710 °C, fading is 16 % and the braking distance 9 % longer. The old figures here (183 °C and 806 °C) came from a probe that measured a stop in a permanent shift state – see v0.5.13.",
    "Schaden ansagen": "Announce damage",
    "Einmal, wenn der Schadensbalken auf 10 % gefallen ist. Erst nach einer Reparatur wieder scharf.": "Once, when the damage bar has fallen to 10 %. Armed again only after a repair.",
    "Tank ansagen": "Announce fuel",
    "Einmal, wenn noch 10 % im Tank sind. Erst nach dem Tanken wieder scharf.": "Once, when 10 % of fuel is left. Armed again only after refuelling.",
    "Reifen ansagen": "Announce tyres",
    "Einmal, wenn der schlechteste der vier Reifen nur noch 10 % hat. Der schlechteste zählt: ein Auto mit drei guten Reifen und einem abgefahrenen fährt nicht drei Viertel gut.": "Once, when the worst of the four tyres is down to 10 %. The worst one counts: a car with three good tyres and one worn out does not drive three quarters well.",
    "Regen ansagen": "Announce rain",
    "Wenn es anfängt zu regnen und wenn es aufhört. Beim Laden wird nichts gesagt, erst beim Wechsel.": "When it starts raining and when it stops. Nothing is said on load, only on a change.",
    "Gaskennlinie": "Throttle curve",
    "Lenkkennlinie": "Steering curve",
    "Bremskennlinie": "Brake curve",
    "voll ab": "full from",
    "Eingang": "Input",
    "Wie der Stickweg auf den Lenkeinschlag abgebildet wird – dieselbe Formel wie Gas- und Bremskennlinie, mit Vorzeichen. Der Plot zeigt, was das Auto wirklich bekommt, samt Lenkansprechen und Lenkkalibrierung. Gestrichelt: dieselbe Verstärkung linear. Über 1,0 liegt die Kurve darunter: ein leicht angetippter Stick lenkt weniger ein als linear. Der rote Punkt zeigt deinen Stick live.":
      "How stick travel maps to steering lock – the same formula as the throttle and brake curves, with sign. The plot shows what the car really gets, including steering response and steering calibration. Dashed: the same gain, linear. Above 1.0 the curve lies below it: a lightly touched stick steers less than linear. The red dot shows your stick live.",
    "Wie der Bremsweg des Controllers auf die Bremskraft abgebildet wird, mit derselben Formel wie die Gaskennlinie. 1,0 ist die Gerade. Die Vorgabe 1,3 macht den Anfangsbereich etwas unempfindlicher: leichtes Antippen bremst sanft, voller Druck bleibt volle Bremse.":
      "How the controller’s brake travel maps to braking force, with the same formula as the throttle curve. 1.0 is the straight line. The default 1.3 makes the initial range a little less sensitive: a light touch brakes gently, full pressure stays full braking.",
    "Lenkkraft unter Gas": "Steering force under throttle",
    "Wie stark die Lastverlagerung beim Beschleunigen die Lenkung schwaecht. 0 % ist unveraendert (die Vorderachse entlastet sich normal), 100 % hebt die Abschwaechung unter Gas ganz auf - unabhaengig vom Bremsverhalten, das ruehrt dieser Regler nicht an.":
      "How much weight transfer under acceleration weakens the steering. 0% is unchanged (the front axle unloads normally), 100% cancels the weakening under throttle entirely - independent of braking behaviour, which this slider does not touch.",
    "Gewichtsverlagerung": "Weight transfer",
    "Wieviel Radlast beim vollen Bremsen oder Beschleunigen von einer Achse zur anderen wandert. Mehr fühlt sich nach einem schwereren Auto an - mehr Last auf der Vorderachse beim Bremsen, mehr auf der Hinterachse beim Gas.":
      "How much wheel load shifts from one axle to the other under full braking or acceleration. More feels like a heavier car - more load on the front axle under braking, more on the rear under throttle.",
    "Trägheit der Gewichtsverlagerung": "Weight transfer inertia",
    "Wie schnell die Karosserie beim Bremsen oder Gasgeben in die neue Radlast einschwingt. Kurz wirkt spritzig und direkt, lang wirkt schwer und träge - wie ein Auto, das erst noch merklich nach vorn oder hinten sackt.":
      "How quickly the body settles into the new wheel load under braking or throttle. Short feels sharp and direct, long feels heavy and sluggish - like a car that visibly dips forward or aft first.",
    "Anfahrschub": "Launch shove",
    "Wie der Gasweg des Controllers auf die Beschleunigung abgebildet wird. Die Enden liegen immer fest: kein Gas heißt keine Beschleunigung, Vollgas heißt volle Beschleunigung – geändert wird nur, was dazwischen passiert. 1,0 ist die Gerade und ändert nichts. Über 1,0 streckt den unteren Bereich: ein Viertel Gasweg gibt bei 1,8 nur noch 8 % statt 25 %. Genau das braucht ein Trigger mit großer Totzone – ein DualShock 4 oder DualSense gibt schon bei leichtem Druck viel ab, und dann lässt sich kein Tempo halten. Unter 1,0 macht es umgekehrt spitzer, für Pedale mit langem Weg.": "How the controller’s throttle travel maps to acceleration. The ends are always fixed: no throttle means no acceleration, full throttle means full acceleration – only what happens in between changes. 1.0 is the straight line and changes nothing. Above 1.0 stretches the lower range: a quarter of the travel gives only 8 % instead of 25 % at 1.8. That is exactly what a trigger with a large dead zone needs – a DualShock 4 or DualSense already gives away a lot under light pressure, and then no speed can be held. Below 1.0 does the opposite and makes it sharper, for pedals with long travel.",
    "Der Stößer, mit dem das Auto aus dem Stand losbricht. Ohne ihn bekommt es beim Anfahren ein Gasbyte, das zu klein ist, um es zu bewegen – es zuckt und steht. Mit ihm springt es dafür an: 16 % sind im Maßstab rund 47 km/h, und das ist der Sprung von null auf gefühlt 30, den man beim ersten Gasgeben spürt. Wieviel nötig ist, hängt am Untergrund: auf Teppich mehr als auf Laminat. Runter drehen, bis das Auto gerade noch sauber anfährt.": "The shove that breaks the car away from standstill. Without it the car gets a throttle byte too small to move it – it twitches and stays put. With it the car jumps instead: 16 % is about 47 km/h to scale, and that is the jump from zero to a felt 30 you notice on the first squeeze. How much is needed depends on the surface: more on carpet than on laminate. Turn it down until the car only just still pulls away cleanly.",
    "(fest)": "(fixed)",
    "(nicht real getestet).": "(not tested for real).",
    ") an, damit du live sehen kannst, was das Auto zurückmeldet, während du Kombinationen ausprobierst.": "): so you can watch live what the car reports back while you try combinations.",
    ") und zeigt gleichzeitig alle Notify-Werte von NUS TX (": ") and at the same time shows every notify value from NUS TX (",
    ", Skalierung": ", scaling",
    ", bevor die App es merkt:": ", before the app notices:",
    ", damit du siehst, welches welches ist.": ", so you can see which one is which.",
    ", dann": ", then",
    ", die rote die Zündrate bei der eingestellten Drehzahl. Liegen sie nah beieinander, dröhnt es.": ", the red one the firing rate at the selected engine speed. When they sit close together, it drones.",
    ", keine Messung: dass ein Auto die Linie einhält, kann die App nicht prüfen, weil kein Byte die Querlage meldet.": ", not a measurement: the app cannot check that a car holds the line, because no byte reports lateral position.",
    ", mit fließendem Übergang. Gebremst wird dort, wo die Krümmung": ", with a smooth transition. Braking happens where the curvature",
    ", nicht aus einem Filter: ein gleichmäßig zündender Reihensechser klingt anders als ein V8 mit Cross-Plane-Kurbelwelle, dessen beide Bänke ungleich zünden. Und die Resonanz ist keine Einstellung, sondern folgt aus der Rohrlänge:": ", not from a filter: an evenly firing straight six sounds different from a V8 with a cross-plane crank, whose two banks fire unevenly. And the resonance is not a setting but follows from the pipe length:",
    ", nicht nur ihr Urteil. Ein Test, der nur grün oder rot sagt, ist beim nächsten Grenzfall wertlos, weil man nicht sieht, wie knapp es war. Ein": ", not just its verdict. A test that only says green or red is worthless at the next borderline case, because you cannot see how close it was. A",
    ", wo der Browser das Laden von Dateien verbietet.": ", where the browser forbids loading files.",
    "-- Beispiel laden --": "-- load an example --",
    "-- abgelegte Motoren --": "-- stored engines --",
    "-- gespeicherte Fahrten --": "-- saved runs --",
    "-- gespeicherte Strecken --": "-- saved tracks --",
    "-- keine (nur Log) --": "-- none (log only) --",
    ". Das Auto fährt mit festem, langsamem Gas und hält jede Stufe": ". The car drives at a fixed, slow throttle and holds each step for",
    "100 % / „Tatsächliche Größe\"": "100 % / “Actual size”",
    "7. von der Bahn": "7. off the track",
    "90 Grad rechts drehen": "Rotate 90 degrees right",
    "90° rechts drehen": "Rotate 90° right",
    ": Start/Ziel, ein Streckenteil oder den Boxengassen-Ausdruck. Die Anzeige zählt, ob Byte 12 den Wert": ": start/finish, a track part or the pit-lane printout. The display counts whether byte 12 ever leaves the value",
    ": auf keinen Fall „an Seite anpassen\", sonst stimmen die Balkenabstände nicht mehr und der Sensor liest gar nichts. Der Pfeil zeigt in die Fahrtrichtung.": ": never “fit to page”, or the bar spacing is wrong and the sensor reads nothing at all. The arrow points in the direction of travel.",
    ": das Auto liest die Kodierung der Kunststoffschiene und hält sich selbst auf der Bahn.": ": the car reads the coding of the plastic rail and keeps itself on the track.",
    ": die Boxengasse liegt deshalb rechts. Ihre Breite ist": ": which is why the pit lane is on the right. Its width is",
    ": dieses Auto folgt Gamepad und Tastatur. Genau eines kann das sein; Standard ist das zuerst verbundene.": ": this car follows the gamepad and keyboard. Exactly one car can be it; the default is the first one connected.",
    ": dort siehst du": ": there you see",
    ": es liest gedruckte Muster, hält sich aber nicht selbst. Am 26.08. mit der Original-App gemessen: ein Ausdruck wird nur in der Stellung Aus erkannt. Beides zugleich gibt es nicht.": ": it reads printed patterns but does not keep itself on the track. Measured on 26 Aug with the original app: a printout is only recognised in the off position. There is no having both at once.",
    ": fährt beim Rennstart selbständig los und hält sich an der Strecke. Tank und Schaden werden für Ghosts nicht simuliert.": ": sets off by itself at the race start and follows the track. Fuel and damage are not simulated for ghosts.",
    ": für jedes Auto im Rennen": ": for every car in the race",
    ": keine Streckencodes, keine Rundenzeiten, kein Scan.": ": no track codes, no lap times, no scan.",
    ": nach dem Drucken einmal überfahren und unten mit der Muster-Sonde ablesen.": ": after printing, drive over it once and read it off below with the pattern probe.",
    ": und darunter siehst du, was das Auto daraus macht.": ": and below it you see what the car makes of it.",
    ": vor jedem Manöver den passenden Knopf drücken. Taste": ": press the matching button before each manoeuvre. Key",
    ": was tue ich, wenn ich auf Kachel 3 bin? Aus dem Rennmitschnitt der Original-App wissen wir, dass genau das reicht: bei einem ihrer Ghosts waren": ": what do I do when I am on tile 3? From the race capture of the original app we know that this is enough, for one of its ghosts,",
    "=Leerlauf, größer=Gas, kleiner=Bremse). Die Prüfsumme ist noch nicht geknackt, deshalb unten zuerst das": "= idle, larger = throttle, smaller = brake). The checksum is not cracked yet, which is why below you first take the",
    "Ablauf: Auto in der Garage verbinden, unten": "How to run it: connect a car in the Garage, then below on",
    "Ablegen speichert im Browser, bleibt also auf diesem Gerät. Zum Weitergeben der Text unten, kopieren, verschicken, einfügen,": "Store keeps it in the browser, so it stays on this device. To pass it on, use the text below: copy, send, paste,",
    "Ablegen": "Store",
    "Abschnitt markieren": "Mark a section",
    "Absichtlich leise, damit der Motor vorne bleibt.": "Deliberately quiet, so the engine stays in front.",
    "Achsen:": "Axes:",
    "Acht Probeblätter, um die Kodierung zu knacken": "Eight probe sheets, to crack the encoding",
    "Akku": "Battery",
    "Aktion": "Action",
    "Aktuelle Aufnahme speichern": "Save the current recording",
    "Aktuelle Runde": "Current lap",
    "Aktuelle Runde:": "Current lap:",
    "Aktuelle Werte hineinschreiben": "Write the current values in here",
    "Alle Rundenzeiten": "All lap times",
    "Alle trennen": "Disconnect all",
    "Alles loeschen": "Delete everything",
    "Alles löschen": "Delete everything",
    "Als CSV exportieren": "Export as CSV",
    "Als Profil übernehmen": "Adopt as a profile",
    "An ein echtes Auto senden": "Send to a real car",
    "An: Quadrat/X legt unter 10 km/h den Rückwärtsgang, Kreis/B holt ihn heraus. Aus: von Hand schalten, unter dem 1. Gang liegt der Leerlauf und darunter im Stand der Rückwärtsgang.": "On: square/X engages reverse below 10 km/h, circle/B takes it out again. Off: shift by hand, below 1st gear is neutral and below that, at a standstill, reverse.",
    "Anfahrt": "Rolling up",
    "Angezeigte km/h. Ein 911 GT3 R braucht rund 3,2 s.": "Displayed km/h. A 911 GT3 R needs about 3.2 s.",
    "Anhören": "Listen",
    "Ansauganteil": "Intake share",
    "Anteil": "Share",
    "Anzeigen wie auf einem echten GT3-HUD": "Readouts like a real GT3 dash",
    "Attacke": "Attack",
    "Auf Standard zurücksetzen": "Reset to defaults",
    "Standard wiederherstellen": "Restore defaults",
    "Spieler 1": "Player 1",
    "Spieler 2": "Player 2",
    "Spieler 3": "Player 3",
    "Raum anzeigen": "Show room",
    "Größe der Haupttabs": "Size of the main tabs",
    "FAHREN, CHALLENGES, WLAN MEHRSPIELER, OPTIONEN. 100 % ist die bisherige Größe.": "DRIVE, CHALLENGES, WIFI MULTIPLAYER, OPTIONS. 100 % is the previous size.",
    "Größe der Unter-Tabs": "Size of the sub-tabs",
    "Die zweite Leiste je Menü, z. B. Allgemein, Fahrgefühl, Ton in den Optionen. 100 % ist die bisherige Größe.": "The second bar of each menu, e.g. General, Driving feel, Sound in the options. 100 % is the previous size.",
    "Nur der Rammer bremst": "Only the rammer brakes",
    "Gilt, wenn „Bremsen bei Crash“ an ist: Gebremst wird nur, wer vorne einschlägt (der Auffahrende oder ein Auto an der Wand). Wer von hinten oder von der Seite getroffen wird, fährt weiter. Die Richtung kommt aus dem Bewegungssensor, mit 45° Toleranz.": "Applies when “Braking on crash” is on: only a car that hits with its front is braked (the one running into another, or a car hitting the wall). A car hit from behind or from the side keeps going. The direction comes from the motion sensor, with 45° tolerance.",
    "SEITLICH GETROFFEN": "HIT FROM THE SIDE",
    "Deine Zeit auf {s} konnte nicht hochgeladen werden: {g}. Sie ist gespeichert und wird automatisch erneut gesendet.": "Your time on {s} could not be uploaded: {g}. It is saved and will be sent again automatically.",
    "es läuft gerade ein Rennen": "a race is running right now",
    "der Server hat nicht richtig geantwortet": "the server did not answer properly",
    "keine Verbindung zum Server": "no connection to the server",
    "zu viele Uploads kurz hintereinander": "too many uploads in a row",
    "unbekannter Fehler": "unknown error",
    "Zeit nicht hochgeladen": "Time not uploaded",
    "Die Bestenliste hat deine Zeit auf {s} abgelehnt: {g}. Sie bleibt in deinen eigenen Zeiten.": "The leaderboard rejected your time on {s}: {g}. It stays in your own times.",
    "Zeit noch nicht hochgeladen": "Time not uploaded yet",
    "1 Zeit wartet auf den Upload": "1 time waiting to be uploaded",
    "{n} Zeiten warten auf den Upload": "{n} times waiting to be uploaded",
    "zuletzt": "last",
    "Ergebnis abgelehnt": "Result rejected",
    "Ergebnis noch nicht hochgeladen": "Result not uploaded yet",
    "wird automatisch erneut versucht.": "will be retried automatically.",
    "Nach dem Rennen": "After the race",
    "Jetzt senden": "Send now",
    "OK": "OK",
    "Zeit unplausibel": "implausible time",
    "Rundenzahl stimmt nicht": "wrong number of laps",
    "Runde unter der Mindestzeit": "a lap is below the minimum time",
    "Gesamtzeit passt nicht zu den Runden": "total time does not match the laps",
    "unbekannte Challenge": "unknown challenge",
    "beste Runde passt nicht zu den Runden": "best lap does not match the laps",
    "Rennen für alle beenden": "End race for everyone",
    "Rennen für alle beendet": "Race ended for everyone",
    "Ein Mitspieler ist im Ziel, laufende Runde zählt noch": "Another player has finished, the current lap still counts",
    "Erst mitmachen": "Join first",
    "Letzte Runde": "Last lap",
    "Die Abstimmung deines Autos. Den Motorsound wählst du je Auto in der Garage; jeder Klang kommt aus einer Motorsimulation.": "Your car's setup. You choose the engine sound per car in the garage; every sound comes from an engine simulation.",
    "Erste Wertung auf dieser Strecke": "First result on this track",
    "Neue Bestzeit!": "New personal best!",
    "auf deine Bestzeit": "off your personal best",
    "NPC Knockout braucht mindestens einen Ghost": "NPC Knockout needs at least one ghost",
    "NPC Knockout: Bahnmodus „Auf der Bahn“": "NPC Knockout: track mode “On the track”",
    "NPC Knockout": "NPC Knockout",
    "Gelbe Flagge deaktivieren": "Disable yellow flag",
    "An: Der Knopf „Gelbe Flagge“ und das Halten der Boxentaste rufen kein Gelb mehr aus.": "On: neither the “Yellow flag” button nor holding the pit key calls a yellow any more.",
    "Gelbe Flagge ist deaktiviert": "Yellow flag is disabled",
    "Statistiken": "Statistics",
    "Kilometer, Sitzungen, Fahrzeit, Rennen, Siege, Medaillen und das Ranking deiner Autos.": "Kilometres, sessions, driving time, races, wins, medals and the ranking of your cars.",
    "Noch keine Sitzung gespeichert. Jede beendete Fahrt zählt mit.": "No session saved yet. Every finished drive counts.",
    "Gefahren (simuliert)": "Driven (simulated)",
    "seit": "since",
    "Fahrzeit": "Driving time",
    "mit mehreren Autos": "with several cars",
    "Siege": "Wins",
    "Boxenstopps": "Pit stops",
    "Crashs": "Crashes",
    "Medaillen": "Medals",
    "Strecken gefahren": "Tracks driven",
    "gespeichert": "saved",
    "Sitzungen je Modus": "Sessions per mode",
    "Ranking: Kilometer je Auto": "Ranking: kilometres per car",
    "Gespeichert werden die letzten 200 Sitzungen; die Kilometer und Runden je Auto zählen ohne Grenze. Die Höchstgeschwindigkeit zeichnet die App nicht auf. Ghosts werden die Strecke des Fahrerautos gutgeschrieben.": "The last 200 sessions are kept; kilometres and laps per car count without limit. The app does not record top speed. Ghosts are credited with the driver car's distance.",
    "Alle Autos stehen schon": "All cars are already in place",
    "Meiste Runden in der Zeit.": "Most laps in the time.",
    "Schnellste Einzelrunde zählt.": "Fastest single lap counts.",
    "Wer zuerst die Rundenzahl hat.": "First to complete the laps wins.",
    "Automatisch aufstellen": "Line up automatically",
    "Die Ghosts fahren langsam auf ihre Startplätze und halten dort": "The ghosts drive slowly to their grid slots and stop there",
    "Erst eine Strecke laden": "Load a track first",
    "Autos fahren in die Startaufstellung": "Cars are driving to the grid",
    "Startaufstellung steht": "Grid is set",
    "Aufstellung abgebrochen: Startplatz nicht gefunden": "Line-up stopped: grid slot not found",
    "Frühstart: +5 s auf die erste Runde": "Jump start: +5 s on the first lap",
    "Wer vor Grün losfährt, bekommt 5 s auf seine erste Runde – auch Spieler 2 und 3 und im WLAN-Mehrspieler. Aus: das Auto wird nach Grün stattdessen 2 s lang ausgebremst.": "Whoever moves before green gets 5 s added to their first lap – players 2 and 3 too, and in WiFi multiplayer. Off: the car is braked for 2 s after green instead.",
    "Ein Wechsel ins Menü beendet das Rennen.": "Going to the menu ends the race.",
    "Rennen beenden": "End race",
    "Crash-Erkennung": "Crash detection",
    "Erkennt Stöße aus den Bewegungsbytes des Autos. Aus: kein Crash, kein Schaden, kein Bremsen.": "Detects impacts from the car's motion bytes. Off: no crash, no damage, no braking.",
    "Schaden bei Crash": "Damage on crash",
    "Jeder Crash kostet Zustand (Leistung, Licht). Ab Werk an, bei Arcade aus.": "Every crash costs condition (power, lights). On by default, off in Arcade.",
    "Bremsen bei Crash": "Braking on crash",
    "Ein Crash nimmt dem Auto sofort den Großteil seines Tempos.": "A crash instantly takes most of the car's speed.",
    "Strafe für Rammer": "Penalty for rammers",
    "Zwei Crashs verschiedener Autos im selben Moment sind ein Rammen (ein Auto gegen die Wand zählt nicht). Nach so vielen Rammstößen bekommt der Rammer eine Strafe: er steht beim nächsten Boxenstopp zusätzlich still. Wird sie nicht abgesessen, steht im Ergebnis [RAMMER].": "Two crashes of different cars at the same moment count as ramming (a car hitting the wall does not). After this many rams the rammer gets a penalty: an extra standstill at the next pit stop. If it is not served, the result shows [RAMMER].",
    "nach 1× Rammen": "after 1 ram",
    "nach 2× Rammen": "after 2 rams",
    "nach 3× Rammen": "after 3 rams",
    "nach 4× Rammen": "after 4 rams",
    "nach 5× Rammen": "after 5 rams",
    "Länge der Rammstrafe": "Length of the ramming penalty",
    "3 s": "3 s",
    "5 s": "5 s",
    "10 s": "10 s",
    "15 s": "15 s",
    "20 s": "20 s",
    "STRAFE": "PENALTY",
    "RAMMER": "RAMMER",
    "AUFFAHRUNFALL": "REAR-ENDED",
    "Health": "Health",
    "1 Spieler": "1 player",
    "{n} Spieler": "{n} players",
    "P{n} Boxenstopp: bremsen und anhalten – {a} km/h, nötig unter {b}, dann Finger vom Gas.": "P{n} pit stop: brake and stop – {a} km/h, needs below {b}, then lift off the throttle.",
    "Licht an": "Lights on",
    "Licht aus": "Lights off",
    "MEHRSPIELER-MODUS AN": "MULTIPLAYER MODE ON",
    "Alle löschen": "Delete all",
    "ohne Bedeutung": "no effect",
    "Rundenzahl: links/rechts einstellen": "Lap count: adjust with left/right",
    "Rundenzahl: Anwahl beendet": "Lap count: selection ended",
    "starten": "start",
    "abbrechen": "cancel",
    "wartet auf die erste Bewegung": "waiting for the first movement",
    "Keine gemerkten Autos.": "No remembered cars.",
    "Alle gemerkten Autos wirklich löschen?": "Really delete all remembered cars?",
    "Gemerkt werden nur Autos mit geändertem Namen oder gewählter Farbe. Der Browser erkennt ein Auto nicht immer wieder – dann einen Eintrag antippen und dem verbundenen Auto zuordnen. Mit × entfernen.":
      "Only cars with a changed name or a chosen colour are remembered. The browser does not always recognise a car again – then tap an entry and assign it to the connected car. Remove with ×.",
    "Zur Garage": "To the garage",
    "Zur Startseite": "To the home page",
    "Zum Cockpit →": "To the cockpit →",
    "Jedes Auto einzeln per Klick verbinden – Web Bluetooth verlangt das so.":
      "Connect each car individually with its own click – Web Bluetooth requires it.",
    "Der Browser darf diesen Speicher jederzeit leeren – diese Datei ist die Rückversicherung. Laden führt zusammen statt zu ersetzen: nichts Neueres geht verloren, auch eine ältere Sicherung lädt noch.":
      "The browser may clear this storage at any time – this file is the fallback. Loading merges instead of replacing: nothing newer is lost, and an older backup still loads.",
    "Auf den neuen Blättern steht ein 100-mm-Kontrollmaß. Nachmessen ist der einzige Weg, den Druckmaßstab zu prüfen, denn eine Druckvorschau sagt dazu nichts.": "The new sheets carry a 100 mm check measure. Measuring it is the only way to verify the print scale, because a print preview says nothing about it.",
    "Auf der Bahn": "On track",
    "Aufgeladen, dieses Modell hat keinen Lader.": "Turbocharged, this model has no turbo.",
    "Aufnahme starten": "Start recording",
    "Aufnahme": "Recording",
    "Aufnahme: nächsten Abschnitt markieren": "Recording: mark the next section",
    "Aus dem Cockpit hierher gezogen. Am Telefon wird geneigt oder ein Pad benutzt, am Rechner reichen die Pfeiltasten: aber ohne Pad und ohne Tastatur ist das hier die einzige Mausbedienung, deshalb ist sie nicht gelöscht.": "Moved here from the cockpit. On a phone you tilt or use a pad, on a computer the arrow keys are enough: but without a pad and without a keyboard this is the only mouse control, which is why it was not deleted.",
    "Aus": "Off",
    "Aus: fährt auch ohne gedruckte Strecke. An: nur mit gelesenem Muster.": "Off: drives even without a printed track. On: only with a pattern read.",
    "Aus: rohe Stickstellung, ohne Gänge.": "Off: raw stick position, no gears.",
    "Auslöse-Code (Byte 12)": "Trigger code (byte 12)",
    "Auspuffnachhall": "Exhaust reverb",
    "Ausrichtung:": "Orientation:",
    "Ausrollen (Faktor)": "Coasting (factor)",
    "Auto in der Garage an und wird zum Fahren nicht gebraucht.": "car in the Garage and is not needed for driving.",
    "Auto verbinden": "Connect a car",
    "Auto zurücksetzen": "Reset the car",
    "Auto": "Car",
    "Automatikgetriebe": "Automatic gearbox",
    "Automatischer Kalibrierungslauf": "Automatic calibration run",
    "Autonome Gegner": "Autonomous opponents",
    "Autonome Gegner, fein einstellbar": "Autonomous opponents, finely adjustable",
    "Autonomes Fahren: Aufnahme & Wiedergabe": "Autonomous driving: record & replay",
    "Außen anstellen, innen scheiteln, außen heraus. Ob es hilft, sagen Rundenzeit und Abgänge. Links = aus.": "Set up wide, apex tight, run out wide. Whether it helps is told by lap time and departures. Left = off.",
    "BLE-Explorer": "BLE explorer",
    "BLE-Explorer, Kalibrierung, Makros: die Werkbank unter der Oberfläche.": "BLE explorer, calibration, macros: the workbench under the surface.",
    "Bauart": "Layout",
    "Baue eine Strecke manuell aus Teilen zusammen, oder scanne sie live, während das Auto einmal die Runde fährt (Auto muss verbunden sein). Bekannte Teiltypen: Start/Ziel, Gerade, Rechtskurve (bestätigt aus echten Streckendaten). Linkskurve ist eine": "Build a track by hand from parts, or scan it live while the car drives one lap (a car must be connected). Known part types: start/finish, straight, right curve (confirmed from real track data). The left curve is an",
    "Bedienung mit Maus oder Finger. Das Gamepad ist hier ausgebaut: es griff vorher auf jedem Tab und auf jedes Bedienelement, und daraus kamen Fehlbedienungen. Es steuert jetzt nur noch das Auto, den Streckeneditor im Vollbild und das Boxenstopp-Menü.": "Operated with the mouse or a finger. The gamepad has been removed here: it used to act on every tab and every control, and that caused mis-operation. It now only drives the car, the track editor in fullscreen, and the pit-stop menu.",
    "Bei freiem Training ohne Bedeutung.": "Has no meaning in free practice.",
    "Beim Boxenstopp: Reparatur an/aus": "During a pit stop: repair on/off",
    "Beim Boxenstopp: Tanken an/aus": "During a pit stop: refuelling on/off",
    "Bekannt (aus einer unabhängigen Reverse-Engineering-Runde zum selben Auto, per BLE-Sniffer ermittelt): echte Kommando-Pakete sind": "Known (from an independent reverse-engineering effort on the same car, obtained with a BLE sniffer): real command packets are",
    "Bekanntes Idle-Paket laden (20 Byte)": "Load a known idle packet (20 bytes)",
    "Belegung": "Bindings",
    "Bereit": "Ready",
    "Beschleunigungsfaktor": "Acceleration factor",
    "Beste Zeit": "Best time",
    "Beste": "Best",
    "Blip (gerechnet)": "Blip (synthesised)",
    "Box": "Pit",
    "Boxengasse aktiv": "Pit lane active",
    "Boxengasse herunterladen (SVG)": "Download pit lane (SVG)",
    "Boxengasse": "Pit lane",
    "Boxengasse, Katalognummer 14": "Pit lane, catalogue number 14",
    "Boxenstopp auf Knopfdruck": "Pit stop at the touch of a button",
    "Boxenstopp": "Pit stop",
    "Boxenstopp an, erneut drücken bricht ab. Bei der Auslösung „doppelter Ausdruck“ löst die Taste nicht aus – dort zählt nur das zweimalige Überfahren.":
      "Pit stop on, press again to abort. With the trigger set to \"double print\" the key does not arm it – there only driving over the print twice counts.",
    "Boxer": "Flat",
    "Bremse": "Brake",
    "Bremse:": "Brake:",
    "Bremspunkte finden.": "Find your braking points.",
    "Bremswirkung": "Braking force",
    "Byte 12 jetzt": "Byte 12 now",
    "Byte 3 Spanne": "Byte 3 range",
    "Code von einem anderen Gerät einfügen": "Paste a code from another device",
    "Codeprobe": "Code probe",
    "Crash auslösen: Schaden, Geräusch und Rumble wie im Betrieb": "Trigger a crash: damage, sound and rumble just as in normal running",
    "Crash-Erkennung mit Vibration und Folgen fürs Handling": "Crash detection with rumble and lasting effects on handling",
    "Crashs, bis Fahrzeug ruckelt": "Crashes until the car judders",
    "Cross-Plane (ungleiche Bänke)": "Cross-plane (uneven banks)",
    "Dann gilt keine der beiden Regeln, und es braucht mehr als ein bekanntes Paar. Die acht Probeblätter darunter sind dafür gebaut.": "Then neither rule holds, and more than one known pair is needed. The eight probe sheets below are built for that.",
    "Das Frequenzbild des Rohrs. Die blaue Marke ist die Viertelwellenresonanz": "The frequency picture of the pipe. The blue mark is the quarter-wave resonance",
    "Das bekannte Muster beginnt in Fahrtrichtung mit vier dünnen Balken. Von einer Fassung ist berichtet, dass sie auch ohne drei davon erkannt wurde – der Vorlauf ist also kein Nutzdatum, sondern die Strecke, an der sich der Leser auf die schmale Modulbreite einstellt.": "In the driving direction, the known pattern begins with four thin bars. One version is reported to have been recognised without three of them, so the lead-in is not payload but the stretch over which the reader settles on the narrow module width.",
    "Das ist der ganze Trick: eine": "That is the whole trick: one",
    "Das vollständige Original, Kontrolle: muss wieder 0x03 ergeben.": "The complete original, the control: it must give 0x03 again.",
    "Das vollständige aktuelle Original, zeichengenau.": "The complete current original, exactly reproduced.",
    "Dauer": "Duration",
    "Der Code beschreibt die Reihenfolge der Teile und die Ausrichtung. Damit stellst du auf einem anderen Gerät dieselbe Strecke ein, ohne sie neu zu klicken.": "The code describes the order of the parts and the orientation. With it you set up the same track on another device without clicking it together again.",
    "Der Erstplatzierte fährt etwas langsamer.": "The leader drives a little slower.",
    "Der Klangcharakter kommt aus den": "The character of the sound comes from the",
    "Deshalb ändert jedes dieser Blätter genau einen Faktor gegen das bekannte Muster. Der Reihe nach überfahren, den gemeldeten Code notieren, und danach lässt sich die Regel bestimmen, dann auch ein höherer freier Code für die Boxengasse.": "So each of these sheets changes exactly one factor against the known pattern. Drive over them in order, note the reported code, and the rule can then be determined, and with it a higher free code for the pit lane.",
    "Diagramm gross": "Diagram, large",
    "Die Autos fahren in dieser Reihenfolge los. Die Einführungsrunde läuft mit Boxengassen-Tempo; sobald das erste Auto Start/Ziel überfährt, ist das Limit weg.": "The cars set off in this order. The formation lap runs at pit-lane pace; as soon as the first car crosses start/finish, the limit is gone.",
    "Die Controller-Belegung ist frei zuweisbar, Optionen → Controller. Hier steht, was gerade eingestellt ist.": "The controller bindings are freely assignable, Options → Controller. What is set right now is shown here.",
    "Die Ideallinie schickt einen Lenkanteil hinaus und nimmt an, dass das Auto dadurch weiter aussen oder innen sitzt.": "The racing line sends out a steering share and assumes the car therefore sits further out or further in.",
    "Die Rekonstruktion ist nachweislich eine treue Kopie des Original-PDF: Balkenzahl, Höhen auf 0,000 mm und Lücken auf 0,001 mm stimmen überein, und das PDF enthält nachgeprüft keine weiteren Formen. Das PDF ist die aktuelle Vorlage. Wenn also das Original gelesen wird und unser Ausdruck nicht, liegt der Unterschied im Druck und nicht in der Zeichnung: Maßstab, Strichbreite, Schwärze, Papier. Erst das 100-mm-Kontrollmaß nachmessen, dann einen dünnen und einen dicken Balken auf beiden Blättern vergleichen.": "The reconstruction is demonstrably a faithful copy of the original PDF: bar count, heights to 0.000 mm and gaps to 0.001 mm all agree, and the PDF has been checked to contain no further shapes. The PDF is the current master. So if the original is read and our printout is not, the difference lies in the printing and not in the drawing: scale, line width, blackness, paper. First measure the 100 mm check mark, then compare one thin and one thick bar on both sheets.",
    "Die nächste Messung: zwei Betriebsarten vergleichen.": "The next measurement: compare the two operating modes.",
    "Die acht oben sind aus Zylinderzahl, Kurbelwelle und Zündfolge gerechnet. Bei den aufgeladenen Originalen fehlt der Lader.": "The seven at the top are computed from cylinder count, crankshaft and firing order. On the turbocharged originals, the boost is missing.",
    "Die ältere DR!FT-Fassung, zeichengenau. Von ihr ist bekannt, dass sie gelesen wird.": "The older DR!FT version, exactly reproduced. It is known to be read.",
    "Diese fünf Blätter tragen dieselbe Nutzlast und verschieden lange Vorläufe. Melden alle denselben Code, ist der Vorlauf bestätigt kein Nutzdatum, und die kürzeste noch gelesene Fassung sagt, wieviel Anlauf gebraucht wird. Das verkürzt jedes weitere Muster.": "These five sheets carry the same payload with lead-ins of different lengths. If they all report the same code, the lead-in is confirmed not to be payload, and the shortest one still read says how much run-up is needed. That shortens every further pattern.",
    "Dieselbe Idee, eine Stufe größer. Ein autonomes Auto braucht keine Zeitkurve, sondern eine": "The same idea, one size up. An autonomous car does not need a curve over time but one",
    "Dieselben elf Größen, aus denen die mitgelieferten Motoren gerechnet sind, nur direkt zum Drehen. Das Modell läuft hier im Browser, also hörst du jede Änderung sofort, ohne dass eine Datei erzeugt werden muss.": "The same eleven quantities the bundled engines are computed from, only here you turn them directly. The model runs in the browser, so you hear every change at once, with no file to generate.",
    "Direktsteuerung mit der Maus": "Direct control with the mouse",
    "Doku": "Docs",
    "Drehen": "Rotate",
    "Drehzahl": "Revs",
    "Drei der sieben sind aufgeladen. Dieses Modell hat keinen Lader: Geometrie, Kurbelwelle und Zündfolge stimmen, der Ladedruck fehlt. Der Charakter der Bauart bleibt, das Pfeifen nicht.": "Three of the seven are turbocharged. This model has no turbo: geometry, crankshaft and firing order are right, the boost is missing. The character of the architecture remains, the whistle does not.",
    "F\u00fcnf fertige Abstimmungen. Sie setzen nur die Regler, die das": "Five ready-made setups. They only touch the sliders that affect the",

    // ---- v0.4: Voreinstellungen, Kacheln und die neuen Optionenseiten ----
    // Die Erklaertexte der fuenf Abstimmungen. Sie stehen im Skript (98-presets.js) und
    // werden von dort in die Legende gerendert, sind aber trotzdem Oberflaechentext -
    // deshalb gehoeren sie hierher wie jeder andere Satz auch.
    "Der ursprüngliche Sim-Modus": "The original sim mode",
    "Halb so weit zwischen Arcade und Realismus GT3": "Halfway between Arcade and Realism GT3",
    "An einem echten GT3 kalibriert": "Calibrated against a real GT3",
    "Von Hand schalten, 3,2 s auf 100 (die gemessene Reihe, gegen die die Physik gefittet ist), voller Reifenverschleiß und volles Tankgewicht. Wenig Grip, schwache Bremse, langes Ausrollen. Ein Fahrfehler kostet hier Zeit.":
      "Manual gearbox, 3.2 s to 100 (the measured series the physics was fitted against), full tyre wear and full fuel weight. Little grip, weak brakes, long coasting. A mistake costs time here.",
    "Von Hand schalten, 4,4 s auf 100, Reifenverschleiß und Tankgewicht wie GT3, aber mehr Grip und eine gutmütigere Bremse. Die Klasse darunter fährt sich nicht leichter, weil sie mehr verzeiht, sondern weil sie langsamer ist.":
      "Manual gearbox, 4.4 s to 100, tyre wear and fuel weight as GT3, but more grip and gentler brakes. The class below is not easier because it forgives more, but because it is slower.",
    "Das schärfste, was das Modell hergibt": "The sharpest the model has",

    // Die Kachelseite der Optionen
    "Einstellungen": "Settings",
    "\u2190 Einstellungen": "\u2190 Settings",
    "F\u00fcnf Bereiche. Was das Auto": "Five areas. What the car",
    "fährt": "drives",
    "hat": "has",
    ", unter Allgemein.": "is under General.",
    "Licht, Betriebsart, Akku, Tank, Schaden, Vibration.":
      "Lights, mode, battery, fuel, damage, vibration.",
    "Motorsound, Ambience, Lautst\u00e4rken \u2013 und die Motorwerkstatt.":
      "Engine sound, ambience, volumes \u2013 and the engine workshop.",
    "Ghosts: Tempo, Linie, Rennw\u00fcrze, Lernen. Teilweise noch im Aufbau.":
      "Ghosts: pace, line, race spice, learning. Partly still under construction.",
    "Erkennung, Tastenbelegung, eigene Zuordnung.":
      "Detection, key mapping, custom assignment.",

    // Der neue Schalter
    // Garagen-Abstimmung und die Ablage auf diesem Geraet
    "Abstimmung für das gesteuerte Auto – dieselben fünf wie in den Optionen, die Regler dort ziehen mit.":
      "Setup for the car you drive – the same five as in the options; the sliders there follow along.",
    "Oder auf diesem Gerät ablegen. Bleibt im Browser, wird nicht mitgeschickt.":
      "Or store it on this device. Stays in the browser, is not sent anywhere.",
    "Eigene Abstimmung: aktuelle Reglerwerte unter einem Namen ablegen, später wieder laden. Bleibt im Browser, wird nicht mitgeschickt.":
      "Custom setup: store the current slider values under a name, load them again later. Stays in the browser, is not sent anywhere.",
    "Name der Abstimmung": "Setup name",
    "– abgelegt –": "– stored –",
    "Vibration": "Vibration",
    "R\u00fcckmeldung im Controller bei Gangwechsel, ABS, Aufprall und im Boxenstopp. Das Handy vibriert nicht mit, das Protokoll kennt daf\u00fcr nichts.":
      "Controller feedback on gear changes, ABS, impacts and during a pit stop. The phone does not vibrate along; the protocol has nothing for it.",
    "Drei führende dünne Balken fehlen. Diese Fassung funktionierte.": "Three leading thin bars are missing. This version worked.",
    "Drosselt bei vollem Akku. Der Akkuwert ist eine unkalibrierte Schätzung.": "Throttles back on a full battery. The battery value is an uncalibrated estimate.",
    "Druckvorlagen": "Print templates",
    "Eckig: Vollgas, dann Vollbremse": "Square: full throttle, then full brake",
    "Eigener Verbindungsweg, nur zum Erkunden. Er legt": "A separate connection path, for exploring only. It places",
    "Eigenes Muster für die Box, mit dem Code, den es auslöst.": "Your own pattern for the pit, with the code it triggers.",
    "Ein Knopf, viele Messungen: lädt alles, rechnet die Physik richtig, passt die Linie, sind die Töne heil.": "One button, many measurements: does it all load, is the physics right, does the line fit, are the sounds intact.",
    "Ein Teil überfahren und ablesen, welchen Wert das Auto meldet.": "Drive over one part and read off the value the car reports.",
    "Ein Zündimpuls mit Nachhall": "One firing pulse with its tail",
    "Ein einzelner Druckimpuls, durch das Rohr geschickt und gesättigt. Seine Breite kommt vom Regler Impulslänge, sein Abklingen vom Regler Abfall, und die gekappten Spitzen sind die Sättigung. Grau der rohe Impuls, orange derselbe nach Rohr und Sättigung.": "A single pressure pulse, sent through the pipe and saturated. Its width comes from the pulse-length slider, its decay from the decay slider, and the clipped peaks are the saturation. Grey is the raw pulse, orange the same one after pipe and saturation.",
    "Eine Runde zählt, sobald das Auto das Start/Ziel-Muster auf der Strecke überfährt (dasselbe Signal, das auch der Streckenscanner ausliest): kein eigener Sensor in der App.": "A lap counts as soon as the car drives over the start/finish pattern on the track (the same signal the track scanner reads), there is no separate sensor in the app.",
    "Einen Code auszuwählen ist heute nicht möglich: ein Muster lässt sich zeichnen, aber welche Zahl das Auto dafür meldet, ist nicht vorhersagbar. Mit einem einzigen bekannten Paar ist die Regel auch nicht zu erschließen.": "Choosing a code is not possible today: a pattern can be drawn, but which number the car reports for it cannot be predicted. And with a single known pair the rule cannot be derived either.",
    "Einfach: Elektro": "Simple: electric",
    "Einfach: Turbo": "Simple: turbo",
    "Einführungsrunde mit Boxengassen-Tempo, frei beim ersten Überfahren von Start/Ziel.": "Formation lap at pit-lane pace, released the first time start/finish is crossed.",
    "Einmal senden": "Send once",
    "Endlosschleife": "Loop forever",
    "Entwickler": "Developer",
    "Ergebnis": "Result",
    "Ergebnis, alle verbundenen Autos": "Result, all connected cars",
    "Erlaubt beim Anbremsen mehr Lenkung. Nicht die Gewichtsverlagerung, sondern ihr Gegenstück in der Lenkgrenze.": "Allows more steering while braking. Not the weight transfer, but its counterpart in the steering limit.",
    "Erst simulieren, dann fahren. Der Knopf schickt die Kurven an ein verbundenes Auto und fährt sie einmal ab. Das ist bewusst ein": "Simulate first, then drive. The button sends the curves to a connected car and runs them once. That is deliberately one",
    "Es reproduziert die ältere DR!FT-Fassung zeichengenau, und von der ist berichtet, dass sie gelesen wird – auf beiden Fahrzeugfamilien. Damit ist es das eine Muster, bei dem ein Fehlschlag eindeutig ist: wird es nicht gelesen, kann es nicht am Muster liegen, sondern nur am Druck.": "It reproduces the older DR!FT version exactly, and that version is reported to be read on both car families. So it is the one pattern whose failure is unambiguous: if it is not read, the pattern cannot be the cause, only the printing.",
    "Fahr die Strecke einmal manuell (Tab \"Fahren\", Joystick/Gas oder Pfeiltasten). Während der Aufnahme werden Lenk- und Gaswerte mit Zeitstempel mitgeschrieben. Bei der Wiedergabe sendet die App exakt dieselbe Sequenz erneut an die Ziel-Characteristic.": "Drive the track once by hand (the \"Drive\" tab, joystick/throttle or arrow keys). During recording, steering and throttle values are written down with timestamps. On replay the app sends exactly the same sequence again to the target characteristic.",
    "Fahren, abstimmen, Rennen fahren. Im Browser, ohne Installation, mit deinem eigenen Streckenaufbau.": "Drive, tune, race. In the browser, with no installation, on your own track layout.",
    "Fahrgefühl": "Driving feel",
    "Fahrwerk": "Chassis",
    "Falls keine der drei Nummern trifft": "If none of the three numbers hits",
    "Fehler": "Mistakes",
    "Feinabstimmung, 1.0 = die eingestellte Zeit.": "Fine tuning, 1.0 = the time set above.",
    "Fliegender Start": "Rolling start",
    "Frei fahren": "Free roam",
    "Freies Training": "Free practice",
    "Freigeben": "Release",
    "Fährt das Auto über das Boxen-Muster, greift ein Tempolimit von 40 %. Bleibt es dann stehen, läuft der Service: je länger du stehst, desto mehr Sprit und Reparatur. Beim Losfahren ist das Limit wieder weg.": "When the car drives over the pit pattern, a 40 % speed limit takes effect. If it then stops, the service runs: the longer you stand, the more fuel and repair you get. Driving off lifts the limit again.",
    "Für zwei Scannerbetriebsarten gibt es Belege: Byte 14 Bit 5 heißt „Auf der Bahn“, Bit 7 heißt „Ohne Bahn“, und mit Bit 7 wurden 0 Lesungen in 551 Fahrmeldungen gezählt. Fahr dasselbe Blatt zweimal über: einmal mit dem Schalter Auf der Bahn an, einmal aus, und vergleich die Zeitleisten. Findet nur eine der beiden Betriebsarten das Muster, ist das die Antwort auf die Frage, ob gedruckte Codes auf der Bahn überhaupt gelesen werden.": "There is evidence for two scanner modes: byte 14 bit 5 means „on the track“, bit 7 means „off the track“, and with bit 7, 0 readings were counted in 551 drive reports. Drive the same sheet over twice: once with the on-the-track switch on, once off, and compare the timelines. If only one of the two modes finds the pattern, that answers the question whether printed codes are read on the track at all.",
    "GATT-Baum": "GATT tree",
    "Gamepad-Vibration": "Gamepad rumble",
    "Gas / Bremse": "Throttle / brake",
    "Gas und Bremse über die Zeit": "Throttle and brake over time",
    "Gas": "Throttle",
    "Gas/Bremse,": "throttle/brake,",
    "Gas:": "Throttle:",
    "Gegen die Referenz antreten.": "Race against the reference.",
    "Gegen gegenseitiges Rammen. Blind: kein Byte meldet die Querlage. Links = aus.": "Against cars ramming each other. Blind: no byte reports lateral position. Left = off.",
    "Gelbe Flagge": "Yellow flag",
    "Gerade": "Straight",
    "Geschlossen ✓": "Closed ✓",
    "Geschmeidig: aufbauen und ausrollen": "Smooth: build up and run out",
    "Geschwindigkeit": "Speed",
    "Gespeichert": "Saved",
    "Gespeicherte Fahrten": "Saved runs",
    "Gespeicherte Strecken": "Saved tracks",
    "Getriebe & Fahrleistung": "Gearbox & performance",
    "Ghost braucht Streckencode": "Ghost needs a track code",
    "Ghost-Tempo": "Ghost pace",
    "Ghost: Führenden bremsen": "Ghost: hold the leader back",
    "Ghost: Ideallinie": "Ghost: racing line",
    "Ghost: Kurvendrosselung": "Ghost: corner slowdown",
    "Ghost: Rennhärte": "Ghost: race hardness",
    "Ghost: Feld auffächern": "Ghost: spread the field",
    "Vergrößert die Abstände zwischen den Autos. 0% = wie bisher.": "Increases the distances between the cars. 0% = as before.",
    "Ghost: Überholmanöver je Runde": "Ghost: overtaking moves per lap",
    "Pro 4 Autos, wie viele Überholmanöver pro Runde. 0.5 = eines alle 2 Runden.": "Per 4 cars, how many overtaking moves per lap. 0.5 = one every 2 laps.",
    "Außen-Innen": "Outside-inside",
    "Ghost: Rückweg nach einem Abgang": "Ghost: recovery after leaving the track",
    "Statt sofort zu parken, versucht das Auto bis zu 3 Sekunden, selbst auf die Strecke zurückzufahren - anhand der zuletzt bekannten Stelle und der Ideallinie dort. Kommt es dabei nicht voran (vermutlich ein Hindernis), oder gelingt es in 3 Sekunden nicht, parkt es wie bisher. Es muss nicht an derselben Stelle wieder auffahren.":
      "Instead of parking right away, the car tries for up to 3 seconds to steer itself back onto the track - based on the last known spot and the racing line there. If it makes no progress (likely an obstacle), or doesn't succeed within 3 seconds, it parks as before. It doesn't have to rejoin at the same spot.",
    "Wie oft und wie schnell Ghosts einen Überholversuch starten. Weich: seltener, geduldiger, mehr Abstand - ein Feld, das sauber und leicht versetzt hintereinanderfährt. Hart: häufiger, schneller, eine kleinere Lücke reicht schon. 50% ist die bisherige, gemessene Abstimmung.":
      "How often and how quickly ghosts start an overtaking attempt. Soft: rarer, more patient, more space - a field that runs cleanly and slightly staggered, nose to tail. Hard: more often, quicker, a smaller gap is already enough. 50% is the previous, measured tuning.",
    "Verteidigen": "Defending",
    "Fahrercharakter": "Driver character",
    "Bisher sind alle Ghosts derselbe Fahrer: ein globaler Satz Regler für jeden. Mit dieser Einstellung würfelt jedes Auto zu Rennbeginn vier Faktoren in einer Spanne von ±25 % – Angriffslust, Verteidigung, Fehlerneigung und Kurvenabzug – und ein eigenes Boxenfenster von bis zu zwei Runden Versatz.":
      "Until now every ghost was the same driver: one global set of sliders for all of them. With this setting each car rolls four factors at the start of a race, within a range of ±25 % – attacking appetite, defending, mistake tendency and corner slowdown – plus a pit window of its own, offset by up to two laps.",
    "Es ist kein neues Verhalten, sondern das vorhandene unterschiedlich eingestellt. Das Tempo bleibt ausdrücklich draußen: dafür gibt es den Regler je Auto in der Garage. Angezeigt wird der Charakter dort ebenfalls, sobald das Rennen läuft.":
      "It is not new behaviour, just the existing behaviour set differently per car. Pace is deliberately left out: that is what the per-car slider in the garage is for. The character is shown there too, once the race is running.",
    "Startreaktion": "Start reaction",
    "Bisher lösen alle im selben Takt aus. Jetzt hat jedes Auto eine eigene Reaktionszeit zwischen 80 und 300 ms – die Spanne, die ein Mensch am Startknopf auch hat – und fährt die ersten 2,5 Sekunden mit 85 % Tempo, weil die erste Kurve die ist, in der sich ein Feld selbst aufräumt. Gemessen ist der Start ohnehin die dichteste Phase: 82 Berührungen je Minute in den ersten zehn Sekunden gegen 34 im Dauerbetrieb, und dabei 2 statt 24 Überholmanöver.":
      "Until now they all launched on the same tick. Now each car has its own reaction time between 80 and 300 ms – the range a human at the start button has too – and runs the first 2.5 seconds at 85 % pace, because the first corner is where a field either sorts itself out or does not. The start is the densest phase anyway, measured: 82 contacts per minute in the first ten seconds against 34 in steady running, with 2 overtakes instead of 24.",
    "Bisher gibt der Vorausfahrende immer nach. Mit dieser Einstellung deckt er die angegriffene Seite in der Hälfte der Fälle ab, statt zu weichen; der Angreifer wechselt dann einmal die Seite oder bricht ab. Nur EINMAL decken und kein Hin und Her – die Bahn ist 25 cm breit, zwei Autos brauchen 30 % davon, und Wedeln wäre auf dieser Breite ein Rammen mit Ansage.":
      "Until now the car ahead always gave way. With this setting it covers the attacked side in half the cases instead of yielding; the attacker then switches sides once or aborts. Covering happens ONCE, with no weaving – the track is 25 cm wide, two cars need 30 % of it, and weaving at that width would be ramming with advance notice.",
    "Nachgeben bleibt Pflicht unter gelber Flagge, in der Boxengasse und beim Überrundet-Werden. Das Fahrerauto verteidigt nie: es lässt sich nicht steuern, das entscheidest du selbst.":
      "Yielding stays mandatory under a yellow flag, in the pit lane and when being lapped. The driver's car never defends: it cannot be steered by the app – that is your call.",
    "Blaue Flagge": "Blue flag",
    "Wer eine ganze Runde zurück ist und einen Schnelleren im Nacken hat, geht von selbst nach außen und lupft leicht – statt sich fünf Sekunden zu wehren und danach sechs Sekunden gesperrt zu sein. Der Schnellere bekommt die Ideallinie, kein Vier-Phasen-Manöver nötig.":
      "A car a full lap down with a faster one behind moves aside by itself and lifts slightly – instead of fighting for five seconds and then being blocked for six. The faster car gets the racing line, no four-phase manoeuvre needed.",
    // ---- Die Kachel "2 Spieler" ------------------------------------------------------
    "Mehrspieler": "Multiplayer",
    "Mehrspieler-Modus (2–3 Spieler)": "Multiplayer mode (2–3 players)",
    "Auto 2": "Car 2",
    "Und ein Vergleichsschirm: blättere im Cockpit mit dem Pfeil oben links oder dem Steuerkreuz auf „Beide“. Dort stehen beide Autos":
      "And a comparison screen: page through the cockpit with the arrow at the top left or the D-pad to “Both”. It shows both cars",
    "– Tempo, Schaltlichter, Gang, Tank, Zustand, Reifen- und Bremsentemperatur und Akku, in beiden Spalten in derselben Reihenfolge, damit das Auge waagerecht springen kann. Dazu die Boxenknöpfe beider Autos und je ein eigener Motor-Knopf – Auto 2 darf einen anderen Motor fahren als Auto 1, muss aber nicht. Ist der Modus aus, wird der Schirm beim Blättern übersprungen.":
      "– speed, shift lights, gear, fuel, condition, tyre and brake temperature and battery, in the same order in both columns so the eye can move sideways. Plus the pit buttons of both cars and an engine-sound button each – car 2 may run a different engine than car 1, but does not have to. With the mode off, the screen is skipped while paging.",
    "Und ein Boxenstopp, unabhängig vom anderen Auto: während eines in der Box steht, verbraucht das andere weiter. Beide Knöpfe stehen auf dem Vergleichsschirm „Beide“, links für Auto 1 und rechts für Auto 2. Anfordern,":
      "And a pit stop, independent of the other car: while one is stopped, the other keeps burning fuel. Both buttons sit on the “Both” comparison screen, left for car 1 and right for car 2. Request,",
    ", warten, losfahren; nochmal drücken bricht ab. Der Service beginnt erst im Stillstand – das Auto rollt mit über 200 km/h aus, deshalb steht in der Fußzeile, wie weit es noch ist. Getankt wird mit denselben 22 %/s wie bei Auto 1 und repariert mit derselben Rate; ungleiche Raten wären schlimmer als kein Stopp.":
      ", wait, drive off; pressing again aborts. The service only starts at a standstill – the car coasts from over 200 km/h, so the footer says how far it still is. Refuelling runs at the same 22 %/s as car 1 and repairs at the same rate; unequal rates would be worse than no stop.",
    "Alle globalen Einstellungen gelten für beide Autos: die Abstimmung aus „Fahrgefühl“ wandert bei jeder Änderung sofort herüber, und Tank, Schaden, Reifenverschleiß, Wetter, die Höchstgeschwindigkeit und die Batteriekompensation wirken auf beide gleichermaßen. Zwei Autos mit verschiedener Abstimmung wären kein faires Rennen.":
      "All global settings apply to both cars: the setup from “Driving feel” carries over on every change, and fuel, damage, tyre wear, weather, the top-speed cap and the battery compensation affect both alike. Two cars with different setups would not be a fair race.",
    "bremsen und anhalten": "brake and stop",
    "Zwei oder drei Autos, je ein Controller, alle Drehzahlen im Cockpit. Im Aufbau.":
      "Two or three cars, one controller each, all rev counters in the cockpit. Work in progress.",
    "Der Modus": "The mode",
    "2-Spieler-Modus": "Two-player mode",
    "Gamepad-Menü-Steuerung": "Gamepad menu control",
    "Raum": "Room",
    "Größe und Form des Platzes für die Bahn, mit gespeicherten Räumen.": "Size and shape of the space for the track, with saved rooms.",
    "Der Platz, auf dem deine Bahn liegt: Größe, Form und Möbel. Zufallsstrecken aus dem Editor passen dann hinein. 0 heißt: keine Grenze.": "The space your track lies on: size, shape and furniture. Random tracks from the editor then fit into it. 0 means no limit.",
    "Gespeicherte Räume": "Saved rooms",
    "Name des Raums": "Room name",
    "Bitte einen Namen eingeben": "Please enter a name",
    "Erst eine Raumgröße eintragen": "Enter a room size first",
    "Raum gespeichert": "Room saved",
    "Raum geladen": "Room loaded",
    "Noch kein Raum gespeichert.": "No room saved yet.",
    "Raum löschen": "Delete room",
    "Raum löschen?": "Delete room?",
    "Bist du sicher?": "Are you sure?",
    "Der Raumgestalter": "The room designer",
    "Hier zeichnest du den Platz, auf dem deine Bahn liegt: Boden, auf dem sie stehen darf, und Möbel, die im Weg sind. Zufallsstrecken aus dem Editor passen dann hinein.": "Here you draw the space your track lies on: floor it may stand on, and furniture in the way. Random tracks from the editor then fit into it.",
    "Malen": "Paint",
    "Tippen oder ziehen malt. Am Gamepad bewegen Stick oder Steuerkreuz den Cursor, Kreuz (Leertaste) malt, gehalten weiter.": "Tap or drag to paint. On the gamepad, stick or d-pad move the cursor, Cross (space) paints, and keeps painting while held.",
    "Möbel oder Boden": "Furniture or floor",
    "Möbel sperrt Fläche, Boden gibt sie wieder frei. Quadrat (M) schaltet um.": "Furniture blocks area, floor frees it again. Square (M) toggles.",
    "Pinsel oder Rechteck": "Brush or rectangle",
    "Der Pinsel malt, solange du drückst. Beim Rechteck ziehst du von Ecke zu Ecke, am Gamepad Kreuz für die erste und Kreuz für die zweite Ecke. Dreieck (R) schaltet um.": "The brush paints while you press. For a rectangle you drag from corner to corner; on the gamepad, Cross for the first and Cross for the second corner. Triangle (R) toggles.",
    "Pinselgröße": "Brush size",
    "10, 30 oder 60 cm. L1 und R1 wechseln die Größe.": "10, 30 or 60 cm. L1 and R1 change the size.",
    "Vorlagen": "Templates",
    "Rechteck, L, U und Oval als schneller Anfang. Danach mit dem Pinsel anpassen.": "Rectangle, L, U and oval as a quick start. Then adjust with the brush.",
    "Select bzw. Share (Strg+Z) nimmt den letzten Strich zurück, auch mehrmals.": "Select or Share (Ctrl+Z) undoes the last stroke, also several times.",
    "Zeigt die Strecke aus dem Editor im Raum, gedreht und verschoben, so dass die ganze Bahn mit 2 cm Abstand hineinpasst.": "Shows the editor track in the room, rotated and shifted so the whole track fits with 2 cm clearance.",
    "Kreis oder Esc schließt. Unter Strecke, Raum speicherst du den Raum mit Namen und lädst ihn später wieder.": "Circle or Esc closes. Under Track, Room you save the room with a name and load it again later.",
    "Community-Bestzeiten: Jede Strecke hat jetzt eine eigene Seite wie die Wochenstrecken, geöffnet mit einem Tipp auf Bild oder Namen in der Liste: große Karte (Tipp für Vollbild), Spiegeln, Länge, Platzbedarf und Abstimmung, Teileprüfung, Medaillen, Start und die Bestenliste mit allen Zeiten. Zurück (oder Kreis) führt in die Liste. Die Liste bleibt nicht mehr bei „Lade …“ stehen. Auf luuke42.github.io/omegasim führt der APK-Link immer zum Release, damit jeder Download gezählt wird.": "Community best times: every track now has its own page like the weekly tracks, opened by tapping its picture or name in the list: large map (tap for full screen), mirroring, length, footprint and setup, parts check, medals, start and the leaderboard with all times. Back (or circle) returns to the list. The list no longer gets stuck on “Loading …”. On luuke42.github.io/omegasim the APK link always goes to the release, so every download is counted.",
    "Töne nach echten Aufnahmen nachgestimmt (gerechnet, keine Aufnahme in der App): Reifenquietschen höher (um 800 Hz statt 620) und mit zitternder Tonhöhe wie haftendes und rutschendes Gummi; Schalten mit rauschendem Metall-Klacken statt Ton; Abblasventil länger (0,6 s) und mit langsamem Flattern; Auspuffknaller tiefer und voller; Laderpfeifen endet bei 5,8 kHz statt 7. Neu unter den Motorton-Zusätzen (experimentell): Abrollgeräusch, Reifen und Fahrtwind werden mit dem Tempo lauter und heller.": "Sounds retuned against real recordings (still synthesised, no recording in the app): tyre squeal higher (around 800 Hz instead of 620) with a jittering pitch like rubber gripping and slipping; gearshift with a noisy metal clack instead of a tone; blow-off valve longer (0.6 s) with a slow flutter; exhaust pops lower and fuller; turbo whistle tops out at 5.8 kHz instead of 7. New among the engine sound extras (experimental): rolling noise, tyres and wind get louder and brighter with speed.",
    "Raum hat ein eigenes Menü (Strecke → Raum, und „Raum“ in der FAHREN-Streckenkachel auf der Bahn): Größe, Raumgestalter, Tutorial und gespeicherte Räume mit Namen zum Laden und Löschen. Im Editor blendet der Schalter „Raum“ den Raum aus; ausgeblendet zählt er auch für Zufallsstrecken nicht. Ziehen im Editor: die Strecke folgt jetzt Finger, Maus und rechtem Stick, der Raum bleibt liegen. Alle Streckenbilder (Fahren-Kachel, Übersicht, Startaufstellung, Listen) zeigen die Originalteile mit Pfeilen. Neue Ladeanimation: ein Streckenteil dreht sich, abwechselnd Gerade und Rechtskurve. Community-Bestzeiten (vorher Community-Strecken): beim Einreichen wählt man die Abstimmung (Arcade, Pro, GT3, F1, Realismus GT3), die Liste zeigt sie, und gefahren wird damit. Einzelrennen nach einem Mehrspieler-Rennen fragt nicht mehr „für alle?“, wenn niemand sonst da ist.": "Room has its own menu (Track → Room, and “Room” in the DRIVE track tile on the rail): size, room designer, tutorial and saved rooms with names to load and delete. In the editor the “Room” switch hides the room; hidden, it is also ignored for random tracks. Dragging in the editor: the track now follows finger, mouse and right stick, the room stays put. All track pictures (drive tile, overview, starting grid, lists) show the original pieces with arrows. New loading animation: a track piece spins, alternating straight and right curve. Community best times (formerly community tracks): when submitting you choose the setup (Arcade, Pro, GT3, F1, Realism GT3), the list shows it, and it is driven with it. A single-player race after a multiplayer race no longer asks “for everyone?” when nobody else is there.",
    "Behoben: 0.9.43 startete auf Geräten mit eingetragenem Raum nicht („Cannot access 'RAUM_ZELLE_CM' before initialization“) – die Editor-Vorschau zeichnete beim Laden schon die Möbel, bevor deren Konstanten angelegt waren; die neue Start-Diagnose hat den Fehler angezeigt. Schalten klingt jetzt mechanisch: Schaltwalze und Klauenring rasten metallisch ein, darunter der Ruck im Antriebsstrang (statt des dumpfen „düb“). Lichthupe: Vorder- und Rücklicht gehen gemeinsam aus und an, das Bremslicht leuchtet nicht mehr mit.": "Fixed: 0.9.43 did not start on devices with a room set (“Cannot access 'RAUM_ZELLE_CM' before initialization”) – the editor preview already drew the furniture while loading, before its constants existed; the new start diagnostics showed the error. Gear changes now sound mechanical: shift drum and dog ring engage with a metallic click, with the driveline jolt underneath (instead of the dull “dub”). Headlight flash: front and rear lights go off and on together, the brake light no longer lights up.",
    "Rennende: Die Rennuhr startete erst bei 75 % der Höchstgeschwindigkeit (die Schwelle „3 km/h“ wurde mit dem Modelltempo verglichen) – wer das nie erreichte, fuhr Runden, die nicht zählten, und das Rennen endete nie. Jetzt startet sie bei 3 km/h auf dem Tacho oder spätestens an der ersten Ziellinie; die Frühstart-Erkennung hatte denselben Fehler. Raumgestalter wie der Editor: „Raumgestalter starten“ öffnet das Vollbild, oben die Werkzeugleiste mit „Schließen“, die Fläche in einer eigenen Zeile darunter, der Menükopf liegt nicht mehr über den Knöpfen. Rundenzeiten-Diagramm: weißer Saum unter jeder Linie, damit auch ein schwarzes Auto sichtbar ist.": "Race end: the race clock only started at 75 % of top speed (the “3 km/h” threshold was compared with the model speed) – anyone who never reached that drove laps that did not count, and the race never ended. Now it starts at 3 km/h on the speedometer or at the first finish line at the latest; false-start detection had the same bug. Room designer like the editor: “Start room designer” opens full screen, toolbar with “Close” at the top, the area in its own row below, the menu header no longer covers the buttons. Lap time chart: white outline under every line so a black car is visible too.",
    "Strecke wird gesucht …": "Searching for a track …",
    "Lenkung GT3, F1 und Realismus GT3: voller Einschlag ist wieder erreichbar. Seit dem neuen Lenkweg begrenzte das „Lenkansprechen“ dieser Voreinstellungen den größten Einschlag (Realismus GT3 gemessen 19 von 45° im Schritttempo, mit kalten Reifen 11°); jetzt 3,0 wie Pro, und Realismus GT3 gleicht kalte Reifen mit Lenkkalibrierung 1,6 aus. Pro und Arcade unverändert. Zufallsstrecke: Ladeanimation (Gerade, Kurve, Haarnadel) im Editor, die Suche läuft dafür in kleinen Stücken. Mehrspieler: dieselbe Animation im Bereitschaftsschirm, solange auf die anderen gewartet wird.": "Steering GT3, F1 and Realism GT3: full lock is reachable again. Since the new steering path, the “steering response” of these presets capped the largest angle (Realism GT3 measured 19 of 45° at walking pace, 11° on cold tyres); now 3.0 like Pro, and Realism GT3 compensates cold tyres with steering calibration 1.6. Pro and Arcade unchanged. Random track: loading animation (straight, curve, hairpin) in the editor; the search now runs in small chunks for this. Multiplayer: the same animation on the ready screen while waiting for the others.",
    "Rundenrennen enden jetzt mit der Zielrunde: Wer die eingestellte Rundenzahl fährt, ist sofort im Ziel (Ende-Ton und Ergebnis); vorher endete ein 5-Runden-Rennen erst bei der Überfahrt nach Runde 5, im Mehrspieler also scheinbar nie. Die Rennübersicht zeigt dich im Mehrspieler nicht mehr doppelt (Name und Auto). Derby: Auto 1 nimmt wieder Schaden (seitlich −20 %, vorn −10 %), vorher ging der Treffer ins Leere und nur der Controller rüttelte. Mehrspieler auf schwachen Handys: im Rennen fragt das Handy den Host nur noch alle 3 s ab, meldet Positionen für Zuschauer alle 0,5 s und zeichnet die Ranglisten-Tabelle erst nach dem Rennen, damit der Steuertakt Luft hat.": "Lap races now end with the final lap: whoever completes the set number of laps finishes immediately (end sound and results); before, a 5-lap race only ended at the crossing after lap 5, so in multiplayer it seemed never to end. The race overview no longer shows you twice in multiplayer (name and car). Derby: car 1 takes damage again (side −20 %, front −10 %); before, the hit went nowhere and only the controller rumbled. Multiplayer on slow phones: during the race the phone polls the host only every 3 s, reports positions for spectators every 0.5 s and redraws the leaderboard table only after the race, so the control loop has room.",
    "Raumgestalter starten": "Start room designer",
    "Raumgestalter": "Room designer",
    "Möbel": "Furniture",
    "Boden": "Floor",
    "Pinsel": "Brush",
    "Rechteck": "Rectangle",
    "Strecke einpassen": "Fit track",
    "Vorlage Rechteck": "Template rectangle",
    "Vorlage L-Form": "Template L shape",
    "Vorlage U-Form": "Template U shape",
    "Vorlage Oval": "Template oval",
    "✕ malen · □ Möbel/Boden · △ Pinsel/Rechteck · L1/R1 Größe · Select rückgängig · Start einpassen · ○ schließen": "✕ paint · □ furniture/floor · △ brush/rectangle · L1/R1 size · Select undo · Start fit · ○ close",
    "Im Editor ist noch keine Strecke.": "There is no track in the editor yet.",
    "Die Editor-Strecke passt nicht in diesen Raum.": "The editor track does not fit into this room.",
    "Die Editor-Strecke passt": "The editor track fits",
    "gedreht": "rotated",
    "Raumdesigner (experimentell) unter Strecke → Meine Teile: den Raum in 10-cm-Feldern als Boden oder Möbel malen, mit Pinsel (10/30/60 cm) oder Rechteck, Vorlagen Rechteck, L, U und Oval, Rückgängig und „Strecke einpassen“. Geht mit Finger, Maus, Tastatur und Gamepad (Stick/Steuerkreuz bewegt, ✕ malt, □ Möbel/Boden, △ Pinsel/Rechteck, L1/R1 Größe, ○ fertig). Zufallsstrecken passen jetzt wirklich hinein: geprüft wird mit der vollen Bahnbreite plus 2 cm Abstand statt nur mit der Mittellinie, um Möbel herum, und der Raum wird im Editor gleich richtig um die Strecke gelegt.": "Room designer (experimental) under Track → My pieces: paint the room in 10 cm cells as floor or furniture, with a brush (10/30/60 cm) or rectangle, templates rectangle, L, U and oval, undo and “Fit track”. Works with finger, mouse, keyboard and gamepad (stick/d-pad moves, ✕ paints, □ furniture/floor, △ brush/rectangle, L1/R1 size, ○ done). Random tracks now really fit: checked with the full track width plus 2 cm clearance instead of just the centre line, around furniture, and the editor places the room around the track correctly.",
    "Streckenteile wie die Originalschienen: weißer Randstreifen mit gefüllten Pfeilen in gleichem Abstand auf beiden Seiten (links blau, rechts rot), Steckzapfen an den Teilenden, matt schwarze Fahrbahn. Tempo nachgemessen (btsnoop): Vollgas sind real 5,45 km/h, im Maßstab 272 km/h; der Tacho rechnet jetzt damit, und bei Gasfaktor 100 % (Realismus GT3) stimmt er genau; Pro und Arcade behalten ihren Faktor und fahren sich wie vorher. Rundenzählung auf der Schiene: keine Doppelrunde mehr, wenn ein Auto zwischen Barcode und Ziellinie hält, keine Mini-Runde beim Start vor dem Streifen, keine Phantomrunde bei Ghosts und Spieler 2/3 beim Losfahren; mit einer zweiten Start/Ziel-Geraden zählt Runde 1 richtig.": "Track pieces like the original rails: white edge strip with filled arrows evenly spaced on both sides (left blue, right red), connector pins at the piece ends, matt black road. Speed re-measured (btsnoop): full throttle is really 5.45 km/h, 272 km/h at scale; the speedometer now uses this, and at throttle factor 100 % (Realism GT3) it is exact; Pro and Arcade keep their factor and drive as before. Lap counting on the rail: no double lap when a car stops between barcode and finish line, no mini lap when starting in front of the line, no phantom lap for ghosts and players 2/3 when pulling away; with a second start/finish straight, lap 1 counts correctly.",
    "Rundenzeit an der Ziellinie: Auf der Schiene misst und sagt Spieler 1 die Runde jetzt an der Ziellinie an, die das Auto selbst meldet (Byte 15, etwa 35 cm nach dem Barcode, aus den btsnoop-Mitschnitten), nicht mehr am Barcode; der Barcode bleibt Rückfall für Autos ohne diese Meldung. Tastenbelegung: Eine neue Zuweisung auf eine schon belegte Taste tauscht jetzt die beiden Aktionen, statt beim nächsten Start zurückzufallen, und eine alte Aufräumregel setzt eigene Tasten (z. B. Rennstart auf Kreuz) nicht mehr bei jedem Laden zurück. Optionen → Allgemein: zwei Regler für die Größe der Haupttabs und der Unter-Tabs (60–180 %, 100 % wie bisher).": "Lap time at the finish line: on the rail, player 1 now times and announces the lap at the finish line that the car reports itself (byte 15, about 35 cm after the barcode, from the btsnoop captures), no longer at the barcode; the barcode remains the fallback for cars without this report. Button mapping: a new assignment to a button that is already taken now swaps the two actions instead of reverting on the next start, and an old clean-up rule no longer resets your own buttons (e.g. race start on Cross) on every load. Options → General: two sliders for the size of the main tabs and the sub-tabs (60–180 %, 100 % as before).",
    "Crash-Richtung jetzt gemessen statt gelernt: Beim Beschleunigen wandert der Gyro-Punkt im Cockpit nach vorn, also heißt Byte 1 fällt „von hinten geschoben“, Byte 1 steigt „vorne eingeschlagen“, überwiegendes Byte 3 „von der Seite“ (45° Toleranz). „Nur der Rammer bremst“ (früher „Kein Bremsen bei Auffahrunfall“): Gebremst wird nur, wer vorne einschlägt; wer von hinten oder von der Seite getroffen wird, fährt weiter. Rammer-Strafe: Rammer ist, wer vorne eingeschlagen ist, während der andere von hinten oder der Seite getroffen wurde (frontal zählt nicht); das gilt auch für Ghosts. Im Derby kostet vorn einschlagen 10 %, getroffen werden 20 %.": "Crash direction is now measured instead of learned: when accelerating, the gyro dot in the cockpit moves forward, so byte 1 falling means “pushed from behind”, byte 1 rising means “hit with the front”, and byte 3 dominating means “from the side” (45° tolerance). “Only the rammer brakes” (formerly “No braking when rear-ended”): only a car that hits with its front is braked; a car hit from behind or from the side keeps going. Ramming penalty: the rammer is the car that hit with its front while the other was hit from behind or the side (head-on does not count); this applies to ghosts too. In derby, hitting with the front costs 10 %, being hit costs 20 %.",
    "Bestenliste: Kann eine Zeit nicht hochgeladen werden, kommt ein Hinweis mit Strecke und Grund (z. B. „keine Verbindung zum Server“ oder die Ablehnung durch die Bestenliste), nie mitten im Rennen und nie über einem anderen Dialog. Auf der Challenge-Seite steht, wie viele Zeiten noch warten, mit „Jetzt senden“. Hoch- und Herunterladen der Bestenliste laufen nur, wenn gerade kein Rennen läuft, damit das Steuern nicht verzögert wird.": "Leaderboard: if a time cannot be uploaded, a notice shows the track and the reason (e.g. “no connection to the server” or a rejection by the leaderboard), never in the middle of a race and never over another dialog. The challenge page shows how many times are still waiting, with “Send now”. Leaderboard uploads and downloads only run when no race is in progress, so steering is not delayed.",
    "Bestenliste: Die Listen liegen im Zwischenspeicher und erscheinen sofort, beim App-Start und alle 10 Minuten wird im Hintergrund nachgeladen; eine Strecke ohne Zeiten zeigt das sofort, statt lange zu laden. Hochgeladene Zeiten bleiben in einer Warteschlange, bis das Sheet sie bestätigt, und eine Ablehnung wird mit Grund gemeldet. Wöchentliche Challenges: Die Resttage stehen oben neben „Woche X/20“, unter jeder Strecke stehen Spieler und Ergebnisse. Spiegeln ist jetzt ein Knopf mit Symbol unter der Karte. FAHREN, Strecke: Druckvorlagen nur bei FREI, Editor nur bei AUF DER BAHN. Wischen wechselt den Reiter nicht mehr, wenn die Geste am Bildschirmrand beginnt (Systemleiste).": "Leaderboard: lists are cached and appear immediately; they are refreshed in the background at app start and every 10 minutes, and a track without times shows that right away instead of loading for a long time. Uploaded times stay in a queue until the sheet confirms them, and a rejection is reported with its reason. Weekly challenges: the remaining days appear at the top next to “Week X/20”, and players and results appear under each track. Mirroring is now an icon button under the map. DRIVE, track: print templates only for FREE, the editor only for ON THE TRACK. Swiping no longer switches tabs when the gesture starts at the screen edge (system bar).",
    "WLAN-Mehrspieler: genauerer gemeinsamer Start. Die Zeit wird beim Eintreffen der Antwort gemessen, nicht erst nach dem Einlesen, und im Vorlauf gleicht jedes Telefon die Host-Uhr acht Mal nach und stellt die Ampel nach. Rennende für alle: Hat ein Mitspieler die Rundenzahl erreicht, ist bei allen die laufende Runde die letzte. Neu: „Rennen für alle beenden“ (WLAN-Reiter und Rückfrage beim Verlassen des Rennens). An den Host gehen jetzt die Rennrunden inklusive Frühstart-Strafe.": "WiFi multiplayer: a more precise shared start. The time is measured when the response arrives, not after reading it, and during the lead-in every phone re-syncs with the host clock eight times and adjusts the start lights. Race end for everyone: once a player reaches the lap count, the current lap is the last one for everybody. New: “End race for everyone” (WiFi tab and the question when leaving the race). The host now receives race laps including the jump-start penalty.",
    "FAHREN: Die Autos-Kachel zeigt ab zwei verbundenen Autos alle (ohne Foto als Farbfläche), die Motorsound-Kachel ist weg (Motor jetzt nur in der Garage), Fahrgefühl und Start sind größer. Garage: ein neues Foto erscheint sofort links in der Auto-Kachel. Podium: größere Namen, bei zwei Autos nur Platz 1 und 2, allein ein Solo-Podest mit Gesamtzeit, bester Runde und Vergleich mit deiner Bestzeit auf der Strecke. Cockpit: die Rundenliste zeigt höchstens fünf Runden und schiebt nichts mehr aus dem Bild. Ohne Bahn zeigt die Rennübersicht dein Streckenfoto bzw. den Platzhalter statt des Layouts. Freies Training: kein „Automatisch aufstellen“. Knockout heißt jetzt „NPC Knockout“, braucht mindestens einen Ghost und schaltet „Auf der Bahn“ ein.": "DRIVE: the cars tile shows every car once two are connected (a car without a photo appears as a colour block), the engine-sound tile is gone (engine now only in the garage), and driving feel and start are larger. Garage: a new photo appears right away in the car tile on the left. Podium: larger names; with two cars only places 1 and 2; alone, a solo podium with total time, best lap and a comparison with your best time on the track. Cockpit: the lap list shows at most five laps and no longer pushes anything off screen. Without the track, the race overview shows your track photo or the placeholder instead of the layout. Free practice: no “Line up automatically”. Knockout is now called “NPC Knockout”; it needs at least one ghost and switches on “On the track”.",
    "Derby: Ein Crash gegen die Wand beendet das Spiel nicht mehr. Es endet erst, wenn jemand das Kill-Ziel erreicht oder nur noch ein Teilnehmer fährt; allein ohne Gegner nur von Hand. 2 Spieler: Auto 2 und 3 haben beim Boxenstopp dieselben Töne wie Auto 1 (Tanken, Reparatur, Schrauber), auf ihrer Stereoseite. Latenz: Spieler 2 und 3 senden über denselben Weg wie Auto 1 (der neueste Befehl ersetzt den wartenden), und der Schirm „Beide“ wird direkt nach dem Senden gezeichnet.": "Derby: a crash into the wall no longer ends the game. It ends only when someone reaches the kill target or only one participant is still driving; alone without opponents, only by hand. 2 players: cars 2 and 3 get the same pit-stop sounds as car 1 (refuelling, repair, wrench), on their own stereo side. Latency: players 2 and 3 send through the same path as car 1 (the newest command replaces the waiting one), and the “Both” screen is drawn right after sending.",
    "Behoben: Nach einem abgebrochenen Derby blieb das Cockpit im nächsten normalen Rennen im Derby-Modus. Behoben: Gespiegelte Strecken mit beiden Haarnadeltypen (z. B. Balkonia) gingen nicht mehr zu, weil das gerade Stück der Haarnadel rückwärts gefahren am Ausgang liegt. Jetzt schließen alle 83 Challenge-Strecken auch gespiegelt. Neu in den Renneinstellungen: „Gelbe Flagge deaktivieren“ (ab Werk aus). Die Motorwahl von Auto 2 und 3 wird jetzt gespeichert und gesichert.": "Fixed: after an aborted derby, the cockpit stayed in derby mode in the next normal race. Fixed: mirrored tracks with both hairpin types (e.g. Balkonia) no longer closed, because driven in reverse the hairpin's straight section sits at the exit. All 83 challenge tracks now close when mirrored too. New in race settings: “Disable yellow flag” (off by default). The engine choice for cars 2 and 3 is now saved and backed up.",
    "Latenz: Im Cockpit liest der 45-ms-Sendetakt das Gamepad jetzt direkt vor der Physik statt den Wert vom letzten Bildschirmbild zu nehmen (spart im Schnitt etwa einen halben Frame, auf schwachen Handys mehr). Die Live-Anzeigen des Pads werden nur noch bei Änderung geschrieben.": "Latency: in the cockpit the 45 ms send heartbeat now reads the gamepad right before the physics step instead of using the value from the last frame (saves about half a frame on average, more on slow phones). The pad's live readouts are only written when they change.",
    "Neu: Optionen → Statistiken. Zu sehen sind gefahrene Kilometer (simuliert und auf der Bahn), Sitzungen, Fahrzeit, beste Runde, Rennen, Siege (Rennen mit mehreren Autos), Boxenstopps, Crashs, Medaillen, gefahrene Strecken, Sitzungen je Modus und ein Kilometer-Ranking je Auto, alles aus den Daten, die die App ohnehin speichert. Behoben: Die gespeicherten Kilometer waren seit Ende August 73,75-fach zu groß und werden beim ersten Start einmalig korrigiert; die Sicherungsübersicht zeigt wieder die Zahl der Sitzungen.": "New: Options → Statistics. It shows kilometres driven (simulated and on the track), sessions, driving time, best lap, races, wins (races with several cars), pit stops, crashes, medals, tracks driven, sessions per mode and a kilometre ranking per car, all from data the app already stores. Fixed: since late August the stored kilometres were 73.75 times too large; they are corrected once on the first start. The backup overview shows the number of sessions again.",
    "Automatische Aufstellung jetzt für alle Autos: Fahrerautos rollen per Autopilot im Formationstempo auf ihren Startplatz und werden dort gehalten, bis du startest (deine Bremse hat Vorrang). Der Motorsound wird nur noch in der Garage je gesteuertem Auto gewählt, die Zeile in den Optionen ist weg. Die Knöpfe ganz unten in der Garage (Foto, Blinken, Trennen) sind größer.": "Automatic line-up now works for all cars: driver cars roll to their grid slot on autopilot at formation pace and are held there until you start (your brake takes priority). The engine sound is now chosen only in the garage, per controlled car; the row in the options is gone. The buttons at the very bottom of the garage (photo, blink, disconnect) are bigger.",
    "Cockpit: Die Rundenzahl links oben ist so groß wie die Zeiten rechts, die Knöpfe darunter sind kleiner, die Schaltlichter sind rechteckig und größer. Rennübersicht (Schirm 3): größere Schrift, die Strecke nimmt rechts bis zur halben Breite ein. Die Ideallinie erscheint nur noch im Ghost-Menü und im Editor, wenn du sie anklickst. „Bringe die Autos in Position“: Strecke rechts auf halber Breite, viel größere Schrift, größere Knöpfe und neu „Automatisch aufstellen“ (experimentell): die Ghosts rollen langsam auf ihre Startplätze und halten dort.": "Cockpit: the lap counter at the top left is as large as the times on the right, the buttons below it are smaller, and the shift lights are rectangular and bigger. Race overview (screen 3): larger text, and the track takes up to half the width on the right. The racing line now only appears in the ghost menu and in the editor when you switch it on. “Bring the cars into position”: track on the right at half width, much larger text, bigger buttons and the new “Line up automatically” (experimental): the ghosts roll slowly to their grid slots and stop there.",
    "Frühstart: Neuer Schalter in den Renneinstellungen (ab Werk an) – wer vor Grün losfährt, bekommt 5 s auf seine erste Runde, auch Spieler 2 und 3 und im WLAN-Mehrspieler. Aus: wie bisher 2 s Ausbremsen. Die Ampel läuft weiterhin vor jedem Start außer im freien Training. Menü im Rennen: Optionen, Zurück-Pfeil oder Esc fragen jetzt „Ein Wechsel ins Menü beendet das Rennen.“ (Weiterfahren / Rennen beenden), solange die Frage offen ist, läuft das Rennen weiter.": "Jump start: new switch in race settings (on by default) – whoever moves before green gets 5 s added to their first lap, players 2 and 3 too, and in WiFi multiplayer. Off: 2 s of braking as before. The start lights still run before every start except free practice. Menu during a race: Options, the back arrow or Esc now ask “Going to the menu ends the race.” (Keep driving / End race); while the question is open, the race keeps running.",
    "Crash: Schaden und Bremsen sind jetzt getrennte Schalter (Optionen → Tank & Schaden), dazu „Kein Bremsen bei Auffahrunfall“ (experimentell): wird von hinten aufgefahren, bremst nur der Auffahrende. Neu in den Renneinstellungen (experimentell): Strafe für Rammer (aus/nach 1–5× Rammen, 3–20 s). Die Strafe steht rot auf dem Boxenknopf, wird beim nächsten Stopp zusätzlich im Stand abgesessen („STRAFE“), sonst steht im Ergebnis [RAMMER]. Arcade: Tempo gedrosselt, Bremse auf Maximum, Crashs bremsen ohne Schaden. Derby: Tank und Reifenverschleiß aus, eigene Health groß, ab 50 % Schaden flackert das Licht, ab 75 % ist es aus und das Auto ruckelt.": "Crash: damage and braking are now separate switches (Options → Fuel & damage), plus “No braking when rear-ended” (experimental): if someone runs into you from behind, only the car behind brakes. New in race settings (experimental): penalty for rammers (off/after 1–5 rams, 3–20 s). The penalty shows in red on the pit button and is served as an extra standstill at the next stop (“PENALTY”); otherwise the result shows [RAMMER]. Arcade: top speed throttled, brakes at maximum, crashes brake without damage. Derby: fuel and tyre wear off, your health shown large, lights flicker from 50 % damage, from 75 % they are off and the car stutters.",
    "Challenges: Die Woche (X/20) steht nur noch einmal neben „Wöchentliche Challenges“, jede Strecke zeigt zusätzlich, wie viele Spieler sie gefahren sind. Das Histogramm der Bestenliste zählt wie die Tabelle nur eine Zeit je Gerät. Gold gibt es auf Balkonia ab 16 s je Runde, alle anderen Strecken sind daran kalibriert (Imolina jetzt ca. 5,0 s). Tabs: CHALLENGES steht jetzt vor WLAN MEHRSPIELER.": "Challenges: the week (X/20) is now shown only once, next to “Weekly challenges”, and each track also shows how many players have driven it. The leaderboard histogram counts only one time per device, like the table. Balkonia awards gold from 16 s per lap, and all other tracks are calibrated to it (Imolina now about 5.0 s). Tabs: CHALLENGES now comes before WIFI MULTIPLAYER.",
    "3-Spieler-Modus: Der Cockpit-Schirm „Beide“ zeigt mit Spieler 3 drei Spalten (Tempo, Gang, Tank, Zustand, Reifen, Reifen-/Tankwahl, eigener Motorsound-Knopf). Die Optionsseite heißt jetzt „Mehrspieler“, und Presets und Profile der Tastenbelegung speichern Spieler 3 mit.": "3-player mode: with player 3 the cockpit screen “Both” shows three columns (speed, gear, fuel, condition, tyres, tyre/fuel choice, own engine-sound button). The options page is now called “Multiplayer”, and button-mapping presets and profiles include player 3.",
    "3-Spieler-Modus (experimentell): In der Garage gibt es jetzt die Rolle „Spieler 3“. Das dritte Gamepad fährt Auto 3, mit eigener Tastenbelegung (Steuerung → Spieler 3), eigenem Tank, Schaden, Boxenstopp, Motorsound und Rundengong.": "3-player mode (experimental): the garage now has the role “Player 3”. The third gamepad drives car 3, with its own button mapping (Controls → Player 3), its own fuel, damage, pit stop, engine sound and lap chime.",
    "Vorbereitung 3-Spieler-Modus: Tank, Boxenstopp, Schaden, Crash, Abseits, Autopilot, Frühstart, Knockout und Derby laufen jetzt über Spielerplätze statt fester Variablen für Spieler 2. Für dich ändert sich noch nichts, Spieler 2 fährt wie bisher.": "Preparing 3-player mode: fuel, pit stop, damage, crashes, off-track, autopilot, jump start, knockout and derby now run through player slots instead of fixed variables for player 2. Nothing changes for you yet; player 2 drives as before.",
    "Streckeneditor: gezoomt lässt sich die Karte jetzt mit Finger oder Maus verschieben, im Vollbild zoomt das Mausrad; der Zoom bleibt gespeichert.": "Track editor: when zoomed, the map can now be moved by finger or mouse, in fullscreen the mouse wheel zooms; the zoom stays saved.",
    "Geist raus · noch {n} Geister": "Ghost out · {n} ghosts left",
    "Knockout: Menschen gewinnen!": "Knockout: humans win!",
    "Knockout: Geister gewinnen.": "Knockout: ghosts win.",
    "Derby: Spieler 1 gewinnt!": "Derby: player 1 wins!",
    "Derby: Spieler {n} gewinnt!": "Derby: player {n} wins!",
    "Spieler {n}": "Player {n}",
    "Derby: Geist gewinnt.": "Derby: a ghost wins.",
    "Demolition Derby repariert: Rammen trifft einmal je Annäherung statt in jedem Takt (ein naher Ghost war nach 0,2 s raus), ein Auto bei 0 % bleibt wirklich stehen, Abschüsse werden dem richtigen Spieler gemeldet, Auto 2 wird nicht mehr nach dem Kreisel von Auto 1 gewertet. Knockout/Derby-Meldungen übersetzt, neue Selbsttests; geprüft, dass jede Gold-Zeit erreichbar ist.": "Demolition Derby fixed: ramming hits once per approach instead of every tick (a nearby ghost was out after 0.2 s), a car at 0 % really stays put, kills are reported for the right player, car 2 is no longer judged by car 1's gyro. Knockout/derby messages translated, new self-tests; checked that every gold time is reachable.",
    "Zwei-Spieler-Modus repariert: Beim Abschalten hält Auto 2 jetzt an (fuhr vorher mit dem letzten Gas weiter), ein getrenntes Auto 2 wird freigegeben, das Licht von Auto 2 gilt für Auto 2, kein Drift-Gegenlenken nach den Daten von Auto 1, alte Tastenbelegungen von Spieler 2 werden aufgeräumt.": "Two-player mode fixed: switching it off now stops car 2 (it used to keep driving with the last throttle), a disconnected car 2 is released, car 2's lights apply to car 2, no drift counter-steer from car 1's data, old player-2 button layouts are cleaned up.",
    "Werkseinstellung": "Factory default",
    "– keins –": "– none –",
    "geändert": "changed",
    "„{n}“ geladen.": "\"{n}\" loaded.",
    "{k} Regler gesetzt.": "{k} controls set.",
    "Name des Presets": "Preset name",
    "„{n}“ gespeichert.": "\"{n}\" saved.",
    "Preset löschen?": "Delete preset?",
    "„{n}“ wird gelöscht. Die aktuellen Einstellungen bleiben, wie sie sind.": "\"{n}\" will be deleted. The current settings stay as they are.",
    "„{n}“ gelöscht.": "\"{n}\" deleted.",
    "Preset": "Preset",
    "Ein benannter Stand nur für dieses Menü. ◀ ▶ wechselt sofort. „geändert“ heißt: seit dem Laden verstellt – gespeichert ist es trotzdem (alles speichert sich von selbst), „Speichern“ schreibt es ins Preset zurück. ★ = Werkspreset.": "A named state for this menu only. ◀ ▶ switches at once. \"changed\" means: adjusted since loading – it is saved anyway (everything saves itself), \"Save\" writes it back into the preset. ★ = factory preset.",
    "Speichern unter …": "Save as …",
    "Profil „{n}“": "Profile \"{n}\"",
    "Name des neuen Profils": "Name of the new profile",
    "Das Profil gibt es schon.": "That profile already exists.",
    "Neuer Name für „{n}“": "New name for \"{n}\"",
    "Das letzte Profil bleibt.": "The last profile stays.",
    "Profil löschen?": "Delete profile?",
    "„{n}“ wird gelöscht, die App wechselt zum nächsten Profil.": "\"{n}\" will be deleted, the app switches to the next profile.",
    "Profil": "Profile",
    "Wer spielt? Ein Profil merkt sich alle Einstellungen, die Tastenbelegung und das Preset je Menü. Autos, Strecken und Statistiken gehören keinem Profil, sie gelten immer.": "Who is playing? A profile remembers all settings, the button mapping and the preset per menu. Cars, tracks and statistics belong to no profile, they always apply.",
    "Neues Profil": "New profile",
    "Umbenennen": "Rename",
    "Speichersystem (experimentell): Oben in jedem Menü (Allgemein, Fahrgefühl, Ton, Autonome Gegner, Controller, Renneinstellungen) eine Preset-Zeile ◀ Name ▶ mit Speichern, Speichern unter und Löschen; Werkspresets mit ★, „geändert“ zeigt Abweichungen. Profile unter Optionen > System: jedes Profil merkt sich alle Einstellungen, die Tastenbelegung und das Preset je Menü. Bisherige eigene Abstimmungen stehen im Fahrgefühl in der Liste.": "Save system (experimental): at the top of each menu (General, Driving feel, Sound, Autonomous opponents, Controller, Race settings) a preset row ◀ name ▶ with Save, Save as and Delete; factory presets with ★, \"changed\" shows deviations. Profiles under Options > System: each profile remembers all settings, the button mapping and the preset per menu. Earlier own tunings are listed under Driving feel.",
    "Zufallsstrecke: Die beiden Haarnadeln liegen jetzt meist getrennt statt immer direkt hintereinander, und mit Grundpackung + Haarnadel-Set entstehen deutlich öfter gültige Strecken. Meine Strecken: der Speichern-Knopf ist weg (gespeichert wird im Editor, der den Namen der geladenen Strecke vorschlägt).": "Random track: the two hairpins are now mostly separate instead of always right after each other, and with the basic set + hairpin set valid tracks come up much more often. My tracks: the save button is gone (saving happens in the editor, which suggests the name of the loaded track).",
    "blinkt": "blinking",
    "Farbe wählen": "Choose colour",
    "Name für die Rundenübersicht": "Name for the lap overview",
    "Foto aufnehmen": "Take photo",
    "Foto entfernen": "Remove photo",
    "Blinken": "Blink",
    "Trennen": "Disconnect",
    "Noch kein Auto verbunden. Links auf „+ Auto verbinden“ tippen.": "No car connected yet. Tap \"+ Connect car\" on the left.",
    "Name": "Name",
    "Garage neu (Variante A): links die Autos untereinander mit ihrer Rolle (◀ ▶, nur freie Rollen) und darunter die Aktionen, rechts die Einstellungen des gewählten Autos (Name, Farbe, Ghost-Tempo, Motorklang, Foto, Blinken, Trennen). Mit dem Steuerkreuz: hoch/runter wählt, links/rechts ändert, X springt nach rechts.": "New garage (variant A): on the left the cars one below the other with their role (◀ ▶, only free roles) and the actions below, on the right the settings of the selected car (name, colour, ghost speed, engine sound, photo, blink, disconnect). With the D-pad: up/down selects, left/right changes, X jumps to the right.",
    "Streckeneditor: Das Raum-Rechteck ist auch mit nur einer Grenze sichtbar und zeigt die Maße. Die Strecke lässt sich darin mit dem Finger oder der Maus verschieben, im Vollbild auch mit dem rechten Stick; rechten Stick drücken zentriert.": "Track editor: the room rectangle is visible even with only one limit and shows its size. The track can be moved inside it by finger or mouse, in fullscreen also with the right stick; pressing the right stick centres it.",
    "Gemeinsame Liste nicht erreichbar, hier deine eigenen Strecken.": "Shared list not reachable, here are your own tracks.",
    "Gemeinsame Liste: {n} Strecken.": "Shared list: {n} tracks.",
    "Lade die gemeinsame Liste …": "Loading the shared list …",
    "Nur auf diesem Gerät (keine Online-Adresse eingestellt).": "Only on this device (no online address set).",
    "Diese Strecke gibt es schon: {n}": "This track already exists: {n}",
    "Strecke {n} für alle eingereicht.": "Track {n} submitted for everyone.",
    "Strecke {n} eingereicht (nur auf diesem Gerät).": "Track {n} submitted (only on this device).",
    "nur hier": "only here",
    "Community-Strecken werden jetzt über das Online-Sheet mit allen geteilt (Strecken und Zeiten), jede Zeile zeigt ein Vorschaubild. Eigene, bisher nur lokale Strecken werden beim nächsten Abgleich eingereicht. Dauerrennen-Zeiten kommen jetzt auch in die Online-Bestenliste. Das Apps Script muss dafür neu bereitgestellt werden.": "Community tracks are now shared with everyone through the online sheet (tracks and times), each row shows a preview. Your own tracks that were only local are submitted at the next sync. Endurance times now also go to the online leaderboard. The Apps Script needs to be redeployed for this.",
    "zurück": "back",
    "weiter": "next",
    "Auswahlfelder mit wenigen Werten (Physik-Modus, Getriebe, Boxenstopp, Sprache …) sind jetzt „◀ Wert ▶“ zum Durchschalten statt Aufklapplisten.": "Selectors with few values (physics mode, gearbox, pit stop, language …) are now \"◀ value ▶\" to cycle through instead of drop-down lists.",
    "Alles bleibt gespeichert: Rolle und Ghost-Tempo je Auto, die Strecke im Editor (mit Drehung und Zoom) und die Tastenbelegung je Controller. In der App zusätzlich eine Sicherungsdatei in Dokumente/OmegaSim, die auch eine Neuinstallation übersteht; nach einer Neuinstallation bietet die App an, sie einzulesen (neue APK nötig). Garage: Spieler 1/2 lassen sich nur noch wählen, wenn kein anderes Auto sie hat. Presets enthalten Sprache, Entwickler- und Zwei-Spieler-Modus nicht mehr.": "Everything stays saved: role and ghost speed per car, the track in the editor (with rotation and zoom) and the button mapping per controller. In the app there is also a backup file in Documents/OmegaSim that survives a reinstall; after a reinstall the app offers to read it back in (new APK needed). Garage: player 1/2 can only be chosen when no other car has them. Presets no longer contain language, developer and two-player mode.",
    "Alles wird automatisch gespeichert, du musst nichts laden.": "Everything is saved automatically, you do not need to load anything.",
    "Einstellungen zuletzt um {u}.": "Settings last saved at {u}.",
    "Sicherungsdatei (übersteht eine Neuinstallation) zuletzt um {u}: {o}.": "Backup file (survives a reinstall) last written at {u}: {o}.",
    "Die Sicherungsdatei in Dokumente/OmegaSim wird gleich angelegt.": "The backup file in Documents/OmegaSim will be created shortly.",
    "Die Datei ist nicht lesbar": "The file cannot be read",
    "Sicherung nicht geladen": "Backup not loaded",
    "Sicherung geladen, die App startet neu …": "Backup loaded, the app restarts …",
    "Gespeichert: {o}": "Saved: {o}",
    "Frühere Daten wiederherstellen?": "Restore earlier data?",
    "Die App sichert alles automatisch in Dokumente/OmegaSim (Datei OmegaSim-Sicherung.json). Nach einer Neuinstallation kannst du sie hier wieder einlesen: Einstellungen, Strecken, Statistiken, Autos und Tastenbelegung.": "The app backs everything up automatically to Documents/OmegaSim (file OmegaSim-Sicherung.json). After a reinstall you can read it back in here: settings, tracks, statistics, cars and button mapping.",
    "Sicherungsdatei wählen": "Choose backup file",
    "Neu anfangen": "Start fresh",
    "Ghost: Tempo-Streuung": "Ghost: speed spread",
    "Jedes Auto bekommt je Rennen ein eigenes Grundtempo auf der Geraden, bis zu so viel Prozent schneller oder langsamer. 0 % = alle gleich.": "Each car gets its own base speed on the straights per race, up to this many percent faster or slower. 0 % = all equal.",
    "Ghost: Start je Startreihe versetzt": "Ghost: staggered start per grid row",
    "Startplatz 1 und 2 fahren sofort los, 3 und 4 etwas später, 5 und 6 noch etwas später – so kommt Luft in die erste Kurve.": "Grid slots 1 and 2 go at once, 3 and 4 a little later, 5 and 6 later still – this leaves room in the first corner.",
    "Ghost: Versatz je Startreihe": "Ghost: delay per grid row",
    "Wie viel später jede weitere Zweierreihe losfährt.": "How much later each further row of two starts.",
    "Ghost: Zu zweit in Kurven innen/Mitte": "Ghost: side by side in corners inside/middle",
    "Fahren zwei Autos nebeneinander in eine Kurve, nimmt das vordere die Innenseite und das hintere die Mitte, statt außen zu fahren und abzufliegen.": "When two cars enter a corner side by side, the front one takes the inside and the rear one the middle, instead of going wide and flying off.",
    "Ghosts (experimentell): Regler „Tempo-Streuung“ (Vorgabe 0 %), Start je Startreihe versetzt (an, 200 ms je Reihe), und zu zweit in Kurven fährt das vordere Auto innen, das hintere in der Mitte (an).": "Ghosts (experimental): \"speed spread\" slider (default 0 %), staggered start per grid row (on, 200 ms per row), and when side by side in corners the front car takes the inside, the rear car the middle (on).",
    "Scan fertig: {n} Teile, Runde geschlossen.": "Scan done: {n} pieces, lap closed.",
    "STRECKE GESCANNT: {n} TEILE": "TRACK SCANNED: {n} PIECES",
    "1 Ergebnis": "1 result",
    "{n} Ergebnisse": "{n} results",
    "Streckenscan langsamer (auch in der Haarnadel), das Auto hält am Ende an; der Live-Scan erkennt das Rundenende selbst. Reiter wechseln per Wischen nach links/rechts. Kein Neuladen mehr durch Herunterziehen. Challenges zeigen „X Ergebnisse“. Cockpit: Rundenzeiten doppelt so groß, Sound- und Start-Knopf rechts entfernt.": "Track scan slower (also in the hairpin), the car stops at the end; the live scan detects the end of the lap itself. Swipe left/right switches tabs. Pulling down no longer reloads. Challenges show \"X results\". Cockpit: lap times twice as large, sound and start buttons on the right removed.",
    "Obere Reiterleiste deutlich höher (PC 40 px, Handy 46 px), gut zum Tippen. Meine Strecken: Ton beim Laden, rundes Löschen-Kreuz mit Rückfrage. Ghosts halten wieder den gemessenen Abstand (1,2 Kacheln, mehr über „Feld-Abstand“). Knockout und Derby als experimentell gekennzeichnet, Texte übersetzt.": "Top tab bar much taller (PC 40 px, phone 46 px), easy to tap. My tracks: sound when loading, round delete cross with confirmation. Ghosts keep the measured gap again (1.2 tiles, more via \"field spacing\"). Knockout and Derby marked experimental, texts translated.",
    "Fahrzeug-Layout": "Vehicle layout",
    "{n} laden": "Load {n}",
    "Strecke löschen?": "Delete track?",
    "„{n}“ wird gelöscht. Bist du sicher?": "\"{n}\" will be deleted. Are you sure?",
    "Strecke „{n}“ geladen": "Track \"{n}\" loaded",
    "Leben": "Lives",
    "Geister": "Ghosts",
    "Spieler {s}: noch {n} Leben": "Player {s}: {n} lives left",
    "Geist aus": "Ghost out",
    "Du": "You",
    "Aufstellung mit größter Querlage (links/rechts)": "Grid with widest offset (left/right)",
    "Weg": "Path",
    "alte APK": "old APK",
    "geschrieben": "written",
    "wiederholt": "retried",
    "verworfen": "dropped",
    "Mehrspieler: „Rennen für alle“ repariert. Der Bereitschaftsschirm erscheint jetzt auf jedem Reiter, inaktive oder abgemeldete Telefone blockieren den Start nicht mehr, Abbrechen löscht nicht mehr die Wertung aller, und das angekündigte Wetter gilt auch beim Start. App: schnellerer, stabilerer direkter Steuerweg zum Auto (neue APK nötig).": "Multiplayer: \"Race for everyone\" fixed. The ready screen now appears on every tab, inactive or departed phones no longer block the start, cancelling no longer wipes everyone's standings, and the announced weather also applies at the start. App: faster, more stable direct control path to the car (new APK needed).",
    "Rennen für alle: bereit?": "Race for everyone: ready?",
    "du": "you",
    "startet": "starts",
    "wartet …": "waiting …",
    "Alle bereit, du kannst starten.": "Everyone is ready, you can start.",
    "Warte, bis alle anderen bereit sind.": "Waiting until everyone else is ready.",
    "Du bist bereit. Warte, bis gestartet wird.": "You are ready. Wait for the start.",
    "Tippe auf „Bereit“, sobald du soweit bist.": "Tap \"Ready\" as soon as you are set.",
    "Zweite Kopie der App: Die Download-Links zeigen auf deren eigenes Release (mit Download-Zähler), sonst auf die APK im Repo.": "Second copy of the app: download links point to its own release (with download counter), otherwise to the APK in the repo.",
    "neu morgen": "new tomorrow",
    "neu in {n} Tagen": "new in {n} days",
    "Kurzer Kurs mit {n} Teilen: Rhythmus finden, jede Kurve zählt.": "Short track with {n} pieces: find the rhythm, every corner counts.",
    "Langer Kurs mit {n} Teilen, die längste Gerade hat {g} Teile: dort Anlauf holen.": "Long track with {n} pieces, the longest straight has {g} pieces: build up speed there.",
    "Stadtkurs mit beiden Haarnadeln: spät bremsen, eng einlenken, sauber raus.": "Street circuit with both hairpins: brake late, turn in tight, exit cleanly.",
    "Schneller Kurs: die weiten 30-Grad-Bögen gehen fast voll, die engen Kurven entscheiden.": "Fast track: the wide 30-degree arcs are nearly flat out, the tight corners decide.",
    "Neue Strecke morgen": "New track tomorrow",
    "Neue Strecke in {n} Tagen": "New track in {n} days",
    "Woche": "Week",
    "Challenges: Wochenstrecken. Vier Kategorien (A kurz, B lang, C Haarnadel, D 30°) mit je 20 Strecken, jeden Mittwoch um 0:00 Uhr (deutsche Zeit) kommt je Kategorie die nächste, nach 20 Wochen von vorn. Bestenlisten bleiben je Strecke erhalten. Die Kacheln zeigen, wann die nächste Strecke kommt.": "Challenges: weekly tracks. Four categories (A short, B long, C hairpin, D 30°) with 20 tracks each, every Wednesday at 0:00 (German time) each category gets the next one, starting over after 20 weeks. Leaderboards are kept per track. The tiles show when the next track arrives.",
    "Rundenzeit-Ansage jetzt auch in der App: Dort fehlt die Sprachausgabe des Browsers, deshalb liest die App die Zeit aus Aufnahmen vor (Zahlen 0–60, erzeugt mit Piper TTS, Stimmen „Thorsten“ und „LJ Speech“).": "Lap time announcement now also in the app: the browser speech output is missing there, so the app reads the time from recordings (numbers 0–60, made with Piper TTS, voices \"Thorsten\" and \"LJ Speech\").",
    "Rennen für alle starten": "Start race for everyone",
    "Rennen für alle: Ampel kommt gleich": "Race for everyone: lights coming up",
    "Erst mitmachen, dann für alle starten.": "Join first, then start for everyone.",
    "Rennen für alle: Ampel in ": "Race for all: lights in ",
    "Rennen für alle: alle bereit machen, dann startet der Host.": "Race for all: everyone ready up, then the host starts.",
    "Start für alle fehlgeschlagen": "Starting for everyone failed",
    "Der Host kennt das noch nicht, Host bzw. APK aktualisieren": "The host does not support this yet, update the host or APK",
    "Rennen für alle gestartet, die Ampel kommt in wenigen Sekunden.": "Race started for everyone, the lights come in a few seconds.",
    "Mehrspieler-Rennen": "Multiplayer race",
    "Für alle zugleich starten (gemeinsame Ampel, gleiches Wetter) oder nur für dich?": "Start for everyone at once (shared lights, same weather) or just for you?",
    "Für alle": "For everyone",
    "Nur ich": "Just me",
    "Mehrspieler (experimentell): „Rennen für alle starten“ zeigt auf allen Telefonen einen Bereitschaftsschirm. Jeder tippt „Bereit“; erst wenn alle anderen bereit sind, kann der Initiator starten. Dann übernehmen alle Renntyp, Länge und einen gemeinsamen Wetterplan, und die Ampel kommt überall gleichzeitig (Uhrabgleich mit dem Host). „Rennen starten“ fragt im Mehrspieler: für alle oder nur ich. Für den Telefon-Host braucht es die neue APK.": "Multiplayer (experimental): \"Start race for everyone\" shows a ready screen on all phones. Everyone taps \"Ready\"; only when all others are ready can the initiator start. Then all phones take over race type, length and a shared weather plan, and the lights come on everywhere at the same time (clock sync with the host). \"Start race\" asks in multiplayer: for everyone or just me. The phone host needs the new APK.",
    "Funk-Rundlauf": "Radio round trip",
    "Wie lange ein Steuerbefehl bis zur Bestätigung durch das Bluetooth braucht: Mittelwert und 95 % der Befehle. Über 45 ms fällt jeder zweite Befehl aus dem Takt. Hängende Befehle gibt der Wachhund nach 300 ms frei. In der App auf einem älteren Handy hilft oft, „Android System WebView“ im Play Store zu aktualisieren.": "How long a control command takes until Bluetooth confirms it: average and 95 % of commands. Above 45 ms every second command misses its slot. Hanging commands are released by the watchdog after 300 ms. In the app on an older phone, updating \"Android System WebView\" in the Play Store often helps.",
    "noch keine Befehle": "no commands yet",
    "Renntyp": "Race type",
    "Knöpfe gedrückt:": "Buttons pressed:",
    "ohne Standardbelegung": "no standard mapping",
    "Controller ohne Standardbelegung": "Controller without standard mapping",
    "Dieser Controller meldet eigene Knopfnummern. Wechseln L1/R1 die Reiter nicht, weise sie unter Optionen > Controller neu zu: bei „Reifenwahl weiter“ und „Tankmenge weiter“ auf Neu zuweisen tippen und L1 bzw. R1 drücken.": "This controller reports its own button numbers. If L1/R1 do not switch tabs, reassign them under Options > Controller: tap Reassign at \"Tyre choice next\" and \"Fuel amount next\" and press L1 or R1.",
    "Zur Controller-Seite": "To the controller page",
    "Später": "Later",
    "Funk: ein Schloss je Auto mit Wachhund; ein hängender Befehl blockiert kein Auto mehr (Ursache für „Auto reagiert nach Mehrspieler-Beitritt nicht“). In der App: kurzes Timeout, erst senden, dann das Cockpit gedrosselt malen, weniger Arbeit je Meldung; Messanzeige „Funk-Rundlauf“ unter System. Steuerkreuz: Renntyp in den Renneinstellungen und im Cockpit direkt mit links/rechts, am Rand der Renntyp-Kachel schaltet es, Zurück und Rennen starten erreichbar, Info-Screen schließt mit ○. Ohne Zwei-Spieler-Modus fährt das zuletzt benutzte Pad; „Controller tauschen“ legt ein einzelnes Pad nicht mehr lahm. Controller ohne Standardbelegung: Hinweis und Anzeige der gedrückten Knöpfe.": "Radio: one lock per car with a watchdog; a hanging command no longer blocks a car (the cause of \"car does not react after joining multiplayer\"). In the app: short timeout, send first, then paint the cockpit throttled, less work per message; \"Radio round trip\" readout under System. D-pad: race type in race settings and in the cockpit directly with left/right, the edge of the race type tile switches it, Back and Start race reachable, info screen closes with ○. Without two-player mode the last used pad drives; \"Swap controllers\" no longer disables a single pad. Controllers without standard mapping: hint and a readout of pressed buttons.",
    "Voller Einschlag bei": "Full lock at",
    "Ab welchem Stickweg der volle Lenkeinschlag erreicht ist, in beide Richtungen gleich. Darunter lenkt der Stick schon; mit einer Lenkkennlinie über 1 am Anfang schwächer als linear, mit 1 genau linear. Lenkansprechen trimmt das nur noch fein, die Lenkkalibrierung verschiebt den Punkt nicht.": "At which stick travel full steering lock is reached, the same in both directions. Below it the stick already steers; with a steering curve above 1 weaker than linear at first, with 1 exactly linear. Steering response only fine-tunes it, steering calibration does not move the point.",
    "Gas-, Brems- und Lenkkennlinie ab Werk 2,45. Neu: „Voller Einschlag bei“ (Vorgabe 90 % Stickweg, experimentell), darunter lenkt der Stick schon, am Anfang schwächer als linear; Lenkkalibrierung verschiebt den Punkt nicht mehr. Wer noch auf den alten Vorgaben stand, bekommt die neuen einmalig; eigene Werte bleiben.": "Throttle, brake and steering curves default to 2.45. New: \"Full lock at\" (default 90 % stick travel, experimental), below it the stick already steers, weaker than linear at first; steering calibration no longer moves the point. Anyone still on the old defaults gets the new ones once; your own values stay.",
    "Modus umschalten": "Switch mode",
    "Preset umschalten": "Switch preset",
    "Pflichtstopp fehlt": "Mandatory pit stop missing",
    "Pflichtstopp: einmal an die Box (Boxen-Minigame), egal wo.": "Mandatory stop: pit once (pit minigame), anywhere.",
    "Frühstart!": "Jump start!",
    "Frühstart Spieler {n}!": "Jump start player {n}!",
    "Frühstart: Strafe": "Jump start: penalty",
    "Frühstart Spieler {n}: Strafe": "Jump start player {n}: penalty",
    "Challenges: Einstellungen unter der Streckenkarte, Bestenliste rechts; Modus und Preset schaltet ✕ um. Frühstart bei allen Starts mit Ampel: kein Abbruch mehr, sondern kurz ausgebremst, sobald das Auto nach Grün fährt. Silverbrook-Rennen mit einem Pflichtstopp (Boxen-Minigame, egal wo).": "Challenges: settings below the track map, leaderboard on the right; ✕ switches mode and preset. Jump start on every start with lights: no more abort, instead a short forced braking once the car moves after green. Silverbrook race with one mandatory pit stop (pit minigame, anywhere).",
    "Titel-Glitch je Buchstabe zufällig blau oder rot, oben und unten getrennt. „Abseits“ erscheint jetzt groß in der Mitte des Cockpits. Autos-Kachel zeigt wieder den Namen statt „[object HTMLSpanElement]“. Boxen-Minigame: Tasten stehen 100 ms länger.": "Title glitch randomly blue or red per letter, top and bottom separately. \"Off track\" now appears large in the middle of the cockpit. The cars tile shows the name again instead of \"[object HTMLSpanElement]\". Pit minigame: buttons stay 100 ms longer.",
    "Runde {n}: {a} von {b} Teilen erkannt, zählt nicht": "Lap {n}: {a} of {b} pieces recognised, does not count",
    "Runde {n} unter der Mindestzeit, zählt nicht": "Lap {n} below the minimum time, does not count",
    "Einstellungen geändert, Challenge abgebrochen": "Settings changed, challenge aborted",
    "Einstellungen während der Challenge geändert": "Settings changed during the challenge",
    "Runde {n}: Strecke nicht erkannt": "Lap {n}: track not recognised",
    "Runde {n} unter der Mindestzeit": "Lap {n} below the minimum time",
    "keine gültige Runde: Strecke nicht erkannt oder unter der Mindestzeit": "no valid lap: track not recognised or below the minimum time",
    "Mindestrunde": "Minimum lap",
    "Spieler": "Players",
    "Gefahrene Strecke": "Distance driven",
    "Noch keine 3er-Serie": "No 3-lap series yet",
    "Ergebnis hochgeladen.": "Result submitted.",
    "Ergebnis konnte nicht hochgeladen werden – steht nur lokal.": "Result could not be submitted – it is only stored locally.",
    "Ergebnis wird hochgeladen …": "Submitting result …",
    "Jede Runde wird gegen die Strecke geprüft: mindestens 90 % der Teile müssen erkannt werden. Einstellungen sind gesperrt.": "Every lap is checked against the track: at least 90 % of the pieces must be recognised. Settings are locked.",
    "Während der Challenge gesperrt": "Locked during the challenge",
    "Während einer Challenge sind die Einstellungen gesperrt.": "Settings are locked during a challenge.",
    "Challenges gegen Schummeln: jede Runde wird gegen die Strecke geprüft (mindestens 90 % der Teile erkannt), eine plausible Mindestrundenzeit gilt in App und Bestenliste, und die Einstellungen sind während des Laufs gesperrt; wer sie doch ändert, bricht ab.": "Challenges against cheating: every lap is checked against the track (at least 90 % of the pieces recognised), a plausible minimum lap time applies in the app and the leaderboard, and settings are locked during the run; changing them anyway aborts it.",
    "Installiere die Android App für Mehrspieler": "Install the Android app for multiplayer",
    "Titelseite im Browser: Link zum Download der neuesten Android-App. Die APK-Release hängt dafür zusätzlich eine Datei mit festem Namen an; die Android-Schicht ist unverändert, neu installieren ist nicht nötig.": "Title page in the browser: link to download the newest Android app. The APK release now also attaches a file with a fixed name; the Android layer is unchanged, no reinstall needed.",
    "Zurück zum Menü": "Back to menu",
    "Zurück zum Menü (Options, Esc)": "Back to menu (Options, Esc)",
    "Name in der Bestenliste": "Name on the leaderboard",
    "Auto: {auto}": "Car: {auto}",
    "Dieser Name erscheint in der Bestenliste. Bitte Namen eintragen.": "This name appears on the leaderboard. Please enter a name.",
    "Bitte zuerst einen Namen eintragen": "Please enter a name first",
    "Starten": "Start",
    "Cockpit immer im Vollbild, der Menü-Knopf dort zeigt jetzt „Zurück“. Reiter oben: Fahren, Mehrspieler, Challenges, Optionen. Die Info-Kacheln stehen direkt in den Optionen unter einer eigenen Überschrift. Challenges: Strecken heißen Monzetta, Suzuna, Monte Carlito und Silverbrook, der Name für die Bestenliste lässt sich auf jeder Strecken-Seite festlegen, das Perzentil zählt je Spieler. Neue Kachel- und Hintergrundbilder im Fahren-Menü.": "Cockpit always in full screen, its menu button now shows \"back\". Top tabs: Drive, Multiplayer, Challenges, Options. The info tiles sit directly in the options under their own heading. Challenges: tracks are called Monzetta, Suzuna, Monte Carlito and Silverbrook, the leaderboard name can be set on every track page, the percentile counts per player. New tile and background images in the Drive menu.",
    "Stand": "as of",
    "Challenges: die Bestenliste kommt aus einem stündlichen Schnappschuss im Repo, dazu sofort die eigenen Zeiten; das Hochladen wiederholt bei Aussetzern.": "Challenges: the leaderboard comes from an hourly snapshot in the repo, plus your own times right away; uploading retries on dropouts.",
    "Challenges: gemeinsame Online-Bestenliste ab Werk eingetragen, für alle Kopien der App.": "Challenges: shared online leaderboard set up by default, for all copies of the app.",
    "Challenges (experimentell): vier feste Strecken, je beste Runde oder Rennen über feste Runden, im Pro-Preset. Das Auto muss stehen, dann Ampel, dann los; ohne Ghosts, danach sind die eigenen Einstellungen wieder da. Bestenliste mit Histogramm und Perzentil, lokal und online über ein eigenes Google Sheet.": "Challenges (experimental): four fixed tracks, each as best lap or a race over fixed laps, in the Pro preset. The car must stand still, then start lights, then go; no ghosts, and your own settings come back afterwards. Leaderboard with histogram and percentile, locally and online via your own Google Sheet.",
    "Grundpackung · 10 Runden": "Basic set · 10 laps",
    "Grundpackung · 8 Runden": "Basic set · 8 laps",
    "Grundpackung und Haarnadel-Set · 8 Runden": "Basic set and hairpin set · 8 laps",
    "Grundpackung und 30°-Außenkurven-Set · 8 Runden": "Basic set and 30° outer curve set · 8 laps",
    "Vorgabe ist die gemeinsame OmegaSim-Bestenliste. Wer eine eigene will: die Adresse, die Google beim Bereitstellen des Apps Script anzeigt (endet auf /exec), Anleitung in tools/challenges-apps-script.gs. Feld leer lassen heißt: nur lokal.": "The default is the shared OmegaSim leaderboard. For your own: the address Google shows when you deploy the Apps Script (ends in /exec), instructions in tools/challenges-apps-script.gs. Leave the field empty for local only.",
    "Höchstens 16 Zeichen, frei wählbar. Leer lassen geht auch, dann steht nur das Auto in der Liste.": "At most 16 characters, your choice. You can leave it empty, then only the car appears in the list.",
    "Gewertete Zeiten gehen an die Liste: Strecke, Modus, Preset, Zeit, Rundenzeiten, Autoname, dein Name und eine zufällige Gerätekennung. Keine E-Mail, kein Konto.": "Counted times go to the list: track, mode, preset, time, lap times, car name, your name and a random device ID. No e-mail, no account.",
    "Adresse der Web-App": "Web app address",
    "Dein Name in der Liste": "Your name in the list",
    "Zeiten hochladen": "Upload times",
    "Verbindung testen": "Test connection",
    "Online-Bestenliste": "Online leaderboard",
    "Gemeinsame Bestenliste über ein Google Sheet.": "Shared leaderboard via a Google Sheet.",
    "Network": "Network",
    "Online Settings": "Online Settings",
    "Wöchentliche Challenges": "Weekly challenges",
    "Dauerrennen": "Endurance races",
    "Dauerrennen über {n} Teile: Ausdauer und saubere Runden zählen, die längste Gerade hat {g} Teile.": "Endurance race over {n} pieces: stamina and clean laps count, the longest straight has {g} pieces.",
    "Beste Runde": "Best lap",
    "Bestenliste": "Leaderboard",
    "Challenge starten": "Start challenge",
    "Erst das laufende Rennen beenden": "Finish the current race first",
    "Für eine Challenge muss dein Auto verbunden sein. Ein Probelauf ohne Auto zeigt den Ablauf, wird aber nicht gewertet.": "A challenge needs your car to be connected. A trial run without a car shows the procedure but is not counted.",
    "Probelauf": "Trial run",
    "Auto auf Start/Ziel stellen und anhalten": "Put the car on start/finish and stop",
    "Auto anhalten": "Stop the car",
    "Frühstart! Challenge abgebrochen": "Jump start! Challenge aborted",
    "Challenge abgebrochen": "Challenge aborted",
    "Challenge beendet": "Challenge finished",
    "Gesamtzeit": "Total time",
    "Bronze": "Bronze",
    "Silber": "Silver",
    "Gold": "Gold",
    "bis {zeit}": "up to {zeit}",
    "gefahren": "completed",
    "TOP {x} %": "TOP {x} %",
    "Nicht gewertet": "Not counted",
    "Frühstart": "Jump start",
    "abgebrochen, nicht alle Runden gefahren": "aborted, not all laps driven",
    "keine volle Runde": "no complete lap",
    "Probelauf ohne Auto": "Trial run without a car",
    "Ergebnis ansehen": "View result",
    "Nochmal": "Again",
    "Du warst schneller als {p} % der Spieler.": "You were faster than {p} % of players.",
    "Schneller als {p} % deiner eigenen Läufe.": "Faster than {p} % of your own runs.",
    "Platz {a} von {b}.": "Place {a} of {b}.",
    "Zum Warmwerden: lange Gerade, ein kleiner Knick nach links, Bremspunkte lernen.": "To warm up: a long straight, a small kink to the left, learn your braking points.",
    "Die zwei Linkskurven bilden ein S. Wer dort sauber umlenkt, gewinnt.": "The two left curves form an S. Whoever switches direction cleanly there wins.",
    "Zwei Haarnadeln direkt hintereinander als enges S: voll in die Bremse, umlegen, sauber raus.": "Two hairpins right after each other as a tight S: brake hard, switch over, exit cleanly.",
    "Lang und schmal: die weiten 30-Grad-Bögen machen die Längsseiten schnell.": "Long and narrow: the wide 30-degree arcs make the long sides fast.",
    "Platzbedarf": "Space",
    "Grundpackung": "Basic set",
    "Haarnadel-Set": "Hairpin set",
    "30°-Außenkurven-Set": "30° outer curve set",
    "So viele Runden du willst, die schnellste zählt. Schluss mit der Rennen-Taste (R1).": "As many laps as you like, the fastest counts. Finish with the race button (R1).",
    "{n} Runden ab stehendem Start, die Gesamtzeit zählt.": "{n} laps from a standing start, the total time counts.",
    "Tipp: Unter Strecke > Meine Teile eintragen, was du hast, dann prüft die App hier, ob alles da ist.": "Tip: enter what you own under Track > My parts, then the app checks here whether everything is there.",
    "Challenge abbrechen": "Abort challenge",
    "Lade Bestenliste …": "Loading leaderboard …",
    "Zeiten": "times",
    "Online-Bestenliste nicht erreichbar, hier stehen deine eigenen Zeiten.": "Online leaderboard not reachable, showing your own times.",
    "Noch keine Zeiten eingetragen. Fahr die Challenge, dann erscheint deine Zeit hier.": "No times submitted yet. Run the challenge and your time will appear here.",
    "Deine Zeiten auf diesem Gerät. Für die gemeinsame Liste unter Challenges > Online eine Adresse eintragen.": "Your times on this device. For the shared list, enter an address under Challenges > Online.",
    "Erst die Adresse eintragen.": "Enter the address first.",
    "Prüfe …": "Checking …",
    "Verbunden.": "Connected.",
    "Zeiten auf der Liste.": "times on the list.",
    "Keine Verbindung": "No connection",
    "Logos aus den KI-Bildern entfernt, die Credits nennen die KI-Bilder (Gemini Flash). Reiter am Handy doppelt so hoch. Die Zurück-Taste des Handys führt zum Startbildschirm (in der App ab APK 0.8.29). Editor: Asphalt im Hintergrund, Teile nach Typ getrennt, Schalter für Ideallinie und Tastenkürzel.": "Logos removed from the AI images, the credits name the AI images (Gemini Flash). Tabs on phones twice as tall. The phone's back button leads to the title screen (in the app from APK 0.8.29). Editor: asphalt in the background, pieces separated by type, toggles for racing line and shortcuts.",
    "Woher die Bilder kommen": "Where the images come from",
    "Einige Bilder im Menü (Titel, Rennen, Start, Strecke, Optionen, Info, Challenges und Box) wurden mit KI generiert (Gemini Flash). Markenlogos darin sind entfernt. Die übrigen Bilder sind eigene Fotos.": "Some images in the menu (title, race, start, track, options, info, challenges and pit) were generated with AI (Gemini Flash). Brand logos in them have been removed. The other images are my own photos.",
    "Linie": "Line",
    "Ideallinie anzeigen": "Show racing line",
    "Tastenkürzel anzeigen": "Show shortcuts",
    "Strecke aufgeräumt: Editor, Scan, Laden, Meine Teile und Ausdruck haben je eine eigene Seite. Der Editor startet im Vollbild, mit Tutorial und Tastenübersicht: Teile anwählen, mittendrin einfügen und entfernen, rückgängig, in 45°-Schritten drehen, Länge in Metern und im Maßstab 1:50, Pfeile an den Kanten in Fahrtrichtung. Meine Teile (experimentell) zählt deinen Bestand und zeigt im Editor, was fehlt oder übrig ist. Challenges: Plan und Mock-up mit vier Strecken, je beste Runde und Rennen.": "Track tab tidied up: editor, scan, load, my parts and printout each have their own page. The editor starts in full screen, with a tutorial and key overview: select pieces, insert and remove in the middle, undo, rotate in 45° steps, length in metres and at 1:50 scale, arrows on the edges in driving direction. My parts (experimental) counts your inventory and shows in the editor what is missing or left over. Challenges: plan and mock-up with four tracks, each with best lap and race.",
    "Editor starten": "Start editor",
    "Meine Teile": "My parts",
    "Wie viele Teile du von jeder Sorte hast. Der Editor zeigt, was fehlt.": "How many parts of each kind you own. The editor shows what is missing.",
    "Strecke aus Teilen bauen, ändern, drehen und als Code weitergeben.": "Build a track from parts, change it, rotate it and share it as a code.",
    "Bau deine Strecke aus Teilen: auswählen, einfügen, entfernen, drehen. Gebaut wird im Vollbild, mit Controller, Tastatur oder Maus.": "Build your track from parts: select, insert, remove, rotate. Building happens in full screen, with controller, keyboard or mouse.",
    "Die Hex-Codes stimmen noch nicht für alle Streckenteile. Die Schikane zum Beispiel scannt das Auto nicht richtig.": "The hex codes are not correct for all track parts yet. The chicane, for example, is not scanned correctly by the car.",
    "Trag ein, was du im Karton hast. Der Editor zeigt dann, was übrig ist und was fehlt. Leer lassen heißt: nicht gezählt.": "Enter what is in your box. The editor then shows what is left over and what is missing. Left empty means: not counted.",
    "+ Grundpackung": "+ Basic pack",
    "+ Linkskurven-Set": "+ Left-curve set",
    "+ Haarnadel-Set": "+ Hairpin set",
    "+ 30°-Außenkurven-Set": "+ 30° outer curve set",
    "+ Engstelle": "+ Narrow section",
    "Alles auf 0": "All to 0",
    "Raumgröße (m)": "Room size (m)",
    "Breite": "Width",
    "Tiefe": "Depth",
    "Breite weniger": "Less width",
    "Breite mehr": "More width",
    "Tiefe weniger": "Less depth",
    "Tiefe mehr": "More depth",
    "Zufall: Raum zu klein für einen Rundkurs": "Random: Room too small for a lap",
    "Entfernen": "Remove",
    "45° L": "45° L",
    "45° R": "45° R",
    "Hilfe": "Help",
    "Gewähltes Teil entfernen": "Remove the selected part",
    "Rückgängig": "Undo",
    "Tutorial zum Editor": "Editor tutorial",
    "Start/Ziel bleibt": "Start/finish stays",
    "Nichts rückgängig zu machen": "Nothing to undo",
    "Länge": "Length",
    "Fehlt": "Missing",
    "Alle Teile da": "All parts there",
    "übrig": "left over",
    "Zufall: Kein Startteil vorhanden": "Random: No start piece available",
    "Zufall: Nicht genug Kurventeile für einen Rundkurs": "Random: Not enough curve pieces for a circuit",
    "Zufall: Nicht genug Geraden": "Random: Not enough straights",
    "Zufall: Strecke schließt nicht – bitte erneut versuchen": "Random: Track does not close – please try again",
    "Zufällige Strecke gebaut": "Random track built",
    "Zufall: Keine neue Variante möglich": "Random: No new variation possible",
    "Zufall: Keine Streckenteile": "Random: No track parts",
    "Erst die Streckenteile eingeben": "Enter track parts first",
    "Teile eingeben": "Enter track parts",
    "Zufällige Strecke aus den vorhandenen Teilen bauen": "Build a random track from the available pieces",
    "Zufall": "Random",
    "✕/Enter einfügen · □/Entf entfernen · L1 R1/Q E Teil wählen · △/R drehen · ○/Z zurück · L3/Esc schließen": "✕/Enter insert · □/Del remove · L1 R1/Q E select part · △/R rotate · ○/Z undo · L3/Esc close",
    "Der Streckeneditor": "The track editor",
    "Hier baust du deine Strecke nach. Oben die Aktionen, in der Mitte die Karte, unten die Teile.": "Rebuild your track here. Actions at the top, the map in the middle, the parts at the bottom.",
    "Teil auswählen": "Select a part",
    "L1 und R1 (Tastatur Q und E) wählen das vorige oder nächste Teil. Tippen auf die Karte geht auch. Das gewählte Teil ist gelb.": "L1 and R1 (keyboard Q and E) select the previous or next part. Tapping the map works too. The selected part is yellow.",
    "Teil einfügen": "Insert a part",
    "Wähl unten ein Teil mit dem Steuerkreuz und drück Kreuz (Enter). Es kommt hinter das gewählte Teil.": "Pick a part at the bottom with the D-pad and press cross (Enter). It goes behind the selected part.",
    "Teil entfernen": "Remove a part",
    "Quadrat (Entf) nimmt das gewählte Teil heraus. Start und Ziel bleiben immer.": "Square (Del) takes out the selected part. Start/finish always stays.",
    "Dreieck (R) dreht die ganze Strecke um 45 Grad, mit Umschalt andersherum.": "Triangle (R) rotates the whole track by 45 degrees, with Shift the other way.",
    "Kreis (Z) nimmt die letzte Änderung zurück, auch mehrmals.": "Circle (Z) takes back the last change, also several times.",
    "Länge und Teile": "Length and parts",
    "Oben steht die Länge in Metern und im Maßstab 1:50. Hast du unter Meine Teile deinen Karton eingetragen, siehst du hier, was fehlt.": "At the top you see the length in metres and at 1:50 scale. If you entered your box under My parts, you see here what is missing.",
    "L3 oder Esc schließt den Editor. Die Strecke bleibt, speichern kannst du sie unter Strecke laden.": "L3 or Esc closes the editor. The track stays; you can save it under Load track.",
    "Kopfzeile nochmals flacher, Omega oben links führt zum Startbildschirm, Info unter Optionen, neuer Reiter Challenges (WIP). Tutorial-Texte kürzer; Steuerung läuft auf dem Cockpit, zeigt gedrückte Tasten und fährt dabei nicht. Neue Stimmungsbilder (KI) für Titel, Rennoptionen, Start, Strecke, Optionen, Info und Challenges.": "Header even flatter, the omega at the top left leads to the title screen, Info under Options, new Challenges tab (WIP). Shorter tutorial texts; the controls guide runs on the cockpit, shows pressed buttons and does not drive meanwhile. New mood pictures (AI) for title, race options, start, track, options, info and challenges.",
    "OmegaSim steuert deine Carrera-Hybrid-Autos per Bluetooth. Mit echter Fahrphysik, simuliertem Motorsound und einem Cockpit wie im Rennsimulator.": "OmegaSim drives your Carrera Hybrid cars over Bluetooth. With real driving physics, simulated engine sound and a cockpit like a racing sim.",
    "Verbinde hier dein Auto. Das erste steuerst du selbst, jedes weitere fährt als Ghost gegen dich. Namen, Farben und Fotos stellst du in der Garage ein.": "Connect your car here. You drive the first one yourself, every other one races you as a ghost. Names, colours and photos are set in the garage.",
    "Auf der Bahn liest das Auto die Schiene. Scanne deine Strecke oder bau sie im Editor nach. Ohne Bahn druckst du Vorlagen aus.": "On the rail the car reads the track. Scan your layout or rebuild it in the editor. Without a rail you print templates.",
    "Training, Qualifying, Rennen oder Endurance. Dazu Wetter, Pflichtstopps, Tank und Reifenverschleiß.": "Practice, qualifying, race or endurance. Plus weather, mandatory stops, fuel and tyre wear.",
    "Ein Druck startet die Ampel. Im Cockpit fordert Kreuz den Boxenstopp an, Options öffnet das Menü.": "One press starts the lights. In the cockpit cross requests a pit stop, Options opens the menu.",
    "Beim Stopp erscheinen zehn Tasten. Triffst du Quadrat oder Kreis rechtzeitig, ist die Crew schneller fertig. Abschalten kannst du es unter Optionen, Allgemein, Tank & Schaden.": "During the stop ten buttons appear. Hit square or circle in time and the crew is done sooner. You can switch it off under Options, General, Fuel & damage.",
    "Mehrere Telefone fahren in einer gemeinsamen Rangliste. Ein Tablet zeigt als Info-Screen Strecke und Zeiten.": "Several phones race in one shared leaderboard. A tablet shows the track and times as an info screen.",
    "Verbinde jetzt dein erstes Auto. Zum Tutorial kommst du jederzeit zurück: Klick auf das Omega oben links.": "Connect your first car now. You can get back to the tutorial any time: click the omega at the top left.",
    "Diese Führung gilt nur mit Gamepad (PS5, PS4 oder Xbox). Drück ruhig die Tasten, die Karte zeigt, was du drückst. Weiter mit dem Steuerkreuz nach rechts.": "This guide only applies to a gamepad (PS5, PS4 or Xbox). Go ahead and press the buttons, the card shows what you press. Next with the D-pad to the right.",
    "Steuerung beim Fahren": "Controls while driving",
    "R2 gibt Gas, L2 bremst. Je tiefer du drückst, desto stärker.": "R2 accelerates, L2 brakes. The deeper you press, the stronger.",
    "Gas und Bremse": "Throttle and brake",
    "Der linke Stick lenkt.": "The left stick steers.",
    "Lenken": "Steering",
    "Kreis schaltet hoch, Quadrat runter. Im Stand geht Quadrat bis in den Rückwärtsgang.": "Circle shifts up, square down. At a standstill square goes down to reverse.",
    "Schalten": "Shifting",
    "Kreuz tippen fordert den Boxenstopp an. Eine Sekunde halten zeigt die gelbe Flagge.": "Tap cross to request a pit stop. Hold it for one second for the yellow flag.",
    "Boxenstopp und Flagge": "Pit stop and flag",
    "L1 wählt die Reifen, R1 die Tankmenge für den nächsten Stopp.": "L1 picks the tyres, R1 the fuel for the next stop.",
    "Boxenstopp vorwählen": "Preselect the pit stop",
    "Dreieck schaltet das Licht, R3 gibt Lichthupe.": "Triangle switches the lights, R3 flashes them.",
    "Licht": "Lights",
    "Das Steuerkreuz blättert die Schirme: Box, Rennen, Einstellungen. Hier blättert es die Schritte.": "The D-pad pages through the screens: pit, race, settings. Here it pages through the steps.",
    "Cockpit-Schirme": "Cockpit screens",
    "Options öffnet das Fahren-Menü und bringt dich zurück ins Cockpit.": "Options opens the drive menu and takes you back to the cockpit.",
    "L3 schaltet das Vollbild, Share wechselt zwischen Bahn und Ausdruck.": "L3 toggles full screen, Share switches between track and printout.",
    "Vollbild und Lesemodus": "Full screen and reading mode",
    "Hier siehst du alle Tasten. Mit „Neu zuweisen“ belegst du jede Funktion um.": "Here you see all buttons. With “Reassign” you can remap every function.",
    "Gedrückt": "Pressed",
    "Challenges": "Challenges",
    "Zum Startbildschirm": "To the title screen",
    "Wozu, Funktionen, Danksagungen, Patchnotes, Rechtliches.": "Purpose, features, credits, patch notes, legal.",
    "Mock-up ansehen": "View the mock-up",
    "Garage als Karten mit eigenem Foto je Auto (sonst seine Farbe), Rolle mit ◀ ▶, Einstellen klappt Farbe, Tempo und Charakter auf; ein Knopf startet und hält die Ghosts. Titel: ✕ startet, △ Tutorial, ○ neue Führung „Steuerung“ bis zur Controller-Belegung. Minigame: Fenster 0,1 s länger, falsche Taste kostet Zeit. Freies Training zeigt ∞. Mehrspieler-App wie Vorschlag A. App: Status- und Navigationsleiste werden zuverlässiger ausgeblendet.": "Garage as cards with your own photo per car (otherwise its colour), role with ◀ ▶, Settings expands colour, pace and character; one button starts and stops the ghosts. Title: ✕ starts, △ tutorial, ○ new “Controls” guide leading to the controller mapping. Minigame: windows 0.1 s longer, a wrong button costs time. Free practice shows ∞. Multiplayer app page like proposal A. App: status and navigation bars are hidden more reliably.",
    "Foto ändern": "Change photo",
    "Einstellen ▾": "Settings ▾",
    "Einstellen ▴": "Settings ▴",
    "Ghosts starten": "Start ghosts",
    "Abstimmung und Fahrgefühl stehen unten und unter Optionen.": "Setup and driving feel are below and under Options.",
    "Tempo und Charakter gibt es nur für Ghosts.": "Pace and character are only for ghosts.",
    "FAHRER": "DRIVER",
    "SPIELER 2": "PLAYER 2",
    "GHOST": "GHOST",
    "AUS": "OFF",
    "DU": "YOU",
    "Steuerung mit dem Controller": "Controls with the controller",
    "Gas, Bremse, Lenkung": "Throttle, brake, steering",
    "Kreuz": "Cross",
    "Kreis und Quadrat": "Circle and square",
    "Dreieck": "Triangle",
    "Schultertasten": "Shoulder buttons",
    "Steuerkreuz und rechter Stick": "D-pad and right stick",
    "Options, Share und L3": "Options, Share and L3",
    "Alle Tasten und die Belegung": "All buttons and the mapping",
    "Steuerung": "Controls",
    "Fertig": "Done",
    "Mehrspieler ist aktuell noch in der Entwicklung und funktioniert nicht fehlerfrei.": "Multiplayer is still in development and does not work without faults yet.",
    "Willkommen bei OmegaSim": "Welcome to OmegaSim",
    "Deine Strecke": "Your track",
    "Boxenstopp als Minigame": "The pit stop as a minigame",
    "WLAN Mehrspieler und Info-Screen": "WIFI Multiplayer and info screen",
    "Los geht's": "Let's go",
    "Tutorial": "Tutorial",
    "Beenden": "Finish",
    "◀ Zurück": "◀ Back",
    "Weiter": "Next",
    "Tutorial auf dem Titelbildschirm (experimentell): führt in neun Schritten über die echten Schirme, mit Controller, Tastatur oder Finger.": "Tutorial on the title screen (experimental): nine steps across the real screens, with controller, keyboard or finger.",
    "Boxenstopp-Modus": "Pit stop mode",
    "Standard: gemacht wird, was geplant ist, und losfahren beendet den Stopp. Minigame: gewechselt wird alles, was simuliert wird – Reifen, Tank voll, Reparatur –, und bis alles fertig ist, kommst du nicht los. In der Mitte erscheinen nacheinander zehn Tasten, Quadrat oder Kreis (Tastatur: K und I). Jede richtig gedrückte kürzt den Stopp um 5 Prozent, alle zehn halbieren ihn; wer nichts drückt, wartet die volle Zeit. Abbrechen: Kreuz tippen.": "Standard: what is planned gets done, and driving off ends the stop. Minigame: everything that is simulated gets changed – tyres, a full tank, repairs –, and you cannot leave until it is all done. Ten buttons appear one after another in the middle, square or circle (keyboard: K and I). Each one pressed correctly cuts the stop by 5 per cent, all ten halve it; if you press nothing, you wait the full time. To abort: tap cross.",
    "Minigame (experimentell)": "Minigame (experimental)",
    "Boxen-Minigame: Quadrat und Kreis!": "Pit minigame: square and circle!",
    "Boxen-Minigame (experimentell, ab Werk an, unter Optionen > Allgemein > Tank & Schaden): alles wird gewechselt, losfahren erst am Ende, zehn Tasten □/○ in der Mitte kürzen den Stopp bis auf die Hälfte.": "Pit minigame (experimental, on by default, under Options > General > Fuel & damage): everything gets changed, you can only leave at the end, ten buttons □/○ in the middle cut the stop down to half.",
    "Menü: Kopf halb so hoch, flachere Knöpfe und Unterreiter, Kachelfotos als Hintergrund gut sichtbar, kleinere Titel, Erklärungen nur noch im ⓘ. Letzte Auswahl je Seite bleibt, nach dem Rennen „Nochmal“, in der Garage blinkt das Auto beim Darüberfahren. Weniger automatische Sprünge: Rennende im Menü nur als Einblendung, grüne Ampel und Vollbild-Ende behalten den Cockpit-Schirm, Options führt zurück auf die Seite, von der man kam.": "Menu: header half as tall, flatter buttons and sub-tabs, tile photos clearly visible as backgrounds, smaller titles, explanations only behind ⓘ. The last selection per page is kept, “Again” after the race, in the garage a car flashes when you point at it. Fewer automatic jumps: race end in a menu only as a banner, green light and leaving fullscreen keep the cockpit screen, Options returns to the page you came from.",
    "Pacejka: Übersteuern spürbar – Vollgas in der Kurve bringt das Heck, der Vortrieb geht zurück, der Rutsch hält ohne Stick, bis man gegenlenkt oder vom Pedal geht, stärkere Vibration; mit dem Schalter „Übersteuern“ abschaltbar (experimentell).": "Pacejka: oversteer you can feel – full throttle in a corner brings the rear round, drive drops, the slide holds without the stick until you countersteer or come off the pedal, stronger vibration; can be switched off with the “Oversteer” switch (experimental).",
    "Rennen beendet – Ergebnis ansehen": "Race finished – view the result",
    "✕ Nochmal": "✕ Again",
    "Zeigst du auf eine Karte, blinkt das Auto": "Point at a card and that car flashes",
    "App: nach Schließen und Öffnen lässt sich das Auto wieder verbinden (es hing an der alten Verbindung fest); ab der nächsten APK trennt die App beim Schließen sauber.": "App: after closing and reopening, the car can be connected again (it was stuck on the old connection); from the next APK on the app disconnects cleanly when it closes.",
    "Foto": "Photo",
    "Eigene Autofotos: am besten quer, z. B. 4:3 oder 16:9.": "Own car photos: landscape is best, e.g. 4:3 or 16:9.",
    "Optimal: quer, z. B. 4:3 oder 16:9": "Optimal: landscape, e.g. 4:3 or 16:9",
    "Foto löschen": "Delete photo",
    "Streckenfoto": "Track photo",
    "Streckenfoto löschen?": "Delete the track photo?",
    "hochgeladen": "uploaded",
    "keins": "none",
    "Foto zu groß": "Photo too large",
    "Der Speicher des Browsers ist voll. Ein kleineres Bild versuchen.": "The browser storage is full. Try a smaller picture.",
    "Kein Bild": "Not a picture",
    "Diese Datei ließ sich nicht als Bild lesen.": "This file could not be read as a picture.",
    "Zurück ins Rennen": "Back to the race",
    "Kreuz tippen = Boxenstopp (halten bleibt gelbe Flagge), Options springt direkt ins Fahren-Menü und wieder zurück ins Cockpit. Motorsound statt Gegnerhärte im Fahren-Menü. Streckenfoto für den Ausdruck-Modus, neue eigene Fotos im Menü.": "Tap cross = pit stop (hold is still the yellow flag), Options jumps straight to the drive menu and back to the cockpit. Engine sound instead of opponent hardness in the drive menu. Track photo for printout mode, new own photos in the menu.",
    "Kachel Autos mit eigenen Knöpfen Verbinden und Garage.": "Cars tile with its own Connect and Garage buttons.",
    "Menü aufgeräumt: ohne Tastenleiste und Hinweiszeile, kleinere abgedunkelte Bilder, gut lesbare Werte auf den Kacheln, Carrera-Hybrid-Blau statt Rot, oben nur das Omega, im Titel OMEGA blau und SIM rot. Im Cockpit keine Kopfzeile mehr.": "Menu tidied up: no button bar or hint line, smaller darkened pictures, easy-to-read values on the tiles, Carrera Hybrid blue instead of red, only the omega at the top, OMEGA blue and SIM red in the title. No header bar in the cockpit any more.",
    "Dieser Browser kennt Web Bluetooth nicht. Chrome oder Edge auf Windows, Android oder ChromeOS - Safari und Firefox koennen es nicht.": "This browser does not support Web Bluetooth. Use Chrome or Edge on Windows, Android or ChromeOS - Safari and Firefox cannot do it.",
    "Der Bluetooth-Adapter ist aus oder nicht verfuegbar. Auf Android ausserdem pruefen, ob Chrome die Berechtigung \"Geraete in der Naehe\" hat.": "The Bluetooth adapter is off or unavailable. On Android also check that Chrome has the \"Nearby devices\" permission.",
    "← Optionen": "← Options",
    "Autos verbinden": "Connect cars",
    "Über PC mit Python": "Via PC with Python",
    "Der PC trägt die Rangliste, die Telefone treten im WLAN bei.": "The PC holds the leaderboard, the phones join over Wi-Fi.",
    "Über Android-App": "Via Android app",
    "Ein Telefon mit der App ist Host, ganz ohne PC.": "A phone with the app is the host, no PC needed.",
    "← Mehrspieler": "← Multiplayer",
    "Nur in der Android-App: dieses Telefon wird Host, die anderen finden es im WLAN. Im Browser geht das nicht – dort den Weg über den PC nehmen.": "Only in the Android app: this phone becomes the host, the others find it over Wi-Fi. This does not work in the browser – use the PC route there.",
    "Beitreten und Rangliste": "Join and leaderboard",
    "Bluetooth nicht bereit": "Bluetooth not ready",
    "Nochmal verbinden": "Connect again",
    "Kein Auto verbunden": "No car connected",
    "Trotzdem starten": "Start anyway",
    "Die Bluetooth-Auswahl wurde ohne Auto geschlossen.": "The Bluetooth picker was closed without a car.",
    "Zum Ausprobieren geht es trotzdem ins Cockpit: Anzeigen, Menüs, Ampel und Ton laufen, an ein Auto wird nichts gesendet.": "For trying things out you can still go to the cockpit: displays, menus, start lights and sound run, nothing is sent to a car.",
    "Neues Menü passt sich jeder Bildschirmgröße an und füllt am Telefon quer genau den Schirm; die Android-App bleibt im Querformat.": "The new menu adapts to every screen size and exactly fills a phone held sideways; the Android app stays in landscape.",
    "Android-App im Vollbild ohne Status- und Navigationsleiste. Reiter oben neben dem Logo statt Hauptmenü, Mehrspieler mit den Wegen PC und Android-App, „Trotzdem starten“ ohne Auto zum Ausprobieren (experimentell), rechter Stick rollt die Seite.": "Android app in full screen without status and navigation bar. Tabs at the top next to the logo instead of a main menu, multiplayer with the PC and Android app routes, “Start anyway” without a car for trying things out (experimental), the right stick scrolls the page.",
    "Neues Menü im Stil von Assetto Corsa Competizione (WIP): Titelbildschirm, Fahren-Schirm mit Autos, Strecke und Rennoptionen, PS5-Tasten (Kreuz, Kreis, L1/R1), Cockpit-Menü über Options halten.": "New menu in the style of Assetto Corsa Competizione (WIP): title screen, drive screen with cars, track and race options, PS5 buttons (cross, circle, L1/R1), cockpit menu by holding Options.",
    "Nur in der Android-App: Version, Updates ohne neue APK.": "Android app only: version, updates without a new APK.",
    "Titel": "Title",
    "Hauptmenü": "Main menu",
    "Fahren": "Drive",
    "BLE-Werkbank": "BLE workbench",
    "Ergebnisse": "Results",
    "Sitzungen": "Sessions",
    "Autos": "cars",
    "kein Auto": "no car",
    "Leer": "Space",
    "Bestätigen": "Confirm",
    "Navigieren": "Navigate",
    "Wert ändern": "Change value",
    "Wechseln": "Switch",
    "Reiter": "Tabs",
    "keines": "none",
    "Bahn": "Track",
    "Frei": "Free",
    "Teile": "pieces",
    "Bestzeit": "Best lap",
    "Abstimmung": "Setup",
    "Status": "Status",
    "Bluetooth-Auswahl öffnen": "open Bluetooth chooser",
    "Ghost": "Ghost",
    "Wetter": "Weather",
    "Ausdruck, ohne Bahn": "Printout, no track",
    "Härte": "Hardness",
    "Training starten": "Start practice",
    "frei": "free",
    "Öffnet die Garage: Rollen, Namen, Farben, Ghost-Tempo, weitere Autos.": "Opens the garage: roles, names, colours, ghost pace, more cars.",
    "Öffnet sofort die Bluetooth-Auswahl. Das erste Auto steuerst du, weitere werden Ghosts.": "Opens the Bluetooth chooser right away. You drive the first car, further ones become ghosts.",
    "Öffnet sofort die Bluetooth-Auswahl.": "Opens the Bluetooth chooser right away.",
    "Auto verbinden, Rennen einstellen, Strecke wählen und losfahren – alles auf einem Schirm.": "Connect a car, set up the race, choose the track and go – all on one screen.",
    "Ein Telefon oder PC ist Host, die anderen treten bei; ein Tablet wird Info-Screen.": "One phone or PC hosts, the others join; a tablet becomes the info screen.",
    "Allgemein, Fahrgefühl, Rennen, Ton, Gegner, Controller, 2 Spieler, System.": "General, handling, race, sound, opponents, controller, 2 players, system.",
    "Warum dieses Projekt existiert, was du brauchst, Funktionen, Danksagungen, Rechtliches.": "Why this project exists, what you need, features, credits, legal.",
    "Was sich je Wochenversion geändert hat.": "What changed in each weekly version.",
    "Doku, Programmierschule, BLE-Werkbank, Selbsttest, Code-Sonde, Zahlensysteme, Aufnahme-Modus.": "Docs, coding school, BLE workbench, self-test, code probe, number systems, recording mode.",
    "Quadrat wechselt den Renntyp direkt hier, Kreuz öffnet alle Renneinstellungen, Ergebnisse und Sitzungen.": "Square changes the race type right here, cross opens all race settings, results and sessions.",
    "Quadrat schaltet zwischen Auf der Bahn und Frei. Auf der Bahn: Streckenscan, Editor, Strecke laden. Frei: Druckvorlagen und Editor.": "Square switches between on the track and free. On the track: track scan, editor, load a track. Free: print templates and editor.",
    "Quadrat blättert die Abstimmungen durch, Kreuz öffnet Optionen, Fahrgefühl.": "Square cycles the setups, cross opens Options, handling.",
    "Quadrat stellt die Rennhärte der Ghosts, Kreuz öffnet Optionen, Autonome Gegner.": "Square sets the ghosts' race hardness, cross opens Options, autonomous opponents.",
    "Ins Cockpit, und die Startampel läuft. Fehlt noch ein Auto, kommt zuerst die Bluetooth-Auswahl.": "Into the cockpit, and the start lights begin. Without a car, the Bluetooth chooser comes first.",
    "Auto · Rennen · Strecke": "Car · race · track",
    "Im WLAN": "On Wi-Fi",
    "Alle Einstellungen": "All settings",
    "Wozu · Danksagungen · Rechtliches": "Why · credits · legal",
    "Je Wochenversion": "Per weekly version",
    "Werkbank": "Workbench",
    "Rennoptionen": "Race options",
    "Gegner": "Opponents",
    "Scan": "Scan",
    "Editor": "Editor",
    "zum Starten": "to start",
    "Menü": "Menu",
    "Gas ist aus, solange das Menü offen ist – das Auto rollt aus. Ghosts fahren im Rennen weiter.": "Throttle is off while the menu is open – the car rolls out. Ghosts keep racing.",
    "Weiterfahren": "Continue",
    "Rennübersicht": "Race overview",
    "Zum Fahren-Menü": "To the drive menu",
    "Zum Hauptmenü": "To the main menu",
    "Menü (Options, Esc)": "Menu (Options, Esc)",
    "Was du brauchst": "What you need",
    "Browser, Firmware, Controller – und was optional dazukommt.": "Browser, firmware, controller – and what is optional.",
    "Funktionen": "Features",
    "Was OmegaSim alles kann, auf einen Blick.": "Everything OmegaSim can do, at a glance.",
    "Rechtliches": "Legal",
    "Unabhängig, offen, ohne Gewähr – und was gezählt wird.": "Independent, open, without warranty – and what is counted.",
    "System": "System",
    "Sprache, Sicherung, gemerkte Autos, App und Entwicklertools.": "Language, backup, remembered cars, app and developer tools.",
    "Sprache": "Language",
    "Dieselbe Wahl wie auf dem Titelbildschirm.": "The same choice as on the title screen.",
    "Entwicklertools zeigen": "Show developer tools",
    "Blendet im Hauptmenü die Kachel Entwickler ein: Doku, Programmierschule, BLE-Werkbank, Selbsttest, Code-Sonde, Zahlensysteme, Aufnahme-Modus. Auch mit ?dev in der Adresse.": "Shows the Developer tile in the main menu: docs, coding school, BLE workbench, self-test, code probe, number systems, recording mode. Also with ?dev in the address.",
    "Öffnen": "Open",
    "Deutsch": "Deutsch",
    "English": "English",
    "Das Auto fährt eine Runde und liest dabei die Teile ein.": "The car drives a lap and reads the pieces.",
    "Strecke laden": "Load track",
    "Eine gespeicherte Strecke laden, speichern oder löschen.": "Load, save or delete a saved track.",
    "Meine Strecken": "My tracks",
    "Noch keine Strecken gespeichert.": "No tracks saved yet.",
    "Das Auto fährt mit mittlerem Tempo über die Bahn und hält an, sobald ein geschlossener Rundkurs gemessen ist. Die Strecke steht danach im Editor.": "The car drives over the track at medium pace and stops as soon as a closed circuit is measured. The track is then in the editor.",
    "Live mitlesen, während du selbst fährst: im Streckeneditor, „Live-Scan starten“.": "To read along live while you drive yourself: in the track editor, “Start live scan”.",
    "Android-App (experimentell): dieselbe App als APK, mit Bluetooth-Brücke, Host ohne PC und Updates ohne Neuinstallation.": "Android app (experimental): the same app as an APK, with a Bluetooth bridge, a host without a PC and updates without reinstalling.",
    "Info-Screen: ein Tablet oder Fernseher zeigt Strecke, alle Autos und die Rangliste, ohne eigenes Auto.": "Info screen: a tablet or TV shows the track, all cars and the standings, without a car of its own.",
    "Neue APK nötig für Fassung": "New APK needed for version",
    "APK holen": "Get APK",
    "Aktuell.": "Up to date.",
    "Neu verfügbar:": "New version available:",
    "Dateien": "files",
    "Lade": "Downloading",
    "Fertig, starte neu …": "Done, restarting …",
    "mitgeliefert": "bundled",
    "geladen": "downloaded",
    "Die Fassung": "Version",
    "startete nicht und wurde verworfen.": "did not start and was discarded.",
    "Update verworfen": "Update discarded",
    "Host beenden": "Stop host",
    "keine WLAN-Adresse": "no Wi-Fi address",
    "Info-Screen im Browser:": "Info screen in the browser:",
    "Suche …": "Searching …",
    "Kein Host gefunden. Gleiches WLAN? Manche Router trennen Geräte voneinander.": "No host found. Same Wi-Fi? Some routers isolate devices from each other.",
    "Restzeit": "Time left",
    "offen": "open",
    "Noch kein Fahrer angemeldet.": "No driver registered yet.",
    "Update verfügbar": "Update available",
    "Jetzt laden": "Download now",
    "App & Updates": "App & updates",
    "Version der Android-App, Updates ohne neue APK.": "Android app version, updates without a new APK.",
    "Die App lädt neue Fassungen selbst, direkt von der Projektseite. Geladen wird nur, was sich geändert hat, und alle Einstellungen bleiben erhalten. Startet eine neue Fassung nicht, schaltet die App von selbst auf die vorige zurück.": "The app downloads new versions itself, straight from the project page. Only what changed is downloaded, and all settings are kept. If a new version does not start, the app switches back to the previous one on its own.",
    "Web-Fassung": "Web version",
    "Quelle": "Source",
    "Nach Update suchen": "Check for updates",
    "Mitgelieferte Fassung verwenden": "Use the bundled version",
    "Neueste APK auf GitHub": "Latest APK on GitHub",
    "Beim Start nach Updates suchen": "Check for updates at start",
    "Fragt beim Öffnen einmal die Projektseite. Geladen wird erst nach einem Tipp auf „Jetzt laden“.": "Asks the project page once when opening. Nothing is downloaded until you tap “Download now”.",
    "Ohne PC: ein Telefon ist Host.": "No PC: one phone is the host.",
    "Die anderen Telefone suchen ihn im WLAN oder tragen die Adresse ein. Ein Tablet oder Fernseher öffnet die Adresse mit /?info im Browser und wird Info-Screen, ganz ohne App.": "The other phones search for it on the Wi-Fi or enter the address. A tablet or TV opens the address with /?info in the browser and becomes an info screen, without any app.",
    "Dieses Telefon ist Host": "This phone is the host",
    "Host im WLAN suchen": "Find host on Wi-Fi",
    "Als Info-Screen": "As info screen",
    "Ohne eigenes Auto: zeigt Strecke, Autos und Rangliste": "Without a car: shows track, cars and standings",
    "Laufzeit": "Running time",
    "Rennlänge": "Race length",
    "Noch keine Strecke gemeldet.": "No track reported yet.",
    "Letzte": "Last",
    "APK": "APK",
    "Neuer Steuerungsmodus Pacejka (experimentell): Reifen mit Haftgrenze, am Limit Unter- und Übersteuern mit Vibration.": "New control mode Pacejka (experimental): tyres with a grip limit, understeer and oversteer at the limit with vibration.",
    "Reifenquietschen lauter, Porsche-Aufnahme entfernt.": "Tyre squeal louder, Porsche recording removed.",
    "Kennlinien: Gas, Bremse und Lenkung mit einer Formel, neue Bremskennlinie, Lenk-Plot zeigt die wirksame Kurve, Live-Punkt in allen Plots.": "Curves: throttle, brake and steering share one formula, new brake curve, the steering plot shows the effective curve, live dot in all plots.",
    "Rennübersicht mit Rundenzeit-Diagramm und Sektortabelle (Bestwert grün, schlechtester rot).": "Race overview with lap-time chart and sector table (best green, worst red).",
    "Doppel-Ausdruck-Box: die Box-Überfahrt zählt nicht und wird nicht angesagt, wählbar 1 oder 0 Runden.": "Double-printout pit: the pit crossing does not count and is not announced, 1 or 0 laps selectable.",
    "Zwei Spieler: Reifenwechsel für Auto 2, Wahlkacheln für Reifen und Tank, eigener Rundenton.": "Two players: tyre change for car 2, selection tiles for tyres and fuel, own lap chime.",
    "Menüs: einzeilige Kacheln, Rennmodus und Rundenzahl im Cockpit exakt wählbar, D-Pad am DualShock 4.": "Menus: single-line tiles, race mode and lap count exactly selectable in the cockpit, D-pad on the DualShock 4.",
    "Wechselhaftes Wetter regnet jetzt wirklich, Schauer kürzer als Trockenphasen.": "Changeable weather now really rains, showers shorter than dry spells.",
    "Lichthupe lässt das Rücklicht an, simulierter Gyro-Punkt folgt der Kurve.": "Headlight flash keeps the tail light on, the simulated gyro dot follows the corner.",
    "Gemerkte Autos: nur geänderte Namen und Farben, Zuordnung per Klick.": "Remembered cars: only changed names and colours, assignment by click.",
    "Ghosts stoppen beim Rennabbruch und nach einem Abflug.": "Ghosts stop when a race is aborted and after leaving the track.",
    "Startseite mit OMEGA-SIM-Schriftzug, Credits mit Quellen, Doku auf dem aktuellen Stand.": "Home page with OMEGA SIM title, credits with sources, docs brought up to date.",
    "Pacejka: wie Physik, dazu Reifen mit Haftgrenze nach der Magic Formula. Das Einspurmodell beschreibt, wie sich das Auto dreht; Pacejka beschreibt, wie viel Seitenkraft ein Reifen hält, bevor er rutscht. Unterhalb der Grenze fährt es sich wie Physik. Schiebt die Vorderachse über die Grenze, kommt weniger Einschlag an (Untersteuern). Kommt das Heck – unter Vollgas in der Kurve oder beim Anbremsen –, lenkt die App in die Kurve dazu, auch wenn du den Stick loslässt, und der Vortrieb geht zurück (Übersteuern). Fangen: gegenlenken oder vom Pedal gehen. Beides vibriert und quietscht. Experimentell.": "Pacejka: like Physics, plus tyres with a grip limit following the Magic Formula. The single-track model describes how the car rotates; Pacejka describes how much lateral force a tyre holds before it slides. Below the limit it drives like Physics. If the front axle goes over the limit, less steering arrives (understeer). If the rear goes – at full throttle in a corner or when braking into it –, the app adds steering into the corner, even when you let go of the stick, and drive drops (oversteer). To catch it: countersteer or come off the pedal. Both vibrate and squeal. Experimental.",
    "Pacejka (experimentell)": "Pacejka (experimental)",
    "Übersteuern (Pacejka)": "Oversteer (Pacejka)",
    "Nur im Modus Pacejka. An: unter Vollgas in der Kurve und beim Anbremsen kommt das Heck, das Auto lenkt von selbst weiter ein und verliert Vortrieb, bis du gegenlenkst oder vom Pedal gehst (höchstens 2 s). Aus: das Heck bricht nie aus, nur das Schieben über die Vorderräder bleibt.": "Pacejka mode only. On: at full throttle in a corner and when braking into it the rear steps out, the car keeps turning in by itself and loses drive until you countersteer or come off the pedal (at most 2 s). Off: the rear never steps out, only pushing over the front wheels remains.",
    "Haftgrenze (Pacejka)": "Grip limit (Pacejka)",
    "Nur im Modus Pacejka. Wo der Scheitel der Reifenkurve liegt, gemessen an der Querausnutzung des Reibkreises. Kleiner heißt früher am Limit. Bei 70 % ist voller Einschlag ab etwa 115 km/h zu viel. Regen und kalte Reifen senken die Grenze zusätzlich.": "Pacejka mode only. Where the peak of the tyre curve sits, measured against the lateral use of the friction circle. Lower means reaching the limit earlier. At 70 % full lock is too much from about 115 km/h. Rain and cold tyres lower the limit further.",
    "Unter- und Übersteuern": "Understeer and oversteer",
    "Nur im Modus Pacejka. Leises Brummen, solange die Front schiebt; ein kräftiger Stoß, wenn das Heck kommt.": "Pacejka mode only. A soft hum while the front pushes; a strong jolt when the rear steps out.",
    "Übersteuern": "oversteer",
    "Untersteuern": "understeer",
    "Fachliteratur zu den Modellen": "Literature on the models",
    "Einspurmodell (Gier- und Schwimmwinkel-Anzeige, Pacejka-Modus):": "Single-track model (yaw and slip-angle display, Pacejka mode):",
    "Reifenkennlinie im Pacejka-Modus (Magic Formula):": "Tyre curve in Pacejka mode (Magic Formula):",
    "Zeiten je Runde": "Times per lap",
    "Tank auf": "Fuel to",
    "Reifen für den nächsten Stopp": "Tyres for the next stop",
    "Tankmenge für den nächsten Stopp": "Fuel for the next stop",
    "Erst ein Auto verbinden": "Connect a car first",
    "Boxenstopp eingeleitet": "Pit stop initiated",
    "Rennmodus: links/rechts wählen": "Race mode: choose with left/right",
    "Rennmodus: Anwahl beendet": "Race mode: selection finished",
    "Verschiedene Rennmodi": "Several race modes",
    "KI-Überholmanöver": "AI overtaking",
    "Zwei oder drei Autos, je ein Controller, ein Rennen auf derselben Strecke. In der Garage gibt es die Rollen „Spieler 2“ und „Spieler 3“ (die Wahl schaltet den Modus ein). Das erste Pad fährt Auto 1, das zweite Auto 2, das dritte Auto 3. Im Cockpit kommt der Schirm „Beide“ dazu, der Tempo, Drehzahl, Tank, Zustand und Reifen aller Autos nebeneinander zeigt – mit Spieler 3 in drei Spalten. Der Hauptschirm bleibt Auto 1 vorbehalten. Alle Autos werden aus demselben 45-ms-Sendetakt bedient – getrennte Takte waren die Ursache des Stotterns mit echtem Controller, und dieser Modus wiederholt den Fehler nicht.":
      "Two or three cars, one controller each, one race on the same track. The garage offers the roles “Player 2” and “Player 3” (choosing one switches the mode on). The first pad drives car 1, the second car 2, the third car 3. The cockpit gains the “Both” screen showing speed, revs, fuel, condition and tyres of all cars side by side – in three columns with player 3. The main screen stays car 1's alone. All cars are served from the same 45 ms send heartbeat – separate heartbeats were the cause of the stutter with a real controller, and this mode does not repeat that mistake.",

    "Controller tauschen": "Swap controllers",
    "Welcher der beiden erkannten Controller Auto 1 fährt. Die Reihenfolge kommt vom Browser und ist nicht wählbar: hier ist der Schalter dafür.":
      "Which of the two detected controllers drives car 1. The order comes from the browser and cannot be chosen: this is the switch for it.",
    "Was gerade erkannt ist": "What is detected right now",
    "Der Makro-Mitschnitt zeichnet Auto 1 auf. Zwei Spuren in einer Aufnahme wären ein anderes Dateiformat.":
      "The macro recorder records car 1. Two tracks in one recording would be a different file format.",
    "Und die Rennleitung gilt für beide: bei gelber Flagge regelt Auto 2 auf dasselbe Tempo herunter wie das ganze Feld – gemessen 100 von 103 km/h Zieltempo, gegen einen Daumen auf Vollgas –, und in der Einführungsrunde rollt es in der Kolonne mit, auf seiner eigenen Seite und mit eigener Schlängelphase. Jedes Auto hat dabei seinen eigenen Regler: der hat einen I-Anteil, und ein geteilter würde die Abweichung des einen Autos in das Gas des anderen tragen.":
      "And race control applies to both: under a yellow flag car 2 slows to the same pace as the rest of the field – measured 100 of a 103 km/h target, against a thumb held at full throttle – and on the formation lap it rolls along in the column, on its own side and with its own weave phase. Each car has its own controller: it has an integral term, and a shared one would carry one car's error into the other car's throttle.",
    "Dazu eine eigene Ortung auf der Strecke, und daran hängt mehr, als es klingt: die Ghosts weichen Auto 2 aus und wählen ihre Überholseite nach seiner Querlage, es erscheint auf der Streckenkarte, die Fahrhilfe und der Leitplanken-Modus gelten auch für ihn, und neben der Bahn wird sein Gas gedrosselt und sein Controller brummt – sein eigener, nicht der von Auto 1.":
      "Plus a track position of its own, and more hangs off that than it sounds: the ghosts avoid car 2 and pick their passing side from its lateral offset, it shows up on the track map, the driver aid and guard-rail mode apply to it too, and off the track its throttle is capped and its controller rumbles – its own, not car 1's.",
    "Drücke an jedem Controller einmal einen Knopf – der Browser meldet ein Pad erst nach der ersten Eingabe. Jeder Spieler hat seine eigene Tastenbelegung (Kachel „Controller“, oben Spieler 1/2/3 wählen).":
      "Press one button on each controller – the browser only reports a pad after its first input. Each player has their own button mapping (“Controller” tile, choose player 1/2/3 at the top).",
    "Was Auto 2 in dieser Fassung nicht hat": "What car 2 does not have in this version",
    "Ehrlicher als es zu verschweigen – jeder Punkt hängt an einem Zähler oder einer Ortung, die es nur einmal gibt:":
      "More honest than leaving it out – every item hangs off a counter or a position estimate that exists only once:",
    "Der Boxenstopp von Auto 2 ist schmal: er tankt voll und repariert ganz, ohne Vorwahl und ohne Reifenwechsel. Die Reifenwahl ist eine globale Einstellung – „auf weich“ für ein einzelnes Auto ist eine Aussage, die das Modell nicht trennen kann.":
      "Car 2's pit stop is a narrow one: it fills the tank and repairs fully, with no pre-selection and no tyre change. The tyre compound is a global setting – \"switch to softs\" for a single car is a statement the model cannot separate.",
    "Dazu einen eigenen Tank: Verbrauch nach Gas und Zeit mit demselben Regler wie Auto 1, das Tankgewicht in seiner Fahrphysik, die Warnstufen als Meldung und den Notlauf des leeren Tanks – und der geht über eine Rampe zu, nicht in einem Takt.":
      "Plus a fuel tank of its own: consumption by throttle and time on the same slider as car 1, the fuel weight in its driving model, the warning levels as a message, and the limp mode of an empty tank – which closes over a ramp, not in one tick.",
    "Dazu einen eigenen Schaden: Crasherkennung aus seinen eigenen Sensorbytes, Leistungsverlust mit dem Schaden, Notlauf im Totalschaden und ausgefallene Lampen – und die Kontrollleuchten des einen sagen nichts mehr über das andere Auto.":
      "Plus damage of its own: crash detection from its own sensor bytes, power lost with damage, limp mode when totalled, and lamps that fail – and one car's tell-tales no longer say anything about the other.",
    "Das Motormodell selbst darf Auto 2 seit Kurzem frei wählen (eigener Knopf auf dem Vergleichsschirm „Beide“). Was es weiterhin nicht hat, ist eine eigene Zusatzkette: kein Turbopfeifen, keine Knaller, kein Begrenzer-Takt – die hängen an einem Bus. Und keinen Doppler, der gehört zur Runde von Auto 1.":
      "Car 2 has recently become free to choose its own engine model (a button of its own on the “Both” comparison screen). What it still does not have is extras of its own: no turbo whistle, no pops, no limiter pulsing – those hang off one bus. And no doppler, which belongs to car 1's lap.",
    "Dazu eine eigene Motorstimme, und die sitzt auf der anderen Stereoseite – links Auto 1, rechts Auto 2. Das ist keine Kosmetik: zwei Motoren im selben Drehzahlband aus einem Lautsprecher klingen wie ein verstimmter Motor und nicht wie zwei Autos. Auch der Schaltklang kommt von der Seite des Autos, das geschaltet hat. Beide fahren mit derselben Vorgabe los, dürfen aber verschiedene Motoren spielen – je ein eigener Knopf auf dem Vergleichsschirm „Beide“.":
      "Plus an engine voice of its own, and it sits on the other stereo side – car 1 left, car 2 right. That is not decoration: two engines in the same rev band from one speaker sound like one out-of-tune engine, not like two cars. The shift sound comes from the side of the car that shifted, too. Both start out with the same choice, but may play different engines – an engine-sound button of its own on the “Both” comparison screen.",
    "Die drei Rundenzeiten im Cockpit – aktuelle, letzte, beste – und die Aufnahme gehören Auto 1. Seine eigenen Zeiten stehen in der Rundenübersicht.":
      "The three lap times in the cockpit – current, last, best – and the recording belong to car 1. Its own times are in the lap overview.",
    "Dazu zählt Auto 2 seine Runden mit: es steht in der Rundenübersicht, in der Rangliste während des Rennens und im Ergebnis samt CSV. Das war keine Arbeit, sondern ein Irrtum in meiner Schätzung – die Rundenzählung lief schon immer je Auto, für jedes verbundene, egal welche Rolle. Die Zielflagge wartet jetzt auf beide Fahrer statt nur auf einen.":
      "Car 2 counts its laps too: it appears in the lap overview, in the running order during the race, and in the result including the CSV. That took no work, it corrected a mistake in my estimate – lap counting always ran per car, for every connected one, whatever its role. The chequered flag now waits for both drivers instead of just one.",
    ": eine eigene Fahrphysik mit eigenen Gängen, eigener Drehzahl, eigenem Tempo und eigenen Temperaturen. Die Einstellungen aus „Fahrgefühl“ werden bei jedem Anschalten übernommen, damit beide Autos gleich fahren.":
      ": a driving model of its own, with its own gears, revs, speed and temperatures. The settings from “Driving feel” are copied over every time the mode is switched on, so that both cars drive alike.",
    "Ghost: Linienmodell": "Ghost: line model",
    "Ghost: lernt von Runde zu Runde": "Ghost: learns lap by lap",
    "Ghost: seitlicher Versatz": "Ghost: lateral offset",
    "Allgemein": "General",
    "Gummiband": "Rubber band",
    "Haarnadel L": "Hairpin L",
    "Haarnadel R": "Hairpin R",
    "30° L": "30° L",
    "30° R": "30° R",
    "Weit L": "Wide L",
    "Weit R": "Wide R",
    "Enge": "Narrow",
    "Weite Kurve links": "Wide curve left",
    "Weite Kurve rechts": "Wide curve right",
    "Kleine Kurve links": "Small curve left",
    "Kleine Kurve rechts": "Small curve right",
    "Engstelle": "Narrow section",
    "Rechtskurve": "Right curve",
    "Linkskurve": "Left curve",
    "Haarnadel rechts": "Right hairpin",
    "Haarnadel links": "Left hairpin",
    "Haarnadel links und": "hairpin left and",
    "Haarnadel rechts; alles andere ist unbestätigt. Trag hier den Code ein, den dein gedrucktes Boxen-Muster tatsächlich auslöst,": "hairpin right; everything else is unconfirmed. Enter here the code your printed pit pattern actually triggers, ",
    "Haltezeit": "Hold time",
    "Handy-Neigung für Lenkung nutzen": "Use phone tilt for steering",
    "Hier stand die Vermutung, sie melde": "The assumption here was that it reports",
    "Hinzufügen": "Add",
    "Hochschalten": "Shift up",
    "Höchstgeschwindigkeit (km/h)": "Top speed (km/h)",
    "Ideallinie nutzt {a} cm von {b} cm möglichem Versatz": "Racing line uses {a} cm of {b} cm possible offset",
    "Im Vollbild: hoch/runter wechselt zwischen Aktionen (oben) und Teilen (unten), links/rechts wählt, X löst aus. O rückgängig, Dreieck Reset, Quadrat dreht.": "In fullscreen: up/down switches between actions (top) and parts (bottom), left/right selects, X activates. O undoes, triangle resets, square rotates.",
    "Impulslänge": "Pulse length",
    "In sieben aufgezeichneten Fahrten hat das Auto": "In seven recorded runs the car",
    "Jede Zeile ist ein Codewechsel: der Wert, wie viele Pakete er gehalten hat und wie lange. Ein echter Lesevorgang ist ein Bündel gleicher Codes während der Überfahrt. Ein Einzelpaket zwischen Nullen ist Rauschen. In einer Anzeige, die nur den letzten Wert zeigt, sieht beides gleich aus.": "Each row is a change of code: the value, how many packets it held and for how long. A genuine read is a bundle of identical codes during the crossing. A single packet between zeros is noise. In a display that shows only the latest value, the two look the same.",
    "Jeder Strich eine Zündung, obere Reihe die eine Bank, untere die andere. Beim Cross-Plane bleibt der Gesamttakt gleichmäßig, die einzelne Bank wird lumpig, und weil jede Bank ihren eigenen Krümmer hat, entsteht daraus das Blubbern. Beim Reihenmotor gibt es nur eine Reihe. Die Zahlen zwischen den Strichen sind die Abstände derselben Bank in Grad.": "Each bar is one firing event, the upper row one bank, the lower row the other. On a cross-plane the overall beat stays even while the single bank turns lumpy, and because each bank has its own manifold, that is where the burble comes from. An inline engine has only one row. The numbers between the bars are the intervals within the same bank, in degrees.",
    "Jedes Auto braucht einen eigenen Klick auf „Auto verbinden“, Web Bluetooth verlangt für jede Verbindung eine eigene Nutzergeste, das lässt sich nicht umgehen.": "Every car needs its own click on “Connect a car”, Web Bluetooth requires a separate user gesture for each connection, and there is no way around it.",
    "Kacheln gehalten": "tiles held",
    "Kacheln": "Tiles",
    "Kachelzähler": "Tile counter",
    "Kalibrierung": "Calibration",
    "Kalt nach Start und Boxenstopp, abgenutzt nach hartem Stint. Links = aus.": "Cold after the start and after a pit stop, worn after a hard stint. Left = off.",
    "Klick auf eine Zeile lässt die Lichter dieses Autos blinken": "Clicking a row makes that car's lights blink",
    "Kopieren": "Copy",
    "Krümmung nimmt den größten Radius. Rundenzeit rechnet ein Geschwindigkeitsprofil und ist im Modell 1–8 % schneller; ob auch auf dem Teppich, sagen Rundenzeit und Abgänge.": "Curvature takes the largest possible radius. Lap time computes a speed profile and is 1-8 % quicker in the model; whether it is on the carpet too is answered by lap times and departures.",
    "Krümmung": "Curvature",
    "Kurbelwelle": "Crankshaft",
    "Kurven an das Auto senden": "Send the curves to the car",
    "Kurven glätten": "Smooth the curves",
    "Kurven ziehen statt Code schreiben, und sofort sehen, was das Auto daraus macht.": "Drag curves instead of writing code, and see straight away what the car makes of it.",
    "L1: Bahn oder Ausdruck · R1: Automatik oder von Hand · Kreuz: gelbe Flagge (1 s halten) · Select: Rennen starten": "L1: rail or printout · R1: automatic or manual · Cross: yellow flag (hold 1 s) · Select: start the race",
    "Laden": "Load",
    "Last": "Load",
    "Leeren": "Clear",
    "Leerlauf-Paket laden und unverändert wiederholt senden (reproduziert dieselbe gültige Prüfsumme, ohne sie berechnen zu müssen).": "idle packet, loaded and sent again unchanged (which reproduces the same valid checksum without having to compute it).",
    "Leertaste": "Space",
    "Leistung über Akkulaufzeit konstant halten": "Hold power constant over battery life",
    "Lenkansprechen": "Steering response",
    "Lenkanteil und erhöht ihn in Stufen, bis das Auto die Bahn verlässt. Der letzte Wert, der noch hielt, ist der brauchbare Bereich: und der Wert, bei dem es kippt, sagt, wie viel Lenkanteil einer halben Bahnbreite entspricht.": "steering share and raises it in steps until the car leaves the track. The last value that still held is the usable range, and the value at which it tips over says how much steering share corresponds to half a track width.",
    "Lenkanteil": "Steering share",
    "Lenkeinschlag, nicht der verlangte.": "steering angle, not the one asked for.",
    "Lenkung & Feinabstimmung": "Steering & fine tuning",
    "Lenkung": "Steering",
    "Lenkung,": "steering,",
    "Lenkung:": "Steering:",
    "Lenkwinkel über die Zeit": "Steering angle over time",
    "Letzte Zeit": "Last time",
    "Letztes Paket, Byte für Byte.": "The last packet, byte by byte.",
    "Letztes Teil entfernen": "Remove the last part",
    "Licht AUS + Bit 5 (0x20)": "Lights OFF + bit 5 (0x20)",
    "Licht AUS + Bit 5+6 (0x60)": "Lights OFF + bits 5+6 (0x60)",
    "Licht AUS + Bit 6 (0x40)": "Lights OFF + bit 6 (0x40)",
    "Licht AUS + Bit 7+5 (0xa0)": "Lights OFF + bits 7+5 (0xa0)",
    "Licht an/aus": "Lights on/off",
    "Lichthupe": "Headlight flash",
    "Liest: Ausdruck": "Reads: printout",
    "Liest: Bahn": "Reads: track",
    "Linker Stick (X-Achse)": "Left stick (X axis)",
    "Linker Trigger (LT / L2)": "Left trigger (LT / L2)",
    "Links": "Left",
    "Live-Log": "Live log",
    "Live-Scan starten": "Start live scan",
    "Log leeren": "Clear the log",
    "Losfahren": "Start driving",
    "Läuft komplett automatisch, ohne Physik-Engine (direkte Werte).": "Runs fully automatically, without the physics engine (direct values).",
    "Läuft, bis du beendest.": "Runs until you stop it.",
    "Experimentell: Geister von der Bahn rammen, 3 Leben.": "Experimental: knock the ghosts off the track, 3 lives.",
    "Experimentell: rammen, Health 0-100, Sieg nach Kills.": "Experimental: ram, health 0-100, win by kills.",
    "Löschen": "Delete",
    "Löst Tempolimit und Boxenstopp aus. Das alte Blatt wurde gar nicht erkannt, und dafür gibt es zwei sichtbare Gründe: alle neun Balken waren gleich dick, es gab also nur ein Symbol statt zwei, und das Modulmaß war ein anderes als beim Original. Das neue Blatt nimmt das Modulmaß des Originals.": "Triggers the speed limit and the pit stop. The old sheet was not recognised at all, and there are two visible reasons: all nine bars were the same thickness, so there was only one symbol instead of two, and the module size differed from the original. The new sheet takes the original's module size.",
    "Löst Tempolimit und Boxenstopp aus. Welchen Code das Auto dafür meldet, ist": "Triggers the speed limit and the pit stop. Which code the car reports for it is",
    "Makros": "Macros",
    "Manuelle Schaltung": "Manual gearshift",
    "Masse & Reifen": "Mass & tyres",
    "Maß": "Measurement",
    "Messstand vom 25.08.": "Measurements of 25 Aug.",
    "Messung starten": "Start the measurement",
    "Messungen an der laufenden App. Sie ersetzen keine Fahrt, aber sie sagen, ob eine Änderung etwas kaputt gemacht hat, das man nicht sofort sieht: eine Physik, die nicht mehr trifft, eine Ideallinie mit einem Sprung, eine Tonschleife mit einer Naht, ein deutscher Satz im englischen Modus.": "Measurements on the running app. They do not replace a drive, but they say whether a change broke something you would not notice at once: physics that no longer matches, a racing line with a jump, a sound loop with a seam, a German sentence in English mode.",
    "Minuten": "minutes",
    "Mittel": "Mean",
    "Modus": "Mode",
    "Motorlautstärke": "Engine volume",
    "Motorsound": "Engine sound",
    "Motorsound-Profil": "Engine sound profile",
    "Motorwerkstatt": "Engine workshop",
    "Muster zum Ausdrucken und Auslegen.": "Patterns to print out and lay down.",
    "Muster-Sonde:": "Pattern probe:",
    "Mustererkennung: Paketvarianten testen": "Pattern detection: test packet variants",
    "Musterkontakt": "Pattern contact",
    "NOTHALT": "EMERGENCY STOP",
    "Name der Aufnahme": "Recording name",
    "Name der Strecke": "Track name",
    "Community-Bestzeiten": "Community best times",
    "Community-Strecke mit {n} Teilen, gefahren mit der Abstimmung {p}.": "Community track with {n} pieces, driven with the {p} setup.",
    "Noch keine Zeiten eingetragen. Fahr die Strecke, dann erscheint deine Zeit hier.": "No times yet. Drive the track and your time appears here.",
    "Community-Bestenliste": "Community leaderboard",
    "Gemeinsame Liste nicht erreichbar, hier deine eigenen Zeiten.": "Shared list unreachable, showing your own times.",
    "Strecke öffnen": "Open track",
    "← Community-Bestzeiten": "← Community best times",
    "Eigene Strecken mit Abstimmung einreichen und Bestzeiten teilen.": "Submit your own tracks with a setup and share best times.",
    "Eigene Strecke einreichen": "Submit my track",
    "Noch keine Community-Strecken. Reiche deine Strecke ein.": "No community tracks yet. Submit your track.",
    "Noch keine Zeit": "No time yet",
    "Bestzeit in Sekunden (z.B. 12,345)": "Best time in seconds (e.g. 12.345)",
    "Zeit fahren": "Run for a time",
    "Zeit eintragen": "Enter time",
    "Strecke einreichen": "Submit track",
    "Keine Strecke im Editor. Scanne oder baue zuerst eine Strecke.": "No track in the editor. Scan or build a track first.",
    "So sieht deine Strecke aus. Wähle die Abstimmung, mit der alle sie fahren.": "This is your track. Choose the setup everyone drives it with.",
    "Strecke {n} eingereicht.": "Track {n} submitted.",
    "Zeit für die Community-Strecke {n} eingetragen.": "Time for community track {n} recorded.",
    "Erst die laufende Challenge beenden": "Finish the running challenge first",
    "Neu zuweisen": "Reassign",
    "Nicht im Bild, weil man sie nur hört: Klappern, Ansauganteil und Last.": "Not in the pictures, because you can only hear them: clatter, intake share and load.",
    "Noch keine Verbindung.": "No connection yet.",
    "Noch nicht gebaut, die drei Punkte stehen hier als Bauplan, damit klar ist, wohin das führt.": "Not built yet: the three points stand here as a blueprint, so it is clear where this leads.",
    "Noch nicht gefahren.": "Not driven yet.",
    "Not-Halt, alle Eingaben los, Momentum auf null": "Emergency stop: release everything, momentum to zero",
    "Nothalt.": "emergency stop.",
    "Notiz setzen": "Add a note",
    "Nummer 14 (0x0e)": "Number 14 (0x0e)",
    "Nummer 18 (0x12)": "Number 18 (0x12)",
    "Nummer 22 (0x16)": "Number 22 (0x16)",
    "Nur die Gaskurve ist einstellbar, die Lenkung macht das Auto selbst. Einzige Rückmeldung ist die Rundenzeit. Genau so haben Rennfahrer es immer gemacht.": "Only the throttle curve is adjustable; the car does the steering itself. The only feedback is the lap time. That is exactly how racing drivers have always done it.",
    "Oben = Vollgas, Mitte = rollen, unten = Vollbremse.": "Up = full throttle, middle = coasting, down = full brake.",
    "Oben = voll rechts, Mitte = gerade, unten = voll links.": "Up = full right, middle = straight, down = full left.",
    "Ohne Streckenkarte: keine Kachelfolge, keine Rundenzählung, kein Vorausblick.": "Without a track map: no tile sequence, no lap counting, no lookahead.",
    "Open Source, offene Lizenz": "Open source, open licence",
    "Optionen": "Options",
    "Ortskurve": "Locus",
    "PC und Android, Chrome-basiert": "PC and Android, Chrome-based",
    "Paket in beiden Richtungen auf, was das Auto meldet und was die App sendet: mit Zeitstempel, und exportiert es als CSV. Damit ist kein btsnoop nötig: die Datei ist bereits beschriftet und entschlüsselt.": "packet in both directions, what the car reports and what the app sends, with a timestamp, and exports it as CSV. No btsnoop needed: the file is already labelled and decoded.",
    "Paket:": "Packet:",
    "Pakete": "Packets",
    "Paketlänge:": "Packet length:",
    "Passt in ca. 50×20cm, am besten das Auto mittig auf die Fläche stellen oder aufbocken, falls möglich.": "Fits in about 50×20 cm: best to put the car in the middle of the sheet, or up on blocks if you can.",
    "Pflichtboxenstopps": "Mandatory pit stops",
    "Physik-Modus aktivieren": "Enable physics mode",
    "Position über die Runden": "Position over the laps",
    "Primärrohr": "Primary pipe",
    "Probe 3: eine breite Lücke": "Probe 3: a wide gap",
    "Probe 5 zuerst.": "Probe 5 first.",
    "Probiert jede Runde eine kleine Änderung an Tempo und Linie und behält sie nur, wenn die Runde schneller war": "Tries a small change to pace and line each lap and keeps it only if the lap was quicker",
    "Programmierschule": "Coding school",
    "Protokoll, Streckencodes, Physik, Töne: alles, was gemessen wurde, mit Herkunft.": "Protocol, track codes, physics, sounds: everything that was measured, with its source.",
    "Protokoll-Labor (NUS RX/TX)": "Protocol lab (NUS RX/TX)",
    "Prüfung": "Check",
    "Querablage messen": "Measure lateral placement",
    "Querkraft und Längskraft": "Lateral and longitudinal force",
    "R3 (rechter Stick drücken)": "R3 (press the right stick)",
    "Realismus": "Realism",
    "Rechnung": "Calculation",
    "Rechter Trigger (RT / R2)": "Right trigger (RT / R2)",
    "Rechts": "Right",
    "Referenz-Akkustand": "Reference battery level",
    "Regen und Donner, eigener Regler.": "Rain and thunder, its own slider.",
    "Regen": "Rain",
    "Regenlautstärke": "Rain volume",
    "Regler, auch die, die keine Voreinstellung anfasst. Kopieren, verschicken, einfügen,": "sliders, including the ones no preset touches. Copy, send, paste,",
    "Reicht dieser Vorlauf noch?": "Is this lead-in still enough?",
    "Reifen": "Tyres",
    "Reifen: Temperatur & Verschleiß": "Tyres: temperature & wear",
    "Reifengrip": "Tyre grip",
    "Reifensimulation an/aus": "Tyre simulation on/off",
    "Reifensimulation an/aus, beim Boxenstopp: Reifenwechsel an/aus": "Tyre simulation on/off; during a pit stop: tyre change on/off",
    "Reifentemperatur": "Tyre temperature",
    "Reihe": "Inline",
    "Rekonstruktion": "Reconstruction",
    "Relais-Klacken (gerechnet)": "Relay click (synthesised)",
    "Renneinstellungen": "Race setup",
    "Rennen abbrechen": "Abort race",
    "Rennen läuft, Runde": "Race running, lap",
    "Rennen starten / abbrechen": "Start / abort race",
    "Rennen starten": "Start race",
    "Rennmodus": "Race mode",
    "Rennmotoren, gerechnet": "Racing engines, computed",
    "Rennwürze": "Race spice",
    "Resonanz 116 Hz · Zündrate 300 Hz · Zyklusrate 37.5 Hz": "Resonance 116 Hz · firing rate 300 Hz · cycle rate 37.5 Hz",
    "Resonanz des Rohrs": "Resonance of the pipe",
    "Resonanz": "Resonance",
    "Richtung": "Direction",
    "Roh": "Raw",
    "Rollwiderstand, Motorbremse und Luftwiderstand zugleich. Klein rollt weit.": "Rolling resistance, engine braking and drag at once. Small rolls far.",
    "Runde zählen, ohne sie zu fahren: zum Prüfen von Rundenzeiten und Ergebnistabelle.": "Count a lap without driving it, for checking lap times and the results table.",
    "Runde": "Lap",
    "Runden": "Laps",
    "Rundentempo der autonomen Autos.": "Lap pace of the autonomous cars.",
    "Rundenzeit": "Lap time",
    "Runterschalten": "Shift down",
    "Scan stoppen": "Stop scan",
    "Schaden": "Damage",
    "Scheinwerfer": "Headlights",
    "Schlechteste": "Worst",
    "Schließen": "Close",
    "Schreibt frei konfigurierbare Byte-Pakete an NUS RX (": "Writes freely configurable byte packets to NUS RX (",
    "Schritt: eine steil gezogene Gaskurve lässt ein Auto auf dem Tisch losschießen, und die Simulation kostet nichts.": "step: a steeply drawn throttle curve makes a car shoot off the table, and the simulation costs nothing.",
    "Schwarz ist die Fahrbahn, weiße Striche trennen die Streckenteile. Randsteine in Fahrtrichtung:": "Black is the roadway, white lines separate the parts. Kerbs, in the direction of travel:",
    "Selbsttest starten": "Start the self-test",
    "Selbsttest": "Self-test",
    "Select oder W. Reifen kommen beim Boxenstopp passend.": "Select or W. Tyres come to match at the pit stop.",
    "Sendet eine feste Testsequenz (Lenkung im Stand 0/25/50/75/100% links & rechts, dazu 3 sehr kurze Mini-Vorwärtsschrübe bei niedrigem Tempo, eine sanfte Bremse) und wertet parallel die Notify-Bytes 1-3 aus, um zu prüfen, ob das wirklich Gier-/Beschleunigungsdaten vom Auto sind.": "Sends a fixed test sequence (steering at a standstill 0/25/50/75/100 % left and right, plus 3 very short forward nudges at low speed and a gentle brake) and evaluates notify bytes 1–3 alongside it, to check whether those really are yaw and acceleration data from the car.",
    "Sendet eine feste Testsequenz (Lenkung im Stand 0/25/50/75/100% links & rechts, dazu 3 sehr kurze Mini-Vorwärtsschübe bei niedrigem Tempo, eine sanfte Bremse) und wertet parallel die Notify-Bytes 1-3 aus, um zu prüfen, ob das wirklich Gier-/Beschleunigungsdaten vom Auto sind.": "Sends a fixed test sequence (steering at a standstill 0/25/50/75/100 % left and right, plus 3 very short forward nudges at low speed and a gentle brake) and evaluates notify bytes 1–3 alongside it, to check whether those really are yaw and acceleration data from the car.",
    "Services/Characteristics deines Autos ohne diese Einschränkung. Wenn du mir die dort angezeigten UUIDs (Service + Characteristics + Eigenschaften: read/write/notify) gibst, kann ich die Steuerung direkt korrekt verdrahten.": "services and characteristics of your car without that restriction. If you give me the UUIDs shown there (service + characteristics + properties: read/write/notify), the control path can be wired up correctly straight away.",
    "Setzt das Layout aus den gemeldeten Kacheln zusammen und übernimmt es nach der ersten geschlossenen Runde, nur wenn noch keine Strecke liegt.": "Assembles the layout from the reported tiles and adopts it after the first closed lap, only if no track is loaded yet.",
    "Sie ist die Kontrolle und reproduziert das bekannte Muster auf 0,032 mm, sie muss also wieder 0x03 ergeben. Wenn nicht, ist die Messung nicht wiederholbar und die anderen Zahlen sind wertlos.": "It is the control and reproduces the known pattern to 0.032 mm, so it must give 0x03 again. If it does not, the measurement is not repeatable and the other numbers are worthless.",
    "Sie sagt, welcher Lenkanteil das Auto gerade noch auf der Bahn hält, nicht, um wie viele Zentimeter es dabei versetzt liegt. Der Zusammenhang zwischen beiden ist nicht gemessen und wird hier nicht behauptet. Brauchbar ist sie trotzdem: die Ideallinie und die Überholmanöver dürfen nie mehr als etwa die Hälfte des Kippwerts anfordern, und das ist eine Grenze, die vorher nicht bekannt war.": "It says which steering share still just keeps the car on the track, not by how many centimetres it is displaced. The relationship between the two is not measured and is not claimed here. It is useful all the same: the racing line and the overtaking moves must never ask for more than about half the tipping value, and that is a limit that was not known before.",
    "Sieben Rennmotoren": "Seven racing engines",
    "Simulation fahren": "Run the simulation",
    "Simulierte Motoren und eigene Sounds über Engine-Sim": "Simulated engines and custom sounds via Engine-Sim",
    "Slalom: Lenken im Wechsel": "Slalom: steer alternately",
    "So testen:": "How to test:",
    "Entwicklertools": "Developer tools",
    "Speichern und austauschen": "Save and exchange",
    "Speichern": "Save",
    "Standard aus, denn ein Auto macht bei der Lichthupe kein Geräusch – das hier ist eine Rückmeldung für den Fahrer und keine Simulation. Alle sechs sind Aufnahmen.": "Off by default, because a car makes no sound when it flashes its headlights – this is feedback for the driver and not a simulation. All six are recordings.",
    "Standard: rechter Trigger = Gas, linker Trigger = Bremse, linker Stick = Lenkung, X (links) = runterschalten, B (rechts) = hochschalten: wie bei einem Xbox-Controller. Klicke \"Neu zuweisen\" und betätige dann den gewünschten Knopf/Stick/Trigger am Controller.": "Default: right trigger = throttle, left trigger = brake, left stick = steering, X (left) = shift down, B (right) = shift up: as on an Xbox controller. Click \"Reassign\" and then operate the button, stick or trigger you want on the controller.",
    "Start / Ziel": "Start / finish",
    "Start / Ziel, nicht auslegen": "Start / finish, do not lay down",
    "Start/Ziel herunterladen (SVG)": "Download start/finish (SVG)",
    "Start/Ziel und Boxengasse maßhaltig als SVG zum Ausdrucken.": "Start/finish and pit lane to scale, as SVG, ready to print.",
    "Start/Ziel zählt Runden und löst die Rundenzeit aus, und der Code dafür ist gemessen 0x0a. Dieses Blatt liefert ihn nicht: gemessen meldet es 0x03, und das ist die Linkskurve. Ausgelegt verdreht es die gelernte Strecke und zählt keine Runde. Es bleibt hier, weil es die einzige Vorlage ist, von der belegt ist, dass das Auto sie überhaupt liest, und weil die Probeblätter darauf aufbauen.": "Start/finish counts laps and triggers the lap time, and its code is measured as 0x0a. This sheet does not deliver it: measured, it reports 0x03, which is the left curve. Laid down, it garbles the learned track and counts no lap. It stays here because it is the only master proven to be readable by the car at all, and because the probe sheets build on it.",
    "Start/Ziel": "Start/finish",
    "Startaufstellung, ziehen oder mit den Pfeilen sortieren": "Starting grid, drag or sort with the arrows",
    "Startseite": "Home screen",
    "Steht": "Stopped",
    "Steuerkreuz:": "D-pad:",
    "Steuern": "Drive",
    "Sicherung":
      "Backup",
    "Alles, was diese App sich merkt, in einer Datei: Fahreinstellungen und Renneinstellungen, Autonamen und Farben, Streckenlayouts, die vollständige Rundenzeit-Historie, Motorwerkstatt, Aufnahmen und die Tastenbelegung des Gamepads.":
      "Everything this app remembers, in one file: driving and race settings, car names and colours, track layouts, the complete lap time history, engine workshop, recordings and the gamepad button mapping.",
    "Sicherung speichern":
      "Save a backup",
    "Laden führt zusammen und ersetzt nicht: was in der Sicherung steht, wird gesetzt, und was seither dazugekommen ist, bleibt. Eine Strecke von gestern überlebt also eine Sicherung von vorletzter Woche.":
      "Loading merges rather than replaces: what the backup contains is applied, and whatever has been added since stays. So a track built yesterday survives a backup from the week before last.",
    "Sicherung laden":
      "Load a backup",
    "Warum es diese Datei braucht.":
      "Why this file is needed.",
    "Die App legt alles im Browser ab, und ein Browser darf diesen Speicher aufräumen – beim Löschen von Websitedaten, im privaten Fenster, auf einem iPhone auch nach längerer Zeit ohne Besuch. Eine Abstimmung ist danach schnell wieder eingestellt, eine Rundenzeit-Historie nicht.":
      "The app keeps everything in the browser, and a browser is allowed to clear that storage – when site data is deleted, in a private window, on an iPhone even after a longer time without a visit. A setup is quickly dialled in again afterwards, a lap time history is not.",
    "Eine Sicherung lädt auch dann, wenn sie aus einer älteren Fassung stammt. Einstellungen, die es damals noch nicht gab, bleiben stehen und werden genannt – sie verschwinden nicht stillschweigend.":
      "A backup loads even when it comes from an older version. Settings that did not exist back then keep their value and are named – they do not disappear silently.",
    "Querlage: das Auto hält sich selbst auf der Bahn, so wie ein autonomer Ghost. Dein Lenk-Input bestimmt dabei nur noch, wo auf der Bahn – nach rechts heißt weiter rechts, nicht „mehr einschlagen“.":
      "Lateral position: the car keeps itself on the track, like an autonomous ghost. Your steering input then only sets where on the track – right means further right, not “turn in more”.",
    "Voll: wie Querlage, aber das Auto bestimmt auch die Querlage selbst. Lenken tut dann nichts mehr, Gas und Bremse bleiben bei dir.":
      "Full: like lateral position, but the car sets the lateral position itself too. Steering then does nothing; throttle and brake stay with you.",
    "Beide brauchen eine eingescannte Strecke und die Bahn-Stellung (nicht Ausdruck). Ohne beides steuerst du normal weiter – auch in Voll, denn ohne die Streckendaten würde ein Auto mit gerade gestellten Rädern in die Bande fahren.":
      "Both need a scanned track and the rail setting (not printout). Without those you keep steering normally – in Full as well, because without the track data a car with its wheels held straight would drive into the barrier.",
    "Bei gelber Flagge oder in der Einführungsrunde hält sich das Auto unabhängig von dieser Einstellung selbst – das braucht die Regelung dort, damit sie greifen kann.":
      "Under a yellow flag or during the formation lap the car keeps itself on track regardless of this setting – the control there needs that in order to work.",
    "Querlage":
      "Lateral position",
    "Steuerungsmodus":
      "Control mode",
    "Fahrhilfe, Fahrwerk, Getriebe, Masse und Reifen, Lenkung.":
      "Driver aid, suspension, gearbox, mass and tyres, steering.",
    "Und sobald das Auto keinen Streckencode mehr liest – weil es neben der Bahn liegt –, bekommst du die volle Kontrolle zurück, damit du selbst zurückfahren kannst. Das gilt auch bei gelber Flagge: dort bleibt nur das Tempo gedrosselt, gelenkt wird von dir. Die Umschaltung braucht die Entprellzeit aus „Abseits: Verzögerung“ (ab Werk eine Sekunde), weil ein einzelner Aussetzer beim Überfahren einer Kachelkante sonst als Abflug gelesen würde.":
      "And as soon as the car stops reading a track code – because it is off the track – you get full control back, so you can drive it back yourself. This applies under a yellow flag too: there only the speed stays limited, the steering is yours. The handover needs the debounce time from “Off-track: delay” (one second by default), because otherwise a single dropout while crossing a tile edge would read as leaving the track.",
    "Die vier Varianten „Licht an + Bit …“ sind anders zu prüfen: nicht mit Byte 12, sondern mit dem Auge.":
      "The four “Light on + bit …” variants are checked differently: not with byte 12, but with your eyes.",
    "Scheinwerfer einschalten, eine Variante wählen, aufs Auto schauen – wird das Vorderlicht heller, dunkler, oder ändert sich nichts? Byte 14 hat nach heutigem Stand genau ein Scheinwerfer-Bit; diese vier probieren aus, ob eines der bisher unbeobachteten Bits eine zweite Helligkeitsstufe auslöst. Ohne Auto ist hier nichts zu sehen.":
      "Turn the headlights on, pick a variant, watch the car – does the headlight get brighter, dimmer, or does nothing change? As things stand, byte 14 has exactly one headlight bit; these four try whether one of the bits nobody has observed yet triggers a second brightness level. Without a car there is nothing to see here.",
    "Licht an + Bit 2 (0x04)":
      "Light on + bit 2 (0x04)",
    "Licht an + Bit 3 (0x08)":
      "Light on + bit 3 (0x08)",
    "Licht an + Bit 4 (0x10)":
      "Light on + bit 4 (0x10)",
    "Licht an + Bit 6 (0x40)":
      "Light on + bit 6 (0x40)",
    "Stoppen": "Stop",
    "Strecke aus Teilen bauen, drehen, als Code weitergeben. Alle elf Teiletypen der Original-App sind dabei, auch die Engstelle.":
      "Build a track from pieces, rotate it, pass it on as a code. All eleven piece types from the original app are included, the narrow section too.",
    "Strafe je verpasstem Stopp (s)": "Penalty per missed stop (s)",
    "ganzen": "whole",
    "Layouts und nicht der Kachel. Sie kommen dazu, sobald eine Schließmessung vorliegt: eine kleine geschlossene Runde mit der neuen Kachel, und dann fallen Radius und Winkel eindeutig heraus – so wie bei der Haarnadel.":
      "layout, not of the tile. They will be added once a closing measurement exists: a small closed loop with the new tile, and radius and angle fall out uniquely – the same way the hairpin was solved.",
    "Strecke beim Fahren lernen": "Learn the track while driving",
    "Strecke": "Track",
    "Strecken benennen, laden und wieder löschen.": "Name tracks, load them and delete them again.",
    "Strecken-Ambience": "Track ambience",
    "Streckenansicht": "Track view",
    "Streckencode gemeldet, während der Mitschnitt der Original-App voll davon ist. Das Schreibpaket im Moment des ersten Codes dort ist byteweise die Form, die wir senden: im Dauerbetrieb unterscheidet uns also nichts. Was die Original-App aber": "track code, while the capture of the original app is full of them. The write packet at the moment of its first code is byte for byte the form we send, so nothing distinguishes us in steady state. What the original app does",
    "Streckencode": "Track code",
    "Streckeneditor": "Track editor",
    "Streckenlautstärke": "Track volume",
    "Streuung": "Spread",
    "Stufe": "Step",
    "Sweep 0→255 starten": "Start sweep 0→255",
    "Sweep Byte#:": "Sweep byte #:",
    "Sweep stoppen": "Stop sweep",
    "Sättigung": "Saturation",
    "TX abonnieren": "Subscribe to TX",
    "Tagesform": "Form of the day",
    "Tagesform, Fehler, Windschatten, Attacke, Gummiband. Auf 0 fährt jeder Ghost stur seine Zeit.": "Form of the day, mistakes, slipstream, attack, rubber band. At 0 every ghost stubbornly drives its own time.",
    "Tank & Schaden": "Fuel & damage",
    "Tank auf 5 % setzen, um den Notlauf zu prüfen": "Set the fuel to 5 % to check limp mode",
    "Tank beim Start (l)": "Fuel at the start (l)",
    "Tank und Zustand zurücksetzen": "Reset fuel and condition",
    "Tank": "Fuel",
    "Tankgewicht": "Fuel weight",
    "Tankverbrauch (%/s bei Vollgas)": "Fuel use (%/s at full throttle)",
    "Tastatur, Fahren": "Keyboard, driving",
    "Tastatur: Test und Fehlersuche am PC": "Keyboard, testing and debugging on a PC",
    "Tastatur:": "Keyboard:",
    "Tastenbelegung": "Key bindings",
    "Telemetrie aufzeichnen": "Record telemetry",
    "Testlauf starten": "Start the test run",
    "Tipp: Öffne in Chrome": "Tip: open in Chrome",
    "Ton bei Lichthupe": "Headlight-flash sound",
    "Ton": "Sound",
    // v0.4: aus dem Trail-Braking-Bonus ist die Bremsbalance geworden. Der Bonus wirkte
    // auf die Lenkgrenze und wurde dort weggeklemmt; die Balance wirkt auf die Anforderung
    // an die Vorderachse.
    // v0.4 Block E: die ehrliche Kennzeichnung der Ghost-Regler
    "WIP": "WIP",
    // Die <b>-Auszeichnungen zerlegen diese Saetze in eigene Textknoten, das Woerterbuch
    // ist also je BRUCHSTUECK geschluesselt und nicht je Satz. Genau in dieser Form stehen
    // sie im Dokument - abgeschrieben statt getippt, weil ein Zeichen Unterschied reicht.
    "Noch nicht gebaut": "Not built yet",
    "– der Schalter ist deshalb gesperrt statt wirkungslos.":
      "– the switch is therefore disabled rather than ineffective.",
    ": ohne gelesene oder gebaute Kacheln weiß der Ghost nicht, wo eine Kurve ist, und der Regler multipliziert eine Null.":
      ": without read or built tiles the ghost does not know where a corner is, and the slider multiplies by zero.",
    ", und selbst dann sind es gemessen nur 12 von 127 Lenkschritten – im Leitplanken-Modus hält sich das Auto ohnehin selbst.":
      ", and even then it is a measured 12 of 127 steering steps – in guard-rail mode the car holds the track by itself anyway.",
    "nahe beieinander, sonst bleibt der Versatz null.":
      "close together, otherwise the offset stays zero.",
    "Braucht ein Streckenlayout": "Needs a track layout",
    "Braucht mindestens zwei Ghosts": "Needs at least two ghosts",
    "Ghost: Abschlag für den Führenden": "Ghost: leader handicap",
    "Um wie viel langsamer.": "By how much slower.",
    "nicht umgesetzt": "not implemented",
    "Teilweise im Aufbau.": "Partly under construction.",
    "Kurvendrosselung, Ideallinie und Linienmodell wirken nur, wenn eine Strecke mit mindestens drei Teilen vorliegt – entweder im Editor gebaut oder beim Fahren gelernt. Ohne Streckenlayout rechnen sie mit einer Null.":
      "Corner slowdown, racing line and line model only work once a track with at least three parts exists – either built in the editor or learned while driving. Without a track layout they compute with a zero.",
    "Drei der Regler hier wirken nur, wenn eine Strecke mit mindestens drei Teilen vorliegt – entweder im Editor gebaut oder beim Fahren gelernt. Ohne Streckenlayout rechnen sie mit einer Null. Sie sind unten mit":
      "Three of the sliders here only work once a track of at least three pieces exists – either built in the editor or learned while driving. Without a layout they multiply by zero. They are marked below with",
    "gekennzeichnet, samt dem, was ihnen fehlt.":
      "along with what each of them is missing.",
    "Wie viel Tempo in Kurven abgegeben wird. Braucht ein Streckenlayout: ohne gelesene oder gebaute Kacheln weiß der Ghost nicht, wo eine Kurve ist, und der Regler multipliziert eine Null.":
      "How much pace is given up in corners. Needs a track layout: without read or built tiles the ghost does not know where a corner is, and the slider multiplies by zero.",
    "Außen anstellen, innen scheiteln, außen heraus. Braucht ein Streckenlayout, und selbst dann sind es gemessen nur 12 von 127 Lenkschritten – im Leitplanken-Modus hält sich das Auto ohnehin selbst. Links = aus.":
      "Set up wide, clip the apex, exit wide. Needs a track layout, and even then it is a measured 12 of 127 steering steps – in guard-rail mode the car holds the track by itself anyway. Left = off.",
    "Gegen gegenseitiges Rammen. Braucht mindestens zwei Ghosts nahe beieinander, sonst bleibt der Versatz null. Blind: kein Byte meldet die Querlage. Links = aus.":
      "Against cars ramming each other. Needs at least two ghosts close together, otherwise the offset stays zero. Blind: no byte reports lateral position. Left = off.",
    "Einführungsrunde mit Boxengassen-Tempo, frei beim ersten Überfahren von Start/Ziel. Noch nicht gebaut – der Schalter ist deshalb gesperrt statt wirkungslos.":
      "Formation lap at pit-lane pace, released on the first crossing of start/finish. Not built yet – the switch is therefore disabled rather than ineffective.",
    "Zurück auf die Vorgabe aus den Optionen": "Back to the default from the options",
    // v0.4 Block F: die Checkliste auf der Startseite
    "Was du zum Fahren brauchst": "What you need in order to drive",
    "Schön, aber nicht nötig": "Nice, but not required",
    "Chrome": "Chrome",
    "(oder Edge) auf PC oder Android, mit erteilter Bluetooth-Berechtigung. Web Bluetooth gibt es in Safari und Firefox nicht.":
      "(or Edge) on PC or Android, with Bluetooth permission granted. Web Bluetooth does not exist in Safari or Firefox.",
    "Ein": "A",
    "Carrera-Hybrid-Auto": "Carrera Hybrid car",
    "mit Firmware ab": "with firmware from",
    "August 2026": "August 2026",
    ". Ältere melden andere Bytes.": " onwards. Older ones report different bytes.",
    "Einen": "A",
    "Bluetooth-Controller": "Bluetooth controller",
    ". Getestet mit DualShock 4 und DualSense. Mit der Tastatur geht es auch, aber deutlich schlechter – sie kennt nur ganz oder gar nicht.":
      ". Tested with DualShock 4 and DualSense. A keyboard works too, but far worse – it only knows all or nothing.",
    "Eine": "A",
    "CH-Strecke": "CH track",
    "– oder der": "– or the",
    "Start/Ziel-Ausdruck": "start/finish printout",
    "samt Boxengasse aus dem Tab Strecke. Ohne beides fährt es sich auch, nur zählt dann niemand die Runden.":
      "with pit lane, from the Track tab. It drives without either, only then nobody counts the laps.",
    "Weitere Autos": "More cars",
    "als autonome Gegner.": "as autonomous opponents.",
    "Und dann in dieser Reihenfolge:": "And then in this order:",
    "verbinde dein Auto in der": "connect your car in the",
    "Garage": "Garage",
    ", stelle die": ", set the",
    "nach deinem Geschmack ein, und fahre im": "to your taste, and drive in the",
    "Cockpit": "Cockpit",
    ". Einige Optionen lassen sich direkt dort anpassen.":
      ". Some options can be adjusted right there.",
    "Targets lesen": "Read targets",
    // Ein eigenstaendiges <b>und</b> im Ghost-Lerntext, hervorgehoben weil es dort die
    // Aussage traegt: schneller UND ohne Abgang, nicht das eine oder das andere.
    "und": "and",
    // v0.4 Block H: Sitzungsdaten
    // v0.4 Block H: Sektoren und Boxengassen-Varianten
    "Eine Sekunde halten": "Hold for one second",
    "für die gelbe Flagge: alles rollt mit": "for the yellow flag: everything rolls on at",
    "km/h mittig weiter, kein Überholen, Lichter blinken. Nochmal eine Sekunde halten startet die Ampel und gibt wieder frei. Der Knopf im Cockpit reicht mit einem Tipp – die Taste liegt neben allem anderen, der Knopf nicht.":
      "km/h in the middle, no overtaking, lights flashing. Holding for another second starts the lights and releases. The cockpit button needs only a tap – the key sits next to everything else, the button does not.",
    "Sektoren": "Sectors",
    "Überfahrten je Runde. Nur": "Crossings per lap. Only",
    "Überfahrten je Runde.": "Crossings per lap.",
    "experimentell": "experimental",
    "Überfahrten je Runde": "Crossings per lap",
    "1 (aus)": "1 (off)",
    "Im Bahn-Modus": "In track mode",
    "(Editor) bestimmt die Strecke die Sektorzahl: jede Start/Ziel-Gerade ist eine Sektorgrenze, die erste ist die Rundenlinie.":
      "(editor) the track determines the sector count: each start/finish straight is a sector boundary, the first one is the lap line.",
    "Ohne Bahn": "Without a track",
    "(Ausdruck) gilt dieser Regler - dort legt man die Muster selbst hin, drei Ausdrucke über eine Runde verteilt sind drei Sektoren. Eine Sektorzeit ist die":
      "(print mode) this control applies - there you place the patterns yourself, three printouts spread over a lap are three sectors. A sector time is the",
    "Nur": "Only",
    "ohne Bahn": "without a track",
    "sinnvoll: auf der CH-Schiene gibt es genau ein Start/Ziel, also ist jede Überfahrt eine Runde. Im Ausdruck-Modus legt man die Muster selbst hin – drei Ausdrucke über eine Runde verteilt sind drei Sektoren. Eine Sektorzeit ist die":
      "makes sense: the CH rail has exactly one start/finish, so every crossing is a lap. In print mode you place the patterns yourself – three printouts spread over a lap are three sectors. A sector time is the",
    "gemessene": "measured",
    "Zeit zwischen zwei Kontakten und nicht die Rundenzeit geteilt durch drei: genau darin liegt der Wert, denn die Streuung sagt,":
      "time between two contacts, not the lap time divided by three: that is exactly where the value lies, because the spread tells you",
    "wo": "where",
    "Zeit verlorengeht.": "time is being lost.",
    "Wo ist die Boxengasse?": "Where is the pit lane?",
    "Aus: kein Tempolimit, kein Service, auch nicht über einen Ausdruck.":
      "Off: no speed limit, no service, not even via a printout.",
    "Wo die Boxengasse liegt": "Where the pit lane is",
    "Boxeneinfahrt zählt": "Pit entry counts as",
    "1 Runde: die erste Überfahrt zählt, die zweite nicht – richtig, wenn die Boxengasse parallel zu Start/Ziel liegt. 0 Runden: auch die erste wird wieder abgezogen. Nur bei „Doppelter Start-Ausdruck“.":
      "1 lap: the first crossing counts, the second does not – right when the pit lane runs parallel to start/finish. 0 laps: the first one is taken back as well. Only with “Double start printout”.",
    "1 Runde": "1 lap",
    "Boxenstopp ansagen": "Announce pit stop",
    "Wenn der Stopp über den doppelten Start-Ausdruck ausgelöst wird: „Boxenstopp eingeleitet“. Nicht beim Knopf.":
      "When the stop is triggered by the double start printout: “Pit stop initiated”. Not for the button.",
    "Zeitfenster des Doppel-Ausdrucks": "Double-printout time window",
    "0 Runden": "0 laps",
    "So lange nach dem ersten Muster zählt ein zweites als Boxeneinfahrt. Liegt der zweite Kontakt später als eine halbe beste Runde, ist er eine Runde und keine Box. Nur bei „Doppelter Start-Ausdruck“.":
      "For this long after the first pattern, a second one counts as a pit entry. If the second contact comes later than half a best lap, it is a lap and not a pit entry. Only with “Double start printout”.",
    ": zwei Ausdrucke im Abstand von 50 cm. Kommt der zweite Musterkontakt innerhalb des Zeitfensters (darunter einstellbar, mindestens 1 s nach dem ersten), ist er eine Boxeneinfahrt: keine Runde, keine Zeitansage. Danach piept es, das Tempolimit von 60 km/h gilt 4 s, und ein Anhalten in dieser Zeit startet den Service.":
      ": two printouts 50 cm apart. If the second pattern contact comes within the time window (set below, at least 1 s after the first), it is a pit entry: no lap, no time announcement. Then it beeps, the 60 km/h limit holds for 4 s, and stopping within that time starts the service.",
    "und ob sie überhaupt aktiv ist, steht in den":
      "and whether it is active at all is set under",
    ", direkt unter dem Tankverbrauch: das sind Einstellungen. Hier stehen die Angaben zum":
      ", right below fuel consumption – those are settings. What lives here are the details of the",
    "– welchen Code es auslöst und wie man es druckt.":
      "– which code it triggers and how to print it.",
    "Überall halten": "Stop anywhere",
    "Neben der Strecke": "Beside the track",
    "Neben der Strecke (Byte 12 = 0x00)": "Beside the track (byte 12 = 0x00)",
    "Doppelter Start-Ausdruck (experimentell)": "Double start printout (experimental)",
    "Doppelter Start-Ausdruck": "Double start printout",
    "ist die Vorgabe: ein angeforderter Boxenstopp wird durch Anhalten bedient, egal wo. Braucht keinen Ausdruck und keine Schiene.":
      "is the default: a requested pit stop is served by stopping, anywhere. Needs no printout and no rail.",
    "nimmt Byte 12 = 0x00 als Boxengasse. Nur auf der CH-Schiene sinnvoll – ohne Schiene ist das Auto praktisch immer „abseits“, und dann wäre die ganze Strecke Boxengasse.":
      "takes byte 12 = 0x00 as the pit lane. Only meaningful on the CH rail – without a rail the car is off-track almost always, and then the whole course would be pit lane.",
    "eines": "a single",
    "Gefahrene Sitzungen": "Sessions driven",
    "Nach jedem beendeten Rennen abgelegt, auf diesem Gerät. Gespeichert werden Rundenzeiten, Datum, Streckencode, Modus, die verwendete Abstimmung und die gefahrene Strecke – und zwar":
      "Stored after every finished race, on this device. Lap times, date, track code, mode, the setup used and the distance driven – and that",
    "zweimal": "twice",
    ": als simulierte Kilometer, die zum Tacho passen, und als echte Meter, die das Modellauto auf dem Teppich zurückgelegt hat. Nur eine der beiden zu speichern wäre eine willkürliche Wahl.":
      ": as simulated kilometres matching the speedo, and as real metres the model car actually covered on the carpet. Storing only one of them would be an arbitrary choice.",
    "Alles als CSV exportieren": "Export everything as CSV",
    "Alle Sitzungsdaten löschen": "Delete all session data",
    "Die Zuordnung läuft über die Bluetooth-Gerätekennung, damit dasselbe Auto bei anderer Verbindungsreihenfolge dieselben Kilometer behält. Genau deshalb gibt es den Löschknopf.":
      "Cars are matched by their Bluetooth device id, so the same car keeps its mileage even when connected in a different order. That is exactly why the delete button exists.",
    "noch nichts gespeichert": "nothing stored yet",
    "Bremsbalance": "Brake bias",
    "Furz 2": "Fart 2",
    "Porsche 911 GT3 R: Boxer-6, Einzeldrosseln": "Porsche 911 GT3 R: flat-6, individual throttle bodies",
    "Stra\u00dfen- und Rallyeklassiker (WIP)": "Road and rally classics (WIP)",
    "Lamborghini Countach LP500: V12, 60 Grad, sechs Weber":
      "Lamborghini Countach LP500: V12, 60 degrees, six Webers",
    "Subaru Impreza WRX STI 1999: Boxer-4, Turbo":
      "Subaru Impreza WRX STI 1999: flat-4, turbo",
    "Bremsenquietschen": "Brake squeal",
    "Eigener Regler. Es hing vorher am Motorregler und war deshalb nicht getrennt leiser zu bekommen.":
      "Its own slider. It used to hang on the engine volume, so it could not be turned down on its own.",
    "Balance / Lenkung": "Bias / steering",
    "Auch auf dem Steuerkreuz hoch/runter – links/rechts blättert seit v0.5.18 die Cockpit-Schirme. Der volle Lenkeinschlag ist mechanisch 45 Grad; bei 100 % fordert voller Stick genau ihn an.":
      "Also on the D-pad, up/down – left/right pages through the cockpit screens since v0.5.18. Full steering lock is mechanically 45 degrees; at 100% a full stick asks for exactly that.",
    "GELB · AUTOPILOT": "YELLOW · AUTOPILOT",
    "Wieviel der Bremse an der Vorderachse ankommt.": "How much of the brake reaches the front axle.",
    "Nach vorn": "Forward",
    ": das Auto schiebt beim Anbremsen geradeaus.": ": the car pushes straight on under braking.",
    "Nach hinten": "Rearward",
    ": mehr Lenkung beim Anbremsen, also Trail-Braking, dafür wird das Heck leicht. 62 % ist die Mittelstellung und ändert nichts.":
      ": more steering under braking, i.e. trail braking, at the cost of a light rear end. 62% is the middle setting and changes nothing.",
    "Trocken": "Dry",
    "Und vieles mehr …": "And much more …",
    "Variante wählen, dann": "Choose a variant, then",
    "Ventiltrieb": "Valvetrain",
    "Verbinde einen Controller per USB/Bluetooth und drücke einen Knopf, damit der Browser ihn erkennt (Web-Gamepad-API meldet sich erst nach der ersten Eingabe).": "Connect a controller by USB or Bluetooth and press a button so the browser notices it (the Web Gamepad API only reports after the first input).",
    "Verbinden und Services lesen": "Connect and read services",
    "Verbinden": "Connect",
    "Verbindung": "Connection",
    "Vergeben sind 2 Gerade, 3 Linkskurve, 4 Rechtskurve, 5 und 6 Haarnadel, 10 Start/Ziel. 14 lässt Luft für die Kurven und die Schikane, die noch nie überfahren wurden. Sollte 14 doch belegt sein, liegen 18 und 22 daneben.": "Taken are 2 straight, 3 left curve, 4 right curve, 5 and 6 hairpin, 10 start/finish. 14 leaves room for the curves and the chicane that have never been driven over. Should 14 turn out to be taken after all, 18 and 22 sit next to it.",
    "Vollbild umschalten": "Toggle fullscreen",
    "Vollbild": "Fullscreen",
    "Voller Tank macht träger. Links = aus.": "A full tank makes it sluggish. Left = off.",
    "Vollständige Gestaltungsfreiheit für deine Carrera Hybrid Bahn": "Complete creative freedom for your Carrera Hybrid track",
    "Vollständige Reparatur dauert (s)": "A full repair takes (s)",
    "Von 100 % auf 0. Nicht linear: die ersten 25 % in 1/10 der Zeit, die letzten 25 % in 4/10.": "From 100 % to 0. Not linear: the first 25 % in 1/10 of the time, the last 25 % in 4/10.",
    "Vorbeifahrten, Regen, Donner.": "Cars going past, rain, thunder.",
    "Voreinstellungen": "Presets",
    "Vorgabe führt nicht zu einer eckigen Bewegung. Das Auto hat Masse, die Reifen brauchen Zeit, die Lenkung hat eine Höchstgeschwindigkeit. Wer das einmal gesehen hat, versteht, warum geschmeidige Vorgaben besser fahren: und das gilt für Programme genauso wie für Daumen.": "input does not produce square movement. The car has mass, the tyres need time, the steering has a top speed. Once you have seen that, you understand why smooth inputs drive better, and that holds for programs just as much as for thumbs.",
    "Vorlauf 0: kein Vorlauf": "Lead-in 0: none",
    "Vorlauf 1 ist das wichtigste Blatt.": "Lead-in 1 is the sheet that matters most.",
    "Vorlauf 1: ein dünner Balken": "Lead-in 1: one thin bar",
    "Vorlauf 2: zwei": "Lead-in 2: two",
    "Vorlauf 4: vier, das Original": "Lead-in 4: four, the original",
    "Vorlauf 8: acht": "Lead-in 8: eight",
    "Vorlauf": "Lead-in",
    "Vorlauf-Blätter: wieviel Anlauf braucht der Leser?": "Lead-in sheets: how much run-up does the reader need?",
    "Vorne Standlicht, hinten Bremslicht. Taste": "Front running light, rear brake light. Key",
    "Vorwärts": "Forward",
    "Was aus den Daten kommt und was nicht.": "What comes from the data and what does not.",
    "Was das Auto daraus macht": "What the car makes of it",
    "Was die Zahl bedeutet und was nicht.": "What the number means and what it does not.",
    "Web Bluetooth erlaubt standardmäßig nur Zugriff auf Services, die vorab bekannt sind. Da wir das genaue Carrera-Protokoll noch nicht kennen, versuchen wir es unten mit einer Liste gängiger Custom-Service-UUIDs (Nordic UART, HM-10/FFE0, FFF0 etc.): falls dein Auto eine andere UUID benutzt, füge sie manuell hinzu.": "By default Web Bluetooth only allows access to services known in advance. Since we do not yet know the exact Carrera protocol, below we try a list of common custom service UUIDs (Nordic UART, HM-10/FFE0, FFF0 and so on): if your car uses a different UUID, add it by hand.",
    "Wechselt einmal zu einem zufälligen Zeitpunkt.": "Changes once, at a random moment.",
    "Weil Carrera die Teile ab 1 durchnumeriert, sind die bekannten Codes Katalognummern und keine Bitmuster. Von 22 durchgerechneten Schemata erklären genau zwei das bekannte Muster: der Abstand der dicken Balken, und die Zahl der breiten Lücken. Dieses Blatt ist so gebaut, dass beide dieselbe Zahl ergeben, nämlich 14. Trifft eine der beiden Regeln, meldet das Auto 0x0e.": "Because Carrera numbers its track pieces from 1 upwards, the known codes are catalogue numbers, not bit patterns. Of 22 schemes computed, exactly two explain the known pattern: the distance between the thick bars, and the number of wide gaps. This sheet is built so that both give the same number, namely 14. If either rule holds, the car reports 0x0e.",
    "Weiter gedacht: Ghostcars selbst programmieren": "Going further: program ghost cars yourself",
    "Welchen Code es auslöst, ist nicht vorhergesagt, und das kann niemand, solange die Kodierregel unbekannt ist. Überfahren, unten mit der Muster-Sonde ablesen, im Feld Auslöse-Code eintragen.": "Which code it triggers is not predicted, and nobody can predict it while the encoding rule is unknown. Drive over it, read it off below with the pattern probe, enter it in the trigger-code field.",
    "Welchen Code meldet dieses Teil?": "Which code does this part report?",
    "Wenn hier nur": "If all you see here is",
    "Wetter umschalten (Regen / trocken)": "Toggle the weather (rain / dry)",
    "Wetter umschalten": "Toggle the weather",
    "Wetter zu Beginn": "Weather at the start",
    "Wetter ändert sich": "Weather changes",
    "Wetter, Reifentemperatur, ABS": "Weather, tyre temperature, ABS",
    "Wichtig beim Drucken:": "Important when printing:",
    "Wie das Uebrige zu lesen ist.": "How to read the rest.",
    "Wie viel Tempo in Kurven abgegeben wird.": "How much pace is given up in corners.",
    "Wiedergabe": "Replay",
    "Wiedergabe-Log": "Replay log",
    "Wieviel": "How much",
    "Wird nach dem ersten Lauf gezeichnet: Geschwindigkeit und der": "Drawn after the first run: speed and the",
    "Womit dieses Werkzeug die Haarnadel gefunden hat.": "How this tool found the hairpin.",
    "Wähle die Characteristic, an die Lenk-/Gas-Kommandos geschrieben werden sollen (wird beim Verbinden automatisch auf NUS RX gesetzt).": "Choose the characteristic the steering and throttle commands are written to (set to NUS RX automatically on connecting).",
    "ZU SCHNELL FÜR R": "TOO FAST FOR R",
    "Zeichne den Lenkwinkel über den Kachelindex und lass den Ghost damit fahren. Wie nah kommst du an die 85 %?": "Draw the steering angle against the tile index and let the ghost drive it. How close do you get to the 85 %?",
    "Zeichnet": "Records",
    "Zeitleiste der Codes": "Timeline of the codes",
    "Zeitleiste leeren": "Clear the timeline",
    "Zieh die Punkte in den beiden Kurven nach oben oder unten. Links legst du fest, wie stark das Auto über die Zeit Gas gibt oder bremst, rechts wie es lenkt. Dann": "Drag the points in the two curves up or down. On the left you set how hard the car accelerates or brakes over time, on the right how it steers. Then",
    "Ziel-Characteristic": "Target characteristic",
    "Zug": "Bank",
    "Zuletzt überfahrenes Muster:": "Last pattern driven over:",
    "Zum Herausfinden, was ein Streckenteil wirklich sendet: zum Beispiel die 180-Grad-Haarnadel. Auto verbinden, hier auf": "For finding out what a track part really sends, the 180-degree hairpin, for instance. Connect a car, press",
    "Zum Weitergeben: der Text unten enthält": "To pass on: the text below contains",
    "Zurück": "Undo",
    "Zurücksetzen": "Reset",
    "Zustand": "Condition",
    "Zwei Kurven, zwei Autos, dieselbe Strecke: und die Rundenzeiten sagen, welche Kurve die bessere war.": "Two curves, two cars, the same track: and the lap times say which curve was the better one.",
    "Zwei Lesearten, kein Sensorschalter.": "Two ways of reading, not a sensor switch.",
    "Zwei eigene Ghosts gegeneinander.": "Two of your own ghosts against each other.",
    "Zweiklang (gerechnet)": "Two-tone (synthesised)",
    "Zyklusrate": "Cycle rate",
    "Zylinder": "Cylinders",
    "Zylinderzahl, Bauart, Kurbelwelle und Drehzahl stehen in den technischen Angaben, ebenso die Bankaufteilung, die aus der Zündfolge folgt. Hubraum, Bohrung und Hub gehen in dieses Modell nicht ein: es synthetisiert Zündereignisse und rechnet keine Gasdynamik. Rohrlänge, Impuls, Abfall, Sättigung, Klappern, Streuung und Ansauganteil sind nach Gehör gewählt, nicht abgeleitet.": "Cylinder count, layout, crankshaft and engine speed are given in the technical data, as is the bank split, which follows from the firing order. Displacement, bore and stroke do not enter this model: it synthesises firing events and computes no gas dynamics. Pipe length, pulse, decay, saturation, clatter, scatter and intake share are chosen by ear, not derived.",
    "Zählen starten": "Start counting",
    "Zählt Runden und löst im Rennmodus die Rundenzeit aus. Erwarteter Code": "Counts laps and triggers the lap time in race mode. Expected code",
    "Zündabständen": "firing intervals",
    "Zündfolge über 720°": "Firing order over 720°",
    "Zündfolge": "firing order",
    "Zündrate": "Firing rate",
    "Zündstreuung": "Firing scatter",
    "abseits der Bahn": "off the track",
    "acht": "eight",
    "alle": "all",
    "ansteigt: eine Kurve, die schon mit festem Radius gefahren wird, braucht keine Bremse mehr. Beides ist eine": "rises, a corner already being taken at a constant radius needs no more braking. Both are a",
    "auf 0, hat der Sensor während der ganzen Messung kein gedrucktes Blatt gesehen, dann liegt es nicht an der Entschlüsselung, sondern daran, dass nichts zu lesen war. Zählt der": "at 0, the sensor saw no printed sheet at all during the whole measurement, then the problem is not the decoding but that there was nothing to read. If the",
    "auf Strecke": "on track",
    "auf der Bahn": "on track",
    "aus einem Foto, wenn du das Original-PDF hast, nimm lieber das.": "from a photograph: if you have the original PDF, use that instead.",
    "aus": "off",
    "bekannt als": "known as",
    "bereit": "ready",
    "betreffen: nicht die Rennlänge, nicht das Wetter, nicht die Strecke, denn die gehören zum Rennen und nicht zum Auto.": ": not the race length, not the weather, not the track, because those belong to the race and not to the car.",
    "bewegt": "moving",
    "das ist, meldet kein Byte. Diese Messung ersetzt das Raten: sie schickt einen": "that is, no byte reports. This measurement replaces the guessing: it sends a",
    "der Fahrbahnbreite, ausgemessen aus den Streckenkarten der Original-App. Die dünne farbige Linie ist die berechnete Ideallinie, krümmungsärmster Verlauf innerhalb der Fahrbahn. Ihre Farbe zeigt, ob dort gebremst würde:": "of the roadway width, measured from the track maps of the original app. The thin coloured line is the computed racing line, the least-curvature path within the roadway. Its colour shows whether there would be braking:",
    "der Lenkvarianz allein aus Kachelindex und Position innerhalb der Kachel erklärt.": "of the steering variance is explained by tile index and position within the tile alone.",
    "die Kachelart: wenn hier etwas anderes steht als erwartet, liegt der Fehler nicht bei der Auswertung, sondern beim Aufbau des Pakets.": "the tile type, if something other than expected appears here, the fault is not in the interpretation but in how the packet is built.",
    "diese Stufe halten": "hold this step",
    "diese Übersicht": "this overview",
    "dieser Farbe": "this colour",
    "drücken.": "press.",
    "echte, garantiert gültige": "real, guaranteed valid",
    "eckige": "square",
    "ein dünner Balken": "one thin bar",
    "eine breite Lücke": "a wide gap",
    "fahr über ein beliebiges ausgedrucktes Muster, hier steht sofort, welchen Code das Auto meldet. Sicher bekannt sind": "drive over any printed pattern, the code the car reports appears here at once. Known for certain are",
    "festen": "fixed",
    "freie Notiz (optional)": "free note (optional)",
    "gesendet hat und wir nie:": "sent, and we never do:",
    "getrennt": "disconnected",
    "gleichmäßig (Flat-Plane)": "even (flat-plane)",
    "grün am Gas": "green on the throttle",
    "heißt „gerade keine Lesung“ und ist der häufigste Wert von allen, das ist normal und kein Fehler.": "means “no reading right now” and is the most common value of all, that is normal and not a fault.",
    "heißt „kein Muster erkannt“. Interessant ist alles andere.": "means “no pattern recognised”. Everything else is interesting.",
    "heißt: den kennen wir noch nicht.": "means: we do not know that one yet.",
    "heißt: hier ist nichts kaputt, es war nur nicht prüfbar – zum Beispiel Töne über": "means: nothing is broken here, it just could not be checked – sound files over",
    "hoch, obwohl Byte 12 nur": "high, although byte 12 only",
    "hochschalten": "shift up",
    "hochschalten, und aus dem Rückwärtsgang wieder heraus": "upshift, and out of reverse again",
    "in Kurven deutlich bewegt, lässt sich eine Kurve daran erkennen, ganz ohne Barcode.": "moves noticeably in corners, a corner can be recognised from it, with no barcode at all.",
    "in den Optionen prüfen. Er setzt Bit 5 in Byte 14; steht er aus, geht Bit 7 hinaus und das schaltet den Streckensensor ab, gemessen 0 Lesungen in 551 Fahrmeldungen. Genau dieses Bit hat diese App zwölf Aufzeichnungen lang gesendet, siehe Doku, „Auf der Bahn oder ohne Bahn“.": "in the options. It sets bit 5 in byte 14; with it off, bit 7 goes out and that switches the track sensor off, measured 0 readings in 551 packets while driving. This app sent exactly that bit for twelve captures; see the docs, “on track or off track”.",
    "ist der Kachelzähler,": "is the tile counter,",
    "ist die Lichthupe.": "is the headlight flash.",
    "jedes": "every",
    "kein Abgang dabei. Nach einem Abgang wird zurückgenommen und vorsichtiger weiterprobiert.": "no departure happened. After a departure it is rolled back and tried again more cautiously.",
    "kein Auto verbunden": "no car connected",
    "kein Controller erkannt": "no controller detected",
    "kein Ton": "no sound",
    "kein Vorlauf": "no lead-in",
    "kein": "no",
    "keine Aufnahme": "no recording",
    "keine Autos verbunden": "no cars connected",
    "keine Variante aktiv (normales Paket)": "no variant active (normal packet)",
    "keine": "none",
    "keinen einzigen": "not a single one",
    "km/h echt": "km/h actual",
    "kontinuierlich alle": "continuously every",
    "lang (2 Byte Präfix + 17 Datenbytes + 1 Prüfsumme), gesendet alle ~45ms. Byte-Offset 6 = Gas/Bremse (": "long (2 prefix bytes + 17 data bytes + 1 checksum), sent every ~45 ms. Byte offset 6 = throttle/brake (",
    "langsam über ein Muster fahren": "drive slowly over a pattern",
    "langsam": "slow",
    "lenken links": "steer left",
    "lenken rechts": "steer right",
    "links blau-weiß": "left blue-and-white",
    "links": "left",
    "links, sie hat sehr wohl eigene Codes, und sie fügen sich in das Muster der anderen:": "left, it does have codes of its own, and they fit the pattern of the others:",
    "links/rechts für die 60-Grad-Kurve,": "left/right for the 60-degree curve,",
    "links/rechts für die Haarnadel. Ein Wert in": "left/right for the hairpin. A value in",
    "mehr": "more",
    "mit Sonde ermitteln": "determine with the probe",
    "ms/Schritt": "ms/step",
    "nicht belegt": "unbound",
    "nicht verbunden": "not connected",
    "noch kein Paket": "no packet yet",
    "noch keine Wiedergabe.": "no replay yet.",
    "noch nicht gelaufen": "not run yet",
    "noch nichts gemessen": "nothing measured yet",
    "noch nichts gezählt": "nothing counted yet",
    "noch nichts": "nothing yet",
    "nur Byte 10 = 0x30": "byte 10 = 0x30 only",
    "oder": "or",
    "quer": "landscape",
    "rechts rot-weiß": "right red-and-white",
    "rechts und": "right and",
    "rechts": "right",
    "rot beim Bremsen": "red under braking",
    "runtergefahren": "went off",
    "runterschalten (aus dem 1. Gang in N, aus N in R)": "shift down (from 1st to N, from N to R)",
    "runterschalten. In Automatik: unter 10 km/h Rückwärtsgang, von Hand aus dem 1. Gang in N und aus N in R": "downshift. In automatic: reverse below 10 km/h; by hand, out of 1st into N and out of N into R",
    "s. Verlässt es die Bahn, wird die Stufe festgehalten und die Messung endet. Wenn du es": "s. If it leaves the track, the step is recorded and the measurement ends. If you",
    "setzt den nächsten Abschnitt.": "sets the next section.",
    "siehst": "see",
    "steht": "still",
    "steht:": "stopped:",
    "tatsächliche": "actual",
    "unbestätigt": "unconfirmed",
    "unbestätigte Annahme": "unconfirmed assumption",
    "verlässt. Sobald irgendwo eine Zahl größer null steht, ist die Ursache gefunden. Jede Variante behält eine gültige Prüfsumme, ein Fehlschlag ist also ein echtes Ergebnis und kein verworfenes Paket.": ". As soon as any number above zero appears, the cause is found. Every variant keeps a valid checksum, so a negative result is a real result and not a discarded packet.",
    "vier, das Original": "four, the original",
    "von 127": "of 127",
    "von Hand über genau dieses Teil schieben und ablesen, welcher Wert dabei auftaucht.": "push it by hand over exactly that part and read off which value appears.",
    "von": "from",
    "voraus": "ahead",
    "war nie ein reales Signal und ist deshalb nicht mehr die Vorgabe.": "was never a real signal and is therefore no longer the default.",
    "weniger": "less",
    "wie eine normale Kurve und habe gar keinen eigenen Code. Am 24.08. wurde sie überfahren und meldete": "like an ordinary curve and had no code of its own. On 24 Aug it was driven over and reported",
    "zeigt, erkennt das Auto Teile, meldet aber ihre Art nicht. Und wenn sich": "shows, the car does detect parts but does not report their type. And if",
    "zuerst den Schalter": "check the switch",
    "zusätzlich": "in addition",
    "zwei": "two",
    "zweiter": "second",
    "· abseits": "· off track",
    "Über": "Over",
    "Übernehmen": "Apply",
    "← Entwicklertools": "← Developer tools",
    "← Strecke": "← Track",
    "⛶ Vollbild": "⛶ Fullscreen",
    "🏁 Freies Training starten": "🏁 Start free practice",
    // ---- Block 1 (v0.5): Druckvorlagen, zwei Codetabellen, Vorlauf-Ergebnis.
    // Fuenf davon sind Satzfragmente, weil ein <b> mitten im Satz drei Textknoten
    // macht und jeder einzeln uebersetzt wird.
    "100 % / „Tatsächliche Größe“": "100 % / “Actual size”",
    ", auf keinen Fall „an Seite anpassen“ – sonst stimmen die Balkenabstände nicht mehr und der Sensor liest gar nichts. Der Pfeil zeigt in die Fahrtrichtung.": ", never “fit to page” – otherwise the bar spacing is wrong and the sensor reads nothing at all. The arrow points in the direction of travel.",
    "Auf jedem Blatt steht ein 100-mm-Kontrollmaß. Nachmessen ist der einzige Weg, den Druckmaßstab zu prüfen, denn eine Druckvorschau sagt dazu nichts.": "Every sheet carries a 100 mm check measure. Measuring it is the only way to verify the print scale – a print preview tells you nothing about it.",
    "Ausdruck und Schiene haben verschiedene Codetabellen.": "Printout and rail have different code tables.",
    ". Im Bahn-Modus melden die Schienen 0x02 Gerade, 0x03 Linkskurve, 0x04 Rechtskurve, 0x05 und 0x06 Haarnadel, 0x0a Start/Ziel, 0x00 abseits der Bahn. Dieselbe Zahl bedeutet je Modus etwas anderes – wer Codes vergleicht, muss den Modus mitnennen.": ". In rail mode the rails report 0x02 straight, 0x03 left curve, 0x04 right curve, 0x05 and 0x06 hairpin, 0x0a start/finish, 0x00 off the track. The same number means something different in each mode – whoever compares codes has to name the mode as well.",
    "Wieviel Anlauf der Leser braucht, ist gemessen und keine Vermutung mehr.": "How much run-up the reader needs has been measured, and is no longer a guess.",
    "Die drei führenden dünnen Striche lassen sich abschneiden, das Blatt wird weiter gelesen: der Vorlauf ist kein Nutzdatum. Und eines der beiden wiederholten Muster genügt. Die kleinste tragende Nutzlast ist damit ein Wort ohne Vorlauf, etwa 54 mm in Fahrtrichtung. Deshalb sind die Vorlauf- und Probeblätter aus dieser Seite verschwunden – das Experiment ist gelaufen.": "The three leading thin bars can be cut off and the sheet is still read: the run-up carries no payload. And one of the two repeated patterns is enough. The smallest working payload is therefore a single word without run-up, about 54 mm along the direction of travel. That is why the run-up and probe sheets have disappeared from this page – the experiment has been run.",
    "Nach einem Erkennen bleibt der Leser etwa eine Sekunde stumm. Bei 4 km/h Maßstabstempo sind das 1,1 m Fahrweg, also gut zweieinhalb Kachellängen: ein Muster öfter als etwa jeden Meter zu wiederholen bringt nichts. Dieselbe Sperre ist der Grund für den Mindestabstand von einer Sekunde bei der Boxengasse per Doppel-Ausdruck.": "After a reading the reader stays silent for about one second. At 4 km/h scale speed that is 1.1 m of travel, a good two and a half tile lengths: repeating a pattern more often than roughly every metre gains nothing. The same lockout is the reason for the one-second minimum gap in pit-lane detection via a double printout.",
    "Zählt Runden und löst die Rundenzeit aus. A4 quer, direkt aus der Original-Vorlage erzeugt und nicht nachgemessen: neun Balken, dünn 3,598 mm und dick 6,604 mm, Lücken 3,514 und 6,530 mm.": "Counts laps and triggers the lap time. A4 landscape, generated directly from the original template rather than measured off it: nine bars, thin 3.598 mm and thick 6.604 mm, gaps 3.514 and 6.530 mm.",
    "fahr über ein beliebiges ausgedrucktes Muster, hier steht sofort, welchen Code das Auto meldet.": "drive over any printed pattern and the code the car reports appears here at once.",
    "Achtung auf den Modus:": "Mind the mode:",
    "ein Ausdruck meldet aus der Ausdruck-Tabelle, dort ist": "a printout reports from the printout table, where",
    "Haarnadel gehören zur": "hairpin belong to the",
    "-Tabelle; alles andere ist unbestätigt. Trag hier den Code ein, den dein gedrucktes Boxen-Muster tatsächlich auslöst,": " table; everything else is unconfirmed. Enter the code your printed pit pattern actually triggers here,",
    // Block 2 (v0.5): die Legende zeigt nur die eingestellte Variante.
    "Eigene Abstimmung": "Custom setup",
    "kein fertiger Satz": "not a ready-made set",
    "Mindestens ein Regler weicht von allen fünf Voreinstellungen ab. Ein Klick oben setzt wieder einen ganzen Satz.": "At least one control differs from all five presets. A click above sets a whole set again.",
    "Eigen": "Custom",
    // Block 3 (v0.5): abseits der Fahrbahn.
    "ABSEITS · GAS GEDROSSELT": "OFF TRACK · THROTTLE LIMITED",
    "Controllervibration und Drosselung jenseits Fahrbahn": "Controller rumble and throttle limit off the track",
    "Meldet Byte 12 den Wert 0x00, ist das Auto neben der Bahn: dann brummt der Controller leicht und das Gas wird auf 45 % gedeckelt – nicht auf null, denn man muss zurückkommen. Wirkt nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus ist der Streckensensor aus und Byte 12 stände dauernd auf 0x00. Der Brummteil braucht zusätzlich den Schalter „Vibration“ darüber.": "When byte 12 reports 0x00 the car is off the track: the controller then rumbles gently and the throttle is capped at 45 % – not at zero, because you have to get back. Only works in the “On the track” position: in printout mode the track sensor is off and byte 12 would sit at 0x00 permanently. The rumble half also needs the “Vibration” switch above.",
    // Block 4 (v0.5): Bremsfading, Windschatten, Reifenasymmetrie und -druck.
    // Alle GANZE Textknoten, keine Fragmente - die Kleintexte sind ohne <b> und
    // <code> im Inneren geschrieben, genau damit sie nicht zerfallen.
    "Jedes Rad einzeln": "Each wheel on its own",
    "Aus Nick- und Querverlagerung bekommt jedes der vier Räder seine eigene Last, und daraus folgen vier Temperaturen, vier Verschleißwerte und vier Bremsscheiben. Eine Strecke mit vielen Rechtskurven nutzt die linken Reifen stärker ab, Bremsen verlagert nach vorn, Gas nach hinten. Das Auto zieht leicht zur stärker abgenutzten Seite, weil die weniger Querkraft erzeugt. Der Mittelwert bleibt derselbe: der Schalter macht nicht mehr Verschleiß, sondern ungleichen.": "Pitch and lateral load transfer give each of the four wheels its own load, and from that follow four temperatures, four wear values and four brake discs. A track full of right-hand corners wears the left tyres more, braking shifts the load forwards and throttle shifts it back. The car pulls slightly towards the more worn side, because that side generates less lateral force. The mean stays the same: the switch does not add wear, it makes it uneven.",
    "Reifendruck (bar)": "Tyre pressure (bar)",
    "Wenig Druck heißt mehr Walkarbeit: schnellere Erwärmung, mehr Verschleiß, besserer Kaltgriff. Viel Druck umgekehrt. Jede Abweichung von 1,8 kostet zusätzlich ein wenig Spitzengriff – sonst gäbe es genau eine beste Stellung und keine Abstimmung. Kein eigener Schalter: 1,8 ist die neutrale Stellung.": "Low pressure means more flex: faster warm-up, more wear, better grip when cold. High pressure the other way round. Any deviation from 1.8 also costs a little peak grip – otherwise there would be exactly one best setting and no trade-off. No switch of its own: 1.8 is the neutral position.",
    "Bremstemperatur und Fading": "Brake temperature and fade",
    "Bremsarbeit heizt zwei Scheiben, vorn und hinten getrennt nach der Bremsbalance. Ab etwa 520 °C sinkt die Bremswirkung, bei 780 °C um höchstens 35 % – der Bremsweg wird dann wirklich länger. Eine einzelne Vollbremsung aus 250 km/h erreicht aus kalten Scheiben gemessen 183 °C vorn und fadet nicht; nach acht Bremsungen sind es 806 °C und der Bremsweg ist 23 % länger.": "Braking work heats two discs, front and rear separately according to the brake bias. From about 520 °C the braking effect drops, at 780 °C by at most 35 % – and the braking distance really does get longer. A single full stop from 250 km/h reaches a measured 183 °C at the front from cold discs and does not fade; after eight stops it is 806 °C and the braking distance is 23 % longer.",
    "Stärke des Fadings": "Fade strength",
    "Über 100 % steigt die Heizrate, nicht der maximale Verlust.": "Above 100 % the heating rate rises, not the maximum loss.",
    "Windschatten in Kurven": "Dirty air in corners",
    "Dicht hinter einem anderen Auto sinkt der Abtrieb, also die Kurvengeschwindigkeit – auf der Geraden ist er ein Vorteil, in der Kurve ein Nachteil. Braucht eine Strecke mit mindestens drei Teilen und einen Gegner: ohne Streckenlayout weiß die App nicht, wer vor dir fährt.": "Close behind another car the downforce drops, and with it the cornering speed – on a straight it is an advantage, in a corner a penalty. Needs a track of at least three pieces and an opponent: without a layout the app does not know who is ahead of you.",
    "Stärke des Windschattens": "Dirty-air strength",
    "100 % sind höchstens 18 % Kurvengrip weniger.": "100 % means at most 18 % less cornering grip.",
    // Block 5 (v0.5): Druckbogen und das gescheiterte Entzifferungsergebnis.
    "Schneidebogen: vier Marken je Blatt": "Cut sheet: four markers per page",
    "A4 hochkant, vier vollständige Start/Ziel-Muster übereinander mit Schnittlinien. Das ist die sparsame Fassung: weil ein Wort ohne Vorlauf genügt, sind es 54,2 statt 75,5 mm je Marke, und davon passen vier auf ein Blatt. Die Balken sind 176 mm breit; das Kontrollmaß steht senkrecht im linken Rand.": "A4 portrait, four complete start/finish patterns one above the other with cut lines. This is the frugal version: because one word without run-up is enough, each marker is 54.2 mm instead of 75.5 mm, and four of those fit on one page. The bars are 176 mm wide; the check measure runs vertically in the left margin.",
    "Bahn zum Auslegen": "Track to lay out",
    "Durchgehend bedruckte Streckenteile: die Gerade als zwei A4-Blätter quer (je 202 mm Fahrweg), die 30-Grad-Kurve als zwei Blätter mit je 15 Grad. Die Kurvenbalken laufen radial mit konstanter Bogenlänge auf der Mittellinie – nicht mit konstantem Winkel, sonst wäre das Modulmaß am äußeren Rand größer als am inneren und der Sensor läse je nach Linie eine andere Folge. Genau so sehen die Infrarot-Aufnahmen der echten Kurve auch aus.": "Continuously printed track pieces: the straight as two A4 landscape sheets (202 mm of travel each), the 30-degree curve as two sheets of 15 degrees each. The curve bars run radially with a constant arc length on the centreline – not at a constant angle, because then the module size would be larger at the outer edge than at the inner one and the sensor would read a different sequence depending on the line taken. This is exactly how the infrared photographs of the real curve look.",
    "Warum experimentell, in zwei Punkten.": "Why experimental, on two counts.",
    "Erstens tragen diese Blätter das Wort von „Start/Ziel“. Die Wörter für Gerade und Rechtskurve sind nicht entziffert – der Versuch, sie aus Infrarot-Videobildern der echten Schiene zu lesen, ist gescheitert. Eine so ausgelegte Bahn meldet also überall Start/Ziel und ist als Strecke falsch; sie ist ein Versuchsblatt. Zweitens ist nicht entschieden, ob eine Papierbahn überhaupt wie die echte gelesen wird: das hängt an der Infrarot-Rückstrahlung von Toner und Papier. Ein Blatt, das gedruckt aussieht wie die Bahn, ist noch keine Bahn.": "First, these sheets carry the word for start/finish. The words for the straight and the right-hand curve have not been deciphered – the attempt to read them from infrared video stills of the real rail failed. A track laid out this way therefore reports start/finish everywhere and is wrong as a track; it is a test sheet. Second, it is undecided whether a paper track is read like the real one at all: that depends on the infrared reflectance of toner and paper. A sheet that looks printed like the track is not yet a track.",
    "Schneidebogen (4 Marken)": "Cut sheet (4 markers)",
    "Gerade, Blatt 1": "Straight, sheet 1",
    "Gerade, Blatt 2": "Straight, sheet 2",
    "Kurve, Blatt 1": "Curve, sheet 1",
    "Kurve, Blatt 2": "Curve, sheet 2",
    // Pro als Vorgabe (v0.5): geaenderte Preset-Texte, Gasfaktor, vier Reifen.
    "Automatik, 2,0 s auf 100, voller Grip, kein Reifenverschleiß und kein Tankgewicht. Das Tempo ist gedrosselt, die Bremse dafür die kräftigste von allen, also der kürzeste Bremsweg, und die Lenkkalibrierung auf 250 Prozent: der volle Einschlag liegt schon bei einem Viertel Stick an. Crashs bremsen, machen aber keinen Schaden. Zum Fahren ohne Nachdenken.": "Automatic, 2.0 s to 100, full grip, no tyre wear and no fuel weight. Top speed is throttled, while the brake is the strongest of them all, so the shortest braking distance, and steering calibration at 250 percent: full lock arrives at a quarter of stick travel. Crashes brake but cause no damage. For driving without thinking.",
    "Von Hand schalten, 2,4 s auf 100, stärkster Reifenverschleiß, volles Tankgewicht, die am feinsten dosierbare Lenkung (52 % des Anschlags bei vollem Stick, man muss also weit ziehen) und die kürzeste Bremse. Das Ausrollen ist kurz, weil der Luftwiderstand hier die größte Einzelkraft ist.": "Manual shifting, 2.4 s to 100, the strongest tyre wear, full fuel weight, the most finely metered steering (52 % of the lock at full stick, so you have to pull a long way) and the shortest braking. The coast-down is short because drag is the largest single force here.",
    "Gasfaktor": "Throttle factor",
    "Faktor auf das Motorbyte, das zum Auto geht. Das Byte ist Tempo geteilt durch Simulations-Höchstgeschwindigkeit; bei 100 % bekommt das Auto also erst volle Leistung, wenn die Simulation ihre Höchstgeschwindigkeit erreicht hat, und das dauert gemessen fast 25 Sekunden Vollgas. Über 100 % erreicht es die volle Leistung früher, ohne dass der Tacho anders skaliert. Nur bei 100 % (Realismus GT3) zeigt der Tacho genau das 50-fache des echten Tempos (gemessen: Vollgas 5,45 km/h, im Maßstab 272 km/h). Pro und Arcade fahren mit eigenem Faktor.": "Factor applied to the motor byte that goes to the car. The byte is speed divided by the simulated top speed, so at 100 % the car only gets full power once the simulation has reached its top speed – and that takes a measured 25 seconds of full throttle. Above 100 % it reaches full power sooner without the speedometer scaling differently. Only at 100 % (Realism GT3) does the speedometer show exactly 50 times the real speed (measured: full throttle 5.45 km/h, 272 km/h at scale). Pro and Arcade use their own factor.",
    "Reifen: Füllhöhe ist Restprofil, Farbe die Temperatur. Links und rechts werden getrennt gerechnet, vorn und hinten nicht – die beiden einer Seite laufen deshalb gleich. Antippen schaltet die Reifensimulation aus, beim Boxenstopp den Reifenwechsel.": "Tyres: fill height is remaining tread, colour is temperature. Left and right are tracked separately, front and rear are not – the two on one side therefore move together. Tapping switches the tyre simulation off, and during a pit stop the tyre change.",
    // Zusaetze v0.5: Kennzeichnungen, Crash-Schwelle, Startseite, Pad-Aktionen.
    "Reifenverschleiß, Reifentemperatur, Bremstemperatur": "Tyre wear, tyre temperature, brake temperature",
    "Wettersimulation": "Weather simulation",
    "Alles hier schreibt rohe Bytes zum Auto und liest rohe Bytes zurück. Das ist Werkbank und kein Merkmal: die Pakete tragen gültige Prüfsummen, aber was das Auto mit einem selbst zusammengesetzten Paket macht, ist nicht vorhersagbar. Zum Fahren wird nichts davon gebraucht.": "Everything here writes raw bytes to the car and reads raw bytes back. This is a workbench, not a feature: the packets carry valid checksums, but what the car does with a hand-assembled packet is not predictable. None of it is needed for driving.",
    "Automatik, 2,6 s auf 100, voller Grip, Reifenmodell an und kein Tankgewicht. Lenkkalibrierung 200 Prozent, damit auch enge Strecken gehen – der volle Einschlag liegt bei etwa einem Drittel Stick an. Fading und Windschatten sind aus; sie stehen ab GT3 zur Verfügung.": "Automatic, 2.6 s to 100, full grip, tyre model on and no fuel weight. Steering calibration 200 percent so that tight tracks work too – full lock arrives at about a third of stick travel. Fade and dirty air are off; they are available from GT3 upwards.",
    "Crash-Schwelle": "Crash threshold",
    "Wie weit die Bewegungsbytes 1 und 3 vom gleitenden Mittel abweichen müssen, damit ein Stoß als Crash gilt. Niedriger heißt empfindlicher: schon ein Rempler zählt. Höher heißt, dass nur ein echter Einschlag zählt. 40 ist der Wert, mit dem die Erkennung gebaut und geprüft wurde – stand bis v0.5 als Konstante im Code, war also eine Einstellung, die niemand einstellen konnte.": "How far the motion bytes 1 and 3 must deviate from the running mean for a jolt to count as a crash. Lower means more sensitive: even a nudge counts. Higher means only a real impact counts. 40 is the value the detection was built and tested with – it was a constant in the code until v0.5, so it was a setting nobody could set.",
    "R3 (rechten Stick drücken)": "R3 (press right stick)",
    "Zwei der drei Varianten sind am Auto unerprobt, und die Nummer des gedruckten Musters ist geraten und nicht entziffert – die Kodierregel ist nicht bekannt. „Überall halten“ trägt dagegen: es braucht kein Muster.": "Two of the three variants are untested on the car, and the number of the printed pattern is guessed rather than deciphered – the encoding rule is not known. “Stop anywhere” does hold up, though: it needs no pattern at all.",
    "Leseart: Bahn oder Ausdruck": "Reading mode: rail or printout",
    "Getriebe: Automatik oder von Hand": "Gearbox: automatic or manual",
    "Boxenstopp (tippen), gelbe Flagge (1 s halten)": "Pit stop (tap), yellow flag (hold 1 s)",
    "Menü (Cockpit ↔ Fahren)": "Menu (cockpit ↔ drive)",
    "Kreuz (PS) / A (Xbox), 1 s halten": "Cross (PS) / A (Xbox), hold 1 s",
    "Select / Share (PS) / Back (Xbox)": "Select / Share (PS) / Back (Xbox)",
    // Lenkmessung (v0.5): Absaetze ohne inneres Markup, damit sie EIN Knoten sind.
    "die offene Frage": "the open question",
    "Lenkmessung Ghosts": "Ghost steering measurement",
    "Wertet das Auto im Bahn-Modus einen gesendeten Lenkbefehl überhaupt aus?": "Does the car evaluate a transmitted steering command at all in rail mode?",
    "Davon hängt ab, ob Ghost-Ideallinie und Querversatz je mehr als Zierde werden. Sie erreichen zusammen gemessen höchstens 22 von 127 Lenkschritten, und der Kommentar im Code sagt selbst, dass sich das Auto im Bahn-Modus selbst auf der Strecke hält. Die Kippwert-Messung darüber beantwortet das nicht: sie sagt, wann es zu viel ist, nicht ob wenig etwas tut.": "Whether the ghost racing line and lateral offset ever become more than decoration depends on this. Together they reach a measured 22 of 127 steering steps at most, and the comment in the code says itself that the car keeps itself on the track in rail mode. The tipping-point measurement above does not answer it: it says when there is too much, not whether a little does anything.",
    "Der Versuch: dieselbe Strecke, dieselben Ghosts, seitlicher Versatz einmal auf 0 % und einmal auf 100 %. Gezählt werden zwei Zahlen und nicht der Eindruck – Abgänge, also Byte 12 wechselt auf 0x00, und Rundenzeiten. Ändert sich keines von beiden, ignoriert die Firmware die Lenkung.": "The experiment: same track, same ghosts, lateral offset once at 0 % and once at 100 %. Two numbers are counted rather than an impression – departures, meaning byte 12 switches to 0x00, and lap times. If neither changes, the firmware ignores the steering.",
    "Was der Knopf prüft, bevor er startet: mindestens drei Streckenteile, mindestens zwei Ghosts, und Bahn-Modus. Unter drei Kacheln liefern die Linienfunktionen null, mit einem Ghost bleibt der Querversatz null, und im Ausdruck-Modus hält sich das Auto nicht selbst auf der Bahn. Wer den Versuch so führt, misst garantiert „keine Wirkung“ – aus Gründen, die mit der Frage nichts zu tun haben.": "What the button checks before it starts: at least three track pieces, at least two ghosts, and rail mode. Below three tiles the line functions return null, with one ghost the lateral offset stays zero, and in printout mode the car does not keep itself on the track. Running the experiment that way is guaranteed to measure “no effect” – for reasons that have nothing to do with the question.",
    "Runden je Phase": "Laps per phase",
    "Abbrechen": "Cancel",
    "Als CSV": "As CSV",
    "nicht gestartet": "not started",
    "Abgänge": "Departures",
    // Mehrspieler Version A (v0.5). Alle GANZE Textknoten, kein Fragment - die
    // Erklaerabsaetze sind ohne inneres Markup geschrieben.
    "Gezaehlt werden GEMESSENE Runden, genau wie in der Rundenliste im Cockpit: die erste Ueberfahrt startet die Uhr, erst die zweite ergibt eine Zeit. Nach drei Ueberfahrten stehen also zwei Runden da. Bei Gleichstand fuehrt, wer zuerst dort war.": "Counted are MEASURED laps, exactly as in the cockpit lap list: the first crossing starts the clock, only the second yields a time. After three crossings the count shows two laps. On a tie, whoever got there first leads.",
    "Warum es experimentell ist, und der Grund ist eine Browserregel und kein Wackeln im Code: Web Bluetooth verlangt einen secure context. Das sind https, http://localhost und file. Eine Adresse wie http://192.168.1.50:8080 ist keiner – die App laedt dort, aber „Auto verbinden“ bleibt ohne Wirkung. Einmal je Telefon muss man in Chrome unter chrome://flags/#unsafely-treat-insecure-origin-as-secure die Adresse des Hosts eintragen und Chrome neu starten. Damit erklaert man diesen einen Ursprung fuer vertrauenswuerdig; im eigenen WLAN mit dem eigenen PC ist das vertretbar, aber es ist eine Ausnahme von einer Sicherheitsregel und keine Einstellung.": "Why it is experimental – and the reason is a browser rule, not shaky code: Web Bluetooth requires a secure context. Those are https, http://localhost and file. An address like http://192.168.1.50:8080 is not one – the app loads there, but “Connect car” has no effect. Once per phone you have to enter the host address in Chrome under chrome://flags/#unsafely-treat-insecure-origin-as-secure and restart Chrome. Doing so declares that one origin trustworthy; on your own Wi-Fi with your own PC that is defensible, but it is an exception to a security rule and not a setting.",
    "Der Ueberblicksschirm fuer den PC liegt beim Host unter /mp-overview.html. Er braucht kein Bluetooth und deshalb auch keine Freigabe: auf http://localhost ist er ohnehin ein secure context.": "The overview screen for the PC sits on the host at /mp-overview.html. It needs no Bluetooth and therefore no exemption: on http://localhost it is a secure context anyway.",
    "Host-Adresse": "Host address",
    "Mein Name": "My name",
    "Mitmachen": "Join",
    "Verlassen": "Leave",
    "keine Daten": "no data",
    "Fahrer": "drivers",
    "Zeit": "time",
    "Abstand": "gap",
    "verbunden": "connected",
    "kein Kontakt zum Host": "no contact with the host",
    "Ohne Host-Adresse geht es nicht.": "It does not work without a host address.",
    // Vier Texte, die im englischen Modus deutsch geblieben sind. Zwei waren ohne
    // Eintrag, zwei waren BRUCHSTUECKE - Auszeichnung mitten im Satz zerlegt den
    // Textknoten, und dann passt kein Schluessel mehr. Das Markup ist dafuer
    // geglaettet worden; diese Schluessel sind aus ihm gerechnet und nicht abgetippt.
    "Aufnahmen werden lokal im Browser gespeichert (localStorage).": "Recordings are stored locally in the browser (localStorage).",
    "Strecken werden lokal im Browser gespeichert (localStorage).": "Tracks are stored locally in the browser (localStorage).",
    "Im Ausdruck-Modus meldet das Start/Ziel-Blatt je nach Vorlage 0x01 oder 0x0a. Im Bahn-Modus melden die Schienen 0x02 Gerade, 0x03 Linkskurve, 0x04 Rechtskurve, 0x05 und 0x06 Haarnadel, 0x01 Start/Ziel, 0x0a Engstelle, 0x00 abseits der Bahn. Dieselbe Zahl bedeutet je Modus etwas anderes – wer Codes vergleicht, muss den Modus mitnennen.": "In printed-pattern mode the start/finish sheet reports 0x01 or 0x0a depending on the template. In rail mode the rails report 0x02 straight, 0x03 left-hand corner, 0x04 right-hand corner, 0x05 and 0x06 hairpin, 0x01 start/finish, 0x0a narrow section, 0x00 off the track. The same number means something different in each mode – whoever compares codes has to name the mode as well.",
    "fahr über ein beliebiges ausgedrucktes Muster, hier steht sofort, welchen Code das Auto meldet. Achtung auf den Modus: ein Ausdruck meldet aus der Ausdruck-Tabelle, dort sind 0x01 und 0x0a Start/Ziel. Die Werte 0x02 Gerade, 0x03 Linkskurve, 0x04 Rechtskurve, 0x05 und 0x06 Haarnadel gehören zur Bahn-Tabelle; alles andere ist unbestätigt. Trag hier den Code ein, den dein gedrucktes Boxen-Muster tatsächlich auslöst – 0x08 war nie ein reales Signal und ist deshalb nicht mehr die Vorgabe.": "drive over any printed pattern and it says right here which code the car reports. Mind the mode: a printout reports from the printed-pattern table, where 0x01 and 0x0a are start/finish. The values 0x02 straight, 0x03 left-hand corner, 0x04 right-hand corner, 0x05 and 0x06 hairpin belong to the rail table; everything else is unconfirmed. Enter the code your printed pit pattern actually triggers here – 0x08 was never a real signal and is therefore no longer the default.",
    "Lenkwinkel-Kalibrierung": "Steering angle calibration",
    "Für enge Strecken. Der Regler sitzt hinter dem Reibkreis: beim Anbremsen einer Kurve beschneidet der die Lenkung auf etwa 60 Prozent, und bei 200 Prozent erreicht dieser beschnittene Wunsch wieder den vollen Anschlag. Weiter als 45 Grad kann kein Wert lenken, das ist die Mechanik des Autos und nicht die App. Der Preis ist Feingefühl: je höher, desto früher liegt der Anschlag an und desto weniger sagt der letzte Teil des Sticks.": "For tight tracks. The slider sits behind the friction circle: braking into a corner cuts steering to about 60 percent, and at 200 percent that cut request reaches full lock again. No value can steer further than 45 degrees – that is the mechanics of the car, not the app. The price is finesse: the higher it goes, the earlier full lock is reached and the less the last part of the stick says.",
    "Ghost: eigene Spuren": "Ghosts: own lanes",
    "Jeder Ghost hält eine feste eigene Linie über die Bahnbreite, gleichmäßig verteilt und symmetrisch um die Mitte. Anders als der seitliche Versatz braucht das keine zwei Autos nebeneinander, und anders als die Ideallinie keine drei Streckenteile: es wirkt auf der Vorgabestrecke und allein unterwegs. Bei nur einem Ghost ist die Spur die Mitte, denn verschiedene Linien haben bei einem Auto keine Bedeutung. Links = aus.": "Each ghost holds a fixed lane of its own across the track width, evenly spread and symmetric about the centre. Unlike the lateral offset this needs no two cars side by side, and unlike the racing line no three track pieces: it works on the default track and when driving alone. With only one ghost the lane is the centre, because different lines have no meaning for a single car. Left = off.",
    "Reifenwärmer": "Tyre blankets",
    "Start und Reifenwechsel auf Betriebstemperatur statt kalt. Aus heißt: die ersten Runden fehlt Grip, bis die Reifen warm gefahren sind. An heißt: sofort im Griff-Fenster, also 85 Grad. In der Formel 1 waren Wärmedecken bis 2024 erlaubt und sind seit 2025 verboten; im GT-Sport sind sie meist untersagt. Hier ist es eine Einstellung und keine Regel.": "Start and tyre change at operating temperature instead of cold. Off means the first few laps lack grip until the tyres have been warmed up. On means straight into the grip window, that is 85 degrees. In Formula 1 tyre blankets were allowed until 2024 and have been banned since 2025; in GT racing they are mostly prohibited. Here it is a setting and not a rule.",
    "Bremsen nimmt Lenkung": "Braking eats steering",
    "Der Reibkreis: was die Bremse an der Vorderachse verbraucht, fehlt der Lenkung. 0 heißt, Bremsen und Lenken behindern sich nicht; höhere Werte lassen das Auto beim Anbremsen deutlich schlechter einlenken. Zu beachten: die Lenkwinkel-Kalibrierung darunter holt genau das wieder zurück, also wirkt ein starker Wert erst, wenn die Kalibrierung ihn nicht mehr ausgleichen kann.": "The friction circle: whatever the brake uses at the front axle is missing from the steering. 0 means braking and steering do not interfere; higher values make the car turn in markedly worse while braking. Note: the steering angle calibration below takes exactly that back, so a strong value only bites once the calibration can no longer compensate for it.",
    "Quadrat (PS) / X (Xbox)": "Square (PS) / X (Xbox)",
    "Kreis (PS) / B (Xbox)": "Circle (PS) / B (Xbox)",
    "Dreieck (PS) / Y (Xbox)": "Triangle (PS) / Y (Xbox)",
    "Options (PS) / Start (Xbox)": "Options (PS) / Start (Xbox)",
    "L1 (PS) / LB (Xbox)": "L1 (PS) / LB (Xbox)",
    "R1 (PS) / RB (Xbox)": "R1 (PS) / RB (Xbox)",
    "Rechter Trigger (R2 / RT)": "Right trigger (R2 / RT)",
    "Linker Trigger (L2 / LT)": "Left trigger (L2 / LT)",
    "Rundenzeiten": "Lap times",
    "Noch keine Sitzung aufgezeichnet.": "No session recorded yet.",
    "Diese Sitzung hat keine gemessenen Runden.": "This session has no measured laps.",
    "gemessene Runden, beste": "measured laps, best",
    "diese Sitzung wurde vor v0.5 aufgezeichnet und trägt keine Ereignisse": "this session was recorded before v0.5 and carries no events",
    "Boxenstopp (gelb)": "pit stop (yellow)",
    "Boxenstopps (gelb)": "pit stops (yellow)",
    "Abgang (Blitz)": "departure (lightning)",
    "Abgänge (Blitz)": "departures (lightning)",
    "s Zeitstrafe am Rennende": "s time penalty at the end of the race",
    "y-Achse abgeschnitten, siehe Beschriftung": "y axis truncated, see the labels",
    "Als App installieren": "Install as an app",
    "Fahrzeug": "Car",
    "Layout": "Layout",
    "Welches Auto du fährst, nicht wie es abgestimmt ist. Die drei GT3-Varianten unterscheiden sich NUR in Achslast, Radstand und Trägheitsmoment; Leistung, Reifen und Bremse bleiben gleich. Deshalb zeigt der Wechsel, was die Motorlage macht. Ein Heckmotor hat weniger Vorderachslast und lenkt unter Bremsen schlechter ein; ein kleines Trägheitsmoment antwortet schneller. Die Zahlen sind Schätzungen aus der Fahrzeugklasse und keine Messungen. Nicht zu verwechseln mit der Voreinstellung „F1“ weiter oben: die ist eine Abstimmung, das hier ist ein Auto, und die Voreinstellungen fassen es absichtlich nicht an.": "Which car you drive, not how it is tuned. The three GT3 variants differ ONLY in axle load, wheelbase and yaw inertia; power, tyres and brakes stay the same. That is why switching shows what the engine position does. A rear engine has less front axle load and turns in worse under braking; a small yaw inertia answers faster. The figures are estimates from the vehicle class and not measurements. Not to be confused with the “F1” preset above: that is a tuning, this is a car, and the presets deliberately do not touch it.",
    "Neutral, kalibriert": "Neutral, as calibrated",
    "GT3, Frontmotor – BMW M4 GT3": "GT3, front engine – BMW M4 GT3",
    "GT3, Mittelmotor – Ferrari 296 GT3": "GT3, mid engine – Ferrari 296 GT3",
    "GT3, Heckmotor – Porsche 911 GT3 R": "GT3, rear engine – Porsche 911 GT3 R",
    "Formel-1-Monoposto": "Formula 1 single-seater",
    "Daten des Layouts": "Layout figures",
    "Gerechnet und nicht eingetippt: die Nickgrenzen folgen aus der statischen Achslast und dem Verlagerungsanteil.": "Computed, not typed in: the pitch limits follow from the static axle load and the transfer share.",
    "vorn bei Gas": "front on throttle",
    "bei Bremse": "on the brake",
    "Reifenquietschen": "Tyre squeal",
    "Am Grenzbereich, im Stil von Gran Turismo: Lautstärke und Tonhöhe laufen stetig mit der Querausnutzung des Reibkreises, Einsatz ab 60 Prozent – also ab etwa 98 km/h bei vollem Lenkausschlag, ab 197 km/h bei halbem, und bei einem Viertel Ausschlag nie. Eine Haarnadel quietscht, eine lange schnelle Kurve nicht. Bis v0.4.55 stand die Schwelle bei 85 Prozent und war damit unerreichbar: gemessen kommt die Querausnutzung erst bei 265 km/h dorthin, weil der Lenkausschlag mit dem Tempo beschnitten wird. Es hat deshalb nie gequietscht.": "At the limit, in the style of Gran Turismo: volume and pitch run continuously with the lateral use of the friction circle, starting at 60 per cent – so from about 98 km/h at full lock, from 197 km/h at half, and at a quarter of lock never. A hairpin squeals, a long fast corner does not. Up to v0.4.55 the threshold sat at 85 per cent and was therefore unreachable: measured, the lateral use only gets there at 265 km/h, because the steering lock is cut back with speed. It therefore never squealed.",
    "WLAN Mehrspieler": "WIFI Multiplayer",
    "Sportlich, mit Simulationstiefe": "Sporty, with simulation depth",
    "Von Hand schalten, 2,9 s auf 100, Reifenverschleiß und Tankgewicht knapp zur Hälfte. Bremsfading, Windschatten und ungleicher Verschleiß sind voll an. Die harte, gegen echte Werte kalibrierte Fassung steht daneben als Realismus GT3.": "Shift by hand, 2.9 s to 100, tyre wear and fuel weight at just under half. Brake fade, dirty air and uneven wear are fully on. The hard version, calibrated against real figures, sits next to it as Realism GT3.",
    "Das schärfste der fahrbaren": "The sharpest of the driveable ones",
    "Von Hand schalten, 2,5 s auf 100, stärkster Reifenverschleiß der drei Klassen und die kürzeste Bremse. Die am feinsten dosierbare Lenkung, langes Ausrollen, und Windschatten wirkt am stärksten. Reifenwärmer an.": "Shift by hand, 2.5 s to 100, the strongest tyre wear of the three classes and the shortest brake. The most finely metered steering, long coasting, and dirty air bites hardest. Tyre blankets on.",
    "Realismus GT3": "Realism GT3",
    "Gegen echte Werte kalibriert": "Calibrated against real figures",
    "Von Hand schalten, 3,2 s auf 100 – die gemessene Reihe, gegen die die Physik gefittet ist –, voller Reifenverschleiß und volles Tankgewicht. Wenig Grip, schwache Bremse, langes Ausrollen, keine Reifenwärmer. Das ist die haerteste der sechs Abstimmungen und die einzige, deren Zahlen aus Messungen kommen und nicht aus einer Anpassung. Ein Fahrfehler kostet hier Zeit.": "Shift by hand, 3.2 s to 100 – the measured series the physics is fitted against –, full tyre wear and full fuel weight. Little grip, a weak brake, long coasting, no tyre blankets. This is the hardest of the six tunings and the only one whose figures come from measurements rather than from an adjustment. A driving error costs time here.",
    "Ghosts anhalten": "Stop ghosts",
    "Drosselung abseits beginnt nach": "Throttling off track starts after",
    "So lange muss das Auto DURCHGEHEND abseits melden, bevor gedrosselt wird. Eine Sekunde ist die Vorgabe, damit leichtes Schneiden noch durchgeht – ein einzelnes Paket von der Bahn setzt die Uhr zurück. Gilt nur in der Stellung „Auf der Bahn“, weil der Streckensensor nur dort liest.": "This is how long the car must report off track CONTINUOUSLY before the throttle is capped. One second is the default so that cutting a corner slightly still gets through – a single packet from the track resets the clock. Applies only in the „On the track“ position, because that is the only place the track sensor reads.",
    ": der Stopp wird von Hand angefordert und beginnt erst, wenn das Auto neben der Bahn steht (Byte 12 = 0x00). Der Knopf sagt also, DASS ein Stopp kommt, die Bahnkante sagt, WO er anfängt. Nur auf der CH-Schiene sinnvoll – ohne Schiene meldet das Auto ständig „abseits“.": ": the stop is requested by hand and only begins once the car is standing beside the track (byte 12 = 0x00). So the button says THAT a stop is coming, the track edge says WHERE it begins. Only useful on the CH rail – without the rail the car reports „off track“ all the time.",
    "Neben der Strecke (von Hand, Start erst abseits)": "Beside the track (by hand, starts only off track)",
    "Außen anstellen, innen scheiteln, außen heraus. Gemessen am mittleren Lenkbyte über 600 Takte: die Vorgabe ergibt 36 von 127, 100 Prozent ergeben 50, 200 Prozent ergeben 81 mit Spitzen am vollen Anschlag. Zum Vergleich schickt die Original-App ihren eigenen Ghosts im Mittel 32 und 47. Über 100 Prozent wirkt die Linie zusätzlich auch auf der Geraden voll statt nur zu einem Drittel – das Anbremsen von außen ist die Hälfte einer Ideallinie, und genau dort sieht man sie. Ohne gebaute oder gelernte Strecke fällt sie auf eine gröbere Regel je Kachel zurück. Ganz ohne gelesene Streckencodes wirkt sie nicht, weil niemand weiß, wo das Auto ist. Ob es hilft, sagen Rundenzeit und Abgänge.": "Set up wide, clip the apex, run out wide. Measured as the mean steering byte over 600 ticks: the default gives 36 of 127, 100 per cent gives 50, 200 per cent gives 81 with peaks at full lock. For comparison the original app sends its own ghosts 32 and 47 on average. Above 100 per cent the line also acts fully on the straights instead of only a third – braking in from the outside is half of a racing line, and that is where you see it. Without a built or learned track it falls back to a coarser per-tile rule. With no track codes read at all it does nothing, because nobody knows where the car is. Whether it helps is answered by lap times and excursions.",
    "Rundentempo der autonomen Autos. Gefahren brauchbar zwischen 40 und 60 Prozent. Der Regler beginnt bei 35 und nicht tiefer: darunter fährt das Auto so langsam, dass es die gedruckte Strecke nicht mehr zuverlässig „liest“ – und dann fallen Vorausblick, Ideallinie und Kurvendrosselung alle drei aus.": "Lap pace of the autonomous cars. Driven, 40 to 60 percent works well. The slider starts at 35 and no lower: below that the car drives so slowly that it no longer „reads“ the printed track reliably – and then lookahead, racing line and corner braking all three fall away.",
    "Der Erstplatzierte fährt etwas langsamer, damit das Feld zusammenbleibt. Wirkt auch ohne Rennen, also beim freien Fahren – aber erst ab zwei Ghosts: mit einem einzigen ist dieser eine der Führende, und ihn zu bremsen hieße nur, ihn langsamer zu machen.": "The car in front runs slightly slower so the field stays together. Works without a race too, i.e. in free practice – but only from two ghosts upwards: with a single one that one is the leader, and holding it back would just mean making it slower.",
    "Ablauf: Auto in der Garage verbinden, unten auf „Messung starten“ drücken. Das Auto fährt mit festem, langsamem Gas und hält jede Stufe so lange, wie unten eingestellt ist. Verlässt es die Bahn, wird die Stufe festgehalten und die Messung endet. Wenn du es siehst, bevor die App es merkt: „runtergefahren“ drücken.": "How it runs: connect a car in the garage, then press “Start measurement” below. The car drives at a fixed, slow throttle and holds each step for as long as set below. If it leaves the track, the step is recorded and the measurement ends. If you see it before the app does, press “went off”.",
    "Haltedauer je Stufe:": "Hold time per step:",
    "Schritt für Schritt, damit die Zahl etwas wert ist": "Step by step, so that the number is worth something",
    "Eine möglichst lange Gerade aufbauen, mindestens vier Teile. In einer Kurve misst du die Kurve mit und nicht den Lenkanteil.": "Build the longest straight you can, at least four pieces. In a corner you measure the corner as well, not the steering share.",
    "Genug Platz neben der Bahn lassen: das Auto soll abfliegen dürfen, ohne gegen ein Tischbein zu fahren.": "Leave enough room beside the track: the car has to be allowed to fly off without hitting a table leg.",
    "In der Garage genau ein Auto auf „Ghost“ stellen. Bei zwei Autos mischen sich Ausweichversatz und Messung.": "Set exactly one car to “Ghost” in the garage. With two cars the avoidance offset mixes into the measurement.",
    "Sonst nichts abschalten. Der Messstand sendet mit eigenem Takt, also sind Tempo, Ideallinie und Würze der Ghosts während der Messung ohne Wirkung.": "Switch nothing else off. The measuring rig transmits on its own clock, so ghost pace, racing line and spice have no effect during the measurement.",
    "Auf „Messung starten“ drücken. Nach jeder Stufe fährt das Auto weiter und der Lenkanteil steigt; beim ersten Abflug ist die Messung fertig.": "Press “Start measurement”. After each step the car keeps driving and the steering share rises; at the first departure the measurement is done.",
    "Kommt es bis zum Anschlag, ohne abzufliegen, ist das auch ein Ergebnis: dann hält das Auto jeden Lenkanteil, und der Deckel darf auf den höchsten gehaltenen Wert.": "If it reaches full lock without flying off, that is a result too: the car then holds any steering share, and the cap may go to the highest value it held.",
    "Zwei- oder dreimal wiederholen. Ein einzelner Abflug kann ein Staubkorn gewesen sein.": "Repeat two or three times. A single departure may have been a speck of dust.",
    "Was danach von selbst passiert": "What happens by itself afterwards",
    "Der gemessene Kippwert ersetzt den geschätzten Deckel für alle Querbewegungen: Ideallinie, Überholversatz und Ausweichen. Du musst nichts übertragen.": "The measured tipping value replaces the estimated cap for every lateral movement: racing line, overtaking offset and avoidance. You do not have to transfer anything.",
    "Aktueller Deckel:": "Current cap:",
    "Tagesform, Fehler, Windschatten, Überholen, Gummiband und Abstand halten – ein Regler für alle sechs. Ein Überholvorgang läuft als Sequenz: erst zur Seite, dann Schub, dann vorne wieder einordnen, und wenn es nach 5 s nicht geklappt hat, Abbruch mit 6 s Sperre. Ohne diesen Abbruch klebte der Verfolger neben dem anderen, bis die Uhr ablief, und genau dort berühren sie sich. Der Mindestabstand rechnet ausserdem mit der Annäherungsrate statt mit einem festen Kachelabstand. Auf 0 ist jeder der sechs Bausteine wirkungslos.": "Form, mistakes, slipstream, overtaking, rubber band and keeping distance – one slider for all six. An overtake runs as a sequence: move aside, then the boost, then tuck back in ahead, and if it has not worked after 5 s, abort with a 6 s lockout. Without that abort the follower stuck alongside the other until the clock ran out, and that is exactly where they touch. The minimum gap also reckons with the closing rate rather than a fixed tile distance. At 0 every one of the six parts is inert.",
    "Zwei Autos nebeneinander gehen auseinander, und beim Überholen weicht auch der Vorausfahrende aus, zur anderen Seite. Zwei Autos auf 25 cm Bahnbreite brauchen beide Hälften. Dieser Regler bestimmt auch, wie weit der Angreifer zur Seite geht: das ist ein Ausweichen und keine Linienwahl, hängt also nicht an der Ideallinie. Über 100 Prozent geht die Anforderung bis an den vollen Anschlag – die Mitschnitte zeigen, dass das Auto die Schiene auch dort noch liest.": "Two cars side by side move apart, and when being overtaken the car ahead also gives way, to the other side. Two cars on 25 cm of track width need both halves. This slider also sets how far the attacker moves across: that is an evasion and not a line choice, so it does not depend on the racing line. Above 100 per cent the request goes all the way to full lock – the recordings show the car still reads the rail there.",
    "Jeder Ghost hält eine eigene, feste Linie über die Bahnbreite. Auf der Geraden gilt die Spur, in der Kurve die Ideallinie – so fährt das Feld hintereinander, aber auf verschiedenen Linien, und sucht im Bogen trotzdem den Scheitel. Der Übergang läuft mit 350 ms nach, damit an der Kachelgrenze kein Ruck entsteht. Bis 100 Prozent bleibt in der Kurve die halbe Spur stehen: alle auf denselben Scheitel zu schicken wäre realistisch, würde sie aber zusammenführen, und Berührungen sind ohne Rückmeldung zur Querlage nicht zurückzuregeln. Über 100 Prozent gilt die eigene Spur auch in der Kurve ganz – auf eigene Gefahr, denn dann bleiben sie sich auch im Bogen im Weg.": "Every ghost holds its own fixed line across the track width. On the straight the lane applies, in a corner the racing line – so the field runs in single file but on different lines, and still hunts the apex through the bend. The transition eases over 350 ms so there is no jolt at a tile boundary. Up to 100 per cent half of the lane survives through a corner: sending everyone to the same apex would be realistic but would bring them together, and contact cannot be corrected without any feedback on lateral position. Above 100 per cent the lane applies fully in corners too – at your own risk, because then they stay in each other's way through the bend as well.",
    "Dieses Projekt ist unabhängig von Carrera und gehört zu keinem Hersteller. Der vollständige Quellcode steht unter der MIT-Lizenz auf GitHub.": "This project is independent of Carrera and belongs to no manufacturer. The complete source code is available under the MIT licence on GitHub.",
    "Jeder darf ihn nutzen, kopieren, verändern und auch in kommerzieller Software verwenden, solange der ursprüngliche Urheberrechtsvermerk und der Lizenztext in der Kopie erhalten bleiben.": "Anyone may use, copy and modify it, including in commercial software, as long as the original copyright notice and the licence text are kept in the copy.",
    "Dieselbe Lizenz sagt aber auch: die Software kommt ohne Garantie und ohne Gewährleistung. Du steuerst deine Autos auf eigene Gefahr. Es ist ein Freizeitprojekt, motiviert durch die Option, eine Pups-Hupe einzubauen – und möglicherweise funktioniert es nach einem künftigen Firmware-Update nicht mehr.": "The same licence also says: the software comes with no warranty and no guarantee. You drive your cars at your own risk. This is a hobby project, motivated by the option of building in a whoopee horn – and it may well stop working after a future firmware update.",
    "Für konstruktives Feedback oder Feature-Wünsche schreib mir gern im Thema „Omega Sim“ im Carrera Hybrid Players Discord, unter „weitere Themen“.": "For constructive feedback or feature requests, do write to me in the “Omega Sim” topic of the Carrera Hybrid Players Discord, under “weitere Themen”.",
    "Unabhängig, offen, ohne Gewähr": "Independent, open, without warranty",
    "Quellcode auf GitHub": "Source code on GitHub",
    "Lenkansprechen kleiner": "Steering response lower",
    "Lenkansprechen größer": "Steering response higher",
    "Schirm zurück": "Previous screen",
    "Schirm vor": "Next screen",
    "Controller-Belegung": "Controller mapping",
    "Antippen oder Klick schlie\u00dft die Ansicht.": "Tap or click to close the view.",
    "\u2197 Vergr\u00f6\u00dfern": "\u2197 Enlarge",
    "Was gerade auf welcher Taste liegt. Zuweisen lässt sich das in den Optionen unter „Gamepad“; die Grafik zieht sofort nach.": "What currently sits on which button. It can be reassigned in the options under “Gamepad”; the diagram follows immediately.",
    "Weiß ist zuweisbar, gedecktes Grau ist festverdrahtet und nicht zuweisbar (das Steuerkreuz), kursives Grau heißt „nicht belegt“. Touchpad und PS-Taste bleiben ab Werk frei, weil das System beide selbst abgreift: ein Tippen aufs Touchpad löst zugleich einen Klick in der Seite aus. Im Streckeneditor und auf dem Boxenschirm bedient das Steuerkreuz erst diese, danach gilt wieder das Gezeigte. Dasselbe gilt für die Flaggentaste: auf dem Boxenschirm wählt sie dort aus, und die gelbe Flagge gibt es nach dem Zurückblättern.": "White is assignable, muted grey is hard-wired and not assignable (the D-pad), italic grey means “not assigned”. Touchpad and PS button stay free out of the box because the system claims both itself: a tap on the touchpad also fires a click somewhere in the page. In the track editor and on the pit screen the D-pad serves those first, after which what is shown here applies again. The same goes for the flag button: on the pit screen it selects there, and the yellow flag is available once you page back.",
    "L3 · Stick drücken": "L3 · press the stick",
    "R3 · Stick drücken": "R3 · press the stick",
    "Linker Stick": "Left stick",
    "Rechter Stick": "Right stick",
    "Steuerkreuz": "D-pad",
    "Tasten": "Buttons",
    "PS-Taste": "PS button",
    "Was gemessen wurde und was nur vermutet: Protokoll, Physik, Töne – samt der Stellen, an denen wir uns geirrt haben.": "What was measured and what is only assumed: protocol, physics, sound – including the places where we got it wrong.",
    "Code-Sonde": "Code probe",
    "Was das Auto gerade unter sich liest, ungefiltert – mit Zeitleiste der Codewechsel.": "What the car is reading beneath itself right now, unfiltered – with a timeline of the code changes.",
    "Was das Auto gerade unter sich liest, ungefiltert. Die Anzeige zeigt den ROHEN Code und nicht das, was die Rundenlogik daraus macht – genau darin liegt ihr Zweck: sie soll die Fehler sichtbar machen, die jene Logik verdeckt.": "What the car is reading beneath itself right now, unfiltered. The readout shows the RAW code and not what the lap logic makes of it – which is precisely its purpose: it is meant to show the errors that logic hides.",
    "Wozu dient dieses Projekt?": "What is this project for?",
    "Wozu?": "What for?",
    "Warum dieses Projekt existiert, und was offene Software damit zu tun hat.":
      "Why this project exists, and what open software has to do with it.",
    "Wer geholfen hat, und woher die Klänge kommen.":
      "Who helped, and where the sounds come from.",
    "Was sich je Wochenversion geändert hat, kurz zusammengefasst.":
      "What changed in each weekly version, summarised briefly.",
    "Navigation aufgeräumt (Startseite, feste Kopfzeile), Auto-Verwaltung in der Garage.":
      "Navigation cleaned up (home page, fixed header), car management in the garage.",
    "Zwei-Spieler-Modus: Licht, Boxensound und Tastenbelegung jetzt wirklich unabhängig.":
      "Two-player mode: lights, pit sound and key bindings now genuinely independent.",
    "Renneinstellungen als eigene Kachel mit eigenem Cockpit-Screen, dazu ein Regler für Rennhärte und eine Recovery-Funktion nach einem Abgang.":
      "Race settings as their own tile with their own cockpit screen, plus a race-hardness slider and a recovery function after going off track.",
    "Cockpit-Balken (Tank/Schaden/Akku) jetzt vertikal, Gyro-Anzeige verbessert.":
      "Cockpit bars (fuel/damage/battery) now vertical, gyro display improved.",
    "Lenkkennlinie einstellbar, neuer GT7-Fahrmodus, zwei neue Motoren (Ford Tudor 1937, VW Käfer 1300) und ein Vergleichsprofil mit echter Anlasser-Aufnahme für den Porsche.":
      "Steering curve adjustable, new GT7 driving mode, two new engines (Ford Tudor 1937, VW Beetle 1300) and a comparison profile with a real starter recording for the Porsche.",
    "Fünf neue Ghost-Ideallinien-Modi, dazu die Luuke-Linie: ein neuer Modus, von Hand aus Beispiel-Streckenverläufen hergeleitet. Ghost-Verhalten in der Einführungsrunde und beim Überholen verfeinert.":
      "Five new ghost ideal-line modes, plus the Luuke line: a new mode derived by hand from example track layouts. Ghost behaviour on the formation lap and while overtaking refined.",
    "Menüs komplett mit Gamepad/Tastatur navigierbar, inklusive Info-Popups und mehreren Feinschliffen an der Tastenbelegung (D-Pad-Fixes, Select schaltet jetzt den Bahn-Lesemodus).":
      "Menus fully navigable with gamepad/keyboard, including info popups and several refinements to the key bindings (D-pad fixes, Select now toggles the track-read mode).",
    "Info-Tab jetzt als Kacheln (Wozu, Danksagungen, Patchnotes).":
      "Info tab now as tiles (What for, Acknowledgements, Patchnotes).",
    "Regen-Übergang nachgemessen: kein Griff-Sprung, auch nicht beim erneuten Regenbeginn.":
      "Rain transition measured: no grip jump, not even when rain starts again.",
    "Gedruckte Streckenmuster zum Auslegen (Gerade, 60°-Kurve in zwei Größen) - rein visuell, ohne Strichcode-Anspruch.":
      "Printed track patterns to lay out (straight, 60° curve in two sizes) - purely visual, no barcode claim.",
    "Streckenscan überarbeitet, neu: Strecke aus einer Aufnahme lernen.":
      "Track scan reworked, new: learn a track from a recording.",
    "Motorsound ist jetzt pro Auto einzeln wählbar, Funk-Ansagen haben Vorrang vor der Live-Stimme.":
      "Engine sound is now selectable per car, radio announcements now take priority over the live voice.",
    "Neu in den Entwicklertools: Binär-/Hex-Trainer.":
      "New in the developer tools: binary/hex trainer.",
    "Die Hardware ist gekauft, die Software bestimmt jemand anders. Dieses Projekt dreht das um: es steuert ein Carrera-Hybrid-Auto mit eigenem Code über dieselbe Bluetooth-Schnittstelle, die die Hersteller-App benutzt. Damit läuft auf der Hardware, was man selbst darauf laufen lassen will – unabhängig davon, ob ein Anbieter eine Funktion vorsieht, eine App weiter pflegt oder einen Server abschaltet.": "The hardware is bought and paid for; what runs on it is somebody else’s decision. This project turns that around: it drives a Carrera Hybrid car with its own code over the same Bluetooth interface the manufacturer’s app uses. What runs on the hardware is then what you want to run on it – regardless of whether a vendor provides a feature, keeps an app maintained, or switches off a server.",
    "Der zweite Punkt ist die Gemeinschaft. Ein offengelegtes Protokoll kann jeder weiterverwenden: für Funktionen, die der Hersteller nicht baut, für eine andere Bedienung, für Unterricht. Das hier ist bewusst als Beispiel gebaut und nicht als Produkt: alles, was herausgefunden wurde, steht in der Doku, samt der Stellen, an denen wir uns geirrt haben.": "The second point is the community. A documented protocol is something anyone can build on: for features the manufacturer does not build, for a different way of controlling things, for teaching. This is deliberately built as an example and not as a product: everything that was found out is written down in the documentation, including the places where we got it wrong.",
    "Offene Software als Teil offener Wissenschaft": "Open software as part of open science",
    "Wer Ergebnisse prüfbar machen will, braucht prüfbare Werkzeuge. Eine Auswertung, die auf einem Programm beruht, in das niemand hineinsehen darf, ist genau so weit nachvollziehbar wie das Vertrauen in dessen Hersteller reicht. Deshalb wechseln Forschende zunehmend von kommerzieller auf offene Software, und deshalb steigen auch Landesverwaltungen von Windows auf Linux um: es geht um Kontrolle über die eigene Infrastruktur, nicht um Anschaffungskosten.": "Anyone who wants results to be verifiable needs verifiable tools. An analysis that rests on a program nobody is allowed to look inside is reproducible exactly as far as trust in its maker reaches. That is why researchers are increasingly moving from commercial to open software, and why state administrations are moving from Windows to Linux: it is about control over your own infrastructure, not about purchase costs.",
    "Offene Software kann dabei sogar sicherer sein, und der Grund dafür heißt Kerckhoffs’ Prinzip: ein Verfahren soll seine Sicherheit aus dem geheimen „Schlüssel“ ziehen und nicht aus der Geheimhaltung des „Verfahrens“. Ein Verfahren, das nur funktioniert, solange niemand es kennt, ist nicht sicher, sondern unprüfbar. Offenlegung ist deshalb kein Risiko, sondern die Voraussetzung dafür, dass Fehler gefunden werden können.": "Open software can even be more secure, and the reason has a name: Kerckhoffs’ principle. A system should draw its security from the secret “key” and not from keeping the “method” secret. A method that only works as long as nobody knows it is not secure, it is unverifiable. Disclosure is therefore not a risk but the precondition for errors being findable at all.",
    "Das heißt nicht, dass offene Software automatisch sicherer ist – nur, dass Prüfbarkeit und Sicherheit sich nicht widersprechen.": "That does not mean open software is automatically more secure – only that verifiability and security do not contradict each other.",
    "Zum Weiterlesen und Ausprobieren": "Further reading, and something to try",
    "„Ada & Zangemann“ von Matthias Kirschner und Sandra Brandstätter ist ein Kinderbuch darüber, wem die Software auf einem Gerät eigentlich gehört. Es erklärt in einer Geschichte, worum es oben in drei Absätzen ging.": "“Ada & Zangemann” by Matthias Kirschner and Sandra Brandstätter is a children’s book about who actually owns the software on a device. It explains in a story what the three paragraphs above were about.",
    "Und praktisch: die Programmierschule unter Entwicklertools lässt dich Beschleunigungs- und Lenkkurven mit der Hand ziehen und sofort sehen, was das Auto daraus macht. Das ist der kürzeste Weg von „Programmieren ist abstrakt“ zu „eine eckige Kurve fährt schlechter als eine geschmeidige“.": "And something hands-on: the programming school under Developer tools lets you drag acceleration and steering curves by hand and see at once what the car makes of them. That is the shortest road from “programming is abstract” to “a kinked curve drives worse than a smooth one”.",
    "Eine CH-Strecke oder der Start/Ziel-Ausdruck – benötigt zum Rundenzählen.": "A CH track or the start/finish printout – needed for counting laps.",
    "gemessen: gekippt bei": "measured: tipped at",
    "der Deckel ist die Hälfte davon": "the cap is half of that",
    "gemessen: nie gekippt – der Deckel ist der höchste gehaltene Wert": "measured: never tipped – the cap is the highest value it held",
    "geschätzt, noch nichts gemessen": "estimated, nothing measured yet",
    "Meldet Byte 12 den Wert 0x00, ist das Auto neben der Bahn: dann brummt der Controller leicht und das Gas wird auf 45 % gedeckelt. Wirkt nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus ist der Streckensensor aus und Byte 12 stände dauernd auf 0x00. Der Brummteil braucht zusätzlich den Schalter „Vibration“ darüber.": "If byte 12 reports 0x00 the car is off the track: the controller then rumbles gently and the throttle is capped at 45 %. Only takes effect in the “On the track” position: in printout mode the track sensor is off and byte 12 would sit at 0x00 permanently. The rumble part additionally needs the “Vibration” switch above.",
    "Wie weit die Bewegungsbytes 1 und 3 vom gleitenden Mittel abweichen müssen, damit ein Stoß als Crash gilt. Niedriger heißt empfindlicher: schon ein Rempler zählt. Höher heißt, dass nur ein echter Einschlag zählt. 40 ist der Wert, mit dem die Erkennung gebaut und geprüft wurde.": "How far motion bytes 1 and 3 must deviate from the running mean for an impact to count as a crash. Lower means more sensitive: a nudge already counts. Higher means only a real hit counts. 40 is the value the detection was built and tested with.",
    "Die drei führenden dünnen Striche lassen sich abschneiden, das Blatt wird weiter gelesen: der Vorlauf ist kein Nutzdatum. Und eines der beiden wiederholten Muster genügt. Die kleinste tragende Nutzlast ist damit ein Wort ohne Vorlauf, etwa 54 mm in Fahrtrichtung. Deshalb sind die Vorlauf- und Probeblätter aus dieser Seite verschwunden.": "The three leading thin bars can be cut off and the sheet is still read: the run-in is not payload. And one of the two repeated patterns is enough. The smallest load-bearing payload is therefore one word without a run-in, about 54 mm in the direction of travel. That is why the run-in and test sheets have disappeared from this page.",
    "Ein Carrera-Hybrid-Auto mit Firmware Stand August 2026.": "A Carrera Hybrid car with firmware as of August 2026.",
    "Einen Bluetooth-Controller. Getestet mit DualShock 4 und DualSense.": "A Bluetooth controller. Tested with a DualShock 4 and a DualSense.",
    "Start/Ziel als SVG herunterladen": "Download start/finish as SVG",
    "Zwei verschiedene Pups-Hupen": "Two different whoopee horns",
    "Einführungsrunde mit Boxengassen-Tempo, frei beim ersten Überfahren von Start/Ziel – von wem auch immer, ein Ghost darf es sein. Danach fährt jeder nach seinen Einstellungen.": "Formation lap at pit-lane pace, released the first time anyone crosses start/finish – a ghost may do it. After that everyone drives to their own settings.",
    "Getriebe": "Gearbox",
    "Wieviele Gänge und wie weit sie auseinanderliegen. Steht hier und nicht unter „Getriebe und Fahrleistung“, weil es dieselbe Art Aussage ist wie das Layout darüber: welches Auto du fährst. Wie du damit fährst – von Hand oder automatisch – steht weiter unten. Die Voreinstellungen fassen beides absichtlich nicht an. Die Drehzahlgrenze bleibt, wo sie ist: die gehört zum Motor und nicht zum Getriebe. Geändert werden Anzahl, Spreizung und Schaltpunkte – und die Schaltzeit, und die ist der größere Unterschied: 40 ms nahtlos gegen 350 ms Kulisse mit Kupplung. Acht Gänge sind F1-Reglement, sechs sequenzielle GT3-Standard, fünf hatte das Transaxle des 412P. Welche Geschwindigkeit im dritten Gang liegt, ist eine Schätzung aus der Klasse.": "How many gears there are and how far apart they sit. It stands here and not under “Gearbox and performance” because it is the same kind of statement as the layout above it: which car you drive. How you drive it – by hand or automatically – is further down. The presets deliberately touch neither. The rev limit stays where it is: that belongs to the engine, not to the gearbox. What changes is the number of gears, their spacing and the shift points – and the shift time, which is the bigger difference: 40 ms seamless against 350 ms of gate and clutch. Eight gears are F1 regulations, six sequential ones are the GT3 standard, five were in the 412P transaxle. Which speed third gear reaches is an estimate from the class.",
    "Daten des Getriebes": "Gearbox data",
    "Bis zu welchem Tempo jeder Gang reicht. Gerechnet aus den Übersetzungen und der Höchstgeschwindigkeit, nicht eingetippt.": "How fast each gear reaches. Calculated from the ratios and the top speed, not typed in.",
    "Rundenzeiten ansagen": "Announce lap times",
    "Nach jeder Runde die Zeit, und bei einer eigenen Bestzeit ein Wort dazu. Gesprochen von der eingebauten Stimme des Browsers – kein Dienst, kein Netz, nichts verlässt das Gerät. Absichtlich kurz gehalten, damit die Ansage vor der nächsten Kurve fertig ist. Kommt eine zweite Runde herein, während noch geredet wird, bricht die alte Ansage ab: die Zeit der Gegenwart ist wichtiger. Ob es überhaupt spricht, hängt an den Stimmen des Systems – unter Windows sind sie lokal vorhanden, auf Android können sie fehlen. Fehlt eine, steht das einmal im Protokoll und nicht bei jeder Runde.": "The time after every lap, and a word with it on a personal best. Spoken by the browser’s built-in voice – no service, no network, nothing leaves the device. Deliberately kept short so the announcement is finished before the next corner. If a second lap comes in while it is still talking, the old announcement is cut off: the time of the present matters more. Whether it speaks at all depends on the voices of the system – under Windows they are installed locally, on Android they can be missing. If one is missing, that goes into the log once and not on every lap.",
    "Alle sind aus Zylinderzahl, Kurbelwelle, Bankaufteilung und Zündfolge gerechnet – keine Aufnahme. Bei den aufgeladenen Originalen fehlt der Lader. Die sechs mit WIP sind noch nicht nach Gehör geprüft; beim Maserati kommt dazu, dass dieses Modell den Bankwinkel gar nicht darstellt, weshalb er sich vom Ferrari-V12 nur in Drehzahl und Rohrlänge unterscheidet. Der Boxer-Rumpel des Subaru kommt aus ungleich langen Krümmerrohren; das Modell trägt feste Zeitversätze je Zylinder und damit die richtige Art von Unregelmäßigkeit, aber ihr genaues Muster ist gewählt und nicht aus Rohrlängen gerechnet.": "All of them are computed from cylinder count, crankshaft, bank split and firing order – none is a recording. The forced-induction originals are missing their turbo. The six marked WIP have not been judged by ear; with the Maserati there is the added point that this model cannot represent bank angle at all, so it differs from the Ferrari V12 only in revs and pipe length. The Subaru boxer rumble comes from unequal-length headers; the model carries fixed per-cylinder timing offsets and therefore the right KIND of irregularity, but their exact pattern is chosen, not computed from pipe lengths.",
    "Trapez-Muster, randlos, ohne Strichcode": "Trapezoid pattern, borderless, no barcode",
    "Zum Auslegen und Fotografieren, ohne jede Behauptung, maschinenlesbar zu sein - anders als die Blätter oben, die trotz ihrer Warnung noch ein (falsches) Strichcode-Wort tragen. Senkrechte Trapez-Balken, randlos bis zum Blattrand: oben (bzw. innen in der Kurve) schmal, unten (aussen) breit, mit einer Lücke dazwischen, die genau dieselbe Form kopfueber hat. Die genaue Folge ist ERFUNDEN - das echte Wort ist weder für die Gerade (Byte 12 = 0x02) noch die Rechtskurve (0x04) entziffert, und ein bereits gemachter Messversuch an Infrarot-Fotos wie diesen ist dokumentiert gescheitert (CARRERA_HYBRID.md, Fluchtpunkt-Fit, 31.08.) - nur ein Flachbett-Scan gäbe echte Millimeter. Die Zahlen hier (5/20 mm) sind daher eine grobe Ausseneinschätzung, direkt übernommen, keine Messung.":
      "For laying out and photographing, without any claim to be machine-readable - unlike the sheets above, which despite their warning still carry a (wrong) barcode word. Vertical trapezoid bars, borderless to the sheet edge: narrow at the top (or inner edge in the curve), wide at the bottom (outer edge), with a gap between them that has exactly the same shape upside down. The exact sequence is MADE UP - the real word is decoded for neither the straight (byte 12 = 0x02) nor the right curve (0x04), and a measurement attempt already made on infrared photos like these is documented to have failed (CARRERA_HYBRID.md, vanishing-point fit, 31 Aug) - only a flatbed scan would give real millimetres. The numbers here (5/20 mm) are therefore a rough estimate from looking at the photo, taken directly, not a measurement.",
    "12 Trapeze nebeneinander, randlos über die ganze Seite, oben 5 mm und unten 20 mm breit.":
      "12 trapezoids side by side, borderless across the whole sheet, 5 mm wide at the top and 20 mm at the bottom.",
    "Gerade herunterladen (SVG)": "Download straight (SVG)",
    "Rechtskurve, 60° – Version A": "Right curve, 60° – version A",
    "8 radiale Trapez-Keile, randlos über die ganze Seite (Aussenradius so gewählt, dass der Sektor die Blattbreite genau ausfüllt, OHNE über sie hinauszugehen), innen 5 mm und aussen 20 mm breit.":
      "8 radial trapezoid wedges, borderless across the whole sheet (outer radius chosen so the sector exactly fills the sheet width, WITHOUT going beyond it), 5 mm wide at the inner edge and 20 mm at the outer edge.",
    "Kurve A herunterladen (SVG)": "Download curve A (SVG)",
    "Rechtskurve, 60° – Version B (echte Größe)": "Right curve, 60° – version B (real size)",
    "Echter Radius (370 mm) und echte Breite (250 mm) aus 60-track.js, unskaliert - deutlich größer als A4 quer. Das Blatt zeigt nur den Ausschnitt, der hineinpasst; der Rest ist absichtlich abgeschnitten, nicht verkleinert wie in Version A.":
      "Real radius (370 mm) and real width (250 mm) from 60-track.js, unscaled - noticeably bigger than A4 landscape. The sheet shows only the section that fits; the rest is cut off on purpose, not shrunk down as in version A.",
    "Kurve B herunterladen (SVG)": "Download curve B (SVG)",
    "Zwei benachbarte Plätze fahren in der Einführungsrunde versetzt, also als Zweierkolonne. Die Runde läuft mit Boxengassen-Tempo; sobald das erste Auto Start/Ziel zum zweiten Mal überfährt, ist das Limit weg. Aufstellen musst du von Hand – ein Auto auf die Bahn setzen kann die App nicht. Dein eigenes Auto steht mit in der Liste und verschiebt damit, auf welche Seite die Ghosts hinter dir gehen.": "Two adjacent grid slots drive offset from each other on the formation lap, so as a double column. The lap runs at pit-lane pace; as soon as the first car crosses start/finish for the SECOND time the limit is gone. Lining up is your job – the app cannot place a car on the track. Your own car is in the list too and therefore shifts which side the ghosts behind you take.",
    "Diese Seite zählt Aufrufe mit GoatCounter, damit ich weiß, ob das Projekt jemand benutzt. Ohne Cookies, ohne Werbung und ohne personenbezogene Daten; wer den Zähler blockiert, verliert keine Funktion. Alles andere – Abstimmungen, Rundenzeiten, Streckenpläne – bleibt im Browser und wird nirgends hingeschickt.": "This page counts visits with GoatCounter so I know whether anyone uses the project. No cookies, no advertising and no personal data; blocking the counter costs you no function. Everything else – setups, lap times, track plans – stays in the browser and is not sent anywhere.",
    "Gänge": "gears",
    "Schaltzeit": "shift time",
    "EINFÜHRUNGSRUNDE · AUTOPILOT": "FORMATION LAP · AUTOPILOT",
    "EINFÜHRUNGSRUNDE": "FORMATION LAP",
    "GELB": "YELLOW",
    "ANFAHRT": "ROLLING UP",
    "Einführungsrunde": "Formation lap",
    "Ghost: Querlage festhalten": "Ghost: hold a lateral offset",
    "Alle Ghosts halten einen festen Versatz, statt zu fahren, was Ideallinie, Spur und Ausweichen sagen. Links ist links, rechts ist rechts, Mitte ist aus – und in der Mitte läuft alles wie sonst. Wozu das gut ist: Byte 7 trägt einen Lenkwinkel und keine Position. Dass daraus eine gehaltene Lage neben der Mitte wird, leistet allein die Schienenführung des Autos – und ob das stimmt und bis zu welchem Wert, ist nie gemessen worden. Mit einem festen Versatz siehst du es: bleibt das Auto neben der Mitte, oder zieht es zurück? Ab welchem Wert reißt es ab? Ist links wie rechts? Der Wert daneben geht ungefiltert auf Byte 7, also ist er genau das, was am Auto ankommt.":
      "All ghosts hold a fixed offset instead of driving what the racing line, the lane and the evasion say. Left is left, right is right, centre is off – and in the centre everything runs as usual. What it is for: byte 7 carries a steering ANGLE and not a position. That a held position beside the centre comes out of it is done by the car's own rail following alone – and whether that holds, and up to which value, has never been measured. With a fixed offset you can see it: does the car stay beside the centre, or does it pull back? At which value does it come off? Is left the same as right? The value beside it goes to byte 7 unfiltered, so it is exactly what arrives at the car.",
    "Prüfstand": "test rig",
    "Physik":
      "Physics",
    "Aus, rohe Stickstellung":
      "Off, raw stick position",
    "Drift (experimentell)":
      "Drift (experimental)",
    "Gegensteuern im Drift":
      "Countersteer in drift",
    "Drift-Probe (4 s)":
      "Drift probe (4 s)",
    "Ghosts fahren die Runde zu Ende":
      "Ghosts are finishing the lap",
    "Alle im Ziel":
      "Everyone home",
    "Physik: Drehmoment, Gänge, Reibkreis – die Vorgabe. Aus: rohe Stickstellung ohne Gänge, wie ein Fernsteuerungsauto. Drift: rohes Gas wie bei „Aus“, dazu ein automatisches Gegensteuern gegen das gemessene Drehsignal des Autos und eine weichere Lenkung. Der Drift-Modus ist experimentell, und die Zeile darunter sagt, warum.":
      "Physics: torque, gears, friction circle – the default. Off: raw stick position with no gears, like a radio-controlled car. Drift: raw throttle as with “Off”, plus automatic countersteer against the car's measured rotation signal and softer steering. Drift mode is experimental, and the line below says why.",
    "Wie stark gegen das Ausbrechen gelenkt wird, gemessen am Drehsignal aus Byte 3 der Meldungen. 50 Prozent entspricht der Vorgabe, nach der gefragt wurde. Was daran unsicher ist, und zwar beides zugleich: das Signal ist unbestätigt – es schwankt erst, wenn das Auto fährt, und wechselte in genau einer Aufnahme das Vorzeichen mit der Kurvenrichtung. Und es ist unkalibriert: sein Maßstab wird selbst nachgeführt, weil die wirkliche Amplitude unbekannt ist. Deshalb hängt die Stärke davon ab, welchen größten Gierwert die Sitzung bisher gesehen hat. Der Knopf „Drift-Probe“ unter „Querablage messen“ misst, ob das Signal bei gerader Vollgasfahrt überhaupt ausschlägt.":
      "How hard the car steers against a slide, measured from the rotation signal in byte 3 of the notifications. 50 per cent is the default that was asked for. What is uncertain about it, and it is two things at once: the signal is unconfirmed – it only varies once the car is moving, and flipped sign with cornering direction in exactly one recording. And it is uncalibrated: its scale is self-adjusting because the real amplitude is unknown. So the strength depends on the largest yaw value the session has seen so far. The “Drift probe” button under “Measure lateral offset” measures whether the signal moves at all under straight full throttle.",
    "Rennen":
      "Race",
    "Danksagungen":
      "Acknowledgements",
    "Dieses Projekt steckt voller Dinge, die jemand anders herausgefunden, ausprobiert oder geduldig zurückgemeldet hat. Namentlich:":
      "This project is full of things somebody else worked out, tried out or patiently reported back. By name:",
    "Für das Feedback zum Steuern per RC-Funke über CH Control.":
      "For the feedback on driving by RC transmitter through CH Control.",
    "Fürs Teilen seines Wissens zu den Bluetooth-Protokollen.":
      "For sharing his knowledge of the Bluetooth protocols.",
    "Den Testern dort, für Rückmeldungen aus echten Rennen, die keine Simulation liefert.":
      "To the testers there, for reports from real races that no simulation provides.",
    "Für das Finden und Berichten zahlreicher Bugs.":
      "For finding and reporting numerous bugs.",
    "Woher die Klänge kommen":
      "Where the sounds come from",
    "Der allergrößte Teil der Klänge ist gerechnet und nicht aufgenommen: alle fünfundzwanzig Motoren mit ihren 132 Schleifen, dazu Bremsen- und Reifenquietschen, die Crash-Varianten, Schlagschrauber, Tankgeräusch, Karosseriereparatur und der Motorstart. Dort wird nichts abgespielt, sondern aus Zylinderzahl, Zündfolge und Krümmerlänge erzeugt.":
      "The vast majority of the sounds are computed, not recorded: all twenty-five engines with their 132 loops, plus brake and tyre squeal, the crash variants, the impact wrench, the refuelling sound, the bodywork repair and the engine start. Nothing is played back there; it is generated from cylinder count, firing order and header length.",
    "Hupen für die Lichthupe – sechs Aufnahmen, in dieser Reihenfolge Autohupe, Schiffshupe, Esel, Ziege und zwei Furztöne. Der letzte stammt von freesound community über Pixabay.":
      "Horns for the headlight flash – six recordings, in this order car horn, ship horn, donkey, goat and two fart sounds. The last one is from freesound community via Pixabay.",
    "Regen und Donner.":
      "Rain and thunder.",
    "Strecken-Ambience, also der Teppich und die Vorbeifahrten.":
      "Track ambience, meaning the bed and the passing cars.",
    "Der Motorklang der Corvette C6.":
      "The engine sound of the Corvette C6.",
    "Das Motormodell folgt dem Ansatz von engine-sim unter der MIT-Lizenz; Zylinderzahlen, Drehzahlgrenzen und Kurbelwellenwinkel stammen aus dessen Motordefinitionen. Die vollständige Aufstellung mit allen Messwerten steht in der Datei CREDITS im Audio-Ordner.":
      "The engine model follows the approach of engine-sim under the MIT licence; cylinder counts, rev limits and crankshaft angles come from its engine definitions. The full listing with all measurements is in the CREDITS file in the audio folder.",
    "Code auf GitHub":
      "Source on GitHub",
    "Zu wenige Runden für einen Verlauf. Ab der zweiten Runde wird hier gezeichnet.":
      "Too few laps for a chart. From the second lap on it is drawn here.",
    "Aus (Vorgabe): du steuerst ganz normal, dein Lenk-Input ist der Lenkwinkel – wie ohne diese App.":
      "Off (default): you steer completely normally, your steering input is the steering angle – same as without this app.",
    "Cockpit-Schirm zurück":
      "Cockpit screen back",
    "Cockpit-Schirm vor":
      "Cockpit screen forward",
    "Lenkunterstützung":
      "Steering assist",
    "Ab welcher Querlage korrigiert wird":
      "Lateral offset at which it corrects",
    "Wie stark korrigiert wird":
      "How strongly it corrects",
    "Langstrecken-Prototypen (WIP)":
      "Endurance prototypes (WIP)",
    "Tourenwagen, DTM und NASCAR (WIP)":
      "Touring cars, DTM and NASCAR (WIP)",
    "Amerikanische Straßenmotoren (WIP)":
      "American road engines (WIP)",
    "Corvette C5-R: V8, Cross-Plane, OHV, 7,0 l":
      "Corvette C5-R: V8, cross-plane, OHV, 7.0 l",
    "Lister Storm LMP: Jaguar-V12, 60 Grad, 7,0 l":
      "Lister Storm LMP: Jaguar V12, 60 degrees, 7.0 l",
    "Audi RS5 DTM 2019: Reihen-4 Turbo, 2,0 l":
      "Audi RS5 DTM 2019: turbo inline-4, 2.0 l",
    "Chevrolet Impala SS NASCAR: V8, OHV, 9000/min":
      "Chevrolet Impala SS NASCAR: V8, OHV, 9000 rpm",
    "Ford Capri Zakspeed Turbo 1981: Reihen-4, 1,7 l":
      "Ford Capri Zakspeed Turbo 1981: inline-4, 1.7 l",
    "Porsche 935 K4 Kremer 1981: Flat-6, Twin-Turbo":
      "Porsche 935 K4 Kremer 1981: flat-6, twin-turbo",
    "Dodge Challenger SRT Demon: HEMI-V8, Kompressor, 6,2 l":
      "Dodge Challenger SRT Demon: HEMI V8, supercharged, 6.2 l",
    "Ford Mustang 390 GT 1968: FE-V8, Cross-Plane, 6,4 l":
      "Ford Mustang 390 GT 1968: FE V8, cross-plane, 6.4 l",
    "Chevrolet Blazer 1990: Small-Block-V8, TBI, 5,7 l":
      "Chevrolet Blazer 1990: small-block V8, TBI, 5.7 l",
    "Alltagsklassiker vor 1970 (WIP)": "Everyday classics before 1970 (WIP)",
    "Streckenscan": "Track scan",
    "Scan abbrechen": "Cancel scan",
    "Ford Tudor Slantback 1937: Flathead-V8, 3,6 l":
      "Ford Tudor Slantback 1937: flathead V8, 3.6 l",
    "VW Käfer 1300: Boxer-4, luftgekühlt":
      "VW Beetle 1300: flat-4, air-cooled",
    "Regenreifen: setzt Regen ein, kommt jeder Ghost so früh wie möglich herein und rüstet um – und beim Wechsel zurück auf trocken genauso. Solange die falschen Reifen drauf sind, fährt er langsamer: 0,64 gegen 0,85 mit Regenreifen im Regen, abgeleitet aus derselben Grifftabelle, die dein Auto benutzt. Bei leichtem Regen ist der Slick noch vorn – der Nachteil kommt mit dem Wasser, nicht mit der Meldung. Ist dieser Schalter aus, können Ghosts keine falschen Reifen haben, sonst kröchen sie nach dem ersten Regen ohne Ausweg.":
      "Rain tyres: when rain sets in, every ghost comes in as early as it can and changes – and the same on a change back to dry. While it is on the wrong tyres it drives slower: 0.64 against 0.85 on rain tyres in the rain, derived from the same grip table your own car uses. In light rain the slick is still ahead – the penalty arrives with the water, not with the announcement. With this switch off ghosts cannot have the wrong tyres, because otherwise they would crawl after the first shower with no way out.",
    "Ein Ghost fährt auf der Start/Ziel-Kachel rechts an den Rand, bleibt ein paar Sekunden stehen und fährt wieder los. Die Anfahrt beginnt schon auf der Kachel davor, im Formationstempo – ein Auto, das mit Renntempo über die Linie kommt, braucht eine Kachel zum Verzögern. Standardmäßig AUS: ein Auto, das mitten im Rennen stehen bleibt, liest man beim ersten Start als Fehler und nicht als Feature. Der Ablauf ist absichtlich hart – eine Sekunde am rechten Rand mit voller Bremse (am Tempo-Regler vorbei, der braucht für einen sauberen Halt 1,1 s), dann ruckartig heraus in 0,5 s, das ist die Grenze der Querführung, und dabei blinken die Lichter doppelt. Es gibt vier Boxen hintereinander: Platz 1 auf der Start/Ziel-Kachel, Platz 2 eine Kachel später und so weiter. Wer gleichzeitig fällig ist, nimmt den nächsten freien und hält eine Kachel dahinter; wer als Fünfter kommt, wartet, bis eine frei wird. Auf dem Weg zur eigenen Box fährt er am Gegenrand vorbei – sonst würde er dem Stehenden ins Heck fahren. Gemessen bei einem Wetterwechsel mit sechs Ghosts: vier stehen gleichzeitig, keine Doppelbelegung, und in 555 Takten Vorbeifahrt kein einziger Takt mit rechter Anforderung. Vier Kacheln sind 1,72 m – mehr Boxen würden auf einem kleinen Layout einen merklichen Teil der Bahn füllen.":
      "Off by default: a car that stops in the middle of a race reads as a fault on a first start, not as a feature. The sequence is deliberately hard – one second at the right-hand edge on full brakes (bypassing the speed controller, which needs 1.1 s for a clean stop), then a jerky exit in 0.5 s, the limit of the lateral rate, with the lights double-flashing. A ghost pulls over to the right-hand edge on the start/finish tile, stands there for a few seconds and drives off again. The approach begins on the tile before it, at formation pace – a car crossing the line at racing speed needs a tile to slow down. There are four boxes in a row: box 1 on the start/finish tile, box 2 one tile later and so on. Whoever is due at the same moment takes the next free one and stops a tile further along; a fifth car waits until one frees up. On the way to its own box it passes along the far edge – otherwise it would drive into the back of the car standing there. Measured on a weather change with six ghosts: four stand at once, no box taken twice, and in 555 ticks of passing not one tick asked for the right-hand edge. Four tiles are 1.72 m – more boxes would fill a noticeable part of a small layout.",
    "Ghost: Boxenstopp":
      "Ghost: pit stop",
    "Ghost: Boxenstopp im freien Fahren":
      "Ghost: pit stop when free running",
    "Ghost: Boxenstopp-Länge":
      "Ghost: pit stop length",
    "Ghost: Boxenstopp frühestens nach":
      "Ghost: pit stop no sooner than",
    "Ghost: Boxenstopp spätestens nach":
      "Ghost: pit stop no later than",
    "Die anderen weichen auf der Boxenkachel nach links aus, und ihre Querlage ist dort nach rechts gesperrt – das Ausweichen allein wäre nur die weiche Hälfte, die Sperre ist die Zusage. Dein eigenes Auto ist nicht steuerbar; es gibt eine Meldung und den Punkt auf der Karte, mehr geht nicht.":
      "On the pit tile the others move to the left, and their lateral position is barred from going right there – the yielding alone would only be the soft half, the bar is the guarantee. Your own car cannot be steered; there is a message and the dot on the map, and that is all there is.",
    "Was der Stopp nicht kann: wissen, wo der Rand ist. Das Auto meldet seine Querlage nicht, voller Ausschlag ist ein Befehl und keine Messung. Die Zusage ist nicht die Randlage, sondern dass die anderen auf der anderen Seite sind.":
      "What the stop cannot do: know where the edge is. The car does not report its lateral position, and full lock is a command, not a measurement. The guarantee is not the edge itself but that the others are on the other side.",
    "Ob auch außerhalb eines Rennens gepittet wird. Beim Losfahren aus der Garage stellt man meist Regler ein, und ein Auto, das dabei zehn Sekunden steht, sieht nach einem Fehler aus – deshalb getrennt abschaltbar. Im Rennen und in der Rennsimulation gilt der Schalter darüber.":
      "Whether pit stops also happen outside a race. When you set cars off from the garage you are usually adjusting sliders, and a car that stands still for ten seconds while you do looks like a fault – hence a separate switch. In a race and in the race simulation the switch above applies.",
    "Wie lange ein Ghost steht. 5 s ist die Mitte des Bandes und keine Messung – wie lang ein Boxenstopp aussehen soll, ist Geschmack. Der eigene Boxenstopp braucht zum Vergleich 4 s für die Reifen und mindestens 3 s Standzeit, wenn er vorgeschrieben ist.":
      "How long a ghost stands still. 5 s is the middle of the range and not a measurement – how long a pit stop should look is a matter of taste. For comparison, your own pit stop needs 4 s for the tyres and at least 3 s of standing time when it is mandatory.",
    "Die untere Grenze des Bandes, aus dem jeder Ghost seine nächste Fälligkeit zieht – in Runden, nach jedem Stopp neu gezogen. Dieselbe Bauform wie der Wetterwechsel, damit nicht alle im Gleichschritt pitten. Schiebt man diesen Regler über den nächsten, geht der mit.":
      "The lower bound of the range each ghost draws its next due date from – in laps, drawn afresh after every stop. The same shape as the weather change, so that they do not all pit in lockstep. Push this slider past the next one and that one moves with it.",
    "Die obere Grenze desselben Bandes, in Runden. Bei gleichen Werten pittet jeder Ghost genau nach dieser Rundenzahl – dann ist nichts mehr zufällig, und das ist eine gültige Einstellung. Nicht an den Reifenverschleiß gebunden: Ghosts haben keinen, ihre Motoren werden ohne Reifen- und Tankmodell gebaut.":
      "The upper bound of the same range, in laps. With both set alike every ghost pits after exactly that many laps – nothing is random then, and that is a valid setting. Not tied to tyre wear: ghosts have none, their engines are built without a tyre or fuel model.",
    "Ein Verfolger, der 0,9 s dicht dran hängt, setzt an: erst zur Seite, dann Schub, dann vorne wieder einordnen. Der Vorausfahrende weicht zur anderen Seite aus – zwei Autos auf 25 cm Bahnbreite brauchen beide Hälften. Klappt es nach 5 s nicht, bricht er ab und wartet 6 s; ohne diesen Abbruch klebte der Verfolger neben dem anderen, bis die Uhr ablief, und genau dort berühren sie sich.":
      "A chaser hanging on within 0.9 s has a go: first out to the side, then the extra push, then tuck back in ahead. The car in front moves the other way – two cars on 25 cm of track width need both halves. If it has not worked after 5 s he backs out and waits 6 s; without that exit the chaser stuck alongside until the clock ran out, and that is exactly where they touch.",
    "Seit v0.5.44 auch in Kurven, und die Erlaubnis hängt nicht an der Kachelart, sondern am freien Platz: 1 minus dem Anteil des Anschlags, den die Ideallinie hier schon belegt. Unter 30 % passt kein zweites Auto daneben, und die Wahrscheinlichkeit wächst mit dem Platz. Gemessen in 1500 Takten: bei 0,70 Platz 34 Versuche, bei 0,14 keiner – egal ob Gerade oder Haarnadel. Auf deiner Vorgabestrecke haben 11 von 13 Kacheln genug Platz. Nur in eine Haarnadel hinein wird nicht angesetzt: ein Versuch dauert bis zu 5 s, eine Kachel rund 0,7 – wer davor ausholt, ist beim Einlenken noch daneben.":
      "Since v0.5.44 in corners too, and permission does not depend on the kind of tile but on the free room: 1 minus the share of full lock the racing line already uses here. Below 30% no second car fits alongside, and the probability grows with the room. Measured over 1500 ticks: at 0.70 of room 34 attempts, at 0.14 none – straight or hairpin alike. On your default track 11 of 13 tiles have enough room. Only into a hairpin is nothing attempted: an attempt lasts up to 5 s and a tile about 0.7 – whoever pulls out before one is still alongside at the turn-in.",
    "Die Seite ist die, auf der der andere nicht ist. Vorher war es die andere Seite als die eigene Linie; auf einer Geraden ist das dasselbe, in einer Kurve nicht. Wer viel Bahnbreite für die Ideallinie ausgibt (Regler „Kurven öffnen“), lässt weniger für Überholmanöver übrig – das ist derselbe Platz.":
      "The side is the one the other car is not on. Before it was the side opposite one's own line; on a straight that is the same thing, in a corner it is not. Spend a lot of track width on the racing line (the „open up the corners“ slider) and less is left for overtaking – it is the same room.",
    "Wie weit außen eine Kurve angefahren und verlassen wird und wie tief der Scheitel innen liegt, als Anteil des Weges zum Rand. Seit v0.5.43 ist das eine Schranke für die Optimierung und kein Nachlauf mehr: die Suche darf alles, was diese Form einhält, und findet darin das schnellste. Vorher wurde die fertige Linie hinterher nach außen geschoben – das kostete gemessen rund vier Sekunden Modellzeit, ohne dass die Zielfunktion davon wusste.":
      "How far out a corner is entered and left, and how deep the apex sits on the inside, as a fraction of the way to the edge. Since v0.5.43 this is a constraint on the optimisation and no longer a post-pass: the search may do anything that keeps this shape, and finds the fastest within it. Before, the finished line was pushed outward afterwards – measured, that cost about four seconds of model time without the objective knowing about it.",
    "Bei 0 entscheidet die Zielfunktion allein, und dann kommt fast die Mittellinie heraus. Das ist kein Fehler, sondern die Geometrie einer Carrera-Kurve: sie ist ein Bogen mit festem Radius von 37 cm. Nachgemessen an einer reinen Rechtskurve, mittlerer Bahnradius bei konstantem Versatz: Mittellinie 34,7 Einheiten, 4 nach außen gibt 38,8, 4 nach innen nur 30,7. Auf einer echten Strecke wählt man mit dem Scheitel den Radius – hier ist er vorgegeben, und Eintauchen macht ihn kleiner. Die zeitschnellste Linie hat deshalb gar keinen Scheitel.":
      "At 0 the objective decides alone, and what comes out is almost the centreline. That is not a fault but the geometry of a Carrera corner: it is an arc of fixed 37 cm radius. Measured on a pure right-hander, mean path radius at a constant offset: centreline 34.7 units, 4 to the outside gives 38.8, 4 to the inside only 30.7. On a real circuit you choose the radius by picking the apex – here it is given, and diving in makes it smaller. The quickest line therefore has no apex at all.",
    "Der Preis, gemessen für Late Apex gegen die Mittellinie: bei 0 ist die Linie 1,0 bis 1,5 % schneller und nutzt 7 % der Breite; bei 0,4 kostet sie 0,7 bis 1,9 % und nutzt 33 bis 48 %; bei 0,8 kostet sie 4,9 bis 5,3 % und nutzt 68 bis 91 %. Wer eine Linie sehen will, die aussieht wie eine Ideallinie, bezahlt sie hier – und die Modellzeit in der Vorschau nennt den Betrag.":
      "The price, measured for late apex against the centreline: at 0 the line is 1.0 to 1.5% faster and uses 7% of the width; at 0.4 it costs 0.7 to 1.9% and uses 33 to 48%; at 0.8 it costs 4.9 to 5.3% and uses 68 to 91%. If you want a line that looks like a racing line, this is where you pay for it – and the model time in the preview names the amount.",
    "Die Wirkung skaliert mit der Bogenlänge des Kurvenzuges: eine einzelne 60-Grad-Kachel hat 36 von 80 Einheiten Bezugslänge und bekommt 45 % davon, eine Haarnadel den ganzen Wert. Ohne das verlangte der Regler auf einer einzelnen Kachel über 12 cm Querbewegung innerhalb von 43 cm Weg. An einer Schikane fällt die Schranke ganz weg: dort sind Ausgang und Eingang derselbe Punkt, und der kann nicht für beide Kurven außen sein.":
      "The effect scales with the arc length of the run of corner tiles: a single 60-degree tile has 36 of 80 units of reference length and gets 45% of it, a hairpin the full value. Without that, on a single tile the slider demanded over 12 cm of lateral movement within 43 cm of travel. At a chicane the constraint drops entirely: there the exit and the entry are the same point, and it cannot be on the outside for both corners.",
    "Alle drei benutzen seit v0.5.43 dieselbe Form – vier Zahlen je Kurve: Eingang, Scheitel, Ausgang und Scheitellage, dazwischen eine Kubik in der Weglänge, auf Geraden eine Gerade. Die Wahl ist damit eine Wahl der Zielfunktion und nicht eine zwischen zwei Verfahren mit unterschiedlicher Glattheit.":
      "Since v0.5.43 all three use the same shape – four numbers per corner: entry, apex, exit and apex position, with a cubic in arc length between them and a straight line on straights. The choice is therefore a choice of objective, and not one between two methods of differing smoothness.",
    "Krümmung minimiert die Krümmungsenergie und braucht keine Annahme über Beschleunigungen. Rundenzeit minimiert die Modellzeit, Scheitel frei. Late Apex minimiert dieselbe Zeit, hält den Scheitel aber hinter 55 % des Kurvenwegs – eine engere Suche kann eine Zeit nur verfehlen, nie verbessern, der Unterschied ist also der Preis der späten Linie.":
      "Curvature minimises curvature energy and needs no assumption about accelerations. Lap time minimises the model time with a free apex. Late apex minimises the same time but keeps the apex beyond 55% of the corner's length – a narrower search can only miss a time, never improve on it, so the difference is the price of the late line.",
    "Vorher optimierten die ersten zwei jeden der rund 180 Abtastpunkte frei und legten dabei Ausschläge hin, die ein Fahrer nie fährt: gemessen sprang die Querlage in Kurven um bis zu 16,0 Einheiten von 8,6 möglichen zwischen zwei benachbarten Punkten. Jetzt sind es höchstens 2,4.":
      "Before, the first two optimised each of the roughly 180 sample points freely and put in excursions no driver would ever take: measured, the lateral position jumped by up to 16.0 units of 8.6 possible between two neighbouring points in corners. Now it is at most 2.4.",
    "Die Zeiten kommen aus den eingestellten Fahrwerten – Spitze, Zug und Bremse aus der aktiven Simulationsklasse; nur die Querbeschleunigung bleibt eine Annahme, weil kein Byte sie meldet. Ob es auf dem Teppich stimmt, sagen Rundenzeit und Abgänge.":
      "The times come from the driving figures in force – top speed, traction and braking from the active simulation class; only lateral acceleration stays an assumption, because no byte reports it. Whether it holds on the carpet is answered by lap times and departures.",
    "{m} ist gewählt. Modellzeit und genutzter Versatz:":
      "{m} is selected. Model time and offset used:",
    "Die Zeiten kommen aus den eingestellten Fahrwerten; die Querbeschleunigung ist darin eine Annahme.":
      "The times come from the driving figures in force; lateral acceleration is an assumption within them.",
    "Lenkdämpfung":
      "Steering damping",
    "sofort":
      "instant",
    "Wie lange das Servo von der Mittelstellung bis zum vollen aktuell möglichen Ausschlag braucht. Das ist nicht die Lenkwinkelbegrenzung darüber – die sagt, wie weit; diese sagt, wie schnell.":
      "How long the servo takes from centre to the full deflection currently available. This is not the steering-angle limit above it – that one says how far, this one says how fast.",
    "0 heißt sofort. Am Lenkrad und an der RC-Funke ist das richtig: dort gibt die Hand die Rate vor, und eine zweite Begrenzung dahinter fühlt sich wie Verzögerung an. Am Gamepad ist ein Daumen in etwa 150 ms von der Mitte am Anschlag, und ohne Dämpfung wird daraus ein Sprung am Servo.":
      "0 means instant. On a wheel or an RC transmitter that is right: there the hand sets the rate, and a second limit behind it feels like lag. On a gamepad a thumb goes from centre to the stop in about 150 ms, and without damping that becomes a jump at the servo.",
    "83 ms ist die Vorgabe und nicht gewählt, sondern der bisherige Wert nachgerechnet: 6,0 Anschläge je Sekunde mal dem kalibrierten Lenkansprechen von 200 % sind 12 je Sekunde. Bis v0.5.40 hing die Zeit zusätzlich am Lenkansprechen – wer es auf 240 % stellte, machte unangekündigt auch die Lenkung schneller, 69 statt 83 ms. Jetzt macht jeder der beiden Regler genau eine Sache.":
      "83 ms is the default, and it is not chosen but the previous value worked out: 6.0 full locks per second times the calibrated steering response of 200% is 12 per second. Up to v0.5.40 the time also depended on the steering response – setting it to 240% silently made the steering faster too, 69 instead of 83 ms. Now each of the two sliders does exactly one thing.",
    "Ein Fahrzeugwechsel weiter oben setzt diesen Regler mit: das Trägheitsmoment ist die einzige Stelle, an der sich ein leichteres Auto zeigen kann, und es ergibt 56 ms beim Formelwagen bis 125 ms beim Frontmotor-GT3. Danach kannst du frei darüber verfügen.":
      "Changing the vehicle above sets this slider too: the moment of inertia is the only place a lighter car can show itself, and it gives 56 ms for the formula car up to 125 ms for the front-engined GT3. After that it is yours to set.",
    "Ghost: Kurven öffnen":
      "Ghost: open up the corners",
    "Die Vorgabe stand bis v0.5.39 auf 1,2 – das war für die alte Linie kalibriert, die an einer Bahnseite klebte. Seit die Linie von außen anfährt und nach außen ausfährt, verlangt sie bis zu 2,9 Bahnbreiten je Sekunde; gemessen kappte 1,2 die Spitze des Lenkbytes auf 67 von 127, während 2,0 auf 95 kommt. Weniger sieht ruhiger aus und folgt der gezeichneten Linie schlechter – hier liegt der Tausch.":
      "Up to v0.5.39 the default was 1.2 – calibrated for the old line, which clung to one side of the track. Now that the line enters and leaves corners from the outside it asks for up to 2.9 track widths per second; measured, 1.2 clipped the peak of the steering byte to 67 of 127, whereas 2.0 reaches 95. Less looks calmer and follows the drawn line less well – that is the trade.",
    "Ghost: so fährt das gewählte Modell":
      "Ghost: how the chosen model drives",
    "Die Linie, die aus der Wahl darüber folgt, mit der Bremsampel: grün freie Fahrt, rot voll anbremsen. Es ist dieselbe Linie, die der Streckeneditor zeichnet und die die Ghosts fahren – alle drei gehen durch denselben Aufruf.":
      "The line that follows from the choice above, with the braking colours: green means clear, red means brake hard. It is the same line the track editor draws and the ghosts drive – all three go through the same call.",
    "Ohne eingetragene Strecke wird auf SR3GLR2GR2G2 gefahren – geliehen, der Streckeneditor bleibt leer.":
      "With no track entered, the race runs on SR3GLR2GR2G2 – borrowed, the track editor stays empty.",
    "Keine Strecke eingetragen.":
      "No track entered.",
    "Gezeigt ist die Vorgabestrecke; im Editor steht noch keine.":
      "Shown is the default track; the editor has none yet.",
    "Ghost: Kurvenausgang öffnen":
      "Ghost: open up the corner exit",
    "Wie weit sich ein Ghost am Kurvenausgang nach außen tragen lässt. Die Krümmungsminimierung kennt das nicht: sie sucht den kürzesten glatten Weg, und bei zwei gleichsinnigen Kurven auf 25 cm Bahnbreite liegt der innen. Gemessen blieb die Linie hinter einer Haarnadel bei 68 % nach innen stehen. Ein Fahrer fährt weit heraus, weil er beschleunigt und dafür Breite braucht – das ist eine Längsgröße, und die kennt der Glätter nicht.":
      "How far a ghost lets itself be carried out on corner exit. Minimum-curvature smoothing knows nothing of this: it looks for the shortest smooth path, and with two same-handed corners on 25 cm of track width that path runs on the inside. Measured, the line stayed 68% toward the inside after a hairpin. A driver runs wide because he is accelerating and needs the width for it – that is a longitudinal quantity, and the smoother does not know about it.",
    "Scheitel und Ausgang kommen aus dem Layout: der Scheitel ist der Punkt größter Linienkrümmung im Kurvenlauf, der Ausgang seine letzte Kachelgrenze. Nur die Stärke und die Auslauflänge von einer Kachel sind gewählt – deshalb dieser Regler.":
      "Apex and exit come from the layout: the apex is the point of greatest line curvature within the run of corner tiles, the exit its last tile boundary. Only the strength and the run-out length of one tile are chosen – hence this slider.",
    "Ghost: Querträgheit":
      "Ghost: lateral inertia",
    "Wie schnell ein Ghost seine Querlage ändern darf, in Bahnbreiten je Sekunde. Die Ideallinie ist eine Funktion des Ortes und nicht der Zeit – beim Wechsel des Kacheltyps ändert sich der Sollwert in einem Takt um bis zu 0,4 der Bahnbreite, und ein Servo, der das in einem Takt nachführt, sieht aus wie ein Ruck.":
      "How fast a ghost may change its lateral position, in track widths per second. The racing line is a function of place and not of time – at a change of tile type the target shifts by up to 0.4 of the track width in a single tick, and a servo that follows that in one tick looks like a jerk.",
    "Eine Ratenbegrenzung und kein Tiefpass: sie hat eine feste Höchstgeschwindigkeit und erreicht den Sollwert exakt, während ein Tiefpass sich ihm nur nähert und dabei umso schneller läuft, je weiter er weg ist. 2,0 sind bei 25 cm Bahnbreite 50 cm/s.":
      "A rate limit and not a low-pass: it has a fixed top speed and reaches the target exactly, whereas a low-pass only approaches it and runs faster the further away it is. On 25 cm of track width 2.0 is 50 cm/s.",
    "Ghost: Brems- und Gasverhalten":
      "Ghost: braking and throttle behaviour",
    "Wie entschlossen ein Ghost Gas gibt und bremst. Ghost und Fahrer gehen durch dasselbe Fahrzeugmodell, bekommen ihr Gas aber aus verschiedenen Quellen: der Fahrer drückt einen Trigger und ist sofort am Anschlag, der Ghost hat einen Regler auf ein Zieltempo, dessen Ausgang ratenbegrenzt ist.":
      "How decisively a ghost applies throttle and brake. Ghost and driver go through the same vehicle model but get their throttle from different sources: the driver pulls a trigger and is at full lock at once, the ghost has a controller on a target speed whose output is rate-limited.",
    "Nachrechenbar: bei 1,0 braucht voller Gasbefehl 0,63 s, ein Trigger etwa 0,15 s – der Ghost ist also rund viermal langsamer im Aufbau, und genau das sieht man am Kurvenausgang. Bei 4,0 liegt er bei 0,16 s und damit dort, wo ein Trigger liegt.":
      "Checkable: at 1.0 a full throttle command takes 0.63 s, a trigger about 0.15 s – so the ghost builds up roughly four times slower, and that is exactly what you see on corner exit. At 4.0 it is at 0.16 s and thus where a trigger is.",
    "1,0 ist der gemessene, stabile Zustand: alle Tempoprüfungen dieser App sind damit gefahren. Die Ratenbegrenzung ist auch der Schutz davor, dass ein zurückgestelltes Auto aus der Hand gerissen wird – wer sie hochdreht, nimmt diesen Schutz zurück.":
      "1.0 is the measured, stable state: every pace test in this app was run with it. The rate limit is also what stops a car you have just put back from being ripped out of your hand – turning it up gives that protection away.",
    "Rennen simulieren":
      "Simulate a race",
    "Was hier passiert":
      "What happens here",
    "Die eingestellten Ghosts fahren die eingetragene Strecke – mit derselben Logik, die sie am echten Auto benutzen: Ideallinie, Kurvendrosselung, Querversatz, Staffel und die zugeschalteten Zutaten. Statt Funkbefehle bekommt ein Fahrzeugmodell das Gas, und aus seinem Tempo wird die Position auf der Bahn. Man sieht das Rennen laufen, nicht sein Ergebnis.":
      "The ghosts as configured drive the track you have entered – with the same logic they use on the real car: racing line, corner throttling, lateral offset, field grading and whichever ingredients are switched on. Instead of radio commands a vehicle model gets the throttle, and its speed becomes the position on the track. You watch the race run, not its result.",
    "Was das nicht ersetzt: Reibung, Staub, ein Auto, das aus der Kurve fliegt. Wer hier vorne ist, ist es im Modell – nicht auf dem Teppich.":
      "What it does not replace: friction, dust, a car flying out of a corner. Whoever leads here leads in the model – not on the carpet.",
    "Anzahl Ghosts":
      "Number of ghosts",
    "Anzahl Runden":
      "Number of laps",
    "Doppelte Geschwindigkeit":
      "Double speed",
    "Spielt die Simulation doppelt so schnell ab. Die Rundenzeiten bleiben die des Rennens – abgespielt wird schneller, gefahren nicht.":
      "Plays the simulation back at twice the speed. The lap times stay those of the race – the playback is faster, the driving is not.",
    "Simulation starten":
      "Start simulation",
    "Rennwürze: einzeln zuschaltbar":
      "Race spice: switchable one by one",
    "Fünf Zutaten, die aus gleichmäßigem Fahren ein Rennen machen sollen. Jede einzeln, damit man sieht, welche was tut – als ein Regler für alle war nicht zu unterscheiden, woran eine Beobachtung lag. Alle experimentell: keine ist am Auto gemessen, alle sind gewählt.":
      "Five ingredients meant to turn even lapping into a race. Each one separately, so you can see which does what – as a single slider for all of them there was no telling what an observation was down to. All experimental: none is measured on the car, all are chosen.",
    "Überholmanöver":
      "Overtaking manoeuvre",
    "Abstand halten":
      "Keeping a gap",
    "Ein Ghost lupft das Gas, wenn er zu schnell auflaufen würde. Gerechnet als Zeitlücke und nicht als fester Abstand: eine Kachel bei gleichem Tempo ist unbegrenzt viel Zeit, eine Kachel bei schneller Annäherung ist eine Sekunde bis zur Berührung. Ohne das fahren sie Stoßstange an Stoßstange. Während eines eigenen Überholmanövers gilt es nicht, sonst käme niemand vorbei.":
      "A ghost lifts off when it would run up too fast. Reckoned as a time gap and not as a fixed distance: one tile at matched pace is unlimited time, one tile while closing fast is one second to contact. Without it they run bumper to bumper. It does not apply during a move of their own, otherwise nobody would ever get past.",
    "Jedes Auto fährt ein etwas anderes Dauertempo, und das verschiebt sich langsam – ein Zufallslauf im Band von ±7,5 %, alle 2,6 s einen Schritt weiter. Damit ist nicht jede Runde gleich, und das Feld sortiert sich von selbst um.":
      "Each car holds a slightly different steady pace, and it drifts slowly – a random walk within a band of ±7.5%, one step every 2.6 s. That way no two laps are alike, and the field reorders itself.",
    "Fahrfehler":
      "Driving errors",
    "Beim Anbremsen einer Kurve verbremst sich ein Ghost gelegentlich: 5,5 % Wahrscheinlichkeit je angebremster Kurve, dann 0,4 bis 0,9 s mit 45 % weniger Tempo. Gewürfelt wird einmal je Kurve und nicht je Takt – sonst hängt die Fehlerrate an der Rechenfrequenz statt am Rennen.":
      "Braking into a corner, a ghost occasionally locks up: 5.5% chance per corner braked for, then 0.4 to 0.9 s at 45% less pace. The dice are rolled once per corner and not per tick – otherwise the error rate would depend on the compute frequency rather than on the race.",
    "Windschatten":
      "Slipstream",
    "Wer auf einer Geraden dicht hinter einem anderen hängt, fährt bis zu 11 % schneller, linear abnehmend bis 1,3 Kacheln Abstand. Nur auf der Geraden: in der Kurve wäre es Abtriebsverlust, also das Gegenteil, und das bildet die Physik der Ghosts nicht ab.":
      "Sitting close behind another car on a straight is worth up to 11% more pace, falling off linearly to 1.3 tiles of gap. On straights only: in a corner it would be a loss of downforce, so the opposite, and the ghosts' physics does not model that.",
    "Autos nebeneinander gehen auseinander, gleichmäßig über die Bahnbreite: bei zwei nach links und rechts, bei drei bleibt das mittlere mittig, bei vier auf Viertel. Vorher gab es nur zwei Seiten, und dann standen sich bei vier Autos zwei Paare weiter im Weg. Beim Überholen weicht auch der Vorausfahrende aus, zur anderen Seite. Zwei Autos auf 25 cm Bahnbreite brauchen beide Hälften. Dieser Regler bestimmt auch, wie weit der Angreifer zur Seite geht: das ist ein Ausweichen und keine Linienwahl, hängt also nicht an der Ideallinie. Über 100 Prozent geht die Anforderung bis an den vollen Anschlag – die Mitschnitte zeigen, dass das Auto die Schiene auch dort noch liest.":
      "Cars alongside each other move apart, spread evenly across the track width: with two, to the left and right; with three, the middle one stays centred; with four, onto quarters. Before there were only two sides, and then with four cars two pairs still stood in each other's way. When overtaking, the car in front also moves aside, to the other side. Two cars on 25 cm of track width need both halves. This slider also sets how far the attacker moves aside: that is an evasion and not a choice of line, so it does not depend on the racing line. Above 100 per cent the request goes to the full lock – the recordings show the car still reads the rail even there.",
    "Trocken, Regen – oder wechselhaft: dann beginnt es trocken, und alle 2 bis 6 Minuten fällt ein Schauer von 1 bis 3 Minuten. Beide Zeiten werden je Phase neu gezogen. Bei einem kurzen Rennen kann es sein, dass man keinen Schauer sieht – ein Schauer hängt nicht daran, wie viele Runden gefahren werden.":
      "Dry, rain – or changeable: it then starts dry, and every 2 to 6 minutes a shower falls for 1 to 3 minutes. Both durations are drawn afresh each phase. In a short race you may well see no shower at all – a shower does not depend on how many laps are run.",
    "Wechselt einmal zu einem zufälligen Zeitpunkt. Bei „wechselhaft“ bleibt dieser Schalter ohne Wirkung: dort wechselt es ohnehin laufend, und ein zusätzlicher Wechsel mitten im Schauer würde die Phasen durcheinander bringen.":
      "Changes once at a random moment. With “changeable” this switch has no effect: it changes constantly there anyway, and an extra change in the middle of a shower would confuse the phases.",
    "Wechselhaft":
      "Changeable",
    "Es trocknet ab":
      "It is drying out",
    "Es fängt an zu regnen":
      "It is starting to rain",
    "Ghost: Feld zusammenhalten":
      "Ghost: keep the field together",
    "Gestaffelt über den ganzen Platz: der Erste fährt um den Abschlag langsamer, der Letzte um denselben Betrag schneller, die Feldmitte unverändert. Damit bleibt das mittlere Tempo gleich – würde nur gebremst, wäre dies in Wahrheit ein Schalter, der alle langsamer macht. Vorher wirkte es nur auf den Erstplatzierten, und dann waren die ersten beiden beieinander und der Rest blieb, wo er war. Wirkt auch ohne Rennen, aber erst ab zwei Ghosts: mit einem einzigen ist dieser eine gleichzeitig Erster und Letzter.":
      "Graded across the whole order: the leader drives slower by the margin, the last car faster by the same amount, the middle of the field unchanged. That keeps the average pace the same \u2013 if it only braked, this would in truth be a switch that makes everyone slower. Before, it acted on the leader alone, and then the front two were together and the rest stayed where they were. Works outside a race too, but only from two ghosts up: with a single one, that one is first and last at once.",
    "Ghost: Stärke der Staffel":
      "Ghost: strength of the grading",
    "Um wie viel der Erste langsamer und der Letzte schneller fährt.":
      "By how much the first drives slower and the last faster.",
    "Ab Werk aus. Sie greift an sechs Stellen gleichzeitig ins Tempo ein, und solange Ortung und Überholen nicht sauber sind, ist sie die Zutat, die jede Beobachtung verrauscht – wer sie einschaltet, weiß danach nicht, ob das Gesehene an ihr lag.":
      "Off by default. It acts on pace in six places at once, and while localisation and overtaking are not clean, it is the ingredient that adds noise to every observation \u2013 switch it on and you will not know afterwards whether what you saw was down to it.",
    "Boxenstopp einleiten":
      "Call a pit stop",
    "Reifen wechseln":
      "Change tyres",
    "Reifenwahl":
      "Tyre choice",
    "Tanken":
      "Refuel",
    "Reparieren":
      "Repair",
    "Arbeit":
      "working",
    "Arbeit läuft":
      "work in progress",
    "fertig":
      "done",
    "Sim aus":
      "sim off",
    "ja":
      "yes",
    "nein":
      "no",
    "voll":
      "full",
    "Am einfachsten mit einem Doppelklick auf die Startdatei. Sie sucht Python, startet den Host und schreibt die Adresse hin, unter der er erreichbar ist.":
      "The easiest way is a double-click on the launcher file. It finds Python, starts the host and prints the address it can be reached at.",
    "Wer lieber selbst tippt, öffnet im Projektordner ein Fenster für die Eingabeaufforderung oder das Terminal und führt diesen Befehl aus:":
      "If you would rather type it yourself, open a command prompt or terminal window in the project folder and run this command:",
    "Das Programm selbst liegt im Projekt und ist von hier aus direkt zu öffnen.":
      "The program itself is part of the project and can be opened directly from here.",
    "Warum es dafür keinen Knopf in der App gibt.":
      "Why there is no button for this in the app.",
    "Eine Webseite darf kein Programm auf dem Rechner starten. Das ist keine fehlende Schnittstelle, sondern die Grenze, auf der die Sicherheit des Browsers beruht, und sie fällt auch dann nicht, wenn man die App installiert: eine installierte App bekommt Dateizugriff und Offline-Betrieb, aber niemals das Recht, ein beliebiges Programm auszuführen. Die Startdatei oben ist das Nächste, was daran herankommt – einmal herunterladen, danach genügt ein Doppelklick.":
      "A web page may not start a program on the computer. This is not a missing interface but the boundary the browser's security rests on, and it does not fall when the app is installed either: an installed app gets file access and offline operation, but never the right to run an arbitrary program. The launcher file above is the closest thing to it – download it once, after that a double-click is enough.",
    "Ueber die Leitung gehen Rundenzahl, Rundenzeiten und Abgaenge. Keine Physik, keine Lenkwerte: jedes Telefon rechnet seine eigene Physik und haelt seine eigene Bluetooth-Verbindung. Reisst das WLAN ab, faehrt jeder weiter, nur die Rangliste steht still.": "What goes over the wire: lap count, lap times and departures. No physics, no steering values – each phone computes its own physics and holds its own Bluetooth connection. If the Wi-Fi drops, everyone keeps driving; only the leaderboard stands still.",
    "Mehrere Telefone, jedes mit eigenem Auto, eine gemeinsame Rangliste. Host ist entweder ein PC mit einem kleinen Python-Programm oder ein Telefon mit der Android-App.": "Several phones, each with its own car, one shared leaderboard. The host is either a PC with a small Python program or a phone with the Android app.",
    "Auf dem PC starten.":
      "Start it on the PC.",
    "Die Adresse an die Telefone geben.":
      "Give the address to the phones.",
    "Sie gehört unten in das Feld „Host-Adresse“ und hat die Form, die dort als Beispiel steht. Alle Geräte müssen im selben WLAN sein.":
      "It goes into the “Host address” field below and has the form shown there as an example. All devices must be on the same Wi-Fi.",
    "Namen eintragen und auf Mitmachen drücken.":
      "Enter a name and press Join.",
    "Der Name steht danach in der Rangliste. Jedes Telefon behält seinen eigenen Namen und seine eigene Kennung, auch nach einem Neuladen.":
      "The name then appears in the leaderboard. Each phone keeps its own name and its own id, even after a reload.",
    "Die Übersicht auf den Fernseher.":
      "The overview on the TV.",
    "Der Host liefert dafür eine eigene Seite in großer Schrift:":
      "The host serves a dedicated page for this, in large type:",
    "Sie zeigt die Rangliste und hat einen Knopf zum Zurücksetzen. Sonst nichts: sie ist zum Ansehen aus zwei Metern gedacht und nicht zum Bedienen.":
      "It shows the leaderboard and has one button to reset it. Nothing else: it is meant to be read from two metres away, not operated.",
    "Zwei Dinge, an denen es scheitern kann, und beide liegen nicht an der App.":
      "Two things it can fail on, and neither is the app's doing.",
    "Wird die App über eine verschlüsselte Verbindung geladen – etwa von der Projektseite –, blockiert der Browser jede Verbindung zu einer unverschlüsselten Adresse im WLAN; dann muss die App vom Host selbst geladen werden. Und bis Fassung 0.6.19 fehlten dem Host die Kopfzeilen für fremde Herkunft: Mitmachen ging nur, wenn die App vom Host kam. Wer eine ältere Fassung des Programms laufen hat, holt sie neu.":
      "If the app is loaded over an encrypted connection – from the project page, say – the browser blocks every connection to an unencrypted address on the Wi-Fi; the app then has to be loaded from the host itself. And until release 0.6.19 the host was missing the cross-origin headers: joining only worked when the app came from the host. Anyone running an older copy of the program should fetch it again.",
    "Motorklang: rechte Hälfte weiter, linke zurück":
      "Engine sound: right half forward, left half back",
    "Die folgenden Klänge sind die Ausnahme: sie stammen aus echten Aufnahmen. Alle von Pixabay und unter der Pixabay-Lizenz. Die unbearbeiteten Quelldateien sind nicht Teil dieses Projekts.":
      "The following sounds are the exception: they come from real recordings. All from Pixabay and under the Pixabay licence. The unedited source files are not part of this project.",
    "Tankmenge":
      "Fuel amount",
    "Reifen für den nächsten Boxenstopp (Steuerkreuz hoch). Vorgabe sind die aufgezogenen Reifen; passt die Wahl nicht zum Wetter, wird die Zeile angeschrieben.":
      "Tyres for the next pit stop (D-pad up). The default is whatever is fitted; if the choice does not match the weather, the row is marked.",
    "Tankmenge für den nächsten Boxenstopp (Steuerkreuz runter): nein, halb oder voll.":
      "Fuel amount for the next pit stop (D-pad down): none, half or full.",
    "weich":
      "soft",
    "mittel":
      "medium",
    "hart":
      "hard",
    "Reifen montiert":
      "Tyres fitted",
    "kein Rennen":
      "no race",
    "Start":
      "start",
    "letzte Runde":
      "final lap",
    "läuft":
      "running",
    "Noch keine Runde gefahren":
      "No lap driven yet",
    "Wie stark sich weich, mittel, hart und Regen unterscheiden. Der Regler bewegt alle Werte zugleich – Grip und Verschleiß – und zwar als Abstand zum Mittelreifen. Bei 0 rechnen alle drei Slicks wie mittel, bei 100 Prozent gilt die Tabelle, darüber ist der Unterschied größer als im Rennsport. Steht die Reifensimulation darüber auf aus, fahren ohnehin alle den Mittelreifen, egal was hier steht.":
      "How far apart soft, medium, hard and wet are. The slider moves every value at once – grip and wear – as a distance from the medium tyre. At 0 all three slicks compute as medium, at 100 per cent the table applies, above that the spread is wider than in real racing. With the tyre simulation above switched off everyone runs the medium tyre anyway, whatever this says.",
    "Mischungsunterschied":
      "Compound spread",
    "Kalt nach Start und Boxenstopp, abgenutzt nach hartem Stint. Links = aus. Bis v0.5.17 stand der Regler beim Laden auf 0 und das Modell trotzdem auf 200 Prozent – ein einziges Antippen ließ das Fahrverhalten springen. Beide sagen jetzt dasselbe, und die Vorgabe ist das volle Modell.":
      "Cold after a start and a pit stop, worn after a hard stint. Left = off. Up to v0.5.17 the slider read 0 on load while the model still ran at 200 per cent – a single nudge made the handling jump. Both now say the same thing, and the default is the full model.",
    "Einführungsrunde: noch eine Runde": "Formation lap: one more lap",
    "Frei, volle Fahrt!": "Clear, full speed!",
    "Einführungsrunde mit Boxengassen-Tempo. Dein Auto fährt sie selbst, genau wie die Ghosts: es rollt mit an, schlängelt zum Reifenwärmen und hält die Seite seines Startplatzes, ohne dass du etwas anfassen musst – die Bremse gilt trotzdem, damit du anhalten kannst, wenn vor dir jemand steht. Im Cockpit steht dann „Einführungsrunde · Autopilot“. Frei ist es, wenn das erste Auto Start/Ziel zum zweiten Mal überfährt – ein Ghost darf es sein. Warum zweimal: zwischen der ersten und der zweiten Überfahrt desselben Autos liegt immer eine volle Runde, egal wo es gestanden hat. Bei einer einzigen Überfahrt war die Einführungsrunde vorbei, bevor sie anfing, wenn ein Auto auf oder kurz vor dem Zielstreifen stand. Danach fährt jeder nach seinen Einstellungen, und die Lenkung ist wieder deine. Nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus hält sich das Auto nicht selbst auf der Bahn, und ein Autopilot ohne Querregelung würde es in die Bande fahren.": "Formation lap at pit-lane pace. Your car drives it itself, exactly like the ghosts: it rolls away with the field, weaves to warm the tyres and holds the side of its grid slot without you touching anything – the brake still works, so you can stop if someone is stranded ahead of you. The cockpit then reads “Formation lap · Autopilot”. It is released when the first car crosses start/finish for the SECOND time – a ghost may do it. Why twice: between the first and the second crossing by the same car there is always a full lap, wherever it was standing. With a single crossing the formation lap was over before it began whenever a car sat on or just before the finish stripe. After that everyone drives to their own settings and the steering is yours again. Only in the “On the track” position: in printout mode the car does not hold the track by itself, and an autopilot without lateral control would drive it into the barrier.",
    "L1: Bahn oder Ausdruck · R1: Automatik oder von Hand · Kreuz: tippen Boxenstopp, 1 s halten gelbe Flagge · Options: Menü · Select: Wetter umschalten": "L1: track or printout · R1: automatic or manual · Cross: tap for pit stop, hold 1 s for yellow flag · Options: menu · Select: switch the weather",
    "Drosselung jenseits der Fahrbahn": "Throttling off the track",
    "Meldet Byte 12 den Wert 0x00, ist das Auto neben der Bahn: dann wird das Gas auf 45 % gedeckelt. Das leichte Brummen dazu hängt allein am Schalter „Vibration“ darüber, dieser hier allein an der Drosselung – bis v0.4.55 war es eine Option mit zwei Hälften, und wer die Drosselung abschaltete, verlor auch die Rückmeldung. Wirkt nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus ist der Streckensensor aus und Byte 12 stände dauernd auf 0x00.": "If byte 12 reports 0x00 the car is off the track: the throttle is then capped at 45 %. The gentle rumble that goes with it hangs on the “Vibration” switch above and this one only on the throttling – up to v0.4.55 it was one option with two halves, and switching the throttling off also cost you the feedback. Only takes effect in the “On the track” position: in printout mode the track sensor is off and byte 12 would sit at 0x00 permanently.",
    "Rückmeldung im Controller bei Gangwechsel, ABS, Aufprall, im Boxenstopp und neben der Bahn. Standard aus, weil nicht jeder Controller es kann und ein Dauerbrummen im Gelände Geschmackssache ist. Unabhängig von der Drosselung darunter. Das Handy vibriert nicht mit, das Protokoll kennt dafür nichts.": "Feedback in the controller on gear changes, ABS, impacts, in the pit stop and off the track. Off by default, because not every controller can do it and a constant rumble in the gravel is a matter of taste. Independent of the throttling below. The phone does not vibrate along, and the protocol knows nothing for it.",
    "Cockpit-Ansicht": "Cockpit look",
    "GT3 (Vorgabe)": "GT3 (default)",
    "Oldschool, 1980er": "Oldschool, 1980s",
    "Modern, 2000er": "Modern, 2000s",
    "Nur das Aussehen des Cockpit-Schirms – Anzeigen, Tasten und Physik bleiben, wie sie sind. „GT3“ ist die Vorgabe: Carbon und weiße Schrift auf Schwarz. „Oldschool“ ist Bernstein auf Schwarz mit sichtbaren Pixelzeilen, breiter Kunststoffblende und Messingschrauben, wie die Vakuumfluoreszenz-Armaturen der 1980er. „Modern“ ist ein weißer Schirm mit schwarzen Bedienflächen und schmaler Alublende, wie die ersten Farb-TFT der 2000er – Regenradar und G-Plot behalten dort ihren dunklen Einsatz, weil sie hell auf dunkel zeichnen und auf Weiß unsichtbar wären. „Klassiker“ ist Walnussfurnier mit Chromschrauben und cremefarbener Schrift auf Schwarzbraun, wie das Armaturenbrett eines Gran Turismo der Sechziger. Die Bedeutungsfarben bleiben in allen vier gleich: der Tankbalken ist grün und der Schaden rot, auch in der Retro-Ansicht – eine Ansicht darf ändern, wie es aussieht, nicht was eine Farbe sagt. Die Voreinstellungen fassen die Ansicht nicht an.": "Only the look of the cockpit screen – readouts, buttons and physics stay as they are. “GT3” is the default: carbon and white type on black. “Oldschool” is amber on black with visible scan lines, a wide plastic bezel and brass screws, like the vacuum-fluorescent instruments of the 1980s. “Modern” is a white screen with black controls and a narrow aluminium bezel, like the first colour TFTs of the 2000s – the rain radar and the g-plot keep their dark inset there, because they draw light on dark and would be invisible on white. “Classic” is walnut veneer with chrome screws and cream type on dark brown, like the fascia of a 1960s grand tourer. The meaning colours stay the same in all four: the fuel bar is green and damage is red, in the retro look as well – a look may change how something appears, not what a colour says. The presets do not touch the look.",
    "Modern, 2000er (hell)": "Modern, 2000s (light)",
    "Klassiker: Walnuss und Chrom": "Classic: walnut and chrome",
    "Motorton-Zusätze": "Engine sound extras",
    "Sieben mechanische Geräusche über dem Motorton, alle an diesem einen Schalter – zum Vergleichen einfach ausschalten. Nichts davon ist eine Aufnahme, alle sieben sind gerechnet und hängen an Werten, die die Simulation ohnehin führt: die Höhen laufen mit der Last (ein Motor im Schub ist dunkler und nicht nur leiser), am Begrenzer stottert die Zündung mit 28 Hz, beim Gaswegnehmen knallt es im Auspuff, beim Hochschalten unter Last einmal kräftig, das Getriebe heult mit der Raddrehzahl statt mit der Motordrehzahl, die drei aufgeladenen Motoren bekommen ein Laderpfeifen samt Abblasen, und beim Rollen rauschen Reifen und Fahrtwind, lauter und heller mit dem Tempo. Wie stark ein Motor knallt, steht je Motor in den Tondaten – der Formel 1 mit Turbo knallt kaum, der Flat-Plane-V8 ohne Lader am meisten. Was hier absichtlich NICHT drin ist: eine Hörposition. Cockpit gegen Verfolgerkamera ändert nicht den Klang, sondern das Mischungsverhältnis von Auspuff, Ansaugung und Mechanik, und die stecken heute alle drei in einer Schleife.": "Seven mechanical noises on top of the engine sound, all on this one switch – turn it off to compare. None of them is a recording; all seven are calculated and hang on values the simulation keeps anyway: the highs follow the load (an engine on a closed throttle is darker, not just quieter), at the limiter the ignition stutters at 28 Hz, lifting off the throttle pops in the exhaust, an upshift under load bangs once, the gearbox whines with wheel speed rather than engine speed, the three forced-induction engines get a turbo whistle with a blow-off, and when rolling, tyres and wind rush, louder and brighter with speed. How much an engine pops is stored per engine in the sound data – the turbocharged Formula 1 barely pops, the naturally aspirated flat-plane V8 the most. What is deliberately NOT in here: a listening position. Cockpit versus chase camera does not change the sound but the balance between exhaust, intake and mechanics, and today all three sit in one loop.",
    "Zahlensysteme": "Number systems",
    "Binär- und Hex-Trainer: eine vierstellige Zahl, du übersetzt sie in Dezimal.": "Binary and hex trainer: a four-digit number, you translate it to decimal.",
    "Zwei kurze Trainer, kein Zeitdruck: eine vierstellige Zahl im jeweiligen Zahlensystem, du tippst die passende Dezimalzahl ein und bekommst sofort Bescheid, dazu eine laufende Trefferquote.": "Two short trainers, no time pressure: a four-digit number in the respective number system, you type in the matching decimal number and get an immediate answer, plus a running score.",
    "Binär-Trainer": "Binary trainer",
    "Vier Stellen, nur 0 und 1 – also Werte von 0 bis 15.": "Four digits, only 0 and 1 – so values from 0 to 15.",
    "Prüfen": "Check",
    "Neue Zahl": "New number",
    "Dezimal?": "Decimal?",
    "Hex-Trainer": "Hex trainer",
    "Vier Stellen, 0–9 und A–F – also Werte von 0 bis 65535.": "Four digits, 0–9 and A–F – so values from 0 to 65535.",
    "Noch keine Antwort.": "No answer yet.",
    "__R__ von __V__ richtig.": "__R__ of __V__ correct.",
    "Richtig!": "Correct!",
    "Leider nicht - richtig wäre __X__ gewesen.": "Not quite - __X__ would have been correct.",
    "Strecke aus der Aufnahme lernen": "Learn track from the recording",
    "Fährst du mehrere Runden in einer Aufnahme, kann die App daraus das Streckenlayout ableiten – derselbe Weg, den „Strecke beim Fahren lernen“ sonst live geht, nur diesmal aus der Wiedergabe statt aus der eigenen Hand. Braucht ein verbundenes Auto in der Rolle „Steuern“: die Wiedergabe fährt wirklich, das Auto meldet seine echten Streckencodes, und daraus entsteht die Karte unten. Ohne geschlossene Runde in der Aufnahme bleibt sie leer.": "If you drive several laps in one recording, the app can derive the track layout from it – the same path „learn while driving“ otherwise takes live, just from the replay this time instead of from your own hand. Needs a connected car in the „drive“ role: the replay really drives, the car reports its real track codes, and the map below is built from that. Without a closed lap in the recording it stays empty.",
    "Strecke aus dieser Aufnahme lernen": "Learn track from this recording",
    "lernt…": "learning…",
    "__N__ Teile gelernt.": "__N__ pieces learned.",
    "Keine geschlossene Runde erkannt - nochmal versuchen.": "No closed lap detected - try again.",
    "Reifenwahl weiter": "Next tyre choice",
    "Tankmenge weiter": "Next fuel amount",
    "L3 (linken Stick drücken)": "L3 (press left stick)",
    "Erklärung anzeigen": "Show explanation",
    "Maus-Steuerung": "Mouse control",
    "Aufnahme-Modus": "Recording mode",
    "Eine echte Fahrt aufzeichnen, exakt nachfahren, und daraus eine Streckenzeichnung ableiten.": "Record a real drive, replay it exactly, and derive a track drawing from it.",
    "Fahr die Strecke einmal manuell (Tab \"Fahren\", Joystick/Gas oder Pfeiltasten). Während der Aufnahme werden Lenk- und Gaswerte mit Zeitstempel mitgeschrieben. Bei der Wiedergabe sendet die App exakt dieselbe Sequenz erneut an die Ziel-Characteristic - egal ob dabei eine echte CH-Bahn oder nur ein Ausdruck unter dem Auto liegt.": "Drive the track once by hand (the \"Drive\" tab, joystick/throttle or arrow keys). During recording, steering and throttle values are written down with timestamps. On replay the app sends exactly the same sequence again to the target characteristic - whether a real CH track or just a printout is under the car.",
    "Streckenzeichnung aus der Aufnahme": "Track drawing from the recording",
    "Rechnet die gefahrene Linie rein rechnerisch aus – über dieselbe Physik, die auch ein Ghost bekommt, nicht aus echten Streckencodes. Funktioniert deshalb AUCH ohne CH-Bahn, nur mit einem Ausdruck darunter. Braucht trotzdem Start/Ziel- Überfahrten in der Aufnahme für Rundengrenzen und Rundenzeiten – ohne sie bleibt es bei einer einzigen offenen Linie. Eine Annäherung: ohne echte Ortsmessung kann die Linie über mehrere Runden hinweg abdriften, auch wenn das Auto real an dieselbe Stelle zurückkehrt.": "Computes the driven line purely by calculation – via the same physics a ghost gets, not from real track codes. So it ALSO works without a CH track, just with a printout underneath. It still needs start/finish crossings in the recording for lap boundaries and lap times – without them it stays a single open line. An approximation: without real position measurement the line can drift over several laps, even though the car really returns to the same spot.",
    "Zeichnung erstellen": "Create drawing",
    "Keine Aufnahme vorhanden.": "No recording available.",
    "__N__ Punkte, rein rechnerisch (Koppelnavigation).": "__N__ points, purely computed (dead reckoning).",
    "Runde __N__: __S__ s": "Lap __N__: __S__ s",
    "Keine Start/Ziel-Überfahrt in dieser Aufnahme erkannt - keine Rundenzeiten.": "No start/finish crossing detected in this recording - no lap times.",
    "Bringe die Autos in Position": "Bring the cars into position",
  "Autos fahren selbst in Position": "Cars drive into position automatically",
    "Der 2-Spieler-Modus ist aus – rechts steht nichts.": "The 2-player mode is off – nothing on the right.",
    "Messstand nicht vorhanden.": "No measuring stand present.",
    "Das Auto ist nicht gefahren – ohne Fahrt gibt es kein Drehsignal, Byte 3 schwankt erst dann.": "The car did not move – without movement there is no rotation signal, byte 3 only fluctuates then.",
    "Fehler beim Laden der Characteristics: {m}": "Error loading the characteristics: {m}",
    "noch kein Controller gemeldet": "no controller reported yet",
    "Ton ist aus, in den Optionen einschalten.": "Sound is off, enable it in the options.",
    "Geglättet, nochmal fahren und vergleichen.": "Smoothed, drive again and compare.",
    "Zurückgesetzt.": "Reset.",
    "Zurueck auf die Vorgabe aus den Optionen": "Back to the default from the options",
    "Boxenstopp: links für Auto 1, rechts für Auto 2.": "Pit stop: left for car 1, right for car 2.",
    "P2 Boxenstopp: bremsen und anhalten – {a} km/h, nötig unter {b}, dann Finger vom Gas.": "P2 pit stop: brake and stop – {a} km/h, must be below {b}, then take your foot off the throttle.",
    "In der Garage einem Auto die Rolle \"Spieler 2\" geben.": "Give a car the \"Player 2\" role in the garage.",
    "Scan läuft: {n} Teile (zuletzt: {t})": "Scanning: {n} pieces (last: {t})",
    "Scan läuft: 0 Teile ({q})": "Scanning: 0 pieces ({q})",
    "Scan läuft: {n} Teile, {k} ohne lesbaren Code": "Scanning: {n} pieces, {k} without a readable code",
    "Scan läuft: {n} Teile, {k} ohne lesbaren Code ({p} Pakete ohne Lesung)": "Scanning: {n} pieces, {k} without a readable code ({p} packets without reading)",
    "Scan läuft: 1 Teil (Auto fährt automatisch) …": "Scanning: 1 piece (car drives automatically) …",
    "läuft, {n} Zeilen, {s} s, {m} Markierungen": "running, {n} rows, {s} s, {m} marks",
    "gestoppt, {n} Zeilen, {s} s, {m} Markierungen": "stopped, {n} rows, {s} s, {m} marks",
    "Aufnahme {s}s · {m} Mark.": "Recording {s}s · {m} marks.",
    "{m} läuft": "{m} running",
    "Läuft: {s}...": "Running: {s}...",
    "Einführungsrunde, Limit bis Start/Ziel": "Formation lap, limit until start/finish",
    "Zeit/Runden erreicht, laufende Runde zählt noch": "Time/laps reached, current lap still counts",
    "Gefahren: Spitze {a} km/h · Lenkung konnte {b} % der verlangten Änderung nicht folgen ({c} von {d} Takten am Anschlag).": "Driven: top {a} km/h · steering could not follow {b} % of the requested change ({c} of {d} ticks at the stop).",
    "AUTO {n}": "CAR {n}",
    "fährt…": "driving…",
    "{w} × {h} cm · {n} Teile": "{w} × {h} cm · {n} pieces",
    "Alle Autos stehen auf den Teilen": "All cars are standing on the tiles",
    "vor": "before",
    "Start/Ziel. Erst wenn du Start/Ziel zum ersten Mal überfährst, beginnt Runde 1.": "Start/finish. Lap 1 starts only once you first cross start/finish.",
    "Durchschnitt der drei schnellsten aufeinanderfolgenden Runden.": "Average of the three fastest consecutive laps.",
    "Nur in der Android-App: dieses Telefon wird Host, die anderen finden es im WLAN. Im Browser geht das nicht – dort den Weg über den PC nehmen. Wer im Browser mitspielen will, braucht für das Auto die App (Web Bluetooth verlangt einen secure context; das APK hat das eingebaut).": "Only in the Android app: this phone becomes the host, the others find it over Wi-Fi. That does not work in the browser – use the PC route there. Anyone who wants to join in the browser needs the app for the car (Web Bluetooth requires a secure context; the APK has that built in).",
    "Solange das Auto steht (0 km/h), zählt kein Stoß als Crash – du kannst es aufheben, ohne dass es simulierten Schaden nimmt.": "As long as the car is standing still (0 km/h), no crash is counted – you can lift it up without it taking simulated damage.",
  };

  // ============================================================================
  // Sprachumschaltung DE/EN
  // ============================================================================
  //
  // Der deutsche Text IST der Schluessel. Das ist die entscheidende Entscheidung, und sie
  // ist gegen die uebliche Empfehlung getroffen - normalerweise vergibt man Schluessel wie
  // "options.rain.label". Der Grund: diese Datei hat 1460 verschiedene Textstellen. Sie
  // alle von Hand auszuzeichnen waere ein Umbau von tausend Stellen, bei dem jede einzelne
  // schiefgehen kann, und beim naechsten neuen Satz vergisst man die Auszeichnung. Mit dem
  // deutschen Text als Schluessel muss am Markup NICHTS geaendert werden, und ein Satz, den
  // noch niemand uebersetzt hat, bleibt einfach deutsch stehen statt zu verschwinden.
  //
  // Der Preis, ausgesprochen: zwei gleiche deutsche Saetze an verschiedenen Stellen
  // bekommen dieselbe Uebersetzung. Bei Fliesstext ist das richtig; bei einem Wort wie
  // "Aus" waere es riskant, weil es je nach Zusammenhang anders lauten kann. Solche Faelle
  // stehen im Woerterbuch deshalb mit Zusammenhang, oder gar nicht.
  //
  // Was NICHT uebersetzt wird und warum:
  //   - der Protokollteil der Doku, soweit er Bytewerte auffuehrt: Zahlen sind Zahlen
  //   - Log-Zeilen: sie sind ein Arbeitsprotokoll, kein Oberflaechentext, und sie entstehen
  //     an ueber zweihundert Stellen im Code
  //   - alles mit data-i18n-skip
  const I18N_LANGS = ['de', 'en'];
  let lang = 'de';
  // Originaltexte, damit der Weg zurueck nach Deutsch exakt ist und nicht ueber eine
  // zweite Uebersetzungstabelle laeuft. WeakMap, damit entfernte Knoten nicht festgehalten
  // werden - bei einer Oberflaeche, die Listen neu aufbaut, waere eine Map ein Leck.
  const i18nOrig = new WeakMap();
  const I18N_ATTRS = ['title', 'aria-label', 'placeholder'];
  let i18nObserver = null;
  let i18nBusy = false;

  function i18nNorm(t) { return t.replace(/\s+/g, ' ').trim(); }

  function i18nLookup(t) {
    const d = I18N_EN;
    const k = i18nNorm(t);
    if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(d, k)) return d[k];
    return null;
  }

  function i18nRoots() {
    // lb-wrap gehoert dazu, obwohl es kein Tab ist: die Lightbox steht absichtlich
    // ausserhalb von main, damit kein ausgeblendeter Tab sie mitnimmt - und stand damit
    // auch ausserhalb der Uebersetzung. Ihr "Schliessen" blieb im englischen Modus deutsch,
    // und der Selbsttest konnte es nicht melden, weil er dieselbe Liste benutzt: ein
    // blinder Fleck, der sich selbst versteckt. Gefunden hat es ein Abzug ueber das ganze
    // body, nicht ueber diese Liste.
    return [document.querySelector('header'), document.querySelector('main'),
            $('lb-wrap')].filter(Boolean);
  }

  // Einen Teilbaum in die aktuelle Sprache bringen. Wird beim Umschalten fuer alles und
  // danach fuer jeden neu eingefuegten Knoten aufgerufen.
  function i18nApply(root) {
    if (!root) return;
    // Textknoten
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'KBD') {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest('[data-i18n-skip]')) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    for (const node of nodes) {
      if (!i18nOrig.has(node)) i18nOrig.set(node, node.nodeValue);
      const de = i18nOrig.get(node);
      if (lang === 'de') { if (node.nodeValue !== de) node.nodeValue = de; continue; }
      const en = i18nLookup(de);
      if (en === null) continue;
      // Fuehrende und folgende Leerzeichen aus dem Original behalten: sie tragen im
      // Fliesstext den Abstand zum Nachbarelement, und ohne sie klebt "Taste" am <b>.
      const lead = de.match(/^\s*/)[0], tail = de.match(/\s*$/)[0];
      const next = lead + en + tail;
      if (node.nodeValue !== next) node.nodeValue = next;
    }
    // Attribute
    const els = [root].concat(Array.from(root.querySelectorAll
      ? root.querySelectorAll('[title],[aria-label],[placeholder]') : []));
    for (const el of els) {
      if (!el.getAttribute || (el.closest && el.closest('[data-i18n-skip]'))) continue;
      for (const a of I18N_ATTRS) {
        const cur = el.getAttribute(a);
        if (cur === null) continue;
        const key = a + '|' + el.tagName;
        let store = i18nOrig.get(el);
        if (!store) { store = {}; i18nOrig.set(el, store); }
        if (!(key in store)) store[key] = cur;
        const de = store[key];
        if (lang === 'de') { if (cur !== de) el.setAttribute(a, de); continue; }
        const en = i18nLookup(de);
        if (en !== null && cur !== en) el.setAttribute(a, en);
      }
    }
  }

  // Nachgeladene Oberflaeche: Listen, Tabellen, Meldungen. Ohne den Beobachter waere alles,
  // was JavaScript nach dem Umschalten einfuegt, wieder deutsch - und das ist bei dieser
  // App die halbe Anzeige.
  function i18nWatch() {
    if (i18nObserver) return;
    i18nObserver = new MutationObserver((recs) => {
      if (lang === 'de' || i18nBusy) return;
      i18nBusy = true;
      try {
        for (const r of recs) {
          for (const nd of r.addedNodes) {
            if (nd.nodeType === 1) i18nApply(nd);
            else if (nd.nodeType === 3 && nd.parentElement) i18nApply(nd.parentElement);
          }
        }
      } finally { i18nBusy = false; }
    });
    for (const r of i18nRoots()) {
      i18nObserver.observe(r, { childList: true, subtree: true, characterData: false });
    }
  }

  // Ansichten, die sich beim Sprachwechsel NEU ZEICHNEN muessen.
  //
  // Text, der im Code ZUSAMMENGESETZT wird, kann der Textknoten-Uebersetzer nicht erreichen:
  // er sucht ganze Knoten in der Tabelle, und "50:50 - 2,60 m - vorn bei Gas 20%" steht dort
  // nicht und kann dort auch nicht stehen. Solche Ansichten muessen ihre t()-Aufrufe erneut
  // durchlaufen.
  //
  // ALS ANMELDELISTE und nicht als Aufzaehlung in setLang: der erste Fall (die Fussnote des
  // Rundenzeit-Plots) stand dort als einzelne Zeile, und beim zweiten Fall (die Layout-Daten)
  // waere daraus eine Liste geworden, die man beim dritten vergisst. Wer sich hier anmeldet,
  // ist dabei.
  const i18nNeuzeichnen = [];
  function i18nOnLangChange(fn) {
    if (typeof fn === 'function') i18nNeuzeichnen.push(fn);
  }

  function setLang(next) {
    if (I18N_LANGS.indexOf(next) < 0 || next === lang) return;
    lang = next;
    // ZUERST neu zeichnen, DANN uebersetzen - die Reihenfolge ist der ganze Punkt.
    //
    // Text, der im Code ZUSAMMENGESETZT wird, kann der Textknoten-Uebersetzer nicht
    // erreichen: er sucht ganze Knoten in der Tabelle, und "8 gemessene Runden, beste
    // 12.18s - 1 Boxenstopp" steht dort nicht und kann dort auch nicht stehen. Solche
    // Ansichten muessen neu gezeichnet werden, damit ihre t()-Aufrufe in der neuen Sprache
    // laufen; lang ist eine Zeile darueber schon gesetzt.
    //
    // Und sie muessen VOR i18nApply neu gezeichnet werden. Erst danach war der Fehler:
    // das Neuzeichnen schrieb ganze Knoten wieder auf Deutsch, nachdem der Uebersetzer
    // durch war - "noch nichts gespeichert" blieb im englischen Modus deutsch, obwohl es
    // im Woerterbuch stand. Der Uebersetzungs-Selbsttest hat genau das gemeldet.
    for (const fn of i18nNeuzeichnen) {
      // Der Versuchsblock ist hier nicht Vorsicht, sondern die Ladefolge: setLang laeuft auch
      // beim Laden, und eine angemeldete Ansicht kann Konstanten aus einer SPAETEREN Datei
      // lesen. Ein Wurf hier wuerde die ganze IIFE mitnehmen.
      try { fn(); } catch (e) { /* Ladefolge, siehe oben */ }
    }
    i18nBusy = true;
    try { i18nRoots().forEach(i18nApply); } finally { i18nBusy = false; }
    document.documentElement.lang = lang;
    const de = $('lang-de'), en = $('lang-en');
    if (de) de.classList.toggle('on', lang === 'de');
    if (en) en.classList.toggle('on', lang === 'en');
    try { localStorage.setItem('omegasim-lang', lang); } catch (e) { /* privater Modus */ }
    i18nWatch();
  }

  // Fuer Text, der im Code entsteht statt im Markup. Absichtlich dieselbe Tabelle: ein
  // zweites Woerterbuch waere ein zweiter Ort, an dem etwas fehlen kann.
  function t(de) {
    if (lang === 'de') return de;
    const en = i18nLookup(de);
    return en === null ? de : en;
  }

  if ($('lang-toggle')) {
    $('lang-toggle').addEventListener('click', () => setLang(lang === 'de' ? 'en' : 'de'));
  }
  if ($('lang-de')) $('lang-de').classList.add('on');
  // Gemerkte Sprache. Erst NACH dem Aufbau, damit der Beobachter alles sieht, was die App
  // beim Laden selbst eingefuegt hat.
  try {
    const saved = localStorage.getItem('omegasim-lang');
    if (saved && saved !== lang) setLang(saved);
  } catch (e) { /* privater Modus */ }

  // ---- Tabs ----
  // Pulled out of the click handler so the Garage's "Losfahren" and the controller
  // navigation can switch tabs too, instead of synthesising a click on a button they would
  // first have to find.
  function showTab(name) {
    const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (btn) btn.onclick();
  }

  // Der aktive Tab muss SICHTBAR sein. Mit sieben Tabs scrollt die Leiste auf einem Telefon
  // (gemessen 809 px Inhalt auf 375 px Sicht), und nach einem Sprung aus der Garage ins
  // Cockpit stand die Markierung ausserhalb - die Leiste sah dann aus, als waere nichts
  // gewaehlt.
  //
  // 'nearest' und nicht 'center': zentrieren verschiebt die Leiste auch dann, wenn der Knopf
  // schon zu sehen ist, und das liest sich als Ruckeln ohne Anlass.
  function scrollTabIntoView(name) {
    const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (!btn || btn.hidden || typeof btn.scrollIntoView !== 'function') return;
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Der Farbverlauf am rechten Rand wird nur gezeigt, wenn es wirklich weitergeht - ein
  // Hinweis auf Scrollbarkeit, wo nichts zu scrollen ist, ist eine Falschaussage.
  function refreshTabScrollHint() {
    const wrap = $('tabs-wrap');
    const nav = document.querySelector('nav.tabs');
    if (!wrap || !nav) return;
    wrap.classList.toggle('can-scroll',
      nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 4);
  }
  (function bindeTabScroll() {
    const nav = document.querySelector('nav.tabs');
    if (!nav) return;
    nav.addEventListener('scroll', refreshTabScrollHint, { passive: true });
    window.addEventListener('resize', refreshTabScrollHint);
    refreshTabScrollHint();
  })();

  // ---- Unterseiten innerhalb eines Tabs ----
  // Eine Kachelseite plus je Kachel eine Karte. Der Tab selbst bleibt EIN Tab, damit
  // showTab, die Tastenkuerzel und die Kopfzeile unberuehrt bleiben.
  function showSubpage(key) {
    document.querySelectorAll('.subpage').forEach(p => p.classList.remove('on'));
    document.querySelectorAll('.subpage-home').forEach(h => { h.style.display = key ? 'none' : ''; });
    if (key) {
      const p = $('sub-' + key);
      if (p) p.classList.add('on');
    }
    // Die Linienvorschau auf der Ghost-Seite wird erst hier gezeichnet. Sie kostet rund
    // 94 ms; sie beim Laden oder bei jedem Streckenklick mitzurechnen waere Aufwand fuer
    // eine Karte, die niemand ansieht. HIER ist der Moment, in dem sie sichtbar wird.
    //
    // Ueber typeof gewaechtert und nicht ueber try: linemodellKarteZeichnen ist eine
    // FUNKTIONSDEKLARATION in 90-ghosts.js, wird also in der gemeinsamen IIFE gehoben - der
    // Waechter faengt nur den Fall, dass die Datei gar nicht mitgebaut wurde.
    if (key === 'opt-ghosts' && typeof linemodellKarteZeichnen === 'function') {
      try { linemodellKarteZeichnen(); } catch (e) { /* keine Strecke, kein Bild */ }
    }
    // Dasselbe fuer die Pad- und Autoliste auf der Zwei-Spieler-Seite: sie wird im Sekunden-
    // takt aufgefrischt, aber erst wenn die Seite offen ist - ohne diesen Ruf stuende beim
    // Aufschlagen bis zu eine Sekunde lang ein Gedankenstrich.
    if (key === 'opt-zwei' && typeof zweiSpielerKachelZeichnen === 'function') {
      zweiSpielerKachelZeichnen();
    }
    if (key === 'opt-stats' && typeof statZeichnen === 'function') statZeichnen();
    // Challenges: der gemeinsame Inhalt wird in die geoeffnete Seite gehaengt (72-challenges.js).
    if (key && key.indexOf('ch-') === 0 && typeof challengeSeiteZeigen === 'function') challengeSeiteZeigen(key.slice(3));
    window.scrollTo(0, 0);
    if (typeof konsoleNachSubpage === 'function') konsoleNachSubpage(key);
  }
  document.querySelectorAll('.subpage-open').forEach(el => {
    el.addEventListener('click', () => {
      // Dauerrennen-Kacheln (data-ch): die Kategorie-Unterseite sub-ch-e oeffnet der
      // challengeSeiteZeigen-Aufruf selbst; data-sub="ch-e" steht nur als Oeffner dafuer.
      if (el.dataset.ch && typeof challengeSeiteZeigen === 'function') challengeSeiteZeigen(el.dataset.ch);
      else showSubpage(el.dataset.sub);
    });
  });
  document.querySelectorAll('.subpage-back').forEach(el => {
    el.addEventListener('click', () => showSubpage(''));
  });

  // Jeder Knopf mit .goto-tab fuehrt auf den Tab in seinem data-tab: die drei Kacheln
  // unter "Sonstige" und die Zurueck-Zeilen darauf. Ein Handler statt sechs.
  document.querySelectorAll('.goto-tab').forEach(el => {
    el.addEventListener('click', () => { showTab(el.dataset.tab); window.scrollTo(0, 0); });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      // Fuer den Rueckweg (Kreis) des ACC-Menues: welcher Tab war vorher offen, und welche
      // Unterseite darin? (Sie schliesst gleich unten; der Rueckweg oeffnet sie wieder.)
      const vorher = document.querySelector('.tabpage.active');
      const vorherSub = vorher ? vorher.querySelector('.subpage.on') : null;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tabpage').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      // Programmierschule, Doku und Entwickler haben keinen eigenen Platz in der Leiste
      // mehr. Ohne diese Zeile waere waehrend ihrer Anzeige kein Tab markiert, und die
      // Leiste sieht dann aus, als sei nichts offen.
      if (btn.dataset.parent) {
        const p = document.querySelector('.tab-btn[data-tab="' + btn.dataset.parent + '"]');
        if (p) p.classList.add('active');
      }
      $('tab-' + btn.dataset.tab).classList.add('active');
      // Only hold the screen awake while the racing screen is actually the one on show.
      keepScreenAwake(btn.dataset.tab === 'race');
      document.body.classList.toggle('race-mode', btn.dataset.tab === 'race');
      // COCKPIT IMMER IM VOLLBILD (v0.8.35). BESTELLT: "Cockpit screen immer im Vollbild machen
      // und mir nicht die Option geben auf dem Gamepad (linker Stick)". Lehnt der Browser das
      // echte Vollbild ab (kein Tipp davor, iOS), gilt trotzdem das Vollbild-Layout.
      if (btn.dataset.tab === 'race' && !document.body.classList.contains('race-fs')
          && typeof enterRaceFullscreen === 'function') enterRaceFullscreen();
      if (btn.dataset.tab === 'race' && typeof cockpitScreenWiederherstellen === 'function') {
        cockpitScreenWiederherstellen();
      }
      // Wer das Cockpit verlaesst, will nicht erst dorthin zurueck, um das Vollbild zu
      // schliessen - der Knopf dafuer liegt IM Vollbild, also auf dem Schirm, den man
      // gerade verlassen hat. Beim Tabwechsel geht es deshalb von selbst zu.
      if (btn.dataset.tab !== 'race' && document.body.classList.contains('race-fs')) {
        exitRaceFullscreen();
      }
      // Immer auf der Kachelseite anfangen. Sonst landet man in der Unterseite, die man
      // vor drei Tabwechseln offen gelassen hat, und haelt sie fuer den ganzen Tab.
      showSubpage('');
      // Charts are drawn lazily when the documentation is actually opened: the sliders
      // that invalidate them fire constantly and the canvases are invisible meanwhile.
      if (btn.dataset.tab === 'doc' && drivetrainChartsDirty) renderDrivetrainCharts();
      // Challenges: die Kachel-Raenge (Medaille + Perzentil) beim Oeffnen auffrischen, sonst
      // bleibt nach einem Lauf der alte Stand stehen.
      if (btn.dataset.tab === 'challenges' && typeof chKachelnZeichnen === 'function') chKachelnZeichnen();
      // Den gewaehlten Tab in die Sicht holen, siehe scrollTabIntoView(). Am Ende des
      // Handlers, weil .active erst darueber gesetzt wird und der Hinweis am Rand den
      // neuen Scrollstand braucht.
      scrollTabIntoView(btn.dataset.tab);
      refreshTabScrollHint();
      if (typeof konsoleNachTab === 'function') {
        konsoleNachTab(btn.dataset.tab, vorher ? vorher.id.replace(/^tab-/, '') : null,
                       vorherSub ? vorherSub.id.replace(/^sub-/, '') : '');
      }
    };
  });

  // Declared up here on purpose: the sub-tab switcher below reads it while the script is
  // still executing, and a `let` further down would be in its temporal dead zone — which
  // threw and aborted the rest of the IIFE, taking every later declaration with it.
  let drivetrainChartsDirty = true;
  function markDrivetrainChartsDirty() { drivetrainChartsDirty = true; }

  // +/- steppers on every options slider. They write value +/- step and then dispatch the
  // SAME input/change events dragging produces, so each control keeps exactly one code
  // path and mouse dragging is unaffected.
  document.querySelectorAll('.opt-slider').forEach(wrap => {
    const range = wrap.querySelector('input[type=range]');
    if (!range) return;
    wrap.querySelectorAll('button[data-step]').forEach(btn => {
      btn.onclick = () => {
        const step = parseFloat(range.step) || 1;
        const min = parseFloat(range.min), max = parseFloat(range.max);
        const raw = parseFloat(range.value) + parseFloat(btn.dataset.step) * step;
        // Snap back onto the step grid, or repeated clicks drift off it over time.
        const snapped = Math.round((raw - min) / step) * step + min;
        range.value = String(Math.min(max, Math.max(min, snapped)));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        range.dispatchEvent(new Event('change', { bubbles: true }));
      };
    });
  });

  // ---- Entwickler tab: secondary sub-navigation (BLE-Explorer/Kalibrierung/Makros/Doku) ----
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.subtabpage').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('subtab-' + btn.dataset.subtab).classList.add('active');
      // Redraw lazily on open rather than on every slider event: the sliders already
      // re-run the launch calibration, and the charts are invisible while they move.
      keepScreenAwake(false);
    };
  });

  // ---- Control tab: virtual stick + throttle ----
  let steerX = 0, throttleY = 0;

  // ====================================================================================
  // ZWEI SPIELER AN EINEM RECHNER
  // ====================================================================================
  //
  // BESTELLT: "Wenn ich ihn anschalte, will ich 2 Autos und 2 Gamepads verbinden und beide
  // fahren koennen."
  //
  // Die App war an vier Stellen ausdruecklich einspielerig, und die stehen weit
  // auseinander: EIN Pad wird gewaehlt (pollGamepad in 90-ghosts.js), EIN Paar
  // steerX/throttleY nimmt jede Eingabequelle auf (die Schiedsstelle in 30-input.js), EIN
  // physEngine gehoert dem Spieler (50-drive.js), und EIN playerCar ist das Ziel jedes
  // Pakets (sendControlValue in 20-protocol.js).
  //
  // ---- WARUM SPIELER 2 EINEN EIGENEN, SCHMALEN WEG BEKOMMT -----------------------
  //
  // Nicht die Schiedsstelle zu verdoppeln, sondern sie zu umgehen: Spieler 2 fahrt
  // ausschliesslich mit dem GAMEPAD. Damit braucht er keine Quellenverwaltung - es gibt
  // nichts, worueber Tastatur, Maus und Pad sich einigen muessten -, und diese zwei Zahlen
  // sind sein ganzer Eingang. Tastatur, Bildschirmknueppel und alle Sonderknoepfe des Pads
  // (Wetter, Boxenstopp, Rennstart, Streckeneditor) bleiben bei Spieler 1, und das ist
  // Absicht: zwei Leute, die sich gegenseitig das Wetter umstellen, sind kein Rennen.
  //
  // HIER DEKLARIERT, weil die Leser in SPAETEREN Dateien stehen (Fahrphysik in 50, Pad in
  // 90) und der Schreiber der Kachel ebenfalls. Ein let in 90 waere fuer 50 die temporale
  // Todeszone - genau die Falle, die in diesem Projekt schon einen Regler gekostet hat.
  let zweiSpieler = false;
  let p2Steer = 0, p2Throttle = 0;

  // Real CH command-packet protocol, reverse-engineered from a genuine
  // Android Bluetooth HCI snoop log of the official app (2026-08-13) and cross-checked
  // against an independent reverse-engineering effort on a different car.
  // 20-byte frame written to NUS RX (6e400002): [header(6) | throttle | steer | 0x80 |
  // steer(dup) | 0x60 | 0x00 | 0x01 | 0x00 | flags(~0x82) | 0x04 | 0x00 0x00 0x00 | crc8 ]
  // Throttle/steer are (0xDF + signedDelta) mod 256 — a continuously wrapping value, NOT
  // a simple 0x80-centered byte. Steer: positive = right (confirmed via a held right-turn
  // in the capture pinning steer at 0x7f), negative = left. Throttle: positive delta =
  // forward/accelerate, negative = brake/reverse (brake direction inferred by symmetry;
  // not yet empirically confirmed with a real hard-braking capture).
  function crc8(bytes) {
    let crc = 0xff;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
      }
    }
    return crc;
  }

  // SAFETY: reverse/brake was never captured in the real snoop log — we only assumed
  // symmetry with forward. Real-car test (2026-08-20) showed full-reverse input (delta
  // -127, byte 0x60) unexpectedly drives FORWARD instead (0x60 falls in the same byte
  // range our own forward-ramp capture already passed through, e.g. 0x58). Half-reverse
  // (delta -64, byte 0x9F) was confirmed to brake/reverse correctly. Until the exact
  // boundary is measured, clamp reverse to this confirmed-safe depth only.
  const MIN_THROTTLE_DELTA = -64;

