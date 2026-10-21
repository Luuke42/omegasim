#!/usr/bin/env python3
r"""78 Rennstand-Clips (DE/EN) mit den vorhandenen Piper-Stimmen erzeugen.

python tools/voice_rennstand_erweitert.py --piper C:\tools\piper
python tools/voice_rennstand_erweitert.py --neue --piper C:\tools\piper
python tools/voice_rennstand_erweitert.py --ergebnis --piper C:\tools\piper
python tools/voice_rennstand_erweitert.py --vw-nach --piper C:\tools\piper
python tools/voice_rennstand_erweitert.py --check

Ziel: audio/rennstand_ext_*.ogg. Alte Sprachclips bleiben unveraendert.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import voice_zahlen as vz

WOERTER = {
    "runde": [
        "Nach Runde.",
        "After lap"
    ],
    "fuehrt": [
        "führt aktuell.",
        "is currently leading."
    ],
    "zweiter": [
        "Dahinter mit",
        "Next, with"
    ],
    "dritter": [
        "Auf Platz drei mit",
        "In third place, with"
    ],
    "eine_sekunde": [
        "einer Sekunde Rückstand",
        "one second behind"
    ],
    "sekunden": [
        "Sekunden Rückstand",
        "seconds behind"
    ],
    "eine_runde": [
        "einer Runde Rückstand",
        "one lap behind"
    ],
    "runden": [
        "Runden Rückstand",
        "laps behind"
    ],
    "gleich": [
        "gleichem Wertungsstand",
        "equal race time"
    ],
    "unbekannt": [
        "unbekanntem Rückstand",
        "an unknown gap"
    ],
    "eine_minute": [
        "einer Minute",
        "one minute"
    ],
    "minuten": [
        "Minuten",
        "minutes"
    ],
    "und": [
        "und",
        "and"
    ],
    "rueckstand": [
        "Rückstand",
        "behind"
    ],
    "farbe_weiss": [
        "der weiße",
        "the white"
    ],
    "farbe_schwarz": [
        "der schwarze",
        "the black"
    ],
    "farbe_rot": [
        "der rote",
        "the red"
    ],
    "farbe_blau": [
        "der blaue",
        "the blue"
    ],
    "farbe_gruen": [
        "der grüne",
        "the green"
    ],
    "farbe_gelb": [
        "der gelbe",
        "the yellow"
    ],
    "farbe_lila": [
        "der lilafarbene",
        "the purple"
    ],
    "farbe_orange": [
        "der oransche",
        "the orange"
    ],
    "farbe_unbekannt": [
        "der",
        "the"
    ],
    "modell_auto": [
        "Wagen",
        "car"
    ],
    "modell_bmw": [
        "BeMWe",
        "B M W"
    ],
    "modell_porsche911": [
        "Porsche neun elf",
        "Porsche nine eleven"
    ],
    "modell_fordmustang": [
        "Ford Mustang",
        "Ford Mustang"
    ],
    "modell_ferrari": [
        "Ferrari",
        "Ferrari"
    ],
    "modell_audi": [
        "Audi",
        "Audi"
    ],
    "modell_mclaren": [
        "McLaren",
        "McLaren"
    ],
    "modell_mercedes": [
        "Mercedes",
        "Mercedes"
    ],
    "modell_redbull": [
        "Red Bull",
        "Red Bull"
    ],
    "fuehrt_start": [
        "Es führt aktuell",
        "Currently leading is"
    ],
    "farbe_mehrfarbig": [
        "der mehrfarbige",
        "the multicoloured"
    ],
    "spieler1": [
        "von Spieler eins",
        "driven by player one"
    ],
    "spieler2": [
        "von Spieler zwei",
        "driven by player two"
    ],
    "spieler3": [
        "von Spieler drei",
        "driven by player three"
    ],
    "modell_vwkaefer": ["Volkswagen Käfer", "Volkswagen Beetle"],
    "gewonnen": ["Gewonnen hat", "The winner is"]
}

# Nur diese Dateien gegenueber dem bisherigen 64-Clip-Satz neu erzeugen.
NEUE_CLIPS = {(key, spr) for key in ['fuehrt_start', 'farbe_mehrfarbig', 'spieler1', 'spieler2', 'spieler3'] for spr in ('de', 'en')}
NEUE_CLIPS.add(('farbe_orange', 'de'))
VW_NACH_CLIPS = {(key, spr) for key in ('runde', 'modell_vwkaefer') for spr in ('de', 'en')}
ERGEBNIS_CLIPS = {('gewonnen', spr) for spr in ('de', 'en')}


def manifest():
    return {spr: {key: 'rennstand_ext_%s_%s.ogg' % (key, spr) for key in WOERTER}
            for spr in ('de', 'en')}


def pruefen():
    fehler = []
    for clips in manifest().values():
        for name in clips.values():
            path = os.path.join(vz.OUT, name)
            if not os.path.isfile(path) or os.path.getsize(path) == 0:
                fehler.append(name + ' (fehlt oder leer)')
                continue
            p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'null', '-'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if p.returncode:
                fehler.append(name + ' (nicht decodierbar)')
    if fehler:
        print('\n'.join(fehler), file=sys.stderr)
        return 1
    print('78 Rennstand-Clips vorhanden und decodierbar.')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--piper', help='Ordner mit piper/piper.exe und beiden Modellen')
    ap.add_argument('--check', action='store_true', help='nur alle 76 Clips pruefen')
    ap.add_argument('--neue', action='store_true',
                    help='Sonderfarben/Spieler/Sieger und deutsches Orange erzeugen (13 Clips)')
    ap.add_argument('--ergebnis', action='store_true',
                    help='nur die 2 neuen Sieger-Clips erzeugen')
    ap.add_argument('--bmw', action='store_true', help='nur deutschen BMW-Clip mit BeMWe neu erzeugen')
    ap.add_argument('--vw-nach', action='store_true', help='nur Nach Runde / After lap und VW Käfer / Beetle erzeugen (4 Clips)')
    a = ap.parse_args()
    if sum([a.neue, a.ergebnis, a.bmw, a.vw_nach]) > 1:
        ap.error('--neue, --ergebnis, --bmw und --vw-nach nicht kombinieren')
    if not shutil.which('ffmpeg'):
        ap.error('ffmpeg wurde im PATH nicht gefunden')
    if a.check:
        return pruefen()
    if not a.piper:
        ap.error('--piper ist zum Erzeugen erforderlich')
    exe = os.path.join(a.piper, 'piper', 'piper.exe')
    if not os.path.isfile(exe):
        ap.error('piper.exe fehlt: ' + exe)
    for spr in ('de', 'en'):
        model = os.path.join(a.piper, vz.MODELL[spr])
        for path in (model, model + '.json'):
            if not os.path.isfile(path):
                ap.error('Stimmmodell oder Konfiguration fehlt: ' + path)
    os.makedirs(vz.OUT, exist_ok=True)
    os.makedirs(vz.WORK, exist_ok=True)
    m = manifest()
    for idx, spr in enumerate(('de', 'en')):
        for key, texte in WOERTER.items():
            if a.vw_nach and (key, spr) not in VW_NACH_CLIPS:
                continue
            if a.bmw and (key, spr) != ('modell_bmw', 'de'):
                continue
            if a.ergebnis and (key, spr) not in ERGEBNIS_CLIPS:
                continue
            if a.neue and (key, spr) not in NEUE_CLIPS | ERGEBNIS_CLIPS:
                continue
            stem = 'rennstand_ext_%s_%s' % (key, spr)
            raw = os.path.join(vz.WORK, stem + '_raw.wav')
            wav = os.path.join(vz.WORK, stem + '_filtered.wav')
            print(spr, key, ':', texte[idx], flush=True)
            vz.piper(a.piper, spr, texte[idx], raw)
            x, sr = vz.vs.read_wav_mono(raw)
            x = vz.vs.resample_if_needed(x, sr, vz.SR)
            y = vz.funk_ohne_knack(x, vz.SR)
            vz.vs.write_wav(wav, y, vz.SR)
            vz.vs.encode_ogg(wav, os.path.join(vz.OUT, m[spr][key]))
    path = os.path.join(vz.OUT, 'rennstand-erweitert.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('4 neue/korrigierte VW-/Runden-Clips' if a.vw_nach else '1 korrigierter BMW-Clip' if a.bmw else '2 neue Sieger-Clips' if a.ergebnis else
          ('13 neue/korrigierte Clips' if a.neue else '78 Clips'),
          'direkt in audio/ und Manifest geschrieben.')
    return pruefen()


if __name__ == '__main__':
    sys.exit(main())
