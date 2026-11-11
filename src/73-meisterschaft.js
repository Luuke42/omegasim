  // ============================== MEISTERSCHAFT (v1.0, experimentell) ==============================
  //
  // BESTELLT: "Wie bei Garage, nur dass jede Zeile ein Rennen ist. Ich kann aus meinen geladenen
  // Strecken aber auch freies Fahren waehlen, standardmaessig ist immer das, was aktuell gerade
  // im Streckeneditor ist, gewaehlt. Je Event waehle ich dann das Format, Wetter, und Umfang
  // [...] Je Rennen ausserdem Startaufstellung, Pflichtboxenstopps, fliegender oder stehender
  // Start waehlen. Globale Optionen unten drunter: Presets [...], Startaufstellung [...]."
  // Abgesegnet als mockup/meisterschaft.html ("sieht wundervoll aus. Bitte so einbauen").
  // Dazu: "Wenn moeglich, Meisterschaft auch fuer Multiplayer funktionsfaehig machen (Host ist
  // Meisterschaftsleiter)."
  //
  // KEIN EIGENES RENNEN. Ein Event setzt nur die Renneinstellungen, die es schon gibt (Modus,
  // Laenge, Wetter, fliegender Start, Pflichtstopps, Strecke, Startaufstellung), und startet
  // dann den normalen Ablauf: Startaufstellung, Ampel, Rennen, Zielflagge. finishRace() ruft
  // meisterRennenEnde(), und erst wenn alle im Ziel sind, wird gewertet.
  //
  // MEHRSPIELER: Das Telefon, das die Meisterschaft plant, ist der Leiter. Es startet jedes
  // Event "fuer alle" (mpRennenFuerAlle); der Plan traegt Strecke und Zwischenstand mit, die
  // anderen Telefone zeigen ihn auf dem Bereitschaftsschirm. Gewertet wird nur beim Leiter: die
  // Menschen aus der Rangliste des Hosts (ihre Reihenfolge IST der Zieleinlauf, der Host sortiert
  // nach Runden und dem Zeitpunkt der letzten Runde), die eigenen Ghosts und Spieler 2/3 aus
  // raceAllCars(). Wo beide Listen dieselbe Rundenzahl haben, entscheidet das eigene Auto als
  // Anker: wer lokal schneller war als es, steht vor ihm.
  const MEISTER_STORE = 'omegasim-meisterschaft';
  const MEISTER_MAX_EVENTS = 10;
  const MEISTER_FORMATE = [
    { id: 'training', modus: 'practice', name: 'Training', einheit: 'Min', punkte: false },
    { id: 'qualifying', modus: 'qualifying', name: 'Qualifying', einheit: 'Min', punkte: false },
    { id: 'runden', modus: 'laps', name: 'Runden', einheit: 'Runden', punkte: true },
    { id: 'endurance', modus: 'endurance', name: 'Endurance', einheit: 'Min', punkte: true },
  ];
  const MEISTER_WETTER = [['dry', 'Sonnig'], ['rain', 'Regen'], ['wechsel', 'Wechselhaft']];
  const MEISTER_START = [['stehend', 'Stehend'], ['fliegend', 'Fliegend']];
  const MEISTER_AUFST = [['auto', 'Automatisch'], ['punkte_hinten', 'Nach Punkten · Führender hinten'],
    ['punkte_vorn', 'Nach Punkten · Führender vorn'], ['quali', 'Nach letztem Qualifying'],
    ['letztes', 'Wie letztes Ergebnis'], ['zufall', 'Zufall']];
  const MEISTER_GLOBAL = [
    { id: 'fahrgefuehl', l: 'Fahrgefühl', w: [['garage', 'Wie in der Garage'], ['p1', 'Alle wie Spieler 1'],
      ['arcade', 'Alle: Arcade'], ['simplus', 'Alle: Sim+'], ['pro', 'Alle: Pro'], ['propacejka', 'Alle: Pacejka'], ['gran', 'Alle: Gran Hybrismo (WIP)'], ['acc', 'Alle: Assetto Carrera (WIP)'], ['omega', 'Alle: Omega'], ['rc', 'Alle: RC (WIP)']] },
    { id: 'start1', l: 'Startaufstellung 1. Event', w: [['zufall', 'Zufall'], ['beste_zuletzt', 'Beste zuletzt'],
      ['beste_zuerst', 'Beste zuerst'], ['garage', 'Garagen-Reihenfolge']] },
    { id: 'punkte', l: 'Punkte', w: [['f1', 'F1 · 25-18-15-12-10'], ['klassisch', 'Klassisch · 10-6-4-3-2'],
      ['linear', 'Linear · N … 1']] },
    { id: 'fl', l: 'Schnellste Runde', w: [['ja', '+1 Punkt'], ['nein', 'Keine Punkte']] },
    { id: 'teilnehmer', l: 'Teilnehmer', w: [['alle', 'Alle verbundenen Autos'], ['spieler', 'Nur Spieler (P1–P3)']] },
    // v1.4.33 BESTELLT: Erfolgsballast wie frueher in der DTM (siehe ERFOLGSBALLAST weiter unten). WIP, Vorgabe aus.
    // Die Erklaerung steht nur hinter dem i im Kreis (info), nicht unter der Zeile.
    { id: 'ballast', l: 'Erfolgsballast', wip: true,
      info: 'Wie früher die Erfolgsgewichte der DTM: Vor jedem Event bekommt, wer mehr Punkte hat, mehr Gewicht ins Auto. Der Führende trägt das Höchstgewicht der Stufe, der Letzte nichts, dazwischen linear nach dem Punkteabstand; das erste Event fährt ohne. Spielerautos werden in der Fahrphysik schwerer (träger beim Beschleunigen und Bremsen, nicht im Fahrgefühl RC), NPCs fahren entsprechend langsamer; 50 kg kosten im Mittel etwa 2 % Rundenzeit. Nach dem Event und außerhalb der Meisterschaft fährt jeder ohne. Im Mehrspieler bestimmt der Meisterschaftsleiter.',
      w: [['aus', 'Aus'], ['leicht', 'Leicht · bis 30 kg'], ['mittel', 'Mittel · bis 50 kg'], ['stark', 'Stark · bis 80 kg']] },
  ];
  const MEISTER_PUNKTE = { f1: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], klassisch: [10, 6, 4, 3, 2, 1] };
  const MEISTER_FARBEN = ['#2ee06a', '#ffb02e', '#00a3e0', '#e84bb0', '#9c8cff', '#ff6b4a'];

  function meisterEventNeu() {
    return { strecke: 'aktuell', format: 'runden', umfang: 15, wetter: 'dry', start: 'stehend', aufst: 'auto', stopps: 0 };
  }
  function meisterPlanVorgabe() {
    return {
      // v1.0.15 BESTELLT: "Meisterschaft standard: nicht 3 Events, sondern Qualifying und Runden."
      events: [
        Object.assign(meisterEventNeu(), { format: 'qualifying', umfang: 5 }),
        meisterEventNeu(),
      ],
      global: { fahrgefuehl: 'garage', start1: 'zufall', punkte: 'f1', fl: 'ja', teilnehmer: 'alle', ballast: 'aus' },
    };
  }
  function meisterLesen() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(MEISTER_STORE) || 'null'); } catch (e) { d = null; }
    if (!d || !d.plan || !Array.isArray(d.plan.events) || !d.plan.events.length) d = { plan: meisterPlanVorgabe(), lauf: null };
    d.plan.global = Object.assign(meisterPlanVorgabe().global, d.plan.global || {});
    return d;
  }
  let meister = meisterLesen();
  setTimeout(() => { try { meisterKachelText(); } catch (e) { /* ohne Kachel */ } }, 0);
  function meisterSpeichern() {
    try { localStorage.setItem(MEISTER_STORE, JSON.stringify(meister)); } catch (e) { /* privat */ }
    meisterKachelText();
  }
  // Die FAHREN-Kachel sagt, ob eine Meisterschaft pausiert ist und wo es weitergeht.
  function meisterKachelText() {
    const k = $('fa-profil');
    const kt = k ? k.querySelector('.k-kt') : null;
    if (!kt) return;
    const l = meister && meister.lauf;
    const txt = l && !l.fertig
      ? t('Fortsetzen: Event') + ' ' + (l.idx + 1) + '/' + meister.plan.events.length
      : t('Meisterschaft erstellen');
    if (kt.textContent !== txt) kt.textContent = txt;
  }

  function meisterFormat(ev) { return MEISTER_FORMATE.find((f) => f.id === ev.format) || MEISTER_FORMATE[2]; }
  function meisterIstRennen(ev) { return meisterFormat(ev).punkte; }
  function meisterGlobalWert(id) {
    const g = MEISTER_GLOBAL.find((x) => x.id === id);
    const v = meister.plan.global[id];
    return g.w.some((w) => w[0] === v) ? v : g.w[0][0];
  }
  function meisterName(liste, id) { const x = liste.find((w) => w[0] === id); return t(x ? x[1] : liste[0][1]); }
  function meisterGespeicherte() {
    let s = {};
    try { s = typeof loadTrackStore === 'function' ? loadTrackStore() : {}; } catch (e) { s = {}; }
    return Object.keys(s).sort((a, b) => a.localeCompare(b));
  }
  function meisterStrecken() { return ['aktuell'].concat(meisterGespeicherte(), ['frei']); }
  function meisterStreckeName(s) {
    if (s === 'aktuell') return t('Aktuell im Editor');
    if (s === 'frei') return t('Freie Bahn');
    return s;
  }

  // ---- WERTUNG (rein, ohne DOM: der Selbsttest ruft sie direkt) ------------------------------
  // feld: [{ key, laps, total, beste }] in beliebiger Reihenfolge. Gewertet wird, wer eine Runde
  // hat; Qualifying nach bester Runde, sonst mehr Runden, dann kuerzere Gesamtzeit (wie
  // renderRaceResults). Rueckgabe: die gewerteten Keys in Zielreihenfolge.
  function meisterKlassieren(feld, quali) {
    return feld.filter((x) => x.laps > 0).slice().sort((a, b) => (quali
      ? (a.beste - b.beste)
      : ((b.laps - a.laps) || (a.total - b.total)))).map((x) => x.key);
  }
  function meisterPunkteFuer(schema, platz, anzahl) {
    if (schema === 'linear') return Math.max(0, anzahl - platz);
    const tab = MEISTER_PUNKTE[schema] || MEISTER_PUNKTE.f1;
    return platz < tab.length ? tab[platz] : 0;
  }
  // Gibt je Key { pos, pkt, fl } zurueck. flKey: wer die schnellste Runde fuhr (oder null).
  function meisterPunkteVergeben(reihe, schema, flKey, flPunkt) {
    const out = {};
    reihe.forEach((k, i) => { out[k] = { pos: i + 1, pkt: meisterPunkteFuer(schema, i, reihe.length), fl: false }; });
    if (flPunkt && flKey && out[flKey]) { out[flKey].fl = true; out[flKey].pkt += 1; }
    return out;
  }
  // Gesamtwertung: Punkte, dann mehr Siege, mehr zweite Plaetze, ..., dann das letzte Event.
  function meisterTabelle(lauf) {
    const f = Object.keys(lauf.fahrer || {}).map((k) => Object.assign({ key: k }, lauf.fahrer[k]));
    const plaetze = (x, p) => (x.je || []).filter((e) => e && e.pkt !== undefined && e.pos === p).length;
    const letztes = (x) => { const e = (x.je || [])[(x.je || []).length - 1]; return e && e.pos ? e.pos : 99; };
    f.sort((a, b) => {
      if (b.pkt !== a.pkt) return b.pkt - a.pkt;
      for (let p = 1; p <= 10; p++) { const d = plaetze(b, p) - plaetze(a, p); if (d) return d; }
      return letztes(a) - letztes(b);
    });
    return f;
  }
  // Mehrspieler: Menschen in Host-Reihenfolge, die eigenen uebrigen Autos nach Runden einsortiert;
  // bei gleicher Rundenzahl entscheidet ihr Abstand zum eigenen Auto (anker).
  // fern: [{ key, laps, beste }] in Host-Reihenfolge; lokal: [{ key, laps, total, beste }].
  function meisterMischen(fern, lokal, anker, quali) {
    if (quali) return meisterKlassieren(fern.concat(lokal), true);
    const ankerLokal = lokal.find((x) => x.key === anker);
    const reihe = fern.filter((x) => x.laps > 0).slice();
    lokal.filter((x) => x.laps > 0 && x.key !== anker).sort((a, b) => (b.laps - a.laps) || (a.total - b.total)).forEach((x) => {
      let i = reihe.findIndex((r) => {
        if (r.laps !== x.laps) return r.laps < x.laps;
        // Gleiche Rundenzahl: nur am Anker laesst sich messen, wer vorn war. Schneller als das
        // eigene Auto heisst direkt davor, sonst ans Ende der Gruppe.
        return r.key === anker && !!ankerLokal && x.total < ankerLokal.total;
      });
      if (i < 0) i = reihe.length;
      reihe.splice(i, 0, x);
    });
    return reihe.map((x) => x.key);
  }

  // ---- WER FAEHRT MIT --------------------------------------------------------------------
  function meisterMpAndere() {
    try {
      if (typeof mp === 'undefined' || !mp.an || !mpLetzterStand) return [];
      return (mpLetzterStand.fahrer || []).filter((f) => f && f.id && f.id !== mp.id && mpAktiv(f));
    } catch (e) { return []; }
  }
  function meisterLokalKey(c) { return 'c:' + c.id; }
  function meisterEigenKey() {
    if (meisterMpAndere().length) return 'mp:' + mp.id;
    const p = garage.find((c) => c.role === 'player');
    return p ? 'c:' + String(p.device.id) : 'c:spieler';
  }
  function meisterNurSpieler() { return meisterGlobalWert('teilnehmer') === 'spieler'; }
  function meisterDarfMit(rolle) { return !meisterNurSpieler() || /^player/.test(rolle || ''); }
  // Das Feld dieses Events, gemessen: Rueckgabe { reihe, info: {key: {name, farbe, rolle, beste}} }.
  function meisterFeldMessen(ev) {
    const quali = ev.format === 'qualifying';
    const info = {};
    const lokal = raceAllCars().filter((c) => meisterDarfMit(c.role)).map((c) => {
      const ms = (c.laps || []).map((l) => l.ms);
      // v1.4.54: ab Gruen (Vorlauf bis zur ersten Runde), wie Ergebnis und Uebersicht.
      let total = ms.reduce((a, b) => a + b, 0) + (ms.length ? (c.vorlauf || 0) : 0);
      // Verpasste Pflichtstopps: fuer jedes gesteuerte Auto (Spieler 1-3), v1.0.12.
      const platz = typeof spielerPlatzVonRolle === 'function' ? spielerPlatzVonRolle(c.role) : 0;
      if (platz && typeof strafeMsVon === 'function') total += strafeMsVon(platz);
      const key = c.id ? 'c:' + c.id : 'c:spieler';
      // v1.4.54: Farbe/Modell/Name fuer die Sieger- und Meisteransage (meisterNameFolge).
      info[key] = { name: c.name, farbe: c.farbe, rolle: c.role, farbeId: c.farbeId, modellId: c.modellId, alias: c.alias || '' };
      return { key, laps: ms.length, total, beste: ms.length ? Math.min.apply(null, ms) : Infinity, rolle: c.role };
    });
    const andere = meisterMpAndere();
    if (!andere.length) return { reihe: meisterKlassieren(lokal, quali), info, lokal };
    const eigen = (mpLetzterStand.fahrer || []).find((f) => f.id === mp.id);
    const fern = (mpLetzterStand.fahrer || []).filter((f) => f && f.id && (f.id === mp.id || mpAktiv(f))).map((f) => {
      const key = 'mp:' + f.id;
      info[key] = { name: f.name || f.id, farbe: null, rolle: f.id === mp.id ? 'player' : 'mp' };
      // Neue Hosts melden Gesamtzeit und Strafe (v1.0.12); dann zaehlt beides wie lokal.
      const total = Number.isFinite(f.summe) ? f.summe + (Number.isFinite(f.strafe) ? f.strafe : 0) : null;
      return { key, laps: f.laps || 0, beste: Number.isFinite(f.beste) ? f.beste * 1000 : Infinity, total };
    });
    // Das eigene Auto: lokal gemessen, aber unter seinem Mehrspieler-Key (der Anker).
    const p1 = lokal.find((x) => x.rolle === 'player');
    const anker = 'mp:' + mp.id;
    const rest = lokal.filter((x) => x !== p1);
    if (p1) {
      if (info[p1.key]) info[anker] = Object.assign({}, info[p1.key], { name: (eigen && eigen.name) || info[p1.key].name });
      rest.push(Object.assign({}, p1, { key: anker }));
    }
    // Kennt der Host von allen die Gesamtzeit, wird alles gemeinsam sortiert (mit Strafen);
    // sonst nach Host-Reihenfolge mit dem eigenen Auto als Anker.
    if (fern.every((x) => x.total !== null)) {
      const alle = fern.filter((x) => x.key !== anker || !p1).concat(rest);
      return { reihe: meisterKlassieren(alle, quali).filter((k, i, a) => a.indexOf(k) === i), info, lokal };
    }
    fern.forEach((x) => { if (x.total === null) x.total = 0; });
    return { reihe: meisterMischen(fern, rest, anker, quali).filter((k, i, a) => a.indexOf(k) === i), info, lokal };
  }

  // ---- ERFOLGSBALLAST (v1.4.33, WIP) -------------------------------------------------------
  // BESTELLT: "Gewichte in der Meisterschaft: Autos mit mehr Punkten fahren langsamer (fuer NPCs und fuer
  // Spielerauto), kriegen wie bei der DTM frueher 'mehr Gewicht' ins Auto, damit es spannender wird."
  //
  // VERTEILUNG: vor jedem Event aus dem Punktestand. Der Fuehrende traegt das Hoechstgewicht der Stufe, der
  // Letzte 0 kg, dazwischen linear nach dem Punkteabstand zum Letzten (ganze kg). Das erste Event und jedes
  // Event, vor dem alle gleich viele Punkte haben, faehrt ohne. Die kg sind nur die Anzeige; gefahren wird
  // mit zwei Faktoren, die beim Rennstart EINMAL je Auto gesetzt werden (meisterBallastSetzen) - im 45-ms-
  // Takt bleibt je eine Multiplikation (40-physics.js massFactor, 90-ghosts.js Zieltempo).
  //
  // SPIELER: Masse. massFactor = 1 + kg x BALLAST_MASSE_JE_KG, dieselbe Groesse, ueber die das Tankgewicht
  // wirkt (voller Tank +30 %): Vortrieb und Bremse werden durch sie geteilt, der Fahrwiderstand nicht - das
  // Auto ist traeger und hat ein wenig weniger Hoechsttempo. 50 kg sind +36 %, etwas mehr als ein voller Tank.
  // NPCs: ihr Zieltempo mal massFactor^-BALLAST_NPC_EXP.
  //
  // KALIBRIERT mit simFahren() (61-simlinie.js, Fahrer am Limit: Kurvengrenze wie die NPCs, eigene
  // Beschleunigung und Bremse) gegen die Rennsimulation (90b-sim.js, ein NPC Stufe Mittel), je fuenf
  // Strecken (SR3GLR2GR2G2, SR3G2R3G, SG3R2G3R2, SR3GR3GR3G, SGGR2GGR2). Rundenzeit-Zuschlag Spieler im Mittel
  // (Spanne): 30 kg +1,5 % (1,0-1,8), 50 kg +2,1 % (1,1-2,8), 80 kg +3,1 % (1,6-4,1). Der Spieler-Zuschlag
  // waechst etwa wie 7 x ln(massFactor); der NPC-Faktor folgt genau dem (NPC: 30 kg +1,4 %, 50 kg +2,2 %,
  // 80 kg +3,2 %, unabhaengig von der Strecke). Je mehr Geraden, desto mehr kostet die Masse den Spieler.
  // Die Hoechstgeschwindigkeit erreicht auf diesen Strecken niemand; ein eigener Deckel darauf aenderte die
  // Rundenzeit gemessen um 0,00 % und entfiel deshalb.
  const MEISTER_BALLAST_KG = { aus: 0, leicht: 30, mittel: 50, stark: 80 };
  const BALLAST_MASSE_JE_KG = 0.0072;
  const BALLAST_NPC_EXP = 0.07;
  // fahrer: { key: { pkt } } -> { key: kg } (nur wer Ballast traegt).
  function meisterBallastVerteilen(fahrer, maxKg) {
    const keys = Object.keys(fahrer || {});
    const out = {};
    if (!(maxKg > 0) || keys.length < 2) return out;
    const pkt = (k) => (fahrer[k] && fahrer[k].pkt) || 0;
    let lo = Infinity, hi = -Infinity;
    keys.forEach((k) => { lo = Math.min(lo, pkt(k)); hi = Math.max(hi, pkt(k)); });
    if (!(hi > lo)) return out;
    keys.forEach((k) => { const kg = Math.round(maxKg * (pkt(k) - lo) / (hi - lo)); if (kg > 0) out[k] = kg; });
    return out;
  }
  // Der Ballast fuer Event idx (0-basiert) aus dem Stand von lauf.
  function meisterBallastFuer(lauf, idx) {
    const max = MEISTER_BALLAST_KG[meisterGlobalWert('ballast')] || 0;
    if (!lauf || lauf.fertig || !max || !(idx > 0) || idx >= meister.plan.events.length) return {};
    return meisterBallastVerteilen(lauf.fahrer, max);
  }
  function ballastFaktoren(kg) {
    const masse = 1 + Math.max(0, kg || 0) * BALLAST_MASSE_JE_KG;
    return { masse, tempo: Math.pow(masse, -BALLAST_NPC_EXP) };
  }
  // kg eines Garagenautos aus einer Karte { 'c:<geraet>' | 'mp:<telefon>': kg }. Das eigene Fahrerauto steht im
  // Mehrspieler unter dem Telefon (meisterEigenKey), sonst unter dem Geraet.
  function meisterBallastKgVon(karte, car) {
    if (!karte || !car || !car.device) return 0;
    const k = karte['c:' + String(car.device.id)];
    if (k > 0) return k;
    if (car.role === 'player' && typeof mp !== 'undefined' && mp && mp.id) {
      const m = karte['mp:' + mp.id];
      if (m > 0) return m;
    }
    return 0;
  }
  // Welche Karte gilt beim Rennstart: das laufende eigene Event, sonst die des Meisterschaftsleiters aus dem
  // Mehrspieler-Plan. null = kein Meisterschafts-Event, alle ohne.
  function meisterBallastKarte(mpPlan) {
    const lauf = meister && meister.lauf;
    if (lauf && lauf.laeuft && !lauf.fertig) {
      return lauf.ballast && lauf.ballast.idx === lauf.laeuft.idx ? lauf.ballast.kg || null : null;
    }
    const m = mpPlan && mpPlan.meister;
    return m && !m.fertig && m.ballast && typeof m.ballast === 'object' ? m.ballast : null;
  }
  let ballastGesetzt = [];
  // Setzt die Faktoren (karte null = alle ohne). Nur hier wird gerechnet, nie im Takt.
  function meisterBallastSetzen(karte) {
    ballastGesetzt.forEach((x) => {
      if (x.motor) x.motor.state.ballastFaktor = 1;
      x.car.ballastTempo = 1; x.car.ballastKg = 0;
    });
    ballastGesetzt = [];
    if (typeof physEngine !== 'undefined' && physEngine) physEngine.state.ballastFaktor = 1;
    let eigen = 0;
    if (karte) garage.forEach((c) => {
      const kg = meisterBallastKgVon(karte, c);
      if (!kg) return;
      let motor = null;
      if (c.role === 'player') motor = physEngine;
      else if (/^player[2-9]$/.test(c.role || '')) {
        const z = typeof zusatzPlatzVonRolle === 'function' ? zusatzPlatzVonRolle(c.role) : null;
        motor = z ? z.motor : null;
        if (!motor) return;
      } else if (c.role !== 'ghost') return;
      const f = ballastFaktoren(kg);
      if (motor) motor.state.ballastFaktor = f.masse;
      else c.ballastTempo = f.tempo;
      c.ballastKg = kg;
      ballastGesetzt.push({ car: c, motor });
      if (c.role === 'player') eigen = kg;
    });
    meisterBallastCockpit(eigen);
  }
  // Aus startRaceCountdown (70-race.js): bei JEDEM Rennstart, ausserhalb der Meisterschaft also immer 0.
  function meisterBallastRennstart(mpPlan) {
    meisterBallastSetzen(meisterBallastKarte(mpPlan));
  }
  // Cockpit, ACC-Stil: ein kurzer Text neben "Runde", nur bei Aenderung geschrieben.
  function meisterBallastCockpit(kg) {
    const el = $('race-ballast');
    if (!el) return;
    const txt = kg > 0 ? t('Ballast') + ' +' + kg + ' kg' : '';
    if (el.textContent !== txt) el.textContent = txt;
    if (el.hidden !== !txt) el.hidden = !txt;
  }
  // Startschirm (raceGridZeilen, 70-race.js): " · +X kg" hinter dem Startplatz.
  function meisterBallastGridText(car) {
    const kg = meisterBallastKgVon(meisterBallastKarte(null), car);
    return kg > 0 ? ' · +' + kg + ' kg' : '';
  }

  // ---- STARTAUFSTELLUNG ------------------------------------------------------------------
  function meisterAufstAufgeloest(i) {
    const evs = meister.plan.events, ev = evs[i];
    if (!ev || !meisterIstRennen(ev)) return null;
    if (ev.aufst !== 'auto') return ev.aufst;
    if (i > 0 && evs[i - 1].format === 'qualifying') return 'quali';
    return evs.slice(0, i).some(meisterIstRennen) ? 'punkte_hinten' : 'erst';
  }
  function meisterAufstText(i) {
    const a = meisterAufstAufgeloest(i);
    if (a === null) return t('entfällt');
    if (a === 'erst') return meisterName(MEISTER_GLOBAL[1].w, meisterGlobalWert('start1')) + ' (' + t('erstes Rennen') + ')';
    if (a === 'quali') return t('nach Qualifying');
    return meisterName(MEISTER_AUFST, a);
  }
  function meisterAufstFehler(i) {
    const evs = meister.plan.events, ev = evs[i];
    if (!ev || !meisterIstRennen(ev) || ev.aufst !== 'quali') return '';
    return evs.slice(0, i).some((x) => x.format === 'qualifying') ? '' : t('Vorher fehlt ein Qualifying.');
  }
  function meisterMischeln(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = r[i]; r[i] = r[j]; r[j] = x; }
    return r;
  }
  // Beste Runde je Auto auf der aktuellen Strecke aus den gespeicherten Sitzungen (ueber den Namen,
  // denn die Sitzungen halten keine Geraetekennung).
  function meisterBesteAufStrecke() {
    const beste = {};
    try {
      const code = currentTrackTiles && currentTrackTiles.length > 1 ? trackToCode(currentTrackTiles) : '';
      if (!code) return beste;
      sessionStore().sessions.filter((s) => s.strecke === code).forEach((s) => (s.autos || []).forEach((a) => {
        const m = (a.laps || []).length ? Math.min.apply(null, a.laps) : null;
        if (m && (!beste[a.name] || m < beste[a.name])) beste[a.name] = m;
      }));
    } catch (e) { /* ohne Daten */ }
    return beste;
  }
  // Die Reihenfolge der LOKALEN Autos (Geraetekennungen) fuer raceGridOrder.
  // v1.0.25 BESTELLT: "vor dem Start des naechsten Rennens nochmal den Startbildschirm mit
  // Startaufstellungsknopf und Anzeige, welches Auto wo stehen muesste". Bei Zufall wurde die
  // Reihe beim Anzeigen und beim Start je neu gewuerfelt - die Anzeige stimmte also nicht.
  // Jetzt wird sie je Event EINMAL festgelegt (lauf.reihe) und bis zum Start behalten.
  function meisterStartReiheFest(i) {
    const lauf = meister.lauf;
    if (!lauf) return meisterStartReihe(i);
    if (!lauf.reihe || lauf.reihe.idx !== i) lauf.reihe = { idx: i, ids: meisterStartReihe(i) };
    return lauf.reihe.ids.slice();
  }
  function meisterStartReihe(i) {
    const lauf = meister.lauf;
    const autos = garage.filter((c) => c.device && c.role !== 'safetycar' && c.role !== 'reinig' && c.role !== 'challenger' && c.role !== 'none');
    const id = (c) => String(c.device.id);
    const keyVon = (c) => (meisterMpAndere().length && c.role === 'player') ? 'mp:' + mp.id : 'c:' + id(c);
    const a = meisterAufstAufgeloest(i);
    const nachListe = (liste) => {
      const pos = (c) => { const k = liste.indexOf(keyVon(c)); return k < 0 ? 999 : k; };
      return autos.slice().sort((x, y) => pos(x) - pos(y)).map(id);
    };
    if (a === 'quali') return nachListe((lauf && lauf.quali) || []);
    if (a === 'letztes') return nachListe((lauf && lauf.letztes) || []);
    if (a === 'punkte_hinten' || a === 'punkte_vorn') {
      const tab = meisterTabelle(lauf || { fahrer: {} }).map((x) => x.key);
      return nachListe(a === 'punkte_vorn' ? tab : tab.reverse());
    }
    if (a === 'zufall') return meisterMischeln(autos.map(id));
    const s1 = meisterGlobalWert('start1');
    if (s1 === 'garage') return autos.map(id);
    if (s1 === 'beste_zuletzt' || s1 === 'beste_zuerst') {
      const b = meisterBesteAufStrecke();
      const mit = meisterMischeln(autos).map((c) => ({ c, ms: b[garageLabel(c)] || Infinity }));
      mit.sort((x, y) => (s1 === 'beste_zuerst' ? x.ms - y.ms : (y.ms === Infinity ? -1 : (x.ms === Infinity ? 1 : y.ms - x.ms))));
      return mit.map((x) => id(x.c));
    }
    return meisterMischeln(autos.map(id));
  }

  // Wo ein Startplatz liegt: Reihe 1 auf der Kachel vor Start/Ziel, jede weitere eine dahinter;
  // gerade Plaetze rechts, ungerade links (wie formationOffset und die automatische Aufstellung).
  function meisterPlatzText(i) {
    return t('Reihe {r}').replace('{r}', Math.floor(i / 2) + 1) + ' · ' + (i % 2 ? t('links') : t('rechts'));
  }
  // Fuer den Startschirm (raceGridAnzeigen): laeuft ein Meisterschafts-Event, welches.
  function meisterGridInfo() {
    const lauf = meister && meister.lauf;
    if (!lauf || !lauf.laeuft) return '';
    const ev = meister.plan.events[lauf.laeuft.idx];
    if (!ev) return '';
    return t('Meisterschaft') + ' · ' + t('Event') + ' ' + (lauf.laeuft.idx + 1) + '/' + meister.plan.events.length
      + (meisterIstRennen(ev) ? ' · ' + t('Startaufstellung') + ': ' + meisterAufstText(lauf.laeuft.idx) : '');
  }

  // ---- EVENT STARTEN ---------------------------------------------------------------------
  function meisterBahn(an) {
    const cb = $('setting-ontrack');
    if (!cb || cb.checked === !!an) return;
    cb.checked = !!an;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function meisterStreckeCodeSetzen(code) {
    if (!code || typeof codeToTrack !== 'function') return false;
    const jetzt = currentTrackTiles && currentTrackTiles.length > 1 ? trackToCode(currentTrackTiles, trackRotationDeg) : '';
    if (jetzt === code) return true;
    const tr = codeToTrack(code);
    if (!tr) return false;
    currentTrackTiles = tr.tiles;
    trackRotationDeg = tr.rotation || 0;
    if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
    return true;
  }
  // Die Strecke des Events: Rueckgabe { code, bahn } fuer den Mehrspieler-Plan.
  function meisterStreckeAnwenden(ev) {
    const lauf = meister.lauf;
    if (ev.strecke === 'frei') { meisterBahn(false); return { code: '', bahn: false }; }
    if (ev.strecke === 'aktuell') {
      if (lauf && lauf.aktuellCode) meisterStreckeCodeSetzen(lauf.aktuellCode);
      meisterBahn(lauf ? lauf.bahnVorher !== false : true);
    } else if (meisterGespeicherte().indexOf(ev.strecke) >= 0) {
      trackLaden(ev.strecke);
      meisterBahn(true);
    } else {
      msMeldung(t('Strecke nicht mehr gespeichert, es gilt die aktuelle'));
    }
    const code = currentTrackTiles && currentTrackTiles.length > 1 ? trackToCode(currentTrackTiles, trackRotationDeg) : '';
    return { code, bahn: !!($('setting-ontrack') || {}).checked };
  }
  function meisterLaufNeu() {
    let code = '';
    try { code = currentTrackTiles && currentTrackTiles.length > 1 ? trackToCode(currentTrackTiles, trackRotationDeg) : ''; } catch (e) { code = ''; }
    return { id: Date.now(), idx: 0, fahrer: {}, quali: [], letztes: [], fertig: false, laeuft: null,
             aktuellCode: code, bahnVorher: !!($('setting-ontrack') || {}).checked, mp: meisterMpAndere().length > 0 };
  }
  let meisterStreckeMp = null;
  function meisterEventStarten() {
    const lauf = meister.lauf;
    if (!lauf || lauf.fertig) return;
    const ev = meister.plan.events[lauf.idx];
    if (!ev) return;
    if (kRennenLaeuft()) { msMeldung(t('Erst das laufende Rennen beenden')); return; }
    // v1.2.4 BESTELLT: Warnung, wenn im Ausdruck-Modus NPCs oder ein Safety Car mitfahren sollen.
    if (typeof ausdruckNpcWarnung === 'function' && ausdruckNpcWarnung()) msMeldung(ausdruckNpcWarnung());
    const f = meisterFormat(ev);
    const rennen = meisterIstRennen(ev);
    meisterStreckeMp = meisterStreckeAnwenden(ev);
    chSetzen('race-mode', f.modus);
    chSetzen('race-limit', Math.max(1, ev.umfang | 0));
    if (String(raceLimit) !== String(Math.max(1, ev.umfang | 0))) raceLimit = Math.max(1, ev.umfang | 0);
    chSetzen('race-wx-start', ev.wetter);
    chSetzen('race-wx-change', false);
    chSetzen('race-flying', rennen && ev.start === 'fliegend');
    chSetzen('race-pit-required', String(rennen ? Math.min(3, ev.stopps | 0) : 0));
    const fg = meisterGlobalWert('fahrgefuehl');
    if (fg !== 'garage' && fg !== 'p1' && typeof applyPreset === 'function') {
      try { applyPreset(fg); } catch (e) { /* bleibt */ }
    }
    raceGridOrder = meisterStartReiheFest(lauf.idx);
    lauf.laeuft = { idx: lauf.idx, modus: f.modus, seit: Date.now() };
    // v1.4.33: der Erfolgsballast dieses Events, festgehalten (Fortsetzen, Mehrspieler-Plan, Startschirm).
    lauf.ballast = { idx: lauf.idx, kg: meisterBallastFuer(lauf, lauf.idx) };
    meisterBallastSetzen(lauf.ballast.kg);
    meisterSpeichern();
    meisterSchliessen();
    msMeldung(t('Meisterschaft') + ' · ' + t('Event') + ' ' + (lauf.idx + 1) + '/' + meister.plan.events.length);
    // v1.4.54 (WIP): Einblendung mit vorbeifahrenden Autos und die Event-Ansage.
    meisterIntroZeigen(lauf.idx);
    meisterAnsagen('intro', { nr: lauf.idx + 1, von: meister.plan.events.length, ev,
      ballast: !!(lauf.ballast && Object.keys(lauf.ballast.kg || {}).length) });
    if (meisterMpAndere().length && typeof mpRennenFuerAlle === 'function') {
      showTab('race');
      mpRennenFuerAlle();
    } else konsoleLosfahren();
  }

  // ---- EVENT ENDE --------------------------------------------------------------------------
  // Aus finishRace(). Gewertet wird erst, wenn alle Ghosts im Ziel sind (ghostAuslaufFertig
  // malt dann das Ergebnis neu) und - im Mehrspieler - die letzten Runden beim Host angekommen
  // sind.
  let meisterWarten = null;
  function meisterRennenEnde(regulaer) {
    const lauf = meister.lauf;
    if (!lauf || !lauf.laeuft || lauf.fertig) return false;
    if (lauf.laeuft.modus !== raceMode || Date.now() - lauf.laeuft.seit > 6 * 3600000) { lauf.laeuft = null; meisterBallastSetzen(null); meisterSpeichern(); return false; }
    // Ein Training von Hand beenden ist normal (es vergibt keine Punkte), ein Rennen nicht.
    const ev = meister.plan.events[lauf.laeuft.idx];
    if (!regulaer && ev && ev.format === 'training') regulaer = true;
    // v1.0.25 BESTELLT: "Wenn ich ein Rennen beende, wird es als 0 gezaehlt und ich kann beim
    // naechsten Rennen weitermachen." Vorher blieb das Event offen und musste neu gefahren
    // werden. Jetzt: alle bekommen fuer dieses Event 0 Punkte, und es geht zum naechsten.
    if (!regulaer) {
      meisterWerten(true);
      msMeldung(t('Event abgebrochen: zählt mit 0 Punkten'));
      return true;
    }
    msMeldung(t('Wertung, sobald alle im Ziel sind …'));
    const bis = Date.now() + 95000, ab = Date.now() + (meisterMpAndere().length ? 3500 : 0);
    if (meisterWarten) clearInterval(meisterWarten);
    meisterWarten = setInterval(() => {
      const rollt = garage.some((c) => c.role === 'ghost' && c.ghost && c.ghost.auslauf);
      if ((rollt || Date.now() < ab) && Date.now() < bis) {
        if (meisterMpAndere().length && typeof mpHolen === 'function') mpHolen(true);
        return;
      }
      clearInterval(meisterWarten); meisterWarten = null;
      meisterWerten();
    }, 500);
    return true;
  }
  function meisterWerten(abgebrochen) {
    const lauf = meister.lauf;
    if (!lauf || !lauf.laeuft) return;
    const idx = lauf.laeuft.idx, ev = meister.plan.events[idx];
    lauf.laeuft = null;
    lauf.reihe = null;                 // die naechste Startreihe wird neu festgelegt
    meisterBallastSetzen(null);        // v1.4.33: nach dem Event ohne Ballast
    if (!ev) return;
    const m = meisterFeldMessen(ev);
    if (abgebrochen) { m.reihe = []; m.lokal = []; }
    // Jeder, der mitfuhr, bekommt eine Zeile, auch ohne Punkte.
    Object.keys(m.info).forEach((k) => {
      if (!lauf.fahrer[k]) lauf.fahrer[k] = { name: m.info[k].name, farbe: m.info[k].farbe, rolle: m.info[k].rolle, pkt: 0, je: [] };
      const f = lauf.fahrer[k];
      f.name = m.info[k].name || f.name;
      if (m.info[k].farbe) f.farbe = m.info[k].farbe;
      if (m.info[k].farbeId) { f.farbeId = m.info[k].farbeId; f.modellId = m.info[k].modellId || ''; f.alias = m.info[k].alias || ''; }
    });
    let ergebnis = {};
    if (meisterIstRennen(ev)) {
      // Schnellste Runde unter den Gewerteten.
      let flKey = null, fl = Infinity;
      const besteVon = {};
      m.lokal.forEach((x) => { besteVon[x.key] = x.beste; });
      if (meisterMpAndere().length) {
        (mpLetzterStand.fahrer || []).forEach((f) => { if (Number.isFinite(f.beste)) besteVon['mp:' + f.id] = f.beste * 1000; });
      }
      m.reihe.forEach((k) => { if (besteVon[k] < fl) { fl = besteVon[k]; flKey = k; } });
      ergebnis = meisterPunkteVergeben(m.reihe, meisterGlobalWert('punkte'), flKey, meisterGlobalWert('fl') === 'ja');
      if (!abgebrochen) lauf.letztes = m.reihe.slice();
    } else {
      m.reihe.forEach((k, i) => { ergebnis[k] = { pos: i + 1 }; });
      if (ev.format === 'qualifying' && !abgebrochen) lauf.quali = m.reihe.slice();
    }
    Object.keys(lauf.fahrer).forEach((k) => {
      const f = lauf.fahrer[k];
      while (f.je.length < idx) f.je.push(null);
      const e = abgebrochen ? { pos: null, pkt: meisterIstRennen(ev) ? 0 : undefined, ab: true }
        : ergebnis[k] || (m.info[k] ? { pos: null, pkt: meisterIstRennen(ev) ? 0 : undefined } : null);
      f.je[idx] = e;
      if (e && e.pkt) f.pkt += e.pkt;
    });
    lauf.idx = idx + 1;
    lauf.fertig = lauf.idx >= meister.plan.events.length;
    meisterSpeichern();
    if (lauf.fertig && meisterMpAndere().length) meisterMpEndstandSenden();
    // v1.3.129: Ansage am Event-Ende - welches Event es war und was als Naechstes kommt,
    // bzw. ganz am Ende, dass die Meisterschaft vorbei ist und wer gesamt gewonnen hat.
    // Gesprochen wird Deutsch oder Englisch (Spanisch nutzt die englische Stimme), darum
    // der Formatname aus I18N_EN und nicht ueber t().
    if (!abgebrochen) {
      const de = lang === 'de';
      const gesamt = meister.plan.events.length;
      // v1.4.54: Sieger dieses Rennens und am Ende der Meister mit Fanfare (eigene Schalter, WIP).
      const siegerKey = meisterIstRennen(ev) && m.reihe.length ? m.reihe[0] : null;
      const sieger = siegerKey && lauf.fahrer[siegerKey] ? Object.assign({ key: siegerKey }, lauf.fahrer[siegerKey]) : null;
      const meisterTop = lauf.fertig ? meisterTabelle(lauf)[0] : null;
      let text;
      if (lauf.fertig) {
        const top = meisterTabelle(lauf)[0];
        text = top
          ? (de ? 'Meisterschaft vorbei. Gewonnen hat ' + top.name + ' mit ' + top.pkt + ' Punkten.'
                : 'Championship over. Winner: ' + top.name + ' with ' + top.pkt + ' points.')
          : (de ? 'Meisterschaft vorbei.' : 'Championship over.');
      } else {
        const naechstes = meister.plan.events[lauf.idx];
        const nf = naechstes ? meisterFormat(naechstes) : null;
        const nfName = nf ? (de ? nf.name : (I18N_EN[nf.name] || nf.name)) : (de ? 'keins' : 'none');
        text = de ? 'Event ' + (idx + 1) + ' von ' + gesamt + ' beendet. Nächstes Event: ' + nfName + '.'
                  : 'Event ' + (idx + 1) + ' of ' + gesamt + ' finished. Next event: ' + nfName + '.';
        // v1.4.33: mit Erfolgsballast, wer am meisten traegt (nur Text, Geraetestimme wie der Rest).
        const kg = meisterBallastFuer(lauf, lauf.idx), top = meisterTabelle(lauf)[0];
        if (top && kg[top.key] > 0) {
          text += de ? ' Erfolgsballast: ' + top.name + ' trägt ' + kg[top.key] + ' Kilo.'
                     : ' Success ballast: ' + top.name + ' carries ' + kg[top.key] + ' kilos.';
        }
      }
      meisterNachErgebnis(() => {
        let mein = false;
        if (sieger) mein = meisterAnsagen('sieger', { nr: idx + 1, x: sieger }) || mein;
        if (meisterTop) mein = meisterAnsagen('abschluss', { x: meisterTop, pkt: meisterTop.pkt }, { fanfare: true }) || mein;
        // Der Abschluss ersetzt "Meisterschaft vorbei ..."; ohne Warteschlange braeche die alte Ansage die neue ab.
        const ersetzt = lauf.fertig && meisterAnsageAn.abschluss;
        const sofort = typeof ansageWarteschlange !== 'undefined' && !ansageWarteschlange;
        if (typeof ansage === 'function' && !ersetzt && !(mein && sofort)) ansage('meister', text);
      });
    }
    // Erst das Rennergebnis sehen lassen, dann den Stand.
    setTimeout(() => meisterOeffnen('stand'), 2500);
  }

  // Die Meisterschaftsansage darf eine laufende oder noch ausstehende Ergebnis-/Rennstandansage
  // nicht abbrechen. ansage() ohne Warteschlange (ansageSofort) schaltet erst alles still,
  // auch rennstandAbbrechen() - die Ergebnisansage endete dann mitten im Satz. Deshalb wartet
  // sie, bis die Ergebnisansage gesprochen (oder gar nicht vorgesehen) ist und nichts mehr
  // spricht. Mit Warteschlange reiht ansage() danach ein; ohne spricht sie nach der
  // laufenden. Hoechstens zwei Minuten, dann kommt sie trotzdem.
  // v1.4.54: fuer alle Meisterschaftsansagen am Event-Ende (Event-Ende, Sieger, Abschluss); fn spricht.
  function meisterNachErgebnis(fn) {
    const bis = Date.now() + 120000;
    const versuch = () => {
      // Hat inzwischen das naechste Event begonnen, ist die Ansage ueberholt.
      if (raceState === 'countdown' || raceState === 'racing' || raceState === 'finishing') return;
      const ergebnisOffen = typeof rennstandErgebnisErlaubt === 'function'
        && rennstandErgebnisGeplant && !rennstandErgebnisGesprochen && rennstandErgebnisErlaubt();
      const spricht = (typeof rennstandBeschaeftigt === 'function' && rennstandBeschaeftigt())
        || (!ansageWarteschlange && typeof ansagenWarten === 'function' && ansagenWarten())
        || (!ansageWarteschlange && typeof lapAnsageBeschaeftigt === 'function' && lapAnsageBeschaeftigt());
      if ((ergebnisOffen || spricht) && Date.now() < bis) { setTimeout(versuch, 250); return; }
      fn();
    };
    versuch();
  }

  // ---- MEHRSPIELER --------------------------------------------------------------------------
  // In den Plan, den der Leiter "fuer alle" verschickt (mpPlanBauen).
  function meisterMpInfo() {
    const lauf = meister.lauf;
    if (!lauf || !lauf.laeuft) return null;
    const ev = meister.plan.events[lauf.laeuft.idx];
    return {
      id: lauf.id, nr: lauf.laeuft.idx + 1, von: meister.plan.events.length,
      titel: meisterStreckeName(ev.strecke) + ' · ' + t(meisterFormat(ev).name) + ' ' + ev.umfang + ' ' + t(meisterFormat(ev).einheit),
      strecke: meisterStreckeMp, stand: meisterStandKurz(lauf, lauf.ballast && lauf.ballast.idx === lauf.laeuft.idx ? lauf.ballast.kg : null),
      // v1.4.33: der Ballast dieses Events; die anderen Telefone setzen ihn beim Rennstart fuer ihr Fahrerauto.
      ballast: lauf.ballast && lauf.ballast.idx === lauf.laeuft.idx ? lauf.ballast.kg : null,
    };
  }
  function meisterMpPreset() {
    const fg = meisterGlobalWert('fahrgefuehl');
    if (!meister.lauf || !meister.lauf.laeuft || fg === 'garage') return null;
    if (fg === 'p1') return window.__presetActive ? window.__presetActive() : null;
    return fg;
  }
  function meisterStandKurz(lauf, kg) {
    return meisterTabelle(lauf).slice(0, 12).map((x) => {
      const s = { n: String(x.name || '').slice(0, 24), p: x.pkt };
      if (kg && kg[x.key] > 0) s.k = kg[x.key];
      return s;
    });
  }
  async function meisterMpEndstandSenden() {
    try {
      const plan = { meister: { id: meister.lauf.id, fertig: true, nr: meister.plan.events.length,
        von: meister.plan.events.length, titel: t('Endstand'), stand: meisterStandKurz(meister.lauf) } };
      await fetch(mpUrl('/mp/race'), { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, phase: 'bereit', initiator: mp.id }) });
      setTimeout(() => { fetch(mpUrl('/mp/race/cancel'), { method: 'POST', cache: 'no-store' }).catch(() => {}); }, 20000);
    } catch (e) { /* die anderen sehen dann nur ihr Rennergebnis */ }
  }
  // Auf den anderen Telefonen: Strecke des Events uebernehmen (aus mpRennenUebernehmen).
  function meisterMpUebernehmen(plan) {
    const m = plan && plan.meister;
    if (!m || !m.strecke) return;
    if (m.strecke.bahn === false) { meisterBahn(false); return; }
    if (m.strecke.code) meisterStreckeCodeSetzen(m.strecke.code);
    meisterBahn(true);
  }
  // Bereitschaftsschirm der anderen: Event und Stand des Leiters.
  function meisterMpBereitHtml(plan) {
    const m = plan && plan.meister;
    if (!m) return '';
    const esc = mpBereitEsc;
    let h = '<div class="ms-mp-kopf">' + esc(t('Meisterschaft')) + ' · ' + esc(m.fertig ? t('Endstand') : (t('Event') + ' ' + m.nr + '/' + m.von))
      + '</div>' + (m.fertig ? '' : '<div class="ms-mp-titel">' + esc(m.titel || '') + '</div>');
    if (Array.isArray(m.stand) && m.stand.length) {
      h += '<table class="ms-mp-stand">' + m.stand.map((s, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(s.n)
        + (s.k > 0 ? ' <span class="ms-kg">+' + (s.k | 0) + ' kg</span>' : '')
        + '</td><td>' + (s.p | 0) + '</td></tr>').join('') + '</table>';
    }
    return h;
  }

  // ---- PRAESENTATION (v1.4.54, WIP) --------------------------------------------------------
  // BESTELLT: "Meisterschaft: Erstelle eine kurze Animation je Event mit Ansage und coolem Hintergrund-Sound
  // (z. B. vorbeifahrende Autos). Erstelle eine globale Anfangsansage 'Willkommen zur Meisterschaft' mit Anzahl
  // Events und eine Abschlussfanfare mit Gesamtgewinner. Je Rennen sollen auch Gewinner angesagt werden
  // (Ansagen optional uebers Ansagen-Menue machen)."
  //
  // ANSAGEN: vier Schalter in Optionen > Ansagen (Vorgabe an, WIP). Gesprochen aus festen Piper-Bausteinen
  // (audio/meisterschaft.json, tools/voice_meisterschaft.py) plus den vorhandenen Zahlen- und Autonamen-Clips
  // (zahlen.json, rennstand-erweitert.json, rennereignisse.json fuer Zahlen ueber 60); fehlt ein Baustein oder
  // traegt ein Auto einen eigenen Namen, spricht die Geraetestimme den ganzen Satz. Immer ueber die Ansagen-
  // Warteschlange (bzw. ansagenSofort, wenn sie aus ist); Sieger und Abschluss erst nach der Ergebnisansage.
  const MEISTER_ANSAGE_SCHALTER = { willkommen: 'setting-announce-meister-willkommen', intro: 'setting-announce-meister-intro',
    sieger: 'setting-announce-meister-sieger', abschluss: 'setting-announce-meister-abschluss' };
  const meisterAnsageAn = { willkommen: true, intro: true, sieger: true, abschluss: true };
  Object.keys(MEISTER_ANSAGE_SCHALTER).forEach((art) => {
    const el = $(MEISTER_ANSAGE_SCHALTER[art]);
    if (!el) return;
    meisterAnsageAn[art] = el.checked;
    el.addEventListener('change', () => {
      meisterAnsageAn[art] = el.checked;
      if (!el.checked && typeof ansagenArtStoppen === 'function') ansagenArtStoppen('meister-' + art);
    });
  });
  // Die festen Bausteine, Wort fuer Wort wie TEXTE in tools/voice_meisterschaft.py (Selbsttest vergleicht).
  const MEISTER_CLIP_TEXT = {
    willkommen: ['Willkommen zur Meisterschaft.', 'Welcome to the championship.'],
    events_an: ['Events stehen an.', 'events lie ahead.'],
    event_einer: ['Ein Event steht an.', 'One event lies ahead.'],
    event: ['Event', 'Event'], von: ['von', 'of'],
    format_training: ['Training.', 'Practice.'], format_qualifying: ['Qualifying.', 'Qualifying.'],
    format_runden: ['Rennen über', 'Race over'], format_endurance: ['Endurance über', 'Endurance over'],
    umfang_runden: ['Runden.', 'laps.'], umfang_minuten: ['Minuten.', 'minutes.'],
    umfang_eine_runde: ['eine Runde.', 'one lap.'], umfang_eine_minute: ['eine Minute.', 'one minute.'],
    wetter_regen: ['Bei Regen.', 'In the rain.'], wetter_wechsel: ['Bei wechselhaftem Wetter.', 'In changeable weather.'],
    ballast: ['Mit Erfolgsballast.', 'With success ballast.'],
    sieger_event: ['Sieger von Event', 'Winner of event'], meister_ist: ['Meister ist', 'The champion is'],
    mit: ['mit', 'with'], punkten: ['Punkten.', 'points.'], einem_punkt: ['einem Punkt.', 'one point.'],
  };
  function meisterClipWort(key, spr) { const x = MEISTER_CLIP_TEXT[key]; return x ? x[spr === 'de' ? 0 : 1] : ''; }
  // Zahlen: bis 60 aus zahlen.json, darueber wie die Rennereignisse (number_61 ... hundred_N).
  function meisterZahlFolge(n) {
    n = Math.max(0, Math.round(n || 0));
    if (n <= 60) return ['n:' + n];
    return typeof rennEreignisZahlFolge === 'function' ? rennEreignisZahlFolge(n) : null;
  }
  // Ein Fahrer aus lauf.fahrer bzw. der Tabelle: Farbe + Modell (+ "von Spieler n") aus den Rennstand-Clips.
  // null = nicht aus Clips sagbar (eigener Name, Mehrspieler-Telefon ohne Autodaten).
  function meisterNameFolge(x) {
    if (!x || String(x.alias || '').trim() || !x.farbeId || /^mp/.test(x.rolle || '') || /^mp:/.test(x.key || '')) return null;
    const folge = ['e:farbe_' + (x.farbeId !== 'keine' ? x.farbeId : 'unbekannt'),
      'e:modell_' + ((typeof carModellWert === 'function' && carModellWert(x.modellId)) || 'auto')];
    const nr = typeof rennstandSpielerNr === 'function' ? rennstandSpielerNr(x.rolle) : 0;
    if (nr) folge.push('e:spieler' + nr);
    return folge;
  }
  function meisterNameText(x, spr) {
    const de = spr === 'de', L = de ? 'de' : 'en';
    const alias = String((x && x.alias) || '').trim();
    if (alias) return alias;
    if (x && x.farbeId && typeof RENNSTAND_FARBWORT !== 'undefined' && !/^mp/.test(x.rolle || '')) {
      const farbe = RENNSTAND_FARBWORT[L][x.farbeId] || (de ? 'der' : 'the');
      const modell = RENNSTAND_MODELLWORT[L][(typeof carModellWert === 'function' && carModellWert(x.modellId)) || ''] || (de ? 'Wagen' : 'car');
      const nr = typeof rennstandSpielerNr === 'function' ? rennstandSpielerNr(x.rolle) : 0;
      return farbe + ' ' + modell + (nr ? (de ? ' von Spieler ' : ' driven by player ') + nr : '');
    }
    return String((x && x.name) || (de ? 'unbekannt' : 'unknown'));
  }
  // Rein, ohne Ton (der Selbsttest ruft sie): { folge: Clip-Schluessel | null, text } je Ansage.
  //   willkommen { n }   intro { nr, von, ev, ballast }   sieger { nr, x }   abschluss { x, pkt }
  function meisterAnsageTeile(art, d, spr) {
    const de = spr === 'de';
    const W = (k) => meisterClipWort(k, spr);
    let folge = [], text = '';
    const zahl = (n) => { const z = meisterZahlFolge(n); if (z && folge) folge.push(...z); else folge = null; };
    const name = (x) => { const f = meisterNameFolge(x); if (f && folge) folge.push(...f); else folge = null; };
    if (art === 'willkommen') {
      const n = d.n | 0;
      folge.push('m:willkommen');
      if (n === 1) { folge.push('m:event_einer'); text = W('willkommen') + ' ' + W('event_einer'); }
      else { zahl(n); if (folge) folge.push('m:events_an'); text = W('willkommen') + ' ' + n + ' ' + W('events_an'); }
    } else if (art === 'intro') {
      const ev = d.ev || {}, f = meisterFormat(ev), u = Math.max(1, ev.umfang | 0);
      folge.push('m:event'); zahl(d.nr); if (folge) folge.push('m:von'); zahl(d.von);
      text = W('event') + ' ' + d.nr + ' ' + W('von') + ' ' + d.von + '. ';
      const formatKey = 'format_' + f.id;
      if (folge) folge.push('m:' + formatKey);
      text += W(formatKey) + ' ';
      const runden = f.einheit === 'Runden';
      if (u === 1) {
        const k = runden ? 'umfang_eine_runde' : 'umfang_eine_minute';
        if (folge) folge.push('m:' + k);
        text += W(k);
      } else {
        zahl(u);
        const k = runden ? 'umfang_runden' : 'umfang_minuten';
        if (folge) folge.push('m:' + k);
        text += u + ' ' + W(k);
      }
      if (ev.wetter === 'rain' || ev.wetter === 'wechsel') {
        const k = ev.wetter === 'rain' ? 'wetter_regen' : 'wetter_wechsel';
        if (folge) folge.push('m:' + k);
        text += ' ' + W(k);
      }
      if (d.ballast) { if (folge) folge.push('m:ballast'); text += ' ' + W('ballast'); }
    } else if (art === 'sieger') {
      folge.push('m:sieger_event'); zahl(d.nr); name(d.x);
      text = W('sieger_event') + ' ' + d.nr + ': ' + meisterNameText(d.x, spr) + '.';
    } else if (art === 'abschluss') {
      const p = Math.max(0, Math.round(d.pkt || 0));
      folge.push('m:meister_ist'); name(d.x);
      if (folge) folge.push('m:mit');
      if (p === 1) { if (folge) folge.push('m:einem_punkt'); }
      else { zahl(p); if (folge) folge.push('m:punkten'); }
      text = W('meister_ist') + ' ' + meisterNameText(d.x, spr) + ' ' + W('mit') + ' ' + (p === 1 ? W('einem_punkt') : p + ' ' + W('punkten'));
    } else return null;
    // Englischer Satzanfang gross ("events lie ahead" steht im Satz klein).
    if (!de) text = text.replace(/\. ([a-z])/g, (_, c) => '. ' + c.toUpperCase());
    return { folge, text: text.trim() };
  }
  const meisterClips = { buffers: {}, laden: {} };
  async function meisterClipsLaden(spr) {
    const quelle = spr === 'de' ? 'de' : 'en';
    if (meisterClips.buffers[quelle]) return meisterClips.buffers[quelle];
    if (typeof audioCtx === 'undefined' || !audioCtx) return null;
    if (meisterClips.laden[quelle]) return meisterClips.laden[quelle];
    meisterClips.laden[quelle] = (async () => {
      try {
        const res = await fetch('audio/meisterschaft.json');
        if (!res.ok) throw Error('HTTP ' + res.status);
        const manifest = await res.json(), satz = {};
        const entries = Object.entries(manifest[quelle] || {});
        for (let i = 0; i < entries.length; i += 6) {
          await Promise.all(entries.slice(i, i + 6).map(async ([key, file]) => {
            const response = await fetch('audio/' + file);
            if (!response.ok) throw Error(file);
            satz['m:' + key] = await audioCtx.decodeAudioData(await response.arrayBuffer());
          }));
        }
        meisterClips.buffers[quelle] = satz; return satz;
      } catch (err) {
        log('Meisterschafts-Clips fehlen (' + err.message + '); Geraetestimme.', 'info');
        return null;
      } finally { delete meisterClips.laden[quelle]; }
    })();
    return meisterClips.laden[quelle];
  }
  const meisterAnsageLog = [];
  function meisterPauseMs(ms) { return new Promise((r) => setTimeout(r, ms)); }
  // Eine Meisterschaftsansage einreihen. optionen.fanfare: erst die Zielfanfare (Abschluss).
  function meisterAnsagen(art, d, optionen) {
    if (!meisterAnsageAn[art] || typeof soundEnabled === 'undefined' || !soundEnabled) return false;
    const spr = lang === 'de' ? 'de' : 'en';
    const teile = meisterAnsageTeile(art, d, spr);
    if (!teile) return false;
    meisterAnsageLog.push({ art, text: teile.text, folge: teile.folge, fanfare: !!(optionen && optionen.fanfare) });
    if (meisterAnsageLog.length > 20) meisterAnsageLog.shift();
    const spielen = async (gueltig) => {
      if (optionen && optionen.fanfare && typeof playRaceEndFanfare === 'function') {
        const fan = playRaceEndFanfare();
        await meisterPauseMs(((fan && fan.dauer) || 2) * 1000 + 250);
        if (!gueltig()) return;
      }
      let folge = null;
      if (teile.folge) {
        const [m, b, v] = await Promise.all([meisterClipsLaden(spr),
          typeof rennstandClipsLaden === 'function' ? rennstandClipsLaden(spr, true) : null,
          typeof rennEreignisClipsLaden === 'function' ? rennEreignisClipsLaden(spr) : null]);
        if (!gueltig()) return;
        const satz = Object.assign({}, b || {}, v || {}, m || {});
        folge = teile.folge.map((k) => satz[k]);
        if (!folge.every(Boolean)) folge = null;
      }
      if (folge) await ansagenPufferSpielen(folge, { stadion: true });
      else await ansagenTextSpielen(teile.text, spr);
    };
    const erlaubt = () => !!meisterAnsageAn[art] && soundEnabled;
    if (typeof ansageWarteschlange !== 'undefined' && !ansageWarteschlange) return ansagenSofort('meister-' + art, spielen, erlaubt);
    return rennAnsagen.einreihen('meister-' + art, 16, spielen, erlaubt);
  }

  // EVENT-INTRO: 3,2 s Einblendung (CSS-Animation, nur transform/opacity) und dazu vorbeifahrende Autos.
  const MEISTER_INTRO_MS = 3200;
  let meisterIntroTimer = null;
  function meisterIntroZeigen(idx) {
    const el = $('meister-intro');
    const evs = meister.plan.events, ev = evs[idx];
    if (!el || !ev) return false;
    const f = meisterFormat(ev), lauf = meister.lauf;
    $('mi-kopf').textContent = t('Meisterschaft') + ' · ' + t('Event') + ' ' + (idx + 1) + ' / ' + evs.length;
    $('mi-titel').textContent = meisterStreckeName(ev.strecke);
    $('mi-zeile').textContent = t(f.name) + ' · ' + ev.umfang + ' ' + t(f.einheit) + ' · ' + meisterName(MEISTER_WETTER, ev.wetter);
    let extra = '';
    const kg = lauf && lauf.ballast && lauf.ballast.idx === idx ? lauf.ballast.kg : null;
    if (kg) {
      const k = Object.keys(kg).sort((a, b) => kg[b] - kg[a])[0];
      if (k) extra = t('Erfolgsballast: {n} +{kg} kg').replace('{n}', (lauf.fahrer[k] && lauf.fahrer[k].name) || k).replace('{kg}', kg[k]);
    }
    $('mi-extra').textContent = extra;
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.hidden = false;
    el.classList.remove('an');
    void el.offsetWidth;
    el.classList.add('an');
    clearTimeout(meisterIntroTimer);
    meisterIntroTimer = setTimeout(meisterIntroSchliessen, MEISTER_INTRO_MS);
    meisterVorbeiSpielen();
    return true;
  }
  function meisterIntroSchliessen() {
    clearTimeout(meisterIntroTimer); meisterIntroTimer = null;
    const el = $('meister-intro');
    if (!el) return;
    el.classList.remove('an');
    el.hidden = true;
  }

  // VORBEIFAHRENDE AUTOS: drei Vorbeifahrten aus den geladenen Motorschleifen (sampleEngine), je mit
  // Doppler (Wiedergaberate vor der Vorbeifahrt hoeher, danach tiefer), Lautstaerke nach Abstand und Wanderung
  // links-rechts. Die Knoten (Summe + je Spur Gain und Panner) baut meisterVorbeiKette EINMAL je AudioContext;
  // je Intro kommen nur die drei Pufferquellen dazu, alles vorab geplant - kein Takt, kein Zeitgeber.
  // Lautstaerke: der Motorregler (engineVolume), aus mit dem Ton.
  const MEISTER_VORBEI = [{ ab: 0.1, dauer: 1.7, von: -1 }, { ab: 0.85, dauer: 1.4, von: 1 }, { ab: 1.55, dauer: 1.6, von: -1 }];
  const MEISTER_DOPPLER = 0.13;   // v/c: rund 13 % hoeher beim Heranfahren, 11 % tiefer danach
  let meisterVorbei = null, meisterVorbeiBauten = 0, meisterVorbeiKurven = null;
  function meisterVorbeiKette(ctx) {
    if (!ctx) return null;
    if (meisterVorbei && meisterVorbei.ctx === ctx) return meisterVorbei;
    meisterVorbeiBauten++;
    const summe = ctx.createGain();
    summe.gain.value = 0;
    summe.connect(ctx.destination);
    const spuren = MEISTER_VORBEI.map(() => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (p) { g.connect(p); p.connect(summe); } else g.connect(summe);
      return { g, p };
    });
    meisterVorbei = { ctx, summe, spuren };
    return meisterVorbei;
  }
  // Die Kurven einmal rechnen: x von -1 bis 1 (Mitte = vorbei), Abstand zur Bahn 0,18.
  function meisterVorbeiKurvenBauen() {
    if (meisterVorbeiKurven) return meisterVorbeiKurven;
    const N = 48, d = 0.18, rate = new Float32Array(N), laut = new Float32Array(N), pan = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = -1 + 2 * i / (N - 1), r = Math.sqrt(x * x + d * d);
      rate[i] = 1 / (1 + MEISTER_DOPPLER * (x / r));
      const rand = Math.min(1, (i / (N - 1)) / 0.12, (1 - i / (N - 1)) / 0.12);
      laut[i] = Math.max(0, Math.min(1, (d * d) / (r * r) * 1.0 + 0.05)) * rand;
      pan[i] = Math.max(-1, Math.min(1, x * 1.2));
    }
    meisterVorbeiKurven = { rate, laut, pan, panRueck: pan.map((v) => -v) };
    return meisterVorbeiKurven;
  }
  function meisterVorbeiPuffer() {
    const out = [];
    try {
      const b = typeof sampleEngine !== 'undefined' && sampleEngine ? sampleEngine.buffers : {};
      for (const car of Object.keys(b || {})) {
        const baender = b[car] || {};
        const band = baender.high || baender.mid;
        if (band && band.buffer) out.push(band.buffer);
        if (out.length >= MEISTER_VORBEI.length) break;
      }
    } catch (e) { /* ohne Motortoene */ }
    return out;
  }
  // Rueckgabe: Zahl der geplanten Vorbeifahrten. o: { ctx, puffer, laut } (Selbsttest), sonst die App.
  function meisterVorbeiSpielen(o) {
    o = o || {};
    const ctx = o.ctx || (typeof audioCtx !== 'undefined' ? audioCtx : null);
    if (!ctx || (!o.ctx && (typeof soundEnabled === 'undefined' || !soundEnabled))) return 0;
    const puffer = o.puffer || meisterVorbeiPuffer();
    if (!puffer.length) return 0;
    const laut = o.laut !== undefined ? o.laut : Math.max(0, Math.min(1, typeof engineVolume === 'number' ? engineVolume : 0.7)) * 0.6;
    if (!(laut > 0)) return 0;
    const k = meisterVorbeiKette(ctx), kv = meisterVorbeiKurvenBauen();
    const t0 = ctx.currentTime + 0.05;
    let n = 0;
    try { k.summe.gain.cancelScheduledValues(t0); k.summe.gain.setValueAtTime(laut, t0); } catch (e) { /* weiter */ }
    MEISTER_VORBEI.forEach((v, i) => {
      const spur = k.spuren[i], a = t0 + v.ab;
      try {
        const s = ctx.createBufferSource();
        s.buffer = puffer[i % puffer.length];
        s.loop = true;
        spur.g.gain.cancelScheduledValues(t0);
        spur.g.gain.setValueAtTime(0, t0);
        spur.g.gain.setValueCurveAtTime(kv.laut, a, v.dauer);
        s.playbackRate.setValueCurveAtTime(kv.rate, a, v.dauer);
        if (spur.p) { spur.p.pan.cancelScheduledValues(t0); spur.p.pan.setValueCurveAtTime(v.von < 0 ? kv.pan : kv.panRueck, a, v.dauer); }
        s.connect(spur.g);
        s.onended = () => { try { s.disconnect(); } catch (e) { /* schon getrennt */ } };
        s.start(a);
        s.stop(a + v.dauer + 0.05);
        n++;
      } catch (e) { /* ein laufendes Intro ueberlappt: diese Spur auslassen */ }
    });
    return n;
  }

  // ---- SCHIRM ------------------------------------------------------------------------------
  let msAnsicht = 'plan', msZeile = 0, msDetail = -1, msEvent = 0, msLoeschenArm = -1, msStandFokus = 0;
  let msPadVorher = [], msPadAchse = 0, msOffen = false;
  function meisterOffen() { return msOffen; }
  // Meldungen: im offenen Schirm dort (der Cockpit-Streifen ist dann nicht zu sehen), sonst im Cockpit.
  let msMeldungZeit = null;
  function msMeldung(text) {
    const el = msOffen ? $('ms-toast') : null;
    if (!el) { showHudToast(text); return; }
    el.textContent = text;
    el.classList.add('an');
    clearTimeout(msMeldungZeit);
    msMeldungZeit = setTimeout(() => el.classList.remove('an'), 2200);
  }
  // Das Markup steht in 00-index.head.html (#meister-schirm); hier nur einmal verdrahten.
  function msEl() {
    const el = $('meister-schirm');
    if (el && !el.dataset.verdrahtet) {
      el.dataset.verdrahtet = '1';
      $('ms-zu').addEventListener('click', meisterSchliessen);
      $('ms-liste').addEventListener('click', msListeKlick);
      $('ms-detail').addEventListener('click', msDetailKlick);
    }
    return el;
  }
  function meisterOeffnen(ansicht) {
    meister = meisterLesen();
    const lauf = meister.lauf;
    // Laeuft eine Meisterschaft (auch pausiert vor dem ersten Ergebnis), kommt der Stand mit "Weiter".
    msAnsicht = ansicht || (lauf && !lauf.fertig ? 'stand' : 'plan');
    msZeile = 0; msDetail = -1; msEvent = 0; msLoeschenArm = -1; msStandFokus = 0;
    msPadVorher = []; msPadAchse = 1;   // gehaltene Taste vom Oeffnen nicht gleich auswerten
    const el = msEl();
    if (!el) return;
    // v1.1.3 GEMELDET: "Die obere Zeile mit dem Schliessen-Knopf wird von den Tabs verdeckt (man
    // muss erst auf Omega tippen)." <main> hat z-index 1 und damit einen eigenen Stapel - der
    // fixierte Schirm (z 390) lag darin und blieb unter der Kopfleiste (z 60). Wie die
    // Sitzungsansicht (97-sessions.js): beim Oeffnen direkt unter <body> haengen.
    if (el.parentElement !== document.body) document.body.appendChild(el);
    el.hidden = false;
    msOffen = true;
    msZeichnen();
  }
  function meisterSchliessen() {
    const el = $('meister-schirm');
    if (el) { el.hidden = true; el.querySelector('#ms-liste').innerHTML = ''; el.querySelector('#ms-detail').innerHTML = ''; }
    msOffen = false;
  }
  function msEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function msWert(text, klasse) {
    return '<span class="ms-wert ' + (klasse || '') + '"><span class="ms-pf" data-d="-1">◀</span><span class="ms-w">' + msEsc(text)
      + '</span><span class="ms-pf" data-d="1">▶</span></span>';
  }
  function msLaeuftNoch() { return !!(meister.lauf && !meister.lauf.fertig); }
  function msZeilen() {
    const z = msLaeuftNoch() ? [{ art: 'weiter' }] : [];
    meister.plan.events.forEach((e, i) => z.push({ art: 'ev', i }));
    z.push({ art: 'neu' });
    MEISTER_GLOBAL.forEach((g, i) => z.push({ art: 'gl', i }));
    z.push({ art: 'los' });
    return z;
  }
  function msStreckeBild(s) {
    let tiles = null;
    try {
      if (s === 'aktuell') tiles = currentTrackTiles;
      else if (s !== 'frei') { const st = loadTrackStore()[s]; tiles = st && st.tiles; }
      if (tiles && tiles.length >= 2 && typeof renderTrackPreview === 'function') return renderTrackPreview(tiles, null, { cars: [] }).html;
    } catch (e) { /* ohne Bild */ }
    return '<span class="ms-frei">' + msEsc(s === 'frei' ? t('FREI') : '–') + '</span>';
  }
  function msUnterzeile(ev) {
    const f = meisterFormat(ev);
    return ev.umfang + ' ' + t(f.einheit) + ' · ' + meisterName(MEISTER_WETTER, ev.wetter)
      + (meisterIstRennen(ev)
        ? ' · ' + meisterName(MEISTER_START, ev.start) + (ev.stopps ? ' · ' + ev.stopps + ' ' + t(ev.stopps > 1 ? 'Stopps' : 'Stopp') : '')
        : ' · ' + t('keine Punkte'));
  }
  function msZeichnen() {
    if (!msOffen) return;
    $('ms-titel').textContent = t(msAnsicht === 'plan' ? 'Meisterschaft planen' : 'Meisterschaft');
    if (msAnsicht === 'plan') msPlanZeichnen(); else msStandZeichnen();
  }
  function msPlanZeichnen() {
    const z = msZeilen(), evs = meister.plan.events;
    if (msZeile >= z.length) msZeile = z.length - 1;
    let h = '';
    z.forEach((r, k) => {
      const sel = k === msZeile ? ' sel' : '';
      if (r.art === 'weiter') {
        // v1.0.15 BESTELLT: "Wenn ich eine Meisterschaft pausiert habe, wo kann ich sie dann
        // weiterfahren? ... sollte es einen Knopf geben im Meisterschaftsmenue."
        h += '<button type="button" class="ms-knopf primary ms-weiter' + sel + '" data-k="' + k + '">\u25B6 '
          + msEsc(t('Meisterschaft fortsetzen')) + ' · ' + msEsc(t('Event')) + ' ' + (meister.lauf.idx + 1) + '/' + evs.length + '</button>';
      } else if (r.art === 'ev') {
        const e = evs[r.i], f = meisterFormat(e);
        h += '<div class="ms-ev' + sel + '" data-k="' + k + '"><i style="background:' + MEISTER_FARBEN[r.i % MEISTER_FARBEN.length] + '"></i>'
          + '<span class="ms-nr">' + (r.i + 1) + '</span><span class="ms-bild">' + msStreckeBild(e.strecke) + '</span>'
          + '<span class="ms-name"><b>' + msEsc(meisterStreckeName(e.strecke)) + '</b><span>' + msEsc(msUnterzeile(e)) + '</span></span>'
          + msWert(t(f.name), 'f-' + f.id) + '</div>';
      } else if (r.art === 'neu') {
        h += '<button type="button" class="ms-knopf ms-neu' + sel + '" data-k="' + k + '">' + msEsc(t('+ Event hinzufügen')) + '</button>'
          + '<div class="ms-trenner">' + msEsc(t('Für die ganze Meisterschaft')) + '</div>';
      } else if (r.art === 'gl') {
        const g = MEISTER_GLOBAL[r.i];
        // v1.4.33: WIP-Etikett und Erklaerung hinter dem i im Kreis (wie .opt-label, 98c-opt-info.js).
        const zusatz = (g.wip ? ' <span class="wip-tag">WIP</span>' : '')
          + (g.info ? '<button type="button" class="opt-info-btn" aria-label="' + msEsc(t('Erklärung anzeigen') + ': ' + t(g.l)) + '">i</button>'
            + '<small class="opt-info-versteckt">' + msEsc(t(g.info)) + '</small>' : '');
        h += '<div class="ms-gz' + sel + '" data-k="' + k + '"><span class="ms-l opt-label">' + msEsc(t(g.l)) + zusatz + '</span>'
          + msWert(meisterName(g.w, meisterGlobalWert(g.id))) + '</div>';
      } else {
        h += '<button type="button" class="ms-knopf primary' + sel + '" data-k="' + k + '">'
          + msEsc(t('Meisterschaft starten')) + ' · ' + evs.length + ' ' + msEsc(t('Events'))
          + '</button>';
      }
    });
    const liste = $('ms-liste');
    liste.innerHTML = h;
    msSichtbar(liste);
    $('ms-grid').classList.toggle('detail-aktiv', msDetail >= 0);
    $('ms-hint').textContent = msDetail >= 0 ? t('▲▼ Einstellung · ◀▶ Wert · ○ zurück')
      : t('▲▼ Zeile · ◀▶ ändern · ✕ Event einstellen · ○ schließen');
    msPlanDetailZeichnen();
  }
  function msSichtbar(host) {
    const s = host.querySelector('.sel');
    if (!s) return;
    if (s.offsetTop < host.scrollTop) host.scrollTop = s.offsetTop - 4;
    else if (s.offsetTop + s.offsetHeight > host.scrollTop + host.clientHeight) host.scrollTop = s.offsetTop + s.offsetHeight - host.clientHeight + 4;
  }
  function msDetailZeilen(i) {
    const e = meister.plan.events[i], r = meisterIstRennen(e), f = meisterFormat(e);
    return [
      { l: 'Strecke', w: meisterStreckeName(e.strecke), feld: 'strecke' },
      { l: 'Format', w: t(f.name), feld: 'format' },
      { l: 'Umfang', w: e.umfang + ' ' + t(f.einheit), feld: 'umfang' },
      { l: 'Wetter', w: meisterName(MEISTER_WETTER, e.wetter), feld: 'wetter' },
      { l: 'Start', w: r ? meisterName(MEISTER_START, e.start) : t('entfällt'), feld: 'start', aus: !r },
      { l: 'Startaufstellung', w: r ? meisterName(MEISTER_AUFST, e.aufst) : t('entfällt'), feld: 'aufst', aus: !r, fehlt: !!meisterAufstFehler(i) },
      { l: 'Pflichtstopps', w: r ? (e.stopps ? String(e.stopps) : t('Keine')) : t('entfällt'), feld: 'stopps', aus: !r },
      // v1.0.22 BESTELLT: "FRUEHER nur mit dem Dreieck-Pfeil nach oben, LOESCHEN nur mit roetlicher
      // Muelltonne, und dafuer auch einen SPAETER-Button (Dreieck nach unten)".
      { knopf: 'hoch', l: 'Früher', zeichen: '▲' }, { knopf: 'runter', l: 'Später', zeichen: '▼' },
      { knopf: 'kopie', l: 'Kopieren' },
      { knopf: 'weg', l: msLoeschenArm === i ? 'Wirklich löschen?' : 'Löschen', tonne: true, arm: msLoeschenArm === i },
    ];
  }
  function msPlanDetailZeichnen() {
    const z = msZeilen()[msZeile], host = $('ms-detail');
    let h = '';
    if (z && z.art === 'ev') msEvent = z.i;
    if (msDetail < 0 && z && z.art === 'gl') {
      const g = MEISTER_GLOBAL[z.i];
      h += '<h3>' + msEsc(t(g.l)) + '</h3>';
      if (g.id === 'fahrgefuehl') h += '<p class="ms-info">' + msEsc(t('Wie in der Garage: jedes Telefon fährt mit seinem eigenen Fahrgefühl. Alle wie Spieler 1: im Mehrspieler bekommen alle Telefone das des Meisterschaftsleiters. Ein festes Preset gilt für alle gesteuerten Autos. NPCs betrifft das nicht.')) + '</p>';
      if (g.id === 'start1') h += '<p class="ms-info">' + msEsc(t('Gilt fürs erste Rennen, wenn davor kein Qualifying liegt. Beste heißt: schnellste gespeicherte Runde auf dieser Strecke; ohne Daten entscheidet der Zufall. Danach bestimmen die Punkte die Aufstellung (je Event änderbar).')) + '</p>';
      if (g.id === 'punkte' || g.id === 'fl') {
        const schema = meisterGlobalWert('punkte');
        h += '<p class="ms-info">' + msEsc(t('Punkte je Platz bei 6 Autos')) + (meisterGlobalWert('fl') === 'ja' ? ', <b>+1</b> ' + msEsc(t('für die schnellste Runde eines Rennens')) : '') + ':</p><div class="ms-punkte">';
        for (let p = 0; p < (schema === 'f1' ? 10 : 6); p++) h += '<div>P' + (p + 1) + '<b>' + meisterPunkteFuer(schema, p, 6) + '</b></div>';
        h += '</div><p class="ms-info">' + msEsc(t('Gleichstand: mehr Siege, dann mehr zweite Plätze, dann das letzte Rennen.')) + '</p>';
      }
      if (g.id === 'ballast') {
        const max = MEISTER_BALLAST_KG[meisterGlobalWert('ballast')] || 0;
        h += '<div class="ms-punkte">' + [['Führender', max], ['Mitte', Math.round(max / 2)], ['Letzter', 0], ['1. Event', 0]]
          .map((x) => '<div>' + msEsc(t(x[0])) + '<b>' + (x[1] ? '+' + x[1] : '0') + ' kg</b></div>').join('') + '</div>';
      }
      if (g.id === 'teilnehmer') h += '<p class="ms-info">' + msEsc(t('Alle verbundenen Autos: Spieler 1–3, NPCs und im Mehrspieler die anderen Telefone werden gewertet. Nur Spieler: NPCs fahren als Verkehr mit, bekommen aber keine Punkte. Das Safety Car fährt nie in der Wertung.')) + '</p>';
    } else if (msDetail < 0 && z && z.art === 'los') {
      h += '<h3>' + msEsc(t('Bereit?')) + '</h3>';
      const fehler = meister.plan.events.map((e, i) => { const f = meisterAufstFehler(i); return f ? t('Event') + ' ' + (i + 1) + ': ' + f : ''; }).filter(Boolean);
      const rennen = meister.plan.events.filter(meisterIstRennen).length;
      if (!rennen) fehler.push(t('Mindestens ein Event muss Runden oder Endurance sein.'));
      const autos = garage.filter((c) => c.device && c.role !== 'safetycar' && c.role !== 'reinig' && c.role !== 'challenger' && meisterDarfMit(c.role)).map(garageLabel);
      h += '<p class="ms-info">' + meister.plan.events.length + ' ' + msEsc(t('Events')) + ', ' + rennen + ' ' + msEsc(t('mit Punkten')) + '. '
        + msEsc(t('Verbunden')) + ': ' + (autos.length ? autos.map(msEsc).join(', ') : msEsc(t('kein Auto'))) + '.</p>';
      const andere = meisterMpAndere();
      if (andere.length) h += '<p class="ms-info">' + msEsc(t('Mehrspieler: du leitest die Meisterschaft. Jedes Event startet für alle, mit')) + ' ' + andere.map((f) => msEsc(f.name || f.id)).join(', ') + '.</p>';
      h += fehler.length ? '<p class="ms-info ms-rot">' + fehler.map(msEsc).join('<br>') + '</p>'
        : '<p class="ms-info">' + msEsc(t('✕ startet Event 1. Zwischen den Events kommt der Zwischenstand.')) + '</p>';
      if (meister.lauf && !meister.lauf.fertig && meister.lauf.idx > 0) h += '<p class="ms-info ms-rot">' + msEsc(t('Eine laufende Meisterschaft wird dabei beendet.')) + '</p>';
    } else {
      const i = Math.min(msEvent, meister.plan.events.length - 1), e = meister.plan.events[i];
      h += '<h3>' + msEsc(t('Event')) + ' ' + (i + 1) + '<small>' + msEsc(t(meisterIstRennen(e) ? 'mit Punkten' : 'ohne Punkte')) + '</small></h3>';
      const dz = msDetailZeilen(i);
      dz.forEach((r, k) => {
        const sel = k === msDetail ? ' sel' : '';
        if (r.knopf) {
          if (k === 7) h += '<div class="ms-fuss">';
          const inhalt = r.zeichen ? r.zeichen
            : r.tonne ? MS_TONNE + (r.arm ? ' ' + msEsc(t('Wirklich?')) : '')
            : msEsc(t(r.l));
          h += '<button type="button" class="ms-knopf' + (r.knopf === 'weg' ? ' ms-weg' : '') + (r.zeichen || r.tonne ? ' ms-symbol' : '') + sel
            + '" data-d="' + k + '" aria-label="' + msEsc(t(r.l)) + '" title="' + msEsc(t(r.l)) + '">' + inhalt + '</button>';
          if (k === dz.length - 1) h += '</div>';
          return;
        }
        h += '<div class="ms-wz' + sel + (r.aus ? ' aus' : '') + (r.fehlt ? ' fehlt' : '') + '" data-d="' + k + '"><span class="ms-l">' + msEsc(t(r.l)) + '</span>' + msWert(r.w) + '</div>';
      });
      const info = meisterIstRennen(e) ? t('Aufstellung') + ': ' + meisterAufstText(i) + '.'
        : (e.format === 'qualifying' ? t('Bestimmt die Aufstellung des nächsten Rennens.') : t('Zum Einfahren, ohne Wertung.'));
      const fe = meisterAufstFehler(i);
      h += '<p class="ms-info">' + msEsc(info) + (fe ? ' <span class="ms-rot">' + msEsc(fe) + '</span>' : '') + '</p>';
    }
    host.innerHTML = h;
    msSichtbar(host);
  }
  function msStandKnoepfe() {
    const lauf = meister.lauf;
    if (!lauf) return [['plan', 'Meisterschaft planen']];
    if (lauf.fertig) return [['neu', 'Neue Meisterschaft planen'], ['zu', 'Schließen']];
    return [['weiter', 'Weiter: Event'], ['zu', 'Pause · später weiter'], ['plan', 'Plan ansehen'], ['ende', 'Meisterschaft beenden']];
  }
  function msStandZeichnen() {
    const lauf = meister.lauf, evs = meister.plan.events;
    if (!lauf) { msAnsicht = 'plan'; msPlanZeichnen(); return; }
    $('ms-grid').classList.remove('detail-aktiv');
    const tab = meisterTabelle(lauf);
    const n = Math.min(lauf.idx, evs.length);
    // v1.4.33: der Erfolgsballast fuer das naechste Event, je Fahrer.
    const kgNaechst = meisterBallastFuer(lauf, lauf.idx);
    const spalten = [];
    for (let i = Math.max(0, n - 4); i < n; i++) spalten.push(i);
    let h = '<div class="ms-trenner">' + msEsc(lauf.fertig ? t('Endstand') : t('Zwischenstand nach Event') + ' ' + n + ' / ' + evs.length) + '</div>';
    if (!tab.length) h += '<p class="ms-info">' + msEsc(t('Noch keine Wertung.')) + '</p>';
    else {
      h += '<table class="ms-stand"><tr><th></th><th>' + msEsc(t('Auto')) + '</th>'
        + spalten.map((i) => '<th>' + (evs[i].format === 'qualifying' ? 'Q' : (evs[i].format === 'training' ? 'T' : 'R')) + (i + 1) + '</th>').join('')
        + '<th class="r">' + msEsc(t('Punkte')) + '</th></tr>';
      tab.forEach((x, k) => {
        h += '<tr><td class="pos p' + (k + 1) + '">' + (k + 1) + '</td><td><span class="ms-band" style="background:' + (x.farbe || '#9aa4b8') + '"></span>'
          + msEsc(x.name) + (x.rolle === 'ghost' ? ' <span class="ms-rl">NPC</span>' : '')
          + (kgNaechst[x.key] > 0 ? ' <span class="ms-kg">+' + kgNaechst[x.key] + ' kg</span>' : '') + '</td>'
          + spalten.map((i) => {
            const e = x.je[i];
            if (!e) return '<td class="e">–</td>';
            if (e.ab) return '<td class="e" title="' + msEsc(t('abgebrochen')) + '">' + (e.pkt === undefined ? '✕' : '0') + '</td>';
            if (e.pkt === undefined) return '<td class="e">' + (e.pos ? 'P' + e.pos : '–') + '</td>';
            return '<td class="e">' + e.pkt + (e.fl ? '<sup>FL</sup>' : '') + '</td>';
          }).join('') + '<td class="pkt">' + x.pkt + '</td></tr>';
      });
      h += '</table>';
    }
    if (lauf.fertig && tab.length) h = '<div class="ms-meister">🏆 ' + msEsc(tab[0].name) + ' · ' + msEsc(t('Meister')) + '</div>' + h;
    $('ms-liste').innerHTML = h;
    let d = '';
    if (!lauf.fertig) {
      const ev = evs[lauf.idx];
      d += '<span class="ms-info">' + msEsc(t('Nächstes Event')) + ' · ' + (lauf.idx + 1) + ' / ' + evs.length + '</span>'
        + '<span class="ms-titel">' + msEsc(meisterStreckeName(ev.strecke)) + ' · ' + msEsc(t(meisterFormat(ev).name)) + ' ' + ev.umfang + ' ' + msEsc(t(meisterFormat(ev).einheit)) + '</span>'
        + '<span class="ms-info">' + msEsc(msUnterzeile(ev)) + '</span>';
      if (meisterIstRennen(ev)) {
        d += '<span class="ms-info">' + msEsc(t('Startaufstellung')) + ': ' + msEsc(meisterAufstText(lauf.idx)) + '</span>';
        const reihe = meisterStartReiheFest(lauf.idx).map((id) => garage.find((c) => String(c.device.id) === id)).filter(Boolean);
        if (reihe.length)
          d += '<div class="ms-aufst">' + reihe.map((c, i) => {
            const kg = meisterBallastKgVon(kgNaechst, c);
            return '<div>' + (i + 1) + ' · ' + msEsc(garageLabel(c)) + (kg ? ' <span class="ms-kg">+' + kg + ' kg</span>' : '')
              + ' <small>' + msEsc(meisterPlatzText(i)) + '</small></div>';
          }).join('') + '</div>';
      }
      if (ev.strecke !== 'aktuell' && ev.strecke !== 'frei') d += '<span class="ms-info ms-gelb">' + msEsc(t('Strecke umbauen')) + ': ' + msEsc(ev.strecke) + '</span>';
    } else d += '<span class="ms-titel">' + msEsc(t('Meisterschaft beendet')) + '</span>';
    const k = msStandKnoepfe();
    if (msStandFokus >= k.length) msStandFokus = k.length - 1;
    d += '<div class="ms-fuss ms-fuss-senk">' + k.map((b, i) => '<button type="button" class="ms-knopf' + (i === 0 ? ' primary' : '') + (i === msStandFokus ? ' sel' : '')
      + '" data-akt="' + b[0] + '">' + msEsc(t(b[1])) + (b[0] === 'weiter' ? ' ' + (lauf.idx + 1) : '') + '</button>').join('') + '</div>';
    $('ms-detail').innerHTML = d;
    $('ms-hint').textContent = t('▲▼ wählen · ✕ bestätigen · ○ schließen');
  }

  // ---- BEDIENUNG -----------------------------------------------------------------------------
  function msRund(v, n) { return ((v % n) + n) % n; }
  function msAendern(i, feld, d) {
    const e = meister.plan.events[i];
    const f = meisterFormat(e);
    if (feld === 'umfang') {
      const schritt = f.einheit === 'Runden' ? 1 : (e.umfang >= 10 ? 5 : 1);
      const neu = Math.max(1, Math.min(f.einheit === 'Runden' ? 200 : 240, e.umfang + d * schritt));
      if (neu === e.umfang && d < 0) msMeldung(t('Mindestens 1, jedes Event braucht eine klare Dauer'));
      e.umfang = neu;
    } else if (feld === 'format') {
      const k = MEISTER_FORMATE.findIndex((x) => x.id === e.format);
      e.format = MEISTER_FORMATE[msRund(k + d, MEISTER_FORMATE.length)].id;
      if (meisterFormat(e).einheit !== f.einheit) e.umfang = meisterFormat(e).einheit === 'Runden' ? 15 : (e.format === 'endurance' ? 20 : 5);
    } else if (feld === 'strecke') {
      const s = meisterStrecken();
      e.strecke = s[msRund(s.indexOf(e.strecke) + d, s.length)];
    } else if (feld === 'stopps') {
      e.stopps = msRund((e.stopps | 0) + d, 4);
    } else {
      const liste = { wetter: MEISTER_WETTER, start: MEISTER_START, aufst: MEISTER_AUFST }[feld];
      const k = liste.findIndex((w) => w[0] === e[feld]);
      e[feld] = liste[msRund(k + d, liste.length)][0];
    }
    meisterSpeichern();
  }
  function msLinks(d) {
    if (msAnsicht !== 'plan') { msHoch(d); return; }
    if (msDetail >= 0) {
      const r = msDetailZeilen(msEvent)[msDetail];
      if (r && !r.aus && !r.knopf) { msAendern(msEvent, r.feld, d); msLoeschenArm = -1; }
      msZeichnen(); return;
    }
    const z = msZeilen()[msZeile];
    if (z.art === 'ev') msAendern(z.i, 'format', d);
    else if (z.art === 'gl') {
      const g = MEISTER_GLOBAL[z.i];
      const k = g.w.findIndex((w) => w[0] === meisterGlobalWert(g.id));
      meister.plan.global[g.id] = g.w[msRund(k + d, g.w.length)][0];
      meisterSpeichern();
    }
    msZeichnen();
  }
  function msHoch(d) {
    if (msAnsicht !== 'plan') {
      msStandFokus = Math.max(0, Math.min(msStandKnoepfe().length - 1, msStandFokus + d));
      msZeichnen(); return;
    }
    if (msDetail >= 0) {
      const dz = msDetailZeilen(msEvent);
      let k = msDetail;
      do { k += d; } while (k >= 0 && k < dz.length && dz[k].aus);
      if (k >= 0 && k < dz.length) msDetail = k;
    } else msZeile = Math.max(0, Math.min(msZeilen().length - 1, msZeile + d));
    msZeichnen();
  }
  function msBestaetigen() {
    if (msAnsicht !== 'plan') { const k = msStandKnoepfe()[msStandFokus]; if (k) msStandAktion(k[0]); return; }
    if (msDetail >= 0) {
      const r = msDetailZeilen(msEvent)[msDetail];
      if (r && r.knopf) msEventAktion(r.knopf);
      else msLinks(1);
      return;
    }
    const z = msZeilen()[msZeile];
    if (z.art === 'weiter') { msAnsicht = 'stand'; msStandFokus = 0; }
    else if (z.art === 'ev') { msEvent = z.i; msDetail = 0; }
    else if (z.art === 'neu') msNeu();
    else if (z.art === 'los') { msStarten(); return; }
    else if (z.art === 'gl') { msLinks(1); return; }
    msZeichnen();
  }
  function msZurueck() {
    if (msAnsicht === 'plan' && msDetail >= 0) { msDetail = -1; msLoeschenArm = -1; msZeile = msEvent; msZeichnen(); return; }
    meisterSchliessen();
  }
  function msNeu() {
    if (meister.plan.events.length >= MEISTER_MAX_EVENTS) { msMeldung(t('Höchstens 10 Events')); return; }
    meister.plan.events.push(meisterEventNeu());
    msEvent = meister.plan.events.length - 1; msZeile = msEvent; msDetail = 0;
    meisterSpeichern();
  }
  var MS_TONNE = '<svg class="ms-tonne" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
  function msEventAktion(a) {
    const evs = meister.plan.events, i = msEvent;
    if (a === 'weg') {
      if (evs.length <= 1) { msMeldung(t('Eine Meisterschaft braucht mindestens ein Event')); return; }
      if (msLoeschenArm !== i) { msLoeschenArm = i; msZeichnen(); return; }
      evs.splice(i, 1);
      msLoeschenArm = -1; msEvent = Math.min(i, evs.length - 1); msZeile = msEvent; msDetail = -1;
    } else if (a === 'kopie') {
      if (evs.length >= MEISTER_MAX_EVENTS) { msMeldung(t('Höchstens 10 Events')); return; }
      evs.splice(i + 1, 0, JSON.parse(JSON.stringify(evs[i])));
      msEvent = i + 1; msZeile = i + 1;
    } else if (a === 'hoch' && i > 0) {
      const x = evs[i - 1]; evs[i - 1] = evs[i]; evs[i] = x;
      msEvent = i - 1; msZeile = i - 1;
    } else if (a === 'runter' && i < evs.length - 1) {
      const x = evs[i + 1]; evs[i + 1] = evs[i]; evs[i] = x;
      msEvent = i + 1; msZeile = i + 1;
    }
    meisterSpeichern();
    msZeichnen();
  }
  function msStarten() {
    const fehler = meister.plan.events.map((e, i) => meisterAufstFehler(i)).find(Boolean);
    if (fehler) { msMeldung(fehler); return; }
    if (!meister.plan.events.some(meisterIstRennen)) { msMeldung(t('Mindestens ein Event muss Runden oder Endurance sein.')); return; }
    meister.lauf = meisterLaufNeu();
    meisterBallastSetzen(null);
    meisterSpeichern();
    // v1.4.54 (WIP): "Willkommen zur Meisterschaft. N Events stehen an." vor dem Intro von Event 1.
    meisterAnsagen('willkommen', { n: meister.plan.events.length });
    meisterEventStarten();
  }
  function msStandAktion(a) {
    if (a === 'weiter') meisterEventStarten();
    else if (a === 'zu') meisterSchliessen();
    else if (a === 'plan' || a === 'neu') { if (a === 'neu') { meister.lauf = null; meisterSpeichern(); } msAnsicht = 'plan'; msZeile = 0; msDetail = -1; msZeichnen(); }
    else if (a === 'ende') {
      // Zweimal druecken: das erste Mal nur scharf machen (kein nativer Dialog).
      if (Date.now() - msEndeArm < 4000) {
        meister.lauf.fertig = true; meisterBallastSetzen(null); meisterSpeichern(); msStandFokus = 0; msEndeArm = 0; msZeichnen(); return;
      }
      msEndeArm = Date.now();
      msMeldung(t('Nochmal drücken zum Beenden'));
    }
  }
  let msEndeArm = 0;
  function msListeKlick(ev) {
    if (msAnsicht !== 'plan') return;
    // v1.4.33: das i im Kreis oeffnet die Erklaerung (dieselbe Lightbox wie bei den Optionen).
    const ib = ev.target.closest('.opt-info-btn');
    if (ib) {
      ev.stopPropagation();
      const zk = ib.closest('[data-k]');
      const zeile = zk ? msZeilen()[+zk.getAttribute('data-k')] : null;
      const g = zeile && zeile.art === 'gl' ? MEISTER_GLOBAL[zeile.i] : null;
      const sm = ib.parentElement.querySelector('small');
      if (g && sm && typeof optInfoOeffnen === 'function') optInfoOeffnen(t(g.l), sm.innerHTML);
      return;
    }
    const el = ev.target.closest('[data-k]');
    if (!el) return;
    msDetail = -1; msLoeschenArm = -1;
    msZeile = +el.getAttribute('data-k');
    const pf = ev.target.closest('.ms-pf');
    if (pf) { msLinks(+pf.getAttribute('data-d')); return; }
    const z = msZeilen()[msZeile];
    if (z.art === 'neu' || z.art === 'los' || z.art === 'weiter') { msBestaetigen(); return; }
    msZeichnen();
  }
  function msDetailKlick(ev) {
    const b = ev.target.closest('[data-akt]');
    if (b) { msStandFokus = msStandKnoepfe().findIndex((k) => k[0] === b.getAttribute('data-akt')); msStandAktion(b.getAttribute('data-akt')); return; }
    const el = ev.target.closest('[data-d]');
    if (!el || el.classList.contains('aus') || msAnsicht !== 'plan') return;
    msDetail = +el.getAttribute('data-d');
    const pf = ev.target.closest('.ms-pf');
    if (pf) { msLinks(+pf.getAttribute('data-d')); return; }
    if (el.tagName === 'BUTTON') { msBestaetigen(); return; }
    msZeichnen();
  }
  // Steuerkreuz und Tasten (aus pollGamepad, vor allen anderen Menues). true = verbraucht.
  function meisterPad(pad) {
    if (!msOffen || (typeof konsoleFrageOffen === 'function' && konsoleFrageOffen())) return false;
    if (typeof optInfoOffen === 'function' && optInfoOffen()) return false;
    let neu = -1;
    for (let i = 0; i < pad.buttons.length; i++) {
      const n = !!(pad.buttons[i] && pad.buttons[i].pressed);
      if (n && !msPadVorher[i]) neu = i;
      msPadVorher[i] = n;
    }
    const ax = pad.axes || [];
    const achse = Math.abs(ax[1] || 0) > 0.6 ? (ax[1] > 0 ? 2 : -2) : (Math.abs(ax[0] || 0) > 0.6 ? (ax[0] > 0 ? 1 : -1) : 0);
    const achseNeu = achse !== msPadAchse ? achse : 0;
    msPadAchse = achse;
    if (neu === 12 || achseNeu === -2) msHoch(-1);
    else if (neu === 13 || achseNeu === 2) msHoch(1);
    else if (neu === 14 || achseNeu === -1) msLinks(-1);
    else if (neu === 15 || achseNeu === 1) msLinks(1);
    else if (neu === 0) msBestaetigen();
    else if (neu === 1) msZurueck();
    return true;
  }
  window.addEventListener('keydown', (e) => {
    if (!msOffen || (typeof konsoleFrageOffen === 'function' && konsoleFrageOffen())) return;
    if (typeof optInfoOffen === 'function' && optInfoOffen()) return;
    const k = e.key;
    if (k === 'ArrowUp') msHoch(-1); else if (k === 'ArrowDown') msHoch(1);
    else if (k === 'ArrowLeft') msLinks(-1); else if (k === 'ArrowRight') msLinks(1);
    else if (k === 'Enter' || k === ' ') msBestaetigen();
    else if (k === 'Escape' || k === 'Backspace') msZurueck();
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);
