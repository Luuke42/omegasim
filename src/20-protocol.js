  // =========================================================================
  // Das Protokoll: was hinausgeht
  // =========================================================================
  // Das 20-Byte-Kommandopaket, die CRC-8 darueber, und die Bedeutung der Bytes, soweit
  // sie gemessen ist. Der teuerste Fund dieses Projekts steht hier: Byte 14 Bit 7
  // schaltet den Streckensensor AB, und diese App hat es zwoelf Aufzeichnungen lang
  // gesendet. Wer hier etwas aendert, aendert, was das Auto tut.
  //
  // Nach aussen braucht dieser Teil fast nichts - er ist der am leichtesten
  // herausloesbare der ganzen Datei.

  // ---- Byte 14: the light field ----
  // Decoded from an HCI snoop log (2026-08-19) in which the user switched the headlights
  // off, then on, then pressed the brake. The three states captured were 0x80, 0x82 and
  // 0x83, and crc8() below reproduces all three recorded checksums exactly (0xA4, 0x33,
  // 0xE0), which is what confirms the reading.
  const LIGHT_HEAD  = 0x02;  // bit 1 = headlights
  const LIGHT_BRAKE = 0x01;  // bit 0 = brake light

  // ---- Byte 14 Bit 7 und Bit 5: der Streckensensor ----
  // Hier stand eine Fassung lang LIGHT_BASE = 0x80, mit der Begruendung "bit 7 was set in
  // every captured packet". Das war der Fehler, der ein Dutzend Sitzungen lang jede
  // Streckenlesung verhindert hat: Bit 7 schaltet den Sensor unter dem Auto AB.
  //
  // Gemessen innerhalb EINER Aufzeichnung (btsnoop_hci_202608211949_old), nur Meldungen
  // gezaehlt, deren zuletzt gesendetes Gas mindestens 12 Stufen von der Neutralstellung
  // 0xdf abwich - das Auto fuhr also in jeder Zeile:
  //
  //     Byte 14        Meldungen   Lesungen        Kachelschritte
  //     Bit 7 gesetzt        551      0   (0 %)       0   (0 %)
  //     Bit 7 aus, Bit 5 aus 178    163  (92 %)      12   (7 %)
  //     Bit 7 aus, Bit 5 an 1194   1103  (92 %)    1033  (87 %)
  //
  // Gleiche Bahn, gleiches Auto, dieselbe Minute. Damit kann weder "das Auto stand" noch
  // "andere Bahn, anderer Tag" das Ergebnis erklaeren - genau die beiden Erklaerungen, an
  // denen die Lichthypothese vorher gescheitert ist.
  //
  // Deutung, und sie passt auf die beiden Modi der Original-App:
  //     Bit 5 (0x20) = "Auf der Bahn"  - Sensor an, und das Auto haelt sich selbst auf der
  //                                      Bahn (87 % Kachelschritte gegen 7 %)
  //     Bit 7 (0x80) = "Ohne Bahn"     - Sensor aus, Byte 12 bleibt dauerhaft 0xff
  // Bit 6 (0x40) kommt in beiden Zustaenden vor und gehoert zu etwas anderem; es bleibt 0.
  // Byte 14 waehlt die LESEART, es schaltet den Sensor nicht ab. Gemessen am 26.08. mit
  // der Original-App: ein gedrucktes Muster wird nur mit Bit 7 erkannt, mit Bit 5 nicht.
  //
  // Die alten Namen ON und OFF standen fuer eine Deutung, die zu weit ging. Beide Messungen,
  // auf die sie sich stuetzte, waren auf der ECHTEN BAHN gemacht: mit Bit 5 kamen 87 %
  // Kachelwechsel, mit Bit 7 null Lesungen in 551 Fahrmeldungen. Daraus wurde "Sensor aus" -
  // ein Schluss ueber die Fahrbahn hinaus, den die Daten nicht tragen.
  //
  // Richtig sind zwei Lesearten fuer zwei Untergruende:
  //   Bit 5  liest die Kodierung der Kunststoffschiene. Ein Blatt Papier darauf ist keine
  //          Schiene, also kommt 0x00 - genau der Befund "nur 0x00 ueber dem Ausdruck".
  //   Bit 7  liest gedruckte Muster. Auf der Schiene gibt es keine, also kommt nichts -
  //          genau die 551er-Messung.
  //
  // Die Namen sagen jetzt, was gemeint ist. Die Werte bleiben, sie sind gemessen.
  const TRACK_BIT_RAIL  = 0x20;   // Schiene lesen, und das Auto haelt sich selbst darauf
  const TRACK_BIT_PRINT = 0x80;   // gedruckte Muster lesen
  // Die alten Namen bleiben als Verweis stehen: sie stehen an vielen Stellen im Code und in
  // der Doku, und ein stiller Umbenennungsdurchlauf wuerde die Herkunft verwischen.
  const TRACK_BIT_ON  = TRACK_BIT_RAIL;
  const TRACK_BIT_OFF = TRACK_BIT_PRINT;
  // Standard: auf der Bahn. Alles, was diese App interessant macht - Rundenzeiten,
  // Streckenscan, Ghosts mit Vorausblick - haengt daran.
  let trackMode = 'on';
  function trackModeBit() { return trackMode === 'on' ? TRACK_BIT_ON : TRACK_BIT_OFF; }
  let lightBits = TRACK_BIT_ON;

  // ---- Packet-variant probe ----
  // Seven recorded sessions produced not a single track code, while a snoop of the original
  // app is full of them. The write packet at the exact moment the original app got its first
  // code is byte-for-byte the form we send, so nothing in the steady state explains it. What
  // the original app DID send and we never do:
  //   byte 10 = 0x20 (we always send 0x60)
  //   byte 14 with bit 7 clear and upper bits set: 0x02, 0x22, 0x42, 0x62
  //   bytes 16-18 = 01 04 04
  //   byte 9 independent of byte 7 (we duplicate byte 7 into it)
  // Any of those could be a mode the car has to be put into. This probe sends one variant at
  // a time and watches whether byte 12 ever leaves 0xff, which turns the question into a
  // two-minute experiment instead of another snoop capture.
  // Declared HERE because buildCommandPacket() below reads it.
  let probeOverride = null;   // e.g. { 10: 0x20 } — byte index -> value
  let probeStats = { since: 0, sent: 0, codes: 0, lastCode: null, label: '' };

  // Unregelmaessiges Flackern einer defekten Lampe, DETERMINISTISCH aus der Uhrzeit
  // gerechnet und ausdruecklich nicht aus Math.random(): ein Zufallswert je Paket haengt an
  // der Senderate, und bei 45 ms Takt ergaebe das ein gleichmaessiges Grau statt eines
  // Flackerns. Ueber Zeitabschnitte gehasht bleibt die Folge dagegen bei jeder Rate gleich.
  //
  // 70 ms je Abschnitt und eine Trefferquote von 14 % - also lange dunkle Strecken mit
  // vereinzelten kurzen Zuckungen. Ein Rechteck mit fester Periode waere ein Blinker, und
  // ein Blinker heisst am Auto etwas anderes.
  function lampFlicker(seed) {
    const bucket = Math.floor(Date.now() / 70) + seed * 977;
    return (((bucket * 2654435761) >>> 0) / 4294967296) > 0.86;
  }

  function buildCommandPacket(steerFloat, throttleFloat, lightOverride, byteOverride) {
    // Full mechanical lock. The old "Maximaler Lenkausschlag" option scaled this down to
    // 85 of 127 steps by default, i.e. the car was never asked for more than two thirds
    // of the steering it has.
    const steerDelta = Math.max(-127, Math.min(127, Math.round(steerFloat * 127)));
    const throttleDelta = Math.max(MIN_THROTTLE_DELTA, Math.min(127, Math.round(throttleFloat * 127)));
    const steerByte = steerDelta & 0xff;
    const throttleByte = (0xdf + throttleDelta) & 0xff;
    let lb = (lightOverride === undefined ? lightBits : lightOverride) & 0xff;
    // Broken lamps are masked here, at the one place every packet passes through, rather
    // than wherever lightBits happens to be assembled. A light that is out has to be out in
    // every packet, including the ones sent by the ghost driver and the probe.
    //
    // Kein hartes Aus mehr, sondern ein Wackelkontakt: ueberwiegend dunkel mit kurzen
    // Zuckungen. Die Maskierung bleibt an dieser Stelle, und dadurch gilt weiterhin, was
    // eine UND-Verknuepfung ohnehin leistet - ist das Licht gar nicht eingeschaltet, aendert
    // das Flackern nichts, weil das Bit dann so oder so nicht gesetzt ist.
    if (lightDamage.front && !lampFlicker(0)) lb &= ~LIGHT_HEAD & 0xff;
    if (lightDamage.rear && !lampFlicker(1)) lb &= ~LIGHT_BRAKE & 0xff;
    const body = [0xaf, 0x00, 0x00, 0x00, 0x00, 0x00, throttleByte, steerByte, 0x80, steerByte, 0x60, 0x00, 0x01, 0x00, lb, 0x04, 0x00, 0x00, 0x00];
    // The probe rewrites individual bytes BEFORE the checksum, so every variant still
    // carries a valid CRC — otherwise the car would simply drop the packet and the
    // experiment would look like a negative result.
    if (probeOverride) {
      for (const k in probeOverride) body[k | 0] = probeOverride[k] & 0xff;
      probeStats.sent++;
    }
    // Per-car mode bytes (a ghost in guard-rail mode). Same rule: before the checksum.
    if (byteOverride) for (const k in byteOverride) body[k | 0] = byteOverride[k] & 0xff;
    body.push(crc8(body));
    return new Uint8Array(body);
  }

  // SINGLE WRITER. Every BLE control write in the app funnels through here, and only
  // one write may be in flight at a time. Previously five independent sources wrote
  // concurrently (gamepad rAF at ~60Hz unthrottled, keyboard interval, pointer events,
  // tilt events, physics loop) with no coordination — overlapping writes produced
  // "GATT operation already in progress", were silently dropped, and the resulting
  // command gaps made the car stutter and rattle. Input handlers now only update state;
  // controlHeartbeat() below is what actually transmits, at the car's expected cadence.
  let writeInFlight = false;

  // ---- EIN Schreibvorgang, aber der NEUESTE Wert --------------------------------------
  //
  // Hier stand an zwei Stellen "if (writeInFlight) return;", und das ist der teuerste Satz
  // im ganzen Steuerweg gewesen. GEMESSEN an einem Ziel, dessen Schreibvorgang eine
  // einstellbare Zeit braucht (OMEGA_TEST.sendeUnterLast, 2,5 s je Zeile):
  //
  //       Schreibdauer     Pakete/s     Abstand
  //             5 ms         22,4        47 ms
  //            30 ms         22,4        48 ms
  //            46 ms         11,2        95 ms
  //           100 ms          7,6       142 ms
  //
  // EINE Millisekunde ueber dem Takt halbiert die Befehlsrate. Das ist keine sanfte
  // Verschlechterung, sondern eine Stufe: bei 45 ms kommt jeder Daumenbefehl durch, bei
  // 46 ms wartet jeder zweite einen ganzen Takt laenger. Genau so faellt eine gemeldete
  // "leichte Eingabeverzoegerung" an, sobald ein zweites und drittes Auto denselben
  // Funkadapter benutzen - die Rechnung hat damit nichts zu tun, die kostet 0,3 ms von 45.
  //
  // Statt zu verwerfen wird das neueste Paket GEMERKT und abgesetzt, sobald der Funk frei
  // ist. TIEFE EINS, und das ist der Punkt: ein zweites wartendes Paket ueberschreibt das
  // erste und wird nicht angehaengt. Eine Warteschlange wuerde alte Daumenstellungen
  // nachliefern, und ein verspaeteter Lenkbefehl ist schlimmer als gar keiner.
  //
  // DIE SENDERATE BLEIBT DAMIT BEGRENZT, und zwar von selbst: es geht nie ein zweiter
  // Schreibvorgang los, bevor der erste fertig ist. Mehr als 1/Schreibdauer kann also nicht
  // hinaus, und mehr als ein Paket je Takt entsteht ohnehin nicht. Was wegfaellt, ist nur
  // das Aufrunden auf ganze Takte - die Leerzeit zwischen "Funk wieder frei" und "naechster
  // Takt", und genau die war die Verzoegerung.
  //
  // GEMERKT WIRD DAS FERTIGE PAKET. Alles, was am Bauen haengt - Verbrauch, Motorton,
  // Aufnahme - ist beim Bauen schon gelaufen und darf nicht ein zweites Mal laufen.
  let wartendes = null;

  async function funkSchreiben(ziel, payload, notiz) {
    if (writeInFlight) { wartendes = { ziel, payload, notiz }; return; }
    writeInFlight = true;
    try {
      let auf = { ziel, payload, notiz };
      while (auf) {
        try {
          if (auf.ziel.properties.writeWithoutResponse) await auf.ziel.writeValueWithoutResponse(auf.payload);
          else await auf.ziel.writeValueWithResponse(auf.payload);
          if (auf.notiz) log(`WRITE ${auf.notiz}: ${bufToHex(auf.payload)}`, 'write');
        } catch (err) {
          // Abbrechen und nicht weiterschleifen: wenn die Verbindung weg ist, wirft jeder
          // Versuch, und das Wartende ist in 45 ms ohnehin durch ein frisches ersetzt.
          log('Steuer-Schreibfehler: ' + err.message, 'err');
          break;
        }
        auf = wartendes;
        wartendes = null;
      }
    } finally {
      writeInFlight = false;
      wartendes = null;
    }
  }

  async function sendControlValue(overrideSteer, overrideThrottle) {
    const steer = overrideSteer !== undefined ? overrideSteer : steerX;
    let throttle = overrideThrottle !== undefined ? overrideThrottle : throttleY;
    if (recording) {
      macro.push({ t: Date.now() - recordStartTime, steer, throttle });
    }
    // "Geschwindigkeit" setting — a simple top-speed cap applied at this single choke
    // point so every input source respects it consistently. Defaults to 1 (no effect).
    //
    // NUR nach vorn. throttle ist vorzeichenbehaftet (bis MIN_THROTTLE_DELTA = -64), und
    // der Faktor drosselte deshalb auch die BREMSE und den Rueckwaertsgang: bei 20 %
    // Hoechstgeschwindigkeit bremste das Auto mit einem Fuenftel. Das ist nicht, was ein
    // Regler namens "Geschwindigkeit" verspricht, und es fuehlte sich an, als stimme mit
    // ihm etwas nicht - was es auch tat, nur nicht in der Richtung.
    if (throttle > 0) throttle *= topSpeedScale;
    throttle *= batteryCompensationScale();
    // NUR den Verbrauch zaehlen. Die Drosselung sitzt in physicsStep(), also vor der
    // Physik - sonst zeigt der Tacho die Simulation und das Auto bekommt weniger.
    fuelTankTick(throttle);
    updateEngineSound(throttle);
    const payload = buildCommandPacket(steer, throttle);
    recWrite(payload);
    // A car given the "Steuern" role in the garage becomes the write target. Falls back to
    // the BLE explorer's selection so the developer workflow keeps working untouched.
    if (typeof playerCar !== 'undefined' && playerCar && playerCar.rx) {
      await funkSchreiben(playerCar.rx, payload, null);
      return;
    }
    const uuid = controlSelect.value;
    if (!uuid) {
      log(`(kein Ziel) steer=${steer.toFixed(2)} throttle=${throttle.toFixed(2)} bytes=${bufToHex(payload)}`, 'info');
      return;
    }
    const entry = charByUuid.get(uuid);
    if (!entry) return;
    // Die Notiz reist MIT dem Paket, nicht mit dem Aufruf: ein gemerktes Paket wird spaeter
    // geschrieben, und dann muss im Protokoll stehen, was wirklich hinausging.
    await funkSchreiben(entry.char, payload, uuid);
  }

  // Physics mode is on by default now; the loop writes its shaped output into these
  // vars and the heartbeat transmits them, instead of the loop writing to BLE itself.
  let physicsEnabled = true;
  let physOutSteer = 0, physOutThrottle = 0;

  const CONTROL_SEND_INTERVAL_MS = 45; // matches the real app's observed command cadence

  // Wann hat der Herzschlag zuletzt gefeuert? Die Ghosts richten ihre Sendezeitpunkte
  // daran aus (siehe ghostTaktSetzen in 90-ghosts.js). Hier und nicht dort, weil nur hier
  // bekannt ist, wann es war - und der Versatz wurde bis v0.5.8 vom KLICK aus gemessen,
  // was mit dieser Phase nichts zu tun hat.
  let herzschlagAt = 0;

  function controlHeartbeat() {
    herzschlagAt = performance.now();
    // The calibration runner drives its own carefully-timed sequence; stay out of its way.
    if (typeof calibRunning !== 'undefined' && calibRunning) return;
    // Safety watchdog: gamepad sampling runs on rAF, which the browser suspends while the
    // page isn't composited. If it has stalled while a pad was driving, release the
    // controls rather than letting the heartbeat re-send the last throttle value forever.
    if (padConnected && performance.now() - padLastPollTime > PAD_STALE_MS) {
      // Release only the PAD's claim, and at most once. Zeroing everything here would
      // also wipe a value the keyboard is legitimately holding.
      releaseInput(SRC.PAD);
      if (padLoopRunning) schedulePadTick(); // self-heal if the frame chain ever broke
    }
    physicsStep();
    pitLaneTick();
    let steer = physicsEnabled ? physOutSteer : steerX;
    let throttle = physicsEnabled ? physOutThrottle : throttleY;
    sendControlValue(steer, throttle);
  }
  setInterval(controlHeartbeat, CONTROL_SEND_INTERVAL_MS);

  const stickOuter = $('stick-outer'), stickInner = $('stick-inner');
  const R = 75; // usable radius for stick center travel
  let stickDragging = false;

  function setStick(nx, ny) {
    steerX = nx;
    stickInner.style.left = (75 + nx * R) + 'px';
    stickInner.style.top = (75 + ny * R * 0.0) + 'px'; // vertical fixed for steering-only stick
    $('stick-readout').textContent = `x: ${nx.toFixed(2)}`;
  }
  function stickPointer(e) {
    const rect = stickOuter.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    let dx = (e.clientX - cx) / R;
    dx = Math.max(-1, Math.min(1, dx));
    applySteerInput(SRC.MOUSE, dx);
  }
  function releaseStick() {
    stickDragging = false;
    releaseSteerInput(SRC.MOUSE);
  }
  stickOuter.addEventListener('pointerdown', (e) => { stickDragging = true; stickPointer(e); });
  window.addEventListener('pointermove', (e) => {
    if (!stickDragging) return;
    // SAFETY: if the mouse button was released outside this window/tab (e.g. alt-tab,
    // or clicking a different UI control), 'pointerup' may never fire here, leaving the
    // drag "stuck" — any later mouse movement (even while just using the keyboard) would
    // then silently inject stray steering. Verify the primary button is still actually
    // held; if not, self-heal by releasing immediately instead of trusting stale state.
    if ((e.buttons & 1) === 0) { releaseStick(); return; }
    stickPointer(e);
  });
  window.addEventListener('pointerup', () => { if (stickDragging) releaseStick(); });
  window.addEventListener('pointercancel', () => { if (stickDragging) releaseStick(); });
  window.addEventListener('blur', () => {
    if (stickDragging) releaseStick();
    // keyup does NOT fire when the window loses focus (alt-tab, clicking another app), so
    // a held ArrowUp would otherwise stay in the set and command full throttle forever
    // with the user looking somewhere else entirely.
    keys.clear();
    releaseInput(SRC.KEY);
  });

  const throttleOuter = $('throttle-outer'), throttleInner = $('throttle-inner'), throttleFill = $('throttle-fill');
  const TR = 93; // travel range in px from center
  let throttleDragging = false;

  // Set by the pit-stop state machine far below. A plain flag rather than a function that
  // reads the pit state: setThrottle(0) runs during LOAD, thousands of lines before those
  // `let` declarations are reached, and calling into them from here aborts the whole IIFE in
  // the temporal dead zone. That trap has been sprung in this file more than once, so the
  // dependency is inverted instead of ordered.
  let pitThrottleLock = false;

  function setThrottle(ny) {
    // Wheels off: the request is dropped rather than damped, and the pedal snaps back to
    // zero so the display does not show a throttle the car is not getting.
    if (pitThrottleLock && -ny > 0) { ny = 0; }
    throttleY = -ny; // up = positive
    const topPx = 93 + ny * TR;
    throttleInner.style.top = topPx + 'px';
    if (ny < 0) {
      throttleFill.style.bottom = '50%';
      throttleFill.style.height = (-ny * TR) + 'px';
    } else {
      throttleFill.style.bottom = (50 - ny * TR / 220 * 100) + '%';
      throttleFill.style.height = (ny * TR) + 'px';
    }
    $('throttle-readout').textContent = `y: ${throttleY.toFixed(2)}`;
  }

  // Logical-space setter (forward = positive), for input sources that already think in
  // "throttle" terms rather than screen coordinates: gamepad, keyboard, macro playback.
  // setThrottle() above takes SCREEN-space (down = positive) because it was written for
  // the mouse-drag slider — passing a logical value straight into it silently inverts
  // the direction, which is exactly why gamepad throttle used to drive the car backwards.
  function setThrottleLogical(v) {
    setThrottle(-v);
  }

