#!/usr/bin/env python3
r"""Piper-Bausteine fuer die Meisterschafts-Ansagen (v1.4.54, WIP): Willkommen, Event-Intro, Sieger je
Rennen, Meister. Feste Satzteile; Zahlen und Autonamen setzt die App aus den vorhandenen Clips zusammen
(zahlen.json, rennstand-erweitert.json, rennereignisse.json). Dieselben Stimmen, dieselbe Nachbearbeitung
(Funkfilter ohne Knacken aus voice_zahlen.py) und derselbe Pegel wie die Rennereignis- und
Zufallsevent-Clips. Eigenes Manifest audio/meisterschaft.json; die bestehenden Clips bleiben unveraendert.

  py tools/voice_meisterschaft.py --python <venv\Scripts\python.exe> --modell-ordner <Ordner mit .onnx>
  py tools/voice_meisterschaft.py --piper C:\tools\piper
  py tools/voice_meisterschaft.py --check

Die Texte stehen ebenso in MEISTER_CLIP_TEXT (src/73-meisterschaft.js); ein Selbsttest vergleicht sie.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import voice_zahlen as vz
import voice_zufallsevents as vze

# Schluessel: (Deutsch, Englisch). Reihenfolge = Manifest.
TEXTE = {
    'willkommen': ('Willkommen zur Meisterschaft.', 'Welcome to the championship.'),
    'events_an': ('Events stehen an.', 'events lie ahead.'),
    'event_einer': ('Ein Event steht an.', 'One event lies ahead.'),
    'event': ('Event', 'Event'),
    'von': ('von', 'of'),
    'format_training': ('Training.', 'Practice.'),
    'format_qualifying': ('Qualifying.', 'Qualifying.'),
    'format_runden': ('Rennen über', 'Race over'),
    'format_endurance': ('Endurance über', 'Endurance over'),
    'umfang_runden': ('Runden.', 'laps.'),
    'umfang_minuten': ('Minuten.', 'minutes.'),
    'umfang_eine_runde': ('eine Runde.', 'one lap.'),
    'umfang_eine_minute': ('eine Minute.', 'one minute.'),
    'wetter_regen': ('Bei Regen.', 'In the rain.'),
    'wetter_wechsel': ('Bei wechselhaftem Wetter.', 'In changeable weather.'),
    'ballast': ('Mit Erfolgsballast.', 'With success ballast.'),
    'sieger_event': ('Sieger von Event', 'Winner of event'),
    'meister_ist': ('Meister ist', 'The champion is'),
    'mit': ('mit', 'with'),
    'punkten': ('Punkten.', 'points.'),
    'einem_punkt': ('einem Punkt.', 'one point.'),
}


def datei(key, spr):
    return f'meister_{key}_{spr}.ogg'


def manifest():
    m = {spr: {k: datei(k, spr) for k in TEXTE} for spr in ('de', 'en')}
    m['texte'] = {spr: {k: TEXTE[k][0 if spr == 'de' else 1] for k in TEXTE} for spr in ('de', 'en')}
    return m


def pruefen():
    errors = []
    root = Path(vz.OUT)
    expected = manifest()
    try:
        actual = json.loads((root / 'meisterschaft.json').read_text(encoding='utf-8'))
        if actual != expected:
            errors.append('meisterschaft.json stimmt nicht mit dem Erzeugungsskript ueberein')
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
    print(f'{len(expected["de"]) + len(expected["en"])} Meisterschafts-Clips vorhanden.')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--piper', help='Ordner mit piper/piper.exe und beiden Stimmmodellen')
    ap.add_argument('--python', help='Python mit installiertem piper-tts (z. B. venv\\Scripts\\python.exe)')
    ap.add_argument('--modell-ordner', help='Ordner mit beiden .onnx (+ .onnx.json), zu --python')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        return pruefen()
    if a.python:
        if not a.modell_ordner:
            ap.error('--modell-ordner fehlt')
        ordner = a.modell_ordner
    elif a.piper:
        ordner = a.piper
    else:
        ap.error('--piper oder --python/--modell-ordner fehlt')
    if not shutil.which('ffmpeg'):
        ap.error('ffmpeg fehlt im PATH')
    for model in vz.MODELL.values():
        for f in (model, model + '.json'):
            if not (Path(ordner) / f).is_file():
                ap.error('Datei fehlt: ' + str(Path(ordner) / f))
    os.makedirs(vz.OUT, exist_ok=True)
    os.makedirs(vz.WORK, exist_ok=True)
    for idx, spr in enumerate(('de', 'en')):
        jobs = [(key, TEXTE[key][idx], os.path.join(vz.WORK, f'meister_{key}_{spr}_raw.wav'),
                 os.path.join(vz.OUT, datei(key, spr))) for key in TEXTE]
        print(spr, len(jobs), 'Clips', flush=True)
        if a.python:
            vze.piper_python_stapel(a.python, ordner, spr, [(satz, raw) for _, satz, raw, _ in jobs])
        else:
            for _, satz, raw, _ in jobs:
                vze.piper_exe(ordner, spr, satz, raw)
        for key, satz, raw, ziel in jobs:
            wav = raw.replace('_raw.wav', '_filtered.wav')
            x, sr = vz.vs.read_wav_mono(raw)
            x = vz.vs.resample_if_needed(x, sr, vz.SR)
            y = vz.funk_ohne_knack(x, vz.SR)
            vz.vs.write_wav(wav, y, vz.SR)
            vz.vs.encode_ogg(wav, ziel)
            print(spr, key, ':', satz, flush=True)
    with open(os.path.join(vz.OUT, 'meisterschaft.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest(), f, ensure_ascii=False, indent=2)
        f.write('\n')
    return pruefen()


if __name__ == '__main__':
    sys.exit(main())
