  // ============================== MOTORWERKSTATT ==============================
  // Elf Groessen, aus denen die mitgelieferten Motoren gerechnet sind, hier direkt zum
  // Drehen. Das Modell laeuft im Browser, also ist jede Aenderung sofort hoerbar.
  //
  // Der Kern ist mwFiringAngles(): auf einer Cross-Plane-Kurbelwelle ist der GESAMTTAKT
  // gleichmaessig, die einzelne BANK aber lumpig, und weil jede Bank ihren eigenen
  // Kruemmer hat, entsteht daraus das Blubbern.
  // A port of tools/engine_synth.py's core into Web Audio, so a parameter change can be
  // heard rather than rendered to a file first. Deliberately at the very END of the IIFE,
  // like the Programmierschule above: this block reads DOM state at load time to paint its
  // initial values, and anything doing that from the middle of the file trips over a const
  // declared further down and takes the whole IIFE with it.

  const MW_SR = 22050;              // same as the generator, and plenty for exhaust noise
  const MW_C = 343.0;               // speed of sound, m/s
  const MW_KEYS = ['cyl', 'layout', 'crank', 'rpm', 'pipe', 'pulse', 'decay', 'drive',
                   'clatter', 'scatter', 'intake', 'load'];
  const MW_STORE = 'chc.motorwerkstatt.v1';
  let mwNodes = null;               // { src, gain } of the loop currently sounding
  let mwBusy = false;
  let mwDelArmed = 0;

  function mwEl(id) { return document.getElementById('mw-' + id); }

  // ---------------------------------------------------------------- sieben Rennmotoren
  //
  // Was aus den technischen Angaben kommt: Zylinderzahl, Bauart, Kurbelwelle, Drehzahl und
  // die Zuendfolge. Was NICHT: Hubraum, Bohrung und Hub - dieses Modell synthetisiert
  // Zuendereignisse und rechnet keine Gasdynamik, also gibt es keine Groesse, in die ein
  // Hubraum eingehen koennte. Die sieben Klangregler sind nach Gehoer gewaehlt; sie stehen
  // hier unter 'gewaehlt', damit niemand sie fuer abgeleitet haelt.
  //
  // 'banking' ist keine Beliebigkeit, sondern die Nummerierung des Herstellers: GM zaehlt
  // ungerade Zylinder links und gerade rechts, Mercedes und BMW zaehlen die erste Haelfte
  // links. Unter der falschen Konvention wird aus einer sauberen Zuendfolge Unsinn - beim
  // Ferrari-V6 ist das der Unterschied zwischen 240 Grad je Bank (gleichmaessig, richtig)
  // und 120/120/480 (drei Zuendungen derselben Bank hintereinander).
  //
  // 'lader' merkt an, wo dieses Modell etwas nicht kann: es hat keinen Lader. Geometrie,
  // Kurbelwelle und Zuendfolge stimmen, der Ladedruck fehlt.
  const MW_PRESETS = [
    { id: 'c6r', name: 'Corvette C6.R', motor: 'LS7.R 7.0 V8, Cross-Plane, OHV',
      cyl: 8, layout: 'v', crank: 'cross', rpm: 7200,
      order: [1, 8, 7, 2, 6, 5, 4, 3], banking: 'oddeven', lader: false,
      // Tiefer Cross-Plane-Bass: langes Rohr, breiter Impuls, viel Saettigung. Der LS ist
      // ein Stossstangenmotor, also darf der Ventiltrieb hoerbar sein.
      gewaehlt: { pipe: 30, pulse: 4.2, decay: 165, drive: 3.4, clatter: 0.22,
                  scatter: 0.014, intake: 0.20, load: 1 } },
    { id: 'z06gt3r', name: 'Corvette Z06 GT3.R', motor: 'LT6.R 5.5 V8, Flat-Plane, DOHC',
      cyl: 8, layout: 'v', crank: 'even', rpm: 8600,
      order: [1, 4, 3, 6, 8, 5, 2, 7], banking: 'oddeven', lader: false,
      // Flat-Plane heisst hier 'even': beide Baenke zuenden gleichmaessig, daraus kommt das
      // Kreischen statt des Blubberns. Kurzes Rohr, schmaler Impuls, wenig Saettigung.
      gewaehlt: { pipe: 19, pulse: 2.4, decay: 105, drive: 2.2, clatter: 0.10,
                  scatter: 0.010, intake: 0.34, load: 1 } },
    { id: 'amggt3', name: 'Mercedes-AMG GT3', motor: 'M159 6.2 V8, Cross-Plane, DOHC',
      cyl: 8, layout: 'v', crank: 'cross', rpm: 7700,
      order: [1, 5, 4, 2, 6, 3, 7, 8], banking: 'half', lader: false,
      gewaehlt: { pipe: 27, pulse: 3.8, decay: 150, drive: 3.0, clatter: 0.14,
                  scatter: 0.012, intake: 0.26, load: 1 } },
    { id: 'f296gt3', name: 'Ferrari 296 GT3', motor: 'F163CE 3.0 V6 120 Grad, Twin-Turbo',
      cyl: 6, layout: 'v', crank: 'even', rpm: 8000,
      order: [1, 2, 3, 4, 5, 6], banking: 'oddeven', lader: true,
      // Ohne Lader bleibt der schmale, hohe Ton eines gleichmaessig zuendenden V6. Der
      // Ansauganteil steht hoch, weil beim Original genau dort der Lader sitzt - das ist ein
      // Zugestaendnis an das fehlende Modell, keine Nachbildung.
      gewaehlt: { pipe: 17, pulse: 2.2, decay: 95, drive: 2.0, clatter: 0.08,
                  scatter: 0.009, intake: 0.42, load: 1 } },
    { id: 'm4gt3', name: 'BMW M4 GT3', motor: 'P58 3.0 Reihensechser, Twin-Turbo',
      cyl: 6, layout: 'inline', crank: 'even', rpm: 7200,
      order: [1, 5, 3, 6, 2, 4], banking: 'half', lader: true,
      // Ein Reihensechser hat einen Kruemmer und zuendet alle 120 Grad. Deshalb klingt er
      // glatt, und deshalb braucht er kein Klappern, um Charakter zu haben.
      gewaehlt: { pipe: 21, pulse: 2.8, decay: 120, drive: 2.4, clatter: 0.07,
                  scatter: 0.008, intake: 0.38, load: 1 } },
    { id: 'huracan', name: 'Huracan GT3 / R8 LMS', motor: '5.2 V10 90 Grad, Split-Pin, DOHC',
      cyl: 10, layout: 'v', crank: 'even', rpm: 8700,
      order: [1, 6, 5, 10, 2, 7, 3, 8, 4, 9], banking: 'half', lader: false,
      // Zehn Zuendungen auf 720 Grad sind 144 Grad Abstand, und die Split-Pin-Kurbelwelle
      // verteilt sie sauber auf beide Baenke. Hohe Zuendrate, kurzes Rohr, kaum Saettigung.
      gewaehlt: { pipe: 16, pulse: 2.0, decay: 90, drive: 1.9, clatter: 0.09,
                  scatter: 0.008, intake: 0.30, load: 1 } },
    { id: 'vantagegt3', name: 'Aston Martin Vantage GT3',
      motor: 'M177 4.0 V8, Cross-Plane, Twin-Turbo',
      cyl: 8, layout: 'v', crank: 'cross', rpm: 7200,
      order: [1, 5, 4, 2, 6, 3, 7, 8], banking: 'half', lader: true,
      // Dieselbe Familie wie der M159, kleiner und aufgeladen. Ohne Lader bleibt der
      // Cross-Plane-Takt, gedaempfter: engeres Rohr, weniger Saettigung.
      gewaehlt: { pipe: 24, pulse: 3.4, decay: 135, drive: 2.6, clatter: 0.12,
                  scatter: 0.011, intake: 0.36, load: 1 } },
  ];

  // Welche Bank ein Zylinder bedient, nach der Nummerierung des Herstellers.
  function mwBankOf(nr, cyl, banking) {
    if (banking === 'oddeven') return (nr % 2) ? 0 : 1;
    return nr <= cyl / 2 ? 0 : 1;
  }

  // Die gelieferte Zuendfolge gilt nur, solange die drei Groessen stimmen, die sie
  // ueberhaupt sinnvoll machen: Zylinderzahl, Bauart und Kurbelwelle. Dreht man eine davon
  // weiter, faellt das Modell auf seine eigene Ableitung zurueck - sonst wuerde eine
  // AMG-Zuendfolge auf einem Reihenfuenfer weitergelten. Die Klangregler dagegen aendern
  // nichts an der Gueltigkeit, man darf am gewaehlten Motor also weiterschrauben.
  function mwOrderActive(c) {
    return !!(mwPreset && mwPreset.order && mwPreset.cyl === c.cyl
              && mwPreset.layout === c.layout && mwPreset.crank === c.crank);
  }

  // Die Zuendfolge des gewaehlten Motors, oder null wenn von Hand gedreht wird. Sobald ein
  // Regler angefasst wird, faellt sie weg und das Modell leitet die Baenke wieder selbst ab
  // - sonst wuerde eine Zuendfolge weitergelten, die zur eingestellten Zylinderzahl nicht
  // mehr passt.
  let mwPreset = null;

  function mwRead() {
    return {
      cyl: +mwEl('cyl').value, layout: mwEl('layout').value, crank: mwEl('crank').value,
      rpm: +mwEl('rpm').value, pipe: +mwEl('pipe').value, pulse: +mwEl('pulse').value,
      decay: +mwEl('decay').value, drive: +mwEl('drive').value,
      clatter: +mwEl('clatter').value, scatter: +mwEl('scatter').value,
      intake: +mwEl('intake').value, load: +mwEl('load').value,
    };
  }

  function mwWrite(cfg) {
    for (const k of MW_KEYS) {
      const el = mwEl(k);
      if (el && cfg[k] !== undefined) el.value = cfg[k];
    }
    mwPaint();
  }

  function mwPaint() {
    mwCharts();
    mwPresetRow();
    const c = mwRead();
    const set = (id, t) => { const e = mwEl(id + '-val'); if (e) e.textContent = t; };
    set('cyl', c.cyl);
    set('rpm', c.rpm + '/min');
    set('pipe', c.pipe.toFixed(1) + '\u2033');
    set('pulse', c.pulse.toFixed(1) + ' ms');
    set('decay', c.decay + ' ms');
    set('drive', c.drive.toFixed(1));
    set('clatter', c.clatter.toFixed(2));
    set('scatter', c.scatter.toFixed(3));
    set('intake', c.intake.toFixed(2));
    set('load', c.load <= 0.06 ? 'Schub' : c.load >= 0.94 ? 'Zug'
                                         : Math.round(c.load * 100) + ' %');
    // The three numbers nobody can work out in their head, and which decide the character.
    const res = MW_C / (4 * c.pipe * 0.0254);
    const fire = c.rpm / 60 * c.cyl / 2;
    // Kein Woerterbucheintrag moeglich: die Zahlen aendern sich mit jedem Regler, der
    // Schluessel waere also nie derselbe. Deshalb ueber t() die WOERTER, nicht den Satz.
    mwEl('derived').textContent =
      t('Resonanz') + ' ' + res.toFixed(0) + ' Hz  \u00b7  '
      + t('Z\u00fcndrate') + ' ' + fire.toFixed(0) + ' Hz  \u00b7  '
      + t('Zyklusrate') + ' ' + (c.rpm / 120).toFixed(1) + ' Hz';
    // An inline engine has one bank, so there is no cross-plane version of it to choose;
    // and a cross-plane crank needs the cylinders to split into equal banks of pairs.
    const noCross = c.layout === 'inline' || c.cyl % 4 !== 0;
    // Nur die OPTION sperren, nicht das ganze Auswahlfeld. Vorher war bei einem V6, V10 oder
    // Reihenmotor das ganze Feld gesperrt: man konnte nichts mehr waehlen und sah auch
    // nicht, WAS nicht geht. Jetzt bleibt das Feld bedienbar, Cross-Plane ist ausgegraut,
    // und der Grund steht sichtbar darunter statt in einem title-Attribut, das auf dem
    // Telefon niemand aufklappt.
    const opt = mwEl('crank').querySelector('option[value=cross]');
    if (opt) {
      opt.disabled = noCross;
      opt.textContent = noCross ? 'Cross-Plane (hier nicht moeglich)'
                                : 'Cross-Plane (ungleiche Baenke)';
    }
    mwEl('crank').disabled = false;
    // Steht Cross-Plane und wird gerade unmoeglich, muss der Wert mit: ein Auswahlfeld, das
    // einen gesperrten Wert anzeigt, luegt ueber das, was gerechnet wird.
    if (noCross && mwEl('crank').value === 'cross') mwEl('crank').value = 'even';
    const grund = c.layout === 'inline'
      ? 'Ein Reihenmotor hat nur eine Bank, also keine ungleichen Baenke.'
      : 'Cross-Plane braucht Zylinder paarweise je Bank, also eine durch vier teilbare'
        + ' Zahl (8 oder 12).';
    mwEl('crank').title = noCross ? grund : '';
    const hw = mwEl('crank-note');
    if (hw) hw.textContent = noCross ? grund : '';
  }

  // Firing angles over one 720-degree cycle, as [angle, bank]. This is where the character
  // lives, so it is the one part that is not a slider.
  //
  // The subtlety that a first attempt here got wrong: on a cross-plane V8 the TOTAL firing
  // order is perfectly even, every 90 degrees. What is uneven is each BANK taken by itself,
  // and since each bank has its own exhaust manifold, each carries a lumpy pulse train —
  // mixing two lumpy trains is the burble. Offsetting a whole bank by 90 degrees, as that
  // attempt did, lands exactly halfway between the other bank's events on a V8 and produces
  // a textbook EVEN order: the setting existed and changed nothing.
  //
  // A flat-plane crank puts 180 degrees between events within a bank, which is why a
  // Ferrari V8 screams on the same eight cylinders.
  function mwFiringAngles(c) {
    const step = 720 / c.cyl;
    // Eine echte Zuendfolge schlaegt jede Ableitung. Die WINKEL sind in beiden Faellen
    // gleichmaessig verteilt - eine Kurbelwelle zuendet alle 720/n Grad, auch die
    // Cross-Plane. Was die Zuendfolge festlegt, ist die Zuordnung der Baenke, und genau
    // daraus entsteht der Charakter, weil jede Bank ihren eigenen Kruemmer hat.
    if (mwOrderActive(c)) {
      const p = mwPreset;
      return p.order.map((nr, i) => [i * step,
        c.layout === 'inline' ? 0 : mwBankOf(nr, p.cyl, p.banking)]);
    }
    if (c.layout === 'inline') {
      const a = [];
      for (let i = 0; i < c.cyl; i++) a.push([i * step, 0]);   // one bank, one manifold
      return a;
    }
    // A cross-plane crank needs the cylinders to split into two equal banks of PAIRS, so
    // the count has to divide by four. On a V6 the pair rule would put four cylinders in one
    // bank and two in the other, and one side would simply be twice as loud — an engine
    // nobody builds and nobody wants to hear. Anything else falls back to even firing.
    if (c.crank === 'even' || c.cyl % 4 !== 0) {
      // Cylinders alternate banks in firing order, so each bank fires evenly at twice the
      // engine's interval.
      const a = [];
      for (let i = 0; i < c.cyl; i++) a.push([i * step, i % 2]);
      return a;
    }
    if (c.cyl === 8) {
      // The real thing: firing order 1-5-4-8-6-3-7-2 at 90-degree intervals. Bank L
      // (cylinders 1-4) ends up at 0/180/450/630 and bank R at 90/270/360/540 — both
      // uneven, which is the whole point.
      const order = [1, 5, 4, 8, 6, 3, 7, 2];
      const a = [];
      for (let i = 0; i < 8; i++) a.push([i * 90, order[i] <= 4 ? 0 : 1]);
      return a;
    }
    // General case, for cylinder counts a cross-plane crank is not actually built with:
    // assign banks in PAIRS instead of alternating. The total stays even, each bank gets
    // two events close together and then a long gap, which is the same effect.
    const a = [];
    for (let i = 0; i < c.cyl; i++) a.push([i * step, (Math.floor(i / 2) % 2)]);
    return a;
  }

  // A tiny deterministic generator. Math.random() would make every press of "Anhoeren"
  // produce a different engine, and then no slider could be judged.
  function mwRng(seed) {
    let x = (seed | 0) || 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  }
  function mwNormal(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // The exhaust impulse response: a quarter-wave pipe rings at c/(4L) and dies away. Two
  // partials, because a real pipe is not a single mode, and a little noise so it is not a
  // pure tone.
  function mwExhaustIR(c, rnd) {
    const res = MW_C / (4 * c.pipe * 0.0254);
    const n = Math.max(32, Math.round(c.decay * 0.001 * MW_SR * 3));
    const ir = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / MW_SR;
      const env = Math.exp(-t / (c.decay * 0.001));
      ir[i] = env * (Math.sin(2 * Math.PI * res * t)
                     + 0.38 * Math.sin(2 * Math.PI * res * 3 * t)
                     + 0.10 * (rnd() * 2 - 1));
    }
    // The response MUST have zero mean, and not as a nicety: a pipe cannot radiate a
    // standing pressure offset, only changes in pressure. A decaying sine starts at zero and
    // its first half-cycle is never fully cancelled by the smaller one after it, so the raw
    // shape above carries a positive mean — and convolving a one-sided pulse train with it
    // builds a pedestal that grows with the number of pulses. On a V8 at 4500 rpm the
    // pedestal (about 6) stayed under the ripple and nothing looked wrong. On a V12 at
    // 17500 it reached 23 while the ripple was 12, so the signal never crossed zero, tanh
    // clipped every sample to the same value, and removing the mean afterwards left exactly
    // silence. Ten cylinders and up rendered nothing at all.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += ir[i];
    mean /= n;
    for (let i = 0; i < n; i++) ir[i] -= mean;
    return ir;
  }

  // One pulse train over a whole number of 720-degree cycles. Whole cycles are what make
  // the result exactly periodic, which is what lets it loop without a click.
  // Returns ONE train per bank. Two banks cannot share a convolution: the uneven spacing
  // within a bank only becomes audible once each bank goes through its own pipe, because a
  // single shared pipe just sums the two into the even total again. That is also physically
  // what a V is — two manifolds that meet in the air, not in the engine.
  function mwPulseTrain(c, cycles, n, rnd) {
    const cycleS = 120 / c.rpm;
    const angles = mwFiringAngles(c);
    const pulseLen = Math.max(4, Math.round(c.pulse * 0.001 * MW_SR));
    // Per-CYLINDER offsets, drawn once and reused every cycle: a real engine's cylinders are
    // consistently a little different from each other, they do not re-randomise every
    // revolution. Drawing per event instead produces a wobble, not an engine.
    const off = angles.map(() => mwNormal(rnd) * c.scatter);
    const gain = angles.map(() => 1 + mwNormal(rnd) * 0.05);
    const banks = [new Float32Array(n), new Float32Array(n)];
    for (let cyc = 0; cyc < cycles; cyc++) {
      for (let j = 0; j < angles.length; j++) {
        const t = (cyc + angles[j][0] / 720 + off[j]) * cycleS;
        const start = Math.round(t * MW_SR);
        const amp = gain[j] * (0.30 + 0.70 * c.load);
        const train = banks[angles[j][1]];
        for (let k = 0; k < pulseLen; k++) {
          // Half-sine squared: a one-sided pressure pulse, which is what a blowdown is.
          const w = Math.sin(Math.PI * k / pulseLen);
          train[(start + k) % n] += amp * w * w;
        }
      }
    }
    // Valvetrain: one tick per cylinder per cycle, quiet and hard, at half engine speed.
    // Goes into bank 0 only — the camshaft is one mechanism, not two, and it reaches the ear
    // through the block rather than through either exhaust.
    if (c.clatter > 0) {
      const len = Math.max(4, Math.round(0.0016 * MW_SR));
      for (let cyc = 0; cyc < cycles; cyc++) {
        for (let j = 0; j < c.cyl; j++) {
          const t = (cyc + (j + 0.35) / c.cyl) * cycleS + mwNormal(rnd) * 0.01 * cycleS;
          const start = Math.round(t * MW_SR);
          for (let k = 0; k < len; k++) {
            banks[0][(start + k) % n] += c.clatter * (rnd() * 2 - 1) * Math.exp(-k / (len * 0.3));
          }
        }
      }
    }
    return banks;
  }

  function mwSaturate(x, drive) {
    const d = Math.tanh(drive);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / d;
  }

  // Render one seamless loop. The convolution runs in an OfflineAudioContext because a
  // ConvolverNode uses a native FFT, and a hand-written loop over 35000 x 1500 samples
  // would stall the page for about a second on every slider move.
  //
  // ConvolverNode is LINEAR, though, and a linear convolution of a periodic signal has a
  // ramp at the start where the tail has not built up yet - which would click on every pass
  // of the loop. So three copies of the train go in and only the MIDDLE one comes out: by
  // then the tail is in steady state and the result is genuinely periodic.
  async function mwRender() {
    const c = mwRead();
    const cycleS = 120 / c.rpm;
    const cycles = Math.max(1, Math.round(1.6 / cycleS));
    const n = Math.round(cycles * cycleS * MW_SR);
    const rnd = mwRng(1234567);
    const banks = mwPulseTrain(c, cycles, n, rnd);
    const ctx = new OfflineAudioContext(1, n * 3, MW_SR);
    const oneBank = c.layout === 'inline';

    for (let b = 0; b < (oneBank ? 1 : 2); b++) {
      const buf = ctx.createBuffer(1, n * 3, MW_SR);
      const d = buf.getChannelData(0);
      for (let r = 0; r < 3; r++) d.set(banks[b], r * n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // The second bank's primary is a few per cent longer. On a real V it has to be —
      // the two runs to the collector cannot be the same length — and without the
      // difference both banks would ring at exactly the same pitch and the uneven spacing
      // would cancel back into the even total.
      const bankCfg = Object.assign({}, c, { pipe: c.pipe * (b ? 1.06 : 1.0) });
      const ir = mwExhaustIR(bankCfg, rnd);
      const irBuf = ctx.createBuffer(1, ir.length, MW_SR);
      irBuf.getChannelData(0).set(ir);
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = irBuf;
      const lvl = ctx.createGain();
      lvl.gain.value = oneBank ? 1.0 : 0.5;
      src.connect(conv).connect(lvl).connect(ctx.destination);
      // The intake side: the same events through a short, bright, far less resonant path.
      // Mixed in almost dry, because intake noise reaches the ear much less filtered.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.7;
      const dry = ctx.createGain();
      dry.gain.value = c.intake * (oneBank ? 1.0 : 0.5);
      src.connect(bp).connect(dry).connect(ctx.destination);
      src.start(0);
    }

    const rendered = await ctx.startRendering();
    const mid = rendered.getChannelData(0).slice(n, n * 2);
    // Offset out BEFORE saturating, not only after. Saturation is non-linear, so a pedestal
    // does not just shift the result — it decides which part of the tanh curve the waveform
    // sits on, and a large enough one flattens the whole thing.
    let pre = 0;
    for (let i = 0; i < mid.length; i++) pre += mid[i];
    pre /= mid.length;
    let raw = 1e-9;
    for (let i = 0; i < mid.length; i++) {
      mid[i] -= pre;
      raw = Math.max(raw, Math.abs(mid[i]));
    }
    // Normalise BEFORE saturating. tanh has one useful range, roughly -3..3, and the raw
    // convolution comes out around 20 — so without this every setting of the saturation
    // slider clipped to the same square wave and the slider did nothing audible. Measured
    // before the fix: RMS 0.84 against a peak of 0.89, which is a square wave, not an
    // engine.
    for (let i = 0; i < mid.length; i++) mid[i] /= raw;
    mwSaturate(mid, c.drive * (0.5 + 0.5 * c.load));
    // And again afterwards, because tanh is not symmetric about an arbitrary signal's own
    // distribution: clipping one side harder than the other reintroduces an offset.
    let mean = 0;
    for (let i = 0; i < mid.length; i++) mean += mid[i];
    mean /= mid.length;
    let peak = 1e-9;
    for (let i = 0; i < mid.length; i++) {
      mid[i] -= mean;
      peak = Math.max(peak, Math.abs(mid[i]));
    }
    for (let i = 0; i < mid.length; i++) mid[i] *= 0.89 / peak;
    return { data: mid, seconds: n / MW_SR };
  }

  // ---------------------------------------------------------------- drei Diagramme
  //
  // Gerechnet aus demselben Modell, das auch den Ton macht: dieselbe mwFiringAngles,
  // dieselbe mwPulseTrain, dieselbe mwExhaustIR. Ein Bild, das seine Zahlen woanders
  // herholt, wuerde bei jeder Aenderung luegen.

  // Zuendfolge ueber 720 Grad. Kein Liniendiagramm, sondern Striche: der Abstand ist die
  // Aussage, nicht ein Verlauf.
  function mwChartFire(c) {
    const W = 640, H = 118, L = 30, R = 16, T = 22;
    const ang = mwFiringAngles(c);
    const eine = c.layout === 'inline' || ang.every(a => a[1] === ang[0][1]);
    const x = g => L + g / 720 * (W - L - R);
    const yv = [T + 12, eine ? T + 12 : T + 56];
    let out = '';
    for (let g = 0; g <= 720; g += 90) {
      out += '<line x1="' + x(g).toFixed(1) + '" y1="' + T + '" x2="' + x(g).toFixed(1)
           + '" y2="' + (H - 22) + '" stroke="#454d5e" stroke-width="1"/>'
           + '<text x="' + x(g).toFixed(1) + '" y="' + (H - 8)
           + '" text-anchor="middle" font-size="9.5" fill="#a9b2c4">' + g + '</text>';
    }
    for (let b = 0; b < (eine ? 1 : 2); b++) {
      out += '<text x="4" y="' + (yv[b] + 14) + '" font-size="9.5" fill="#a9b2c4">'
           + (eine ? 'alle' : (b ? 'B' : 'A')) + '</text>';
      // Die Abstaende dieser Bank, damit man Gleichmass nicht schaetzen muss.
      const mine = ang.filter(a => a[1] === b).map(a => a[0]);
      for (let k = 0; k < mine.length; k++) {
        const nx = mine[(k + 1) % mine.length] + (k + 1 === mine.length ? 720 : 0);
        const mid = (mine[k] + nx) / 2;
        if (nx - mine[k] < 60) continue;         // zu eng fuer eine Zahl
        out += '<text x="' + x(mid % 720 || mid).toFixed(1) + '" y="' + (yv[b] - 3)
             + '" text-anchor="middle" font-size="9" fill="#6f7889">'
             + Math.round(nx - mine[k]) + '</text>';
      }
    }
    for (let i = 0; i < ang.length; i++) {
      const b = eine ? 0 : ang[i][1], X = x(ang[i][0]);
      out += '<rect x="' + (X - 2.5).toFixed(1) + '" y="' + yv[b]
           + '" width="5" height="26" rx="1.5" fill="'
           + (b ? '#ff9c3a' : '#5aa9ff') + '"/>'
           + '<text x="' + X.toFixed(1) + '" y="' + (yv[b] + 19)
           + '" text-anchor="middle" font-size="9" font-weight="700" fill="#14161c">'
           + (mwOrderActive(c) ? mwPreset.order[i] : i + 1) + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-label="Z\u00fcndfolge">'
         + '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="'
         + (H - T - 22) + '" fill="#14161c"/>' + out
         + '<text x="' + L + '" y="12" font-size="9.5" fill="#f4f6fb">Kurbelwinkel, Grad'
         + '</text></svg>';
  }

  // Ein einzelner Impuls, durch dasselbe Rohr geschickt und ges\u00e4ttigt wie im Ton.
  function mwChartPulse(c) {
    // Der Impuls wird hier direkt gebaut, mit DERSELBEN Formel wie in mwPulseTrain: eine
    // halbe Sinuswelle, quadriert, also ein einseitiger Druckstoss.
    //
    // Vorher stand hier mwPulseTrain(eins, [[0, 0]], n, rnd), und das war in zwei Punkten
    // falsch: das zweite Argument ist eine ZYKLENZAHL, keine Winkelliste, und zurueck kommen
    // ZWEI Baenke, keine Spur. Gelesen wurde das Ergebnis wie eine Spur, also war jeder Wert
    // undefiniert und das Bild eine Nulllinie - deshalb aenderte sich beim Drehen der Regler
    // nichts. Gemessen: der Bildinhalt war ueber pipe, pulse, decay, drive, rpm, cyl und
    // clatter hinweg zeichengleich. Ein einzelner Impuls braucht die Funktion ohnehin nicht.
    const eins = Object.assign({}, c, { cyl: 1, clatter: 0, scatter: 0 });
    const n = Math.round(0.055 * MW_SR);
    const pulseLen = Math.max(4, Math.round(c.pulse * 0.001 * MW_SR));
    const roh = new Float32Array(n);
    const ab = Math.round(0.004 * MW_SR);      // Vorlauf, damit die Flanke zu sehen ist
    for (let k = 0; k < pulseLen && ab + k < n; k++) {
      const w = Math.sin(Math.PI * k / pulseLen);
      roh[ab + k] = w * w;
    }
    const ir = mwExhaustIR(eins, mwRng(7));
    // Faltung, kurz gehalten: nur so weit wie das Fenster reicht.
    const nass = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!roh[i]) continue;
      const m = Math.min(ir.length, n - i);
      for (let k = 0; k < m; k++) nass[i + k] += roh[i] * ir[k];
    }
    // Erst auf eins normieren, DANN saettigen, und zwar die ganze Spur auf einmal:
    // mwSaturate arbeitet an Ort und Stelle auf einem Array und gibt nichts zurueck.
    //
    // Genau daran lag der zweite Fehler in dieser Funktion, und es war derselbe wie der
    // erste: eine Signatur angenommen statt nachgelesen. mwSaturate(nass[i], c.drive) bekam
    // eine ZAHL, x.length war undefiniert, die Schleife darin lief null Mal und heraus kam
    // undefined - die orange Kurve bestand also aus lauter undefined und war gar nicht da.
    // Gemessen hat es sich so: von min auf max geaendert wirkte nur der Regler
    // Impulslaenge, und der ist der einzige, der die GRAUE Rohkurve beeinflusst. Rohr,
    // Abfall und Saettigung wirken alle drei ausschliesslich auf die orange, und alle drei
    // meldeten "keine Wirkung". Drei stumme Regler und ein sprechender waren der Hinweis,
    // welche der beiden Kurven fehlt.
    let sp = 0;
    for (let i = 0; i < n; i++) sp = Math.max(sp, Math.abs(nass[i]));
    if (sp > 0) for (let i = 0; i < n; i++) nass[i] /= sp;
    mwSaturate(nass, c.drive);
    const pts = [], pts2 = [];
    const schritt = Math.max(1, Math.floor(n / 320));
    for (let i = 0; i < n; i += schritt) {
      const t = i / MW_SR * 1000;
      pts.push([t, nass[i]]);
      pts2.push([t, roh[i]]);
    }
    return renderLineChart({
      height: 170, xLabel: 'Millisekunden', yLabel: 'Druck', yMin: -1.1, yMax: 1.1,
      ariaLabel: 'Ein Z\u00fcndimpuls',
      series: [{ points: pts2, color: '#6f7889', width: 1 },
               { points: pts, color: '#ff9c3a', width: 2 }] });
  }

  // Frequenzbild des Rohrs. Eine kleine DFT reicht: es geht um die Lage der Spitze, nicht
  // um Auflaesung.
  function mwChartSpec(c) {
    const ir = mwExhaustIR(c, mwRng(7));
    const res = MW_C / (4 * c.pipe * 0.0254);
    const fire = c.rpm / 60 * c.cyl / 2;
    const fMax = Math.max(res * 3.2, fire * 2.2, 900);
    const pts = [];
    let sp = 0;
    const N = 150;
    for (let k = 1; k <= N; k++) {
      const f = fMax * k / N;
      let re = 0, im = 0;
      // Jede achte Probe: die Spitzenlage aendert sich dadurch nicht, die Rechenzeit schon.
      for (let i = 0; i < ir.length; i += 8) {
        const w = 2 * Math.PI * f * i / MW_SR;
        re += ir[i] * Math.cos(w);
        im -= ir[i] * Math.sin(w);
      }
      const m = Math.hypot(re, im);
      sp = Math.max(sp, m);
      pts.push([f, m]);
    }
    for (const p of pts) p[1] /= (sp || 1);
    // Die zwei Marken als senkrechte Strecken - kein neuer Zeichenbaustein noetig.
    return renderLineChart({
      height: 170, xLabel: 'Hertz', yLabel: 'Pegel', yMin: 0, yMax: 1.12,
      ariaLabel: 'Auspuffresonanz',
      series: [{ points: pts, color: '#ff9c3a', width: 2 },
               { points: [[res, 0], [res, 1.06]], color: '#5aa9ff', width: 2, dash: '4 3',
                 label: Math.round(res) + ' Hz' },
               { points: [[fire, 0], [fire, 1.06]], color: '#ff5d5d', width: 2, dash: '4 3',
                 label: Math.round(fire) + '/s' }] });
  }

  function mwCharts() {
    const c = mwRead();
    const put = (id, html) => {
      const e = document.getElementById('mw-chart-' + id);
      if (e) e.innerHTML = html;
    };
    // Ein Fehler in einem Bild darf nicht den Ton mitnehmen.
    try { put('fire', mwChartFire(c)); } catch (e) { put('fire', ''); }
    try { put('pulse', mwChartPulse(c)); } catch (e) { put('pulse', ''); }
    try { put('spec', mwChartSpec(c)); } catch (e) { put('spec', ''); }
    // Liegt ein Bild gerade gross auf dem Schirm, muss die grosse Fassung mitkommen. Sonst
    // zeigt die Lightbox einen Stand, den es nicht mehr gibt.
    lightboxRefresh();
  }

  // ---------------------------------------------------------------- Lightbox
  //
  // Geklont, nicht neu gezeichnet. Ein zweiter Zeichenweg fuer die grosse Fassung waere ein
  // zweiter Ort, an dem etwas anders sein kann - und genau das soll ein Bild, das man zum
  // Nachmessen aufzieht, nicht haben.
  let lbQuelle = null;          // welches Diagramm gerade gross liegt

  function lightboxOpen(id, titel, hinweis) {
    const q = document.getElementById('mw-chart-' + id);
    const svg = q && q.querySelector('svg');
    if (!svg) return;
    lbQuelle = { id, titel, hinweis };
    $('lb-title').textContent = titel;
    $('lb-note').textContent = hinweis || '';
    const body = $('lb-body');
    body.innerHTML = '';
    const gross = svg.cloneNode(true);
    // Die kleine Fassung ist auf Kachelbreite gerechnet; gross darf sie den Platz nehmen,
    // den sie bekommt. Das viewBox bleibt, also stimmen alle Verhaeltnisse.
    gross.removeAttribute('style');
    gross.setAttribute('width', '100%');
    body.appendChild(gross);
    $('lb-wrap').classList.add('on');
  }

  function lightboxClose() {
    $('lb-wrap').classList.remove('on');
    $('lb-body').innerHTML = '';
    lbQuelle = null;
  }

  // Beim Drehen eines Reglers wird neu gezeichnet. Liegt das Bild gerade gross auf dem
  // Schirm, muss es mitkommen, sonst zeigt es einen Stand, den es nicht mehr gibt.
  function lightboxRefresh() {
    if (!lbQuelle || !$('lb-wrap').classList.contains('on')) return;
    const q = lbQuelle;
    lightboxOpen(q.id, q.titel, q.hinweis);
  }

  if ($('lb-close')) $('lb-close').addEventListener('click', lightboxClose);
  if ($('lb-wrap')) {
    // Klick auf den Hintergrund schliesst, Klick INS Bild nicht.
    $('lb-wrap').addEventListener('click', (e) => {
      if (e.target === $('lb-wrap')) lightboxClose();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('lb-wrap') && $('lb-wrap').classList.contains('on')) {
      lightboxClose();
    }
  });

  // Die drei Diagramme anklickbar machen. Der Hinweistext ist derselbe, der klein
  // darunter steht - gross gelesen hilft er mehr.
  for (const [id, titel] of [['fire', 'Z\u00fcndfolge \u00fcber 720\u00b0'],
                             ['pulse', 'Ein Z\u00fcndimpuls mit Nachhall'],
                             ['spec', 'Resonanz des Rohrs']]) {
    const e = document.getElementById('mw-chart-' + id);
    if (!e) continue;
    e.addEventListener('click', () => {
      const p = e.parentElement.querySelector('p');
      lightboxOpen(id, titel, p ? p.textContent.replace(/\s+/g, ' ').trim() : '');
    });
  }

  function mwSay(t) { mwEl('status').textContent = t; }

  function mwSilence() {
    if (!mwNodes) return;
    try { mwNodes.src.stop(); } catch (e) { /* already stopped */ }
    mwNodes = null;
  }

  async function mwListen() {
    if (mwBusy) return;
    if (!audioCtx) { mwSay('Ton ist aus, erst oben einschalten.'); return; }
    mwBusy = true;
    mwSay('rechnet \u2026');
    try {
      const out = await mwRender();
      const buf = audioCtx.createBuffer(1, out.data.length, MW_SR);
      buf.getChannelData(0).set(out.data);
      mwSilence();
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = audioCtx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(audioCtx.destination);
      src.start();
      g.gain.setTargetAtTime(engineVolume, audioCtx.currentTime, 0.05);
      mwNodes = { src, gain: g };
      mwSay('l\u00e4uft: ' + out.seconds.toFixed(2) + ' s Schleife');
    } catch (err) {
      mwSay('ging nicht: ' + err.message);
    }
    mwBusy = false;
  }

  // ---- Ablegen im Browser
  function mwSlots() {
    try { return JSON.parse(localStorage.getItem(MW_STORE) || '{}'); } catch (e) { return {}; }
  }
  function mwSlotsWrite(o) {
    try { localStorage.setItem(MW_STORE, JSON.stringify(o)); return true; }
    catch (e) { mwSay('Speicher voll oder gesperrt.'); return false; }
  }
  function mwRefreshSlots() {
    const sel = mwEl('slots');
    const names = Object.keys(mwSlots()).sort();
    const keep = sel.value;
    sel.textContent = '';
    const head = document.createElement('option');
    head.value = '';
    head.textContent = '-- abgelegte Motoren --';
    sel.appendChild(head);
    for (const n of names) {
      const o = document.createElement('option');
      // textContent, not innerHTML: the name comes from a text field, and building markup
      // out of it would let a name change the page.
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    }
    if (names.includes(keep)) sel.value = keep;
  }

  function mwPresetRow() {
    const row = document.getElementById('mw-preset-row');
    if (!row) return;
    row.innerHTML = '';
    for (const p of MW_PRESETS) {
      const b = document.createElement('button');
      b.className = 'mw-preset'
        + (mwPreset && mwPreset.id === p.id && mwOrderActive(mwRead()) ? ' sel' : '');
      b.textContent = p.name;
      b.title = p.motor + ', ' + p.rpm + '/min, Zuendfolge ' + p.order.join('-')
              + (p.lader ? ' (aufgeladen, ohne Ladermodell)' : '');
      b.addEventListener('click', () => mwPresetLoad(p));
      row.appendChild(b);
    }
  }

  function mwPresetLoad(p) {
    mwPreset = p;
    mwWrite(Object.assign({ cyl: p.cyl, layout: p.layout, crank: p.crank, rpm: p.rpm },
                          p.gewaehlt));
    mwPresetRow();
    mwSay(p.name + ': ' + p.motor + ', ' + t('Z\u00fcndfolge') + ' '
          + p.order.join('-')
          + (p.lader ? '. ' + t('Aufgeladen, dieses Modell hat keinen Lader.') : ''));
  }

  mwEl('listen').addEventListener('click', mwListen);
  mwEl('stop').addEventListener('click', () => { mwSilence(); mwSay(''); });

  // Adopt: install as a session profile alongside the shipped ones. Not written to a file -
  // the engine IS the twelve numbers, and a rendered file would only be a staler copy.
  mwEl('adopt').addEventListener('click', async () => {
    if (!audioCtx) { mwSay('Ton ist aus, erst oben einschalten.'); return; }
    if (mwBusy) return;
    mwBusy = true;
    mwSay('rechnet drei B\u00e4nder \u2026');
    const keepRpm = mwEl('rpm').value;
    try {
      // Three bands from one setting, by re-rendering at three engine speeds. The
      // alternative - resampling a single loop across the whole rev range - stops sounding
      // like an engine about an octave out, which is exactly what the bands are for.
      const c = mwRead();
      const rpms = [Math.max(700, Math.round(c.rpm * 0.30)), c.rpm,
                    Math.min(18000, Math.round(c.rpm * 1.75))];
      const bands = ['idle', 'mid', 'high'];
      const built = {};
      for (let i = 0; i < 3; i++) {
        mwEl('rpm').value = rpms[i];
        const out = await mwRender();
        const buf = audioCtx.createBuffer(1, out.data.length, MW_SR);
        buf.getChannelData(0).set(out.data);
        built[bands[i]] = { buffer: buf, baseRpm: rpms[i] };
      }
      // Unter dem Namen des gewaehlten Motors, sonst unter dem freien Werkstattplatz.
      // Sieben Eintraege gleich beim Laden anzubieten waere ehrlicher aussehend als es
      // ist: es waeren einundzwanzig Renderlaeufe, bevor die App das erste Mal etwas
      // anzeigt. So steht im Dropdown genau, was auch gerechnet wurde.
      const wname = mwOrderActive(c) ? 'mw-' + mwPreset.id : 'werkstatt';
      const wlabel = mwOrderActive(c) ? mwPreset.name + ' (Werkstatt)'
                                      : 'Werkstatt, selbst gebaut';
      sampleEngine.buffers[wname] = built;
      const sel = $('sound-profile');
      if (!SAMPLE_CARS.includes(wname)) {
        SAMPLE_CARS.push(wname);
        const o = document.createElement('option');
        o.value = wname;
        o.textContent = wlabel;
        sel.appendChild(o);
      }
      mwSilence();
      sel.value = wname;
      // The sample engine may never have loaded a file (audio/ not deployed). It still has
      // to accept this one, since these buffers were built here and not fetched.
      sampleEngine.ready = true;
      startSampleEngine(wname);
      mwSay(wlabel + ': im Cockpit h\u00f6rbar, ' + rpms.join(' / ') + '/min');
    } catch (err) {
      mwSay('ging nicht: ' + err.message);
    }
    mwEl('rpm').value = keepRpm;
    mwPaint();
    mwBusy = false;
  });

  mwEl('save').addEventListener('click', () => {
    const name = mwEl('name').value.trim();
    if (!name) { mwSay('Erst einen Namen eintragen.'); return; }
    const all = mwSlots();
    all[name] = mwRead();
    if (!mwSlotsWrite(all)) return;
    mwRefreshSlots();
    mwEl('slots').value = name;
    mwSay('abgelegt als \u201e' + name + '\u201c');
  });

  mwEl('load-slot').addEventListener('click', () => {
    const name = mwEl('slots').value;
    if (!name) { mwSay('Erst einen abgelegten Motor ausw\u00e4hlen.'); return; }
    const cfg = mwSlots()[name];
    if (!cfg) { mwSay('Nicht gefunden.'); return; }
    mwWrite(cfg);
    mwEl('name').value = name;
    mwSay('geladen: \u201e' + name + '\u201c');
    if (mwNodes) mwListen();
  });

  // Two clicks, because there is no undo and the alternative is a lost engine. Deliberately
  // not a browser confirm(): that blocks the audio thread and stops the loop mid-note.
  mwEl('del-slot').addEventListener('click', () => {
    const name = mwEl('slots').value;
    if (!name) { mwSay('Erst einen abgelegten Motor ausw\u00e4hlen.'); return; }
    const now = Date.now();
    if (now - mwDelArmed > 4000) {
      mwDelArmed = now;
      mwSay('Nochmal dr\u00fccken, um \u201e' + name + '\u201c zu l\u00f6schen.');
      return;
    }
    mwDelArmed = 0;
    const all = mwSlots();
    delete all[name];
    if (!mwSlotsWrite(all)) return;
    mwRefreshSlots();
    mwSay('gel\u00f6scht: \u201e' + name + '\u201c');
  });

  mwEl('export').addEventListener('click', () => {
    mwEl('json').value = JSON.stringify(mwRead());
    mwSay('Werte hineingeschrieben, jetzt kopieren.');
  });

  mwEl('import').addEventListener('click', () => {
    const raw = mwEl('json').value.trim();
    if (!raw) { mwSay('Da steht nichts.'); return; }
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) { mwSay('Das ist kein JSON.'); return; }
    if (!cfg || typeof cfg !== 'object') { mwSay('Das ist kein Motor.'); return; }
    // Validated against the controls rather than trusted: this text is pasted in from a
    // chat window, and a single out-of-range number would render silence with no clue why.
    const bad = [];
    for (const k of MW_KEYS) {
      const el = mwEl(k);
      if (!el) continue;
      if (cfg[k] === undefined) { bad.push(k + ' fehlt'); continue; }
      if (el.tagName === 'SELECT') {
        if (![].some.call(el.options, o => o.value === cfg[k])) bad.push(k + '=' + cfg[k]);
      } else {
        const v = +cfg[k];
        if (!isFinite(v) || v < +el.min || v > +el.max) bad.push(k + '=' + cfg[k]);
      }
    }
    if (bad.length) { mwSay('Unbrauchbar: ' + bad.join(', ')); return; }
    mwWrite(cfg);
    mwSay('\u00fcbernommen, jetzt Anh\u00f6ren.');
  });

  for (const k of MW_KEYS) {
    const el = mwEl(k);
    if (!el) continue;
    el.addEventListener('input', () => {
      mwPaint();
      // Re-render what is already playing instead of going quiet: the whole point is to
      // hear the change, and stopping on every slider move would mean never hearing one.
      if (mwNodes) mwListen();
    });
  }

  // Gruppennummern auf die Optionszeilen stempeln. In CSS gibt es keinen Weg, "alle Zeilen
  // nach der n-ten Ueberschrift" zu treffen, und 35 Zeilen von Hand auszuzeichnen waere
  // beim ersten Umsortieren falsch. Also einmal beim Laden durchlaufen.
  function stampOptionGroups() {
    for (const card of document.querySelectorAll('#tab-options .card')) {
      let grp = -1;
      for (const el of card.children) {
        if (el.classList.contains('opt-head')) {
          grp++;
          el.dataset.grp = String(grp % 9);
        } else if (el.classList.contains('opt-row') && grp >= 0) {
          el.dataset.grp = String(grp % 9);
        }
      }
    }
  }
  // Die 80 im Hilfetext kommt aus der Konstante, nicht aus dem Text - sonst laeuft die
  // Tastenuebersicht auseinander, sobald der Wert sich aendert.
  if ($('help-yellow-kmh')) $('help-yellow-kmh').textContent = String(YELLOW_KMH);
  updateFlagUi();

  stampOptionGroups();

  mwPaint();
  mwRefreshSlots();

