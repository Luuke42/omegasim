#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Menuebilder aus photos/ erzeugen: verkleinert, gedreht, als JPEG.

    python tools/bilder.py                 -> mockup/img/
    python tools/bilder.py --ziel img      -> img/ (fuer die App)

Die Originale in photos/ sind bis 4080 px gross und kommen NICHT ins Repo. Hier entstehen
je Motiv zwei Groessen: <name>-bg.jpg (1920 px, Hintergrund) und <name>.jpg (720 px, Kachel).
Die EXIF-Drehung wird angewandt, sonst stehen Handyfotos im Browser quer.

Die Fotos sind vom Nutzer selbst (eigene Aufnahmen bzw. sein Flickr-Konto RLukas); die
Stimmungsbilder seit v0.8.27 sind KI-generiert (Gemini Flash), siehe Credits in der App.

Logos: BESTELLT "Logos rausnehmen bitte". Die KI-Bilder zeigen Werbebanden und
Reifen-/Bremsenschriften echter Marken. RETUSCHE entfernt sie beim Erzeugen (OpenCV-Inpainting),
damit die Originale unveraendert bleiben und jeder Lauf dasselbe Ergebnis gibt.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageOps

try:
    import cv2
except ImportError:          # pip install opencv-python-headless
    cv2 = None

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
QUELLE = os.path.join(REPO, 'photos')

# Motiv -> Datei in photos/, wahlweise mit Drehung in Grad (gegen den Uhrzeigersinn).
# Zweite Runde eigener Fotos (BESTELLT: "Neue Bilder (von mir fotografiert) in die App
# einbauen (vom Auto und von der Strecke)"): der BMW M4 GT3 von hinten und von oben, die
# ausgedruckten Streifen mit blauen und roten Pfeilen, der Controller. 24225 ist das
# ACC-Foto und dient nur zur Orientierung - es kommt nicht in die App.
# Dritte Runde (v0.8.27, BESTELLT: "Integrate the new AI-generated images in the photos
# folder"): KI-Bilder fuer die Stimmungsbilder - Titel, Rennoptionen, Start, Strecke auf der
# Bahn, Optionen, Info, Challenges und die Box. Die eigenen Fotos (Autos, Garage,
# Pfeilstreifen, Controller) bleiben, wo sie zeigen, was man wirklich vor sich hat.
# Die KI-Bilder sind nur 1024 px breit; der Hintergrund wird nicht hochgerechnet
# (thumbnail() vergroessert nie), der Browser skaliert und die Abdunklung verdeckt es.
MOTIVE = {
    'titel': 'eb15c751-2d72-41aa-af6c-8e5bc54bee18.jpg',   # GT3 bei Nacht im Regen, Scheinwerfer
    'haupt': '5093976649_62c0292c23_b.jpg',
    # BESTELLT (v0.8.35): "FAHREN Hintergrundbild: rangezoomte Version auf das Ruecklicht".
    'fahren': ('fcfd5041-9934-4ffc-ae13-c784316066ed.jpg', 0, (110, 150, 640, 430)),
    'auto': '24276.jpg',                    # M4 GT3 von hinten
    'garage': ('24273.jpg', 90),            # M4 GT3 von oben, quer gelegt
    # BESTELLT (v0.8.53): TRACK-Kachel im Fahren-Menue - "Auf der Bahn" zeigt 24282 (Carrera
    # Hybrid), "Frei" das neu dazugekommene 744468c1. Beide dienen auch als Tab-Hintergrund
    # und in der Startaufstellung.
    'strecke-bahn': '24282.jpg',            # Carrera-Hybrid-Bahn
    'strecke-frei': '744468c1-47c0-4228-a8c9-b73a44cd62ad.jpg',   # ausgedruckte Streifen
    'rennen': '3a0115af-1174-4c1d-98c5-0ae21c34722e.jpg',   # Startaufstellung von oben
    'start': '4be73532-6d99-4a25-b4a1-66abaf6e52d5.jpg',    # Autos in der Senke
    'mehrspieler': '24279.jpg',             # Auto, Controller mit Telefonhalter
    'optionen': '4201b527-ea78-42d2-925a-1126732a5000.jpg', # Rad und Bremse
    'info': '9371f406-4cdb-461a-93c5-497aa62b5b9a.jpg',     # Scheinwerfer, Carbon
    'challenges': 'fcfd5041-9934-4ffc-ae13-c784316066ed.jpg', # Heck im Regen
    'box': '73553e66-ea5f-483f-baaf-21d408121b00.jpg',        # Reifen nah
    'controller': '24277.jpg',              # Controller nah (Steuerungs-Fuehrung)
    # Asphalt fuer den Editor-Hintergrund (BESTELLT: "stark abgedunkeltes, schwaches Bild mit
    # Asphalt von einer Strecke"): ein Ausschnitt nur mit Fahrbahn, ohne Randstein und Gras.
    # Kachelbilder im Fahren-Menue (v0.8.35). BESTELLT: "Foto bei Strecke so machen, dass
    # wirklich nur der Randstreifen zu sehen ist (einfach ranzoomen) und freies Training mit
    # einem der Nordschleife-Bilder ersetzen".
    'strecke-kachel': ('03a18c66-3e7f-4c80-a5f6-94465b9d43c7.jpg', 0, (300, 340, 840, 559)),
    'rennoptionen': ('eb15c751-2d72-41aa-af6c-8e5bc54bee18.jpg', 0, (330, 170, 860, 470)),
    # Rennoptionen-Kachel wechselt mit dem Rennmodus das Bild (BESTELLT v0.8.53).
    'rennoptionen-practice': '6910463278_f7aa66a535_b.jpg',
    'rennoptionen-endurance': ('eb15c751-2d72-41aa-af6c-8e5bc54bee18.jpg', 0, (330, 170, 860, 470)),
    'rennoptionen-qualifying': '03a18c66-3e7f-4c80-a5f6-94465b9d43c7.jpg',
    'rennoptionen-laps': 'Gemini_Generated_Image_t5r42rt5r42rt5r4.jpg',
    'asphalt': ('03a18c66-3e7f-4c80-a5f6-94465b9d43c7.jpg', 0, (0, 238, 420, 345)),
}
GROESSEN = {'-bg': 1920, '': 720}

# ---- Logos entfernen --------------------------------------------------------------------
# Je Quelldatei eine Liste von Schritten, Koordinaten im Original (x0, y0, x1, y1):
#   ('schrift', box, k, t)  Schrift/Logo auf einfarbigem Grund: was mehr als t vom
#                           Median (Fenster k) abweicht, wird maskiert und nachgemalt
#   ('farbe', box, s, v)    farbige Schrift (gelb/rot/gold): Saettigung > s und Helligkeit > v
#   ('flaeche', box)        ganze Bande einfarbig in ihrer eigenen Grundfarbe
#   ('weich', box, r)       unleserlich weichzeichnen (kleine Aufkleber)
#   ('hell', box, s, v)     weisse Schrift: Saettigung < s und Helligkeit > v
#   ('streifen', box, w)    lange Bande: jede Zeile waagerecht mit Fenster w gemittelt
#                           (Median), so bleibt ihr Farbverlauf und die Schrift geht
#   ('zuschnitt', box)      nur diesen Ausschnitt behalten (als letzter Schritt)
RETUSCHE = {
    # BMW-Scheinwerfer: "M PERFORMANCE", "BMW LASERLIGHT ...", kleines M-Logo
    '9371f406-4cdb-461a-93c5-497aa62b5b9a.jpg': [
        ('schrift', (350, 417, 498, 441), 15, 28),
        ('schrift', (256, 442, 508, 466), 15, 22),
        ('schrift', (570, 282, 632, 308), 11, 26),
    ],
    # Randstein Spa: Banden oben, aramco rechts, Streckenname links
    '03a18c66-3e7f-4c80-a5f6-94465b9d43c7.jpg': [
        ('flaeche', (306, 61, 379, 91)), ('flaeche', (379, 68, 439, 89)),
        ('flaeche', (439, 71, 494, 93)), ('flaeche', (405, 99, 505, 110)),
        ('flaeche', (415, 110, 522, 120)),
        ('hell', (918, 166, 1024, 206), 90, 135),
        ('schrift', (0, 148, 48, 182), 15, 40),
    ],
    # Startaufstellung von oben: Banden, Boxengebaeude, Rolex-Mauer, aramco-Streifen
    '3a0115af-1174-4c1d-98c5-0ae21c34722e.jpg': [
        ('flaeche', (462, 87, 528, 105)), ('flaeche', (527, 87, 586, 105)),
        ('flaeche', (585, 87, 642, 106)), ('flaeche', (534, 116, 636, 129)),
        ('flaeche', (724, 81, 751, 101)),
        ('streifen', (438, 204, 552, 220), 41), ('flaeche', (551, 204, 604, 220)),
        ('streifen', (603, 204, 718, 220), 41), ('streifen', (766, 204, 874, 220), 41),
        ('streifen', (132, 300, 842, 317), 81), ('hell', (838, 298, 1024, 320), 90, 135),
        ('streifen', (136, 346, 1024, 360), 101),
        ('streifen', (0, 232, 112, 249), 61),
    ],
    # Autos in der Senke: Banden oben, aramco rechts, Streckenname, Frontscheiben-Band
    '4be73532-6d99-4a25-b4a1-66abaf6e52d5.jpg': [
        ('flaeche', (294, 54, 363, 81)), ('flaeche', (362, 59, 423, 81)),
        ('flaeche', (422, 63, 478, 84)), ('flaeche', (389, 91, 502, 107)),
        ('flaeche', (398, 107, 502, 115)),
        ('hell', (864, 178, 999, 270), 90, 135),
        ('schrift', (0, 158, 58, 192), 15, 40),
        ('weich', (570, 199, 643, 210), 4), ('weich', (526, 227, 563, 240), 4),
    ],
    # Rad: Pirelli und P ZERO auf der Flanke, brembo auf dem Sattel, Streckenschild
    '4201b527-ea78-42d2-925a-1126732a5000.jpg': [
        ('farbe', (172, 58, 262, 238), 90, 70),
        ('farbe', (176, 236, 246, 462), 90, 70),
        ('schrift', (708, 206, 784, 368), 21, 45),
        ('streifen', (12, 120, 194, 160), 121),
    ],
    # Reifen nah: P ZERO ist das halbe Motiv, Nachmalen blieb als Fleck lesbar. Also nur die
    # Laufflaeche darunter.
    '73553e66-ea5f-483f-baaf-21d408121b00.jpg': [
        ('zuschnitt', (0, 330, 1024, 559)),
    ],
    # Heck im Regen: Pirelli-Schrift auf der Flanke
    'fcfd5041-9934-4ffc-ae13-c784316066ed.jpg': [
        ('farbe', (610, 380, 665, 540), 80, 60),
    ],
    # Nacht-GT3: Band an der Frontscheibe
    'eb15c751-2d72-41aa-af6c-8e5bc54bee18.jpg': [
        ('weich', (568, 312, 644, 324), 4),
    ],
}


def retusche(bild, schritte):
    """Wendet die RETUSCHE-Schritte auf ein PIL-Bild an (RGB) und gibt ein neues zurueck."""
    if not schritte:
        return bild
    if cv2 is None:
        raise SystemExit('Fuer die Logo-Retusche wird OpenCV gebraucht: pip install opencv-python-headless')
    a = cv2.cvtColor(np.asarray(bild), cv2.COLOR_RGB2BGR).copy()
    for schritt in schritte:
        art, (x0, y0, x1, y1) = schritt[0], schritt[1]
        x1, y1 = min(x1, a.shape[1]), min(y1, a.shape[0])
        teil = a[y0:y1, x0:x1]
        if art == 'flaeche':
            farbe = np.median(teil.reshape(-1, 3), axis=0)
            rausch = np.random.default_rng(x0 * 7 + y0).normal(0, 2.5, teil.shape)
            neu = np.clip(farbe + rausch, 0, 255).astype(np.uint8)
            a[y0:y1, x0:x1] = cv2.GaussianBlur(neu, (3, 3), 0)
            continue
        if art == 'zuschnitt':
            a = a[y0:y1, x0:x1].copy()
            continue
        if art == 'streifen':
            w = schritt[2] | 1
            rand = np.pad(teil, ((0, 0), (w // 2, w // 2), (0, 0)), mode='edge')
            fenster = np.lib.stride_tricks.sliding_window_view(rand, w, axis=1)
            neu = np.median(fenster, axis=-1).astype(np.uint8)
            a[y0:y1, x0:x1] = cv2.GaussianBlur(neu, (5, 1), 0)
            continue
        if art == 'weich':
            r = schritt[2] * 2 + 1
            a[y0:y1, x0:x1] = cv2.GaussianBlur(teil, (r, r), 0)
            continue
        maske = np.zeros(a.shape[:2], np.uint8)
        if art == 'schrift':
            k, t = schritt[2], schritt[3]
            grund = cv2.medianBlur(teil, k | 1)
            abw = np.abs(teil.astype(np.int16) - grund.astype(np.int16)).max(axis=2)
            m = (abw > t).astype(np.uint8) * 255
        elif art == 'farbe':
            sat, hell = schritt[2], schritt[3]
            hsv = cv2.cvtColor(teil, cv2.COLOR_BGR2HSV)
            m = ((hsv[..., 1] > sat) & (hsv[..., 2] > hell)).astype(np.uint8) * 255
        elif art == 'hell':
            sat, hell = schritt[2], schritt[3]
            hsv = cv2.cvtColor(teil, cv2.COLOR_BGR2HSV)
            m = ((hsv[..., 1] < sat) & (hsv[..., 2] > hell)).astype(np.uint8) * 255
        else:
            raise ValueError(art)
        m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=2)
        maske[y0:y1, x0:x1] = m
        a = cv2.inpaint(a, maske, 5, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(a, cv2.COLOR_BGR2RGB))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ziel', default=os.path.join('mockup', 'img'))
    a = ap.parse_args()
    ziel = os.path.join(REPO, a.ziel)
    os.makedirs(ziel, exist_ok=True)
    summe = 0
    for name, eintrag in MOTIVE.items():
        if not isinstance(eintrag, tuple):
            eintrag = (eintrag,)
        datei, drehung, zuschnitt = (tuple(eintrag) + (0, None))[:3]
        pfad = os.path.join(QUELLE, datei)
        if not os.path.exists(pfad):
            print('fehlt: ' + datei, file=sys.stderr)
            return 1
        bild = ImageOps.exif_transpose(Image.open(pfad)).convert('RGB')
        bild = retusche(bild, RETUSCHE.get(datei))
        if zuschnitt:
            bild = bild.crop(zuschnitt)
        if drehung:
            bild = bild.rotate(drehung, expand=True)
        for endung, breite in GROESSEN.items():
            b = bild.copy()
            b.thumbnail((breite, breite * 2), Image.LANCZOS)
            aus = os.path.join(ziel, name + endung + '.jpg')
            b.save(aus, 'JPEG', quality=78, optimize=True, progressive=True)
            summe += os.path.getsize(aus)
    print('%d Bilder in %s, %.1f MB' % (len(MOTIVE) * len(GROESSEN), a.ziel, summe / 1e6))
    return 0


if __name__ == '__main__':
    sys.exit(main())
