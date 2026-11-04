#!/usr/bin/env python3
r"""Piper-Clips fuer die Zufallsevents (v1.3.88): Verschmutzung, Oelspur, Gelbe Flagge im Sektor,
Truemmer links/rechts, Durchfahrtsstrafe, Tank-Leck - je Sektor 1-10 bzw. ganze Bahn (0) und je
Spieler 1-3 bzw. ohne Spieler (0). Dieselben Stimmen, dieselbe Nachbearbeitung (Funkfilter ohne
Knacken aus voice_zahlen.py) und derselbe Pegel wie die Rennereignis-Clips (voice_rennereignisse.py).
Die bestehenden Clips bleiben unveraendert; eigenes Manifest audio/zufallsevents.json.

Zwei Wege zu Piper, beide ohne Download und ohne Online-TTS:
  py tools/voice_zufallsevents.py --piper C:\tools\piper
      (piper\piper.exe und beide .onnx im Ordner, wie voice_zahlen.py)
  py tools/voice_zufallsevents.py --python <venv\Scripts\python.exe> --modell-ordner <Ordner mit .onnx>
      (Python-Piper, piper-tts; Text ueber stdin als UTF-8)
  py tools/voice_zufallsevents.py --check

Erwartete Modelle: de_DE-thorsten-medium.onnx und en_US-ljspeech-medium.onnx (+ .onnx.json).
ffmpeg im PATH und NumPy erforderlich.

Die Texte sind Wort fuer Wort zevAnsageText() in src/74-zufallsevents.js; ein Selbsttest vergleicht
das Manifest (Schluessel und Texte) mit der App.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import voice_zahlen as vz

ZAHL = {'de': ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'],
        'en': ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']}
# Zwei Saetze in einem Clip ("Gelbe Flagge in Sektor drei. Abbremsen auf achtzig.") brauchen eine
# kleine Pause dazwischen; am Ende schneidet funk_ohne_knack die Stille ab.
SATZPAUSE = 0.2


def text(key, spr):
    """Derselbe Wortlaut wie zevAnsageText() in src/74-zufallsevents.js."""
    de = spr == 'de'
    if key == 'teile_weg':
        return 'Die Trümmerteile sind weggeräumt.' if de else 'The debris has been cleared.'
    if key == 'leck_andere':
        return 'Ein anderes Auto verliert Benzin.' if de else 'Another car is losing fuel.'
    teile = key.split('_')
    seite = None
    if teile[-1] in ('links', 'rechts'):
        seite = teile.pop()
    k = int(teile.pop())
    art = '_'.join(teile)
    z = ZAHL[spr][k]
    if art == 'dreck':
        if k:
            return f'Achtung, die Fahrbahn ist in Sektor {z} verschmutzt.' if de else f'Caution, the track is dirty in sector {z}.'
        return 'Achtung, die Fahrbahn ist verschmutzt.' if de else 'Caution, the track is dirty.'
    if art == 'oel':
        if k:
            return f'Achtung, Öl auf der Fahrbahn in Sektor {z}.' if de else f'Caution, oil on the track in sector {z}.'
        return 'Achtung, Öl auf der Fahrbahn.' if de else 'Caution, oil on the track.'
    if art == 'sauber':
        if k:
            return f'Sektor {z} ist wieder sauber.' if de else f'Sector {z} is clean again.'
        return 'Die Fahrbahn ist wieder sauber.' if de else 'The track is clean again.'
    if art == 'gelb':
        if k:
            return f'Gelbe Flagge in Sektor {z}. Abbremsen auf achtzig.' if de else f'Yellow flag in sector {z}. Slow down to eighty.'
        return 'Gelbe Flagge auf der ganzen Strecke. Abbremsen auf achtzig.' if de else 'Yellow flag on the whole track. Slow down to eighty.'
    if art == 'gruen':
        if k:
            return f'Grüne Flagge, Sektor {z} ist wieder frei.' if de else f'Green flag, sector {z} is clear.'
        return 'Grüne Flagge, die Strecke ist wieder frei.' if de else 'Green flag, the track is clear.'
    if art == 'teile':
        s = ('linke Seite' if seite == 'links' else 'rechte Seite') if de else ('left side' if seite == 'links' else 'right side')
        if k:
            return f'Trümmerteile in Sektor {z}, {s}.' if de else f'Debris in sector {z}, {s}.'
        return f'Trümmerteile auf der Strecke, {s}.' if de else f'Debris on track, {s}.'
    if art == 'strafe':
        if k:
            return f'Durchfahrtsstrafe für Spieler {z}. Bitte in die Box.' if de else f'Drive-through penalty for player {z}. Please come into the pits.'
        return 'Durchfahrtsstrafe. Bitte in die Box.' if de else 'Drive-through penalty. Please come into the pits.'
    if art == 'strafe_ab':
        if k:
            return f'Spieler {z} hat die Durchfahrtsstrafe abgeleistet.' if de else f'Player {z} has served the drive-through penalty.'
        return 'Durchfahrtsstrafe abgeleistet.' if de else 'Drive-through penalty served.'
    if art == 'leck':
        if k:
            return f'Spieler {z}, dein Tank verliert Benzin. Komm in die Box.' if de else f'Player {z}, your tank is losing fuel. Come into the pits.'
        return 'Dein Tank verliert Benzin. Komm in die Box.' if de else 'Your tank is losing fuel. Come into the pits.'
    raise KeyError(key)


def schluessel():
    """Dieselbe Liste und Reihenfolge wie zevAnsageSchluessel() in src/74-zufallsevents.js."""
    out = []
    for k in range(11):
        for a in ('dreck', 'oel', 'sauber', 'gelb', 'gruen'):
            out.append(f'{a}_{k}')
        out += [f'teile_{k}_links', f'teile_{k}_rechts']
    for p in range(4):
        out += [f'strafe_{p}', f'strafe_ab_{p}', f'leck_{p}']
    out += ['teile_weg', 'leck_andere']
    return out


def datei(key, spr):
    return f'zufallsevent_{key}_{spr}.ogg'


def manifest():
    m = {spr: {k: datei(k, spr) for k in schluessel()} for spr in ('de', 'en')}
    m['texte'] = {spr: {k: text(k, spr) for k in schluessel()} for spr in ('de', 'en')}
    return m


def pruefen():
    errors = []
    root = Path(vz.OUT)
    expected = manifest()
    try:
        actual = json.loads((root / 'zufallsevents.json').read_text(encoding='utf-8'))
        if actual != expected:
            errors.append('zufallsevents.json stimmt nicht mit dem Erzeugungsskript ueberein')
    except (OSError, ValueError) as err:
        errors.append(str(err))
    for spr in ('de', 'en'):
        for name in expected[spr].values():
            path = root / name
            if not path.is_file() or path.stat().st_size < 100 or path.read_bytes()[:4] != b'OggS':
                errors.append('Fehlender/ungueltiger OGG-Clip: ' + name)
    if errors:
        print('\n'.join(errors[:20]), file=sys.stderr)
        return 1
    print(f'{len(expected["de"]) + len(expected["en"])} Zufallsevent-Clips vorhanden.')
    return 0


# Python-Piper: das Modell EINMAL je Sprache laden (ein Aufruf von "python -m piper" je Clip braucht
# rund 10 s, fast alles fuer das Laden). Dieselbe Rechnung wie piper/__main__.py: Saetze als Stuecke,
# dazwischen SATZPAUSE Stille, 16 bit.
STAPEL = r"""
import json, sys, wave
from piper import PiperVoice
from piper.config import SynthesisConfig
a = json.loads(sys.stdin.buffer.read().decode('utf-8'))
v = PiperVoice.load(a['modell'])
cfg = SynthesisConfig(length_scale=a['laenge'])
stille = bytes(int(v.config.sample_rate * a['pause']) * 2)
for satz, ziel in a['jobs']:
    with wave.open(ziel, 'wb') as w:
        gesetzt = False
        for i, c in enumerate(v.synthesize(satz, cfg)):
            if not gesetzt:
                w.setframerate(c.sample_rate); w.setsampwidth(c.sample_width); w.setnchannels(c.sample_channels)
                gesetzt = True
            if i > 0:
                w.writeframes(stille)
            w.writeframes(c.audio_int16_bytes)
    print(ziel, flush=True)
"""


def piper_python_stapel(python, ordner, spr, jobs):
    daten = json.dumps({'modell': os.path.join(ordner, vz.MODELL[spr]), 'laenge': vz.TEMPO[spr],
                        'pause': SATZPAUSE, 'jobs': jobs}, ensure_ascii=False)
    subprocess.run([python, '-c', STAPEL], input=daten.encode('utf-8'), check=True,
                   env=dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8'),
                   stdout=subprocess.DEVNULL)


def piper_exe(ordner, spr, satz, ziel):
    exe = os.path.join(ordner, 'piper', 'piper.exe')
    subprocess.run([exe, '-m', os.path.join(ordner, vz.MODELL[spr]), '--output_file', ziel,
                    '--length_scale', str(vz.TEMPO[spr]), '--sentence_silence', str(SATZPAUSE), '-q'],
                   input=satz.encode('utf-8'), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--piper', help='Ordner mit piper/piper.exe und beiden Stimmmodellen')
    ap.add_argument('--python', help='Python mit installiertem piper-tts (z. B. venv\\Scripts\\python.exe)')
    ap.add_argument('--modell-ordner', help='Ordner mit beiden .onnx (+ .onnx.json), zu --python')
    ap.add_argument('--nur', nargs='*', help='nur diese Schluessel neu erzeugen')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        return pruefen()
    if a.python:
        if not a.modell_ordner:
            ap.error('--modell-ordner fehlt')
        ordner = a.modell_ordner
        noetig = []
    elif a.piper:
        ordner = a.piper
        noetig = [Path(ordner) / 'piper' / 'piper.exe']
    else:
        ap.error('--piper oder --python/--modell-ordner fehlt')
    if not shutil.which('ffmpeg'):
        ap.error('ffmpeg fehlt im PATH')
    for path in noetig + [Path(ordner) / f for model in vz.MODELL.values() for f in (model, model + '.json')]:
        if not path.is_file():
            ap.error('Datei fehlt: ' + str(path))
    os.makedirs(vz.OUT, exist_ok=True)
    os.makedirs(vz.WORK, exist_ok=True)
    nur = set(a.nur or [])
    for spr in ('de', 'en'):
        jobs = []
        for key in schluessel():
            ziel = os.path.join(vz.OUT, datei(key, spr))
            if nur and key not in nur and os.path.isfile(ziel):
                continue
            jobs.append((key, text(key, spr), os.path.join(vz.WORK, f'zufallsevent_{key}_{spr}_raw.wav'), ziel))
        print(spr, len(jobs), 'Clips', flush=True)
        if a.python:
            piper_python_stapel(a.python, ordner, spr, [(satz, raw) for _, satz, raw, _ in jobs])
        else:
            for key, satz, raw, _ in jobs:
                piper_exe(ordner, spr, satz, raw)
        for key, satz, raw, ziel in jobs:
            wav = raw.replace('_raw.wav', '_filtered.wav')
            x, sr = vz.vs.read_wav_mono(raw)
            x = vz.vs.resample_if_needed(x, sr, vz.SR)
            y = vz.funk_ohne_knack(x, vz.SR)
            vz.vs.write_wav(wav, y, vz.SR)
            vz.vs.encode_ogg(wav, ziel)
            print(spr, key, ':', satz, flush=True)
    with open(os.path.join(vz.OUT, 'zufallsevents.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest(), f, ensure_ascii=False, indent=2)
        f.write('\n')
    return pruefen()


if __name__ == '__main__':
    sys.exit(main())
