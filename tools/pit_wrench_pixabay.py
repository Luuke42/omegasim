"""Boxenstopp-Schrauber (v1.1.42) aus einer Pixabay-Aufnahme.

Quelle: "Pneumatic impact wrench loosening bolts", Sound Effect by Jun Su (soundeffectsparty,
https://pixabay.com/de/users/soundeffectsparty-54949351/) from Pixabay, Nr. 502995,
Pixabay-Inhaltslizenz (https://pixabay.com/service/license-summary/). Die Originaldatei ist NICHT
Teil dieses Repos (die Lizenz verbietet die Weitergabe als Einzeldatei); dieses Skript baut daraus
den bearbeiteten Ausschnitt, der nur als Teil von OmegaSim mitgeliefert wird.

Aufruf: python tools/pit_wrench_pixabay.py <soundeffectsparty-pneumatic-impact-wrench-...-502995.mp3>
Baut:   audio/pit_wrench_paar.ogg (ein Radpaar, 2,0 s: zwei Muttern loesen, Pause, zwei anziehen)
"""
import os, subprocess, sys, tempfile
import numpy as np
import scipy.io.wavfile as w
from scipy.signal import butter, sosfilt

SR = 44100
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUELLE = sys.argv[1]
TMP = tempfile.mkdtemp()
_mono = os.path.join(TMP, 'mono.wav')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', QUELLE, '-ac', '1', '-ar', str(SR), _mono], check=True)
sr, x = w.read(_mono)
x = x.astype(np.float64) / 32768.0
assert sr == SR

# Ton etwas runder: unter 120 Hz Rumpeln weg, ab 9 kHz sanft weg (die Aufnahme ist hart bei 5-7 kHz).
sos_hp = butter(2, 120, 'hp', fs=SR, output='sos')
sos_lp = butter(2, 9000, 'lp', fs=SR, output='sos')
x = sosfilt(sos_lp, sosfilt(sos_hp, x))


def stoss(von, bis, ein=0.004, aus=0.06):
    a, b = int(von * SR), int(bis * SR)
    s = x[a:b].copy()
    n = len(s)
    f = np.ones(n)
    ne, na = int(ein * SR), int(aus * SR)
    f[:ne] = np.linspace(0, 1, ne)
    f[-na:] = np.linspace(1, 0, na) ** 2
    s *= f
    return s / (np.max(np.abs(s)) + 1e-9)


# Lösen: die langen Stöße (0,5 s), anziehen: die kurzen, harten (0,25-0,33 s).
loesen = [stoss(7.27, 7.84), stoss(17.28, 17.80)]
anziehen = [stoss(11.25, 11.62), stoss(13.39, 13.68)]


def legen(ziel, s, t, g):
    a = int(t * SR)
    ziel[a:a + len(s)] += s[:max(0, len(ziel) - a)] * g


def paar(dauer=2.0):
    y = np.zeros(int(dauer * SR))
    # Zwei Mechaniker: der zweite setzt 70 ms später an und ist eine Spur leiser (weiter weg).
    legen(y, loesen[0], 0.02, 0.75)
    legen(y, loesen[1], 0.09, 0.55)
    # Rad runter, neues drauf: ~0,7 s Ruhe, dann anziehen.
    legen(y, anziehen[0], 1.28, 0.75)
    legen(y, anziehen[1], 1.34, 0.55)
    return y


def normal(y, dbfs=-3.0):
    return y / (np.max(np.abs(y)) + 1e-9) * 10 ** (dbfs / 20)


p = normal(paar())
wav = os.path.join(TMP, 'paar.wav')
w.write(wav, SR, (p * 32767).astype(np.int16))
ziel = os.path.join(REPO, 'audio', 'pit_wrench_paar.ogg')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '5', ziel], check=True)
print('pit_wrench_paar', round(len(p) / SR, 2), 's ->', ziel)
