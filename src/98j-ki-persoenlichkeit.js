  // ============================== KI-PERSOENLICHKEIT DER NPCs (WIP) ==============================
  //
  // v1.5 BESTELLT (Plan Paket 7): "KI-Persoenlichkeit: Knopf je NPC-Auto in der Garage, analog zu
  // Setup bei Spielerautos, mit genauen Einstellungen (Mut, Konstanz, Nerven, Lerntempo,
  // Reifenschonung) und Streckengedaechtnis."
  //
  // Uebernommen aus Hybrid-Dash 4.0 von Mo Kamit (MIT-Lizenz), Datei 98zd-hd4-ki.js ("The driver
  // brain"), angepasst an OmegaSim 1.5:
  //   - ein Schalter JE NPC und ab Werk AUS: das Fahrverhalten echter Autos aendert sich nur, wer es
  //     will (der Fahrercharakter je Rennen in den Optionen bleibt davon unberuehrt);
  //   - die fuenf Eigenschaften kommen wie bei Mokamit aus dem Namen (bleiben also gleich), lassen
  //     sich aber im Fenster einzeln verstellen;
  //   - engere Grenzen als bei Mokamit (0,85 bis 1,04 statt 0,78 bis 1,14), weil echte Autos unter
  //     etwa 35 % die Bahn nicht mehr lesen und ueber der eingestellten Stufe abfliegen;
  //   - ein Haken statt zwei: kiTempo() in ghostTick (90-ghosts.js) erkennt den Kachelwechsel selbst.
  //
  // Was die KI tut (nur bei Gruen im Rennen, nie unter Gelb, in der Box oder in der Startrunde):
  //   1. Streckengedaechtnis: je Kachel ein Tempofaktor. Neue Strecke: Besichtigungstempo; jede
  //      saubere Durchfahrt gibt etwas Vertrauen, ein Abflug kostet auf der Kachel und der davor.
  //      Gespeichert je Strecke und Auto (die 12 zuletzt gefahrenen Strecken).
  //   2. Gegner: wo ein Ueberholen gegen wen geklappt hat, dort wird wieder angegriffen.
  //   3. Menschliches: Form in Wellen (wenig Konstanz = mehr Welle), Zoegern unter Druck (wenig
  //      Nerven), Vorsicht nach einem Abflug, gleichmaessiger Rhythmus allein auf der Strecke
  //      (Reifenschonung).

  const KI_STORE = 'omegasim-ki.v1';
  const KI_GRENZE = [0.85, 1.04];        // der Faktor auf das Zieltempo, immer
  const KI_SICHT = 0.95;                 // Besichtigungstempo auf einer neuen Strecke
  const KI_STRECKEN_MAX = 12;
  const KI_EIGENSCHAFTEN = [
    { id: 'mut', name: 'Mut', text: 'Spät bremsen, früh angreifen. Hebt auch die Obergrenze des Streckentempos.' },
    { id: 'konstanz', name: 'Konstanz', text: 'Wenig Konstanz: das Tempo schwankt über einen Stint in Wellen um bis zu 2 %.' },
    { id: 'nerven', name: 'Nerven', text: 'Wenig Nerven: zögert, wenn jemand länger dicht dahinter fährt, und bleibt nach einem Abflug länger vorsichtig.' },
    { id: 'lern', name: 'Lerntempo', text: 'Wie schnell eine neue Strecke Kachel für Kachel schneller wird.' },
    { id: 'pflege', name: 'Reifenschonung', text: 'Allein auf der Strecke fährt ein schonender Fahrer einen haltbaren Rhythmus statt Qualifikationsrunden.' },
  ];
  const KI_TYPEN = [
    { id: 'aggressor', name: 'Angreifer', text: 'Spät auf der Bremse, als Erster im Angriff.' },
    { id: 'metronom', name: 'Metronom', text: 'Runde für Runde auf eine Zehntel genau.' },
    { id: 'stratege', name: 'Stratege', text: 'Schont die Reifen, schlägt spät im Stint zu.' },
    { id: 'rookie', name: 'Neuling', text: 'Schnell, aber wackelt unter Druck.' },
    { id: 'veteran', name: 'Routinier', text: 'Kennt eine Strecke nach drei Runden und macht selten Fehler.' },
  ];

  function kiLesen() {
    try {
      const s = JSON.parse(localStorage.getItem(KI_STORE) || 'null');
      if (s && typeof s === 'object') return { personen: s.personen || {}, strecken: s.strecken || {} };
    } catch (e) { /* privat oder kaputt */ }
    return { personen: {}, strecken: {} };
  }
  // var: renderGarage (90-ghosts.js) fragt schon beim Laden nach der Garage-Zeile.
  var kiDaten = null;
  let kiSchmutzig = false;
  function kiD() { if (!kiDaten) kiDaten = kiLesen(); return kiDaten; }
  function kiSichern() {
    if (!kiSchmutzig) return;
    const d = kiD();
    const keys = Object.keys(d.strecken).sort((a, b) => (d.strecken[b].datum || 0) - (d.strecken[a].datum || 0));
    keys.slice(KI_STRECKEN_MAX).forEach((k) => delete d.strecken[k]);
    Object.values(d.strecken).forEach((s) => Object.values(s.fahrer).forEach((m) => { m.f = m.f.map((x) => Math.round(x * 1000) / 1000); }));
    try { localStorage.setItem(KI_STORE, JSON.stringify(d)); } catch (e) { /* privat */ }
    kiSchmutzig = false;
  }
  setInterval(kiSichern, 20000);

  function kiHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function kiZufall01(s, salz) { return (kiHash(String(s) + '|' + salz) % 100000) / 100000; }
  function kiKlemme(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function kiAutoId(car) { return car && car.device ? String(car.device.id) : null; }
  function kiAutoName(car) { try { return car.alias || car.tag || garageLabel(car); } catch (e) { return '?'; } }
  function kiStreckeKey() {
    try { return currentTrackTiles && currentTrackTiles.length >= 3 ? bestzeitSchluessel(currentTrackTiles) : null; } catch (e) { return null; }
  }

  // ---- Persoenlichkeit: aus dem Namen, einzeln verstellbar ----
  function kiVorgabe(car) {
    const name = (car && car.device && car.device.name ? car.device.name : '') + '|' + (kiAutoId(car) || '');
    const r = (salz) => Math.round(kiZufall01(name, salz) * 10) / 10;
    return { an: false, mut: r('mut'), konstanz: r('konstanz'), nerven: r('nerven'), lern: r('lern'), pflege: r('pflege') };
  }
  function kiPerson(car) {
    const id = kiAutoId(car);
    const p = Object.assign(kiVorgabe(car), (id && kiD().personen[id]) || {});
    p.lernrate = 0.6 + 0.8 * p.lern;
    // Der Typ ist die Ueberschrift der staerksten Eigenschaft: er beschreibt die Zahlen, er setzt sie nicht.
    let typ = 'metronom';
    if (p.mut > 0.66 && p.mut >= p.konstanz) typ = 'aggressor';
    else if (p.nerven < 0.3) typ = 'rookie';
    else if (p.lernrate > 1.15 && p.nerven > 0.6) typ = 'veteran';
    else if (p.pflege > 0.65) typ = 'stratege';
    p.typ = KI_TYPEN.find((x) => x.id === typ);
    return p;
  }
  function kiPersonSetzen(car, aenderung) {
    const id = kiAutoId(car);
    if (!id) return;
    const d = kiD();
    if (aenderung === null) delete d.personen[id];
    else {
      const neu = Object.assign({}, d.personen[id] || {}, aenderung);
      // undefined = zurueck auf den Wert aus dem Namen
      Object.keys(neu).forEach((k) => { if (neu[k] === undefined) delete neu[k]; });
      d.personen[id] = neu;
    }
    kiSchmutzig = true; kiSichern();
    if (car.kiZ) car.kiZ.P = null;
  }
  function kiAn(car) { return !!(car && car.role === 'ghost' && kiPerson(car).an); }

  // ---- Streckengedaechtnis ----
  function kiSpeicher(car, anlegen) {
    const sk = kiStreckeKey(), id = kiAutoId(car);
    if (!sk || !id) return null;
    const n = currentTrackTiles.length;
    const d = kiD();
    let s = d.strecken[sk];
    if (!s) { if (!anlegen) return null; s = d.strecken[sk] = { datum: Date.now(), fahrer: {} }; }
    let m = s.fahrer[id];
    if (!m || !Array.isArray(m.f) || m.f.length !== n) {
      if (!anlegen) return null;
      m = s.fahrer[id] = { f: new Array(n).fill(KI_SICHT), ab: new Array(n).fill(0), runden: 0, rivalen: {} };
    }
    s.datum = Date.now();
    return m;
  }
  function kiWissen(m) {
    if (!m || !m.f.length) return 0;
    const mittel = m.f.reduce((a, b) => a + b, 0) / m.f.length;
    return kiKlemme((mittel - KI_SICHT) / (1.0 - KI_SICHT), 0, 1);
  }
  function kiZustand(car) {
    if (!car.kiZ || car.kiZ.id !== kiAutoId(car)) {
      car.kiZ = { id: kiAutoId(car), P: null, kachel: null, offsVor: null, vorsichtBis: 0, zoegernBis: 0, druckSeit: 0,
                  vorn: null, nah: null, nahAt: 0, phase: kiZufall01(kiAutoId(car) || 'x', 'phase') * 6.28, faktor: 1, letzt: 0 };
    }
    if (!car.kiZ.P) car.kiZ.P = kiPerson(car);
    return car.kiZ;
  }
  function kiNah(car, st, now) {
    if (st.nah && now - st.nahAt < 220) return st.nah;
    let vorn = null, hinten = null;
    try { vorn = ghostAhead(car); } catch (e) { vorn = null; }
    try { hinten = ghostHinterMir(car); } catch (e) { hinten = null; }
    st.nah = { vorn, hinten }; st.nahAt = now;
    return st.nah;
  }
  // Nur bei Gruen im laufenden Rennen, nicht in der Box und nicht in der Startrunde.
  function kiLage(car) {
    try {
      if (raceState !== 'racing' && raceState !== 'finishing') return false;
      if (flagState !== 'green' || raceFormationLap) return false;
    } catch (e) { return false; }
    return !(car.ghost && car.ghost.pit);
  }

  // Beim Wechsel auf eine neue Kachel: die gerade gefahrene bewerten, Gegner nachfuehren.
  function kiKachel(car, st, k, n, now) {
    const m = kiSpeicher(car, true);
    if (!m) return;
    const P = st.P;
    const offs = (car.race && car.race.offLap) || 0;
    if (st.offsVor === null) st.offsVor = offs;
    if (offs > st.offsVor) {
      // Abgeflogen: Kachel und Anfahrt merken, die naechsten Sekunden vorsichtig.
      m.ab[k] = Math.min(9, (m.ab[k] || 0) + 1);
      m.f[k] = Math.max(0.88, m.f[k] * 0.95);
      const vor = (k - 1 + n) % n;
      m.f[vor] = Math.max(0.90, m.f[vor] * 0.97);
      st.vorsichtBis = now + 3500 + 3000 * (1 - P.nerven);
    } else {
      // Sauber: etwas mehr Vertrauen, erst zuegig, dann in Zehnteln. Wo er schon abflog, liegt die Decke tiefer.
      const decke = 1.0 + 0.04 * P.mut - 0.02 * Math.min(3, m.ab[k] || 0) / 3;
      const schritt = (m.f[k] < 0.98 ? 0.010 : 0.003) * P.lernrate;
      m.f[k] = Math.min(decke, m.f[k] + schritt);
    }
    st.offsVor = offs;
    if (k === n - 1) m.runden = (m.runden || 0) + 1;
    // Gegner: war er eben dicht vor mir und ist jetzt dicht hinter mir?
    st.nah = null;
    const nah = kiNah(car, st, now);
    const vornId = nah.vorn && nah.vorn.gap < 2.2 ? kiAutoId(nah.vorn.car) : null;
    const hintenId = nah.hinten && nah.hinten.gap < 2.2 ? kiAutoId(nah.hinten.car) : null;
    if (st.vorn && hintenId === st.vorn && vornId !== st.vorn) {
      const r = m.rivalen[st.vorn] || (m.rivalen[st.vorn] = { vorbei: 0, verloren: 0, zone: {} });
      r.vorbei++; r.zone[k] = (r.zone[k] || 0) + 1;
      const anderer = garage.find((c) => kiAutoId(c) === st.vorn);
      if (anderer && kiAn(anderer)) {
        const m2 = kiSpeicher(anderer, true);
        if (m2) { const r2 = m2.rivalen[st.id] || (m2.rivalen[st.id] = { vorbei: 0, verloren: 0, zone: {} }); r2.verloren++; }
      }
    }
    st.vorn = vornId;
    kiSchmutzig = true;
  }

  // ---- Der Haken: Faktor auf das Zieltempo eines NPCs (ghostTick, 90-ghosts.js) ----
  function kiTempo(car) {
    if (!kiAn(car) || !car.ghost || !kiLage(car)) return 1;
    const n = currentTrackTiles ? currentTrackTiles.length : 0;
    const ti = car.ghost.tileIndex;
    if (!n || ti === null || ti === undefined) return 1;
    const now = performance.now();
    const st = kiZustand(car);
    const dt = st.letzt ? Math.min(0.2, (now - st.letzt) / 1000) : 0.045;
    st.letzt = now;
    const k = ((ti % n) + n) % n;
    if (st.kachel !== null && st.kachel !== k) kiKachel(car, st, st.kachel, n, now);
    st.kachel = k;
    const m = kiSpeicher(car, true);
    const P = st.P;
    let f = 1;
    // 1. was er ueber diese Kachel weiss (und schon ueber die naechste)
    if (m) f *= 0.6 * m.f[k] + 0.4 * m.f[(k + 1) % n];
    // 2. das Menschliche
    st.phase += dt * (0.05 + 0.04 * P.mut);
    f *= 1 + 0.02 * (1 - P.konstanz) * Math.sin(st.phase);
    const nah = kiNah(car, st, now);
    const hintenNah = nah.hinten && nah.hinten.gap < 0.7;
    const vornNah = nah.vorn && nah.vorn.gap < 2.5;
    if (hintenNah) {
      if (!st.druckSeit) st.druckSeit = now;
      if (now - st.druckSeit > 5000) {
        if (now > st.zoegernBis && Math.random() < dt * 0.05 * (1 - P.nerven)) st.zoegernBis = now + 450;
        else if (P.nerven > 0.6) f *= 1.008;
      }
    } else st.druckSeit = 0;
    if (now < st.zoegernBis) f *= 0.92;
    if (now < st.vorsichtBis) f *= 0.96;
    const allein = (!nah.vorn || nah.vorn.gap > 4) && (!nah.hinten || nah.hinten.gap > 4);
    if (allein && (car.ghost.laps || 0) >= 2) f *= 1 - 0.014 * P.pflege;
    // 3. Gegner: angreifen, wo es schon geklappt hat; Geduld, wo es nie klappt
    if (vornNah && m) {
      const r = m.rivalen[kiAutoId(nah.vorn.car)];
      if (r) {
        const hier = (r.zone[k] || 0) + (r.zone[(k + 1) % n] || 0);
        if (hier > 0) f *= 1.01 + 0.006 * Math.min(3, hier) * (0.5 + 0.5 * P.mut);
        else if (r.verloren > r.vorbei + 2) f *= 0.992;
      } else if (nah.vorn.gap < 1.2) f *= 1 + 0.008 * P.mut;
    }
    f = kiKlemme(f, KI_GRENZE[0], KI_GRENZE[1]);
    st.faktor = f;
    return f;
  }

  // ---- Das Fenster (wie das Setup, 98i-setup.js) ----
  const kiStil = document.createElement('style');
  kiStil.textContent = `
    .ki-fenster .k-pause-dialog { width: min(620px, 94vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box; }
    .ki-fenster .ki-kopf { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .ki-fenster .ki-kopf .wip-tag, .gar-a-ki .wip-tag { margin-left: 6px; font-size: 9px; vertical-align: 1px; }
    .ki-fenster .k-pause-dialog p.ki-typ { display: block; margin: 0 0 4px; font-size: 13px; }
    .ki-fenster .gk-zeile { font-size: 15px; }
    .ki-fenster .gk-zeile .gk-l { letter-spacing: .08em; text-transform: uppercase; font-size: 13px; }
    .ki-fenster .gk-w > b { width: auto; min-width: 8em; text-align: center; font-variant-numeric: tabular-nums; }
    .ki-fenster .ki-balken { display: inline-block; width: 5em; height: .45em; margin-right: .5em; vertical-align: middle;
      background: rgba(255,255,255,.13); position: relative; }
    .ki-fenster .ki-balken > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--k-blau, #00a3e0); }
    .ki-fenster.ki-aus .gk-zeile.ki-wert { opacity: .55; }
    .ki-fenster .ki-wissen { margin: 4px 0; font-size: 13px; color: var(--muted); }
    .ki-fenster .ki-wissen ul { margin: 2px 0 0 1.2em; padding: 0; }
    .ki-fenster .ki-knoepfe { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .ki-fenster .opt-row.menu-nav-sel { outline: 2px solid #fff; outline-offset: -2px; }
    .ki-fenster .k-pause-dialog .opt-info-btn { width: 16px; height: 16px; min-height: 16px; padding: 0; margin-left: 6px;
      text-align: center; justify-content: center; border: 1px solid var(--border); border-radius: 50%; background: var(--panel);
      color: var(--muted); font: italic 11px/1 Georgia, serif; letter-spacing: 0; text-transform: none; }
    .ki-fenster .k-pause-dialog .opt-info-btn:hover { color: var(--ink); border-color: var(--muted); background: var(--panel); }
    @media (min-width: 700px) { .ki-fenster .ki-knoepfe { flex-direction: row; } .ki-fenster .ki-knoepfe .opt-row { flex: 1; }
      .ki-fenster .ki-knoepfe button { width: 100%; } }
    @media (max-height: 420px) {
      .ki-fenster .k-pause-dialog { padding: 6px 12px 8px; gap: 2px; max-height: 98vh; }
      .ki-fenster .k-pause-dialog h2 { font-size: 14px; margin: 0; }
      .ki-fenster .gk-zeile { padding: 0 4px; font-size: 13px; }
      .ki-fenster .gk-zeile .gk-l { font-size: 11px; }
      .ki-fenster .ki-typ, .ki-fenster .ki-wissen { font-size: 11px; margin: 0; }
      .ki-fenster .ki-knoepfe { flex-direction: row; } .ki-fenster .ki-knoepfe .opt-row { flex: 1; }
    }
  `;
  document.head.appendChild(kiStil);
  const kiFenster = document.createElement('div');
  kiFenster.className = 'k-pause ki-fenster';
  kiFenster.id = 'ki-fenster';
  kiFenster.hidden = true;
  kiFenster.setAttribute('data-i18n-skip', '');
  kiFenster.setAttribute('role', 'dialog');
  kiFenster.setAttribute('aria-modal', 'true');
  kiFenster.innerHTML = '<div class="k-pause-dialog" id="ki-dialog"></div>';
  document.body.appendChild(kiFenster);
  kiFenster.addEventListener('click', (e) => { if (e.target === kiFenster) kiSchliessen(); });
  let kiFensterAuto = null;

  // Ueber das Element und nicht ueber die Konstante: das Steuerkreuz (50b-menu-nav.js) fragt schon beim Laden.
  function kiFensterOffen() { const f = document.getElementById('ki-fenster'); return !!(f && !f.hidden); }
  function kiOeffnen(car) {
    if (!car || car.role !== 'ghost' || !kiAutoId(car)) return false;
    kiFensterAuto = car;
    kiFenster.hidden = false;
    kiZeichnen();
    if (typeof menuNavEnsureContext === 'function') {
      menuNavEnsureContext();
      menuNavIndex = 0; menuNavGezeigt = true; menuNavArmed = false;
      menuNavRender();
    }
    return true;
  }
  function kiSchliessen() {
    if (kiFenster.hidden) return false;
    kiFenster.hidden = true;
    kiFensterAuto = null;
    if (typeof renderGarage === 'function') renderGarage();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavRender(); }
    return true;
  }
  function kiWertZeile(klasse, titel, erkl, wertHtml, zurueck, vor) {
    const z = garWertZeile(titel, '', zurueck, vor);
    z.classList.add(klasse);
    const l = z.querySelector('.gk-l');
    l.classList.add('opt-label');
    const sm = document.createElement('small');
    sm.textContent = erkl;
    l.appendChild(sm);
    z.querySelector('b').innerHTML = wertHtml;
    return z;
  }
  function kiZeichnen() {
    const car = kiFensterAuto;
    const d = $('ki-dialog');
    if (!car || !d) return;
    if (garage.indexOf(car) < 0 || car.role !== 'ghost') { kiSchliessen(); return; }
    const P = kiPerson(car);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const scroll = d.scrollTop;
    kiFenster.classList.toggle('ki-aus', !P.an);
    d.innerHTML = '';
    const h = document.createElement('h2');
    h.className = 'ki-kopf';
    h.innerHTML = esc(t('KI-Persönlichkeit')) + ' &middot; <span>' + esc(kiAutoName(car)) + '</span> <span class="wip-tag">WIP</span>';
    d.appendChild(h);
    const typ = document.createElement('p');
    typ.className = 'muted ki-typ';
    typ.textContent = t(P.typ.name) + ': ' + t(P.typ.text);
    d.appendChild(typ);
    // An/Aus
    const schalten = () => { kiPersonSetzen(car, { an: !P.an }); kiZeichnen(); };
    d.appendChild(kiWertZeile('ki-an', t('Menschliche KI'),
      t('Ab Werk aus. An: dieser NPC lernt die Strecke Kachel für Kachel, merkt sich Abflüge und Überholstellen und fährt mit den Eigenschaften unten. Das Tempo bleibt in engen Grenzen um die eingestellte Stufe (85 bis 104 %), unter Gelb, in der Box und in der Startrunde gilt es nicht.'),
      esc(P.an ? t('An') : t('Aus')), schalten, schalten));
    // Die fuenf Eigenschaften
    KI_EIGENSCHAFTEN.forEach((e) => {
      const w = P[e.id];
      const setze = (dw) => { kiPersonSetzen(car, { [e.id]: Math.round(kiKlemme(w + dw, 0, 1) * 10) / 10 }); kiZeichnen(); };
      const z = kiWertZeile('ki-wert', t(e.name), t(e.text),
        '<span class="ki-balken"><i style="width:' + Math.round(w * 100) + '%"></i></span>' + Math.round(w * 100) + ' %',
        () => setze(-0.1), () => setze(0.1));
      z.dataset.feld = e.id;
      d.appendChild(z);
    });
    // Streckengedaechtnis
    const m = kiSpeicher(car, false);
    const wissen = document.createElement('div');
    wissen.className = 'ki-wissen';
    if (!kiStreckeKey()) wissen.textContent = t('Keine Strecke im Editor.');
    else if (!m) wissen.textContent = t('Kennt diese Strecke noch nicht und beginnt mit Besichtigungstempo.');
    else {
      const gefahr = m.ab.map((x, i) => (x > 0 ? 'T' + (i + 1) : null)).filter(Boolean);
      let txt = t('Kennt diese Strecke: {p} % · {r} Runden').replace('{p}', Math.round(kiWissen(m) * 100)).replace('{r}', m.runden || 0);
      txt += ' · ' + (gefahr.length ? t('vorsichtig bei {k}').replace('{k}', gefahr.slice(0, 6).join(', ')) : t('noch kein Abflug'));
      wissen.textContent = txt;
      const rivalen = Object.keys(m.rivalen);
      if (rivalen.length) {
        const ul = document.createElement('ul');
        rivalen.forEach((id) => {
          const r = m.rivalen[id];
          const c = garage.find((x) => kiAutoId(x) === id);
          const li = document.createElement('li');
          li.textContent = t('{n}: {v}× überholt, {l}× verloren').replace('{n}', c ? kiAutoName(c) : '?')
            .replace('{v}', r.vorbei).replace('{l}', r.verloren);
          ul.appendChild(li);
        });
        wissen.appendChild(ul);
      }
    }
    d.appendChild(wissen);
    // Knoepfe
    const knoepfe = document.createElement('div');
    knoepfe.className = 'ki-knoepfe';
    const knopf = (act, txt, fn, aus) => {
      const z = document.createElement('div');
      z.className = 'opt-row opt-breit';
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.act = act; b.textContent = txt; b.disabled = !!aus;
      b.onclick = (ev) => { ev.stopPropagation(); fn(); };
      z.appendChild(b);
      knoepfe.appendChild(z);
    };
    knopf('ki-standard', t('Eigenschaften aus dem Namen'), () => { kiPersonSetzen(car, { mut: undefined, konstanz: undefined, nerven: undefined, lern: undefined, pflege: undefined }); kiZeichnen(); });
    knopf('ki-vergessen', t('Strecke vergessen'), () => {
      const sk = kiStreckeKey(), dd = kiD();
      if (sk && dd.strecken[sk]) { delete dd.strecken[sk].fahrer[kiAutoId(car)]; kiSchmutzig = true; kiSichern(); }
      kiZeichnen();
    }, !m);
    knopf('ki-zu', t('Schließen'), kiSchliessen);
    d.appendChild(knoepfe);
    // Erklaerungen nur hinter dem (i), wie ueberall (98c-opt-info.js).
    if (typeof optInfoEinrichten === 'function') optInfoEinrichten();
    d.scrollTop = scroll;
  }
  function kiGarageZeile(car) {
    if (!car || car.role !== 'ghost' || !kiAutoId(car)) return null;
    const z = document.createElement('div');
    z.className = 'opt-row opt-breit gar-a-aktion gar-a-ki';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'ki';
    const P = kiPerson(car);
    b.appendChild(document.createTextNode(t('KI-Persönlichkeit') + ' · ' + (P.an ? t(P.typ.name) : t('Aus'))));
    const w = document.createElement('span');
    w.className = 'wip-tag';
    w.textContent = 'WIP';
    b.appendChild(w);
    b.onclick = (e) => { e.stopPropagation(); kiOeffnen(car); };
    z.appendChild(b);
    return z;
  }
  i18nOnLangChange(() => { if (kiFensterOffen()) kiZeichnen(); });

  // ---- Selbsttests ----
  function kiTestRahmen(fn) {
    let roh = null;
    try { roh = localStorage.getItem(KI_STORE); } catch (e) { roh = null; }
    const merk = { auf: garAufAuto, virt: garVirtuellAuf, kam: garKameraAuf, tiles: currentTrackTiles, rs: raceState, fs: flagState, daten: kiDaten };
    const probe = { role: 'ghost', device: { id: 'probe-ki-npc', name: 'Probe KI' }, alias: 'KI Probe', colorId: 'gelb',
                    sim: false, testSenke: [], probe: true, ghost: { tileIndex: 0, laps: 0 }, race: { offLap: 0 } };
    const f = [];
    const aufraeumen = () => {
      kiFenster.hidden = true; kiFensterAuto = null;
      const i = garage.indexOf(probe); if (i >= 0) garage.splice(i, 1);
      garAufAuto = merk.auf; garVirtuellAuf = merk.virt; garKameraAuf = merk.kam; currentTrackTiles = merk.tiles;
      raceState = merk.rs; flagState = merk.fs;
      try { if (roh === null) localStorage.removeItem(KI_STORE); else localStorage.setItem(KI_STORE, roh); } catch (e) { /* privat */ }
      kiDaten = merk.daten; kiSchmutzig = false;
      renderGarage();
      if (typeof menuNavEnsureContext === 'function') menuNavEnsureContext();
    };
    try {
      try { localStorage.removeItem(KI_STORE); } catch (e) { /* privat */ }
      kiDaten = null;
      garage.push(probe);
      fn(f, probe);
    } catch (e) { f.push('Fehler: ' + e.message); }
    aufraeumen();
    return f;
  }

  stAdd('KI-Persoenlichkeit v1.5: Knopf je NPC (WIP), Fenster mit fuenf Eigenschaften, ab Werk aus', () => {
    const f = kiTestRahmen((f, car) => {
      garAufAuto = car; garVirtuellAuf = false; garKameraAuf = false; renderGarage();
      const b = $('gar-list').querySelector('.gar-a-rechts [data-act="ki"]');
      if (!b) { f.push('kein KI-Knopf beim NPC'); return; }
      if (!b.querySelector('.wip-tag')) f.push('Knopf ohne WIP');
      if (kiAn(car)) f.push('ab Werk an');
      if (kiTempo(car) !== 1) f.push('aus, aber Faktor ' + kiTempo(car));
      b.click();
      if (!kiFensterOffen()) { f.push('Klick oeffnet nicht'); return; }
      if (typeof menuNavContainer === 'function' && menuNavContainer() !== $('ki-fenster')) f.push('Steuerkreuz bleibt in der Garage');
      const felder = [...$('ki-dialog').querySelectorAll('.ki-wert')].map((z) => z.dataset.feld).join(',');
      if (felder !== 'mut,konstanz,nerven,lern,pflege') f.push('Felder: ' + felder);
      if ([...$('ki-dialog').querySelectorAll('.opt-label small')].some((x) => !x.classList.contains('opt-info-versteckt'))) f.push('Erklaertext sichtbar statt hinter dem (i)');
      const vorher = kiPerson(car).mut;
      $('ki-dialog').querySelector('.ki-wert[data-feld="mut"] [data-d="1"]').click();
      const nachher = kiPerson(car).mut;
      if (Math.abs(nachher - Math.min(1, vorher + 0.1)) > 1e-9) f.push('Mut ' + vorher + ' -> ' + nachher);
      $('ki-dialog').querySelector('.ki-an [data-d="1"]').click();
      if (!kiAn(car)) f.push('Schalter schaltet nicht ein');
      // Bleibt gespeichert, auch nach dem Neuladen der Ablage.
      kiSichern(); kiDaten = null;
      if (!kiAn(car) || Math.abs(kiPerson(car).mut - nachher) > 1e-9) f.push('nicht gespeichert');
      $('ki-dialog').querySelector('[data-act="ki-standard"]').click();
      if (Math.abs(kiPerson(car).mut - kiVorgabe(car).mut) > 1e-9) f.push('Standard stellt Mut nicht zurueck');
      if (!kiAn(car)) f.push('Standard schaltet die KI aus');
      if (typeof konsoleZurueck === 'function' && (!konsoleZurueck() || kiFensterOffen())) f.push('Kreis schliesst nicht');
      // Spieler haben keinen KI-Knopf.
      car.role = 'player'; renderGarage();
      if ($('gar-list').querySelector('.gar-a-rechts [data-act="ki"]')) f.push('Spieler hat einen KI-Knopf');
      car.role = 'ghost';
    });
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'NPC-Knopf mit WIP, ab Werk aus (Faktor 1), fuenf Eigenschaften, gespeichert, Kreis schliesst' };
  });

  stAdd('KI-Persoenlichkeit v1.5: lernt die Strecke, Abflug kostet, Faktor bleibt in 0,85 bis 1,04, nie unter Gelb', () => {
    const f = kiTestRahmen((f, car) => {
      const tl = codeToTrack('SSLLSSLL').tiles;
      currentTrackTiles = tl;
      kiPersonSetzen(car, { an: true, mut: 1, konstanz: 1, nerven: 1, lern: 1, pflege: 0 });
      raceState = 'racing'; flagState = 'green';
      const n = tl.length;
      // Fuenf saubere Runden: das Wissen steigt.
      for (let r = 0; r < 5; r++) for (let k = 0; k < n; k++) { car.ghost.tileIndex = k; kiTempo(car); }
      const m = kiSpeicher(car, false);
      if (!m) { f.push('kein Gedaechtnis angelegt'); return; }
      const w1 = kiWissen(m);
      if (!(w1 > 0.3)) f.push('lernt nicht: Wissen ' + w1.toFixed(2));
      if (m.runden < 4) f.push('Runden ' + m.runden);
      // Abflug auf Kachel 2.
      const vor = m.f[2];
      car.ghost.tileIndex = 2; kiTempo(car);
      car.race.offLap = 1;
      car.ghost.tileIndex = 3; kiTempo(car);
      if (!(m.f[2] < vor) || !(m.ab[2] >= 1)) f.push('Abflug ohne Folge: ' + vor + ' -> ' + m.f[2]);
      // Grenzen ueber viele Aufrufe.
      let lo = 9, hi = 0;
      for (let i = 0; i < 400; i++) { car.ghost.tileIndex = i % n; const x = kiTempo(car); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (lo < KI_GRENZE[0] - 1e-9 || hi > KI_GRENZE[1] + 1e-9) f.push('Faktor ' + lo.toFixed(3) + '..' + hi.toFixed(3));
      // Unter Gelb: 1.
      flagState = 'yellow';
      if (kiTempo(car) !== 1) f.push('unter Gelb ' + kiTempo(car));
      flagState = 'green'; raceState = 'idle';
      if (kiTempo(car) !== 1) f.push('ohne Rennen ' + kiTempo(car));
      // Gespeichert je Strecke.
      kiSchmutzig = true; kiSichern(); kiDaten = null;
      if (!kiSpeicher(car, false)) f.push('Gedaechtnis nicht gespeichert');
    });
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'lernt, Abflug kostet, Grenzen gehalten, unter Gelb und ohne Rennen 1, je Strecke gespeichert' };
  });
