#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""app-update.json schreiben: die Dateiliste, aus der sich die Android-App selbst aktualisiert.

BESTELLT: "Ich will, dass ich die App einfach updaten kann, ohne die APK neu installieren zu
muessen." Die APK traegt eine eingebaute Fassung der Web-App. Beim Start fragt sie
https://lukasroeseler.github.io/btsr/app-update.json ab; steht dort eine neuere Version, laedt
das Plugin OmegaUpdate genau die Dateien, deren Pruefsumme sich geaendert hat, und schaltet
die WebView auf den neuen Ordner um. Herkunft bleibt https://localhost, also bleiben alle
Einstellungen (localStorage) erhalten.

Gerufen von build.py (build_sw) - damit die Liste nie zu einer anderen index.html gehoert als
der, die gerade gebaut wurde. Ein eigener Aufruf, den man vergessen kann, waere dieselbe Falle
wie damals die Cacheversion in sw.js.

ZEILENENDEN: die Arbeitskopie hat CRLF, das Repo (core.autocrlf=input) und damit GitHub Pages
LF. Textdateien werden deshalb MIT LF gehasht - sonst passte keine einzige Pruefsumme zu dem,
was das Telefon herunterlaedt, und jede Aktualisierung liefe in den Pruefsummenfehler.
"""
import hashlib
import io
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, 'app-update.json')

# Was die Web-App zur Laufzeit laedt. sw.js fehlt absichtlich: in der App meldet 91-pwa.js
# keinen Service Worker an, er wuerde dort nur eine zweite, veraltende Ablage bilden.
EINZELN = ['index.html', 'mp-overview.html', 'manifest.webmanifest', 'favicon.svg']
ORDNER = ['icons', 'audio', 'img']
TEXT = ('.html', '.json', '.webmanifest', '.svg', '.js', '.css', '.txt', '.md')

# Die Fassung der NATIVEN Schicht (Plugins, Rechte), die diese Web-App mindestens braucht.
# Hochzaehlen, wenn index.html ein neues natives Plugin ruft - dann bietet die App statt eines
# Web-Updates "neue APK noetig" an. Muss zu APK_STUFE in OmegaUpdatePlugin.java passen.
APK_STUFE = 2


def inhalt(pfad):
    with open(os.path.join(REPO, pfad), 'rb') as f:
        roh = f.read()
    if pfad.lower().endswith(TEXT):
        roh = roh.replace(b'\r\n', b'\n')
    return roh


def dateien():
    liste = list(EINZELN)
    try:
        # --others --exclude-standard: auch NEUE Dateien, die erst mit diesem Commit ins Repo
        # kommen (bump_version laeuft vor dem Commit), aber nichts, was .gitignore ausschliesst
        # - das stuende nicht auf GitHub Pages, und jede Aktualisierung liefe in ein 404.
        roh = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'] + ORDNER,
                                      cwd=REPO, text=True)
        spur = [z.strip() for z in roh.splitlines() if z.strip()]
    except Exception:
        spur = []
    if not spur:
        for o in ORDNER:
            for wurzel, _, namen in os.walk(os.path.join(REPO, o)):
                for n in namen:
                    spur.append(os.path.relpath(os.path.join(wurzel, n), REPO).replace(os.sep, '/'))
    # Root-Ebene: die SVG-Muster der Druckvorlagen (Start/Ziel, Trapeze, Schneidebogen), die
    # index.html als Vorschau-Bild und als Download anbietet. Ohne sie fehlt das Vorschaubild
    # in der App (APK baut aus dieser Liste). favicon.svg steht schon in EINZELN.
    spur += [n for n in os.listdir(REPO) if n.endswith('.svg') and n != 'favicon.svg'
             and os.path.isfile(os.path.join(REPO, n))]
    # Nur was es wirklich gibt: eine geloeschte, aber noch nicht aus git entfernte Datei
    # wuerde sonst jeden Download mit 404 abbrechen.
    liste += sorted(p for p in spur if os.path.isfile(os.path.join(REPO, p)))
    return liste


def schreiben(version):
    eintraege = []
    for p in dateien():
        b = inhalt(p)
        eintraege.append({'p': p, 'h': hashlib.sha256(b).hexdigest(), 'g': len(b)})
    # Eine Datei je Zeile: so bleibt der Diff je Commit lesbar (welche Dateien haben sich
    # geaendert), und die Datei bleibt trotzdem gueltiges JSON.
    zeilen = [json.dumps(e, ensure_ascii=False, separators=(',', ':')) for e in eintraege]
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{"version":%s,"apk":%d,"dateien":[\n%s\n]}\n'
                % (json.dumps(version), APK_STUFE, ',\n'.join(zeilen)))
    return len(eintraege), sum(e['g'] for e in eintraege)


if __name__ == '__main__':
    import re
    with io.open(os.path.join(REPO, 'index.html'), encoding='utf-8') as f:
        m = re.search(r"TOOL_VERSION\s*=\s*'([^']+)'", f.read())
    n, g = schreiben(m.group(1) if m else '0')
    print('app-update.json: %d Dateien, %.1f MB' % (n, g / 1e6))
