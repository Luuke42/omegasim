  // ============================== STRECKENBILD (v1.0.15) ==============================
  //
  // BESTELLT: "Editor-Screenshot: huebsches PNG mit Strecke, optional Raum und Ideallinie,
  // Code, OmegaSim-Link, Massen und Laenge." Gezeichnet wird dieselbe Karte wie im Editor
  // (renderTrackPreview), mit dem, was dort gerade eingeschaltet ist: Ideallinie und Raum
  // folgen den zwei Schaltern in der Editorleiste.
  //
  // WARUM DIE STILE KOPIERT WERDEN: die Karte ist ein SVG mit Klassen (tp-*), und deren
  // Farben stehen im Stylesheet der Seite. Als Bild geladen sieht ein SVG kein Stylesheet -
  // es kaeme schwarz auf schwarz heraus. Also bekommt jedes Element seine berechneten Werte
  // als style-Attribut, bevor es serialisiert wird.
  //
  // SPEICHERN: im Browser als Download; in der App ueber OmegaSicherung.bild (ab APK 1.0.15),
  // weil die WebView keine Blob-Downloads kennt. Das Bild landet dort unter Bilder/OmegaSim.
  const BILD_W = 1600, BILD_H = 1000;
  const BILD_LINK = 'lukasroeseler.github.io/btsr';
  // v1.1.3: mehr Eigenschaften (Striche, Marker, Filter, Schrift), und ein schon gesetztes
  // style-Attribut bleibt erhalten (vorher ueberschrieben).
  const BILD_STILE = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'paint-order', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'text-anchor', 'dominant-baseline', 'display', 'visibility', 'marker-start', 'marker-mid', 'marker-end',
    'filter', 'clip-path', 'mix-blend-mode'];

  function streckenbildStileUebertragen(orig, klon) {
    const a = [orig].concat(Array.from(orig.querySelectorAll('*')));
    const b = [klon].concat(Array.from(klon.querySelectorAll('*')));
    for (let i = 0; i < a.length && i < b.length; i++) {
      const cs = getComputedStyle(a[i]);
      const eigen = b[i].getAttribute('style');
      b[i].setAttribute('style', BILD_STILE.map((p) => p + ':' + cs.getPropertyValue(p)).join(';') + (eigen ? ';' + eigen : ''));
      b[i].removeAttribute('class');
    }
  }
  // Bild laden ueber onload: img.decode() scheitert in aelteren WebViews an SVG-Daten-URLs.
  function streckenbildLaden(src) {
    return new Promise((ok, fehler) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fehler(new Error('SVG laesst sich nicht als Bild laden'));
      img.src = src;
    });
  }
  // Schriftgroesse so weit verkleinern, bis der Text in die Breite passt.
  function streckenbildPassend(ctx, text, groesse, minimum, breite, gewicht) {
    let g = groesse;
    for (; g > minimum; g -= 1) {
      ctx.font = (gewicht || 400) + ' ' + g + 'px "Bahnschrift SemiCondensed", "Bahnschrift", "Roboto Condensed", "Arial Narrow", sans-serif';
      if (ctx.measureText(text).width <= breite) break;
    }
    return g;
  }
  function streckenbildText(ctx, text, x, y, groesse, farbe, gewicht, ausrichtung) {
    ctx.font = (gewicht || 400) + ' ' + groesse + 'px "Bahnschrift SemiCondensed", "Bahnschrift", "Roboto Condensed", "Arial Narrow", sans-serif';
    ctx.fillStyle = farbe;
    ctx.textAlign = ausrichtung || 'left';
    ctx.fillText(text, x, y);
  }
  function streckenbildZahl(x, n) {
    return (typeof chZahl === 'function') ? chZahl(x, n) : x.toFixed(n);
  }

  async function streckenbildErzeugen() {
    const tiles = currentTrackTiles;
    if (!tiles || tiles.length < 2) { showHudToast(t('Erst eine Strecke bauen')); return null; }
    const raum = editorSchalter.raum && typeof teileRaum === 'function' ? teileRaum() : { x: 0, y: 0 };
    const r = renderTrackPreview(tiles, null, { detailed: true, echt: true, ohneLinie: !editorSchalter.linie,
      raum: (raum.x > 0 || raum.y > 0) ? raum : null, raumVersatz, cars: [] });
    const halter = document.createElement('div');
    halter.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;pointer-events:none';
    halter.innerHTML = r.html;
    document.body.appendChild(halter);
    try {
      const svg = halter.querySelector('svg');
      if (!svg) return null;
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const vw = vb && vb.width ? vb.width : 1000, vh = vb && vb.height ? vb.height : 700;
      // Die Flaeche fuer die Strecke, und das SVG gleich in DIESER Groesse gerastert (vorher in
      // viewBox-Groesse und dann hochskaliert - unscharf).
      const fx = 60, fy = 140, fw = BILD_W - 120, fh = BILD_H - 140 - 190;
      const s = Math.min(fw / vw, fh / vh);
      const dw = vw * s, dh = vh * s;
      // v1.1.3 GEMELDET: "Bildschirmfoto im Editor funktioniert nicht richtig." Die Fahrbahn ist
      // ein fast schwarzer Strich; im Editor liegt sie auf der Kartenflaeche (.tp-karte, --panel-2),
      // im Bild lag sie direkt auf dem dunklen Verlauf und verschwand. Die Kartenflaeche kommt mit.
      const klon = svg.cloneNode(true);
      streckenbildStileUebertragen(svg, klon);
      klon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      klon.setAttribute('width', String(Math.round(dw)));
      klon.setAttribute('height', String(Math.round(dh)));
      const xml = new XMLSerializer().serializeToString(klon);
      const img = await streckenbildLaden('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml));

      const c = document.createElement('canvas');
      c.width = BILD_W; c.height = BILD_H;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, BILD_H);
      g.addColorStop(0, '#0b0d12'); g.addColorStop(1, '#161a23');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, BILD_W, BILD_H);
      // Kopf: Name links, Marke rechts, darunter eine Linie in Carrera-Blau.
      const name = (($('track-name') || {}).value || '').trim() || t('Eigene Strecke');
      streckenbildText(ctx, name.toUpperCase(), 60, 86, streckenbildPassend(ctx, name.toUpperCase(), 52, 20, BILD_W - 120 - 320, 800), '#f3f4f6', 800);
      streckenbildText(ctx, 'OMEGA SIM', BILD_W - 60, 86, 40, '#00a3e0', 800, 'right');
      ctx.fillStyle = '#00a3e0';
      ctx.fillRect(60, 108, BILD_W - 120, 4);
      // Die Strecke, eingepasst, auf der Kartenflaeche des Editors.
      const kx = fx + (fw - dw) / 2, ky = fy + (fh - dh) / 2;
      // Im Bild etwas heller als im Editor (rgb 20,22,28): sonst hebt sich die fast schwarze Fahrbahn kaum ab.
      const grund = '#2c323d';
      ctx.fillStyle = grund;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(kx, ky, dw, dh, 14); ctx.fill(); }
      else ctx.fillRect(kx, ky, dw, dh);
      ctx.drawImage(img, kx, ky, dw, dh);
      // Fuss: Code, Masse, Link.
      const code = trackToCode(tiles, trackRotationDeg);
      const laenge = trackLaengeM(tiles);
      const flaeche = typeof chFlaeche === 'function' ? chFlaeche(tiles) : null;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(60, BILD_H - 170, BILD_W - 120, 2);
      streckenbildText(ctx, t('Streckencode'), 60, BILD_H - 128, 24, '#a3acbd', 600);
      // Der Code darf nicht unter "Nachbauen und fahren" laufen: so klein, bis er passt.
      streckenbildText(ctx, code, 60, BILD_H - 84, streckenbildPassend(ctx, code, 40, 14, BILD_W - 120 - 360, 800), '#f3f4f6', 800);
      const fakten = t('Länge') + ' ' + streckenbildZahl(laenge, 2) + ' m'
        + (flaeche ? '  ·  ' + t('Platzbedarf') + ' ' + streckenbildZahl(flaeche[0], 2) + ' × ' + streckenbildZahl(flaeche[1], 2) + ' m' : '')
        + '  ·  ' + tiles.length + ' ' + t('Teile');
      streckenbildText(ctx, fakten, 60, BILD_H - 40, streckenbildPassend(ctx, fakten, 28, 14, BILD_W - 120 - 420, 500), '#cfd5e0', 500);
      streckenbildText(ctx, t('Nachbauen und fahren'), BILD_W - 60, BILD_H - 84, 24, '#a3acbd', 600, 'right');
      streckenbildText(ctx, BILD_LINK, BILD_W - 60, BILD_H - 40, 32, '#00a3e0', 700, 'right');
      return { url: c.toDataURL('image/png'), code };
    } finally { halter.remove(); }
  }

  // v1.1.11 GEMELDET: "Bild speichern im Editor klappt auf dem Handy nicht. Bitte ueber einen anderen
  // Weg (ggf. einfach das Bild einblenden, sodass man selbst einen Screenshot macht)." Der Knopf zeigt
  // das Bild jetzt gross an: Screenshot oder lange druecken geht immer; dazu Teilen (wo das Handy es
  // kann), Speichern (der bisherige Weg) und Schliessen (auch Kreis/Escape).
  async function streckenbildSpeichern() {
    let bild = null;
    try { bild = await streckenbildErzeugen(); } catch (e) { showHudToast(t('Bild ging nicht') + ': ' + e.message); return; }
    if (!bild) return;
    streckenbildZeigen(bild);
  }
  function streckenbildOffen() { return !!document.querySelector('.sb-schau'); }
  function streckenbildZu() { const o = document.querySelector('.sb-schau'); if (o) o.remove(); }
  function streckenbildZeigen(bild) {
    streckenbildZu();
    const name = 'OmegaSim-' + bild.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
    const o = document.createElement('div');
    o.className = 'sb-schau';
    o.innerHTML = '<p class="sb-hinweis">' + t('Screenshot machen oder das Bild lange drücken, um es zu speichern.') + '</p>'
      + '<img class="sb-bild" alt="">'
      + '<div class="sb-knoepfe">' + (navigator.share ? '<button type="button" data-sb="teilen">' + t('Teilen') + '</button>' : '')
      + '<button type="button" data-sb="speichern">' + t('Speichern') + '</button>'
      + '<button type="button" class="primary" data-sb="zu">' + t('Schließen') + '</button></div>';
    o.querySelector('img').src = bild.url;
    o.addEventListener('click', (e) => {
      const k = e.target.closest('[data-sb]');
      if (!k) { if (e.target === o) streckenbildZu(); return; }
      if (k.dataset.sb === 'zu') streckenbildZu();
      else if (k.dataset.sb === 'speichern') streckenbildAblegen(bild, name);
      else if (k.dataset.sb === 'teilen') streckenbildTeilen(bild, name);
    });
    document.body.appendChild(o);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && streckenbildOffen()) { e.preventDefault(); e.stopImmediatePropagation(); streckenbildZu(); }
  }, true);
  async function streckenbildTeilen(bild, name) {
    try {
      const blob = await (await fetch(bild.url)).blob();
      const datei = new File([blob], name + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [datei] })) await navigator.share({ files: [datei], title: name });
      else await navigator.share({ title: name, text: t('Streckencode') + ': ' + bild.code });
    } catch (e) {
      if (e && e.name !== 'AbortError') showHudToast(t('Teilen geht hier nicht – bitte einen Screenshot machen'));
    }
  }
  async function streckenbildAblegen(bild, name) {
    const C = window.Capacitor;
    // v1.1.3: in der App ohne Plugin ehrlich melden - ein Daten-URL-Download tut in der WebView
    // nichts, und vorher hiess es trotzdem "Bild gespeichert".
    if (C && C.isNativePlatform && C.isNativePlatform() && !(C.isPluginAvailable && C.isPluginAvailable('OmegaSicherung'))) {
      showHudToast(t('Bild speichern braucht die neue APK'));
      return;
    }
    if (C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable('OmegaSicherung')) {
      try {
        const r = await C.nativePromise('OmegaSicherung', 'bild', { name, base64: bild.url.split(',')[1] });
        showHudToast(t('Bild gespeichert') + ': ' + (r && r.ort ? r.ort : ''));
        log('Streckenbild gespeichert: ' + (r && r.ort), 'ok');
      } catch (e) {
        showHudToast(t('Bild speichern braucht die neue APK'));
        log('Streckenbild: ' + e.message, 'err');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = bild.url;
    a.download = name + '.png';
    a.click();
    showHudToast(t('Bild gespeichert'));
  }
  if ($('track-bild')) $('track-bild').addEventListener('click', streckenbildSpeichern);
