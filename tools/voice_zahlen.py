#!/usr/bin/env python3
"""Rundenzeit-Ansage als Aufnahmen: die Zahlen 0-60 und die Bindewoerter, je Sprache ein
Clip, den die App zur Laufzeit aneinanderreiht ("zwoelf Komma vier").

BESTELLT: "keine Rundenansage - kannst du die ganzen Zahlen von 1 bis 60 und 'Minute'
selbst aufnehmen oder gibt es dafuer nicht einen MIT lizenzierten Katalog fuer Deutsch und
Englisch, den wir hier nehmen koennen?" Grund: die Android-WebView der App hat kein
speechSynthesis, die Rundenzeit blieb dort stumm (siehe speakLap() in src/80-sound.js).

Stimmen (nicht eingecheckt, nur die erzeugten Clips):
  * Piper TTS 2023.11.14-2 (MIT), github.com/rhasspy/piper
  * Deutsch:  de_DE-thorsten-medium - Datensatz Thorsten-Voice, CC0; das Modell ist laut
              Modellkarte von der englischen "lessac"-Stimme feinabgestimmt
  * Englisch: en_US-ljspeech-medium - Datensatz LJ Speech, gemeinfrei, von Grund auf trainiert
  beide von huggingface.co/rhasspy/piper-voices.

Filter: derselbe Bandpass und dieselbe Saettigung wie tools/voice_synth.py, aber OHNE
Knack und Rauschteppich je Clip - die Clips werden aneinandergereiht, und ein Knack
zwischen "zwoelf" und "Komma" klaenge wie ein Aussetzer.

Aufruf:  python voice_zahlen.py --piper <Ordner mit piper\\piper.exe und den .onnx>
"""

import argparse
import json
import os
import subprocess

import numpy as np

import voice_synth as vs

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = vs.OUT
WORK = vs.WORK
SR = vs.SR

MODELL = {'de': 'de_DE-thorsten-medium.onnx', 'en': 'en_US-ljspeech-medium.onnx'}
# Die Woerter ausser den Zahlen. Schluessel = Dateiname und Name in src/80-sound.js
# (lapClipFolge); der Wortlaut folgt lapSpeechText() dort.
WOERTER = {
    'komma': {'de': 'Komma', 'en': 'point'},
    'minute': {'de': 'eine Minute', 'en': 'one minute'},
    'minuten': {'de': 'Minuten', 'en': 'minutes'},
    'bestzeit': {'de': 'Bestzeit!', 'en': 'best lap!'},
}
# Funk spricht schneller: Piper-length_scale < 1 ist schneller (1 = Modellvorgabe).
TEMPO = {'de': 0.85, 'en': 0.85}


def texte(sprache):
    t = {str(n): str(n) for n in range(61)}
    for k, v in WOERTER.items():
        t[k] = v[sprache]
    return t


def piper(ordner, sprache, text, ziel):
    exe = os.path.join(ordner, 'piper', 'piper.exe')
    subprocess.run([exe, '-m', os.path.join(ordner, MODELL[sprache]), '--output_file', ziel,
                    '--length_scale', str(TEMPO[sprache]), '--sentence_silence', '0', '-q'],
                   input=text.encode('utf-8'), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def funk_ohne_knack(x, sr):
    x = vs.trim_silence(x, thresh=0.015, pad_ms=8)
    n = len(x)
    spec = np.fft.rfft(x) * vs.band_shape(n, sr, 320.0, 3000.0)
    y = np.fft.irfft(spec, n).astype(np.float32)
    y = vs.saturate(y, 2.2)
    # 5 ms Ein- und Ausblenden, sonst knackt die Schnittkante selbst.
    k = int(0.005 * sr)
    if n > 2 * k:
        rampe = np.linspace(0, 1, k, dtype=np.float32)
        y[:k] *= rampe
        y[-k:] *= rampe[::-1]
    return (y / (np.max(np.abs(y)) + 1e-9) * 0.85).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--piper', required=True)
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    manifest = {}
    for sprache in ('de', 'en'):
        manifest[sprache] = {}
        for key, text in texte(sprache).items():
            roh = os.path.join(WORK, 'zahl_%s_%s_raw.wav' % (key, sprache))
            piper(a.piper, sprache, text, roh)
            x, sr = vs.read_wav_mono(roh)
            x = vs.resample_if_needed(x, sr, SR)
            y = funk_ohne_knack(x, SR)
            wav = os.path.join(WORK, 'zahl_%s_%s.wav' % (key, sprache))
            vs.write_wav(wav, y, SR)
            name = 'zahl_%s_%s.ogg' % (key, sprache)
            vs.encode_ogg(wav, os.path.join(OUT, name))
            manifest[sprache][key] = name
        print('%s: %d Clips' % (sprache, len(manifest[sprache])))
    with open(os.path.join(OUT, 'zahlen.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    print('audio/zahlen.json geschrieben.')


if __name__ == '__main__':
    main()
