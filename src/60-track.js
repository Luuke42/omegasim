  // =========================================================================
  // Die Strecke: Modell, Geometrie, Editor, Scan
  // =========================================================================
  // Kachelfolge, Mittellinie, Ideallinie (Minimalkruemmung), Bremsprofil, Zeichnung,
  // Streckencode, Teileleiste, Live-Scan und der Rohcode-Monitor.
  //
  // Die Geometrie ist gemessen und nicht gewaehlt: Kachel 43 cm, Bahnbreite 25 cm,
  // Kurvenradius 37 cm, Haarnadel 18,5 cm mit 28 cm gerader Sektion - letzteres aus
  // dem Grundriss der Original-App zurueckgerechnet (0,62 m x 1,02 m).
  //
  // Hier gab es einmal ZWEI Geometriepfade, und der wirksame war der aermere. Wenn
  // hier etwas hinzukommt, gehoert es in trackCenterline() und nirgendwo sonst.

  // ---- Track data model + shared minimap/track-preview renderer ----
  // Tile type byte matches notify-packet byte 12 exactly, so a scanned track's values
  // can be stored verbatim. CURVE_LEFT used to be a guessed 0x08 (the next power of two)
  // "flagged wherever it's shown in the UI" because it had never been observed. It has
  // been observed since: the 21.08 race capture confirms the real wire code is 0x03
  // (see the note by TILE_OFFTRACK below), so CURVE_LEFT is 0x03 here too — restoring the
  // "verbatim" invariant this comment promises. Before this fix, trackScanNotifyHandler's
  // `Object.values(TILE_TYPE).includes(bestType)` guard silently DROPPED every left-curve
  // tile scanned from a real track, because 0x03 was not a member of TILE_TYPE's values —
  // only the ghost's own outgoing lookahead byte used the correct 0x03, via a second,
  // separate constant. One value now, not two.
  const TRACK_STORE_KEY = 'carrera-hybrid-tracks';
  // The first four values double as PROTOCOL codes (byte 12 of the notify packet). PIT is
  // different: it is a layout element only, and no printed pattern is known to report it.
  // It therefore gets a value OUTSIDE the byte range, so it can never be mistaken for
  // something the car actually sent — bytes[12] is 0..255 and can never equal 0x100.
  // PIT sitzt OUTSIDE the byte range on purpose: bytes[12] is 0..255, so it can never be
  // mistaken for something the car actually reported.
  //
  // Die Haarnadel dagegen HAT eigene Codes, und sie sind gemessen (24.08.2026, mit dem
  // Rohcode-Monitor auf der Original-Bahn ueberfahren): 0x05 links, 0x06 rechts. Hier stand
  // vorher, sie trage denselben Barcode wie eine normale Kurve und die Unterscheidung
  // existiere nur in unserer Karte - das war eine Annahme, und sie war falsch. Sie konnte
  // auch nie geprueft werden, solange Byte 14 Bit 7 den Sensor abschaltete.
  //
  // Die Werte fuegen sich in das Muster der anderen: 0x03/0x04 links/rechts fuer die
  // 60-Grad-Kurve, 0x05/0x06 links/rechts fuer die Haarnadel.
  // START ist 0x0a, gemessen am 25.08. mit dem Original-Startziel-Blatt - und zwar am
  // GEDRUCKTEN BLATT im Ausdruck-Modus (Byte 14 Bit 7). Das ist eine Einschraenkung, die
  // dazugehoert: am 26.08. wurde mit der Original-App gemessen, dass ein Ausdruck nur in
  // dieser Leseart erkannt wird. Was die Kunststoffschiene im Bahn-Modus sendet, ist damit
  // NICHT gemessen, und es koennen zwei Codesaetze sein - einer je Untergrund.
  //
  // Genau deshalb bleibt 0x01 in START_CODES: es war die alte Annahme, und seit dem 26.08.
  // hat es eine plausible Rolle als Code der Schiene. Auch das ist nicht gemessen, aber ein
  // akzeptierter Wert kostet nichts und ein fehlender kostet die Rundenzaehlung.
  //
  // Vorher stand hier 0x01, und das war eine Annahme aus einem Foto - die Doku hat sie auch
  // als solche gekennzeichnet. Die Folgen der falschen Zahl waren erheblich und beide unsichtbar: die
  // Rundenzaehlung prueft auf diesen Wert und hat auf dem Originalblatt nie ausgeloest, und
  // das Streckenlernen faengt erst ab Start/Ziel an mitzuschreiben, also nie.
  //
  // 0x01 bleibt in START_CODES gueltig. Nicht aus Bequemlichkeit: es ist nicht
  // ausgeschlossen, dass eine Kunststoffschiene etwas anderes meldet als das gedruckte
  // Blatt, und einen Wert wegzunehmen, von dem wir nicht wissen ob er vorkommt, waere ein
  // Risiko ohne Gegenwert. Sobald eine Messung ihn ausschliesst, kann er weg.
  const TILE_TYPE = { START: 0x0a, STRAIGHT: 0x02, CURVE_RIGHT: 0x04, CURVE_LEFT: 0x03,
                      HAIRPIN_LEFT: 0x05, HAIRPIN: 0x06,
                      PIT: 0x100 };
  // Alles, was als Start/Ziel gilt, wenn das AUTO einen Code meldet. Fuer Kacheltypen im
  // Editor gilt weiter TILE_TYPE.START allein.
  const START_CODES = [0x0a, 0x01];
  const START_CODE_LEGACY = 0x01;
  // AUS DER LISTE GELESEN und nicht daneben aufgezaehlt. Vorher stand hier
  // "c === 0x0a || c === START_CODE_LEGACY", und damit gab es die Tatsache "was gilt als
  // Start/Ziel" an ZWEI Orten - die Liste hatte keinen einzigen Leser und war die
  // aufgeschriebene Fassung ohne Wirkung. Die Durchsicht auf nicht verdrahtete Teile hat
  // sie als einzige Konstante ohne Leser gefunden.
  //
  // Wer einen dritten Code aufnimmt, aendert jetzt eine Stelle.
  function isStartCode(c) { return START_CODES.indexOf(c) >= 0; }
  // Code 0x00 means the sensor is reading NOTHING VALID, i.e. the car has left the track.
  // From the guard-rail capture of 20.08: every departure showed up as 0x00 together with the
  // tile counter racing (6 -> 8 -> 9 -> 15 -> 18 within three seconds), and 16 of 38
  // transitions in that session were of this kind. It is an immediate signal, which makes the
  // old 1.5 s timeout on 0xff unnecessary as the primary detector.
  const TILE_OFFTRACK = 0x00;
  // The LEFT curve is TILE_TYPE.CURVE_LEFT = 0x03. Established from the race capture of
  // 21.08 on track "az2108": the reported code sequence per lap is S R G R ? R, identical
  // across all 16 laps, and by tile counter the lap is 11 tiles long as S R2 G2 R3 L R2 -
  // exactly the 11 modules the app itself lists for that track. The single 0x03 per lap
  // sits precisely where the single left curve is. (The layout was given as SR2G2R2LR2;
  // the data shows three right curves in that run of the track, not two.)
  // Notify byte 15, bit 3 is the START/FINISH latch, NOT a lateral signal. Read carefully,
  // because an earlier pass here got this wrong: the block length is nearly constant
  // (median 0.91 and 0.94 s, 10th-90th percentile 0.84-1.01 s), there are 17 blocks against
  // 16 laps, and EVERY block begins on lap tile index 0 with code 0x01 - 16 of 17 and 17 of
  // 17 for the two ghosts. It is a fixed timer after reading the start pattern, exactly as
  // the protocol table in the documentation already said.
  // The correlation with the app's next steering command (r = -0.40) that briefly looked
  // like edge feedback was an ARTEFACT OF PLACE: the latch always marks the same point on
  // the track, and the app steers consistently at that point. There is still no lateral
  // report anywhere in the protocol.
  // What the app writes to a car it drives itself. Measured on both ghosts in that race,
  // constant over 2496 and 2457 packets: byte 10 = 0x20 (the human-driven car got 0x60), and
  // byte 15 with bit 3 set (0x0c/0x0e; the human-driven car got 0x04). Bit 1 of byte 15
  // tracks being under power rather than a mode (throttle in 100 % of packets with it set
  // against 69.8 % without), so it is not reproduced here.
  const AUTO_MODE = { b10: 0x20, b15: 0x0c };
  // What the original app sent in guard-rail mode, and ONLY there. From the capture of
  // 20.08, which holds 67 s of traffic to the car: at 37.8 s byte 14 went 0x02 -> 0x22 and
  // stayed that way, and in the SAME packet bytes 16-18 became non-zero for the first time.
  // 552 packets, the two features coincident to the millisecond, and both absent from every
  // other capture. So they are one feature:
  //   bit 5 of byte 14 = guard-rail mode on
  //   bytes 16-18      = the next three tile types, a sliding window over the scanned layout
  // The nine distinct windows observed are all consecutive triples of a single ring,
  // Start-Kurve-Kurve-Gerade-Gerade-Kurve; by chance that would be 1.3e-6. The window steps
  // on at each tile boundary (38.6 s, 45.0 s, 47.7 s - exactly the reported code changes).
  //
  // That is the whole answer to "how does it steer with no lateral report": the lateral
  // reading never leaves the car. It reads the wedge under its own sensor, the app tells it
  // which way the track bends next, and it corrects on board - necessarily, since the report
  // rate is only 14.6 Hz (69 ms median) and our own send loop is 45 ms.
  //
  // Byte 10 is 0x30 here and 0x60 everywhere else, but it is NOT what gates code reporting:
  // in the capture of 19:21 the original app sent 0x60 and byte 14 with bit 7 set - our
  // packet, field for field in all fourteen fixed bytes - and received 463 codes. It is sent
  // as 0x30 only to reproduce this mode exactly, not because it is known to matter.
  const RAIL_MODE = { b10: 0x30, b14bit: 0x20 };
  const TILE_LABEL = {
    [TILE_TYPE.START]: 'Start/Ziel',
    [TILE_TYPE.STRAIGHT]: 'Gerade',
    [TILE_TYPE.CURVE_RIGHT]: 'Rechtskurve',
    [TILE_TYPE.CURVE_LEFT]: 'Linkskurve',
    [TILE_TYPE.PIT]: 'Boxengasse',
    [TILE_TYPE.HAIRPIN]: 'Haarnadel rechts',
    [TILE_TYPE.HAIRPIN_LEFT]: 'Haarnadel links',
    [TILE_OFFTRACK]: 'abseits der Bahn',
  };

  function loadTrackStore() {
    try { return JSON.parse(localStorage.getItem(TRACK_STORE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveTrackStore(store) { localStorage.setItem(TRACK_STORE_KEY, JSON.stringify(store)); }

  // Gespeicherte Strecken halten den Kacheltyp als ZAHL fest. Mit START von 0x01 auf 0x0a
  // waere die erste Kachel einer alten Strecke plötzlich kein Start/Ziel mehr, und die
  // Ankerlogik weiter unten haette ihr ein zweites davorgesetzt: eine Kachel mehr, still,
  // in jeder gespeicherten Strecke. Deshalb wird beim Laden gewandert.
  function migrateTiles(tiles) {
    if (!Array.isArray(tiles)) return tiles;
    let n = 0;
    for (const t of tiles) {
      if (t && t.type === START_CODE_LEGACY) { t.type = TILE_TYPE.START; n++; }
    }
    if (n) log('Gespeicherte Strecke gewandert: ' + n + ' mal Start/Ziel von 0x01 auf 0x0a.',
               'info');
    return tiles;
  }

  // A track always begins with the Start/Finish tile — lap timing keys off it, and a
  // track without one can never register a lap.
  function freshTrackTiles() { return [{ type: TILE_TYPE.START }]; }
  let currentTrackTiles = freshTrackTiles(); // [{type}]
  let trackRotationDeg = 0; // whole-track orientation, rotatable in 90° steps

  // Turtle-graphics walk: each tile is a fixed-length/fixed-turn step, always
  // continuing from the previous tile's exact end position and heading — so tiles
  // always connect. Curve turn angle is a fixed, confirmed 60° (matches how the real
  // curve pieces are built); radius is a schematic estimate (not measured from a real
  // track), so overall scale is illustrative rather than geometrically exact.
  // ---- Real track dimensions, measured by the user ----
  // A piece is 25 cm wide and 43 cm long, and one straight plus one 60-degree right curve
  // together occupy 37 x 86 cm. Solving the footprint for the curve radius gives 37 cm,
  // which reproduces 37.2 x 85.9 cm - so the drawing constants below are derived from real
  // measurements rather than chosen to look right. The previously hand-picked radius of 34
  // units turns out to be 36.5 cm and yields 37.0 x 85.5 cm, i.e. it was already correct;
  // it is now expressed in centimetres so it stays checkable.
  const TRACK_TILE_CM = 43, TRACK_WIDTH_CM = 25, TRACK_RADIUS_CM = 37;
  const TRACK_STEP = 40;                                   // drawing units per tile length
  // Das Bauteil hat vor dem Bogen noch ein Geradenstueck - auf dem Foto deutlich zu sehen.
  // Ohne das setzt der Bogen unmittelbar am vorigen Teil an, und die Karte zeigt eine
  // engere Kehre als tatsaechlich liegt. Ein Drittel einer Kachellaenge ist eine ANNAHME,
  // gemessen ist sie nicht; sobald der Grundriss eines Haarnadelteils vorliegt, gehoert hier
  // die echte Zahl hin.
  // Gerade Sektion am Anfang der Haarnadel. EXAKT geloest, nicht abgeschaetzt.
  //
  // Die Strecke SHG4R4LG dreht 180 + 4*60 - 60 = 360 Grad und muss sich deshalb schliessen.
  // Das sind zwei Gleichungen, x und y, mit zwei Unbekannten: Radius und gerade Sektion. Und
  // sie sind entkoppelt - der Radius wirkt in dieser Strecke nur waagerecht, die gerade
  // Sektion nur senkrecht:
  //
  //     je cm Radius            dx = +2.0000   dy =  0.0000
  //     je cm gerader Sektion    dx =  0.0000   dy = -1.0000
  //
  // Geloest: Radius 18,5000 cm und gerade Sektion 21,9141 cm, Restfehler 0,000000 cm. Die
  // geschlossene Form ist 2 * (Kachel - Radius * cos 30 Grad) = 2 * (43 - 32,043).
  //
  // Vorher stand hier 28 cm, aus dem Grundriss 0,62 m x 1,02 m eines Bildschirmfotos
  // zurueckgerechnet. Der Radius war daraus richtig, die gerade Sektion um 6,09 cm zu
  // gross - und das ist genau der Betrag, um den SHG4R4LG nicht zusammenfand. Eine
  // Schliessbedingung ist eine exakte Identitaet, ein abgelesener Grundriss haengt daran,
  // welche Teile man auf dem Bild vermutet und was der Kasten ueberhaupt misst. Bei einem
  // Widerspruch gewinnt die Identitaet.
  const TRACK_HAIRPIN_LEAD_CM = 2 * (TRACK_TILE_CM - TRACK_RADIUS_CM * Math.cos(Math.PI / 6));
  const TRACK_UNITS_PER_CM = TRACK_STEP / TRACK_TILE_CM;   // 0.930
  const TRACK_HAIRPIN_LEAD = TRACK_HAIRPIN_LEAD_CM * TRACK_UNITS_PER_CM;
  const TRACK_RADIUS = TRACK_RADIUS_CM * TRACK_UNITS_PER_CM;
  const TRACK_TURN_DEG = 60;

  // One place decides how far a curved piece turns and how tight it is, so
  // trackCenterline() can never disagree about the geometry — they used to hardcode the same
  // two numbers separately.
  function tileTurnDeg(type) {
    if (type === TILE_TYPE.CURVE_RIGHT) return TRACK_TURN_DEG;
    if (type === TILE_TYPE.CURVE_LEFT) return -TRACK_TURN_DEG;
    if (type === TILE_TYPE.HAIRPIN) return TRACK_HAIRPIN_DEG;
    if (type === TILE_TYPE.HAIRPIN_LEFT) return -TRACK_HAIRPIN_DEG;
    return 0;
  }
  function tileRadius(type) {
    return (type === TILE_TYPE.HAIRPIN || type === TILE_TYPE.HAIRPIN_LEFT)
      ? TRACK_HAIRPIN_RADIUS : TRACK_RADIUS;
  }
  function tileIsCurve(type) {
    return type === TILE_TYPE.CURVE_RIGHT || type === TILE_TYPE.CURVE_LEFT
        || type === TILE_TYPE.HAIRPIN || type === TILE_TYPE.HAIRPIN_LEFT;
  }

  // walkTrack() ist hier entfernt. Sie lief NIE - nichts rief sie auf - und sie war der
  // einzige Ort, der die gerade Sektion der Haarnadel kannte. Zwei Geometriepfade, von denen
  // der wirksame der aermere ist, sind schlechter als einer: die Sektion galt als
  // implementiert und war es nicht. Was sie konnte, kann jetzt trackCenterline().

  // ---- Sampled centreline ----
  // walkTrack() returns one point per tile BOUNDARY, which is enough to draw a thin line but
  // not enough for a roadway, kerbs or a racing line. This samples along each tile and is the
  // single source of geometry for all of them — the map and the driving line must not come
  // from two different calculations, or they will disagree.
  // Half the roadway width, derived from the measured 25 cm. Was 13 by guess, which drew
  // the track 12 % too wide.
  const TRACK_HALF_W = (TRACK_WIDTH_CM / 2) * TRACK_UNITS_PER_CM;
  // Kerb width as a FRACTION of the roadway width, measured off the app's own track maps
  // (three screenshots, 5488 kerb/road pairs sampled along rows and columns): median
  // 0.095, quartiles 0.081 to 0.112. Consistent across all three maps, so it is a design
  // ratio and not an artefact of one picture. We had been drawing 5 units on a 23.25-unit
  // roadway, i.e. 0.215 — more than twice too wide, which is what made the kerbs read as
  // part of the track rather than as its edge.
  const TRACK_KERB_RATIO = 0.095;
  const TRACK_KERB_W = TRACK_KERB_RATIO * TRACK_HALF_W * 2;   // ~2.21 units, ~2.4 cm

  // ---- Hairpin ----
  // Always 180 degrees. The RADIUS IS NOT MEASURED: a hairpin has to be tighter than a
  // standard 60-degree curve, or it would be geometrically identical to three of them and
  // pointless as a separate piece — but by how much is unknown. Half the standard radius is
  // an assumption, marked as one in the UI, and a single measured number replaces it (the
  // footprint of one hairpin piece, the way TRACK_RADIUS_CM came from "a straight plus a
  // 60-degree curve occupy 37 x 86 cm").
  // GEMESSEN, nicht mehr angenommen. Der Grundriss aus der Original-App gibt 62 cm
  // Gesamtbreite fuer eine Haarnadel, und 2 * 18,5 + 25 Bahnbreite = 62 trifft das exakt.
  // Die alte Herleitung "halber Kurvenradius" war eine Vermutung und stimmt.
  const TRACK_HAIRPIN_RADIUS_CM = TRACK_RADIUS_CM / 2;   // 18,5 cm, bestaetigt 24.08.
  const TRACK_HAIRPIN_RADIUS = TRACK_HAIRPIN_RADIUS_CM * TRACK_UNITS_PER_CM;
  const TRACK_HAIRPIN_DEG = 180;
  const TRACK_SAMPLES_PER_TILE = 14;

  function trackCenterline(tiles) {
    const out = [];
    let x = 0, y = 0, heading = trackRotationDeg;
    const push = (px, py, ph, idx) => out.push({ x: px, y: py, heading: ph, tile: idx });
    push(x, y, heading, -1);
    tiles.forEach((tile, idx) => {
      const n = TRACK_SAMPLES_PER_TILE;
      if (tileIsCurve(tile.type)) {
        // Die Haarnadel beginnt mit einer geraden Sektion. Sie stand bisher nur in
        // walkTrack(), und walkTrack() wird nirgends aufgerufen: der wirksame Pfad ist
        // dieser hier, und er kannte sie nicht. Die Haarnadel sass dadurch 28 cm zu kurz,
        // und genau deshalb fuehrte eine Strecke am Ende nicht wieder zusammen.
        if (tile.type === TILE_TYPE.HAIRPIN || tile.type === TILE_TYPE.HAIRPIN_LEFT) {
          const lead = Math.max(2, Math.round(n * TRACK_HAIRPIN_LEAD / TRACK_STEP));
          const rad0 = heading * Math.PI / 180;
          const x0 = x, y0 = y;
          for (let i = 1; i <= lead; i++) {
            push(x0 + Math.sin(rad0) * TRACK_HAIRPIN_LEAD * (i / lead),
                 y0 - Math.cos(rad0) * TRACK_HAIRPIN_LEAD * (i / lead), heading, idx);
          }
          x = out[out.length - 1].x;
          y = out[out.length - 1].y;
        }
        const turn = tileTurnDeg(tile.type);
        const radius = tileRadius(tile.type);
        // Walk the arc in n small steps around the instantaneous centre. A hairpin turns
        // three times as far as a normal curve, so it gets proportionally more samples —
        // otherwise the tightest piece on the track would be the most coarsely drawn, and
        // the ideal line would inherit that coarseness.
        const steps = Math.max(n, Math.round(n * Math.abs(turn) / TRACK_TURN_DEG));
        const sgn = Math.sign(turn);
        const cx = x + Math.cos(heading * Math.PI / 180) * radius * sgn;
        const cy = y + Math.sin(heading * Math.PI / 180) * radius * sgn;
        const a0 = Math.atan2(y - cy, x - cx);
        for (let i = 1; i <= steps; i++) {
          const a = a0 + (turn * Math.PI / 180) * (i / steps);
          const px = cx + Math.cos(a) * radius;
          const py = cy + Math.sin(a) * radius;
          push(px, py, heading + turn * (i / steps), idx);
        }
        heading += turn;
        x = out[out.length - 1].x; y = out[out.length - 1].y;
      } else {
        const len = tile.type === TILE_TYPE.PIT ? TRACK_STEP * 2 : TRACK_STEP;
        const rad = heading * Math.PI / 180;
        for (let i = 1; i <= n; i++) {
          push(x + Math.sin(rad) * len * (i / n), y - Math.cos(rad) * len * (i / n),
               heading, idx);
        }
        x += Math.sin(rad) * len; y -= Math.cos(rad) * len;
      }
    });
    return out;
  }

  // Unit normal pointing to the LEFT of the direction of travel.
  //
  // GEMESSEN, weil der Kommentar hier "RIGHT" behauptete und zwei Leser darauf
  // hereingefallen sind: auf einer Geraden nach Norden ist die Tangente (0,-1), die Normale
  // kommt (-1,0) heraus, und auf dem Bildschirm mit y nach unten ist das LINKS. Das
  // Skalarprodukt mit der Fahrtrichtungs-Rechten ist genau -1.
  //
  // Die zwei Leser: die Randsteinbeschriftung (60-track.js, dort schon berichtigt) und die
  // Ghost-Lenkung (ghostLineOffset in 90-ghosts.js) - letztere lenkte dadurch in jeder
  // Kurve nach aussen. Die Funktion bleibt wie sie ist, weil die Zeichnung darauf steht;
  // geaendert ist, was der Kommentar sagt, damit kein dritter Leser darauf baut.
  function trackNormals(pts) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      return { x: -dy / L * -1, y: dx / L * -1 };   // rotate the tangent by -90 deg
    });
  }

  function offsetPath(pts, nrm, dist) {
    return pts.map((p, i) => [p.x + nrm[i].x * dist, p.y + nrm[i].y * dist]);
  }

  // ---- Ideal line: minimise curvature ----
  // Each point may slide sideways within the roadway. Repeatedly nudging every point toward
  // the midpoint of its neighbours — along the normal only — is curvature smoothing, and it
  // converges to a minimum-curvature line. Clamped to the roadway on every pass, so the
  // result can never leave the track.
  function idealLine(pts, nrm, opts) {
    const o = opts || {};
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    // A movement-based stop criterion is the WRONG one at this sampling density, and the
    // measurements showed why. With 14 samples per tile, neighbouring points sit ~2.9 units
    // apart, so the midpoint of the neighbours is almost exactly on the current point and
    // each pass moves it by a fraction of a millimetre. A 0.5 mm threshold therefore
    // declared victory after ONE iteration, and the resulting "ideal line" used 1.1 cm of a
    // 25 cm wide track - i.e. it was the centreline with a wobble.
    // The displacement accumulates over many passes, so the answer is simply to run enough
    // of them. 140 points x 2000 passes is a few hundred thousand operations, which is
    // nothing, and the meaningful output is not a residual but HOW MUCH of the track width
    // the finished line actually uses.
    const iters = o.iters || 2000;
    const relax = o.relax || 0.35;
    const closed = o.closed;
    const n = pts.length;
    const alpha = new Array(n).fill(0);
    // ---- Why there is no exit heuristic here ----
    // There were two attempts and both were wrong, and the second one taught the real lesson.
    // Attempt 1 weighted the next neighbour more, to shift the line later through a corner.
    // Measured, it did the opposite: on the straight after the corner the offset fell from
    // 5.3 to 1.2 cm. On a straight the midpoint of the neighbours already lies on the line,
    // so a weighting has no purchase there.
    // Attempt 2 prescribed a target offset along the following straight, decaying from the
    // outer edge to the centre. That produced the S-shape the user saw: out at the exit, back
    // to the middle along the straight, and out again for the next exit.
    // Removing that target - prescribing NOTHING on the straights - fixed it, and then the
    // measurements showed the pull was not merely unnecessary but harmful: at the corner exit
    // it gave 7.4 cm where pure minimum curvature gives 8.5 cm of 9.3 available, because a
    // spring toward a fixed target CAPS an excursion the smoother would otherwise push
    // further. The whole heuristic existed to compensate for a defect it had introduced.
    // So: pure minimum curvature, which is the standard method, and it produces the wide exit
    // and the straight straight on its own.
    const at = (i) => {
      const k = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
      return { x: pts[k].x + nrm[k].x * alpha[k], y: pts[k].y + nrm[k].y * alpha[k] };
    };
    let moved = 0;
    for (let it = 0; it < iters; it++) {
      moved = 0;
      for (let i = 0; i < n; i++) {
        if (!closed && (i === 0 || i === n - 1)) continue;
        const prev = at(i - 1), next = at(i + 1), cur = at(i);
        const midX = (prev.x + next.x) / 2, midY = (prev.y + next.y) / 2;
        // Only the component along the normal is available to us; the point cannot move
        // along the track, or the sampling would bunch up.
        const d = (midX - cur.x) * nrm[i].x + (midY - cur.y) * nrm[i].y;
        const before = alpha[i];
        alpha[i] = Math.max(-limit, Math.min(limit, alpha[i] + relax * d));
        moved = Math.max(moved, Math.abs(alpha[i] - before));
      }
      if (moved === 0) break;   // nothing left to move at all
    }
    // Report the excursion, which is what tells the reader whether the optimisation did
    // anything: a line that never leaves the middle has not found a racing line.
    const span = Math.max(...alpha.map(Math.abs));
    return { alpha, iterations: iters, residual: moved, limit, span };
  }

  // ---------------------------------------------------------------- Rundenzeitmodell
  //
  // Die Zielfunktion ist die Rundenzeit, gerechnet aus einem Geschwindigkeitsprofil. Das ist
  // das uebliche quasistationaere Verfahren:
  //
  //   1. Kruemmung entlang der Linie          -> Kurvengrenze  v = sqrt(a_quer / kappa)
  //   2. Vorwaertslauf, begrenzt durch Zug    -> v(i+1) <= sqrt(v(i)^2 + 2 a_zug ds)
  //   3. Rueckwaertslauf, begrenzt durch Bremse
  //   4. Zeit = Summe ds / v
  //
  // Und daraus folgt der spaete Scheitel von selbst: eine Kurve vor einer langen Geraden
  // bekommt eine niedrigere Scheitelgeschwindigkeit, wenn dafuer die Ausfahrt frueher
  // gerade wird, weil die Zeit auf der Geraden mehr wiegt als die im Bogen. Eine Kurve vor
  // der naechsten Kurve wird anders gefahren als dieselbe Kurve vor einer Geraden - genau
  // das war der Wunsch, "je Kurvenkombination", und es ist hier nicht einprogrammiert,
  // sondern eine Folge der Zielfunktion.
  //
  // Die drei Beschleunigungen sind ein VERHAELTNIS, kein Messwert. Absolut kommt es auf sie
  // nicht an: multipliziert man alle drei mit demselben Faktor, wird die Zeit kleiner und
  // die LINIE bleibt dieselbe. Was die Linie formt, ist a_quer gegen a_zug und a_brems, und
  // dafuer sind die Verhaeltnisse eines GT-Fahrzeugs eingesetzt: querbeschleunigen etwa so
  // stark wie bremsen, antreiben deutlich schwaecher. Das ist eine Modellannahme und keine
  // Messung an diesem Auto, denn kein Byte meldet die Querbeschleunigung.
  const LT_A_LAT = 1.0;     // Querbeschleunigung, Bezugsgroesse
  const LT_A_ACC = 0.45;    // Zug, deutlich schwaecher als Querhaftung
  const LT_A_BRK = 1.10;    // Bremse, etwas stark
  const LT_V_MAX = 12.0;    // Deckel, damit eine Gerade nicht unbegrenzt schnell wird

  // Zeit fuer eine gegebene Linie. Gibt auch das Profil zurueck, damit der Editor es
  // zeichnen kann - dieselbe Zahl, die optimiert wurde, ist dann auch die angezeigte.
  function lapTimeOf(path, closed, o) {
    const n = path.length;
    const k = pathCurvature(path, closed);
    const aLat = (o && o.aLat) || LT_A_LAT;
    const aAcc = (o && o.aAcc) || LT_A_ACC;
    const aBrk = (o && o.aBrk) || LT_A_BRK;
    const vCap = (o && o.vMax) || LT_V_MAX;
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    // Segmentlaengen: ds[i] ist der Weg von i nach i+1.
    const ds = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = path[i], b = path[at(i + 1)];
      ds[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const v = new Array(n);
    for (let i = 0; i < n; i++) {
      v[i] = k[i] > 1e-9 ? Math.min(vCap, Math.sqrt(aLat / k[i])) : vCap;
    }
    // Zwei Durchlaeufe je Richtung. Auf einer geschlossenen Runde reicht einer nicht: die
    // Bremszone vor Kurve eins kann hinter der Ziellinie beginnen, und die Information muss
    // einmal herumlaufen. Zwei genuegen, weil kein Bremsweg laenger als eine halbe Runde
    // ist; bei einer offenen Strecke ist der zweite Durchlauf ohne Wirkung und billig.
    const laeufe = closed ? 2 : 1;
    for (let r = 0; r < laeufe; r++) {
      for (let i = 0; i < n; i++) {
        const j = at(i + 1);
        const moeglich = Math.sqrt(v[i] * v[i] + 2 * aAcc * ds[i]);
        if (v[j] > moeglich) v[j] = moeglich;
      }
      for (let i = n - 1; i >= 0; i--) {
        const j = at(i + 1);
        const moeglich = Math.sqrt(v[j] * v[j] + 2 * aBrk * ds[i]);
        if (v[i] > moeglich) v[i] = moeglich;
      }
    }
    let t = 0;
    for (let i = 0; i < n; i++) {
      // Mittlere Geschwindigkeit im Segment, nicht die am Punkt: bei kraeftigem Bremsen
      // waere die Punktgeschwindigkeit deutlich daneben.
      const vm = Math.max(1e-6, (v[i] + v[at(i + 1)]) / 2);
      t += ds[i] / vm;
    }
    return { time: t, v, ds };
  }

  // Die schnellste Linie, gesucht durch oertliche Suche auf der Rundenzeit.
  //
  // Gestoert wird NICHT ein einzelner Punkt, sondern eine glatte Beule (erhobener Kosinus)
  // ueber ein Fenster. Zwei Gruende, und beide sind praktisch: eine punktweise Suche macht
  // die Linie zackig, weil jeder Punkt fuer sich ein klitzekleines Zeitgewinnchen findet,
  // und sie braucht viel mehr Auswertungen fuer dieselbe Bewegung. Eine Beule verschiebt
  // ein ganzes Kurvenstueck auf einmal, und das ist die Bewegung, um die es geht.
  function lapTimeLine(pts, nrm, opts) {
    const o = opts || {};
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const closed = o.closed;
    const n = pts.length;
    // Startpunkt ist die kruemmungsaermste Linie. Bei null anzufangen waere ehrlicher
    // aussehend, aber die oertliche Suche braucht dann viele Male mehr Auswertungen fuer
    // dasselbe Ergebnis - und die Minimalkruemmung ist eine gute Naeherung, nur eben nicht
    // das Optimum.
    const start = idealLine(pts, nrm, { closed, limit });
    const alpha = start.alpha.slice();
    const bahn = (a) => pts.map((p, i) => [p.x + nrm[i].x * a[i], p.y + nrm[i].y * a[i]]);
    let best = lapTimeOf(bahn(alpha), closed, o).time;
    const startZeit = best;

    // Fensterbreite in Punkten. Bei etwa 14 Punkten je Kachel ist 10 knapp eine
    // Kachellaenge - die Groessenordnung eines Kurveneingangs.
    const breiten = o.widths || [18, 10, 6];
    const runden = o.sweeps || 4;
    let schritt = o.step || limit * 0.35;
    let auswertungen = 0, angenommen = 0;

    for (let runde = 0; runde < runden; runde++) {
      for (const w of breiten) {
        // Beulenmitten ueberlappend setzen, sonst bleiben die Naehte zwischen zwei Beulen
        // unangetastet.
        const versatz = Math.max(1, Math.floor(w / 2));
        for (let c = 0; c < n; c += versatz) {
          for (const richtung of [1, -1]) {
            const probe = alpha.slice();
            let irgendwas = false;
            for (let d = -w; d <= w; d++) {
              const i = closed ? ((c + d) % n + n) % n : c + d;
              if (i < 0 || i >= n) continue;
              if (!closed && (i === 0 || i === n - 1)) continue;
              // Erhobener Kosinus: in der Mitte volle Hoehe, an den Raendern null, also
              // kein Knick am Uebergang zur unveraenderten Linie.
              const g = 0.5 * (1 + Math.cos(Math.PI * d / (w + 1)));
              const v = probe[i] + richtung * schritt * g;
              probe[i] = Math.max(-limit, Math.min(limit, v));
              irgendwas = true;
            }
            if (!irgendwas) continue;
            const t = lapTimeOf(bahn(probe), closed, o).time;
            auswertungen++;
            if (t < best - 1e-9) {
              best = t;
              for (let i = 0; i < n; i++) alpha[i] = probe[i];
              angenommen++;
            }
          }
        }
      }
      // Schrittweite halbieren: grob suchen, dann feiner. Ohne das bleibt die Suche bei
      // einer Schrittweite haengen, die zu gross ist, um den letzten Zentimeter zu finden.
      schritt *= 0.5;
    }

    const prof = lapTimeOf(bahn(alpha), closed, o);
    const span = Math.max(...alpha.map(Math.abs));
    return { alpha, limit, span, lapTime: best, startLapTime: startZeit,
             gain: (startZeit - best) / startZeit, v: prof.v,
             evals: auswertungen, accepted: angenommen };
  }

  // ---------------------------------------------------------------- Modellwahl
  //
  // 'curvature' ist das bisherige Modell, minimale Kruemmung, also der groesste moegliche
  // Radius. 'laptime' minimiert die Rundenzeit ueber ein Geschwindigkeitsprofil.
  //
  // Was gemessen ist und was nicht, damit die Wahl auf Zahlen steht und nicht auf einem
  // Versprechen:
  //
  //   Gemessen: 'laptime' ist im eigenen Mass auf jedem geprueften Layout schneller, 1,2 bis
  //   7,8 Prozent (SR6, SG2R2G2R2, SGR2GR2GRG, SHG4R4LG, SJG4L4RG). Kosten 15 bis 55 ms.
  //
  //   NICHT belegt: dass der Scheitel dabei spaeter liegt. Ueber zwoelf Kurvenzuege
  //   verschiebt er sich im Mittel um +0,045 der Kurvenlaenge, zwei spaeter und zwei
  //   frueher - das ist kein Effekt. Der Grund ist die Groesse der Bahn: bei 25 cm Breite
  //   und 43 cm Kachellaenge liegt die Linie fast ueber die ganze Kurve am Rand, es ist
  //   also kaum Platz, einen Scheitel zu verschieben. Der Zeitgewinn ist echt, kommt aber
  //   nicht aus dem Mechanismus der Lehrbuchbilder.
  //
  //   Und beides sind MODELLZAHLEN. Ob die Linie auf dem Teppich schneller ist, sagt nur die
  //   Rundenzeit gegen die Abgaenge - dafuer ist der Schalter da.
  // RUNDENZEIT IST DIE VORGABE, und das ist gemessen entschieden:
  //
  //   Kruemmung      Kurvenspanne 0,018 des Lenkbereichs - die Linie liegt ueber die GANZE
  //                  Kurve am Rand. Kein Scheitel, also keine Linie, sondern ein Versatz.
  //   Rundenzeit     Kurvenspanne 0,144, und nach dem Selbsttest messbar schneller.
  //
  // Das Kruemmungsmodell bleibt waehlbar: es ist das Lehrbuchverfahren und braucht keine
  // Annahmen ueber Quer-, Zug- und Bremsbeschleunigung. Auf DIESER Bahnbreite (25 cm) und
  // Kachellaenge (43 cm) hat es aber keinen Platz fuer einen Scheitel, und das steht im
  // Kommentar darueber schon.
  let lineModel = 'laptime';

  function setLineModel(m) {
    if (m !== 'curvature' && m !== 'laptime') return;
    lineModel = m;
  }
  function getLineModel() { return lineModel; }

  // Beide Modelle hinter einem Aufruf. Editor und Ghosts gehen hier durch, damit die
  // gezeichnete und die gefahrene Linie nicht auseinanderlaufen koennen.
  function buildLine(pts, nrm, opts) {
    const o = opts || {};
    const m = o.model || lineModel;
    const line = m === 'laptime' ? lapTimeLine(pts, nrm, o) : idealLine(pts, nrm, o);
    line.model = m;
    return line;
  }

  // ---- Generic line chart -> SVG string ----
  // Same contract as renderTrackPreview below: build a template string, let the caller
  // inject it, size the viewBox to the data and NEVER measure the DOM. Not measuring is
  // what makes it safe to render into the Doku tab while that tab is still hidden.
  function renderLineChart(o) {
    const W = 640, H = o.height || 250, L = 58, R = 16, T = 14, B = 34;
    const xs = o.series.flatMap(s => s.points.map(p => p[0]));
    const ys = o.series.flatMap(s => s.points.map(p => p[1]));
    const x0 = o.xMin !== undefined ? o.xMin : Math.min(...xs);
    const x1 = o.xMax !== undefined ? o.xMax : Math.max(...xs);
    const y0 = o.yMin !== undefined ? o.yMin : Math.min(0, Math.min(...ys));
    const y1 = o.yMax !== undefined ? o.yMax : Math.max(...ys) * 1.08;
    const sx = v => L + (v - x0) / ((x1 - x0) || 1) * (W - L - R);
    const sy = v => H - B - (v - y0) / ((y1 - y0) || 1) * (H - T - B);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = x0 + (x1 - x0) * i / 4, X = sx(v);
      g += `<line x1="${X.toFixed(1)}" y1="${T}" x2="${X.toFixed(1)}" y2="${H - B}" stroke="#454d5e" stroke-width="1"/>`
         + `<text x="${X.toFixed(1)}" y="${H - B + 15}" text-anchor="middle" font-size="10" fill="#a9b2c4">${(+v.toFixed(1))}</text>`;
      const w = y0 + (y1 - y0) * i / 4, Y = sy(w);
      g += `<line x1="${L}" y1="${Y.toFixed(1)}" x2="${W - R}" y2="${Y.toFixed(1)}" stroke="#454d5e" stroke-width="1"/>`
         + `<text x="${L - 6}" y="${(Y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#a9b2c4">${(+w.toFixed(2))}</text>`;
    }
    let paths = '';
    for (const s of o.series) {
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'} ${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}"`
             + `${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`;
      if (s.label) {
        const last = s.points[s.points.length - 1];
        paths += `<text x="${(sx(last[0]) + 4).toFixed(1)}" y="${(sy(last[1]) + 3).toFixed(1)}"`
               + ` font-size="10" font-weight="700" fill="${s.color}">${s.label}</text>`;
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:640px;height:auto" aria-label="${o.ariaLabel || ''}">`
      + `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="#14161c"/>${g}${paths}`
      + `<text x="${(L + (W - R)) / 2}" y="${H - 4}" text-anchor="middle" font-size="10.5" fill="#f4f6fb">${o.xLabel}</text>`
      + `<text x="12" y="${(T + H - B) / 2}" text-anchor="middle" font-size="10.5" fill="#f4f6fb"`
      + ` transform="rotate(-90 12 ${(T + H - B) / 2})">${o.yLabel}</text></svg>`;
  }

  // Gears are an ORDINAL quantity, so they get a lightness ramp rather than five unrelated
  // hues, and each line is labelled at its end instead of needing a separate legend.
  // Lightness runs 48..86 %, not 18..64. The plot area is #14161c, i.e. about 9 % lightness,
  // so the old first gear was almost exactly the background: dark lines on a dark field. The
  // charts were not broken, they were invisible.
  function gearColor(i, n) {
    const l = 48 + (i / Math.max(1, n - 1)) * 38;
    return `hsl(212 85% ${l}%)`;
  }


  function renderDrivetrainCharts() {
    if (!$('doku-chart-torque')) return;
    const e = physEngine, cfg = e.config;
    const A = e.accelScale();

    // 1) Engine torque against RPM — read straight from the live table.
    const tq = [];
    for (let r = 1500; r <= 9000; r += 100) tq.push([r, torqueAt(r)]);
    $('doku-chart-torque').innerHTML = renderLineChart({
      series: [{ points: tq, color: '#5aa9ff' }],
      xLabel: 'Motordrehzahl (1/min)', yLabel: 'Drehmoment (Faktor)',
      yMin: 0, yMax: 1.1, ariaLabel: 'Drehmoment über Drehzahl',
    });

    // 2) Wheel thrust per gear against road speed, and 3) the acceleration that leaves
    // once the resistances are subtracted. Both are sampled from the SAME functions the
    // car is driven by, so they cannot drift away from actual behaviour.
    const thrust = [], accel = [];
    cfg.gears.forEach((g, i) => {
      const pts = [], apts = [];
      const band = e.gearBand(i);
      for (let v = 0; v <= cfg.topSpeedKmh; v += cfg.topSpeedKmh / 80) {
        const th = e.thrustAt(v, i, 1, A);
        pts.push([v, th / A]);
        apts.push([v, th - e.resistAt(v, A, true)]);
      }
      const col = gearColor(i, cfg.gears.length);
      thrust.push({ points: pts, color: col, label: String(i + 1) });
      accel.push({ points: apts, color: col, label: String(i + 1) });
    });
    const coast = [];
    for (let v = 0; v <= cfg.topSpeedKmh; v += cfg.topSpeedKmh / 40) coast.push([v, -e.resistAt(v, A, false)]);
    accel.push({ points: coast, color: '#a9b2c4', dash: '4 3', width: 1.5, label: 'Rollen' });
    const brake = [];
    for (let v = 0; v <= cfg.topSpeedKmh; v += cfg.topSpeedKmh / 40) {
      brake.push([v, -(cfg.brakeDecelBase + cfg.brakeDecelAero * (v / cfg.topSpeedKmh))]);
    }
    accel.push({ points: brake, color: '#ff5c5c', dash: '4 3', width: 1.5, label: 'Bremse' });

    $('doku-chart-thrust').innerHTML = renderLineChart({
      series: thrust, xLabel: 'Geschwindigkeit (km/h)', yLabel: 'Radzugkraft (relativ)',
      yMin: 0, ariaLabel: 'Radzugkraft je Gang über Geschwindigkeit',
    });
    $('doku-chart-accel').innerHTML = renderLineChart({
      series: accel, xLabel: 'Geschwindigkeit (km/h)', yLabel: 'Beschleunigung (km/h pro s)',
      ariaLabel: 'Beschleunigung je Gang über Geschwindigkeit',
    });

    // 4) The launch itself, from the very integrator that solves the 0-auf-Vmax slider.
    const sim = e.simulateLaunch(cfg.accelCalibration, true);
    if (sim.trace && sim.trace.length > 1) {
      const step = Math.max(1, Math.floor(sim.trace.length / 220));
      const v = [], rp = [];
      for (let i = 0; i < sim.trace.length; i += step) {
        const p = sim.trace[i];
        v.push([p.t, p.v]);
        rp.push([p.t, e.rpmRawAt(p.v, p.gear) / 1000]);
      }
      $('doku-chart-launch').innerHTML = renderLineChart({
        series: [{ points: v, color: '#5aa9ff', label: 'km/h' },
                 { points: rp, color: '#ff5c5c', dash: '3 3', label: '1000/min' }],
        xLabel: 'Zeit seit Vollgas (s)', yLabel: 'km/h  bzw.  Drehzahl / 1000',
        yMin: 0, ariaLabel: 'Geschwindigkeit und Drehzahl über der Zeit',
      });
    }

    $('doku-chart-params').textContent =
      `Gezeichnet aus den aktuellen Einstellungen: Vmax ${cfg.topSpeedKmh.toFixed(1)} km/h, `
      + `0-auf-100-Anzeige ${cfg.launchAnchorTimeS.toFixed(1)} s (gemessen ${sim.time.toFixed(2)} s), `
      + `Ausrollen x${cfg.coastDragPerS.toFixed(2)} auf `
      + `${cfg.coastRollDecel.toFixed(2)}+${cfg.coastEngineDecel.toFixed(2)}·u`
      + `+${cfg.coastAeroDecel.toFixed(2)}·u², `
      + `Bremse ${cfg.brakeDecelBase.toFixed(2)}+${cfg.brakeDecelAero.toFixed(2)}·v km/h/s, `
      + `Kalibrierfaktor ${cfg.accelCalibration.toFixed(3)}. Gangbaender: `
      + cfg.gears.map((g, i) => `${i + 1}. bis ${(g.topFrac * cfg.topSpeedKmh).toFixed(2)}`).join(', ') + ' km/h.';
    drivetrainChartsDirty = false;
  }

  // ---- Track drawing ----
  // Two modes from one function. `detailed` draws a real roadway for the editor: black
  // surface, white joints between elements, kerbs, ideal line. Without it you get the thin
  // line the dashboard minimap needs, where a 220px map has no room for any of that.
  //
  // Kerb colours follow the direction of travel: LEFT is blue/white, RIGHT is red/white.
  // They are drawn as a solid white line with a dashed coloured line on top, which is how a
  // real kerb alternates, and it needs no per-block geometry.
  // How hard a car would be braking at each sample of a path, 0 = on the power,
  // 1 = braking hard. Simple by design (first version): look a fixed distance ahead and
  // compare the curvature there with the curvature here. Getting tighter means brake.
  //
  // Curvature from three consecutive points via the circumradius: k = 4A / (a*b*c), with A
  // the triangle area. That is exact for a circle through the three points and needs no
  // derivatives, which matters because the samples are not evenly spaced.
  const BRAKE_LOOKAHEAD = 6;     // samples; ~ half a tile at TRACK_SAMPLES_PER_TILE
  const BRAKE_SMOOTH = 4;        // samples of moving average, so the colour does not flicker

  function pathCurvature(pathPts, closed) {
    const n = pathPts.length;
    const at = (i) => pathPts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1);
      const a = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const b = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const c = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
      const area2 = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]));
      out[i] = (a * b * c) < 1e-6 ? 0 : (2 * area2) / (a * b * c);
    }
    return out;
  }

  function brakeProfile(pathPts, closed) {
    const n = pathPts.length;
    const k = pathCurvature(pathPts, closed);
    const kMax = Math.max(1e-9, ...k);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    const raw = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      // Braking demand is the RISE in curvature ahead, normalised. A corner already being
      // held at constant radius needs no braking — that is why this is a difference and
      // not simply "curvature is high".
      const rise = k[at(i + BRAKE_LOOKAHEAD)] - k[i];
      raw[i] = Math.max(0, Math.min(1, rise / (kMax * 0.55)));
    }
    // Moving average, or single noisy samples would speckle the line red.
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -BRAKE_SMOOTH; d <= BRAKE_SMOOTH; d++) sum += raw[at(i + d)];
      out[i] = sum / (2 * BRAKE_SMOOTH + 1);
    }
    return out;
  }

  // Green through amber to red. Interpolated in RGB, which is crude colour science but
  // exactly right here: the amber midpoint is what makes the transition read as gradual.
  function brakeColour(v) {
    const t = Math.max(0, Math.min(1, v));
    const stops = [[0, 70, 209, 127], [0.5, 232, 176, 46], [1, 214, 45, 45]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i + 1 < stops.length; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
    }
    const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    const mix = (i) => Math.round(a[i] + (b[i] - a[i]) * f);
    return `rgb(${mix(1)},${mix(2)},${mix(3)})`;
  }

  function renderTrackPreview(tiles, currentIndex, opts) {
    const o = opts || {};
    if (!tiles || tiles.length === 0) {
      return { html: '<p class="muted">Keine Streckenteile.</p>', closed: false };
    }
    const pts = trackCenterline(tiles);
    if (pts.length < 2) {
      return { html: '<p class="muted">Keine Streckenteile.</p>', closed: false };
    }
    const nrm = trackNormals(pts);
    const first = pts[0], last = pts[pts.length - 1];
    // 2 cm statt 60 Zeichnungseinheiten.
     //
     // 60 Einheiten sind 64,5 cm, und eine Kachel ist 43 cm lang: sie passte in die
     // Toleranz. Der Editor meldete deshalb SR6, SL6 und SHGHG als "Geschlossen", obwohl
     // bei allen dreien genau eine Kachel fehlt - eine Anzeige, die bei einer Luecke von
     // einer Kachelbreite noch gruen sagt, ist keine Anzeige. 2 cm lassen Rundungsfehler
     // durch und nichts sonst. Gefunden hat es der Selbsttest.
    const closed = Math.hypot(last.x - first.x, last.y - first.y)
                   < 2 * TRACK_UNITS_PER_CM;

    const half = TRACK_HALF_W;
    const pad = o.detailed ? half + 14 : 30;
    const all = [...pts.map(p => [p.x, p.y])];
    if (o.detailed) {
      all.push(...offsetPath(pts, nrm, half + 6), ...offsetPath(pts, nrm, -(half + 6)));
    }
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX) + pad * 2, h = Math.max(1, maxY - minY) + pad * 2;
    const ox = pad - minX, oy = pad - minY;
    const P2 = (p) => `${(p[0] + ox).toFixed(1)} ${(p[1] + oy).toFixed(1)}`;
    const poly = (arr) => 'M ' + arr.map(P2).join(' L ');
    const centre = pts.map(p => [p.x, p.y]);

    let body = '';
    if (o.detailed) {
      // 1) The roadway itself: one very wide black stroke along the centreline.
      body += `<path d="${poly(centre)}" fill="none" stroke="#14181f" stroke-width="${half * 2}" stroke-linecap="butt" stroke-linejoin="round"/>`;

      // 2) Pit bulge, on the driver's RIGHT — the blue side, as on the real track. It used
      //    to be drawn on the positive normal, which the sign check above shows is the LEFT.
      //    Hence the -1 factor: same shape, correct side.
      tiles.forEach((t, idx) => {
        if (t.type !== TILE_TYPE.PIT) return;
        const seg = pts.map((p, i) => ({ p, i })).filter(q => q.p.tile === idx);
        if (seg.length < 3) return;
        const SIDE = -1;   // -1 = driver's right
        const inner = seg.map(q => [q.p.x + nrm[q.i].x * half * SIDE,
                                    q.p.y + nrm[q.i].y * half * SIDE]);
        const outer = seg.map((q, k) => {
          // A smooth bulge: zero at both ends, widest in the middle.
          const u = k / (seg.length - 1);
          const bulge = Math.sin(u * Math.PI) * half * 1.15;
          return [q.p.x + nrm[q.i].x * (half + bulge) * SIDE,
                  q.p.y + nrm[q.i].y * (half + bulge) * SIDE];
        });
        body += `<path d="${poly(inner)} L ${outer.slice().reverse().map(P2).join(' L ')} Z" fill="#14181f" stroke="none"/>`;
        const mid = outer[Math.floor(outer.length / 2)];
        body += `<text x="${(mid[0] + ox).toFixed(1)}" y="${(mid[1] + oy).toFixed(1)}" fill="#ffb02e" font-size="9" font-weight="700" text-anchor="middle">BOX</text>`;
      });

      // 3) Joints: a white tick across the roadway at every element boundary, so the
      //    individual pieces are visible instead of one continuous ribbon.
      const perTile = TRACK_SAMPLES_PER_TILE;
      for (let k = 0; k <= tiles.length; k++) {
        const i = Math.min(pts.length - 1, k * perTile);
        const A = [pts[i].x + nrm[i].x * half, pts[i].y + nrm[i].y * half];
        const B = [pts[i].x - nrm[i].x * half, pts[i].y - nrm[i].y * half];
        body += `<path d="M ${P2(A)} L ${P2(B)}" stroke="#ffffff" stroke-width="1.6" opacity=".85"/>`;
      }

      // 4) Kerbs. Right = red/white, left = blue/white, both relative to travel direction.
      // SIGN CHECK, because the old names were backwards and the legend followed them:
      // trackNormals() rotates the tangent by -90 degrees, so a POSITIVE offset is the
      // driver's LEFT. Heading north the tangent is (0,-1) and the normal comes out (-1,0),
      // which on screen (y downwards) points left. The colours happened to be right anyway;
      // the labels were not.
      const kerbLeft = offsetPath(pts, nrm, half + TRACK_KERB_W / 2);
      const kerbRight = offsetPath(pts, nrm, -(half + TRACK_KERB_W / 2));
      const kw = TRACK_KERB_W;
      // Brighter than the real kerb paint, on purpose: these are drawn on a dark track view
      // now, and the actual #b3131f / #1565c0 came out at under 3:1 against it.
      [[kerbLeft, '#ff5c5c'], [kerbRight, '#5aa9ff']].forEach(([path, col]) => {
        body += `<path d="${poly(path)}" fill="none" stroke="#ffffff" stroke-width="${kw}" stroke-linecap="butt"/>`;
        body += `<path d="${poly(path)}" fill="none" stroke="${col}" stroke-width="${kw}" stroke-linecap="butt" stroke-dasharray="7 7"/>`;
      });

      // 5) The ideal line, from the same geometry, coloured by whether a car would be
      //    braking there. Green = on the power, red = braking, and the transition is drawn
      //    as a gradient rather than a hard switch because braking builds up over metres,
      //    not at a point.
      //
      //    First version deliberately simple, as specified: brake where the curvature AHEAD
      //    is about to rise. Curvature is read from the ideal line itself, not the
      //    centreline — the whole point of the line is that it changes the radius, so using
      //    the centreline would colour a corner the car no longer takes that tightly.
      const line = buildLine(pts, nrm, { closed });
      const ideal = pts.map((p, i) => [p.x + nrm[i].x * line.alpha[i],
                                       p.y + nrm[i].y * line.alpha[i]]);
      const brake = brakeProfile(ideal, closed);
      // One short segment per sample pair, each with its own colour. A single path with a
      // gradient cannot follow an arbitrary curve, so the curve is cut instead.
      const IDEAL_W = 1.1;   // was 2.2; halved on request, the line was heavier than the kerbs
      for (let i = 0; i + 1 < ideal.length; i++) {
        const v = (brake[i] + brake[i + 1]) / 2;
        body += `<path d="M ${P2(ideal[i])} L ${P2(ideal[i + 1])}" fill="none" `
              + `stroke="${brakeColour(v)}" stroke-width="${IDEAL_W}" stroke-linecap="round"/>`;
      }
      o.lineInfo = line;
    } else {
      body += `<path d="${poly(centre)}" fill="none" stroke="#7d8698" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // Start line and the live position marker.
    const i0 = 0;
    const sA = [pts[i0].x + nrm[i0].x * half, pts[i0].y + nrm[i0].y * half];
    const sB = [pts[i0].x - nrm[i0].x * half, pts[i0].y - nrm[i0].y * half];
    body += o.detailed
      ? `<path d="M ${P2(sA)} L ${P2(sB)}" stroke="#3ddc84" stroke-width="4"/>`
      : `<circle cx="${(first.x + ox).toFixed(1)}" cy="${(first.y + oy).toFixed(1)}" r="5" fill="#1c7a4d"/>`;
    // ---- Die Autos ----------------------------------------------------------------
    //
    // `currentIndex` zeichnet EIN Auto und bleibt fuer alte Aufrufer; `o.cars` zeichnet
    // beliebig viele, mit Farbe und Kuerzel. Ein Eintrag ist
    // { index, phase, farbe, kuerzel } - phase ist die Lage INNERHALB der Kachel, 0 bis 1.
    //
    // DER VERSATZ: die alte Zeile rechnete (index + 1) * Abtastpunkte, also das ENDE der
    // Kachel, auf der das Auto steht - eine ganze Kachel zu weit. Richtig ist der Anfang
    // plus die Phase. Genauer geht es nicht: das Auto ortet sich nicht, es zaehlt Kacheln.
    const proSchritt = o.detailed ? TRACK_SAMPLES_PER_TILE : 1;
    const autoPunkt = (index, phase, farbe, kuerzel) => {
      if (index === null || index === undefined) return '';
      const roh = (index + Math.max(0, Math.min(1, phase || 0))) * proSchritt;
      const i = Math.max(0, Math.min(Math.round(roh), pts.length - 1));
      const p = pts[i];
      const x = (p.x + ox).toFixed(1), y = (p.y + oy).toFixed(1);
      // Weisser Ring, damit der Punkt auf der grauen Bahn UND auf dem dunklen Grund steht.
      let t = `<circle cx="${x}" cy="${y}" r="6" fill="${farbe || '#ff5c5c'}" `
            + `stroke="#fff" stroke-width="2"/>`;
      if (kuerzel) {
        t += `<text x="${x}" y="${(p.y + oy - 10).toFixed(1)}" text-anchor="middle" `
           + `font-size="11" font-weight="700" fill="#fff" `
           + `stroke="#0b0c0f" stroke-width="3" paint-order="stroke"`
           + `>${kuerzel}</text>`;
      }
      return t;
    };
    if (currentIndex != null) body += autoPunkt(currentIndex, 0, '#ff5c5c', null);
    if (o.cars) {
      for (const c of o.cars) body += autoPunkt(c.index, c.phase, c.farbe, c.kuerzel);
    }

    const style = o.detailed
      ? 'width:100%;max-width:520px;height:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:6px'
      : 'width:220px;height:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:4px';
    const html = `<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="${style}">${body}</svg>`;
    return { html, closed, lineInfo: o.lineInfo };
  }


  // ---- Short track code ----
  // One letter per element with a run-length count, plus the orientation. Short enough to
  // type over the phone, and readable enough to check by eye: "S G3 R2" is a start, three
  // straights, two right-handers. Deliberately not JSON in base64 — a code you cannot read
  // is a code you cannot verify.
  // H und J fuer die beiden Haarnadeln. Die Linkskurve hatte keinen Buchstaben, also fiel
  // sie beim Kopieren einer Strecke stillschweigend heraus.
  const TRACK_CODE_LETTER = { [TILE_TYPE.START]: 'S', [TILE_TYPE.STRAIGHT]: 'G',
                              [TILE_TYPE.CURVE_RIGHT]: 'R', [TILE_TYPE.CURVE_LEFT]: 'L',
                              [TILE_TYPE.PIT]: 'B', [TILE_TYPE.HAIRPIN]: 'H',
                              [TILE_TYPE.HAIRPIN_LEFT]: 'J' };
  const TRACK_CODE_TYPE = Object.fromEntries(
    Object.entries(TRACK_CODE_LETTER).map(([k, v]) => [v, Number(k)]));

  function trackToCode(tiles, rotation) {
    let out = '', i = 0;
    while (i < tiles.length) {
      const letter = TRACK_CODE_LETTER[tiles[i].type];
      if (!letter) { i++; continue; }
      let n = 1;
      while (i + n < tiles.length && tiles[i + n].type === tiles[i].type) n++;
      out += letter + (n > 1 ? n : '');
      i += n;
    }
    const rot = ((rotation % 360) + 360) % 360;
    return out + (rot ? '@' + rot : '');
  }

  function codeToTrack(code) {
    // Jeder Buchstabe muss in BEIDE Ausdruecke, und genau davor warnt der Kommentar hier
    // seit der Haarnadel R - und genau das ist mit der Haarnadel L trotzdem passiert: der
    // Kodierer schrieb J, der Leser kannte es nicht, also fiel jede Linkshaarnadel beim
    // Einlesen still heraus und wurde beim naechsten Kopieren ueberschrieben. Die Menge
    // steht deshalb jetzt an EINER Stelle und wird aus TRACK_CODE_LETTER gebildet, statt
    // zweimal von Hand aufgezaehlt zu werden.
    const letters = Object.values(TRACK_CODE_LETTER).join('');
    // 0-9 statt \d, weil der Ausdruck hier aus einer Zeichenkette gebaut wird: in einer
    // JS-Zeichenkette muesste die Rueckwaertsschraege verdoppelt werden, und eine einfache
    // ergibt stillschweigend nur den Buchstaben d - dann faellt jede Zahl im Code durch und
    // "SG2HG2J" gilt als unlesbar. Ein Zeichenbereich braucht keine Maskierung.
    const m = String(code).trim().toUpperCase()
      .match(new RegExp('^([' + letters + '0-9]*)(?:@([0-9]{1,3}))?$'));
    if (!m || !m[1]) return null;
    const tiles = [];
    const re = new RegExp('([' + letters + '])([0-9]*)', 'g');
    let hit;
    while ((hit = re.exec(m[1])) !== null) {
      const type = TRACK_CODE_TYPE[hit[1]];
      const n = hit[2] ? parseInt(hit[2], 10) : 1;
      if (!type || !(n >= 1 && n <= 99)) return null;
      for (let k = 0; k < n; k++) tiles.push({ type });
    }
    if (!tiles.length) return null;
    // A layout always starts at start/finish; the anchor is not optional elsewhere in the
    // app, so importing something without it would break the lap counting.
    if (tiles[0].type !== TILE_TYPE.START) tiles.unshift({ type: TILE_TYPE.START });
    const rot = m[2] ? parseInt(m[2], 10) : 0;
    return { tiles, rotation: (Math.round(rot / 90) * 90) % 360 };
  }

  $('track-code-copy').onclick = async () => {
    const v = $('track-code').value;
    try { await navigator.clipboard.writeText(v); showHudToast('Code kopiert'); }
    catch (e) { $('track-code').select(); showHudToast('Bitte manuell kopieren'); }
  };

  $('track-code-apply').onclick = () => {
    const parsed = codeToTrack($('track-code-in').value);
    if (!parsed) { alert('Code nicht lesbar. Erwartet z. B. SG3R2G2R2@90 (S Start, G Gerade, R rechts, L links, H Haarnadel, B Box)'); return; }
    currentTrackTiles = parsed.tiles;
    trackRotationDeg = parsed.rotation;
    const rv = $('track-rotation-val');
    if (rv) rv.textContent = trackRotationDeg + '\u00b0';
    refreshTrackPreview();
    log(`Strecke aus Code übernommen: ${parsed.tiles.length} Teile, ${parsed.rotation}°`, 'info');
    showHudToast('Strecke übernommen');
  };

  // Wo die Autos gerade stehen, fuer die Karte. Eine Kachelnummer und eine Phase je Auto.
  //
  // ZWEI QUELLEN, und beide zaehlen dasselbe Byte: der Ghost fuehrt tileIndex und tileStart
  // in seinem Zustand mit, das gesteuerte Auto laeuft ueber dashMinimapIndex. Die Phase ist
  // geschaetzt - Zeit seit dem Kachelwechsel durch die erwartete Kacheldauer -, denn das Auto
  // ortet sich nicht. Genau das steht auch in der Doku unter "keine echte Ortung".
  //
  // Defensiv gegen die Ladereihenfolge: 90-ghosts.js wird SPAETER gebaut, garage und ghostCfg
  // sind zur Ladezeit in ihrer temporalen Todeszone. refreshTrackPreview() laeuft aber auch
  // beim Laden, also darf hier nichts davon ungeschuetzt stehen.
  function trackCarMarks() {
    const out = [];
    // Der typeof-Test steht INNEN: bei einem noch nicht ausgewerteten const wirft schon
    // typeof, und diese Funktion laeuft beim Laden mit. Ein Wurf hier nimmt die ganze IIFE
    // mit - genau die Falle, die in diesem Projekt schon OMEGA_TEST verschwinden liess.
    try {
      if (typeof garage === 'undefined') return out;
      const now = Date.now();
      garage.forEach(c => {
        const g = c.ghost;
        if (g && g.tileIndex !== null && g.tileIndex !== undefined) {
          const dauer = (g.tileMs || 800)
            * (typeof ghostTileLenFactor === 'function' ? ghostTileLenFactor(g.tileIndex) : 1);
          const ph = g.tileStart ? Math.min(1, (now - g.tileStart) / Math.max(1, dauer)) : 0;
          out.push({ index: g.tileIndex, phase: ph, farbe: c.farbe || '#ffb02e',
                     kuerzel: (c.name || '?').slice(0, 3) });
        } else if (c.role === 'player' && typeof dashMinimapIndex === 'number') {
          out.push({ index: dashMinimapIndex, phase: 0.5, farbe: c.farbe || '#5aa9ff',
                     kuerzel: (c.name || 'Ich').slice(0, 3) });
        }
      });
    } catch (e) { return out; }
    return out;
  }

  // Die Karte auffrischen, WAEHREND gefahren wird - sonst kleben die Autopunkte dort, wo
  // sie beim letzten Streckenwechsel standen.
  //
  // NUR WENN DER STRECKENREITER SICHTBAR IST, und das ist der ganze Trick: der Aufbau der
  // Karte ist ein innerHTML mit gut zwanzig Pfaden, und er laeuft auf demselben Faden wie der
  // 45-ms-Sendetakt. Wer im Cockpit fahrt, soll ihn nicht bezahlen. Vier Mal je Sekunde
  // reicht: schneller kann man einen Punkt auf einer 220-px-Karte nicht unterscheiden.
  setInterval(() => {
    const tab = document.getElementById('tab-track');
    if (!tab || !tab.offsetParent) return;
    if (!currentTrackTiles.length) return;
    if (!trackCarMarks().length) return;
    refreshTrackPreview();
  }, 250);

  function refreshTrackPreview() {
    // Die Kachelzahl entscheidet, ob der Windschatten ueberhaupt rechnen kann. Hier gerufen
    // und nicht in 50-drive.js beim Laden: dort ist currentTrackTiles noch in der temporalen
    // Todeszone, siehe den Kommentar bei dirtyAirVerfuegbar().
    if (typeof dirtyAirVerfuegbar === 'function') dirtyAirVerfuegbar();
    // MIT den Autos, seit v0.5.1. Vorher stand hier ausdruecklich null, also gar kein
    // Auto - und der gruene Strich auf der Startgeraden, den man dafuer hielt, ist die
    // Start/Ziel-Linie.
    const result = renderTrackPreview(currentTrackTiles, null,
      { detailed: true, cars: trackCarMarks() });
    $('track-preview-svg').innerHTML = result.html;
    renderTrackPalette();
    updateTrackSpace();
    $('track-code').value = trackToCode(currentTrackTiles, trackRotationDeg);
    const info = $('track-line-info');
    if (info) {
      // Residual in millimetres: a bare number in drawing units means nothing to a reader.
      const li = result.lineInfo;
      info.textContent = li
        ? `Ideallinie nutzt ${(li.span / TRACK_UNITS_PER_CM).toFixed(1)} cm `
          + `von ${(li.limit / TRACK_UNITS_PER_CM).toFixed(1)} cm möglichem Versatz`
        : '';
    }
    $('track-closed-badge').textContent = currentTrackTiles.length === 0 ? '-' : (result.closed ? 'Geschlossen ✓' : 'Offen');
    const list = $('track-tile-list');
    // The first tile is the Start/Finish anchor and is not deletable.
    list.innerHTML = currentTrackTiles.map((t, i) =>
      `<li>${TILE_LABEL[t.type] || ('0x' + t.type.toString(16))}
        ${i === 0 ? '<span class="muted" style="font-size:11px">(fest)</span>'
                  : `<button data-idx="${i}" class="track-del-btn" style="padding:1px 6px;font-size:11px;margin-left:6px">×</button>`}</li>`
    ).join('');
    list.querySelectorAll('.track-del-btn').forEach(btn => {
      btn.onclick = () => {
        // Der Knopf wird fuer Index 0 gar nicht erst gezeichnet; der Riegel steht trotzdem
        // hier, weil die Liste die einzige Stelle ist, die nach Index loescht.
        const i = parseInt(btn.dataset.idx, 10);
        if (!(i > 0)) return;
        currentTrackTiles.splice(i, 1);
        refreshTrackPreview();
      };
    });
    $('track-rotation-val').textContent = trackRotationDeg + '°';
    if (typeof refreshMinimap === 'function') refreshMinimap();
  }

  // Genau eine Start/Ziel-Kachel, und sie liegt auf Index 0. freshTrackTiles() legt sie
  // an, der Import und das Laden stellen sie voran - nur addTile() hatte keinen Schutz, und
  // der Start-Knopf in der Palette konnte sie beliebig oft hinten anhaengen. Eine zweite
  // Start-Kachel bricht die Rundenzaehlung, weil sie sich auf die eine Ueberfahrt stuetzt.
  function addTile(type) {
    if (type === TILE_TYPE.START && currentTrackTiles.some(t => t.type === TILE_TYPE.START)) {
      showHudToast('Start/Ziel gibt es nur einmal');
      return;
    }
    currentTrackTiles.push({ type });
    refreshTrackPreview();
  }
  // ---- Symbol palette ----
  // The same five actions as the text buttons above, as icons, so they still fit under the
  // map in fullscreen. Order follows the physical layout of a controller's thinking:
  // left curve, straight, start/finish, pit, right curve — turning left on the left.
  // Die Leiste ist wie das Lenkrad angeordnet: was nach LINKS dreht, liegt links, was nach
  // RECHTS dreht, rechts, die Geraden in der Mitte. Die beiden Haarnadeln stehen ganz
  // aussen, weil sie die extremste Drehung sind - und weil man sie so am Rand des Schirms
  // mit dem Daumen trifft. Vorher lagen BEIDE Haarnadeln rechts, eine Linkshaarnadel war
  // also am falschen Ende zu suchen.
  const TRACK_PALETTE = [
    { key: 'hairpin-left', type: () => TILE_TYPE.HAIRPIN_LEFT, cap: 'Haarnadel L',
      icon: '<path d="M16 22 L16 14 A5 5 0 0 0 6 14 L6 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          + '<path d="M16 22 L16 19" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' },
    { key: 'left',  type: () => TILE_TYPE.CURVE_LEFT,  cap: 'Links',
      icon: '<path d="M18 22 L18 13 A7 7 0 0 0 11 6 L4 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    { key: 'straight', type: () => TILE_TYPE.STRAIGHT, cap: 'Gerade',
      icon: '<path d="M12 22 L12 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    { key: 'pit', type: () => TILE_TYPE.PIT, cap: 'Box',
      icon: '<path d="M8 22 L8 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          + '<path d="M16 20 L16 9 A5 5 0 0 1 21 4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.5" stroke-linecap="round"/>' },
    { key: 'right', type: () => TILE_TYPE.CURVE_RIGHT, cap: 'Rechts',
      icon: '<path d="M6 22 L6 13 A7 7 0 0 1 13 6 L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    { key: 'hairpin', type: () => TILE_TYPE.HAIRPIN, cap: 'Haarnadel R',
      icon: '<path d="M8 22 L8 14 A5 5 0 0 1 18 14 L18 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          + '<path d="M8 22 L8 19" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' },
  ];
  // Die Gerade ist das haeufigste Teil und damit die billigste Vorauswahl. GESUCHT statt
  // gezaehlt: hier stand eine 2, die an der Reihenfolge oben hing, und beim Entfernen der
  // Start-Kachel waere sie beinahe still auf ein anderes Teil gezeigt. Ein Index, der an
  // einer Reihenfolge haengt, wird beim naechsten Umsortieren falsch, ohne dass es auffaellt.
  let trackPaletteSel = Math.max(0, TRACK_PALETTE.findIndex(p => p.key === 'straight'));

  // Hier standen bis v0.5 zwei Tabellen und zwei Linkbauer fuer die Probe- und
  // Vorlaufblaetter zur Musterentzifferung. Sie sind weg, weil die Frage BEANTWORTET
  // ist: die drei fuehrenden duennen Striche lassen sich abschneiden und das Blatt
  // wird weiter gelesen, der Vorlauf ist also kein Nutzdatum, und ein Wort genuegt.
  // Das Ergebnis steht in CARRERA_HYBRID.md und in der Druckvorlagen-Seite.
  //
  // Die Blaetter selbst erzeugt tools/make_patterns.py in einem Aufruf wieder, falls
  // doch noch eine Probe gebraucht wird. Der Generator ist die Quelle, die SVG waren
  // das Ergebnis - und 21 Ergebnisse im Wurzelverzeichnis auszuliefern war der Fehler.

  function renderTrackPalette() {
    const host = $('track-palette');
    if (!host) return;
    host.innerHTML = '';
    TRACK_PALETTE.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'tp-btn' + (i === trackPaletteSel ? ' sel' : '');
      b.title = p.cap;
      b.setAttribute('aria-label', p.cap);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${p.icon}</svg>`
                  + `<span class="tp-cap">${p.cap}</span>`;
      b.onclick = () => { trackPaletteSel = i; renderTrackPalette(); addTile(p.type()); };
      host.appendChild(b);
    });
  }

  // How much room the layout needs, in centimetres, from the same geometry the map uses —
  // so the number cannot disagree with the picture. Bounding box of the roadway including
  // its width, not just the centreline: it is the space on the floor that matters.
  function updateTrackSpace() {
    const el = $('track-space');
    if (!el) return;
    if (!currentTrackTiles.length) { el.textContent = ''; return; }
    const pts = trackCenterline(currentTrackTiles);
    if (pts.length < 2) { el.textContent = ''; return; }
    const nrm = trackNormals(pts);
    const all = [];
    pts.forEach((p, i) => {
      all.push([p.x + nrm[i].x * TRACK_HALF_W, p.y + nrm[i].y * TRACK_HALF_W]);
      all.push([p.x - nrm[i].x * TRACK_HALF_W, p.y - nrm[i].y * TRACK_HALF_W]);
    });
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const wCm = (Math.max(...xs) - Math.min(...xs)) / TRACK_UNITS_PER_CM;
    const hCm = (Math.max(...ys) - Math.min(...ys)) / TRACK_UNITS_PER_CM;
    el.textContent = `${Math.round(wCm)} × ${Math.round(hCm)} cm · ${currentTrackTiles.length} Teile`;
  }

  // ---- Fullscreen for the editor ----
  async function enterTrackFullscreen() {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* refused: the CSS layout still applies */ }
    document.body.classList.add('track-fs');
    $('track-fs').hidden = true; $('track-fs-exit').hidden = false;
    refreshTrackPreview();
  }
  async function exitTrackFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* already out */ }
    document.body.classList.remove('track-fs');
    $('track-fs').hidden = false; $('track-fs-exit').hidden = true;
    refreshTrackPreview();
  }
  $('track-fs').onclick = enterTrackFullscreen;
  $('track-fs-exit').onclick = exitTrackFullscreen;
  // Leaving by Escape or a system gesture must put the buttons back too.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('track-fs')) {
      exitTrackFullscreen();
    }
  });

  // ---- Gamepad, only while the editor is in fullscreen ----
  // Gated on the fullscreen class rather than on the tab being visible: the same buttons
  // mean throttle and shifting while driving, and stealing them because a tab happens to be
  // open would be a nasty surprise. Returns true when a press was consumed.
  // Zwei Reihen, so wie sie auf dem Schirm liegen: oben die Aktionen, unten die Teile.
  // Hoch und runter wechselt die Reihe, links und rechts waehlt darin, X loest aus. Vorher
  // sprang hoch/runter auf das erste bzw. letzte Teil, was niemand erraten kann.
  const TRACK_ACTIONS = [
    { id: 'track-undo', cap: 'Zurueck' },
    { id: 'track-rotate-right', cap: 'Drehen' },
    { id: 'track-clear', cap: 'Leeren' },
    { id: 'track-fs-exit', cap: 'Schliessen' },
  ];
  let trackPadRow = 1;      // 0 = Aktionen oben, 1 = Teile unten
  let trackActionSel = 0;

  function renderTrackPadFocus() {
    renderTrackPalette();
    TRACK_ACTIONS.forEach((a, i) => {
      const el = $(a.id);
      if (el) el.classList.toggle('sel', trackPadRow === 0 && i === trackActionSel);
    });
  }

  function trackEditorPad(button) {
    if (!document.body.classList.contains('track-fs')) return false;
    const n = trackPadRow === 0 ? TRACK_ACTIONS.length : TRACK_PALETTE.length;
    switch (button) {
      case 'up':
      case 'down':
        trackPadRow = trackPadRow === 0 ? 1 : 0;
        renderTrackPadFocus();
        return true;
      case 'left':
        if (trackPadRow === 0) trackActionSel = (trackActionSel + n - 1) % n;
        else trackPaletteSel = (trackPaletteSel + n - 1) % n;
        renderTrackPadFocus();
        return true;
      case 'right':
        if (trackPadRow === 0) trackActionSel = (trackActionSel + 1) % n;
        else trackPaletteSel = (trackPaletteSel + 1) % n;
        renderTrackPadFocus();
        return true;
      case 'confirm':
        if (trackPadRow === 0) {
          const el = $(TRACK_ACTIONS[trackActionSel].id);
          if (el && !el.hidden) el.click();
        } else {
          addTile(TRACK_PALETTE[trackPaletteSel].type());
        }
        return true;
      // Die drei Direkttasten bleiben, damit man fuer Zurueck nicht erst die Reihe wechseln
      // muss - das ist die haeufigste Aktion beim Bauen.
      case 'undo':  $('track-undo').click(); return true;
      case 'reset': trackReset(); return true;
      case 'rotate': $('track-rotate-right').click(); return true;
      default: return false;
    }
  }

  // Reset is destructive and reachable by a single button press on a pad, so it asks first —
  // but only when there is actually something to lose.
  function trackReset() {
    if (currentTrackTiles.length > 1 && !confirm('Strecke wirklich zurücksetzen?')) return;
    $('track-clear').click();
  }

  // Hier standen sechs Bindungen auf Knopf-ids, die es seit dem Umbau auf die Bildleiste
  // nicht mehr gibt (track-add-start und fuenf weitere). Sie prueften auf Vorhandensein und
  // taten deshalb nie etwas - toter Code, der wie eine Funktion aussieht. Gebaut wird mit
  // renderTrackPalette().
  $('track-undo').onclick = () => {
    // The first tile is the start/finish anchor and is not removable — the lap counting
    // depends on it existing.
    if (currentTrackTiles.length <= 1) { showHudToast('Nichts zu entfernen'); return; }
    currentTrackTiles.pop();
    refreshTrackPreview();
  };
  $('track-clear').onclick = () => { currentTrackTiles = freshTrackTiles(); refreshTrackPreview(); };

  function rotateTrack(deltaDeg) {
    trackRotationDeg = (trackRotationDeg + deltaDeg + 360) % 360;
    refreshTrackPreview();
  }
  $('track-rotate-right').onclick = () => rotateTrack(90);

  function refreshTrackList() {
    const store = loadTrackStore();
    const sel = $('track-list');
    sel.innerHTML = '<option value="">-- gespeicherte Strecken --</option>';
    Object.keys(store).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name} (${store[name].tiles.length} Teile)`;
      sel.appendChild(opt);
    });
  }
  refreshTrackList();

  $('track-save').onclick = () => {
    const name = $('track-name').value.trim();
    if (!name) { alert('Bitte einen Namen für die Strecke eingeben.'); return; }
    if (currentTrackTiles.length === 0) { alert('Keine Streckenteile vorhanden.'); return; }
    const store = loadTrackStore();
    const now = new Date().toISOString();
    store[name] = { id: name, name, tiles: currentTrackTiles, rotation: trackRotationDeg, createdAt: store[name]?.createdAt || now, updatedAt: now };
    saveTrackStore(store);
    refreshTrackList();
    log(`Strecke "${name}" gespeichert (${currentTrackTiles.length} Teile).`, 'info');
  };
  $('track-load').onclick = () => {
    const name = $('track-list').value;
    if (!name) return;
    const store = loadTrackStore();
    if (!store[name]) return;
    // Gewandert, weil gespeicherte Strecken den Kacheltyp als Zahl halten und
    // Start/Ziel von 0x01 auf 0x0a gewechselt ist.
    currentTrackTiles = migrateTiles(store[name].tiles.slice());
    trackRotationDeg = store[name].rotation || 0;
    if (!currentTrackTiles.length || currentTrackTiles[0].type !== TILE_TYPE.START) {
      currentTrackTiles.unshift({ type: TILE_TYPE.START }); // older saves may predate the anchor
    }
    $('track-name').value = name;
    refreshTrackPreview();
  };
  $('track-delete').onclick = () => {
    const name = $('track-list').value;
    if (!name) return;
    const store = loadTrackStore();
    delete store[name];
    saveTrackStore(store);
    refreshTrackList();
  };

  // ---- Live track scan: subscribe to NUS TX, watch byte 11 (tile counter) for
  // changes, majority-vote byte 12 (tile type) across samples seen during that tile's
  // dwell to reject transition noise ----
  let trackScanning = false;
  let trackScanLastCounter = null;
  let trackScanTypeVotes = {};

  // Zwei Einspeiser, ein Verarbeiter. Der Ereignis-Weg bleibt fuer den Entwickler-Tab, der
  // Byte-Weg kommt aus onCarNotify - siehe startTrackScan, warum das noetig ist.
  function trackScanNotifyHandler(e) {
    trackScanBytes(notifyBytes(e.target.value));
  }

  function trackScanBytes(bytes) {
    if (!trackScanning) return;
    if (bytes.length < 16) return;
    // BUGFIX: byte 9 is the free-running per-PACKET counter (changes on ~every notify,
    // every ~45-70ms) — using it here treated almost every packet as a new tile
    // boundary, flooding the track with bogus single-sample tiles. Byte 11 is the
    // actual per-TILE counter (only changes when the car enters a new physical piece).
    const counter = bytes[11];
    const type = bytes[12];
    if (trackScanLastCounter === null) {
      trackScanLastCounter = counter;
      trackScanTypeVotes = {};
    }
    if (counter !== trackScanLastCounter) {
      // Mehrheit NUR unter echten Streckencodes. Das war der Fehler: 0xff heisst "gerade
      // keine Lesung" und ist der haeufigste Wert von allen - in einem Mitschnitt 16719 von
      // 16719 Paketen, im Dreiwagenrennen 7066 von 9623. Die Mehrheit war also fast immer
      // 0xff, fiel durch die Typpruefung, und die Kachel wurde STILL verworfen. Die
      // Streckenanzeige blieb bei "S", ohne dass irgendwo stand, warum.
      let bestType = null, bestCount = -1, dropped = 0;
      for (const [t, c] of Object.entries(trackScanTypeVotes)) {
        const ty = parseInt(t, 10);
        if (ty === 0xff || ty === TILE_OFFTRACK) { dropped += c; continue; }
        if (c > bestCount) { bestCount = c; bestType = ty; }
      }
      if (bestType != null && Object.values(TILE_TYPE).includes(bestType)) {
        currentTrackTiles.push({ type: bestType });
        refreshTrackPreview();
        $('track-scan-status').textContent = 'Scan läuft: ' + currentTrackTiles.length
          + ' Teile (zuletzt: ' + (TILE_LABEL[bestType] || bestType) + ')';
      } else {
        // Nicht mehr stumm: eine Kachel ohne einen einzigen echten Code ist eine Auskunft
        // und kein Nichts. Genau dieses Schweigen hat den Fehler oben verdeckt.
        trackScanSkipped++;
        $('track-scan-status').textContent = 'Scan läuft: ' + currentTrackTiles.length
          + ' Teile, ' + trackScanSkipped + ' ohne lesbaren Code'
          + (dropped ? ' (' + dropped + ' Pakete ohne Lesung)' : '');
      }
      trackScanLastCounter = counter;
      trackScanTypeVotes = {};
    }
    trackScanTypeVotes[type] = (trackScanTypeVotes[type] || 0) + 1;
  }

  let trackScanSkipped = 0;
  let trackScanCar = null;

  // ---- Rohcode-Monitor ----
  // Absichtlich getrennt vom Streckenscan: der Scan interpretiert (Mehrheit je Kachel,
  // unbekannte Werte verworfen), dieser hier zaehlt nur. Fuer die Frage "welchen Code hat
  // dieses Teil" ist gerade das Verwerfen das Problem - ein Wert, den wir nicht kennen, ist
  // genau der, den man sucht.
  const CODE_NAMES = { 0x00: 'kein Muster', 0x01: 'Start/Ziel', 0x02: 'Gerade',
                       0x03: 'Kurve links', 0x04: 'Kurve rechts',
                       0x05: 'Haarnadel links', 0x06: 'Haarnadel rechts',
                       0xff: 'keine Lesung' };
  let cmOn = false, cmCounts = {}, cmTotal = 0, cmPaint = 0, cmLastCar = null;

  // Drei weitere Signale, weil Byte 12 allein die Frage nicht beantwortet, ob der Sensor
  // ueberhaupt etwas sieht:
  //   Kachelzaehler  Byte 11 aendert sich, sobald das Auto ein neues Teil betritt. Zaehlt er
  //                  hoch, WERDEN Teile erkannt, auch wenn Byte 12 nur 0xff liefert.
  //   Musterkontakt  Byte 15 Bit 3 liegt an, solange das Auto auf einem gedruckten Muster
  //                  steht. Es haengt NICHT an Byte 12 - loest es aus, sieht der Sensor das
  //                  Blatt, und der Fehler sitzt beim Entschluesseln, nicht beim Lesen.
  //   Byte 3         kippte in einer Aufzeichnung mit der Kurvenrichtung. Unbestaetigt, aber
  //                  der einzige Kandidat fuer eine Drehrate - und damit die Grundlage, eine
  //                  Kurve am Lenkverhalten zu erkennen statt am Barcode.
  let cmLastBytes = null, cmSteps = 0, cmMarks = 0, cmPrevCount = null, cmPrevMark = false;
  let cmYawMin = 127, cmYawMax = -128;

  function cmTick(code, bytes, car) {
    if (!cmOn) return;
    if (car) cmLastCar = car;
    if (bytes) {
      cmLastBytes = bytes;
      if (cmPrevCount !== null && bytes[11] !== cmPrevCount) cmSteps++;
      cmPrevCount = bytes[11];
      const mark = (bytes[15] & 0x08) !== 0;
      if (mark && !cmPrevMark) cmMarks++;
      cmPrevMark = mark;
      const y = bytes[3] > 127 ? bytes[3] - 256 : bytes[3];
      if (y < cmYawMin) cmYawMin = y;
      if (y > cmYawMax) cmYawMax = y;
    }
    cmCounts[code] = (cmCounts[code] || 0) + 1;
    cmTotal++;
    $('cm-now').textContent = '0x' + code.toString(16).padStart(2, '0');
    $('cm-now').className = 'cm-now' + (CODE_NAMES[code] === undefined ? ' cm-new' : '');
    // Bei ~22 Paketen je Sekunde ist ein Neuzeichnen pro Paket verschwendet, und es laeuft
    // auf demselben Thread wie der Sendetakt.
    const now = Date.now();
    if (now - cmPaint < 250) return;
    cmPaint = now;
    cmRender();
    cmRenderHex();
    cmRenderExtra();
  }

  function cmRenderExtra() {
    if ($('cm-car')) {
      $('cm-car').textContent = cmLastCar ? garageLabel(cmLastCar) : '–';
    }
    // Der Scheinwerfer steht hier, weil er die haeufigste Ursache fuer "es kommt nichts" ist
    // und nicht in dieser Ansicht sichtbar war.
    const l = $('cm-light');
    if (l) {
      l.textContent = headlightsOn ? 'an' : 'AUS';
      l.style.color = headlightsOn ? 'var(--good)' : 'var(--bad)';
    }
    if ($('cm-steps')) $('cm-steps').textContent = cmSteps;
    if ($('cm-marks')) $('cm-marks').textContent = cmMarks;
    if ($('cm-yaw')) {
      $('cm-yaw').textContent = cmYawMax >= cmYawMin
        ? cmYawMin + ' … ' + cmYawMax : '–';
    }
  }

  function cmRenderHex() {
    const el = $('cm-hex');
    if (!el) return;
    const b = cmLastBytes;
    if (!b) { el.textContent = 'noch kein Paket'; return; }
    let idx = '', hex = '';
    for (let i = 0; i < b.length; i++) {
      const mark = (i === 11 || i === 12);
      const cell = String(i).padStart(2, ' ');
      idx += (mark ? '<b style="color:var(--info)">' + cell + '</b>' : cell) + ' ';
      const h = b[i].toString(16).padStart(2, '0');
      hex += (mark ? '<b style="color:var(--info)">' + h + '</b>' : h) + ' ';
    }
    el.innerHTML = '<span class="muted">Byte </span>' + idx + '<br>'
      + '<span class="muted">Wert </span>' + hex
      + '<br><span class="muted">Laenge ' + b.length + ' Byte</span>';
  }

  function cmRender() {
    $('cm-total').textContent = cmTotal;
    const rows = Object.entries(cmCounts)
      .map(([k, v]) => [parseInt(k, 10), v])
      .sort((a, b) => b[1] - a[1]);
    if (!rows.length) {
      $('cm-rows').innerHTML = '<tr><td colspan="4" class="muted">noch nichts gez\u00e4hlt</td></tr>';
      return;
    }
    const max = rows[0][1];
    $('cm-rows').innerHTML = rows.map(([code, n]) => {
      const known = CODE_NAMES[code];
      const pct = (n / cmTotal * 100).toFixed(1);
      return '<tr><td>0x' + code.toString(16).padStart(2, '0') + '</td>'
        + '<td' + (known === undefined ? ' class="cm-new"' : '') + '>'
        + (known === undefined ? 'UNBEKANNT' : known) + '</td>'
        + '<td>' + n + '</td>'
        + '<td><div class="cm-bar" style="width:' + Math.max(2, n / max * 100) + '%"></div>'
        + '<span class="muted" style="font-size:10.5px">' + pct + ' %</span></td></tr>';
    }).join('');
  }

  function cmReset() {
    cmCounts = {}; cmTotal = 0; cmLastBytes = null;
    cmSteps = 0; cmMarks = 0; cmPrevCount = null; cmPrevMark = false;
    cmYawMin = 127; cmYawMax = -128;
    cmRenderHex();
    cmRenderExtra();
    $('cm-now').textContent = '\u2013';
    $('cm-now').className = 'cm-now';
    cmRender();
  }

  // ---- Strecke beim Fahren lernen ----
  // Nicht dasselbe wie der Streckenscan: der laeuft auf Knopfdruck und schreibt sofort in
  // die Karte. Das hier laeuft nebenbei, waehrend ein Ghost seine Runden dreht, und
  // uebernimmt erst, wenn eine Runde nachweislich geschlossen ist. Ohne diese Bedingung
  // landete eine halbe Runde als Strecke in der Karte und der Vorausblick zeigte in die
  // falsche Richtung.
  // car: genau EIN Auto speist das Lernen. Mit zwei Autos liefen deren Kachelzaehler in
  // dasselbe Objekt, mischten sich und das gelernte Layout waere Unsinn gewesen - eine
  // Kachelfolge aus zwei Fahrzeugen ist keine Runde.
  const learn = { car: null, seq: [], votes: {}, lastCount: null, started: false, laps: 0 };

  function learnReset() {
    learn.car = null;
    learn.seq = []; learn.votes = {}; learn.lastCount = null;
    learn.started = false; learn.laps = 0;
  }

  function learnTick(bytes) {
    if (!ghostCfg.learn) return;
    const counter = bytes[11], type = bytes[12];
    if (learn.lastCount === null) { learn.lastCount = counter; learn.votes = {}; return; }
    if (counter === learn.lastCount) {
      learn.votes[type] = (learn.votes[type] || 0) + 1;
      return;
    }
    // Kachelgrenze: Mehrheit nur unter echten Codes, aus demselben Grund wie beim Scan -
    // 0xff heisst "keine Lesung" und ist der haeufigste Wert von allen.
    let best = null, bestN = -1;
    for (const [t, c] of Object.entries(learn.votes)) {
      const ty = parseInt(t, 10);
      if (ty === 0xff || ty === TILE_OFFTRACK) continue;
      if (c > bestN) { bestN = c; best = ty; }
    }
    learn.lastCount = counter;
    learn.votes = {};
    if (best === null) return;
    // Erst ab der ersten Start/Ziel-Kachel mitschreiben, sonst faengt die Folge irgendwo in
    // der Runde an und die gelernte Strecke ist gegen die echte verdreht.
    if (!learn.started) {
      // Gemeldeter Code, nicht Kacheltyp: hier kommt an, was das Auto sendet.
      if (!isStartCode(best)) return;
      learn.started = true;
      learn.seq = [{ type: TILE_TYPE.START }];
      return;
    }
    if (isStartCode(best)) {
      learn.laps++;
      if (learn.seq.length >= 3) learnCommit();
      learn.seq = [{ type: TILE_TYPE.START }];
      return;
    }
    learn.seq.push({ type: best });
    // Eine Runde kann nicht beliebig lang sein. Laeuft es davon, ist die Start/Ziel-Kachel
    // nicht erkannt worden, und weiterzuzaehlen wuerde nur Unsinn ansammeln.
    if (learn.seq.length > 60) { learnReset(); }
  }

  function learnCommit() {
    const got = learn.seq.slice();
    const had = currentTrackTiles.length;
    // Nur uebernehmen, wenn noch keine richtige Strecke da ist. Eine von Hand gebaute oder
    // gescannte Strecke ueberschreibt man nicht ungefragt.
    if (had > 1) {
      log('Runde gelernt (' + got.length + ' Teile), aber es liegt schon eine Strecke: '
          + 'nicht uebernommen.', 'info');
      return;
    }
    currentTrackTiles = got;
    refreshTrackPreview();
    log('Strecke beim Fahren gelernt: ' + got.length + ' Teile, '
        + got.filter(t => tileIsCurve(t.type)).length + ' davon Kurven. Ghosts haben ab '
        + 'jetzt Vorausblick.', 'info');
    showHudToast('STRECKE GELERNT: ' + got.length + ' TEILE');
  }
  async function startTrackScan() {
    trackScanSkipped = 0;
    // Zuerst das Auto aus der Garage: dessen Meldungen laufen schon durch onCarNotify, es
    // braucht also gar keine zweite Anmeldung. Nur wenn keines da ist, wird der Weg ueber
    // den BLE-Explorer versucht - der funktioniert weiterhin, ist aber nicht mehr die
    // Voraussetzung.
    trackScanCar = playerCar || garage.find(c => c.tx) || null;
    if (!trackScanCar) {
      const entry = charByUuid.get(NUS_TX);
      if (!entry) {
        alert('Kein Auto verbunden. Erst in der Garage verbinden, dann scannen.');
        return;
      }
      try {
        if (!entry._trackScanSubscribed) {
          await entry.char.startNotifications();
          entry.char.addEventListener('characteristicvaluechanged', trackScanNotifyHandler);
          entry._trackScanSubscribed = true;
        }
      } catch (err) { alert('Notify-Fehler: ' + err.message); return; }
    }
    currentTrackTiles = freshTrackTiles();
    trackScanLastCounter = null;
    trackScanTypeVotes = {};
    trackScanning = true;
    refreshTrackPreview();
    $('track-scan-start').disabled = true;
    $('track-scan-stop').disabled = false;
    $('track-scan-status').textContent = 'Scan läuft: 0 Teile'
      + (trackScanCar ? ' (' + garageLabel(trackScanCar) + ')' : ' (BLE-Explorer)');
  }
  function stopTrackScan() {
    trackScanning = false;
    trackScanCar = null;
    $('track-scan-start').disabled = false;
    $('track-scan-stop').disabled = true;
    $('track-scan-status').textContent = `Scan gestoppt (${currentTrackTiles.length} Teile).`;
  }
  $('track-scan-start').onclick = startTrackScan;
  $('track-scan-stop').onclick = stopTrackScan;

  // ---- Race dashboard: live battery/off-track/minimap-position/lap-timing ----
  // Battery is a rough two-point estimate (0x9b/155≈100%, 0x90/144≈75%, observed in an
  // earlier session) — not a calibrated formula, just enough for a rough gauge.
  let dashBattery = null;
