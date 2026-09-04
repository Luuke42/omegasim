  // =========================================================================
  // Die Fahrphysik
  // =========================================================================
  // Eine Klasse, keine Abhaengigkeit nach draussen ausser REAL_SCALE, clamp,
  // CONTROL_SEND_INTERVAL_MS und den Ton-Attrappen. Reibkreis, Gewichtsverlagerung mit
  // zwei Zeitkonstanten, Gaenge, Reifentemperatur, Ausrollen aus drei Anteilen.
  //
  // Alle Zahlen sind an reale Groessen gebunden statt an 0..1-Einheiten, damit man
  // ueber sie reden kann: km/h, Sekunden, Prozent. Wer eine aendert, sollte die
  // Kalibrierung danach nachrechnen lassen (calibrateAccel).

  // Der volle Lenkausschlag, mechanisch. Eine KONSTANTE und kein Konfigurationsfeld: sie
  // ist die Bedeutung von servoAngle = 1 und nichts, woran man dreht.
  const STEER_MAX_DEG = 45;

  // Die Nickgrenzen, GERECHNET aus der statischen Achslast und dem Verlagerungsanteil.
  //
  // Als Funktionen und nicht als Konfigurationsfelder: ein Feld muesste nach jeder Aenderung
  // der statischen Achslast nachgezogen werden, und ein Wert, den man nachziehen muss, ist
  // die Einladung, es zu vergessen. Zwei Leser gibt es im ganzen Programm.
  //
  // Sie sind ausdruecklich NICHT gedeckelt: bei 39:61 ergibt onPower 0,09, und das ist
  // richtig - ein Heckmotor hat unter Vollgas fast keine Vorderachslast mehr. Ein Deckel
  // waere eine erfundene Grenze.
  // ============================== FAHRZEUGLAYOUTS ==============================
  //
  // Fuenf Eintraege: die GT3-Klasse mit ihren drei Motorlagen und ein Formel-1-Monoposto.
  //
  // WARUM DREI GT3 UND NICHT DREI KLASSEN, und das ist wichtiger als es klingt: die drei
  // unterscheiden sich NUR in Achslast, Radstand und Traegheitsmoment, waehrend Leistung,
  // Reifen und Bremse dieselben bleiben. Genau deshalb zeigt der Vergleich, was die MOTORLAGE
  // macht - und nicht, was eine andere Klasse macht.
  //
  // DIE ZAHLEN SIND SCHAETZUNGEN aus der Fahrzeugklasse und keine Messungen. Die drei
  // GT3-Werte stehen so schon in der Doku und sind uebernommen statt neu erfunden. Am
  // unsichersten ist das Traegheitsmoment des F1-Autos. Die App kann keine Gierrate messen,
  // also pruefbar ist die innere Widerspruchsfreiheit und nicht die Uebereinstimmung mit dem
  // echten Auto.
  //
  // NEUTRAL IST DIE VORGABE und reproduziert das bisherige Verhalten genau - die Aenderung
  // ist damit rein additiv, und ein Selbsttest beweist es.
  const LAYOUTS = {
    neutral: { label: 'Neutral, kalibriert', vorn: 0.50, radstand: 2.60, iz: 2000 },
    gt3front: { label: 'GT3, Frontmotor \u2013 BMW M4 GT3', vorn: 0.50, radstand: 2.85, iz: 2500 },
    gt3mid: { label: 'GT3, Mittelmotor \u2013 Ferrari 296 GT3', vorn: 0.44, radstand: 2.60, iz: 1800 },
    gt3rear: { label: 'GT3, Heckmotor \u2013 Porsche 911 GT3 R', vorn: 0.39, radstand: 2.50, iz: 2200 },
    f1: { label: 'Formel-1-Monoposto', vorn: 0.45, radstand: 3.60, iz: 1000 },
  };
  // Der Bezug, an dem die Lenkgeschwindigkeit haengt: bei diesem Traegheitsmoment gilt genau
  // der kalibrierte Wert von steerRatePerS.
  const IZ_REF = 2000;
  const STEER_RATE_REF = 6.0;

  // Wie schnell das Auto auf einen Lenkbefehl antwortet, aus dem Traegheitsmoment.
  //
  // EINE ABSICHTLICHE ABKUERZUNG, und sie gehoert benannt: steerRatePerS ist eigentlich die
  // Geschwindigkeit des SERVOS und keine Eigenschaft der Fahrzeugmasse. Das Auto rutscht in
  // echt nicht, also gibt es keinen anderen Kanal, ueber den "antwortet schneller" ueberhaupt
  // ausdrueckbar waere. Das ist keine Aussage ueber die Servohardware, sondern die einzige
  // Stelle, an der ein kleines Traegheitsmoment sich zeigen kann.
  //
  // GEDECKELT auf 4 bis 9: ohne Deckel gaebe ein F1-Traegheitsmoment von 1000 den doppelten
  // Wert, und eine Lenkung, die in einem Achtel Sekunde am Anschlag ist, ist kein
  // Fahrzeugverhalten mehr, sondern ein Sprung.
  function steerRateFor(iz) {
    return Math.max(4, Math.min(9, STEER_RATE_REF * (IZ_REF / Math.max(1, iz))));
  }

  // Der Bezug fuer den absoluten Achslastanteil: bei dieser statischen Achslast ist der
  // Faktor genau 1, also die kalibrierte Fassung.
  const FRONT_AXLE_REF = 0.5;

  const loadOnPower = (cfg) => cfg.loadFrontStatic - cfg.transferK;
  const loadOnBrake = (cfg) => cfg.loadFrontStatic + cfg.transferK;

  class CarreraPhysicsEngine {
    constructor() {
      this.config = {
        accelerationFactor: 1.0, // fine-tune multiplier on top of the calibrated scale
        steerRatePerS: 6.0,      // full lock in ~1/6 s; the servo's speed, not its lag
        steerExpo: 1.15,         // near-linear: 1.5 made the car feel unwilling to turn
        // Der volle Lenkausschlag ist MECHANISCH 45 Grad. Das stand nirgends, und damit
        // war steerResponse eine Zahl ohne Einheit: der Regler ging von 0,5 bis 3,0, und
        // was 2,0 bedeutete, wusste nur die Kalibrierung. Jetzt ist die Groesse im Modell,
        // die Anzeige rechnet in Grad, und der volle Ausschlag ist der Bezug.
        //
        // Der Wert steht als Konstante STEER_MAX_DEG oben in dieser Datei und NICHT in
        // config: er ist Dokumentation und keine Stellschraube, und ein Feld in config,
        // an dem man ohne Wirkung drehen kann, ist genau die Falle, die loadGain und
        // ghostCfg.lineModel schon einmal gestellt haben.
        //
        // servoAngle bleibt normiert (-1 .. 1) - das Protokoll kennt nur Byte 7 als
        // int8, und eine Umrechnung in Grad und zurueck waere ein Rundungsfehler ohne
        // Gegenwert. Die 45 Grad sind die BEDEUTUNG von 1,0, nicht seine Einheit.
        steerResponse: 2.0,      // live trim on the D-pad, 0.5 .. 3.0 in 10% steps.
                                 // 200 % is the calibrated default: measured on the real
                                 // car, that is what answers properly. The ceiling was
                                 // raised from 2.0 so the default is not also the limit.
        speedSteerReduction: 0.35, // and only weighted by gear, see update()
        autoShift: true,  // Automatik als Standard

        // Anchored to real-world numbers instead of abstract 0..1 units, so the feel can
        // be reasoned about: the car tops out around 4 km/h and should take about 3s to
        // get there. Speed is simulated in km/h and the throttle byte is derived from it
        // (see update()), which is what stops the car slamming to full power instantly.
        topSpeedKmh: 4.0,

        // ---- Calibration anchor ----
        // Anchored on 0 -> 100 km/h AS DISPLAYED, because that is the figure everyone
        // actually quotes and judges. The old anchor was "0 -> half of top speed in
        // halfSpeedTimeS", which sounds neutral but hid the problem: 3.0 s to half of
        // A top speed picked as 285 worked out to 0-100 in about 2.2 s, quicker than any real
        // GT3, and the car duly felt far too fast.
        // The display multiplies simulated speed by REAL_SCALE, so 100
        // displayed km/h is the internal speed below. Written as a literal expression
        // rather than referencing REAL_SCALE: that const is declared far below this class
        // and the constructor already calls calibrateAccel(), so reading it from here
        // would be a temporal-dead-zone crash during load.
        launchAnchorKmh: 100 / REAL_SCALE,  // 1.4035 internal = 100 displayed
        // 1.95 und nicht 3.1, obwohl 3.1 der Sollwert ist: dieser Anker wird von
        // calibrateAccel gegen das VEREINFACHTE Modell (thrustAt/resistAt) geloest, und die
        // Fahrt laeuft durch update(). Gemessen sind das 46 % Unterschied - mit Anker 3.2
        // brauchte update() 4,46 s auf 100. Der Anker ist damit keine Zeitangabe mehr,
        // sondern eine Stellschraube, und der Sollwert steht dort, wo er hingehoert: in der
        // Pruefung, die ueber update() messt.
        //
        // Dass die beiden Modelle auseinanderliegen, ist der eigentliche Befund. Es sauber
        // zu machen hiesse, calibrateAccel durch update() integrieren zu lassen - dabei
        // liefen aber Schaltmeldungen und Rumble mit, mitten im Konstruktor.
        launchAnchorTimeS: 2.30,           // gefittet, siehe Kommentar oben

        // Pure normaliser for the thrust scale. Any value works: calibrateAccel() solves
        // accelCalibration against it by bisection, so it cancels out entirely. It used to
        // be called halfSpeedTimeS and used to mean something; keeping that name after the
        // anchor moved would have been a trap.
        accelScaleBasisS: 3.0,
        // ---- Coasting: three terms, because a real car has three ----
        // This used to be `coastDragPerS * |v|` — one term, linear in v, i.e. pure
        // exponential decay. That is the shape of engine braking alone, and using it for
        // everything had two consequences: far too much drag at low speed (momentum
        // vanished the instant the throttle was released) and the wrong falloff at high
        // speed (aero should dominate there and does not scale linearly).
        //   rolling resistance -> roughly CONSTANT deceleration, independent of speed.
        //                         It is also what brings a car to an actual standstill:
        //                         exponential decay never arrives, a constant term does.
        //   engine braking     -> roughly LINEAR in speed, while in gear.
        //   aerodynamic drag   -> QUADRATIC, dominant at speed, negligible when slow.
        // Values are absolute decelerations in km/h/s at their reference point, so they
        // can be read and reasoned about directly rather than as opaque coefficients.
        // Scaled to REAL decelerations. The display multiplies by 71.25, so an internal
        // km/h/s is 71.25 displayed km/h/s -- which makes it easy to be wildly wrong here
        // without noticing. A first pass at 0.18/0.35/0.90 summed to 1.43 internal at top
        // speed = 102 displayed km/h/s = 2.8 g of coasting deceleration, roughly six times
        // what a GT3 actually does. These values sum to 0.25 internal = 17.8 displayed
        // km/h/s at top speed, about 0.5 g, which is the right order for aero drag at
        // 285 km/h. At a quarter of top speed they give ~0.11 g, and near standstill the
        // constant term alone remains -- which is what finally brings the car to rest.
        coastRollDecel: 0.030,   // constant
        coastEngineDecel: 0.065, // x u
        coastAeroDecel: 0.155,   // x u^2
        coastDragPerS: 1.0,      // overall factor over all three, this is the slider
        // Fitted against the user's real GT3 braking table (50km/h in ~1.0s up to
        // 280km/h in ~4.3s, i.e. 1.4g rising to 1.85g as downforce builds). Speed
        // dependent, because a GT3 brakes far harder when it is fast:
        // decel = base + aero*(v/Vmax). Mean error against the scaled table 1.5%.
        // The old flat 6 km/h/s stopped the car in 0.67s — about four times too hard.
        // These finally MATCH the braking table this comment has always claimed to be
        // fitted against (50 km/h in ~1.0 s rising to 280 km/h in ~4.3 s, scaled to our
        // internal speeds). The previous values did not, and neither did the ones before
        // them - measured with the bare formula and with the live loop, which agree
        // because every multiplier is 1.0 in a straight-line dry stop:
        //   0.98 / 1.00 ("the fit")      -> 0.64 s from 50, 2.75 s from 280   (57 % quick)
        //   0.784 / 0.80 (80 % of those) -> 0.80 s from 50, 3.44 s from 280   (25 % quick)
        //   0.627 / 0.64 (these)         -> 1.00 s from 50, 4.30 s from 280   (the table)
        // So the documented "mean error 1.5 %" was never true of the constants underneath
        // it. Braking is now WEAKER than the 80 % that was asked for, which is the same
        // direction that request pointed in; the "Bremskraft" slider (default 1.0) is
        // there for taste in either direction.
        // 0.72, gefittet gegen 100-0 bis 250-0: 2,16 / 3,22 / 4,26 / 5,30 s gegen
        // 2,1 / 3,2 / 4,2 / 5,6 s. RMSE 3,1 %, kein Punkt weiter als 5 % ab.
        //
        // Drei Fitrunden davor waren wertlos, und das ist die eigentliche Lehre: der
        // Messaufbau hat sich selbst verstellt. Erst hatte physCurve gar keinen definierten
        // Zustand und maass die Reihenfolge der Pruefungen. Dann habe ich die
        // Zustandsfelder beim Zuruecklegen AUFGEZAEHLT - und ein Zustandsobjekt hat immer
        // mehr Felder, als einem einfallen; zwei identische Aufrufe lieferten
        // Verschiedenes. Und schliesslich habe ich tyreGrip gesetzt, das update() jeden
        // Takt neu aus dem Reifenzustand bildet, also keinen Takt hielt.
        //
        // Jetzt: der ganze Zustand wird kopiert, tyreEffect stillgelegt, und der
        // Bezugszustand ist ein Rennstart - voller Tank, nominale Reifen, trockene Bahn.
        // Vor und nach einem kompletten Selbsttest messt derselbe Aufruf dasselbe.
        brakeDecelBase: 0.72,
        // 0, und das ist eine Entscheidung gegen den Fitter: der wollte -0,10, also eine
        // Bremse, die mit der Fahrt schwaecher wird. Der Luftanteil steckt schon im
        // Rollwiderstandsterm, der beim Bremsen mitwirkt - ein zweiter Term dafuer zaehlt ihn
        // doppelt, und ein negativer behauptet etwas Falsches ueber die Bremse.
        brakeDecelAero: 0,
        // ---- Soft launch ----
        // Pulling away was too sharp in the first instant. The softening lives INSIDE
        // thrustAt(), which means calibrateAccel() integrates through it and raises
        // accelCalibration to compensate: the 0 -> half-speed time is preserved while the
        // very first moment is gentler and the middle of the pull correspondingly stronger.
        // That is what "slower at the start" means without also making the car slow.
        // 0.95, gefittet. Vorher 0.55, und damit musste dieser Wert die fehlende Physik
        // der schleifenden Kupplung mitverstecken: 0-50 war doppelt so lang wie bei einem
        // echten GT3. Jetzt liefert die Kupplung das Moment und dieser Boden begrenzt nur
        // noch, wieviel davon am Boden ankommt.
        launchSoftFloor: 0.95, // thrust multiplier at a dead stop
        launchSoftKmh: 0.6,    // ... rising linearly to 1.0 by this road speed
        minMoveThrottle: 0.16, // smallest byte that actually breaks the car away from rest
        // 10 km/h on the racing display, which reads speedKmh * REAL_SCALE (71.25).
        // Below this the car is walking pace and should simply stop.
        crawlCutoffKmh: 10 / REAL_SCALE,
        // Lowered from 1.2: clearing the cutoff in 0.12 s read as the car being yanked to
        // a halt. 0.45 takes about 0.32 s, which still stops it promptly but lets the last
        // fraction of a km/h bleed away instead of snapping.
        crawlStopDecel: 0.45,  // km/h per second; clears the cutoff in about 0.32 s

        // ---- Fuel mass ----
        // A full tank is dead weight: it costs acceleration and braking alike. Both effects
        // are applied to the finished acceleration in update(), NOT inside thrustAt() —
        // the launch calibration integrates through thrustAt and must keep meaning exactly
        // what it says. The calibrated figure therefore holds for an empty car, and fuel
        // makes it slower, which is the honest way round.
        // 0.5 als Standard, weil ein Rennwagen mit vollem Tank sich anders anfuehlt und
        // das zum Spiel gehoert. Der Regler im Markup steht auf demselben Wert; stuende nur
        // einer von beiden dort, waere die Anzeige bis zur ersten Beruehrung falsch. Die
        // Kalibrierung gegen das echte Auto steht noch aus.
        // 1,0, nachgezogen zur Reglervorgabe im Markup - siehe tyreEffect.
        // ACHTUNG: die GT3-Tabelle im Selbsttest ist gegen 0,5 gefittet. Der Messaufbau
        // stellt diesen Wert deshalb ausdruecklich her, so wie er auch tyreEffect auf 0
        // legt: die Reglerstaerke ist eine Spieleinstellung und keine Eigenschaft des
        // Bezugsautos.
        fuelWeightEffect: 1.0,
        fuelMassSpan: 0.30,    // a full tank is up to 30% more sluggish at effect 1

        // ---- Tyre temperature and wear ----
        // 2,0, nachgezogen zur Reglervorgabe im Markup. Vorher stand hier 0,5 und im
        // Markup 2,0: die Anzeige sagte 200 %, das Modell rechnete mit 50 %, und ein
        // einziges Antippen des Reglers liess das Verhalten springen. Dieselbe Fehlerklasse
        // wie bei topSpeedScale, und die dritte in dieser Sitzung - deshalb prueft der
        // Selbsttest sie jetzt.
        //
        // Ueber 100 % wirken nur die RATEN (Verschleiss, Erwaermung); das Griffdefizit ist
        // bei einfacher Modellstaerke gedeckelt, siehe update().
        tyreEffect: 2.0,       // 0 = aus; 1 = volles Modell; darueber schnellere Raten.
        tyreAmbientC: 20,
        tyreOptimalC: 85,
        // REIFENWAERMER. Aus heisst: Start und Reifenwechsel auf Umgebungstemperatur, wie
        // bisher. An heisst: auf tyreOptimalC, also genau in das Griff-Fenster - das ist,
        // was ein Reifenwaermer tut, und deshalb steht hier kein eigener Zahlenwert. Eine
        // zweite Zahl neben tyreOptimalC waere die Gelegenheit, dass "aufgewaermt" und
        // "optimal" auseinanderlaufen.
        tyreBlankets: false,
        // Balanced so the equilibrium temperature lands where it should: with
        // T = ambient + span * (heat/cool) * work, brisk driving (work ~0.65) settles at
        // 82°C and full attack (~0.95) at 111°C, just into the overheating range. The first
        // pair tried, 4.0/1.5, ran to 171°C on ordinary driving — permanently in the red,
        // which would have made the whole model read as broken.
        tyreHeatRate: 7.0,     // °C/s bei voller Arbeit (v0.4: von 5,0 herauf)
        tyreCoolRate: 3.4,     // °C/s at optimum; time constant ~19 s
        tyreOverheatC: 103,    // v0.4: engeres Fenster, von 110 herunter
        // Zurueck auf 0,35: die 0,42 waren meine Zutat in Block C, und ein Kaltstart mit
        // 42 Prozent weniger Grip ist zusammen mit allem anderen zu viel. Der Regler
        // steigert jetzt die Raten und nicht die Tiefe.
        tyreColdPenalty: 0.35, // Griffverlust auf eiskalten Reifen
        tyreHotPenalty: 0.38,  // Griffverlust bei durchgeheizten Reifen (v0.4: von 0,30)
        // v0.4 von 0,0018 herauf: bei 100 % war der Verschleiss ueber eine Rennlaenge
        // kaum zu merken. Jetzt abgefahren nach gut vier Minuten voller Attacke.
        tyreWearRate: 0.0032,
        tyreWearPenalty: 0.35, // Griffverlust auf voellig abgefahrenen Reifen (v0.4: von 0,30)
        shiftDragFactor: 0.25, // drag during a shift: a slight lull, not a full coast-down
        accelCalibration: 1,   // solved for in calibrateAccel(), see there
        speedLimitFactor: 1,   // pit lane sets this to 0.4; caps speed, so the byte caps too
        // How hard the pit limiter brakes down to that cap when entering above it. Gentler
        // than a full brake application (brakeDecelBase 0.627) — a real limiter eases the
        // car down rather than standing it on its nose.
        pitLimiterDecel: 0.35,

        // EINE EIGENE KOPIE und nicht GT3_GEARS selbst. applyGearbox() aendert dieses
        // Array an der Stelle - das muss es, weil die Ghosts es per Verweis teilen -, und
        // stuende hier die Tabelle, wuerde der erste Wechsel auf Formel 1 die GT3-Tabelle
        // ueberschreiben. Zurueck auf GT3 haette dann acht Gaenge gehabt.
        gears: GT3_GEARS.map(g => ({ ratio: g.ratio, topFrac: g.topFrac })),
        rpmScale: 0,      // derived in rebuildGearModel()
        ratioRef: 0.88,   // top gear's ratio, so 6th has a force factor of exactly 1.0
        // Fitted numerically against the user's real GT3 acceleration table (0-50km/h
        // 1.5s ... 0-285km/h 22s) normalised to fractions of top speed. Reproduces its
        // SHAPE to within 4% on the ratio of full-speed to half-speed time.
        // ---- Schleifende Kupplung beim Start ----
        // rpmRawAt rechnet die Drehzahl aus der Fahrt, im Stand also Leerlauf, und dort
        // liefert die Drehmomentkurve 0,42. Gemessen war 0-50 damit doppelt so lang wie bei
        // einem echten GT3, waehrend die hoeheren Marken mit einem anderen Anker passten.
        //
        // Ein Rennwagen im Start haelt die Drehzahl oben und laesst die Kupplung schleifen:
        // die Kurbelwelle dreht, die Raeder stehen noch fast. Der Antrieb liefert dabei
        // nahezu Spitzenmoment, und begrenzt wird er von der Traktion.
        //
        // Nur im ersten Gang, und nur solange die Raeder noch nicht aufgeholt haben. Danach
        // ist es von selbst wirkungslos - kein zweiter Fall, keine Ausnahme.
        // Zusammen mit launchSoftFloor weiter unten, und die Arbeitsteilung ist gewollt:
        // die Kupplung liefert das MOMENT (Physik, hier), launchSoftFloor begrenzt, wieviel
        // davon am Boden ankommt (Traktion und Fahrgefuehl, dort). Vorher gab es nur den
        // Boden, und der musste die fehlende Physik mitverstecken.
        launchClutchRpm: 6200,   // die Drehzahl mit dem Spitzenmoment
        // 0.25, gefittet gegen 0-200 = 8,5 s. Vorher 0.62, gegen eine aeltere Tabelle.
        // 290 km/h werden in 19,2 s erreicht; die Spitze selbst haengt an topSpeedKmh und
        // bleibt unberuehrt.
        aeroDragK: 0.25,
        onPowerRollK: 0.08,   // rolling term under load, ALSO in units of accelScale
        // Deliberately >1: at 1.0 full lock at top speed would consume exactly the whole
        // budget, but a real GT3 at full lock near Vmax is long past the limit. 1.8 means
        // meaningful cornering already eats a real share, and hard cornering at speed
        // leaves nothing for acceleration.
        corneringLoad: 1.8,
        // Track-surface grip, SEPARATE from the friction circle on purpose: the circle is
        // driving dynamics, this is what the road is doing. Set from the weather/tyre pair.
        gripScale: 1.0,
        // Lenkwinkel-Kalibrierung. Sie sitzt HINTER dem Reibkreis: 1,0 ist die
        // kalibrierte Fassung, 2,0 laesst einen um die Haelfte beschnittenen Lenkwunsch
        // wieder den vollen mechanischen Anschlag erreichen. Gedeckelt bleibt sie ohnehin -
        // Byte 7 kann nicht mehr als 127 tragen, und das ist der Anschlag des Autos.
        steerCalib: 1.0,
        aquaplaning: 0,       // 0 = dry grip, 1 = slicks in standing water

        // ---- Longitudinal weight transfer ----
        // Under braking the mass pitches onto the front axle, under power onto the rear.
        // TWO time constants on purpose, and the difference between them is the whole
        // point: the body pitches quickly (loadTau) while the tyre actually building the
        // braking force lags behind (useTau). So for the first moments of a brake
        // application the fronts are already loaded but not yet busy — which is exactly the
        // brief turn-in advantage a driver feels — and only afterwards does the brake force
        // eat that grip up again.
        // ---- Bremsbalance ----
        // Anteil der Bremskraft, der an der VORDERACHSE ankommt. 62 % ist ein
        // ueblicher GT3-Wert und zugleich der Bezugswert der Kalibrierung: bei genau
        // diesem Wert rechnet das Modell wie vor v0.4, der Regler ist in Mittelstellung
        // also ein Nichts-Tun. Das ist Absicht - ein neuer Parameter an einem
        // kalibrierten Modell darf die Kalibrierung nicht verschieben.
        brakeBias: 0.62,
        brakeBiasRef: 0.62,
        // Reifen-Lastempfindlichkeit k_sens aus C(Fz) = C0*(Fz/Fz0)*[1 - k*((Fz-Fz0)/Fz0)].
        // Sie ersetzt das lineare loadGain: eine hoeher belastete Achse gewinnt Haftung,
        // aber unterproportional, und genau diese Kruemmung fehlte vorher.
        tyreLoadSens: 0.25,
        transferK: 0.30,      // share of the load that moves at 1g
        loadTau: 0.08,        // body pitch (squat and dive): fast
        useTau: 0.45,         // longitudinal tyre force build-up: distinctly slower
        // ---- Rueckwaertsgang in der Automatik ----
        // Bis unter diese Fahrt darf Viereck den Rueckwaertsgang legen, Kreis holt ihn
        // wieder heraus. Als Bruchteil der Spitze, nicht in km/h: st.speedKmh laeuft in
        // Modellmass (0 bis topSpeedKmh = 4,0), und der Schirm zeigt es mit 73,75
        // multipliziert. 0.034 * 4,0 * 73,75 sind die gewuenschten 10 km/h auf der Anzeige.
        autoReverseFrac: 0.034,
        // ---- Nasse Lenkung ----
        // Der Nassverlust greift erst mit der Geschwindigkeit an. Ohne das frisst schon das
        // Motorbremsen den geschrumpften Reibkreis auf, und zwar bei JEDER Fahrt - auf
        // Slicks im Regen war deshalb gar keine Lenkung mehr da, auch im Schritttempo.
        // Physikalisch ist die alte Fassung falsch: ein nasser Reifen traegt seitlich
        // durchaus, nur ist der Grenzbereich frueher erreicht. Unterhalb von wetOnsetFrac
        // ist die Anforderung so klein, dass Nass keinen Unterschied macht.
        // Angezeigte Entsprechung bei 295 km/h Spitze: 50 und 160 km/h.
        wetOnsetFrac: 0.17,
        wetFullFrac: 0.55,
        // ---- Wieviel der Reibkreis ueberhaupt gefuellt wird ----
        // Dieselbe Ueberlegung wie beim Regen, auf die Laengsanforderung angewandt: bei
        // Schrittgeschwindigkeit ist eine Vollbremsung ein Bruchteil der verfuegbaren
        // Haftung, bei Hoechstgeschwindigkeit ist sie alles. Ohne das leert eine Vollbremsung
        // den Kreis bei JEDER Fahrt, und die Lenkung klebt bis zum Stand am Notboden.
        // Angezeigte Entsprechung bei 295 km/h Spitze: 30 und 180 km/h.
        // TEMPOWICHTUNG DER BREMSANFORDERUNG. Sie ist der Grund, warum Bremsen die
        // Lenkung ueberhaupt schwaecht - und war bis v0.5 so flach, dass man es unter
        // 100 km/h nicht gespuert hat: Ansatz bei 29,5 angezeigten km/h, VOLL erst bei 180.
        // Gemessen gab volles Bremsen bei 60 km/h noch 100 % des Rollwerts.
        //
        // Jetzt Ansatz bei 14,8 und voll bei 65 angezeigten km/h. Unter 15 km/h passiert
        // weiterhin NICHTS, und das ist per Konstruktion so: dort ist lastFrac null, der
        // Notboden von 12 % kann also nicht zurueckkommen. Genau der war der Fehler, gegen
        // den diese Wichtung ueberhaupt eingebaut wurde.
        loadOnsetFrac: 0.05,
        loadFullFrac: 0.22,
        // 0.65 und 1.55, gewaehlt und nicht gemessen: gefittet auf Vollbremsung 50 % und
        // Vollgas 59 % des Lenkgrips beim Rollen, weil die Original-App unter Vollbremsung
        // sichtbar weniger lenkt. Vorher waren es 77 und 75 % - die Wirkung war da, nur zu
        // schwach. Ein Sollwert dafuer liegt nicht vor, also ist das eine Gefuehlsangabe und
        // keine Messung; die Zahlen stehen hier, damit sie nachpruefbar sind.
        // 0,85, und die Zahl kommt aus der GEFAHRENEN Bremsung, nicht aus dem
        // festgehaltenen Messaufbau. Das ist der Unterschied, der hier zaehlt: bei
        // festgehaltener Fahrt setzt sich longUse auf die Anforderung (gemessen -0,83), beim
        // wirklichen Verzoegern liegt es rund 25 % hoeher (-1,05 bis -1,10). Mit 1,00 lag die
        // Lenkung in der gefahrenen Vollbremsung zwischen 80 und 110 km/h auf dem Notboden
        // von 12 % - gesaettigt statt abgestuft, also ohne Dosierung.
        //
        // Mit 0,85 bleibt frontUse auch im schlimmsten Fall unter frontCap, und die Lenkung
        // faellt auf rund 43 % statt auf den Boden. Weniger waere zu wenig: der Messaufbau
        // mit festgehaltener Fahrt zeigt dann 73 % und man spuert es kaum.
        // Wieviel von der Vorderachskapazitaet die Bremse frisst - der Reibkreis, und seit
        // v0.5 ueber setting-brake-steal einstellbar.
        //
        // 1,15 und nicht 0,85, GEMESSEN: bei der Lenkkalibrierung 200 Prozent, die Pro
        // fuehrt, kommen mit 0,85 und mit 1,00 rollend WIE bremsend volle 45 Grad am Auto an
        // - der Effekt war vollstaendig unsichtbar. 1,15 nimmt bei 80 km/h und darueber 45
        // auf 26 Grad und laesst 40 bis 60 km/h unberuehrt. Ueber 1,15 faellt es auf den
        // Notboden von 0,12, und dann lenkt das Auto unter Bremsen gar nicht mehr.
        //
        // Dieselbe Zahl steht als Vorgabe im Markup, weil Pro die Vorgabe IST. Hier steht
        // sie fuer calibRef: stuende hier 0,85, meldete physConfigDiff auf frischem Laden
        // eine Abweichung, die niemand verstellt hat. Den Bremsweg beruehrt der Wert nicht -
        // steerGrip geht in die Lenkung und nicht in die Verzoegerung.
        brakeUseGain: 1.15,

        // ---- Bremstemperatur und Fading (Block 4.1) ----
        //
        // DIE HEIZRATE IST GEGEN DIE KALIBRIERUNG GEWAEHLT und nicht nach Gefuehl: eine
        // Vollbremsung aus 250 km/h aus kalten Scheiben erreicht damit rund 250 °C, und das
        // Fading beginnt erst bei 520. Die gefittete Bremstabelle (RMSE 3,1 %) ist an EINER
        // Bremsung aus kalten Scheiben gemessen und bleibt deshalb unangetastet. Erst
        // mehrere Bremszonen hintereinander ohne genug Kuehlung kommen ins Fading.
        //
        // Waere die Rate hoeher, wuerde jede Einzelbremsung faden - und dann waere nicht
        // die Simulation tiefer, sondern die Kalibrierung kaputt.
        brakeFadeEffect: 1.0,   // 0 = aus, 1 = Modell, bis 2 = schnellere Raten
        brakeAmbientC: 25,
        brakeHeatRate: 62,      // °C/s bei voller Bremsung und voller Fahrt
        // DIREKT die Kuehlkoeffizienten in 1/s, nicht normiert. Hier stand erst eine
        // Normierung ueber eine Spanne, und die machte den Koeffizienten 0,59/s - eine
        // Zeitkonstante von 1,7 s, mit der die Scheiben gar nicht warm werden konnten:
        // gemessen erreichten FUENF Vollbremsungen aus 250 km/h nur 111 Grad.
        //
        // Jetzt: 200 s Zeitkonstante im Stand, 25 s bei voller Fahrt. Das ist die
        // Groessenordnung, in der eine Rennbremse zwischen zwei Bremszonen abkuehlt - genug,
        // um sich zu erholen, zu wenig, um kalt zu werden.
        brakeCoolBase: 0.005,   // 1/s im Stand
        brakeCoolAir: 0.035,    // 1/s zusaetzlich bei voller Fahrt (Fahrtwind)
        brakeFadeStartC: 520,
        brakeFadeFullC: 780,
        brakeFadeMax: 0.35,     // hoechstens 35 % der Bremskraft

        // ---- Windschatten (Block 4.2) ----
        // Die WIRKUNG steht hier, die Messung nicht: wer vorn faehrt, weiss nur die
        // Ghost-Verwaltung. Sie setzt st.dirtyAir von aussen.
        dirtyAirEffect: 1.0,
        dirtyAirMax: 0.18,      // hoechstens 18 % Kurvengrip weniger

        // ---- Asymmetrischer Reifenverschleiss (Block 4.3) ----
        tyreAsymEffect: 1.0,
        // QUERVERLAGERUNG, das Gegenstueck zu transferK fuer die Laengsrichtung. 0,7 heisst:
        // bei vollem Querbedarf traegt die aeussere Seite 85 % und die innere 15 % - das ist
        // die Groessenordnung eines Rennwagens mit steifen Federn und viel Abtrieb.
        //
        // Wie transferK eine NAEHERUNG: ein echtes Modell haette Federraten, Stabilisatoren
        // und eine Waelzachse. Was hier stimmt, ist die Reihenfolge - eine Rechtskurve
        // belastet die linken Raeder, und mit dem Bremsen zusammen vorne links am meisten.
        tyreAsymShare: 0.7,
        tyreAsymPull: 0.05,     // hoechster Lenk-Offset bei voller Ungleichheit

        // ---- Reifendruck (Block 4.4) ----
        // Kein neuer Zustand: der Druck bildet auf drei vorhandene Groessen ab. Die
        // Referenz ist die Mittelstellung des Reglers und aendert dort nichts.
        tyrePressureBar: 1.8,
        tyrePressureRef: 1.8,
        tyrePressurePeakLoss: 0.06,   // Spitzengriff-Einbusse am Reglerrand
        coastPitch: 0.15,     // engine braking pitches the nose down a little
        // ---- Fahrzeuglayout ----------------------------------------------------------
        //
        // Bis v0.5 hatten alle Autos DASSELBE Fahrwerk: die statische Achslast stand als
        // Literal 0.5 in der Verlagerungszeile weiter unten, und unterschiedlich war nur der
        // Klang. Damit war auch das Einspurmodell nicht baubar - seine Gleichungen brauchen
        // Radstand, Achslasten und Traegheitsmoment.
        //
        // 0,5 ist die Vorgabe und reproduziert das bisherige Verhalten genau.
        loadFrontStatic: 0.5,
        // Radstand in Metern und Giertraegheitsmoment in kg*m^2. Beide sind SCHAETZUNGEN aus
        // der Fahrzeugklasse und keine Messungen; die App kann keine Gierrate messen. Sie
        // setzen relatives Verhalten, und geprueft wird die innere Widerspruchsfreiheit.
        wheelbaseM: 2.60,
        yawInertia: 2000,
        // Wie stark die statische Achslast auf die LENKKAPAZITAET wirkt. 0 heisst
        // gleichgueltig, 1 heisst voll proportional zur Abweichung von 50:50.
        //
        // KEIN PHYSIKALISCHER EXPONENT, und das gehoert dazu: hier stand zuerst 0,85 als
        // Lastempfindlichkeit eines Rennreifens - physikalisch begruendet und in diesem
        // Modell unbrauchbar. Gemessen: bei 39 Prozent vorn ergab das frontCap 0,81, und weil
        // frontUse gegen eine VOLLE Kapazitaet kalibriert ist, wurde die Wurzel null und die
        // Lenkung klebte am Notboden von 0,12 - 5 Grad Einschlag bei 140 km/h, unfahrbar. Der
        // Reibkreis saettigt schon bei zehn Prozent Absenkung.
        //
        // Die Zahl ist also eine Abstimmung und keine Reifeneigenschaft. Sie wird gemessen
        // und nicht hergeleitet, und sie steht hier als das, was sie ist.
        //
        // 0,15 ist gemessen. Uebertragener Winkel bei 140 km/h unter Vollbremsung, mit der
        // Lenkkalibrierung 2,0, die Pro fuehrt:
        //
        //   Staerke   neutral   F1    GT3 Mitte   GT3 Heck
        //   0,15        26       21       20         13     <- geordnet, keiner am Boden
        //   0,30        26       15       11         11     <- zwei am Notboden
        //   0,45        26       11       11         11     <- alle am Notboden
        //
        // Ab 0,30 kleben Layouts am Notboden von 0,12, und dann sind sie nicht mehr
        // unterscheidbar, sondern nur noch alle unfahrbar. Bei 0,15 lenken bei 60 km/h alle
        // noch (45 bis 39 Grad), und die Reihenfolge folgt der Vorderachslast.
        frontAxleEffect: 0.15,

        // ---- Einspurmodell (Instrument) ----------------------------------------------
        //
        // Die Schraeglaufsteifigkeit der GANZEN Achse bei voller Last, in Newton je Radiant.
        // Aufgeteilt wird sie nach der Achslast, damit der Eigenlenkgradient allein aus der
        // Verteilung folgt - zwei unabhaengige Zahlen je Achse waeren die Gelegenheit, dass
        // Layout und Eigenlenkverhalten auseinanderlaufen.
        //
        // Der Betrag ist eine Klassenschaetzung fuer einen Rennreifen (etwa 1200 N/Grad je
        // Achse). Er setzt die Zeitkonstante der Gierdynamik; auf sie kommt es an, nicht auf
        // die absolute Kraft, denn eine Kraft kann dieses Modell ohnehin nicht ausgeben.
        corneringStiffness: 140000,
        // Fahrzeugmasse in kg. Nur fuer das Einspurmodell - der Vortrieb rechnet mit
        // massFactor, das gegen eine Messung kalibriert ist und hiervon unberuehrt bleibt.
        vehicleMassKg: 1300,
        // 0 schaltet das Modell ab: dann bleiben alle Anzeigen leer statt zu luegen.
        yawModelEffect: 1,
        // Lastempfindlichkeit der Achssteifigkeit. WESENTLICH und nicht Feinschliff: mit
        // strikter Proportionalitaet (Exponent 1) kuerzt sich der Eigenlenkgradient exakt
        // weg - kU = m*f/(C*f) - m*(1-f)/(C*(1-f)) = 0 fuer JEDE Verteilung -, und das Modell
        // meldete jedes Layout als neutral. 0,85 ist der uebliche Bereich fuer einen
        // Rennreifen.
        stiffnessLoadExp: 0.85,

        // loadFrontOnPower und loadFrontOnBrake standen HIER als eigene Felder (0,20 und
        // 0,80). Sie sind weggefallen, weil sie 0,5 -/+ transferK sind - dieselbe Geometrie
        // an einem zweiten Ort. Mit veraenderlicher statischer Achslast waere jede
        // Layout-Wahl eine stille Verschiebung der Kalibrierung gewesen.
        //
        // Gerechnet wird sie von loadOnPower() und loadOnBrake() weiter unten. Der Grund fuer
        // die Normierung bleibt derselbe wie vorher: der Vortrieb ist auf das
        // Vollgas-Gleichgewicht bezogen und nicht auf 50:50, damit die gemessene Anfahrzeit
        // genau so bleibt, wie kalibriert - und das gilt jetzt fuer JEDES Layout, weil
        // Zaehler und Nenner zusammen wandern.
        upshiftRpm: 8800,
        downshiftRpm: 4200,
        shiftMs: 120,     // a sequential swaps far quicker than the old 180ms

        // Reverse: pulls a little weaker than 1st and is capped well below it. At its cap
        // the byte reaches exactly -0.5 = delta -64, the ONLY reverse depth ever confirmed
        // on the real car.
        neutralRevTau: 0.22,   // free-rev lag out of gear; an engine is not a switch
        reverseStandstillKmh: 0.05,
        // Halved from 0.22: reverse is for manoeuvring on a small floor, so 31 km/h on the
        // display is plenty. reverseOutputSpan below caps the byte on top of this, which
        // makes R both slower and weaker than forward.
        reverseTopFrac: 0.11,
        reverseRatio: 3.00,
        reverseOutputSpan: 0.50,
      };
      this.state = {
        speedKmh: 0,          // SIGNED: negative means reversing
        virtualSpeed: 0,      // |speedKmh| / topSpeedKmh — deliberately UNSIGNED, because
                              // sound, steering limit and HUD all expect a 0..1 magnitude
        // Three modes now. Neutral is the STARTING state, the way you find a real car:
        // nothing engaged, engine free to rev.
        driveMode: 'neutral', // 'neutral' | 'forward' | 'reverse'
        neutralRpm: 0,        // lagged free-rev value, 0..1 of the usable rev range
        currentGear: 0,
        rpm: IDLE_RPM,
        rpmFrac: 0,           // (rpm - idle) / (redline - idle)
        onLimiter: false,
        gripLong: 1, // longitudinal share of the grip budget — see the friction circle
        aquaFactor: 1,
        fuelLoad: 0,      // 0..1, written from outside each tick; 0 keeps the car light
        massFactor: 1,    // >1 = heavier than the calibrated car
        tyreTempC: 20,
        // tyreWear bleibt der MITTELWERT aus links und rechts. Alle vorhandenen Leser -
        // der Balken im Cockpit, der Boxenstopp, die Griffrechnung - lesen weiter dieses
        // Feld und brauchen keine Aenderung. Die Aufteilung ist ein Zusatz, kein Umbau.
        tyreWear: 0,      // 0..1
        // Die Seitenmittel bleiben, weil Leser daran haengen - sie werden jetzt aus den vier
        // Raedern GERECHNET und nicht mehr selbst gefuehrt.
        tyreWearL: 0,
        tyreWearR: 0,
        // VIER RAEDER, Reihenfolge vorne links, vorne rechts, hinten links, hinten rechts.
        // Als Feld und nicht als vier Felder: alles, was damit passiert, passiert fuer alle
        // vier gleich, und vier Namen waeren vier Stellen, an denen einer vergessen wird.
        tyreWear4: [0, 0, 0, 0],
        tyreTemp4: [20, 20, 20, 20],
        load4: [1, 1, 1, 1],       // Radlast, 1 = Mittel
        // Der REINE Seitenanteil, ebenfalls 1 im Mittel und ohne die Achsaufteilung. Die
        // Bremsscheiben brauchen genau ihn: ihre Achsaufteilung kommt aus der Bremsbalance,
        // und beides zu multiplizieren hiesse, die Vorderachse zweimal zu bevorzugen.
        latShare4: [1, 1, 1, 1],
        brakeTemp4: [25, 25, 25, 25],
        brakeTempF: 25,
        brakeTempR: 25,
        brakeFade: 0,     // 0..brakeFadeMax, Anteil verlorener Bremskraft
        // Von aussen gesetzt, siehe dirtyAirEffect. 0 = freie Luft.
        dirtyAir: 0,
        tyrePull: 0,      // Lenk-Offset aus der Ungleichheit, in Servo-Einheiten
        tyreGrip: 1,      // combined temperature and wear factor, 1 = nothing simulated
        // Der RUHEWERT, und er folgt dem Layout: bei einem Heckmotor liegt das Auto im
        // Stand hinten tiefer. Er wird im Konstruktor aus loadFrontStatic gesetzt, nicht
        // hier festgeschrieben - sonst zeigte die Radlastanzeige beim ersten Takt 50:50 und
        // sprang danach.
        loadFront: 0.5,   // wird aus loadFrontStatic gesetzt; >0.5 heisst vorne tiefer
        longUse: 0,       // lagging longitudinal demand, signed: + drive, - brake
        steerGrip: 1,     // front lateral capacity left over, 1 = static baseline
        gLat: 0, gLong: 0, // for the G plot
        // Fuer die Laengs-G-Anzeige: das Tempo des letzten Takts. gLong ist seit v0.4.52 die
        // gemessene Aenderung der Geschwindigkeit und nicht mehr die Bremsanforderung -
        // siehe die Begruendung dort.
        gLongV: undefined,
        engineLoad: 0,        // pedal opening actually applied — drives sound VOLUME
        dampedSteering: 0,
        // Der Lenkwunsch NACH Reibkreis und Aquaplaning, aber VOR der Kalibrierung und vor
        // dem Deckel. Ohne ihn ist nicht messbar, wie viel die Kalibrierung ueberhaupt
        // zurueckholt - und was sich nicht messen laesst, kann man nicht einstellen.
        steerDemand: 0,
        // ---- Einspurmodell. ALLE Instrument, keines stellt die Lenkung. ----
        yawRate: 0,        // rad/s, positiv = Rechtsdrehung
        slipAngle: 0,      // rad, Schwimmwinkel am Schwerpunkt
        alphaFront: 0,     // rad, Schraeglaufwinkel vorn
        alphaRear: 0,      // rad, Schraeglaufwinkel hinten
        ayModel: 0,        // m/s^2, gerechnete Querbeschleunigung
        kU: 0,             // s^2/m, Eigenlenkgradient: >0 untersteuernd
        yawSteady: 0,      // rad/s, stationaere Gierrate zum aktuellen Lenkwinkel
        latUse: 0,         // Querausnutzung des Reibkreises, 0..1 - treibt das Quietschen
        // ayUse und vLimitKmh standen hier und liest jetzt niemand mehr. Sie waren fuer eine
        // Anzeige gedacht, die gefahren gemessen dauerhaft am Anschlag stand - siehe den
        // Skalenwiderspruch in yawStep. Ein Zustandsfeld ohne Leser ist toter Ballast, und
        // eine Groesse, die nur in einer verworfenen Anzeige Sinn hatte, gehoert nicht in den
        // Zustand.
        isShifting: false,
        absActive: false,
        lastAbsRumble: 0,
      };
      this.outputs = { motorPWM: 0, servoAngle: 0, lights: { head: false, brake: false } };
      this.rebuildGearModel(); // must run BEFORE calibrateAccel — it needs rpmScale
      this.calibrateAccel();

      // Der Zustand, GEGEN DEN GEFITTET WURDE. Die Sollwerte der GT3-Tabelle (0-100 in
      // 3,1 s, 100-0 in 2,1 s) gelten fuer genau diese Konfiguration und fuer keine andere.
      // Die Messaufbauten stellen ihn her, bevor sie messen, und legen danach zurueck.
      //
      // Er wird GANZ kopiert und nicht aufgezaehlt: eine Liste von Feldern ist bei einem
      // Konfigurationsobjekt immer unvollstaendig, und die fehlende Zeile faellt erst auf,
      // wenn eine Messung nicht mehr reproduzierbar ist.
      //
      // gears braucht dabei eine EIGENE Kopie, seit es Getriebearten gibt. Object.assign
      // ist flach, also traegt der Bezug sonst denselben Verweis wie die Konfiguration und
      // wandert bei jedem Getriebewechsel mit. Die Folge wuesste man erst spaeter: die
      // Messaufbauten stellen mit Object.assign(cfg, calibRef) den gefitteten Zustand her,
      // und dort snappen ratioRef, rpmScale, upshiftRpm und shiftMs als Skalare
      // automatisch auf die GT3-Werte zurueck. Ohne eigene Kopie blieben die
      // UEBERSETZUNGEN dabei die des gewaehlten Getriebes - GT3-Schaltpunkte auf
      // F1-Zahnraedern, und die Messung waere still falsch statt offen anders.
      //
      // Und er steht HIER, am Ende des Konstruktors, nicht vor rebuildGearModel(): rpmScale
      // und accelCalibration sind ABGELEITETE Groessen, die erst dort entstehen. Weiter oben
      // aufgenommen traegt der Bezug ihre Startwerte - rpmScale = 0 -, und ein Messaufbau,
      // der ihn herstellt, schaltet damit das Drehzahlmodell ab. Gemessen sah das aus wie
      // eine streng lineare Beschleunigung (1,38 / 2,70 / 4,02 / 5,36 s), also wie ein Auto
      // ohne Luftwiderstand. Am Ende aufgenommen braucht der Aufbau keine Ausnahmeliste.
      this.calibRef = Object.assign({}, this.config);
      this.calibRef.gears = this.config.gears.map(g => ({ ratio: g.ratio, topFrac: g.topFrac }));
      // Das Layout ZULETZT anwenden, nach calibRef: die Vorgabe ist neutral und aendert
      // nichts, aber ein Layout, das vor dem Kalibrierbezug gesetzt wuerde, waere danach
      // nicht mehr davon zu unterscheiden - und physConfigDiff() koennte es nicht melden.
      this.applyLayout('neutral');
    }

    // ---- EINSPURMODELL, ein Schritt ---------------------------------------------------
    //
    // INSTRUMENT UND KEIN AKTOR. Nichts hiervon stellt die Lenkung, und der Grund ist keine
    // Vorsicht, sondern eine Tatsache: das Modellauto rutscht nicht. Ein Modell, das eine
    // Bewegung rechnet, die das Fahrzeug nicht ausfuehren kann, wuerde die Vorgabe von der
    // Wirklichkeit wegdrehen - das Auto faehrt geradeaus, die Simulation meldet eine Drift,
    // und die App korrigiert eine Bewegung, die es nicht gibt.
    //
    // HALBIMPLIZIT und nicht explizit. Die Doku nennt das als den besseren der zwei Wege, und
    // die Begruendung ist nachrechenbar: die Zeitkonstante der Gierdynamik liegt bei 0,2 bis
    // 0,5 s, der Sendetakt bei 45 ms, und explizites Euler wird instabil, sobald die
    // Schraeglaufsteifigkeit hoch wird. Halbimplizit heisst hier: die neuen Zustaende stehen
    // im Nenner mit, und der Schritt bleibt bei jeder Steifigkeit stabil.
    //
    // DIE STEIFIGKEITEN FOLGEN DER ACHSLAST und sind nicht getrennt eingetippt. Damit kommt
    // der Eigenlenkgradient allein aus der Verteilung - genau die Aussage, die das Layout
    // treffen soll. Zwei unabhaengige Zahlen waeren die Gelegenheit, dass Layout und
    // Eigenlenkverhalten auseinanderlaufen.
    yawStep(dt) {
      const st = this.state, cfg = this.config;
      if (!(cfg.yawModelEffect > 0)) {
        st.yawRate = 0; st.slipAngle = 0; st.alphaFront = 0; st.alphaRear = 0;
        st.ayModel = 0; st.kU = 0; st.yawSteady = 0;
        return;
      }
      // ECHTE Einheiten. st.speedKmh ist der Modellmasstab; angezeigt und gerechnet wird mit
      // dem hochskalierten Tempo, weil die Gleichungen fuer ein echtes Auto gelten.
      const v = Math.abs(st.speedKmh) * REAL_SCALE / 3.6;   // m/s
      const L = cfg.wheelbaseM;
      const lv = L * (1 - cfg.loadFrontStatic);   // Abstand Schwerpunkt -> Vorderachse
      const lh = L * cfg.loadFrontStatic;         // ... -> Hinterachse
      const m = cfg.vehicleMassKg;
      const Iz = cfg.yawInertia;
      // DIE STEIFIGKEIT WAECHST UNTERLINEAR MIT DER LAST, und das ist nicht Feinschliff,
      // sondern der Grund, warum das Modell ueberhaupt etwas sagt.
      //
      // Mit strikter Proportionalitaet (Cv = C*f) kuerzt sich der Eigenlenkgradient exakt
      // weg: kU = m*f/(C*f) - m*(1-f)/(C*(1-f)) = m/C - m/C = 0, und zwar fuer JEDE
      // Verteilung. Das Modell haette jedes Layout als neutral gemeldet - eine Anzeige, die
      // aussieht wie eine Messung und immer dasselbe sagt.
      //
      // Ein Reifen traegt Seitenkraft unterlinear zur Last (dieselbe Lastempfindlichkeit,
      // die weiter oben schon frontCap formt). Damit wird
      //   kU = (m/C) * (f^(1-p) - (1-f)^(1-p))
      // und das ist bei f = 0,5 genau null, bei mehr Last hinten negativ - uebersteuernd,
      // wie ein hecklastiges Auto.
      const p = cfg.stiffnessLoadExp;
      const Cv = cfg.corneringStiffness * Math.pow(cfg.loadFrontStatic, p);
      const Ch = cfg.corneringStiffness * Math.pow(1 - cfg.loadFrontStatic, p);

      // Der Eigenlenkgradient. Er haengt NICHT vom Tempo ab und wird deshalb immer gerechnet,
      // auch im Stand: die Anzeige soll sagen, was das Auto IST, und nicht nur, was es
      // gerade tut.
      st.kU = (m * cfg.loadFrontStatic) / Cv - (m * (1 - cfg.loadFrontStatic)) / Ch;

      // Der uebertragene Winkel in Radiant. servoAngle ist auf -1..1 normiert, und 1 ist der
      // mechanische Anschlag von STEER_MAX_DEG.
      const delta = (this.outputs.servoAngle || 0) * STEER_MAX_DEG * Math.PI / 180;

      // Unter einer Mindestfahrt ist das Modell bedeutungslos: die Schraeglaufwinkel haben v
      // im Nenner, und im Stand geht alles gegen unendlich. Dann steht die Gierrate auf null
      // und die Anzeige sagt nichts - was ehrlicher ist, als eine Zahl zu zeigen, die aus
      // einer Division durch fast null kommt.
      if (v < 0.5) {
        st.yawRate = 0; st.slipAngle = 0; st.alphaFront = 0; st.alphaRear = 0;
        st.ayModel = 0; st.yawSteady = 0;
        return;
      }

      // Die stationaere Gierrate zum aktuellen Winkel, aus der Doku-Gleichung
      // delta = L/R + kU * ay, mit ay = v * r und r = v / R:
      //   delta = r * (L + kU * v^2) / v   ->   r = delta * v / (L + kU * v^2)
      st.yawSteady = delta * v / Math.max(1e-6, L + st.kU * v * v);

      // Halbimplizit: die Ableitungen mit den NEUEN Zustaenden aufgestellt und aufgeloest.
      //
      //   m*v*(beta' + r) = Fv + Fh
      //   Iz*r'           = Fv*lv - Fh*lh
      //   Fv = -Cv*(beta + lv*r/v - delta),   Fh = -Ch*(beta - lh*r/v)
      //
      // Zusammengefasst mit a11..a22 und den Eingangsgliedern b1, b2. Ein 2x2-System je
      // Takt - bei 6,7 Mikrosekunden Gesamtphysik ist das nichts.
      const a11 = -(Cv + Ch) / (m * v);
      const a12 = -1 - (Cv * lv - Ch * lh) / (m * v * v);
      const a21 = -(Cv * lv - Ch * lh) / Iz;
      const a22 = -(Cv * lv * lv + Ch * lh * lh) / (Iz * v);
      const b1 = Cv / (m * v);
      const b2 = Cv * lv / Iz;

      // (I - dt*A) * x_neu = x_alt + dt*B*delta
      const m11 = 1 - dt * a11, m12 = -dt * a12;
      const m21 = -dt * a21, m22 = 1 - dt * a22;
      const r1 = st.slipAngle + dt * b1 * delta;
      const r2 = st.yawRate + dt * b2 * delta;
      const det = m11 * m22 - m12 * m21;
      if (Math.abs(det) > 1e-12) {
        st.slipAngle = (r1 * m22 - m12 * r2) / det;
        st.yawRate = (m11 * r2 - r1 * m21) / det;
      }

      // Die Schraeglaufwinkel und die Querbeschleunigung folgen aus den zwei Zustaenden.
      st.alphaFront = st.slipAngle + lv * st.yawRate / v - delta;
      st.alphaRear = st.slipAngle - lh * st.yawRate / v;
      // ay aus den KRAEFTEN und nicht aus v*(r + beta'): dieselbe Groesse, aber ohne einen
      // Differenzenquotienten, der bei 45 ms rauscht.
      const Fv = -Cv * st.alphaFront;
      const Fh = -Ch * st.alphaRear;
      st.ayModel = (Fv + Fh) / m;

      // ---- WAS DAS MODELL EHRLICH SAGEN KANN ------------------------------------------
      //
      // Der BETRAG von ayModel ist fuer sich genommen keine brauchbare Anzeige, und das ist
      // eine Eigenschaft dieser App und kein Rechenfehler. Gemessen bei 120 km/h und 28,8
      // Grad Einschlag: 212 m/s^2, also 21 g. Die Rechnung ist richtig - 28,8 Grad bei
      // 120 km/h IST ein Radius von 5 Metern, und der IST 21 g.
      //
      // Der Widerspruch steckt in den Eingaengen: der Lenkbereich bis 45 Grad gehoert zu
      // einem Modellauto, die angezeigten Kilometer je Stunde gehoeren zu einem echten. Ein
      // echtes Auto braucht bei 120 km/h wenige Grad. Das Modell meldet also korrekt ein
      // unmoegliches Manoever.
      //
      // BRAUCHBAR IST NUR EIN VERHAELTNIS ZWEIER MODELLGROESSEN, und das ist yawSteady
      // weiter oben: die Ist-Gierrate gegen die stationaere. 100 Prozent heisst
      // eingeschwungen, mehr heisst "dreht noch ein", weniger heisst "schiebt". Ein
      // Verhaeltnis ist vom Skalenwiderspruch unberuehrt, ein Betrag nicht.
      //
      // Hier stand eine Ausnutzung (ayModel gegen eine Haftgrenze) und eine
      // Grenzgeschwindigkeit. Beide sind weggefallen: gefahren gemessen stand die Ausnutzung
      // bei 165 km/h dauerhaft ueber 100 Prozent, und eine Anzeige am Anschlag sagt nichts.
      // Das Reifenquietschen laeuft aus demselben Grund ueber latUse und nicht hierueber.
    }

    // Ein Layout anwenden. Setzt die drei Fahrzeugwerte und leitet daraus ab, was abzuleiten
    // ist - die Lenkgeschwindigkeit und den Ruhewert der Achslast.
    //
    // Der RUHEWERT wird mitgesetzt, weil er sonst beim ersten Takt von 50:50 auf den neuen
    // Wert springen wuerde: die Radlastanzeige zeigte kurz das falsche Auto.
    applyLayout(name) {
      const L = LAYOUTS[name] || LAYOUTS.neutral;
      this.config.loadFrontStatic = L.vorn;
      this.config.wheelbaseM = L.radstand;
      this.config.yawInertia = L.iz;
      this.config.steerRatePerS = steerRateFor(L.iz);
      this.state.loadFront = L.vorn;
      this.layoutName = LAYOUTS[name] ? name : 'neutral';
      return this.layoutName;
    }

    // Ein Getriebe anwenden. Vier Dinge daran sind keine Geschmacksfrage:
    //
    // 1. DAS ARRAY WIRD AN DER STELLE GEAENDERT, nicht ersetzt. Die Ghosts teilen
    //    config.gears mit dieser Maschine per Verweis - absichtlich, siehe die Begruendung
    //    in 90-ghosts.js: eine Kopie laesst accelScale() zweimal kalibrieren. Ein Splice
    //    erreicht damit jeden Teilhaber auf einmal, auch einen schon fahrenden Ghost. Ein
    //    neues Array haette den Verweis gekappt, und das Feld waere still im alten
    //    Getriebe weitergefahren.
    // 2. NICHT DEN KALIBRIERBEZUG MITVERBIEGEN. Die Messaufbauten stellen den gefitteten
    //    Zustand mit Object.assign(cfg, calibRef) her, und danach zeigen beide auf
    //    dasselbe Array. Ein Splice waere dann eine Aenderung am Bezug selbst - also erst
    //    loesen, dann aendern.
    // 3. ratioRef wird GERECHNET und nicht gehalten. Es ist die Uebersetzung des letzten
    //    Gangs, an der thrustAt() normiert; zwei Orte fuer dieselbe Zahl waren in diesem
    //    Projekt schon oft genug eine Abweichung. Dass sie bei allen drei Getrieben 0,88
    //    ist, macht die Rechnung nicht ueberfluessig, sondern nur unauffaellig.
    // 4. rebuildGearModel() VOR calibrateAccel(). Die Kalibrierung braucht rpmScale, und
    //    rpmScale kommt aus den Uebersetzungen - dieselbe Reihenfolge, die der Konstruktor
    //    einhaelt.
    //
    // Was das Getriebe damit aendert, ist die FORM der Beschleunigung: wo die Stufen sitzen
    // und welcher Gang zieht. Nicht die Schlagzeilenzahl - calibrateAccel() loest gegen die
    // eingestellte Zeit von null auf Hoechstgeschwindigkeit, und die bleibt. Genau wie das
    // Layout die Balance aendert und nicht die Geradeausleistung.
    applyGearbox(name) {
      const G = GEARBOXES[name] || GEARBOXES.gt3;
      const cfg = this.config;
      if (this.calibRef && cfg.gears === this.calibRef.gears) {
        cfg.gears = cfg.gears.map(g => ({ ratio: g.ratio, topFrac: g.topFrac }));
      }
      cfg.gears.splice(0, cfg.gears.length,
        ...G.gears.map(g => ({ ratio: g.ratio, topFrac: g.topFrac })));
      cfg.ratioRef = cfg.gears[cfg.gears.length - 1].ratio;
      cfg.upshiftRpm = G.upshiftRpm;
      cfg.downshiftRpm = G.downshiftRpm;
      // MINDESTENS EIN SENDETAKT. Gemessen sind die 40 ms des F1-Getriebes 0,89 Takte bei
      // 45 ms Sendeintervall - eine Schaltpause, die kuerzer ist als ein Paket, kann zwischen
      // zwei Takten komplett verschwinden, und dann sieht weder die Simulation noch das Auto
      // etwas davon. Die Tabelle behaelt die Angabe; hier steht die Grenze des Programms.
      cfg.shiftMs = Math.max(CONTROL_SEND_INTERVAL_MS, G.shiftMs);
      // Von acht auf fuenf Gaenge zeigt der eingelegte Gang sonst ins Leere, und
      // gearRatio() liest undefined.ratio.
      this.state.currentGear = Math.min(this.state.currentGear, cfg.gears.length - 1);
      this.rebuildGearModel();
      this.calibrateAccel();
      this.gearboxName = GEARBOXES[name] ? name : 'gt3';
      return this.gearboxName;
    }

    // Central reset shared by the E-stop and the pit stop, so the two
    // can't drift apart on which fields they remember to clear.
    reset() {
      const st = this.state;
      st.speedKmh = 0; st.virtualSpeed = 0;
      // Der Ruhewert der Achslast folgt dem LAYOUT und nicht 0,5: bei einem Heckmotor liegt
      // das Auto im Stand hinten tiefer, und nach einem Not-Halt soll die Radlastanzeige
      // nicht kurz ein anderes Auto zeigen.
      st.loadFront = this.config.loadFrontStatic;
      st.driveMode = 'neutral'; st.neutralRpm = 0;
      st.currentGear = 0; st.rpm = IDLE_RPM; st.rpmFrac = 0;
      st.isShifting = false; st.engineLoad = 0; st.onLimiter = false;
    }

    // rpm comes from the gear RATIO, not from the band edges. Consequence straight out of
    // the real data: gears 1-5 hit the limiter at their top speed, 6th tops out at
    // ~8300rpm because it is drag-limited. That asymmetry is genuine, so it is preserved.
    rebuildGearModel() {
      let maxProduct = 0;
      for (const g of this.config.gears) maxProduct = Math.max(maxProduct, g.ratio * g.topFrac);
      this.config.rpmScale = REDLINE_RPM / maxProduct;
    }

    gearRatio(gearIdx) {
      return gearIdx < 0 ? this.config.reverseRatio : this.config.gears[gearIdx].ratio;
    }

    rpmRawAt(v, gearIdx) { // gearIdx -1 == reverse
      const cfg = this.config;
      return cfg.rpmScale * this.gearRatio(gearIdx) * (Math.abs(v) / cfg.topSpeedKmh);
    }

    // Always positive, always opposes motion. Linear term = the "Ausrollen" slider
    // (rolling resistance), quadratic term = aero. The aero term is expressed in units of
    // accelScale so that scaling the drivetrain scales thrust and drag together — that is
    // what keeps calibrateAccel solvable for any reachable target time.
    // onPower: under load only a fraction of the ROLLING term applies. Without this split
    // the "Ausrollen" slider doubles as an acceleration brake — at its default it ate so
    // much thrust that no calibration could make a launch last 3s at all, and the solver
    // sat permanently on its feasibility floor. Coasting still gets the full value, which
    // is what that slider is actually for.
    // gearIdx ist neu und aendert das Ausrollen erheblich. Vorher kannte diese Funktion den
    // Gang nicht, also bremste der Motor im ersten Gang genauso schwach wie im sechsten -
    // physikalisch falsch und der Grund, warum das Ausrollen im ersten Gang gefuehlt nicht
    // endete. Gerechnet: bei u = 0.126 (Mitte des ersten Gangs) kam eine Verzoegerung von
    // 3.0 angezeigten km/h pro Sekunde heraus, also rund 25 s bis zum Stillstand.
    //
    // Motorbremsung skaliert mit dem QUADRAT der Uebersetzung: einmal, weil die kurze
    // Uebersetzung den Motor bei gleicher Fahrgeschwindigkeit schneller dreht (und das
    // Schleppmoment mit der Drehzahl steigt), und einmal, weil dasselbe Moment ueber die
    // kurze Uebersetzung staerker am Rad ankommt. 3.75 gegen 0.88 sind Faktor 4.26, im
    // Quadrat 18. Damit kommen im ersten Gang rund 13 angezeigte km/h pro Sekunde heraus,
    // was fuer einen Rennwagen ohne Gas realistisch ist; im sechsten bleibt es wie vorher,
    // dort dominiert ohnehin der Luftwiderstand.
    resistAt(v, accelScale, onPower, gearIdx) {
      const cfg = this.config;
      const u = Math.abs(v) / cfg.topSpeedKmh;
      if (onPower) {
        // Both terms scale with accelScale so the whole drivetrain scales as one system.
        // With an ABSOLUTE rolling term the constant drag swallowed the thrust as soon as
        // the calibration got small, and "half speed in 3s AND reach top speed" became
        // mathematically impossible — which is exactly what the fit ran into.
        return accelScale * (cfg.onPowerRollK * u + cfg.aeroDragK * u * u);
      }
      // Coasting: rolling + engine braking + aero, see the config for why three.
      // Deliberately NOT scaled by accelScale, unlike the on-power branch: coasting is
      // what the car does when the drivetrain is out of the picture, and the slider is
      // meant to be an absolute deceleration the user can reason about.
      // Nur der Motorbremsanteil haengt am Gang. Rollwiderstand und Luftwiderstand nicht -
      // die wissen nichts davon, welcher Gang eingelegt ist.
      const top = cfg.gears[cfg.gears.length - 1].ratio;
      const r = gearIdx === undefined || gearIdx === null || gearIdx < 0
        ? top                       // Leerlauf oder Rueckwaerts: keine Verstaerkung
        : cfg.gears[Math.min(gearIdx, cfg.gears.length - 1)].ratio;
      const gearAmp = (r / top) * (r / top);
      return cfg.coastDragPerS * (cfg.coastRollDecel
                                  + cfg.coastEngineDecel * gearAmp * u
                                  + cfg.coastAeroDecel * u * u);
    }

    // Wheel thrust as an acceleration in km/h/s: torque(rpm) x gear ratio, with a soft
    // rev limiter. The limiter is what caps each gear's top speed — no artificial clamp.
    thrustAt(v, gearIdx, throttle, accelScale) {
      const cfg = this.config;
      const raw = this.rpmRawAt(v, gearIdx);
      const limiterCut = raw > REDLINE_RPM
        ? Math.max(0, Math.min(1, 1 - (raw - REDLINE_RPM) / LIMITER_SOFT_RPM))
        : 1;
      // Soft launch: see config. Ramps in from launchSoftFloor at a standstill.
      const soft = cfg.launchSoftFloor + (1 - cfg.launchSoftFloor)
                 * Math.min(1, Math.abs(v) / Math.max(1e-6, cfg.launchSoftKmh));
      // Beim Start im ersten Gang wird die Kurve bei der Startdrehzahl abgefragt: die
      // Kupplung schleift, also dreht der Motor schneller als die Raeder es verlangen.
      const fuerMoment = (gearIdx === 0 && raw < cfg.launchClutchRpm)
        ? cfg.launchClutchRpm : raw;
      return throttle * torqueAt(Math.min(fuerMoment, REDLINE_RPM)) * limiterCut
             * (this.gearRatio(gearIdx) / cfg.ratioRef) * accelScale * soft;
    }

    accelScale() {
      const c = this.config;
      return (c.topSpeedKmh / c.accelScaleBasisS) * c.accelerationFactor * c.accelCalibration;
    }

    gearBand(i) {
      const cfg = this.config;
      return {
        bottom: i === 0 ? 0 : cfg.gears[i - 1].topFrac * cfg.topSpeedKmh,
        top: cfg.gears[i].topFrac * cfg.topSpeedKmh,
      };
    }

    update(inputs, dt) {
      const cfg = this.config, st = this.state;
      let isBraking = false;
      st.absActive = false;
      st.onLimiter = false;

      // Speed is simulated in real km/h and the throttle byte is DERIVED from it, rather
      // than being the driver's pedal position. That is the key point: the car reaches top
      // speed almost instantly if handed a full-throttle byte, so sending the raw pedal
      // made it slam to 100% at once. Ramping a simulated speed and sending
      // speed/topSpeed produces a real multi-second pull instead.
      const A = this.accelScale();
      const revTopKmh = cfg.reverseTopFrac * cfg.topSpeedKmh;
      const stopped = Math.abs(st.speedKmh) < cfg.reverseStandstillKmh;

      // Reverse selection: the SHIFT BUTTONS, in automatic exactly as in manual.
      //
      // What used to be here: in automatic, holding the brake at a standstill for
      // a delay timer toggled between D and R, "like an automatic's lever". It was
      // edge-triggered and latched, and it still fired constantly by accident - because
      // coming to a halt IS braking, and keeping the brake on at a standstill is what
      // everyone does. Stop at the line, hold the brake half a second, and the car
      // silently selected reverse. Reported as "it shifts into R by itself", and it did.
      //
      // triggerShift() already owns the whole chain R <- N <- 1 ... <- 6 with its own
      // standstill guard, and the shift bindings are not gated on gearbox mode, so
      // reverse stays reachable in automatic: two downshifts from first. No new binding,
      // one less way to end up in R without asking for it.
      //
      // Und damit ist auch st.reverseLatched weggefallen. Es sollte verhindern, dass eine
      // GEHALTENE Bremse den Gang gleich wieder zurueckkippt - eine Absicherung fuer eine
      // Mechanik, die es hier nicht mehr gibt: triggerShift() wird nur aus Tastendruecken
      // gerufen, ein Dauerzustand kann es nicht wiederholt auslösen. Sechs Schreibstellen
      // ohne eine einzige Lesestelle, also war der Schutz ohnehin keiner.
      const reversing = st.driveMode === 'reverse';
      const inNeutral = st.driveMode === 'neutral';
      const gearIdx = reversing ? -1 : st.currentGear;

      // Rev counter. In gear it is geometry: road speed times ratio. Out of gear there is
      // nothing to divide by, so the engine simply follows the pedal — lagged, because an
      // engine has inertia and a step would sound like a switch.
      if (inNeutral) {
        const aN = 1 - Math.exp(-dt / cfg.neutralRevTau);
        st.neutralRpm += (inputs.throttle - st.neutralRpm) * aN;
        st.rpm = IDLE_RPM + st.neutralRpm * (REDLINE_RPM - IDLE_RPM);
        st.rpmFrac = st.neutralRpm;
        st.onLimiter = st.neutralRpm > 0.985;
      } else {
        st.neutralRpm = 0;
        const rpmRaw = this.rpmRawAt(st.speedKmh, gearIdx);
        st.rpm = Math.max(IDLE_RPM, Math.min(REDLINE_RPM, rpmRaw));
        st.rpmFrac = (st.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM);
        st.onLimiter = rpmRaw > REDLINE_RPM - 60;
      }

      // Under load the rolling term is reduced (see resistAt); coasting gets it in full.
      const onPower = inputs.throttle > 0.02 || inputs.brake > 0.02;
      // ---- Tyre friction circle ----
      // A tyre has ONE grip budget. Whatever is spent generating lateral force in a corner
      // is no longer available to accelerate or brake, which is why you cannot floor it
      // mid-corner. Cornering demand rises with both steer angle and speed, so this uses
      // last tick's damped steering (a one-frame lag, 45ms, imperceptible) times the speed
      // fraction. Longitudinal grip is the remaining leg of the circle: sqrt(1 - lat^2).
      // Straight ahead lat = 0 and nothing changes; at full lock near top speed it falls to
      // almost nothing and the car simply will not accelerate — the real behaviour.
      const latUse = Math.min(1, Math.abs(st.dampedSteering)
                                 * (Math.abs(st.speedKmh) / cfg.topSpeedKmh)
                                 * cfg.corneringLoad);
      st.gripLong = Math.sqrt(Math.max(0, 1 - latUse * latUse));
      // Herausgegeben, weil das Reifenquietschen sie braucht: sie ist die Querausnutzung des
      // Reibkreises, auf 1 begrenzt, und damit die einzige Groesse hier, die "am Limit"
      // wirklich mit 1 beziffert. ayUse aus dem Einspurmodell steht gemessen oft ueber 1.
      st.latUse = latUse;
      // Surface grip multiplies on top of the circle. Kept as its own factor so the two
      // effects stay legible: gripLong is how hard you are cornering, gripScale is rain.
      const surf = cfg.gripScale;

      // Signed longitudinal demand: + on throttle, - on brake. Fed through two lags (see
      // config) so pitch leads and tyre force follows.
      const rolling = Math.abs(st.speedKmh) > cfg.topSpeedKmh * 0.02;
      const demand = (inputs.brake > 0.02) ? -inputs.brake
                   : (inputs.throttle > 0.02 ? inputs.throttle
                   : (rolling ? -cfg.coastPitch : 0));   // coasting: engine braking
      const aL = 1 - Math.exp(-dt / cfg.loadTau);
      const aU = 1 - Math.exp(-dt / cfg.useTau);
      // Hier stand 0.5 als Literal, und das war die statische Achslastverteilung: der
      // einzige Ort, an dem sie ueberhaupt vorkam. Damit hatten alle Autos dasselbe
      // Fahrwerk.
      st.loadFront += ((cfg.loadFrontStatic - demand * cfg.transferK) - st.loadFront) * aL;
      st.longUse += (demand - st.longUse) * aU;

      // ---- VIER RADLASTEN: Nicken mal Waelzen ----------------------------------------
      //
      // Die Laengsverlagerung stand schon da (loadFront), der Querbedarf auch (latUse) - nur
      // die Information, WELCHE Seite er belastet, lag unbenutzt daneben. Aus beidem fallen
      // vier Radlasten heraus, ohne eine neue Annahme:
      //
      //   Achsanteil   loadFront bzw. 1 - loadFront
      //   Seitenanteil 0,5 +/- latUse * tyreAsymShare / 2, Vorzeichen aus der Lenkrichtung
      //   Radlast      Achsanteil * Seitenanteil * 4, also 1,0 im Mittel
      //
      // Eine Rechtskurve (dampedSteering > 0) belastet die LINKEN Raeder. Das ist der Punkt,
      // an dem sich das Vorzeichen entscheidet, und er ist einen Kommentar wert: das AEUSSERE
      // Rad traegt mehr, und aussen ist bei Rechtskurve links.
      const lenkVz = st.dampedSteering >= 0 ? 1 : -1;
      const rollen = Math.max(0, Math.min(1, latUse)) * cfg.tyreAsymShare / 2;
      const anteilLinks = 0.5 + lenkVz * rollen;
      const anteilRechts = 1 - anteilLinks;
      st.load4[0] = st.loadFront * anteilLinks * 4;          // vorne links
      st.load4[1] = st.loadFront * anteilRechts * 4;         // vorne rechts
      st.load4[2] = (1 - st.loadFront) * anteilLinks * 4;    // hinten links
      st.load4[3] = (1 - st.loadFront) * anteilRechts * 4;   // hinten rechts
      // Derselbe Seitenanteil ohne die Achsaufteilung, auf 1 im Mittel normiert.
      st.latShare4[0] = st.latShare4[2] = anteilLinks * 2;
      st.latShare4[1] = st.latShare4[3] = anteilRechts * 2;

      // How wet it is, from the surface factor itself rather than from a weather flag:
      // GRIP_MATRIX runs 1.00 (dry slicks) down to 0.45 (rain on slicks), so this is 0 in
      // the dry and 1 on slicks in the rain.
      // Wie stark der Nassverlust GERADE wirkt: unter wetOnsetFrac gar nicht, ab
      // wetFullFrac voll. Der Grund steht bei den Reglern: die alte Fassung hat die
      // Kapazitaet der Vorderachse bei jeder Fahrt mit 0,45 multipliziert, das Motorbremsen
      // aber nicht - und damit war der geschrumpfte Reibkreis schon im Schritttempo leer.
      // Auf Slicks im Regen liess sich nur noch geradeaus fahren.
      const vFrac = Math.abs(st.speedKmh) / Math.max(1e-6, cfg.topSpeedKmh);
      const wetBlend = Math.max(0, Math.min(1,
        (vFrac - cfg.wetOnsetFrac) / Math.max(1e-6, cfg.wetFullFrac - cfg.wetOnsetFrac)));
      // Die WIRKSAME Oberflaeche fuer die Lenkung. Die Laengskraefte weiter unten benutzen
      // weiter das ungemilderte surf: dass ein nasser Reifen beim Anfahren durchdreht und
      // laenger bremst, stimmt auch langsam - was nicht stimmte, war die Lenkung.
      const surfSteer = 1 - (1 - surf) * wetBlend;
      const wet = Math.max(0, Math.min(1, (1 - surfSteer) / 0.55));

      // Front axle: capacity scales with the load actually on it; what the brake is already
      // using is taken out of the circle, leaving the lateral share for steering.
      //
      // THE SURFACE MULTIPLIES THE CAPACITY, not the demand. Until now `surf` was applied
      // only to the longitudinal forces (thrust and braking, see below) and never to
      // steering at all, so rain changed how the car accelerated and stopped but not
      // whether it would turn. Shrinking the front axle's capacity with the surface is the
      // friction circle doing its job: the brake's demand is unchanged, so in the wet it
      // eats a far larger share of a smaller circle, and past a point there is nothing
      // left to steer with. In the dry surf is exactly 1.0, so dry behaviour is untouched
      // - which is the property that makes this safe to change.
      //
      // A first attempt amplified `loadGain` in the wet instead (der Wert ist inzwischen
      // weg, die Lastempfindlichkeit hat seine Rolle uebernommen). That was wrong by
      // inspection of the measurement: braking moves load ONTO the front, so a bigger
      // load gain made wet braking steer BETTER (steerGrip 1.006 against 0.464 dry) -
      // the exact opposite of what was asked.
      // GEDECKELT auf 1. Die Lastverlagerung kann Grip UMverteilen, nicht erzeugen, und
      // die Hinterachse wird fuer die Lenkung ohnehin nicht betrachtet - ohne Deckel wurde
      // der Reibkreis beim Bremsen GROESSER als im Normalzustand. Gemessen: steerGrip 1,25
      // beim Anbremsen aus 120 km/h, also mehr Lenkung als rollend. Das ist die eine Haelfte
      // der Beschwerde "erst beim Bremsen kann ich gut lenken".
      // Lastempfindlichkeit statt linearem Zuwachs. u ist Fz/Fz0, im Stand genau 1,
      // beim Anbremsen bis etwa 1,6 und unter Zug bis herunter auf 0,4.
      // uF ist die Last RELATIV ZUR EIGENEN RUHELAST und nicht relativ zu 50:50. Hier
      // stand 0.5 als zweites Literal derselben Geometrie, und es war der Grund, warum die
      // Layouts zunaechst wirkungslos blieben: mit 0,5 als Bezug landeten alle ueber dem
      // Deckel bei 1, und der uebertragene Winkel war fuer alle fuenf gleich - gemessen
      // 45 Grad rollend und 26 Grad bremsend, ohne jeden Unterschied.
      //
      // Auf die eigene Ruhelast bezogen ist uF im Stand fuer JEDES Layout genau 1, und die
      // Verlagerung wirkt relativ: ein Heckmotor mit 39 Prozent vorn verschiebt beim Bremsen
      // auf 69 Prozent, also den Faktor 1,77 - deutlich mehr als die 1,60 des neutralen
      // Autos. Genau das ist die Eigenart eines Heckmotors: er taucht relativ tiefer ein.
      const uF = st.loadFront / Math.max(0.05, cfg.loadFrontStatic);
      const capRaw = uF * (1 - cfg.tyreLoadSens * (uF - 1));
      // Der Deckel bei 1 bleibt, und er ist eine Aussage ueber das SERVO: steerGrip
      // skaliert den ausgegebenen Lenkwinkel, und ueber Vollausschlag hinaus gibt es dort
      // nichts zu holen. Ohne ihn waere der Reibkreis beim Bremsen groesser als im Rollen,
      // gemessen 1,25 beim Anbremsen aus 120 km/h - die eine Haelfte der Beschwerde
      // "erst beim Bremsen kann ich gut lenken".
      // Windschatten: weniger Abtrieb heisst weniger Kapazitaet an der Vorderachse. Er
      // senkt frontCap und nicht steerGrip direkt - so geht er durch dieselbe Wurzel wie
      // alles andere und kann die Bremse nicht "gratis" mitverbessern.
      const luft = 1 - cfg.dirtyAirMax * Math.max(0, Math.min(2, cfg.dirtyAirEffect))
                       * Math.max(0, Math.min(1, st.dirtyAir));
      // DER ABSOLUTE ACHSLASTANTEIL, und er steht NACH dem Deckel - das ist der Punkt.
      //
      // Der Deckel bei 1 ist eine Aussage ueber das SERVO: mehr als Vollausschlag gibt es
      // nicht. Eine leichte Vorderachse hat aber wirklich weniger Griff, und das ist keine
      // Servogrenze. Vor dem Deckel gerechnet wuerde er es wegschneiden, genau wie er die
      // Layouts vorher wirkungslos gemacht hat.
      //
      // LINEAR und mit einer Staerke, die gemessen ist: frontUse ist gegen eine volle
      // Kapazitaet kalibriert, und der Reibkreis (eine Wurzel aus einer Differenz von
      // Quadraten) saettigt schon bei zehn Prozent Absenkung. Ein physikalisch begruendeter
      // Exponent von 0,85 machte das Auto unfahrbar - siehe frontAxleEffect.
      //
      // NUR VORNE, und das ist eine bewusste Unsymmetrie: frontCap geht ausschliesslich in
      // die Lenkung. Denselben Griff hinten absolut zu rechnen wuerde die Anfahrzeit
      // veraendern - und die ist gegen eine MESSUNG kalibriert (RMSE 7,3 %). Eine gewaehlte
      // Bauform darf eine Messung nicht verschieben.
      const frontAxle = 1 - cfg.frontAxleEffect
                            * (1 - cfg.loadFrontStatic / FRONT_AXLE_REF);
      const frontCap = Math.min(1, Math.max(0.15, capRaw)) * frontAxle * surfSteer * luft;
      // Die Anforderung skaliert mit der Fahrt, und zwar aus demselben Grund wie beim
      // Regen ein paar Zeilen weiter oben: bei 20 km/h braucht eine Vollbremsung einen
      // Bruchteil der verfuegbaren Haftung, das Auto steht nach zwei Metern; bei 250 km/h
      // braucht sie alles. Ohne diese Skalierung uebersteigt die Anforderung die Kapazitaet,
      // die Wurzel wird null, und die Lenkung klebt vom halben Bremsvorgang bis zum Stand am
      // Notboden von 0,12. Gemessen: unter 70 km/h durchgehend 0,12.
      //
      // Dieselben zwei Schwellen wie beim Regen: unterhalb der ersten gar keine Wirkung,
      // ab der zweiten voll. Seit v0.5 bei 14,8 und 65 angezeigten km/h statt 29,5 und 180 -
      // gemessen gab volles Bremsen bei 60 km/h vorher noch 100 % des Rollwerts, und auf
      // einer Wohnzimmerstrecke kommt man kaum ueber 100.
      //
      // UND EINE FALSCHE ERKLAERUNG BERICHTIGT, die hier in der Naehe stand: dass Eintauchen
      // und Bremsanforderung gegeneinander arbeiten, gilt im Trockenen NICHT. frontCap ist
      // mit Math.min(1, ...) gedeckelt und liegt beim Rollen wie beim Bremsen auf 1,0 - das
      // Eintauchen bringt dort gar nichts. Der einzige Grund war diese Wichtung.
      const lastFrac = Math.max(0, Math.min(1,
        (vFrac - cfg.loadOnsetFrac) / Math.max(1e-6, cfg.loadFullFrac - cfg.loadOnsetFrac)));
      // Die Bremsbalance sitzt HIER und nicht an maxSteerLimit. Das ist der Unterschied
      // zum alten Trail-Braking-Bonus: der wirkte auf die erlaubte Lenkvorgabe und wurde
      // von Math.min(1, ...) im 1. Gang und bei niedrigem Tempo vollstaendig weggeschnitten.
      // Die Balance wirkt auf die ANFORDERUNG an die Vorderachse und damit in jedem Gang
      // und bei jedem Tempo.
      const biasK = cfg.brakeBias / Math.max(1e-6, cfg.brakeBiasRef);
      const frontUse = Math.max(0, -st.longUse) * cfg.brakeUseGain * biasK * lastFrac;
      // The 0.12 floor is a dry-weather reserve: it stops the car ever being completely
      // helpless. In the wet there is no such reserve - once the brake has eaten the front
      // axle, the friction circle really is empty and the steering does nothing. So the
      // floor is scaled away with wetness instead of a separate rule being invented.
      st.steerGrip = Math.max(0.12 * (1 - wet), Math.min(1,
        Math.sqrt(Math.max(0, frontCap * frontCap - frontUse * frontUse))))
        * st.tyreGrip;   // cold or worn tyres will not turn the car either
      // Rear axle drives. Normalised to the on-power equilibrium (see config), so this term
      // is 1 once the car has squatted and below 1 only while the rear is still light — the
      // soft first moments of a throttle application, not a free performance bonus.
      const rearGrip = Math.max(0.35, Math.min(1,
        (1 - st.loadFront) / (1 - loadOnPower(cfg))));

      // ---- Fuel mass ----
      st.massFactor = 1 + cfg.fuelWeightEffect * cfg.fuelMassSpan * st.fuelLoad;

      // ---- Tyre temperature ----
      // Heat comes from the work the tyres are actually doing: cornering load plus
      // longitudinal demand, both only counting once the car is moving. Cooling scales with
      // how far above ambient they already are, so they settle rather than run away.
      const work = Math.min(1, (Math.abs(latUse) + Math.abs(st.longUse))
                               * (Math.abs(st.speedKmh) / cfg.topSpeedKmh));
      const span = cfg.tyreOptimalC - cfg.tyreAmbientC;
      // Auch die Erwaermung skaliert mit dem Regler - aber nur die HEIZseite. Die Kuehlung
      // ist eine Eigenschaft der Umgebung und nicht der Einstellung; sie mitzuskalieren
      // haette die Zeitkonstante unveraendert gelassen und damit gar nichts geaendert.
      // ---- Reifendruck ----------------------------------------------------------------
      // Wenig Druck heisst mehr Walkarbeit: schnellere Erwaermung, mehr Verschleiss,
      // besserer Kaltgriff. Viel Druck umgekehrt. Kein neuer Zustand, nur drei Faktoren auf
      // vorhandene Groessen - und bei der Referenzstellung sind alle drei genau 1, der
      // Regler in der Mitte aendert also nichts.
      const pRel = Math.max(0.5, cfg.tyrePressureBar / Math.max(1e-6, cfg.tyrePressureRef));
      const pHeat = 1 / pRel;      // weniger Druck -> waermer
      const pWear = 1 / pRel;      // weniger Druck -> mehr Verschleiss
      const pCold = pRel;          // mehr Druck -> kalt schlechter

      // VIER Temperaturen, jede mit ihrer eigenen Radlast. Die Arbeit skaliert mit der
      // Last: ein entlastetes Innenrad wird kaum warm, ein belastetes Aussenrad umso mehr.
      // Die Kuehlung ist fuer alle vier dieselbe - sie haengt an der Umgebung und nicht am
      // Rad.
      const asymAn4 = cfg.tyreAsymEffect > 0;
      for (let i = 0; i < 4; i++) {
        const last = asymAn4 ? st.load4[i] : 1;
        st.tyreTemp4[i] += (cfg.tyreHeatRate * pHeat * Math.max(1, cfg.tyreEffect)
                            * work * last
                            - cfg.tyreCoolRate * (st.tyreTemp4[i] - cfg.tyreAmbientC) / span)
                           * dt;
        st.tyreTemp4[i] = Math.max(cfg.tyreAmbientC, st.tyreTemp4[i]);
      }
      // tyreTempC BLEIBT der Mittelwert. Alle vorhandenen Leser - Griffrechnung,
      // Boxenstopp, die Selbsttests - haengen daran, und ein zweiter Weg zur Temperatur
      // waere eine zweite Wahrheit.
      st.tyreTempC = (st.tyreTemp4[0] + st.tyreTemp4[1] + st.tyreTemp4[2] + st.tyreTemp4[3]) / 4;

      // Wear accumulates with the same work, and faster once they are hot — which is what
      // makes an aggressive stint cost more than a tidy one.
      const hotFactor = 1 + Math.max(0, (st.tyreTempC - cfg.tyreOptimalC) / span);
      // Die RATE skaliert voll mit dem Regler, auch ueber 100 % hinaus: 200 % heisst
      // doppelt so schneller Verschleiss. Das ist die Haelfte des Reglers, die oberhalb von
      // 100 % ueberhaupt eine Bedeutung haben kann - das Griffdefizit ist gedeckelt.
      // ---- Verschleiss, links und rechts getrennt ------------------------------------
      // Eine Rechtskurve laestet die LINKEN Reifen. Die Aufteilung kommt aus der
      // KOMMANDIERTEN Lenkung, weil das die einzige Groesse ist, die wir wirklich kennen -
      // eine gemessene Querbeschleunigung meldet kein Byte.
      //
      // Die Summe der beiden Anteile ist immer 2, also bleibt der Mittelwert genau die
      // alte Rate. Ohne diese Normierung waere "Asymmetrie an" auch "mehr Verschleiss an",
      // und dann waere nicht messbar, was der Schalter tut.
      // VIER Verschleisswerte, jeder mit seiner Radlast. Vorher waren es zwei
      // (links/rechts) aus der Lenkrichtung allein - vorne und hinten waren verklebt,
      // obwohl das Bremsen die Vorderachse laengst belastet.
      const zuwachs = cfg.tyreWearRate * pWear * cfg.tyreEffect * work * hotFactor * dt;
      const asym = Math.max(0, Math.min(2, cfg.tyreAsymEffect));
      for (let i = 0; i < 4; i++) {
        const last = asym > 0 ? st.load4[i] : 1;
        st.tyreWear4[i] = Math.min(1, st.tyreWear4[i] + zuwachs * last);
      }
      // Die Seitenmittel und der Gesamtmittelwert werden GERECHNET und nicht gefuehrt: so
      // koennen sie per Konstruktion nicht von den vier Raedern abweichen.
      st.tyreWearL = (st.tyreWear4[0] + st.tyreWear4[2]) / 2;
      st.tyreWearR = (st.tyreWear4[1] + st.tyreWear4[3]) / 2;
      st.tyreWear = (st.tyreWearL + st.tyreWearR) / 2;

      // Der Aktorteil: die staerker abgenutzte Seite erzeugt weniger Querkraft, also zieht
      // das Auto dorthin. Das ist die Aussage erster Ordnung; die genaue Groesse braucht das
      // Einspurmodell und steht in Block 7 als Plan, nicht als Zahl. Deshalb ist der Betrag
      // klein und der Regler kann ihn abschalten.
      st.tyrePull = cfg.tyreAsymPull * asym * Math.min(1, cfg.tyreEffect)
                    * (st.tyreWearL - st.tyreWearR);

      // Grip: cold tyres slide, overheated tyres slide, worn tyres slide. Quadratic below
      // the working range so the last few degrees matter less than the first few.
      const warm = Math.max(0, Math.min(1, (st.tyreTempC - cfg.tyreAmbientC) / span));
      let tGrip = 1 - cfg.tyreColdPenalty * pCold * (1 - warm) * (1 - warm);
      if (st.tyreTempC > cfg.tyreOptimalC) {
        const over = Math.min(1, (st.tyreTempC - cfg.tyreOptimalC)
                                 / (cfg.tyreOverheatC - cfg.tyreOptimalC));
        tGrip *= 1 - cfg.tyreHotPenalty * over * over;
      }
      tGrip *= 1 - cfg.tyreWearPenalty * st.tyreWear;
      // Eine kleine Einbusse fuer JEDE Abweichung von der Referenz, nach oben wie nach
      // unten. Ohne sie waere der Druckregler eine Einbahnstrasse: wenig Druck heizt
      // schneller auf und griffe kalt besser, es gaebe also genau eine beste Stellung und
      // keine Abstimmung. Ein Regler ohne Nachteil ist keine Entscheidung.
      tGrip *= 1 - cfg.tyrePressurePeakLoss * Math.min(1, Math.abs(pRel - 1) / 0.25);
      // Der Regler blendet das Modell aus: bei 0 ist das genau 1, also keine Simulation.
      //
      // GEDECKELT bei einfacher Modellstaerke, und das ist der Fehler aus v0.4.13: der
      // Regler geht seit Block B bis 200 %, und ohne Deckel verdoppelte diese Zeile das
      // Griffdefizit. Bei kalten Reifen (und kalt sind sie bei jedem Start) war tGrip 0,58,
      // also tyreGrip 0,16 - und weil steerGrip damit multipliziert wird, lenkte das Auto
      // nach einem Klick auf GT3 praktisch nicht mehr.
      //
      // Mehr als das Modell hergibt gibt es nicht. Ein Reifen, der doppelt so schlecht ist
      // wie ein voellig abgefahrener, ist keine Physik, sondern eine Extrapolation ueber den
      // Rand hinaus. Was der Regler oberhalb von 100 % steigert, sind die RATEN weiter
      // oben - Verschleiss und Erwaermung -, und die wirken ueber eine Rennlaenge.
      st.tyreGrip = 1 + Math.min(1, cfg.tyreEffect) * (tGrip - 1);

      // ---- Bremstemperatur und Fading (Block 4.1) --------------------------------------
      //
      // Zwei Scheiben, vorn und hinten getrennt nach der Bremsbalance. Das ist der Punkt,
      // an dem die Balance eine LANGFRISTIGE Folge bekommt: nach vorn heizt die
      // Vorderscheibe mehr, und wer die ganze Runde vorn bremst, hat am Rundenende weniger
      // Bremse. Damit wird die Balance eine Rennentscheidung statt einer Geschmacksfrage.
      //
      // Der Faktor 2 auf den Anteil ist die Normierung: bei 50:50 bekommt jede Scheibe
      // genau die volle Rate, sonst waere "Balance mittig" auch "halb so heiss".
      const bWork = Math.max(0, -st.longUse)
                    * Math.min(1, Math.abs(st.speedKmh) / cfg.topSpeedKmh);
      const bLuft = cfg.brakeCoolBase
                    + cfg.brakeCoolAir * Math.min(1, Math.abs(st.speedKmh) / cfg.topSpeedKmh);
      const bRate = cfg.brakeHeatRate * Math.max(1, cfg.brakeFadeEffect);
      // VIER Scheiben. Die Achsaufteilung kommt aus der Bremsbalance, die Seitenaufteilung
      // aus derselben Querverlagerung wie bei den Reifen: wer im Bremsen einlenkt, heizt die
      // AEUSSERE Scheibe mehr, weil dort mehr Last liegt und die Bremse mehr Kraft absetzen
      // kann. Genau das sieht man auf dem Schirm eines echten Rennwagens.
      //
      // Der Faktor 2 auf den Achsanteil ist die Normierung: bei 50:50 bekommt jede Achse die
      // volle Rate. Der Seitenanteil ist bereits auf 1 im Mittel normiert (load4).
      const heizAchse = [2 * cfg.brakeBias, 2 * cfg.brakeBias,
                         2 * (1 - cfg.brakeBias), 2 * (1 - cfg.brakeBias)];
      // Die Seitenverteilung nimmt den REINEN Seitenanteil und nicht die ganze Radlast:
      // load4 enthaelt die Achsaufteilung schon, und heizAchse enthaelt sie auch - beides
      // multipliziert hat die Vorderachse zweimal bevorzugt, bis vorne-innen kaelter
      // herauskam als hinten-aussen. Vorne bremst immer mehr.
      //
      // Und nur zur Haelfte gewichtet: eine Bremsscheibe sitzt an einer starren Achse und
      // teilt ihre Kraft nicht so ungleich wie ein Reifen seine Haftung. Ein voller
      // Lastfaktor haette die Innenscheibe im Kurvenbremsen kalt gelassen, und das ist nicht,
      // was Telemetrie zeigt.
      for (let i = 0; i < 4; i++) {
        const lastB = 1 + (st.latShare4[i] - 1) * 0.5;
        const heiz = bRate * bWork * heizAchse[i] * (asymAn4 ? lastB : 1);
        st.brakeTemp4[i] += (heiz - bLuft * (st.brakeTemp4[i] - cfg.brakeAmbientC)) * dt;
        st.brakeTemp4[i] = Math.max(cfg.brakeAmbientC, st.brakeTemp4[i]);
      }
      // Die Achsmittel werden GERECHNET: brakeTempF und brakeTempR haengen Leser dran (das
      // Fading unten, die Anzeige, die Selbsttests), und sie duerfen nicht auseinanderlaufen.
      st.brakeTempF = (st.brakeTemp4[0] + st.brakeTemp4[1]) / 2;
      st.brakeTempR = (st.brakeTemp4[2] + st.brakeTemp4[3]) / 2;

      // Der Verlust je Achse, gewichtet mit ihrem Anteil an der Bremskraft: eine glueende
      // Hinterscheibe bei 62 % Balance vorn kostet nur 38 % ihres Verlusts.
      const fadeVon = (T) => Math.max(0, Math.min(1,
        (T - cfg.brakeFadeStartC) / Math.max(1, cfg.brakeFadeFullC - cfg.brakeFadeStartC)))
        * cfg.brakeFadeMax;
      st.brakeFade = Math.min(1, cfg.brakeFadeEffect
        * (cfg.brakeBias * fadeVon(st.brakeTempF)
           + (1 - cfg.brakeBias) * fadeVon(st.brakeTempR)));

      const resist = this.resistAt(st.speedKmh, A, onPower, st.currentGear); // always >= 0
      let accel = 0;
      let output = 0;

      if (reversing) {
        // In R the THROTTLE drives backwards and the brake slows down.
        st.engineLoad = inputs.throttle;
        const revCeiling = revTopKmh * cfg.speedLimitFactor;
        if (inputs.brake > 0.02) {
          isBraking = true;
          const uR = Math.abs(st.speedKmh) / cfg.topSpeedKmh;
          accel = +((cfg.brakeDecelBase + cfg.brakeDecelAero * uR) * inputs.brake
                    * (1 - st.brakeFade) + resist);
        } else if (inputs.throttle > 0.02 && !st.isShifting) {
          accel = -this.thrustAt(st.speedKmh, -1, inputs.throttle, A) * st.gripLong * surf + resist;
        } else {
          accel = +resist; // coast back toward standstill
        }
        st.speedKmh = Math.max(-revCeiling, Math.min(0, st.speedKmh + accel * dt));
        const m = -st.speedKmh;
        output = -cfg.reverseOutputSpan * (revTopKmh > 0 ? m / revTopKmh : 0);
        if (inputs.throttle > 0.02) {
          output = Math.min(output, -cfg.minMoveThrottle * inputs.throttle * cfg.reverseOutputSpan);
        }
        output = Math.max(-cfg.reverseOutputSpan, Math.min(0, output));

      } else {
        // Braking is deliberately NOT a command of its own: it only bleeds the simulated
        // speed off faster than coasting does. Because the byte stays speed/topSpeed it
        // simply falls toward zero more quickly and is NEVER negative — which is exactly
        // why the left trigger no longer spins the wheels backwards.
        if (inputs.brake > 0.02) {
          isBraking = true;
          st.engineLoad = 0;
          const uB = Math.abs(st.speedKmh) / cfg.topSpeedKmh;
          // Braking capacity follows the loaded front axle — but normalised to the
          // full-braking equilibrium, so the deceleration fitted to the real GT3 braking
          // table stays exactly that. The term can only bite less, during the moment
          // before the nose is down, never more.
          const dive = Math.max(0.5, Math.min(1, st.loadFront / loadOnBrake(cfg)));
          // (1 - brakeFade) ist der Aktorteil von Block 4.1: heisse Scheiben bremsen
          // schlechter, und weil wir das Bremsbyte selbst stellen, wird der Bremsweg
          // wirklich laenger. Der resist-Anteil bleibt unangetastet - Rollwiderstand und
          // Luftwiderstand haben mit der Bremsscheibe nichts zu tun.
          accel = -(resist + (cfg.brakeDecelBase + cfg.brakeDecelAero * uB)
                             * inputs.brake * st.gripLong * surf * dive
                             * st.tyreGrip * (1 - st.brakeFade) / st.massFactor);
          // ABS is now only an indicator plus a haptic pulse. Modulating the byte here
          // would reintroduce precisely the stutter that took so long to remove.
          if (inputs.brake > 0.8 && st.speedKmh > cfg.topSpeedKmh * 0.15) {
            st.absActive = true;
            const now = Date.now();
            if (now - st.lastAbsRumble > 140) { st.lastAbsRumble = now; padRumble(0.18, 0.1, 60); }
          }
        } else if (inNeutral) {
          // Out of gear the engine is disconnected from the wheels: revving it does nothing
          // but noise. The car rolls out exactly as if the pedal were not touched.
          st.engineLoad = inputs.throttle;
          accel = -resist;
        } else if (inputs.throttle > 0.02) {
          st.engineLoad = st.isShifting ? 0 : inputs.throttle;
          accel = st.isShifting
            ? -resist * cfg.shiftDragFactor // a brief lull, not a full coast-down
            : this.thrustAt(st.speedKmh, gearIdx, inputs.throttle, A)
                * st.gripLong * surf * rearGrip * st.tyreGrip / st.massFactor - resist;
        } else {
          st.engineLoad = 0;
          accel = -resist; // lift off and it rolls out
        }

        // Pit limiter: brake DOWN to the ceiling, don't teleport to it. The previous
        // version clamped speedKmh with Math.min(ceiling, ...) every tick, which snapped
        // the car from top speed to the limit on the very first physics step after
        // speedLimitFactor dropped (1 -> ~0.28) — instant, not "runterbremsen". Above the
        // ceiling it now decelerates at a bounded rate instead; at or under it, the
        // existing rule (no new positive accel) still keeps it from climbing back over.
        // Two different jobs, and conflating them broke acceleration entirely once:
        //   ABOVE the cap (just entered the pit lane at speed) -> bleed off at a bounded
        //     rate, so the limiter brakes the car down instead of snapping it to the cap.
        //   AT the cap -> ordinary ceiling, no climbing past it.
        //   BELOW the cap -> nothing to do at all. This is the case that was missed: an
        //     `else if (accel > 0) accel = 0` fired whenever speed was under the ceiling,
        //     which without a limiter (speedLimitFactor 1, ceiling = topSpeedKmh) is ALWAYS,
        //     so every positive acceleration was zeroed and the car never moved from 0.
        const ceiling = cfg.topSpeedKmh * cfg.speedLimitFactor;
        if (st.speedKmh > ceiling) {
          const eased = st.speedKmh + Math.min(accel, -cfg.pitLimiterDecel) * dt;
          st.speedKmh = Math.max(ceiling, eased); // never undershoot the cap on the way down
        } else {
          if (accel > 0 && st.speedKmh >= ceiling) accel = 0;
          st.speedKmh = Math.max(0, Math.min(ceiling, st.speedKmh + accel * dt));
        }

        output = st.speedKmh / cfg.topSpeedKmh;
        // A real car needs a minimum shove to break away from standstill; without this
        // the first moments of a launch send a byte too small to move the car at all.
        if (inputs.throttle > 0.02 && !inNeutral) {
          output = Math.max(output, cfg.minMoveThrottle * inputs.throttle);
        }

        // No man's land. Rolling out, `output` walks the whole way down to zero, and the
        // stretch below minMoveThrottle is a byte too small to overcome stiction but too
        // large to be nothing: the car creeps, stalls, creeps again. Below the cutoff there
        // is therefore no middle ground — either the driver is asking for movement, and the
        // line above already lifted the byte clear of the break-away point, or nothing is
        // being asked and both byte and speed go cleanly to zero.
        if (inputs.throttle <= 0.02 && st.speedKmh < cfg.crawlCutoffKmh) {
          output = 0;
          // Coasting only. Under braking the deceleration fitted to the real GT3 table is
          // already stronger than this and must not be overridden.
          if (inputs.brake <= 0.02) {
            st.speedKmh = Math.max(0, st.speedKmh - cfg.crawlStopDecel * dt);
          }
          if (st.speedKmh < cfg.crawlCutoffKmh * 0.1) st.speedKmh = 0;
        }
      }

      st.virtualSpeed = Math.abs(st.speedKmh) / cfg.topSpeedKmh;
      // st.commanded und st.pitch standen hier und bekamen beide denselben Wert wie output.
      // Gelesen hat sie nie etwas. st.pitch war dabei nicht bloss ueberzaehlig, sondern eine
      // Falle: seit der Vierradverlagerung heisst "pitch" die Nickverlagerung, und wer
      // st.pitch fuer den Nickwinkel liest, bekommt das Motorbyte. Wer den Ausgabewert
      // braucht, nimmt den Rueckgabewert von update().

      // Automatic gearbox, now on RPM rather than band fraction.
      // FIRST: an automatic must not be able to sit in neutral. Neutral is the starting
      // state, so without this the car would never move in automatic mode at all — the same
      // trap that once made reverse inescapable.
      if (cfg.autoShift && inNeutral && inputs.throttle > 0.02) {
        st.driveMode = 'forward';
        st.currentGear = 0;
        st.neutralRpm = 0;
      }
      if (cfg.autoShift && !st.isShifting && !reversing && !inNeutral) {
        const r = this.rpmRawAt(st.speedKmh, st.currentGear);
        if (st.currentGear < cfg.gears.length - 1 && r >= cfg.upshiftRpm && inputs.throttle > 0.05) {
          this.triggerShift(1, 'auto');
        } else if (st.currentGear > 0 && r <= cfg.downshiftRpm) {
          this.triggerShift(-1, 'auto');
        }
      }

      // Expo curve for a softer centre. Kept mild: a strong expo is what made the car feel
      // reluctant to turn, and more angle was explicitly wanted.
      const expoSteer = Math.sign(inputs.steering)
                      * Math.pow(Math.abs(inputs.steering), cfg.steerExpo);

      // Authority falls off with speed, but only in the higher gears. In 1st gear the car
      // keeps everything it has, because that is where the tight stuff gets driven.
      const gearFrac = cfg.gears.length > 1
        ? Math.min(1, st.currentGear / (cfg.gears.length - 1)) : 0;
      // Hier stand bis v0.4 ein Trail-Braking-Bonus auf die Lenkgrenze. Er war im 1. Gang
      // (gearFrac = 0, also maxSteerLimit exakt 1,0) und bei niedrigem Tempo durch das
      // Math.min(1, ...) darunter vollstaendig weggeschnitten und deshalb nicht spuerbar.
      // Sein Nachfolger ist die Bremsbalance im Reibkreis weiter oben, die auf die
      // ANFORDERUNG wirkt statt auf die erlaubte Vorgabe - und damit in jedem Gang.
      const maxSteerLimit = Math.min(1,
        1.0 - this.state.virtualSpeed * cfg.speedSteerReduction * gearFrac);
      const targetSteer = Math.max(-1, Math.min(1,
        expoSteer * maxSteerLimit * cfg.steerResponse));

      // RATE LIMIT, not exponential smoothing. An exponential lag moves slowest at the very
      // start of a movement — precisely the moment that has to feel immediate. A rate limit
      // moves at full speed from the first tick and only caps how quickly full lock is
      // reached, which separates "how fast does it answer" from "how far does it go".
      const maxStep = cfg.steerRatePerS * cfg.steerResponse * dt;
      const dS = targetSteer - this.state.dampedSteering;
      this.state.dampedSteering += Math.max(-maxStep, Math.min(maxStep, dS));
      this.state.dampedSteering = Math.max(-1, Math.min(1, this.state.dampedSteering));

      // Aquaplaning: above a speed threshold the fronts stop biting and the car simply
      // runs on. Applied to the transmitted angle, not just the simulation — otherwise the
      // real car would keep turning in and the effect would be pure decoration.
      const uA = Math.abs(st.speedKmh) / cfg.topSpeedKmh;
      const over = Math.max(0, Math.min(1, (uA - 0.6) / 0.4));
      st.aquaFactor = 1 - cfg.aquaplaning * over * over;
      // Steering is scaled by what the front axle has left. This is where "cannot steer
      // under heavy braking or full throttle, but turns in nicely at the moment you first
      // hit the brakes" actually comes from.
      // Der Lenk-Offset aus der ungleichen Abnutzung kommt NACH der Griffskalierung und
      // nicht davor: er ist eine Kraft an der Achse und keine Absicht des Fahrers. Vor der
      // Skalierung waere er unter Bremsen verschwunden, und genau dort spuert man ihn.
      //
      // Nur bei Fahrt: im Stand zieht nichts, und ein Auto, das an der Box von selbst
      // einschlaegt, sieht nach einem Servofehler aus.
      const zug = st.tyrePull * Math.min(1, Math.abs(st.speedKmh) / (cfg.topSpeedKmh * 0.15));
      // Die Kalibrierung steht HINTER dem Reibkreis und dem Aquaplaning, und das ist ihr
      // ganzer Sinn: beim Anbremsen einer engen Kurve liegt steerGrip bei 0,5 bis 0,6, und
      // dann kommen am Auto nur 60 Prozent Einschlag an - genau im Moment, in dem man ihn
      // braucht. Bei 2,0 erreicht ein halbierter Wunsch wieder den vollen Anschlag.
      //
      // Der Deckel bleibt: |servoAngle| <= 1 wird zu Byte 7 = 127, dem Maximum des
      // vorzeichenbehafteten Bereichs. Die 45 Grad sind eine Grenze des Autos, nicht der App,
      // und kein Reglerwert kann darueber hinaus.
      st.steerDemand = this.state.dampedSteering * st.aquaFactor * st.steerGrip;
      this.outputs.servoAngle = Math.max(-1, Math.min(1,
        st.steerDemand * cfg.steerCalib + zug));

      // ---- EINSPURMODELL, ein Schritt --------------------------------------------------
      //
      // HIER und nicht weiter oben: der Eingang ist der UEBERTRAGENE Winkel (servoAngle), und
      // der steht erst wenige Zeilen darueber fest. Das Modell soll zeigen, was aus dem
      // Winkel folgt, der wirklich am Auto ankommt - nicht aus dem, den der Daumen wollte.
      this.yawStep(dt);

      // Der G-Plot zeigt jetzt die GERECHNETE Querbeschleunigung statt einer Naeherung.
      //
      // Hier stand dampedSteering * (Tempo / Hoechsttempo) - ein Produkt, das mit der
      // Querbeschleunigung nur die Richtung teilte. Auf 1 g normiert, weil der Plot einen
      // Kreis von -1 bis 1 zeichnet.
      // DER G-PLOT ZEIGT latUse UND NICHT DEN MODELLWERT, und das ist eine Korrektur mit
      // Messung dahinter.
      //
      // Der Versuch, die gerechnete Querbeschleunigung zu zeigen, ist gescheitert: gefahren
      // gemessen bei 165 km/h und Vollausschlag stand der Punkt dauerhaft bei 92 von 100 und
      // die Ausnutzung dauerhaft ueber 100 Prozent. Der Grund ist der Skalenwiderspruch, der
      // in yawStep steht - der Lenkbereich gehoert zu einem Modellauto, die Tempi zu einem
      // echten -, und eine Anzeige, die immer am Anschlag steht, sagt nichts.
      //
      // latUse ist die kalibrierte Querausnutzung des Reibkreises, auf 0..1 begrenzt, und sie
      // beziffert "am Limit" wirklich mit 1. Sie ist damit die einzige Groesse hier, die in
      // einen Kreis von -1 bis 1 gehoert.
      //
      // Was NICHT zurueckgenommen ist: das Vorzeichen kommt jetzt aus der Lenkrichtung und
      // die Groesse aus dem Reibkreis, statt aus dem alten Produkt
      // dampedSteering * (Tempo / Hoechsttempo), das mit einer Querbeschleunigung nur die
      // Richtung teilte.
      st.gLat = Math.sign(this.state.dampedSteering) * Math.max(0, Math.min(1, st.latUse));

      // ---- Laengs-G: DAS ERGEBNIS, nicht die Anforderung ------------------------------
      //
      // Hier stand st.gLong = st.longUse, und longUse ist der ANGEFORDERTE Laengsbedarf
      // (demand = -inputs.brake beim Bremsen). Gemeldet wurde: "warum geht das rote
      // simulierte Gyro nach hinten, wenn ich im Stand bremse?" - weil es die Bremse zeigte
      // und nicht die Verzoegerung. Im Stand gibt es keine.
      //
      // longUse bleibt, wo es hingehoert: es traegt die Lastverlagerung und den Reibkreis,
      // und dort ist eine Anforderung mit Nachlauf richtig - die Bremse drueckt die Nase
      // auch dann nach unten, wenn das Auto steht. Eine G-ANZEIGE zeigt dagegen, was
      // gemessen wuerde, und das ist die Aenderung der Geschwindigkeit.
      //
      // Bezugsgroesse ist die volle Bremsverzoegerung, damit eine Vollbremsung etwa -1
      // ergibt. Beschleunigen faellt dadurch schwaecher aus als Bremsen, und das ist richtig:
      // ein Auto bremst haerter als es beschleunigt.
      //
      // Der kurze Nachlauf (0,12 s) glaettet den numerischen Differenzenquotienten. Ohne ihn
      // zappelt der Punkt bei jedem Schaltvorgang und jeder Reifenschwankung.
      const vJetzt = st.speedKmh;
      const dvdt = (st.gLongV === undefined || dt <= 1e-6)
        ? 0 : (vJetzt - st.gLongV) / dt;
      st.gLongV = vJetzt;
      const bezug = Math.max(0.01, cfg.brakeDecelBase + cfg.brakeDecelAero);
      const roh = Math.max(-1.4, Math.min(1.4, dvdt / bezug));
      const aG = 1 - Math.exp(-dt / 0.12);
      st.gLong = st.gLong + (roh - st.gLong) * aG;
      this.outputs.motorPWM = Math.max(-1, Math.min(1, output));
      this.outputs.lights.head = !!inputs.headlights;
      this.outputs.lights.brake = !reversing && isBraking; // reversing must not light it

      return this.outputs;
    }

    // Integrates a full-throttle launch through the SAME helpers update() uses, so the
    // number the slider promises and the behaviour on track cannot drift apart. Optionally
    // returns the trace, which the Doku launch chart draws.
    simulateLaunch(calib, collectTrace) {
      const cfg = this.config;
      const A = (cfg.topSpeedKmh / cfg.accelScaleBasisS) * calib; // accelerationFactor excluded on purpose
      // Integrate at the SAME step the live loop uses. Forward Euler overshoots at coarse
      // steps, so calibrating at a fine 5ms while the car actually runs at 45ms made the
      // real launch a full second quicker than the slider promised.
      const dt = CONTROL_SEND_INTERVAL_MS / 1000, tMax = 30;
      const vTarget = cfg.launchAnchorKmh; // 100 km/h as displayed, see config
      let v = 0, g = 0, t = 0, shiftUntil = -1;
      const trace = collectTrace ? [{ t: 0, v: 0, gear: 0 }] : null;
      while (v < vTarget && t < tMax) {
        if (t < shiftUntil) {
          v -= this.resistAt(v, A, true) * cfg.shiftDragFactor * dt;
        } else {
          v += (this.thrustAt(v, g, 1, A) - this.resistAt(v, A, true)) * dt;
          if (g < cfg.gears.length - 1 && this.rpmRawAt(v, g) >= cfg.upshiftRpm) {
            g++; shiftUntil = t + cfg.shiftMs / 1000;
          }
        }
        if (v < 0) v = 0;
        t += dt;
        if (trace && trace.length < 4000) trace.push({ t, v, gear: g, shifting: t < shiftUntil });
      }
      return { time: t, trace, reached: v >= vTarget };
    }

    // Solves for the accel scale that makes 0 -> 100 DISPLAYED km/h take
    // launchAnchorTimeS.
    // Bisection, because the drag term broke the inverse proportionality the old
    // proportional update assumed. Since every under-power term now scales with the same
    // factor, any target time is reachable and no feasibility floor is needed.
    calibrateAccel() {
      const cfg = this.config;
      let a = 0.01, b = 60;
      for (let i = 0; i < 30; i++) {
        const mid = Math.sqrt(a * b); // geometric: the scale spans orders of magnitude
        if (this.simulateLaunch(mid, false).time > cfg.launchAnchorTimeS) a = mid; else b = mid;
        if (b / a < 1.001) break;
      }
      cfg.accelCalibration = Math.max(0.01, Math.min(60, b));
    }

    // direction -1/+1. Below 1st gear at a standstill this selects reverse, and out of
    // reverse it returns to 1st — that is how manual mode engages R (the user's spec).
    // The chain is R <- N <- 1 <- 2 ... <- 6. Neutral may be selected at ANY speed —
    // declutching and rolling is a normal thing to do — while reverse still requires a
    // standstill, because engaging it while moving would be a gearbox-destroying request.
    // quelle: 'knopf' (Vorgabe) oder 'auto'. Der Unterschied ist nicht kosmetisch.
    //
    // Die Automatik schaltet ihre Gaenge, indem sie diese Funktion selbst aufruft. Ein
    // Automatikblock, der KNOPFbedeutung durchsetzt, wuerde damit auch die Automatik selbst
    // lahmlegen - genau das ist passiert: nach der Rueckwaertsgang-Aenderung hat die
    // Automatik nie wieder hochgeschaltet, weil ihr eigener triggerShift(1) in dem Block auf
    // ein nacktes return lief.
    //
    // Also werden die zwei Bedeutungen getrennt. Vorgabe ist 'knopf', damit alle vorhandenen
    // Aufrufe von aussen - Tastatur, Pad, Ghosts, Programmierschule - unveraendert bleiben.
    triggerShift(direction, quelle) {
      const st = this.state, cfg = this.config;
      const stopped = Math.abs(st.speedKmh) < cfg.reverseStandstillKmh;
      const vomGetriebe = quelle === 'auto';

      // ---- Automatik: die beiden Schaltknoepfe machen genau eine Sache ----
      //
      // Vorher war der Rueckwaertsgang in der Automatik NICHT erreichbar, und das lag an
      // zwei Dingen, die zusammenwirkten: ein Herunterschalten aus dem 1. Gang landet im
      // Leerlauf und erst ein zweites legt den Rueckwaertsgang - und die Automatikregel
      // "im Leerlauf und Gas gegeben heisst vorwaerts" hat den Leerlauf im naechsten Takt
      // sofort wieder verlassen. Zwei Tastendruecke waren also nie moeglich, weil der
      // Zwischenzustand keinen Takt ueberlebt.
      //
      // In der Automatik gibt es ohnehin keine Gaenge zu waehlen. Also tun die beiden
      // Knoepfe hier das Einzige, was sinnvoll bleibt: Viereck legt den Rueckwaertsgang
      // (langsam genug), Kreis holt ihn heraus. In EINEM Druck, ohne Leerlauf dazwischen.
      if (cfg.autoShift && !vomGetriebe) {
        const langsam = Math.abs(st.speedKmh) < cfg.autoReverseFrac * cfg.topSpeedKmh;
        if (st.driveMode === 'reverse') {
          if (direction > 0) {
            st.driveMode = 'forward'; st.currentGear = 0;
            st.speedKmh = 0; st.neutralRpm = 0;
            showHudToast('Vorw\u00e4rts'); padRumble(0.3, 0.2, 90);
            playShiftSound(1);
          }
          return;
        }
        if (direction < 0) {
          if (langsam) {
            st.driveMode = 'reverse'; st.currentGear = 0;
            st.speedKmh = 0; st.neutralRpm = 0;
            showHudToast('R\u00fcckw\u00e4rtsgang'); padRumble(0.3, 0.2, 90);
            playShiftSound(-1);
          } else {
            // Sagen, WARUM nichts passiert. Ein Knopf, der schweigend nichts tut, sieht
            // kaputt aus - und genau so ist dieser Fehler gemeldet worden.
            showHudToast('ZU SCHNELL F\u00dcR R');
          }
        }
        return;
      }

      if (st.driveMode === 'reverse') {
        if (direction > 0 && stopped) {
          st.driveMode = 'neutral'; st.speedKmh = 0; st.neutralRpm = 0;
          showHudToast('Leerlauf'); padRumble(0.3, 0.2, 90);
          playShiftSound(1);
        }
        return;
      }

      if (st.driveMode === 'neutral') {
        if (direction > 0) {
          st.driveMode = 'forward'; st.currentGear = 0; st.neutralRpm = 0;
          st.isShifting = true;
          showHudToast('1. Gang'); padRumble(0.15, 0.1, 40);
          playShiftSound(1);
          setTimeout(() => { st.isShifting = false; }, cfg.shiftMs);
        } else if (stopped) {
          st.driveMode = 'reverse'; st.speedKmh = 0; st.neutralRpm = 0;
          showHudToast('Rückwärtsgang'); padRumble(0.3, 0.2, 90);
          playShiftSound(-1);
        }
        return;
      }

      if (direction < 0 && st.currentGear === 0) {
        st.driveMode = 'neutral'; st.neutralRpm = 0;
        showHudToast('Leerlauf'); padRumble(0.2, 0.12, 60);
        playShiftSound(-1);
        return;
      }

      const next = st.currentGear + direction;
      if (next < 0 || next >= cfg.gears.length) return;
      st.isShifting = true;
      st.currentGear = next;
      // Short and light: six shifts inside three seconds with a long pattern is a
      // pneumatic drill in the hand.
      padRumble(0.15, 0.1, 40);
      playShiftSound(direction);
      setTimeout(() => { st.isShifting = false; }, cfg.shiftMs);
    }
  }

  // Real CONTROLLER rumble via the Gamepad API, ONLY. This used to also fire
  // navigator.vibrate() — the PHONE's own vibration motor — on every call, so a session
  // played on a phone buzzed the phone itself on every shift, crash and ABS pulse even
  // though nothing was asked to vibrate but the gamepad. Removed outright, along with
  // rumbleHaptic(), the older phone-only helper it had already fully replaced and which
  // had no remaining callers.
  // Standardmaessig AUS. Ein Controller, der bei jedem Gangwechsel brummt, ohne dass
  // jemand danach gefragt hat, ist die Art Voreinstellung, die man einmal sucht und dann
  // nicht findet - und der Schalter sass bisher nirgends.
  //
  // Die Abfrage steht hier und nicht an den 18 Aufrufstellen: eine Stelle kann nicht
  // vergessen werden, achtzehn schon.
  // Der Startwert steht hier UND im Markup. Damit sie nicht auseinanderlaufen koennen,
  // liest 50-drive.js ihn beim Aufbau aus dem Kaestchen - dieser Wert gilt also nur, bis das
  // Dokument da ist. Er ist trotzdem auf den Markup-Wert gesetzt, damit die zwei Orte auch
  // beim Lesen dasselbe sagen.
  let rumbleOn = true;

  function padRumble(strong, weak, ms) {
    if (!rumbleOn) return;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      // DENSELBEN PAD NEHMEN WIE DIE EINGABE. Windows zeigt denselben Controller oft zweimal
      // (ein DualSense ueber Bluetooth erscheint als zugeordnetes UND als rohes HID-Geraet),
      // und pollGamepad() bevorzugt darum ausdruecklich mapping === 'standard'. Hier wurde
      // stattdessen der erste Pad mit einem Ruettler genommen - das kann der rohe Zwilling
      // sein, an dem nichts haengt. Zwei verschiedene Auswahlregeln fuer dasselbe Geraet
      // sind eine Falle, und sie kostet genau das Ruetteln.
      const liste = Array.from(pads).filter(p => p);
      const bevorzugt = liste.find(p => p.mapping === 'standard') || liste[0];
      for (const p of (bevorzugt ? [bevorzugt, ...liste.filter(x => x !== bevorzugt)] : [])) {
        if (p && p.vibrationActuator && typeof p.vibrationActuator.playEffect === 'function') {
          p.vibrationActuator.playEffect('dual-rumble', {
            duration: ms, startDelay: 0,
            strongMagnitude: Math.max(0, Math.min(1, strong)),
            weakMagnitude: Math.max(0, Math.min(1, weak)),
          }).catch(() => {}); // some browsers reject while the pad is busy; harmless
          break;
        }
      }
    } catch { /* pad vanished mid-call — nothing to do */ }
  }
