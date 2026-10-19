  // =========================================================================
  // Der Raumdesigner (v0.9.39, experimentell)
  // =========================================================================
  // BESTELLT: "Baue einen Raumdesigner im 'Meine Teile' Menue ein, mit dem ich auch andere
  // Formen erstellen kann. Ueberleg dir ein schlaues Design, das mit Gamepad, Touch und Maus
  // funktioniert. Achte dann darauf, dass die Zufallsstrecken vom Editor auch da hineinpassen
  // (aktuell ueberschneiden sie den Rand oft leicht)."
  //
  // DAS DESIGN: Der Raum ist das Rechteck aus "Breite x Tiefe" (teileRaum), geteilt in
  // Zellen von 10 cm. Jede Zelle ist Boden oder Moebel. Gemalt wird mit EINEM Cursor, den
  // alle drei Eingaben gleich bewegen - Finger und Maus setzen ihn direkt, das Gamepad
  // schiebt ihn mit Stick oder Steuerkreuz. Zwei Formen: Pinsel (malen, solange gedrueckt)
  // und Rechteck (zwei Ecken - beim Ziehen Anfang und Ende, am Gamepad zweimal Kreuz). Dazu
  // Vorlagen (Rechteck, L, U, Oval) als schneller Anfang. Ein Raster statt freier Polygone,
  // weil es sich mit einem Steuerkreuz genauso gut bedienen laesst wie mit dem Finger, und
  // weil die Einpassung der Strecke darauf exakt rechnen kann.
  //
  // WARUM DIE ZUFALLSSTRECKEN UEBER DEN RAND RAGTEN: trackZufallPasstRaum() verglich nur
  // die MITTELLINIE mit dem Raum - die Bahn ist aber 25 cm breit, und so stand sie an jeder
  // Seite bis zu 12,5 cm ueber. Dazu lag das Rechteck in der Zeichnung um raumVersatz
  // verschoben, den niemand nach dem Wuerfeln zuruecksetzte. raumEinpassen() rechnet mit der
  // halben Bahnbreite plus 2 cm Abstand und liefert die Lage gleich mit.
  // Die Konstanten (RAUM_FORM_KEY, RAUM_ZELLE_CM, RAUM_FIT_CM, RAUM_RAND_CM, RAUM_STANDARD)
  // stehen in 60-track.js bei RAUM_KEY - siehe dort, warum.

  // ---- Speichern: Lauflaengen, abwechselnd Boden und Moebel, Boden zuerst ----
  function raumFormKodieren(g) {
    const out = [];
    let wert = 0, n = 0;
    for (let i = 0; i < g.length; i++) {
      if (g[i] === wert) { n++; continue; }
      out.push(n); wert = g[i]; n = 1;
    }
    out.push(n);
    return out.join(',');
  }
  function raumFormDekodieren(s, laenge) {
    const g = new Uint8Array(laenge);
    let i = 0, wert = 0;
    for (const teil of String(s || '').split(',')) {
      const n = Math.max(0, parseInt(teil, 10) || 0);
      for (let k = 0; k < n && i < laenge; k++) g[i++] = wert;
      wert = wert ? 0 : 1;
    }
    return g;
  }
  // Die Form passend zur eingetragenen Raumgroesse. Null, wenn eine Achse unbegrenzt ist.
  // Aendert sich die Groesse, bleibt die Ecke oben links stehen und Neues ist Boden.
  function raumFormLaden() {
    const r = teileRaum();
    if (!(r.x > 0 && r.y > 0)) return null;
    const w = Math.max(1, Math.round(r.x * 100 / RAUM_ZELLE_CM));
    const h = Math.max(1, Math.round(r.y * 100 / RAUM_ZELLE_CM));
    const f = { w, h, g: new Uint8Array(w * h) };
    let alt = null;
    try { alt = JSON.parse(localStorage.getItem(RAUM_FORM_KEY) || 'null'); } catch (e) { alt = null; }
    if (alt && alt.w > 0 && alt.h > 0 && typeof alt.g === 'string') {
      const ag = raumFormDekodieren(alt.g, alt.w * alt.h);
      for (let y = 0; y < Math.min(h, alt.h); y++) {
        for (let x = 0; x < Math.min(w, alt.w); x++) f.g[y * w + x] = ag[y * alt.w + x];
      }
    }
    return f;
  }
  function raumFormSpeichern(f) {
    try {
      if (!f || !raumFormHatMoebel(f)) localStorage.removeItem(RAUM_FORM_KEY);
      else localStorage.setItem(RAUM_FORM_KEY, JSON.stringify({ v: 1, w: f.w, h: f.h, g: raumFormKodieren(f.g) }));
    } catch (e) { /* privat */ }
  }
  function raumFormHatMoebel(f) {
    if (!f) return false;
    for (let i = 0; i < f.g.length; i++) if (f.g[i]) return true;
    return false;
  }
  function raumBodenQm(f) {
    let n = 0;
    for (let i = 0; i < f.g.length; i++) if (!f.g[i]) n++;
    return n * RAUM_ZELLE_CM * RAUM_ZELLE_CM / 10000;
  }

  // ---- Freiraumkarte: je 5-cm-Feld der Abstand (cm) zur naechsten Wand oder Moebelkante ----
  // Zwei Durchlaeufe mit Schachbrettgewichten (5 und 7,07 cm) - auf 25 cm Bahnbreite ist der
  // Fehler unter einem Zentimeter, und er geht in die sichere Richtung, weil das Ergebnis
  // unten noch um die halbe Felddiagonale gekuerzt wird.
  function raumFreiKarte(f, Wcm, Hcm) {
    const s = RAUM_FIT_CM;
    const gw = Math.ceil(Wcm / s), gh = Math.ceil(Hcm / s);
    const d = new Float32Array(gw * gh);
    const GROSS = 1e6;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const zx = Math.min(f.w - 1, Math.floor((x + 0.5) * s / RAUM_ZELLE_CM));
        const zy = Math.min(f.h - 1, Math.floor((y + 0.5) * s / RAUM_ZELLE_CM));
        d[y * gw + x] = f.g[zy * f.w + zx] ? 0 : GROSS;
      }
    }
    const D = s * Math.SQRT2;
    const nimm = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (x > 0) nimm(i, i - 1, s);
        if (y > 0) {
          nimm(i, i - gw, s);
          if (x > 0) nimm(i, i - gw - 1, D);
          if (x < gw - 1) nimm(i, i - gw + 1, D);
        }
      }
    }
    for (let y = gh - 1; y >= 0; y--) {
      for (let x = gw - 1; x >= 0; x--) {
        const i = y * gw + x;
        if (x < gw - 1) nimm(i, i + 1, s);
        if (y < gh - 1) {
          nimm(i, i + gw, s);
          if (x < gw - 1) nimm(i, i + gw + 1, D);
          if (x > 0) nimm(i, i + gw - 1, D);
        }
      }
    }
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const cx = (x + 0.5) * s, cy = (y + 0.5) * s;
        // Abstand Mitte zu Moebelmitte, minus halbe Zelle = zur Moebelkante; die Wand exakt.
        const zuMoebel = d[i] >= GROSS ? GROSS : Math.max(0, d[i] - RAUM_ZELLE_CM / 2);
        const zuWand = Math.min(cx, Wcm - cx, cy, Hcm - cy);
        d[i] = Math.min(zuMoebel, zuWand) - s * Math.SQRT1_2;   // sicher fuer jeden Punkt im Feld
      }
    }
    return { d, gw, gh, s };
  }

  // ---- Passt die Strecke in den Raum? ----
  // Ergebnis { rot, versatz, t } oder null. rot ist trackRotationDeg (45-Grad-Schritte, die
  // geraden zuerst), versatz der raumVersatz (cm), mit dem renderTrackPreview() den Raum so
  // um die Strecke legt, dass sie passt, und t die Verschiebung der Streckenpunkte (cm) in
  // Raumkoordinaten (Ecke oben links = 0,0).
  function raumEinpassen(tiles, immer) {
    // v0.9.45: im Editor ausgeblendet = fuer Zufallsstrecken nicht beruecksichtigt. Der
    // Raumgestalter selbst (rdProbe) fragt mit immer = true.
    if (!immer && typeof editorSchalter !== 'undefined' && editorSchalter.raum === false) {
      return { rot: 0, versatz: { x: 0, y: 0 }, t: null };
    }
    const r = teileRaum();
    const W = r.x * 100, H = r.y * 100;
    if (W <= 0 && H <= 0) return { rot: 0, versatz: { x: 0, y: 0 }, t: null };
    if (!tiles || tiles.length < 2) return null;
    const R = TRACK_WIDTH_CM / 2 + RAUM_RAND_CM;
    const merk = trackRotationDeg;
    let pts;
    try { trackRotationDeg = 0; pts = trackCenterline(tiles); } finally { trackRotationDeg = merk; }
    if (!pts || pts.length < 2) return null;
    const P = pts.map(p => [p.x / TRACK_UNITS_PER_CM, p.y / TRACK_UNITS_PER_CM]);
    const form = W > 0 && H > 0 ? raumFormLaden() : null;
    const karte = form && raumFormHatMoebel(form) ? raumFreiKarte(form, W, H) : null;
    for (const schritt of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const a = schritt * 45 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      // Dieselbe Drehung wie trackCenterline() mit trackRotationDeg (y zeigt nach unten).
      const Q = P.map(([x, y]) => [x * c - y * s, x * s + y * c]);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of Q) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
      if (!karte) {
        // Rechteckiger Raum: mittig, mit der halben Bahnbreite an jeder Seite.
        if ((W <= 0 || maxX - minX + 2 * R <= W) && (H <= 0 || maxY - minY + 2 * R <= H)) {
          return { rot: schritt * 45, versatz: { x: 0, y: 0 },
                   t: W > 0 && H > 0 ? { x: W / 2 - mx, y: H / 2 - my } : null };
        }
        continue;
      }
      const txMin = R - minX, txMax = W - R - maxX, tyMin = R - minY, tyMax = H - R - maxY;
      if (txMin > txMax || tyMin > tyMax) continue;
      // Lagen von der Mitte nach aussen: die erste passende liegt so zentral wie moeglich.
      const lagen = [];
      const cx0 = (txMin + txMax) / 2, cy0 = (tyMin + tyMax) / 2;
      for (let tx = txMin; tx <= txMax + 1e-6; tx += RAUM_FIT_CM) {
        for (let ty = tyMin; ty <= tyMax + 1e-6; ty += RAUM_FIT_CM) {
          lagen.push([tx, ty, (tx - cx0) * (tx - cx0) + (ty - cy0) * (ty - cy0)]);
        }
      }
      lagen.sort((u, v) => u[2] - v[2]);
      const frei = (x, y) => {
        const gx = Math.floor(x / karte.s), gy = Math.floor(y / karte.s);
        if (gx < 0 || gy < 0 || gx >= karte.gw || gy >= karte.gh) return -1;
        return karte.d[gy * karte.gw + gx];
      };
      const grob = Q.filter((_, i) => i % 6 === 0);
      for (const [tx, ty] of lagen) {
        let ok = true;
        for (const [x, y] of grob) if (frei(x + tx, y + ty) < R) { ok = false; break; }
        if (!ok) continue;
        for (const [x, y] of Q) if (frei(x + tx, y + ty) < R) { ok = false; break; }
        if (!ok) continue;
        return { rot: schritt * 45, t: { x: tx, y: ty },
                 versatz: { x: -tx - mx + W / 2, y: -ty - my + H / 2 } };
      }
    }
    return null;
  }

  // ---- Zeichnung fuer den Editor: Moebel als Flaechen im Raumrechteck ----
  // x0/y0 ist die Raumecke in Kartenpunkten (mit Versatz), k = Kartenpunkte je cm.
  function raumMoebelSvg(x0, y0, k) {
    const f = raumFormLaden();
    if (!f || !raumFormHatMoebel(f)) return '';
    const z = RAUM_ZELLE_CM * k;
    let s = '';
    for (let y = 0; y < f.h; y++) {
      let x = 0;
      while (x < f.w) {
        if (!f.g[y * f.w + x]) { x++; continue; }
        let e = x;
        while (e < f.w && f.g[y * f.w + e]) e++;
        s += `<rect x="${(x0 + x * z).toFixed(1)}" y="${(y0 + y * z).toFixed(1)}" width="${((e - x) * z).toFixed(1)}" `
           + `height="${z.toFixed(1)}" fill="rgba(255,92,92,.16)"/>`;
        x = e;
      }
    }
    return s;
  }

  // =========================================================================
  // Die Oberflaeche
  // =========================================================================
  const rd = {
    form: null, modus: 'moebel', werkzeug: 'pinsel', groesse: 30,
    cursor: { x: 50, y: 50 }, anker: null, verlauf: [], probe: null, malt: false,
  };
  function raumDsOffen() {
    const el = $('raum-ds');
    return !!(el && !el.hidden);
  }
  function rdMerken() {
    rd.verlauf.push(rd.form.g.slice());
    if (rd.verlauf.length > 40) rd.verlauf.shift();
  }
  function rdRueckgaengig() {
    const g = rd.verlauf.pop();
    if (!g) { showHudToast(t('Nichts rückgängig zu machen')); return; }
    rd.form.g = g;
    rdAenderung();
  }
  function rdAenderung() {
    raumFormSpeichern(rd.form);
    rd.probe = null;
    rdZeichnen();
  }
  // Ein Rechteck in cm (beliebige Ecken) mit dem aktuellen Modus fuellen.
  function rdFuellen(x1, y1, x2, y2) {
    const f = rd.form, wert = rd.modus === 'moebel' ? 1 : 0;
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2), ay = Math.min(y1, y2), by = Math.max(y1, y2);
    for (let y = 0; y < f.h; y++) {
      const cy = (y + 0.5) * RAUM_ZELLE_CM;
      if (cy < ay || cy > by) continue;
      for (let x = 0; x < f.w; x++) {
        const cx = (x + 0.5) * RAUM_ZELLE_CM;
        if (cx >= ax && cx <= bx) f.g[y * f.w + x] = wert;
      }
    }
  }
  function rdPinsel(x, y) {
    const h = Math.max(RAUM_ZELLE_CM, rd.groesse) / 2;
    rdFuellen(x - h, y - h, x + h, y + h);
  }
  function rdGrenzen() { return { W: rd.form.w * RAUM_ZELLE_CM, H: rd.form.h * RAUM_ZELLE_CM }; }
  function rdCursorSetzen(x, y) {
    const { W, H } = rdGrenzen();
    rd.cursor.x = Math.max(0, Math.min(W, x));
    rd.cursor.y = Math.max(0, Math.min(H, y));
  }
  // Kreuz / Antippen: Pinsel malt, Rechteck setzt erst den Anker und fuellt beim zweiten Mal.
  function rdAktion(start) {
    if (rd.werkzeug === 'pinsel') {
      if (start) rdMerken();
      rdPinsel(rd.cursor.x, rd.cursor.y);
      raumFormSpeichern(rd.form);
      rd.probe = null;
      rdZeichnen();
      return;
    }
    if (!start) return;
    if (!rd.anker) { rd.anker = { x: rd.cursor.x, y: rd.cursor.y }; rdZeichnen(); return; }
    rdMerken();
    rdFuellen(rd.anker.x, rd.anker.y, rd.cursor.x, rd.cursor.y);
    rd.anker = null;
    rdAenderung();
  }
  function rdVorlage(name) {
    const f = rd.form;
    rdMerken();
    f.g.fill(0);
    const { W, H } = rdGrenzen();
    const merk = rd.modus;
    rd.modus = 'moebel';
    if (name === 'l') rdFuellen(W * 0.55, 0, W, H * 0.45);
    else if (name === 'u') rdFuellen(W * 0.36, 0, W * 0.64, H * 0.5);
    else if (name === 'oval') {
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const u = ((x + 0.5) * RAUM_ZELLE_CM - W / 2) / (W / 2);
          const v = ((y + 0.5) * RAUM_ZELLE_CM - H / 2) / (H / 2);
          if (u * u + v * v > 1) f.g[y * f.w + x] = 1;
        }
      }
    }
    rd.modus = merk;
    rdAenderung();
  }
  function rdModus(m) { rd.modus = m === 'boden' ? 'boden' : 'moebel'; rdLeiste(); rdZeichnen(); }
  function rdWerkzeug(w) { rd.werkzeug = w === 'rechteck' ? 'rechteck' : 'pinsel'; rd.anker = null; rdLeiste(); rdZeichnen(); }
  const RD_GROESSEN = [10, 30, 60];
  function rdGroesse(cm) { rd.groesse = RD_GROESSEN.indexOf(+cm) >= 0 ? +cm : 30; rdLeiste(); rdZeichnen(); }
  function rdGroesseSchritt(d) {
    const i = RD_GROESSEN.indexOf(rd.groesse);
    rdGroesse(RD_GROESSEN[Math.max(0, Math.min(RD_GROESSEN.length - 1, i + d))]);
  }
  // Die aktuelle Editor-Strecke einpassen und im Raum zeigen.
  function rdProbe() {
    const tiles = currentTrackTiles || [];
    if (tiles.length < 3) { rd.probe = { text: t('Im Editor ist noch keine Strecke.') }; rdZeichnen(); return; }
    const fit = raumEinpassen(tiles, true);
    if (!fit || !fit.t) { rd.probe = { text: t('Die Editor-Strecke passt nicht in diesen Raum.'), schlecht: true }; rdZeichnen(); return; }
    const merk = trackRotationDeg;
    let pts;
    try { trackRotationDeg = fit.rot; pts = trackCenterline(tiles); } finally { trackRotationDeg = merk; }
    rd.probe = {
      text: t('Die Editor-Strecke passt') + (fit.rot ? ' (' + fit.rot + '° ' + t('gedreht') + ')' : '') + '.',
      punkte: pts.map(p => [p.x / TRACK_UNITS_PER_CM + fit.t.x, p.y / TRACK_UNITS_PER_CM + fit.t.y]),
    };
    rdZeichnen();
  }

  function rdLeiste() {
    document.querySelectorAll('#raum-ds [data-rd-modus]').forEach(b => b.classList.toggle('an', b.dataset.rdModus === rd.modus));
    document.querySelectorAll('#raum-ds [data-rd-werkzeug]').forEach(b => b.classList.toggle('an', b.dataset.rdWerkzeug === rd.werkzeug));
    document.querySelectorAll('#raum-ds [data-rd-groesse]').forEach(b => b.classList.toggle('an', +b.dataset.rdGroesse === rd.groesse));
  }
  function rdSvg(f, opts) {
    const o = opts || {};
    const W = f.w * RAUM_ZELLE_CM, H = f.h * RAUM_ZELLE_CM, rand = o.rand === undefined ? 12 : o.rand;
    let s = `<svg viewBox="${-rand} ${-rand} ${W + 2 * rand} ${H + 2 * rand}" class="${o.klasse || ''}" preserveAspectRatio="xMidYMid meet">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#2b3240"/>`;
    for (let y = 0; y < f.h; y++) {
      let x = 0;
      while (x < f.w) {
        if (!f.g[y * f.w + x]) { x++; continue; }
        let e = x;
        while (e < f.w && f.g[y * f.w + e]) e++;
        s += `<rect x="${x * RAUM_ZELLE_CM}" y="${y * RAUM_ZELLE_CM}" width="${(e - x) * RAUM_ZELLE_CM}" height="${RAUM_ZELLE_CM}" fill="#5a2a2e"/>`;
        x = e;
      }
    }
    if (o.raster) {
      let d = '';
      for (let x = 50; x < W; x += 50) d += `M${x} 0V${H}`;
      for (let y = 50; y < H; y += 50) d += `M0 ${y}H${W}`;
      s += `<path d="${d}" stroke="rgba(200,215,240,.18)" stroke-width="${x100(W, H)}" fill="none"/>`;
      for (let x = 100; x < W; x += 100) {
        s += `<text x="${x}" y="${-3}" font-size="${(Math.max(W, H) / 45).toFixed(1)}" text-anchor="middle" fill="#a9b2c4">${x / 100} m</text>`;
      }
    }
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#5aa9ff" stroke-width="${x100(W, H) * 2}"/>`;
    return s;
  }
  function x100(W, H) { return Math.max(0.6, Math.max(W, H) / 400); }
  function rdZeichnen() {
    const host = $('raum-ds-flaeche');
    if (!host || !rd.form) return;
    const f = rd.form, W = f.w * RAUM_ZELLE_CM, H = f.h * RAUM_ZELLE_CM, lw = x100(W, H);
    let s = rdSvg(f, { raster: true, rand: 14 });
    if (rd.probe && rd.probe.punkte) {
      const d = 'M' + rd.probe.punkte.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
      s += `<path d="${d}" fill="none" stroke="#f3f5f8" stroke-width="${TRACK_WIDTH_CM + 1}" stroke-linejoin="round" opacity=".9"/>`;
      s += `<path d="${d}" fill="none" stroke="#0d0f13" stroke-width="${TRACK_WIDTH_CM - 4}" stroke-linejoin="round"/>`;
    }
    const c = rd.cursor;
    if (rd.werkzeug === 'rechteck' && rd.anker) {
      const ax = Math.min(rd.anker.x, c.x), ay = Math.min(rd.anker.y, c.y);
      s += `<rect x="${ax}" y="${ay}" width="${Math.abs(c.x - rd.anker.x)}" height="${Math.abs(c.y - rd.anker.y)}" `
         + `fill="${rd.modus === 'moebel' ? 'rgba(255,92,92,.25)' : 'rgba(61,220,132,.2)'}" stroke="#ffd400" stroke-width="${lw * 2}" stroke-dasharray="${lw * 6} ${lw * 4}"/>`;
    }
    const hb = rd.werkzeug === 'pinsel' ? Math.max(RAUM_ZELLE_CM, rd.groesse) / 2 : lw * 6;
    s += `<rect class="rd-cursor" x="${c.x - hb}" y="${c.y - hb}" width="${hb * 2}" height="${hb * 2}" fill="none" `
       + `stroke="${rd.modus === 'moebel' ? '#ff8a8a' : '#3ddc84'}" stroke-width="${lw * 2.5}"/>`;
    s += '</svg>';
    host.innerHTML = s;
    const info = $('raum-ds-info');
    if (info) {
      info.textContent = (W / 100).toFixed(1).replace('.', ',') + ' × ' + (H / 100).toFixed(1).replace('.', ',') + ' m · '
        + t('Boden') + ' ' + raumBodenQm(f).toFixed(1).replace('.', ',') + ' m²'
        + (rd.probe ? ' · ' + rd.probe.text : '');
      info.classList.toggle('schlecht', !!(rd.probe && rd.probe.schlecht));
    }
  }
  // Die kleine Vorschau in "Meine Teile".
  function raumMiniZeichnen() {
    const host = $('raum-mini');
    if (!host) return;
    const f = raumFormLaden();
    host.innerHTML = f ? rdSvg(f, { rand: 6 }) + '</svg>' : '';
    host.hidden = !f;
  }
  function raumDsOeffnen() {
    let r = teileRaum();
    if (!(r.x > 0 && r.y > 0)) {
      // Ohne Groesse kein Raster: die Vorgabe eintragen, die Felder zeigen sie dann.
      r = { x: r.x > 0 ? r.x : RAUM_STANDARD.x, y: r.y > 0 ? r.y : RAUM_STANDARD.y };
      teileRaumSpeichern(r);
      const fx = $('teile-raum-x'), fy = $('teile-raum-y');
      if (fx) fx.value = String(r.x);
      if (fy) fy.value = String(r.y);
    }
    rd.form = raumFormLaden();
    rd.verlauf = []; rd.anker = null; rd.probe = null; rd.malt = false;
    const { W, H } = rdGrenzen();
    rd.cursor = { x: W / 2, y: H / 2 };
    rdPadStart = true;
    $('raum-ds').hidden = false;
    document.body.classList.add('raum-ds-offen');
    // v0.9.43 wie der Editor: echtes Vollbild, wenn der Browser es erlaubt.
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } catch (e) { /* abgelehnt: das Raster gilt trotzdem */ }
    rdLeiste();
    rdZeichnen();
  }
  function raumDsSchliessen() {
    const el = $('raum-ds');
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.classList.remove('raum-ds-offen');
    // Laeuft gerade das Raum-Tutorial, endet es mit dem Gestalter.
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen() && typeof konsoleTourZu === 'function') konsoleTourZu(true);
    try {
      if (document.fullscreenElement && document.exitFullscreen
          && !document.body.classList.contains('track-fs')) document.exitFullscreen().catch(() => {});
    } catch (e) { /* schon draussen */ }
    rd.anker = null; rd.malt = false;
    raumMiniZeichnen();
    if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
  }

  // ---- Gamepad: aus pollGamepad(), vor allem anderen. true = dieser Takt gehoert uns ----
  // Kreuz malt (Pinsel, gehalten) bzw. setzt Ecke/Rechteck; Quadrat Boden/Moebel; Dreieck
  // Pinsel/Rechteck; L1/R1 Pinselgroesse; Select rueckgaengig; Start Strecke einpassen;
  // Kreis bricht ein halbes Rechteck ab, sonst schliesst er. Nach dem Schliessen gehoert der
  // Takt uns, bis alles losgelassen ist - sonst saehe das Menue den Kreis noch als "zurueck".
  let rdPadVor = [], rdPadStart = false, rdPadSperre = false, rdPadAt = 0, rdWdh = { at: 0, dir: '' };
  function raumPad(pad) {
    const k = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (!raumDsOffen()) {
      if (rdPadSperre) {
        if (pad.buttons.some(b => b && b.pressed)) return true;
        rdPadSperre = false;
      }
      return false;
    }
    const jetzt = performance.now();
    const dt = Math.min(0.1, (jetzt - (rdPadAt || jetzt)) / 1000);
    rdPadAt = jetzt;
    if (rdPadStart) {
      rdPadStart = false;
      rdPadVor = pad.buttons.map((b, i) => k(i));
      return true;
    }
    const neu = (i) => k(i) && !rdPadVor[i];
    const vorher = { x: rd.cursor.x, y: rd.cursor.y };
    // Stick: bis 120 cm/s, quadratisch fuer feines Zielen.
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, tot = 0.18;
    const sx = Math.abs(ax) > tot ? Math.sign(ax) * (Math.abs(ax) - tot) / (1 - tot) : 0;
    const sy = Math.abs(ay) > tot ? Math.sign(ay) * (Math.abs(ay) - tot) / (1 - tot) : 0;
    if (sx || sy) rdCursorSetzen(rd.cursor.x + sx * Math.abs(sx) * 120 * dt, rd.cursor.y + sy * Math.abs(sy) * 120 * dt);
    // Steuerkreuz: eine Zelle je Druck, gehalten nach 300 ms alle 70 ms.
    const dir = k(12) ? 'u' : k(13) ? 'd' : k(14) ? 'l' : k(15) ? 'r' : '';
    if (dir) {
      const erst = dir !== rdWdh.dir;
      if (erst || jetzt - rdWdh.at >= (rdWdh.n ? 70 : 300)) {
        rdWdh = { dir, at: jetzt, n: erst ? 0 : (rdWdh.n || 0) + 1 };
        const z = RAUM_ZELLE_CM;
        rdCursorSetzen(rd.cursor.x + (dir === 'l' ? -z : dir === 'r' ? z : 0),
                       rd.cursor.y + (dir === 'u' ? -z : dir === 'd' ? z : 0));
      }
    } else rdWdh = { at: 0, dir: '' };
    const bewegt = vorher.x !== rd.cursor.x || vorher.y !== rd.cursor.y;
    if (neu(0)) rdAktion(true);
    else if (k(0) && bewegt && rd.werkzeug === 'pinsel') rdAktion(false);
    else if (bewegt) rdZeichnen();
    if (neu(2)) rdModus(rd.modus === 'moebel' ? 'boden' : 'moebel');
    if (neu(3)) rdWerkzeug(rd.werkzeug === 'pinsel' ? 'rechteck' : 'pinsel');
    if (neu(4)) rdGroesseSchritt(-1);
    if (neu(5)) rdGroesseSchritt(1);
    if (neu(8)) rdRueckgaengig();
    if (neu(9)) rdProbe();
    if (neu(1)) {
      if (rd.anker) { rd.anker = null; rdZeichnen(); }
      else { raumDsSchliessen(); rdPadSperre = true; }
    }
    rdPadVor = pad.buttons.map((b, i) => k(i));
    return true;
  }

  // ---- GESPEICHERTE RAEUME (v0.9.45) ---------------------------------------------------
  // BESTELLT: "Erlaube mir, Raeume abzuspeichern mit Namen und im selben Menue auszuwaehlen."
  // Ein Raum ist Groesse plus Form; gespeichert unter seinem Namen. Laden schreibt beides in
  // den aktuellen Raum (omegasim-raum, omegasim-raum-form) - alles andere liest weiter dort.
  const RAEUME_KEY = 'omegasim-raeume', RAUM_AKTIV_KEY = 'omegasim-raum-aktiv';
  function raeumeLesen() {
    try { const x = JSON.parse(localStorage.getItem(RAEUME_KEY) || '{}'); return x && typeof x === 'object' ? x : {}; }
    catch (e) { return {}; }
  }
  function raeumeSchreiben(r) {
    try { localStorage.setItem(RAEUME_KEY, JSON.stringify(r)); } catch (e) { /* privat */ }
  }
  function raumAktivName() {
    try { return localStorage.getItem(RAUM_AKTIV_KEY) || ''; } catch (e) { return ''; }
  }
  function raumSpeichernUnter(name) {
    name = String(name || '').trim().slice(0, 32);
    if (!name) { showHudToast(t('Bitte einen Namen eingeben')); return false; }
    const r = teileRaum();
    if (!(r.x > 0 && r.y > 0)) { showHudToast(t('Erst eine Raumgröße eintragen')); return false; }
    const f = raumFormLaden();
    const alle = raeumeLesen();
    alle[name] = { x: r.x, y: r.y, w: f.w, h: f.h, g: raumFormKodieren(f.g), at: Date.now() };
    raeumeSchreiben(alle);
    try { localStorage.setItem(RAUM_AKTIV_KEY, name); } catch (e) { /* privat */ }
    showHudToast(t('Raum gespeichert') + ': ' + name);
    raumListeZeichnen();
    return true;
  }
  function raumLadenName(name) {
    const r = raeumeLesen()[name];
    if (!r) return false;
    teileRaumSpeichern({ x: r.x, y: r.y });
    try {
      localStorage.setItem(RAUM_FORM_KEY, JSON.stringify({ v: 1, w: r.w, h: r.h, g: r.g }));
      localStorage.setItem(RAUM_AKTIV_KEY, name);
    } catch (e) { /* privat */ }
    const fx = $('teile-raum-x'), fy = $('teile-raum-y');
    if (fx) fx.value = String(r.x);
    if (fy) fy.value = String(r.y);
    raumMiniZeichnen();
    raumListeZeichnen();
    if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
    showHudToast(t('Raum geladen') + ': ' + name);
    return true;
  }
  function raumLoeschenName(name) {
    const alle = raeumeLesen();
    delete alle[name];
    raeumeSchreiben(alle);
    if (raumAktivName() === name) { try { localStorage.removeItem(RAUM_AKTIV_KEY); } catch (e) { /* privat */ } }
    raumListeZeichnen();
  }
  function raumListeZeichnen() {
    const host = $('raum-liste');
    if (!host) return;
    const alle = raeumeLesen(), aktiv = raumAktivName();
    const namen = Object.keys(alle).sort((a, b) => a.localeCompare(b));
    host.innerHTML = '';
    if (!namen.length) {
      host.innerHTML = '<p class="muted" style="margin:0">' + t('Noch kein Raum gespeichert.') + '</p>';
      return;
    }
    for (const name of namen) {
      const r = alle[name];
      const z = document.createElement('div');
      z.className = 'raum-eintrag' + (name === aktiv ? ' aktiv' : '');
      const f = { w: r.w, h: r.h, g: raumFormDekodieren(r.g, r.w * r.h) };
      const esc = String(name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      z.innerHTML = '<span class="raum-eintrag-bild">' + rdSvg(f, { rand: 6 }) + '</svg></span>'
        + '<span class="raum-eintrag-name" data-i18n-skip>' + esc + '</span>'
        + '<span class="raum-eintrag-mass">' + String(r.x).replace('.', ',') + ' \u00d7 ' + String(r.y).replace('.', ',') + ' m</span>';
      const laden = document.createElement('button');
      laden.type = 'button'; laden.textContent = t('Laden');
      laden.addEventListener('click', () => raumLadenName(name));
      const weg = document.createElement('button');
      weg.type = 'button'; weg.className = 'raum-weg warn'; weg.textContent = '\u00d7';
      weg.setAttribute('aria-label', t('Raum löschen'));
      weg.addEventListener('click', () => {
        if (typeof konsoleFrage === 'function') {
          konsoleFrage(t('Raum löschen?'), t('Bist du sicher?') + ' ' + name,
            [[t('Löschen'), () => raumLoeschenName(name)], [t('Abbrechen'), null]], true);
        } else raumLoeschenName(name);
      });
      z.appendChild(laden); z.appendChild(weg);
      host.appendChild(z);
    }
  }

  // ---- TUTORIAL (v0.9.45) ---------------------------------------------------------------
  // BESTELLT: "Baue ein Tutorial fuer den Raum-Editor mit ein, so wie beim Streckeneditor."
  // Dieselbe Fuehrung (konsoleTourStart, 51b-tutorial.js) mit der Liste K_RAUM.
  async function raumTourStarten() {
    if (!raumDsOffen()) raumDsOeffnen();
    if (typeof konsoleTourStart === 'function' && typeof K_RAUM !== 'undefined') konsoleTourStart(K_RAUM);
  }

  (function raumDsAnbinden() {
    const auf = $('raum-designer-auf');
    if (auf) auf.addEventListener('click', raumDsOeffnen);
    if ($('raum-tour')) $('raum-tour').addEventListener('click', raumTourStarten);
    if ($('raum-ds-hilfe')) $('raum-ds-hilfe').addEventListener('click', raumTourStarten);
    if ($('raum-speichern')) {
      $('raum-speichern').addEventListener('click', () => {
        const feld = $('raum-name');
        if (raumSpeichernUnter(feld ? feld.value : '') && feld) feld.value = '';
      });
    }
    raumListeZeichnen();
    const mini = $('raum-mini');
    if (mini) mini.addEventListener('click', raumDsOeffnen);
    const ds = $('raum-ds');
    if (!ds) return;
    ds.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.rdModus) rdModus(b.dataset.rdModus);
      else if (b.dataset.rdWerkzeug) rdWerkzeug(b.dataset.rdWerkzeug);
      else if (b.dataset.rdGroesse) rdGroesse(b.dataset.rdGroesse);
      else if (b.dataset.rdVorlage) rdVorlage(b.dataset.rdVorlage);
      else if (b.id === 'raum-ds-undo') rdRueckgaengig();
      else if (b.id === 'raum-ds-probe') rdProbe();
      else if (b.id === 'raum-ds-fertig') raumDsSchliessen();
    });
    // Finger und Maus: der Cursor folgt dem Zeiger. Pinsel malt beim Ziehen, Rechteck spannt
    // vom Aufsetzen bis zum Loslassen auf.
    const flaeche = $('raum-ds-flaeche');
    const imRaum = (e) => {
      const svg = flaeche.querySelector('svg');
      if (!svg || !svg.getScreenCTM()) return null;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    };
    let zeiger = null;
    flaeche.addEventListener('pointerdown', (e) => {
      const p = imRaum(e);
      if (!p || !e.isPrimary) return;
      e.preventDefault();
      zeiger = e.pointerId;
      try { flaeche.setPointerCapture(e.pointerId); } catch (x) { /* egal */ }
      rdCursorSetzen(p.x, p.y);
      if (rd.werkzeug === 'rechteck') { rd.anker = { x: rd.cursor.x, y: rd.cursor.y }; rdZeichnen(); }
      else rdAktion(true);
    });
    flaeche.addEventListener('pointermove', (e) => {
      const p = imRaum(e);
      if (!p) return;
      rdCursorSetzen(p.x, p.y);
      if (zeiger === e.pointerId && rd.werkzeug === 'pinsel') rdAktion(false);
      else rdZeichnen();
    });
    const los = (e) => {
      if (zeiger !== e.pointerId) return;
      zeiger = null;
      if (rd.werkzeug === 'rechteck' && rd.anker) {
        if (Math.abs(rd.anker.x - rd.cursor.x) < 2 && Math.abs(rd.anker.y - rd.cursor.y) < 2) {
          rd.anker = null; rdZeichnen();      // nur angetippt: nichts fuellen
        } else rdAktion(true);
      }
    };
    flaeche.addEventListener('pointerup', los);
    flaeche.addEventListener('pointercancel', (e) => { if (zeiger === e.pointerId) { zeiger = null; rd.anker = null; rdZeichnen(); } });
    // Tastatur: Pfeile bewegen (Umschalt: 50 cm), Leertaste/Enter wie Kreuz, M Boden/Moebel,
    // R Pinsel/Rechteck, Strg+Z rueckgaengig, Esc schliesst. In der Einfangphase, damit die
    // Menuesteuerung die Tasten nicht auch bekommt.
    window.addEventListener('keydown', (e) => {
      if (!raumDsOffen()) return;
      // Laeuft die Fuehrung, gehoeren ihr die Tasten (Weiter/Zurueck).
      if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) return;
      const k = e.key.toLowerCase();
      const schritt = e.shiftKey ? 50 : RAUM_ZELLE_CM;
      let genutzt = true;
      if (k === 'arrowleft') rdCursorSetzen(rd.cursor.x - schritt, rd.cursor.y);
      else if (k === 'arrowright') rdCursorSetzen(rd.cursor.x + schritt, rd.cursor.y);
      else if (k === 'arrowup') rdCursorSetzen(rd.cursor.x, rd.cursor.y - schritt);
      else if (k === 'arrowdown') rdCursorSetzen(rd.cursor.x, rd.cursor.y + schritt);
      else if (k === ' ' || k === 'enter') { if (!e.repeat || rd.werkzeug === 'pinsel') rdAktion(!e.repeat); }
      else if (k === 'm') rdModus(rd.modus === 'moebel' ? 'boden' : 'moebel');
      else if (k === 'r') rdWerkzeug(rd.werkzeug === 'pinsel' ? 'rechteck' : 'pinsel');
      else if (k === 'z' && (e.ctrlKey || e.metaKey)) rdRueckgaengig();
      else if (k === 'escape') { if (rd.anker) rd.anker = null; else raumDsSchliessen(); }
      else genutzt = false;
      if (genutzt) {
        e.preventDefault(); e.stopPropagation();
        if (k.startsWith('arrow')) rdZeichnen();
        return;
      }
      // Alles andere auch nicht an die Menues durchreichen, solange der Designer offen ist.
      if (!['tab', 'f5', 'f12'].includes(k)) e.stopPropagation();
    }, true);
    raumMiniZeichnen();
    // Die Groessenfelder aendern die Vorschau mit.
    ['teile-raum-x', 'teile-raum-y'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', raumMiniZeichnen); });
    ['raum-x-minus', 'raum-x-plus', 'raum-y-minus', 'raum-y-plus'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('pointerup', () => setTimeout(raumMiniZeichnen, 0));
    });
  })();
