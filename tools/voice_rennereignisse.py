#!/usr/bin/env python3
r"""116 neue Piper-Clips fuer Rennereignisse. Bestehende Clips bleiben unveraendert.

py tools/voice_rennereignisse.py --piper C:\tools\piper
py tools/voice_rennereignisse.py --check

Erwartete Struktur wie tools/voice_zahlen.py:
  C:\tools\piper\piper\piper.exe
  C:\tools\piper\de_DE-thorsten-medium.onnx (+ .onnx.json)
  C:\tools\piper\en_US-ljspeech-medium.onnx (+ .onnx.json)
ffmpeg im PATH und NumPy erforderlich. Keine Downloads, keine Online-TTS.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import voice_zahlen as vz

WOERTER = {
    'damage': ['ist schwer beschädigt.', 'is badly damaged.'],
    'penalty_start': ['Zeitstrafe von', 'Time penalty of'],
    'penalty_one': ['Zeitstrafe von einer Sekunde', 'Time penalty of one second'],
    'seconds': ['Sekunden', 'seconds'],
}
for nr in range(1, 4):
    WOERTER['pit' + str(nr)] = [f'Spieler {nr} ist in der Box.', f'Player {nr} is in the pits.']
    WOERTER['penalty_player' + str(nr)] = [f'für Spieler {nr}.', f'for player {nr}.']
# Basiszahlen 0-60 werden aus zahlen.json wiederverwendet; keine Ziffernfolge fuer 300.
for n in range(61, 100):
    WOERTER['number_' + str(n)] = [str(n), str(n)]
for n in range(1, 10):
    WOERTER['hundred_' + str(n)] = [str(n * 100), str(n * 100)]


def manifest():
    return {spr: {k: f'rennereignis_{k}_{spr}.ogg' for k in WOERTER} for spr in ('de', 'en')}


def pruefen():
    errors = []
    root = Path(vz.OUT)
    expected = manifest()
    try:
        actual = json.loads((root / 'rennereignisse.json').read_text(encoding='utf-8'))
        if actual != expected:
            errors.append('rennereignisse.json stimmt nicht mit dem Erzeugungsskript ueberein')
    except (OSError, ValueError) as err:
        errors.append(str(err))
    for files in expected.values():
        for name in files.values():
            path = root / name
            if not path.is_file() or path.stat().st_size < 100 or path.read_bytes()[:4] != b'OggS':
                errors.append('Fehlender/ungueltiger OGG-Clip: ' + name)
    # Die neue Funktion braucht weiterhin den vorhandenen Zahlen-/Identitaetssatz.
    for name in ('zahlen.json', 'rennstand-erweitert.json'):
        try:
            data = json.loads((root / name).read_text(encoding='utf-8'))
            for spr in ('de', 'en'):
                for clip in data[spr].values():
                    if not (root / clip).is_file():
                        errors.append('Basisclip fehlt: ' + clip)
        except (OSError, KeyError, ValueError) as err:
            errors.append(name + ': ' + str(err))
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'{sum(map(len, expected.values()))} neue OGG-Clips und Basisclips vorhanden.')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--piper', help='Ordner mit piper/piper.exe und beiden Stimmmodellen')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        return pruefen()
    if not a.piper:
        ap.error('--piper fehlt')
    if not shutil.which('ffmpeg'):
        ap.error('ffmpeg fehlt im PATH')
    for path in [Path(a.piper) / 'piper' / 'piper.exe',
                 *(Path(a.piper) / f for model in vz.MODELL.values() for f in (model, model + '.json'))]:
        if not path.is_file():
            ap.error('Datei fehlt: ' + str(path))
    os.makedirs(vz.OUT, exist_ok=True)
    os.makedirs(vz.WORK, exist_ok=True)
    m = manifest()
    for idx, spr in enumerate(('de', 'en')):
        for key, texts in WOERTER.items():
            stem = f'rennereignis_{key}_{spr}'
            raw = os.path.join(vz.WORK, stem + '_raw.wav')
            wav = os.path.join(vz.WORK, stem + '_filtered.wav')
            print(spr, key, ':', texts[idx], flush=True)
            vz.piper(a.piper, spr, texts[idx], raw)
            x, sr = vz.vs.read_wav_mono(raw)
            x = vz.vs.resample_if_needed(x, sr, vz.SR)
            y = vz.funk_ohne_knack(x, vz.SR)
            vz.vs.write_wav(wav, y, vz.SR)
            vz.vs.encode_ogg(wav, os.path.join(vz.OUT, m[spr][key]))
    with open(os.path.join(vz.OUT, 'rennereignisse.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return pruefen()


if __name__ == '__main__':
    sys.exit(main())
