  // ============================== KARRIERE (WIP) ==============================
  //
  // v1.5 BESTELLT (Plan Paket 7): "Karriere (WIP): eigener Knopf unter Challenges, Regeln wie bei Mokamit
  // (GT World Challenge: Sprint- und Endurance-Runden, Pflichtstopp im Boxenfenster, Punkte, Lizenzen, XP,
  // Preisgeld)." Nach Hybrid-Dash 4.0 von Mo Kamit (MIT-Lizenz), Datei 98zg-hd4-karriere.js.
  //
  //   SPRINT-RUNDE      Qualifying 1, Rennen 1, Qualifying 2, Rennen 2. Ein Rennen ist eine "Stunde" mit einem
  //                     Pflichtstopp im Boxenfenster (Minute 25 bis 35). Punkte 16,5-12-9,5-7,5-6-4,5-3-2-1-0,5.
  //   ENDURANCE-RUNDE   Qualifying, ein Rennen ueber 3 "Stunden" (auch 6 und 24). Hoechstens 65 min je Stint,
  //                     also zwei Pflichtstopps bei 3 Stunden. Punkte 25-18-15-12-10-8-6-4-2-1 (6 Stunden
  //                     33-24-19-...), die 24 Stunden zahlen nach einem Viertel und der Haelfte Zwischenpunkte.
  //   Fliegender Start in jedem Rennen, ein Punkt fuer die Pole, drei Titel (Gesamt, Sprint, Endurance).
  //   LIZENZEN          Bronze, Silber, Gold, Pro. Sie setzen das Tempo der NPCs (karriereKlasse, ghostTick),
  //                     eng begrenzt, weil echte Autos ueber ihrer Stufe abfliegen.
  //
  // ANDERS ALS BEI MOKAMIT: OmegaSims Rennablauf (Renneinstellungen, Startreihe, finishRace) und die Klassierung
  // der Meisterschaft (Runden, Gesamtzeit ab Gruen, Strafen). Ein Rennen als "Endurance" mit Zeitlimit. Die
  // Team-Upgrades fehlen noch (OmegaSim hat keine Haken fuer Boxenzeit, Verbrauch und Reifenverschleiss je
  // Faktor); das Preisgeld sammelt sich bis dahin.

  const KARRIERE_STORE = 'omegasim-karriere.v1';
  const KAR_LIZENZ = [
    { id: 'bronze', name: 'Bronze', farbe: '#c98a52', ki: 0.97, text: 'Ein Feld aus Herrenfahrern.' },
    { id: 'silber', name: 'Silber', farbe: '#c9d1dc', ki: 0.99, text: 'Junge Wilde und schnelle Amateure.' },
    { id: 'gold', name: 'Gold', farbe: '#f5c542', ki: 1.01, text: 'Erfahrene Profis.' },
    { id: 'pro', name: 'Pro', farbe: '#ff5a4d', ki: 1.03, text: 'Werksfahrer. Nichts geschenkt.' },
  ];
  const KAR_KLASSE_GRENZE = [0.95, 1.04];
  const KAR_PUNKTE = {
    sprint: [16.5, 12, 9.5, 7.5, 6, 4.5, 3, 2, 1, 0.5],
    endurance: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    endurance6: [33, 24, 19, 15, 12, 9, 6, 4, 2, 1],
    zwischen: [12, 9, 7, 6, 5, 4, 3, 2, 1],
  };
  const KAR_PREISGELD = [12000, 9000, 7500, 6000, 5000, 4200, 3500, 3000, 2500, 2000];
  const KAR_ORTE = ['Paul Ricard', 'Brands Hatch', 'Monza', 'Misano', 'Spa-Francorchamps', 'Hockenheim', 'Nürburgring', 'Magny-Cours', 'Valencia', 'Barcelona'];
  const KAR_SAISON_VOLL = [['endurance', 3], ['sprint', 1], ['endurance', 3], ['sprint', 1], ['endurance', 24], ['sprint', 1], ['endurance', 3], ['sprint', 1], ['sprint', 1], ['endurance', 6]];
  const KAR_SAISON_KURZ = [['sprint', 1], ['endurance', 3], ['sprint', 1], ['endurance', 3]];
  const KAR_ZIELE = {
    podium: 'Ein Rennen auf dem Podium beenden',
    sauber: 'Ein Rennen ohne Vorfall beenden',
    fl: 'Die schnellste Runde eines Rennens fahren',
    pole: 'Die Pole-Position holen',
    fenster: 'Jeden Pflichtstopp ohne Strafe erledigen',
    aufholen: 'Zwei Plätze gegenüber dem Startplatz gutmachen',
  };
  const KAR_ZIEL_GELD = 4000, KAR_ZIEL_XP = 40;
  // Team-Upgrades (v1.5, nach Mokamit): wirken nur auf Auto 1 und nur in einer laufenden Karriere-Sitzung.
  // Boxencrew in pitSpielDauer (70-race.js), Sprit im Verbrauch (70-race.js), Reifen im Verschleiss (40-physics.js).
  // Mokamits "Zuverlaessigkeit" fehlt: OmegaSim hat keine Ausfaelle, auf die sie wirken koennte.
  const KAR_UPGRADES = [
    { id: 'crew', name: 'Boxencrew', text: 'Standzeit beim Boxenstopp −6 % je Stufe.', schritt: 0.06 },
    { id: 'sprit', name: 'Spritverbrauch', text: 'Verbrauch −4 % je Stufe.', schritt: 0.04 },
    { id: 'reifen', name: 'Reifenprogramm', text: 'Reifenverschleiß −5 % je Stufe.', schritt: 0.05 },
  ];
  const KAR_UPGRADE_PREIS = [15000, 30000, 55000];
  function karriereUpgrade(id) {
    const d = karD;
    if (!d || !d.laeuft || !d.upgrades) return 1;
    const u = KAR_UPGRADES.find((x) => x.id === id);
    return u ? 1 - u.schritt * Math.max(0, Math.min(3, d.upgrades[id] || 0)) : 1;
  }

  function karLesen() {
    try { const d = JSON.parse(localStorage.getItem(KARRIERE_STORE) || 'null'); return d && d.v === 1 ? d : null; } catch (e) { return null; }
  }
  // var: ghostTick (90-ghosts.js) fragt karriereKlasse() schon waehrend des Ladens.
  var karD = null;
  let karBericht = null, karAnsicht = 'pkt', karWarten = null, karTakt = null, karStill = false;
  function kar() { if (karD === null) { karD = karLesen() || false; if (karD && karD.laeuft) { karD.laeuft = null; karSpeichern(); } } return karD || null; }
  function karSpeichern() { try { if (karD) localStorage.setItem(KARRIERE_STORE, JSON.stringify(karD)); else localStorage.removeItem(KARRIERE_STORE); } catch (e) { /* privat */ } }

  // ---- Kalender ----
  function karSessionName(s, runde) {
    if (s.art === 'quali') return t('Qualifying') + (s.nr ? ' ' + s.nr : '');
    if (runde.typ === 'sprint') return t('Rennen') + ' ' + s.nr;
    return runde.stunden === 24 ? t('24 Stunden') : t('{n} Stunden').replace('{n}', runde.stunden);
  }
  function karRunde(typ, stunden, i) {
    const sessions = typ === 'sprint'
      ? [{ art: 'quali', nr: 1 }, { art: 'rennen', nr: 1 }, { art: 'quali', nr: 2 }, { art: 'rennen', nr: 2 }]
      : [{ art: 'quali', nr: 0 }, { art: 'rennen', nr: 0 }];
    const pool = Object.keys(KAR_ZIELE);
    const z1 = pool[Math.floor(Math.random() * pool.length)];
    let z2 = pool[Math.floor(Math.random() * pool.length)];
    if (z2 === z1) z2 = pool[(pool.indexOf(z1) + 1) % pool.length];
    return { typ, stunden, ort: KAR_ORTE[i % KAR_ORTE.length], strecke: 'aktuell', wetter: Math.random() < 0.2 ? 'wechsel' : 'dry',
             sessions: sessions.map((s) => Object.assign({ erledigt: false, reihe: null }, s)), ziele: [{ id: z1, erfuellt: false }, { id: z2, erfuellt: false }] };
  }
  function karNeu(name, lang, minProStunde, stufe, saison) {
    const plan = lang === 'voll' ? KAR_SAISON_VOLL : KAR_SAISON_KURZ;
    return { v: 1, fahrer: name || t('Fahrer'), stufe: stufe || 0, xp: 0, credits: 0, lp: 0, saison: saison || 1, minProStunde: minProStunde || 6,
             kalender: plan.map(([typ, st], i) => karRunde(typ, st, i)), idx: 0, tabelle: {}, laeuft: null, trophaeen: [], fertig: false, lang,
             upgrades: { crew: 0, sprit: 0, reifen: 0 } };
  }
  function karLevel(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 150)) + 1; }
  function karLevelXp(level) { return (level - 1) * (level - 1) * 150; }
  function karMinuten(runde, session, d) {
    const m = (d || kar()).minProStunde;
    if (session.art === 'quali') return Math.max(2, Math.round(m / 3));
    // Die 24 Stunden laufen gestaucht als acht "Stunden": immer noch das laengste Rennen der Saison.
    return Math.max(2, Math.round(m * (runde.stunden === 24 ? 8 : runde.stunden)));
  }
  function karStopps(runde) {
    if (runde.typ === 'sprint') return 1;
    return Math.min(3, runde.stunden === 24 ? 3 : Math.ceil(runde.stunden * 60 / 65) - 1);
  }
  function karNaechste() {
    const d = kar();
    if (!d || d.fertig) return null;
    const runde = d.kalender[d.idx];
    if (!runde) return null;
    const si = runde.sessions.findIndex((s) => !s.erledigt);
    return si < 0 ? null : { runde, si, session: runde.sessions[si] };
  }
  function karStrecken() { try { return Object.keys(loadTrackStore()).sort((a, b) => a.localeCompare(b)); } catch (e) { return []; } }

  // ---- Feldstaerke: Faktor auf das Zieltempo der NPCs, nur in einer laufenden Karriere-Sitzung ----
  function karriereKlasse() {
    const d = karD;
    if (!d || !d.laeuft) return 1;
    const f = KAR_LIZENZ[d.stufe].ki + 0.01 * Math.min(3, d.saison - 1);
    return Math.max(KAR_KLASSE_GRENZE[0], Math.min(KAR_KLASSE_GRENZE[1], f));
  }

  // ---- Start einer Sitzung ----
  function karStarten() {
    const d = kar(), n = karNaechste();
    if (!d || !n) return;
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return; }
    const { runde, si, session } = n;
    if (runde.strecke !== 'aktuell') {
      if (karStrecken().indexOf(runde.strecke) >= 0) trackLaden(runde.strecke);
      else showHudToast(t('Strecke nicht mehr gespeichert, es gilt die aktuelle'));
    }
    meisterBahn(true);
    if (!currentTrackTiles || currentTrackTiles.length < 4) { showHudToast(t('Diese Runde braucht eine Strecke: erst scannen, laden oder bauen.')); return; }
    const minuten = karMinuten(runde, session);
    const rennen = session.art === 'rennen';
    const stopps = rennen ? karStopps(runde) : 0;
    chSetzen('race-mode', rennen ? 'endurance' : 'qualifying');
    chSetzen('race-limit', minuten);
    if (String(raceLimit) !== String(minuten)) raceLimit = minuten;
    chSetzen('race-wx-start', 'dry');
    chSetzen('race-wx-change', rennen && runde.wetter === 'wechsel');
    chSetzen('race-flying', rennen);
    chSetzen('race-pit-required', String(stopps));
    // Startreihe: die Reihenfolge des Qualifyings davor.
    if (rennen) {
      const q = runde.sessions.slice(0, si).reverse().find((s) => s.art === 'quali' && s.reihe && s.reihe.length);
      if (q) raceGridOrder = q.reihe.map((x) => x.id).filter((id) => garage.some((c) => c.device && String(c.device.id) === id));
    }
    d.laeuft = { idx: d.idx, si, art: session.art, modus: rennen ? 'endurance' : 'qualifying', seit: Date.now(), minuten, stopps,
                 fensterVon: runde.typ === 'sprint' && rennen ? 25 / 60 : null, fensterBis: runde.typ === 'sprint' && rennen ? 35 / 60 : null,
                 stunden: runde.stunden, stoppsBei: [], pitVor: 0, zwischen: [], zwischenDone: 0, fensterGesagt: 0 };
    karSpeichern();
    karSchliessen();
    showHudToast(t('Karriere') + ' · ' + runde.ort + ' · ' + karSessionName(session, runde));
    karTaktStellen();
    konsoleLosfahren();
  }
  function karriereAktiv() { return !!(karD && karD.laeuft); }
  function karAnteil(l) {
    try { return raceGreenAt ? (rennZeitJetzt() - raceGreenAt) / (l.minuten * 60000) : 0; } catch (e) { return 0; }
  }
  function karFenster() {
    const l = karD && karD.laeuft;
    if (!l || l.fensterVon === null || (raceState !== 'racing' && raceState !== 'finishing')) return null;
    const anteil = karAnteil(l);
    const offen = anteil >= l.fensterVon && anteil <= l.fensterBis;
    const bis = offen ? (l.fensterBis - anteil) * l.minuten * 60 : anteil < l.fensterVon ? (l.fensterVon - anteil) * l.minuten * 60 : 0;
    return { offen, vorbei: anteil > l.fensterBis, bisS: Math.max(0, bis), bedient: l.stoppsBei.some((a) => a >= l.fensterVon && a <= l.fensterBis) };
  }
  // Waehrend eines Karriere-Rennens: Stopps von Spieler 1 mitschreiben, Boxenfenster ansagen, Zwischenpunkte der 24 Stunden.
  function karTaktStellen() {
    if (karTakt) return;
    karTakt = setInterval(() => {
      const l = karD && karD.laeuft;
      if (!l) { clearInterval(karTakt); karTakt = null; return; }
      if (l.art !== 'rennen' || (raceState !== 'racing' && raceState !== 'finishing')) return;
      const anteil = karAnteil(l);
      if (racePitDone > l.pitVor) { l.stoppsBei.push(anteil); l.pitVor = racePitDone; }
      const f = karFenster();
      if (f && f.offen && !f.bedient && !l.fensterGesagt) { l.fensterGesagt = 1; showHudToast(t('Boxenfenster offen')); }
      if (f && f.offen && !f.bedient && f.bisS < 20 && l.fensterGesagt < 2) { l.fensterGesagt = 2; showHudToast(t('Boxenfenster schließt in 20 s')); }
      if (l.stunden === 24) {
        [0.25, 0.5].forEach((marke, i) => {
          if (anteil >= marke && l.zwischenDone <= i) {
            l.zwischenDone = i + 1;
            l.zwischen.push(karKlassieren(false).filter((x) => x.laps > 0 && !x.raus).map((x) => x.id));
            showHudToast(t('Zwischenwertung'));
          }
        });
      }
    }, 1000);
  }

  // ---- Wertung ----
  // Wie die Meisterschaft (meisterFeldMessen): Runden, Zeit ab Gruen, Strafen der gesteuerten Autos.
  function karKlassieren(quali) {
    const feld = raceAllCars().map((c) => {
      const ms = (c.laps || []).map((l) => l.ms);
      let total = ms.reduce((a, b) => a + b, 0) + (ms.length ? (c.vorlauf || 0) : 0);
      const platz = typeof spielerPlatzVonRolle === 'function' ? spielerPlatzVonRolle(c.role) : 0;
      if (platz && typeof strafeMsVon === 'function') total += strafeMsVon(platz);
      return { id: c.id && c.id !== 'undefined' ? c.id : 'spieler', name: c.alias || c.name, farbe: c.farbe, rolle: c.role, laps: ms.length, total,
               beste: ms.length ? Math.min.apply(null, ms) : Infinity, raus: !!(c.dnf || c.dsq) };
    });
    feld.sort((a, b) => (a.raus - b.raus) || (quali ? a.beste - b.beste : (b.laps - a.laps) || (a.total - b.total)));
    return feld;
  }
  // Aus finishRace() (70-race.js), wie meisterRennenEnde. regulaer = bis zum Ende gefahren.
  function karriereRennenEnde(regulaer) {
    const d = karD;
    if (!d || !d.laeuft) return false;
    if (d.laeuft.modus !== raceMode) { d.laeuft = null; karSpeichern(); return false; }
    if (!regulaer) {
      d.laeuft = null; karSpeichern();
      showHudToast(t('Karriere-Sitzung abgebrochen: sie wird nicht gewertet und kann neu gestartet werden.'));
      return true;
    }
    if (karWarten) clearInterval(karWarten);
    const bis = Date.now() + 95000;
    karWarten = setInterval(() => {
      const rollt = garage.some((c) => c.role === 'ghost' && c.ghost && c.ghost.auslauf);
      if (rollt && Date.now() < bis) return;
      clearInterval(karWarten); karWarten = null;
      if (karD && karD.laeuft) karWerten(karKlassieren(karD.laeuft.art === 'quali'));
    }, 500);
    return true;
  }
  function karWerten(feld) {
    const d = karD, l = d.laeuft;
    const runde = d.kalender[l.idx], session = runde && runde.sessions[l.si];
    d.laeuft = null;
    if (!runde || !session) { karSpeichern(); return; }
    const quali = l.art === 'quali';
    const ich = feld.find((x) => x.rolle === 'player');
    // Sprint: der Pflichtstopp muss im Fenster liegen, sonst +30 s (wie eine Durchfahrtsstrafe).
    let fensterStrafe = false;
    if (!quali && l.fensterVon !== null && ich && !l.stoppsBei.some((a) => a >= l.fensterVon && a <= l.fensterBis)) {
      fensterStrafe = true;
      ich.total += 30000;
      feld.sort((a, b) => (a.raus - b.raus) || (b.laps - a.laps) || (a.total - b.total));
    }
    const gewertet = feld.filter((x) => x.laps > 0 && !x.raus);
    session.erledigt = true;
    session.reihe = gewertet.map((x) => ({ id: x.id, name: x.name, beste: Number.isFinite(x.beste) ? Math.round(x.beste) : null, laps: x.laps }));
    feld.forEach((x) => {
      if (!d.tabelle[x.id]) d.tabelle[x.id] = { name: x.name, farbe: x.farbe, ich: x.rolle === 'player', pkt: 0, sprint: 0, endurance: 0, siege: 0, podien: 0 };
      d.tabelle[x.id].name = x.name; if (x.farbe) d.tabelle[x.id].farbe = x.farbe;
      if (x.rolle === 'player') d.tabelle[x.id].ich = true;
    });
    const b = { titel: runde.ort + ' · ' + karSessionName(session, runde), zeilen: [], xp: 0, credits: 0, lp: 0, ziele: [], fensterStrafe, quali };
    const pos = ich ? gewertet.indexOf(ich) + 1 : 0;
    const zielErfuellt = (id) => runde.ziele.forEach((z) => {
      if (z.id === id && !z.erfuellt) { z.erfuellt = true; b.ziele.push(id); b.credits += KAR_ZIEL_GELD; b.xp += KAR_ZIEL_XP; }
    });
    if (quali) {
      b.xp += 20;
      if (pos === 1) { b.xp += 30; zielErfuellt('pole'); }
      gewertet.forEach((x, i) => b.zeilen.push({ pos: i + 1, name: x.name, wert: formatLapTime(x.beste), pkt: '', ich: x === ich }));
    } else {
      const tab = runde.typ === 'sprint' ? KAR_PUNKTE.sprint : runde.stunden === 6 ? KAR_PUNKTE.endurance6 : KAR_PUNKTE.endurance;
      const feldTyp = runde.typ === 'sprint' ? 'sprint' : 'endurance';
      const geben = (id, p) => { const e = d.tabelle[id]; if (e && p) { e.pkt += p; e[feldTyp] += p; } };
      const q = runde.sessions.slice(0, l.si).reverse().find((s) => s.art === 'quali' && s.reihe && s.reihe.length);
      if (q) geben(q.reihe[0].id, 1);
      (l.zwischen || []).forEach((reihe) => reihe.forEach((id, i) => geben(id, KAR_PUNKTE.zwischen[i] || 0)));
      let fl = null;
      gewertet.forEach((x) => { if (!fl || x.beste < fl.beste) fl = x; });
      gewertet.forEach((x, i) => {
        const p = tab[i] || 0;
        geben(x.id, p);
        const e = d.tabelle[x.id];
        if (i === 0) e.siege++;
        if (i < 3) e.podien++;
        b.zeilen.push({ pos: i + 1, name: x.name, wert: t('{n} Runden').replace('{n}', x.laps) + (x === fl ? ' · ' + t('schnellste Runde') + ' ' + formatLapTime(x.beste) : ''),
                        pkt: String(p) + (q && q.reihe[0].id === x.id ? ' +1' : ''), ich: x === ich });
      });
      if (pos) {
        const n = Math.max(2, gewertet.length);
        const mult = runde.typ === 'sprint' ? 1 : runde.stunden === 24 ? 3 : runde.stunden === 6 ? 2.4 : 1.8;
        b.xp += 60 + Math.round(100 * (n - pos) / (n - 1)) + (fl === ich ? 25 : 0);
        b.credits += Math.round((KAR_PREISGELD[pos - 1] || 1500) * mult);
        b.lp += pos === 1 ? 3 : pos === 2 ? 2 : pos === 3 ? 1 : 0;
        if (pos <= 3) zielErfuellt('podium');
        if (fl === ich) zielErfuellt('fl');
        // Sauber: nichts gegen Spieler 1 in der Vorfallkarte (98g-telemetrie-seite.js) seit dem Start der Sitzung.
        let vorfaelle = 0;
        try { const v = vorfallLesen()[bestzeitSchluessel(currentTrackTiles)]; vorfaelle = v ? v.liste.filter((x) => x.w === 'p1' && x.t >= l.seit).length : 0; } catch (e) { vorfaelle = 0; }
        if (!vorfaelle) { b.xp += 30; b.lp += 1; zielErfuellt('sauber'); }
        let strafe = 0;
        try { strafe = strafeMsVon(1); } catch (e) { strafe = 0; }
        if (!strafe && !fensterStrafe && l.stopps > 0) zielErfuellt('fenster');
        const start = q ? q.reihe.findIndex((x) => x.id === ich.id) + 1 : 0;
        if (start && start - pos >= 2) zielErfuellt('aufholen');
        if (pos === 1) d.trophaeen.push({ saison: d.saison, text: t('Sieg') + ' · ' + runde.ort + ' · ' + karSessionName(session, runde) });
      }
    }
    b.xp = Math.round(b.xp * (1 + 0.25 * d.stufe));
    const levelVor = karLevel(d.xp);
    d.xp += b.xp; d.credits += b.credits; d.lp += b.lp;
    b.levelUp = karLevel(d.xp) > levelVor ? karLevel(d.xp) : 0;
    if (d.lp >= 12 && d.stufe < KAR_LIZENZ.length - 1) { d.stufe++; d.lp = 0; b.aufstieg = KAR_LIZENZ[d.stufe].name; d.trophaeen.push({ saison: d.saison, text: t('Lizenz {l}').replace('{l}', t(KAR_LIZENZ[d.stufe].name)) }); }
    if (runde.sessions.every((s) => s.erledigt)) {
      d.idx++;
      if (d.idx >= d.kalender.length) karSaisonEnde(b);
    }
    karBericht = b;
    karSpeichern();
    // Nach Podium und Ergebnisschirm: die Karriereseite mit dem Bericht.
    if (!karStill) setTimeout(() => { if (raceState !== 'racing' && raceState !== 'countdown' && raceState !== 'finishing') karOeffnen(); }, 9000);
  }
  function karTabelle(feld) {
    const d = kar();
    return Object.keys(d.tabelle).map((id) => Object.assign({ id }, d.tabelle[id])).filter((x) => feld === 'pkt' || x[feld] > 0 || x.ich)
      .sort((a, b) => (b[feld] - a[feld]) || (b.siege - a.siege) || (b.podien - a.podien));
  }
  function karSaisonEnde(b) {
    const d = karD;
    d.fertig = true;
    const titel = [];
    [['pkt', 'Gesamt'], ['sprint', 'Sprint Cup'], ['endurance', 'Endurance Cup']].forEach(([feld, name]) => {
      const tab = karTabelle(feld);
      if (!tab.length || !(tab[0][feld] > 0)) return;
      const platz = tab.findIndex((x) => x.ich) + 1;
      if (platz === 1) { titel.push(t('Meister {n}').replace('{n}', t(name))); d.trophaeen.push({ saison: d.saison, text: t('Meister {n}').replace('{n}', t(name)) + ' · ' + t('Saison') + ' ' + d.saison, titel: true }); d.credits += 40000; d.xp += 300; }
      else if (platz && platz <= 3 && feld === 'pkt') { titel.push('P' + platz + ' ' + t('Gesamt')); d.credits += 15000; d.xp += 120; }
    });
    const gesamt = karTabelle('pkt').findIndex((x) => x.ich) + 1;
    if (gesamt && gesamt <= 3 && d.stufe < KAR_LIZENZ.length - 1 && !b.aufstieg) { d.stufe++; d.lp = 0; b.aufstieg = KAR_LIZENZ[d.stufe].name; d.trophaeen.push({ saison: d.saison, text: t('Lizenz {l}').replace('{l}', t(KAR_LIZENZ[d.stufe].name)) }); }
    b.saison = { titel, gesamt };
  }
  function karNeueSaison() {
    const alt = karD;
    const neu = karNeu(alt.fahrer, alt.lang, alt.minProStunde, alt.stufe, alt.saison + 1);
    Object.assign(neu, { xp: alt.xp, credits: alt.credits, lp: alt.lp, trophaeen: alt.trophaeen, upgrades: alt.upgrades || neu.upgrades });
    neu.kalender.forEach((r, i) => { if (alt.kalender[i]) { r.strecke = alt.kalender[i].strecke; r.ort = alt.kalender[i].ort; } });
    karD = neu; karBericht = null; karSpeichern();
  }

  // ---- Das Fenster ----
  function karEsc(x) { return String(x === undefined || x === null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function karZahl(x) { return Number(x || 0).toLocaleString(lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'de-DE'); }
  const karStil = document.createElement('style');
  karStil.textContent = `
    .kar-fenster .k-pause-dialog { width: min(1100px, 96vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box; }
    .kar-fenster .k-pause-dialog p.kar-p { display: block; margin: 0 0 6px; font-size: 13px; }
    .kar-fenster h2 .wip-tag, .ch-karriere .wip-tag { margin-left: 6px; font-size: 9px; vertical-align: 1px; }
    .kar-raster { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
    .kar-karte { border: 1px solid var(--border); border-top: 2px solid var(--kc, var(--k-blau, #00a3e0)); padding: 10px 12px; background: rgba(255,255,255,.02); }
    .kar-karte h3 { margin: 0 0 8px; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; }
    .kar-breit { grid-column: 1 / -1; }
    .kar-lizenz { display: inline-block; padding: 2px 8px; font-weight: 700; letter-spacing: .12em; color: #0b0c10; background: var(--kc); margin-right: 8px; }
    .kar-zahlen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0; }
    .kar-zahlen div { display: grid; } .kar-zahlen small { color: var(--muted); font-size: 11px; } .kar-zahlen b { font-size: 20px; }
    .kar-balken { display: block; height: 6px; background: rgba(255,255,255,.12); margin: 2px 0 6px; }
    .kar-balken > i { display: block; height: 100%; background: var(--k-blau, #00a3e0); }
    .kar-klein { font-size: 12px; color: var(--muted); }
    .kar-sessions { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; padding: 0; list-style: none; }
    .kar-sessions li { padding: 3px 8px; border: 1px solid var(--border); font-size: 12px; }
    .kar-sessions li.fertig { opacity: .6; } .kar-sessions li.jetzt { border-color: var(--k-blau, #00a3e0); font-weight: 700; }
    .kar-tab { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
    .kar-tab td, .kar-tab th { padding: 3px 6px; border-bottom: 1px solid var(--border); text-align: left; }
    .kar-tab tr.ich td { color: var(--k-blau, #00a3e0); font-weight: 700; }
    .kar-gut { color: var(--good); } .kar-schlecht { color: var(--bad); } .kar-jubel { color: #f5c542; font-weight: 700; }
    .kar-ziele li.fertig { color: var(--good); }
    .kar-upgrades { list-style: none; margin: 0; padding: 0; }
    .kar-upgrades li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); }
    .kar-kalender { margin: 0; padding-left: 1.4em; font-size: 13px; }
    .kar-kalender li { margin: 4px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .kar-kalender li::before { content: none; }
    .kar-kalender li > b { min-width: 3.5em; } .kar-kalender li.fertig { opacity: .6; } .kar-kalender li.jetzt { font-weight: 700; }
    .kar-fenster .k-pause-dialog .opt-row.kar-row { padding: 2px 0; border: 0; min-height: 0; background: none; box-shadow: none; width: auto; flex: 0 0 auto; display: block; }
    .kar-fenster .kar-karte button { font-size: 13px; padding: 5px 12px; min-height: 0; }
    .kar-fenster .kar-karte button.primary { font-size: 15px; padding: 8px 16px; }
    .kar-fenster .kar-karte select, .kar-fenster .kar-karte input[type=text] { font-size: 13px; padding: 4px 6px; }
    .kar-tab th { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; color: var(--muted); }
    .kar-fenster .opt-row.menu-nav-sel { outline: 2px solid #fff; outline-offset: 2px; }
    .kar-fenster .kar-knopfreihe { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .kar-fenster button.an { background: var(--k-blau, #00a3e0); color: var(--k-blau-text, #04070c); }
    .kar-fenster input[type=text] { max-width: 16em; }
  `;
  document.head.appendChild(karStil);
  const karFensterEl = document.createElement('div');
  karFensterEl.className = 'k-pause kar-fenster';
  karFensterEl.id = 'kar-fenster';
  karFensterEl.hidden = true;
  karFensterEl.setAttribute('data-i18n-skip', '');
  karFensterEl.setAttribute('role', 'dialog');
  karFensterEl.setAttribute('aria-modal', 'true');
  karFensterEl.innerHTML = '<div class="k-pause-dialog" id="kar-dialog"></div>';
  document.body.appendChild(karFensterEl);
  karFensterEl.addEventListener('click', (e) => { if (e.target === karFensterEl) karSchliessen(); });

  function karFensterOffen() { const f = document.getElementById('kar-fenster'); return !!(f && !f.hidden); }
  function karOeffnen() {
    karFensterEl.hidden = false;
    karZeichnen();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavIndex = 0; menuNavGezeigt = true; menuNavArmed = false; menuNavRender(); }
    return true;
  }
  function karSchliessen() {
    if (karFensterEl.hidden) return false;
    karFensterEl.hidden = true;
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavRender(); }
    return true;
  }
  const karRow = (inhalt) => '<div class="opt-row kar-row">' + inhalt + '</div>';
  function karBerichtHtml(b) {
    let h = '<section class="kar-karte kar-breit"><h3>' + karEsc(t('Ergebnis')) + ' · ' + karEsc(b.titel) + '</h3><table class="kar-tab"><tbody>'
      + b.zeilen.slice(0, 12).map((z) => '<tr' + (z.ich ? ' class="ich"' : '') + '><td>P' + z.pos + '</td><td>' + karEsc(z.name) + '</td><td>' + karEsc(z.wert) + '</td><td>'
        + (z.pkt !== '' ? karEsc(z.pkt) + ' ' + karEsc(t('Pkt.')) : '') + '</td></tr>').join('') + '</tbody></table>'
      + '<div class="kar-zahlen"><div><small>XP</small><b>+' + b.xp + '</b></div><div><small>' + karEsc(t('Preisgeld')) + '</small><b>+' + karZahl(b.credits) + '</b></div><div><small>'
      + karEsc(t('Lizenzpunkte')) + '</small><b>+' + b.lp + '</b></div></div>';
    if (b.levelUp) h += '<p class="kar-p kar-jubel">' + karEsc(t('Fahrerstufe {n}!').replace('{n}', b.levelUp)) + '</p>';
    if (b.aufstieg) h += '<p class="kar-p kar-jubel">' + karEsc(t('Aufgestiegen: Lizenz {l}').replace('{l}', t(b.aufstieg))) + '</p>';
    if (b.fensterStrafe) h += '<p class="kar-p kar-schlecht">' + karEsc(t('Kein Stopp im Boxenfenster: +30 s.')) + '</p>';
    b.ziele.forEach((z) => { h += '<p class="kar-p kar-gut">✓ ' + karEsc(t('Sponsorziel')) + ': ' + karEsc(t(KAR_ZIELE[z])) + ' (+' + karZahl(KAR_ZIEL_GELD) + ')</p>'; });
    if (b.saison) h += '<p class="kar-p kar-jubel">' + karEsc(t('Saison beendet')) + (b.saison.titel.length ? ': ' + karEsc(b.saison.titel.join(', ')) : b.saison.gesamt ? ': P' + b.saison.gesamt + ' ' + karEsc(t('Gesamt')) : '') + '</p>';
    return h + '</section>';
  }
  function karZeichnen() {
    const dlg = $('kar-dialog');
    if (!dlg) return;
    const d = kar();
    const scroll = dlg.scrollTop;
    const format = '<section class="kar-karte"><h3>' + karEsc(t('Das Format')) + '</h3><p class="kar-p kar-klein">'
      + karEsc(t('Sprint-Runde: Qualifying 1, Rennen 1, Qualifying 2, Rennen 2, je Rennen ein Pflichtstopp im Boxenfenster (Minute 25 bis 35 von 60). Endurance-Runde: Qualifying und ein Rennen über 3 Stunden (auch 6 und 24), höchstens 65 Minuten je Stint. Fliegender Start, ein Punkt für die Pole, drei Titel. Lizenzen Bronze, Silber, Gold, Pro: 12 Lizenzpunkte oder eine Saison unter den ersten drei bringen den Aufstieg, und das Feld wird schneller.'))
      + '</p></section>';
    let h = '<h2>' + karEsc(t('Karriere')) + (d ? ' · ' + karEsc(t('Saison')) + ' ' + d.saison : '') + ' <span class="wip-tag">WIP</span></h2>';
    if (!d) {
      h += '<p class="kar-p muted">' + karEsc(t('Eine Saison im Format der GT World Challenge auf deinen eigenen Strecken. Du beginnst mit Bronze und fährst dich zur Pro-Lizenz.')) + '</p>'
        + '<div class="kar-raster"><section class="kar-karte"><h3>' + karEsc(t('Neue Karriere')) + '</h3>'
        + karRow('<label>' + karEsc(t('Name')) + ' <input type="text" id="kar-name" maxlength="24" autocomplete="off" data-preset-skip></label>')
        + '<p class="kar-p kar-klein">' + karEsc(t('Saison')) + '</p><div class="kar-knopfreihe" id="kar-lang">'
        + karRow('<button type="button" data-w="kurz" class="an">' + karEsc(t('Kurz · 4 Runden')) + '</button>') + karRow('<button type="button" data-w="voll">' + karEsc(t('Voll · 10 Runden')) + '</button>') + '</div>'
        + '<p class="kar-p kar-klein">' + karEsc(t('Echte Minuten je Rennstunde')) + '</p><div class="kar-knopfreihe" id="kar-min">'
        + [4, 6, 10, 15].map((m) => karRow('<button type="button" data-w="' + m + '"' + (m === 6 ? ' class="an"' : '') + '>' + m + ' min</button>')).join('') + '</div>'
        + '<div class="kar-knopfreihe">' + karRow('<button type="button" class="primary" id="kar-los">' + karEsc(t('Karriere starten')) + '</button>') + '</div></section>'
        + format + '</div>';
    } else {
      if (karBericht) h += '<div class="kar-raster">' + karBerichtHtml(karBericht) + '</div>';
      const liz = KAR_LIZENZ[d.stufe], level = karLevel(d.xp), xp0 = karLevelXp(level), xp1 = karLevelXp(level + 1);
      h += '<div class="kar-raster"><section class="kar-karte" style="--kc:' + liz.farbe + '"><h3><span class="kar-lizenz">' + karEsc(t(liz.name)).toUpperCase() + '</span>' + karEsc(d.fahrer) + '</h3>'
        + '<p class="kar-p kar-klein">' + karEsc(t(liz.text)) + '</p>'
        + '<div class="kar-zahlen"><div><small>' + karEsc(t('Fahrerstufe')) + '</small><b>' + level + '</b></div><div><small>' + karEsc(t('Preisgeld')) + '</small><b>' + karZahl(d.credits) + '</b></div><div><small>'
        + karEsc(t('Trophäen')) + '</small><b>' + d.trophaeen.length + '</b></div></div>'
        + '<span class="kar-klein">XP ' + d.xp + ' / ' + xp1 + '</span><span class="kar-balken"><i style="width:' + Math.round((d.xp - xp0) / Math.max(1, xp1 - xp0) * 100) + '%"></i></span>'
        + (d.stufe < KAR_LIZENZ.length - 1 ? '<span class="kar-klein">' + karEsc(t('Lizenzpunkte {p} von 12 bis {l}').replace('{p}', d.lp).replace('{l}', t(KAR_LIZENZ[d.stufe + 1].name)))
          + '</span><span class="kar-balken"><i style="width:' + Math.round(Math.min(1, d.lp / 12) * 100) + '%;background:' + KAR_LIZENZ[d.stufe + 1].farbe + '"></i></span>' : '<p class="kar-p kar-klein">' + karEsc(t('Höchste Lizenz erreicht.')) + '</p>')
        + '</section>';
      const n = karNaechste();
      if (n) {
        const { runde, session, si } = n;
        const minuten = karMinuten(runde, session), stopps = session.art === 'rennen' ? karStopps(runde) : 0;
        let autos = 0;
        try { autos = garage.filter((c) => c.device && !c.sim && c.role !== 'none' && c.role !== 'safetycar' && c.role !== 'reinig').length; } catch (e) { autos = 0; }
        const strecken = karStrecken();
        h += '<section class="kar-karte"><h3>' + karEsc(t('Runde {i} von {n}').replace('{i}', d.idx + 1).replace('{n}', d.kalender.length)) + ' · ' + (runde.typ === 'sprint' ? 'Sprint Cup' : 'Endurance Cup') + '</h3>'
          + '<p class="kar-p"><b>' + karEsc(runde.ort) + '</b></p><ol class="kar-sessions">'
          + runde.sessions.map((s, i) => '<li class="' + (s.erledigt ? 'fertig' : i === si ? 'jetzt' : '') + '">' + karEsc(karSessionName(s, runde)) + ' · '
            + (s.erledigt && s.reihe ? (() => { const p = s.reihe.findIndex((x) => d.tabelle[x.id] && d.tabelle[x.id].ich) + 1; return p ? 'P' + p : '✓'; })() : karMinuten(runde, s) + ' min') + '</li>').join('') + '</ol>'
          + karRow('<label>' + karEsc(t('Strecke dieser Runde')) + ' <select id="kar-strecke" data-preset-skip><option value="aktuell"' + (runde.strecke === 'aktuell' ? ' selected' : '') + '>' + karEsc(t('Strecke im Editor')) + '</option>'
            + strecken.map((s) => '<option value="' + karEsc(s) + '"' + (runde.strecke === s ? ' selected' : '') + '>' + karEsc(s) + '</option>').join('') + '</select></label>')
          + '<p class="kar-p kar-klein">' + karEsc(karSessionName(session, runde)) + ': ' + minuten + ' min'
          + (session.art === 'rennen' ? ' · ' + karEsc(t('fliegender Start')) + ' · ' + karEsc(t('{n} Pflichtstopp(s)').replace('{n}', stopps))
            + (runde.typ === 'sprint' ? ' ' + karEsc(t('im Boxenfenster ({a} bis {b} min)').replace('{a}', Math.round(minuten * 25 / 6) / 10).replace('{b}', Math.round(minuten * 35 / 6) / 10)) : '')
            + (runde.wetter === 'wechsel' ? ' · ' + karEsc(t('wechselhaftes Wetter')) : '') : ' · ' + karEsc(t('die schnellste Runde bestimmt die Startreihe'))) + '</p>'
          + (autos < 2 ? '<p class="kar-p kar-schlecht">' + karEsc(t('Mindestens zwei Autos verbinden (die anderen als NPC): ein Feld aus einem Auto lässt sich nicht werten.')) + '</p>' : '')
          + '<div class="kar-knopfreihe">' + karRow('<button type="button" class="primary" id="kar-start">' + karEsc(t('{s} starten').replace('{s}', karSessionName(session, runde))) + '</button>') + '</div></section>';
        h += '<section class="kar-karte"><h3>' + karEsc(t('Sponsorziele dieser Runde')) + '</h3><ul class="kar-ziele">'
          + runde.ziele.map((z) => '<li class="' + (z.erfuellt ? 'fertig' : '') + '">' + (z.erfuellt ? '✓ ' : '') + karEsc(t(KAR_ZIELE[z.id])) + ' <span class="kar-klein">+' + karZahl(KAR_ZIEL_GELD) + ' · +' + KAR_ZIEL_XP + ' XP</span></li>').join('') + '</ul></section>';
      } else {
        h += '<section class="kar-karte"><h3>' + karEsc(t('Saison beendet')) + '</h3><p class="kar-p">' + karEsc(t('Alle Runden sind gefahren. Die nächste Saison startet mit einem schnelleren Feld.')) + '</p>'
          + '<div class="kar-knopfreihe">' + karRow('<button type="button" class="primary" id="kar-saison">' + karEsc(t('Saison {n} starten').replace('{n}', d.saison + 1)) + '</button>') + '</div></section>';
      }
      const ans = [['pkt', 'Gesamt'], ['sprint', 'Sprint Cup'], ['endurance', 'Endurance Cup']];
      const aktiv = ans.find((a) => a[0] === karAnsicht) || ans[0];
      const tab = karTabelle(aktiv[0]);
      h += '<section class="kar-karte"><h3>' + karEsc(t('Wertung')) + '</h3><div class="kar-knopfreihe">'
        + ans.map((a) => karRow('<button type="button" data-kar-stand="' + a[0] + '"' + (a === aktiv ? ' class="an"' : '') + '>' + karEsc(t(a[1])) + '</button>')).join('') + '</div>'
        + (tab.length ? '<table class="kar-tab"><thead><tr><th></th><th>' + karEsc(t('Fahrer')) + '</th><th>' + karEsc(t('Siege')) + '</th><th>' + karEsc(t('Podien')) + '</th><th>' + karEsc(t('Punkte')) + '</th></tr></thead><tbody>'
          + tab.map((x, i) => '<tr' + (x.ich ? ' class="ich"' : '') + '><td>' + (i + 1) + '</td><td><span style="color:' + karEsc(x.farbe || '#888') + '">●</span> ' + karEsc(x.name) + '</td><td>' + x.siege + '</td><td>' + x.podien + '</td><td><b>' + x[aktiv[0]] + '</b></td></tr>').join('') + '</tbody></table>'
          : '<p class="kar-p kar-klein">' + karEsc(t('Noch keine Punkte: das erste Rennen füllt die Tabelle.')) + '</p>') + '</section>';
      const strecken = karStrecken();
      h += '<section class="kar-karte"><h3>' + karEsc(t('Kalender')) + '</h3><ol class="kar-kalender">' + d.kalender.map((r, i) => {
        const letzte = r.sessions.filter((s) => s.art === 'rennen' && s.reihe && s.reihe.length).pop();
        const typ = '<b>' + (r.typ === 'sprint' ? 'Sprint' : r.stunden === 24 ? '24 h' : r.stunden + ' h') + '</b>';
        if (i < d.idx || d.fertig) return '<li class="fertig">' + typ + ' · ' + karEsc(r.ort) + (letzte ? ' · ' + karEsc(t('Sieger')) + ': ' + karEsc(letzte.reihe[0].name) : '') + '</li>';
        return '<li class="' + (i === d.idx ? 'jetzt' : '') + '">' + typ + karRow('<input type="text" data-kar-ort="' + i + '" value="' + karEsc(r.ort) + '" maxlength="28" data-preset-skip aria-label="' + karEsc(t('Name der Runde')) + '">')
          + karRow('<select data-kar-rs="' + i + '" data-preset-skip aria-label="' + karEsc(t('Strecke dieser Runde')) + '"><option value="aktuell"' + (r.strecke === 'aktuell' ? ' selected' : '') + '>' + karEsc(t('Strecke im Editor')) + '</option>'
            + strecken.map((s) => '<option value="' + karEsc(s) + '"' + (r.strecke === s ? ' selected' : '') + '>' + karEsc(s) + '</option>').join('') + '</select>')
          + (i > d.idx ? karRow('<button type="button" data-kar-rtyp="' + i + '">' + karEsc(t('Sprint/Endurance tauschen')) + '</button>') : '') + '</li>';
      }).join('') + '</ol></section>';
      if (!d.upgrades) d.upgrades = { crew: 0, sprit: 0, reifen: 0 };
      h += '<section class="kar-karte"><h3>' + karEsc(t('Team-Upgrades')) + '</h3><ul class="kar-upgrades">' + KAR_UPGRADES.map((u) => {
        const lv = d.upgrades[u.id] || 0, preis = KAR_UPGRADE_PREIS[lv];
        return '<li><div><b>' + karEsc(t(u.name)) + '</b> <span class="kar-klein">' + '●'.repeat(lv) + '○'.repeat(3 - lv) + '</span><br><span class="kar-klein">' + karEsc(t(u.text)) + '</span></div>'
          + (lv >= 3 ? '<span class="kar-klein">' + karEsc(t('Ausgebaut')) + '</span>'
            : karRow('<button type="button" data-kar-kauf="' + u.id + '"' + (d.credits < preis ? ' disabled' : '') + '>' + karZahl(preis) + '</button>')) + '</li>';
      }).join('') + '</ul><p class="kar-p kar-klein">' + karEsc(t('Wirkt auf dein Auto in Karriere-Sitzungen.')) + '</p></section>';
      h += '<section class="kar-karte"><h3>' + karEsc(t('Trophäen')) + '</h3>' + (d.trophaeen.length ? '<ul>' + d.trophaeen.slice().reverse().map((x) => '<li' + (x.titel ? ' class="kar-jubel"' : '') + '>🏆 ' + karEsc(x.text) + '</li>').join('') + '</ul>'
        : '<p class="kar-p kar-klein">' + karEsc(t('Siege, Lizenzen und Titel kommen hierher.')) + '</p>') + '</section>' + format
        + '<section class="kar-karte"><h3>' + karEsc(t('Karriere-Datei')) + '</h3><p class="kar-p kar-klein">' + karEsc(t('{m} min je Rennstunde.').replace('{m}', d.minProStunde)) + ' '
        + '</p><div class="kar-knopfreihe">' + karRow('<button type="button" id="kar-ende">' + karEsc(t('Diese Karriere löschen')) + '</button>') + '</div></section></div>';
    }
    h += '<div class="kar-knopfreihe">' + karRow('<button type="button" id="kar-zu">' + karEsc(t('Schließen')) + '</button>') + '</div>';
    dlg.innerHTML = h;
    const q = (s) => dlg.querySelector(s);
    const klick = (el, fn) => { if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); };
    klick(q('#kar-zu'), karSchliessen);
    if (!d) {
      ['#kar-lang', '#kar-min'].forEach((id) => dlg.querySelectorAll(id + ' button').forEach((b) => klick(b, () => dlg.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('an', x === b)))));
      klick(q('#kar-los'), () => {
        karD = karNeu(q('#kar-name').value.trim(), q('#kar-lang button.an').dataset.w, Number(q('#kar-min button.an').dataset.w), 0, 1);
        karBericht = null; karSpeichern(); karZeichnen();
      });
    } else {
      const n = karNaechste();
      klick(q('#kar-start'), () => { karBericht = null; karStarten(); });
      if (q('#kar-strecke')) q('#kar-strecke').addEventListener('change', (e) => { n.runde.strecke = e.target.value; karSpeichern(); karZeichnen(); });
      klick(q('#kar-saison'), () => { karNeueSaison(); karZeichnen(); });
      dlg.querySelectorAll('[data-kar-stand]').forEach((b) => klick(b, () => { karAnsicht = b.dataset.karStand; karZeichnen(); }));
      dlg.querySelectorAll('[data-kar-ort]').forEach((el) => el.addEventListener('change', () => { d.kalender[Number(el.dataset.karOrt)].ort = el.value.trim() || t('Runde'); karSpeichern(); }));
      dlg.querySelectorAll('[data-kar-rs]').forEach((el) => el.addEventListener('change', () => { d.kalender[Number(el.dataset.karRs)].strecke = el.value; karSpeichern(); karZeichnen(); }));
      dlg.querySelectorAll('[data-kar-rtyp]').forEach((b) => klick(b, () => {
        const i = Number(b.dataset.karRtyp), alt = d.kalender[i];
        const neu = karRunde(alt.typ === 'sprint' ? 'endurance' : 'sprint', alt.typ === 'sprint' ? 3 : 1, i);
        neu.ort = alt.ort; neu.strecke = alt.strecke; d.kalender[i] = neu; karSpeichern(); karZeichnen();
      }));
      dlg.querySelectorAll('[data-kar-kauf]').forEach((b) => klick(b, () => {
        const id = b.dataset.karKauf, lv = d.upgrades[id] || 0, preis = KAR_UPGRADE_PREIS[lv];
        if (lv >= 3 || d.credits < preis) return;
        d.credits -= preis; d.upgrades[id] = lv + 1; karSpeichern(); showHudToast(t('Upgrade gekauft')); karZeichnen();
      }));
      klick(q('#kar-ende'), (e) => {
        if (e.target.dataset.arm !== '1') { e.target.dataset.arm = '1'; e.target.textContent = t('Zum Löschen noch einmal tippen'); return; }
        karD = false; karBericht = null; karSpeichern(); karZeichnen();
      });
    }
    dlg.scrollTop = scroll;
  }
  if ($('ch-karriere')) $('ch-karriere').addEventListener('click', karOeffnen);
  i18nOnLangChange(() => { if (karFensterOffen()) karZeichnen(); });

  // ---- Selbsttests ----
  stAdd('Karriere v1.5: neue Karriere, Kalender, Wertung eines Sprint-Rennens mit Boxenfenster, Punkte und Lizenz', () => {
    const f = [];
    let roh = null;
    try { roh = localStorage.getItem(KARRIERE_STORE); } catch (e) { roh = null; }
    const merk = { d: karD, b: karBericht };
    karStill = true;
    try {
      karD = karNeu('Probe', 'kurz', 6, 0, 1);
      if (karD.kalender.length !== 4 || karD.kalender[0].sessions.length !== 4 || karD.kalender[1].sessions.length !== 2) f.push('Kalender kurz');
      if (karNeu('P', 'voll', 6).kalender.length !== 10) f.push('Kalender voll');
      if (karMinuten(karD.kalender[0], { art: 'rennen' }) !== 6 || karMinuten(karD.kalender[1], { art: 'rennen' }) !== 18 || karMinuten(karD.kalender[0], { art: 'quali' }) !== 2) f.push('Minuten');
      if (karStopps(karD.kalender[0]) !== 1 || karStopps(karD.kalender[1]) !== 2 || karStopps({ typ: 'endurance', stunden: 24 }) !== 3) f.push('Pflichtstopps');
      if (karriereKlasse() !== 1) f.push('Klasse ohne laufende Sitzung ' + karriereKlasse());
      // Qualifying 1: Spieler auf Pole.
      karD.kalender[0].ziele = [{ id: 'pole', erfuellt: false }, { id: 'podium', erfuellt: false }];
      karD.laeuft = { idx: 0, si: 0, art: 'quali', modus: 'qualifying', seit: Date.now(), minuten: 2, stopps: 0, fensterVon: null, fensterBis: null, stunden: 1, stoppsBei: [], pitVor: 0, zwischen: [], zwischenDone: 0 };
      if (karriereKlasse() !== KAR_LIZENZ[0].ki) f.push('Klasse Bronze ' + karriereKlasse());
      const feld = (a, b, c) => [
        { id: 'ich', name: 'Ich', rolle: 'player', laps: a[0], total: a[1], beste: a[2], raus: false },
        { id: 'n1', name: 'NPC 1', rolle: 'ghost', laps: b[0], total: b[1], beste: b[2], raus: false },
        { id: 'n2', name: 'NPC 2', rolle: 'ghost', laps: c[0], total: c[1], beste: c[2], raus: false }];
      karWerten(feld([3, 24000, 7900], [3, 24300, 8000], [3, 25000, 8200]).sort((x, y) => x.beste - y.beste));
      if (!karD.kalender[0].sessions[0].erledigt || karD.kalender[0].sessions[0].reihe[0].id !== 'ich') f.push('Quali-Reihe');
      if (!karD.kalender[0].ziele[0].erfuellt) f.push('Ziel Pole nicht erfuellt');
      // Rennen 1: Spieler faehrt als Erster ins Ziel, verpasst aber das Boxenfenster (+30 s) und faellt hinter NPC 1.
      karD.laeuft = { idx: 0, si: 1, art: 'rennen', modus: 'endurance', seit: Date.now(), minuten: 6, stopps: 1, fensterVon: 25 / 60, fensterBis: 35 / 60, stunden: 1, stoppsBei: [0.1], pitVor: 1, zwischen: [], zwischenDone: 0 };
      karWerten(feld([10, 60000, 5800], [10, 70000, 5900], [9, 61000, 6000]));
      const tab = karTabelle('pkt');
      if (tab[0].id !== 'n1' || tab[0].pkt !== 16.5) f.push('Sieger nach Strafe: ' + tab[0].id + ' ' + tab[0].pkt);
      const ich = karD.tabelle.ich;
      if (!ich || ich.pkt !== 12 + 1) f.push('Punkte Spieler ' + (ich && ich.pkt) + ' statt 12 + 1 fuer die Pole');
      if (!karBericht || !karBericht.fensterStrafe) f.push('Boxenfenster-Strafe fehlt im Bericht');
      if (!(karD.xp > 0 && karD.credits >= 9000)) f.push('XP/Geld ' + karD.xp + '/' + karD.credits);
      if (karD.idx !== 0) f.push('Runde zu frueh weiter');
      // Aufstieg ab 12 Lizenzpunkten.
      karD.lp = 11;
      karD.laeuft = { idx: 0, si: 2, art: 'quali', modus: 'qualifying', seit: Date.now(), minuten: 2, stopps: 0, fensterVon: null, fensterBis: null, stunden: 1, stoppsBei: [], pitVor: 0, zwischen: [], zwischenDone: 0 };
      karWerten(feld([3, 24000, 7900], [3, 24300, 8000], [3, 25000, 8200]));
      karD.laeuft = { idx: 0, si: 3, art: 'rennen', modus: 'endurance', seit: Date.now(), minuten: 6, stopps: 1, fensterVon: 25 / 60, fensterBis: 35 / 60, stunden: 1, stoppsBei: [0.5], pitVor: 1, zwischen: [], zwischenDone: 0 };
      karWerten(feld([11, 60000, 5800], [10, 70000, 5900], [9, 61000, 6000]));
      if (karD.stufe !== 1) f.push('kein Aufstieg nach Sieg mit 11 Lizenzpunkten (Stufe ' + karD.stufe + ')');
      if (karD.idx !== 1) f.push('nach vier Sitzungen nicht in Runde 2');
      // Upgrades: Kauf kostet, Faktor nur in einer laufenden Sitzung.
      karD.credits = 20000; karD.upgrades = { crew: 0, sprit: 0, reifen: 0 };
      karOeffnen();
      const kauf = $('kar-dialog').querySelector('[data-kar-kauf="sprit"]');
      if (!kauf) f.push('kein Kaufknopf');
      else { kauf.click(); if (karD.upgrades.sprit !== 1 || karD.credits !== 5000) f.push('Kauf: Stufe ' + karD.upgrades.sprit + ', Geld ' + karD.credits); }
      if (karriereUpgrade('sprit') !== 1) f.push('Upgrade wirkt ohne Sitzung');
      karD.laeuft = { idx: 1, si: 0, art: 'quali', modus: 'qualifying', seit: Date.now(), minuten: 2, stopps: 0, fensterVon: null, fensterBis: null, stunden: 3, stoppsBei: [], pitVor: 0, zwischen: [], zwischenDone: 0 };
      if (Math.abs(karriereUpgrade('sprit') - 0.96) > 1e-9 || karriereUpgrade('crew') !== 1) f.push('Faktoren ' + karriereUpgrade('sprit') + '/' + karriereUpgrade('crew'));
      karD.laeuft = null;
      karSchliessen();
      // Fenster und Knopf.
      karSpeichern();
      karOeffnen();
      if (!karFensterOffen() || !$('kar-start')) f.push('Fenster ohne Startknopf');
      if (typeof menuNavContainer === 'function' && menuNavContainer() !== $('kar-fenster')) f.push('Steuerkreuz nicht im Fenster');
      if (typeof konsoleZurueck === 'function' && (!konsoleZurueck() || karFensterOffen())) f.push('Kreis schliesst nicht');
      if (!$('ch-karriere') || !$('ch-karriere').querySelector('.wip-tag')) f.push('Knopf unter Challenges fehlt oder ohne WIP');
    } catch (e) { f.push('Fehler: ' + e.message); }
    finally {
      karFensterEl.hidden = true;
      karStill = false;
      karD = merk.d; karBericht = merk.b;
      try { if (roh === null) localStorage.removeItem(KARRIERE_STORE); else localStorage.setItem(KARRIERE_STORE, roh); } catch (e) { /* privat */ }
    }
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'Kalender 4/10, Minuten und Stopps, Pole + Boxenfenster-Strafe, 12 + 1 Punkte, Aufstieg auf Silber, Runde 2, Upgrade-Kauf und Faktor 0,96 nur in der Sitzung, Fenster und Knopf' };
  });
