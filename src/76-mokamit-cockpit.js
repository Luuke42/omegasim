  // ============================== COCKPIT-ANSICHT "MOKAMIT" (v1.5.32, WIP) ==============================
  // BESTELLT: "Implementiere aus dem aus 1.3.xx geforkten Hybrid-Dash-4.0 (mokamit.github.io) folgende Features:
  // ... Cockpit-Ansicht 'Mokamit' erlauben, ich will es aber nicht im Screen togglen, sondern im Menue, in dem ich den
  // Cockpit-Stil aktuell auch anpassen kann."
  // Uebernommen aus Hybrid-Dash (src/98m-hd-cockpit.js, "Digital Dash"), (c) 2026 Mo Kamit, MIT-Lizenz (wie OmegaSim).
  // Angepasst: Wahl ueber Optionen > Allgemein > Cockpit-Ansicht ("Mokamit") statt als vierter Cockpit-Schirm; sichtbar
  // nur auf dem Haupt-Schirm des Cockpits; Texte deutsch und ueber t() uebersetzt; Gas/Bremse aus physEngine.state.longUse;
  // Regen ist weather === 'rain'. Jede Zahl wird aus den Elementen des Standard-Cockpits gelesen (die die App ohnehin
  // fortschreibt), die Knoepfe druecken die Standardknoepfe - also gelten dieselben Regeln.
  const HD_CP_SEG = 6;
  const hdCp = { gas: 0, bremse: 0, an: false, el: null, uhr: null };
  function mokamitSichtbar() {
    const dash = $('race-dash');
    return !!(dash && document.body.dataset.cockpit === 'mokamit' && (dash.dataset.screen || 'main') === 'main');
  }
  const hdTxt = (id) => { const el = $(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const hdZahl = (s) => { const m = String(s || '').match(/-?\d+(?:[.,]\d+)?/); return m ? m[0].replace(',', '.') : ''; };
  const hdLeer = (s) => (s && s !== '–' && s !== '-' && s !== '—' ? s : '—');

  function hdCockpitBauen() {
    if (hdCp.el) return hdCp.el;
    const dash = $('race-dash');
    if (!dash) return null;
    // Outer element: a cockpit screen overlay like the pit and race screens (.gt3-schirm covers
    // the dashboard area). Inner element: the dashboard at its DESIGN SIZE, scaled as a whole
    // to fit (hdCockpitEinpassen) - REPORTED: "not scaling or fitting the window correctly".
    const el = document.createElement('div');
    el.id = 'hd-cockpit';
    el.className = 'gt3-schirm hd-cp-schirm';
    el.setAttribute('data-i18n-skip', '');
    const innen = document.createElement('div');
    innen.className = 'hd-cp';
    const chip = (k, farbe, id) => `<div class="hd-cp-chip" style="--c:${farbe}"><span>${k}</span><b id="hd-cp-${id}">—</b></div>`;
    const zeile = (k, id) => `<div class="hd-cp-zeile"><span class="hd-cp-taste">${k}</span><b id="hd-cp-${id}">—</b></div>`;
    innen.innerHTML = `
      <div class="hd-cp-links">
        <div class="hd-cp-kopf"><b id="hd-cp-status">${t('Keine Sitzung')}</b>
          <svg id="hd-cp-licht" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M13 5 C7 5 6 9 6 12 C6 15 7 19 13 19 Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8 H21 M16 12 H21 M16 16 H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
        <div class="hd-cp-raster">
          <div class="hd-cp-chips">${chip('AST', '#35d07f', 'ast')}${chip('STR', '#29c4e8', 'str')}${chip('THR', '#f2a01c', 'thr')}${chip('TOP', '#e9ecf1', 'top')}</div>
          <div class="hd-cp-zeilen">${zeile(t('Akku'), 'akku')}${zeile(t('Position'), 'pos')}${zeile(t('Tank'), 'tank')}${zeile(t('Neben der Bahn'), 'abseits')}</div>
        </div>
        <div class="hd-cp-chips2">${chip('LCK', '#ff5a5a', 'lck')}${chip('EXPO', '#35d07f', 'expo')}${chip('BRK', '#3b7fe2', 'brk')}</div>
        <div class="hd-cp-steuer">
          <div class="hd-cp-box hd-cp-g" title="${t('G-Kraft: grün gemessen am Auto, rot gerechnet')}">
            <svg viewBox="0 0 100 100" aria-label="G-force"><circle cx="50" cy="50" r="46" fill="#04060b" stroke="#2a3346"/>
              <circle cx="50" cy="50" r="31" fill="none" stroke="#1e2634"/><circle cx="50" cy="50" r="16" fill="none" stroke="#1e2634"/>
              <path d="M50 4V96M4 50H96" stroke="#1e2634"/>
              <circle id="hd-cp-g-real" cx="50" cy="50" r="5" fill="#2ee06a" opacity=".85"/><circle id="hd-cp-g-sim" cx="50" cy="50" r="5.5" fill="#ff4d4d"/></svg>
            <span>G</span></div>
          <button type="button" class="hd-cp-knopf" id="hd-cp-licht-knopf" title="${t('Licht an/aus')}">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M13 5 C7 5 6 9 6 12 C6 15 7 19 13 19 Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8 H21 M16 12 H21 M16 16 H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <span id="hd-cp-licht-txt">${t('Licht')}</span></button>
          <button type="button" class="hd-cp-knopf" id="hd-cp-wetter-knopf" title="${t('Wetter wechseln: trocken, Regen, wechselhaft')}">
            <svg id="hd-cp-wetter-ico" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"></svg>
            <span id="hd-cp-wetter-txt">${t('Trocken')}</span></button>
        </div>
      </div>
      <div class="hd-cp-mitte">
        <div class="hd-cp-box hd-cp-tempo"><b id="hd-cp-kmh">0</b><small>km/h</small></div>
        <div class="hd-cp-box hd-cp-gang"><b id="hd-cp-gang">N</b></div>
        <div class="hd-cp-reifen"><div class="hd-cp-reifen-kopf">${t('Reifen')} %</div>
          <div class="hd-cp-reifen-raster"><b id="hd-cp-fl">—</b><b id="hd-cp-fr">—</b><b id="hd-cp-rl">—</b><b id="hd-cp-rr">—</b></div></div>
      </div>
      <div class="hd-cp-rechts">
        <div class="hd-cp-runde"><span>${t('Runde')}</span><b id="hd-cp-runde">—</b></div>
        <div class="hd-cp-box hd-cp-zeiten"><div class="hd-cp-zt-kopf">${t('Rundenzeit')}</div><b id="hd-cp-jetzt">--</b>
          <div class="hd-cp-zt-fuss"><div><span>Δ ${t('Beste')}</span><b id="hd-cp-delta">--</b></div><div><span>${t('Beste')}</span><b id="hd-cp-best">--</b></div></div></div>
        <div class="hd-cp-box hd-cp-reihe"><span>${t('Letzte Runde')}</span><b id="hd-cp-letzte">—</b></div>
        <div class="hd-cp-box hd-cp-reihe"><span>${t('Zustand')}</span><b id="hd-cp-schaden" class="hd-cp-blau">—</b></div>
        <div class="hd-cp-aktionen">
          <button type="button" class="hd-cp-aktion" id="hd-cp-box-knopf">${t('Boxenstopp')}</button>
          <button type="button" class="hd-cp-aktion hd-cp-gelb" id="hd-cp-flagge-knopf">${t('Gelbe Flagge')}</button>
        </div>
      </div>
      <div class="hd-cp-aussen">
        <div class="hd-cp-flagge" id="hd-cp-flagge">—</div>
        <div class="hd-cp-balken"><span>THR</span><div class="hd-cp-seg" id="hd-cp-seg">
          ${Array.from({ length: HD_CP_SEG }, (_, i) => `<i class="hd-g" data-i="${HD_CP_SEG - 1 - i}"></i>`).join('')}
          <i class="hd-cp-pfeil" id="hd-cp-pfeil">⬆</i>
          ${Array.from({ length: HD_CP_SEG }, (_, i) => `<i class="hd-b" data-i="${i}"></i>`).join('')}
        </div><span>BRK</span></div>
      </div>`;
    el.appendChild(innen);
    dash.appendChild(el);
    // The controls press the standard cockpit's own buttons, so every rule (pit lane, 1 s
    // hold for the flag on the pad, pause, two-player) stays exactly as it is there.
    const druecke = (id) => () => { const k = $(id); if (k && !k.disabled) k.click(); setTimeout(hdCockpitMalen, 60); };
    innen.querySelector('#hd-cp-box-knopf').addEventListener('click', druecke('race-act-pit'));
    innen.querySelector('#hd-cp-flagge-knopf').addEventListener('click', druecke('race-act-flag'));
    innen.querySelector('#hd-cp-licht-knopf').addEventListener('click', druecke('race-light-box'));
    innen.querySelector('#hd-cp-wetter-knopf').addEventListener('click', druecke('race-wx-box'));
    hdCp.el = el;
    if (window.ResizeObserver) new ResizeObserver(hdCockpitEinpassen).observe(el);
    return el;
  }

  // Scale the dashboard (design size HD_CP_B x HD_CP_H) to the space the screen has, keeping
  // its proportions, centred. transform and not zoom: the screen is an overlay with a fixed
  // box, nothing below it has to move.
  const HD_CP_B = 1040, HD_CP_H = 560, HD_CP_B_MAX = 1700;
  function hdCockpitEinpassen() {
    const el = hdCp.el; if (!el) return;
    const innen = el.firstElementChild;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    // Wide windows: the layout first stretches sideways to the window's shape (up to
    // HD_CP_B_MAX), so it fills the width instead of sitting small in the middle.
    const breite = Math.max(HD_CP_B, Math.min(HD_CP_B_MAX, HD_CP_H * w / h));
    innen.style.width = breite + 'px';
    const f = Math.min(w / breite, h / HD_CP_H);
    innen.style.transform = 'translate(' + Math.max(0, (w - breite * f) / 2) + 'px,' + Math.max(0, (h - HD_CP_H * f) / 2) + 'px) scale(' + f + ')';
  }

  function hdSetz(id, v) { const el = $('hd-cp-' + id); if (el && el.textContent !== v) el.textContent = v; }

  function hdCockpitMalen() {
    if (!mokamitSichtbar()) return;
    const el = hdCockpitBauen();
    if (!el || !el.offsetParent) return;
    hdCockpitEinpassen();
    // Status
    let status = t('Keine Sitzung'), farbe = '#ff4d4d';
    try {
      if (raceState === 'countdown') { status = t('Startampel'); farbe = '#ffd23f'; }
      else if (raceState === 'racing' || raceState === 'finishing') {
        status = flagState === 'yellow' ? t('Gelbe Flagge') : flagState === 'restart' ? t('Neustart') : (raceMode === 'practice' ? t('Training') : t('Rennen'));
        farbe = flagState === 'green' ? '#35d07f' : '#ffd23f';
      } else if (raceState === 'finished') { status = t('Ziel'); farbe = '#e9ecf1'; }
    } catch (e) { /* not ready */ }
    hdSetz('status', status);
    $('hd-cp-status').style.color = farbe;
    try { $('hd-cp-licht').style.color = headlightsOn ? '#29c4e8' : '#55606e'; } catch (e) { /* not ready */ }
    // Chips
    const assist = ($('driver-assist') || {}).value;
    hdSetz('ast', assist === 'voll' ? 'FULL' : assist === 'quer' ? 'LANE' : 'OFF');
    const gefuehl = hdTxt('race-act-mode-txt');
    const kurz = { arcade: 'ARC', pro: 'PRO', 'sim+': 'SIM+', sim: 'SIM', pacejka: 'PAC', omega: 'OMG', gt3: 'GT3', rc: 'RC' };
    const w = gefuehl.toLowerCase().split(/[\s·(]/)[0];
    hdSetz('str', gefuehl ? (kurz[w] || w.replace(/[^a-z0-9+]/g, '').slice(0, 4).toUpperCase()) : '—');
    hdSetz('thr', hdLeer(hdZahl(hdTxt('setting-throttle-gamma-val'))));
    hdSetz('top', hdLeer(hdZahl(hdTxt('setting-topspeed-val'))));
    hdSetz('lck', hdLeer(hdZahl(hdTxt('setting-steer-calib-val'))));
    hdSetz('expo', hdLeer(hdZahl(hdTxt('setting-steer-expo-val'))));
    hdSetz('brk', hdLeer(hdZahl(hdTxt('setting-brakepower-val'))));
    // Rows
    hdSetz('akku', hdLeer(hdTxt('race-batt')));
    const posEl = $('race-pos');
    hdSetz('pos', posEl && !posEl.hidden ? hdLeer(posEl.textContent.trim()) : '—');
    hdSetz('tank', hdLeer(hdTxt('race-fuel')));
    let ab = 0; try { ab = abseitsZaehlerFuer(1); } catch (e) { ab = 0; }
    hdSetz('abseits', String(ab));
    // Middle
    hdSetz('kmh', hdZahl(hdTxt('race-speed')) || '0');
    hdSetz('gang', hdTxt('race-gear') || 'N');
    for (const k of ['fl', 'fr', 'rl', 'rr']) {
      const t4 = $('race-tyre-' + k), b = t4 && t4.querySelector('b');
      let v = '—';
      if (b) {
        const h = b.style.height || b.style.getPropertyValue('--fill') || '';
        const m = String(h).match(/[\d.]+/);
        if (m) v = String(Math.round(parseFloat(m[0])));
      }
      hdSetz(k, v);
    }
    // Right
    hdSetz('runde', hdLeer(hdTxt('race-lap-count')));
    hdSetz('jetzt', hdLeer(hdTxt('race-lap-now')).replace('—', '--'));
    hdSetz('delta', hdLeer(hdTxt('race-lap-delta')).replace('—', '--'));
    hdSetz('best', hdLeer(hdTxt('race-lap-best')).replace('—', '--'));
    hdSetz('letzte', hdLeer(hdTxt('race-lap-last')));
    hdSetz('schaden', hdLeer(hdTxt('race-dmg')));
    // G-force: the same two dots as the standard cockpit's G plot.
    for (const k of ['real', 'sim']) {
      const q = $('race-g-' + k), z = $('hd-cp-g-' + k);
      if (q && z) { z.setAttribute('cx', q.getAttribute('cx')); z.setAttribute('cy', q.getAttribute('cy')); }
    }
    // Lights
    let licht = true; try { licht = !!headlightsOn; } catch (e) { /* not ready */ }
    const lk = $('hd-cp-licht-knopf');
    lk.classList.toggle('an', licht); hdSetz('licht-txt', licht ? t('Licht an') : t('Licht aus'));
    // Weather
    // The weather MODE the tile cycles (dry -> rain -> changeable), plus rain right now.
    let modus = 'dry', nass = false;
    try { modus = raceWxStart; nass = weather === 'rain'; } catch (e) { /* not ready */ }
    const wechsel = modus === 'wechsel';
    if (modus === 'rain') nass = true;
    const wetterTxt = wechsel ? t('wechselhaft') : nass ? t('Regen') : t('Trocken');
    // OmegaSim: am Merker statt am Text pruefen - sonst bleibt das Zeichen leer, wenn der Starttext schon stimmt.
    if ($('hd-cp-wetter-txt').dataset.w !== wetterTxt) {
      $('hd-cp-wetter-txt').dataset.w = wetterTxt;
      hdSetz('wetter-txt', wetterTxt);
      $('hd-cp-wetter-ico').innerHTML = nass || wechsel
        ? '<path d="M7 15 C4 15 3 12.5 4.5 10.8 C5 8 8 7 10 8.3 C11.3 5.5 16.5 5.5 17.3 9.4 C20 9.6 21 12 20 13.8 C19.5 14.7 18.6 15 17.6 15 Z" fill="none" stroke="#5aa9ff" stroke-width="1.8"/><path d="M8 18 L7 20.5 M12 18 L11 20.5 M16 18 L15 20.5" stroke="#5aa9ff" stroke-width="1.8" stroke-linecap="round"/>'
        : '<circle cx="12" cy="12" r="4.5" fill="none" stroke="#ffd23f" stroke-width="1.8"/><path d="M12 2.5V5 M12 19V21.5 M2.5 12H5 M19 12H21.5 M5.3 5.3L7 7 M17 17L18.7 18.7 M5.3 18.7L7 17 M17 7L18.7 5.3" stroke="#ffd23f" stroke-width="1.8" stroke-linecap="round"/>';
    }
    // Pit stop and yellow flag: label and state from the standard buttons.
    const bp = $('race-act-pit'), bf = $('hd-cp-box-knopf');
    if (bp && bf) { const tx = bp.textContent.replace(/\s+/g, ' ').trim() || t('Boxenstopp'); if (bf.textContent !== tx) bf.textContent = tx;
      bf.disabled = !!bp.disabled; bf.classList.toggle('an', bp.classList.contains('flagged') || bp.classList.contains('an') || bp.classList.contains('aktiv')); }
    const ff = $('race-act-flag'), ffk = $('hd-cp-flagge-knopf');
    if (ff && ffk) { const tx = ff.textContent.replace(/\s+/g, ' ').trim() || t('Gelbe Flagge'); if (ffk.textContent !== tx) ffk.textContent = tx;
      ffk.disabled = !!ff.disabled; ffk.classList.toggle('an', ff.classList.contains('flagged')); }
    // Flag box
    const fl = $('hd-cp-flagge');
    let f = t('GRÜN'), fc = '#35d07f';
    try {
      if (raceState !== 'racing' && raceState !== 'finishing') { f = '—'; fc = '#2bd1c0'; }
      else if (flagState === 'yellow') { f = typeof safetyCarFaehrt === 'function' && safetyCarFaehrt() ? 'SC' : t('GELB'); fc = '#ffd23f'; }
      else if (flagState === 'restart') { f = t('NEUSTART'); fc = '#ffd23f'; }
    } catch (e) { /* not ready */ }
    if (fl.textContent !== f) fl.textContent = f;
    fl.style.setProperty('--c', fc);
    // Throttle / brake bar (6 segments each way) and the shift arrow.
    // OmegaSim: Gas und Bremse aus der Laengsanforderung der Physik (kein Haken im Fahrtakt noetig).
    { const lu = (physEngine && physEngine.state && physEngine.state.longUse) || 0; hdCp.gas = Math.max(0, Math.min(1, lu)); hdCp.bremse = Math.max(0, Math.min(1, -lu)); }
    const g = Math.round(hdCp.gas * HD_CP_SEG), br = Math.round(hdCp.bremse * HD_CP_SEG);
    el.querySelectorAll('.hd-g').forEach((s) => s.classList.toggle('an', Number(s.dataset.i) < g));
    el.querySelectorAll('.hd-b').forEach((s) => s.classList.toggle('an', Number(s.dataset.i) < br));
    const shift = $('race-shift');
    const voll = shift ? shift.querySelectorAll('span.on, span.an, span.lit').length : 0;
    $('hd-cp-pfeil').classList.toggle('an', voll >= 8);
  }

  (function mokamitStart() {
    const css = document.createElement('style');
    css.textContent = `
      #hd-cockpit { display: none; }
      body[data-cockpit="mokamit"] #race-dash[data-screen="main"] #hd-cockpit, body[data-cockpit="mokamit"] #race-dash:not([data-screen]) #hd-cockpit { display: block; }

      
      .hd-cp-schirm { background: #000 !important; padding: 0 !important; overflow: hidden; z-index: 6 !important; }
      .hd-cp { position: absolute; left: 0; top: 0; width: ${HD_CP_B}px; height: ${HD_CP_H}px; transform-origin: 0 0;
        display: grid; grid-template-columns: minmax(395px, 1.55fr) minmax(230px, 1fr) minmax(250px, 1.1fr) minmax(105px, .42fr); gap: 14px; padding: 16px; box-sizing: border-box;
        background: #000; color: #f4f6fb; font-family: Inter, system-ui, sans-serif; align-content: start; }
      .hd-cp b { font-weight: 800; font-variant-numeric: tabular-nums; }
      .hd-cp-box { border: 2px solid #2a2e35; border-radius: 8px; background: #08090b; }
      .hd-cp-links { display: grid; gap: 12px; align-content: start; }
      .hd-cp-kopf { display: flex; align-items: center; gap: 14px; font-size: 20px; height: 26px; }
      .hd-cp-raster { display: grid; grid-template-columns: minmax(120px, .42fr) 1fr; gap: 12px; }
      .hd-cp-chips, .hd-cp-zeilen { display: grid; gap: 10px; grid-auto-rows: 54px; }
      .hd-cp-chip { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 11px;
        border: 2px solid var(--c); border-radius: 8px; background: #08090b; height: 54px; box-sizing: border-box; }
      .hd-cp-chip span { font-size: 13px; font-weight: 800; letter-spacing: .03em; }
      .hd-cp-chip b { font-size: 24px; white-space: nowrap; }
      .hd-cp-chips2 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .hd-cp-zeile { display: flex; align-items: center; gap: 12px; }
      .hd-cp-taste { flex: 0 0 104px; text-align: center; background: #3a3f49; border-radius: 6px; padding: 14px 4px; font-weight: 700; font-size: 15px; }
      .hd-cp-zeile b { flex: 1; text-align: right; font-size: 24px; white-space: nowrap; }
      .hd-cp-mitte { display: grid; gap: 12px; grid-template-rows: 62px 1fr 150px; height: ${HD_CP_H - 32}px; }
      .hd-cp-tempo { display: flex; align-items: baseline; justify-content: center; gap: 6px; padding-top: 8px; box-sizing: border-box; }
      .hd-cp-tempo b { font-size: 38px; }
      .hd-cp-tempo small { font-size: 12px; color: #c3c8d4; }
      .hd-cp-gang { display: grid; place-items: center; }
      .hd-cp-gang b { font-size: 190px; line-height: 1; font-weight: 500; }
      .hd-cp-reifen { border: 2px solid #f2a01c; border-radius: 8px; overflow: hidden; background: #08090b; }
      .hd-cp-reifen-kopf { background: #f2a01c; color: #14161c; text-align: center; font-weight: 800; padding: 6px; font-size: 15px; }
      .hd-cp-reifen-raster { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 7px; }
      .hd-cp-reifen-raster b { background: #1a1d22; border-radius: 4px; text-align: center; padding: 9px 0; font-size: 28px; }
      .hd-cp-rechts { display: grid; gap: 12px; align-content: start; }
      .hd-cp-runde { display: flex; align-items: center; gap: 10px; width: max-content; min-width: 45%; border: 2px solid #2a2e35; border-radius: 8px; background: #3a3f49; padding: 4px 4px 4px 14px; }
      .hd-cp-runde span { font-size: 20px; font-weight: 700; }
      .hd-cp-runde b { background: #000; border-radius: 6px; padding: 5px 18px; font-size: 20px; min-width: 2.5em; text-align: center; }
      .hd-cp-zeiten { overflow: hidden; }
      .hd-cp-zt-kopf { background: #3a3f49; text-align: center; padding: 6px; font-weight: 700; font-size: 16px; }
      .hd-cp-zeiten > b { display: block; text-align: center; font-size: 40px; padding: 22px 0; }
      .hd-cp-zt-fuss { display: grid; grid-template-columns: 1fr 1fr; border-top: 2px solid #2a2e35; }
      .hd-cp-zt-fuss div { display: grid; text-align: center; }
      .hd-cp-zt-fuss div + div { border-left: 2px solid #2a2e35; }
      .hd-cp-zt-fuss span { background: #2a2e35; font-size: 13px; font-weight: 700; padding: 4px; }
      .hd-cp-zt-fuss b { padding: 9px 0; font-size: 19px; }
      .hd-cp-reihe { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #24272d; }
      .hd-cp-reihe span { font-weight: 700; font-size: 15px; }
      .hd-cp-reihe b { font-size: 20px; }
      .hd-cp-blau { background: #1f56d6; border-radius: 4px; padding: 3px 10px; }
      .hd-cp-aussen { display: grid; gap: 12px; grid-template-rows: 56px 1fr; height: ${HD_CP_H - 32}px; }
      .hd-cp-flagge { border: 2px solid var(--c, #2bd1c0); color: var(--c, #2bd1c0); border-radius: 8px; display: grid; place-items: center; font-weight: 800; font-size: 16px; }
      .hd-cp-balken { border: 2px solid #2a2e35; border-radius: 8px; display: grid; grid-template-rows: auto 1fr auto; text-align: center; padding: 8px; gap: 6px; }
      .hd-cp-balken span { font-size: 13px; font-weight: 700; color: #c3c8d4; }
      .hd-cp-seg { display: grid; grid-auto-rows: 1fr; gap: 4px; }
      .hd-cp-seg i { display: block; background: #15181c; border: 1px solid #2a2e35; border-radius: 2px; font-style: normal; }
      .hd-cp-seg i.hd-g.an { background: #35d07f; border-color: #35d07f; }
      .hd-cp-seg i.hd-b.an { background: #ff4d4d; border-color: #ff4d4d; }
      .hd-cp-pfeil { display: grid !important; place-items: center; color: #8a93a3; font-size: 22px; background: transparent !important; border: 0 !important; }
      .hd-cp-pfeil.an { color: #ffd23f; }
      .hd-cp-steuer { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 4px; }
      .hd-cp-g { position: relative; height: 112px; display: grid; place-items: center; }
      .hd-cp-g svg { width: 100px; height: 100px; }
      .hd-cp-g span { position: absolute; left: 7px; top: 4px; font-size: 12px; font-weight: 800; color: #8a93a3; }
      .hd-cp-knopf { all: unset; box-sizing: border-box; cursor: pointer; height: 112px; display: grid; place-items: center; align-content: center; gap: 6px;
        border: 2px solid #2a2e35; border-radius: 8px; background: #121418; color: #8a93a3; font: 700 14px Inter, system-ui, sans-serif; text-align: center; }
      .hd-cp-knopf:hover { border-color: #4a5160; }
      .hd-cp-knopf:focus-visible, .hd-cp-aktion:focus-visible { outline: 2px solid #00d6ff; outline-offset: 2px; }
      #hd-cp-licht-knopf.an { color: #35d07f; border-color: #35d07f; }
      .hd-cp-aktionen { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
      .hd-cp-aktion { all: unset; box-sizing: border-box; cursor: pointer; height: 96px; display: grid; place-items: center; text-align: center;
        border: 2px solid #2a2e35; border-bottom: 3px solid #00a3e0; border-radius: 8px; background: #1a1d24; color: #f4f6fb;
        font: 800 16px Inter, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; padding: 0 8px; }
      .hd-cp-aktion:hover { background: #232733; }
      .hd-cp-aktion.an { background: #00a3e0; color: #05070c; }
      .hd-cp-aktion.hd-cp-gelb.an { background: #ffd23f; border-bottom-color: #ffd23f; color: #14161c; }
      .hd-cp-aktion:disabled { opacity: .45; cursor: default; }
      /* The standard cockpit's weather tile draws its accent above the screen overlays (seen as a
         stray blue line on the Pit, Race and Dashboard screens). Hidden while another screen shows. */
      #race-dash:not([data-screen="main"]):not([data-screen="auto2"]) #race-wx-box { visibility: hidden; }
    `;
    document.head.appendChild(css);
    // Neu bauen, wenn die Sprache wechselt (die Texte stehen im Aufbau).
    if (typeof i18nNeuzeichnen !== 'undefined') i18nNeuzeichnen.push(() => {
      if (hdCp.el) { hdCp.el.remove(); hdCp.el = null; }
    });
    window.addEventListener('resize', hdCockpitEinpassen);
    // 10x je Sekunde, aber nur, wenn die Ansicht sichtbar ist (mokamitSichtbar prueft zuerst, ein Vergleich).
    hdCp.uhr = setInterval(hdCockpitMalen, 100);
  })();
