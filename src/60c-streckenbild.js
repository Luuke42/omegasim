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
  const BILD_STILE = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size',
    'font-weight', 'text-anchor', 'dominant-baseline', 'display', 'visibility'];

  function streckenbildStileUebertragen(orig, klon) {
    const a = [orig].concat(Array.from(orig.querySelectorAll('*')));
    const b = [klon].concat(Array.from(klon.querySelectorAll('*')));
    for (let i = 0; i < a.length && i < b.length; i++) {
      const cs = getComputedStyle(a[i]);
      b[i].setAttribute('style', BILD_STILE.map((p) => p + ':' + cs.getPropertyValue(p)).join(';'));
      b[i].removeAttribute('class');
    }
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
      const klon = svg.cloneNode(true);
      streckenbildStileUebertragen(svg, klon);
      klon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      klon.setAttribute('width', String(Math.round(vw)));
      klon.setAttribute('height', String(Math.round(vh)));
      const xml = new XMLSerializer().serializeToString(klon);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();

      const c = document.createElement('canvas');
      c.width = BILD_W; c.height = BILD_H;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, BILD_H);
      g.addColorStop(0, '#0b0d12'); g.addColorStop(1, '#161a23');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, BILD_W, BILD_H);
      // Kopf: Name links, Marke rechts, darunter eine Linie in Carrera-Blau.
      const name = (($('track-name') || {}).value || '').trim() || t('Eigene Strecke');
      streckenbildText(ctx, name.toUpperCase(), 60, 86, 52, '#f3f4f6', 800);
      streckenbildText(ctx, 'OMEGA SIM', BILD_W - 60, 86, 40, '#00a3e0', 800, 'right');
      ctx.fillStyle = '#00a3e0';
      ctx.fillRect(60, 108, BILD_W - 120, 4);
      // Die Strecke, eingepasst.
      const fx = 60, fy = 140, fw = BILD_W - 120, fh = BILD_H - 140 - 190;
      const s = Math.min(fw / vw, fh / vh);
      const dw = vw * s, dh = vh * s;
      ctx.drawImage(img, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
      // Fuss: Code, Masse, Link.
      const code = trackToCode(tiles, trackRotationDeg);
      const laenge = trackLaengeM(tiles);
      const flaeche = typeof chFlaeche === 'function' ? chFlaeche(tiles) : null;
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(60, BILD_H - 170, BILD_W - 120, 2);
      streckenbildText(ctx, t('Streckencode'), 60, BILD_H - 128, 24, '#a3acbd', 600);
      streckenbildText(ctx, code, 60, BILD_H - 84, code.length > 40 ? 30 : 40, '#f3f4f6', 800);
      const fakten = t('Länge') + ' ' + streckenbildZahl(laenge, 2) + ' m'
        + (flaeche ? '  ·  ' + t('Platzbedarf') + ' ' + streckenbildZahl(flaeche[0], 2) + ' × ' + streckenbildZahl(flaeche[1], 2) + ' m' : '')
        + '  ·  ' + tiles.length + ' ' + t('Teile');
      streckenbildText(ctx, fakten, 60, BILD_H - 40, 28, '#cfd5e0', 500);
      streckenbildText(ctx, t('Nachbauen und fahren'), BILD_W - 60, BILD_H - 84, 24, '#a3acbd', 600, 'right');
      streckenbildText(ctx, BILD_LINK, BILD_W - 60, BILD_H - 40, 32, '#00a3e0', 700, 'right');
      return { url: c.toDataURL('image/png'), code };
    } finally { halter.remove(); }
  }

  async function streckenbildSpeichern() {
    let bild = null;
    try { bild = await streckenbildErzeugen(); } catch (e) { showHudToast(t('Bild ging nicht') + ': ' + e.message); return; }
    if (!bild) return;
    const name = 'OmegaSim-' + bild.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
    const C = window.Capacitor;
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
