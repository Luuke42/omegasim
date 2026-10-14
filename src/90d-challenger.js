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
  //   Gummiband: dein Ort statt des Sollorts.
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
                              : { art: 'gummiband', soll: null, versatz };
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
    if (!ch || flagState !== 'green' || raceFormationLap || raceState !== 'racing'
        || (g.aufstellZiel !== undefined && g.aufstellZiel !== null) || g.pit) return basis;
    const ist = ghostOrtGes(car);
    if (ist === null) return basis;
    let soll = null;
    if (ch.art === 'gummiband') {
      // v1.0.25 GEMELDET: "Gummiband reagiert nicht auf meine Zeiten - ob ich langsamer oder
      // schneller fahre, er haelt seine Geschwindigkeit." Hier stand ghostOrtGes(playerCar):
      // die Ortung des Fahrerautos zaehlt keine Runden (spielerOrtTick wickelt nur den Index),
      // die des Challengers schon. Nach seiner ersten Runde lag er also rechnerisch eine ganze
      // Runde vorn, und der Faktor stand fest am unteren Anschlag. Jetzt der Abstand auf der
      // Runde, gewickelt auf -n/2 .. n/2: fuer ein Gummiband zaehlt nur, wer gerade vorn liegt.
      // BESTELLT dazu: "auch wenn mein Auto mal versehentlich eine Runde nicht zaehlt (z. B. weil ich
      // bei Start/Ziel von der Bahn komme)" - genau deshalb ohne Rundenzaehler: nur der Ort auf der
      // Runde zaehlt, und den gleicht ortAbgleich() bei jeder Start/Ziel-Lesung neu ab.
      const p = typeof playerCar !== 'undefined' && playerCar && playerCar.ghost ? ghostOrt(playerCar) : null;
      const n = currentTrackTiles ? currentTrackTiles.length : 0;
      if (p === null || !n) return basis;
      soll = ist + challengerRundenAbstand(p + (ch.versatz || 0), ist, n);
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
    const hier = ghostTileInfo(car.tileCode).curve;
    const voraus = ghostAheadTightest(car, 2);
    const haarnadel = hier >= 2 || voraus.tight >= 2;
    const kurve = hier > 0 || (voraus.tight > 0 && voraus.dist <= 1);
    let max = haarnadel ? CHALLENGER_MAX_HAARNADEL : kurve ? CHALLENGER_MAX_KURVE : CHALLENGER_MAX;
    if (haeltAbstand) max = Math.min(max, 1);
    const f = Math.max(CHALLENGER_MIN, Math.min(max, 1 + CHALLENGER_K * abw));
    return Math.max(Math.min(basis, GHOST_READ_MIN), Math.min(1, basis * f));
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
