#!/usr/bin/env python3
"""Generate the two missing pit-stop LOOPS: refuelling and body repair.

Both are loops, not one-shots, because they run for as long as their job does — the
wrench (pit_wrench.ogg, from engine_fx.py) is already used that way. Loops must be built
CIRCULARLY or the seam clicks once a second; the frequency-domain construction used here
is exactly periodic by design, the same trick engine_synth.exhaust_ir and
engine_fx.resonant_noise rely on.

Usage:  python pit_sounds.py
"""

import json
import os
import subprocess
import wave

import numpy as np

from engine_synth import SR, OUT, WORK


def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def to_ogg(x, name, q='4'):
    os.makedirs(WORK, exist_ok=True)
    wav = os.path.join(WORK, 'fx_' + name + '.wav')
    write_wav(wav, x)
    ogg = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                    '-c:a', 'libvorbis', '-q:a', q, '-ac', '1', ogg], check=True)
    return os.path.getsize(ogg)


def band_noise(n, lo, hi, rng, tilt=0.0):
    """Circular band-limited noise. `tilt` in dB/octave shapes it inside the band."""
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    gain = ((freqs >= lo) & (freqs <= hi)).astype(np.float64)
    # Soft edges: a brick wall rings, and the ring is audible on a short loop.
    edge = np.maximum(lo * 0.5, 1.0)
    gain *= 1.0 / (1.0 + ((freqs - lo) / edge) ** 2 * 0.0)  # keep flat inside
    roll = np.clip((freqs - hi) / max(hi * 0.5, 1.0), 0, None)
    gain *= np.exp(-roll * 3.0)
    roll_lo = np.clip((lo - freqs) / edge, 0, None)
    gain *= np.exp(-roll_lo * 3.0)
    if tilt:
        with np.errstate(divide='ignore'):
            oct_from_lo = np.log2(np.maximum(freqs, 1.0) / max(lo, 1.0))
        gain *= 10 ** (tilt * oct_from_lo / 20.0)
    spec = gain * np.exp(1j * rng.uniform(0, 2 * np.pi, len(freqs)))
    spec[0] = 0
    y = np.fft.irfft(spec, n)
    return (y / (np.max(np.abs(y)) + 1e-9)).astype(np.float32)


def refuel(seconds=2.0, seed=21):
    """Pressurised fuel through a hose: broadband rush plus a slow gurgle.

    The rush alone reads as wind or static. What makes it fuel is the low, irregular
    gurgle riding on top — liquid displacing air in the filler neck — and a faint
    resonance from the hose itself.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR

    rush = band_noise(n, 380.0, 5200.0, rng, tilt=-2.5) * 0.55
    # Gurgle: two slow, incommensurate modulations so it never sounds like a tremolo.
    g = (0.5 + 0.5 * np.sin(2 * np.pi * (2.0 / seconds) * t * seconds / seconds * 3.0)) \
        * (0.6 + 0.4 * np.sin(2 * np.pi * 2.0 * t + 1.1))
    gurgle = band_noise(n, 60.0, 240.0, np.random.default_rng(seed + 1)) * 0.42 * g
    # Hose resonance: a narrow band that gives the sound a fixed "place".
    hose = band_noise(n, 700.0, 820.0, np.random.default_rng(seed + 2)) * 0.18

    out = rush + gurgle + hose
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.80).astype(np.float32)


def strike_decay_ms(x, floor=0.30):
    """Decay time of each strike, in ms: how long from the peak down to 1/e of it.

    This measures the CAUSE of the melody problem rather than a proxy for the percept, after
    two attempts at the proxy both measured something else. Spectral flatness reported 0.000
    for the refuelling loop because the geometric mean collapses as soon as any bin is empty,
    i.e. it was measuring bandwidth. Peak-over-median then reported 164 for a signal whose
    strikes had already been shortened to 6 ms, because in a 50 ms window even band-limited
    noise has peaky statistics.

    Decay time is unambiguous and it is the thing that decides the question: pitch needs
    several cycles to be heard, so at 150-240 Hz a strike that is down to 1/e within about
    6 ms (one cycle) cannot carry a note, whatever its spectrum looks like. The first version
    of this sound decayed over 22 ms, which is ten to twenty cycles - a clear note, and
    twelve of them in a repeating 2.4 s loop is a tune.
    """
    env = np.abs(x)
    k = max(4, int(0.0008 * SR))
    env = np.convolve(env, np.ones(k) / k, mode='same')
    peak = float(np.max(env))
    out = []
    i = 0
    n = len(env)
    while i < n:
        if env[i] < floor * peak:
            i += 1
            continue
        # local maximum of this strike
        j = i
        while j + 1 < n and env[j + 1] >= env[j]:
            j += 1
        top = env[j]
        m = j
        while m < n and env[m] > top / np.e:
            m += 1
        out.append((m - j) / SR * 1000.0)
        # skip to the end of this strike
        while i < n and env[i] >= floor * peak:
            i += 1
    return out


def body_repair(seconds=2.4, seed=31):
    """Bodywork being worked on: dead panel thuds over a low rumble.

    The first version sounded like a melody, and the reason was NOT the partials - those
    were already inharmonic (1.0 / 2.37 / 3.91). It was the decay: exp(-t*46) is a 22 ms
    time constant, so every strike rang for ten to twenty cycles and was heard as a definite
    note. Twelve random pitches inside a 2.4 s loop that then repeats forever is a
    twelve-note tune, and no amount of inharmonicity fixes that.

    So the decay drops to ~6 ms, which is a thud rather than a note, the pitch spread
    narrows so no interval can be heard between neighbouring strikes, and there are more
    strikes so none of them stands out. A real body panel behind a wheel arch is stiff,
    damped by sealant and the arch liner, and mounted to something heavy - it does not ring.
    Spectral flatness per strike is printed as the check: a thud is well above 0.1, a bell
    is under 0.05.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    out = np.zeros(n, dtype=np.float32)

    # More strikes, jittered. An even train is what makes the wrench sound mechanical and
    # this must not; but too few strikes and each one becomes an event with a pitch.
    n_taps = int(seconds * 9)
    for i in range(n_taps):
        pos = int(((i + rng.uniform(-0.42, 0.42)) / n_taps) * n) % n
        ln = min(n - pos, int(0.05 * SR))
        if ln <= 8:
            continue
        lt = np.arange(ln) / SR
        # Narrower band than before (230..520 Hz was over an octave, wide enough to hear
        # melody). Rectangular-plate modes, none an integer multiple of another.
        f0 = rng.uniform(150.0, 240.0)
        ring = np.zeros(ln, dtype=np.float32)
        for mult, amp in ((1.0, 1.0), (1.59, 0.7), (2.14, 0.55), (2.65, 0.4), (3.27, 0.28)):
            # ~6 ms decay, and the higher modes die faster still, as they do on real metal.
            dec = 170.0 * (1.0 + 0.5 * (mult - 1.0))
            ring += (amp * np.exp(-lt * dec)
                     * np.sin(2 * np.pi * f0 * mult * lt + rng.uniform(0, 6.28))).astype(np.float32)
        # The strike itself: broadband contact, louder than the ring. This is most of what
        # a damped panel actually produces.
        ring += 0.9 * np.exp(-lt * 260.0) * rng.normal(0, 1, ln).astype(np.float32)
        out[pos:pos + ln] += ring * rng.uniform(0.5, 1.0)

    # Low rumble: the car on its jacks, tools on the floor.
    out += band_noise(n, 45.0, 190.0, np.random.default_rng(seed + 1)) * 0.30
    # Distant workshop air.
    out += band_noise(n, 900.0, 4200.0, np.random.default_rng(seed + 2)) * 0.07
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.72).astype(np.float32)


def seam_jump(x):
    """How big the discontinuity at the loop point is, relative to the signal itself.

    A loop is only usable if this is small; printing it is the check, not the hope.
    """
    inner = np.mean(np.abs(np.diff(x)))
    return float(abs(x[0] - x[-1]) / (inner + 1e-9))


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for name, fn, secs in (('pit_fuel', refuel, 2.0), ('pit_repair', body_repair, 2.4)):
        x = fn(seconds=secs)
        sz = to_ogg(x, name)
        manifest[name] = {'file': name + '.ogg', 'loop': True, 'seconds': secs}
        # Flatness of the loudest strikes, not of the whole loop: the rumble bed would
        # flatten the average and hide exactly what we are looking for.
        # Only for the impact sound. On a continuous sound like refuelling the detector
        # fires on ripple and the number means nothing - printing it anyway next to a
        # meaningful one just invites misreading.
        if name == 'pit_repair':
            dec = strike_decay_ms(x)
            fl_txt = ('%d Schlaege, Abklingzeit Median %.1f ms (max %.1f) - eine Schwingung '
                      'bei 150-240 Hz dauert 4-7 ms, darunter ist keine Tonhoehe hoerbar'
                      % (len(dec), float(np.median(dec)), max(dec))) if dec else 'keine Schlaege'
        else:
            fl_txt = ''
        print('%-12s %4d KB  %.1fs  Nahtsprung %.2f  %s'
              % (name, sz // 1024, secs, seam_jump(x), fl_txt))
    # Written, not printed. This used to print the JSON for hand-copying into fx.json,
    # which is exactly how entries go missing: the shift sounds were absent from the
    # shipped file even though both .ogg were present, so every gearchange beeped instead
    # of clunking. Merging, so nothing else in the file is lost either.
    path = os.path.join(OUT, 'fx.json')
    merged = {}
    if os.path.exists(path):
        with open(path) as f:
            merged = json.load(f)
    merged.update(manifest)
    with open(path, 'w') as f:
        json.dump(merged, f, indent=1)
    print('')
    print('audio/fx.json aktualisiert: ' + ', '.join(manifest))


if __name__ == '__main__':
    main()
