#!/usr/bin/env python3
r"""Sprachclips fuer das gefuehrte Tutorial (v1.3.15, WIP): freundliche Frauenstimme, Deutsch.

BESTELLT: "Tutorial von Grund auf ueberarbeiten: mit freundlicher Frauenstimme und
Heranfuehrung an Funktionen." Die App (src/51b-tutorial.js) spielt diese Clips je Schritt
und liest aus audio/tutorial.json Datei, Dauer und Wortlaut. Der Wortlaut hier und in
TUT_SPRUCH (51b-tutorial.js) muss gleich sein; der Selbsttest vergleicht beide.

ZWEI TEXTE JE CLIP (Nachbesserung zu 1.3.24): `text` steht auf dem Schirm, `sprech` bekommt
Piper. GEMELDET: "'Tutorial / App' wird deutsch ausgesprochen. Nimm dann lieber deutsche
Begriffe 'Einfuehrung' und 'Aepp'." Die deutsche Kerstin-Stimme liest englische Woerter nach
deutschen Regeln (espeak-ng 'de'); fuer die betroffenen Woerter steht in SPRECH eine
Lautschreibung, geprueft an den espeak-Phonemen und an einer Whisper-Abschrift der Clips:
  Tutorial -> Einfuehrung (auch auf dem Schirm), App -> Aepp, Arcade -> Ahkehd,
  OmegaSim -> Omega-ssimm (stimmloses s), Mustang -> Mass-taeng, Garagenmenue -> Garaschenmenue
  (sonst spricht espeak ein hartes g). Fuer "Gamepad" und "Crew"
  fand sich keine Lautschreibung, die die deutsche Stimme verstaendlich spricht: gesprochen
  wird "Kontroller" und "Mannschaft", der Schirm zeigt weiter Gamepad und Crew.

PIPER LIEST STDIN IN DER KONSOLEN-KODIERUNG. Unter Windows (cp1252) wurden aus UTF-8-Umlauten
Zeichensalat ("geaendert" mit A-Tilde und Waehrungszeichen), und genau so klangen die Clips
bis 1.3.24. Deshalb laeuft Piper mit PYTHONUTF8=1.

Stimme: Piper (piper-tts, im venv), Modell de_DE-kerstin-low von
huggingface.co/rhasspy/piper-voices (Modell MIT, Datensatz "Kerstin" CC0). Weder das Modell
noch Roh-WAVs kommen ins Repository, nur die fertigen Ogg-Clips.

Englisch und Spanisch: es gibt keine englische oder spanische Piper-Frauenstimme ohne neuen
Download. Die App zeigt dort die uebersetzten Texte und spricht sie ueber speechSynthesis
(falls das Geraet eine Stimme hat), sonst nur Text.

Kein Funkfilter: die Stimme soll freundlich und klar klingen. Nur Stille an den Enden
abschneiden, leichtes Hochpassfilter gegen Brummen und eine Lautheitsnormalisierung
(EBU R128, -16 LUFS), damit alle Clips gleich laut sind.

Aufruf:
  python tools/voice_tutorial.py --python <venv\Scripts\python.exe> --modell <de_DE-kerstin-low.onnx>
  python tools/voice_tutorial.py --check
Benoetigt ffmpeg und ffprobe im PATH.
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
MANIFEST = OUT / 'tutorial.json'
STIMME = 'de_DE-kerstin-low'

# Schluessel = Clipname in der App (TUT_SPRUCH in src/51b-tutorial.js). Keine Gedankenstriche.
# Anzeigetext; was Piper sprechen soll, steht in SPRECH (fehlt ein Schluessel: derselbe Text).
TEXTE = {
    'voraussetzung': 'Für die Einführung brauchst du ein verbundenes Auto und ein Gamepad. '
                     'Ich warte, bis beides bereit ist.',
    'willkommen': 'Willkommen bei OmegaSim! In dieser Einführung lernst du die App kennen '
                  'und drehst deine ersten Runden.',
    'gas': 'Drücke die Gas-Taste, um zu beschleunigen.',
    'bremse': 'Drücke jetzt die Bremstaste, um zu bremsen.',
    'links': 'Lenke nach links.',
    'rechts': 'Und jetzt nach rechts.',
    'gut': 'Sehr gut!',
    'prima': 'Prima!',
    'arcade': 'Fahr jetzt ein paar Runden im Arcade-Modus. '
              'Das Auto lenkt direkt ein und bremst kräftig.',
    'pacejka': 'Nun wird ein realistischeres Einlenken simuliert.',
    'beschleunigung': 'Das Auto beschleunigt jetzt langsamer, wie ein echter Rennwagen.',
    'untersteuern': 'Fährst du zu schnell in eine Kurve, schiebt das Auto geradeaus. '
                    'Das ist Untersteuern. Bremse also vor der Kurve.',
    'box_erklaerung': 'Zeit für einen Boxenstopp. Gleich erscheinen Tasten auf dem Schirm. '
                      'Drückst du sie schnell und richtig, ist die Crew schneller.',
    'box': 'Tippe jetzt die Boxenstopp-Taste und halte an.',
    'box_fertig': 'Die Regenreifen sind drauf. Fahr weiter.',
    'motor': 'Der Motorsound wird nun geändert zu Ford Mustang.',
    'garage': 'Im Garagenmenü passt du den Motorsound für jedes Auto einzeln an.',
    'optionen': 'Ansagen, Tastenbelegung, Fahrverhalten und vieles mehr '
                'stellst du im Optionenmenü ein.',
    'abschluss': 'Du hast die Einführung abgeschlossen. Herzlich willkommen bei OmegaSim!',
    # Runde 3 (nach 1.3.30): Rolle, Bahn oder Boden, Licht, Regen, Regenreifen, zweiter Stopp.
    'rolle': 'Dein Auto ist verbunden, hat aber nicht die Rolle Spieler 1. '
             'Stelle sie in der Garage auf Spieler 1.',
    'modus_frage': 'Fährst du auf der Bahn oder auf dem Boden? '
                   'Wähle mit dem Steuerkreuz und bestätige.',
    'modus_bahn': 'Gut, wir fahren auf der Bahn.',
    'modus_boden': 'Gut, wir fahren auf dem Boden, ohne Streckenteile.',
    'licht': 'Schalte das Licht mit der Licht-Taste aus und wieder ein.',
    'arcade_boden': 'Fahr jetzt ein wenig herum, im Arcade-Modus. '
                    'Das Auto lenkt direkt ein und bremst kräftig.',
    'regen': 'Jetzt fängt es an zu regnen. Mit Trockenreifen rutscht das Auto viel mehr.',
    'reifen': 'Wähle für den Boxenstopp Regenreifen. '
              'Drücke dazu die Reifen-Taste, bis Regen angezeigt wird.',
    # Runde 4 (nach 1.3.65): nur ein Stopp (erst Regen), Rueckwaertsgang, Handschaltung.
    'rueckwaerts': 'Jetzt fährst du rückwärts. Halte an, drücke die Runterschalt-Taste '
                   'und gib dann Gas.',
    'vorwaerts': 'Mit der Hochschalt-Taste geht es wieder vorwärts.',
    'schalten': 'Jetzt schaltest du selbst, die Automatik ist aus. '
                'Schalte mit der Hochschalt-Taste einen Gang hoch.',
    'runter': 'Und mit der Runterschalt-Taste wieder einen Gang runter.',
    'automatik': 'Ab jetzt schaltet wieder die Automatik.',
}
# Lautschreibung fuer Piper (nur die Aussprache; der Schirm zeigt TEXTE).
SPRECH = {
    'voraussetzung': 'Für die Einführung brauchst du ein verbundenes Auto und einen Kontroller. '
                     'Ich warte, bis beides bereit ist.',
    'willkommen': 'Willkommen bei Omega-ßimm! In dieser Einführung lernst du die Äpp kennen '
                  'und drehst deine ersten Runden.',
    'arcade': 'Fahr jetzt ein paar Runden im Ahkehd-Modus. '
              'Das Auto lenkt direkt ein und bremst kräftig.',
    'box_erklaerung': 'Zeit für einen Boxenstopp. Gleich erscheinen Tasten auf dem Schirm. '
                      'Drückst du sie schnell und richtig, ist die Mannschaft schneller.',
    'motor': 'Der Motorsound wird nun geändert zu Ford Mass-täng.',
    'garage': 'Im Garaschenmenü passt du den Motorsound für jedes Auto einzeln an.',
    'abschluss': 'Du hast die Einführung abgeschlossen. Herzlich willkommen bei Omega-ßimm!',
    'arcade_boden': 'Fahr jetzt ein wenig herum, im Ahkehd-Modus. '
                    'Das Auto lenkt direkt ein und bremst kräftig.',
}
# Piper length_scale: 1 = Modellvorgabe, kleiner = schneller. Kerstin spricht langsam; 0,9 bleibt
# deutlich und haelt die ganze Einfuehrung kurz (hoechstens vier Minuten mit allen Zeitlimits).
TEMPO = 0.9
SATZPAUSE = 0.15


def sprech(key):
    return SPRECH.get(key, TEXTE[key])


def datei(key):
    return 'tutorial_%s_de.ogg' % key


def dauer_von(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'default=nw=1:nk=1', str(path)],
                       check=True, capture_output=True, text=True)
    return round(float(r.stdout.strip()), 2)


def pruefen():
    fehler = []
    try:
        m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        print('FEHLER: ' + str(exc), file=sys.stderr)
        return 1
    clips = m.get('de', {})
    if set(clips) != set(TEXTE):
        fehler.append('Manifest-Schluessel passen nicht zu TEXTE')
    for key, text in TEXTE.items():
        e = clips.get(key) or {}
        if e.get('text') != text:
            fehler.append('Wortlaut weicht ab: ' + key)
        if e.get('sprech') != sprech(key):
            fehler.append('Sprechtext weicht ab: ' + key)
        if e.get('datei') != datei(key):
            fehler.append('Dateiname weicht ab: ' + key)
        p = OUT / datei(key)
        if not p.is_file() or p.stat().st_size == 0:
            fehler.append('fehlt: ' + p.name)
            continue
        with p.open('rb') as f:
            if f.read(4) != b'OggS':
                fehler.append('kein Ogg: ' + p.name)
        if not (0.3 < float(e.get('dauer') or 0) < 20):
            fehler.append('Dauer unplausibel: ' + key)
    if fehler:
        print('Tutorial-Audiopruefung fehlgeschlagen:', file=sys.stderr)
        for t in fehler:
            print('  ' + t, file=sys.stderr)
        return 1
    gesamt = sum(float(e['dauer']) for e in clips.values())
    print('OK: %d Tutorial-Clips, zusammen %.1f s.' % (len(clips), gesamt))
    return 0


def erzeugen(python, modell, nur):
    for exe in ('ffmpeg', 'ffprobe'):
        if not shutil.which(exe):
            raise FileNotFoundError(exe + ' ist nicht im PATH')
    if not modell.is_file() or not Path(str(modell) + '.json').is_file():
        raise FileNotFoundError('Modell oder Modellkonfiguration fehlt: ' + str(modell))
    try:
        alt = json.loads(MANIFEST.read_text(encoding='utf-8')).get('de', {})
    except (OSError, ValueError):
        alt = {}
    neu = {}
    with tempfile.TemporaryDirectory(prefix='tutorial-') as temp:
        work = Path(temp)
        for key, text in TEXTE.items():
            ziel = OUT / datei(key)
            if (nur and key not in nur and ziel.is_file() and key in alt and alt[key].get('text') == text
                    and alt[key].get('sprech') == sprech(key)):
                neu[key] = alt[key]
                continue
            roh = work / (key + '_raw.wav')
            subprocess.run([str(python), '-m', 'piper', '-m', str(modell), '-f', str(roh),
                            '--length-scale', str(TEMPO), '--sentence-silence', str(SATZPAUSE)],
                           input=sprech(key).encode('utf-8'), check=True,
                           env=dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8'),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            ogg = work / datei(key)
            # Stille vorn und hinten weg (dafuer zweimal umkehren), Hochpass 70 Hz, dann
            # -16 LUFS mit -1,5 dBTP Spitze; 22,05 kHz Mono-Vorbis reicht fuer Sprache.
            filt = ('silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
                    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
                    'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,'
                    'apad=pad_dur=0.12,afade=t=in:d=0.01')
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(roh), '-af', filt,
                            '-ar', '22050', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '4', str(ogg)],
                           check=True)
            shutil.copyfile(str(ogg), str(ziel) + '.tmp')
            os.replace(str(ziel) + '.tmp', ziel)
            neu[key] = {'datei': datei(key), 'dauer': dauer_von(ziel), 'text': text, 'sprech': sprech(key)}
            print('%-16s %5.2f s' % (key, neu[key]['dauer']))
    manifest = {'stimme': STIMME, 'de': neu}
    with MANIFEST.open('w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('Zusammen %.1f s in %d Clips.' % (sum(e['dauer'] for e in neu.values()), len(neu)))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--python', help='Python mit installiertem piper-tts (z. B. venv\\Scripts\\python.exe)')
    ap.add_argument('--modell', help='Pfad zu de_DE-kerstin-low.onnx (daneben die .onnx.json)')
    ap.add_argument('--nur', nargs='*', default=None, help='Nur diese Clips neu erzeugen')
    ap.add_argument('--check', action='store_true', help='Manifest und Clips pruefen')
    args = ap.parse_args()
    if args.check:
        return pruefen()
    if not args.python or not args.modell:
        ap.error('--python und --modell sind zum Erzeugen erforderlich')
    try:
        return erzeugen(Path(args.python), Path(args.modell).expanduser().resolve(), set(args.nur or []))
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        print('FEHLER: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
