#!/usr/bin/env python3
"""Stage 2: turn picked candidate clips into published tribute loops.

The point of this chain is that the result must NOT sound like the source recording.
Trackside audio carries three giveaways — a moving pitch (Doppler plus throttle sweep),
the room and crowd around the car, and broadband wind. Each is removed in turn, leaving
only the harmonic firing signature, which is the part that actually distinguishes a
flat-six from a V8. What ships is a derived sound, not an excerpt.

Usage:  python engine_render.py picks.json
"""

import json
import os
import sys

import numpy as np
from scipy import signal

from engine_loops import (SR, F0_MIN, F0_MAX, REPO, WORK, run, read_wav, write_wav,
                          spectrogram, track_f0, refine_f0)

AUDIO_OUT = os.path.join(REPO, 'audio')
XFADE_S = 0.08     # equal-power loop crossfade
HP_HZ = 55.0       # wind rumble lives below this
HARM_KEEP = 0.22   # how much inharmonic material survives the comb


def frame_f0_series(x):
    """Per-frame f0 across a short clip, snapped to one octave."""
    freqs, times, mag = spectrogram(x)
    raw = track_f0(mag, freqs)
    med = refine_f0(float(np.median(raw)), mag, freqs, 0, mag.shape[1])
    fixed = raw.copy()
    for i in range(len(fixed)):
        best, bd = fixed[i], abs(np.log2(max(fixed[i], 1e-6) / med))
        for mult in (0.5, 1.0, 2.0, 3.0):
            cand = raw[i] * mult
            d = abs(np.log2(max(cand, 1e-6) / med))
            if d < bd:
                best, bd = cand, d
        fixed[i] = best
    return times, fixed, med


def depitch(x, times, f0_series, target):
    """Time-varying resample so the pitch stops moving.

    This is the step that removes the "drives past the microphone" character. Playing at
    rate r multiplies pitch by r, so holding pitch constant needs r = target / f0(t).
    """
    n = len(x)
    f0_at = np.interp(np.arange(n) / SR, times, f0_series)
    f0_at = np.clip(f0_at, F0_MIN, F0_MAX)
    pos = np.cumsum(target / f0_at)
    pos = pos[pos < n - 1]
    return np.interp(pos, np.arange(n), x).astype(np.float32)


def clean_and_shape(x, f0):
    """Strip the room, keep the engine — one STFT pass, two jobs.

    Spectral subtraction against a noise floor estimated from the quietest frames removes
    crowd, wind and hiss; a comb mask then keeps the harmonic series of f0 and holds
    everything else down.
    """
    f, t, Z = signal.stft(x, fs=SR, nperseg=1024, noverlap=768, window='hann')
    mag, phase = np.abs(Z), np.angle(Z)
    noise = np.percentile(mag, 10, axis=1, keepdims=True)
    mag = np.maximum(mag - 1.5 * noise, 0.05 * mag)
    mask = np.full(len(f), HARM_KEEP, dtype=np.float32)
    for n in range(1, 40):
        target = f0 * n
        if target >= f[-1]:
            break
        i = int(np.searchsorted(f, target))
        mask[max(0, i - 2):min(len(f), i + 3)] = 1.0
    mag = mag * mask[:, None]
    _, y = signal.istft(mag * np.exp(1j * phase), fs=SR, nperseg=1024,
                        noverlap=768, window='hann')
    return np.real(y).astype(np.float32)


def loop_crossfade(x, xf_s=XFADE_S):
    xf = int(xf_s * SR)
    if len(x) < xf * 3:
        return x
    body, tail = x[:-xf].copy(), x[-xf:]
    fade = np.linspace(0, 1, xf, dtype=np.float32)
    body[:xf] = body[:xf] * np.sqrt(fade) + tail * np.sqrt(1 - fade)
    return body


def seam_jump(x):
    """Step across the loop point relative to level — a click is a number first."""
    rms = float(np.sqrt(np.mean(x ** 2))) + 1e-9
    return abs(float(x[0] - x[-1])) / rms


def sub_bass_share(x):
    f, _, m = spectrogram(x)
    return float(np.sum(m[:np.searchsorted(f, 60.0)]) / (np.sum(m) + 1e-9))


def write_credits(manifest):
    lines = [
        '# Klangquellen', '',
        'Die Motorschleifen in diesem Ordner sind **stark bearbeitete** Ausschnitte aus',
        'den unten genannten Videos, verwendet als Hommage. Sie sind ausdruecklich nicht',
        'repraesentativ fuer die Originalaufnahmen: die Tonhoehe wurde auf einen',
        'konstanten Wert gezogen (Doppler entfernt), Umgebungsgeraeusche wurden spektral',
        'abgezogen, und erhalten blieb nur die harmonische Zuendsignatur. Jede Schleife',
        'ist rund zwei Sekunden lang.', '',
    ]
    for car, info in manifest.items():
        lines.append('- **%s** (%d Zylinder) — Quelle: %s'
                     % (info['label'], info['cylinders'], info['source']))
    lines += ['',
              'Alle Rechte an den Originalaufnahmen verbleiben bei den jeweiligen',
              'Urhebern. Die unbearbeiteten Quelldateien sind nicht Teil dieses Repos.', '']
    with open(os.path.join(AUDIO_OUT, 'CREDITS.md'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))


def main(picks_path):
    with open(picks_path) as fh:
        picks = json.load(fh)
    with open(os.path.join(WORK, 'candidates.json')) as fh:
        report = json.load(fh)
    os.makedirs(AUDIO_OUT, exist_ok=True)
    manifest = {}
    for car, bands in picks.items():
        info = report[car]
        manifest[car] = {'label': info['label'], 'cylinders': info['cylinders'],
                         'source': info['source'], 'loops': {}}
        for band, idx in bands.items():
            cand = info['bands'][band][idx]
            x = read_wav(os.path.join(WORK, cand['file']))

            times, f0s, med = frame_f0_series(x)
            before_std = float(np.std(f0s) / med)
            before_bass = sub_bass_share(x)

            y = depitch(x, times, f0s, med)
            y = clean_and_shape(y, med)
            sos = signal.butter(4, HP_HZ, 'highpass', fs=SR, output='sos')
            y = signal.sosfilt(sos, y).astype(np.float32)
            y = loop_crossfade(y)
            y = y * (0.89 / (float(np.max(np.abs(y))) + 1e-9))

            _, f0s_after, med_after = frame_f0_series(y)
            after_std = float(np.std(f0s_after) / med_after)

            wav_out = os.path.join(WORK, 'final_%s_%s.wav' % (car, band))
            write_wav(wav_out, y)
            ogg_name = '%s_%s.ogg' % (car, band)
            ogg = os.path.join(AUDIO_OUT, ogg_name)
            run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_out,
                 '-c:a', 'libvorbis', '-q:a', '2', '-ac', '1', ogg])

            rpm = int(round(med * 60.0 / (info['cylinders'] / 2.0)))
            manifest[car]['loops'][band] = {
                'file': ogg_name, 'baseRpm': rpm, 'f0': round(med, 2),
                'seconds': round(len(y) / float(SR), 3),
            }
            print('%-8s %-5s rpm=%-5d f0-Streuung %.4f->%.4f  Bass<60Hz %.3f->%.3f'
                  '  Naht %.4f  %d KB'
                  % (car, band, rpm, before_std, after_std, before_bass,
                     sub_bass_share(y), seam_jump(y), os.path.getsize(ogg) // 1024))
    with open(os.path.join(AUDIO_OUT, 'loops.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
    write_credits(manifest)
    print('\nwrote %s' % AUDIO_OUT)


if __name__ == '__main__':
    main(sys.argv[1])
