  // ============================== FAHRSTIL-KENNWERTE (v1.1.3, WIP) ==============================
  //
  // BESTELLT: "NARQ und Fahrverhaltensparameter: messen (dafuer braucht es eine Grundpack-Strecke),
  // Hypothesen bilden, Fahrverhaltens-Challenge." Dies ist der Messteil: waehrend eines Rennens
  // sammelt Spieler 1 je Takt Gas, Bremse, Lenkung, Kurve und Abseits und rechnet daraus
  // Kennwerte, die mit der Sitzung gespeichert werden (97-sessions.js, eintrag.fahrstil). Nur
  // gefahrene Zeit zaehlt: nicht vor Gruen, nicht unter dem Autopiloten (Gelb, Aufstellung).
  //
  //   vollgas       Anteil der Fahrzeit mit Gas ueber 90 %
  //   gas           mittleres Gas
  //   bremse        Anteil der Fahrzeit mit Bremse ueber 5 %
  //   bremsungen    Bremsvorgaenge je Minute (Flanken)
  //   bremsKurve    Anteil der Bremszeit auf Kurventeilen (spaetes Bremsen / Trail-Braking)
  //   lenkUnruhe    mittlere Lenkaenderung je Sekunde (voller Ausschlag = 1)
  //   abfluege      Abfluege je Minute (Flanken von "neben der Bahn")
  //   rundenStreu   Variationskoeffizient der Rundenzeiten (ohne die erste Runde)
  const fs = { schluessel: null, zeit: 0, gasVoll: 0, gasSumme: 0, bremsZeit: 0, bremsKurve: 0,
               bremsungen: 0, bremsVorher: false, lenkWeg: 0, lenkVorher: null, abfluege: 0, abseitsVorher: false };
  function fahrstilZuruecksetzen(schluessel) {
    Object.assign(fs, { schluessel, zeit: 0, gasVoll: 0, gasSumme: 0, bremsZeit: 0, bremsKurve: 0,
                        bremsungen: 0, bremsVorher: false, lenkWeg: 0, lenkVorher: null, abfluege: 0, abseitsVorher: false });
  }
  // Ein Takt. kurve/abseits koennen fuer den Selbsttest uebergeben werden.
  function fahrstilTakt(gas, bremse, lenk, dt, kurveTest, abseitsTest) {
    if (typeof raceState === 'undefined' || (raceState !== 'racing' && raceState !== 'finishing')) return;
    if (!raceGreenAt || !(dt > 0)) return;
    if (fs.schluessel !== raceGreenAt) fahrstilZuruecksetzen(raceGreenAt);
    const car = typeof playerCar !== 'undefined' ? playerCar : null;
    const kurve = kurveTest !== undefined ? kurveTest
      : !!(car && typeof ghostTileInfo === 'function' && ghostTileInfo(car.tileCode).curve > 0);
    const abseits = abseitsTest !== undefined ? abseitsTest : (typeof abseitsJetzt === 'function' && abseitsJetzt());
    fs.zeit += dt;
    fs.gasSumme += gas * dt;
    if (gas > 0.9) fs.gasVoll += dt;
    const bremst = bremse > 0.05;
    if (bremst) { fs.bremsZeit += dt; if (kurve) fs.bremsKurve += dt; }
    if (bremst && !fs.bremsVorher) fs.bremsungen++;
    fs.bremsVorher = bremst;
    if (fs.lenkVorher !== null) fs.lenkWeg += Math.abs(lenk - fs.lenkVorher) / 2;
    fs.lenkVorher = lenk;
    if (abseits && !fs.abseitsVorher) fs.abfluege++;
    fs.abseitsVorher = abseits;
  }
  function fahrstilWerte(rundenMs) {
    if (!(fs.zeit > 5)) return null;
    const min = fs.zeit / 60, r = (x) => Math.round(x * 1000) / 1000;
    const l = (rundenMs || (typeof raceLapTimes !== 'undefined' ? raceLapTimes.map((x) => (x && x.ms !== undefined ? x.ms : x)) : []))
      .filter((x) => x > 0).slice(1);
    let streu = null;
    if (l.length >= 2) {
      const m = l.reduce((a, b) => a + b, 0) / l.length;
      streu = r(Math.sqrt(l.reduce((a, b) => a + (b - m) * (b - m), 0) / (l.length - 1)) / m);
    }
    return { sekunden: Math.round(fs.zeit), vollgas: r(fs.gasVoll / fs.zeit), gas: r(fs.gasSumme / fs.zeit),
             bremse: r(fs.bremsZeit / fs.zeit), bremsungen: r(fs.bremsungen / min),
             bremsKurve: fs.bremsZeit > 0 ? r(fs.bremsKurve / fs.bremsZeit) : null,
             lenkUnruhe: r(fs.lenkWeg / fs.zeit), abfluege: r(fs.abfluege / min), rundenStreu: streu };
  }
  // Fuer die Statistik: Bezeichnungen der Kennwerte.
  const FAHRSTIL_NAMEN = [
    ['vollgas', 'Vollgas-Anteil', 'p'], ['gas', 'Mittleres Gas', 'p'], ['bremse', 'Brems-Anteil', 'p'],
    ['bremsungen', 'Bremsungen je Minute', 'z'], ['bremsKurve', 'Bremsen in der Kurve', 'p'],
    ['lenkUnruhe', 'Lenkunruhe', 'z'], ['abfluege', 'Abflüge je Minute', 'z'], ['rundenStreu', 'Streuung der Rundenzeiten', 'p'],
  ];
