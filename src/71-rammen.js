
  // ============================== CRASH-ARTEN UND RAMMEN (v0.9.21) ==============================
  //
  // BESTELLT: "Mache aus Bremsen beim Crash mehrere Funktionen":
  //   Schaden bei Crash      ja/nein (Vorgabe ja, Arcade nein)
  //   Bremsen bei Crash      ja/nein (Vorgabe ja)
  //   Kein Bremsen bei Auffahrunfall  ja/nein (Vorgabe ja): "wenn mir von hinten jemand drauf
  //                          faehrt, soll der bremsen, aber nicht ich. Laesst sich ueber Gyro
  //                          messen. Von hinten mit 45 Grad Toleranz."
  // und, experimentell in den Renneinstellungen: Pitstrafen fuer Rammer.
  //
  // DIE RICHTUNG DES STOSSES kommt aus den Bewegungsbytes 1 und 3, mit denen auch der Crash
  // erkannt wird (Abweichung vom gleitenden Mittel, siehe detectCrash). Welche Richtung von
  // Byte 1 "nach vorn" ist, ist nirgends bestaetigt - deshalb wird es GELERNT: beim normalen
  // Beschleunigen und Bremsen zeigt die Abweichung von Byte 1 mit bzw. gegen die
  // Tempoaenderung. Ein Stoss von hinten schiebt das Auto nach vorn, also in dieselbe Richtung
  // wie Gasgeben. Solange nicht genug gelernt ist, gilt kein Stoss als Auffahrunfall (es wird
  // gebremst wie bisher) - die sichere Seite.
  const CRASH_VOR_LERN_MIN = 40;         // so viel Beleg, bevor die Richtung gilt
  function crashSchalter(id, vorgabe) {
    const el = typeof $ === 'function' ? $(id) : null;
    return el ? !!el.checked : vorgabe;
  }
  function crashSchadenAn() { return crashSchalter('setting-crash-schaden', true); }
  function crashBremseAn() { return crashSchalter('setting-crash-bremse', true); }
  function crashAuffahrSchutzAn() { return crashBremseAn() && crashSchalter('setting-crash-auffahr', true); }

  // Lernschritt je Paket (aus detectCrash): d1 = Abweichung von Byte 1, dv = Tempoaenderung
  // des Modells seit dem letzten Paket (km/h), dev = Gesamtabweichung (kein Crash-Stoss).
  function crashVorLernen(L, d1, dv, dev) {
    if (L.vorSumme === undefined) L.vorSumme = 0;
    if (!(Math.abs(dv) > 0.02) || dev > crashThreshold * 0.8) return;
    const gewicht = Math.min(1, Math.abs(dv) / 0.2);
    L.vorSumme = L.vorSumme * 0.998 + Math.max(-20, Math.min(20, d1)) * Math.sign(dv) * gewicht;
  }
  // +1 / -1: welches Vorzeichen von Byte 1 "nach vorn geschoben" heisst; 0 = noch unbekannt.
  function crashVorZeichen(L) {
    if (!L || !(Math.abs(L.vorSumme || 0) >= CRASH_VOR_LERN_MIN)) return 0;
    return Math.sign(L.vorSumme);
  }
  // Auffahrunfall: der Stoss schiebt nach vorn, hoechstens 45 Grad zur Seite
  // (|quer| <= |laengs|). Ohne gelernte Richtung: nein.
  function crashVonHinten(L, d1, d3) {
    const vz = crashVorZeichen(L);
    if (!vz || !d1) return false;
    return Math.sign(d1) === vz && Math.abs(d3) <= Math.abs(d1);
  }

  // ---- RAMMEN: zwei Crashs zur selben Zeit ---------------------------------------------
  //
  // BESTELLT: "Wenn ein Auto rammt und gleichzeitig ein anderes gerammt wird, kann das
  // erkannt werden - anders, als wenn einfach ein Auto gegen die Wand faehrt." Ein Crash
  // allein ist die Wand. Zwei Crashs verschiedener Autos innerhalb von RAMM_FENSTER_MS sind
  // ein Treffer. Wer gerammt hat: wessen Stoss NICHT nach vorn ging, wenn einer der beiden
  // nach vorn geschoben wurde; sonst der Schnellere.
  const RAMM_FENSTER_MS = 400;
  let rammEreignisse = [];
  let rammStand = new Map();           // car -> { rams, offen (s), verbuesst (s) }
  function rammAb() { const el = $('race-ramm-ab'); return el ? (parseInt(el.value, 10) || 0) : 0; }
  function rammStrafeS() { const el = $('race-ramm-strafe'); return el ? (parseFloat(el.value) || 5) : 5; }
  function rammReset() { rammEreignisse = []; rammStand = new Map(); }
  function rammEintrag(car) {
    if (!rammStand.has(car)) rammStand.set(car, { rams: 0, offen: 0, verbuesst: 0 });
    return rammStand.get(car);
  }
  function rammStrafeOffen(car) { const e = car && rammStand.get(car); return e ? e.offen : 0; }
  function rammStrafeAbsitzen(car) {
    const e = car && rammStand.get(car);
    if (!e || !(e.offen > 0)) return 0;
    const s = e.offen;
    e.verbuesst += s; e.offen = 0;
    log(garageLabel(car) + ': Strafe ' + s + ' s abgesessen.', 'info');
    return s;
  }
  function rammTempo(car) {
    const nr = spielerNrVon(car);
    if (nr >= 1) {
      const m = motorVon(nr);
      return Math.abs(m.state.speedKmh) / Math.max(0.01, m.config.topSpeedKmh);
    }
    return car && car.ghost ? Math.abs(car.ghost.lastThrottle || 0) : 0;
  }
  // Ein Crash eines Autos. vorwaerts: true = nach vorn geschoben, false = nach hinten,
  // null = unbekannt.
  function crashEreignis(car, vorwaerts) {
    if (!car || raceState !== 'racing' || !(rammAb() > 0)) return null;
    const jetzt = Date.now();
    rammEreignisse = rammEreignisse.filter((e) => jetzt - e.at <= RAMM_FENSTER_MS);
    const anderer = rammEreignisse.find((e) => e.car !== car && !e.gepaart);
    const neu = { car, at: jetzt, vorwaerts, tempo: rammTempo(car), gepaart: false };
    rammEreignisse.push(neu);
    if (!anderer) return null;
    let rammer = null, opfer = null;
    if (neu.vorwaerts === true && anderer.vorwaerts !== true) { rammer = anderer; opfer = neu; }
    else if (anderer.vorwaerts === true && neu.vorwaerts !== true) { rammer = neu; opfer = anderer; }
    else if (Math.abs(neu.tempo - anderer.tempo) > 0.05) {
      rammer = neu.tempo > anderer.tempo ? neu : anderer;
      opfer = rammer === neu ? anderer : neu;
    }
    if (!rammer) return null;
    neu.gepaart = anderer.gepaart = true;
    rammZaehlen(rammer.car, opfer.car);
    return rammer.car;
  }
  function rammZaehlen(rammer, opfer) {
    const e = rammEintrag(rammer);
    e.rams += 1;
    log(garageLabel(rammer) + ' rammt ' + garageLabel(opfer) + ' (' + e.rams + '. Mal).', 'info');
    if (e.rams >= rammAb()) {
      e.rams = 0;
      e.offen += rammStrafeS();
      showHudToast(t('STRAFE') + ' ' + rammStrafeS() + ' s · ' + garageLabel(rammer));
      log(garageLabel(rammer) + ': ' + rammStrafeS() + ' s Strafe beim naechsten Boxenstopp.', 'err');
    }
  }
  // Die Bytes eines Ghosts (eigenes gleitendes Mittel, dieselbe Schwelle wie bei Spielern).
  function rammMessenGeist(car, bytes) {
    if (!car || !car.ghost || !car.ghost.running || car.ghost.pit) return;
    if (raceState !== 'racing' || !(rammAb() > 0)) return;
    const L = car.rammL || (car.rammL = { avg1: null, avg3: null, letzter: 0 });
    const v1 = s8signed(bytes[1]), v3 = s8signed(bytes[3]);
    if (L.avg1 === null) { L.avg1 = v1; L.avg3 = v3; return; }
    const dev = Math.abs(v1 - L.avg1) + Math.abs(v3 - L.avg3);
    L.avg1 += (v1 - L.avg1) * CRASH_ROLLING_ALPHA;
    L.avg3 += (v3 - L.avg3) * CRASH_ROLLING_ALPHA;
    const jetzt = Date.now();
    if (dev > crashThreshold && jetzt - L.letzter > CRASH_REFRACTORY_MS) {
      L.letzter = jetzt;
      crashEreignis(car, null);
    }
  }
  // Rotes Label im Rennergebnis: Strafe nicht abgesessen.
  function rammerLabel(car) {
    return rammStrafeOffen(car) > 0
      ? ' <span class="rammer-tag" title="Strafe nicht abgesessen">[' + t('RAMMER') + ']</span>' : '';
  }

  // ---- DERBY (v0.9.21): Licht und Leistung nach Health -----------------------------------
  //
  // BESTELLT: "ab 50 % Schaden Lichter flackern, ab 75 % Schaden Lichter aus und ruckelig
  // fahren (Beschleunigungsleistung wird in regelmaessigen Abstaenden von 500 ms etwas
  // gedrosselt)". Health ist 100 - Schaden.
  const DERBY_LICHT_AUS = { front: true, rear: true };
  const DERBY_LICHT_AN = { front: false, rear: false };
  function derbyHealthVon(car) {
    if (!car) return 100;
    const nr = spielerNrVon(car);
    if (nr === 1) return derbyHealth;
    if (nr >= 2) return zusatzPlatz(nr).derbyHealth;
    return car.ghost ? (car.ghost.derbyHealth === undefined ? DERBY_MAX : car.ghost.derbyHealth) : 100;
  }
  // null = kein Derby-Eingriff; sonst das Lichtschaden-Objekt fuer das Paket.
  function derbyLicht(car) {
    if (typeof derbyLaeuft === 'undefined' || !derbyLaeuft) return null;
    const h = derbyHealthVon(car);
    if (h <= 25) return DERBY_LICHT_AUS;
    if (h <= 50) {
      // Unregelmaessig wie ein Wackelkontakt: zwei ueberlagerte Takte.
      const ms = Date.now();
      return ((ms % 330) < 110) !== ((ms % 770) < 160) ? DERBY_LICHT_AUS : DERBY_LICHT_AN;
    }
    return null;
  }
  function derbyRuckeln(wer, gas) {
    if (typeof derbyLaeuft === 'undefined' || !derbyLaeuft || !(gas > 0)) return gas;
    const h = wer >= 2 ? zusatzPlatz(wer).derbyHealth : derbyHealth;
    if (h > 25) return gas;
    return (Date.now() % 500) < 160 ? gas * 0.55 : gas;
  }
  // Derby ohne Tank und Reifenverschleiss; nach dem Rennen kommt alles zurueck.
  let derbyMerk = null;
  function derbyEinstellungenAn() {
    if (derbyMerk) return;
    derbyMerk = { drain: fuelDrainPerSec, reifen: physEngine.config.tyreEffect };
    fuelDrainPerSec = 0;
    fuel = 100;
    for (const z of zusatzPlaetze()) tankFuellenVon(z, 100);
    physEngine.config.tyreEffect = 0;
    if (typeof physEngine2Abgleichen === 'function') physEngine2Abgleichen();
    log('Derby: Tank und Reifenverschleiss aus.', 'info');
  }
  function derbyEinstellungenZurueck() {
    if (!derbyMerk) return;
    fuelDrainPerSec = derbyMerk.drain;
    physEngine.config.tyreEffect = derbyMerk.reifen;
    if (typeof physEngine2Abgleichen === 'function') physEngine2Abgleichen();
    derbyMerk = null;
  }
