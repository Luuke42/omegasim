  // =========================================================================
  // Das Rennen: Armaturenbrett, Modi, Boxengasse, Wetter
  // =========================================================================
  // Rundenzaehlung, Ampel, Ergebnisse, Boxenstopp mit Plan und Uhr, Wetter und Reifen.
  //
  // Die Rundenzaehlung haengt an EINEM Signal: Byte 12 meldet die Start/Ziel-Kachel.
  // Es gibt keinen zweiten Detektor in der App, und das ist Absicht.

  let dashOnMarker = false;   // byte 15 bit 3: the car is physically over a marker
  // Vorheriger Stand des Musterkontakts, fuer die Flankenerkennung im Ausdruck-Modus.
  let dashMarkerPrev = false;
  // Debounce state for the tile code. See dashboardNotifyHandler for why both guards exist.
  const TILE_REPEAT_BLOCK_MS = 1000;
  let dashPendingCode = null, dashPendingSeen = 0;
  let dashLastActedCode = null, dashLastActedAt = 0;
  let dashMinimapIndex = null;
  // Zeitpunkt des letzten Kachelwechsels und die geglaettete Kacheldauer. Beides nur fuer
  // die Positionsschaetzung innerhalb der Kachel; sie ist eine Schaetzung und keine Messung,
  // das Auto meldet keine Position.
  let dashTileAt = 0;
  let dashTileMs = 0;
  let dashLastTileCounter = null;
  let dashLapStart = null;
  let dashLapTimes = [];
  let lastTileCode = null;
  // Raw motion-ish bytes from the notify packet. Their meaning was NEVER confirmed — an
  // earlier calibration run was inconclusive — so these are raw sensor numbers, not
  // measured G. Kept smoothed only lightly, because the noise is the honest part.
  let gyroRaw = { x: 0, y: 0, span: 8 };
  function formatLapTime(ms) { return (ms / 1000).toFixed(2) + 's'; }

  function batteryPercent(raw) {
    return Math.max(0, Math.min(100, Math.round((raw - 111) / (155 - 111) * 100)));
  }

  // Hier stand renderLapList(), und es tat nichts: es schrieb in #dash-lap-list und
  // #dash-lap-best, zwei Elemente der entfernten alten Karte. Die Rundenliste im Cockpit
  // wird von updateRaceScreen() gezeichnet.
  //
  // Eine Funktion, die an drei Stellen gerufen wird und nichts tut, ist schlimmer als keine:
  // wer den Code liest, um die Rundenliste zu finden, landet jedes Mal hier.

  // ---- Race mode: LB/L1 arms a countdown ("Ampel"), RB/R1 ends the race after the lap
  // in progress is finished. A lap counts whenever the car reports crossing the
  // start/finish tile (byte 12 == TILE_TYPE.START in the notify packet) — that byte
  // comes from the car's own sensor reading the physical start/finish pattern, so there
  // is no separate detector in the app; dashboardNotifyHandler below just also feeds it
  // into the race state machine while a race is active. ----
  let raceState = 'idle'; // idle | countdown | racing | finishing | finished
  // Die angefangene, nicht vollendete Runde beim Beenden. Sie zaehlt nicht als Runde - sonst
  // waere eine halbe Runde plotzlich eine schnelle - wird aber gezeigt, weil sonst unklar
  // bleibt, wo das Rennen aufgehoert hat.
  let racePartialMs = null;
  let raceLapStart = null;
  let raceLapTimes = []; // [{lap, ms}], oldest first; rendered newest-first
  let raceCountdownTimer = null;

  // ---- Race modes ----
  // All three end the same way: the race goes to 'finishing' and the CURRENT lap is allowed
  // to complete before the flag. A race that stops mid-lap would throw away a lap somebody
  // has already half driven.
  const RACE_MODES = {
    // `timed: false` is what makes practice different: no limit is checked, so it runs
    // until it is stopped. Everything else about it is an ordinary session — the ghosts
    // drive, laps are recorded, the results table fills.
    practice:   { label: 'Freies Training', unit: 'Minuten', timed: false,
                  hint: 'Läuft, bis du beendest.' },
    endurance:  { label: 'Endurance', unit: 'Minuten', timed: true, hint: 'Meiste Runden in der Zeit.' },
    qualifying: { label: 'Qualifying', unit: 'Minuten', timed: true, hint: 'Schnellste Einzelrunde zählt.' },
    laps:       { label: 'Runden', unit: 'Runden', timed: true, hint: 'Wer zuerst die Rundenzahl hat.' },
  };
  let raceMode = 'practice';
  let raceLimit = 2;              // minutes, or laps in 'laps' mode

  // ---- Race options: weather, mandatory stops, starting fuel ----
  let raceWxStart = 'dry';
  let raceWxChange = false;
  let raceWxSwitchAt = null;   // timestamp of the single scheduled change, null = none
  let racePitRequired = 0;
  let racePitPenaltyS = 10;
  let raceFuelStartL = FUEL_TANK_LITERS;
  let racePitDone = 0;         // completed pit services during THIS race

  // ---- Flying start ----
  // 'formation' is a fourth live state alongside countdown/racing/finishing: the cars are
  // moving and laps are NOT being counted yet. It ends when any car crosses start/finish,
  // which is what "sobald das erste Auto über Start fährt" means literally.
  let raceFlying = false;
  let raceGridOrder = [];      // device ids, first = pole
  let raceFormationLap = false;
  let raceStartedAt = null;
  let raceClockTimer = null;

  // Was in der Rundenkachel steht. Drei Faelle, und der dritte ist der Grund fuer diese
  // Funktion: bei einem Zeitlimit gibt es keine Zielrundenzahl, und eine hinzuschreiben
  // waere erfunden.
  function raceLapTarget(gefahren) {
    if (raceMode === 'laps') return gefahren + ' / ' + raceLimit;
    if (RACE_MODES[raceMode].timed && raceStartedAt !== null) {
      const restMs = Math.max(0, raceLimit * 60000 - (Date.now() - raceStartedAt));
      const s = Math.floor(restMs / 1000);
      return gefahren + ' \u00b7 ' + Math.floor(s / 60) + ':'
             + String(s % 60).padStart(2, '0');
    }
    return String(gefahren);
  }

  function raceLimitReached() {
    if (raceState !== 'racing') return false;
    if (!RACE_MODES[raceMode].timed) return false;   // free practice: only a human ends it
    if (raceMode === 'laps') {
      return raceAllCars().some(c => c.laps.length >= raceLimit);
    }
    return raceStartedAt !== null && (Date.now() - raceStartedAt) >= raceLimit * 60000;
  }

  function raceClockTick() {
    if (raceState !== 'racing') return;
    maybeSwitchRaceWeather();
    const el = $('race-clock');
    if (el) {
      if (!RACE_MODES[raceMode].timed) {
        const up = Date.now() - raceStartedAt;
        el.textContent = formatLapTime(up) + ' gefahren';
      } else if (raceMode === 'laps') {
        const best = Math.max(0, ...raceAllCars().map(c => c.laps.length));
        el.textContent = `Runde ${best} / ${raceLimit}`;   // best = vollendete Runden
      } else {
        const left = Math.max(0, raceLimit * 60000 - (Date.now() - raceStartedAt));
        el.textContent = formatLapTime(left) + ' übrig';
      }
    }
    if (raceLimitReached()) {
      raceState = 'finishing';
      $('race-status').textContent = 'Zeit/Runden erreicht, laufende Runde zählt noch';
      showHudToast('Letzte Runde');
    }
  }

  // ---- Per-car lap recording ----
  // Same two guards as the dashboard: a code must be seen twice before it is believed, and
  // an immediate repeat of start/finish is ignored. Without them a stuttering counter
  // produces phantom laps, and here it would corrupt the results table of every car.
  // The formation lap ends the moment ANY car crosses start/finish. Called from both lap
  // detectors (the player's dashboard and the per-car one) so it does not matter who gets
  // there first — including a ghost, which is the usual case.
  function endFormationLap() {
    if (!raceFormationLap) return;
    raceFormationLap = false;
    limitFormation = 1; applySpeedLimit();
    raceLapStart = Date.now();
    garage.forEach(c => { if (c.race) c.race.lapStart = Date.now(); });
    setRaceLights('go');
    playTone(1046, 0.30, 'square', 0.22);
    showHudToast('Frei, volle Fahrt!');
    log('Einführungsrunde beendet, Rennen freigegeben.', 'info');
    $('race-status').textContent = `${RACE_MODES[raceMode].label} läuft`;
    setTimeout(() => setRaceLights(0), 900);
  }

  function carRaceNotify(car, b) {
    if (!car.race) car.race = { laps: [], lapStart: null, pending: null, seen: 0,
                                lastActed: 0, lastCount: null };
    const r = car.race;
    const code = b[12], count = b[11];
    if (code !== r.pending) { r.pending = code; r.seen = 1; return; }
    if (++r.seen < 2) return;
    if (r.lastCount === null) { r.lastCount = count; return; }
    if (count === r.lastCount) return;
    r.lastCount = count;
    // isStartCode und nicht der Vergleich mit einem Wert: das Originalblatt meldet 0x0a,
    // die frueher angenommene 0x01 bleibt daneben gueltig.
    if (!isStartCode(code)) return;
    const now = Date.now();
    if (now - r.lastActed < TILE_REPEAT_BLOCK_MS) return;
    r.lastActed = now;
    carLapCrossed(car);
  }

  // Derselbe Grund wie bei playerLapCrossed(): eine Stelle, die eine Runde zaehlt, und die
  // Testtaste nimmt sie mit.
  function carLapCrossed(car) {
    if (!car.race) car.race = { laps: [], lapStart: null, pending: null, seen: 0,
                                lastActed: 0, lastCount: null };
    const r = car.race, now = Date.now();
    if (raceState !== 'racing' && raceState !== 'finishing') { r.lapStart = now; return; }
    // During the formation lap this crossing is the START of the race, not a lap.
    if (raceFormationLap) { endFormationLap(); return; }
    if (r.lapStart !== null) {
      const ms = now - r.lapStart, offs = r.offLap || 0;
      r.laps.push({ lap: r.laps.length + 1, ms, off: offs });
      // Genau hier liegen Rundenzeit und Abgangszahl zusammen vor, und beides braucht die
      // Annahmeregel des Lernens: schneller UND heil. Eine Runde ist eine Auswertung.
      learnSettle(car, ms, offs);
    }
    r.offLap = 0;
    r.lapStart = now;
  }

  // ---- Testtaste Q: eine Runde zaehlen, ohne sie zu fahren ----
  // Zum Pruefen der Rundenzaehlung, der Ergebnistabelle und des Rennendes, solange das Auto
  // keine Streckencodes liefert. Bewusst kein eigener Zaehler: Q ruft genau die Funktionen,
  // die eine echte Ueberfahrt von Start/Ziel auch ruft.
  //   Q          eine Runde fuer das gesteuerte Auto
  //   Shift+Q    eine Runde fuer JEDES Auto im Rennen, damit die Tabelle mehrspaltig wird
  function debugCountLap(all) {
    if (all) {
      const cars = garage.filter(c => c.role === 'player' || c.role === 'ghost');
      cars.forEach(c => { if (c !== playerCar) carLapCrossed(c); });
      if (playerCar) carLapCrossed(playerCar);
      playerLapCrossed();
      showHudToast('TESTRUNDE: ' + (cars.length || 1) + ' AUTO(S)');
      log('Testtaste: eine Runde fuer alle ' + cars.length + ' Autos im Rennen gezaehlt.', 'info');
      return;
    }
    if (playerCar) carLapCrossed(playerCar);
    playerLapCrossed();
    showHudToast('TESTRUNDE GEZAEHLT');
    log('Testtaste: eine Runde fuer das gesteuerte Auto gezaehlt.', 'info');
  }

  // Every car that was connected when the race started, plus the player's own lap list so a
  // session without the Garage still produces a table.
  // Farbpunkt aus einem ERGEBNISDATENSATZ. carDot() erwartet ein Auto mit Geraet, und in
  // den Ergebnissen liegen nur Datensaetze - beim Spielerauto ohne Garage sogar ohne Farbe.
  function ergDot(c) {
    return c.farbe ? '<span class="car-dot" style="background:' + c.farbe + '"></span>' : '';
  }

  function raceAllCars() {
    const out = garage.map(c => ({ name: garageLabel(c), role: c.role,
                                   farbe: carColor(c).hex, kennung: c.tag,
                                   laps: (c.race && c.race.laps) || [] }));
    if (!garage.some(c => c === playerCar) && raceLapTimes.length) {
      // Ohne Garage gibt es kein Geraet und damit keine Farbe: dann bleibt das Feld leer,
      // statt eine zu erfinden.
      out.unshift({ name: 'Spielerauto', role: 'player', farbe: null, kennung: null,
                    laps: raceLapTimes });
    }
    return out;
  }

  function raceStats(laps) {
    if (!laps.length) return null;
    const ms = laps.map(l => l.ms);
    const best = Math.min(...ms), worst = Math.max(...ms);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / ms.length);
    return { n: ms.length, best, worst, mean, sd, total: ms.reduce((a, b) => a + b, 0) };
  }

  // Generic short tone for the countdown lights, distinct from the mellow finish-line
  // chime below (this one is meant to sound crisp/urgent, like a starting signal).
  function playTone(freq, dur, type, gainPeak) {
    if (!soundEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const g = audioCtx.createGain();
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainPeak || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Der Ton an der Ziellinie. "Dueuet", nicht "Blip".
  //
  // Vorher war es ein GLEITTON von 520 auf 280 Hz ueber die ganzen 160 ms, und ein Gleitton
  // ohne stehenden Grundton hat keine Tonhoehe, die man behalten kann - er liest sich als
  // "blip" oder "wupp". Die Rundenzeit ist aber die Sache, auf die man beim Fahren hoert.
  //
  // Jetzt: ein kurzer Anlauf HINEIN (30 ms von einer Quinte darunter), dann 170 ms auf der
  // Zieltonhoehe STEHEN, dann ausklingen. Das Stehen ist der Teil, der aus einem Blip einen
  // Ton macht.
  const LAP_TONE_HZ = 392;          // G4, der Grundton der normalen Runde
  const LAP_BEST_RATIO = 1.1892;    // kleine Terz nach oben, 2^(3/12)

  // beste = true macht denselben Ton eine kleine Terz hoeher, mit einem zweiten Teilton
  // eine Oktave darueber.
  //
  // Warum eine kleine Terz und nicht irgendein Abstand: sie ist der kleinste Schritt, den
  // man ohne Vergleich als "anders" hoert, und sie klingt nach oben offen statt nach
  // Fehlermeldung. Ein groesserer Sprung waere ein Signal, und eine Bestzeit ist kein Alarm,
  // sondern eine gute Nachricht.
  //
  // Der Teilton ist LEISER als der Grundton, nicht lauter. Die Bestzeit soll heller klingen,
  // nicht lauter - lauter waere die naheliegende Wahl und die falsche.
  function playLapChime(beste) {
    if (!soundEnabled || !audioCtx) return;
    const t = audioCtx.currentTime;
    const f0 = beste ? LAP_TONE_HZ * LAP_BEST_RATIO : LAP_TONE_HZ;

    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    // Hoeher als die alten 900 Hz. Bei 900 saesse der Filter UNTER dem zweiten Teilton und
    // haette ihn weggenommen - die Bestzeit waere dann nur hoeher und nicht heller.
    lp.frequency.value = beste ? 2600 : 1600;

    // Der Spitzenpegel wird fuer die Bestzeit ABGESENKT, damit sie nicht lauter wird.
    //
    // Gemessen ohne diese Absenkung: 0,36 gegen 0,31 Spitze, also 16 Prozent lauter - der
    // zweite Teilton addiert sich eben auf. Und lauter war ausdruecklich nicht gemeint: eine
    // Bestzeit soll HELLER klingen. 0,26 bringt beide auf dieselbe Spitze, und dann bleibt
    // als Unterschied genau das, was der Unterschied sein soll - die Tonhoehe und der
    // Oberton.
    const pegel = beste ? 0.26 : 0.30;
    const summe = audioCtx.createGain();
    summe.gain.setValueAtTime(0.001, t);
    summe.gain.linearRampToValueAtTime(pegel, t + 0.03);
    summe.gain.setValueAtTime(pegel, t + 0.20);
    summe.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    summe.connect(lp).connect(audioCtx.destination);

    const stimme = (hz, pegel) => {
      const o = audioCtx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(hz / 1.5, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
      const g = audioCtx.createGain();
      g.gain.value = pegel;
      o.connect(g).connect(summe);
      o.start(t);
      o.stop(t + 0.36);
    };
    stimme(f0, 1.0);
    if (beste) stimme(f0 * 2, 0.34);
  }

  // ---- Tempolimit: eine Stelle, drei Quellen ----
  // Boxengasse, gelbe Flagge und Einfuehrungsrunde wollen alle das Tempo begrenzen, und
  // vorher schrieb jede von ihnen direkt in speedLimitFactor. Wer waehrend einer gelben
  // Phase die Box verliess, bekam dadurch wieder Vollgas: die Boxenlogik setzte auf 1
  // zurueck, ohne zu wissen, dass gerade Gelb ist. Jetzt gewinnt immer das strengste
  // Limit, und es gibt nur einen Schreiber.
  const YELLOW_KMH = 80;
  // Wie lange der Pit-Limiter hoechstens an bleibt, wenn das Ausfahrtmuster nicht gelesen
  // wird. Fuenf Sekunden sind bei Boxengassentempo etwa zwei Kacheln - lang genug, um
  // wirklich hinauszufahren, kurz genug, dass es kein verlorenes Rennen ist.
  const PIT_LIMITER_MAX_MS = 5000;
  let pitLimiterTimer = null;
  let limitPit = 1, limitYellow = 1, limitFormation = 1;
  function applySpeedLimit() {
    const f = Math.min(limitPit, limitYellow, limitFormation);
    physEngine.config.speedLimitFactor = f;
    // Die Ghosts bekommen ihr Limit nicht ueber die Physik, sondern ueber ihr Zieltempo -
    // siehe ghostTick. Hier steht nur der Wert, den sie dort lesen.
    return f;
  }
  function yellowFactor() {
    const top = physEngine.config.topSpeedKmh * REAL_SCALE;
    return Math.max(0.05, Math.min(1, YELLOW_KMH / top));
  }

  function setRaceLights(step) {
    // step: 0 = all off, 1-3 = that many reds lit (bottom to top like a real start light
    // sequence), 'go' = green.
    ['race-light-1', 'race-light-2', 'race-light-3', 'race-light-go'].forEach(id => {
      $(id).classList.remove('on-red', 'on-green');
    });
    if (step === 'go') { $('race-light-go').classList.add('on-green'); }
    else for (let i = 1; i <= step; i++) $(`race-light-${i}`).classList.add('on-red');
    paintGantry(step);
  }

  // Same state, drawn as the gantry over the cockpit. There are five columns but only three
  // countdown steps, so a step lights a proportional share rather than one column - three
  // steps over five columns is 2, 3, 5. A real FIA gantry has five one-second steps; this
  // countdown has three, and inventing two extra steps would make the lights disagree with
  // the beeps the driver is actually hearing.
  const GANTRY_COLS = [0, 2, 3, 5];
  function paintGantry(step) {
    const g = $('race-gantry');
    if (!g) return;
    const lamps = g.querySelectorAll('.gantry-lamp');
    lamps.forEach(l => l.classList.remove('red', 'green'));
    if (step === 'go') {
      // All reds out and green: that IS the start signal, on a real gantry and here.
      lamps.forEach(l => l.classList.add('green'));
      g.classList.add('on');
      return;
    }
    if (!step) { g.classList.remove('on'); return; }
    g.classList.add('on');
    const cols = GANTRY_COLS[Math.max(0, Math.min(3, step))] || 0;
    lamps.forEach(l => { if (+l.dataset.col <= cols) l.classList.add('red'); });
  }

  // Results for EVERY car that was connected, which is what was asked for and what did not
  // exist: the old table held only the player's laps.
  function renderRaceResults() {
    const cars = raceAllCars().filter(c => c.laps.length);
    const td = 'padding:5px 10px';
    const tdr = td + '; text-align:right; font-family:monospace';

    if (!cars.length) {
      $('race-results-body').innerHTML =
        `<tr><td colspan="7" style="${td}" class="muted">Keine Runden aufgezeichnet.</td></tr>`;
      return;
    }

    // Ranking depends on the mode. Endurance and Runden: most laps, then quickest to get
    // there. Qualifying: the single fastest lap, nothing else.
    const scored = cars.map(c => ({ c, st: raceStats(c.laps) }));
    scored.sort((a, b) => raceMode === 'qualifying'
      ? a.st.best - b.st.best
      : (b.st.n - a.st.n) || (a.st.total - b.st.total));

    const fastest = Math.min(...scored.map(x => x.st.best));
    $('race-results-body').innerHTML = scored.map((x, i) => {
      const st = x.st, isBest = st.best === fastest;
      return `<tr>
        <td style="${td}">${i + 1}</td>
        <td style="${td}">${ergDot(x.c)}${x.c.name}${x.c.role === 'ghost' ? ' <span class="muted">(Ghost)</span>' : ''}</td>
        <td style="${tdr}">${st.n}</td>
        <td style="${tdr}${isBest ? '; color:var(--good); font-weight:700' : ''}">${formatLapTime(st.best)}</td>
        <td style="${tdr}">${formatLapTime(Math.round(st.mean))}</td>
        <td style="${tdr}">${formatLapTime(st.worst)}</td>
        <td style="${tdr}">${(st.sd / 1000).toFixed(2)} s</td>
      </tr>`;
    }).join('');

    // Every individual lap underneath, so nothing is hidden behind an average.
    const detail = $('race-results-laps');
    if (detail) {
      const maxLaps = Math.max(...cars.map(c => c.laps.length));
      const head = '<tr style="background:var(--panel-2)"><th style="' + td + '">Runde</th>'
        + cars.map(c => `<th style="${tdr}">${ergDot(c)}${c.name}</th>`).join('') + '</tr>';
      let body = '';
      for (let k = 0; k < maxLaps; k++) {
        body += `<tr><td style="${td}">${k + 1}</td>`
          + cars.map(c => `<td style="${tdr}">${c.laps[k] ? formatLapTime(c.laps[k].ms) : '–'}</td>`).join('')
          + '</tr>';
      }
      detail.innerHTML = head + body;
    }
  }

  // One weather change per race, at a random moment in the middle third — early enough to
  // matter, late enough not to make the chosen starting weather pointless. In free practice
  // there is no known end time, so a fixed window from the start is used instead.
  function scheduleRaceWeatherChange() {
    raceWxSwitchAt = null;
    if (!raceWxChange) return;
    const total = RACE_MODES[raceMode].timed && raceMode !== 'laps'
      ? raceLimit * 60000
      : 5 * 60000;   // practice / lap races: assume a five-minute window
    raceWxSwitchAt = Date.now() + total * (0.35 + Math.random() * 0.3);
  }

  function maybeSwitchRaceWeather() {
    if (raceWxSwitchAt === null || Date.now() < raceWxSwitchAt) return;
    raceWxSwitchAt = null;   // once per race
    const next = weather === 'rain' ? 'dry' : 'rain';
    setWeather(next);
    showHudToast(next === 'rain' ? 'Es fängt an zu regnen' : 'Es trocknet ab');
    log(`Wetterwechsel im Rennen: ${next === 'rain' ? 'Regen' : 'trocken'}.`, 'info');
  }

  // Position after each lap, from CUMULATIVE time — which is what actually decides a
  // race. Ranking by lap time alone would show whoever was quickest on that single lap,
  // not who is in front, and those are different things.
  //
  // A car that has not yet completed lap k has no position on lap k: its line simply stops.
  // Inventing a value there (last place, say) would draw a fact that never happened.
  // Every one of these was a dark-theme-era colour on what is now a dark panel. Replaced
  // with a palette measured against #14161c: all six at 4.5:1 or better, and distinguishable
  // from each other rather than merely from the background.
  const RACE_PLOT_COLORS = ['#5aa9ff', '#ff5c5c', '#3ddc84', '#ffb02e', '#c08cff', '#4ad9d9'];

  function renderPositionPlot() {
    const host = $('race-position-plot');
    if (!host) return;
    const cars = raceAllCars().filter(c => c.laps.length);
    const maxLap = Math.max(0, ...cars.map(c => c.laps.length));
    if (cars.length < 1 || maxLap < 2) {
      host.innerHTML = '<p class="muted" style="margin:0">Zu wenige Runden f\u00fcr einen Verlauf '
                     + 'Ab der zweiten Runde wird hier gezeichnet.</p>';
      return;
    }

    // Cumulative time per car per lap.
    const cum = cars.map(c => {
      let t = 0;
      return c.laps.map(l => (t += l.ms));
    });
    // Position per lap: rank the cars that HAVE that lap by cumulative time.
    const pos = cars.map(() => []);
    for (let k = 0; k < maxLap; k++) {
      const present = [];
      cars.forEach((c, i) => { if (cum[i][k] !== undefined) present.push({ i, t: cum[i][k] }); });
      present.sort((a, b) => a.t - b.t);
      present.forEach((p, rank) => { pos[p.i][k] = rank + 1; });
    }

    const W = 640, H = 40 + cars.length * 6 + Math.max(120, cars.length * 26);
    const padL = 34, padR = 12, padT = 14, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const x = k => padL + (maxLap === 1 ? plotW / 2 : (k / (maxLap - 1)) * plotW);
    const y = p => padT + ((p - 1) / Math.max(1, cars.length - 1)) * plotH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px; height:auto" `
            + `role="img" aria-label="Position \u00fcber die Runden">`;
    // Horizontal guide per position, labelled on the left.
    for (let p = 1; p <= cars.length; p++) {
      svg += `<line x1="${padL}" y1="${y(p).toFixed(1)}" x2="${W - padR}" y2="${y(p).toFixed(1)}" `
           + `stroke="var(--border)" stroke-width="1"/>`
           + `<text x="${padL - 8}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end" `
           + `font-family="monospace" font-size="11" fill="var(--muted)">${p}.</text>`;
    }
    // Lap numbers along the bottom, thinned so they never collide.
    const stepK = Math.max(1, Math.ceil(maxLap / 12));
    for (let k = 0; k < maxLap; k += stepK) {
      svg += `<text x="${x(k).toFixed(1)}" y="${H - 10}" text-anchor="middle" `
           + `font-family="monospace" font-size="11" fill="var(--muted)">${k + 1}</text>`;
    }
    // One polyline per car, plus a dot on every lap it actually completed.
    cars.forEach((c, i) => {
      const col = c.farbe || RACE_PLOT_COLORS[i % RACE_PLOT_COLORS.length];
      const pts = [];
      for (let k = 0; k < maxLap; k++) {
        if (pos[i][k] === undefined) continue;
        pts.push(`${x(k).toFixed(1)},${y(pos[i][k]).toFixed(1)}`);
      }
      if (pts.length > 1) {
        svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" `
             + `stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      pts.forEach(pt => {
        const [px, py] = pt.split(',');
        svg += `<circle cx="${px}" cy="${py}" r="3" fill="${col}"/>`;
      });
    });
    svg += '</svg>';

    // Legend underneath rather than inside: names can be long and would overlap the lines.
    const legend = cars.map((c, i) =>
      `<span style="display:inline-flex; align-items:center; gap:5px; margin-right:14px">`
      + `<span style="width:12px; height:3px; background:${cars[i].farbe
           || RACE_PLOT_COLORS[i % RACE_PLOT_COLORS.length]}"></span>`
      + `<span class="muted" style="font-size:12px">${c.name}</span></span>`).join('');
    host.innerHTML = svg + `<div style="margin-top:6px">${legend}</div>`;
  }

  // The grid is stored as device ids, not as indices into `garage`: cars connect and
  // disconnect between races, and an index would silently point at a different car.
  function raceGridCars() {
    const byId = new Map(garage.map(c => [String(c.device.id), c]));
    const ordered = [];
    raceGridOrder.forEach(id => { const c = byId.get(id); if (c) { ordered.push(c); byId.delete(id); } });
    byId.forEach(c => ordered.push(c));   // newly connected cars join at the back
    return ordered;
  }

  function syncRaceGridOrder() {
    raceGridOrder = raceGridCars().map(c => String(c.device.id));
  }

  function renderRaceGrid() {
    const wrap = $('race-grid-wrap'), host = $('race-grid');
    if (!wrap || !host) return;
    wrap.style.display = raceFlying ? '' : 'none';
    if (!raceFlying) return;
    const cars = raceGridCars();
    if (!cars.length) {
      host.innerHTML = '<p class="muted" style="margin:0">Keine Autos verbunden.</p>';
      return;
    }
    host.innerHTML = '';
    cars.forEach((car, i) => {
      const row = document.createElement('div');
      row.className = 'grid-row';
      row.draggable = false;
      row.dataset.id = String(car.device.id);
      row.innerHTML = `<span class="grid-pos">${i + 1}.</span>`
        + `<span class="grid-handle" draggable="true" title="Ziehen zum Umsortieren">&#8942;&#8942;</span>`
        + `<span class="grid-name">${carDot(car)}${garageLabel(car)}</span>`
        + `<span class="grid-move">`
        + `<button data-mv="up" ${i === 0 ? 'disabled' : ''} aria-label="nach vorn">&#9650;</button>`
        + `<button data-mv="down" ${i === cars.length - 1 ? 'disabled' : ''} aria-label="nach hinten">&#9660;</button>`
        + `</span>`;
      // Arrows as well as dragging: dragging is fiddly on a phone and impossible with a
      // controller, and this list has to be usable both ways.
      row.querySelectorAll('button[data-mv]').forEach(b => {
        b.onclick = () => {
          const order = raceGridCars().map(c => String(c.device.id));
          const from = order.indexOf(row.dataset.id);
          const to = b.dataset.mv === 'up' ? from - 1 : from + 1;
          if (to < 0 || to >= order.length) return;
          order.splice(to, 0, order.splice(from, 1)[0]);
          raceGridOrder = order;
          renderRaceGrid();
        };
      });
      const handle = row.querySelector('.grid-handle');
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', row.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('over');
        const dragged = e.dataTransfer.getData('text/plain');
        if (!dragged || dragged === row.dataset.id) return;
        const order = raceGridCars().map(c => String(c.device.id));
        const from = order.indexOf(dragged), to = order.indexOf(row.dataset.id);
        if (from < 0 || to < 0) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        raceGridOrder = order;
        renderRaceGrid();
      });
      host.appendChild(row);
    });
  }

  $('race-flying').addEventListener('change', (e) => {
    raceFlying = e.target.checked;
    syncRaceGridOrder();
    renderRaceGrid();
  });

  function startRaceCountdown() {
    // launchGhosts() is called from the green-light step below, not here.
    if (raceState !== 'idle' && raceState !== 'finished') return; // ignore while armed/racing
    // EINSCHALTRAMPE: der Schirm zieht in 300 ms von schwarz auf Wert hoch, wie ein TFT beim
    // Einschalten. Hier und nicht in raceGreen(), weil der Schirm mit dem Knopfdruck
    // "angeht" und nicht erst bei Gruen - im Countdown will man ihn schon lesen.
    //
    // Die Klasse wird nach 320 ms wieder abgenommen, 20 ms nach dem Ende der Animation: sonst
    // startet sie beim naechsten Rennstart nicht neu, weil sie schon dransteht.
    {
      const schirm = $('race-dash');
      if (schirm) {
        schirm.classList.remove('gt3-warm');
        void schirm.offsetWidth;
        schirm.classList.add('gt3-warm');
        setTimeout(() => schirm.classList.remove('gt3-warm'), 320);
      }
    }
    // Starting conditions, applied before the lights: weather first, because the tyre
    // choice follows from it, then the tank, then the pit-stop counter.
    setWeather(raceWxStart);
    fuel = Math.max(0, Math.min(100, raceFuelStartL / FUEL_TANK_LITERS * 100));
    updateDamageFuelUI();
    racePitDone = 0;
    syncRaceGridOrder();
    scheduleRaceWeatherChange();
    raceLapEvents = [];
    lapEventAkku = { pit: 0, crash: 0 };
    resetTyres();   // a race starts on cold tyres, same as leaving the pits
    // Everyone starts from zero, including cars with no role: they still cross the line and
    // their times belong in the table.
    garage.forEach(c => { c.race = { laps: [], lapStart: null, pending: null, seen: 0,
                                     lastActed: 0, lastCount: null }; });
    raceLapTimes = [];
    racePartialMs = null;
    // Same moment as the lap times: on/off-track is a statistic about THIS race, and
    // carrying a previous session's minutes into it would make the share meaningless.
    trackTimeReset();
    realSpeedReset();
    learnReset();
    raceLapStart = null;
    $('race-results').style.display = 'none';
    $('race-lap-current-row').style.display = '';
    $('race-lap-current').textContent = '-';
    // Freies Training braucht keine Ampel: es gibt niemanden, gegen den man gleichzeitig
    // losfahren muesste. Drei Sekunden Warten vor einer Trainingsrunde sind nur Wartezeit.
    if (raceMode === 'practice') {
      raceState = 'racing';
      $('race-start-btn').disabled = true;
      $('race-stop-btn').disabled = false;
      raceGreen();
      return;
    }
    // Sofort, nicht erst beim naechsten Intervalltick. Der Knopf im Cockpit wurde von einem
    // Intervall alle 400 ms nachgezogen, und in diesem Fenster stand dort noch "Rennen
    // starten", waehrend das Rennen schon lief - ein Druck darauf hat es dann gestoppt. Ein
    // Knopf, der luegt, was er tun wird, ist schlimmer als einer, der langsam ist.
    setTimeout(updateRaceActButtons, 0);
    raceState = 'countdown';
    $('race-start-btn').disabled = true;
    // Abbrechen muss schon im Countdown gehen: requestRaceStop() raeumt den Zaehler mit
    // auf, und ein Countdown, aus dem man nicht herauskommt, ist eine Falle.
    $('race-stop-btn').disabled = false;
    $('race-status').textContent = 'Countdown…';
    let step = 3;
    setRaceLights(step);
    playTone(440, 0.18, 'square', 0.18);
    clearInterval(raceCountdownTimer);
    raceCountdownTimer = setInterval(() => {
      step--;
      if (step > 0) {
        setRaceLights(step);
        playTone(440 + (3 - step) * 60, 0.18, 'square', 0.18);
      } else {
        clearInterval(raceCountdownTimer);
        setRaceLights('go');
        playTone(880, 0.35, 'square', 0.22);
        raceGreen();
        setTimeout(() => setRaceLights(0), 900);
      }
    }, 1000);
  }

  // Alles, was beim Gruen passiert. Eine Funktion, zwei Aufrufer: der Countdown und das
  // freie Training, das ihn ueberspringt.
  function raceGreen() {
    // A flying start goes to the formation lap first: the cars roll at pit-lane speed
    // and no laps count until the field crosses the line.
    raceFormationLap = raceFlying;
    raceState = 'racing';
    raceLapStart = Date.now();
    launchGhosts();   // green means green for everyone
    if (raceFormationLap) {
      limitFormation = PIT_SPEED_FACTOR; applySpeedLimit();
      showHudToast('Einführungsrunde');
    }
    raceStartedAt = Date.now();
    if (raceClockTimer) clearInterval(raceClockTimer);
    raceClockTimer = setInterval(raceClockTick, 250);
    $('race-status').textContent = raceFormationLap
      ? 'Einführungsrunde, Limit bis Start/Ziel'
      : RACE_MODES[raceMode].label + ' läuft';
    $('race-stop-btn').disabled = false;
    updateRaceActButtons();
  }

  // Stops NOW. This used to set 'finishing' and let the current lap complete, which was
  // the original spec but reads wrong for a button labelled "abbrechen": pressing stop and
  // then watching the car carry on for another lap looks like the button did nothing.
  // The lap in progress is discarded rather than recorded — it was never completed, and
  // counting a partial lap would poison the fastest-lap column.
  function requestRaceStop() {
    if (raceState !== 'racing' && raceState !== 'countdown' && raceState !== 'finishing') return;
    if (raceCountdownTimer) { clearInterval(raceCountdownTimer); raceCountdownTimer = null; }
    setRaceLights(0);
    finishRace();
    showHudToast('Rennen abgebrochen');
    updateRaceActButtons();
  }

  // Missed mandatory stops, as a time penalty in whole seconds. Reported separately from
  // the lap times rather than folded into them: a penalty is not a lap, and hiding it
  // inside one would make the fastest lap a lie.
  function racePenaltyMs() {
    const missed = Math.max(0, racePitRequired - racePitDone);
    return missed * racePitPenaltyS * 1000;
  }

  function finishRace() {
    raceState = 'finished';
    // Die laufende Runde festhalten und die Uhr anhalten. Ohne das Nullsetzen von
    // raceLapStart rechnet die Anzeige weiter gegen Date.now() und die Runde waechst nach
    // dem Ende einfach weiter.
    const now = Date.now();
    racePartialMs = raceLapStart !== null ? now - raceLapStart
                  : (dashLapStart !== null ? now - dashLapStart : null);
    raceLapStart = null;
    dashLapStart = null;
    garage.forEach(c => { if (c.race) c.race.lapStart = null; });
    // Whatever happened, the formation lap is over and its speed limit goes with it.
    if (raceFormationLap) {
      raceFormationLap = false;
      limitFormation = 1; applySpeedLimit();
    }
    if (raceClockTimer) { clearInterval(raceClockTimer); raceClockTimer = null; }
    raceStartedAt = null;
    // Zielflagge: die Ghosts rollen aus, halten an und blinken dreimal. Vorher stand hier
    // stopGhost(), also "Nullen schreiben und dunkel stehenbleiben".
    //
    // Diese Stelle ist die richtige und die einzige: alle Endbedingungen laufen durch
    // finishRace() (Rundenzahl erreicht, Zeit abgelaufen und letzte Runde beendet, Stopp von
    // Hand), also wird die Sequenz von jeder ausgeloest, ohne sie einzeln zu verdrahten.
    garage.forEach(c => { if (c.role === 'ghost') finishGhost(c); });
    const missed = Math.max(0, racePitRequired - racePitDone);
    $('race-status').textContent =
      `Beendet (${raceLapTimes.length} Runde${raceLapTimes.length === 1 ? '' : 'n'})`
      + (racePartialMs !== null
         ? `, letzte Runde unvollendet nach ${formatLapTime(racePartialMs)}` : '')
      + (missed > 0 ? `, ${missed} Pflichtstopp${missed === 1 ? '' : 's'} verpasst, `
                      + `+${missed * racePitPenaltyS} s Strafe` : '');
    $('race-start-btn').disabled = false;
    $('race-lap-current-row').style.display = 'none';
    $('race-results').style.display = '';
    renderRaceResults();
    renderPositionPlot();
    // Und einmal sichtbar dort, wo gerade gedrueckt wurde. Ohne das erschien das Ergebnis
    // nur im Tab "Renneinstellungen" - wer im Cockpit auf Stopp drueckt, sah nichts, und
    // beim freien Training sah es deshalb aus, als gebe es ueberhaupt keine Ergebnisse.
    showRaceSummary();
    // Und ablegen. Hier, weil dies die eine Stelle ist, an der ein Rennen wirklich vorbei
    // ist - und nach showRaceSummary(), damit ein Fehlschlag beim Speichern das Ergebnis
    // nicht verdeckt.
    if (typeof sessionRecord === 'function') {
      sessionRecord();
      if (typeof renderSessions === 'function') renderSessions();
    }
  }

  // ---- Ergebnisfenster ----
  // Eigener, kleiner Aufbau statt eines Klons der grossen Tabelle: die traegt IDs, und
  // dieselbe ID zweimal im Dokument bricht jeden Zugriff darauf. Gerechnet wird mit
  // denselben Funktionen, raceAllCars() und raceStats(), damit hier keine zweite Wahrheit
  // entsteht.
  function showRaceSummary() {
    const cars = raceAllCars().filter(c => c.laps.length);
    const label = (RACE_MODES[raceMode] && RACE_MODES[raceMode].label) || 'Rennen';
    $('sum-title').textContent = label + ' beendet';
    const missed = Math.max(0, racePitRequired - racePitDone);
    const teile = [];
    if (racePartialMs !== null) {
      teile.push('letzte Runde unvollendet nach ' + formatLapTime(racePartialMs)
                 + ', z\u00e4hlt nicht');
    }
    if (missed > 0) {
      teile.push(missed + ' Pflichtstopp' + (missed === 1 ? '' : 's') + ' verpasst, +'
                 + (missed * racePitPenaltyS) + ' s Strafe');
    }
    $('sum-sub').textContent = teile.join(' \u00b7 ');

    if (!cars.length) {
      $('sum-body').innerHTML = '<p class="muted" style="margin-top:12px">Keine Runden '
        + 'aufgezeichnet. Ohne Streckencode gibt es keine Rundenzeit, Schalter '
        + '<b>Auf der Bahn</b> in den Optionen pr\u00fcfen, oder Runden mit <kbd>Q</kbd> '
        + 'z\u00e4hlen, um die Anzeige zu pr\u00fcfen.</p>';
      $('race-summary').classList.add('on');
      return;
    }

    const scored = cars.map(c => ({ c, st: raceStats(c.laps) }));
    scored.sort((a, b) => raceMode === 'qualifying'
      ? a.st.best - b.st.best
      : (b.st.n - a.st.n) || (a.st.total - b.st.total));
    const fastest = Math.min(...scored.map(x => x.st.best));

    // Abgaenge je Runde stehen NEBEN der Rundenzeit, nicht darin verrechnet. Eine schnelle
    // Runde mit drei Abgaengen ist kein Fortschritt, und ein Mittelwert wuerde das verdecken.
    const offOf = (c) => c.laps.reduce((a, l) => a + (l.off || 0), 0);
    let html = '<table class="sum-tab"><tr><th>#</th><th>Auto</th><th>Runden</th>'
      + '<th>Beste</th><th>Mittel</th><th>Abg&auml;nge</th></tr>';
    scored.forEach((x, i) => {
      html += '<tr><td>' + (i + 1) + '</td><td>' + ergDot(x.c) + x.c.name
        + (x.c.role === 'ghost' ? ' <span class="muted">(Ghost)</span>' : '') + '</td>'
        + '<td class="num">' + x.st.n + '</td>'
        + '<td class="num' + (x.st.best === fastest ? ' sum-best' : '') + '">'
        + formatLapTime(x.st.best) + '</td>'
        + '<td class="num">' + formatLapTime(Math.round(x.st.mean)) + '</td>'
        + '<td class="num">' + offOf(x.c) + '</td></tr>';
    });
    html += '</table>';

    // Jede einzelne Runde darunter, damit nichts hinter einem Mittelwert verschwindet -
    // beim freien Training ist das ohnehin das Einzige, was interessiert.
    const maxLaps = Math.max(...cars.map(c => c.laps.length));
    html += '<p class="muted" style="font-size:11px; margin:12px 0 0 0">Zahl in Klammern: '
      + 'Abg\u00e4nge in dieser Runde.</p>';
    html += '<table class="sum-tab" style="margin-top:6px"><tr><th>Runde</th>'
      + cars.map(c => '<th style="text-align:right">' + c.name + '</th>').join('') + '</tr>';
    for (let k = 0; k < maxLaps; k++) {
      html += '<tr><td>' + (k + 1) + '</td>'
        + cars.map(c => '<td class="num">'
            + (c.laps[k] ? formatLapTime(c.laps[k].ms)
                           + (c.laps[k].off ? ' <span class="muted">(' + c.laps[k].off + ')</span>' : '')
                         : '\u2013') + '</td>').join('')
        + '</tr>';
    }
    html += '</table>';
    $('sum-body').innerHTML = html;
    $('race-summary').classList.add('on');
  }

  function hideRaceSummary() { $('race-summary').classList.remove('on'); }
  $('sum-close').onclick = hideRaceSummary;
  // Der Knopf "Alle Rundenzeiten" traegt schon .goto-tab und wechselt den Tab; hier muss
  // nur noch der Vorhang weg, sonst liegt er ueber dem Ziel.
  $('sum-details').addEventListener('click', hideRaceSummary);
  $('race-summary').addEventListener('click', (e) => {
    if (e.target === $('race-summary')) hideRaceSummary();
  });

  // ---- Race mode selector ----
  function applyRaceModeUi() {
    syncRaceModeTiles();
    const m = RACE_MODES[raceMode];
    $('race-limit-label').textContent = m.unit;
    $('race-mode-hint').textContent = m.hint;
    $('race-start-btn').textContent = `\u{1F3C1} ${m.label} starten`;
    // Free practice has no limit, so the field would be a lie. Disabled, not hidden:
    // a control that vanishes makes people wonder whether they broke something.
    $('race-limit').disabled = !m.timed;
    // 0.7, not 0.45. On white 0.45 was a legible grey; on black it collapsed to 2.7:1,
    // and this label still has to be readable while it says which unit is NOT in use.
    $('race-limit-label').style.opacity = m.timed ? '' : '0.7';
  }
  // Kacheln und Wetterknoepfe schreiben in das versteckte Auswahlfeld und loesen change
  // aus. Damit gibt es weiter genau EINE Stelle, die auf eine Aenderung reagiert, und die
  // Voreinstellungen koennen den Modus setzen, ohne die Kacheln zu kennen.
  function syncRaceModeTiles() {
    const v = $('race-mode').value;
    for (const b of document.querySelectorAll('#race-mode-tiles .mode-tile')) {
      b.classList.toggle('sel', b.dataset.mode === v);
      b.setAttribute('aria-pressed', b.dataset.mode === v ? 'true' : 'false');
    }
  }
  for (const b of document.querySelectorAll('#race-mode-tiles .mode-tile')) {
    b.addEventListener('click', () => {
      $('race-mode').value = b.dataset.mode;
      $('race-mode').dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function syncRaceWxPick() {
    const v = $('race-wx-start').value;
    for (const b of document.querySelectorAll('#race-wx-pick button')) {
      b.classList.toggle('sel', b.dataset.wx === v);
      b.setAttribute('aria-pressed', b.dataset.wx === v ? 'true' : 'false');
    }
  }
  for (const b of document.querySelectorAll('#race-wx-pick button')) {
    b.addEventListener('click', () => {
      $('race-wx-start').value = b.dataset.wx;
      $('race-wx-start').dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  $('race-wx-start').addEventListener('change', syncRaceWxPick);
  syncRaceWxPick();

  $('race-mode').addEventListener('change', (e) => {
    raceMode = e.target.value;
    // Sensible default per mode rather than carrying a minute count over into a lap count.
    raceLimit = raceMode === 'laps' ? 10 : 2;
    $('race-limit').value = raceLimit;
    applyRaceModeUi();
  });
  $('race-limit').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v >= 1) raceLimit = v;
  });

  $('race-wx-start').addEventListener('change', (e) => { raceWxStart = e.target.value; });
  $('race-wx-change').addEventListener('change', (e) => { raceWxChange = e.target.checked; });
  $('race-pit-required').addEventListener('change', (e) => {
    racePitRequired = parseInt(e.target.value, 10) || 0;
  });
  $('race-pit-penalty').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v >= 0) racePitPenaltyS = v;   // whole seconds, as asked
  });
  $('race-fuel-start').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v >= 1) raceFuelStartL = Math.min(FUEL_TANK_LITERS, v);
  });
  applyRaceModeUi();

  // ---- Touch controls on the racing screen ----
  // Everything reachable from the pad or the keyboard should also be reachable with a
  // thumb: on a phone clipped to a wheel there is no keyboard and possibly no pad.
  // One toggle for the whole app: the same action on the touch tile, the settings button
  // and RB/R1. There used to be a second, near-identical abort path inlined here, which is
  // how the two could drift apart.
  function toggleRace() {
    const live = raceState === 'racing' || raceState === 'countdown' || raceState === 'finishing';
    if (live) requestRaceStop(); else startRaceCountdown();
    updateRaceActButtons();
  }
  $('race-act-start').onclick = toggleRace;

  $('race-act-pit').onclick = () => { requestPitStop(); updateRaceActButtons(); };
  // Der KNOPF loest direkt aus, ein Tipp reicht.
  //
  // Hier stand vorher dieselbe Halten-Geste wie auf der Taste X, und die Begruendung war der
  // Fehltipper. Die gilt fuer die TASTE - sie liegt neben allem anderen, und ein Streifer
  // kostet 40 km/h fuer jedes Auto im Feld. Sie gilt NICHT fuer einen beschrifteten Knopf,
  // den man mit dem Finger sucht und trifft: dort ist der Griff selbst schon die Absicht,
  // und eine Sekunde Warten mitten im Rennen ist genau die Sekunde, in der man hinsieht
  // statt zu fahren.
  //
  // Das Halten bleibt auf X, samt Ladebalken in diesem Knopf.
  $('race-act-flag').onclick = () => {
    if (flagState === 'green') setFlag('yellow');
    else if (flagState === 'yellow') yellowRestart();
  };

  $('race-light-box').onclick = () => {
    headlightsOn = !headlightsOn;
    const cb = $('dash-head-toggle');
    if (cb) cb.checked = headlightsOn;
    showHudToast(headlightsOn ? 'Licht an' : 'Licht aus');
  };

  $('race-wx-box').onclick = () => setWeather(weather === 'rain' ? 'dry' : 'rain');

  // Tank und Zustand sind nur WAEHREND eines Boxenstopps Schalter. Ausserhalb bleibt ein
  // Tipp wirkungslos, statt versehentlich etwas zu verstellen.
  for (const el of document.querySelectorAll('.pit-tile[data-pit="refuel"], .pit-tile[data-pit="repair"]')) {
    el.addEventListener('click', () => {
      // Zwei Bedeutungen nach Zustand, wie bei der Reifenkachel: im Boxenstopp der Plan,
      // sonst die Simulation. Der vorhandene Zuhoerer wird ERWEITERT und nicht ein zweiter
      // daneben gestellt - sonst feuerten beide auf denselben Tipp.
      if (pitState === 'servicing' && pitPlan) { pitToggle(el.dataset.pit); return; }
      if (el.dataset.pit === 'refuel') toggleFuelSim();
      else if (el.dataset.pit === 'repair') toggleDamageSim();
    });
  }

  // Tank: der Verbrauch IST der Schalter. 0 %/s heisst, der Tank leert sich nicht, und
  // das ist genau "Simulation aus" - ein zweites Ankreuzfeld daneben waere ein zweiter
  // Zustand fuer dieselbe Aussage.
  let fuelDrainLastNonZero = 0;
  function toggleFuelSim() {
    const input = $('setting-fuel-drain');
    if (!input) return;
    const cur = parseFloat(input.value);
    if (cur !== 0) fuelDrainLastNonZero = cur;
    const next = cur === 0 ? (fuelDrainLastNonZero || 3) : 0;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    showHudToast(next === 0 ? 'TANKSIMULATION AUS'
                            : 'TANKSIMULATION ' + next.toFixed(1) + ' %/S');
  }

  function toggleDamageSim() {
    const sw = $('setting-crash-damage');
    if (!sw) return;
    sw.checked = !sw.checked;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    showHudToast(sw.checked ? 'SCHADENSSIMULATION AN' : 'SCHADENSSIMULATION AUS');
  }

  // Die Bremsbalance-Skala im Cockpit ziehen.
  //
  // Ein Ding, das wie ein Regler aussieht und keiner ist, ist schlimmer als ein Symbol: man
  // zieht daran, nichts passiert, und danach traut man auch dem Rest nicht.
  //
  // Der Weg geht ueber das Bedienelement in den Optionen und dessen 'input'-Ereignis, wie
  // bei allen anderen Cockpit-Kacheln - dadurch ist die Synchronitaet da, ohne dass ein
  // zweiter Zustand entsteht.
  (function bindeBiasSkala() {
    const row = $('race-bias-row');
    const inp = $('setting-brakebias');
    if (!row || !inp) return;
    const lo = +inp.min, hi = +inp.max;
    let zieht = false;

    const setzen = (clientY) => {
      const svg = row.querySelector('svg');
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      if (r.height < 4) return;
      // Oben ist vorn, also von unten gerechnet.
      const t = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
      const wert = Math.round(lo + t * (hi - lo));
      if (String(wert) === inp.value) return;
      inp.value = wert;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };

    row.addEventListener('pointerdown', (e) => {
      zieht = true;
      // Der Zeiger wird eingefangen, damit das Ziehen auch weitergeht, wenn der Finger die
      // schmale Skala verlaesst - sie ist 14 px breit, und ohne das reisst jeder Zug ab.
      try { row.setPointerCapture(e.pointerId); } catch (err) { /* alter Browser */ }
      setzen(e.clientY);
      e.preventDefault();
    });
    row.addEventListener('pointermove', (e) => { if (zieht) setzen(e.clientY); });
    for (const ev of ['pointerup', 'pointercancel']) {
      row.addEventListener(ev, () => { zieht = false; });
    }
  })();

  $('race-tyre-box').onclick = () => {
    // Waehrend eines Boxenstopps bedeutet ein Tipp auf diese Kachel "Reifenwechsel an/aus",
    // sonst "Reifensimulation an/aus". Nie beides gleichzeitig, und der Titel nennt beides.
    if (pitState === 'servicing' && pitPlan) { pitToggle('tyres'); return; }
    // Toggle between off and the last non-zero setting, so a click does not lose the value
    // that was dialled in on the slider.
    const input = $('setting-tyres');
    const cur = physEngine.config.tyreEffect;
    const restore = tyreLastNonZero || 1;
    const next = cur === 0 ? restore : 0;
    if (cur !== 0) tyreLastNonZero = cur;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    showHudToast(next === 0 ? 'Reifensimulation aus' : `Reifensimulation ${Math.round(next * 100)} %`);
  };
  let tyreLastNonZero = 0;

  // Start/Options: jump to the track view and back, so the layout can be checked without
  // hunting for the tab. Remembers where it came from rather than always returning to the
  // cockpit, which would be wrong if it was opened from the garage.
  let trackViewReturnTab = null;
  function toggleTrackView() {
    const active = document.querySelector('.tabpage.active');
    const cur = active ? active.id.replace(/^tab-/, '') : 'control';
    if (cur === 'track' && trackViewReturnTab) {
      const back = trackViewReturnTab;
      trackViewReturnTab = null;
      const btn = document.querySelector(`[data-tab="${back}"]`);
      if (btn) btn.click();
    } else if (cur !== 'track') {
      trackViewReturnTab = cur;
      const btn = document.querySelector('[data-tab="track"]');
      if (btn) btn.click();
    }
  }

  // Touchpad: put the car back to a known-good state. Deliberately does NOT touch lap
  // times or the race state — it is a "get me driving again" button, not a restart.
  function resetCarState() {
    damage = 0;
    fuel = 100;
    resetTyres();
    updateDamageFuelUI();
    showHudToast(`Zurückgesetzt, Tank ${fuelLiters(100)} l, Schaden 0 %, Reifen kalt`);
    log('Auto zurückgesetzt: Schaden 0, Tank voll, Reifen kalt.', 'info');
  }

  function updateRaceActButtons() {
    const a = $('race-act-start');
    if (a) {
      const live = raceState === 'racing' || raceState === 'countdown' || raceState === 'finishing';
      // Waehrend des Countdowns zeigt der Knopf, dass er laeuft. Vorher stand dort schon
      // "Rennen abbrechen", ohne dass sichtbar war, dass ueberhaupt etwas laeuft - ein Druck
      // in dieser Zeit brach still ab, und das sah aus wie "der Knopf tut nichts".
      a.textContent = raceState === 'countdown'
        ? 'Countdown … abbrechen'
        : (live ? 'Rennen abbrechen' : 'Rennen starten');
      a.classList.toggle('warn', live);
    }
    const p = $('race-act-pit');
    if (p) {
      p.textContent = pitState === 'off' ? 'Boxenstopp'
                    : pitState === 'limited' ? 'Limiter aktiv \u00b7 2\u00d7 = Abbruch'
                    : 'Service \u00b7 2\u00d7 = Abbruch';
      p.classList.toggle('armed', pitState !== 'off');
    }
  }
  setInterval(updateRaceActButtons, 400);

  $('race-start-btn').onclick = startRaceCountdown;
  $('race-stop-btn').onclick = requestRaceStop;
  $('race-export-csv').onclick = () => {
    // Semicolon delimiter + comma decimals: opens directly (no import wizard) in a
    // German-locale Excel, which is the overwhelmingly likely consumer here.
    // All cars, not just the player's: the table shows every connected car, and an export
    // that silently held less than the screen would be worse than none.
    const cars = raceAllCars().filter(c => c.laps.length);
    const num = (ms) => (ms / 1000).toFixed(3).replace('.', ',');
    const header = 'Auto;Kennung;Rolle;Runde;Zeit (s)';
    const lines = [];
    cars.forEach(c => c.laps.forEach(l =>
      lines.push(`${c.name};${c.kennung || '-'};${c.role || '-'};${l.lap};${num(l.ms)}`)));
    // Summary block underneath, matching the statistics column for column.
    lines.push('');
    lines.push('Auto;Kennung;Runden;Beste (s);Mittel (s);Schlechteste (s);Streuung (s)');
    cars.forEach(c => { const st = raceStats(c.laps);
      lines.push(`${c.name};${c.kennung || '-'};${st.n};${num(st.best)};`
               + `${num(Math.round(st.mean))};`
               + `${num(st.worst)};${num(Math.round(st.sd))}`); });
    // Race conditions, so an exported file can still be understood a month later.
    lines.push('');
    lines.push('Rennbedingungen;Wert');
    lines.push(`Modus;${RACE_MODES[raceMode].label}`);
    lines.push(`Wetter zu Beginn;${raceWxStart === 'rain' ? 'Regen' : 'trocken'}`);
    lines.push(`Wetterwechsel;${raceWxChange ? 'ja' : 'nein'}`);
    lines.push(`Tank beim Start (l);${raceFuelStartL}`);
    // On/off track goes into the export because it is the one figure that says whether the
    // lap times above describe driving on a track at all.
    lines.push(`Zeit auf der Strecke (s);${num(Math.round(trackTimeOn * 1000))}`);
    lines.push(`Zeit abseits (s);${num(Math.round(trackTimeOff * 1000))}`);
    lines.push(`Anteil abseits (%);${(trackTimeOn + trackTimeOff > 0
      ? (trackTimeOff / (trackTimeOn + trackTimeOff) * 100) : 0).toFixed(1).replace('.', ',')}`);
    lines.push(`Pflichtboxenstopps;${racePitRequired}`);
    lines.push(`Davon gefahren;${racePitDone}`);
    lines.push(`Strafe je verpasstem Stopp (s);${racePitPenaltyS}`);
    lines.push(`Strafe gesamt (s);${num(racePenaltyMs())}`);
    const csv = [header, ...lines].join('\r\n') + '\r\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `rennergebnis-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  function dashboardNotifyHandler(e) {
    handleDashboardBytes(notifyBytes(e.target.value));
  }

  // ---- Zeitleiste der Mustercodes ----
  // Modulweit, weil die Anzeige aus handleDashboardBytes gefuettert wird und der Knopf zum
  // Leeren woanders sitzt.
  const TILE_TL_MAX = 24;
  let tileTimeline = [];      // [{ code, pakete, von, bis, counter }], neueste zuletzt

  function tileTimelineTick(code, counter) {
    const jetzt = Date.now();
    const letzte = tileTimeline[tileTimeline.length - 1];
    if (letzte && letzte.code === code) {
      letzte.pakete++;
      letzte.bis = jetzt;
      letzte.counterBis = counter;
    } else {
      tileTimeline.push({ code, pakete: 1, von: jetzt, bis: jetzt,
                          counterVon: counter, counterBis: counter });
      // Nur die letzten paar behalten: eine Fahrt ueber ein Blatt dauert Sekunden, und was
      // vor einer Minute war, hilft bei der Frage nicht.
      if (tileTimeline.length > TILE_TL_MAX) tileTimeline.shift();
    }
    renderTileTimeline();
  }

  let tileTlDirty = false;
  function renderTileTimeline() {
    // Gebuendelt zeichnen: bei 20 Paketen je Sekunde waere ein Neuaufbau je Paket reine
    // Verschwendung, und die Zeitleiste soll das Fahren nicht stoeren.
    if (tileTlDirty) return;
    tileTlDirty = true;
    setTimeout(() => {
      tileTlDirty = false;
      const host = $('tile-timeline');
      if (!host) return;
      if (!tileTimeline.length) {
        host.innerHTML = '<tr><td colspan="4" class="muted">noch nichts</td></tr>';
        return;
      }
      const td = 'padding:3px 8px';
      const tdr = td + '; text-align:right';
      host.innerHTML = tileTimeline.slice().reverse().map(z => {
        const dauer = Math.max(0, z.bis - z.von);
        // Ein Einzelpaket ist der interessante Fall und wird angeschrieben, statt dass man
        // die Eins in der Spalte suchen muss.
        const einzeln = z.pakete === 1 ? ' <span class="cm-new">einzeln</span>' : '';
        const zaehler = z.counterVon === z.counterBis
          ? String(z.counterVon)
          : z.counterVon + '\u2013' + z.counterBis;
        return '<tr><td style="' + td + '">0x' + z.code.toString(16).padStart(2, '0')
             // Durch t(), aus demselben Grund wie in der Musterprobe: der rohe Name
             // faerbt den ganzen zusammengesetzten Messwert deutsch.
             + ' ' + t(TILE_LABEL[z.code] || '?') + einzeln + '</td>'
             + '<td style="' + tdr + '">' + z.pakete + '</td>'
             + '<td style="' + tdr + '">' + (dauer >= 1000
                 ? (dauer / 1000).toFixed(1) + ' s' : dauer + ' ms') + '</td>'
             + '<td style="' + tdr + '">' + zaehler + '</td></tr>';
      }).join('');
    }, 120);
  }

  if ($('tile-timeline-clear')) {
    $('tile-timeline-clear').addEventListener('click', () => {
      tileTimeline = [];
      renderTileTimeline();
      log('Zeitleiste der Mustercodes geleert.', 'info');
    });
  }


  function handleDashboardBytes(bytes) {
    recNotify(bytes);
    if (probeOverride && bytes[12] !== 0xff) {
      probeStats.codes++;
      probeStats.lastCode = bytes[12];
    }
    // dashBattery wird weiter gebraucht: die Akkukachel im Cockpit liest ihn. Die Zeile
    // darunter schrieb in #dash-battery, ein Element der entfernten alten Karte.
    dashBattery = bytes[10];

    // Byte 15 was read as "off track". The 2026-08-19 snoop logs disprove that: it is 0x08
    // for exactly as long as the car sits on a printed marker (~1s at driving speed), in the
    // same packet in which the crossing counter increments, in every capture. So the old
    // warning lit up precisely when the car crossed start/finish. It is a marker-contact
    // flag, and that is what it now says.
    const markerVorher = dashMarkerPrev;
    dashOnMarker = (bytes[15] & 0x08) !== 0;
    dashMarkerPrev = dashOnMarker;

    // ---- Runde im Ausdruck-Modus: die steigende Flanke des Musterkontakts ----
    //
    // Byte 12 rastet ein und zeigt das zuletzt gelesene Muster. Bei der zweiten Ueberfahrt
    // desselben Blattes aendert sich dort nichts, und die Erkennung weiter unten verlangt,
    // dass der Kachelzaehler weiterlaeuft - auf einem Blatt neben der Bahn laeuft er nicht.
    // Ohne diese Flanke wuerde also nur die ERSTE Runde gezaehlt.
    //
    // Nur im Ausdruck-Modus: auf der Schiene laeuft der Kachelzaehler, und dort ist er das
    // bessere Signal, weil er jede Kachel zaehlt und nicht nur die bedruckten.
    //
    // Die Sperre ist dieselbe wie unten (TILE_REPEAT_BLOCK_MS) und aus demselben Grund: ein
    // flackernder Kontakt darf keine Doppelrunde ergeben.
    // Die Sperre ist DIESELBE, die der Weg ueber den Kachelzaehler weiter unten benutzt
    // (dashLastActedCode und dashLastActedAt). Zwei Wege mit je eigener Sperre sperren sich
    // nicht gegenseitig - gemessen kam die erste Ueberfahrt doppelt, weil beide zaehlten.
    // Wer zuerst kommt, zaehlt; der andere ist fuer TILE_REPEAT_BLOCK_MS still.
    if (trackMode === 'off' && dashOnMarker && !markerVorher) {
      const code = bytes[12];
      const jetzt = Date.now();
      const frei = !(dashLastActedCode === code
                     && jetzt - dashLastActedAt < TILE_REPEAT_BLOCK_MS);
      if (frei && isStartCode(code)) {
        dashLastActedCode = code; dashLastActedAt = jetzt;
        log('Start/Ziel im Ausdruck-Modus: Musterkontakt gesetzt, Code 0x'
            + code.toString(16).padStart(2, '0') + '.', 'info');
        if (playerLapCrossed()) { refreshMinimap(); }
        // Und DANACH die Doppelpruefung: die Runde ist gezaehlt, mit richtiger Zeit, und
        // wird zurueckgenommen falls sich der Kontakt als zweiter eines Paares erweist.
        pitDoubleCheck(jetzt);
      } else if (frei && code === pitMarkerCode) {
        dashLastActedCode = code; dashLastActedAt = jetzt;
        onPitMarkerCrossed();
      }
    }

    const badge = $('dash-offtrack');
    badge.textContent = dashOnMarker ? 'Über Muster' : 'Kein Muster';
    badge.style.background = dashOnMarker ? 'rgba(70,209,127,.12)' : 'var(--panel-2)';
    badge.style.borderColor = dashOnMarker ? 'var(--good)' : 'var(--border)';

    // Bytes 1 and 3 fluctuate only once the car moves and byte 3 flipped sign with turn
    // direction in one capture — hence "motion-ish". Unconfirmed.
    //
    // Und hier gehoert die Crasherkennung hin: sie braucht genau diese zwei Bytes. Der
    // Aufruf hat GEFEHLT - detectCrash war definiert, die Schwelle war definiert, der
    // Schalter war da, und niemand rief sie auf. Gemeldet als "Schaden ist angeschaltet,
    // aber wenn ich am Auto ruettele passiert nichts". Toter Code, der wie ein Merkmal
    // aussieht, ist schlimmer als ein fehlendes Merkmal.
    detectCrash(bytes);
    const g1 = s8signed(bytes[1]), g3 = s8signed(bytes[3]);
    gyroRaw.x += (g3 - gyroRaw.x) * 0.35;
    gyroRaw.y += (g1 - gyroRaw.y) * 0.35;
    // Auto-range so the dot stays readable whatever the real amplitude turns out to be.
    gyroRaw.span = Math.max(8, gyroRaw.span * 0.995,
                            Math.abs(gyroRaw.x) * 1.2, Math.abs(gyroRaw.y) * 1.2);

    // On the track or beside it, counted separately. Byte 12 is 0x00 whenever the sensor
    // sees no track code at all, which is what "off the track" means to this car - and until
    // now that only ever stopped the ghosts. Nothing recorded it for the driver, so a lap
    // driven half across the carpet looked exactly like a clean one in the lap list.
    trackTimeTick((bytes[12] & 0xff) !== TILE_OFFTRACK);
    // Dasselbe Byte, zweite Folge: Rumble und Drosselung jenseits der Bahn. Der Zustand
    // liegt in 50-drive.js, weil dort der Fahrtakt sitzt - siehe offtrackMelden().
    offtrackMelden((bytes[12] & 0xff) === TILE_OFFTRACK);
    realSpeedTick(bytes[11], bytes[12] & 0xff);

    const counter = bytes[11];
    const type = bytes[12];

    // ---- Zeitleiste der Codes ----
    //
    // "Nur 0x00 und ab und zu 0x03" ist keine Beobachtung, mit der man arbeiten kann: es
    // fehlt, WANN. Ein echter Lesevorgang ist ein Buendel gleicher Codes waehrend der
    // Ueberfahrt - bei 45 bis 60 ms Taktrate sind das mehrere Pakete. Ein Stoerwert ist ein
    // einzelnes Paket zwischen Nullen. In einer Anzeige, die nur den letzten Wert zeigt,
    // sieht beides gleich aus, und genau daran ist die Diagnose bisher gescheitert.
    //
    // Zusammengefasst wird nach Code, nicht je Paket: zweihundert Zeilen mit 0x00 sind keine
    // Information, "0x00, 214 Pakete, 11,3 s" ist eine.

    // ---- Der Rohcode, VOR allen Wachen ----
    //
    // Hier stand diese Anzeige vorher NICHT: sie sass hinter vier Ruecksprungen, und einer
    // davon verlangt, dass der Kachelzaehler des Autos weiterlaeuft
    // (counter === dashLastTileCounter -> return). Ueber ein Blatt auf dem Fussboden tut er
    // das offenbar nicht, und dann wurde nie etwas angezeigt - gemeldet als "beim Scanner
    // kommt gar nichts mehr". Ihr eigener Kommentar sagte "den Rohcode zeigen, damit ein
    // unbekanntes Muster durch einmaliges Ueberfahren erkannt wird", und roh war daran
    // nichts.
    //
    // Die Wachen bleiben, wo sie sind: sie sollen Phantomrunden verhindern, und dafuer sind
    // sie richtig. Eine DIAGNOSEANZEIGE darf nur nicht von der Logik gefiltert werden,
    // deren Fehler sie sichtbar machen soll.
    //
    // Mitangezeigt wird der Kachelzaehler, denn genau er war die stille Bedingung: bewegt
    // er sich nicht, sieht man das jetzt.
    // HIER STAND EINE SELBSTAUSLOESUNG, und sie ist absichtlich weg.
    //
    // Vorher galt: 0x00 heisst abseits der Bahn, und abseits der Bahn IST die Boxengasse -
    // also loeste jedes Verlassen der Bahn den Pit-Modus aus. Das heisst aber auch, dass
    // jeder Abflug eine Boxeneinfahrt ist, und das war es nicht wert.
    //
    // Jetzt fordert man den Stopp von Hand an (requestPitStop, Taste oder Options/Start),
    // und die Bahnkante entscheidet nur noch, ob er ANFAENGT - siehe pitLaneTick. Damit hat
    // der Modus eine Aufgabenteilung: der Knopf sagt DASS, die Kante sagt WO.
    lastTileCode = type;
    tileTimelineTick(type, counter);
    const probe = $('tile-probe');
    if (probe) {
      const bewegt = dashLastTileCounter !== null && counter !== dashLastTileCounter;
      probe.textContent = '0x' + type.toString(16).padStart(2, '0')
        // Durch t() wie der Rest der Zeile. Er war die eine Stelle darin, die roh
        // deutsch blieb, und dadurch faerbte der ganze zusammengesetzte Messwert
        // im englischen Modus deutsch - der Sprachtest hat ihn gemeldet.
        + ' (' + t(TILE_LABEL[type] || 'unbekannt') + ')'
        + '  ' + t('Kachelz\u00e4hler') + ' ' + counter
        + ' ' + (bewegt ? t('bewegt') : t('steht'));
    }

    // ---- Two guards against misread patterns ----
    // 1) CONFIRMATION. A code has to arrive twice in a row before it is believed. The cost
    //    of this is one packet of latency and nothing else: the logs show a tile stays under
    //    the sensor for 0.4 to 2.7 s, which at the ~45-60 ms notify rate is 8 to 60 packets,
    //    so a genuine reading is never a single packet. A one-off wrong byte now cannot
    //    count a lap or drag the car into the pit lane.
    // 2) NO IMMEDIATE REPEAT. After a start/finish or pit marker has been acted on, the same
    //    code is ignored for a second. The counter alone was the only protection before, and
    //    a stuttering counter therefore produced double laps.
    if (type !== dashPendingCode) { dashPendingCode = type; dashPendingSeen = 1; return; }
    if (++dashPendingSeen < 2) return;

    if (dashLastTileCounter === null) { dashLastTileCounter = counter; return; }
    if (counter === dashLastTileCounter) return;
    dashLastTileCounter = counter;
    dashMinimapIndex = dashMinimapIndex === null ? 0 : dashMinimapIndex + 1;
    if (currentTrackTiles.length > 0) dashMinimapIndex = dashMinimapIndex % currentTrackTiles.length;
    // Die Dauer der gerade verlassenen Kachel mitfuehren, geglaettet - dieselbe Rechnung wie
    // ghostNoteTileTime() fuer die Ghosts. Daraus schaetzt dashTilePhase() die Position
    // INNERHALB der Kachel, und die braucht der Windschatten: ein Abstand in ganzen Kacheln
    // ist bei 43 cm Kachellaenge zu grob, um "dicht dahinter" von "eine Laenge dahinter" zu
    // unterscheiden.
    const jetztT = Date.now();
    if (dashTileAt) {
      const ms = jetztT - dashTileAt;
      if (ms > 60 && ms < 20000) dashTileMs = dashTileMs ? dashTileMs * 0.7 + ms * 0.3 : ms;
    }
    dashTileAt = jetztT;

    // Guard 2 applies only to the two codes that trigger something irreversible; the
    // ordinary straight and curve codes may repeat as often as the track says.
    const nowCode = Date.now();
    const repeatBlocked = (isStartCode(type) || type === pitMarkerCode)
      && dashLastActedCode === type
      && nowCode - dashLastActedAt < TILE_REPEAT_BLOCK_MS;
    if (repeatBlocked) {
      log(`Mustercode 0x${type.toString(16)} innerhalb von ${TILE_REPEAT_BLOCK_MS} ms wiederholt, ignoriert.`, 'info');
      return;
    }
    if (isStartCode(type) || type === pitMarkerCode) {
      dashLastActedCode = type; dashLastActedAt = nowCode;
    }

    if (type === pitMarkerCode) onPitMarkerCrossed();

    if (isStartCode(type)) {
      const gezaehlt = playerLapCrossed();
      // Und DANACH die Doppelpruefung, genau wie auf dem Ausdruck-Weg. Sie stand hier
      // nicht, und das war der Fehler: bewegt sich der Kachelzaehler zwischen den beiden
      // Kontakten eines Paares - und das tut er, sobald das Auto ein Streckenteil
      // weiterfaehrt -, laeuft der zweite Kontakt ueber DIESEN Weg, und die Runde wurde
      // nie zurueckgenommen. Zwei Runden statt einer.
      //
      // VOR dem return, nicht danach: das return war die Stelle, an der die Pruefung
      // uebersprungen wurde.
      pitDoubleCheck(nowCode);
      if (gezaehlt) { refreshMinimap(); return; }
    }
    refreshMinimap();
  }

  // Was beim Ueberfahren von Start/Ziel fuer den FAHRER passiert. Herausgezogen, damit die
  // Testtaste Q genau hier hineingeht statt einen zweiten Weg zu nehmen - ein zweiter Weg
  // prueft den ersten nicht. Rueckgabewert: true, wenn der Aufrufer abbrechen soll (die
  // Einfuehrungsrunde endete, das war keine gezaehlte Runde).
  // Eine gerade gezaehlte Runde zuruecknehmen.
  //
  // Gebraucht wird das nur von der Boxengassen-Variante 'double': dort steht erst beim
  // ZWEITEN Kontakt fest, dass der erste eine Boxeneinfahrt war und keine Runde. Die
  // Alternative waere, die Runde drei Sekunden zurueckzuhalten - dann waere aber die
  // Rundenzeit falsch, denn die Rundengrenze ist der Moment der Ueberfahrt und nicht der
  // Moment der Entscheidung. Eine zurueckgenommene Runde ist sichtbar; eine um drei
  // Sekunden verschobene Grenze ist ein stiller Messfehler in JEDER Runde.
  //
  // Die Zeit muss mit zurueck: ohne das faengt die naechste Runde mitten in der
  // zurueckgenommenen an, und dann sind beide falsch.
  function retractLap(warum) {
    if (!raceLapTimes.length) return false;
    const weg = raceLapTimes.pop();
    if (raceLapStart !== null) raceLapStart -= weg.ms;
    if (dashLapTimes.length) {
      const d = dashLapTimes.pop();
      if (dashLapStart !== null) dashLapStart -= d;
    }
    $('race-status').textContent = t('Rennen läuft, Runde') + ' ' + raceLapTimes.length;
    log('Runde zurueckgenommen (' + formatLapTime(weg.ms) + '): ' + warum, 'info');
    showHudToast('KEINE RUNDE, BOXENEINFAHRT');
    return true;
  }

  // ---- Sektoren [experimentell] ----
  //
  // X Ueberfahrten ueber Start/Ziel sind EINE Runde; die Zeiten dazwischen sind
  // Teilstreckenzeiten. Das geht nur ohne Bahn, und nicht weil es riskant waere, sondern
  // weil es mit Bahn bedeutungslos ist: auf der CH-Schiene gibt es genau ein Start/Ziel,
  // also ist jede Ueberfahrt eine Runde. Im Ausdruck-Modus legt man die Muster selbst hin,
  // und drei Ausdrucke ueber eine Runde verteilt sind drei Sektoren.
  //
  // WICHTIG am Entwurf: eine Sektorzeit ist NICHT die Rundenzeit geteilt durch X, sondern
  // die gemessene Zeit zwischen zwei Kontakten. Genau darin liegt der Wert - die Sektoren
  // einer Runde sind ungleich lang, und ihre Streuung sagt, WO Zeit verlorengeht. Eine
  // gerechnete Drittelung waere eine Zahl ohne Information.
  //
  // Und die Rundenzeit ist die SUMME der gemessenen Sektoren, nicht eine zweite Messung.
  // Zwei Uhren fuer dieselbe Strecke laufen auseinander.
  let sectorCount = 1;          // 1 = aus, jede Ueberfahrt ist eine Runde
  let sectorIndex = 0;          // wieviele Kontakte diese Runde schon hatte
  let sectorStart = null;       // Beginn des laufenden Sektors
  let sectorTimes = [];         // die Sektoren der laufenden Runde, in ms
  let sectorHistory = [];       // je vollendete Runde ein Array von Sektorzeiten

  function sectorReset() {
    sectorIndex = 0;
    sectorStart = null;
    sectorTimes = [];
  }

  // Gibt true zurueck, wenn dieser Kontakt eine RUNDE vollendet - dann laeuft die normale
  // Rundenlogik. Sonst war es eine Sektorgrenze und die Runde laeuft weiter.
  function sectorCrossed(now) {
    if (sectorCount <= 1) return true;
    if (sectorStart === null) {
      // Der erste Kontakt ueberhaupt: er beginnt den ersten Sektor und ist noch keine
      // Sektorgrenze. Ohne diesen Fall waere der erste Sektor die Zeit seit dem Rennstart
      // und damit systematisch zu lang.
      sectorStart = now;
      sectorIndex = 0;
      return false;
    }
    sectorTimes.push(now - sectorStart);
    sectorStart = now;
    sectorIndex += 1;
    if (sectorIndex < sectorCount) {
      renderSectors();
      showHudToast('SEKTOR ' + sectorIndex + ': '
                   + formatLapTime(sectorTimes[sectorTimes.length - 1]));
      // Ein eigener, tieferer Ton fuer die Sektorgrenze: derselbe wie fuer die Runde waere
      // eine Falschmeldung, denn die Runde ist nicht vorbei.
      playTone(300, 0.07, 'sine', 0.12);
      return false;
    }
    // Runde voll.
    sectorHistory.push(sectorTimes.slice());
    sectorTimes = [];
    sectorIndex = 0;
    renderSectors();
    return true;
  }

  function renderSectors() {
    const host = $('sector-list');
    if (!host) return;
    if (sectorCount <= 1) { host.innerHTML = ''; return; }
    const teile = [];
    if (sectorTimes.length) {
      teile.push('<div class="sess-row"><b>jetzt</b> '
                 + sectorTimes.map((ms, i) => 'S' + (i + 1) + ' ' + formatLapTime(ms))
                     .join(' &middot; ') + '</div>');
    }
    // Die BESTE je Sektor, ueber alle Runden. Das ist die Zahl, aus der eine
    // Ideal-Rundenzeit entsteht: die Summe der besten Sektoren ist schneller als die beste
    // gefahrene Runde, und die Differenz sagt, wieviel noch drin ist.
    if (sectorHistory.length) {
      const beste = [];
      for (let i = 0; i < sectorCount - 1 + 1; i++) {
        const werte = sectorHistory.map(r => r[i]).filter(v => v !== undefined);
        if (werte.length) beste.push(Math.min.apply(null, werte));
      }
      const summe = beste.reduce((a, b) => a + b, 0);
      const rundenSummen = sectorHistory.map(r => r.reduce((a, b) => a + b, 0));
      const besteRunde = rundenSummen.length ? Math.min.apply(null, rundenSummen) : null;
      teile.push('<div class="sess-row"><b>beste</b> '
                 + beste.map((ms, i) => 'S' + (i + 1) + ' ' + formatLapTime(ms))
                     .join(' &middot; ')
                 + ' &rarr; ideal ' + formatLapTime(summe)
                 + (besteRunde !== null && besteRunde > summe
                    ? ' (' + formatLapTime(besteRunde - summe) + ' schneller als die beste '
                      + 'gefahrene Runde)' : '')
                 + '</div>');
      sectorHistory.slice(-5).reverse().forEach((r, k) => {
        teile.push('<div class="sess-row"><b>R' + (sectorHistory.length - k) + '</b> '
                   + r.map((ms, i) => 'S' + (i + 1) + ' ' + formatLapTime(ms))
                       .join(' &middot; ')
                   + ' = ' + formatLapTime(r.reduce((a, b) => a + b, 0)) + '</div>');
      });
    }
    host.innerHTML = teile.join('');
  }

  function playerLapCrossed() {
    const now = Date.now();
    // Sektoren zuerst: war das nur eine Sektorgrenze, ist die Runde nicht vorbei und alles
    // Weitere darf nicht laufen - weder die Rundenzeit noch der Ton noch das Rennende.
    if (!sectorCrossed(now)) return false;
    if (dashLapStart !== null) dashLapTimes.push(now - dashLapStart);
    dashLapStart = now;
    // Mehrspieler: eine Runde ist der Moment, in dem sich die Rangliste wirklich aendert.
    // Defensiv gerufen, weil mpRundeGefahren in 97-sessions.js steht - einer SPAETEREN Datei.
    // Zur Laufzeit ist das unproblematisch, zur Ladezeit waere es die temporale Todeszone,
    // und bei einer function-Deklaration greift die Hochziehung ohnehin.
    if (typeof mpRundeGefahren === 'function') mpRundeGefahren();
    triggerDoppler();

    // Race mode: only count laps while a race is armed. "finishing" means RB/R1 was
    // pressed already — this crossing completes the last lap, then the race ends.
    if (raceFormationLap) { endFormationLap(); return true; }
    if ((raceState === 'racing' || raceState === 'finishing') && raceLapStart !== null) {
      const wasFinishing = raceState === 'finishing';
      const rundeMs = now - raceLapStart;
      // Beste Zeit? VOR dem Einfuegen geprueft, sonst vergleicht die Runde sich mit sich
      // selbst und jede waere die beste.
      const besteBisher = raceLapTimes.length
        ? Math.min.apply(null, raceLapTimes.map(l => l.ms)) : Infinity;
      raceLapTimes.push({ lap: raceLapTimes.length + 1, ms: rundeMs });
      // Die Ereignisse DIESER Runde festhalten und den Zaehler leeren. Dieselbe Reihenfolge
      // wie raceLapTimes, damit der Index die Rundennummer bleibt.
      raceLapEvents.push({ pit: lapEventAkku.pit, crash: lapEventAkku.crash });
      lapEventAkku = { pit: 0, crash: 0 };
      raceLapStart = now;
      // Die erste Runde ist nicht "die beste" - sie ist die einzige, und ein Bestzeit-Ton
      // beim ersten Mal nimmt ihm die Bedeutung fuer alle weiteren.
      playLapChime(raceLapTimes.length > 1 && rundeMs < besteBisher);
      if (wasFinishing) finishRace();
      // Runde 0, nicht 1: das Feld steht auf der Startgeraden und ueberfaehrt Start/Ziel
      // erst am Ende der ersten Runde. Vor der ersten Ueberfahrt ist also noch keine Runde
      // voll, und raceLapTimes.length ist genau diese Zahl.
      // Ueber t(), weil die Rundenzahl darin steht: ein fester Woerterbuchschluessel
      // koennte diesen Satz nie treffen.
      else $('race-status').textContent =
        t('Rennen läuft, Runde') + ' ' + raceLapTimes.length;
    }
    return false;
  }

  // getMinimapCurrentIndex() stand hier und wurde nach dem Entfernen der Minikarte von
  // niemandem mehr gerufen.

  // Position innerhalb der aktuellen Kachel, 0..1. Wie ghostTilePhase(), mit derselben
  // Laengenkorrektur: eine Haarnadel ist dreimal so lang wie eine Gerade, und ohne die
  // Korrektur stuende die Phase dort nach einem Drittel auf 1.
  function dashTilePhase() {
    if (!dashTileAt || !dashTileMs) return 0;
    const f = (typeof ghostTileLenFactor === 'function' && dashMinimapIndex !== null)
      ? ghostTileLenFactor(dashMinimapIndex) : 1;
    return Math.max(0, Math.min(1, (Date.now() - dashTileAt) / (dashTileMs * f)));
  }

  function refreshMinimap() {
    // Die Minikarte ist entfernt worden. Die Positionsverfolgung dahinter bleibt: sie
    // speist den Vorausblick der Ghosts und die Rundenzaehlung, und nur die Anzeige war
    // doppelt. Der Aufruf bleibt deshalb stehen und tut nichts, wenn es kein Element gibt -
    // ein blinder Zugriff darauf wuerde den Fahrtakt abbrechen.
    const el = $('dash-minimap');
    if (!el) return;
    el.innerHTML = (currentTrackTiles.length === 0)
      ? '<p class="muted" style="width:220px">kein Streckenlayout geladen</p>'
      : renderTrackPreview(currentTrackTiles, dashMinimapIndex).html;
  }

  async function ensureDashboardStatusSubscribed() {
    const entry = charByUuid.get(NUS_TX);
    if (!entry || entry._dashSubscribed) return;
    try {
      await entry.char.startNotifications();
      entry.char.addEventListener('characteristicvaluechanged', dashboardNotifyHandler);
      entry._dashSubscribed = true;
    } catch (err) { log('Dashboard-Notify-Fehler: ' + err.message, 'err'); }
  }

  setInterval(() => {
    if ((raceState === 'racing' || raceState === 'finishing') && raceLapStart !== null) {
      $('race-lap-current').textContent = formatLapTime(Date.now() - raceLapStart);
    }
  }, 200);

  // ---- Weather and tyres ----
  // The four states the user described, as a 2x2. Wets on a dry track are deliberately
  // WORSE than slicks on a dry track: they overheat and grease over, which is why a second
  // pit stop is needed to get back to the baseline rather than the weather clearing alone.
  // ---- Der Wetterumschwung als FRONT ------------------------------------------------
  //
  // Regen war ein Schalter: gripScale sprang, der Ton sprang, die Tropfen erschienen. Jetzt
  // zieht eine Front ueber uns hinweg, und ihre Lage ist die EINE Zahl, aus der Ton, Griff,
  // Tropfen und das Radarbild kommen:
  //
  //     wxFront  -1 = im Anmarsch     0 = ueber uns     +1 = durch
  //     Staerke  = max(0, 1 - |wxFront|)
  //
  // Eine zweite Groesse fuer das Bild waere ein zweiter Ort, an dem etwas auseinanderlaufen
  // kann - und dann zeigt das Radar Regen, waehrend es trocken faehrt.
  //
  // NACH DEM ABSCHALTEN ZIEHT SIE WEITER, von 0 auf +1, also mit dem Wind davon. Zurueck auf
  // -1 zu laufen saehe aus wie ein zurueckgespultes Band.
  // ZEHN Sekunden, nicht fuenf. Zwei Gruende, und der zweite ist der eigentliche:
  //
  //   Der Umschwung ist gefahren angenehmer, wenn er nicht hetzt.
  //   Und die Regenformen muessen damit nur halb so schnell ziehen. Sie sollen von
  //   ausserhalb des Radars kommen, und ihr Tempo ist WX_AUS / WX_RAMP_S - bei fuenf
  //   Sekunden zogen sie sichtbar schneller als die weissen Wolken.
  const WX_RAMP_S = 10;
  let wxFront = -1;          // wo die Front steht
  let wxFrontTo = -1;        // wohin sie zieht
  let wxTickAt = 0;

  function wxRainLevel() { return Math.max(0, 1 - Math.abs(wxFront)); }

  // ---- Das Regenradar ---------------------------------------------------------------
  //
  // ZWEI GETRENNTE SACHEN, und die Trennung ist die Lehre aus dem ersten Anlauf:
  //
  //   wxFront    die Rampe fuer Ton, Griff und Tropfen. Eine Zahl, fuenf Sekunden.
  //   die Formen ziehen mit dem Wind und werden nachgeliefert, solange Regen an ist.
  //
  // Der erste Anlauf hatte die Regenformen in einem BAND, dessen Lage wxFront WAR. Das war
  // eine Zahl fuer alles und als Bild falsch: die Formen standen halb sichtbar im Bild,
  // waehrend die weissen vorbeizogen, und wenn die Rampe fertig war, standen sie still.
  //
  // Entkoppelt sind sie trotzdem nicht: die Regenformen ziehen genau so schnell, dass die
  // erste die Mitte nach fuenf Sekunden erreicht - dieselben fuenf, die die Rampe braucht.
  //
  // WARUM SIE SCHNELLER ZIEHEN ALS DIE WEISSEN: sie sollen von AUSSERHALB des Radars kommen,
  // und mit dem Tempo der weissen Wolken braeuchten sie dafuer vierzehn Sekunden. Auf einem
  // echten Radar ist das ebenso - die Niederschlagsechos ziehen mit der Front, die hohe
  // Wolkendecke steht fast. Die Richtung ist dieselbe.
  const WX_WIND = { x: 0.86, y: -0.51 };     // Zugrichtung, normiert
  const WX_AUS = 1.25;                        // ab hier ist eine Form aus dem Bild
  const WX_REGEN_V = WX_AUS / WX_RAMP_S;      // damit die erste nach der Rampe in der Mitte ist
  // 0,18 statt 0,34: die Formen sollen sich UEBERLAPPEN. Mit Luecken dazwischen sieht ein
  // Dauerregen aus wie einzelne Schauer, und gemeldet war genau das - "sonst sind Luecken
  // dazwischen, aber es regnet konstant weiter".
  const WX_ABSTAND = 0.18;

  // Je Form vier radiale Oberwellen. DAS ist die Kontur: r(winkel) = 1 + Summe der Wellen,
  // und jede dreht langsam mit eigener Rate, wodurch der Rand kriecht. Auf dem Canvas ist
  // das dasselbe, was feTurbulence + feDisplacementMap in einem SVG tun.
  //
  // Die Wellenzahlen 2/3/5/7 sind teilerfremd gewaehlt: 2 und 4 zusammen ergeben eine
  // sichtbar zweizaehlige, also kuenstlich wirkende Form.
  //
  // KEINE UNTERSCHEIDUNG MEHR ZWISCHEN REGEN UND WOLKE. Die Regenformen hatten Amplituden
  // bis 0,31, und damit sahen sie nach BLUMEN aus: vier kraeftige Wellen auf einem Kreis
  // ergeben Blaetter, keine Wolke. Die weissen mit bis 0,19 sahen richtig aus, also gilt
  // dieser Satz jetzt fuer beide - gemeldet als "die Regenwolken sehen aus wie Blumen".
  //
  // Und die Drehraten sind grosszuegiger (0,38 statt 0,22): die Form soll sich DAUERHAFT
  // aendern, nicht nur unmerklich kriechen. Vier Wellen mit verschiedenen Raten wiederholen
  // sich praktisch nie.
  function wxWellen() {
    return [2, 3, 5, 7].map((k) => ({
      k,
      a: 0.06 + Math.random() * 0.12,
      p: Math.random() * 6.2832,
      w: (Math.random() * 2 - 1) * 0.38,
    }));
  }

  const wxBlobs = [];
  function wxBlobBauen(n, regen) {
    for (let i = 0; i < n; i++) {
      wxBlobs.push({
        regen,
        wellen: wxWellen(),
        // DOPPELTE GROESSE, wie gewuenscht. Und bei den Regenformen ist sie zugleich das
        // Mittel gegen Luecken: zwei Formen im Abstand 0,18 mit Radius um 0,25 ueberlappen
        // sich sicher.
        basis: (regen ? 0.2 : 0.17) + Math.random() * (regen ? 0.15 : 0.11),
        l: regen ? -WX_AUS - i * WX_ABSTAND : Math.random() * 2 - 1,
        quer: (Math.random() * 2 - 1) * (regen ? 0.7 : 1.0),
        tempo: regen ? WX_REGEN_V : 0.055 + Math.random() * 0.05,
        deck: regen ? 1 : 0.09 + Math.random() * 0.07,
        // Regenformen ziehen nur, wenn sie geschickt wurden. Ohne dieses Flag stehen sie
        // vor dem ersten Klick im Bild - genau der gemeldete Fehler.
        aktiv: !regen,
        weg: 0,           // laeuft aus: ausblenden und dann stilllegen
      });
    }
  }
  wxBlobBauen(14, false);
  // 18 Regenformen statt 11: mit dem dichteren Abstand reicht der Strom damit ueber die
  // ganze Breite, und dazwischen bleibt keine Luecke.
  wxBlobBauen(18, true);

  // Nachschub anschalten: alle Regenformen von aussen losschicken, hintereinander. Solange
  // Regen an ist, wird jede am Ausgang neu hinten angestellt - der Strom hoert nicht auf.
  function wxRegenLosschicken() {
    let k = 0;
    for (const b of wxBlobs) {
      if (!b.regen) continue;
      b.aktiv = true;
      b.weg = 0;
      b.l = -WX_AUS - k * WX_ABSTAND;
      b.quer = (Math.random() * 2 - 1) * 0.7;
      b.wellen = wxWellen();
      k++;
    }
  }

  // Nachschub abschalten. Wer die Mitte noch NICHT erreicht hat, wird ausgeblendet - er
  // gehoert zu einem Regen, der nicht mehr kommt. Wer durch ist, zieht weiter davon: genau
  // das heisst "die Front ist vorbei".
  function wxRegenAbbestellen() {
    for (const b of wxBlobs) {
      if (b.regen && b.aktiv && b.l < -0.05) b.weg = 1;
    }
  }

  // ---- Fortbewegen, GETRENNT vom Zeichnen -------------------------------------------
  //
  // Es stand vorher IN wxRadarDraw, und das war ein Entwurfsfehler: die Zeichenfunktion
  // kehrt bei verstecktem Fenster und bei ungezeichneter Kachel frueh zurueck, und dann
  // standen die Formen still, waehrend die Rampe weiterlief. Ort und Zeit liefen
  // auseinander - beim Zurueckkommen stand die Front woanders als die Zahl sagte.
  //
  // Bewegen ist Zustand, Zeichnen ist Anzeige. Der Takt bewegt immer, gezeichnet wird nur,
  // wenn jemand hinsieht.
  function wxBlobsWeiter(dt) {
    const regenAn = wxFrontTo === 0;
    for (const b of wxBlobs) {
      if (b.regen) {
        if (!b.aktiv) continue;
        b.l += b.tempo * dt;
        if (b.weg) {
          // Ausblenden, dann stilllegen. Sichtbar bleibt eine halbe Sekunde.
          b.weg -= dt / 0.5;
          if (b.weg <= 0) { b.aktiv = false; continue; }
        }
        if (b.l > WX_AUS) {
          // Hinten neu anstellen, solange Regen an ist. Das ist der unendliche Nachschub.
          if (regenAn && !b.weg) {
            b.l = -WX_AUS;
            b.quer = (Math.random() * 2 - 1) * 0.7;
            b.wellen = wxWellen();
          } else {
            b.aktiv = false;
          }
        }
      } else {
        // Weisse Wolken ziehen endlos und werden umgeschlagen. 2,6 ist grosszuegiger als
        // das Bild, damit keine Form sichtbar aus dem Nichts erscheint.
        b.l += b.tempo * dt;
        if (b.l > 1.3) b.l -= 2.6;
      }
    }
  }

  function wxRadarDraw() {
    const cv = $('race-wx-radar');
    if (!cv || document.hidden || !cv.clientWidth) return;
    // Auf die tatsaechliche Anzeigegroesse ziehen: ein Canvas mit falscher Pufferbreite wird
    // von der Grafikkarte skaliert und sieht unscharf aus.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(cv.clientWidth * dpr), bh = Math.round(cv.clientHeight * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height, S = Math.max(W, H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d1219';
    g.fillRect(0, 0, W, H);

    // Gitter: fein und dunkel, damit die Formen davor stehen.
    g.strokeStyle = 'rgba(255,255,255,0.055)';
    g.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const x = Math.round(W * k / 4) + 0.5, y = Math.round(H * k / 4) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    const t = Date.now() / 1000;
    const mx = W / 2, my = H / 2;

    // GRUNDFAERBUNG, getragen von der Regenstaerke. Sie ist der Teil, der "es regnet HIER"
    // sagt, und sie schliesst die Luecken, die einzelne Formen unvermeidlich lassen: bei
    // Dauerregen ist die ganze Flaeche belegt, nicht ein Muster aus Schauern.
    //
    // Sie ersetzt die Formen nicht, sondern liegt darunter - die Formen geben die Textur und
    // die Bewegung, die Faerbung die Aussage. Nur eines von beiden waere entweder ein
    // gleichmaessiger blauer Kasten oder ein Schauermuster.
    const stk = wxRainLevel();
    if (stk > 0.01) {
      g.fillStyle = 'rgba(104,166,186,' + (0.3 * stk).toFixed(3) + ')';
      g.fillRect(0, 0, W, H);
    }

    for (const b of wxBlobs) {
      if (b.regen && !b.aktiv) continue;
      const spanne = 0.62;
      const cx = mx + (WX_WIND.x * b.l + -WX_WIND.y * b.quer) * S * spanne;
      const cy = my + (WX_WIND.y * b.l + WX_WIND.x * b.quer) * S * spanne;
      let deck = b.deck;
      if (b.regen && b.weg) deck *= Math.max(0, b.weg);
      if (deck <= 0.004) continue;

      // ---- zeichnen: drei geschachtelte Zonen, EINFARBIG ----
      // Aus dem Vorbild uebernommen ist die Abstufung, nicht die Farbpalette: ein
      // Niederschlagsecho ist aussen schwach und innen kraeftig. Vier Blautoene waeren eine
      // zweite Vokabel; drei Deckkraftstufen derselben Farbe sagen dasselbe.
      // ZWEI Stufen fuer beide, nicht drei fuer den Regen. Die dritte, engste Fuellung hat
      // die Wellenbaeuche betont und damit den Blumeneindruck verstaerkt.
      const stufen = b.regen
        ? [[1.0, 0.34], [0.68, 0.3]]
        : [[1.0, 0.62], [0.66, 0.5]];
      const N = 44;
      for (const [rf, af] of stufen) {
        g.beginPath();
        for (let i = 0; i <= N; i++) {
          const th = i / N * 6.2832;
          let rr = 1;
          for (const w of b.wellen) rr += w.a * Math.sin(w.k * th + w.p + w.w * t);
          rr = Math.max(0.4, rr) * b.basis * rf * S;
          const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath();
        const a2 = (deck * af).toFixed(3);
        g.fillStyle = b.regen ? 'rgba(104,166,186,' + a2 + ')'
                              : 'rgba(226,236,246,' + a2 + ')';
        g.fill();
      }
    }

    // Das Kreuz und der Punkt: wo WIR sind. Zuletzt gezeichnet, damit es ueber den Formen
    // liegt - es ist der Bezugspunkt fuer alles andere.
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = Math.max(1, dpr);
    g.beginPath();
    g.moveTo(mx, my - H * 0.18); g.lineTo(mx, my + H * 0.18);
    g.moveTo(mx - W * 0.14, my); g.lineTo(mx + W * 0.14, my);
    g.stroke();
    g.fillStyle = wxRainLevel() > 0.12 ? '#68a6ba' : '#e2ecf6';
    g.beginPath();
    g.arc(mx, my, Math.max(1.6, 2.1 * dpr), 0, 6.2832);
    g.fill();
  }

  // Eigener Zeitgeber und nicht im Fahrtakt: das Wetter zieht auch, wenn niemand faehrt -
  // im Menue, in der Garage, beim Zuschauen. 80 ms sind fuer ziehende Wolken reichlich.
  function wxTick() {
    const now = Date.now();
    const dt = wxTickAt ? Math.min(0.5, (now - wxTickAt) / 1000) : 0;
    wxTickAt = now;
    if (wxFront !== wxFrontTo) {
      const schritt = dt / WX_RAMP_S;
      const d = wxFrontTo - wxFront;
      wxFront = Math.abs(d) <= schritt ? wxFrontTo : wxFront + Math.sign(d) * schritt;
      applySurface();
    }
    wxBlobsWeiter(dt);
    wxRadarDraw();
  }
  setInterval(wxTick, 80);

  const GRIP_MATRIX = {
    'dry|slick': 1.00,
    'dry|wet':   0.88,
    'rain|wet':  0.80,
    'rain|slick': 0.45,
  };
  let weather = 'dry';
  let tyres = 'slick';

  function applySurface() {
    // DAS PIKTOGRAMM ZEIGT DIE MISCHUNG. Hier und nicht bei fitTyresForWeather(): das ist
    // nur EIN Weg zu einem Reifenwechsel, applySurface() laeuft bei jedem - Boxenstopp,
    // Wetterwechsel, Aufbau. Eine Klasse je Weg zu setzen ist die Gelegenheit, einen zu
    // vergessen, und dann zeigt der Reifen die Mischung von vorletzter Runde.
    document.body.classList.toggle('tyres-wet', tyres === 'wet');
    // GEMISCHT statt geschaltet. Der Griff wandert zwischen der trockenen und der nassen
    // Zeile der Matrix - dieselben Endwerte wie vorher, nur nicht mehr in einem Sprung.
    //
    // Die Staerke geht QUADRATISCH in den Griff. Das ist kein Feinschliff, sondern die
    // Aussage: Wasser braucht Zeit, sich auf der Bahn zu sammeln. Nach der Haelfte der
    // Rampe ist der Ton schon halb da und zu sehen ist Regen, aber gefahren wird noch fast
    // trocken - nach 2,5 s ein Viertel des Effekts. Genau darum ging es bei "erst nach 5 s
    // soll das Handling reagieren".
    const lvl = wxRainLevel();
    const griff = lvl * lvl;
    const trocken = GRIP_MATRIX['dry|' + tyres] ?? 1.0;
    const nass = GRIP_MATRIX['rain|' + tyres] ?? 1.0;
    physEngine.config.gripScale = trocken + (nass - trocken) * griff;
    // Only slicks aquaplane; wets are cut to move water. Der Faktor darf gebrochen sein:
    // die Physik rechnet 1 - aquaplaning * ueber^2, also multipliziert er ohnehin.
    physEngine.config.aquaplaning = tyres === 'slick' ? griff : 0;
    setAmbienceRainLevel(lvl);
    // Das Regenlicht und die Tropfen haengen an der SICHTBAREN Front und nicht am
    // quadratischen Griff: man sieht Regen, bevor man ihn faehrt.
    lightFx.rain = lvl > 0.12;
    setRainVisuals(lvl);
  }

  function setWeather(next) {
    if (weather === next) return;
    weather = next;
    const cb = $('setting-rain');
    if (cb) cb.checked = (weather === 'rain'); // keep the options switch in step
    // NUR DAS ZIEL SETZEN, den Weg macht wxTick. Und wenn die Front schon durch ist (+1),
    // faengt eine neue von vorn an - sonst wuerde sie rueckwaerts ueber uns zurueckkommen.
    if (weather === 'rain') {
      if (wxFront >= 0.999) wxFront = -1;
      wxFrontTo = 0;
      wxRegenLosschicken();
    } else {
      // DER KUERZERE WEG, wenn die Front noch nicht angekommen ist.
      //
      // Vorher ging sie immer auf +1, also mit dem Wind weiter. Wer an- und sofort wieder
      // ausschaltet, stand damit bei -0,95 und musste 1,95 Einheiten laufen: gemeldet als
      // "dauert noch 20 Sekunden".
      //
      // Beide Richtungen sind physikalisch sinnvoll, und welche gilt, entscheidet die Lage:
      // eine Front, die noch nicht da ist, kann abdrehen (zurueck auf -1, kurzer Weg); eine,
      // die durch ist, zieht weiter (auf +1). Nur letzteres saehe zurueckgespult aus.
      wxFrontTo = wxFront < 0 ? -1 : 1;
      wxRegenAbbestellen();
    }
    applySurface();
    // Audible confirmation: the switch lives on a controller button, where there is nothing
    // to look at. Rain announces itself with a thunder clap, dry with a short two-tone.
    if (weather === 'rain' && ambience.thunder && ambience.thunder.length) {
      playAmbienceOneShot(ambience.thunder[0], 0.7, true);
    } else if (weather === 'dry') {
      playTone(520, 0.10, 'sine', 0.14);
      setTimeout(() => playTone(780, 0.16, 'sine', 0.14), 110);
    }

    const need = (weather === 'rain' && tyres === 'slick') || (weather === 'dry' && tyres === 'wet');
    showHudToast(weather === 'rain' ? 'Regen' : 'Trocken');
    log('Wetter: ' + (weather === 'rain' ? 'Regen' : 'trocken') + ': Reifen: '
        + (tyres === 'wet' ? 'Regen' : 'Slicks')
        + (need ? ' (Boxenstopp für passende Reifen)' : ''), 'info');
    padRumble(0.2, 0.15, 120);
  }

  function fitTyresForWeather() {
    const want = weather === 'rain' ? 'wet' : 'slick';
    if (tyres === want) return false;
    tyres = want;
    applySurface();
    showHudToast(want === 'wet' ? 'Regenreifen montiert' : 'Slicks montiert');
    log('Boxenstopp: ' + (want === 'wet' ? 'Regenreifen' : 'Slicks') + ' montiert.', 'info');
    return true;
  }

  // ---- Pit lane ----
  // Driving over the marker sheet arms a 40% limiter. Come to a stand while limited and
  // servicing begins; it accrues for as long as you keep still, so a longer stop buys
  // more fuel and more repair. Drive off and the limiter lifts.
  //
  // The marker is identified by the tile-type byte the car reports (byte 12). We know
  // four of those codes for certain now (01 start/finish, 02 straight, 03 left curve,
  // 04 right curve) and we cannot derive a NEW one for the pit marker from the printed
  // pattern alone, so the trigger code is a setting rather than a constant — see the note
  // in the Strecke tab.
  //
  // Default is UNSET (null), not a guess. It used to default to 0x08 — which, at the time,
  // looked like the next plausible code in sequence but has since been PROVEN to never
  // occur on the wire at all (the confirmed alphabet is 0x00/0x01/0x02/0x03/0x04/0xff).
  // A wrong-but-plausible-looking default is worse than an obviously empty one: it silently
  // guarantees the pit lane can never trigger, and nothing in the UI said so. null makes
  // every comparison against it false until the Muster-Sonde has actually measured a value.
  let pitLaneEnabled = true;

  // ---- Wo ist die Boxengasse? Drei Varianten ----
  //
  // 'anywhere'  Vorgabe. Ein angeforderter Boxenstopp wird durch Anhalten bedient, egal wo.
  //             Braucht keinen Ausdruck und keine Schiene.
  // 'offtrack'  Der Stopp wird von HAND angefordert und beginnt erst, wenn Byte 12 den
  //             Wert 0x00 meldet, das Auto also neben der Bahn steht. Nur auf der
  //             CH-Schiene sinnvoll, weil nur dort "abseits" eine Bedeutung hat.
  //             Loeste bis v0.4.43 von selbst aus, sobald das Auto die Bahn verliess -
  //             damit war jeder Abflug eine Boxeneinfahrt.
  // 'double'    Experimentell: zwei Ausdrucke im Abstand von 50 cm.
  let pitTrigger = 'anywhere';
  // Zaehlt die Runde beim Boxeneinfahren trotzdem? Vorgabe nein - eine Boxeneinfahrt ist
  // keine Runde. Wer die Zaehlung lieber durchlaufen laesst, kann es umstellen.
  let pitDoubleCountsLap = false;

  // Zwei Kontakte innerhalb von 3 s bei mindestens 1 s Abstand. Die untere Grenze ist der
  // wichtigere Teil: ein einzelner Ausdruck haelt bei Fahrt etwa eine Sekunde Kontakt, und
  // ohne Mindestabstand wuerde das Flattern EINES Musters als Paar gelesen.
  const PIT_DOUBLE_WINDOW_MS = 3000;
  const PIT_DOUBLE_MIN_MS = 1000;
  // Danach 4 s Tempolimit. Haelt das Auto in dieser Zeit, beginnt der Service von selbst.
  const PIT_DOUBLE_LIMIT_MS = 4000;
  const PIT_DOUBLE_KMH = 60;
  // Dieselbe Rechnung wie PIT_SPEED_FACTOR, nur mit 60 statt 80: der angezeigte Tacho ist
  // speedKmh * REAL_SCALE, und topSpeedKmh ist 4,0.
  const PIT_DOUBLE_SPEED_FACTOR = PIT_DOUBLE_KMH / REAL_SCALE / 4.0;
  // Einmal melden und nicht 22 Mal je Sekunde: der Hinweis "neben die Strecke fahren"
  // kommt aus dem Fahrtakt, und ein Hinweis, der den Bildschirm zunagelt, ist kein Hinweis.
  let pitOrtGemeldet = false;
  let pitDoubleFirstAt = 0;
  let pitDoubleArmedUntil = 0;
  let pitMarkerCode = null;
  // 80 km/h on the racing display, the speed a real pit lane limiter holds. The display
  // reads speedKmh * REAL_SCALE (71.25), so 80 / 71.25 / 4.0 top speed = 0.2807.
  const PIT_SPEED_FACTOR = 80 / REAL_SCALE / 4.0;
  let pitState = 'off';        // off | limited | servicing
  let pitServiceStart = null;
  let pitFuelGained = 0, pitDamageRepaired = 0;
  const PIT_FUEL_PER_SEC = 22;
  // Repair speed used to be this flat 18%/s constant; replaced by repairRateAt() above,
  // which is non-linear and driven by the "Vollstaendige Reparatur dauert" setting.
  // Same number the drivetrain calls walking pace, so "the car is standing" means one
  // thing everywhere: 10 km/h on the racing display.
  const PIT_STANDSTILL_KMH = 10 / REAL_SCALE;

  function setPitState(next) {
    if (pitState === next) return;
    pitState = next;
    // Die Variante 'double' nennt ausdruecklich 60 km/h, die anderen fahren mit den
    // 80 km/h der Boxengasse. Beide Faktoren werden HIER gewaehlt, damit es weiter genau
    // eine Stelle gibt, an der das Boxenlimit gesetzt wird.
    limitPit = (next === 'off') ? 1
             : (pitTrigger === 'double' ? PIT_DOUBLE_SPEED_FACTOR : PIT_SPEED_FACTOR);
    applySpeedLimit();
    // Nachlauf-Wecker. Das Ausfahrtmuster wird nicht immer gelesen - ein Muster, das
    // nicht gelesen wird, laesst den Limiter sonst bis zum Rundenende an, und das ist der
    // Unterschied zwischen "Boxenstopp" und "Rennen gelaufen". Fuenf Sekunden nach dem
    // Ende der Arbeit geht er von selbst aus.
    if (pitLimiterTimer) { clearTimeout(pitLimiterTimer); pitLimiterTimer = null; }
    if (next === 'limited') {
      pitLimiterTimer = setTimeout(() => {
        pitLimiterTimer = null;
        if (pitState !== 'limited') return;
        log('Pit-Limiter nach ' + (PIT_LIMITER_MAX_MS / 1000) + ' s von selbst aus: '
            + 'das Ausfahrtmuster wurde nicht gelesen.', 'info');
        setPitState('off');
      }, PIT_LIMITER_MAX_MS);
    }
    if (next === 'servicing') {
      pitServiceStart = Date.now();
      pitFuelGained = 0; pitDamageRepaired = 0;
      pitDone = { refuel: false, tyres: false, repair: false };
      pitTyreElapsed = 0; pitEmptyElapsed = 0; pitStandElapsed = 0; pitReady = false;
      pitTyreTarget = Math.max(1.5, gaussian(PIT_TYRE_CHANGE_S, PIT_TYRE_CHANGE_SD));
      // The plan was chosen while rolling down the pit lane; only now is it locked in.
      if (!pitPlan) pitPlan = makePitPlan();
      if (pitPlan.tyres) {
        fitTyresForWeather();  // automatic, as requested
        resetTyres();          // new tyres come out of the blankets cold and unworn
        setPitLoop('wrench', true);
      }
      if (pitPlan.refuel) setPitLoop('fuel', true);
      if (pitPlan.repair) setPitLoop('repair', true);
      padRumble(0.25, 0.15, 120);
      log(`Boxenstopp: ${describePitPlan(pitPlan)}.`, 'info');
    } else if (next === 'limited') {
      // Arm the plan HERE, not at the service: the quick menu is meant to be used while
      // rolling in, which is the only time there is to think about it.
      pitPlan = makePitPlan();
      pitReady = false;
      log(`Boxengasse: Tempolimit ${Math.round(PIT_SPEED_FACTOR * 100)}% aktiv. `
          + `Geplant: ${describePitPlan(pitPlan)}.`, 'info');
    } else {
      stopAllPitLoops();
      // Read before clearing: the standing time decides whether the stop was served.
      const stoodLongEnough = pitStandElapsed >= PIT_MANDATORY_STAND_S;
      pitPlan = null; pitDone = null; pitReady = false;
      if (pitServiceStart !== null) {
        playTone(440, 0.12, 'sine', 0.18);
        setTimeout(() => playTone(660, 0.22, 'sine', 0.18), 120); // rising: throttle released
        padRumble(0.25, 0.15, 120);
      }
      // A mandatory stop counts after PIT_MANDATORY_STAND_S of standing time. Requiring the
      // whole service to finish would have punished the legitimate choice to take fuel only
      // and go; requiring nothing at all would let a roll-through satisfy the rule. Standing
      // time is the thing the rule is actually about.
      if (pitServiceStart !== null && stoodLongEnough
          && (raceState === 'racing' || raceState === 'finishing')) {
        racePitDone++;
        if (racePitRequired > 0) {
          log(`Pflichtboxenstopp ${Math.min(racePitDone, racePitRequired)} von ${racePitRequired} erledigt `
              + `(${pitStandElapsed.toFixed(1)} s gestanden).`, 'info');
        }
      } else if (pitServiceStart !== null && !stoodLongEnough && racePitRequired > 0
                 && (raceState === 'racing' || raceState === 'finishing')) {
        log(`Boxenstopp zu kurz (${pitStandElapsed.toFixed(1)} s von `
            + `${PIT_MANDATORY_STAND_S.toFixed(0)} s), zählt nicht als Pflichtstopp.`, 'err');
      }
      if (pitServiceStart !== null) {
        log(`Boxenstopp beendet nach ${((Date.now() - pitServiceStart) / 1000).toFixed(1)}s: ` +
            `+${fuelLiters(pitFuelGained)} l Sprit, -${Math.round(pitDamageRepaired)}% Schaden.`, 'info');
      }
      pitServiceStart = null;
    }
    refreshPitThrottleLock();
    updatePitUI();
  }

  // Variante 'double': war das der zweite Kontakt eines Paares?
  //
  // Aufgerufen NACH playerLapCrossed(), damit die Runde mit ihrer richtigen Zeit gezaehlt
  // ist, bevor hier ueber sie entschieden wird.
  function pitDoubleCheck(jetzt) {
    if (!pitLaneEnabled || pitTrigger !== 'double') return;
    const seit = jetzt - pitDoubleFirstAt;
    if (pitDoubleFirstAt && seit >= PIT_DOUBLE_MIN_MS && seit <= PIT_DOUBLE_WINDOW_MS) {
      // Paar erkannt. Der Boxenstopp beginnt erst JETZT, nach dem zweiten Muster - so
      // steht es in der Anforderung, und es ist auch das Richtige: nach dem ersten weiss
      // niemand, ob eine Einfahrt gemeint war.
      pitDoubleFirstAt = 0;
      if (!pitDoubleCountsLap) retractLap('doppelter Start-Ausdruck, Boxeneinfahrt');
      pitDoubleArmedUntil = jetzt + PIT_DOUBLE_LIMIT_MS;
      setPitState('limited');
      // Das Piepen: dasselbe wie die Boxengassen-Meldung, damit es nicht ein weiterer Ton
      // ist, den man lernen muss.
      playTone(880, 0.12, 'square', 0.16);
      setTimeout(() => playTone(880, 0.12, 'square', 0.16), 180);
      showHudToast('BOXENGASSE AKTIV, ' + PIT_DOUBLE_KMH + ' KM/H');
      log('Boxengasse per doppeltem Ausdruck: zweiter Kontakt nach ' + seit
          + ' ms, Tempolimit ' + PIT_DOUBLE_KMH + ' km/h fuer '
          + (PIT_DOUBLE_LIMIT_MS / 1000) + ' s. Anhalten startet den Service.', 'info');
      return;
    }
    // Kein Paar: dieser Kontakt ist der moegliche ERSTE eines neuen.
    pitDoubleFirstAt = jetzt;
  }

  function onPitMarkerCrossed() {
    if (!pitLaneEnabled || pitState !== 'off') return;
    // Just aborted: do not drag the car straight back in while it is still on the marker.
    if (Date.now() < pitRearmBlockedUntil) return;
    setPitState('limited');
    showHudToast('Boxengasse, Tempolimit');
  }

  // Driven from the control heartbeat so it advances at a steady rate regardless of how
  // often the car happens to send notifications.
  let pitLastTick = null;
  function pitLaneTick() {
    const now = Date.now();
    const dt = pitLastTick ? Math.min(0.5, (now - pitLastTick) / 1000) : 0;
    pitLastTick = now;

    // Variante 'double': das 4-Sekunden-Fenster laeuft ab. Wer in dieser Zeit nicht anhaelt,
    // faehrt durch - und dann ist die Boxengasse wieder aus, statt dass das Tempolimit
    // haengen bleibt.
    if (pitTrigger === 'double' && pitDoubleArmedUntil
        && now > pitDoubleArmedUntil && pitState === 'limited') {
      pitDoubleArmedUntil = 0;
      setPitState('off');
      showHudToast('BOXENGASSE VORBEI');
      log('Boxengasse per doppeltem Ausdruck: nicht angehalten, Fenster abgelaufen.', 'info');
      return;
    }

    if (pitState === 'off') return;

    // Absolute value: any NEGATIVE speed would otherwise satisfy this and start a pit
    // service while the car is reversing away.
    const stopped = Math.abs(physEngine.state.speedKmh) < PIT_STANDSTILL_KMH && Math.abs(throttleY) < 0.1;
    // Im Modus "Neben der Strecke" gehoert zum Anfangen mehr als Stillstand: das Auto muss
    // auch neben der Bahn stehen. Das ist die Haelfte des Modus, die geblieben ist, nachdem
    // die Selbstausloesung weg ist - der Knopf sagt DASS ein Stopp kommt, die Bahnkante WO.
    //
    // Gelesen wird die ENTPRELLTE Lage (istAbseits, Vorgabe 1 s durchgehend), nicht das
    // rohe Byte: ein einzelnes 0x00 zwischen zwei Kacheln ist kein Ort. Genau diese
    // Entprellung hat schon bei den Ghosts einen Fehler gekostet.
    // Direkt gerufen und nicht mit typeof abgesichert: istAbseits() ist eine
    // Funktionsdeklaration im selben Skriptblock und damit hochgezogen - genau wie
    // stopGhost(), das von hier aus schon immer gerufen wird. Eine Wache, die nie greifen
    // kann, liest sich wie eine echte und verdeckt, dass die Abhaengigkeit sicher ist.
    const amOrt = pitTrigger !== 'offtrack' || istAbseits();
    if (pitState === 'limited' && stopped && amOrt) { setPitState('servicing'); return; }
    if (pitState === 'limited' && stopped && !amOrt && !pitOrtGemeldet) {
      pitOrtGemeldet = true;
      showHudToast('NEBEN DIE STRECKE FAHREN');
      log('Boxenstopp angefordert, aber das Auto steht auf der Bahn: der Service beginnt '
          + 'erst neben der Strecke.', 'info');
    }
    if (!stopped) pitOrtGemeldet = false;

    if (pitState === 'servicing') {
      if (!stopped) { setPitState('off'); showHudToast('Boxengasse verlassen'); return; }
      const p = pitPlan || {};
      pitStandElapsed += dt;

      // --- refuel ---
      if (p.refuel && !pitDone.refuel) {
        const addFuel = Math.min(100 - fuel, PIT_FUEL_PER_SEC * dt);
        fuel += addFuel; pitFuelGained += addFuel;
        if (fuel >= 99.95) { fuel = 100; pitDone.refuel = true;
                             setPitLoop('fuel', false); pitChimeFuel();
                             showHudToast(`Tank voll, ${fuelLiters(100)} l`); }
      }
      // --- repair --- non-linear, see repairRateAt()
      if (p.repair && !pitDone.repair) {
        const fixDamage = Math.min(damage, repairRateAt(damage) * dt);
        damage -= fixDamage; pitDamageRepaired += fixDamage;
        if (damage <= 0.05) { damage = 0; pitDone.repair = true;
                              setPitLoop('repair', false); pitChimeRepair();
                              showHudToast('Auto repariert'); }
      }
      // --- tyres --- a fixed job with a per-stop duration, and the rattle is its clock
      if (p.tyres && !pitDone.tyres) {
        pitTyreElapsed += dt;
        if (pitTyreElapsed >= pitTyreTarget) {
          pitDone.tyres = true; setPitLoop('wrench', false); pitChimeTyres();
          showHudToast(`Reifen gewechselt, ${pitTyreElapsed.toFixed(1)} s`);
        }
      }
      // The pad keeps buzzing while anything is still being worked on.
      pitRumbleWhileWorking((p.refuel && !pitDone.refuel)
                            || (p.repair && !pitDone.repair)
                            || (p.tyres && !pitDone.tyres));
      // --- nothing to do: a flat standing time, so entering the pits still costs something
      if (pitPlanEmpty(p)) pitEmptyElapsed += dt;

      const allDone = pitPlanEmpty(p)
        ? pitEmptyElapsed >= PIT_EMPTY_STOP_S
        : (!p.refuel || pitDone.refuel) && (!p.tyres || pitDone.tyres) && (!p.repair || pitDone.repair);

      if (allDone && !pitReady) {
        pitReady = true;
        // Beim FERTIGWERDEN und nicht beim Einfahren: wer abbricht, hatte keinen Stopp.
        lapEventAkku.pit += 1;
        stopAllPitLoops();
        pitChimeReady();
        padRumble(0.35, 0.2, 200);
        showHudToast('Fertig, losfahren!');
        log('Boxenstopp fertig.', 'info');
      }

      refreshPitThrottleLock();
      pitBoard();
      updateDamageFuelUI();
      updatePitUI();
    }
  }

  $('pit-enable').addEventListener('change', (e) => {
    pitLaneEnabled = e.target.checked;
    if (!pitLaneEnabled) setPitState('off');
  });
  $('sector-count').addEventListener('change', (e) => {
    sectorCount = Math.max(1, parseInt(e.target.value, 10) || 1);
    sectorReset();
    sectorHistory = [];
    renderSectors();
    if (sectorCount > 1 && trackMode === 'on') {
      // Kein stiller Fehlschlag: mit Bahn ist die Einstellung nicht falsch, sondern
      // bedeutungslos, und das gehoert gesagt statt dass man auf Sektorzeiten wartet, die
      // nie kommen.
      showHudToast('SEKTOREN BRAUCHEN DEN AUSDRUCK-MODUS');
      log('Sektoren sind auf ' + sectorCount + ' gestellt, aber die Leseart ist "Bahn". '
          + 'Auf der Schiene gibt es genau ein Start/Ziel, also bleibt jede Ueberfahrt eine '
          + 'Runde. Im Cockpit auf "Ausdruck" umschalten.', 'err');
    } else {
      log('Sektoren: ' + (sectorCount <= 1 ? 'aus'
          : sectorCount + ' Ueberfahrten je Runde'), 'info');
    }
  });

  $('pit-trigger').addEventListener('change', (e) => {
    pitTrigger = e.target.value;
    // Beim Umschalten aufraeumen: ein halb erkanntes Paar oder ein laufendes Limit der
    // vorigen Variante haette sonst noch Wirkung, obwohl die Variante gewechselt hat.
    pitDoubleFirstAt = 0;
    pitDoubleArmedUntil = 0;
    if (pitState !== 'off') setPitState('off');
    // Die Zusatzoption gilt nur fuer 'double', also wird sie nur dort gezeigt. Ein
    // Ankreuzfeld, das in der gewaehlten Variante nichts bedeutet, ist eine Frage ohne
    // Antwort.
    const wrap = $('pit-double-lap-wrap');
    // '' und nicht 'flex': die Zeile ist jetzt eine .opt-row und traegt ihr display
    // aus dem Stilblock. Ein festes 'flex' waere die dritte Stelle, an der dieses
    // Layout steht.
    if (wrap) wrap.style.display = pitTrigger === 'double' ? '' : 'none';
    log('Boxengasse: ' + (pitTrigger === 'anywhere' ? 'ueberall halten'
        : pitTrigger === 'offtrack' ? 'neben der Strecke (Byte 12 = 0x00)'
        : 'doppelter Start-Ausdruck, 2 Kontakte in ' + (PIT_DOUBLE_WINDOW_MS / 1000)
          + ' s bei mindestens ' + (PIT_DOUBLE_MIN_MS / 1000) + ' s Abstand'), 'info');
  });
  $('pit-double-lap').addEventListener('change', (e) => {
    pitDoubleCountsLap = e.target.checked;
  });
  // Beim Laden verstecken, weil die Vorgabe 'anywhere' ist.
  if ($('pit-double-lap-wrap')) $('pit-double-lap-wrap').style.display = 'none';

  // HIER STAND DER LESER FUER pit-marker-code, das Eingabefeld des Boxengassen-Ausloesecodes.
  // Er ist mit der Karte heraus (siehe den auskommentierten Block in 00-index.head.html),
  // und zwar GELOESCHT und nicht mit einer Wache stehengelassen: ein Leser fuer ein Element,
  // das es nicht gibt, ist toter Code, und der Element-Pruefer im Build meldet ihn zu Recht.
  //
  // Was mit der Karte zurueckkommen muss, damit man es nicht neu herleiten muss: ein
  // change-Leser auf dem Feld, der den Text als Hex (0x..) oder Dezimal liest, auf 0..255
  // pruefte, pitMarkerCode setzte und das Feld auf die Hex-Schreibweise normalisierte -
  // bei ungueltiger Eingabe zurueck auf den letzten gueltigen Wert. pitMarkerCode selbst
  // bleibt hier stehen: es ist null, und null vergleicht sich gegen keinen Code, also ist
  // die Boxengasse per eigenem Muster damit sauber aus.

  // ---- Das Schild auf dem Tacho ----
  //
  // Drei Zustaende und nur drei: es wird gearbeitet, es ist gerade fertig geworden, oder
  // das Schild ist weg. Die eine Sekunde GO haengt an einem Zeitpunkt und nicht an einem
  // Zaehler, damit sie auch stimmt, wenn zwischendurch ein Bild ausgelassen wird.
  let pitGoUntil = 0;

  function pitBoard() {
    const el = $('race-board');
    if (!el) return;
    const arbeitet = pitState === 'servicing' && !pitReady;
    if (arbeitet) {
      // Solange noch etwas offen ist. pitReady ist genau dann wahr, wenn Tank, Reifen und
      // Schaden alle abgehakt sind, also braucht es hier keine zweite Bedingung.
      pitGoUntil = 0;
      el.className = 'gt3-board on pit';
      el.textContent = 'PIT';
      return;
    }
    if (pitState === 'servicing' && pitReady) {
      // Erst beim Umschlag den Zeitpunkt setzen, nicht bei jedem Durchlauf: sonst wuerde
      // das GO stehen bleiben, solange das Auto in der Box wartet.
      if (!pitGoUntil) pitGoUntil = Date.now() + 1000;
    }
    if (pitGoUntil && Date.now() < pitGoUntil) {
      el.className = 'gt3-board on go';
      el.textContent = 'GO';
      return;
    }
    el.className = 'gt3-board';
    el.textContent = '';
  }
  // Eigener Takt, weil die Sekunde GO auch dann ablaufen muss, wenn der Boxenzustand sich
  // nicht mehr aendert - die Schleife oben laeuft nur waehrend des Service.
  setInterval(pitBoard, 120);

  // What is happening RIGHT NOW, task by task, with a tick for the finished ones. The old
  // text only said how much fuel and repair had accumulated, which does not answer
  // "what is left".
  // pitTaskText() stand hier und baute den Boxen-Fortschritt als Text. Ihr Abnehmer war
  // #dash-pit, ein Element der entfernten alten Karte - und mit ihm ging der einzige Aufrufer.
  // Der Rumpf wurde damals entfernt, der Textbauer blieb stehen: eine halbe Entfernung, und
  // eine Funktion ohne Aufrufer sieht bei der naechsten Durchsicht aus wie etwas, das jemand
  // braucht. Der Boxenzustand steht heute im Streifen unter dem Tacho, gezeichnet von
  // updateRaceScreen().
  // Der Rumpf schrieb in #dash-pit, ein Element der entfernten alten Karte, und war damit
  // bis auf updatePitTiles() vollstaendig wirkungslos. Der Name bleibt, weil er an einem
  // Dutzend Stellen gerufen wird und "die Boxen-Anzeige auffrischen" weiter die richtige
  // Beschreibung ist - der Boxenzustand steht heute im Streifen unter dem Tacho und im
  // Banner, gezeichnet von updateRaceScreen().
  function updatePitUI() {
    updatePitTiles();
  }

  // ---- Simulated game layer: fuel, damage/crash detection, pit stop ----
  // None of this reflects real car telemetry: the real car has no fuel gauge and no
  // confirmed damage sensor. Crash detection is a magnitude-based heuristic on notify
  // bytes 1/3 (their real meaning is unconfirmed — see BTSR tab) — "something jolted",
  // not a validated impact reading.
  let fuel = 100;
  let damage = 0;
  let crashRollingAvg1 = null, crashRollingAvg3 = null;
  let lastCrashTime = 0;
  // Ereignisse JE RUNDE, fuer den Rundenzeit-Plot. raceLapEvents[i] gehoert zu
  // raceLapTimes[i] - die Rundennummer ist der Index, genau wie dort, und sie zweimal zu
  // fuehren waere die Gelegenheit, dass sie auseinanderlaufen.
  //
  // Strafen stehen hier NICHT: die einzige im Modell ist die Zeitstrafe fuer verpasste
  // Pflichtstopps, und die wird am Rennende vergeben. Sie an eine Runde zu haengen waere
  // eine erfundene Angabe.
  let raceLapEvents = [];
  let lapEventAkku = { pit: 0, crash: 0 };
  let fuelLastTickTime = null;
  // Which end took the hit, and whether that end's lights still work. The protocol has
  // exactly two light bits - LIGHT_HEAD for the headlights and LIGHT_BRAKE for the rear -
  // so front against rear is expressible on the real car, while left against right is not.
  // Above the damage threshold the affected bit is masked out in buildCommandPacket, so the
  // car really stops switching that light rather than only the display pretending.
  const LIGHT_DEAD_DAMAGE = 50;
  const lightDamage = { front: false, rear: false };
  // Einstellbar seit v0.5. Sie stand als Konstante hier - dieselbe Fehlerklasse wie
  // leaderBrakePct und ghostCfg.lineModel: eine Einstellung, die niemand einstellen konnte.
  // Die 40 bleibt die Vorgabe, denn mit ihr ist die Erkennung gebaut und geprueft.
  let crashThreshold = 40;
  const CRASH_ROLLING_ALPHA = 0.15;
  const CRASH_REFRACTORY_MS = 1000; // avoid re-triggering repeatedly off one jolt
  let fuelDrainPerSec = 3;       // % per second at full throttle magnitude (slider)
  let crashesToTotal = 10;       // Crashs bis der Schadensbalken voll ist (Regler, Index in CRASH_STEPS)
  // Der Startwert stand auf true, das Kaestchen im Markup auf AUS (Pro und Arcade setzen
  // 'setting-crash-damage': false). Crashs wurden also gezaehlt, obwohl der Schalter aus
  // war - und ab 50 % Schaden setzt registerCrash() lightDamage.rear, worauf
  // buildCommandPacket das Bremslicht ueber lampFlicker herausmaskiert. Das ist die Ursache
  // von "beim Bremsen blinkt das Bremslicht statt zu leuchten".
  //
  // Gelesen wird jetzt aus dem Kaestchen (siehe die Verdrahtung weiter unten); dieser Wert
  // gilt nur, bis das Dokument da ist, und steht deshalb auf dem Markup-Wert.
  let crashDetectionEnabled = false;
  // AUS DEM MARKUP LESEN, und zwar HIER neben der Deklaration und nicht bei der Verdrahtung
  // in 50-drive.js: von dort waere es eine Zuweisung an ein let einer spaeteren Datei, also
  // temporale Todeszone. Genau das hat einen Anlauf lang den ganzen Aufbau abgebrochen.
  //
  // Der disabled-Zustand des Crash-Zaehlers gehoert mit dazu: der wurde auch nur im
  // change-Listener gesetzt und stand beim Laden frei, obwohl er bedeutungslos war.
  if ($('setting-crash-damage')) {
    crashDetectionEnabled = $('setting-crash-damage').checked;
    if ($('setting-crash-count')) {
      $('setting-crash-count').disabled = !crashDetectionEnabled;
    }
  }
  // Total time (s) to repair 100% damage down to 0, non-linear: the schedule is fixed
  // proportions of that total (1/10, 2/10, 3/10, 4/10 for the four 25%-damage quarters,
  // fast-to-slow as the car gets more whole), so changing the total scales every quarter
  // together rather than only the last one. At the default 10 s this is exactly 1/2/3/4 s.
  let pitFullRepairS = 10;
  const REPAIR_QUARTER_SHARE = [1, 2, 3, 4]; // sums to 10; the schedule's raw proportions

  // %/s repair rate for the quarter the CURRENT damage value sits in. Called every tick
  // with the damage BEFORE this tick's repair, so the rate changes exactly at the 75/50/25
  // boundaries rather than drifting with dt.
  function repairRateAt(damagePct) {
    const scale = pitFullRepairS / 10;
    const idx = damagePct > 75 ? 0 : damagePct > 50 ? 1 : damagePct > 25 ? 2 : 3;
    return 25 / (REPAIR_QUARTER_SHARE[idx] * scale);
  }

  function s8signed(b) { return b >= 128 ? b - 256 : b; }

  if ($('setting-crash-threshold')) {
    const anwenden = () => {
      crashThreshold = parseInt($('setting-crash-threshold').value, 10);
      $('setting-crash-threshold-val').textContent = crashThreshold;
    };
    $('setting-crash-threshold').addEventListener('input', anwenden);
    anwenden();
  }

  function detectCrash(bytes) {
    if (!crashDetectionEnabled) return;
    const v1 = s8signed(bytes[1]), v3 = s8signed(bytes[3]);
    if (crashRollingAvg1 === null) { crashRollingAvg1 = v1; crashRollingAvg3 = v3; return; }
    const dev = Math.abs(v1 - crashRollingAvg1) + Math.abs(v3 - crashRollingAvg3);
    crashRollingAvg1 += (v1 - crashRollingAvg1) * CRASH_ROLLING_ALPHA;
    crashRollingAvg3 += (v3 - crashRollingAvg3) * CRASH_ROLLING_ALPHA;
    const now = Date.now();
    if (dev > crashThreshold && now - lastCrashTime > CRASH_REFRACTORY_MS) {
      lastCrashTime = now;
      lapEventAkku.crash += 1;
      registerCrash();
    }
  }

  // Front or rear, decided from the gear and the speed rather than from a sensor byte.
  // Byte 3 does flip sign with cornering in one capture, but that is unconfirmed and it is
  // the wrong axis anyway; the gear and the speed are known exactly and for free.
  //
  //   reversing                 -> rear    (you backed into something)
  //   essentially stationary    -> rear    (something ran into you)
  //   moving forward            -> front
  function crashEnd() {
    const st = physEngine.state;
    if (st.currentGear < 0) return 'rear';
    if (Math.abs(st.speedKmh) * REAL_SCALE < 12) return 'rear';
    return 'front';
  }

  function registerCrash() {
    damage = Math.min(100, damage + 100 / crashesToTotal);
    const end = crashEnd();
    if (damage >= LIGHT_DEAD_DAMAGE && !lightDamage[end]) {
      lightDamage[end] = true;
      log(end === 'front' ? 'Frontschaden: Scheinwerfer ausgefallen.'
                          : 'Heckschaden: Rueckleuchten ausgefallen.', 'err');
      showHudToast(end === 'front' ? 'SCHEINWERFER AUS' : 'RUECKLEUCHTEN AUS');
      updateLightTellTales();
    }
    // An impact scrubs off most of the speed at once — the one case where the car should
    // NOT roll out gently. Everything else decays via the coast drag in the engine.
    physEngine.state.speedKmh *= 0.3;
    updateDamageFuelUI();
    if (!playCrashFx()) playCrashSound(); // sample variants first, synth burst as fallback
    padRumble(0.6, 0.4, 220); // medium, per user spec
    // Hier stand ein Crash-Indikator, dessen Element es nicht mehr gibt: #crash-indicator
    // kam im gebauten Dokument genau einmal vor, naemlich hier. Die Stelle prueft zwar mit
    // if (ind), griff im Zeitgeber danach aber UNGESCHUETZT auf ind.style zu - der Fehler kam
    // also 1,5 Sekunden spaeter und nur bei einem erkannten Crash. Und weil detectCrash nie
    // aufgerufen wurde, konnte er nie auftreten: ein toter Aufruf hat einen anderen toten
    // Code versteckt.
    //
    // Rueckmeldung gibt es genug - Schadensbalken, Geraeusch, Rumble, Protokoll -, nur nicht
    // auf dem Rennschirm. Also dort eine Meldung.
    showHudToast('CRASH · SCHADEN ' + Math.round(damage) + ' %');
    log(`Crash erkannt, Schaden +${Math.round(100 / crashesToTotal)}%.`, 'err');
  }

  // PLACEHOLDER: the real BLE command for the car's headlights/brake light is still
  // unknown (never observed changing in any captured packet), so this currently only
  // drives the on-screen indicators. Once the user supplies the real light command,
  // this is the single place that needs to learn how to send it.
  // ---- One resolver, one truth ----
  // Four things want to drive the lamps: the driver's switch, a light flash, the damage
  // warning, the empty-tank warning, plus the rain light. They used to be four separate
  // intervals each calling setCarLights(bool), so whichever fired last won and the state
  // drifted apart from what the car was actually being told. Now every effect only sets a
  // FLAG, and this function derives both the on-screen lamps and byte 14 from them in a
  // fixed priority order. Blink phases come from the clock rather than from timers, so
  // nothing can fall out of step.
  const lightFx = { flashUntil: 0, damage: false, fuel: false, rain: false };
  // Drei Impulse in der Taktung, die sich bewaehrt hat. Zwei Anlaeufe davor: zuerst
  // 80-ms-Umschlaege ueber 480 ms, also ein Stroboskop mit 12,5 Hz, das sich als Warnblinken
  // liest; dann ein einzelner Impuls von 280 ms, dessen LAENGE stimmte, der aber nur einmal
  // blitzte. Jetzt beides: 220 ms an, 130 ms aus, dreimal - 2,9 Hz statt 12,5.
  //
  // Getrennt notiert und nicht als eine Zahl, weil "wie lang" und "wie oft" zwei
  // Entscheidungen sind und beim naechsten Mal einzeln nachgezogen werden sollen.
  const FLASH_ON_MS = 220;
  const FLASH_OFF_MS = 130;
  const FLASH_PULSES = 3;
  const FLASH_PERIOD_MS = FLASH_ON_MS + FLASH_OFF_MS;
  // Die letzte Pause zaehlt nicht mit: nach dem dritten Impuls ist es vorbei, und eine
  // Pause am Ende wuerde die Sperre gegen ein erneutes Ausloesen unnoetig verlaengern.
  const FLASH_MS = FLASH_PULSES * FLASH_PERIOD_MS - FLASH_OFF_MS;

  function resolveLights(baseHead, baseBrake) {
    const now = Date.now();
    let head = baseHead, brake = baseBrake;
    if (now < lightFx.flashUntil) {
      // Verstrichene Zeit seit dem Ausloesen, nicht die restliche: die Phase muss vorwaerts
      // laufen, sonst kaeme der erste Impuls am Ende.
      const elapsed = FLASH_MS - (lightFx.flashUntil - now);
      const on = (elapsed % FLASH_PERIOD_MS) < FLASH_ON_MS;
      // Umgekehrt, wenn das Licht schon an ist. Das Protokoll hat genau ein Bit fuer die
      // Scheinwerfer, also gibt es kein Fernlicht, das man aufblenden koennte - bei
      // eingeschaltetem Licht waere "an" nichts Sichtbares. Ein kurzes Aus ist das, was ein
      // Ein-Bit-System an dieser Stelle zeigen kann.
      head = on ? !baseHead : baseHead;
    } else if (lightFx.damage) {
      head = Math.floor(now / 90) % 2 === 0;    // fast, agitated flicker
    } else if (lightFx.fuel) {
      head = Math.floor(now / 350) % 2 === 0;   // slow, deliberate blink
    }
    // Rain light: the FIA-style double pulse on the rear lamp. An actual brake application
    // takes precedence — a rain light must never be mistaken for braking, or the other way
    // round.
    if (!brake && lightFx.rain) {
      const ph = now % 1100;
      brake = (ph < 90) || (ph >= 200 && ph < 290);
    }
    lightBits = trackModeBit() | (head ? LIGHT_HEAD : 0) | (brake ? LIGHT_BRAKE : 0);
    return { head, brake };
  }

  function triggerHeadlightFlash() {
    if (Date.now() < lightFx.flashUntil) return;   // already flashing; ignore a double tap
    lightFx.flashUntil = Date.now() + FLASH_MS;
    showHudToast('Lichthupe');
    playFlashSound();
  }

  // Drei Toene zur Wahl, alle gerechnet und keine Aufnahme. Pixabay-Material haette ich
  // herunterladen muessen, und das ist ein Schritt nach draussen, den ich nicht ohne
  // Rueckfrage gehe - dazu kommt die Anweisung, Toene selbst zu erzeugen. Standard aus: ein
  // Auto macht bei der Lichthupe kein Geraeusch, das hier ist eine Rueckmeldung fuer den
  // Fahrer und keine Simulation.
  function playFlashSound() {
    const sel = $('flash-sound');
    const kind = sel ? sel.value : 'none';
    if (kind === 'none' || !audioCtx || !soundEnabled) return;
    // Aufnahmen zuerst. Nicht geladen heisst still statt Rueckfall auf einen gerechneten
    // Ton: wer die Ziege gewaehlt hat, will keinen Blip hoeren.
    if (kind.startsWith('horn_')) {
      const buf = fxBuffers.horns[kind];
      if (buf) { playFx(buf, 0.85); return; }
      // Fehlt die Datei, ist fast immer das Verzeichnis veraltet - deshalb steht die Abhilfe
      // gleich dabei, statt nur "nicht geladen".
      const known = Object.keys(fxBuffers.horns).length;
      log('Hupe nicht geladen: ' + kind + (known ? '' : ': es ist keine einzige Hupe '
          + 'geladen. Seite neu laden (Strg+Umschalt+R), dann ist audio/fx.json aktuell.'),
          'err');
      showHudToast('HUPE NICHT GELADEN');
      return;
    }
    // HIER STANDEN DREI GERECHNETE TOENE - Relais-Klacken, Zweiklang, Blip -, und sie
    // sind heraus. Sie waren als Rueckfall gedacht, solange keine Aufnahmen dabei waren;
    // jetzt sind sechs Aufnahmen dabei, und drei synthetische Ersatztoene daneben sind
    // eine Wahl ohne Gewinn.
    //
    // Der Zweig ist damit vollstaendig: 'none' und die sechs horn_*-Aufnahmen. Alles
    // andere kann nicht mehr im Menue stehen, und ein stiller Rueckfall waere hier das
    // Falsche - wer eine Ziege gewaehlt hat, will keinen Blip hoeren.
    log('Unbekannter Lichthupenton: ' + kind, 'err');
  }

  function updateDamageBlink() {
    lightFx.damage = damage >= 100;
    lightFx.fuel = fuel <= 0;
  }

  // Der Lichtschaden wurde bisher gesetzt und nie zurueckgenommen: es gab im ganzen
  // Projekt keine Zuweisung lightDamage.front = false. Boxenstopp-Reparatur,
  // resetCarState() und die Taste R setzen alle nur damage = 0, waehrend der Tooltip
  // ausdruecklich "Boxenstopp repariert" verspricht. Nach einem Crash blieben die Lichter
  // also fuer den Rest der Sitzung aus.
  //
  // Statt an den drei Stellen je eine Ruecknahme einzubauen, wird der Zustand hier aus dem
  // Schaden ABGELEITET. Das ist die eine Stelle, die alle drei Wege ohnehin durchlaufen
  // (updateDamageFuelUI ruft es), es deckt auch das kontinuierliche Absenken waehrend der
  // Reparatur ab, und zwei Werte, von denen einer aus dem anderen folgt, koennen so gar
  // nicht erst auseinanderlaufen.
  //
  // Welches ENDE getroffen wurde, folgt nicht aus dem Schaden - das bleibt in
  // registerCrash(). Hier wird nur geloescht, nie gesetzt.
  function syncLightDamage() {
    if (damage >= LIGHT_DEAD_DAMAGE) return;
    if (!lightDamage.front && !lightDamage.rear) return;
    lightDamage.front = false;
    lightDamage.rear = false;
    updateLightTellTales();
    log('Beleuchtung wieder in Ordnung (Schaden unter ' + LIGHT_DEAD_DAMAGE + ' %).', 'ok');
  }

  // Hier standen fuenf Schreibvorgaenge auf #fuel-bar, #fuel-liters und #damage-bar -
  // Balken der entfernten alten Karte. Die Funktion sah aus, als malte sie drei Balken, und
  // malte keinen einzigen; die echten liegen im Cockpitstreifen und werden von
  // updateRaceScreen() gezeichnet.
  //
  // Was BLEIBT, ist der Grund, warum diese Funktion ueberhaupt existiert: sie ist die eine
  // Stelle, die alle Wege durchlaufen, die Tank oder Schaden aendern. syncLightDamage()
  // haengt daran, und updateDamageBlink() auch.
  function updateDamageFuelUI() {
    syncLightDamage();
    updateDamageBlink();
  }

  // Called from sendControlValue for every command, right after topSpeedScale — depletes
  // fuel proportional to real elapsed time and throttle magnitude, caps output near empty
  // (never a hard stop), and applies a small capped damage penalty.
  // Wall-clock seconds, not packet counts: the notify rate is not constant, so counting
  // packets would weight a slow stretch differently from a fast one.
  let trackTimeOn = 0, trackTimeOff = 0, trackTimeLast = null, trackTimeUiLast = 0;

  // ---- Actual ground speed, measured rather than scaled ----
  // The displayed speed is simulated: internal units times REAL_SCALE (71.25), a factor
  // chosen so full throttle reads 285 km/h. It was never checked against the car. Measuring
  // the btsnoop logs says a lap of 3 straights and 8 curves is 4.39 m and takes 7.2 s, i.e.
  // the car really does about 2.2 km/h, and roughly 2 km/h at the moment the display says
  // 100. So a fixed divisor would be somewhere around 1:50 - but the two are not
  // proportional, because the real car saturates with throttle while the simulation does
  // not. Hence no divisor: the tile crossings give the true speed directly and calibrate
  // themselves, and any future drift in REAL_SCALE shows up here instead of hiding.
  const TILE_LEN_M = { 0x01: 0.43, 0x02: 0.43 };     // start/finish and straight
  const CURVE_LEN_M = TRACK_RADIUS_CM / 100 * (TRACK_TURN_DEG * Math.PI / 180);
  const REAL_SPEED_WINDOW = 3;                       // tiles to average over
  let realTileCount = null, realTileTime = null, realTileType = null;
  let realSpeedSamples = [], realSpeedKmh = null;

  function tileLengthM(type) {
    if (TILE_LEN_M[type] !== undefined) return TILE_LEN_M[type];
    if (type === TILE_TYPE.CURVE_LEFT || type === TILE_TYPE.CURVE_RIGHT) return CURVE_LEN_M;
    if (type === TILE_TYPE.HAIRPIN) {
      return TRACK_HAIRPIN_RADIUS_CM / 100 * (TRACK_HAIRPIN_DEG * Math.PI / 180);
    }
    return null;                                     // off track, or a code we cannot size
  }

  function realSpeedTick(counter, type) {
    const now = Date.now();
    if (realTileCount === null) {
      realTileCount = counter; realTileTime = now; realTileType = type;
      return;
    }
    if (counter === realTileCount) return;
    const step = (counter - realTileCount + 256) % 256;
    const dt = (now - realTileTime) / 1000;
    // The length belongs to the tile just LEFT, whose type was read at the previous
    // increment - the type in this packet is the tile now being entered. Getting that one
    // step wrong is what first gave me a wrong answer when analysing the logs.
    const len = tileLengthM(realTileType);
    realTileCount = counter; realTileTime = now; realTileType = type;
    // A dropped packet makes two tiles look like one and reports double the speed. In the
    // raw log data exactly that produced an apparent 14.25 km/h against a true 2.8. So a
    // step of more than one is thrown away rather than divided by the step count: we do not
    // know WHEN the missed crossing happened, so the average would be a guess.
    if (step !== 1 || len === null || dt <= 0.02 || dt > 6) return;
    realSpeedSamples.push(len / dt * 3.6);
    while (realSpeedSamples.length > REAL_SPEED_WINDOW) realSpeedSamples.shift();
    realSpeedKmh = realSpeedSamples.reduce((a, b) => a + b, 0) / realSpeedSamples.length;
    paintRealSpeed();
  }

  function realSpeedReset() {
    realTileCount = null; realTileTime = null; realTileType = null;
    realSpeedSamples = []; realSpeedKmh = null;
    paintRealSpeed();
  }

  function paintRealSpeed() {
    const el = $('dash-real-kmh');
    if (!el) return;
    if (realSpeedKmh === null) {
      el.textContent = '\u2013';
      $('dash-real-ratio').textContent = '';
      return;
    }
    el.textContent = realSpeedKmh.toFixed(2);
    // The ratio against the simulated figure, with the target named. The cars are 1:50, so
    // 50 is what this should read; anything else is the calibration drifting, and having it
    // on screen means that shows up while driving instead of staying an assumption inside a
    // constant. The two curves have different shapes - the real car is linear in throttle,
    // the simulation has drag - so expect it to wander either side of 50 rather than sit on
    // it. A steady offset in one direction is the signal worth acting on.
    const sim = Math.abs(physEngine.state.speedKmh) * REAL_SCALE;
    const el2 = $('dash-real-ratio');
    if (sim > 5 && realSpeedKmh > 0.05) {
      const f = sim / realSpeedKmh;
      el2.textContent = '(simuliert ' + Math.round(sim) + ', Faktor ' + f.toFixed(0) + ', soll 50)';
      el2.style.color = Math.abs(f - 50) > 15 ? 'var(--warn)' : '';
    } else {
      el2.textContent = '';
      el2.style.color = '';
    }
  }

  function updateLightTellTales() {
    const el = $('dash-light-dmg');
    if (el) {
      el.textContent = lightDamage.front && lightDamage.rear ? 'VORN + HINTEN DEFEKT'
                     : lightDamage.front ? 'SCHEINWERFER DEFEKT'
                     : lightDamage.rear ? 'RUECKLEUCHTEN DEFEKT' : '';
    }
    // The cockpit headlight symbol goes dark and says why, instead of claiming the lights
    // are on while the car is sending them off.
    const lamp = $('race-light');
    if (lamp) {
      lamp.style.opacity = lightDamage.front ? '0.25' : '';
      lamp.setAttribute('aria-label', lightDamage.front ? 'Scheinwerfer defekt' : 'Scheinwerfer');
      const box = $('race-light-box');
      if (box) box.title = lightDamage.front
        ? 'Scheinwerfer defekt \u2013 geht unter ' + LIGHT_DEAD_DAMAGE + ' % Schaden wieder'
        : 'Licht an/aus';
    }
  }

  function trackTimeTick(onTrack) {
    const now = Date.now();
    if (trackTimeLast !== null) {
      // Capped like the fuel tick: a tab that was in the background for a minute must not
      // book that minute as driving.
      const dt = Math.min(0.5, (now - trackTimeLast) / 1000);
      if (onTrack) trackTimeOn += dt; else trackTimeOff += dt;
    }
    trackTimeLast = now;
    if (now - trackTimeUiLast > 400) { trackTimeUiLast = now; paintTrackTime(); }
  }

  function trackTimeReset() {
    trackTimeOn = 0; trackTimeOff = 0; trackTimeLast = null;
    paintTrackTime();
  }

  function mmss(sec) {
    const m = Math.floor(sec / 60), r = Math.floor(sec % 60);
    return m + ':' + String(r).padStart(2, '0');
  }

  function paintTrackTime() {
    const on = $('dash-time-on'), off = $('dash-time-off'), sh = $('dash-time-share');
    if (!on) return;
    on.textContent = mmss(trackTimeOn);
    off.textContent = mmss(trackTimeOff);
    const tot = trackTimeOn + trackTimeOff;
    sh.textContent = tot > 1 ? '(' + Math.round(trackTimeOff / tot * 100) + ' % abseits)' : '';
    // Coloured only once it is worth looking at. A single lost packet is not a cut.
    off.style.color = tot > 5 && trackTimeOff / tot > 0.1 ? 'var(--warn)' : '';
  }

  let fuelUiLastPaint = 0;
  // Two beeps at ten per cent, one at twenty: the count carries the urgency, so the driver
  // does not have to look away from the track to learn which mark went by.
  const FUEL_WARNINGS = [{ pct: 20, beeps: 1 }, { pct: 10, beeps: 2 }];
  function applyFuelAndDamage(throttle) {
    const now = Date.now();
    if (fuelLastTickTime !== null && pitState !== 'servicing') {
      const dt = Math.min(0.5, (now - fuelLastTickTime) / 1000);
      const fuelBefore = fuel;
      fuel = Math.max(0, fuel - Math.abs(throttle) * dt * fuelDrainPerSec);
      // Edge-triggered: without this it would rumble again on every 45ms heartbeat.
      if (fuelBefore > 0 && fuel <= 0) {
        padRumble(0.2, 0.12, 160);
        log('Tank leer.', 'err');
      }
      // Once per tank, each. Falling PAST the mark triggers; rising back above it re-arms,
      // so a partial refuel to 15 % warns again at 10 % but not at 20 %. A single flag per
      // level would have gone quiet for the rest of the session after the first stint.
      for (const w of FUEL_WARNINGS) {
        if (fuelBefore > w.pct && fuel <= w.pct) {
          playFuelWarning(w.beeps);
          showHudToast('Tank ' + fuelLiters(fuel) + ' l');
          log('Tankwarnung bei ' + w.pct + ' %.', 'warn');
        }
      }
      // Repaint at ~5Hz, not on every one of the ~22 heartbeats per second: the bars
      // can't show more detail than that anyway, and the DOM writes were pure overhead
      // on the same thread that has to keep the send cadence steady.
      if (now - fuelUiLastPaint > 200) { fuelUiLastPaint = now; updateDamageFuelUI(); }
    }
    // Hand the tank level to the physics: the engine must not reach out for globals.
    physEngine.state.fuelLoad = Math.max(0, Math.min(1, fuel / 100));
    fuelLastTickTime = now;

    return fuelDamageDerate(throttle);
  }

  // The derate ALONE, with no side effects, so it can be asked twice per tick without
  // draining the tank twice. That split is the whole point: physicsStep() was feeding the
  // RAW stick value into the simulation while this reduction only ever reached the car, so
  // an empty tank still read 200 km/h on the display and still set lap times as if nothing
  // were wrong. The car crawled, the simulation did not know.
  function fuelDamageDerate(throttle) {
    let out = throttle;
    if (fuel <= 0) out = Math.max(-0.15, Math.min(0.15, out));
    out *= 1 - (damage / 100) * 0.3;
    // Totalled: limp home. Deliberately still drivable so the car never strands itself
    // out on the track — a pit stop clears it.
    if (damage >= 100) out *= 0.5;
    // ...except it did not. Empty tank AND total damage multiplied down to 0.0525, well
    // below minMoveThrottle (0.16), which is the byte range where the car twitches instead
    // of moving: the same dead band that caused the crawling near standstill, reached by a
    // different path. So while the driver is actually asking for throttle, the limp value
    // gets a FLOOR rather than only a series of reductions. It stays humiliatingly slow,
    // but it moves, which is the entire point of a limp mode.
    const floor = physEngine.config.minMoveThrottle * 1.05;
    if (throttle > 0.02 && out > 0 && out < floor) out = floor;
    if (throttle < -0.02 && out < 0 && out > -floor) out = -floor;
    return out;
  }

  // There used to be TWO pit stops: a fixed four-second one on this button that simply set
  // fuel to 100 and damage to 0, and the pit-lane service reached by driving over the
  // marker, which scales with how long you actually stand there and changes tyres. Keeping
  // both meant the button quietly handed out a better result than driving in properly. The
  // button now enters the same service, so there is one pit stop with two ways in.
  // Fresh rubber: cold and unworn. Called when the crew fits tyres and at the green light,
  // which is exactly when a real car leaves on new or cooled-down tyres.
  function resetTyres() {
    // Mit Reifenwaermer auf Betriebstemperatur, ohne auf Umgebung. tyreOptimalC und nicht
    // ein eigener Wert: ein Waermer bringt den Reifen in sein Griff-Fenster, und zwei Zahlen
    // fuer dasselbe Fenster laufen auseinander.
    const startTemp = physEngine.config.tyreBlankets
      ? physEngine.config.tyreOptimalC : physEngine.config.tyreAmbientC;
    physEngine.state.tyreTempC = startTemp;
    physEngine.state.tyreWear = 0;
    // Links und rechts MUESSEN mit. Ohne diese zwei Zeilen setzt der Boxenstopp den
    // Mittelwert auf 0 und die Seiten stehen weiter bei 0,4: das Cockpit zeigt heile Reifen
    // und das Auto zieht immer noch. Genau so laufen zwei Darstellungen derselben Sache
    // auseinander.
    physEngine.state.tyreWearL = 0;
    physEngine.state.tyreWearR = 0;
    physEngine.state.tyrePull = 0;
    // Die VIER Raeder muessen mit, sonst setzt der Boxenstopp die Mittelwerte auf 0 und die
    // vier Felder im Cockpit zeigen weiter Abnutzung. Genau diese Sorte Auslassung hat schon
    // einmal dazu gefuehrt, dass die Kachel dem Toast widersprach - und man glaubt dem, was
    // man sieht. Beim naechsten Takt werden die Mittelwerte aus den vier GERECHNET, also
    // reicht es nicht, nur die Mittelwerte zu nullen: sie waeren sofort wieder da.
    // HINEINSCHREIBEN und nicht ersetzen. Ein neues Array zu setzen laesst jeden Leser,
    // der die alte Referenz haelt, in eine Leiche schreiben - dieselbe Klasse wie die flache
    // Zustandskopie in den Messaufbauten. Hier haelt gerade niemand eine; es so zu lassen
    // waere die Sorte Entscheidung, die beim naechsten Leser teuer wird.
    for (let i = 0; i < 4; i++) {
      physEngine.state.tyreWear4[i] = 0;
      physEngine.state.tyreTemp4[i] = startTemp;
    }
    physEngine.state.tyreGrip = 1;
    // Die BREMSSCHEIBEN werden hier ausdruecklich NICHT gekuehlt. Ein Boxenstopp dauert
    // Sekunden, und Scheiben kuehlen darin nicht auf Umgebungstemperatur. Reifen werden
    // gewechselt, Scheiben nicht - wer nach dem Stopp mit heisser Bremse herausfaehrt, hat
    // sie auch in echt.
  }

  // Pressing the button no longer demands a standstill. It arms the pit lane, exactly as
  // driving over the marker does, and pitLaneTick() takes it from there:
  //   off --(button)--> limited --(car stops)--> servicing --(drive away)--> off
  // That is how a real pit entry works, and it means one state machine serves both ways in.
  // Aborting takes TWO presses in quick succession. A single press used to cancel, which
  // is the wrong default for a button you reach for while driving: one stray press in the
  // pit lane threw away the stop. Two presses inside the window is a deliberate act.
  const PIT_CANCEL_WINDOW_MS = 700;
  // After an abort the pit marker must stay quiet for a moment, or cancelling while still
  // standing on the marker would immediately re-arm the limiter.
  const PIT_REARM_BLOCK_MS = 2500;
  let pitLastPress = 0;
  let pitRearmBlockedUntil = 0;

  // ---- What the crew is actually going to do ----
  // The service used to be open-ended: while the car stood still, fuel went up and damage
  // went down, for as long as the driver waited. Nothing said what was happening or when it
  // would be finished, so "when can I go?" had no answer. Now the stop has a PLAN with
  // tasks that complete, and a clear ready state.
  //
  // Tasks are only offered when their simulation is switched on: refuelling makes no sense
  // with fuel consumption off, and a tyre change makes none with tyre wear off. Repair is
  // not a choice — a damaged car gets repaired, that is what a pit stop is for. If there is
  // nothing at all to do, the stop becomes a flat PIT_EMPTY_STOP_S so that entering the pits
  // still costs something, rather than being free.
  // Mean tyre-change time. The ACTUAL time is drawn per stop with a small spread, because
  // a crew that always takes exactly 4.00 s is the one thing a real crew never is - and the
  // variance is what makes a stop feel like an event rather than a timer.
  const PIT_TYRE_CHANGE_S = 4.0;
  const PIT_TYRE_CHANGE_SD = 0.2;
  const PIT_EMPTY_STOP_S = 5.0;
  // A mandatory stop is served after this much standing time, whether or not the crew has
  // finished everything. Serving the stop and choosing to leave early are two decisions,
  // and only the first is what the rule is about.
  const PIT_MANDATORY_STAND_S = 3.0;
  let pitPlan = null;   // { refuel, tyres, repair } while a stop is armed, else null
  let pitDone = null;   // { refuel, tyres, repair } completion flags
  let pitTyreElapsed = 0;
  let pitTyreTarget = PIT_TYRE_CHANGE_S;   // drawn per stop, see PIT_TYRE_CHANGE_SD
  let pitEmptyElapsed = 0;
  let pitStandElapsed = 0;                 // total standing time this stop
  let pitReady = false;
  // One node per looping sound. They are allowed to overlap: tyres and repair really do
  // happen at the same time, and the two were written to be separable by ear (an even
  // hammer train against slow uneven panel taps).
  const pitLoops = { wrench: null, fuel: null, repair: null };

  // Normal deviate via Box-Muller. Math.random() alone would give a flat spread, which
  // would make 3.6 s and 4.0 s equally likely - not how a pit crew's timing is
  // distributed. Clamped so an unlucky draw can never produce a negative duration.
  function gaussian(mean, sd) {
    const u = Math.max(1e-9, Math.random()), v = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function fuelSimOn() { return fuelDrainPerSec > 0; }
  function tyreSimOn() { return physEngine.config.tyreEffect > 0; }

  function makePitPlan() {
    return {
      refuel: fuelSimOn() && fuel < 99.5,
      tyres: tyreSimOn(),
      repair: damage > 0.5,
    };
  }

  function pitPlanEmpty(p) { return !p || (!p.refuel && !p.tyres && !p.repair); }

  // Each job gets a sound that runs WHILE it runs and stops when it is done. They used to
  // be single one-shots at the start of the service, which said "something began" but never
  // "it is over" - and only the wrench had one at all.
  const PIT_LOOP_SPEC = {
    wrench: { buf: () => fxBuffers.pit, gain: 0.55 },
    fuel:   { buf: () => fxBuffers.pitFuel, gain: 0.40 },
    repair: { buf: () => fxBuffers.pitRepair, gain: 0.45 },
  };

  function setPitLoop(which, on) {
    const spec = PIT_LOOP_SPEC[which];
    if (!spec) return;
    if (on) {
      if (pitLoops[which] || !audioCtx || !soundEnabled) return;
      const buf = spec.buf();
      if (!buf) return;                       // sample missing: silence, not a crash
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = audioCtx.createGain();
      g.gain.value = spec.gain;
      src.connect(g).connect(audioCtx.destination);
      src.start();
      pitLoops[which] = src;
    } else if (pitLoops[which]) {
      try { pitLoops[which].stop(); } catch { /* already stopped */ }
      pitLoops[which] = null;
    }
  }

  function stopAllPitLoops() { Object.keys(PIT_LOOP_SPEC).forEach(k => setPitLoop(k, false)); }

  // Kept as a thin alias: the tyre change is the one loop other code refers to by name.
  // setPitWrench(on) stand hier und war ein Einzeiler um setPitLoop('wrench', on), den
  // niemand rief - der Schrauberton wird direkt ueber setPitLoop gestartet.

  // The pad buzzes for as long as ANY job is running, so the hands know the stop is still
  // going without looking. Re-armed on a timer because a rumble effect has a fixed
  // duration - there is no "hold until further notice" in the Gamepad API.
  let pitRumbleAt = 0;
  function pitRumbleWhileWorking(anyRunning) {
    if (!anyRunning) return;
    const now = Date.now();
    if (now - pitRumbleAt < 180) return;
    pitRumbleAt = now;
    padRumble(0.16, 0.10, 200);
  }

  // Wheels off means the car cannot move, whatever the driver asks for. Once they are back
  // on, the throttle is free again - and using it is how you leave, which is exactly what
  // "sobald das fertig ist bedeutet Gas geben auch Ende" describes.
  // Die Reihenfolge, in der die vier Raeder gewechselt werden: Boxenmauerseite zuerst,
  // weil dort die Crew steht und den Wagen von dort umlaeuft. Indizes wie ueberall im
  // Modell: 0 vorne links, 1 vorne rechts, 2 hinten links, 3 hinten rechts.
  //
  // EINE Liste, weil eine zweite die Gelegenheit waere, dass Anzeige und Ton in
  // verschiedener Ordnung laufen.
  const PIT_RAD_FOLGE = [1, 3, 2, 0];
  // Wie lange ein Rad innerhalb seines Fensters ABGEBAUT ist. Zwei Drittel: dann sieht man
  // vier deutliche Ausfaelle. Bei 1,0 waere immer genau ein Rad weg und der Wechsel saehe
  // wie ein einziger langer Vorgang aus, obwohl vier Toene zu hoeren sind.
  const PIT_RAD_AB_ANTEIL = 0.66;

  // Der Index des Rades, das GERADE abgebaut ist, oder -1. Wird vom Cockpit-Takt in
  // 50-drive.js gelesen; eine Funktionsdeklaration ist ueber den ganzen Bereich hochgezogen,
  // also ist der Aufruf von dort gefahrlos - anders als bei einem let, das vor seiner Zeile
  // in der Totzone liegt. Diese Falle hat in dieser Werkstatt schon siebenmal zugeschlagen.
  function pitWheelOff() {
    if (pitState !== 'servicing' || !pitPlan || !pitPlan.tyres) return -1;
    if (!pitDone || pitDone.tyres) return -1;
    if (!(pitTyreTarget > 0)) return -1;
    const anteil = Math.max(0, Math.min(0.999, pitTyreElapsed / pitTyreTarget));
    const fenster = anteil * 4;
    const nr = Math.floor(fenster);
    // Im letzten Drittel des Fensters ist das neue Rad schon dran.
    if (fenster - nr > PIT_RAD_AB_ANTEIL) return -1;
    return PIT_RAD_FOLGE[nr];
  }

  function refreshPitThrottleLock() {
    pitThrottleLock = pitState === 'servicing' && !!pitPlan && pitPlan.tyres
                      && !!pitDone && !pitDone.tyres;
  }

  // Three distinguishable confirmations, so the ear alone tells you which job finished.
  function pitChimeFuel()   { playTone(520, 0.10, 'sine', 0.16);
                              setTimeout(() => playTone(780, 0.16, 'sine', 0.16), 90); }
  function pitChimeTyres()  { playTone(300, 0.12, 'triangle', 0.16);
                              setTimeout(() => playTone(300, 0.16, 'triangle', 0.14), 130); }
  function pitChimeRepair() { playTone(660, 0.10, 'sine', 0.15);
                              setTimeout(() => playTone(880, 0.10, 'sine', 0.15), 80);
                              setTimeout(() => playTone(1170, 0.18, 'sine', 0.15), 160); }
  // Deliberately the loudest and most distinct of the four: this is the one that means GO.
  function pitChimeReady()  { playTone(880, 0.13, 'square', 0.20);
                              setTimeout(() => playTone(1320, 0.26, 'square', 0.20), 120); }

  function describePitPlan(p) {
    if (pitPlanEmpty(p)) return `nur ${PIT_EMPTY_STOP_S.toFixed(0)} s Standzeit`;
    const parts = [];
    if (p.refuel) parts.push('tanken');
    if (p.tyres) parts.push('Reifen');
    if (p.repair) parts.push('reparieren');
    return parts.join(' + ');
  }

  // D-pad while a stop is armed. Returns true if the press was consumed, so the caller can
  // leave the normal D-pad bindings alone the rest of the time — the pad keeps its usual
  // job except during a pit stop, which is what was asked for.
  // Ist diese Arbeit ueberhaupt simuliert? Ohne Tanksimulation gibt es nichts zu tanken,
  // und eine Kachel, die man antippen kann, ohne dass etwas passiert, ist schlimmer als
  // eine graue.
  function pitJobAvailable(which) {
    if (which === 'refuel') return fuelSimOn();
    if (which === 'tyres') return tyreSimOn();
    if (which === 'repair') return crashDetectionEnabled;
    return false;
  }

  // Die EINE Stelle, die den Boxenstopp-Plan aendert. Finger und Steuerkreuz gehen beide
  // hier durch; vorher hatte nur das Steuerkreuz Zugriff, konnte auch nur Tank und Reifen,
  // und die Reparatur war ueberhaupt nicht abwaehlbar.
  function pitToggle(which, force) {
    if (pitState === 'off' || !pitPlan) return false;
    if (!pitJobAvailable(which)) {
      showHudToast(which === 'refuel' ? 'Tanksimulation ist aus'
                   : which === 'tyres' ? 'Reifensimulation ist aus' : 'Schadensmodell ist aus');
      return true;
    }
    const before = describePitPlan(pitPlan);
    const next = force === undefined ? !pitPlan[which] : !!force;
    pitPlan[which] = next;
    // Einen laufenden Reifenwechsel abwaehlen heisst: die alten Reifen bleiben drauf. Was
    // schon montiert ist, wird nicht abmontiert, die Uhr hoert nur auf zu zaehlen.
    if (which === 'tyres' && !next && pitState === 'servicing') {
      setPitLoop('wrench', false);
      pitTyreElapsed = 0;
      refreshPitThrottleLock();
    }
    if (which === 'refuel' && !next) setPitLoop('fuel', false);
    if (which === 'repair' && !next) setPitLoop('repair', false);
    const after = describePitPlan(pitPlan);
    if (after !== before) showHudToast(`Boxenstopp: ${after}`);
    updatePitUI();
    return true;
  }

  function pitQuickMenu(dir) {
    if (pitState === 'off' || !pitPlan) return false;
    if (dir === 'up') return pitToggle('refuel', true);
    if (dir === 'down') return pitToggle('refuel', false);
    if (dir === 'right') return pitToggle('tyres', true);
    if (dir === 'left') return pitToggle('tyres', false);
    return false;
  }

  // Die drei Kacheln faerben. Gruen = wird gemacht, rot = abgewaehlt, grau = nicht
  // simuliert. Ausserhalb eines Boxenstopps traegt keine Kachel eine dieser Klassen: die
  // Faerbung soll nur etwas heissen, wenn gerade tatsaechlich gearbeitet wird.
  function updatePitTiles() {
    const active = pitState === 'servicing' && !!pitPlan;
    for (const el of document.querySelectorAll('.pit-tile')) {
      const which = el.dataset.pit;
      el.classList.remove('pit-on', 'pit-off', 'pit-na');
      if (!active) continue;
      if (!pitJobAvailable(which)) { el.classList.add('pit-na'); continue; }
      el.classList.add(pitPlan[which] ? 'pit-on' : 'pit-off');
    }
  }

  function requestPitStop() {
    const now = Date.now();
    const doubleTap = now - pitLastPress <= PIT_CANCEL_WINDOW_MS;
    pitLastPress = now;

    if (pitState === 'off') {
      setPitState('limited');
      return;
    }
    if (!doubleTap) {
      showHudToast('Nochmal drücken zum Abbrechen');
      return;
    }
    // Abort. Whatever the crew had started is discarded: no fuel, no repair, and stopping
    // afterwards does nothing, because the state machine is back to off.
    const wasServicing = pitState === 'servicing';
    pitRearmBlockedUntil = now + PIT_REARM_BLOCK_MS;
    setPitState('off');
    showHudToast(wasServicing ? 'Boxenstopp abgebrochen' : 'Boxengasse abgebrochen');
    log('Boxenstopp abgebrochen, kein Sprit, keine Reparatur.', 'info');
  }

  updateDamageFuelUI();

