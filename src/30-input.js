  // =========================================================================
  // Eingabe: wer darf steuern, und was wird mitgeschrieben
  // =========================================================================
  // Vorrang zwischen Tastatur, Gamepad, Beruehrung und Neigung, die
  // Telemetrie-Aufnahme und die Tastenkuerzel. Die Tasten sind absichtlich
  // vollstaendig: was das Pad kann, muss auch die Tastatur koennen, sonst laesst sich
  // die halbe App ohne angestecktes Pad nicht pruefen.

  // ---- Input arbitration ----
  // Five sources (keyboard, gamepad, mouse stick/slider, phone tilt, macro playback) all
  // write the same steerX/throttleY. Rule: a source writes only while it is actually
  // deflected, plus EXACTLY ONCE on the falling edge back to neutral. An idle source is
  // silent, so it cannot stomp the source the user is really holding — while a released
  // source still reliably returns to zero.
  //
  // This is why the keyboard stopped working once a pad was connected: pollGamepad wrote
  // 0/0 on every animation frame (~60Hz) while the keyboard interval writes at ~33Hz, so
  // the idle pad simply overwrote every keypress within one frame.
  //
  // Arbitrated PER AXIS because some sources own only one: the mouse stick and the phone
  // tilt steer only, the mouse slider throttles only.
  const SRC = { KEY: 'key', PAD: 'pad', MOUSE: 'mouse', TILT: 'tilt', MACRO: 'macro' };
  const INPUT_NEUTRAL_EPS = 0.001;
  const steerClaim = Object.create(null);
  const throttleClaim = Object.create(null);

  function playbackLocked(source) {
    return typeof playing !== 'undefined' && playing && source !== SRC.MACRO;
  }

  function applySteerInput(source, value) {
    if (playbackLocked(source)) return; // playback is an explicit hands-off mode
    const live = Math.abs(value) > INPUT_NEUTRAL_EPS;
    if (!live && !steerClaim[source]) return;
    steerClaim[source] = live;
    setStick(live ? value : 0, 0);
  }

  // Takes a LOGICAL throttle (forward positive), same convention as setThrottleLogical().
  function applyThrottleInput(source, value) {
    if (playbackLocked(source)) return;
    const live = Math.abs(value) > INPUT_NEUTRAL_EPS;
    if (!live && !throttleClaim[source]) return;
    throttleClaim[source] = live;
    setThrottleLogical(live ? value : 0);
  }

  function releaseSteerInput(source) {
    if (!steerClaim[source]) return;
    steerClaim[source] = false;
    setStick(0, 0);
  }
  function releaseThrottleInput(source) {
    if (!throttleClaim[source]) return;
    throttleClaim[source] = false;
    setThrottleLogical(0);
  }
  function releaseInput(source) { releaseSteerInput(source); releaseThrottleInput(source); }

  function releaseAllInputs() {
    for (const k in steerClaim) steerClaim[k] = false;
    for (const k in throttleClaim) throttleClaim[k] = false;
    setStick(0, 0);
    setThrottle(0);
  }

  function throttlePointer(e) {
    const rect = throttleOuter.getBoundingClientRect();
    const cy = rect.top + rect.height / 2;
    let dy = (e.clientY - cy) / TR;
    dy = Math.max(-1, Math.min(1, dy));
    // Convert screen-space to logical here so there is exactly one arbiter, in one
    // coordinate convention (mirrors what setThrottleLogical does internally).
    applyThrottleInput(SRC.MOUSE, -dy);
  }
  throttleOuter.addEventListener('pointerdown', (e) => { throttleDragging = true; throttlePointer(e); });
  function releaseThrottleDrag() {
    if (!throttleDragging) return;
    throttleDragging = false;
    releaseThrottleInput(SRC.MOUSE);
  }
  window.addEventListener('pointermove', (e) => {
    if (!throttleDragging) return;
    // Same stuck-drag self-heal the steering stick already had: releasing the button
    // outside the window never fires pointerup here, and stray THROTTLE is worse than
    // stray steering.
    if ((e.buttons & 1) === 0) { releaseThrottleDrag(); return; }
    throttlePointer(e);
  });
  window.addEventListener('pointerup', releaseThrottleDrag);
  window.addEventListener('pointercancel', releaseThrottleDrag);

  setStick(0, 0);
  setThrottle(0);



  // ---- Packet-variant probe wiring ----
  const PROBE_VARIANTS = {
    off:     { label: 'normal', bytes: null },
    b10:     { label: 'Byte 10 = 0x20', bytes: { 10: 0x20 } },
    b14_02:  { label: 'Byte 14 = 0x02', bytes: { 14: 0x02 } },
    b14_22:  { label: 'Byte 14 = 0x22', bytes: { 14: 0x22 } },
    b14_42:  { label: 'Byte 14 = 0x42', bytes: { 14: 0x42 } },
    b14_62:  { label: 'Byte 14 = 0x62', bytes: { 14: 0x62 } },
    // Die Gegenprobe zum Scheinwerfer-Befund. Alle Varianten darueber haben Bit 1 GESETZT
    // (0x22 = 0x20|0x02 und so weiter), testen also nur die oberen, unentschluesselten Bits
    // ZUSAETZLICH zum Licht. Diese vier haben Bit 1 ausdruecklich CLEAR: kommt damit ein
    // Streckencode, hat der Sensor eine eigene Beleuchtung mit eigenem Bit, und sichtbares
    // Licht laesst sich unabhaengig schalten. Kommt keiner, haengen beide am selben Bit und
    // "Licht aus" heisst zwangslaeufig "keine Streckenlesung".
    b14_20:  { label: 'Licht AUS + Bit 5 (0x20)', bytes: { 14: 0x20 } },
    b14_40:  { label: 'Licht AUS + Bit 6 (0x40)', bytes: { 14: 0x40 } },
    b14_60:  { label: 'Licht AUS + Bit 5+6 (0x60)', bytes: { 14: 0x60 } },
    b14_a0:  { label: 'Licht AUS + Bit 7+5 (0xa0)', bytes: { 14: 0xa0 } },
    tail:    { label: 'Byte 16-18 = 01 04 04', bytes: { 16: 0x01, 17: 0x04, 18: 0x04 } },
    b9:      { label: 'Byte 9 = +-127', bytes: { 9: 0x7f } },
    combo:   { label: '0x20 + 0x62 + 01 04 04',
               bytes: { 10: 0x20, 14: 0x62, 16: 0x01, 17: 0x04, 18: 0x04 } },
    // From the guard-rail capture: bit 5 of byte 14 is the mode, and bytes 16-18 carry the
    // three-tile lookahead. Byte 10 = 0x30 came with it but is not the gate for code
    // reporting - 0x60 produced 463 codes in the capture of 19:21.
    rail:    { label: 'Leitplanke: Byte 14 Bit 5', bytes: { 14: LIGHT_HEAD | 0x20 } },
    raillook:{ label: 'Bit 5 + Vorausblick 01 04 04',
               bytes: { 14: LIGHT_HEAD | 0x20, 16: 0x01, 17: 0x04, 18: 0x04 } },
    rail10:  { label: 'nur Byte 10 = 0x30', bytes: { 10: 0x30 } },
    // What the app writes to its OWN ghosts: byte 10 = 0x20 and byte 15 bit 3.
    auto:    { label: 'Autonom: b10=0x20, b15=0x0c, Bit 5',
               bytes: { 10: 0x20, 14: LIGHT_HEAD | 0x20, 15: 0x0c } },
  };

  // Knoepfe aus der Variantenliste. Eine Quelle, nicht zwei.
  function renderProbeButtons() {
    const host = $('probe-status');
    if (!host || !host.parentElement) return;
    const bar = host.previousElementSibling;
    if (!bar) return;
    bar.innerHTML = '';
    for (const [key, v] of Object.entries(PROBE_VARIANTS)) {
      const b = document.createElement('button');
      b.dataset.probe = key;
      b.textContent = v.label;
      if (key === 'off') b.classList.add('primary');
      bar.appendChild(b);
    }
  }

  function setProbe(key) {
    const v = PROBE_VARIANTS[key];
    if (!v) return;
    probeOverride = v.bytes;
    probeStats = { since: Date.now(), sent: 0, codes: 0, lastCode: null, label: v.label };
    document.querySelectorAll('button[data-probe]').forEach(b =>
      b.classList.toggle('primary', b.dataset.probe === key));
    updateProbeStatus();
    log(`Paketvariante: ${v.label}`, 'info');
  }

  renderProbeButtons();

  function updateProbeStatus() {
    const el = $('probe-status');
    if (!el) return;
    if (!probeOverride) { el.textContent = 'keine Variante aktiv (normales Paket)'; return; }
    const secs = ((Date.now() - probeStats.since) / 1000).toFixed(0);
    el.textContent = `${probeStats.label}, ${secs} s, ${probeStats.sent} Pakete gesendet, `
      + `Mustercodes empfangen: ${probeStats.codes}`
      + (probeStats.lastCode !== null
         ? ` (zuletzt 0x${probeStats.lastCode.toString(16).padStart(2,'0')})` : '');
    el.style.color = probeStats.codes > 0 ? 'var(--good)' : '';
  }

  document.querySelectorAll('button[data-probe]').forEach(b => {
    b.onclick = () => setProbe(b.dataset.probe);
  });
  setInterval(updateProbeStatus, 500);


  // ===================== Telemetry recorder =====================
  // Why this exists: the btsnoop logs were hard to use, not because the data was bad but
  // because nothing in them said WHEN the driver did what. Pairing writes to notifies by
  // timestamp worked, but every interpretation still rested on guessing which stretch of the
  // log was which manoeuvre. Here the section markers are IN the file.
  //
  // Cost per packet is one array push, so the 45 ms send cadence is untouched. A hard row
  // cap keeps a forgotten recording from eating the tab.
  const REC_MAX_ROWS = 400000;   // ~2.5 hours at 44 rows/s
  const REC_SECTIONS = [
    'Gerade: links',
    'Gerade: mitte',
    'Gerade: rechts',
    'Linkskurve',
    'Rechtskurve',
    'Haarnadel',
    'von der Bahn',
    'Boxengassen-Muster',
    'still stehen',
    'aufheben/absetzen',
  ];
  const rec = { on: false, rows: [], t0: 0, next: 0 };

  function recRow(dir, name, bytes, note) {
    if (!rec.on) return;
    if (rec.rows.length >= REC_MAX_ROWS) { recStop(); log('Aufnahme: Zeilengrenze erreicht, gestoppt.', 'err'); return; }
    rec.rows.push({ t: Math.round(performance.now() - rec.t0), dir, name,
                    b: bytes ? Array.from(bytes) : null, note: note || '' });
  }
  function recNotify(bytes, name) { recRow('rx', name || 'Spielerauto', bytes); }
  function recWrite(bytes, name) { recRow('tx', name || 'Spielerauto', bytes); }

  function recMark(label) {
    if (!rec.on) { showHudToast('Keine Aufnahme läuft'); return; }
    recRow('mark', '', null, label);
    log(`Aufnahme-Markierung: ${label}`, 'info');
    showHudToast('Markiert: ' + label);
    renderRecMarks();
    recStatus();
  }

  function renderRecMarks() {
    const wrap = $('rec-marks');
    if (!wrap) return;
    wrap.innerHTML = '';
    REC_SECTIONS.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${i + 1}. ${label}`;
      // Green once used, so a long session does not lose track of what is still missing.
      if (rec.rows.some(r => r.dir === 'mark' && r.note === label)) b.className = 'done';
      b.onclick = () => { rec.next = i + 1; recMark(label); };
      wrap.appendChild(b);
    });
  }

  function recStatus() {
    const el = $('rec-status');
    if (!el) return;
    if (!rec.on && !rec.rows.length) { el.textContent = 'keine Aufnahme'; return; }
    const secs = rec.rows.length ? (rec.rows[rec.rows.length - 1].t / 1000).toFixed(0) : 0;
    const marks = rec.rows.filter(r => r.dir === 'mark').length;
    el.textContent = `${rec.on ? 'läuft' : 'gestoppt'}, ${rec.rows.length} Zeilen, `
                   + `${secs} s, ${marks} Markierungen`;
    $('rec-badge-text').textContent = `Aufnahme ${secs}s · ${marks} Mark.`;
  }

  function recStart() {
    rec.on = true; rec.rows = []; rec.t0 = performance.now(); rec.next = 0;
    $('rec-start').disabled = true; $('rec-stop').disabled = false; $('rec-csv').disabled = true;
    $('rec-badge').classList.add('on');
    renderRecMarks(); recStatus();
    log('Telemetrie-Aufnahme gestartet.', 'info');
  }
  function recStop() {
    rec.on = false;
    $('rec-start').disabled = false; $('rec-stop').disabled = true;
    $('rec-csv').disabled = rec.rows.length === 0;
    $('rec-badge').classList.remove('on');
    recStatus();
    log(`Telemetrie-Aufnahme gestoppt: ${rec.rows.length} Zeilen.`, 'info');
  }

  function recExport() {
    // Raw hex AND decoded columns. The hex is the ground truth; the decoded columns make
    // the file readable in a spreadsheet without knowing the protocol, and let mistakes be
    // spotted by eye rather than only in analysis.
    const head = ['t_ms', 'richtung', 'auto', 'notiz', 'bytes_hex',
                  'rx_b1_dreh?', 'rx_b2', 'rx_b3_drehrate', 'rx_b10_akku',
                  'rx_b11_teilzaehler', 'rx_b12_mustercode', 'rx_b15_ueber_muster',
                  'tx_b6_gas', 'tx_b7_lenkung', 'tx_b14_licht'].join(';');
    const s8 = (v) => (v > 127 ? v - 256 : v);
    const lines = rec.rows.map(r => {
      const b = r.b, hex = b ? b.map(x => x.toString(16).padStart(2, '0')).join(' ') : '';
      const c = new Array(10).fill('');
      if (r.dir === 'rx' && b) {
        c[0] = s8(b[1]); c[1] = b[2]; c[2] = s8(b[3]); c[3] = b[10];
        c[4] = b[11]; c[5] = '0x' + b[12].toString(16).padStart(2, '0'); c[6] = b[15];
      } else if (r.dir === 'tx' && b) {
        c[7] = s8((b[6] - 0xdf) & 0xff); c[8] = s8(b[7]);
        c[9] = '0x' + b[14].toString(16).padStart(2, '0');
      }
      return [r.t, r.dir, r.name, r.note.replace(/;/g, ','), hex, ...c].join(';');
    });
    const csv = [head, ...lines].join('\r\n') + '\r\n';
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
    const a = document.createElement('a');
    a.href = url; a.download = `ch-telemetrie-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  $('rec-start').onclick = recStart;
  $('rec-stop').onclick = recStop;
  $('rec-csv').onclick = recExport;
  $('rec-note-add').onclick = () => {
    const v = $('rec-note').value.trim();
    if (v) { recMark(v); $('rec-note').value = ''; }
  };
  renderRecMarks();
  setInterval(() => { if (rec.on) recStatus(); }, 1000);

  // Hier stand ein Hilfefeld, das die Controller-Belegung ein zweites Mal anzeigte, sowie
  // eine ausfuehrliche Notiz darueber, warum sein Aufruf in 90-ghosts.js stehen musste.
  // Beides ist weg: die zuweisbare Tabelle in Optionen -> Controller zeigt dasselbe und
  // kann es aendern. Die Notiz war richtig und ist jetzt gegenstandslos - ein Kommentar
  // ueber eine entfernte Funktion fuehrt den naechsten Leser in die Irre.

  // ---- Keyboard control ----
  const keys = new Set();
  // Keyboard shifting, for testing without a controller: I up, K down. Edge-triggered via
  // the keydown listener rather than the polling interval, so one tap is one shift.
  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if ((k === 'i' || k === 'k') && !e.repeat && physicsEnabled && !physEngine.state.isShifting) {
      physEngine.triggerShift(k === 'i' ? 1 : -1);
    }
    if (k === 'l' && !e.repeat) triggerHeadlightFlash();
    if (k === 'w' && !e.repeat) setWeather(weather === 'rain' ? 'dry' : 'rain');
    // Test keys. Everything the pad can do should be reachable from a keyboard, otherwise
    // half the app can only be exercised with a controller plugged in.
    if (k === 'p' && !e.repeat) requestPitStop();
    if (k === 'c' && !e.repeat) { registerCrash(); showHudToast('Testcrash'); }
    if (k === 'f' && !e.repeat) { fuel = 5; updateDamageFuelUI(); showHudToast(`Tank ${fuelLiters(5)} l`); }
    if (k === 'r' && !e.repeat) { fuel = 100; damage = 0; updateDamageFuelUI();
                                  showHudToast('Tank und Zustand zurückgesetzt'); }
    // X wird jetzt GEHALTEN, siehe FLAG_HOLD_MS. Der Tastendruck startet nur den Balken;
    // ausgeloest wird er, wenn die Sekunde voll ist. !e.repeat ist dabei wichtig: eine
    // gehaltene Taste feuert keydown wiederholt, und jeder Wiederholer wuerde den Balken
    // neu starten.
    if (k === 'x' && !e.repeat) flagHoldPress();
    if (k === 'q' && !e.repeat) debugCountLap(e.shiftKey);
    if (k === 'm' && !e.repeat) {
      // Next unused section, so one key walks the whole protocol in order.
      const label = REC_SECTIONS[rec.next] || ('Markierung ' + (rec.next + 1));
      rec.next = Math.min(rec.next + 1, REC_SECTIONS.length);
      recMark(label);
    }
    if (k === '?' || (k === '/' && e.shiftKey)) { if (!e.repeat) toggleHelp(); }
    if (k === 'escape') { toggleHelp(false); hideRaceSummary(); }
  });
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys.add(e.key);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
    // Loslassen der Halten-Geste. Zu frueh losgelassen heisst ausdruecklich: nichts
    // passiert - ein halber Druck darf keine halbe Wirkung haben.
    if ((e.key || '').toLowerCase() === 'x') flagHoldRelease(false);
  });
  // Auch bei blur, sonst haengt der Balken, wenn das Fenster waehrend des Haltens den Fokus
  // verliert - und der naechste Druck waere wirkungslos, weil flagHoldStart noch belegt ist.
  window.addEventListener('blur', () => flagHoldRelease(false));

  // Keyboard state is sampled fast (the heartbeat does the actual transmitting) and is
  // not gated on which tab is visible — switching tabs used to silently kill control
  // mid-drive. The idle-suppression that used to live here (keyboardWasActive) is now
  // handled generically by applySteerInput/applyThrottleInput for every source.
  setInterval(() => {
    let sx = 0, ty = 0;
    if (keys.has('ArrowLeft')) sx -= 1;
    if (keys.has('ArrowRight')) sx += 1;
    if (keys.has('ArrowUp')) ty += 1;
    if (keys.has('ArrowDown')) ty -= 1;
    if (keys.has(' ')) { sx = 0; ty = 0; }
    applySteerInput(SRC.KEY, sx);
    applyThrottleInput(SRC.KEY, ty);
  }, 30);

  function emergencyStop() {
    keys.clear();
    releaseAllInputs();
    // Zero the simulated momentum too, otherwise the physics engine keeps feeding
    // throttle from its own virtualSpeed after the input is released.
    physEngine.reset(); // also clears reverse — an E-stop in R must not leave R selected
    physOutSteer = 0;
    physOutThrottle = 0;
    sendControlValue(0, 0);
  }

  $('btn-estop').onclick = () => {
    emergencyStop();
    log('NOTHALT ausgelöst.', 'write');
  };

  // ---- Physics/feel engine ----
  // Adapted from a user-proposed architecture. IMPORTANT DEVIATION: the original proposal
  // assumed a car-side gyro (yaw rate) fed back over BLE for counter-steering — our real
  // car's notify channel has no such telemetry (only battery/tile/off-track/counter, see
  // memory). So there is no counter-steering here; "gyro" instead means the *phone's own*
  // tilt sensor as an optional steering INPUT source, matching how the official app works.
  // Output (servoAngle/motorPWM, both -1..1) feeds straight into the existing
  // buildCommandPacket()/sendControlValue() pipeline, which already clamps to the
  // confirmed-safe reverse depth — so this layer cannot bypass that safety limit.
  // ---- GT3 drivetrain constants ----
  // Real gear ratios and top speeds of a 9000rpm naturally-aspirated GT3 racer with a
  // 6-speed sequential. The absolute speeds (82…325 km/h) are NOT used — only their
  // ratios to top gear — because the car has a configurable top speed (default 4 km/h)
  // and the feel comes from the SPACING, not the absolute numbers.
  // Simulated internal units to displayed km/h. Declared HERE, above the physics class,
  // because six places used to compute the factor by hand - the class could not reach a const
  // declared below it, so the calibration existed in six copies and any correction had to
  // find all of them.
  //
  // The number is now derived, not chosen. The cars are 1:50 models, so the display should
  // be exactly fifty times the real ground speed. Measured from the btsnoop logs: the car
  // does 1.28 km/h at throttle 0.2 and 2.46 km/h at 0.4 (n=6 and n=114 tile crossings), i.e.
  // almost exactly proportional - 2.46/1.28 = 1.92 for double the throttle - which gives
  // v = 5.9 km/h x throttle and a full-throttle speed of about 5.9 km/h. Internally full
  // throttle IS topSpeedKmh = 4.0. So:
  //
  //     REAL_SCALE = 50 x 5.9 / 4.0 = 73.75      (top speed displays as 295 km/h)
  //
  // Two honest caveats. The 5.9 is an extrapolation: no log contains a full-throttle run on
  // the track, only 0.2 and 0.4. And one constant can only be right at one operating point,
  // because the real car is linear in throttle while the simulation has aerodynamic drag -
  // the two curves have different shapes and no single factor reconciles them everywhere.
  // Anchoring at full throttle is the defensible choice, since that is where the mapping is
  // defined. The cockpit shows the measured factor live, so any drift is visible rather than
  // assumed.
  const REAL_SCALE = 50 * 5.9 / 4.0;   // 73.75

  const IDLE_RPM = 1500, REDLINE_RPM = 9000, LIMITER_SOFT_RPM = 400;
  const GT3_GEARS = [
    { ratio: 3.75, topFrac: 0.2523 }, //  82/325 — 1st tops out at ~25% of Vmax
    { ratio: 2.38, topFrac: 0.4000 }, // 130/325
    { ratio: 1.72, topFrac: 0.5538 }, // 180/325
    { ratio: 1.34, topFrac: 0.7108 }, // 231/325
    { ratio: 1.08, topFrac: 0.8800 }, // 286/325
    { ratio: 0.88, topFrac: 1.0000 }, // 325/325
  ];

  // ============================== GETRIEBEARTEN ==============================
  //
  // Drei Getriebe, und GT3 ist nicht nur die Vorgabe, sondern IDENTISCH mit vorher: der
  // Eintrag zeigt auf dasselbe Array, nicht auf eine Kopie davon.
  //
  // DIE UEBERSETZUNGEN SIND GERECHNET UND NICHT GETIPPT. In der GT3-Tabelle darueber ist
  // das Produkt ratio * topFrac fuer die Gaenge 1 bis 5 konstant 0,9507 und faellt beim
  // sechsten auf 0,88 - der ist luftwiderstandsbegrenzt und erreicht den Begrenzer nicht
  // (siehe rebuildGearModel). Diese Unsymmetrie ist echt und wird uebernommen:
  //
  //     ratio_i = 0,9507 / topFrac_i   fuer alle ausser dem letzten
  //     ratio_n = 0,88   bei topFrac_n = 1,0
  //
  // Damit bleibt ratioRef in jedem Getriebe 0,88, und der Anker der
  // Beschleunigungskalibrierung ist unberuehrt. Gewaehlt ist nur die SPREIZUNG, und dort
  // sitzt der Charakter: acht enge Gaenge oben gegen fuenf weite.
  //
  // WAS ANGABE IST: acht Vorwaertsgaenge sind seit 2014 F1-Reglement, sechs sequenzielle
  // sind GT3-Standard, fuenf hatte das Transaxle des 412P. WAS SCHAETZUNG IST: bei welchem
  // Anteil der Hoechstgeschwindigkeit der dritte Gang endet. Das ist eine Wahl aus der
  // Klasse und keine Messung.
  //
  // shiftMs ist der zweite fuehlbare Unterschied und der groessere: 40 ms nahtlos, 120 ms
  // sequenziell, 350 ms Kulisse mit Kupplung und Zwischengas.
  //
  // DIE DREHZAHLGRENZE BLEIBT BEI REDLINE_RPM. Sie ist eine Eigenschaft des MOTORS und
  // nicht des Getriebes; ein Getriebe, das die Drehzahlgrenze mitbringt, waere ein Motor
  // mit Zahnraedern. Das Getriebe aendert Anzahl, Spreizung und Schaltpunkte.
  const F1_GEARS = [
    { ratio: 3.07, topFrac: 0.3100 }, // 1. bis 31% von Vmax - hoch uebersetzt, nur zum Start
    { ratio: 2.26, topFrac: 0.4200 },
    { ratio: 1.83, topFrac: 0.5200 },
    { ratio: 1.51, topFrac: 0.6300 },
    { ratio: 1.28, topFrac: 0.7400 },
    { ratio: 1.13, topFrac: 0.8400 },
    { ratio: 1.03, topFrac: 0.9200 }, // die oberen drei liegen eng: 84, 92, 100
    { ratio: 0.88, topFrac: 1.0000 },
  ];
  const P412_GEARS = [
    { ratio: 3.17, topFrac: 0.3000 }, // 1. bis 30% - und dann ein weiter Sprung
    { ratio: 2.11, topFrac: 0.4500 },
    { ratio: 1.53, topFrac: 0.6200 },
    { ratio: 1.17, topFrac: 0.8100 },
    { ratio: 0.88, topFrac: 1.0000 },
  ];
  // downshiftRpm ist nicht frei: nach einem Hochschalten faellt die Drehzahl auf
  // upshiftRpm * ratio[i+1] / ratio[i], und liegt die Rueckschaltschwelle darueber, schaltet
  // die Automatik hoch und sofort wieder herunter. Gemessen bleibt Reserve: GT3 1385,
  // F1 915 (enge Gaenge, also knapper), 412P 2324 Umdrehungen. Ein Selbsttest haelt das fest.
  const GEARBOXES = {
    gt3: { label: 'GT3, 6-Gang sequenziell', gears: GT3_GEARS,
           upshiftRpm: 8800, downshiftRpm: 4200, shiftMs: 120 },
    // 40 ms sind die Angabe eines nahtlosen Getriebes. Angekommen ist davon nichts: das
    // sind 0,89 Sendetakte, und eine Schaltpause unter einem Paket faellt zwischen zwei
    // Takte. applyGearbox() deckelt deshalb auf den Sendetakt - die Angabe bleibt hier
    // stehen, damit man sieht, dass die Grenze beim Programm liegt und nicht beim Getriebe.
    f1: { label: 'Formel 1, 8-Gang', gears: F1_GEARS,
          upshiftRpm: 8850, downshiftRpm: 5600, shiftMs: 40 },
    p412: { label: 'Ferrari 412P, 5-Gang Transaxle', gears: P412_GEARS,
            upshiftRpm: 8600, downshiftRpm: 3400, shiftMs: 350 },
  };
  // Das Produkt, aus dem die Uebersetzungen kommen. Steht hier als Konstante, damit der
  // Selbsttest gegen dieselbe Zahl prueft, aus der sie gerechnet sind - und nicht gegen
  // eine zweite Abschrift davon.
  const GEAR_PRODUCT = 0.9507;

  // Normalised engine torque, 1.0 = peak. Deliberately a TABLE rather than a formula:
  // update(), calibrateAccel() AND the Doku charts all read it, so there must be exactly
  // one definition that cannot drift. Weak low down, peak arriving late (~6200), then
  // held nearly flat to the limiter with a slight fall-off — a naturally-aspirated
  // racing engine, not a turbo.
  const TORQUE_CURVE = [
    [1500, 0.42], [2500, 0.52], [3500, 0.62], [4500, 0.72], [5500, 0.88],
    [6200, 1.00], [7000, 0.985], [8000, 0.955], [9000, 0.90],
  ];
  function torqueAt(rpm) {
    const last = TORQUE_CURVE.length - 1;
    if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
    if (rpm >= TORQUE_CURVE[last][0]) return TORQUE_CURVE[last][1];
    for (let i = 1; i <= last; i++) {
      const [r0, t0] = TORQUE_CURVE[i - 1], [r1, t1] = TORQUE_CURVE[i];
      if (rpm <= r1) return t0 + (t1 - t0) * ((rpm - r0) / (r1 - r0));
    }
    return TORQUE_CURVE[last][1];
  }
