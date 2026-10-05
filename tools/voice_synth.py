#!/usr/bin/env python3
"""Generate the five fixed-phrase radio announcements (damage/fuel/tyre/rain) from a
Windows TTS voice, then band-limit them so they sound like they came over a radio.

BESTELLT: "Kannst du die englischen und deutschen Ansagen zu Regen usw. aufnehmen und
dann einen Funk-Filter draufsetzen, sodass es auch klappt, wenn ein Browser es nicht
unterstuetzt? Rundenzeiten geht natuerlich nicht, das kann computergeneriert bleiben."

Nobody's voice is recorded here - "aufnehmen" is answered with Windows' own two desktop
voices (Microsoft Hedda for German, Microsoft Zira for English; see GetInstalledVoices()
in PowerShell). That is also why the earlier, browser-side radio filter in 80-sound.js
was removed (see the comment above ansage()): SpeechSynthesisUtterance gives the page no
audio node to filter, so nothing could touch the LIVE voice. A voice PRE-RENDERED to a
file has no such problem - it goes through the exact same decodeAudioData()/AudioBuffer
path the engine and effect sounds already use (see loadFxSamples() in 80-sound.js).

Only these five fixed phrases exist as recordings, in both languages - lap times stay
live speechSynthesis, because they carry a number that changes every lap and a fixed
recording cannot say it. See ansagenPruefen() in 80-sound.js for the exact German/English
wording; it is duplicated here on purpose, not imported, because these are two different
runtimes (build-time Python, browser-time JS) and the source of truth for what the BROWSER
actually says is 80-sound.js - this script only has to match it, and the self-test
'Ansagen: die Aufnahmen sagen woertlich dasselbe wie die Live-Stimme' checks that it did.

Pipeline per phrase: PowerShell/System.Speech renders 22050 Hz mono PCM straight to a
.wav (tts_render.ps1, called once for all ten phrases) -> band-limit + a touch of
saturation and a keyup/keydown click in this script (numpy, no scipy needed) -> ffmpeg
encodes the result to the .ogg the app actually loads.

Usage:  python voice_synth.py
"""

import json
import os
import subprocess
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
OUT = os.path.join(REPO, 'audio')
WORK = os.path.join(REPO, 'audio-work')
SR = 22050

# Wortlaut aus ansagenPruefen()/lapSpeechText() in src/80-sound.js, Zeilen 509/519/529/545 -
# fuenf Meldungen, aber 'rain' hat zwei Texte (an/aus), macht zehn Aufnahmen.
PHRASES = {
    'damage': {'de': 'Achtung, Schaden kritisch', 'en': 'Warning, damage critical'},
    'fuel': {'de': 'Tank fast leer', 'en': 'Fuel almost empty'},
    'tyre': {'de': 'Reifen abgefahren', 'en': 'Tyres worn out'},
    'rainstart': {'de': 'Es regnet', 'en': 'Rain has started'},
    'rainstop': {'de': 'Der Regen hört auf', 'en': 'The rain is stopping'},
}

# Dieselben zwei Stimmen, die GetInstalledVoices() auf diesem Rechner meldet. Ein anderer
# Rechner mit anderen Stimmen braucht hier andere Namen - deshalb stehen sie hier und
# nicht versteckt im .ps1.
VOICE_NAME = {'de': 'Microsoft Hedda Desktop', 'en': 'Microsoft Zira Desktop'}
# System.Speech.Rate ist -10..10, kein Faktor wie das Web-Speech-u.rate=1.15 der Live-
# Stimme. 2 liegt spuerbar, aber nicht overtrieben ueber der Vorgabe - Funk klingt
# schneller, nicht ueberdreht.
TTS_RATE = 2


def render_tts():
    """Ruft PowerShell einmal fuer alle zehn Phrasen auf, statt zehnmal den Prozess zu
    starten - jeder powershell.exe-Start kostet spuerbar, das summiert sich."""
    os.makedirs(WORK, exist_ok=True)
    jobs = []
    for key, texts in PHRASES.items():
        for lang, text in texts.items():
            jobs.append({
                'text': text,
                'voice': VOICE_NAME[lang],
                'rate': TTS_RATE,
                'out': os.path.join(WORK, 'voice_%s_%s_raw.wav' % (key, lang)),
            })
    jobs_path = os.path.join(WORK, 'voice_jobs.json')
    with open(jobs_path, 'w', encoding='utf-8') as f:
        json.dump(jobs, f)
    ps1 = os.path.join(HERE, 'tts_render.ps1')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                     '-File', ps1, '-JobsFile', jobs_path], check=True)
    return jobs


def read_wav_mono(path):
    """Liest 16-bit-PCM zurueck in ein float32-Array in -1..1 - dieselbe Skalierung wie
    write_wav() in engine_synth.py, nur umgekehrt."""
    with wave.open(path, 'rb') as w:
        assert w.getsampwidth() == 2, 'erwartet 16-bit PCM, bekam %d Byte' % w.getsampwidth()
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    if w.getnchannels() == 2:
        x = x.reshape(-1, 2).mean(axis=1)
    return x, sr


def resample_if_needed(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    # Lineare Interpolation reicht fuer Sprache auf dem Weg zu einem Bandpass, der ohnehin
    # bei 3 kHz abschneidet - ein teurerer Resampler wuerde hier nichts hoerbar retten.
    n_out = int(round(len(x) * sr_out / sr_in))
    t_in = np.linspace(0, 1, len(x), endpoint=False)
    t_out = np.linspace(0, 1, n_out, endpoint=False)
    return np.interp(t_out, t_in, x).astype(np.float32)


def trim_silence(x, thresh=0.02, pad_ms=15):
    """System.Speech haengt an beide Enden stille Pufferrahmen an. Ohne sie zu kappen,
    sitzt der Funk-Klick weit vor der Stimme statt direkt davor."""
    above = np.where(np.abs(x) > thresh)[0]
    if len(above) == 0:
        return x
    pad = int(pad_ms * 0.001 * SR)
    a = max(0, above[0] - pad)
    b = min(len(x), above[-1] + pad)
    return x[a:b]


def saturate(x, drive):
    """Weiches Kappen - dieselbe tanh-Formel wie saturate() in engine_synth.py.
    Ein Funkgeraet uebersteuert leicht, eine unangetastete Sprachwelle klingt zu sauber."""
    if drive <= 0:
        return x
    return (np.tanh(x * drive) / np.tanh(drive)).astype(np.float32)


def band_shape(n, sr, lo_hz, hi_hz):
    """Dieselbe Form wie circular_noise() in engine_synth.py (1 / (1 + (f/fc)^2)),
    einmal als Hochpass, einmal als Tiefpass multipliziert - ein weicher Bandpass ohne
    das Klingeln einer Brickwall-Filterung."""
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    hp = (freqs / lo_hz) ** 2 / (1.0 + (freqs / lo_hz) ** 2)
    lp = 1.0 / (1.0 + (freqs / hi_hz) ** 2)
    return hp * lp


def band_noise(n, sr, lo_hz, hi_hz, level, rng):
    """Ein duenner Rauschteppich im selben Band wie die Stimme - kein Sender ist ganz
    still, und Stille zwischen zwei Ansagen liest sich sonst wie ein Aussetzer."""
    spec = np.fft.rfft(rng.uniform(-1, 1, n).astype(np.float32))
    spec *= band_shape(n, sr, lo_hz, hi_hz)
    y = np.fft.irfft(spec, n)
    return (y / (np.max(np.abs(y)) + 1e-9) * level).astype(np.float32)


def click(n_samples, sr, hz, rng):
    """Ein kurzer, unharmonischer Knack - dieselbe Idee wie metal_tick() in
    engine_synth.py, nur kuerzer und heller: das Aufschalten/Loslassen einer Sprechtaste,
    nicht ein Ventil."""
    t = np.arange(n_samples) / sr
    y = np.zeros(n_samples, dtype=np.float32)
    for mult, amp in ((1.0, 1.0), (2.7, 0.5), (4.1, 0.3)):
        y += (amp * np.exp(-t * 2200.0)
              * np.sin(2 * np.pi * hz * mult * t + rng.uniform(0, 2 * np.pi))).astype(np.float32)
    return y / (np.max(np.abs(y)) + 1e-9)


def radio_filter(x, sr, seed):
    """Alles zusammen: Bandpass, ein wenig Saettigung, ein duenner Rauschteppich, und ein
    Knack vor dem ersten und nach dem letzten Wort - siehe die vier Helfer oben.

    GEMESSEN gegen die alte, inzwischen entfernte Browser-Fassung (Kommentar ueber
    ansage() in 80-sound.js): die konnte "Knacken beim Auf-/Abschalten, einen
    Rauschteppich darunter, eine schnellere, flachere Stimme" - alles ausser der
    Bandbegrenzung der Stimme selbst, weil SpeechSynthesisUtterance keinen Audioknoten
    hergibt. Eine vorab gerenderte Datei hat dieses Problem nicht: sie ist ein normaler
    AudioBuffer wie jeder Motor- oder Effektton, und der Bandpass hier wirkt direkt auf
    die Stimme.
    """
    rng = np.random.default_rng(seed)
    x = trim_silence(x)
    lo_hz, hi_hz = 320.0, 3000.0
    # Klick-Laenge und -Abstand: kurz genug, um wie ein Tastendruck zu klingen, nicht wie
    # ein zweites Wort.
    click_n = int(0.012 * sr)
    gap_n = int(0.03 * sr)
    pre = click(click_n, sr, 1800.0, rng)
    post = click(click_n, sr, 1500.0, rng)
    body = np.concatenate([np.zeros(gap_n, dtype=np.float32), x,
                            np.zeros(gap_n, dtype=np.float32)])
    n = len(body)
    spec = np.fft.rfft(body) * band_shape(n, sr, lo_hz, hi_hz)
    y = np.fft.irfft(spec, n).astype(np.float32)
    y = saturate(y, 2.2)
    y = y + band_noise(n, sr, lo_hz, hi_hz, 0.02, rng)
    # Klicks NACH dem Filtern aufgelegt: sie sollen als Schalt-Transiente ueber dem Band
    # sitzen, nicht durch denselben Bandpass gedaempft werden wie die Stimme.
    y[:click_n] += pre * 0.5
    y[-click_n:] += post * 0.4
    peak = np.max(np.abs(y)) + 1e-9
    return (y / peak * 0.85).astype(np.float32)


def write_wav(path, x, sr):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def encode_ogg(wav_path, ogg_path):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
                     '-c:a', 'libvorbis', '-q:a', '4', ogg_path], check=True)


def main():
    print('Rendere zehn Phrasen ueber PowerShell/System.Speech ...')
    render_tts()
    manifest = {}
    seed = 0
    for key, texts in PHRASES.items():
        manifest[key] = {}
        for lang in ('de', 'en'):
            raw_path = os.path.join(WORK, 'voice_%s_%s_raw.wav' % (key, lang))
            x, sr = read_wav_mono(raw_path)
            x = resample_if_needed(x, sr, SR)
            y = radio_filter(x, SR, seed)
            seed += 1
            filt_wav = os.path.join(WORK, 'voice_%s_%s_filtered.wav' % (key, lang))
            write_wav(filt_wav, y, SR)
            ogg_name = 'voice_%s_%s.ogg' % (key, lang)
            encode_ogg(filt_wav, os.path.join(OUT, ogg_name))
            manifest[key][lang] = ogg_name
            print('  %-10s %-3s %5.2f s  -> %s' % (key, lang, len(y) / SR, ogg_name))
    path = os.path.join(OUT, 'voice.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    print('')
    print('audio/voice.json geschrieben, %d Dateien in audio/.' % (len(PHRASES) * 2))
    print('Hinweis: audio/CREDITS.md von Hand ergaenzen - dieses Skript schreibt es nicht,')
    print('aus demselben Grund wie engine_synth.py: es kennt nur seinen eigenen Anteil.')


if __name__ == '__main__':
    main()
