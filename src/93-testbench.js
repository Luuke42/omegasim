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
    // `b` ist die Kastenbreite und gilt nur im Vollbild - ohne sie prueft ein breites
    // Testfenster eine Lage, in die ein Handy nie geraet.
    // Den Modus von aussen lesen und stellen. Ein Prueflauf, der ihn voraussetzt, ist auf
    // Sand gebaut: er steht in der Selbstsicherung und kann beim Start schon an sein.
    // Gestellt wird OHNE zweiSpielerSetzen() - der Prueflauf will die Weiche, nicht die
    // Nebenwirkungen (Garage neu zeichnen, Cockpit neu einpassen, Rolle zuruecknehmen).
    zweiSpielerLage() { return zweiSpieler; },
    zweiSpielerStellen(an) { zweiSpieler = !!an; return zweiSpieler; },

    // Der Erkennungszustand eines Spielers, zum Sichern und Zuruecklegen in Prueflaeufen.
    // Herausgegeben wird das OBJEKT und keine Kopie: ein Prueflauf muss ihn setzen koennen.
    crashLage(wer) { return crashLageVon(wer); },

    // Der Schadensstand von Auto 2, lesbar und setzbar. Zwei getrennte Wege, weil das
    // Setzen im Prueflauf eine andere Sache ist als das Lesen einer Messung.
    schadenZweiLesen() {
      return { wert: schadenZwei.wert,
               licht: { front: schadenZwei.licht.front, rear: schadenZwei.licht.rear } };
    },
    schadenZweiSetzen(wert, front, rear) {
      schadenZwei.wert = wert;
      schadenZwei.licht.front = !!front;
      schadenZwei.licht.rear = !!rear;
      return this.schadenZweiLesen();
    },

    // ---- DER BOXENKNOPF: an, aus, und wie lange er haelt -----------------------------
    //
    // DREI BESTELLUNGEN AUF EINMAL, und alle drei sind Bedienung:
    //
    //   1. "Wenn ich ihn aktiviere, ist er dann nicht solange aktiv, bis ich ihn
    //      deaktiviere oder bis ich stehen bleibe?" - bis v0.6.56 beendete ein Zeitgeber
    //      die ANFAHRT nach fuenf Sekunden, lautlos.
    //   2. "Zum Deaktivieren nur 1x drücken statt 2x."
    //   3. Im Doppelausdruck-Modus loest der Knopf gar nichts aus.
    //
    // DIE UHR WIRD GEFAELSCHT, weil Aussage 1 eine Aussage ueber ZEIT ist: der Prueflauf
    // laesst zwanzig Sekunden vergehen, ohne zwanzig Sekunden zu warten. Der Zeitgeber
    // selbst lief ueber setTimeout und laesst sich so nicht ueberspringen - deshalb wird
    // zusaetzlich geprueft, dass ueberhaupt KEINER mehr gestellt wird (pitLimiterOffen).
    pitKnopfProbe(o) {
      const opt = o || {};
      const echtNow = Date.now;
      const merk = { state: pitState, trigger: pitTrigger, an: pitLaneEnabled,
                     plan: pitPlan, doppeltBis: pitDoubleArmedUntil,
                     ersterAt: pitDoubleFirstAt, sperre: pitRearmBlockedUntil,
                     letzter: pitLastPress };
      let uhr = 6000000;
      try {
        Date.now = () => uhr;
        pitLaneEnabled = true;
        pitTrigger = opt.trigger || 'button';
        pitRearmBlockedUntil = 0;
        pitLastPress = 0;
        setPitState('off');

        // ---- Ein Druck: an ------------------------------------------------------
        requestPitStop();
        const nachEins = pitState;
        // Ein Zeitgeber, der die Anfahrt beendet, darf gar nicht erst gestellt sein.
        const weckerGestellt = !!pitLimiterTimer;

        // ---- Zeit vergeht: der Limiter muss BLEIBEN -----------------------------
        // Zwanzig Sekunden, also das Vierfache der alten Frist von fuenf.
        uhr += (opt.sekunden === undefined ? 20 : opt.sekunden) * 1000;
        const nachWarten = pitState;

        // ---- Noch ein Druck: aus, mit EINEM Druck -------------------------------
        // Bewusst weit nach dem alten Doppeltipp-Fenster von 700 ms: frueher haette
        // genau das nur die Meldung "Nochmal druecken" erzeugt.
        requestPitStop();
        const nachZwei = pitState;

        // ---- Und der Doppelausdruck-Modus: der Knopf loest nicht aus ------------
        pitTrigger = 'double';
        pitRearmBlockedUntil = 0;
        setPitState('off');
        uhr += 5000;
        requestPitStop();
        const doppeltNachDruck = pitState;
        // Abbrechen muss trotzdem gehen: dafuer von Hand hineinsetzen.
        setPitState('limited');
        uhr += 1000;
        requestPitStop();
        const doppeltNachAbbruch = pitState;

        return { nachEins, weckerGestellt, nachWarten, nachZwei,
                 doppeltNachDruck, doppeltNachAbbruch,
                 gewartetS: opt.sekunden === undefined ? 20 : opt.sekunden,
                 // Die alte Frist als Literal: PIT_LIMITER_MAX_MS gibt es nicht mehr.
                 // Sie steht hier, damit der Testkopf sagen kann, wogegen gemessen wird.
                 alteFristS: 5 };
      } finally {
        Date.now = echtNow;
        if (pitLimiterTimer) { clearTimeout(pitLimiterTimer); pitLimiterTimer = null; }
        pitTrigger = merk.trigger;
        setPitState(merk.state);
        pitLaneEnabled = merk.an;
        pitPlan = merk.plan;
        pitDoubleArmedUntil = merk.doppeltBis;
        pitDoubleFirstAt = merk.ersterAt;
        pitRearmBlockedUntil = merk.sperre;
        pitLastPress = merk.letzter;
      }
    },

    // ---- TANKEN BEIDE UNABHAENGIG? ---------------------------------------------------
    //
    // BESTELLT: "Tanken soll unabhängig bei beiden klappen."
    //
    // Der Prueflauf laesst BEIDE gleichzeitig tanken - Auto 1 ueber seinen Boxenstopp,
    // Auto 2 ueber seinen - und misst, ob sich die zwei stoeren. Die Falle, auf die es
    // ankommt: fuelTankTick() von Auto 1 hat die Ausnahme `pitState !== 'servicing'`, damit
    // der Tank nicht sinkt, waehrend gepumpt wird. Gilt diese Ausnahme versehentlich auch
    // fuer Auto 2, verbraucht es waehrend eines fremden Boxenstopps nichts - und umgekehrt
    // waere ein Boxenstopp von Auto 2, der Auto 1 den Verbrauch abstellt, ebenso falsch.
    //
    // Gemessen wird deshalb an BEIDEN Staenden gleichzeitig, mit Gas auf beiden.
    async tankenBeideProbe(o) {
      const opt = o || {};
      const uhrEcht = Date.now, perfEcht = performance.now;
      const merk = { zwei: zweiSpieler, p1: playerCar, p2: playerCar2,
                     gas: p2Throttle, steer: p2Steer, phys: physicsEnabled,
                     fuel1: fuel, tank2: tankZweiStand(), pit: pitState,
                     plan: pitPlan, drain: fuelDrainPerSec, gasEins: throttleY };
      const a1 = { device: { id: 'probe-t1' }, role: 'player', alias: 'P1', rx: null,
                   testSenke: [] };
      const a2 = { device: { id: 'probe-t2' }, role: 'player2', alias: 'P2', rx: null,
                   testSenke: [] };
      const reihe = [];
      try {
        let t = 5000000;
        Date.now = () => t;
        performance.now = () => t;
        zweiSpieler = true;
        physicsEnabled = true;
        playerCar = a1;
        playerCar2 = a2;
        fuelDrainPerSec = opt.drain === undefined ? 1 : opt.drain;
        fuel = opt.start === undefined ? 40 : opt.start;
        tankZweiFuellen(opt.start === undefined ? 40 : opt.start);
        tankZweiTaktVergessen();
        phys2TaktVergessen();
        physEngine2.reset();
        physEngine2Abgleichen();
        p2Steer = 0;

        // ---- Abschnitt 1: BEIDE fahren. Beide Staende muessen sinken. -------------
        p2Throttle = 1;
        throttleY = 1;
        const takte = Math.round((opt.sekunden === undefined ? 4 : opt.sekunden)
                                 * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte; i++) {
          fuelTankTick(1);          // der Weg von Auto 1, wie in sendControlValue()
          spielerZweiSenden();      // darin steckt fuelTankTick(p2Throttle, 2)
          if (i % 20 === 0 || i === takte - 1) {
            reihe.push({ abschnitt: 'fahren', s: +(i * 0.045).toFixed(2),
                         t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2) });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const nachFahren = { t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2) };

        // ---- Abschnitt 2: Auto 1 IN DER BOX, Auto 2 faehrt weiter ----------------
        // Auto 1 steht und wird betankt; Auto 2 gibt Gas. Der Stand von Auto 1 muss
        // STEIGEN, der von Auto 2 weiter SINKEN.
        throttleY = 0;
        pitPlan = { refuel: 100, tyres: false, repair: false };
        pitState = 'servicing';
        const takte2 = Math.round((opt.sekunden === undefined ? 4 : opt.sekunden)
                                  * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte2; i++) {
          // Die Boxenpumpe von Auto 1, so wie pitLaneTick() sie rechnet.
          const dt = CONTROL_SEND_INTERVAL_MS / 1000;
          if (fuel < 100) fuel = Math.min(100, fuel + PIT_FUEL_PER_SEC * dt);
          fuelTankTick(0);
          spielerZweiSenden();
          if (i % 20 === 0 || i === takte2 - 1) {
            reihe.push({ abschnitt: 'box1', s: +(i * 0.045).toFixed(2),
                         t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2) });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const nachBox1 = { t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2) };

        // ---- Abschnitt 3: Auto 2 IN DER BOX, Auto 1 faehrt weiter ----------------
        pitState = 'off';
        pitPlan = null;
        throttleY = 1;
        // BREMSEN, nicht nur Gas weg: das Auto rollt mit ueber 200 km/h, und der
        // Coast-Drag allein bringt es in acht Sekunden nur auf 174. Genau das ist der
        // gemeldete Fall - der Knopf war gedrueckt, und "nichts passierte".
        p2Throttle = opt.bremsen === false ? 0 : -1;
        boxZweiAnfordern();
        const takte3 = Math.round((opt.sekunden === undefined ? 4 : opt.sekunden)
                                  * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte3; i++) {
          fuelTankTick(1);
          // Bremsen, bis es fast steht - dann den Finger weg. Der Service verlangt beides:
          // langsam UND kein Eingang (Math.abs(p2Throttle) < 0.1), sonst begaenne er,
          // waehrend man noch auf der Bremse steht.
          if (opt.bremsen !== false
              && Math.abs(physEngine2.state.speedKmh) * REAL_SCALE < 8) p2Throttle = 0;
          spielerZweiSenden();
          if (i % 20 === 0 || i === takte3 - 1) {
            reihe.push({ abschnitt: 'box2', s: +(i * 0.045).toFixed(2),
                         t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2),
                         lage: boxZweiLage(),
                         kmh: +(Math.abs(physEngine2.state.speedKmh) * REAL_SCALE).toFixed(1),
                         schwelle: +(PIT_STANDSTILL_KMH * REAL_SCALE).toFixed(1) });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const nachBox2 = { t1: +fuel.toFixed(2), t2: +tankZweiStand().toFixed(2) };
        return { start: opt.start === undefined ? 40 : opt.start,
                 nachFahren, nachBox1, nachBox2, reihe,
                 drain: fuelDrainPerSec, pumpe: PIT_FUEL_PER_SEC };
      } finally {
        Date.now = uhrEcht;
        performance.now = perfEcht;
        if (typeof boxZweiAnfordern === 'function' && boxZweiLage() !== 'aus') {
          boxZweiAnfordern();
        }
        zweiSpieler = merk.zwei;
        playerCar = merk.p1;
        playerCar2 = merk.p2;
        p2Throttle = merk.gas;
        p2Steer = merk.steer;
        throttleY = merk.gasEins;
        physicsEnabled = merk.phys;
        fuel = merk.fuel1;
        fuelDrainPerSec = merk.drain;
        pitState = merk.pit;
        pitPlan = merk.plan;
        tankZweiFuellen(merk.tank2);
        physEngine2.reset();
      }
    },

    // ---- TANKT UND REPARIERT DER BOXENSTOPP VON AUTO 2? ------------------------------
    //
    // DREI FRAGEN, und die dritte ist die, die den Modus fair macht:
    //   1. Laeuft die Folge? angefordert -> (anhalten) -> Service -> fertig -> (losfahren)
    //   2. Steigt der Tank und sinkt der Schaden, mit DENSELBEN Raten wie bei Auto 1?
    //   3. Deckelt der Stopp das Tempo, und zwar mit dem eigenen Deckel - der von Auto 1
    //      laeuft ueber topSpeedScale in sendControlValue(), und diesen Weg nimmt Auto 2
    //      gar nicht.
    //
    // Der Prueflauf faelscht die Uhr und stellt p2Throttle selbst: der Stopp beginnt erst
    // im Stillstand, und "Stillstand" heisst hier auch "Daumen weg".
    async boxZweiProbe(o) {
      const opt = o || {};
      const uhrEcht = Date.now, perfEcht = performance.now;
      const merk = { zwei: zweiSpieler, p2: playerCar2, gas: p2Throttle, steer: p2Steer,
                     phys: physicsEnabled, tank: tankZweiStand(),
                     schaden: this.schadenZweiLesen() };
      const a2 = { device: { id: 'probe-box' }, role: 'player2', alias: 'P2',
                   rx: null, testSenke: [] };
      const reihe = [];
      try {
        let t = 4000000;
        Date.now = () => t;
        performance.now = () => t;
        zweiSpieler = true;
        physicsEnabled = true;
        playerCar2 = a2;
        physEngine2.reset();
        physEngine2Abgleichen();
        tankZweiFuellen(opt.tank === undefined ? 30 : opt.tank);
        this.schadenZweiSetzen(opt.schaden === undefined ? 40 : opt.schaden, true, true);
        tankZweiTaktVergessen();
        phys2TaktVergessen();
        p2Steer = 0;
        p2Throttle = 0;                 // steht, Daumen weg
        const lagen = [];
        const anfordern = boxZweiAnfordern();
        lagen.push(boxZweiLage());
        const takte = Math.round((opt.sekunden === undefined ? 12 : opt.sekunden)
                                 * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte; i++) {
          spielerZweiSenden();
          const l = boxZweiLage();
          if (lagen[lagen.length - 1] !== l) lagen.push(l);
          if (i % 20 === 0 || i === takte - 1) {
            reihe.push({
              s: +(i * CONTROL_SEND_INTERVAL_MS / 1000).toFixed(2),
              lage: l, tank: +tankZweiStand().toFixed(2),
              schaden: +schadenVon(2).toFixed(2),
              deckel: boxZweiDeckel(), fertig: boxZweiFertig(),
            });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const fertigNach = reihe.find((x) => x.fertig);
        // Und das Losfahren beendet den Stopp.
        p2Throttle = 1;
        for (let i = 0; i < 6; i++) { spielerZweiSenden(); t += CONTROL_SEND_INTERVAL_MS; }
        lagen.push(boxZweiLage());
        return {
          anfordern, lagen, reihe,
          tankAnfang: opt.tank === undefined ? 30 : opt.tank,
          schadenAnfang: opt.schaden === undefined ? 40 : opt.schaden,
          tankEnde: +tankZweiStand().toFixed(2),
          schadenEnde: +schadenVon(2).toFixed(2),
          lichtEnde: this.schadenZweiLesen().licht,
          fertigNachS: fertigNach ? fertigNach.s : null,
          // Die Raten, mit denen Auto 1 arbeitet - zum Vergleich in einem Zug.
          rateTank: PIT_FUEL_PER_SEC, mindestStandS: PIT_EMPTY_STOP_S,
          deckelSoll: PIT_SPEED_FACTOR,
        };
      } finally {
        Date.now = uhrEcht;
        performance.now = perfEcht;
        if (typeof boxZweiAnfordern === 'function' && boxZweiLage() !== 'aus') {
          boxZweiAnfordern();     // bricht ab
        }
        zweiSpieler = merk.zwei;
        playerCar2 = merk.p2;
        p2Throttle = merk.gas;
        p2Steer = merk.steer;
        physicsEnabled = merk.phys;
        tankZweiFuellen(merk.tank);
        this.schadenZweiSetzen(merk.schaden.wert, merk.schaden.licht.front,
                          merk.schaden.licht.rear);
        physEngine2.reset();
      }
    },

    // ---- GILT DIE GELBE FLAGGE AUCH FUER AUTO 2? -------------------------------------
    //
    // DIE FRAGE, die diesen Punkt zum wertvollsten der offenen gemacht hat: ohne den
    // Autopiloten faehrt Auto 2 bei Gelb mit VOLLGAS in eine Kolonne, die alle anderen
    // gerade einhalten. Eine gelbe Flagge, die fuer ein Auto im Feld nicht gilt, ist keine.
    //
    // Gemessen wird am GAS, das hinausgeht, und am erreichten Tempo - nicht daran, ob eine
    // Funktion gerufen wurde. Vollgas bleibt dabei die ganze Zeit anliegen: der Autopilot
    // muss GEGEN den Daumen regeln, das ist sein Sinn.
    //
    // Die Bahn/Ausdruck-Stellung muss auf 'on' stehen, sonst laeuft der Autopilot
    // ueberhaupt nicht (autopilotGrund: ohne Leitplanken haelt sich das Auto nicht selbst
    // auf der Bahn, und ein Autopilot ohne Querregelung faehrt es in die Bande).
    async gelbZweiProbe(o) {
      const opt = o || {};
      const uhrEcht = Date.now, perfEcht = performance.now;
      const merk = { zwei: zweiSpieler, p2: playerCar2, gas: p2Throttle, steer: p2Steer,
                     phys: physicsEnabled, flagge: flagState, bahn: trackMode,
                     formation: typeof raceFormationLap !== 'undefined'
                       ? raceFormationLap : null };
      const a2 = { device: { id: 'probe-gelb' }, role: 'player2', alias: 'P2',
                   rx: null, testSenke: [] };
      const reihe = [];
      try {
        let t = 3000000;
        Date.now = () => t;
        performance.now = () => t;
        zweiSpieler = true;
        physicsEnabled = true;
        playerCar2 = a2;
        trackMode = 'on';
        if (typeof raceFormationLap !== 'undefined') raceFormationLap = false;
        physEngine2.reset();
        physEngine2Abgleichen();
        tankZweiFuellen(100);
        tankZweiTaktVergessen();
        phys2TaktVergessen();
        autopilotZuruecksetzen(2);
        p2Steer = 0;
        p2Throttle = 1;          // Vollgas, die ganze Zeit
        flagState = opt.flagge || 'yellow';
        const takte = Math.round((opt.sekunden === undefined ? 8 : opt.sekunden)
                                 * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte; i++) {
          spielerZweiSenden();
          if (i % 20 === 0 || i === takte - 1) {
            reihe.push({
              s: +(i * CONTROL_SEND_INTERVAL_MS / 1000).toFixed(2),
              gas: +(physOut2Throttle || 0).toFixed(3),
              anteil: +(Math.abs(physEngine2.state.speedKmh)
                        / physEngine2.config.topSpeedKmh).toFixed(3),
              kmh: +(Math.abs(physEngine2.state.speedKmh) * REAL_SCALE).toFixed(1),
            });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const letzte = reihe.slice(-3);
        return {
          flagge: flagState,
          ziel: Math.max(yellowFactor(), GHOST_READ_MIN),
          zielKmh: +(Math.max(yellowFactor(), GHOST_READ_MIN)
                     * physEngine2.config.topSpeedKmh * REAL_SCALE).toFixed(1),
          reihe,
          // Der Mittelwert der letzten drei Abtastpunkte: dort ist der Regler eingelaufen.
          endAnteil: +(letzte.reduce((a, x) => a + x.anteil, 0) / letzte.length).toFixed(3),
          endKmh: +(letzte.reduce((a, x) => a + x.kmh, 0) / letzte.length).toFixed(1),
          daumen: p2Throttle,
        };
      } finally {
        Date.now = uhrEcht;
        performance.now = perfEcht;
        flagState = merk.flagge;
        trackMode = merk.bahn;
        if (typeof raceFormationLap !== 'undefined') raceFormationLap = merk.formation;
        zweiSpieler = merk.zwei;
        playerCar2 = merk.p2;
        p2Throttle = merk.gas;
        p2Steer = merk.steer;
        physicsEnabled = merk.phys;
        autopilotZuruecksetzen();
        physEngine2.reset();
        tankZweiFuellen(100);
      }
    },

    // ---- SAGT DIE SICHERUNG, WAS IM BROWSER LIEGT? -----------------------------------
    //
    // BESTELLT: "Zeige bei der Sicherung noch an, ob irgendetwas geladen ist, sodass ich es
    // weiss, bevor dann das Auto wieder als generisches weisses 'alpha' verbunden wird."
    //
    // Der Prueflauf setzt einen Bestand in die Ablage, laesst zeichnen, liest die Zeile und
    // legt den Bestand zurueck. DIE ABLAGE WIRD WIRKLICH ANGEFASST, und das ist der Grund
    // fuer das ausfuehrliche finally: eine Messung, die dem Nutzer seine gemerkten Autos
    // wegnimmt, waere schlimmer als keine Messung.
    sicherungLageProbe(o) {
      const opt = o || {};
      const schluessel = 'chc.cars.v1';
      let merk = null, hatte = false;
      try { merk = localStorage.getItem(schluessel); hatte = merk !== null; }
      catch (e) { return { keinSpeicher: true }; }
      try {
        if (opt.autos === null) {
          try { localStorage.removeItem(schluessel); } catch (e) { /* privat */ }
        } else if (opt.autos) {
          try { localStorage.setItem(schluessel, JSON.stringify(opt.autos)); }
          catch (e) { /* privat */ }
        }
        const l = lageZeichnen();
        const el = $('sich-lage');
        return {
          lage: l,
          leer: el ? el.classList.contains('leer') : null,
          text: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
          // Die Farbpunkte: sie kommen aus derselben Tabelle wie carAssign(), damit die
          // Zeile nicht eine andere Farbe zeigt als das Auto nachher hat.
          farbpunkte: el ? el.querySelectorAll('.sich-farbe').length : 0,
          autoNamen: el ? Array.from(el.querySelectorAll('.sich-auto'))
            .map((x) => x.textContent.trim()) : [],
        };
      } finally {
        try {
          if (hatte) localStorage.setItem(schluessel, merk);
          else localStorage.removeItem(schluessel);
        } catch (e) { /* privat */ }
        lageZeichnen();
      }
    },

    // ---- DER SCHIRM VON AUTO 2: blaetterbar, und zeigt er etwas? ---------------------
    //
    // Zwei Dinge, die auseinanderfallen koennen: die REGISTRY (ist der Schirm erreichbar,
    // und nur im Modus?) und die MALFUNKTION (stehen dort Zahlen, und die richtigen?).
    //
    // Der Schirm wird beim Blaettern uebersprungen, solange der Modus aus ist. Die
    // Alternative waere eine Liste gewesen, deren LAENGE sich aendert - und an ihr haengen
    // der Schirmzaehler, die Punkte unter dem Pfeil und zwei Selbsttests.
    schirmZweiProbe() {
      const vorher = { zwei: zweiSpieler, schirm: cockpitScreenIst().id,
                       p2: playerCar2, tank: tankZweiStand(), fuel };
      const merkGarage = garage.slice();
      try {
        // ---- Erst die Registry, ohne Modus --------------------------------------
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(false);
        cockpitScreenZu('main');
        const ohne = [];
        for (let i = 0; i < 5; i++) { cockpitScreenStep(1); ohne.push(cockpitScreenIst().id); }
        // ---- Dann mit Modus ------------------------------------------------------
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(true);
        cockpitScreenZu('main');
        const mit = [];
        for (let i = 0; i < 5; i++) { cockpitScreenStep(1); mit.push(cockpitScreenIst().id); }
        // ---- Und die Zahlen -----------------------------------------------------
        const a2 = { device: { id: 'probe-schirm' }, role: 'player2', alias: 'P2',
                     rx: null, testSenke: [], colorId: null, battery: 200,
                     race: { laps: [{ lap: 1, ms: 21500 }, { lap: 2, ms: 20900 }] } };
        garage.push(a2);
        playerCar2 = a2;
        // ZWEI VERSCHIEDENE Tankstaende: nur so faellt auf, wenn eine Spalte das falsche
        // Auto zeigt. Bei gleichen Zahlen saehe der Fehler wie ein Erfolg aus.
        const merkFuel = fuel;
        fuel = 80;
        tankZweiFuellen(40);
        cockpitScreenZu('auto2');
        p2ScreenRender();
        const lies = (id) => { const e = $(id); return e ? e.textContent : null; };
        // Seit v0.6.56 zeigt der Schirm BEIDE Autos - also werden beide Spalten gelesen.
        // Die Gegenprobe steckt darin: Spalte 1 muss den Tank von Auto 1 zeigen und nicht
        // den von Auto 2. Eine Spalte, die zweimal dasselbe Auto zeigt, sieht auf den
        // ersten Blick richtig aus.
        const werte = {
          tempo1: lies('vgl1-speed'), tempo2: lies('vgl2-speed'),
          gang1: lies('vgl1-gear'), gang2: lies('vgl2-gear'),
          name1: lies('vgl1-name'), name2: lies('vgl2-name'),
          tank1: lies('vgl1-fuel'), tank: lies('vgl2-fuel'),
          zustand1: lies('vgl1-cond'), zustand: lies('vgl2-cond'),
          reifen: lies('vgl2-tyre'), bremse: lies('vgl2-brake'),
          akku1: lies('vgl1-batt'), akku2: lies('vgl2-batt'),
          lampen1: ($('vgl1-shift') || { children: [] }).children.length,
          lampen2: ($('vgl2-shift') || { children: [] }).children.length,
          lage: lies('p2s-kopf-lage'), runden: lies('p2s-kopf-runde'),
          fuss: lies('p2s-fuss'),
        };
        // Und dass der Schirm beim Abschalten verlassen wird.
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(false);
        const nachAus = cockpitScreenIst().id;
        return { liste: COCKPIT_SCREENS.map((x) => x.id), ohne, mit, werte, nachAus };
      } finally {
        const i = garage.indexOf(garage.find((c) => c.device
                                            && c.device.id === 'probe-schirm'));
        if (i >= 0) garage.splice(i, 1);
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
        playerCar2 = vorher.p2;
        tankZweiFuellen(vorher.tank);
        if (typeof vorher.fuel === 'number') fuel = vorher.fuel;
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(vorher.zwei);
        cockpitScreenZu(vorher.schirm);
      }
    },

    // ---- STEHT AUTO 2 IN DER RUNDENUEBERSICHT? ---------------------------------------
    //
    // DIE AUFWANDSSCHAETZUNG WAR HIER FALSCH, und das gehoert aufgeschrieben: die
    // Rundenzaehlung galt als der groesste offene Posten - 27 modulweite Rennzustands-
    // groessen, Sektorlogik, Ergebnistabelle, CSV. Nachgesehen habe ich dann
    // carRaceNotify(): es fuehrt `car.race` mit Rundenliste, Rundenuhr und Sperrflanke
    // fuer JEDES verbundene Auto, "whatever its role", und raceAllCars() liest die ganze
    // Garage. Auto 2 zaehlte seine Runden also schon; die 27 Groessen betreffen das
    // Rennen von Auto 1 (Ampel, Flaggen, Einfuehrungsrunde), nicht die Zaehlung.
    //
    // Geprueft wird deshalb genau das: Auto 2 steht in der Uebersicht, mit seinen Runden
    // UND mit einem Ort - ohne Ort waere seine Position in der ersten Runde die
    // Reihenfolge der Garage, also erfunden.
    rundenZweiProbe() {
      const merkGarage = garage.slice();
      const vorher = { zwei: zweiSpieler, p1: playerCar, p2: playerCar2 };
      try {
        garage.splice(0, garage.length);
        const mk = (rolle, name, runden) => ({
          role: rolle, alias: name, device: { id: 'probe-' + name }, colorId: null,
          tileCode: 0x02, tileCount: 3,
          ghost: { nurOrt: rolle !== 'ghost', tileIndex: 2, tilesTotal: 2.5,
                   tileMs: 500, tileStart: Date.now(), tileRing: [], laps: runden.length },
          race: { laps: runden.map((ms, i) => ({ lap: i + 1, ms, off: 0 })),
                  lapStart: null, pending: null, seen: 0, lastActed: 0, lastCount: null },
        });
        const a1 = mk('player', 'P1', [21000, 20500]);
        const a2 = mk('player2', 'P2', [20800]);
        const g = mk('ghost', 'G', [21500, 21200, 21100]);
        garage.push(a1, a2, g);
        playerCar = a1;
        playerCar2 = a2;
        zweiSpieler = true;
        const alle = raceAllCars();
        const zeile = alle.find((c) => c.name === 'P2');
        return {
          autos: alle.length,
          rollen: alle.map((c) => c.role),
          hatAutoZwei: !!zeile,
          rundenAutoZwei: zeile ? zeile.laps.length : null,
          ortAutoZwei: zeile ? zeile.ort : null,
          ortAutoEins: (alle.find((c) => c.name === 'P1') || {}).ort,
          // Und die Rangliste: wer steht wo? Sortiert wird nach Runden, dann Gesamtzeit.
          // ovDaten() gibt die fertige Rangliste zurueck: Position, Name, Rolle, Luecke.
          reihenfolge: ovDaten().map((x) => x.pos + ':' + x.name + '/' + x.rolle),
        };
      } finally {
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
        zweiSpieler = vorher.zwei;
        playerCar = vorher.p1;
        playerCar2 = vorher.p2;
      }
    },

    // ---- KLINGT DIE ZWEITE MOTORSTIMME, UND AUF DER RICHTIGEN SEITE? -----------------
    //
    // GEMESSEN WIRD AN DEN WEB-AUDIO-KNOTEN, nicht am Ohr. Was sich pruefen laesst, ist,
    // ob die Stimme ueberhaupt existiert, ob ihre Baender Verstaerkung bekommen, ob die
    // Abspielrate mit der Drehzahl geht und wo sie im Stereobild sitzt. Wie es KLINGT,
    // entscheidet der Teppich - das steht so im Commit und nicht als Zusicherung hier.
    //
    // Die Puffer werden geteilt (je Motormodell, nicht je Auto), und genau das wird
    // mitgeprueft: zwei Stimmen, dieselben Puffer, verschiedene Verstaerkungen.
    async stimmeZweiProbe(o) {
      const opt = o || {};
      // Ohne Tonkontext gibt es keine Knoten. Der Browser legt ihn erst nach einer
      // Nutzerhandlung an, ein Prueflauf ohne Klick kommt also hier heraus - und das
      // ist ein SKIP und kein Fehler. Gesagt wird, WAS fehlt: sonst sucht man am
      // falschen Ende.
      if (!audioCtx || !sampleEngine.ready) {
        return { keinKontext: true, kontext: !!audioCtx,
                 zustand: audioCtx ? audioCtx.state : null,
                 schleifen: !!sampleEngine.ready, laedt: !!sampleEngine.loading,
                 motoren: Object.keys(sampleEngine.buffers || {}).length };
      }
      // ---- WARTEN IST HIER PFLICHT, und das war beim ersten Anlauf der Fehler ---------
      //
      // Alle Verstellungen im Tonzweig laufen ueber setTargetAtTime(), also ueber eine
      // RAMPE mit Zeitkonstante. `AudioParam.value` gleich danach gelesen ist noch der
      // ALTE Wert - gemessen kamen vier Abspielraten von genau 1 und vier Verstaerkungen
      // von genau 0 heraus, und das sah nach einer stummen Stimme aus, obwohl nur die
      // Rampe noch nicht gelaufen war.
      //
      // Gewartet wird auf der UHR DES TONKONTEXTS und nicht auf setTimeout: der
      // Vorschaubereich kann verborgen sein, und dort drosselt der Browser Zeitgeber auf
      // einen Takt je Sekunde. Die Audiouhr laeuft weiter, sie haengt an der Soundkarte.
      const warte = async (sek) => {
        const bis = audioCtx.currentTime + sek;
        while (audioCtx.currentTime < bis) {
          await new Promise((r) => {
            const c = new MessageChannel();
            c.port1.onmessage = r;
            c.port2.postMessage(0);
          });
        }
      };
      const vorher = { zwei: zweiSpieler, gas: p2Throttle, phys: physicsEnabled };
      try {
        zweiSpieler = true;
        if (typeof stimmeZweiSetzen === 'function') stimmeZweiSetzen(true);
        if (!stimmeZwei.nodes) return { keineStimme: true };
        const z0 = stimmeZweiLage(), e0 = stimmeEinsLage();
        const aufbau = {
          zweiBaender: z0.baender, einsBaender: e0.baender,
          zweiSeite: z0.seite, einsSeite: e0.seite,
          // Dieselben Puffer, nicht zwei Kopien: sie liegen je MOTORMODELL.
          gleichePuffer: z0.puffer === e0.puffer && z0.puffer !== null,
          modell: z0.modell,
        };
        // Zwei Drehzahlen, je mit Wartezeit. Die Abspielraten muessen sich unterscheiden -
        // eine Stimme, deren Rate mit der Drehzahl nicht geht, spielt eine Schleife und
        // keinen Motor.
        const bei = async (rpm) => {
          updateSampleEngineIn(stimmeZwei, rpm, 0.8, false, physEngine2, 1);
          await warte(0.35);
          const z = stimmeZweiLage();
          return { raten: z.raten, verst: z.verst, master: z.master,
                   summe: +z.verst.reduce((a, b) => a + b, 0).toFixed(3) };
        };
        const tief = await bei(opt.tief === undefined ? 2200 : opt.tief);
        const hoch = await bei(opt.hoch === undefined ? 7000 : opt.hoch);
        // Und still: bei `silent` muss der Meister zurueck auf null.
        updateSampleEngineIn(stimmeZwei, 2200, 0, true, physEngine2, 1);
        await warte(0.4);
        const still = stimmeZweiLage().master;
        return Object.assign(aufbau, { tief, hoch, still });
      } finally {
        zweiSpieler = vorher.zwei;
        p2Throttle = vorher.gas;
        physicsEnabled = vorher.phys;
        if (typeof stimmeZweiSetzen === 'function') stimmeZweiSetzen(vorher.zwei);
      }
    },

    // ---- VERBRAUCHT AUTO 2, UND WAS KOSTET IHN DER LEERE TANK? ----------------------
    //
    // Drei Fragen in einem Lauf, und die dritte ist die, an der man sich vertut:
    //
    //   1. Sinkt der Stand nach Gas und Zeit, mit DEMSELBEN Regler wie bei Auto 1?
    //   2. Traegt das Tankgewicht in seiner Fahrphysik (st.fuelLoad -> massFactor)?
    //   3. Nimmt ein leerer Tank das Gas ueber die RAMPE weg und nicht in einem Takt?
    //      Der Sprung von 1,0 auf 0,15 war bei Auto 1 als "abrupt abbremsen" gemeldet,
    //      und eine zweite Rampe, die es nicht tut, waere derselbe Fehler noch einmal.
    //
    // Und die Gegenprobe: der Tank von Auto 1 darf nicht mitsinken.
    tankZweiProbe(o) {
      const opt = o || {};
      const sekunden = opt.sekunden === undefined ? 4 : opt.sekunden;
      const start = opt.start === undefined ? 100 : opt.start;
      const uhrEcht = Date.now;
      const perfEcht = performance.now;
      const vorher = { zwei: zweiSpieler, p2: playerCar2, gas: p2Throttle,
                       steer: p2Steer, phys: physicsEnabled, fuel1: fuel,
                       tank2: tankZweiStand() };
      const a2 = { device: { id: 'probe-tank' }, role: 'player2', rx: null,
                   testSenke: [], alias: 'P2' };
      const reihe = [];
      try {
        let t = 1000000;
        Date.now = () => t;
        performance.now = () => t;
        zweiSpieler = true;
        physicsEnabled = true;
        playerCar2 = a2;
        p2Steer = 0;
        p2Throttle = 1;
        fuel = 100;
        physEngine2.reset();
        physEngine2Abgleichen();
        tankZweiFuellen(start);
        // DEN VERBRAUCHSTAKT VERGESSEN, sonst rechnet der erste Takt ein dt zwischen der
        // echten Uhr (oder der gefaelschten des vorigen Laufs) und dieser hier. Genau daran
        // ist dieser Prueflauf beim ersten Mal gescheitert: der Tank ging von 1,5 auf 5,5
        // Prozent nach oben. Der Befund war echt und steckte im Verbrauch, nicht in der
        // Sonde - siehe die Klemme bei dt in fuelTankTick().
        tankZweiTaktVergessen();
        phys2TaktVergessen();
        const takte = Math.round(sekunden * 1000 / CONTROL_SEND_INTERVAL_MS);
        for (let i = 0; i < takte; i++) {
          spielerZweiSenden();
          if (i % 10 === 0 || i === takte - 1) {
            reihe.push({
              s: +(i * CONTROL_SEND_INTERVAL_MS / 1000).toFixed(2),
              tank: +tankZweiStand().toFixed(2),
              last: +(physEngine2.state.fuelLoad || 0).toFixed(3),
              masse: +(physEngine2.state.massFactor || 0).toFixed(4),
              gas: +(physOut2Throttle || 0).toFixed(3),
              kmh: +(Math.abs(physEngine2.state.speedKmh) * REAL_SCALE).toFixed(1),
            });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        return {
          takte, verbrauchRegler: fuelDrainPerSec,
          reihe,
          tankAnfang: start, tankEnde: +tankZweiStand().toFixed(2),
          tankAutoEins: fuel,
          // Der Deckel, wie er gerade steht. Bei leerem Tank laeuft er auf FUEL_CUT_EMPTY
          // zu, und die Rampe ist daran zu erkennen, dass er unterwegs ZWISCHEN den beiden
          // Werten liegt.
          cutJetzt: +tankZweiCutRampe(0).toFixed(4),
          cutLeer: FUEL_CUT_EMPTY,
        };
      } finally {
        Date.now = uhrEcht;
        performance.now = perfEcht;
        zweiSpieler = vorher.zwei;
        playerCar2 = vorher.p2;
        p2Throttle = vorher.gas;
        p2Steer = vorher.steer;
        physicsEnabled = vorher.phys;
        fuel = vorher.fuel1;
        tankZweiFuellen(vorher.tank2);
        physEngine2.reset();
      }
    },

    // ---- NIMMT AUTO 2 SCHADEN, UND TRIFFT ER NUR IHN? --------------------------------
    //
    // DER GANZE WEG, nicht die Funktion. Das ist in diesem Projekt einmal teuer geworden:
    // detectCrash() war definiert, hatte eine Schwelle, hatte einen Schalter - und wurde
    // nie aufgerufen. Ein Prueflauf, der die Funktion ruft, haette gruen gemeldet.
    //
    // Gemessen wird deshalb ab den BYTES: sie gehen durch denselben Meldestrom, durch den
    // ein echtes Auto meldet, und heraus kommt der Schadensstand.
    //
    // Und die zweite Haelfte ist die wichtigere: der Schaden von Auto 2 darf den von
    // Auto 1 NICHT beruehren, und umgekehrt. Drei Zahlen dazu - Schadensstand, und je eine
    // Lampenmaske aus einem wirklich gebauten Paket.
    schadenZweiProbe(o) {
      const opt = o || {};
      const merkGarage = garage.slice();
      const vorher = { zwei: zweiSpieler, p1: playerCar, p2: playerCar2,
                       dmg: damage, an: crashDetectionEnabled,
                       schwelle: crashThreshold };
      const L1 = crashLageVon(1), L2 = crashLageVon(2);
      const merkL = { a: { ...L1 }, b: { ...L2 } };
      const merkZwei = this.schadenZweiLesen();
      const echtNow = Date.now;
      let uhr = 2000000;
      try {
        Date.now = () => uhr;
        crashDetectionEnabled = true;
        damage = 0;
        this.schadenZweiSetzen(0, false, false);
        for (const L of [L1, L2]) { L.avg1 = null; L.avg3 = null; L.letzter = 0; L.gnadeBis = 0; }
        garage.splice(0, garage.length);
        const auto2 = { device: { id: 'probe-schaden2' }, role: 'player2', rx: null,
                        tileCode: 0x02, tileCount: 0, lastCodeAt: 0, yaw: 0, ghost: null,
                        testSenke: [], alias: 'P2' };
        const ghost = { device: { id: 'probe-ghost' }, role: 'ghost', rx: null,
                        tileCode: 0x02, tileCount: 0, lastCodeAt: 0, yaw: 0,
                        ghost: { tilesTotal: 0, tileIndex: 0 }, testSenke: [], alias: 'G' };
        garage.push(auto2, ghost);
        playerCar = null;
        playerCar2 = auto2;
        zweiSpieler = true;

        // Ein ruhiger Strom setzt das gleitende Mittel, dann ein Stoss. Genau wie beim
        // Test fuer Auto 1: erst Ruhe, dann die Abweichung, sonst gibt es kein Mittel,
        // von dem etwas abweichen koennte.
        // ueber feedNotify(), also durch onCarNotify() - genau den Weg, den ein echtes
        // Auto nimmt. Ein Prueflauf, der detectCrash() direkt ruft, haette den toten
        // Aufruf von damals nicht gesehen.
        const stoss = (v1, v3) => {
          const b = new Uint8Array(19);
          b[1] = v1 & 0xff; b[3] = v3 & 0xff; b[11] = 0; b[12] = 0x02;
          this.feedNotify(b, { car: auto2 });
        };
        const wieOft = opt.stoesse === undefined ? 1 : opt.stoesse;
        for (let i = 0; i < 12; i++) { uhr += 45; stoss(0, 0); }
        for (let k = 0; k < wieOft; k++) {
          uhr += 2000;   // ueber die Sperrzeit hinaus
          stoss(120, 120);
          uhr += 45;
          stoss(0, 0);
        }
        const nachStoss = this.schadenZweiLesen();

        // Die Lampenmaske, aus wirklich gebauten Paketen. Auto 2 auf Totalschaden setzen
        // und dann fragen: welches Bit geht bei wem hinaus?
        this.schadenZweiSetzen(100, true, true);
        const maske = (car) => {
          car.testSenke.length = 0;
          // Ueber lichtSchadenVon(), also genau den Weg, den writeToCar() nimmt.
          const pkt = buildCommandPacket(0, 0, LIGHT_HEAD | LIGHT_BRAKE, null,
                                         lichtSchadenVon(car));
          return { kopf: !!(pkt[14] & LIGHT_HEAD), brems: !!(pkt[14] & LIGHT_BRAKE) };
        };
        // lampFlicker() hat einen Zeitanteil: ueberwiegend dunkel mit kurzen Zuckungen.
        // Ueber mehrere Zeitpunkte gemessen, sonst faengt man zufaellig einen Zucker.
        const ueberZeit = (car) => {
          let hell = 0;
          for (let i = 0; i < 40; i++) { uhr += 70; if (maske(car).kopf) hell++; }
          return hell;
        };
        const hellAuto2 = ueberZeit(auto2);
        const hellGhost = ueberZeit(ghost);

        return {
          schadenNachStoss: +nachStoss.wert.toFixed(2),
          schrittSoll: +(100 / crashesToTotal).toFixed(2),
          lichtAuto2: nachStoss.licht,
          schadenAutoEins: damage,
          // Von 40 Zeitpunkten: wie oft war der Scheinwerfer AN? Bei Totalschaden muss das
          // selten sein, beim Ghost immer.
          hellAuto2, hellGhost, zeitpunkte: 40,
        };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
        zweiSpieler = vorher.zwei;
        playerCar = vorher.p1;
        playerCar2 = vorher.p2;
        damage = vorher.dmg;
        crashDetectionEnabled = vorher.an;
        crashThreshold = vorher.schwelle;
        Object.assign(L1, merkL.a);
        Object.assign(L2, merkL.b);
        this.schadenZweiSetzen(merkZwei.wert, merkZwei.licht.front, merkZwei.licht.rear);
      }
    },

    // ---- SEHEN DIE GHOSTS AUTO 2? ---------------------------------------------------
    //
    // Die Frage laesst sich nicht aus der Zuteilung ableiten, und sie hat genau eine
    // richtige Antwort: Auto 2 muss im FELD stehen. Daran haengt alles Weitere - ghostAhead
    // findet den Vorausfahrenden nur dort, der Abstandhalter zaehlt nur das Feld, und die
    // Seitenwahl beim Ueberholen fragt die Querlage eines Autos, das im Feld steht.
    //
    // Gemessen wird deshalb an ghostFieldRacing() UND an ghostAhead(): das zweite ist der
    // Weg, den ein Ghost wirklich nimmt. Ein Test, der nur die Liste prueft, haette den
    // Fehler "im Feld, aber ohne Ortungssatz" nicht gesehen.
    //
    // Und die Gegenprobe gehoert dazu: mit abgeschaltetem Modus darf Auto 2 NICHT im Feld
    // stehen. Sonst wichen die Ghosts im Einzelspiel einem Auto aus, das niemand fuehrt.
    zweiSpielerFeldProbe() {
      const merkGarage = garage.slice();
      const vorher = { zwei: zweiSpieler, p2: playerCar2, p1: playerCar };
      const echtNow = Date.now;
      let uhr = 1000000;
      try {
        Date.now = () => uhr;
        garage.splice(0, garage.length);
        // Ein Ghost hinten, Auto 2 eine halbe Kachel voraus. Der Ortungssatz von Auto 2 ist
        // der, den spielerOrt() anlegt - `nurOrt`, ohne Motor.
        const ghost = { role: 'ghost', alias: 'G', tileAt: uhr, tileCode: 0x02,
                        ghost: { tilesTotal: 0, tileIndex: 0, tileMs: 500, tileStart: uhr,
                                 tileRing: [], form: 0, naehern: 0 } };
        const auto2 = { role: 'player2', alias: 'P2', tileAt: uhr, tileCode: 0x02,
                        device: { id: 'probe-feld' },
                        ghost: { nurOrt: true, tilesTotal: 0.5, tileIndex: 0, tileMs: 500,
                                 tileStart: uhr, tileRing: [], querSoll: 0.4 } };
        garage.push(ghost, auto2);
        playerCar = null;      // damit nur Auto 2 im Feld stehen kann
        playerCar2 = auto2;

        zweiSpieler = false;
        const ausFeld = ghostFieldRacing().length;
        const ausVoraus = ghostAhead(ghost);

        zweiSpieler = true;
        const anFeld = ghostFieldRacing();
        const anVoraus = ghostAhead(ghost);

        return {
          ausFeld, ausVoraus: ausVoraus ? (ausVoraus.car.alias || '?') : null,
          anFeld: anFeld.length,
          anEnthaeltAuto2: anFeld.indexOf(auto2) >= 0,
          anVoraus: anVoraus ? (anVoraus.car.alias || '?') : null,
          anAbstand: anVoraus ? +anVoraus.gap.toFixed(3) : null,
          // Die Querlage ist die Zahl, aus der der Angreifer seine Seite waehlt. Ueber
          // ghostQuerLage() gelesen, also genau so, wie der Angreifer es tut.
          querLage: typeof ghostQuerLage === 'function' ? ghostQuerLage(auto2) : null,
        };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
        zweiSpieler = vorher.zwei;
        playerCar2 = vorher.p2;
        playerCar = vorher.p1;
      }
    },

    // ---- Wohin geht der Vibrationsstoss? --------------------------------------------
    //
    // Ohne Hardware ist die WAHL pruefbar, die Ausfuehrung nicht - und die Wahl war der
    // Fehler. rumblePad() gibt dreiwertig zurueck: null heisst "alle Pads" (ein Spieler,
    // Verhalten wie vor v0.6.45), ein Pad heisst genau dieser, undefined heisst niemand.
    rumbleZielProbe() {
      const vorher = zweiSpieler;
      try {
        zweiSpieler = false;
        const aus = [rumblePad(1), rumblePad(2)].map(nenn);
        zweiSpieler = true;
        const an = [rumblePad(1), rumblePad(2)].map(nenn);
        return { aus, an, pads: padsSortiert().length };
      } finally { zweiSpieler = vorher; }
      function nenn(z) {
        return z === null ? 'alle' : z === undefined ? 'niemand'
             : String(z.id || 'pad').slice(0, 24);
      }
    },

    // ---- Die Rollenknoepfe in der Garage --------------------------------------------
    //
    // WARUM DAS EINE SONDE BRAUCHT. Die Garagenzeile wird von renderGarage() aus einem
    // Textbaustein erzeugt, und ihre Knoepfe existieren nur, wenn ein Auto verbunden ist.
    // Genau deshalb ist der gemeldete Fehler durch alle 220 Selbsttests gekommen: der
    // vierte Knopf fehlte, und kein Test hatte je eine Garagenzeile gesehen.
    //
    // Die Sonde stellt ein Auto in die Garage, laesst zeichnen, liest die Knoepfe und
    // raeumt auf. Eine Attrappe genuegt: renderGarage() liest von einem Auto nur tag,
    // device.id, role, alias, colorId und ghostSpeed.
    garagenZeileProbe(o) {
      const opt = o || {};
      const vorherZwei = zweiSpieler;
      const attrappe = { role: opt.role || 'none', device: { id: 'probe-garage' },
                         alias: '', colorId: null, sim: false };
      garage.push(attrappe);
      try {
        if (opt.zwei !== undefined) zweiSpieler = !!opt.zwei;
        renderGarage();
        const zeilen = Array.from(($('gar-list') || { children: [] }).children);
        const meine = zeilen[zeilen.length - 1];
        const knoepfe = meine
          ? Array.from(meine.querySelectorAll('button[data-role]')).map((b) => ({
              rolle: b.dataset.role,
              text: b.textContent.replace(/\s+/g, ' ').trim(),
              an: b.classList.contains('on'),
            }))
          : [];
        return { zeilen: zeilen.length, knoepfe,
                 rollen: knoepfe.map((k) => k.rolle),
                 randklasse: meine ? meine.className : null };
      } finally {
        const i = garage.indexOf(attrappe);
        if (i >= 0) garage.splice(i, 1);
        zweiSpieler = vorherZwei;
        renderGarage();
      }
    },

    // Und der Weg, den der gemeldete Fehler genommen haette: Knopf druecken, obwohl der
    // Modus aus ist. Danach muss der Modus an sein UND das Auto zugeteilt.
    garagenRolleProbe() {
      const vorher = { zwei: zweiSpieler, p2: playerCar2,
                       kaestchen: ($('opt-zwei-an') || {}).checked };
      const attrappe = { role: 'none', device: { id: 'probe-rolle' },
                         alias: '', colorId: null, sim: false, testSenke: [] };
      garage.push(attrappe);
      try {
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(false);
        const vorZwei = zweiSpieler;
        setCarRole(attrappe, 'player2');
        return {
          vorherAus: vorZwei === false,
          danachAn: zweiSpieler === true,
          rolle: attrappe.role,
          istAuto2: playerCar2 === attrappe,
          kaestchenAn: !!($('opt-zwei-an') || {}).checked,
        };
      } finally {
        if (playerCar2 === attrappe) playerCar2 = null;
        const i = garage.indexOf(attrappe);
        if (i >= 0) garage.splice(i, 1);
        if (typeof zweiSpielerSetzen === 'function') zweiSpielerSetzen(vorher.zwei);
        playerCar2 = vorher.p2;
        const k = $('opt-zwei-an');
        if (k) k.checked = !!vorher.kaestchen;
        renderGarage();
      }
    },

    // ---- Der Zwei-Spieler-Modus, am Sendeweg gemessen -------------------------------
    //
    // GEMESSEN WIRD, WAS HINAUSGEHT, und nicht, was eine Funktion sich vornimmt. Genau
    // dieser Unterschied hat beim Zieleinlauf einen Fehler verdeckt: die Seite war
    // zugeteilt und landete im Gas-Platz. car.testSenke ist deshalb schon da; hier wird
    // sie fuer zwei Autos gleichzeitig benutzt.
    //
    // Der Prueflauf stellt sich seine eigene Lage her - zwei Attrappen, kein Funk - und
    // gibt im finally jeden angefassten Zustand zurueck. Ohne das bliebe der Modus nach
    // einem Selbsttest an, und das naechste Rennen haette ein zweites Auto, das niemand
    // bestellt hat.
    zweiSpielerProbe(o) {
      const opt = o || {};
      const vorher = {
        zwei: zweiSpieler, p1: playerCar, p2: playerCar2,
        phys: physicsEnabled, steer: p2Steer, gas: p2Throttle,
      };
      const mach = (tag) => ({
        tag, role: 'none', device: { id: 'probe-' + tag }, testSenke: [],
        ghost: null, modeBytes: null,
      });
      const a1 = mach('P1'), a2 = mach('P2');
      try {
        playerCar = a1;
        playerCar2 = a2;
        // OHNE PHYSIK, absichtlich: mit ihr haengt das Gas an einer Motordrehzahl, die
        // sich zwischen zwei Aufrufen aendert, und der Prueflauf wuerde messen, wie schnell
        // ein Motor anspringt. Ohne sie geht p2Throttle unveraendert hinaus, und das ist
        // die Frage - kommt die Zahl beim richtigen Auto an?
        physicsEnabled = false;
        p2Steer = opt.steer === undefined ? 0.4 : opt.steer;
        p2Throttle = opt.gas === undefined ? 0.7 : opt.gas;
        // Erst AUS: es darf nichts hinausgehen.
        zweiSpieler = false;
        spielerZweiSenden();
        const ausPakete = a2.testSenke.length;
        // Dann AN.
        zweiSpieler = true;
        spielerZweiSenden();
        const anPakete = a2.testSenke.slice(ausPakete);
        // Und ohne zugeteiltes Auto 2: auch dann nichts. anAutoEins ist dabei die zweite
        // Zusicherung und die wichtigere - dieser Weg darf Auto 1 NIE anfassen. Taete er
        // es, bekaeme Auto 1 im selben Takt zwei Pakete mit verschiedenem Gas, und genau
        // das ist das Stottern, das der eine Herzschlag beseitigt hat.
        playerCar2 = null;
        spielerZweiSenden();
        return {
          ausPakete,
          anPakete: anPakete.length,
          ohneAuto: a2.testSenke.length - ausPakete - anPakete.length,
          letztes: anPakete.length ? anPakete[anPakete.length - 1] : null,
          anAutoEins: a1.testSenke.length,
          gewuenscht: { steer: p2Steer, gas: p2Throttle },
          // Die zwei globalen Faktoren, die im Sendeweg liegen - der Test rechnet damit
          // die Zusage nach, statt eine Zahl abzuschreiben.
          topSpeedScale, battScale: batteryCompensationScale(),
        };
      } finally {
        zweiSpieler = vorher.zwei;
        playerCar = vorher.p1;
        playerCar2 = vorher.p2;
        physicsEnabled = vorher.phys;
        p2Steer = vorher.steer;
        p2Throttle = vorher.gas;
      }
    },

    // ---- Und faehrt Auto 2 wirklich? ------------------------------------------------
    //
    // Die Sonde darueber prueft den WEG. Diese prueft die FAHRT: dass eine eigene
    // Physikinstanz Gas annimmt, dreht, schaltet und dass die zweite Anzeige im Cockpit
    // dabei mitgeht. Das ist die Aussage, die bestellt war ("beide fahren koennen"), und
    // sie laesst sich nicht aus der Zuteilung ableiten.
    //
    // DIE UHR WIRD GEFAELSCHT, und zwar performance.now(): physicsStep2() holt sein dt
    // daraus, und zwei Aufrufe in derselben Millisekunde haetten dt = 0 - gemessen waere
    // dann ein Motor, der nicht anspringt, obwohl er es tut. Dieselbe Bauform wie bei den
    // Ghost-Sonden, die Date.now faelschen, und mit derselben Pflicht: im finally zurueck.
    //
    // Der Prueflauf laeuft SYNCHRON durch. Das ist kein Zufall: der echte Herzschlag feuert
    // alle 45 ms und wuerde die gefaelschte Uhr sehen. Ohne ein einziges await kann er
    // nicht dazwischenkommen.
    zweiSpielerFahrtProbe(o) {
      const opt = o || {};
      const schritte = opt.schritte || 60;      // 60 x 45 ms = 2,7 s
      const uhrEcht = performance.now;
      const vorher = {
        zwei: zweiSpieler, p2: playerCar2, steer: p2Steer, gas: p2Throttle,
        phys: physicsEnabled,
      };
      const a2 = { tag: 'P2', role: 'player2', device: { id: 'probe-fahrt' }, testSenke: [] };
      const verlauf = [];
      try {
        physEngine2.reset();
        physEngine2Abgleichen();
        zweiSpieler = true;
        physicsEnabled = true;
        playerCar2 = a2;
        p2Steer = 0;
        p2Throttle = opt.gas === undefined ? 1 : opt.gas;
        let t = uhrEcht.call(performance);
        performance.now = () => t;
        // Der erste Schritt setzt nur phys2LastTime; ab dem zweiten ist dt echt.
        for (let i = 0; i < schritte; i++) {
          spielerZweiSenden();
          if (i % 10 === 0 || i === schritte - 1) {
            verlauf.push({
              s: +(i * 0.045).toFixed(2),
              rpm: Math.round(motorDrehzahl(physEngine2.state)),
              kmh: +(Math.abs(physEngine2.state.speedKmh) * REAL_SCALE).toFixed(1),
              gang: gearLabel(physEngine2.state),
            });
          }
          t += CONTROL_SEND_INTERVAL_MS;
        }
        const letzt = verlauf[verlauf.length - 1];
        return {
          schritte, pakete: a2.testSenke.length, verlauf,
          // Und die Gegenprobe, dass Auto 1 unberuehrt blieb: seine Physik darf von
          // diesem Weg nichts gesehen haben.
          eigenerMotor: physEngine2.state !== physEngine.state,
          eigeneGaenge: physEngine2.config.gears !== physEngine.config.gears,
          endeRpm: letzt.rpm, endeKmh: letzt.kmh, endeGang: letzt.gang,
          letztesPaket: a2.testSenke[a2.testSenke.length - 1] || null,
        };
      } finally {
        performance.now = uhrEcht;
        zweiSpieler = vorher.zwei;
        playerCar2 = vorher.p2;
        p2Steer = vorher.steer;
        p2Throttle = vorher.gas;
        physicsEnabled = vorher.phys;
        physEngine2.reset();
      }
    },

    cockpitPassung(h, b) { return cockpitPassung(h, b); },

    // ---- Die Cockpit-Schirme, von aussen bedienbar ----------------------------------
    //
    // Gebraucht fuer die Zusicherung, auf der die ganze Bauform steht: ein Schirmwechsel
    // darf grid-template-rows NICHT aendern, sonst muesste cockpitPassung() bei jedem
    // Tastendruck neu messen - und beide Schirme haetten verschiedene Faktoren, das Cockpit
    // wuerde also beim Blaettern seine Groesse aendern.
    schirmListe() { return COCKPIT_SCREENS.map((s) => s.id); },
    // Und welche davon gerade BLAETTERBAR sind. Seit es den Schirm von Auto 2 gibt, sind
    // das nicht mehr zwangslaeufig alle: er wird uebersprungen, solange der
    // Zwei-Spieler-Modus aus ist. Ein Prueflauf, der den Umlauf mit der Gesamtzahl
    // nachrechnet, landet dann einen Schirm daneben - genau das ist passiert.
    schirmListeBlaetterbar() {
      return COCKPIT_SCREENS.filter((s) => cockpitScreenGilt(s)).map((s) => s.id);
    },
    schirmIst() { return cockpitScreenIst().id; },
    schirmStep(d) { cockpitScreenStep(d); return cockpitScreenIst().id; },
    schirmZu(id) { cockpitScreenZu(id); return cockpitScreenIst().id; },
    // Und der Weg, den das Steuerkreuz wirklich nimmt - nicht nur die Registry.
    schirmPad(dir) { return pitScreenPad(dir); },
    // ---- HAT SPIELER 2 DIESELBEN KNOEPFE WIE SPIELER 1? -----------------------------
    //
    // BESTELLT: "Spieler 2 soll auch funktionierende Knoepfe haben fuer: Licht,
    // Boxenstopp, Lichthupe (Belegung auf Gamepad wie Spieler 1)."
    //
    // Ein Pad mit genau den drei Standard-Knoepfen gedrueckt (Index 3/9/11, siehe
    // BINDING_DEFAULTS), einmal durch pollPad2() geschickt - derselbe Weg, den ein echter
    // Controller nimmt. Geprueft wird die WIRKUNG: headlightsOn kippt, boxZweiLage()
    // wechselt aus 'aus', und die Lichthupe von Auto 2 sperrt sich selbst gegen einen
    // zweiten Aufruf, solange sie noch blitzt.
    p2KnopfProbe() {
      const merk = { head: headlightsOn, zwei: zweiSpieler, p2: playerCar2 };
      const a2 = { device: { id: 'probe-p2knopf' }, role: 'player2', rx: null, testSenke: [] };
      try {
        zweiSpieler = true;
        playerCar2 = a2;
        const knopf = (i) => ({ pressed: true, value: 1 });
        const los = () => ({ pressed: false, value: 0 });
        const pad = { axes: [0, 0, 0, 0], buttons: Array(20).fill(0).map(() => los()) };
        pad.buttons[3] = knopf();   // headlights
        pad.buttons[9] = knopf();   // pitstop
        pad.buttons[11] = knopf();  // lightflash
        const vorLage = (typeof boxZweiLage === 'function') ? boxZweiLage() : null;
        pollPad2(pad);
        return {
          lichtKippte: headlightsOn !== merk.head,
          // Ein zweiter Aufruf, solange die erste Lichthupe noch blitzt, darf
          // flash2Until NICHT verlaengern - sonst haette man eine Dauerlichthupe statt
          // drei Impulsen. flash2Until steht in 70-race.js, einer FRUEHEREN Datei, ist
          // also zur Laufzeit direkt lesbar.
          lichthupeSperrt: (() => {
            const vorher = flash2Until;
            triggerHeadlightFlash2();
            return flash2Until === vorher;
          })(),
          boxLageVorher: vorLage,
          boxLageNachher: (typeof boxZweiLage === 'function') ? boxZweiLage() : null,
        };
      } finally {
        headlightsOn = merk.head;
        const cb = $('dash-head-toggle');
        if (cb) cb.checked = merk.head;
        zweiSpieler = merk.zwei;
        playerCar2 = merk.p2;
        if (typeof boxZweiAnfordern === 'function' && boxZweiLage() !== 'aus') {
          boxZweiAnfordern();
        }
      }
    },
    // UEBER DEN VERTEILER und nicht direkt auf pitScreenSelect(): gefragt ist, was die
    // Taste auf dem GERADE offenen Schirm tut, und genau diese Entscheidung war der Ort
    // des gemeldeten Fehlers. Ein Zugang, der sie ueberspringt, prueft die falsche Sache.
    schirmWaehlen() { return cockpitScreenWaehlen(); },
    // Die Waehltaste selbst, so wie pollGamepad sie sieht: true heisst gedrueckt. Damit
    // laesst sich eine FOLGE fahren - druecken, loslassen, blaettern, wieder druecken -,
    // und nur in einer Folge war der Fehler zu sehen.
    flagTaste(gedrueckt) { flagTasteTick(!!gedrueckt); },
    flagLage() { return { haelt: flagHoldStart !== null, gesperrt: padFlagFired,
                          stand: flagState }; },
    schirmAuswahl() { return pitScreenSel; },
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
                        daempfungMs: c.steerDaempfungMs,
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
    // ---- WIE LANGE BRAUCHT DIE LENKUNG VON NULL BIS ZUM ANSCHLAG ------------------
    //
    // Die Groesse, die der Regler "Lenkdaempfung" verspricht - also die, die nachgemessen
    // werden muss. Gefahren wird bei stehendem Auto und im ersten Gang, damit weder der
    // Reibkreis noch die Tempoabhaengigkeit den Anschlag beschneidet: gemessen wird die
    // Zeit des SERVOS und nicht die des Grips.
    //
    // Gezaehlt wird bis zu 99 Prozent des erreichbaren Endwerts und nicht bis 100: eine
    // Ratenbegrenzung trifft ihr Ziel exakt, aber der Endwert selbst haengt an Kalibrierung
    // und Reibkreis, und ein Vergleich gegen 1,0 wuerde die falsche Groesse pruefen.
    steerZeitProbe(o) {
      const opt = o || {};
      const e = physEngine, st = e.state, cfg = e.config;
      const merkState = OMEGA_TEST.zustandKopie(st);
      const merk = { ms: cfg.steerDaempfungMs, resp: cfg.steerResponse };
      try {
        if (opt.ms !== undefined) cfg.steerDaempfungMs = opt.ms;
        if (opt.resp !== undefined) cfg.steerResponse = opt.resp;
        const dt = 0.005;
        st.speedKmh = 0; st.driveMode = 'forward'; st.currentGear = 0;
        st.dampedSteering = 0;
        // Erst den Endwert finden: lange genug fahren, dass die Rampe fertig ist.
        let ende = 0;
        for (let i = 0; i < 2000; i++) {
          ende = Math.abs(e.update({ throttle: 0, brake: 0, steering: 1 }, dt).servoAngle);
        }
        // Dann von vorn und die Zeit bis 99 Prozent davon nehmen.
        st.dampedSteering = 0;
        let t = 0, ms = null;
        for (let i = 0; i < 2000 && ms === null; i++) {
          const v = Math.abs(e.update({ throttle: 0, brake: 0, steering: 1 }, dt).servoAngle);
          t += dt;
          if (v >= ende * 0.99) ms = Math.round(t * 1000);
        }
        return { ms, ende: +ende.toFixed(4), soll: cfg.steerDaempfungMs };
      } finally {
        cfg.steerDaempfungMs = merk.ms;
        cfg.steerResponse = merk.resp;
        OMEGA_TEST.zustandZurueck(st, merkState);
      }
    },

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
    setLineModel, getLineModel, buildLine, getLineExit, lapTimeOf, fahrGrenzen,
    // Die Sperre selbst herausgegeben: eine Pruefung soll fragen koennen, WANN sie gilt,
    // statt es aus Kachelindizes nachzubauen.
    pitSperreRechts, pitKachel, pitFaelligZiehen,
    // Die Boxenplaetze von aussen lesen und raeumen. Als Funktionen, weil pitPlaetze ein let
    // ist - eine Kopie waere ein zweiter Ort fuer eine Sperre.
    // pitBelegt heisst jetzt "irgendein Platz ist belegt" - mit der Gasse ist das nicht
    // mehr dasselbe wie "es gibt einen Inhaber".
    pitBelegt: () => pitPlaetze.some((c) => !!c), pitInhaberSetzen,
    pitPlaetzeLesen, pitKachelFuer, pitPlaetzeZahl, pitPlatzVon,
    // Der Mindestabstand als Messgroesse - siehe SPICE_GAP_MIN.
    gapMinSetzen, gapMinLesen,
    lueckeMinSetzen, lueckeMinLesen, ghostZeitLuecke,
    attackRangeSetzen, attackRangeLesen,
    // Der Tankverbrauch, damit die Spiegelpruefung ihn vergleichen kann. Als Funktion und
    // nicht als Wert: ein let wird kopiert, eine Funktion liest.
    fuelDrain: () => fuelDrainPerSec,
    setLineExit(v) { setLineExit(v); lineCache = null; return getLineExit(); },
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
    // ---- Der Ortungsabgleich, mit einem VORGETAEUSCHTEN echten Versatz --------------
    //
    // Nachgestellt wird genau die Lage, die die Ortung falsch macht: die App nimmt an, das
    // Auto stehe an Start/Ziel (Index 0), in Wahrheit steht es `versatz` Kacheln weiter. Der
    // gemeldete Code kommt aus der WIRKLICHEN Kachel, der gerechnete Index laeuft von 0 -
    // und der Abgleich muss die Luecke finden.
    ortProbe(code, versatz, schritte) {
      const keep = currentTrackTiles;
      try {
        currentTrackTiles = codeToTrack(code || 'SG2H2G2R2G2H2G2R2').tiles;
        const n = currentTrackTiles.length;
        const v = ((versatz || 0) % n + n) % n;
        // MIT GERAET, denn ortAbgleich() meldet die Korrektur ueber garageLabel() - und das
        // liest den Geraetenamen. Ein nackter Attrappen-Wagen brachte hier einen TypeError:
        // richtig ist, dass der Prueffstand ein glaubwuerdiges Auto stellt, und nicht, dass
        // der Fahrcode sich gegen unmoegliche Autos absichert.
        const car = { tileCode: 0xff, tileAt: Date.now(), tag: 'P',
                      device: { name: 'Ortprobe', id: 'ortprobe' },
                      ghost: { tileIndex: 0, laps: 0, tileMs: 800 } };
        let echt = v;
        let korrigiertNach = null;
        const N = schritte || n * 2;
        for (let s = 0; s < N; s++) {
          car.tileCode = currentTrackTiles[echt].type;
          const vor = car.ghost.tileIndex;
          ortAbgleich(car);
          if (korrigiertNach === null && car.ghost.tileIndex !== vor) korrigiertNach = s + 1;
          echt = (echt + 1) % n;
          car.ghost.tileIndex = (car.ghost.tileIndex + 1) % n;
        }
        return { kacheln: n, versatz: v, korrigiertNach,
                 angewandt: !!car.ghost.ortAngewandt,
                 stimmt: car.ghost.tileIndex === echt,
                 index: car.ghost.tileIndex, echt, runden: car.ghost.laps,
                 stimmen: (car.ghost.ortStimmen || []).slice() };
      } finally { currentTrackTiles = keep; lineCache = null; }
    },

    // Stimmen gemeldete Kachel und Layout an dieser Stelle ueberein?
    ortStimmtProbe(code, index, gemeldet) {
      const keep = currentTrackTiles;
      try {
        currentTrackTiles = codeToTrack(code || 'SG2H2G2R2G2H2G2R2').tiles;
        const car = { tileCode: gemeldet, tag: 'P',
                      device: { name: 'Ortprobe', id: 'ortprobe' },
                      ghost: { tileIndex: index, laps: 0 } };
        return ortStimmt(car);
      } finally { currentTrackTiles = keep; lineCache = null; }
    },

    // ---- Wechselhaftes Wetter, ohne Minuten zu warten ------------------------------
    //
    // Die Frist wird in die Vergangenheit gesetzt und der Takt gerufen. Geprueft wird damit
    // die PHASENFOLGE und die je Phase gezogene Dauer - nicht die Uhr des Rechners, die
    // hier ohnehin nichts beweisen wuerde.
    wxWechselProbe(phasen) {
      const merkStart = raceWxStart, merkWetter = weather, merkAt = wxWechselAt;
      const out = [];
      try {
        raceWxStart = 'wechsel';
        setWeather('dry');
        wxWechselPlanen(false);
        for (let i = 0; i < (phasen || 8); i++) {
          // Die Dauer, die fuer die LAUFENDE Phase gezogen wurde: wxWechselAt wurde bei
          // ihrem Beginn auf jetzt + Dauer gesetzt.
          const nass = weather === 'rain';
          const dauer = wxWechselAt - Date.now();
          wxWechselAt = Date.now() - 1;
          wxWechselTick();
          out.push({ nass, dauerMs: Math.round(dauer), danachNass: weather === 'rain' });
        }
      } finally {
        raceWxStart = merkStart;
        wxWechselAt = merkAt;
        setWeather(merkWetter);
      }
      return out;
    },

    // ---- Die Rennsimulation, ohne Zeitgeber durchgefahren --------------------------
    //
    // simSchritt() rechnet einen Takt, simZeichnen() bleibt aussen vor. Damit laeuft ein
    // ganzes Rennen in Millisekunden durch, und die Pruefung haengt nicht an der Drosselung
    // von Zeitgebern in einem verborgenen Fenster.
    simSchritte(n, msJeSchritt) {
      if (!simAn()) return null;
      // FESTE Schrittweite fuer den Prueflauf: ohne sie nimmt simSchritt die Wandzeit, und
      // dann haengt das Ergebnis daran, wie schnell dieser Rechner die Schleife durchlaeuft.
      const ms = msJeSchritt === undefined ? SIM_TAKT_MS : msJeSchritt;
      for (let i = 0; i < (n || 1); i++) simSchritt(ms);
      return simZustand();
    },
    simZustand() { return simZustand(); },

    // Warum das ueber simZustand() hinaus noetig ist: "die Ghosts haengen am Anfang" ist von
    // aussen ein einziger Zustand, innen aber mindestens vier verschiedene Ursachen - kein
    // Ziel, Ziel aber kein Gas, Gas aber Bremse dagegen, oder geparkt. simZustand() zeigt
    // nur das Ergebnis (kmh 0) und laesst offen, welche davon es ist.
    // ---- KACHELABSTAND GEGEN ZEITLUECKE, nebeneinander ----------------------------
    //
    // Die Sonde, die den Befund festhaelt, auf dem der ganze Abstandhalter beruht: der
    // gemeldete Kachelabstand hat bei nahen Autos genau EINEN Wert, die Zeitluecke hat
    // viele. Sie laeuft die Simulation ein Stueck weit und sammelt beide Groessen fuer die
    // Takte, in denen der WAHRE Abstand unter einer Kachel liegt.
    //
    // Der wahre Abstand ist nur in der Simulation bekannt (a.s) - deshalb ist diese Messung
    // eine Aussage ueber das Modell. Die Zeitluecke selbst braucht ihn nicht: sie steht am
    // Teppich genauso zur Verfuegung, weil beide Autos ihre Kachelwechsel melden.
    simAufloesung(takte) {
      if (!simAn()) return null;
      const kachel = [], luecke = [];
      // Und der WAHRE Abstand daneben, fuer dieselben Abtastungen. Er beantwortet die
      // Frage, die "wieviele verschiedene Werte" offen laesst: FOLGT der gemeldete Abstand
      // dem wirklichen, oder hat er nur viele Werte? Seit die Kachelphase aus dem Weg kommt
      // (ghostTilePhaseWeg) hat er Zwischenwerte - ohne diesen Vergleich waere nicht zu
      // sagen, ob sie etwas bedeuten.
      let abwSumme = 0, abwN = 0;
      const n = takte || 1200;
      for (let k = 0; k < n; k++) {
        // simSchritt() gibt NICHTS zurueck - der erste Anlauf stand hier auf
        // `if (!simSchritt(...)) break;` und brach damit im ersten Durchlauf ab. Der Test
        // meldete "keine nahen Proben im Lauf" und sah aus wie ein Aufbauproblem.
        // Ob die Simulation noch laeuft, sagt simAn().
        simSchritt(SIM_TAKT_MS);
        if (!simAn()) break;
        if (k % 5) continue;                      // jeder fuenfte Takt reicht
        const z = simZustand();
        if (!z) break;
        for (const a of (z.abstand || [])) {
          if (a.wahr === null || a.wahr === undefined || a.wahr >= 1.0) continue;
          if (a.gemeldet !== null) {
            kachel.push(a.gemeldet);
            abwSumme += Math.abs(a.gemeldet - a.wahr);
            abwN++;
          }
          if (a.luecke !== null) luecke.push(a.luecke);
        }
      }
      return { proben: kachel.length,
               kachelWerte: [...new Set(kachel)].sort((x, y) => x - y),
               kachelVerschieden: new Set(kachel).size,
               // Mittlere Abweichung des GEMELDETEN vom WAHREN Abstand, in Kacheln, fuer
               // die nahen Abtastungen.
               kachelAbweichung: abwN ? +(abwSumme / abwN).toFixed(3) : null,
               lueckeVerschieden: new Set(luecke).size,
               lueckeMessbar: luecke.length,
               lueckeMin: luecke.length ? Math.min.apply(null, luecke) : null,
               lueckeMax: luecke.length ? Math.max.apply(null, luecke) : null };
    },

    // ---- EIN STEHENDES AUTO AUF DER STRECKE: WEICHEN DIE ANDEREN AUS? -------------
    //
    // Zwei Attrappen: A steht (car.parked), B kommt eine Kachel dahinter. Gefragt wird, ob
    // hindernisSetzen() B einen Ausweichbefehl WEG von A gibt - und ob die Seite an A's
    // Querlage haengt und nicht fest ist.
    hindernisProbe(opt) {
      const o = opt || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkFlag = flagState;
      const autos = [];
      try {
        currentTrackTiles = codeToTrack('SG2R3G2R3').tiles;
        lineCache = null;
        flagState = 'green';
        const a = OMEGA_TEST.attrappeGhost('A');   // der Steher
        const b = OMEGA_TEST.attrappeGhost('B');   // kommt heran
        garage.push(a); garage.push(b);
        autos.push(a, b);
        a.ghost.tileIndex = 2; a.ghost.tilesTotal = 2; a.ghost.tileMs = 700;
        b.ghost.tileIndex = 1; b.ghost.tilesTotal = 1; b.ghost.tileMs = 700;
        a.ghost.querSoll = o.querLage === undefined ? 0.6 : o.querLage;
        a.parked = 'Prueflauf';
        b.ghost.yieldSide = 0; b.ghost.yieldUntil = 0;
        hindernisSetzen(a);
        const nah = { yieldSide: b.ghost.yieldSide || 0,
                      gilt: !!(b.ghost.yieldUntil && b.ghost.yieldUntil > Date.now()) };
        // Gegenprobe: dasselbe Auto WEIT weg - dann darf nichts gesetzt werden.
        b.ghost.yieldSide = 0; b.ghost.yieldUntil = 0;
        b.ghost.tileIndex = 6; b.ghost.tilesTotal = 6;
        hindernisSetzen(a);
        const weit = { yieldSide: b.ghost.yieldSide || 0,
                       gilt: !!(b.ghost.yieldUntil && b.ghost.yieldUntil > Date.now()) };
        return { nah, weit, stehtBei: o.querLage === undefined ? 0.6 : o.querLage };
      } finally {
        flagState = merkFlag;
        garage.splice(0, garage.length);
        for (const c of autos) { c.parked = null; stopGhost(c); }
        for (const c of merkGarage) garage.push(c);
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ---- KOSTET EIN FEHLER AUCH DIE LINIE? ----------------------------------------
    //
    // Der Verbremser zog bisher nur Tempo ab. Diese Sonde erzwingt einen (Math.random auf
    // 0, eine enge Kachel voraus) und liest, was ghostSpice() zurueckgibt: Tempofaktor UND
    // Querausschlag.
    fehlerProbe() {
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkCfg = Object.assign({}, ghostCfg);
      const echtRandom = Math.random;
      const autos = [];
      try {
        currentTrackTiles = codeToTrack('SG2R3G2R3').tiles;
        lineCache = null;
        Object.assign(ghostCfg, WUERZE_AUS);
        ghostCfg.wuerzeFehler = true;
        Math.random = () => 0;
        const a = OMEGA_TEST.attrappeGhost('F');
        garage.push(a);
        autos.push(a);
        // DIE KACHEL DAVOR SUCHEN, statt eine zu raten: gewuerfelt wird nur, wenn eine
        // enge Kachel in DIST <= 1 liegt (ghostSpice), und wo die liegt, haengt am Layout.
        const tiles = currentTrackTiles;
        let start = 0;
        for (let i = 0; i < tiles.length; i++) {
          if (tileTightness(tiles[(i + 1) % tiles.length].type) > 0) { start = i; break; }
        }
        a.ghost.tileIndex = start; a.ghost.tilesTotal = start; a.ghost.tileMs = 700;
        const eng = ghostAheadTightest(a, 2);
        // DIE KENNUNG SETZT SONST ghostTick(), nicht ghostAheadTightest(): ohne sie ist
        // aheadTight.key undefined, und `g.mistakeArmed !== aheadTight.key` ist beim ersten
        // Aufruf falsch - es wird also NIE gewuerfelt. Genau darauf ist diese Sonde beim
        // ersten Anlauf hereingefallen: sie meldete "kein Fehler" und meinte "kein Wurf".
        eng.key = a.ghost.tileIndex + ':' + eng.dist;
        const spice = ghostSpice(a, eng);
        return { faktor: +(spice.factor || 1).toFixed(4),
                 fehlerQuer: +(spice.fehlerQuer || 0).toFixed(4),
                 engVoraus: { tight: eng.tight, dist: eng.dist },
                 fehlerLaeuft: !!(a.ghost.mistakeUntil
                                  && a.ghost.mistakeUntil > Date.now()) };
      } finally {
        Math.random = echtRandom;
        garage.splice(0, garage.length);
        for (const c of autos) stopGhost(c);
        for (const c of merkGarage) garage.push(c);
        Object.assign(ghostCfg, merkCfg);
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ---- FAHRERCHARAKTER: GEZOGEN, IN DER SPANNE, UND VERSCHIEDEN -----------------
    //
    // Geprueft wird das ZIEHEN, nicht die Wirkung: die Wirkung haengt an fuenf Groessen und
    // ist in der Kennzahlensonde zu sehen (die Rundenzeit-Spanne im Feld verdoppelt sich).
    // Hier geht es um die Zusicherungen, die man an einer Zufallszahl ueberhaupt pruefen
    // kann: liegt sie im dokumentierten Band, und sind die Autos verschieden?
    //
    // attrappeGhost() ruft startGhost(), und dort wird gezogen - die Sonde muss also nichts
    // weiter tun als Autos anzulegen und hinzusehen.
    charakterProbe(n) {
      const zahl = Math.max(2, Math.min(8, n || 6));
      const autos = [];
      try {
        for (let i = 0; i < zahl; i++) autos.push(OMEGA_TEST.attrappeGhost('C' + i));
        const werte = autos.map((c) => c.ghost.charakter);
        const reaktionen = autos.map((c) => c.ghost.startReaktion);
        const felder = ['angriff', 'verteidigung', 'fehler', 'kurvenAbzug'];
        const spanne = {};
        for (const f of felder) {
          const w = werte.map((x) => x && x[f]).filter((x) => typeof x === 'number');
          spanne[f] = w.length ? { min: Math.min.apply(null, w), max: Math.max.apply(null, w),
                                   verschieden: new Set(w).size } : null;
        }
        return {
          autos: zahl,
          spanne,
          pitVersatz: werte.map((x) => x && x.pitVersatz),
          reaktionMin: Math.min.apply(null, reaktionen),
          reaktionMax: Math.max.apply(null, reaktionen),
          reaktionVerschieden: new Set(reaktionen).size,
        };
      } finally {
        for (const c of autos) stopGhost(c);
      }
    },

    // ---- VERTEIDIGEN: DECKT DER VORAUSFAHRENDE DIE SEITE AB? ----------------------
    //
    // Zwei Attrappen, der Angreifer dicht hinter dem Vorausfahrenden und lange genug
    // klebend. Math.random wird auf 0 gestellt - der Wurf gelingt dann immer, und zwar
    // BEIDE: das Ansetzen und die Verteidigungsentscheidung. Was geprueft werden soll, ist
    // nicht der Zufall, sondern das Vorzeichen.
    //
    //   ohne Verteidigen   der Vorausfahrende weicht zur GEGENSEITE des Angreifers
    //   mit Verteidigen    er geht auf DESSEN Seite und deckt sie ab
    verteidigenProbe(opt) {
      const o = opt || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkCfg = Object.assign({}, ghostCfg);
      const merkFlag = flagState;
      const echtRandom = Math.random;
      const autos = [];
      try {
        currentTrackTiles = codeToTrack(o.code || 'SG2R3G2R3').tiles;
        lineCache = null;
        Object.assign(ghostCfg, WUERZE_AUS);
        ghostCfg.wuerzeUeberholen = true;
        ghostCfg.wuerzeVerteidigen = !!o.verteidigen;
        flagState = 'green';
        Math.random = () => 0;
        const a = OMEGA_TEST.attrappeGhost('A');   // vorne
        const b = OMEGA_TEST.attrappeGhost('B');   // hinten, greift an
        garage.push(a); garage.push(b);
        autos.push(a, b);
        a.ghost.tileIndex = 2; a.ghost.tilesTotal = 2; a.ghost.laps = 1; a.ghost.tileMs = 700;
        b.ghost.tileIndex = 1; b.ghost.tilesTotal = 1; b.ghost.laps = 1; b.ghost.tileMs = 700;
        // Der Vorausfahrende liegt rechts. NACHGEMESSEN entscheidet das die Seite hier
        // trotzdem nicht: die beiden liegen 0,7 s auseinander, also ausserhalb von
        // GHOST_NAH_SEK, und damit sieht ghostSeitenFrei() keinen Nachbarn - beide Seiten
        // sind frei, und dann gewinnt die Innenseite der naechsten Kurve (rechts auf
        // dieser Strecke). Die Sonde prueft deshalb das VORZEICHENVERHAELTNIS von
        // attackSide und yieldSide und nicht eine bestimmte Seite.
        a.ghost.querSoll = 0.5; b.ghost.querSoll = 0;
        // Lange genug geklebt, damit die Scharfstellung vorbei ist.
        b.ghost.closeSince = Date.now() - (SPICE_ATTACK_ARM_MS + 500);
        ghostSpice(b, ghostAheadTightest(b, 2));
        return {
          attackSide: b.ghost.attackSide || 0,
          yieldSide: a.ghost.yieldSide || 0,
          verteidigt: !!a.ghost.verteidigt,
          phase: b.ghost.passPhase || null,
          // Deckt er die Seite ab, auf der der Angreifer vorbei will?
          deckt: (b.ghost.attackSide || 0) !== 0
                 && Math.sign(a.ghost.yieldSide || 0) === Math.sign(b.ghost.attackSide || 0),
        };
      } finally {
        Math.random = echtRandom;
        flagState = merkFlag;
        garage.splice(0, garage.length);
        for (const c of autos) stopGhost(c);
        for (const c of merkGarage) garage.push(c);
        Object.assign(ghostCfg, merkCfg);
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ---- BLAUE FLAGGE: MACHT DER UEBERRUNDETE PLATZ? ------------------------------
    //
    // Die Lage von Hand hergestellt, weil sie in einem Lauf selten ist und weil sie an einer
    // Stelle haengt, die leicht falsch herum gedacht wird: wer ueberrundet, hat MEHR
    // Fortschritt (Runden mal Kachelzahl plus Ort) und steht damit in der Wertung vorn,
    // waehrend er auf der Runde HINTER dem Ueberrundeten faehrt. Die Sonde prueft genau
    // diese Unterscheidung mit.
    //
    // Zwei Attrappen: A liegt eine Kachel voraus und hat eine Runde WENIGER, B kommt dicht
    // hinter ihm. Gefragt wird, was ghostSpice() fuer A daraus macht - Querversatz und
    // Tempofaktor.
    blaueFlaggeProbe(opt) {
      const o = opt || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkCfg = Object.assign({}, ghostCfg);
      const autos = [];
      try {
        currentTrackTiles = codeToTrack(o.code || 'SG2R3G2R3').tiles;
        lineCache = null;
        Object.assign(ghostCfg, WUERZE_AUS);
        ghostCfg.wuerzeBlau = o.aus ? false : true;
        const a = OMEGA_TEST.attrappeGhost('A');   // der Ueberrundete
        const b = OMEGA_TEST.attrappeGhost('B');   // der Ueberrunder
        garage.push(a); garage.push(b);
        autos.push(a, b);
        // A eine Kachel voraus AUF DER RUNDE, aber eine Runde zurueck in der Wertung.
        a.ghost.tileIndex = 2; a.ghost.tilesTotal = 2; a.ghost.laps = 1; a.ghost.tileMs = 700;
        b.ghost.tileIndex = 1; b.ghost.tilesTotal = 1; b.ghost.laps = 2; b.ghost.tileMs = 700;
        a.ghost.querSoll = 0; b.ghost.querSoll = 0;
        const vorher = { yieldSide: a.ghost.yieldSide || 0, yieldUntil: a.ghost.yieldUntil || 0 };
        // aheadTight wie im Fahrbetrieb: ghostSpice() erwartet das Ergebnis von
        // ghostAheadTightest() und liest daraus tight/dist/key.
        const spice = ghostSpice(a, ghostAheadTightest(a, 2));
        return {
          vorher,
          yieldSide: a.ghost.yieldSide || 0,
          weichtAus: !!(a.ghost.yieldUntil && a.ghost.yieldUntil > Date.now()),
          faktor: +(spice.factor || 1).toFixed(4),
          // Und die Gegenrichtung: sieht A den Ueberrunder ueberhaupt als Hintermann?
          hinterMir: (() => {
            const h = ghostHinterMir(a);
            return h ? { name: h.car.alias, gap: +h.gap.toFixed(3) } : null;
          })(),
        };
      } finally {
        garage.splice(0, garage.length);
        for (const c of autos) stopGhost(c);
        for (const c of merkGarage) garage.push(c);
        Object.assign(ghostCfg, merkCfg);
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ---- WELCHE SEITE IST BELEGT? -------------------------------------------------
    //
    // ghostSeitenFrei() ist der Wachhund, der ein Ueberholmanoever nicht in ein drittes
    // Auto hinein ansetzen laesst. Er liest die Querlagen aller Autos in Reichweite - eine
    // Groesse, die sonst nur im Fahrbetrieb entsteht -, deshalb stellt diese Sonde die Lage
    // von Hand her: drei Attrappen auf derselben Kachel, Querlagen wie bestellt.
    //
    // Die Garage wird ausgetauscht und im finally zurueckgegeben, wie bei jeder Sonde hier.
    seitenFreiProbe(lagen) {
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const autos = [];
      try {
        currentTrackTiles = codeToTrack('SG2R3G2R3').tiles;
        lineCache = null;
        const liste = lagen || [0.5, -0.5];
        // Das erste Auto ist das PRUEFENDE, die weiteren sind die Nachbarn.
        for (let i = 0; i <= liste.length; i++) {
          const car = OMEGA_TEST.attrappeGhost('S' + i);
          garage.push(car);
          autos.push(car);
          car.ghost.tileIndex = 0;
          car.ghost.tilesTotal = 0;
          car.ghost.laps = 0;
          // Der Prueflauf selbst liegt mittig, die Nachbarn dort, wo bestellt.
          car.ghost.querSoll = i === 0 ? 0 : liste[i - 1];
          // Ohne Kacheldauer gibt ghostAbstandSek() null zurueck, und ghostNahe() faellt
          // auf den Kachelvergleich zurueck - genau das ist hier gewollt: alle auf einer
          // Kachel heisst nebeneinander, ohne dass eine Uhr mitspielen muss.
          car.ghost.tileMs = 0;
        }
        return ghostSeitenFrei(autos[0]);
      } finally {
        garage.splice(0, garage.length);
        for (const c of autos) stopGhost(c);
        for (const c of merkGarage) garage.push(c);
        currentTrackTiles = merkTiles;
        lineCache = null;
      }
    },

    // ====================================================================================
    // DIE KACHELPHASE GEGEN DIE WAHRHEIT
    // ====================================================================================
    //
    // Die Phase innerhalb einer Kachel ist eine ERSCHLIESSUNG: das Auto meldet nur, DASS
    // der Kachelzaehler gewechselt hat. Sie indexiert aber die Ideallinie und das
    // Bremsprofil, ist also die Groesse, auf der das ganze Fahrmodell steht.
    //
    // IN DER SIMULATION IST DIE WAHRHEIT BEKANNT: simOrt() rechnet die Phase aus der
    // wirklichen Bogenlaenge (90b-sim.js), und simZustand() gibt sie als autos[].phase
    // heraus. Diese Sonde stellt beide Schaetzer daneben - die Uhr
    // (ghostTilePhaseZeit) und den Weg (ghostTilePhaseWeg) - und zwar im SELBEN Lauf,
    // damit der Vergleich nicht zwei verschiedene Rennen vergleicht.
    //
    // Ausgegeben werden nicht nur mittlere Fehler, sondern die zwei RAENDER, weil dort die
    // Fehler sitzen, die man sieht:
    //
    //   klebt      Anteil der Abtastungen mit Schaetzung >= 0,995. Die Zeitphase deckelt
    //              bei 1 und bleibt dort stehen; gemessen waren das 3 bis 10 Prozent jeder
    //              Kachel, und in dieser Zeit friert der Linienversatz ein.
    //   kurz       Anteil der Kacheln, auf denen die Schaetzung NIE ueber 0,95 kam. Das ist
    //              der NEUE Fehler, den der Weg einfuehren kann: fehlt der Linie das letzte
    //              Stueck jeder Kachel, springt der Versatz an der Naht - genau das, was der
    //              Selbsttest "Ideallinie stetig" einmal mit 2,48 Eigenschritten gefangen
    //              hat.
    //
    // `kurz` wird ausdruecklich als HOECHSTE auf einer Kachel erreichte Phase gemessen und
    // nicht als Wert im Takt des Wechsels. Der erste Anlauf tat Letzteres und verglich
    // damit Ungleiches: die Simulation setzt car.tileAt im Bewegungsteil DESSELBEN Takts
    // zurueck (die Zeitphase steht dort also schon auf 0), waehrend der Ghost seinen
    // Wegzaehler erst im naechsten Takt zurueckstellt (die Wegphase steht noch auf 1).
    // Gemessen ergab das kurz = 1,00 gegen 0,51 - eine Zahl, die nur die Reihenfolge
    // innerhalb von simSchritt() beschreibt. Die Hoechstphase je Kachel ist von dieser
    // Reihenfolge unabhaengig.
    //
    // WAS DIESE MESSUNG NICHT ZEIGT, und das gehoert dazu: in der Simulation reiten
    // Schaetzung und Wahrheit auf DEMSELBEN Temposignal - der Motor, der den Weg liefert,
    // treibt auch a.s. Der Vergleich zeigt also Konvergenz und nicht Teppichtreue. Wer
    // Letztere prueft, verstellt zusaetzlich das Verhaeltnis von Modell zu Wirklichkeit;
    // dafuer gibt es ghostLinieTrace mit `kurvenFaktor`.
    //
    // ---- ZWEI FALLEN, IN DIE DIESE SONDE BEIM ERSTEN ANLAUF BEIDE GETRETEN IST -------
    //
    // 1. DIE UHR. ghostTilePhaseZeit() rechnet Date.now() - car.tileAt, und die
    //    Simulation setzt car.tileAt auf IHRE Uhr (st.uhr), die 100 Mal schneller laeuft
    //    als die Wanduhr. Wer die Schaetzer NACH simSchritt() liest, vergleicht also eine
    //    Wandzeit mit einem Zeitstempel weit in der Zukunft: die Differenz ist negativ, der
    //    Deckel macht 0 daraus, und die Zeitphase meldete glatte 0 mit einem mittleren
    //    Fehler von -0,49 - also genau den Mittelwert einer gleichverteilten Phase. Die
    //    Auswertung steht deshalb in derselben Uhrfaelschung wie die Ticks, synchron
    //    eingeklammert und im finally zurueckgestellt.
    //
    // 2. DER TAKT AM KACHELRAND. simSchritt() ruft erst ghostTick(), bewegt DANN die Autos
    //    und setzt erst danach den Kachelzaehler. Im Takt eines Kachelwechsels liegt das
    //    Auto fuer die Simulation also schon auf der neuen Kachel (wahre Phase ~0,02),
    //    waehrend der Ghost seinen Wechsel erst im naechsten Takt sieht und noch auf der
    //    alten schaetzt (~0,98). Ein Fehlervergleich in diesem Takt misst die Reihenfolge
    //    innerhalb von simSchritt() und nicht die Schaetzung - er waere ein Fehler von
    //    fast 1,0, und zwar bei JEDEM Kachelwechsel. Gezaehlt wird deshalb nur, wo Ghost
    //    und Simulation dieselbe Kachel meinen (g.tileIndex === a.kachel); die Zahl der
    //    uebersprungenen Takte geht als `randTakte` mit hinaus, damit niemand glaubt, hier
    //    werde etwas versteckt.
    async phaseWahrheitProbe(opt) {
      if (typeof simStart !== 'function' || typeof simZustand !== 'function') return null;
      const o = opt || {};
      const takte = o.takte || 1600;
      const autos = Math.max(2, Math.min(6, o.autos || 4));
      const stell = (id, v) => {
        const e = $(id);
        if (!e) return;
        if (e.type === 'checkbox') { e.checked = !!v; } else { e.value = String(v); }
        e.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const merkFeld = { g: ($('sim-ghosts') || {}).value, l: ($('sim-laps') || {}).value,
                         f: !!($('sim-fast') || {}).checked };
      const merkCfg = Object.assign({}, ghostCfg);
      // Je Schaetzer: Fehlersumme, Betragssumme, Zahl der Abtastungen, Klebeanteil und die
      // Verteilung der je Kachel erreichten Hoechstphase.
      const bau = () => ({ n: 0, summe: 0, betrag: 0, klebt: 0, kacheln: 0, kurz: 0,
                           hoechstSumme: 0 });
      const zeit = bau(), weg = bau();
      let ohneWeg = 0, randTakte = 0;
      try {
        stell('sim-ghosts', String(autos));
        stell('sim-laps', '10');
        stell('sim-fast', false);
        ghostCfg.pitAn = false;           // ein Boxenstopp ist keine Kachelfahrt
        simStart();
        if (!simAn()) return null;
        // Je Auto: der Zaehlerstand, den der GHOST zuletzt gesehen hat (an ihm haengt sein
        // eigener Kachelwechsel), und die bisher hoechste Schaetzung auf dieser Kachel.
        const vorCount = [], hoch = [];
        const kachelAbschluss = (i) => {
          const h = hoch[i];
          if (!h) return;
          if (h.pz !== null) {
            zeit.kacheln++; zeit.hoechstSumme += h.pz; if (h.pz < 0.95) zeit.kurz++;
          }
          if (h.pw !== null) {
            weg.kacheln++; weg.hoechstSumme += h.pw; if (h.pw < 0.95) weg.kurz++;
          }
          hoch[i] = null;
        };
        for (let k = 0; k < takte; k++) {
          simSchritt(SIM_TAKT_MS);
          if (!simAn()) break;
          const z = simZustand();
          if (!z) break;
          // DIE UHR DER SIMULATION, fuer die Dauer der Auswertung - siehe Falle 1 oben.
          const echtNow = Date.now;
          Date.now = () => simState.uhr;
          try {
            z.autos.forEach((a, i) => {
              const car = (simState && simState.autos[i]) ? simState.autos[i].car : null;
              if (!car || !car.ghost) return;
              const g = car.ghost;
              // Hat der GHOST seinen Kachelwechsel bemerkt? Dann ist die vorige Kachel
              // abgeschlossen und ihre Hoechstphase steht fest.
              if (vorCount[i] !== undefined && vorCount[i] !== g.lastCount) kachelAbschluss(i);
              vorCount[i] = g.lastCount;
              const pz = ghostTilePhaseZeit(car);
              const pw = ghostTilePhaseWeg(car);
              if (pw === null) ohneWeg++;
              if (!hoch[i]) hoch[i] = { pz: null, pw: null };
              if (pz !== null && pz !== undefined) {
                hoch[i].pz = Math.max(hoch[i].pz === null ? -1 : hoch[i].pz, pz);
              }
              if (pw !== null && pw !== undefined) {
                hoch[i].pw = Math.max(hoch[i].pw === null ? -1 : hoch[i].pw, pw);
              }
              // Der Fehlervergleich nur, wo beide dieselbe Kachel meinen - siehe Falle 2.
              if (g.tileIndex !== a.kachel) { randTakte++; return; }
              const wahr = a.phase;
              const nimm = (s, p) => {
                if (p === null || p === undefined) return;
                s.n++; s.summe += (p - wahr); s.betrag += Math.abs(p - wahr);
                if (p >= 0.995) s.klebt++;
              };
              nimm(zeit, pz);
              nimm(weg, pw);
            });
          } finally {
            Date.now = echtNow;
          }
        }
      } finally {
        Object.assign(ghostCfg, merkCfg);
        if (simAn()) simStop('Phasenpruefung');
        stell('sim-ghosts', merkFeld.g);
        stell('sim-laps', merkFeld.l);
        stell('sim-fast', merkFeld.f);
      }
      const fertig = (s) => (s.n ? {
        proben: s.n,
        mittelFehler: +(s.summe / s.n).toFixed(4),     // mit Vorzeichen: laeuft sie vor?
        mittelBetrag: +(s.betrag / s.n).toFixed(4),
        klebt: +(s.klebt / s.n).toFixed(4),
        kacheln: s.kacheln,
        hoechstMittel: s.kacheln ? +(s.hoechstSumme / s.kacheln).toFixed(4) : null,
        kurz: s.kacheln ? +(s.kurz / s.kacheln).toFixed(4) : null,
      } : null);
      return { zeit: fertig(zeit), weg: fertig(weg),
               ohneWegProben: ohneWeg, randTakte };
    },

    // ====================================================================================
    // DIE KENNZAHLENSONDE: BERUEHRUNGEN UND UEBERHOLMANOEVER JE MINUTE
    // ====================================================================================
    //
    // WOZU, und das ist ein Befund und keine Idee: die Simulation zaehlt `kontakte`,
    // `kontaktMs`, `kontaktEngst` und `ueberholt` (90b-sim.js), und KEINE Zeile im ganzen
    // Quelltext hat diese vier Zahlen je gelesen. Die Sweeps, auf denen
    // SPICE_LUECKE_MIN_S = 1,2 und SPICE_ATTACK_RANGE = 1,3 stehen, sind von Hand aus der
    // Konsole gefahren; ihre Tabellen stehen als Kommentar in 90-ghosts.js und sind nicht
    // nachrechenbar. Jede weitere Aenderung am Fahrverhalten waere damit eine Behauptung
    // gegen eine Erinnerung.
    //
    // Hinein geht eine Liste von Einstellungen, heraus kommt eine Tabelle:
    //
    //   await OMEGA_TEST.ghostSweep([
    //     { name: 'heute' },
    //     { name: 'enge Luecke', lueckeMinS: 0.35 },
    //     { name: 'ohne Abstand', cfg: { wuerzeAbstand: false } },
    //   ], { sekunden: 90, laeufe: 3 })
    //
    // Eine Variante verstellt `ghostCfg` (Feld `cfg`) und die drei Groessen, die als
    // `let` mit Setzer liegen, weil sie fuer genau solche Reihen so gebaut wurden:
    // `lueckeMinS`, `attackRange`, `gapMin`.
    //
    // ---- WAS DIE VIER ZAHLEN WIRKLICH BEDEUTEN, und zwei davon ueberraschen ----------
    //
    //   kontakte      FLANKEN je Paar, mit 1000 ms Sperre (simKontakteTick). Eine
    //                 Beruehrung, die zwei Sekunden anhaelt, ist eine.
    //   kontaktMs     Summe UEBER ALLE PAARE. Bei vier Autos gibt es sechs Paare, der Wert
    //                 kann also groesser sein als die verstrichene Zeit - ein "Anteil der
    //                 Zeit in Beruehrung" ist er erst geteilt durch die Zahl der Paare, und
    //                 genau das tut `kontaktAnteil` unten.
    //   kontaktEngst  wird NUR beim Zaehlen einer neuen Flanke fortgeschrieben, ist also
    //                 der engste Laengsabstand IM MOMENT DES EINSETZENS und nicht das
    //                 Minimum ueber den Lauf. Der Name in simZustand() sagt das nicht,
    //                 deshalb steht es hier.
    //   ueberholt     gesicherte Rangwechsel mit Hysterese ueber eine Autolaenge.
    //
    // ---- DER TAKT IST FEST, und das ist kein Detail ---------------------------------
    //
    // simKontakteTick() laeuft einmal je simSchritt() und schreibt pauschal SIM_TAKT_MS
    // auf kontaktMs - unabhaengig davon, mit welcher Schrittweite simSchritt() gerufen
    // wurde. Mit einer groesseren Schrittweite (simSchritt teilt intern bis
    // SIM_TEIL_MAX_MS = 60) waere die Beruehrungsdauer untererfasst und die Abtastung der
    // Beruehrungen zu grob. Diese Sonde ruft deshalb IMMER mit SIM_TAKT_MS und nimmt
    // keine Schrittweite als Angabe an.
    //
    // ====================================================================================
    // DAS RAUSCHEN DIESER SONDE - GEMESSEN, UND ES IST GROSS
    // ====================================================================================
    //
    // Sieben Stellen in 90-ghosts.js wuerfeln (Tagesform, Fehler, Attacke, Boxenfenster,
    // Lernen), und keine davon ist gesaet. Wie viel davon im Ergebnis landet, ist nicht
    // geschaetzt, sondern gemessen: DREI IDENTISCHE Einstellungen, je vier Laeufe von 90 s,
    // fuenf Autos.
    //
    //     Variante        Ber/min   Ueb/min   Ber je Ueb   Feld-Spanne   Runde
    //     A (Vorgabe)      29,3      17,3       1,67         0,356      12,26 s
    //     B (Vorgabe)      21,5      17,4       1,39         0,327      12,23 s
    //     C (Vorgabe)      20,8      20,2       1,05         0,310      12,21 s
    //     Spanne            8,5 (41%) 2,9 (17%) 0,62 (48%)   0,046 (13%) 0,055 (0,4%)
    //
    // WAS DARAUS FOLGT, und es ist unbequem:
    //
    //   Rundenzeit        0,4 Prozent Rauschen. Die einzige Zahl, mit der man einen
    //                     Unterschied von wenigen Prozent belegen kann.
    //   Feld-Spanne       13 Prozent. Brauchbar fuer Unterschiede ab etwa einem Drittel.
    //   Ueberholmanoever  17 Prozent, und das ist der GUENSTIGE Fall dieser Reihe.
    //   Beruehrungen      41 Prozent. Ein gemessener "Gewinn" von 20 Prozent ist hier
    //                     nichts - er ist die halbe Spanne zweier gleicher Einstellungen.
    //   Ber je Ueb        48 Prozent. Als Quotient zweier rauschender Zahlen rauscht sie
    //                     am meisten, obwohl sie sich am klügsten liest.
    //
    // EINMAL SELBST DARAUF HEREINGEFALLEN, und das gehoert hierher: mit drei Laeufen sah
    // der Windschatten wie +35 Prozent Ueberholmanoever bei gleichen Beruehrungen aus
    // (14,0 -> 18,9). Mit SECHS Laeufen war der Unterschied exakt null (17,25 gegen 17,22).
    // Fast waere daraus eine geaenderte Vorgabe geworden.
    //
    // DIE REGEL, die daraus folgt: eine Aussage ueber Beruehrungen oder Ueberholmanoever
    // braucht entweder einen FAKTOR (wie der Abstandhalter mit 9,7) oder viel mehr Laeufe,
    // als sich hier bezahlen lassen. Fuer alles Feinere ist die Rundenzeit die Zahl - und
    // wo die nichts sagt, sagt diese Sonde nichts.
    //
    // `spanne` steht deshalb neben JEDEM Mittelwert, und sie ist nicht Zierde: eine
    // Einstellung, deren Vorsprung kleiner ist als die Spanne ihrer eigenen Wiederholungen,
    // ist nicht besser - sie ist einmal besser gelaufen.
    //
    // BOXENSTOPPS SIND AUS, solange eine Variante sie nicht ausdruecklich einschaltet: ein
    // stehendes Auto in der Boxengasse erzeugt Beruehrungen und Rangwechsel, die nichts
    // mit dem Fahren zu tun haben. Dieselbe Vorsichtsmassnahme trifft der vorhandene Test
    // zur Zeitluecke, und aus demselben Grund.
    //
    // ---- DIE AUFWAERMZEIT, und sie ist nachgemessen und nicht vorsichtshalber -------
    //
    // Der Start ist ein Knaeuel: alle Autos stehen auf derselben Stelle, ghostAssignBias()
    // verteilt sie erst ueber GHOST_GRID_MS = 6000 ms, und in diesen Sekunden fallen
    // Beruehrungen an, die nichts ueber das Fahren sagen. Wie stark das wiegt, zeigt der
    // Vergleich derselben zwei Einstellungen ueber verschiedene Laufzeiten (vier Autos):
    //
    //     Fenster                     Zeitluecke 0,35   Zeitluecke 1,2
    //      20 s ohne Aufwaermen             51,1              48,0     kein Unterschied
    //      90 s ohne Aufwaermen             43,6              26,0     der bekannte
    //      20 s nach 10 s Aufwaermen        50,0              20,0     derselbe, in einem
    //                                                                  Viertel der Zeit
    //
    // (Beruehrungen je Minute, vier Autos, je drei Laeufe.) Bei 20 s ohne Aufwaermen ist
    // der Start der halbe Lauf und deckt den Unterschied vollstaendig zu. Die Sonde zaehlt
    // deshalb erst nach `aufwaermSekunden` (Vorgabe 10): die vier Zaehler der Simulation
    // laufen monoton, also wird ihr Stand nach dem Aufwaermen als GRUNDLINIE gemerkt und am
    // Ende abgezogen. Damit ist das Fenster sauber, ohne dass die Simulation etwas
    // zuruecksetzen muss - und kurze Laeufe werden brauchbar, was fuer jede Reihe zaehlt,
    // die viele Einstellungen durchfahren soll.
    //
    // AUSNAHME: `engstCm` ist ein Minimum und kein Zaehler - es laesst sich nicht abziehen
    // und gilt deshalb fuer den GANZEN Lauf, Aufwaermen eingeschlossen.
    //
    // ---- WAS DIE SONDE NICHT AUFLOEST, und das gehoert dazu ------------------------
    //
    // Gemessen ueber drei Laeufe von 90 s streuen die Ueberholmanoever um 8,6 bzw. 10,0 je
    // Minute - also um so viel, wie der Unterschied zwischen den beiden Einstellungen
    // betraegt (19,3 gegen 12,0). Fuer Beruehrungen reichen drei Laeufe (Streuung 4,7 und
    // 8,7 bei einem Unterschied von 17,6), fuer Ueberholmanoever nicht. Wer eine Aussage
    // ueber das Ueberholen braucht, nimmt mehr Laeufe - und liest in jedem Fall die
    // Spanne neben dem Mittelwert, bevor er einen Unterschied behauptet.
    async ghostSweep(varianten, opt) {
      if (typeof simStart !== 'function' || typeof simZustand !== 'function') return null;
      const o = opt || {};
      const sekunden = Math.max(5, o.sekunden || 90);
      const laeufe = Math.max(1, o.laeufe || 3);
      const autos = Math.max(2, Math.min(6, o.autos || 4));
      const aufwaerm = o.aufwaermSekunden === undefined ? 10 : Math.max(0, o.aufwaermSekunden);
      const schritte = Math.round(sekunden * 1000 / SIM_TAKT_MS);
      const aufwaermSchritte = Math.round(aufwaerm * 1000 / SIM_TAKT_MS);
      const liste = (varianten && varianten.length) ? varianten : [{ name: 'heute' }];
      const paare = autos * (autos - 1) / 2;
      // Auswahlfelder werden ueber ein 'change' gestellt und auf GUELTIGKEIT geprueft: ein
      // Wert, den ein Auswahlfeld nicht hat, laesst es auf seinem alten stehen, und die
      // Simulation faellt still auf ihre Vorgabe zurueck.
      const stell = (id, v) => {
        const e = $(id);
        if (!e) return;
        if (e.type === 'checkbox') { e.checked = !!v; } else { e.value = String(v); }
        e.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const merkFeld = { g: ($('sim-ghosts') || {}).value, l: ($('sim-laps') || {}).value,
                         f: !!($('sim-fast') || {}).checked };
      // ghostCfg traegt nur Zahlen und Wahrheitswerte - eine flache Kopie genuegt, und sie
      // ist die Wahrheit, gegen die JEDER Lauf zurueckgesetzt wird. Ohne das Zuruecksetzen
      // je Lauf traegt die dritte Variante die Einstellung der zweiten mit sich.
      const merkCfg = Object.assign({}, ghostCfg);
      // Die STRECKE als Angabe, im Muster der uebrigen Sonden. Ohne sie misst die Sonde
      // immer die Vorgabestrecke der Simulation (SR3GLR2GR2G2, dreizehn Kacheln ohne
      // Haarnadel) - und genau die Haarnadel ist der Fall, in dem ein Ghost abfliegt.
      const merkTiles = currentTrackTiles;
      const merkLuecke = lueckeMinLesen(), merkRange = attackRangeLesen();
      const merkGap = gapMinLesen();
      const zahl = (x, n) => (x === null || x === undefined || !isFinite(x)
        ? null : +x.toFixed(n === undefined ? 2 : n));
      // ABGAENGE zaehlen, und zwar als FLANKE. Sie stehen in keinem Zaehler der Simulation,
      // sind aber die Zahl, die ueber eine Kurvenabstimmung entscheidet: ein Ghost, der
      // schneller ist und dabei abfliegt, ist nicht schneller. `geparkt` je Auto kommt aus
      // simZustand(), der Uebergang falsch -> wahr ist ein Abgang.
      const abgangZaehler = (vor, z) => {
        let neu = 0;
        (z.autos || []).forEach((a, i) => {
          if (a.geparkt && !vor[i]) neu++;
          vor[i] = !!a.geparkt;
        });
        return neu;
      };
      // Der Stand der vier Zaehler nach dem Aufwaermen. Alle laufen monoton, also ist die
      // Differenz das Messfenster - siehe der Kommentar oben.
      const grundlinie = (z) => ({
        uhrMs: z.uhrMs, kontakte: z.kontakte, ueberholt: z.ueberholt,
        kontaktMs: z.kontaktMs,
        // Je Auto die Zahl der bis hierher gefahrenen Runden: eine Rundenzeit aus dem
        // Aufwaermfenster gehoert nicht ins Ergebnis.
        runden: (z.autos || []).map((a) => (a.zeiten || []).length),
      });
      // Die Kennzahlen EINES Laufs, aus dem letzten gueltigen Zustand und der Grundlinie.
      const kennzahlen = (z, basis, abgaenge) => {
        const b = basis || { uhrMs: 0, kontakte: 0, ueberholt: 0, kontaktMs: 0, runden: [] };
        const dauerMs = Math.max(1, z.uhrMs - b.uhrMs);
        const min = dauerMs / 60000;
        const kontakte = z.kontakte - b.kontakte;
        const ueberholt = z.ueberholt - b.ueberholt;
        const kontaktMs = z.kontaktMs - b.kontaktMs;
        const runden = [];
        // Und je Auto getrennt: die Spanne ZWISCHEN den Autos sagt, ob das Feld
        // unterschiedlich schnell ist - die Frage, an der sich der Fahrercharakter
        // entscheidet. Der Mittelwert ueber alle Autos kann dabei gleich bleiben.
        const jeAuto = [];
        (z.autos || []).forEach((a, i) => {
          // Die erste Runde eines Autos faellt immer heraus: sie beginnt aus dem Stand, und
          // der vorhandene Test "die Autos fahren, und die Zeiten stimmen" haelt
          // ausdruecklich fest, dass sie deshalb die langsamste ist. Dazu faellt alles
          // heraus, was vor der Grundlinie lag.
          const ab = Math.max(1, (b.runden && b.runden[i]) || 0);
          const meine = [];
          for (let k = ab; k < (a.zeiten || []).length; k++) {
            runden.push(a.zeiten[k] / 1000);
            meine.push(a.zeiten[k] / 1000);
          }
          if (meine.length) jeAuto.push(meine.reduce((x, y) => x + y, 0) / meine.length);
        });
        return {
          sekundenEcht: zahl(dauerMs / 1000, 1),
          kontakte, ueberholt,
          beruehrungenProMin: zahl(kontakte / min, 1),
          ueberholtProMin: zahl(ueberholt / min, 1),
          beruehrungJeUeberholen: ueberholt ? zahl(kontakte / ueberholt) : null,
          // Anteil der Zeit, in der EIN Paar in Beruehrung ist - siehe der Kommentar oben.
          kontaktAnteil: zahl(kontaktMs / Math.max(1, dauerMs * paare), 3),
          // Kein Zaehler, sondern ein Minimum: gilt fuer den ganzen Lauf, Aufwaermen
          // eingeschlossen.
          engstCm: z.kontaktEngstCm,
          abgaenge: abgaenge || 0,
          abgaengeProMin: zahl((abgaenge || 0) / min, 2),
          rundenZahl: runden.length,
          // Spanne der mittleren Rundenzeit ZWISCHEN den Autos, in Sekunden.
          rundeSpanneAutos: jeAuto.length > 1
            ? zahl(Math.max.apply(null, jeAuto) - Math.min.apply(null, jeAuto), 3) : null,
          besteRundeS: runden.length ? zahl(Math.min.apply(null, runden), 2) : null,
          mittlereRundeS: runden.length
            ? zahl(runden.reduce((s, x) => s + x, 0) / runden.length, 2) : null,
        };
      };
      // Mittelwert und SPANNE ueber die Laeufe. Die Spanne ist die eigentliche Aussage:
      // ohne sie liest man drei Nachkommastellen und haelt Rauschen fuer Fortschritt.
      const mitteln = (arr) => {
        const gut = arr.filter(Boolean);
        if (!gut.length) return null;
        const aus = { laeufe: gut.length };
        for (const k of ['beruehrungenProMin', 'ueberholtProMin', 'beruehrungJeUeberholen',
                         'kontaktAnteil', 'abgaengeProMin', 'mittlereRundeS', 'besteRundeS',
                         'rundeSpanneAutos', 'sekundenEcht']) {
          const w = gut.map((g) => g[k]).filter((x) => x !== null && x !== undefined);
          if (!w.length) { aus[k] = null; aus[k + 'Spanne'] = null; continue; }
          aus[k] = zahl(w.reduce((s, x) => s + x, 0) / w.length, 3);
          aus[k + 'Spanne'] = zahl(Math.max.apply(null, w) - Math.min.apply(null, w), 3);
        }
        return aus;
      };
      const aus = [];
      try {
        if (o.code) { currentTrackTiles = codeToTrack(o.code).tiles; lineCache = null; }
        stell('sim-ghosts', String(autos));
        stell('sim-laps', '10');       // die groesste Option; siehe den Abbruch unten
        stell('sim-fast', false);
        for (const v of liste) {
          const laeufeAus = [];
          for (let r = 0; r < laeufe; r++) {
            Object.assign(ghostCfg, merkCfg);
            lueckeMinSetzen(merkLuecke);
            attackRangeSetzen(merkRange);
            gapMinSetzen(merkGap);
            ghostCfg.pitAn = false;
            if (v.cfg) Object.assign(ghostCfg, v.cfg);
            if (v.lueckeMinS !== undefined) lueckeMinSetzen(v.lueckeMinS);
            if (v.attackRange !== undefined) attackRangeSetzen(v.attackRange);
            if (v.gapMin !== undefined) gapMinSetzen(v.gapMin);
            simStart();
            if (!simAn()) { laeufeAus.push(null); continue; }
            // ---- UNTERSCHIEDLICH SCHNELLE AUTOS, wenn bestellt --------------------
            //
            // Mit gleicher Einstellung fahren alle gleich schnell, und dann gibt es kein
            // Ueberrunden - die blaue Flagge waere nicht messbar. `tempoSpanne` verteilt
            // car.ghostSpeed linear ueber das Feld, symmetrisch um ghostCfg.speed. Es geht
            // NACH simStart(), weil erst dort die Autos existieren; ghostTick liest den
            // Wert je Takt, also greift er sofort.
            if (o.tempoSpanne > 0 && simState && simState.autos.length > 1) {
              const n2 = simState.autos.length;
              simState.autos.forEach((a, i) => {
                const rel = n2 > 1 ? (i / (n2 - 1) - 0.5) : 0;    // -0,5 bis +0,5
                a.car.ghostSpeed = Math.max(0.35, Math.min(1,
                  (ghostCfg.speed || 0.55) + rel * o.tempoSpanne));
              });
            }
            let letzter = simZustand();
            // Aufwaermen: fahren, aber nicht zaehlen. Danach die Grundlinie merken.
            for (let k = 0; k < aufwaermSchritte && simAn(); k++) {
              simSchritt(SIM_TAKT_MS);
              const z = simZustand();
              if (z) letzter = z;
              if ((k % 400) === 399 && typeof stLuft === 'function') await stLuft();
            }
            const basis = letzter ? grundlinie(letzter) : null;
            // Der Parkzustand nach dem Aufwaermen ist der Anfangsstand: ein Auto, das
            // schon vor dem Fenster lag, ist kein Abgang IN diesem Fenster.
            const parkVor = (letzter && letzter.autos)
              ? letzter.autos.map((a) => !!a.geparkt) : [];
            let abgaenge = 0;
            for (let k = 0; k < schritte; k++) {
              simSchritt(SIM_TAKT_MS);
              // ALLE DURCH heisst: die Simulation hat sich selbst beendet, und simZustand()
              // gibt danach null. Der letzte gueltige Stand ist dann das Ergebnis, und
              // `sekundenEcht` macht sichtbar, dass der Lauf kuerzer war als bestellt -
              // die Kennzahlen sind Raten je Minute und bleiben damit vergleichbar.
              if (!simAn()) break;
              const z = simZustand();
              if (z) { letzter = z; abgaenge += abgangZaehler(parkVor, z); }
              // Dem Browser Luft lassen, ohne einen Zeitgeber zu benutzen: im verborgenen
              // Fenster sind Zeitgeber auf 1 Hz gedrosselt, ein setTimeout(0) je Takt
              // waere also eine halbe Stunde je Lauf.
              if ((k % 400) === 399 && typeof stLuft === 'function') await stLuft();
            }
            laeufeAus.push(letzter ? kennzahlen(letzter, basis, abgaenge) : null);
            if (simAn()) simStop('Kennzahlensonde');
            if (typeof stLuft === 'function') await stLuft();
          }
          aus.push({ name: v.name || '?', einzeln: laeufeAus, mittel: mitteln(laeufeAus) });
        }
      } finally {
        // Zuruecksetzen steht VORNE und das Riskanteste zuerst: eine Aufraeumzeile, die
        // wirft, macht alle folgenden unerreichbar.
        Object.assign(ghostCfg, merkCfg);
        lueckeMinSetzen(merkLuecke);
        attackRangeSetzen(merkRange);
        gapMinSetzen(merkGap);
        if (simAn()) simStop('Kennzahlensonde');
        if (o.code) { currentTrackTiles = merkTiles; lineCache = null; }
        stell('sim-ghosts', merkFeld.g);
        stell('sim-laps', merkFeld.l);
        stell('sim-fast', merkFeld.f);
      }
      return { sekunden, laeufe, autos, paare, aufwaermSekunden: aufwaerm,
               code: o.code || null, tempoSpanne: o.tempoSpanne || 0,
               takt: SIM_TAKT_MS, varianten: aus };
    },

    // ---- DAS DREHZAHLBAND JE MOTOR ------------------------------------------------
    //
    // Zwei Fragen in einer Sonde, und beide sind der Zweck der Aenderung:
    //
    //   1. Bekommt jeder Motor sein eigenes Band, und stimmt es mit loops.json?
    //   2. Wie weit wird sein oberstes Band bei Vollgas noch gestreckt? Das ist die Zahl,
    //      die "der Ton klingt zu hoch" misst - vorher 1,25 beim M4 GT3, 1,38 beim GT40.
    //
    // OHNE TON: gerechnet wird nur mit den Zahlen aus dem Manifest, es wird nichts
    // abgespielt. Eine Sonde, die dafuer einen AudioContext braucht, laeuft im verborgenen
    // Browser-Bereich nicht.
    motorBandProbe() {
      if (!sampleEngine || !sampleEngine.band) return null;
      const aus = {};
      for (const car of SAMPLE_CARS) {
        const b = sampleEngine.band[car];
        const bnd = sampleEngine.buffers[car] || {};
        const oben = Object.keys(bnd).filter((k) => k !== 'over')
          .map((k) => bnd[k].baseRpm).sort((x, y) => y - x)[0];
        aus[car] = { idle: b ? b.idle : null, limiter: b ? b.limiter : null,
                     obenBand: oben === undefined ? null : oben,
                     // Die Abspielrate am Begrenzer. 1,0 heisst: gar keine Streckung.
                     rate: (b && oben) ? +(b.limiter / oben).toFixed(3) : null };
      }
      return aus;
    },

    // Und die Abbildung selbst: welche Drehzahl zeigt die App bei welchem rpmFrac?
    motorDrehzahlProbe(car, fracs) {
      if (typeof motorDrehzahl !== 'function') return null;
      const merk = sampleEngine.car;
      try {
        sampleEngine.car = car;
        return (fracs || [0, 0.5, 1]).map((f) =>
          +motorDrehzahl({ rpm: 1500 + f * 7500, rpmFrac: f }).toFixed(1));
      } finally { sampleEngine.car = merk; }
    },

    // ---- Die Fahrhilfe: drei Modi, ueber das Bedienelement gestellt ----------------
    //
    // UEBER DAS BEDIENELEMENT und nicht ueber die Variable: fahrhilfeModus entsteht aus
    // #driver-assist, und ein Prueflauf, der die Variable direkt setzt, prueft nicht, ob
    // das Bedienelement selbst noch etwas bewirkt.
    //
    // GEPRUEFT WIRD driverAssistAktiv() und NICHT fahrhilfeModus allein - sie ist die
    // tatsaechlich verwendete Groesse (spielerOrtTick fragt sie), und sie ist eine ODER-
    // Verknuepfung mit dem Autopiloten. flagState und raceFormationLap werden dafuer auf
    // 'green'/false gezwungen: sonst haengt das Ergebnis vom Rennzustand ab, in dem der
    // Prueflauf zufaellig laeuft, und ist nicht wiederholbar.
    //
    // ---- UND WAS SEIT DEN DREI MODI DAZUKOMMT ------------------------------------
    //
    // Die Warnung war ausdruecklich: "Pass auf, dass du nicht wieder den Standard-Modus
    // kaputt machst." Der Prueflauf misst deshalb nicht nur driverAssistAktiv(), sondern
    // auch, was mit dem LENK-INPUT geschieht - und zwar in allen drei Modi, mit und ohne
    // vorhandene modeBytes. Das ist die Stelle, an der 'voll' den Standard beschaedigen
    // koennte, und eine Pruefung, die nur die Modus-Zeichenkette liest, sieht davon nichts.
    driverAssistToggleProbe() {
      if (typeof driverAssistAktiv !== 'function') return null;
      const el = $('driver-assist');
      if (!el) return null;
      const merk = { wert: el.value, flag: flagState, formation: raceFormationLap,
                     auto: playerCar,
                     abseits: offtrackAktiv,
                     bytes: playerCar ? playerCar.modeBytes : undefined };
      const stellen = (v) => {
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      try {
        flagState = 'green';
        raceFormationLap = false;
        // ---- EIN FAHRERAUTO MUSS DA SEIN, sonst misst diese Sonde nichts -------
        //
        // Beim ersten Lauf stand hier kein Ersatz, und 'voll' meldete vollGilt=false -
        // richtig gemessen und trotzdem nichtssagend: fahrhilfeVollGilt() liest
        // playerCar.modeBytes, und ohne verbundenes Auto ist playerCar null. Der Test
        // waere in einem Browser ohne Auto immer gruen gewesen und haette genau den
        // Fall nie geprueft, um den es geht.
        //
        // Dieselbe Attrappe wie in spielerOrtProbe, und aus demselben Grund.
        if (!playerCar) {
          playerCar = { role: 'steuern', alias: 'Pruefling', tileCount: 0,
                        tileCode: 0x02, modeBytes: null, ghost: null };
        }
        const je = {};
        for (const modus of ['aus', 'quer', 'voll']) {
          stellen(modus);
          // Mit modeBytes (also: das Auto haelt sich wirklich selbst) UND ohne. Der
          // Unterschied ist der ganze Punkt von fahrhilfeVollGilt().
          const messen = (bytes) => {
            if (playerCar) playerCar.modeBytes = bytes;
            return { aktiv: driverAssistAktiv(),
                     vollGilt: typeof fahrhilfeVollGilt === 'function'
                       ? fahrhilfeVollGilt() : null };
          };
          je[modus] = { mitBytes: messen({ 10: 1, 15: 1 }), ohneBytes: messen(null) };

          // ---- UND DIE ZWEITE ACHSE: liest das Auto ueberhaupt? ------------------
          //
          // BESTELLT: "Wenn das Auto selbst keine Strecke liest und ein Fahrhilfe modus
          // an ist, gib mir die volle Kontrolle."
          //
          // GESETZT WIRD offtrackAktiv DIREKT und nicht ueber offtrackMelden(): die
          // Entprellung braucht offtrackEinMs (ab Werk eine Sekunde) echter Zeit, und ein
          // Prueflauf, der eine Sekunde wartet, wird nicht mehr gestartet. Geprueft wird
          // hier die WIRKUNG des Zustands, nicht die Entprellung - die hat ihren eigenen
          // Test.
          offtrackAktiv = true;
          if (playerCar) playerCar.modeBytes = { 10: 1, 15: 1 };
          je[modus].abseits = {
            // Gehen die modeBytes jetzt noch hinaus? Gefragt wird die Bedingung, die
            // spielerOrtTick stellt - nachgebaut, weil sie dort in einem Zeitgeber steht.
            bytesGehenRaus: trackMode === 'on' && driverAssistAktiv() && !abseitsJetzt(),
            // Und lenkt der Autopilot noch? Das ist die zweite Haelfte der Bestellung.
            apLenkt: (() => {
              const merkFlag = flagState;
              flagState = 'yellow';
              const ap = autopilot(0);
              flagState = merkFlag;
              return ap ? !!ap.lenkt : null;
            })(),
          };
          offtrackAktiv = false;
        }
        // Und die ODER-Haelfte: auf 'aus' gestellt muss der Autopilot trotzdem greifen,
        // wenn eine gelbe Flagge das verlangt.
        stellen('aus');
        if (playerCar) playerCar.modeBytes = null;
        flagState = 'yellow';
        const trotzAus = driverAssistAktiv();
        // MIT Lesung muss er lenken - sonst prueft die Zeile darueber nur, dass er es
        // nie tut, und die ganze Unterscheidung waere leer.
        const apLenktMitLesung = (() => { const ap = autopilot(0);
                                          return ap ? !!ap.lenkt : null; })();
        return {
          je,
          trotzAus,
          apLenktMitLesung,
          modi: FAHRHILFE_MODI.slice(),
          // Steht 'aus' im Markup vorgewaehlt? Das ist die Vorgabe, und sie stammt aus
          // dem Bedienelement - nicht aus einer Zuweisung im Skript.
          vorgabe: [...el.options].filter((o) => o.defaultSelected).map((o) => o.value),
          auswahl: [...el.options].map((o) => o.value),
        };
      } finally {
        stellen(merk.wert);
        if (merk.auto && merk.bytes !== undefined) merk.auto.modeBytes = merk.bytes;
        playerCar = merk.auto;
        flagState = merk.flag;
        raceFormationLap = merk.formation;
        offtrackAktiv = merk.abseits;
      }
    },

    // ---- DIE ORTUNG DES FAHRERAUTOS, mit einer Attrappe ---------------------------
    //
    // Das Fahrerauto bekommt seit v0.5.54 dieselbe Ortung wie ein Ghost und daraus den
    // Drei-Kachel-Vorausblick (Bytes 16-18). Ohne ihn faehrt es im Leitplanken-Modus
    // geradeaus - das war die Meldung "gelbe Flagge klappt noch nicht".
    //
    // MIT EINER ATTRAPPE und nicht mit einem echten Auto: ein verbundenes Fahrzeug gibt es
    // am Schreibtisch nicht, und die Ortung braucht keines - sie braucht einen Kachelzaehler
    // und einen Kachelcode, also genau das, was eine Meldung liefert.
    //
    // MIT `assistAn` STEUERBAR seit der Fahrhilfe (v0.5.55): der Vorausblick geht seither
    // nur hinaus, wenn driverAssistAktiv() wahr ist - von Hand eingeschaltet oder der
    // Autopilot greift. Vorgabe true, damit dieser Prueflauf weiter genau das zeigt, was
    // er zeigen soll (den Vorausblick selbst); false ist die Gegenprobe fuer den gemeldeten
    // Fehler "kann gar nicht mehr lenken, das Auto lenkt von alleine" - trackMode 'on'
    // ALLEIN darf keinen Vorausblick mehr ausloesen.
    spielerOrtProbe(schritte, code, assistAn) {
      const merkPlayer = playerCar;
      const merkTiles = currentTrackTiles;
      const merkMode = trackMode;
      const merkAssist = (typeof fahrhilfeModus !== 'undefined') ? fahrhilfeModus : null;
      const merkFlag = flagState;
      const merkFormation = raceFormationLap;
      try {
        currentTrackTiles = codeToTrack(code || 'SR3GLR2GR2G2').tiles;
        lineCache = null;
        trackMode = 'on';
        // Autopilot ausdruecklich AUS, sonst haengt das Ergebnis am Rennzustand des
        // Prueflaufs und nicht an assistAn - dieselbe Vorsicht wie in
        // driverAssistToggleProbe().
        flagState = 'green';
        raceFormationLap = false;
        // 'quer' und nicht 'voll': diese Sonde prueft den Vorausblick, und der haengt an
        // driverAssistAktiv() - fuer beide gleich. 'quer' ist der Modus, der dem alten
        // eingeschalteten Schalter entspricht, also bleibt die Messung vergleichbar.
        fahrhilfeModus = (assistAn === undefined || assistAn) ? 'quer' : 'aus';
        playerCar = { role: 'steuern', alias: 'Fahrer', tileCount: 0, tileCode: 0x02,
                      modeBytes: null, ghost: null };
        const reihe = [];
        for (let k = 0; k < (schritte || 6); k++) {
          playerCar.tileCount = (playerCar.tileCount + 1) & 0xff;
          const idxVor = playerCar.ghost ? playerCar.ghost.tileIndex : null;
          const naechste = ((idxVor === null ? 0 : idxVor + 1) % currentTrackTiles.length);
          playerCar.tileCode = currentTrackTiles[naechste].type & 0xff;
          spielerOrtTick();
          reihe.push({ tile: playerCar.ghost ? playerCar.ghost.tileIndex : null,
                       bytes: playerCar.modeBytes
                         ? Object.keys(playerCar.modeBytes).map(Number).sort((a, b) => a - b)
                         : null,
                       vorausblick: playerCar.modeBytes
                         ? [16, 17, 18].map((b) => playerCar.modeBytes[b]) : null });
        }
        // Und die Gegenprobe: OHNE Leitplanken-Modus gibt es keinen Vorausblick, auch
        // nicht mit eingeschalteter Fahrhilfe.
        trackMode = 'off';
        spielerOrtTick();
        return { reihe, nurOrt: !!(playerCar.ghost && playerCar.ghost.nurOrt),
                 ohneRail: playerCar.modeBytes };
      } finally {
        playerCar = merkPlayer;
        currentTrackTiles = merkTiles;
        trackMode = merkMode;
        if (merkAssist !== null) fahrhilfeModus = merkAssist;
        flagState = merkFlag;
        raceFormationLap = merkFormation;
        lineCache = null;
      }
    },

    simGas() {
      if (!simAn()) return null;
      return simState.autos.map((a) => {
        const g = a.car.ghost || {};
        return {
          name: a.car.alias,
          zielAnteil: g.lastTarget === undefined ? null : g.lastTarget,
          gas: g.lastThrottle === undefined ? null : g.lastThrottle,
          bremse: g.lastBrake === undefined ? null : g.lastBrake,
          kmh: g.engine ? g.engine.state.speedKmh : null,
          bremsbedarf: ghostBrakeDemand(a.car),
          ortOk: ortStimmt(a.car),
          geparkt: !!a.car.parked,
          kachel: g.tileIndex,
          // Der Boxenstopp, damit er in der Simulation messbar ist und nicht nur sichtbar.
          pit: g.pit ? g.pit.phase : null,
          pitFaellig: g.pitFaellig === undefined ? null : g.pitFaellig,
          laps: g.laps || 0,
        };
      });
    },

    // Die Schlusspruefung, mit Luecke und Winkel - damit eine Pruefung die Toleranz
    // nachrechnen kann, statt sie zu glauben.
    trackSchluss(code) {
      const p = codeToTrack(code || 'SR3G2R3G');
      return Object.assign({ kacheln: p.tiles.length },
                           trackSchluss(trackCenterline(p.tiles)));
    },

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
        // Der Kachelzaehler: die Rollphase endet an ihm und nicht an der Uhr.
        tileCount: 0, tileCode: 0x02,
      };
      // ---- EIN FELD IN DER GARAGE, damit dieses Auto ueberhaupt ausrollt -------------
      //
      // Seit v0.5.51 staffelt finishGhost() in KACHELN und liest dazu die Feldgroesse:
      // der Letzte kommt auf null Kacheln heraus, damit die Reihe hinter der Linie dicht
      // aufschliesst. Mit nur einem Auto in der Garage IST dieses Auto der Letzte - es
      // bremst also sofort, und diese Sonde meldete "keine Ausrollphase".
      //
      // Die Meldung war richtig und die Frage falsch: gemessen werden soll die SEQUENZ,
      // also braucht das Auto einen Platz weiter vorn. Drei Attrappen dahinter geben ihm
      // drei Kacheln.
      const merkGarage = garage.splice(0, garage.length);
      const attrappen = [];
      for (let i = 0; i < 3; i++) {
        attrappen.push({ role: 'ghost', alias: 'X' + i, ghost: { running: false } });
      }
      garage.push(car);
      for (const a of attrappen) garage.push(a);
      finishSeitenZaehlerZuruecksetzen();
      finishGhost(car);
      // Die Kacheln, die es rollen soll, gleich mitzaehlen - die Sonde dreht nur die Uhr
      // zurueck und faehrt nicht wirklich.
      if (car.ghost.finish) {
        car.tileCount = (car.tileCount + (car.ghost.finish.kacheln || 0)) & 0xff;
      }
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
      garage.splice(0, garage.length);
      for (const c of merkGarage) garage.push(c);
      return { reihe, phasen, takte, schritt,
               kopf: LIGHT_HEAD, bremse: LIGHT_BRAKE,
               kacheln: car.ghost.finish ? car.ghost.finish.kacheln : null,
               blinks: FINISH_BLINKS, rollMsMax: FINISH_ROLL_MS_MAX };
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
      // NUR DEN ABSTANDHALTER an: dieser Prueffstand isoliert ihn, und die anderen Zutaten
      // wuerden ihn ueberlagern. Vorher stand hier ein globales ghostCfg.spice = 1, also
      // alle sechs - die Isolierung lief ueber die Eingaben (tight=1, dist=3, hinten
      // fahrend), was funktionierte, aber jede neue Zutat haette sie still gebrochen.
      const spiceVor = { g: ghostCfg.wuerzeAbstand, u: ghostCfg.wuerzeUeberholen,
                         f: ghostCfg.wuerzeForm, e: ghostCfg.wuerzeFehler,
                         w: ghostCfg.wuerzeWindschatten };
      try {
        Object.assign(ghostCfg, WUERZE_AUS, { wuerzeAbstand: true });
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
        ghostCfg.wuerzeAbstand = spiceVor.g; ghostCfg.wuerzeUeberholen = spiceVor.u;
        ghostCfg.wuerzeForm = spiceVor.f; ghostCfg.wuerzeFehler = spiceVor.e;
        ghostCfg.wuerzeWindschatten = spiceVor.w;
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
    // DER DREHZAHLBEREICH KOMMT MIT, seit jeder Motor seinen eigenen hat (v0.5.49,
    // motorDrehzahl() in 80-sound.js). Vorher fegte diese Sonde fest IDLE_RPM bis
    // REDLINE_RPM ab, also 1500 bis 9000 - den Bereich der PHYSIK.
    //
    // Gemessen hat sie damit einen Fall geprueft, den es nicht mehr gibt: der Blazer wird
    // nur bis 5000 gefragt, die Sonde verlangte bei 9000 aber eine Rate von 2,09 und meldete
    // ihn als Anschlagsfehler. Die Zahl war richtig, die Frage war es nicht.
    //
    // Vorgabe bleibt der Physikbereich - fuer einen Motor ohne eigenes Band ist das nach wie
    // vor die Wahrheit.
    sndBandCheck(basenRein, von, bis) {
      const basen = (basenRein || []).slice().sort((a, b) => a - b);
      if (basen.length < 2) return { fehlt: 'weniger als zwei Baender' };
      const rpmVon = von || IDLE_RPM;
      const rpmBis = bis || REDLINE_RPM;
      // DAS MASS IST DIE GEWICHTETE VERSTIMMUNG, nicht "am Anschlag oder nicht". Eine
      // Schleife, die 2,04 statt 2,00 spielen soll, ist zwei Prozent daneben - das hoert
      // niemand. Eine, die 0,36 spielen soll und auf 0,50 geklemmt wird, ist eine halbe
      // Oktave daneben, und DAS war der gemeldete Fehler. Gewichtet mit der Lautstaerke des
      // Bandes, denn eine Verstimmung bei neun Prozent Gewicht ist eine andere Sache als
      // dieselbe bei hundert.
      //
      //   verlangte Rate / geklemmte Rate, in Oktaven, mal Gewicht
      let schlimmst = 0, wo = null;
      for (let rpm = rpmVon; rpm <= rpmBis; rpm += 50) {
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
      return { basen, von: rpmVon, bis: rpmBis,
               verstimmung: +schlimmst.toFixed(4), schlimmste: wo,
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
      // ---- SEIT v0.5.47 IST DAS AUTO EIN RECHTECK UND KEIN KREIS -------------------
      //
      // Gezeichnet wird eine Gruppe mit translate(x y) rotate(w), darin die Karosserie und
      // der Spoiler. Es gibt also kein cx/cy mehr, und diese Sonde suchte weiter nach
      // <circle> - sie fand null Punkte, und vier Tests wurden rot mit der Meldung "kein
      // Punkt bei K0" statt mit "die Sonde liest die alte Form".
      //
      // Gelesen wird der Mittelpunkt aus dem transform und die Farbe aus dem ERSTEN rect:
      // das ist die Karosserie, der zweite ist der Spoiler und immer dunkel.
      const punkte = [...doc.querySelectorAll('g[transform]')].map(g => {
        const m = /translate\(([-\d.]+) ([-\d.]+)\)\s*rotate\(([-\d.]+)\)/
          .exec(g.getAttribute('transform') || '');
        if (!m) return null;
        const body = g.querySelector('rect');
        return { x: +m[1], y: +m[2], winkel: +m[3],
                 fill: body ? body.getAttribute('fill') : null };
      }).filter(Boolean);
      const kuerzel = [...doc.querySelectorAll('text')].map(t => t.textContent);
      return { kacheln: p.tiles.length, punkte, kuerzel, html,
               // Die Randsteinfarben, damit ein Test das CH-Aussehen nachpruefen kann:
               // schwarze Fahrbahn, rot-weiss links, blau-weiss rechts.
               farben: [...new Set([...doc.querySelectorAll('path')]
                 .map(e => e.getAttribute('stroke')).filter(Boolean))],
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
      // Die Wahrscheinlichkeit ist jetzt die Konstante selbst, sofern der Schalter an ist.
      const p = ghostCfg.wuerzeUeberholen ? SPICE_ATTACK_P : 0;
      return { reichweite: SPICE_ATTACK_RANGE,
               abstandMin: SPICE_GAP_MIN,
               // Das Fenster, in dem der Verfolger in Reichweite ist, ohne gelupft zu werden.
               fenster: +(SPICE_ATTACK_RANGE - SPICE_GAP_MIN).toFixed(3),
               klebenMs: SPICE_ATTACK_ARM_MS,
               wurfMs: SPICE_ATTACK_RETRY_MS,
               wuerze: ghostCfg.wuerzeUeberholen ? 1 : 0,
               p: +p.toFixed(4),
               // Erwartete Wartezeit in Sekunden, sobald der Verfolger in Reichweite ist.
               wartenS: p > 0 ? +(SPICE_ATTACK_RETRY_MS / 1000 / p).toFixed(1) : null,
               sperreMs: SPICE_PASS_BLOCK_MS,
               // Die Schwelle bleibt herausgegeben, obwohl der Platz jetzt immer 1 ist:
               // damit eine Pruefung nachrechnen kann, dass 1 sie ueberschreitet - und
               // damit auffaellt, wenn jemand sie ueber 1 setzt.
               platzMin: SPICE_PASS_PLATZ_MIN };
    },

    // ---- SETZT EIN GHOST AM FAHRERAUTO AN, UND AUF WELCHER SEITE? ---------------
    //
    // BESTELLT: "Ghosts sollen auch dem Fahrerauto ausweichen, wenn es langsamer faehrt."
    //
    // Zwei getrennte Fragen, und die Sonde beantwortet beide:
    //
    //   1. WIRD ANGESETZT? ghostAhead() sieht das Fahrerauto seit v0.5.54, weil
    //      ghostFieldRacing() playerCar mitnimmt, sobald es einen Ortungssatz hat. Ob die
    //      Attacke daran aber wirklich scharf wird, stand nie unter Pruefung.
    //   2. AUF WELCHER SEITE? Die Seitenwahl liest querSoll des Vorausfahrenden. Das
    //      Fahrerauto hatte keins - qAnder fiel auf 0 zurueck, und der Angreifer ging
    //      IMMER nach links, auch wenn der Fahrer genau dort fuhr.
    //
    // DER ZUFALL WIRD STILLGELEGT: die Attacke wuerfelt mit SPICE_ATTACK_P. Geprueft wird
    // die ENTSCHEIDUNG, nicht die Wahrscheinlichkeit - ein Prueflauf, der auf einen guten
    // Wurf wartet, ist gelegentlich rot, ohne dass sich etwas geaendert haette.
    spielerUeberholProbe(o) {
      const opt = o || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkSpice = ghostCfg.wuerzeUeberholen;
      const merkPlayer = playerCar;
      const echtNow = Date.now;
      const echtRandom = Math.random;
      try {
        ghostCfg.wuerzeUeberholen = true;
        Math.random = () => 0;          // der Wurf gelingt immer
        let uhr = echtNow.call(Date);
        Date.now = () => uhr;

        // Das Fahrerauto: ein Ortungssatz wie aus spielerOrt(), plus die Querlage, die
        // seit v0.6.7 aus dem Sendeweg kommt.
        const spieler = { role: 'player', alias: 'Fahrer', tileAt: 0, tileCode: 0x02,
          ghost: { nurOrt: true, tilesTotal: 0.5, tileIndex: 0,
                   querSoll: opt.spielerQuer === undefined ? 0.8 : opt.spielerQuer } };
        const jaeger = { role: 'ghost', alias: 'G1', tileAt: 0, tileCode: 0x02,
          ghost: { tilesTotal: 0, tileIndex: 0, form: 0, formAt: uhr, attackUntil: 0,
                   closeSince: 0, mistakeUntil: 0, passPhase: null, passZiel: null,
                   passSince: 0, passBlockUntil: 0, naehern: 0 } };
        playerCar = spieler;
        garage.push(jaeger, spieler);

        const g = jaeger.ghost;
        const reihe = [];
        const phasen = [];
        let scharfBei = null;
        // Lange genug kleben lassen: SPICE_ATTACK_ARM_MS ist 900 ms.
        for (let t = 0; t < (opt.dauerMs || 3000); t += 60) {
          uhr += 60;
          // ---- DAS MANOEVER AUCH ZU ENDE FAHREN ---------------------------------
          //
          // Nach opt.vorbeiNach zieht der Jaeger am Fahrerauto vorbei - der Fortschritt
          // ueberholt den des anderen. Genau daran haengt die Erfolgspruefung "durch",
          // und ohne diesen Schritt liefe jedes Manoever in die Zeitsperre und die
          // Sonde koennte den Unterschied gar nicht zeigen.
          if (scharfBei !== null && opt.vorbeiNach !== undefined
              && t - scharfBei >= opt.vorbeiNach) {
            jaeger.ghost.tilesTotal = spieler.ghost.tilesTotal + 1.0;
          }
          ghostSpice(jaeger, { tight: 0, dist: 99, key: 's' });
          if (g.attackUntil && !reihe.length) {
            scharfBei = t;
            reihe.push({ tMs: t, seite: g.attackSide, phase: g.passPhase,
                         zielIstSpieler: g.passZiel === spieler });
          }
          if (scharfBei !== null) phasen.push(g.passPhase);
        }
        const gesehen = [];
        for (const p of phasen) if (p && gesehen[gesehen.length - 1] !== p) gesehen.push(p);
        return { angesetzt: !!reihe.length,
                 phasenfolge: gesehen,
                 ersterVersuch: reihe[0] || null,
                 sieht: (function () {
                   const ah = ghostAhead(jaeger);
                   return ah ? { wer: ah.car.alias, abstand: +ah.gap.toFixed(3) } : null;
                 }()) };
      } finally {
        Date.now = echtNow;
        Math.random = echtRandom;
        ghostCfg.wuerzeUeberholen = merkSpice;
        playerCar = merkPlayer;
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
      }
    },

    ghostPassProbe(o) {
      const opt = o || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkSpice = ghostCfg.wuerzeUeberholen;
      const echtNow = Date.now;
      try {
        ghostCfg.wuerzeUeberholen = true;
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
        // MIT ODER OHNE ANSAGE. Ohne sie steigt der Lauf bei 'raus' ein, wie bisher - so
        // bleiben die vorhandenen Pruefungen unberuehrt. Mit ihr faengt er dort an, wo ein
        // gewuerfelter Angriff wirklich anfaengt, und damit ist die Lichthupe pruefbar.
        if (opt.mitAnsage) {
          g.passPhase = 'ansage';
          g.ansageSeit = uhr;
        } else {
          g.passPhase = 'raus';
        }
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
          // DEN LICHTMERKER SETZEN. Diese Sonde ruft ghostSpice() direkt und nicht
          // ghostTick(), und gesetzt wird er dort - also hier von Hand, mit der gefaelschten
          // Uhr dieses Laufs. Ohne diese Zeile blieb g.hupt falsch und die Sonde meldete
          // null Impulse, obwohl die Ansage lief.
          if (typeof ghostHupeSetzen === 'function') ghostHupeSetzen(g, uhr);
          reihe.push({ t, phase: g.passPhase || '-', versatz: +(r.attack || 0).toFixed(3),
                       faktor: +r.factor.toFixed(4), laeuft: !!g.attackUntil,
                       // Ist das Licht in diesem Takt AUS? Das IST die Lichthupe - ein
                       // Scheinwerfer-Bit, Licht an im Normalfall, also ein kurzes Aus.
                       dunkel: typeof ghostHupt === 'function' ? ghostHupt(hinten) : null });
          if (!g.attackUntil && t > (opt.ueberholtNach || 0)) break;
        }
        return { reihe, gesperrtBis: g.passBlockUntil ? g.passBlockUntil - uhr : 0,
                 phasen: [...new Set(reihe.map(x => x.phase))],
                 // Die Phasenfolge in ihrer Reihenfolge - 'phasen' ist eine Menge und sagt
                 // ueber die Ordnung nichts, und bei einer Ansage VOR dem Ausschwenken ist
                 // genau die Ordnung die Zusage.
                 folge: reihe.reduce((a, x) =>
                   (a[a.length - 1] === x.phase ? a : a.concat(x.phase)), []),
                 // Die Impulse der Lichthupe: Flanken von hell auf dunkel.
                 impulse: reihe.reduce((n, x, i) =>
                   n + ((x.dunkel && !(reihe[i - 1] || {}).dunkel) ? 1 : 0), 0),
                 dunkelTakte: reihe.filter((x) => x.dunkel).length,
                 // Und wann die Ansage endete, damit ein Test die Dauer nachrechnen kann.
                 ansageMs: typeof SPICE_ANSAGE_MS === 'number' ? SPICE_ANSAGE_MS : null };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach(c => garage.push(c));
        ghostCfg.wuerzeUeberholen = merkSpice;
      }
    },

    // ---- Setzt ein Ghost auf einer Kurvenkachel zum Ueberholen an? -------------
    //
    // Soll er NICHT. Der Vorausblick verbietet es schon, aber den gibt es nur mit Karte -
    // ohne Karte war er immer "frei", und dann wurde mitten in einer Haarnadel angesetzt.
    // Geprueft wird ueber den gemeldeten Code der Kachel UNTER dem Auto, der keine Karte
    // braucht.
    // ---- DIE SONDE VARIIERT JETZT DEN PLATZ, NICHT NUR DEN KACHELCODE ---------------
    //
    // Bis v0.5.43 war die Zuendbedingung eine Funktion des Kachelcodes: auf einer Kurve nie.
    // Seit sie am freien PLATZ haengt (1 minus Linienversatz), misst ein Lauf, der nur den
    // Code aendert, gar nichts mehr - gemessen kamen Gerade 40, Kurve 35, Haarnadel 34
    // Versuche heraus, weil die Attrappe ohne kurveMix und ohne Kachelindex ueberall
    // denselben Platz hatte. Eine Sonde, die die gepruefte Groesse nicht bewegt, ist gruen
    // und wertlos.
    //
    // opt: { tileIndex, kurveMix, tight, dist }
    // ---- Zieleinlauf: welche Seite, wie lange, und was geht hinaus ------------------
    //
    // finishGhost() teilt die Seite zu, ghostFinishTick() schreibt sie. Der Haken faengt den
    // AUSGEHENDEN Lenkwert ab, statt ihn aus der Zuteilung zu erschliessen - genau das war
    // der Fehler des frueheren Anlaufs, bei dem die Seite zugeteilt war und beim Schreiben
    // nicht ankam.
    // Eine Attrappe mit einem ECHTEN Ghost-Zustand: startGhost() legt ihn an, damit die
    // Attrappe kein handgepflegtes Abbild des Literals ist. Ein Abbild veraltet genau dann,
    // wenn dem Literal ein Feld zuwaechst.
    attrappeGhost(alias) {
      const car = { role: 'ghost', alias: alias || 'A', tileCode: 0x02, tileCount: 0,
                    tileAt: Date.now(), lastCodeAt: Date.now(),
                    testSenke: [], device: { name: alias || 'A', id: 'attrappe-' + alias } };
      startGhost(car);
      if (car.timer) { clearInterval(car.timer); car.timer = null; }
      return car;
    },

    // ---- WER ROLLT WIE WEIT AUS? Die Reihenfolge der Ziellinie ------------------
    //
    // GEMELDET: "Ende des Rennens Ghosts anhalten: nicht der Platz soll bestimmen, wie weit
    // die Autos vorm Anhalten am Rand rollen, sondern die Reihenfolge, mit der sie
    // Start/Ziel passieren."
    //
    // Der Prueflauf stellt genau die Lage her, in der es schiefging: ein Feld, in dem
    // EINIGE AUTOS STEHEN. Am Rennende laeuft garage.forEach in Garagenreihenfolge und ruft
    // finishGhost fuer alle, die nicht auslaufen - die Stehenden also zuerst. Vorher nahmen
    // sie damit die vorderen Staffelplaetze, und das erste wirklich ueberfahrende Auto fand
    // sie belegt vor.
    //
    // Die Reihenfolge der Aufrufe hier ist deshalb dieselbe wie im Rennen: erst die
    // Stehenden, dann die Fahrenden.
    zieleinlaufFolgeProbe(o) {
      const opt = o || {};
      const merkGarage = garage.splice(0, garage.length);
      try {
        const geparkt = opt.geparkt || [true, false, false, true, false];
        const autos = geparkt.map((p, i) => ({
          role: 'ghost', alias: 'F' + i, tileCode: 0x02, tileCount: 0,
          parked: p ? 'Prueflauf' : null, testSenke: [],
          ghost: { tileIndex: 0, engine: null },
        }));
        for (const c of autos) garage.push(c);
        const stehende = autos.filter((c) => c.parked);
        const fahrende = autos.filter((c) => !c.parked);
        finishSeitenZaehlerZuruecksetzen(fahrende.length);
        for (const c of stehende) finishGhost(c);
        for (const c of fahrende) finishGhost(c);
        const lies = (c) => ({ alias: c.alias,
                               kacheln: c.ghost.finish ? c.ghost.finish.kacheln : null });
        return { rollende: fahrende.length,
                 stehende: stehende.map(lies), fahrende: fahrende.map(lies) };
      } finally {
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
        finishSeitenZaehlerZuruecksetzen();
      }
    },

    finishSeiten(n) {
      const merkGarage = garage.splice(0, garage.length);
      const echtNow = Date.now;
      try {
        finishSeitenZaehlerZuruecksetzen();
        const raus = [];
        // ---- ERST DAS GANZE FELD AUFSTELLEN, DANN EINLAUFEN LASSEN ------------------
        //
        // Seit die Staffel in Kacheln rechnet, liest finishGhost() die FELDGROESSE aus der
        // Garage: der Letzte soll auf null Kacheln herauskommen. Der erste Anlauf dieser
        // Sonde schob die Autos einzeln hinein und rief finishGhost() gleich danach - die
        // Garage hatte dann bei jedem Auto genau ein Auto mehr, und jedes bekam null
        // Kacheln. Die Sonde haette damit die Staffel geprueft, die sie selbst kaputt macht.
        const zahl = n || 4;
        const autos = [];
        for (let i = 0; i < zahl; i++) {
          const gesendet = [];
          autos.push({ role: 'ghost', alias: 'F' + i, tileCode: 0x02,
                       tileCount: 0, testSenke: gesendet,
                       ghost: { tileIndex: 0, engine: null } });
        }
        for (const c of autos) garage.push(c);
        for (const car of autos) {
          const gesendet = car.testSenke;
          finishGhost(car);
          const f = car.ghost.finish;
          let uhr = echtNow();
          Date.now = () => uhr;
          const holen = () => {
            gesendet.length = 0;
            ghostFinishTick(car);
            return gesendet.length ? gesendet[gesendet.length - 1].steer : null;
          };
          const steerRoll = holen();
          // DIE KACHELN WEITERZAEHLEN, wie es die Meldungen taeten - die Rollphase endet
          // an einem Zaehlerstand UND an einer Mindestzeit.
          car.tileCount = (car.tileCount + (f.kacheln || 0)) & 0xff;
          // UND DIE UHR UEBER DIE MINDESTROLLZEIT. FINISH_ROLL_MS_MIN gibt dem Ausschwenken
          // seine Dauer - ohne sie haelt das Auto in der Mitte, und das war die Meldung
          // "die Autos parken mitten auf der Bahn". Eine Sonde, die nur 50 ms weiterdreht,
          // prueft die Staffel in einer Phase, die noch laeuft.
          uhr += FINISH_ROLL_MS_MIN + 50;
          ghostFinishTick(car);                  // Phasenwechsel auf 'brake'
          const steerBrake = holen();
          Date.now = echtNow;
          raus.push({ seite: f.seite, kacheln: f.kacheln, steerRoll, steerBrake,
                      phase: car.ghost.finish ? car.ghost.finish.phase : null });
        }
        return raus;
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        for (const c of merkGarage) garage.push(c);
      }
    },

    // ---- DER GHOST-BOXENSTOPP, ohne Hardware und ohne Wartezeit --------------------
    //
    // Gefahren wird mit gefaelschter Uhr durch ghostTick(), also durch den ECHTEN Pfad -
    // nicht durch eine Nachbildung der Zustandsmaschine. Der Unterschied ist der Punkt: die
    // Pruefung, um die es hier geht ("wird waehrend des Stopps nicht geparkt"), haengt am
    // Abgangsmelder, und den gibt es nur im echten Takt.
    //
    // Die Attrappen melden 0x00 als Kachelcode, sobald sie stehen - genau das tut ein Auto,
    // das die Bahn nicht mehr liest, und genau daran haengt der Melder.
    // ---- Der Tempofaktor, alle vier Faelle ------------------------------------------
    //
    // OHNE AUTO UND OHNE UHR: der Faktor haengt nur an Wetter und Reifen, und eine Sonde,
    // die dafuer eine Simulation braucht, prueft die Simulation mit.
    //
    // Der Nassanteil wird ueber wxSet gestellt, weil ghostReifenTempo() ihn ueber
    // wxRainLevel() quadratisch liest - der Faktor bei halber Front ist ein anderer als bei
    // voller, und genau das soll pruefbar sein.
    reifenTempoProbe(nassFront, opt) {
      if (typeof ghostReifenTempo !== 'function') return null;
      const o = opt || {};
      const merkW = weather, merkF = wxFront, merkTo = wxFrontTo;
      const merkAn = ghostCfg.pitAn;
      try {
        // pitAn AN, sonst gilt ueberall der passende Reifen (reifenWechselMoeglich) und die
        // Sonde messe genau den Fall nicht, um den es geht. Mit pitAn: false ist das die
        // Gegenprobe - dann MUSS ueberall 1,0 bzw. 0,85 herauskommen.
        ghostCfg.pitAn = o.pitAn === undefined ? true : !!o.pitAn;
        const aus = {};
        for (const wetter of ['dry', 'rain']) {
          setWeather(wetter);
          // Die Front ganz durchziehen, sonst misst man einen Zwischenwert der Rampe.
          this.wxSet(nassFront === undefined ? (wetter === 'rain' ? 0 : -1) : nassFront);
          for (const reifen of ['trocken', 'regen']) {
            // Ein Auto und kein Ghost: der gefahrene Reifen haengt an den Schaltern, und die
            // liest reifenGefahren() ueber das Auto.
            aus[wetter + '/' + reifen] =
              +ghostReifenTempo({ ghost: { reifen } }).toFixed(4);
          }
        }
        return { faktor: aus, nass: +(wxRainLevel() * wxRainLevel()).toFixed(4) };
      } finally {
        ghostCfg.pitAn = merkAn;
        setWeather(merkW);
        wxFront = merkF; wxFrontTo = merkTo;
        if (typeof applySurface === 'function') applySurface();
      }
    },

    // ---- Die Oberflaeche im Ghost-Motor ---------------------------------------------
    //
    // Getrennt vom Tempofaktor, weil es zwei Aussagen sind: der Faktor ist das ZIEL des
    // Reglers, die Oberflaeche ist das, womit der Motor bremst und anfaehrt. Ein Fehler in
    // einem der beiden waere im anderen nicht zu sehen.
    reifenGriffProbe() {
      if (typeof ghostOberflaecheSetzen !== 'function') return null;
      const merkW = weather, merkF = wxFront, merkTo = wxFrontTo;
      const merkAn = ghostCfg.pitAn;
      try {
        ghostCfg.pitAn = true;
        const aus = {};
        for (const wetter of ['dry', 'rain']) {
          setWeather(wetter);
          this.wxSet(wetter === 'rain' ? 0 : -1);
          for (const reifen of ['trocken', 'regen']) {
            const car = { ghost: { reifen, engine: { config: {} } } };
            ghostOberflaecheSetzen(car);
            const c = car.ghost.engine.config;
            aus[wetter + '/' + reifen] = { grip: +c.gripScale.toFixed(4),
                                           aqua: +c.aquaplaning.toFixed(4) };
          }
        }
        return aus;
      } finally {
        ghostCfg.pitAn = merkAn;
        setWeather(merkW);
        wxFront = merkF; wxFrontTo = merkTo;
        if (typeof applySurface === 'function') applySurface();
      }
    },

    // ---- Der ganze Ablauf: Wetterwechsel, Warteschlange, Umruestung -----------------
    //
    // Derselbe Aufbau wie ghostPitProbe, aber mit zwei Unterschieden, und beide sind der
    // Zweck: das Wetter wechselt MITTEN im Lauf, und keiner der Ghosts ist planmaessig
    // faellig. Was danach passiert, kann also nur an den Reifen liegen.
    //
    // Und die Autos stehen auf VERSCHIEDENEN Kacheln: stellte man alle auf die letzte vor
    // der Box, kaeme die Warteschlange nie zustande - alle waeren im selben Takt an der
    // Einfahrt, einer bekaeme sie, und die anderen haetten ihre Gelegenheit fuer diese Runde
    // verpasst, ohne je eine gehabt zu haben. Ein Feld verteilt sich ueber die Strecke, und
    // genau das ist der Fall, den die Schlange bedienen muss.
    ghostReifenProbe(opt) {
      const o = opt || {};
      if (typeof ghostReifenTempo !== 'function') return null;
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkCfg = { an: ghostCfg.pitAn, frei: ghostCfg.pitFrei, sek: ghostCfg.pitSek,
                        lo: ghostCfg.pitRundenMin, hi: ghostCfg.pitRundenMax };
      const merkFlag = flagState;
      const merkW = weather, merkF = wxFront, merkTo = wxFrontTo;
      const echtNow = Date.now;
      try {
        currentTrackTiles = codeToTrack(o.code || 'SR3GLR2GR2G2').tiles;
        lineCache = null;
        ghostCfg.pitAn = true;
        ghostCfg.pitFrei = true;
        ghostCfg.pitSek = o.laenge === undefined ? 5 : o.laenge;
        // WEIT AUSSERHALB DER LAUFZEIT: kein Ghost darf planmaessig faellig werden, sonst
        // liesse sich ein Reifenstopp nicht von einem Planstopp unterscheiden.
        ghostCfg.pitRundenMin = 200;
        ghostCfg.pitRundenMax = 200;
        flagState = 'green';
        setWeather('dry');
        this.wxSet(-1);
        const n = currentTrackTiles.length;
        let uhr = echtNow();
        Date.now = () => uhr;
        const zahl = o.autos || 3;
        const autos = [];
        for (let i = 0; i < zahl; i++) {
          const car = OMEGA_TEST.attrappeGhost('R' + i);
          car.ghost.laps = 1;
          car.ghost.pitFaellig = 500;          // planmaessig nie in diesem Lauf
          car.ghost.freeRun = true;
          car.ghost.reifen = 'trocken';
          // Gleichmaessig ueber die Strecke verteilt, siehe oben.
          car.ghost.tileIndex = Math.floor(i * n / zahl);
          car.ghost.lastCount = 0;
          car.tileCount = 0;
          car.tileCode = 0x02;
          car.lastCodeAt = uhr;
          car.tileAt = uhr;
          car.ghost.tileStart = uhr;
          car.ghost.tileRing = [400, 400, 400];
          autos.push(car);
          garage.push(car);
        }
        const takte = o.takte || 2000;
        const wechselBei = o.wechselBei === undefined ? 100 : o.wechselBei;
        const spur = [];
        let gewechselt = -1;
        for (let t = 0; t < takte; t++) {
          uhr += 45;
          if (t === wechselBei) {
            setWeather('rain');
            this.wxSet(0);                     // die Front sofort durch, wie wxSet erklaert
            gewechselt = t;
          }
          if (o.zurueckBei !== undefined && t === o.zurueckBei) {
            setWeather('dry');
            this.wxSet(-1);
          }
          for (const car of autos) {
            const g = car.ghost;
            const v = g.engine ? Math.abs(g.engine.state.speedKmh || 0) : 0;
            if (v > 0.05 && uhr - g.tileStart > 400) {
              car.tileCount = (car.tileCount + 1) & 0xff;
              car.tileAt = uhr;
              const naechste = (g.tileIndex === null ? 0 : g.tileIndex + 1) % n;
              car.tileCode = currentTrackTiles[naechste].type & 0xff;
              car.lastCodeAt = uhr;
            } else if (v <= 0.05) {
              car.tileCode = 0x00;             // steht: liest nichts mehr
            }
            ghostTick(car);
          }
          spur.push({ t,
            reifen: autos.map((c) => c.ghost.reifen),
            phase: autos.map((c) => (c.ghost.pit ? c.ghost.pit.phase : null)),
            grund: autos.map((c) => (c.ghost.pit ? c.ghost.pit.grund : null)),
            faktor: autos.map((c) => +ghostReifenTempo(c).toFixed(4)),
            grip: autos.map((c) => (c.ghost.engine
              ? +(c.ghost.engine.config.gripScale || 0).toFixed(4) : null)),
            // Der belegte Platz und die Querlage: mit mehreren Boxen ist "wer stand wo"
            // die Frage, und "haelt der Vorbeifahrende den Gegenrand" die zweite.
            platz: autos.map((c) => (c.ghost.pit ? c.ghost.pit.platz : null)),
            quer: autos.map((c) => +(c.ghost.querSoll || 0).toFixed(3)),
            // DER BEFEHL, getrennt von der gefilterten Lage. g.querSoll ist ein
            // nachlaufender Filter (querTempo, rund 0,5 s fuer die volle Breite): kommt ein
            // Auto von seiner Ideallinie rechts in die Gasse, steht dort einige Takte lang
            // ein positiver Wert, obwohl der Befehl schon negativ ist. Ein Kriterium auf dem
            // Filter wuerde also die Traegheit pruefen und nicht die Logik - der Befehl ist
            // die Zusage, der Filter ihre Physik.
            befehl: autos.map((c) => {
              const q = pitQuer(c);
              return q === null ? null : +q.toFixed(3);
            }),
            // Steht das Auto schon an SEINER Box? Dann faehrt es an keinem vorbei, auch
            // wenn vor ihm einer steht - es ist angekommen.
            //
            // DER FEHLER, DEN DAS BEHEBT, war in dieser Messung und nicht im Fahrzeug: die
            // erste Fassung zaehlte jedes Auto in der Box, vor dem ein anderes stand, als
            // "muss vorbei". Damit meldete sie 27 Takte mit rechtem Befehl beim
            // Vorbeifahren - und richtig war, dass 27 Takte lang ein Auto an seiner eigenen
            // Box stand, wo der rechte Rand genau das Richtige ist. Zwei falsche Messungen
            // in Folge an derselben Sonde; die Zahl war jedes Mal glaubhaft.
            amPlatz: autos.map((c) => {
              const p = c.ghost.pit;
              return !!p && c.ghost.tileIndex === pitKachelFuer(p.platz);
            }),
            geparkt: autos.map((c) => !!c.parked) });
        }
        // ---- Auswerten -------------------------------------------------------------
        // Wann hatte welches Auto welche Reifen, und wie viele standen je Takt in der Box?
        const umbauBei = autos.map(() => null);
        const stoppGrund = autos.map(() => []);
        const grundZuvor = autos.map(() => null);
        let mehrfach = 0, geparkt = false;
        let falschTakte = autos.map(() => 0);
        // ---- DIE GASSE: wer stand auf welchem Platz, und wich der Vorbeifahrende aus? --
        const plaetzeJe = autos.map(() => ({}));
        let doppeltBelegt = 0;      // zwei Autos auf DEMSELBEN Platz - waere der Bruch
        let hoechstGleich = 0;      // wieviele gleichzeitig in der Box
        // Wer an einem STEHENDEN vorbei musste: hielt er den Gegenrand?
        let vorbeiTakte = 0, vorbeiRechts = 0;
        // Der BEFEHL beim Vorbeifahren, und wie weit rechts der Filter dabei hoechstens
        // noch stand. Das erste muss null sein (Logik), das zweite ist ein Mass (Physik).
        let vorbeiBefehlRechts = 0, vorbeiQuerMax = 0;
        for (const s of spur) {
          const inBox = s.phase.filter((p) => p).length;
          if (inBox > 1) mehrfach++;
          if (inBox > hoechstGleich) hoechstGleich = inBox;
          // Doppelbelegung: zwei Autos, die STEHEN, auf derselben Platznummer.
          const stehend = {};
          for (let i = 0; i < autos.length; i++) {
            if (s.phase[i] === 'halt' || s.phase[i] === 'stand') {
              const pl = s.platz[i];
              if (stehend[pl] !== undefined) doppeltBelegt++;
              stehend[pl] = i;
            }
            if (s.platz[i] !== null && s.platz[i] !== undefined) {
              plaetzeJe[i][s.platz[i]] = true;
            }
          }
          // Und die Vorbeifahrt: ein Auto in der Box, dessen Platz HINTER einem stehenden
          // liegt, und das nicht selbst schon dort ist.
          for (let i = 0; i < autos.length; i++) {
            if (!s.phase[i]) continue;
            // An der eigenen Box angekommen: kein Vorbeifahren mehr, siehe amPlatz.
            if (s.amPlatz[i]) continue;
            const meins = s.platz[i];
            let musstVorbei = false;
            for (const pl of Object.keys(stehend)) {
              if (+stehend[pl] === i) continue;
              if (s.phase[i] === 'raus' ? +pl > meins : +pl < meins) musstVorbei = true;
            }
            if (!musstVorbei) continue;
            vorbeiTakte++;
            if (s.befehl[i] !== null && s.befehl[i] > 0) vorbeiBefehlRechts++;
            if (s.quer[i] > 0) {
              vorbeiRechts++;
              if (s.quer[i] > vorbeiQuerMax) vorbeiQuerMax = s.quer[i];
            }
          }
          if (s.geparkt.some((x) => x)) geparkt = true;
          for (let i = 0; i < autos.length; i++) {
            if (s.reifen[i] === 'regen' && umbauBei[i] === null && s.t >= gewechselt) {
              umbauBei[i] = s.t;
            }
            if (s.t > gewechselt && s.reifen[i] === 'trocken') falschTakte[i]++;
            // DIE FLANKE, nicht der Wechsel des Grundes. Der erste Anlauf verglich mit
            // dem letzten GEMERKTEN Grund - zwei Stopps hintereinander mit demselben Grund
            // ergaben damit einen Eintrag, und ein Lauf mit einem Wechsel hin und einem
            // zurueck sah aus wie ein einzelner Stopp. Gemessen: der Rueckweg auf trocken
            // war an faktorEnde 1,0 zu sehen und an stoppGrund nicht.
            const gr = s.grund[i];
            if (gr && !grundZuvor[i]) stoppGrund[i].push(gr);
            grundZuvor[i] = gr;
          }
        }
        return {
          gewechselt,
          takte,
          // In welchem Takt hatte jedes Auto die Regenreifen drauf? null = nie.
          umbauBei,
          // Und wie lange fuhr es mit den falschen? In Takten von 45 ms.
          falschTakte,
          falschSek: falschTakte.map((x) => +(x * 0.045).toFixed(1)),
          // Der Grund jedes Stopps je Auto - 'reifen' erwartet, 'plan' waere ein Fehler.
          stoppGrund,
          // Zwei Autos gleichzeitig in der Box waere der Bruch der Zusage.
          mehrfach,
          geparkt,
          // ---- Die Gasse -----------------------------------------------------------
          // Welche Plaetze hat jedes Auto im Lauf belegt?
          plaetze: plaetzeJe.map((o) => Object.keys(o).map(Number).sort()),
          // Zwei Autos auf demselben Platz waeren der Bruch der Zusage.
          doppeltBelegt,
          // Wieviele standen hoechstens gleichzeitig in der Box? 1 waere die alte Regel.
          hoechstGleich,
          // Wie oft musste einer an einem stehenden vorbei, und wie oft hielt er dabei
          // trotzdem den rechten Rand? Das zweite MUSS null sein - sonst rammt er.
          vorbeiTakte, vorbeiRechts,
          // Der Befehl. MUSS null sein - ein positiver Befehl beim Vorbeifahren waere die
          // Anweisung, dem Stehenden ins Heck zu fahren.
          vorbeiBefehlRechts,
          // Und wie weit rechts der nachlaufende Filter dabei noch stand, als Mass.
          vorbeiQuerMax: +vorbeiQuerMax.toFixed(3),
          // Der Faktor gegen Ende, als Beleg, dass die Drosselung wieder weg ist.
          faktorEnde: spur[spur.length - 1].faktor,
          gripEnde: spur[spur.length - 1].grip,
          // Und der schlechteste Faktor je Auto - die Drosselung, waehrend es falsch stand.
          faktorMin: autos.map((_, i) =>
            Math.min.apply(null, spur.map((s) => s.faktor[i]))),
        };
      } finally {
        Date.now = echtNow;
        for (const c of garage.slice()) { try { stopGhost(c); } catch (e) {} }
        garage.splice(0, garage.length);
        for (const c of merkGarage) garage.push(c);
        currentTrackTiles = merkTiles;
        lineCache = null;
        ghostCfg.pitAn = merkCfg.an; ghostCfg.pitFrei = merkCfg.frei;
        ghostCfg.pitSek = merkCfg.sek;
        ghostCfg.pitRundenMin = merkCfg.lo; ghostCfg.pitRundenMax = merkCfg.hi;
        flagState = merkFlag;
        setWeather(merkW);
        wxFront = merkF; wxFrontTo = merkTo;
        if (typeof applySurface === 'function') applySurface();
        // Den Boxenplatz freigeben - eine Sonde, die ihn hier liegen laesst, blockiert
        // jeden spaeteren Stopp. Genau dieser Fehler hat in dieser Sitzung schon 41 Runden
        // ohne einen einzigen Stopp erzeugt.
        if (OMEGA_TEST.pitInhaberSetzen) OMEGA_TEST.pitInhaberSetzen(null);
      }
    },

    // ---- BLINKT DAS AUTO DES FAHRERS IM BOXENMODUS? -----------------------------
    //
    // BESTELLT: "Beim Pit-Modus sowohl bei gesteuertem Auto als auch NPC Lichter passend
    // blinken lassen."
    //
    // Geprueft wird ueber resolveLights() - dieselbe Funktion, die im Fahrtakt die Lichter
    // des Fahrerautos zusammensetzt. Ein Prueflauf, der das Muster selbst nachrechnet,
    // prueefte seine eigene Kopie und nicht die Verdrahtung.
    //
    // MIT GEFAELSCHTER UHR ueber eine volle Periode des Doppelblitzes (2 x 90 an, 2 x 90
    // aus, 420 Pause = 780 ms), damit "es blinkt" nicht vom zufaelligen Moment des Aufrufs
    // abhaengt, in dem der Prueflauf gerade laeuft.
    spielerPitLichtProbe(o) {
      const opt = o || {};
      if (typeof resolveLights !== 'function') return null;
      const merk = { ps: pitState, fx: Object.assign({}, lightFx) };
      const echteNow = Date.now;
      let uhr = echteNow.call(Date);
      try {
        Date.now = () => uhr;
        // Keine anderen Lichtgruende: Lichthupe, Schaden und Tank schlagen den Boxenmodus
        // absichtlich - der Prueflauf soll aber den Boxenmodus sehen.
        lightFx.flashUntil = 0; lightFx.damage = false;
        lightFx.fuel = false; lightFx.rain = false;
        const lauf = (zustand) => {
          pitState = zustand;
          const reihe = [];
          for (let t = 0; t < (opt.dauerMs || 1600); t += 20) {
            uhr += 20;
            reihe.push(resolveLights(true, false).head);
          }
          return reihe;
        };
        const aus = lauf('off');
        const limited = lauf('limited');
        const servicing = lauf('servicing');
        const wechsel = (r) => r.filter((v, i) => i && v !== r[i - 1]).length;
        return {
          aus: { wechsel: wechsel(aus), anAnteil: +(aus.filter(Boolean).length / aus.length).toFixed(3) },
          limited: { wechsel: wechsel(limited),
                     anAnteil: +(limited.filter(Boolean).length / limited.length).toFixed(3) },
          servicing: { wechsel: wechsel(servicing),
                       anAnteil: +(servicing.filter(Boolean).length / servicing.length).toFixed(3) },
        };
      } finally {
        Date.now = echteNow;
        pitState = merk.ps;
        Object.assign(lightFx, merk.fx);
      }
    },

    // Die Boxenbremse von aussen ablesbar machen - die Sonde zeichnet sie je Takt auf.
    pitBremseLesen(car) {
      return typeof pitBremse === 'function' ? pitBremse(car) : null;
    },

    ghostPitProbe(opt) {
      const o = opt || {};
      const merkGarage = garage.splice(0, garage.length);
      const merkTiles = currentTrackTiles;
      const merkCfg = { an: ghostCfg.pitAn, frei: ghostCfg.pitFrei, sek: ghostCfg.pitSek,
                        lo: ghostCfg.pitRundenMin, hi: ghostCfg.pitRundenMax };
      const merkFlag = flagState;
      const echtNow = Date.now;
      try {
        currentTrackTiles = codeToTrack(o.code || 'SR3GLR2GR2G2').tiles;
        lineCache = null;
        ghostCfg.pitAn = true;
        ghostCfg.pitFrei = true;
        ghostCfg.pitSek = o.laenge === undefined ? 10 : o.laenge;
        flagState = 'green';
        const n = currentTrackTiles.length;
        let uhr = echtNow();
        Date.now = () => uhr;
        // So viele Autos wie bestellt, alle faellig.
        const autos = [];
        for (let i = 0; i < (o.autos || 1); i++) {
          const car = OMEGA_TEST.attrappeGhost('P' + i);
          // nurEiner: die anderen sind NICHT faellig. Gebraucht seit die Boxengasse mehrere
          // Plaetze hat - sonst pitten alle drei, und dann gibt es keine Umstehenden mehr,
          // an denen das Ausweichen zu pruefen waere.
          car.ghost.pitFaellig = (o.nurEiner && i > 0) ? 500 : 0;
          car.ghost.laps = 9;
          car.ghost.freeRun = true;
          // Auf die letzte Kachel vor Start/Ziel stellen. Start/Ziel ist Kachel 0, also ist
          // die letzte die mit dem hoechsten Index.
          car.ghost.tileIndex = n - 1;
          car.ghost.lastCount = 0;
          car.tileCount = 0;
          car.tileCode = 0x02;
          car.lastCodeAt = uhr;
          car.tileAt = uhr;
          car.ghost.tileStart = uhr;
          car.ghost.tileRing = [400, 400, 400];
          autos.push(car);
          garage.push(car);
        }
        const spur = [];
        const takte = o.takte || 600;
        for (let t = 0; t < takte; t++) {
          uhr += 45;
          for (const car of autos) {
            const g = car.ghost;
            // Kachelwechsel nachstellen: solange das Auto faehrt, zaehlt der Zaehler weiter.
            const v = g.engine ? Math.abs(g.engine.state.speedKmh || 0) : 0;
            if (v > 0.05 && uhr - g.tileStart > 400) {
              car.tileCount = (car.tileCount + 1) & 0xff;
              car.tileAt = uhr;
              // Der gemeldete Code der Kachel, auf die er wechselt.
              const naechste = (g.tileIndex === null ? 0 : g.tileIndex + 1) % n;
              car.tileCode = currentTrackTiles[naechste].type & 0xff;
              car.lastCodeAt = uhr;
            } else if (v <= 0.05) {
              // STEHT: kein Muster mehr, also 0x00. Das ist der Fall, um den es geht.
              car.tileCode = 0x00;
            }
            ghostTick(car);
          }
          // ---- WAS DIE ANDEREN TUN, WAEHREND DIE SPERRE GILT --------------------------
          //
          // Der Endwert taugt dafuer nicht: nach dem Stopp stehen die anderen wieder auf
          // ihrer Linie, und gemessen ist das +0,099 - ein Wert, der nichts ueber die Sperre
          // sagt. Was zaehlt, ist ihre GROESSTE Querlage in den Takten, in denen
          // pitSperreRechts() fuer sie wahr war.
          for (let i = 1; i < autos.length; i++) {
            const c = autos[i];
            if (!OMEGA_TEST.pitSperreRechts(c)) continue;
            c._sperreTakte = (c._sperreTakte || 0) + 1;
            const q = c.ghost.querSoll || 0;
            if (c._sperreMax === undefined || q > c._sperreMax) c._sperreMax = q;
          }
          const g0 = autos[0].ghost;
          spur.push({ t, phase: g0.pit ? g0.pit.phase : null,
                      quer: +(g0.querSoll || 0).toFixed(3),
                      kmh: g0.engine ? +(g0.engine.state.speedKmh || 0).toFixed(3) : null,
                      geparkt: !!autos[0].parked,
                      // Das Blinken und die Bremse MIT aufzeichnen: beides ist bestellt
                      // ("Lichter waehrend der 1s und dem Stopp", "nicht direkt auf 0"),
                      // und beides ist nur waehrend des Laufs sichtbar - am Ende steht
                      // nichts mehr davon da.
                      blink: !!g0.pitBlink,
                      bremse: (function () {
                        const b = OMEGA_TEST.pitBremseLesen
                          ? OMEGA_TEST.pitBremseLesen(autos[0]) : null;
                        return b === null ? null : +b.toFixed(3);
                      }()),
                      inhaber: autos.findIndex((c) => c.ghost.pit) });
        }
        // Zusammenfassung: die Phasenfolge, die Querlage je Phase, und ob geparkt wurde.
        const folge = [];
        const querJe = {};
        let geparkt = false, mehrfach = 0;
        for (const s of spur) {
          if (!folge.length || folge[folge.length - 1] !== s.phase) folge.push(s.phase);
          if (s.phase) {
            querJe[s.phase] = querJe[s.phase] || [];
            querJe[s.phase].push(s.quer);
          }
          if (s.geparkt) geparkt = true;
          const wieViele = autos.filter((c) => c.ghost.pit).length;
          if (wieViele > 1) mehrfach++;
        }
        // ---- DER WERT AM PHASENENDE, nicht das Minimum ------------------------------
        //
        // g.querSoll ist ein NACHLAUFENDER Filter (0,25 je Takt), kein Befehl. Sein Minimum
        // ueber eine Phase ist deshalb der Wert, mit dem die Phase BEGONNEN hat - beim
        // Einfahren also die alte Linienlage, die noch links liegen kann. Gemessen: Minimum
        // in 'anfahrt' -0,194, waehrend der Befehl von der ersten Millisekunde +1 lautet.
        //
        // Ein Kriterium auf dem Minimum wuerde also die Traegheit pruefen und nicht den
        // Boxenstopp. Was zaehlt, ist der Wert am ENDE jeder Phase - dort ist der Filter
        // angekommen.
        const querMin = {}, querEnde = {};
        for (const k of Object.keys(querJe)) {
          querMin[k] = +Math.min.apply(null, querJe[k]).toFixed(3);
          querEnde[k] = querJe[k][querJe[k].length - 1];
        }
        // Je Phase: wie viele Takte, wie viele davon dunkel, und der Bremsverlauf.
        const jePhase = {};
        for (const x of spur) {
          if (!x.phase) continue;
          const e = jePhase[x.phase] || (jePhase[x.phase] = { takte: 0, dunkel: 0,
                                                             bremse: [], kmh: [] });
          e.takte++;
          if (x.blink) e.dunkel++;
          if (x.bremse !== null) e.bremse.push(x.bremse);
          if (x.kmh !== null) e.kmh.push(x.kmh);
        }
        for (const k of Object.keys(jePhase)) {
          const e = jePhase[k];
          e.bremseVerlauf = e.bremse.slice(0, 12);
          e.kmhAnfang = e.kmh.length ? e.kmh[0] : null;
          e.kmhEnde = e.kmh.length ? e.kmh[e.kmh.length - 1] : null;
          delete e.bremse; delete e.kmh;
        }
        return { folge, querMin, querEnde, geparkt, mehrfach, jePhase,
                 andere: autos.slice(1).map((c) => ({
                   yieldSide: c.ghost.yieldSide || 0,
                   quer: +(c.ghost.querSoll || 0).toFixed(3),
                   sperreTakte: c._sperreTakte || 0,
                   sperreMax: c._sperreMax === undefined ? null : +c._sperreMax.toFixed(3) })),
                 faellig: autos.map((c) => c.ghost.pitFaellig) };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        for (const c of merkGarage) garage.push(c);
        currentTrackTiles = merkTiles;
        lineCache = null;
        ghostCfg.pitAn = merkCfg.an; ghostCfg.pitFrei = merkCfg.frei;
        ghostCfg.pitSek = merkCfg.sek;
        ghostCfg.pitRundenMin = merkCfg.lo; ghostCfg.pitRundenMax = merkCfg.hi;
        flagState = merkFlag;
        // Den Boxenplatz freigeben. Der Anspruch heilt sich inzwischen selbst, aber ein
        // Prueflauf, der modulweiten Zustand liegen laesst, ist trotzdem einer, der den
        // naechsten Lauf beeinflusst - und genau das hat hier eine Messung verdorben.
        for (const c of garage) if (c.ghost) c.ghost.pit = null;
        pitInhaberSetzen(null);        // raeumt ALLE Plaetze
      }
    },

    // ---- HAELT DER BOXENPLATZ NACH EINEM ABBRUCH? ---------------------------------
    //
    // Der Fall, den diese Sonde stellt: ein Rennen endet oder wird beendet, WAEHREND ein
    // Ghost in der Box steht. Dann setzt finishGhost() g.finish, ghostTick() steigt frueh
    // aus, und pitTick() laeuft nie wieder. Bleibt g.pit dabei stehen, ist der Boxenplatz
    // dauerhaft besetzt - und weil das Auto im Rennen in der Garage BLEIBT, greift die
    // Selbstheilung ueber die Garage nicht.
    pitAbbruchProbe(wie) {
      const merkGarage = garage.splice(0, garage.length);
      try {
        const car = OMEGA_TEST.attrappeGhost('X');
        garage.push(car);
        // Einen laufenden Stopp von Hand setzen - die Sonde prueft das AUFRAEUMEN, nicht das
        // Ansetzen. Dafuer gibt es ghostPitProbe().
        car.ghost.pit = { phase: 'stand', at: Date.now(), laenge: 5000, platz: 0 };
        pitInhaberSetzen(car);
        const belegt = () => pitPlaetze.some((c) => !!c);
        const vor = belegt();
        if (wie === 'finish') finishGhost(car);
        else stopGhost(car);
        return { vor, nach: belegt(), pit: !!car.ghost.pit,
                 inGarage: garage.indexOf(car) >= 0 };
      } finally {
        garage.splice(0, garage.length);
        for (const c of merkGarage) garage.push(c);
        pitInhaberSetzen(null);
      }
    },

    // Die Faelligkeit allein, ohne einen Takt zu fahren - fuer die Bandpruefung.
    pitFaelligProbe(lo, hi, wie) {
      const merk = { lo: ghostCfg.pitRundenMin, hi: ghostCfg.pitRundenMax };
      try {
        ghostCfg.pitRundenMin = lo; ghostCfg.pitRundenMax = hi;
        const raus = [];
        for (let i = 0; i < (wie || 200); i++) {
          const g = { laps: 0 };
          pitFaelligZiehen(g);
          raus.push(g.pitFaellig);
        }
        return raus;
      } finally {
        ghostCfg.pitRundenMin = merk.lo; ghostCfg.pitRundenMax = merk.hi;
      }
    },

    ghostPassArming(tileCode, versuche, opt) {
      const merkGarage = garage.splice(0, garage.length);
      const merkSpice = ghostCfg.wuerzeUeberholen;
      const echtNow = Date.now;
      try {
        ghostCfg.wuerzeUeberholen = true;
        let uhr = echtNow();
        Date.now = () => uhr;
        const o = opt || {};
        const mk = (total) => ({ role: 'ghost', alias: 'P', tileAt: 0, tileCode,
          ghost: { tilesTotal: total, tileIndex: o.tileIndex || 0, form: 0, formAt: uhr,
                   attackUntil: 0, kurveMix: o.kurveMix || 0,
                   closeSince: uhr - 5000, mistakeUntil: 0, passPhase: null, passZiel: null,
                   passSince: 0, passBlockUntil: 0, naehern: 0, attackTriedAt: 0 } });
        const hinten = mk(0), vorne = mk(0.4);
        garage.push(hinten, vorne);
        let gestartet = 0;
        for (let i = 0; i < (versuche || 400); i++) {
          uhr += 60;
          // Kleben halten, damit die Zuendbedingung immer erfuellt ist.
          hinten.ghost.closeSince = uhr - 5000;
          ghostSpice(hinten, { tight: o.tight || 0,
                               dist: o.dist === undefined ? 99 : o.dist, key: 'p' });
          if (hinten.ghost.attackUntil) {
            gestartet++;
            // Zuruecksetzen und weiter wuerfeln.
            hinten.ghost.attackUntil = 0; hinten.ghost.passPhase = null;
            hinten.ghost.passZiel = null; hinten.ghost.attackTriedAt = 0;
            hinten.ghost.passBlockUntil = 0;
          }
        }
        // Der Platz, den die Attrappe hatte - damit eine Pruefung die Zahl gegen ihn
        // stellen kann statt gegen eine Erwartung.
        const li = Math.abs(ghostLineOffset(hinten) * ghostCfg.line * GHOST_LINE_STEER
                            * ghostLinieGewicht(hinten.ghost.kurveMix || 0));
        return { gestartet, takte: versuche || 400, code: tileCode,
                 platz: +Math.max(0, 1 - li).toFixed(3) };
      } finally {
        Date.now = echtNow;
        garage.splice(0, garage.length);
        merkGarage.forEach(c => garage.push(c));
        ghostCfg.wuerzeUeberholen = merkSpice;
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
        // SCHEITEL, EINGANG UND AUSGANG einzeln - das Mittel allein taugt nicht mehr als
        // Beschreibung einer Kurve, seit die Linie von aussen anfaehrt und nach aussen
        // ausfaehrt. Gemessen an SG2H2G2J2 liegt das Mittel eines Haarnadelzugs bei +0,05,
        // waehrend die Spanne 1,89 betraegt: die Linie durchquert die ganze Bahn, und ihr
        // Mittelwert sagt darueber genau nichts. Der Scheitel ist der Extremwert IN
        // Drehrichtung, Eingang und Ausgang sind der erste und der letzte Punkt des Zuges.
        return zuege.map(z => ({
          von: z.von, bis: z.bis, dir: z.dir,
          mittel: +(z.werte.reduce((s, x) => s + x, 0) / z.werte.length).toFixed(4),
          spanne: +(Math.max(...z.werte) - Math.min(...z.werte)).toFixed(4),
          scheitel: +(z.dir > 0 ? Math.max(...z.werte) : Math.min(...z.werte)).toFixed(4),
          eingang: +z.werte[0].toFixed(4),
          ausgang: +z.werte[z.werte.length - 1].toFixed(4),
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
        // DIE FELDSTAFFEL IST HIER AUS, solange der Aufrufer nichts anderes sagt. Dieser
        // Prueffstand stellt ein ZWEITES, stehendes Auto dazu, damit ghostLane() ueberhaupt
        // etwas verteilt - und damit ist das gemessene Auto per Konstruktion der Fuehrende
        // eines Feldes aus einem Steher und bekaeme den vollen Abschlag.
        //
        // GEMESSEN: "Ghost erreicht sein eingestelltes Tempo" fiel von 98,5 auf 86 Prozent,
        // sobald "Feld zusammenhalten" ab Werk an war - ohne dass am Tempo-Regler etwas
        // falsch gewesen waere. Ein Prueffstand, der sich ein Feld erfindet, darf dessen
        // Wirkung nicht mitmessen. Wer sie messen WILL, uebergibt leaderBrake: true.
        ghostCfg.leaderBrake = false;
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
        const phase = [], mix = [], naehern = [], linie = [];
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
            // Der LINIENVERSATZ im echten Fahrbetrieb. ghostLinieTrace() faelscht die
            // Kacheluhr und bekommt deshalb saubere Phasen; hier faehrt das Auto wirklich,
            // und die Phase ist eine Schaetzung. Der Unterschied zwischen den zwei Sonden
            // ist genau die Frage, ob die Linie am Servo ankommt.
            linie.push(+ghostLineOffset(car).toFixed(3));
          }
        }
        stopGhost(car);
        stopGhost(zweit);
        const roh = bytes.slice(vorLauf);
        return { lenk: roh.map(b => b[0]), gas: roh.map(b => b[1]),
                 kachel: roh.map(b => b[2]), tempo, ziel, vorsteuer, gang, drehzahl,
                 phase, mix, naehern, linie,
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

    // ---- QUERLAGE BEI STILLSTAND: darf sich ein stehendes Auto seitlich verschieben? ----
    //
    // BESTELLT: "Autos koennen nicht quer hin und herrutschen [...] auch nur die Querlage
    // wechseln, wenn sie sich vorwaerts bewegen."
    //
    // ---- WARUM DIESE SONDE DIE GESCHWINDIGKEIT SELBST FESTNAGELT --------------------
    //
    // ghostCfg.speed auf 0 zu stellen reicht NICHT: das Auto rollt trotzdem minimal aus
    // (Motorbremse, Reibung), bevor es wirklich bei 0 km/h ankommt, und in dieser kurzen
    // Restfahrt darf sich die Querlage ja tatsaechlich noch bewegen - das ist ja der Sinn
    // der Kopplung. Ein Test, der das nicht abfaengt, misst also ein Gemisch aus "faehrt
    // noch ein bisschen" und "steht wirklich", und ein spaeter kleiner Rest-Ausschlag waere
    // nicht zu unterscheiden von einem echten Fehler.
    //
    // Deshalb wird engine.state.speedKmh nach JEDEM Tick auf exakt 0 zurueckgesetzt - das
    // Auto steht dann ab dem ZWEITEN Tick garantiert, und jede Bewegung der Querlage ab da
    // ist eindeutig die Kopplung, nicht ein Restauslauf.
    //
    // UND WARUM DIE KACHEL EINGEFROREN WIRD: ghostTilePhase() (90-ghosts.js) schaetzt "wie
    // weit durch die Kachel" rein aus VERGANGENER ZEIT, nicht aus gefahrener Strecke - ein
    // bekannter, dokumentierter Rest (siehe der Kommentar dort und im Aufrufer). Ohne
    // Einfrieren der Kachel wuerde die IDEALLINIE selbst am stehenden Auto weiterwandern,
    // und die Sonde koennte nicht mehr unterscheiden, ob die Querlage wegen der Kopplung
    // steht oder weil sich zufaellig auch das Ziel gerade nicht bewegt. tileMs riesig haelt
    // das Ziel fest, wie es ein wirklich unbewegtes Auto haette (Byte 11 zaehlt nur bei
    // echter Ueberfahrt weiter).
    //
    // GEMESSEN WIRD AB DEM ZWEITEN TAKT. Der erste Takt darf springen: g.querIst ist dort
    // noch undefined und wird bewusst OHNE Ratenbegrenzung auf sein erstes Ziel gesetzt
    // (siehe der Kommentar in ghostTick) - ein Auto muss irgendwo anfangen, und das ist
    // kein Rutschen, sondern ein einmaliges Platzieren.
    async querlageStillstandProbe(o) {
      const opt = o || {};
      const takte = opt.takte || 150;
      const keepTiles = currentTrackTiles;
      const merkCfg = JSON.parse(JSON.stringify(ghostCfg));
      const echtNow = Date.now;
      let car = null, zweit = null;
      try {
        const p = codeToTrack(opt.code || 'SG2H2G2R2');
        currentTrackTiles = p.tiles;
        lineCache = null;
        ghostCfg.leaderBrake = false;
        ghostCfg.speed = opt.fahren ? 0.55 : 0;
        if (opt.cfg) Object.assign(ghostCfg, opt.cfg);
        let uhr = echtNow();
        Date.now = () => uhr;
        car = { role: 'ghost', alias: 'SondeStillstand', writeInFlight: false,
                tileCode: 0x02, tileCount: 0, lastCodeAt: uhr, yaw: 0, rx: null };
        zweit = { role: 'ghost', alias: 'SondeStillstand2', writeInFlight: false,
                  tileCode: 0x02, tileCount: 0, lastCodeAt: uhr, yaw: 0, rx: null };
        garage.push(car, zweit);
        startGhost(car);
        startGhost(zweit);
        ghostTaktLoeschen(car);
        ghostTaktLoeschen(zweit);
        car.ghost.freeRun = true;
        car.ghost.bias = 0;
        const querIst = [], querSoll = [], tempo = [];
        for (let i = 0; i < takte; i++) {
          uhr += 45;
          ghostTick(car);
          // ERST NACH dem Tick auf 0 zwingen: der Tick selbst hat das Tempo schon fuer
          // DIESEN Durchlauf gelesen (in `v`), das Zuruecksetzen betrifft nur den naechsten.
          //
          // opt.fahren UEBERSPRINGT DAS ERZWINGEN - die Gegenprobe: ohne sie waere nicht
          // zu unterscheiden, ob eine gruene Messung an der Kopplung liegt oder daran, dass
          // dieser Prueflauf nie etwas Bewegliches misst.
          if (!opt.fahren && car.ghost.engine) car.ghost.engine.state.speedKmh = 0;
          querIst.push(car.ghost.querIst === undefined ? null : +car.ghost.querIst.toFixed(5));
          querSoll.push(+(car.ghost.querSoll || 0).toFixed(5));
          tempo.push(car.ghost.engine
            ? +(car.ghost.engine.state.speedKmh / car.ghost.engine.config.topSpeedKmh).toFixed(5)
            : 0);
        }
        // Ab Takt 2 (Index 1): Spannweite ueber den Rest des Laufs.
        const ab2Ist = querIst.slice(1).filter((x) => x !== null);
        const ab2Soll = querSoll.slice(1);
        return {
          takte, tempoMax: Math.max(...tempo),
          querIst, querSoll,
          spanneIst: ab2Ist.length ? Math.max(...ab2Ist) - Math.min(...ab2Ist) : 0,
          spanneSoll: ab2Soll.length ? Math.max(...ab2Soll) - Math.min(...ab2Soll) : 0,
          ersterTakt: { querIst: querIst[0], querSoll: querSoll[0] },
        };
      } finally {
        Date.now = echtNow;
        currentTrackTiles = keepTiles;
        lineCache = null;
        Object.keys(merkCfg).forEach((x) => { ghostCfg[x] = merkCfg[x]; });
        for (const c of [car, zweit]) {
          if (!c) continue;
          ghostTaktLoeschen(c);
          if (c.ghost) c.ghost.running = false;
        }
        for (let i = garage.length - 1; i >= 0; i--) {
          if (garage[i] && garage[i].alias && /^SondeStillstand/.test(garage[i].alias)) {
            garage.splice(i, 1);
          }
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

    // ---- SAGT DIE FREIE FAHRT IHRE RUNDENZEITEN AN? -----------------------------
    //
    // BESTELLT: "Ansagen fuer Rundenzeiten auch machen, wenn ich im Cockpit-Modus freie
    // Fahrt mache."
    //
    // Gefahren wird ueber playerLapCrossed(), also den ECHTEN Weg, den auch eine
    // Ueberfahrt auf der Bahn nimmt. Ein Prueflauf, der speakLap() direkt riefe, prueefte
    // die Stimme und nicht die Bedingung, an der es lag.
    //
    // Die Stimme wird durch eine Attrappe ersetzt (wie in ansagenFolge) und Date.now()
    // gefaelscht, damit die Rundenzeiten genau die bestellten sind und nicht die
    // Ausfuehrungsdauer dieses Prueflaufs.
    freieRundeProbe(o) {
      const opt = o || {};
      const merk = { rs: raceState, rls: raceLapStart, dls: dashLapStart,
                     dlt: dashLapTimes.slice(), form: raceFormationLap,
                     sc: sectorCount, ss: sectorStart };
      const echteNow = Date.now;
      const echteStimme = window.speechSynthesis;
      const gesagt = [];
      let uhr = echteNow.call(Date);
      try {
        Object.defineProperty(window, 'speechSynthesis', {
          configurable: true,
          value: { cancel() {}, speak(u) { gesagt.push(u.text); } },
        });
        Date.now = () => uhr;
        // KEIN Rennen - genau die Lage, in der bisher nichts gesagt wurde.
        raceState = opt.raceState || 'idle';
        raceFormationLap = false;
        raceLapStart = null;
        sectorCount = 1;          // keine Sektoren: jede Ueberfahrt ist eine Runde
        sectorStart = null;
        dashLapTimes.length = 0;
        dashLapStart = null;

        const zeiten = opt.zeiten || [9000, 8000, 8500];
        const folge = [];
        // Die erste Ueberfahrt setzt nur den Bezug: vorher gibt es keine Rundenzeit.
        playerLapCrossed();
        for (const ms of zeiten) {
          uhr += ms;
          const vorher = gesagt.length;
          playerLapCrossed();
          folge.push({ ms, gesagt: gesagt.length > vorher ? gesagt[gesagt.length - 1] : null });
        }
        return { folge, gesagt, runden: dashLapTimes.slice() };
      } finally {
        Date.now = echteNow;
        if (echteStimme) {
          Object.defineProperty(window, 'speechSynthesis',
                                { configurable: true, value: echteStimme });
        } else { delete window.speechSynthesis; }
        raceState = merk.rs; raceLapStart = merk.rls; raceFormationLap = merk.form;
        dashLapStart = merk.dls;
        dashLapTimes.length = 0;
        merk.dlt.forEach(x => dashLapTimes.push(x));
        sectorCount = merk.sc; sectorStart = merk.ss;
      }
    },

    // ---- WIE VIELE SPUREN BENUTZT DAS FELD? -------------------------------------
    //
    // BESTELLT: "max 2 Autos nebeneinander". Die Zusage ist eine Eigenschaft der
    // Spuraufteilung: gibt ghostLane() nur zwei verschiedene Werte aus, koennen per
    // Konstruktion nicht drei Autos auf einer Hoehe nebeneinander liegen, ohne dieselbe
    // Spur zu teilen.
    //
    // GEPRUEFT WIRD MIT VIELEN AUTOS. Bei zwei oder drei waere auch die alte, verteilende
    // Rechnung noch unauffaellig - erst ab vier faechert sie sichtbar auf.
    spurenProbe(n) {
      const merkGarage = garage.splice(0, garage.length);
      try {
        const autos = [];
        for (let i = 0; i < (n || 6); i++) {
          autos.push({ role: 'ghost', alias: 'S' + i, ghost: { tileIndex: 0 } });
        }
        for (const c of autos) garage.push(c);
        const spuren = autos.map((c) => ghostLane(c));
        const eindeutig = [...new Set(spuren.map((x) => +x.toFixed(6)))].sort((a, b) => a - b);
        return { spuren, eindeutig, autos: autos.length };
      } finally {
        garage.splice(0, garage.length);
        merkGarage.forEach((c) => garage.push(c));
      }
    },

    // Die Wetterlage von aussen setzen, ueber denselben Weg wie die Kachel. Gebraucht vom
    // Regenformen-Test, der vorher mit box.click() auf eine Lage zusteuerte - das ging,
    // solange die Kachel ein Zwei-Wege-Schalter war, und haengt seit v0.6.17 am
    // Anfangszustand.
    wxModusSetzen(modus) {
      return typeof wxModusSetzen === 'function' ? wxModusSetzen(modus) : null;
    },

    // ---- DER FLIEGENDE START, VON AUSSEN GEFAHREN -------------------------------
    //
    // GEMELDET: "Probier nochmal, den fliegenden Start zu reparieren: dabei fahren alle
    // einmal ueber Start, und dann so lange, bis irgendeiner ueber Start faehrt, dann geben
    // alle normal Gas. Das Ganze in 2 Spalten und mit gedrosselter Geschwindigkeit."
    //
    // Drei getrennte Zusagen, und diese Sonde misst alle drei einzeln:
    //
    //   1. WANN endet die Runde - bei der zweiten Ueberfahrt IRGENDEINES Autos.
    //   2. WIE SCHNELL rollt das Feld dabei - gedrosselt auf das Formationstempo.
    //   3. WIE STEHT es dabei - zwei Spalten, also benachbarte Startplaetze auf
    //      verschiedenen Seiten.
    //
    // Ohne echte Autos: die Ueberfahrten werden gemeldet, wie es der Meldekanal taete.
    fliegenderStartProbe(o) {
      const opt = o || {};
      const merk = { fs: raceFlying, zustand: raceState, formation: raceFormationLap,
                     limit: limitFormation, gitter: raceGridOrder.slice(),
                     zaehler: formationZaehler };
      try {
        raceFlying = true;
        raceGridOrder = (opt.autos || ['a', 'b', 'c', 'd']).slice();
        raceFormationLap = true;
        formationZaehler = new Map();
        limitFormation = formationPace();

        // ---- DIE SPANNE JE SPALTE, ueber eine ganze Schlaengelperiode ------------
        //
        // Den Versatz bei Phase null abzulesen genuegt NICHT: formationOffset traegt
        // Schlaengeln PLUS Kolonne, und die Frage ist, ob die beiden Spalten sich beim
        // Schwingen ueberschneiden. Genau daran ist es gescheitert - der Versatz stand in
        // der Formel, das Schlaengeln war groesser, und die Bereiche lagen uebereinander.
        //
        // Also wird eine volle Periode abgetastet (700 ms je Radiant, siehe
        // formationOffset) und je Startplatz das Kleinste und Groesste festgehalten.
        const spalten = raceGridOrder.map((id, i) => {
          const halter = { weavePhase: 0 };
          let min = Infinity, max = -Infinity;
          for (let t = 0; t <= 4400; t += 25) {
            const v = formationOffset(halter, i, t);
            if (v < min) min = v;
            if (v > max) max = v;
          }
          // GERADER PLATZ IST RECHTS. formationOffset rechnet (gridPos % 2 ? -1 : 1),
          // ein gerader Platz bekommt also einen POSITIVEN Versatz - und positiv ist
          // rechts (Byte 7, nachgemessen am Bahnradius). Ein erster Anlauf dieser Sonde
          // hatte die Seiten vertauscht und meldete eine Trennung von -1,14: die Zahlen
          // waren richtig, die Namen falsch, und das Vorzeichen machte aus einer sauberen
          // Trennung eine Ueberschneidung.
          return { id, platz: i, seite: i % 2 ? 'links' : 'rechts',
                   min: +min.toFixed(3), max: +max.toFixed(3) };
        });
        // Ueberlappen die beiden Spalten? Das ist die eigentliche Zusage: positiv heisst,
        // zwischen ihnen bleibt Bahn frei.
        const links = spalten.filter((x) => x.seite === 'links');
        const rechts = spalten.filter((x) => x.seite === 'rechts');
        const trennung = (links.length && rechts.length)
          ? +(Math.min.apply(null, rechts.map((x) => x.min))
              - Math.max.apply(null, links.map((x) => x.max))).toFixed(3)
          : null;

        // Die Ueberfahrten der Reihe nach melden und festhalten, wann es gruen wird.
        const verlauf = [];
        const folge = opt.folge || ['a', 'b', 'c', 'd', 'a'];
        for (const id of folge) {
          const vorher = raceFormationLap;
          formationUeberfahrt(id);
          verlauf.push({ wer: id, nachher: raceFormationLap,
                         beendet: vorher && !raceFormationLap });
        }
        return {
          spalten,
          // Positiv heisst: zwischen den Spalten bleibt Bahn frei. Null oder negativ
          // heisst, sie ueberschneiden sich - und dann ist es kein Zweierzug.
          trennung,
          verlauf,
          tempo: { formation: +formationPace().toFixed(3),
                   limitNachher: +limitFormation.toFixed(3) },
          nochFormation: raceFormationLap,
        };
      } finally {
        raceFlying = merk.fs;
        raceState = merk.zustand;
        raceFormationLap = merk.formation;
        limitFormation = merk.limit;
        raceGridOrder = merk.gitter;
        formationZaehler = merk.zaehler;
        applySpeedLimit();
      }
    },

    // ---- MEHRSPIELER, MIT EINEM FETCH-STUMMEL -----------------------------------
    //
    // Mehrspieler hatte bis v0.6.20 KEINE einzige Pruefung - weder hier noch im
    // Selbsttest -, und der Code ist seit rund siebzig Fassungen unberuehrt. Das ist die
    // groesste Luecke im ganzen Projekt gewesen.
    //
    // MIT EINEM STUMMEL statt eines echten Hosts: ein Prueflauf, der ein Programm auf dem
    // PC voraussetzt, laeuft bei niemandem. Der Stummel zeichnet auf, WAS die App
    // schicken wollte, und antwortet, was der Host antworten wuerde - damit ist beides
    // pruefbar: der Bericht und das Zeichnen der Rangliste.
    //
    // Und der dritte Fall, der in der Praxis der haeufigste ist: die Leitung ist weg. Dann
    // darf nichts werfen, und die Statuszeile muss es sagen.
    // ASYNC, und das ist kein Schoenheitsfehler: der erste Anlauf gab aus dem try ein
    // Promise zurueck und raeumte im finally auf. Das finally laeuft dann SOFORT - beim
    // Zurueckgeben, nicht beim Fertigwerden -, also war mp.an schon wieder false, wenn
    // mpHolen() lief. Gemessen: der Bericht ging raus, die Rangliste kam nie, und die
    // Statuszeile sagte "nicht verbunden". Das sah nach einem Fehler in der App aus und
    // war einer in der Messung.
    async mpProbe(o) {
      const opt = o || {};
      const echtFetch = window.fetch;
      const merk = { host: mp.host, name: mp.name, an: mp.an, timer: mp.timer,
                     id: mp.id, letzter: mp.letzterBericht,
                     runden: dashLapTimes.slice() };
      const gesendet = [];
      try {
        // Kein Zeitgeber waehrend der Messung: mpJoin() startet einen, und ein Takt, der
        // nach dem Prueflauf weiterlaeuft, meldet in fremde Laeufe hinein.
        if (mp.timer) { clearInterval(mp.timer); mp.timer = null; }
        mp.host = 'http://pruefhost:8080';
        mp.name = opt.name || 'Pruefer';
        mp.an = true;
        dashLapTimes = (opt.runden || [11500, 11200, 11800]).slice();

        window.fetch = (url, init) => {
          gesendet.push({ url: String(url), methode: (init && init.method) || 'GET',
                          rumpf: init && init.body ? JSON.parse(init.body) : null });
          if (opt.leitungWeg) return Promise.reject(new Error('Netzwerk weg'));
          if (String(url).indexOf('/mp/state') >= 0) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({
              // IN SEKUNDEN, wie das echte Protokoll: mpEigenerStand() teilt die
              // Millisekunden der Rundenliste durch 1000, bevor es meldet. Der erste
              // Anlauf dieses Stummels schickte Millisekunden, und die Rangliste zeigte
              // brav "11200.00s" - kein Fehler der App, einer der Messung, und nur
              // dadurch aufgefallen, dass die Zahl beim Lesen unsinnig aussah.
              fahrer: opt.fahrer || [
                { id: mp.id, name: mp.name, laps: 2, letzte: 11.2, beste: 11.2,
                  abgaenge: 0, alter: 0.3 },
                { id: 'x', name: 'Zweiter', laps: 2, letzte: 12.0, beste: 11.9,
                  abgaenge: 1, alter: 14.0 },
              ],
              rennen: { start: 1, laps: 10, minutes: null, laufzeit: 42.0,
                        restSekunden: null },
              zeit: 1,
            }) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        };

        // 1. Eine gefahrene Runde meldet.
        mpRundeGefahren();
        await new Promise((r) => setTimeout(r, 30));
        const nachRunde = gesendet.slice();
        // 2. Und die Rangliste wird geholt und gezeichnet.
        gesendet.length = 0;
        await mpHolen();
        const zeilen = $('mp-rows')
          ? [...$('mp-rows').querySelectorAll('tr')].map((tr) =>
              [...tr.children].map((td) => td.textContent.trim()).join('|'))
          : null;
        return {
          bericht: nachRunde.map((g) => ({ methode: g.methode,
            pfad: g.url.replace('http://pruefhost:8080', ''),
            laps: g.rumpf ? g.rumpf.laps : null,
            name: g.rumpf ? g.rumpf.name : null,
            id: g.rumpf ? g.rumpf.id : null })),
          geholt: gesendet.map((g) => g.url.replace('http://pruefhost:8080', '')),
          zeilen,
          status: $('mp-status') ? $('mp-status').textContent : null,
        };
      } finally {
        window.fetch = echtFetch;
        mp.host = merk.host; mp.name = merk.name; mp.an = merk.an;
        mp.id = merk.id; mp.letzterBericht = merk.letzter;
        if (mp.timer) { clearInterval(mp.timer); }
        mp.timer = merk.timer;
        dashLapTimes = merk.runden;
      }
    },

    // ---- WAS WIRD AUS EINEM GEMELDETEN CODE? ------------------------------------
    //
    // codeZuTyp() ist die eine Stelle, an der aus einem Byte des Autos eine Kachelart der
    // Karte wird. Sie muss die LESEART kennen: 0x0a ist auf der Schiene die Engstelle und
    // im Ausdruck die Ziellinie.
    codeTypProbe(codes) {
      if (typeof codeZuTyp !== 'function') return null;
      const merk = trackMode;
      try {
        const liste = codes || [0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
                                0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c];
        const aus = {};
        for (const modus of ['on', 'off']) {
          trackMode = modus;
          aus[modus] = liste.map((c) => codeZuTyp(c));
        }
        return { codes: liste, bahn: aus.on, ausdruck: aus.off,
                 typen: { START: TILE_TYPE.START, PIT: TILE_TYPE.PIT,
                          ENGE: TILE_TYPE.ENGE } };
      } finally { trackMode = merk; }
    },

    // ---- SAGEN DIE ANZEIGETEXTE DIE WAHRHEIT? -----------------------------------
    //
    // Gemessen, ungefragt: ZEHN Schieberegler zeigten beim Laden einen Text, der nicht zu
    // ihrer Stellung passte - ghost-lanes stand auf 1 und zeigte "aus".
    //
    // ---- WIE MAN DAS UEBERHAUPT MESSEN KANN ------------------------------------
    //
    // Nicht durch Vergleich von Text und Zahl: der Text ist formatiert ("100%", "1.5 s",
    // "aus", "rechts 64 von 127"), und ein Pruefer, der ihn zurueckrechnet, waere eine
    // zweite Fassung jeder einzelnen Formatierung - und laege bei der naechsten Aenderung
    // falsch.
    //
    // Gemessen wird stattdessen die EINZIGE Aussage, die formatunabhaengig gilt: der Text,
    // den der Zuhoerer schreiben WUERDE, muss der Text sein, der schon dasteht. Also
    // ablesen, ein 'input' ohne Nutzerhandlung feuern, wieder ablesen. Jede Abweichung ist
    // ein Text, der nicht zu seinem Regler gehoert.
    //
    // Das taugt nur, weil die Zuhoerer idempotent sind - nachgemessen: ein zweiter
    // Durchlauf aendert nichts. Waeren sie es nicht, wuerde diese Sonde selbst verstellen,
    // was sie prueft.
    reglerTexteProbe() {
      const raus = [];
      for (const el of document.querySelectorAll('input[type=range][id]')) {
        const v = document.getElementById(el.id + '-val');
        if (!v) continue;
        const vorher = v.textContent.trim();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const nachher = v.textContent.trim();
        raus.push({ id: el.id, stand: el.value, vorher, nachher,
                    stimmt: vorher === nachher });
      }
      return { geprueft: raus.length,
               falsch: raus.filter((x) => !x.stimmt),
               alle: raus };
    },

    // ---- DIE SICHERUNG, EINMAL HIN UND EINMAL ZURUECK ---------------------------
    //
    // BESTELLT: "Die Fahreinstellungen und globale Einstellungen (Autonamen, Rundenzeiten,
    // letzter eingestellter Rennmodus, ...) sollen alle als Datei gespeichert und
    // importiert werden koennen."
    //
    // ---- WARUM DIESE SONDE WIRKLICH VERAENDERT UND NICHT NUR LIEST --------------
    //
    // Eine Sonde, die nur sicherungLesen() aufruft und das Ergebnis vorzeigt, prueft, dass
    // JSON gebaut wird. Das war nie die Frage. Die Frage ist, ob ein SPAETERER Stand sich
    // damit wieder auf den fruehreren bringen laesst - und das ist erst geprueft, wenn
    // zwischen Sichern und Laden wirklich etwas anderes eingestellt war.
    //
    // Ablauf: sichern, einen Regler und eine Ablage VERSTELLEN, zurueckladen, vergleichen.
    // Am Ende wird der Stand von vorher wiederhergestellt - eine Pruefung, die die
    // Einstellungen des Nutzers umwirft, wird beim zweiten Mal nicht mehr gestartet.
    sicherungProbe(o) {
      const opt = o || {};
      if (typeof sicherungLesen !== 'function') return null;
      const vorher = sicherungLesen();
      // Ein Regler, an dem sich messen laesst: ein Schieber mit Bereich, damit ein
      // veraenderter Wert auch ein gueltiger ist.
      const el = sicherungRegler().find((x) => x.type === 'range' && +x.max > +x.min);
      if (!el) return null;
      const alt = +el.value;
      const schritt = +el.step || 1;
      const anders = alt + schritt <= +el.max ? alt + schritt : alt - schritt;
      const PROBE_KEY = 'chc.sicherungsprobe.v1';
      try {
        // ---- 1. VERSTELLEN, damit es etwas zurueckzuholen gibt --------------------
        presetSet(el.id, anders);
        localStorage.setItem(PROBE_KEY, 'verstellt');
        const zwischen = sicherungLesen();

        // ---- 2. ZURUECKLADEN -----------------------------------------------------
        const r = sicherungAnwenden(vorher);
        const nachher = sicherungLesen();

        // ---- 3. UND DIE FAELLE, DIE SCHIEFGEHEN KOENNEN --------------------------
        //
        // Alle mit EINER echten Sicherung als Grundlage, nur an einer Stelle verbogen -
        // eine von Hand gebaute Attrappe wuerde auch dann noch bestehen, wenn das echte
        // Format sich aendert.
        const kopie = (x) => JSON.parse(JSON.stringify(x));
        const falsch = {};
        const fremd = kopie(vorher);
        fremd.typ = 'irgendwas';
        falsch.fremderTyp = sicherungPruefen(fremd).fehler || null;
        const zukunft = kopie(vorher);
        zukunft.version = SICHERUNG_VERSION + 1;
        falsch.neuereFassung = sicherungPruefen(zukunft).fehler || null;
        const kaputt = kopie(vorher);
        kaputt.regler[el.id] = +el.max + 1000;
        falsch.wertAusserhalb = sicherungPruefen(kaputt).bad || null;
        const veraltet = kopie(vorher);
        Object.keys(veraltet.regler).slice(0, 3).forEach((k) => delete veraltet.regler[k]);
        falsch.fehlendeRegler = sicherungPruefen(veraltet).neu || null;
        const geschmuggelt = kopie(vorher);
        geschmuggelt.ablagen['boeser.schluessel'] = 'x';
        falsch.fremdeAblage = sicherungPruefen(geschmuggelt).fremd || null;

        return {
          // Hat das Verstellen ueberhaupt gewirkt? Ohne diese Zeile koennte der ganze
          // Test gruen sein, weil sich nie etwas geaendert hat.
          verstellt: zwischen.regler[el.id] !== vorher.regler[el.id],
          reglerId: el.id,
          werte: { vorher: vorher.regler[el.id], zwischen: zwischen.regler[el.id],
                   nachher: nachher.regler[el.id] },
          // ---- ZUSAMMENGEFUEHRT UND NICHT ERSETZT ------------------------------
          //
          // Diese Sonde erwartete zuerst, dass die zwischendurch angelegte Ablage nach
          // dem Laden verschwunden ist. Sie war noch da - und die ERWARTUNG war falsch,
          // nicht der Code: eine Sicherung von vorletzter Woche darf nicht die Strecke
          // loeschen, die gestern gebaut wurde. Begruendet in sicherungAnwenden().
          //
          // Geprueft wird deshalb genau das: der neue Schluessel ueberlebt, und die
          // gesicherten Werte sind trotzdem zurueck.
          ablageBleibt: nachher.ablagen[PROBE_KEY] === 'verstellt',
          bericht: r,
          umschlag: { typ: vorher.typ, version: vorher.version, app: vorher.app,
                      regler: Object.keys(vorher.regler).length,
                      ablagen: Object.keys(vorher.ablagen).length },
          falsch,
          // ---- DIE PRAEFIXREGEL GEGEN ALLE BEKANNTEN SCHLUESSEL ------------------
          //
          // Der wichtigste Teil. Die Liste steht HIER und nicht im Modul: sie ist die
          // UNABHAENGIGE Aufzaehlung dessen, was die App ablegt, und ein Test, der die
          // Liste aus dem Modul nimmt, prueft die Regel gegen sich selbst.
          //
          // Zwoelf davon stehen als Konstante im Quelltext, der dreizehnte
          // (Gamepad-Belegung) ist mir erst im laufenden Browser aufgefallen.
          bekannt: ['chc.cars.v1', 'chc.cockpit.v1', 'chc.cockpit.omega.v1',
                    'chc.gearbox.v1', 'chc.layout.v1', 'chc.mp.v1',
                    'chc.motorwerkstatt.v1', 'chc.presets.v1', 'chc.sessions.v1',
                    'carrera-hybrid-macros', 'carrera-hybrid-tracks',
                    'carrera-hybrid-gamepad-bindings-v2', 'omegasim-lang']
            .map((k) => ({ k, erfasst: SICHERUNG_PRAEFIXE.some((p) => k.indexOf(p) === 0) })),
          // Und die Selbstsicherung darf NICHT im Buendel liegen.
          autoDrin: Object.prototype.hasOwnProperty.call(vorher.ablagen, AUTO_STORE),
          autoKey: AUTO_STORE,
        };
      } finally {
        try { localStorage.removeItem(PROBE_KEY); } catch (e) { /* egal */ }
        presetSet(el.id, alt);
        if (!opt.behalten) sicherungAnwenden(vorher);
      }
    },

    // Ueberlebt ein Regler das Neuladen? Gemessen wird die ABLAGE und das Zurueckholen
    // daraus - einen zweiten echten Ladevorgang kann eine Sonde in derselben Seite nicht
    // herstellen, und ein Test, der vorgibt es zu tun, prueft seine eigene Nachstellung.
    autoSicherungProbe() {
      if (typeof autoSicherungSchreiben !== 'function') return null;
      const el = sicherungRegler().find((x) => x.type === 'range' && +x.max > +x.min);
      if (!el) return null;
      const alt = +el.value;
      const schritt = +el.step || 1;
      const anders = alt + schritt <= +el.max ? alt + schritt : alt - schritt;
      let vorherRoh = null;
      try { vorherRoh = localStorage.getItem(AUTO_STORE); } catch (e) { /* privat */ }
      try {
        presetSet(el.id, anders);
        autoSicherungSchreiben();
        const abgelegt = JSON.parse(localStorage.getItem(AUTO_STORE) || '{}');
        // Zurueckstellen, dann laden - so wie es beim Neustart geschieht: die Regler
        // stehen auf den Markup-Vorgaben, und autoSicherungLaden() holt sie zurueck.
        presetSet(el.id, alt);
        const vorLaden = +document.getElementById(el.id).value;
        const n = autoSicherungLaden();
        return {
          reglerId: el.id,
          abgelegt: abgelegt[el.id],
          erwartet: anders,
          vorLaden,
          nachLaden: +document.getElementById(el.id).value,
          gesetzt: n,
          // Wieviele Regler deckt die Selbstsicherung ab? Bricht diese Zahl ein, deckt
          // sie etwas nicht mehr ab.
          umfang: Object.keys(abgelegt).length,
        };
      } finally {
        presetSet(el.id, alt);
        try {
          if (vorherRoh === null) localStorage.removeItem(AUTO_STORE);
          else localStorage.setItem(AUTO_STORE, vorherRoh);
        } catch (e) { /* privat */ }
      }
    },

    // ---- DIE ENGSTELLE, ABGEFAHREN -----------------------------------------------
    //
    // BESTELLT: "Engstelle: Tempo so drosseln wie in Haarnadelkurve und am Anfang ganz
    // rechts fahren, dann ganz links."
    //
    // Drei Zusagen, drei Messungen - und zwei davon koennen sich WIDERSPRECHEN, weshalb
    // beide hier stehen muessen:
    //
    //   1. DIE LINIE geht von rechts nach links. Gemessen wird sie NICHT als alpha,
    //      sondern als das, was ghostLineOffset daraus macht - also als LENKBEFEHL, in dem
    //      rechts positiv ist. Damit faellt der Vorzeichenfehler auf, den ich beim Einbau
    //      gemacht habe (alpha zeigt nach links, Byte 7 nach rechts): eine Sonde, die alpha
    //      direkt liest, haette die falsch herum fahrende Engstelle bestaetigt.
    //   2. DIE DROSSELUNG ist die der Haarnadel. Nicht "groesser null" - GLEICH, denn
    //      genau das war die Ansage.
    //   3. DER SCHWENK IST FAHRBAR. Die Querfuehrung in ghostTick ist ratenbegrenzt; ein
    //      Sollwertsprung, dem sie nicht folgen kann, ist eine Linie auf dem Papier. Die
    //      Sonde gibt deshalb aus, wieviel Querlage je Kachelanteil verlangt wird - eine
    //      Zahl, die gegen die Rate gehalten werden kann.
    engstelleProbe(code, schritte) {
      if (typeof codeToTrack !== 'function' || typeof ghostLineOffset !== 'function') {
        return null;
      }
      const keepTiles = currentTrackTiles;
      try {
        // Eine geschlossene Bahn mit genau EINER Engstelle. Sie ersetzt eine Gerade, was
        // sie geometrisch auch ist - dadurch bleibt der Schluss der Bahn unberuehrt.
        const p = codeToTrack(code || 'SR3EGR3G2');
        const tiles = p.tiles;
        const idx = tiles.findIndex((t) => t.type === TILE_TYPE.ENGE);
        if (idx < 0) return null;
        currentTrackTiles = tiles;
        lineCache = null;
        const lc = ghostLine();
        const n = schritte || 9;
        const car = { ghost: { tileIndex: idx, tileMs: 1000 }, tileAt: 0 };
        const bahn = [];
        for (let k = 0; k < n; k++) {
          const ph = k / (n - 1);
          car.tileAt = Date.now() - ph * car.ghost.tileMs * ghostTileLenFactor(idx);
          bahn.push({ anteil: +ph.toFixed(2),
                      lenk: +ghostLineOffset(car).toFixed(3) });
        }
        // Wie schnell muss die Querlage sich bewegen? Groesster Schritt zwischen zwei
        // Messpunkten, umgerechnet auf einen ganzen Kachelanteil.
        let sprung = 0;
        for (let k = 1; k < bahn.length; k++) {
          sprung = Math.max(sprung, Math.abs(bahn[k].lenk - bahn[k - 1].lenk));
        }
        return {
          code: trackToCode(tiles),
          kachel: idx,
          bahn,
          start: bahn[0].lenk,
          ende: bahn[bahn.length - 1].lenk,
          spanne: +(bahn[bahn.length - 1].lenk - bahn[0].lenk).toFixed(3),
          proAnteil: +(sprung * (n - 1)).toFixed(3),
          tight: {
            enge: tileTightness(TILE_TYPE.ENGE),
            haarnadel: tileTightness(TILE_TYPE.HAIRPIN),
            kurve: tileTightness(TILE_TYPE.CURVE_RIGHT),
            klein: tileTightness(TILE_TYPE.KLEIN_RIGHT),
            weit: tileTightness(TILE_TYPE.WEIT_RIGHT),
            gerade: tileTightness(TILE_TYPE.STRAIGHT),
          },
          // Und dreht die Karte die neuen Kurven in die richtige Richtung?
          dreh: {
            weitR: ghostTurnOf(TILE_TYPE.WEIT_RIGHT),
            weitL: ghostTurnOf(TILE_TYPE.WEIT_LEFT),
            kleinR: ghostTurnOf(TILE_TYPE.KLEIN_RIGHT),
            kleinL: ghostTurnOf(TILE_TYPE.KLEIN_LEFT),
          },
          // Steht die Engstelle auch im Bild? Gezaehlt wird im gezeichneten SVG.
          gezeichnet: (() => {
            if (typeof renderTrackPreview !== 'function') return null;
            const html = renderTrackPreview(tiles, 0, { detailed: true }).html;
            return { eng: (html.match(/>ENG</g) || []).length,
                     sperren: (html.match(/#3a2a12/g) || []).length };
          })(),
        };
      } finally {
        currentTrackTiles = keepTiles;
        lineCache = null;
      }
    },

    // Die Palette des Editors von aussen lesbar - sie ist die Bedienseite der Kacheltypen.
    palettenProbe() {
      if (typeof TRACK_PALETTE === 'undefined') return null;
      return TRACK_PALETTE.map((p) => ({ key: p.key, typ: p.type(), cap: p.cap }));
    },

    // ---- LIEGT IM EDITOR-VOLLBILD DIE PALETTE IM BILD? --------------------------
    //
    // GEMELDET: "Du musst noch den Vollbildmodus des Streckeneditors fixen, aktuell sehe ich
    // die Streckenteile unten dann nicht."
    //
    // ---- WARUM DIESE SONDE DIE HOEHE VORGIBT --------------------------------------
    //
    // Nachgestellt werden konnte der Fehler nicht: bei 1024x768, 812x375 und 375x812 lag
    // die Palette hier immer im Bild. Die Lage haengt aber an der Fensterhoehe und am
    // Seitenverhaeltnis der Karte, und beides ist auf einem anderen Schirm anders. Eine
    // Sonde, die nur die EIGENE Groesse misst, prueft also genau den Fall, der schon geht.
    //
    // Deshalb wird der Kasten fuer die Messung auf eine feste Hoehe gezwungen. Das ist
    // nicht dasselbe wie ein echtes Fenster dieser Hoehe - Sicherheitszonen und
    // Systemleisten fehlen -, aber es prueft die Rasterrechnung, und die ist der Teil, der
    // kippen kann.
    //
    // GEMESSEN WIRD GEGEN DEN KASTEN und nicht gegen window.innerHeight: der Kasten IST im
    // Vollbild das Sichtfenster (position: fixed; inset: 0), und nur so ist eine erzwungene
    // Hoehe ueberhaupt aussagekraeftig.
    editorVollbildProbe(hoehen) {
      const host = $('track-fs-host');
      const pal = $('track-palette');
      const svg = $('track-preview-svg');
      if (!host || !pal || !svg) return null;
      const warFs = document.body.classList.contains('track-fs');
      const merkH = host.style.height;
      // ---- DEN REITER SICHTBAR MACHEN, sonst misst alles null ---------------------
      //
      // .tabpage ist display: none, solange der Reiter nicht aktiv ist - und ein Kind
      // eines unsichtbaren Elements hat keine Groesse, auch nicht mit position: fixed.
      // Der erste Anlauf dieser Sonde meldete deshalb bei JEDER Hoehe 0 px, und das sah
      // wie ein Fehler im Raster aus. Es war einer in der Messung.
      //
      // UND DIE ZWEI EBENEN HABEN VERSCHIEDENE KLASSEN: ein Reiter wird mit `active`
      // gezeigt (.tabpage.active), eine Unterseite mit `on` (.subpage.on). Der zweite
      // Anlauf setzte beidemal `active` und maass weiter null - eine Klasse, die es an
      // dieser Stelle nicht gibt, tut genau nichts.
      const seite = host.closest('.tabpage');
      const unter = host.closest('.subpage');
      const warAktiv = seite ? seite.classList.contains('active') : true;
      const warUnter = unter ? unter.classList.contains('on') : true;
      try {
        if (seite) seite.classList.add('active');
        if (unter) unter.classList.add('on');
        document.body.classList.add('track-fs');
        const aus = [];
        for (const h of (hoehen || [768, 480, 375, 320])) {
          host.style.height = h + 'px';
          // Ein Lesen erzwingen, damit das Raster neu gerechnet ist.
          void host.offsetHeight;
          const hk = host.getBoundingClientRect();
          const pk = pal.getBoundingClientRect();
          const sk = svg.getBoundingClientRect();
          aus.push({
            hoehe: h,
            rows: getComputedStyle(host).gridTemplateRows,
            // Der Abstand vom unteren Kastenrand: negativ heisst, die Palette ragt hinaus.
            luft: +(hk.bottom - pk.bottom).toFixed(1),
            paletteH: Math.round(pk.height),
            karteH: Math.round(sk.height),
            drin: pk.height > 0 && pk.bottom <= hk.bottom + 1,
          });
        }
        return { messungen: aus, teile: pal.children.length };
      } finally {
        host.style.height = merkH;
        if (!warFs) document.body.classList.remove('track-fs');
        if (seite && !warAktiv) seite.classList.remove('active');
        if (unter && !warUnter) unter.classList.remove('on');
      }
    },

    // ---- DIE DREI WETTERLAGEN AUF DER KACHEL ------------------------------------
    //
    // BESTELLT: "Lass mich mit der Regenumschalttaste im Cockpitview [...] auch noch
    // zwischen sonnig, Regen und wechselhaft hin und herschalten (default: Sonne)."
    //
    // Geklickt wird die ECHTE Kachel. Ein Prueflauf, der wxModusWeiter() direkt ruft,
    // prueft die Stufenfolge ohne die Verdrahtung - und die Verdrahtung ist hier die halbe
    // Aenderung (die Kachel hing an einem Zwei-Wege-Schalter).
    //
    // MIT GEFAELSCHTER UHR fuer den Verlaufsteil: wxWechselTick() fragt Date.now(), und
    // zwei bis sechs Minuten zu warten ist kein Prueflauf.
    wxModusProbe() {
      if (typeof wxModusSetzen !== 'function') return null;
      const box = $('race-wx-box');
      if (!box) return null;
      const merk = { modus: raceWxStart, wetter: weather, at: wxWechselAt };
      const echtNow = Date.now;
      try {
        // Von einer bekannten Lage aus, sonst haengt die Folge am Anfangszustand.
        wxModusSetzen('dry');
        const folge = [];
        for (let i = 0; i < 4; i++) {
          folge.push({ modus: raceWxStart, wetter: weather,
                       geplant: wxWechselAt !== null,
                       zeichen: $('race-wx-wechsel')
                         ? $('race-wx-wechsel').style.display !== 'none' : null });
          box.click();
        }
        // ---- UND LAEUFT DER VERLAUF WIRKLICH? ------------------------------------
        //
        // "wechselhaft" hat genau dann einen Wert, wenn es auch umschaltet. Die Uhr wird
        // vorgestellt, bis der geplante Zeitpunkt erreicht ist, und dann geprueft, ob
        // wxWechselTick() die Lage wirklich dreht.
        wxModusSetzen('wechsel');
        const vorher = weather;
        let uhr = echtNow.call(Date);
        Date.now = () => uhr;
        // Der Plan liegt 2 bis 6 Minuten voraus; sieben Minuten deckt das mit Reserve.
        uhr += 7 * 60000;
        wxWechselTick();
        const nachher = weather;
        return { folge, verlauf: { vorher, nachher, gedreht: vorher !== nachher,
                                   neuGeplant: wxWechselAt !== null } };
      } finally {
        Date.now = echtNow;
        wxModusSetzen(merk.modus === 'wechsel' ? 'wechsel' : merk.modus);
        weather = merk.wetter;
        wxWechselAt = merk.at;
      }
    },

    // ---- DIE WINDRICHTUNG IM REGENRADAR ------------------------------------------
    //
    // BESTELLT: "Wind im Regenradar aus zufaelliger Richtung kommen lassen (je
    // Rennstart oder Reload - nicht wechseln waehrend der Simulation)."
    //
    // ---- WARUM startRaceCountdown() HIER NICHT WIRKLICH GERUFEN WIRD ---------------
    //
    // Es raeumt Tank, Reifen, Rundenhistorie, Schadensanzeige und ein Dutzend anderer
    // Dinge auf und setzt bei freiem Training sofort raceGreen() in Gang - eine Sonde,
    // die das voll ausloest, muesste all das wieder herstellen, um einen laufenden
    // Fahrbetrieb nicht zu verstellen. Kein anderer Prueflauf in dieser Datei ruft die
    // Funktion direkt, aus genau diesem Grund.
    //
    // Gemessen wird deshalb ZWEIGETEILT: die eigentliche neue Logik (wxWindWuerfeln)
    // direkt und vollstaendig, und die VERDRAHTUNG ("ruft startRaceCountdown sie auf")
    // ueber den Quelltext der Funktion selbst - schwaecher als ein echter Aufruf, aber
    // ohne das Risiko, den Zustand einer laufenden Sitzung zu verstellen.
    windRichtungProbe() {
      if (typeof wxWindWuerfeln !== 'function' || typeof WX_WIND === 'undefined') return null;
      const merk = { x: WX_WIND.x, y: WX_WIND.y };
      try {
        // ---- 1. Einheitsvektor, ueber mehrere Wuerfe -----------------------------
        const laengen = [], winkel = new Set();
        for (let i = 0; i < 20; i++) {
          wxWindWuerfeln();
          laengen.push(+Math.hypot(WX_WIND.x, WX_WIND.y).toFixed(6));
          winkel.add(WX_WIND.x.toFixed(4) + ',' + WX_WIND.y.toFixed(4));
        }
        // ---- 2. Verdrahtung: startRaceCountdown() ruft wxWindWuerfeln() ----------
        const verdrahtet = typeof startRaceCountdown === 'function'
          && /\bwxWindWuerfeln\s*\(\s*\)/.test(startRaceCountdown.toString());
        return {
          einheitsvektor: { min: Math.min(...laengen), max: Math.max(...laengen) },
          gewuerfelt: laengen.length,
          unterschiedlicheRichtungen: winkel.size,
          rennstartRuftAuf: verdrahtet,
        };
      } finally {
        WX_WIND.x = merk.x; WX_WIND.y = merk.y;
      }
    },

    // ---- WAS DAS STEUERKREUZ IM COCKPIT SCHALTET --------------------------------
    //
    // BESTELLT: "D-Pad oben schaltet Reifentypen durch [...] D-Pad runter schaltet die
    // Tankmenge durch."
    //
    // Geprueft werden die FUNKTIONEN, die der Kreuz-Zweig ruft - pitMischungWeiter() und
    // pitVorwahlSchalten('refuel') -, und dazu, dass die Kachel danach dasselbe sagt.
    // Die Gamepad-Flanken selbst nachzustellen hiesse, einen Pad-Stummel an
    // navigator.getGamepads zu haengen; das prueft die Tastenabfrage und nicht die
    // Wirkung, und die Tastenabfrage hat ihren eigenen Test.
    //
    // DER RENNZUSTAND WIRD GESETZT: pitKachelStand() liest pitState, und ohne feste Lage
    // haengt das Ergebnis daran, ob gerade ein Stopp laeuft.
    kreuzSchaltProbe(o) {
      const opt = o || {};
      if (typeof pitMischungWeiter !== 'function'
          || typeof pitVorwahlSchalten !== 'function'
          || typeof pitKachelStand !== 'function') return null;
      const merk = { wunsch: mischungWunsch, vorwahl: pitVorwahl.refuel,
                     ps: pitState, wetter: weather, reifen: tyres };
      try {
        pitState = 'off';
        weather = opt.wetter || 'dry';
        tyres = opt.reifen || 'mittel';
        mischungWunsch = null;
        pitVorwahl.refuel = null;

        // Erst der Ausgangsstand: die Vorgabe muss das sein, was aufgezogen ist.
        const start = pitKachelStand();

        // Reifen durchschalten, einmal rundherum plus einen Schritt.
        const mixFolge = [];
        for (let i = 0; i < 5; i++) {
          mixFolge.push(pitKachelStand().mix);
          pitMischungWeiter();
        }

        // Tankmenge durchschalten.
        pitVorwahl.refuel = null;
        const tankFolge = [];
        for (let i = 0; i < 4; i++) {
          tankFolge.push(pitKachelStand().tankWort);
          pitVorwahlSchalten('refuel');
        }

        // Und die Warnung: Regen auf der Bahn, Slicks gewaehlt.
        mischungWunsch = 'mittel';
        weather = 'rain';
        const nassMitSlick = pitKachelStand();
        mischungWunsch = 'regen';
        const nassMitRegen = pitKachelStand();

        return { startMix: start.mix, startTank: start.tankWort,
                 mixFolge, tankFolge,
                 warnung: { slickImRegen: nassMitSlick.mixWarnung,
                            regenImRegen: nassMitRegen.mixWarnung } };
      } finally {
        mischungWunsch = merk.wunsch;
        pitVorwahl.refuel = merk.vorwahl;
        pitState = merk.ps;
        weather = merk.wetter;
        tyres = merk.reifen;
      }
    },

    // ---- TANKT DER STOPP AUF DAS GEWAEHLTE ZIEL, ODER IMMER VOLL? ---------------
    //
    // BESTELLT: "nicht zwischen ja und nein, sondern zwischen nein, 55 l (50 %) und voll".
    //
    // Geprueft wird ueber pitLaneTick(), also die ECHTE Arbeitsschleife, und nicht ueber
    // eine nachgerechnete Formel. Genau dort stand vorher das feste `100 - fuel`, und nur
    // dort zeigt sich, ob das Ziel wirklich ankommt.
    //
    // Das Auto muss dafuer STEHEN (PIT_STANDSTILL_KMH), sonst verlaesst pitLaneTick() den
    // Boxenstopp im ersten Takt - deshalb Tempo und Gas auf null.
    tankZielProbe(o) {
      const opt = o || {};
      const st = physEngine.state;
      const merk = { fuel, pitState, pitPlan, pitDone, pitLastTick, pitReady,
                     pitStandElapsed, pitEmptyElapsed, pitFuelGained,
                     kmh: st.speedKmh, gas: throttleY };
      const echtNow = Date.now;
      try {
        let uhr = echtNow.call(Date);
        Date.now = () => uhr;
        st.speedKmh = 0;
        throttleY = 0;
        fuel = opt.start === undefined ? 10 : opt.start;
        pitState = 'servicing';
        pitPlan = { refuel: opt.ziel === undefined ? 50 : opt.ziel,
                    tyres: false, repair: false };
        pitDone = { refuel: false, tyres: false, repair: false };
        pitReady = false;
        pitStandElapsed = 0; pitEmptyElapsed = 0; pitFuelGained = 0;
        pitLastTick = uhr;
        const verlauf = [];
        for (let i = 0; i < (opt.takte || 300); i++) {
          uhr += 100;
          pitLaneTick();
          verlauf.push(+fuel.toFixed(2));
          if (pitDone.refuel) break;
        }
        return { endstand: +fuel.toFixed(2), fertig: !!pitDone.refuel,
                 takte: verlauf.length, getankt: +pitFuelGained.toFixed(2),
                 verlauf: verlauf.slice(0, 6) };
      } finally {
        Date.now = echtNow;
        fuel = merk.fuel; pitState = merk.pitState; pitPlan = merk.pitPlan;
        pitDone = merk.pitDone; pitLastTick = merk.pitLastTick;
        pitReady = merk.pitReady; pitStandElapsed = merk.pitStandElapsed;
        pitEmptyElapsed = merk.pitEmptyElapsed; pitFuelGained = merk.pitFuelGained;
        st.speedKmh = merk.kmh; throttleY = merk.gas;
      }
    },

    // Die drei Stufen und ihre Woerter von aussen lesbar - dieselben Funktionen, die die
    // Zeile im Boxenschirm benutzt.
    tankStufenProbe() {
      if (typeof tankZielNorm !== 'function') return null;
      return {
        stufen: TANK_STUFEN.slice(),
        // Durchschalten, einmal rundherum plus einen Schritt: die Folge muss sich schliessen.
        folge: (function () {
          const out = [];
          let v = 0;
          for (let i = 0; i < 4; i++) { out.push(v); v = tankZielWeiter(v); }
          return out;
        }()),
        // Und was aus Altwerten wird.
        alt: { wahr: tankZielNorm(true), falsch: tankZielNorm(false),
               nichts: tankZielNorm(null), daneben: tankZielNorm(60),
               unsinn: tankZielNorm('x') },
        worte: TANK_STUFEN.map((v) => tankZielWort(v)),
      };
    },

    // ---- DIE SEKTORZEITEN IN DER RUNDENTABELLE ----------------------------------
    //
    // BESTELLT: "Bei mehreren Sektoren die Sub-Zeiten (also Zeit je Sektor) im Zeiten-Screen
    // anzeigen."
    //
    // Wie beim Positionsdiagramm ueber den ECHTEN Zeichenweg: Attrappen in die Garage,
    // sectorHistory gefuellt, renderRaceResults() schreibt die Tabelle ins Dokument. Und
    // wie dort wird der vorige Inhalt zurueckgelegt und nicht neu gezeichnet - ein
    // Messaufruf darf nichts hinterlassen.
    sektorTabelleProbe(o) {
      const opt = o || {};
      const merkGarage = garage.slice();
      const merkSc = sectorCount;
      const merkSh = sectorHistory.slice();
      const wirt = $('race-results-laps');
      const wirt2 = $('race-results-body');
      const merkHtml = wirt ? wirt.innerHTML : null;
      const merkHtml2 = wirt2 ? wirt2.innerHTML : null;
      try {
        garage.length = 0;
        // Ein Fahrerauto und ein Ghost - damit sich zeigt, dass die Splits NUR in der
        // Fahrerspalte stehen.
        const runden = opt.runden || [[3000, 4000, 5000], [3100, 3800, 5200]];
        const mk = (rolle, alias, cid, ms) => ({
          device: { id: 'sonde-' + alias, name: alias }, alias, role: rolle, colorId: cid,
          race: { laps: ms.map((x, i) => ({ lap: i + 1, ms: x })) },
        });
        garage.push(mk('steuern', 'Fahrer', 'rot', runden.map((r) => r.reduce((a, b) => a + b, 0))));
        garage.push(mk('ghost', 'G1', 'blau', [12100, 12300]));
        sectorCount = opt.sektoren === undefined ? 3 : opt.sektoren;
        sectorHistory.length = 0;
        runden.forEach((r) => sectorHistory.push(r.slice()));
        renderRaceResults();
        const html = wirt ? wirt.innerHTML : '';
        // Ausgezaehlt: wie viele Zellen tragen eine Sektorzeile, und wie viele Bestwerte
        // sind hervorgehoben.
        const zeilen = (html.match(/S1 /g) || []).length;
        const beste = (html.match(/color:var\(--good\); font-weight:700">S/g) || []).length;
        return { zeilen, beste, laenge: html.length,
                 html: opt.html ? html : null };
      } finally {
        garage.length = 0;
        merkGarage.forEach((c) => garage.push(c));
        sectorCount = merkSc;
        sectorHistory.length = 0;
        merkSh.forEach((x) => sectorHistory.push(x));
        if (wirt) wirt.innerHTML = merkHtml === null ? '' : merkHtml;
        if (wirt2) wirt2.innerHTML = merkHtml2 === null ? '' : merkHtml2;
      }
    },

    // ---- DAS POSITIONSDIAGRAMM, mit Attrappen in der Garage ----------------------
    //
    // GEMELDET: "Hier sehe ich die schwarze Linie auf schwarzem Hintergrund nicht."
    //
    // Geprueft wird der ECHTE Zeichenweg: die Attrappen gehen in die Garage, von der
    // raceAllCars() liest, und renderPositionPlot() schreibt sein SVG in das Dokument. Ein
    // Prueflauf, der das SVG selbst zusammensetzte, prueefte seine eigene Kopie.
    //
    // Die Garage wird im finally wiederhergestellt UND neu gezeichnet - ein Messaufruf, der
    // ein Diagramm mit Sonden im Dokument stehen laesst, veraendert, was der Nutzer sieht.
    positionsPlotProbe(o) {
      const opt = o || {};
      const merkGarage = garage.slice();
      // Und der VORIGE Inhalt des Wirtes. Ihn am Ende neu zu ZEICHNEN waere nicht dasselbe:
      // bei leerer Garage schreibt renderPositionPlot seinen Platzhaltertext hinein, und der
      // stand dann im Dokument, obwohl der Nutzer nie ein Ergebnis geoeffnet hat. Genau
      // daran sind zwei Sprachpruefungen haengengeblieben - ein Messaufruf darf nichts
      // hinterlassen.
      const wirt = $('race-position-plot');
      const merkHtml = wirt ? wirt.innerHTML : null;
      try {
        garage.length = 0;
        (opt.farben || ['schwarz', 'rot', 'weiss']).forEach((cid, i) => {
          garage.push({ device: { id: 'sonde-plot-' + i, name: 'Sonde ' + i },
                        alias: 'Sonde ' + i, role: 'ghost', colorId: cid, ghost: null,
                        race: { laps: [{ ms: 7000 + i * 220 }, { ms: 7100 + i * 160 },
                                       { ms: 6900 + i * 310 }, { ms: 7050 + i * 90 }] } });
        });
        renderPositionPlot();
        const host = $('race-position-plot');
        const html = host ? host.innerHTML : '';
        // Ausgezaehlt statt nur "kommt vor": die Zusage ist, dass JEDE Linie einen Saum
        // hat, und das ist eine Anzahl und kein Vorhandensein.
        const saeume = (html.match(/<polyline[^>]*stroke="rgba\(255,255,255,0\.55\)"/g) || []).length;
        const linien = (html.match(/<polyline[^>]*stroke="#/g) || []).length;
        return { saeume, linien, laenge: html.length,
                 saumVorLinie: html.indexOf('rgba(255,255,255,0.55)') < html.indexOf('stroke="#'),
                 html: opt.html ? html : null };
      } finally {
        garage.length = 0;
        merkGarage.forEach(c => garage.push(c));
        if (wirt) wirt.innerHTML = merkHtml === null ? '' : merkHtml;
      }
    },

    // ---- LAESST SICH EIN GEPARKTES AUTO WIEDER WACHRUETTELN? ---------------------
    //
    // GEMELDET: "Nach mehrmaligem Abfliegen blinken Ghosts nur noch. Warum? Wenn Gyro da
    // ein paar Sekunden nichts meldet und ich sie dann kurz kopfueber halte oder schuettele,
    // sollen sie immer weiterfahren koennen."
    //
    // DER PRUEFLAUF SPIELT GENAU DEN HERGANG NACH, in drei Abschnitten:
    //
    //     getragen     grosse, wechselnde Gyro-Werte - das Auto wird aufgehoben und
    //                  zurueckgestellt, und zwar WAEHREND der Lernphase. Das ist der Fall,
    //                  den man nach einem Abflug immer hat: man greift sofort zu.
    //     ruhig        es liegt wieder
    //     geschuettelt jemand ruettelt absichtlich
    //
    // Danach MUSS es fahren. Mit der alten Median-Lernphase tat es das nicht: sie lernte
    // den Wert des Herumtragens als Ruhewert, und die Schwelle stand dauerhaft ausser
    // Reichweite.
    //
    // MIT GEFAELSCHTER UHR, weil die Lernphase 1,2 Sekunden dauert und ein Prueflauf, der
    // wirklich wartet, den ganzen Selbsttest aufhaelt. Date.now() wird nur fuer die Dauer
    // des Laufs ersetzt und im finally zurueckgegeben.
    schuettelProbe(o) {
      const opt = o || {};
      const echteNow = Date.now;
      let uhr = echteNow.call(Date);
      const car = { alias: 'Sonde-Ruettel', role: 'ghost', parked: null, shake: null,
                    ghost: null, rx: null };
      const paket = (v1, v3) => {
        const b = new Uint8Array(19);
        b[1] = v1 & 0xff; b[3] = v3 & 0xff;
        return b;
      };
      const takt = (v1, v3, ms) => {
        uhr += (ms === undefined ? 45 : ms);
        shakeNotify(car, paket(v1, v3));
      };
      const stand = (phase) => ({ phase, geparkt: car.parked || null,
                                  wert: car.shakeValue === undefined ? null : car.shakeValue,
                                  schwelle: car.shakeThreshold === undefined
                                            ? null : car.shakeThreshold });
      try {
        Date.now = () => uhr;
        parkCar(car, opt.grund || 'Prueflauf');
        const stufen = [];
        // 1. GETRAGEN, und zwar die ganze Lernphase hindurch.
        const tragenMs = opt.tragenMs === undefined ? 1400 : opt.tragenMs;
        for (let t = 0; t < tragenMs; t += 45) {
          const a = (Math.floor(t / 45) % 3) * 40 - 40;
          takt(a, -a);
        }
        stufen.push(stand('getragen'));
        // 1b. EINE LUECKE IM MELDESTROM, wenn bestellt: "wenn Gyro da ein paar Sekunden
        //     nichts meldet". Ein einziger Takt mit grossem Zeitsprung - genau so sieht ein
        //     Abriss von aussen aus.
        if (opt.lueckeMs) {
          takt(0, 0, opt.lueckeMs);
          stufen.push(stand('nach der Luecke'));
        }
        // 2. HINGESTELLT: die Werte stehen still, das Fenster laeuft auf null.
        if (opt.ohneRuhe !== true) {
          for (let i = 0; i < 40; i++) takt(2, -2);
          stufen.push(stand('ruhig'));
        }
        // 3. GESCHUETTELT.
        for (let i = 0; i < 20; i++) { const a = (i % 2) ? 60 : -60; takt(a, -a); }
        stufen.push(stand('geschuettelt'));
        return { stufen, entparkt: !car.parked };
      } finally {
        Date.now = echteNow;
      }
    },

    // ---- WIE LANGE HAELT EIN SATZ REIFEN, UND WIE LANGE DER TANK? -----------------
    //
    // BESTELLT: "Reifenverschleiss erhoehen auf die doppelte oder dreifache Geschwindigkeit
    // (simuliere mal, sodass weiche Reifen kaputt sind, lange bevor der Tank leer ist)."
    //
    // Also wird genau das gemessen und nicht geschaetzt: ein Stint gefahren, bis der Satz
    // durch ist, und DERSELBE Gasverlauf durch die Tankrechnung geschickt.
    //
    // DER GASVERLAUF IST DER GEMEINSAME BEZUG. Der Tank leert sich nach
    // |gas| * dt * Verbrauch (fuelDrainPerSec in 70-race.js), der Verschleiss haengt an
    // Walkarbeit und Temperatur - zwei Groessen mit ganz verschiedenen Treibern. Sie an
    // DERSELBEN Fahrt zu messen ist der einzige ehrliche Weg zu ihrem Verhaeltnis.
    //
    // ES WIRD GELENKT, und zwar wechselnd. Verschleiss entsteht aus Arbeit, und geradeaus
    // Vollgas ist der SCHWAECHSTE Fall - ein Stint ohne Kurven liesse die Reifen laenger
    // halten als jede echte Runde und wuerde die Antwort schoenen.
    reifenStintProbe(o) {
      const opt = o || {};
      const e = physEngine, st = e.state;
      const merk = OMEGA_TEST.zustandKopie(st);
      const merkCfg = { rate: e.config.tyreWearRate, mix: e.config.tyreWearMix,
                        eff: e.config.tyreEffect };
      try {
        if (opt.rate !== undefined) e.config.tyreWearRate = opt.rate;
        e.config.tyreWearMix = opt.mix === undefined ? 1 : opt.mix;
        e.config.tyreEffect = opt.tyreEffect === undefined ? 1 : opt.tyreEffect;
        // Frischer Satz, Umgebungstemperatur: ein Stint faengt kalt an. Ohne das Zuruecksetzen
        // erbt die Messung die Reifen des vorigen Laufs.
        for (let i = 0; i < 4; i++) {
          st.tyreWear4[i] = 0;
          st.tyreTemp4[i] = e.config.tyreAmbientC;
        }
        st.tyreWear = 0; st.tyreWearL = 0; st.tyreWearR = 0;
        st.tyreTempC = e.config.tyreAmbientC;
        st.speedKmh = 0; st.virtualSpeed = 0; st.driveMode = 'forward';

        const dt = CONTROL_SEND_INTERVAL_MS / 1000;
        const gas = opt.throttle === undefined ? 0.85 : opt.throttle;
        const lenkAmp = opt.lenk === undefined ? 0.55 : opt.lenk;
        const drain = opt.drain === undefined ? 3 : opt.drain;
        const maxS = opt.maxSekunden || 900;
        let tank = 100, tSec = 0;
        let reifenSek = null, reifen80 = null, tankSek = null;
        while (tSec < maxS) {
          const lenk = Math.sin(tSec * 1.1) * lenkAmp;
          e.update({ steering: lenk, throttle: gas, brake: 0, headlights: false }, dt);
          tank = Math.max(0, tank - Math.abs(gas) * dt * drain);
          tSec += dt;
          if (reifen80 === null && st.tyreWear >= 0.8) reifen80 = +tSec.toFixed(2);
          if (reifenSek === null && st.tyreWear >= 0.999) reifenSek = +tSec.toFixed(2);
          if (tankSek === null && tank <= 0) tankSek = +tSec.toFixed(2);
          if (reifenSek !== null && tankSek !== null) break;
        }
        return { reifenSek, reifen80, tankSek,
                 wearEnde: +st.tyreWear.toFixed(4),
                 tempEnde: +st.tyreTempC.toFixed(1),
                 gas, drain,
                 rate: e.config.tyreWearRate, mix: e.config.tyreWearMix };
      } finally {
        e.config.tyreWearRate = merkCfg.rate;
        e.config.tyreWearMix = merkCfg.mix;
        e.config.tyreEffect = merkCfg.eff;
        OMEGA_TEST.zustandZurueck(st, merk);
      }
    },

    // Die Reifenmischung von aussen setzen. Ein Wechsel geht in der App nur ueber einen
    // Boxenstopp, und den fuer eine Anzeigepruefung nachzuspielen waere ein halbes Rennen.
    // ALTE NAMEN BLEIBEN GUELTIG: 'slick' und 'wet' sind seit v0.5.18 'mittel' und
    // 'regen', und die bestehenden Pruefungen benutzen die alten. Ein stiller
    // Umbenennungsdurchlauf haette sie umgeschrieben und damit den Beweis verwischt, dass
    // die Vorgabe bitgleich geblieben ist.
    // ---- Die Rundenzaehler-Fanfare, ohne zu hoeren ---------------------------------
    //
    // Sie gibt ihre Partitur zurueck: Anzahl Toene und Gesamtdauer. Damit ist pruefbar,
    // dass sie ueberhaupt spielt und wie lange - der Klang selbst ist eine Sache fuers Ohr,
    // die Laenge nicht (eine Fanfare, die zehn Sekunden dauert, ist ein Fehler).
    // ---- Taugt das Drehsignal zum Gegensteuern? -------------------------------------
    //
    // DIE MESSUNG, DIE VOR DEM REGLER KOMMT. Der beobachtete Fall gibt sie vor: aus dem
    // Stand auf rutschigem Boden Vollgas, geradeaus, OHNE Lenkeingabe. Wenn das Auto dabei
    // ausbricht und Byte 3 ausschlaegt, ist bewiesen, was das Gegensteuern braucht - dass
    // das Signal eine Drehung OHNE Lenkeingabe anzeigt.
    //
    // Sie zeichnet auf und urteilt nicht: zurueck kommen die Werte, nicht ein "taugt" oder
    // "taugt nicht". Ob 0,3 viel ist, entscheidet das Auto auf dem Teppich und nicht diese
    // Funktion.
    //
    // `ms` ist die Aufzeichnungsdauer. Gefahren wird NICHT von hier aus - der Nutzer gibt
    // selbst Gas; diese Probe schaut nur zu. Alles andere waere eine Fahrbewegung, die
    // jemand ausloest, der nicht am Tisch sitzt.
    driftProbe(ms) {
      const dauer = ms || 4000;
      const start = Date.now();
      const punkte = [];
      return new Promise((fertig) => {
        const t = setInterval(() => {
          let g = null, span = null, v = null, lenk = null;
          try {
            if (typeof gyroRaw === 'object' && gyroRaw) { g = gyroRaw.x; span = gyroRaw.span; }
            v = physEngine.state.speedKmh * REAL_SCALE;
            lenk = physicsEnabled ? physOutSteer : steerX;
          } catch (e) { /* noch nichts da */ }
          punkte.push({ t: Date.now() - start, gyro: g, span, kmh: v, lenk });
          if (Date.now() - start >= dauer) {
            clearInterval(t);
            const mitTempo = punkte.filter(p => p.kmh !== null && Math.abs(p.kmh) > 6);
            const gerade = mitTempo.filter(p => Math.abs(p.lenk || 0) < 0.08);
            const betrag = (a) => a.length
              ? +(a.reduce((x, p) => x + Math.abs(p.gyro || 0), 0) / a.length).toFixed(2) : null;
            fertig({
              punkte: punkte.length,
              mitTempo: mitTempo.length,
              geradeaus: gerade.length,
              // Der eigentliche Wert: schlaegt das Signal aus, WAEHREND nicht gelenkt wird?
              gyroGeradeaus: betrag(gerade),
              gyroInsgesamt: betrag(mitTempo),
              spanEnde: punkte.length ? punkte[punkte.length - 1].span : null,
              verlauf: punkte.filter((_, i) => i % 5 === 0).slice(0, 40),
            });
          }
        }, 100);
      });
    },

    // Der Drift-Zuschlag selbst, ohne Auto: gefragt wird die FUNKTION, nicht die Fahrt.
    driftZuschlag(gyro, span, kmh, steer, staerke) {
      if (typeof driftGegenlenken !== 'function') return null;
      const merkG = (typeof gyroRaw === 'object' && gyroRaw) ? { x: gyroRaw.x, span: gyroRaw.span } : null;
      const merkV = physEngine.state.speedKmh;
      const merkS = gegenlenkStaerke;
      try {
        if (merkG) { gyroRaw.x = gyro; gyroRaw.span = span; }
        physEngine.state.speedKmh = kmh / REAL_SCALE;
        if (staerke !== undefined) gegenlenkStaerke = staerke;
        return +driftGegenlenken(steer).toFixed(4);
      } finally {
        if (merkG) { gyroRaw.x = merkG.x; gyroRaw.span = merkG.span; }
        physEngine.state.speedKmh = merkV;
        gegenlenkStaerke = merkS;
      }
    },

    // ---- Die Karte im Uebersichtsschirm: kostet ein Takt wirklich nichts? -----------
    //
    // DAS IST DIE ZUSICHERUNG, auf der die Trennung steht. renderTrackPreview kostet
    // gemessen rund 94 ms, weil es die Ideallinie mitoptimiert; deshalb wird die Strecke
    // einmal gezeichnet und danach werden nur Punkte gesetzt. Wenn dieser Weg auch nur
    // ein paar Millisekunden kostet, ist die Trennung wertlos und der Sendetakt in Gefahr.
    ovKarteProbe(cars, wdh) {
      const host = document.getElementById('ov-karte');
      if (!host) return null;
      const svg = host.querySelector('svg');
      if (!svg || typeof karteAutosSetzen !== 'function') return null;
      // Die Geometrie liegt beim Renderer; hier wird sie ueber einen frischen Aufbau geholt,
      // damit die Probe auch dann etwas messen kann, wenn der Schirm nie offen war.
      const r = renderTrackPreview(currentTrackTiles, null, { detailed: true, cars: [] });
      const n = wdh || 50;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) karteAutosSetzen(svg, r.geo, cars || []);
      const t1 = performance.now();
      // Dieselbe Umstellung wie in trackMarks(): eine Gruppe je Auto, verborgen ueber
      // visibility statt ueber Radius null - eine Gruppe hat kein r.
      const punkte = [...svg.querySelectorAll('g.karte-autos > g')]
        .filter(g => g.getAttribute('visibility') !== 'hidden')
        .map(g => {
          const m = /translate\(([-\d.]+) ([-\d.]+)\)\s*rotate\(([-\d.]+)\)/
            .exec(g.getAttribute('transform') || '');
          const body = g.querySelector('rect');
          return { x: m ? +m[1] : null, y: m ? +m[2] : null, winkel: m ? +m[3] : null,
                   fill: body ? body.getAttribute('fill') : null };
        });
      const kuerzel = [...svg.querySelectorAll('g.karte-autos text')]
        .map(t => t.textContent).filter(Boolean);
      return { jeAufrufMs: +((t1 - t0) / n).toFixed(3), punkte, kuerzel };
    },

    // ---- Die Ghost-Querlage Stufe fuer Stufe --------------------------------------
    //
    // "Es sieht nicht aus, als fuehren sie die Ideallinie" ist mit einem MITTELWERT nicht zu
    // beantworten: ein grosser mittlerer Lenkbetrag kann auch eine konstante Schraeglage
    // sein. Was eine Ideallinie ausmacht, ist die FORM - aussen, Scheitel, aussen - und ob
    // sie den Weg bis zum gesendeten Byte ueberlebt.
    //
    // Diese Probe zeichnet je Takt vier Groessen auf und macht damit sichtbar, WO die Form
    // verlorengeht:
    //
    //     linie    der rohe Linienversatz, -1 bis 1        (was die Karte sagt)
    //     wunsch   die Summe aller Querversaetze           (was der Ghost will)
    //     servo    out.servoAngle nach der Physik          (was uebrigbleibt)
    //     byte     round(servo * 127)                      (was gesendet wird)
    //
    // Dazwischen liegen Expo, die Tempobeschneidung (maxSteerLimit), die Ratenbegrenzung
    // (steerDaempfungMs) und der Reibkreis. Jede davon kann eine Form flachdruecken, und der
    // Unterschied zwischen `wunsch` und `servo` sagt, welche.
    ghostLinieTrace(o) {
      const opt = o || {};
      const takte = opt.takte || 400;
      const dtMs = 45;
      if (!currentTrackTiles || currentTrackTiles.length < 3) return null;
      const merkCfg = JSON.parse(JSON.stringify(ghostCfg));
      const echtNow = Date.now;
      let car = null;
      const reihe = [];
      try {
        if (opt.cfg) Object.assign(ghostCfg, opt.cfg);
        car = { device: { id: 'trace', name: 'Trace' }, role: 'ghost', colorId: 'rot',
                tileCode: 0x02, tileAt: Date.now(), yaw: 0 };
        let uhr = echtNow();
        Date.now = () => uhr;
        startGhost(car);
        car.ghost.freeRun = true;
        const g = car.ghost;
        g.tileIndex = 0;
        g.tileStart = uhr;
        car.tileAt = uhr;
        car.tileCount = 0;
        g.tileMs = opt.tileMs || 700;
        for (let k = 0; k < takte; k++) {
          uhr += dtMs;
          // DIE KACHEL WEITERZAEHLEN, WIE ES DIE MELDUNGEN TAETEN - und dazu gehoert
          // car.tileAt. Ohne das steht ghostTilePhase() dauerhaft auf 1, weil es die Zeit
          // seit der letzten Kachelmeldung misst und nicht seit g.tileStart.
          //
          // `echtMs` ist die WIRKLICHE Dauer dieser Kachel; sie darf sich von der
          // geschaetzten unterscheiden, denn genau darum geht es hier: der Ghost bremst in
          // Kurven ab, also dauern sie laenger, als der laufende Mittelwert erwartet.
          // `kurvenFaktor` streckt die WIRKLICHE Dauer der Kurven ueber das hinaus, was der
          // Laengenfaktor erwartet - genau das tut curveSlow am echten Auto: der Ghost gibt
          // in einer Kurve Tempo ab, also dauert sie laenger, als ihre LAENGE vorhersagt.
          // Mit curveSlow 0,15 sind das rund 1,18; die Haarnadel bekommt das Doppelte,
          // also rund 1,4.
          const vorTile = g.tileIndex;
          const istKurve = currentTrackTiles[g.tileIndex].type !== 2;
          const kf = (istKurve && opt.kurvenFaktor) ? opt.kurvenFaktor : 1;
          const echtMs = (opt.tileMs || 700) * kf
            * (opt.echteLaenge === false ? 1 : ghostTileLenFactor(g.tileIndex));
          if (uhr - g.tileStart >= echtMs) {
            g.tileIndex = (g.tileIndex + 1) % currentTrackTiles.length;
            g.tileStart = uhr;
            car.tileAt = uhr;
            car.tileCount = (car.tileCount + 1) & 0xff;
            if (opt.lernen !== false) {
              ghostNoteTileTime(car, echtMs, currentTrackTiles[vorTile].type);
            }
          }
          const vorher = { linie: ghostLineOffset(car), phase: ghostTilePhase(car),
                           tile: g.tileIndex, typ: currentTrackTiles[g.tileIndex].type };
          ghostTick(car);
          reihe.push({
            t: k * dtMs,
            tile: vorher.tile, typ: vorher.typ, phase: +vorher.phase.toFixed(2),
            linie: +vorher.linie.toFixed(3),
            wunsch: +(g.querSoll === undefined ? 0 : g.querSoll).toFixed(3),
            // Der GESENDETE Wert. Bei aktivem Pruefstand geht der feste Versatz am
            // Servoweg vorbei, und servoAngle allein wuerde ihn nicht sehen.
            servo: +(ghostQuerTestAn() ? ghostQuerTest
                     : ((g.engine && g.engine.outputs) ? g.engine.outputs.servoAngle : 0)).toFixed(3),
          });
        }
      } catch (e) {
        return { fehler: String(e && e.message || e) };
      } finally {
        Date.now = echtNow;
        try { if (car) stopGhost(car); } catch (e2) { /* egal */ }
        Object.assign(ghostCfg, merkCfg);
      }
      // Auswertung: je Kachel die SPANNE des gesendeten Bytes. Eine Ideallinie hat in einer
      // Kurve eine grosse Spanne (aussen -> innen -> aussen); eine konstante Schraeglage
      // hat null, egal wie gross ihr Betrag ist.
      const proKachel = {};
      for (const r of reihe) {
        const b = Math.round(r.servo * 127);
        const k = r.tile;
        if (!proKachel[k]) proKachel[k] = { typ: r.typ, min: b, max: b, n: 0, sumAbs: 0 };
        const p = proKachel[k];
        p.min = Math.min(p.min, b); p.max = Math.max(p.max, b);
        p.n++; p.sumAbs += Math.abs(b);
      }
      const kacheln = Object.keys(proKachel).map((k) => ({
        tile: +k, typ: proKachel[k].typ,
        spanne: proKachel[k].max - proKachel[k].min,
        mittel: Math.round(proKachel[k].sumAbs / proKachel[k].n),
      }));
      // Und der VERLUST: wieviel vom Wunsch kommt am Servo an?
      // WIEVIEL EINER KACHEL KLEBT BEI PHASE 1? ghostTilePhase() deckelt auf 1, und ab
      // dort steht der Linienversatz still - der Ghost faehrt den Rest der Kachel mit
      // KONSTANTER Schraeglage. Das ist die Zahl, die "stumpf ihre Spur" beziffert.
      const geklebt = reihe.filter((r) => r.phase >= 0.995).length / Math.max(1, reihe.length);
      const geklebtKurve = (() => {
        const k = reihe.filter((r) => r.typ !== 2);
        return k.length ? k.filter((r) => r.phase >= 0.995).length / k.length : null;
      })();
      const mitWunsch = reihe.filter((r) => Math.abs(r.wunsch) > 0.05);
      const anteil = mitWunsch.length
        ? mitWunsch.reduce((a, r) => a + Math.abs(r.servo) / Math.abs(r.wunsch), 0) / mitWunsch.length
        : null;
      return {
        takte: reihe.length,
        phaseGeklebt: +geklebt.toFixed(3),
        phaseGeklebtInKurven: geklebtKurve === null ? null : +geklebtKurve.toFixed(3),
        tileMsEnde: car.ghost ? Math.round(car.ghost.tileMs) : null,
        linieSpanne: +(Math.max(...reihe.map(r => r.linie)) - Math.min(...reihe.map(r => r.linie))).toFixed(3),
        wunschSpanne: +(Math.max(...reihe.map(r => r.wunsch)) - Math.min(...reihe.map(r => r.wunsch))).toFixed(3),
        servoSpanne: +(Math.max(...reihe.map(r => r.servo)) - Math.min(...reihe.map(r => r.servo))).toFixed(3),
        anteilServoVomWunsch: anteil === null ? null : +anteil.toFixed(3),
        kacheln,
        verlauf: reihe.filter((_, i) => i % 4 === 0).slice(0, 60),
      };
    },

    fanfareProbe() {
      if (typeof playRaceEndFanfare !== 'function') return null;
      return playRaceEndFanfare();
    },

    tyreSet(kind) {
      if (typeof tyres === 'undefined') return null;
      const ALIAS = { wet: 'regen', slick: 'mittel' };
      const m = ALIAS[kind] || kind;
      tyres = (typeof TYRE_MIX === 'object' && TYRE_MIX[m]) ? m : 'mittel';
      applySurface();
      return { reifen: tyres,
               profil: document.body.classList.contains('tyres-wet'),
               verschleiss: +(physEngine.config.tyreWearMix || 1).toFixed(4),
               grip: +physEngine.config.gripScale.toFixed(4) };
    },

    // ---- Die Mischungen als Tabelle, von aussen lesbar ---------------------------
    //
    // Damit ein Test nachrechnen kann, was oben behauptet wird: mittel ist bitgleich zum
    // alten slick, und bei Staerke 0 sind alle drei Slicks derselbe Reifen.
    tyreMixProbe(staerke) {
      if (typeof TYRE_MIX === 'undefined') return null;
      const regler = document.getElementById('setting-tyre-mix');
      const merkR = regler ? regler.value : null;
      const merkT = tyres;
      try {
        if (staerke !== undefined && regler) {
          regler.value = staerke;
          regler.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const aus = {};
        for (const m of Object.keys(TYRE_MIX)) {
          tyres = m;
          applySurface();
          aus[m] = { grip: +physEngine.config.gripScale.toFixed(5),
                     aqua: +physEngine.config.aquaplaning.toFixed(5),
                     verschleiss: +(physEngine.config.tyreWearMix || 1).toFixed(5) };
        }
        return aus;
      } finally {
        tyres = merkT;
        if (regler && merkR !== null) {
          regler.value = merkR;
          regler.dispatchEvent(new Event('input', { bubbles: true }));
        }
        applySurface();
      }
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
    // Das Wetter von aussen setzen UND die Front gleich durchziehen. Zwei Dinge, die immer
    // zusammen gebraucht werden: setWeather() setzt nur das Ziel, den Weg macht wxTick in
    // 80-ms-Schritten - ein Prueflauf mit gefaelschter Uhr wartet darauf ewig.
    wetterSetzen(next) {
      if (typeof setWeather !== 'function') return null;
      setWeather(next);
      this.wxSet(next === 'rain' ? 0 : -1);
      return { weather, front: +wxFront.toFixed(3),
               naesse: +wxRainLevel().toFixed(3) };
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
