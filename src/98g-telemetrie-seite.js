  // ====================================================================================
  // TELEMETRIE-SEITE (v1.0.21, WIP) - Optionen > Telemetrie
  // ====================================================================================
  //
  // BESTELLT (Plan "Telemetrie der Bestzeiten und Challenger", Phase 2): zwei Runden derselben
  // Strecke nebeneinander - wo verliere ich Zeit? Drei Bilder aus den Spuren von
  // 70b-telemetrie.js:
  //   1. die Strecke, jedes Teil gefaerbt nach Gewinn (gruen) oder Verlust (rot) von A gegen B;
  //   2. Balken "+/- ms je Teil";
  //   3. Tempo ueber den Rundenweg (A durchgezogen, B gestrichelt), darunter Gas und Bremse von A.
  // Der Rundenweg ist "Teil + Anteil im Teil" aus den Zwischenzeiten - so liegen zwei Runden
  // uebereinander, auch wenn eine langsamer war.

  var teleWahl = { strecke: null, a: 'letzte', b: 'beste' };

  function teleEsc(x) {
    return String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }
  function teleDauern(teile, ms) {
    return teile.map((t, k) => (k + 1 < teile.length ? teile[k + 1] : ms) - t);
  }
  // Rundenweg (in Teilen) zur Zeit t einer Runde.
  function teleWeg(teile, ms, tMs) {
    const n = teile.length;
    let k = 0;
    while (k + 1 < n && teile[k + 1] <= tMs) k++;
    const dauer = (k + 1 < n ? teile[k + 1] : ms) - teile[k];
    return k + Math.max(0, Math.min(1, dauer > 0 ? (tMs - teile[k]) / dauer : 0));
  }
  // strecke: Schluessel im Telemetrie-Speicher; ohne Angabe die gelegte Strecke.
  function teleSeiteOeffnen(strecke) {
    if (typeof raceGridOffen === 'function' && raceGridOffen() && typeof raceGridAbbrechen === 'function') raceGridAbbrechen();
    if (strecke) teleWahl.strecke = strecke;
    else if (typeof currentTrackTiles !== 'undefined' && currentTrackTiles && currentTrackTiles.length >= 3) {
      try { teleWahl.strecke = bestzeitSchluessel(currentTrackTiles); } catch (e) { /* ohne Strecke */ }
    }
    showTab('options');
    showSubpage('opt-telemetrie');
  }
  // Auswahlwerte sind "fahrer|beste" oder "fahrer|letzte"; ein blosses "beste"/"letzte" meint
  // den eigenen (ersten nicht fremden) Fahrer.
  // v1.0.28: "letzte" meint mit gemerkter Fahrt deren letzte Runde - und ist die zugleich die
  // beste, die davor, damit A und B nicht dieselbe Runde zeigen (GEMELDET: "es wird nur
  // letzte = beste Runde angezeigt").
  function teleWahlAufloesen(v, fahrer, e) {
    if (String(v).indexOf('|') >= 0) return v;
    const ich = fahrer.find((w) => w.indexOf('fremd:') !== 0) || fahrer[0];
    const f = e && e.fahrer[ich];
    const runden = f && f.fahrt ? f.fahrt.runden : null;
    if (v === 'letzte' && runden && runden.length) {
      let j = runden.length - 1;
      const gleich = (a, b) => a && b && a.ms === b.ms && a.datum === b.datum;
      if (j > 0 && gleich(runden[j], f.beste)) j--;
      return ich + '|r' + j;
    }
    return ich + '|' + v;
  }
  function teleWahlSpur(e, v) {
    const [w, art] = String(v).split('|');
    const f = e.fahrer[w];
    if (!f) return null;
    const m = /^r(\d+)$/.exec(art || '');
    if (m) return f.fahrt && f.fahrt.runden[+m[1]] || null;
    return f[art] || null;
  }

  // v1.0.25: Runden mit nicht gelesenen Teilen (70b-telemetrie.js) sagen, wie viele geschaetzt sind.
  function teleGeschaetztText(sp) {
    return sp && sp.geschaetzt ? ' · ' + t('{n} Teile geschätzt').replace('{n}', sp.geschaetzt) : '';
  }
  function teleSeiteZeichnen() {
    const box = $('tele-inhalt');
    if (!box) return;
    const d = teleLesen();
    const strecken = Object.keys(d).filter((k) => d[k] && d[k].fahrer && Object.keys(d[k].fahrer).length)
      .sort((x, y) => (d[y].datum || 0) - (d[x].datum || 0));
    if (!strecken.length) {
      box.innerHTML = '<p class="muted">' + teleEsc(t('Noch keine aufgezeichnete Runde. Fahre ein Rennen oder Time Attack auf der Bahn mit eingescannter Strecke; gespeichert wird jede gewertete Runde, in der sich mindestens drei Viertel der Teile zuordnen lassen (die übrigen werden geschätzt).')) + '</p>';
      return;
    }
    if (strecken.indexOf(teleWahl.strecke) < 0) teleWahl.strecke = strecken[0];
    const e = d[teleWahl.strecke];
    const fahrer = Object.keys(e.fahrer);
    const art = { beste: t('Beste Runde (alle Fahrten)'), letzte: t('Letzte Runde') };
    // Alle Runden dieser Strecke: eigene beste/letzte je Fahrer, fremde (online) als Bestzeit.
    const optionen = [];
    fahrer.forEach((w) => {
      // v1.0.28: alle Runden der letzten Fahrt, dann die beste aller Fahrten.
      const fw = e.fahrer[w];
      const runden = fw.fahrt && fw.fahrt.runden && w.indexOf('fremd:') !== 0 ? fw.fahrt.runden : [];
      runden.forEach((sp, j) => {
        const best = fw.beste && sp.ms === fw.beste.ms && sp.datum === fw.beste.datum;
        optionen.push([w + '|r' + j, (sp.runde ? t('Runde') + ' ' + sp.runde : t('Runde') + ' ' + (j + 1))
          + (best ? ' · ' + t('Bestzeit') : '') + ' (' + formatLapTime(sp.ms) + ')']);
      });
      (runden.length ? ['beste'] : ['beste', 'letzte']).forEach((a) => {
        const sp = e.fahrer[w][a];
        if (!sp) return;
        const name = w.indexOf('fremd:') === 0 ? sp.auto + ' · ' + t('Bestzeit')
          : (fahrer.filter((x) => x.indexOf('fremd:') !== 0).length > 1 ? (sp.auto || w) + ' · ' : '') + art[a];
        optionen.push([w + '|' + a, name + ' (' + formatLapTime(sp.ms) + ')']);
      });
    });
    // Nach einem Streckenwechsel gibt es die alte Auswahl dort meist nicht: dann die Vorgabe
    // (A letzte, B beste eigene Runde), sonst die erste vorhandene.
    const gibt = (v) => optionen.some((o) => o[0] === v);
    ['a', 'b'].forEach((x) => {
      let v = teleWahlAufloesen(teleWahl[x], fahrer, e);
      if (!gibt(v)) v = teleWahlAufloesen(x === 'a' ? 'letzte' : 'beste', fahrer, e);
      if (!gibt(v) && optionen.length) v = optionen[0][0];
      teleWahl[x] = v;
    });
    const sel = (id, opts, wert) => '<select id="' + id + '">' + opts.map(([v, txt]) =>
      '<option value="' + teleEsc(v) + '"' + (v === wert ? ' selected' : '') + '>' + teleEsc(txt) + '</option>').join('') + '</select>';
    const nameVon = (v) => { const o = optionen.find((x) => x[0] === v); return o ? o[1].replace(/ \([^)]*\)$/, '') : ''; };
    let h = '<div class="tele-wahl">'
      + '<label>' + teleEsc(t('Strecke')) + ' ' + sel('tele-strecke', strecken.map((k) => [k, k]), teleWahl.strecke) + '</label>'
      + '<label>A ' + sel('tele-a', optionen, teleWahl.a) + '</label>'
      + '<label>B ' + sel('tele-b', optionen, teleWahl.b) + '</label></div>';
    const A = teleWahlSpur(e, teleWahl.a), B = teleWahlSpur(e, teleWahl.b);
    if (!A || !B) {
      box.innerHTML = h + '<p class="muted">' + teleEsc(t('Für diese Auswahl gibt es keine Runde.')) + '</p>';
      teleWahlVerdrahten();
      return;
    }
    const tiles = codeToTrack(A.code).tiles;
    const tA = A.teile, tB = teleAusrichten(B, tiles);
    const n = tiles.length;
    const dA = teleDauern(tA, A.ms), dB = tB ? teleDauern(tB, B.ms) : null;
    const diff = A.ms - B.ms;
    h += '<div class="stat-raster">'
      + '<div class="stat-kachel"><span>A · ' + teleEsc(nameVon(teleWahl.a)) + '</span><b>' + teleEsc(formatLapTime(A.ms)) + '</b><small>' + teleEsc((A.auto || '') + teleGeschaetztText(A)) + '</small></div>'
      + '<div class="stat-kachel"><span>B · ' + teleEsc(nameVon(teleWahl.b)) + '</span><b>' + teleEsc(formatLapTime(B.ms)) + '</b><small>' + teleEsc((B.auto || '') + teleGeschaetztText(B)) + '</small></div>'
      + '<div class="stat-kachel"><span>A − B</span><b class="' + (diff <= 0 ? 'tele-gut' : 'tele-schlecht') + '">' + teleEsc(teleDeltaText(diff)) + ' s</b><small>' + n + ' ' + teleEsc(t('Teile')) + '</small></div></div>';
    if (!dB) {
      h += '<p class="muted">' + teleEsc(t('Die Runden passen nicht zur selben Strecke.')) + '</p>';
    } else {
      h += '<h3 class="tele-kopf">' + teleEsc(t('Gewinn und Verlust je Teil')) + '</h3>'
        + teleKarteSvg(tiles, dA, dB) + teleBalkenSvg(dA, dB)
        + '<h3 class="tele-kopf">' + teleEsc(t('Tempo über die Runde')) + '</h3>'
        + teleTempoSvg(A, tA, B.code === A.code ? B : null, tB)
        + '<p class="muted tele-legende"><span class="tele-a">━</span> A &nbsp; <span class="tele-b">┅</span> B &nbsp; '
        + '<span class="tele-gas">■</span> ' + teleEsc(t('Gas')) + ' &nbsp; <span class="tele-bremse">■</span> ' + teleEsc(t('Bremse'))
        + ' (' + teleEsc(t('je oben A, darunter B')) + ') &nbsp; ▼ ' + teleEsc(t('Kurvenminimum von A (Tempo in %)'))
        + (B.code === A.code ? '' : ' &nbsp; ' + teleEsc(t('B gespiegelt gefahren: nur Zeiten, keine Tempokurve.'))) + '</p>'
        // v1.5 (WIP, aus Hybrid-Dash 4.0 von Mo Kamit, MIT): Zeitabstand ueber den Rundenweg und die Sektor-Matrix.
        + '<h3 class="tele-kopf">' + teleEsc(t('Zeitabstand A − B über die Runde')) + ' <span class="wip-tag">WIP</span></h3>'
        + teleDeltaSvg(dA, dB)
        + '<p class="muted tele-legende">' + teleEsc(t('Steigt die Linie, verliert A dort Zeit; fällt sie, holt A auf.')) + '</p>'
        + teleSektorMatrix(e, teleWahl.a, tiles)
        + teleVorfallBlock(teleWahl.strecke);
    }
    box.innerHTML = h;
    teleWahlVerdrahten();
  }
  function teleWahlVerdrahten() {
    [['tele-strecke', 'strecke'], ['tele-a', 'a'], ['tele-b', 'b']].forEach(([id, k]) => {
      const el = $(id);
      if (el) el.addEventListener('change', () => { teleWahl[k] = el.value; teleSeiteZeichnen(); });
    });
    const weg = $('tele-vorfall-weg');
    if (weg) weg.addEventListener('click', () => { vorfallLoeschen(teleWahl.strecke); teleSeiteZeichnen(); });
  }

  // ---- VORFALLKARTE (v1.5, WIP, nach Hybrid-Dash 4.0 von Mo Kamit, MIT) ------------------------------
  // Jeder Kontakt (Crash-Erkennung, 70-race.js) und jedes Abkommen (Spieler: 50-drive.js, NPCs: parkCar in
  // 90-ghosts.js) waehrend eines Rennens wird mit dem Ort gemerkt (Teil + Anteil). Die Karte zeigt, wo es
  // sich haeuft. Je Strecke hoechstens 500 Eintraege, die 12 zuletzt gefahrenen Strecken.
  const VORFALL_STORE = 'omegasim-vorfaelle.v1';
  const VORFALL_ART = { crash: { name: 'Kontakt', farbe: '#ff5c5c' }, off: { name: 'Neben der Bahn', farbe: '#ffb02e' } };
  function vorfallLesen() {
    try { const d = JSON.parse(localStorage.getItem(VORFALL_STORE) || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }
  function vorfallSchreiben(d) {
    const keys = Object.keys(d).sort((a, b) => (d[b].datum || 0) - (d[a].datum || 0));
    keys.slice(12).forEach((k) => delete d[k]);
    try { localStorage.setItem(VORFALL_STORE, JSON.stringify(d)); } catch (e) { /* voll oder privat */ }
  }
  function vorfallOrt(wer) {
    try {
      if (wer >= 2) { const z = zusatzPlatz(wer); return z && z.car ? ghostOrt(z.car) : null; }
      return dashMinimapIndex === null || dashMinimapIndex === undefined ? null : dashMinimapIndex + dashTilePhase();
    } catch (e) { return null; }
  }
  function vorfallBei(art, wer, ort) {
    if (!VORFALL_ART[art] || ort === null || ort === undefined || !Number.isFinite(ort)) return;
    if (raceState !== 'racing' && raceState !== 'finishing') return;
    if (!currentTrackTiles || currentTrackTiles.length < 3) return;
    let key, code;
    try { key = bestzeitSchluessel(currentTrackTiles); code = trackToCode(currentTrackTiles, 0); } catch (e) { return; }
    const d = vorfallLesen();
    let e = d[key];
    if (!e || e.code !== code) e = d[key] = { code, liste: [] };
    e.datum = Date.now();
    e.liste.push({ a: art, w: wer, o: Math.round(ort * 100) / 100, t: Date.now() });
    if (e.liste.length > 500) e.liste.splice(0, e.liste.length - 500);
    vorfallSchreiben(d);
  }
  function vorfallMerken(art, wer) { vorfallBei(art, 'p' + (wer || 1), vorfallOrt(wer || 1)); }
  function vorfallMerkenAuto(art, car) { let o = null; try { o = ghostOrt(car); } catch (e) { o = null; } vorfallBei(art, 'npc', o); }
  function vorfallLoeschen(key) { const d = vorfallLesen(); if (d[key]) { delete d[key]; vorfallSchreiben(d); } }
  // Punkt auf der Mittellinie zum Ort (Teil + Anteil).
  function vorfallPunkt(pts, tab, n, ort) {
    const k = ((Math.floor(ort) % n) + n) % n, frac = Math.max(0, Math.min(1, ort - Math.floor(ort)));
    const a = tab.start[k], b = k + 1 < n ? tab.start[k + 1] : pts.length - 1;
    return pts[Math.min(pts.length - 1, Math.round(a + frac * (b - a)))];
  }
  function teleVorfallBlock(key) {
    const e = vorfallLesen()[key];
    if (!e || !e.liste || !e.liste.length) return '';
    let tiles;
    try { tiles = codeToTrack(e.code).tiles; } catch (err) { return ''; }
    const pts = trackCenterline(tiles), n = tiles.length, tab = trackKachelTabelle(pts, n);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const pad = TRACK_HALF_W * 1.5;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * pad, hh = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    const sw = (TRACK_HALF_W * 2).toFixed(1), r = (TRACK_HALF_W * 0.38).toFixed(1);
    let svg = '<svg class="tele-karte tele-vorfaelle" viewBox="' + [x0, y0, w, hh].map((v) => v.toFixed(1)).join(' ') + '" role="img">'
      + '<path d="M ' + pts.map((q) => q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join(' L ') + '" fill="none" stroke="var(--border)" stroke-width="' + sw + '" stroke-linejoin="round"/>';
    const zahl = { crash: 0, off: 0 }, wer = { spieler: 0, npc: 0 };
    e.liste.forEach((v) => {
      const art = VORFALL_ART[v.a];
      if (!art) return;
      zahl[v.a]++; wer[v.w === 'npc' ? 'npc' : 'spieler']++;
      const q = vorfallPunkt(pts, tab, n, v.o);
      // NPCs hohl, Spieler gefuellt.
      svg += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + r + '" fill="' + (v.w === 'npc' ? 'none' : art.farbe)
        + '" fill-opacity=".75" stroke="' + art.farbe + '" stroke-width="' + (TRACK_HALF_W * 0.12).toFixed(1) + '"><title>' + teleEsc(t(art.name)) + ' · ' + (Math.floor(v.o) + 1) + '</title></circle>';
    });
    const p0 = pts[0];
    svg += '<circle cx="' + p0.x.toFixed(1) + '" cy="' + p0.y.toFixed(1) + '" r="' + (TRACK_HALF_W * 0.5).toFixed(1) + '" fill="var(--ink, #fff)"/></svg>';
    return '<h3 class="tele-kopf">' + teleEsc(t('Vorfälle auf dieser Strecke')) + ' <span class="wip-tag">WIP</span></h3>' + svg
      + '<p class="muted tele-legende">' + Object.keys(VORFALL_ART).map((k) => '<span style="color:' + VORFALL_ART[k].farbe + '">●</span> ' + teleEsc(t(VORFALL_ART[k].name)) + ' ' + zahl[k]).join(' &nbsp; ')
      + ' &nbsp; · ' + teleEsc(t('gefüllt: Spieler ({s}), hohl: NPCs ({n})').replace('{s}', wer.spieler).replace('{n}', wer.npc)) + '</p>'
      + '<div class="opt-row opt-breit"><button type="button" id="tele-vorfall-weg">' + teleEsc(t('Vorfälle dieser Strecke löschen')) + '</button></div>';
  }
  // Farbe fuer einen Unterschied: gruen schneller, rot langsamer, Deckkraft mit der Groesse.
  function teleFarbe(dd, max) {
    const a = Math.max(0.25, Math.min(1, Math.abs(dd) / Math.max(1, max)));
    return { farbe: dd <= 0 ? 'var(--good)' : 'var(--bad)', a: a.toFixed(2) };
  }
  function teleKarteSvg(tiles, dA, dB) {
    const pts = trackCenterline(tiles), n = tiles.length;
    const tab = trackKachelTabelle(pts, n);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = TRACK_HALF_W * 1.5;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * pad, hh = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    const max = Math.max(...dA.map((x, k) => Math.abs(x - dB[k])));
    const sw = (TRACK_HALF_W * 2).toFixed(1);
    let s = '<svg class="tele-karte" viewBox="' + [x0, y0, w, hh].map((v) => v.toFixed(1)).join(' ') + '" role="img">'
      + '<path d="M ' + pts.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ') + '" fill="none" stroke="var(--border)" stroke-width="' + sw + '" stroke-linejoin="round"/>';
    for (let k = 0; k < n; k++) {
      const a = tab.start[k], b = k + 1 < n ? tab.start[k + 1] : pts.length - 1;
      const c = teleFarbe(dA[k] - dB[k], max);
      s += '<path d="M ' + pts.slice(a, b + 1).map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ')
        + '" fill="none" stroke="' + c.farbe + '" stroke-opacity="' + c.a + '" stroke-width="' + (sw * 0.8).toFixed(1) + '"/>';
    }
    const p0 = pts[0];
    s += '<circle cx="' + p0.x.toFixed(1) + '" cy="' + p0.y.toFixed(1) + '" r="' + (TRACK_HALF_W * 0.5).toFixed(1) + '" fill="var(--ink, #fff)"/></svg>';
    return s;
  }
  function teleBalkenSvg(dA, dB) {
    const n = dA.length, W = 600, H = 140, m = H / 2;
    const d = dA.map((x, k) => x - dB[k]);
    const max = Math.max(50, ...d.map(Math.abs));
    const bw = W / n;
    let s = '<svg class="tele-balken" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">'
      + '<line x1="0" y1="' + m + '" x2="' + W + '" y2="' + m + '" stroke="var(--border)"/>';
    d.forEach((x, k) => {
      const hgt = Math.abs(x) / max * (m - 6);
      const c = teleFarbe(x, max);
      s += '<rect x="' + (k * bw + bw * 0.15).toFixed(1) + '" y="' + (x > 0 ? m : m - hgt).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1)
        + '" height="' + Math.max(1, hgt).toFixed(1) + '" fill="' + c.farbe + '"><title>' + (k + 1) + ': ' + teleDeltaText(x) + ' s</title></rect>';
    });
    return s + '</svg><div class="tele-achse muted"><span>' + teleEsc(t('Start')) + '</span><span>±' + (max / 1000).toFixed(2) + ' s</span><span>' + teleEsc(t('Ziel')) + '</span></div>';
  }
  function teleTempoSvg(A, tA, B, tB) {
    const n = tA.length, W = 600, H = 196, oben = 130;
    const xVon = (weg) => (weg / n * W).toFixed(1);
    const linie = (spur, teile) => (spur.proben || []).map((p, i) => (i ? 'L ' : 'M ') + xVon(teleWeg(teile, spur.ms, p[0]))
      + ' ' + (oben - Math.min(100, p[1]) / 100 * (oben - 6)).toFixed(1)).join(' ');
    let s = '<svg class="tele-tempo" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">';
    for (let k = 1; k < n; k++) s += '<line x1="' + xVon(k) + '" y1="0" x2="' + xVon(k) + '" y2="' + oben + '" stroke="var(--border)" stroke-opacity=".5"/>';
    if (B && tB) s += '<path d="' + linie(B, tB) + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>';
    s += '<path d="' + linie(A, tA) + '" fill="none" stroke="var(--k-blau, #3d8bff)" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    // Gas und Bremse als Streifen: je A (oben, 10 hoch) und B (darunter, 5 hoch). v1.5: B dazu, aus Hybrid-Dash.
    const streifen = (spur, teile, yGas, yBremse, hoch) => {
      const pr = spur.proben || [];
      pr.forEach((p, i) => {
        const x0 = +xVon(teleWeg(teile, spur.ms, p[0]));
        const x1 = i + 1 < pr.length ? +xVon(teleWeg(teile, spur.ms, pr[i + 1][0])) : x0 + 2;
        const bw = Math.max(0.5, x1 - x0).toFixed(1);
        if (p[2] > 2) s += '<rect x="' + x0.toFixed(1) + '" y="' + yGas + '" width="' + bw + '" height="' + hoch + '" fill="var(--good)" fill-opacity="' + (p[2] / 100).toFixed(2) + '"/>';
        if (p[3] > 2) s += '<rect x="' + x0.toFixed(1) + '" y="' + yBremse + '" width="' + bw + '" height="' + hoch + '" fill="var(--bad)" fill-opacity="' + (p[3] / 100).toFixed(2) + '"/>';
      });
    };
    streifen(A, tA, oben + 8, oben + 34, 10);
    if (B && tB) streifen(B, tB, oben + 19, oben + 45, 5);
    s += '</svg>';
    // Kurvenminima von A: als HTML ueber dem SVG, weil Text im gestreckten SVG (preserveAspectRatio none) verzerrt.
    const marken = teleKurvenMinima(A, tA).map((m) => '<span class="tele-min" style="left:' + (m.weg / n * 100).toFixed(2)
      + '%;top:' + ((oben - Math.min(100, m.v) / 100 * (oben - 6)) / H * 100).toFixed(2) + '%">▼' + Math.round(m.v) + '</span>').join('');
    return '<div class="tele-tempo-box">' + s + marken + '</div>';
  }
  // Talsohlen der Tempokurve: ein Minimum, das auf beiden Seiten um mindestens TIEFE Prozentpunkte
  // ueberragt wird (sonst waere jedes Rauschen eine Kurve). Hoechstens 12, die tiefsten zuerst.
  const TELE_MIN_TIEFE = 8;
  function teleKurvenMinima(A, tA) {
    const pr = (A && A.proben) || [];
    const v = pr.map((p) => p[1]);
    const out = [];
    for (let i = 1; i + 1 < v.length; i++) {
      if (!(v[i] <= v[i - 1] && v[i] < v[i + 1])) continue;
      let l = v[i], r = v[i];
      for (let j = i - 1; j >= 0 && v[j] >= v[i]; j--) l = Math.max(l, v[j]);
      for (let j = i + 1; j < v.length && v[j] >= v[i]; j++) r = Math.max(r, v[j]);
      if (Math.min(l, r) - v[i] >= TELE_MIN_TIEFE) out.push({ weg: teleWeg(tA, A.ms, pr[i][0]), v: v[i] });
    }
    return out.sort((a, b) => a.v - b.v).slice(0, 12).sort((a, b) => a.weg - b.weg);
  }
  // Zeitabstand A - B an jeder Teilgrenze (Summe der Teil-Unterschiede): steigt = A verliert dort.
  function teleDeltaPunkte(dA, dB) {
    const out = [0];
    let sum = 0;
    dA.forEach((x, k) => { sum += x - dB[k]; out.push(sum); });
    return out;
  }
  function teleDeltaSvg(dA, dB) {
    const pk = teleDeltaPunkte(dA, dB), n = dA.length, W = 600, H = 120, m = H / 2;
    const max = Math.max(50, ...pk.map(Math.abs));
    const y = (d) => (m - d / max * (m - 6)).toFixed(1);
    const pfad = pk.map((d, k) => (k ? 'L ' : 'M ') + (k / n * W).toFixed(1) + ' ' + y(d)).join(' ');
    let s = '<svg class="tele-delta" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">'
      + '<line x1="0" y1="' + m + '" x2="' + W + '" y2="' + m + '" stroke="var(--border)"/>'
      + '<path d="' + pfad + ' L ' + W + ' ' + m + ' L 0 ' + m + ' Z" fill="var(--bad)" fill-opacity=".12"/>'
      + '<path d="' + pfad + '" fill="none" stroke="var(--k-blau, #3d8bff)" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    pk.forEach((d, k) => { s += '<circle cx="' + (k / n * W).toFixed(1) + '" cy="' + y(d) + '" r="2" fill="var(--k-blau, #3d8bff)"><title>' + k + ': ' + teleDeltaText(d) + ' s</title></circle>'; });
    return s + '</svg><div class="tele-achse muted"><span>' + teleEsc(t('Start')) + '</span><span>±' + (max / 1000).toFixed(2)
      + ' s</span><span>' + teleEsc(t('Ziel')) + ' ' + teleDeltaText(pk[pk.length - 1]) + ' s</span></div>';
  }
  // Sektorzeiten der Runden einer Fahrt: drei Sektoren als Drittel der Teile. [[s1, s2, s3], ...] in ms.
  function teleSektoren(runden, tiles) {
    const n = tiles.length;
    const g1 = Math.round(n / 3), g2 = Math.round(2 * n / 3);
    const out = [];
    (runden || []).forEach((sp) => {
      const te = teleAusrichten(sp, tiles);
      if (!te || te.length !== n) return;
      out.push({ runde: sp.runde, ms: sp.ms, s: [te[g1] - te[0], te[g2] - te[g1], sp.ms - te[g2]] });
    });
    return out.slice(-20);
  }
  function teleStreuung(xs) {
    if (xs.length < 2) return 0;
    const mw = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - mw) * (b - mw), 0) / (xs.length - 1));
  }
  function teleSektorMatrix(e, wahlA, tiles) {
    const w = String(wahlA).split('|')[0];
    const fw = e && e.fahrer[w];
    if (!fw || w.indexOf('fremd:') === 0 || !fw.fahrt) return '';
    const zeilen = teleSektoren(fw.fahrt.runden, tiles);
    if (zeilen.length < 2) return '';
    const spalte = (j) => zeilen.map((z) => z.s[j]);
    const beste = [0, 1, 2].map((j) => Math.min(...spalte(j)));
    const sek = (ms) => (ms / 1000).toFixed(2);
    let h = '<h3 class="tele-kopf">' + teleEsc(t('Sektoren der Fahrt von A')) + ' <span class="wip-tag">WIP</span></h3>'
      + '<div class="doc-table-wrap"><table class="tele-sektoren"><thead><tr><th>' + teleEsc(t('Runde')) + '</th><th>S1</th><th>S2</th><th>S3</th><th>'
      + teleEsc(t('Zeit')) + '</th></tr></thead><tbody>';
    zeilen.forEach((z, i) => {
      h += '<tr><td>' + (z.runde || i + 1) + '</td>' + z.s.map((x, j) => '<td' + (x === beste[j] ? ' class="tele-gut"' : '') + '>' + sek(x) + '</td>').join('')
        + '<td>' + teleEsc(formatLapTime(z.ms)) + '</td></tr>';
    });
    const streu = [0, 1, 2].map((j) => teleStreuung(spalte(j)));
    const schlecht = streu.indexOf(Math.max(...streu));
    h += '<tr class="tele-streu"><td>±</td>' + streu.map((x, j) => '<td' + (j === schlecht ? ' class="tele-schlecht"' : '') + '>' + sek(x) + '</td>').join('')
      + '<td>' + sek(teleStreuung(zeilen.map((z) => z.ms))) + '</td></tr></tbody></table></div>'
      + '<p class="muted tele-legende">' + teleEsc(t('Sektoren sind Drittel der Teile. Grün: bester Wert je Sektor. ±: Streuung (Standardabweichung); rot ist der Sektor, in dem die Runden am wenigsten gleich sind.')) + '</p>';
    return h;
  }
