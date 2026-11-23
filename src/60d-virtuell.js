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
  // v1.3.125: Option "Kein Tempoverlust neben der Bahn" (Vorgabe Aus = das Auto bremst wie bisher).
  // 'aus' schaltet den Tempoverlust ab, das Auto faehrt neben der Bahn ungebremst weiter.
  const VF_ABSEITS_BREMSE_STORE = 'omegasim-vf-abseits-bremse';
  function vfAbseitsBremseAn() {
    try { return localStorage.getItem(VF_ABSEITS_BREMSE_STORE) !== 'aus'; } catch (e) { return true; }
  }
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
  // v1.5.84 BESTELLT: "Fallback-Strecke soll eine Boxengasse haben (ersten beiden Geraden nach Start/Ziel kannst du durch
  // Boxengasse ersetzen)". Balkonia wie in der Challenge (SG2RLGR3...), nur G2 -> B: das Boxenteil ist so lang wie zwei
  // Geraden, die Form der Strecke bleibt. Die Challenge selbst bleibt unveraendert.
  const VF_ERSATZ_CODE = 'SBRLGR3LGHLGLJR4G3R2@270';
  function vfTilesWaehlen() {
    if (currentTrackTiles && currentTrackTiles.length >= 3) return currentTrackTiles;
    const p = codeToTrack(VF_ERSATZ_CODE);
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
      'attribute vec3 p; attribute vec3 c; uniform mat4 m; uniform mat4 w; uniform vec3 aug; varying vec3 vc; varying float vd; varying float vsd;'
      + 'void main(){ vec4 q = w * vec4(p, 1.0); gl_Position = m * q; vc = c; vd = gl_Position.w;' + ' vec2 dd_ = q.xz - aug.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vc; varying float vd; varying float vsd; uniform vec3 nebel; uniform vec3 dunst; uniform float alf; uniform vec3 sonne;'
      + 'void main(){ float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(vc * sonne, mix(nebel, dunst, vsd * vsd), f), alf); }'));
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
  // Himmel: ein Vollbild-Quad in NDC. Der Farbverlauf wird im WELTRAUM gerechnet und bleibt beim
  // Umsehen am Horizont (v1.3.124). Die (ungenormte) Blickrichtung ist im Bild linear - sie wird je
  // ECKE aufgespannt und interpoliert; im Pixel bleibt nur Normieren und Mischen. Die Kamerabasis kommt
  // als Zahlen (uniform3f), ohne Arrays je Bild.
  function vfProgrammHimmel(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; uniform vec3 right; uniform vec3 up; uniform vec3 fwd; uniform vec2 halb; varying vec3 vdir;'
      + 'void main(){ gl_Position = vec4(p, 1.0); vdir = fwd + right * (p.x * halb.x) + up * (p.y * halb.y); }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      // v1.5 BESTELLT ("skybox ... damit der Horizont nicht so kahl aussieht"): eigene Wolken aus Rauschen (4 Lagen) auf
      // einer gedachten Wolkendecke, die langsam zieht, und ein Schein um die Sonne. highp, wo es das gibt: das Rauschen
      // braucht die Genauigkeit (mediump liefert auf Handys Streifen).
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n'
      + 'varying vec3 vdir; uniform vec3 horizont; uniform vec3 zenit; uniform float wolken; uniform float zeit; uniform float regen;'
      + 'uniform vec3 dunst; uniform float umwelt; uniform vec3 unten;'
      + 'float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }'
      + 'float rs(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);'
      + ' return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }'
      + 'float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * rs(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }'
      // v1.5.94 (G2): natuerlicherer Verlauf - am Horizont schnell, nach oben langsam tiefer, ein heller Saum am Horizont.
      + 'void main(){ vec3 d = normalize(vdir); float h = pow(clamp(d.y + 0.03, 0.0, 1.0), 0.55);'
      + ' vec3 c = mix(horizont, zenit, h) + vec3(0.07, 0.065, 0.05) * exp(-abs(d.y) * 16.0);'
      // v1.5.94 (G3): zur Sonne hin heller und waermer in Horizontnaehe (dieselbe Farbe wie der Dunst in der Ferne).
      + ' vec2 hz = d.xz * inversesqrt(dot(d.xz, d.xz) + 0.0001); float sd = max(dot(hz, vec2(0.8137, 0.5812)), 0.0);'
      + ' c = mix(c, dunst, sd * sd * pow(1.0 - h, 3.0));'
      + ' float s = max(dot(d, normalize(vec3(0.35, 0.9, 0.25))), 0.0); c += vec3(1.0, 0.92, 0.78) * (pow(s, 48.0) * 0.45 + pow(s, 5.0) * 0.10);'
      + ' if (d.y > 0.015 && wolken > 0.0) {'
      + '  vec2 uv = d.xz / d.y * 0.55 + vec2(zeit * 0.006, zeit * 0.002);'
      + '  float n = fbm(uv * 1.6);'
      + '  float dichte = smoothstep(0.62 - 0.22 * regen - 0.18 * wolken, 0.92, n) * smoothstep(0.015, 0.22, d.y);'
      + '  vec3 wf = mix(mix(vec3(0.98), horizont, 0.25), vec3(0.52, 0.55, 0.60), regen) * (0.82 + 0.18 * smoothstep(0.4, 0.9, n));'
      + '  c = mix(c, wf, clamp(dichte, 0.0, 1.0) * 0.92); }'
      // Nur fuer die Umgebungskarte (G2): unter dem Horizont der Boden.
      + ' if (umwelt > 0.5 && d.y < 0.0) c = mix(c, unten, smoothstep(0.0, 0.1, -d.y));'
      + ' gl_FragColor = vec4(c, 1.0); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, ap: gl.getAttribLocation(p, 'p'), right: gl.getUniformLocation(p, 'right'),
             up: gl.getUniformLocation(p, 'up'), fwd: gl.getUniformLocation(p, 'fwd'), halb: gl.getUniformLocation(p, 'halb'),
             horizont: gl.getUniformLocation(p, 'horizont'), zenit: gl.getUniformLocation(p, 'zenit'),
             wolken: gl.getUniformLocation(p, 'wolken'), zeit: gl.getUniformLocation(p, 'zeit'), regen: gl.getUniformLocation(p, 'regen'),
             dunst: gl.getUniformLocation(p, 'dunst'), umwelt: gl.getUniformLocation(p, 'umwelt'), unten: gl.getUniformLocation(p, 'unten') };
  }
  function vfHimmel(gl) {
    const a = [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0];
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW);
    return { b, n: 6 };
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
    // v1.5 BESTELLT: "als weitere Bodenart (Standard) den Rasen ... mit Baeumen in der Ferne, damit der Horizont nicht so
    // kahl aussieht". Eigener Rasen (kein Code aus uno-com-escada, das ist PolyForm Noncommercial): nahtlose Fliesen aus
    // Rauschen in drei Lagen und kurzen Halmen, im Dielenraster ohne Fugen gelegt. Baeume: vfBaeumeBauen.
    { id: 'rasen', name: 'Rasen', art: 'rasen', breiteCm: 120, laengeCm: 120, spalten: 2, zeilen: 1,
      ton: [[46, 78, 32], [72, 106, 44], [104, 116, 58]], maser: [0, 0, 0], kontrast: 0, ringCm: 1, poren: 0, ast: 0, glanz: 0.0 },
  ];
  const VF_ATLAS_B = 2048, VF_ATLAS_H = 1024;   // Bodenatlas (8 MB, mit Mipmaps 10,7 MB)
  // v1.5.88 BESTELLT: "Textur der Strecke verbessern (höhere Auflösung des Belages und der Randstreifen) - sieht vor allem
  // in Motorhaubenkamera nicht so gut aus". Doppelte Aufloesung in beiden Richtungen: Fahrbahn 20 statt 10 px je cm quer
  // und 48 statt 24 px je cm laengs, Randstreifen 512 x 2048. Alles, was in Pixeln gemessen war (Fugen, Striche im
  // Randstreifen, Abrieb), ist mit VF_TEX_K mitgewachsen; was in cm gezeichnet wird, bleibt gleich gross, nur schaerfer.
  const VF_TEX_K = 2;
  const VF_BAHN_TEX = 1024 * VF_TEX_K, VF_BAHN_SPALTE = 256 * VF_TEX_K;   // Fahrbahn: 4 Teile nebeneinander (3 gebraucht, 1 Start/Ziel)
  // v1.5.84: Ort der Ziellinie auf dem Startteil (Anteil der Laenge in Fahrtrichtung), fuer Textur und Rundenzaehlung.
  const VF_ZIEL_ANTEIL = 0.8;
  const VF_RAND_B = 256 * VF_TEX_K, VF_RAND_H = 1024 * VF_TEX_K;   // Randstreifen: blau | rot, 4 Pfeiltakte uebereinander
  const VF_FUGE = 0.07;                          // halbe Steckfuge in Einheiten (zusammen ~1,5 mm)
  const VF_FUGE_FARBE = [0.22, 0.22, 0.23];
  // Gemerkte Pixel (einmal je Sitzung) und wie oft sie erzeugt wurden (Selbsttest).
  const vfTexDaten = { bahn: null, rand: null, boden: null, bodenId: null };
  const vfTexZaehler = { bahn: 0, rand: 0, boden: 0 };
  function vfBodenWahl() {
    // Freie Strecken (nur virtuell) liegen immer auf Rasen.
    if (VF.frei || (!VF.aktiv && VF.frei === undefined && typeof vfFreiWahl === 'function' && vfFreiWahl())) return 'rasen';
    // v1.5: Rasen ist der Standard (ohne gespeicherte Wahl).
    try { const v = localStorage.getItem(VF_BODEN_STORE); return VF_BOEDEN.some((b) => b.id === v) ? v : 'rasen'; } catch (e) { return 'rasen'; }
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
  // v1.5: ein Rasenstueck, nahtlos in sich (Rauschen mit umlaufendem Gitter, Halme laufen ueber den Rand und kommen auf
  // der anderen Seite wieder herein): neben sich selbst gelegt gibt es keine Kante. Ein Generator, der alle 64 Zeilen
  // zurueckgibt, damit das Erzeugen beim Start nicht ruckelt.
  function* vfGrasStueck(d, AW, x0, y0, w, h, P, rnd) {
    x0 = Math.round(x0); y0 = Math.round(y0); w = Math.round(w); h = Math.round(h);
    const lage = (n, gew) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); return { n, gew, g }; };
    const lagen = [lage(6, 0.45), lage(14, 0.33), lage(40, 0.22)], trocken = lage(5, 1);
    const glatt = (t) => t * t * (3 - 2 * t);
    const rausch = (L, u, v) => {
      const n = L.n, x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y), fx = glatt(x - xi), fy = glatt(y - yi);
      const a = L.g[(yi % n) * n + (xi % n)], b = L.g[(yi % n) * n + ((xi + 1) % n)];
      const c = L.g[((yi + 1) % n) * n + (xi % n)], e = L.g[((yi + 1) % n) * n + ((xi + 1) % n)];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
    };
    const [dunkel, hell, gelb] = P.ton, a = Math.round(P.glanz * 255);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        let n = 0;
        for (const L of lagen) n += rausch(L, u, v) * L.gew;
        const t = Math.max(0, Math.min(1, (n - 0.25) * 1.9)), tr = Math.max(0, rausch(trocken, u, v) - 0.62) * 1.6;
        const i = ((y0 + y) * AW + x0 + x) * 4;
        for (let k = 0; k < 3; k++) d[i + k] = (dunkel[k] + (hell[k] - dunkel[k]) * t) * (1 - tr) + gelb[k] * tr;
        d[i + 3] = a;
      }
      if ((y & 63) === 63) yield;
    }
    // Halme: kurze Striche, etwas heller oder dunkler als der Grund, ueber den Rand umlaufend.
    const halme = Math.round(w * h / 22);
    for (let k = 0; k < halme; k++) {
      let x = rnd() * w, y = rnd() * h;
      const lang = 3 + rnd() * 9, wi = rnd() * Math.PI * 2, dx = Math.cos(wi), dy = Math.sin(wi);
      const f = rnd() < 0.55 ? 1.08 + rnd() * 0.12 : 0.78 + rnd() * 0.12;
      for (let s = 0; s < lang; s++, x += dx, y += dy) {
        const xi = ((Math.floor(x) % w) + w) % w, yi = ((Math.floor(y) % h) + h) % h;
        const i = ((y0 + yi) * AW + x0 + xi) * 4;
        d[i] = Math.min(255, d[i] * f); d[i + 1] = Math.min(255, d[i + 1] * f); d[i + 2] = Math.min(255, d[i + 2] * f);
      }
      if ((k & 16383) === 16383) yield;
    }
  }
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
    const rnd = vfZufall(P.id === 'eiche' ? 1911 : P.id === 'grau' ? 2701 : P.id === 'rasen' ? 5150 : 3307);
    const w = AW / P.spalten, h = AH / P.zeilen, stuecke = [];
    for (let r = 0; r < P.zeilen; r++) {
      for (let s = 0; s < P.spalten; s++) {
        if (P.art === 'rasen') yield* vfGrasStueck(d, AW, s * w, r * h, w, h, P, rnd);
        else vfHolzStueck(d, AW, s * w, r * h, w, h, P, rnd);
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
        // Fuge, Halbschatten und Fase je VF_TEX_K Zeilen (gleich breit in cm wie bei 1024 px).
        const ry = Math.min(y, H - 1 - y) / VF_TEX_K | 0;
        const fuge = ry === 0, halb = ry === 1, fase = ry === 2;
        for (let x = 0; x < SW; x++) {
          const fi = y * SW + x, sp = spur[x];
          // Korn in zwei Groessen: das alte (je VF_TEX_K Pixel) und ein feines darin, das erst nah sichtbar wird.
          let v = 30 + fleck[fi] * 2.6 + (vfHash(s * 256 + (x / VF_TEX_K | 0), y / VF_TEX_K | 0) - 0.5) * 5
            + (vfHash(s * SW + x + 7001, y + 3001) - 0.5) * 3.5 - sp * 1.6;
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
      g.beginPath(); g.rect(s * SW, 3 * VF_TEX_K, SW, H - 6 * VF_TEX_K); g.clip();
      g.setTransform(pxB, 0, 0, pxL, s * SW, 0);       // ab hier in cm
      if (s === 3) {
        // Start/Ziel wie auf dem Foto: zwei Reihen weisser Kaestchen, versetzt, mit einer Linie dazwischen.
        // v1.5.84 GEMELDET: "Startgerade hat die Ziellinie an der falschen Stelle (müsste später kommen)". Auf dem
        // echten Teil liegt sie bei 78-84 % (Mitschnitte, siehe handleDashboardBytes); die Mitte steht jetzt bei
        // VF_ZIEL_ANTEIL der Laenge, dort zaehlt auch die Runde (vfZielIdx).
        g.fillStyle = 'rgb(226,227,229)';
        const kb = 0.95, kl = 0.85, y0 = 43 * VF_ZIEL_ANTEIL - kl - 0.175;
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
        const p = y * W + x, v = 236 + fleck[p] * 5 + (vfHash(x / VF_TEX_K | 0, (y / VF_TEX_K | 0) + 9000) - 0.5) * 6, i = p * 4;
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
        const x = x0 + Math.pow(rnd(), 2) * SB * 0.5, y = rnd() * H, lang = (20 + rnd() * 110) * VF_TEX_K;
        g.strokeStyle = 'rgba(25,25,28,' + (0.04 + rnd() * 0.12).toFixed(3) + ')';
        g.lineWidth = (1 + rnd() * 3) * VF_TEX_K;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y + lang); g.stroke();
      }
      for (let k = 0; k < 26; k++) {
        const x = x0 + rnd() * SB, y = rnd() * H, w = rnd() < 0.5 ? (rnd() - 0.5) * 0.8 : rnd() * Math.PI, lang = (4 + Math.pow(rnd(), 2) * 36) * VF_TEX_K;
        g.strokeStyle = 'rgba(105,108,115,' + (0.05 + rnd() * 0.16).toFixed(3) + ')';
        g.lineWidth = (0.5 + rnd() * 0.7) * VF_TEX_K;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(w) * lang, y + Math.cos(w) * lang); g.stroke();
      }
      for (let k = 0; k < 8; k++) {
        const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        r.addColorStop(0, 'rgba(110,105,95,0.13)'); r.addColorStop(1, 'rgba(110,105,95,0)');
        g.save(); g.translate(x0 + rnd() * SB, rnd() * H); g.scale((10 + rnd() * 30) * VF_TEX_K, (20 + rnd() * 70) * VF_TEX_K);
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
  // Aus PR 4 von gnen54: v < -0,5 heisst reines Weiss ohne Textur (Randstriche und Baender der freien Strecken;
  // aus der Randstein-Textur gelesen wurden sie in der Ferne hellblau/rosa).
  // Programm fuer Boden, Fahrbahn und Randsteine: Textur mal Eckfarbe, plus Glanz (Fresnel mal Alpha der
  // Textur, Staerke je Flaeche und Bodenart), Nebel wie im Rest der Szene. Gerechnet in mediump (auf
  // Handys halbe Genauigkeit, schneller), nur die Texturkoordinate in highp, wo vorhanden: die Randsteine
  // zaehlen v je Teil bis ~8 hoch, in 16 Bit waeren das 4 Texel Fehler.
  // ZWEI PROGRAMME statt einem mit Verzweigung (Review nach 1.3.131): Performance ist wieder genau der
  // Shader von 1.3.92 (Glanz je Ecke, keine Weltposition, kein Schatten), Quality rechnet linear mit
  // Tonemapping, Glanz je Pixel, Relief und Schattenkarte. Eine Verzweigung auf ein uniform kostete die
  // schwachen Handys die Varyings und Register des teuren Zweigs mit.
  const VF_HP = '#ifdef GL_FRAGMENT_PRECISION_HIGH\n#define HP highp\n#else\n#define HP mediump\n#endif\n';
  function vfProgrammFlaeche(gl, qual) {
    const p = gl.createProgram();
    if (!qual) {
      gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
        'attribute vec3 p; attribute vec2 uv; attribute vec3 c; uniform mat4 m; uniform vec3 auge; uniform float glanz;'
        + 'varying vec2 vuv; varying vec3 vc; varying float vd; varying float vg; varying float vsd;'
        + 'void main(){ gl_Position = m * vec4(p, 1.0); vuv = uv; vc = c; vd = gl_Position.w;'
        + ' float e = 1.0 - max(normalize(auge - p).y, 0.0); vg = glanz * e * e * e;' + ' vec2 dd_ = p.xz - auge.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
      gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
        'precision mediump float;\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nvarying highp vec2 vuv;\n#else\nvarying vec2 vuv;\n#endif\n'
        + 'varying vec3 vc; varying float vd; varying float vg; varying float vsd; uniform sampler2D tx; uniform vec3 nebel; uniform vec3 dunst; uniform vec3 sonne;'
        + 'void main(){ vec4 t = vuv.y < -0.5 ? vec4(0.93, 0.93, 0.94, 1.0) : texture2D(tx, vuv); vec3 c = (t.rgb * vc + vec3(0.80, 0.86, 0.95) * (vg * t.a)) * sonne;'
        + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, mix(nebel, dunst, vsd * vsd), f), 1.0); }'));
    } else {
      // Quality. Blickvektor und Schattenkoordinaten entstehen im Vertexshader (dort immer highp) und
      // kommen relativ bzw. in [0,1] an: Weltkoordinaten bis ~3000 waren im Pixel (mediump, 10 Bit
      // Mantisse) nur auf Einheiten genau - der Schatten traf daneben, der Glanz flackerte nahe der Kamera.
      // Licht: Boden waagerecht, Sonne (0.35, 0.9, 0.25) normiert -> N.L = 0.9022 (fest, eingesetzt).
      gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
        'attribute vec3 p; attribute vec2 uv; attribute vec3 c; uniform mat4 m; uniform mat4 schM; uniform vec3 auge;'
        + 'varying vec2 vuv; varying vec3 vc; varying float vd; varying vec3 vv; varying vec3 vsp; varying float vsd;'
        + 'void main(){ gl_Position = m * vec4(p, 1.0); vuv = uv; vc = c; vd = gl_Position.w; vv = auge - p;'
        + ' vsp = (schM * vec4(p, 1.0)).xyz * 0.5 + 0.5;' + ' vec2 dd_ = p.xz - auge.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
      gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
        'precision mediump float;\n' + VF_HP
        + 'varying HP vec2 vuv; varying HP vec3 vsp; varying vec3 vc; varying float vd; varying vec3 vv; varying float vsd; uniform vec3 dunst;'
        + 'uniform sampler2D tx; uniform vec3 nebel; uniform sampler2D sch; uniform float schatt; uniform float glanz;'
        + 'uniform float belichtung; uniform float bump; uniform HP float bias; uniform HP float biasPixel; uniform vec3 sonne;'
        + 'vec3 filmic(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }'
        + 'HP float schTiefe(HP vec4 v){ return dot(v, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }'
        + 'void main(){'
        + ' vec4 t = vuv.y < -0.5 ? vec4(0.93, 0.93, 0.94, 1.0) : texture2D(tx, vuv);'
        + ' vec3 c = pow(t.rgb, vec3(2.2)) * vc * (vec3(0.32, 0.32, 0.34) + 0.85 * 0.9022);'
        + ' float e = 1.0 - max(normalize(vv).y, 0.0); c += vec3(0.80, 0.86, 0.95) * (glanz * e * e * e * t.a);'
        + ' if (bump > 0.01 && vuv.y > -0.5) { float dU = texture2D(tx, vuv + vec2(1.0/512.0, 0.0)).r - t.r; c += vec3(dU) * bump * 0.8; }'
        // max(0): das Relief zieht an dunklen Fugen unter 0, und filmic(x < 0) kippt einzelne Kanaele
        // auf 0 oder 1 (lila Linien am Boden in 1.3.124-1.3.131).
        + ' c = pow(filmic(max(c, vec3(0.0)) * belichtung), vec3(1.0/2.2)) * sonne;'
        + ' if (schatt > 0.5 && vsp.x > 0.0 && vsp.x < 1.0 && vsp.y > 0.0 && vsp.y < 1.0 && vsp.z > 0.0 && vsp.z <= 1.0) {'
        + '   HP float b = vsp.z - bias; float s = 0.0;'
        + '   for (int ox = -1; ox <= 1; ox++) for (int oy = -1; oy <= 1; oy++)'
        + '     s += step(schTiefe(texture2D(sch, vsp.xy + vec2(float(ox), float(oy)) * biasPixel)), b);'
        + '   c *= mix(1.0, 0.42, s / 9.0); }'
        + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, mix(nebel, dunst, vsd * vsd), f), 1.0); }'));
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['m', 'auge', 'glanz', 'tx', 'nebel', 'dunst', 'sonne', 'sch', 'schM', 'schatt', 'belichtung', 'bump', 'bias', 'biasPixel'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, u, qual: !!qual, ap: gl.getAttribLocation(p, 'p'), auv: gl.getAttribLocation(p, 'uv'), ac: gl.getAttribLocation(p, 'c') };
  }
  // Letzter Rueckfall, wenn kein Flaechenshader kompiliert: das einfache Eckfarben-Programm (VF.prog)
  // auf denselben Puffern - ohne Texturen, aber die Fahrt laeuft weiter statt abzubrechen.
  function vfProgrammFlaecheEinfach(gl, prog) {
    return { p: prog, einfach: true, qual: false, u: { m: gl.getUniformLocation(prog, 'm'), w: gl.getUniformLocation(prog, 'w'),
             nebel: gl.getUniformLocation(prog, 'nebel'), alf: gl.getUniformLocation(prog, 'alf'),
             dunst: gl.getUniformLocation(prog, 'dunst'), aug: gl.getUniformLocation(prog, 'aug') },
             ap: gl.getAttribLocation(prog, 'p'), auv: -1, ac: gl.getAttribLocation(prog, 'c') };
  }
  // Ecke: x y z u v r g b (8 Zahlen); Viereck aus vier Ecken [x, y, z, u, v] mit einer Farbe.
  function vfViereck(a, e0, e1, e2, e3, c) {
    for (const e of [e0, e1, e2, e0, e2, e3]) a.push(e[0], e[1], e[2], e[3], e[4], c[0], c[1], c[2]);
  }
  // ---- v1.5.84: BOXENGASSE ----
  // Das echte Boxenteil (photos/boxengasse.png): doppelte Gerade, rechts (rote Randsteine) eine Bucht, die in den ersten
  // 20 % weich aufgeht, dann gut eine Fahrbahnhaelfte (VF_BOX_TIEFE x halbe Breite) breit bleibt und in den letzten 20 %
  // zurueckgeht. In der Bucht weisse Parkstriche, an der Fahrbahnkante eine Punktreihe. Seite wie im Editor (-1 = rechts,
  // siehe 60-track.js "Pit bulge").
  let VF_BOX_SEITE = -1;   // Boxenseite: -1 = rechts (Editor), freie Strecken setzen sie um (boxSeite)
  const VF_BOX_TIEFE = 1.1, VF_BOX_RAMPE = 0.2;
  function vfBoxForm(u) {
    const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    return u < VF_BOX_RAMPE ? sm(u / VF_BOX_RAMPE) : u > 1 - VF_BOX_RAMPE ? sm((1 - u) / VF_BOX_RAMPE) : 1;
  }
  // Je Punkt der Mittellinie: wie weit die Fahrbahn auf der Boxenseite ueber die halbe Breite hinausgeht (Einheiten),
  // und der Anteil u im Boxenteil (-1 ausserhalb). Abschnitt i gehoert zum Teil pts[i+1].tile (wie vfBahnGeometrie).
  function vfBoxBucht(pts, tiles) {
    const n = pts.length, b = new Float32Array(n), u = new Float32Array(n).fill(-1);
    let i = 0;
    while (i < n - 1) {
      const T = pts[i + 1].tile;
      let j = i;
      while (j + 1 < n - 1 && pts[j + 2].tile === T) j++;
      if (tiles[T] && tiles[T].type === TILE_TYPE.PIT) {
        const acc = [0];
        for (let k = i; k <= j; k++) acc.push(acc[acc.length - 1] + Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y));
        const L = acc[acc.length - 1] || 1;
        for (let k = i; k <= j + 1; k++) {
          const uu = acc[k - i] / L; u[k] = uu;
          // v1.5.150: freie Strecken bringen die Bucht-Tiefe je Punkt mit (echte Boxengasse der DXF).
          const tiefe = pts[k].bucht !== undefined ? pts[k].bucht : VF_BOX_TIEFE * TRACK_HALF_W * vfBoxForm(uu);
          b[k] = Math.max(b[k], tiefe);
        }
      }
      i = j + 1;
    }
    // v1.5.150: freie Strecken: die Bucht-Tiefe je Punkt kommt aus der Datei (buchtPkt) und kann ueber
    // ein PIT-Teil hinausgehen (die Gasse der DXF ist laenger). Ueberall anwenden, wo sie definiert ist.
    for (let k = 0; k < n; k++) {
      if (pts[k].bucht !== undefined) b[k] = Math.max(b[k], pts[k].bucht);
    }
    return { b, u };
  }
  // Parkstriche und Punktreihe als Farb-Dreiecke (6 Zahlen je Ecke, wie die Baeume), knapp ueber der Fahrbahn.
  // Je Haelfte 8 Striche quer: in der ersten Haelfte von u 0,26 bis 0,47 kuerzer werdend, in der zweiten gespiegelt.
  function vfBoxStriche(pts, nrm, tiles, bucht) {
    const a = [], y = 0.02, half = TRACK_HALF_W, w = [0.93, 0.93, 0.93];
    const B = bucht || vfBoxBucht(pts, tiles), n = pts.length;
    const quad = (p0, p1, p2, p3) => { for (const e of [p0, p1, p2, p0, p2, p3]) a.push(e[0], y, e[1], w[0], w[1], w[2]); };
    // Punkt bei Anteil uu in einem Boxenteil (Index-Bereich i0..i1): Ort und Laengsrichtung.
    const ort = (i0, i1, uu) => {
      let k = i0;
      while (k < i1 && B.u[k + 1] < uu) k++;
      const f = Math.max(0, Math.min(1, (uu - B.u[k]) / ((B.u[k + 1] - B.u[k]) || 1)));
      const P = pts[k], Q = pts[Math.min(n - 1, k + 1)];
      const x = P.x + (Q.x - P.x) * f, z = P.y + (Q.y - P.y) * f;
      const lx = Q.x - P.x, lz = Q.y - P.y, ll = Math.hypot(lx, lz) || 1;
      return { x, z, lx: lx / ll, lz: lz / ll, nx: nrm[k].x, nz: nrm[k].y };
    };
    let i = 0;
    while (i < n) {
      if (B.u[i] < 0) { i++; continue; }
      let j = i;
      while (j + 1 < n && B.u[j + 1] >= 0 && B.u[j + 1] > B.u[j]) j++;
      const strich = (uu, laenge) => {
        const o = ort(i, j, uu), sd = VF_BOX_SEITE, dicke = half * 0.035, mitte = half + half * 0.6 * VF_BOX_TIEFE;
        const P = (q, l) => [o.x + o.nx * sd * q + o.lx * l, o.z + o.nz * sd * q + o.lz * l];
        quad(P(mitte - laenge / 2, -dicke), P(mitte + laenge / 2, -dicke), P(mitte + laenge / 2, dicke), P(mitte - laenge / 2, dicke));
        const pk = half * 0.05, pq = half + half * 0.07;
        quad(P(pq - pk, -pk), P(pq + pk, -pk), P(pq + pk, pk), P(pq - pk, pk));
      };
      for (let k = 0; k < 8; k++) {
        const t = k / 7, l = half * (0.8 - 0.42 * t);
        strich(0.26 + 0.21 * t, l);           // erste Haelfte: zur Mitte hin kuerzer
        strich(0.74 - 0.21 * t, l);           // zweite Haelfte gespiegelt
      }
      i = j + 1;
    }
    return a;
  }
  // Fahrbahn und Randsteine aus der Mittellinie. Abschnitt i (Punkt i -> i+1) gehoert zum Teil
  // pts[i+1].tile; Punkt i ist dann die Teilegrenze (trackCenterline legt den letzten Punkt eines Teils
  // auf sein Ende). Fahrbahn: v = 0..1 ueber das Teil, eine zufaellige Spalte (Gebrauchsgrad), zufaellig
  // gespiegelt, Helligkeit je Teil leicht anders. Randstein: eine ganze Zahl Pfeiltakte je Teil und
  // Seite (wie im Editor), an beiden Enden ein dunkles Stueck als Steckfuge. Rein (ohne WebGL).
  function vfBahnGeometrie(pts, nrm, tiles, ao) {
    const strasse = [], rand = [];
    const half = TRACK_HALF_W, kw = TRACK_KERB_W, ky = 0.09, n = pts.length;
    const rnd = vfZufall(4242 + tiles.length * 31 + Math.round(Math.abs(pts[n - 1].x) * 7));
    const off = (i, d) => [pts[i].x + nrm[i].x * d, pts[i].y + nrm[i].y * d];
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const zz = (i) => pts[i].z || 0;   // Hoehe (Bruecke der freien Strecke), sonst 0
    // v1.5.84: halbe Breite je Punkt und Seite (Boxenbucht auf VF_BOX_SEITE).
    const bucht = vfBoxBucht(pts, tiles).b;
    // Freie Strecken mit echter Boxengasse aus der DXF (aus PR 4 von gnen54): die Gasse ist eine eigene Flaeche
    // (Dreiecke), die Fahrbahn weitet sich dort NICHT zur Bucht - sonst lief der Randstreifen entlang der ganzen
    // Gasse ins Leere (GEMELDET: "Fehlender Randstreifen").
    const gasse = (tiles.find((x) => x && x.gasse) || {}).gasse || null;
    const hw = (i, sg) => half + (!gasse && sg === VF_BOX_SEITE ? bucht[i] : 0);
    // Randkanten der freien Strecken (aus PR 4 von gnen54, "kleiner Haken mit Spitze"): wo eine Kurve innen enger
    // ist als der Abstand der Kante zur Mittellinie, ueberschlaegt sich die versetzte Linie (Schwalbenschwanz). Je
    // Seite und Abstand einmal die ganze Kante rechnen und Schlaufen herausschneiden: schneiden sich zwei nahe
    // Abschnitte, ruecken die Punkte dazwischen auf den Schnittpunkt.
    const kantenCache = {};
    const kante = (sg, extra) => {
      const key = sg + ':' + extra;
      if (kantenCache[key]) return kantenCache[key];
      const E = [];
      for (let i = 0; i < n; i++) E.push(off(i, (hw(i, sg) + extra) * sg));
      for (let j = 0; j + 1 < n; j++) {
        const a = E[j], b = E[j + 1];
        for (let k = j + 2; k + 1 < n && k < j + 60; k++) {
          const c = E[k], d = E[k + 1];
          const r = [b[0] - a[0], b[1] - a[1]], q = [d[0] - c[0], d[1] - c[1]];
          const den = r[0] * q[1] - r[1] * q[0];
          if (Math.abs(den) < 1e-9) continue;
          const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
          if (t > 0 && t < 1 && u > 0 && u < 1) {
            const x = [a[0] + r[0] * t, a[1] + r[1] * t];
            for (let m = j + 1; m <= k; m++) E[m] = x;
            j = k - 1; break;
          }
        }
      }
      return (kantenCache[key] = E);
    };
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
      const freiT = !!(tiles[tl.T] && tiles[tl.T].frei);
      for (let i = tl.i0; i <= tl.i1; i++) {
        let v0 = acc[i - tl.i0] / L, v1 = acc[i - tl.i0 + 1] / L;
        if (fv) { v0 = 1 - v0; v1 = 1 - v1; }
        // Freie Strecken sind EINE Fahrbahn ohne Steckverbindungen (aus PR 4 von gnen54): die dunkle Steckfuge am
        // oberen und unteren Rand jeder Texturspalte nicht mitnehmen, sonst laeuft an jeder Pseudo-Kachel und an
        // Start/Ziel eine dunkle Querfuge ueber die Bahn.
        if (freiT) { v0 = 0.012 + v0 * 0.976; v1 = 0.012 + v1 * 0.976; }
        const a = off(i, half), b = off(i + 1, half), c = off(i + 1, -half), d = off(i, -half);
        const z0 = zz(i), z1 = zz(i + 1);
        vfViereck(strasse, [a[0], z0, a[1], ua, v0], [b[0], z1, b[1], ua, v1], [c[0], z1, c[1], ub, v1], [d[0], z0, d[1], ub, v0], ct);
        // Boxenbucht: ein Streifen neben der Fahrbahn, die Textur an der Kante gespiegelt (keine Naht).
        if (!gasse && (bucht[i] > 0 || bucht[i + 1] > 0)) {
          const sd = VF_BOX_SEITE, kante = sd > 0 ? ua : ub, innen = sd > 0 ? ub : ua;
          const uq = (bb) => kante + (innen - kante) * Math.min(1, bb / (2 * half));
          const e0 = off(i, sd * half), e1 = off(i + 1, sd * half), f1 = off(i + 1, sd * hw(i + 1, sd)), f0 = off(i, sd * hw(i, sd));
          vfViereck(strasse, [e0[0], 0, e0[1], kante, v0], [e1[0], 0, e1[1], kante, v1], [f1[0], 0, f1[1], uq(bucht[i + 1]), v1], [f0[0], 0, f0[1], uq(bucht[i]), v0], ct);
        }
      }
      for (const sg of [1, -1]) {
        if (freiT) {
          // Freie Strecke (nur virtuell): statt Carrera-Randstein Asphalt bis zur Kante (die Rumpelzone, so breit
          // wie ein Carrera-Randstein) und ein SCHMALER weisser Strich direkt an der Fahrbahnkante (BESTELLT
          // Gnen54: "Fahrbahnraender nur weiss markiert"). Aus PR 4 von gnen54: reines Weiss (v = -1, siehe
          // Shader), Kanten ohne Schlaufen (kante), und offen nur dort, wo die Boxengasse den Streifen wirklich
          // beruehrt (Ein- und Ausfahrt) - dort laeuft der Strich gestrichelt weiter, die Gerade bleibt sichtbar.
          const lw = kw * 0.3, uk = sg > 0 ? ua : ub, um = (sg > 0 ? 4 : 132) / VF_RAND_B;
          const E0 = kante(sg, 0), EK = kante(sg, kw), EL = kante(sg, lw);
          for (let i = tl.i0; i <= tl.i1; i++) {
            const offen = !!gasse && [0.5, 1.0].some((f) => vfInGasse(gasse, off(i, (half + kw * f) * sg)) || vfInGasse(gasse, off(i + 1, (half + kw * f) * sg)));
            const iA = E0[i], iB = E0[i + 1], oA = EK[i], oB = EK[i + 1], lA = EL[i], lB = EL[i + 1];
            const zA = zz(i), zB = zz(i + 1);
            vfViereck(strasse, [iA[0], zA, iA[1], uk, 0.3], [iB[0], zB, iB[1], uk, 0.4], [oB[0], zB, oB[1], uk, 0.4], [oA[0], zA, oA[1], uk, 0.3], ct);
            if (!offen || i % 2 === 0) vfViereck(rand, [iA[0], zA + 0.012, iA[1], um, -1], [iB[0], zB + 0.012, iB[1], um, -1], [lB[0], zB + 0.012, lB[1], um, -1], [lA[0], zA + 0.012, lA[1], um, -1], [1, 1, 1]);
            if (zA > 0 || zB > 0) {
              // Bruecke (aus PR 4 von gnen54): Bordwand aussen (grau) bis 1,3 ueber die Fahrbahn, unten so tief wie
              // die Platte - darunter bleibt die Durchfahrt offen; an den flachen Rampenenden reicht sie bis zum
              // Boden. Dazu die Unterseite der Platte.
              const wo = 1.3, dk = 1.0, wf = [0.58, 0.6, 0.63], wi = [0.5, 0.52, 0.55], uw2 = 4 / VF_RAND_B;
              const bA = Math.max(0, zA - dk), bB = Math.max(0, zB - dk);
              const aA = off(i, (half + kw + 0.25) * sg), aB = off(i + 1, (half + kw + 0.25) * sg);
              vfViereck(rand, [oA[0], bA, oA[1], uw2, 0.1], [oB[0], bB, oB[1], uw2, 0.1], [oB[0], zB + wo, oB[1], uw2, 0.2], [oA[0], zA + wo, oA[1], uw2, 0.2], wi);
              vfViereck(rand, [aA[0], bA, aA[1], uw2, 0.1], [aB[0], bB, aB[1], uw2, 0.1], [aB[0], zB + wo, aB[1], uw2, 0.2], [aA[0], zA + wo, aA[1], uw2, 0.2], wf);
              vfViereck(rand, [oA[0], zA + wo, oA[1], uw2, 0.1], [oB[0], zB + wo, oB[1], uw2, 0.1], [aB[0], zB + wo, aB[1], uw2, 0.2], [aA[0], zA + wo, aA[1], uw2, 0.2], wf);
              if (sg > 0) {
                const uA = off(i, -(half + kw)), uB = off(i + 1, -(half + kw));
                vfViereck(rand, [oA[0], bA, oA[1], uw2, 0.1], [oB[0], bB, oB[1], uw2, 0.1], [uB[0], bB, uB[1], uw2, 0.2], [uA[0], bA, uA[1], uw2, 0.2], [0.35, 0.36, 0.38]);
              }
            }
          }
          continue;
        }
        const accS = [0];
        for (let i = tl.i0; i <= tl.i1; i++) {
          const p = off(i, (hw(i, sg) + kw / 2) * sg), q = off(i + 1, (hw(i + 1, sg) + kw / 2) * sg);
          accS.push(accS[accS.length - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
        }
        const Ls = accS[accS.length - 1] || 1, nP = Math.max(1, Math.round(Ls / takt)), k0 = Math.floor(rnd() * 4);
        const hb = VF_RAND_B / 2;
        const u0 = (sg > 0 ? 0.5 : hb + 0.5) / VF_RAND_B, u1 = (sg > 0 ? hb - 0.5 : VF_RAND_B - 0.5) / VF_RAND_B, uw = (sg > 0 ? 4 * VF_TEX_K : hb + 4 * VF_TEX_K) / VF_RAND_B;
        // v1.3.124: AO-Streifen an den Randsteinen (ao = VF_AO_INNEN, kleiner = dunkler), nur Quality;
        // ohne ao (Performance, Selbsttest) die Farben von 1.3.92.
        ao = ao || 1;
        const wand = [ct[0] * 0.74 * ao, ct[1] * 0.74 * ao, ct[2] * 0.76 * ao], aussen = [ct[0] * 0.6 * ao, ct[1] * 0.6 * ao, ct[2] * 0.62 * ao];
        for (let i = tl.i0; i <= tl.i1; i++) {
          const j = i - tl.i0, segL = (accS[j + 1] - accS[j]) || 1;
          const va = (k0 + nP * accS[j] / Ls) / 4, vb = (k0 + nP * accS[j + 1] / Ls) / 4;
          const f = Math.min(0.45, VF_FUGE / segL), stuecke = [];
          let t0 = 0, t1 = 1;
          if (j === 0) { stuecke.push([0, f, true]); t0 = f; }
          if (i === tl.i1) t1 = 1 - f;
          stuecke.push([t0, t1, false]);
          if (i === tl.i1) stuecke.push([t1, 1, true]);
          const iA = off(i, hw(i, sg) * sg), iB = off(i + 1, hw(i + 1, sg) * sg), oA = off(i, (hw(i, sg) + kw) * sg), oB = off(i + 1, (hw(i + 1, sg) + kw) * sg);
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
    if (gasse) {
      // Boxengasse aus der DXF (aus PR 4 von gnen54): Dreiecke als Asphalt (etwas heller) und die weissen Waende als
      // geglaettete, durchgehende Baender (vorher ein Rechteck je Segment: in Boegen ein Saegezahn).
      const t = gasse.tri, ur = (0.5 * VF_BAHN_SPALTE) / VF_BAHN_TEX, cb = [0.88, 0.88, 0.9], uk = 4 / VF_RAND_B;
      for (let j = 0; j + 5 < t.length; j += 6) {
        for (const k of [0, 2, 4]) strasse.push(t[j + k], 0, t[j + k + 1], ur, 0.5, cb[0], cb[1], cb[2]);
      }
      for (const L0 of (gasse.rand || [])) if (L0 && L0.length > 1) vfBand(rand, L0, kw * 0.15, 0.012, uk, [1, 1, 1]);
      // Anfang und Ende des Tankbereichs: fein gestrichelte Querlinie (Gnen54: "sonst stehst du zu weit vorne,
      // versuchst zu tanken und es funktioniert nicht"). Gleiche Schwelle wie vfBoxDurchfahrt (30 % der Tiefe).
      let bMax = 0;
      for (let i = 0; i < n; i++) bMax = Math.max(bMax, bucht[i] || 0);
      const drin = (i) => (bucht[((i % n) + n) % n] || 0) > bMax * 0.3;
      if (bMax > 0) for (let i = 0; i < n; i++) {
        if (!drin(i) || (drin(i - 1) && drin(i + 1))) continue;
        const sg = VF_BOX_SEITE, tief = half + bMax * 1.3, sl = kw * 0.5, lw = kw * 0.12;
        const zi = zz(i), e = [nrm[i].x * sg, nrm[i].y * sg], q = [-e[1] * lw, e[0] * lw];
        for (let d = half + kw; d + sl <= tief; d += sl * 2) {
          const p0 = off(i, d * sg), p1 = off(i, (d + sl) * sg);
          if (!vfInGasse(gasse, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2])) continue;
          vfViereck(rand, [p0[0] - q[0], zi + 0.014, p0[1] - q[1], uk, -1], [p1[0] - q[0], zi + 0.014, p1[1] - q[1], uk, -1],
            [p1[0] + q[0], zi + 0.014, p1[1] + q[1], uk, -1], [p0[0] + q[0], zi + 0.014, p0[1] + q[1], uk, -1], [1, 1, 1]);
        }
      }
    }
    // Steg zwischen Bahn und Boxengasse (freie Strecken, aus der DXF): ein durchgehendes, geglaettetes helles Band
    // (aus PR 4 von gnen54, "Unschoener Bogen": lose Rechtecke je Segment liefen an den Knicken zickzack).
    const steg = (tiles.find((x) => x && x.steg) || {}).steg;
    if (steg && steg.pts && steg.pts.length > 1) vfBand(rand, steg.pts, (steg.b || 2) / 2, 0.012, 4 / VF_RAND_B, [0.88, 0.88, 0.89]);
    return { strasse, rand, teile: teile.length };
  }
  // Liegt ein Kartenpunkt q in der Boxengasse (Dreiecke aus der DXF)? Aus PR 4 von gnen54: fuer Ein- und Ausfahrt,
  // dort bleibt der weisse Randstrich offen ("Boxeneingang und -ausgang frei").
  function vfInGasse(g, q) {
    const t = g.tri;
    for (let j = 0; j + 5 < t.length; j += 6) {
      const ax = t[j], ay = t[j + 1], bx = t[j + 2], by = t[j + 3], cx = t[j + 4], cy = t[j + 5];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (!d) continue;
      const l1 = ((by - cy) * (q[0] - cx) + (cx - bx) * (q[1] - cy)) / d, l2 = ((cy - ay) * (q[0] - cx) + (ax - cx) * (q[1] - cy)) / d;
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return true;
    }
    return false;
  }
  // Linienzug als durchgehendes flaches Band (aus PR 4 von gnen54): erst gleitend gemittelt (die Linien stammen aus
  // dem Raster, Treppchen von ~0,2 Einheiten), dann geglaettet (Chaikin, Enden bleiben), Ecken gemeinsam (Gehrung),
  // reines Weiss/Grau ohne Textur (v = -1, siehe Bahn-Shader).
  function vfBand(ziel, L0, hb, y, u, farbe) {
    let L = L0.map((p) => [p[0], p[1]]);
    if (L.length > 4) {
      const n = L.length;
      L = L.map((p, j) => {
        const r = Math.min(3, j, n - 1 - j); let x = 0, z = 0;
        for (let k = -r; k <= r; k++) { x += L0[j + k][0]; z += L0[j + k][1]; }
        return [x / (2 * r + 1), z / (2 * r + 1)];
      });
    }
    for (let it = 0; it < 3 && L.length > 2; it++) {
      const M = [L[0]];
      for (let j = 0; j + 1 < L.length; j++) {
        const a = L[j], b = L[j + 1];
        M.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      M.push(L[L.length - 1]); L = M;
    }
    const Q = L.map((p, j) => {
      const a = L[Math.max(0, j - 1)], b = L[Math.min(L.length - 1, j + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l * hb, (b[0] - a[0]) / l * hb];
    });
    for (let j = 0; j + 1 < L.length; j++) {
      const a = L[j], b = L[j + 1], qa = Q[j], qb = Q[j + 1];
      vfViereck(ziel, [a[0] - qa[0], y, a[1] - qa[1], u, -1], [b[0] - qb[0], y, b[1] - qb[1], u, -1],
        [b[0] + qb[0], y, b[1] + qb[1], u, -1], [a[0] + qa[0], y, a[1] + qa[1], u, -1], farbe);
    }
  }
  // Ein Holzstueck als Viereck: Ursprung o, Laengsrichtung e (Laenge L), Querrichtung q (Breite B).
  // Atlas-Stueck, Spiegelung und Farbton zufaellig: kein Muster wiederholt sich sichtbar.
  // v1.5.94 (G5): grossflaechige Farbunterschiede im Rasen (Wertrauschen in zwei Groessen, 380 und 110 Einheiten), je
  // Ecke eines Rasenstuecks, damit das Raster der Kacheln verschwindet. Liefert [hell, gelb] in etwa -1..1.
  function vfRasenFleck(x, z) {
    const lage = (S, o) => {
      const gx = x / S + o, gz = z / S - o, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz), hsh = (a, b) => vfHash(a + 5000, b + 7000) * 2 - 1;
      const a0 = hsh(ix, iz) + (hsh(ix + 1, iz) - hsh(ix, iz)) * sx, a1 = hsh(ix, iz + 1) + (hsh(ix + 1, iz + 1) - hsh(ix, iz + 1)) * sx;
      return a0 + (a1 - a0) * sz;
    };
    return [lage(380, 0.37) * 0.7 + lage(110, 3.1) * 0.3, lage(520, 7.7)];
  }
  function vfBodenStueck(a, T, rnd, o, e, L, q, B, y) {
    const st = T.stuecke[Math.floor(rnd() * T.stuecke.length)];
    let [u0, v0, u1, v1] = st;
    if (rnd() < 0.5) [u0, u1] = [u1, u0];
    if (rnd() < 0.5) [v0, v1] = [v1, v0];
    // v1.5: Rasen draussen heller und fast ohne Farbunterschied je Stueck (sonst saehe man das Raster).
    const rasen = T.art && T.art.art === 'rasen';
    const hl = (0.92 + rnd() * (rasen ? 0.03 : 0.13)) * (rasen ? 1.0 : VF_BODEN_HELL), w = (rnd() - 0.5) * (rasen ? 0.01 : 0.05), c = [hl * (1 + w), hl, hl * (1 - w)];
    const P = (s, t) => [o[0] + e[0] * L * s + q[0] * B * t, y, o[1] + e[1] * L * s + q[1] * B * t];
    const p0 = P(0, 0), p1 = P(1, 0), p2 = P(1, 1), p3 = P(0, 1);
    if (rasen) {
      // G5: Farbe je Ecke aus dem Fleckenrauschen (heller/dunkler, gelblicher/blaeulicher).
      const ecken = [[p0, u0, v0], [p1, u0, v1], [p2, u1, v1], [p3, u1, v0]].map(([pp, uu, vv]) => {
        const [hh, gg] = vfRasenFleck(pp[0], pp[2]), m = 1 + 0.13 * hh;
        return [pp[0], y, pp[2], uu, vv, c[0] * m * (1 + 0.07 * gg), c[1] * m, c[2] * m * (1 - 0.10 * gg)];
      });
      for (const k of [0, 1, 2, 0, 2, 3]) a.push(...ecken[k]);
      return;
    }
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
  // ---- BAEUME IN DER FERNE (v1.5, nur auf Rasen) -----------------------------------------------------------
  // Ein Band um die Strecke (VF_BAUM_BAND Einheiten ab dem Streckenrand), Nadel- und Laubbaeume in Modellgroesse (1:50,
  // 12 bis 34 Einheiten hoch), Licht fest eingerechnet (Sonne wie im Shader), Farbe je Baum leicht gestreut. Ein
  // Zeichenaufruf mit dem einfachen Farbprogramm (VF.prog); der Nebel laesst die fernen im Horizont verschwimmen.
  const VF_BAUM_N = 420, VF_BAUM_BAND = [140, 820];
  function vfBaeumeBauen(pts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const R0 = TRACK_HALF_W + TRACK_KERB_W;
    minX -= R0; maxX += R0; minY -= R0; maxY += R0;
    const rnd = vfZufall(4242 + pts.length), a = [], orte = [], gewicht = [];
    let hochAkt = 1;   // v1.5.94 (G4): Hoehe des gerade gebauten Baums, fuer das Gewicht je Ecke
    const S = [0.35, 0.9, 0.25], sl = Math.hypot(S[0], S[1], S[2]);
    const sonne = [S[0] / sl, S[1] / sl, S[2] / sl];
    const dreieck = (p0, p1, p2, farbe, mitte) => {
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l);
      const c = [(p0[0] + p1[0] + p2[0]) / 3 - mitte[0], (p0[1] + p1[1] + p2[1]) / 3 - mitte[1], (p0[2] + p1[2] + p2[2]) / 3 - mitte[2]];
      if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0) n = n.map((x) => -x);
      const licht = 0.5 + 0.55 * Math.max(0, n[0] * sonne[0] + n[1] * sonne[1] + n[2] * sonne[2]);
      for (const q of [p0, p1, p2]) {
        a.push(q[0], q[1], q[2], farbe[0] * licht, farbe[1] * licht, farbe[2] * licht);
        // Wehen: der Stamm unten steht, die Krone oben schwingt (quadratisch, Ausschlag mit der Hoehe des Baums).
        const r = Math.max(0, q[1]) / hochAkt;
        gewicht.push(r * r * hochAkt * 0.035);
      }
    };
    const kegel = (x, z, y0, y1, r, seg, farbe) => {
      for (let i = 0; i < seg; i++) {
        const w0 = i / seg * Math.PI * 2, w1 = (i + 1) / seg * Math.PI * 2;
        const b0 = [x + Math.cos(w0) * r, y0, z + Math.sin(w0) * r], b1 = [x + Math.cos(w1) * r, y0, z + Math.sin(w1) * r];
        dreieck(b0, b1, [x, y1, z], farbe, [x, (y0 + y1) / 2, z]);
      }
    };
    const stamm = (x, z, h, r, farbe) => {
      for (let i = 0; i < 6; i++) {
        const w0 = i / 6 * Math.PI * 2, w1 = (i + 1) / 6 * Math.PI * 2;
        const p0 = [x + Math.cos(w0) * r, 0, z + Math.sin(w0) * r], p1 = [x + Math.cos(w1) * r, 0, z + Math.sin(w1) * r];
        const p2 = [p1[0], h, p1[2]], p3 = [p0[0], h, p0[2]];
        dreieck(p0, p1, p2, farbe, [x, h / 2, z]); dreieck(p0, p2, p3, farbe, [x, h / 2, z]);
      }
    };
    const kugel = (x, yc, z, r, ry, farbe) => {
      const ring = 7, lagen = 4;
      const P = (j, i) => { const th = j / lagen * Math.PI, ph = i / ring * Math.PI * 2; return [x + Math.sin(th) * Math.cos(ph) * r, yc + Math.cos(th) * ry, z + Math.sin(th) * Math.sin(ph) * r]; };
      for (let j = 0; j < lagen; j++) for (let i = 0; i < ring; i++) {
        const p00 = P(j, i), p01 = P(j, i + 1), p10 = P(j + 1, i), p11 = P(j + 1, i + 1);
        if (j > 0) dreieck(p00, p01, p11, farbe, [x, yc, z]);
        if (j < lagen - 1) dreieck(p00, p11, p10, farbe, [x, yc, z]);
      }
    };
    const W = maxX - minX, H = maxY - minY;
    for (let k = 0; k < VF_BAUM_N; k++) {
      // Ort: ein Punkt auf dem Umfang des Rechtecks um die Strecke, dann nach aussen ins Band (nah seltener).
      const t = rnd() * 2 * (W + H), ab = VF_BAUM_BAND[0] + Math.pow(rnd(), 0.75) * (VF_BAUM_BAND[1] - VF_BAUM_BAND[0]);
      let x, z;
      if (t < W) { x = minX + t; z = minY - ab; }
      else if (t < W + H) { x = maxX + ab; z = minY + (t - W); }
      else if (t < 2 * W + H) { x = maxX - (t - W - H); z = maxY + ab; }
      else { x = minX - ab; z = maxY - (t - 2 * W - H); }
      x += (rnd() - 0.5) * 60; z += (rnd() - 0.5) * 60;
      const hoch = 12 + rnd() * 22, j = 0.85 + rnd() * 0.3;
      hochAkt = hoch;
      orte.push([x, z, hoch]);
      stamm(x, z, hoch * 0.32, hoch * 0.045, [0.32 * j, 0.22 * j, 0.13 * j]);
      if (rnd() < 0.45) {
        const g = [0.10 * j, 0.30 * j, 0.15 * j];
        kegel(x, z, hoch * 0.22, hoch * 0.78, hoch * 0.27, 8, g);
        kegel(x, z, hoch * 0.50, hoch, hoch * 0.19, 8, g);
      } else {
        const g = [0.22 * j, 0.42 * j, 0.15 * j];
        kugel(x, hoch * 0.62, z, hoch * 0.32, hoch * 0.30, g);
        if (rnd() < 0.5) kugel(x + hoch * 0.15, hoch * 0.52, z - hoch * 0.1, hoch * 0.22, hoch * 0.2, [g[0] * 0.92, g[1] * 0.95, g[2] * 0.9]);
      }
    }
    return { daten: a, anzahl: VF_BAUM_N, orte, gewicht };
  }
  // ---- v1.5.94 (G4): WEHENDES GRAS UND BAEUME ----
  // Grasbueschel am Streckenrand (hinter den Randsteinen, nur auf Rasen) und die Baumkronen wiegen sich im Wind. Ein eigenes
  // Farbprogramm mit einem Gewicht je Ecke (0 = steht fest, mehr = schwingt weiter); nur Quality.
  // Je Mittellinienpunkt und Seite VF_GRAS.je Bueschel mit je 4 Halmen, Abstand zum Rand 0,4 bis 7 Einheiten, nie naeher
  // als der Rand an irgendeinem Teil der Strecke (Haarnadeln, enge Kurven).
  const VF_GRAS = { je: 3, halme: 4, hoch: [0.5, 1.15], ab: [0.4, 7] };
  function vfGrasBueschel(pts, nrm, bucht) {
    const a = [], n = pts.length, rnd = vfZufall(5557 + n);
    const rand = TRACK_HALF_W + TRACK_KERB_W, frei = rand + 0.25, frei2 = frei * frei;
    const S = [0.35, 0.9, 0.25], sl = Math.hypot(S[0], S[1], S[2]);
    const zuNah = (x, z) => {
      for (let i = 0; i < n; i += 2) { const dx = pts[i].x - x, dz = pts[i].y - z; if (dx * dx + dz * dz < frei2) return true; }
      return false;
    };
    let bueschel = 0;
    for (let i = 0; i < n; i++) for (const sg of [1, -1]) for (let k = 0; k < VF_GRAS.je; k++) {
      const extra = (bucht && sg === VF_BOX_SEITE) ? bucht[i] : 0;
      const d = (rand + extra + VF_GRAS.ab[0] + Math.pow(rnd(), 1.6) * (VF_GRAS.ab[1] - VF_GRAS.ab[0])) * sg;
      const j = (rnd() - 0.5) * 2;   // laengs verstreut zwischen den Punkten
      const ni = Math.min(n - 1, i + 1), lx = pts[ni].x - pts[i].x, lz = pts[ni].y - pts[i].y;
      const x = pts[i].x + nrm[i].x * d + lx * j * 0.5, z = pts[i].y + nrm[i].y * d + lz * j * 0.5;
      if (zuNah(x, z)) continue;
      bueschel++;
      const g = 0.85 + rnd() * 0.3;
      for (let b = 0; b < VF_GRAS.halme; b++) {
        const w = rnd() * Math.PI, h = VF_GRAS.hoch[0] + rnd() * (VF_GRAS.hoch[1] - VF_GRAS.hoch[0]), br = 0.07 + rnd() * 0.05;
        const cx = Math.cos(w) * br, cz = Math.sin(w) * br, ox = (rnd() - 0.5) * 0.35, oz = (rnd() - 0.5) * 0.35;
        const neig = [(rnd() - 0.5) * 0.5 * h, (rnd() - 0.5) * 0.5 * h];
        const licht = 0.75 + 0.3 * Math.abs(Math.sin(w) * S[0] / sl - Math.cos(w) * S[2] / sl);
        const fu = [0.09 * g * licht, 0.20 * g * licht, 0.05 * g * licht], fo = [0.30 * g * licht, 0.50 * g * licht, 0.15 * g * licht];
        a.push(x + ox - cx, -0.04, z + oz - cz, fu[0], fu[1], fu[2], 0);
        a.push(x + ox + cx, -0.04, z + oz + cz, fu[0], fu[1], fu[2], 0);
        a.push(x + ox + neig[0], h, z + oz + neig[1], fo[0], fo[1], fo[2], 0.22 + rnd() * 0.12);
      }
    }
    return { daten: a, bueschel };
  }
  function vfProgrammWehen(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; attribute vec3 c; attribute float k; uniform mat4 m; uniform float zeit; uniform float wind; uniform vec3 aug;'
      + 'varying vec3 vc; varying float vd; varying float vsd;'
      + 'void main(){ float ph = zeit * 1.6 + p.x * 0.045 + p.z * 0.06; float sw = sin(ph) + 0.35 * sin(ph * 2.3 + 1.3);'
      + ' vec3 q = p + vec3(sw, 0.0, cos(ph * 0.8) * 0.5) * (k * wind);'
      + ' gl_Position = m * vec4(q, 1.0); vc = c; vd = gl_Position.w;' + ' vec2 dd_ = q.xz - aug.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vc; varying float vd; varying float vsd; uniform vec3 nebel; uniform vec3 dunst; uniform vec3 sonne;'
      + 'void main(){ float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(vc * sonne, mix(nebel, dunst, vsd * vsd), f), 1.0); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['m', 'zeit', 'wind', 'aug', 'nebel', 'dunst', 'sonne'].forEach((x) => { u[x] = gl.getUniformLocation(p, x); });
    return { p, u, ap: gl.getAttribLocation(p, 'p'), ac: gl.getAttribLocation(p, 'c'), ak: gl.getAttribLocation(p, 'k'), pv: new Float32Array(16) };
  }
  // 6 Zahlen je Ecke (Baeume) plus Gewicht -> 7 Zahlen je Ecke, ein Puffer.
  function vfWehPuffer(gl, daten6, gewicht) {
    const n = daten6.length / 6, a = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) { for (let j = 0; j < 6; j++) a[i * 7 + j] = daten6[i * 6 + j]; a[i * 7 + 6] = gewicht[i] || 0; }
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
    return { b, n };
  }
  function vfWehenMalen(gl, pv) {
    const W = VF.weh, P = W.prog, u = P.u;
    gl.useProgram(P.p);
    for (let i = 0; i < 16; i++) P.pv[i] = pv[i];
    gl.uniformMatrix4fv(u.m, false, P.pv);
    vfTzSetzen(gl, u);
    gl.uniform1f(u.zeit, (performance.now() / 1000) % 1000);
    // Im Regen weht es staerker.
    gl.uniform1f(u.wind, 1 + 0.8 * vfRegenStaerke());
    gl.enableVertexAttribArray(P.ap); gl.enableVertexAttribArray(P.ac); gl.enableVertexAttribArray(P.ak);
    for (const pu of [W.baeume, W.gras]) {
      if (!pu || !pu.n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
      gl.vertexAttribPointer(P.ap, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(P.ac, 3, gl.FLOAT, false, 28, 12);
      gl.vertexAttribPointer(P.ak, 1, gl.FLOAT, false, 28, 24);
      gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    }
    gl.disableVertexAttribArray(P.ap); gl.disableVertexAttribArray(P.ac); gl.disableVertexAttribArray(P.ak);
    gl.useProgram(VF.prog);
  }
  // ---- v1.5.94 (G2): UMGEBUNGSKARTE ----
  // Der Himmel (Verlauf, Wolken, Sonne) wird in eine kleine Wuerfelkarte gemalt, unten der Boden; der Lack spiegelt sie.
  // Alle VF_UMW.alle s neu, damit ziehende Wolken und Regen mitkommen. Kosten: 6 x 64 x 64 Pixel Himmelsshader.
  const VF_UMW = { groesse: 64, alle: 2 };
  // Seiten der Wuerfelkarte: Blickrichtung, rechts, oben (WebGL-Konvention der Wuerfelkarten).
  const VF_UMW_SEITEN = [
    [[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, 0, 1], [1, 0, 0], [0, -1, 0]], [[0, 0, -1], [-1, 0, 0], [0, -1, 0]]];
  function vfUmweltUnten() {
    const s = vfTz().sonne, rasen = VF.flaeche && VF.flaeche.art && VF.flaeche.art.art === 'rasen';
    const b = rasen ? [0.16, 0.27, 0.10] : [0.42, 0.31, 0.21];
    return [b[0] * s[0], b[1] * s[1], b[2] * s[2]];
  }
  function vfUmweltMalen(gl, dt) {
    if (VF.umwKaputt) return;
    if (!VF.umw) {
      const N = VF_UMW.groesse, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      for (let i = 0; i < 6; i++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      VF.umw = { tex, fb, N, uhr: 1e9, fertig: false };
    }
    const U = VF.umw;
    U.uhr += dt;
    if (U.uhr < VF_UMW.alle) return;
    U.uhr = 0;
    if (!VF.himmelProg) { VF.himmelProg = vfProgrammHimmel(gl); VF.himmel = vfHimmel(gl); }
    const H = VF.himmelProg, z = vfTz(), d = VF.dunstF || z.horizont, un = vfUmweltUnten();
    gl.bindFramebuffer(gl.FRAMEBUFFER, U.fb);
    gl.viewport(0, 0, U.N, U.N);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(H.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, VF.himmel.b);
    gl.enableVertexAttribArray(H.ap);
    gl.vertexAttribPointer(H.ap, 3, gl.FLOAT, false, 12, 0);
    gl.uniform3f(H.horizont, z.horizont[0], z.horizont[1], z.horizont[2]); gl.uniform3f(H.zenit, z.zenit[0], z.zenit[1], z.zenit[2]);
    gl.uniform3f(H.dunst, d[0], d[1], d[2]); gl.uniform3f(H.unten, un[0], un[1], un[2]); gl.uniform1f(H.umwelt, 1);
    gl.uniform1f(H.wolken, VF_WOLKEN); gl.uniform1f(H.zeit, (performance.now() / 1000) % 10000); gl.uniform1f(H.regen, vfRegenStaerke());
    gl.uniform2f(H.halb, 1, 1);
    for (let i = 0; i < 6; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, U.tex, 0);
      if (i === 0 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { VF.umwKaputt = true; break; }
      const [f, r, o] = VF_UMW_SEITEN[i];
      gl.uniform3f(H.fwd, f[0], f[1], f[2]); gl.uniform3f(H.right, r[0], r[1], r[2]); gl.uniform3f(H.up, o[0], o[1], o[2]);
      gl.drawArrays(gl.TRIANGLES, 0, VF.himmel.n);
    }
    gl.disableVertexAttribArray(H.ap);
    gl.enable(gl.DEPTH_TEST);
    if (VF.umwKaputt) { VF.umw = null; return; }
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, U.tex);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    U.fertig = true;
  }
  // ---- v1.5.94 (G7): SICHTFELD MIT TEMPO, WACKELN AUF RANDSTEINEN (abschaltbar) ----
  // In den Kameras hinter und auf dem Auto wird das Sichtfeld mit dem Tempo weiter (bis VF_SICHT.plus Grad bei
  // VF_SICHT.kmh angezeigten km/h, gedaempft), und auf dem Randstein ruckelt das Bild leicht senkrecht. Die Kamera selbst
  // bleibt unberuehrt: geaendert wird eine Kopie (feste Arrays, keine Allokation je Bild).
  const VF_SICHT_STORE = 'omegasim-vf-sicht-tempo';
  const VF_SICHT = { plus: 9, kmh: 260, wackeln: 0.06 };
  function vfSichtTempoAn() { try { return localStorage.getItem(VF_SICHT_STORE) !== 'aus'; } catch (e) { return true; } }
  function vfKameraEffekt(k, dt) {
    const id = vfKameraId();
    if (!VF.sichtAn || !(id === 'verfolger' || id === 'nah' || id === 'haube')) { VF.fovPlus = 0; return k; }
    const kmh = Math.abs(physEngine.state.speedKmh || 0) * TACHO_SCALE * (VF.tempoFaktor || 1);
    const ziel = VF_SICHT.plus * Math.pow(Math.min(1, kmh / VF_SICHT.kmh), 1.3);
    VF.fovPlus = (VF.fovPlus || 0) + (ziel - (VF.fovPlus || 0)) * Math.min(1, dt * 3);
    const E = VF.kEff || (VF.kEff = { auge: [0, 0, 0], ziel: [0, 0, 0] });
    let ruck = 0;
    if (VF.kerbJetzt && kmh > 5) ruck = (Math.random() - 0.5) * VF_SICHT.wackeln * Math.min(1, kmh / 150) * (id === 'haube' ? 0.6 : 1);
    for (let i = 0; i < 3; i++) { E.auge[i] = k.auge[i]; E.ziel[i] = k.ziel[i]; }
    E.auge[1] += ruck; E.ziel[1] += ruck * 0.5;
    E.fov = k.fov + VF.fovPlus; E.nah = k.nah; E.fern = k.fern; E.oben = k.oben;
    return E;
  }
  function vfPufferF(gl, a) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW);
    return { b, n: a.length / 8 };
  }
  // Alles fuer die Flaechen einer Fahrt: Programm, drei Texturen, drei Puffer. Einmal beim Start.
  // qual (Quality): eigenes Programm, Boden trilinear 8-fach anisotrop, Fahrbahn/Randstein 4-fach,
  // AO an den Randsteinen (v1.3.124). Performance: die Filter von 1.3.92 (siehe vfTexturHoch, gemessen).
  // Scheitert ein Shader, geht es eine Stufe tiefer weiter (Quality -> Performance -> Eckfarben).
  function vfFlaechenBauen(gl, pts, nrm, tiles, qual) {
    let prog = null;
    if (qual) { try { prog = vfProgrammFlaeche(gl, true); } catch (e) { prog = null; } }
    if (!prog) {
      try { prog = vfProgrammFlaeche(gl, false); }
      catch (e) { if (VF.prog && VF.gl === gl) prog = vfProgrammFlaecheEinfach(gl, VF.prog); else throw e; }
    }
    const q = prog.qual;
    const art = vfBodenArt(vfBodenWahl());
    const TB = vfBodenTexturDaten(art.id);
    const bahn = vfBahnGeometrie(pts, nrm, tiles, q ? VF_AO_INNEN : 1), boden = vfBodenGeometrie(pts, TB, art);
    return {
      prog, art, qual: q, pv: new Float32Array(16), schM: new Float32Array(16),
      // v1.5.88: Fahrbahn und Randstein unter flachem Blick (Motorhaube) anisotrop: Quality 8-fach, Performance 2-fach.
      txBahn: vfTexturHoch(gl, vfBahnTexturDaten(), false, q ? 8 : 2, q), txRand: vfTexturHoch(gl, vfRandTexturDaten(), true, q ? 8 : 2, true),
      txBoden: vfTexturHoch(gl, TB, false, q ? 8 : 2, q),
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
    vfTzSetzen(gl, u);
    if (P.einfach) {
      gl.uniformMatrix4fv(u.w, false, VF_EINS);
      gl.uniform1f(u.alf, 1.0);
    } else {
      gl.uniform3f(u.auge, auge[0], auge[1], auge[2]);
      gl.uniform1i(u.tx, 0);
    }
    if (P.qual) {
      // Quality: Schattenkarte (Textur-Einheit 1), Tonemapping, Regler aus der Konsole (v1.3.124).
      const hatSch = !!(VF.schatte && VF.schM);
      gl.uniform1f(u.schatt, hatSch ? 1 : 0);
      if (hatSch) { for (let i = 0; i < 16; i++) F.schM[i] = VF.schM[i]; gl.uniformMatrix4fv(u.schM, false, F.schM); }
      else gl.uniformMatrix4fv(u.schM, false, VF_EINS);
      gl.uniform1i(u.sch, 1);
      gl.uniform1f(u.belichtung, VF_BELICHTUNG);
      gl.uniform1f(u.bias, VF_SCHATTEN_BIAS);
      gl.uniform1f(u.biasPixel, VF.schatte ? VF_SCHATTEN_PCF / VF.schatte.size : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, VF.schatte ? VF.schatte.tex : null);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.enableVertexAttribArray(P.ap); gl.enableVertexAttribArray(P.ac);
    if (P.auv >= 0) gl.enableVertexAttribArray(P.auv);
    const zeichne = (pu, tx, glanz, bump) => {
      if (!P.einfach) gl.uniform1f(u.glanz, glanz);
      if (P.qual) gl.uniform1f(u.bump, bump);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
      gl.vertexAttribPointer(P.ap, 3, gl.FLOAT, false, 32, 0);
      if (P.auv >= 0) gl.vertexAttribPointer(P.auv, 2, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(P.ac, 3, gl.FLOAT, false, 32, 20);
      gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    };
    // Erst Fahrbahn und Randsteine (schreiben Tiefe), dann der Boden: seine Pixel unter der Bahn fallen
    // im Tiefentest weg, bevor sie gerechnet werden. Damit er nirgends durch die Bahn schimmert (auch
    // nicht bei 16-Bit-Tiefe), liegt er 0,5 mm tiefer UND wird per polygonOffset nach hinten geschoben;
    // er schreibt selbst keine Tiefe. Glanz je Flaeche wie 1.3.92, der Boden nach seiner Art.
    zeichne(F.strasse, F.txBahn, 0.16, VF_BUMP_BAHN);
    zeichne(F.rand, F.txRand, 0.10, 0);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 16);
    zeichne(F.boden, F.txBoden, F.art.glanz, F.art.art === 'rasen' ? 0 : VF_BUMP_BODEN);   // v1.5: Rasen ohne Relief (Halme waeren helle Striche)
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disableVertexAttribArray(P.ap); gl.disableVertexAttribArray(P.ac);
    if (P.auv >= 0) gl.disableVertexAttribArray(P.auv);
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
  // a * b nach o (Float32Array(16), fest je Programm): fuer die Matrizen je Teil und Bild.
  function vfMalIn(o, a, b) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  // ---- HOEHE (aus PR 4 von gnen54: Toernerschleife 2.0 mit Bruecke) ----------------------------------
  // Die Mittellinie traegt je Punkt eine Hoehe z (sonst 0). Gebraucht wird sie nur an erhoehten Stuecken; dort liegen
  // Bruecke und Unterfuehrung am selben Kartenort. Unterschieden wird ueber die Fahrtrichtung: wer laengs der Bruecke
  // faehrt (oder rueckwaerts), ist oben; die Strasse darunter kreuzt schraeg. Das eigene Auto nimmt seinen Bahnpunkt
  // (VF.idx), das ist eindeutig.
  function vfHoeheVorbereiten() {
    const P = VF.pts, n = P ? P.length : 0, seg = [];
    for (let i = 0; i + 1 < n; i++) {
      if (!((P[i].z || 0) > 0 || (P[i + 1].z || 0) > 0)) continue;
      const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y, l = Math.hypot(dx, dy) || 1;
      seg.push({ i, ax: P[i].x, ay: P[i].y, ex: dx / l, ey: dy / l, l, z0: P[i].z || 0, z1: P[i + 1].z || 0 });
    }
    VF.hoehe = seg.length ? seg : null;
  }
  const VF_HZ_NULL = { z: 0, p: 0 };
  function vfHzSeg(sg, x, y, vor) {
    const t = Math.max(0, Math.min(1, ((x - sg.ax) * sg.ex + (y - sg.ay) * sg.ey) / sg.l));
    const p = Math.atan2(sg.z1 - sg.z0, sg.l);
    return { z: sg.z0 + (sg.z1 - sg.z0) * t, p: vor ? p : -p };
  }
  function vfHz(x, y, h) {
    if (!VF.hoehe) return VF_HZ_NULL;
    const r = h * Math.PI / 180, fx = Math.sin(r), fy = -Math.cos(r);
    let best = null, bq = TRACK_HALF_W + TRACK_KERB_W + VF_AUTO.B;
    for (const sg of VF.hoehe) {
      const t = ((x - sg.ax) * sg.ex + (y - sg.ay) * sg.ey) / sg.l;
      if (t < -0.3 || t > 1.3) continue;
      const q = Math.abs((x - sg.ax) * -sg.ey + (y - sg.ay) * sg.ex);
      const c = fx * sg.ex + fy * sg.ey;
      if (q < bq && Math.abs(c) > 0.6) { bq = q; best = { sg, vor: c > 0 }; }
    }
    return best ? vfHzSeg(best.sg, x, y, best.vor) : VF_HZ_NULL;
  }
  // Eigenes Auto: ueber den Bahnpunkt (auch quer stehend auf der Bruecke eindeutig).
  function vfHzSpieler() {
    if (!VF.hoehe || !VF.pts) return VF_HZ_NULL;
    const i = VF.idx || 0, n = VF.pts.length;
    let best = null, bd = Infinity;
    for (const sg of VF.hoehe) {
      const d = Math.min(Math.abs(sg.i - i), n - Math.abs(sg.i - i));
      if (d < bd) { bd = d; best = sg; }
    }
    if (!best || bd > 2) return VF_HZ_NULL;
    const r = VF.h * Math.PI / 180;
    return vfHzSeg(best, VF.x, VF.y, Math.sin(r) * best.ex - Math.cos(r) * best.ey >= 0);
  }
  // Weltlage des Autos: Drehung um y, sodass lokal +z in Fahrtrichtung (sin h, -cos h) zeigt. Auf der Bruecke
  // (VF.hoehe) dazu die Hoehe und die Neigung der Rampe.
  function vfLage(x, y, h) {
    const th = Math.PI - h * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const H = VF.hoehe ? (x === VF.x && y === VF.y ? vfHzSpieler() : vfHz(x, y, h)) : VF_HZ_NULL;
    const m = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, H.z, y, 1];
    return H.p ? vfMal(m, vfRx(-H.p)) : m;
  }
  const VF_EINS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const VF_OBEN = [0, 1, 0], VF_WEISS = [1, 1, 1], VF_GLAS_TINT = [0.18, 0.22, 0.27];

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
  // muVorn (v1.5.101, H5): zusaetzlicher Faktor nur fuer den Griff der Vorderachse (dreckige Luft hinter einem Auto).
  function vfDynamik(z, vx, ax, antrieb, lenk, dt, mu, P, muVorn) {
    P = P || VF_GT3;
    const g = 9.81, L = P.a + P.b;
    const delta = Math.max(-1, Math.min(1, lenk)) * P.lenkGrad * Math.PI / 180;
    // v1.5.155: Scheitelwinkel je Achse (Schraeglauf bei maximaler Seitenkraft) - daraus die
    // Reifenausnutzung fuer das Quietschen: 1 = am Scheitel, darueber rutscht die Achse
    // (Unter-/Uebersteuern).
    const spV = Math.tan(Math.PI / (2 * P.C)) / P.BV, spH = Math.tan(Math.PI / (2 * P.C)) / P.BH;
    if (vx < 3) {
      z.vy = 0; z.r = vx * Math.tan(delta) / L; z.aV = 0; z.aH = 0; z.nutzung = 0;
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
    const maxV = P.muV * f * (muVorn === undefined ? 1 : muVorn) * fzV * (1 - P.lastEmpf * (fzV / fz0V - 1));
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
    z.nutzung = Math.max(Math.abs(z.aV) / spV, Math.abs(z.aH) / spH);
    return z;
  }
  // ---- DAS AUTO AUS SPEED DREAMS (v1.1.9) ------------------------------------------------------
  // BESTELLT: "Baue das v5r Auto aus Speeddreams ein. Das Auto soll auch Lichter und Bremslichter haben
  // und sich beim Lenken, Gas geben und Bremsen entsprechend verhalten durch Neigung ueber simulierte
  // Stossdaempfer." Der Vulture V5R (ls1-vulture-v5r, GPL-2+), umgewandelt mit tools/sd_auto.py nach
  // img/autos/v5r/: Modell ohne Innenraum, Rad, Lichtorte und die Fahrzeugdaten aus der .xml. Laengen in
  // Metern, im Auto +x links, +y oben, +z vorn; gezeichnet mal VF_AUTO.L / Laenge (so lang wie der Kasten).
  const VF_AUTO_STORE = 'omegasim-vf-auto';
  const VF_MODELL_PFADE = { v5r: 'img/autos/v5r/', lynx220: 'img/autos/lynx220/', fmcgt4: 'img/autos/fmcgt4/', boxer96: 'img/autos/boxer96/', kaefer: 'img/autos/kaefer/', spider: 'img/autos/spider/', caravelle: 'img/autos/caravelle/' };
  function vfModellPfad(auto) { return VF_MODELL_PFADE[auto || vfAutoWahl()] || 'img/autos/v5r/'; }
  // v1.5.150: FREIE STRECKEN nur fuer die virtuelle Fahrt (BESTELLT Gnen54: "eine nicht fuer Carrera gedachte
  // Strecke, rein fuer virtuelles Fahren", aus gnen54/omegasim). Die Datei bringt die Mittellinie (Einheiten
  // wie der Editor, Abstand ~2,86) und Pseudo-Kacheln (START / STRAIGHT / PIT), damit Runden, Randsteine,
  // Boxenbucht und NPCs unveraendert funktionieren. Erzeugt aus der DXF InDeQ-Ring-V1a von Gnen54.
  const VF_STRECKE_STORE = 'omegasim-vf-strecke';
  // Aus PR 4 von gnen54: dieselbe Strecke auch mit Bruecke (die Bahn kreuzt sich, Hoehe z je Punkt).
  const VF_FREIE = { indeq: { name: 'Törnerschleife 2.0', pfad: 'img/strecken/indeq-ring.json' },
    indeqBruecke: { name: 'Törnerschleife 2.0 mit Brücke', pfad: 'img/strecken/indeq-bruecke.json' } };
  function vfFreiWahl() { try { const v = localStorage.getItem(VF_STRECKE_STORE) || ''; return VF_FREIE[v] ? v : ''; } catch (e) { return ''; } }
  const vfFreiCache = {};
  function vfFreiLaden(k) {
    if (vfFreiCache[k]) return Promise.resolve(vfFreiCache[k]);
    return fetch(VF_FREIE[k].pfad).then((r) => { if (!r.ok) throw new Error(VF_FREIE[k].pfad + ' ' + r.status); return r.json(); }).then((d) => {
      // PIT-Kacheln bringen die Tiefe ihrer Bucht mit (halbe Bahnbreiten, echte Boxengasse).
      // Aus PR 4 von gnen54: der Steg zwischen Bahn und Gasse (steg) und die echte Boxengasse der DXF als Dreiecke
      // mit Waenden (boxDreiecke, boxRand) haengen an der PIT-Kachel (vfBahnGeometrie zeichnet sie).
      const tiles = d.kacheln.map((ty) => ({ type: TILE_TYPE[ty] !== undefined ? TILE_TYPE[ty] : TILE_TYPE.STRAIGHT, frei: true,
        bucht: ty === 'PIT' ? d.boxBucht : undefined, seite: ty === 'PIT' ? (d.boxSeite || -1) : undefined,
        steg: ty === 'PIT' && d.steg ? d.steg : undefined,
        gasse: ty === 'PIT' && Array.isArray(d.boxDreiecke) ? { tri: d.boxDreiecke, rand: d.boxRand || [] } : undefined }));
      // buchtPkt: Tiefe der Boxengasse je Punkt (Karteneinheiten jenseits der halben Bahn) - die feste Tiefe
      // mit S-Rampe ueberschlug sich sonst in der Kurve vor der Gasse (GEMELDET Gnen54).
      const bp = Array.isArray(d.buchtPkt) ? d.buchtPkt : null;
      const pts = d.pts.map((q, i) => ({ x: q[0], y: q[1], tile: q[2], z: q[3] || 0, bucht: bp ? (bp[i] || 0) : undefined }));
      // geschlossen wie trackCenterline: letzter Punkt = erster (sonst fehlt das letzte Stueck Bahn).
      pts.push({ x: pts[0].x, y: pts[0].y, tile: pts[pts.length - 1].tile, z: pts[0].z, bucht: pts[0].bucht });
      // Fahrtrichtung wie trackCenterline: Richtung (sin h, -cos h), h in Grad.
      pts.forEach((p, i) => {
        const m = pts.length - 1, a = pts[(i - 1 + m) % m], c = pts[(i + 1) % m];
        p.heading = Math.atan2(c.x - a.x, -(c.y - a.y)) * 180 / Math.PI;
      });
      vfFreiCache[k] = { name: d.name, tiles, pts, seite: d.boxSeite || -1 };
      return vfFreiCache[k];
    });
  }
  // Fuer Fahren, Zaehlen und NPCs die an der Schliessstelle gekuerzte Mittellinie: die freie Strecke
  // schliesst die Schleife mit einem letzten Punkt gleich dem ersten (sonst klafft beim Zeichnen ein
  // Loch), aber der doppelte Punkt liesse die Zeitnahme an Start/Ziel pendeln (eine "Runde" von 0,3 s).
  // Also die Punkte abnehmen, die am Anfang noch einmal ankommen (innerhalb einer halben Bahnbreite).
  function vfSchliessstelle(pts) {
    const n = pts.length;
    if (n < 8) return pts;
    const p0 = pts[0], l = Math.hypot(pts[1].x - p0.x, pts[1].y - p0.y) || 1;
    const dx = (pts[1].x - p0.x) / l, dy = (pts[1].y - p0.y) / l;
    let ende = n;
    while (ende > n - 24) {
      const p = pts[ende - 1], q = pts[ende - 2];
      const vor = (p.x - p0.x) * dx + (p.y - p0.y) * dy;
      const quer = Math.abs((p.x - p0.x) * -dy + (p.y - p0.y) * dx);
      const sl = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const gleich = ((p.x - q.x) * dx + (p.y - q.y) * dy) / sl > 0.7;
      if (vor > -0.3 && quer < TRACK_HALF_W && gleich) ende--; else break;
    }
    return ende < n ? pts.slice(0, ende) : pts;
  }
  // ---- PFLICHT-BOXENDURCHFAHRT (aus PR 4 von gnen54: "Zwang Boxengasse anfahren", "Pflicht-Boxendurchfahrt, kein
  // Tanken etc.") ----
  // Im Rennen (Runden, Langstrecke) muss so oft durch die Boxengasse gefahren werden; gezaehlt wird, wer mindestens
  // 60 % der Bucht befahren hat. Fehlt eine, gibt es im Ergebnis die Zeitstrafe aus dem Renn-Setup (racePitPenaltyS).
  const VF_PFLICHTBOX_STORE = 'omegasim-vf-pflichtbox';
  function vfPflichtBox() { try { return Math.max(0, Math.min(3, parseInt(localStorage.getItem(VF_PFLICHTBOX_STORE), 10) || 0)); } catch (e) { return 0; } }
  function vfPflichtGilt() { return !!(VF.boxN && (VF.modus === 'laps' || VF.modus === 'endurance') && vfPflichtBox() > 0); }
  // Boxenservice (Tanken, Reparieren, Reifen) nur in der Boxengasse, wenn die Strecke eine hat (aus PR 4 von
  // gnen54: "mitten auf der Strecke ... immer noch tanken und reparieren"). Gefragt von 70-race.js.
  function vfBoxOrtOk() { try { return !VF.aktiv || !VF.boxN || !!VF.inBox; } catch (e) { return true; } }
  // Je Bild: ist das Auto in der Bucht (tiefer als 30 % der Bucht und ueber die halbe Bucht hinaus)? Von-bis statt
  // Einzelpunkte: bei hohem Tempo springt der Index mehrere Punkte je Bild.
  function vfBoxDurchfahrt(o, zus) {
    if (!VF.boxN) return;
    const drin = zus > VF.boxMax * 0.3 && Math.abs(o.quer) > TRACK_HALF_W + zus * 0.5;
    VF.inBox = drin;
    if (drin) { if (!VF.boxBesucht) VF.boxBesucht = { von: o.idx, bis: o.idx }; else VF.boxBesucht.bis = o.idx; return; }
    if (!VF.boxBesucht) return;
    const n = VF.pts.length, strecke = ((VF.boxBesucht.bis - VF.boxBesucht.von) % n + n) % n + 1;
    const genug = strecke >= VF.boxN * 0.6 && strecke < n / 2;
    VF.boxBesucht = null;
    if (!genug) return;
    VF.boxDurch = (VF.boxDurch || 0) + 1;
    if (vfPflichtGilt()) showHudToast(t('Boxendurchfahrt') + ' ' + Math.min(VF.boxDurch, vfPflichtBox()) + '/' + vfPflichtBox());
  }
  const VF_FEDER_STORE = 'omegasim-vf-feder';
  const VF_FEDER_WERTE = [1, 2, 3, 5, 8];
  // v1.5.10 BESTELLT: "Vorschau vom Auto, Farbwahl". Lackfarbe der virtuellen Fahrt (WIP): eine eigene Wahl, unabhaengig
  // von der echten Fahrzeugfarbe. Die Karosserie wird umgefaerbt (Helligkeit des Texels mal Farbe, die Texturen behalten ihre
  // Details); Scheiben, Raeder und Leuchten bleiben unveraendert. '' = die Farbe des Modells.
  // Die Vorschaubilder (img/autos/<modell>/vorschau.jpg) sind Seitenansichten in der Originalfarbe
  // (tools/vorschau_bilder.py), eines je Auto.
  const VF_LACK_STORE = 'omegasim-vf-lack';
  const VF_LACK_FARBEN = [
    { id: 'auto', v: '', n: 'Original' },
    { id: 'rot', v: '#c8102e', n: 'Rot' }, { id: 'blau', v: '#0057b8', n: 'Blau' }, { id: 'weiss', v: '#e8e8e8', n: 'Weiß' },
    { id: 'schwarz', v: '#1b1b1b', n: 'Schwarz' }, { id: 'gelb', v: '#f5a800', n: 'Gelb' }, { id: 'violett', v: '#7a1f7a', n: 'Violett' },
    { id: 'gruen', v: '#0a7a3d', n: 'Grün' }, { id: 'orange', v: '#d35400', n: 'Orange' },
  ];
  function vfLack() {
    try { const v = localStorage.getItem(VF_LACK_STORE); return v && VF_LACK_FARBEN.some((f) => f.v === v) ? v : ''; } catch (e) { return ''; }
  }
  function vfLackSetzen(hex) { try { localStorage.setItem(VF_LACK_STORE, hex || ''); } catch (e) { /* egal */ } }
  function vfLackId(hex) { const f = VF_LACK_FARBEN.find((x) => x.v === (hex || '')); return f ? f.id : 'auto'; }
  // Die Farbe der Karosserie: Der Shader faerbt sie um (Helligkeit des Texels mal Lackfarbe, uniform lack = 1), statt zu
  // multiplizieren - sonst wuerde Rot auf einem gelben Auto Orange. Ohne Farbe bleibt das Modell, wie es ist.
  // v1.5.104: Beim Umfaerben ist die Helligkeit des Texels auf 0,82 begrenzt (Shader, min(...)): helle Grundlacke (gelber
  // Kaefer und Spider) wurden sonst ausgewaschen, Rot wurde Rosa und Blau Tuerkis.
  function vfLackTint(hex) { return hex ? vfHex(hex) : VF_WEISS; }
  // Eine gespeicherte Wahl, die es nicht mehr gibt (z. B. 'porsche', 1.3.94-1.3.131, entfernt), faellt
  // still auf den Vulture V5.R zurueck - kein 404 beim Laden und kein Absturz.
  function vfAutoWahl() {
    try { const v = localStorage.getItem(VF_AUTO_STORE); return (v && Object.prototype.hasOwnProperty.call(VF_MODELL_PFADE, v)) ? v : 'v5r'; } catch (e) { return 'v5r'; }
  }
  // Schaltung (Automatik/Manuell) fuer die virtuelle Fahrt. Manuell schaltet der Fahrer mit I/K.
  const VF_SCHALTUNG_STORE = 'omegasim-vf-schaltung';
  function vfSchaltungAuto() { try { return localStorage.getItem(VF_SCHALTUNG_STORE) !== 'manuell'; } catch (e) { return true; } }
  // Geist: eine Kopie des Autos, die nach der ersten Runde die aufgezeichnete Linie abfaehrt.
  const VF_GEIST_STORE = 'omegasim-vf-geist';
  function vfGeistAn() { try { return localStorage.getItem(VF_GEIST_STORE) !== 'aus'; } catch (e) { return true; } }
  // Fester Motorklang fuer die Eigenbauten von Gnen54 (aus PR 4 von gnen54: "der Motorsound soll fest dem Fahrzeug
  // zugeordnet sein, die Anwahl gesperrt"). Die gespeicherte Wahl gilt dort nicht.
  const VF_MOTOR_FEST = { kaefer: 'boxster986', spider: 'listerstorm', caravelle: 'boxster986' };
  function vfMotorFest() { return VF_MOTOR_FEST[vfAutoWahl()] || ''; }
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
  // v1.3.94: Kalibrierung nach unten - die virtuellen NPCs waren fuer die meisten zu schnell. 0,85
  // heisst 15 % langsamer als die Garagenstufe 1 (wie ein frischer, vorsichtiger Fahrer).
  const VF_NPC_KALIBRIER = 0.85;
  // v1.3.94 Startaufstellung: ein Feld hinter der Startlinie, zwei Reihen (links/rechts), Abstand
  // zwischen den Reihen. Die Autos spawnen direkt auf ihren Startplaetzen statt verstreut.
  const VF_GRID_REIHE = Math.max(2, Math.round((typeof TRACK_SAMPLES_PER_TILE !== 'undefined' ? TRACK_SAMPLES_PER_TILE : 8) * 1.5));
  function vfGridKachel(start, reihe) {
    return ((start - reihe * VF_GRID_REIHE) % VF.pts.length + VF.pts.length) % VF.pts.length;
  }
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
                            { id: 'librecorsa', name: 'LibreCorsa GT3 (WIP)' }];
  // v1.5.25: Gran Hybrismo und Assetto Carrera sind entfernt; eine gespeicherte Wahl faehrt als LibreCorsa GT3.
  const VF_HANDLING_ENTFERNT = { gran: 'librecorsa', acc: 'librecorsa' };
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
      if (VF_HANDLING_ENTFERNT[v]) v = VF_HANDLING_ENTFERNT[v];
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
  // Grafik der virtuellen Fahrt: Performance (wie bisher, fuer schwache Handys) oder Quality (besseres
  // Licht, Tonemapping, Schatten, Vignette). v1.5.90 BESTELLT: "Virtuelles Fahren Standardeinstellungen ändern: Licht
  // aus, qualität (nicht performance)". Ohne eigene Wahl gilt Quality; die Bildraten-Wache (vfWacheMessen) schaltet auf
  // schwachen Geraeten Effekte ab. Wer Performance gewaehlt hat, behaelt es.
  const VF_GRAFIK_STORE = 'omegasim-vf-grafik';
  const VF_GRAFIK_MODI = [{ id: 'perf', name: 'Performance' }, { id: 'qual', name: 'Quality' }];
  function vfGrafik() {
    try { const v = localStorage.getItem(VF_GRAFIK_STORE); return v === 'perf' ? 'perf' : 'qual'; } catch (e) { return 'qual'; }
  }
  function vfGrafikQual() { return vfGrafik() === 'qual'; }
  function vfGrafikSetzen(id) {
    try { localStorage.setItem(VF_GRAFIK_STORE, id); } catch (e) { /* egal */ }
  }
  // v1.5 (WIP, Plan Paket 4 "Tageszeit"): Farbstimmung der virtuellen Fahrt. Himmel (Horizont, Zenit), Nebel
  // und die Farbe des Lichts auf allem Beleuchteten; selbstleuchtende Teile (Lichter) bleiben, wie sie sind.
  // Die Sonnenrichtung bleibt fest (die Schattenkarte haengt an ihr). Keine Nacht: es gibt keine Lichtkegel.
  // Mittag ist genau das bisherige Bild.
  const VF_TZ_STORE = 'omegasim-vf-tageszeit';
  const VF_TAGESZEITEN = [
    { id: 'mittag', name: 'Mittag', sonne: [1, 1, 1], horizont: [0.66, 0.78, 0.90], zenit: [0.18, 0.36, 0.66] },
    { id: 'morgen', name: 'Morgen', sonne: [1.0, 0.93, 0.86], horizont: [0.88, 0.80, 0.74], zenit: [0.34, 0.50, 0.78] },
    { id: 'abend', name: 'Abend', sonne: [0.98, 0.72, 0.52], horizont: [0.96, 0.62, 0.42], zenit: [0.22, 0.24, 0.48] },
  ];
  function vfTageszeit() {
    let v = 'mittag';
    try { v = localStorage.getItem(VF_TZ_STORE) || 'mittag'; } catch (e) { v = 'mittag'; }
    return VF_TAGESZEITEN.find((x) => x.id === v) || VF_TAGESZEITEN[0];
  }
  function vfTageszeitSetzen(id) { try { localStorage.setItem(VF_TZ_STORE, id); } catch (e) { /* egal */ } }
  // Je Fahrt einmal gelesen (VF.tz), nicht je Bild.
  function vfTz() { return VF.tz || VF_TAGESZEITEN[0]; }
  // v1.5.94 (G3) BESTELLT ("Dunst zur Sonne"): in der Ferne Richtung Sonne heller und waermer. Die Dunstfarbe mischt den
  // Horizont mit warmem Sonnenlicht; die Shader nehmen sie je nach Blickrichtung zur Sonne (vsd) statt des Nebels.
  function vfDunstFarbe(z) {
    const h = z.horizont, s = z.sonne, w = [1.0, 0.90, 0.74];
    return [0, 1, 2].map((i) => Math.min(1, h[i] * 0.55 + w[i] * s[i] * 0.5));
  }
  function vfTzSetzen(gl, u) {
    const z = vfTz();
    if (u.nebel) gl.uniform3f(u.nebel, z.horizont[0], z.horizont[1], z.horizont[2]);
    if (u.dunst) { const d = VF.dunstF || z.horizont; gl.uniform3f(u.dunst, d[0], d[1], d[2]); }
    if (u.aug && VF.augeJetzt) gl.uniform3f(u.aug, VF.augeJetzt[0], VF.augeJetzt[1], VF.augeJetzt[2]);
    if (u.sonne) gl.uniform3f(u.sonne, z.sonne[0], z.sonne[1], z.sonne[2]);
    // v1.5: Lackreflexe (Modell-Shader Quality) spiegeln denselben Himmel.
    if (u.horizont) gl.uniform3f(u.horizont, z.horizont[0], z.horizont[1], z.horizont[2]);
    if (u.zenit) gl.uniform3f(u.zenit, z.zenit[0], z.zenit[1], z.zenit[2]);
  }
  // v1.3.124: Grafik-Feinschliff (BESTELLT). Regler (Konsole) fuer die Bildqualitaet im Quality-Modus.
  // VF_BELICHTUNG: Gesamthelligkeit. VF_BUMP_BODEN/BAHN: Relief-Staerke (0 = aus, wenn der Boden
  // verrauscht wirkt). VF_AO_INNEN: Dunkelheit neben den Randsteinen (kleiner = dunkler).
  // VF_SCHATTEN_BIAS_*: Schatten-Bias; erhoehen bei Streifen ("acne"), senken, wenn Schatten abheben.
  // Beim Laden gelesen: ohne try warf ein gesperrter Speicher (privater Modus, file:// in manchen
  // WebViews) hier, mitten im gemeinsamen Skript, und ein Tippfehler in der Konsole ("0,5") wurde NaN
  // und schwaerzte den ganzen Shader. Ungueltiges faellt auf die Vorgabe zurueck.
  function vfReglerLesen(schluessel, vorgabe) {
    try { const v = localStorage.getItem(schluessel); const z = v === null || v === '' ? NaN : +v; return Number.isFinite(z) ? z : vorgabe; }
    catch (e) { return vorgabe; }
  }
  const VF_BELICHTUNG = vfReglerLesen('omegasim-vf-belichtung', 1.0);
  const VF_BUMP_BODEN = vfReglerLesen('omegasim-vf-bump-boden', 1.0);
  const VF_BUMP_BAHN = vfReglerLesen('omegasim-vf-bump-bahn', 0.6);
  const VF_AO_INNEN = vfReglerLesen('omegasim-vf-ao-innen', 0.6);
  const VF_SCHATTEN_BIAS = vfReglerLesen('omegasim-vf-schatten-bias', 0.0015);
  // v1.5.151: PCF-Kernradius in Texeln (statt der festen 0.0004 in UV). Der Kern wird im Draw-Pfad mit der
  // Kartengroesse skaliert (biasPixel = VF_SCHATTEN_PCF / size), damit die Kante bei 512 und bei 1024 gleich
  // weich ist. 1.0 = 3x3-Kern auf den Texelzentren (sauber, keine Rundungsties); der alte Regler
  // 'omegasim-vf-schatten-bias-pixel' (0.0004) war kleiner als ein Texel und liess die Kante eckig.
  // v1.5.152: das Auto nutzt einen 5x5-Kern (25 Abtastungen, gleicher Radius) - die Selbstschatten des Autos
  // liegen nah an der Kamera und brauchen die breitere Kante; der Boden bleibt beim 3x3-Kern.
  const VF_SCHATTEN_PCF = vfReglerLesen('omegasim-vf-schatten-pcf', 1.0);
  // Studienmodus: FOV aus Bildschirm/Abstand, Zoom der Fahrer-Kamera aus, fester NPC-Seed. Nur aktiv,
  // wenn der Nutzer die Schluessel in der Konsole setzt (siehe Bestellung). Das JSON-Log (Bildzeiten)
  // ist entfernt: es lief nie (sein Zaehler stieg nur in ihm selbst) und kostete je Bild ein shift().
  const VF_STUDIE = (() => { try { return localStorage.getItem('omegasim-vf-studie') === '1'; } catch (e) { return false; } })();
  const VF_STUDIE_FOV = (() => { try { const v = JSON.parse(localStorage.getItem('omegasim-vf-studie-fov') || 'null'); return v && v.bildHoeheCm > 0 ? v : null; } catch (e) { return null; } })();
  const VF_STUDIE_ZOOM_AUS = (() => { try { return localStorage.getItem('omegasim-vf-studie-zoomaus') === '1'; } catch (e) { return false; } })();
  const VF_SEED = (() => { try { const v = +localStorage.getItem('omegasim-vf-seed'); return Number.isFinite(v) ? v : null; } catch (e) { return null; } })();
  function vfStudieFov() {
    if (!VF_STUDIE_FOV) return null;
    const vf = (VF_STUDIE_FOV.bildHoeheCm / VF_STUDIE_FOV.abstandCm);
    return (2 * Math.atan(vf / 2)) * 180 / Math.PI;
  }
  function vfStudieSeed() {
    if (!VF_SEED) return 4242;
    return VF_SEED;
  }
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
    return Math.max(0.2, Math.min(1, anteil)) * top * VF_NPC_KALIBRIER;
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
  // Gelbe Flagge / Einfuehrungsrunde: Zieltempo der NPCs in Modell-km/h deckeln. Die Geister rechnen
  // unter ghostTick mit Faktoren (yellowFactor, formationPace); hier dasselbe in Modell-km/h.
  function vfGelbZiel() {
    const top = (physEngine && physEngine.config && physEngine.config.topSpeedKmh) || 4;
    const f = (typeof yellowFactor === 'function') ? yellowFactor() : 0.27;
    return Math.max(0.1, top * f);
  }
  function vfFormationZiel() {
    const top = (physEngine && physEngine.config && physEngine.config.topSpeedKmh) || 4;
    const f = (typeof formationPace === 'function') ? formationPace() : 0.35;
    return Math.max(0.1, top * f);
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
      const gelb = (typeof flagState !== 'undefined') && flagState !== 'green';
      const formation = (typeof raceFormationLap !== 'undefined') && raceFormationLap;
      for (let t = 0; t < teile; t++) {
        const v = Math.max(0, e.state.speedKmh || 0);
        const voraus = vfNpcPunkt(B, npc.s + v * K * VF_NPC_VORAUS_S, npc.idx);
        let ziel = Math.min(B.v[npc.idx], B.v[voraus.j]) * (npc.faktor || 1);
        // Gelbe Flagge / Einfuehrungsrunde: Zieltempo deckeln (wie die Geister unter ghostTick).
        if (gelb) ziel = Math.min(ziel, vfGelbZiel());
        else if (formation) ziel = Math.min(ziel, vfFormationZiel());
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
    // v1.3.124 Studienmodus: fester Seed, damit dieselben NPCs jede Fahrt antreten.
    const rng = VF_STUDIE ? vfZufall(vfStudieSeed()) : null;
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor((rng ? rng() : Math.random()) * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const bogen = vfNpcBogen(VF.pts);
    VF.npcBogen = bogen.bogen; VF.npcRunde = bogen.runde;
    const n = VF.pts.length;
    for (let k = 0; k < nAnzahl; k++) {
      const auto = pool[k];
      // Startaufstellung: Zeile 1 hinter der Startlinie (k=0,1), Zeile 2 (k=2,3), ...; links/rechts.
      const reihe = Math.floor((k + 1) / 2);
      const startIdx = vfGridKachel(start, reihe);
      const npc = {
        auto, modell: null, P: null, idx: startIdx, s: null, kmh: 0, motor: vfNpcMotor(), bahn: null,
        offset: (k % 2 === 0) ? 3.0 : -3.0,
        faktor: 0.97 + 0.03 * k,
        x: 0, y: 0, h: 0, raddreh: 0, lenkWinkel: 0, ay: 0, ax: 0,
        feder: { z: 0, vz: 0, th: 0, vth: 0, ph: 0, vph: 0 },
        koLeben: 3, koAus: false, derbyHealth: 100, derbyKills: 0, derbyAus: false,
      };
      vfNpcSteuern(npc, 0, VF.pts, VF.nrm);
      VF.npcs.push(npc);
      vfModellDaten(VF_MODELL_PFADE[auto]).then((daten) => {
        if (!VF.aktiv || VF.gl !== gl) return;
        npc.modell = vfModellBauen(gl, daten, VF_MODELL_PFADE[auto]);
        npc.P = vfHandlingProfil(vfPhysikAus(daten.meta.physik));
      }).catch(() => { npc.modellFehl = true; /* NPC ohne Modell bleibt unsichtbar */ });
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
  // ---- LIBRECORSA GT3 (v1.5.22, WIP) -------------------------------------------------------------------
  // BESTELLT: "Fuege ein Fahrgefuehl ein, das sich exakt so wie der GT3 BMW M4 bei LibreCorsa anfuehlt."
  // LibreCorsa (librecorsa.org, AGPL-3.0) wird NICHT kopiert: nachgebaut nach den veroeffentlichten Messwerten des
  // GT3 (docs/physics/README.md dort, Mercedes-AMG GT3 gegen MoTeC; der BMW M4 GT3 faehrt dort auf derselben Physik):
  //   dauerhafte Quer-g  81 km/h 1,71 | 99 1,75 | 117 1,80 | 153 1,92 | 171 1,98   (Abtrieb waechst mit dem Tempo)
  //   Untersteuergradient 1,42 Grad/g, Reifenfenster 70-85 Grad C
  // Abgestimmt mit einem Python-Nachbau von vfDynamik (stationaere Kreisfahrt, Lenkung bis zum Maximum): Griff vorn/hinten,
  // Schraeglaufsteifigkeit vorn und Abtrieb je Achse. Ergebnis 1,66 | 1,72 | 1,77 | 1,87 | 1,93 g und 1,39 Grad/g, also
  // jeweils innerhalb von 3 % (LibreCorsa selbst liegt bis 10 % neben dem echten Auto). Laengs (Antritt, Bremsen) kommt
  // wie bei allen Modi aus dem Fahrgefuehl des echten Autos; der Modus fuer echte Autos folgt (Paket 5).
  // Unabhaengig vom gewaehlten Modell: Geometrie und Masse des GT3 (VF_GT3), nur die abgestimmten Werte darueber.
  const VF_LC_GT3 = { muV: 1.81, muH: 2.32, BV: 8.55, BH: 11.0, kV: 0.5, kH: 0.625 };
  function vfHandlingProfil(P) {
    if (!P) return P;
    const h = vfHandling();
    if (h === 'librecorsa') return Object.assign({}, VF_GT3, VF_LC_GT3);
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
    if (hand === 'acc' || hand === 'librecorsa') {
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
  // Wie bei den Flaechen zwei Programme (Review nach 1.3.131): Performance ist der Autoshader von
  // 1.3.92, Quality der von v1.3.124 (linear, Himmelslicht, sonnenausgerichteter Glanz, Klarlack,
  // Scheibenspiegelung, Schattenkarte) - mit Blickvektor und Schattenkoordinaten aus dem Vertexshader.
  // Radius des PCF-Kerns im Quality-Autoshader: 2 (5x5) am Rechner, 1 (3x3) auf Touch-Geraeten.
  // v1.6.5 BESTELLT: "Himmel ist langweilig - etwas mehr Wolken beim sonnigen Modus, aber nicht Performance schlechter
  // machen." Nur die Dichte (gleiche fbm-Kosten): 0,5 -> 0,72.
  const VF_WOLKEN = 0.72;
  const VF_PCF_R = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ? 1 : 2;
  function vfProgrammTex(gl, qual) {
    const p = gl.createProgram();
    if (!qual) {
      gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
        'attribute vec3 p; attribute vec3 n; attribute vec2 uv; uniform mat4 m; uniform mat4 w; uniform mat3 nm;'
        + 'uniform vec3 aug; varying vec2 vuv; varying vec3 vn; varying float vd; varying float vsd;'
        + 'void main(){ vec4 q = w * vec4(p, 1.0); gl_Position = m * q; vuv = uv; vn = nm * n; vd = gl_Position.w;' + ' vec2 dd_ = q.xz - aug.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
      gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
        'precision mediump float; varying vec2 vuv; varying vec3 vn; varying float vd; varying float vsd; uniform vec3 dunst;'
        + 'uniform sampler2D tx; uniform vec3 tint; uniform float emis; uniform float alpha; uniform float am; uniform float licht; uniform vec3 nebel; uniform float lack; uniform vec3 sonne;'
        + 'void main(){ vec4 t = texture2D(tx, vuv); vec3 tb = mix(t.rgb, vec3(min(dot(t.rgb, vec3(0.299, 0.587, 0.114)) * 1.7, 0.82)), lack); vec3 N = normalize(vn);'
        + ' float d = max(dot(N, normalize(vec3(0.35, 0.9, 0.25))), 0.0); float s = pow(max(dot(N, normalize(vec3(0.2, 0.75, -0.6))), 0.0), 24.0);'
        + ' float l = mix(1.0, 0.42 + 0.66 * d, licht); vec3 c = tb * tint * (l * sonne + emis) + vec3(s * 0.35 * licht) * sonne;'
        + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, mix(nebel, dunst, vsd * vsd), f), mix(alpha, alpha * t.a, am)); }'));
    } else {
      gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
        'attribute vec3 p; attribute vec3 n; attribute vec2 uv; uniform mat4 m; uniform mat4 w; uniform mat3 nm; uniform mat4 schM; uniform vec3 auge;'
        + 'varying vec2 vuv; varying vec3 vn; varying float vd; varying vec3 vv; varying vec3 vsp; varying float vsd;'
        + 'void main(){ vec4 q = w * vec4(p, 1.0); gl_Position = m * q; vuv = uv; vn = nm * n; vd = gl_Position.w;'
        + ' vv = auge - q.xyz; vsp = (schM * q).xyz * 0.5 + 0.5;' + ' vec2 dd_ = q.xz - auge.xz; vsd = max(dot(dd_, vec2(0.8137, 0.5812)), 0.0) * inversesqrt(dot(dd_, dd_) + 0.0001);' + '}'));
      gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
        '#ifdef GL_OES_standard_derivatives\n#extension GL_OES_standard_derivatives : enable\n#endif\n'
        + 'precision mediump float;\n' + VF_HP
        + 'varying vec2 vuv; varying vec3 vn; varying float vd; varying vec3 vv; varying HP vec3 vsp; varying float vsd; uniform vec3 dunst;'
        + 'uniform samplerCube umw; uniform float umwAn;'
        + 'uniform sampler2D tx; uniform vec3 tint; uniform float emis; uniform float alpha; uniform float am; uniform float licht; uniform vec3 nebel;'
        + 'uniform float klar; uniform float glas; uniform sampler2D sch; uniform float schatt; uniform HP float bias; uniform HP float biasPixel; uniform float lack; uniform vec3 sonne;'
        + 'uniform vec3 horizont; uniform vec3 zenit;'
        + 'vec3 filmic(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }'
        + 'HP float schTiefe(HP vec4 v){ return dot(v, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }'
        + 'void main(){ vec4 t = texture2D(tx, vuv); vec3 tb = mix(t.rgb, vec3(min(dot(t.rgb, vec3(0.299, 0.587, 0.114)) * 1.7, 0.82)), lack); vec3 N = normalize(vn); vec3 L = normalize(vec3(0.35, 0.9, 0.25));'
        + ' vec3 V = normalize(vv); float d = max(dot(N, L), 0.0); vec3 R = reflect(-L, N); float rv = max(dot(R, V), 0.0);'
        + ' vec3 amb = mix(vec3(0.30, 0.27, 0.23), vec3(0.55, 0.68, 0.90), N.y * 0.5 + 0.5);'
        + ' float sheen = pow(max(dot(N, normalize(L + V)), 0.0), 64.0) * 0.45;'
        + ' float l = mix(1.0, 0.30 + 0.72 * d, licht);'
        + ' vec3 c = pow(tb, vec3(2.2)) * tint * ((amb * 0.55 + l) * sonne + emis);'
        // v1.5.157: Lack glaenzender. Der Hauptglanz wird enger (45 statt 24) und heller; der Klarlack
        // bekommt einen engen, kräftigeren Glanzpunkt statt der breiten Streuung (Exponent 6), und klar
        // steigt (0.3 -> 0.5), damit die Karosserie mehr Umgebung spiegelt ("nasser" Lack, v.a. Quality).
        + ' c += vec3(pow(rv, 45.0) * 0.72 * licht + sheen * licht);'
        + ' c += vec3(0.06, 0.07, 0.08) * klar * pow(rv, 45.0) * 1.6;'
        + ' vec3 Rv = reflect(-V, N); vec3 env = pow(mix(horizont, zenit, clamp(Rv.y * 1.5 + 0.1, 0.0, 1.0)), vec3(2.2));'
        // v1.5.94 (G2): der echte Himmel (Wolken, Sonne, Boden) aus der Umgebungskarte, leicht unscharf.
        + ' if (umwAn > 0.5) env = pow(textureCube(umw, Rv, 1.5).rgb, vec3(2.2)) * 1.15;'
        + ' c += env * klar * (0.05 + 0.6 * pow(1.0 - max(dot(N, V), 0.0), 5.0)) * 0.9;'
        + ' c += vec3(pow(1.0 - max(dot(N, V), 0.0), 5.0) * glas * 0.9);'
        + ' c = pow(filmic(c * 1.05), vec3(1.0/2.2));'
        // v1.5.158 (Review): Die Kerngroesse k VOR der Verzweigung (fwidth ist in einer ungleichmaessigen Verzweigung
        // undefiniert) und auf hoechstens 2 Texel begrenzt (sonst greift der Kern weit in die Karte: falscher Eigenschatten).
        // Die Direktiven stehen auf eigenen Zeilen - bis 1.5.157 standen #ifdef/#endif mitten in einer Zeile, der Shader
        // kompilierte nicht, und alle Autos fielen still auf Performance zurueck (kein Eigenschatten, kein Lackspiegel).
        // Die Zeilenumbrueche stehen als Escape im Text: echte Umbrueche in der Zeichenkette (1.5.158) waren ein
        // SyntaxError, das ganze Skript lief nicht.
        + ' HP float k = biasPixel;\n#ifdef GL_OES_standard_derivatives\n k = clamp(max(fwidth(vsp.x), fwidth(vsp.y)), biasPixel, 2.0 * biasPixel);\n#endif\n'
        // Schattenkarte: Bias waechst mit flachem Lichteinfall (Streifen auf schraegen Blechen).
        + ' if (schatt > 0.5 && vsp.x > 0.0 && vsp.x < 1.0 && vsp.y > 0.0 && vsp.y < 1.0 && vsp.z > 0.0 && vsp.z <= 1.0) {'
        + '   HP float b = vsp.z - bias * (1.0 + 3.0 * (1.0 - d)); float s = 0.0;'
        // v1.5.154: bildschirm-adaptiver PCF-Kern. biasPixel ist der feste Kern in Texeln; fwidth(vsp.xy)
        // ist der Fussabdruck der Schattenkarte in Bildpunkten. max(..., biasPixel) nimmt immer mindestens
        // einen Texel, damit die Kante bei vergroesserter Karte (Auto nah, Verfolger) nicht eckig bleibt,
        // und passt sich bei entfernter Karte (TV, Stativ) an - dort verhindert der breitere Kern das Flimmern.
        // 7x7 (49 Abtastungen) statt 3x3/5x5: der Bodenschatten bleibt beim 3x3-Kern. Ohne die Erweiterung
        // (GL_OES_standard_derivatives) faellt der Kern auf den festen biasPixel zurueck.
        // v1.5.158 (Review): Kern 5x5 am Rechner, 3x3 auf Touch-Geraeten (VF_PCF_R); 7x7 kostete 49 Abtastungen je Pixel.
        + '   for (int ox = -' + VF_PCF_R + '; ox <= ' + VF_PCF_R + '; ox++) for (int oy = -' + VF_PCF_R + '; oy <= ' + VF_PCF_R + '; oy++)'
        + '     s += step(schTiefe(texture2D(sch, vsp.xy + vec2(float(ox), float(oy)) * k)), b);'
        + '   c *= mix(1.0, 0.55, s / ' + ((2 * VF_PCF_R + 1) * (2 * VF_PCF_R + 1)) + '.0); }'
        + ' float f = clamp((vd - 250.0) / 900.0, 0.0, 1.0); gl_FragColor = vec4(mix(c, mix(nebel, dunst, vsd * vsd), f), mix(alpha, alpha * t.a, am)); }'));
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['m', 'w', 'nm', 'tx', 'tint', 'emis', 'alpha', 'am', 'licht', 'nebel', 'sonne', 'horizont', 'zenit', 'auge', 'klar', 'glas', 'sch', 'schM', 'schatt', 'bias', 'biasPixel', 'lack', 'dunst', 'aug', 'umw', 'umwAn'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    // Feste Zwischenspeicher fuer die Matrizen je Teil (keine Float32Array je Teil und Bild).
    return { p, u, qual: !!qual, f16: new Float32Array(16), f9: new Float32Array(9), pv: new Float32Array(16), schM: new Float32Array(16),
             ap: gl.getAttribLocation(p, 'p'), an: gl.getAttribLocation(p, 'n'), auv: gl.getAttribLocation(p, 'uv') };
  }
  // ---- Schatten (v1.3.113, nur Quality) ----------------------------------------------------------
  // BESTELLT: "Grafik verbessern. Es soll 2 Modi geben: Performance und Quality." Gemini-Tipp: ein
  // DirectionalLight mit Schatten. Der Renderer rechnet selbst (kein Three.js), also: eine Schattenkarte
  // (Depth-Textur) aus Richtung der Sonne, in die Spielerauto und NPCs gerendert werden, und in den
  // Bodenshader wird daraus der Schatten gelesen. Die Sonnenrichtung ist dieselbe wie im Autoshader
  // (0.35, 0.9, 0.25). Die Tiefe steht gepackt in einer RGBA-Textur (v1.3.123); gelingt das Framebuffer
  // nicht, bleibt der weiche Blob-Schatten (M.schatten).
  function vfProgrammSchatten(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec3 p; uniform mat4 m; void main(){ gl_Position = m * vec4(p, 1.0); }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      // highp, wo vorhanden: in mediump (10 Bit Mantisse) waren die drei unteren Bytes Rauschen.
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n'
      + 'vec4 pack(float d){ vec4 r = vec4(d, fract(d*255.0), fract(d*65025.0), fract(d*16581375.0)); r -= r.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); return r; }'
      + 'void main(){ gl_FragColor = pack(gl_FragCoord.z); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return { p, m: gl.getUniformLocation(p, 'm'), ap: gl.getAttribLocation(p, 'p'), f16: new Float32Array(16) };
  }
  // Schattenkarte anlegen: die Tiefe wird als Graustufen-Farbe in eine RGBA-Textur geschrieben
  // (WebGL1 kann Depth-Texturen nicht zuverlaessig abtasten; in eine RGBA-Textur dagegen ja).
  // Das Tiefen-Renderbuffer dient nur dem Tiefentest beim Zeichnen. Liefert null, wenn das
  // Framebuffer unvollstaendig bleibt - dann gibt es eben keine echten Schatten.
  function vfSchattenBauen(gl, size) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) return null;
    return { fbo, tex, size };
  }
  // Orthografische Projektion (spaltenweise, wie vfPerspektive), fuer die Schattenkamera.
  function vfOrtho(l, r, b, t, n, f) {
    return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
            -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1];
  }
  // Sonnenrichtung (vom Licht weg, wie im Autoshader beleuchtet): normalize(0.35, 0.9, 0.25).
  function vfSonne() {
    const v = [0.35, 0.9, 0.25], l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  // Schattenmatrix fuer ein Zentrum: Blick von der Sonne auf das Zentrum, orthografisch um das Zentrum.
  // Abdeckung 80 x 80 Einheiten (v1.3.124: auch die NPCs werfen Schatten). Die Lichtkamera steht
  // VF_SCHATTEN_AB vor dem Zentrum; der Tiefenbereich liegt deshalb bei AB +- 40 (vorher -40..40 um die
  // Kamera: das Zentrum lag 200 dahinter, alles fiel aus der Karte und es gab gar keinen Schatten).
  // Einrasten: das Zentrum springt in der Lichtebene nur um ganze Texel (2 * 40 / Kartengroesse
  // Welteinheiten), sonst wabern die Kanten beim Fahren. Die Achsen der Lichtkamera sind fest (die Sonne
  // steht still), also reicht es, das Zentrum entlang ihrer rechts/oben-Achse zu runden.
  const VF_SCHATTEN_HALB = 40, VF_SCHATTEN_AB = 200;
  function vfSchattenMatrix(z) {
    const sd = vfSonne(), lg = VF_SCHATTEN_HALB, ab = VF_SCHATTEN_AB;
    const size = (VF.schatte && VF.schatte.size) || 1024;
    const tw = 2 * lg / size;
    const roh = vfBlick([sd[0] * ab, sd[1] * ab, sd[2] * ab], [0, 0, 0], [0, 1, 0]);
    const r = [roh[0], roh[4], roh[8]], o = [roh[1], roh[5], roh[9]];
    const pr = r[0] * z[0] + r[1] * z[1] + r[2] * z[2], po = o[0] * z[0] + o[1] * z[1] + o[2] * z[2];
    const dr = Math.round(pr / tw) * tw - pr, dO = Math.round(po / tw) * tw - po;
    const zz = [z[0] + r[0] * dr + o[0] * dO, z[1] + r[1] * dr + o[1] * dO, z[2] + r[2] * dr + o[2] * dO];
    const blick = vfBlick([zz[0] + sd[0] * ab, zz[1] + sd[1] * ab, zz[2] + sd[2] * ab], zz, [0, 1, 0]);
    return vfMal(vfOrtho(-lg, lg, -lg, lg, ab - lg, ab + lg), blick);
  }
  // Ein Modell in die Schattenkarte zeichnen (nur die undurchsichtigen Karosserie- und Radteile). Die
  // Teillisten sind beim Bauen sortiert (M.aufbauTeile, M.radTeile), die Matrix geht ueber SP.f16.
  const VF_RAD_KARTENSCHATTEN = false;   // v1.5.19: Raeder ohne Schatten in der Schattenkarte (siehe unten)
  function vfModellSchatten(gl, SP, M, x, y, h, fe, lenkWinkel, raddreh, radModell, fs, nick, schM) {
    const d = M.d;
    const s = VF_AUTO.L / d.laenge;
    const lage = vfMal(vfLage(x, y, h), vfS(s, s, s));
    const g = fs || 1, fez = fe || { z: 0, th: 0, ph: 0 };
    const zSp = d.vorderachse - d.a, boden = (d.reifen.vorn.bodenfreiheit + d.reifen.hinten.bodenfreiheit) / 2;
    const aufbau = vfKette(lage, vfT(0, boden - fez.z * g, zSp), vfT(0, d.schwerpunktHoehe, 0), vfRx((fez.th + (nick || 0)) * g * 0.55), vfRz(fez.ph * g),
      vfT(0, -d.schwerpunktHoehe, -zSp));
    const matrix = (w) => { vfMalIn(SP.f16, schM, w); gl.uniformMatrix4fv(SP.m, false, SP.f16); };
    gl.useProgram(SP.p);
    matrix(aufbau);
    gl.bindBuffer(gl.ARRAY_BUFFER, M.vbo);
    gl.enableVertexAttribArray(SP.ap);
    gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ibo);
    // v1.5.104 (aus PR 3 von gnen54): die Indizes zaehlen je Teil ab dessen erster Ecke (ecke0) - wie im Farb-Durchgang
    // versetzen. Vorher warfen mehrteilige Modelle (Kaefer, Spider) falsche Schatten.
    for (const t of M.aufbauTeile) {
      gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, (t.ecke0 || 0) * 32);
      gl.drawElements(gl.TRIANGLES, t.indizes, gl.UNSIGNED_SHORT, t.index0 * 2);
    }
    // v1.5.19 GEMELDET: "entferne die komischen sich drehenden flachen/spitzen Schatten der Raeder im Quality-Modus".
    // Die Raeder gingen DREHEND in die Schattenkarte; bei der steilen Sonne sieht die Karte die Felge fast von der
    // Kante, und Speichen oder Ventil warfen eine flache bzw. spitze Silhouette, die mitlief. Auch ohne Drehung blieben
    // lange spitze Streifen (gemessen im Bild). Darum werfen die Raeder GAR KEINEN Kartenschatten mehr: den Boden
    // unter ihnen dunkelt der weiche Kontaktschatten des Autos (M.schatten), der Aufbau wirft weiter seinen Schatten.
    if (VF_RAD_KARTENSCHATTEN) {
    const radTeile = M.radTeile;
    const halbW = d.breite / 2;
    for (let k = 0; k < 4; k++) {
      const seite = (k & 1) ? -1 : 1, ax = k < 2 ? 'vorn' : 'hinten', z = k < 2 ? d.vorderachse : d.hinterachse;
      const r = d.reifen[ax];
      const dreh = vfRy(ax === 'vorn' ? -(lenkWinkel || 0) : 0);
      if (radTeile.length) {
        matrix(vfKette(lage, vfT(seite * r.spur / 2, r.radius, z), dreh, vfRx(0), vfS(seite * r.breite, 2 * r.radius, 2 * r.radius)));
        gl.bindBuffer(gl.ARRAY_BUFFER, M.vbo);
        gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.ibo);
        for (const t of radTeile) {
          if (t.achse && t.achse !== ax) continue;
          gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, (t.ecke0 || 0) * 32);
          gl.drawElements(gl.TRIANGLES, t.indizes, gl.UNSIGNED_SHORT, t.index0 * 2);
        }
      } else if (radModell && radModell.teile.length) {
        const xW = seite * vfRadX(r, halbW);
        matrix(vfKette(lage, vfT(xW, r.radius, z), dreh, vfRx(0), vfS(seite * r.breite, 2 * r.radius, 2 * r.radius)));
        gl.bindBuffer(gl.ARRAY_BUFFER, radModell.vbo);
        gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, radModell.ibo);
        for (const t of radModell.teile) {
          gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 32, (t.ecke0 || 0) * 32);
          gl.drawElements(gl.TRIANGLES, t.indizes, gl.UNSIGNED_SHORT, t.index0 * 2);
        }
      }
    }
    }
    gl.disableVertexAttribArray(SP.ap);
  }
  // Der Schatten-Durchgang: Spielerauto und NPCs einmal in die Schattenkarte rendern.
  function vfSchattenPass(gl) {
    if (!VF.schatte || !VF.schatteProg || !VF.schM) return;
    const SP = VF.schatteProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, VF.schatte.fbo);
    gl.viewport(0, 0, VF.schatte.size, VF.schatte.size);
    // v1.3.123: Die Tiefe liegt als Graustufen-Farbe in der RGBA-Textur. Fern = 1.0 (weiss) wird
    // zuverlaessig per clearColor geleert (bei Depth-Texturen auf WebGL1 ging das nicht, und das
    // ganze Lichtquadrat ums Auto wurde abgedunkelt -> "weisses Quadrat").
    gl.clearColor(1, 1, 1, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(SP.p);
    if (VF.modell && VF.tprog) {
      vfModellSchatten(gl, SP, VF.modell, VF.x, VF.y, VF.h, VF.feder, VF.lenkWinkel, VF.raddreh, VF.radModell, vfFederSicht(), VF.pitch || 0, VF.schM);
    } else if (VF.auto) {
      vfMalIn(SP.f16, VF.schM, vfLage(VF.x, VF.y, VF.h));
      gl.uniformMatrix4fv(SP.m, false, SP.f16);
      gl.bindBuffer(gl.ARRAY_BUFFER, VF.auto.b);
      gl.enableVertexAttribArray(SP.ap);
      gl.vertexAttribPointer(SP.ap, 3, gl.FLOAT, false, 24, 0);
      gl.drawArrays(gl.TRIANGLES, 0, VF.auto.n);
    }
    if (VF.npcs && VF.tprog) {
      for (const npc of VF.npcs) {
        if (!npc.modell) continue;
        vfModellSchatten(gl, SP, npc.modell, npc.x, npc.y, npc.h, npc.feder, npc.lenkWinkel, npc.raddreh, VF.radModell, 1, 0, VF.schM);
      }
    }
    gl.disableVertexAttribArray(SP.ap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
  // v1.5.84 GEMELDET: "Räder der virtuellen Autos fixen: sie haben entweder keine, oder die stehen zu weit nach außen
  // ab". Jede Fahrt hat einen NEUEN Grafikkontext (eigene Leinwand); die Puffer des Radmodells gehoeren aber dem
  // Kontext, in dem sie gebaut wurden. Bis 1.5.83 galt das Radmodell der ersten Fahrt fuer immer: ab der zweiten Fahrt
  // hatten FMC GT4, Boxer 96 und Lynx 220 (ohne eigene Raeder) keine. Jetzt je Kontext.
  function vfRadModellBauen(gl) {
    if (vfRadModell && vfRadModell.gl === gl) return vfRadModell.p;
    vfRadModell = { gl, p: null };
    vfRadModell.p = vfModellDaten('img/autos/v5r/').then((daten) => {
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
    return vfRadModell.p;
  }
  // Abstand der Radmitte zur Mitte des Autos (m, Modellmass) fuer die geliehenen Raeder: halbe Spur, aber der Reifen
  // bleibt mit seiner Aussenkante hoechstens 3 cm innerhalb der Karosserie-Flanke sichtbar.
  function vfRadX(r, halbW) { return Math.max(r.spur / 2, Math.min(halbW - 0.03 - 0.5 * r.breite, r.spur / 2 + 0.06)); }
  function vfTextur(gl, url, rgba) {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba || [150, 150, 155, 255]));
    if (!url) return tx;
    const bild = new Image();
    // Fuer das Ladebild: wie viele Bilder dieser Fahrt noch laden (VF.texOffen, VF.texGesamt).
    let offen = false;
    if (VF.gl === gl) { offen = true; VF.texOffen = (VF.texOffen || 0) + 1; VF.texGesamt = (VF.texGesamt || 0) + 1; }
    const fertig = () => { if (offen && VF.gl === gl) VF.texOffen = Math.max(0, (VF.texOffen || 0) - 1); offen = false; };
    bild.onerror = fertig;
    bild.onload = () => {
      fertig();
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
    // Teillisten einmal hier statt je Bild per filter (Aufbau ohne Glas, Raeder, Glas).
    const teile = daten.meta.teile;
    return { meta: daten.meta, d: daten.meta.physik, vbo, ibo, tex, schatten, glanz: vfGlanzTextur(gl), quad,
             aufbauTeile: teile.filter((t) => t.gruppe === 'auto' && t.rolle !== 'glas' && t.rolle !== 'scheinwerferglas'),
             radTeile: teile.filter((t) => t.gruppe === 'rad'),
             glasTeile: teile.filter((t) => t.rolle === 'glas' || t.rolle === 'scheinwerferglas') };
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
      VF.kachel = tile;
    }
    // v1.5.84 GEMELDET: "Rundenzeitenmessung und Ansage ist verbuggt und startet dann mittendrin". Bis 1.5.83 stand
    // Byte 15 Bit 3 (Ziellinie) in JEDEM Paket. Die App wertet nur die steigende Flanke (handleDashboardBytes): sie sah
    // die "Linie" also im ersten Paket, wo immer das Auto stand, und danach nur nach jedem Abflug, mitten in der Runde.
    // Seit sie die Linie einmal gesehen hatte, zaehlte der Barcode des Startteils nicht mehr. Jetzt meldet das Auto die
    // Linie wie das echte: ein Puls von VF_ZIEL_PULS_MS ab dem Ueberqueren der gezeichneten Linie (VF.zielIdx).
    const jetzt = rennZeitJetzt();
    if (VF.zielVor === undefined || VF.zielVor === null) VF.zielVor = VF.idx;
    const ueber = vfZielUeberquert(VF.zielVor, VF.idx, VF.zielIdx, VF.pts.length);
    // Fortschritt entlang der Mittellinie (Punkte, vorwaerts positiv; aus PR 4 von gnen54, "Keine Rundenzaehlung
    // bei Rueckwaertsfahrt"): eine Runde gilt erst nach gut drei Vierteln der Strecke seit der letzten Linie, die
    // erste Ueberfahrt (Uhr startet) nur vorwaerts. Zusammen mit zielRueck zaehlt so weder Rueckwaertsfahren noch
    // das Pendeln ueber die Linie.
    {
      const n = VF.pts.length;
      let d = VF.idx - (VF.fortVor === undefined || VF.fortVor === null ? VF.idx : VF.fortVor);
      if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
      VF.fort = (VF.fort || 0) + d; VF.fortVor = VF.idx;
    }
    VF.zielVor = VF.idx;
    const genugWeg = VF.rundeAb ? VF.fort > VF.pts.length * 0.75 : VF.fort >= 0;
    if (ueber < 0) VF.zielRueck = (VF.zielRueck || 0) + 1;          // rueckwaerts ueber die Linie: die naechste zaehlt nicht
    else if (ueber > 0 && VF.zielRueck) VF.zielRueck--;
    else if (ueber > 0 && !VF.abseits && genugWeg) {
      VF.zielAt = jetzt;
      VF.fort = 0;
      vfRundeAnLinie(jetzt);
    }
    const b = new Uint8Array(19);
    b[0] = 0xaf; b[2] = 0x9c; b[10] = 100;
    b[11] = VF.zaehler;
    b[12] = VF.abseits ? TILE_OFFTRACK : vfCode(VF.tiles[tile] ? VF.tiles[tile].type : TILE_TYPE.STRAIGHT);
    b[15] = (!VF.abseits && VF.zielAt && jetzt - VF.zielAt < VF_ZIEL_PULS_MS) ? 0x08 : 0;
    try { onCarNotify(VF.car, { target: { value: new DataView(b.buffer) } }); } catch (e) { /* weiter */ }
  }

  // ---- v1.5.84: ZIELLINIE ----
  // Wie lange das Auto die Linie meldet (das echte haelt das Bit rund 1 s, Mitschnitte 13.-21.08.).
  const VF_ZIEL_PULS_MS = 1000;
  // Der Punkt der Mittellinie, an dem die Ziellinie liegt: VF_ZIEL_ANTEIL der Punkte des Startteils (Punkte liegen
  // auf einer Geraden gleichmaessig). Ohne Startteil der erste Punkt.
  function vfZielIdx(pts, tiles) {
    const k = tiles.findIndex((tl) => tl && tl.type === TILE_TYPE.START);
    if (k < 0) return 0;
    const ix = [];
    pts.forEach((p, i) => { if (p.tile === k) ix.push(i); });
    if (!ix.length) return 0;
    return ix[Math.min(ix.length - 1, Math.round(VF_ZIEL_ANTEIL * ix.length))];
  }
  // Von Punkt vor nach Punkt nach: 1 = vorwaerts ueber die Linie, -1 = rueckwaerts, 0 = nicht. Die Linie gilt als
  // ueberquert, wenn nach den Linienpunkt erreicht oder passiert (vor liegt davor). Mehr als eine halbe Runde Sprung
  // gilt als rueckwaerts.
  function vfZielUeberquert(vor, nach, ziel, n) {
    if (!(n > 0) || vor === nach) return 0;
    const weg = ((nach - vor) % n + n) % n;
    if (weg <= n / 2) { const bis = ((ziel - vor) % n + n) % n; return (bis > 0 && bis <= weg) ? 1 : 0; }
    const zur = n - weg, bisZ = ((vor - ziel) % n + n) % n;   // rueckwaerts: von vor zurueck bis ziel
    return bisZ < zur ? -1 : 0;
  }
  // Was an der Linie fuer die Kopfzeile passiert (die Zeitnahme selbst laeuft in der App, ueber den Puls).
  function vfRundeAnLinie(jetzt) {
    if (VF.rundeAb) {
      VF.letzte = jetzt - VF.rundeAb;
      // Delta (HUD): die Zwischenzeiten der besten Runde je Punkt der Mittellinie.
      const best = VF.beste === null || VF.letzte < VF.beste;
      if (best) { VF.beste = VF.letzte; VF.besteSplits = VF.splits; }
      vfGeistRunde(best);
      // Rundenrennen: nach der Ziel-Lap ist Schluss.
      VF.runden = (VF.runden || 0) + 1;
      if (VF.modus === 'laps' && VF.runden >= VF.limit) vfRennenEnde();
      // Time Attack wertet hier NICHT: die Runde laeuft ueber onCarNotify in die Zeitnahme der App,
      // und 70-race.js ruft dort bestzeitRunde/bestzeitMeldung (bis 1.3.131 doppelt, mit der
      // Rundenzahl als Spielernummer "P3: ...").
    } else vfGeistRunde(false);
    VF.rundeAb = jetzt;
    VF.splits = [];
  }
  // v1.5.84: Der Geist faehrt die BESTE Runde, von Linie zu Linie, und startet an jeder Linie neu mit dem Auto.
  // Bis 1.5.83 nahm er die Fahrt vom Start bis zum Ende der ersten vollen Runde (mit Anlauf) und lief dann in
  // Schleife, also bald neben der Runde des Fahrers her.
  function vfGeistRunde(best) {
    const g = VF.geist;
    if (!g) return;
    if (best && g.aufzeichnung.length > 1) g.beste = g.aufzeichnung;
    g.aufzeichnung = []; g.t = 0;
    g.zeit = 0; g.i = 0;
    g.aktiv = !!(g.beste && g.beste.length > 1);
  }

  // ---- v1.5 (Plan Paket 4, Quality): BILDRATEN-WACHE ----
  // "Quality bekommt eine Bildraten-Wache, die Effekte abschaltet, wenn das Geraet nicht mitkommt." Gemessen
  // wird der echte Bildabstand (gleitendes Mittel). Liegt er nach dem Anlauf VF_WACHE.ms lang unter
  // VF_WACHE.fps, schaltet die Wache eine Stufe herunter: 1 = keine Schattenkarte und kein Bloom, 2 = Aufloesung wie
  // Performance und Regentropfen wie Performance. Nie zurueck in derselben Fahrt (kein Flackern).
  // Luecken ueber 250 ms (Pause, verborgener Tab) zaehlen nicht.
  const VF_WACHE = { fps: 40, ms: 4000, anlauf: 3000 };
  function vfWacheStufe() { return VF.wache ? VF.wache.stufe : 0; }
  function vfWacheMessen(roh, now) {
    if (!VF.grafik) return;
    const W = VF.wache || (VF.wache = { stufe: 0, mittel: 1000 / 60, langsamSeit: 0, start: now });
    if (!(roh > 0) || roh > 250) { W.langsamSeit = 0; return; }
    W.mittel += (roh - W.mittel) * 0.05;
    if (now - W.start < VF_WACHE.anlauf || W.stufe >= 2) return;
    if (W.mittel > 1000 / VF_WACHE.fps) {
      if (!W.langsamSeit) W.langsamSeit = now;
      else if (now - W.langsamSeit > VF_WACHE.ms) vfWacheRunter(W, now);
    } else W.langsamSeit = 0;
  }
  function vfWacheRunter(W, now) {
    W.stufe++; W.langsamSeit = 0; W.start = now;
    const fps = Math.round(1000 / W.mittel);
    if (W.stufe === 1) { VF.schM = null; showHudToast(t('Quality: Schatten und Leuchten aus, damit es flüssig bleibt ({f} Bilder/s)').replace('{f}', fps)); }
    else { VF.regen = null; showHudToast(t('Quality: weniger Auflösung und Regentropfen ({f} Bilder/s)').replace('{f}', fps)); }
    log('Virtuell: Bildraten-Wache Stufe ' + W.stufe + ' bei ' + fps + ' Bildern/s.', 'info');
  }

  // ---- v1.5.96 (V1): FESTE PHYSIK-TEILSCHRITTE ----
  // BESTELLT (V1): das Fahrzeug im virtuellen Fahren rechnet in festen Teilschritten von VF_TEIL.dt (500 Hz), unabhaengig
  // von der Bildrate. Bis 1.5.95 lief Lenkung, Reifenmodell, Gier- und Querdynamik, Weg und Federung einmal je Bild mit dem
  // Bildabstand (bis 50 ms): bei 30 Bildern/s fuhr sich das Auto anders (traeger, Federung zappelte) als bei 120. Jetzt
  // sammelt VF.physRest die Bildzeit, und es laufen so viele Teilschritte, wie hineinpassen (hoechstens VF_TEIL.max je Bild;
  // haengt ein Bild laenger, verfaellt der Rest wie vorher ueber 50 ms). Alles andere (Ort auf der Strecke, Randstein,
  // NPCs, Kollision, Geist) bleibt je Bild.
  const VF_TEIL = { dt: 1 / 500, max: 30 };
  function vfFahrPhysik(dt, kmh, st, hand, reifenModus) {
    VF.physRest = (VF.physRest || 0) + dt;
    let n = 0;
    while (VF.physRest >= VF_TEIL.dt - 1e-9 && n < VF_TEIL.max) {
      vfFahrTeilschritt(VF_TEIL.dt, kmh, st, hand, reifenModus);
      VF.physRest -= VF_TEIL.dt; n++;
    }
    if (n >= VF_TEIL.max) VF.physRest = 0;
    VF.teilschritte = n;
    return n;
  }
  // ---- v1.5.101 (H1): LENKHILFE, nur im Handling LibreCorsa ----
  // BESTELLT: "H1 (aber nur für LibreCorsa Modi)". Fuer Gamepad und Tastatur, wie in Rennspielen:
  //  1. S-Kurve: der Einschlag folgt dem Stick ueber eine kritisch gedaempfte Feder (weich an, weich aus).
  //  2. Scheitel: der Einschlag geht nie weiter, als die Vorderachse am Scheitel ihrer Reifenkurve braucht
  //     (Schraeglaufwinkel aV <= Scheitelwinkel). Ueberlenken schiebt dann nicht ueber die Vorderraeder.
  //  3. Selbstausrichten: laesst man den Stick los, stellen sich die Vorderraeder in Fahrtrichtung (Schraeglauf vorn 0).
  //     In einem Rutsch ist das von selbst Gegenlenken.
  //  4. Rutsch einfangen: rutscht das Heck ueber seinen Scheitel, lenkt die Hilfe anteilig gegen (VF_LH.fang).
  const VF_LH = { omega: 26, fang: 0.5, totzone: 0.08 };
  function vfLenkHilfe(ziel, dt, vx) {
    const P = VF.P || VF_GT3, z = VF.dyn || { vy: 0, r: 0 }, g = P.lenkGrad * Math.PI / 180;
    let soll = ziel;
    if (vx > 3) {
      const betaV = Math.atan2(z.vy + P.a * z.r, vx), betaH = Math.atan2(z.vy - P.b * z.r, vx);
      const spV = Math.tan(Math.PI / (2 * P.C)) / P.BV, spH = Math.tan(Math.PI / (2 * P.C)) / P.BH;
      // 3. Stick in der Mitte: Raeder in Fahrtrichtung.
      if (Math.abs(ziel) < VF_LH.totzone) soll = betaV / g;
      // 4. Heck ueber dem Scheitel: anteilig gegenlenken (aH > 0 heisst, das Heck schiebt nach links aussen).
      if (Math.abs(betaH) > spH) soll += VF_LH.fang * (betaH - Math.sign(betaH) * spH) / g;
      // 2. Nicht ueber den Scheitel vorn: delta in [betaV - spV, betaV + spV].
      soll = Math.max((betaV - spV) / g, Math.min((betaV + spV) / g, soll));
    }
    soll = Math.max(-1, Math.min(1, soll));
    // 1. S-Kurve.
    if (VF.lhV === undefined) VF.lhV = 0;
    const w = VF_LH.omega;
    VF.lhV += (w * w * (soll - (VF.lenkIst || 0)) - 2 * w * VF.lhV) * dt;
    return Math.max(-1, Math.min(1, (VF.lenkIst || 0) + VF.lhV * dt));
  }
  function vfFahrTeilschritt(sdt, kmh, st, hand, reifenModus) {
    // v1.1.11 GEMELDET: "Virtuelles Fahren ruckelt und ist sehr traege." Bisher lenkte das Auto mit
    // physEngine.state.dampedSteering: das rechnet die Physik nur alle 45 ms (Treppenstufen in der
    // Gierrate = Ruckeln), mit der Servodaempfung und der Lenkbegrenzung bei Tempo des ECHTEN Autos
    // (= traege). Jetzt direkt der Stick (steerX), voller Einschlag in 0,12 s, bei hohem Tempo etwas
    // weniger Einschlag wie ein Spiel-Lenkfilter; den Rest erledigt das Reifenmodell.
    const vVollL = Math.abs(kmh) * REAL_SCALE / 3.6;
    const lenkZiel = Math.max(-1, Math.min(1, typeof steerX === 'number' ? steerX : 0)) / (1 + (vVollL / 55) * (vVollL / 55));
    // v1.5.101 (H1, nur LibreCorsa): Lenkhilfe fuer Gamepad und Tastatur, siehe vfLenkHilfe.
    const hilfe = hand === 'librecorsa' && Math.abs(kmh) > 0;
    if (hilfe) VF.lenkIst = vfLenkHilfe(lenkZiel, sdt, Math.max(0, kmh * REAL_SCALE / 3.6));
    else {
      const schritt = sdt / 0.09;
      VF.lenkIst = (VF.lenkIst || 0) + Math.max(-schritt, Math.min(schritt, lenkZiel - (VF.lenkIst || 0)));
    }
    const lenk = VF.lenkIst;
    if (kmh < 0) {
      // Rueckwaerts (Rangieren): rein kinematisch wie bisher.
      const neu = vfSchritt(VF, kmh, lenk, sdt, physEngine.config.gripScale);
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
        VF.tyreTemp = vfReifenTemp(VF.tyreTemp, vVollL, VF.ay || 0, sdt);
        mu *= vfReifenGriff(VF.tyreTemp, hand);
      }
      // H5 (v1.5.101): dreckige Luft (st.dirtyAir, gesetzt in vfVerkehr) kostet Griff an der Vorderachse, wie beim
      // echten Fahren (dirtyAirMax mal dirtyAirEffect aus den Optionen). Der Windschatten bleibt, wie er ist.
      const luftV = 1 - (physEngine.config.dirtyAirMax || 0) * Math.max(0, Math.min(2, physEngine.config.dirtyAirEffect || 0))
        * Math.max(0, Math.min(1, st.dirtyAir || 0));
      vfDynamik(VF.dyn, vVoll, ax, Math.max(0, st.longUse || 0), lenk, sdt, mu, VF.P, luftV);
      VF.ax = ax; VF.ay = vVoll * VF.dyn.r;
      // Nickbewegung: beim Bremsen senkt sich die Nase, beim Beschleunigen hebt sie sich (dezent).
      VF.pitch = Math.max(-0.03, Math.min(0.03, -(VF.ax || 0) * 0.0018));
      // Weg in der Bahnwelt: Tempo des Modellautos, Richtung = Kurs + Schwimmwinkel.
      VF.h += VF.dyn.r * sdt * 180 / Math.PI;
      const beta = Math.atan2(VF.dyn.vy, Math.max(0.1, vVoll));
      const vE = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM;
      const rich = VF.h * Math.PI / 180 + beta;
      VF.x += Math.sin(rich) * vE * sdt;
      VF.y -= Math.cos(rich) * vE * sdt;
    }
    // Raeder drehen mit dem Weg, Federung folgt Laengs- und Querbeschleunigung (neben der Bahn ruettelt es).
    const wegE = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM * sdt;
    VF.raddreh = ((VF.raddreh || 0) + wegE / (VF_AUTO.L / 4.64 * 0.335)) % (Math.PI * 2);
    if (VF.modell) {
      if (!VF.feder) VF.feder = { z: 0, vz: 0, th: 0, vth: 0, ph: 0, vph: 0 };
      // Zufallsstoesse neben der Bahn: je Teilschritt einer; mit sqrt(Bild/Teilschritt) so stark wie vorher einer je Bild.
      const stoss = VF.abseits && Math.abs(kmh) > 0.05 ? (Math.random() - 0.5) * VF.modell.d.masse * 9 * Math.sqrt(Math.max(1, (VF.dtBild || sdt) / sdt)) : 0;
      vfFederung(VF.feder, VF.ax || 0, VF.ay || 0, sdt, VF.modell.d, stoss);
    }
  }
  function vfBild(now) {
    if (!VF.aktiv) return;
    VF.raf = requestAnimationFrame(vfBild);
    // Ladebild: bis Klaenge, Texturen und Autos da sind, steht alles (kein HUD, keine Physik, keine Uhren).
    if (VF.laedt && vfLadeSchritt(now)) {
      VF.letzt = now; VF.letztRoh = now; VF.dtBild = 0;
      if (physEngine && physEngine.state) physEngine.state.speedKmh = 0;
      return;
    }
    vfWacheMessen(VF.letztRoh ? now - VF.letztRoh : 0, now);
    VF.letztRoh = now;
    if (rennPauseAktiv()) {
      VF.letzt = now; VF.dtBild = 0; vfMalen(); vfHud();
      if (physEngine && physEngine.state) physEngine.state.vfNutzung = 0;
      return;
    }
    const dt = VF.letzt ? Math.min(0.05, (now - VF.letzt) / 1000) : 0.016;
    VF.letzt = now;
    if (VF.wxEinmalAt && rennZeitJetzt() >= VF.wxEinmalAt) vfWetterEinmal();
    const st = physEngine.state;
    VF.dtBild = dt;
    // Zeitmodi (Endurance, Qualifying): laufen gegen die Rennzeit.
    if (VF.modus && (VF.modus === 'endurance' || VF.modus === 'qualifying') && VF.limit) {
      VF.modusZeit += dt;
      if (VF.modusZeit >= VF.limit * 60) vfRennenEnde();
    }
    // Rueckwaertsgang raus wie auf der echten Bahn (aus PR 4 von gnen54: "Sobald er dann wieder steht und ich Gas
    // gebe, geht er aus dem Rueckwaertsgang raus"), nur Automatik: erst rueckwaerts gefahren, dann mit losgelassenem
    // Gas zum Stehen gekommen - der naechste Gasstoss legt den Vorwaertsgang ein. Ausgewertet wird der ANSTIEG des
    // Gases, damit es nicht an der Bildrate haengt, ob er umschaltet.
    if (st.driveMode === 'reverse' && physEngine.config.autoShift) {
      const ty = typeof throttleY === 'number' ? throttleY : 0, v = Math.abs(st.speedKmh || 0), gas = ty > 0.1;
      if (gas && !VF.rueckGas && VF.rueckLief && VF.rueckHalt) {
        physEngine.triggerShift(1); VF.rueckLief = false; VF.rueckHalt = false;
      } else if (v > 0.04) { VF.rueckLief = true; if (!gas) VF.rueckHalt = false; }
      if (v < 0.015 && ty <= 0.05) VF.rueckHalt = true;
      if (gas && v > 0.04) VF.rueckHalt = false;
      VF.rueckGas = gas;
    } else { VF.rueckLief = false; VF.rueckHalt = false; VF.rueckGas = false; }
    const kmh = (st.speedKmh || 0) * (VF.tempoFaktor || 1);
    const hand = vfHandling();
    const reifenModus = hand === 'gran' || hand === 'acc' || hand === 'librecorsa';
    // DIAGNOSE (temporaer, Latenz): wie lange die Physik-Teilschritte dauern.
    const tPhys0 = performance.now();
    vfFahrPhysik(dt, kmh, st, hand, reifenModus);
    const physMs = performance.now() - tPhys0;
    const lenk = VF.lenkIst;
    // Geist: jede Runde wird von Linie zu Linie aufgezeichnet; die beste faehrt als Kopie mit (vfGeistRunde).
    if (VF.geist) {
      const g = VF.geist;
      if (VF.rundeAb && g.aufzeichnung.length < 20000) { g.aufzeichnung.push([VF.x, VF.y, VF.h, g.t]); g.t += dt; }
      if (g.aktiv && g.an && g.beste && g.beste.length > 1) {
        g.zeit += dt;
        const a = g.beste;
        const total = a[a.length - 1][3];
        const t = Math.min(g.zeit, total);
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
    // v1.5.155: Die Vorderraeder zeigen den TATSÄCHLICHEN Einschlag, nicht den Stick-Eingang.
    // atan(L*r/vx) ist der Einschlag, der die beobachtete Gierrate im Einspurmodell erzeugt:
    // beim Untersteuern dreht das Auto weniger, als die Raeder zeigen (Raeder wirken "gerade"),
    // beim Uebersteuern mehr (Raeder wirken "ueberdreht"). Beim Rueckwaertsfahren/Stand bleibt
    // der Eingabe-Einschlag (das Auto dreht sich nicht, aber die Raeder koennen eingeschlagen
    // sein), und der Einschlag ist auf die Lenkbegrenzung gedeckelt (mehr kann das Rad nicht).
    const Pw = VF.P || VF_GT3;
    const lenkGradW = Pw.lenkGrad * Math.PI / 180;
    if (kmh <= 0) {
      VF.lenkWinkel = Math.max(-1, Math.min(1, lenk)) * lenkGradW;
    } else {
      const vVoll = kmh * REAL_SCALE / 3.6;
      const L = Pw.a + Pw.b;
      VF.lenkWinkel = Math.max(-lenkGradW, Math.min(lenkGradW,
        Math.atan2(L * ((VF.dyn && VF.dyn.r) || 0), Math.max(0.1, vVoll))));
      // v1.5.158 (Review): rutscht das Heck (Schraeglauf hinten ueber dem Scheitel), zeigen die Raeder den echten
      // Lenkeinschlag - sonst waere das Gegenlenken im Drift unsichtbar (die Gierrate zeigt in die Drehung).
      const spHw = Math.tan(Math.PI / (2 * (Pw.C || 1.5))) / (Pw.BH || 10);
      if (VF.dyn && Math.abs(VF.dyn.aH || 0) > spHw) VF.lenkWinkel = Math.max(-1, Math.min(1, lenk)) * lenkGradW;
    }
    // v1.5.155: Reifenausnutzung fuer das Quietschen (siehe vfDynamik). In der virtuellen Fahrt
    // treibt der echte Schraeglauf das Quietschen ueber physEngine.state.vfNutzung; der
    // Eingabe-basierte latUse des Einspurmodells faengt Unter-/Uebersteuern nicht.
    if (physEngine && physEngine.state) {
      physEngine.state.vfNutzung = (VF.dyn && VF.dyn.nutzung) || 0;
    }
    // DIAGNOSE (temporaer, Latenz): Zeit fuer Streckenortung (vfOrt).
    const tOrt0 = performance.now();
    const o = vfOrt(VF.pts, VF.nrm, VF.x, VF.y, VF.idx);
    const ortMs = performance.now() - tOrt0;
    VF.idx = o.idx;
    if (VF.splits && VF.splits[VF.idx] === undefined) VF.splits[VF.idx] = rennZeitJetzt() - VF.rundeAb;
    // Bruecke und Rampen (aus PR 4 von gnen54): seitlich begrenzt (Bordwand), herunterfallen gibt es nicht. Die
    // Steigung bremst bergauf und beschleunigt bergab (g mal sin, verkleinert um REAL_SCALE wie die Physik).
    const Hb = vfHzSpieler();
    if (Hb.z > 0.3) {
      const grenze = TRACK_HALF_W + TRACK_KERB_W - VF_AUTO.B * 0.5;
      if (Math.abs(o.quer) > grenze) {
        const zu = (Math.abs(o.quer) - grenze) * Math.sign(o.quer);
        VF.x -= VF.nrm[o.idx].x * zu; VF.y -= VF.nrm[o.idx].y * zu; o.quer -= zu;
        if (Math.abs(st.speedKmh) > 0.05 && (VF.wandSeit === undefined || rennZeitJetzt() - VF.wandSeit > 300)) {
          VF.wandSeit = rennZeitJetzt(); padRumble(0.6, 0.4, 90, 'kerb', 1);
        }
        st.speedKmh *= Math.exp(-2.5 * dt);
      }
    }
    if (Hb.p) st.speedKmh -= 9.81 * Math.sin(Hb.p) * 3.6 * dt / REAL_SCALE;
    // v1.5.84: in der Boxenbucht ist die Fahrbahn auf der Boxenseite breiter. VF.boxSeite ist die Boxenseite in
    // Fahrtrichtung (in der Gegenrichtung die andere Seite der Mittellinie).
    const bucht = (VF.boxBucht && o.quer * (VF.boxSeite || VF_BOX_SEITE) > 0) ? VF.boxBucht.b[o.idx] : 0;
    vfBoxDurchfahrt(o, bucht);
    const ab = Math.abs(o.quer) > TRACK_HALF_W * 1.19 + bucht + VF_AUTO.B * 0.3;
    if (ab && !VF.abseits) VF.abseitsSeit = rennZeitJetzt();
    VF.abseits = ab;
    // Randstein (v1.2.62): der erhabene Stein links/rechts der Fahrbahn. Faehrt das Auto mit dem
    // Rand ueber ihn, rattert es und der Controller brummt.
    const q = Math.abs(o.quer);
    const kerbRand = TRACK_HALF_W * 2 * 0.095;
    const kerb = !ab && q > TRACK_HALF_W + bucht - VF_AUTO.B * 0.5 && q < TRACK_HALF_W + bucht + kerbRand;
    VF.kerbJetzt = kerb;
    if (kerb && Math.abs(kmh) > 0.05) {
      if (VF.kerbSeit === undefined || rennZeitJetzt() - VF.kerbSeit > 70) {
        VF.kerbSeit = rennZeitJetzt();
        padRumble(0.3, 0.25, 55, 'kerb', 1);
        if (randsteinKlangAlt) vfRattern(0.10 + Math.min(0.10, Math.abs(kmh) / 40));
      }
    }
    vfRandsteinTon(kerb, q, kmh);   // v1.3.39: dumpfes Rumpeln, je Bild (billig), blendet selbst aus
    if (ab) {
      if (vfAbseitsBremseAn()) st.speedKmh *= Math.exp(-VF_ABSEITS_BREMSE * dt);
      if (rennZeitJetzt() - VF.abseitsSeit > VF_ABSEITS_ZURUECK_MS) vfZuruecksetzen();
    }
    // NPCs: folgen ihrer Spur mit Stufe-1-Tempo und bremsen vor Kurven (vfNpcSteuern).
    // DIAGNOSE (temporaer, Latenz): Zeit fuer NPC-Steuerung + Kollision (vfVerkehr).
    const tNpc0 = performance.now();
    if (VF.npcs && VF.npcBogen) {
      for (const npc of VF.npcs) {
        if (npc.koAus || npc.derbyAus) continue;
        vfNpcSteuern(npc, dt, VF.pts, VF.nrm);
        if (npc.modell && npc.modell.d && npc.modell.d.reifen) vfFederung(npc.feder, npc.ax || 0, npc.ay || 0, dt, npc.modell.d, 0);
      }
    }
    // v1.3.94: Kollision, Schaden und Windschatten (dreckige Luft) mit den NPCs.
    vfVerkehr(dt);
    const npcMs = performance.now() - tNpc0;
    // DIAGNOSE (temporaer, Latenz): wie lange das Malen dauert.
    const tMal0 = performance.now();
    vfMalen();
    const malMs = performance.now() - tMal0;
    // DIAGNOSE (temporaer, Latenz): Zeit fuer das Cockpit (vfHud).
    const tHud0 = performance.now();
    vfHud();
    const hudMs = performance.now() - tHud0;
    // DIAGNOSE (temporaer, Latenz): alle ~2 s die Frame-Aufteilung ausgeben - ist die 500-Hz-Physik
    // (VF_TEIL.dt, hoechstens VF_TEIL.max Teilschritte) der Flaschenhals, oder das WebGL-Malen?
    if (window.MT_DIAG) {
      const D = window.MT_DIAG.vf || (window.MT_DIAG.vf = { n: 0, phys: 0, mal: 0, bild: 0, ort: 0, npc: 0, hud: 0, seit: performance.now() });
      D.n++; D.phys += physMs; D.mal += malMs; D.ort += ortMs; D.npc += npcMs; D.hud += hudMs; D.bild += dt * 1000;
      if (performance.now() - D.seit > 2000) {
        const b = D.bild / D.n;
        // DIAGNOSE (temporaer, Latenz): im Quality-Modus die Teilpaesse aufschluesseln, damit wir
        // sehen, ob Schattenkarte, Umgebungskarte, Bloom oder Regen die Zeit fressen.
        let pass = '';
        if (VF.grafik) {
          const P = window.MT_DIAG.vfP;
          if (P && D.n > 0) {
            pass = ' · Schatten ' + (P.sch / D.n).toFixed(2) + ' · Umgebung ' + (P.umw / D.n).toFixed(2)
                 + ' · Bloom ' + (P.bloom / D.n).toFixed(2) + ' · Regen ' + (P.regen / D.n).toFixed(2);
            P.sch = 0; P.umw = 0; P.bloom = 0; P.regen = 0;
          }
        }
        // DIAGNOSE (temporaer, Latenz): Modell-Last (Teile/Indizes, Spieler+NPCs) und Canvas-Aufloesung,
        // um zu sehen, ob das Ruckeln fill-lastig (grosse Aufloesung) oder vertex-/drawcall-lastig (viele Teile) ist.
        let mTeile = 0, mIdx = 0;
        const zaehle = (M) => { if (!M) return; const z = (arr) => { if (arr) for (const t of arr) { mTeile++; mIdx += (t.indizes || 0); } }; z(M.aufbauTeile); z(M.radTeile); };
        zaehle(VF.modell);
        if (VF.npcs) for (const npc of VF.npcs) zaehle(npc.modell);
        const cv = VF.cv ? (VF.cv.width + 'x' + VF.cv.height) : '?';
        log('Virtuell-Diagnose: ' + Math.round(1000 / b) + ' Bilder/s · Bild ' + b.toFixed(1) + ' ms · Physik '
          + (D.phys / D.n).toFixed(2) + ' ms (' + VF.teilschritte + ' Teilschritte) · Malen ' + (D.mal / D.n).toFixed(2) + ' ms'
          + ' · Ort ' + (D.ort / D.n).toFixed(2) + ' · NPC ' + (D.npc / D.n).toFixed(2) + ' · HUD ' + (D.hud / D.n).toFixed(2)
          + pass + ' · Modell ' + mTeile + ' Teile/' + mIdx + ' Indizes · Canvas ' + cv, 'warn');
        D.n = 0; D.phys = 0; D.mal = 0; D.ort = 0; D.npc = 0; D.hud = 0; D.bild = 0; D.seit = performance.now();
      }
    }
  }
  // Kollision mit NPCs: Schaden, Abbremsen, Rumpeln; und Windschatten (dreckige Luft): dicht hinter
  // einem NPC in der Spur verliert das eigene Auto Grip vorn (wie dirtyAirLevel in 90-ghosts.js).
  // Seit v1.3.95 wertet die Kollision auch Derby (Health) und NPC-Knockout (Leben) aus.
  // ---- KOLLISION NACH ART VON LIBRECORSA (v1.5.11, WIP) --------------------------------------------------
  // BESTELLT: "virtuelles Fahren: Kollisionen wie in LibreCorsa". Bis 1.5.10 war es ein Kasten-Test ohne Wirkung auf
  // die Lage: das Tempo wurde halbiert, die Autos blieben ineinander stecken (Treffer nach Treffer alle 1,5 s).
  // Jetzt: (1) zwei gedrehte Kaesten (SAT) mit den echten Massen, (2) ein Stoss mit Impuls: aus der Annaeherung
  // entlang der Kontaktnormalen folgt eine Tempoaenderung, ein Seitenstoss (dyn.vy) und ein Giermoment (dyn.r) - ein
  // Treffer vorn dreht die Nase weg, einer hinten schiebt sie herum -, (3) Auseinanderschieben: das eigene Auto
  // wird bis zur Beruehrung herausgesetzt (die NPCs fahren auf der Schiene und bleiben, wo sie sind), (4) Schaden
  // nach Aufprallstaerke statt pauschal 10. Der NPC verliert etwas Tempo. Eine Wand gibt es im virtuellen Fahren
  // nicht (neben der Bahn wirkt die Abseitsbremse), dafuer ist hier nichts zu tun.
  const VF_STOSS_E = 0.25;            // Rueckfederung: 0 = klebt, 1 = voll elastisch
  const VF_STOSS_M = 0.6;             // Anteil des Impulses, den das eigene Auto aufnimmt (der NPC auf der Schiene ist "schwerer")
  const VF_KASTEN = 0.92;             // die Kaesten sind etwas kleiner als das gezeichnete Auto (Spiegel, Spoiler)
  // Zwei gleich grosse gedrehte Kaesten (Mittelpunkt, Kurs in Grad, Laenge L, Breite B). Rueckgabe: null oder
  // { pen, nx, ny }: Eindringtiefe und Normale, die vom ZWEITEN Kasten zum ERSTEN zeigt (in Streckeneinheiten).
  function vfKontakt(ax, ay, ah, bx, by, bh, L, B) {
    const hl = L * 0.5 * VF_KASTEN, hb = B * 0.5 * VF_KASTEN;
    const ra = ah * Math.PI / 180, rb = bh * Math.PI / 180;
    const fa = [Math.sin(ra), -Math.cos(ra)], la = [Math.cos(ra), Math.sin(ra)];
    const fb = [Math.sin(rb), -Math.cos(rb)], lb = [Math.cos(rb), Math.sin(rb)];
    const dx = bx - ax, dy = by - ay;
    let best = Infinity, bnx = 0, bny = 0;
    for (const a of [fa, la, fb, lb]) {
      const ext = (f, l) => hl * Math.abs(f[0] * a[0] + f[1] * a[1]) + hb * Math.abs(l[0] * a[0] + l[1] * a[1]);
      const abstand = dx * a[0] + dy * a[1];
      const ueber = ext(fa, la) + ext(fb, lb) - Math.abs(abstand);
      if (ueber <= 0) return null;
      if (ueber < best) { best = ueber; const sg = abstand > 0 ? -1 : 1; bnx = a[0] * sg; bny = a[1] * sg; }
    }
    return { pen: best, nx: bnx, ny: bny };
  }
  // Der Stoss selbst, rein gerechnet: eigenes Auto (Tempo kmhP, Kurs hP), NPC (kmhN, hN), Normale n vom NPC zum
  // eigenen Auto, vorn = Treffer in der vorderen Haelfte. Rueckgabe: neues Tempo, Seitenstoss und Giermoment des
  // eigenen Autos (Einheiten der Fahrdynamik: m/s und rad/s eines GT3) und die Annaeherung vn in m/s.
  function vfStossRechnen(kmhP, hP, kmhN, hN, nx, ny, vorn) {
    const k = 100 * TRACK_UNITS_PER_CM / 3.6, c = REAL_SCALE / (100 * TRACK_UNITS_PER_CM);
    const rp = hP * Math.PI / 180, rn = hN * Math.PI / 180;
    const fp = [Math.sin(rp), -Math.cos(rp)], lp = [Math.cos(rp), Math.sin(rp)];
    const vp = [fp[0] * kmhP * k, fp[1] * kmhP * k], vn2 = [Math.sin(rn) * kmhN * k, -Math.cos(rn) * kmhN * k];
    const vn = -((vp[0] - vn2[0]) * nx + (vp[1] - vn2[1]) * ny);   // > 0: sie nahern sich
    if (!(vn > 0.02 * k)) return { kmhNeu: kmhP, dvy: 0, dr: 0, vnMs: 0 };
    const j = (1 + VF_STOSS_E) * vn * VF_STOSS_M;
    const dvx = nx * j, dvy = ny * j;
    const vfx = vp[0] + dvx, vfy = vp[1] + dvy;
    const dLong = (dvx * fp[0] + dvy * fp[1]), dLat = (dvx * lp[0] + dvy * lp[1]);
    const kmhNeu = (vfx * fp[0] + vfy * fp[1]) / k;
    const seite = vorn ? 1 : -1;
    const dr = Math.max(-0.9, Math.min(0.9, dLat * c * seite * 0.02));
    return { kmhNeu: kmhNeu, dvy: Math.max(-12, Math.min(12, dLat * c)), dr: dr, vnMs: vn * c, dLong: dLong };
  }
  // v1.5.16: der Schalter "Schaden bei Zusammenstoessen" (Optionen) gilt auch virtuell.
  function vfSchadenAn() { return typeof crashSchadenAn !== 'function' || crashSchadenAn(); }
  // v1.5.16 BESTELLT: "virtuelles Fahren: hierfuer sollen die aktuellen Renneinstellungen auch gelten". Renntyp und
  // Limit galten schon; jetzt auch das Startwetter (Regen mit nassem Griff, wie beim echten Fahren binaer), und
  // was virtuell (noch) nicht geht, sagt der Start einmal an, statt es still zu uebergehen.
  // v1.5: der einmalige Wetterwechsel der virtuellen Fahrt (Renneinstellung "Wetter ändert sich").
  function vfWetterEinmal() {
    VF.wxEinmalAt = null;
    if (typeof setWeather !== 'function') return;
    const nass = weather !== 'rain';
    setWeather(nass ? 'rain' : 'dry');
    showHudToast(nass ? t('Es fängt an zu regnen') : t('Es trocknet ab'));
  }
  function vfRennEinstellungen() {
    const fehlt = [];
    const wx = $('race-wx-start') ? $('race-wx-start').value : 'dry';
    VF.wetterVorher = typeof weather !== 'undefined' ? weather : null;
    if (wx === 'rain' && typeof setWeather === 'function') setWeather('rain');
    else if (wx === 'wechsel' && typeof wxWechselPlanen === 'function') {
      // v1.5: wechselhaft auch virtuell. Der Wetter-Takt (wxWechselTick, 70-race.js) laeuft unabhaengig vom
      // Rennen; er braucht nur raceWxStart und den ersten Wechselzeitpunkt. Beginn trocken wie im Rennen.
      raceWxStart = 'wechsel';
      if (typeof setWeather === 'function') setWeather('dry');
      wxWechselPlanen(false);
      VF.wxWechsel = true;
    } else if (wx === 'wechsel') fehlt.push(t('wechselhaftes Wetter'));
    // v1.5: "Wetter ändert sich" (einmaliger Wechsel) virtuell: im mittleren Drittel der Fahrzeit (ohne Zeitlimit
    // in den ersten 5 Minuten), geprueft in vfBild.
    VF.wxEinmalAt = null;
    if (wx !== 'wechsel' && typeof raceWxChange !== 'undefined' && raceWxChange) {
      const total = (VF.limit && (VF.modus === 'endurance' || VF.modus === 'qualifying' || VF.modus === 'practice')) ? VF.limit * 60000 : 5 * 60000;
      VF.wxEinmalAt = rennZeitJetzt() + total * (0.35 + (typeof wxZufall === 'function' ? wxZufall() : Math.random()) * 0.3);
    }
    if ($('race-flying') && $('race-flying').checked) fehlt.push(t('fliegender Start'));
    if ($('race-pit-required') && +$('race-pit-required').value > 0) fehlt.push(t('Pflichtboxenstopps'));
    if ($('race-zev') && $('race-zev').checked) fehlt.push(t('Zufallsevents'));
    if ($('race-auto-gelb') && $('race-auto-gelb').value && $('race-auto-gelb').value !== 'aus') fehlt.push(t('automatische Gelbe Flagge'));
    if (fehlt.length) {
      const text = t('Im virtuellen Fahren nicht verfügbar: {l}').replace('{l}', fehlt.join(', '));
      showHudToast(text);
      if (typeof log === 'function') log(text, 'info');
    }
    return fehlt;
  }
  // v1.5.86 BESTELLT: "Virtuelles-Fahren: Oben Knopf für Wetter einfügen". Schaltet sofort zwischen trocken und Regen
  // (die Regenfront zieht wie gewohnt auf bzw. ab). Ein von Hand gesetztes Wetter gilt: geplante Wechsel ("Wechselhaft",
  // "Wetter ändert sich") fallen fuer diese Fahrt weg. Beim Beenden kommt das Wetter von vorher zurueck
  // (vfRennEinstellungenZurueck). Der Knopf ist hell, solange es regnet.
  function vfWetterKnopf() {
    if (typeof setWeather !== 'function' || typeof weather === 'undefined') return;
    const neu = weather === 'rain' ? 'dry' : 'rain';
    if (VF.wxWechsel) { if (typeof wxWechselAt !== 'undefined') wxWechselAt = null; VF.wxWechsel = false; }
    VF.wxEinmalAt = null;
    setWeather(neu);
    showHudToast(t('Wetter') + ': ' + t(neu === 'rain' ? 'Regen' : 'Trocken'));
  }
  function vfRennEinstellungenZurueck() {
    if (VF.wxWechsel) { if (typeof wxWechselAt !== 'undefined') wxWechselAt = null; VF.wxWechsel = false; }
    VF.wxEinmalAt = null;
    if (VF.wetterVorher && typeof setWeather === 'function' && typeof weather !== 'undefined' && weather !== VF.wetterVorher) setWeather(VF.wetterVorher);
    VF.wetterVorher = null;
  }
  function vfVerkehr(dt) {
    const h = VF.h * Math.PI / 180;
    const fwdX = Math.sin(h), fwdY = -Math.cos(h), latX = Math.cos(h), latY = Math.sin(h);
    let dirty = 0;
    if (VF.kollisionsBis === undefined) VF.kollisionsBis = 0;
    const frist = (VF.modus === 'derby' || VF.modus === 'knockout') ? 600 : 1500;
    const vAbs = Math.abs(physEngine.state.speedKmh || 0);
    for (const npc of (VF.npcs || [])) {
      if (npc.koAus || npc.derbyAus) continue;
      // Bruecke (aus PR 4 von gnen54): einer oben, einer unten durch - kein Kontakt, kein Windschatten.
      if (VF.hoehe && Math.abs(vfHz(npc.x, npc.y, npc.h).z - vfHzSpieler().z) > 1.5) { npc.kontakt = false; continue; }
      const dx = npc.x - VF.x, dy = npc.y - VF.y;
      const long = dx * fwdX + dy * fwdY;
      const lat = dx * latX + dy * latY;
      if (long > 0 && Math.abs(lat) < 6) {
        const d = Math.hypot(dx, dy);
        if (d < 14) dirty = Math.max(dirty, Math.pow(1 - d / 14, 2));
      }
      // Grobe Vorauswahl, dann der Kastentest.
      if (Math.abs(long) > VF_AUTO.L * 1.6 || Math.abs(lat) > VF_AUTO.L * 1.6) { npc.kontakt = false; continue; }
      const k = vfKontakt(VF.x, VF.y, VF.h, npc.x, npc.y, npc.h, VF_AUTO.L, VF_AUTO.B);
      if (!k) { npc.kontakt = false; continue; }
      // Auseinanderschieben: jedes Bild, solange sie sich durchdringen.
      VF.x += k.nx * k.pen; VF.y += k.ny * k.pen;
      const neuerKontakt = !npc.kontakt;
      npc.kontakt = true;
      if (neuerKontakt && physEngine.state.speedKmh > 0) {
        const st = vfStossRechnen(physEngine.state.speedKmh, VF.h, npc.kmh || 0, npc.h, k.nx, k.ny, long > 0);
        if (st.vnMs > 0) {
          physEngine.state.speedKmh = Math.max(0, st.kmhNeu);
          if (!VF.dyn) VF.dyn = { vy: 0, r: 0 };
          VF.dyn.vy += st.dvy; VF.dyn.r += st.dr;
          if (npc.motor && npc.motor.state) npc.motor.state.speedKmh = Math.max(0, (npc.motor.state.speedKmh || 0) * (1 - Math.min(0.3, st.vnMs * 0.012)));
          padRumble(Math.min(1, 0.2 + st.vnMs * 0.03), Math.min(1, 0.2 + st.vnMs * 0.03), 40, 'crash', 1);
          npc.stossMs = st.vnMs;
        }
      }
      if (rennZeitJetzt() >= VF.kollisionsBis && neuerKontakt) {
        VF.kollisionsBis = rennZeitJetzt() + frist;
        const ms = npc.stossMs || 0;
        if (VF.modus === 'derby') vfDerbyTreffer(npc, long, lat, vAbs);
        else if (VF.modus === 'knockout') vfKnockoutTreffer(npc, vAbs);
        else {
          // Schaden nach Aufprallstaerke (m/s eines GT3): leichtes Anstupsen 3 %, harter Aufprall bis 30 %.
          if (typeof damage === 'number' && vfSchadenAn()) damage = Math.min(100, damage + Math.min(30, 3 + ms * 0.9));
          showHudToast(t('Zusammenstoß'));
        }
      }
    }
    if (physEngine.state) physEngine.state.dirtyAir += (dirty - (physEngine.state.dirtyAir || 0)) * Math.min(1, (dt || 0) * 4);
  }
  // Derby: ein Treffer kostet Health. Stirbt ein Gegner, gibt es einen Kill (Ziel = VF.limit).
  function vfDerbyTreffer(npc, long, lat, v) {
    if (v < 0.2) return;                                            // im Stand zaehlt kein Treffer
    const schaden = Math.abs(lat) > Math.abs(long) ? 20 : 10;       // seitlich 20, frontal 10
    npc.derbyHealth = Math.max(0, npc.derbyHealth - schaden);
    VF.derbyHealth = Math.max(0, VF.derbyHealth - Math.ceil(schaden / 2));   // der Angreifer traegt weniger
    if (npc.derbyHealth <= 0 && !npc.derbyAus) {
      npc.derbyAus = true; npc.kmh = 0;
      VF.derbyKills += 1;
      showHudToast(t('Kill') + ' · ' + VF.derbyKills + (VF.limit > 0 ? '/' + VF.limit : ''));
      padRumble(0.6, 0.6, 60, 'kill', 1);
    } else if (VF.derbyHealth <= 0 && !VF.derbyTot) {
      VF.derbyTot = true;
      physEngine.state.speedKmh = 0;
      showHudToast(t('Dein Auto ist aus'));
    }
    vfDerbyPruefen();
  }
  function vfDerbyPruefen() {
    const npcsAlive = (VF.npcs || []).some((n) => !n.derbyAus);
    const playerAlive = !VF.derbyTot && VF.derbyHealth > 0;
    if (VF.limit > 0 && VF.derbyKills >= VF.limit) vfRennenEnde(t('Derby gewonnen') + ': ' + VF.derbyKills + ' ' + t('Kills'));
    else if (!npcsAlive && playerAlive) vfRennenEnde(t('Derby gewonnen: letzter auf der Bahn'));
    else if (!playerAlive && npcsAlive) vfRennenEnde(t('Derby verloren'));
    else if (!playerAlive && !npcsAlive) vfRennenEnde(t('Unentschieden'));
  }
  // NPC-Knockout: ein Treffer kostet dem Gegner ein Leben; der Spieler verliert eines neben der Bahn.
  function vfKnockoutTreffer(npc, v) {
    if (v < 0.2) return;
    npc.koLeben = Math.max(0, npc.koLeben - 1);
    if (npc.koLeben <= 0 && !npc.koAus) {
      npc.koAus = true; npc.kmh = 0;
      showHudToast(t('Gegner ausgeknockt') + ' · ' + t('Gegner übrig') + ': ' + vfKoGeisterZaehlen());
      padRumble(0.5, 0.5, 50, 'ko', 1);
    } else showHudToast(t('Treffer') + ' · ' + npc.koLeben + ' ' + t('Leben'));
    vfKnockoutPruefen();
  }
  function vfKoGeisterZaehlen() { return (VF.npcs || []).filter((n) => !n.koAus).length; }
  function vfKnockoutPruefen() {
    if (!vfKoGeisterZaehlen()) vfRennenEnde(t('Knockout gewonnen: alle Gegner aus'));
    else if (VF.koLeben <= 0) vfRennenEnde(t('Knockout verloren'));
  }
  function vfZuruecksetzen() {
    const p = VF.pts[VF.idx];
    VF.x = p.x; VF.y = p.y; VF.h = p.heading;
    physEngine.state.speedKmh = 0;
    VF.abseits = false;
    VF.dyn = { vy: 0, r: 0 };
    VF.feder = null;
    if (VF.modus === 'knockout') {
      VF.koLeben = Math.max(0, VF.koLeben - 1);
      showHudToast(t('Leben verloren') + ' · ' + VF.koLeben);
      vfKnockoutPruefen();
      return;                 // die "zurueck"-Meldung wuerde die Lebensmeldung sonst ersetzen
    }
    showHudToast(t('Zurück auf die Bahn gesetzt'));
  }
  function vfRennenEnde(ergebnis) {
    if (VF.rennenEnde) return;
    VF.rennenEnde = true;
    const was = ergebnis || (VF.modus === 'laps' ? (Math.min(VF.runden, VF.limit) + ' ' + t('Runden'))
      : VF.modus === 'derby' ? VF.derbyKills + ' ' + t('Kills')
      : VF.modus === 'knockout' ? VF.koLeben + ' ' + t('Leben')
      : (VF.limit + ' min'));
    // Pflicht-Boxendurchfahrt (aus PR 4 von gnen54): je fehlender Durchfahrt die Zeitstrafe aus dem Renn-Setup.
    const fehlt = vfPflichtGilt() ? Math.max(0, vfPflichtBox() - (VF.boxDurch || 0)) : 0;
    const strafe = fehlt ? ' · ' + t('Pflicht-Boxendurchfahrt fehlt') + ': +' + fehlt * (typeof racePitPenaltyS === 'number' ? racePitPenaltyS : 10) + ' s' : '';
    showHudToast((ergebnis || (t('Rennen beendet') + ': ' + was)) + strafe);
    rennZeitTimeout(() => { if (VF.aktiv) virtuellBeenden(); }, 1600);
  }
  // DIAGNOSE (temporaer, Latenz): misst die Quality-Teilpaesse (Schattenkarte, Umgebungskarte,
  // Bloom, Regen) einzeln, damit wir wissen, was auf dem Handy im Quality-Modus wirklich kostet.
  function vfPassZeit(key, fn) {
    if (!window.MT_DIAG) { fn(); return; }   // v1.5.158: ohne Diagnose keine Zeitmessung
    const P = window.MT_DIAG.vfP || (window.MT_DIAG.vfP = { sch: 0, bloom: 0, regen: 0, umw: 0 });
    const t0 = performance.now();
    fn();
    P[key] += performance.now() - t0;
  }
  function vfMalen() {
    const gl = VF.gl, cv = VF.cv;
    if (gl.isContextLost()) return;   // webglcontextlost beendet die Fahrt (virtuellStarten)
    // Handy (Touch): hoechstens 1,25-fache Aufloesung - die Pixelzahl ist auf dem Handy der teuerste Teil.
    // Quality (v1.3.113) darf mehr Pixel: bis 1,5 auf Touch, bis 2 auf Desktop.
    const qPix = VF.grafik && vfWacheStufe() < 2;   // v1.5: die Bildraten-Wache nimmt ab Stufe 2 die Quality-Aufloesung
    const dpr = Math.min(navigator.maxTouchPoints > 0 ? (qPix ? 1.5 : 1.25) : (qPix ? 2 : 1.5), window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h);
    const tzH = vfTz().horizont;
    gl.clearColor(tzH[0], tzH[1], tzH[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Himmel: Vollbild-Quad, Farbverlauf im WELTRAUM (horizontfolgend beim Umsehen). Ganz hinten.
    if (!VF.himmelProg) { VF.himmelProg = vfProgrammHimmel(gl); VF.himmel = vfHimmel(gl); }
    let k = vfKamera(VF.dtBild || 0.016);
    // v1.3.124 Studienmodus: festes Sichtfeld aus Bildschirmgroesse und Sitzabstand.
    if (VF_STUDIE) { const sf = vfStudieFov(); if (sf) k.fov = sf; }
    else k = vfKameraEffekt(k, VF.dtBild || 0.016);
    VF.augeJetzt = k.auge;
    // v1.5.94 (G2): Umgebungskarte fuer den Lack (nur Quality-Autoshader), alle 2 s neu (Wolken, Regen).
    if (VF.tprog && VF.tprog.qual && vfWacheStufe() < 1) {
      vfPassZeit('umw', () => {
        try { vfUmweltMalen(gl, VF.dtBild || 0.016); } catch (e) { VF.umw = null; VF.umwKaputt = true; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
      });
    }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(VF.himmelProg.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, VF.himmel.b);
    gl.enableVertexAttribArray(VF.himmelProg.ap);
    gl.vertexAttribPointer(VF.himmelProg.ap, 3, gl.FLOAT, false, 12, 0);
    // Kamera-Basis fuer die Weltraum-Blickrichtung (v1.3.124), als Zahlen statt Arrays je Bild.
    {
      const ob = k.oben || VF_OBEN;
      let fx = k.ziel[0] - k.auge[0], fy = k.ziel[1] - k.auge[1], fz = k.ziel[2] - k.auge[2];
      let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
      let rx = fy * ob[2] - fz * ob[1], ry = fz * ob[0] - fx * ob[2], rz = fx * ob[1] - fy * ob[0];
      l = Math.hypot(rx, ry, rz) || 1; rx /= l; ry /= l; rz /= l;
      const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
      const th = Math.tan((k.fov * Math.PI / 180) / 2);
      gl.uniform3f(VF.himmelProg.right, rx, ry, rz);
      { const z = vfTz(); gl.uniform3f(VF.himmelProg.horizont, z.horizont[0], z.horizont[1], z.horizont[2]); gl.uniform3f(VF.himmelProg.zenit, z.zenit[0], z.zenit[1], z.zenit[2]); }
      gl.uniform3f(VF.himmelProg.up, ux, uy, uz);
      gl.uniform3f(VF.himmelProg.fwd, fx, fy, fz);
      gl.uniform2f(VF.himmelProg.halb, th * w / Math.max(1, h), th);
      // v1.5: Wolken (Bewoelkung mittel, im Regen dichter und grauer), Zeit fuer das Ziehen.
      gl.uniform1f(VF.himmelProg.wolken, VF_WOLKEN);
      gl.uniform1f(VF.himmelProg.zeit, (performance.now() / 1000) % 10000);
      gl.uniform1f(VF.himmelProg.regen, vfRegenStaerke());
      { const d = VF.dunstF || vfTz().horizont; gl.uniform3f(VF.himmelProg.dunst, d[0], d[1], d[2]); }
      gl.uniform1f(VF.himmelProg.umwelt, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, VF.himmel.n);
    gl.disableVertexAttribArray(VF.himmelProg.ap);
    gl.enable(gl.DEPTH_TEST);
    const blick = vfBlick(k.auge, k.ziel, k.oben || VF_OBEN);
    const pv = vfMal(vfPerspektive(k.fov * Math.PI / 180, w / Math.max(1, h), k.nah, k.fern || 1300), blick);
    // v1.3.113 Quality: echte Schatten aus der Schattenkarte (Spielerauto + NPCs), vor dem Boden.
    // v1.5.140: Die Schattenkarte wird wieder jedes Bild gerendert. (1.5.139 rendert sie nur jedes 2. Bild,
    // das liess den Schatten 1 Bild "nachziehen" -> Flackern bei schnellen Bewegungen.) Die GPU-Last wird
    // stattdessen ueber die Aufloesung geregelt: vfSchattenBauen nutzt 512 auf Touch, 1024 auf Desktop (v1.5.141).
    if (VF.grafik && VF.schatte && VF.schatteProg && vfWacheStufe() < 1) {
      vfPassZeit('sch', () => {
        VF.schM = vfSchattenMatrix([VF.x, 0, VF.y]);
        vfSchattenPass(gl);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
      });
    }
    // v1.3.39: Boden, Fahrbahn und Randsteine mit Texturen (vorher Eckfarben in VF.bahn).
    vfFlaechenMalen(gl, pv, k.auge);
    gl.useProgram(VF.prog);
    if (!VF.loc) VF.loc = { m: gl.getUniformLocation(VF.prog, 'm'), w: gl.getUniformLocation(VF.prog, 'w'), nebel: gl.getUniformLocation(VF.prog, 'nebel'), alf: gl.getUniformLocation(VF.prog, 'alf'), sonne: gl.getUniformLocation(VF.prog, 'sonne'),
                            dunst: gl.getUniformLocation(VF.prog, 'dunst'), aug: gl.getUniformLocation(VF.prog, 'aug'),
                            p: gl.getAttribLocation(VF.prog, 'p'), c: gl.getAttribLocation(VF.prog, 'c'), pv: new Float32Array(16), w16: new Float32Array(16) };
    const L = VF.loc;
    for (let i = 0; i < 16; i++) L.pv[i] = pv[i];
    gl.uniformMatrix4fv(L.m, false, L.pv);
    vfTzSetzen(gl, L);
    gl.uniform1f(L.alf, 1.0);
    const zeichne = (pu, welt) => {
      for (let i = 0; i < 16; i++) L.w16[i] = welt[i];
      gl.uniformMatrix4fv(L.w, false, L.w16);
      gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
      gl.enableVertexAttribArray(L.p); gl.enableVertexAttribArray(L.c);
      gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(L.c, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    };
    if (VF.boxStriche) {
      zeichne(VF.boxStriche, VF_EINS);
      gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
    }
    // v1.5: Baeume (nur auf Rasen), vor den Autos.
    if (VF.weh && VF.weh.prog) vfWehenMalen(gl, pv);
    else if (VF.baeume) {
      zeichne(VF.baeume, VF_EINS);
      gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
    }
    const geistDa = !!(VF.geist && VF.geist.aktiv && VF.geist.an);
    // Ohne Modell (Kasten gewaehlt oder Modell noch nicht geladen) bleibt der blaue Kasten als Geist.
    if (geistDa && !(VF.modell && VF.tprog)) {
      if (!VF.geistAuto) VF.geistAuto = vfAutoBauen(gl, [0.45, 0.75, 1.0]);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(L.alf, 0.45);
      zeichne(VF.geistAuto, vfLage(VF.geist.x, VF.geist.y, VF.geist.h));
      gl.uniform1f(L.alf, 1.0);
      gl.disable(gl.BLEND);
      gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
    }
    if (VF.modell && VF.tprog) vfModellMalen(gl, pv, blick, k.auge);
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
          !!(npc.motor && npc.motor.outputs && npc.motor.outputs.lights && npc.motor.outputs.lights.brake), 1, 0, k.auge);
      }
    }
    // v1.5.84: der Geist als durchscheinende Kopie des gewaehlten Autos, nach allen undurchsichtigen Autos.
    if (geistDa && VF.modell && VF.tprog) vfGeistMalen(gl, pv, blick, k.auge);
    // v1.5 (Quality): Bloom auf das fertige Bild, vor dem Regen. Scheitert er einmal, bleibt er fuer die Fahrt aus.
    if (vfBloomAn()) vfPassZeit('bloom', () => { try { vfBloomMalen(gl, w, h); } catch (e) { VF.bloomKaputt = true; VF.bloom = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); log('Virtuell: Bloom aus (' + e.message + ').', 'info'); } });
    // v1.5.19: Regen zuletzt (durchsichtig, ohne Tiefe zu schreiben).
    vfPassZeit('regen', () => { try { vfRegenMalen(gl, pv, k.auge, VF.dtBild || 0.016); } catch (e) { VF.regen = null; } });
    try { vfSpiegelMalen(gl, w, h); } catch (e) { vfSpiegelRahmen(null); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, w, h); }
  }
  // ---- RUECKSPIEGEL (aus PR 4 von gnen54, Idee von Luke) -----------------------------------------------
  // Nur in der Kamera "Motorhaube" und nur, wenn in der Garage eingeschaltet (jeder Spiegel zeichnet die Szene ein
  // weiteres Mal). Alle Autos ausser dem offenen Spider: ein Innenspiegel als SCHMALER Streifen ganz oben am
  // Bildrand, mittig (BESTELLT: "nur ein schmaler Streifen ganz oben"). Der Spider behaelt seine zwei kleinen
  // Aussenspiegel unten links und rechts. Je Spiegel ein Bildausschnitt (Viewport + Scissor), die Szene von der
  // Spiegelstelle nach hinten, waagerecht gespiegelt (Projektion mit x mal -1). Der Rahmen ist HTML ueber dem Bild.
  const VF_SPIEGEL_STORE = 'omegasim-vf-spiegel';
  function vfSpiegelAn() { try { return localStorage.getItem(VF_SPIEGEL_STORE) === 'an'; } catch (e) { return false; } }
  const VF_SPIEGEL_WINKEL = 12;     // Aussenspiegel: Grad nach aussen gedreht
  const VF_SPIEGEL_FOV = 26;        // Aussenspiegel: senkrechter Bildwinkel
  const VF_INNENSPIEGEL_FOVH = 46;  // Innenspiegel: waagerechter Bildwinkel (der senkrechte folgt aus dem Streifen)
  // Lage der Spiegel in Bildpunkten der Leinwand (x, y von unten links, Breite, Hoehe), rein fuer den Selbsttest.
  function vfSpiegelRechtecke(w, h, auto, dpr) {
    if (auto !== 'spider') {
      const sw = Math.round(Math.min(w * 0.36, h * 1.1));
      const sh = Math.round(Math.max(16 * (dpr || 1), Math.min(h * 0.085, sw * 0.18)));
      return [{ art: 'innen', q: [Math.round((w - sw) / 2), h - sh, sw, sh] }];
    }
    const sw = Math.round(Math.min(w * 0.17, h * 0.34) * 0.8), sh = Math.round(sw * 0.6);
    const y0 = Math.round(h * 0.15), rand = Math.max(10, Math.round(w * 0.018));
    return [{ art: 'links', q: [rand, y0, sw, sh], sg: 1 }, { art: 'rechts', q: [w - rand - sw, y0, sw, sh], sg: -1 }];
  }
  // Spiegel und Rahmen erst ab deutlichem Umsehen ausblenden (15 Grad): schon 2 Grad (ein Stick, der nicht ganz in
  // die Mitte zurueckfaellt) liessen sie sonst verschwinden (aus PR 4 von gnen54).
  function vfKameraWeitGedreht() { const D = vfDreh(), w = 15 * Math.PI / 180; return Math.abs(D.g) > w || Math.abs(D.n) > w; }
  function vfSpiegelSichtbar() {
    return vfSpiegelAn() && vfKameraId() === 'haube' && !!(VF.modell && VF.tprog) && !VF.laedt && !vfKameraWeitGedreht();
  }
  // Rahmen als HTML (je Spiegel ein div.vf-spiegel), null = alle weg.
  function vfSpiegelRahmen(liste) {
    const da = VF.spiegelRahmen && VF.spiegelRahmen.every((e) => e.isConnected) ? VF.spiegelRahmen : null;
    if (!liste) { if (VF.spiegelRahmen) VF.spiegelRahmen.forEach((e) => e.remove()); VF.spiegelRahmen = null; return; }
    let r = da && da.length === liste.length ? da : null;
    if (!r) {
      if (VF.spiegelRahmen) VF.spiegelRahmen.forEach((e) => e.remove());
      r = VF.spiegelRahmen = liste.map((s) => {
        const e = document.createElement('div');
        e.className = 'vf-spiegel vf-spiegel-' + s.art;
        e.setAttribute('aria-hidden', 'true');
        (VF.cv.parentNode || document.body).insertBefore(e, VF.cv.nextSibling);
        return e;
      });
    }
    const dpr = VF.cv.width / Math.max(1, VF.cv.clientWidth);
    liste.forEach((s, i) => {
      const q = s.q, e = r[i];
      const l = VF.cv.offsetLeft + q[0] / dpr, o = VF.cv.offsetTop + (VF.cv.height - q[1] - q[3]) / dpr;
      const m = [l, o, q[2] / dpr, q[3] / dpr].map((x) => x.toFixed(1) + 'px').join(' ');
      if (e.dataset.mass !== m) {
        e.dataset.mass = m;
        e.style.left = l.toFixed(1) + 'px'; e.style.top = o.toFixed(1) + 'px';
        e.style.width = (q[2] / dpr).toFixed(1) + 'px'; e.style.height = (q[3] / dpr).toFixed(1) + 'px';
      }
    });
  }
  function vfSpiegelMalen(gl, w, h) {
    if (!vfSpiegelSichtbar()) { if (VF.spiegelRahmen) vfSpiegelRahmen(null); return; }
    const d = VF.modell.d, s = VF_AUTO.L / d.laenge, Hz = vfHzSpieler();
    const r = VF.h * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r), lx = fz, lz = -fx;
    const dpr = VF.cv.width / Math.max(1, VF.cv.clientWidth);
    const auto = vfAutoWahl(), liste = vfSpiegelRechtecke(w, h, auto, dpr);
    const hb = VF.modell.meta && VF.modell.meta.haube, sp = VF.modell.meta && VF.modell.meta.spiegel;
    const tzH = vfTz().horizont;
    gl.enable(gl.SCISSOR_TEST);
    try {
      for (const S of liste) {
        const q = S.q;
        gl.viewport(q[0], q[1], q[2], q[3]); gl.scissor(q[0], q[1], q[2], q[3]);
        gl.clearColor(tzH[0], tzH[1], tzH[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        let auge, ziel, pr;
        const asp = q[2] / Math.max(1, q[3]);
        if (S.art === 'innen') {
          // Blick vom Dach am Heck nach hinten; das eigene Auto wird nicht gemalt (saesse sonst als Dach im Bild).
          const hinten = (d.laenge / 2 + 0.05) * s, hoch = ((hb ? hb.hoch : 1.0) + 0.05) * s;
          auge = [VF.x - fx * hinten, hoch + Hz.z, VF.y - fz * hinten];
          ziel = [auge[0] - fx * 30, hoch + Hz.z - 0.5 - Math.tan(Hz.p) * 30, auge[2] - fz * 30];
          const fovy = 2 * Math.atan(Math.tan(VF_INNENSPIEGEL_FOVH * Math.PI / 360) / asp);
          pr = vfPerspektive(fovy, asp, 0.3, 900);
        } else {
          // Aussenspiegel (Spider): an der Spiegelstelle des Modells (auto.json "spiegel"), sonst aus der Haube.
          const vor = (sp && typeof sp.vor === 'number' ? sp.vor : (hb ? hb.vor : 0.75) - 0.25) * s;
          const hoch = (sp && typeof sp.hoch === 'number' ? sp.hoch : (hb ? hb.hoch : 1.0) - 0.12) * s;
          const seite = (sp && typeof sp.seite === 'number' ? sp.seite : d.breite / 2 + 0.06) * s;
          const wi = VF_SPIEGEL_WINKEL * Math.PI / 180, sg = S.sg;
          auge = [VF.x + fx * vor + lx * seite * sg, hoch + Hz.z, VF.y + fz * vor + lz * seite * sg];
          const bx = -fx * Math.cos(wi) + lx * sg * Math.sin(wi), bz = -fz * Math.cos(wi) + lz * sg * Math.sin(wi);
          ziel = [auge[0] + bx * 30, hoch + Hz.z - 0.6 - Math.tan(Hz.p) * 30, auge[2] + bz * 30];
          pr = vfPerspektive(VF_SPIEGEL_FOV * Math.PI / 180, asp, 0.3, 900);
        }
        for (let k = 0; k < 4; k++) pr[k * 4] = -pr[k * 4];          // waagerecht spiegeln
        const blick = vfBlick(auge, ziel, VF_OBEN);
        const pv = vfMal(pr, blick);
        vfFlaechenMalen(gl, pv, auge);
        if (S.art !== 'innen') vfModellMalen(gl, pv, blick, auge);
        for (const npc of (VF.npcs || [])) {
          if (!npc.modell || npc.koAus || npc.derbyAus) continue;
          vfModellZeichnen(gl, pv, blick, npc.modell, VF.tprog, npc.x, npc.y, npc.h, npc.feder, npc.lenkWinkel, npc.raddreh, VF.radModell, true,
            !!(npc.motor && npc.motor.outputs && npc.motor.outputs.lights && npc.motor.outputs.lights.brake), 1, 0, auge);
        }
      }
    } finally {
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, w, h);
    }
    vfSpiegelRahmen(liste);
  }
  // ---- BLOOM (v1.5, Quality, Plan Paket 4) -------------------------------------------------------------------
  // Helles (Scheinwerfer, Glanzlichter, Ruecklichter) strahlt leicht ueber. Die Szene bleibt im Bildschirm-Puffer
  // (mit Kantenglaettung, die ein eigener Framebuffer in WebGL1 nicht haette); kopiert wird das fertige Bild
  // (copyTexSubImage2D), daraus mit viertel Aufloesung nur das fast Weisse (Luminanz ueber VF_BLOOM.schwelle, so
  // bleiben Himmel und heller Boden aussen vor), zweimal weichgezeichnet und additiv daraufgelegt. Vor dem Regen.
  // Die Bildraten-Wache nimmt ihn ab Stufe 1 weg (zusammen mit den Schatten).
  const VF_BLOOM = { schwelle: 0.86, staerke: 0.65, teiler: 4 };
  function vfBloomProgramm(gl, frag) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER, 'attribute vec2 a; varying vec2 vuv; void main(){ vuv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 vuv; uniform sampler2D tx;' + frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    ['tx', 'px', 'schwelle', 'dir', 'staerke'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, u, a: gl.getAttribLocation(p, 'a') };
  }
  function vfBloomTextur(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function vfBloomZiel(gl, w, h) {
    const tex = vfBloomTextur(gl, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('Bloom-Framebuffer unvollstaendig');
    return { tex, fbo };
  }
  function vfBloomBauen(gl) {
    const B = {
      hell: vfBloomProgramm(gl, 'uniform vec2 px; uniform float schwelle;'
        + 'void main(){ vec3 c = (texture2D(tx, vuv - px).rgb + texture2D(tx, vuv + px).rgb + texture2D(tx, vuv + vec2(px.x, -px.y)).rgb + texture2D(tx, vuv + vec2(-px.x, px.y)).rgb) * 0.25;'
        + ' float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(c * max(l - schwelle, 0.0) / max(l, 0.001) / (1.0 - schwelle), 1.0); }'),
      weich: vfBloomProgramm(gl, 'uniform vec2 dir;'
        + 'void main(){ vec3 c = texture2D(tx, vuv).rgb * 0.2270;'
        + ' c += (texture2D(tx, vuv + dir).rgb + texture2D(tx, vuv - dir).rgb) * 0.1946;'
        + ' c += (texture2D(tx, vuv + dir * 2.0).rgb + texture2D(tx, vuv - dir * 2.0).rgb) * 0.1216;'
        + ' c += (texture2D(tx, vuv + dir * 3.0).rgb + texture2D(tx, vuv - dir * 3.0).rgb) * 0.0541;'
        + ' c += (texture2D(tx, vuv + dir * 4.0).rgb + texture2D(tx, vuv - dir * 4.0).rgb) * 0.0162;'
        + ' gl_FragColor = vec4(c, 1.0); }'),
      misch: vfBloomProgramm(gl, 'uniform float staerke; void main(){ gl_FragColor = vec4(texture2D(tx, vuv).rgb * staerke, 1.0); }'),
      quad: gl.createBuffer(), w: 0, h: 0,
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, B.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    return B;
  }
  function vfBloomGroesse(gl, B, w, h) {
    if (B.w === w && B.h === h) return;
    [B.szene, B.a && B.a.tex, B.b && B.b.tex].forEach((x) => { if (x) gl.deleteTexture(x); });
    [B.a && B.a.fbo, B.b && B.b.fbo].forEach((x) => { if (x) gl.deleteFramebuffer(x); });
    B.w = w; B.h = h;
    B.sw = Math.max(1, Math.round(w / VF_BLOOM.teiler)); B.sh = Math.max(1, Math.round(h / VF_BLOOM.teiler));
    B.szene = vfBloomTextur(gl, w, h);
    B.a = vfBloomZiel(gl, B.sw, B.sh);
    B.b = vfBloomZiel(gl, B.sw, B.sh);
  }
  function vfBloomZug(gl, B, P, quelle, ziel, w, h, setze) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, ziel ? ziel.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, quelle);
    gl.uniform1i(P.u.tx, 0);
    setze(P.u);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.quad);
    gl.enableVertexAttribArray(P.a);
    gl.vertexAttribPointer(P.a, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(P.a);
  }
  // Auf den Bildschirm-Puffer (w x h, bereits fertig gezeichnet).
  function vfBloomMalen(gl, w, h) {
    if (!VF.bloom) VF.bloom = vfBloomBauen(gl);
    const B = VF.bloom;
    vfBloomGroesse(gl, B, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, B.szene);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    vfBloomZug(gl, B, B.hell, B.szene, B.a, B.sw, B.sh, (u) => { gl.uniform2f(u.px, 1 / w, 1 / h); gl.uniform1f(u.schwelle, VF_BLOOM.schwelle); });
    for (const breit of [1, 2]) {
      vfBloomZug(gl, B, B.weich, B.a.tex, B.b, B.sw, B.sh, (u) => gl.uniform2f(u.dir, breit / B.sw, 0));
      vfBloomZug(gl, B, B.weich, B.b.tex, B.a, B.sw, B.sh, (u) => gl.uniform2f(u.dir, 0, breit / B.sh));
    }
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    vfBloomZug(gl, B, B.misch, B.a.tex, null, w, h, (u) => gl.uniform1f(u.staerke, VF_BLOOM.staerke));
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    gl.viewport(0, 0, w, h);
  }
  function vfBloomAn() { return !!(VF.grafik && vfWacheStufe() < 1 && !VF.bloomKaputt); }

  // ---- 3D-REGEN (v1.5.19, WIP) -------------------------------------------------------------------------
  // BESTELLT: "mache 3D-Regeneffekte (aktuell ist der Regen nicht schoen)". Regen kommt aus dem Wetter des Rennens
  // (wxRainLevel, dieselbe Front wie beim echten Fahren). Die Tropfen sind kurze Striche IM RAUM: ein Kasten um die
  // Kamera, in dem jeder Tropfen faellt und vom Fahrtwind schraeg gezogen wird; verlaesst er den Kasten, kommt er auf
  // der anderen Seite wieder herein (mod im Vertex-Shader). Die CPU rechnet je Bild nichts ausser drei Zahlen; die
  // Zahl der gezeichneten Tropfen folgt der Regenstaerke (Performance 700, Quality 2000). Dazu ein grauer Schleier
  // ueber dem Bild (Vollbild-Viereck), der mit der Staerke dichter wird.
  const VF_REGEN_N = { perf: 700, qual: 2000 };
  const VF_REGEN_KASTEN = [70, 34, 70];       // Streckeneinheiten (1 Einheit ~ 0,48 m eines GT3)
  const VF_REGEN_FALL = 26;                   // Einheiten je s (~12 m/s, Regentropfen)
  function vfRegenBauen(gl, n) {
    const p = gl.createProgram();
    gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER,
      'attribute vec4 a; uniform mat4 m; uniform vec3 auge; uniform vec3 kasten; uniform vec3 fall; uniform vec3 strich; uniform float t;'
      + 'varying float va;'
      + 'void main(){ vec3 lo = auge - kasten * 0.5; vec3 q = a.xyz * kasten + fall * t;'
      + ' q = mod(q - lo, kasten) + lo; q -= strich * a.w;'
      + ' gl_Position = m * vec4(q, 1.0); va = 1.0 - a.w * 0.85; }'));
    gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER,
      'precision mediump float; varying float va; uniform float staerke;'
      + 'void main(){ gl_FragColor = vec4(0.82, 0.87, 0.94, 0.62 * va * staerke); }'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const d = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      d.set([x, y, z, 0, x, y, z, 1], i * 8);
    }
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    const u = {};
    ['m', 'auge', 'kasten', 'fall', 'strich', 't', 'staerke'].forEach((k) => { u[k] = gl.getUniformLocation(p, k); });
    return { p, b, n, u, a: gl.getAttribLocation(p, 'a'), m16: new Float32Array(16), t: 0 };
  }
  function vfRegenStaerke() {
    try { return typeof wxRainLevel === 'function' ? Math.max(0, Math.min(1, wxRainLevel())) : 0; } catch (e) { return 0; }
  }
  function vfRegenMalen(gl, pv, auge, dt) {
    const st = vfRegenStaerke();
    if (st < 0.02) return;
    vfRegenSchleier(gl, st);        // erst der Schleier, dann die Tropfen darueber (sonst verschwinden sie im Grau)
    if (!VF.regen) VF.regen = vfRegenBauen(gl, VF.grafik && vfWacheStufe() < 2 ? VF_REGEN_N.qual : VF_REGEN_N.perf);
    const R = VF.regen;
    R.t = (R.t + Math.min(0.1, dt || 0.016)) % 1000;
    // Fahrtwind: die Tropfen bewegen sich relativ zum Auto rueckwaerts; der Strich zeigt die Bewegung im Bild.
    const kmh = Math.max(0, (physEngine && physEngine.state && physEngine.state.speedKmh) || 0);
    const vE = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM;
    const hr = (VF.h || 0) * Math.PI / 180;
    const vx = Math.sin(hr) * vE, vz = -Math.cos(hr) * vE;
    const fall = [0, -VF_REGEN_FALL, 0];
    // Strich: Weg in 0,05 s relativ zur Kamera (Fall minus eigene Bewegung), mindestens 0,8 Einheiten lang.
    let sx = (fall[0] - vx) * 0.05, sy = fall[1] * 0.05, sz = (fall[2] - vz) * 0.05;
    const sl = Math.hypot(sx, sy, sz) || 1, ml = Math.max(0.8, sl);
    sx *= ml / sl; sy *= ml / sl; sz *= ml / sl;
    gl.useProgram(R.p);
    for (let i = 0; i < 16; i++) R.m16[i] = pv[i];
    gl.uniformMatrix4fv(R.u.m, false, R.m16);
    gl.uniform3f(R.u.auge, auge[0], auge[1], auge[2]);
    gl.uniform3f(R.u.kasten, VF_REGEN_KASTEN[0], VF_REGEN_KASTEN[1], VF_REGEN_KASTEN[2]);
    gl.uniform3f(R.u.fall, fall[0], fall[1], fall[2]);
    gl.uniform3f(R.u.strich, sx, sy, sz);
    gl.uniform1f(R.u.t, R.t);
    gl.uniform1f(R.u.staerke, 0.4 + 0.6 * st);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.b);
    gl.enableVertexAttribArray(R.a);
    gl.vertexAttribPointer(R.a, 4, gl.FLOAT, false, 16, 0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, Math.max(2, Math.round(R.n * st) * 2));
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(R.a);
  }
  // Grauer Schleier ueber dem Bild: ein Vollbild-Viereck im selben Kontext (ein DOM-Schleier ueber dem Canvas war
  // im Bild nicht zu sehen). Gemischt wird nur die Farbe (blendFuncSeparate, Ziel-Alpha bleibt 1): mit dem
  // einfachen blendFunc wurde der Canvas halb durchsichtig, und der helle Seitenhintergrund wusch das Bild aus. Zwei Dreiecke, eine Farbe, Deckkraft mit der Regenstaerke.
  function vfRegenSchleier(gl, st) {
    if (st < 0.02) return;
    if (!VF.schleier) {
      const p = gl.createProgram();
      gl.attachShader(p, vfShader(gl, gl.VERTEX_SHADER, 'attribute vec2 a; varying float vy; void main(){ vy = a.y; gl_Position = vec4(a, 0.0, 1.0); }'));
      gl.attachShader(p, vfShader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; varying float vy; uniform float st;'
        + 'void main(){ gl_FragColor = vec4(mix(vec3(0.16, 0.19, 0.24), vec3(0.30, 0.35, 0.42), vy * 0.5 + 0.5), 0.38 * st); }'));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      VF.schleier = { p, b, a: gl.getAttribLocation(p, 'a'), st: gl.getUniformLocation(p, 'st') };
    }
    const S = VF.schleier;
    gl.useProgram(S.p);
    gl.uniform1f(S.st, st);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.b);
    gl.enableVertexAttribArray(S.a);
    gl.vertexAttribPointer(S.a, 2, gl.FLOAT, false, 8, 0);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    gl.disableVertexAttribArray(S.a);
  }
  // ---- Kamera (v1.1.11) --------------------------------------------------------------------
  // BESTELLT: "Wenn ich den rechten Stick reindruecke im virtuellen Fahren, aendere die Kamera zu
  // Motorhaube oder nahe Verfolgerkamera." R3 (bzw. die Lichthupen-Belegung) oder C schaltet weiter:
  // Verfolger -> nah -> Motorhaube -> Verfolger. Nachgefuehrt nach der ZEIT (nicht je Bild): auf einem
  // langsamen Handy lief die Kamera vorher bei weniger Bildern spuerbar hinterher.
  const VF_KAMERAS = [{ id: 'verfolger', name: 'Verfolgerkamera' }, { id: 'nah', name: 'Nahe Verfolgerkamera' }, { id: 'haube', name: 'Motorhaube' },
                      { id: 'oben', name: 'Von oben (Start/Ziel)' },
                      { id: 'fahrer', name: 'Fahrer am Rand', wip: true },
                      { id: 'tv', name: 'TV-Kamera', wip: true }];
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
  // ZWEI ARTEN: Verfolger und nah kreisen UM das Auto (waagrecht ganz herum, senkrecht
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
  function vfDrehArt(id) { return id === 'haube' || id === 'fahrer' || id === 'tv' ? 'umsehen' : (id === 'oben' ? 'oben' : 'kreisen'); }
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
  // SICHTFELD: seit 1.3.110 34 Grad senkrecht (vorher 46, bei 2:1 im Querformat gut 80 Grad waagrecht).
  // Ist das Auto weit weg, zoomt es sanft bis 21 Grad (vorher 28): ein 10-cm-Auto in 4 m Abstand waere
  // sonst nur ein paar Pixel; der Mensch "schaut genauer hin". Gut 1,6-fach, mehr wirkt wie ein Fernglas.
  // NAH/FERN: das naechste sichtbare Ding ist mehr als 90 Einheiten entfernt (Boden unter dem Blick,
  // Auto am Rand), also Nahebene 8 und Fernebene 1300 (seit 1.3.124, vorher 3000; der Nebel ist bei
  // 1150 voll): Verhaeltnis 162, die Tiefe reicht auch fuer Randstein (0,09 hoch) gegen Fahrbahn.
  const VF_FAHRER_AUGE_CM = 100, VF_FAHRER_ABSTAND_CM = 75, VF_FAHRER_TAU = 0.25, VF_FAHRER_ZOOM_TAU = 0.8;
  const VF_FAHRER_FOV = 34, VF_FAHRER_FOV_FERN = 21;
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
    if (!F.k) F.k = { auge: [o.x, o.h, o.y], ziel: [0, 0, 0], fov: VF_FAHRER_FOV, nah: 8, fern: 1300 };
    const dx = x - o.x, dz = y - o.y, dy = VF_AUTO.H * 0.5 - o.h, waag = Math.hypot(dx, dz);
    const gier = Math.atan2(dz, dx), nick = Math.atan2(dy, Math.max(1e-6, waag));
    const dist = Math.hypot(waag, dy);
    // v1.3.124 Studienmodus: der Zoom der Fahrer-Kamera laesst sich abschalten (fixes Sichtfeld).
    const fovZiel = VF_STUDIE_ZOOM_AUS ? VF_FAHRER_FOV : VF_FAHRER_FOV - (VF_FAHRER_FOV - VF_FAHRER_FOV_FERN) * Math.max(0, Math.min(1, (dist - 150) / 300));
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
  // ---- v1.5 (WIP, Plan Paket 4 "TV-Kamera"): Kameras am Streckenrand, geschnitten wie im Fernsehen ----
  // Posten alle VF_TV_ABSTAND Teile aussen neben der Bahn (frei von der Strecke, nicht im Innenfeld), hoeher
  // als der Fahrer am Rand. Gezeigt wird der naechste Posten; gewechselt (harter Schnitt) erst, wenn ein
  // anderer um VF_TV_HYST naeher ist und der aktuelle mindestens VF_TV_MIN_S lief. Jeder Posten folgt dem
  // Auto wie die Fahrer-Kamera (vfFahrerKamera: weich schwenken, mit dem Abstand zoomen).
  const VF_TV_ABSTAND = 3, VF_TV_HYST = 0.8, VF_TV_MIN_S = 1.5, VF_TV_HOEHE = 1.8;
  function vfTvPosten(pts, nrm, tiles) {
    const n = pts.length, rand = TRACK_HALF_W + TRACK_KERB_W, abst = VF_FAHRER_ABSTAND_CM * TRACK_UNITS_PER_CM * 1.5;
    const innen = (x, y) => {
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    const frei = (x, y) => { let d = Infinity; for (const q of pts) d = Math.min(d, Math.hypot(q.x - x, q.y - y)); return d - rand; };
    const schritt = Math.max(1, Math.round(TRACK_SAMPLES_PER_TILE * VF_TV_ABSTAND));
    const out = [];
    for (let i = 0; i < n; i += schritt) {
      let best = null;
      for (const sg of [1, -1]) {
        const x = pts[i].x + nrm[i].x * sg * (rand + abst), y = pts[i].y + nrm[i].y * sg * (rand + abst);
        const wert = (frei(x, y) >= abst * 0.9 ? 0 : 1000) + (innen(x, y) ? 100 : 0);
        if (!best || wert < best.wert) best = { x, y, wert };
      }
      if (best.wert < 1000) out.push({ ort: { x: best.x, y: best.y, h: VF_FAHRER_AUGE_CM * TRACK_UNITS_PER_CM * VF_TV_HOEHE, idx: i }, z: {}, k: null });
    }
    return out;
  }
  // Welcher Posten (rein, fuer den Selbsttest): T = { posten, aktiv, seit }, Auto bei (x, y), jetzt in s.
  function vfTvWahl(T, x, y, jetzt) {
    let best = -1, bd = Infinity;
    T.posten.forEach((P, i) => { const d = Math.hypot(P.ort.x - x, P.ort.y - y); if (d < bd) { bd = d; best = i; } });
    if (T.aktiv < 0) { T.aktiv = best; T.seit = jetzt; return true; }
    if (best === T.aktiv) return false;
    const A = T.posten[T.aktiv], da = Math.hypot(A.ort.x - x, A.ort.y - y);
    if (bd < da * VF_TV_HYST && jetzt - T.seit >= VF_TV_MIN_S) {
      T.aktiv = best; T.seit = jetzt;
      T.posten[best].z = {};     // harter Schnitt: der neue Posten schaut sofort aufs Auto
      return true;
    }
    return false;
  }
  function vfTvKamera(T, x, y, dt) {
    T.uhr = (T.uhr || 0) + Math.max(0, dt || 0);
    vfTvWahl(T, x, y, T.uhr);
    return vfFahrerKamera(T.posten[T.aktiv], x, y, dt);
  }
  function vfKamera(dt) {
    const r = VF.h * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r);
    const id = vfKameraId();
    // Rechter Stick / T-F-G-H: die Drehung laeuft nach der Zeit (in der Pause ist dt 0).
    const art = vfDrehArt(id), D = vfDreh(), ein = vfDrehEingabe();
    vfDrehSchritt(D, ein[0], ein[1], dt, vfDrehGrenzen(art));
    const k0 = vfKameraBasis(id, fx, fz, dt, art, D);
    const k = art === 'kreisen' ? k0 : vfDrehAnwenden(k0, art, D, VF.x, 0, VF.y);
    // Bruecke (aus PR 4 von gnen54): die Kamera faehrt mit hoch; im Auto (Haube, Fahrer) neigt sich der Blick mit
    // der Rampe.
    const H = vfHzSpieler();
    if (!H.z && !H.p) return k;
    const innen = id === 'haube' || id === 'fahrer';
    const weit = Math.hypot(k.ziel[0] - k.auge[0], k.ziel[2] - k.auge[2]);
    return Object.assign({}, k, { auge: [k.auge[0], k.auge[1] + H.z, k.auge[2]],
      ziel: [k.ziel[0], k.ziel[1] + H.z + (innen ? Math.tan(H.p) * weit : 0), k.ziel[2]] });
  }
  function vfKameraBasis(id, fx, fz, dt, art, D) {
    if (id === 'fahrer' && VF.fahrer) { VF.kam = null; return vfFahrerKamera(VF.fahrer, VF.x, VF.y, dt); }
    if (id === 'tv' && VF.tv && VF.tv.posten.length) { VF.kam = null; return vfTvKamera(VF.tv, VF.x, VF.y, dt); }
    if (id === 'haube') {
      // Auf der Motorhaube (Speed Dreams: Bonnet 0,75 m vor, 0,95 m hoch), fest am Auto.
      const s = VF.modell ? VF_AUTO.L / VF.modell.d.laenge : 2;
      // Ein Modell darf die Kamera selbst setzen (auto.json "haube": {vor, hoch} in m), wenn die
      // Haube hoeher liegt als die Speed-Dreams-Werte (z. B. Kaefer: Kofferraumhaube ~1,1 m hoch).
      const hb = VF.modell && VF.modell.meta && VF.modell.meta.haube;
      const vor = (hb ? hb.vor : 0.75) * s, hoch = (hb ? hb.hoch : 0.95 + (VF.modell ? 0.07 : 0.25)) * s;
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
    const nah = id === 'nah';
    const hinten = nah ? 9 : 15, hoehe = nah ? 3.8 : 8, tau = nah ? 0.08 : 0.15;
    // Gedreht kreist der SOLL-Ort um das Auto; die Nachfuehrung (tau) bleibt dieselbe.
    const zh = nah ? 2.0 : 1.4, vor = nah ? 8 : 12;
    const k = vfDrehAnwenden({ auge: [VF.x - fx * hinten, hoehe, VF.y - fz * hinten], ziel: [VF.x + fx * vor, zh, VF.y + fz * vor] },
      art, D, VF.x, zh, VF.y);
    const soll = k.auge;
    const a = 1 - Math.exp(-Math.max(0, dt) / tau);
    VF.kam = VF.kam ? VF.kam.map((q, i) => q + (soll[i] - q) * a) : soll;
    return { auge: VF.kam, ziel: k.ziel, fov: nah ? 58 : 54, nah: 0.5 };
  }
  // v1.5.84 BESTELLT: "Ghostcar sollte wie das ausgewählte Auto aussehen". Dasselbe Modell mit derselben Lackfarbe,
  // durchscheinend (VF_GEIST_ALPHA), ohne Licht, Bodenschatten und Federung. Zwei Durchgaenge: erst nur die Tiefe, dann
  // die Farbe mit Tiefe <= gleich, so sieht man nur die vorderste Flaeche des Geists und nicht sein Inneres.
  const VF_GEIST_ALPHA = 0.42;
  let vfGeistA = 0;
  function vfGeistMalen(gl, pv, blick, auge) {
    const g = VF.geist;
    const malen = () => vfModellZeichnen(gl, pv, blick, VF.modell, VF.tprog, g.x, g.y, g.h, null, 0, VF.raddreh, VF.radModell,
      false, false, 1, 0, auge, vfLack());
    vfGeistA = VF_GEIST_ALPHA;
    try {
      gl.colorMask(false, false, false, false);
      malen();
      gl.colorMask(true, true, true, true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
      malen();
    } finally {
      vfGeistA = 0;
      gl.colorMask(true, true, true, true); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }
  // Lichthupe auch am virtuellen Auto (aus PR 4 von gnen54: "Lichthupe funktioniert nicht auf den virtuellen
  // Bahnen"): dieselbe Taktung wie am echten Auto (resolveLights in 70-race.js), das Licht kippt im Takt.
  function vfLichtMitHupe(an) {
    try {
      const jetzt = rennZeitJetzt();
      if (jetzt >= lightFx.flashUntil) return an;
      const el = FLASH_MS - (lightFx.flashUntil - jetzt);
      return (el % FLASH_PERIOD_MS) < FLASH_ON_MS ? !an : an;
    } catch (e) { return an; }
  }
  // Gamepad -> HUD-Knoepfe der virtuellen Fahrt (aus PR 4 von gnen54, gerufen aus pollGamepad in 90-ghosts.js):
  // dieselbe Wirkung wie ein Klick, damit Pad und Maus nie auseinanderlaufen. Licht-Taste = Knopf "Licht",
  // Gelb-Taste getippt = Knopf "Box", 1 s gehalten = Knopf "Gelbe Flagge" (wie im Cockpit).
  function vfKnopf(id) {
    const k = VF.schicht ? VF.schicht.querySelector('[data-vf="' + id + '"]') : null;
    if (k && !k.disabled) k.click();
  }
  const vfFlagPad = { seit: null, gefeuert: false };
  function vfFlagTaste(an) {
    const jetzt = performance.now();
    if (an && vfFlagPad.seit === null) { vfFlagPad.seit = jetzt; vfFlagPad.gefeuert = false; }
    if (an && !vfFlagPad.gefeuert && jetzt - vfFlagPad.seit >= 1000) { vfFlagPad.gefeuert = true; vfKnopf('flag'); }
    if (!an && vfFlagPad.seit !== null) {
      if (!vfFlagPad.gefeuert) vfKnopf('box');
      vfFlagPad.seit = null;
    }
  }
  function vfModellMalen(gl, pv, blick, auge) {
    vfModellZeichnen(gl, pv, blick, VF.modell, VF.tprog, VF.x, VF.y, VF.h, VF.feder, VF.lenkWinkel, VF.raddreh, VF.radModell,
      vfLichtMitHupe(typeof headlightsOn === 'undefined' ? true : !!headlightsOn),
      !!(physEngine.outputs && physEngine.outputs.lights && physEngine.outputs.lights.brake), vfFederSicht(), VF.pitch || 0, auge, vfLack());
  }
  // v1.5: wie weit der Reifen an einem Rad gequetscht ist (0 bis VF_REIFEN_Q.max), rein fuer den Selbsttest.
  // Absenkung des Aufbaus am Rad (x = Spurhaelfte mit Seite, zRel = Abstand zum Schwerpunkt laengs), aus Hub fez.z,
  // Wanken fez.ph (vfRz: +x hebt sich bei ph > 0) und Nicken fez.th (vfRx: +z senkt sich bei th > 0), wie der Aufbau.
  const VF_REIFEN_Q = { ruhe: 0.02, max: 0.07, k: 0.5 };
  function vfReifenQuetsch(fez, g, x, zRel, radius, nick) {
    const f = fez || { z: 0, th: 0, ph: 0 }, gg = g || 1;
    const senk = f.z * gg - x * Math.sin(f.ph * gg) + zRel * Math.sin((f.th + (nick || 0)) * gg * 0.55);
    return Math.max(0, Math.min(VF_REIFEN_Q.max, VF_REIFEN_Q.ruhe + VF_REIFEN_Q.k * senk / Math.max(1e-6, radius)));
  }
  // Ein Modell an einer Stelle zeichnen. Wird fuer das Spielerauto und fuer jeden NPC benutzt:
  // M ist das gebaute Modell (vfModellBauen), T das Texturprogramm, fe der Federungszustand.
  function vfModellZeichnen(gl, pv, blick, M, T, x, y, h, fe, lenkWinkel, raddreh, radModell, licht, bremst, fs, nick, auge, lackHex) {
    const d = M.d, u = T.u;
    const s = VF_AUTO.L / d.laenge;
    const lage = vfMal(vfLage(x, y, h), vfS(s, s, s));
    const g = fs || 1, fez = fe || { z: 0, th: 0, ph: 0 };
    const zSp = d.vorderachse - d.a, boden = (d.reifen.vorn.bodenfreiheit + d.reifen.hinten.bodenfreiheit) / 2;
    // Aufbau: um den Schwerpunkt genickt und gerollt, eingefedert nach unten.
    const aufbau = vfKette(lage, vfT(0, boden - fez.z * g, zSp), vfT(0, d.schwerpunktHoehe, 0), vfRx((fez.th + (nick || 0)) * g * 0.55), vfRz(fez.ph * g),
      vfT(0, -d.schwerpunktHoehe, -zSp));
    gl.useProgram(T.p);
    for (let i = 0; i < 16; i++) T.pv[i] = pv[i];
    gl.uniformMatrix4fv(u.m, false, T.pv);
    vfTzSetzen(gl, u);
    gl.uniform1i(u.tx, 0);
    // v1.3.124 (nur Quality): Blickpunkt fuer den Glanz und Selbst-Schatten aus der Schattenkarte
    // (Textur-Einheit 1) - die Autos empfangen ihre eigenen Schatten.
    const hatSch = !!(T.qual && VF.schatte && VF.schM);
    if (T.qual) {
      gl.uniform3f(u.auge, auge[0], auge[1], auge[2]);
      gl.uniform1f(u.schatt, hatSch ? 1 : 0);
      if (hatSch) { for (let i = 0; i < 16; i++) T.schM[i] = VF.schM[i]; gl.uniformMatrix4fv(u.schM, false, T.schM); }
      else gl.uniformMatrix4fv(u.schM, false, VF_EINS);
      gl.uniform1f(u.bias, VF_SCHATTEN_BIAS);
      gl.uniform1f(u.biasPixel, VF.schatte ? VF_SCHATTEN_PCF / VF.schatte.size : 0);
      gl.uniform1i(u.sch, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, VF.schatte ? VF.schatte.tex : null);
      // v1.5.94 (G2): Umgebungskarte auf Einheit 2.
      const umw = VF.umw && VF.umw.fertig ? VF.umw.tex : null;
      gl.uniform1i(u.umw, 2); gl.uniform1f(u.umwAn, umw ? 1 : 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, umw);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.enableVertexAttribArray(T.ap); gl.enableVertexAttribArray(T.an); gl.enableVertexAttribArray(T.auv);
    const setze = (w, tint, emis, alpha, am, hell, klar, glas, lackF) => {
      for (let i = 0; i < 16; i++) T.f16[i] = w[i];
      gl.uniformMatrix4fv(u.w, false, T.f16);
      const nm = vfNormalen(w);
      for (let i = 0; i < 9; i++) T.f9[i] = nm[i];
      gl.uniformMatrix3fv(u.nm, false, T.f9);
      gl.uniform3f(u.tint, tint[0], tint[1], tint[2]); gl.uniform1f(u.emis, emis);
      gl.uniform1f(u.alpha, vfGeistA ? alpha * vfGeistA : alpha); gl.uniform1f(u.am, am); gl.uniform1f(u.licht, hell); gl.uniform1f(u.lack, lackF || 0);
      if (T.qual) { gl.uniform1f(u.klar, klar || 0); gl.uniform1f(u.glas, glas || 0); }
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
    // 1. Schatten unter dem Auto (Boden, nicht mitgeneigt); der Geist wirft keinen.
    // v1.5.156: Bei echter Schattenkarte (Quality) nicht mehr zeichnen - der Blob war ein
    // hellgrauer Fleck unter dem Auto, der nicht mit der Sonne wanderte, waehrend die
    // Schattenkarte den richtigen (sonnenabhaengigen) Schatten schon wirft. Ohne Schattenkarte
    // (Performance, oder wenn das Framebuffer scheitert) bleibt er als weicher Kontaktschatten
    // der Fallback, damit das Auto nicht "schwebt".
    if (M.schatten && !vfGeistA && !hatSch) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      // Weicher Blob (nur noch als Fallback ohne Schattenkarte): voller Umriss, gut sichtbar.
      const kd = 1;
      setze(VF_EINS, [1, 1, 1], 0, 0.75, 1, 0, 0, 0);
      const hb = d.breite * 0.62 * kd, hl = d.laenge * 0.55 * kd;
      const q = [[hb, 0.012, hl + zSp, 0, 0], [-hb, 0.012, hl + zSp, 1, 0], [-hb, 0.012, -hl + zSp, 1, 1], [hb, 0.012, -hl + zSp, 0, 1]].map((p) => ort(lage, p).concat(p.slice(3)));
      flaeche([q[0], q[1], q[2], q[0], q[2], q[3]], M.schatten);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // 2. Aufbau, undurchsichtige Teile; Scheinwerfer und Ruecklicht leuchten selbst
    const ruecklichtEmis = bremst ? 1.7 : (licht ? 0.55 : 0);
    const lackTint = vfLackTint(lackHex);
    for (const t of M.aufbauTeile) {
      const emis = t.rolle === 'scheinwerfer' ? (licht ? 1.3 : 0) : t.rolle === 'ruecklicht' ? ruecklichtEmis : 0;
      // Karosserie mit leichtem Clear-Coat-Glanz (klar, nur Quality), Scheiben/Glas dagegen nicht.
      // Der Lack betrifft nur Karosserieteile: Scheinwerfer, Ruecklichter und Scheiben bleiben unveraendert.
      const lackTeil = !t.rolle || t.rolle === 'karosserie' || t.rolle === 'lack';
      // v1.5.157: klar 0.3 -> 0.5 (mehr Klarlack-Glanz in Quality). Die Raeder bleiben bei 0.2, das
      // Glas unveraendert - nur die Karosserie bekommt den naesseren Glanz.
      setze(aufbau, lackTeil ? lackTint : VF_WEISS, emis, 1, 0, 1, 0.5, 0, lackTeil && lackHex ? 1 : 0);
      teil(t);
    }
    // 3. Raeder: Mitte auf Reifenradius, vorn eingeschlagen, alle drehen; rechts gespiegelt (Muttern aussen)
    const radTeile = M.radTeile;
    const halbW = d.breite / 2;
    [[1, 'vorn', d.vorderachse], [-1, 'vorn', d.vorderachse], [1, 'hinten', d.hinterachse], [-1, 'hinten', d.hinterachse]].forEach(([seite, ax, z]) => {
      const r = d.reifen[ax];
      const dreh = vfRy(ax === 'vorn' ? -(lenkWinkel || 0) : 0);
      // v1.5 (Quality): Reifenverformung. Der Reifen wird unten flacher und breiter, je tiefer der Aufbau an
      // diesem Rad einfedert (Hub, Wanken, Nicken aus fez wie beim Aufbau oben); die Mitte sinkt mit, damit
      // er auf dem Boden bleibt. Nicht drehend (vor vfRx), Performance unveraendert.
      const q = T.qual ? vfReifenQuetsch(fez, g, seite * r.spur / 2, z - zSp, r.radius, nick) : 0;
      const quetsch = q ? vfS(1 + 0.6 * q, 1 - q, 1) : VF_EINS;
      const w = vfKette(lage, vfT(seite * r.spur / 2, r.radius * (1 - q), z), dreh, quetsch, vfRx(raddreh || 0),
        vfS(seite * r.breite, 2 * r.radius, 2 * r.radius));
      // v1.5.104 (aus PR 3 von gnen54): Teile mit "achse" (vorn/hinten) nur an dieser Achse - eigene Raeder je Achse (Spider NG1).
      radTeile.forEach((t) => { if (t.achse && t.achse !== ax) return; setze(w, [1, 1, 1], 0, 1, 0, 1, 0.2, 0); teil(t); });
      if (!radTeile.length) {
        // Fallback: die echten Rad-Teile der Vulture V5.R (mit Reifen-/Felgen-Textur).
        const radM = radModell;
        if (radM && radM.teile.length) {
          // Mitte des Rads auf der halben Spur; bis 1.5.83 so weit nach aussen, dass es 12 cm UEBER die Karosserie
          // ragte (GEMELDET "stehen zu weit nach außen ab"). Jetzt endet der Reifen hoechstens 3 cm innerhalb der Flanke.
          const xW = seite * vfRadX(r, halbW);
          const wF = vfKette(lage, vfT(xW, r.radius * (1 - q), z), dreh, quetsch, vfRx(raddreh || 0),
            vfS(seite * r.breite, 2 * r.radius, 2 * r.radius));
          setze(wF, [1, 1, 1], 0, 1, 0, 1, 0.2, 0);
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
    for (const t of M.glasTeile) {
      if (t.rolle === 'glas') { setze(aufbau, VF_GLAS_TINT, 0, 0.86, 0, 1, 0, 1); teil(t); }
      else { setze(aufbau, VF_WEISS, licht ? 0.6 : 0, 0.9, 1, 1, 0, 0.5); teil(t); }
    }
    // 5. Leuchten: Lichtpunkte (zur Kamera gedreht) und vorn der Lichtkegel auf der Bahn
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const rechts = [blick[0], blick[4], blick[8]], oben = [blick[1], blick[5], blick[9]];
    const punkt = (p, gr, farbe, staerke) => {
      const c = ort(aufbau, p), k = gr * s;
      const e = (a, b) => [c[0] + (rechts[0] * a + oben[0] * b) * k, c[1] + (rechts[1] * a + oben[1] * b) * k, c[2] + (rechts[2] * a + oben[2] * b) * k];
      const q = [e(-1, -1).concat([0, 0]), e(1, -1).concat([1, 0]), e(1, 1).concat([1, 1]), e(-1, 1).concat([0, 1])];
      setze(VF_EINS, farbe, 0, staerke, 1, 0, 0, 0);
      flaeche([q[0], q[1], q[2], q[0], q[2], q[3]], M.glanz);
    };
    if (licht) {
      const vorn = d.laenge / 2 + zSp;
      const kegel = [[0.9, 0.02, vorn, 0.25, 0.5], [-0.9, 0.02, vorn, 0.75, 0.5], [-3.2, 0.02, vorn + 13, 1, 1], [3.2, 0.02, vorn + 13, 0, 1]]
        .map((p) => ort(lage, p).concat(p.slice(3)));
      setze(VF_EINS, [1, 0.95, 0.82], 0, 0.30, 1, 0, 0, 0);
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
    VF.wetterKnopf = q('[data-vf="wetter"]'); VF.wetterNass = null;
  }
  function vfHud() {
    const u = VF.ui;
    if (!u) return;
    // Wetter-Knopf hell, solange es regnet (auch nach einem geplanten Wechsel).
    const wk = VF.wetterKnopf;
    if (wk) {
      const nass = typeof weather !== 'undefined' && weather === 'rain';
      if (VF.wetterNass !== nass) { VF.wetterNass = nass; wk.classList.toggle('vf-an', nass); wk.setAttribute('aria-pressed', nass ? 'true' : 'false'); }
    }
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
        else if (VF.modus === 'derby') modusTxt += ' · ' + VF.derbyHealth + ' HP · ' + VF.derbyKills + (VF.limit > 0 ? '/' + VF.limit : '') + ' ' + t('Kills');
        else if (VF.modus === 'knockout') modusTxt += ' · ' + VF.koLeben + ' ' + t('Leben');
        else if (VF.modus === 'bestzeit') modusTxt += ' · ' + vfZeitAcc(VF.beste, 3);
        else modusTxt += ' · ' + vfZeit(Math.floor(VF.modusZeit * 1000 / 100) * 100);
        if (vfPflichtGilt()) modusTxt += ' · ' + t('Box') + ' ' + Math.min(VF.boxDurch || 0, vfPflichtBox()) + '/' + vfPflichtBox();
      }
    }
    txt(u.modus, 'm', modusTxt);
    if (u.abseits.hidden === VF.abseits) u.abseits.hidden = !VF.abseits;
    const frei = vfKameraGedreht();
    if (u.kamFrei.hidden === frei) u.kamFrei.hidden = !frei;
    // Tacho-Block: Tempo, Gang, Drehzahl, Reifen, Tank - dieselben Werte wie das Cockpit.
    txt(u.tempo, 'v', String(kmh));
    txt(u.rpm, 'r', String(Math.round(motorDrehzahl(st) / 10) * 10));
    // v1.5.158 GEMELDET: "erster Gang wird als N angezeigt, sollte aber 1 sein". currentGear zaehlt ab 0 (wie im
    // Cockpit, gearLabel in 50-drive.js); vorher stand im 1. Gang "N" und in jedem weiteren eine Zahl zu wenig.
    txt(u.gang, 'g', gearLabel(st));
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

  // ---- Beruehrungs-Steuerung (Touch, v1.3.122) -----------------------------------------------
  // BESTELLT: "add touch controls as an option (ideally auto-selected when no gamepad is connected
  // and user is on mobile - on PC arrows are much better on the keyboard so no touch needed)."
  // Links lenken (horizontaler Joystick), rechts Gas/Bremse (vertikal: oben Gas, unten Bremse). Beide
  // schreiben ueber die Schiedsstelle (applySteerInput/applyThrottleInput) mit der eigenen Quelle
  // SRC.TOUCH - so koennen sich Tastatur, Gamepad und Touch nicht gegenseitig ueberschreiben, und die
  // Freigabe nach einer Pause (rennPause) gilt fuer alle Quellen gleich.
  const VF_TOUCH_STORE = 'omegasim-vf-touch';   // 'an'/'aus' = von Hand, sonst automatisch
  function vfTouchGeraet() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }
  function vfTouchPadAn() {
    try { return !!(navigator.getGamepads && Array.from(navigator.getGamepads()).some((p) => p)); }
    catch (e) { return false; }
  }
  // Soll die Beruehrungs-Steuerung sichtbar sein? Automatisch auf Touch-Geraeten ohne Gamepad; ein
  // manueller Schalter (Knopf "Steuerung") kann das ueberschreiben.
  function vfTouchSollAn() {
    if (!vfTouchGeraet()) return false;
    let manuell = null;
    try { manuell = localStorage.getItem(VF_TOUCH_STORE); } catch (e) { /* privat */ }
    if (manuell === 'an') return true;
    if (manuell === 'aus') return false;
    return !vfTouchPadAn();
  }
  function vfTouchElement() { return VF.schicht ? VF.schicht.querySelector('.vf-touch') : null; }
  function vfTouchAnzeigen(an) {
    const el = vfTouchElement();
    if (el) el.hidden = !an;
    const kn = VF.schicht ? VF.schicht.querySelector('[data-vf="touch"]') : null;
    if (kn) kn.classList.toggle('vf-an', an);
  }
  function vfTouchAktualisieren() {
    const kn = VF.schicht ? VF.schicht.querySelector('[data-vf="touch"]') : null;
    if (kn) kn.hidden = !vfTouchGeraet();   // den Knopf nur auf Touch-Geraeten zeigen
    vfTouchAnzeigen(vfTouchSollAn());
  }
  function vfTouchUmschalten() {
    const an = vfTouchSollAn();
    try { localStorage.setItem(VF_TOUCH_STORE, an ? 'aus' : 'an'); } catch (e) { /* privat */ }
    vfTouchAktualisieren();
  }
  // Zeigerzustand je Steuerelement (je ein Zeiger, damit zwei Finger sich nicht stoeren).
  function vfTouchBauen() {
    const el = vfTouchElement();
    if (!el) return;
    const lenk = el.querySelector('.vf-touch-lenk');
    const gas = el.querySelector('.vf-touch-gas');
    if (lenk) {
      let zeiger = null;
      const bewegen = (e) => {
        const rect = lenk.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, r = rect.width / 2;
        if (!(r > 0)) return;   // verborgen (Groesse 0): sonst 0/0 = NaN als Lenkwert
        const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / r));
        applySteerInput(SRC.TOUCH, dx);
        const kn = lenk.querySelector('.vf-touch-knauf');
        if (kn) kn.style.transform = 'translateX(' + (dx * r * 0.55) + 'px)';
      };
      const los = (e) => {
        if (zeiger === null || (e.pointerId !== undefined && e.pointerId !== zeiger)) return;
        zeiger = null;
        releaseSteerInput(SRC.TOUCH);
        const kn = lenk.querySelector('.vf-touch-knauf');
        if (kn) kn.style.transform = '';
      };
      lenk.addEventListener('pointerdown', (e) => { zeiger = e.pointerId; try { lenk.setPointerCapture(e.pointerId); } catch (err) { /* egal */ } bewegen(e); e.preventDefault(); });
      lenk.addEventListener('pointermove', (e) => { if (zeiger !== null && e.pointerId === zeiger) bewegen(e); });
      lenk.addEventListener('pointerup', los);
      lenk.addEventListener('pointercancel', los);
    }
    if (gas) {
      let zeiger = null;
      const bewegen = (e) => {
        const rect = gas.getBoundingClientRect();
        const cy = rect.top + rect.height / 2, r = rect.height / 2;
        if (!(r > 0)) return;
        const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / r));
        applyThrottleInput(SRC.TOUCH, -dy);   // oben = Gas (+), unten = Bremse (-)
        const kn = gas.querySelector('.vf-touch-knauf');
        if (kn) kn.style.transform = 'translateY(' + (dy * r * 0.55) + 'px)';
      };
      const los = (e) => {
        if (zeiger === null || (e.pointerId !== undefined && e.pointerId !== zeiger)) return;
        zeiger = null;
        releaseThrottleInput(SRC.TOUCH);
        const kn = gas.querySelector('.vf-touch-knauf');
        if (kn) kn.style.transform = '';
      };
      gas.addEventListener('pointerdown', (e) => { zeiger = e.pointerId; try { gas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ } bewegen(e); e.preventDefault(); });
      gas.addEventListener('pointermove', (e) => { if (zeiger !== null && e.pointerId === zeiger) bewegen(e); });
      gas.addEventListener('pointerup', los);
      gas.addEventListener('pointercancel', los);
    }
    vfTouchAktualisieren();
  }
  // Aendert sich das Gamepad waehrend der Fahrt (angeschlossen/abgesteckt), zeigt sich die
  // Beruehrungs-Steuerung neu an bzw. verschwindet.
  window.addEventListener('gamepadconnected', vfTouchAktualisieren);
  window.addEventListener('gamepaddisconnected', vfTouchAktualisieren);

  // ---- KNOPFLEISTE ALS PIKTOGRAMME (BESTELLT: "kompakte Piktogramm-Knoepfe statt der Textleiste, dazu ein Knopf,
  // der alle aus- und einblendet") ----
  // Box, Gelbe Flagge, Licht, Wetter, Kamera, Zuruecksetzen, Steuerung (nur Touch) und Beenden als kleine Symbole
  // (Inline-SVG, Name als title und aria-label). Ganz rechts der Knopf "leiste": blendet alle anderen aus und ein, die
  // Wahl bleibt fuer die naechste Fahrt (localStorage). Die Knoepfe behalten ihr data-vf (Klick, Pad, Selbsttest).
  const VF_LEISTE_STORE = 'omegasim-vf-leiste';
  const VF_IKONEN = {
    box: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    flag: '<path d="M5 21V4"/><path class="vf-ikon-fuell" d="M5 4h12l-2.5 4 2.5 4H5"/>',
    licht: '<path class="vf-ikon-fuell" d="M11 6a6 6 0 0 0 0 12z"/><path d="M15 8h6M15 12h6M15 16h6"/>',
    wetter: '<path d="M7 15a4 4 0 0 1 .4-8 5 5 0 0 1 9.6 1.4A3.4 3.4 0 0 1 17 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    // v1.6.20: Pad-Diagnose (aus gnen54s testversion): ein Gamepad.
    paddiag: '<path d="M6 9h12a3 3 0 0 1 3 3l-1 5a2 2 0 0 1-3.4 1L15 16H9l-1.6 2A2 2 0 0 1 4 17l-1-5a3 3 0 0 1 3-3z"/><path d="M8 12v3M6.5 13.5h3"/><circle cx="16.5" cy="12.5" r="1"/>',
    kam: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
    touch: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10V8.5a1.5 1.5 0 0 1 3 0V11M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7l-2.2-2.7a1.5 1.5 0 0 1 2.4-1.8L9 16"/>',
    zu: '<path d="M6 6l12 12M18 6L6 18"/>',
    leiste: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  function vfIkon(id) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + VF_IKONEN[id] + '</svg>'; }
  function vfLeisteZu() { try { return localStorage.getItem(VF_LEISTE_STORE) === 'zu'; } catch (e) { return false; } }
  // v1.6.20 (aus gnen54s testversion, 22.11.): F8 oder Knopf: Pad-Diagnose ueber der Fahrt (padDiagText, 90-ghosts.js).
  var vfPadDiagIv = 0;
  function vfPadDiagUmschalten() {
    let el = document.getElementById('vf-pad-diag');
    if (el) { el.remove(); clearInterval(vfPadDiagIv); return; }
    el = document.createElement('pre');
    el.id = 'vf-pad-diag';
    el.setAttribute('data-i18n-skip', '');
    el.style.cssText = 'position:fixed;left:8px;top:180px;z-index:99999;margin:0;padding:8px 10px;max-width:70vw;'
      + 'white-space:pre-wrap;font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.78);border:1px solid #29b6f6;pointer-events:none';
    document.body.appendChild(el);
    const zeichne = () => {
      if (!el.isConnected || !VF.aktiv) { el.remove(); clearInterval(vfPadDiagIv); return; }
      el.textContent = t('Pad-Diagnose (F8 oder Knopf schließt)') + '\n' + (typeof padDiagText === 'function' ? padDiagText() : '-');
    };
    zeichne();
    vfPadDiagIv = setInterval(zeichne, 200);
  }
  window.addEventListener('keydown', (e) => { if (typeof VF !== 'undefined' && VF.aktiv && e.key === 'F8' && !e.repeat) { e.preventDefault(); vfPadDiagUmschalten(); } });
  function vfKnopfLeisteHtml() {
    const a = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const k = (id, titel, extra) => '<button type="button" class="vf-ikon" data-vf="' + id + '" title="' + a(titel) + '" aria-label="' + a(titel) + '"'
      + (extra || '') + '>' + vfIkon(id) + '</button>';
    const zu = vfLeisteZu();
    return '<div class="vf-knoepfe' + (zu ? ' vf-knoepfe-zu' : '') + '" role="toolbar" aria-label="' + a(t('Knöpfe der virtuellen Fahrt')) + '">'
      + k('box', t('Box')) + k('flag', t('Gelbe Flagge')) + k('licht', t('Licht')) + k('wetter', t('Wetter')) + k('kam', t('Kamera')) + k('paddiag', t('Pad-Diagnose'))
      + k('reset', t('Zurücksetzen')) + k('touch', t('Steuerung'), ' hidden') + k('zu', t('Beenden'))
      + k('leiste', t(zu ? 'Knöpfe einblenden' : 'Knöpfe ausblenden'), ' aria-pressed="' + (zu ? 'true' : 'false') + '"')
      + '</div>';
  }
  // zu: true = ausblenden, false = einblenden, undefined = umschalten.
  function vfLeisteUmschalten(zu) {
    const L = VF.schicht ? VF.schicht.querySelector('.vf-knoepfe') : null;
    if (!L) return;
    if (zu === undefined) zu = !L.classList.contains('vf-knoepfe-zu');
    L.classList.toggle('vf-knoepfe-zu', zu);
    const b = L.querySelector('[data-vf="leiste"]');
    if (b) { const ti = t(zu ? 'Knöpfe einblenden' : 'Knöpfe ausblenden'); b.title = ti; b.setAttribute('aria-label', ti); b.setAttribute('aria-pressed', zu ? 'true' : 'false'); }
    try { localStorage.setItem(VF_LEISTE_STORE, zu ? 'zu' : 'auf'); } catch (e) { /* egal */ }
  }

  // ---- LADEBILD (BESTELLT: "Ladebildschirm, solange Klaenge, Texturen und Automodelle laden; kein HUD, ... und ein
  // Fortschrittsbalken"). v1.6.20 BESTELLT: "schoener, wenn die Strecke das ganze Bild einnimmt und nicht unten links ist.
  // Auch, wenn es ein Bild der aktuellen Strecke (wie aus dem Editor von oben) ist. Die Lade-Animation kann dann einfach
  // das sich drehende Teil sein." ----
  // Also: die Strecke von oben fuellt das Bild (Carrera-Bahn: derselbe Zeichner wie der Editor, renderTrackPreview mit
  // Gitter; freie Strecke: ihr Umriss mit weissen Randlinien, die Bruecke obenauf), darueber in der Mitte das drehende
  // Streckenteil (ladeAnimationHtml aus 59-lade.js, reines CSS, kostet den Hauptfaden nichts), Titel, Balken und was noch
  // fehlt. Das Bild entsteht EINMAL beim Start, je Takt werden nur Balken und Text gesetzt.
  // Die Bahn-, Rand- und Bodentexturen entstehen schon beim Start (synchron), das Ladebild wartet auf das, was danach
  // kommt: Rad-Modell, eigenes Auto, jeder NPC (je ein Promise, Fehler zaehlen als fertig), die Bilder der Modelle
  // (VF.texOffen, vfTextur) und den Motorklang (hoechstens VF_LADE_TON_MAX_MS). Spaetestens nach VF_LADE_MAX_MS geht es los.
  const VF_LADE_MAX_MS = 60000, VF_LADE_TON_MAX_MS = 20000;
  function vfLadeTonFertig(jetzt) {
    try {
      if (!soundEnabled || location.protocol === 'file:') return true;
      if (jetzt - (VF.ladeAb || 0) > VF_LADE_TON_MAX_MS) return true;
      if (vfTonGeladen(vfMotorZiel())) return true;
      return !sampleEngine.loading;
    } catch (e) { return true; }
  }
  // Stand des Ladens: anteil 0..1, fertig, und was noch fehlt (Text).
  function vfLadeStand(jetzt) {
    const tp = !!VF.tprog, npcs = VF.npcs || [];
    const autoDa = !tp || !!VF.modell || !!VF.modellFehl, radDa = !tp || !!VF.radModell || !!VF.radFehl;
    const npcDa = npcs.filter((n) => n.modell || n.modellFehl).length;
    const autos = 1 + npcs.length, autosDa = (autoDa ? 1 : 0) + npcDa;
    const modelle = autoDa && radDa && npcDa === npcs.length;
    const texG = VF.texGesamt || 0, texO = VF.texOffen || 0;
    const texDa = modelle && texO <= 0;
    const tonDa = vfLadeTonFertig(jetzt);
    // Gewichte: Strecke 1 (fertig), Rad 1, Autos je 2, Texturen 2, Klang 1.
    const texAnteil = texG > 0 ? (texG - texO) / texG : (modelle ? 1 : 0);
    const summe = 1 + (radDa ? 1 : 0) + 2 * autosDa + 2 * (modelle ? texAnteil : texAnteil * 0.5) + (tonDa ? 1 : 0);
    const gesamt = 1 + 1 + 2 * autos + 2 + 1;
    const fehlt = [];
    if (autosDa < autos || !radDa) fehlt.push(t('Fahrzeuge') + ' ' + autosDa + '/' + autos);
    if (!texDa) fehlt.push(t('Texturen') + (texG ? ' ' + (texG - texO) + '/' + texG : ''));
    if (!tonDa) fehlt.push(t('Motorklang'));
    return { anteil: Math.max(0, Math.min(1, summe / gesamt)), fertig: modelle && texDa && tonDa, text: fehlt.join(' · ') };
  }
  // Die Strecke von oben als SVG. Carrera-Bahn wie im Editor; freie Strecke (eigene Punkte, keine Carrera-Teile) als Band.
  function vfLadeKarteSvg(tiles, freiPts) {
    if (!freiPts) {
      try {
        const html = renderTrackPreview(tiles, null, { detailed: true, echt: true, ohneLinie: true, ohneLinieRechnen: true, grid: true }).html;
        if (/^<svg/.test(html)) return html.replace('class="tp-karte"', 'class="tp-karte vf-laden-svg"');
      } catch (e) { /* unten: als Band */ }
    }
    const pts = freiPts || trackCenterline(tiles);
    if (!pts || pts.length < 2) return '';
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMax = 0;
    for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); zMax = Math.max(zMax, q.z || 0); }
    const half = TRACK_HALF_W, rand = half + 14, w = x1 - x0 + 2 * rand, h = y1 - y0 + 2 * rand;
    const P = (q) => (q.x - x0 + rand).toFixed(1) + ' ' + (q.y - y0 + rand).toFixed(1);
    const band = (d) => '<path d="' + d + '" fill="none" stroke="#e8ecf2" stroke-width="' + (half * 2).toFixed(1) + '" stroke-linejoin="round"/>'
      + '<path d="' + d + '" fill="none" stroke="#0d0f13" stroke-width="' + (half * 2 - 3.2).toFixed(1) + '" stroke-linejoin="round"/>';
    let body = band('M ' + pts.map(P).join(' L ') + ' Z');
    // Bruecke: was hoch liegt, noch einmal obenauf (sonst verschwindet sie unter der Strasse darunter).
    if (zMax > 0) {
      let stueck = [];
      const fertig = () => { if (stueck.length > 1) body += band('M ' + stueck.map(P).join(' L ')).replace(/stroke-linejoin/g, 'stroke-linecap="butt" stroke-linejoin'); stueck = []; };
      for (const q of pts) { if ((q.z || 0) > zMax * 0.5) stueck.push(q); else fertig(); }
      fertig();
    }
    // Start/Ziel: weisser Strich quer zur Fahrtrichtung bei Punkt 0.
    const p0 = pts[0], p1 = pts[1], l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, nx = -(p1.y - p0.y) / l, ny = (p1.x - p0.x) / l;
    body += '<path d="M ' + P({ x: p0.x + nx * half, y: p0.y + ny * half }) + ' L ' + P({ x: p0.x - nx * half, y: p0.y - ny * half })
      + '" stroke="#ffffff" stroke-width="4"/>';
    return '<svg class="tp-karte vf-laden-svg" viewBox="0 0 ' + w.toFixed(0) + ' ' + h.toFixed(0) + '">' + body + '</svg>';
  }
  // Hochkant-Strecke auf Querformat (oder umgekehrt): um 90 Grad im Uhrzeigersinn drehen, wenn sie dadurch mindestens
  // 15 % groesser wird ("die Strecke nimmt das ganze Bild ein"). Punkt (x, y) wird zu (H - y, x).
  function vfLadeKarteDrehen(svg, bw, bh) {
    const m = /^<svg([^>]*) viewBox="0 0 ([\d.]+) ([\d.]+)">/.exec(svg || '');
    if (!m || !(bw > 0 && bh > 0)) return svg;
    const W = +m[2], H = +m[3];
    if (!(Math.min(bw / H, bh / W) > 1.15 * Math.min(bw / W, bh / H))) return svg;
    return '<svg' + m[1] + ' data-gedreht="1" viewBox="0 0 ' + m[3] + ' ' + m[2] + '"><g transform="translate(' + m[3] + ' 0) rotate(90)">'
      + svg.slice(m[0].length).replace(/<\/svg>\s*$/, '') + '</g></svg>';
  }
  function vfLadebildHtml(karte) {
    return '<div class="vf-laden" role="status" aria-live="polite">'
      + '<div class="vf-laden-karte" aria-hidden="true">' + (karte || '') + '</div>'
      + '<div class="vf-laden-mitte">' + (typeof ladeAnimationHtml === 'function' ? ladeAnimationHtml('') : '')
      + '<div class="vf-laden-titel">' + t('Virtuelle Fahrt wird geladen') + '</div>'
      + '<div class="vf-laden-balken" role="progressbar" aria-label="' + t('Ladefortschritt') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>'
      + '<div class="vf-laden-was"></div></div>'
      + '<button type="button" class="vf-laden-zu" data-vf="laden-zu" title="' + t('Laden abbrechen') + '" aria-label="' + t('Laden abbrechen') + '">' + vfIkon('zu') + '</button>'
      + '</div>';
  }
  // Je Bild waehrend des Ladens: true = laedt noch (vfBild tut sonst nichts), false = fertig, das HUD kommt.
  function vfLadeSchritt(jetzt) {
    if (!VF.laedt) return false;
    const S = vfLadeStand(jetzt);
    if (S.fertig || jetzt - (VF.ladeAb || jetzt) > VF_LADE_MAX_MS) { vfLadenEnde(); return false; }
    const el = VF.schicht ? VF.schicht.querySelector('.vf-laden') : null;
    if (el) {
      const pz = Math.round(S.anteil * 100), bal = el.querySelector('.vf-laden-balken');
      if (bal && bal.getAttribute('aria-valuenow') !== String(pz)) { bal.setAttribute('aria-valuenow', String(pz)); bal.firstChild.style.transform = 'scaleX(' + (pz / 100) + ')'; }
      const was = el.querySelector('.vf-laden-was');
      if (was && was.textContent !== S.text) was.textContent = S.text;
    }
    return true;
  }
  function vfLadenEnde() {
    VF.laedt = false;
    if (VF.schicht) {
      VF.schicht.classList.remove('vf-laedt');
      const el = VF.schicht.querySelector('.vf-laden');
      if (el) el.remove();
    }
    VF.letzt = 0; VF.kam = null;
    if (physEngine && physEngine.state) physEngine.state.speedKmh = 0;
  }

  // ---- GEGENRICHTUNG (BESTELLT: "die virtuelle Strecke in der Gegenrichtung fahren", WIP) ----
  // Die gefahrene Mittellinie laeuft andersherum: Punkt j der neuen Linie ist Punkt (n - j) mod n der alten (Punkt 0
  // bleibt), der Kurs dreht um 180 Grad, und weil Abschnitt i zum Teil pts[i+1].tile gehoert, ruecken die Teile um einen
  // Punkt. Gezeichnet wird weiter die Bahn in der alten Richtung - Ziellinie, Sektoren und Boxengasse liegen also am
  // selben Ort; die Ziellinie (VF.zielIdx) wird nur auf den neuen Index umgerechnet, die Boxenbucht je Punkt mitgedreht,
  // und die Boxenseite in Fahrtrichtung ist die andere (VF.boxSeite).
  const VF_RICHTUNG_STORE = 'omegasim-vf-richtung';
  function vfGegenAn() { try { return localStorage.getItem(VF_RICHTUNG_STORE) === 'gegen'; } catch (e) { return false; } }
  function vfGegenrichtung(pts, B) {
    const n = pts.length, idx = (i) => ((n - i) % n + n) % n;
    const R = [];
    for (let j = 0; j < n; j++) {
      const p = pts[idx(j)], vor = pts[(idx(j) + 1) % n];
      R.push(Object.assign({}, p, { heading: (p.heading || 0) + 180, tile: vor.tile }));
    }
    let bucht = null;
    if (B) {
      const b = new Float32Array(n), u = new Float32Array(n).fill(-1);
      for (let j = 0; j < n; j++) { const i = idx(j); b[j] = B.b[i]; u[j] = B.u[i] >= 0 ? 1 - B.u[i] : -1; }
      bucht = { b, u };
    }
    return { pts: R, bucht, idx };
  }

  // ---- Starten und Beenden ------------------------------------------------------------------
  // opts.tiles: diese Strecke statt der des Editors (die Studie faehrt Homington), opts.studie: die
  // Fahrt gehoert der Studie (beim Beenden nicht in die Garage). true = gestartet.
  const VF_FREIGABE_MS = 60000;
  var vfFreigabeTimer = 0;   // var: virtuellBeenden kann vor dieser Zeile laufen (Selbsttest beim Laden)
  function vfSpeicherFreigeben() {
    if (VF.aktiv) return;
    vfTexDaten.bahn = null; vfTexDaten.rand = null; vfTexDaten.boden = null; vfTexDaten.bodenId = null;
    vfTexLauf.bahn = null; vfTexLauf.boden = null; vfTexLauf.bodenId = null;
    vfModellLaden = {}; vfRadModell = null;
    log('Virtuell: Texturen und Automodelle aus dem Speicher freigegeben.', 'info');
  }
  function virtuellStarten(opts) {
    clearTimeout(vfFreigabeTimer);
    opts = opts || {};
    if (VF.aktiv) return false;
    vfHandlingCache = null;   // einmal frisch lesen (z. B. in einem anderen Tab geaendert)
    if (!physicsEnabled) { showHudToast(t('Virtuell braucht ein Fahrgefühl mit Physik (nicht RC)')); return false; }
    // Rundenuhr der vorigen Fahrt nicht mitnehmen (aus PR 4 von gnen54: "Zeitansage sofort beim Start nach
    // Ueberfahren von Start/Ziel"): die erste Ueberfahrt startet die Uhr, angesagt wird erst die erste ganze Runde.
    try { dashLapTimes = []; dashLapStart = null; } catch (e) { /* ohne */ }
    // Editor-Strecke und gemerkte Rollen gehoeren dem Fahrer: die Ersatzstrecke (Balkonia) und die Rolle
    // des virtuellen Autos werden beim Beenden wieder zurueckgenommen.
    VF.tilesVorher = currentTrackTiles;
    try { VF.editorVorher = localStorage.getItem(EDITOR_STRECKE_STORE); } catch (e) { VF.editorVorher = undefined; }
    // v1.5.150: freie Strecke (nur virtuell) statt der gebauten Bahn - erst laden, dann neu starten.
    const freiK = !(opts.tiles && opts.tiles.length >= 3) && !opts.studie ? vfFreiWahl() : '';
    if (freiK && !vfFreiCache[freiK]) {
      vfFreiLaden(freiK).then(() => virtuellStarten(opts), () => showHudToast(t('Strecke konnte nicht geladen werden')));
      return true;
    }
    const frei = freiK ? vfFreiCache[freiK] : null;
    VF.frei = frei;
    VF_BOX_SEITE = frei ? frei.seite : -1;   // freie Strecken: Box auf der Seite der DXF (boxSeite)
    const tiles = frei ? frei.tiles : (opts.tiles && opts.tiles.length >= 3 ? opts.tiles : vfTilesWaehlen());
    if (!tiles) { showHudToast(t('Erst eine Strecke bauen')); return false; }
    VF.studie = !!opts.studie;
    const schicht = document.createElement('div');
    schicht.className = 'vf-schicht';
    const lbl = (txt) => '<span class="vf-lbl">' + txt + '</span>';
    schicht.innerHTML = '<canvas class="vf-bild"></canvas>' + (vfGrafikQual() ? '<div class="vf-vignette"></div>' : '')
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
      + vfKnopfLeisteHtml()
      + '<span class="vf-kamfrei" hidden data-i18n-skip>' + t('Kamera frei') + ' · R3 / V: ' + t('Standard') + ' <span class="wip-tag">WIP</span></span>'
      + '<span class="vf-wip">' + t('Virtuell') + ' <span class="wip-tag">WIP</span></span>'
      + '<div class="vf-touch" hidden><div class="vf-touch-lenk"><div class="vf-touch-knauf"></div><span class="vf-touch-hinweis">' + t('Lenken') + '</span></div>'
      + '<div class="vf-touch-gas"><div class="vf-touch-knauf"></div><span class="vf-touch-hinweis vf-touch-gas-oben">' + t('Gas') + '</span><span class="vf-touch-hinweis vf-touch-gas-unten">' + t('Bremse') + '</span></div></div>'
      + vfLadebildHtml((() => { try { return vfLadeKarteDrehen(vfLadeKarteSvg(tiles, frei ? frei.pts : null), window.innerWidth, window.innerHeight); } catch (e) { return ''; } })());
    schicht.classList.add('vf-laedt');
    document.body.appendChild(schicht);
    const cv = schicht.querySelector('canvas');
    const gl = cv.getContext('webgl', { antialias: true }) || cv.getContext('experimental-webgl');
    if (!gl) { schicht.remove(); showHudToast(t('Dieses Gerät kann kein WebGL')); return false; }
    // v1.5.154: OES_standard_derivatives (fwidth) fuer den bildschirm-adaptiven Schatten-PCF des Autos.
    // Ohne die Erweiterung bleibt der feste Kern; der Shader prueft das selbst ueber GL_OES_standard_derivatives.
    gl.getExtension('OES_standard_derivatives');
    // Verliert das Handy den Grafikkontext (Speicherdruck, App im Hintergrund), sauber beenden statt
    // mit toten Puffern weiterzuzeichnen. Wiederherstellen lohnt nicht: die Fahrt startet neu in Sekunden.
    cv.addEventListener('webglcontextlost', () => {
      if (!VF.aktiv || VF.cv !== cv) return;
      showHudToast(t('Grafik verloren: virtuelle Fahrt beendet'));
      virtuellBeenden();
    });
    try {
      VF.prog = vfProgramm(gl);
    } catch (e) { schicht.remove(); showHudToast('WebGL: ' + e.message); return false; }
    VF.loc = null; VF.lenkIst = 0; VF.kam = null; VF.himmelProg = null; VF.himmel = null;
    // Die Seite unter der 3D-Schicht ruht (kein Neuzeichnen); Startaufstellung, Ampel und Meldungen
    // kommen per CSS darueber (body.vf-an).
    document.body.classList.add('vf-an');
    gl.enable(gl.DEPTH_TEST);
    VF.gl = gl; VF.cv = cv; VF.schicht = schicht; VF.hud = schicht.querySelector('.vf-hud');
    VF.grafik = vfGrafikQual();   // v1.3.113: einmal je Fahrt, damit kein localStorage je Bild
    VF.wache = null; VF.letztRoh = 0;   // v1.5: Bildraten-Wache je Fahrt neu
    VF.tz = vfTageszeit();              // v1.5: Tageszeit je Fahrt einmal
    VF.dunstF = vfDunstFarbe(vfTz());   // v1.5.94 (G3)
    VF.sichtAn = vfSichtTempoAn();      // v1.5.94 (G7)
    VF.fovPlus = 0; VF.kerbJetzt = false; VF.umw = null; VF.umwKaputt = false;
    VF.physRest = 0;                     // v1.5.96 (V1)
    VF.lhV = 0;                          // v1.5.101 (H1)
    VF.bloom = null; VF.bloomKaputt = false;
    // v1.3.113 Quality: echte Schattenkarte (Depth-Textur) aus Richtung der Sonne. Ohne die
    // Erweiterung bleibt der weiche Blob-Schatten (M.schatten).
    VF.schatte = null; VF.schatteProg = null;
    if (VF.grafik) {
      // v1.3.124: 1024er Karte auf Desktop, 512er auf Touch (das Handy-GPU kann die 2048er Fill-Last nicht;
      // v1.5.141: nochmal halbiert, damit auch der Desktop ohne Ruckeln mitkommt - Performance-Modus hat
      // ohnehin keine Schatten). v1.5.152: auf Desktop 2048er Karte (feinere Texel, weichere Schattenkante auf
      // dem Auto); kleine Touch-Geraete bleiben bei 512. Faellt auf die jeweils kleinere Karte zurueck, wenn der
      // Framebuffer sonst unvollstaendig bleibt.
      try { const mobil = navigator.maxTouchPoints > 0 && Math.min(screen.width || 1024, screen.height || 768) < 700; const sz = mobil ? 512 : 2048; VF.schatte = vfSchattenBauen(gl, sz) || vfSchattenBauen(gl, sz / 2) || vfSchattenBauen(gl, sz / 4); VF.schatteProg = VF.schatte ? vfProgrammSchatten(gl) : null; } catch (e) { VF.schatte = null; VF.schatteProg = null; }
    }
    vfHudBauen(schicht);
    vfDrehNull(); VF.stick = null; VF.tasten = {};
    vfTouchBauen();   // v1.3.122: Beruehrungs-Steuerung (Touch), falls Geraet und kein Gamepad
    VF.splits = null; VF.besteSplits = null;
    VF.tiles = tiles;
    // Gezeichnet wird die volle Mittellinie (sonst klafft an der Schliessstelle ein Loch in der Bahn),
    // gefahren, gezaehlt und von den NPCs befahren die an der Schliessstelle gekuerzte: die freie Strecke
    // schliesst die Schleife mit einem letzten Punkt gleich dem ersten (vfSchliessstelle nimmt ihn ab).
    // Aus PR 4 von gnen54: die Schliessstelle auch bei gebauten Bahnen kuerzen ("Pendel der NPCs" an der
    // Startlinie: schliessen die Teile nicht genau, lief die Spur ein Stueck ueber den Start hinaus und sprang
    // zurueck, ein NPC fuhr dort hin und her).
    const ptsVoll = frei ? frei.pts : trackCenterline(tiles);
    VF.pts = vfSchliessstelle(ptsVoll);
    VF.nrm = trackNormals(VF.pts);
    vfHoeheVorbereiten();   // Bruecke (freie Strecke): Hoehe je Abschnitt, sonst VF.hoehe = null
    // v1.3.39: Flaechen mit Texturen (die Pixel entstehen nur beim ersten Mal) und der feste Platz der
    // Kamera "Fahrer am Rand".
    try { VF.flaeche = vfFlaechenBauen(gl, ptsVoll, ptsVoll === VF.pts ? VF.nrm : trackNormals(ptsVoll), tiles, VF.grafik); } catch (e) { schicht.remove(); document.body.classList.remove('vf-an'); showHudToast('WebGL: ' + e.message); return false; }
    // v1.5: Baeume in der Ferne, nur auf Rasen (ein Puffer, 6 Zahlen je Ecke wie die Farbmodelle).
    // v1.5.84: Boxenbucht je Punkt (Abseits, Randstein) und die Parkstriche.
    VF.boxBucht = vfBoxBucht(VF.pts, tiles); VF.boxStriche = null;
    try {
      // Freie Strecken haben statt der Carrera-Parkstriche ihre echte Boxengasse mit Steg (vfBahnGeometrie).
      const S = frei ? [] : vfBoxStriche(VF.pts, VF.nrm, tiles, VF.boxBucht);
      if (S.length) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(S), gl.STATIC_DRAW); VF.boxStriche = { b, n: S.length / 6 }; }
    } catch (e) { VF.boxStriche = null; }
    VF.baeume = null; VF.weh = null;
    if (VF.flaeche && VF.flaeche.art && VF.flaeche.art.art === 'rasen') {
      try { const B = vfBaeumeBauen(VF.pts); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(B.daten), gl.STATIC_DRAW); VF.baeume = { b, n: B.daten.length / 6 };
        // v1.5.94 (G4, nur Quality): Baeume und Grasbueschel wehen im Wind.
        if (VF.grafik) {
          const G = vfGrasBueschel(VF.pts, VF.nrm, VF.boxBucht ? VF.boxBucht.b : null);
          const bg = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bg); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(G.daten), gl.STATIC_DRAW);
          VF.weh = { prog: vfProgrammWehen(gl), baeume: vfWehPuffer(gl, B.daten, B.gewicht), gras: { b: bg, n: G.daten.length / 7 } };
        }
      } catch (e) { VF.baeume = VF.baeume || null; VF.weh = null; }
    }
    // Ziellinie und Startplatz in der gezeichneten Richtung; in der Gegenrichtung danach umgerechnet.
    const s = Math.max(0, VF.pts.findIndex((p) => p.tile >= 0 && tiles[p.tile] && tiles[p.tile].type === TILE_TYPE.START));
    let start = ((s - Math.round(TRACK_SAMPLES_PER_TILE / 2)) % VF.pts.length + VF.pts.length) % VF.pts.length;
    VF.zielIdx = vfZielIdx(VF.pts, tiles);
    VF.gegen = opts.gegen !== undefined ? !!opts.gegen : (vfGegenAn() && !opts.studie);
    if (VF.gegen) {
      const n = VF.pts.length, G = vfGegenrichtung(VF.pts, VF.boxBucht);
      const vorLinie = ((VF.zielIdx - start) % n + n) % n;   // so weit vor der Linie steht das Auto
      VF.pts = G.pts; VF.nrm = trackNormals(VF.pts); VF.boxBucht = G.bucht;
      VF.zielIdx = G.idx(VF.zielIdx);
      start = ((VF.zielIdx - vorLinie) % n + n) % n;
      vfHoeheVorbereiten();
    }
    VF.boxSeite = VF.gegen ? -VF_BOX_SEITE : VF_BOX_SEITE;
    VF.fahrer = { ort: vfFahrerOrt(VF.pts, VF.nrm, tiles), z: {}, k: null };
    try { VF.tv = { posten: vfTvPosten(VF.pts, VF.nrm, tiles), aktiv: -1, seit: 0, uhr: 0 }; } catch (e) { VF.tv = null; }
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
    VF.geist = { an: vfGeistAn(), aufzeichnung: [], beste: null, aktiv: false, zeit: 0, t: 0, i: 0, x: 0, y: 0, h: 0 };
    VF.modell = null; VF.modellFehl = false; VF.radModell = null; VF.radFehl = false; VF.P = vfHandlingProfil(VF_GT3); VF.feder = null; VF.raddreh = 0;
    VF.texOffen = 0; VF.texGesamt = 0;   // Ladebild: Bilder der Modelle dieser Fahrt
    VF.tyreTemp = 0;   // v1.3.5: jede Fahrt beginnt mit kalten Reifen (vorher blieb die alte Temperatur stehen)
    VF.tempoFaktor = vfTempoFaktor();
    // Quality-Autoshader, sonst (oder wenn er nicht kompiliert) der von Performance; ohne beide bleibt der Kasten.
    VF.tprog = null;
    if (VF.grafik) { try { VF.tprog = vfProgrammTex(gl, true); } catch (e) { VF.tprog = null; VF.qualFehler = String(e && e.message || e).slice(0, 300); log('Virtuell: Quality-Autoshader kompiliert nicht, Performance statt dessen: ' + VF.qualFehler, 'warn'); } }
    if (!VF.tprog) { try { VF.tprog = vfProgrammTex(gl, false); } catch (e) { VF.tprog = null; } }
    if (VF.tprog) {
      vfRadModellBauen(gl).then((rad) => { if (VF.aktiv && VF.gl === gl) VF.radModell = rad; }, () => { if (VF.gl === gl) VF.radFehl = true; });
      vfModellDaten().then((daten) => {
        if (!VF.aktiv || VF.gl !== gl) return;
        VF.modell = vfModellBauen(gl, daten);
        VF.P = vfHandlingProfil(vfPhysikAus(daten.meta.physik));
      }).catch(() => { if (VF.gl === gl) VF.modellFehl = true; showHudToast(t('Auto-Modell nicht ladbar – es fährt der Kasten')); });
    }
    // Start eine halbe Kachel vor Start/Ziel, in Fahrtrichtung (oben berechnet, auch fuer die Gegenrichtung).
    VF.zielVor = null; VF.zielRueck = 0; VF.zielAt = 0;
    VF.fort = 0; VF.fortVor = null;
    // Pflicht-Boxendurchfahrt (aus PR 4 von gnen54): Tiefe und Laenge der Bucht, gezaehlte Durchfahrten.
    { const bb = VF.boxBucht ? VF.boxBucht.b : null; let bm = 0;
      if (bb) for (let i = 0; i < bb.length; i++) bm = Math.max(bm, bb[i] || 0);
      VF.boxMax = bm; VF.boxN = bm > 0 ? Array.prototype.filter.call(bb, (x) => (x || 0) > bm * 0.5).length : 0;
      VF.boxDurch = 0; VF.boxBesucht = null; VF.inBox = false; }
    Object.assign(VF, { x: VF.pts[start].x, y: VF.pts[start].y, h: VF.pts[start].heading, idx: start, zaehler: 0, kachel: -2,
                        abseits: false, letzt: 0, kam: null, rundeAb: 0, letzte: null, beste: null, aktiv: true,
                        startX: VF.pts[start].x, startY: VF.pts[start].y, startH: VF.pts[start].heading });
    vfNpcStarten(gl, start);
    physEngine.state.speedKmh = 0;
    // Ladebild (siehe vfLadeSchritt): ab hier zaehlt die Ladezeit.
    VF.laedt = true; VF.ladeAb = performance.now();
    schicht.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vf]');
      if (!b) return;
      if (b.dataset.vf === 'zu' || b.dataset.vf === 'laden-zu') virtuellBeenden();
      else if (b.dataset.vf === 'leiste') vfLeisteUmschalten();
      else if (b.dataset.vf === 'reset') vfZuruecksetzen();
      else if (b.dataset.vf === 'kam') vfKameraWechseln();
      else if (b.dataset.vf === 'paddiag') vfPadDiagUmschalten();
      else if (b.dataset.vf === 'touch') vfTouchUmschalten();
      else if (b.dataset.vf === 'box') {
        if (VF.modus === 'derby') showHudToast(t('Derby: kein Boxenstopp'));
        else if (typeof requestPitStop === 'function') { requestPitStop(); if (typeof pitState !== 'undefined' && pitState === 'limited') showHudToast(t('Boxenstopp: anhalten')); }
      }
      else if (b.dataset.vf === 'flag') {
        if (typeof flagState !== 'undefined' && flagState === 'green') { if (typeof setFlag === 'function') setFlag('yellow'); }
        else if (typeof yellowRestart === 'function') yellowRestart();
      }
      else if (b.dataset.vf === 'wetter') vfWetterKnopf();
      else if (b.dataset.vf === 'licht') {
        // Dasselbe wie Dreieck im Cockpit: der Schalter im Armaturenbrett bleibt gleich.
        headlightsOn = !headlightsOn;
        const cb = $('dash-head-toggle');
        if (cb) cb.checked = headlightsOn;
        showHudToast(t(headlightsOn ? 'Licht an' : 'Licht aus'));
      }
    });
    VF.dyn = { vy: 0, r: 0 };
    // Rennmodus: Runden, Endurance, Qualifying und Training werden uebernommen; seit v1.3.95 auch
    // Time Attack (bestzeit), NPC-Knockout und Derby - mit eigener Wertung fuer die virtuellen NPCs
    // (die Geister-Wertung aus 90-ghosts/90d-challenger greift hier nicht).
    VF.modus = raceMode;
    if (VF.modus !== 'laps' && VF.modus !== 'endurance' && VF.modus !== 'qualifying' && VF.modus !== 'practice'
        && VF.modus !== 'bestzeit' && VF.modus !== 'knockout' && VF.modus !== 'derby') {
      showHudToast(t('Rennmodus im virtuellen Fahren nicht verfügbar') + ' – ' + t('Training'));
      VF.modus = 'practice';
    }
    const md = (typeof RACE_MODES !== 'undefined') ? RACE_MODES[VF.modus] : null;
    VF.limit = VF.modus === 'laps' ? Math.max(1, raceLimit)
             : (md && md.timed) ? Math.max(1, raceLimit)
             : VF.modus === 'derby' ? Math.max(0, raceLimit)   // 0 = letzter auf der Bahn
             : 0;
    VF.runden = 0;
    VF.modusZeit = 0;
    VF.rennenEnde = false;
    VF.kollisionsBis = 0;
    // Schaden und Flagge gehoeren dem echten Fahren: beim Start merken, die virtuelle Fahrt beginnt
    // heil, und virtuellBeenden stellt beides wieder her (bis 1.3.131 loeschte der Start den echten
    // Schaden, und virtuelle Zusammenstoesse blieben danach im Cockpit stehen).
    VF.schadenVorher = (typeof damage === 'number') ? damage : null;
    // Akku (aus PR 4 von gnen54): das virtuelle Auto meldet ueber seine Pakete einen Rohwert, der danach in
    // dashBattery stehen blieb - nach dem Beenden kam dann "Session abbrechen, Box anfahren!".
    VF.akkuVorher = (typeof dashBattery === 'undefined') ? null : dashBattery;
    VF.flaggeVorher = (typeof flagState !== 'undefined') ? flagState : null;
    // v1.5.90 BESTELLT: virtuell faehrt man ab Werk ohne Licht ("Licht" oben schaltet es an). Der Schalter des echten
    // Fahrens kommt beim Beenden zurueck.
    VF.lichtVorher = (typeof headlightsOn === 'undefined') ? null : headlightsOn;
    if (VF.lichtVorher !== null) { headlightsOn = false; const cbL = $('dash-head-toggle'); if (cbL) cbL.checked = false; }
    if (typeof damage === 'number') damage = 0;
    vfRennEinstellungen();
    // Zustand der virtuellen Wertung (derby/knockout): Spieler und NPCs.
    VF.koLeben = 3;
    VF.derbyHealth = 100;
    VF.derbyKills = 0;
    VF.derbyTot = false;
    for (const npc of (VF.npcs || [])) {
      npc.koLeben = 3; npc.koAus = false;
      npc.derbyHealth = 100; npc.derbyKills = 0; npc.derbyAus = false;
    }
    if (VF.modus === 'knockout') showHudToast(t('NPC-Knockout') + ': ' + (VF.npcs ? VF.npcs.length : 0) + ' ' + t('Gegner') + ' · 3 ' + t('Leben'));
    else if (VF.modus === 'derby') showHudToast(t('Derby') + ': ' + (VF.npcs ? VF.npcs.length : 0) + ' ' + t('Gegner') + ' · ' + t('Health') + ' 100');
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
    if (vfMotorFest()) return vfMotorFest();
    const def = ({ v5r: 'sd_v5r', lynx220: 'sd_lynx', fmcgt4: 'sd_fmc', boxer96: 'sd_boxer', kaefer: 'boxster986', spider: 'listerstorm', caravelle: 'boxster986' })[vfAutoWahl()] || 'sd_v5r';
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
    if (vfMotorFest()) {
      // Eigenbau von Gnen54: Motorklang fest zum Auto, die Pfeile sind gesperrt.
      const fest = garWertZeile(t('Motorsound'), werte[j].name + ' (' + t('fest zum Auto') + ')', () => {}, () => {});
      fest.dataset.vfMotorFest = '1';
      fest.querySelectorAll('button').forEach((k) => { k.disabled = true; k.style.visibility = 'hidden'; });
      rechts.appendChild(fest);
    } else rechts.appendChild(garWertZeile(t('Motorsound'), werte[j].name, () => wahl(-1), () => wahl(1)));
    // v1.1.9: welches Auto, und wie deutlich die Federung sichtbar neigt.
    const autos = [{ v: 'v5r', name: 'Vulture V5.R (Speed Dreams)' }, { v: 'lynx220', name: 'Lynx 220 (Jaguar XJ220, Speed Dreams)' },
                   { v: 'fmcgt4', name: 'FMC GT4 (Ford GT40 Mk1, Speed Dreams)' }, { v: 'boxer96', name: 'Boxer 96 (Porsche 911 GT3, Speed Dreams)' },
                   // Eigenbau von Gnen54 (CC BY 4.0), WIP: Fahrdaten geschaetzt, siehe img/autos/kaefer/LIZENZ.txt
                   { v: 'kaefer', name: t('VW Käfer 1303 RS mit Boxster-Motor (Gnen54, WIP)') },
                   // v1.5.104: Eigenbau von Gnen54 auf der Modiplay-MP1-Karosserie (Freigabe Sturmkind, nicht kommerziell),
                   // PR 3 auf Luuke42/omegasim. WIP: Fahrdaten geschaetzt (Lister Storm LMP), siehe img/autos/spider/LIZENZ.txt
                   { v: 'spider', name: t('Spider NG1 (Gnen54, WIP)') },
                   // v1.5.150: Eigenbau von Gnen54 auf der Vehicle-World-Karosserie (schriftliche Freigabe),
                   // siehe img/autos/caravelle/LIZENZ.txt. WIP: Fahrdaten geschaetzt.
                   { v: 'caravelle', name: t('VW Caravelle Oettinger (Gnen54, WIP)') }];
    const ja = Math.max(0, autos.findIndex((a) => a.v === vfAutoWahl()));
    const autoWahl = (dd) => {
      try { localStorage.setItem(VF_AUTO_STORE, autos[(ja + dd + autos.length) % autos.length].v); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Auto'), autos[ja].name, () => autoWahl(-1), () => autoWahl(1)));
    // v1.5.10 (WIP): Vorschau des gewaehlten Autos (Seitenansicht in der Originalfarbe) und die Lackfarbe.
    // Die Vorschau ist ein Bild je Auto (img/autos/<modell>/vorschau.jpg, tools/vorschau_bilder.py);
    // fehlt ein Bild, verschwindet die Zeile still.
    {
      const jl = Math.max(0, VF_LACK_FARBEN.findIndex((f) => f.v === vfLack()));
      const lackWahl = (dd) => { vfLackSetzen(VF_LACK_FARBEN[(jl + dd + VF_LACK_FARBEN.length) % VF_LACK_FARBEN.length].v); renderGarage(); };
      const zeile = garWertZeile(t('Lackfarbe'), t(VF_LACK_FARBEN[jl].n), () => lackWahl(-1), () => lackWahl(1));
      zeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
      const palette = document.createElement('span');
      palette.className = 'vf-lack-palette';
      VF_LACK_FARBEN.forEach((f, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vf-lack' + (i === jl ? ' aktiv' : '');
        b.style.background = f.v || 'linear-gradient(135deg,#c8102e 0%,#0057b8 50%,#e8e8e8 100%)';
        b.title = t(f.n); b.setAttribute('aria-label', t(f.n));
        b.onclick = (e) => { e.stopPropagation(); vfLackSetzen(f.v); renderGarage(); };
        palette.appendChild(b);
      });
      zeile.querySelector('.gk-w').appendChild(palette);
      const vor = document.createElement('div');
      vor.className = 'opt-row opt-breit vf-vorschau';
      const img = document.createElement('img');
      img.className = 'vf-vorschau-bild';
      img.alt = autos[ja].name;
      img.src = vfModellPfad(autos[ja].v) + 'vorschau.jpg';
      img.onerror = () => { vor.remove(); };
      vor.appendChild(img);
      rechts.appendChild(vor);
      rechts.appendChild(zeile);
    }
    // v1.3.39 (WIP): der Fussboden unter der Bahn, Dielen in echten Massen (siehe VF_BOEDEN).
    const jb = Math.max(0, VF_BOEDEN.findIndex((b) => b.id === vfBodenWahl()));
    const bodenWahl = (dd) => { vfBodenSetzen(VF_BOEDEN[(jb + dd + VF_BOEDEN.length) % VF_BOEDEN.length].id); renderGarage(); };
    const bodenZeile = garWertZeile(t('Boden'), t(VF_BOEDEN[jb].name), () => bodenWahl(-1), () => bodenWahl(1));
    bodenZeile.dataset.vfBoden = '1';
    bodenZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    rechts.appendChild(bodenZeile);
    // v1.5.150: freie Strecke (Törnerschleife, nur virtuell) oder die gebaute Bahn des Editors.
    const freiListe = ['', ...Object.keys(VF_FREIE)];
    const jf = Math.max(0, freiListe.indexOf(vfFreiWahl()));
    const freiWahl = (dd) => {
      const ni = (jf + dd + freiListe.length) % freiListe.length;
      try { localStorage.setItem(VF_STRECKE_STORE, freiListe[ni]); } catch (e) { /* egal */ }
      if (freiListe[ni]) vfFreiLaden(freiListe[ni]).catch(() => {});   // schon vorladen (aus PR 4 von gnen54)
      renderGarage();
    };
    // Aus PR 4 von gnen54: beide Toernerschleifen (mit und ohne Bruecke) sind waehlbar.
    const freiZeile = garWertZeile(t('Strecke'), freiListe[jf] ? t(VF_FREIE[freiListe[jf]].name) + ' (' + t('nur virtuell') + ')' : t('Gebaute Bahn'), () => freiWahl(-1), () => freiWahl(1));
    freiZeile.dataset.vfStrecke = '1';
    freiZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    rechts.appendChild(freiZeile);
    // Fahrtrichtung (BESTELLT, WIP): die Strecke andersherum fahren, siehe vfGegenrichtung.
    {
      const gegen = vfGegenAn();
      const rWahl = () => { try { localStorage.setItem(VF_RICHTUNG_STORE, gegen ? 'normal' : 'gegen'); } catch (e) { /* egal */ } renderGarage(); };
      const rZeile = garWertZeile(t('Fahrtrichtung'), gegen ? t('Gegenrichtung') : t('Normal'), rWahl, rWahl);
      const rL = rZeile.querySelector('.gk-l');
      rL.classList.add('opt-label');
      rL.insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span><small>' + t('Die Strecke andersherum fahren. Ziellinie, Sektoren und Boxengasse bleiben an ihrem Platz.') + '</small>');
      rZeile.dataset.feld = 'richtung';
      rechts.appendChild(rZeile);
    }
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
    // Grafik: Performance (wie bisher, fuer schwache Handys) oder Quality (Schatten, Tonemapping,
    // besseres Licht, Vignette).
    const gId = vfGrafik();
    const gWahl = () => { vfGrafikSetzen(gId === 'perf' ? 'qual' : 'perf'); renderGarage(); };
    const grafikZeile = garWertZeile(t('Grafik'), t(vfGrafik() === 'perf' ? 'Performance' : 'Quality'), gWahl, gWahl);
    grafikZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    rechts.appendChild(grafikZeile);
    // v1.5 (WIP): Tageszeit (Farbstimmung), in Performance und Quality.
    const tzA = VF_TAGESZEITEN.indexOf(vfTageszeit());
    const tzWahl = (d) => { vfTageszeitSetzen(VF_TAGESZEITEN[(tzA + d + VF_TAGESZEITEN.length) % VF_TAGESZEITEN.length].id); renderGarage(); };
    const tzZeile = garWertZeile(t('Tageszeit'), t(VF_TAGESZEITEN[tzA].name), () => tzWahl(-1), () => tzWahl(1));
    tzZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    tzZeile.dataset.feld = 'tageszeit';
    rechts.appendChild(tzZeile);
    // v1.5.94 (G7) BESTELLT: abschaltbar. Erklaerung im (i).
    const sichtAn = vfSichtTempoAn();
    const sichtWahl = () => { try { localStorage.setItem(VF_SICHT_STORE, sichtAn ? 'aus' : 'an'); } catch (e) { /* egal */ } renderGarage(); };
    const sichtZeile = garWertZeile(t('Sichtfeld mit Tempo'), sichtAn ? t('An') : t('Aus'), sichtWahl, sichtWahl);
    const sichtL = sichtZeile.querySelector('.gk-l');
    sichtL.classList.add('opt-label');
    sichtL.insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span><small>' + t('Das Sichtfeld wird mit dem Tempo weiter, auf Randsteinen wackelt das Bild leicht (Verfolger- und Motorhaubenkamera).') + '</small>');
    sichtZeile.dataset.feld = 'sicht-tempo';
    rechts.appendChild(sichtZeile);   // das (i) richtet renderGarage ein, sobald die Zeile im Dokument steht
    // Geist: eine Kopie faehrt nach der ersten Runde die aufgezeichnete Linie ab (Standard an).
    const geistAn = vfGeistAn();
    const geistWahl = () => {
      try { localStorage.setItem(VF_GEIST_STORE, geistAn ? 'aus' : 'an'); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('Geist folgt meiner Linie'), geistAn ? t('An') : t('Aus'), geistWahl, geistWahl));
    // Rueckspiegel in der Motorhauben-Kamera (aus PR 4 von gnen54, Standard aus).
    {
      const spAn = vfSpiegelAn();
      const spWahl = () => { try { localStorage.setItem(VF_SPIEGEL_STORE, spAn ? 'aus' : 'an'); } catch (e) { /* egal */ } renderGarage(); };
      const spZeile = garWertZeile(t('Rückspiegel (Motorhaube)'), spAn ? t('An') : t('Aus'), spWahl, spWahl);
      const spL = spZeile.querySelector('.gk-l');
      spL.classList.add('opt-label');
      spL.insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span><small>' + t('In der Kamera Motorhaube ein schmaler Rückspiegel ganz oben am Bildrand, beim offenen Spider zwei kleine Außenspiegel. Kostet etwas Bildrate.') + '</small>');
      spZeile.dataset.feld = 'spiegel';
      rechts.appendChild(spZeile);
    }
    // Neben der Bahn: Vorgabe bremst der Teppich. Die Option schaltet den Tempoverlust ab, das Auto
    // faehrt daneben ungebremst weiter (Standard Aus = wie bisher).
    const abseitsBremse = vfAbseitsBremseAn();
    const abseitsWahl = () => {
      try { localStorage.setItem(VF_ABSEITS_BREMSE_STORE, abseitsBremse ? 'aus' : 'an'); } catch (e) { /* egal */ }
      renderGarage();
    };
    const abseitsZeile = garWertZeile(t('Kein Tempoverlust neben der Bahn'), abseitsBremse ? t('Aus') : t('An'), abseitsWahl, abseitsWahl);
    abseitsZeile.querySelector('.gk-l').insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span>');
    rechts.appendChild(abseitsZeile);
    // NPCs: wie viele andere Autos mitfahren (0-3), zufaellige Skins aus den echten Modellen.
    const nNpc = vfNpcAnzahl();
    const npcWahl = (dd) => {
      try { localStorage.setItem(VF_NPC_STORE, String(Math.max(0, Math.min(3, nNpc + dd)))); } catch (e) { /* egal */ }
      renderGarage();
    };
    rechts.appendChild(garWertZeile(t('NPCs'), nNpc === 0 ? t('Aus') : String(nNpc), () => npcWahl(-1), () => npcWahl(1)));
    // Pflicht-Boxendurchfahrt im Rennen (Runden, Langstrecke): Aus, 1, 2 oder 3 (aus PR 4 von gnen54).
    {
      const pfl = vfPflichtBox();
      const pflWahl = (d) => { try { localStorage.setItem(VF_PFLICHTBOX_STORE, String((pfl + d + 4) % 4)); } catch (e) { /* egal */ } renderGarage(); };
      const pflZeile = garWertZeile(t('Pflicht-Boxendurchfahrt'), pfl ? String(pfl) : t('Aus'), () => pflWahl(-1), () => pflWahl(1));
      const pflL = pflZeile.querySelector('.gk-l');
      pflL.classList.add('opt-label');
      pflL.insertAdjacentHTML('beforeend', ' <span class="wip-tag">WIP</span><small>' + t('Im Rennen nach Runden oder auf Zeit muss so oft durch die Boxengasse gefahren werden. Jede fehlende Durchfahrt kostet die Strafzeit aus den Renneinstellungen.') + '</small>');
      pflZeile.dataset.feld = 'pflicht-box';
      rechts.appendChild(pflZeile);
    }
    {
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
    // Anleitung zum virtuellen Fahren (aus PR 4 von gnen54): Knopf "?" neben Losfahren, oeffnet
    // hilfe/virtuelles-fahren.html als Fenster ueber der Garage.
    const hilfe = document.createElement('button');
    hilfe.type = 'button';
    hilfe.className = 'vf-hilfe';
    hilfe.dataset.vf = 'hilfe';
    hilfe.textContent = '?';
    hilfe.title = t('Anleitung virtuelles Fahren');
    hilfe.setAttribute('aria-label', t('Anleitung virtuelles Fahren'));
    hilfe.onclick = () => vfHilfeZeigen();
    z.classList.add('vf-los-zeile');
    z.appendChild(hilfe);
    rechts.appendChild(z);
  }
  // Anleitung als Fenster ueber der Garage (aus PR 4 von gnen54: "moechte ich gleich wieder an den Punkt zum virtuellen
  // Fahren zurueckkommen") statt eines neuen Tabs: x oben rechts, Esc oder ein Klick daneben schliesst.
  function vfHilfeZeigen() {
    if (document.querySelector('.vf-hilfe-fenster')) return null;
    const hg = document.createElement('div');
    hg.className = 'vf-hilfe-fenster';
    hg.setAttribute('role', 'dialog');
    hg.setAttribute('aria-modal', 'true');
    hg.setAttribute('aria-label', t('Anleitung virtuelles Fahren'));
    const box = document.createElement('div');
    box.className = 'vf-hilfe-box';
    const fr = document.createElement('iframe');
    fr.src = 'hilfe/virtuelles-fahren.html';
    fr.title = t('Anleitung virtuelles Fahren');
    const zu = document.createElement('button');
    zu.type = 'button';
    zu.className = 'vf-hilfe-zu';
    zu.textContent = '✕';
    zu.setAttribute('aria-label', t('Schließen'));
    zu.title = t('Schließen');
    const nachricht = (e) => { if (e.source === fr.contentWindow && e.data === 'vf-hilfe-zu') schliessen(); };
    const taste = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); schliessen(); } };
    const schliessen = () => { hg.remove(); document.removeEventListener('keydown', taste, true); window.removeEventListener('message', nachricht); };
    window.addEventListener('message', nachricht);
    document.addEventListener('keydown', taste, true);
    zu.onclick = schliessen;
    hg.addEventListener('click', (e) => { if (e.target === hg) schliessen(); });
    box.appendChild(fr); box.appendChild(zu); hg.appendChild(box);
    document.body.appendChild(hg);
    zu.focus();
    return hg;
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
    VF.frei = undefined;
    VF_BOX_SEITE = -1;   // zurueck auf die Editor-Boxenseite (rechts)
    VF.hoehe = null;
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
    VF.laedt = false;
    VF.npcs = null; VF.npcBogen = null; VF.npcRunde = 0;
    VF.schatte = null; VF.schatteProg = null; VF.grafik = false; VF.regen = null; VF.schleier = null;
    // Was die virtuelle Fahrt am echten Fahren veraendert hat, zuruecknehmen: Schaden wie beim Start,
    // eine hier gesetzte gelbe Flagge (Knopf "Gelbe Flagge") aufheben, gehaltene Touch-Eingaben loslassen
    // (die Schicht verschwindet, ein pointerup kaeme nie mehr) und keine dreckige Luft mitnehmen.
    if (VF.schadenVorher !== null && VF.schadenVorher !== undefined && typeof damage === 'number') {
      damage = VF.schadenVorher;
      if (typeof updateDamageFuelUI === 'function') { try { updateDamageFuelUI(); } catch (e) { /* egal */ } }
    }
    VF.schadenVorher = null;
    if (typeof dashBattery !== 'undefined' && VF.akkuVorher !== undefined) dashBattery = VF.akkuVorher;
    VF.akkuVorher = undefined;
    vfRennEinstellungenZurueck();
    if (VF.flaggeVorher === 'green' && typeof flagState !== 'undefined' && flagState !== 'green') {
      try {
        if (typeof gelbBeenden === 'function') gelbBeenden();
        if (typeof safetyCarHeim === 'function') safetyCarHeim();
      } catch (e) { /* weiter */ }
    }
    VF.flaggeVorher = null;
    if (VF.lichtVorher !== null && VF.lichtVorher !== undefined && typeof headlightsOn !== 'undefined') {
      headlightsOn = VF.lichtVorher; const cbL = $('dash-head-toggle'); if (cbL) cbL.checked = headlightsOn;
    }
    VF.lichtVorher = null;
    try { releaseInput(SRC.TOUCH); } catch (e) { /* egal */ }
    if (physEngine && physEngine.state) { physEngine.state.dirtyAir = 0; physEngine.state.vfNutzung = 0; }
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
    // v1.3.66 BESTELLT: "Wenn ich aus dem virtuellen Fahren zurueckkomme, das Auto-Tempo auf 0 km/h
    // zuruecksetzen." Die Fahrphysik ist dieselbe wie im Cockpit; ohne Reset stand dort noch das
    // Tempo (und der Gang) der virtuellen Fahrt, bis das echte Auto sich bewegte.
    if (typeof physEngine !== 'undefined' && physEngine && typeof physEngine.reset === 'function') physEngine.reset();
    if (VF.schicht) VF.schicht.remove();
    // v1.5.159 (Latenz/Speicher): den Grafikkontext sofort abgeben (GPU-Puffer und Texturen frei) und die Texturdaten
    // und Automodelle im JS-Speicher nach VF_FREIGABE_MS freigeben, wenn keine neue Fahrt beginnt. Bis 1.5.158 blieben
    // sie fuer schnelle Neustarts liegen (Bahn 16 MB, Rasenatlas 8 MB, Randstreifen 4 MB, je Automodell bis 45 MB) und
    // belegten beim echten Fahren Speicher - mit wenig freiem Speicher stockte dann der Sendetakt.
    try { const ext = VF.gl && VF.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* egal */ }
    clearTimeout(vfFreigabeTimer);
    vfFreigabeTimer = setTimeout(vfSpeicherFreigeben, VF_FREIGABE_MS);
    vfSpiegelRahmen(null);
    VF.schicht = null; VF.gl = null; VF.flaeche = null; VF.baeume = null; VF.weh = null; VF.umw = null; VF.boxStriche = null; VF.boxBucht = null; VF.fahrer = null; VF.tv = null; VF.ui = null; VF.wetterKnopf = null; VF.stick = null; VF.tasten = {};
    renderGarage();
    // Zurueck in die Garage, wo die Optionen der virtuellen Fahrt stehen (dort startet die naechste).
    // Eine Studienfahrt geht zurueck in die Studie (98f-studie.js zeigt sie selbst).
    if (!VF.studie && typeof showTab === 'function') showTab('garage');
    VF.studie = false;
  }
  window.addEventListener('keydown', (e) => { if (VF.aktiv && e.key === 'Escape') { e.stopImmediatePropagation(); virtuellBeenden(); } }, true);
