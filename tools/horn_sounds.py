#!/usr/bin/env python3
"""Hupen fuer die Lichthupe aus sounds/ schneiden.

Das Rohmaterial in sounds/ bleibt ungetrackt (steht in .gitignore) - nur die geschnittenen
Ableitungen wandern nach audio/. Das ist dieselbe Regel wie bei der Corvette und der
Strecken-Ambience.

Was hier passiert, und warum:

  1. STILLE VORNE UND HINTEN WEG. Eine Hupe soll im selben Moment losgehen, in dem man den
     Knopf drueckt. 200 ms Vorlauf in der Datei fuehlen sich wie eine trraege App an, nicht
     wie eine langsame Datei - der Fehler landet beim falschen Verdaechtigen.
  2. LAENGE BEGRENZT. Die Ziege bruellt sieben Sekunden. Als Rueckmeldung auf einen
     Tastendruck ist das kein Ton mehr, sondern ein Ereignis, das die Bedienung blockiert.
     Gekappt, mit kurzer Ausblende, damit das Kappen nicht klickt.
  3. AUF EINE GEMEINSAME LAUTHEIT GEBRACHT. Nicht auf gleiche Spitze normalisiert, sondern
     auf gleichen RMS: eine Spitzennormalisierung laesst den Furz gegen die Schiffshupe
     verschwinden, weil die Schiffshupe durchgehend laut ist und der Furz nur kurz.

Aufruf:  python tools/horn_sounds.py
"""

import io
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', 'btsr-repo'))
SRC = os.path.join(REPO, 'sounds')
OUT = os.path.join(REPO, 'audio')
WORK = os.path.join(REPO, 'audio-work')

SR = 22050
TARGET_RMS = 0.13          # gemeinsame Lautheit
SILENCE = 0.008            # darunter gilt es als Stille
FADE_S = 0.03

# key, Datei, Anzeigename, Hoechstdauer
HORNS = [
    ('horn_car',  'universfield-car-horn-02-153260.mp3',      'Autohupe',    1.6),
    ('horn_ship', 'universfield-cargo-ship-horn-352063.mp3',  'Schiffshupe', 2.2),
    ('horn_donkey', 'stu9-donkey-1-352697.mp3',               'Esel',        2.2),
    ('horn_goat', 'playdown-suara-goat-berteriak-367222.mp3',  'Ziege',       2.0),
    ('horn_fart', 'apebble-fart-4-228244.mp3',                 'Furz',        1.6),
    # Zweiter Furz, vom Benutzer geliefert. Er ist mit 0,648 s kuerzer als der erste und
    # klingt anders - deshalb ein eigener Eintrag und nicht ein Ersatz: eine Hupe waehlt man
    # nach Geschmack, und zwei Geschmaecker sind besser als einer.
    ('horn_fart2', 'freesound_community-fart-83471.mp3',       'Furz 2',      1.6),
]


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le',
                          '-ac', '1', '-ar', str(SR), '-'],
                         stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, dtype='<f4').astype(np.float64)


def trim(x):
    """Auf das LAUTE EREIGNIS schneiden, nicht auf die erste Nicht-Stille.

    Der erste Versuch schnitt nur echte Stille weg, und das war zu wenig. Gemessen an den
    fuenf Quellen: die Ziege meckert erst bei 3,3 s, davor ist zwei Sekunden leises Umfeld -
    ein Schnitt auf 2 s Hoechstdauer behielt also nur den Vorlauf, das Meckern war komplett
    weg. Beim Esel liegt das Schreien bei 1,9 s, beim Furz bei 0,78 s.

    Also: das Maximum der geglaetteten Huellkurve suchen, von dort zurueck bis die Huellkurve
    unter ein Achtel des Maximums faellt, und ein paar Millisekunden davor anfangen. Das
    trifft den Einsatz des Ereignisses statt irgendeines Vorgeplaenkels.
    """
    k = max(8, int(0.02 * SR))
    env = np.convolve(np.abs(x), np.ones(k) / k, mode='same')
    mx = float(np.max(env))
    if mx < 1e-9:
        return x
    peak = int(np.argmax(env))
    # Rueckwaerts bis unter ein Achtel, aber nicht weiter als 400 ms - sonst laeuft man bei
    # einem langsam anschwellenden Ton bis zum Dateianfang zurueck.
    lookback = int(0.4 * SR)
    i = peak
    while i > 0 and i > peak - lookback and env[i] > mx / 8:
        i -= 1
    start = max(0, i - int(0.02 * SR))
    # Ende: wo es dauerhaft unter ein Zwanzigstel faellt.
    j = len(env) - 1
    while j > peak and env[j] < mx / 20:
        j -= 1
    return x[start:j + 1]


def cap(x, seconds):
    n = int(seconds * SR)
    if len(x) <= n:
        return x
    y = x[:n].copy()
    f = min(int(FADE_S * SR), n // 4)
    y[-f:] *= np.linspace(1.0, 0.0, f)
    return y


def level(x):
    rms = float(np.sqrt(np.mean(x ** 2)))
    if rms < 1e-9:
        return x
    y = x * (TARGET_RMS / rms)
    # Nach der RMS-Anpassung kann die Spitze ueber 1 liegen. Weich begrenzen statt hart
    # kappen: ein hartes Kappen erzeugt genau die Verzerrung, die man bei einer Hupe fuer
    # einen kaputten Lautsprecher haelt.
    peak = float(np.max(np.abs(y)))
    if peak > 0.95:
        y = np.tanh(y / peak * 1.6) / np.tanh(1.6) * 0.95
    return y


def to_ogg(x, name):
    wav = os.path.join(WORK, name + '.wav')
    d = (np.clip(x, -1, 1) * 32767).astype('<i2')
    import wave
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(d.tobytes())
    ogg = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                    '-c:a', 'libvorbis', '-q:a', '4', '-ac', '1', ogg], check=True)
    return os.path.getsize(ogg)


def attack_ms(x):
    """Wie lange bis 90 Prozent der Spitze. Das ist die Zahl, die entscheidet, ob sich der
    Knopfdruck unmittelbar anfuehlt."""
    peak = float(np.max(np.abs(x)))
    for i, v in enumerate(np.abs(x)):
        if v > 0.9 * peak:
            return i / SR * 1000.0
    return 0.0


def main(nur=None):
    """nur: Liste von Hupenschluesseln, sonst alle.

    Mit Auswahl aufzurufen ist der Normalfall, aus demselben Grund wie bei
    engine_synth.py: libvorbis stempelt eine ZUFAELLIGE Bitstrom-Seriennummer in den
    Container, also ist jede neu gerechnete .ogg byteverschieden, auch wenn der Klang
    identisch ist.

    Gemessen beim Hinzufuegen der zweiten Furzhupe: alle fuenf vorhandenen wurden
    mitgerechnet und waren danach byteverschieden, aber bit-identisch dekodiert - maximale
    Abweichung 0,000000 bei gleicher Laenge. Das sind 100 KB Diff ohne eine einzige
    Aenderung am Klang, und ein Diff, der nichts sagt, verdeckt die, die etwas sagen.

    Die Zusammenfuehrung von fx.json unten liest die vorhandenen Eintraege und behaelt sie,
    es faellt also nichts weg, was nicht gerechnet wurde.
    """
    if not os.path.isdir(SRC):
        print('sounds/ fehlt: %s' % SRC)
        return 1
    os.makedirs(WORK, exist_ok=True)
    manifest = {}
    fehlend = [k for k in (nur or []) if k not in [h[0] for h in HORNS]]
    if fehlend:
        print('unbekannte Schluessel: %s' % ', '.join(fehlend))
        return 1
    print('Name        | roh    | geschnitten | Anschlag | RMS   | KB')
    print('-' * 66)
    for key, fn, label, maxs in HORNS:
        if nur is not None and key not in nur:
            continue
        path = os.path.join(SRC, fn)
        if not os.path.exists(path):
            print('%-11s | FEHLT: %s' % (label, fn))
            continue
        x = decode(path)
        raw_s = len(x) / SR
        x = level(cap(trim(x), maxs))
        sz = to_ogg(x, key)
        manifest[key] = {'file': key + '.ogg', 'label': label,
                         'seconds': round(len(x) / SR, 3)}
        print('%-11s | %5.2fs | %6.2fs     | %5.1f ms | %.3f | %d'
              % (label, raw_s, len(x) / SR, attack_ms(x),
                 float(np.sqrt(np.mean(x ** 2))), sz // 1024))

    # fx.json ergaenzen, mischend - nicht ueberschreiben. Genau so ist der shift-Eintrag
    # schon einmal verloren gegangen.
    path = os.path.join(OUT, 'fx.json')
    fx = {}
    if os.path.exists(path):
        with open(path) as f:
            fx = json.load(f)
    # MISCHEND, nicht ersetzend: bei einem Lauf mit Auswahl stehen im manifest nur die
    # gerechneten, und die anderen wuerden sonst aus fx.json verschwinden - die Dateien
    # lagen weiter in audio/, aber die App haette sie nicht mehr gefunden.
    vorhanden = fx.get('horns') or {}
    vorhanden.update(manifest)
    fx['horns'] = vorhanden
    with open(path, 'w') as f:
        json.dump(fx, f, indent=1, ensure_ascii=False)
    print()
    # Beide Zahlen, sonst liest man bei einem Lauf mit Auswahl "1 Eintrag" und denkt, die
    # anderen fuenf seien verlorengegangen.
    print('audio/fx.json: %d neu gerechnet, %d Hupen insgesamt'
          % (len(manifest), len(vorhanden)))
    return 0


if __name__ == '__main__':
    # Ohne Argumente alles, mit Argumenten nur die genannten Schluessel:
    #   python tools/horn_sounds.py horn_fart2
    sys.exit(main(sys.argv[1:] or None))
