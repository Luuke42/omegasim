#!/usr/bin/env python3
"""Generate every non-loop sound: brakes, crashes, pit stop, engine start, accel demos.

All synthetic, no recorded material. Two synthesis styles are used:

  * Circular (as in engine_synth.py) for anything that must loop — the brake squeal.
  * Phase-accumulating for anything where RPM CHANGES over time: engine start and the
    acceleration demos. The circular trick cannot work there, so crank angle is integrated
    sample by sample and a pulse is placed each time a cylinder's firing angle is crossed.

Usage:  python engine_fx.py
"""

import json
import zlib
import os
import subprocess
import wave

import numpy as np

from engine_synth import (CARS, SR, OUT, WORK, exhaust_ir, circular_noise,
                          saturate, metal_tick)

REDLINE = 9000.0
IDLE = 1500.0
# Same gear set the app uses (GT3 ratios normalised into the configurable top speed).
GEARS = [(3.75, 0.2523), (2.38, 0.4000), (1.72, 0.5538),
         (1.34, 0.7108), (1.08, 0.8800), (0.88, 1.0000)]


def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def seed_for(*parts):
    """Stable seed from a name. NOT hash(): Python randomises it per process, so every run
    produced different sounds and the committed .ogg files could never be reproduced. The same
    bug was found and fixed in engine_synth.py."""
    return zlib.crc32('/'.join(map(str, parts)).encode()) % (2 ** 31)


def to_ogg(x, name, q='4'):
    wav = os.path.join(WORK, 'fx_' + name + '.wav')
    write_wav(wav, x)
    ogg = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                    '-c:a', 'libvorbis', '-q:a', q, '-ac', '1', ogg], check=True)
    return os.path.getsize(ogg)


def resonant_noise(n, f0, q, rng):
    """Noise through a very narrow resonance, built circularly so it can loop.

    Working in the frequency domain rather than filtering in time keeps the result exactly
    periodic — a time-domain biquad would leave the two ends of the loop mismatched.
    """
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    resp = 1.0 / (1.0 + (q * ((freqs / max(f0, 1.0)) - (max(f0, 1.0) / np.maximum(freqs, 1.0)))) ** 2)
    spec = resp * np.exp(1j * rng.uniform(0, 2 * np.pi, len(freqs)))
    spec[0] = 0
    y = np.fft.irfft(spec, n)
    return (y / (np.max(np.abs(y)) + 1e-9)).astype(np.float32)


def brake_squeal(seconds=1.4, seed=7):
    """A loopable brake squeal in the manner of Assetto Corsa Competizione.

    The characteristic ACC sound is not hiss — it is a piercing, distinctly TONAL squeal:
    the pad-disc interface resonates at a few closely-spaced high frequencies. So this is
    built from three narrow resonances rather than filtered noise, each with a slow
    independent wobble so it breathes instead of sounding like a test tone, over a quiet
    broadband bed that supplies the underlying grind.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float32)
    # Squeal partials. Not harmonically related — pad resonances are not a harmonic series,
    # which is exactly why a brake squeal sounds metallic rather than musical.
    for f0, amp, q in ((2850.0, 1.00, 55.0), (4180.0, 0.55, 45.0), (5620.0, 0.30, 40.0)):
        layer = resonant_noise(n, f0, q, rng)
        # A slow wobble, looped over a whole number of cycles so the loop stays seamless.
        cycles = max(1, int(round(seconds * rng.uniform(2.5, 4.0))))
        wob = 1.0 + 0.22 * np.sin(2 * np.pi * cycles * t / seconds + rng.uniform(0, 6.28))
        out += (amp * layer * wob).astype(np.float32)
    out += 0.18 * circular_noise(n, 1800.0, rng)      # grind bed
    out += 0.10 * circular_noise(n, 260.0, rng)       # disc rumble through the hub
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.85).astype(np.float32)


def tyre_squeal(seconds=1.6, seed=23):
    """A loopable tyre squeal in the manner of Gran Turismo.

    WHAT MAKES IT A TYRE AND NOT A BRAKE, and the difference is the whole point: the brake
    squeal above is piercing and narrow — pad resonances at 2.8 to 5.6 kHz with Q around 50.
    A tyre is an order lower and far broader. The sound is rubber shearing against tarmac:
    a scrub, not a whistle. So the resonances sit at 620 to 1650 Hz with Q around 12, and a
    substantial broadband bed carries the scrub itself rather than sitting under a tone.

    The pitch is deliberately NOT baked in. The player varies playbackRate with friction
    circle usage, which is how a real squeal rises as the tyre approaches its limit — baking
    a sweep into the loop would fight that and make the seam audible.

    Circular construction throughout, same as the brake squeal: a time-domain filter would
    leave the two ends of the loop mismatched, and a seam in a sound that plays for whole
    corners is far more noticeable than one in a one-shot.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float32)
    # Three broad resonances. Not a harmonic series — a tyre carcass is not a string.
    for f0, amp, q in ((620.0, 1.00, 11.0), (980.0, 0.70, 13.0), (1650.0, 0.34, 15.0)):
        layer = resonant_noise(n, f0, q, rng)
        # A slower, deeper wobble than the brake squeal: a tyre at the limit judders as the
        # contact patch grips and releases, and that is a slower process than pad chatter.
        cycles = max(1, int(round(seconds * rng.uniform(1.4, 2.4))))
        wob = 1.0 + 0.30 * np.sin(2 * np.pi * cycles * t / seconds + rng.uniform(0, 6.28))
        out += (amp * layer * wob).astype(np.float32)
    # The scrub bed carries more weight here than in the brake squeal (0.18 there): the
    # broadband part IS the sound of rubber shearing, not a filler under a tone.
    out += 0.42 * circular_noise(n, 1300.0, rng)
    out += 0.16 * circular_noise(n, 430.0, rng)     # carcass rumble
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.85).astype(np.float32)


def crash(variant, seed):
    """A dull ram between two GT3 cars — carbon and tyres, not glass.

    'Dumpf' is the whole point: a real GT3 contact is a low, damped thump because the
    bodywork is carbon composite and the impact is absorbed rather than shattered. So the
    energy sits below ~600Hz, there is no bright transient, and a short flex-and-scrape
    tail follows the hit. Variants differ in fundamental, decay and how much tail.
    """
    rng = np.random.default_rng(seed)
    base, decay, tail_amt, dur = variant
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float32)

    # The thump: a few low modes of the tub and suspension, heavily damped.
    for k, amp in ((1.0, 1.0), (1.6, 0.55), (2.45, 0.3), (3.7, 0.15)):
        f = base * k
        env = np.exp(-t * decay * (1.0 + 0.35 * k))
        out += (amp * env * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))).astype(np.float32)

    # Impact body: lowpassed noise burst. Short attack, no click — dull, not sharp.
    burst = rng.normal(0, 1, n).astype(np.float32)
    b = np.fft.rfft(burst)
    fr = np.fft.rfftfreq(n, 1.0 / SR)
    b *= 1.0 / (1.0 + (fr / 480.0) ** 3)          # steep rolloff = dull
    burst = np.fft.irfft(b, n).astype(np.float32)
    attack = 1.0 - np.exp(-t * 900.0)
    out += 1.5 * burst * attack * np.exp(-t * decay * 1.7)

    # Tail: carbon flex creak and a brief tyre scrub as the cars separate.
    tail = rng.normal(0, 1, n).astype(np.float32)
    tb = np.fft.rfft(tail)
    tb *= 1.0 / (1.0 + (fr / 1100.0) ** 2)
    tb *= (fr > 120.0)
    tail = np.fft.irfft(tb, n).astype(np.float32)
    out += tail_amt * tail * np.exp(-t * decay * 0.35) * (1.0 - np.exp(-t * 40.0))

    out[:6] *= np.linspace(0, 1, 6)               # no DC step at the very start
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.92).astype(np.float32)


def pit_wrench(seconds=1.1, seed=3):
    """Impact wrench: a fast hammer train with a ringing socket, then spin-down."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float32)
    hits = int(seconds * 26)                      # ~26 blows per second
    for i in range(hits):
        pos = int((i / hits) * n * 0.82)
        ln = min(n - pos, int(0.05 * SR))
        if ln <= 8:
            continue
        lt = np.arange(ln) / SR
        ring = np.zeros(ln, dtype=np.float32)
        for f, a in ((1750.0, 1.0), (2900.0, 0.5), (620.0, 0.7)):
            ring += (a * np.exp(-lt * 130.0) * np.sin(2 * np.pi * f * lt)).astype(np.float32)
        out[pos:pos + ln] += ring * (0.75 + 0.25 * rng.random())
    # Air motor whirr underneath, spinning down at the end.
    whirr = np.sin(2 * np.pi * (95.0 - 45.0 * np.clip((t - 0.8) / 0.3, 0, 1)) * t)
    out += 0.22 * whirr * np.exp(-np.clip(t - 0.85, 0, None) * 6.0)
    out += 0.12 * rng.normal(0, 1, n).astype(np.float32) * np.exp(-t * 1.2)
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.85).astype(np.float32)


def paddle_shift(up=True, seed=11):
    """Pneumatic sequential shift, deliberately dull: a muffled clunk, not a click.

    The first version measured 92% of its energy below 500 Hz and still read as a "clack",
    which pinpoints the cause: it is the ATTACK, not the spectrum. An onset that reaches
    full amplitude within a sample or two is heard as a click regardless of how little
    high-frequency energy it carries. So the fix is threefold and only one part of it is
    about frequency:

      1. every component gets a short RISE (8-14 ms) instead of starting instantly,
      2. the partials move down and the brightest one is dropped entirely,
      3. the low driveline thud becomes the loudest element rather than the garnish.

    The air release is low-passed instead of high-passed, so it reads as a muffled puff
    rather than a hiss.
    """
    rng = np.random.default_rng(seed)
    seconds = 0.24 if up else 0.30
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n, dtype=np.float32)

    def rise(length, ms):
        """Soft onset. This single envelope is what removes the click."""
        lt = np.arange(length) / SR
        return (1 - np.exp(-lt / (ms / 1000.0))).astype(np.float32)

    # 1) Mechanical engagement. Low, inharmonic, slow to decay. The 3.9 kHz partial that
    #    used to sit on top is gone; nothing above 1.3 kHz remains.
    strike = ((640.0, 1.00, 70.0), (410.0, 0.85, 55.0), (1180.0, 0.30, 90.0)) if up \
        else ((470.0, 1.00, 58.0), (300.0, 0.90, 46.0), (880.0, 0.28, 76.0))
    body = np.zeros(n, dtype=np.float32)
    for f, amp, dec in strike:
        jitter = 1.0 + 0.02 * (rng.random() - 0.5)
        body += (amp * np.exp(-t * dec) * np.sin(2 * np.pi * f * jitter * t)).astype(np.float32)
    out += 0.30 * body * rise(n, 9.0 if up else 11.0)

    # 2) Air release: LOW-passed noise, a puff rather than a hiss.
    vent_at = int(0.010 * SR)
    vent_len = int((0.050 if up else 0.080) * SR)
    if vent_at + vent_len < n:
        raw = rng.normal(0, 1, vent_len).astype(np.float32)
        lp = np.zeros(vent_len, dtype=np.float32)
        prev = 0.0
        k = 0.10                      # one-pole low-pass, corner around 700 Hz
        for i in range(vent_len):
            prev += k * (raw[i] - prev)
            lp[i] = prev
        lt = np.arange(vent_len) / SR
        env = np.exp(-lt * (55.0 if up else 38.0)) * rise(vent_len, 7.0)
        out[vent_at:vent_at + vent_len] += 0.20 * lp * env

    # 3) Driveline take-up, now the LOUDEST component: this is what a shift feels like
    #    through the car rather than what it sounds like at the gearbox.
    thud_at = int((0.014 if up else 0.020) * SR)
    thud_len = min(n - thud_at, int(0.16 * SR))
    if thud_len > 16:
        lt = np.arange(thud_len) / SR
        f0 = 104.0 if up else 78.0
        out[thud_at:thud_at + thud_len] += (0.62 * np.exp(-lt * 24.0)
                                            * np.sin(2 * np.pi * f0 * lt)
                                            * rise(thud_len, 12.0)).astype(np.float32)

    out = saturate(out, 0.8)          # gentler than before; hard drive re-adds edge
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.55).astype(np.float32)


def render_rpm_curve(cfg, rpm_of_t, dur, seed, load_of_t=None):
    """Firing synthesis with a CHANGING engine speed.

    Crank angle is integrated sample by sample, and a combustion pulse is written whenever a
    cylinder's firing angle is crossed. That is what makes the gearchanges audible: when the
    RPM drops at a shift, the pulse rate drops with it in the same instant.
    """
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    rpm = np.clip(rpm_of_t(t), 200.0, REDLINE * 1.02)
    load = np.ones(n, dtype=np.float32) if load_of_t is None else load_of_t(t)

    # Crank angle in degrees; 720 degrees is one full engine cycle.
    angle = np.cumsum(rpm * 6.0 / SR)             # rpm*360/60 deg per second
    pulse_len = max(4, int(cfg['pulse_ms'] * 0.001 * SR))
    pt = np.arange(pulse_len) / SR
    pulse = (np.exp(-pt * (1000.0 / cfg['pulse_ms'])) * (1.0 - np.exp(-pt * 8000.0))).astype(np.float32)
    pulse /= np.max(np.abs(pulse)) + 1e-9

    out = np.zeros(n + pulse_len, dtype=np.float32)
    for bank in cfg['banks']:
        train = np.zeros(n + pulse_len, dtype=np.float32)
        for ang in bank:
            # Every crossing of (ang + k*720) degrees is one firing of this cylinder.
            k = np.floor((angle - ang) / 720.0)
            fires = np.flatnonzero(np.diff(k) > 0) + 1
            for i in fires:
                g = load[i] * (1.0 + rng.normal(0, 0.06))
                j = int(rng.normal(0, 0.0012) * SR)          # timing jitter, not just gain
                k0 = min(max(0, i + j), n - 1)
                train[k0:k0 + pulse_len] += pulse * g
        ir = exhaust_ir(len(train), cfg, rng)
        out += np.fft.irfft(np.fft.rfft(train) * np.fft.rfft(ir), len(train)).astype(np.float32)

    out = out[:n]

    # Valvetrain clatter at camshaft rate, i.e. half the crank. The mechanical layer.
    if cfg.get('clatter', 0) > 0:
        tick = metal_tick(max(8, int(0.010 * SR)), cfg['clatter_hz'], rng)
        clat = np.zeros(n + len(tick), dtype=np.float32)
        cam = np.cumsum(rpm * 3.0 / SR)                      # half crank angle, in degrees
        per_rev = max(2, cfg['cylinders'] // 2)
        step = 360.0 / per_rev
        kk = np.floor(cam / step)
        for i in np.flatnonzero(np.diff(kk) > 0) + 1:
            clat[i:i + len(tick)] += tick * (0.6 + 0.6 * rng.random())
        out += cfg['clatter'] * clat[:n] / (np.max(np.abs(clat)) + 1e-9)

    # Overrun backfires: closed throttle, falling revs, still spinning fast. That is
    # unburnt fuel igniting in the hot exhaust, and it is exactly where a GT3 crackles —
    # on downshifts and into a braking zone. Gated so it can never fire under power.
    drpm = np.gradient(rpm) * SR
    pops = 0
    for i in range(200, n - 1200, 60):
        if load[i] < 0.06 and rpm[i] > 3200 and drpm[i] < -900 and rng.random() < 0.16:
            ln = int(rng.uniform(0.035, 0.085) * SR)
            bt = np.arange(ln) / SR
            burst = rng.normal(0, 1, ln).astype(np.float32)
            b = np.fft.rfft(burst)
            fr = np.fft.rfftfreq(ln, 1.0 / SR)
            centre = rng.uniform(320.0, 900.0)               # resonant crack, not a hiss
            b *= 1.0 / (1.0 + ((fr - centre) / 140.0) ** 2)
            burst = np.fft.irfft(b, ln).astype(np.float32)
            env = np.exp(-bt * rng.uniform(45.0, 110.0)) * (1 - np.exp(-bt * 3000.0))
            out[i:i + ln] += 0.55 * burst * env / (np.max(np.abs(burst)) + 1e-9)
            pops += 1
    if cfg['noise'] > 0:
        env = np.abs(out) / (np.max(np.abs(out)) + 1e-9)
        nz = rng.normal(0, 1, n).astype(np.float32)
        b = np.fft.rfft(nz)
        fr = np.fft.rfftfreq(n, 1.0 / SR)
        b *= 1.0 / (1.0 + (fr / cfg['noise_hz']) ** 2)
        nz = np.fft.irfft(b, n).astype(np.float32)
        out += cfg['noise'] * nz * (0.3 + 0.7 * env) * load
    out = out / (float(np.max(np.abs(out))) + 1e-9)
    out = saturate(out, cfg.get('drive', 2.0))
    return (out / (float(np.max(np.abs(out))) + 1e-9) * 0.9).astype(np.float32), rpm


def engine_start(cfg, seed):
    """Starter cranking, catch, a short flare, then settle to idle."""
    dur = 2.6
    crank_end, catch, flare_top = 0.95, 1.15, 1.75

    def rpm_of_t(t):
        r = np.full_like(t, 320.0)                          # starter dragging it over
        r += 60.0 * np.sin(2 * np.pi * 9.0 * t)             # compression pulses
        rising = (t >= crank_end) & (t < flare_top)
        r = np.where(rising, 320.0 + (IDLE * 1.75 - 320.0) *
                     np.clip((t - crank_end) / (flare_top - crank_end), 0, 1), r)
        settle = t >= flare_top
        r = np.where(settle, IDLE + (IDLE * 0.75) * np.exp(-(t - flare_top) * 3.0), r)
        return r

    def load_of_t(t):
        # Almost no combustion energy until it catches, then a stab of throttle.
        l = np.where(t < catch, 0.12, 1.0)
        l = np.where(t > flare_top, 0.45 + 0.25 * np.exp(-(t - flare_top) * 2.5), l)
        return l.astype(np.float32)

    x, _ = render_rpm_curve(cfg, rpm_of_t, dur, seed, load_of_t)
    # Starter motor whine only while cranking.
    rng = np.random.default_rng(seed + 1)
    t = np.arange(len(x)) / SR
    whine = np.sin(2 * np.pi * 1150.0 * t) * 0.16 * (t < crank_end) * (1 - np.exp(-t * 25.0))
    x = x + whine.astype(np.float32)
    return (x / (np.max(np.abs(x)) + 1e-9) * 0.9).astype(np.float32)


def launch_rpm_profile(top_kmh=4.0, zero_to_top=3.0, tail=0.6):
    """Reproduce the app's own launch: speed ramp plus the RPM sawtooth from the gearbox.

    Returns (rpm_of_t, speed_of_t, gear_of_t, duration) so the same profile drives both the
    audio demo and the documentation chart — the picture cannot disagree with the sound.
    """
    dt = 0.002
    steps = int((zero_to_top + tail) / dt)
    v = 0.0
    g = 0
    shift_until = -1.0
    ts, vs, rs, gs = [], [], [], []
    # Tuned so a full-throttle run lands close to zero_to_top; the app solves this
    # numerically, here a fixed factor is enough for a demonstration.
    scale = (top_kmh / zero_to_top) * 3.05
    for i in range(steps):
        t = i * dt
        ratio, topfrac = GEARS[g]
        band_top = topfrac * top_kmh
        rpm_raw = REDLINE * (ratio * (v / top_kmh)) / max(r * f for r, f in GEARS)
        if t < shift_until:
            v -= v * 0.19 * dt
        else:
            rn = np.clip(rpm_raw, IDLE, REDLINE)
            torque = np.interp(rn, [1500, 4500, 6200, 9000], [0.42, 0.72, 1.0, 0.90])
            v += (torque * (ratio / 0.88) * scale - 0.19 * v) * dt
            if rpm_raw >= 8800 and g < len(GEARS) - 1:
                g += 1
                shift_until = t + 0.12
        v = float(np.clip(v, 0.0, top_kmh))
        ts.append(t); vs.append(v); gs.append(g)
        rs.append(float(np.clip(rpm_raw, IDLE, REDLINE)))
    ts, vs, rs, gs = map(np.array, (ts, vs, rs, gs))
    return ts, vs, rs, gs


def accel_demo(cfg, key, seed):
    ts, vs, rs, gs = launch_rpm_profile()
    dur = float(ts[-1])
    rpm_of_t = lambda t: np.interp(t, ts, rs)
    x, _ = render_rpm_curve(cfg, rpm_of_t, dur, seed)
    return x, ts, vs, rs, gs


def drive_cycle(top_kmh=4.0):
    """A complete, realistic drive: start, idle, launch through the box, brake back down.

    The braking half is the part a short clip cannot show. Lifting off drops the revs, and
    each DOWNSHIFT throws them straight back up because a shorter gear spins the engine
    faster at the same road speed. Real GT3 boxes blip the throttle on the way down to
    match those revs, so a blip is written into the load curve at every downshift — that
    short bark is most of what makes a braking zone recognisable.

    Returns per-sample-ready arrays (t, rpm, load, gear, kmh) plus phase markers.
    """
    dt = 0.002
    ts, rpms, loads, gears, kmhs = [], [], [], [], []
    max_prod = max(r * f for r, f in GEARS)

    def rpm_at(v, g):
        return float(np.clip(REDLINE * (GEARS[g][0] * (v / top_kmh)) / max_prod, IDLE, REDLINE))

    t = 0.0
    # --- 1) starter, catch, flare, settle -------------------------------------------
    while t < 2.6:
        if t < 0.95:
            r = 320.0 + 60.0 * np.sin(2 * np.pi * 9.0 * t)
            ld = 0.12
        elif t < 1.75:
            k = (t - 0.95) / 0.8
            r = 320.0 + (IDLE * 1.8 - 320.0) * k
            ld = 1.0
        else:
            r = IDLE + IDLE * 0.8 * np.exp(-(t - 1.75) * 3.2)
            ld = 0.45 + 0.25 * np.exp(-(t - 1.75) * 2.5)
        ts.append(t); rpms.append(float(r)); loads.append(float(ld)); gears.append(0); kmhs.append(0.0)
        t += dt
    # --- 2) idle --------------------------------------------------------------------
    while t < 3.9:
        ts.append(t); rpms.append(IDLE); loads.append(0.16); gears.append(0); kmhs.append(0.0)
        t += dt

    # --- 3) full-throttle launch ----------------------------------------------------
    v, g, shift_until = 0.0, 0, -1.0
    scale = (top_kmh / 3.0) * 3.05
    t_launch_end = None
    while v < top_kmh * 0.995 and t < 12.0:
        ratio = GEARS[g][0]
        r = rpm_at(v, g)
        if t < shift_until:
            v -= v * 0.19 * dt
            ld = 0.0
        else:
            torque = float(np.interp(r, [1500, 4500, 6200, 9000], [0.42, 0.72, 1.0, 0.90]))
            v += (torque * (ratio / 0.88) * scale - 0.19 * v) * dt
            ld = 1.0
            raw = REDLINE * (ratio * (v / top_kmh)) / max_prod
            if raw >= 8800 and g < len(GEARS) - 1:
                g += 1
                shift_until = t + 0.12
        v = float(np.clip(v, 0.0, top_kmh))
        ts.append(t); rpms.append(rpm_at(v, g)); loads.append(ld); gears.append(g); kmhs.append(v)
        t += dt
    t_launch_end = t
    # --- 4) hold flat out -----------------------------------------------------------
    while t < t_launch_end + 1.0:
        ts.append(t); rpms.append(rpm_at(v, g)); loads.append(1.0); gears.append(g); kmhs.append(v)
        t += dt

    # --- 5) braking with downshifts and throttle blips -------------------------------
    blip_until = -1.0
    t_brake_start = t
    while v > 0.02 and t < t_brake_start + 6.0:
        v -= (0.19 * v + 1.5) * dt                       # coast drag plus the brakes
        v = max(0.0, v)
        raw = REDLINE * (GEARS[g][0] * (v / top_kmh)) / max_prod
        if raw <= 4200 and g > 0:
            g -= 1
            blip_until = t + 0.18                        # heel-and-toe rev match
        ld = 0.55 if t < blip_until else 0.0             # blip carries real combustion load
        ts.append(t); rpms.append(rpm_at(v, g)); loads.append(ld); gears.append(g); kmhs.append(v)
        t += dt
    # --- 6) idle again --------------------------------------------------------------
    t_end = t
    while t < t_end + 1.4:
        ts.append(t); rpms.append(IDLE); loads.append(0.16); gears.append(0); kmhs.append(0.0)
        t += dt

    return (np.array(ts), np.array(rpms), np.array(loads), np.array(gears), np.array(kmhs))


def full_demo(cfg, seed):
    ts, rpms, loads, gears, kmhs = drive_cycle()
    dur = float(ts[-1])
    x, _ = render_rpm_curve(cfg, lambda t: np.interp(t, ts, rpms), dur, seed,
                            lambda t: np.interp(t, ts, loads).astype(np.float32))
    return x, ts, rpms, loads, gears, kmhs


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    meta = {}

    sz = to_ogg(brake_squeal(), 'brake_squeal')
    meta['brake'] = {'file': 'brake_squeal.ogg', 'loop': True, 'seconds': 1.4}
    print('brake_squeal      %d KB  (loopbar, ACC-artig tonal)' % (sz // 1024))

    # Das Reifenquietschen. Eigener Eintrag, damit ein voller Lauf es nicht verliert - ein
    # fehlender Eintrag in fx.json heisst, dass der Ton still fehlt (der Lader ist
    # absichtlich duldsam gegenueber fehlenden Dateien).
    sz = to_ogg(tyre_squeal(), 'tyre_squeal')
    meta['tyre'] = {'file': 'tyre_squeal.ogg', 'loop': True, 'seconds': 1.6}
    print('tyre_squeal       %d KB  (loopbar, GT-artig breit)' % (sz // 1024))

    variants = [(78.0, 11.0, 0.30, 0.75), (96.0, 14.0, 0.22, 0.62),
                (64.0, 9.0, 0.40, 0.90), (112.0, 17.0, 0.16, 0.55)]
    meta['crash'] = []
    for i, v in enumerate(variants):
        sz = to_ogg(crash(v, seed=100 + i), 'crash_%d' % i)
        meta['crash'].append({'file': 'crash_%d.ogg' % i, 'seconds': v[3]})
        print('crash_%d           %d KB  Grundton %.0f Hz, Abkling %.0f' % (i, sz // 1024, v[0], v[1]))

    sz = to_ogg(pit_wrench(), 'pit_wrench')
    meta['pit'] = {'file': 'pit_wrench.ogg', 'seconds': 1.1}
    print('pit_wrench        %d KB' % (sz // 1024))

    meta['shift'] = {}
    for up, name, secs in ((True, 'shift_up', 0.20), (False, 'shift_down', 0.26)):
        sz = to_ogg(paddle_shift(up=up, seed=11 if up else 12), name, q='5')
        meta['shift']['up' if up else 'down'] = {'file': name + '.ogg', 'seconds': secs}
        print('%-17s %d KB  %.2fs' % (name, sz // 1024, secs))

    meta['start'] = {}
    meta['accel'] = {}
    for key, cfg in CARS.items():
        sz = to_ogg(engine_start(cfg, seed=seed_for('start', key)), '%s_start' % key)
        meta['start'][key] = {'file': '%s_start.ogg' % key, 'seconds': 2.6}
        print('%-8s start     %d KB' % (key, sz // 1024))
        x, ts, rs, ls, gs, vs = full_demo(cfg, seed=seed_for('demo', key))
        sz = to_ogg(x, '%s_demo' % key, q='5')
        ups = int(np.sum(np.diff(gs) > 0)); downs = int(np.sum(np.diff(gs) < 0))
        meta['accel'][key] = {'file': '%s_demo.ogg' % key, 'seconds': round(float(ts[-1]), 2),
                              'upshifts': ups, 'downshifts': downs}
        print('%-8s demo      %d KB  %.1fs  %d hoch / %d runter  0-%.1f km/h  Drehzahl %d-%d'
              % (key, sz // 1024, ts[-1], ups, downs, vs.max(), rs.min(), rs.max()))

    # The curve data the documentation charts are drawn from, so the picture and the audio
    # come from the same simulation run.
    ts, vs, rs, gs = launch_rpm_profile()
    step = max(1, len(ts) // 240)
    meta['launch_curve'] = {
        't': [round(float(x), 3) for x in ts[::step]],
        'kmh': [round(float(x), 3) for x in vs[::step]],
        'rpm': [int(x) for x in rs[::step]],
        'gear': [int(x) + 1 for x in gs[::step]],
    }
    meta['gears'] = [{'gear': i + 1, 'ratio': r, 'topFrac': f} for i, (r, f) in enumerate(GEARS)]
    # MERGE, do not overwrite. tools/pit_sounds.py contributes pit_fuel and pit_repair to
    # the same file, and writing it from scratch dropped them - the same way engine_synth.py
    # once deleted the Corvette from loops.json. This file has already lost a key that way:
    # the 'shift' entry below was missing from the shipped fx.json even though both .ogg
    # files were present, so every gearchange fell through to a square-wave beep. One line of
    # JSON, weeks of a wrong sound.
    path = os.path.join(OUT, 'fx.json')
    merged = {}
    if os.path.exists(path):
        with open(path) as f:
            merged = json.load(f)
    kept = [k for k in merged if k not in meta]
    merged.update(meta)
    with open(path, 'w') as f:
        json.dump(merged, f, indent=1)
    if kept:
        print('unangetastet uebernommen: ' + ', '.join(kept))
    print('\nwrote %s' % OUT)


if __name__ == '__main__':
    main()
