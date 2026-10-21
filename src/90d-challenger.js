  // ====================================================================================
  // CHALLENGER (v1.0.21, experimentell): ein echtes Auto faehrt gegen dich
  // ====================================================================================
  //
  // BESTELLT: "Nenne diese Rolle 'Challenger'", "beide Rollen sollten nur fuer Fahren auf Bahn
  // existieren" und "erlaube mir 'gegen den Rekord' versus 'gegen meine Bestzeit' versus
  // 'Gummiband'. Bei Gummiband faehrt er langsamer, wenn er einen Vorsprung hat und schneller,
  // wenn er hinterher ist, sodass er die ganze Zeit ungefaehr so schnell ist wie ich."
  //
  // Gefahren wird er von der NPC-Logik (startGhost/ghostTick): Linie, Spuren, Kurven- und
  // Bremsprofil, Leseschwelle. Hier steht nur, wie schnell er sein SOLL:
  //   Spur (Bestzeit/Rekord): Sollort zur Rennzeit aus den Zwischenzeiten der Runde
  //     (70b-telemetrie.js), Runde fuer Runde wiederholt; Abweichung in Kacheln -> Tempofaktor.
  //   Gummiband (v1.1.39): eine Tempostufe je NPC, die sich Runde fuer Runde aendert (unten).
  // Der Faktor wirkt auf das Zieltempo, das ghostTick ohnehin rechnet (mit Kurvenabzug), und ist
  // in Kurven enger gedeckelt - so holt er auf der Geraden auf und fliegt nicht aus der Haarnadel.

  var CHALLENGER_MODI = ['beste', 'rekord', 'gummiband'];
  var CHALLENGER_K = 0.45;             // Tempo je Kachel Abweichung
  // GEFRAGT: "Hast du Sicherheiten eingebaut, damit die Autos in der Haarnadel nicht zu schnell
  // fahren und dafuer auf der Geraden kompensieren?" Jetzt ja, und strenger als vorher:
  //   Haarnadel (darauf oder in den naechsten zwei Teilen): nie schneller als ein NPC (1,0) -
  //     aufgeholt wird nur auf der Geraden;
  //   normale Kurve (darauf oder im naechsten Teil): hoechstens 10 % ueber dem NPC-Kurventempo;
  //   Gerade: bis 60 % darueber.
  // Und die Untergrenze hebt ihn nie UEBER das NPC-Tempo: die NPCs fahren die Haarnadel mit
  // 33 %, unter der Leseschwelle - vorher zog die Untergrenze den Challenger dort auf 35 %.
  var CHALLENGER_MIN = 0.55, CHALLENGER_MAX = 1.6, CHALLENGER_MAX_KURVE = 1.1, CHALLENGER_MAX_HAARNADEL = 1.0;
  var challengerVorrat = { liste: null, r: null, holt: false };

  // v1.0.28 BESTELLT: "Koennen wir Challenger und NPC zusammenlegen, und beim Time Attack gelten
  // alle NPCs als Challenger?" Keine eigene Garagenrolle mehr: in Time Attack (nur auf der Bahn)
  // faehrt jeder NPC mit einem Challenger-Auftrag (g.challenger), in allen anderen Modi wie
  // immer. challenger() liefert den ersten dieser NPCs (fuer Startschirm und Vorbereitung).
  function challengerAutos() { return garage.filter((c) => c.role === 'ghost' && c.device); }
  function challenger() { return challengerAutos()[0] || null; }
  // Im Gummiband halten sich alle NPCs an dir - damit sie nicht aufeinander fahren, bekommt
  // jeder einen eigenen Versatz in Kacheln um deine Position: 0, -1, +1, -2, +2, ...
  function challengerVersatz(k) { return k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * CHALLENGER_ABSTAND; }
  var CHALLENGER_ABSTAND = 1.0;
  function challengerModus() {
    const el = $('race-challenger');
    return el && CHALLENGER_MODI.indexOf(el.value) >= 0 ? el.value : 'beste';
  }
  // Die Bestenliste zur gelegten Strecke: laufende Challenge, sonst eine gleiche Community-Strecke.
  function challengerListe() {
    try {
      if (typeof chLauf !== 'undefined' && chLauf) {
        return chLauf.community ? 'community|' + chLauf.id : chLauf.id + '|' + chLauf.modus + '|' + chLauf.preset;
      }
      if (typeof communityOnline !== 'undefined' && communityOnline && currentTrackTiles && currentTrackTiles.length >= 3) {
        const tr = communityFinde(communityOnline, currentTrackTiles);
        if (tr) return 'community|' + tr.id;
      }
    } catch (e) { /* ohne Liste */ }
    return null;
  }
  // Die Rekordspur vorab holen (Startschirm), damit sie beim Start da ist.
  function challengerVorbereiten() {
    if (!challenger() || challengerModus() !== 'rekord') return;
    const liste = challengerListe();
    if (!liste || (challengerVorrat.liste === liste && (challengerVorrat.r || challengerVorrat.holt))) return;
    challengerVorrat = { liste, r: null, holt: true };
    spurRekord(liste).then((r) => { if (challengerVorrat.liste === liste) { challengerVorrat.r = r; challengerVorrat.holt = false; } });
  }
  // Welche Runde faehrt er? { art, teile, ms, name } oder null (dann Gummiband).
  function challengerSpur(modus) {
    const tiles = currentTrackTiles;
    if (!tiles || tiles.length < 3) return null;
    if (modus === 'beste') {
      const sp = teleBeste(typeof playerCar !== 'undefined' ? playerCar : null, tiles);
      const teile = teleAusrichten(sp, tiles);
      return teile ? { art: 'beste', teile, ms: sp.ms, name: t('deine Bestzeit') } : null;
    }
    if (modus === 'rekord') {
      const r = challengerVorrat.liste === challengerListe() ? challengerVorrat.r : null;
      const teile = r ? teleAusrichten(r.spur, tiles) : null;
      return teile ? { art: 'rekord', teile, ms: r.spur.ms, name: t('Rekord') + ' ' + (r.fahrer || '') } : null;
    }
    return null;
  }
  // Aus launchGhosts, auch in Time Attack (dort bleiben nur die NPCs stehen).
  // Aus launchGhosts in Time Attack. Rueckgabe: wie viele NPCs als Challenger fahren.
  function challengerStarten() {
    const autos = challengerAutos();
    if (!autos.length || trackMode !== 'on') return 0;
    const modus = challengerModus();
    let sp = challengerSpur(modus);
    if (!sp && modus === 'rekord') sp = challengerSpur('beste');
    let n = 0;
    autos.forEach((c) => {
      startGhost(c);
      if (!c.ghost) return;
      const versatz = challengerVersatz(n++);
      c.ghost.challenger = sp ? { art: sp.art, teile: sp.teile, ms: sp.ms, ortStart: null, soll: null, versatz }
                              : challengerBandNeu(versatz);
    });
    const text = (sp ? t('Challenger fährt') + ' ' + sp.name + ' (' + formatLapTime(sp.ms) + ')'
      : (modus === 'gummiband' ? t('Challenger fährt Gummiband') : t('Keine Runde für den Challenger – er fährt Gummiband')))
      + (n > 1 ? ' · ' + t('{n} NPCs').replace('{n}', n) : '');
    showHudToast(text);
    log('Time Attack: ' + n + ' NPC(s) als Challenger. ' + text, 'info');
    return n;
  }

  // Aus ghostTick, nach allen Abschlaegen und vor dem Boxenstopp: das Zieltempo des Challengers.
  // spice: die Rennwuerze dieses Takts aus ghostTick. Haelt er gerade Abstand zu einem Auto vor
  // ihm (spice.haeltAbstand - auch zu dir), darf der Aufholfaktor das nicht aufheben.
  function challengerZiel(car, basis, spice) {
    const g = car.ghost, ch = g && g.challenger;
    if (!ch) return basis;
    // Das Gummiband verfolgt den Vorsprung auch unter Gelb und in der Box: er wird aus kleinen
    // Schritten aufsummiert, und eine Pause wuerde ihn verlieren.
    if (ch.art === 'gummiband' && raceState === 'racing') challengerBandTakt(car, ch);
    if (flagState !== 'green' || raceFormationLap || raceState !== 'racing'
        || (g.aufstellZiel !== undefined && g.aufstellZiel !== null) || g.pit) return basis;
    const ist = ghostOrtGes(car);
    if (ist === null) return basis;
    let soll = null;
    if (ch.art === 'gummiband') {
      ch.soll = null;
      return challengerDeckeln(car, basis, ch.stufe || 1, !!(spice && spice.haeltAbstand));
    } else {
      if (raceStartedAt === null || raceStartedAt === undefined) return basis;
      const tMs = Date.now() - raceStartedAt;
      if (tMs < 0) return basis;
      if (ch.ortStart === null) ch.ortStart = ist;
      const n = ch.teile.length;
      // Ohne Versatz: jeder NPC faehrt die Runde ab seinem eigenen Startplatz (ortStart), die
      // Startaufstellung haelt sie also schon auseinander.
      soll = ch.ortStart + Math.floor(tMs / ch.ms) * n + teleWeg(ch.teile, ch.ms, tMs % ch.ms);
    }
    ch.soll = ch.art === 'gummiband' ? null : soll;
    return challengerFaktorAnwenden(car, basis, soll - ist, !!(spice && spice.haeltAbstand));
  }
  // Abstand von b nach a auf einer Runde mit n Kacheln, gewickelt auf (-n/2, n/2].
  function challengerRundenAbstand(a, b, n) {
    let d = ((a - b) % n + n) % n;
    if (d > n / 2) d -= n;
    return d;
  }
  // Abweichung in Kacheln (positiv = er liegt hinten) -> Zieltempo.
  function challengerFaktorAnwenden(car, basis, abw, haeltAbstand) {
    return challengerDeckeln(car, basis, 1 + CHALLENGER_K * abw, haeltAbstand);
  }
  // Ein Tempofaktor auf das NPC-Zieltempo, je Teil gedeckelt: Haarnadel (darauf oder in den
  // naechsten zwei Teilen) 1,0, Kurve 1,1, Gerade 1,6. Danach in ghostTick noch Mindesttempo und
  // Haarnadel-Obergrenze.
  function challengerDeckeln(car, basis, faktor, haeltAbstand) {
    const hier = ghostTileInfo(car.tileCode).curve;
    const voraus = ghostAheadTightest(car, 2);
    const haarnadel = hier >= 2 || voraus.tight >= 2;
    const kurve = hier > 0 || (voraus.tight > 0 && voraus.dist <= 1);
    let max = haarnadel ? CHALLENGER_MAX_HAARNADEL : kurve ? CHALLENGER_MAX_KURVE : CHALLENGER_MAX;
    if (haeltAbstand) max = Math.min(max, 1);
    const f = Math.max(CHALLENGER_MIN, Math.min(max, faktor));
    return Math.max(Math.min(basis, GHOST_READ_MIN), Math.min(1, basis * f));
  }

  // ---- GUMMIBAND IN STUFEN (v1.1.39, WIP) ------------------------------------------------
  // BESTELLT: "Lass das Auto (bzw. die Autos), wenn es viel Vorsprung hat, schrittweise langsamer
  // werden (z. B. 2-4 % pro Runde), und zwar so lange, bis es ueberholt wurde, also hinter dem
  // Spieler-Auto liegt. Dann soll es die Geschwindigkeit (so wie die Schwierigkeit im Garagen-
  // Einstellungsmenue) wieder hochschrauben, bis es an vorderer Stelle ist. Beruecksichtige Minimal-
  // und Maximalgeschwindigkeit und die verschiedenen Teile (vor allem Haarnadel)."
  // Vorher zog das Gummiband jeden Takt zu deinem Ort (Abweichung x 0,45), der NPC klebte also
  // neben dir. Jetzt hat jeder NPC eine Tempostufe (1 = sein Garagentempo), die sich nur an SEINER
  // Start/Ziel-Linie aendert:
  //   runter - ab challengerBandVorsprungMin Vorsprung: je Runde ein Schritt, bis er hinter dir liegt;
  //   hoch   - solange er hinter dir liegt: je Runde ein Schritt, bis er wieder vorn ist;
  //   halten - vorn mit kleinem Vorsprung: die Stufe bleibt, bis er wegzieht.
  // SCHRITTWEITE, Vorgabe 4 %: ein NPC, der 5 % schneller ist als du, gewinnt je Runde 5 % einer
  // Runde. Mit 2 % je Runde verliert er erst ab der dritten Runde Boden - ein Zwei-Minuten-Rennen
  // hat oft nur zehn. Mit 4 % ab der zweiten, eingeholt nach vier, fuenf Runden. Mehr wirkt
  // ruckartig; darum ein Regler von 2 bis 10 %.
  // VORSPRUNG UEBER RUNDEN, ohne den Rundenzaehler deines Autos (der kann eine Runde verlieren,
  // v1.0.25): der gewickelte Abstand auf der Runde aendert sich je Takt nur um Bruchteile einer
  // Kachel, also wird er Takt fuer Takt aufsummiert. So weiss der NPC auch mit einer halben Runde
  // Vorsprung noch, dass er vorn liegt (gewickelt saehe das wie "hinten" aus).
  // GRENZEN: Stufe in [CHALLENGER_BAND_MIN, CHALLENGER_BAND_MAX]; challengerDeckeln haelt sie in
  // Kurven und vor/in der Haarnadel; danach gelten in ghostTick Mindesttempo und Haarnadel-Obergrenze.
  var CHALLENGER_BAND_SCHRITT = 0.04, CHALLENGER_BAND_MIN = 0.6, CHALLENGER_BAND_MAX = 1.4;
  function challengerBandNeu(versatz) {
    return { art: 'gummiband', soll: null, versatz, stufe: 1, lage: 'halten', vorsprung: null, letztD: null, runde: null };
  }
  function challengerBandSchritt() {
    const el = $('race-gummiband-schritt');
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) ? Math.max(0.01, Math.min(0.2, v)) : CHALLENGER_BAND_SCHRITT;
  }
  // "Viel Vorsprung": ein Viertel der Runde, mindestens zwei Kacheln.
  function challengerBandVorsprungMin(n) { return Math.max(2, n * 0.25); }
  // Ein Takt: Vorsprung fortschreiben (d = gewickelter Abstand, positiv = NPC vor dir), Lage
  // umstellen, und an seiner Linie die Stufe aendern.
  function challengerBandTakt(car, ch) {
    const n = currentTrackTiles ? currentTrackTiles.length : 0;
    const ist = ghostOrtGes(car);
    const p = typeof playerCar !== 'undefined' && playerCar && playerCar.ghost ? ghostOrt(playerCar) : null;
    if (!n || ist === null || p === null) return;
    challengerBandVerfolgen(ch, challengerRundenAbstand(ist, p, n), n);
    const runde = Math.floor(ist / n);
    if (ch.runde === null || ch.runde === undefined) ch.runde = runde;
    else if (runde > ch.runde) {
      ch.runde = runde;
      const vor = ch.stufe;
      challengerBandRunde(ch);
      if (ch.stufe !== vor) {
        log(garageLabel(car) + ' Gummiband: Tempo ' + Math.round(ch.stufe * 100) + ' % (' + ch.lage
          + ', Vorsprung ' + ch.vorsprung.toFixed(1) + ' Kacheln)', 'info');
      }
    }
  }
  function challengerBandVerfolgen(ch, d, n) {
    if (ch.vorsprung === null || ch.vorsprung === undefined) ch.vorsprung = d;
    else ch.vorsprung += challengerRundenAbstand(d, ch.letztD, n);
    ch.letztD = d;
    const v = ch.vorsprung;
    if (v < 0) ch.lage = 'hoch';
    else if (ch.lage === 'hoch') ch.lage = 'halten';
    if (ch.lage === 'halten' && v >= challengerBandVorsprungMin(n)) ch.lage = 'runter';
    return v;
  }
  function challengerBandRunde(ch) {
    const s = challengerBandSchritt();
    const st = ch.stufe || 1;
    if (ch.lage === 'runter') ch.stufe = Math.max(CHALLENGER_BAND_MIN, st - s);
    else if (ch.lage === 'hoch') ch.stufe = Math.min(CHALLENGER_BAND_MAX, st + s);
    return ch.stufe;
  }
  if ($('race-gummiband-schritt')) {
    const el = $('race-gummiband-schritt');
    const zeigen = () => { if ($('race-gummiband-schritt-val')) $('race-gummiband-schritt-val').textContent = Math.round(challengerBandSchritt() * 100) + ' %'; };
    try { const w = localStorage.getItem('omegasim-gummiband-schritt'); if (w !== null && w !== '') el.value = w; } catch (e) { /* privat */ }
    el.addEventListener('input', () => {
      zeigen();
      try { localStorage.setItem('omegasim-gummiband-schritt', el.value); } catch (e) { /* privat */ }
    });
    zeigen();
  }
  // Fuer die Karte: wo die Spur gerade ist (nur bei Bestzeit/Rekord).
  function challengerSollMarke() {
    const c = challengerAutos().find((x) => x.ghost && x.ghost.challenger && x.ghost.challenger.soll !== null);
    const ch = c && c.ghost && c.ghost.challenger;
    const n = currentTrackTiles ? currentTrackTiles.length : 0;
    if (!ch || ch.soll === null || ch.soll === undefined || !n) return null;
    const o = ((ch.soll % n) + n) % n;
    return { index: Math.floor(o), phase: o - Math.floor(o), farbe: '#ffffff', kuerzel: 'SOLL', quer: 0, rolle: 'ghost' };
  }
  if ($('race-challenger')) $('race-challenger').addEventListener('change', () => challengerVorbereiten());
