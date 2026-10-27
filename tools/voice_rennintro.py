#!/usr/bin/env python3
r"""94 Rennintro-Clips (inklusive Pflichtboxenstopps, Teilnehmern und Startaufstellung) (DE/EN), passend zur lokalen Erweiterung von v1.1.44.

python tools/voice_rennintro.py --piper C:\tools\piper
python tools/voice_rennintro.py --check

Piper-Struktur wie voice_zahlen.py: <Ordner>/piper/piper.exe und Modelle
<Ordner>/de_DE-thorsten-medium.onnx, <Ordner>/en_US-ljspeech-medium.onnx
(jeweils mit .onnx.json). Benoetigt ffmpeg im PATH und numpy/scipy.
Die vorhandenen Zahl-, Rennstand- und Warnclips bleiben unveraendert.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / 'audio'
WOERTER = {
    "teilnehmer_anfang": ["Wir haben heute", "Today we have"],
    "teilnehmer_ende": ["Teilnehmer am Start.", "competitors on the starting grid."],
    "teilnehmer_einer": ["Wir haben heute einen Teilnehmer am Start.", "Today we have one competitor on the starting grid."],
    "startposition": ["Auf Position", "In position"],
    "startposition_wagen": ["haben wir", "we have"],
    "startfarbe_weiss": ["den weißen", "the white"],
    "startfarbe_schwarz": ["den schwarzen", "the black"],
    "startfarbe_rot": ["den roten", "the red"],
    "startfarbe_blau": ["den blauen", "the blue"],
    "startfarbe_gruen": ["den grünen", "the green"],
    "startfarbe_gelb": ["den gelben", "the yellow"],
    "startfarbe_lila": ["den lilafarbenen", "the purple"],
    "startfarbe_orange": ["den orangenen", "the orange"],
    "startfarbe_mehrfarbig": ["den mehrfarbigen", "the multicoloured"],
    "startfarbe_unbekannt": ["den", "the"],
    "startmodell_auto": ["Wagen.", "car."],
    "startmodell_bmw": ["BMW.", "BMW."],
    "startmodell_porsche911": ["Porsche Neun Elf.", "Porsche nine eleven."],
    "startmodell_fordmustang": ["Ford Mustang.", "Ford Mustang."],
    "startmodell_ferrari": ["Ferrari.", "Ferrari."],
    "startmodell_audi": ["Audi.", "Audi."],
    "startmodell_mclaren": ["McLaren.", "McLaren."],
    "startmodell_mercedes": ["Mercedes.", "Mercedes."],
    "startmodell_redbull": ["Red Bull.", "Red Bull."],
    "startmodell_vwkaefer": ["VW Käfer.", "Volkswagen Beetle."],

    "boxenstopps_keine": ["Es sind keine Pflichtboxenstopps vorgesehen.", "There are no mandatory pit stops."],
    "boxenstopp_einer": ["Ein Boxenstopp ist Pflicht.", "One pit stop is mandatory."],
    "boxenstopps_anzahl": ["Anzahl der Pflichtboxenstopps:", "Number of mandatory pit stops:"],
    "boxenstopps_pflicht": ["Boxenstopps sind Pflicht.", "pit stops are mandatory."],

    "willkommen": [
        "Willkommen am Start.",
        "Welcome to the starting grid."
    ],
    "modus_practice": [
        "Das Training beginnt gleich.",
        "Practice is about to begin."
    ],
    "modus_laps": [
        "Das Rundenrennen beginnt gleich.",
        "The lap race is about to begin."
    ],
    "modus_endurance": [
        "Das Endurance-Rennen beginnt gleich.",
        "The endurance race is about to begin."
    ],
    "modus_qualifying": [
        "Das Qualifying beginnt gleich.",
        "Qualifying is about to begin."
    ],
    "modus_bestzeit": [
        "Der Time Attack beginnt gleich.",
        "Time attack is about to begin."
    ],
    "modus_knockout": [
        "Das Knockout-Rennen beginnt gleich.",
        "The knockout race is about to begin."
    ],
    "modus_derby": [
        "Das Derby beginnt gleich.",
        "The derby is about to begin."
    ],
    "distanz": [
        "Die Renndistanz beträgt",
        "The race distance is"
    ],
    "zeitlimit": [
        "Das Zeitlimit beträgt",
        "The time limit is"
    ],
    "runde": [
        "eine Runde.",
        "one lap."
    ],
    "runden": [
        "Runden.",
        "laps."
    ],
    "minute": [
        "eine Minute.",
        "one minute."
    ],
    "minuten": [
        "Minuten.",
        "minutes."
    ],
    "ohne_limit": [
        "Wir fahren ohne Zeitlimit.",
        "There is no time limit."
    ],
    "wetter_trocken": [
        "Wir starten bei trockener Strecke.",
        "We start on a dry track."
    ],
    "wetter_regen": [
        "Wir starten im Regen.",
        "We start in the rain."
    ],
    "bereit": [
        "Macht euch bereit. Gleich beginnt die Startampel.",
        "Get ready. The starting lights will begin shortly."
    ]
}
MODELL = {'de': 'de_DE-thorsten-medium.onnx', 'en': 'en_US-ljspeech-medium.onnx'}


def manifest():
    return {spr: {key: 'rennintro_%s_%s.ogg' % (key, spr) for key in WOERTER}
            for spr in ('de', 'en')}


def pruefen():
    fehler = []
    path = OUT / 'rennintro.json'
    try:
        if json.loads(path.read_text(encoding='utf-8')) != manifest():
            fehler.append('rennintro.json passt nicht zum Skript')
    except (OSError, ValueError) as exc:
        fehler.append(str(exc))
    for clips in manifest().values():
        for name in clips.values():
            p = OUT / name
            if not p.is_file() or p.stat().st_size == 0:
                fehler.append('fehlt: ' + name)
            else:
                with p.open('rb') as f:
                    if f.read(4) != b'OggS':
                        fehler.append('kein Ogg: ' + name)
    # Das Intro benutzt die vorhandenen ganzen Zahlen, keine zweite Zahlenserie.
    try:
        zahlen = json.loads((OUT / 'zahlen.json').read_text(encoding='utf-8'))
        for spr in ('de', 'en'):
            for n in range(61):
                name = zahlen.get(spr, {}).get(str(n))
                if not name or not (OUT / name).is_file():
                    fehler.append('Zahl fehlt: %s/%s' % (spr, n))
    except (OSError, ValueError) as exc:
        fehler.append(str(exc))
    if fehler:
        print('Rennintro-Audiopruefung fehlgeschlagen:', file=sys.stderr)
        for text in fehler:
            print('  ' + text, file=sys.stderr)
        return 1
    print('OK: %d Rennintro-Clips und vorhandene Zahlen 0-60 (DE/EN).' % (2 * len(WOERTER)))
    return 0


def piper_exe(ordner):
    for p in (ordner / 'piper' / 'piper.exe', ordner / 'piper.exe',
              ordner / 'piper' / 'piper', ordner / 'piper'):
        if p.is_file():
            return p
    raise FileNotFoundError('Piper nicht gefunden unter ' + str(ordner))


def erzeugen(ordner, sprachen, ersetzen):
    exe = piper_exe(ordner)
    if not shutil.which('ffmpeg'):
        raise FileNotFoundError('ffmpeg ist nicht im PATH')
    for spr in sprachen:
        model = ordner / MODELL[spr]
        if not model.is_file() or not Path(str(model) + '.json').is_file():
            raise FileNotFoundError('Modell oder Modellkonfiguration fehlt: ' + str(model))
    # --check braucht weder NumPy/SciPy noch Piper.
    import voice_zahlen as vz
    vs = vz.vs
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rennintro-') as temp:
        work = Path(temp)
        for spr in sprachen:
            neu = 0
            for key, texts in WOERTER.items():
                name = manifest()[spr][key]
                ziel = OUT / name
                if ziel.is_file() and ziel.stat().st_size > 0 and not ersetzen:
                    continue
                roh = work / (key + '_' + spr + '_raw.wav')
                subprocess.run([str(exe), '-m', str(ordner / MODELL[spr]),
                                '--output_file', str(roh), '--length_scale', str(vz.TEMPO[spr]),
                                '--sentence_silence', '0', '-q'],
                               input=texts[0 if spr == 'de' else 1].encode('utf-8'),
                               check=True, stdout=subprocess.DEVNULL)
                x, sr = vs.read_wav_mono(str(roh))
                x = vs.resample_if_needed(x, sr, vz.SR)
                y = vz.funk_ohne_knack(x, vz.SR)
                wav = work / (key + '_' + spr + '.wav')
                vs.write_wav(str(wav), y, vz.SR)
                ogg = work / name
                vs.encode_ogg(str(wav), str(ogg))
                # Erst die fertig codierte Datei ersetzen, nie eine halbe Ogg ausliefern.
                shutil.copyfile(str(ogg), str(ziel) + '.tmp')
                os.replace(str(ziel) + '.tmp', ziel)
                neu += 1
            print('%s: %d Clips erzeugt, %d vorhanden' % (spr, neu, len(WOERTER) - neu))
    (OUT / 'rennintro.json').write_text(json.dumps(manifest(), ensure_ascii=False, indent=2) + '\n',
                                      encoding='utf-8')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--piper', help='Ordner mit Piper und den vorhandenen DE/EN-Modellen')
    ap.add_argument('--sprache', choices=('de', 'en', 'alle'), default='alle')
    ap.add_argument('--force', action='store_true', help='Auch vorhandene Introclips neu erzeugen')
    ap.add_argument('--check', action='store_true', help='Manifest, Introclips und Zahlen pruefen')
    args = ap.parse_args()
    if args.check:
        return pruefen()
    if not args.piper:
        ap.error('--piper ist zum Erzeugen erforderlich')
    try:
        return erzeugen(Path(args.piper).expanduser().resolve(),
                        ('de', 'en') if args.sprache == 'alle' else (args.sprache,), args.force)
    except (OSError, subprocess.CalledProcessError, ImportError, ValueError) as exc:
        print('FEHLER: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
