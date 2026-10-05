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
  // Genau deshalb blieb 0x01 lange in START_CODES: es war die alte Annahme, und seit dem
  // 26.08. hat es eine plausible Rolle als Code der Schiene.
  //
  // ---- UND SEIT v0.6.14 IST DAS BESTAETIGT, von aussen -------------------------------
  //
  // seVen hat eine byteweise Protokollbeschreibung geteilt, und auf Rueckfrage bestaetigt,
  // dass seine Codetabelle fuer den BAHN-MODUS gilt. Dort steht:
  //
  //     0x01  Start/Ziel        0x0A  Engstelle (NarrowSection)
  //
  // Das passt genau zu dem, was hier gemessen wurde - sobald man die Spalten richtig
  // zuordnet: 0x0a ist am GEDRUCKTEN Blatt im Ausdruck-Modus gemessen, ueber die
  // Kunststoffschiene war nie eine Messung da. (Die Tabelle in CARRERA_HYBRID.md hatte die
  // beiden Spalten vertauscht; sie ist mit dieser Fassung berichtigt.)
  //
  // FOLGE, und sie ist der Grund fuer die Aenderung: eine Liste aus BEIDEN Codes ist
  // modus-blind. Auf der Schiene wuerde damit jede ueberfahrene ENGSTELLE als Ziellinie
  // gelten - eine Phantomrunde je Ueberfahrt, und das Streckenlernen faengt dort neu an.
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
  // ---- DIE SECHS TEILE AUS seVens BAHN-TABELLE, seit v0.6.19 ----------------------
  //
  // Er hat auf Rueckfrage bestaetigt, dass seine Codetabelle fuer den BAHN-Modus gilt.
  // Damit sind sechs Codes benannt, die hier bisher fehlten:
  //
  //     0x07  Boxengasse / lange Gerade      0x0B / 0x0C  kleine 30-Grad-Kurve L / R
  //     0x08 / 0x09  grosse 30-Grad-Kurve L / R    0x0A  Engstelle
  //
  // ZWEI DAVON BEKOMMEN EINEN KUENSTLICHEN TYP, und zwar aus einem Grund, der sich nicht
  // umgehen laesst: die KARTE fuehrt Start/Ziel seit jeher als 0x0a, und auf der Schiene
  // ist 0x0a die Engstelle. Dieselbe Zahl, zwei Bedeutungen. Den Kartentyp zu aendern
  // hiesse, jede gespeicherte Strecke zu wandern; also bekommt die Engstelle einen Wert
  // ausserhalb des Bytebereichs - genau wie die Boxengasse ihn seit jeher hat.
  //
  // Die Uebersetzung zwischen GEMELDETEM CODE und KARTENTYP macht codeZuTyp() weiter unten,
  // an einer Stelle.
  const TILE_TYPE = { START: 0x0a, STRAIGHT: 0x02, CURVE_RIGHT: 0x04, CURVE_LEFT: 0x03,
                      HAIRPIN_LEFT: 0x05, HAIRPIN: 0x06,
                      // Grosse 30-Grad-Kurve ("Radius 2"): gemeldet als 0x08 / 0x09.
                      WEIT_LEFT: 0x08, WEIT_RIGHT: 0x09,
                      // Kleine 30-Grad-Kurve: gemeldet als 0x0B / 0x0C. Zwei davon ergeben
                      // eine 60-Grad-Kurve - vom Nutzer so angegeben und hier nachgerechnet.
                      KLEIN_LEFT: 0x0b, KLEIN_RIGHT: 0x0c,
                      // Kuenstlich, siehe oben. PIT wird als 0x07 gemeldet, ENGE als 0x0a.
                      PIT: 0x100, ENGE: 0x101 };

  // Was das Auto meldet, ist nicht immer, was die Karte fuehrt. EINE Stelle dafuer.
  const CODE_PIT = 0x07;
  const CODE_ENGE = 0x0a;

  function codeZuTyp(code) {
    if (code === undefined || code === null) return code;
    // Start/Ziel haengt an der Leseart - siehe isStartCode().
    if (isStartCode(code)) return TILE_TYPE.START;
    if (code === CODE_PIT) return TILE_TYPE.PIT;
    // NUR AUF DER SCHIENE. Im Ausdruck-Modus IST 0x0a der Startcode, und der ist schon
    // oben abgefangen - diese Zeile kann dort also gar nicht greifen. Sie steht trotzdem
    // mit Bedingung da, weil eine Uebersetzung, die den Modus nicht nennt, die naechste
    // Stelle ist, an der jemand die beiden verwechselt.
    if (typeof trackMode === 'string' && trackMode === 'on' && code === CODE_ENGE) {
      return TILE_TYPE.ENGE;
    }
    return code;
  }
  // Alles, was als Start/Ziel gilt, wenn das AUTO einen Code meldet. Fuer Kacheltypen im
  // Editor gilt weiter TILE_TYPE.START allein.
  const START_CODES = [0x0a, 0x01];
  const START_CODE_LEGACY = 0x01;
  // Je Leseart einer, benannt statt aufgezaehlt: wer das liest, sieht sofort, welcher wo
  // gilt. Die Liste darueber bleibt als Rueckfall und fuer isStartCode() ohne Leseart.
  const START_CODE_RAIL = 0x01;    // Kunststoffschiene, Bahn-Modus (seVen, bestaetigt)
  // Im Ausdruck-Modus melden je nach Vorlage BEIDE Werte das Start/Ziel-Blatt: das
  // Original meldet 0x0a (gemessen 25.08.), die App-Blaetter (startziel-a4.svg, muster-*,
  // spur-*) tragen das Wort, das 0x01 ergibt (siehe tools/make_track_sheets.py und
  // make_pattern_sheets.py). Deshalb zaehlt isStartCode() im Ausdruck-Modus beide.
  const START_CODE_PRINT = 0x0a;   // gedrucktes Blatt, Ausdruck-Modus (gemessen 25.08.)
  // AUS DER LISTE GELESEN und nicht daneben aufgezaehlt. Vorher stand hier
  // "c === 0x0a || c === START_CODE_LEGACY", und damit gab es die Tatsache "was gilt als
  // Start/Ziel" an ZWEI Orten - die Liste hatte keinen einzigen Leser und war die
  // aufgeschriebene Fassung ohne Wirkung. Die Durchsicht auf nicht verdrahtete Teile hat
  // sie als einzige Konstante ohne Leser gefunden.
  //
  // Wer einen dritten Code aufnimmt, aendert jetzt eine Stelle.
  // DIE LESEART ENTSCHEIDET. trackMode steht in 20-protocol.js ('on' = Bahn, 'off' =
  // Ausdruck) und ist zur Laufzeit da; diese Funktion laeuft nie zur Aufbauzeit.
  //
  // Der Rueckfall auf die Liste bleibt fuer den Fall, dass trackMode (noch) nicht gesetzt
  // ist - lieber ein Code zu viel akzeptiert als die Rundenzaehlung verloren, und genau so
  // stand es hier vorher schon.
  function isStartCode(c) {
    if (typeof trackMode === 'string') {
      if (trackMode === 'on') return c === START_CODE_RAIL;
      // Ausdruck: beide Werte. Auf der Schiene bleibt es strikt 0x01, damit die Engstelle
      // (0x0a) keine Phantomrunde zaehlt - der Grund, aus dem v0.6.14 die Leseart einzog.
      return c === START_CODE_PRINT || c === START_CODE_RAIL;
    }
    return START_CODES.indexOf(c) >= 0;
  }
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
    [TILE_TYPE.WEIT_LEFT]: 'Weite Kurve links',
    [TILE_TYPE.WEIT_RIGHT]: 'Weite Kurve rechts',
    [TILE_TYPE.KLEIN_LEFT]: 'Kleine Kurve links',
    [TILE_TYPE.KLEIN_RIGHT]: 'Kleine Kurve rechts',
    [TILE_TYPE.ENGE]: 'Engstelle',
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
  let trackRotationDeg = 0; // whole-track orientation, rotatable in 45° steps (v0.8.28)
  // Zuletzt gebaute Zufallsstrecken (Codes). Nicht nur die letzte: wer mehr merkt, bekommt
  // mehr Abwechslung. Das Fenster ist begrenzt, damit der Schutz die Erzeugung nicht blockiert
  // (s. trackZufall: faellt auf "nur nicht dieselbe wie zuletzt" zurueck).
  let trackZufallCodes = [];
  const TRACK_ZUFALL_CODE_MAX = 12;
  function trackZufallCodeKennt(code) { return trackZufallCodes.indexOf(code) >= 0; }
  function trackZufallCodeMerken(code) {
    // MRU: schon bekannt -> ans Ende, sonst anfuegen. So bleiben die gemerkten Codes ohne
    // Duplikate, und das Fenster zeigt die zuletzt gebauten Strecken.
    const i = trackZufallCodes.indexOf(code);
    if (i >= 0) trackZufallCodes.splice(i, 1);
    trackZufallCodes.push(code);
    if (trackZufallCodes.length > TRACK_ZUFALL_CODE_MAX) trackZufallCodes.shift();
  }

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
  // "Radius 2": die weite 30-Grad-Kurve. Herleitung bei tileRadius().
  // Wieviel die Engstelle je Seite hereinnimmt, als Anteil der halben Bahnbreite. Eine
  // DARSTELLUNG und keine Messung - siehe die Begruendung an der Zeichenstelle.
  const ENGE_ANTEIL = 0.34;
  const TRACK_R2_CM = 112;
  const TRACK_R2 = TRACK_R2_CM * TRACK_UNITS_PER_CM;
  const TRACK_TURN_DEG = 60;
  // Die halbe Kurve. Zwei davon ergeben eine 60-Grad-Kurve, zwoelf einen Kreis.
  const TRACK_30_DEG = 30;

  // One place decides how far a curved piece turns and how tight it is, so
  // trackCenterline() can never disagree about the geometry — they used to hardcode the same
  // two numbers separately.
  function tileTurnDeg(type) {
    if (type === TILE_TYPE.CURVE_RIGHT) return TRACK_TURN_DEG;
    if (type === TILE_TYPE.CURVE_LEFT) return -TRACK_TURN_DEG;
    if (type === TILE_TYPE.HAIRPIN) return TRACK_HAIRPIN_DEG;
    if (type === TILE_TYPE.HAIRPIN_LEFT) return -TRACK_HAIRPIN_DEG;
    // Beide 30-Grad-Teile drehen gleich WEIT; sie unterscheiden sich im RADIUS.
    if (type === TILE_TYPE.WEIT_RIGHT || type === TILE_TYPE.KLEIN_RIGHT) return TRACK_30_DEG;
    if (type === TILE_TYPE.WEIT_LEFT || type === TILE_TYPE.KLEIN_LEFT) return -TRACK_30_DEG;
    return 0;
  }
  function tileRadius(type) {
    if (type === TILE_TYPE.HAIRPIN || type === TILE_TYPE.HAIRPIN_LEFT) {
      return TRACK_HAIRPIN_RADIUS;
    }
    // ---- DIE WEITE KURVE, AUSGEMESSEN ---------------------------------------------
    //
    // Aus einem Bild des Original-Editors: zwoelf dieser Teile plus zwei Geraden bilden ein
    // geschlossenes Oval von 2,49 m x 2,93 m. Die Differenz der beiden Masse ist 0,44 m -
    // also eine Kachellaenge, was TRACK_TILE_CM = 43 bestaetigt und zeigt, dass die Masse
    // Aussenkanten sind. Aus 2R + Bahnbreite = 2,49 folgt R = 1,12 m.
    //
    // GEGENGEPRUEFT an einem Einzelteil: Start-Kachel plus eine Kurve misst im Editor
    // 0,38 x 1,05 m. Gerechnet ergibt der Radius 40 cm Breite (gemessen 38), und die
    // Laengendifferenz zwischen weiter und kleiner Kurve 38 cm (gemessen 37). Die Breite
    // und die Differenz stimmen also; in der absoluten Laenge bleibt ein Versatz von rund
    // 12 cm, der darauf deutet, dass die Start-Kachel kuerzer ist als eine volle Gerade.
    // Das ist NICHT nachgemessen und gehoert auf den Teppich.
    if (type === TILE_TYPE.WEIT_LEFT || type === TILE_TYPE.WEIT_RIGHT) return TRACK_R2;
    // Die kleine 30-Grad-Kurve hat denselben Radius wie die 60-Grad-Kurve: zwei von ihnen
    // ergeben eine. Vom Nutzer so angegeben, und die Zahl faellt damit ohne Messung heraus.
    return TRACK_RADIUS;
  }
  function tileIsCurve(type) {
    return type === TILE_TYPE.CURVE_RIGHT || type === TILE_TYPE.CURVE_LEFT
        || type === TILE_TYPE.HAIRPIN || type === TILE_TYPE.HAIRPIN_LEFT
        || type === TILE_TYPE.WEIT_LEFT || type === TILE_TYPE.WEIT_RIGHT
        || type === TILE_TYPE.KLEIN_LEFT || type === TILE_TYPE.KLEIN_RIGHT;
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

  // ---- Welche Abtastpunkte gehoeren zu welcher Kachel? -------------------------------
  //
  // AUS DEN PUNKTEN SELBST, und das ist die Behebung eines Fehlers, der drei Dinge auf
  // einmal kaputt gemacht hat.
  //
  // Es stand an mehreren Stellen `kachel * TRACK_SAMPLES_PER_TILE` - die Annahme, jede
  // Kachel liefere gleich viele Abtastpunkte. Sie tut es nicht: trackCenterline() vergibt
  // die Punkte nach DREHWINKEL, und gemessen auf SG2H2G2R2G2H2G2R2 sind das
  //
  //     Gerade      14 Punkte
  //     60-Grad     14 Punkte
  //     Haarnadel   49 Punkte
  //
  // 17 Kacheln ergaben so 379 Punkte, waehrend 17 x 14 = 238 gerechnet wurde. Folgen, alle
  // drei gemeldet:
  //
  //   Die weissen Stossfugen zwischen den Kacheln lagen falsch und HOERTEN nach 63 Prozent
  //   der Runde auf - dahinter klemmte Math.min sie alle auf den letzten Punkt.
  //   ("Da fehlen die Uebergaenge zwischen den Schienen")
  //
  //   Die Autopunkte lagen falsch und sprangen am Rundenende auf die Ziellinie, weil
  //   dieselbe Multiplikation ueber das Ende hinauslief.
  //   ("die Ghosts huepfen direkt von der ersten Rechtskurve unten zum Ziel")
  //
  // Die richtige Zuordnung war die ganze Zeit da: jeder Abtastpunkt traegt sein `tile`.
  // Der Pit-Zweig dieser Datei benutzt es schon (`q.p.tile === idx`) - nur die drei anderen
  // Stellen rechneten daran vorbei.
  function trackKachelTabelle(pts, anzahlKacheln) {
    const start = new Array(anzahlKacheln).fill(-1);
    const zahl = new Array(anzahlKacheln).fill(0);
    for (let i = 0; i < pts.length; i++) {
      const t = pts[i].tile;
      if (t === undefined || t === null || t < 0 || t >= anzahlKacheln) continue;
      if (start[t] < 0) start[t] = i;
      zahl[t]++;
    }
    // Kacheln ohne eigene Punkte gibt es nicht, aber ein Rueckfall kostet nichts und
    // verhindert, dass ein kuenftiger Kacheltyp ohne Abtastung hier NaN erzeugt.
    for (let t = 0; t < anzahlKacheln; t++) {
      if (start[t] < 0) {
        start[t] = t > 0 ? start[t - 1] + zahl[t - 1] : 0;
        zahl[t] = 1;
      }
    }
    return { start, zahl };
  }

  // Der Abtastpunkt fuer (Kachel, Phase). Die EINE Stelle, an der diese Rechnung steht.
  function trackPunktIndex(tab, pts, index, phase) {
    if (index === null || index === undefined || !tab) return 0;
    const n = tab.start.length;
    const k = ((Math.floor(index) % n) + n) % n;
    const ph = Math.max(0, Math.min(1, phase || 0));
    // zahl[k] UND NICHT zahl[k]-1, und das ist eine Berichtigung: mit -1 zeigte Phase 1 auf
    // den letzten Punkt DIESER Kachel, waehrend Phase 0 der naechsten auf deren ersten
    // zeigte - zwei benachbarte Abtastpunkte, gemessen 2,9 Einheiten auseinander. Die
    // Kachelgrenze war damit zwei Orte, und der Selbsttest "Autopunkte an der richtigen
    // Kachel" hat es sofort gemeldet: er verlangt, dass Kachel k bei Phase 1 dort liegt, wo
    // Kachel k+1 bei Phase 0 liegt. Zu Recht - ein Auto ueberquert eine Grenze und haelt
    // nicht davor.
    //
    // Mit zahl[k] landet Phase 1 auf start[k] + zahl[k], also genau auf dem ersten Punkt der
    // naechsten Kachel. Fuer jede Phase UNTER 1 bleibt der Punkt auf seiner eigenen Kachel.
    const roh = tab.start[k] + ph * tab.zahl[k];
    return Math.max(0, Math.min(Math.round(roh), pts.length - 1));
  }

  // ---- IST DIE STRECKE GESCHLOSSEN? --------------------------------------------------
  //
  // WARUM DAS SO WICHTIG IST, und das war vorher nicht aufgeschrieben: an dieser einen
  // Wahrheit haengt die Ideallinie. idealLine() klemmt bei `closed: false` die beiden
  // ENDPUNKTE fest und entspannt nur das Dazwischen - auf einer Bahn, die in Wahrheit ein
  // Ring ist, zieht die Kruemmungsminimierung die Linie dann zur Sehne, und `alpha` laeuft
  // ueber lange Stuecke an den Anschlag. Gemessen auf einer 17-Kachel-Strecke: 25 Prozent
  // aller Abtastpunkte am Rand.
  //
  // Genau so wurde es gemeldet: "bei einer laengeren Strecke passen die Schienen am Ende
  // nicht perfekt zusammen. Wenn ich dann Simulation starte, gehen alle Punkte nur an den
  // Rand." Die Punkte sind die Folge, die Schlusspruefung die Ursache.
  //
  // ZWEI BEDINGUNGEN, nicht eine.
  //
  //   LAGE     Wie weit liegen Anfang und Ende auseinander? Bisher die einzige Bedingung,
  //            mit 2 cm Toleranz - das laesst nur Rundungsfehler durch. Ein echtes Layout
  //            hat aber MODELLFEHLER: der angenommene Kurvenradius und die Kachellaenge
  //            stimmen nicht auf den Millimeter, und ueber zwanzig Teile summiert sich das.
  //            Ein Prozent Laengenfehler auf 20 Kacheln sind schon 8,6 cm.
  //
  //   WINKEL   Zeigt das Ende in dieselbe Richtung wie der Anfang? Ohne diese Frage waere
  //            eine groessere Lagetoleranz gefaehrlich: gemessen endet SR2G2R2G2R2G2R2G2
  //            um 120 Grad verdreht, und eine Strecke, die quer zu sich selbst ankommt, ist
  //            kein Ring, auch wenn der Abstand klein waere.
  //
  // DIE ZAHLEN SIND GEWAEHLT, und der Rahmen dafuer ist gemessen: eine FEHLENDE KACHEL sind
  // genau 43 cm - das ist die Luecke, die SR6, SL6 und SG2R3G2R3 zeigen. Die Toleranz muss
  // deutlich darunter bleiben, sonst gilt eine unfertige Strecke als Ring. 15 cm sind ein
  // Drittel davon und lassen den Modellfehler von zwanzig Teilen durch.
  //
  // 12 Grad beim Winkel: gemessen liefert SR6 schon -2,1 Grad allein aus der Abtastung (die
  // Richtung kommt aus den letzten zwei Punkten INNERHALB des Bogens), und der naechste
  // vorkommende Fall sind 120 Grad. Dazwischen ist viel Platz.
  const TRACK_SCHLUSS_CM = 15;
  const TRACK_SCHLUSS_GRAD = 12;
  // Der Zufallsknopf verlangt MEHR als die Scan-Toleranz oben: 15 cm lassen eine sichtbare
  // Luecke durch (eine fehlende Kachel sind 43 cm, also 8-12 cm sind schon ein Drittel davon).
  // Eine selbst gebaute Strecke kann exakt schliessen (A == B, gemessen 0,00 cm) oder bei
  // asymmetrisch knapp darueber - deshalb hier 3 cm, damit "geschlossen" auch so aussieht.
  const TRACK_SCHLUSS_STRENG_CM = 3;

  function trackSchluss(pts) {
    if (!pts || pts.length < 3) return { closed: false, lueckeCm: null, winkel: null };
    const a = pts[0], b = pts[pts.length - 1];
    const lueckeCm = Math.hypot(b.x - a.x, b.y - a.y) / TRACK_UNITS_PER_CM;
    const w = (p1, p2) => Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const wA = w(pts[0], pts[1]);
    const wE = w(pts[pts.length - 2], pts[pts.length - 1]);
    let dw = (wE - wA) * 180 / Math.PI;
    dw = ((dw % 360) + 540) % 360 - 180;
    return {
      closed: lueckeCm <= TRACK_SCHLUSS_CM && Math.abs(dw) <= TRACK_SCHLUSS_GRAD,
      lueckeCm, winkel: dw,
    };
  }

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
        // v0.9.27: RUECKWAERTS gefahren (gespiegelte Strecke, leadEnde) liegt das gerade
        // Stueck am AUSGANG - siehe chSpiegelTiles in 72-challenges.js.
        const hairpin = tile.type === TILE_TYPE.HAIRPIN || tile.type === TILE_TYPE.HAIRPIN_LEFT;
        if (hairpin && !tile.leadEnde) {
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
        if (hairpin && tile.leadEnde) {
          const lead = Math.max(2, Math.round(n * TRACK_HAIRPIN_LEAD / TRACK_STEP));
          const rad1 = heading * Math.PI / 180;
          const x1 = x, y1 = y;
          for (let i = 1; i <= lead; i++) {
            push(x1 + Math.sin(rad1) * TRACK_HAIRPIN_LEAD * (i / lead),
                 y1 - Math.cos(rad1) * TRACK_HAIRPIN_LEAD * (i / lead), heading, idx);
          }
          x = out[out.length - 1].x; y = out[out.length - 1].y;
        }
      } else {
        // ---- DIE ENGSTELLE IST HIER EINE NORMALE GERADE, und das ist eine Luecke ----
        //
        // Sie ist SCHMALER als die uebrige Bahn - daher der Name. Wieviel schmaler, ist
        // nicht gemessen: aus den Bildern des Original-Editors laesst sich ihre Breite
        // nicht ablesen, und eine geratene Zahl waere eine Bahn, die an einer Stelle
        // falsch eng gezeichnet ist. Die Breite steckt ausserdem als Konstante
        // TRACK_HALF_W im Zeichner und nicht je Kachel; eine Breite je Punkt ist eine
        // eigene Aenderung.
        //
        // WAS TROTZDEM SCHON WIRKT, und darum geht es zuerst: der Code 0x0a gilt auf der
        // Schiene nicht mehr als Ziellinie (siehe isStartCode), die Kachel wird benannt und
        // gezaehlt, und eine Ueberfahrt kostet keine Phantomrunde mehr.
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

  // ---- DIE FAHRGRENZEN AUS DEN EINGESTELLTEN WERTEN ---------------------------------
  //
  // Die vier Zahlen darueber sind GT-Verhaeltnisse und ausdruecklich eine Annahme. Zwei von
  // ihnen muessen keine sein: Hoechstgeschwindigkeit und Bremsverzoegerung stehen in der
  // Physikkonfiguration, und die Zugbeschleunigung ist ueber simulateLaunch() ausrechenbar -
  // dieselbe Funktion, gegen die calibrateAccel() den Schubfaktor loest. Damit rechnet das
  // Zeitmodell mit den Werten, die auch gefahren werden, also mit "Pro", "Realismus-GT3"
  // oder was sonst eingestellt ist.
  //
  // GEMESSEN unter Pro: 0 auf 100 angezeigte km/h in 2,295 s bei einem Anker von
  // 1,356 internen km/h, also 0,591 km/h je Sekunde im Mittel. Bremse 0,72, Spitze 4,0.
  // Das Verhaeltnis Zug zu Bremse ist damit 0,82 - die GT-Annahme sagte 0,45/1,10 = 0,41,
  // also die Haelfte. Das ist kein Detail: wie viel ein spaeter Scheitel bringt, haengt
  // genau an diesem Verhaeltnis.
  //
  // WAS ANNAHME BLEIBT, und das gehoert dazugesagt: die QUERbeschleunigung. Kein Byte meldet
  // sie, und das Auto haengt auf einer Schiene - es gibt also nichts zu messen. Sie wird
  // deshalb im bisherigen Verhaeltnis zur Bremse gefuehrt (1,0 zu 1,10), damit die einzige
  // Annahme, die uebrig ist, auch die einzige Aenderung an ihr ist.
  //
  // Einheiten: intern rechnet die Physik in km/h, die Linie in Zeichnungseinheiten.
  // 1 km/h = 27,778 cm/s, und TRACK_UNITS_PER_CM macht daraus Zeichnungseinheiten.
  const KMH_TO_UNITS = (100000 / 3600) * TRACK_UNITS_PER_CM;
  const LT_LAT_ZU_BREMSE = LT_A_LAT / LT_A_BRK;

  function fahrGrenzen() {
    // physEngine steht in 50-drive.js, also in der VORHERIGEN Datei - der Zugriff ist damit
    // in Ordnung. Die umgekehrte Richtung waere die temporale Todeszone.
    const cfg = physEngine.config;
    const aBrk = Math.max(1e-6, cfg.brakeDecelBase + cfg.brakeDecelAero) * KMH_TO_UNITS;
    // simulateLaunch() ist REIN: es liest die Konfiguration und ruehrt den Zustand nicht an.
    // accelerationFactor gehoert dazu, obwohl simulateLaunch ihn fuer die Kalibrierung
    // ausdruecklich auslaesst - hier geht es um das, was gefahren wird, und dort um den
    // Bezug, gegen den kalibriert wird.
    const lauf = physEngine.simulateLaunch(
      cfg.accelCalibration * (cfg.accelerationFactor || 1), false);
    const aAcc = cfg.launchAnchorKmh / Math.max(0.05, lauf.time) * KMH_TO_UNITS;
    return { vMax: cfg.topSpeedKmh * KMH_TO_UNITS, aAcc, aBrk,
             aLat: LT_LAT_ZU_BREMSE * aBrk, t100: lauf.time };
  }

  // Zeit fuer eine gegebene Linie. Gibt auch das Profil zurueck, damit der Editor es
  // zeichnen kann - dieselbe Zahl, die optimiert wurde, ist dann auch die angezeigte.
  function lapTimeOf(path, closed, o) {
    const n = path.length;
    const k = pathCurvature(path, closed);
    // Die Grenzen kommen VON AUSSEN und werden nicht hier geholt: fahrGrenzen() integriert
    // einen Start und kostet damit etwas, und diese Funktion laeuft in der Suche hunderte
    // Male. buildLine() rechnet sie einmal je Linie und legt sie in o. Fehlen sie - etwa
    // wenn ein Prueflauf direkt hierher greift -, gelten die GT-Annahmen von oben, und das
    // ist dann auch die richtige Antwort: ohne Kontext keine Werte aus dem Kontext.
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

  // ====================================================================================
  // DRITTES MODELL: MINIMUM-TIME MIT LATE-APEX-SCHRANKE
  // ====================================================================================
  //
  // BESTELLT: "Baue eine dritte Ideallinie ein, bei der du Minimum Time Optimization mit
  // Late-Apex Einschraenkung anwendest (gegeben der Pro Simulationseinstellungen). In den
  // aktuellen Ideallinien sind diese komischen Kurven - selbst bei einer Gerade sagst du dem
  // Auto, es solle eine Kurve fahren."
  //
  // WAS DIESES MODELL ANDERS MACHT, und es ist nicht die Zielfunktion - die ist dieselbe
  // Rundenzeit wie in 'laptime'. Anders ist der SUCHRAUM.
  //
  //   'laptime'   optimiert alpha fuer JEDEN der rund 180 Abtastpunkte frei. Damit kann die
  //               Suche auf einer Geraden Zeitgewinne im Mikrometerbereich einsammeln, und
  //               das tut sie: gemessen 16 Vorzeichenwechsel der zweiten Differenz auf
  //               Geraden, groesste 0,557. Das sind die gemeldeten "komischen Kurven".
  //
  //   hier        optimiert VIER Zahlen je Kurve - Eingang, Scheitelversatz, Ausgang,
  //               Scheitellage - und nichts sonst. Die Geraden folgen daraus, sie sind keine
  //               Freiheit. Eine Gerade KANN in diesem Modell keine Kurve werden, weil es
  //               dafuer keinen Parameter gibt.
  //
  // Auf einer Strecke mit vier Kurvenzuegen sind das 16 Zahlen gegen 180 - und der
  // Unterschied ist genau die Glaettung, die man sonst hinterher aufsetzen muesste.
  //
  // DIE LATE-APEX-SCHRANKE ist die Lage des Scheitels in Weganteil des Kurvenzuges, und sie
  // ist eine SCHRANKE und kein Zuschlag: die Suche darf den Scheitel frei waehlen, aber
  // nicht vor 55 Prozent. Warum gefordert und nicht gehofft: die freie Suche in 'laptime'
  // verschiebt den Scheitel gemessen um +0,045 der Kurvenlaenge im Mittel, zwei von zwoelf
  // spaeter und zwei frueher - das ist kein Effekt, und der Grund steht beim Modellvergleich
  // darunter. Auf 25 cm Breite und 43 cm Kachellaenge ist kaum Platz.
  //
  // 0,55 bis 0,85 sind GEWAEHLT. Die untere Grenze ist die Bedeutung von "late apex" (hinter
  // der Mitte), die obere laesst dem Ausgang noch ein Sechstel des Zuges - ohne sie legt die
  // Suche den Scheitel an den Ausgang und die Ausfahrt verschwindet. Genau dieser Fall ist
  // in v0.5.40 schon einmal gemessen worden.
  const LATE_APEX_MIN = 0.55;
  const LATE_APEX_MAX = 0.85;

  // Weichgang statt linear: alpha soll am Scheitel und an den Kachelgrenzen waagerecht
  // ankommen. Sonst hat die Querlage dort einen Knick, und ein Knick in der Querlage ist
  // ein Ruck am Lenkservo.
  function glattStufe(u) {
    const x = Math.max(0, Math.min(1, u));
    return x * x * (3 - 2 * x);
  }

  // Die Abtastpunkte eines Kurvenzuges, samt Weganteil jedes Punktes im Zug. Der WEG und
  // nicht der Index, weil die Punktdichte je Kacheltyp verschieden ist (14 gegen 49).
  function lateApexZug(lauf, pts, tiles, tab, at) {
    const idx = [];
    let haarnadel = false;
    for (let kk = lauf.von; kk <= lauf.bis; kk++) {
      const t = ((kk % tiles.length) + tiles.length) % tiles.length;
      if (istHaarnadel(tiles[t].type)) haarnadel = true;
      for (let d = 0; d < tab.zahl[t]; d++) idx.push(at(tab.start[t] + d));
    }
    const weg = [0];
    for (let q = 1; q < idx.length; q++) {
      const a = pts[idx[q - 1]], b = pts[idx[q]];
      weg.push(weg[q - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const gesamt = weg[weg.length - 1] || 1;
    return { idx, f: weg.map(function (w) { return w / gesamt; }), haarnadel: haarnadel };
  }

  // ====================================================================================
  // EINE FORMFAMILIE FUER ALLE DREI MODELLE
  // ====================================================================================
  //
  // GEMELDET: "Die Kruemmung und Rundenzeit Ideallinien sehen immernoch komisch aus, willst
  // du da nichts fixen?" - mit einem Bild, auf dem der Zickzack IN den Kurven sitzt.
  //
  // NACHGEMESSEN, zweite Differenz von alpha innerhalb der Kurvenkacheln:
  //
  //     Strecke          Kruemmung        Rundenzeit      Late Apex
  //     SR3GLR2GR2G2   54 Wechsel 16,03  30 / 8,94       11 / 0,23
  //     SHG4HG3        54 /  1,83        16 / 1,00       12 / 0,14
  //     SG4R4G4L4      61 /  1,22        20 / 0,89        4 / 0,23
  //
  // 16,03 bei einem Deckel von 8,63 ist ein Sprung von fast ZWEI Bahnbreiten zwischen zwei
  // benachbarten Abtastpunkten. Die Ursache ist dieselbe wie bei den Geraden und schon dort
  // beschrieben: beide alten Modelle optimieren alpha punktweise. Die geraden Geraden aus
  // v0.5.42 haben nur die Haelfte des Problems behoben.
  //
  // DIE LOESUNG IST NICHT EINE WEITERE GLAETTUNG, sondern derselbe Suchraum fuer alle drei.
  // Ein Nachlauf, der eine zackige Linie glaettet, optimiert etwas anderes als er ausgibt;
  // genau das hat sich bei line.lapTime schon einmal gezeigt. Also: EINE Form, DREI
  // Zielfunktionen.
  //
  //     'curvature'   kleinste groesste Kruemmung   Scheitel frei (0,15 bis 0,85)
  //     'laptime'     kleinste Rundenzeit           Scheitel frei
  //     'lateapex'    kleinste Rundenzeit           Scheitel hinter 0,55
  //
  // Damit ist die Wahl endlich eine Wahl der ZIELFUNKTION und nicht eine zwischen zwei
  // Verfahren mit unterschiedlicher Glattheit.

  // ---- Die Kurvenform: eine KUBIK in der Weglaenge ----------------------------------
  //
  // Vier Bedingungen, vier Koeffizienten:
  //
  //     alpha(0) = ein      an der Kachelgrenze hinein
  //     alpha(p) = sch      am Scheitel
  //     alpha'(p) = 0       und dort waagerecht, das ist die Bedeutung von "Scheitel"
  //     alpha(1) = aus      an der Kachelgrenze hinaus
  //
  // WARUM EINE KUBIK UND NICHT ZWEI WEICHGAENGE, und das ist der Kern: der Beitrag der
  // Querlage zur Kruemmung des GEFAHRENEN Wegs ist ihre zweite Ableitung. Bei einer Kubik
  // ist die linear in s, also ohne Spitze. Der Sonderfall zeigt es am besten: mit ein = aus
  // und Scheitel in der Mitte kommt eine PARABEL heraus, deren zweite Ableitung konstant
  // ist - und eine konstante Kruemmungsminderung ueber die ganze Kurve IST der Bogen mit
  // groesserem Radius, den eine Ideallinie sucht. Zwei aneinandergesetzte Weichgaenge haben
  // dagegen in der Mitte jedes Halbstuecks ein Maximum der zweiten Ableitung und am Scheitel
  // eine Null - also genau die Beulen, die es nicht geben soll.
  //
  // Determinante p^2 (1-p)^2, also nur an den Raendern null - dort greift die Klemme auf
  // den Scheitelbereich.
  function kurvenKubik(ein, sch, aus, p) {
    const S = sch - ein, E = aus - ein;
    const det = p * p * (1 - p) * (1 - p);
    if (!(Math.abs(det) > 1e-12)) return [ein, E, 0, 0];
    const B = (S * p * (2 - 3 * p) + p * p * p * p * E) / det;
    const C = (3 * p * p * S - S - 2 * p * p * p * E) / det;
    const D = (p * p * E + S * (1 - 2 * p)) / det;
    return [ein, B, C, D];
  }

  // ---- Der Aussenboden aus dem Regler "Kurven oeffnen" -------------------------------
  //
  // lineExitStaerke war bis v0.5.42 die Staerke eines NACHLAUFS. Jetzt ist sie eine
  // SCHRANKE im Suchraum: Eingang und Ausgang muessen mindestens so weit aussen liegen.
  //
  // Das ist dieselbe Zusage wie vorher - "Haarnadel von aussen anfahren und aussen
  // verlassen" - nur an der richtigen Stelle. Ein Nachlauf schiebt die Linie hinterher nach
  // aussen und macht sie dabei langsamer, ohne dass die Suche davon weiss; eine Schranke
  // laesst die Suche das Beste finden, was mit dieser Vorgabe moeglich ist. Bei 0 entscheidet
  // die Suche allein.
  // Und der Boden kennt den PLATZ. Ohne das verlangt er auf einer einzelnen 60-Grad-Kachel
  // dasselbe wie in einer Haarnadel - und dort ist kein Platz dafuer.
  //
  // GEMESSEN, zweite Differenz von alpha innerhalb der Kurven, nur wo alle drei Punkte in
  // Kurvenkacheln liegen: auf SHG4HG3 und SG4R4G4L4 (Kurvenzuege von einer Haarnadel bzw.
  // vier Kacheln) 0,010 bis 0,055 - auf SR3GLR2GR2G2 mit seiner EINZELNEN Linkskachel
  // dagegen 9,46. Der Zwang forderte dort ueber 12 cm Querbewegung innerhalb von 43 cm Weg,
  // und das ist kein Zickzack des Optimierers, sondern eine Vorgabe ohne Platz.
  //
  // Der Bezug ist die BOGENLAENGE des Kurvenzuges gegen zwei Kachellaengen, und das ist
  // Geometrie und keine Abstimmung: eine 60-Grad-Kachel hat 34,4 mal pi/3 = 36 Einheiten
  // Bogen und bekommt damit 45 Prozent des Bodens, eine Haarnadel mit 108 Einheiten den
  // ganzen. Die Kachelzahl waere der falsche Bezug - sie sagt nichts ueber den Winkel.
  //
  // DAS VORZEICHEN, und es war falsch. trackNormals() zeigt nach LINKS in Fahrtrichtung,
  // positives alpha bewegt also nach links. Der Mittelpunkt einer Rechtskurve liegt rechts,
  // ihre INNENSEITE ist damit negatives alpha und ihre Aussenseite positives - also
  // aussen = +dreht und nicht -dreht.
  //
  // Mit dem falschen Vorzeichen zwang der Boden Eingang und Ausgang nach INNEN, und in einer
  // Schikane trafen sich dann der nach innen gezwungene Ausgang der Rechtskurve und der nach
  // innen gezwungene Eingang der Linkskurve auf entgegengesetzten Seiten: gemessen an
  // SRRRLLL sprang alpha zwischen zwei benachbarten Abtastpunkten von -0,48 auf +0,48, also
  // um eine ganze Bahnbreite. Das war der letzte verbliebene Zickzack.
  function aussenBoden(dreht, haarnadel, limit, bogen) {
    const f = haarnadel ? LINE_OEFFNUNG_HAARNADEL : LINE_OEFFNUNG_KURVE;
    const platz = Math.max(0, Math.min(1, (bogen || 0) / (2 * TRACK_STEP)));
    return dreht * lineExitStaerke * f * platz * limit;
  }

  // Eine Zahl auf die Seite von `boden` klemmen: mindestens so weit aussen, hoechstens am
  // Rand. boden = 0 heisst keine Schranke.
  function bodenKlemme(v, boden, limit) {
    if (!boden) return Math.max(-limit, Math.min(limit, v));
    return boden > 0 ? Math.max(boden, Math.min(limit, v))
                     : Math.min(boden, Math.max(-limit, v));
  }

  function formLine(pts, nrm, o, ziel, apexMin, apexMax) {
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const closed = !!o.closed;
    const tiles = o.tiles;
    const n = pts.length;
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    const laeufe = lineKurvenLaeufe(tiles, closed);
    // ---- EIN LAYOUT OHNE KURVEN ------------------------------------------------------
    //
    // Dann IST die Mittellinie die schnellste und die kruemmungsaermste Linie, und das ist
    // kein Rueckfall, sondern das richtige Ergebnis. Dieser Zweig stand in lateApexLine();
    // beim Zusammenlegen der drei Modelle ist er mir verlorengegangen, und die Folge war
    // kein stiller Fehler, sondern ein Ladeabbruch: alphaAus() greift auf zuege[0].idx zu,
    // und "Cannot read properties of undefined (reading 'idx')" beim Aufbau nimmt die ganze
    // IIFE mit. Eine gerade Strecke im Editor genuegt dafuer.
    if (!laeufe.length) {
      const alpha = new Array(n).fill(0);
      const prof = lapTimeOf(pts.map((p) => [p.x, p.y]), closed, o);
      return { alpha, limit, span: 0, lapTime: prof.time, startLapTime: prof.time,
               gain: 0, v: prof.v, apex: [], par: [], evals: 0, accepted: 0 };
    }
    const tab = trackKachelTabelle(pts, tiles.length);
    const zuege = laeufe.map((l) => lateApexZug(l, pts, tiles, tab, at));
    // EINMAL geplant, dann nur noch angewandt - siehe lineGeradenPlan().
    const gPlan = lineGeradenPlan(pts, closed, tiles);
    const dreht = laeufe.map((l) => l.dreht);
    // Die Bogenlaenge je Zug: lateApexZug gibt Weganteile zurueck, die Laenge selbst wird
    // hier aus den Punkten geholt.
    const bogen = zuege.map((z) => {
      let L = 0;
      for (let q = 1; q < z.idx.length; q++) {
        const a1 = pts[z.idx[q - 1]], b1 = pts[z.idx[q]];
        L += Math.hypot(b1.x - a1.x, b1.y - a1.y);
      }
      return L;
    });
    const bodenVoll = zuege.map((z, c) => aussenBoden(dreht[c], z.haarnadel, limit, bogen[c]));
    // ---- SCHIKANEN: ZWEI KURVEN, EIN UEBERGANGSPUNKT --------------------------------
    //
    // Liegt zwischen zwei Kurvenzuegen KEINE Kachel, dann sind der Ausgang des einen und der
    // Eingang des anderen derselbe Abtastpunkt. Ein Aussenboden auf beiden verlangt dort
    // zwei entgegengesetzte Werte an einer Stelle - und weil der Boden fuer eine Rechtskurve
    // links und fuer eine Linkskurve rechts liegt, ist die Forderung bei einer Schikane
    // genau der Sprung um eine ganze Bahnbreite.
    //
    // GEMESSEN, zweite Differenz von alpha, nur innerhalb von Kurven:
    //
    //     Strecke         mit Boden auf beiden   Kurvenzuege
    //     SHG4HG3               0,056            Haarnadeln, keine Schikane
    //     SG4R4G4L4             0,102            Kurven mit Geraden dazwischen
    //     SRRRLLL              10,552            RRR direkt auf LLL
    //     SR3GLR2GR2G2          5,419            L direkt auf RR
    //
    // Die zwei Layouts mit einer Schikane sind genau die zwei mit dem Ausschlag.
    //
    // In einer Schikane faehrt niemand zweimal aussen-innen-aussen; es gibt EINE durchgehende
    // Linie. Also: an einem direkten Uebergang kein Boden, und die zwei Anker sind EIN Wert.
    const direkt = laeufe.map((l, c) => {
      const nx = laeufe[(c + 1) % laeufe.length];
      if (!nx || laeufe.length < 2) return false;
      // bis kann ueber die Naht hinauszaehlen (siehe lineKurvenLaeufe), also modulo.
      const ende = ((l.bis % tiles.length) + tiles.length) % tiles.length;
      const anfang = ((nx.von % tiles.length) + tiles.length) % tiles.length;
      return anfang === (ende + 1) % tiles.length;
    });
    const bodenEin = bodenVoll.slice();
    const bodenAus = bodenVoll.slice();
    for (let c = 0; c < laeufe.length; c++) {
      if (!direkt[c]) continue;
      bodenAus[c] = 0;
      bodenEin[(c + 1) % laeufe.length] = 0;
    }
    // ---- UND DER SCHEITEL NACH INNEN, gleich weit ------------------------------------
    //
    // Ohne diese Schranke gibt es GAR KEINEN Scheitel, und das ist gemessen und kein
    // Versehen des Optimierers. Alpha je Kurvenzug, auf den Deckel normiert:
    //
    //     Oeffnung 0     R5-8 min -0,11 max 0,00     also die Mittellinie
    //     Oeffnung 0,3   R5-8 min +0,18 max +0,18    also flach aussen, ueber die ganze Kurve
    //
    // Der Grund ist die Geometrie einer Carrera-Kurve: sie ist ein Bogen mit FESTEM Radius
    // von 37 cm. Nachgemessen an einer reinen Rechtskurve, mittlerer Radius der Bahn bei
    // konstantem Versatz: Mittellinie 34,7 Einheiten, alpha +4 gibt 38,8 (aussen, weiter),
    // alpha -4 gibt 30,7 (innen, enger). Nach innen zu tauchen macht den Radius also KLEINER
    // und kostet Kurventempo - auf einer echten Strecke waehlt man mit dem Scheitel den
    // Radius, hier ist er vorgegeben. Die zeitschnellste Linie hat deshalb keinen Scheitel.
    //
    // Wer eine Linie sehen will, die aussieht wie eine Ideallinie, muss die FORM fordern -
    // aussen hinein, innen am Scheitel, aussen hinaus - und den Preis lesen. Genau dafuer
    // ist der Regler da, und die Modellzeit daneben nennt die Kosten. Bei 0 entscheidet die
    // Zielfunktion allein, und dann kommt die Mittellinie heraus.
    const bodenSch = zuege.map((z, c) => -bodenVoll[c]);

    // ---- Der Parametervektor: [Eingang, Scheitel, Ausgang, Scheitellage] je Kurve ----
    //
    // Die ersten drei in Zeichnungseinheiten, die vierte in Weganteil. DREI STARTPUNKTE,
    // und der Grund ist gemessen: mit nur der Lehrbuchlinie blieb der Abstieg auf
    // SR3GLR2GR2G2 bei einer Zeit 4,1 Prozent UEBER der Mittellinie haengen. Von einer weit
    // aussen liegenden Linie aus ist jeder EINZELNE Parameter Richtung Mitte erst einmal
    // schlechter, weil die anderen noch aussen stehen - ein Koordinatenabstieg kann da nicht
    // heraus.
    const starts = [0.8, 0.0, 0.4].map((s) => zuege.map((z, c) => {
      // aussen = +dreht, siehe aussenBoden(): positives alpha ist links, und links ist
      // aussen in einer Rechtskurve.
      const aussen = dreht[c];
      const mitte = (apexMin + apexMax) / 2;
      return [bodenKlemme(aussen * s * limit, bodenEin[c], limit),
              bodenKlemme(-aussen * (s > 0 ? 1 : 0) * limit, bodenSch[c], limit),
              bodenKlemme(aussen * s * limit, bodenAus[c], limit),
              Math.max(apexMin, Math.min(apexMax, s > 0 ? 0.6 : mitte))];
    }));

    const alphaAus = (par) => {
      const alpha = new Array(n).fill(0);
      for (let c = 0; c < zuege.length; c++) {
        const z = zuege[c];
        const p = Math.max(apexMin, Math.min(apexMax, par[c][3]));
        // An einem direkten Uebergang gilt der Ausgang der VORHERIGEN Kurve auch als
        // Eingang dieser - ein Punkt, ein Wert. Der eigene Parameter ist dort wirkungslos;
        // der Abstieg merkt das von selbst, weil seine Aenderung nichts bewirkt.
        const vor = (c - 1 + zuege.length) % zuege.length;
        const ein = (zuege.length > 1 && direkt[vor]) ? par[vor][2] : par[c][0];
        const k = kurvenKubik(ein, par[c][1], par[c][2], p);
        for (let q = 0; q < z.idx.length; q++) {
          const s = z.f[q];
          const v = k[0] + k[1] * s + k[2] * s * s + k[3] * s * s * s;
          alpha[z.idx[q]] = Math.max(-limit, Math.min(limit, v));
        }
      }
      if (!closed) {
        const erst = zuege[0].idx[0];
        const zl = zuege[zuege.length - 1].idx;
        const letzt = zl[zl.length - 1];
        for (let i = 0; i < erst; i++) alpha[i] = alpha[erst];
        for (let i = letzt + 1; i < n; i++) alpha[i] = alpha[letzt];
      }
      return lineGeradenAnwenden(alpha, gPlan);
    };
    const bahnAus = (alpha) => pts.map((p, i) => [p.x + nrm[i].x * alpha[i],
                                                  p.y + nrm[i].y * alpha[i]]);
    let auswertungen = 0;
    const wertVon = (par) => {
      auswertungen++;
      const bahn = bahnAus(alphaAus(par));
      if (ziel === 'kurve') {
        // ---- KRUEMMUNGSENERGIE, NICHT DAS MAXIMUM -----------------------------------
        //
        // Der erste Versuch nahm Math.max(...k), also die engste Stelle. Das klingt richtig
        // - sie bestimmt ja das Kurventempo - und ist als Zielfunktion fuer einen
        // Koordinatenabstieg untauglich: der Wert haengt an EINEM Punkt, jede Aenderung
        // irgendwo sonst laesst ihn unveraendert, und der Abstieg nimmt nichts an. Gemessen
        // blieben auf SR3GLR2GR2G2 alle vier Scheitel auf ihrem Startwert 0,600 stehen, und
        // die zweite Differenz lag bei 19,67 - schlechter als vor dem Umbau.
        //
        // Die Summe der Quadrate ist die uebliche Groesse fuer "kruemmungsaermste Linie",
        // und sie ist das, was die Relaxation in idealLine() ohnehin naeherungsweise
        // minimiert. Jede Verbesserung an jeder Stelle senkt sie, also findet ein Abstieg
        // darauf auch etwas.
        const k = pathCurvature(bahn, closed);
        let summe = 0;
        for (let i = 0; i < k.length; i++) summe += k[i] * k[i];
        return summe;
      }
      return lapTimeOf(bahn, closed, o).time;
    };

    // ---- Koordinatenabstieg, von jedem Startpunkt ------------------------------------
    const absteigen = (P) => {
      let best = wertVon(P);
      let schritt = [0.35 * limit, 0.35 * limit, 0.35 * limit, 0.12];
      const runden = o.runden === undefined ? 5 : o.runden;
      for (let runde = 0; runde < runden; runde++) {
        for (let c = 0; c < P.length; c++) {
          for (let k = 0; k < 4; k++) {
            for (const richtung of [1, -1]) {
              const alt = P[c][k];
              let neu = alt + richtung * schritt[k];
              if (k === 3) neu = Math.max(apexMin, Math.min(apexMax, neu));
              else neu = bodenKlemme(neu, k === 0 ? bodenEin[c]
                                        : k === 1 ? bodenSch[c] : bodenAus[c], limit);
              if (neu === alt) continue;
              P[c][k] = neu;
              const t = wertVon(P);
              if (t < best - 1e-12) best = t; else P[c][k] = alt;
            }
          }
        }
        schritt = schritt.map((s) => s * 0.5);
      }
      return { P, wert: best };
    };
    let bestLauf = null, startWert = null;
    for (const S of starts) {
      const r = absteigen(S);
      if (startWert === null) startWert = r.wert;
      if (!bestLauf || r.wert < bestLauf.wert) bestLauf = r;
    }
    const alpha = alphaAus(bestLauf.P);
    const prof = lapTimeOf(bahnAus(alpha), closed, o);
    return { alpha, limit, span: Math.max.apply(null, alpha.map(Math.abs)),
             lapTime: prof.time, startLapTime: startWert, v: prof.v,
             gain: ziel === 'zeit' ? (startWert - prof.time) / Math.max(1e-9, startWert) : 0,
             apex: bestLauf.P.map((p) => +p[3].toFixed(3)),
             par: bestLauf.P.map((p) => p.map((x) => +(x / limit).toFixed(3))),
             evals: auswertungen, accepted: 0 };
  }

  // =====================================================================================
  // DIE 3-STUFEN-LINIE
  // =====================================================================================
  //
  // BESTELLT: "3 Spuren: links, mitte, aussen. Zusaetzliche Ideallinie '3-stufig', bei der
  // ein Auto immer auf genau einer der Spuren faehrt. Die anderen funktionieren nicht. Bei
  // Links-Rechts-Kombi soll er dann rechts anfahren und zwischen den Kurven nach links
  // wechseln, dann faehrt der Ghost eine gute Linie."
  //
  // ---- WARUM DIE ANDEREN DREI "NICHT FUNKTIONIEREN", GEMESSEN ----------------------
  //
  // Die Vermutung war, dass der Linienversatz gar nicht am Servo ankommt. Das ist NICHT
  // der Fall - gemessen auf SR3GLR2GR2G2 mit dem Rundenzeitmodell:
  //
  //     Linienversatz        Spanne 1,745  (also rund -0,87 bis +0,87)
  //     Wunsch (Summe)       Spanne 1,134
  //     am Servo             Spanne 1,404, also 96 % des Wunsches
  //     je Kachel            Spannen von 16 bis 130 BYTE, von 127 moeglichen
  //
  // Der Befehl ist also gross. Was fehlt, ist etwas anderes, und die Kachelzahlen sagen es:
  // Kachel 2 hat eine Spanne von 130 bei einem MITTELWERT von 41. Der Befehl schwingt - er
  // laeuft in einer Kurve von aussen durch den Scheitel nach aussen und ist im Mittel
  // fast null.
  //
  // Ein Auto auf einer Schiene folgt so etwas nicht. Der Schlitz haelt es, das Servo hat
  // eine Stellzeit, und die Ratenbegrenzung des Ghosts hat noch eine - ein Befehl, der
  // sich staendig aendert, bewegt es kaum. Was es bewegt, ist ein GEHALTENER Befehl, und
  // genau das ist die Beobachtung des Nutzers: "nur wenn ich bei Fahrt die Querlage
  // verschiebe, tut sich was, und beim Ueberholen". Beides sind gehaltene Befehle
  // (ein fester Versatz, und attackSide = +/-1 ueber Sekunden).
  //
  // ---- ALSO: DREI SPUREN, GEHALTEN ------------------------------------------------
  //
  // Diese Linie nimmt nur drei Werte an - links, Mitte, rechts - und haelt jeden ueber ein
  // ganzes Stueck Strecke. Sie ist damit KEINE Optimierung: sie hat keine Zielfunktion und
  // sucht nichts. Sie ist eine Vorschrift, und ihre Begruendung ist nicht die Rundenzeit,
  // sondern dass das Auto ihr folgen KANN.
  //
  // Die Vorschrift je Kurve, in Anteilen des Kurvenstuecks:
  //
  //     erste 35 %    AUSSEN      anfahren
  //     mitte 30 %    INNEN       einlenken
  //     letzte 35 %   AUSSEN      herauskommen
  //
  // Und auf der Geraden zwischen zwei Kurven: die Aussenseite der NAECHSTEN Kurve, ab der
  // Mitte des geraden Stuecks. Bei einer Links-Rechts-Kombination ergibt das genau das
  // bestellte Bild - rechts anfahren (aussen an der Linkskurve), zwischen den Kurven nach
  // links wechseln (aussen an der Rechtskurve).
  //
  // DIE 35 PROZENT SIND DIE SCHIKANE. Gemeldet: "Schikane ist zB so eng, dass Ghosts am
  // besten 500 ms aussen anfahren und dann voll nach innen einlenken, um aussen
  // rauszukommen." Eine Kachel dauert bei Ghost-Vorgabetempo rund 700 ms; 35 Prozent eines
  // zweikacheligen Kurvenstuecks sind 0,7 Kacheln, also rund 500 ms. Die Zahl ist damit
  // nicht gewaehlt, sondern die Uebersetzung der Beobachtung.
  //
  // AUSSEN IST +dreht. Das ist nachgemessen und nicht Konvention: bei konstantem Versatz
  // gibt +4 einen mittleren Bahnradius von 38,8 Einheiten, -4 nur 30,7 - der groessere
  // Radius ist der aeussere. dreht ist +1 fuer eine Rechtskurve.
  const SPUR_EIN = 0.35;      // Anteil des Kurvenstuecks, der aussen angefahren wird
  const SPUR_MITTE = 0.30;    // Anteil, der innen gefahren wird
  // BESTELLT (Phase 12, Punkt 7): "Ideallinie Haarnadel ueberarbeiten (kurz aussen, dann
  // so weit wie moeglich innen)." SPUR_EIN/SPUR_MITTE oben gelten fuer JEDE Kurve
  // gleich, ob 60 Grad oder Haarnadel - eine Haarnadel bekam damit dieselbe kurze
  // Aussenphase wie eine offene Kurve und schwenkte dann schon wieder aussen, bevor der
  // Scheitel ueberhaupt erreicht war.
  //
  // NUR ZWEI STUFEN statt drei, wie bestellt: kurz aussen anstellen (SPUR_EIN_HAARNADEL,
  // deutlich kuerzer als SPUR_EIN), dann fuer den GESAMTEN Rest des Kurvenstuecks innen
  // bleiben - keine dritte, wieder aussen ziehende Stufe innerhalb der Haarnadel selbst.
  // Der Ruecksprung nach aussen fuer die folgende Gerade/Kurve passiert ohnehin schon
  // ausserhalb dieser Funktion (Abschnitt "2. Die Geraden" weiter unten).
  const SPUR_EIN_HAARNADEL = 0.15;
  // Wie weit ein voller Spurwechsel geht. 1,0 heisst: bis an die Schranke, die "Kurven
  // oeffnen" setzt - dieselbe Schranke wie bei den anderen Modellen, damit der Regler auch
  // hier gilt und nicht nur bei drei von vier Linien.
  const SPUR_VOLL = 1.0;
  // Der Anteil einer Geraden, der schon zum Anfahren der naechsten Kurve gehoert. Der Rest
  // ist Mitte. Begruendung an der Anwendungsstelle.
  const SPUR_GERADE_ANFAHRT = 0.40;

  // ---- Geraden zwischen zwei Kurvenlaeufen: MITTE, dann die Aussenseite der naechsten
  // Kurve - herausgezogen aus dreiStufenLine(), weil aussenInnenLine() (Phase 12,
  // Punkt 14: "bei Geradenfolgen sanfter Uebergang zur jeweiligen Aussenseite")
  // denselben Abschnitt unveraendert braucht. `stuecke` ist eine Liste von
  // { idx, dreht }, wie sie beide Aufrufer schon aufbauen.
  //
  // DIE MITTE GEHOERT DAZU, und das ist eine Berichtigung. Der erste Anlauf liess die
  // erste Haelfte der Geraden auf der Aussenseite der VORIGEN Kurve stehen und wechselte
  // dann. Gemessen nahm die Linie damit auf drei geprueften Layouts genau ZWEI Werte an -
  // +/-8,63, die Mitte kam nie vor. Eine "3-stufige" Linie, die nur zwei Stufen benutzt,
  // ist keine, und schlimmer: der Unterschied zum 2-Stufen-Ausweichen beim Ueberholen
  // (SPUR_PASS_AUSSEN in 90-ghosts.js) waere damit leer gewesen. Dort ist die Mitte
  // ausdruecklich verboten, damit sich zwei Autos die Bahn teilen koennen - ein Verbot,
  // das nichts verbietet, ist keine Zusage.
  //
  // Also drei Stufen mit drei Aufgaben:
  //
  //     Kurve     (siehe der jeweilige Aufrufer)     die Kurve selbst
  //     Gerade    MITTE                              bis kurz vor der naechsten Kurve
  //     Gerade    aussen der naechsten Kurve         das letzte Stueck, zum Anfahren
  //
  // Und die Mitte auf der Geraden ist nicht nur Kosmetik: dort ist zu beiden Seiten Platz,
  // also kann ein Verfolger vorbei - egal auf welcher Seite. Ein Auto, das die Gerade am
  // Rand entlangfaehrt, macht genau eine Seite auf.
  //
  // SPUR_GERADE_ANFAHRT ist der Anteil der Geraden, der schon zum Anfahren gehoert. 40
  // Prozent: bei querTempo 4,0 dauert ein voller Spurwechsel 250 ms, eine Kachel bei
  // Vorgabetempo rund 700 ms - 40 Prozent einer einkacheligen Geraden sind 280 ms und
  // damit gerade genug. Kuerzer waere ein Anfahren, das erst am Kurveneingang ankommt.
  function linieGeradenAussenAnfahrt(alpha, stuecke, at, n, limit, spurVoll, closed) {
    const paare = [];
    for (let s = 0; s + 1 < stuecke.length; s++) paare.push([s, s + 1]);
    if (closed && stuecke.length > 1) paare.push([stuecke.length - 1, 0]);
    for (const [a, b] of paare) {
      const vonIdx = stuecke[a].idx[stuecke[a].idx.length - 1];
      const bisIdx = stuecke[b].idx[0];
      // Die Punkte dazwischen, zyklisch.
      const zwischen = [];
      let i = at(vonIdx + 1), sicher = 0;
      while (i !== bisIdx && sicher++ <= n) { zwischen.push(i); i = at(i + 1); }
      if (!zwischen.length) continue;     // Kurven stossen direkt aneinander
      const neu = stuecke[b].dreht * spurVoll * limit;    // aussen der naechsten
      // Ab hier gehoert die Gerade zum Anfahren der naechsten Kurve. Mindestens ein Punkt,
      // damit auch eine sehr kurze Gerade noch vorpositioniert - sonst faehrt das Auto den
      // Kurveneingang aus der Mitte an, und das ist genau der Fall, den SPUR_EIN vermeidet.
      const abAnfahrt = Math.max(0, zwischen.length
                                    - Math.max(1, Math.round(zwischen.length
                                                             * SPUR_GERADE_ANFAHRT)));
      for (let q = 0; q < zwischen.length; q++) {
        alpha[zwischen[q]] = q < abAnfahrt ? 0 : neu;
      }
    }
  }

  function dreiStufenLine(pts, nrm, o) {
    const n = pts.length;
    const tiles = o.tiles || [];
    const closed = o.closed !== false;
    // Dieselbe Schranke wie bei den anderen Modellen - siehe formLine.
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const alpha = new Array(n).fill(0);
    const laeufe = lineKurvenLaeufe(tiles, closed);
    // OHNE KURVEN GIBT ES NICHTS ZU STAFFELN, und dann ist die Mitte richtig - nicht eine
    // willkuerliche Seite. Derselbe Zweig, dessen Fehlen in v0.5.43 die ganze IIFE
    // umgebracht hat, als ich lateApexLine geloescht habe.
    if (!laeufe.length || !tiles.length) {
      return { alpha, limit, span: 0, lapTime: null, startLapTime: null,
               v: null, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    const tab = trackKachelTabelle(pts, tiles.length);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    // Je Kurvenlauf die Punktindizes, in Fahrtrichtung - und ob eine Haarnadel/Engstelle
    // darunter ist: ein Lauf kann mehrere gleichsinnige Kacheln zusammenfassen
    // (lineKurvenLaeufe), eine davon reicht, um den ganzen Lauf als Haarnadel zu fahren.
    const stuecke = laeufe.map((lauf) => {
      const idx = [];
      let haarnadel = false;
      for (let kk = lauf.von; kk <= lauf.bis; kk++) {
        const t = ((kk % tiles.length) + tiles.length) % tiles.length;
        if (tileTightness(tiles[t].type) >= 2) haarnadel = true;
        for (let d = 0; d < tab.zahl[t]; d++) idx.push(at(tab.start[t] + d));
      }
      return { idx, dreht: lauf.dreht, haarnadel };
    }).filter((s) => s.idx.length);
    if (!stuecke.length) {
      return { alpha, limit, span: 0, lapTime: null, startLapTime: null,
               v: null, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    // ---- 1. Die Kurven selbst: aussen, innen, aussen - ausser bei der Haarnadel -----
    //
    // BESTELLT: "kurz aussen, dann so weit wie moeglich innen." Eine Haarnadel bekommt
    // nur zwei Stufen: kurz aussen anstellen (SPUR_EIN_HAARNADEL), dann innen fuer den
    // GESAMTEN Rest des Kurvenstuecks - keine dritte, wieder aussen ziehende Stufe. Jede
    // andere Kurve faehrt weiter aussen-innen-aussen wie bisher.
    for (const st of stuecke) {
      const m = st.idx.length;
      const aussen = st.dreht * SPUR_VOLL * limit;
      const innen = -st.dreht * SPUR_VOLL * limit;
      if (st.haarnadel) {
        const bisEin = Math.max(1, Math.round(m * SPUR_EIN_HAARNADEL));
        for (let q = 0; q < m; q++) alpha[st.idx[q]] = q < bisEin ? aussen : innen;
        continue;
      }
      const bisEin = Math.max(1, Math.round(m * SPUR_EIN));
      const bisMitte = Math.min(m, bisEin + Math.max(1, Math.round(m * SPUR_MITTE)));
      for (let q = 0; q < m; q++) {
        alpha[st.idx[q]] = q < bisEin ? aussen : (q < bisMitte ? innen : aussen);
      }
    }
    // ---- 2. Die Geraden: MITTE, dann die Aussenseite der naechsten Kurve ----------
    // Siehe linieGeradenAussenAnfahrt() - derselbe Abschnitt, herausgezogen, weil
    // aussenInnenLine() (Phase 12, Punkt 14) ihn unveraendert mitbenutzt.
    linieGeradenAussenAnfahrt(alpha, stuecke, at, n, limit, SPUR_VOLL, closed);
    // Dieselbe Bahn-aus-alpha-Rechnung wie in formLine: Punkt plus Normale mal alpha.
    const bahn = pts.map((p, i) => [p.x + nrm[i].x * alpha[i],
                                    p.y + nrm[i].y * alpha[i]]);
    const prof = lapTimeOf(bahn, closed, o);
    return { alpha, limit, span: Math.max.apply(null, alpha.map(Math.abs)),
             lapTime: prof.time, startLapTime: prof.time, v: prof.v, gain: 0,
             // Kein Scheitel und keine Parameter: dieses Modell sucht nichts. Die Felder
             // bleiben leer statt zu behaupten, es haette welche.
             apex: [], par: [], evals: 0, accepted: 0 };
  }

  // ---- Aussen nach innen: hart an jeder Kurve, sanft auf jeder Geraden --------------
  //
  // BESTELLT (Phase 12, Punkt 14): "Kurvenfolge gleicher Richtung aussen anfahren, mit
  // Kurvenbeginn hart nach innen bis Kurvenende, bei Geradenfolgen sanfter Uebergang zur
  // jeweiligen Aussenseite."
  //
  // Das "aussen anfahren" IST linieGeradenAussenAnfahrt() - dieselbe Funktion, die
  // dreiStufenLine() fuer ihre Geraden benutzt, unveraendert uebernommen. Neu ist nur
  // die Kurve selbst: keine Aussenphase am Kurvenbeginn wie bei dreiStufenLine (dort
  // SPUR_EIN, bei der Haarnadel SPUR_EIN_HAARNADEL) - hier ist JEDE Kurve von der
  // ERSTEN bis zur LETZTEN Kachel voll innen, "hart" im Wortsinn: kein Uebergang
  // innerhalb der Kurve, die volle Staerke steht schon auf der allerersten Kachel.
  function aussenInnenLine(pts, nrm, o) {
    const n = pts.length;
    const tiles = o.tiles || [];
    const closed = o.closed !== false;
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const alpha = new Array(n).fill(0);
    const laeufe = lineKurvenLaeufe(tiles, closed);
    if (!laeufe.length || !tiles.length) {
      return { alpha, limit, span: 0, lapTime: null, startLapTime: null,
               v: null, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    const tab = trackKachelTabelle(pts, tiles.length);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    const stuecke = laeufe.map((lauf) => {
      const idx = [];
      for (let kk = lauf.von; kk <= lauf.bis; kk++) {
        const t = ((kk % tiles.length) + tiles.length) % tiles.length;
        for (let d = 0; d < tab.zahl[t]; d++) idx.push(at(tab.start[t] + d));
      }
      return { idx, dreht: lauf.dreht };
    }).filter((s) => s.idx.length);
    if (!stuecke.length) {
      return { alpha, limit, span: 0, lapTime: null, startLapTime: null,
               v: null, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    // ---- 1. Die Kurven: von der ersten bis zur letzten Kachel voll innen -----------
    for (const st of stuecke) {
      const innen = -st.dreht * SPUR_VOLL * limit;
      for (const idx of st.idx) alpha[idx] = innen;
    }
    // ---- 2. Die Geraden: MITTE, dann die Aussenseite der naechsten Kurve ----------
    linieGeradenAussenAnfahrt(alpha, stuecke, at, n, limit, SPUR_VOLL, closed);
    const bahn = pts.map((p, i) => [p.x + nrm[i].x * alpha[i], p.y + nrm[i].y * alpha[i]]);
    const prof = lapTimeOf(bahn, closed, o);
    return { alpha, limit, span: Math.max.apply(null, alpha.map(Math.abs)),
             lapTime: prof.time, startLapTime: prof.time, v: prof.v, gain: 0,
             apex: [], par: [], evals: 0, accepted: 0 };
  }

  // ---- Fahrbahnmitte: die denkbar einfachste Linie ----------------------------------
  //
  // BESTELLT (Phase 12, Punkt 12): ein Modus, der schlicht die Mitte der Fahrbahn haelt -
  // kein Scheitel, keine Seite, kein Layout noetig. Braucht kein `tiles`, weil es nichts
  // gibt, das es daraus lesen muesste.
  function mitteLine(pts, nrm, o) {
    const n = pts.length;
    const closed = o.closed !== false;
    const alpha = new Array(n).fill(0);
    const bahn = pts.map((p) => [p.x, p.y]);
    const prof = lapTimeOf(bahn, closed, o);
    return { alpha, limit: (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3), span: 0,
             lapTime: prof.time, startLapTime: prof.time, v: prof.v, gain: 0,
             apex: [], par: [], evals: 0, accepted: 0 };
  }

  // ---- Innenseite, gemittelt ueber die naechsten drei Kacheln -----------------------
  //
  // BESTELLT (Phase 12, Punkt 12): "innere Seite gemittelt ueber die naechsten 3 Teile."
  // Anders als dreiStufenLine() (springt an jeder Kachelgrenze hart zwischen aussen und
  // innen) mittelt dieses Modell die Drehrichtung (kurvenDrehung(), -1/0/+1) der
  // aktuellen Kachel und der beiden folgenden zu EINEM weichen Wert je Kachel - eine
  // kurze Kurve zwischen zwei Geraden zieht die Linie also nur teilweise nach innen
  // statt sie hart umzuschalten, und eine Schikane (links-rechts kurz hintereinander)
  // mittelt sich teilweise gegeneinander weg statt zweimal hart zu springen.
  //
  // BESTELLT (Nachtrag): "mach, dass sie schraeg ueber die Geraden geht, nicht dann von
  // jeder Schiene auf die naechste ein Sprung passiert." Der Mittelwert selbst stand
  // schon richtig da, wurde aber als FLACHES Plateau je Kachel aufgetragen - der Sprung
  // sass exakt an jeder Kachelgrenze. Jetzt ist jede Kachel eine eigene Rampe: sie
  // beginnt an ihrem eigenen Wert (drehMittel[t], "wo ich jetzt bin") und lauft bis zum
  // Kachelende linear auf den Wert der NAECHSTEN Kachel zu ("wohin ich als naechstes
  // muss") - am Kachelende, also am Anfang der naechsten, steht dadurch schon derselbe
  // Wert, mit dem die naechste Rampe beginnt. Keine zwei Kacheln behaupten an ihrer
  // gemeinsamen Grenze mehr zwei verschiedene Werte.
  function innenGemitteltLine(pts, nrm, o) {
    const n = pts.length;
    const tiles = o.tiles || [];
    const closed = o.closed !== false;
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const alpha = new Array(n).fill(0);
    if (!tiles.length) {
      const bahn = pts.map((p) => [p.x, p.y]);
      const prof = lapTimeOf(bahn, closed, o);
      return { alpha, limit, span: 0, lapTime: prof.time, startLapTime: prof.time,
               v: prof.v, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    const tCount = tiles.length;
    const tab = trackKachelTabelle(pts, tCount);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    // Am offenen Streckenende (nicht closed) wird nicht ueber das Ende hinaus gemittelt -
    // die letzten Kacheln mitteln also ueber weniger als drei, statt faelschlich mit der
    // ersten Kachel der Strecke weiterzurechnen.
    const drehMittel = tiles.map((t, i) => {
      let summe = 0, zahl = 0;
      for (let k = 0; k < 3; k++) {
        const idx = i + k;
        if (!closed && idx >= tCount) break;
        summe += kurvenDrehung(tiles[closed ? idx % tCount : idx].type);
        zahl++;
      }
      return zahl ? summe / zahl : 0;
    });
    for (let t = 0; t < tCount; t++) {
      const m = tab.zahl[t];
      const hatNaechste = closed || t + 1 < tCount;
      const ziel = hatNaechste ? drehMittel[(t + 1) % tCount] : drehMittel[t];
      for (let d = 0; d < m; d++) {
        // Anteil nach INDEX und nicht nach Weglaenge: anders als bei
        // lineGeradenPlan()/lineGeradenAnwenden() (fuer die Geraden ZWISCHEN zwei
        // Kurven bei dreiStufenLine/aussenInnenLine) hat hier JEDE einzelne Kachel
        // ihren eigenen, bedeutungsvollen Zielwert - eine Weglaengen-Gewichtung ueber
        // mehrere Kacheln hinweg wuerde diese einzelnen Ziele wieder verschlucken.
        const frac = m > 0 ? d / m : 0;
        const wert = drehMittel[t] + (ziel - drehMittel[t]) * frac;
        alpha[at(tab.start[t] + d)] = -wert * SPUR_VOLL * limit;
      }
    }
    const bahn = pts.map((p, i) => [p.x + nrm[i].x * alpha[i], p.y + nrm[i].y * alpha[i]]);
    const prof = lapTimeOf(bahn, closed, o);
    return { alpha, limit, span: Math.max.apply(null, alpha.map(Math.abs)),
             lapTime: prof.time, startLapTime: prof.time, v: prof.v, gain: 0,
             apex: [], par: [], evals: 0, accepted: 0 };
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
  // ---- 3-STUFIG IST JETZT DIE VORGABE ---------------------------------------------
  //
  // Vom Nutzer gesetzt, und der Grund ist gemessen (siehe dreiStufenLine): die drei
  // optimierenden Modelle erzeugen einen Befehl, der SCHWINGT - Kachelspanne 130 Byte bei
  // einem Mittelwert von 41. Ein Auto auf einer Schiene folgt so etwas nicht; was es bewegt,
  // ist ein gehaltener Befehl. Die 3-Stufen-Linie haelt, gemessen Kachelmittelwerte von 80
  // bis 93.
  //
  // Die drei anderen bleiben waehlbar - sie sind als OPTIMIERUNG richtig und zeigen, wo eine
  // schnellste Linie laege. Sie sind nur nicht das, was dieses Fahrzeug fahren kann.
  //
  // ---- LUUKE-LINIE IST DIE VORGABE ------------------------------------------------------
  //
  // v0.7.57 stellte auf "Innen (gemittelt)" um ("ideallinie standard: innen"). GEMELDET
  // danach: die Ghosts "sind tuer an tuer gefahren" - innen3 kommt nie auf die Aussenseite
  // (siehe dort), alle Ghosts draengen sich also auf dieselbe Bahnhaelfte. Und: "Luuke-
  // Modus ist gut". Zurueck auf Luuke - Innen bleibt waehlbar.
  let lineModel = 'luuke';

  // Die gueltigen Modellnamen an EINER Stelle. Vorher stand die Liste als zwei
  // Vergleiche in setLineModel und ein weiteres Mal als Bedingung in buildLine - beim
  // dritten Modell waeren das drei Orte fuer eine Liste gewesen.
  // 'dreistufig' ist KEINE Optimierung und steht deshalb am Ende: die drei davor suchen
  // ein Optimum, dieses folgt einer Vorschrift. Die Begruendung steht bei dreiStufenLine().
  const LINE_MODELLE = ['curvature', 'laptime', 'lateapex', 'dreistufig', 'mitte', 'innen3',
                        'aussenin', 'luuke'];

  function setLineModel(m) {
    if (LINE_MODELLE.indexOf(m) < 0) return;
    lineModel = m;
  }
  function getLineModel() { return lineModel; }

  // ---- KURVENAUSGANG OEFFNEN ---------------------------------------------------------
  //
  // GEMELDET: "nach der Haarnadelkurve sollten die Autos sich nach aussen tragen lassen und
  // nicht ganz innen wieder losbeschleunigen."
  //
  // NACHGEMESSEN an SHG4HG3 (geschlossen, zwei Haarnadeln), alpha in Anteilen des Deckels,
  // negativ heisst innen:
  //
  //     Haarnadel     -0,75 -0,98 -1,00 -1,00 -1,00 -1,00
  //     Gerade danach -0,90 -0,84 -0,78 -0,70 -0,65 -0,60
  //     dann          -0,54 ... -0,37  und dort bleibt sie
  //
  // Die Linie kommt also NIE auf die Aussenseite. Das ist keine Fehlfunktion der
  // Kruemmungsminimierung, sondern ihre Eigenschaft: sie sucht den kuerzesten glatten Weg,
  // und bei zwei gleichsinnigen Kurven auf 25 cm Bahnbreite liegt der innen. Ein Fahrer
  // faehrt trotzdem weit heraus, weil er BESCHLEUNIGT und dafuer Breite braucht - das ist
  // eine Laengsgroesse, und die kennt der Glaetter nicht.
  //
  // WARUM ALS NACHLAUF UND NICHT IN DER RELAXATION: es gab schon einmal zwei Versuche, das
  // in die Relaxation zu ziehen, und beide sind gescheitert - der Kommentar bei idealLine()
  // haelt sie fest. Der zweite gab eine Zielvorgabe auf der Geraden und erzeugte damit ein
  // S: raus am Ausgang, zurueck zur Mitte, wieder raus. Eine Feder auf ein festes Ziel
  // DECKELT ausserdem den Ausschlag, den der Glaetter sonst weiter treiben wuerde. Deshalb
  // hier: der Glaetter laeuft unveraendert, und danach wird nur der Ausgang geoeffnet.
  //
  // DIE FORM IST GEWAEHLT, nicht abgeleitet - deshalb der Regler daneben. Was gemessen ist:
  // wo der Scheitel liegt (dort ist die Kruemmung der Linie am groessten) und wie lang eine
  // Kachel ist. Die Oeffnung laeuft vom Scheitel ueber eine Kachellaenge aus.
  // 0,8 UND NICHT MEHR 0,5, weil der Regler jetzt eine LAGE angibt und keinen Zuschlag:
  // "am Kurvenein- und -ausgang so viel Prozent des Weges zum Aussenrand". Bei 0,5 stand die
  // Linie hinter einer Haarnadel gemessen noch bei -0,10 des Deckels, also auf der
  // Innenseite - bestellt war "von aussen anfahren und aussen verlassen". Mit 0,8 liegt sie
  // dort bei +0,02 und die Anfahrt bei +0,09.
  // 0 statt 0,8 - vom Nutzer gesetzt. Und es passt zur 3-Stufen-Linie: die Kurvenoeffnung
  // ist eine Schranke auf den Ein- und Ausgangspunkten, die 3-Stufen-Linie setzt sie aber
  // ohnehin auf den Anschlag. Gemessen kostete die Oeffnung dem Rundenzeitmodell 4,9 bis
  // 5,3 Prozent Rundenzeit gegenueber der Mittellinie - sie kauft das AUSSEHEN einer
  // Ideallinie und keine Zeit.
  let lineExitStaerke = 0;
  function setLineExit(v) { lineExitStaerke = Math.max(0, Math.min(1, v || 0)); }
  function getLineExit() { return lineExitStaerke; }

  // Scheitel finden, KURVENAUSGANG finden, und von dort nach aussen blenden.
  //
  // BEIDE PUNKTE KOMMEN AUS DEM LAYOUT und nicht aus einer Kruemmungsschwelle. Eine Kurve
  // besteht aus einer oder mehreren aufeinanderfolgenden Kurvenkacheln - das steht in
  // tiles[i].type, und ihre Grenze ist eine Tatsache und keine Schaetzung. Der Scheitel ist
  // dann der Punkt groesster Linienkruemmung INNERHALB dieses Laufs, der Ausgang seine
  // letzte Kachelgrenze.
  //
  // ERSTER VERSUCH SUCHTE LOKALE MAXIMA MIT SCHWELLE `k > 0.3 * kMax`, und das ist an einem
  // Artefakt gescheitert: auf einer geschlossenen Runde faellt der letzte Abtastpunkt mit
  // dem ersten zusammen, und die Kruemmungsformel lieferte dort 0,6999 gegen 0,13 der
  // Haarnadeln. kMax war also der doppelte Punkt, die Schwelle lag bei 0,21, und keine
  // Haarnadel kam darueber - gemessen wurde GENAU EIN Scheitel gefunden, und der war das
  // Artefakt. Die Schranke in pathCurvature() behebt die Ursache; diese Verankerung macht
  // die Suche ausserdem unabhaengig davon.
  //
  // GEWAEHLT ist nur die Auslauflaenge nach dem Ausgang (eine Kachellaenge) und die Staerke.
  // Deshalb der Regler.
  const LINE_EXIT_AUSLAUF = TRACK_STEP;      // eine Kachellaenge, in Zeichnungseinheiten

  // ---- DIE VORGABESTRECKE -------------------------------------------------------------
  //
  // Bestellt: "Standard Streckenlayout fuer Simulation (wenn nichts eingetragen): Nimm das,
  // was ich dir geschrieben hatte." Dreizehn Kacheln, acht Rechtskurven, eine Linkskurve;
  // gemessen geschlossen mit 0,48 cm Luecke und 0 Grad Winkelfehler.
  //
  // HIER UND NICHT IN 90b-sim.js, obwohl die Simulation der Anlass war: die Linienvorschau
  // in den Ghost-Einstellungen braucht sie auch, und die steht in 90-ghosts.js - also VOR
  // der Simulationsdatei. Ein const in der gemeinsamen IIFE, das von einer frueheren Datei
  // gelesen wird, liegt in seiner temporalen Todeszone; an dieser Falle hat dieses Projekt
  // schon eine ganze IIFE verloren. 60-track.js liest niemand von weiter vorn.
  const TRACK_VORGABE_CODE = 'SR3GLR2GR2G2';

  function istKurvenTyp(t) {
    return t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.CURVE_RIGHT
        || t === TILE_TYPE.HAIRPIN || t === TILE_TYPE.HAIRPIN_LEFT;
  }

  function istHaarnadel(t) {
    return t === TILE_TYPE.HAIRPIN || t === TILE_TYPE.HAIRPIN_LEFT;
  }

  // Die Drehrichtung einer Kachel: +1 rechts, -1 links, 0 keine Kurve.
  function kurvenDrehung(t) {
    if (t === TILE_TYPE.CURVE_RIGHT || t === TILE_TYPE.HAIRPIN) return 1;
    if (t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.HAIRPIN_LEFT) return -1;
    return 0;
  }

  // Wie weit eine Kurve geoeffnet wird, als Anteil der Staerke. GEWAEHLT, und der Grund ist
  // die Bahnbreite: eine 60-Grad-Kurve laesst sich mit 25 cm Breite noch rund fahren, eine
  // Haarnadel nicht - dort ist der Unterschied zwischen aussen und innen der ganze Radius.
  // Gemeldet: "nach der Haarnadelkurve sollten die Autos sich nach aussen tragen lassen",
  // und in derselben Nachricht "Haarnadel von aussen anfahren und aussen verlassen".
  const LINE_OEFFNUNG_HAARNADEL = 1.0;
  const LINE_OEFFNUNG_KURVE = 0.6;

  // Die Kurvenlaeufe eines Layouts: zusammenhaengende Ketten von Kurvenkacheln, ueber das
  // Rundenende hinweg zusammengefasst, wenn die Runde geschlossen ist.
  function lineKurvenLaeufe(tiles, closed) {
    const n = tiles.length;
    const laeufe = [];
    let i = 0;
    while (i < n) {
      const d = kurvenDrehung(tiles[i].type);
      if (!d) { i++; continue; }
      let j = i;
      // ---- NUR GLEICHSINNIGE KACHELN, und das ist eine Berichtigung ------------------
      //
      // Hier stand `istKurvenTyp(tiles[j + 1].type)` ohne Ruecksicht auf die Richtung. Damit
      // wurde aus einer Schikane EINE Kurve: auf SR3GLR2GR2G2 verschmolzen die Kacheln
      // 5 (links) und 6-7 (rechts) zu einem Zug, und das Layout hat dann drei Kurven statt
      // vier. Gefunden hat es das dritte Linienmodell, weil es je Kurve einen Scheitel
      // vergibt und deshalb ZAEHLT - die Oeffnung davor nahm ihr Vorzeichen aus dem
      // Scheitel und funktionierte mit dem falschen Zug halbwegs weiter, also fiel es nicht
      // auf.
      //
      // Eine Links-Rechts-Kombination ist zwei Kurven mit zwei Scheiteln. Dass zwischen
      // ihnen keine Gerade liegt, macht sie nicht zu einer.
      while (j + 1 < n && kurvenDrehung(tiles[j + 1].type) === d) j++;
      laeufe.push({ von: i, bis: j, dreht: d });
      i = j + 1;
    }
    // Ueber die Naht: laeuft die Kette am Ende weiter und beginnt am Anfang wieder, ist es
    // EINE Kurve - aber nur bei GLEICHER Drehrichtung, aus demselben Grund wie oben. Ohne
    // das bekaeme eine Kurve, die auf der Start/Ziel-Kachel liegt, zwei Scheitel und zwei
    // Ausgaenge.
    if (closed && laeufe.length > 1) {
      const erst = laeufe[0], letzt = laeufe[laeufe.length - 1];
      if (erst.von === 0 && letzt.bis === n - 1 && erst.dreht === letzt.dreht) {
        letzt.bis = erst.bis + n;      // ueber die Naht hinaus zaehlen
        laeufe.shift();
      }
    }
    return laeufe;
  }

  // ---- AUF EINER GERADEN WIRD NICHT GELENKT ------------------------------------------
  //
  // GEMELDET: "In den aktuellen Ideallinien sind diese komischen Kurven - selbst bei einer
  // Gerade sagst du dem Auto, es solle eine Kurve fahren. Mach ausserdem, dass bei einer
  // oder mehreren Geraden zwischen zwei Kurven bezueglich der Querlage der Ausgangspunkt der
  // einen mit dem Eingangspunkt der anderen verbunden wird (auf der Zielgeraden fahren alle
  // Autos nach ganz rechts). Das macht keinen Sinn."
  //
  // NACHGEMESSEN an SR3GLR2GR2G2, alpha auf den Deckel normiert:
  //
  //   Kruemmung   Zielgerade: +0,38 -> -0,83, dann -0,81 bis -0,83 die GANZE letzte Kachel.
  //               Auf Geraden 10 Vorzeichenwechsel der zweiten Differenz, groesste 1,16.
  //   Rundenzeit  16 Wechsel, groesste 0,557.
  //
  // Beides ist derselbe Befund: die Glaetter behandeln alpha als freie Funktion des Ortes
  // und haben keinen Begriff von "hier ist gerade". Die Kruemmungsminimierung darf auf einer
  // Geraden alles tun, was den Radius der GESAMTLINIE nicht verschlechtert, und die
  // oertliche Suche findet dort Zeitgewinne im Mikrometerbereich - beides ergibt Ausschlaege,
  // die ein Fahrer nie fahren wuerde und ein Lenkservo als Ruck ausfuehrt.
  //
  // DIE REGEL IST GEOMETRIE UND KEINE ABSTIMMUNG: auf einer Geraden ist der kuerzeste Weg
  // zwischen zwei Querlagen die Verbindungslinie. Sie wird nach WEGLAENGE interpoliert und
  // nicht nach Punktzahl - die Punkte liegen ungleich dicht (gemessen 14 je Gerade, 49 je
  // Haarnadel), und eine Interpolation nach Index waere auf einer Kachelgrenze knickig.
  //
  // DIE ANKER SIND DIE KURVENWERTE an den Kachelgrenzen. Seit v0.5.43 wird diese Funktion
  // INNERHALB von formLine() gerufen, also fuer jede Kandidatenlinie der Suche: die Geraden
  // sind damit nicht mehr ein Nachlauf, sondern Teil dessen, was bewertet wird.
  // ---- IN PLAN UND ANWENDUNG GETEILT, und das ist eine Messung wert ------------------
  //
  // Diese Verbindung laeuft INNERHALB der Optimierung, also einmal je Kandidatenlinie -
  // gemessen 683 Mal auf einer 33-Kachel-Strecke. Sie rechnete dabei jedes Mal dieselbe
  // Geometrie neu: die Kurvenlaeufe, die Kacheltabelle ueber alle Abtastpunkte, die Grenzen
  // je Lauf und die Weglaengen der Geradenstuecke. Nichts davon haengt an alpha.
  //
  // Gemessen kostete ein Editor-Neuaufbau auf 33 Kacheln 549 ms, und der Editor rechnet ihn
  // bei JEDEM Klick auf eine Kachel. Der Plan wird deshalb einmal gebaut und dann nur noch
  // angewandt - dieselbe Linie, weniger Arbeit.
  function lineGeradenPlan(pts, closed, tiles) {
    const n = pts.length;
    if (!tiles || !tiles.length || n < 4) return null;
    const laeufe = lineKurvenLaeufe(tiles, closed);
    if (!laeufe.length) return null;          // keine Kurve, kein Anker
    const tab = trackKachelTabelle(pts, tiles.length);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    // Die Abtastpunkte eines Kurvenlaufs, ueber die Naht hinweg - dieselbe Rechnung wie in
    // lateApexZug(), und sie steht hier ein zweites Mal, weil beide Funktionen sonst ein
    // Datenpaket austauschen muessten, das nur aus zwei Zahlen je Lauf besteht.
    const grenzen = laeufe.map((lauf) => {
      let erst = null, letzt = null;
      for (let kk = lauf.von; kk <= lauf.bis; kk++) {
        const t = ((kk % tiles.length) + tiles.length) % tiles.length;
        for (let d = 0; d < tab.zahl[t]; d++) {
          const i = at(tab.start[t] + d);
          if (erst === null) erst = i;
          letzt = i;
        }
      }
      return { ein: erst, aus: letzt };
    }).filter((g) => g.ein !== null);
    if (!grenzen.length) return null;
    const abst = (i, j) => Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    // Je Paar aufeinanderfolgender Kurven das Stueck dazwischen. Bei einer geschlossenen
    // Runde auch das Paar (letzte, erste) - sonst bliebe genau die Zielgerade uebrig, und
    // die ist der gemeldete Fall.
    const paare = [];
    for (let g = 0; g + 1 < grenzen.length; g++) {
      paare.push([grenzen[g].aus, grenzen[g + 1].ein]);
    }
    if (closed) paare.push([grenzen[grenzen.length - 1].aus, grenzen[0].ein]);
    const stuecke = [];
    for (const [von, bis] of paare) {
      const weg = [0];
      const idx = [];
      let i = von, sicher = 0;
      while (sicher++ <= n) {
        const j = at(i + 1);
        if (j === bis) break;
        idx.push(j);
        weg.push(weg[weg.length - 1] + abst(i, j));
        i = j;
      }
      if (!idx.length) continue;                 // Kurven stossen direkt aneinander
      const gesamt = weg[weg.length - 1] + abst(i, bis);
      if (!(gesamt > 1e-9)) continue;
      // Der Anteil je Punkt, fertig gerechnet. Danach ist die Anwendung eine Multiplikation.
      stuecke.push({ von, bis, idx, f: idx.map((unused, q) => weg[q + 1] / gesamt) });
    }
    return stuecke.length ? stuecke : null;
  }

  // Anwenden, AN DER STELLE und ohne Kopie: der Aufrufer in formLine() baut alpha ohnehin je
  // Auswertung neu, und eine Kopie je Auswertung war messbar - 683 Mal ein Array von 463
  // Zahlen.
  function lineGeradenAnwenden(alpha, plan) {
    if (!plan) return alpha;
    for (const st of plan) {
      const a0 = alpha[st.von], d = alpha[st.bis] - a0;
      for (let q = 0; q < st.idx.length; q++) alpha[st.idx[q]] = a0 + d * st.f[q];
    }
    return alpha;
  }

  // Die alte Signatur bleibt fuer Aufrufer, die keinen Plan halten - sie kopiert, damit sie
  // das Eingabearray nicht veraendert.
  function lineGeradenVerbinden(alpha, pts, closed, tiles) {
    const plan = lineGeradenPlan(pts, closed, tiles);
    return plan ? lineGeradenAnwenden(alpha.slice(), plan) : alpha;
  }

  // ======================= LUUKE-LINIE ================================================
  //
  // BESTELLT: eigener, von Hand vorgegebener Ideallinien-Modus, aus sechs
  // Beispiel-Streckenverlaeufen mit Querlage-Ankern hergeleitet (-100 = ganz links,
  // +100 = ganz rechts, 0 = Mitte - dieselbe Skala, in der die Beispiele geliefert
  // wurden). Fuenf der sechs Beispiele sind verlaesslich (eines, SR3L3, passte nicht zur
  // eigenen Kachelzahl und ist auf Anweisung fallengelassen):
  //
  //   SGR3G      0, -50, -100, 100, -50, 100
  //   SRLG       0, 100, 0, -100
  //   SGHG       0, -50, -75, 0
  //   SR2GL2G    0, -100, 100, 0, 100, -100, 100
  //   SR2G2RG2   0, -100, 100, -100, -100, 100, 0, -100
  //
  // DIE FUEHRENDE 0 JE ZEILE IST DIE STARTKACHEL - in allen fuenf Beispielen zufaellig 0,
  // aber NICHT als eigene Vorgabe zu lesen (siehe Punkt 7 unten: ihr Anker wird
  // inzwischen berechnet, nicht mehr aus den Beispielen abgeschrieben).
  //
  // DIE REGEL, tileweise hergeleitet und gegen alle 34 Zahlen der fuenf Beispiele
  // geprueft (31 von 34 treffen exakt, zwei Ausreisser bleiben offen - siehe unten):
  //
  //   1. KURVENLAEUFE (lineKurvenLaeufe(), schon vorhanden fuer dreiStufenLine): der
  //      Scheitel sitzt auf Lauf-Position min(1, Lauflaenge-1) - bei Laenge 1 die einzige
  //      Kachel, bei Laenge 2 die zweite, bei Laenge 3 die MITTLERE (nicht die letzte).
  //   2. Scheitel: volles Innen (=Kurvenrichtung), Betrag 100 - AUCH bei Schaerfeklasse 2
  //      (Haarnadel/Enge). Stand hier frueher als Ausnahme bei -75 * Richtung (Aussen,
  //      nur 75), belegt an einem einzelnen Beispiel (SGHG) und als offene Frage markiert
  //      ("Vorzeichen-Dreher oder bewusstes Aussenfahren?"). BESTELLT (Antwort): "in
  //      haarnadel weiter innen" - kein bewusstes Aussenfahren, die Ausnahme ist
  //      aufgehoben. Den kurzen Aussen-Touch am Einstieg einer Haarnadel bildet seither
  //      luukeLinie() selbst ab (eigenes Drei-Phasen-Profil je Kachel statt der
  //      allgemeinen Zwei-Halbrampen-Form, siehe dort), nicht mehr der Anker selbst.
  //   3. Erste Kachel eines Laufs (wenn nicht Scheitel): volles Aussen, Betrag 100 (bzw.
  //      50 bei Schaerfeklasse 0, den weiten Kurven - keine Beispiele dafuer, aus der
  //      Schaerfeklasse selbst hergeleitet: halbe Wirkung fuer ein Drittel der
  //      Querbeschleunigung).
  //   4. Kacheln NACH dem Scheitel, noch im selben Lauf: halbes Aussen (Betrag 50) - nur
  //      mit einem Beleg (SGR3G, Laufl. 3) geprueft, fuer laengere Laeufe unbestaetigt.
  //   5. EIN LAUF DER LAENGE 1, UNMITTELBAR (ohne Gerade dazwischen) einem gegensinnigen
  //      Lauf folgend, ist "gedaempft": seine einzige Kachel wird 0 statt des Scheitels,
  //      und der volle Scheitelwert wandert auf die naechste Kachel weiter, WENN diese
  //      eine einfache Gerade ist (keine Startkachel, keine weitere Kurve) - belegt an
  //      SRLG (R triftt L ohne Puffer: R selbst bleibt bei +100, L wird zu 0, die
  //      folgende Gerade traegt den vollen Linksscheitel -100). Nur ein Beleg, als
  //      Sonderfall uebernommen.
  //   6. GERADEN (nicht die Startkachel, siehe Punkt 7): siehe luukeGeradenWert() - weder
  //      reine Interpolation noch symmetrischer Zerfall passten auf die Daten, sondern
  //      ein Blick nach vorn UND zurueck:
  //        - Unmittelbar NACH der Startkachel: halbes Aussen Richtung naechstem Lauf,
  //          aber nur, wenn dieser genau eine Kachel entfernt ist (SGR3G, SGHG).
  //        - Unmittelbar nach dem Verlassen eines Laufs: volles Aussen Richtung des
  //          naechsten Laufs, aber NUR wenn dieser hoechstens zwei Kacheln entfernt ist
  //          UND gleichsinnig zum gerade verlassenen Lauf dreht (SR2G2RG2, beide Luecken)
  //          - sonst 0 (Ruecksprung zur Mitte, SGHG/SR2GL2G/SR2G2RG2).
  //   7. DIE STARTKACHEL selbst steht NICHT fest auf 0 (anders als in den fuenf
  //      Beispielen, wo sie es zufaellig immer war). BESTELLT (Korrektur, nachdem Punkt
  //      6 oben schon stand): "nicht bei Start immer in der Mitte, sondern so, dass man
  //      von der Schiene davor und danach moeglichst wenig lenken muss." Ihr Anker ist
  //      deshalb der MITTELWERT der beiden Nachbarkacheln (davor und danach je einmal um
  //      die Naht herum) - das teilt die noetige Lenkbewegung gleichmaessig auf beide
  //      Rampen auf, statt zusaetzlich ueber die Mitte zu erzwingen. Berechnet NACH allen
  //      anderen Ankern; siehe der Kommentar an der Berechnung selbst, warum das keine
  //      Ringabhaengigkeit ist.
  //
  //   ZWEI OFFENE RESTFRAGEN, nicht stillschweigend festgelegt (an Luuke zurueckspielen):
  //     - SGR3G und SR2GL2G haben je EINE Gerade unmittelbar vor der Startkachel (nach
  //       dem Verlassen eines Laufs, gleichsinnig zum naechsten Lauf ueber die Naht
  //       hinweg), deren Wert (+100 in beiden Faellen) die Geraden-Regel (Punkt 6) nicht
  //       erklaert - sie wuerde 0 vorhersagen (Ruecksprung zur Mitte). Beide Belege zeigen
  //       ausgerechnet +100, nicht irgendeinen Wert - zu konsistent fuer reines Rauschen,
  //       aber ohne erklaerenden Mechanismus. Vorschlag: 0 lassen (die haeufigere,
  //       bestaetigte Regel), beide Faelle als offene Frage vermerkt. Punkt 7 (Startkachel
  //       nicht mehr fest auf 0) aendert daran nichts: die Restfrage betrifft die Gerade
  //       VOR der Startkachel, nicht die Startkachel selbst.
  //     - Der Haarnadel-Scheitel (-75, Punkt 2 oben) koennte ebenso gut ein
  //       Vorzeichendreher beim Eintippen sein (+75 waere das erwartete Vorzeichen).
  //       Uebernommen wie geliefert, mit derselben Markierung.
  //
  // NEUER RICHTUNGS-HELFER FUER WEITE/KLEINE KURVEN: kurvenDrehung() liefert fuer sie
  // bewusst 0 (siehe dort) - eine echte Luecke, aber dreistufig/innen3/aussenin haengen
  // an genau dieser 0, also wird kurvenDrehung() selbst NICHT angefasst. luukeDrehung()
  // ist ein PARALLELER Helfer, nur fuer dieses Modell.
  function luukeDrehung(t) {
    if (t === TILE_TYPE.CURVE_RIGHT || t === TILE_TYPE.HAIRPIN
        || t === TILE_TYPE.WEIT_RIGHT || t === TILE_TYPE.KLEIN_RIGHT) return 1;
    if (t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.HAIRPIN_LEFT
        || t === TILE_TYPE.WEIT_LEFT || t === TILE_TYPE.KLEIN_LEFT) return -1;
    return 0;
  }

  // Kurvenlaeufe wie lineKurvenLaeufe(), nur mit luukeDrehung() statt kurvenDrehung() -
  // sonst wuerden weite/kleine Kurven hier gar nicht erst als Lauf gezaehlt.
  function luukeLaeufe(tiles, closed) {
    const n = tiles.length;
    const laeufe = [];
    let i = 0;
    while (i < n) {
      const d = luukeDrehung(tiles[i].type);
      if (!d) { i++; continue; }
      let j = i;
      while (j + 1 < n && luukeDrehung(tiles[j + 1].type) === d) j++;
      laeufe.push({ von: i, bis: j, dreht: d });
      i = j + 1;
    }
    if (closed && laeufe.length > 1) {
      const erst = laeufe[0], letzt = laeufe[laeufe.length - 1];
      if (erst.von === 0 && letzt.bis === n - 1 && erst.dreht === letzt.dreht) {
        letzt.bis = erst.bis + n;
        laeufe.shift();
      }
    }
    return laeufe;
  }

  // 100 fuer Schaerfeklasse 1 und 2 (Standard-/Kleinkurve, Haarnadel/Enge), 50 fuer
  // Klasse 0 (Weitkurve) - hergeleitet aus der Querbeschleunigung (ein Drittel des
  // Radius bei gleichem Tempo), nicht aus einem Beispiel: keine der fuenf Vorlagen
  // enthaelt eine Weitkurve.
  function luukeBase(tightness) { return tightness === 0 ? 50 : 100; }

  // Geraden - NICHT die Startkachel, die bekommt ihren eigenen Anker separat (Punkt 7
  // oben) - siehe Punkt 6 oben.
  function luukeGeradenWert(i, tiles, runOf, closed, at) {
    const n = tiles.length;
    const justAfterS = (closed || i > 0) && tiles[at(i - 1)].type === TILE_TYPE.START;
    let prevRun = null;
    for (let back = 1; back <= n; back++) {
      if (!closed && i - back < 0) break;
      const idx = at(i - back);
      if (runOf[idx]) { prevRun = runOf[idx]; break; }
    }
    let nextRun = null, dist = null;
    for (let fwd = 1; fwd <= n; fwd++) {
      if (!closed && i + fwd >= n) break;
      const idx = at(i + fwd);
      if (runOf[idx]) { nextRun = runOf[idx]; dist = fwd; break; }
    }
    if (justAfterS) {
      if (nextRun && dist === 1) {
        const tight = tileTightness(tiles[at(nextRun.von)].type);
        return -0.5 * luukeBase(tight) * nextRun.dreht;
      }
      return 0;
    }
    if (nextRun && prevRun && dist <= 2 && nextRun.dreht === prevRun.dreht) {
      const tight = tileTightness(tiles[at(nextRun.von)].type);
      return -luukeBase(tight) * nextRun.dreht;
    }
    return 0;
  }

  // Die Querlage-Anker je Kachel, auf der -100..100-Skala der Beispiele (noch keine
  // alpha-Werte - das macht luukeLinie() daraus, mit der Vorzeichenumkehr und der
  // Fahrgrenze).
  function luukeLinieAnker(tiles, closed) {
    const n = tiles.length;
    const anker = new Array(n).fill(0);
    if (!n) return anker;
    const at = (i) => ((i % n) + n) % n;
    const laeufe = luukeLaeufe(tiles, closed);
    const runOf = new Array(n).fill(null);
    laeufe.forEach((lauf) => {
      for (let p = lauf.von; p <= lauf.bis; p++) runOf[at(p)] = lauf;
    });

    const override = new Map();
    laeufe.forEach((lauf) => {
      const len = lauf.bis - lauf.von + 1;
      const d = lauf.dreht;
      const tight = tileTightness(tiles[at(lauf.von)].type);
      const base = luukeBase(tight);
      const apexPos = Math.min(1, len - 1);
      // Unmittelbar (ohne Puffer) einem gegensinnigen Lauf folgend? Siehe Punkt 5 oben.
      let vor = null;
      for (const other of laeufe) {
        if (other !== lauf && at(other.bis + 1) === at(lauf.von)) { vor = other; break; }
      }
      const gedaempft = len === 1 && vor && vor.dreht === -d;
      for (let p = 0; p < len; p++) {
        const idx = at(lauf.von + p);
        let wert;
        // HAARNADEL-SCHEITEL: FRUEHERE SONDERREGEL AUFGEGEBEN. Stand bisher bei -75 * d
        // (AUSSEN statt innen, nur 75 statt 100) - der einzige Beleg dafuer war ein
        // einzelnes Beispiel (SGHG), als offene Frage an Luuke dokumentiert ("entweder
        // Haarnadeln werden bewusst zur Aussenseite hin gefahren, oder es ist ein
        // Vorzeichen-Dreher"). BESTELLT (Antwort, diese Runde): "in haarnadel weiter
        // innen (am anfang kurz aussen, danach sofort nach innen)" - die Frage ist damit
        // beantwortet: Vorzeichen-Dreher, kein bewusstes Aussenfahren. Der Scheitel folgt
        // jetzt derselben allgemeinen Regel wie jede andere Kurve (Betrag 100, volles
        // Innen); den kurzen Aussen-Touch am Anfang bildet stattdessen luukeLinie() selbst
        // ab (das Drei-Phasen-Profil dort, siehe die Begruendung an ihrer eigenen Stelle).
        if (p === apexPos) wert = base * d;
        else if (p === 0) wert = -base * d;
        else {
          // NACH DEM SCHEITEL: BESTELLT (Korrektur), an einem Lauf von vier Rechtskurven
          // beobachtet - "sollte das Auto erst ab der letzten oder vorletzten Kurve nach
          // aussen driften, um herauszubeschleunigen." Die alte Fassung liess JEDE Kachel
          // nach dem Scheitel sofort auf halbes Aussen fallen (-0,5*base*d) - das war nur
          // an einem LAUF DER LAENGE 3 belegt (SGR3G), wo "sofort nach dem Scheitel" und
          // "die letzte Kachel des Laufs" dieselbe Kachel sind und sich nicht
          // unterscheiden liessen. Ab Lauflaenge 4 zeigt sich der Unterschied: die
          // Kacheln VOR den letzten beiden halten jetzt den Scheitel (volles Innen),
          // die vorletzte beginnt den Wechsel, und erst die letzte erreicht den
          // bestaetigten Wert -0,5*base*d. Nur die letzte Kachel ist an Daten (SGR3G)
          // belegt; die vorletzte (0,25*base*d) und "davor voll halten" sind eine
          // Erweiterung nach der obigen Beobachtung, keine zweite Messung.
          const distZumEnde = (len - 1) - p;
          if (distZumEnde >= 2) wert = base * d;
          else if (distZumEnde === 1) wert = 0.25 * base * d;
          else wert = -0.5 * base * d;
        }
        if (gedaempft && p === apexPos) {
          anker[idx] = 0;
          const naechsterIdx = at(lauf.bis + 1);
          if (!runOf[naechsterIdx] && tiles[naechsterIdx].type !== TILE_TYPE.START) {
            override.set(naechsterIdx, wert);
          }
        } else {
          anker[idx] = wert;
        }
      }
    });

    const startIdxListe = [];
    for (let i = 0; i < n; i++) {
      if (runOf[i]) continue;
      if (tiles[i].type === TILE_TYPE.START) { startIdxListe.push(i); continue; }
      if (override.has(i)) { anker[i] = override.get(i); continue; }
      anker[i] = luukeGeradenWert(i, tiles, runOf, closed, at);
    }
    // DIE STARTKACHEL NICHT MEHR FEST AUF 0: BESTELLT, "nicht bei Start immer in der
    // Mitte, sondern so, dass man von der Schiene davor und danach moeglichst wenig
    // lenken muss." Der Mittelwert der beiden Nachbarn teilt die noetige Lenkbewegung
    // gleichmaessig auf die Rampe davor UND danach auf, statt zusaetzlich ueber die
    // Mitte zu erzwingen - eine dritte, unnoetige Wende. Erst NACH allen anderen Ankern
    // berechnet: luukeGeradenWert() und die gedaempfte Uebergabe oben pruefen nur den
    // TYP der Startkachel (TILE_TYPE.START), nie ihren Zahlenwert - keine Ringabhaengigkeit.
    // BESTELLT: mehrere Start/Ziel-Geraden als Sektoren - JEDE Startkachel wird so
    // gesetzt, nicht nur die letzte.
    if (startIdxListe.length && n > 1) {
      startIdxListe.forEach((si) => {
        const vorIdx = at(si - 1), nachIdx = at(si + 1);
        anker[si] = (anker[vorIdx] + anker[nachIdx]) / 2;
      });
    }
    return anker;
  }

  // Anker -> alpha: dieselbe Vorzeichenabbildung wie innenGemitteltLine() (alpha = -wert
  // * limit, hier auf die -100..100-Skala bezogen statt auf SPUR_VOLL).
  //
  // DER ANKER GILT AN DER KACHELMITTE, nicht am Kachelanfang - BESTELLT (Korrektur,
  // Bild einer Haarnadel mit einem Buckel am Innenrand): die vorige Fassung rampte von
  // "diese Kachel" (bei Abtastpunkt 0) zu "naechste Kachel" (beim ERSTEN Punkt der
  // naechsten Kachel) UEBER DIE GANZE Kachel hinweg - der eigentliche Kachelwert (z. B.
  // der Scheitel einer Haarnadel) war damit nur fuer einen einzigen Abtastpunkt am
  // Kachelanfang wahr und danach sofort wieder auf dem Weg zum naechsten Wert. Bei einer
  // langen Kachel (eine Haarnadel hat 49 statt 14 Abtastpunkte) heisst das: der Scheitel
  // wird nie wirklich GEFAHREN, nur gestreift. Jetzt zwei Halbrampen je Kachel, von der
  // eigenen Mitte zu den GRENZEN (nicht zu den fremden Mitten) - der eigene Wert sitzt an
  // der Kachelmitte, jede Grenze zur Nachbarkachel am MITTELWERT der beiden angrenzenden
  // Kachelwerte.
  //
  // GEFUNDEN BEIM BAUEN, und zwar an einem echten Sprung, nicht nur einem Verdacht: eine
  // erste Fassung liess die zweite Haelfte einer Kachel bis zum vollen Wert der NAECHSTEN
  // Kachel rampen (und die erste Haelfte der naechsten Kachel wieder zurueck bis zum
  // vollen Wert DIESER Kachel) - an der gemeinsamen Grenze trafen sich damit zwei
  // GEGENSAETZLICHE Ziele (der Wert der jeweils ANDEREN Kachel) statt desselben Werts,
  // und alpha sprang dort um bis zu 194 % der gesamten Fahrgrenze in einem einzigen
  // Abtastschritt (gemessen an SR3GLR2GR2G2, Kachel 1/2: Sprung 16,75 bei einer Grenze
  // von 8,63). Der Bericht dazu: "die luuke linie ist nun voellig wirr". Jetzt endet jede
  // Halbrampe am MITTELWERT der eigenen und der Nachbarkachel - denselben Wert, den die
  // Nachbarkachel an IHRER Seite derselben Grenze auch ansteuert. SMOOTHSTEP (3u^2 - 2u^3)
  // je Halbrampe, Steigung null an Kachelmitte UND Kachelgrenze.
  function luukeLinie(pts, nrm, o) {
    const n = pts.length;
    const tiles = o.tiles || [];
    const closed = o.closed !== false;
    const limit = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
    const alpha = new Array(n).fill(0);
    if (!tiles.length) {
      const bahn = pts.map((p) => [p.x, p.y]);
      const prof = lapTimeOf(bahn, closed, o);
      return { alpha, limit, span: 0, lapTime: prof.time, startLapTime: prof.time,
               v: prof.v, gain: 0, apex: [], par: [], evals: 0, accepted: 0 };
    }
    const tCount = tiles.length;
    const tab = trackKachelTabelle(pts, tCount);
    const anker = luukeLinieAnker(tiles, closed);
    const at = (i) => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    const smooth = (u) => u * u * (3 - 2 * u);
    let grenzeStart = 0;
    for (let t = 0; t < tCount; t++) {
      const m = tab.zahl[t];
      const hatVorherige = closed || t > 0;
      const hatNaechste = closed || t + 1 < tCount;
      const aVor = hatVorherige ? anker[(t - 1 + tCount) % tCount] : anker[t];
      const aHier = anker[t];
      const aNach = hatNaechste ? anker[(t + 1) % tCount] : anker[t];
      // Grenzwerte: der MITTELWERT zu jeder Nachbarkachel, nicht deren voller Wert -
      // dieselbe Zahl, die die Nachbarkachel an ihrer Seite derselben Grenze ansteuert.
      //
      // HAARNADEL: BESTELLT (Korrektur der vorigen Runde): "Haarnadel muss insgesamt enger
      // werden (mittig rein und raus und dazwischen so weit innen wie moeglich)." Jede
      // Grenze, an der eine Haarnadel liegt, sitzt deshalb auf der MITTE (0) - fuer die
      // Haarnadel selbst UND fuer ihre Nachbarkachel, die an derselben Grenze denselben
      // Wert ansteuern muss (sonst springt alpha dort, siehe "voellig wirr" oben).
      const hp = (i) => tileTightness(tiles[((i % tCount) + tCount) % tCount].type) === 2;
      const istHaarnadel = hp(t);
      const grenzeVorn = (hatVorherige && (istHaarnadel || hp(t - 1))) ? 0 : (aVor + aHier) / 2;
      const grenzeHinten = (hatNaechste && (istHaarnadel || hp(t + 1))) ? 0 : (aHier + aNach) / 2;
      if (t === 0) grenzeStart = grenzeVorn;
      // In der Haarnadel: von der Mitte schnell auf volles Innen (bis HOLD_U), halten bis
      // EXIT_U, dann zurueck zur Mitte. Der kurze Aussen-Touch der vorigen Fassung ist weg.
      const HOLD_U = 0.2, EXIT_U = 0.8;
      for (let d = 0; d < m; d++) {
        const u = m > 0 ? (d + 0.5) / m : 0.5;
        let wert;
        if (istHaarnadel) {
          wert = u < HOLD_U
            ? grenzeVorn + (aHier - grenzeVorn) * smooth(u / HOLD_U)
            : u < EXIT_U
              ? aHier
              : aHier + (grenzeHinten - aHier) * smooth((u - EXIT_U) / (1 - EXIT_U));
        } else {
          wert = u < 0.5
            ? grenzeVorn + (aHier - grenzeVorn) * smooth(u / 0.5)
            : aHier + (grenzeHinten - aHier) * smooth((u - 0.5) / 0.5);
        }
        alpha[at(tab.start[t] + d)] = -(wert / 100) * limit;
      }
    }
    // DER VORPUNKT (tile: -1, trackCenterline() haengt ihn vor Kachel 0 an, siehe dort)
    // bekommt NIE einen Anker aus der obigen Schleife - trackKachelTabelle() ueberspringt
    // ihn ausdruecklich. alpha[0] blieb dadurch auf dem Fuellwert 0 stehen, waehrend
    // alpha[1] (der erste echte Punkt der Start-Kachel) jetzt einen echten Ankerwert
    // tragen kann, seit Start ihren Anker aus den Nachbarn mittelt statt fest 0 zu sein.
    // Gemessen an SR4G/SR2G2RG2/SR3GLR2GR2G2: genau dort sprang alpha um den VOLLEN
    // Lenkausschlag zwischen den ersten zwei Punkten - eine Nadel exakt auf der Start/
    // Ziel-Linie, spuerbar als Ruck genau dort. pts[0] liegt geometrisch unmittelbar vor
    // pts[1] (ein Abtastschritt Abstand), bekommt also densselben Grenzwert, den Kachel 0
    // an ihrem eigenen Anfang ansteuert (grenzeStart) - keinen Sprung mehr, weil beide
    // Punkte dann zur selben Grenze zeigen.
    if (n > 0) alpha[0] = -(grenzeStart / 100) * limit;
    const bahn = pts.map((p, i) => [p.x + nrm[i].x * alpha[i], p.y + nrm[i].y * alpha[i]]);
    const prof = lapTimeOf(bahn, closed, o);
    return { alpha, limit, span: Math.max.apply(null, alpha.map(Math.abs)),
             lapTime: prof.time, startLapTime: prof.time, v: prof.v, gain: 0,
             apex: [], par: [], evals: 0, accepted: 0 };
  }

  // Beide Modelle hinter einem Aufruf. Editor und Ghosts gehen hier durch, damit die
  // gezeichnete und die gefahrene Linie nicht auseinanderlaufen koennen.
  function buildLine(pts, nrm, opts) {
    const o0 = opts || {};
    const m = o0.model || lineModel;
    // DIE FAHRGRENZEN EINMAL JE LINIE, und dann fuer jede Zeitauswertung dieselben.
    // fahrGrenzen() integriert einen Start; in lapTimeOf zu stehen hiesse, das ein paar
    // hundert Mal je Linie zu tun. Ein vom Aufrufer gesetzter Wert gewinnt - so kann eine
    // Pruefung ein bekanntes Fahrzeug vorgeben, statt das eingestellte zu erwischen.
    const g = fahrGrenzen();
    const o = Object.assign({ aLat: g.aLat, aAcc: g.aAcc, aBrk: g.aBrk, vMax: g.vMax }, o0);
    // ---- EINE FORM, DREI ZIELFUNKTIONEN ---------------------------------------------
    //
    // Der Scheitelbereich ist bei den zwei freien Modellen 0,15 bis 0,85 und nicht 0 bis 1:
    // ein Scheitel AUF der Kachelgrenze ist keiner, und was daraus folgt, ist in v0.5.40
    // gemessen worden - dort faellt eine der beiden Rampen ganz aus.
    //
    // OHNE LAYOUT gibt es keine Kurven, und dann gibt es auch nichts je Kurve zu
    // parametrisieren. Dort bleiben die alten punktweisen Verfahren: sie brauchen kein
    // Layout, und ihre Zackigkeit ist ohne Kacheln auch nicht zu beheben.
    const mitLayout = !!(o.tiles && o.tiles.length);
    // 'dreistufig' BRAUCHT das Layout: seine ganze Vorschrift ist "aussen an der naechsten
    // Kurve", und ohne Kacheln gibt es keine naechste Kurve. Ohne Layout faellt es deshalb
    // auf das punktweise Rundenzeitmodell zurueck - wie die anderen zwei layoutgebundenen.
    // 'mitte' braucht kein Layout und wird deshalb VOR der mitLayout-Weiche entschieden -
    // die einzige Ausnahme, weil es die einzige Linie ist, der ein Layout schlicht
    // gleichgueltig ist.
    const line = m === 'mitte' ? mitteLine(pts, nrm, o)
      : !mitLayout
        ? (m === 'curvature' ? idealLine(pts, nrm, o) : lapTimeLine(pts, nrm, o))
      : m === 'curvature' ? formLine(pts, nrm, o, 'kurve', 0.15, 0.85)
      : m === 'lateapex' ? formLine(pts, nrm, o, 'zeit', LATE_APEX_MIN, LATE_APEX_MAX)
      : m === 'dreistufig' ? dreiStufenLine(pts, nrm, o)
      : m === 'innen3' ? innenGemitteltLine(pts, nrm, o)
      : m === 'aussenin' ? aussenInnenLine(pts, nrm, o)
      : m === 'luuke' ? luukeLinie(pts, nrm, o)
      : formLine(pts, nrm, o, 'zeit', 0.15, 0.85);
    line.model = m;
    line.grenzen = g;
    // ---- KEINE NACHLAEUFE MEHR IM LAYOUT-FALL ---------------------------------------
    //
    // Hier standen die Kurvenoeffnung und die geraden Geraden als Nachlauf hinter den zwei
    // punktweisen Modellen. Beide sind jetzt im Suchraum von formLine(): die Kurvenform IST
    // Eingang, Scheitel und Ausgang, die Geraden entstehen als Teil der Konstruktion, und der
    // Regler "Kurven oeffnen" ist eine Schranke darauf statt einer Verschiebung danach.
    //
    // WARUM DAS BESSER IST ALS EIN NACHLAUF: ein Nachlauf veraendert die Linie, NACHDEM die
    // Zielfunktion sie bewertet hat. Das Ergebnis ist dann weder das Optimum noch bewertet -
    // gemessen kostete die Kurvenoeffnung das Rundenzeitmodell rund 4 Sekunden, ohne dass
    // irgendwo stand, dass sie es tut. Eine Schranke im Suchraum ist dieselbe Zusage,
    // nachgerechnet.
    //
    // Ohne Layout bleiben die alten Verfahren, und dort ist die Zeit noch nachzurechnen:
    // lineGeradenVerbinden braucht Kacheln, also aendert es dort nichts, aber die Zeit aus
    // dem Optimierer beschreibt die ausgegebene Linie.
    if (!mitLayout) {
      const prof = lapTimeOf(
        pts.map((p, i) => [p.x + nrm[i].x * line.alpha[i], p.y + nrm[i].y * line.alpha[i]]),
        !!o.closed, o);
      line.lapTime = prof.time;
      line.v = prof.v;
    }
    // ---- DIE ENGSTELLE SCHREIBT IHRE EIGENE LINIE ---------------------------------
    //
    // BESTELLT: "Engstelle: [...] am Anfang ganz rechts fahren, dann ganz links."
    //
    // UEBER ALLEN MODELLEN, und das ist Absicht: das ist keine Geschmacksfrage der
    // Ideallinie, sondern die Form des Teils. Ein Modell, das hier etwas anderes moechte,
    // moechte durch die Absperrung. Deshalb steht der Griff hier, NACH der Modellwahl, und
    // gilt fuer alle vier - so wie die Kachelart auch nicht vom Modell abhaengt.
    //
    // ---- VORSICHT MIT DEM VORZEICHEN, ich bin gerade selbst darauf hereingefallen ----
    //
    // Im LENKBEFEHL (Byte 7) ist rechts positiv. In alpha NICHT: alpha misst entlang der
    // Normale, und trackNormals() dreht die Tangente um -90 Grad, zeigt also nach LINKS.
    // Deshalb zeichnet die Boxenausbuchtung mit SIDE = -1 auf die rechte Seite, und deshalb
    // steht in ghostLineOffset ein Minus vor alpha.
    //
    // "Ganz rechts" heisst hier also alpha = -gr, "ganz links" alpha = +gr. Wer die beiden
    // Vorzeichenwelten verwechselt, bekommt eine Engstelle, die genau falsch herum faehrt -
    // und sie sieht auf dem Bild plausibel aus, weil sie immer noch von einer Seite zur
    // anderen geht.
    //
    // Der Wechsel laeuft ueber die mittleren 40 Prozent der Kachel und nicht sprunghaft in
    // der Mitte: ein Sprung in der Linie ist ein Sprung im Lenkbefehl, und die Querfuehrung
    // (die Ratenbegrenzung in ghostTick) braucht Weg, um ihm zu folgen.
    //
    // ---- 40 PROZENT SIND KNAPP, UND ZWAR NACHGEMESSEN -----------------------------
    //
    // In der laufenden Simulation braucht ein Ghost 990 ms fuer die Engstelle. Zwei
    // Einheiten Querlage in 40 Prozent davon sind rund 5 Einheiten je Sekunde verlangt;
    // ghostCfg.querTempo erlaubt ab Werk 4,0. Gemessen kam die Fuehrung auf 3,82 - sie
    // laeuft also AM ANSCHLAG, und deshalb erreicht die Lage +0,93 / -0,90 statt genau
    // +1 / -1. Das sieht man nicht, und weich ist es dadurch auch.
    //
    // WAS DARAUS FOLGT, und es steht hier, weil es sonst niemand merkt: wer das Quertempo
    // herunterstellt, bekommt eine flachere Engstelle. Bei 2,0 - dem alten Vorgabewert -
    // waere es noch etwa die halbe Breite. Eine breitere Rampe waere dagegen die falsche
    // Antwort: sie wuerde die Zeit verkuerzen, in der das Auto wirklich ganz aussen steht,
    // und genau die war bestellt.
    if (o.tiles && o.tiles.length) {
      const gr = (o.limit !== undefined ? o.limit : TRACK_HALF_W - 3);
      for (let idx = 0; idx < o.tiles.length; idx++) {
        if (!o.tiles[idx] || o.tiles[idx].type !== TILE_TYPE.ENGE) continue;
        const treffer = [];
        for (let i = 0; i < pts.length; i++) if (pts[i].tile === idx) treffer.push(i);
        if (treffer.length < 2) continue;
        for (let k = 0; k < treffer.length; k++) {
          const u = k / (treffer.length - 1);        // 0 am Anfang, 1 am Ende
          // Rampe: bis 0,30 ganz rechts, ab 0,70 ganz links, dazwischen linear.
          const f = Math.max(0, Math.min(1, (u - 0.30) / 0.40));
          line.alpha[treffer[k]] = gr * (2 * f - 1);   // -gr = rechts  ->  +gr = links
        }
      }
    }
    line.span = Math.max(...line.alpha.map(Math.abs));
    line.exit = lineExitStaerke;
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
        // DIE BESCHRIFTUNG KIPPT NACH INNEN, wenn sie sonst aus dem Bild laeuft. Sie sitzt am
        // LETZTEN Punkt der Kurve, und der liegt am rechten Rand der Zeichenflaeche - rechts
        // daneben sind nur noch R = 16 Einheiten. Gemessen ragten "1000/min" und "km/h"
        // damit ueber den viewBox-Rand und wurden abgeschnitten; auf einem 320-px-Schirm
        // waren das 11 sichtbare Pixel.
        //
        // Die Textbreite wird GESCHAETZT, mit 0,54 em je Zeichen. Das ist keine Messung -
        // im SVG-Text gibt es zur Bauzeit keine -, aber eine Ueberschaetzung fuer diese
        // Schrift, und Ueberschaetzen ist hier die richtige Richtung: im Zweifel kippt die
        // Beschriftung nach innen, und dort steht sie immer richtig.
        const last = s.points[s.points.length - 1];
        const bx = sx(last[0]);
        const breit = String(s.label).length * 0.54 * 10;
        const innen = bx + 4 + breit > W - 2;
        paths += `<text x="${(innen ? bx - 4 : bx + 4).toFixed(1)}" y="${(sy(last[1]) + 3).toFixed(1)}"`
               + ` text-anchor="${innen ? 'end' : 'start'}"`
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
  // BESTELLT (erste Runde): "im Strecken-Editor sind die blaue und rote Randbegrenzung
  // vertauscht angegeben" - damals geprueft: Code und Selbsttest stimmten miteinander
  // ueberein (rot links, blau rechts), nur zwei Kommentare behaupteten das Gegenteil, also
  // wurden nur die Kommentare berichtigt.
  // BESTELLT (zweite Runde, nach Gegenpruefung am echten Auto): "Linker Rand soll blau und
  // rechter Rand rot in Fahrtrichtung sein, das ist noch verkehrt herum." Diesmal war die
  // Uebereinstimmung selbst falsch herum - jetzt sind Farbzuordnung UND Kommentare
  // gedreht (kerbLeft/kerbRight weiter unten).
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
    // ---- ENTARTETE ABSTAENDE ZAEHLEN NICHT ------------------------------------------
    //
    // Auf einer GESCHLOSSENEN Runde ist der letzte Abtastpunkt derselbe wie der erste -
    // gemessen ein Abstand von 0,0000 bei einem mittleren Abstand von 2,857 Einheiten. Der
    // Kreis durch drei Punkte, von denen zwei zusammenfallen, hat den Radius null, und die
    // Formel unten liefert dort einen riesigen Wert.
    //
    // GEMESSEN, bevor diese Schranke stand: auf SHG4HG3 kam an dieser einen Stelle eine
    // Kruemmung von 0,6999 heraus, waehrend die beiden Haarnadeln bei 0,12 und 0,13 liegen.
    // Das FUENFFACHE einer Haarnadel, an einer Geraden, allein aus einem doppelten Punkt.
    //
    // Zwei Verbraucher haben das geglaubt: brakeProfile() zeichnete an Start/Ziel eine
    // Bremsung, die es nicht gibt, und die Scheitelsuche des Kurvenausgangs fand nur diesen
    // einen "Scheitel" - ihre Schwelle war ein Anteil von kMax, und kMax war das Artefakt.
    //
    // Die alte Schranke (a*b*c < 1e-6) greift nicht: bei a = 0 und b = c = 2,857 ist das
    // Produkt null, aber bei a = 0,001 ist es 8e-3 und damit darueber. Gebraucht wird eine
    // RELATIVE Schranke, und der Bezug ist der mittlere Abstand dieses Pfades.
    let summe = 0;
    for (let i = 0; i + 1 < n; i++) {
      summe += Math.hypot(pathPts[i + 1][0] - pathPts[i][0],
                          pathPts[i + 1][1] - pathPts[i][1]);
    }
    const mittel = n > 1 ? summe / (n - 1) : 0;
    const klein = Math.max(1e-9, mittel * 0.05);
    for (let i = 0; i < n; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1);
      const a = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const b = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const c = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
      if (a < klein || b < klein) continue;      // bleibt 0: hier ist nichts zu messen
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

  // ====================================================================================
  // DIE KAROSSERIE, MASSSTABSGETREU
  // ====================================================================================
  //
  // Gemessen am Fahrzeug: 95 mm lang mit Spoiler, 38 mm breit. Alles andere folgt aus den
  // Bahnmassen, die schon hier stehen - TRACK_UNITS_PER_CM = 40/43 rechnet Zentimeter in
  // Zeichnungseinheiten:
  //
  //     Auto            9,5 cm  ->  8,84 Einheiten lang
  //                     3,8 cm  ->  3,54 Einheiten breit
  //     Bahn           25,0 cm  ->  23,26 Einheiten
  //     Kachel         43,0 cm  ->  40,00 Einheiten
  //
  // Zwei Zahlen daraus sind der eigentliche Gewinn, und beide waren vorher nicht sichtbar:
  //
  //   ZWEI AUTOS NEBENEINANDER brauchen 30,4 Prozent der Bahnbreite. Es ist also reichlich
  //   Platz - wer sich rammt, tut es nicht aus Enge.
  //
  //   EIN AUTO IST 22 PROZENT EINER KACHEL lang. Der Abstandshalter rechnete in Kacheln
  //   (SPICE_GAP_MIN = 0,7), das sind also gut drei Fahrzeuglaengen. Jetzt ist die
  //   Fahrzeuglaenge eine Zahl und kein Gefuehl.
  //
  // DER BISHERIGE PUNKT WAR IRREFUEHREND: Radius 3,2 sind 6,9 cm Durchmesser - breiter als
  // das Auto ist (3,8) und kuerzer als es lang ist (9,5). Er behauptete also ein rundes
  // Fahrzeug, das quer zu dick und laengs zu kurz war, und verschwieg die Fahrtrichtung.
  const AUTO_LANG_CM = 9.5;
  const AUTO_BREIT_CM = 3.8;
  const AUTO_LANG = AUTO_LANG_CM * TRACK_UNITS_PER_CM;
  const AUTO_BREIT = AUTO_BREIT_CM * TRACK_UNITS_PER_CM;
  // Der Spoiler ist in den 95 mm ENTHALTEN und keine Zugabe. Er wird als Balken am Heck
  // gezeichnet, damit man die Fahrtrichtung sieht - bei 8,8 Einheiten Laenge auf einer
  // Karte von 200 Einheiten Breite ist das der einzige Weg, sie zu erkennen.
  const AUTO_SPOILER = 1.4;

  // Die Fahrtrichtung an einem Abtastpunkt, in Grad. AUS DEN PUNKTEN und nicht aus der
  // Normalen: die Normale hat eine Vorzeichenkonvention, die in diesem Projekt schon zwei
  // Fehler gekostet hat. Zwei aufeinanderfolgende Punkte haben keine.
  function trackWinkelBei(pts, i) {
    const n = pts.length;
    const a = pts[Math.max(0, Math.min(n - 2, i))];
    const b = pts[Math.max(1, Math.min(n - 1, i + 1))];
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  // KLEINER ALS BIS v0.5.17: 6 px Radius deckten auf einer 30 px breiten Bahn die halbe
  // Fahrbahn, und darin ist keine Querlage zu zeigen. 3,2 lassen Platz fuer beides.
  // Als Modulkonstante, weil karteAutosSetzen() denselben Wert braucht.
  const PUNKT_R = 3.2;

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
    // Welche Punkte zu welcher Kachel gehoeren - einmal je Zeichnung, danach nur gelesen.
    const kachelTab = trackKachelTabelle(pts, tiles.length);
    const first = pts[0], last = pts[pts.length - 1];
    // Lage UND Winkel, mit Toleranz - die Begruendung und die Zahlen stehen bei
    // trackSchluss(). Hier stand eine Toleranz von 2 cm auf die Lage allein; die liess nur
    // Rundungsfehler durch, nicht aber den Modellfehler einer langen Strecke, und dann
    // rechnete die Ideallinie auf einer offenen Bahn.
    const schluss = trackSchluss(pts);
    const closed = schluss.closed;

    const half = TRACK_HALF_W;
    const pad = o.detailed ? half + 14 : 30;
    const all = [...pts.map(p => [p.x, p.y])];
    if (o.detailed) {
      all.push(...offsetPath(pts, nrm, half + 6), ...offsetPath(pts, nrm, -(half + 6)));
    }
    // Raum-Rechteck (o.raum, in Metern): die Zufallsstrecke muss in dieses Rechteck passen.
    // Es wird mittig auf den Umriss der Strecke gelegt und erweitert die Ansicht, damit es
    // nicht am Kartenrand abgeschnitten wird. Nur der Editor (o.raum) zeichnet es.
    let raumRect = null;
    // v0.9.11: auch mit nur EINER begrenzten Richtung (die andere spannt die Strecke auf), und
    // verschiebbar: o.raumVersatz (cm) legt den Raum gegen die Strecke - BESTELLT "Raumgrenzen
    // anzeigen, mich die Strecke mit Fingertouch verschieben lassen und rechter Stick (rechter
    // Stick druecken = zentrieren)".
    if (o.raum && (o.raum.x > 0 || o.raum.y > 0)) {
      const cxs = pts.map(p => p.x), cys = pts.map(p => p.y);
      const cx = (Math.min(...cxs) + Math.max(...cxs)) / 2;
      const cy = (Math.min(...cys) + Math.max(...cys)) / 2;
      const rand = TRACK_HALF_W + 20;
      const rw = o.raum.x > 0 ? o.raum.x * 100 * TRACK_UNITS_PER_CM / 2 : (Math.max(...cxs) - Math.min(...cxs)) / 2 + rand;
      const rh = o.raum.y > 0 ? o.raum.y * 100 * TRACK_UNITS_PER_CM / 2 : (Math.max(...cys) - Math.min(...cys)) / 2 + rand;
      const v = o.raumVersatz || { x: 0, y: 0 };
      raumRect = { x: cx - rw + (v.x || 0) * TRACK_UNITS_PER_CM, y: cy - rh + (v.y || 0) * TRACK_UNITS_PER_CM,
                   w: rw * 2, h: rh * 2, mx: o.raum.x, my: o.raum.y };
      all.push([raumRect.x, raumRect.y], [raumRect.x + raumRect.w, raumRect.y + raumRect.h]);
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

      // 2b) Die Engstelle: zwei Sperren, die von beiden Seiten hereinragen.
      //
      // BESTELLT: "grafisch hervorheben wie die Original-Engstelle."
      //
      // DIESELBE BAUFORM wie die Boxenausbuchtung darueber - je Kachel ueber p.tile und die
      // Normalen -, nur nach INNEN statt nach aussen. Eine schmalere Fahrbahn zu zeichnen
      // ginge nicht: die Strasse ist EIN breiter Strich entlang der Mittellinie, und eine
      // Breite je Kachel hat ein Strich nicht.
      //
      // WIE SCHMAL SIE WIRKLICH IST, WEISS ICH NICHT. Die Breite ist nicht gemessen - aus
      // den Bildern des Original-Editors laesst sie sich nicht ablesen. Was hier steht, ist
      // also eine DARSTELLUNG und keine Massangabe: sie sagt "hier wird es eng", und die
      // Zahl daneben ist ein Drittel je Seite, weil das sichtbar ist, ohne die Bahn
      // zuzumauern. Sobald ein Mass vorliegt, gehoert es hierher.
      tiles.forEach((tk, idx) => {
        if (tk.type !== TILE_TYPE.ENGE) return;
        const seg = pts.map((p, i) => ({ p, i })).filter(q => q.p.tile === idx);
        if (seg.length < 3) return;
        for (const SIDE of [1, -1]) {
          const aussen = seg.map(q => [q.p.x + nrm[q.i].x * half * SIDE,
                                       q.p.y + nrm[q.i].y * half * SIDE]);
          const innen = seg.map((q, k) => {
            // Null an beiden Enden, am tiefsten in der Mitte - wie die Boxenausbuchtung,
            // nur mit umgekehrtem Vorzeichen. Eine Sperre mit Kante waere ein Teil, das
            // man nicht anfahren kann.
            const u = k / (seg.length - 1);
            const tief = Math.sin(u * Math.PI) * half * ENGE_ANTEIL;
            return [q.p.x + nrm[q.i].x * (half - tief) * SIDE,
                    q.p.y + nrm[q.i].y * (half - tief) * SIDE];
          });
          body += `<path d="${poly(aussen)} L ${innen.slice().reverse().map(P2).join(' L ')} Z" `
               + `fill="#3a2a12" stroke="#ffb02e" stroke-width="0.8" stroke-linejoin="round"/>`;
        }
        const m = seg[Math.floor(seg.length / 2)];
        body += `<text x="${(m.p.x + ox).toFixed(1)}" y="${(m.p.y + oy + 3).toFixed(1)}" `
             + `fill="#ffb02e" font-size="8" font-weight="700" text-anchor="middle">ENG</text>`;
      });

      // 3) Joints: a white tick across the roadway at every element boundary, so the
      //    individual pieces are visible instead of one continuous ribbon.
      // JE KACHEL IHR ERSTER PUNKT, aus der Tabelle - nicht k * 14. Begruendung bei
      // trackKachelTabelle(): eine Haarnadel hat 49 Abtastpunkte, eine Gerade 14, und mit
      // der Multiplikation lagen die Fugen falsch und fehlten im letzten Drittel ganz.
      for (let k = 0; k < tiles.length; k++) {
        const i = kachelTab.start[k];
        const A = [pts[i].x + nrm[i].x * half, pts[i].y + nrm[i].y * half];
        const B = [pts[i].x - nrm[i].x * half, pts[i].y - nrm[i].y * half];
        body += `<path d="M ${P2(A)} L ${P2(B)}" stroke="#ffffff" stroke-width="1.6" opacity=".85"/>`;
      }

      // 4) Kerbs. Left = blue/white, right = red/white, both relative to travel direction.
      // BESTELLT (nach Gegenpruefung am echten Auto): "Linker Rand soll blau und rechter
      // Rand rot in Fahrtrichtung sein, das ist noch verkehrt herum." Vorher stand hier
      // rot links / blau rechts - das stimmte zwischen Code und Selbsttest ueberein
      // (siehe Phase 9), war aber gegen die reale Bahn beides falsch herum. Nur die
      // Farbzuordnung dreht sich, die Geometrie (SIGN CHECK unten) bleibt unveraendert.
      // SIGN CHECK: trackNormals() rotates the tangent by -90 degrees, so a POSITIVE
      // offset is the driver's LEFT. Heading north the tangent is (0,-1) and the normal
      // comes out (-1,0), which on screen (y downwards) points left.
      const kerbLeft = offsetPath(pts, nrm, half + TRACK_KERB_W / 2);
      const kerbRight = offsetPath(pts, nrm, -(half + TRACK_KERB_W / 2));
      const kw = TRACK_KERB_W;
      // Brighter than the real kerb paint, on purpose: these are drawn on a dark track view
      // now, and the actual #b3131f / #1565c0 came out at under 3:1 against it.
      if (!o.echt) {
        [[kerbLeft, '#5aa9ff'], [kerbRight, '#ff5c5c']].forEach(([path, col]) => {
          body += `<path d="${poly(path)}" fill="none" stroke="#ffffff" stroke-width="${kw}" stroke-linecap="butt"/>`;
          body += `<path d="${poly(path)}" fill="none" stroke="${col}" stroke-width="${kw}" stroke-linecap="butt" stroke-dasharray="7 7"/>`;
        });
      } else {
        // WIE DIE ECHTEN TEILE (Editor). BESTELLT: "Die Teile sollen wie die echten aussehen
        // (also an den Raendern muessen so leichte Pfeile in die Fahrtrichtung sein)". Ein
        // weisser Randstreifen, darauf Pfeilspitzen in Fahrtrichtung: links blau, rechts rot
        // - dieselben Farben wie die Randsteine. Als einzelne Pfade und NICHT als
        // <g transform>: der Selbsttest zaehlt jede verschobene Gruppe als Auto.
        const kw2 = kw * 2.2;
        const kL = offsetPath(pts, nrm, half + kw2 / 2), kR = offsetPath(pts, nrm, -(half + kw2 / 2));
        [[kL, 1, '#5aa9ff'], [kR, -1, '#ff5c5c']].forEach(([path, seite, col]) => {
          body += `<path d="${poly(path)}" fill="none" stroke="#f3f5f8" stroke-width="${kw2}" stroke-linecap="butt"/>`;
          let d = '';
          for (let q = 1; q < pts.length - 1; q += 2) {
            const p = pts[q], n = nrm[q];
            const rad = p.heading * Math.PI / 180;
            const vx = Math.sin(rad), vy = -Math.cos(rad);
            const cx = p.x + n.x * seite * (half + kw2 / 2), cy = p.y + n.y * seite * (half + kw2 / 2);
            const s = kw2 * 0.5;
            const tip = [cx + vx * s, cy + vy * s];
            const a = [cx - vx * s * 0.5 + n.x * s * 0.8, cy - vy * s * 0.5 + n.y * s * 0.8];
            const b = [cx - vx * s * 0.5 - n.x * s * 0.8, cy - vy * s * 0.5 - n.y * s * 0.8];
            d += ` M ${P2(a)} L ${P2(tip)} L ${P2(b)}`;
          }
          body += `<path d="${d.trim()}" fill="none" stroke="${col}" stroke-width="${(kw2 * 0.28).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        });
      }
      // DAS GEWAEHLTE TEIL (Editor): gelb ueberzogen, damit man sieht, wo eingefuegt und was
      // entfernt wird.
      if (o.auswahl !== null && o.auswahl !== undefined && o.auswahl >= 0 && o.auswahl < tiles.length) {
        const seg = [];
        for (let q = kachelTab.start[o.auswahl]; q < pts.length && (pts[q].tile === o.auswahl || q === kachelTab.start[o.auswahl]); q++) {
          seg.push([pts[q].x, pts[q].y]);
        }
        const naechster = kachelTab.start[o.auswahl + 1];
        if (naechster !== undefined && pts[naechster]) seg.push([pts[naechster].x, pts[naechster].y]);
        if (seg.length >= 2) {
          body += `<path d="${poly(seg)}" fill="none" stroke="#ffd400" stroke-opacity=".5" stroke-width="${(half * 2).toFixed(1)}" stroke-linecap="butt"/>`;
        }
      }

      // 5) The ideal line, from the same geometry, coloured by whether a car would be
      //    braking there. Green = on the power, red = braking, and the transition is drawn
      //    as a gradient rather than a hard switch because braking builds up over metres,
      //    not at a point.
      //
      //    First version deliberately simple, as specified: brake where the curvature AHEAD
      //    is about to rise. Curvature is read from the ideal line itself, not the
      //    centreline — the whole point of the line is that it changes the radius, so using
      //    the centreline would colour a corner the car no longer takes that tightly.
      // tiles MIT: der Kurvenausgang braucht die Kacheltypen, um Scheitel und Ausgang
      // zu finden - siehe formLine().
      const line = buildLine(pts, nrm, { closed, tiles });
      const ideal = pts.map((p, i) => [p.x + nrm[i].x * line.alpha[i],
                                       p.y + nrm[i].y * line.alpha[i]]);
      const brake = brakeProfile(ideal, closed);
      // One short segment per sample pair, each with its own colour. A single path with a
      // gradient cannot follow an arbitrary curve, so the curve is cut instead.
      const IDEAL_W = 1.1;   // was 2.2; halved on request, the line was heavier than the kerbs
      // v0.9.22, BESTELLT: "Standardmaessig die Ideallinie nirgendwo einblenden ausser im
      // Ghost-Menue und im Editor, wenn ich es angeklickt habe." Gezeichnet wird sie nur noch
      // mit mitLinie: true (oder ohneLinie: false, wie der Editor es setzt).
      const ohneIdeal = o.ohneLinie !== undefined ? o.ohneLinie : !o.mitLinie;
      for (let i = 0; i + 1 < (ohneIdeal ? 0 : ideal.length); i++) {
        const v = (brake[i] + brake[i + 1]) / 2;
        body += `<path d="M ${P2(ideal[i])} L ${P2(ideal[i + 1])}" fill="none" `
              + `stroke="${brakeColour(v)}" stroke-width="${IDEAL_W}" stroke-linecap="round"/>`;
      }
      o.lineInfo = line;
    } else {
      body += `<path d="${poly(centre)}" fill="none" stroke="#7d8698" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }

    // Start line and the live position marker. Die ERSTE Start/Ziel-Gerade ist die
    // Rundenlinie (gruen); jede weitere ist eine Sektorgrenze und wird gelb gezeichnet,
    // damit man sie von der ersten unterscheidet (BESTELLT: "die zweite Start/Ziel-Gerade
    // soll sich deutlich von der ersten unterscheiden").
    let ersteStart = true;
    for (let ti = 0; ti < tiles.length; ti++) {
      if (tiles[ti].type !== TILE_TYPE.START) continue;
      const pi = kachelTab && kachelTab.start ? kachelTab.start[ti] : 0;
      const p = pts[pi] || pts[0];
      if (!p) continue;
      const sA = [p.x + nrm[pi].x * half, p.y + nrm[pi].y * half];
      const sB = [p.x - nrm[pi].x * half, p.y - nrm[pi].y * half];
      const farbe = ersteStart ? '#3ddc84' : '#ffd400';
      body += o.detailed
        ? `<path d="M ${P2(sA)} L ${P2(sB)}" stroke="${farbe}" stroke-width="4"/>`
        : `<circle cx="${(p.x + ox).toFixed(1)}" cy="${(p.y + oy).toFixed(1)}" r="5" fill="${farbe}"/>`;
      ersteStart = false;
    }
    // ---- Die Autos ----------------------------------------------------------------
    //
    // `currentIndex` zeichnet EIN Auto und bleibt fuer alte Aufrufer; `o.cars` zeichnet
    // beliebig viele, mit Farbe und Kuerzel. Ein Eintrag ist
    // { index, phase, farbe, kuerzel } - phase ist die Lage INNERHALB der Kachel, 0 bis 1.
    //
    // DER VERSATZ: die alte Zeile rechnete (index + 1) * Abtastpunkte, also das ENDE der
    // Kachel, auf der das Auto steht - eine ganze Kachel zu weit. Richtig ist der Anfang
    // plus die Phase. Genauer geht es nicht: das Auto ortet sich nicht, es zaehlt Kacheln.
    // (PUNKT_R steht als Modulkonstante weiter oben - karteAutosSetzen() braucht denselben
    //  Wert, und zwei Zahlen fuer eine Punktgroesse waeren zwei Punktgroessen.)
    const autoPunkt = (index, phase, farbe, kuerzel, quer) => {
      if (index === null || index === undefined) return '';
      const i = trackPunktIndex(kachelTab, pts, index, phase);
      const p = pts[i];
      // DIE QUERLAGE als Versatz laengs der Normalen. Auf 85 Prozent der halben Breite
      // begrenzt: ein Punkt auf dem Randstein saehe aus, als laege das Auto daneben, und
      // genau das soll die Karte NICHT behaupten.
      const q = Math.max(-0.85, Math.min(0.85, quer || 0));
      const n = nrm[i] || { x: 0, y: 0 };
      const px = p.x + n.x * q * half, py = p.y + n.y * q * half;
      const x = (px + ox).toFixed(1), y = (py + oy).toFixed(1);
      // ---- DIE KAROSSERIE, gedreht in Fahrtrichtung -------------------------------
      //
      // Ein Rechteck von 8,84 x 3,54 Einheiten, also 95 x 38 mm im Massstab der Bahn, plus
      // ein Balken am Heck fuer den Spoiler. Der weisse Rand bleibt: er traegt das Auto auf
      // der schwarzen Bahn UND auf dem hellen Grund daneben.
      const w = trackWinkelBei(pts, i).toFixed(1);
      const L = AUTO_LANG, B = AUTO_BREIT;
      let t = `<g transform="translate(${x} ${y}) rotate(${w})">`
            + `<rect x="${(-L / 2).toFixed(2)}" y="${(-B / 2).toFixed(2)}" `
            + `width="${L.toFixed(2)}" height="${B.toFixed(2)}" rx="0.8" `
            + `fill="${farbe || '#ff5c5c'}" stroke="#fff" stroke-width="0.5"/>`
            + `<rect x="${(-L / 2).toFixed(2)}" y="${(-B / 2).toFixed(2)}" `
            + `width="${AUTO_SPOILER.toFixed(2)}" height="${B.toFixed(2)}" `
            + `fill="#0b0c0f" opacity="0.55"/>`
            + `</g>`;
      if (kuerzel) {
        t += `<text x="${x}" y="${(py + oy - 6).toFixed(1)}" text-anchor="middle" `
           + `font-size="9" font-weight="700" fill="#fff" `
           + `stroke="#0b0c0f" stroke-width="2.5" paint-order="stroke"`
           + `>${kuerzel}</text>`;
      }
      return t;
    };
    if (currentIndex != null) body += autoPunkt(currentIndex, 0, '#ff5c5c', null, 0);
    if (o.cars) {
      for (const c of o.cars) body += autoPunkt(c.index, c.phase, c.farbe, c.kuerzel, c.quer);
    }

    // KEIN style-ATTRIBUT MEHR, nur eine Klasse. Groesse, Grund und Rahmen entscheidet
    // der ORT, an dem das Bild haengt - und dieser Zeichner kennt den Ort nicht. Er hat
    // dreien gleichzeitig gedient (Editor, Minikarte, Uebersichtsschirm) und allen dieselbe
    // Breitendeckelung von 520 px aufgeschrieben.
    //
    // Ein Inline-Stil schlaegt jede Regel eines Stylesheets, also blieb den Orten nur
    // !important: der Uebersichtsschirm arbeitete gegen Grund und Rahmen an, das
    // Editor-Vollbild gegen die Deckelung. Beide Behelfe fallen mit dieser Zeile weg.
    //
    // Die zweite Haelfte des Ternaers, das hier stand - `width:220px` fuer den einfachen
    // Fall -, hatte ohnehin keinen Aufrufer mehr: alle fuenf Aufrufe uebergeben
    // detailed: true. Sie sah aus wie eine Zusicherung und war keine. `o.detailed` bleibt
    // fuer die GEOMETRIE zustaendig - Fahrbahn statt Linie -, dort ist der Unterschied echt.
    // ---- 50-cm-Raster im Editor-Hintergrund ------------------------------------------
    // BESTELLT: "generiere einen Hintergrund mit horizontalen und vertikalen Linien alle
    // 50 cm." Der Editor zeichnet die Strecke in echten Bahneinheiten (TRACK_UNITS_PER_CM),
    // also sind 50 cm = 50 * TRACK_UNITS_PER_CM Zeichnungseinheiten. Ein <pattern> in
    // userSpaceOnUse richtet das Raster am Koordinatenursprung der Bahn aus (Start/Ziel),
    // und patternTransform verschiebt es um ox/oy, damit die Linien auf den Kachelmassen
    // liegen statt auf dem Kartenrand. Nur der Editor (o.grid) bekommt es - die Minikarte
    // und der Uebersichtsschirm nicht.
    let gridSvg = '';
    if (o.grid) {
      const grid = (50 * TRACK_UNITS_PER_CM).toFixed(2);
      gridSvg = `<defs><pattern id="tp-grid" width="${grid}" height="${grid}" `
              + `patternUnits="userSpaceOnUse" patternTransform="translate(${ox.toFixed(2)} ${oy.toFixed(2)})">`
              + `<path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="rgba(140,155,180,.30)" stroke-width="0.7"/>`
              + `</pattern></defs>`
              + `<rect x="0" y="0" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="url(#tp-grid)"/>`;
    }
    if (raumRect) {
      const fs = Math.max(8, Math.min(w, h) * 0.035);
      const mass = (raumRect.mx > 0 ? String(raumRect.mx).replace('.', ',') : '–') + ' × '
                 + (raumRect.my > 0 ? String(raumRect.my).replace('.', ',') : '–') + ' m';
      body += `<g class="tp-raum"><rect x="${(raumRect.x + ox).toFixed(1)}" y="${(raumRect.y + oy).toFixed(1)}" `
        + `width="${raumRect.w.toFixed(1)}" height="${raumRect.h.toFixed(1)}" fill="none" `
        + `stroke="rgba(110,160,255,.7)" stroke-width="2" stroke-dasharray="7 5"/>`
        + `<text x="${(raumRect.x + ox + fs * 0.4).toFixed(1)}" y="${(raumRect.y + oy + fs * 1.2).toFixed(1)}" `
        + `font-size="${fs.toFixed(1)}" fill="rgba(140,180,255,.85)">${mass}</text></g>`;
    }
    const html = `<svg class="tp-karte" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">${gridSvg}${body}</svg>`;
    // DIE GEOMETRIE MIT HERAUS, damit ein Aufrufer Punkte setzen kann, ohne die Strecke neu
    // zu rechnen. Gemessen kostet ein Aufruf dieser Funktion rund 94 ms - sie rechnet
    // Mittellinie, Normalen UND die Ideallinie, und die ist eine Optimierung. Das gehoert
    // nicht in einen Anzeigetakt.
    //
    // Es ist DIESELBE Geometrie, mit der oben gezeichnet wurde, kein zweiter Rechenweg.
    return { html, closed, schluss, lineInfo: o.lineInfo,
             // kachelTab statt proSchritt: die Zuordnung Kachel -> Abtastpunkt ist keine
             // Multiplikation, siehe trackKachelTabelle(). proSchritt ist damit weg - eine
             // Zahl, die eine falsche Annahme trug, laesst man nicht "fuer alte Aufrufer"
             // stehen.
             geo: { ox, oy, kachelTab, half, pts, nrm, punktR: PUNKT_R } };
  }


  // ---- Autopunkte in ein fertiges Streckenbild setzen ---------------------------------
  //
  // Sie ZEICHNET die Strecke nicht, sie legt nur Punkte darauf. Gebraucht wird sie vom
  // Uebersichtsschirm, der zehnmal je Sekunde nachzieht - und dort waere ein neuer
  // Streckenaufbau (gemessen 94 ms) der Faden, an dem der Sendetakt haengt.
  //
  // Die Knoten werden WIEDERVERWENDET und nicht neu erzeugt: eine Gruppe je Aufruf zu
  // ersetzen erzeugt zehn Verwerfungen je Sekunde im Layout, und der Browser zeichnet dann
  // den ganzen Baum neu statt zweier Attribute.
  const NS_SVG = 'http://www.w3.org/2000/svg';
  // ---- Von der LENKANFORDERUNG zur QUERLAGE auf der Karte ----------------------------
  //
  // ZWEI GEGENLAEUFIGE KONVENTIONEN, und beide sind fuer sich richtig - nur nicht dieselbe:
  //
  //   g.querSoll   ist eine LENKANFORDERUNG. Positiv heisst RECHTS, so wie Byte 7 und so wie
  //                der Stick, dessen Anzeige `left = 75 + nx * R` nach rechts wandert, wenn
  //                der Wert steigt.
  //   diese Karte  zeichnet entlang der NORMALEN, und trackNormals() zeigt nach LINKS. Das
  //                steht seit der Randstein-Berichtigung auch bei den Kerbs.
  //
  // Wer die eine Zahl als die andere benutzt, spiegelt jedes Auto an der Mittellinie. Genau
  // das ist passiert. Gemeldet wurde es so: "Die simulierten Ghosts fahren keine Ideallinie
  // sondern immer aussen in der Kurve. Da ist eine Ideallinie in der Strecke eingezeichnet,
  // die sollen sie fahren."
  //
  // NACHGEMESSEN, im Modell und ohne jede Hardware-Frage: in einer Rechtskurve liegt die
  // gezeichnete Ideallinie bei alpha = -8,35 Zeichnungseinheiten (negative Normale = rechts
  // = innen), der Autopunkt bei querSoll = +0,97 (positive Normale = links = aussen). Zwei
  // gegenueberliegende Seiten derselben Mittellinie.
  //
  // Dass die LINIE die richtige ist, ist ebenfalls gemessen und nicht gesetzt: der Weg
  // entlang alpha ist 607 Zeichnungseinheiten lang, die Mittellinie 648 - alpha ist also die
  // innere Linie. Und ghostLineOffset() dreht ihr Vorzeichen bewusst, um daraus einen
  // Lenkbefehl zum Scheitel zu machen. Beides bleibt, wie es ist; falsch war nur, den
  // Lenkbefehl ungedreht als Ort zu zeichnen.
  //
  // EINE STELLE FUER DIE UMRECHNUNG. Zwei Zeichner benutzen sie (die Karte hier und die
  // Rennsimulation), und eine zweite Kopie waere die naechste Gelegenheit, das Vorzeichen
  // nur an einem der beiden Orte zu berichtigen.
  function querSollAlsLage(v) { return -(v || 0); }

  function karteAutosSetzen(svg, geo, cars) {
    if (!svg || !geo) return 0;
    let g = svg.querySelector('g.karte-autos');
    if (!g) {
      g = document.createElementNS(NS_SVG, 'g');
      g.setAttribute('class', 'karte-autos');
      svg.appendChild(g);
    }
    const liste = cars || [];
    // Fehlende Knoten anlegen, ueberzaehlige verbergen. Nicht loeschen: die Zahl der Autos
    // wechselt selten, und ein verborgener Knoten kostet nichts.
    while (g.childNodes.length < liste.length * 2) {
      // EINE GRUPPE JE AUTO, gedreht, mit Karosserie und Spoiler darin - und die
      // Beschriftung DANEBEN und nicht darin: sie darf sich nicht mitdrehen, sonst steht
      // das Kuerzel in einer Linkskurve auf dem Kopf.
      const c = document.createElementNS(NS_SVG, 'g');
      const body = document.createElementNS(NS_SVG, 'rect');
      body.setAttribute('x', (-AUTO_LANG / 2).toFixed(2));
      body.setAttribute('y', (-AUTO_BREIT / 2).toFixed(2));
      body.setAttribute('width', AUTO_LANG.toFixed(2));
      body.setAttribute('height', AUTO_BREIT.toFixed(2));
      body.setAttribute('rx', '0.8');
      body.setAttribute('stroke', '#fff');
      body.setAttribute('stroke-width', '0.5');
      const spoiler = document.createElementNS(NS_SVG, 'rect');
      spoiler.setAttribute('x', (-AUTO_LANG / 2).toFixed(2));
      spoiler.setAttribute('y', (-AUTO_BREIT / 2).toFixed(2));
      spoiler.setAttribute('width', AUTO_SPOILER.toFixed(2));
      spoiler.setAttribute('height', AUTO_BREIT.toFixed(2));
      spoiler.setAttribute('fill', '#0b0c0f');
      spoiler.setAttribute('opacity', '0.55');
      c.appendChild(body);
      c.appendChild(spoiler);
      const t = document.createElementNS(NS_SVG, 'text');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '9');
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', '#fff');
      t.setAttribute('stroke', '#0b0c0f');
      t.setAttribute('stroke-width', '2.5');
      t.setAttribute('paint-order', 'stroke');
      g.appendChild(c);
      g.appendChild(t);
    }
    for (let k = 0; k < g.childNodes.length / 2; k++) {
      const c = g.childNodes[k * 2], t = g.childNodes[k * 2 + 1];
      const a = liste[k];
      if (!a || a.index === null || a.index === undefined) {
        // VERBERGEN und nicht auf Groesse null setzen: eine Gruppe hat kein r, und ein
        // rect mit width 0 waere ein Strich. hidden ist die Aussage, die gemeint ist.
        c.setAttribute('visibility', 'hidden');
        t.textContent = '';
        continue;
      }
      c.setAttribute('visibility', 'visible');
      const i = trackPunktIndex(geo.kachelTab, geo.pts, a.index, a.phase);
      const p = geo.pts[i], n = geo.nrm[i] || { x: 0, y: 0 };
      const q = Math.max(-0.85, Math.min(0.85, a.quer || 0));
      const x = p.x + n.x * q * geo.half + geo.ox;
      const y = p.y + n.y * q * geo.half + geo.oy;
      const w = trackWinkelBei(geo.pts, i);
      c.setAttribute('transform',
        'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + w.toFixed(1) + ')');
      if (c.firstChild) c.firstChild.setAttribute('fill', a.farbe || '#ff5c5c');
      t.setAttribute('x', x.toFixed(1));
      t.setAttribute('y', (y - 6).toFixed(1));
      t.textContent = a.kuerzel || '';
    }
    return liste.length;
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
                              [TILE_TYPE.HAIRPIN_LEFT]: 'J',
                              // W/Q = Weite Kurve rechts/links, K/M = Kleine rechts/links,
                              // E = Engstelle. Ausdruecklich KEIN I: es ist von einer 1 im
                              // Code nicht zu unterscheiden, und der Leser nimmt Ziffern
                              // als Wiederholungszahl.
                              [TILE_TYPE.WEIT_RIGHT]: 'W', [TILE_TYPE.WEIT_LEFT]: 'Q',
                              [TILE_TYPE.KLEIN_RIGHT]: 'K', [TILE_TYPE.KLEIN_LEFT]: 'M',
                              [TILE_TYPE.ENGE]: 'E' };
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
    return { tiles, rotation: (Math.round(rot / 45) * 45) % 360 };
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
      garage.forEach(c => {
        const g = c.ghost;
        // DER ORT KOMMT AUS ghostOrt(), und das ist die Behebung des gemeldeten Huepfens.
        // Hier stand eine EIGENE Phasenrechnung, und sie war die von vor v0.5.18: global
        // gemitteltes tileMs mal geometrischem Laengenverhaeltnis, mit g.tileStart als Uhr.
        // Seit v0.5.18 misst die App die Dauer je KACHELTYP, und die Karte zog nicht mit.
        //
        // Fuer eine Haarnadel ist die geometrische Vorhersage gemessen 1,43 mal zu kurz: die
        // Karte hielt ihre Phase also nach 70 Prozent der Haarnadel fuer voll, deckelte auf
        // 1 - und der Punkt stand den Rest der Kurve still und sprang dann. Dazu lief sie an
        // einer zweiten Uhr: g.tileStart wird im ghostTick gesetzt, car.tileAt schon beim
        // Eintreffen des Pakets, und dazwischen liegt bis zu ein Takt (45 ms).
        const ort = (typeof ghostOrt === 'function') ? ghostOrt(c) : null;
        if (ort !== null) {
          const kachel = Math.floor(ort);
          // DIE RICHTIGEN ZUGRIFFE. Hier stand c.farbe und c.name - beides gibt es an
          // einem Auto nicht, also fiel jeder Punkt auf Orange und jedes Kuerzel auf '?'
          // zurueck. Gemeldet als "alle orange mit Fragezeichen daneben". Die Zuordnung war
          // nie unklar: jeder Ghost hat seine eigene Verbindung und seinen eigenen
          // Kachelzaehler - sie wurde nur nicht hingeschrieben.
          out.push({ index: kachel, phase: ort - kachel, farbe: carColor(c).hex,
                     kuerzel: garageLabel(c).slice(0, 3),
                     // Die ANGEFORDERTE Querlage. Das Auto meldet keine; was hier steht,
                     // ist die Summe aus eigener Spur und Ideallinie, also die Lage, die
                     // die App gerade will. Mehr ist ehrlich nicht zu haben.
                     //
                     // UMGEDREHT, weil querSoll ein Lenkbefehl ist und diese Karte entlang
                     // der Normalen zeichnet - siehe querSollAlsLage().
                     quer: querSollAlsLage(g.querSoll), rolle: 'ghost' });
        } else if (c.role === 'player' && typeof dashMinimapIndex === 'number') {
          // Das eigene Auto lenkt die App nicht, es gibt also keine angeforderte QUERLAGE -
          // quer bleibt 0, statt eine zu erfinden.
          //
          // Die PHASE dagegen gibt es, und sie stand hier fest auf 0,5: der eigene Punkt sass
          // immer in der Mitte seiner Kachel und sprang bei jedem Wechsel eine ganze Kachel
          // weit. dashTilePhase() war die ganze Zeit da und wurde nur nicht gefragt.
          out.push({ index: dashMinimapIndex,
                     phase: (typeof dashTilePhase === 'function') ? dashTilePhase() : 0.5,
                     farbe: carColor(c).hex,
                     kuerzel: garageLabel(c).slice(0, 3), quer: 0, rolle: 'player' });
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

  let trackEditorGeo = null;
  // BESTELLT: "editor: lass mich mit noch freien tasten und w finger touch in die strecke
  // zoomen". Ein Zoom-Faktor auf die Vorschaukarte; + / - (Tastatur) und Zwei-Finger-Pinch
  // aendern ihn, 0 setzt zurueck. var, weil refreshTrackPreview() schon beim Laden laeuft.
  var editorZoom = 1;
  // Verschiebung der gezoomten Karte in Bildpunkten (v0.9.16): ab Zoom > 1 ragt sie ueber den
  // Rand, und ohne Verschieben war der Rest nicht mehr erreichbar.
  var editorPan = { x: 0, y: 0 };
  function trackZoomAnwenden() {
    const k = document.querySelector('#track-preview-svg .tp-karte');
    if (!k) return;
    if (editorZoom <= 1) { editorPan = { x: 0, y: 0 }; }
    k.style.transform = editorZoom === 1 && !editorPan.x && !editorPan.y ? ''
      : 'translate(' + editorPan.x.toFixed(0) + 'px,' + editorPan.y.toFixed(0) + 'px) scale(' + editorZoom + ')';
  }
  function trackZoom(d) {
    editorZoom = Math.max(0.5, Math.min(3, Math.round((editorZoom + d) * 10) / 10));
    trackZoomAnwenden();
    if (typeof editorStreckeMerken === 'function') editorStreckeMerken();
  }
  // ---- Editor-Schalter (v0.8.29): Ideallinie, Tastenkuerzel. Je Geraet gemerkt. ----
  // var und nicht let: refreshTrackPreview() laeuft schon beim Laden, und ein let weiter unten
  // stuende dann noch in der temporalen Todeszone.
  var editorSchalter = (function () {
    // Ideallinie ab v0.9.22 AUS, bis man sie anklickt; ein frueher gespeichertes "an" (ohne
    // v: 2) zaehlt nicht, sonst bliebe sie bei allen an, die den Editor je geoeffnet haben.
    const z = { linie: false, tasten: true, v: 2 };
    try {
      const s = JSON.parse(localStorage.getItem('omegasim-editor-schalter') || '{}');
      if (typeof s.linie === 'boolean' && s.v === 2) z.linie = s.linie;
      if (typeof s.tasten === 'boolean') z.tasten = s.tasten;
    } catch (e) { /* ohne Speicher: an */ }
    return z;
  })();
  function editorSchalterZeigen() {
    [['track-opt-linie', editorSchalter.linie], ['track-opt-tasten', editorSchalter.tasten]].forEach(([id, an]) => {
      const b = $(id);
      if (b) { b.classList.toggle('an', an); b.setAttribute('aria-pressed', an ? 'true' : 'false'); }
    });
    const host = $('track-fs-host');
    if (host) host.classList.toggle('ohne-tasten', !editorSchalter.tasten);
  }
  function editorSchalterUm(was) {
    editorSchalter[was] = !editorSchalter[was];
    try { localStorage.setItem('omegasim-editor-schalter', JSON.stringify(editorSchalter)); } catch (e) { /* egal */ }
    editorSchalterZeigen();
    if (was === 'linie') refreshTrackPreview();
  }

  // DIE STRECKE IM EDITOR UEBERLEBT EINEN NEUSTART (v0.9.6). Vorher stand nach dem Neuladen
  // wieder nur das Startteil da. Gebuendelt geschrieben, weil die Vorschau beim Fahren oft
  // neu gezeichnet wird.
  // var und nicht const/let: refreshTrackPreview() laeuft schon beim Laden (siehe editorZoom).
  var EDITOR_STRECKE_STORE = 'omegasim-editor-strecke';
  var editorStreckeFaellig = null;
  function editorStreckeMerken() {
    if (editorStreckeFaellig !== null) return;
    editorStreckeFaellig = setTimeout(() => {
      editorStreckeFaellig = null;
      try {
        localStorage.setItem(EDITOR_STRECKE_STORE, JSON.stringify({ tiles: currentTrackTiles.map((x) => x.type),
          rotation: trackRotationDeg, zoom: editorZoom }));
      } catch (e) { /* voll oder privat */ }
    }, 800);
  }
  function editorStreckeLaden() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(EDITOR_STRECKE_STORE) || 'null'); } catch (e) { return false; }
    if (!d || !Array.isArray(d.tiles) || d.tiles.length < 2) return false;
    const ok = Object.values(TILE_TYPE);
    if (!d.tiles.every((x) => ok.includes(x))) return false;
    currentTrackTiles = d.tiles.map((type) => ({ type }));
    if (Number.isFinite(d.rotation)) trackRotationDeg = d.rotation;
    if (Number.isFinite(d.zoom)) editorZoom = Math.max(0.5, Math.min(3, d.zoom));
    return true;
  }
  function refreshTrackPreview() {
    editorStreckeMerken();
    // Die Kachelzahl entscheidet, ob der Windschatten ueberhaupt rechnen kann. Hier gerufen
    // und nicht in 50-drive.js beim Laden: dort ist currentTrackTiles noch in der temporalen
    // Todeszone, siehe den Kommentar bei dirtyAirVerfuegbar().
    if (typeof dirtyAirVerfuegbar === 'function') dirtyAirVerfuegbar();
    // MIT den Autos, seit v0.5.1. Vorher stand hier ausdruecklich null, also gar kein
    // Auto - und der gruene Strich auf der Startgeraden, den man dafuer hielt, ist die
    // Start/Ziel-Linie.
    if (trackSel !== null && trackSel >= currentTrackTiles.length) trackSel = null;
    const imEditor = document.body.classList.contains('track-fs');
    const raum = teileRaum();
    const result = renderTrackPreview(currentTrackTiles, null,
      { detailed: true, cars: trackCarMarks(), echt: true, auswahl: imEditor ? trackSelIndex() : null,
        ohneLinie: !editorSchalter.linie, grid: true,
        raum: (raum.x > 0 || raum.y > 0) ? raum : null, raumVersatz });
    $('track-preview-svg').innerHTML = result.html;
    trackZoomAnwenden();
    trackEditorGeo = result.geo || null;
    trackInfoZeichnen();
    editorSchalterZeigen();
    renderTrackPalette();
    updateTrackSpace();
    $('track-code').value = trackToCode(currentTrackTiles, trackRotationDeg);
    const info = $('track-line-info');
    if (info) {
      // Residual in millimetres: a bare number in drawing units means nothing to a reader.
      const li = result.lineInfo;
      // UEBER EINE VORLAGE, nicht ueber den fertigen Satz. Im Woerterbuch stand die Zeile
      // mit EINGEBACKENEN ZAHLEN ("0.0 cm von 9.3 cm"), sie traf also genau eine einzige
      // Streckenlage und sonst nie - im englischen Modus stand dort deutscher Text, sobald
      // die Ideallinie irgendeinen anderen Wert hatte. Gefunden hat es der Sprachtest.
      //
      // Die Vorlage traegt Platzhalter und ist damit fuer jede Zahl dieselbe.
      info.textContent = li
        ? t('Ideallinie nutzt {a} cm von {b} cm möglichem Versatz')
            .replace('{a}', (li.span / TRACK_UNITS_PER_CM).toFixed(1))
            .replace('{b}', (li.limit / TRACK_UNITS_PER_CM).toFixed(1))
        : '';
    }
    // Auch hier durch t(): "Geschlossen" stand im Woerterbuch, "Offen" fehlte, und keines
    // von beiden wurde je nachgeschlagen, weil der Text per textContent hineingeschrieben
    // wird. Der Sprachtest sieht "Offen" nicht - es hat weder Umlaut noch deutsches
    // Funktionswort -, falsch ist es trotzdem.
    // DIE LUECKE MIT ANSCHREIBEN, in Zentimetern. "Offen" allein sagt nicht, ob ein Teil
    // fehlt oder ob es zwei Millimeter sind - und genau das ist die Frage, die man beim
    // Bauen hat. Gemeldet als "bei einer laengeren Strecke passen die Schienen am Ende
    // nicht perfekt zusammen": mit der Zahl daneben sieht man sofort, ob das noch in der
    // Toleranz liegt.
    const badge = $('track-closed-badge');
    if (currentTrackTiles.length === 0) {
      badge.textContent = '-';
    } else if (result.closed) {
      badge.textContent = t('Geschlossen ✓');
    } else if (result.schluss && result.schluss.lueckeCm !== null) {
      const l = result.schluss.lueckeCm.toFixed(0);
      const w = Math.abs(result.schluss.winkel).toFixed(0);
      badge.textContent = t('Offen') + ' (' + l + ' cm, ' + w + '°)';
    } else {
      badge.textContent = t('Offen');
    }
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
        trackSel = i;
        trackTeilEntfernen();
      };
    });
    $('track-rotation-val').textContent = trackRotationDeg + '°';
  }

  // Genau eine Start/Ziel-Kachel, und sie liegt auf Index 0. freshTrackTiles() legt sie
  // an, der Import und das Laden stellen sie voran - nur addTile() hatte keinen Schutz, und
  // der Start-Knopf in der Palette konnte sie beliebig oft hinten anhaengen. Eine zweite
  // Start-Kachel bricht die Rundenzaehlung, weil sie sich auf die eine Ueberfahrt stuetzt.
  // ---- AUSWAHL, EINFUEGEN, ENTFERNEN, RUECKGAENGIG (v0.8.28) -----------------------
  //
  // BESTELLT: "Ich will einzelne Teile auswaehlen und entfernen koennen und mittendrin ein
  // Teil einfuegen koennen." Gewaehlt ist ein Teil (trackSel, Index; null = das letzte).
  // Neue Teile kommen HINTER das gewaehlte, und das neue ist danach gewaehlt - wer nie
  // waehlt, baut also wie bisher hinten an. Jede Aenderung legt vorher den Stand ab
  // (trackVerlauf); Rueckgaengig holt ihn zurueck, nicht nur "letztes Teil weg".
  let trackSel = null;
  const trackVerlauf = [];
  function trackSelIndex() {
    const n = currentTrackTiles.length;
    if (!n) return null;
    return trackSel === null || trackSel >= n || trackSel < 0 ? n - 1 : trackSel;
  }
  function trackMerken() {
    trackVerlauf.push({ tiles: currentTrackTiles.map((x) => Object.assign({}, x)),
                        rot: trackRotationDeg, sel: trackSel });
    if (trackVerlauf.length > 80) trackVerlauf.shift();
  }
  function addTile(type) {
    // BESTELLT: "lass mich im editor weitere start/ziel geraden einbauen, die dann als
    // sektor gelten". Mehrere Start/Ziel-Kacheln sind jetzt erlaubt - die erste ist die
    // Rundenlinie, die weiteren sind Sektorgrenzen (siehe trackSektorAnzahl).
    const warZu = trackIstGeschlossen();
    trackMerken();
    const at = currentTrackTiles.length ? trackSelIndex() + 1 : 0;
    currentTrackTiles.splice(at, 0, { type });
    trackSel = at;
    // BESTELLT: "beim zusammenfügen ein angenehmes klick geräusch". Ein kurzer, heller Ton.
    if (typeof playTone === 'function') playTone(660, 0.045, 'sine', 0.12);
    // BESTELLT: "wenn die strecke fertig ist, ein noch befriedigenderes klack". Erst beim
    // UEBERGANG von offen zu geschlossen, nicht bei jedem weiteren Teil auf der fertigen Runde.
    if (!warZu && trackIstGeschlossen()) trackFertigKlang();
    refreshTrackPreview();
  }
  // BESTELLT: "im editor weitere start/ziel geraden einbauen, die dann als sektor gelten".
  // Die Zahl der Start/Ziel-Kacheln ist die Zahl der Sektoren: die erste ist die Rundenlinie,
  // die weiteren sind Sektorgrenzen (Zwischenzeit).
  function trackSektorAnzahl(tiles) {
    return (tiles || []).filter((t) => t.type === TILE_TYPE.START).length;
  }
  function trackIstGeschlossen() {
    if (currentTrackTiles.length < 3) return false;
    if (typeof trackCenterline !== 'function' || typeof trackSchluss !== 'function') return false;
    try { return trackSchluss(trackCenterline(currentTrackTiles)); } catch (e) { return false; }
  }
  // Befriedigendes Klack (ein bisschen wie bei Legovideospielen): drei schnell ansteigende
  // Toene, der letzte laenger und heller.
  function trackFertigKlang() {
    if (typeof playTone !== 'function') return;
    playTone(520, 0.05, 'sine', 0.18);
    setTimeout(() => playTone(780, 0.07, 'sine', 0.2), 55);
    setTimeout(() => playTone(1040, 0.1, 'sine', 0.24), 120);
  }
  function trackTeilEntfernen() {
    const i = trackSelIndex();
    if (!(i > 0)) { showHudToast(t('Start/Ziel bleibt')); return false; }
    trackMerken();
    currentTrackTiles.splice(i, 1);
    trackSel = i - 1;
    refreshTrackPreview();
    return true;
  }
  function trackRueckgaengig() {
    const s = trackVerlauf.pop();
    if (!s) { showHudToast(t('Nichts rückgängig zu machen')); return false; }
    currentTrackTiles = s.tiles;
    trackRotationDeg = s.rot;
    trackSel = s.sel;
    refreshTrackPreview();
    return true;
  }
  function trackAuswahlSchritt(d) {
    const n = currentTrackTiles.length;
    if (!n) return;
    trackSel = ((trackSelIndex() + d) % n + n) % n;
    refreshTrackPreview();
  }
  // LAENGE: die Summe der Teile, dieselbe Laenge, mit der Ghosts und Rundenzeit rechnen
  // (tileLength, 90-ghosts.js). Dazu das 50-fache in km: die Autos sind 1:50.
  function trackLaengeM(tiles) {
    let u = 0;
    for (const k of tiles || []) u += tileLength(k.type);
    return u / TRACK_UNITS_PER_CM / 100;
  }
  function trackLaengeText(tiles) {
    const m = trackLaengeM(tiles);
    const fmt = (x, n) => x.toFixed(n).replace('.', lang === 'en' ? '.' : ',');
    return t('Länge') + ' ' + fmt(m, 2) + ' m · 1:50 = ' + fmt(m * 50 / 1000, 2) + ' km';
  }

  // ---- MEINE TEILE: was im Karton ist, und was die Strecke davon braucht --------------
  const TEILE_KEY = 'omegasim-teile';
  // BESTELLT: "let me determine the maximum size of the room as a rectangle (x and y, in
  // meters, format X.Y)". Die Zufallsstrecke muss in dieses Rechteck passen (45°-Schritte).
  // Default 0 m x 0 m = keine Begrenzung: die Zufallsstrecke ignoriert den Raum, bis der
  // Nutzer eine Groesse eintraegt. Ein Wert 0 je Achse heisst "diese Richtung unbegrenzt".
  const RAUM_KEY = 'omegasim-raum';
  // ---- DIE STRECKE IM RAUM VERSCHIEBEN (v0.9.11) ---------------------------------------
  // Der Versatz (cm) legt das Raum-Rechteck gegen die Strecke - fuers Aufbauen auf dem Boden:
  // wo im Zimmer liegt die Strecke? Er aendert die Strecke nicht. var, weil refreshTrackPreview()
  // schon beim Laden laeuft. Beim Ziehen wird nur das Rechteck im SVG bewegt (eine ganze
  // Vorschau kostet rund 94 ms), neu gezeichnet wird beim Loslassen.
  var RAUM_VERSATZ_KEY = 'omegasim-raum-versatz';
  var raumVersatz = (function () {
    try { const v = JSON.parse(localStorage.getItem('omegasim-raum-versatz') || 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v; } catch (e) { /* privat */ }
    return { x: 0, y: 0 };
  })();
  function raumVersatzSpeichern() {
    try { localStorage.setItem(RAUM_VERSATZ_KEY, JSON.stringify(raumVersatz)); } catch (e) { /* privat */ }
  }
  // Rechteck sofort um (dx, dy) Kartenpunkte verschieben, ohne neu zu zeichnen.
  function raumRechteckSchieben(dxEinh, dyEinh) {
    const g = document.querySelector('#track-preview-svg .tp-raum');
    if (!g) return false;
    g.querySelectorAll('rect, text').forEach((el) => {
      el.setAttribute('x', (parseFloat(el.getAttribute('x')) + dxEinh).toFixed(1));
      el.setAttribute('y', (parseFloat(el.getAttribute('y')) + dyEinh).toFixed(1));
    });
    raumVersatz.x += dxEinh / TRACK_UNITS_PER_CM;
    raumVersatz.y += dyEinh / TRACK_UNITS_PER_CM;
    return true;
  }
  function raumVersatzNull() {
    raumVersatz = { x: 0, y: 0 };
    raumVersatzSpeichern();
    refreshTrackPreview();
  }
  let raumNeuZeichnen = null;
  function raumSpaeterZeichnen() {
    clearTimeout(raumNeuZeichnen);
    raumNeuZeichnen = setTimeout(() => { raumVersatzSpeichern(); refreshTrackPreview(); }, 350);
  }
  // Rechter Stick im Editor-Vollbild (aus pollGamepad): schiebt mit bis zu 60 cm/s; R3 zentriert.
  let raumStickAt = 0, raumR3Vor = false;
  function raumVersatzStick(ax, ay, r3) {
    const jetzt = performance.now();
    const dt = Math.min(0.1, (jetzt - (raumStickAt || jetzt)) / 1000);
    raumStickAt = jetzt;
    if (r3 && !raumR3Vor) raumVersatzNull();
    raumR3Vor = r3;
    const tot = 0.2;
    const x = Math.abs(ax) > tot ? ax : 0, y = Math.abs(ay) > tot ? ay : 0;
    if (!x && !y) return;
    // Der Stick bewegt die STRECKE: nach rechts gedrueckt wandert sie nach rechts, also der
    // Raum nach links.
    const cm = 60 * dt;
    if (raumRechteckSchieben(-x * cm * TRACK_UNITS_PER_CM, -y * cm * TRACK_UNITS_PER_CM)) raumSpaeterZeichnen();
  }
  (function raumZiehenAnbinden() {
    const host = $('track-preview-svg');
    if (!host) return;
    let a = null, gezogen = false;
    host.addEventListener('pointerdown', (e) => {
      const pan = editorZoom > 1;
      if (!e.isPrimary || (!pan && !host.querySelector('.tp-raum'))) { a = null; return; }
      const svg = host.querySelector('svg.tp-karte');
      if (!svg) return;
      const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      a = { x: e.clientX, y: e.clientY, k: vb && r.width ? vb.width / r.width : 1, id: e.pointerId, pan };
      gezogen = false;
    });
    host.addEventListener('pointermove', (e) => {
      if (!a || e.pointerId !== a.id) return;
      const dx = e.clientX - a.x, dy = e.clientY - a.y;
      if (!gezogen && Math.hypot(dx, dy) < 8) return;
      gezogen = true;
      e.preventDefault();
      if (a.pan) {
        // Gezoomt: die Ansicht verschieben.
        editorPan.x += dx; editorPan.y += dy;
        trackZoomAnwenden();
      } else {
        // Finger nach rechts = Strecke nach rechts = Raum nach links.
        raumRechteckSchieben(-dx * a.k, -dy * a.k);
      }
      a.x = e.clientX; a.y = e.clientY;
    });
    // Mausrad zoomt im Editor-Vollbild (ausserhalb bleibt es Seitenbildlauf).
    host.addEventListener('wheel', (e) => {
      if (!document.body.classList.contains('track-fs') && !e.ctrlKey) return;
      e.preventDefault();
      trackZoom(e.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });
    const ende = () => { if (a && gezogen) raumSpaeterZeichnen(); a = null; };
    host.addEventListener('pointerup', ende);
    host.addEventListener('pointercancel', () => { a = null; });
    // Ein Zug ist kein Antippen: den Klick danach nicht als Kachelwahl werten.
    host.addEventListener('click', (e) => { if (gezogen) { e.stopPropagation(); e.preventDefault(); gezogen = false; } }, true);
  })();
  const RAUM_DEFAULT = { x: 0, y: 0 };
  const TEILE_SORTEN = [TILE_TYPE.START, TILE_TYPE.STRAIGHT, TILE_TYPE.CURVE_LEFT, TILE_TYPE.CURVE_RIGHT,
    TILE_TYPE.HAIRPIN_LEFT, TILE_TYPE.HAIRPIN, TILE_TYPE.WEIT_LEFT, TILE_TYPE.WEIT_RIGHT,
    TILE_TYPE.KLEIN_LEFT, TILE_TYPE.KLEIN_RIGHT, TILE_TYPE.PIT, TILE_TYPE.ENGE];
  // Die Pakete, wie sie der Nutzer beschrieben hat: Grundpackung 8 rechts, 2 links,
  // 4 Geraden, 1 Start; Haarnadel-Set links und rechts; 30-Grad-Aussenkurven 2 L, 2 R.
  const TEILE_PAKETE = {
    grund: [[TILE_TYPE.CURVE_RIGHT, 8], [TILE_TYPE.CURVE_LEFT, 2], [TILE_TYPE.STRAIGHT, 4], [TILE_TYPE.START, 1]],
    // Spiegeldbild der Grundpackung: 8 links, 2 rechts, gleiche Geraden - und bewusst KEIN
    // Start/Ziel, weil es das nur einmal gibt und die Grundpackung es schon liefert.
    links: [[TILE_TYPE.CURVE_LEFT, 8], [TILE_TYPE.CURVE_RIGHT, 2], [TILE_TYPE.STRAIGHT, 4]],
    haarnadel: [[TILE_TYPE.HAIRPIN_LEFT, 1], [TILE_TYPE.HAIRPIN, 1]],
    dreissig: [[TILE_TYPE.WEIT_LEFT, 2], [TILE_TYPE.WEIT_RIGHT, 2]],
    enge: [[TILE_TYPE.ENGE, 1]],
  };
  function teileBestand() {
    try {
      const x = JSON.parse(localStorage.getItem(TEILE_KEY) || 'null');
      return x && typeof x === 'object' ? x : null;
    } catch (e) { return null; }
  }
  // Raumgrenzen (m) fuer die Zufallsstrecke. Fehlt der Eintrag oder ist er unbrauchbar,
  // gilt 0 x 0 - also keine Begrenzung. 0 je Achse heisst "diese Richtung unbegrenzt".
  function teileRaum() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(RAUM_KEY) || 'null'); } catch (e) { r = null; }
    if (!r || typeof r !== 'object') return { x: 0, y: 0 };
    return { x: Math.max(0, +r.x || 0), y: Math.max(0, +r.y || 0) };
  }
  function teileRaumSpeichern(r) {
    try { localStorage.setItem(RAUM_KEY, JSON.stringify({ x: +r.x || 0, y: +r.y || 0 })); } catch (e) { /* privat */ }
  }
  function teileSpeichern(b) {
    try { if (b) localStorage.setItem(TEILE_KEY, JSON.stringify(b)); else localStorage.removeItem(TEILE_KEY); } catch (e) { /* privat */ }
    // Neuer Bestand: die Zufallsstrecken duerfen wiederkommen, sonst blockiert der
    // "nicht zweimal dieselbe"-Schutz die Erzeugung dauerhaft.
    trackZufallCodes = [];
    teileZeichnen();
    refreshTrackPreview();
  }
  // Je Sorte: vorhanden (null = nicht gezaehlt), gebraucht, Rest.
  function teileBilanz(tiles) {
    const b = teileBestand();
    const braucht = {};
    for (const k of tiles || []) braucht[k.type] = (braucht[k.type] || 0) + 1;
    return TEILE_SORTEN.map((typ) => {
      const hat = b && b[typ] !== undefined && b[typ] !== null ? +b[typ] : null;
      const n = braucht[typ] || 0;
      return { typ, hat, braucht: n, rest: hat === null ? null : hat - n };
    });
  }
  // Symbol je Sorte fuer die "Meine Teile"-Liste. Dieselben Linien wie die Bildleiste im
  // Editor (TRACK_PALETTE), damit das Teil dort und hier gleich aussieht; Start/Ziel fehlt
  // in der Bildleiste und bekommt hier ein Zielflaggen-Band. Bewusst EIN Ort mehr als die
  // Bildleiste, weil diese Liste auch Typen zeigt, die dort nicht anwaehlbar sind.
  const TILE_ICON = {
    [TILE_TYPE.START]: '<path d="M4 9 H20 M4 15 H20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '<rect x="4" y="9" width="2" height="3" fill="currentColor"/><rect x="8" y="9" width="2" height="3" fill="currentColor"/>'
      + '<rect x="12" y="9" width="2" height="3" fill="currentColor"/><rect x="16" y="9" width="2" height="3" fill="currentColor"/>'
      + '<rect x="6" y="12" width="2" height="3" fill="currentColor"/><rect x="10" y="12" width="2" height="3" fill="currentColor"/>'
      + '<rect x="14" y="12" width="2" height="3" fill="currentColor"/><rect x="18" y="12" width="2" height="3" fill="currentColor"/>',
    [TILE_TYPE.STRAIGHT]: '<path d="M12 22 L12 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.CURVE_LEFT]: '<path d="M18 22 L18 13 A7 7 0 0 0 11 6 L4 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.CURVE_RIGHT]: '<path d="M6 22 L6 13 A7 7 0 0 1 13 6 L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.HAIRPIN_LEFT]: '<path d="M16 22 L16 14 A5 5 0 0 0 6 14 L6 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
      + '<path d="M16 22 L16 19" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    [TILE_TYPE.HAIRPIN]: '<path d="M8 22 L8 14 A5 5 0 0 1 18 14 L18 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
      + '<path d="M8 22 L8 19" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    [TILE_TYPE.WEIT_LEFT]: '<path d="M15 22 L15 12 A20 20 0 0 0 9.5 3.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.WEIT_RIGHT]: '<path d="M9 22 L9 12 A20 20 0 0 1 14.5 3.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.KLEIN_LEFT]: '<path d="M16 22 L16 13 A7 7 0 0 0 12.2 6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.KLEIN_RIGHT]: '<path d="M8 22 L8 13 A7 7 0 0 1 11.8 6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    [TILE_TYPE.PIT]: '<path d="M8 22 L8 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
      + '<path d="M16 20 L16 9 A5 5 0 0 1 21 4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.5" stroke-linecap="round"/>',
    [TILE_TYPE.ENGE]: '<path d="M7 2 L7 8 L10 12 L10 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M17 2 L17 8 L14 12 L14 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  function teileZeichnen() {
    const host = $('teile-liste');
    if (!host) return;
    const b = teileBestand() || {};
    host.innerHTML = '';
    for (const typ of TEILE_SORTEN) {
      const z = document.createElement('div');
      z.className = 'teile-zeile';
      z.dataset.teile = typ;
      z.tabIndex = 0;
      z.setAttribute('role', 'button');
      const name = t(TILE_LABEL[typ] || ('0x' + typ.toString(16)));
      z.setAttribute('aria-label', name);
      const wert = b[typ] === undefined || b[typ] === null ? 0 : +b[typ];
      // Symbol links, Name in der Mitte, rechts Minus/Zahl/Plus - so aendert man den
      // Bestand mit der Maus oder dem Finger und nicht nur mit dem D-Pad.
      z.innerHTML = '<svg class="teile-ic" viewBox="0 0 24 24" aria-hidden="true">'
          + (TILE_ICON[typ] || '') + '</svg>'
          + '<span class="teile-name"></span>'
          + '<span class="teile-steuer">'
          + '<button class="teile-minus" type="button" aria-label="' + name + ' weniger">&#8722;</button>'
          + '<span class="teile-zahl"></span>'
          + '<button class="teile-plus" type="button" aria-label="' + name + ' mehr">+</button>'
          + '</span>';
      z.querySelector('.teile-name').textContent = name;
      z.querySelector('.teile-zahl').textContent = wert;
      z.querySelector('.teile-minus').onclick = (e) => { e.stopPropagation(); teileAendern(typ, -1); };
      z.querySelector('.teile-plus').onclick = (e) => { e.stopPropagation(); teileAendern(typ, 1); };
      host.appendChild(z);
    }
  }
  // D-Pad links/rechts auf einer Zeile: eine Sorte um d veraendern (unten 0, oben 9999).
  function teileAendern(typ, d) {
    const neu = Object.assign({}, teileBestand() || {});
    const alt = neu[typ] === undefined || neu[typ] === null ? 0 : +neu[typ];
    neu[typ] = Math.max(0, Math.min(9999, alt + d));
    teileSpeichern(neu);
  }
  function teilePaket(name) {
    const neu = Object.assign({}, teileBestand() || {});
    for (const [typ, n] of TEILE_PAKETE[name] || []) neu[typ] = (neu[typ] ? +neu[typ] : 0) + n;
    teileSpeichern(neu);
  }
  const teileKnopf = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  teileKnopf('teile-grund', () => teilePaket('grund'));
  teileKnopf('teile-links', () => teilePaket('links'));
  teileKnopf('teile-haarnadel', () => teilePaket('haarnadel'));
  teileKnopf('teile-dreissig', () => teilePaket('dreissig'));
  teileKnopf('teile-enge', () => teilePaket('enge'));
  teileKnopf('teile-leer', () => { const n = {}; TEILE_SORTEN.forEach((x) => { n[x] = 0; }); teileSpeichern(n); });
  teileZeichnen();

  // Raumgrenze (m) einer Achse um delta aendern (0,1 je Schritt, beim Halten groesser).
  // Top-level, damit das Steuerkreuz in 50b-menu-nav.js (row.kind 'raum') dieselbe Stelle
  // schreibt wie die Minus/Plus-Knoepfe - keine zweite Kopie von teileRaum().
  function raumAendern(achse, delta) {
    const r = teileRaum();
    r[achse] = Math.max(0, Math.min(99, Math.round((r[achse] + delta) * 10) / 10));
    teileRaumSpeichern(r);
    if (typeof raumAnzeigen === 'function') raumAnzeigen();
    // Das Raum-Rechteck zeichnet erst der Editor (refreshTrackPreview). Beim Halten der
    // Knoepfe wuerde jede 0,1-Stufe sonst die teure Streckenberechnung neu ausloesen.
    if (document.body.classList.contains('track-fs')) refreshTrackPreview();
  }

  // Raumgrenzen (m) fuer die Zufallsstrecke: zwei Felder "Breite" und "Tiefe", Format X.Y (z. B. 1,2).
  // 0 (oder leer) heisst "keine Begrenzung". Minus/Plus-Knoepfe aendern um 0,1, beim Halten
  // beschleunigt (erst schneller, dann groessere Schritte) - dasselbe Muster wie das Steuerkreuz.
  const raumX = $('teile-raum-x'), raumY = $('teile-raum-y');
  let raumAnzeigen = () => {};
  if (raumX && raumY) {
    raumAnzeigen = () => {
      const r = teileRaum();
      raumX.value = String(r.x);
      raumY.value = String(r.y);
    };
    const lesen = () => {
      // Punkt und Komma gleichwertig (X.Y oder X,Y); leer oder unlesbar = 0 (keine Begrenzung).
      const parse = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n >= 0 ? Math.min(99, n) : 0; };
      teileRaumSpeichern({ x: parse(raumX.value), y: parse(raumY.value) });
      raumAnzeigen();
      refreshTrackPreview();
    };
    raumX.addEventListener('change', lesen);
    raumY.addEventListener('change', lesen);
    // Minus/Plus je Achse: 0,1 je Klick, beim Halten schneller/groesser (Date.now-Muster).
    const raumHold = (btn, achse, richtung) => {
      let timer = null, start = 0, last = 0;
      const step = (schritt) => { raumAendern(achse, richtung * schritt); };
      const begin = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (btn.setPointerCapture && e.pointerId !== undefined) { try { btn.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } }
        step(0.1);
        start = last = Date.now();
        let delay = 300;
        const tick = () => {
          const now = Date.now();
          const beschleunigt = now - start >= 500;
          const schritt = beschleunigt ? 0.5 : 0.1;
          delay = last === start ? 300 : (beschleunigt ? 70 : 120);
          if (now - last >= delay) { last = now; step(schritt); }
          timer = setTimeout(tick, delay);
        };
        timer = setTimeout(tick, delay);
      };
      const end = () => { if (timer) { clearTimeout(timer); timer = null; } };
      btn.addEventListener('pointerdown', begin);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', end);
      btn.addEventListener('pointercancel', end);
    };
    const rm = (id, achse, richtung) => { const b = $(id); if (b) raumHold(b, achse, richtung); };
    rm('raum-x-minus', 'x', -1); rm('raum-x-plus', 'x', 1);
    rm('raum-y-minus', 'y', -1); rm('raum-y-plus', 'y', 1);
    raumAnzeigen();
  }

  // Anzeige oben im Vollbild: Laenge, Teilebilanz; dazu die Tastenbelegung.
  function trackInfoZeichnen() {
    const info = $('track-fs-info');
    const bilanz = teileBilanz(currentTrackTiles).filter((x) => x.hat !== null);
    const fehlt = bilanz.filter((x) => x.rest < 0);
    let html = trackLaengeText(currentTrackTiles);
    if (bilanz.length) {
      const uebrig = bilanz.reduce((s, x) => s + Math.max(0, x.rest), 0);
      html += ' · ' + (fehlt.length
        ? '<span class="tp-fehlt">' + t('Fehlt') + ': ' + fehlt.map((x) => (-x.rest) + '× ' + t(TILE_LABEL[x.typ])).join(', ') + '</span>'
        : '<span class="tp-da">' + t('Alle Teile da') + '</span>')
        + ' · ' + uebrig + ' ' + t('übrig');
    }
    if (info) info.innerHTML = html;
    const l = $('track-laenge');
    if (l) l.textContent = trackLaengeText(currentTrackTiles) + ' · ' + currentTrackTiles.length + ' ' + t('Teile');
    const k = $('track-fs-tasten');
    if (k) k.textContent = t('✕/Enter einfügen · □/Entf entfernen · L1 R1/Q E Teil wählen · △/R drehen · ○/Z zurück · L3/Esc schließen');
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
    // BESTELLT: "im editor weitere start/ziel geraden einbauen, die dann als sektor gelten".
    // Start/Ziel ist jetzt in der Palette, damit man eine zweite Rundenlinie als Sektor
    // legen kann. Die erste Kachel bleibt die Rundenlinie (siehe sektorZiel()).
    { key: 'start', type: () => TILE_TYPE.START, cap: 'Start/Ziel',
      icon: '<path d="M4 9 H20 M4 15 H20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
          + '<rect x="4" y="9" width="2" height="3" fill="currentColor"/><rect x="8" y="9" width="2" height="3" fill="currentColor"/>'
          + '<rect x="12" y="9" width="2" height="3" fill="currentColor"/><rect x="16" y="9" width="2" height="3" fill="currentColor"/>'
          + '<rect x="6" y="12" width="2" height="3" fill="currentColor"/><rect x="10" y="12" width="2" height="3" fill="currentColor"/>'
          + '<rect x="14" y="12" width="2" height="3" fill="currentColor"/><rect x="18" y="12" width="2" height="3" fill="currentColor"/>' },
    { key: 'hairpin-left', type: () => TILE_TYPE.HAIRPIN_LEFT, cap: 'Haarnadel L',
      icon: '<path d="M16 22 L16 14 A5 5 0 0 0 6 14 L6 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          + '<path d="M16 22 L16 19" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' },
    { key: 'left',  type: () => TILE_TYPE.CURVE_LEFT,  cap: 'Links',
      icon: '<path d="M18 22 L18 13 A7 7 0 0 0 11 6 L4 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    // Die kleine 30-Grad-Kurve: derselbe Radius wie die 60-Grad-Kurve, halber Winkel. Das
    // Symbol zeigt deshalb denselben Bogen, nur frueher abgebrochen.
    { key: 'klein-left', type: () => TILE_TYPE.KLEIN_LEFT, cap: '30\u00b0 L',
      icon: '<path d="M16 22 L16 13 A7 7 0 0 0 12.2 6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    // Die weite Kurve: gleicher Winkel, dreifacher Radius - also eine viel flachere Linie.
    { key: 'weit-left', type: () => TILE_TYPE.WEIT_LEFT, cap: 'Weit L',
      icon: '<path d="M15 22 L15 12 A20 20 0 0 0 9.5 3.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    { key: 'straight', type: () => TILE_TYPE.STRAIGHT, cap: 'Gerade',
      icon: '<path d="M12 22 L12 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    // Die Engstelle: eine Gerade, die in der Mitte einspringt. Das Symbol sagt genau das,
    // was die Kachel ist - die Breite selbst ist noch nicht gemessen (siehe trackCenterline).
    { key: 'enge', type: () => TILE_TYPE.ENGE, cap: 'Enge',
      icon: '<path d="M7 2 L7 8 L10 12 L10 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
          + '<path d="M17 2 L17 8 L14 12 L14 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' },
    { key: 'pit', type: () => TILE_TYPE.PIT, cap: 'Box',
      icon: '<path d="M8 22 L8 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          + '<path d="M16 20 L16 9 A5 5 0 0 1 21 4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.5" stroke-linecap="round"/>' },
    { key: 'weit-right', type: () => TILE_TYPE.WEIT_RIGHT, cap: 'Weit R',
      icon: '<path d="M9 22 L9 12 A20 20 0 0 1 14.5 3.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
    { key: 'klein-right', type: () => TILE_TYPE.KLEIN_RIGHT, cap: '30\u00b0 R',
      icon: '<path d="M8 22 L8 13 A7 7 0 0 1 11.8 6.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
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
    // Gruppe je Teil: links drehend, gerade (auch Enge und Box), rechts drehend. Wechselt sie,
    // steht ein feiner Strich davor (BESTELLT: "Trenne die Streckenteile im Editor jeweils
    // nach Typ mit subtilen grauen vertikalen Strichen").
    const gruppe = (p) => Math.sign(tileTurnDeg(p.type()));
    TRACK_PALETTE.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'tp-btn' + (i === trackPaletteSel ? ' sel' : '')
        + (i > 0 && gruppe(p) !== gruppe(TRACK_PALETTE[i - 1]) ? ' tp-trenn' : '');
      b.title = p.cap;
      b.setAttribute('aria-label', p.cap);
      const bil = teileBilanz(currentTrackTiles).find((x) => x.typ === p.type());
      const rest = bil && bil.hat !== null
        ? `<span class="tp-rest${bil.rest < 0 ? ' fehlt' : ''}">${bil.rest}</span>` : '';
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${p.icon}</svg>`
                  + `<span class="tp-cap">${p.cap}</span>` + rest;
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
    el.textContent = t('{w} × {h} cm · {n} Teile')
      .replace('{w}', Math.round(wCm))
      .replace('{h}', Math.round(hCm))
      .replace('{n}', currentTrackTiles.length);
  }

  // ====================================================================================
  // VOLLBILD FUER DEN EDITOR
  // ====================================================================================
  //
  // GEMELDET: "Du musst noch den Vollbildmodus des Streckeneditors fixen, aktuell sehe ich
  // die Streckenteile unten dann nicht."
  //
  // ---- DER BEFUND, und er war ein Widerspruch im eigenen Code --------------------
  //
  // Hier stand, richtig gedacht: `catch (e) { /* refused: the CSS layout still applies */ }`
  // - verweigert der Browser das echte Vollbild, gilt die CSS-Lage trotzdem, und die ordnet
  // Aktionen oben, Karte in der Mitte, Teile unten.
  //
  // Und drei Zeilen weiter nahm ein Horcher ihm das sofort wieder weg:
  //
  //     document.addEventListener('fullscreenchange', () => {
  //       if (!document.fullscreenElement && body.classList.contains('track-fs')) exit...
  //     });
  //
  // Ein VERWEIGERTER Wunsch loest dieses Ereignis ebenfalls aus (und ein fremdes Vollbild,
  // das jemand verlaesst, auch). Die Bedingung fragte nur, ob die Klasse gesetzt ist - und
  // die war sie gerade eben selbst. Also: Klasse an, Ereignis, Klasse aus. Der Knopf tat
  // sichtbar nichts, die Seite blieb in ihrer normalen Lage, und dort steht die Palette
  // unter dem Falz. GEMESSEN in einem Browser, der das Vollbild verweigert: nach dem Klick
  // war die Klasse nicht gesetzt, die Palette lag bei y = 774 auf einem 768 px hohen
  // Fenster.
  //
  // ---- DIE BEHEBUNG ------------------------------------------------------------
  //
  // Ein eigener Merker "waren wir WIRKLICH drin". Nur dann ist ein fullscreenchange ohne
  // Element ein Verlassen; sonst ist es ein verweigerter Wunsch oder fremdes Rauschen, und
  // die Lage bleibt.
  //
  // UND DIE KLASSE KOMMT ZUERST, vor der Anfrage. Sie ist das, was der Nutzer sieht; das
  // echte Vollbild ist die Zugabe. Vorher wurde erst gewartet und dann geschaltet - bei
  // einer Anfrage, die haengt oder einen Dialog zeigt, blieb der Editor bis dahin in der
  // Seitenlage.
  let trackFsDrin = false;

  async function enterTrackFullscreen() {
    document.body.classList.add('track-fs');
    // Nur noch der Textknopf in der Seite wird geschaltet. Der Umschalter in der Leiste
    // wechselt sein Symbol per CSS an derselben Klasse - eine Wahrheit, ein Ort.
    $('track-fs').hidden = true;
    refreshTrackPreview();
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* refused: the CSS layout still applies */ }
    // NACH der Anfrage gefragt und nicht vorher: erst jetzt steht fest, ob es geklappt hat.
    trackFsDrin = !!(document.fullscreenElement || document.webkitFullscreenElement);
    // Die Karte noch einmal, weil das echte Vollbild die Fenstergroesse aendert.
    if (trackFsDrin) refreshTrackPreview();
  }

  async function exitTrackFullscreen() {
    trackFsDrin = false;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* already out */ }
    document.body.classList.remove('track-fs');
    $('track-fs').hidden = false;
    refreshTrackPreview();
  }

  $('track-fs').onclick = enterTrackFullscreen;
  $('track-fs-toggle').onclick = () => (document.body.classList.contains('track-fs')
    ? exitTrackFullscreen() : enterTrackFullscreen());
  // Verlassen per Escape oder Systemgeste muss die Knoepfe zurueckstellen - aber NUR, wenn
  // wir wirklich drin waren. Siehe den Befund oben.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && trackFsDrin) exitTrackFullscreen();
  });

  // ---- Gamepad, only while the editor is in fullscreen ----
  // Gated on the fullscreen class rather than on the tab being visible: the same buttons
  // mean throttle and shifting while driving, and stealing them because a tab happens to be
  // open would be a nasty surprise. Returns true when a press was consumed.
  // Zwei Reihen, so wie sie auf dem Schirm liegen: oben die Aktionen, unten die Teile.
  // Hoch und runter wechselt die Reihe, links und rechts waehlt darin, X loest aus. Vorher
  // sprang hoch/runter auf das erste bzw. letzte Teil, was niemand erraten kann.
  // NUR DIE ids. Hier stand bei jedem Eintrag noch eine Aufschrift, und die hat NIEMAND
  // gelesen - renderTrackPadFocus und trackEditorPad nehmen beide ausschliesslich `id`.
  // Fuer den Umschalter waere sie ausserdem falsch geworden: er traegt jetzt zwei.
  const TRACK_ACTIONS = [
    { id: 'track-save-toolbar' },
    { id: 'track-opt-linie' },
    { id: 'track-opt-tasten' },
    { id: 'track-undo' },
    { id: 'track-delete-sel' },
    { id: 'track-rotate-left' },
    { id: 'track-rotate-right' },
    { id: 'track-clear' },
    { id: 'track-tour' },
    { id: 'track-fs-toggle' },
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
      // Direkttasten (v0.8.28): Kreis rueckgaengig, Quadrat entfernt das gewaehlte Teil,
      // Dreieck dreht um 45 Grad, L1/R1 waehlen das vorige/naechste Teil.
      case 'undo':  trackRueckgaengig(); return true;
      case 'reset': trackReset(); return true;
      case 'rotate': rotateTrack(45); return true;
      case 'delete': trackTeilEntfernen(); return true;
      case 'prev': trackAuswahlSchritt(-1); return true;
      case 'next': trackAuswahlSchritt(1); return true;
      default: return false;
    }
  }

  // Reset is destructive and reachable by a single button press on a pad, so it asks first —
  // but only when there is actually something to lose.
  function trackReset() {
    if (currentTrackTiles.length > 1 && !confirm('Strecke wirklich zurücksetzen?')) return;
    $('track-clear').click();
  }

  // ---- Zufaellige Strecke aus dem vorhandenen Bestand ---------------------------------
  // BESTELLT: "generates a random track given the available pieces (should only work if
  // there are enough pieces)", dann "It works but it generates quite boring tracks. Make
  // this more advanced." und zuletzt: "the track is not overlapping ... make it also have
  // asymmetric tracks. I have a hairpin in my inventory but it is never using that."
  //
  // DIE IDEE, und warum sie schliesst: `S + A + G^m + B + G^(m-1)` ist geschlossen, wenn
  // A und B beide auf +/-180 Grad drehen (zusammen 360). A == B ist der alte symmetrische
  // "Rundkurs mit zwei gleichen Ecken". Fuer A != B wird B gesucht: es muss die
  // Verschiebung von `S + A + G^m` zurueck auf die Startlinie heben. Nachgerechnet
  // (Python-Simulation der echten trackCenterline) schliessen z. B. A = RRR, H, RRLRR und
  // passende B; die Suche findet bei den meisten A nach ein paar Versuchen ein B. Weil A
  // dabei nur EINMAL vorkommt, darf auch eine einzelne Haarnadel im Karton benutzt werden.
  //
  // Damit die Strecke NICHT ueberlappt, wird jede Kandidaten-Strecke geprueft: keine
  // Kreuzung der Mittellinie und kein Punkt naeher als 30 cm an einem nicht benachbarten
  // Abschnitt. Die Challenge-Strecken erfuellen beides ("kreuzungsfrei, Bahnen > 30 cm
  // auseinander") - die Pruefung oben gibt sie alle als gueltig aus.
  // Ein Kandidat ist erst gut, wenn er STRENG schliesst (siehe TRACK_SCHLUSS_STRENG_CM) und
  // kreuzungsfrei ist. Die eine Stelle, an der der Zufallsknopf eine Strecke annimmt.
  // Der Zufallsknopf soll kein Mini-Oval bauen (SR3GR3 und sein Spiegelbild SL3GL3): nur
  // drei Kurven, eine Gerade, drei Kurven - kurz, symmetrisch und langweilig.
  function trackLangweilig(tiles) {
    const c = trackToCode(tiles, 0);
    return c === 'SR3GR3' || c === 'SL3GL3';
  }
  function trackZufallPasst(tiles) {
    if (trackLangweilig(tiles)) return false;
    if (!trackEndeNah(tiles)) return false;
    const pts = trackCenterline(tiles);
    const s = trackSchluss(pts);
    return s.closed && s.lueckeCm <= TRACK_SCHLUSS_STRENG_CM && trackKreuzungsfrei(pts);
  }
  // Passt die Strecke in den angegebenen Raum? Die Strecke darf in 45°-Schritten gedreht
  // werden, deshalb wird jede der 8 Lagen geprueft. Rueckgabe: die passende Drehung in Grad
  // (0, 45, ...) oder -1, wenn keine Lage in den Raum passt. Die Drehung ist dieselbe wie
  // trackRotationDeg (Startkurs), sodass man die Strecke direkt in die passende Lage drehen kann.
  function trackZufallPasstRaum(tiles) {
    const r = teileRaum();
    const raumX = r.x * 100, raumY = r.y * 100;  // cm
    // 0 x 0 (oder eine Achse 0): keine Begrenzung in dieser Richtung. Beide 0: gar keine.
    if (raumX <= 0 && raumY <= 0) return 0;
    const pts = trackCenterline(tiles);
    for (let step = 0; step < 8; step++) {
      const rad = step * 45 * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        const x = p.x * cos - p.y * sin;
        const y = p.x * sin + p.y * cos;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const passtX = raumX <= 0 || (maxX - minX) / TRACK_UNITS_PER_CM <= raumX;
      const passtY = raumY <= 0 || (maxY - minY) / TRACK_UNITS_PER_CM <= raumY;
      if (passtX && passtY) return step * 45;
    }
    return -1;
  }
  // =========================================================================
  // Zufallsstrecke: frei zusammenbauen statt "zwei Haelfte".
  //
  // Der Wochenstrecken-Mockup (mockup/wochenstrecken.html) baut JEDE Folge von
  // Kurvenlaeufen, deren Drehungen sich zu +360 addieren, und loest dann die Laengen der
  // Geradenstuecke, damit der Ring schliesst. Genau das wird hier nachgebaut: statt des
  // starren S + A + G^m + B + G^(m-1) (A und B je netto 180) entsteht ein "Rueckgrat" aus
  // beliebigen Kurvenlaeufen (netto +360 oder -360), und die Geradenluecken werden linear
  // geloest.
  //
  // DIE ENDPOSITION IST LINEAR IN DEN GERADENLUECKEN. Jede Gerade verschiebt um einen
  // festen Vektor (Richtung = Kurs vor der Luecke, Kurven aendern den Kurs, Geraden nicht);
  // Kurven verschieben unabhaengig von den Luecken. Also ist
  //
  //     Ende = C + Summe( luecke[g] * v_g )
  //
  // mit C = Verschiebung aller Kurven plus der Start-Kachel (selbst eine Gerade). Ein kleines
  // ganzzahliges Suchen ueber luecke[g] in 0..maxg findet den Schluss, OHNE fuer jeden
  // Kandidaten die teure trackCenterline() zu rechnen - die macht erst die Endabnahme.
  //
  // Die Kurventypen sind die des Mockups (R/L/W/Q/H/J); die "kleine" 30-Grad-Kurve (K/M)
  // kommt in den 80 Wochenstrecken nicht vor und bleibt deshalb aussen vor.

  // Eine zufaellige Aufteilung von dir*360 auf nc Kurvenlaeufe, jeder ein Vielfaches von 30.
  // `schritt` (v0.9.13): 60, wenn keine 30-Grad-Teile im Bestand sind - sonst wuerden Laeufe von
  // 90 oder 150 Grad gewuerfelt, die sich aus 60-Grad-Kurven nicht bauen lassen (gemessen: drei
  // Viertel der Versuche scheiterten daran).
  function trackZufallRunTurns(dir, nc, schritt) {
    const st = schritt || 30;
    let rem = dir * 360;
    const turns = [];
    for (let i = 0; i < nc - 1; i++) {
      const left = nc - 1 - i;
      const lo = st, hi = rem - left * st;
      if (hi < lo) return null;
      const choices = [];
      for (let v = lo; v <= hi; v += st) choices.push(v);
      const v = choices[Math.floor(Math.random() * choices.length)];
      turns.push(v);
      rem -= v;
    }
    if (Math.abs(rem) < st) return null;
    turns.push(rem);
    if (Math.random() < 0.5) {
      for (let i = turns.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [turns[i], turns[j]] = [turns[j], turns[i]];
      }
    }
    return turns;
  }

  // GEGENLAUF (v0.9.13). GEMELDET: "Streckeneditor: Haarnadelkurven (links-rechts) folgen immer
  // aufeinander." Alle Laeufe drehten bisher in Fahrtrichtung (Summe +-360); eine Gegen-Haarnadel
  // kam deshalb nur ueber die Schikane H+J vor - und die steht immer am Stueck. Jetzt wird oft
  // ein eigener Lauf GEGEN die Fahrtrichtung eingesetzt (180 Grad, wenn die passende Haarnadel
  // da ist, sonst 60 oder 120), und ein anderer Lauf dreht um denselben Betrag mehr. Wo er
  // steht, entscheidet das Mischen - die beiden Haarnadeln liegen dann getrennt.
  function trackZufallGegenlauf(turns, dir, b) {
    if (Math.random() < 0.15) return;
    const gegenNadel = dir > 0 ? TILE_TYPE.HAIRPIN_LEFT : TILE_TYPE.HAIRPIN;
    const gegenKurve = dir > 0 ? [TILE_TYPE.CURVE_LEFT, TILE_TYPE.WEIT_LEFT, TILE_TYPE.KLEIN_LEFT]
                               : [TILE_TYPE.CURVE_RIGHT, TILE_TYPE.WEIT_RIGHT, TILE_TYPE.KLEIN_RIGHT];
    const nGegen = gegenKurve.reduce((a, t) => a + Math.max(0, +b[t] || 0), 0);
    let m = 0;
    if ((+b[gegenNadel] || 0) > 0 && Math.random() < 0.9) m = 180;
    else if (nGegen > 0) m = nGegen >= 2 && Math.random() < 0.4 ? 120 : 60;
    if (!m) return;
    // Ein eigener Ausgleichslauf (+m, mit 180 meist die gleichsinnige Haarnadel) und der
    // Gegenlauf (-m), moeglichst NICHT nebeneinander (auch nicht ueber das Rundenende).
    const plusPos = Math.floor(Math.random() * (turns.length + 1));
    turns.splice(plusPos, 0, dir * m);
    const n = turns.length + 1;
    const frei = [];
    for (let q = 0; q < n; q++) {
      // q ist die Einfuegestelle; der neue Lauf steht dann zwischen q-1 und q.
      const nachbarn = [(q - 1 + turns.length) % turns.length, q % turns.length];
      if (!nachbarn.includes(plusPos)) frei.push(q);
    }
    const q = frei.length ? frei[Math.floor(Math.random() * frei.length)] : Math.floor(Math.random() * n);
    turns.splice(q, 0, -dir * m);
  }

  // Ein Kurvenlauf, dessen Drehungen sich zu `target` addieren - nur gleichsinnige Kacheln,
  // damit der Lauf als EINE Ecke liest (wie "RRR" oder "R2" im Mockup). used/b verfolgen,
  // wie viel vom Bestand schon verbraucht ist.
  function trackZufallRun(target, used, b) {
    const same = [TILE_TYPE.CURVE_RIGHT, TILE_TYPE.WEIT_RIGHT, TILE_TYPE.HAIRPIN,
                  TILE_TYPE.KLEIN_RIGHT,
                  TILE_TYPE.CURVE_LEFT, TILE_TYPE.WEIT_LEFT, TILE_TYPE.HAIRPIN_LEFT,
                  TILE_TYPE.KLEIN_LEFT]
      .filter(t => (tileTurnDeg(t) > 0) === (target > 0) && (b[t] || 0) > (used[t] || 0));
    const avail = (t) => (b[t] || 0) - (used[t] || 0);
    const rec = (rem, lst) => {
      if (Math.abs(rem) < 1e-6) return lst.slice();
      if (lst.length >= 8) return null;
      if (Math.abs(rem) < 30) return null;
      let cands = same.filter(t => avail(t) > 0 && Math.abs(tileTurnDeg(t)) <= Math.abs(rem) + 1e-6);
      if (!cands.length) return null;
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cands[i], cands[j]] = [cands[j], cands[i]];
      }
      // Meistens aus mehreren 60/30-Teilen bauen (laenger, wie der Mockup); eine Haarnadel
      // bleibt moeglich, damit der Lauf nicht immer auf eine Kachel zusammenfällt.
      if (Math.random() < 0.45) cands.sort((a, z) => Math.abs(tileTurnDeg(z)) - Math.abs(tileTurnDeg(a)));
      else cands.sort((a, z) => (Math.abs(tileTurnDeg(a)) !== 60) - (Math.abs(tileTurnDeg(z)) !== 60));
      for (const t of cands) {
        used[t] = (used[t] || 0) + 1;
        const r = rec(rem - tileTurnDeg(t), lst.concat(t));
        if (r) return r;
        used[t]--;
      }
      return null;
    };
    return rec(target, []);
  }

  // Ein netto-0-Schikane-Lauf (H+J oder R+L oder W+Q): dreht hin und zurueck, aendert den
  // Kurs nicht, verschiebt aber die Bahn - genau die "Kerbe", die der Mockup einsetzt.
  function trackZufallWiggle(used, b) {
    const avail = (t) => (b[t] || 0) - (used[t] || 0);
    const patterns = [
      [TILE_TYPE.HAIRPIN, TILE_TYPE.HAIRPIN_LEFT],
      [TILE_TYPE.HAIRPIN_LEFT, TILE_TYPE.HAIRPIN],
      [TILE_TYPE.CURVE_RIGHT, TILE_TYPE.CURVE_LEFT],
      [TILE_TYPE.CURVE_LEFT, TILE_TYPE.CURVE_RIGHT],
      [TILE_TYPE.WEIT_RIGHT, TILE_TYPE.WEIT_LEFT],
      [TILE_TYPE.WEIT_LEFT, TILE_TYPE.WEIT_RIGHT],
      [TILE_TYPE.KLEIN_RIGHT, TILE_TYPE.KLEIN_LEFT],
      [TILE_TYPE.KLEIN_LEFT, TILE_TYPE.KLEIN_RIGHT],
      [TILE_TYPE.KLEIN_RIGHT, TILE_TYPE.WEIT_LEFT],
      [TILE_TYPE.KLEIN_LEFT, TILE_TYPE.WEIT_RIGHT],
    ];
    for (let i = patterns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [patterns[i], patterns[j]] = [patterns[j], patterns[i]];
    }
    // Die Haarnadel-Schikane (H+J am Stueck) nur noch selten (v0.9.13): die beiden Haarnadeln
    // sollen meist getrennt liegen, siehe trackZufallGegenlauf.
    const nadel = (p) => p.includes(TILE_TYPE.HAIRPIN) && p.includes(TILE_TYPE.HAIRPIN_LEFT);
    for (const p of patterns) if (!nadel(p) && p.every(t => avail(t) > 0)) return p;
    if (Math.random() < 0.1) for (const p of patterns) if (nadel(p) && p.every(t => avail(t) > 0)) return p;
    return null;
  }

  // Rueckgrat-Information: Verschiebung C der Kurven (plus Start-Kachel) und der
  // Verschiebungsvektor v_g je Geradenluecke (Kurs vor der Luecke).
  function trackZufallSpineInfo(runs) {
    let x = 0, y = 0, heading = 0;
    const headings = [0];
    const step = (tile) => {
      const turn = tileTurnDeg(tile);
      const radius = tileRadius(tile);
      if (tile === TILE_TYPE.HAIRPIN || tile === TILE_TYPE.HAIRPIN_LEFT) {
        const rad0 = heading * Math.PI / 180;
        x += Math.sin(rad0) * TRACK_HAIRPIN_LEAD;
        y -= Math.cos(rad0) * TRACK_HAIRPIN_LEAD;
      }
      const sgn = Math.sign(turn);
      const cx = x + Math.cos(heading * Math.PI / 180) * radius * sgn;
      const cy = y + Math.sin(heading * Math.PI / 180) * radius * sgn;
      const a0 = Math.atan2(y - cy, x - cx);
      const a = a0 + turn * Math.PI / 180;
      x = cx + Math.cos(a) * radius;
      y = cy + Math.sin(a) * radius;
      heading += turn;
    };
    for (const run of runs) {
      for (const t of run) step(t);
      headings.push(heading);
    }
    const vs = headings.map(h => {
      const rad = h * Math.PI / 180;
      return { x: Math.sin(rad) * TRACK_STEP, y: -Math.cos(rad) * TRACK_STEP };
    });
    return { C: { x: x + vs[0].x, y: y + vs[0].y }, headings, vs };
  }

  // Sucht die Geradenluecken (je 0..maxg), die Ende nahe 0 bringen. Bevorzugt den engsten
  // Schluss, dann die wenigsten Geraden - so entstehen die kurzen Luecken des Mockups.
  function trackZufallSolveGaps(runs, maxg, tolCm) {
    const info = trackZufallSpineInfo(runs);
    const tx = -info.C.x, ty = -info.C.y;
    const vs = info.vs;
    const n = runs.length;
    const tol = tolCm * TRACK_UNITS_PER_CM;
    let best = null;
    const rec = (g, px, py, gaps, total) => {
      if (g === n + 1) {
        const d = Math.hypot(px - tx, py - ty);
        if (d <= tol) {
          const dr = Math.round(d * 1000) / 1000;
          if (!best || dr < best.d || (dr === best.d && total < best.total)) {
            best = { d: dr, total, gaps: gaps.slice() };
          }
        }
        return;
      }
      const remaining = (n + 1 - g) * maxg * TRACK_STEP;
      if (Math.hypot(px - tx, py - ty) - remaining > tol) return;
      const vx = vs[g].x, vy = vs[g].y;
      for (let k = 0; k <= maxg; k++) {
        gaps.push(k);
        rec(g + 1, px + k * vx, py + k * vy, gaps, total + k);
        gaps.pop();
      }
    };
    rec(0, 0, 0, [], 0);
    return best ? best.gaps : null;
  }

  // Ist ueberhaupt etwas eingetragen? Leer heisst: nichts gespeichert oder alle Zaehler 0.
  function trackZufallTotalLeer(b) {
    if (!b) return true;
    for (const typ of TEILE_SORTEN) if ((+b[typ] || 0) > 0) return false;
    return true;
  }
  // Wie viele Teile des eingetragenen Bestands die Strecke NICHT nutzt. Je kleiner, desto
  // besser - die Zufallsstrecke soll moeglichst den ganzen Karton verbrauchen.
  function trackZufallRest(tiles, b) {
    const braucht = {};
    for (const t of tiles) braucht[t.type] = (braucht[t.type] || 0) + 1;
    let rest = 0;
    for (const typ of TEILE_SORTEN) {
      const hat = b && b[typ] !== undefined && b[typ] !== null ? Math.max(0, Math.floor(+b[typ])) : null;
      if (hat === null) continue;
      rest += Math.max(0, hat - (braucht[typ] || 0));
    }
    return rest;
  }
  // Fuelle eine Luecke von `units` Kachel-Laengen mit den geraden Teilen: PIT ist 2 lang,
  // ENGE und STRAIGHT sind 1 lang. Greedy, damit auch PIT/ENGE aus dem Bestand landen.
  function trackZufallFuellGap(units, verf) {
    const seq = [];
    let rem = units;
    while (rem >= 2 && verf[TILE_TYPE.PIT] > 0) { seq.push(TILE_TYPE.PIT); verf[TILE_TYPE.PIT]--; rem -= 2; }
    while (rem >= 1 && verf[TILE_TYPE.ENGE] > 0) { seq.push(TILE_TYPE.ENGE); verf[TILE_TYPE.ENGE]--; rem -= 1; }
    while (rem >= 1 && verf[TILE_TYPE.STRAIGHT] > 0) { seq.push(TILE_TYPE.STRAIGHT); verf[TILE_TYPE.STRAIGHT]--; rem -= 1; }
    return rem === 0 ? seq : null;
  }
  function trackZufallBaueTiles(runs, gaps, b) {
    const verf = {};
    for (const typ of [TILE_TYPE.STRAIGHT, TILE_TYPE.ENGE, TILE_TYPE.PIT]) {
      verf[typ] = Math.max(0, Math.floor(+b[typ] || 0));
    }
    const tiles = [{ type: TILE_TYPE.START }];
    const g0 = trackZufallFuellGap(gaps[0], verf);
    if (!g0) return null;
    for (const t of g0) tiles.push({ type: t });
    for (let ci = 0; ci < runs.length; ci++) {
      for (const t of runs[ci]) tiles.push({ type: t });
      const g = trackZufallFuellGap(gaps[ci + 1], verf);
      if (!g) return null;
      for (const t of g) tiles.push({ type: t });
    }
    return tiles;
  }
  // Keine Teile eingetragen: ein Dialog statt eines stillen Toasts, mit "Teile eingeben" und
  // "Abbrechen". BESTELLT: "If no track parts are entered, generate an error message pop up
  // saying 'Enter track parts first' with two options: enter track parts, cancel".
  function trackZufallKeineTeile() {
    if (typeof konsoleFrage !== 'function') { showHudToast(t('Erst die Streckenteile eingeben')); return; }
    konsoleFrage(t('Zufall: Keine Streckenteile'), t('Erst die Streckenteile eingeben'), [
      [t('Teile eingeben'), () => {
        if (typeof exitTrackFullscreen === 'function') exitTrackFullscreen();
        showTab('track');
        showSubpage('teile');
      }],
      [t('Abbrechen'), null],
    ]);
  }

  function trackZufall() {
    const b = teileBestand();
    if (trackZufallTotalLeer(b)) { trackZufallKeineTeile(); return false; }
    const hat = (typ) => Math.max(0, Math.floor(+b[typ] || 0));
    if (!(hat(TILE_TYPE.START) > 0)) {
      showHudToast(t('Zufall: Kein Startteil vorhanden'));
      return false;
    }
    if (hat(TILE_TYPE.STRAIGHT) + hat(TILE_TYPE.ENGE) + hat(TILE_TYPE.PIT) * 2 < 1) {
      showHudToast(t('Zufall: Nicht genug Geraden'));
      return false;
    }
    // Beste Kandidaten: einer, der nicht in den letzten Codes vorkommt (Dedup ueber ein Fenster,
    // nicht nur die letzte Strecke), einer, der nur nicht der allerletzte ist (Rueckfall, damit
    // "nicht zweimal dieselbe in Folge" trotzdem gilt), und einer, der es egal ist. Ueber viele
    // Versuche wird der mit den wenigsten ungenutzten Teilen behalten - so naehert sich die
    // Zufallsstrecke dem Ziel, den ganzen Bestand zu verbrauchen.
    let beste = null, besteAnders = null, besteGleich = null;
    let raumZuKlein = false;
    const letzte = trackZufallCodes.length ? trackZufallCodes[trackZufallCodes.length - 1] : null;
    // Wenigste uebrige Teile gewinnt; zwei Haarnadeln am Stueck zaehlen dabei wie 1,5 weitere
    // uebrige Teile (v0.9.13) - getrennte Haarnadeln gehen damit vor, ohne dass Strecken ganz
    // ohne Haarnadel kuenstlich bevorzugt werden.
    const wert = (k) => k.rest + (k.nadelPaar ? 1.5 : 0);
    const besser = (a, z) => !a || wert(z) < wert(a) || (wert(z) === wert(a) && Math.random() < 0.4);
    const startZeit = performance.now();
    const zufallSchritt = [TILE_TYPE.WEIT_LEFT, TILE_TYPE.WEIT_RIGHT, TILE_TYPE.KLEIN_LEFT, TILE_TYPE.KLEIN_RIGHT]
      .some((t) => hat(t) > 0) ? 30 : 60;
    for (let versuch = 0; versuch < 400; versuch++) {
      if (performance.now() - startZeit > 3000) break;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const r = Math.random();
      const nc = r < 0.05 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : r < 0.93 ? 4 : 5;
      const used = {};
      const turns = trackZufallRunTurns(dir, nc, zufallSchritt);
      if (!turns) continue;
      trackZufallGegenlauf(turns, dir, b);
      const runs = [];
      let gut = true;
      for (const t of turns) {
        const run = trackZufallRun(t, used, b);
        if (!run) { gut = false; break; }
        runs.push(run);
      }
      if (!gut) continue;
      // Netto-0-Schikanen einsetzen, solange welche passen: verbraucht uebrige Kurvenpaare,
      // damit die Strecke mehr vom Bestand nutzt. Jede Einsetzung muss den Schluss halten.
      for (let wi = 0; wi < 3; wi++) {
        const wig = trackZufallWiggle(used, b);
        if (!wig) break;
        const pos = Math.floor(Math.random() * (runs.length + 1));
        const test = runs.slice();
        test.splice(pos, 0, wig);
        const g = trackZufallSolveGaps(test, 3, TRACK_SCHLUSS_STRENG_CM);
        if (!g) continue;
        runs.splice(pos, 0, wig);
        for (const t of wig) used[t] = (used[t] || 0) + 1;
      }
      const gaps = trackZufallSolveGaps(runs, 3, TRACK_SCHLUSS_STRENG_CM);
      if (!gaps) continue;
      const tiles = trackZufallBaueTiles(runs, gaps, b);
      if (!tiles) continue;
      trackRotationDeg = 0;
      if (!trackZufallPasst(tiles)) continue;
      // Fussabdruck: die Strecke muss in den angegebenen Raum passen (45°-Schritte).
      const rot = trackZufallPasstRaum(tiles);
      if (rot < 0) { raumZuKlein = true; continue; }
      const rest = trackZufallRest(tiles, b);
      const code = trackToCode(tiles, 0);
      // Haarnadeln direkt nacheinander (auch ueber das Rundenende)?
      const nadel = (x) => x.type === TILE_TYPE.HAIRPIN || x.type === TILE_TYPE.HAIRPIN_LEFT;
      const nadelPaar = tiles.some((x, i) => nadel(x) && nadel(tiles[(i + 1) % tiles.length]));
      const kandidat = { tiles, rest, code, rot, nadelPaar };
      if (!trackZufallCodeKennt(code) && besser(beste, kandidat)) beste = kandidat;
      if (code !== letzte && besser(besteAnders, kandidat)) besteAnders = kandidat;
      if (besser(besteGleich, kandidat)) besteGleich = kandidat;
    }
    const wahl = beste || besteAnders;
    if (wahl) {
      trackMerken();
      currentTrackTiles = wahl.tiles;
      trackSel = null;
      trackRotationDeg = wahl.rot || 0;
      refreshTrackPreview();
      trackZufallCodeMerken(wahl.code);
      // BESTELLT: "beim zufälliger strecke wenn möglich eine Animation abspielen (max 500ms
      // lang), wie sich die strecke selbst zusammenbaut." Plus das befriedigende Klack.
      trackFertigKlang();
      const pre = $('track-preview-svg');
      if (pre) { pre.classList.remove('track-baut'); void pre.offsetWidth; pre.classList.add('track-baut'); }
      showHudToast(t('Zufällige Strecke gebaut'));
      return true;
    }
    if (besteGleich) {
      showHudToast(t('Zufall: Keine neue Variante möglich'));
      return false;
    }
    if (raumZuKlein) {
      showHudToast(t('Zufall: Raum zu klein für einen Rundkurs'));
      return false;
    }
    showHudToast(t('Zufall: Nicht genug Kurventeile für einen Rundkurs'));
    return false;
  }
  // Nur der Endpunkt der Strecke - billig, ohne die 14 Abtastungen je Kachel. Wird als
  // Vorfilter genutzt (doppelte Toleranz), damit nicht jede Kandidaten-Strecke die teure
  // trackCenterline rechnen muss. Autoritativ bleibt trackSchluss(trackCenterline(...)).
  function trackEnde(tiles) {
    let x = 0, y = 0, heading = 0;
    for (const t of tiles) {
      if (tileIsCurve(t.type)) {
        const hp = t.type === TILE_TYPE.HAIRPIN || t.type === TILE_TYPE.HAIRPIN_LEFT;
        if (hp && !t.leadEnde) {
          const rad = heading * Math.PI / 180;
          x += Math.sin(rad) * TRACK_HAIRPIN_LEAD;
          y -= Math.cos(rad) * TRACK_HAIRPIN_LEAD;
        }
        const tw = tileTurnDeg(t.type);
        const r = tileRadius(t.type);
        const rad = heading * Math.PI / 180;
        const sgn = Math.sign(tw);
        const cx = x + Math.cos(rad) * r * sgn;
        const cy = y + Math.sin(rad) * r * sgn;
        const a0 = Math.atan2(y - cy, x - cx);
        const a = a0 + tw * Math.PI / 180;
        x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
        heading += tw;
        if (hp && t.leadEnde) {
          const rad1 = heading * Math.PI / 180;
          x += Math.sin(rad1) * TRACK_HAIRPIN_LEAD;
          y -= Math.cos(rad1) * TRACK_HAIRPIN_LEAD;
        }
      } else {
        const len = t.type === TILE_TYPE.PIT ? TRACK_STEP * 2 : TRACK_STEP;
        const rad = heading * Math.PI / 180;
        x += Math.sin(rad) * len; y -= Math.cos(rad) * len;
      }
    }
    return { x, y };
  }
  function trackEndeNah(tiles) {
    const e = trackEnde(tiles);
    return Math.hypot(e.x, e.y) / TRACK_UNITS_PER_CM <= TRACK_SCHLUSS_STRENG_CM * 2;
  }
  // Kreuzt sich die Strecke, oder laufen zwei nicht benachbarte Abschnitte dichter als
  // 30 cm zusammen? Dann ueberlappt die Bahn und die Kandidaten-Strecke wird verworfen.
  function trackKreuzungsfrei(pts, minCm, gap) {
    const min = minCm || 30, gapS = gap || 40;
    const m = pts.length;
    if (m < 6) return true;
    // Kreuzung: zwei nicht benachbarte Segmente schneiden sich.
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m;
      for (let j = i + 2; j < m; j++) {
        if (i === 0 && j === m - 1) continue;
        const j1 = (j + 1) % m;
        if (segKreuz(pts[i], pts[i1], pts[j], pts[j1])) return false;
      }
    }
    // Abstand: zwei nicht benachbarte Punkte naeher als 30 cm.
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const arc = Math.min(j - i, m - (j - i));
        if (arc < gapS) continue;
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / TRACK_UNITS_PER_CM;
        if (d < min) return false;
      }
    }
    return true;
  }
  function segKreuz(a, b, c, d) {
    const d1x = b.x - a.x, d1y = b.y - a.y;
    const d2x = d.x - c.x, d2y = d.y - c.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
    const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / den;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }
  $('track-random').onclick = () => trackZufall();

  // Hier standen sechs Bindungen auf Knopf-ids, die es seit dem Umbau auf die Bildleiste
  // nicht mehr gibt (track-add-start und fuenf weitere). Sie prueften auf Vorhandensein und
  // taten deshalb nie etwas - toter Code, der wie eine Funktion aussieht. Gebaut wird mit
  // renderTrackPalette().
  // Rueckgaengig nimmt jetzt die letzte AENDERUNG zurueck (Verlauf), nicht nur das letzte
  // Teil. Start/Ziel bleibt dabei immer, weil jeder abgelegte Stand eine hatte.
  $('track-undo').onclick = () => { trackRueckgaengig(); };
  $('track-opt-linie').onclick = () => { editorSchalterUm('linie'); };
  $('track-opt-tasten').onclick = () => { editorSchalterUm('tasten'); };
  $('track-delete-sel').onclick = () => { trackTeilEntfernen(); };
  $('track-clear').onclick = () => { trackMerken(); currentTrackTiles = freshTrackTiles(); trackSel = null; refreshTrackPreview(); };

  // 45-Grad-Schritte in beide Richtungen. BESTELLT: "Ich will auch 45 Grad drehen koennen."
  // Die Teile selbst haben keine eigene Richtung - sie ergibt sich aus der Reihenfolge -,
  // gedreht wird deshalb die ganze Strecke (die Startrichtung, siehe trackCenterline).
  function rotateTrack(deltaDeg) {
    trackMerken();
    trackRotationDeg = (trackRotationDeg + deltaDeg + 360) % 360;
    refreshTrackPreview();
  }
  $('track-rotate-right').onclick = () => rotateTrack(45);
  $('track-rotate-left').onclick = () => rotateTrack(-45);
  $('track-tour').onclick = () => { if (typeof konsoleTourStart === 'function') konsoleTourStart(K_EDITOR); };
  if ($('track-edit-tour')) {
    $('track-edit-tour').onclick = async () => {
      await enterTrackFullscreen();
      if (typeof konsoleTourStart === 'function') konsoleTourStart(K_EDITOR);
    };
  }

  // MAUS UND FINGER: ein Tipp auf die Karte waehlt das naechstgelegene Teil.
  $('track-preview-svg').addEventListener('click', (e) => {
    if (!document.body.classList.contains('track-fs') || !trackEditorGeo) return;
    const svg = $('track-preview-svg').querySelector('svg');
    if (!svg || !svg.getScreenCTM) return;
    const m = svg.getScreenCTM();
    if (!m) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    const g = trackEditorGeo;
    let best = null, bestD = Infinity;
    g.pts.forEach((p) => {
      if (p.tile < 0) return;
      const dx = p.x + g.ox - q.x, dy = p.y + g.oy - q.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p.tile; }
    });
    if (best !== null && bestD < Math.pow(g.half * 3, 2)) { trackSel = best; refreshTrackPreview(); }
  });

  // TASTATUR IM EDITOR, im Erfassungslauf: die Pfeile sollen hier bauen und nicht fahren.
  window.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('track-fs')) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = (e.key || '').toLowerCase();
    const weg = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    // Tutorial offen: blaettern, schliessen.
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) {
      if (k === 'enter' || k === 'arrowright' || k === ' ') { weg(); konsoleTourWeiter(); }
      else if (k === 'arrowleft' || k === 'backspace') { weg(); konsoleTourZurueck(); }
      else if (k === 'escape') { weg(); konsoleTourZu(false); }
      return;
    }
    if (e.repeat && !['arrowleft', 'arrowright', 'q', 'e'].includes(k)) return;
    if (k === 'arrowleft') { weg(); trackEditorPad('left'); }
    else if (k === 'arrowright') { weg(); trackEditorPad('right'); }
    else if (k === 'arrowup') { weg(); trackEditorPad('up'); }
    else if (k === 'arrowdown') { weg(); trackEditorPad('down'); }
    else if (k === 'enter' || k === ' ') { weg(); trackEditorPad('confirm'); }
    else if (k === 'delete' || k === 'backspace') { weg(); trackTeilEntfernen(); }
    else if (k === 'z' || (k === 'z' && e.ctrlKey)) { weg(); trackRueckgaengig(); }
    else if (k === 'r') { weg(); rotateTrack(e.shiftKey ? -45 : 45); }
    else if (k === 'q' || k === ',') { weg(); trackAuswahlSchritt(-1); }
    else if (k === 'e' || k === '.') { weg(); trackAuswahlSchritt(1); }
    // BESTELLT: "mit noch freien tasten ... in die strecke zoomen". + / - zoomen, 0 zurueck.
    else if (k === '+' || k === '=') { weg(); trackZoom(0.1); }
    else if (k === '-') { weg(); trackZoom(-0.1); }
    else if (k === '0') { weg(); editorZoom = 1; trackZoomAnwenden(); }
    else if (k === 'h' || k === '?') { weg(); if (typeof konsoleTourStart === 'function') konsoleTourStart(K_EDITOR); }
    else if (k === 'escape') { weg(); exitTrackFullscreen(); }
  }, true);

  // Zwei-Finger-Pinch auf der Vorschau zoomen (der "w-finger touch").
  (function () {
    const host = $('track-preview-svg');
    if (!host) return;
    let a = null;
    host.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const [p1, p2] = e.touches;
        a = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      }
    }, { passive: true });
    host.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || a === null) return;
      const [p1, p2] = e.touches;
      const b = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      if (b > 0) trackZoom(Math.round((b - a) / 40 * 10) / 10);
      a = b;
    }, { passive: true });
    host.addEventListener('touchend', () => { a = null; }, { passive: true });
  })();

  function refreshTrackList() {
    const store = loadTrackStore();
    const cont = $('track-kacheln');
    if (!cont) return;
    cont.innerHTML = '';
    const keys = Object.keys(store).sort();
    if (!keys.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('Noch keine Strecken gespeichert.');
      cont.appendChild(p);
      return;
    }
    // BESTELLT: "gespeicherte strecken / strecke laden: nenne das menü 'meine strecken' und
    // stelle sie als kacheln mit vorschaubild dar statt drop down. Klick auf strecke lädt sie
    // in den Editor." Die Kacheln werden als DOM-Elemente gebaut (kein innerHTML fuer den
    // Namen), damit ein Streckenname mit Sonderzeichen die Seite nicht zerreisst.
    keys.forEach(name => {
      const eintrag = store[name];
      const wrap = document.createElement('div');
      wrap.className = 'track-kachel-wrap';
      const btn = document.createElement('button');
      btn.className = 'track-kachel';
      btn.title = t('{n} laden').replace('{n}', name);
      const vor = document.createElement('span');
      vor.className = 'track-kachel-vorschau';
      try {
        const tiles = migrateTiles((eintrag.tiles || []).slice());
        vor.innerHTML = renderTrackPreview(tiles, null, {}).html;
      } catch (e) { /* ohne Vorschau */ }
      const b = document.createElement('b');
      b.textContent = name;
      b.setAttribute('data-i18n-skip', '');
      const em = document.createElement('em');
      em.textContent = (eintrag.tiles ? eintrag.tiles.length : 0) + ' ' + t('Teile');
      em.setAttribute('data-i18n-skip', '');
      btn.appendChild(vor); btn.appendChild(b); btn.appendChild(em);
      btn.addEventListener('click', () => trackLaden(name));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'track-kachel-del';
      del.textContent = '✕';
      del.title = t('Löschen');
      // BESTELLT: "Wenn ich es zum Strecke loeschen klicke, soll noch ein 'bist du sicher?'
      // Fenster kommen."
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        konsoleFrage(t('Strecke löschen?'), t('„{n}“ wird gelöscht. Bist du sicher?').replace('{n}', name),
          [[t('Löschen'), () => trackLoeschen(name)], [t('Abbrechen'), null]]);
      });
      wrap.appendChild(btn); wrap.appendChild(del);
      cont.appendChild(wrap);
    });
  }
  // Klick auf eine Kachel laedt die Strecke in den Editor (vorher das <select>-Laden).
  function trackLaden(name) {
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
    // BESTELLT: "bei Strecken laden einen Ton abspielen, wenn die Strecke erfolgreich geladen
    // wurde" - derselbe Klack wie bei einer fertigen Strecke im Editor.
    try { trackFertigKlang(); } catch (e) { /* ohne Ton */ }
    showHudToast(t('Strecke „{n}“ geladen').replace('{n}', name));
  }
  function trackLoeschen(name) {
    const store = loadTrackStore();
    delete store[name];
    saveTrackStore(store);
    refreshTrackList();
  }
  refreshTrackList();

  // Gemeinsames Speichern fuer beide Knoepfe: "Strecke laden" und der Speichern-Knopf im
  // Editor. BESTELLT: "It should save the track like the saving function does in the load
  // track tab" - deshalb derselbe Ablauf (Store, Zeitstempel, Liste aktualisieren, log).
  function trackSpeichern(name) {
    if (!name) return;
    if (currentTrackTiles.length === 0) { alert('Keine Streckenteile vorhanden.'); return; }
    const store = loadTrackStore();
    const now = new Date().toISOString();
    store[name] = { id: name, name, tiles: currentTrackTiles, rotation: trackRotationDeg, createdAt: store[name]?.createdAt || now, updatedAt: now };
    saveTrackStore(store);
    refreshTrackList();
    log(`Strecke "${name}" gespeichert (${currentTrackTiles.length} Teile).`, 'info');
  }
  $('track-save').onclick = () => {
    const name = $('track-name').value.trim();
    if (!name) { alert('Bitte einen Namen für die Strecke eingeben.'); return; }
    trackSpeichern(name);
  };
  // Speichern im Editor (oben links): fragt nach einem Namen, schlaegt aber einen vor, wenn
  // man keinen eintippen will. BESTELLT: "Add a save button to the editor that prompts you to
  // enter a track name but if you are too lazy to enter one, provide a suggestion that sounds
  // like a real track and that I can just use to save the track. The button should be at the
  // top on the left side (so that I don't accidentally click on close instead of save)."
  $('track-save-toolbar').onclick = () => {
    if (currentTrackTiles.length === 0) { alert('Keine Streckenteile vorhanden.'); return; }
    // Eine geladene Strecke wird unter ihrem Namen vorgeschlagen (Namensfeld aus Meine Strecken).
    const geladen = ($('track-name') && $('track-name').value.trim()) || '';
    const eingabe = prompt(t('Name der Strecke'), geladen || trackNameVorschlag());
    if (eingabe === null) return; // Abbrechen
    trackSpeichern(eingabe.trim() || trackNameVorschlag());
  };
  // Ein Vorschlag, der nach einer echten Rennstrecke klingt: Orts-/Bildwort + Rennstrecken-Endung.
  const TRACK_NAME_ANFANG = ['Silver', 'Thunder', 'Apex', 'Riverside', 'Lakeside', 'Sunset',
    'Alpine', 'Crimson', 'Iron', 'Golden', 'Wild', 'Storm', 'Summit', 'Falcon', 'Meteor',
    'Comet', 'Hurricane', 'Volt', 'Turbo', 'Granite', 'Cobalt', 'Ember', 'Vortex', 'Horizon',
    'Nova', 'Phoenix', 'Dragon', 'Viper', 'Aurora', 'Beacon', 'Canyon', 'Cedar', 'Willow',
    'Monte', 'Amber', 'Sierra'];
  const TRACK_NAME_ENDUNG = ['ring', 'park', 'speedway', 'raceway', 'circuit', 'cross',
    'field', 'point', 'valley', 'berg', 'burg', 'way', 'view', 'track', 'grund'];
  function trackNameVorschlag() {
    const store = loadTrackStore();
    // Nicht mit einer schon gespeicherten Strecke kollidieren: ein versehentliches OK auf den
    // Vorschlag soll keine vorhandene Strecke ueberschreiben.
    for (let i = 0; i < 30; i++) {
      const n = TRACK_NAME_ANFANG[Math.floor(Math.random() * TRACK_NAME_ANFANG.length)]
        + TRACK_NAME_ENDUNG[Math.floor(Math.random() * TRACK_NAME_ENDUNG.length)];
      if (!Object.prototype.hasOwnProperty.call(store, n)) return n;
    }
    return TRACK_NAME_ANFANG[Math.floor(Math.random() * TRACK_NAME_ANFANG.length)]
      + TRACK_NAME_ENDUNG[Math.floor(Math.random() * TRACK_NAME_ENDUNG.length)];
  }
  refreshTrackList();

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
      // FERTIG BEI DER ZWEITEN START/ZIEL-UEBERFAHRT (v0.9.4). BESTELLT: "wenn livescan fertig,
      // dann auto anhalten". Vorher lief der Live-Scan, bis man von Hand stoppte - und schrieb
      // dabei die zweite Runde hinten an. Jetzt: Start/Ziel nach mindestens vier Teilen ist das
      // Ende der Runde; die Strecke bleibt, das Auto haelt an.
      if (bestType != null && isStartCode(bestType) && currentTrackTiles.length >= 5) {
        const auto = trackScanCar;
        refreshTrackPreview();
        stopTrackScan();
        $('track-scan-status').textContent = t('Scan fertig: {n} Teile, Runde geschlossen.').replace('{n}', currentTrackTiles.length);
        showHudToast(t('STRECKE GESCANNT: {n} TEILE').replace('{n}', currentTrackTiles.length));
        if (typeof scanAnhalten === 'function') scanAnhalten(auto || playerCar);
        try { trackFertigKlang(); } catch (err) { /* ohne Ton */ }
        return;
      }
      if (bestType != null && Object.values(TILE_TYPE).includes(bestType)) {
        currentTrackTiles.push({ type: bestType });
        refreshTrackPreview();
        $('track-scan-status').textContent = t('Scan läuft: {n} Teile (zuletzt: {t})')
          .replace('{n}', currentTrackTiles.length)
          .replace('{t}', TILE_LABEL[bestType] ? t(TILE_LABEL[bestType]) : bestType);
      } else {
        // Nicht mehr stumm: eine Kachel ohne einen einzigen echten Code ist eine Auskunft
        // und kein Nichts. Genau dieses Schweigen hat den Fehler oben verdeckt.
        trackScanSkipped++;
        const scanStatusVorlage = dropped
          ? 'Scan läuft: {n} Teile, {k} ohne lesbaren Code ({p} Pakete ohne Lesung)'
          : 'Scan läuft: {n} Teile, {k} ohne lesbaren Code';
        $('track-scan-status').textContent = t(scanStatusVorlage)
          .replace('{n}', currentTrackTiles.length)
          .replace('{k}', trackScanSkipped)
          .replace('{p}', dropped);
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
    // Der Vorlauf und der Sperrzustand gehoeren mit zurueckgesetzt: bleiben sie stehen,
    // meldet der naechste Lauf keinen Fortschritt mehr, und eine haengende Sperrflanke
    // wuerde ihn an der falschen Kachel ankern.
    learn.vorlauf = 0; learn.sperreVor = false; learn.sperreFlanke = false;
  }

  // Die Start/Ziel-Sperre des Autos, Byte 15 Bit 3 - dieselbe, aus der 70-race.js die
  // Runde zaehlt. Sie wird hier als ZWEITER ANKER gelesen: der Byte-12-Startcode ist auf
  // manchen Bahnen nie zu sehen, und dann fing der Scan gar nicht erst an.
  //
  // Gemerkt wird die steigende Flanke ueber den ganzen Kacheldurchlauf, weil die Sperre
  // rund eine Sekunde haelt und in dieser Zeit mehrere Meldungen kommen - ein Blick auf
  // den Momentanwert an der Kachelgrenze wuerde sie je nach Takt verpassen.
  function learnSperre(bytes) {
    const jetzt = (bytes[15] & 0x08) !== 0;
    if (jetzt && !learn.sperreVor) learn.sperreFlanke = true;
    learn.sperreVor = jetzt;
  }

  function learnTick(bytes) {
    if (!ghostCfg.learn) return;
    learnSperre(bytes);
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
    // Die Flanke der Sperre gilt fuer DIESE Kachelgrenze und wird danach zurueckgesetzt -
    // sonst wuerde sie an der uebernaechsten Grenze ein zweites Mal ankern.
    const sperre = learn.sperreFlanke;
    learn.sperreFlanke = false;
    if (best === null) return;
    // ZWEI ANKER, und der Ring beginnt an dem, der zuerst kommt. Der Byte-12-Startcode ist
    // der alte; die Sperre des Autos ist der zuverlaessigere, weil sie auch dort kommt, wo
    // der Code nie erkannt wird.
    const anker = sperre || isStartCode(best);
    // ---- Vor dem Anker: mitzaehlen, aber nicht mitschreiben --------------------------
    //
    // Die Teile vor dem Anker sind eine angefangene Runde; sie koennen den Ring nicht
    // schliessen und werden verworfen. Gezaehlt werden sie trotzdem, denn sie sind der
    // Beweis, dass ueberhaupt gelesen wird. Vorher war dieser Zustand STILL, und von
    // aussen sah ein Scan, der auf einen nie kommenden Startcode wartet, genauso aus wie
    // ein Scan, der gar nichts empfaengt.
    if (!learn.started) {
      if (!anker) {
        learn.vorlauf = (learn.vorlauf || 0) + 1;
        if (learn.vorlauf === 8 || learn.vorlauf === 25) {
          log('Streckenlernen: ' + learn.vorlauf + ' Teile gelesen, Start/Ziel noch nicht '
              + 'gesehen. Der Ring beginnt erst dort - einmal ueber die Start/Ziel-Gerade '
              + 'fahren.', 'info');
        }
        return;
      }
      learn.started = true;
      learn.vorlauf = 0;
      learn.seq = [{ type: TILE_TYPE.START }];
      return;
    }
    if (anker) {
      // DIE ZWEI ANKER MEINEN VERSCHIEDENE KACHELN, und das ist ein Kachelversatz wert.
      //
      //   isStartCode(best) sagt: die Kachel, die GERADE ZU ENDE ist, war Start/Ziel.
      //     Sie gehoert nicht mehr in die alte Runde, sie ist der Anfang der neuen.
      //
      //   Die Sperre steigt beim LESEN des Startmusters, also an der Kachelgrenze davor.
      //     Die Kachel, die gerade zu Ende ist, ist eine ganz normale und gehoert noch in
      //     die alte Runde - sonst fehlt sie im Ring.
      //
      // Gemessen: ohne diese Unterscheidung lernte eine Runde aus sechs Teilen nur fuenf.
      // UEBERSETZT und nicht roh: der Scanner schrieb bisher den gemeldeten Code direkt
      // als Kachelart. Fuer Gerade und Kurven ist das dasselbe, fuer Boxengasse (0x07) und
      // Engstelle (0x0a auf der Schiene) nicht - die Karte fuehrt dafuer eigene Typen,
      // weil 0x0a dort schon Start/Ziel bedeutet.
      if (sperre && !isStartCode(best)) learn.seq.push({ type: codeZuTyp(best) });
      learn.laps++;
      if (learn.seq.length >= 3) learnCommit();
      learn.seq = [{ type: TILE_TYPE.START }];
      return;
    }
    learn.seq.push({ type: best });
    // Eine Runde kann nicht beliebig lang sein. Laeuft es davon, ist die Start/Ziel-Kachel
    // nicht erkannt worden, und weiterzuzaehlen wuerde nur Unsinn ansammeln.
    if (learn.seq.length > 60) {
      log('Streckenlernen: 60 Teile ohne zweite Start/Ziel-Ueberfahrt, Lauf verworfen. '
          + 'Auf sehr langen Bahnen oder bei nicht gelesenem Startmuster kommt das vor.',
          'info');
      learnReset();
    }
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
    $('track-scan-status').textContent = t('Scan läuft: 0 Teile ({q})')
      .replace('{q}', trackScanCar ? garageLabel(trackScanCar) : 'BLE-Explorer');
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

  // ---- STRECKENSCAN AUS DER GARAGE: MIT AUTOPILOT, MIT SCHLUSSPRUEFUNG ---------------
  //
  // BESTELLT: "Streckenscan ueberarbeiten: fange mit Scan erst an, wenn auto ueber start
  // gefahren ist. Wenn es dann wieder ueber start faehrt, muss die strecke geschlossen
  // sein. Wenn nicht, dann miss noch eine runde, und pruefe wieder. Ausserdem soll
  // streckenscan ein button in der garage sein neben dem ersten auto. Es soll dann mit
  // querlage = 0 in mittlerem Tempo ueber die strecke fahren und anhalten, wenn ein
  // geschlossener Rundkurs gemessen wurde."
  //
  // EIGENE, KLEINERE ZUSTANDSMASCHINE statt learnTick() wiederzuverwenden: learnTick()
  // haengt am IMMER LAUFENDEN Hintergrundlernen (ghostCfg.learn) und uebernimmt die
  // zweite Ueberfahrt UNGEPRUEFT - genau die Pruefung, die hier verlangt ist, fehlt dort.
  // Ihre Zustaende zu teilen hiesse, das Hintergrundlernen mitten in einem Scan
  // anzuhalten oder zwei Verbraucher an einem Zustand haengen zu lassen; eine eigene,
  // kleine Maschine ist die kleinere Aenderung. trackSchluss()/trackCenterline() (siehe
  // oben) sind bereits gebaut und gemessen - genau das Werkzeug fuer "ist es ein
  // geschlossener Rundkurs".
  const garageScan = { aktiv: false, car: null, seq: [], started: false,
                       sperreVor: false, sperreFlanke: false, versuch: 0,
                       lastCount: null, votes: {} };
  const GARAGE_SCAN_VERSUCHE_MAX = 5;

  function garageScanSperre(bytes) {
    const jetzt = (bytes[15] & 0x08) !== 0;
    if (jetzt && !garageScan.sperreVor) garageScan.sperreFlanke = true;
    garageScan.sperreVor = jetzt;
  }

  function garageScanStatus(text) {
    const el = $('gar-scan-status');
    if (el) el.textContent = text;
  }

  function garageScanAbbrechen(meldung) {
    garageScan.aktiv = false;
    garageScan.car = null;
    const gehen = $('gar-scan-start'), stopp = $('gar-scan-stop');
    if (gehen) { gehen.hidden = false; gehen.disabled = false; }
    if (stopp) stopp.hidden = true;
    if (meldung) garageScanStatus(meldung);
  }

  function garageScanStart() {
    if (trackScanning) {
      alert('Der manuelle Streckeneditor-Scan läuft noch – dort zuerst stoppen.');
      return;
    }
    const car = playerCar || garage.find((c) => c.role === 'player') || garage[0];
    if (!car) { alert('Kein Auto verbunden. Erst in der Garage verbinden.'); return; }
    garageScan.aktiv = true;
    garageScan.car = car;
    garageScan.seq = [];
    garageScan.started = false;
    garageScan.sperreVor = false;
    garageScan.sperreFlanke = false;
    garageScan.versuch = 1;
    garageScan.lastCount = null;
    garageScan.votes = {};
    const gehen = $('gar-scan-start'), stopp = $('gar-scan-stop');
    if (gehen) gehen.hidden = true;
    if (stopp) stopp.hidden = false;
    garageScanStatus('Wartet auf die erste Überfahrt von Start/Ziel …');
    log('Garagenscan gestartet: ' + garageLabel(car)
        + ' fährt mit Autopilot (Querlage 0, Formationstempo), bis der Rundkurs '
        + 'geschlossen gemessen wurde.', 'info');
  }

  function garageScanStop() {
    garageScanAbbrechen('Scan abgebrochen.');
    log('Garagenscan von Hand abgebrochen.', 'info');
  }

  function garageScanTick(bytes) {
    if (!garageScan.aktiv) return;
    garageScanSperre(bytes);
    const counter = bytes[11], type = bytes[12];
    if (garageScan.lastCount === null) {
      garageScan.lastCount = counter; garageScan.votes = {}; return;
    }
    if (counter === garageScan.lastCount) {
      garageScan.votes[type] = (garageScan.votes[type] || 0) + 1;
      return;
    }
    let best = null, bestN = -1;
    for (const [t, c] of Object.entries(garageScan.votes)) {
      const ty = parseInt(t, 10);
      if (ty === 0xff || ty === TILE_OFFTRACK) continue;
      if (c > bestN) { bestN = c; best = ty; }
    }
    garageScan.lastCount = counter;
    garageScan.votes = {};
    const sperre = garageScan.sperreFlanke;
    garageScan.sperreFlanke = false;
    if (best === null) return;
    // ZWEI ANKER, dieselbe Begruendung wie bei learnTick() oben.
    const anker = sperre || isStartCode(best);
    if (!garageScan.started) {
      if (!anker) return;
      garageScan.started = true;
      garageScan.seq = [{ type: TILE_TYPE.START }];
      garageScanStatus('Scan läuft: 1 Teil (Auto fährt automatisch) …');
      return;
    }
    if (anker) {
      if (sperre && !isStartCode(best)) garageScan.seq.push({ type: codeZuTyp(best) });
      // ---- DIE SCHLUSSPRUEFUNG, und genau das ist die Bestellung -------------------
      const schluss = trackSchluss(trackCenterline(garageScan.seq));
      if (schluss.closed && garageScan.seq.length >= 3) {
        currentTrackTiles = garageScan.seq;
        refreshTrackPreview();
        const wie = 'Lücke ' + schluss.lueckeCm.toFixed(1) + ' cm, Winkel '
          + schluss.winkel.toFixed(1) + '°';
        const gescannt = garageScan.car;
        garageScanAbbrechen('Fertig: ' + garageScan.seq.length + ' Teile, Rundkurs '
          + 'geschlossen (' + wie + ').');
        if (typeof scanAnhalten === 'function') scanAnhalten(gescannt);
        showHudToast('STRECKE GESCANNT: ' + garageScan.seq.length + ' TEILE');
        log('Garagenscan fertig: ' + garageScan.seq.length + ' Teile, geschlossen (' + wie
            + ') nach ' + garageScan.versuch + ' Versuch(en).', 'info');
        return;
      }
      // NICHT GESCHLOSSEN: noch eine Runde messen, wie bestellt - statt aufzugeben.
      garageScan.versuch++;
      if (garageScan.versuch > GARAGE_SCAN_VERSUCHE_MAX) {
        garageScanAbbrechen('Abgebrochen: nach ' + GARAGE_SCAN_VERSUCHE_MAX + ' Versuchen '
          + 'schliesst die gemessene Runde nicht (zuletzt ' + garageScan.seq.length
          + ' Teile, Lücke ' + schluss.lueckeCm.toFixed(1) + ' cm). Bitte von Hand prüfen.');
        log('Garagenscan aufgegeben nach ' + GARAGE_SCAN_VERSUCHE_MAX + ' Versuchen.', 'err');
        return;
      }
      garageScanStatus('Runde ' + (garageScan.versuch - 1) + ' schliesst nicht (Lücke '
        + schluss.lueckeCm.toFixed(1) + ' cm, Winkel ' + schluss.winkel.toFixed(1)
        + '°) – miss noch eine Runde …');
      log('Garagenscan: Runde schliesst nicht (Lücke ' + schluss.lueckeCm.toFixed(1)
          + ' cm, Winkel ' + schluss.winkel.toFixed(1) + '°), Versuch ' + garageScan.versuch
          + ' von ' + GARAGE_SCAN_VERSUCHE_MAX + ' …', 'info');
      garageScan.seq = [{ type: TILE_TYPE.START }];
      return;
    }
    garageScan.seq.push({ type: best });
    if (garageScan.seq.length > 60) {
      garageScanAbbrechen('Abgebrochen: 60 Teile ohne zweite Start/Ziel-Überfahrt.');
      log('Garagenscan verworfen: 60 Teile ohne zweite Start/Ziel-Ueberfahrt.', 'err');
    }
  }

  if ($('gar-scan-start')) $('gar-scan-start').onclick = garageScanStart;
  if ($('gar-scan-stop')) $('gar-scan-stop').onclick = garageScanStop;

  // ---- Race dashboard: live battery/off-track/minimap-position/lap-timing ----
  // Battery is a rough two-point estimate (0x9b/155≈100%, 0x90/144≈75%, observed in an
  // earlier session) — not a calibrated formula, just enough for a rough gauge.
  let dashBattery = null;

  // Editor-Strecke aus der letzten Sitzung (v0.9.6).
  if (editorStreckeLaden()) { refreshTrackPreview(); if (typeof trackZoomAnwenden === 'function') trackZoomAnwenden(); }
