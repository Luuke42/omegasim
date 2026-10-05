#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""android-app/www fuellen: die EINGEBAUTE Fassung der Web-App in der APK.

    python tools/apk_www.py

Kopiert genau die Dateien aus app-update.json, mit denselben Bytes, die dort gehasht sind
(Textdateien mit LF). index.html wird NICHT veraendert - BESTELLT war eine APK, "die identisch
zur HTML-App ist". Was die App nativ anders macht (Bluetooth-Bruecke, Host, Aktualisierung),
steht in index.html selbst hinter `window.Capacitor` und schlaeft im Browser.

Die eingebaute app-update.json kommt mit: aus ihr weiss OmegaUpdate, welche Dateien es bei
einer Aktualisierung nicht neu laden muss (gleiche Pruefsumme -> aus der APK kopieren).
"""
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import app_update  # noqa: E402

ZIEL = os.path.join(REPO, 'android-app', 'www')


def main():
    with open(os.path.join(REPO, 'app-update.json'), encoding='utf-8') as f:
        liste = json.load(f)
    if os.path.isdir(ZIEL):
        shutil.rmtree(ZIEL)
    falsch = []
    for e in liste['dateien']:
        b = app_update.inhalt(e['p'])
        if hashlib.sha256(b).hexdigest() != e['h']:
            falsch.append(e['p'])
        ziel = os.path.join(ZIEL, *e['p'].split('/'))
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        with open(ziel, 'wb') as f:
            f.write(b)
    shutil.copyfile(os.path.join(REPO, 'app-update.json'), os.path.join(ZIEL, 'app-update.json'))
    if falsch:
        print('app-update.json passt nicht zu den Dateien (erst tools/build.py laufen lassen): '
              + ', '.join(falsch[:5]), file=sys.stderr)
        return 1
    print('android-app/www: %d Dateien, Version %s' % (len(liste['dateien']), liste['version']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
