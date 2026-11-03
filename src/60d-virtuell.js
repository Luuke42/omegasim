  // ============================== VIRTUELLE FAHRT (v1.1.3, WIP) ==============================
  //
  // BESTELLT: "Modus 'virtuell' neben 'auf Bahn' und 'frei': virtuelles Auto auf der Editor-Strecke
  // mit Verfolgerkamera, Rueckfall Balkonia, 3D-Auto nach der Physik, mit Motorsound, erst einmal
  // ohne NPCs, nur Zeitnahme." Und auf Nachfrage: "frei fahren" (nicht in der Spur gefuehrt).
  //
  // DER KNIFF: Das virtuelle Auto ist ein Garagenauto ohne Bluetooth. Es meldet dieselben Pakete wie
  // ein echtes (Byte 11 Teilezaehler, Byte 12 Teilecode, 0x00 neben der Bahn) ueber onCarNotify. Damit
  // laufen Rundenzeit, Sektoren, Rennen, Time Attack, Telemetrie und Motorsound ohne zweite
  // Zeitnahme. Gesendet wird an eine Attrappe (rx), die nichts tut.
  //
  // FAHREN: Tempo aus der Physik (physEngine, also das gewaehlte Fahrgefuehl), Richtung aus dem
  // uebertragenen Lenkwinkel (outputs.servoAngle) nach dem Einspurmodell mit Haftgrenze: bei hohem
  // Tempo dreht das Auto nicht enger, als die Reifen tragen. Neben der Bahn bremst der Teppich; wer
  // laenger als VF_ABSEITS_ZURUECK_MS daneben steht, wird zurueckgesetzt (wie von Hand).
  //
  // BILD: eigener, kleiner WebGL-Renderer (keine Bibliothek): Boden, Fahrbahn aus der Mittellinie des
  // Editors (trackCenterline/trackNormals), Randsteine wie im Editor (links blau-weiss, rechts
  // rot-weiss), Teilegrenzen, Start/Ziel, Verfolgerkamera. Das Auto ist seit v1.1.9 der Vulture V5R aus
  // Speed Dreams (Modell, Lichter, Federung, Fahrdaten); der Kasten in Autofarbe bleibt als Rueckfall.
  const VF_RAD_GRAD = 26;           // groesster Radeinschlag bei vollem Lenkbefehl
  const VF_ACHSE = 7.0;             // Radstand in Streckeneinheiten (~7,5 cm)
  const VF_MU = 1.0;                // Haftbeiwert auf trockener Bahn (mal gripScale fuer Regen)
  const VF_ABSEITS_BREMSE = 3.0;    // Tempoverlust neben der Bahn je Sekunde (exponentiell)
  const VF_ABSEITS_ZURUECK_MS = 2500;
  const VF_TAKT_MS = 45;            // Paketfolge wie ein echtes Auto
  const VF_AUTO = { L: 9.6, B: 4.4, H: 2.4 };
  const VF = { aktiv: false, car: null, vorherRolle: null, vorherSpieler: null, schicht: null, cv: null, hud: null,
               gl: null, prog: null, bahn: null, auto: null, pts: null, nrm: null, tiles: null, zu: false,
               x: 0, y: 0, h: 0, idx: 0, zaehler: 0, kachel: -2, abseits: false, abseitsSeit: 0, raf: 0, takt: 0,
               letzt: 0, kam: null, rundeAb: 0, letzte: null, beste: null, trackModeVorher: null,
               npcs: null, npcBogen: null, npcRunde: 0, tempoFaktor: 1 };

  // v1.1.3 GEMELDET: "Ich kann das virtuelle Auto mit Pfeiltasten nicht steuern." Die Menuefuehrung
  // (50b-menu-nav.js) nahm die Pfeiltasten, sobald auf der Seite bedienbare Zeilen lagen, und das Pad
  // fuhr im Menue-Zustand nicht. Waehrend der virtuellen Fahrt fahren Pfeiltasten und Pad IMMER:
  // menuNavActive() und konsoleMenue() fragen das hier ab. Als Funktionsdeklaration und mit try, weil
  // sie schon gerufen werden kann, bevor VF angelegt ist.
  function vfAktiv() { try { return !!VF.aktiv; } catch (e) { return false; } }
  function vfTilesWaehlen() {
    if (currentTrackTiles && currentTrackTiles.length >= 3) return currentTrackTiles;
    const b = (typeof CH_DAUER !== 'undefined') ? CH_DAUER.find((d) => d.id === 'dauer-balkonia') : null;
    const p = b ? codeToTrack(b.code) : null;
    if (p && p.tiles && p.tiles.length >= 3) {
      currentTrackTiles = p.tiles;
      if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
      showHudToast(t('Keine Strecke im Editor - es geht auf Balkonia'));
      return p.tiles;
    }
    return null;
  }
  // Kartentyp -> gemeldeter Code (auf der Schiene).
  function vfCode(typ) {
    if (typ === TILE_TYPE.START) return START_CODE_RAIL;
    if (typ === TILE_TYPE.PIT) return 0x07;
    if (typ === TILE_TYPE.ENGE) return 0x0a;
    return typ & 0xff;
  }

  // ---- WebGL ------------------------------------------------------------------------------
  function vfShader(gl, typ, quelle) {
    const s = gl.createShader(typ);
    gl.shaderSource(s, quelle); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function vfProgramm(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; attribute vec3 c; uniform mat4 m; uniform mat4 w; varying vec3 vc; varying float vd;'
      + 'void main(){ vec4 q = w * vec4(p, 1.0); gl_Position = m * q; vc = c; vd = gl_Position.w; }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vc; varying float vd; uniform vec3 nebel; uniform float alf;'
      + 'void main(){ float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(vc, nebel, f), alf); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function vfPuffer(gl, daten) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(daten), gl.STATIC_DRAW);
    return { b, n: daten.length / 6 };
  }
  // Himmel: ein Vollbild-Quad in NDC mit Farbverlauf (oben tiefblau, am Horizont hell). Ersetzt die
  // bisher flache Clear-Farbe und passt zum Nebel, damit die Strecke am Horizont ins Licht uebergeht.
  function vfProgrammHimmel(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; attribute vec3 c; varying vec3 vc;'
      + 'void main(){ gl_Position = vec4(p, 1.0); vc = c; }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vc; void main(){ gl_FragColor = vec4(vc, 1.0); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, ap: gl.getAttribLocation(p, 'p'), ac: gl.getAttribLocation(p, 'c') };
  }
  function vfHimmel(gl) {
    const oben = [0.18, 0.36, 0.66], unten = [0.66, 0.78, 0.90];
    const a = [-1, 1, 0, oben[0], oben[1], oben[2], 1, 1, 0, oben[0], oben[1], oben[2],
               1, -1, 0, unten[0], unten[1], unten[2], -1, 1, 0, oben[0], oben[1], oben[2],
               1, -1, 0, unten[0], unten[1], unten[2], -1, -1, 0, unten[0], unten[1], unten[2]];
    return vfPuffer(gl, a);
  }
  function vfHex(hex) {
    const h = String(hex || '#888888').replace('#', '');
    const v = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  // Ein Viereck (zwei Dreiecke) in der Ebene y.
  function vfQuad(a, p1, p2, p3, p4, y, f) {
    [p1, p2, p3, p1, p3, p4].forEach((p) => a.push(p[0], y, p[1], f[0], f[1], f[2]));
  }
  // Eine senkrechte Wand (zwei Dreiecke) zwischen y0 und y1 an den zwei Kartenpunkten p1, p2.
  function vfWand(a, p1, p2, y0, y1, f) {
    [p1, p2, p2, p1, p2, p1].forEach((p, i) => a.push(p[0], [y0, y0, y1, y0, y1, y1][i], p[1], f[0], f[1], f[2]));
  }
  // ---- BAHN UND BODEN MIT TEXTUREN (v1.3.39, WIP) ----------------------------------------------
  // BESTELLT: "Verbessere die Textur der Schienen. Du darfst kleinere Kratzer reinmachen." und
  // "Verbessere die Textur jenseits der Schienen. Es soll aussehen wie ein Parkett- oder Laminatboden
  // (nicht nur eine Textur wenn moeglich). Achte darauf, dass der Massstab korrekt ist (1/50)."
  //
  // MASSSTAB: Die Szene rechnet in den Einheiten der Streckenkarte (x = Karten-x, z = Karten-y, y oben),
  // TRACK_UNITS_PER_CM = 0,930 Einheiten je ECHTEM Zentimeter: eine gerade Kachel (43 cm) ist 40
  // Einheiten lang, die Fahrbahn (25 cm) 23,3 Einheiten breit. Die echte Bahn liegt auf einem echten
  // Fussboden, also liegen die Dielen in echten Massen im selben System: 19 x 130 cm = 17,7 x 120,9
  // Einheiten (gut drei Viertel der Bahnbreite), Fischgraet-Staebe 7 x 35 cm = 6,5 x 32,6. Fuer das
  // 1:50-Auto ist eine Diele 9,5 m breit - so sieht es auf dem Wohnzimmerboden auch aus.
  //
  // LATENZ (100-Euro-Handys): Die Pixel der Texturen entstehen EINMAL je Sitzung (vfTexDaten, der
  // Boden nur fuer die gewaehlte Art), eine neue Fahrt laedt sie nur hoch (mit Mipmaps). Die Geometrie
  // entsteht einmal je Fahrt. Je Bild: drei Zeichenaufrufe mit EINEM Texturzugriff je Pixel; der Glanz
  // (Fresnel) wird je Ecke gerechnet, nicht je Pixel. Der Boden schreibt keine Tiefe (er liegt unter
  // allem), damit flackert zwischen Boden und Fahrbahn nichts, auch nicht bei 16-Bit-Tiefenpuffern.
  const VF_BODEN_STORE = 'omegasim-vf-boden';
  // ton: Grundtoene der Dielen (je Diele einer, leicht gestreut), maser: Farbe der Jahresringe,
  // ringCm: Ringabstand, poren: Anteil der Porenstriche (Eiche), ast: Wahrscheinlichkeit eines Asts.
  const VF_BOEDEN = [
    { id: 'eiche', name: 'Eiche hell', art: 'diele', breiteCm: 19, laengeCm: 130, spalten: 8, zeilen: 1,
      ton: [[216, 180, 134], [205, 166, 119], [224, 192, 148], [197, 158, 111], [211, 172, 124]], maser: [158, 114, 70],
      kontrast: 0.50, ringCm: 1.0, poren: 1.0, ast: 0.35, glanz: 0.30 },
    { id: 'grau', name: 'Laminat grau', art: 'diele', breiteCm: 19.3, laengeCm: 128.5, spalten: 8, zeilen: 1,
      ton: [[160, 156, 150], [146, 143, 138], [172, 168, 161], [135, 132, 128], [154, 149, 141]], maser: [108, 104, 99],
      kontrast: 0.36, ringCm: 1.3, poren: 0.25, ast: 0.15, glanz: 0.38 },
    { id: 'fischgraet', name: 'Fischgrät', art: 'fischgraet', breiteCm: 7, laengeCm: 35, spalten: 16, zeilen: 2,
      ton: [[190, 143, 94], [176, 128, 82], [201, 157, 106], [163, 118, 74], [184, 136, 86]], maser: [122, 82, 48],
      kontrast: 0.42, ringCm: 0.8, poren: 1.0, ast: 0.08, glanz: 0.28 },
  ];
  const VF_ATLAS_B = 2048, VF_ATLAS_H = 1024;   // Bodenatlas (8 MB, mit Mipmaps 10,7 MB)
  const VF_BAHN_TEX = 1024, VF_BAHN_SPALTE = 256;  // Fahrbahn: 4 Teile nebeneinander (3 gebraucht, 1 Start/Ziel)
  const VF_RAND_B = 256, VF_RAND_H = 1024;       // Randstreifen: blau | rot, 4 Pfeiltakte uebereinander
  const VF_FUGE = 0.07;                          // halbe Steckfuge in Einheiten (zusammen ~1,5 mm)
  const VF_FUGE_FARBE = [0.22, 0.22, 0.23];
  // Gemerkte Pixel (einmal je Sitzung) und wie oft sie erzeugt wurden (Selbsttest).
  const vfTexDaten = { bahn: null, rand: null, boden: null, bodenId: null };
  const vfTexZaehler = { bahn: 0, rand: 0, boden: 0 };
  function vfBodenWahl() {
    try { const v = localStorage.getItem(VF_BODEN_STORE); return VF_BOEDEN.some((b) => b.id === v) ? v : 'eiche'; } catch (e) { return 'eiche'; }
  }
  function vfBodenSetzen(id) { try { localStorage.setItem(VF_BODEN_STORE, id); } catch (e) { /* privat */ } }
  function vfBodenArt(id) { return VF_BOEDEN.find((b) => b.id === id) || VF_BOEDEN[0]; }
  // Gleichverteilte Zufallszahlen mit Startwert (mulberry32): dieselbe Strecke sieht jedes Mal gleich aus.
  function vfZufall(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vfHash(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Glattes Wertrauschen in 1D (n Stuetzstellen) und 2D (nx x ny), Werte -1..1, t/u/v in 0..1.
  function vfRauschen1(rnd, n) {
    const k = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) k[i] = rnd() * 2 - 1;
    return (t) => {
      const x = Math.max(0, Math.min(n - 1e-6, t * n)), i = x | 0, f = x - i, s = f * f * (3 - 2 * f);
      return k[i] + (k[i + 1] - k[i]) * s;
    };
  }
  // Glattes 2D-Rauschfeld (nx x ny Zellen) gleich als w x h Werte (-1..1): je Zeile die Stuetzstellen
  // einmal mischen, je Pixel nur noch eine lineare Mischung. So kostet ein Megapixel wenige ms.
  function vfFeld(rnd, nx, ny, w, h) {
    const k = new Float32Array((nx + 1) * (ny + 1));
    for (let i = 0; i < k.length; i++) k[i] = rnd() * 2 - 1;
    const ci = new Int32Array(w), cw = new Float32Array(w), zk = new Float32Array(nx + 1), out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) { const X = Math.min(nx - 1e-6, x / w * nx), i = X | 0, f = X - i; ci[x] = i; cw[x] = f * f * (3 - 2 * f); }
    for (let y = 0; y < h; y++) {
      const Y = Math.min(ny - 1e-6, y / h * ny), j = Y | 0, f = Y - j, s = f * f * (3 - 2 * f);
      for (let i = 0; i <= nx; i++) { const a = k[j * (nx + 1) + i]; zk[i] = a + (k[(j + 1) * (nx + 1) + i] - a) * s; }
      const z = y * w;
      for (let x = 0; x < w; x++) { const i = ci[x], a = zk[i]; out[z + x] = a + (zk[i + 1] - a) * cw[x]; }
    }
    return out;
  }
  // Ein Holzstueck (Diele oder Fischgraet-Stab) in den Atlas: x quer, y laengs. Jahresringe als
  // "Kathedrale" (Parabelboegen um eine Mitte, die auch neben dem Brett liegen darf, dann laufen die
  // Ringe fast gerade), Fasern je Spalte, Poren als kurze dunkle Striche, Flecken, selten ein Ast.
  // Ringsum eine dunkle Fuge (1-2 px) mit heller Fase daneben: im Atlas, damit sie mit den Mipmaps
  // weich wird statt in der Ferne zu flimmern. Alpha = Glanz (0 in der Fuge).
  function vfHolzStueck(d, AW, x0, y0, w, h, P, rnd) {
    const ton = P.ton[Math.floor(rnd() * P.ton.length)], j = 1 + (rnd() - 0.5) * 0.08;
    const t0 = ton[0] * j, t1 = ton[1] * j, t2 = ton[2] * j, m0 = P.maser[0], m1 = P.maser[1], m2 = P.maser[2];
    const cmB = P.breiteCm, cmL = P.laengeCm, sx = cmB / w, sy = cmL / h;
    const ring = P.ringCm * (0.7 + 0.6 * rnd());
    const cx = cmB * (rnd() * 1.8 - 0.4), cy = cmL * (0.15 + 0.7 * rnd());
    const bogen = rnd() < 0.3 ? 0.0003 : 0.0015 + 0.005 * rnd();      // je cm; klein = gerade Maserung
    const wob = vfRauschen1(rnd, 4), wob2 = vfRauschen1(rnd, 9), wa = cmB * (0.02 + rnd() * 0.06);
    const fleck = vfFeld(rnd, 3, Math.max(3, Math.round(cmL / 10)), w, h);
    const faser = new Float32Array(w);
    let f = 0;
    const breit = vfRauschen1(rnd, 7);   // breite helle/dunkle Streifen quer
    for (let x = 0; x < w; x++) { f = f * 0.6 + (rnd() * 2 - 1) * 0.4; faser[x] = f + 1.2 * breit(x / w); }
    const ast = rnd() < P.ast ? { x: cmB * (0.2 + 0.6 * rnd()), y: cmL * (0.1 + 0.8 * rnd()), r: 0.3 + rnd() * 0.45 } : null;
    // Jeder Jahresring eigen: Staerke und Breite des dunklen Spaetholz-Bands je Ring zufaellig.
    const ringStark = new Float32Array(64), ringBreit = new Float32Array(64);
    for (let i = 0; i < 64; i++) { ringStark[i] = 0.25 + 0.75 * rnd() * rnd() + (rnd() < 0.15 ? 0.4 : 0); ringBreit[i] = 0.18 + 0.25 * rnd(); }
    const porenGrenze = 1 - 0.012 * P.poren, porenPx = Math.max(2, Math.round(0.35 / sy)), poren = new Uint8Array(w);
    let porenZeile = -1;
    for (let y = 0; y < h; y++) {
      const yc = y * sy, tv = y / h;
      const versatz = wob(tv) * wa + wob2(tv) * 0.07 - cx, kat = bogen * (yc - cy) * (yc - cy);
      const ende = y < 2 || y >= h - 2, aussen = y === 0 || y === h - 1, fase = y === 2 || y === h - 3;
      const zeile = ((y0 + y) * AW + x0) * 4, zf = y * w, py = ((y0 + y) / porenPx) | 0;
      if (py !== porenZeile) { porenZeile = py; for (let x = 0; x < w; x++) poren[x] = vfHash(x0 + x, py) > porenGrenze ? 1 : 0; }
      for (let x = 0; x < w; x++) {
        const xc = x * sx;
        let r = (xc + versatz < 0 ? -(xc + versatz) : xc + versatz) + kat, astK = 0;
        if (ast) {
          const ax = (xc - ast.x) / ast.r, ay = (yc - ast.y) / (ast.r * 1.7), q = ax * ax + ay * ay;
          if (q < 25) r += 1.6 / (0.3 + q);
          if (q < 1) astK = 0.55 * (1 - q);
        }
        const rr = r / ring, ri = (rr | 0) & 63, fr = rr - (rr | 0), bb = ringBreit[ri];
        const s = fr < bb ? fr / bb : 0, dunkel = 4 * s * (1 - s) * ringStark[ri];
        const fl = fleck[zf + x], fa = faser[x];
        let k = P.kontrast * dunkel * (0.7 + 0.3 * fa) + 0.07 * fa + 0.05 * fl + astK;
        if (k > 1) k = 1; else if (k < -0.2) k = -0.2;
        let hell = 1 + 0.04 * fl;
        if (poren[x]) hell *= 0.8;
        let g = P.glanz * (0.85 + 0.35 * fl) * (1 - 0.3 * dunkel);
        if (ende || x < 2 || x >= w - 2) { hell *= (aussen || x === 0 || x === w - 1) ? 0.3 : 0.5; g = 0; }
        else if (fase || x === 2 || x === w - 3) hell *= 1.05;
        const i = zeile + x * 4;
        d[i] = (t0 + (m0 - t0) * k) * hell;
        d[i + 1] = (t1 + (m1 - t1) * k) * hell;
        d[i + 2] = (t2 + (m2 - t2) * k) * hell;
        d[i + 3] = g * 255;
      }
    }
  }
  // Bodenatlas fuer eine Art: spalten x zeilen Stuecke (Diele 256 x 1024 px, Stab 128 x 512 px).
  // Gemerkt wird nur die gerade gewaehlte Art. Dazu der Mittelwert (fuer die weite Flaeche ausserhalb
  // der Dielen) und das Texel (0,0), ueber das diese Flaeche ihre Farbe holt.
  // ERZEUGT WIRD IN SCHRITTEN (Generator, ein Holzstueck bzw. eine Bahnspalte je Schritt): so kann es
  // im Leerlauf der Garage laufen (vfTexturenVorbereiten), und der Start laedt nur noch hoch. Startet
  // die Fahrt vorher, rechnet vfBodenTexturDaten/vfBahnTexturDaten den Rest sofort fertig.
  const vfTexLauf = { boden: null, bodenId: null, bahn: null };
  function vfBodenLauf(P) {
    if (!vfTexLauf.boden || vfTexLauf.bodenId !== P.id) {
      vfTexZaehler.boden++;
      vfTexDaten.boden = null; vfTexDaten.bodenId = null;   // die vorige Art freigeben
      vfTexLauf.boden = vfBodenBau(P); vfTexLauf.bodenId = P.id;
    }
    return vfTexLauf.boden;
  }
  function vfBodenTexturDaten(id) {
    const P = vfBodenArt(id);
    if (vfTexDaten.boden && vfTexDaten.bodenId === P.id) return vfTexDaten.boden;
    const L = vfBodenLauf(P);
    while (!L.next().done) { /* naechstes Stueck */ }
    vfTexLauf.boden = null;
    return vfTexDaten.boden;
  }
  function* vfBodenBau(P) {
    const AW = VF_ATLAS_B, AH = VF_ATLAS_H, d = new Uint8ClampedArray(AW * AH * 4);
    const rnd = vfZufall(P.id === 'eiche' ? 1911 : P.id === 'grau' ? 2701 : 3307);
    const w = AW / P.spalten, h = AH / P.zeilen, stuecke = [];
    for (let r = 0; r < P.zeilen; r++) {
      for (let s = 0; s < P.spalten; s++) {
        vfHolzStueck(d, AW, s * w, r * h, w, h, P, rnd);
        stuecke.push([(s * w + 0.5) / AW, (r * h + 0.5) / AH, ((s + 1) * w - 0.5) / AW, ((r + 1) * h - 0.5) / AH]);
        yield;
      }
    }
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let i = 0; i < d.length; i += 64) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sa += d[i + 3]; }
    const n = d.length / 64;
    const mittel = [sr / n / 255, sg / n / 255, sb / n / 255];
    d[3] = Math.round(sa / n);
    const texel = [Math.max(1, d[0]) / 255, Math.max(1, d[1]) / 255, Math.max(1, d[2]) / 255];
    vfTexDaten.boden = { d: new Uint8Array(d.buffer), w: AW, h: AH, stuecke, mittel, ferne: [mittel[0] / texel[0], mittel[1] / texel[1], mittel[2] / texel[2]], art: P };
    vfTexDaten.bodenId = P.id;
  }
  // Fahrbahn: matt schwarzer Kunststoff mit feiner Koernung, leichten Glanzunterschieden (Alpha),
  // einer etwas glatter gefahrenen Spur, Kratzern und Staub. Je Bahnteil (v = 0..1 ueber das Teil)
  // eine Spalte: drei Gebrauchsgrade und das Start/Ziel-Teil mit der karierten Linie wie auf dem Foto.
  // Die Steckfuge liegt an beiden Enden (je 2 px = 0,8 mm dunkel, mit heller Kante daneben).
  function vfBahnLauf() {
    if (!vfTexLauf.bahn) { vfTexZaehler.bahn++; vfTexLauf.bahn = vfBahnBau(); }
    return vfTexLauf.bahn;
  }
  function vfBahnTexturDaten() {
    if (vfTexDaten.bahn) return vfTexDaten.bahn;
    const L = vfBahnLauf();
    while (!L.next().done) { /* naechste Spalte */ }
    vfTexLauf.bahn = null;
    return vfTexDaten.bahn;
  }
  function* vfBahnBau() {
    const W = VF_BAHN_TEX, H = VF_BAHN_TEX, SW = VF_BAHN_SPALTE;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const bild = g.createImageData(W, H), d = bild.data, glanz = new Uint8ClampedArray(W * H);
    for (let s = 0; s < 4; s++) {
      const rnd = vfZufall(1009 + s * 7919);
      const fleck = vfFeld(rnd, 8, 14, SW, H), glanzF = vfFeld(rnd, 3, 5, SW, H);
      // Spur: wo die Autos fahren, ist der Kunststoff glatter und ein Hauch Gummi liegt darauf (nur quer).
      const spur = new Float32Array(SW);
      for (let k = 0; k < 5; k++) {
        const m = 0.2 + 0.6 * rnd(), b = 0.015 + 0.04 * rnd(), st = 0.5 + rnd();
        for (let x = 0; x < SW; x++) { const q = (x / SW - m) / b; if (q > -3 && q < 3) spur[x] += st * Math.exp(-q * q); }
      }
      for (let y = 0; y < H; y++) {
        const fuge = y === 0 || y === H - 1, halb = y === 1 || y === H - 2, fase = y === 2 || y === H - 3;
        for (let x = 0; x < SW; x++) {
          const fi = y * SW + x, sp = spur[x];
          let v = 30 + fleck[fi] * 2.6 + (vfHash(s * SW + x, y) - 0.5) * 6 - sp * 1.6;
          let gl = 0.36 + 0.24 * glanzF[fi] + 0.12 * (sp > 1 ? 1 : sp);
          if (fuge) { v = 12; gl = 0; } else if (halb) { v = 21; gl = 0.1; } else if (fase) { v = 40; gl = 0.2; }
          const i = (y * W + s * SW + x) * 4;
          d[i] = v * 0.96; d[i + 1] = v * 0.98; d[i + 2] = v * 1.05; d[i + 3] = 255;
          glanz[y * W + s * SW + x] = gl * 255;
        }
      }
      yield;
    }
    g.putImageData(bild, 0, 0);
    const pxB = SW / 25, pxL = H / 43;   // px je cm quer / laengs
    for (let s = 0; s < 4; s++) {
      const rnd = vfZufall(5003 + s * 104729);
      g.save();
      g.beginPath(); g.rect(s * SW, 3, SW, H - 6); g.clip();
      g.setTransform(pxB, 0, 0, pxL, s * SW, 0);       // ab hier in cm
      if (s === 3) {
        // Start/Ziel wie auf dem Foto: zwei Reihen weisser Kaestchen, versetzt, mit einer Linie dazwischen.
        g.fillStyle = 'rgb(226,227,229)';
        const y0 = 5.2, kb = 0.95, kl = 0.85;
        for (let x = 0.3; x < 25; x += kb * 2) { g.fillRect(x, y0, kb, kl); g.fillRect(x + kb, y0 + kl + 0.35, kb, kl); }
        g.fillRect(0.3, y0 + kl + 0.08, 24.4, 0.2);
      }
      // Kratzer: kurz, gut die Haelfte laengs (Autos und Raeder), der Rest kreuz und quer.
      const anzahl = [16, 32, 55, 32][s];
      for (let k = 0; k < anzahl; k++) {
        const x = 0.5 + rnd() * 24, y = 0.4 + rnd() * 42.2;
        const lang = 0.2 + Math.pow(rnd(), 3) * 3.2;
        const w = rnd() < 0.55 ? (rnd() - 0.5) * 1.0 : rnd() * Math.PI;
        const dx = Math.sin(w) * lang, dy = Math.cos(w) * lang;
        const a = 0.05 + Math.pow(rnd(), 2) * (s === 0 ? 0.12 : 0.24);
        g.strokeStyle = 'rgba(150,153,160,' + a.toFixed(3) + ')';
        g.lineWidth = 0.03 + rnd() * 0.05;
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + dx * 0.5 + (rnd() - 0.5) * 0.3, y + dy * 0.5, x + dx, y + dy);
        g.stroke();
      }
      // Schrammen: Buendel feiner paralleler Linien, eher an den Raendern (dort stossen die Autos an).
      for (let k = 0; k < [1, 2, 4, 2][s]; k++) {
        const x = rnd() < 0.6 ? (rnd() < 0.5 ? 0.6 + rnd() * 3 : 21.4 + rnd() * 3) : 3 + rnd() * 19, y = 1 + rnd() * 40;
        const w = (rnd() - 0.5) * 0.6, lang = 0.6 + rnd() * 1.6, n = 3 + Math.floor(rnd() * 5);
        g.strokeStyle = 'rgba(140,142,148,0.13)';
        g.lineWidth = 0.03;
        for (let q = 0; q < n; q++) {
          const ox = q * 0.09 + rnd() * 0.03;
          g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + Math.sin(w) * lang, y + Math.cos(w) * lang); g.stroke();
        }
      }
      // Staub und kleine Abplatzer.
      for (let k = 0; k < [40, 70, 120, 70][s]; k++) {
        g.fillStyle = rnd() < 0.8 ? 'rgba(190,190,195,0.18)' : 'rgba(0,0,0,0.35)';
        g.fillRect(0.3 + rnd() * 24.4, 0.4 + rnd() * 42.2, 0.05 + rnd() * 0.07, 0.03 + rnd() * 0.04);
      }
      g.restore();
    }
    const fertig = g.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 4);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      out[i] = fertig[i]; out[i + 1] = fertig[i + 1]; out[i + 2] = fertig[i + 2];
      // Kratzer und Staub sind matt: wo es heller wurde, nimmt der Glanz ab.
      out[i + 3] = fertig[i + 1] - d[i + 1] > 5 ? glanz[p] * 0.3 : glanz[p];
    }
    vfTexDaten.bahn = { d: out, w: W, h: H };
  }
  // Randstreifen: weiss mit blauen (links) bzw. roten (rechts) Pfeilen wie auf den Bahnteilen
  // (photos/startgerade.jpg; Masse wie echtRandstreifen in 60-track.js: Pfeil 75 % der Streifenbreite,
  // Laenge 2,3-fach, Takt 3,1-fach). Je Spalte vier Pfeiltakte (128 x 256 px) mit eigenem Schmutz.
  // Die Pfeilspitze zeigt zu wachsendem v (= Fahrtrichtung). Gummiabrieb liegt innen (kleines u).
  function vfRandTexturDaten() {
    if (vfTexDaten.rand) return vfTexDaten.rand;
    vfTexZaehler.rand++;
    const W = VF_RAND_B, H = VF_RAND_H, SB = W / 2, TK = H / 4;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const bild = g.createImageData(W, H), d = bild.data;
    const rnd = vfZufall(7717), fleck = vfFeld(rnd, 4, 24, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, v = 236 + fleck[p] * 5 + (vfHash(x, y + 9000) - 0.5) * 6, i = p * 4;
        d[i] = v - 2; d[i + 1] = v - 1; d[i + 2] = v + 1; d[i + 3] = 255;
      }
    }
    g.putImageData(bild, 0, 0);
    const ph = SB * ECHT_PFEIL_H, pl = TK * (ECHT_PFEIL_L / ECHT_TAKT), kerbe = pl * 0.5 / ECHT_PFEIL_L;
    [['rgb(33,158,218)', 0], ['rgb(222,38,32)', SB]].forEach(([farbe, x0]) => {
      for (let p = 0; p < 4; p++) {
        const cx = x0 + SB / 2, cy = p * TK + TK / 2, l = pl / 2, hh = ph / 2;
        g.fillStyle = farbe;
        g.beginPath();
        [[-hh, -l], [-hh, l - kerbe], [0, l], [hh, l - kerbe], [hh, -l], [0, -l + kerbe]].forEach(([u, v], k) => {
          if (k) g.lineTo(cx + u, cy + v); else g.moveTo(cx + u, cy + v);
        });
        g.closePath(); g.fill();
      }
      // Gummiabrieb innen, Kratzer, grauer Schmutz - je Takt anders.
      g.save();
      g.beginPath(); g.rect(x0, 0, SB, H); g.clip();
      for (let k = 0; k < 9; k++) {
        const x = x0 + Math.pow(rnd(), 2) * SB * 0.5, y = rnd() * H, lang = 20 + rnd() * 110;
        g.strokeStyle = 'rgba(25,25,28,' + (0.04 + rnd() * 0.12).toFixed(3) + ')';
        g.lineWidth = 1 + rnd() * 3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y + lang); g.stroke();
      }
      for (let k = 0; k < 26; k++) {
        const x = x0 + rnd() * SB, y = rnd() * H, w = rnd() < 0.5 ? (rnd() - 0.5) * 0.8 : rnd() * Math.PI, lang = 4 + Math.pow(rnd(), 2) * 36;
        g.strokeStyle = 'rgba(105,108,115,' + (0.05 + rnd() * 0.16).toFixed(3) + ')';
        g.lineWidth = 0.5 + rnd() * 0.7;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(w) * lang, y + Math.cos(w) * lang); g.stroke();
      }
      for (let k = 0; k < 8; k++) {
        const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        r.addColorStop(0, 'rgba(110,105,95,0.13)'); r.addColorStop(1, 'rgba(110,105,95,0)');
        g.save(); g.translate(x0 + rnd() * SB, rnd() * H); g.scale(10 + rnd() * 30, 20 + rnd() * 70);
        g.fillStyle = r; g.fillRect(-1, -1, 2, 2); g.restore();
      }
      g.restore();
    });
    const fertig = g.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 4);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = fertig[i]; out[i + 1] = fertig[i + 1]; out[i + 2] = fertig[i + 2];
      out[i + 3] = fertig[i] + fertig[i + 1] + fertig[i + 2] > 600 ? 70 : 45;
    }
    vfTexDaten.rand = { d: out, w: W, h: H };
    return vfTexDaten.rand;
  }
  // Im Leerlauf vorbereiten (aus der Garage gerufen, wenn die Optionen der virtuellen Fahrt offen sind):
  // je Leerlauf-Haeppchen so viele Schritte, wie die Frist erlaubt (ein Schritt ~10-35 ms auf dem Handy).
  // Laeuft die Fahrt schon, macht der Start den Rest selbst.
  let vfVorbereiten = false;
  function vfTexturenVorbereiten() {
    if (vfVorbereiten) return;
    vfVorbereiten = true;
    const ric = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 3000 })
      : (f) => setTimeout(() => f({ timeRemaining: () => 12 }), 80);
    const schritt = (frist) => {
      if (VF.aktiv) { vfVorbereiten = false; return; }
      do {
        const P = vfBodenArt(vfBodenWahl());
        if (!vfTexDaten.bahn) { if (vfBahnLauf().next().done) vfTexLauf.bahn = null; }
        else if (!vfTexDaten.rand) vfRandTexturDaten();
        else if (!(vfTexDaten.boden && vfTexDaten.bodenId === P.id)) { if (vfBodenLauf(P).next().done) vfTexLauf.boden = null; }
        else { vfVorbereiten = false; return; }
      } while (frist.timeRemaining() > 8);
      ric(schritt);
    };
    ric(schritt);
  }
  // Pixel als Textur hochladen: Mipmaps, trilinear oder nur bilinear je Mip-Stufe, anisotrop hoechstens
  // aniso-fach, wenn vorhanden. Gemessen (Software-GL, 1280 x 720, Verfolger, je Bild): 4-fach auf allen
  // drei kostete 14 ms mehr als 1-fach, trilinear auf dem Boden (der den halben Schirm fuellt) 10 ms
  // mehr als bilinear. Also: Boden bilinear und 2-fach (Fugen in der Ferne bleiben lesbar, der
  // Mip-Wechsel faellt auf Holz nicht auf), Randstein trilinear und 2-fach (kleine Flaeche, Pfeile),
  // Fahrbahn bilinear und 1-fach (fast einfarbig).
  function vfTexturHoch(gl, t, wiederholenV, aniso, trilinear) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.d);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, trilinear ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wiederholenV ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    if (!(aniso > 1)) return tx;
    const an = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
      || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
    return tx;
  }
  // Programm fuer Boden, Fahrbahn und Randsteine: Textur mal Eckfarbe, plus Glanz (Fresnel je Ecke mal
  // Alpha der Textur), Nebel wie im Rest der Szene. Gerechnet in mediump (auf Handys halbe Genauigkeit,
  // schneller), nur die Texturkoordinate in highp, wo vorhanden: die Randsteine zaehlen v je Teil bis
  // ~8 hoch, in 16 Bit waeren das 4 Texel Fehler.
  function vfProgrammFlaeche(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; attribute vec2 uv; attribute vec3 c; uniform mat4 m; uniform vec3 auge; uniform float glanz;'
      + 'varying vec2 vuv; varying vec3 vc; varying float vd; varying float vg;'
      + 'void main(){ gl_Position = m * vec4(p, 1.0); vuv = uv; vc = c; vd = gl_Position.w;'
      + ' float e = 1.0 - max(normalize(auge - p).y, 0.0); vg = glanz * e * e * e; }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float;\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nvarying highp vec2 vuv;\n#else\nvarying vec2 vuv;\n#endif\n'
      + 'varying vec3 vc; varying float vd; varying float vg; uniform sampler2D tx; uniform vec3 nebel;'
      + 'void main(){ vec4 t = texture2D(tx, vuv); vec3 c = t.rgb * vc + vec3(0.80, 0.86, 0.95) * (vg * t.a);'
      + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, nebel, f), 1.0); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['m', 'auge', 'glanz', 'tx', 'nebel'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, u, ap: gl.getAttribLocation(p, 'p'), auv: gl.getAttribLocation(p, 'uv'), ac: gl.getAttribLocation(p, 'c') };
  }
  // Ecke: x y z u v r g b (8 Zahlen); Viereck aus vier Ecken [x, y, z, u, v] mit einer Farbe.
  function vfViereck(a, e0, e1, e2, e3, c) {
    for (const e of [e0, e1, e2, e0, e2, e3]) a.push(e[0], e[1], e[2], e[3], e[4], c[0], c[1], c[2]);
  }
  // Fahrbahn und Randsteine aus der Mittellinie. Abschnitt i (Punkt i -> i+1) gehoert zum Teil
  // pts[i+1].tile; Punkt i ist dann die Teilegrenze (trackCenterline legt den letzten Punkt eines Teils
  // auf sein Ende). Fahrbahn: v = 0..1 ueber das Teil, eine zufaellige Spalte (Gebrauchsgrad), zufaellig
  // gespiegelt, Helligkeit je Teil leicht anders. Randstein: eine ganze Zahl Pfeiltakte je Teil und
  // Seite (wie im Editor), an beiden Enden ein dunkles Stueck als Steckfuge. Rein (ohne WebGL).
  function vfBahnGeometrie(pts, nrm, tiles) {
    const strasse = [], rand = [];
    const half = TRACK_HALF_W, kw = TRACK_KERB_W, ky = 0.09, n = pts.length;
    const rnd = vfZufall(4242 + tiles.length * 31 + Math.round(Math.abs(pts[n - 1].x) * 7));
    const off = (i, d) => [pts[i].x + nrm[i].x * d, pts[i].y + nrm[i].y * d];
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const teile = [];
    for (let i = 0; i < n - 1; i++) {
      const T = pts[i + 1].tile, l = teile[teile.length - 1];
      if (l && l.T === T) l.i1 = i; else teile.push({ T, i0: i, i1: i });
    }
    const takt = kw * ECHT_PFEIL_H * ECHT_TAKT;
    teile.forEach((tl) => {
      const start = !!(tiles[tl.T] && tiles[tl.T].type === TILE_TYPE.START);
      const sp = start ? 3 : Math.floor(rnd() * 3), fu = !start && rnd() < 0.5, fv = !start && rnd() < 0.5;
      const hell = 0.93 + rnd() * 0.14, ct = [hell, hell, hell * (0.98 + rnd() * 0.04)];
      const acc = [0];
      for (let i = tl.i0; i <= tl.i1; i++) acc.push(acc[acc.length - 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
      const L = acc[acc.length - 1] || 1;
      const uL = (sp * VF_BAHN_SPALTE + 0.5) / VF_BAHN_TEX, uR = ((sp + 1) * VF_BAHN_SPALTE - 0.5) / VF_BAHN_TEX;
      const ua = fu ? uR : uL, ub = fu ? uL : uR;
      for (let i = tl.i0; i <= tl.i1; i++) {
        let v0 = acc[i - tl.i0] / L, v1 = acc[i - tl.i0 + 1] / L;
        if (fv) { v0 = 1 - v0; v1 = 1 - v1; }
        const a = off(i, half), b = off(i + 1, half), c = off(i + 1, -half), d = off(i, -half);
        vfViereck(strasse, [a[0], 0, a[1], ua, v0], [b[0], 0, b[1], ua, v1], [c[0], 0, c[1], ub, v1], [d[0], 0, d[1], ub, v0], ct);
      }
      for (const sg of [1, -1]) {
        const mitte = (half + kw / 2) * sg, accS = [0];
        for (let i = tl.i0; i <= tl.i1; i++) {
          const p = off(i, mitte), q = off(i + 1, mitte);
          accS.push(accS[accS.length - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
        }
        const Ls = accS[accS.length - 1] || 1, nP = Math.max(1, Math.round(Ls / takt)), k0 = Math.floor(rnd() * 4);
        const u0 = (sg > 0 ? 0.5 : 128.5) / VF_RAND_B, u1 = (sg > 0 ? 127.5 : 255.5) / VF_RAND_B, uw = (sg > 0 ? 4 : 132) / VF_RAND_B;
        const wand = [ct[0] * 0.74, ct[1] * 0.74, ct[2] * 0.76], aussen = [ct[0] * 0.6, ct[1] * 0.6, ct[2] * 0.62];
        for (let i = tl.i0; i <= tl.i1; i++) {
          const j = i - tl.i0, segL = (accS[j + 1] - accS[j]) || 1;
          const va = (k0 + nP * accS[j] / Ls) / 4, vb = (k0 + nP * accS[j + 1] / Ls) / 4;
          const f = Math.min(0.45, VF_FUGE / segL), stuecke = [];
          let t0 = 0, t1 = 1;
          if (j === 0) { stuecke.push([0, f, true]); t0 = f; }
          if (i === tl.i1) t1 = 1 - f;
          stuecke.push([t0, t1, false]);
          if (i === tl.i1) stuecke.push([t1, 1, true]);
          const iA = off(i, half * sg), iB = off(i + 1, half * sg), oA = off(i, (half + kw) * sg), oB = off(i + 1, (half + kw) * sg);
          for (const [s0, s1, fuge] of stuecke) {
            if (s1 <= s0) continue;
            const i0 = lerp(iA, iB, s0), i1 = lerp(iA, iB, s1), o0 = lerp(oA, oB, s0), o1 = lerp(oA, oB, s1);
            const w0 = va + (vb - va) * s0, w1 = va + (vb - va) * s1;
            vfViereck(rand, [o0[0], ky, o0[1], u1, w0], [o1[0], ky, o1[1], u1, w1], [i1[0], ky, i1[1], u0, w1], [i0[0], ky, i0[1], u0, w0], fuge ? VF_FUGE_FARBE : ct);
            vfViereck(rand, [i0[0], ky, i0[1], uw, w0], [i1[0], ky, i1[1], uw, w1], [i1[0], 0, i1[1], uw, w1], [i0[0], 0, i0[1], uw, w0], fuge ? VF_FUGE_FARBE : wand);
            vfViereck(rand, [o0[0], ky, o0[1], uw, w0], [o1[0], ky, o1[1], uw, w1], [o1[0], -0.05, o1[1], uw, w1], [o0[0], -0.05, o0[1], uw, w0], fuge ? VF_FUGE_FARBE : aussen);
          }
        }
      }
    });
    return { strasse, rand, teile: teile.length };
  }
  // Ein Holzstueck als Viereck: Ursprung o, Laengsrichtung e (Laenge L), Querrichtung q (Breite B).
  // Atlas-Stueck, Spiegelung und Farbton zufaellig: kein Muster wiederholt sich sichtbar.
  function vfBodenStueck(a, T, rnd, o, e, L, q, B, y) {
    const st = T.stuecke[Math.floor(rnd() * T.stuecke.length)];
    let [u0, v0, u1, v1] = st;
    if (rnd() < 0.5) [u0, u1] = [u1, u0];
    if (rnd() < 0.5) [v0, v1] = [v1, v0];
    const hl = (0.92 + rnd() * 0.13) * VF_BODEN_HELL, w = (rnd() - 0.5) * 0.05, c = [hl * (1 + w), hl, hl * (1 - w)];
    const P = (s, t) => [o[0] + e[0] * L * s + q[0] * B * t, y, o[1] + e[1] * L * s + q[1] * B * t];
    const p0 = P(0, 0), p1 = P(1, 0), p2 = P(1, 1), p3 = P(0, 1);
    vfViereck(a, [p0[0], y, p0[2], u0, v0], [p1[0], y, p1[2], u0, v1], [p2[0], y, p2[2], u1, v1], [p3[0], y, p3[2], u1, v0], c);
  }
  // Der Boden: Dielen (Reihen laengs x, Stossfugen je Reihe versetzt, mindestens ein Viertel der
  // Dielenlaenge zur Nachbarreihe) oder Fischgraet (Staebe unter +-45 Grad, exakte Parkettierung:
  // Stab A [0,L]x[0,B], Stab B [L,L+B]x[B-L,B], verschoben um i(B,B) + j(L,-L)). Dielen bis
  // VF_BODEN_RAND um die Strecke, dahinter eine weite Flaeche im Mittelwert der Textur (keine Kante im
  // Nebel). Rein (ohne WebGL); liefert die Zahlen und die Masse fuer den Selbsttest.
  const VF_BODEN_RAND = 650, VF_BODEN_RAND_FG = 420, VF_BODEN_WEIT = 3000;
  const VF_BODEN_HELL = 0.84;   // Zimmerlicht: der Boden etwas dunkler als die Textur
  function vfBodenGeometrie(pts, T, art) {
    const a = [], y = -0.05, cm = TRACK_UNITS_PER_CM;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    // Fischgraet hat 18-mal so viele Stuecke je Flaeche: dort ein schmalerer Rand (Ecken je Bild).
    const R = art.art === 'fischgraet' ? VF_BODEN_RAND_FG : VF_BODEN_RAND;
    const x0 = minX - R, x1 = maxX + R, z0 = minY - R, z1 = maxY + R;
    const B = art.breiteCm * cm, L = art.laengeCm * cm, rnd = vfZufall(9001 + pts.length);
    const reihen = [];
    let stuecke = 0;
    if (art.art === 'fischgraet') {
      const r = Math.SQRT1_2, d1 = [r, r], d2 = [-r, r];
      const W = (A, Bb) => [A * d1[0] + Bb * d2[0], A * d1[1] + Bb * d2[1]];
      // Rahmen-Koordinaten der Bodenecken: A = (x + z) r, B = (z - x) r
      const ecken = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [(x + z) * r, (z - x) * r]);
      const aMin = Math.min(...ecken.map((e) => e[0])) - L, aMax = Math.max(...ecken.map((e) => e[0])) + L;
      const bMin = Math.min(...ecken.map((e) => e[1])) - L, bMax = Math.max(...ecken.map((e) => e[1])) + L;
      const iMin = Math.floor((aMin + bMin) / (2 * B)), iMax = Math.ceil((aMax + bMax) / (2 * B));
      const jMin = Math.floor((aMin - bMax) / (2 * L)), jMax = Math.ceil((aMax - bMin) / (2 * L));
      const drin = (o, e, q) => { const cx = o[0] + (e[0] * L + q[0] * B) / 2, cz = o[1] + (e[1] * L + q[1] * B) / 2; return cx > x0 - L / 2 && cx < x1 + L / 2 && cz > z0 - L / 2 && cz < z1 + L / 2; };
      for (let j = jMin; j <= jMax; j++) {
        for (let i = iMin; i <= iMax; i++) {
          const oa = i * B + j * L, ob = i * B - j * L;
          const oA = W(oa, ob), oB = W(oa + L, ob + B - L);
          if (drin(oA, d1, d2)) { vfBodenStueck(a, T, rnd, oA, d1, L, d2, B, y); stuecke++; }
          if (drin(oB, d2, d1)) { vfBodenStueck(a, T, rnd, oB, d2, L, d1, B, y); stuecke++; }
        }
      }
    } else {
      let vorher = null;
      for (let z = z0; z < z1; z += B) {
        let ver = rnd() * L;
        for (let k = 0; k < 12 && vorher !== null; k++) {
          const dd = Math.abs(ver - vorher) % L;
          if (Math.min(dd, L - dd) >= L * 0.25) break;
          ver = rnd() * L;
        }
        reihen.push(ver);
        vorher = ver;
        for (let x = x0 - ver; x < x1; x += L) { vfBodenStueck(a, T, rnd, [x, z], [1, 0], L, [0, 1], B, y); stuecke++; }
      }
    }
    // Weite Flaeche ausserhalb der Dielen: vier Streifen bis VF_BODEN_WEIT, Farbe = Mittelwert ueber
    // das Texel (0,0) (konstante Koordinate = immer genau dieses Texel, Alpha dort = mittlerer Glanz).
    const F = VF_BODEN_WEIT, uv = [0.5 / T.w, 0.5 / T.h], c = T.ferne.map((x) => x * VF_BODEN_HELL);
    const streifen = (xa, za, xb, zb) => vfViereck(a, [xa, y, za, uv[0], uv[1]], [xb, y, za, uv[0], uv[1]], [xb, y, zb, uv[0], uv[1]], [xa, y, zb, uv[0], uv[1]], c);
    const xa = x0 - L, xb = x1 + L, za = z0 - L, zb = z1 + L;
    streifen(xa - F, za - F, xb + F, za); streifen(xa - F, zb, xb + F, zb + F);
    streifen(xa - F, za, xa, zb); streifen(xb, za, xb + F, zb);
    return { daten: a, stuecke, reihen, breite: B, laenge: L };
  }
  function vfPufferF(gl, a) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW);
    return { b, n: a.length / 8 };
  }
  // Alles fuer die Flaechen einer Fahrt: Programm, drei Texturen, drei Puffer. Einmal beim Start.
  function vfFlaechenBauen(gl, pts, nrm, tiles) {
    const prog = vfProgrammFlaeche(gl);
    const art = vfBodenArt(vfBodenWahl());
    const TB = vfBodenTexturDaten(art.id);
    const bahn = vfBahnGeometrie(pts, nrm, tiles), boden = vfBodenGeometrie(pts, TB, art);
    return {
      prog, art, pv: new Float32Array(16),
      txBahn: vfTexturHoch(gl, vfBahnTexturDaten(), false, 1, false), txRand: vfTexturHoch(gl, vfRandTexturDaten(), true, 2, true),
      txBoden: vfTexturHoch(gl, TB, false, 2, false),
      strasse: vfPufferF(gl, bahn.strasse), rand: vfPufferF(gl, bahn.rand), boden: vfPufferF(gl, boden.daten),
    };
  }
  // Je Bild: Boden (ohne Tiefe schreiben, liegt unter allem), Fahrbahn, Randsteine. Keine Allokation.
  function vfFlaechenMalen(gl, pv, auge) {
    const F = VF.flaeche;
    if (!F) return;
    const P = F.prog, u = P.u;
    gl.useProgram(P.p);
    for (let i = 0; i < 16; i++) F.pv[i] = pv[i];
    gl.uniformMatrix4fv(u.m, false, F.pv);
    gl.uniform3f(u.auge, auge[0], auge[1], auge[2]);
    gl.uniform3f(u.nebel, 0.66, 0.78, 0.90);
    gl.uniform1i(u.tx, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enableVertexAttribArray(P.ap); gl.enableVertexAttribArray(P.auv); gl.enableVertexAttribArray(P.ac);
    const zeichne = (pu, tx, glanz) => {
      gl.uniform1f(u.glanz, glanz);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
      gl.vertexAttribPointer(P.ap, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(P.auv, 2, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(P.ac, 3, gl.FLOAT, false, 32, 20);
      gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    };
    // Erst Fahrbahn und Randsteine (schreiben Tiefe), dann der Boden: seine Pixel unter der Bahn fallen
    // im Tiefentest weg, bevor sie gerechnet werden. Damit er nirgends durch die Bahn schimmert (auch
    // nicht bei 16-Bit-Tiefe), liegt er 0,5 mm tiefer UND wird per polygonOffset nach hinten geschoben;
    // er schreibt selbst keine Tiefe.
    zeichne(F.strasse, F.txBahn, 0.16);
    zeichne(F.rand, F.txRand, 0.10);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 16);
    zeichne(F.boden, F.txBoden, F.art.glanz);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disableVertexAttribArray(P.ap); gl.disableVertexAttribArray(P.auv); gl.disableVertexAttribArray(P.ac);
  }
  // Das Auto: Unterbau, Kabine, vier Raeder, um den Ursprung, vorn = +z.
  function vfAutoBauen(gl, farbe) {
    const a = [];
    const box = (x0, x1, y0, y1, z0, z1, f) => {
      const s = (k) => [f[0] * k, f[1] * k, f[2] * k];
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const fl = [[4, 5, 6, 7, 1.0], [1, 0, 3, 2, 0.55], [0, 4, 7, 3, 0.75], [5, 1, 2, 6, 0.75], [3, 7, 6, 2, 1.15], [0, 1, 5, 4, 0.4]];
      fl.forEach(([p, q, r, u, k]) => [p, q, r, p, r, u].forEach((i) => a.push(v[i][0], v[i][1], v[i][2], ...s(k))));
    };
    const L = VF_AUTO.L, B = VF_AUTO.B, H = VF_AUTO.H;
    box(-B / 2, B / 2, 0.6, H * 0.75, -L / 2, L / 2, farbe);
    box(-B * 0.36, B * 0.36, H * 0.75, H * 1.25, -L * 0.22, L * 0.15, [0.10, 0.12, 0.16]);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
      box(sx * B / 2 - 0.5, sx * B / 2 + 0.5, 0, 1.6, sz * L * 0.32 - 1.0, sz * L * 0.32 + 1.0, [0.05, 0.05, 0.06]));
    return vfPuffer(gl, a);
  }
  // Matrizen (spaltenweise, wie WebGL sie will).
  function vfPerspektive(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0];
  }
  function vfBlick(e, z, u) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const kreuz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const f = norm(sub(z, e)), s = norm(kreuz(f, u)), v = kreuz(s, f);
    return [s[0], v[0], -f[0], 0, s[1], v[1], -f[1], 0, s[2], v[2], -f[2], 0,
            -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]), -(v[0] * e[0] + v[1] * e[1] + v[2] * e[2]), f[0] * e[0] + f[1] * e[1] + f[2] * e[2], 1];
  }
  function vfMal(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  // Weltlage des Autos: Drehung um y, sodass lokal +z in Fahrtrichtung (sin h, -cos h) zeigt.
  function vfLage(x, y, h) {
    const th = Math.PI - h * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, y, 1];
  }
  const VF_EINS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  // ---- Fahren (rein, fuer den Selbsttest ohne Bild) -------------------------------------------
  // Ein Schritt: Tempo (ECHTE km/h des Modellautos, wie physEngine.state.speedKmh - die Anzeige ist
  // das mal REAL_SCALE), Lenkbefehl (-1..1), dt (s). Liefert die neue Lage.
  // v1.1.3 GEMELDET: "Die Tasten funktionieren, aber das Auto bewegt sich nicht." Hier stand zusaetzlich
  // "/ REAL_SCALE" - das Auto fuhr 74-mal zu langsam und schien zu stehen.
  function vfSchritt(lage, kmh, lenk, dt, grip) {
    const v = Math.abs(kmh) / 3.6 * 100 * TRACK_UNITS_PER_CM * Math.sign(kmh || 1);   // Einheiten/s
    const delta = Math.max(-1, Math.min(1, lenk)) * VF_RAD_GRAD * Math.PI / 180;
    let w = Math.abs(v) > 1e-6 ? v * Math.tan(delta) / VF_ACHSE : 0;               // rad/s (Einspurmodell)
    const aMax = VF_MU * (grip === undefined ? 1 : grip) * 9.81 * 100 * TRACK_UNITS_PER_CM;   // Einheiten/s^2
    const wMax = Math.abs(v) > 1 ? aMax / Math.abs(v) : Infinity;                 // Haftgrenze
    w = Math.max(-wMax, Math.min(wMax, w));
    const h = lage.h + w * dt * 180 / Math.PI;
    const r = h * Math.PI / 180;
    return { x: lage.x + Math.sin(r) * v * dt, y: lage.y - Math.cos(r) * v * dt, h, w };
  }
  // ---- FAHRMODELL WIE IN ACC (v1.1.3) --------------------------------------------------------
  // BESTELLT: "besseres Handling (eher wie Assetto Corsa Competizione)". Ein dynamisches Einspurmodell
  // eines GT3 in Originalgroesse - die Physik der App rechnet ohnehin in GT3-Tempo (Anzeige = echtes
  // Tempo mal REAL_SCALE), und die Gierrate ist bei massstabsgleicher Verkleinerung dieselbe, also
  // laeuft das Modell in Originalgroesse und nur der Weg wird verkleinert.
  //   Reifen: Pacejka Fy = D sin(C atan(B a)), D aus Reibwert mal Radlast
  //   Radlast: statisch plus Laengsverlagerung m * ax * h / L (Bremsen belastet vorn, Gas hinten)
  //   Reibkreis: Antrieb nimmt hinten Seitenkraft, Bremsen vorn (75 %) und hinten (25 %); ABS und
  //   Traktionskontrolle lassen jeweils einen Rest. Hinten mehr Griff (breitere Reifen, Abtrieb), so
  //   bleibt das Auto am Limit leicht untersteuernd, wie ein GT3 ab Werk.
  // Daraus folgen von selbst: Untersteuern am Kurveneingang mit zu viel Tempo, Trail-Braking (leicht
  // bremsen dreht das Auto ein), Uebersteuern unter Vollgas am Ausgang, Gegenlenken faengt es.
  // Unter 3 m/s rein kinematisch (kein Rutschen im Stand).
  const VF_GT3 = { m: 1300, Iz: 2300, a: 1.20, b: 1.50, h: 0.38, muV: 1.60, muH: 2.05, BV: 9.0, BH: 11.0, C: 1.35,
                   lenkGrad: 16, bremsVorn: 0.75, antriebMax: 7.0, tc: 0.60, abs: 0.80, lastEmpf: 0.15, yawDamp: 1.5 };
  // z: { vy (m/s, rechts +), r (rad/s, rechts +) }, vx (m/s), ax (m/s^2 Laengsbeschleunigung, aus der
  // Laengs-G der App), antrieb (0..1 Gasanteil), lenk (-1..1), mu (Griff-Faktor).
  // P: Fahrprofil (VF_GT3 oder vfPhysikAus() eines Autos). kV/kH: Abtrieb je Achse in N je (m/s)^2.
  function vfDynamik(z, vx, ax, antrieb, lenk, dt, mu, P) {
    P = P || VF_GT3;
    const g = 9.81, L = P.a + P.b;
    const delta = Math.max(-1, Math.min(1, lenk)) * P.lenkGrad * Math.PI / 180;
    if (vx < 3) {
      z.vy = 0; z.r = vx * Math.tan(delta) / L; z.aV = 0; z.aH = 0;
      return z;
    }
    const f = mu === undefined ? 1 : mu;
    const dFz = P.m * Math.max(-12, Math.min(8, ax)) * P.h / L;
    // Abtrieb waechst mit dem Quadrat des Tempos (gedeckelt bei 90 m/s).
    const va = Math.min(vx, 90) * Math.min(vx, 90);
    // Lastempfindlichkeit: der Reibwert sinkt mit der Radlast. Das haelt ein Auto unter Last
    // gutmuetig, weil die entlastete Achse relativ mehr Griff behaelt.
    const fz0V = P.m * g * P.b / L, fz0H = P.m * g * P.a / L;
    const fzV = Math.max(800, fz0V - dFz + (P.kV || 0) * va), fzH = Math.max(800, fz0H + dFz + (P.kH || 0) * va);
    const maxV = P.muV * f * fzV * (1 - P.lastEmpf * (fzV / fz0V - 1));
    const maxH = P.muH * f * fzH * (1 - P.lastEmpf * (fzH / fz0H - 1));
    const brems = ax < 0 ? P.m * -ax : 0;
    // ABS und Traktionskontrolle wie im GT3: beide lassen dem Reifen einen Rest Seitenkraft.
    const fxV = Math.min(P.abs * maxV, P.bremsVorn * brems);
    const fxH = Math.min((ax < 0 ? P.abs : P.tc) * maxH,
      ax < 0 ? (1 - P.bremsVorn) * brems : Math.max(0, antrieb) * P.m * P.antriebMax);
    const dV = Math.sqrt(maxV * maxV - fxV * fxV), dH = Math.sqrt(maxH * maxH - fxH * fxH);
    const schritte = Math.max(1, Math.ceil(dt / 0.002));
    const h = dt / schritte;
    for (let i = 0; i < schritte; i++) {
      const aV = Math.atan2(z.vy + P.a * z.r, vx) - delta;
      const aH = Math.atan2(z.vy - P.b * z.r, vx);
      const fyV = -dV * Math.sin(P.C * Math.atan(P.BV * aV));
      const fyH = -dH * Math.sin(P.C * Math.atan(P.BH * aH));
      z.vy += h * ((fyV * Math.cos(delta) + fyH) / P.m - vx * z.r);
      z.r += h * ((P.a * fyV * Math.cos(delta) - P.b * fyH) / P.Iz - (P.yawDamp || 0) * z.r);
      z.aV = aV; z.aH = aH;
    }
    z.vy = Math.max(-vx, Math.min(vx, z.vy));
    z.r = Math.max(-5, Math.min(5, z.r));
    return z;
  }
  // ---- DAS AUTO AUS SPEED DREAMS (v1.1.9) ------------------------------------------------------
  // BESTELLT: "Baue das v5r Auto aus Speeddreams ein. Das Auto soll auch Lichter und Bremslichter haben
  // und sich beim Lenken, Gas geben und Bremsen entsprechend verhalten durch Neigung ueber simulierte
  // Stossdaempfer." Der Vulture V5R (ls1-vulture-v5r, GPL-2+), umgewandelt mit tools/sd_auto.py nach
  // img/autos/v5r/: Modell ohne Innenraum, Rad, Lichtorte und die Fahrzeugdaten aus der .xml. Laengen in
  // Metern, im Auto +x links, +y oben, +z vorn; gezeichnet mal VF_AUTO.L / Laenge (so lang wie der Kasten).
  const VF_AUTO_STORE = 'omegasim-vf-auto';
  const VF_MODELL_PFADE = { v5r: 'img/autos/v5r/', lynx220: 'img/autos/lynx220/', fmcgt4: 'img/autos/fmcgt4/', boxer96: 'img/autos/boxer96/' };
  function vfModellPfad(auto) { return VF_MODELL_PFADE[auto || vfAutoWahl()] || 'img/autos/v5r/'; }
  const VF_FEDER_STORE = 'omegasim-vf-feder';
  const VF_FEDER_WERTE = [1, 2, 3, 5, 8];
  function vfAutoWahl() {
    try { const v = localStorage.getItem(VF_AUTO_STORE); return (v === 'v5r' || v === 'lynx220' || v === 'fmcgt4' || v === 'boxer96' || v === 'kasten') ? v : 'v5r'; } catch (e) { return 'v5r'; }
  }
  // Schaltung (Automatik/Manuell) fuer die virtuelle Fahrt. Manuell schaltet der Fahrer mit I/K.
  const VF_SCHALTUNG_STORE = 'omegasim-vf-schaltung';
  function vfSchaltungAuto() { try { return localStorage.getItem(VF_SCHALTUNG_STORE) !== 'manuell'; } catch (e) { return true; } }
  // Geist: eine Kopie des Autos, die nach der ersten Runde die aufgezeichnete Linie abfaehrt.
  const VF_GEIST_STORE = 'omegasim-vf-geist';
  function vfGeistAn() { try { return localStorage.getItem(VF_GEIST_STORE) !== 'aus'; } catch (e) { return true; } }
  // Die echte Neigung eines GT1 ist klein (0,5 Grad Rollen bei 1,5 g) und bei Modellgroesse unsichtbar.
  // Der Faktor vergroessert nur den AUSSCHLAG; Federraten, Daempfer und Zeitverhalten bleiben die echten.
  function vfFederSicht() {
    try { const v = +localStorage.getItem(VF_FEDER_STORE); return VF_FEDER_WERTE.indexOf(v) >= 0 ? v : 1; } catch (e) { return 1; }
  }
  // NPCs im virtuellen Fahren (v1.1.46): wie viele andere Autos mitfahren (0-3), und ihre Skins werden
  // zufaellig ohne Zuruecklegen aus den echten Modellen gezogen - nie der weisse Kasten. Sie folgen der
  // Mittellinie mit leichtem Querversatz und drosseln ihr Tempo nach der Kurvigkeit voraus.
  // Seit v1.2.32 mit dem Tempo der Garagenstufe 1 und einem eigenen Fahrzeugmodell (siehe unten).
  const VF_NPC_STORE = 'omegasim-vf-npc';
  const VF_NPC_POOL = ['v5r', 'fmcgt4', 'boxer96', 'lynx220'];
  // v1.2.32 GEMELDET: "Die NPCs sind außerdem zu schnell und haben eine starke Neigung (sollte
  // auf Stufe 1 sein)." Gemessen auf Balkonia (1.2.31, 8 s Fahrt, drei NPCs):
  //   - Geradentempo 3,2 Modell-km/h (VF_NPC_BASE), mal 1,03 bis 3,3. Das ist 80 % Gas, mehr als
  //     die Garagenstufe "schnell" (65 %); Stufe 1 (mittel) ist ghostCfg.speed = 55 % und damit
  //     0,55 x 4 = 2,2 km/h (die Gegenprobe aus 90b-sim.js: halbes Gas rund 55 cm/s).
  //   - Beschleunigung 2,5 und Bremsen 6,0 km/h je s fest. Das eigene Auto (dasselbe Fahrzeugmodell)
  //     braucht mit Vollgas 5,7 s von 0 auf 2,2 km/h (im Mittel 0,4 km/h je s) und verzoegert voll
  //     gebremst mit 1,0 km/h je s: die NPCs zogen am Kurvenausgang sechsmal so schnell davon.
  //   - In der Kurve 2,1 km/h: auf einem Radius von 34 Einheiten sind das 6,9 g Querbeschleunigung
  //     im GT3-Mass. Das eigene Auto schafft mit dem Reifenmodell (vfDynamik, VF_GT3) 1,3 bis 1,5 g.
  //   - Die Querbeschleunigung fuer die Federung kam aus dem Sprung der Fahrtrichtung zwischen zwei
  //     Mittellinienpunkten durch dt: 0 in einem Bild, bis 225 m/s^2 (23 g) im naechsten. Daraus
  //     rollte der Aufbau bis 0,59 rad (34 Grad) - die "starke Neigung". Das eigene Auto rollt bei
  //     1,5 g um 0,5 Grad (siehe vfFederSicht).
  // Jetzt: Garagenstufe 1 als Geradentempo, Gas und Bremse ueber ein eigenes, stummes Fahrzeugmodell
  // wie beim eigenen Auto, Kurventempo aus der Kruemmung mit hoechstens VF_NPC_QUER_MAX, und die
  // Querbeschleunigung aus derselben Kruemmung (stetig, ohne Spruenge). Die Neigung zeichnet weiter
  // mit 1x (nicht mit "Neigung sichtbar" des eigenen Autos).
  const VF_NPC_STUFE = 1;          // Garagenstufe (GHOST_TEMPO_STUFEN): 1 = mittel, wie ein neuer NPC
  const VF_NPC_QUER_MAX = 13.0;    // m/s^2 im GT3-Mass (1,3 g): knapp unter dem eigenen Auto (gemessen 13,1-14,7)
  const VF_NPC_BREMS = 0.8;        // Modell-km/h je s fuer die Bremspunkte: 80 % der gemessenen Vollbremsung
  // So weit (s) voraus liest der NPC sein Zieltempo: die Bremse wirkt verhaeltnisgleich zum Fehlbetrag,
  // also traf er mit 0,3 s zu spaet ein (gemessen 15,6 m/s^2 statt 13 am Kurveneingang).
  const VF_NPC_VORAUS_S = 0.5;
  function vfNpcAnzahl() {
    try { const v = +localStorage.getItem(VF_NPC_STORE); return (v >= 0 && v <= 3) ? v : 3; } catch (e) { return 3; }
  }
  // Handling-Modus (v1.1.52): das Fahrmodell wie in ACC, und eine zweite, insgesamt schnellere
  // Abstimmung. "GT3" bleibt das praezise Modell aus den Autodaten; "Schnell" gibt mehr Grip
  // (muV/muH), mehr Einschlag (lenkGrad), eine schnellere Gierantwort (weniger Daempfung) und ein
  // hoeheres Tempo (Weg und Tacho, Faktor vfTempoFaktor).
  const VF_HANDLING_STORE = 'omegasim-vf-handling';
  // v1.3.5: 'gran' heisst Gran Hybrismo (wie Gran Turismo Sport), neu 'acc' Assetto Carrera (wie
  // ACC). Die Kennung 'gran' bleibt, damit eine gespeicherte Wahl weiter gilt.
  const VF_HANDLING_MODI = [{ id: 'gt3', name: 'GT3' }, { id: 'schnell', name: 'Schnell' },
                            { id: 'gran', name: 'Gran Hybrismo' }, { id: 'acc', name: 'Assetto Carrera' }];
  // Abtrieb fuer Profile ohne eigene Werte (VF_GT3 hat kein kV/kH): N je (m/s)^2 je Achse, etwa
  // 19 % des Gewichts bei 216 km/h. Bis 1.3.4 rechnete Gran mit (P.kV || 0) * 1,5 - beim
  // Standardauto also mit null Abtrieb.
  const VF_ABTRIEB_GRUND = { kV: 0.28, kH: 0.40 };
  // BESTELLT: Latenz. Korrektur nach 1.2.66: vfHandling() wird je Bild gefragt (vfSchritt,
  // Gran-Modus) - localStorage.getItem ist ein synchroner Speicherzugriff und auf schwachen
  // Handys je Bild spuerbar. Gelesen wird einmal (und neu beim Start einer Fahrt), geschrieben
  // nur ueber vfHandlingSetzen(), das den Zwischenspeicher mitzieht.
  let vfHandlingCache = null;
  function vfHandling() {
    if (vfHandlingCache === null) {
      let v = null;
      try { v = localStorage.getItem(VF_HANDLING_STORE); } catch (e) { /* privat */ }
      vfHandlingCache = VF_HANDLING_MODI.some((m) => m.id === v) ? v : 'gt3';
    }
    return vfHandlingCache;
  }
  function vfHandlingSetzen(id) {
    try { localStorage.setItem(VF_HANDLING_STORE, id); } catch (e) { /* privat */ }
    vfHandlingCache = null;
  }
  function vfHandlingName(id) { const m = VF_HANDLING_MODI.find((x) => x.id === id); return m ? t(m.name) : t('GT3'); }
  function vfTempoFaktor() { return vfHandling() === 'schnell' ? 1.15 : 1.0; }
  // Bogenlaengen der Mittellinie (geschlossene Schleife): bogen[i] = Laenge bis Punkt i, bogen[n] = Runde.
  function vfNpcBogen(pts) {
    const bogen = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      bogen[i] = bogen[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    return { bogen, runde: bogen[pts.length] };
  }
  // Geradentempo der Garagenstufe in Modell-km/h: dieselbe Rechnung wie ghostStufeFaktor() fuer ein
  // echtes NPC-Auto (Stufe relativ zur Vorgabe ghostCfg.speed), als Anteil des Vollgastempos.
  function vfNpcStufenTempo(stufe) {
    const st = typeof GHOST_TEMPO_STUFEN !== 'undefined' ? GHOST_TEMPO_STUFEN[stufe === undefined ? VF_NPC_STUFE : stufe] : null;
    const basis = (typeof ghostCfg !== 'undefined' && ghostCfg.speed) || 0.55;
    const anteil = st && !st.max ? st.speed / 0.55 * basis : basis;
    const top = (physEngine && physEngine.config && physEngine.config.topSpeedKmh) || 4;
    return Math.max(0.2, Math.min(1, anteil)) * top;
  }
  // Das Fahrzeugmodell eines NPC: eine eigene, stumme Instanz wie in startGhost() (90-ghosts.js) und
  // 61-simlinie.js - die Abstimmung des eigenen Autos, aber Automatik, ohne Boxenlimiter, ohne Tank-
  // und Reifeneinfluss, trocken, ohne Meldungen, Ruckeln und Schaltton.
  function vfNpcMotor() {
    const e = new CarreraPhysicsEngine();
    Object.assign(e.config, physEngine.config);
    e.config.gears = physEngine.config.gears;
    Object.assign(e.config, { autoShift: true, speedLimitFactor: 1, fuelWeightEffect: 0, tyreEffect: 0, gripScale: 1, aquaplaning: 0 });
    e.spieler = 9;
    e.meldung = () => {}; e.ruck = () => {}; e.schaltTon = () => {};
    if (typeof e.calibrateAccel === 'function') e.calibrateAccel();
    e.state.driveMode = 'forward';
    e.state.currentGear = 0;
    return e;
  }
  // Kruemmung einer geschlossenen Linie je Punkt (rad je Einheit, + = rechts), gemessen zwischen den
  // Sehnen ueber 3 Punkte davor und danach. Von Punkt zu Punkt gemessen gab es auf Balkonia an der
  // Schliessstelle einen Knick mit Radius 3 (Bahnradien sonst 17, 34, 56, 73): dort haette der NPC fast
  // angehalten. Ueber sechs Punkte bleibt ein Kreisbogen exakt, ein Knick wird geglaettet.
  function vfNpcKruemmung(pts) {
    const n = pts.length, W = 3, k = new Array(n);
    const dir = (a, b) => Math.atan2(b.x - a.x, -(b.y - a.y));
    for (let i = 0; i < n; i++) {
      const a = pts[(i - W + n) % n], p = pts[i], b = pts[(i + W) % n];
      let d = dir(p, b) - dir(a, p);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const s = Math.hypot(p.x - a.x, p.y - a.y) + Math.hypot(b.x - p.x, b.y - p.y);
      k[i] = s > 1e-6 ? d / (s / 2) : 0;
    }
    return k;
  }
  // Die Fahrspur eines NPC: die Mittellinie um seinen Querversatz verschoben, mit eigener Bogenlaenge,
  // Kruemmung und erlaubtem Tempo je Punkt. Eigene Spur statt Mittellinie, weil auf der Innenbahn der
  // Radius kleiner ist (Haarnadel 17 Einheiten, Versatz 3: 18 % mehr Querbeschleunigung).
  //   Kurve:  a_quer = v_GT3 * Gierrate = REAL_SCALE * v^2 * k (v in Modell-m/s, k in 1/m Modell)
  //           also v_E^2 = VF_NPC_QUER_MAX * 100 * TRACK_UNITS_PER_CM / (REAL_SCALE * k)   (Einheiten/s)
  //   Bremse: rueckwaerts um die Runde (zweimal, wegen Start/Ziel) v_i^2 <= v_(i+1)^2 + 2 * a * ds
  function vfNpcBahn(npc, pts, nrm) {
    if (npc.bahn && npc.bahn.quelle === pts && npc.bahn.offset === npc.offset) return npc.bahn;
    const n = pts.length, q = npc.offset || 0;
    const lauf = pts.map((p, i) => ({ x: p.x + nrm[i].x * q, y: p.y + nrm[i].y * q }));
    // Die Schliessstelle: auf Balkonia liegt der letzte Punkt der Mittellinie 0,44 Einheiten vor dem
    // ersten (sonst 2,4 bis 2,9 Einheiten Abstand) und nicht genau auf der Linie. Dort sprang die
    // Fahrtrichtung um 4,9 Grad in einem Bild. Ein Punkt mit so kurzem Nachbarabschnitt kommt auf die
    // Mitte seiner Nachbarn.
    const ds = (i) => { const a = lauf[i], b = lauf[(i + 1) % n]; return Math.hypot(b.x - a.x, b.y - a.y); };
    const median = lauf.map((_, i) => ds(i)).sort((x, y) => x - y)[n >> 1];
    for (let i = 0; i < n; i++) {
      if (Math.min(ds(i), ds((i - 1 + n) % n)) < median * 0.35) {
        const a = lauf[(i - 1 + n) % n], b = lauf[(i + 1) % n];
        lauf[i] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
    const bogen = vfNpcBogen(lauf);
    const kr = vfNpcKruemmung(lauf);
    const K = 100 * TRACK_UNITS_PER_CM / 3.6;                // Modell-km/h -> Einheiten je s
    const vGerade = vfNpcStufenTempo();
    const v = kr.map((k) => {
      const a = Math.abs(k);
      return a > 1e-6 ? Math.min(vGerade, Math.sqrt(VF_NPC_QUER_MAX * 100 * TRACK_UNITS_PER_CM / (REAL_SCALE * a)) / K) : vGerade;
    });
    const aB = VF_NPC_BREMS * K;
    for (let r = 2 * n - 1; r >= 0; r--) {
      const i = r % n, j = (i + 1) % n;
      const uj = v[j] * K, ds = bogen.bogen[i + 1] - bogen.bogen[i];
      const vi = Math.sqrt(uj * uj + 2 * aB * ds) / K;
      if (vi < v[i]) v[i] = vi;
    }
    npc.bahn = { quelle: pts, offset: npc.offset, lauf, bogen: bogen.bogen, runde: bogen.runde, kr, v, vGerade };
    return npc.bahn;
  }
  // Punkt auf der Spur bei Bogenlaenge s (gewickelt), Suche ab Punkt j0.
  function vfNpcPunkt(B, s, j0) {
    const n = B.lauf.length;
    s = ((s % B.runde) + B.runde) % B.runde;
    let j = Math.max(0, Math.min(n - 1, j0 || 0));
    while (j < n - 1 && B.bogen[j + 1] <= s) j++;
    while (j > 0 && B.bogen[j] > s) j--;
    const f = Math.max(0, Math.min(1, (s - B.bogen[j]) / Math.max(1e-9, B.bogen[j + 1] - B.bogen[j])));
    const p = B.lauf[j], q = B.lauf[(j + 1) % n];
    return { j, f, x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
  }
  // Ein NPC-Schritt (rein, fuer den Selbsttest): Zieltempo aus der Spur ein Stueck voraus, Gas und
  // Bremse wie in 61-simlinie.js auf das eigene Fahrzeugmodell, dann auf der Spur weiter. Liefert die
  // neue Lage und die Groessen zum Zeichnen (Querbeschleunigung ay und Laengsbeschleunigung ax in m/s^2
  // im GT3-Mass, wie beim eigenen Auto VF.ay/VF.ax). Die frueheren Argumente bogen/runde (Mittellinie)
  // werden nicht mehr gebraucht: jeder NPC rechnet auf seiner eigenen Spur.
  function vfNpcSteuern(npc, dt, pts, nrm) {
    const B = vfNpcBahn(npc, pts, nrm);
    const n = pts.length, K = 100 * TRACK_UNITS_PER_CM / 3.6;
    if (npc.s === undefined || npc.s === null || !isFinite(npc.s)) npc.s = B.bogen[npc.idx || 0];
    let weg = 0;                                         // Einheiten in diesem Schritt
    if (dt > 0) {
      if (!npc.motor) {
        npc.motor = vfNpcMotor();
        // Ein NPC, der schon faehrt (Selbsttest), behaelt sein Tempo. Nur speedKmh zu setzen reicht
        // nicht: Gang und Drehzahl stuenden noch im Stand, und der erste Gang bremste den Motor in
        // 0,5 s von 2,2 auf 1,7 km/h. Also mit Vollgas bis dorthin hochfahren (hoechstens 15 s).
        if (npc.kmh > 0) {
          for (let i = 0; i < 300 && npc.motor.state.speedKmh < npc.kmh; i++) npc.motor.update({ throttle: 1, brake: 0, steering: 0, headlights: false }, 0.05);
          npc.motor.state.speedKmh = npc.kmh;
        }
      }
      const e = npc.motor;
      const top = e.config.topSpeedKmh || 4;
      // In Teilschritten von hoechstens 50 ms wie vfBild: ein grosser Schritt (Selbsttest 0,5 s) liess
      // das Modell mit Gas 0 in einem Zug von 2,2 auf 1,69 km/h fallen.
      const teile = Math.max(1, Math.ceil(dt / 0.05)), h = dt / teile;
      for (let t = 0; t < teile; t++) {
        const v = Math.max(0, e.state.speedKmh || 0);
        const voraus = vfNpcPunkt(B, npc.s + v * K * VF_NPC_VORAUS_S, npc.idx);
        const ziel = Math.min(B.v[npc.idx], B.v[voraus.j]) * (npc.faktor || 1);
        const fehl = ziel - v;
        const throttle = fehl > 0 ? Math.min(1, fehl / (top * 0.06)) : 0;
        const brake = fehl < -top * 0.01 ? Math.min(1, -fehl / (top * 0.05)) : 0;
        e.update({ throttle, brake, steering: 0, headlights: false }, h);
        const d = Math.max(0, e.state.speedKmh || 0) * K * h;
        npc.s = (((npc.s + d) % B.runde) + B.runde) % B.runde;
        weg += d;
      }
      npc.kmh = Math.max(0, e.state.speedKmh || 0);
      npc.ax = (e.state.gLong || 0) * 15;              // wie das eigene Auto (vfBild)
    } else {
      npc.ax = 0;
    }
    const vE = npc.kmh * K;
    const hier = vfNpcPunkt(B, npc.s, npc.idx);
    npc.idx = hier.j;
    npc.x = hier.x; npc.y = hier.y;
    // Fahrtrichtung aus der Spur 1,5 Einheiten davor und dahinter: stetig, statt von Punkt zu Punkt
    // um bis zu 6 Grad zu springen.
    const a = vfNpcPunkt(B, npc.s - 1.5, hier.j), b = vfNpcPunkt(B, npc.s + 1.5, hier.j);
    npc.h = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
    npc.raddreh = ((npc.raddreh || 0) + weg / (VF_AUTO.L / 4.64 * 0.335)) % (Math.PI * 2);
    // Querbeschleunigung aus der Kruemmung, zwischen zwei Punkten eingeblendet: Gierrate = k * v_E.
    const k = B.kr[hier.j] + (B.kr[(hier.j + 1) % n] - B.kr[hier.j]) * hier.f;
    npc.ay = npc.kmh * REAL_SCALE / 3.6 * k * vE;
    // Vorderraeder: Einschlag des Einspurmodells, delta = atan(Radstand * k), Radstand des Modells
    // in Streckeneinheiten (Laenge wie gezeichnet, VF_AUTO.L).
    const d = npc.modell && npc.modell.d;
    const achse = d ? (d.a + d.b) * VF_AUTO.L / d.laenge : VF_ACHSE;
    const grenze = (npc.P ? npc.P.lenkGrad : 21) * Math.PI / 180;
    npc.lenkWinkel = Math.max(-grenze, Math.min(grenze, Math.atan(achse * k)));
    return npc;
  }
  // NPCs anlegen: Anzahl aus der Garage, Skins zufaellig ohne Zuruecklegen aus den echten Modellen.
  function vfNpcStarten(gl, start) {
    const nAnzahl = vfNpcAnzahl();
    VF.npcs = [];
    if (nAnzahl <= 0 || !VF.tprog) return;
    const pool = VF_NPC_POOL.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const bogen = vfNpcBogen(VF.pts);
    VF.npcBogen = bogen.bogen; VF.npcRunde = bogen.runde;
    const n = VF.pts.length;
    for (let k = 0; k < nAnzahl; k++) {
      const auto = pool[k];
      const startIdx = (start + Math.floor(n * (k + 1) / (nAnzahl + 1))) % n;
      const npc = {
        auto, modell: null, P: null, idx: startIdx, s: null, kmh: 0, motor: vfNpcMotor(), bahn: null,
        offset: [3.0, -3.0, 0.0][k] || 0,
        faktor: 0.97 + 0.03 * k,
        x: 0, y: 0, h: 0, raddreh: 0, lenkWinkel: 0, ay: 0, ax: 0,
        feder: { z: 0, vz: 0, th: 0, vth: 0, ph: 0, vph: 0 },
      };
      vfNpcSteuern(npc, 0, VF.pts, VF.nrm);
      VF.npcs.push(npc);
      vfModellDaten(VF_MODELL_PFADE[auto]).then((daten) => {
        if (!VF.aktiv || VF.gl !== gl) return;
        npc.modell = vfModellBauen(gl, daten, VF_MODELL_PFADE[auto]);
        npc.P = vfHandlingProfil(vfPhysikAus(daten.meta.physik));
      }).catch(() => { /* NPC ohne Modell bleibt unsichtbar */ });
    }
  }
  // Fahrprofil fuer vfDynamik aus den Daten der .xml. Die Reibwerte von Speed Dreams sind ohne den dortigen
  // Reifentemperatur-Zuschlag gerechnet: mal 1,3 vorn, hinten wie beim GT3 abgestimmt 28 % mehr (breitere
  // Reifen, Abtrieb hinten). Abtrieb in N je (m/s)^2 aus Auftriebsbeiwert plus Fluegel, je Achse.
  function vfPhysikAus(d) {
    const mu = (d.reifen && d.reifen.vorn ? d.reifen.vorn.mu : 1.2) * 1.3;
    return Object.assign({}, VF_GT3, {
      m: d.masse, Iz: d.masse * (d.laenge * d.laenge + d.breite * d.breite) / 12 * (d.massenVerteilung || 0.85),
      a: d.a, b: d.b, h: d.schwerpunktHoehe, muV: mu, muH: mu * 1.28, lenkGrad: d.lenkGrad, bremsVorn: d.bremsVorn,
      kV: 0.5 * 1.23 * ((d.auftriebVorn || 0) + (d.fluegelVorn || 0)), kH: 0.5 * 1.23 * ((d.auftriebHinten || 0) + (d.fluegelHinten || 0)) });
  }
  // Die schnellere Abstimmung auf ein Fahrprofil anwenden: mehr Grip, mehr Einschlag und eine
  // schnellere Gierantwort. Bei "GT3" bleibt das Profil unveraendert (P zurueck).
  function vfHandlingProfil(P) {
    if (!P) return P;
    const h = vfHandling();
    if (h === 'schnell') {
      return Object.assign({}, P, {
        muV: P.muV * 1.35,
        muH: P.muH * 1.35,
        lenkGrad: Math.min(45, P.lenkGrad * 1.5),
        yawDamp: (P.yawDamp || 1.5) * 0.6,
      });
    }
    if (h === 'gran') {
      // Gran Hybrismo (v1.3.5, vorher Gran Accelerato): wie Gran Turismo Sport. Mehr Grip und
      // Abtrieb, ein flacherer Reifenscheitel (C), kaum Lastwechsel (niedrigerer Schwerpunkt im
      // Modell), staerkere Gierdaempfung als Stabilitaetshilfe und etwas mehr Einschlag.
      return Object.assign({}, P, {
        muV: P.muV * 1.12, muH: P.muH * 1.12,
        C: Math.max(1.1, (P.C || 1.35) - 0.15),
        h: (P.h || 0.38) * 0.6,
        lastEmpf: (P.lastEmpf || 0.15) * 1.4,
        yawDamp: (P.yawDamp || 1.5) * 1.4,
        lenkGrad: Math.min(45, (P.lenkGrad || 16) * 1.1),
        kV: (P.kV || VF_ABTRIEB_GRUND.kV) * 1.5,
        kH: (P.kH || VF_ABTRIEB_GRUND.kH) * 1.5,
      });
    }
    if (h === 'acc') {
      // Assetto Carrera (v1.3.5): wie ACC. Deutliche Lastverlagerung (hoeherer Schwerpunkt),
      // scharfer Reifenscheitel, weniger Gierdaempfung, Bremsbalance nach hinten (Trail-Braking
      // dreht ein) und ein Reifenfenster (im Fahrtakt, vfReifenGriff).
      return Object.assign({}, P, {
        C: (P.C || 1.35) + 0.12,
        h: (P.h || 0.38) * 1.15,
        yawDamp: (P.yawDamp || 1.5) * 0.85,
        bremsVorn: 0.68,
        lenkGrad: Math.min(45, (P.lenkGrad || 16) * 1.05),
        kV: P.kV || VF_ABTRIEB_GRUND.kV,
        kH: P.kH || VF_ABTRIEB_GRUND.kH,
      });
    }
    return P;
  }
  // ---- REIFENTEMPERATUR IM VIRTUELLEN FAHREN (v1.3.5) ------------------------------------------
  // T: 0 = Umgebung, 0,5-0,65 = Fenster, 1 = weit ueberhitzt. Erster Ordnung: dT/dt = (Arbeit - T)/12 s,
  // die Gleichgewichtstemperatur IST die Arbeit. Arbeit aus Tempo (40 %) und Querbeschleunigung (60 %):
  // zuegig gefahren (~0,55) liegt sie im Fenster, Dauerangriff (~0,9) ueberhitzt, Bummeln kuehlt ab.
  function vfReifenTemp(T, vMs, ay, dt) {
    const arbeit = Math.min(1.2, 0.4 * Math.abs(vMs) / 50 + 0.6 * Math.abs(ay) / 14);
    return Math.max(0, Math.min(1.2, T + (arbeit - T) * dt / 12));
  }
  // Griff-Faktor aus der Temperatur. Assetto Carrera: kalt 0,85, im Fenster 1,04, ueberhitzt bis 0,85.
  // Gran Hybrismo: dieselbe Kurve, aber nur zu 35 % (GT Sport: die Temperatur spielt kaum eine Rolle).
  function vfReifenGriff(T, hand) {
    let f;
    if (T < 0.5) f = 0.85 + 0.15 * (T / 0.5);
    else if (T <= 0.65) f = 1.0;
    else f = Math.max(0.85, 1 - (T - 0.65) * 0.5);
    if (hand === 'acc') {
      const d = (T - 0.575) / 0.1;
      return f * (1 + 0.04 * Math.exp(-d * d));
    }
    return 1 + 0.35 * (f - 1);
  }
  // ---- Federung: vier Ecken mit Feder, Daempfer (Druck/Zug) und Stabilisator --------------------
  // Zustand f: z (Einfedern, m, + = tiefer), th (Nicken, rad, + = Nase runter), ph (Rollen, rad, + = rechts
  // runter) und ihre Geschwindigkeiten. ax: Laengsbeschleunigung (m/s^2, + = Gas), ay: Querbeschleunigung
  // (+ = nach rechts, also Rechtskurve). Bremsen drueckt die Nase, Gas das Heck, eine Rechtskurve legt das
  // Auto auf die linke Seite. Gerechnet wird nur die Abweichung von der Ruhelage (das Eigengewicht traegt
  // die Feder schon).
  function vfFederung(f, ax, ay, dt, d, stoss) {
    const m = d.gefedert || d.masse, h = d.schwerpunktHoehe;
    const Ix = m * (d.breite * d.breite + d.hoehe * d.hoehe) / 12, Iy = m * (d.laenge * d.laenge + d.hoehe * d.hoehe) / 12;
    const tv = d.reifen.vorn.spur / 2, th_ = d.reifen.hinten.spur / 2, fv = d.feder.vorn, fh = d.feder.hinten;
    // Ecken: x vom Schwerpunkt nach vorn, y nach rechts
    const ecken = [[d.a, tv, fv], [d.a, -tv, fv], [-d.b, th_, fh], [-d.b, -th_, fh]];
    const schritte = Math.max(1, Math.ceil(dt / 0.002)), hs = dt / schritte;
    for (let s = 0; s < schritte; s++) {
      const F = [];
      for (const [x, y, k] of ecken) {
        const dd = f.z + f.th * x + f.ph * y, vv = f.vz + f.vth * x + f.vph * y;
        F.push(k.k * dd + (vv > 0 ? k.druck : k.zug) * vv);
      }
      // Stabilisatoren: Kraft aus dem Unterschied rechts minus links je Achse
      for (const [i, k] of [[0, fv], [2, fh]]) {
        const dr = ecken[i][0] * f.th + ecken[i][1] * f.ph, dl = ecken[i + 1][0] * f.th + ecken[i + 1][1] * f.ph;
        const st = (k.stab || 0) * (dr - dl);
        F[i] += st; F[i + 1] -= st;
      }
      let sF = 0, sx = 0, sy = 0;
      for (let i = 0; i < 4; i++) { sF += F[i]; sx += F[i] * ecken[i][0]; sy += F[i] * ecken[i][1]; }
      const az = ((stoss || 0) - sF) / m;
      const ath = (m * -ax * h - sx) / Iy;
      const aph = (m * -ay * h * 0.8 - sy) / Ix;
      f.vz += az * hs; f.vth += ath * hs; f.vph += aph * hs;
      f.z += f.vz * hs; f.th += f.vth * hs; f.ph += f.vph * hs;
    }
    // Federweg begrenzt (Speed Dreams: suspension course)
    const weg = Math.min(fv.weg || 0.1, fh.weg || 0.1);
    f.z = Math.max(-weg, Math.min(weg, f.z));
    return f;
  }
  // ---- Matrizen fuer das Modell ----------------------------------------------------------------
  const vfT = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const vfS = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
  const vfRx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
  const vfRy = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
  const vfRz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
  const vfKette = (...m) => m.reduce((a, b) => vfMal(a, b));
  // Normalenmatrix: invers-transponierte 3x3 (das Rad ist ungleich skaliert und rechts gespiegelt).
  function vfNormalen(w) {
    const a = w[0], b = w[4], c = w[8], d = w[1], e = w[5], f = w[9], g = w[2], h = w[6], i = w[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1;
    // Kofaktoren C[r][c]; die Normalenmatrix ist C / det, spaltenweise abgelegt
    const C10 = -(b * i - c * h), C11 = a * i - c * g, C12 = -(a * h - b * g);
    const C20 = b * f - c * e, C21 = -(a * f - c * d), C22 = a * e - b * d;
    return [A / det, C10 / det, C20 / det, B / det, C11 / det, C21 / det, C / det, C12 / det, C22 / det];
  }
  function vfProgrammTex(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; attribute vec3 n; attribute vec2 uv; uniform mat4 m; uniform mat4 w; uniform mat3 nm;'
      + 'varying vec2 vuv; varying vec3 vn; varying float vd;'
      + 'void main(){ vec4 q = w * vec4(p, 1.0); gl_Position = m * q; vuv = uv; vn = nm * n; vd = gl_Position.w; }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec2 vuv; varying vec3 vn; varying float vd;'
      + 'uniform sampler2D tx; uniform vec3 tint; uniform float emis; uniform float alpha; uniform float am; uniform float licht; uniform vec3 nebel;'
      + 'void main(){ vec4 t = texture2D(tx, vuv); vec3 N = normalize(vn);'
      + ' float d = max(dot(N, normalize(vec3(0.35, 0.9, 0.25))), 0.0); float s = pow(max(dot(N, normalize(vec3(0.2, 0.75, -0.6))), 0.0), 24.0);'
      + ' float l = mix(1.0, 0.42 + 0.66 * d, licht); vec3 c = t.rgb * tint * (l + emis) + vec3(s * 0.35 * licht);'
      + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, nebel, f), mix(alpha, alpha * t.a, am)); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['m', 'w', 'nm', 'tx', 'tint', 'emis', 'alpha', 'am', 'licht', 'nebel'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, u, ap: gl.getAttribLocation(p, 'p'), an: gl.getAttribLocation(p, 'n'), auv: gl.getAttribLocation(p, 'uv') };
  }
  // Daten einmal je Sitzung und Auto holen (fetch: ueber file:// nicht ladbar, dann bleibt der Kasten).
  let vfModellLaden = {};
  function vfModellDaten(pfad) {
    pfad = pfad || vfModellPfad();
    if (!vfModellLaden[pfad]) {
      vfModellLaden[pfad] = Promise.all([
        fetch(pfad + 'auto.json').then((r) => { if (!r.ok) throw new Error('auto.json ' + r.status); return r.json(); }),
        fetch(pfad + 'auto.bin').then((r) => { if (!r.ok) throw new Error('auto.bin ' + r.status); return r.arrayBuffer(); }),
      ]).then(([meta, bin]) => {
        if (bin.byteLength < meta.indexAb + meta.indizes * 2) throw new Error('auto.bin zu kurz');
        return { meta, ecken: new Float32Array(bin, 0, meta.ecken * 8), indizes: new Uint16Array(bin, meta.indexAb, meta.indizes) };
      }).catch((e) => { vfModellLaden[pfad] = null; throw e; });
    }
    return vfModellLaden[pfad];
  }
  // Gemeinsamer Rad-Modell-Fallback: die echten Rad-Teile der Vulture V5.R (mit Texturen),
  // damit auch Modelle ohne eigene Rad-Geometrie die gleichen Raeder zeigen.
  let vfRadModell = null;
  function vfRadModellBauen(gl) {
    if (vfRadModell) return vfRadModell;
    vfRadModell = vfModellDaten('img/autos/v5r/').then((daten) => {
      const teile = daten.meta.teile.filter((t) => t.gruppe === 'rad');
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, daten.ecken, gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, daten.indizes, gl.STATIC_DRAW);
      const tex = {};
      teile.forEach((t) => { if (!tex[t.tex]) tex[t.tex] = vfTextur(gl, 'img/autos/v5r/' + t.tex); });
      return { vbo, ibo, teile, tex };
    });
    return vfRadModell;
  }
  function vfTextur(gl, url, rgba) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba || [150, 150, 155, 255]));
    if (!url) return tx;
    const bild = new Image();
    bild.onload = () => {
      if (VF.gl !== gl) return;
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bild);
      const zwei = (v) => (v & (v - 1)) === 0;
      if (zwei(bild.width) && zwei(bild.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    };
    bild.src = url;
    return tx;
  }
  // Ein weicher Lichtfleck (fuer Leuchten und den Lichtkegel), gerechnet statt geladen.
  function vfGlanzTextur(gl) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return tx;
  }
  function vfModellBauen(gl, daten, pfad) {
    pfad = pfad || vfModellPfad();
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, daten.ecken, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, daten.indizes, gl.STATIC_DRAW);
    const tex = {};
    daten.meta.teile.forEach((t) => { if (!tex[t.tex]) tex[t.tex] = vfTextur(gl, pfad + t.tex); });
    const schatten = daten.meta.schatten ? vfTextur(gl, pfad + daten.meta.schatten, [0, 0, 0, 0]) : null;
    // Eine kleine Flaeche fuer Schatten, Lichtkegel und Leuchten (wird je Bild neu beschrieben).
    const quad = gl.createBuffer();
    return { meta: daten.meta, d: daten.meta.physik, vbo, ibo, tex, schatten, glanz: vfGlanzTextur(gl), quad };
  }
  // Naechster Mittellinienpunkt in einem Fenster um den letzten (die Strecke kann sich kreuzen).
  function vfOrt(pts, nrm, x, y, idx) {
    const n = pts.length;
    let best = idx, bd = Infinity;
    for (let k = -12; k <= 40; k++) {
      const i = ((idx + k) % n + n) % n;
      const d = (pts[i].x - x) * (pts[i].x - x) + (pts[i].y - y) * (pts[i].y - y);
      if (d < bd) { bd = d; best = i; }
    }
    const quer = (x - pts[best].x) * nrm[best].x + (y - pts[best].y) * nrm[best].y;
    return { idx: best, quer, abstand: Math.sqrt(bd) };
  }

  // ---- Takt: Pakete wie ein echtes Auto --------------------------------------------------------
  function vfPaket() {
    if (rennPauseAktiv()) return;
    if (!VF.aktiv || !VF.car) return;
    // Der Vorpunkt vor Kachel 0 (tile -1) liegt auf dem letzten Punkt der Schleife. Bis 1.3.50 zaehlte er
    // als Kachel 0 (Start): pendelte der naechste Punkt dort zwischen beiden, war das eine "Runde" von
    // 0,3 s (Letzte/Beste im HUD). Jetzt gilt am Vorpunkt die Kachel davor weiter.
    const roh = VF.pts[VF.idx].tile;
    const tile = roh >= 0 ? roh : (VF.kachel >= 0 ? VF.kachel : 0);
    if (tile !== VF.kachel) {
      if (VF.kachel !== -2) VF.zaehler = (VF.zaehler + 1) & 0xff;
      const vorher = VF.kachel;
      VF.kachel = tile;
      // Eigene Rundenanzeige fuer die Kopfzeile (die Zeitnahme selbst laeuft in der App).
      if (vorher !== -2 && VF.tiles[tile] && VF.tiles[tile].type === TILE_TYPE.START && !VF.abseits) {
        const jetzt = rennZeitJetzt();
        if (VF.rundeAb) {
          VF.letzte = jetzt - VF.rundeAb;
          // Delta (HUD): die Zwischenzeiten der besten Runde je Punkt der Mittellinie.
          if (VF.beste === null || VF.letzte < VF.beste) { VF.beste = VF.letzte; VF.besteSplits = VF.splits; }
          // Nach der ersten Runde beginnt der Geist, die aufgezeichnete Linie abzufahren.
          if (VF.geist && !VF.geist.aktiv) { VF.geist.aktiv = true; VF.geist.zeit = 0; VF.geist.i = 0; }
          // Rundenrennen: nach der Ziel-Lap ist Schluss.
          VF.runden = (VF.runden || 0) + 1;
          if (VF.modus === 'laps' && VF.runden >= VF.limit) vfRennenEnde();
        }
        VF.rundeAb = jetzt;
        VF.splits = [];
      }
    }
    const b = new Uint8Array(19);
    b[0] = 0xaf; b[2] = 0x9c; b[10] = 100;
    b[11] = VF.zaehler;
    b[12] = VF.abseits ? TILE_OFFTRACK : vfCode(VF.tiles[tile] ? VF.tiles[tile].type : TILE_TYPE.STRAIGHT);
    b[15] = VF.abseits ? 0 : 0x08;
    try { onCarNotify(VF.car, { target: { value: new DataView(b.buffer) } }); } catch (e) { /* weiter */ }
  }

  function vfBild(now) {
    if (!VF.aktiv) return;
    VF.raf = requestAnimationFrame(vfBild);
    if (rennPauseAktiv()) {
      VF.letzt = now; VF.dtBild = 0; vfMalen(); vfHud(); return;
    }
    const dt = VF.letzt ? Math.min(0.05, (now - VF.letzt) / 1000) : 0.016;
    VF.letzt = now;
    const st = physEngine.state;
    VF.dtBild = dt;
    // Zeitmodi (Endurance, Qualifying): laufen gegen die Rennzeit.
    if (VF.modus && VF.modus !== 'laps' && VF.modus !== 'practice' && VF.limit) {
      VF.modusZeit += dt;
      if (VF.modusZeit >= VF.limit * 60) vfRennenEnde();
    }
    const kmh = (st.speedKmh || 0) * (VF.tempoFaktor || 1);
    const hand = vfHandling();
    const reifenModus = hand === 'gran' || hand === 'acc';
    // v1.1.11 GEMELDET: "Virtuelles Fahren ruckelt und ist sehr traege." Bisher lenkte das Auto mit
    // physEngine.state.dampedSteering: das rechnet die Physik nur alle 45 ms (Treppenstufen in der
    // Gierrate = Ruckeln), mit der Servodaempfung und der Lenkbegrenzung bei Tempo des ECHTEN Autos
    // (= traege). Jetzt direkt der Stick (steerX), voller Einschlag in 0,12 s, bei hohem Tempo etwas
    // weniger Einschlag wie ein Spiel-Lenkfilter; den Rest erledigt das Reifenmodell.
    const vVollL = Math.abs(kmh) * REAL_SCALE / 3.6;
    const lenkZiel = Math.max(-1, Math.min(1, typeof steerX === 'number' ? steerX : 0)) / (1 + (vVollL / 55) * (vVollL / 55));
    const schritt = dt / 0.09;
    VF.lenkIst = (VF.lenkIst || 0) + Math.max(-schritt, Math.min(schritt, lenkZiel - (VF.lenkIst || 0)));
    const lenk = VF.lenkIst;
    if (kmh < 0) {
      // Rueckwaerts (Rangieren): rein kinematisch wie bisher.
      const neu = vfSchritt(VF, kmh, lenk, dt, physEngine.config.gripScale);
      VF.x = neu.x; VF.y = neu.y; VF.h = neu.h;
      VF.dyn = { vy: 0, r: 0 };
      VF.ax = 0; VF.ay = 0;
    } else {
      const vVoll = kmh * REAL_SCALE / 3.6;                                  // m/s eines GT3
      // Laengs: die Laengs-G der App (-1 = Vollbremsung) auf GT3-Werte (1,5 g), nicht die Ableitung
      // des Modellauto-Tempos - das beschleunigt umgerechnet weit ueber jedes echte Auto.
      const ax = (st.gLong || 0) * 15;
      if (!VF.dyn) VF.dyn = { vy: 0, r: 0 };
      let mu = (physEngine.config.gripScale || 1) * (VF.abseits ? 0.55 : 1);
      if (reifenModus) {
        // Reifentemperatur (v1.2.62, Korrektur v1.3.5): kalt = weniger Griff, warm = optimal,
        // ueberhitzt = weniger. Bis 1.3.4 heizte sie mit bis zu 0,25/s und kuehlte nur mit
        // 0,01/s - nach wenigen Sekunden stand sie dauerhaft am Anschlag (ueberhitzt).
        if (VF.tyreTemp === undefined) VF.tyreTemp = 0;
        VF.tyreTemp = vfReifenTemp(VF.tyreTemp, vVollL, VF.ay || 0, dt);
        mu *= vfReifenGriff(VF.tyreTemp, hand);
      }
      vfDynamik(VF.dyn, vVoll, ax, Math.max(0, st.longUse || 0), lenk, dt, mu, VF.P);
      VF.ax = ax; VF.ay = vVoll * VF.dyn.r;
      // Weg in der Bahnwelt: Tempo des Modellautos, Richtung = Kurs + Schwimmwinkel.
      VF.h += VF.dyn.r * dt * 180 / Math.PI;
      const beta = Math.atan2(VF.dyn.vy, Math.max(0.1, vVoll));
      const vE = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM;
      const rich = VF.h * Math.PI / 180 + beta;
      VF.x += Math.sin(rich) * vE * dt;
      VF.y -= Math.cos(rich) * vE * dt;
    }
    // Geist: die erste Runde wird aufgezeichnet, danach faehrt eine Kopie diese Linie ab.
    if (VF.geist) {
      const g = VF.geist;
      if (!g.aktiv) {
        g.aufzeichnung.push([VF.x, VF.y, VF.h, g.t]);
        g.t += dt;
      } else if (g.an && g.aufzeichnung.length > 1) {
        g.zeit += dt;
        const a = g.aufzeichnung;
        const total = a[a.length - 1][3];
        const t = total > 0 ? (g.zeit % total) : 0;
        while (g.i < a.length - 2 && a[g.i + 1][3] <= t) g.i++;
        while (g.i > 0 && a[g.i][3] > t) g.i--;
        const p0 = a[g.i], p1 = a[g.i + 1];
        const d = (p1[3] - p0[3]) || 1;
        const f = Math.max(0, Math.min(1, (t - p0[3]) / d));
        g.x = p0[0] + (p1[0] - p0[0]) * f;
        g.y = p0[1] + (p1[1] - p0[1]) * f;
        g.h = p0[2] + (p1[2] - p0[2]) * f;
      }
    }
    // Raeder drehen mit dem Weg, Federung folgt Laengs- und Querbeschleunigung (neben der Bahn ruettelt es).
    const wegE = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM * dt;
    VF.raddreh = ((VF.raddreh || 0) + wegE / (VF_AUTO.L / 4.64 * 0.335)) % (Math.PI * 2);
    if (VF.modell) {
      if (!VF.feder) VF.feder = { z: 0, vz: 0, th: 0, vth: 0, ph: 0, vph: 0 };
      const stoss = VF.abseits && Math.abs(kmh) > 0.05 ? (Math.random() - 0.5) * VF.modell.d.masse * 9 : 0;
      vfFederung(VF.feder, VF.ax || 0, VF.ay || 0, dt, VF.modell.d, stoss);
    }
    VF.lenkWinkel = Math.max(-1, Math.min(1, lenk)) * (VF.P ? VF.P.lenkGrad : VF_GT3.lenkGrad) * Math.PI / 180;
    const o = vfOrt(VF.pts, VF.nrm, VF.x, VF.y, VF.idx);
    VF.idx = o.idx;
    if (VF.splits && VF.splits[VF.idx] === undefined) VF.splits[VF.idx] = rennZeitJetzt() - VF.rundeAb;
    const ab = Math.abs(o.quer) > TRACK_HALF_W * 1.19 + VF_AUTO.B * 0.3;
    if (ab && !VF.abseits) VF.abseitsSeit = rennZeitJetzt();
    VF.abseits = ab;
    // Randstein (v1.2.62): der erhabene Stein links/rechts der Fahrbahn. Faehrt das Auto mit dem
    // Rand ueber ihn, rattert es und der Controller brummt.
    const q = Math.abs(o.quer);
    const kerbRand = TRACK_HALF_W * 2 * 0.095;
    const kerb = !ab && q > TRACK_HALF_W - VF_AUTO.B * 0.5 && q < TRACK_HALF_W + kerbRand;
    if (kerb && Math.abs(kmh) > 0.05) {
      if (VF.kerbSeit === undefined || rennZeitJetzt() - VF.kerbSeit > 70) {
        VF.kerbSeit = rennZeitJetzt();
        padRumble(0.3, 0.25, 55, 'kerb', 1);
        if (randsteinKlangAlt) vfRattern(0.10 + Math.min(0.10, Math.abs(kmh) / 40));
      }
    }
    vfRandsteinTon(kerb, q, kmh);   // v1.3.39: dumpfes Rumpeln, je Bild (billig), blendet selbst aus
    if (ab) {
      st.speedKmh *= Math.exp(-VF_ABSEITS_BREMSE * dt);
      if (rennZeitJetzt() - VF.abseitsSeit > VF_ABSEITS_ZURUECK_MS) vfZuruecksetzen();
    }
    // NPCs: folgen ihrer Spur mit Stufe-1-Tempo und bremsen vor Kurven (vfNpcSteuern).
    if (VF.npcs && VF.npcBogen) {
      for (const npc of VF.npcs) {
        vfNpcSteuern(npc, dt, VF.pts, VF.nrm);
        if (npc.modell && npc.modell.d && npc.modell.d.reifen) vfFederung(npc.feder, npc.ax || 0, npc.ay || 0, dt, npc.modell.d, 0);
      }
    }
    vfMalen();
    vfHud();
  }
  function vfZuruecksetzen() {
    const p = VF.pts[VF.idx];
    VF.x = p.x; VF.y = p.y; VF.h = p.heading;
    physEngine.state.speedKmh = 0;
    VF.abseits = false;
    VF.dyn = { vy: 0, r: 0 };
    VF.feder = null;
    showHudToast(t('Zurück auf die Bahn gesetzt'));
  }
  function vfRennenEnde() {
    if (VF.rennenEnde) return;
    VF.rennenEnde = true;
    const was = VF.modus === 'laps' ? (Math.min(VF.runden, VF.limit) + ' ' + t('Runden')) : (VF.limit + ' min');
    showHudToast(t('Rennen beendet') + ': ' + was);
    rennZeitTimeout(() => { if (VF.aktiv) virtuellBeenden(); }, 1600);
  }
  function vfMalen() {
    const gl = VF.gl, cv = VF.cv;
    // Handy (Touch): hoechstens 1,25-fache Aufloesung - die Pixelzahl ist auf dem Handy der teuerste Teil.
    const dpr = Math.min(navigator.maxTouchPoints > 0 ? 1.25 : 1.5, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.66, 0.78, 0.90, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Himmel als Vollbild-Farbverlauf, ganz hinten (Tiefentest aus).
    if (!VF.himmelProg) { VF.himmelProg = vfProgrammHimmel(gl); VF.himmel = vfHimmel(gl); }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(VF.himmelProg.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, VF.himmel.b);
    gl.enableVertexAttribArray(VF.himmelProg.ap); gl.enableVertexAttribArray(VF.himmelProg.ac);
    gl.vertexAttribPointer(VF.himmelProg.ap, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(VF.himmelProg.ac, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, VF.himmel.n);
    gl.disableVertexAttribArray(VF.himmelProg.ap); gl.disableVertexAttribArray(VF.himmelProg.ac);
    gl.enable(gl.DEPTH_TEST);
    const k = vfKamera(VF.dtBild || 0.016);
    const blick = vfBlick(k.auge, k.ziel, k.oben || [0, 1, 0]);
    const pv = vfMal(vfPerspektive(k.fov * Math.PI / 180, w / Math.max(1, h), k.nah, k.fern || 3000), blick);
    // v1.3.39: Boden, Fahrbahn und Randsteine mit Texturen (vorher Eckfarben in VF.bahn).
    vfFlaechenMalen(gl, pv, k.auge);
    gl.useProgram(VF.prog);
    if (!VF.loc) VF.loc = { m: gl.getUniformLocation(VF.prog, 'm'), w: gl.getUniformLocation(VF.prog, 'w'), nebel: gl.getUniformLocation(VF.prog, 'nebel'), alf: gl.getUniformLocation(VF.prog, 'alf'),
                            p: gl.getAttribLocation(VF.prog, 'p'), c: gl.getAttribLocation(VF.prog, 'c') };
    const L = VF.loc;
    gl.uniformMatrix4fv(L.m, false, new Float32Array(pv));
    gl.uniform3f(L.nebel, 0.66, 0.78, 0.90);
    gl.uniform1f(L.alf, 1.0);
    const zeichne = (pu, welt) => {
      gl.uniformMatrix4fv(L.w, false, new Float32Array(welt));
      gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
      gl.enableVertexAttribArray(L.p); gl.enableVertexAttribArray(L.c);
      gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(L.c, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    };
    if (VF.geist && VF.geist.aktiv) {
      if (!VF.geistAuto) VF.geistAuto = vfAutoBauen(gl, [0.45, 0.75, 1.0]);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(L.alf, 0.45);
      zeichne(VF.geistAuto, vfLage(VF.geist.x, VF.geist.y, VF.geist.h));
      gl.uniform1f(L.alf, 1.0);
      gl.disable(gl.BLEND);
      gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
    }
    if (VF.modell && VF.tprog) vfModellMalen(gl, pv, blick);
    else {
      zeichne(VF.auto, vfLage(VF.x, VF.y, VF.h));
      gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
    }
    // NPCs: ihre eigenen Modelle an ihren Stellen.
    if (VF.npcs && VF.tprog) {
      for (const npc of VF.npcs) {
        if (!npc.modell) continue;
        // Neigung 1x: "Neigung sichtbar" gilt nur fuer das eigene Auto (v1.2.32 GEMELDET: "sollte auf
        // Stufe 1 sein"). Bremslicht, wenn das Fahrzeugmodell des NPC bremst.
        vfModellZeichnen(gl, pv, blick, npc.modell, VF.tprog, npc.x, npc.y, npc.h, npc.feder, npc.lenkWinkel, npc.raddreh, VF.radModell, true,
          !!(npc.motor && npc.motor.outputs && npc.motor.outputs.lights && npc.motor.outputs.lights.brake), 1);
      }
    }
  }
  // ---- Kamera (v1.1.11) --------------------------------------------------------------------
  // BESTELLT: "Wenn ich den rechten Stick reindruecke im virtuellen Fahren, aendere die Kamera zu
  // Motorhaube oder nahe Verfolgerkamera." R3 (bzw. die Lichthupen-Belegung) oder C schaltet weiter:
  // Verfolger -> nah -> Motorhaube -> Verfolger. Nachgefuehrt nach der ZEIT (nicht je Bild): auf einem
  // langsamen Handy lief die Kamera vorher bei weniger Bildern spuerbar hinterher.
  const VF_KAMERAS = [{ id: 'verfolger', name: 'Verfolgerkamera' }, { id: 'nah', name: 'Nahe Verfolgerkamera' }, { id: 'haube', name: 'Motorhaube' },
                      { id: 'oben', name: 'Von oben (Start/Ziel)' }, { id: 'statisch', name: 'Statisch (Start/Ziel)' },
                      { id: 'fahrer', name: 'Fahrer am Rand', wip: true }];
  const VF_KAMERA_STORE = 'omegasim-vf-kamera';
  function vfKameraId() {
    if (!VF.kamera) { try { VF.kamera = localStorage.getItem(VF_KAMERA_STORE) || 'verfolger'; } catch (e) { VF.kamera = 'verfolger'; } }
    return VF_KAMERAS.some((k) => k.id === VF.kamera) ? VF.kamera : 'verfolger';
  }
  function vfKameraWechseln() {
    const i = VF_KAMERAS.findIndex((k) => k.id === vfKameraId());
    const neu = VF_KAMERAS[(i + 1) % VF_KAMERAS.length];
    VF.kamera = neu.id; VF.kam = null;
    vfDrehNull();   // jede Kamera beginnt in ihrer Standardansicht
    try { localStorage.setItem(VF_KAMERA_STORE, neu.id); } catch (e) { /* egal */ }
    showHudToast(t(neu.name) + (neu.wip ? ' (WIP)' : ''));
  }
  // ---- Kamera drehen mit dem rechten Stick (WIP) ------------------------------------------------
  // BESTELLT: "Erlaube mir, im virtuellen Fahren mit dem rechten Stick die Kamera um das Auto herum zu
  // drehen (bzw. in eine andere Richtung einfach). Wenn ich den rechten Stick dann reindruecke, soll die
  // Kamera wieder die Standardansicht haben."
  // ZWEI ARTEN: Verfolger, nah und statisch kreisen UM das Auto (waagrecht ganz herum, senkrecht
  // -10..+60 Grad zur Standardhoehe), von oben dreht das Bild und neigt sich bis 60 Grad. Motorhaube und
  // "Fahrer am Rand" drehen den BLICK (umsehen, senkrecht +-35 Grad). Stick rechts = Blick nach rechts,
  // Stick hoch = Blick nach oben (die kreisenden Kameras sinken dafuer), wie in den meisten Spielen.
  // GEFUEHL: Totzone und quadratische Kennlinie (feines Zielen), die Drehrate laeuft der Auslenkung mit
  // einer Zeitkonstante nach (sanftes Anfahren und Auslaufen). Gerechnet nach der ZEIT und exakt
  // integriert: 30 und 60 Bilder/s drehen gleich weit. Losgelassen BLEIBT der Blick stehen.
  // R3 (die Lichthupen-Belegung): gedreht -> zurueck zur Standardansicht, sonst wie bisher naechste
  // Kamera. Tastatur: T/F/G/H drehen (hoch/links/runter/rechts), V setzt zurueck, C wechselt weiter
  // (I/J/K/L waeren naheliegend, aber I/K schalten und L ist die Lichthupe).
  // Der Pad-Stick gilt nur fuer Achsen, die keine Belegung in Optionen -> Controller traegt, und nur
  // bei Standard-Belegung des Pads (sonst koennten Achse 2/3 die Trigger sein und dauernd drehen).
  const VF_DREH_GIER = 200 * Math.PI / 180, VF_DREH_NICK = 100 * Math.PI / 180, VF_DREH_TAU = 0.12;
  const VF_DREH_TOT = 0.16, VF_DREH_SCHWELLE = 2 * Math.PI / 180, VF_DREH_PAD_MS = 250;
  const VF_DREH_TASTEN = { t: 'hoch', f: 'links', g: 'runter', h: 'rechts' };
  function vfDreh() {
    if (!VF.dreh) VF.dreh = { g: 0, n: 0, vg: 0, vn: 0 };
    return VF.dreh;
  }
  function vfDrehNull() { const D = vfDreh(); D.g = 0; D.n = 0; D.vg = 0; D.vn = 0; }
  function vfDrehArt(id) { return id === 'haube' || id === 'fahrer' ? 'umsehen' : (id === 'oben' ? 'oben' : 'kreisen'); }
  // Grenzen der Hoehe n (Bogenmass): kreisen = Erhebung gegen die Standardhoehe, oben = Neigung aus der
  // Senkrechten, umsehen = Blick nach unten (positiv) / oben (negativ).
  function vfDrehGrenzen(art) {
    const r = Math.PI / 180;
    return art === 'oben' ? [0, 60 * r] : (art === 'umsehen' ? [-35 * r, 35 * r] : [-10 * r, 60 * r]);
  }
  function vfKameraGedreht() { const D = vfDreh(); return Math.abs(D.g) > VF_DREH_SCHWELLE || Math.abs(D.n) > VF_DREH_SCHWELLE; }
  function vfKameraStandard() {
    vfDrehNull(); VF.kam = null;
    showHudToast(t('Kamera: Standardansicht'));
  }
  // R3 / Lichthupen-Belegung: gedreht -> Standardansicht, sonst die naechste Kamera.
  function vfKameraTaste() { if (vfKameraGedreht()) vfKameraStandard(); else vfKameraWechseln(); }
  // Stick (aus pollGamepad): x/y nach Totzone und Kennlinie, mit Zeitstempel - bleibt der Takt aus
  // (Pad weg, Menue-Abfang), zaehlt der alte Wert nach VF_DREH_PAD_MS nicht mehr.
  function vfStickSetzen(pad, b) {
    if (!pad || pad.mapping !== 'standard') { VF.stick = null; return; }
    const belegt = (i) => Object.keys(b || {}).some((k) => b[k] && b[k].type === 'axis' && b[k].index === i);
    const achse = (i) => {
      if (belegt(i)) return 0;
      const v = (pad.axes || [])[i] || 0, m = Math.abs(v);
      if (m < VF_DREH_TOT) return 0;
      const s = Math.min(1, (m - VF_DREH_TOT) / (1 - VF_DREH_TOT));
      return Math.sign(v) * s * s;
    };
    VF.stick = { x: achse(2), y: achse(3), t: performance.now() };
  }
  function vfDrehTaste(e, an) {
    if (!VF.aktiv || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = (e.key || '').toLowerCase();
    if (!VF.tasten) VF.tasten = {};
    if (VF_DREH_TASTEN[k]) { VF.tasten[VF_DREH_TASTEN[k]] = an; e.preventDefault(); }
    else if (k === 'v' && an && !e.repeat) { e.preventDefault(); if (vfKameraGedreht()) vfKameraStandard(); }
  }
  window.addEventListener('keydown', (e) => vfDrehTaste(e, true));
  window.addEventListener('keyup', (e) => vfDrehTaste(e, false));
  window.addEventListener('blur', () => { VF.tasten = {}; });
  function vfDrehEingabe() {
    let x = 0, y = 0;
    const s = VF.stick;
    if (s && performance.now() - s.t < VF_DREH_PAD_MS) { x = s.x; y = s.y; }
    const k = VF.tasten;
    if (k) { x += (k.rechts ? 1 : 0) - (k.links ? 1 : 0); y += (k.runter ? 1 : 0) - (k.hoch ? 1 : 0); }
    return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
  }
  // Ein Zeitschritt (rein, fuer den Selbsttest): die Rate laeuft exponentiell zur Sollrate, der Winkel
  // ist das exakte Integral davon. Stick nach unten = Kamera hoeher / Blick tiefer (n waechst).
  function vfDrehSchritt(D, sx, sy, dt, grenzen) {
    if (!(dt > 0)) return D;
    const e = Math.exp(-dt / VF_DREH_TAU);
    const zg = sx * VF_DREH_GIER, zn = sy * VF_DREH_NICK;
    D.g += zg * dt + (D.vg - zg) * VF_DREH_TAU * (1 - e);
    D.n += zn * dt + (D.vn - zn) * VF_DREH_TAU * (1 - e);
    D.vg = zg + (D.vg - zg) * e;
    D.vn = zn + (D.vn - zn) * e;
    D.g = Math.atan2(Math.sin(D.g), Math.cos(D.g));
    if (D.n < grenzen[0]) { D.n = grenzen[0]; if (D.vn < 0) D.vn = 0; }
    if (D.n > grenzen[1]) { D.n = grenzen[1]; if (D.vn > 0) D.vn = 0; }
    if (Math.abs(D.vg) < 1e-4 && !sx) D.vg = 0;
    if (Math.abs(D.vn) < 1e-4 && !sy) D.vn = 0;
    return D;
  }
  // Drehung anwenden (rein): k = { auge, ziel, oben? } der Standardansicht, (px, py, pz) = Drehpunkt
  // (das Auto). Kreisen: Auge und Ziel um die Senkrechte durch das Auto, das Auge dazu auf seiner
  // Kugel hoeher/tiefer; umsehen: Blickrichtung um das Auge; oben: Bildoben drehen und neigen.
  function vfDrehAnwenden(k, art, D, px, py, pz) {
    if (!D || (!D.g && !D.n)) return k;
    const cg = Math.cos(D.g), sg = Math.sin(D.g);
    const rot = (x, z) => [x * cg - z * sg, x * sg + z * cg];
    if (art === 'umsehen') {
      const dx = k.ziel[0] - k.auge[0], dy = k.ziel[1] - k.auge[1], dz = k.ziel[2] - k.auge[2];
      const w = Math.hypot(dx, dz), L = Math.hypot(w, dy);
      const nick = Math.max(-1.5, Math.min(1.5, Math.atan2(dy, w) - D.n));
      const r = rot(dx / (w || 1), dz / (w || 1));
      return Object.assign({}, k, { ziel: [k.auge[0] + r[0] * Math.cos(nick) * L, k.auge[1] + Math.sin(nick) * L, k.auge[2] + r[1] * Math.cos(nick) * L] });
    }
    if (art === 'oben') {
      const o = k.oben || [0, 0, -1], ro = rot(o[0], o[2]), hoch = k.auge[1] - k.ziel[1];
      const auge = [k.ziel[0] - ro[0] * Math.sin(D.n) * hoch, k.ziel[1] + Math.cos(D.n) * hoch, k.ziel[2] - ro[1] * Math.sin(D.n) * hoch];
      return Object.assign({}, k, { auge, oben: [ro[0], 0, ro[1]] });
    }
    const ox = k.auge[0] - px, oz = k.auge[2] - pz, d0 = Math.hypot(ox, oz) || 1e-6, h0 = k.auge[1] - py;
    const R = Math.hypot(d0, h0), e = Math.max(3 * Math.PI / 180, Math.min(85 * Math.PI / 180, Math.atan2(h0, d0) + D.n));
    const ro = rot(ox / d0, oz / d0);
    const auge = [px + ro[0] * Math.cos(e) * R, py + Math.sin(e) * R, pz + ro[1] * Math.cos(e) * R];
    // Das Ziel dreht mit; je hoeher die Kamera, desto naeher rueckt es ans Auto (sonst faellt es von oben aus dem Bild).
    const nah = 1 - 0.8 * Math.max(0, Math.min(1, D.n / (60 * Math.PI / 180)));
    const rz = rot((k.ziel[0] - px) * nah, (k.ziel[2] - pz) * nah);
    return Object.assign({}, k, { auge, ziel: [px + rz[0], k.ziel[1], pz + rz[1]] });
  }
  // ---- Kamera "Fahrer am Rand" (v1.3.39, WIP) ----------------------------------------------------
  // BESTELLT: "Fuege eine Kamera hinzu, die so funktioniert wie eine Person, die das Auto vom Rand aus
  // steuert (ca. 1 m Hoehe, Blick folgt dem Auto mit etwas Smoothing)."
  // ORT: fest, einmal je Fahrt. Neben Start/Ziel (dort steht man beim Aufbauen), auf der AUSSENSEITE der
  // Schleife, VF_FAHRER_ABSTAND_CM vom Rand des Randsteins, und nur dort, wo im Umkreis keine andere
  // Bahn liegt (sonst ein Stueck weiter entlang der Bahn). Augenhoehe 100 cm in echten Massen.
  // BLICK: Gier- und Nickwinkel laufen dem Auto mit einer Zeitkonstante nach (nach der Zeit, nicht je
  // Bild: auf einem langsamen Handy folgt der Blick genauso schnell). Das Ziel ist das Auto, nicht ein
  // geglaetteter Punkt - so dreht der Kopf auch bei einer Vorbeifahrt dicht vorm Fahrer gleichmaessig.
  // SICHTFELD: 46 Grad senkrecht (bei 2:1 im Querformat gut 80 Grad waagrecht, etwa das, was ein Mensch
  // ohne Kopfdrehen bequem ueberblickt). Ist das Auto weit weg, zoomt es sanft bis 28 Grad: ein 10-cm-
  // Auto in 4 m Abstand waere sonst nur 1,5 Grad gross, ein paar Pixel; der Mensch "schaut genauer
  // hin". Mehr als 1,7-fach nicht, sonst wirkt es wie ein Fernglas.
  // NAH/FERN: das naechste sichtbare Ding ist mehr als 90 Einheiten entfernt (Boden unter dem Blick,
  // Auto am Rand), also Nahebene 8 und Fernebene 3000: Verhaeltnis 375 statt 6000 bei den anderen
  // Kameras, die Tiefe reicht auch fuer Randstein (0,09 hoch) gegen Fahrbahn.
  const VF_FAHRER_AUGE_CM = 100, VF_FAHRER_ABSTAND_CM = 75, VF_FAHRER_TAU = 0.25, VF_FAHRER_ZOOM_TAU = 0.8;
  const VF_FAHRER_FOV = 46, VF_FAHRER_FOV_FERN = 28;
  function vfFahrerOrt(pts, nrm, tiles) {
    const n = pts.length, rand = TRACK_HALF_W + TRACK_KERB_W, abst = VF_FAHRER_ABSTAND_CM * TRACK_UNITS_PER_CM;
    const s = Math.max(0, pts.findIndex((p) => p.tile >= 0 && tiles[p.tile] && tiles[p.tile].type === TILE_TYPE.START));
    const innen = (x, y) => {
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    const frei = (x, y) => { let d = Infinity; for (const p of pts) d = Math.min(d, Math.hypot(p.x - x, p.y - y)); return d - rand; };
    let best = null;
    for (let k = 0; k <= TRACK_SAMPLES_PER_TILE * 3; k++) {
      for (const dk of (k ? [k, -k] : [0])) {
        for (const sg of [1, -1]) {
          const i = ((s - 1 + dk) % n + n) % n;
          const x = pts[i].x + nrm[i].x * sg * (rand + abst), y = pts[i].y + nrm[i].y * sg * (rand + abst);
          const wert = (frei(x, y) >= abst * 0.95 ? 0 : 1000) + (innen(x, y) ? 100 : 0) + k;
          if (!best || wert < best.wert) best = { x, y, wert, i, seite: sg };
        }
      }
    }
    return { x: best.x, y: best.y, h: VF_FAHRER_AUGE_CM * TRACK_UNITS_PER_CM, idx: best.i, seite: best.seite };
  }
  // Ein Schritt (rein, fuer den Selbsttest): F = { ort, z: { gier, nick, fov }, k }, Auto bei (x, y).
  // Liefert F.k = { auge, ziel, fov, nah, fern } (dieselben Arrays jedes Mal, keine Allokation je Bild).
  function vfFahrerKamera(F, x, y, dt) {
    const o = F.ort, z = F.z;
    if (!F.k) F.k = { auge: [o.x, o.h, o.y], ziel: [0, 0, 0], fov: VF_FAHRER_FOV, nah: 8, fern: 3000 };
    const dx = x - o.x, dz = y - o.y, dy = VF_AUTO.H * 0.5 - o.h, waag = Math.hypot(dx, dz);
    const gier = Math.atan2(dz, dx), nick = Math.atan2(dy, Math.max(1e-6, waag));
    const dist = Math.hypot(waag, dy);
    const fovZiel = VF_FAHRER_FOV - (VF_FAHRER_FOV - VF_FAHRER_FOV_FERN) * Math.max(0, Math.min(1, (dist - 150) / 300));
    if (z.gier === undefined) { z.gier = gier; z.nick = nick; z.fov = fovZiel; }
    else {
      const a = 1 - Math.exp(-Math.max(0, dt) / VF_FAHRER_TAU), b = 1 - Math.exp(-Math.max(0, dt) / VF_FAHRER_ZOOM_TAU);
      z.gier += Math.atan2(Math.sin(gier - z.gier), Math.cos(gier - z.gier)) * a;
      z.nick += (nick - z.nick) * a;
      z.fov += (fovZiel - z.fov) * b;
    }
    const k = F.k, cn = Math.cos(z.nick);
    k.auge[0] = o.x; k.auge[1] = o.h; k.auge[2] = o.y;
    k.ziel[0] = o.x + Math.cos(z.gier) * cn * 100; k.ziel[1] = o.h + Math.sin(z.nick) * 100; k.ziel[2] = o.y + Math.sin(z.gier) * cn * 100;
    k.fov = z.fov;
    return k;
  }
  function vfKamera(dt) {
    const r = VF.h * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r);
    const id = vfKameraId();
    // Rechter Stick / T-F-G-H: die Drehung laeuft nach der Zeit (in der Pause ist dt 0).
    const art = vfDrehArt(id), D = vfDreh(), ein = vfDrehEingabe();
    vfDrehSchritt(D, ein[0], ein[1], dt, vfDrehGrenzen(art));
    const k = vfKameraBasis(id, fx, fz, dt, art, D);
    return art === 'kreisen' ? k : vfDrehAnwenden(k, art, D, VF.x, 0, VF.y);
  }
  function vfKameraBasis(id, fx, fz, dt, art, D) {
    if (id === 'fahrer' && VF.fahrer) { VF.kam = null; return vfFahrerKamera(VF.fahrer, VF.x, VF.y, dt); }
    if (id === 'haube') {
      // Auf der Motorhaube (Speed Dreams: Bonnet 0,75 m vor, 0,95 m hoch), fest am Auto.
      const s = VF.modell ? VF_AUTO.L / VF.modell.d.laenge : 2;
      const vor = 0.75 * s, hoch = (0.95 + (VF.modell ? 0.07 : 0.25)) * s;
      const auge = [VF.x + fx * vor, hoch, VF.y + fz * vor];
      VF.kam = auge;
      return { auge, ziel: [auge[0] + fx * 30, hoch - 1.2, auge[2] + fz * 30], fov: 70, nah: 0.3 };
    }
    if (id === 'oben') {
      // Von oben, parallel zur Start/Ziel-Geraden: die Kamera schwebt mit dem Auto mit (x/y) und
      // dreht sich NICHT mit - das "Oben" der Ansicht zeigt immer entlang der Geraden.
      const oben = [Math.sin(VF.startH * Math.PI / 180), 0, -Math.cos(VF.startH * Math.PI / 180)];
      const auge = [VF.x, 85, VF.y];
      VF.kam = null;
      return { auge, ziel: [VF.x, 0, VF.y], oben, fov: 62, nah: 0.5 };
    }
    if (id === 'statisch') {
      // Wie ein Zuschauer neben der Strecke: sitzt seitlich links neben dem Auto, etwas in der
      // Luft, und schaut immer aufs Auto (verfolgt es mit dem Blick, statt mitzufahren).
      const lx = -fz, lz = fx;               // senkrecht zur Fahrtrichtung ("links")
      const auge = [VF.x + lx * 9, 4.5, VF.y + lz * 9];
      VF.kam = null;
      return vfDrehAnwenden({ auge, ziel: [VF.x, 1.2, VF.y], fov: 62, nah: 0.3 }, art, D, VF.x, 1.2, VF.y);
    }
    const nah = id === 'nah';
    const hinten = nah ? 15 : 30, hoehe = nah ? 6 : 13, tau = nah ? 0.08 : 0.15;
    // Gedreht kreist der SOLL-Ort um das Auto; die Nachfuehrung (tau) bleibt dieselbe.
    const zh = nah ? 2.2 : 1.5, vor = nah ? 10 : 14;
    const k = vfDrehAnwenden({ auge: [VF.x - fx * hinten, hoehe, VF.y - fz * hinten], ziel: [VF.x + fx * vor, zh, VF.y + fz * vor] },
      art, D, VF.x, zh, VF.y);
    const soll = k.auge;
    const a = 1 - Math.exp(-Math.max(0, dt) / tau);
    VF.kam = VF.kam ? VF.kam.map((q, i) => q + (soll[i] - q) * a) : soll;
    return { auge: VF.kam, ziel: k.ziel, fov: nah ? 66 : 62, nah: 0.5 };
  }
  function vfModellMalen(gl, pv, blick) {
    vfModellZeichnen(gl, pv, blick, VF.modell, VF.tprog, VF.x, VF.y, VF.h, VF.feder, VF.lenkWinkel, VF.raddreh, VF.radModell,
      (typeof headlightsOn === 'undefined' ? true : !!headlightsOn),
      !!(physEngine.outputs && physEngine.outputs.lights && physEngine.outputs.lights.brake), vfFederSicht());
  }
  // Ein Modell an einer Stelle zeichnen. Wird fuer das Spielerauto und fuer jeden NPC benutzt:
  // M ist das gebaute Modell (vfModellBauen), T das Texturprogramm, fe der Federungszustand.
  function vfModellZeichnen(gl, pv, blick, M, T, x, y, h, fe, lenkWinkel, raddreh, radModell, licht, bremst, fs) {
    const d = M.d, u = T.u;
    const s = VF_AUTO.L / d.laenge;
    const lage = vfMal(vfLage(x, y, h), vfS(s, s, s));
    const g = fs || 1, fez = fe || { z: 0, th: 0, ph: 0 };
    const zSp = d.vorderachse - d.a, boden = (d.reifen.vorn.bodenfreiheit + d.reifen.hinten.bodenfreiheit) / 2;
    // Aufbau: um den Schwerpunkt genickt und gerollt, eingefedert nach unten.
    const aufbau = vfKette(lage, vfT(0, boden - fez.z * g, zSp), vfT(0, d.schwerpunktHoehe, 0), vfRx(fez.th * g), vfRz(fez.ph * g),
      vfT(0, -d.schwerpunktHoehe, -zSp));
    gl.useProgram(T.p);
    gl.uniformMatrix4fv(u.m, false, new Float32Array(pv));
    gl.uniform3f(u.nebel, 0.66, 0.78, 0.90);
    gl.uniform1i(u.tx, 0);
    gl.activeTexture(gl.TEXTURE0);
    [T.ap, T.an, T.auv].forEach((a) => gl.enableVertexAttribArray(a));
    const setze = (w, tint, emis, alpha, am, hell) => {
      gl.uniformMatrix4fv(u.w, false, new Float32Array(w));
      gl.uniformMatrix3fv(u.nm, false, new Float32Array(vfNormalen(w)));
      gl.uniform3f(u.tint, tint[0], tint[1], tint[2]); gl.uniform1f(u.emis, emis);
      gl.uniform1f(u.alpha, alpha); gl.uniform1f(u.am, am); gl.uniform1f(u.licht, hell);
    };
    const teil = (t) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, M.vbo);
      gl.vertexAttribPointer(T.ap, 3, gl.FLOAT, false, 32, t.ecke0 * 32);
      gl.vertexAttribPointer(T.an, 3, gl.FLOAT, false, 32, t.ecke0 * 32 + 12);
      gl.vertexAttribPointer(T.auv, 2, gl.FLOAT, false, 32, t.ecke0 * 32 + 24);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ibo);
      gl.bindTexture(gl.TEXTURE_2D, M.tex[t.tex]);
      gl.drawElements(gl.TRIANGLES, t.indizes, gl.UNSIGNED_SHORT, t.index0 * 2);
    };
    const flaeche = (ecken, tx) => {      // ecken: je Ecke x y z u v (Welt)
      const a = [];
      ecken.forEach((e) => a.push(e[0], e[1], e[2], 0, 1, 0, e[3], e[4]));
      gl.bindBuffer(gl.ARRAY_BUFFER, M.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(T.ap, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(T.an, 3, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(T.auv, 2, gl.FLOAT, false, 32, 24);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.drawArrays(gl.TRIANGLES, 0, ecken.length);
    };
    const ort = (w, p) => [w[0] * p[0] + w[4] * p[1] + w[8] * p[2] + w[12], w[1] * p[0] + w[5] * p[1] + w[9] * p[2] + w[13], w[2] * p[0] + w[6] * p[1] + w[10] * p[2] + w[14]];
    // 1. Schatten unter dem Auto (Boden, nicht mitgeneigt)
    if (M.schatten) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      setze(VF_EINS, [1, 1, 1], 0, 0.75, 1, 0);
      const hb = d.breite * 0.62, hl = d.laenge * 0.55;
      const q = [[hb, 0.012, hl + zSp, 0, 0], [-hb, 0.012, hl + zSp, 1, 0], [-hb, 0.012, -hl + zSp, 1, 1], [hb, 0.012, -hl + zSp, 0, 1]].map((p) => ort(lage, p).concat(p.slice(3)));
      flaeche([q[0], q[1], q[2], q[0], q[2], q[3]], M.schatten);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // 2. Aufbau, undurchsichtige Teile; Scheinwerfer und Ruecklicht leuchten selbst
    const ruecklichtEmis = bremst ? 1.7 : (licht ? 0.55 : 0);
    M.meta.teile.forEach((t) => {
      if (t.gruppe !== 'auto' || t.rolle === 'glas' || t.rolle === 'scheinwerferglas') return;
      const emis = t.rolle === 'scheinwerfer' ? (licht ? 1.3 : 0) : t.rolle === 'ruecklicht' ? ruecklichtEmis : 0;
      setze(aufbau, [1, 1, 1], emis, 1, 0, 1);
      teil(t);
    });
    // 3. Raeder: Mitte auf Reifenradius, vorn eingeschlagen, alle drehen; rechts gespiegelt (Muttern aussen)
    const radTeile = M.meta.teile.filter((t) => t.gruppe === 'rad');
    const halbW = d.breite / 2;
    [[1, 'vorn', d.vorderachse], [-1, 'vorn', d.vorderachse], [1, 'hinten', d.hinterachse], [-1, 'hinten', d.hinterachse]].forEach(([seite, ax, z]) => {
      const r = d.reifen[ax];
      const dreh = vfRy(ax === 'vorn' ? -(lenkWinkel || 0) : 0);
      const w = vfKette(lage, vfT(seite * r.spur / 2, r.radius, z), dreh, vfRx(raddreh || 0),
        vfS(seite * r.breite, 2 * r.radius, 2 * r.radius));
      radTeile.forEach((t) => { setze(w, [1, 1, 1], 0, 1, 0, 1); teil(t); });
      if (!radTeile.length) {
        // Fallback: die echten Rad-Teile der Vulture V5.R (mit Reifen-/Felgen-Textur).
        const radM = radModell;
        if (radM && radM.teile.length) {
          // Das Rad so weit nach aussen, dass es neben der Karosserie sichtbar bleibt (manche Modelle
          // haben eine schmalere Spur und wuerden das Rad sonst verstecken).
          const xW = seite * Math.max(r.spur / 2, halbW + 0.12 - 0.5 * r.breite);
          const wF = vfKette(lage, vfT(xW, r.radius, z), dreh, vfRx(raddreh || 0),
            vfS(seite * r.breite, 2 * r.radius, 2 * r.radius));
          setze(wF, [1, 1, 1], 0, 1, 0, 1);
          radM.teile.forEach((t) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, radM.vbo);
            gl.vertexAttribPointer(T.ap, 3, gl.FLOAT, false, 32, t.ecke0 * 32);
            gl.vertexAttribPointer(T.an, 3, gl.FLOAT, false, 32, t.ecke0 * 32 + 12);
            gl.vertexAttribPointer(T.auv, 2, gl.FLOAT, false, 32, t.ecke0 * 32 + 24);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, radM.ibo);
            gl.bindTexture(gl.TEXTURE_2D, radM.tex[t.tex]);
            gl.drawElements(gl.TRIANGLES, t.indizes, gl.UNSIGNED_SHORT, t.index0 * 2);
          });
        }
      }
    });
    // 4. Scheiben und Scheinwerferglas (durchscheinend, getoent)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    M.meta.teile.forEach((t) => {
      if (t.rolle === 'glas') { setze(aufbau, [0.18, 0.22, 0.27], 0, 0.86, 0, 1); teil(t); }
      if (t.rolle === 'scheinwerferglas') { setze(aufbau, [1, 1, 1], licht ? 0.6 : 0, 0.9, 1, 1); teil(t); }
    });
    // 5. Leuchten: Lichtpunkte (zur Kamera gedreht) und vorn der Lichtkegel auf der Bahn
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const rechts = [blick[0], blick[4], blick[8]], oben = [blick[1], blick[5], blick[9]];
    const punkt = (p, gr, farbe, staerke) => {
      const c = ort(aufbau, p), k = gr * s;
      const e = (a, b) => [c[0] + (rechts[0] * a + oben[0] * b) * k, c[1] + (rechts[1] * a + oben[1] * b) * k, c[2] + (rechts[2] * a + oben[2] * b) * k];
      const q = [e(-1, -1).concat([0, 0]), e(1, -1).concat([1, 0]), e(1, 1).concat([1, 1]), e(-1, 1).concat([0, 1])];
      setze(VF_EINS, farbe, 0, staerke, 1, 0);
      flaeche([q[0], q[1], q[2], q[0], q[2], q[3]], M.glanz);
    };
    if (licht) {
      const vorn = d.laenge / 2 + zSp;
      const kegel = [[0.9, 0.02, vorn, 0.25, 0.5], [-0.9, 0.02, vorn, 0.75, 0.5], [-3.2, 0.02, vorn + 13, 1, 1], [3.2, 0.02, vorn + 13, 0, 1]]
        .map((p) => ort(lage, p).concat(p.slice(3)));
      setze(VF_EINS, [1, 0.95, 0.82], 0, 0.30, 1, 0);
      flaeche([kegel[0], kegel[1], kegel[2], kegel[0], kegel[2], kegel[3]], M.glanz);
      (M.meta.lichter.front && M.meta.lichter.front.length ? M.meta.lichter.front : [[d.breite * 0.35, d.hoehe * 0.5, d.laenge / 2 - 0.15, 0.2], [-d.breite * 0.35, d.hoehe * 0.5, d.laenge / 2 - 0.15, 0.2]])
        .forEach((l) => punkt(l, l[3] * 2.6, [1, 0.96, 0.85], 0.95));
      (M.meta.lichter.rueck && M.meta.lichter.rueck.length ? M.meta.lichter.rueck : [[d.breite * 0.35, d.hoehe * 0.5, -d.laenge / 2 + 0.15, 0.15], [-d.breite * 0.35, d.hoehe * 0.5, -d.laenge / 2 + 0.15, 0.15]])
        .forEach((l) => punkt(l, l[3] * 1.6, [1, 0.1, 0.06], 0.45));
    }
    if (bremst) (M.meta.lichter.brems && M.meta.lichter.brems.length ? M.meta.lichter.brems : [[d.breite * 0.35, d.hoehe * 0.5, -d.laenge / 2 + 0.15, 0.2], [-d.breite * 0.35, d.hoehe * 0.5, -d.laenge / 2 + 0.15, 0.2]])
      .forEach((l) => punkt(l, l[3] * 2.4, [1, 0.08, 0.04], 0.95));
    gl.depthMask(true); gl.disable(gl.BLEND);
    [T.ap, T.an, T.auv].forEach((a) => gl.disableVertexAttribArray(a));
  }
  function vfZeit(ms) { return ms === null || ms === undefined ? '–' : (ms / 1000).toFixed(2) + ' s'; }
  // ---- HUD im Stil von ACC (WIP) -----------------------------------------------------------------
  // BESTELLT: "Aendere im virtuellen Fahren das UI so, dass es so aehnlich wie Assetto Corsa
  // Competizione (ACC) aussieht, nur mit der blauen Akzentfarbe."
  // Kantige, fast schwarze Kacheln mit schmaler Akzentlinie in --k-blau: oben links Zeiten (Modus,
  // Runde, Delta, Letzte, Beste), unten Mitte der Tacho-Block (Drehzahl als Segmentbalken, Gang gross
  // in der Mitte, Tempo links, Drehzahl rechts), daneben Reifen (vier Felder in Temperaturfarbe) und
  // Tank (Wert und Balken). Nichts von vorher faellt weg.
  // KOSTEN: das HUD laeuft je Bild. Die Elemente sind beim Start einmal gesucht (VF.ui), geschrieben
  // wird nur, was sich gegenueber dem letzten Wert (VF.ui.alt) aendert - Texte, eine CSS-Variable
  // (Drehzahl in 20 Stufen, nur clip-path, kein Layout), transform am Tankbalken, Farben der Reifen
  // nur bei ganzem Grad. Keine Layout-Abfragen.
  // DELTA: Zeit dieser Runde gegen die beste Runde am selben Punkt der Mittellinie (VF.splits je
  // Punkt, beim ersten Erreichen), alle 0,1 s mit der Rundenzeit.
  function vfZeitAcc(ms, stellen) {
    if (ms === null || ms === undefined || !isFinite(ms)) return stellen === 1 ? '-:--.-' : '-:--.---';
    // Abgeschnitten wie eine Zeitnahme (nie aufgerundet, also nie "0:60.0").
    const teil = Math.pow(10, stellen), ein = Math.floor(Math.max(0, ms) * teil / 1000);
    const sek = Math.floor(ein / teil), m = Math.floor(sek / 60), s = sek % 60;
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + String(ein % teil).padStart(stellen, '0');
  }
  function vfDeltaText(d) { return d === null ? '--.--' : (d > 0 ? '+' : (d < 0 ? '-' : '')) + Math.abs(d / 1000).toFixed(2); }
  function vfHudBauen(schicht) {
    const q = (sel) => schicht.querySelector(sel);
    VF.ui = { runde: q('.vf-runde'), letzte: q('.vf-letzte'), beste: q('.vf-beste'), delta: q('.vf-delta'), deltaBar: q('.vf-delta-bar > i'),
              modus: q('.vf-modus'), abseits: q('.vf-abseits'), acc: q('.vf-acc'), tempo: q('.vf-acc .vf-tempo'), gang: q('.vf-gang'),
              rpm: q('.vf-rpm'), reifen: Array.from(schicht.querySelectorAll('.vf-reifen > i')), tank: q('.vf-tank'), tankBar: q('.vf-tank-bar > i'),
              dreh: q('.vf-dreh-stab'), kamFrei: q('.vf-kamfrei'), alt: {} };
  }
  function vfHud() {
    const u = VF.ui;
    if (!u) return;
    const A = u.alt, st = physEngine.state;
    const txt = (el, key, v) => { if (A[key] !== v) { A[key] = v; el.textContent = v; } };
    const kmh = Math.round(Math.abs(st.speedKmh || 0) * TACHO_SCALE * (VF.tempoFaktor || 1));   // wie im Cockpit (race-speed)
    // Zeiten: Rundenzeit in 0,1 s, das Delta mit ihr.
    const lauf = VF.rundeAb ? rennZeitJetzt() - VF.rundeAb : null;
    const lq = lauf === null ? null : Math.floor(lauf / 100) * 100;
    if (A.lq !== lq) {
      A.lq = lq;
      u.runde.textContent = vfZeitAcc(lq, 1);
      const ref = VF.besteSplits && lauf !== null ? VF.besteSplits[VF.idx] : undefined;
      const d = ref === undefined ? null : lauf - ref;
      txt(u.delta, 'd', vfDeltaText(d));
      const kl = d === null ? '' : (d > 0 ? 'langsamer' : 'schneller');
      if (A.dk !== kl) { A.dk = kl; u.delta.parentNode.dataset.d = kl; }
      const f = d === null ? 0 : Math.max(-1, Math.min(1, -d / 2000));
      if (A.df !== f) { A.df = f; u.deltaBar.style.transform = 'scaleX(' + f.toFixed(3) + ')'; }
    }
    txt(u.letzte, 'l', vfZeitAcc(VF.letzte, 3));
    txt(u.beste, 'b', vfZeitAcc(VF.beste, 3));
    let modusTxt = '';
    if (VF.modus && RACE_MODES[VF.modus]) {
      if (VF.modus === 'practice') modusTxt = t('Training');
      else {
        modusTxt = RACE_MODES[VF.modus].label;
        if (VF.modus === 'laps') modusTxt += ' · ' + Math.min(VF.runden, VF.limit) + '/' + VF.limit;
        else modusTxt += ' · ' + vfZeit(Math.floor(VF.modusZeit * 1000 / 100) * 100);
      }
    }
    txt(u.modus, 'm', modusTxt);
    if (u.abseits.hidden === VF.abseits) u.abseits.hidden = !VF.abseits;
    const frei = vfKameraGedreht();
    if (u.kamFrei.hidden === frei) u.kamFrei.hidden = !frei;
    // Tacho-Block: Tempo, Gang, Drehzahl, Reifen, Tank - dieselben Werte wie das Cockpit.
    txt(u.tempo, 'v', String(kmh));
    txt(u.rpm, 'r', String(Math.round(motorDrehzahl(st) / 10) * 10));
    const g = st.currentGear;
    txt(u.gang, 'g', g > 0 ? String(g) : (g < 0 ? 'R' : 'N'));
    const t4 = st.tyreTemp4 || [st.tyreTempC];
    for (let i = 0; i < 4; i++) {
      const T = Math.round(t4[i] !== undefined ? t4[i] : t4[0]);
      if (A['t' + i] !== T) { A['t' + i] = T; u.reifen[i].textContent = T + '°'; u.reifen[i].style.background = reifenFarbe(T); }
    }
    const tank = typeof fuel !== 'undefined' ? fuel : 100;
    txt(u.tank, 'f', fuelLiters(tank) + ' L');
    const tf = Math.round(Math.max(0, Math.min(100, tank)));
    if (A.tf !== tf) { A.tf = tf; u.tankBar.style.transform = 'scaleX(' + (tf / 100) + ')'; }
    // Drehzahl in 20 Segmenten; in den letzten zwei blinkt der Gang blau (Schaltlicht).
    const seg = Math.round(Math.max(0, Math.min(1, st.rpmFrac || 0)) * 20);
    if (A.seg !== seg) {
      A.seg = seg;
      u.dreh.style.setProperty('--f', String(seg / 20));
      const schalt = seg >= 19;
      if (A.schalt !== schalt) { A.schalt = schalt; u.acc.classList.toggle('vf-schalt', schalt); }
    }
  }

  // ---- Starten und Beenden ------------------------------------------------------------------
  // opts.tiles: diese Strecke statt der des Editors (die Studie faehrt Homington), opts.studie: die
  // Fahrt gehoert der Studie (beim Beenden nicht in die Garage). true = gestartet.
  function virtuellStarten(opts) {
    opts = opts || {};
    if (VF.aktiv) return false;
    vfHandlingCache = null;   // einmal frisch lesen (z. B. in einem anderen Tab geaendert)
    if (!physicsEnabled) { showHudToast(t('Virtuell braucht ein Fahrgefühl mit Physik (nicht RC)')); return false; }
    // Editor-Strecke und gemerkte Rollen gehoeren dem Fahrer: die Ersatzstrecke (Balkonia) und die Rolle
    // des virtuellen Autos werden beim Beenden wieder zurueckgenommen.
    VF.tilesVorher = currentTrackTiles;
    try { VF.editorVorher = localStorage.getItem(EDITOR_STRECKE_STORE); } catch (e) { VF.editorVorher = undefined; }
    const tiles = opts.tiles && opts.tiles.length >= 3 ? opts.tiles : vfTilesWaehlen();
    if (!tiles) { showHudToast(t('Erst eine Strecke bauen')); return false; }
    VF.studie = !!opts.studie;
    const schicht = document.createElement('div');
    schicht.className = 'vf-schicht';
    const lbl = (txt) => '<span class="vf-lbl">' + txt + '</span>';
    schicht.innerHTML = '<canvas class="vf-bild"></canvas>'
      // Zeiten oben links (ACC: Positions-/Zeitenblock).
      + '<div class="vf-hud vf-kachel" data-i18n-skip><div class="vf-modus"></div>'
      + '<div class="vf-z vf-z-akt">' + lbl(t('Runde')) + '<b class="vf-runde"></b></div>'
      + '<div class="vf-z vf-z-delta">' + lbl(t('Delta')) + '<span class="vf-delta"></span><i class="vf-delta-bar"><i></i></i></div>'
      + '<div class="vf-z">' + lbl(t('Letzte')) + '<span class="vf-letzte"></span></div>'
      + '<div class="vf-z">' + lbl(t('Beste')) + '<span class="vf-beste"></span></div>'
      + '<span class="vf-abseits" hidden>' + t('Neben der Bahn') + '</span></div>'
      // Tacho-Block unten Mitte: Reifen | Drehzahl, Tempo, Gang | Tank.
      + '<div class="vf-acc" data-i18n-skip>'
      + '<div class="vf-kachel vf-acc-reifen">' + lbl(t('Reifen')) + '<div class="vf-reifen"><i></i><i></i><i></i><i></i></div></div>'
      + '<div class="vf-kachel vf-acc-kern"><div class="vf-acc-dreh"><i class="vf-dreh-stab"></i></div>'
      + '<div class="vf-acc-werte"><div class="vf-acc-wert"><b class="vf-tempo"></b>' + lbl('km/h') + '</div>'
      + '<b class="vf-gang"></b><div class="vf-acc-wert"><b class="vf-rpm"></b>' + lbl('1/min') + '</div></div></div>'
      + '<div class="vf-kachel vf-acc-tank">' + lbl(t('Tank')) + '<b class="vf-tank"></b><i class="vf-tank-bar"><i></i></i></div></div>'
      + '<div class="vf-knoepfe"><button type="button" data-vf="licht">' + t('Licht') + '</button><button type="button" data-vf="reset">' + t('Zurücksetzen') + '</button>'
      + '<button type="button" data-vf="zu" aria-label="' + t('Beenden') + '">&#10005;</button></div>'
      + '<span class="vf-kamfrei" hidden data-i18n-skip>' + t('Kamera frei') + ' · R3 / V: ' + t('Standard') + ' <span class="wip-tag">WIP</span></span>'
      + '<span class="vf-wip">' + t('Virtuell') + ' <span class="wip-tag">WIP</span></span>';
    document.body.appendChild(schicht);
    const cv = schicht.querySelector('canvas');
    const gl = cv.getContext('webgl', { antialias: true }) || cv.getContext('experimental-webgl');
    if (!gl) { schicht.remove(); showHudToast(t('Dieses Gerät kann kein WebGL')); return false; }
    try {
      VF.prog = vfProgramm(gl);
    } catch (e) { schicht.remove(); showHudToast('WebGL: ' + e.message); return false; }
    VF.loc = null; VF.lenkIst = 0; VF.kam = null; VF.himmelProg = null; VF.himmel = null;
    // Die Seite unter der 3D-Schicht ruht (kein Neuzeichnen); Startaufstellung, Ampel und Meldungen
    // kommen per CSS darueber (body.vf-an).
    document.body.classList.add('vf-an');
    gl.enable(gl.DEPTH_TEST);
    VF.gl = gl; VF.cv = cv; VF.schicht = schicht; VF.hud = schicht.querySelector('.vf-hud');
    vfHudBauen(schicht);
    vfDrehNull(); VF.stick = null; VF.tasten = {};
    VF.splits = null; VF.besteSplits = null;
    VF.tiles = tiles;
    VF.pts = trackCenterline(tiles);
    VF.nrm = trackNormals(VF.pts);
    // v1.3.39: Flaechen mit Texturen (die Pixel entstehen nur beim ersten Mal) und der feste Platz der
    // Kamera "Fahrer am Rand".
    try { VF.flaeche = vfFlaechenBauen(gl, VF.pts, VF.nrm, tiles); } catch (e) { schicht.remove(); document.body.classList.remove('vf-an'); showHudToast('WebGL: ' + e.message); return false; }
    VF.fahrer = { ort: vfFahrerOrt(VF.pts, VF.nrm, tiles), z: {}, k: null };
    // Das Auto: ein Garagenauto ohne Funk. Ein gesteuertes Auto gibt seine Rolle so lange ab.
    VF.vorherSpieler = playerCar;
    VF.vorherRolle = playerCar ? playerCar.role : null;
    VF.trackModeVorher = trackMode;
    trackMode = 'on';
    // Schaltung fuer die virtuelle Fahrt anwenden (beim Beenden kommt die vorherige wieder).
    VF.autoShiftVorher = physEngine.config.autoShift;
    physEngine.config.autoShift = vfSchaltungAuto();
    const rx = { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async () => {}, writeValueWithResponse: async () => {} };
    const car = { device: { id: 'virtuell', name: 'Virtuell' }, server: null, rx, tx: null, role: 'none', writeInFlight: false,
                  blinking: false, tileCode: 0xff, tileCount: null, lastCodeAt: 0, yaw: 0, ghost: null, timer: null,
                  trennend: false, virtuell: true, alias: t('Virtuell') };
    garage.push(car);
    carAssign(car);
    if (playerCar) setCarRole(playerCar, 'none');
    setCarRole(car, 'player');
    VF.car = car;
    VF.auto = vfAutoBauen(gl, vfHex(carColor(car).hex));
    VF.geistAuto = vfAutoBauen(gl, [0.45, 0.75, 1.0]);
    VF.geist = { an: vfGeistAn(), aufzeichnung: [], aktiv: false, zeit: 0, t: 0, i: 0, x: 0, y: 0, h: 0 };
    VF.modell = null; VF.P = vfHandlingProfil(VF_GT3); VF.feder = null; VF.raddreh = 0;
    VF.tyreTemp = 0;   // v1.3.5: jede Fahrt beginnt mit kalten Reifen (vorher blieb die alte Temperatur stehen)
    VF.tempoFaktor = vfTempoFaktor();
    try { VF.tprog = vfProgrammTex(gl); } catch (e) { VF.tprog = null; }
    if (VF.tprog) {
      vfRadModellBauen(gl).then((rad) => { if (VF.aktiv && VF.gl === gl) VF.radModell = rad; });
      if (vfAutoWahl() !== 'kasten') {
        vfModellDaten().then((daten) => {
          if (!VF.aktiv || VF.gl !== gl) return;
          VF.modell = vfModellBauen(gl, daten);
          VF.P = vfHandlingProfil(vfPhysikAus(daten.meta.physik));
        }).catch(() => showHudToast(t('Auto-Modell nicht ladbar – es fährt der Kasten')));
      }
    }
    // Start eine halbe Kachel vor Start/Ziel, in Fahrtrichtung.
    const s = Math.max(0, VF.pts.findIndex((p) => p.tile >= 0 && tiles[p.tile] && tiles[p.tile].type === TILE_TYPE.START));
    const start = ((s - Math.round(TRACK_SAMPLES_PER_TILE / 2)) % VF.pts.length + VF.pts.length) % VF.pts.length;
    Object.assign(VF, { x: VF.pts[start].x, y: VF.pts[start].y, h: VF.pts[start].heading, idx: start, zaehler: 0, kachel: -2,
                        abseits: false, letzt: 0, kam: null, rundeAb: 0, letzte: null, beste: null, aktiv: true,
                        startX: VF.pts[start].x, startY: VF.pts[start].y, startH: VF.pts[start].heading });
    vfNpcStarten(gl, start);
    physEngine.state.speedKmh = 0;
    schicht.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vf]');
      if (!b) return;
      if (b.dataset.vf === 'zu') virtuellBeenden();
      else if (b.dataset.vf === 'reset') vfZuruecksetzen();
      else if (b.dataset.vf === 'licht') {
        // Dasselbe wie Dreieck im Cockpit: der Schalter im Armaturenbrett bleibt gleich.
        headlightsOn = !headlightsOn;
        const cb = $('dash-head-toggle');
        if (cb) cb.checked = headlightsOn;
        showHudToast(t(headlightsOn ? 'Licht an' : 'Licht aus'));
      }
    });
    VF.dyn = { vy: 0, r: 0 };
    // Rennmodus: Rundenrennen, Endurance, Qualifying und Training werden uebernommen; andere
    // Modi gibt es im virtuellen Fahren nicht - Hinweis und Training als Rueckfall.
    VF.modus = raceMode;
    if (VF.modus !== 'laps' && VF.modus !== 'endurance' && VF.modus !== 'qualifying' && VF.modus !== 'practice') {
      showHudToast(t('Rennmodus im virtuellen Fahren nicht verfügbar') + ' – ' + t('Training'));
      VF.modus = 'practice';
    }
    VF.limit = VF.modus === 'laps' ? Math.max(1, raceLimit) : (VF.modus === 'practice' ? 0 : Math.max(1, raceLimit));
    VF.runden = 0;
    VF.modusZeit = 0;
    VF.rennenEnde = false;
    vfMotorsound();
    if (typeof showTab === 'function') showTab('race');
    VF.takt = setInterval(vfPaket, VF_TAKT_MS);
    VF.raf = requestAnimationFrame(vfBild);
    showHudToast(t('Virtuelle Fahrt: frei fahren, ✕ beendet'));
    return true;
  }
  // ---- Optionen rechts in der Garage (v1.1.3) ---------------------------------------------
  // BESTELLT: "Wenn ich virtuell klicke, dann sollen rechts noch Optionen kommen - aktuell erstmal nur
  // Motorsound, den ich da aus den ueblichen Optionen auswaehlen kann." Dieselbe Liste wie Optionen ->
  // Ton, eigene Wahl fuer die virtuelle Fahrt ("Wie in Optionen" = die dortige). Darunter steht, was
  // der Ton gerade tut - GEMELDET war zweimal "Motorsound funktioniert nicht", und ohne Anzeige ist
  // nicht zu sehen, ob die Aufnahme fehlt, noch laedt oder der Ersatzton spielt.
  const VF_MOTOR_STORE = 'omegasim-vf-motor';
  // "Wie in Optionen" wird als Sentinel gespeichert, damit es sich vom Standard (Vulture V5.R) unterscheidet.
  const VF_MOTOR_GLOBAL = '~global';
  // Standard ist der Vulture V5.R (wie das Auto); "Wie in Optionen" folgt dem globalen Ton (sentinel).
  function vfMotorGewaehlt() {
    const def = ({ v5r: 'sd_v5r', lynx220: 'sd_lynx', fmcgt4: 'sd_fmc', boxer96: 'sd_boxer' })[vfAutoWahl()] || 'sd_v5r';
    try { const v = localStorage.getItem(VF_MOTOR_STORE); return v === null ? def : v; } catch (e) { return def; }
  }
  function vfMotorZiel() { const g = vfMotorGewaehlt(); if (g && g !== VF_MOTOR_GLOBAL) return g; return $('sound-profile') ? $('sound-profile').value : ''; }
  // Wirklich geladen: buffers[k] steht schon als {} da, waehrend die Schleifen noch laden.
  function vfTonGeladen(k) { return !!(k && sampleEngine.buffers[k] && powerBands(k).length); }
  // Aus einem Klick heraus: Tonausgabe anwerfen und die Aufnahmen holen (auch ein zweites Mal, wenn
  // das erste Laden gescheitert ist).
  function vfTonVorbereiten() {
    try {
      if (!soundEnabled) return;
      initEngineSound();
      if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
      if (!sampleEngine.ready && !sampleEngine.loading) loadEngineSamples();
    } catch (e) { /* ohne Ton weiter */ }
  }
  function vfTonStatus() {
    if (!soundEnabled) return t('Ton ist aus (Optionen > Ton).');
    if (location.protocol === 'file:') return t('Direkt von der Festplatte geöffnet: hier lassen sich die Aufnahmen nicht laden, es spielt der Ersatzton. Mit „Start OmegaSim.bat“ starten.');
    if (audioCtx && audioCtx.state !== 'running') return t('Ton wartet auf einen Tipp.');
    const k = vfMotorZiel();
    if (VF.aktiv && sampleEngine.nodes && sampleEngine.car === k) return t('Aufnahme spielt.');
    if (vfTonGeladen(k)) return t('Aufnahme geladen und bereit.');
    if (sampleEngine.loading) return t('Aufnahmen werden geladen …');
    return t('Keine Aufnahmen gefunden – es spielt der Ersatzton.');
  }
  function vfGarageOptionen(rechts) {
    vfTonVorbereiten();
    vfTexturenVorbereiten();   // v1.3.39: Bahn- und Bodentexturen im Leerlauf rechnen
    const kopf = document.createElement('h3');
    kopf.className = 'gar-a-titel';
    kopf.textContent = t('Virtuelles Auto');
    rechts.appendChild(kopf);
    const sel = $('sound-profile');
    const global = sel && sel.selectedIndex >= 0 ? motorNamen(sel.options[sel.selectedIndex]) : '';
    const werte = [{ v: '', name: t('Wie in Optionen') + (global ? ' (' + global + ')' : '') }]
      .concat(sel ? [...sel.options].filter((o) => o.value).map((o) => ({ v: o.value, name: motorNamen(o) })) : []);
    const j = Math.max(0, werte.findIndex((w) => w.v === vfMotorGewaehlt()));
    const wahl = (d) => {
      const n = werte[(j + d + werte.length) % werte.length].v;
      try { localStorage.setItem(VF_MOTOR_STORE, n || VF_MOTOR_GLOBAL); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Motorsound'), werte[j].name, () => wahl(-1), () => wahl(1)));
    // v1.1.9: welches Auto, und wie deutlich die Federung sichtbar neigt.
    const autos = [{ v: 'v5r', name: 'Vulture V5.R (Speed Dreams)' }, { v: 'lynx220', name: 'Lynx 220 (Jaguar XJ220, Speed Dreams)' },
                   { v: 'fmcgt4', name: 'FMC GT4 (Ford GT40 Mk1, Speed Dreams)' }, { v: 'boxer96', name: 'Boxer 96 (Porsche 911 GT3, Speed Dreams)' },
                   { v: 'kasten', name: t('Einfaches Modell') }];
    const ja = Math.max(0, autos.findIndex((a) => a.v === vfAutoWahl()));
    const autoWahl = (dd) => {
      try { localStorage.setItem(VF_AUTO_STORE, autos[(ja + dd + autos.length) % autos.length].v); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Auto'), autos[ja].name, () => autoWahl(-1), () => autoWahl(1)));
    // v1.3.39 (WIP): der Fussboden unter der Bahn, Dielen in echten Massen (siehe VF_BOEDEN).
    const jb = Math.max(0, VF_BOEDEN.findIndex((b) => b.id === vfBodenWahl()));
    const bodenWahl = (dd) => { vfBodenSetzen(VF_BOEDEN[(jb + dd + VF_BOEDEN.length) % VF_BOEDEN.length].id); renderGarage(); };
    const bodenZeile = garWertZeile(t('Boden'), t(VF_BOEDEN[jb].name), () => bodenWahl(-1), () => bodenWahl(1));
    bodenZeile.dataset.vfBoden = '1';
    bodenZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    rechts.appendChild(bodenZeile);
    // Schaltung: Automatik oder Manuell (schalten dann mit I/K).
    const autoSch = vfSchaltungAuto();
    const schaltWahl = () => {
      try { localStorage.setItem(VF_SCHALTUNG_STORE, autoSch ? 'manuell' : 'auto'); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Schaltung'), autoSch ? t('Automatik') : t('Manuell'), schaltWahl, schaltWahl));
    // Handling: GT3 (praezise wie in ACC) oder Schnell (mehr Grip, mehr Einschlag, hoeheres Tempo).
    const hId = vfHandling();
    const hWahl = (dd) => {
      const i = Math.max(0, VF_HANDLING_MODI.findIndex((m) => m.id === hId));
      vfHandlingSetzen(VF_HANDLING_MODI[(i + dd + VF_HANDLING_MODI.length) % VF_HANDLING_MODI.length].id);
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Handling'), vfHandlingName(hId), () => hWahl(-1), () => hWahl(1)));
    // Geist: eine Kopie faehrt nach der ersten Runde die aufgezeichnete Linie ab (Standard an).
    const geistAn = vfGeistAn();
    const geistWahl = () => {
      try { localStorage.setItem(VF_GEIST_STORE, geistAn ? 'aus' : 'an'); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Geist folgt meiner Linie'), geistAn ? t('An') : t('Aus'), geistWahl, geistWahl));
    // NPCs: wie viele andere Autos mitfahren (0-3), zufaellige Skins aus den echten Modellen.
    const nNpc = vfNpcAnzahl();
    const npcWahl = (dd) => {
      try { localStorage.setItem(VF_NPC_STORE, String(Math.max(0, Math.min(3, nNpc + dd)))); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('NPCs'), nNpc === 0 ? t('Aus') : String(nNpc), () => npcWahl(-1), () => npcWahl(1)));
    if (autos[ja].v !== 'kasten') {
      const jf = VF_FEDER_WERTE.indexOf(vfFederSicht());
      const federWahl = (dd) => {
        try { localStorage.setItem(VF_FEDER_STORE, String(VF_FEDER_WERTE[Math.max(0, Math.min(VF_FEDER_WERTE.length - 1, jf + dd))])); } catch (e) { /* egal */ }
        renderGarage();
      };
      rechts.appendChild(garWertZeile(t('Neigung sichtbar'), VF_FEDER_WERTE[jf] + '×', () => federWahl(-1), () => federWahl(1)));
    }
    const status = document.createElement('p');
    status.className = 'muted vf-ton-status';
    status.textContent = vfTonStatus();
    rechts.appendChild(status);
    const iv = setInterval(() => {
      if (!status.isConnected) { clearInterval(iv); return; }
      const s = vfTonStatus();
      if (status.textContent !== s) status.textContent = s;
    }, 500);
    const z = document.createElement('div');
    z.className = 'opt-row opt-breit gar-a-aktion';
    const los = document.createElement('button');
    los.type = 'button';
    los.className = 'primary';
    los.dataset.vf = 'los';
    los.textContent = t('Losfahren');
    los.onclick = () => virtuellStarten();
    z.appendChild(los);
    rechts.appendChild(z);
  }

  // v1.3.39 BESTELLT: "Verbessere den Randstein-Sound. Aktuell ist es ein hohes Klicken ... Es soll
  // dumpf sein, eher wie bei Assetto Corsa Competizione." Das Rumpeln selbst steht in 80-sound.js
  // (randsteinKlang); hier nur, was die Bahn dazu weiss:
  //   Takt  = Rippen je Sekunde = VF_KERB_RIPPEN * Weg je Sekunde / Laenge eines Farbfelds. Ein Farbfeld
  //           (rot oder weiss) sind zwei Mittellinienpunkte (vfTilesWaehlen: Math.floor(i / 2) % 2), also
  //           2 * TRACK_STEP / TRACK_SAMPLES_PER_TILE Einheiten auf der Geraden. Drei Rippen je Feld:
  //           Tacho 40 km/h -> 8, 120 km/h -> 24, ab 200 km/h 40 Schlaege/s (Grenzen 8..40).
  //   Menge = wie weit das Auto auf dem Stein ist (0 = Kante beruehrt, 1 = Mitte auf dem Rand) und Tempo.
  // Mit "Randstein-Klang: alt" bleibt das neue Rumpeln stumm und vfRattern spielt wie bis v1.3.38.
  const VF_KERB_STREIFEN = 2 * TRACK_STEP / TRACK_SAMPLES_PER_TILE;
  const VF_KERB_RIPPEN = 3;
  function vfRandsteinTakt(kmh) {
    const vE = Math.abs(kmh) / 3.6 * 100 * TRACK_UNITS_PER_CM;
    return Math.max(8, Math.min(40, VF_KERB_RIPPEN * vE / VF_KERB_STREIFEN));
  }
  function vfRandsteinMenge(kerb, q, kmh) {
    if (!kerb || randsteinKlangAlt || !(Math.abs(kmh) > 0.05)) return 0;
    const tiefe = Math.max(0, Math.min(1, (q - (TRACK_HALF_W - VF_AUTO.B * 0.5)) / (VF_AUTO.B * 0.5)));
    return (0.45 + 0.55 * tiefe) * Math.min(1, 0.35 + Math.abs(kmh) * TACHO_SCALE / 160);
  }
  function vfRandsteinTon(kerb, q, kmh) {
    randsteinKlang(vfRandsteinMenge(kerb, q, kmh), vfRandsteinTakt(kmh));
  }

  // v1.2.62: ein kurzes "Rattern" (weisses Rauschen) fuer die Randsteine, ueber audioCtx (80-sound.js).
  // Seit v1.3.39 nur noch mit dem Schalter "Randstein-Klang: alt".
  // BESTELLT: Latenz. Korrektur nach 1.2.66: der Rauschpuffer (60 ms, abklingend) wird EINMAL je
  // AudioContext angelegt und wiederverwendet. Vorher entstand alle 70 ms ein neuer Puffer samt
  // 2.880 Zufallszahlen - Muell fuer die Speicherbereinigung, die auf schwachen Handys als
  // Ruckler im Bild und im Funktakt ankommt. Ein AudioBuffer darf von beliebig vielen
  // BufferSources gleichzeitig gespielt werden.
  let vfRatternPuffer = null, vfRatternCtx = null;
  function vfRattern(staerke) {
    if (!audioCtx || !soundEnabled) return;
    try {
      if (!vfRatternPuffer || vfRatternCtx !== audioCtx) {
        const dauer = 0.06, n = Math.max(1, Math.floor(audioCtx.sampleRate * dauer));
        const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        vfRatternPuffer = buf; vfRatternCtx = audioCtx;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = vfRatternPuffer;
      const g = audioCtx.createGain();
      g.gain.value = staerke;
      src.connect(g); g.connect(audioCtx.destination);
      src.start();
    } catch (e) { /* ohne Ton */ }
  }

  // v1.1.3 GEMELDET: "ein komischer hoher Ton ab und zu" und BESTELLT "auch Motorensounds". Ohne
  // gestarteten Aufnahme-Motor spielt die App den einfachen Oszillator (ein Ton, der mit der Drehzahl
  // steigt). Der Start ist ein Klick, also darf der Ton hier anlaufen: Aufnahmen laden und den
  // gewaehlten Motor starten, sonst den ersten geladenen.
  // Der gewaehlte Motor (Optionen rechts in der Garage). Ist er noch nicht geladen, spielt solange ein
  // geladener, und der Takt wechselt, sobald der gewaehlte da ist. Beim Beenden kommt der vorherige
  // Motor wieder.
  function vfMotorsound() {
    try {
      if (!soundEnabled) return;
      vfTonVorbereiten();
      VF.motorVorher = sampleEngine.nodes ? sampleEngine.car : null;
      const starte = () => {
        const k = vfMotorZiel();
        const nimm = vfTonGeladen(k) ? k : SAMPLE_CARS.find(vfTonGeladen);
        if (!nimm) return false;
        if (!(sampleEngine.nodes && sampleEngine.car === nimm)) {
          if (!startSampleEngine(nimm)) return false;
          VF.motorVonUns = true;
        }
        return nimm === k || (!sampleEngine.loading && !vfTonGeladen(k));
      };
      clearInterval(VF.tonIv);
      if (!starte()) {
        let n = 0;
        VF.tonIv = setInterval(() => { n++; if (!VF.aktiv || starte() || n > 240) clearInterval(VF.tonIv); }, 250);
      }
    } catch (e) { /* ohne Ton weiterfahren */ }
  }
  function virtuellBeenden() {
    rennPauseBeenden();
    if (!VF.aktiv) return;
    // Laeuft eine Challenge (z. B. die Studienfahrt) mit dem virtuellen Auto, endet sie mit: abgebrochen,
    // nicht gewertet (VF.abbruch sagt das der Studie, 98f-studie.js).
    if (typeof chLauf !== 'undefined' && chLauf) {
      VF.abbruch = true;
      try { if (kRennenLaeuft()) requestRaceStop(); else challengeAbbrechen(); } catch (e) { /* weiter */ }
      VF.abbruch = false;
    }
    VF.aktiv = false;
    VF.npcs = null; VF.npcBogen = null; VF.npcRunde = 0;
    document.body.classList.remove('vf-an');
    cancelAnimationFrame(VF.raf);
    clearInterval(VF.takt);
    const car = VF.car;
    VF.car = null;
    if (car) removeCar(car);
    try {
      const r = JSON.parse(localStorage.getItem(CAR_ROLLEN_STORE) || '{}');
      if (r && r.virtuell) { delete r.virtuell; localStorage.setItem(CAR_ROLLEN_STORE, JSON.stringify(r)); }
    } catch (e) { /* egal */ }
    if (VF.tilesVorher !== undefined && currentTrackTiles !== VF.tilesVorher) {
      currentTrackTiles = VF.tilesVorher;
      if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
      try {
        if (VF.editorVorher === null) localStorage.removeItem(EDITOR_STRECKE_STORE);
        else if (VF.editorVorher !== undefined) localStorage.setItem(EDITOR_STRECKE_STORE, VF.editorVorher);
      } catch (e) { /* egal */ }
    }
    VF.tilesVorher = undefined;
    // Den selbst gestarteten Motor wieder aus, wenn kein echtes Auto mehr da ist.
    clearInterval(VF.tonIv);
    try {
      if (VF.motorVorher && sampleEngine.car !== VF.motorVorher) startSampleEngine(VF.motorVorher);
      else if (VF.motorVonUns && !VF.motorVorher && !garage.length) stopSampleEngine();
    } catch (e) { /* egal */ }
    VF.motorVonUns = false; VF.motorVorher = null;
    if (VF.vorherSpieler && garage.indexOf(VF.vorherSpieler) >= 0 && VF.vorherRolle) setCarRole(VF.vorherSpieler, VF.vorherRolle);
    trackMode = VF.trackModeVorher || trackMode;
    if (VF.autoShiftVorher !== undefined) physEngine.config.autoShift = VF.autoShiftVorher;
    VF.autoShiftVorher = undefined;
    if (VF.schicht) VF.schicht.remove();
    VF.schicht = null; VF.gl = null; VF.flaeche = null; VF.fahrer = null; VF.ui = null; VF.stick = null; VF.tasten = {};
    renderGarage();
    // Zurueck in die Garage, wo die Optionen der virtuellen Fahrt stehen (dort startet die naechste).
    // Eine Studienfahrt geht zurueck in die Studie (98f-studie.js zeigt sie selbst).
    if (!VF.studie && typeof showTab === 'function') showTab('garage');
    VF.studie = false;
  }
  window.addEventListener('keydown', (e) => { if (VF.aktiv && e.key === 'Escape') { e.stopImmediatePropagation(); virtuellBeenden(); } }, true);
