#!/usr/bin/env python3
"""Cut track ambience and a Corvette C6 engine from the royalty-free Pixabay sources.

Unlike the three synthesised cars, these two DO use recorded material — the Pixabay licence
allows it, so there is no reason to model what a good recording already gives us.

Ambience is split in two on purpose: one calm bed that loops, plus several short pass-bys
that get sprinkled in at random intervals. A single loop, however long, becomes recognisable
after a few minutes; scattering distinct events over a quiet bed does not.

Usage:  python ambience.py
"""
import io, json, os, subprocess, wave
import numpy as np
from engine_loops import (SR, SOUNDS, WORK, run, read_wav, write_wav, spectrogram,
                          track_f0, refine_f0)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'btsr-repo', 'audio')
OUT = os.path.abspath(OUT)
AMB = 'fjc_media-sounds-of-nuerburgring-engines-of-classic-race-cars-234929.mp3'
VET = 'astonmartinvantagev12-chevrolet-corvette-c6-sound-effect-360531.mp3'
RAIN = 'pwlpl-heavy-thunderstorm-sound-effect-473418.mp3'


def decode(src, dst, sr=SR):
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', str(sr),
         '-f', 'wav', dst])


def to_ogg(x, name, q='3'):
    wav = os.path.join(WORK, 'amb_%s.wav' % name)
    write_wav(wav, x)
    ogg = os.path.join(OUT, '%s.ogg' % name)
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis',
         '-q:a', q, '-ac', '1', ogg])
    return os.path.getsize(ogg)


def crossfade(x, xf_s=0.12):
    """Equal-power wrap so the bed can loop without a click."""
    xf = int(xf_s * SR)
    if len(x) < xf * 3:
        return x
    body, tail = x[:-xf].copy(), x[-xf:]
    f = np.linspace(0, 1, xf, dtype=np.float32)
    body[:xf] = body[:xf] * np.sqrt(f) + tail * np.sqrt(1 - f)
    return body


def seam(x):
    return abs(float(x[0] - x[-1])) / (float(np.sqrt(np.mean(x ** 2))) + 1e-9)


def energy_profile(x, win_s=0.25):
    w = int(win_s * SR)
    m = len(x) // w
    return np.sqrt(np.mean(x[:m * w].reshape(m, w) ** 2, axis=1)), w


def cut_ambience():
    src = os.path.join(SOUNDS, AMB)
    wav = os.path.join(WORK, 'tmp_amb.wav')
    decode(src, wav)
    x = read_wav(wav)
    rms, w = energy_profile(x)
    meta = {}

    # Bed: the window whose energy varies LEAST — no car sweeping past, just the place.
    bed_s, hop = 8.0, 1.0
    bw, bh = int(bed_s / 0.25), int(hop / 0.25)
    best = None
    for i in range(0, len(rms) - bw, bh):
        seg = rms[i:i + bw]
        if np.mean(seg) < 1e-4:
            continue
        score = float(np.std(seg) / (np.mean(seg) + 1e-9))
        if best is None or score < best[0]:
            best = (score, i)
    var, i0 = best
    bed = crossfade(x[i0 * w:i0 * w + int(bed_s * SR)])
    bed = bed / (np.max(np.abs(bed)) + 1e-9) * 0.55
    sz = to_ogg(bed, 'amb_bed')
    meta['bed'] = {'file': 'amb_bed.ogg', 'seconds': round(len(bed) / SR, 2)}
    print('amb_bed        %d KB  %.1fs  Energieschwankung %.3f  Naht %.4f'
          % (sz // 1024, len(bed) / SR, var, seam(bed)))

    # Pass-bys: the opposite — windows with the LARGEST energy swing, which is what a car
    # going past actually is. Kept apart so two picks are not the same event twice.
    pw, ph = int(3.0 / 0.25), int(0.5 / 0.25)
    cands = []
    for i in range(0, len(rms) - pw, ph):
        seg = rms[i:i + pw]
        if np.mean(seg) < 1e-4:
            continue
        cands.append((float(np.std(seg) / (np.mean(seg) + 1e-9)), i))
    cands.sort(reverse=True)
    picked, used = [], []
    for score, i in cands:
        if any(abs(i - u) < pw for u in used):
            continue
        used.append(i)
        picked.append((score, i))
        if len(picked) >= 5:
            break
    meta['passby'] = []
    for k, (score, i) in enumerate(picked):
        seg = x[i * w:i * w + int(3.0 * SR)].copy()
        f = np.linspace(0, 1, int(0.25 * SR), dtype=np.float32)   # fade both ends
        seg[:len(f)] *= f
        seg[-len(f):] *= f[::-1]
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 0.8
        sz = to_ogg(seg, 'amb_pass_%d' % k)
        meta['passby'].append({'file': 'amb_pass_%d.ogg' % k, 'seconds': 3.0})
        print('amb_pass_%d     %d KB  Energieschwankung %.3f  bei %.0fs' % (k, sz // 1024, score, i * 0.25))
    os.remove(wav)
    return meta


def pick_windows(rms, w, win_s, hop_s, count, want_high, min_gap_w):
    """Rank fixed-length windows by relative energy variance.

    Steady rain and a quiet trackside both have LOW variance; a thunder clap and a car
    going past both have HIGH variance. So one scoring function serves both jobs — only the
    sort direction differs.
    """
    ww, hh = int(win_s / 0.25), max(1, int(hop_s / 0.25))
    cands = []
    for i in range(0, len(rms) - ww, hh):
        seg = rms[i:i + ww]
        if np.mean(seg) < 1e-4:
            continue
        cands.append((float(np.std(seg) / (np.mean(seg) + 1e-9)), i))
    cands.sort(reverse=want_high)
    out, used = [], []
    for score, i in cands:
        if any(abs(i - u) < min_gap_w for u in used):
            continue
        used.append(i)
        out.append((score, i))
        if len(out) >= count:
            break
    return out


def cut_rain():
    """Steady rain bed plus the thunder claps, from the same 20s recording."""
    src = os.path.join(SOUNDS, RAIN)
    if not os.path.exists(src):
        print('Regen-Quelle fehlt: %s' % RAIN)
        return {}
    wav = os.path.join(WORK, 'tmp_rain.wav')
    decode(src, wav)
    x = read_wav(wav)
    rms, w = energy_profile(x)
    meta = {}

    bed_s = 6.0
    (var, i0), = pick_windows(rms, w, bed_s, 0.5, 1, False, int(bed_s / 0.25))
    bed = crossfade(x[i0 * w:i0 * w + int(bed_s * SR)])
    bed = bed / (np.max(np.abs(bed)) + 1e-9) * 0.6
    sz = to_ogg(bed, 'rain_bed')
    meta['bed'] = {'file': 'rain_bed.ogg', 'seconds': round(len(bed) / SR, 2)}
    print('rain_bed       %d KB  %.1fs  Energieschwankung %.3f  Naht %.4f'
          % (sz // 1024, len(bed) / SR, var, seam(bed)))

    meta['thunder'] = []
    th_s = 2.5
    for k, (score, i) in enumerate(pick_windows(rms, w, th_s, 0.25, 3, True, int(th_s / 0.25))):
        seg = x[i * w:i * w + int(th_s * SR)].copy()
        f = np.linspace(0, 1, int(0.15 * SR), dtype=np.float32)
        seg[:len(f)] *= f
        seg[-len(f):] *= f[::-1]
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 0.9
        sz = to_ogg(seg, 'thunder_%d' % k)
        meta['thunder'].append({'file': 'thunder_%d.ogg' % k, 'seconds': th_s})
        print('thunder_%d      %d KB  Energieschwankung %.3f  bei %.1fs'
              % (k, sz // 1024, score, i * 0.25))
    os.remove(wav)
    return meta


def cut_corvette():
    src = os.path.join(SOUNDS, VET)
    wav = os.path.join(WORK, 'tmp_vet.wav')
    decode(src, wav)
    x = read_wav(wav)
    freqs, times, mag = spectrogram(x)
    f0 = track_f0(mag, freqs)
    hop = times[1] - times[0]
    wf = max(4, int(2.0 / hop))
    cands = []
    for s in range(0, mag.shape[1] - wf, max(1, int(0.25 / hop))):
        seg = f0[s:s + wf]
        if np.any(seg <= 0):
            continue
        med = refine_f0(float(np.median(seg)), mag, freqs, s, s + wf)
        stab = float(np.std(seg) / med)
        cands.append((med, stab, float(times[s])))
    if not cands:
        print('Corvette: keine brauchbaren Fenster')
        os.remove(wav); return {}
    cands.sort(key=lambda c: c[0])
    # Three bands by measured firing frequency; V8 = 4 firings per crank revolution.
    picks = {}
    for band, frac in (('idle', 0.10), ('mid', 0.50), ('high', 0.92)):
        pool = cands[max(0, int(len(cands) * frac) - 6):int(len(cands) * frac) + 7] or cands
        med, stab, t0 = min(pool, key=lambda c: c[1])     # steadiest in that band
        seg = crossfade(x[int(t0 * SR):int(t0 * SR) + int(2.0 * SR)])
        seg = seg / (np.max(np.abs(seg)) + 1e-9) * 0.85
        sz = to_ogg(seg, 'corvette_%s' % band, q='4')
        rpm = int(round(med * 60.0 / 4.0))
        picks[band] = {'file': 'corvette_%s.ogg' % band, 'baseRpm': rpm,
                       'f0': round(med, 1), 'seconds': round(len(seg) / SR, 3)}
        print('corvette %-5s %d KB  f0 %.0f Hz -> %d 1/min  Naht %.4f'
              % (band, sz // 1024, med, rpm, seam(seg)))
    os.remove(wav)
    return {'label': 'Chevrolet Corvette C6 (V8)', 'cylinders': 8,
            'source': 'Pixabay (lizenzfrei), Ausschnitte', 'loops': picks}


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    amb = cut_ambience()
    amb['rain'] = cut_rain()
    vet = cut_corvette()

    with open(os.path.join(OUT, 'ambience.json'), 'w') as f:
        json.dump(amb, f, indent=1)
    lp = os.path.join(OUT, 'loops.json')
    loops = json.load(open(lp)) if os.path.exists(lp) else {}
    if vet:
        loops['corvette'] = vet
    with open(lp, 'w') as f:
        json.dump(loops, f, indent=1)
    print('\nwrote %s' % OUT)


if __name__ == '__main__':
    main()
