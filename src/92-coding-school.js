  // =========================================================================
  // Programmierschule
  // =========================================================================
  // Kurven ziehen statt Code schreiben, simulieren, und dann an ein echtes Auto
  // schicken. Erst simulieren ist bewusst ein Schritt: eine steil gezogene Gaskurve
  // laesst ein Auto auf dem Tisch losschiessen, und die Simulation kostet nichts.

  const PS_SECONDS = 6;          // curve length
  const PS_POINTS = 13;          // control points, so 0.5 s apart at 6 s
  const PS_W = 420, PS_H = 190;  // viewBox of one editor
  const PS_PAD = { l: 34, r: 10, t: 12, b: 24 };

  let psAccel = new Array(PS_POINTS).fill(0);
  let psSteer = new Array(PS_POINTS).fill(0);
  let psSel = 0;                 // selected point, shared by both editors
  let psActive = 'accel';        // which editor the selection belongs to
  let psLastRun = null;

  const psX = (i) => PS_PAD.l + (i / (PS_POINTS - 1)) * (PS_W - PS_PAD.l - PS_PAD.r);
  const psY = (v) => PS_PAD.t + (1 - (v + 1) / 2) * (PS_H - PS_PAD.t - PS_PAD.b);
  const psValFromY = (y) => Math.max(-1, Math.min(1,
    (1 - (y - PS_PAD.t) / (PS_H - PS_PAD.t - PS_PAD.b)) * 2 - 1));

  function psEditorSvg(which, data) {
    const midY = psY(0);
    let g = `<svg viewBox="0 0 ${PS_W} ${PS_H}" data-ps="${which}" role="img">`;
    // Grid: the zero line is emphasised because it is the meaningful one (rolling / straight).
    for (const v of [1, 0.5, 0, -0.5, -1]) {
      const y = psY(v);
      g += `<line x1="${PS_PAD.l}" y1="${y.toFixed(1)}" x2="${PS_W - PS_PAD.r}" y2="${y.toFixed(1)}" `
         + `stroke="var(--border)" stroke-width="${v === 0 ? 1.6 : 0.7}"/>`
         + `<text x="${PS_PAD.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" `
         + `font-family="monospace" font-size="9" fill="var(--muted)">${v > 0 ? '+' : ''}${v}</text>`;
    }
    // Time axis, one label per second.
    for (let sec = 0; sec <= PS_SECONDS; sec++) {
      const i = sec / PS_SECONDS * (PS_POINTS - 1);
      g += `<text x="${psX(i).toFixed(1)}" y="${PS_H - 8}" text-anchor="middle" `
         + `font-family="monospace" font-size="9" fill="var(--muted)">${sec}s</text>`;
    }
    // The curve itself.
    const pts = data.map((v, i) => `${psX(i).toFixed(1)},${psY(v).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" `
       + `stroke-linejoin="round" stroke-linecap="round"/>`;
    // Handles last, so they sit on top and stay clickable.
    data.forEach((v, i) => {
      const sel = (psActive === which && psSel === i);
      g += `<circle class="ps-pt${sel ? ' sel' : ''}" data-i="${i}" `
         + `cx="${psX(i).toFixed(1)}" cy="${psY(v).toFixed(1)}" r="${sel ? 7 : 5.5}" `
         + `fill="${sel ? 'var(--accent)' : 'var(--panel-3)'}" stroke="var(--accent)" stroke-width="1.5"/>`;
    });
    return g + '</svg>';
  }

  function psRenderEditors() {
    const a = $('ps-accel'), st = $('ps-steer');
    if (!a || !st) return;
    a.innerHTML = psEditorSvg('accel', psAccel);
    st.innerHTML = psEditorSvg('steer', psSteer);
    psWireDrag(a, 'accel', psAccel);
    psWireDrag(st, 'steer', psSteer);
  }

  // Pointer events, not mouse events: the same code then works with a finger, and a phone
  // is the most likely place for this tab.
  function psWireDrag(host, which, data) {
    const svg = host.querySelector('svg');
    if (!svg) return;
    let dragging = null;
    const toLocal = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * PS_W,
               y: (e.clientY - r.top) / r.height * PS_H };
    };
    const nearest = (x) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < PS_POINTS; i++) {
        const d = Math.abs(psX(i) - x);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    svg.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      dragging = nearest(p.x);
      psActive = which; psSel = dragging;
      data[dragging] = psValFromY(p.y);
      svg.setPointerCapture(e.pointerId);
      psRenderEditors();
    });
    svg.addEventListener('pointermove', (e) => {
      if (dragging === null) return;
      data[dragging] = psValFromY(toLocal(e).y);
      psRenderEditors();
    });
    const end = () => { dragging = null; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  // ---- The simulation ----
  // Runs a FRESH engine so a previous run cannot leak into the next one, at the real send
  // interval so the result is what the car would actually get.
  function psRun() {
    const e = new CarreraPhysicsEngine();
    e.config.autoShift = true;
    e.state.driveMode = 'forward';
    e.state.currentGear = 0;
    const dt = CONTROL_SEND_INTERVAL_MS / 1000;
    const steps = Math.round(PS_SECONDS / dt);
    const trace = [];
    let shiftedAt = null;
    for (let k = 0; k < steps; k++) {
      const t = k * dt;
      const u = t / PS_SECONDS * (PS_POINTS - 1);
      const a = psSample(psAccel, u), sTarget = psSample(psSteer, u);
      const out = e.update({ steering: sTarget, throttle: Math.max(0, a),
                             brake: Math.max(0, -a), headlights: false }, dt);
      // isShifting is cleared by a real setTimeout, which does not fire inside a synchronous
      // loop. Cleared by hand here so a gearchange cannot hang the whole run — a test
      // artefact of running the model faster than wall time, not a fault in the model.
      if (e.state.isShifting && shiftedAt === null) shiftedAt = k;
      if (shiftedAt !== null && k - shiftedAt > Math.ceil(e.config.shiftMs / 1000 / dt)) {
        e.state.isShifting = false; shiftedAt = null;
      }
      trace.push({ t, want: sTarget, got: out.servoAngle,
                   kmh: e.state.speedKmh * REAL_SCALE, gear: e.state.currentGear });
    }
    psLastRun = trace;
    psRenderResult();
    const top = Math.max(...trace.map(p => p.kmh));
    const m = psFollowMetrics(trace);
    $('ps-status').textContent =
      `Gefahren: Spitze ${Math.round(top)} km/h · `
      + `Lenkung konnte ${m.pct.toFixed(0)} % der verlangten Änderung nicht folgen `
      + `(${m.limited} von ${trace.length} Takten am Anschlag).`;
  }

  // Linear interpolation between control points. Deliberately linear and not a spline: the
  // curve the user drew IS the input, and a spline would quietly add overshoot they did not
  // ask for — which is exactly the kind of hidden helpfulness this tab exists to expose.
  function psSample(arr, u) {
    const i = Math.max(0, Math.min(PS_POINTS - 1, Math.floor(u)));
    const j = Math.min(PS_POINTS - 1, i + 1);
    const f = u - i;
    return arr[i] + (arr[j] - arr[i]) * f;
  }

  // How much of the REQUESTED CHANGE the steering could not follow, per tick.
  //
  // The obvious metric, max |want - got|, is wrong here and was tried first: with
  // steerResponse at 2.0 the car deliberately steers MORE than asked, and that gain
  // difference swamped everything. Smoothing a curve then left the number unchanged at
  // 32 % even though it changed the driving - exactly the sort of metric that teaches the
  // wrong lesson.
  //
  // Rate limiting is a statement about CHANGE, so change is what gets compared: how much of
  // each tick's requested step the steering actually delivered. A square input asks for a
  // step the servo cannot make and scores high; a smooth one scores near zero.
  function psFollowMetrics(trace) {
    let worst = 0, limited = 0, askedTotal = 0, missedTotal = 0;
    for (let k = 1; k < trace.length; k++) {
      const asked = Math.abs(trace[k].want - trace[k - 1].want);
      const got = Math.abs(trace[k].got - trace[k - 1].got);
      const missed = Math.max(0, asked - got);
      if (asked > 1e-6 && missed > asked * 0.05) limited++;
      worst = Math.max(worst, missed);
      askedTotal += asked; missedTotal += missed;
    }
    return { worst, limited, pct: askedTotal > 1e-6 ? (missedTotal / askedTotal) * 100 : 0 };
  }

  function psRenderResult() {
    const host = $('ps-result');
    if (!host) return;
    if (!psLastRun) { host.innerHTML = ''; return; }
    const W = 880, H = 230, pad = { l: 44, r: 44, t: 12, b: 26 };
    const tr = psLastRun;
    const topKmh = Math.max(60, ...tr.map(p => p.kmh));
    const X = t => pad.l + (t / PS_SECONDS) * (W - pad.l - pad.r);
    const Yk = v => pad.t + (1 - v / topKmh) * (H - pad.t - pad.b);
    const Ys = v => pad.t + (1 - (v + 1) / 2) * (H - pad.t - pad.b);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reaktion des Autos">`;
    g += `<line x1="${pad.l}" y1="${Ys(0).toFixed(1)}" x2="${W - pad.r}" y2="${Ys(0).toFixed(1)}" stroke="var(--border)" stroke-width="1.4"/>`;
    for (let sec = 0; sec <= PS_SECONDS; sec++) {
      g += `<text x="${X(sec).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-family="monospace" font-size="9" fill="var(--muted)">${sec}s</text>`;
    }
    const line = (sel, col, dash, wid) => {
      const pts = tr.map(p => `${X(p.t).toFixed(1)},${sel(p).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${wid}"`
           + (dash ? ` stroke-dasharray="${dash}"` : '') + ' stroke-linejoin="round"/>';
    };
    g += line(p => Yk(p.kmh), '#1c7a4d', '', 2.2);
    g += line(p => Ys(p.want), '#8b99b4', '6 4', 1.6);
    g += line(p => Ys(p.got), '#b3131f', '', 2.2);
    g += `<text x="${pad.l - 6}" y="${(Yk(topKmh) + 10).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="9" fill="#1c7a4d">${Math.round(topKmh)} km/h</text>`;
    g += `<text x="${W - pad.r + 6}" y="${(Ys(1) + 10).toFixed(1)}" font-family="monospace" font-size="9" fill="#ff5c5c">+1 Lenk</text>`;
    g += `<text x="${W - pad.r + 6}" y="${(Ys(-1) - 2).toFixed(1)}" font-family="monospace" font-size="9" fill="#ff5c5c">-1</text>`;
    g += '</svg>';
    host.innerHTML = g;
    $('ps-result-hint').innerHTML =
      '<b style="color:#1c7a4d">Gr&uuml;n</b> Geschwindigkeit &middot; '
      + '<b style="color:#8b99b4">grau gestrichelt</b> verlangter Lenkwinkel &middot; '
      + '<b style="color:#b3131f">rot</b> was die Lenkung daraus macht. Der Abstand zwischen '
      + 'grau und rot ist die Tr&auml;gheit, genau das, was eine eckige Vorgabe kostet.';
  }

  // ---- Buttons ----
  $('ps-run').onclick = psRun;
  $('ps-reset').onclick = () => {
    psAccel = new Array(PS_POINTS).fill(0);
    psSteer = new Array(PS_POINTS).fill(0);
    psLastRun = null;
    psRenderEditors(); psRenderResult();
    $('ps-status').textContent = 'Zur\u00fcckgesetzt.';
  };
  // A three-point moving average, applied to both curves. Shows in one click what
  // "geschmeidig" means, instead of asking someone to drag thirteen points carefully.
  $('ps-smooth').onclick = () => {
    const sm = (a) => a.map((_, i) => {
      const l = a[Math.max(0, i - 1)], r = a[Math.min(a.length - 1, i + 1)];
      return (l + a[i] + r) / 3;
    });
    psAccel = sm(psAccel); psSteer = sm(psSteer);
    psRenderEditors();
    $('ps-status').textContent = 'Gegl\u00e4ttet, nochmal fahren und vergleichen.';
  };
  $('ps-preset').onchange = (ev) => {
    const v = ev.target.value;
    const n = PS_POINTS;
    if (v === 'square') {
      psAccel = Array.from({ length: n }, (_, i) => i < n / 2 ? 1 : -1);
      psSteer = new Array(n).fill(0);
    } else if (v === 'smooth') {
      psAccel = Array.from({ length: n }, (_, i) => Math.sin(Math.PI * i / (n - 1)) * 0.9);
      psSteer = new Array(n).fill(0);
    } else if (v === 'slalom') {
      psAccel = new Array(n).fill(0.55);
      psSteer = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * i / (n - 1) * 1.5));
    } else return;
    psLastRun = null;
    psRenderEditors(); psRenderResult();
    $('ps-status').textContent = 'Beispiel geladen, jetzt fahren.';
    ev.target.value = '';
  };

  // Sending to a real car is a separate, deliberate step. Enabled only when one is actually
  // connected, and it drives the curve once through the ordinary control path.
  function psRefreshSendButton() {
    const btn = $('ps-send'), st = $('ps-send-status');
    if (!btn || !st) return;
    // Same two targets sendControlValue() writes to, in the same order: a car with the
    // "Steuern" role, otherwise whatever the BLE explorer has selected.
    const ready = !!(playerCar && playerCar.rx)
               || !!(controlSelect && controlSelect.value && charByUuid.get(controlSelect.value));
    btn.disabled = !ready;
    st.textContent = ready ? 'bereit' : 'kein Auto verbunden';
  }
  setInterval(psRefreshSendButton, 1500);

  $('ps-send').onclick = async () => {
    const btn = $('ps-send');
    btn.disabled = true;
    $('ps-send-status').textContent = 'f\u00e4hrt\u2026';
    const dt = CONTROL_SEND_INTERVAL_MS;
    const steps = Math.round(PS_SECONDS * 1000 / dt);
    for (let k = 0; k < steps; k++) {
      const u = (k * dt / 1000) / PS_SECONDS * (PS_POINTS - 1);
      const a = psSample(psAccel, u);
      applyThrottleInput(SRC.MACRO, a);
      applySteerInput(SRC.MACRO, psSample(psSteer, u));
      await new Promise(r => setTimeout(r, dt));
    }
    releaseInput(SRC.MACRO);
    $('ps-send-status').textContent = 'fertig';
    psRefreshSendButton();
  };

  // Gamepad, only while this tab is open — otherwise the D-pad would lose its driving job.
  psRenderEditors();
  psRefreshSendButton();

