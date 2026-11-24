  // ==================================================================================================
  // MARKER-AR (v1.6.67, WIP, Prototyp) - AR ohne ARCore
  // ==================================================================================================
  // BESTELLT: "Meine Android-Version ist nicht kompatibel mit AR. Kannst du es fuer die .apk mit sceneview oder einer
  // anderen Open-Source-Software bauen?" (Samsung Galaxy A16/A41: kein ARCore - SceneView baut auf ARCore und faellt
  // damit aus.) Statt der Bodenerkennung von ARCore erkennt die App einen ausgedruckten ArUco-Marker im Kamerabild
  // (js-aruco2, lib/js-aruco2, MIT/BSD/LGPL-3, siehe LICENSE.txt dort) und berechnet daraus je Bild Lage und Neigung der
  // Kamera (POSIT). Die Strecke liegt mittig auf dem Marker; man kann um sie herumgehen, solange der Marker im Bild ist.
  // Laeuft in der App (Android-WebView, getUserMedia wie die Onboard-Kamera) und im Browser, ohne neue APK.
  //
  // Aufbau: <video> mit der Rueckkamera als Hintergrund der Schicht, darueber die durchsichtige Leinwand der virtuellen
  // Fahrt. Je Bild: Ausschnitt des Videos verkleinert (VF_MK.erkennBreite) erkennen, Pose glaetten, Projektion aus
  // dem Bildwinkel der Kamera (VF_MK.bildwinkel) passend zum angezeigten Ausschnitt (object-fit: cover), Szene zeichnen
  // (vfSzeneMalen). Marker: ar-marker-a4.svg (ARUCO_MIP_36h12 Nummer 0, schwarzes Quadrat 160 mm).
  // v1.6.71 GEMELDET: "Es funktioniert nicht. Ganz selten ploppt die Strecke als weisse Textur auf, aber ohne Auto. Sie
  // reagiert dann zu langsam, zu zuckend, und meistens wird der Marker nicht erkannt." Geaendert:
  //   - Erkennung in einem Web Worker (vfMkWorker) mit 720 statt 480 Pixeln Breite - das Bild wartet nicht mehr darauf;
  //   - das Kamerabild ist eine Textur im 3D-Bild (vfMkHintergrund), die Leinwand undurchsichtig - vorher war sie
  //     durchsichtig, und jede Flaeche mit Alpha unter 1 wurde ueber dem Video weisslich;
  //   - der Marker ist Start/Ziel (vorher die Mitte der Strecke - das Auto stand oft ausserhalb des Bildes);
  //   - von den zwei Loesungen der Lage (Kippmehrdeutigkeit bei ebenen Markern) die, die zur vorigen passt; Glaettung
  //     je nach Bewegung (ruhig: stark, schnell: schwach), Aussetzer bis 1,5 s ueberbrueckt.
  // v1.6.73 GEMELDET: "Die Strecke poppt immer noch nur ganz selten auf und ist dann eine weisse Textur. Ich sehe kein
  // Auto." Verdacht: Falscherkennungen - die Bibliothek nimmt beim Woerterbuch ARUCO_MIP_36h12 bis zu 11 falsche von 36
  // Bits hin, zufaellige Kanten im Bild galten dann als Marker 0 mit unsinniger Lage (Kamera mitten in der Strecke: weisse
  // Randsteine und Linien ganz nah, kein Auto). Jetzt hoechstens 2 falsche Bits (hamming), unplausible Lagen verworfen
  // (Marker hinter der Kamera, von hinten/kantig, naeher als 5 cm oder weiter als 8 m), Erkennung abwechselnd mit 640
  // und 400 Pixeln Breite (breiten), und eine Diagnosezeile im Bild mit gruenen Punkten an den erkannten Ecken.
  // v1.6.75 GEMELDET: "Die Strecke sieht jetzt gut aus, sie zittert aber immer noch, obwohl ich die Kamera ganz ruhig
  // halte" (1280x720, erkannt 532/1000, 130 cm). Bei 130 cm ist der Marker nur ~10 % der Bildbreite; die Ecken der
  // Bibliothek sind ganze Pixel aus einer Umrissnaeherung, und die Wechselbreiten 640/400 lieferten abwechselnd leicht
  // andere Ecken. Jetzt: eine feste Breite (960), Subpixel-Ecken (vfMkVerfeinern: Kanten im Graubild vermessen, Geraden
  // anpassen, schneiden) und ein One-Euro-Filter auf den acht Eckwerten (vfMkEinEuro: still = stark geglaettet, Bewegung
  // = folgt sofort) - beides im Worker, vor POSIT.
  const VF_MK = { id: 0, mm: 160, bildwinkel: 63, breiten: [960], hamming: 3, verlorenMs: 1500 };
  // Subpixel-Ecken: je Kante 15 Proben, je Probe die staerkste Helligkeitskante quer zur Kante (+-4 px, Parabel), Gerade
  // durch die Proben (Hauptachse), Ecke = Schnitt der Nachbarkanten. Faellt eine Ecke mehr als 3 px vom Original weg,
  // bleibt das Original. g: Graubild { width, height, data }, cs: [{x, y}] x4 im Uhrzeigersinn.
  function vfMkVerfeinern(g, cs) {
    var W = g.width, H = g.height, D = g.data;
    function I(x, y) {
      if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return -1;
      var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = y0 * W + x0;
      return (D[o] * (1 - fx) + D[o + 1] * fx) * (1 - fy) + (D[o + W] * (1 - fx) + D[o + W + 1] * fx) * fy;
    }
    var linien = [];
    for (var i = 0; i < 4; i++) {
      var a = cs[i], b = cs[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy);
      if (L < 10) return cs;
      var nx = -dy / L, ny = dx / L, pts = [];
      for (var k = 1; k < 16; k++) {
        var tt = 0.1 + 0.8 * k / 16, px = a.x + dx * tt, py = a.y + dy * tt, gr = [], ok = true;
        for (var o = -5; o <= 5; o++) {
          var v1 = I(px + nx * (o + 0.5), py + ny * (o + 0.5)), v0 = I(px + nx * (o - 0.5), py + ny * (o - 0.5));
          if (v1 < 0 || v0 < 0) { ok = false; break; }
          gr.push(Math.abs(v1 - v0));
        }
        if (!ok) continue;
        var bi = 1;
        for (var j = 1; j < gr.length - 1; j++) if (gr[j] > gr[bi]) bi = j;
        if (gr[bi] < 12) continue;
        var den = gr[bi - 1] - 2 * gr[bi] + gr[bi + 1], off = den !== 0 ? 0.5 * (gr[bi - 1] - gr[bi + 1]) / den : 0;
        var s = (bi - 5) + Math.max(-0.5, Math.min(0.5, off));
        pts.push([px + nx * s, py + ny * s]);
      }
      if (pts.length < 6) return cs;
      var mx = 0, my = 0;
      for (var q = 0; q < pts.length; q++) { mx += pts[q][0]; my += pts[q][1]; }
      mx /= pts.length; my /= pts.length;
      var sxx = 0, sxy = 0, syy = 0;
      for (q = 0; q < pts.length; q++) { var ux = pts[q][0] - mx, uy = pts[q][1] - my; sxx += ux * ux; sxy += ux * uy; syy += uy * uy; }
      var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      linien.push({ x: mx, y: my, dx: Math.cos(th), dy: Math.sin(th) });
    }
    var neu = [];
    for (i = 0; i < 4; i++) {
      var l1 = linien[(i + 3) % 4], l2 = linien[i];
      var det = l1.dx * (-l2.dy) - l1.dy * (-l2.dx);
      if (Math.abs(det) < 1e-6) return cs;
      var rx = l2.x - l1.x, ry = l2.y - l1.y, t1 = (rx * (-l2.dy) - ry * (-l2.dx)) / det;
      var p = { x: l1.x + l1.dx * t1, y: l1.y + l1.dy * t1 };
      if (Math.abs(p.x - cs[i].x) > 3 || Math.abs(p.y - cs[i].y) > 3) return cs;
      neu.push(p);
    }
    return neu;
  }
  // One-Euro-Filter (Casiez et al. 2012): Grenzfrequenz = min + beta * |Geschwindigkeit|. Zustand f (Objekt), t in ms,
  // p = { min, beta, dc }. Nach einer Pause (> 500 ms) beginnt er neu.
  function vfMkEuro1(f, werte, t, p) {
    if (!f.x || t - f.t > 500) { f.x = werte.slice(); f.dx = werte.map(function () { return 0; }); f.t = t; return werte.slice(); }
    var dt = Math.max(0.001, (t - f.t) / 1000);
    f.t = t;
    var al = function (fc) { var tau = 1 / (2 * Math.PI * fc); return 1 / (1 + tau / dt); };
    var raus = [];
    for (var i = 0; i < werte.length; i++) {
      var d = (werte[i] - f.x[i]) / dt;
      f.dx[i] = f.dx[i] + al(p.dc) * (d - f.dx[i]);
      var fc = p.min + p.beta * Math.abs(f.dx[i]);
      f.x[i] = f.x[i] + al(fc) * (werte[i] - f.x[i]);
      raus.push(f.x[i]);
    }
    return raus;
  }
  // Die acht Eckwerte [x0, y0, ... x3, y3] getrennt gefiltert:
  // v1.6.81 GEMELDET: "Strecke ist stabil, reagiert aber zu spaet (~30ms) nach Bewegung und zuckt dann". Bisher ein
  // Filter je Eckwert mit 1-Hz-Geschwindigkeit: er oeffnete erst ~150 ms nach Bewegungsbeginn und holte dann ruckartig
  // auf. Jetzt: die MITTE des Markers (Verschiebung im Bild = Kamerabewegung) mit einem schnellen Filter (dc 4 Hz, beta
  // 0,1) - sie folgt sofort; die FORM (Ecken relativ zur Mitte: daraus kommen Abstand und Neigung, die am staerksten
  // rauschen) mit dem bisherigen ruhigen Filter. So bleibt die Strecke still ruhig und klebt bei Bewegung am Bild.
  // Werte, die nicht acht sind, laufen durch den ruhigen Filter.
  function vfMkEinEuro(f, werte, t) {
    var RUHIG = { min: 0.8, beta: 0.04, dc: 1.0 }, SCHNELL = { min: 0.8, beta: 0.1, dc: 4.0 };
    if (werte.length !== 8) return vfMkEuro1(f, werte, t, RUHIG);
    var cx = (werte[0] + werte[2] + werte[4] + werte[6]) / 4, cy = (werte[1] + werte[3] + werte[5] + werte[7]) / 4;
    var form = werte.map(function (w, i) { return w - (i % 2 ? cy : cx); });
    var m = vfMkEuro1(f.mitte || (f.mitte = {}), [cx, cy], t, SCHNELL);
    var fo = vfMkEuro1(f.form || (f.form = {}), form, t, RUHIG);
    return fo.map(function (w, i) { return w + m[i % 2]; });
  }
  const VF_MK_MASSSTAB_STORE = 'omegasim-vf-ar-massstab';
  const VF_MK_MASSSTAEBE = [1, 0.5, 0.25];
  function vfMkMassstab() { try { const v = +localStorage.getItem(VF_MK_MASSSTAB_STORE); return VF_MK_MASSSTAEBE.indexOf(v) >= 0 ? v : 0.5; } catch (e) { return 0.5; } }
  let vfMkLibs = null;
  function vfMkLibsLaden() {
    if (vfMkLibs) return vfMkLibs;
    const lade = (f) => new Promise((ok, nein) => {
      const s = document.createElement('script');
      s.src = 'lib/js-aruco2/' + f; s.async = false;
      s.onload = ok; s.onerror = () => nein(new Error(f + ' nicht geladen'));
      document.head.appendChild(s);
    });
    vfMkLibs = lade('cv.js').then(() => lade('aruco.js')).then(() => lade('svd.js')).then(() => lade('posit1.js')).then(() => {
      if (!(window.AR && window.AR.Detector && window.POS && window.POS.Posit)) throw new Error('js-aruco2 unvollstaendig');
    });
    vfMkLibs.catch(() => { vfMkLibs = null; });
    return vfMkLibs;
  }

  let vfMkLaeuft = false;
  async function vfMarkerStarten() {
    if (VF.aktiv || vfMkLaeuft) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      vfArMeldung(t('AR konnte nicht starten'), t('Dieses Gerät gibt kein Kamerabild an die Seite.'));
      return;
    }
    vfMkLaeuft = true;
    vfArKnopf(t('AR startet …'));
    let stream = null;
    try {
      await vfMkLibsLaden();
      stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      vfMkLaeuft = false; vfArKnopf('');
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      vfArMeldung(t('AR konnte nicht starten'), ((e && e.name) ? e.name + ': ' : '') + ((e && e.message) || String(e)) + '\n\n'
        + t('Die Kamera muss für OmegaSim erlaubt sein (Android-Einstellungen > Apps > OmegaSim bzw. Chrome > Berechtigungen > Kamera).'));
      return;
    }
    const video = document.createElement('video');
    video.className = 'vf-mk-video';
    video.playsInline = true; video.muted = true; video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    const mk = { video, stream, det: null, posit: null, cnv: document.createElement('canvas'),
                 pose: null, zuletzt: 0, gesehen: 0, bilder: 0, worker: null, wartet: false, n: 0 };
    vfMkWorkerStarten(mk);
    mk.ctx = mk.cnv.getContext('2d', { willReadFrequently: true });
    let ok = false;
    try { ok = virtuellStarten({ marker: mk }); } catch (e) { log('Marker-AR: ' + e.message, 'warn'); }
    vfArKnopf('');
    vfMkLaeuft = false;
    if (!ok) { stream.getTracks().forEach((tr) => tr.stop()); return; }
    if (VF.schicht) VF.schicht.insertBefore(video, VF.schicht.firstChild);
    video.play().catch(() => { /* autoplay: muted, sollte gehen */ });
    vfMkOberflaeche();
  }
  // Hinweis, Massstab und "Marker drucken" in der Schicht.
  function vfMkOberflaeche() {
    const sch = VF.schicht;
    if (!sch || !VF.marker) return;
    let h = sch.querySelector('.vf-ar-hinweis');
    if (!h) { h = document.createElement('div'); h.className = 'vf-ar-hinweis'; sch.appendChild(h); }
    h.textContent = t('Kamera auf den ausgedruckten Marker richten (ar-marker-a4.svg, in Originalgröße drucken). Der Marker ist Start/Ziel, die Strecke geht nach oben auf dem Blatt los.');
    let leiste = sch.querySelector('.vf-mk-leiste');
    if (!leiste) {
      leiste = document.createElement('div'); leiste.className = 'vf-mk-leiste';
      const ms = document.createElement('button'); ms.type = 'button'; ms.className = 'vf-mk-massstab';
      const msText = () => { ms.textContent = t('Maßstab') + ' 1:' + Math.round(1 / vfMkMassstab()); };
      ms.onclick = (e) => {
        e.stopPropagation();
        const i = VF_MK_MASSSTAEBE.indexOf(vfMkMassstab());
        try { localStorage.setItem(VF_MK_MASSSTAB_STORE, String(VF_MK_MASSSTAEBE[(i + 1) % VF_MK_MASSSTAEBE.length])); } catch (err) { /* egal */ }
        msText();
      };
      msText();
      const dr = document.createElement('a'); dr.className = 'vf-mk-drucken'; dr.href = 'ar-marker-a4.svg'; dr.target = '_blank'; dr.rel = 'noopener';
      dr.textContent = t('Marker drucken');
      leiste.appendChild(ms); leiste.appendChild(dr);
      sch.appendChild(leiste);
    }
  }
  function vfMkAufraeumen(mk) {
    if (!mk) return;
    try { if (mk.worker) mk.worker.terminate(); } catch (e) { /* egal */ }
    try { mk.stream.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* egal */ }
    try { mk.video.remove(); } catch (e) { /* egal */ }
  }

  // Projektion fuer den angezeigten Ausschnitt des Videos (object-fit: cover) und die Brennweite in Pixeln des Videos.
  function vfMkProjektion(mk, W, H, nah, fern) {
    const vw = mk.video.videoWidth || 1280, vh = mk.video.videoHeight || 720;
    const fV = (vw / 2) / Math.tan(VF_MK.bildwinkel * Math.PI / 360);
    const s = Math.max(W / vw, H / vh), f = fV * s;
    return [2 * f / W, 0, 0, 0, 0, 2 * f / H, 0, 0, 0, 0, (fern + nah) / (nah - fern), -1, 0, 0, 2 * fern * nah / (nah - fern), 0];
  }
  // Erkennung im Web Worker: die Bibliothek per importScripts, je Auftrag ein Bild (RGBA, uebertragen, nicht kopiert),
  // Antwort beide Loesungen der Lage. Ohne Worker (alte WebView) im Hauptthread wie in 1.6.68.
  function vfMkWorkerStarten(mk) {
    try {
      const u = (f) => new URL('lib/js-aruco2/' + f, location.href).href;
      const code = 'importScripts(' + ['cv.js', 'aruco.js', 'svd.js', 'posit1.js'].map((f) => JSON.stringify(u(f))).join(',') + ');\n'
        + 'var det = new AR.Detector({ dictionaryName: "ARUCO_MIP_36h12", maxHammingDistance: ' + VF_MK.hamming + ' }), pos = null, pf = 0, filt = {};\n'
        + 'var vfMkVerfeinern = ' + vfMkVerfeinern.toString() + ';\nvar vfMkEuro1 = ' + vfMkEuro1.toString() + ';\nvar vfMkEinEuro = ' + vfMkEinEuro.toString() + ';\n'
        + 'onmessage = function (e) { var d = e.data, r = { n: d.n, ok: false, buf: d.buf, w: d.w, h: d.h }, t0 = Date.now();\n'
        + '  try { if (!pos || pf !== d.f) { pos = new POS.Posit(d.mm, d.f); pf = d.f; }\n'
        + '    var ms = det.detect({ width: d.w, height: d.h, data: new Uint8ClampedArray(d.buf) }) || [], m = null;\n'
        + '    for (var i = 0; i < ms.length; i++) if (ms[i].id === d.id) m = ms[i];\n'
        + '    r.kand = ms.length; r.ms = Date.now() - t0;\n'
        + '    if (m) { var cs = vfMkVerfeinern(det.grey, m.corners); r.fein = cs !== m.corners;\n'
        + '      var w8 = vfMkEinEuro(filt, [cs[0].x, cs[0].y, cs[1].x, cs[1].y, cs[2].x, cs[2].y, cs[3].x, cs[3].y], d.t);\n'
        + '      cs = [{ x: w8[0], y: w8[1] }, { x: w8[2], y: w8[3] }, { x: w8[4], y: w8[5] }, { x: w8[6], y: w8[7] }];\n'
        + '      r.ecken = cs.map(function (c) { return [c.x / d.w, c.y / d.h]; }); var ec = cs.map(function (c) { return { x: c.x - d.w / 2, y: d.h / 2 - c.y }; }); var p = pos.pose(ec);\n'
        + '      r.ok = true; r.r1 = p.bestRotation; r.t1 = p.bestTranslation; r.e1 = p.bestError; r.r2 = p.alternativeRotation; r.t2 = p.alternativeTranslation; r.e2 = p.alternativeError; }\n'
        + '  } catch (err) { r.fehler = String(err); }\n'
        + '  postMessage(r, [r.buf]); };\n';
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      w.onmessage = (e) => { mk.wartet = false; vfMkHgUmschalten(mk); vfMkAntwort(mk, e.data); };
      w.onerror = (e) => { log('Marker-AR: Worker ' + (e.message || 'Fehler') + ' - Erkennung im Hauptthread', 'warn'); try { w.terminate(); } catch (err) { /* egal */ } mk.worker = null; mk.wartet = false; };
      mk.worker = w;
    } catch (e) { mk.worker = null; }
  }
  // POSIT -> GL (Kamera <- Marker, mm): POSIT x rechts, y oben, z nach vorn; GL z zum Betrachter -> F = diag(1, 1, -1) links.
  // v1.6.73: die dritte Achse aus dem Kreuzprodukt. POSIT liefert sie mit wechselndem Vorzeichen (mal Drehung, mal
  // Spiegelung, Determinante -1) - gespiegelt war die Welt "von innen" gezeichnet: Auto kaum sichtbar (Rueckseiten
  // weggeschnitten), Licht verkehrt (zu hell), und der Wechsel zwischen beiden liess die Strecke zittern.
  function vfMkGl(R, T) {
    const x = [R[0][0], R[1][0], -R[2][0]], y = [R[0][1], R[1][1], -R[2][1]];
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, T[0], T[1], -T[2], 1];
  }
  // v1.6.77 GEMELDET: "Ab und zu glitcht sie auch noch in die andere Richtung wie ein Neckarwuerfel/Kippbild." Ein ebener
  // Marker hat aus vier Ecken zwei fast gleich gute Neigungen (gespiegelt um die Blickrichtung); die Bibliothek nimmt die
  // mit dem kleineren Fehler, und im Rauschen wechselte das - vor allem nach einem Aussetzer, wenn es keine vorige Lage
  // zum Vergleich gab. Jetzt hat jede plausible Loesung eine Wertung:
  //   + Normale des Papiers zeigt im Bild nach oben (der Marker liegt am Boden, die Kamera ist darueber),
  //   + passt zur zuletzt gewaehlten Normalen (auch ueber Aussetzer hinweg: der Marker liegt fest),
  //   - groesserer Rueckprojektionsfehler (Pixel),
  // und ein Wechsel gegen die bisherige Wahl braucht einen Vorsprung (Hysterese).
  function vfMkWaehlen(mk, r, jetzt) {
    // Plausibel? Vor der Kamera (GL z negativ), 5 cm bis 8 m, Papier zur Kamera gewandt (Normale mit +z-Anteil).
    const plausibel = (Q) => Q[14] < -50 && Q[14] > -8000 && Q[10] > 0.08;
    const kand = [];
    const M1 = vfMkGl(r.r1, r.t1);
    if (plausibel(M1)) kand.push({ M: M1, e: isFinite(r.e1) && r.e1 >= 0 ? r.e1 : 0 });
    if (r.r2 && r.t2 && isFinite(r.e2) && r.e2 >= 0) { const M2 = vfMkGl(r.r2, r.t2); if (plausibel(M2)) kand.push({ M: M2, e: r.e2 }); }
    if (!kand.length) return null;
    if (kand.length === 1) { mk.wahlN = [kand[0].M[8], kand[0].M[9], kand[0].M[10]]; return kand[0].M; }
    const eMin = Math.min(kand[0].e, kand[1].e);
    const N = mk.wahlN;
    const wert = (k) => {
      let w = 1.2 * k.M[9];                                      // Normale nach oben im Bild
      if (N) w += 1.0 * (k.M[8] * N[0] + k.M[9] * N[1] + k.M[10] * N[2]);   // wie zuletzt (schwaecher als oben: kommt aus falscher Wahl heraus)
      w -= 0.25 * Math.max(0, k.e - eMin);                       // Fehler in Pixeln
      return w;
    };
    const w0 = wert(kand[0]), w1 = wert(kand[1]);
    let b = w1 > w0 ? 1 : 0;
    // Hysterese: gegen die bisherige Wahl nur mit 0,3 Vorsprung wechseln.
    if (N) {
      const nah = (k) => k.M[8] * N[0] + k.M[9] * N[1] + k.M[10] * N[2];
      const bisher = nah(kand[0]) >= nah(kand[1]) ? 0 : 1;
      if (b !== bisher && Math.abs(w1 - w0) < 0.3) b = bisher;
    }
    const M = kand[b].M;
    mk.wahlN = [M[8], M[9], M[10]];
    return M;
  }
  function vfMkAntwort(mk, r) {
    const S = mk.stat || (mk.stat = { gesendet: 0, erkannt: 0, verworfen: 0, ms: 0, dist: 0, w: 0, h: 0, kand: 0 });
    if (r) { if (r.ms !== undefined) S.ms = r.ms; if (r.w) { S.w = r.w; S.h = r.h; } if (r.kand !== undefined) S.kand = r.kand; if (r.ok) { S.fein = (S.fein || 0) + (r.fein ? 1 : 0); } }
    if (!r || !r.ok || !r.r1 || !r.t1) { if (r && r.fehler && !mk.fehler) { mk.fehler = r.fehler; log('Marker-AR: ' + r.fehler, 'warn'); } return; }
    const jetzt = performance.now();
    const M = vfMkWaehlen(mk, r, jetzt);
    if (!M) { S.verworfen++; return; }
    S.erkannt++; S.dist = Math.round(-M[14]);
    mk.ecken = r.ecken || null; mk.eckenAt = jetzt;
    const vor = mk.pose && jetzt - mk.zuletzt < VF_MK.verlorenMs ? mk.pose : null;
    // Glaettung je nach Bewegung: kleine Aenderung stark glaetten (Zittern), grosse fast sofort uebernehmen.
    if (vor) {
      const dt = Math.hypot(M[12] - vor[12], M[13] - vor[13], M[14] - vor[14]);
      const dr = 1 - (M[8] * vor[8] + M[9] * vor[9] + M[10] * vor[10]);
      // v1.6.75: die Ecken sind schon gefiltert (One-Euro im Worker) - hier nur noch leicht, damit es nicht nachzieht.
      // Neigung getrennt und langsamer: sie haengt an der Verkuerzung des kleinen Markers und rauscht am staerksten.
      // Still (kleine Aenderung) nur 15 % je Erkennung, bei Bewegung (Weg oder Drehung) schnell bis ganz.
      const bew = Math.min(1, dt / 80 + dr * 40);   // Abstandsrauschen (~1 cm bei 1,3 m) zaehlt nicht als Bewegung
      // v1.6.81: schneller (vorher aT ab 0,5, aR ab 0,15 mit bew einfach): sonst zieht die Strecke bei Bewegung nach.
      const aT = Math.max(0.5, Math.min(1, 0.5 + bew)), aR = Math.max(0.15, Math.min(1, 0.15 + bew));
      for (let i = 0; i < 16; i++) mk.pose[i] += (M[i] - mk.pose[i]) * (i === 12 || i === 13 ? aT : aR);   // Abstand (14) ruhig wie die Neigung
      vfMkOrtho(mk.pose);
    } else mk.pose = M;
    mk.zuletzt = jetzt;
    mk.gesehen++;
  }
  // Je Bild: hat der Worker frei, das aktuelle Videobild verkleinert hinschicken (ohne Worker: hier erkennen).
  function vfMkErkennen(mk) {
    const v = mk.video;
    if (!(v.readyState >= 2 && v.videoWidth)) return;
    mk.stufe = ((mk.stufe || 0) + 1) % VF_MK.breiten.length;
    const dw = Math.min(VF_MK.breiten[mk.stufe], v.videoWidth), dh = Math.round(dw * v.videoHeight / v.videoWidth);
    const f = (dw / 2) / Math.tan(VF_MK.bildwinkel * Math.PI / 360);
    if (mk.worker) {
      // Haengt der Worker (> 1 s ohne Antwort), weiter ohne ihn zu blockieren.
      if (mk.wartet && performance.now() - (mk.gesendetAt || 0) < 1000) return;
      if (mk.cnv.width !== dw || mk.cnv.height !== dh) { mk.cnv.width = dw; mk.cnv.height = dh; }
      // v1.6.81 GEMELDET: "Strecke ist stabil, reagiert aber zu spaet (~30ms) nach Bewegung und zuckt dann". Die Lage
      // kommt aus einem Bild, das 1-2 Bilder alt ist, das Kamerabild dahinter war aber das neueste - die Strecke lief
      // dem Bild hinterher. Jetzt wird genau das Bild, das zur Erkennung geht, in eine zweite Textur geladen und erst
      // mit der Antwort gezeigt: Kamerabild und Strecke gehoeren immer zum selben Moment.
      try { vfMkHgLaden(VF.gl, mk, 1 - (mk.hgZeig || 0)); mk.hgWartend = 1 - (mk.hgZeig || 0); } catch (e) { mk.hgWartend = undefined; }
      mk.gesendetAt = performance.now();
      const S = mk.stat || (mk.stat = { gesendet: 0, erkannt: 0, verworfen: 0, ms: 0, dist: 0, w: 0, h: 0, kand: 0 });
      S.gesendet++;
      mk.ctx.drawImage(v, 0, 0, dw, dh);
      const bild = mk.ctx.getImageData(0, 0, dw, dh);
      mk.wartet = true; mk.bilder++;
      mk.worker.postMessage({ n: ++mk.n, t: performance.now(), w: dw, h: dh, f, mm: VF_MK.mm, id: VF_MK.id, buf: bild.data.buffer }, [bild.data.buffer]);
      return;
    }
    // Rueckfall ohne Worker
    if (!mk.det) mk.det = new window.AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12', maxHammingDistance: VF_MK.hamming });
    if (mk.cnv.width !== dw || mk.cnv.height !== dh) { mk.cnv.width = dw; mk.cnv.height = dh; mk.posit = null; }
    if (!mk.posit) mk.posit = new window.POS.Posit(VF_MK.mm, f);
    mk.ctx.drawImage(v, 0, 0, dw, dh);
    const liste = mk.det.detect(mk.ctx.getImageData(0, 0, dw, dh)) || [];
    mk.bilder++;
    const m = liste.find((x) => x.id === VF_MK.id);
    if (!m) return;
    let cs = vfMkVerfeinern(mk.det.grey, m.corners);
    const w8 = vfMkEinEuro(mk.filt || (mk.filt = {}), [cs[0].x, cs[0].y, cs[1].x, cs[1].y, cs[2].x, cs[2].y, cs[3].x, cs[3].y], performance.now());
    cs = [0, 1, 2, 3].map((i) => ({ x: w8[2 * i], y: w8[2 * i + 1] }));
    const p = mk.posit.pose(cs.map((c) => ({ x: c.x - dw / 2, y: dh / 2 - c.y })));
    vfMkAntwort(mk, { ok: true, w: dw, h: dh, ecken: cs.map((c) => [c.x / dw, c.y / dh]), r1: p.bestRotation, t1: p.bestTranslation, e1: p.bestError, r2: p.alternativeRotation, t2: p.alternativeTranslation, e2: p.alternativeError });
  }
  // Drehteil wieder orthonormal machen (Gram-Schmidt auf den Spalten).
  function vfMkOrtho(M) {
    const n = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const x = n([M[0], M[1], M[2]]);
    let y = [M[4], M[5], M[6]];
    const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    y = n([y[0] - d * x[0], y[1] - d * x[1], y[2] - d * x[2]]);
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    M[0] = x[0]; M[1] = x[1]; M[2] = x[2]; M[4] = y[0]; M[5] = y[1]; M[6] = y[2]; M[8] = z[0]; M[9] = z[1]; M[10] = z[2];
  }
  // Welt der Fahrt -> Marker (mm): Marker-x = Welt-x, Marker-z (aus dem Papier, nach oben) = Welt-Hoehe, Marker-y = -Welt-z;
  // Massstab: Einheiten -> mm (echte Carrera-Groesse) mal Massstab. v1.6.71: der Startpunkt liegt auf dem Marker, die
  // Fahrtrichtung am Start zeigt zur Oberkante des Blatts (Ry(h) dreht die Startrichtung auf Welt -z = Blatt-oben).
  function vfMkWelt() {
    const sx = VF.startX !== undefined ? VF.startX : (VF.pts && VF.pts[0] ? VF.pts[0].x : 0);
    const sy = VF.startY !== undefined ? VF.startY : (VF.pts && VF.pts[0] ? VF.pts[0].y : 0);
    const sh = (VF.startH || 0) * Math.PI / 180;
    const s = 10 / TRACK_UNITS_PER_CM * vfMkMassstab();
    const A = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    return vfKette(A, vfS(s, s, s), vfRy(sh), vfT(-sx, 0, -sy));
  }
  // v1.6.81: zwei Texturen fuer das Kamerabild - eine wird gezeigt (mk.hgZeig), in die andere kommt das Bild, das
  // gerade erkannt wird. Ohne Worker (oder bis zur ersten Antwort) wird das neueste Bild gezeigt.
  function vfMkHgUmschalten(mk) {
    if (mk.hgWartend === undefined) return;
    mk.hgZeig = mk.hgWartend; mk.hgWartend = undefined; mk.hgSync = true;
  }
  function vfMkHgLaden(gl, mk, i) {
    const v = mk.video;
    if (!(v.readyState >= 2 && v.videoWidth)) return;
    vfMkHgInit(gl, mk);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mk.hg.tx[i]);
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), pre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v); } catch (e) { /* Bild noch nicht bereit */ }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, pre);
  }
  // Das Kamerabild als Hintergrund (Textur, Ausschnitt wie object-fit: cover), ohne Tiefe.
  function vfMkHgInit(gl, mk) {
    if (!mk.hg) {
      const vs = 'attribute vec2 p; uniform vec4 c; varying vec2 uv; void main() { vec2 t = p * 0.5 + 0.5; uv = vec2(c.x + t.x * (c.z - c.x), c.w - t.y * (c.w - c.y)); gl_Position = vec4(p, 0.0, 1.0); }';
      const fs = 'precision mediump float; uniform sampler2D tx; varying vec2 uv; void main() { gl_FragColor = vec4(texture2D(tx, uv).rgb, 1.0); }';
      const sh = (typ, q) => { const o = gl.createShader(typ); gl.shaderSource(o, q); gl.compileShader(o); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      const neu = () => {
        const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tx;
      };
      mk.hg = { pr, b, tx: [neu(), neu()], ap: gl.getAttribLocation(pr, 'p'), c: gl.getUniformLocation(pr, 'c'), t: gl.getUniformLocation(pr, 'tx') };
    }
  }
  function vfMkHintergrund(gl, mk, W, H) {
    const v = mk.video;
    if (!(v.readyState >= 2 && v.videoWidth)) return;
    vfMkHgInit(gl, mk);
    const g = mk.hg;
    // Ohne Worker oder vor der ersten Antwort: das neueste Bild.
    if (!mk.worker || !mk.hgSync) vfMkHgLaden(gl, mk, mk.hgZeig || 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.tx[mk.hgZeig || 0]);
    const vw = v.videoWidth, vh = v.videoHeight, sc = Math.max(W / vw, H / vh);
    const du = (1 - (W / sc) / vw) / 2, dv = (1 - (H / sc) / vh) / 2;
    gl.useProgram(g.pr);
    gl.uniform4f(g.c, du, dv, 1 - du, 1 - dv);
    gl.uniform1i(g.t, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.b);
    gl.enableVertexAttribArray(g.ap);
    gl.vertexAttribPointer(g.ap, 2, gl.FLOAT, false, 8, 0);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.disableVertexAttribArray(g.ap);
  }
  // Ein Bild: durchsichtig loeschen, Marker suchen, Szene von der Kamera aus zeichnen.
  function vfMkMalen() {
    const gl = VF.gl, cv = VF.cv, mk = VF.marker;
    const dpr = Math.min(navigator.maxTouchPoints > 0 ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const jetzt = performance.now();
    try { vfMkErkennen(mk); } catch (e) { if (!mk.fehler) { mk.fehler = e; log('Marker-AR: ' + e.message, 'warn'); } }
    try { vfMkHintergrund(gl, mk, W, H); } catch (e) { if (!mk.hgFehler) { mk.hgFehler = e; log('Marker-AR Hintergrund: ' + e.message, 'warn'); } }
    const sichtbar = !!(mk.pose && jetzt - mk.zuletzt < VF_MK.verlorenMs);
    const h2 = VF.schicht && VF.schicht.querySelector('.vf-ar-hinweis');
    if (h2) h2.hidden = sichtbar;
    vfMkDiagnose(mk, W, H, jetzt);
    if (!sichtbar) return;
    gl.enable(gl.DEPTH_TEST);
    const blick = vfMal(mk.pose, vfMkWelt());
    const pv = vfMal(vfMkProjektion(mk, W, H, 20, 60000), blick);
    VF.augeJetzt = vfMkAuge(blick);
    vfSzeneMalen(gl, pv, blick, VF.augeJetzt);
  }
  // Kameraposition in der Welt der Fahrt: Inverse der starren Abbildung (Drehung mal Massstab plus Verschiebung).
  function vfMkAuge(B) {
    const s2 = B[0] * B[0] + B[1] * B[1] + B[2] * B[2] || 1;   // Massstab^2 der ersten Spalte
    const t = [B[12], B[13], B[14]];
    return [-(B[0] * t[0] + B[1] * t[1] + B[2] * t[2]) / s2, -(B[4] * t[0] + B[5] * t[1] + B[6] * t[2]) / s2, -(B[8] * t[0] + B[9] * t[1] + B[10] * t[2]) / s2];
  }

  // v1.6.73: Diagnose im Bild (WIP, bis die Marker-AR am Geraet sicher laeuft): Zahlen und gruene Punkte an den Ecken.
  function vfMkDiagnose(mk, W, H, jetzt) {
    const sch = VF.schicht;
    if (!sch) return;
    let d = sch.querySelector('.vf-mk-diag');
    if (!d) { d = document.createElement('div'); d.className = 'vf-mk-diag'; sch.appendChild(d); }
    if (!mk.diagAt || jetzt - mk.diagAt > 250) {
      mk.diagAt = jetzt;
      const S = mk.stat || {}, v = mk.video;
      d.textContent = t('Kamera') + ' ' + (v.videoWidth || 0) + '×' + (v.videoHeight || 0) + ' · ' + t('erkannt') + ' ' + (S.erkannt || 0) + '/' + (S.gesendet || mk.bilder || 0)
        + ' · ' + t('verworfen') + ' ' + (S.verworfen || 0) + ' · ' + t('Kandidaten') + ' ' + (S.kand || 0) + ' · ' + (S.ms || 0) + ' ms · '
        + (S.dist ? Math.round(S.dist / 10) + ' cm' : '–') + ' · ' + t('fein') + ' ' + (S.fein || 0) + ' · ' + (mk.worker ? 'Worker' : t('Hauptthread')) + (mk.fehler ? ' · ⚠ ' + String(mk.fehler).slice(0, 60) : '');
    }
    // Ecken: aus Bildanteilen (0..1 des Videos) in Schirmpixel (Ausschnitt wie object-fit: cover).
    let punkte = sch.querySelectorAll('.vf-mk-punkt');
    if (punkte.length < 4) { for (let i = punkte.length; i < 4; i++) { const p = document.createElement('i'); p.className = 'vf-mk-punkt'; sch.appendChild(p); } punkte = sch.querySelectorAll('.vf-mk-punkt'); }
    const zeigen = !!(mk.ecken && jetzt - (mk.eckenAt || 0) < 400 && mk.video.videoWidth);
    const vw = mk.video.videoWidth || 1, vh = mk.video.videoHeight || 1, sc = Math.max(W / vw, H / vh);
    punkte.forEach((p, i) => {
      p.hidden = !zeigen;
      if (!zeigen) return;
      const c = mk.ecken[i];
      p.style.left = (W / 2 + (c[0] - 0.5) * vw * sc) + 'px';
      p.style.top = (H / 2 + (c[1] - 0.5) * vh * sc) + 'px';
    });
  }
