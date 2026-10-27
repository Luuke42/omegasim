"""Tiefe Schaltgeraeusche (v1.2.24): audio/shift_up_tief.ogg und audio/shift_down_tief.ogg.

BESTELLT: "Beim Mustang beim Hochschalten klingt es gut. Beim Runterschalten und auch bei den
anderen kommt immer dieses helle 'Klack'-Geraeusch. Schlage ein tieferes Geraeusch wie beim
Mustang v2 beim Hochschalten vor." Aus drei Hoerproben gewaehlt: C.

C = paddle_shift() aus engine_fx.py (dumpfer Schlag mit weichem Anstieg, kein Klick) plus der
tiefe Auspuffknall sd_backfire_0.ogg (Speed Dreams, Free Art License 1.3, siehe CREDITS.md),
12 ms nach dem Schlag. Das ist, was beim Mustang v2 das Hochschalten unter Last gut klingen
liess: der tiefe Knall deckt den Schlag. Jetzt bei jedem Schalten, auch runter.

Bewusst ein EIGENES Skript und nicht engine_fx.py main(): das schreibt alle Effekte neu.
Die alten shift_up.ogg / shift_down.ogg bleiben fuer den Schalter "Schaltklang: alt".
Aufruf: python tools/shift_tief.py
"""
import json, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AUDIO = os.path.join(REPO, 'audio')
sys.path.insert(0, HERE)
import engine_fx as fx  # noqa: E402

SR = fx.SR
KNALL_AB_S = 0.012
KNALL_GAIN = 0.55
SPITZE = 0.55


def lesen(pfad):
    roh = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', pfad, '-ac', '1', '-ar', str(SR),
                          '-f', 's16le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(roh, dtype='<i2').astype(np.float32) / 32768.0


def schreiben(name, x):
    wav = os.path.join(AUDIO, name + '.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
    ogg = os.path.join(AUDIO, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis',
                    '-q:a', '5', '-ac', '1', ogg], check=True)
    os.remove(wav)
    return len(x) / SR


def tief(up):
    x = fx.paddle_shift(up).copy()
    knall = lesen(os.path.join(AUDIO, 'sd_backfire_0.ogg'))
    ab = int(KNALL_AB_S * SR)
    m = min(len(x) - ab, len(knall))
    x[ab:ab + m] += KNALL_GAIN * knall[:m]
    return (x / (np.max(np.abs(x)) + 1e-9) * SPITZE).astype(np.float32)


def main():
    pfad = os.path.join(AUDIO, 'fx.json')
    fxj = json.load(open(pfad, encoding='utf-8'))
    for schluessel, up, name in [('upTief', True, 'shift_up_tief'), ('downTief', False, 'shift_down_tief')]:
        sek = schreiben(name, tief(up))
        fxj['shift'][schluessel] = {'file': name + '.ogg', 'seconds': round(sek, 2)}
        print(name, round(sek, 2), 's')
    json.dump(fxj, open(pfad, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
