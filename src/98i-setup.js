  // ============================== SETUP JE AUTO (v1.4.33, WIP) ==============================
  //
  // BESTELLT: "In Garage einen Setup-Button, mit dem sich dann ein neues Fenster oeffnet fuer das
  // jeweilige Auto: Reifentyp und Tankmenge (jeweils mit Angabe, wie viele Runden sie auf der aktuellen
  // Strecke halten [wenn Carrera-Strecke im Editor ist]); auch auf Standard setzen. Wenn im Rennen
  // (z. B. Multiplayer) Fahrgefuehl festgelegt ist, dann auch Setup vereinheitlichen."
  // v1.4.54 BESTELLT: "Ja, weitere Setup-Einstellungen einbauen. Ladezeit ist ok, sollte aber das
  // Ladesymbol haben." Dazu Bremsbalance, ABS, TC, Motorkennfeld, Heckfluegel und Reifendruck.
  //
  // WAS ES IST: je Spielerauto (Spieler 1-3) eine Startmischung, eine Startfuellung und sechs
  // Fahrzeugwerte, gemerkt je Geraet (wie Rolle, Farbe, Selbstlenkung) unter chc.setup.v1 - das Praefix
  // chc. nimmt die Sicherung (98b-sicherung.js) von selbst mit. Ohne eigenes Setup bleibt alles wie
  // bisher: der Tank kommt aus der Renneinstellung "Starttank" (raceFuelStartL), die Reifen bleiben, was
  // montiert ist, und das Fahrzeug faehrt mit der Abstimmung seines Fahrgefuehls.
  //
  // WANN ES WIRKT: einmal je Fahrt-/Rennstart, in startRaceCountdown() direkt nach
  // raceStartZuruecksetzen() (70-race.js). Die Fahrzeugwerte werden dort in Faktoren umgerechnet und in
  // den Zustand des Motors dieses Spielers geschrieben (state.setup*, 40-physics.js). Im 45-ms-Takt
  // stehen nur diese Faktoren, jeder neutral (1 bzw. 0) ohne Setup: das Auto rechnet dann bitgleich.
  // Im Zustand und nicht in der Abstimmung (config), weil die Abstimmung von Spieler 1 auf die anderen
  // kopiert wird (physEngine2Abgleichen) - ein Setup von Spieler 1 waere sonst auch das von Spieler 2.
  //
  // VEREINHEITLICHT: Ist das Fahrgefuehl fuer alle vorgegeben (WLAN-Rennen mit erzwungenen
  // Renneinstellungen, Challenge, Meisterschaft mit festem Fahrgefuehl), faehrt jeder mit dem
  // Standard-Setup: Tank aus der Renneinstellung (im WLAN-Rennen die des Hosts, plan.tank), die
  // Standardmischung (mittel, bei Regenstart Regen) und alle Fahrzeugwerte neutral. Das Fenster zeigt
  // dann "Fuer dieses Rennen vorgegeben" und sperrt die Regler.
  //
  // DIE RUNDENANGABEN rechnen mit den Formeln, die auch im Rennen gelten, und erfinden nichts neu:
  //   Runde    chGoldFormel(chGeoGold(...)) aus 72-challenges.js: die an echten Zeiten kalibrierte
  //            "gute Runde" der Editor-Strecke (nur wenn sie geschlossen ist).
  //   Tank     fuelTankTick(): Stand - |Gas| x dt x fuelDrainPerSec x Kennfeld. Bei 85 % Gas (die
  //            Annahme von reifenStintProbe, 93-testbench.js) haelt eine Fuellung p % also
  //            p / (Verbrauch x 0,85 x Kennfeld) s.
  //   Reifen   der Verschleiss aus physicsStep (40-physics.js) - nicht nachgebaut, sondern GEFAHREN: ein
  //            eigener Motor mit der Abstimmung dieses Spielers (also seinem Fahrgefuehl), der Mischung
  //            (mischungAnwenden, wie applySurface im Rennen) und den Setup-Faktoren faehrt den Stint
  //            von reifenStintProbe (85 % Gas, wechselnder Einschlag, kalt gestartet), bis der Satz
  //            abgefahren ist. Kein Faktor-Dreisatz: abgenutzte Reifen greifen schlechter und arbeiten
  //            dann weniger, der Verlauf ist nicht linear.
  //            v1.4.54: in Haeppchen von hoechstens SETUP_SCHEIBE_MS gerechnet (MessageChannel, nicht
  //            setTimeout: im verborgenen Fenster ist der gedrosselt), mit dem drehenden Streckenteil
  //            als Ladesymbol; Ergebnisse je Abstimmung, Mischung und Setup gemerkt.
  //   Runden   abgerundet: Sekunden / Rundenzeit.

  const SETUP_STORE = 'chc.setup.v1';
  const SETUP_GAS = 0.85;              // wie reifenStintProbe: zuegige Fahrt
  const SETUP_TANK_SCHRITT = 5;        // Liter je Schritt am Regler
  const SETUP_TANK_MIN = 5;
  const SETUP_SCHEIBE_MS = 12;         // laengstes Rechenhaeppchen der Reifenfahrt
  const SETUP_REIFEN_MAX_S = 3600;
  let setupFensterAuto = null;         // das Auto, dessen Fenster offen ist
  let setupLaufVorgabe = null;         // Grund der Vereinheitlichung im laufenden Rennen
  let setupP1StartL = null;            // Starttank von Auto 1 aus seinem Setup (fuer die Tankbilanz)
  // Die Startfuellung von Auto 1 in Litern: aus dem Setup, sonst die Renneinstellung (raceFuelBilanz).
  function setupStartTankL() { return setupP1StartL !== null ? setupP1StartL : raceFuelStartL; }

  // ---- Die Fahrzeugwerte (v1.4.54) --------------------------------------------------------
  // Neutral heisst: so faehrt das Auto ohne Setup (40-physics.js, Zustandsfelder setup*).
  const SETUP_NEUTRAL = { setupBias: 0, setupAbs: -1, setupTc: 0, setupLeistung: 1, setupVmax: 1, setupDrag: 1,
                          setupAero: 0, setupBremsF: 1, setupDruck: 1, setupVerbrauch: 1 };
  // ABS-Stufe -> Anteil, um den die Bremse der Vorderachse weniger Lenkung nimmt (40-physics.js, absRest); in
  // Gran Hybrismo/Assetto Carrera bleibt beim Bremsen am Limit mindestens so viel Einschlag. Stufe 5 ist das
  // ABS-Gefuehl von Gran Hybrismo (granAbs 0,85); jede Stufe verlaengert den Bremsweg um 1,2 %.
  const SETUP_ABS_BODEN = [0, 0.25, 0.4, 0.55, 0.7, 0.85];
  // Motorkennfeld: Antrieb (accelScale), Hoechsttempo (Deckel) und Verbrauch. 2 ist die Abstimmung.
  // Das Hoechsttempo kann nur sinken: es ist der Deckel des Gasbytes (Ausgabe = Tempo / Hoechsttempo).
  const SETUP_KENNFELD = { 1: { leistung: 0.92, vmax: 0.97, verbrauch: 0.85 },
                           2: { leistung: 1, vmax: 1, verbrauch: 1 },
                           3: { leistung: 1.08, vmax: 1, verbrauch: 1.2 } };
  function setupMotorCfg(nr) { const m = motorVon(nr || 1); return m ? m.config : physEngine.config; }
  // Rechnet dieser Spieler mit Physik? Ohne (RC) wirkt kein Fahrzeugwert.
  function setupPhysikAn(nr) {
    if (!nr || nr <= 1) return !!physicsEnabled;
    const z = zusatzPlatz(nr);
    return z ? !!spielerPhysikAn(z) : !!physicsEnabled;
  }
  const SETUP_FELDER = [
    { id: 'bias', titel: 'Bremsbalance', min: 50, max: 66, schritt: 1,
      erkl: 'Anteil der Bremskraft vorn. Mehr vorn: stabiler beim Bremsen, das Auto schiebt eher über die Vorderräder. Mehr hinten: die Vorderachse behält beim Bremsen mehr Lenkung, das Auto dreht ein und das Heck wird leichter. Standard: der Wert aus der Abstimmung des Fahrgefühls.',
      std: (nr) => Math.round(setupMotorCfg(nr).brakeBias * 100),
      wert: (v) => v + ' % ' + t('vorn'),
      kenn: (v, s) => (v > s ? 'stabiler beim Bremsen, mehr Untersteuern' : v < s ? 'dreht beim Bremsen ein, Heck leichter' : 'wie die Abstimmung'),
      wirkt: (cfg, phys) => phys && !cfg.lenkKopplungAus },
    { id: 'abs', titel: 'ABS', min: 0, max: 5, schritt: 1,
      erkl: 'Wie viel Lenkung beim harten Bremsen bleibt. Jede Stufe hält mehr Lenkung, der Bremsweg wird dafür etwas länger. 0 ist aus. Standard: wie das Fahrgefühl (Gran Hybrismo hat Stufe 5, die anderen keins).',
      std: (nr) => {
        const cfg = setupMotorCfg(nr);
        const g = cfg.gran ? cfg.granAbs : 0;
        let best = 0;
        SETUP_ABS_BODEN.forEach((b, i) => { if (Math.abs(b - g) < Math.abs(SETUP_ABS_BODEN[best] - g)) best = i; });
        return best;
      },
      wert: (v) => (v === 0 ? t('aus') : String(v)),
      kenn: (v) => (v === 0 ? 'keine Hilfe, kürzester Bremsweg' : '+ Lenkung beim Bremsen, − etwas längerer Bremsweg'),
      wirkt: (cfg, phys) => phys && (!cfg.lenkKopplungAus || !!cfg.gran) },
    { id: 'tc', titel: 'TC', min: 0, max: 5, schritt: 1,
      erkl: 'Traktionskontrolle: fängt das Heck ab, das unter viel Gas am Kurvenausgang kommt. Jede Stufe nimmt mehr vom Leistungsübersteuern weg. Wirkt nur, wo das Heck überhaupt kommt: Pacejka mit eingeschaltetem Übersteuern, Assetto Carrera. Standard: aus.',
      std: () => 0,
      wert: (v) => (v === 0 ? t('aus') : String(v)),
      kenn: (v) => (v === 0 ? 'Heck kommt unter Gas frei' : '+ weniger Heck am Kurvenausgang'),
      wirkt: (cfg, phys) => phys && !!cfg.pacejka && (!!cfg.pacejkaUebersteuern || cfg.granHeck > 0) },
    { id: 'map', titel: 'Motorkennfeld', min: 1, max: 3, schritt: 1,
      erkl: 'Leistung gegen Verbrauch. 1 spart: 8 % weniger Antrieb, 3 % weniger Höchsttempo, 85 % Verbrauch. 2 ist die Abstimmung. 3 drückt: 8 % mehr Antrieb, 120 % Verbrauch (das Höchsttempo bleibt, es ist der Deckel des Autos). Die Rundenangabe beim Tank rechnet mit.',
      std: () => 2,
      wert: (v) => v + ' · ' + t(['Sparen', 'Standard', 'Leistung'][v - 1]),
      kenn: (v) => (v === 1 ? '− Beschleunigung, − Höchsttempo, Verbrauch 85 %'
        : v === 3 ? '+ Beschleunigung, Verbrauch 120 %' : 'ausgewogen'),
      wirkt: (cfg, phys) => phys },
    { id: 'wing', titel: 'Heckflügel', min: 0, max: 10, schritt: 1,
      erkl: 'Abtrieb gegen Höchsttempo. Jede Stufe gibt bei Tempo mehr Kurvengrip (er wächst mit dem Quadrat des Tempos) und kostet Höchsttempo (Stufe 10: 6 %) und etwas Luftwiderstand. 0 ist der Abtrieb der Abstimmung.',
      std: () => 0,
      wert: (v) => String(v),
      kenn: (v) => (v === 0 ? 'Abtrieb der Abstimmung' : '+ Kurvengrip bei Tempo, − Höchsttempo'),
      wirkt: (cfg, phys) => phys },
    { id: 'druck', titel: 'Reifendruck (kalt)', min: 20.0, max: 22.0, schritt: 0.1,
      erkl: 'Kaltdruck. Weniger Druck: die Reifen werden schneller warm und greifen kalt besser, verschleißen aber schneller. Mehr Druck: langsamer warm, weniger Verschleiß. 21,0 psi ist der Bezugsdruck der Abstimmung. Wirkt nur mit Reifensimulation.',
      std: () => 21.0,
      wert: (v) => setupZahl(v, 1) + ' psi',
      kenn: (v, s) => (v < s ? 'wärmt schneller auf, mehr Verschleiß' : v > s ? 'wärmt langsamer auf, weniger Verschleiß' : 'Bezugsdruck'),
      wirkt: (cfg, phys) => phys && cfg.tyreEffect > 0 },
  ];
  const SETUP_FELD = {};
  SETUP_FELDER.forEach((f) => { SETUP_FELD[f.id] = f; });
  function setupFeldRund(f, v) {
    const x = Math.round(v / f.schritt) * f.schritt;
    return +Math.max(f.min, Math.min(f.max, x)).toFixed(f.schritt < 1 ? 1 : 0);
  }
  // cfg/phys (Pruefstand): eine andere Abstimmung bzw. Physik an/aus statt der des Spielers.
  function setupWirkt(id, nr, cfg, phys) {
    return !!SETUP_FELD[id].wirkt(cfg || setupMotorCfg(nr), phys === undefined ? setupPhysikAn(nr) : phys);
  }
  // Die Faktoren fuer den Motor (state.setup*). Nur Werte, die im Fahrgefuehl dieses Spielers wirken.
  function setupFaktoren(nr, s, cfg, phys) {
    const o = Object.assign({}, SETUP_NEUTRAL);
    if (!s) return o;
    const w = (id) => s[id] !== undefined && s[id] !== null && setupWirkt(id, nr, cfg, phys);
    if (w('bias')) o.setupBias = s.bias / 100;
    if (w('abs')) { o.setupAbs = SETUP_ABS_BODEN[s.abs]; o.setupBremsF = 1 - 0.012 * s.abs; }
    if (w('tc')) o.setupTc = s.tc / 5;
    if (w('map')) {
      const k = SETUP_KENNFELD[s.map];
      o.setupLeistung = k.leistung; o.setupVmax = k.vmax; o.setupVerbrauch = k.verbrauch;
    }
    if (w('wing')) { o.setupAero = 0.05 * s.wing; o.setupDrag = 1 + 0.04 * s.wing; o.setupVmax *= 1 - 0.006 * s.wing; }
    if (w('druck')) o.setupDruck = 1 + (s.druck - 21) * 0.1;
    return o;
  }
  function setupMotorSetzen(motor, f) { if (motor && motor.state) Object.assign(motor.state, f); }

  function setupAlle() {
    try { return JSON.parse(localStorage.getItem(SETUP_STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function setupSchluessel(car) { return car && car.device ? String(car.device.id) : null; }
  // Das eigene Setup eines Autos: { mix, tankL, bias, abs, tc, map, wing, druck } (alles optional) oder null.
  function setupVon(car) {
    const k = setupSchluessel(car);
    if (!k) return null;
    const e = setupAlle()[k];
    if (!e) return null;
    const s = {};
    if (MISCHUNG_FOLGE.indexOf(e.mix) >= 0) s.mix = e.mix;
    if (Number.isFinite(e.tankL)) s.tankL = Math.max(SETUP_TANK_MIN, Math.min(FUEL_TANK_LITERS, e.tankL));
    SETUP_FELDER.forEach((f) => { if (Number.isFinite(e[f.id])) s[f.id] = setupFeldRund(f, e[f.id]); });
    return Object.keys(s).length ? s : null;
  }
  function setupSpeichern(car, s) {
    const k = setupSchluessel(car);
    if (!k) return;
    const alle = setupAlle();
    const e = {};
    if (s) {
      if (s.mix) e.mix = s.mix;
      if (Number.isFinite(s.tankL)) e.tankL = s.tankL;
      SETUP_FELDER.forEach((f) => { if (Number.isFinite(s[f.id])) e[f.id] = s[f.id]; });
    }
    if (Object.keys(e).length) alle[k] = e;
    else delete alle[k];
    try { localStorage.setItem(SETUP_STORE, JSON.stringify(alle)); } catch (e2) { /* voll/privat */ }
    if (typeof lageZeichnen === 'function') lageZeichnen();
  }
  function setupStandard(car) { setupSpeichern(car, null); }

  // Welcher Spieler faehrt dieses Auto laut Garagenrolle (1-3), sonst 0.
  function setupSpielerNr(car) {
    if (!car) return 0;
    if (car.role === 'player') return 1;
    const m = /^player([2-9])$/.exec(car.role || '');
    return m ? Number(m[1]) : 0;
  }
  function setupStandardMix() { return raceWxStart === 'rain' ? 'regen' : 'mittel'; }
  // Die montierte Mischung eines Spielers (Standard ohne eigenes Setup: sie bleibt).
  function setupMontiert(nr) {
    if (nr <= 1) return tyres;
    const z = zusatzPlatz(nr);
    return (z && z.reifen) || 'mittel';
  }

  // ---- Ist das Setup fuer dieses Rennen vorgegeben? ------------------------------------
  // plan: der Startplan eines WLAN-Rennens (startRaceCountdown). Ohne plan (Fenster in der Garage)
  // gilt der Grund des laufenden Rennens weiter.
  function setupVorgabeGrund(plan) {
    if (plan && plan.preset) return 'mp';
    if (typeof challengeLaeuft === 'function' && challengeLaeuft()) return 'challenge';
    if (typeof meisterMpPreset === 'function') {
      try { if (meisterMpPreset()) return 'meister'; } catch (e) { /* ohne Meisterschaft */ }
    }
    if (!plan && setupLaufVorgabe && ['countdown', 'racing', 'finishing'].indexOf(raceState) >= 0) return setupLaufVorgabe;
    return null;
  }
  function setupGrundText(g) {
    return g === 'mp' ? t('WLAN-Rennen') : g === 'challenge' ? t('Challenge') : g === 'meister' ? t('Meisterschaft') : '';
  }

  // ---- Wirkung beim Start ----------------------------------------------------------------
  // Aus startRaceCountdown() (70-race.js), nach raceStartZuruecksetzen(): der Tank ist dort fuer alle auf
  // die Renneinstellung gesetzt; hier ueberschreibt das Setup je Auto. Rueckgabe fuer den Selbsttest.
  function setupRennstart(plan) {
    const grund = setupVorgabeGrund(plan || null);
    setupLaufVorgabe = grund;
    setupP1StartL = null;
    const out = { grund, spieler: [] };
    // Erst alle Spielermotoren neutral: ein Setup aus dem letzten Rennen gilt nicht weiter.
    setupMotorSetzen(physEngine, SETUP_NEUTRAL);
    zusatzPlaetze().forEach((z) => { if (z.nr === 2 || z.car) setupMotorSetzen(z.motor, SETUP_NEUTRAL); });
    const plaetze = [{ nr: 1, car: typeof playerCar !== 'undefined' ? playerCar : null }];
    if (typeof zusatzAktiv === 'function') zusatzAktiv().forEach((z) => plaetze.push({ nr: z.nr, car: z.car }));
    let surface = false;
    for (const p of plaetze) {
      if (!p.car) continue;
      let mix = null, tankL = null, s = null;
      if (grund) mix = setupStandardMix();
      else {
        s = setupVon(p.car);
        if (!s) continue;
        mix = s.mix || null;
        tankL = s.tankL || null;
      }
      if (mix) mix = mischungErlaubt(mix);
      if (tankL) {
        const pct = Math.max(0, Math.min(100, tankL / FUEL_TANK_LITERS * 100));
        if (p.nr === 1) { fuel = pct; setupP1StartL = tankL; } else tankFuellenVon(zusatzPlatz(p.nr), pct);
      }
      if (mix) {
        if (p.nr === 1) { if (tyres !== mix) { tyres = mix; surface = true; } }
        else {
          const z = zusatzPlatz(p.nr);
          if (z.reifen !== mix) {
            z.reifen = mix;
            if (p.nr === 2) surface = true;
            else mischungAnwenden(z.motor, mix, wxRainLevel() * wxRainLevel());
          }
          z.mischungWunsch = null;
        }
        if (p.nr === 1) mischungWunsch = null;
      }
      const fk = setupFaktoren(p.nr, s);
      setupMotorSetzen(motorVon(p.nr), fk);
      out.spieler.push({ nr: p.nr, mix, tankL, faktoren: fk });
    }
    if (surface) applySurface();
    if (grund) log('Setup: fuer dieses Rennen vorgegeben (' + grund + '), alle mit Standard.', 'info');
    else if (out.spieler.length) {
      log('Setup je Auto: ' + out.spieler.map((x) => 'P' + x.nr + (x.mix ? ' ' + x.mix : '')
        + (x.tankL ? ' ' + x.tankL + ' l' : '')).join(', '), 'info');
    }
    return out;
  }

  // ---- Rundenangaben ----------------------------------------------------------------------
  // Rundenzeit (s) der geschlossenen Editor-Strecke, sonst null.
  function setupRundeS(tiles) {
    const tl = tiles || currentTrackTiles;
    if (!tl || tl.length < 3) return null;
    let zu = false;
    try { zu = !!trackSchluss(trackCenterline(tl)).closed; } catch (e) { zu = false; }
    if (!zu) return null;
    let ms = 0;
    try { ms = chGoldFormel(chGeoGold({ code: trackToCode(tl, 0) })); } catch (e) { ms = 0; }
    return ms > 0 ? ms / 1000 : null;
  }

  // Die Reifenfahrt: ein eigener Motor mit Abstimmung, Mischung und Setup-Faktoren faehrt, bis der Satz
  // abgefahren ist (Mittel aller vier Raeder = 1). Gemessen: weich 58 s, mittel 139 s, hart 1170 s Fahrt
  // kosten zusammen rund 0,1 s Rechnung - darum in Haeppchen (siehe setupReifenScheibe).
  const setupReifenCache = {};
  const setupReifenWarte = [];
  const setupLadeStat = { laeuft: false, maxMs: 0, scheiben: 0, zuletzt: 0, fehler: null };
  function setupReifenAuftrag(nr, mix, f) {
    const motor = motorVon(nr || 1);
    const cfg = motor && motor.config;
    if (!cfg || !(cfg.tyreEffect > 0) || !(cfg.tyreWearRate > 0)) return { aus: true };
    const nass = raceWxStart === 'rain' ? 1 : 0;
    const json = JSON.stringify(cfg);
    const key = nr + '|' + mix + '|' + nass + '|' + mischungStaerke() + '|' + JSON.stringify(f || SETUP_NEUTRAL);
    return { key, json, nr, mix, nass, f: f || SETUP_NEUTRAL };
  }
  function setupReifenSimNeu(a) {
    const e = new CarreraPhysicsEngine();
    e.spieler = a.nr;
    Object.assign(e.config, JSON.parse(a.json));
    // Griff, Aufschwimmen und Verschleissfaktor der Mischung wie im Rennen (applySurface).
    mischungAnwenden(e, a.mix, a.nass);
    const st = e.state;
    Object.assign(st, a.f);
    for (let i = 0; i < 4; i++) { st.tyreWear4[i] = 0; st.tyreTemp4[i] = e.config.tyreAmbientC; }
    st.tyreWear = 0; st.tyreWearL = 0; st.tyreWearR = 0; st.tyreTempC = e.config.tyreAmbientC;
    st.speedKmh = 0; st.virtualSpeed = 0; st.driveMode = 'forward';
    st.fuelLoad = 1;
    return { a, e, tSec: 0, dt: CONTROL_SEND_INTERVAL_MS / 1000 };
  }
  // n Schritte weiterfahren; true = fertig (abgefahren oder Deckel erreicht).
  function setupReifenSchritte(sim, n) {
    const e = sim.e, st = e.state;
    for (let i = 0; i < n; i++) {
      if (sim.tSec >= SETUP_REIFEN_MAX_S || st.tyreWear >= 0.999) return true;
      e.update({ steering: Math.sin(sim.tSec * 1.1) * 0.55, throttle: SETUP_GAS, brake: 0, headlights: false }, sim.dt);
      sim.tSec += sim.dt;
    }
    return sim.tSec >= SETUP_REIFEN_MAX_S || st.tyreWear >= 0.999;
  }
  function setupReifenErgebnis(sim) {
    const erg = { sek: sim.tSec, mehr: sim.e.state.tyreWear < 0.999 };
    setupReifenCache[sim.a.key] = { json: sim.a.json, erg };
    return erg;
  }
  function setupReifenGemerkt(a) {
    const c = setupReifenCache[a.key];
    return c && c.json === a.json ? c.erg : null;
  }
  // Sofort und ganz (Pruefstand, Selbsttest). Im Fenster nie: dort setupReifenSek.
  function setupReifenSofort(nr, mix, f) {
    const a = setupReifenAuftrag(nr, mix, f);
    if (a.aus) return { sek: 0 };
    const g = setupReifenGemerkt(a);
    if (g) return g;
    const sim = setupReifenSimNeu(a);
    while (!setupReifenSchritte(sim, 500)) { /* weiter */ }
    return setupReifenErgebnis(sim);
  }
  // Fuer das Fenster: gemerkt -> Ergebnis; Simulation aus -> { sek: 0 }; sonst null und die Fahrt wird
  // in Haeppchen nachgerechnet (Ladesymbol, danach zeichnet sich das Fenster neu).
  let setupReifenLauf = null;
  const setupKanal = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  function setupWeiter() {
    if (setupKanal) setupKanal.port2.postMessage(0); else setTimeout(setupReifenScheibe, 0);
  }
  if (setupKanal) setupKanal.port1.onmessage = () => setupReifenScheibe();
  function setupReifenSek(nr, mix, f) {
    const a = setupReifenAuftrag(nr, mix, f);
    if (a.aus) return { sek: 0 };
    const g = setupReifenGemerkt(a);
    if (g) return g;
    const schon = (setupReifenLauf && setupReifenLauf.a.key === a.key) || setupReifenWarte.some((x) => x.key === a.key);
    if (!schon) setupReifenWarte.push(a);
    // Laeuft nichts (oder ist seit 1 s kein Haeppchen gekommen), neu anstossen.
    if (!setupLadeStat.laeuft || performance.now() - setupLadeStat.zuletzt > 1000) {
      setupLadeStat.laeuft = true; setupLadeStat.zuletzt = performance.now(); setupWeiter();
    }
    return null;
  }
  function setupReifenScheibe() {
    const t0 = performance.now();
    setupLadeStat.zuletzt = t0;
    try {
      while (performance.now() - t0 < SETUP_SCHEIBE_MS) {
        if (!setupReifenLauf) {
          let a = setupReifenWarte.shift();
          while (a && setupReifenGemerkt(a)) a = setupReifenWarte.shift();
          if (!a) break;
          setupReifenLauf = setupReifenSimNeu(a);
        }
        if (setupReifenSchritte(setupReifenLauf, 40)) {
          setupReifenErgebnis(setupReifenLauf);
          setupReifenLauf = null;
        }
      }
    } catch (e) {
      // Eine Fahrt, die wirft, faellt weg (sonst haengt das Ladesymbol fuer immer).
      setupLadeStat.fehler = e && e.message;
      log('Setup: Reifenfahrt abgebrochen: ' + setupLadeStat.fehler, 'warn');
      setupReifenLauf = null;
    }
    const ms = performance.now() - t0;
    setupLadeStat.scheiben++;
    if (ms > setupLadeStat.maxMs) setupLadeStat.maxMs = ms;
    if (setupReifenLauf || setupReifenWarte.length) { setupWeiter(); return; }
    setupLadeStat.laeuft = false;
    if (setupFensterOffen()) setupZeichnen();
  }

  // Laufende und wartende Reifenfahrten verwerfen (Selbsttest-Aufraeumen: sonst rechnet sie zwischen den
  // folgenden Tests weiter und stoert deren Zeitmessung).
  function setupReifenAbbrechen() {
    setupReifenWarte.length = 0;
    setupReifenLauf = null;
    setupLadeStat.laeuft = false;
  }
  // { reifen, tank }: je { runden, sek } oder { aus: true } (Simulation aus) oder { laedt: true };
  // runden null = keine Strecke. f: die Setup-Faktoren (Kennfeld fuer den Verbrauch, Rest fuer die Reifen).
  function setupRunden(nr, mix, tankL, rundeS, f, sofort) {
    const runde = rundeS === undefined ? setupRundeS() : rundeS;
    const fk = f || SETUP_NEUTRAL;
    const out = { rundeS: runde, reifen: null, tank: null };
    const r = sofort ? setupReifenSofort(nr, mix, fk) : setupReifenSek(nr, mix, fk);
    if (r === null) out.reifen = { laedt: true };
    else if (!(r.sek > 0)) out.reifen = { aus: true };
    else out.reifen = { sek: r.sek, mehr: r.mehr, runden: runde ? Math.floor(r.sek / runde) : null };
    if (!(fuelDrainPerSec > 0)) out.tank = { aus: true };
    else {
      const sek = (tankL / FUEL_TANK_LITERS * 100) / (fuelDrainPerSec * SETUP_GAS * (fk.setupVerbrauch || 1));
      out.tank = { sek, runden: runde ? Math.floor(sek / runde) : null };
    }
    return out;
  }
  function setupRundenText(x) {
    if (x && x.laedt) return t('wird berechnet');
    if (!x || x.aus) return t('Simulation aus');
    if (x.runden === null || x.runden === undefined) return '';
    return t(x.mehr ? 'über {n} Runden' : 'ca. {n} Runden').replace('{n}', x.runden);
  }
  function setupZahl(x, n) {
    const s = x.toFixed(n);
    return lang === 'en' ? s : s.replace('.', ',');
  }

  // ---- Das Fenster --------------------------------------------------------------------------
  const setupStil = document.createElement('style');
  setupStil.textContent = `
    .setup-fenster .k-pause-dialog { width: min(560px, 94vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box; }
    .setup-fenster .setup-kopf { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .setup-fenster .setup-kopf .wip-tag { font-size: 9px; }
    .setup-fenster .setup-strecke { margin: 0 0 4px; font-size: 13px; }
    .setup-fenster .setup-ladezeile { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 13px; color: var(--muted); }
    .setup-fenster .setup-ladezeile[hidden] { display: none; }
    .setup-fenster .setup-ladezeile .lade-dreh { width: 26px; height: 26px; }
    .setup-fenster .setup-vorgabe { margin: 0 0 4px; padding: 4px 10px; font-size: 13px; border-left: 3px solid var(--warn);
      background: rgba(255,180,0,.08); color: #f3d9a0; }
    .setup-fenster .setup-vorgabe[hidden] { display: none; }
    .setup-fenster .gk-zeile { font-size: 15px; }
    .setup-fenster .gk-zeile .gk-l { letter-spacing: .08em; text-transform: uppercase; font-size: 13px; }
    .setup-fenster .gk-w > b { width: auto; min-width: 9em; text-align: center; }
    .setup-fenster .gk-w > button { font-size: 17px; }
    .setup-fenster .setup-wert-r { display: block; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .04em; }
    .setup-fenster .setup-misch { display: inline-block; width: .8em; height: .8em; border-radius: 50%; margin-right: 6px;
      vertical-align: -1px; border: 1px solid rgba(255,255,255,.5); }
    .setup-fenster .setup-tank-regler { grid-column: 1 / -1; width: 100%; margin: 2px 0 4px; accent-color: var(--k-blau); }
    .setup-fenster .opt-row.menu-nav-sel { outline: 2px solid #fff; outline-offset: -2px; }
    .setup-fenster.gesperrt .gk-zeile, .setup-fenster .gk-zeile.setup-aus { opacity: .55; }
    .setup-fenster .setup-knoepfe { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .setup-fenster .k-pause-dialog .opt-info-btn { width: 16px; height: 16px; min-height: 16px; padding: 0; margin-left: 6px;
      text-align: center; justify-content: center; border: 1px solid var(--border); border-radius: 50%; background: var(--panel);
      color: var(--muted); font: italic 11px/1 Georgia, serif; letter-spacing: 0; text-transform: none; }
    .setup-fenster .k-pause-dialog .opt-info-btn:hover { color: var(--ink); border-color: var(--muted); background: var(--panel); }
    .setup-fenster .k-pause-dialog p.setup-strecke, .setup-fenster .k-pause-dialog p.setup-vorgabe:not([hidden]) { display: block; }
    .gar-a-setup .wip-tag { margin-left: 6px; font-size: 9px; vertical-align: 1px; }
    /* v1.4.54: acht Zeilen. Ab 700 px zwei Spalten, die erste fuellt sich zuerst (Steuerkreuz runter = Spalte). */
    @media (min-width: 700px) {
      .setup-fenster .k-pause-dialog { width: min(1000px, 96vw); }
      .setup-fenster .setup-zeilen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-auto-flow: column; grid-template-rows: repeat(4, auto); column-gap: 18px; }
      .setup-fenster .setup-knoepfe { flex-direction: row; }
      .setup-fenster .setup-knoepfe .opt-row { flex: 1; }
      .setup-fenster .setup-knoepfe button { width: 100%; }
    }
    @media (max-height: 420px) {
      .setup-fenster .k-pause-dialog { padding: 6px 12px 8px; gap: 2px; max-height: 98vh; }
      .setup-fenster .k-pause-dialog h2 { font-size: 14px; margin: 0; }
      .setup-fenster .setup-strecke, .setup-fenster .setup-vorgabe, .setup-fenster .setup-ladezeile { font-size: 11px; margin: 0; }
      .setup-fenster .setup-ladezeile .lade-dreh { width: 18px; height: 18px; }
      .setup-fenster .k-pause-dialog button { padding: 4px 12px; font-size: 13px; }
      .setup-fenster .gk-zeile { padding: 0 4px; font-size: 13px; }
      .setup-fenster .gk-zeile .gk-l { font-size: 11px; }
      .setup-fenster .gk-w > button { font-size: 14px; padding: 0 4px; }
      .setup-fenster .setup-wert-r { font-size: 10.5px; }
      .setup-fenster .setup-tank-regler { margin: 0; height: 14px; }
      .setup-fenster .setup-knoepfe { flex-direction: row; margin-top: 2px; }
      .setup-fenster .setup-knoepfe .opt-row { flex: 1; }
      .setup-fenster .setup-knoepfe button { width: 100%; }
    }
  `;
  document.head.appendChild(setupStil);
  const setupFenster = document.createElement('div');
  setupFenster.className = 'k-pause setup-fenster';
  setupFenster.id = 'setup-fenster';
  setupFenster.hidden = true;
  setupFenster.setAttribute('data-i18n-skip', '');
  setupFenster.setAttribute('role', 'dialog');
  setupFenster.setAttribute('aria-modal', 'true');
  setupFenster.innerHTML = '<div class="k-pause-dialog" id="setup-dialog"></div>';
  document.body.appendChild(setupFenster);
  // Ein Tipp neben das Fenster schliesst es (wie Kreis/Esc).
  setupFenster.addEventListener('click', (e) => { if (e.target === setupFenster) setupSchliessen(); });

  function setupFensterOffen() { return !setupFenster.hidden; }
  function setupOeffnen(car) {
    if (!car || !setupSpielerNr(car)) return false;
    setupFensterAuto = car;
    setupFenster.hidden = false;
    setupZeichnen();
    if (typeof menuNavEnsureContext === 'function') {
      menuNavEnsureContext();
      menuNavIndex = 0; menuNavGezeigt = true; menuNavArmed = false;
      menuNavRender();
    }
    return true;
  }
  function setupSchliessen() {
    if (setupFenster.hidden) return false;
    setupFenster.hidden = true;
    setupFensterAuto = null;
    if (typeof renderGarage === 'function') renderGarage();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavRender(); }
    return true;
  }

  // Eine Wertzeile im Stil der Garage (garWertZeile), dazu die Erklaerung als <small> in .opt-label.
  function setupWertZeile(klasse, titel, erkl, wertHtml, zurueck, vor) {
    const z = garWertZeile(titel, '', zurueck, vor);
    z.classList.add(klasse);
    const l = z.querySelector('.gk-l');
    l.classList.add('opt-label');
    const sm = document.createElement('small');
    sm.textContent = erkl;
    l.appendChild(sm);
    z.querySelector('b').innerHTML = wertHtml;
    return z;
  }

  function setupZeichnen() {
    const car = setupFensterAuto;
    const d = $('setup-dialog');
    if (!car || !d) return;
    if (garage.indexOf(car) < 0 || !setupSpielerNr(car)) { setupSchliessen(); return; }
    const nr = setupSpielerNr(car);
    const grund = setupVorgabeGrund(null);
    const eigen = (grund ? null : setupVon(car)) || {};
    const montiert = setupMontiert(nr);
    const mix = grund ? setupStandardMix() : (eigen.mix || montiert);
    const tankL = grund ? raceFuelStartL : (eigen.tankL || raceFuelStartL);
    const fk = setupFaktoren(nr, grund ? null : eigen);
    const rundeS = setupRundeS();
    const rd = setupRunden(nr, mix, tankL, rundeS, fk);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const zweite = (txt) => (txt ? '<span class="setup-wert-r">' + esc(txt) + '</span>' : '');
    setupFenster.classList.toggle('gesperrt', !!grund);
    // Scrollstand halten: das Fenster zeichnet sich nach jeder Aenderung und nach der Reifenfahrt neu.
    const scroll = d.scrollTop;
    d.innerHTML = '';
    const h = document.createElement('h2');
    h.className = 'setup-kopf';
    h.innerHTML = esc(t('Setup')) + ' &middot; <span>' + esc(car.alias || car.tag || garageLabel(car)) + '</span>'
      + ' <span class="wip-tag">WIP</span>';
    d.appendChild(h);
    const p = document.createElement('p');
    p.className = 'muted setup-strecke';
    const tiles = currentTrackTiles || [];
    p.textContent = rundeS
      ? t('Strecke im Editor: {m} m, gute Runde ca. {s} s').replace('{m}', setupZahl(trackLaengeM(tiles), 2))
        .replace('{s}', setupZahl(rundeS, 1))
      : t('Ohne geschlossene Carrera-Strecke im Editor keine Rundenangabe.');
    d.appendChild(p);
    // Ladesymbol: das drehende Streckenteil (59-lade.js), solange die Reifenfahrt rechnet.
    const lz = document.createElement('div');
    lz.className = 'setup-ladezeile';
    lz.setAttribute('role', 'status');
    lz.hidden = !(rd.reifen && rd.reifen.laedt);
    if (!lz.hidden) lz.innerHTML = ladeAnimationHtml('') + '<span>' + esc(t('Rundenangaben werden berechnet')) + '</span>';
    d.appendChild(lz);
    const v = document.createElement('p');
    v.className = 'setup-vorgabe';
    v.hidden = !grund && !(typeof mp !== 'undefined' && mp.an);
    v.textContent = grund
      ? t('Für dieses Rennen vorgegeben') + ' (' + setupGrundText(grund) + '): ' + t('alle fahren mit Standard.')
      : t('Im WLAN-Rennen mit erzwungenen Renneinstellungen fahren alle mit Standard.');
    d.appendChild(v);
    const zeilen = document.createElement('div');
    zeilen.className = 'setup-zeilen';
    const std = (eigenWert) => (grund || eigenWert === undefined || eigenWert === null ? ' &middot; ' + esc(t('Standard')) : '');
    // Reifentyp
    const mixWahl = (dd) => {
      if (setupVorgabeGrund(null)) return;
      const jetzt = (setupVon(car) || {}).mix || setupMontiert(nr);
      const i = MISCHUNG_FOLGE.indexOf(jetzt);
      const neu = MISCHUNG_FOLGE[((i < 0 ? 1 : i) + dd + MISCHUNG_FOLGE.length) % MISCHUNG_FOLGE.length];
      setupSpeichern(car, Object.assign({}, setupVon(car) || {}, { mix: neu }));
      setupZeichnen();
    };
    const zr = setupWertZeile('setup-reifen', t('Reifentyp'),
      t('Mischung beim nächsten Start. Die Rundenzahl gilt, bis der Satz abgefahren ist: gerechnet mit dem Verschleißmodell und dem Fahrgefühl dieses Autos bei zügiger Fahrt (85 % Gas) und einer guten Runde auf der Editor-Strecke. Standard: was montiert ist (bei vorgegebenem Setup mittel, bei Regenstart Regen).'),
      '<i class="setup-misch" style="background:' + mischungFarbe(mix) + '"></i>' + esc(mischungName(mix)) + std(eigen.mix)
        + zweite(setupRundenText(rd.reifen)),
      () => mixWahl(-1), () => mixWahl(1));
    zr.dataset.mix = mix;
    zeilen.appendChild(zr);
    // Starttank
    const tankSetzen = (l) => {
      if (setupVorgabeGrund(null)) return;
      const w = Math.max(SETUP_TANK_MIN, Math.min(FUEL_TANK_LITERS, Math.round(l / SETUP_TANK_SCHRITT) * SETUP_TANK_SCHRITT));
      setupSpeichern(car, Object.assign({}, setupVon(car) || {}, { tankL: w }));
      setupZeichnen();
    };
    const zt = setupWertZeile('setup-tank', t('Starttank'),
      t('Füllung beim nächsten Start, in Schritten von 5 l. Die Rundenzahl rechnet mit dem Verbrauchsregler aus den Optionen bei 85 % Gas, dem Motorkennfeld und einer guten Runde auf der Editor-Strecke. Standard: der Starttank aus den Renneinstellungen.'),
      esc(tankL + ' l (' + Math.round(tankL / FUEL_TANK_LITERS * 100) + ' %)') + std(eigen.tankL)
        + zweite(setupRundenText(rd.tank)),
      () => tankSetzen(tankL - SETUP_TANK_SCHRITT), () => tankSetzen(tankL + SETUP_TANK_SCHRITT));
    zt.dataset.tank = String(tankL);
    // Der sichtbare Regler kommt VOR das versteckte Steuerkreuzfeld: menuNavControlFor() nimmt den ersten
    // Regler der Zeile, links/rechts verstellt dann 5 l, gehalten 25 l.
    const rg = document.createElement('input');
    rg.type = 'range'; rg.className = 'setup-tank-regler';
    rg.min = String(SETUP_TANK_MIN); rg.max = String(FUEL_TANK_LITERS); rg.step = String(SETUP_TANK_SCHRITT);
    rg.value = String(tankL);
    rg.setAttribute('data-preset-skip', '');
    rg.setAttribute('aria-label', t('Starttank'));
    rg.disabled = !!grund;
    rg.addEventListener('change', () => tankSetzen(+rg.value));
    rg.addEventListener('input', () => {
      const b = zt.querySelector('.gk-w > b');
      if (b && b.firstChild) b.firstChild.textContent = rg.value + ' l (' + Math.round(+rg.value / FUEL_TANK_LITERS * 100) + ' %)';
    });
    zt.insertBefore(rg, zt.querySelector('.gk-pad'));
    zeilen.appendChild(zt);
    // v1.4.54: die Fahrzeugwerte. Je Zeile Wert, Kennzeile (was er bewirkt) und die Erklaerung im (i).
    SETUP_FELDER.forEach((f) => {
      const stdW = f.std(nr);
      const eig = eigen[f.id];
      const wert = eig === undefined || eig === null ? stdW : eig;
      const wirkt = setupWirkt(f.id, nr);
      const schritt = (dd) => {
        if (setupVorgabeGrund(null)) return;
        const s = setupVon(car) || {};
        const jetzt = s[f.id] === undefined || s[f.id] === null ? f.std(nr) : s[f.id];
        s[f.id] = setupFeldRund(f, jetzt + dd * f.schritt);
        setupSpeichern(car, s);
        setupZeichnen();
      };
      const kenn = wirkt ? t(f.kenn(wert, stdW)) : t('wirkt in diesem Fahrgefühl nicht');
      const z = setupWertZeile('setup-' + f.id, t(f.titel), t(f.erkl),
        esc(f.wert(wert)) + std(eig) + zweite(kenn), () => schritt(-1), () => schritt(1));
      z.dataset.feld = f.id;
      z.dataset.wert = String(wert);
      if (!wirkt) z.classList.add('setup-aus');
      zeilen.appendChild(z);
    });
    d.appendChild(zeilen);
    if (grund) d.querySelectorAll('.gk-zeile .gk-w button').forEach((b) => { b.disabled = true; });
    // Knoepfe
    const kn = document.createElement('div');
    kn.className = 'setup-knoepfe';
    const knopf = (act, text, fn, primary) => {
      const z = document.createElement('div');
      z.className = 'opt-row opt-breit';
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      if (primary) b.className = 'primary';
      b.textContent = text;
      b.onclick = fn;
      z.appendChild(b);
      kn.appendChild(z);
      return b;
    };
    const sb = knopf('setup-standard', t('Standard'), () => {
      setupStandard(car);
      showHudToast(t('Setup auf Standard'));
      setupZeichnen();
    });
    sb.disabled = !!grund || !setupVon(car);
    knopf('setup-zu', t('Schließen'), () => setupSchliessen(), true);
    d.appendChild(kn);
    d.scrollTop = scroll;
    if (typeof optInfoEinrichten === 'function') optInfoEinrichten();
    if (typeof menuNavRender === 'function' && setupFensterOffen()) { menuNavEnsureContext(); menuNavRender(); }
  }

  // Der Knopf in der Garage (rechte Haelfte, unter "Blinken"), nur fuer Spielerautos.
  function setupGarageZeile(car) {
    if (!setupSpielerNr(car)) return null;
    const z = document.createElement('div');
    z.className = 'opt-row opt-breit gar-a-aktion gar-a-setup';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'setup';
    const s = setupVon(car);
    const weitere = s ? SETUP_FELDER.filter((f) => s[f.id] !== undefined).length : 0;
    const was = s ? [s.mix ? mischungName(s.mix) : null, s.tankL ? s.tankL + ' l' : null,
      weitere ? '+' + weitere : null].filter(Boolean).join(' · ') : '';
    b.innerHTML = '';
    b.appendChild(document.createTextNode(t('Setup') + (was ? ' · ' + was : '')));
    const w = document.createElement('span');
    w.className = 'wip-tag';
    w.textContent = 'WIP';
    b.appendChild(w);
    b.onclick = (e) => { e.stopPropagation(); setupOeffnen(car); };
    z.appendChild(b);
    return z;
  }
  i18nOnLangChange(() => { if (setupFensterOffen()) setupZeichnen(); });

  // ---- Selbsttests (v1.4.33, v1.4.54) ---------------------------------------------------------
  // Hier und nicht in 95-selftest.js: stAdd() steht dort und ist zur Ladezeit dieser Datei laengst da.
  // Jeder Test sichert die Setup-Ablage und den Spielzustand und stellt beides danach wieder her - auch
  // nach einem asynchronen Test (fn gibt ein Promise zurueck).
  function setupTestRahmen(fn) {
    let roh = null;
    try { roh = localStorage.getItem(SETUP_STORE); } catch (e) { roh = null; }
    const motorMerk = (m) => (m ? Object.keys(SETUP_NEUTRAL).reduce((o, k) => { o[k] = m.state[k]; return o; }, {}) : null);
    const merk = { auf: garAufAuto, virt: garVirtuellAuf, tiles: currentTrackTiles, rs: raceState,
                   pc: playerCar, pc2: playerCar2, zs: zweiSpieler, fuel, tyres, tyres2,
                   t2: tankZwei.stand, wunsch: mischungWunsch, lauf: setupLaufVorgabe, ch: chLauf,
                   drain: fuelDrainPerSec, wx: raceWxStart, p1L: setupP1StartL, phys: physicsEnabled,
                   m1: motorMerk(physEngine), m2: motorMerk(physEngine2) };
    const probe = [['player', 'p1'], ['player2', 'p2'], ['ghost', 'npc']].map(([role, id], i) => ({ role,
      device: { id: 'probe-setup-' + id, name: 'Probe' }, alias: 'Setup ' + id, colorId: ['rot', 'blau', 'gelb'][i],
      sim: false, testSenke: [], probe: true }));
    const f = [];
    const aufraeumen = () => {
      setupFenster.hidden = true; setupFensterAuto = null;
      setupReifenAbbrechen();
      for (let i = garage.length - 1; i >= 0; i--) if (probe.includes(garage[i])) garage.splice(i, 1);
      garAufAuto = merk.auf; garVirtuellAuf = merk.virt; currentTrackTiles = merk.tiles; raceState = merk.rs;
      playerCar = merk.pc; playerCar2 = merk.pc2; zweiSpieler = merk.zs; fuel = merk.fuel;
      tyres2 = merk.tyres2; tankZwei.stand = merk.t2; mischungWunsch = merk.wunsch; setupLaufVorgabe = merk.lauf;
      chLauf = merk.ch; fuelDrainPerSec = merk.drain; raceWxStart = merk.wx; setupP1StartL = merk.p1L;
      physicsEnabled = merk.phys;
      if (merk.m1) Object.assign(physEngine.state, merk.m1);
      if (merk.m2) Object.assign(physEngine2.state, merk.m2);
      tyres = merk.tyres;
      applySurface();
      try { if (roh === null) localStorage.removeItem(SETUP_STORE); else localStorage.setItem(SETUP_STORE, roh); } catch (e) { /* privat */ }
      renderGarage();
      if (typeof menuNavEnsureContext === 'function') menuNavEnsureContext();
    };
    let r;
    try {
      try { localStorage.removeItem(SETUP_STORE); } catch (e) { /* privat */ }
      probe.forEach((c) => garage.push(c));
      r = fn(f, probe);
    } catch (e) {
      aufraeumen();
      f.push('Fehler: ' + e.message);
      return { ok: false, mass: f.join(' | ') };
    }
    if (r && typeof r.then === 'function') {
      return r.then((x) => { aufraeumen(); return x; },
        (e) => { aufraeumen(); return { ok: false, mass: 'Fehler: ' + (e && e.message) }; });
    }
    aufraeumen();
    return r;
  }
  const setupErgebnis = (f, ok) => ({ ok: !f.length, mass: f.length ? f.join(' | ') : ok });
  const SETUP_ZEILEN_SOLL = ['reifen', 'tank'].concat(SETUP_FELDER.map((x) => x.id)).concat(['setup-standard', 'setup-zu']);
  const setupZeilenArt = (r) => (r.el.dataset && r.el.dataset.feld) || (r.el.classList.contains('setup-reifen') ? 'reifen'
    : r.el.classList.contains('setup-tank') ? 'tank' : (r.control.dataset && r.control.dataset.act) || '?');

  stAdd('Setup v1.4.33: Knopf je Spielerauto mit WIP, nicht bei NPCs', () => setupTestRahmen((f, probe) => {
    probe.forEach((car) => {
      garAufAuto = car; garVirtuellAuf = false; renderGarage();
      const b = $('gar-list').querySelector('.gar-a-rechts [data-act="setup"]');
      const spieler = car.role !== 'ghost';
      if (spieler && !b) f.push(car.role + ': kein Setup-Knopf');
      if (spieler && b && !b.querySelector('.wip-tag')) f.push(car.role + ': Knopf ohne WIP');
      if (!spieler && b) f.push('NPC hat einen Setup-Knopf');
      if (spieler && b) {
        const blink = $('gar-list').querySelector('.gar-a-rechts .gar-a-blinken');
        if (!blink || blink.nextElementSibling !== b.closest('.opt-row')) f.push(car.role + ': Setup nicht direkt unter Blinken');
      }
    });
    return setupErgebnis(f, 'Spieler 1 und 2 mit Knopf (WIP), NPC ohne');
  }));

  stAdd('Setup v1.4.33: Fenster oeffnet und schliesst mit Klick, Steuerkreuz und Kreis', () => setupTestRahmen((f, probe) => {
    const car = probe[0];
    const merkTab = kAktiverTab();
    try {
      showTab('garage');
      garAufAuto = car; garVirtuellAuf = false; renderGarage();
      $('gar-list').querySelector('[data-act="setup"]').click();
      if (!setupFensterOffen()) f.push('Klick oeffnet nicht');
      if (menuNavContainer() !== $('setup-fenster')) f.push('Steuerkreuz bleibt in der Garage');
      const rows = menuNavRows();
      const art = rows.map(setupZeilenArt);
      if (art.join(',') !== SETUP_ZEILEN_SOLL.join(',')) f.push('Zeilen: ' + art.join(','));
      if (rows[1] && rows[1].control !== $('setup-fenster').querySelector('.setup-tank-regler')) f.push('Tankzeile verstellt nicht den Regler');
      // Rechts auf dem Reifentyp schaltet die Mischung weiter und merkt sie.
      menuNavIndex = 0; menuNavGezeigt = true; menuNavRender();
      const vorher = setupMontiert(1);
      menuNavSeitwaerts('right', true); menuNavAdjustGehalten('right', false);
      const s1 = setupVon(car);
      const soll = MISCHUNG_FOLGE[(MISCHUNG_FOLGE.indexOf(vorher) + 1) % MISCHUNG_FOLGE.length];
      if (!s1 || s1.mix !== soll) f.push('rechts auf Reifentyp -> ' + (s1 && s1.mix) + ' statt ' + soll);
      // Links auf dem Tank: 5 l weniger.
      menuNavIndex = 1; menuNavRender();
      menuNavSeitwaerts('left', true); menuNavAdjustGehalten('left', false);
      const s2 = setupVon(car);
      if (!s2 || s2.tankL !== raceFuelStartL - SETUP_TANK_SCHRITT) f.push('links auf Tank -> ' + (s2 && s2.tankL) + ' l');
      // Kreis schliesst und bleibt in der Garage.
      if (!konsoleZurueck() || setupFensterOffen()) f.push('Kreis schliesst nicht');
      if (kAktiverTab() !== 'garage') f.push('Kreis verlaesst die Garage');
      // X auf "Schliessen".
      setupOeffnen(car);
      const zu = menuNavRows().findIndex((r) => r.control.dataset && r.control.dataset.act === 'setup-zu');
      menuNavIndex = zu; menuNavRender(); menuNavActivate();
      if (setupFensterOffen()) f.push('X auf Schliessen schliesst nicht');
      if (menuNavContainer() === $('setup-fenster')) f.push('Steuerkreuz bleibt im geschlossenen Fenster');
    } finally {
      showTab(merkTab);
    }
    return setupErgebnis(f, 'Klick, links/rechts, X und Kreis');
  }));

  stAdd('Setup v1.4.33: Rundenangaben aus Streckenlaenge und Modell, ohne Strecke Hinweis', () => setupTestRahmen((f, probe) => {
    const merkEff = physEngine.config.tyreEffect;
    try {
      if (!(physEngine.config.tyreEffect > 0)) { physEngine.config.tyreEffect = 1; physEngine2Abgleichen(); }
      fuelDrainPerSec = 1;
      currentTrackTiles = codeToTrack('SGR4LGHG').tiles;
      const runde = setupRundeS();
      if (!(runde > 6.5 && runde < 8.5)) f.push('Runde SGR4LGHG ' + runde + ' s (Gold 7,3 s erwartet)');
      const voll = setupRunden(1, 'mittel', FUEL_TANK_LITERS, runde, null, true);
      const halb = setupRunden(1, 'mittel', FUEL_TANK_LITERS / 2, runde, null, true);
      const sollTank = 100 / (1 * SETUP_GAS);
      if (Math.abs(voll.tank.sek - sollTank) > 0.01) f.push('Tank ' + voll.tank.sek.toFixed(1) + ' s statt ' + sollTank.toFixed(1));
      if (voll.tank.runden !== Math.floor(sollTank / runde)) f.push('Tankrunden ' + voll.tank.runden);
      if (Math.abs(halb.tank.sek * 2 - voll.tank.sek) > 0.01) f.push('halber Tank nicht halbe Zeit');
      // Kennfeld 3: 120 % Verbrauch, also weniger Runden je Tank.
      const k3 = setupRunden(1, 'mittel', FUEL_TANK_LITERS, runde, Object.assign({}, SETUP_NEUTRAL, { setupVerbrauch: 1.2 }), true);
      if (!(Math.abs(k3.tank.sek * 1.2 - voll.tank.sek) < 0.01)) f.push('Kennfeld rechnet nicht in die Tankangabe');
      const r = MISCHUNG_FOLGE.map((m) => setupRunden(1, m, 50, runde, null, true).reifen.sek);
      if (!(r[0] < r[1] && r[1] < r[2])) f.push('weich/mittel/hart nicht aufsteigend: ' + r.map((x) => Math.round(x)).join('/'));
      // Gegenprobe mit dem Stint des Pruefstands (dieselbe Fahrt, aber kalt gestartet und bis abgefahren).
      const probeStint = OMEGA_TEST.reifenStintProbe({ tyreEffect: physEngine.config.tyreEffect, mix: mischungWert('mittel', 'verschleiss'), drain: 1, maxSekunden: 1500 });
      if (probeStint.reifenSek && Math.abs(r[1] / probeStint.reifenSek - 1) > 0.1) {
        f.push('mittel ' + Math.round(r[1]) + ' s gegen Stintprobe ' + probeStint.reifenSek + ' s');
      }
      // Fenster mit Strecke: Rundenangaben stehen da (der Tank sofort, die Reifen nach der Fahrt).
      setupOeffnen(probe[0]);
      const txt = $('setup-fenster').textContent;
      if (!/ca\. \d+ Runden|approx\. \d+ laps|aprox\. \d+ vueltas/.test(txt)) f.push('keine Rundenangabe im Fenster');
      // Ohne Strecke und mit offener Strecke: keine Zahl, sondern der Hinweis.
      for (const code of [null, 'SG3']) {
        currentTrackTiles = code ? codeToTrack(code).tiles : [];
        if (setupRundeS() !== null) f.push((code || 'leer') + ': Runde trotz fehlender Strecke');
        setupZeichnen();
        const tx = $('setup-fenster').textContent;
        if (tx.indexOf(t('Ohne geschlossene Carrera-Strecke im Editor keine Rundenangabe.')) < 0) f.push((code || 'leer') + ': kein Hinweis');
        if (/ca\. \d+ Runden/.test(tx)) f.push((code || 'leer') + ': Rundenzahl ohne Strecke');
      }
      return setupErgebnis(f, 'Runde ' + (runde || 0).toFixed(2) + ' s, Tank voll ' + voll.tank.runden + ' Rd., Reifen '
        + MISCHUNG_FOLGE.map((m, i) => m + ' ' + Math.floor(r[i] / runde)).join('/') + ' Rd., Stintprobe mittel '
        + probeStint.reifenSek + ' s gegen ' + Math.round(r[1]) + ' s');
    } finally {
      physEngine.config.tyreEffect = merkEff; physEngine2Abgleichen();
    }
  }));

  stAdd('Setup v1.4.33: Standard setzt zurueck, Speicherung je Auto in der Sicherung', () => setupTestRahmen((f, probe) => {
    setupSpeichern(probe[0], { mix: 'weich', tankL: 55 });
    setupSpeichern(probe[1], { mix: 'hart' });
    let roh = {};
    try { roh = JSON.parse(localStorage.getItem(SETUP_STORE) || '{}'); } catch (e) { roh = {}; }
    if (!roh['probe-setup-p1'] || roh['probe-setup-p1'].tankL !== 55) f.push('Auto 1 nicht gespeichert');
    if (!roh['probe-setup-p2'] || roh['probe-setup-p2'].mix !== 'hart') f.push('Auto 2 nicht gespeichert');
    if (sicherungSchluessel().indexOf(SETUP_STORE) < 0) f.push('Sicherung erfasst ' + SETUP_STORE + ' nicht');
    setupOeffnen(probe[0]);
    const sb = $('setup-fenster').querySelector('[data-act="setup-standard"]');
    if (!sb || sb.disabled) f.push('Standard-Knopf fehlt oder gesperrt');
    else sb.click();
    if (setupVon(probe[0])) f.push('Standard setzt nicht zurueck');
    if (!setupVon(probe[1])) f.push('Standard loescht auch das andere Auto');
    const sb2 = $('setup-fenster').querySelector('[data-act="setup-standard"]');
    if (!sb2 || !sb2.disabled) f.push('Standard-Knopf ohne eigenes Setup nicht gesperrt');
    const tz = $('setup-fenster').querySelector('.setup-tank');
    if (!tz || +tz.dataset.tank !== raceFuelStartL) f.push('Tank nach Standard ' + (tz && tz.dataset.tank) + ' statt Renneinstellung');
    return setupErgebnis(f, 'je Geraet in ' + SETUP_STORE + ', Standard nur fuer dieses Auto');
  }));

  stAdd('Setup v1.4.33: wirkt beim Start je Auto, ohne Setup wie bisher', () => setupTestRahmen((f, probe) => {
    if (String(startRaceCountdown).indexOf('setupRennstart(mpPlan)') < 0) f.push('Rennstart ruft setupRennstart nicht');
    playerCar = probe[0]; playerCar2 = probe[1]; zweiSpieler = true;
    chLauf = null; setupLaufVorgabe = null;
    setupSpeichern(probe[0], { mix: 'weich', tankL: 55 });
    setupSpeichern(probe[1], { mix: 'hart', tankL: 33 });
    fuel = 100; tankZwei.stand = 100; tyres = 'mittel'; tyres2 = 'mittel';
    let r = setupRennstart(null);
    if (r.grund) f.push('vorgegeben ohne Grund: ' + r.grund);
    if (Math.abs(fuel - 50) > 0.01) f.push('P1 Tank ' + fuel.toFixed(1) + ' % statt 50');
    if (tyres !== 'weich') f.push('P1 Reifen ' + tyres);
    if (Math.abs(tankZwei.stand - 30) > 0.01) f.push('P2 Tank ' + tankZwei.stand.toFixed(1) + ' % statt 30');
    if (tyres2 !== 'hart') f.push('P2 Reifen ' + tyres2);
    if (Math.abs(physEngine2.config.tyreWearMix - mischungWert('hart', 'verschleiss')) > 1e-9) f.push('P2-Motor rechnet nicht mit hart');
    if (raceFuelBilanz().startL !== 55) f.push('Tankbilanz startet mit ' + raceFuelBilanz().startL + ' l statt 55');
    // Ohne eigenes Setup: nichts angefasst.
    setupStandard(probe[0]); setupStandard(probe[1]);
    fuel = 80; tankZwei.stand = 70; tyres = 'hart'; tyres2 = 'regen';
    r = setupRennstart(null);
    if (fuel !== 80 || tankZwei.stand !== 70 || tyres !== 'hart' || tyres2 !== 'regen') f.push('ohne Setup veraendert: '
      + [fuel, tankZwei.stand, tyres, tyres2].join('/'));
    return setupErgebnis(f, 'P1 weich 55 l, P2 hart 33 l; ohne Setup unveraendert');
  }));

  stAdd('Setup v1.4.33: Vereinheitlichung bei festgelegtem Fahrgefuehl, Fenster gesperrt', () => setupTestRahmen((f, probe) => {
    playerCar = probe[0]; playerCar2 = probe[1]; zweiSpieler = true;
    chLauf = null; setupLaufVorgabe = null; raceWxStart = 'dry';
    setupSpeichern(probe[0], { mix: 'weich', tankL: 20 });
    setupSpeichern(probe[1], { mix: 'hart', tankL: 20 });
    fuel = 100; tankZwei.stand = 100; tyres = 'weich'; tyres2 = 'regen';
    // WLAN-Rennen mit erzwungenem Fahrgefuehl.
    let r = setupRennstart({ preset: 'pro', tank: 110 });
    if (r.grund !== 'mp') f.push('WLAN mit Preset nicht vereinheitlicht');
    if (tyres !== 'mittel' || tyres2 !== 'mittel') f.push('Reifen ' + tyres + '/' + tyres2 + ' statt Standard mittel');
    if (fuel !== 100 || tankZwei.stand !== 100) f.push('Tank vom eigenen Setup ueberschrieben');
    // Ohne erzwungenes Preset gilt wieder das eigene.
    r = setupRennstart({ tank: 110 });
    if (r.grund || tyres !== 'weich') f.push('WLAN ohne Preset trotzdem vereinheitlicht');
    // Challenge: Fenster gesperrt, mit Hinweis, Regler wirkungslos.
    chLauf = { id: 'probe' };
    raceWxStart = 'rain';
    if (setupVorgabeGrund(null) !== 'challenge') f.push('Challenge nicht erkannt');
    setupOeffnen(probe[0]);
    const fe = $('setup-fenster');
    if (!fe.classList.contains('gesperrt')) f.push('Fenster nicht gesperrt');
    if (fe.textContent.indexOf(t('Für dieses Rennen vorgegeben')) < 0) f.push('kein Hinweis "vorgegeben"');
    if (fe.querySelector('.setup-reifen').dataset.mix !== 'regen') f.push('Standard bei Regenstart nicht Regen');
    if (!fe.querySelector('.setup-tank-regler').disabled) f.push('Tankregler frei');
    if (![...fe.querySelectorAll('.gk-zeile .gk-w button')].every((b) => b.disabled)) f.push('Pfeile frei');
    menuNavIndex = 0; menuNavGezeigt = true; menuNavRender();
    menuNavSeitwaerts('right', true); menuNavAdjustGehalten('right', false);
    if ((setupVon(probe[0]) || {}).mix !== 'weich') f.push('gesperrter Reifentyp liess sich verstellen');
    r = setupRennstart(null);
    if (r.grund !== 'challenge' || tyres !== 'regen') f.push('Challenge-Start: ' + r.grund + ' ' + tyres);
    return setupErgebnis(f, 'WLAN-Preset und Challenge: alle Standard, Fenster gesperrt');
  }));

  // ---- v1.4.54 -------------------------------------------------------------------------------
  stAdd('Setup v1.4.54: Ladesymbol waehrend der Reifenfahrt, in Haeppchen unter 50 ms', () => setupTestRahmen(async (f, probe) => {
    const merkEff = physEngine.config.tyreEffect;
    try {
      if (!(physEngine.config.tyreEffect > 0)) { physEngine.config.tyreEffect = 1; physEngine2Abgleichen(); }
      currentTrackTiles = codeToTrack('SGR4LGHG').tiles;
      Object.keys(setupReifenCache).forEach((k) => { delete setupReifenCache[k]; });
      // Hart ist die laengste Fahrt (rund 1200 s Fahrzeit).
      setupSpeichern(probe[0], { mix: 'hart' });
      setupLadeStat.maxMs = 0; setupLadeStat.scheiben = 0;
      const t0 = performance.now();
      setupOeffnen(probe[0]);
      const oeffnenMs = performance.now() - t0;
      const lz = $('setup-fenster').querySelector('.setup-ladezeile');
      if (!lz || lz.hidden || !lz.querySelector('.lade-dreh')) f.push('kein Ladesymbol beim Oeffnen');
      if ($('setup-fenster').querySelector('.setup-reifen').textContent.indexOf(t('wird berechnet')) < 0) f.push('Reifenzeile ohne "wird berechnet"');
      if (!setupLadeStat.laeuft) f.push('Reifenfahrt laeuft nicht im Hintergrund');
      // Warten ueber einen eigenen MessageChannel (gleiche Prioritaet wie die Haeppchen): stLuft() nimmt
      // scheduler.yield(), und dessen Fortsetzung laeuft VOR gewoehnlichen Aufgaben - die Haeppchen kaemen nie dran.
      const warte = () => new Promise((ok) => { const k = new MessageChannel(); k.port1.onmessage = () => { k.port1.close(); ok(); }; k.port2.postMessage(0); });
      while (setupLadeStat.laeuft && performance.now() - t0 < 20000) await warte();
      const gesamt = performance.now() - t0;
      if (setupLadeStat.laeuft) f.push('nach 20 s nicht fertig');
      if (setupLadeStat.fehler) f.push('Reifenfahrt warf: ' + setupLadeStat.fehler);
      const lz2 = $('setup-fenster').querySelector('.setup-ladezeile');
      if (!lz2 || !lz2.hidden) f.push('Ladesymbol bleibt nach der Rechnung');
      if (!/\d/.test($('setup-fenster').querySelector('.setup-reifen .setup-wert-r').textContent)) f.push('keine Reifenrunden nach der Rechnung');
      if (setupLadeStat.maxMs >= 50) f.push('laengstes Haeppchen ' + setupLadeStat.maxMs.toFixed(1) + ' ms');
      if (setupLadeStat.scheiben < 2) f.push('nicht in Haeppchen gerechnet (' + setupLadeStat.scheiben + ')');
      if (oeffnenMs >= 50) f.push('Oeffnen blockiert ' + Math.round(oeffnenMs) + ' ms');
      return setupErgebnis(f, setupLadeStat.scheiben + ' Haeppchen, laengstes ' + setupLadeStat.maxMs.toFixed(1)
        + ' ms, Oeffnen ' + Math.round(oeffnenMs) + ' ms, fertig nach ' + Math.round(gesamt) + ' ms');
    } finally {
      physEngine.config.tyreEffect = merkEff; physEngine2Abgleichen();
    }
  }));

  // Pruefstand: ein frischer Motor mit der Abstimmung von Spieler 1 und erzwungenen Schaltern, damit jede
  // Einstellung in einem Fahrgefuehl gemessen wird, in dem sie wirkt.
  function setupPruefMotor(cfgPlus, werte) {
    const cfg = Object.assign(JSON.parse(JSON.stringify(physEngine.config)), cfgPlus || {});
    const e = new CarreraPhysicsEngine();
    Object.assign(e.config, cfg);
    Object.assign(e.state, setupFaktoren(1, werte || null, cfg, true));
    e.state.driveMode = 'forward';
    return e;
  }
  stAdd('Setup v1.4.54: Wirkrichtung je Einstellung im Pruefstand', () => {
    const f = [];
    const dt = CONTROL_SEND_INTERVAL_MS / 1000;
    const PHYSIK = { pacejka: false, gran: false, lenkKopplungAus: 0, brakeStealLast: 1, lenkAlt: 0, tyreEffect: 1 };
    const fahren = (e, s, inp) => { for (let t2 = 0; t2 < s; t2 += dt) e.update(inp(t2), dt); return e.state; };
    const m = {};
    // Heckfluegel 10 gegen 0: Hoechsttempo kleiner, Querausnutzung bei Tempo kleiner (= mehr Kurvengrip).
    const vmax = (w) => fahren(setupPruefMotor(PHYSIK, { wing: w }), 40,
      () => ({ steering: 0, throttle: 1, brake: 0, headlights: false })).speedKmh;
    const quer = (w) => {
      const e = setupPruefMotor(PHYSIK, { wing: w });
      e.state.speedKmh = e.config.topSpeedKmh * 0.8; e.state.dampedSteering = 0.5;
      e.update({ steering: 0.5, throttle: 0.5, brake: 0, headlights: false }, dt);
      return e.state.latUse;
    };
    m.vmax = [vmax(0), vmax(10)]; m.quer = [quer(0), quer(10)];
    if (!(m.vmax[1] < m.vmax[0])) f.push('Fluegel 10 nicht langsamer: ' + m.vmax.map((x) => x.toFixed(3)).join('/'));
    if (!(m.quer[1] < m.quer[0])) f.push('Fluegel 10 ohne mehr Kurvengrip: ' + m.quer.map((x) => x.toFixed(3)).join('/'));
    // Kennfeld 3 gegen 1: schneller auf halbes Tempo, mehr Verbrauch.
    const t50 = (k) => {
      const e = setupPruefMotor(PHYSIK, { map: k });
      let t2 = 0;
      while (t2 < 20 && e.state.speedKmh < e.config.topSpeedKmh * 0.5) { e.update({ steering: 0, throttle: 1, brake: 0, headlights: false }, dt); t2 += dt; }
      return t2;
    };
    m.t50 = [t50(1), t50(3)];
    const v1 = setupFaktoren(1, { map: 1 }, physEngine.config, true).setupVerbrauch;
    const v3 = setupFaktoren(1, { map: 3 }, physEngine.config, true).setupVerbrauch;
    if (!(m.t50[1] < m.t50[0])) f.push('Kennfeld 3 beschleunigt nicht staerker: ' + m.t50.map((x) => x.toFixed(2)).join('/'));
    if (!(v3 > v1)) f.push('Kennfeld 3 verbraucht nicht mehr');
    if (String(fuelTankTick).indexOf('setupVerbrauch') < 0 || String(tankTickVon).indexOf('setupVerbrauch') < 0) f.push('Tank liest das Kennfeld nicht');
    // Bremsbalance hinten (50) gegen vorn (66): mehr Lenkung und mehr Gier beim Bremsen in der Kurve.
    const bremsKurve = (werte) => {
      const e = setupPruefMotor(PHYSIK, werte);
      e.state.speedKmh = e.config.topSpeedKmh * 0.7;
      let lenk = 0, gier = 0, n = 0, weg = 0;
      for (let t2 = 0; t2 < 0.8; t2 += dt) {
        e.update({ steering: 0.6, throttle: 0, brake: 1, headlights: false }, dt);
        lenk += e.state.steerGrip; gier += Math.abs(e.outputs.servoAngle || 0); n++;
      }
      const e2 = setupPruefMotor(PHYSIK, werte);
      e2.state.speedKmh = e2.config.topSpeedKmh * 0.7;
      for (let t2 = 0; t2 < 15 && e2.state.speedKmh > 0.01; t2 += dt) {
        e2.update({ steering: 0, throttle: 0, brake: 1, headlights: false }, dt); weg += e2.state.speedKmh * dt;
      }
      return { lenk: lenk / n, gier: gier / n, weg };
    };
    m.bias = [bremsKurve({ bias: 66 }), bremsKurve({ bias: 50 })];
    if (!(m.bias[1].lenk > m.bias[0].lenk)) f.push('Balance hinten ohne mehr Lenkung beim Bremsen');
    if (!(m.bias[1].gier > m.bias[0].gier)) f.push('Balance hinten ohne mehr Gier beim Bremsen: ' + m.bias.map((x) => x.gier.toFixed(3)).join('/'));
    // ABS 5 gegen 0: mehr Restlenkung beim Vollbremsen, etwas laengerer Bremsweg.
    m.abs = [bremsKurve({ abs: 0 }), bremsKurve({ abs: 5 })];
    if (!(m.abs[1].lenk > m.abs[0].lenk)) f.push('ABS 5 ohne mehr Restlenkung: ' + m.abs.map((x) => x.lenk.toFixed(3)).join('/'));
    if (!(m.abs[1].weg > m.abs[0].weg)) f.push('ABS 5 ohne laengeren Bremsweg');
    // TC 5 gegen 0 (Pacejka mit Uebersteuern): weniger Heck unter Vollgas in der Kurve.
    const heck = (k) => {
      const e = setupPruefMotor(Object.assign({}, PHYSIK, { pacejka: true, pacejkaUebersteuern: true }), { tc: k });
      e.state.speedKmh = e.config.topSpeedKmh * 0.6;
      let max = 0;
      for (let t2 = 0; t2 < 3; t2 += dt) {
        e.update({ steering: 0.9, throttle: 1, brake: 0, headlights: false }, dt);
        max = Math.max(max, e.state.pacUeber || 0);
      }
      return max;
    };
    m.tc = [heck(0), heck(5)];
    if (!(m.tc[0] > 0.01)) f.push('ohne TC kommt das Heck im Pruefstand gar nicht (' + m.tc[0].toFixed(3) + ')');
    if (!(m.tc[1] < m.tc[0])) f.push('TC 5 ohne weniger Heck: ' + m.tc.map((x) => x.toFixed(3)).join('/'));
    // Reifendruck 20 gegen 22 psi: weniger Druck wird schneller warm (Temperaturfenster frueher erreicht).
    const warm = (psi) => fahren(setupPruefMotor(PHYSIK, { druck: psi }), 15,
      (t2) => ({ steering: Math.sin(t2 * 1.1) * 0.55, throttle: 0.85, brake: 0, headlights: false }));
    const w20 = warm(20), w22 = warm(22);
    m.druck = [w20.tyreTempC, w22.tyreTempC, w20.tyreWear, w22.tyreWear];
    if (!(w20.tyreTempC > w22.tyreTempC)) f.push('20 psi nicht waermer als 22 psi');
    if (!(w20.tyreWear > w22.tyreWear)) f.push('20 psi verschleisst nicht mehr');
    // Neutral ist bitgleich: ohne Setup dieselben Zahlen wie mit leerem Setup.
    const a = fahren(setupPruefMotor(PHYSIK, null), 5, () => ({ steering: 0.4, throttle: 0.9, brake: 0, headlights: false }));
    const b = fahren(setupPruefMotor(PHYSIK, { map: 2, wing: 0, tc: 0, druck: 21 }), 5, () => ({ steering: 0.4, throttle: 0.9, brake: 0, headlights: false }));
    if (a.speedKmh !== b.speedKmh || a.tyreWear !== b.tyreWear) f.push('Standardwerte nicht bitgleich');
    const z = (x, n) => x.toFixed(n === undefined ? 2 : n);
    return setupErgebnis(f, 'Fluegel 0/10: Spitze ' + z(m.vmax[0]) + '/' + z(m.vmax[1]) + ', Quer ' + z(m.quer[0], 3) + '/' + z(m.quer[1], 3)
      + '; Kennfeld 1/3: halbes Tempo ' + z(m.t50[0]) + '/' + z(m.t50[1]) + ' s; Balance 66/50: Lenkung ' + z(m.bias[0].lenk, 3)
      + '/' + z(m.bias[1].lenk, 3) + ', Servo ' + z(m.bias[0].gier, 3) + '/' + z(m.bias[1].gier, 3) + '; ABS 0/5: Lenkung '
      + z(m.abs[0].lenk, 3) + '/' + z(m.abs[1].lenk, 3) + ', Weg ' + z(m.abs[0].weg, 3) + '/' + z(m.abs[1].weg, 3) + '; TC 0/5: Heck '
      + z(m.tc[0], 3) + '/' + z(m.tc[1], 3) + '; Druck 20/22: ' + z(m.druck[0], 1) + '/' + z(m.druck[1], 1) + ' Grad');
  });

  stAdd('Setup v1.4.54: Fahrzeugwerte im Fenster, Wirkung je Auto beim Start, Standard und Speicherung', () => setupTestRahmen((f, probe) => {
    physicsEnabled = true;
    playerCar = probe[0]; playerCar2 = probe[1]; zweiSpieler = true;
    chLauf = null; setupLaufVorgabe = null;
    setupOeffnen(probe[0]);
    const fe = $('setup-fenster');
    SETUP_FELDER.forEach((x) => {
      const z = fe.querySelector('.setup-' + x.id);
      if (!z) { f.push(x.id + ': keine Zeile'); return; }
      if (!z.querySelector('.opt-label small, .opt-info-btn')) f.push(x.id + ': ohne (i)-Text');
      if (!z.querySelector('.setup-wert-r') || !z.querySelector('.setup-wert-r').textContent.trim()) f.push(x.id + ': ohne Kennzeile');
    });
    // Steuerkreuz: links auf der Bremsbalance = 1 % weniger vorn als der Standard.
    const rows = menuNavRows();
    const iB = rows.findIndex((r) => r.el.dataset && r.el.dataset.feld === 'bias');
    const stdB = SETUP_FELD.bias.std(1);
    menuNavIndex = iB; menuNavGezeigt = true; menuNavRender();
    menuNavSeitwaerts('left', true); menuNavAdjustGehalten('left', false);
    const sB = setupVon(probe[0]) || {};
    if (sB.bias !== Math.max(50, Math.min(66, stdB - 1))) f.push('links auf Bremsbalance -> ' + sB.bias + ' statt ' + (stdB - 1));
    // Alle Werte speichern, Start: Spieler 1 bekommt seine Faktoren, Spieler 2 ohne Setup bleibt neutral.
    const alle = { bias: 55, abs: 3, tc: 2, map: 3, wing: 6, druck: 20.5 };
    setupSpeichern(probe[0], alle);
    let roh = {};
    try { roh = JSON.parse(localStorage.getItem(SETUP_STORE) || '{}')['probe-setup-p1'] || {}; } catch (e) { roh = {}; }
    Object.keys(alle).forEach((k) => { if (roh[k] !== alle[k]) f.push('gespeichert ' + k + '=' + roh[k]); });
    setupMotorSetzen(physEngine2, Object.assign({}, SETUP_NEUTRAL, { setupLeistung: 1.5 }));   // Rest aus einem alten Rennen
    const r = setupRennstart(null);
    const soll = setupFaktoren(1, alle);
    Object.keys(SETUP_NEUTRAL).forEach((k) => { if (physEngine.state[k] !== soll[k]) f.push('P1 ' + k + ' ' + physEngine.state[k] + ' statt ' + soll[k]); });
    if (physEngine.state.setupVerbrauch !== 1.2 || physEngine.state.setupLeistung !== 1.08) f.push('Kennfeld 3 nicht im Motor');
    Object.keys(SETUP_NEUTRAL).forEach((k) => { if (physEngine2.state[k] !== SETUP_NEUTRAL[k]) f.push('P2 ' + k + ' nicht neutral'); });
    // Die Abstimmung von Spieler 1 auf Spieler 2 kopieren nimmt das Setup NICHT mit.
    physEngine2Abgleichen();
    if (physEngine2.state.setupLeistung !== 1 || physEngine.state.setupLeistung !== 1.08) f.push('Abgleich verschiebt das Setup');
    if (!r.spieler.some((x) => x.nr === 1 && x.faktoren)) f.push('Start meldet keine Faktoren');
    // Ohne Physik (RC): alle Zeilen grau mit Hinweis, und am Start neutral.
    physicsEnabled = false;
    setupZeichnen();
    SETUP_FELDER.forEach((x) => {
      const z = fe.querySelector('.setup-' + x.id);
      if (!z || !z.classList.contains('setup-aus')) f.push(x.id + ': im RC nicht ausgegraut');
      else if (z.textContent.indexOf(t('wirkt in diesem Fahrgefühl nicht')) < 0) f.push(x.id + ': ohne Hinweis im RC');
    });
    const neutral = setupFaktoren(1, alle);
    if (Object.keys(SETUP_NEUTRAL).some((k) => neutral[k] !== SETUP_NEUTRAL[k])) f.push('ohne Physik nicht neutral');
    physicsEnabled = true;
    // Standard setzt alles zurueck.
    setupZeichnen();
    fe.querySelector('[data-act="setup-standard"]').click();
    if (setupVon(probe[0])) f.push('Standard laesst Werte stehen');
    setupRennstart(null);
    if (Object.keys(SETUP_NEUTRAL).some((k) => physEngine.state[k] !== SETUP_NEUTRAL[k])) f.push('nach Standard nicht neutral');
    return setupErgebnis(f, 'sechs Zeilen mit (i) und Kennzeile, je Auto im Motorzustand, RC ausgegraut, Standard neutral');
  }));

  stAdd('Setup v1.4.54: Vereinheitlichung gilt fuer alle Fahrzeugwerte', () => setupTestRahmen((f, probe) => {
    physicsEnabled = true;
    playerCar = probe[0]; playerCar2 = probe[1]; zweiSpieler = true;
    chLauf = null; setupLaufVorgabe = null;
    setupSpeichern(probe[0], { bias: 52, abs: 5, tc: 5, map: 3, wing: 10, druck: 20 });
    setupSpeichern(probe[1], { map: 1, wing: 4 });
    setupRennstart({ preset: 'pro' });
    [physEngine, physEngine2].forEach((mo, i) => {
      Object.keys(SETUP_NEUTRAL).forEach((k) => { if (mo.state[k] !== SETUP_NEUTRAL[k]) f.push('P' + (i + 1) + ' ' + k + ' trotz Vorgabe'); });
    });
    chLauf = { id: 'probe' };
    setupOeffnen(probe[0]);
    const fe = $('setup-fenster');
    SETUP_FELDER.forEach((x) => {
      const z = fe.querySelector('.setup-' + x.id);
      if (!z || [...z.querySelectorAll('.gk-w button')].some((b) => !b.disabled)) f.push(x.id + ': im gesperrten Fenster frei');
      if (z && +z.dataset.wert !== x.std(1)) f.push(x.id + ': zeigt ' + z.dataset.wert + ' statt Standard');
    });
    const iW = menuNavRows().findIndex((r) => r.el.dataset && r.el.dataset.feld === 'wing');
    menuNavIndex = iW; menuNavGezeigt = true; menuNavRender();
    menuNavSeitwaerts('left', true); menuNavAdjustGehalten('left', false);
    if ((setupVon(probe[0]) || {}).wing !== 10) f.push('gesperrter Heckfluegel liess sich verstellen');
    return setupErgebnis(f, 'alle neutral bei Vorgabe, Fenster zeigt Standard und sperrt');
  }));
