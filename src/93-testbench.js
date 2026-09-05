  // ============================ MESSSTAENDE =========================================
  //
  // Alles, was der Selbsttest in 95-selftest.js braucht, und alles, was man von der
  // Konsole aus messen will. Ausgelagert aus 90-ghosts.js, wo es 39 Prozent der Datei
  // ausmachte.
  //
  // DER BEREICH IST DERSELBE: die IIFE geht ueber alle Quelldateien, zusammengehaengt
  // in Namensreihenfolge. 93- steht hinter dem Ghost-Fahrer (90) und der Codierschule
  // (92) und vor der Motorwerkstatt (94) und dem Selbsttest (95). Jede Funktion und
  // jeder Zustand der frueheren Dateien ist hier sichtbar.
  //
  // ZWEI REGELN, die sich in diesem Projekt teuer gelernt haben:
  //
  //   1. Ein Messstand, der etwas faelscht - Date.now, playerCar, currentTrackTiles,
  //      ghostCfg -, stellt es in einem finally wieder her, und das WIEDERHERSTELLEN
  //      steht VORNE. Eine Aufraeumzeile, die werfen kann, macht alle folgenden
  //      unerreichbar; genau so blieb einmal eine gefaelschte Uhr stehen und legte den
  //      ganzen Selbsttest still.
  //
  //   2. Ein Messstand, der auf echte Zeitgeber wartet, misst im verborgenen Fenster
  //      die Drosselung auf 1 Hz und nicht den Code. Wer eine Zeit braucht, faelscht
  //      sie und stellt sie von Hand.

  window.OMEGA_TEST = {
    // ---- Passt das Cockpit in die Bildschirmhoehe? ---------------------------------
    //
    // Gemessen wird an der EINPASSUNG selbst: sie gibt zurueck, wieviel Platz da ist,
    // wieviel das Cockpit braucht und welcher Faktor daraus folgt. Ein Test, der nur die
    // Kastenhoehe misst, wuerde die Verkleinerung mitmessen und immer gruen sein.
    cockpitPassung(h) { return cockpitPassung(h); },
    // ---- Lassen die Vibrationsschalter das Richtige durch? -------------------------
    //
    // Geprueft wird die SCHALTERLOGIK und nicht der Controller: padRumble meldet, ob der
    // Stoss die Schalter passiert hat. Bei siebzehn Aufrufstellen und sieben Schaltern ist
    // genau das die Stelle, an der man sich vertut - und ohne Controller waere sie sonst
    // gar nicht pruefbar.
    vibProbe() {
      const merkHaupt = rumbleOn;
      const merkArten = Object.assign({}, RUMBLE_ARTEN);
      try {
        const arten = Object.keys(RUMBLE_ARTEN);
        // 1. Hauptschalter aus: nichts kommt durch, egal was angekreuzt ist.
        rumbleOn = false;
        arten.forEach((a) => { RUMBLE_ARTEN[a] = true; });
        const hauptAus = arten.filter((a) => padRumble(0.1, 0.1, 10, a));
        // 2. Hauptschalter an, jede Art einzeln: nur die eingeschaltete kommt durch.
        rumbleOn = true;
        const einzeln = {};
        for (const an of arten) {
          arten.forEach((a) => { RUMBLE_ARTEN[a] = (a === an); });
          einzeln[an] = arten.filter((a) => padRumble(0.1, 0.1, 10, a));
        }
        // 3. Eine unbekannte Art kommt durch - Absicht: wer eine neue Aufrufstelle
        //    einbaut und das Etikett vergisst, soll es merken.
        arten.forEach((a) => { RUMBLE_ARTEN[a] = false; });
        const unbekannt = padRumble(0.1, 0.1, 10, 'gibtsnicht');
        return { arten, hauptAus, einzeln, unbekannt };
      } finally {
        rumbleOn = merkHaupt;
        Object.keys(RUMBLE_ARTEN).forEach((k) => { RUMBLE_ARTEN[k] = merkArten[k]; });
      }
    },

    // ---- Lernt der Scan eine Runde, deren Startcode nie gemeldet wird? --------------
    //
    // Gefuettert wird learnTick mit gebauten Meldepaketen. `runde` ist eine Liste von
    // Codes je Kachel; `sperreBei` sagt, an welcher Kachel die Start/Ziel-Sperre des
    // Autos (Byte 15 Bit 3) steigt. Der Kachelzaehler laeuft mit.
    //
    // Gemessen wird an currentTrackTiles - also an dem, was hinterher wirklich als
    // Strecke dasteht, nicht an einer Zwischengroesse.
    lernProbe(runde, o) {
      const opt = o || {};
      const merkTiles = currentTrackTiles;
      const merkLearn = ghostCfg.learn;
      const echtNow = Date.now;
      try {
        currentTrackTiles = [];
        ghostCfg.learn = true;
        learnReset();
        let uhr = echtNow();
        Date.now = () => uhr;
        let zaehler = 0;
        const paket = (code, sperre) => {
          const b = new Array(16).fill(0);
          b[11] = zaehler & 0xff; b[12] = code; b[15] = sperre ? 0x08 : 0x00;
          return b;
        };
        const runden = opt.runden || 3;
        for (let r = 0; r < runden; r++) {
          for (let i = 0; i < runde.length; i++) {
            const sperre = (opt.sperreBei !== undefined && i === opt.sperreBei);
            // Mehrere Meldungen je Kachel, wie in Wirklichkeit: die Mehrheit entscheidet,
            // und die Sperre haelt ueber mehrere Pakete.
            for (let k = 0; k < 4; k++) {
              uhr += 70;
              learnTick(paket(runde[i], sperre && k < 3));
            }
            zaehler++;
          }
        }
        return { teile: currentTrackTiles.length,
                 typen: currentTrackTiles.map(t => t.type),
                 laps: learn.laps, vorlauf: learn.vorlauf || 0 };
      } finally {
        Date.now = echtNow;
        ghostCfg.learn = merkLearn;
        learnReset();
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ---- Eine RC-Fernbedienung belegen, ohne eine zu haben --------------------------
    //
    // Nachgebaut wird, was gemeldet wurde: Achsen, die NICHT bei null ruhen. Ein
    // rastender Gaskanal meldet dauerhaft -1, und nicht belegte Achsen melden bei vielen
    // HID-Adaptern ebenfalls -1. Genau daran ist die alte Erfassung gescheitert, die den
    // BETRAG gegen 0,6 verglich.
    //
    // `folge` ist eine Liste von Achsenstellungen; die erste ist die Ruhe.
    padBelegungProbe(aktion, folge, o) {
      const opt = o || {};
      const merkB = JSON.parse(JSON.stringify(bindings));
      const merkL = listeningFor;
      try {
        const pad = (achsen, knoepfe) => ({
          axes: achsen.slice(),
          buttons: (knoepfe || []).map((v) => ({ value: v, pressed: v > 0.5 })),
          mapping: opt.mapping || '',
        });
        listeningFor = aktion;
        bindRuhe = null;
        for (const schritt of folge) {
          tryCaptureBinding(pad(schritt.achsen, schritt.knoepfe));
        }
        const b = bindings[aktion];
        // Und was liest die App danach an den gegebenen Stellungen?
        const gelesen = (opt.lesen || []).map((achsen) =>
          +readBindingValue(pad(achsen, []), bindings[aktion]).toFixed(3));
        return { belegt: b ? { type: b.type, index: b.index, invert: !!b.invert,
                               ruhe: b.ruhe, min: b.min, max: b.max } : null,
                 offen: listeningFor !== null, gelesen };
      } finally {
        listeningFor = merkL;
        bindRuhe = null;
        Object.keys(bindings).forEach((k) => delete bindings[k]);
        Object.keys(merkB).forEach((k) => { bindings[k] = merkB[k]; });
      }
    },
    // ---- Die Zustandsansagen, ohne Stimme und ohne Rennen -------------------------
    //
    // ansagenPruefen() nimmt die Werte als Argument, laesst sich also ohne laufendes
    // Rennen fuettern. Zurueck kommt, WELCHE Meldung gefallen ist - und genau daran
    // haengt die Pruefung, dass jede nur EINMAL faellt und erst nach der Hysterese
    // wieder scharf ist.
    ansagenFolge(schritte, o) {
      const opt = o || {};
      const merk = {};
      const kaesten = { lap: 'setting-announce', damage: 'setting-announce-damage',
                        fuel: 'setting-announce-fuel', tyre: 'setting-announce-tyre',
                        rain: 'setting-announce-rain' };
      // Die Kaestchen setzen und hinterher zuruecklegen: der Test darf die Einstellung
      // des Nutzers nicht behalten.
      try {
        Object.keys(kaesten).forEach((art) => {
          const el = $(kaesten[art]);
          if (!el) return;
          merk[art] = el.checked;
          el.checked = opt.aus ? false : true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // Ohne Stimme im System kaeme nichts zurueck. Der Aufbau ersetzt sie deshalb
        // durch eine Attrappe - geprueft wird die REGEL, nicht das Betriebssystem.
        const echt = window.speechSynthesis;
        const gesagt = [];
        try {
          Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: { cancel() {}, speak(u) { gesagt.push(u.text); } },
          });
          const folge = schritte.map((w) => ({ w, fiel: ansagenPruefen(w) }));
          return { folge, gesagt };
        } finally {
          if (echt) {
            Object.defineProperty(window, 'speechSynthesis',
                                  { configurable: true, value: echt });
          } else {
            delete window.speechSynthesis;
          }
        }
      } finally {
        Object.keys(merk).forEach((art) => {
          const el = $(kaesten[art]);
          if (!el) return;
          el.checked = merk[art];
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
    },
    // Die Gaskennlinie als reine Rechnung, siehe gasKennlinie() in 40-physics.js.
    gasKennlinie,
    // Und der gelebte Zustand der zwei Regler, damit ein Test die VERDRAHTUNG prueft und
    // nicht nur die Formel: ein Regler, der rechnet und nichts setzt, waere sonst gruen.
    fahrgefuehlWerte() {
      return { throttleGamma: physEngine.config.throttleGamma,
               minMoveThrottle: physEngine.config.minMoveThrottle,
               topSpeedKmh: physEngine.config.topSpeedKmh, massstab: REAL_SCALE };
    },

    // ---- Haelt der Ghost an, wenn er anhalten soll - und nur dann? ------------------
    //
    // Spielt eine gemessene Lage nach: das Auto meldet ueber `nullMs` durchgehend 0x00,
    // waehrend der Kachelzaehler alle `kachelMs` weiterlaeuft. Genau diese zwei Zahlen
    // stehen in den Mitschnitten, und genau an ihnen trennt sich Fahren von Abflug.
    //
    // Getaktet wird von Hand mit gefaelschter Uhr: ein Prueflauf an echten Zeitgebern
    // misst im verborgenen Fenster die Drosselung statt der Regel.
    ghostParkProbe(o) {
      const opt = o || {};
      const nullMs = opt.nullMs === undefined ? 1000 : opt.nullMs;
      const kachelMs = opt.kachelMs === undefined ? 450 : opt.kachelMs;
      const vorlaufMs = opt.vorlaufMs === undefined ? 4000 : opt.vorlaufMs;
      const merkGarage = garage.slice();
      const keepTiles = currentTrackTiles;
      const echtNow = Date.now;
      const merkNeed = ghostCfg.needCode;
      try {
        currentTrackTiles = codeToTrack(opt.code || 'SG2H2G2R2').tiles;
        lineCache = null;
        let uhr = echtNow();
        Date.now = () => uhr;
        const car = { role: 'ghost', alias: 'Parkprobe', writeInFlight: false,
                      tileCode: 0x02, tileCount: 0, lastCodeAt: uhr, yaw: 0,
                      rx: { properties: { writeWithoutResponse: true },
                            writeValueWithoutResponse() { return Promise.resolve(); } } };
        garage.push(car);
        startGhost(car);
        ghostTaktLoeschen(car);
        car.ghost.freeRun = true;
        // Die Startgnade absichtlich ABLAUFEN lassen: geprueft wird die Haltebedingung im
        // Fahrbetrieb, nicht die Gnade. Fuer die gibt es den eigenen Fall unten.
        let k = 0, seitKachel = 0;
        const takt = (code, dauer) => {
          const bis = uhr + dauer;
          while (uhr < bis) {
            uhr += CONTROL_SEND_INTERVAL_MS;
            seitKachel += CONTROL_SEND_INTERVAL_MS;
            if (seitKachel >= kachelMs) {
              seitKachel = 0; k++;
              car.tileCount = k & 0xff;
              car.tileAt = uhr;
            }
            car.tileCode = code;
            // Ein gueltiger Code frischt lastCodeAt auf - genau wie onCarNotify es tut,
            // und 0x00 tut es ausdruecklich NICHT.
            if (code !== 0x00 && code !== 0xff) car.lastCodeAt = uhr;
            ghostTick(car);
          }
        };
        // Erst normal fahren, damit der Kachelring gefuellt ist und die Gnade ablaeuft.
        takt(0x02, vorlaufMs);
        const vorher = !!car.parked;
        takt(0x00, nullMs);
        return { nullMs, kachelMs, vorher, geparkt: !!car.parked,
                 grund: car.parked || null,
                 ringMittel: car.ghost && car.ghost.tileRing && car.ghost.tileRing.length
                   ? Math.round(car.ghost.tileRing.reduce((a, b) => a + b, 0)
                                / car.ghost.tileRing.length) : null };
      } finally {
        Date.now = echtNow;
        ghostCfg.needCode = merkNeed;
        garage.forEach(c => { if (String(c.alias || '') === 'Parkprobe') {
          ghostTaktLoeschen(c); if (c.ghost) c.ghost.running = false; } });
        garage.splice(0, garage.length, ...merkGarage);
        currentTrackTiles = keepTiles;
        lineCache = null;
      }
    },

    // ---- Kommt ein geparkter Ghost durch einen Neustart wieder hoch? ---------------
    //
    // Der gemeldete Fall: "nach einer Weile bleiben sie einfach stehen und blinken.
    // Neustart des Rennens, Zuruecksetzen, usw. funktioniert nicht." Die Ursache ist ein
    // Kreis - geparkt heisst Gas 0, also keine Fahrt, also kein Code, also parkt der
    // Neustart sofort wieder ein. Geprueft wird an der ENTSCHEIDUNG, nicht am Knopf.
    ghostNeustartProbe(o) {
      const opt = o || {};
      const merkGarage = garage.slice();
      const keepTiles = currentTrackTiles;
      const echtNow = Date.now;
      try {
        currentTrackTiles = codeToTrack('SG2H2G2R2').tiles;
        lineCache = null;
        let uhr = echtNow();
        Date.now = () => uhr;
        // 0x00 und NICHT 0xff: needCode ist standardmaessig aus, es parkt also der
        // 0x00-Zweig. Ein Prueflauf mit 0xff wuerde an der Vorgabe vorbeimessen - genau
        // das ist mir beim ersten Anlauf passiert.
        const car = { role: 'ghost', alias: 'Neustartprobe', writeInFlight: false,
                      tileCode: 0x00, tileCount: 0, yaw: 0,
                      // Ein Auto, das seit langem NICHTS gelesen hat - genau die Lage nach
                      // einem Abgang, in der es stand und deshalb nichts lesen konnte.
                      lastCodeAt: uhr - 60000,
                      rx: { properties: { writeWithoutResponse: true },
                            writeValueWithoutResponse() { return Promise.resolve(); } } };
        garage.push(car);
        startGhost(car);
        ghostTaktLoeschen(car);
        car.ghost.freeRun = true;
        const schritte = [];
        let naechste = 0, t = 0;
        // Ueber die Gnadenzeit hinaus, damit BEIDE Seiten geprueft sind: waehrend der
        // Gnade darf es fahren, danach muss es stehen - sonst faehrt ein Auto neben der
        // Bahn ewig weiter, und die Gnade waere ein Loch statt einer Frist.
        const bisMs = opt.bisMs || (GHOST_START_GNADE_MS + 2500);
        while (t < bisMs) {
          uhr += CONTROL_SEND_INTERVAL_MS;
          t += CONTROL_SEND_INTERVAL_MS;
          ghostTick(car);
          if (t >= naechste) { schritte.push({ ms: t, geparkt: !!car.parked }); naechste += 500; }
        }
        return { schritte, gnadeMs: GHOST_START_GNADE_MS, bisMs,
                 inGnade: schritte.filter(x => x.ms < GHOST_START_GNADE_MS - 200)
                                  .every(x => !x.geparkt),
                 nachGnade: !!car.parked,
                 needCode: ghostCfg.needCode };
      } finally {
        Date.now = echtNow;
        garage.forEach(c => { if (String(c.alias || '') === 'Neustartprobe') {
          ghostTaktLoeschen(c); if (c.ghost) c.ghost.running = false; } });
        garage.splice(0, garage.length, ...merkGarage);
        currentTrackTiles = keepTiles;
        lineCache = null;
      }
    },

    // ---- Zaehlt die Start/Ziel-Sperre die Runde, und schlaegt sie den Startcode? ----
    //
    // Gefuettert wird carRaceNotify mit gebauten Meldepaketen. Byte 15 Bit 3 ist die
    // Sperre des AUTOS, Byte 12 der Streckencode, Byte 11 der Kachelzaehler.
    zielSperreProbe(o) {
      const opt = o || {};
      const merkState = raceState;
      const echtNow = Date.now;
      try {
        raceState = 'racing';
        let uhr = echtNow();
        Date.now = () => uhr;
        // lapStart VORBELEGEN: die erste Ueberfahrt setzt sonst nur die Rundenuhr und
        // erzeugt keine Runde - dann waere "0 Runden" zweideutig (keine Ueberfahrt oder
        // die erste?). So ist jede Ueberfahrt eine Runde.
        const car = { role: 'ghost', alias: 'Zielprobe',
                      race: { laps: [], lapStart: uhr, pending: null, seen: 0,
                              lastActed: 0, lastCount: null } };
        const paket = (code, count, sperre) => {
          const b = new Array(16).fill(0);
          b[11] = count & 0xff; b[12] = code; b[15] = sperre ? 0x08 : 0x00;
          return b;
        };
        const runden = () => (car.race && car.race.laps ? car.race.laps.length : 0);
        const folge = [];
        // 1. Der Startbereich: Code 0x01 ueber mehrere Kacheln, OHNE Sperre. Ohne die
        //    Sperre zaehlt der Rueckfall - das ist das alte Verhalten.
        for (let i = 0; i < 6; i++) {
          uhr += 200;
          carRaceNotify(car, paket(0x01, i, false));
        }
        folge.push({ lage: 'nur Startcode', runden: runden() });
        const nurCode = runden();
        // 2. Jetzt die Sperre. Sie muss zaehlen.
        uhr += 2000;
        carRaceNotify(car, paket(0x01, 9, true));
        folge.push({ lage: 'Sperre steigt', runden: runden() });
        const mitSperre = runden();
        // 3. Die Sperre STEHT eine Sekunde: kein zweites Zaehlen.
        for (let i = 0; i < 15; i++) {
          uhr += 69;
          carRaceNotify(car, paket(0x01, 10 + i, true));
        }
        folge.push({ lage: 'Sperre steht', runden: runden() });
        const wahrendSperre = runden();
        // 4. Sperre faellt, Startcode laeuft weiter: der Rueckfall darf jetzt NICHT mehr
        //    zaehlen, sonst laege die Runde zweimal.
        for (let i = 0; i < 12; i++) {
          uhr += 300;
          carRaceNotify(car, paket(0x01, 40 + i, false));
        }
        folge.push({ lage: 'nach der Sperre', runden: runden() });
        return { folge, nurCode, mitSperre, wahrendSperre, ende: runden() };
      } finally {
        Date.now = echtNow;
        raceState = merkState;
      }
    },
    // Der Versatz eines Ghosts gegen den Herzschlag, als reine Rechnung. Siehe
    // ghostTaktVersatz(): ohne Zeitgeber pruefbar, und darauf kommt es an.
    ghostTaktVersatz,

    // ---- Was kostet EIN Steuertakt? ---------------------------------------------
    //
    // Die Frage, aus der das hier entstanden ist, lautete: laesst sich die Rechnung
    // beschleunigen, weil mit zwei Ghosts eine Eingabeverzoegerung spuerbar ist? Die
    // Antwort war nein, und nicht nach Gefuehl - gemessen kostet der ganze Takt mit drei
    // Autos rund 0,3 ms von 45. Dieser Aufbau haelt die Antwort nachpruefbar.
    //
    // Gemessen wird an den ECHTEN Funktionen des Herzschlags und nicht an einem Nachbau:
    // physicsStep, pitLaneTick, sendControlValue, dazu ghostTick je Ghost. Das Ziel des
    // Schreibvorgangs ist ein Stummel, der sofort fertig ist - hier geht es um die
    // Rechnung, der Funk wird in sendeUnterLast gemessen.
    //
    // DIE WERTE MUESSEN WACKELN, sonst misst man zu guenstig: schreibeWert() vergleicht
    // erst und schreibt nur bei Aenderung, und nur eine Aenderung erzwingt den Umbruch des
    // Bildaufbaus, den es beim Fahren gibt.
    taktKosten(o) {
      const opt = o || {};
      const n = opt.ghosts === undefined ? 2 : opt.ghosts;
      const takte = opt.takte || 200;
      const keepTiles = currentTrackTiles;
      const keepGarage = garage.slice();
      const merkPlayer = playerCar;
      const echtNow = Date.now;
      const stumm = { properties: { writeWithoutResponse: true },
                      writeValueWithoutResponse() { return Promise.resolve(); } };
      try {
        const p = codeToTrack(opt.code || 'SG2H2G2R2');
        currentTrackTiles = p.tiles;
        lineCache = null;
        let uhr = echtNow();
        Date.now = () => uhr;
        playerCar = { role: 'player', alias: 'Taktsonde', writeInFlight: false, rx: stumm };
        const autos = [];
        for (let a = 0; a < n; a++) {
          const car = { role: 'ghost', alias: 'Taktsonde' + a, writeInFlight: false,
                        tileCode: 0x02, tileCount: 0, lastCodeAt: uhr, yaw: 0, rx: stumm };
          garage.push(car);
          autos.push(car);
        }
        autos.forEach(c => { startGhost(c); ghostTaktLoeschen(c); c.ghost.freeRun = true;
                             c.ghost.bias = 0; });
        const st = physEngine.state;
        const messe = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
        // Einlaufen: der erste Takt baut Zwischenspeicher auf und ist nicht typisch.
        for (let i = 0; i < 20; i++) { physicsStep(); autos.forEach(c => ghostTick(c)); }
        const ganz = [], gh = [];
        let seitKachel = 0, k = 0;
        for (let i = 0; i < takte; i++) {
          uhr += CONTROL_SEND_INTERVAL_MS;
          seitKachel += CONTROL_SEND_INTERVAL_MS;
          if (seitKachel >= 700) {
            seitKachel = 0; k++;
            autos.forEach(c => { c.tileCount = k & 0xff; c.tileAt = uhr;
                                 c.tileCode = p.tiles[(k - 1) % p.tiles.length].type; });
          }
          autos.forEach(c => { c.lastCodeAt = uhr; });
          st.speedKmh = 0.5 + 3.4 * Math.abs(Math.sin(i / 17));
          st.rpmFrac = Math.abs(Math.sin(i / 11));
          st.tyreTempC = 60 + 30 * Math.sin(i / 23);
          const g = messe(() => { for (const c of autos) ghostTick(c); });
          gh.push(g);
          ganz.push(g + messe(() => {
            physicsStep();
            pitLaneTick();
            sendControlValue(0.3 * Math.sin(i / 9), 0.6);
          }));
        }
        const stat = (a) => { const s = a.slice().sort((x, y) => x - y);
          return { med: +s[Math.floor(s.length / 2)].toFixed(3),
                   p95: +s[Math.floor(s.length * 0.95)].toFixed(3),
                   max: +s[s.length - 1].toFixed(3) }; };
        return { ghosts: n, takte, budgetMs: CONTROL_SEND_INTERVAL_MS,
                 ganzerTakt: stat(ganz), ghostAnteil: stat(gh),
                 tonAn: !!(typeof audioCtx !== 'undefined' && audioCtx) };
      } finally {
        Date.now = echtNow;
        playerCar = merkPlayer;
        garage.forEach(c => { if (String(c.alias || '').startsWith('Taktsonde')) {
          ghostTaktLoeschen(c); if (c.ghost) c.ghost.running = false; } });
        garage.splice(0, garage.length, ...keepGarage);
        currentTrackTiles = keepTiles;
        lineCache = null;
      }
    },

    // ---- Was passiert, wenn ein Schreibvorgang laenger dauert als ein Takt? -----
    //
    // DIE MESSUNG, die den Umbau in sendControlValue ausgeloest hat. Ein Ziel, dessen
    // Schreibvorgang eine einstellbare Zeit braucht, und gezaehlt werden die Pakete, die
    // wirklich hinausgehen. Vorher wurde ein Takt VERWORFEN, solange ein Schreibvorgang
    // lief - eine Millisekunde ueber dem Takt halbierte damit die Befehlsrate.
    //
    // Der laufende Herzschlag treibt das und nicht eine Schleife: gemessen werden soll das
    // Zusammenspiel von Zeitgeber und Schreibweg, und genau daran lag es.
    async sendeUnterLast(o) {
      const opt = o || {};
      const schreibMs = opt.schreibMs === undefined ? 60 : opt.schreibMs;
      const ms = opt.ms || 3000;
      // Kein echtes Auto uebernehmen: waehrend der Messung bekaeme es keine Befehle.
      if (playerCar && playerCar.device) return { echtesAuto: true };
      const merkPlayer = playerCar;
      // GEFAELSCHTE UHR IN MILLISEKUNDEN, und der Grund ist gemessen: ein verborgenes
      // Fenster drosselt setInterval auf 1 Hz, der echte Herzschlag liefert dort 1,2 statt
      // 22,4 Pakete je Sekunde. Ein Messstand an der echten Uhr misst im Selbsttest also
      // die Drosselung. Gestellt wird deshalb von Hand, und der Schreibvorgang wird fertig,
      // wenn die gefaelschte Uhr weit genug ist.
      const zeiten = [];
      const offen = [];
      let uhr = 0;
      try {
        playerCar = {
          role: 'player', alias: 'Funksonde', writeInFlight: false,
          rx: { properties: { writeWithoutResponse: true },
                writeValueWithoutResponse() {
                  zeiten.push(uhr);
                  return new Promise(res => offen.push({ fertigAt: uhr + schreibMs, res }));
                } },
        };
        for (uhr = 0; uhr <= ms; uhr++) {
          // ERST die fertigen Schreibvorgaenge abschliessen, dann der Takt. Umgekehrt
          // saehe ein Schreibvorgang, der genau jetzt fertig wird, noch als laufend aus.
          for (let i = offen.length - 1; i >= 0; i--) {
            if (offen[i].fertigAt <= uhr) { const r = offen[i].res; offen.splice(i, 1); r(); }
          }
          // Den Mikrotasks Luft lassen: funkSchreiben setzt sein Wartendes NACH einem
          // await ab, und ohne diese Pause kaeme das gemerkte Paket nie hinaus.
          await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
          if (uhr % CONTROL_SEND_INTERVAL_MS === 0) {
            sendControlValue(0.2, 0.5);
            await Promise.resolve(); await Promise.resolve();
          }
        }
      } finally {
        // ALLES OFFENE ABSCHLIESSEN, sonst wartet funkSchreiben ewig auf einen
        // Schreibvorgang, den diese Uhr nicht mehr weiterstellt - und writeInFlight bliebe
        // bis zum Neuladen auf wahr. Gemessen ist das kein theoretischer Fall: die erste
        // Fassung dieses Aufbaus liess einen offen, und danach lieferten alle folgenden
        // Laeufe null Pakete. Ein Schreibvorgang, der nie fertig wird, legt die Steuerung
        // still - das gilt fuer die App genauso, nur dass dort ein echtes Geraet am anderen
        // Ende sitzt, das seine Zusage einloest oder abweist.
        // Der Deckel ist nicht Zierde: ohne ihn haengt das Aufraeumen an einer Zusage,
        // die dieser Aufbau selbst gibt, und ein Aufbau, der haengen kann, ist schlimmer
        // als kein Aufbau.
        for (let k = 0; k < 8 && (offen.length || writeInFlight); k++) {
          while (offen.length) offen.pop().res();
          await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        }
        playerCar = merkPlayer;
      }
      const ab = [];
      for (let i = 1; i < zeiten.length; i++) ab.push(zeiten[i] - zeiten[i - 1]);
      const s = ab.slice().sort((x, y) => x - y);
      return { schreibMs, ms, pakete: zeiten.length,
               rateHz: +(zeiten.length / (ms / 1000)).toFixed(1),
               med: s.length ? s[Math.floor(s.length / 2)] : null,
               // Was ueberhaupt moeglich ist: schneller als ein Schreibvorgang geht nicht,
               // und mehr als ein Paket je Takt entsteht nicht.
               obergrenzeHz: +Math.min(1000 / Math.max(1, schreibMs),
                                       1000 / CONTROL_SEND_INTERVAL_MS).toFixed(1) };
    },

    // ---- Liegen die Sendezeitpunkte auseinander? --------------------------------
    //
    // Fuer jedes Ghost-Paket der Abstand zum naechstgelegenen Paket des Spielerautos.
    // Soll ist 45/(n+1); gemessen wurde vor v0.5.8 bei einem der zwei Ghosts 0,7 ms.
    async ghostPhasen(o) {
      const opt = o || {};
      const n = opt.ghosts === undefined ? 2 : opt.ghosts;
      const ms = opt.ms || 1500;
      if (playerCar && playerCar.device) return { echtesAuto: true };
      const merkPlayer = playerCar, merkGarage = garage.slice(), keepTiles = currentTrackTiles;
      const spieler = [], ghosts = [];
      const stub = (liste, k) => ({ properties: { writeWithoutResponse: true },
        writeValueWithoutResponse() { liste.push({ t: performance.now(), k });
                                      return Promise.resolve(); } });
      const gs = [];
      try {
        currentTrackTiles = codeToTrack(opt.code || 'SG2H2G2R2').tiles;
        lineCache = null;
        const auto = { role: 'player', alias: 'Phasensonde', writeInFlight: false,
                       rx: stub(spieler, -1) };
        playerCar = auto;
        garage.push(auto);
        for (let a = 0; a < n; a++) {
          const c = { role: 'ghost', alias: 'Phasensonde' + a, writeInFlight: false,
                      tileCode: 0x02, tileCount: 0, lastCodeAt: Date.now(), yaw: 0,
                      rx: stub(ghosts, a) };
          garage.push(c); gs.push(c);
        }
        gs.forEach(c => { startGhost(c); c.ghost.freeRun = true; });
        await new Promise(r => setTimeout(r, ms));
      } finally {
        gs.forEach(c => { ghostTaktLoeschen(c); if (c.ghost) c.ghost.running = false; });
        playerCar = merkPlayer;
        garage.splice(0, garage.length, ...merkGarage);
        currentTrackTiles = keepTiles; lineCache = null;
      }
      const naechster = (t) => {
        let best = 1e9;
        for (const p of spieler) { const d = Math.abs(p.t - t); if (d < best) best = d; }
        return best;
      };
      const je = gs.map((c, a) => {
        const ds = ghosts.filter(x => x.k === a).map(x => naechster(x.t)).sort((x, y) => x - y);
        return ds.length ? { pakete: ds.length, med: +ds[Math.floor(ds.length / 2)].toFixed(1),
                             min: +ds[0].toFixed(1) } : null;
      });
      return { ms, spielerPakete: spieler.length, je,
               soll: +(CONTROL_SEND_INTERVAL_MS / (n + 1)).toFixed(1) };
    },

    // ---- Hoert ein angehaltener Ghost wirklich auf zu ticken? -------------------
    //
    // Der Fall, der 35 Phantom-Zeitgeber je Selbsttestlauf hinterliess: anhalten, BEVOR
    // der wartende setTimeout den Zeitgeber ueberhaupt angelegt hat. Gemessen wird an
    // gesendeten Paketen und nicht an car.timer - der Zeitgeber war ja gerade der, den
    // niemand mehr kannte.
    async ghostHaltProbe(o) {
      const opt = o || {};
      const warten = opt.warten || 1600;
      const merkGarage = garage.slice(), keepTiles = currentTrackTiles;
      const bau = (name, liste) => ({
        role: 'ghost', alias: name, writeInFlight: false,
        tileCode: 0x02, tileCount: 0, lastCodeAt: Date.now(), yaw: 0,
        rx: { properties: { writeWithoutResponse: true },
              writeValueWithoutResponse() { liste.push(1); return Promise.resolve(); } } });
      const gestoppt = [], laeuft = [];
      const a = bau('Haltprobe0', gestoppt), b = bau('Haltprobe1', laeuft);
      try {
        currentTrackTiles = codeToTrack('SG2H2G2R2').tiles;
        lineCache = null;
        garage.push(a, b);
        startGhost(a);
        // SOFORT wieder anhalten - im selben Takt, also lange bevor der Zeitgeber steht.
        stopGhost(a);
        const nachHalt = gestoppt.length;
        startGhost(b);
        b.ghost.freeRun = true;
        // AUF DAS EREIGNIS WARTEN und nicht auf eine feste Zeit: im verborgenen Fenster
        // sind Zeitgeber auf 1 Hz gedrosselt, und dann kaeme in 240 ms kein einziger Takt -
        // die Gegenprobe waere rot, ohne dass etwas kaputt ist.
        const bis = Date.now() + warten;
        while (!laeuft.length && Date.now() < bis) {
          await new Promise(r => setTimeout(r, 30));
        }
        return { warten,
                 // Nach dem Halt darf NICHTS mehr dazukommen. stopGhost selbst schreibt
                 // eine Nullnachricht, die zaehlt also nicht mit.
                 nachHalt: gestoppt.length - nachHalt,
                 // Gegenprobe: ein Ghost, den niemand anhaelt, MUSS ticken.
                 laufend: laeuft.length };
      } finally {
        [a, b].forEach(c => { ghostTaktLoeschen(c); if (c.ghost) c.ghost.running = false; });
        garage.splice(0, garage.length, ...merkGarage);
        currentTrackTiles = keepTiles; lineCache = null;
      }
    },
    ghostSpeedControl, GHOST_UNPARK_RAMP_MS,
    TILE_TYPE, TILE_LABEL,
    codeToTrack, trackToCode,
    tileTightness, tileTurnDeg, tileIsCurve, ghostTileLenFactor,
    crc8, buildCommandPacket,
    // Die zwei Linienmodelle und ihre Bausteine, damit beide gegeneinander messbar sind:
    // kruemmungsaermste Linie gegen rundenzeitschnellste, auf demselben Layout.
    idealLine, lapTimeLine, lapTimeOf, trackCenterline, trackNormals, pathCurvature,
    // Lenkgrip bei gegebener Oberflaeche und Fahrt. Einschwingen lassen, nicht einen
    // einzelnen Takt lesen: loadFront und longUse haengen an Zeitkonstanten, und ein
    // Momentanwert waere eine andere Groesse als die, die man beim Fahren spuert.
    physSteerGrip(o) {
      const e = physEngine, st = e.state, cfg = e.config;
      // VOLLSTAENDIG sichern und nicht acht namentlich aufgezaehlte Felder: dieser Aufbau
      // faehrt 40 Takte, und die heizen Reifen, nutzen sie ab und heizen die Bremsscheiben.
      // Mit einer handverlesenen Liste blieb all das veraendert zurueck - und eine solche
      // Liste veraltet genau dann, wenn das Modell waechst.
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = { gs: cfg.gripScale };
      // Zusaetzliche Konfigurationswerte, damit eine Anpassung messbar ist und nicht nur
      // ablesbar. Werden wie alles andere zurueckgelegt.
      const merkP = {};
      for (const k of Object.keys((o && o.patch) || {})) merkP[k] = cfg[k];
      try {
        for (const k of Object.keys((o && o.patch) || {})) cfg[k] = o.patch[k];
        cfg.gripScale = o.gripScale === undefined ? 1 : o.gripScale;
        st.speedKmh = o.kmh / REAL_SCALE;
        st.driveMode = 'forward';
        st.currentGear = o.gear === undefined ? 2 : o.gear;
        st.tyreGrip = 1; st.loadFront = 0.5; st.longUse = 0;
        // Bekannter Anfangsstand, sonst haengt das Ergebnis daran, was vorher gefahren wurde.
        for (let i = 0; i < 4; i++) {
          st.tyreWear4[i] = 0;
          st.tyreTemp4[i] = cfg.tyreOptimalC;
          st.brakeTemp4[i] = cfg.brakeAmbientC;
        }
        const inp = { throttle: o.throttle || 0, brake: o.brake || 0,
                      steering: o.steering === undefined ? 0.3 : o.steering };
        for (let i = 0; i < 40; i++) {
          st.speedKmh = o.kmh / REAL_SCALE;      // Fahrt festhalten, nur den Grip messen
          e.update(inp, 0.02);
        }
        return { steerGrip: st.steerGrip, gripLong: st.gripLong,
                 loadFront: st.loadFront, longUse: st.longUse,
                 // Der UEBERTRAGENE Winkel und der Wunsch davor. Ohne beide muesste die
                 // Messung nachrechnen, was das Modell rechnet - und wuerde jeden Fehler
                 // darin mitmachen.
                 winkel: e.outputs.servoAngle,
                 wunsch: st.steerDemand,
                 grad: Math.round(Math.abs(e.outputs.servoAngle) * 45),
                 // Die vier Radlasten, Reihenfolge VL, VR, HL, HR. Ohne sie ist die
                 // Vierradverlagerung nicht pruefbar.
                 load4: st.load4 ? st.load4.slice() : null,
                 lat4: st.latShare4 ? st.latShare4.slice() : null };
      } finally {
        for (const k of Object.keys(merkP)) cfg[k] = merkP[k];
        cfg.gripScale = merk.gs;
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },
    // Der uebertragene Lenkwinkel ueber eine echte Fahrt: beschleunigen, dann bremsen, bei
    // konstanter Lenkvorgabe. servoAngle ist das, was am Auto ankommt, und es haengt an
    // dampedSteering, aquaFactor und steerGrip zugleich - einzeln gelesen sagt keins davon,
    // was der Fahrer spuert.
    physSteerTrace(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const lenk = opt.steering === undefined ? 0.6 : opt.steering;
      const bis = opt.bisKmh || 120;
      const bremse = opt.brake === undefined ? 1 : opt.brake;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      const dt = 0.02;
      try {
        // Kalibrierbezug, siehe physCurve: sonst misst diese Pruefung den Reglerstand.
        Object.assign(cfg, e.calibRef);
        // Schubskala neu loesen, siehe physCurve: calibRef traegt den Startwert von
        // accelCalibration und nicht den geloesten.
        e.calibrateAccel();
        cfg.autoShift = true; cfg.tyreEffect = 0;
        // Und ZULETZT die ausdruecklich abweichenden Werte. Ohne diesen Haken kann man mit
        // diesem Aufbau keinen Parameter durchfahren: der Kalibrierbezug oben setzt jedes
        // Feld zurueck, also auch das, dessen Wirkung man messen will. Genau daran ist die
        // Bremsbalance-Pruefung gescheitert - drei Messungen, dreimal derselbe Wert,
        // Spanne 0.
        //
        // Die Reihenfolge ist die Aussage: Bezug herstellen, dann genau eine Sache
        // aendern. Das ist der Unterschied zwischen einer Messung und einer Beobachtung.
        if (opt.cfg) Object.assign(cfg, opt.cfg);
        st.driveMode = 'neutral'; st.currentGear = 0; st.speedKmh = 0;
        st.isShifting = false; st.neutralRpm = 0; st.fuelLoad = 1;
        st.loadFront = 0.5; st.longUse = 0; st.dampedSteering = 0;
        const takt = (inp) => {
          if (st.isShifting) {
            st._simShift = (st._simShift || 0) + dt;
            if (st._simShift * 1000 >= cfg.shiftMs) { st.isShifting = false; st._simShift = 0; }
          }
          return e.update(inp, dt);
        };
        // Beschleunigen bis zur Marke, Lenkung schon anliegend.
        let n = 0;
        while (st.speedKmh * REAL_SCALE < bis && n < 2000) {
          takt({ throttle: 1, brake: 0, steering: lenk }); n++;
        }
        const rollen = [];
        // Kurz ausrollen lassen, damit der Bezugswert ohne Bremse dasteht.
        for (let i = 0; i < 25; i++) {
          const out = takt({ throttle: 0, brake: 0, steering: lenk });
          rollen.push({ kmh: Math.round(st.speedKmh * REAL_SCALE),
                        winkel: +out.servoAngle.toFixed(3) });
        }
        // Und jetzt bremsen bis zum Stand.
        const spur = [];
        n = 0;
        while (st.speedKmh * REAL_SCALE > 0.5 && n < 2000) {
          const out = takt({ throttle: 0, brake: bremse, steering: lenk });
          spur.push({ kmh: +(st.speedKmh * REAL_SCALE).toFixed(1),
                      winkel: +out.servoAngle.toFixed(3),
                      grip: +st.steerGrip.toFixed(3),
                      grenze: +st.dampedSteering.toFixed(3) });
          n++;
        }
        // Und im Stand weiter lenken, ohne Bremse.
        const stand = [];
        for (let i = 0; i < 40; i++) {
          const out = takt({ throttle: 0, brake: 0, steering: lenk });
          stand.push(+out.servoAngle.toFixed(3));
        }
        return { rollen: rollen[rollen.length - 1], bremsspur: spur,
                 imStand: stand[stand.length - 1] };
      } finally {
        Object.assign(cfg, merk);
        // Die Schubskala haengt an den zurueckgelegten Werten und muss neu geloest
        // werden - sonst rechnet die App danach mit der Skala des Bezugszustands,
        // waehrend die Regler etwas anderes anzeigen.
        e.calibrateAccel();
        delete st._simShift;
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },
    // Werte setzen, neu kalibrieren, messen. Der Kern jeder Kalibrierung: jede Aenderung
    // an einem Wert verschiebt ALLE Marken, also braucht man die ganze Kurve nach jeder
    // Aenderung, und das muss in einem Aufruf gehen, damit eine Suche mechanisch laufen kann.
    //
    // Die Werte werden danach zurueckgelegt: eine Suche darf die App nicht verstellen.
    physFit(patch, kurveOpt) {
      const cfg = physEngine.config;
      const merk = {};
      for (const k of Object.keys(patch || {})) merk[k] = cfg[k];
      const merkCal = cfg.accelCalibration;
      try {
        for (const k of Object.keys(patch || {})) cfg[k] = patch[k];
        if (physEngine.rebuildGearModel) physEngine.rebuildGearModel();
        physEngine.calibrateAccel();
        return this.physCurve(kurveOpt);
      } finally {
        for (const k of Object.keys(merk)) cfg[k] = merk[k];
        cfg.accelCalibration = merkCal;
        if (physEngine.rebuildGearModel) physEngine.rebuildGearModel();
      }
    },
    // Die ganze Fahrleistungskurve: Beschleunigung bis zu mehreren Marken und Bremsen von
    // mehreren Marken. Alles in ANGEZEIGTEN km/h, weil die Sollwerte so vorliegen.
    //
    // Ueber update(), also durch dieselbe Kette wie beim Fahren, mit eigener Uhr fuer die
    // Schaltpause: triggerShift loescht isShifting per setTimeout, und das feuert in einer
    // synchronen Schleife nie. Ohne diese Uhr bleibt der Schub nach dem ersten Schalten aus,
    // und die Messung sagt "wird langsamer" statt "schaltet".
    // Wo weicht die laufende Konfiguration vom Kalibrierbezug ab?
    //
    // Diese Frage hat mich in dieser Sitzung dreimal Zeit gekostet, und jedes Mal war die
    // Antwort dieselbe Fehlerklasse: ein Regler, dessen Vorgabe im Markup nicht zu der im
    // Modell passt. Die App rechnet dann mit dem Modellwert, waehrend die Anzeige den
    // Markup-Wert zeigt - bis jemand den Regler einmal anfasst, und dann springt das
    // Verhalten. So war es bei topSpeedScale und beim Tankgewicht.
    //
    // gears wird uebersprungen, aber nicht mehr aus dem alten Grund: seit es
    // Getriebearten gibt, WIRD das Array geaendert. Uebersprungen wird es, weil ein
    // Wertevergleich hier ein Tiefenvergleich waere - und weil das Getriebe wie das Layout
    // eine Aussage darueber ist, WELCHES Auto man hat, nicht eine Reglervorgabe, die von
    // ihrem Modellwert abweichen koennte. Dafuer hat es einen eigenen Selbsttest.
    physConfigDiff() {
      const cfg = physEngine.config, ref = physEngine.calibRef, out = {};
      for (const k of Object.keys(ref)) {
        if (k === 'gears') continue;
        if (typeof ref[k] === 'object') continue;
        if (cfg[k] !== ref[k]) out[k] = { jetzt: cfg[k], bezug: ref[k] };
      }
      return out;
    },

    // Eine Vollbremsung mit Temperaturverlauf. Die Frage, die sie beantwortet: fadet eine
    // EINZELNE Bremsung aus kalten Scheiben schon? Sie darf es nicht - sonst ist nicht die
    // Simulation tiefer, sondern die gefittete Bremstabelle kaputt.
    physBrakeHeat(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      try {
        Object.assign(cfg, e.calibRef);
        e.calibrateAccel();
        // Beide Namen gelten: die Messaufbauten hiessen teils cfg, teils patch,
        // und derselbe Zweck unter zwei Namen hat schon einen Vergleich still
        // unwirksam gemacht.
        const einst = Object.assign({}, opt.cfg || {}, opt.patch || {});
        for (const k of Object.keys(einst)) cfg[k] = einst[k];
        cfg.tyreEffect = 0;
        const dt = 0.02;
        const v0 = opt.kmh || 250;
        st.driveMode = 'forward';
        st.currentGear = cfg.gears.length - 1;
        st.speedKmh = v0 / REAL_SCALE;
        st.isShifting = false; st.loadFront = 0.5; st.longUse = 0;
        st.fuelLoad = 1;
        st.brakeTempF = cfg.brakeAmbientC;
        st.brakeTempR = cfg.brakeAmbientC;
        st.brakeFade = 0;
        let t = 0, weg = 0, maxFade = 0;
        const wiederholungen = opt.wiederholungen || 1;
        let letzteZeit = 0, letzterWeg = 0;
        for (let i = 0; i < wiederholungen; i++) {
          st.speedKmh = v0 / REAL_SCALE;
          st.longUse = 0;
          let tb = 0, wb = 0;
          while (tb < 20 && st.speedKmh * REAL_SCALE > 1) {
            const vVor = st.speedKmh;
            e.update({ throttle: 0, brake: 1, steering: 0 }, dt);
            tb += dt;
            wb += ((vVor + st.speedKmh) / 2 * REAL_SCALE) / 3.6 * dt;
            maxFade = Math.max(maxFade, st.brakeFade);
          }
          t += tb; weg += wb;
          letzteZeit = tb; letzterWeg = wb;
          // Zwischen den Wiederholungen mit Vollgas wieder hoch: das ist die Kuehlphase,
          // und sie gehoert zur Messung. Ohne sie waeren mehrere Bremsungen ein
          // Dauerbremsvorgang und nicht ein Rennen.
          if (i < wiederholungen - 1) {
            let ta = 0;
            while (ta < 12 && st.speedKmh * REAL_SCALE < v0) {
              e.update({ throttle: 1, brake: 0, steering: 0 }, dt);
              ta += dt;
            }
          }
        }
        return { zeit: +t.toFixed(3), meter: +weg.toFixed(1),
                 letzteZeit: +letzteZeit.toFixed(3), letzterWeg: +letzterWeg.toFixed(1),
                 tempF: +st.brakeTempF.toFixed(0), tempR: +st.brakeTempR.toFixed(0),
                 maxFade: +maxFade.toFixed(4), fadeEnde: +st.brakeFade.toFixed(4) };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    // Kurvenfahrt mit festem Lenkeinschlag: nutzt sie die richtige Seite mehr ab, und bleibt
    // der MITTELWERT derselbe wie ohne Asymmetrie? Das Zweite ist der eigentliche Punkt -
    // sonst waere "Asymmetrie an" auch "mehr Verschleiss an", und dann liesse sich nicht
    // messen, was der Schalter tut.
    // Eine Zustandskopie, die ARRAYS MITKLONT. Object.assign({}, st) ist flach, und der
    // Zustand fuehrt seit der Vierradverlagerung fuenf Vierer-Felder. Flach gesichert wurden
    // sie als Referenz gehalten und im finally auf sich selbst zurueckgeschrieben - jeder
    // Messaufruf hat den echten Fahrzustand dauerhaft veraendert.
    //
    // Sie steht EINMAL da, weil sechs Messaufbauten sie brauchen: sechs Kopien derselben
    // Regel waeren fuenf Gelegenheiten, sie beim naechsten Feld zu vergessen.
    zustandKopie(st) {
      const k = {};
      for (const n of Object.keys(st)) {
        k[n] = Array.isArray(st[n]) ? st[n].slice() : st[n];
      }
      return k;
    },

    // Und die Ruecksicherung muss ebenso in die Arrays HINEIN schreiben und nicht die
    // Referenz tauschen: andere Leser koennen die alte noch halten.
    zustandZurueck(st, merk) {
      for (const n of Object.keys(st)) if (!(n in merk)) delete st[n];
      for (const n of Object.keys(merk)) {
        if (Array.isArray(merk[n]) && Array.isArray(st[n])) {
          st[n].length = 0;
          for (const w of merk[n]) st[n].push(w);
        } else {
          st[n] = merk[n];
        }
      }
    },

    // Der Radwechsel als Zeitstrahl. Aufgerufen wird die ECHTE Funktion; vorgestellt wird
    // nur die Uhr. Eine nachgebaute Rechnung koennte richtig sein, waehrend die echte falsch
    // ist - und dann prueft der Test sich selbst.
    pitWheelTimeline(o) {
      const opt = o || {};
      if (typeof pitWheelOff !== 'function') return null;
      const merk = { st: pitState, plan: pitPlan, done: pitDone,
                     el: pitTyreElapsed, ziel: pitTyreTarget };
      try {
        pitState = 'servicing';
        pitPlan = { tyres: true, refuel: false, repair: false };
        pitDone = { tyres: false, refuel: false, repair: false };
        pitTyreTarget = opt.dauer || 4.0;
        const schritt = opt.schritt || 0.05;
        const reihe = [];
        for (let t = 0; t < pitTyreTarget - 1e-9; t += schritt) {
          pitTyreElapsed = t;
          refreshPitThrottleLock();
          reihe.push({ t: +t.toFixed(3), rad: pitWheelOff(), gas: pitThrottleLock });
        }
        // Und der Zustand NACH dem Wechsel: alle vier muessen wieder dran sein und das Gas
        // muss frei sein.
        pitDone.tyres = true;
        pitTyreElapsed = pitTyreTarget;
        refreshPitThrottleLock();
        const danach = { rad: pitWheelOff(), gas: pitThrottleLock };
        return { reihe, danach, dauer: pitTyreTarget };
      } finally {
        pitState = merk.st; pitPlan = merk.plan; pitDone = merk.done;
        pitTyreElapsed = merk.el; pitTyreTarget = merk.ziel;
        refreshPitThrottleLock();
      }
    },

    // Die Spuren des ganzen Feldes, in Garagenreihenfolge. Herausgegeben, damit sich
    // pruefen laesst, was man am Auto nicht messen kann: kein Byte meldet die Querlage.
    ghostLanes() {
      return garage.filter(c => c.role === 'ghost' && c.ghost)
        .map(c => ({ name: garageLabel(c), spur: +ghostLane(c).toFixed(4) }));
    },

    // Den Kollisionsaufloeser pruefbar machen. Er laeuft beim Laden, also ist er ohne
    // Zugang nur ueber einen Neustart mit gepflanztem Speicher zu testen - und das kann ein
    // Selbsttest nicht.
    padResolve(gespeichert) {
      return resolveBindingCollisions({ ...DEFAULT_BINDINGS, ...(gespeichert || {}) });
    },
    padDefaults() {
      return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    },

    // Die Getriebearten: was drinsteht, was daraus gerechnet wird, und die Pendelreserve.
    //
    // MITGEGEBEN WIRD AUCH DAS GERECHNETE - ratioRef und rpmScale -, genau darum: der Test
    // soll pruefen koennen, dass sie es sind und nicht doch irgendwo als Feld herumliegen.
    //
    // `reserve` ist die Zahl, die ein Pendeln ausschliesst: nach einem Hochschalten faellt
    // die Drehzahl auf upshiftRpm * ratio[i+1] / ratio[i], und liegt downshiftRpm darueber,
    // schaltet die Automatik hoch und sofort wieder herunter. Der kleinste Abstand ueber
    // alle Gaenge ist das, was zaehlt.
    physGearboxes() {
      const c = physEngine.config;
      const merk = physEngine.gearboxName || 'gt3';
      const out = {};
      try {
        for (const name of Object.keys(GEARBOXES)) {
          physEngine.applyGearbox(name);
          const r = c.gears.map(g => g.ratio);
          const nach = [];
          for (let i = 0; i < r.length - 1; i++) nach.push(c.upshiftRpm * r[i + 1] / r[i]);
          out[name] = { label: GEARBOXES[name].label,
                        gaenge: r.length,
                        ratios: r.slice(),
                        topFracs: c.gears.map(g => g.topFrac),
                        ratioRef: c.ratioRef,
                        rpmScale: Math.round(c.rpmScale),
                        upshiftRpm: c.upshiftRpm,
                        downshiftRpm: c.downshiftRpm,
                        shiftMs: c.shiftMs,
                        // Das Produkt, aus dem die Uebersetzungen gerechnet sind: fuer alle
                        // ausser dem letzten Gang muss es GEAR_PRODUCT treffen.
                        produkte: c.gears.map(g => +(g.ratio * g.topFrac).toFixed(3)),
                        reserve: nach.length ? Math.round(Math.min.apply(null, nach) - c.downshiftRpm) : null,
                        // Erreicht der letzte Gang die Drehzahlgrenze bei Vmax?
                        drehzahlOben: Math.round(physEngine.rpmRawAt(c.topSpeedKmh, r.length - 1)) };
        }
        out._produkt = GEAR_PRODUCT;
        out._redline = REDLINE_RPM;
      } finally {
        physEngine.applyGearbox(merk);
      }
      return out;
    },

    // Ein Getriebe setzen und nachsehen, wer davon etwas mitbekommt. Getrennt von
    // physGearboxes, weil diese Probe die GHOSTS anfasst und die Tabelle oben nur abliest.
    //
    // Die Frage, die sie beantwortet: teilen die Ghosts nach einem Wechsel noch dasselbe
    // Uebersetzungs-Array? Ein Splice erreicht jeden Teilhaber, ein neues Array haette den
    // Verweis gekappt - und ein Ghost waere still im alten Getriebe weitergefahren.
    physGearboxShare(name) {
      const merk = physEngine.gearboxName || 'gt3';
      try {
        physEngine.applyGearbox(name || 'f1');
        const ghosts = [];
        garage.forEach(c => {
          if (!c.ghost || !c.ghost.engine) return;
          ghosts.push({ alias: garageLabel(c),
                        geteilt: c.ghost.engine.config.gears === physEngine.config.gears,
                        gaenge: c.ghost.engine.config.gears.length,
                        gang: c.ghost.engine.state.currentGear });
        });
        return { getriebe: physEngine.gearboxName,
                 gaenge: physEngine.config.gears.length,
                 // Der Kalibrierbezug darf NICHT mitgewandert sein.
                 bezugGaenge: physEngine.calibRef.gears.length,
                 bezugGeteilt: physEngine.calibRef.gears === physEngine.config.gears,
                 ghosts };
      } finally {
        physEngine.applyGearbox(merk);
      }
    },

    // Der Startplatz-Versatz der Zweierkolonne. Gefragt wird nach dem VORZEICHEN je Platz,
    // denn genau das ist die Zusicherung: zwei benachbarte Plaetze gehen auf
    // entgegengesetzte Seiten.
    gridOffsets(n) {
      const wieviele = n || 6;
      const out = [];
      for (let i = 0; i < wieviele; i++) {
        out.push(+((i % 2 ? -1 : 1) * GHOST_GRID_OFFSET).toFixed(4));
      }
      return { betrag: GHOST_GRID_OFFSET, weave: GHOST_WEAVE, versatz: out,
               // Zusammen duerfen sie nicht an den Anschlag kommen.
               zusammen: +(GHOST_GRID_OFFSET + GHOST_WEAVE).toFixed(4),
               // Und was ein Ghost wirklich gemerkt hat, falls einer faehrt.
               gemerkt: garage.filter(c => c.ghost).map(c => ({ alias: garageLabel(c),
                                                                platz: c.ghost.gridPos })) };
    },

    // Die Ansage, ohne zu sprechen: der TEXT und die Zaehler. Der Text ist die eine Sache,
    // die man ohne Lautsprecher pruefen kann, und die Zaehler beantworten die zweite Frage -
    // bricht jede Aeusserung die vorherige ab? announceCancels muss mit announceCalls
    // mitlaufen, sonst stapeln sich zwei Runden.
    ansage(ms, best) {
      return { text: lapSpeechText(ms === undefined ? 62430 : ms, !!best),
               an: announceOn,
               calls: announceCalls,
               cancels: announceCancels };
    },

    // Das Fahrzeuglayout: welche es gibt, was sie setzen, und was daraus gerechnet wird.
    //
    // Die Nickgrenzen werden MITGEGEBEN, obwohl sie gerechnet sind - genau darum: der Test
    // soll pruefen koennen, dass sie es sind und nicht irgendwo doch als Feld herumliegen.
    physLayouts() {
      const c = physEngine.config;
      const merk = physEngine.layoutName || 'neutral';
      const out = {};
      try {
        for (const name of Object.keys(LAYOUTS)) {
          physEngine.applyLayout(name);
          out[name] = { label: LAYOUTS[name].label,
                        vorn: c.loadFrontStatic,
                        radstand: c.wheelbaseM,
                        iz: c.yawInertia,
                        rate: +c.steerRatePerS.toFixed(3),
                        gas: +(c.loadFrontStatic - c.transferK).toFixed(4),
                        bremse: +(c.loadFrontStatic + c.transferK).toFixed(4),
                        ruhelast: physEngine.state.loadFront };
        }
      } finally {
        physEngine.applyLayout(merk);
      }
      return out;
    },

    // Ein Layout setzen und den uebertragenen Winkel messen. Getrennt von physLayouts, weil
    // eine Messung ueber 40 Takte laeuft und die Tabelle oben nur Werte abliest.
    physLayoutDrive(name, o) {
      const merk = physEngine.layoutName || 'neutral';
      try {
        physEngine.applyLayout(name);
        return OMEGA_TEST.physSteerGrip(o || { kmh: 140, throttle: 0, brake: 1, steering: 1 });
      } finally {
        physEngine.applyLayout(merk);
      }
    },

    // ---- Probe 1: STATIONAERE KREISFAHRT --------------------------------------------
    //
    // Festes Tempo, fester Lenkwinkel, warten bis die Gierrate steht. Dann gilt die
    // Doku-Gleichung delta = L/R + kU*ay, und der Eigenlenkgradient faellt aus ZWEI
    // Messpunkten heraus: kU = (delta2 - delta1) / (ay2 - ay1).
    //
    // Der Wert MUSS den eingestellten treffen. Trifft er nicht, ist irgendwo ein Vorzeichen
    // oder eine Achslast falsch - und zwar messbar, nicht nach Gefuehl.
    physYawCircle(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      const merkLayout = e.layoutName || 'neutral';
      try {
        if (opt.layout) e.applyLayout(opt.layout);
        for (const k of Object.keys(opt.cfg || {})) cfg[k] = opt.cfg[k];
        const dt = 0.02;
        const R = opt.radius || 40;      // Meter, fester Kurvenradius
        const tempi = opt.tempi || [30, 55];   // angezeigte km/h

        // Eine stationaere Fahrt bei festem Tempo und fester Stickstellung.
        const fahre = (kmh, stick, sekunden) => {
          st.yawRate = 0; st.slipAngle = 0;
          st.driveMode = 'forward'; st.currentGear = 3; st.isShifting = false;
          for (let t = 0; t < sekunden; t += dt) {
            st.speedKmh = kmh / REAL_SCALE;
            e.update({ throttle: 0.2, brake: 0, steering: stick }, dt);
          }
          const v = kmh / 3.6;
          return { delta: (e.outputs.servoAngle || 0) * 45 * Math.PI / 180,
                   r: st.yawRate, ay: st.ayModel,
                   radius: Math.abs(st.yawRate) > 1e-6 ? v / Math.abs(st.yawRate) : Infinity };
        };

        // Die Stickstellung SUCHEN, die den Zielradius ergibt. Der Lenkwinkel ist ein
        // Ausgang - er laeuft durch Servorate, Kalibrierung und Reibkreis -, also kann man
        // ihn nicht setzen, sondern nur treffen.
        const suche = (kmh) => {
          let lo = 0.002, hi = 1;
          let letzte = null;
          for (let k = 0; k < 22; k++) {
            const mid = (lo + hi) / 2;
            letzte = fahre(kmh, mid, 4);
            // Zu klein gelenkt heisst zu grosser Radius.
            if (letzte.radius > R) lo = mid; else hi = mid;
          }
          return { stick: (lo + hi) / 2, ...fahre(kmh, (lo + hi) / 2, 6) };
        };

        const a = suche(tempi[0]);
        const b = suche(tempi[1]);
        // JETZT kuerzt sich L/R heraus, weil beide Punkte denselben Radius haben.
        const kuGemessen = (b.delta - a.delta) / ((b.ay - a.ay) || 1e-9);
        return { punkte: [a, b].map(p => ({ stick: +p.stick.toFixed(4),
                                            delta: +p.delta.toFixed(5),
                                            r: +p.r.toFixed(5), ay: +p.ay.toFixed(4),
                                            radius: +p.radius.toFixed(2) })),
                 zielRadius: R,
                 kuGemessen: +kuGemessen.toFixed(6),
                 kuEingestellt: +st.kU.toFixed(6),
                 radstand: cfg.wheelbaseM };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        e.applyLayout(merkLayout);
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    // ---- Probe 2: SPRUNGVERSUCH -----------------------------------------------------
    //
    // Lenkwinkel schlagartig anlegen, Gierrate mitschreiben. Sie MUSS einschwingen und nicht
    // aufschwingen; tut sie das, ist die Schrittweite zu grob. Genau dafuer ist der Schritt
    // halbimplizit.
    physYawStep(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      const merkLayout = e.layoutName || 'neutral';
      try {
        if (opt.layout) e.applyLayout(opt.layout);
        for (const k of Object.keys(opt.cfg || {})) cfg[k] = opt.cfg[k];
        const dt = opt.dt || 0.045;   // der SENDETAKT, nicht ein feiner Prueftakt
        const kmh = opt.kmh || 160;
        st.yawRate = 0; st.slipAngle = 0;
        st.driveMode = 'forward'; st.currentGear = 3; st.isShifting = false;
        // Erst geradeaus einlaufen, damit der Sprung ein Sprung ist.
        for (let t = 0; t < 1; t += dt) {
          st.speedKmh = kmh / REAL_SCALE;
          e.update({ throttle: 0.2, brake: 0, steering: 0 }, dt);
        }
        const spur = [];
        for (let t = 0; t < 3; t += dt) {
          st.speedKmh = kmh / REAL_SCALE;
          e.update({ throttle: 0.2, brake: 0, steering: 1 }, dt);
          spur.push(+st.yawRate.toFixed(6));
        }
        const ende = spur[spur.length - 1];
        const spitze = Math.max.apply(null, spur.map(Math.abs));
        // Ueberschwingen als Anteil des Endwerts. Ein Einschwingen hat wenig, ein
        // Aufschwingen viel - und ein instabiler Schritt waechst ohne Grenze.
        const ueber = Math.abs(ende) > 1e-9 ? spitze / Math.abs(ende) : 0;
        return { punkte: spur.length, ende: +ende.toFixed(6), spitze: +spitze.toFixed(6),
                 ueberschwingen: +ueber.toFixed(4),
                 endlich: spur.every(x => isFinite(x)),
                 spurAnfang: spur.slice(0, 8), spurEnde: spur.slice(-4) };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        e.applyLayout(merkLayout);
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    // ---- Probe 3: DER KLEINWINKEL-GRENZFALL -----------------------------------------
    //
    // Bei sehr kleinem Lenkwinkel und niedrigem Tempo muss das Modell dasselbe sagen wie die
    // reine Geometrie: r = v/R und delta = L/R, also r = delta * v / L. Ein Modell, das im
    // einfachsten Fall von der Schulformel abweicht, ist an einer Stelle falsch, die man ohne
    // diese Probe lange nicht findet.
    physYawGeometry(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      const merkLayout = e.layoutName || 'neutral';
      try {
        if (opt.layout) e.applyLayout(opt.layout);
        const dt = 0.02;
        const kmh = opt.kmh || 25;      // niedrig: dort ist der Eigenlenkanteil kU*v^2 klein
        const lenk = opt.lenk || 0.06;  // kleiner Winkel
        st.yawRate = 0; st.slipAngle = 0;
        st.driveMode = 'forward'; st.currentGear = 1; st.isShifting = false;
        for (let t = 0; t < 6; t += dt) {
          st.speedKmh = kmh / REAL_SCALE;
          e.update({ throttle: 0.15, brake: 0, steering: lenk }, dt);
        }
        const v = kmh / 3.6;
        const delta = (e.outputs.servoAngle || 0) * 45 * Math.PI / 180;
        const rGeometrie = delta * v / cfg.wheelbaseM;
        return { v: +v.toFixed(3), delta: +delta.toFixed(5),
                 rModell: +st.yawRate.toFixed(6), rGeometrie: +rGeometrie.toFixed(6),
                 abweichungProzent: rGeometrie ? +(100 * (st.yawRate - rGeometrie)
                                                  / rGeometrie).toFixed(2) : null };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        e.applyLayout(merkLayout);
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    // Die Lautstaerken, wie der CODE sie fuehrt. Herausgegeben, damit sich gegen das Markup
    // pruefen laesst: der Startwert steht an zwei Orten, und diese Klasse hat bei den
    // Voreinstellungen siebzehn Abweichungen ergeben.
    sndVolumes() {
      return { motor: typeof engineVolume !== 'undefined' ? engineVolume : null,
               bremse: typeof brakeVolume !== 'undefined' ? brakeVolume : null,
               reifen: typeof tyreVolume !== 'undefined' ? tyreVolume : null,
               ambience: typeof ambienceVolume !== 'undefined' ? ambienceVolume : null,
               regen: typeof rainVolume !== 'undefined' ? rainVolume : null };
    },

    // Die Kennlinie des Reifenquietschens: aus der Ausnutzung wird eine Menge. Nachgebaut
    // waere sie eine zweite Wahrheit, also wird die Schwelle herausgegeben und der Test
    // rechnet mit IHR.
    sndTyreSquealCurve() {
      return { schwelle: typeof TYRE_SQUEAL_START !== 'undefined' ? TYRE_SQUEAL_START : null,
               tonDa: !!(typeof fxBuffers !== 'undefined' && fxBuffers.tyre) };
    },

    physTyreAsym(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      try {
        Object.assign(cfg, e.calibRef);
        e.calibrateAccel();
        // Beide Namen gelten: die Messaufbauten hiessen teils cfg, teils patch,
        // und derselbe Zweck unter zwei Namen hat schon einen Vergleich still
        // unwirksam gemacht.
        const einst = Object.assign({}, opt.cfg || {}, opt.patch || {});
        for (const k of Object.keys(einst)) cfg[k] = einst[k];
        const dt = 0.02;
        st.driveMode = 'forward';
        st.currentGear = 3;
        st.isShifting = false; st.loadFront = 0.5; st.longUse = 0; st.fuelLoad = 1;
        st.tyreTempC = cfg.tyreOptimalC;
        st.tyreWear = 0; st.tyreWearL = 0; st.tyreWearR = 0; st.tyrePull = 0;
        // Die vier Felder MUESSEN mit zurueckgesetzt werden. Die Mittelwerte werden aus
        // ihnen gerechnet, also erschienen sie sonst im naechsten Takt wieder.
        for (let i = 0; i < 4; i++) {
          st.tyreWear4[i] = 0;
          st.tyreTemp4[i] = cfg.tyreOptimalC;
          st.brakeTemp4[i] = cfg.brakeAmbientC;
        }
        const kmh = opt.kmh || 140;
        const lenk = opt.steering === undefined ? 0.7 : opt.steering;
        const sekunden = opt.sekunden || 30;
        for (let t = 0; t < sekunden; t += dt) {
          // Fahrt festhalten: gemessen wird der Verschleiss, nicht die Fahrleistung.
          st.speedKmh = kmh / REAL_SCALE;
          e.update({ throttle: 0.4, brake: 0, steering: lenk }, dt);
        }
        return { wearL: +st.tyreWearL.toFixed(5), wearR: +st.tyreWearR.toFixed(5),
                 mittel: +st.tyreWear.toFixed(5), pull: +st.tyrePull.toFixed(5),
                 tempC: +st.tyreTempC.toFixed(1),
                 // Vier Raeder und vier Scheiben, Reihenfolge VL, VR, HL, HR.
                 wear4: st.tyreWear4 ? st.tyreWear4.map(x => +x.toFixed(5)) : null,
                 temp4: st.tyreTemp4 ? st.tyreTemp4.map(x => +x.toFixed(1)) : null,
                 load4: st.load4 ? st.load4.map(x => +x.toFixed(3)) : null,
                 lat4: st.latShare4 ? st.latShare4.map(x => +x.toFixed(3)) : null,
                 brake4: st.brakeTemp4 ? st.brakeTemp4.map(x => +x.toFixed(0)) : null };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    // Der Zeitverlauf dessen, was WIRKLICH zum Auto geht: das Motorbyte, normiert auf
    // -1..1. Keine der anderen Messungen zeigt es - physCurve misst Zeiten bis zu
    // ANGEZEIGTEN Geschwindigkeitsmarken, physTopSpeed die Endgeschwindigkeit. Die Frage
    // "fuehlt sich das Auto traege an" haengt aber am Byte, und das ist Tempo geteilt durch
    // Hoechstgeschwindigkeit.
    physOutTrace(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      try {
        Object.assign(cfg, e.calibRef);
        // Beide Namen gelten: die Messaufbauten hiessen teils cfg, teils patch,
        // und derselbe Zweck unter zwei Namen hat schon einen Vergleich still
        // unwirksam gemacht.
        const einst = Object.assign({}, opt.cfg || {}, opt.patch || {});
        for (const k of Object.keys(einst)) cfg[k] = einst[k];
        // NACH dem Setzen kalibrieren: die Schubskala ist eine abgeleitete Groesse, und mit
        // einer anderen Hoechstgeschwindigkeit oder Beschleunigungszeit ist sie eine andere.
        e.calibrateAccel();
        cfg.autoShift = true;
        cfg.tyreEffect = 0;
        const dt = 0.02;
        st.driveMode = 'neutral'; st.currentGear = 0; st.speedKmh = 0;
        st.isShifting = false; st.neutralRpm = 0; st.loadFront = 0.5; st.longUse = 0;
        st.fuelLoad = 1;
        st.brakeTempF = cfg.brakeAmbientC; st.brakeTempR = cfg.brakeAmbientC;
        st.brakeFade = 0;
        const marken = opt.marken || [0.25, 0.5, 0.75, 0.9, 0.99];
        const offen = marken.slice();
        const bei = {};
        let t = 0, pwmMax = 0;
        const bis = opt.sekunden || 30;
        while (t < bis) {
          // Schaltpause auf der eigenen Uhr, wie in physCurve: triggerShift loescht
          // isShifting per setTimeout, und das feuert in einer synchronen Schleife nie.
          if (st.isShifting) {
            st._simShift = (st._simShift || 0) + dt;
            if (st._simShift * 1000 >= cfg.shiftMs) { st.isShifting = false; st._simShift = 0; }
          } else { st._simShift = 0; }
          const out = e.update({ throttle: 1, brake: 0, steering: 0 }, dt);
          t += dt;
          const pwm = out.motorPWM;
          if (pwm > pwmMax) pwmMax = pwm;
          while (offen.length && pwm >= offen[0]) {
            bei[offen[0]] = +t.toFixed(3);
            offen.shift();
          }
          if (!offen.length) break;
        }
        return { bei, pwmMax: +pwmMax.toFixed(4),
                 kmhEnde: +(st.speedKmh * REAL_SCALE).toFixed(1),
                 topKmhAnzeige: +(cfg.topSpeedKmh * REAL_SCALE).toFixed(0),
                 sekunden: +t.toFixed(2) };
      } finally {
        Object.assign(cfg, merk);
        e.calibrateAccel();
        delete st._simShift;
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

    physCurve(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const marken = opt.marken || [50, 100, 150, 200];
      const bremsAb = opt.bremsAb || [100, 150, 200, 250];
      // Der GANZE Zustand, nicht eine Liste von Feldern. Aufgezaehlt hatte ich zwoelf, und
      // der Zustand hat mehr - rpm, dampedSteering, virtualSpeed, gripLong, pitch,
      // onLimiter. Ein Aufruf liess sie stehen, der naechste setzte darauf
      // auf, und zwei identische Aufrufe lieferten Verschiedenes. Eine Aufzaehlung ist bei
      // einem Zustandsobjekt immer unvollstaendig.
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = Object.assign({}, cfg);
      // Bezugszustand: RENNSTART. Voller Tank, warme Reifen, trockene Bahn.
      //
      // Ohne einen festen Zustand messt diese Funktion die Reihenfolge der Pruefungen und
      // nicht das Auto: einzeln aufgerufen kam 0-100 in 3,02 s heraus, im Selbsttest nach
      // anderen Pruefungen 2,38 s. Der erste Versuch normierte dann auf leeren Tank - also
      // auf den Bestfall, der schneller ist als alles, was ein Fahrer erlebt. Ein Sollwert
      // wie "0-100 in 3,1 s" gilt fuer ein rennfertiges Auto, und das hat Sprit an Bord.
      //
      // massFactor wird bewusst NICHT gesetzt: update() leitet ihn jeden Takt aus fuelLoad
      // ab, und ihn daneben festzuhalten waere ein zweiter Ort fuer dieselbe Groesse.
      // tyreEffect auf 0 und nicht tyreGrip auf 1: update() rechnet tyreGrip jeden Takt
      // aus dem Reifenzustand neu, ein gesetzter Wert haelt also keinen Takt. Stillgelegt
      // wird der EINGANG, dann sind die Reifen nominal, egal was vorher lief.
      // Der Kalibrierbezug, und zwar ALLE Felder daraus. Vorher standen hier drei
      // Zuweisungen (tyreEffect, gripScale, autoShift), und alles andere blieb, wo der
      // Benutzer es gelassen hatte: Bremswirkung, Beschleunigung, Ausrollen, Tankgewicht,
      // Bremsbalance. Ein Klick auf eine Voreinstellung liess diese Pruefung deshalb um 26
      // bis 62 Prozent danebenliegen, und seit Block B sind die Voreinstellungen von drei
      // Stellen aus erreichbar.
      Object.assign(cfg, e.calibRef);
      // Und die Schubskala neu loesen. calibRef wird im Konstruktor genommen, BEVOR
      // calibrateAccel() laeuft - accelCalibration steht darin also auf seinem Startwert und
      // nicht auf dem geloesten. Ohne diese Zeile misst der Aufbau mit einer unkalibrierten
      // Skala: gemessen 0,32 s auf 100 km/h statt 2,7 s, also um den Faktor acht daneben.
      //
      // Der Grund ist allgemeiner und lohnt das Aufschreiben: die Kalibrierung ist eine
      // ABGELEITETE Groesse und kein Eingabewert. Sie mitzukopieren sieht richtig aus und
      // ist es nicht - sie muss neu geloest werden, sobald ein Eingabewert sich aendert.
      e.calibrateAccel();
      cfg.tyreEffect = 0;
      // Und der Wert, gegen den die GT3-Tabelle gefittet ist. Er steht hier und nicht in
      // calibRef, weil die Reglerstaerke eine SPIELEINSTELLUNG ist: dass ein voller Tank
      // traeger macht, gehoert zum Auto, wie STARK es traeger macht, gehoert zum Geschmack.
      // Der Fit wurde bei halber Staerke gemacht, also messen wir dort.
      cfg.fuelWeightEffect = 0.5;
      st.fuelLoad = 1;
      const dt = 0.02;
      const takt = () => {
        // Schaltpause auf der eigenen Uhr.
        if (st.isShifting) {
          st._simShift = (st._simShift || 0) + dt;
          if (st._simShift * 1000 >= cfg.shiftMs) { st.isShifting = false; st._simShift = 0; }
        } else { st._simShift = 0; }
      };
      try {
        cfg.autoShift = true;
        // ---- Beschleunigen
        st.driveMode = 'neutral'; st.currentGear = 0; st.speedKmh = 0;
        st.isShifting = false; st.neutralRpm = 0; st.loadFront = 0.5; st.longUse = 0;
        const zeit = {};
        let t = 0, offen = marken.slice();
        const zwischen = { von: null, t: null };
        while (t < 40 && offen.length) {
          takt();
          e.update({ throttle: 1, brake: 0, steering: 0 }, dt);
          t += dt;
          const kmh = st.speedKmh * REAL_SCALE;
          while (offen.length && kmh >= offen[0]) {
            zeit[offen[0]] = +t.toFixed(3);
            if (opt.von && offen[0] === opt.von) { zwischen.von = t; }
            if (opt.bis && offen[0] === opt.bis && zwischen.von !== null) {
              zwischen.t = +(t - zwischen.von).toFixed(3);
            }
            offen.shift();
          }
        }
        // ---- Bremsen, je Marke ein eigener Lauf
        const bremsen = {};
        for (const v0 of bremsAb) {
          st.driveMode = 'forward';
          // Gang passend zur Fahrt waehlen, damit die Motorbremse stimmt.
          st.currentGear = 0;
          st.speedKmh = v0 / REAL_SCALE;
          while (st.currentGear < cfg.gears.length - 1
                 && e.rpmRawAt(st.speedKmh, st.currentGear) >= cfg.upshiftRpm) {
            st.currentGear++;
          }
          st.isShifting = false; st.loadFront = 0.5; st.longUse = 0;
          // KALTE SCHEIBEN vor jedem Lauf. Seit Block 4 behalten sie ihre Waerme, und vier
          // Bremsungen hintereinander wuerden die letzte aus heissen Scheiben fahren - die
          // Messung haenge dann an der Reihenfolge und nicht am Auto. Dieselbe Falle stand
          // oben schon fuer den Reifenzustand aufgeschrieben. Die kalibrierte Bremstabelle
          // ist an EINER Bremsung aus kalten Scheiben gemessen; das ist der Zustand, fuer
          // den die Sollwerte gelten.
          st.brakeTempF = cfg.brakeAmbientC;
          st.brakeTempR = cfg.brakeAmbientC;
          st.brakeFade = 0;
          let tb = 0, weg = 0;
          while (tb < 20 && st.speedKmh * REAL_SCALE > 1) {
            takt();
            const vVor = st.speedKmh;
            e.update({ throttle: 0, brake: 1, steering: 0 }, dt);
            tb += dt;
            // Weg in ECHTEN Metern: die angezeigte Fahrt ist km/h, also v/3.6 m/s.
            weg += ((vVor + st.speedKmh) / 2 * REAL_SCALE) / 3.6 * dt;
          }
          bremsen[v0] = { s: +tb.toFixed(3), m: +weg.toFixed(1),
                          g: +((v0 / 3.6) / Math.max(1e-6, tb) / 9.81).toFixed(2) };
        }
        return { beschleunigen: zeit, zwischen: zwischen.t, bremsen };
      } finally {
        Object.assign(cfg, merk);
        // Die Schubskala haengt an den zurueckgelegten Werten und muss neu geloest
        // werden - sonst rechnet die App danach mit der Skala des Bezugszustands,
        // waehrend die Regler etwas anderes anzeigen.
        e.calibrateAccel();
        // Erst die eigenen Zutaten weg, dann alles zuruecklegen: sonst bliebe ein Feld
        // stehen, das es vor dem Aufruf nicht gab.
        delete st._simShift;
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },
    // Aus dem Stand Vollgas und die Gaenge mitschreiben. Ueber update(), nicht ueber einen
    // direkten Aufruf des Getriebes: der Fehler lag im WEG zum Getriebe, und ein direkter
    // Aufruf haette ihn nicht gefunden.
    physAutoGears(sekunden) {
      const e = physEngine, st = e.state, cfg = e.config;
      const merk = { as: cfg.autoShift, dm: st.driveMode, g: st.currentGear,
                     v: st.speedKmh, sh: st.isShifting, nr: st.neutralRpm };
      try {
        cfg.autoShift = true;
        st.driveMode = 'neutral'; st.currentGear = 0; st.speedKmh = 0;
        st.isShifting = false; st.neutralRpm = 0;
        const folge = [];
        const takte = Math.round((sekunden || 12) / 0.02);
        // Eigene Uhr fuer die Schaltpause. triggerShift setzt isShifting und loescht es per
        // setTimeout - in einer synchronen Schleife feuert das nie, und dann bleibt der
        // Schub fuer immer aus. Gemessen sah das aus wie "schaltet in den 2. und wird dann
        // langsamer", war aber die Messung und nicht die App.
        let warShifting = false, seitShift = 0;
        for (let i = 0; i < takte; i++) {
          if (st.isShifting && !warShifting) { seitShift = 0; }
          if (st.isShifting) {
            seitShift += 0.02;
            if (seitShift * 1000 >= cfg.shiftMs) st.isShifting = false;
          }
          warShifting = st.isShifting;
          e.update({ throttle: 1, brake: 0, steering: 0 }, 0.02);
          const g = st.driveMode === 'forward' ? st.currentGear + 1 : 0;
          if (!folge.length || folge[folge.length - 1].gang !== g) {
            folge.push({ gang: g, kmh: Math.round(st.speedKmh * REAL_SCALE),
                         s: +(i * 0.02).toFixed(2) });
          }
        }
        return { folge, hoechster: Math.max(...folge.map(x => x.gang)),
                 endKmh: Math.round(st.speedKmh * REAL_SCALE) };
      } finally {
        cfg.autoShift = merk.as; st.driveMode = merk.dm; st.currentGear = merk.g;
        st.speedKmh = merk.v; st.isShifting = merk.sh; st.neutralRpm = merk.nr;
      }
    },
    // Rueckwaertsgang: schalten und nachsehen, was daraus wurde. Die Automatik ist der
    // interessante Fall, weil dort vorher gar nichts ging.
    physShift(o) {
      const e = physEngine, st = e.state, cfg = e.config;
      const merk = { as: cfg.autoShift, dm: st.driveMode, g: st.currentGear,
                     v: st.speedKmh, sh: st.isShifting };
      try {
        cfg.autoShift = !!o.auto;
        st.driveMode = o.von || 'forward';
        st.currentGear = o.gang === undefined ? 0 : o.gang;
        st.speedKmh = (o.kmh || 0) / REAL_SCALE;
        st.isShifting = false;
        e.triggerShift(o.richtung);
        return { driveMode: st.driveMode, gear: st.currentGear,
                 kmhAnzeige: Math.round(st.speedKmh * REAL_SCALE) };
      } finally {
        cfg.autoShift = merk.as; st.driveMode = merk.dm; st.currentGear = merk.g;
        st.speedKmh = merk.v; st.isShifting = merk.sh;
      }
    },
    setLineModel, getLineModel, buildLine,
    // Das Lernen ohne Auto und ohne Rennen durchspielen: Runden hineingeben, sehen was
    // angenommen wird. Genau so ist die Annahmeregel pruefbar.
    learnSim(runden) {
      const car = { ghost: {}, device: { id: 'sim', name: 'sim' }, tag: 'Sim' };
      const merk = ghostCfg.learnPace;
      ghostCfg.learnPace = true;
      try {
        learnPropose(car);
        const spur = [];
        for (const r of runden) {
          const f = learnFactors(car);
          learnSettle(car, r.ms, r.off || 0);
          spur.push({ ms: r.ms, off: r.off || 0,
                      probePace: +f.pace.toFixed(4), probePush: +f.push.toFixed(4),
                      pace: +car.learn.pace.toFixed(4), push: +car.learn.push.toFixed(4),
                      sigma: +car.learn.sigma.toFixed(4), best: car.learn.bestMs });
        }
        return { spur, kept: car.learn.kept, rejected: car.learn.rejected,
                 offs: car.learn.offs, cap: learnSteerCap() };
      } finally { ghostCfg.learnPace = merk; }
    },
    // Die Ideallinie ueber eine ganze Runde abtasten, ohne Auto: das Layout und die Phase
    // sind alles, was sie braucht. Rueckgabe je Kachel und Phase der Versatz in [-1, 1].
    // Boxenstopp von aussen stellen, um die drei Kacheln zu pruefen, ohne ein Auto zu
    // verbinden und ohne echte Standzeit abzuwarten. Gibt zurueck, welche Klasse jede
    // Kachel danach traegt.
    pitTiles(state, plan, ready) {
      if (state !== undefined) pitState = state;
      if (plan !== undefined) pitPlan = plan === null ? null : Object.assign({}, plan);
      // pitReady steuert den Umschlag des Tachoschilds von PIT auf GO. Ohne diesen Griff
      // waere das Schild nur mit echtem Auto und echter Standzeit zu pruefen.
      if (ready !== undefined) pitReady = ready;
      updatePitUI();
      pitBoard();
      const out = {};
      for (const el of document.querySelectorAll('.pit-tile')) {
        out[el.dataset.pit] = el.classList.contains('pit-on') ? 'on'
                            : el.classList.contains('pit-off') ? 'off'
                            : el.classList.contains('pit-na') ? 'na' : '-';
      }
      const brd = document.getElementById('race-board');
      return { state: pitState, plan: pitPlan, tiles: out, ready: pitReady,
               schild: brd ? { klasse: brd.className, text: brd.textContent } : null,
               beschreibung: pitPlan ? describePitPlan(pitPlan) : null };
    },
    // Eine Kachel antippen, als haette es ein Finger getan.
    pitTap(which) {
      const el = document.querySelector('.pit-tile[data-pit="' + which + '"]');
      if (!el) return { fehler: 'keine Kachel ' + which };
      el.click();
      return this.pitTiles();
    },
    // Was die Sprachumschaltung fuer einen bestimmten Knoten gespeichert hat. Ohne diesen
    // Einblick ist "der Text springt nicht zurueck" nicht zu unterscheiden von "der
    // gespeicherte Originaltext ist schon der falsche".
    i18nDebug(selector, childIndex) {
      const el = document.querySelector(selector);
      if (!el) return { fehler: 'kein Element' };
      const node = el.childNodes[childIndex || 0];
      if (!node) return { fehler: 'kein Kindknoten' };
      return {
        lang, jetzt: node.nodeValue, gespeichert: i18nOrig.get(node) || null,
        istTextknoten: node.nodeType === 3,
        uebersetzung: i18nLookup(i18nOrig.get(node) || node.nodeValue),
      };
    },
    // Ein synthetisches Meldungspaket durch den ECHTEN Weg schicken: recNotify,
    // Rundenzaehlung, Armaturenbrett, Rohcode-Monitor, Lernen, Ruetteln. Damit ist
    // pruefbar, ob ein Paket ankommt, ohne ein Auto zu verbinden - und wenn unterwegs
    // etwas wirft, sagt der Fehler wo.
    feedNotify(bytesArray, opts) {
      const arr = new Uint8Array(19);
      arr.set(bytesArray.slice(0, 19));
      const car = (opts && opts.car) || {
        device: { id: 'test', name: 'Testwagen' }, role: 'player',
        rx: null, tx: null, tileCode: 0xff, tileCount: null, lastCodeAt: 0, yaw: 0,
        ghost: null, timer: null, race: null,
      };
      const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      onCarNotify(car, { target: { value: dv } });
      return { code: arr[12], count: arr[11], parked: car.parked || null,
               shake: car.shakeValue === undefined ? null : car.shakeValue };
    },
    // Der Rohcode-Monitor von aussen: an/aus und Stand.
    codeProbe(on) {
      if (on !== undefined) { cmOn = !!on; if (cmOn) cmReset(); }
      return { on: cmOn, total: cmTotal, counts: Object.assign({}, cmCounts),
               steps: cmSteps };
    },
    // Die gerechnete Linie selbst, punktweise. Damit ist pruefbar, ob ein Rest-Sprung in
    // der Kachel/Phase-Abbildung steckt oder einfach die Auflaesung der Linie ist: der
    // groesste Schritt zwischen zwei BENACHBARTEN Abtastpunkten ist die Untergrenze, die
    // keine Abbildung unterbieten kann.
    lineOf(tiles) {
      const keep = currentTrackTiles;
      currentTrackTiles = tiles;
      try {
        const lc = ghostLine();
        if (!lc) return null;
        const ref = Math.max(1e-6, lc.span || lc.limit);
        const norm = lc.alpha.map(a => a / ref);
        let step = 0;
        for (let i = 0; i < norm.length; i++) {
          const j = lc.closed ? (i + 1) % norm.length : Math.min(i + 1, norm.length - 1);
          step = Math.max(step, Math.abs(norm[j] - norm[i]));
        }
        return { span: lc.span, limit: lc.limit, points: lc.points, closed: lc.closed,
                 maxStep: step, ranges: lc.ranges.map(r => r.count) };
      } finally { currentTrackTiles = keep; lineCache = null; }
    },
    // Beide Linien nebeneinander: die gerechnete aus dem Editor und die Handregel.
    // Damit ist pruefbar, ob sie dasselbe sagen - und wie stark sie sich unterscheiden.
    compareLines(tiles, steps) {
      const keep = currentTrackTiles;
      currentTrackTiles = tiles;
      const out = [];
      try {
        const lc = ghostLine();
        const car = { ghost: { tileIndex: 0, tileMs: 1000 }, tileAt: 0 };
        for (let i = 0; i < tiles.length; i++) {
          car.ghost.tileIndex = i;
          for (let k = 0; k < (steps || 5); k++) {
            const ph = k / (steps || 5);
            car.tileAt = Date.now() - ph * car.ghost.tileMs * ghostTileLenFactor(i);
            out.push({ tile: i, type: tiles[i].type, phase: ph,
                       calc: lc ? ghostLineOffset(car) : null,
                       heur: ghostLineHeuristic(car),
                       brake: ghostBrakeDemand(car) });
          }
        }
        out.meta = lc ? { span: lc.span, limit: lc.limit, points: lc.points,
                          closed: lc.closed } : null;
      } finally { currentTrackTiles = keep; lineCache = null; }
      return out;
    },
    // Die Physik von aussen messbar machen, mit IHREN eigenen Hilfsfunktionen.
    //
    // Ein eigener Integrationslauf im Test waere ein Test der eigenen Rechnung: das Modell
    // hat mit simulateLaunch() bereits den Integrator, an dem die Kalibrierung haengt, und
    // genau der muss geprueft werden. Ein Nachbau davon kann stimmen, waehrend das Original
    // falsch ist.
    physLaunch() {
      const cfg = physEngine.config;
      const r = physEngine.simulateLaunch(cfg.accelCalibration, false);
      return { zeit: r.time, erreicht: r.reached,
               soll: cfg.launchAnchorTimeS, ankerKmh: cfg.launchAnchorKmh,
               kalibrierung: cfg.accelCalibration };
    },
    // Endgeschwindigkeit: lange genug mit Vollgas integrieren und sehen, wo es stehen
    // bleibt. Wieder mit thrustAt/resistAt, also mit dem Modell selbst.
    physTopSpeed(sekunden) {
      const cfg = physEngine.config;
      const A = physEngine.accelScale();
      const dt = CONTROL_SEND_INTERVAL_MS / 1000;
      let v = 0, g = 0, t = 0;
      const bis = sekunden || 90;
      while (t < bis) {
        v += (physEngine.thrustAt(v, g, 1, A) - physEngine.resistAt(v, A, true)) * dt;
        if (v < 0) v = 0;
        if (g < cfg.gears.length - 1 && physEngine.rpmRawAt(v, g) >= cfg.upshiftRpm) g++;
        t += dt;
      }
      return { intern: v, angezeigt: v * REAL_SCALE,
               sollIntern: cfg.topSpeedKmh, sollAngezeigt: cfg.topSpeedKmh * REAL_SCALE,
               anteil: v / cfg.topSpeedKmh };
    },
    // ---- Der Zieleinlauf, als Zeitlinie ------------------------------------------
    //
    // Gemessen werden die WIRKLICH GESENDETEN PAKETE und nicht die Absichten der Funktion:
    // der Prueflauf haengt dem Auto einen rx-Stummel an, und damit laeuft alles durch
    // buildCommandPacket - Lenkbyte, Gasbyte, Lichtbyte, so wie es an das Auto ginge. Ein
    // Nachbau der Bytes im Test koennte stimmen, waehrend das Original falsch ist.
    //
    // Die Zeit wird gefaelscht, indem der Startzeitpunkt der laufenden Phase je Schritt
    // zurueckgesetzt wird - dasselbe Verfahren wie bei compareLines(). Ein Phasenwechsel
    // setzt at neu, deshalb altert danach wieder von vorn, und das ist richtig.
    async ghostFinishTimeline(o) {
      const opt = o || {};
      const schritt = opt.schritt || 60;
      const pakete = [];
      const car = {
        // alias, weil garageLabel() sonst auf car.device.name zurueckfaellt und ohne Geraet
        // wirft - die Ausnahme fiel in den catch von writeToCar und kam als "keine Pakete
        // gesendet" heraus. alias ist der vorgesehene Weg, ein Auto zu benennen.
        role: 'ghost', writeInFlight: false, alias: 'Prueflauf',
        rx: { properties: { writeWithoutResponse: true },
              writeValueWithoutResponse(p) { pakete.push(Array.from(p)); return Promise.resolve(); } },
        ghost: { running: true },
      };
      finishGhost(car);
      // Die Phase gehoert an das PAKET und nicht an den Takt: ein Takt, in dem die Phase
      // wechselt, schreibt kein Paket. Zwei Listen verschiedener Laenge nebeneinander zu
      // fuehren und mit demselben Index zu lesen war der Fehler - die Bremsphase sah dadurch
      // leer aus, obwohl sie sieben Pakete lang ist.
      const phasen = [];
      let takte = 0;
      while (car.ghost.finish && takte < 400) {
        const phase = car.ghost.finish.phase;
        car.ghost.finish.at -= schritt;
        const vorher = pakete.length;
        ghostFinishTick(car);
        // Dem Mikrotask-Ende Luft lassen: writeToCar setzt writeInFlight in einem finally
        // NACH einem await zurueck, und ohne diese Pause wuerde jedes zweite Paket als
        // "Schreibvorgang laeuft noch" verworfen.
        await Promise.resolve(); await Promise.resolve();
        for (let k = vorher; k < pakete.length; k++) phasen.push(phase);
        takte++;
      }
      // Byte 7 ist der Lenkwinkel als vorzeichenbehaftetes Byte, Byte 14 die Lichter.
      //
      // Byte 6 ist (0xdf + Delta) & 0xff und LAEUFT UEBER: bei Delta 38 steht dort 0x05,
      // und b[6] - 0xdf ergab -218. Der Ueberlauf muss zurueckgerechnet werden, und danach
      // ist der Bereich -64..127 (MIN_THROTTLE_DELTA bis Anschlag), also gehoeren Werte
      // ueber 127 auf die negative Seite.
      const gasVon = (b6) => { const d = (b6 - 0xdf) & 0xff; return d > 127 ? d - 256 : d; };
      const reihe = pakete.map((b, i) => ({
        phase: phasen[i],
        lenk: b[7] > 127 ? b[7] - 256 : b[7],
        gas: gasVon(b[6]),
        licht: b[14],
      }));
      return { reihe, phasen, takte, schritt,
               kopf: LIGHT_HEAD, bremse: LIGHT_BRAKE,
               blinks: FINISH_BLINKS, rollMs: FINISH_ROLL_MS };
    },

    // ---- Hebt ein Start das Parkschild? -----------------------------------------
    //
    // Gemessen an einem ECHTEN startGhost()-Aufruf, nicht an einer nachgebauten Zuweisung:
    // der Fehler war ja gerade, dass startGhost() das Feld nicht anfasst.
    ghostUnparkOnStart() {
      const car = { role: 'ghost', parked: 'Bahn verlassen', tileCount: null,
                    writeInFlight: false, ghost: null, timer: null, alias: 'Prueflauf' };
      const vor = car.parked;
      try {
        startGhost(car);
        return { vor, nach: car.parked, ghostNeu: !!car.ghost,
                 cutOut: car.ghost ? car.ghost.cutOut : null };
      } finally {
        // Den Zeitgeber wieder los, sonst tickt ein Phantom-Ghost bis zum Neuladen weiter.
        stopGhost(car);
        if (car.ghost) car.ghost.running = false;
      }
    },

    // ---- Kostet dichtes Auffahren Tempo? ----------------------------------------
    //
    // Zwei Autos in die Garage stellen und ghostSpice() selbst fragen. Die anderen vier
    // Bausteine sind dabei ABGESCHALTET, und zwar ueber ihre eigenen Bedingungen und nicht
    // durch Auskommentieren: tight=1 heisst "keine Gerade", also kein Windschatten und keine
    // Attacke; dist=3 heisst "keine angebremste Kurve", also kein Fehler; und wer hinten
    // faehrt, ist nicht der Fuehrende, also kein Gummiband. Uebrig bleibt der Abstand.
    ghostGapFactor(gaps) {
      const merk = garage.splice(0, garage.length);
      const spiceVor = ghostCfg.spice;
      try {
        ghostCfg.spice = 1;
        const mk = () => ({ role: 'ghost', tileAt: 0,
                            ghost: { tilesTotal: 0, tileIndex: 0, form: 0,
                                     formAt: Date.now(), attackUntil: 0, closeSince: 0,
                                     mistakeUntil: 0 } });
        const hinten = mk(), vorne = mk();
        garage.push(hinten, vorne);
        return (gaps || []).map((gap) => {
          vorne.ghost.tilesTotal = gap;
          Object.assign(hinten.ghost, { tilesTotal: 0, form: 0, formAt: Date.now(),
                                        attackUntil: 0, closeSince: 0, mistakeUntil: 0,
                                        attackTriedAt: Date.now() });
          const r = ghostSpice(hinten, { tight: 1, dist: 3, key: 'p' });
          return { gap, faktor: +r.factor.toFixed(4) };
        });
      } finally {
        garage.splice(0, garage.length);
        merk.forEach(c => garage.push(c));
        ghostCfg.spice = spiceVor;
      }
    },

    // ---- Die Ueberholsequenz, Phase fuer Phase --------------------------------
    //
    // Zwei Autos in die Garage, die Uhr gefaelscht, und ghostSpice() selbst gefragt. Der
    // Angriff wird NICHT gewuerfelt abgewartet: gewuerfelt ist er kein Pruefmittel. Gesetzt
    // wird der Anfangszustand, den das Wuerfeln erzeugt, und geprueft wird, was die Sequenz
    // daraus macht.
    //
    // ueberholtNach: nach so vielen ms zieht der Verfolger am anderen vorbei. null heisst
    // "kommt nicht vorbei" - der Abbruchfall, und der ist der wichtigere: ohne Abbruch klebt
    // ein Verfolger neben dem anderen, bis die Uhr ablaeuft, und genau dort beruehren sie
    // sich.
    // Die Groessen, aus denen folgt, ob ueberhaupt ueberholt wird. Herausgegeben und nicht
    // im Test abgeschrieben: es sind Konstanten, und eine Abschrift laeuft auseinander.
    // Die Ueberblendung der Motorschleifen, und die eine Frage, die zaehlt: klebt bei
    // irgendeiner Drehzahl eine HOERBARE Schleife am Ratenanschlag? Genau das war der
    // Fehler, und genau das sieht man an den Zahlen nicht, wenn man sie einzeln ansieht.
    // `basen` als ARGUMENT und nicht aus den geladenen Puffern: die kommen erst nach einer
    // Nutzergeste, und ein Test, der ohne Klick immer ueberspringt, prueft nie. Der Aufrufer
    // holt sie aus loops.json und kann damit ALLE Motoren durchgehen statt nur den gewaehlten.
    sndBandCheck(basenRein) {
      const basen = (basenRein || []).slice().sort((a, b) => a - b);
      if (basen.length < 2) return { fehlt: 'weniger als zwei Baender' };
      // DAS MASS IST DIE GEWICHTETE VERSTIMMUNG, nicht "am Anschlag oder nicht". Eine
      // Schleife, die 2,04 statt 2,00 spielen soll, ist zwei Prozent daneben - das hoert
      // niemand. Eine, die 0,36 spielen soll und auf 0,50 geklemmt wird, ist eine halbe
      // Oktave daneben, und DAS war der gemeldete Fehler. Gewichtet mit der Lautstaerke des
      // Bandes, denn eine Verstimmung bei neun Prozent Gewicht ist eine andere Sache als
      // dieselbe bei hundert.
      //
      //   verlangte Rate / geklemmte Rate, in Oktaven, mal Gewicht
      let schlimmst = 0, wo = null;
      for (let rpm = IDLE_RPM; rpm <= REDLINE_RPM; rpm += 50) {
        const w = sampleWeights(rpm, basen);
        for (let i = 0; i < basen.length; i++) {
          if (w[i] <= 0.02) continue;
          const will = rpm / basen[i];
          const kann = Math.max(0.5, Math.min(2.0, will));
          const fehler = w[i] * Math.abs(Math.log2(kann / will));
          if (fehler > schlimmst) {
            schlimmst = fehler;
            wo = { rpm, band: i, gewicht: +w[i].toFixed(2), will: +will.toFixed(2),
                   kann: +kann.toFixed(2), oktaven: +Math.abs(Math.log2(kann / will)).toFixed(2) };
          }
        }
      }
      return { basen, verstimmung: +schlimmst.toFixed(4), schlimmste: wo,
               // Der groesste Sprung zwischen zwei Nachbarn, in Oktaven.
               oktaven: +Math.max.apply(null, basen.slice(1).map(
                 (b, i) => Math.log2(b / basen[i]))).toFixed(2) };
    },

    // Die Autopunkte auf der Streckenkarte. Gefragt wird mit KUENSTLICHEN Autos, denn ohne
    // verbundenes Auto gibt es keine echten - und genau dann soll die Karte trotzdem stimmen.
    //
    // Zurueck kommen die gezeichneten Mittelpunkte, damit der Test den VERSATZ pruefen kann:
    // die alte Fassung rechnete (index + 1) * Abtastpunkte und setzte den Punkt damit an das
    // ENDE der Kachel, auf der das Auto steht - eine ganze Kachel zu weit.
    trackMarks(code, cars) {
      const p = codeToTrack(code || 'SG2H2G2R2G2H2G2R2');
      const html = renderTrackPreview(p.tiles, null, { detailed: true, cars: cars || [] }).html;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const punkte = [...doc.querySelectorAll('circle')].map(c => ({
        x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), fill: c.getAttribute('fill') }));
      const kuerzel = [...doc.querySelectorAll('text')].map(t => t.textContent);
      return { kacheln: p.tiles.length, punkte, kuerzel,
               echte: trackCarMarks ? trackCarMarks().length : null };
    },

    // Die sechs Motorton-Zusaetze, ohne einen Ton zu erzeugen: extrasWerte() rechnet nur.
    // `folge` ist eine Liste von Fahrzustaenden, die HINTEREINANDER durchgerechnet werden -
    // das muss sie sein, weil drei der sechs von der VORGESCHICHTE leben: der Knaller vom
    // Lastabfall, der Schaltknall von der Flanke, der Ladedruck von seiner Verzoegerung.
    //
    // dt wird mitgegeben und nicht aus der Uhr genommen: in einer synchronen Schleife ist
    // die Uhrdifferenz null, und dann kaeme der Ladedruck nie an.
    // Die BAUART der Zusatzquellen, soweit sie schon stehen. Ein Pfeifen aus einem
    // Oszillator ist ein Piepsen - genau das war es bis v0.5.7 -, also gehoert die Bauart
    // festgenagelt und nicht nur ihr Klang beschrieben.
    sndExtrasBau() {
      return { gebaut: !!xs.gebaut,
               pfeif: xs.pfeif ? xs.pfeif.constructor.name : null,
               pfeifQuelle: xs.pfeifQuelle ? xs.pfeifQuelle.constructor.name : null,
               heulen: xs.whine ? xs.whine.constructor.name : null,
               guete: xs.pfeif && xs.pfeif.Q ? xs.pfeif.Q.value : null };
    },

    sndExtras(folge, o) {
      const opt = o || {};
      const merk = { crackle: xs.crackle, turbo: xs.turbo, ein: extrasOn,
                     last: xs.letzteLast, schalt: xs.schaltAn, druck: xs.ladedruck };
      try {
        if (opt.crackle !== undefined) xs.crackle = opt.crackle;
        if (opt.turbo !== undefined) xs.turbo = !!opt.turbo;
        if (opt.ein !== undefined) extrasOn = !!opt.ein;
        xs.letzteLast = opt.startLast === undefined ? 0 : opt.startLast;
        xs.schaltAn = false;
        xs.ladedruck = 0;
        const dt = opt.dt === undefined ? 0.045 : opt.dt;
        return (folge || []).map(z => {
          const st = { rpmFrac: z.rpmFrac || 0, onLimiter: !!z.onLimiter,
                       isShifting: !!z.isShifting, speedKmh: z.speedKmh || 0,
                       currentGear: z.gear || 0 };
          const w = extrasWerte(st, z.load === undefined ? 0 : z.load, dt);
          return { tonHz: Math.round(w.tonHz), cut: w.cutTiefe,
                   whineHz: Math.round(w.whineHz), whineGain: +w.whineGain.toFixed(4),
                   pfeifHz: Math.round(w.pfeifHz), pfeifGain: +w.pfeifGain.toFixed(4),
                   knaller: w.knaller, schaltKnall: +(w.schaltKnall || 0).toFixed(3),
                   abblasen: +(w.abblasen || 0).toFixed(3),
                   druck: +(w.ladedruck || 0).toFixed(3), aus: !!w.aus };
        });
      } finally {
        xs.crackle = merk.crackle; xs.turbo = merk.turbo; extrasOn = merk.ein;
        xs.letzteLast = merk.last; xs.schaltAn = merk.schalt; xs.ladedruck = merk.druck;
      }
    },

    ghostPassRates() {
      const p = SPICE_ATTACK_P * ghostCfg.spice;
      return { reichweite: SPICE_ATTACK_RANGE,
               abstandMin: SPICE_GAP_MIN,
               // Das Fenster, in dem der Verfolger in Reichweite ist, ohne gelupft zu werden.
               fenster: +(SPICE_ATTACK_RANGE - SPICE_GAP_MIN).toFixed(3),
               klebenMs: SPICE_ATTACK_ARM_MS,
               wurfMs: SPICE_ATTACK_RETRY_MS,
               wuerze: ghostCfg.spice,
               p: +p.toFixed(4),
               // Erwartete Wartezeit in Sekunden, sobald der Verfolger in Reichweite ist.
               wartenS: p > 0 ? +(SPICE_ATTACK_RETRY_MS / 1000 / p).toFixed(1) : null,
               sperreMs: SPICE_PASS_BLOCK_MS };
    },

    ghostPassProbe(o) {
      const opt = o || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkSpice = ghostCfg.spice;
      const echtNow = Date.now;
      try {
        ghostCfg.spice = 1;
        let uhr = echtNow();
        Date.now = () => uhr;
        const mk = (total) => ({ role: 'ghost', alias: 'P', tileAt: 0, tileCode: 0x02,
          ghost: { tilesTotal: total, tileIndex: 0, form: 0, formAt: uhr, attackUntil: 0,
                   closeSince: 0, mistakeUntil: 0, passPhase: null, passZiel: null,
                   passSince: 0, passBlockUntil: 0, naehern: 0 } });
        const hinten = mk(0), vorne = mk(0.5);
        garage.push(hinten, vorne);
        const g = hinten.ghost;
        // Den Zustand setzen, den ein gewuerfelter Angriff erzeugt.
        g.attackUntil = uhr + 1e9;   // wird von der Sequenz selbst beendet
        g.passSince = uhr;
        g.passPhase = 'raus';
        g.attackSide = 1;
        g.passZiel = vorne;
        vorne.ghost.yieldSide = -1;
        vorne.ghost.yieldUntil = uhr + 1e9;
        const reihe = [];
        const schritt = 60;
        for (let t = 0; t < (opt.dauerMs || 8000); t += schritt) {
          uhr += schritt;
          if (opt.ueberholtNach !== null && opt.ueberholtNach !== undefined
              && t >= opt.ueberholtNach) {
            // Vorbei: der Fortschritt des Verfolgers ueberholt den des anderen.
            hinten.ghost.tilesTotal = vorne.ghost.tilesTotal + 1.0;
          }
          const r = ghostSpice(hinten, { tight: 0, dist: 99, key: 'p' });
          reihe.push({ t, phase: g.passPhase || '-', versatz: +(r.attack || 0).toFixed(3),
                       faktor: +r.factor.toFixed(4), laeuft: !!g.attackUntil });
          if (!g.attackUntil && t > (opt.ueberholtNach || 0)) break;
        }
        return { reihe, gesperrtBis: g.passBlockUntil ? g.passBlockUntil - uhr : 0,
                 phasen: [...new Set(reihe.map(x => x.phase))] };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach(c => garage.push(c));
        ghostCfg.spice = merkSpice;
      }
    },

    // ---- Setzt ein Ghost auf einer Kurvenkachel zum Ueberholen an? -------------
    //
    // Soll er NICHT. Der Vorausblick verbietet es schon, aber den gibt es nur mit Karte -
    // ohne Karte war er immer "frei", und dann wurde mitten in einer Haarnadel angesetzt.
    // Geprueft wird ueber den gemeldeten Code der Kachel UNTER dem Auto, der keine Karte
    // braucht.
    ghostPassArming(tileCode, versuche) {
      const merkGarage = garage.splice(0, garage.length);
      const merkSpice = ghostCfg.spice;
      const echtNow = Date.now;
      try {
        ghostCfg.spice = 1;
        let uhr = echtNow();
        Date.now = () => uhr;
        const mk = (total) => ({ role: 'ghost', alias: 'P', tileAt: 0, tileCode,
          ghost: { tilesTotal: total, tileIndex: 0, form: 0, formAt: uhr, attackUntil: 0,
                   closeSince: uhr - 5000, mistakeUntil: 0, passPhase: null, passZiel: null,
                   passSince: 0, passBlockUntil: 0, naehern: 0, attackTriedAt: 0 } });
        const hinten = mk(0), vorne = mk(0.4);
        garage.push(hinten, vorne);
        let gestartet = 0;
        for (let i = 0; i < (versuche || 400); i++) {
          uhr += 60;
          // Kleben halten, damit die Zuendbedingung immer erfuellt ist.
          hinten.ghost.closeSince = uhr - 5000;
          ghostSpice(hinten, { tight: 0, dist: 99, key: 'p' });
          if (hinten.ghost.attackUntil) {
            gestartet++;
            // Zuruecksetzen und weiter wuerfeln.
            hinten.ghost.attackUntil = 0; hinten.ghost.passPhase = null;
            hinten.ghost.passZiel = null; hinten.ghost.attackTriedAt = 0;
            hinten.ghost.passBlockUntil = 0;
          }
        }
        return { gestartet, takte: versuche || 400, code: tileCode };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach(c => garage.push(c));
        ghostCfg.spice = merkSpice;
      }
    },

    // ---- Die Ideallinie je Kurvenzug: Richtung und Form -------------------------
    //
    // Zwei Groessen, und beide waren falsch: das MITTEL sagt, auf welcher Seite die Linie in
    // der Kurve liegt (Vorzeichenfehler), die SPANNE, ob sie darin ueberhaupt eine Form hat
    // (der Deckel schnitt sie zur Konstanten ab).
    lineShape(code, model) {
      const keep = currentTrackTiles;
      const mVor = getLineModel();
      try {
        if (model) setLineModel(model);
        lineCache = null;
        const p = codeToTrack(code);
        if (!p) return null;
        currentTrackTiles = p.tiles;
        // Ausdruecklich ueber window: der bare Name wuerde hier zwar auch die globale
        // Eigenschaft finden, aber nur weil dies kein Modul ist. Das ist eine Zusage,
        // die niemand gemacht hat.
        const rows = window.OMEGA_TEST.compareLines(p.tiles, 8);
        const je = new Map();
        rows.forEach((r) => {
          const dir = ghostTurnOf(r.type);
          if (!dir) return;
          if (!je.has(r.tile)) je.set(r.tile, { dir, werte: [] });
          je.get(r.tile).werte.push(r.calc);
        });
        // Nach Kurvenzug zusammenfassen: eine Vierfachkurve ist EINE Kurve.
        const zuege = [];
        let cur = null;
        for (const [tile, o] of [...je.entries()].sort((a, b) => a[0] - b[0])) {
          if (cur && cur.dir === o.dir && tile === cur.bis + 1) {
            cur.bis = tile; cur.werte.push(...o.werte);
          } else {
            cur = { dir: o.dir, von: tile, bis: tile, werte: [...o.werte] };
            zuege.push(cur);
          }
        }
        return zuege.map(z => ({
          von: z.von, bis: z.bis, dir: z.dir,
          mittel: +(z.werte.reduce((s, x) => s + x, 0) / z.werte.length).toFixed(4),
          spanne: +(Math.max(...z.werte) - Math.min(...z.werte)).toFixed(4),
        }));
      } finally {
        currentTrackTiles = keep;
        setLineModel(mVor);
        lineCache = null;
      }
    },

    // ---- Was traegt jede Einstellung zum gesendeten Byte bei? --------------------
    //
    // Ein ECHTER Ghost laeuft durch ghostTick, die Uhr ist gefaelscht, und gemessen werden
    // die Bytes, die buildCommandPacket erzeugt. Kein Nachbau der Zusammensetzung: der
    // koennte stimmen, waehrend das Original falsch ist - genau der Fehler, der bei der
    // Ideallinie zwei Fassungen lang unentdeckt blieb.
    //
    // lage: 'ohne'  kein Streckencode (Teppich ohne gedrucktes Muster)
    //       'codes' Codes kommen, aber keine Strecke gebaut oder gescannt
    //       'karte' Codes und Strecke
    async ghostDriveProbe(o) {
      const opt = o || {};
      const lage = opt.lage || 'karte';
      const takte = opt.takte || 300;
      const dtMs = 45;
      const tileMs = opt.tileMs || 700;
      const keepTiles = currentTrackTiles;
      const merkCfg = JSON.parse(JSON.stringify(ghostCfg));
      const echtNow = Date.now;
      // VOR dem try, weil das finally sie abmelden muss. Standen sie im try, war "car" im
      // finally nicht im Bereich - der Wurf von dort liess dann auch "Date.now = echtNow"
      // aus, und die gefaelschte Uhr blieb fuer den Rest der Seite stehen.
      let car = null, zweit = null;
      try {
        const p = codeToTrack(opt.code || 'SG2H2G2R2');
        currentTrackTiles = (lage === 'karte') ? p.tiles : [];
        lineCache = null;
        if (opt.cfg) Object.assign(ghostCfg, opt.cfg);
        // Die Uhr faelschen, damit der Lauf deterministisch ist. Ohne das ist dt in einer
        // synchronen Schleife praktisch null und der Ghost beschleunigt nie.
        let uhr = echtNow();
        Date.now = () => uhr;
        const bytes = [];
        car = {
          role: 'ghost', alias: 'Sonde', writeInFlight: false,
          tileCode: 0x02, tileCount: (lage === 'ohne') ? null : 0,
          lastCodeAt: (lage === 'ohne') ? 0 : uhr, yaw: 0,
          rx: { properties: { writeWithoutResponse: true },
                writeValueWithoutResponse(b) {
                  bytes.push([b[7] > 127 ? b[7] - 256 : b[7],
                              ((b[6] - 0xdf) & 0xff) > 127 ? ((b[6] - 0xdf) & 0xff) - 256
                                                           : ((b[6] - 0xdf) & 0xff),
                              car.tileCode]);
                  return Promise.resolve();
                } },
        };
        // Ein zweites Auto, damit ghostLane() ueberhaupt etwas verteilt: unter zwei Ghosts
        // gibt es keine Spuren, und beide muessen IN der Garage stehen, weil die Funktion
        // das Auto ueber garage.indexOf findet.
        zweit = { role: 'ghost', alias: 'Sonde2', writeInFlight: false,
                        tileCode: 0x02, tileCount: 0, lastCodeAt: uhr, yaw: 0, rx: null };
        garage.push(car, zweit);
        startGhost(car);
        startGhost(zweit);
        // Von Hand takten. ghostTaktLoeschen und nicht clearInterval: der Zeitgeber wird
        // erst in einem setTimeout angelegt, car.timer steht hier also noch auf null - und
        // genau dieses clearInterval war ein No-op, das je Prueflauf zwei Phantom-Zeitgeber
        // stehen liess.
        ghostTaktLoeschen(car);
        ghostTaktLoeschen(zweit);
        car.ghost.freeRun = true;
        // Der Querversatz gegen Rammen wird von einem Zeitgeber gestellt; im Prueflauf wird
        // er FESTGEHALTEN, sonst mischt er sich in jede Messung. 0 heisst: aus.
        car.ghost.bias = opt.bias === undefined ? 0 : opt.bias;
        // Ausweichen von aussen setzbar: eine Attacke wird gewuerfelt, also ist sie kein
        // Pruefmittel. Der Zustand, den sie SETZT, ist eines.
        if (opt.yieldSide) {
          car.ghost.yieldSide = opt.yieldSide;
          car.ghost.yieldUntil = uhr + 1e9;
        }
        const tempo = [], ziel = [], vorsteuer = [], gang = [], drehzahl = [];
        const phase = [], mix = [], naehern = [];
        // Die Pakete VOR der Schleife wegzaehlen: startGhost() ruft stopGhost(), und das
        // schreibt eine Null-Nachricht. Sie hat keinen Takt und damit keinen Kanalwert.
        const vorLauf = bytes.length;
        let seitKachel = 0, k = 0, schaltSeit = 0;
        for (let i = 0; i < takte; i++) {
          uhr += dtMs;
          seitKachel += dtMs;
          if (lage !== 'ohne') {
            car.lastCodeAt = uhr;
            if (seitKachel >= tileMs) {
              seitKachel = 0;
              k++;
              car.tileCount = k & 0xff;
              car.tileAt = uhr;
              // Der Code der Kachel, auf der das Auto jetzt liegt. Bei 'codes' ohne Karte
              // ist das die einzige Ortsinformation, die es ueberhaupt gibt.
              //
              // (k - 1) UND NICHT k, und das ist die dritte Ausrichtungsfalle in diesem
              // Prueflauf: ghostTick setzt g.tileIndex beim ERSTEN Kachelwechsel auf 0, nicht
              // auf 1. Mit tiles[k] lagen der gemeldete Code (den here liest) und der
              // Kachelindex (den der Vorausblick liest) eine Kachel auseinander - und dann
              // sieht man auf der Start/Ziel-Kachel den Kurvenanteil der Kurve davor.
              car.tileCode = p.tiles[(k - 1) % p.tiles.length].type;
            }
          }
          const vorPaket = bytes.length;
          ghostTick(car);
          // DIE SCHALTUNTERBRECHUNG AUF DIE GEFAELSCHTE UHR SETZEN, und das ist eine
          // Berichtigung an diesem Prueflauf selbst.
          //
          // st.isShifting wird in 40-physics.js von einem setTimeout zurueckgesetzt, und
          // waehrend einer Unterbrechung gibt es keinen Zug (siehe 40-physics.js:1366). Ein
          // Prueflauf, der Date.now faelscht und synchron laeuft, laesst diesen Zeitgeber
          // NIE dran kommen - nach dem ersten Hochschalten hing das Auto dauerhaft ohne Zug
          // und blieb bei 24 Prozent stehen, bei JEDEM Ziel. Ich habe daraus erst eine
          // Beharrungsabweichung des Reglers geschlossen; es war der Prueflauf. Echte
          // Zeitgeber abzuwarten geht auch nicht: in einem nicht angezeigten Fenster sind sie
          // auf eine Sekunde gedrosselt, und 300 Takte waeren fuenf Minuten.
          //
          // Uebernommen wird deshalb NUR DIE UHR dieser einen Zusicherung, nicht die Logik:
          // nach shiftMs gefaelschter Zeit ist die Unterbrechung vorbei - genau das, was der
          // Zeitgeber in der App sagt.
          const stt = car.ghost.engine ? car.ghost.engine.state : null;
          if (stt && stt.isShifting) {
            if (!schaltSeit) schaltSeit = uhr;
            else if (uhr - schaltSeit >= (car.ghost.engine.config.shiftMs || 0)) {
              stt.isShifting = false;
              schaltSeit = 0;
            }
          } else {
            schaltSeit = 0;
          }
          // Mikrotasks abarbeiten: writeToCar setzt writeInFlight in einem finally NACH
          // einem await zurueck, und ohne diese Pause faellt jedes zweite Paket aus.
          await Promise.resolve(); await Promise.resolve();
          // DAS TEMPO ist die Groesse, um die es bei der Kurvendrosselung geht - nicht das
          // Gasbyte. Das Gas ist die ANTWORT eines Reglers: faellt das Zieltempo, bremst er
          // erst und gibt danach wieder Gas, um das neue Ziel zu halten. Ein Mittel ueber
          // das Gasbyte kann in der Kurve deshalb hoeher liegen als auf der Geraden, ohne
          // dass irgendetwas falsch ist. Genau darauf bin ich beim ersten Anlauf
          // hereingefallen.
          // ALLE Kanaele je PAKET und nicht je Takt. Ein Takt, in dem writeToCar nichts
          // sendet - ein Phasenwechsel, oder ein noch laufender Schreibvorgang -, erzeugt
          // kein Paket. Zwei Listen verschiedener Laenge nebeneinander und mit demselben
          // Index gelesen sind dann still verschoben, und die Verschiebung WAECHST mit dem
          // Lauf: am Ende gruppiert man Tempi unter den falschen Kacheltypen.
          //
          // Genau dieser Fehler ist mir beim Zieleinlauf-Prueflauf schon einmal unterlaufen.
          // Dass er hier ein zweites Mal auftrat, ist der Grund, warum er jetzt an EINER
          // Stelle geloest ist statt je Kanal.
          //
          // Das ZIELTEMPO ist die Groesse, um die es bei der Kurvenlogik geht; das erreichte
          // Tempo haengt zusaetzlich an der Physik. Das Gasbyte ist fuer beides das falsche
          // Mass - es ist die Antwort eines Reglers und kann in der Kurve hoeher liegen als
          // auf der Geraden, ohne dass etwas falsch ist.
          const e3 = car.ghost.engine;
          for (let q = vorPaket; q < bytes.length; q++) {
            ziel.push(car.ghost.lastTarget === undefined
              ? null : +car.ghost.lastTarget.toFixed(4));
            vorsteuer.push(car.ghost.lastFF === undefined
              ? null : +car.ghost.lastFF.toFixed(4));
            phase.push(car.ghost.passPhase || '-');
            mix.push(+(car.ghost.kurveMix || 0).toFixed(3));
            naehern.push(+(car.ghost.naehern || 0).toFixed(3));
            gang.push(e3 ? e3.state.currentGear : null);
            drehzahl.push(e3 && e3.rpmRawAt
              ? Math.round(e3.rpmRawAt(e3.state.speedKmh, e3.state.currentGear)) : null);
            tempo.push(e3 ? +(e3.state.speedKmh / e3.config.topSpeedKmh).toFixed(4) : 0);
          }
        }
        stopGhost(car);
        stopGhost(zweit);
        const roh = bytes.slice(vorLauf);
        return { lenk: roh.map(b => b[0]), gas: roh.map(b => b[1]),
                 kachel: roh.map(b => b[2]), tempo, ziel, vorsteuer, gang, drehzahl,
                 phase, mix, naehern,
                 // Die KRAEFTE an genau der Stelle, an der es klebt. Sagt thrust > resist
                 // und faehrt das Auto trotzdem nicht schneller, sitzt die Grenze nicht im
                 // Antrieb, sondern in e.update().
                 kraefte: (() => {
                   const e2 = car.ghost && car.ghost.engine;
                   if (!e2 || !e2.thrustAt) return null;
                   const A2 = e2.accelScale();
                   const v2 = e2.state.speedKmh;
                   const gg = e2.state.currentGear;
                   const zug = e2.thrustAt(v2, gg, 1, A2);
                   const wid = e2.resistAt(v2, A2, true);
                   const zugNaechster = gg + 1 < e2.config.gears.length
                     ? e2.thrustAt(v2, gg + 1, 1, A2) : null;
                   const zugVoriger = gg > 0 ? e2.thrustAt(v2, gg - 1, 1, A2) : null;
                   return { v: +v2.toFixed(4), gang: gg, A: +A2.toFixed(5),
                            zug: +zug.toFixed(4), widerstand: +wid.toFixed(4),
                            netto: +(zug - wid).toFixed(4),
                            zug_gang_darunter: zugVoriger === null ? null : +zugVoriger.toFixed(4),
                            zug_gang_darueber: zugNaechster === null ? null : +zugNaechster.toFixed(4),
                            rpm: Math.round(e2.rpmRawAt(v2, gg)) };
                 })(),
                 // Der Lernzustand: hat sich ueber die Runden etwas bewegt?
                 lernen: car.learn ? JSON.parse(JSON.stringify(car.learn)) : null,
                 runden: car.ghost ? car.ghost.laps : null,
                 // Die Konfiguration des GHOST-Motors gegen die des Fahrerautos. Jeder
                 // Unterschied hier ist eine Erklaerung oder eine Absicht - beides will man
                 // sehen, wenn ein Ghost nicht so faehrt wie das Auto daneben.
                 cfgDiff: (() => {
                   const e2 = car.ghost && car.ghost.engine;
                   if (!e2) return null;
                   const raus = {};
                   for (const kk of Object.keys(physEngine.config)) {
                     const a1 = physEngine.config[kk], b1 = e2.config[kk];
                     if (typeof a1 === 'number' && typeof b1 === 'number') {
                       if (Math.abs(a1 - b1) > 1e-9) raus[kk] = [a1, b1];
                     } else if (typeof a1 === 'boolean' && a1 !== b1) raus[kk] = [a1, b1];
                   }
                   return raus;
                 })(),
                 endzustand: car.ghost && car.ghost.engine
                   ? JSON.parse(JSON.stringify(car.ghost.engine.state)) : null,
                 gaenge: car.ghost && car.ghost.engine
                   ? car.ghost.engine.config.gears.map(x => x.topFrac) : null,
                 upshiftRpm: car.ghost && car.ghost.engine
                   ? car.ghost.engine.config.upshiftRpm : null,
                 autoShift: car.ghost && car.ghost.engine
                   ? car.ghost.engine.config.autoShift : null,
                 pakete: bytes.length, lage,
                 tileIndex: car.ghost ? car.ghost.tileIndex : null };
      } finally {
        // DIE UHR ZUERST, und das ist keine Kosmetik. Eine Aufraeumzeile, die werfen kann,
        // macht alle folgenden unerreichbar - und genau das ist hier passiert: das Abmelden
        // stand oben, warf "car is not defined", und danach lief "Date.now = echtNow" nie.
        // Die gefaelschte Uhr blieb fuer den Rest der Seite stehen, und der naechste Test
        // mit einer Warteschleife auf Date.now legte den ganzen Reiter still.
        Date.now = echtNow;
        currentTrackTiles = keepTiles;
        lineCache = null;
        Object.keys(merkCfg).forEach(x => { ghostCfg[x] = merkCfg[x]; });
        // Abmelden, BEVOR die Autos aus der Garage fliegen: sonst bleibt ein Zeitgeber auf
        // einem Auto, das die Garage nicht mehr kennt, und der laeuft bis zum Neuladen.
        // stopGhost() waere hier zuviel - es schreibt eine Nullnachricht, und die zaehlte in
        // der Paketliste des Prueflaufs mit.
        for (const c of [car, zweit]) {
          if (!c) continue;
          ghostTaktLoeschen(c);
          if (c.ghost) c.ghost.running = false;
        }
        // Die zwei Sondenautos wieder aus der Garage, sonst stehen sie in der Liste.
        for (let i = garage.length - 1; i >= 0; i--) {
          if (garage[i] && garage[i].alias && /^Sonde/.test(garage[i].alias)) garage.splice(i, 1);
        }
      }
    },

    // ---- Laengs-G: zeigt es das Ergebnis oder die Anforderung? -----------------
    //
    // Gemeldet als "warum geht das rote simulierte Gyro nach hinten, wenn ich im Stand
    // bremse?". Die Antwort war: weil es st.longUse zeigte, den ANGEFORDERTEN Laengsbedarf.
    // Im Stand gibt es keine Verzoegerung, also darf da nichts anliegen.
    //
    // Gemessen wird am Zustand der Physik und nicht am SVG: die Anzeige liest st.gLong, und
    // wenn die Zahl stimmt, stimmt der Punkt.
    physGTrace(o) {
      const opt = o || {};
      const e = physEngine, st = e.state;
      const merk = OMEGA_TEST.zustandKopie(st);
      try {
        st.speedKmh = (opt.startKmh || 0) / REAL_SCALE;
        st.virtualSpeed = st.speedKmh / e.config.topSpeedKmh;
        st.gLong = 0; st.gLongV = undefined;
        st.driveMode = 'forward';
        const dt = CONTROL_SEND_INTERVAL_MS / 1000;
        const reihe = [];
        const n = Math.round((opt.sekunden || 1) / dt);
        for (let i = 0; i < n; i++) {
          e.update({ steering: 0, throttle: opt.throttle || 0, brake: opt.brake || 0,
                     headlights: false }, dt);
          reihe.push({ t: +((i + 1) * dt).toFixed(3),
                       kmh: +(st.speedKmh * REAL_SCALE).toFixed(2),
                       gLong: +st.gLong.toFixed(4) });
        }
        return { reihe, ende: reihe[reihe.length - 1],
                 gMax: Math.max.apply(null, reihe.map(x => Math.abs(x.gLong))) };
      } finally {
        OMEGA_TEST.zustandZurueck(st, merk);
      }
    },

    // Die Reifenmischung von aussen setzen. Ein Wechsel geht in der App nur ueber einen
    // Boxenstopp, und den fuer eine Anzeigepruefung nachzuspielen waere ein halbes Rennen.
    tyreSet(kind) {
      if (typeof tyres === 'undefined') return null;
      tyres = (kind === 'wet') ? 'wet' : 'slick';
      applySurface();
      return { reifen: tyres,
               profil: document.body.classList.contains('tyres-wet'),
               grip: +physEngine.config.gripScale.toFixed(4) };
    },

    // ---- Die Wetterfront, von aussen lesbar ------------------------------------
    //
    // Sie ist die EINE Zahl, aus der Ton, Griff, Tropfen und Radarbild kommen; ohne einen
    // Zugang dazu ist "der Umschwung dauert fuenf Sekunden" eine Behauptung. Gelesen wird
    // hier, was die PHYSIK bekommt, nicht was die Anzeige sagt.
    wxProbe() {
      return {
        front: typeof wxFront === 'undefined' ? null : +wxFront.toFixed(4),
        ziel: typeof wxFrontTo === 'undefined' ? null : wxFrontTo,
        staerke: typeof wxRainLevel === 'function' ? +wxRainLevel().toFixed(4) : null,
        grip: +physEngine.config.gripScale.toFixed(4),
        aqua: +physEngine.config.aquaplaning.toFixed(4),
        regenTon: (typeof ambience === 'object' && ambience)
          ? +(ambience.rainLevel || 0).toFixed(4) : null,
        wetter: typeof weather === 'undefined' ? null : weather,
        // Die Regenformen: wieviele ziehen, und wo stehen sie laengs des Windes. Ohne das
        // ist "sie kommen von aussen und hoeren nicht auf" eine Behauptung.
        regen: (typeof wxBlobs === 'undefined') ? null : (() => {
          const r = wxBlobs.filter(b => b.regen);
          return { gesamt: r.length, aktiv: r.filter(b => b.aktiv).length,
                   laengs: r.filter(b => b.aktiv).map(b => +b.l.toFixed(2)).sort((x, y) => x - y) };
        })(),
        reifen: typeof tyres === 'undefined' ? null : tyres,
      };
    },
    // Die Wolken von aussen weiterschieben. In Scheiben von 100 ms und nicht in einem
    // Sprung: das Fortbewegen enthaelt Schwellen (Ausgang, Ausblenden), und ein einziger
    // grosser Schritt wuerde ueber sie hinwegspringen. Ein Test, der eine Schwelle
    // ueberspringt, prueft sie nicht.
    wxSchritt(sekunden) {
      if (typeof wxBlobsWeiter !== 'function') return null;
      const n = Math.max(1, Math.round((sekunden || 0) / 0.1));
      for (let i = 0; i < n; i++) wxBlobsWeiter(0.1);
      return this.wxProbe();
    },
    // Die Front von aussen stellen, damit ein Test nicht fuenf Sekunden warten muss.
    wxSet(front) {
      if (typeof wxFront === 'undefined') return null;
      wxFront = Math.max(-1, Math.min(1, front));
      wxFrontTo = wxFront;
      // DEN WOLKENSTROM MITZIEHEN. Ohne das stellte wxSet die Front, liess die Formen aber
      // stehen - und dann sagte die Sonde "Staerke 1" bei null ziehenden Regenformen. Genau
      // die Divergenz zwischen Zahl und Bild, gegen die der ganze Entwurf steht, nur eben
      // im Prueflauf statt in der App.
      if (wxFrontTo === 0) wxRegenLosschicken(); else wxRegenAbbestellen();
      applySurface();
      return this.wxProbe();
    },

    sampleLine(tiles, steps) {
      const keep = currentTrackTiles;
      currentTrackTiles = tiles;
      const out = [];
      const car = { ghost: { tileIndex: 0, tileMs: 1000 }, tileAt: 0 };
      try {
        ghostLine();
        for (let i = 0; i < tiles.length; i++) {
          car.ghost.tileIndex = i;
          for (let k = 0; k < (steps || 5); k++) {
            // ghostTilePhase rechnet aus Date.now() - tileAt; hier wird tileAt so gesetzt,
            // dass genau die gewuenschte Phase herauskommt.
            const ph = k / (steps || 5);
            car.tileAt = Date.now() - ph * car.ghost.tileMs * ghostTileLenFactor(i);
            out.push({ tile: i, type: tiles[i].type, phase: ph,
                       off: ghostLineOffset(car) });
          }
        }
      } finally { currentTrackTiles = keep; lineCache = null; }
      return out;
    },
  };
