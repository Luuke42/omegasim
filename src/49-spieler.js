
  // ============================== SPIELERPLAETZE (v0.9.17) ==============================
  //
  // BESTELLT: "erweitere den 2-Spieler-Modus zum 3-Spieler-Modus" - und auf Nachfrage "sauber
  // verallgemeinern". Spieler 1 bleibt, wie er ist: er hat Wege, die nur er hat (Eingabe-
  // Abgleich mit Tastatur und Touch, Boxenstopp mit Minigame, Windschatten, Ideallinie). Alle
  // WEITEREN Spieler laufen ueber denselben Code, und der fragt den Spielerplatz:
  //
  //   zusatzPlatz(nr)    nr = 2 .. SPIELER_MAX; Fahrzeug, Eingabe, Motor, Tank, Schaden,
  //                      Boxenstopp, Abseits, Lampen, Belegung, Pad-Merker, Stimme ...
  //
  // PLATZ 2 IST DIE BISHERIGE ZWEI-SPIELER-TECHNIK: seine Felder sind Getter/Setter auf die
  // alten Namen (playerCar2, p2Steer, tankZwei, schadenZwei, boxZwei, ...). Rund 300 Stellen in
  // Testbank und Selbsttest setzen diese Namen direkt - sie bleiben damit gueltig, und jeder
  // verallgemeinerte Weg liest fuer Spieler 2 genau dieselben Daten wie vorher.
  //
  // PLATZ 3 hat eigene Felder in derselben Form. Erst beim ersten Aufruf gebaut (lazy), weil
  // Motorklasse und Zustandsobjekte in spaeteren Dateien stehen - ein Bau beim Laden waere die
  // temporale Todeszone.
  const SPIELER_MAX = 3;
  var zusatzCache = null;
  function zusatzPlatzNeu(nr) {
    let motor = null, belegung = null;
    return {
      nr,
      car: null, steer: 0, throttle: 0,
      outSteer: 0, outThrottle: 0, outBrake: 0,
      get motor() {
        if (!motor) {
          motor = new CarreraPhysicsEngine();
          motor.spieler = nr;
          if (typeof physEngine !== 'undefined') zusatzMotorAbgleichen(motor);
        }
        return motor;
      },
      lastTime: null, rumbleAt: 0, licht: true, flashBis: 0,
      // Die Tastenbelegung erst beim ersten Lesen aus dem Speicher (90-ghosts.js).
      get bindings() { if (!belegung) belegung = loadBindingsZusatz(nr); return belegung; },
      set bindings(v) { belegung = v; },
      regler: {},
      abseits: { seit: null, wiederSeit: null, aktiv: false, zaehler: 0 },
      tank: { stand: 100, cut: 1, letzterTick: null },
      schaden: { wert: 0, licht: { front: false, rear: false } },
      box: { lage: 'aus', standS: 0, getankt: 0, repariert: 0, fertig: false, tankFertig: false,
             reparaturFertig: false, letzterTick: null, gemeldet: false },
      reifen: 'mittel', mischungWunsch: null, tankZiel: 100,
      koLeben: 3, derbyHealth: 100, derbyKills: 0, derbyTot: false,
      prev: {},
      stimme: { master: null, pan: null, nodes: null, over: null, car: null },
      pan: 0,
    };
  }
  function zusatzPlatzZwei() {
    // Platz 2: alles ueber die bisherigen Namen.
    return {
      nr: 2,
      get car() { return playerCar2; }, set car(v) { playerCar2 = v; },
      get steer() { return p2Steer; }, set steer(v) { p2Steer = v; },
      get throttle() { return p2Throttle; }, set throttle(v) { p2Throttle = v; },
      get outSteer() { return physOut2Steer; }, set outSteer(v) { physOut2Steer = v; },
      get outThrottle() { return physOut2Throttle; }, set outThrottle(v) { physOut2Throttle = v; },
      get outBrake() { return physOut2Brake; }, set outBrake(v) { physOut2Brake = v; },
      get motor() { return physEngine2; },
      get lastTime() { return phys2LastTime; }, set lastTime(v) { phys2LastTime = v; },
      get rumbleAt() { return offtrack2RumbleAt; }, set rumbleAt(v) { offtrack2RumbleAt = v; },
      get licht() { return headlightsOn2; }, set licht(v) { headlightsOn2 = v; },
      get flashBis() { return flash2Until; }, set flashBis(v) { flash2Until = v; },
      get bindings() { return bindings2; }, set bindings(v) { bindings2 = v; },
      get regler() { return autopilotRegler2; },
      get abseits() { return abseitsZwei; },
      get tank() { return tankZwei; },
      get schaden() { return schadenZwei; },
      get box() { return boxZwei; },
      get reifen() { return tyres2; }, set reifen(v) { tyres2 = v; },
      get mischungWunsch() { return mischungWunsch2; }, set mischungWunsch(v) { mischungWunsch2 = v; },
      get tankZiel() { return tankZiel2; }, set tankZiel(v) { tankZiel2 = v; },
      get koLeben() { return knockoutLeben2; }, set koLeben(v) { knockoutLeben2 = v; },
      get derbyHealth() { return derbyHealth2; }, set derbyHealth(v) { derbyHealth2 = v; },
      get derbyKills() { return derbyKills2; }, set derbyKills(v) { derbyKills2 = v; },
      get derbyTot() { return derbyTot2; }, set derbyTot(v) { derbyTot2 = v; },
      prev: {},
      get stimme() { return stimmeZwei; },
      pan: 0.55,
    };
  }
  function zusatzPlatz(nr) {
    if (!zusatzCache) {
      zusatzCache = {};
      zusatzCache[2] = zusatzPlatzZwei();
      for (let n = 3; n <= SPIELER_MAX; n++) zusatzCache[n] = zusatzPlatzNeu(n);
    }
    return zusatzCache[nr] || null;
  }
  function zusatzPlaetze() {
    const l = [];
    for (let n = 2; n <= SPIELER_MAX; n++) l.push(zusatzPlatz(n));
    return l;
  }
  // Die Plaetze, die gerade ein Auto fahren (nur im Mehrspieler-Modus).
  function zusatzAktiv() {
    if (typeof zweiSpieler === 'undefined' || !zweiSpieler) return [];
    return zusatzPlaetze().filter((z) => z.car);
  }
  // Welcher Spieler faehrt dieses Auto? 1, 2, 3 ... oder 0 (Ghost/aus).
  function spielerNrVon(car) {
    if (!car) return 0;
    if (typeof playerCar !== 'undefined' && car === playerCar) return 1;
    for (const z of zusatzPlaetze()) if (z.car === car) return z.nr;
    return 0;
  }
  // Farbe je Spieler (Cockpit, Derby-Balken): 1 gruen, 2 orange, 3 blau.
  const SPIELER_FARBE = { 1: '#2ee06a', 2: '#ffb02e', 3: '#4db8ff' };
  // Stereoseite je Zusatzspieler: 2 rechts wie bisher (PAN_ZWEI), 3 links. Spieler 1 bleibt
  // bei zwei Spielern links; bei dreien teilen sich 1 und 3 die linke Seite nicht ganz.
  function spielerPan(nr) {
    if (nr === 2) return typeof PAN_ZWEI !== 'undefined' ? PAN_ZWEI : 0.55;
    if (nr === 3) return -0.25;
    return 0;
  }
  function motorVon(wer) { return wer >= 2 ? zusatzPlatz(wer).motor : physEngine; }
  function spielerRolle(nr) { return nr === 1 ? 'player' : 'player' + nr; }
  // Der Platz zu einer Garagenrolle ('player2', 'player3'), sonst null.
  function zusatzPlatzVonRolle(role) {
    const m = /^player([2-9])$/.exec(role || '');
    return m ? zusatzPlatz(Number(m[1])) : null;
  }
  // Tonhoehe des Rundengongs je Spieler: 2 wie bisher hoeher, 3 dazwischen.
  function spielerTonHoehe(nr) { return nr === 2 ? 1.5 : nr === 3 ? 1.25 : 1; }
  // Einstellungen von Auto 1 auf einen Zusatzmotor (dieselbe Regel wie physEngine2Abgleichen:
  // Werte kopieren, die Gangtabelle als eigene Objekte).
  function zusatzMotorAbgleichen(m) {
    Object.assign(m.config, physEngine.config);
    if (Array.isArray(physEngine.config.gears)) m.config.gears = physEngine.config.gears.map((g) => Object.assign({}, g));
  }
