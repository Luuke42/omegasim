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
  // Die Fahrbahn aus der Mittellinie. Koordinaten: x = Karten-x, z = Karten-y, y nach oben.
  function vfBahnBauen(gl, pts, nrm, tiles) {
    const a = [];
    const half = TRACK_HALF_W, rand = TRACK_HALF_W * 2 * 0.095;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const m = 600;
    vfQuad(a, [minX - m, minY - m], [maxX + m, minY - m], [maxX + m, maxY + m], [minX - m, maxY + m], -0.05, [0.17, 0.19, 0.22]);
    const off = (i, d) => [pts[i].x + nrm[i].x * d, pts[i].y + nrm[i].y * d];
    for (let i = 0; i < pts.length - 1; i++) {
      vfQuad(a, off(i, half), off(i + 1, half), off(i + 1, -half), off(i, -half), 0, [0.07, 0.08, 0.10]);
      const weiss = Math.floor(i / 2) % 2 === 0;
      vfQuad(a, off(i, half + rand), off(i + 1, half + rand), off(i + 1, half), off(i, half), 0.02, weiss ? [0.93, 0.94, 0.96] : [0.10, 0.45, 0.95]);
      vfQuad(a, off(i, -half), off(i + 1, -half), off(i + 1, -half - rand), off(i, -half - rand), 0.02, weiss ? [0.93, 0.94, 0.96] : [0.88, 0.12, 0.14]);
      // Teilegrenze: duenner weisser Strich quer ueber die Bahn
      if (pts[i + 1].tile !== pts[i].tile) {
        const t0 = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 1;
        const tx = (pts[i + 1].x - pts[i].x) / t0 * 0.35, ty = (pts[i + 1].y - pts[i].y) / t0 * 0.35;
        const p = off(i + 1, half), q = off(i + 1, -half);
        const istStart = tiles[pts[i + 1].tile] && tiles[pts[i + 1].tile].type === TILE_TYPE.START;
        const w = istStart ? 6 : 1;
        vfQuad(a, [p[0] - tx * w, p[1] - ty * w], [p[0] + tx * w, p[1] + ty * w], [q[0] + tx * w, q[1] + ty * w], [q[0] - tx * w, q[1] - ty * w], 0.03,
          istStart ? [0.95, 0.95, 0.95] : [0.55, 0.57, 0.62]);
      }
    }
    return vfPuffer(gl, a);
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
  const VF_NPC_STORE = 'omegasim-vf-npc';
  const VF_NPC_POOL = ['v5r', 'fmcgt4', 'boxer96', 'lynx220'];
  const VF_NPC_BASE = 3.2;    // Zieltempo auf der Geraden (Modell-km/h; Anzeige mal TACHO_SCALE)
  const VF_NPC_ACC = 2.5;     // Beschleunigung auf das Zieltempo (Modell-km/h je Sekunde)
  const VF_NPC_BREMS = 6.0;   // Abbremsen auf das Zieltempo (Modell-km/h je Sekunde)
  function vfNpcAnzahl() {
    try { const v = +localStorage.getItem(VF_NPC_STORE); return (v >= 0 && v <= 3) ? v : 3; } catch (e) { return 3; }
  }
  // Handling-Modus (v1.1.52): das Fahrmodell wie in ACC, und eine zweite, insgesamt schnellere
  // Abstimmung. "GT3" bleibt das praezise Modell aus den Autodaten; "Schnell" gibt mehr Grip
  // (muV/muH), mehr Einschlag (lenkGrad), eine schnellere Gierantwort (weniger Daempfung) und ein
  // hoeheres Tempo (Weg und Tacho, Faktor vfTempoFaktor).
  const VF_HANDLING_STORE = 'omegasim-vf-handling';
  const VF_HANDLING_MODI = [{ id: 'gt3', name: 'GT3' }, { id: 'schnell', name: 'Schnell' }];
  function vfHandling() {
    try { const v = localStorage.getItem(VF_HANDLING_STORE); return VF_HANDLING_MODI.some((m) => m.id === v) ? v : 'gt3'; } catch (e) { return 'gt3'; }
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
  // Ein NPC-Schritt (rein, fuer den Selbsttest): Tempo nach der Kurvigkeit voraus, dann auf der
  // Mittellinie weiter. Liefert die neue Lage und die Zielgroessen zum Zeichnen.
  function vfNpcSteuern(npc, dt, pts, nrm, bogen, runde) {
    const n = pts.length;
    const i = npc.idx;
    let dMax = 0, vorher = pts[i].heading;
    const W = 18;
    for (let k = 1; k <= W; k++) {
      const j = (i + k) % n;
      let dh = pts[j].heading - vorher;
      dh = ((dh + 540) % 360) - 180;
      if (Math.abs(dh) > Math.abs(dMax)) dMax = dh;
      vorher = pts[j].heading;
    }
    const kappa = Math.abs(dMax) / 2.86;
    const ziel = VF_NPC_BASE * Math.max(0.3, 1 - kappa / 4.5 * 0.7) * npc.faktor;
    if (npc.kmh < ziel) npc.kmh = Math.min(ziel, npc.kmh + VF_NPC_ACC * dt);
    else npc.kmh = Math.max(ziel, npc.kmh - VF_NPC_BREMS * dt);
    const vE = npc.kmh / 3.6 * 100 * TRACK_UNITS_PER_CM;
    npc.s = (((npc.s + vE * dt) % runde) + runde) % runde;
    let j = npc.idx;
    while (j < n - 1 && bogen[j + 1] <= npc.s) j++;
    while (j > 0 && bogen[j] > npc.s) j--;
    npc.idx = j;
    const p = pts[j], q = pts[(j + 1) % n], nr = nrm[j];
    npc.x = p.x + nr.x * npc.offset;
    npc.y = p.y + nr.y * npc.offset;
    npc.h = Math.atan2(q.x - p.x, -(q.y - p.y)) * 180 / Math.PI;
    npc.raddreh = ((npc.raddreh || 0) + vE / (VF_AUTO.L / 4.64 * 0.335)) % (Math.PI * 2);
    let dH = npc.h - (npc.vorherH === undefined ? npc.h : npc.vorherH);
    dH = ((dH + 540) % 360) - 180;
    npc.vorherH = npc.h;
    const yaw = dt > 0 ? dH * Math.PI / 180 / dt : 0;
    const vReal = npc.kmh * REAL_SCALE / 3.6;
    npc.ay = vReal * yaw;
    npc.ax = 0;
    const dSeg = Math.max(-1, Math.min(1, dMax / 8));
    npc.lenkWinkel = dSeg * (npc.P ? npc.P.lenkGrad : 21) * Math.PI / 180;
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
        auto, modell: null, P: null, idx: startIdx, s: bogen.bogen[startIdx], kmh: 0,
        offset: [3.0, -3.0, 0.0][k] || 0,
        faktor: 0.97 + 0.03 * k,
        x: 0, y: 0, h: 0, raddreh: 0, lenkWinkel: 0, ay: 0, ax: 0, vorherH: undefined,
        feder: { z: 0, vz: 0, th: 0, vth: 0, ph: 0, vph: 0 },
      };
      vfNpcSteuern(npc, 0, VF.pts, VF.nrm, VF.npcBogen, VF.npcRunde);
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
    if (!P || vfHandling() !== 'schnell') return P;
    return Object.assign({}, P, {
      muV: P.muV * 1.35,
      muH: P.muH * 1.35,
      lenkGrad: Math.min(45, P.lenkGrad * 1.5),
      yawDamp: (P.yawDamp || 1.5) * 0.6,
    });
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
    if (!VF.aktiv || !VF.car) return;
    const tile = Math.max(0, VF.pts[VF.idx].tile);
    if (tile !== VF.kachel) {
      if (VF.kachel !== -2) VF.zaehler = (VF.zaehler + 1) & 0xff;
      const vorher = VF.kachel;
      VF.kachel = tile;
      // Eigene Rundenanzeige fuer die Kopfzeile (die Zeitnahme selbst laeuft in der App).
      if (vorher !== -2 && VF.tiles[tile] && VF.tiles[tile].type === TILE_TYPE.START && !VF.abseits) {
        const jetzt = Date.now();
        if (VF.rundeAb) {
          VF.letzte = jetzt - VF.rundeAb;
          if (VF.beste === null || VF.letzte < VF.beste) VF.beste = VF.letzte;
          // Nach der ersten Runde beginnt der Geist, die aufgezeichnete Linie abzufahren.
          if (VF.geist && !VF.geist.aktiv) { VF.geist.aktiv = true; VF.geist.zeit = 0; VF.geist.i = 0; }
          // Rundenrennen: nach der Ziel-Lap ist Schluss.
          VF.runden = (VF.runden || 0) + 1;
          if (VF.modus === 'laps' && VF.runden >= VF.limit) vfRennenEnde();
        }
        VF.rundeAb = jetzt;
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
      vfDynamik(VF.dyn, vVoll, ax, Math.max(0, st.longUse || 0), lenk, dt,
        (physEngine.config.gripScale || 1) * (VF.abseits ? 0.55 : 1), VF.P);
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
    const ab = Math.abs(o.quer) > TRACK_HALF_W * 1.19 + VF_AUTO.B * 0.3;
    if (ab && !VF.abseits) VF.abseitsSeit = Date.now();
    VF.abseits = ab;
    if (ab) {
      st.speedKmh *= Math.exp(-VF_ABSEITS_BREMSE * dt);
      if (Date.now() - VF.abseitsSeit > VF_ABSEITS_ZURUECK_MS) vfZuruecksetzen();
    }
    // NPCs: folgen der Mittellinie und drosseln in Kurven.
    if (VF.npcs && VF.npcBogen) {
      for (const npc of VF.npcs) {
        vfNpcSteuern(npc, dt, VF.pts, VF.nrm, VF.npcBogen, VF.npcRunde);
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
    setTimeout(() => { if (VF.aktiv) virtuellBeenden(); }, 1600);
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
    const pv = vfMal(vfPerspektive(k.fov * Math.PI / 180, w / Math.max(1, h), k.nah, 3000), blick);
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
    zeichne(VF.bahn, VF_EINS);
    gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
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
        vfModellZeichnen(gl, pv, blick, npc.modell, VF.tprog, npc.x, npc.y, npc.h, npc.feder, npc.lenkWinkel, npc.raddreh, VF.radModell, true, false, 1);
      }
    }
  }
  // ---- Kamera (v1.1.11) --------------------------------------------------------------------
  // BESTELLT: "Wenn ich den rechten Stick reindruecke im virtuellen Fahren, aendere die Kamera zu
  // Motorhaube oder nahe Verfolgerkamera." R3 (bzw. die Lichthupen-Belegung) oder C schaltet weiter:
  // Verfolger -> nah -> Motorhaube -> Verfolger. Nachgefuehrt nach der ZEIT (nicht je Bild): auf einem
  // langsamen Handy lief die Kamera vorher bei weniger Bildern spuerbar hinterher.
  const VF_KAMERAS = [{ id: 'verfolger', name: 'Verfolgerkamera' }, { id: 'nah', name: 'Nahe Verfolgerkamera' }, { id: 'haube', name: 'Motorhaube' },
                      { id: 'oben', name: 'Von oben (Start/Ziel)' }, { id: 'statisch', name: 'Statisch (Start/Ziel)' }];
  const VF_KAMERA_STORE = 'omegasim-vf-kamera';
  function vfKameraId() {
    if (!VF.kamera) { try { VF.kamera = localStorage.getItem(VF_KAMERA_STORE) || 'verfolger'; } catch (e) { VF.kamera = 'verfolger'; } }
    return VF_KAMERAS.some((k) => k.id === VF.kamera) ? VF.kamera : 'verfolger';
  }
  function vfKameraWechseln() {
    const i = VF_KAMERAS.findIndex((k) => k.id === vfKameraId());
    const neu = VF_KAMERAS[(i + 1) % VF_KAMERAS.length];
    VF.kamera = neu.id; VF.kam = null;
    try { localStorage.setItem(VF_KAMERA_STORE, neu.id); } catch (e) { /* egal */ }
    showHudToast(t(neu.name));
  }
  function vfKamera(dt) {
    const r = VF.h * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r);
    const id = vfKameraId();
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
      return { auge, ziel: [VF.x, 1.2, VF.y], fov: 62, nah: 0.3 };
    }
    const nah = id === 'nah';
    const hinten = nah ? 15 : 30, hoehe = nah ? 6 : 13, tau = nah ? 0.08 : 0.15;
    const soll = [VF.x - fx * hinten, hoehe, VF.y - fz * hinten];
    const a = 1 - Math.exp(-Math.max(0, dt) / tau);
    VF.kam = VF.kam ? VF.kam.map((q, i) => q + (soll[i] - q) * a) : soll;
    return { auge: VF.kam, ziel: [VF.x + fx * (nah ? 10 : 14), nah ? 2.2 : 1.5, VF.y + fz * (nah ? 10 : 14)], fov: nah ? 66 : 62, nah: 0.5 };
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
  function vfHud() {
    const el = VF.hud;
    if (!el) return;
    const st = physEngine.state;
    const kmh = Math.round(Math.abs(st.speedKmh || 0) * TACHO_SCALE * (VF.tempoFaktor || 1));   // wie im Cockpit (race-speed)
    const lauf = VF.rundeAb ? Date.now() - VF.rundeAb : null;
    // Nur bei Aenderung schreiben: jedes textContent= ist Arbeit fuer die Seite, und das hier laeuft je Bild.
    const setz = (sel, txt) => { const e = el.querySelector(sel); if (e.textContent !== txt) e.textContent = txt; };
    setz('.vf-tempo', kmh + ' km/h');
    setz('.vf-runde', t('Runde') + ' ' + vfZeit(lauf === null ? null : Math.floor(lauf / 100) * 100));
    setz('.vf-zeiten', t('Letzte') + ' ' + vfZeit(VF.letzte) + ' · ' + t('Beste') + ' ' + vfZeit(VF.beste));
    let modusTxt = '';
    if (VF.modus && RACE_MODES[VF.modus]) {
      if (VF.modus === 'practice') modusTxt = t('Training');
      else {
        modusTxt = RACE_MODES[VF.modus].label;
        if (VF.modus === 'laps') modusTxt += ' · ' + Math.min(VF.runden, VF.limit) + '/' + VF.limit;
        else modusTxt += ' · ' + vfZeit(Math.floor(VF.modusZeit * 1000 / 100) * 100);
      }
    }
    setz('.vf-modus', modusTxt);
    const ab = el.querySelector('.vf-abseits');
    if (ab.hidden === VF.abseits) ab.hidden = !VF.abseits;
    // ACC-Cluster unten: Tempo, Gang, Drehzahl, Reifen, Tank - dieselben Werte wie das Cockpit.
    const acc = document.querySelector('.vf-acc');
    if (!acc) return;
    const setzA = (sel, txt) => { const e = acc.querySelector(sel); if (e.textContent !== txt) e.textContent = txt; };
    setzA('.vf-tempo', kmh + ' km/h');
    setzA('.vf-rpm', Math.round(motorDrehzahl(st)) + ' 1/min');
    const g = st.currentGear;
    setzA('.vf-gang', g > 0 ? String(g) : (g < 0 ? 'R' : 'N'));
    const t4 = st.tyreTemp4 || [st.tyreTempC];
    setzA('.vf-reifen', t4.map((t) => Math.round(t) + '°').join(' / '));
    setzA('.vf-tank', fuelLiters(typeof fuel !== 'undefined' ? fuel : 100) + ' l');
    const stab = acc.querySelector('.vf-dreh-stab');
    if (stab) stab.style.setProperty('--f', String(Math.max(0, Math.min(1, st.rpmFrac || 0))));
  }

  // ---- Starten und Beenden ------------------------------------------------------------------
  // opts.tiles: diese Strecke statt der des Editors (die Studie faehrt Homington), opts.studie: die
  // Fahrt gehoert der Studie (beim Beenden nicht in die Garage). true = gestartet.
  function virtuellStarten(opts) {
    opts = opts || {};
    if (VF.aktiv) return false;
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
    schicht.innerHTML = '<canvas class="vf-bild"></canvas><div class="vf-hud" data-i18n-skip>'
      + '<b class="vf-tempo"></b><span class="vf-runde"></span><span class="vf-zeiten"></span>'
      + '<span class="vf-abseits" hidden>' + t('Neben der Bahn') + '</span><span class="vf-modus"></span></div>'
      + '<div class="vf-acc" data-i18n-skip><b class="vf-tempo"></b>'
      + '<div class="vf-acc-zeile"><span class="vf-lbl">' + t('Gang') + '</span><span class="vf-gang"></span>'
      + '<span class="vf-lbl">' + t('Drehzahl') + '</span><span class="vf-rpm"></span></div>'
      + '<div class="vf-acc-dreh"><i class="vf-dreh-stab"></i></div>'
      + '<div class="vf-acc-zeile"><span class="vf-lbl">' + t('Reifen') + '</span><span class="vf-reifen"></span>'
      + '<span class="vf-lbl">' + t('Tank') + '</span><span class="vf-tank"></span></div></div>'
      + '<div class="vf-knoepfe"><button type="button" data-vf="licht">' + t('Licht') + '</button><button type="button" data-vf="reset">' + t('Zurücksetzen') + '</button>'
      + '<button type="button" data-vf="zu" aria-label="' + t('Beenden') + '">&#10005;</button></div>'
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
    VF.tiles = tiles;
    VF.pts = trackCenterline(tiles);
    VF.nrm = trackNormals(VF.pts);
    VF.bahn = vfBahnBauen(gl, VF.pts, VF.nrm, tiles);
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
      try { localStorage.setItem(VF_HANDLING_STORE, VF_HANDLING_MODI[(i + dd + VF_HANDLING_MODI.length) % VF_HANDLING_MODI.length].id); } catch (e) { /* egal */ }
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
    VF.schicht = null; VF.gl = null;
    renderGarage();
    // Zurueck in die Garage, wo die Optionen der virtuellen Fahrt stehen (dort startet die naechste).
    // Eine Studienfahrt geht zurueck in die Studie (98f-studie.js zeigt sie selbst).
    if (!VF.studie && typeof showTab === 'function') showTab('garage');
    VF.studie = false;
  }
  window.addEventListener('keydown', (e) => { if (VF.aktiv && e.key === 'Escape') { e.stopImmediatePropagation(); virtuellBeenden(); } }, true);
