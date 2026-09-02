#!/usr/bin/env python3
"""Drei Motorschleifen aus porschesound/Porsche sounds.m4a schneiden.

Warum ein eigenes Skript und nicht engine_loops.py: das ist eine zweistufige Pipeline mit
einer Handauswahl in der Mitte (analyse -> picks.json -> render). Fuer EINE Quelle mit drei
gesuchten Baendern ist der ganze Umweg mehr Aufwand als der Schnitt selbst.

Die Frequenzmessung ist die Stelle, an der man sich in diesem Projekt schon zweimal
vertan hat, also steht sie hier ausdruecklich: die Zuendfrequenz wird NICHT als lautester
Spektralpeak bestimmt. Bei der Corvette hat genau das eine Oberwelle erwischt und die
deklarierte Basisdrehzahl war um 10 Prozent falsch. Geprueft wird stattdessen, ob bei f0/2
und f0/4 nennenswert Energie liegt - wenn ja, war f0 eine Oberwelle.

Aufruf:  python tools/porsche_rec.py
"""

import io
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, '..'))
SRC = os.path.join(BASE, 'porschesound', 'Porsche sounds.m4a')
OUT = os.path.join(BASE, 'audio')
WORK = os.path.join(BASE, 'audio-work')

SR = 22050
CYL = 6                     # Boxer-6, also Zuendrate = rpm / 20
LOOP_S = 1.9
F0_MIN, F0_MAX = 45.0, 700.0
FFT = 2048
HOP = 512


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le',
                          '-ac', '1', '-ar', str(SR), '-'],
                         stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype='<f4').astype(np.float64)


def stft(x):
    w = np.hanning(FFT)
    n = 1 + (len(x) - FFT) // HOP
    out = np.empty((n, FFT // 2 + 1))
    for i in range(n):
        out[i] = np.abs(np.fft.rfft(x[i * HOP:i * HOP + FFT] * w))
    return out, np.fft.rfftfreq(FFT, 1.0 / SR)


def hps_f0(col, freqs, n_harm=5):
    """Harmonic product spectrum. Robust gegen einen lauten Oberton, weil ein Kandidat nur
    gewinnt, wenn ALLE seine Vielfachen Energie tragen - ein einzelner Peak reicht nicht."""
    lo = int(np.searchsorted(freqs, F0_MIN))
    hi = int(np.searchsorted(freqs, F0_MAX))
    best, best_f = -1.0, 0.0
    for k in range(lo, hi):
        f = freqs[k]
        s = 0.0
        for h in range(1, n_harm + 1):
            j = int(round(k * h))
            if j >= len(col):
                break
            s += np.log(col[j] + 1e-9)
        if s > best:
            best, best_f = s, f
    return best_f


def octave_check(x, f0):
    """Liegt bei f0/2 oder f0/4 nennenswert Energie? Dann war f0 eine Oberwelle."""
    sp = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    fr = np.fft.rfftfreq(len(x), 1.0 / SR)
    tot = sp[1:].sum() + 1e-12

    def share(f):
        m = (fr > f - 4) & (fr < f + 4)
        return float(sp[m].sum() / tot)

    s1, s2, s4 = share(f0), share(f0 / 2), share(f0 / 4)
    # Eine echte Grundfrequenz traegt deutlich mehr als ihre Unterteilungen. Der Faktor 4 ist
    # eine Entscheidung, keine Messung: bei der Corvette lag das Verhaeltnis bei 4000:1, bei
    # einer echten Oberwelle waere es unter 1.
    f = f0
    if s2 > s1 / 4:
        f = f0 / 2
    if s4 > s1 / 4:
        f = f0 / 4
    return f, (s1, s2, s4)


def circular(x):
    """Ende in den Anfang kreuzblenden, damit die Schleife nicht klickt."""
    n = len(x)
    fade = min(int(0.06 * SR), n // 4)
    y = x.copy()
    w = np.linspace(0.0, 1.0, fade)
    y[:fade] = x[:fade] * w + x[n - fade:] * (1 - w)
    return y[:n - fade]


def seam(x):
    return float(abs(x[0] - x[-1]) / (np.mean(np.abs(np.diff(x))) + 1e-9))


def write_wav(path, x):
    d = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(d.tobytes())


def main():
    if not os.path.exists(SRC):
        print('Quelle fehlt: %s' % SRC)
        return 1
    os.makedirs(WORK, exist_ok=True)
    x = decode(SRC)
    print('Quelle %.1f s' % (len(x) / SR))

    mag, freqs = stft(x)
    f0s = np.array([hps_f0(c, freqs) for c in mag])
    rms = np.array([np.sqrt(np.mean(x[i * HOP:i * HOP + FFT] ** 2)) for i in range(len(mag))])

    # Ruhige, gleichmaessige Fenster. Nicht ueber die SPANNE gemessen, sondern ueber den
    # Anteil der Bilder, die zum Median passen: der Grundfrequenzverfolger springt auf diesem
    # Material gelegentlich auf eine Oberwelle, und ein einzelner Aussetzer machte ein sonst
    # ruhiges Fenster nach dem Spannenkriterium unbrauchbar. Von 83 Sekunden blieben so drei
    # Fenster uebrig, alle bei derselben Frequenz - die drei Baender waeren dasselbe Stueck
    # gewesen.
    win = int(LOOP_S * SR / HOP)
    cands = []
    for i in range(0, len(f0s) - win):
        seg = f0s[i:i + win]
        if seg.min() <= 0:
            continue
        med = float(np.median(seg))
        agree = float(np.mean(np.abs(seg - med) < 0.05 * med))
        loud = float(np.median(rms[i:i + win]))
        if agree > 0.72 and loud > 0.02:
            cands.append((1.0 - agree, i, med, loud))
    if not cands:
        print('keine gleichmaessigen Fenster gefunden')
        return 1
    print('%d gleichmaessige Fenster' % len(cands))

    # Drei Baender: das tiefste, das hoechste, und eines dazwischen. Nach Gleichmaessigkeit
    # innerhalb des Bandes gewaehlt, nicht nach Lautstaerke - eine ruhige Aufnahme mit
    # stabiler Drehzahl schleift besser als eine laute mit wandernder.
    fs = sorted(c[2] for c in cands)
    # 10. und 90. Perzentil statt Minimum und Maximum: die Extreme sind meist der eine
    # Ausreisser, den das Agreement-Kriterium noch durchgelassen hat.
    lo_f = fs[int(0.10 * (len(fs) - 1))]
    hi_f = fs[int(0.90 * (len(fs) - 1))]
    targets = [lo_f, (lo_f * hi_f) ** 0.5, hi_f]
    print('Frequenzbereich der Kandidaten: %.1f bis %.1f Hz (Spanne 1:%.2f)'
          % (lo_f, hi_f, hi_f / lo_f))
    names = ['idle', 'mid', 'high']
    manifest = {}
    used = []
    print()
    print('Band | f0 gemessen | Oktavprobe (f0, f0/2, f0/4) | Basisdrehzahl | Naht')
    for name, tgt in zip(names, targets):
        pick = min((c for c in cands if all(abs(c[1] - u) > win for u in used)),
                   key=lambda c: (abs(c[2] - tgt) / tgt, c[0]), default=None)
        if pick is None:
            print('%-5s| kein eigenes Fenster mehr frei' % name)
            continue
        used.append(pick[1])
        i = pick[1]
        seg = x[i * HOP:i * HOP + int(LOOP_S * SR)]
        f0raw = pick[2]
        f0, shares = octave_check(seg, f0raw)
        loop = circular(seg)
        loop = loop / (np.max(np.abs(loop)) + 1e-9) * 0.86
        wav = os.path.join(WORK, 'porsche_rec_%s.wav' % name)
        write_wav(wav, loop)
        ogg = os.path.join(OUT, 'porsche_rec_%s.ogg' % name)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                        '-c:a', 'libvorbis', '-q:a', '4', '-ac', '1', ogg], check=True)
        rpm = int(round(f0 * 60 / (CYL / 2)))
        manifest[name] = {'file': os.path.basename(ogg), 'baseRpm': rpm,
                          'f0': round(f0, 1), 'seconds': round(len(loop) / SR, 4)}
        print('%-5s| %6.1f Hz   | %.3f %.5f %.5f %s | %5d /min   | %.2f'
              % (name, f0, shares[0], shares[1], shares[2],
                 '(korrigiert)' if abs(f0 - f0raw) > 1 else '            ', rpm, seam(loop)))

    # loops.json ergaenzen, mischend
    path = os.path.join(OUT, 'loops.json')
    with open(path) as f:
        m = json.load(f)
    rpms = [v['baseRpm'] for v in manifest.values()]
    # Eine Strassenaufnahme deckt den Drehzahlbereich eines 9000er Rennmotors nicht ab: hier
    # 3230 bis 4522/min, also 1:1.40 gegen die 1500 bis 9000 der App (1:6). Irgendwo muss
    # gestreckt werden.
    #
    # Der Faktor zentriert die Aufnahme GEOMETRISCH auf den Bereich der App, statt sie an
    # einem Ende festzunageln. Ein erster Versuch setzte das obere Band auf Faktor 1.15 bei
    # Redline - das schob alles nach unten, und am unteren Ende lief die Schleife dann am
    # 0.5-Anschlag, eine Oktave zu tief. Geometrisch zentriert klemmt es an beiden Enden
    # etwa gleich stark, was das kleinste erreichbare Uebel ist.
    APP_LO, APP_HI = 1500.0, 9000.0
    app_mid = (APP_LO * APP_HI) ** 0.5
    rec_mid = (min(rpms) * max(rpms)) ** 0.5
    scale = round(app_mid / rec_mid, 3)
    m['porsche_rec'] = {
        'label': 'Porsche (Aufnahme)',
        'cylinders': CYL,
        'source': 'Aufnahme des Nutzers (porschesound/Porsche sounds.m4a), Ausschnitte',
        'rpmScale': scale,
        'rpmScaleGrund': ('Aufnahme deckt %d bis %d/min ab, die App dreht bis 9000. Ohne '
                          'Faktor liefe das obere Band am 2.0-Anschlag.'
                          % (min(rpms), max(rpms))),
        'loops': manifest,
    }
    with open(path, 'w') as f:
        json.dump(m, f, indent=1, ensure_ascii=False)
    print()
    print('loops.json ergaenzt: porsche_rec, rpmScale %.3f' % scale)
    return 0


if __name__ == '__main__':
    sys.exit(main())
