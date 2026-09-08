#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Versionsnummer aus der Git-Historie in index.html schreiben.

Format:  0.<Woche>.<Push>
  Woche  vollendete 7-Tage-Bloecke seit dem ersten Commit
  Push   Commits seit Beginn des laufenden Blocks, einschliesslich des gerade
         entstehenden - deshalb +1

Vor jedem Commit aufrufen:

    python tools/bump_version.py

Geschrieben wird in die QUELLE (src/00-index.head.html), danach wird index.html gleich
mitgebaut.

Warum aus der Historie und nicht von Hand: eine Zahl, die man selbst pflegt, ist nach dem
dritten Push falsch. Der 7-Tage-Block wird ab dem ERSTEN Commit gezaehlt, nicht ab Montag -
sonst stimmen die beiden Stellen nicht zueinander, weil die Wochenzahl ebenfalls vom
Projektbeginn aus laeuft.
"""
import datetime
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
# In die QUELLE schreiben, nicht in das Ergebnis.
#
# index.html wird von build.py erzeugt. Ein Stempel dort waere beim naechsten Bau
# wieder weg, und `build.py --check` hat genau das binnen einer Minute gemeldet:
# "UNTERSCHIED ab Zeichen 263000", weil die Version in der einen Datei stand und in
# der anderen nicht. Deshalb: Quelle stempeln, dann bauen.
TARGET = os.path.join(REPO, 'src', '00-index.head.html')


def git(*args):
    return subprocess.check_output(['git'] + list(args), cwd=REPO, text=True).strip()


def version():
    first = git('log', '--reverse', '--format=%aI').splitlines()[0]
    start = datetime.datetime.fromisoformat(first).date()
    today = datetime.date.today()
    week = (today - start).days // 7
    block = start + datetime.timedelta(days=week * 7)
    n = int(git('rev-list', '--count', 'HEAD',
                '--since=%s 00:00:00' % block.isoformat()))
    # +1, weil der Commit, fuer den diese Nummer gilt, noch nicht existiert.
    return '0.%d.%d' % (week, n + 1), start, block


def main():
    v, start, block = version()
    s = io.open(TARGET, encoding='utf-8').read()
    pat = re.compile(r'(<span id="app-version">)[^<]*(</span>)')
    if not pat.search(s):
        print('FEHLER: <span id="app-version"> nicht in %s gefunden' % TARGET,
              file=sys.stderr)
        return 1
    new = pat.sub(lambda m: m.group(1) + v + m.group(2), s, count=1)
    # OHNE frueher Ausstieg, und das ist eine Berichtigung. Hier stand `return 0`, sobald die
    # Nummer schon stimmte - dann wurde auch nicht gebaut. Genau in dem Fall kann aber sw.js
    # hinterherhaengen (siehe unten), und ein Werkzeug, das die Lage nicht herstellt, weil sie
    # halb schon da ist, ist ein Werkzeug, dem man nicht ansehen kann, ob es gelaufen ist.
    if new == s:
        print('Version unveraendert: %s' % v)
    else:
        io.open(TARGET, 'w', encoding='utf-8', newline='').write(new)
        print('Version %s  (Projektbeginn %s, Block ab %s)' % (v, start, block))
    # Gleich mitbauen. Wer nur stempelt und das Bauen vergisst, hinterlaesst eine Quelle und
    # ein Ergebnis, die auseinanderliegen - und merkt es erst beim naechsten --check.
    #
    # HERE in den Suchpfad, damit der Aufruf aus JEDEM Verzeichnis geht. Ohne diese Zeile
    # fand `python tools/bump_version.py` das Nachbarmodul nicht, und der Fehler kam erst
    # nach dem Stempeln - also mit halb erledigter Arbeit.
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import build
    gebaut = build.build()
    io.open(os.path.join(REPO, 'index.html'), 'w', encoding='utf-8',
            newline='').write(gebaut)
    print('index.html neu gebaut')
    # UND sw.js, denn dessen Cachename traegt dieselbe Version. Diese Zeile fehlte, und der
    # Schaden stand die ganze Zeit im Kommentar von build_sw(): "der Cachename MUSS sich mit
    # jedem Build aendern, sonst liefert der Service Worker nach einem Push die alte Fassung
    # aus". Genau das ist passiert - in jedem Commit von 0.5.34 bis 0.5.38 stand in sw.js
    # die VORHERIGE Version:
    #
    #     index=0.5.34  sw=0.5.33
    #     index=0.5.35  sw=0.5.34
    #     ...
    #     index=0.5.38  sw=0.5.37
    #
    # Bemerkt hat es niemand, weil die Selbstpruefung "Cacheversion in sw.js passt" VOR dem
    # Stempeln lief - da passte sie, und danach sah niemand mehr hin. Ein Aufruf mehr hier
    # ist die Behebung; die Reihenfolge (erst stempeln, dann beides bauen) ist der Grund,
    # warum sie hier steht und nicht in build.build().
    # NICHT `version` als Name: das ist hier oben die Funktion, die die Nummer bildet, und
    # eine lokale Zuweisung macht sie in der GANZEN Funktion lokal - der Aufruf in Zeile 57
    # fiel damit auf eine noch nicht belegte Variable.
    swver, meldung = build.build_sw(gebaut)
    print('  ' + meldung)
    if swver is None:
        print('FEHLER: sw.js nicht geschrieben', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
