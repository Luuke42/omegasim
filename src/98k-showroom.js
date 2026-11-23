  // ============================== SHOWROOM (WIP) ==============================
  //
  // v1.5 BESTELLT (Plan Paket 7): "Showroom (WIP): Knopf in der Garage, Sammelkarten je Auto mit Bilanz."
  // Nach Hybrid-Dash 4.0 von Mo Kamit (MIT-Lizenz), Datei 98zh-hd4-showroom.js ("The digital showroom"):
  // jedes bekannte Auto als Sammelkarte mit Holo-Schimmer, die der Maus folgt; ein Tipp dreht sie um
  // zur Bilanz. Die Stufe der Karte ist verdient: Serie -> Clubfahrer -> Podiumsfahrer -> Legende.
  //
  // ANDERS ALS BEI MOKAMIT KEINE EIGENE ABLAGE: die Bilanz kommt aus den gespeicherten Sitzungen
  // (chc.sessions.v1, 97-sessions.js), die jedes Auto mit Kennung und Rundenzeiten fuehren. Sieger
  // und Plaetze nach derselben Regel wie die Statistik (statSieger, 98e-statistik.js). So stimmen
  // Showroom und Statistik ueberein, auch fuer Rennen, die vor dieser Version gefahren wurden.
  // Bild: das eigene Foto aus der Garage, sonst eine gezeichnete Silhouette in der Farbe des Autos.

  const SHOW_STUFEN = [
    { id: 'serie', name: 'Serie', ab: 0, farbe: '#aeb7c6', holo: 0 },
    { id: 'club', name: 'Clubfahrer', ab: 6, farbe: '#4db8ff', holo: 0.35 },
    { id: 'podium', name: 'Podiumsfahrer', ab: 20, farbe: '#b08cff', holo: 0.6 },
    { id: 'legende', name: 'Legende', ab: 50, farbe: '#f5c542', holo: 0.9 },
  ];
  let showSort = 'stufe';

  function showPunkte(b) { return b ? b.siege * 5 + b.podien * 2 + b.rennen + Math.floor(b.runden / 25) + b.poles * 2 : 0; }
  function showStufe(b) {
    const p = showPunkte(b);
    let g = SHOW_STUFEN[0];
    SHOW_STUFEN.forEach((x) => { if (p >= x.ab) g = x; });
    const i = SHOW_STUFEN.indexOf(g), naechste = SHOW_STUFEN[i + 1] || null;
    return { g, p, naechste, anteil: naechste ? (p - g.ab) / (naechste.ab - g.ab) : 1 };
  }
  // Reihenfolge einer Sitzung (Indizes in s.autos mit Runden): wie statSieger, nur ganz.
  function showRangfolge(s) {
    const w = (s.autos || []).map((a, i) => {
      const l = Array.isArray(a.laps) ? a.laps : [];
      return { i, n: l.length, summe: l.reduce((x, y) => x + y, 0), beste: l.length ? Math.min(...l) : Infinity };
    }).filter((x) => x.n > 0);
    w.sort((a, b) => (s.modus === 'qualifying' ? a.beste - b.beste : (b.n - a.n) || (a.summe - b.summe)));
    return w.map((x) => x.i);
  }
  // Bilanz je Kennung aus allen gespeicherten Sitzungen.
  function showBilanzen() {
    const o = typeof sessionStore === 'function' ? sessionStore() : { cars: {}, sessions: [] };
    const out = {};
    const von = (id) => out[id] || (out[id] = { rennen: 0, siege: 0, podien: 0, poles: 0, runden: 0, beste: null, km: 0 });
    for (const s of o.sessions) {
      const autos = s.autos || [];
      autos.forEach((a) => {
        if (!a.id || !Array.isArray(a.laps)) return;
        const b = von(a.id);
        b.runden += a.laps.length;
        const m = a.laps.length ? Math.min(...a.laps) : null;
        if (m && (!b.beste || m < b.beste)) b.beste = m;
      });
      if (autos.length < 2 || STAT_RENNMODI.indexOf(s.modus) < 0) continue;
      const rf = showRangfolge(s);
      if (rf.length < 2) continue;
      if (s.modus === 'qualifying') { const a = autos[rf[0]]; if (a.id) von(a.id).poles++; continue; }
      rf.forEach((idx, platz) => {
        const a = autos[idx];
        if (!a.id) return;
        const b = von(a.id);
        b.rennen++;
        if (platz === 0) b.siege++;
        if (platz < 3) b.podien++;
      });
    }
    Object.keys(o.cars || {}).forEach((id) => { von(id).km = o.cars[id].km || 0; });
    return out;
  }
  // Jedes Auto, das die App kennt: verbunden, gemerkt (chc.cars.v1) oder nur mit Bilanz.
  function showAutos() {
    const out = [], gesehen = new Set();
    const foto = (id) => { try { return localStorage.getItem('omegasim-autofoto:' + id) || ''; } catch (e) { return ''; } };
    const modellName = (mid) => { try { return carModellWert(mid) ? carModellName(mid) : ''; } catch (e) { return ''; } };
    garage.forEach((c) => {
      if (!c.device || c.sim) return;
      const id = String(c.device.id);
      gesehen.add(id);
      out.push({ id, name: c.alias || c.tag || garageLabel(c), farbe: carColor(c).hex, modellName: modellName(c.modellId), foto: foto(id), verbunden: true });
    });
    let store = {};
    try { store = carStore(); } catch (e) { store = {}; }
    Object.keys(store).forEach((id) => {
      if (gesehen.has(id)) return;
      gesehen.add(id);
      const e = store[id] || {};
      let hex = '#8a93a6';
      try { const c = CAR_COLORS.find((x) => x.id === e.color); if (c) hex = c.hex; } catch (e2) { /* Vorgabe */ }
      out.push({ id, name: e.alias || e.name || id, farbe: hex, modellName: modellName(e.modellId), foto: foto(id), verbunden: false });
    });
    const bil = showBilanzen();
    let sessCars = {};
    try { sessCars = sessionStore().cars || {}; } catch (e) { sessCars = {}; }
    Object.keys(bil).forEach((id) => {
      if (gesehen.has(id)) return;
      gesehen.add(id);
      out.push({ id, name: (sessCars[id] && sessCars[id].name) || id, farbe: (sessCars[id] && sessCars[id].farbe) || '#8a93a6', modellName: '', foto: foto(id), verbunden: false });
    });
    out.forEach((a) => { a.b = bil[a.id] || null; a.stufe = showStufe(a.b); });
    return out;
  }

  function showEsc(x) { return String(x === undefined || x === null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function showSilhouette(a) {
    const f = showEsc(a.farbe);
    return '<svg viewBox="0 0 300 170" aria-hidden="true" class="show-silh">'
      + '<rect width="300" height="170" fill="#0b0d12"/><path d="M0 128h300v42H0z" fill="#141821"/><path d="M0 128h300" stroke="#2a3140" stroke-width="2"/>'
      + '<path d="M28 118c2-14 14-22 34-25l40-5c14-16 34-26 62-26h34c24 0 44 9 58 26l18 4c10 2 16 9 16 20v8H28v-2Z" fill="' + f + '" fill-opacity=".85" stroke="' + f + '" stroke-width="2"/>'
      + '<path d="M112 86c10-11 26-18 50-18h30c18 0 32 6 43 18Z" fill="#0b0d12" opacity=".75"/>'
      + '<circle cx="86" cy="126" r="19" fill="#07090d" stroke="#3a4253" stroke-width="4"/><circle cx="86" cy="126" r="7" fill="#3a4253"/>'
      + '<circle cx="226" cy="126" r="19" fill="#07090d" stroke="#3a4253" stroke-width="4"/><circle cx="226" cy="126" r="7" fill="#3a4253"/></svg>';
  }
  function showKarte(a) {
    const b = a.b || { rennen: 0, siege: 0, podien: 0, poles: 0, runden: 0, beste: null, km: 0 };
    const g = a.stufe;
    // Das Foto bekommt seine Quelle erst nach dem Einsetzen (showZeichnen): ein Daten-URL im Markup waere riesig.
    const bild = a.foto ? '<img class="show-foto" alt="" data-show-foto="' + showEsc(a.id) + '">' : showSilhouette(a);
    const fort = g.naechste ? t('{p} von {z} Punkten bis {s}').replace('{p}', g.p).replace('{z}', g.naechste.ab).replace('{s}', t(g.naechste.name)) : t('Höchste Stufe');
    return '<div class="opt-row show-zeile"><button type="button" class="show-karte show-' + g.g.id + '" data-show="' + showEsc(a.id) + '" style="--c:' + showEsc(a.farbe)
      + ';--g:' + g.g.farbe + ';--holo:' + g.g.holo + '" aria-label="' + showEsc(a.name + ', ' + t(g.g.name)) + '">'
      + '<span class="show-innen">'
      + '<span class="show-seite show-vorn"><span class="show-kopf"><span class="show-stufe">' + showEsc(t(g.g.name)) + '</span>'
      + (a.verbunden ? '<span class="show-live">' + showEsc(t('verbunden')) + '</span>' : '') + '</span>'
      + '<span class="show-bild">' + bild + '</span>'
      + '<span class="show-name">' + showEsc(a.name) + '</span><span class="show-modell">' + showEsc(a.modellName || 'Carrera HYBRID') + '</span>'
      + '<span class="show-zahlen"><span><b>' + b.siege + '</b>' + showEsc(t('Siege')) + '</span><span><b>' + b.podien + '</b>' + showEsc(t('Podien')) + '</span><span><b>'
      + b.rennen + '</b>' + showEsc(t('Starts')) + '</span></span>'
      + '<span class="show-holo" aria-hidden="true"></span><span class="show-glanz" aria-hidden="true"></span></span>'
      + '<span class="show-seite show-hinten"><span class="show-kopf"><span class="show-stufe">' + showEsc(t('Bilanz')) + '</span></span>'
      + '<span class="show-tab">'
      + [[t('Starts'), b.rennen], [t('Siege'), b.siege], [t('Podien'), b.podien], [t('Poles'), b.poles], [t('Runden'), b.runden],
         [t('Beste Runde'), b.beste ? formatLapTime(b.beste) : '–'], ['km', b.km ? b.km.toFixed(b.km < 10 ? 2 : 1) : '0']]
        .map(([k, v]) => '<span>' + showEsc(k) + '</span><b>' + showEsc(v) + '</b>').join('')
      + '</span><span class="show-fort"><span>' + showEsc(fort) + '</span><i><i style="width:' + Math.round(g.anteil * 100) + '%;background:'
      + (g.naechste ? g.naechste.farbe : g.g.farbe) + '"></i></i></span>'
      + '<span class="show-modell">' + showEsc(a.name) + '</span></span>'
      + '</span></button></div>';
  }

  const showStil = document.createElement('style');
  showStil.textContent = `
    .show-fenster .k-pause-dialog { width: min(1100px, 96vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box; }
    .show-fenster .k-pause-dialog p.show-text { display: block; margin: 0 0 6px; font-size: 13px; }
    .show-fenster .show-kopfzeile { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .show-fenster .show-kopfzeile .wip-tag, .gar-a-showroom .wip-tag { margin-left: 6px; font-size: 9px; vertical-align: 1px; }
    .show-fenster .show-leiste { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 0 0 10px; }
    .show-fenster .show-leiste .opt-row { padding: 0; border: 0; min-height: 0; }
    .show-fenster .show-leiste button.an { background: var(--k-blau, #00a3e0); color: var(--k-blau-text, #04070c); }
    .show-fenster .show-legende { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
    .show-fenster .show-legende i { display: inline-block; width: .7em; height: .7em; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
    .show-sammlung { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
    .show-fenster .k-pause-dialog .show-zeile.opt-row, .show-fenster .k-pause-dialog .show-leiste .opt-row { display: block; padding: 0; border: 0; min-height: 0; background: none; box-shadow: none; }
    .show-karte { display: block; width: 100%; aspect-ratio: 5 / 7; padding: 0; margin: 0; border: 0; background: none;
      perspective: 900px; cursor: pointer; font: inherit; color: #f3f4f6; text-align: left; text-transform: none; letter-spacing: 0; min-height: 0; }
    .show-fenster .k-pause-dialog button.show-karte { background: none; border: 0; padding: 0; box-shadow: none; min-height: 0; width: 100%; }
    .show-innen { position: relative; display: block; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .5s;
      transform: rotateX(var(--rx, 0deg)) rotateY(calc(var(--ry, 0deg) + var(--dreh, 0deg))); }
    .show-karte.gedreht { --dreh: 180deg; }
    .show-seite { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 4px; padding: 10px; box-sizing: border-box;
      border-radius: 12px; overflow: hidden; border: 2px solid var(--g); backface-visibility: hidden; -webkit-backface-visibility: hidden;
      background: linear-gradient(160deg, color-mix(in srgb, var(--c) 22%, #161b26), #0b0d12 70%); }
    .show-hinten { transform: rotateY(180deg); }
    /* v1.5.108 GEMELDET (zweimal): Rueckseite nicht lesbar. Auf Android-WebViews wirkt backface-visibility nicht, sobald
       die Vorderseite eine Mischschicht hat (Holo: mix-blend-mode) - die gespiegelte Vorderseite lag ueber dem Text. Jetzt
       wird die abgewandte Seite zur Haelfte der Drehung (0,25 s) unsichtbar geschaltet, unabhaengig vom Browser. */
    .show-seite { transition: visibility 0s linear .25s; }
    .show-karte.gedreht .show-seite:not(.show-hinten), .show-karte:not(.gedreht) .show-hinten { visibility: hidden; }
    .show-kopf { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .show-stufe { color: var(--g); }
    .show-live { color: #3ddc84; letter-spacing: .06em; }
    .show-bild { display: block; flex: 1; min-height: 0; border-radius: 8px; overflow: hidden; background: #0b0d12; }
    .show-bild svg, .show-bild img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .show-name { font-size: 16px; font-weight: 700; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .show-modell { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .show-zahlen { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .show-zahlen span { display: grid; justify-items: center; }
    .show-zahlen b { font-size: 18px; color: #f3f4f6; letter-spacing: 0; }
    /* v1.5.104 GEMELDET: Text auf den Rueckseiten nicht lesbar (erbte die dunkle Schrift des Dialogknopfs). Feste helle
       Farben, etwas groesser, ohne Holo/Glanz darueber. */
    .show-hinten { color: #f3f4f6; }
    .show-tab { display: grid; grid-template-columns: 1fr auto; gap: 5px 10px; font-size: 14px; margin-top: 6px; }
    .show-tab span { color: #c9ced8; }
    .show-tab b { text-align: right; font-variant-numeric: tabular-nums; color: #ffffff; }
    .show-hinten .show-stufe, .show-hinten .show-modell { color: #e4e7ee; }
    .show-fort { display: grid; gap: 4px; margin-top: auto; font-size: 12px; color: #c9ced8; }
    .show-fort > i { display: block; height: 6px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; }
    .show-fort > i > i { display: block; height: 100%; }
    .show-holo { position: absolute; inset: 0; pointer-events: none; opacity: var(--holo, 0); mix-blend-mode: color-dodge;
      background: linear-gradient(115deg, transparent 20%, rgba(255,0,150,.35) 36%, rgba(0,255,220,.35) 50%, rgba(255,230,0,.35) 64%, transparent 80%);
      background-size: 250% 250%; background-position: var(--mx, 50%) var(--my, 50%); }
    .show-glanz { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .2s;
      background: radial-gradient(circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,.28), transparent 45%); }
    .show-karte.aktiv .show-glanz { opacity: 1; }
    .show-zeile.menu-nav-sel .show-seite { outline: 2px solid #fff; outline-offset: -4px; }
    .show-fenster .show-knoepfe { display: flex; gap: 6px; margin-top: 12px; }
    .show-fenster .show-knoepfe .opt-row { flex: 1; }
    .show-fenster .show-knoepfe button { width: 100%; }
    @media (max-height: 420px) {
      .show-fenster .k-pause-dialog { padding: 6px 12px 8px; max-height: 98vh; }
      .show-sammlung { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
      .show-name { font-size: 13px; }
    }
    @media (prefers-reduced-motion: reduce) { .show-innen { transition: none; } }
  `;
  document.head.appendChild(showStil);
  const showFenster = document.createElement('div');
  showFenster.className = 'k-pause show-fenster';
  showFenster.id = 'show-fenster';
  showFenster.hidden = true;
  showFenster.setAttribute('data-i18n-skip', '');
  showFenster.setAttribute('role', 'dialog');
  showFenster.setAttribute('aria-modal', 'true');
  showFenster.innerHTML = '<div class="k-pause-dialog" id="show-dialog"></div>';
  document.body.appendChild(showFenster);
  showFenster.addEventListener('click', (e) => { if (e.target === showFenster) showSchliessen(); });

  function showFensterOffen() { const f = document.getElementById('show-fenster'); return !!(f && !f.hidden); }
  // v1.5 BESTELLT: "beim handy tilten einen glaenzeffekt auf die collection karten machen". Die Neigung des Telefons
  // (deviceorientation: gamma links/rechts, beta vor/zurueck um die Haltung von etwa 45 Grad) setzt Glanz, Holo-Folie und
  // eine leichte Drehung aller Karten wie der Zeiger am Rechner. Ein Bild je Animationsschritt. iPhone fragt beim Oeffnen.
  let showNeigungRaf = 0, showNeigungWert = null;
  function showNeigungAnwenden(g, b) {
    const x = Math.max(0, Math.min(1, (g + 30) / 60)), y = Math.max(0, Math.min(1, (b - 15) / 60));
    document.querySelectorAll('#show-fenster .show-karte').forEach((k) => {
      k.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); k.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      k.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(2) + 'deg'); k.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(2) + 'deg');
      k.classList.add('aktiv');
    });
  }
  function showNeigung(e) {
    if (showFenster.hidden || e.gamma === null || e.gamma === undefined || e.beta === null) return;
    showNeigungWert = [e.gamma, e.beta];
    if (showNeigungRaf) return;
    showNeigungRaf = requestAnimationFrame(() => { showNeigungRaf = 0; if (showNeigungWert) showNeigungAnwenden(showNeigungWert[0], showNeigungWert[1]); });
  }
  window.addEventListener('deviceorientation', showNeigung);
  function showOeffnen() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {});
    } catch (e) { /* kein Neigungssensor */ }
    showFenster.hidden = false;
    showZeichnen();
    if (typeof menuNavEnsureContext === 'function') {
      menuNavEnsureContext();
      menuNavIndex = 0; menuNavGezeigt = true; menuNavArmed = false;
      menuNavRender();
    }
    return true;
  }
  function showSchliessen() {
    if (showFenster.hidden) return false;
    showFenster.hidden = true;
    if (typeof renderGarage === 'function') renderGarage();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavRender(); }
    return true;
  }
  function showZeichnen() {
    const d = $('show-dialog');
    if (!d) return;
    const autos = showAutos();
    const sortiert = autos.slice().sort((a, b) => showSort === 'name' ? a.name.localeCompare(b.name)
      : showSort === 'siege' ? ((b.b ? b.b.siege : 0) - (a.b ? a.b.siege : 0)) || (b.stufe.p - a.stufe.p)
      : (b.stufe.p - a.stufe.p) || (b.verbunden - a.verbunden) || a.name.localeCompare(b.name));
    const zahl = {};
    autos.forEach((a) => { zahl[a.stufe.g.id] = (zahl[a.stufe.g.id] || 0) + 1; });
    d.innerHTML = '<h2 class="show-kopfzeile">' + showEsc(t('Showroom')) + ' <span class="wip-tag">WIP</span></h2>'
      + '<p class="muted show-text">' + showEsc(t('Deine Sammlung. Zeig auf eine Karte, damit sie das Licht fängt, tipp sie an, um sie umzudrehen. Siege, Podien und Runden heben die Stufe eines Autos.')) + '</p>'
      + '<div class="show-leiste">' + [['stufe', t('Nach Stufe')], ['siege', t('Nach Siegen')], ['name', t('Nach Name')]].map(([id, name]) =>
        '<div class="opt-row"><button type="button" data-show-sort="' + id + '"' + (showSort === id ? ' class="an"' : '') + '>' + showEsc(name) + '</button></div>').join('')
      + '<span class="show-legende">' + SHOW_STUFEN.map((g) => '<span><i style="background:' + g.farbe + '"></i>' + showEsc(t(g.name)) + ' <b>' + (zahl[g.id] || 0) + '</b></span>').join('') + '</span></div>'
      + (autos.length ? '<div class="show-sammlung">' + sortiert.map(showKarte).join('') + '</div>'
        : '<p class="muted show-text">' + showEsc(t('Noch keine Autos. Verbinde ein Auto in der Garage: es kommt in die Sammlung, und seine Bilanz beginnt mit dem ersten Rennen.')) + '</p>')
      + '<div class="show-knoepfe"><div class="opt-row"><button type="button" data-act="show-zu">' + showEsc(t('Schließen')) + '</button></div></div>';
    d.querySelectorAll('img[data-show-foto]').forEach((img) => { const x = autos.find((y) => y.id === img.dataset.showFoto); if (x) img.src = x.foto; });
    d.querySelectorAll('[data-show-sort]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); showSort = b.dataset.showSort; showZeichnen(); }));
    d.querySelector('[data-act="show-zu"]').addEventListener('click', (e) => { e.stopPropagation(); showSchliessen(); });
    d.querySelectorAll('.show-karte').forEach((k) => {
      k.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;   // auf dem Telefon fuehrt die Neigung (showNeigung)
        const r = k.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        k.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); k.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        k.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(2) + 'deg'); k.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(2) + 'deg');
        k.classList.add('aktiv');
      });
      k.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; k.classList.remove('aktiv'); k.style.setProperty('--rx', '0deg'); k.style.setProperty('--ry', '0deg'); });
      k.addEventListener('click', (e) => { e.stopPropagation(); k.classList.toggle('gedreht'); });
    });
  }
  // Die Zeile in der Garage, links unter "Onboard-Kamera" (renderGarage, 90-ghosts.js).
  function showGarageZeile() {
    const z = document.createElement('div');
    z.className = 'opt-row opt-breit gar-a-aktion gar-a-showroom';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'showroom';
    b.appendChild(document.createTextNode(t('Showroom')));
    const w = document.createElement('span');
    w.className = 'wip-tag';
    w.textContent = 'WIP';
    b.appendChild(w);
    b.onclick = (e) => { e.stopPropagation(); showOeffnen(); };
    z.appendChild(b);
    return z;
  }
  i18nOnLangChange(() => { if (showFensterOffen()) showZeichnen(); });

  // ---- Selbsttest ----
  stAdd('Showroom v1.5: Garage-Knopf (WIP), Bilanz aus den Sitzungen, Stufen, Karte dreht, Kreis schliesst', () => {
    const f = [];
    let roh = null;
    try { roh = localStorage.getItem(SESSION_STORE); } catch (e) { roh = null; }
    const probe = { role: 'ghost', device: { id: 'probe-show-a', name: 'Probe A' }, alias: 'Show A', colorId: 'rot', sim: false, testSenke: [], probe: true };
    const merk = { auf: garAufAuto, virt: garVirtuellAuf, kam: garKameraAuf, sort: showSort };
    try {
      // A gewinnt zwei Rennen, B eines; ein Qualifying holt A; ein Training zaehlt nur Runden.
      const s = (modus, a, b) => ({ modus, zeit: '2026-11-16T10:00:00.000Z', simKm: 0, realKm: 0, strecke: '', autos: [{ id: 'probe-show-a', name: 'A', rolle: 'player', laps: a }, { id: 'probe-show-b', name: 'B', rolle: 'ghost', laps: b }] });
      localStorage.setItem(SESSION_STORE, JSON.stringify({ cars: { 'probe-show-a': { name: 'A', km: 1.5 } }, sessions: [
        s('laps', [8000, 8000, 8000], [8100, 8100]),
        s('laps', [7900, 7900], [8200, 8200]),
        s('laps', [8000, 8000], [7800, 7800]),
        s('qualifying', [7700], [7900]),
        s('training', [7600, 7650], []),
      ], kmV: typeof SESSION_KM_V !== 'undefined' ? SESSION_KM_V : undefined }));
      const bil = showBilanzen();
      const a = bil['probe-show-a'], b = bil['probe-show-b'];
      if (!a || a.rennen !== 3 || a.siege !== 2 || a.podien !== 3 || a.poles !== 1 || a.runden !== 10 || a.beste !== 7600) f.push('Bilanz A ' + JSON.stringify(a));
      if (!b || b.siege !== 1 || b.rennen !== 3) f.push('Bilanz B ' + JSON.stringify(b));
      if (showStufe(a).g.id !== 'podium') f.push('Stufe A ' + showStufe(a).g.id + ' (' + showPunkte(a) + ' Punkte)');
      if (showStufe(null).g.id !== 'serie') f.push('ohne Bilanz nicht Serie');
      // Garage-Knopf.
      garage.push(probe);
      garAufAuto = probe; garVirtuellAuf = false; garKameraAuf = false; renderGarage();
      const knopf = $('gar-list').querySelector('[data-act="showroom"]');
      if (!knopf || !knopf.querySelector('.wip-tag')) { f.push('kein Showroom-Knopf mit WIP'); return { ok: false, mass: f.join(' | ') }; }
      knopf.click();
      if (!showFensterOffen()) f.push('Knopf oeffnet nicht');
      if (typeof menuNavContainer === 'function' && menuNavContainer() !== $('show-fenster')) f.push('Steuerkreuz bleibt in der Garage');
      const karte = $('show-dialog').querySelector('.show-karte[data-show="probe-show-a"]');
      if (!karte) f.push('keine Karte fuer A');
      else {
        if (!karte.classList.contains('show-podium')) f.push('Karte nicht in Stufe Podium');
        karte.click();
        if (!karte.classList.contains('gedreht')) f.push('Karte dreht nicht');
      }
      if (!$('show-dialog').querySelector('.show-karte[data-show="probe-show-b"]')) f.push('Auto nur mit Bilanz fehlt');
      if (typeof konsoleZurueck === 'function' && (!konsoleZurueck() || showFensterOffen())) f.push('Kreis schliesst nicht');
    } finally {
      showFenster.hidden = true;
      const i = garage.indexOf(probe); if (i >= 0) garage.splice(i, 1);
      garAufAuto = merk.auf; garVirtuellAuf = merk.virt; garKameraAuf = merk.kam; showSort = merk.sort;
      try { if (roh === null) localStorage.removeItem(SESSION_STORE); else localStorage.setItem(SESSION_STORE, roh); } catch (e) { /* privat */ }
      renderGarage();
      if (typeof menuNavEnsureContext === 'function') menuNavEnsureContext();
    }
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'Bilanz A 3 Rennen/2 Siege/1 Pole (21 Punkte), Stufe Podium, Karte dreht, Auto nur mit Bilanz dabei, Kreis schliesst' };
  });
