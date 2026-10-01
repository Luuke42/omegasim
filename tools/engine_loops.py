#!/usr/bin/env python3
"""Find seamless steady-RPM engine loops inside long trackside recordings.

Deliberately stdlib + numpy + scipy + ffmpeg only. librosa/soundfile/pydub are NOT
installed in this environment, so the f0 tracking is hand-rolled on a scipy STFT via a
harmonic product spectrum instead of librosa.yin. ffmpeg does all decode/encode.

Stage 1 (this script, `analyse`): score every ~2s window of each source and export the
best candidates per RPM band, plus a local audition page so a human can pick.
Stage 2 (`render`): take the picks and run the tribute-processing chain.

Usage:
    python engine_loops.py analyse
    python engine_loops.py render picks.json
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', 'btsr-repo'))
SOUNDS = os.path.join(REPO, 'sounds')
WORK = os.path.join(REPO, 'audio-work')

SR = 22050          # engine fundamentals sit far below this; 128kbps sources are dead >15k
WIN_S = 2.0         # loop length
HOP_S = 0.5         # how far we slide between candidate windows
FFT = 2048
# Firing frequency, NOT crankshaft rate. A V8 at 9000rpm fires at 9000/60*4 = 600Hz, so
# a 400Hz ceiling silently forced the search onto sub-harmonics and reported a GT3 Mustang
# idling at 646rpm. Headroom here matters more than a tight search band.
F0_MIN, F0_MAX = 50.0, 700.0

# Which source belongs to which car, and how many firing events per crank revolution.
# A 4-stroke fires cylinders/2 times per revolution, so f0 = rpm/60 * cylinders/2.
CARS = {
    'porsche': {'match': 'Porsche', 'cylinders': 6, 'label': 'Porsche 992 GT3'},
    'bmw':     {'match': 'BMW',     'cylinders': 6, 'label': 'BMW M4 GT3 EVO'},
    'mustang': {'match': 'Mustang', 'cylinders': 8, 'label': 'Ford Mustang GT3'},
}


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True)


def decode(mp3_path, wav_path):
    """MP3 -> mono WAV at SR. ffmpeg handles the formats numpy can't."""
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp3_path,
         '-ac', '1', '-ar', str(SR), '-f', 'wav', wav_path])


def read_wav(path):
    with wave.open(path, 'rb') as w:
        n = w.getnframes()
        raw = w.readframes(n)
        width = w.getsampwidth()
    if width != 2:
        raise RuntimeError('expected 16-bit PCM, got %d bytes/sample' % width)
    return np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0


def write_wav(path, x, sr=SR):
    x = np.clip(x, -1.0, 1.0)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767.0).astype('<i2').tobytes())


def spectrogram(x):
    f, t, Z = signal.stft(x, fs=SR, nperseg=FFT, noverlap=FFT // 2, window='hann')
    return f, t, np.abs(Z)


def track_f0(mag, freqs):
    """Harmonic product spectrum per frame.

    Exhaust systems routinely put more energy in a harmonic than in the fundamental, so a
    plain peak-pick locks onto the wrong partial and the RPM estimate comes out a clean
    multiple off. Multiplying decimated copies of the spectrum reinforces whichever
    frequency actually has the harmonic series above it.
    """
    lo = np.searchsorted(freqs, F0_MIN)
    hi = np.searchsorted(freqs, F0_MAX)
    hps = mag[:hi * 4].copy() if mag.shape[0] >= hi * 4 else mag.copy()
    out = np.ones((hi, mag.shape[1]), dtype=np.float32)
    for k in (1, 2, 3, 4):
        dec = hps[::k][:hi]
        if dec.shape[0] < hi:
            dec = np.pad(dec, ((0, hi - dec.shape[0]), (0, 0)))
        out *= (dec + 1e-9)
    idx = np.argmax(out[lo:hi], axis=0) + lo
    return freqs[idx]


def refine_f0(f0, mag, freqs, s, e):
    """Undo octave errors in the harmonic product spectrum.

    HPS reinforces a comb, but the comb of f0/2 also contains every harmonic of f0, so it
    happily locks an octave (or a twelfth) low. Testing the plausible multiples and
    keeping whichever actually carries the harmonic energy fixes it, and doing it once per
    window rather than per frame keeps it cheap.
    """
    if f0 <= 0:
        return f0
    cols = range(s, e, 3)
    best, best_score = f0, -1.0
    for mult in (1.0, 2.0, 3.0):
        cand = f0 * mult
        if cand > F0_MAX:
            break
        score = float(np.mean([harmonicity(mag[:, i], freqs, cand) for i in cols]))
        # Require a clear win before going up an octave, or noise alone would ratchet it.
        if score > best_score * 1.05:
            best, best_score = cand, score
    return best


def harmonicity(mag_col, freqs, f0):
    """Share of energy sitting on the harmonic comb of f0.

    Wind, crowd and tyre roar are broadband; a running engine is not. This is the number
    that separates 'engine' from 'trackside atmosphere'.
    """
    if f0 <= 0:
        return 0.0
    total = float(np.sum(mag_col)) + 1e-9
    got = 0.0
    for n in range(1, 9):
        target = f0 * n
        if target >= freqs[-1]:
            break
        i = int(np.searchsorted(freqs, target))
        lo, hi = max(0, i - 2), min(len(freqs), i + 3)
        got += float(np.max(mag_col[lo:hi]))
    return got / total


def analyse_source(mp3_path, car_key, cylinders):
    wav = os.path.join(WORK, 'tmp_%s.wav' % car_key)
    decode(mp3_path, wav)
    x = read_wav(wav)
    freqs, times, mag = spectrogram(x)
    f0 = track_f0(mag, freqs)

    frame_hop = times[1] - times[0]
    win_frames = max(4, int(WIN_S / frame_hop))
    hop_frames = max(1, int(HOP_S / frame_hop))

    sub60 = np.sum(mag[:np.searchsorted(freqs, 60.0)], axis=0)
    total = np.sum(mag, axis=0) + 1e-9
    wind = sub60 / total

    cands = []
    for s in range(0, mag.shape[1] - win_frames, hop_frames):
        e = s + win_frames
        seg = f0[s:e]
        if np.any(seg <= 0):
            continue
        med = refine_f0(float(np.median(seg)), mag, freqs, s, e)
        stab = float(np.std(seg) / med)                       # 0 = rock steady
        drift = abs(float(np.polyfit(np.arange(len(seg)), seg, 1)[0]) * len(seg) / med)
        harm = float(np.mean([harmonicity(mag[:, i], freqs, f0[i]) for i in range(s, e, 3)]))
        w = float(np.mean(wind[s:e]))
        # Lower is better for stab/drift/wind, higher for harm.
        score = harm * 2.0 - stab * 6.0 - drift * 4.0 - w * 1.5
        cands.append({
            'start_s': round(float(times[s]), 3),
            'f0': round(med, 2),
            'rpm': int(round(med * 60.0 / (cylinders / 2.0))),
            'stability': round(stab, 4),
            'drift': round(drift, 4),
            'harmonicity': round(harm, 4),
            'wind': round(w, 4),
            'score': round(score, 4),
        })
    os.remove(wav)
    return x, cands


def pick_bands(cands):
    """Split candidates into low/mid/high RPM bands by their own f0 distribution."""
    if not cands:
        return {}
    rpms = sorted(c['rpm'] for c in cands)
    lo_edge = rpms[int(len(rpms) * 0.33)]
    hi_edge = rpms[int(len(rpms) * 0.75)]
    bands = {'idle': [], 'mid': [], 'high': []}
    for c in cands:
        band = 'idle' if c['rpm'] <= lo_edge else ('mid' if c['rpm'] <= hi_edge else 'high')
        bands[band].append(c)
    for b in bands:
        bands[b] = sorted(bands[b], key=lambda c: -c['score'])[:5]
    return bands


def cmd_analyse():
    os.makedirs(WORK, exist_ok=True)
    files = [f for f in os.listdir(SOUNDS) if f.lower().endswith('.mp3')]
    report = {}
    for key, meta in CARS.items():
        src = next((f for f in files if meta['match'].lower() in f.lower()
                    and 'assetto' not in f.lower()), None)
        if not src:
            print('  no source for %s' % key)
            continue
        # Prefer the dyno recording for Porsche: constant load, no wind, no Doppler.
        dyno = next((f for f in files if 'dyno' in f.lower()
                     and meta['match'].lower() in f.lower()), None)
        if dyno:
            src = dyno
        print('%-8s <- %s' % (key, src[:70]))
        x, cands = analyse_source(os.path.join(SOUNDS, src), key, meta['cylinders'])
        bands = pick_bands(cands)
        for band, items in bands.items():
            for i, c in enumerate(items):
                a = int(c['start_s'] * SR)
                clip = x[a:a + int(WIN_S * SR)]
                name = '%s_%s_%d.wav' % (key, band, i)
                write_wav(os.path.join(WORK, name), clip)
                c['file'] = name
        report[key] = {'source': src, 'cylinders': meta['cylinders'],
                       'label': meta['label'], 'bands': bands}
        for band, items in bands.items():
            if items:
                print('   %-5s best rpm=%d score=%.2f drift=%.3f harm=%.2f'
                      % (band, items[0]['rpm'], items[0]['score'],
                         items[0]['drift'], items[0]['harmonicity']))
    with open(os.path.join(WORK, 'candidates.json'), 'w') as f:
        json.dump(report, f, indent=1)
    write_audition(report)
    print('\nwrote %s' % os.path.join(WORK, 'audition.html'))


def write_audition(report):
    rows = []
    for key, info in report.items():
        rows.append('<h2>%s <span class="src">%s</span></h2>' % (info['label'], info['source']))
        for band in ('idle', 'mid', 'high'):
            items = info['bands'].get(band, [])
            if not items:
                continue
            rows.append('<h3>%s</h3><table><tr><th>#</th><th>RPM</th><th>Stabilität</th>'
                        '<th>Drift (Doppler)</th><th>Harmonizität</th><th>Wind</th>'
                        '<th>Score</th><th>Anhören</th></tr>' % band)
            for i, c in enumerate(items):
                rows.append(
                    '<tr><td>%d</td><td>%d</td><td>%.3f</td><td>%.3f</td><td>%.2f</td>'
                    '<td>%.2f</td><td><b>%.2f</b></td>'
                    '<td><audio controls src="%s"></audio> <code>%s %s %d</code></td></tr>'
                    % (i, c['rpm'], c['stability'], c['drift'], c['harmonicity'],
                       c['wind'], c['score'], c['file'], key, band, i))
            rows.append('</table>')
    html = """<!doctype html><meta charset="utf-8"><title>Loop-Kandidaten</title>
<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}
table{border-collapse:collapse;width:100%%;margin-bottom:18px}
td,th{border-bottom:1px solid #ddd;padding:5px 8px;font-size:13px;text-align:left}
th{color:#666;font-size:11px;text-transform:uppercase}
h2{margin-top:32px}.src{font-weight:400;font-size:12px;color:#888}
audio{height:30px;vertical-align:middle}code{color:#888;font-size:11px}</style>
<h1>Motor-Loop-Kandidaten</h1>
<p>Niedrige <b>Drift</b> = kein Doppler. Hohe <b>Harmonizität</b> = Motor statt Wind.
Niedriger <b>Wind</b>-Wert = wenig Tiefbassrauschen. Der Score fasst das zusammen, aber
entscheide nach Gehör — sag mir je Fahrzeug und Band die Kennung (z.B. <code>porsche mid 2</code>).</p>
%s""" % '\n'.join(rows)
    with open(os.path.join(WORK, 'audition.html'), 'w', encoding='utf-8') as f:
        f.write(html)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'analyse'
    if cmd == 'analyse':
        cmd_analyse()
    else:
        print('unknown command: %s' % cmd)
        sys.exit(1)
