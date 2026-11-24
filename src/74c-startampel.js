  // ============================== STARTAMPEL (Raspberry Pi / Pico, Bluetooth LE) ==============================
  //
  // v1.6.60 uebernommen aus Gnen54s Fork (Zweig startampel, src/74-startampel.js, Stand 23.11.2026). BESTELLT (dort):
  // eine echte Startampel am Tisch, angesteuert von OmegaSim per Bluetooth. Drei LED-Reihen: oben Rot, in der Mitte
  // Gelb, unten Gruen mit fuenf Spalten.
  //
  //   gesperrt (kein Training/Rennen freigegeben)   Rot
  //   Start im Fenster "Autos in Position"          Rot aus, Gelb an (OmegaSim sagt "Gentlemen, start your engines")
  //   Starttoene des Countdowns                     Gruen, Spalte fuer Spalte dazu
  //   Gruen / Los                                   alles aus
  //   Fruehstart im Countdown                       Gruen aus, Gelb blinkt (bis Gruen)
  //   Gelbe Flagge im Rennen                        Gelb, bis sie aufgehoben ist
  //   Rennende oder Abbruch                         wieder Rot
  //
  // PROTOKOLL: Textzeilen mit "\n" auf eine schreibbare Characteristic eines EIGENEN Dienstes (nicht Nordic UART wie die
  // Autos, sonst stuende die Ampel im Auto-Verbinden-Dialog). Gegenstueck: das Ampel-Programm auf Raspberry Pi bzw.
  // Pico (separat, nicht in diesem Repository; Beschreibung im Wiki, Seite "Startampel").
  //
  //   ROT | START | GRUEN <1-5> | LOS | FRUEHSTART | GELB | GELB_AUS
  //
  // Unterschiede zu Gnen54s Fassung: der Startablauf bleibt der von OmegaSim (Ansage, dann Countdown, raceGridStart in
  // 70-race.js) - seine einstellbare Wartezeit und "Fruehstart bricht den Start ab" sind nicht uebernommen; ein
  // Fruehstart laesst die Ampel nur gelb blinken, Strafe wie in den Renneinstellungen.
  const AMPEL_SERVICE = 'b5a30001-0e9a-4b7c-8d2f-a3f1c0de5a11';
  const AMPEL_BEFEHL = 'b5a30002-0e9a-4b7c-8d2f-a3f1c0de5a11';
  let ampelGeraet = null, ampelKanal = null;
  let ampelSchlange = Promise.resolve();
  let ampelVorstart = false;     // steht die Ampel gerade auf Gelb (START gesendet)?
  let ampelLetzter = '', ampelFehler = '';

  function ampelVerbunden() {
    return !!(ampelKanal && ampelGeraet && ampelGeraet.gatt && ampelGeraet.gatt.connected);
  }
  // Befehle laufen nacheinander (Bluetooth vertraegt keinen zweiten Schreibvorgang, solange der erste offen ist, und
  // START muss vor GRUEN ankommen). Ohne Antwort, wenn die Ampel es anbietet; sonst mit Antwort, hoechstens 1,5 s.
  // Ein fehlgeschlagener Befehl wird einmal wiederholt. Jeder Befehl steht im Protokoll.
  const AMPEL_SCHREIB_MS = 1500;
  function ampelSchreiben(kanal, daten) {
    const p = kanal.properties || {};
    // In der Android-App (05-app-bruecke.js) am schnellen Autoweg vorbei, der nur den jeweils neuesten Befehl schreibt.
    if (p.writeWithoutResponse && typeof kanal._befehlSchreiben === 'function') return kanal._befehlSchreiben(daten);
    if (p.writeWithoutResponse && typeof kanal.writeValueWithoutResponse === 'function') return kanal.writeValueWithoutResponse(daten);
    const schreiben = typeof kanal.writeValueWithResponse === 'function' ? kanal.writeValueWithResponse(daten) : kanal.writeValue(daten);
    return Promise.race([schreiben, new Promise((_, nein) =>
      setTimeout(() => nein(new Error('keine Antwort in ' + AMPEL_SCHREIB_MS + ' ms')), AMPEL_SCHREIB_MS))]);
  }
  function ampelSenden(befehl) {
    if (befehl === 'ROT' || befehl === 'LOS' || befehl === 'FRUEHSTART') ampelVorstart = false;
    else if (befehl === 'START') ampelVorstart = true;
    if (!ampelVerbunden()) return;
    const kanal = ampelKanal;
    const daten = new TextEncoder().encode(befehl + '\n');
    ampelSchlange = ampelSchlange
      .then(() => ampelSchreiben(kanal, daten))
      .catch(() => new Promise((r) => setTimeout(r, 150)).then(() => ampelSchreiben(kanal, daten)))
      .then(() => { log('Startampel: ' + befehl, 'info'); ampelLetzter = befehl; ampelFehler = ''; ampelStatusZeigen(); })
      .catch((e) => {
        ampelFehler = befehl + ': ' + ((e && e.message) || e);
        log('Startampel: ' + befehl + ' nicht gesendet (' + ((e && e.message) || e) + ')', 'err');
        ampelStatusZeigen();
      });
  }
  // Nach dem Verbinden den Stand der App nachziehen - die Ampel weiss sonst nicht, ob gerade ein Rennen laeuft.
  function ampelStandSenden() {
    if (raceState === 'racing' || raceState === 'finishing') {
      ampelSenden('LOS');
      if (typeof flagState !== 'undefined' && flagState !== 'green') ampelSenden('GELB');
    } else if (raceState === 'countdown' || (typeof raceGridOffen === 'function' && raceGridOffen())) ampelSenden('START');
    else ampelSenden('ROT');
  }
  function ampelStatusZeigen(text) {
    const s = $('ampel-status');
    let zeile = text || (ampelVerbunden()
      ? t('Verbunden: {n}').replace('{n}', (ampelGeraet && ampelGeraet.name) || 'Startampel')
      : t('Nicht verbunden.'));
    if (!text && ampelLetzter) zeile += ' · ' + t('zuletzt') + ': ' + ampelLetzter;
    if (!text && ampelFehler) zeile += ' · ⚠ ' + ampelFehler;
    if (s) s.textContent = zeile;
    const b = $('ampel-verbinden');
    if (b) b.textContent = ampelVerbunden() ? t('Trennen') : t('Verbinden');
  }
  // Bricht die Verbindung ab (Funkloch, Pi kurz weg), verbindet OmegaSim von selbst neu - ohne Auswahlfenster, dasselbe
  // Geraet - und schickt den aktuellen Stand. Fuenf Versuche im Abstand von 2 s.
  let ampelVonHandGetrennt = false;
  async function ampelWiederVerbinden(dev, versuch) {
    if (ampelGeraet !== dev || ampelVonHandGetrennt || ampelVerbunden() || versuch > 5) return;
    ampelStatusZeigen(t('Verbinde neu …'));
    try {
      const srv = await dev.gatt.connect();
      const dienst = await srv.getPrimaryService(AMPEL_SERVICE);
      ampelKanal = await dienst.getCharacteristic(AMPEL_BEFEHL);
      log('Startampel wieder verbunden.', 'info');
      ampelStatusZeigen();
      ampelStandSenden();
    } catch (e) {
      ampelStatusZeigen();
      setTimeout(() => ampelWiederVerbinden(dev, versuch + 1), 2000);
    }
  }
  async function ampelVerbinden() {
    if (ampelVerbunden()) {
      ampelVonHandGetrennt = true;
      try { ampelGeraet.gatt.disconnect(); } catch (e) { /* schon weg */ }
      return;
    }
    ampelVonHandGetrennt = false;
    if (!navigator.bluetooth) { showHudToast(t('Dieser Browser kann kein Bluetooth.')); return; }
    try {
      ampelStatusZeigen(t('Suche …'));
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [AMPEL_SERVICE] }], optionalServices: [AMPEL_SERVICE] });
      const srv = await dev.gatt.connect();
      const dienst = await srv.getPrimaryService(AMPEL_SERVICE);
      ampelKanal = await dienst.getCharacteristic(AMPEL_BEFEHL);
      ampelGeraet = dev;
      dev.addEventListener('gattserverdisconnected', () => {
        if (ampelGeraet !== dev) return;
        ampelKanal = null;
        ampelSchlange = Promise.resolve();
        log('Startampel getrennt.', 'err');
        ampelStatusZeigen();
        if (!ampelVonHandGetrennt) ampelWiederVerbinden(dev, 1);
      });
      log('Startampel verbunden.', 'info');
      ampelStatusZeigen();
      ampelStandSenden();
    } catch (err) {
      ampelKanal = null;
      ampelStatusZeigen();
      if (err && err.name === 'NotFoundError') log('Keine Startampel gewaehlt.', 'info');
      else log('Startampel: Verbinden fehlgeschlagen: ' + (err && err.message), 'err');
    }
  }
  if ($('ampel-verbinden')) $('ampel-verbinden').addEventListener('click', ampelVerbinden);

  // ---- Aufrufe aus dem Rennablauf (70-race.js, 90-ghosts.js) ----
  function ampelStartKnopf() { if (raceState === 'idle' || raceState === 'finished') ampelSenden('START'); }   // Start im Fenster "Autos in Position"
  function ampelStartAbgebrochen() { ampelSenden('ROT'); }
  function ampelCountdown() { if (!ampelVorstart) ampelSenden('START'); }        // Countdown ohne Startfenster (Mehrspieler, Challenge)
  function startampelLicht(licht) { ampelSenden('GRUEN ' + Math.max(1, Math.min(5, licht))); }
  function ampelLos() { ampelSenden('LOS'); }
  function ampelRennende() { ampelSenden('ROT'); }
  function ampelGelb(an) { ampelSenden(an ? 'GELB' : 'GELB_AUS'); }
  function ampelFruehstartMelden() { if (raceState === 'countdown') ampelSenden('FRUEHSTART'); }

  ampelStatusZeigen();
