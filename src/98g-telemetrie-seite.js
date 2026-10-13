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
  function teleWahlAufloesen(v, fahrer) {
    if (String(v).indexOf('|') >= 0) return v;
    const ich = fahrer.find((w) => w.indexOf('fremd:') !== 0) || fahrer[0];
    return ich + '|' + v;
  }
  function teleWahlSpur(e, v) {
    const [w, art] = String(v).split('|');
    return e.fahrer[w] ? e.fahrer[w][art] || null : null;
  }

  function teleSeiteZeichnen() {
    const box = $('tele-inhalt');
    if (!box) return;
    const d = teleLesen();
    const strecken = Object.keys(d).filter((k) => d[k] && d[k].fahrer && Object.keys(d[k].fahrer).length)
      .sort((x, y) => (d[y].datum || 0) - (d[x].datum || 0));
    if (!strecken.length) {
      box.innerHTML = '<p class="muted">' + teleEsc(t('Noch keine aufgezeichnete Runde. Fahre ein Rennen oder Time Attack auf der Bahn mit eingescannter Strecke; gespeichert werden Runden, in denen alle Teile gelesen wurden.')) + '</p>';
      return;
    }
    if (strecken.indexOf(teleWahl.strecke) < 0) teleWahl.strecke = strecken[0];
    const e = d[teleWahl.strecke];
    const fahrer = Object.keys(e.fahrer);
    const art = { beste: t('Beste Runde'), letzte: t('Letzte Runde') };
    // Alle Runden dieser Strecke: eigene beste/letzte je Fahrer, fremde (online) als Bestzeit.
    const optionen = [];
    fahrer.forEach((w) => {
      ['beste', 'letzte'].forEach((a) => {
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
      let v = teleWahlAufloesen(teleWahl[x], fahrer);
      if (!gibt(v)) v = teleWahlAufloesen(x === 'a' ? 'letzte' : 'beste', fahrer);
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
      + '<div class="stat-kachel"><span>A · ' + teleEsc(nameVon(teleWahl.a)) + '</span><b>' + teleEsc(formatLapTime(A.ms)) + '</b><small>' + teleEsc(A.auto || '') + '</small></div>'
      + '<div class="stat-kachel"><span>B · ' + teleEsc(nameVon(teleWahl.b)) + '</span><b>' + teleEsc(formatLapTime(B.ms)) + '</b><small>' + teleEsc(B.auto || '') + '</small></div>'
      + '<div class="stat-kachel"><span>A − B</span><b class="' + (diff <= 0 ? 'tele-gut' : 'tele-schlecht') + '">' + teleEsc(teleDeltaText(diff)) + ' s</b><small>' + n + ' ' + teleEsc(t('Teile')) + '</small></div></div>';
    if (!dB) {
      h += '<p class="muted">' + teleEsc(t('Die Runden passen nicht zur selben Strecke.')) + '</p>';
    } else {
      h += '<h3 class="tele-kopf">' + teleEsc(t('Gewinn und Verlust je Teil')) + '</h3>'
        + teleKarteSvg(tiles, dA, dB) + teleBalkenSvg(dA, dB)
        + '<h3 class="tele-kopf">' + teleEsc(t('Tempo über die Runde')) + '</h3>'
        + teleTempoSvg(A, tA, B.code === A.code ? B : null, tB)
        + '<p class="muted tele-legende"><span class="tele-a">━</span> A &nbsp; <span class="tele-b">┅</span> B &nbsp; '
        + '<span class="tele-gas">■</span> ' + teleEsc(t('Gas')) + ' &nbsp; <span class="tele-bremse">■</span> ' + teleEsc(t('Bremse')) + ' (A)'
        + (B.code === A.code ? '' : ' &nbsp; ' + teleEsc(t('B gespiegelt gefahren: nur Zeiten, keine Tempokurve.'))) + '</p>';
    }
    box.innerHTML = h;
    teleWahlVerdrahten();
  }
  function teleWahlVerdrahten() {
    [['tele-strecke', 'strecke'], ['tele-a', 'a'], ['tele-b', 'b']].forEach(([id, k]) => {
      const el = $(id);
      if (el) el.addEventListener('change', () => { teleWahl[k] = el.value; teleSeiteZeichnen(); });
    });
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
    const n = tA.length, W = 600, H = 180, oben = 130;
    const xVon = (weg) => (weg / n * W).toFixed(1);
    const linie = (spur, teile) => (spur.proben || []).map((p, i) => (i ? 'L ' : 'M ') + xVon(teleWeg(teile, spur.ms, p[0]))
      + ' ' + (oben - Math.min(100, p[1]) / 100 * (oben - 6)).toFixed(1)).join(' ');
    let s = '<svg class="tele-tempo" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">';
    for (let k = 1; k < n; k++) s += '<line x1="' + xVon(k) + '" y1="0" x2="' + xVon(k) + '" y2="' + oben + '" stroke="var(--border)" stroke-opacity=".5"/>';
    if (B && tB) s += '<path d="' + linie(B, tB) + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>';
    s += '<path d="' + linie(A, tA) + '" fill="none" stroke="var(--k-blau, #3d8bff)" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    // Gas (oben) und Bremse (unten) von A als Streifen.
    const pr = A.proben || [];
    pr.forEach((p, i) => {
      const x0 = +xVon(teleWeg(tA, A.ms, p[0]));
      const x1 = i + 1 < pr.length ? +xVon(teleWeg(tA, A.ms, pr[i + 1][0])) : x0 + 2;
      const bw = Math.max(0.5, x1 - x0).toFixed(1);
      if (p[2] > 2) s += '<rect x="' + x0.toFixed(1) + '" y="' + (oben + 8) + '" width="' + bw + '" height="16" fill="var(--good)" fill-opacity="' + (p[2] / 100).toFixed(2) + '"/>';
      if (p[3] > 2) s += '<rect x="' + x0.toFixed(1) + '" y="' + (oben + 28) + '" width="' + bw + '" height="16" fill="var(--bad)" fill-opacity="' + (p[3] / 100).toFixed(2) + '"/>';
    });
    return s + '</svg>';
  }
