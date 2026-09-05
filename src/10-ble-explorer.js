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

  function setConnected(isConnected) {
    // Jede Anzeige hier einzeln geprueft: der Punkt und der Trennen-Knopf in der Kopfzeile
    // sind entfernt worden, und ein blinder Zugriff auf einen von beiden wuerde beim
    // Verbinden eine Ausnahme werfen - also genau in dem Moment, in dem am wenigsten Zeit
    // ist, sie zu suchen.
    // Nur noch der Verbindungsknopf. Der Punkt und der Trennen-Knopf in der Kopfzeile sind
    // entfallen, und der Verbindungszustand steht in der Fusszeile des Cockpits - eine
    // zweite Anzeige dafuer waere ohnehin eine zweite Wahrheit.
    const bc = $('btn-connect');
    if (bc) bc.disabled = isConnected;
  }

  async function connect() {
    if (!navigator.bluetooth) {
      log('Web Bluetooth wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge auf Windows/Android/ChromeOS verwenden.', 'err');
      alert('Web Bluetooth wird hier nicht unterstützt. Bitte in Chrome/Edge öffnen.');
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
      setConnected(true);
      // Exactly one starter sound per successful connection.
      playFx(fxBuffers.start[$('sound-profile').value] || fxBuffers.start.porsche, 0.85);
      log('GATT-Server verbunden.', 'info');
      await exploreServices();
    } catch (err) {
      log('Verbindungsfehler: ' + err.message, 'err');
      console.error(err);
    }
  }

  function onDisconnected() {
    setConnected(false);
    log('Verbindung getrennt.', 'err');
  }

  async function disconnect() {
    if (device && device.gatt.connected) device.gatt.disconnect();
    setConnected(false);
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
        errDiv.textContent = 'Fehler beim Laden der Characteristics: ' + err.message;
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
  // Der gruene Knopf oben macht jetzt dasselbe wie der in der Garage. Vorher hing er am
  // BLE-Explorer, der KEIN Auto in der Garage anlegt - wer ihn benutzte, war verbunden, hatte
  // aber kein Auto, dem er eine Rolle geben konnte. Zwei Knoepfe mit demselben Wort und
  // verschiedener Wirkung sind eine Falle, keine Auswahl.
  $('btn-connect').onclick = () => garageConnect();
  // Der Trennen-Knopf in der Kopfzeile ist entfernt: er rief disconnect() des BLE-Explorers
  // auf und liess ein ueber die Garage verbundenes Auto unberuehrt - er tat also nichts, genau
  // wie der Verbinden-Knopf daneben, bevor der umgehaengt wurde. Getrennt wird pro Auto in
  // der Garage, und das funktioniert.
  $('dev-explore').onclick = connect;


  // Woerterbuch Deutsch -> Englisch. Schluessel ist der normalisierte deutsche Text
  // (Mehrfach-Leerzeichen zusammengefasst, getrimmt). Was hier fehlt, bleibt deutsch
  // stehen - das ist die Absicht, nicht ein Mangel: ein fehlender Eintrag faellt auf,
  // ein leerer Text nicht.
  const I18N_EN = {
    "Offen": "Open",
    "Vibration überhaupt": "Vibration at all",
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
    "Funkfilter": "Radio filter",
    "Lässt die Ansage nach Rennfunk klingen: ein Knacken beim Aufschalten, ein Rauschteppich darunter, ein Knacken beim Loslassen, und die Stimme spricht schneller und flacher. Was NICHT geht, und das sei gesagt: die Stimme selbst bandbegrenzen. Die Sprachausgabe des Browsers liefert keinen Audioknoten, es gibt also nichts, wo ein Filter dazwischen könnte. Der Funkeindruck kommt vom Drumherum.": "Makes the announcement sound like race radio: a click when the transmitter keys, a bed of static underneath, a click when it unkeys, and the voice speaks faster and flatter. What is NOT possible, and it should be said: band-limiting the voice itself. The browser’s speech output provides no audio node, so there is nowhere for a filter to sit. The radio impression comes from everything around it.",
    "Gaskennlinie": "Throttle curve",
    "Anfahrschub": "Launch shove",
    "Wie der Gasweg des Controllers auf die Beschleunigung abgebildet wird. Die Enden liegen immer fest: kein Gas heißt keine Beschleunigung, Vollgas heißt volle Beschleunigung – geändert wird nur, was dazwischen passiert. 1,0 ist die Gerade und ändert nichts. Über 1,0 streckt den unteren Bereich: ein Viertel Gasweg gibt bei 1,8 nur noch 8 % statt 25 %. Genau das braucht ein Trigger mit großer Totzone – ein DualShock 4 oder DualSense gibt schon bei leichtem Druck viel ab, und dann lässt sich kein Tempo halten. Unter 1,0 macht es umgekehrt spitzer, für Pedale mit langem Weg.": "How the controller’s throttle travel maps to acceleration. The ends are always fixed: no throttle means no acceleration, full throttle means full acceleration – only what happens in between changes. 1.0 is the straight line and changes nothing. Above 1.0 stretches the lower range: a quarter of the travel gives only 8 % instead of 25 % at 1.8. That is exactly what a trigger with a large dead zone needs – a DualShock 4 or DualSense already gives away a lot under light pressure, and then no speed can be held. Below 1.0 does the opposite and makes it sharper, for pedals with long travel.",
    "Der Stößer, mit dem das Auto aus dem Stand losbricht. Ohne ihn bekommt es beim Anfahren ein Gasbyte, das zu klein ist, um es zu bewegen – es zuckt und steht. Mit ihm springt es dafür an: 16 % sind im Maßstab rund 47 km/h, und das ist der Sprung von null auf gefühlt 30, den man beim ersten Gasgeben spürt. Wieviel nötig ist, hängt am Untergrund: auf Teppich mehr als auf Laminat. Runter drehen, bis das Auto gerade noch sauber anfährt.": "The shove that breaks the car away from standstill. Without it the car gets a throttle byte too small to move it – it twitches and stays put. With it the car jumps instead: 16 % is about 47 km/h to scale, and that is the jump from zero to a felt 30 you notice on the first squeeze. How much is needed depends on the surface: more on carpet than on laminate. Turn it down until the car only just still pulls away cleanly.",
    "(fest)": "(fixed)",
    "(nicht real getestet).": "(not tested for real).",
    ") an, damit du live sehen kannst, was das Auto zurückmeldet, während du Kombinationen ausprobierst.": "): so you can watch live what the car reports back while you try combinations.",
    ") und zeigt gleichzeitig alle Notify-Werte von NUS TX (": ") and at the same time shows every notify value from NUS TX (",
    ", Skalierung": ", scaling",
    ", bevor die App es merkt:": ", before the app notices:",
    ", damit du siehst, welches Auto in der Liste welches auf dem Tisch ist.": ", so you can see which car in the list is which one on the table.",
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
    "Auf den neuen Blättern steht ein 100-mm-Kontrollmaß. Nachmessen ist der einzige Weg, den Druckmaßstab zu prüfen, denn eine Druckvorschau sagt dazu nichts.": "The new sheets carry a 100 mm check measure. Measuring it is the only way to verify the print scale, because a print preview says nothing about it.",
    "Auf der Bahn": "On track",
    "Aufgeladen, dieses Modell hat keinen Lader.": "Turbocharged, this model has no turbo.",
    "Aufnahme starten": "Start recording",
    "Aufnahme": "Recording",
    "Aufnahme: nächsten Abschnitt markieren": "Recording: mark the next section",
    "Aus dem Cockpit hierher gezogen. Am Telefon wird geneigt oder ein Pad benutzt, am Rechner reichen die Pfeiltasten: aber ohne Pad und ohne Tastatur ist das hier die einzige Mausbedienung, deshalb ist sie nicht gelöscht.": "Moved here from the cockpit. On a phone you tilt or use a pad, on a computer the arrow keys are enough: but without a pad and without a keyboard this is the only mouse control, which is why it was not deleted.",
    "Aus dem Cockpit hierher: dort war unter dem Schirm alles doppelt, die Position aber nicht: und sie gehört neben die Strecke, auf die sie sich bezieht. Die Lage ist eine Schätzung aus Kachelzähler und Zeit, keine Positionsmessung vom Auto.": "Moved here from the cockpit: everything below the dash was duplicated there, but the position was not: and it belongs next to the track it refers to. The position is an estimate from the tile counter and time, not a measurement from the car.",
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
    "Boxenstopp, erneut zweimal kurz drücken bricht ab": "Pit stop, two more short presses abort it",
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
    "Das Auto hält sich selbst auf der Bahn, der Ghost gibt nur Gas.": "The car keeps itself on the track; the ghost only works the throttle.",
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
    "Weniger Leistung, mehr Reserve": "Less power, more reserve",
    "Von Hand schalten, 4,4 s auf 100, Reifenverschleiß und Tankgewicht wie GT3, aber mehr Grip und eine gutmütigere Bremse. Die Klasse darunter fährt sich nicht leichter, weil sie mehr verzeiht, sondern weil sie langsamer ist.":
      "Manual gearbox, 4.4 s to 100, tyre wear and fuel weight as GT3, but more grip and gentler brakes. The class below is not easier because it forgives more, but because it is slower.",
    "Das schärfste, was das Modell hergibt": "The sharpest the model has",

    // Die Kachelseite der Optionen
    "Einstellungen": "Settings",
    "\u2190 Einstellungen": "\u2190 Settings",
    "F\u00fcnf Bereiche. Was das Auto": "Five areas. What the car",
    ", steht unter Fahrgef\u00fchl; was es": "is under Handling; what it",
    "fährt": "drives",
    "hat": "has",
    ", unter Allgemein.": "is under General.",
    "Licht, Betriebsart, Akku, Tank, Schaden, Vibration.":
      "Lights, mode, battery, fuel, damage, vibration.",
    "Fahrwerk, Getriebe, Masse und Reifen, Lenkung.":
      "Chassis, gearbox, mass and tyres, steering.",
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
    "Erst ein Auto verbinden": "Connect a car first",
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
    "Ghost: Leitplanken-Modus": "Ghost: guard-rail mode",
    "Ghost: Linienmodell": "Ghost: line model",
    "Ghost: lernt von Runde zu Runde": "Ghost: learns lap by lap",
    "Ghost: seitlicher Versatz": "Ghost: lateral offset",
    "Allgemein": "General",
    "Gummiband": "Rubber band",
    "Haarnadel L": "Hairpin L",
    "Haarnadel R": "Hairpin R",
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
    "Stoppen": "Stop",
    "Strafe je verpasstem Stopp (s)": "Penalty per missed stop (s)",
    "Strecke aus Teilen bauen, drehen, als Code weitergeben. Zwei Kurventypen der Original-App fehlen noch – ihre Maße sind nicht bekannt.":
      "Build a track from pieces, rotate it, pass it on as a code. Two curve types from the original app are still missing – their dimensions are not known.",
    "Die Palette ist nicht vollständig.": "The palette is incomplete.",
    "Die Original-App hat neun Kacheltypen, hier sind es sechs: es fehlen eine lange flache Kurve und eine Keilkurve. Ihre Maße stehen nirgends – die Angabe oben im Original-Editor ist der Umriss des":
      "The original app has nine tile types, this one has six: a long shallow curve and a wedge curve are missing. Their dimensions are written down nowhere – the figure at the top of the original editor is the bounding box of the",
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
    "experimentell": "experimental",
    "Überfahrten je Runde": "Crossings per lap",
    "1 (aus)": "1 (off)",
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
    "Runde beim Boxeneinfahren trotzdem zählen": "Count the lap on pit entry anyway",
    "Sinnvoll, wenn die Boxengasse parallel zu Start/Ziel liegt. Nur bei „Doppelter Start-Ausdruck“.":
      "Useful when the pit lane runs parallel to start/finish. Only with “Double start printout”.",
    "Wo die Boxengasse liegt": "Where the pit lane is",
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
    ": zwei Ausdrucke im Abstand von 50 cm. Zwei Musterkontakte innerhalb von 3 s bei mindestens 1 s Abstand sind eine Boxeneinfahrt und keine Runde. Danach piept es, das Tempolimit von 60 km/h gilt 4 s, und ein Anhalten in dieser Zeit startet den Service. Der Mindestabstand ist der wichtigere Teil der Bedingung: ein einzelner Ausdruck hält bei Fahrt etwa eine Sekunde Kontakt, und ohne ihn würde das Flattern":
      ": two printouts 50 cm apart. Two pattern contacts within 3 s and at least 1 s apart are a pit entry, not a lap. Then it beeps, the 60 km/h limit holds for 4 s, and stopping within that time starts the service. The minimum gap is the more important half of the condition: a single printout holds contact for about a second at speed, and without it the flutter of",
    "eines": "a single",
    "Musters als Paar gelesen.": "pattern would be read as a pair.",
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
    "Bremsenquietschen": "Brake squeal",
    "Eigener Regler. Es hing vorher am Motorregler und war deshalb nicht getrennt leiser zu bekommen.":
      "Its own slider. It used to hang on the engine volume, so it could not be turned down on its own.",
    "Balance / Lenkung": "Bias / steering",
    "Auch auf dem Steuerkreuz links/rechts. Der volle Lenkeinschlag ist mechanisch 45 Grad; bei 100 % fordert voller Stick genau ihn an.":
      "Also on the D-pad, left/right. Full steering lock is mechanically 45 degrees; at 100% a full stick asks for exactly that.",
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
    "Vollbild verlassen": "Leave fullscreen",
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
    "Wo steht das Auto?": "Where is the car?",
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
    "links rot-weiß": "left red-and-white",
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
    "rechts blau-weiß": "right blue-and-white",
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
    "Automatik, 2,0 s auf 100, voller Grip, kein Reifenverschleiß und kein Tankgewicht. Die Bremse steht am Anschlag, also der kürzeste Bremsweg von allen, und die Lenkkalibrierung auf 250 Prozent: der volle Einschlag liegt schon bei einem Viertel Stick an. 50 Abgänge erlaubt, kein Schaden. Zum Fahren ohne Nachdenken.": "Automatic, 2.0 s to 100, full grip, no tyre wear and no fuel weight. The brake is at its stop, so the shortest braking distance of them all, and steering calibration at 250 percent: full lock arrives at a quarter of stick travel. 50 departures allowed, no damage. For driving without thinking.",
    "Von Hand schalten, 2,4 s auf 100, stärkster Reifenverschleiß, volles Tankgewicht, die am feinsten dosierbare Lenkung (52 % des Anschlags bei vollem Stick, man muss also weit ziehen) und die kürzeste Bremse. Das Ausrollen ist kurz, weil der Luftwiderstand hier die größte Einzelkraft ist.": "Manual shifting, 2.4 s to 100, the strongest tyre wear, full fuel weight, the most finely metered steering (52 % of the lock at full stick, so you have to pull a long way) and the shortest braking. The coast-down is short because drag is the largest single force here.",
    "Gasfaktor": "Throttle factor",
    "Faktor auf das Motorbyte, das zum Auto geht. Das Byte ist Tempo geteilt durch Simulations-Höchstgeschwindigkeit; bei 100 % bekommt das Auto also erst volle Leistung, wenn die Simulation ihre Höchstgeschwindigkeit erreicht hat, und das dauert gemessen fast 25 Sekunden Vollgas. Über 100 % erreicht es die volle Leistung früher, ohne dass der Tacho anders skaliert. Das ist auch ehrlicher als es klingt: das Modellauto fährt real 5,9 km/h, egal was die Simulation glaubt – dieser Faktor ist die Abbildung zwischen beidem, und dass er früher genau 1 war, war eine Annahme und keine Messung.": "Factor applied to the motor byte that goes to the car. The byte is speed divided by the simulated top speed, so at 100 % the car only gets full power once the simulation has reached its top speed – and that takes a measured 25 seconds of full throttle. Above 100 % it reaches full power sooner without the speedometer scaling differently. That is also more honest than it sounds: the model car really does 5.9 km/h whatever the simulation believes – this factor is the mapping between the two, and the fact that it used to be exactly 1 was an assumption, not a measurement.",
    "Reifen: Füllhöhe ist Restprofil, Farbe die Temperatur. Links und rechts werden getrennt gerechnet, vorn und hinten nicht – die beiden einer Seite laufen deshalb gleich. Antippen schaltet die Reifensimulation aus, beim Boxenstopp den Reifenwechsel.": "Tyres: fill height is remaining tread, colour is temperature. Left and right are tracked separately, front and rear are not – the two on one side therefore move together. Tapping switches the tyre simulation off, and during a pit stop the tyre change.",
    // Zusaetze v0.5: Kennzeichnungen, Crash-Schwelle, Startseite, Pad-Aktionen.
    "Reifenverschleiß, Reifentemperatur, Bremstemperatur": "Tyre wear, tyre temperature, brake temperature",
    "Wettersimulation": "Weather simulation",
    "Alles hier schreibt rohe Bytes zum Auto und liest rohe Bytes zurück. Das ist Werkbank und kein Merkmal: die Pakete tragen gültige Prüfsummen, aber was das Auto mit einem selbst zusammengesetzten Paket macht, ist nicht vorhersagbar. Zum Fahren wird nichts davon gebraucht.": "Everything here writes raw bytes to the car and reads raw bytes back. This is a workbench, not a feature: the packets carry valid checksums, but what the car does with a hand-assembled packet is not predictable. None of it is needed for driving.",
    "Automatik, 2,6 s auf 100, voller Grip, kein Reifenverschleiß und kein Tankgewicht. Lenkkalibrierung 200 Prozent, damit auch enge Strecken gehen – der volle Einschlag liegt bei etwa einem Drittel Stick an. Fading und Windschatten sind aus; sie stehen ab GT4 zur Verfügung.": "Automatic, 2.6 s to 100, full grip, no tyre wear and no fuel weight. Steering calibration 200 percent so that tight tracks work too – full lock arrives at about a third of stick travel. Fade and dirty air are off; they are available from GT4 upwards.",
    "Crash-Schwelle": "Crash threshold",
    "Wie weit die Bewegungsbytes 1 und 3 vom gleitenden Mittel abweichen müssen, damit ein Stoß als Crash gilt. Niedriger heißt empfindlicher: schon ein Rempler zählt. Höher heißt, dass nur ein echter Einschlag zählt. 40 ist der Wert, mit dem die Erkennung gebaut und geprüft wurde – stand bis v0.5 als Konstante im Code, war also eine Einstellung, die niemand einstellen konnte.": "How far the motion bytes 1 and 3 must deviate from the running mean for a jolt to count as a crash. Lower means more sensitive: even a nudge counts. Higher means only a real impact counts. 40 is the value the detection was built and tested with – it was a constant in the code until v0.5, so it was a setting nobody could set.",
    "R3 (rechten Stick drücken)": "R3 (press right stick)",
    "Zwei der drei Varianten sind am Auto unerprobt, und die Nummer des gedruckten Musters ist geraten und nicht entziffert – die Kodierregel ist nicht bekannt. „Überall halten“ trägt dagegen: es braucht kein Muster.": "Two of the three variants are untested on the car, and the number of the printed pattern is guessed rather than deciphered – the encoding rule is not known. “Stop anywhere” does hold up, though: it needs no pattern at all.",
    "Leseart: Bahn oder Ausdruck": "Reading mode: rail or printout",
    "Getriebe: Automatik oder von Hand": "Gearbox: automatic or manual",
    "Gelbe Flagge (1 s halten)": "Yellow flag (hold 1 s)",
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
    "Mehrspieler im WLAN": "Multiplayer over Wi-Fi",
    "Mehrere Telefone, jedes mit eigenem Auto, eine gemeinsame Rangliste. Auf dem PC laeuft dazu ein kleines Programm: python tools/omegasim_host.py": "Several phones, each with its own car, one shared leaderboard. A small program runs on the PC for it: python tools/omegasim_host.py",
    "Ueber die Leitung gehen Rundenzahl, Rundenzeiten und Abgaenge. Keine Physik, keine Lenkwerte: jedes Telefon rechnet seine eigene Physik und haelt seine eigene Bluetooth-Verbindung. Reisst das WLAN ab, faehrt jeder weiter, nur die Rangliste steht still.": "What goes over the wire: lap count, lap times and departures. No physics, no steering values – each phone computes its own physics and holds its own Bluetooth connection. If the Wi-Fi drops, everyone keeps driving; only the leaderboard stands still.",
    "Gezaehlt werden GEMESSENE Runden, genau wie in der Rundenliste im Cockpit: die erste Ueberfahrt startet die Uhr, erst die zweite ergibt eine Zeit. Nach drei Ueberfahrten stehen also zwei Runden da. Bei Gleichstand fuehrt, wer zuerst dort war.": "Counted are MEASURED laps, exactly as in the cockpit lap list: the first crossing starts the clock, only the second yields a time. After three crossings the count shows two laps. On a tie, whoever got there first leads.",
    "Warum es experimentell ist, und der Grund ist eine Browserregel und kein Wackeln im Code: Web Bluetooth verlangt einen secure context. Das sind https, http://localhost und file. Eine Adresse wie http://192.168.1.50:8080 ist keiner – die App laedt dort, aber „Auto verbinden“ bleibt ohne Wirkung. Einmal je Telefon muss man in Chrome unter chrome://flags/#unsafely-treat-insecure-origin-as-secure die Adresse des Hosts eintragen und Chrome neu starten. Damit erklaert man diesen einen Ursprung fuer vertrauenswuerdig; im eigenen WLAN mit dem eigenen PC ist das vertretbar, aber es ist eine Ausnahme von einer Sicherheitsregel und keine Einstellung.": "Why it is experimental – and the reason is a browser rule, not shaky code: Web Bluetooth requires a secure context. Those are https, http://localhost and file. An address like http://192.168.1.50:8080 is not one – the app loads there, but “Connect car” has no effect. Once per phone you have to enter the host address in Chrome under chrome://flags/#unsafely-treat-insecure-origin-as-secure and restart Chrome. Doing so declares that one origin trustworthy; on your own Wi-Fi with your own PC that is defensible, but it is an exception to a security rule and not a setting.",
    "Der Ueberblicksschirm fuer den PC liegt beim Host unter /mp-overview.html. Er braucht kein Bluetooth und deshalb auch keine Freigabe: auf http://localhost ist er ohnehin ein secure context.": "The overview screen for the PC sits on the host at /mp-overview.html. It needs no Bluetooth and therefore no exemption: on http://localhost it is a secure context anyway.",
    "Host-Adresse": "Host address",
    "Mein Name": "My name",
    "Mitmachen": "Join",
    "Verlassen": "Leave",
    "keine Daten": "no data",
    "Fahrer": "drivers",
    "verbunden": "connected",
    "kein Kontakt zum Host": "no contact with the host",
    "Ohne Host-Adresse geht es nicht.": "It does not work without a host address.",
    // Vier Texte, die im englischen Modus deutsch geblieben sind. Zwei waren ohne
    // Eintrag, zwei waren BRUCHSTUECKE - Auszeichnung mitten im Satz zerlegt den
    // Textknoten, und dann passt kein Schluessel mehr. Das Markup ist dafuer
    // geglaettet worden; diese Schluessel sind aus ihm gerechnet und nicht abgetippt.
    "Aufnahmen werden lokal im Browser gespeichert (localStorage).": "Recordings are stored locally in the browser (localStorage).",
    "Strecken werden lokal im Browser gespeichert (localStorage).": "Tracks are stored locally in the browser (localStorage).",
    "Im Ausdruck-Modus meldet das Start/Ziel-Blatt 0x01. Im Bahn-Modus melden die Schienen 0x02 Gerade, 0x03 Linkskurve, 0x04 Rechtskurve, 0x05 und 0x06 Haarnadel, 0x0a Start/Ziel, 0x00 abseits der Bahn. Dieselbe Zahl bedeutet je Modus etwas anderes – wer Codes vergleicht, muss den Modus mitnennen.": "In printed-pattern mode the start/finish sheet reports 0x01. In rail mode the rails report 0x02 straight, 0x03 left-hand corner, 0x04 right-hand corner, 0x05 and 0x06 hairpin, 0x0a start/finish, 0x00 off the track. The same number means something different in each mode – whoever compares codes has to name the mode as well.",
    "fahr über ein beliebiges ausgedrucktes Muster, hier steht sofort, welchen Code das Auto meldet. Achtung auf den Modus: ein Ausdruck meldet aus der Ausdruck-Tabelle, dort ist 0x01 Start/Ziel. Die Werte 0x0a Start/Ziel, 0x02 Gerade, 0x03 Linkskurve, 0x04 Rechtskurve, 0x05 und 0x06 Haarnadel gehören zur Bahn-Tabelle; alles andere ist unbestätigt. Trag hier den Code ein, den dein gedrucktes Boxen-Muster tatsächlich auslöst – 0x08 war nie ein reales Signal und ist deshalb nicht mehr die Vorgabe.": "drive over any printed pattern and it says right here which code the car reports. Mind the mode: a printout reports from the printed-pattern table, where 0x01 is start/finish. The values 0x0a start/finish, 0x02 straight, 0x03 left-hand corner, 0x04 right-hand corner, 0x05 and 0x06 hairpin belong to the rail table; everything else is unconfirmed. Enter the code your printed pit pattern actually triggers here – 0x08 was never a real signal and is therefore no longer the default.",
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
    "Lenkrate": "steering rate",
    "Reifenquietschen": "Tyre squeal",
    "Am Grenzbereich, im Stil von Gran Turismo: Lautstärke und Tonhöhe laufen stetig mit der Querausnutzung des Reibkreises, Einsatz ab 60 Prozent – also ab etwa 98 km/h bei vollem Lenkausschlag, ab 197 km/h bei halbem, und bei einem Viertel Ausschlag nie. Eine Haarnadel quietscht, eine lange schnelle Kurve nicht. Bis v0.4.55 stand die Schwelle bei 85 Prozent und war damit unerreichbar: gemessen kommt die Querausnutzung erst bei 265 km/h dorthin, weil der Lenkausschlag mit dem Tempo beschnitten wird. Es hat deshalb nie gequietscht.": "At the limit, in the style of Gran Turismo: volume and pitch run continuously with the lateral use of the friction circle, starting at 60 per cent – so from about 98 km/h at full lock, from 197 km/h at half, and at a quarter of lock never. A hairpin squeals, a long fast corner does not. Up to v0.4.55 the threshold sat at 85 per cent and was therefore unreachable: measured, the lateral use only gets there at 265 km/h, because the steering lock is cut back with speed. It therefore never squealed.",
    "Mehrspieler": "Multiplayer",
    "Sportlich, mit Simulationstiefe": "Sporty, with simulation depth",
    "Von Hand schalten, 2,9 s auf 100, Reifenverschleiß und Tankgewicht knapp zur Hälfte. Bremsfading, Windschatten und ungleicher Verschleiß sind voll an. Die harte, gegen echte Werte kalibrierte Fassung steht daneben als Realismus GT3.": "Shift by hand, 2.9 s to 100, tyre wear and fuel weight at just under half. Brake fade, dirty air and uneven wear are fully on. The hard version, calibrated against real figures, sits next to it as Realism GT3.",
    "Automatik, 3,1 s auf 100, Reifenverschleiß und Tankgewicht knapp halb so stark wie im Realismus-GT3. Die Klasse direkt neben Pro: Bremsfading, Windschatten und ungleicher Verschleiß sind an, aber gutmütig eingestellt, und die Lenkkalibrierung liegt bei 175 Prozent.": "Automatic, 3.1 s to 100, tyre wear and fuel weight just under half as strong as in the Realism GT3. The class right next to Pro: brake fade, dirty air and uneven wear are on, but set gently, and the steering calibration sits at 175 percent.",
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
    "Außen anstellen, innen scheiteln, außen heraus. Gemessener Einschlag: 70 Prozent ergeben 13,5 Grad, 100 Prozent 20,9 Grad von den 45 des Autos. Ohne gebaute oder gelernte Strecke fällt sie auf eine gröbere Regel je Kachel zurück – halb so stark und ohne Blick auf die nächste Kurve. Ganz ohne gelesene Streckencodes wirkt sie nicht, weil niemand weiß, wo das Auto ist. Ob es hilft, sagen Rundenzeit und Abgänge.": "Set up wide, clip the apex, run wide again. Measured lock: 70 percent gives 13.5 degrees, 100 percent 20.9 of the car’s 45. Without a built or learnt track it falls back to a coarser per-tile rule – half as strong and blind to the next corner. With no track codes read at all it does nothing, because nobody knows where the car is. Whether it helps is told by lap times and departures.",
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
    "Zwei Autos nebeneinander gehen auseinander, und beim Überholen weicht auch der Vorausfahrende aus, zur anderen Seite. Zwei Autos auf 25 cm Bahnbreite brauchen beide Hälften. Dieser Regler bestimmt auch, wie weit der Angreifer zur Seite geht: das ist ein Ausweichen und keine Linienwahl, hängt also nicht an der Ideallinie.": "Two cars side by side move apart, and when overtaking the car in front gives way too, to the other side. Two cars on 25 cm of track width need both halves. This slider also sets how far the attacker moves over: that is an avoidance and not a choice of line, so it does not depend on the racing line.",
    "Jeder Ghost hält eine eigene, feste Linie über die Bahnbreite. Auf der Geraden gilt die Spur, in der Kurve die Ideallinie – so fährt das Feld hintereinander, aber auf verschiedenen Linien, und sucht im Bogen trotzdem den Scheitel. Der Übergang läuft mit 350 ms nach, damit an der Kachelgrenze kein Ruck entsteht. In der Kurve bleibt die halbe Spur stehen: alle auf denselben Scheitel zu schicken wäre realistisch, würde sie aber zusammenführen, und Berührungen sind ohne Rückmeldung zur Querlage nicht zurückzuregeln.": "Every ghost holds its own fixed line across the track width. On the straight the lane rules, in the corner the racing line – so the field runs in file but on different lines, and still seeks the apex through the bend. The transition follows with a 350 ms lag so that no jolt appears at the tile boundary. Half the lane stays in the corner: sending everyone to the same apex would be realistic but would bring them together, and contact cannot be regulated away without feedback on lateral position.",
    "Dieses Projekt ist unabhängig von Carrera und gehört zu keinem Hersteller. Der vollständige Quellcode steht unter der MIT-Lizenz auf GitHub.": "This project is independent of Carrera and belongs to no manufacturer. The complete source code is available under the MIT licence on GitHub.",
    "Jeder darf ihn nutzen, kopieren, verändern und auch in kommerzieller Software verwenden, solange der ursprüngliche Urheberrechtsvermerk und der Lizenztext in der Kopie erhalten bleiben.": "Anyone may use, copy and modify it, including in commercial software, as long as the original copyright notice and the licence text are kept in the copy.",
    "Dieselbe Lizenz sagt aber auch: die Software kommt ohne Garantie und ohne Gewährleistung. Du steuerst deine Autos auf eigene Gefahr. Es ist ein Freizeitprojekt, motiviert durch die Option, eine Pups-Hupe einzubauen – und möglicherweise funktioniert es nach einem künftigen Firmware-Update nicht mehr.": "The same licence also says: the software comes with no warranty and no guarantee. You drive your cars at your own risk. This is a hobby project, motivated by the option of building in a whoopee horn – and it may well stop working after a future firmware update.",
    "Für konstruktives Feedback oder Feature-Wünsche schreib mir gern im Thema „Omega Sim“ im Carrera Hybrid Players Discord, unter „weitere Themen“.": "For constructive feedback or feature requests, do write to me in the “Omega Sim” topic of the Carrera Hybrid Players Discord, under “weitere Themen”.",
    "Unabhängig, offen, ohne Gewähr": "Independent, open, without warranty",
    "Quellcode auf GitHub": "Source code on GitHub",
    "Bremsbalance nach vorn": "Brake bias forward",
    "Bremsbalance nach hinten": "Brake bias rearward",
    "Lenkansprechen kleiner": "Steering response lower",
    "Lenkansprechen größer": "Steering response higher",
    "Controller-Belegung": "Controller mapping",
    "Was gerade auf welcher Taste liegt. Zuweisen lässt sich das in den Optionen unter „Gamepad“; die Grafik zieht sofort nach.": "What currently sits on which button. It can be reassigned in the options under “Gamepad”; the diagram follows immediately.",
    "Weiß ist zuweisbar, gedecktes Grau ist festverdrahtet und nicht zuweisbar (das Steuerkreuz), kursives Grau heißt „nicht belegt“. Touchpad und PS-Taste bleiben ab Werk frei, weil das System beide selbst abgreift: ein Tippen aufs Touchpad löst zugleich einen Klick in der Seite aus. Im Streckeneditor und bei scharfem Boxenstopp bedient das Steuerkreuz erst diese, danach gilt wieder das Gezeigte.": "White is assignable, muted grey is hard-wired and not assignable (the D-pad), italic grey means “not assigned”. Touchpad and PS button stay free out of the box because the system claims both itself: a tap on the touchpad also fires a click somewhere in the page. In the track editor and with an armed pit stop the D-pad serves those first, after which what is shown here applies again.",
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
    "Alle sind aus Zylinderzahl, Kurbelwelle, Bankaufteilung und Zündfolge gerechnet – keiner ist eine Aufnahme. Bei den aufgeladenen Originalen fehlt der Lader. Die vier historischen sind noch nicht nach Gehör geprüft; beim Maserati kommt dazu, dass dieses Modell den Bankwinkel gar nicht darstellt, weshalb er sich vom Ferrari-V12 nur in Drehzahl und Rohrlänge unterscheidet.": "All of them are calculated from cylinder count, crankshaft, bank split and firing order – none is a recording. The forced-induction originals are missing their blower. The four historic ones have not been checked by ear yet; with the Maserati there is more to it, because this model does not represent the bank angle at all, which is why it differs from the Ferrari V12 only in revs and pipe length.",
    "Zwei benachbarte Plätze fahren in der Einführungsrunde versetzt, also als Zweierkolonne. Die Runde läuft mit Boxengassen-Tempo; sobald das erste Auto Start/Ziel überfährt, ist das Limit weg. Aufstellen musst du von Hand – ein Auto auf die Bahn setzen kann die App nicht. Dein eigenes Auto steht mit in der Liste und verschiebt damit, auf welche Seite die Ghosts hinter dir gehen.": "Two adjacent grid slots drive offset from each other on the formation lap, so as a double column. The lap runs at pit-lane pace; as soon as the first car crosses start/finish the limit is gone. Lining up is your job – the app cannot place a car on the track. Your own car is in the list too and therefore shifts which side the ghosts behind you take.",
    "Diese Seite zählt Aufrufe mit GoatCounter, damit ich weiß, ob das Projekt jemand benutzt. Ohne Cookies, ohne Werbung und ohne personenbezogene Daten; wer den Zähler blockiert, verliert keine Funktion. Alles andere – Abstimmungen, Rundenzeiten, Streckenpläne – bleibt im Browser und wird nirgends hingeschickt.": "This page counts visits with GoatCounter so I know whether anyone uses the project. No cookies, no advertising and no personal data; blocking the counter costs you no function. Everything else – setups, lap times, track plans – stays in the browser and is not sent anywhere.",
    "Gänge": "gears",
    "Schaltzeit": "shift time",
    "EINFÜHRUNGSRUNDE · AUTOPILOT": "FORMATION LAP · AUTOPILOT",
    "EINFÜHRUNGSRUNDE": "FORMATION LAP",
    "GELB": "YELLOW",
    "ANFAHRT": "ROLLING UP",
    "Einführungsrunde": "Formation lap",
    "Frei, volle Fahrt!": "Clear, full speed!",
    "Einführungsrunde mit Boxengassen-Tempo. Dein Auto fährt sie selbst, genau wie die Ghosts: es rollt mit an, schlängelt zum Reifenwärmen und hält die Seite seines Startplatzes, ohne dass du etwas anfassen musst – die Bremse gilt trotzdem, damit du anhalten kannst, wenn vor dir jemand steht. Im Cockpit steht dann „Einführungsrunde · Autopilot“. Frei ist es beim ersten Überfahren von Start/Ziel, von wem auch immer – ein Ghost darf es sein. Danach fährt jeder nach seinen Einstellungen, und die Lenkung ist wieder deine. Nur in der Stellung „Auf der Bahn“: im Ausdruck-Modus hält sich das Auto nicht selbst auf der Bahn, und ein Autopilot ohne Querregelung würde es in die Bande fahren.": "Formation lap at pit-lane pace. Your car drives it itself, exactly like the ghosts: it rolls away with the field, weaves to warm the tyres and holds the side of its grid slot without you touching anything – the brake still works, so you can stop if someone is stranded ahead of you. The cockpit then reads “Formation lap · Autopilot”. It is released the first time anyone crosses start/finish – a ghost may do it. After that everyone drives to their own settings and the steering is yours again. Only in the “On the track” position: in printout mode the car does not hold the track by itself, and an autopilot without lateral control would drive it into the barrier.",
    "L1: Bahn oder Ausdruck · R1: Automatik oder von Hand · Kreuz: gelbe Flagge (1 s halten) · Select: Wetter umschalten": "L1: track or printout · R1: automatic or manual · Cross: yellow flag (hold for 1 s) · Select: switch the weather",
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
    "Sechs mechanische Geräusche über dem Motorton, alle an diesem einen Schalter – zum Vergleichen einfach ausschalten. Nichts davon ist eine Aufnahme, alle sechs sind gerechnet und hängen an Werten, die die Simulation ohnehin führt: die Höhen laufen mit der Last (ein Motor im Schub ist dunkler und nicht nur leiser), am Begrenzer stottert die Zündung mit 28 Hz, beim Gaswegnehmen knallt es im Auspuff, beim Hochschalten unter Last einmal kräftig, das Getriebe heult mit der Raddrehzahl statt mit der Motordrehzahl, und die drei aufgeladenen Motoren bekommen ein Laderpfeifen samt Abblasen. Wie stark ein Motor knallt, steht je Motor in den Tondaten – der Formel 1 mit Turbo knallt kaum, der Flat-Plane-V8 ohne Lader am meisten. Was hier absichtlich NICHT drin ist: eine Hörposition. Cockpit gegen Verfolgerkamera ändert nicht den Klang, sondern das Mischungsverhältnis von Auspuff, Ansaugung und Mechanik, und die stecken heute alle drei in einer Schleife.": "Six mechanical noises on top of the engine sound, all on this one switch – turn it off to compare. None of them is a recording; all six are calculated and hang on values the simulation keeps anyway: the highs follow the load (an engine on a closed throttle is darker, not just quieter), at the limiter the ignition stutters at 28 Hz, lifting off the throttle pops in the exhaust, an upshift under load bangs once, the gearbox whines with wheel speed rather than engine speed, and the three forced-induction engines get a turbo whistle with a blow-off. How much an engine pops is stored per engine in the sound data – the turbocharged Formula 1 barely pops, the naturally aspirated flat-plane V8 the most. What is deliberately NOT in here: a listening position. Cockpit versus chase camera does not change the sound but the balance between exhaust, intake and mechanics, and today all three sit in one loop.",
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
            $('app-footer'), $('race-summary'),
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
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.subpage-open').forEach(el => {
    el.addEventListener('click', () => showSubpage(el.dataset.sub));
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
      // Den gewaehlten Tab in die Sicht holen, siehe scrollTabIntoView(). Am Ende des
      // Handlers, weil .active erst darueber gesetzt wird und der Hinweis am Rand den
      // neuen Scrollstand braucht.
      scrollTabIntoView(btn.dataset.tab);
      refreshTabScrollHint();
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

