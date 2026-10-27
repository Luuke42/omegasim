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
      ['arcade', 'Alle: Arcade'], ['simplus', 'Alle: Sim+'], ['pro', 'Alle: Pro'], ['propacejka', 'Alle: Pacejka'], ['omega', 'Alle: Omega'], ['rc', 'Alle: RC (WIP)']] },
    { id: 'start1', l: 'Startaufstellung 1. Event', w: [['zufall', 'Zufall'], ['beste_zuletzt', 'Beste zuletzt'],
      ['beste_zuerst', 'Beste zuerst'], ['garage', 'Garagen-Reihenfolge']] },
    { id: 'punkte', l: 'Punkte', w: [['f1', 'F1 · 25-18-15-12-10'], ['klassisch', 'Klassisch · 10-6-4-3-2'],
      ['linear', 'Linear · N … 1']] },
    { id: 'fl', l: 'Schnellste Runde', w: [['ja', '+1 Punkt'], ['nein', 'Keine Punkte']] },
    { id: 'teilnehmer', l: 'Teilnehmer', w: [['alle', 'Alle verbundenen Autos'], ['spieler', 'Nur Spieler (P1–P3)']] },
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
      global: { fahrgefuehl: 'garage', start1: 'zufall', punkte: 'f1', fl: 'ja', teilnehmer: 'alle' },
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
      let total = ms.reduce((a, b) => a + b, 0);
      // Verpasste Pflichtstopps: fuer jedes gesteuerte Auto (Spieler 1-3), v1.0.12.
      const platz = typeof spielerPlatzVonRolle === 'function' ? spielerPlatzVonRolle(c.role) : 0;
      if (platz && typeof strafeMsVon === 'function') total += strafeMsVon(platz);
      const key = c.id ? 'c:' + c.id : 'c:spieler';
      info[key] = { name: c.name, farbe: c.farbe, rolle: c.role };
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
    meisterSpeichern();
    meisterSchliessen();
    msMeldung(t('Meisterschaft') + ' · ' + t('Event') + ' ' + (lauf.idx + 1) + '/' + meister.plan.events.length);
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
    if (lauf.laeuft.modus !== raceMode || Date.now() - lauf.laeuft.seit > 6 * 3600000) { lauf.laeuft = null; meisterSpeichern(); return false; }
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
    if (!ev) return;
    const m = meisterFeldMessen(ev);
    if (abgebrochen) { m.reihe = []; m.lokal = []; }
    // Jeder, der mitfuhr, bekommt eine Zeile, auch ohne Punkte.
    Object.keys(m.info).forEach((k) => {
      if (!lauf.fahrer[k]) lauf.fahrer[k] = { name: m.info[k].name, farbe: m.info[k].farbe, rolle: m.info[k].rolle, pkt: 0, je: [] };
      const f = lauf.fahrer[k];
      f.name = m.info[k].name || f.name;
      if (m.info[k].farbe) f.farbe = m.info[k].farbe;
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
    // Erst das Rennergebnis sehen lassen, dann den Stand.
    setTimeout(() => meisterOeffnen('stand'), 2500);
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
      strecke: meisterStreckeMp, stand: meisterStandKurz(lauf),
    };
  }
  function meisterMpPreset() {
    const fg = meisterGlobalWert('fahrgefuehl');
    if (!meister.lauf || !meister.lauf.laeuft || fg === 'garage') return null;
    if (fg === 'p1') return window.__presetActive ? window.__presetActive() : null;
    return fg;
  }
  function meisterStandKurz(lauf) {
    return meisterTabelle(lauf).slice(0, 12).map((x) => ({ n: String(x.name || '').slice(0, 24), p: x.pkt }));
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
        + '</td><td>' + (s.p | 0) + '</td></tr>').join('') + '</table>';
    }
    return h;
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
        h += '<div class="ms-gz' + sel + '" data-k="' + k + '"><span class="ms-l">' + msEsc(t(g.l)) + '</span>'
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
          + msEsc(x.name) + (x.rolle === 'ghost' ? ' <span class="ms-rl">NPC</span>' : '') + '</td>'
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
          d += '<div class="ms-aufst">' + reihe.map((c, i) => '<div>' + (i + 1) + ' · ' + msEsc(garageLabel(c))
            + ' <small>' + msEsc(meisterPlatzText(i)) + '</small></div>').join('') + '</div>';
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
    meisterSpeichern();
    meisterEventStarten();
  }
  function msStandAktion(a) {
    if (a === 'weiter') meisterEventStarten();
    else if (a === 'zu') meisterSchliessen();
    else if (a === 'plan' || a === 'neu') { if (a === 'neu') { meister.lauf = null; meisterSpeichern(); } msAnsicht = 'plan'; msZeile = 0; msDetail = -1; msZeichnen(); }
    else if (a === 'ende') {
      // Zweimal druecken: das erste Mal nur scharf machen (kein nativer Dialog).
      if (Date.now() - msEndeArm < 4000) {
        meister.lauf.fertig = true; meisterSpeichern(); msStandFokus = 0; msEndeArm = 0; msZeichnen(); return;
      }
      msEndeArm = Date.now();
      msMeldung(t('Nochmal drücken zum Beenden'));
    }
  }
  let msEndeArm = 0;
  function msListeKlick(ev) {
    if (msAnsicht !== 'plan') return;
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
    const k = e.key;
    if (k === 'ArrowUp') msHoch(-1); else if (k === 'ArrowDown') msHoch(1);
    else if (k === 'ArrowLeft') msLinks(-1); else if (k === 'ArrowRight') msLinks(1);
    else if (k === 'Enter' || k === ' ') msBestaetigen();
    else if (k === 'Escape' || k === 'Backspace') msZurueck();
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);
