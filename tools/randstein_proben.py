"""Hoerproben und FFT fuer den Randstein-Klang im virtuellen Fahren (v1.3.39).

BESTELLT: "Verbessere den Randstein-Sound. Aktuell ist es ein hohes Klicken. Es soll dumpf sein,
eher wie bei Assetto Corsa Competizione klingen."

Dieses Skript bildet die WebAudio-Kette aus randsteinKlangBauen() in src/80-sound.js in numpy nach
(Biquads nach den Formeln der Web-Audio-Spezifikation, Q von Tiefpaessen in dB) und schreibt je
Tempo eine Probe NEU und ALT (der Rauschpuffer aus vfRattern, alle ~83 ms neu gestartet). Danach
eine FFT: Anteil der Energie unter 300 Hz, ueber 1 kHz und der spektrale Schwerpunkt.
Die Zahlen hier muessen mit RS_* in src/80-sound.js und vfRandsteinTakt() in
src/60d-virtuell.js uebereinstimmen.

Aufruf: python tools/randstein_proben.py <ausgabeordner>
"""
import os, subprocess, sys, wave
import numpy as np
from scipy.signal import lfilter

SR = 48000
DAUER = 3.0
# --- wie src/80-sound.js (RS_*) ------------------------------------------------------------
RS_TIEF_HZ, RS_TIEF_Q_DB, RS_TIEF_G = 95.0, 0.0, 6.0          # Grundrumpeln: Rauschen tiefpass
RS_KOERPER_HZ, RS_KOERPER_Q, RS_KOERPER_G = 190.0, 2.0, 3.5     # Karosserie-Resonanz: Bandpass
RS_TON_G = 0.28                                                # Sinus 38 + 1,2 * Takt Hz
RS_HUELLE = (0.3125, 0.46875, 0.1875, 0.03125)                 # ((1 + cos)/2)^3: DC, a1, a2, a3
RS_FORM_K = 1.6                                                # Waveshaper tanh(k x) / tanh(k)
RS_GLATT_HZ, RS_GLATT_Q_DB = 700.0, -3.0                       # Schluss-Tiefpass
RS_PEGEL = 0.55                                                # Gain bei menge = 1
# --- wie src/60d-virtuell.js ----------------------------------------------------------------
TACHO_SCALE = 50 * 5.45 / 4.0
TRACK_UNITS_PER_CM = 40 / 43
VF_KERB_STREIFEN = 2 * 40 / 14        # zwei Mittellinienpunkte je Farbfeld, 14 Punkte je Kachel
VF_KERB_RIPPEN = 3                    # Rippen je Farbfeld


def takt(kmh_anzeige):
    kmh = kmh_anzeige / TACHO_SCALE
    v_e = kmh / 3.6 * 100 * TRACK_UNITS_PER_CM
    return max(8.0, min(40.0, VF_KERB_RIPPEN * v_e / VF_KERB_STREIFEN))


def menge(kmh_anzeige, tiefe=1.0):
    return (0.45 + 0.55 * tiefe) * min(1.0, 0.35 + kmh_anzeige / 160)


def lowpass(x, f, q_db):
    w0 = 2 * np.pi * f / SR
    alpha = np.sin(w0) / (2 * 10 ** (q_db / 20))
    c = np.cos(w0)
    b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    a = [1 + alpha, -2 * c, 1 - alpha]
    return lfilter(b, a, x)


def bandpass(x, f, q):
    w0 = 2 * np.pi * f / SR
    alpha = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    return lfilter([alpha, 0, -alpha], [1 + alpha, -2 * c, 1 - alpha], x)


def ziel_kurve(n, an_s, aus_s, wert, tc_an=0.03, tc_aus=0.035):
    """setTargetAtTime: an bei an_s, aus bei aus_s, exponentiell."""
    t = np.arange(n) / SR
    g = np.zeros(n)
    m = (t >= an_s) & (t < aus_s)
    g[m] = wert * (1 - np.exp(-(t[m] - an_s) / tc_an))
    w_aus = wert * (1 - np.exp(-(aus_s - an_s) / tc_an))
    m2 = t >= aus_s
    g[m2] = w_aus * np.exp(-(t[m2] - aus_s) / tc_aus)
    return g


def neu(kmh_anzeige, rng):
    n = int(SR * DAUER)
    t = np.arange(n) / SR
    f_b = takt(kmh_anzeige)
    rausch = np.tile(rng.uniform(-1, 1, SR), int(np.ceil(DAUER)) + 1)[:n]   # 1 s Schleife
    tief = lowpass(rausch, RS_TIEF_HZ, RS_TIEF_Q_DB) * RS_TIEF_G
    koerper = bandpass(rausch, RS_KOERPER_HZ, RS_KOERPER_Q) * RS_KOERPER_G
    ton = np.sin(2 * np.pi * (38 + 1.2 * f_b) * t) * RS_TON_G
    ph = 2 * np.pi * f_b * t
    huelle = RS_HUELLE[0] + RS_HUELLE[1] * np.cos(ph) + RS_HUELLE[2] * np.cos(2 * ph) + RS_HUELLE[3] * np.cos(3 * ph)
    am = (tief + koerper + ton) * huelle
    kurve_x = np.linspace(-1, 1, 257)
    kurve = np.tanh(RS_FORM_K * kurve_x) / np.tanh(RS_FORM_K)
    form = np.interp(np.clip(am, -1, 1), kurve_x, kurve)
    glatt = lowpass(form, RS_GLATT_HZ, RS_GLATT_Q_DB)
    return glatt * ziel_kurve(n, 0.10, 2.70, RS_PEGEL * menge(kmh_anzeige)), am


def alt(kmh_anzeige, rng):
    """vfRattern bis v1.3.38: 60 ms Rauschen (1 - i/n), staerke 0,10 + min(0,10, kmh/40), alle >70 ms
    (bei 60 Bildern/s also alle 5 Bilder = 83 ms) neu gestartet."""
    n = int(SR * DAUER)
    x = np.zeros(n)
    kmh = kmh_anzeige / TACHO_SCALE
    staerke = 0.10 + min(0.10, kmh / 40)
    m = int(SR * 0.06)
    puffer = rng.uniform(-1, 1, m) * (1 - np.arange(m) / m)
    t = 0.10
    while t < 2.70:
        i = int(t * SR)
        x[i:i + m] += puffer[: max(0, min(m, n - i))] * staerke
        t += 5 / 60
    return x


def spektrum(x):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    p = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    ges = p.sum() or 1
    return {
        'unter300': p[f < 300].sum() / ges,
        'ueber1k': p[f > 1000].sum() / ges,
        'schwerpunkt': (f * p).sum() / ges,
    }


def schreiben(pfad_wav, x):
    y = np.clip(x, -1, 1)
    with wave.open(pfad_wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype('<i2').tobytes())
    ogg = pfad_wav[:-4] + '.ogg'
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', pfad_wav, '-c:a', 'libvorbis', '-q:a', '5', ogg], check=True)
    except Exception as e:  # noqa: BLE001
        print('  (kein OGG:', e, ')')


def main():
    aus = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), 'randstein_proben')
    os.makedirs(aus, exist_ok=True)
    rng = np.random.default_rng(7)
    for kmh in (40, 120):
        x_neu, am = neu(kmh, rng)
        x_alt = alt(kmh, rng)
        for name, x in (('neu', x_neu), ('alt', x_alt)):
            s = spektrum(x)
            print(f'{kmh:>3} km/h {name}: unter 300 Hz {s["unter300"]*100:5.1f} %, ueber 1 kHz {s["ueber1k"]*100:5.1f} %, '
                  f'Schwerpunkt {s["schwerpunkt"]:6.0f} Hz, Spitze {np.abs(x).max():.2f}, RMS {np.sqrt(np.mean(x**2)):.3f}')
            schreiben(os.path.join(aus, f'randstein_{name}_{kmh}kmh.wav'), x)
        print(f'          Takt {takt(kmh):.1f} Schlaege/s, Ton {38 + 1.2 * takt(kmh):.0f} Hz, menge {menge(kmh):.2f}, '
              f'Spitze vor dem Waveshaper {np.abs(am).max():.2f}')


if __name__ == '__main__':
    main()
