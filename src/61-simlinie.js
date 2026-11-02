  // ============================== SIMULATOR-LINIE (v1.0.14, WIP) ==============================
  //
  // BESTELLT: "SIMULATOR-Linie: begrenzte Suche ueber glatte Linien und Tempoplaene; jeder
  // Kandidat faehrt drei saubere Runden mit derselben Physik wie das eigene Auto; die Grenzen
  // der Ghosts beachten (Mindesttempo GHOST_READ_MIN, Lenkrate)." Als Linienmodell
  // "SIMULATOR" waehlbar, mit dem Hinweis: getestetes Beispiel, keine bewiesene Bestlinie.
  //
  // WAS "DIESELBE PHYSIK" HIER HEISST: eine eigene, stumme Instanz von CarreraPhysicsEngine
  // mit der eingestellten Konfiguration (Antrieb, Getriebe, Reifen, Temperatur, Masse). Sie
  // faehrt den Tempoplan, den lapTimeOf() fuer die Linie rechnet, mit Gas und Bremse wie ein
  // Fahrer; die Lenkung ist der Einschlag, den die Kruemmung bei diesem Radstand verlangt, und
  // sie kostet ueber den Reibkreis Zug - eine weite Linie beschleunigt also frueher. Gemessen
  // wird die Zeit der Runden 2 und 3 (Runde 1 hat den stehenden Start).
  //
  // WAS SIE NICHT KANN: Die Physik kennt keine Querbeschleunigung (kein Byte meldet sie), die
  // Kurvengrenze im Tempoplan bleibt also die Annahme aus fahrGrenzen(). Deshalb "getestetes
  // Beispiel": die beste von hoechstens SIM_MAX_AUSWERTUNGEN gefahrenen Linien, nicht das Optimum.
  const SIM_STORE = 'omegasim-simlinie';
  const SIM_FASSUNG = 'k2';
  // 200 Linien: gemessen rund 13 ms je Linie (drei Runden), also etwa 2,5 s im Hintergrund.
  const SIM_DT = 0.02, SIM_RUNDEN = 3, SIM_MAX_AUSWERTUNGEN = 200;
  const SIM_SAAT = ['luuke', 'laptime', 'lateapex', 'curvature', 'dreistufig', 'aussenin', 'innen3', 'mitte'];
  // Querrate: ein Ghost wechselt hoechstens etwa die ganze Bahnbreite in 0,35 s.
  const SIM_QUER_MAX_S = 0.35;
  const SIM_MODELL_CM = 50;   // Massstab 1:50 fuer den Radstand
  let simLauf = null, simLetztes = null;
  const simErgebnisse = {};

  function simSchluessel(tiles, closed) {
    const gz = fahrGrenzen();
    return trackToCode(tiles, 0) + '|' + (closed ? 1 : 0) + '|'
      + [gz.vMax, gz.aAcc, gz.aBrk, gz.aLat, simKurvenALat(gz)].map((x) => Math.round(x * 1000)).join('/')
      + '|' + SIM_FASSUNG;
  }
  // ---- DIE KURVENGRENZE DER SUCHE UND DIE AUSSENANKER (v1.2.32, WIP) ----------------------
  //
  // BESTELLT: "Pruefe, ob du die Ideallinie mit der Pacejka-Simulation noch etwas verbessern kannst.
  // Die Autos fahren tendenziell nur auf der inneren Haelfte der Fahrbahn und nutzen die Breite nicht
  // vollstaendig. Etwas Toleranz nach aussen in der Haarnadelkurve ist gut - hier nichts aendern."
  //
  // URSACHE 1, DIE ZIELFUNKTION WAR ENTARTET. Der Tempoplan kommt aus lapTimeOf() mit der Kurvengrenze
  // sqrt(aLat / Kruemmung) und aLat aus fahrGrenzen() - dem GT-Verhaeltnis zur Bremse (23,7 Einheiten/s2).
  // Damit lag der Plan auf der 60-Grad-Kurve bei 1,10 km/h, also unter dem Leseboden (GHOST_READ_MIN x
  // Spitze = 1,40 km/h), und simFahren() hebt jeden solchen Punkt auf den Boden. Gemessen lagen 70 bis
  // 100 Prozent aller Punkte darunter (SR3GLR2GR2G2: Luuke 100 %, innen3 90 %). Ein Auto, das ueberall
  // gleich schnell faehrt, ist auf dem KUERZESTEN Weg am schnellsten - der Radius zaehlte nicht mehr, und
  // die Suche gewann jedes Mal mit innen3 (Herkunft "innen3+++..."): 100 % der Kurvenpunkte innen,
  // 0 % aussen, auf SR3G2R3G die ganze Runde auf der Innenseite.
  //
  // DIE GRENZE KOMMT JETZT AUS DEM EIGENEN KURVENTEMPO DER NPCs: Grundtempo x (1 - Kurvendrosselung)
  // (Vorgabe 0,55 x 0,8 = 0,44) auf der Mittellinie einer 60-Grad-Kurve, aLat = v^2 / TRACK_RADIUS
  // (60,1 Einheiten/s2). Das ist keine neue Annahme, sondern die Tempoangabe, mit der die NPCs dort
  // ohnehin fahren - auf der Mittellinie ergibt der Plan genau sie, ein engerer Bogen weniger, ein
  // weiterer mehr. Nie unter dem alten Wert.
  function simKurvenALat(o) {
    let cfg = null;
    try { cfg = ghostCfg; } catch (e) { cfg = null; }     // 90-ghosts.js; beim Laden noch Todeszone
    const anteil = cfg ? (cfg.speed || 0.55) * (1 - Math.min(0.85, cfg.curveSlow || 0)) : 0.44;
    const v = anteil * physEngine.config.topSpeedKmh * KMH_TO_UNITS;
    return Math.max((o && o.aLat) || 0, v * v / TRACK_RADIUS);
  }
  // URSACHE 2, DIE GEOMETRIE DIESER BAHN. Auch mit der richtigen Kurvengrenze legt die schnellste Linie
  // auf 25 cm Breite und 43-cm-Teilen die Kurven innen an und kommt kaum heraus - das steht bei
  // lineExitStaerke in 60-track.js schon gemessen ("sie kauft das AUSSEHEN einer Ideallinie und keine
  // Zeit"). Bestellt ist aber ausdruecklich aussen-innen-aussen. Deshalb eine SCHRANKE IM SUCHRAUM statt
  // eines Nachlaufs (dieselbe Begruendung wie dort): jede Linie, die die Suche faehrt, steht am Eingang
  // und am Ausgang jeder Kurve mindestens SIM_AUSSEN_ANTEIL der Grenze auf der Aussenseite, und die
  // Physik entscheidet nur noch, WIE sie dazwischen zum Scheitel kommt.
  //
  // 0,5 der Grenze: bei der Vorgabe Ideallinie 200 % ist das genau der volle Befehl (ghostLineOffset
  // teilt durch die Grenze, der Regler verdoppelt), also "ganz aussen" im Lenkbyte - nicht mehr, denn
  // mehr als den Anschlag gibt es nicht. Der Rand bleibt unberuehrt: die Grenze selbst (TRACK_HALF_W - 3,
  // 3,2 cm Abstand zur Kante) aendert sich nicht, und jede Verschiebung wird auf sie geklemmt.
  //
  // NICHT IN DER HAARNADEL, wie bestellt: Laeufe mit Haarnadel (und die Engstelle, die ihre eigene Linie
  // hat) bekommen keinen Anker, und auch keinen an ihren Nachbargrenzen. Dort bleibt alles beim Alten.
  // Und nur dort, wo vor bzw. nach der Kurve eine Gerade liegt: an einer direkten Gegenkurve ist das
  // Aussen der einen das Innen der anderen, das entscheidet die Sehne.
  const SIM_AUSSEN_ANTEIL = 0.5;
  // Halbe Breite der Kosinus-Beule, mit der ein Anker hergestellt wird, in Abtastpunkten (eine Kachel hat
  // rund 14). GEMESSEN, je zwei Suchen mit 200 Auswertungen; Zeit = gefahrene Rundenzeit der Suche,
  // "ohne" = dieselbe Suche ohne Anker:
  //
  //     Breite      SR3G2R3G            SR3GLR2GR2G2        SHG3R4L
  //                 Zeit     Kurve a.   Zeit     Kurve a.   Zeit     Kurve a.
  //     ohne         7,69 s   2 %       10,32 s  10 %        9,83 s   0 %
  //      6          10,04    48-56 %    13,17    36-42 %    10,65-10,89  17-29 %
  //     10           8,51-8,74  45 %    11,83-12,30  48-59 %  10,65   20-34 %
  //     14           8,40-8,47  55 %    11,28-11,41  67-69 %  10,43-10,47  33-37 %
  //     20           7,92-7,97  66-71 % 11,07       79-81 %  10,41-10,54  41-44 %
  //
  // Eine schmale Beule ist ein Haken in der Linie, den die Physik teuer bezahlt (+30 %); erst ab gut einer
  // Kachel wird daraus ein Anfahren von aussen, wie ein Fahrer es macht, und dann kostet es 3 bis 7 %.
  // 20, und je Anker kleiner, wenn eine Haarnadel, Engstelle oder ein Anker zur Gegenseite naeher liegt
  // (die Beule endet vorher, sie greift nie in die Haarnadel hinein).
  //
  // ENDSTAND mit Scheitel-Schranke (unten), je drei Suchen mit 200 Auswertungen, v1.2.31 in Klammern;
  // "aussen" = Anteil der Punkte in der aeusseren Bahnhaelfte, "Kurve" = Anteil der Kurvenpunkte aussen,
  // Weg = Laenge der Linie / Mittellinie:
  //
  //     SR3G2R3G       aussen 65-68 % (0 %)    Kurve 42-46 % (0 %)    Scheitel 2/2   Weg 1,00-1,01 (0,88)
  //     SR3GLR2GR2G2   aussen 56-59 % (14 %)   Kurve 31-36 % (1 %)    Scheitel 4/4   Weg 1,00-1,01 (0,89)
  //     SHG3R4L        aussen 34-40 % (6-14 %) Kurve 30-33 % (1-6 %)  Scheitel 2/2   Weg 0,96-0,97 (0,90)
  //     SR2GR2GR2      aussen 59-63 % (0 %)    Kurve 38-44 % (0 %)    Scheitel 3/3   Weg 1,01-1,03 (0,84)
  //
  // Die Physik der Suche rechnet dafuer 2 bis 22 % mehr Rundenzeit als dieselbe Suche ohne Anker - sie
  // waehlt Radius gegen Weg. Ein NPC faehrt sein Tempo aber je Teil und nicht je Radius; ihn kostet die
  // Linie nur den Mehrweg, und der liegt gegenueber der Mittellinie bei 0 bis 3 %.
  const SIM_AUSSEN_BREITE = 20;
  function simAussenAnker(pts, tiles, closed) {
    const anker = [];
    if (!tiles || tiles.length < 3) return anker;
    const n = tiles.length, at = (i) => ((i % n) + n) % n;
    const tab = trackKachelTabelle(pts, n);
    const frei = (i) => {           // gerade, keine Engstelle, keine Haarnadel
      const t = tiles[at(i)].type;
      return luukeDrehung(t) === 0 && tileTightness(t) < 2;
    };
    const scheitel = [];
    for (const lauf of luukeLaeufe(tiles, closed)) {
      let haarnadel = false;
      for (let k = lauf.von; k <= lauf.bis; k++) if (tileTightness(tiles[at(k)].type) >= 2) haarnadel = true;
      if (haarnadel) continue;
      // Aussen ist +dreht in alpha (siehe dreiStufenLine: aussen = st.dreht * limit).
      const vorher = anker.length;
      if ((closed || lauf.von > 0) && frei(lauf.von - 1)) anker.push({ i: tab.start[at(lauf.von)], seite: lauf.dreht });
      if ((closed || lauf.bis + 1 < n) && frei(lauf.bis + 1)) anker.push({ i: tab.start[at(lauf.bis + 1)], seite: lauf.dreht });
      // UND DER SCHEITEL INNEN: wer aussen anfaehrt, muss dazwischen einmal in die innere Haelfte
      // (bestellt: "Scheitel innen"). WO, entscheidet die Linie selbst - die Schranke nimmt den Punkt
      // des Laufs, der schon am weitesten innen liegt, und zieht nur ihn nach, wenn er nicht reicht.
      if (anker.length > vorher) {
        const idx = [];
        for (let k = lauf.von; k <= lauf.bis; k++) {
          const t = at(k);
          for (let d = 0; d < tab.zahl[t]; d++) idx.push(tab.start[t] + d);
        }
        if (idx.length >= 6) scheitel.push({ idx, seite: -lauf.dreht, b: Math.min(SIM_AUSSEN_BREITE, Math.floor(idx.length / 2)) });
      }
    }
    // Die Breite je Anker: nie bis an einen gesperrten Punkt (Haarnadel, Engstelle) und nie in die Beule
    // eines Ankers zur Gegenseite.
    const m = pts.length;
    const abstand = (i, j) => { const d = Math.abs(i - j) % m; return closed ? Math.min(d, m - d) : Math.abs(i - j); };
    const gesperrt = [];
    pts.forEach((p, i) => { if (p.tile >= 0 && tileTightness(tiles[p.tile].type) >= 2) gesperrt.push(i); });
    for (const a of anker) {
      let b = SIM_AUSSEN_BREITE;
      for (const j of gesperrt) b = Math.min(b, abstand(a.i, j) - 1);
      for (const o of anker) if (o.seite !== a.seite) b = Math.min(b, Math.floor(abstand(a.i, o.i) / 2) - 1);
      a.b = b;
    }
    // Unter sechs Punkten (knapp eine halbe Kachel) waere die Beule ein Haken: dann lieber kein Anker.
    const aus = anker.filter((a) => a.b >= 6);
    aus.scheitel = aus.length ? scheitel : [];
    return aus;
  }
  function simBeuleAuf(neu, i, b, hoehe, limit) {
    const n = neu.length;
    for (let d = -b; d <= b; d++) {
      const w = 0.5 * (1 + Math.cos(Math.PI * d / (b + 1)));
      const j = ((i + d) % n + n) % n;
      neu[j] = Math.max(-limit, Math.min(limit, neu[j] + hoehe * w));
    }
  }
  function simAussenSchranke(alpha, anker, limit) {
    if (!anker.length) return alpha;
    const neu = alpha.slice();
    const soll = SIM_AUSSEN_ANTEIL * limit;
    // Drei Runden, der Aussenanker jeweils zuletzt: Scheitel- und Aussenbeule koennen sich in kurzen
    // Kurven beruehren, und der Ein- und Ausgang ist die Zusage.
    for (let runde = 0; runde < 3; runde++) {
      for (const sc of (anker.scheitel || [])) {
        let j = sc.idx[0];
        for (const k of sc.idx) if (neu[k] * sc.seite > neu[j] * sc.seite) j = k;
        const fehlt = soll - neu[j] * sc.seite;
        if (fehlt > 1e-9) simBeuleAuf(neu, j, sc.b, fehlt * sc.seite, limit);
      }
      for (const a of anker) {
        const fehlt = soll - neu[a.i] * a.seite;
        if (fehlt > 1e-9) simBeuleAuf(neu, a.i, a.b === undefined ? SIM_AUSSEN_BREITE : a.b, fehlt * a.seite, limit);
      }
    }
    return neu;
  }
  function simSpeicher() {
    try { return JSON.parse(localStorage.getItem(SIM_STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function simAusSpeicher(key, n) {
    const e = simSpeicher()[key];
    if (!e || !Array.isArray(e.alpha) || e.alpha.length !== n) return null;
    simErgebnisse[key] = e;
    return e;
  }
  function simSpeichern(key, e) {
    const d = simSpeicher();
    d[key] = e;
    const alt = Object.keys(d).sort((a, b) => (d[b].wann || 0) - (d[a].wann || 0));
    alt.slice(10).forEach((k) => { delete d[k]; });
    try { localStorage.setItem(SIM_STORE, JSON.stringify(d)); } catch (err) { /* voll oder privat */ }
  }

  // TEMPORALE TODESZONE (v1.0.17, GEMELDET: "1.0.16 konnte nicht starten ... Cannot access
  // 'simErgebnisse' before initialization"). Seit SIMULATOR die Vorgabe ist, zeichnet der
  // Editor mit einer gemerkten Strecke schon beim Laden von 60-track.js - bevor diese Datei
  // ihre Konstanten angelegt hat. Dann gilt die Luuke-Linie; am Ende dieser Datei wird neu
  // gezeichnet, sobald alles steht.
  function simBereit() {
    try { return typeof simErgebnisse === 'object' && typeof SIM_STORE === 'string'; } catch (e) { return false; }
  }
  // Aus buildLine(): fertige Linie, sonst die Luuke-Linie als Zwischenstand und Suche starten.
  // v1.2.45 BESTELLT: "Das Linienmodell Simulator sollte nur einmal im Editor berechnet werden und
  // nicht nebenbei neu." Die Suche laeuft auf dem Hauptfaden zwischen den 45-ms-Paketen und kostete im
  // freien Fahren Takt (Latenz auf schwachen Handys). Gesucht wird nur noch bei offenem Strecken-Editor;
  // sonst gilt die gespeicherte Linie, und fehlt sie, die Luuke-Linie ohne Hintergrundrechnung.
  var simOhneEditor = false;   // nur fuer den Selbsttest, der simSuche() direkt aufruft
  function simImEditor() {
    if (simOhneEditor) return true;
    const tab = document.querySelector('.tabpage.active');
    return !!tab && tab.id === 'tab-track';
  }
  function simulatorLinie(pts, nrm, o) {
    const basis = luukeLinie(pts, nrm, o);
    if (!simBereit()) return Object.assign(basis, { vorlaeufig: true });
    if (!o.closed || !o.tiles || o.tiles.length < 3) return Object.assign(basis, { vorlaeufig: true });
    const key = simSchluessel(o.tiles, o.closed);
    const fertig = simErgebnisse[key] || simAusSpeicher(key, pts.length);
    if (fertig) {
      simLetztes = fertig;
      const alpha = fertig.alpha.slice();
      const prof = lapTimeOf(pts.map((p, i) => [p.x + nrm[i].x * alpha[i], p.y + nrm[i].y * alpha[i]]), o.closed, o);
      return Object.assign(basis, { alpha, lapTime: prof.time, v: prof.v, apex: [], par: [],
        span: alpha.reduce((m, a) => Math.max(m, Math.abs(a)), 0),
        simZeit: fertig.zeit, simRunden: fertig.runden, vorlaeufig: false });
    }
    if (simImEditor()) simStarten(key, pts, nrm, o);
    return Object.assign(basis, { vorlaeufig: true });
  }

  // ---- Drei Runden mit der Physik ----------------------------------------------------------
  function simFahren(alpha, pts, nrm, o) {
    const n = pts.length, closed = !!o.closed;
    const at = (i) => ((i % n) + n) % n;
    const path = pts.map((p, i) => [p.x + nrm[i].x * alpha[i], p.y + nrm[i].y * alpha[i]]);
    const prof = lapTimeOf(path, closed, o);
    const k = pathCurvature(path, closed);
    const ds = prof.ds;
    const cfgQ = physEngine.config;
    const top = cfgQ.topSpeedKmh;
    const vMin = GHOST_READ_MIN * top;
    let unterSchwelle = 0;
    const plan = prof.v.map((v) => {
      const kmh = Math.min(top, v / KMH_TO_UNITS);
      if (kmh < vMin * 0.97) unterSchwelle++;
      return Math.max(vMin, kmh);
    });
    // Querrate: Querlagenwechsel je Sekunde bei Plantempo.
    // Die Grenze kommt aus der Suche (o.querMax: die steilste Ausgangslinie, die Ghosts schon
    // fahren); ohne sie der feste Wert.
    const querMax = typeof o.querMax === 'number' ? o.querMax : 2 * TRACK_HALF_W / SIM_QUER_MAX_S;
    let querRate = 0;
    // Je Weg LAENGS der Bahn (Mittellinie), nicht je Weg auf der Linie: ein Zickzack macht
    // seine eigenen Segmente lang und rechnete sich so die Querrate klein.
    for (let i = 0; i < n; i++) {
      const j = at(i + 1);
      const laengs = Math.max(1e-6, Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y));
      const rate = Math.abs(alpha[j] - alpha[i]) / laengs * plan[i] * KMH_TO_UNITS;
      if (rate > querRate) querRate = rate;
      if (rate > querMax) return { ok: false, grund: 'Querrate', zeit: Infinity, runden: [], querRate };
    }
    // Einschlag aus der Kruemmung: delta = atan(Radstand * k), voller Einschlag 45 Grad.
    const radstandU = (cfgQ.wheelbaseM || 2.6) * 100 / SIM_MODELL_CM * TRACK_UNITS_PER_CM;
    const lenk = k.map((x) => Math.max(-1, Math.min(1, Math.atan(radstandU * x) / (Math.PI / 4))));
    const e = new CarreraPhysicsEngine();
    Object.assign(e.config, cfgQ, { autoShift: true });
    e.spieler = 9;
    e.meldung = () => {}; e.ruck = () => {}; e.schaltTon = () => {};
    let i = 0, f = 0, t = 0, tStart = 0;
    const runden = [];
    while (runden.length < SIM_RUNDEN && t < 900) {
      const v = Math.max(0, e.state.speedKmh);
      const ziel = plan[at(i + 1)];
      const fehl = ziel - v;
      const throttle = fehl > 0 ? Math.min(1, fehl / (top * 0.06)) : 0;
      const brake = fehl < -top * 0.01 ? Math.min(1, -fehl / (top * 0.05)) : 0;
      e.update({ throttle, brake, steering: lenk[i], headlights: false }, SIM_DT);
      t += SIM_DT;
      let weg = Math.max(0, e.state.speedKmh) * KMH_TO_UNITS * SIM_DT;
      while (weg > 0) {
        const rest = ds[i] * (1 - f);
        if (weg < rest) { f += weg / Math.max(1e-9, ds[i]); weg = 0; }
        else {
          weg -= rest; f = 0; i++;
          if (i >= n) { i = 0; runden.push(t - tStart); tStart = t; }
        }
      }
    }
    if (runden.length < SIM_RUNDEN) return { ok: false, grund: 'kommt nicht ins Ziel', zeit: Infinity, runden };
    const fliegend = runden.slice(1);
    // Wo der Plan unter die Leseschwelle muesste, faehrt ein Ghost trotzdem 35 % - und fliegt
    // dort eher ab. Das kostet die Linie eine halbe Sekunde je Runde.
    const strafe = unterSchwelle ? 0.5 : 0;
    return { ok: true, zeit: fliegend.reduce((a, b) => a + b, 0) / fliegend.length + strafe,
             runden: runden.map((x) => Math.round(x * 1000) / 1000), unterSchwelle, querRate };
  }

  // ---- Die Suche ----------------------------------------------------------------------------
  // Eine Auswertung je Takt, ueber einen MessagePort (wird nicht gedrosselt). Waehrend eines
  // Rennens wartet sie: eine Auswertung dauert einige Millisekunden, und der 45-ms-Sendetakt
  // geht vor.
  function simPause() {
    return new Promise((weiter) => {
      const kanal = new MessageChannel();
      const pruefen = () => {
        const rennen = typeof kRennenLaeuft === 'function' && kRennenLaeuft();
        // v1.2.45: auch ausserhalb des Editors anhalten - weiter geht es erst, wenn er wieder offen ist.
        if (rennen || !simImEditor()) { setTimeout(pruefen, 1000); return; }
        kanal.port1.onmessage = () => weiter();
        kanal.port2.postMessage(0);
      };
      pruefen();
    });
  }
  function simBeule(alpha, limit) {
    const n = alpha.length;
    const mitte = Math.floor(Math.random() * n);
    const breite = [6, 10, 18][Math.floor(Math.random() * 3)];
    const hoehe = (Math.random() * 2 - 1) * limit * (0.15 + Math.random() * 0.25);
    const neu = alpha.slice();
    for (let d = -breite; d <= breite; d++) {
      const w = 0.5 * (1 + Math.cos(Math.PI * d / breite));
      const j = ((mitte + d) % n + n) % n;
      neu[j] = Math.max(-limit, Math.min(limit, neu[j] + hoehe * w));
    }
    return neu;
  }
  // ---- DIE SEHNE (v1.0.19) -----------------------------------------------------------------
  // BESTELLT: "Fine-Tuning machen (z. B. ist bei Links-Rechts-Kurvenfolge ein Lenken, obwohl es
  // schneller waere, einfach geradeaus quer zu fahren)." Die Beule verschiebt nur ein Stueck
  // seitlich; eine gerade Diagonale durch ein S braucht dagegen eine abgestimmte Aenderung ueber
  // BEIDE Kurven, und die findet eine Folge kleiner Beulen praktisch nie. Die Sehne ersetzt ein
  // Stueck von bis zu zwei Teilen durch die gerade Verbindung seiner Endpunkte, solange die in
  // der Bahn bleibt. Ob das schneller ist, entscheidet wie immer die Physik.
  function simSehne(alpha, pts, nrm, limit, closed) {
    const n = alpha.length;
    const at = (i) => ((i % n) + n) % n;
    const lang = 8 + Math.floor(Math.random() * 34);            // 8..41 Punkte (knapp drei Teile)
    const i0 = Math.floor(Math.random() * n);
    if (!closed && i0 + lang >= n) return null;
    const P = (i) => [pts[at(i)].x + nrm[at(i)].x * alpha[at(i)], pts[at(i)].y + nrm[at(i)].y * alpha[at(i)]];
    const a = P(i0), b = P(i0 + lang);
    // Fuer jeden Punkt dazwischen: wo schneidet seine Normale die Sehne? Daraus die Querlage.
    const neu = alpha.slice();
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (let k = 1; k < lang; k++) {
      const j = at(i0 + k), p = pts[j], m = nrm[j];
      const nenner = m.x * dy - m.y * dx;
      if (Math.abs(nenner) < 1e-9) return null;
      const s = ((a[0] - p.x) * dy - (a[1] - p.y) * dx) / nenner;
      if (!(Math.abs(s) <= limit)) return null;                  // verlaesst die Bahn
      neu[j] = s;
    }
    return neu;
  }
  function simStarten(key, pts, nrm, o) {
    if (simLauf && simLauf.key === key) return;
    const lauf = { key, abbruch: false, auswertungen: 0, beste: null };
    if (simLauf) simLauf.abbruch = true;
    simLauf = lauf;
    simLadeAnzeige(true);
    simSuche(lauf, pts, nrm, o).catch((err) => { log('SIMULATOR-Linie: ' + err.message, 'err'); })
      .then(() => { if (simLauf === lauf) simLauf = null; simLadeAnzeige(!!simLauf); });
  }
  // Das drehende Streckenteil am Rand, solange gesucht wird (59-lade.js).
  function simLadeAnzeige(an) {
    const el = $('sim-lade');
    if (!el) return;
    if (typeof ladeAnimationSetzen === 'function') ladeAnimationSetzen($('sim-lade-dreh'), an);
    el.hidden = !an;
  }
  async function simSuche(lauf, pts, nrm, o0) {
    // v1.2.32: Kurvengrenze aus dem NPC-Kurventempo und Aussenanker (siehe simKurvenALat).
    const o = Object.assign({}, o0, { aLat: simKurvenALat(o0) });
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const anker = o.ohneAnker ? [] : simAussenAnker(pts, o.tiles, !!o.closed);
    const maxAusw = o.maxAuswertungen || SIM_MAX_AUSWERTUNGEN;
    const t0 = performance.now();
    const feld = [];
    const saat = {};
    // Ausgangslinien ohne Querratengrenze: sie fahren die Ghosts schon, und die steilste von
    // ihnen setzt die Grenze fuer alle Abwandlungen.
    const oFrei = Object.assign({}, o, { querMax: Infinity });
    let querMax = 0;
    const pruefe = (alpha0, herkunft) => {
      const alpha = simAussenSchranke(alpha0, anker, limit);
      const r = simFahren(alpha, pts, nrm, SIM_SAAT.indexOf(herkunft) >= 0 ? oFrei : Object.assign({}, o, { querMax }));
      if (SIM_SAAT.indexOf(herkunft) >= 0 && r.ok) querMax = Math.max(querMax, r.querRate || 0);
      lauf.auswertungen++;
      if (SIM_SAAT.indexOf(herkunft) >= 0) saat[herkunft] = r.ok ? Math.round(r.zeit * 1000) / 1000 : null;
      if (r.ok) feld.push({ alpha, zeit: r.zeit, runden: r.runden, herkunft });
      feld.sort((a, b) => a.zeit - b.zeit);
      if (feld.length > 6) feld.length = 6;
    };
    for (const m of SIM_SAAT) {
      await simPause();
      if (lauf.abbruch) return;
      try { pruefe(buildLine(pts, nrm, Object.assign({}, o, { model: m })).alpha.slice(), m); } catch (e) { /* Modell ohne Layout */ }
    }
    if (!feld.length) { log('SIMULATOR-Linie: keine Ausgangslinie faehrt drei Runden.', 'err'); return; }
    while (lauf.auswertungen < maxAusw) {
      await simPause();
      if (lauf.abbruch) return;
      const eltern = feld[Math.floor(Math.random() * Math.min(3, feld.length))];
      // Abwechselnd Beule und Sehne (die Sehne ist bei geschlossenen Strecken immer moeglich,
      // faellt aber weg, wenn sie die Bahn verlaesst).
      const sehne = Math.random() < 0.5 ? simSehne(eltern.alpha, pts, nrm, limit, !!o.closed) : null;
      if (sehne) pruefe(sehne, eltern.herkunft + '/');
      else pruefe(simBeule(eltern.alpha, limit), eltern.herkunft + '+');
    }
    const beste = feld[0];
    const e = { alpha: beste.alpha.map((a) => Math.round(a * 100) / 100), zeit: Math.round(beste.zeit * 1000) / 1000,
                runden: beste.runden, herkunft: beste.herkunft, wann: Date.now(), auswertungen: lauf.auswertungen,
                saat };
    // Pruefstand (95-selftest.js): nur rechnen, nichts merken und nichts neu zeichnen.
    if (o.nurRechnen) return e;
    simErgebnisse[lauf.key] = e;
    simLetztes = e;
    simSpeichern(lauf.key, e);
    if (simLauf === lauf) simLauf = null;
    log('SIMULATOR-Linie fertig: ' + lauf.auswertungen + ' Linien gefahren, beste ' + e.zeit.toFixed(2)
        + ' s je Runde (aus ' + beste.herkunft + '), ' + Math.round(performance.now() - t0) + ' ms.', 'info');
    // Neu zeichnen und neu fahren: der Zwischenspeicher haelt sonst die vorlaeufige Linie.
    try { lineCache = null; } catch (err) { /* ohne Ghosts */ }
    try { refreshTrackPreview(); } catch (err) { /* Editor nicht im Dokument */ }
    try { linemodellKarteZeichnen(); } catch (err) { /* Karte nicht im Dokument */ }
    if (getLineModel() === 'simulator') showHudToast(t('SIMULATOR-Linie fertig') + ': ' + e.zeit.toFixed(2) + ' s');
  }
  function simStand() {
    return simLauf ? { laeuft: true, auswertungen: simLauf.auswertungen, von: SIM_MAX_AUSWERTUNGEN }
      : { laeuft: false, letztes: simLetztes };
  }
  // VORRECHNEN (v1.0.17, BESTELLT: "sobald die Strecke fertig ist ein Ladesymbol ... 'Ideallinie
  // wird berechnet'"). Nach jeder Aenderung im Editor (refreshTrackPreview) und nach dem Laden:
  // kurz warten, dann die Linie der Ghosts anfordern - ist es eine neue geschlossene Strecke,
  // startet damit die Suche samt Einblendung. Auch wenn die Linie im Editor ausgeblendet ist.
  // var und nicht let: simVorrechnen() wird schon beim Laden aus 60-track.js gerufen, bevor diese
  // Zeile laeuft - ein let stuende dann in der temporalen Todeszone (genau der Fehler von 1.0.16).
  var simVorrechnenZeit = null;
  function simVorrechnen() {
    if (simVorrechnenZeit) clearTimeout(simVorrechnenZeit);
    simVorrechnenZeit = setTimeout(() => {
      simVorrechnenZeit = null;
      try {
        if (getLineModel() !== 'simulator' || !currentTrackTiles || currentTrackTiles.length < 3) return;
        if (!simImEditor()) return;   // v1.2.45: nur im Editor vorrechnen
        if (typeof ghostLine === 'function') ghostLine();
      } catch (e) { /* ohne Ghosts */ }
    }, 600);
  }
  // Nach dem Aufbau: eine beim Laden vorlaeufig gezeichnete Linie (siehe simBereit) ersetzen.
  setTimeout(() => {
    try { lineCache = null; } catch (e) { /* ohne Ghosts */ }
    try { if (currentTrackTiles && currentTrackTiles.length >= 3) refreshTrackPreview(); } catch (e) { /* Editor fehlt */ }
    simVorrechnen();
  }, 0);
