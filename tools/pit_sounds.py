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


def ratchet_burst(n, start, clicks, rate_hz, rng, level=1.0):
    """Eine Ratsche: kurze Klicks in dichter Folge, kreisrund eingetragen.

    Eine Steckschluessel-Ratsche ist das eindeutigste Werkstattgeraeusch ueberhaupt, und
    sie kann keine Melodie tragen: ihre Klicks sind Transienten von ein bis zwei
    Millisekunden, viel zu kurz fuer eine Tonhoehe. Die Sperrklinke gibt ihr eine
    Faerbung um 3,5 kHz - das ist eine Resonanz und kein Ton, sie klingt in drei
    Schwingungen ab.
    """
    step = SR / float(rate_hz)
    for k in range(clicks):
        pos = int(start + k * step * rng.uniform(0.94, 1.06)) % n
        ln = min(n - pos, int(0.006 * SR))
        if ln <= 4:
            continue
        lt = np.arange(ln) / SR
        # Der Klick selbst: Kontakt, breitbandig, sehr kurz.
        klick = np.exp(-lt * 900.0) * rng.normal(0, 1, ln).astype(np.float32)
        # Die Klinke faerbt ihn. 3 bis 4 Schwingungen, dann ist er weg.
        f = rng.uniform(3200.0, 3900.0)
        klick += (0.55 * np.exp(-lt * 1400.0)
                  * np.sin(2 * np.pi * f * lt + rng.uniform(0, 6.28))).astype(np.float32)
        out_amp = level * rng.uniform(0.7, 1.0)
        # Der erste Klick eines Zugs ist der lauteste - die Hand setzt an.
        if k == 0:
            out_amp *= 1.6
        yield pos, (klick * out_amp).astype(np.float32)


def body_repair(seconds=2.4, seed=31, protokoll=None):
    """Blecharbeit: Klopfen auf EINER Tonhoehe, dazu Ratschenzuege.

    GEMELDET wurde, dass es nach einem Lied klingt - schon die zweite Fassung, denn die
    erste hatte dasselbe Problem und war mit kuerzerem Abklingen behandelt worden. Das
    war die falsche Ursache. Kurzes Abklingen nimmt jedem EINZELNEN Schlag die Tonhoehe,
    aber die Melodie entsteht nicht im Schlag, sondern ZWISCHEN den Schlaegen: zwoelf
    Schlaege mit gewuerfelter Grundfrequenz zwischen 150 und 240 Hz sind zwoelf
    verschiedene Toene, und 150 zu 240 sind acht Halbtoene. Das ist eine Tonleiter, und
    sie wiederholt sich alle 2,4 Sekunden.

    DIE URSACHE IST DAS WUERFELN, und die Wirklichkeit wuerfelt nicht: ein Blechner
    schlaegt auf DASSELBE Blech. Also EINE Grundfrequenz fuer alle Schlaege, mit einer
    Streuung von 1,5 Prozent - ein Halbton sind 5,9 Prozent, ein Viertelton 2,9. Unter
    1,5 Prozent ist kein Intervall mehr hoerbar, und der Rest ist die Unregelmaessigkeit
    der Hand.

    DAZU DIE RATSCHE, weil Klopfen allein duenn ist und weil eine Ratsche das eindeutigste
    Werkstattgeraeusch ist, das es gibt. Sie besteht aus Transienten und kann grundsaetzlich
    keinen Ton tragen.

    Geprueft wird die Streuung der Tonhoehe in Halbtoenen, nicht das Abklingen: das
    Abklingen war die Antwort auf die falsche Frage.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    out = np.zeros(n, dtype=np.float32)

    # EINE Tonhoehe fuer das ganze Blech. Sie wird einmal gezogen und gilt fuer jeden
    # Schlag - genau das ist der Unterschied zur alten Fassung.
    f_panel = 196.0

    def schlag(pos, staerke):
        ln = min(n - pos, int(0.05 * SR))
        if ln <= 8:
            return
        lt = np.arange(ln) / SR
        # Plus/minus 1,5 Prozent: weniger als ein Viertelton, also kein Intervall.
        f0 = f_panel * rng.uniform(0.985, 1.015)
        if protokoll is not None:
            protokoll.append(f0)
        ring = np.zeros(ln, dtype=np.float32)
        for mult, amp in ((1.0, 1.0), (1.59, 0.7), (2.14, 0.55), (2.65, 0.4), (3.27, 0.28)):
            dec = 170.0 * (1.0 + 0.5 * (mult - 1.0))
            ring += (amp * np.exp(-lt * dec)
                     * np.sin(2 * np.pi * f0 * mult * lt + rng.uniform(0, 6.28))).astype(np.float32)
        # Der Kontakt selbst, breitbandig und lauter als das Nachklingen. Ein gedaempftes
        # Blech gibt hauptsaechlich das.
        ring += 0.9 * np.exp(-lt * 260.0) * rng.normal(0, 1, ln).astype(np.float32)
        out[pos:pos + ln] += ring * staerke

    # ---- Der Ablauf ueber die Schleife -------------------------------------------------
    # Klopfen, Ratsche, Klopfen, kurze Ratsche. Ein Wechsel der Taetigkeit ist das, was
    # eine Werkstatt ausmacht; ein gleichfoermiger Teppich klingt nach Maschine.
    takte = [
        ('klopf', 0.00, 0.78, 4),
        ('ratsche', 0.82, 1.36, 11),
        ('klopf', 1.42, 1.98, 3),
        ('ratsche', 2.02, 2.34, 6),
    ]
    for art, t0, t1, zahl in takte:
        if art == 'klopf':
            for i in range(zahl):
                # Ungleichmaessig, aber nicht gewuerfelt weit: eine Hand klopft in einem
                # Takt, den sie nicht genau haelt.
                frac = (i + 0.5) / zahl + rng.uniform(-0.12, 0.12)
                pos = int((t0 + (t1 - t0) * frac) * SR) % n
                schlag(pos, rng.uniform(0.55, 1.0))
        else:
            for pos, sig in ratchet_burst(n, int(t0 * SR), zahl,
                                          rng.uniform(33.0, 42.0), rng, 0.85):
                ln = min(len(sig), n - pos)
                out[pos:pos + ln] += sig[:ln]

    # Tiefes Grummeln: das Auto auf den Boecken, Werkzeug auf dem Boden.
    out += band_noise(n, 45.0, 190.0, np.random.default_rng(seed + 1)) * 0.30
    # Hallenluft in der Ferne.
    out += band_noise(n, 900.0, 4200.0, np.random.default_rng(seed + 2)) * 0.07
    return (out / (np.max(np.abs(out)) + 1e-9) * 0.72).astype(np.float32)


def tonhoehen_streuung(hz):
    """Streuung der erzeugten Grundfrequenzen, in Halbtoenen.

    DAS PROTOKOLL DES ERZEUGERS und keine Spektralschaetzung, und der Grund ist gemessen:
    ein Schlag klingt in rund 6 ms ab, ein Fenster von 40 ms gibt 25-Hz-Koerbe, und bei
    196 Hz sind 25 Hz zweikommazwei Halbtoene. Der Schaetzer kann also gar nicht feiner
    aufloesen als der Effekt, den er messen soll - er lieferte 4,16 Halbtoene Streuung
    fuer Schlaege, die alle auf derselben Frequenz erzeugt wurden.

    Was hier steht, ist deshalb ausdruecklich eine Aussage ueber den BAU und nicht ueber
    das Ergebnis: die Schlaege werden mit einer einzigen Grundfrequenz erzeugt. Dass eine
    einzige Frequenz keine Melodie tragen kann, braucht keine Messung.
    """
    import math
    if len(hz) < 2:
        return 0.0
    halbton = [12 * math.log(f / hz[0], 2) for f in hz]
    mit = sum(halbton) / len(halbton)
    return (sum((h - mit) ** 2 for h in halbton) / (len(halbton) - 1)) ** 0.5


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
            hz = []
            body_repair(seconds=secs, protokoll=hz)
            print('  %d Klopfer, alle auf einer Grundfrequenz, Streuung %.2f Halbtoene '
                  '(ein Viertelton sind 0,5; die alte Fassung wuerfelte ueber acht '
                  'Halbtoene und klang deshalb nach einem Lied)'
                  % (len(hz), tonhoehen_streuung(hz)))
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
