#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index.html aus den Quelldateien in src/ zusammenbauen.

    python tools/build.py            baut index.html
    python tools/build.py --check    baut nichts, prueft nur ob index.html dem Bau entspricht

Warum es diesen Schritt gibt, und warum die Auslieferung trotzdem EINE Datei bleibt:

Der Wert dieser App ist, dass index.html per file:// laeuft, ohne Installation, ohne
Bundler, ohne Netz. Das bleibt so. Was sich aendert, ist die QUELLE: statt einer Datei mit
14000 Zeilen liegen die Teile in src/ und werden hier aneinandergehaengt. Genau dieses
Muster benutzt antragsmodule.html im selben Projektordner schon.

Die Reihenfolge steckt in den Zahlenpraefixen der Dateinamen und wird alphabetisch
gelesen. Das ist Absicht: die temporale Todeszone hat in dieser Datei schon vier
Ladeabbrueche verursacht (ein let/const, das weiter oben gelesen wird als es steht, bricht
die ganze IIFE ab). Eine Reihenfolge, die man im Verzeichnis SIEHT, ist gegen diesen Fehler
mehr wert als eine, die in einer Liste im Code steht.

Zusammengehaengt wird byteweise, ohne Trenner und ohne Zeilenumbruch dazwischen. Die
Dateien enthalten ihre Umbrueche selbst. Das ist die Voraussetzung dafuer, dass der Bau die
bisherige index.html Byte fuer Byte reproduzieren kann - und dieser Vergleich ist die
Abnahme, die den ganzen Umbau risikolos macht.
"""
import argparse
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, 'src')
OUT = os.path.join(REPO, 'index.html')


def pieces():
    """Alle Quelldateien in Namensreihenfolge."""
    if not os.path.isdir(SRC):
        raise SystemExit('FEHLER: %s gibt es nicht' % SRC)
    names = sorted(n for n in os.listdir(SRC)
                   if n.endswith(('.js', '.html')) and not n.startswith('.'))
    if not names:
        raise SystemExit('FEHLER: keine Quelldateien in %s' % SRC)
    return [os.path.join(SRC, n) for n in names]


def build():
    parts = []
    for p in pieces():
        with io.open(p, encoding='utf-8', newline='') as f:
            parts.append(f.read())
    return ''.join(parts)


def local_refs(html):
    """Alle lokalen src=/href= aus dem Markup, mit Zeilennummer.

    Auch aus KOMMENTAREN. Das ist Absicht und nicht Faulheit: ein auskommentierter
    Block mit href= auf eine geloeschte Datei ist eine Zeitbombe - er wird eines Tages
    wieder einkommentiert, und dann fehlt die Datei. Wer einen Block stilllegt, soll
    die Verweise darin mit stilllegen.
    """
    raus = []
    for nr, zeile in enumerate(html.split(chr(10)), 1):
        for attr in ('src="', 'href="'):
            i = 0
            while True:
                i = zeile.find(attr, i)
                if i < 0:
                    break
                i += len(attr)
                j = zeile.find(chr(34), i)
                if j < 0:
                    break
                ziel = zeile[i:j]
                i = j
                if not ziel or ziel[0] in '#?':
                    continue
                if '://' in ziel or ziel.startswith(('data:', 'mailto:', '//')):
                    continue
                raus.append((nr, ziel.split('?')[0].split('#')[0]))
    return raus


def check_dict(quelle):
    # Das Anfuehrungszeichen als Zeichencode, damit diese Datei selbst keine
    # verschachtelten Anfuehrungszeichen braucht.
    Q = chr(34)
    """Waisen im Woerterbuch I18N_EN finden.

    Es hat zwei Schreibweisen: ein Paar auf einer Zeile, oder Schluessel und Wert auf
    zwei. Loescht man bei der zweiten nur die Schluesselzeile, bleibt die Wertzeile als
    nackte Zeichenkette stehen - ein SyntaxError, der die ganze IIFE abbricht. Dann
    existiert OMEGA_TEST nicht, und der Selbsttest kann nichts melden: man sieht eine
    leere App und "Unexpected string" in der Konsole.

    Deshalb hier und nicht im Selbsttest - der laeuft erst NACH dem Parsen.
    """
    zeilen = quelle.split(chr(10))
    start = None
    for n, z in enumerate(zeilen):
        if 'I18N_EN' in z and '=' in z:
            start = n
            break
    if start is None:
        return []
    ende = len(zeilen)
    for n in range(start + 1, len(zeilen)):
        if zeilen[n] == '  };':
            ende = n
            break

    def art(z):
        t = z.strip()
        if not t or t.startswith('//'):
            return 'kommentar'
        if Q + ': ' + Q in t:
            return 'paar'
        if t.endswith(Q + ':'):
            return 'schluessel'
        if t.startswith(Q) and (t.endswith(Q + ',') or t.endswith(Q)):
            return 'wert'
        return 'unklar'

    fehler = []
    vorige = None
    for n in range(start + 1, ende):
        a = art(zeilen[n])
        if a == 'kommentar':
            continue
        if a == 'wert' and vorige != 'schluessel':
            fehler.append((n + 1, 'Wert ohne Schluessel davor', zeilen[n].strip()[:70]))
        if a == 'schluessel' and vorige == 'schluessel':
            fehler.append((n, 'Schluessel ohne Wert danach', zeilen[n - 1].strip()[:70]))
        if a == 'unklar':
            fehler.append((n + 1, 'weder Paar noch Schluessel noch Wert',
                           zeilen[n].strip()[:70]))
        vorige = a
    return fehler


def check_ids(html):
    """Zugriffe auf Element-ids, die es im Dokument nicht gibt.

    $('foo') ohne id=\"foo\" ist eine Zuweisung, die nichts tut. Sie sieht wie ein
    Merkmal aus und ist keines; so war es bei #race-track und bei #crash-indicator.
    """
    doc = re.findall(r'id="([A-Za-z0-9_-]+)"', html)
    doc_set = set(doc)
    # Zugriffe: die Formen, mit denen diese App auf Elemente geht.
    zugriff = set()
    for muster in (r"\$\('([A-Za-z0-9_-]+)'\)",
                   r"getElementById\('([A-Za-z0-9_-]+)'\)",
                   r"setTxt\('([A-Za-z0-9_-]+)'",
                   r"setSty\('([A-Za-z0-9_-]+)'"):
        zugriff |= set(re.findall(muster, html))
    # Dynamisch erzeugte ids beruecksichtigen: alles, was das Skript als id= ausgibt.
    doc_set |= set(re.findall(r"id=.([A-Za-z0-9_-]+).", html))

    # NUR diese Richtung. Die umgekehrte - "id im Dokument, das sonst nirgends vorkommt"
    # - meldete 50 Stellen, und fast alle waren falsch: mw-clatter-val, sub-print und
    # Verwandte werden im Code zusammengesetzt, das Literal steht also nirgends. Eine
    # Pruefung mit 50 falschen Treffern wird ignoriert, und dann meldet sie auch den
    # echten Fall nicht mehr.
    #
    # Der Fall "Anzeige im Dokument, die niemand mehr beschreibt" wird dort gefangen, wo
    # er sich zeigt: ein Selbsttest faehrt die Physik und prueft, dass die
    # Cockpit-Anzeigen sich dabei aendern.
    return sorted(zugriff - doc_set)


def check_refs(html):
    fehlend = []
    for nr, ziel in local_refs(html):
        if not os.path.exists(os.path.join(REPO, ziel)):
            fehlend.append((nr, ziel))
    return fehlend



SW_IN = os.path.join(HERE, 'sw.js.in')
SW_OUT = os.path.join(REPO, 'sw.js')
SW_MARKE = 'SW_VERSION_PLATZHALTER'


def build_sw(built):
    """sw.js aus der Vorlage schreiben, mit der Version aus index.html.

    Der Cachename MUSS sich mit jedem Build aendern, sonst liefert der Service Worker nach
    einem Push die alte Fassung aus - und der Fehlerbericht heisst dann "die Behebung ist
    nicht drin", waehrend man im Code sucht statt im Cache.

    Die Version kommt aus DEMSELBEN span, das bump_version.py schreibt. Sie hier ein zweites
    Mal zu pflegen waere genau die Fehlerklasse, die dieses Projekt schon mehrfach getroffen
    hat.
    """
    m = re.search(r'<span id="app-version">([^<]+)</span>', built)
    if not m:
        return None, 'app-version nicht in index.html gefunden'
    version = m.group(1).strip()
    if not os.path.exists(SW_IN):
        return None, 'tools/sw.js.in fehlt'
    with io.open(SW_IN, encoding='utf-8', newline='') as f:
        vorlage = f.read()
    # Die ZEILE pruefen und nicht bloss, ob die Marke irgendwo vorkommt. Beim ersten Anlauf
    # stand sie auch im Kommentar der Vorlage - damit war die Bedingung immer erfuellt, der
    # Waechter konnte nie ausloesen, UND die Ersetzung traf den Kommentar mit.
    zeile_marke = "const VERSION = '" + SW_MARKE + "';"
    if zeile_marke not in vorlage:
        return None, 'in sw.js.in fehlt die Zeile ' + zeile_marke
    text = vorlage.replace(zeile_marke, "const VERSION = '" + version + "';")
    # Und das Ergebnis nachpruefen: was hier hinausgeht, MUSS die Version tragen und darf
    # die Marke nicht mehr enthalten.
    if SW_MARKE in text:
        return None, 'nach der Ersetzung steht die Marke noch in sw.js'
    if ("const VERSION = '" + version + "';") not in text:
        return None, 'die Version steht nicht in der VERSION-Zeile'
    alt = None
    if os.path.exists(SW_OUT):
        with io.open(SW_OUT, encoding='utf-8', newline='') as f:
            alt = f.read()
    if alt != text:
        with io.open(SW_OUT, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
    return version, 'sw.js auf Version %s' % version


def check_klammern(js, quelle):
    """Klammern zaehlen, ausserhalb von Zeichenketten, Vorlagen, Kommentaren und Regexen.

    KEIN PARSER. Sie findet genau eine Fehlerklasse - eine Klammer zu viel oder zu wenig -
    und die hat in diesem Projekt dreimal die ganze IIFE abgebrochen. Ein Programm, das gar
    nicht laeuft, meldet keine Fehler, und der Selbsttest zeigt dann null Zeilen statt einer
    roten. Genau davor schuetzt das hier.

    MIT KONTEXTSTAPEL, weil dieses Projekt VERSCHACHTELTE Template-Literale benutzt: eine
    Vorlage enthaelt ${...} und darin wieder eine Vorlage. Ein Scanner ohne Stapel schliesst
    die aeussere am inneren Backtick, liest danach Auszeichnung als Code, und der
    Schraegstrich in </div> sieht aus wie ein regulaerer Ausdruck. Der erste Anlauf hat genau
    so einen Fehler gemeldet, den es nicht gab.
    """
    OFFEN = {'{': 0, '(': 0, '[': 0}
    tiefe = dict(OFFEN)
    passt = {'}': '{', ')': '(', ']': '['}
    # Stapel: 'code' oder ('tmpl',) - und fuer jeden aus einer Vorlage geoeffneten
    # Code-Kontext die Klammertiefe, bei der er wieder endet.
    stapel = [['code', None]]
    i, n, zeile = 0, len(js), 1
    # Wo ein Schraegstrich ein regulaerer Ausdruck sein KANN: nur nach einem Operator oder
    # einer oeffnenden Klammer. Nach einem Namen, einer Zahl oder einer schliessenden
    # Klammer ist er eine Division.
    wert = False
    while i < n:
        c = js[i]
        art = stapel[-1][0]

        if art == 'tmpl':
            if c == chr(92):
                i += 2
                continue
            if c == chr(10):
                zeile += 1
                i += 1
                continue
            if c == '`':
                stapel.pop()
                wert = True
                i += 1
                continue
            if c == '$' and i + 1 < n and js[i + 1] == '{':
                # Die Klammertiefe MERKEN: die schliessende Klammer dieses ${...} kehrt in
                # die Vorlage zurueck und darf nicht als geschweifte Klammer gezaehlt werden.
                stapel.append(['code', tiefe['{']])
                wert = False
                i += 2
                continue
            i += 1
            continue

        if c == chr(10):
            zeile += 1
            i += 1
            continue
        if c == '/' and i + 1 < n and js[i + 1] == '/':
            k = js.find(chr(10), i)
            i = n if k < 0 else k
            continue
        if c == '/' and i + 1 < n and js[i + 1] == '*':
            k = js.find('*/', i + 2)
            if k < 0:
                return None, 'unbeendeter Blockkommentar ab Zeile %d' % zeile
            zeile += js.count(chr(10), i, k)
            i = k + 2
            continue
        if c == '`':
            stapel.append(['tmpl', None])
            i += 1
            continue
        if c in ('"', "'"):
            k = i + 1
            while k < n:
                if js[k] == chr(92):
                    k += 2
                    continue
                if js[k] == c:
                    break
                if js[k] == chr(10):
                    return None, 'unbeendete Zeichenkette in Zeile %d' % zeile
                k += 1
            if k >= n:
                return None, 'unbeendete Zeichenkette ab Zeile %d' % zeile
            i = k + 1
            wert = True
            continue
        if c == '/' and not wert:
            k, klasse = i + 1, False
            while k < n:
                if js[k] == chr(92):
                    k += 2
                    continue
                if js[k] == '[':
                    klasse = True
                elif js[k] == ']':
                    klasse = False
                elif js[k] == '/' and not klasse:
                    break
                elif js[k] == chr(10):
                    return None, 'unbeendeter regulaerer Ausdruck in Zeile %d' % zeile
                k += 1
            if k >= n:
                return None, 'unbeendeter regulaerer Ausdruck ab Zeile %d' % zeile
            i = k + 1
            wert = True
            continue
        if c in tiefe:
            tiefe[c] += 1
            wert = False
            i += 1
            continue
        if c in passt:
            # Endet hier ein ${...}? Dann zurueck in die Vorlage, OHNE zu zaehlen.
            if c == '}' and len(stapel) > 1 and stapel[-1][1] is not None \
                    and tiefe['{'] == stapel[-1][1]:
                stapel.pop()
                wert = True
                i += 1
                continue
            tiefe[passt[c]] -= 1
            if tiefe[passt[c]] < 0:
                return None, 'eine schliessende %s zu viel, Zeile %d' % (c, zeile)
            wert = True
            i += 1
            continue
        if c.isalnum() or c in '_$':
            wert = True
        elif not c.isspace():
            wert = False
        i += 1

    if len(stapel) != 1:
        return None, 'unbeendete Vorlage oder Einsetzung ab Zeile %d' % zeile
    unwucht = [k for k in tiefe if tiefe[k] != 0]
    if unwucht:
        return None, ('nicht ausgeglichen: '
                      + ', '.join('%s um %+d' % (k, tiefe[k]) for k in unwucht))
    return True, 'Klammern ausgeglichen'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true',
                    help='nur pruefen, ob index.html dem Bau entspricht')
    a = ap.parse_args()

    built = build()
    names = [os.path.basename(p) for p in pieces()]

    if a.check:
        if not os.path.exists(OUT):
            print('index.html gibt es nicht', file=sys.stderr)
            return 1
        with io.open(OUT, encoding='utf-8', newline='') as f:
            have = f.read()
        if have == built:
            print('gleich: %d Zeichen aus %d Dateien' % (len(built), len(names)))
            return 0
        # Wo genau geht es auseinander? Eine Zahl allein hilft beim Suchen nicht.
        n = min(len(have), len(built))
        i = next((k for k in range(n) if have[k] != built[k]), n)
        zeile = have[:i].count('\n') + 1
        print('UNTERSCHIED ab Zeichen %d (Zeile %d): index.html %d Zeichen, Bau %d'
              % (i, zeile, len(have), len(built)), file=sys.stderr)
        print('  index.html: %r' % have[i:i + 60], file=sys.stderr)
        print('  Bau       : %r' % built[i:i + 60], file=sys.stderr)
        return 1

    fehlend = check_refs(built)
    dictfehler = check_dict(built)
    ins_leere = check_ids(built)

    with io.open(OUT, 'w', encoding='utf-8', newline='') as f:
        f.write(built)
    print('index.html gebaut: %d Zeichen aus %d Dateien' % (len(built), len(names)))
    for n in names:
        print('  ' + n)

    # Die Pruefung steht NACH dem Schreiben und bricht nicht ab: ein fehlender Verweis
    # macht die App nicht unbrauchbar, und ein Bau, der gar nichts schreibt, macht das
    # Suchen schwerer. Aber sie ist laut und gibt einen Fehlerwert zurueck - damit
    # faellt sie in einer Kette auf.
    if fehlend:
        print('', file=sys.stderr)
        print('FEHLENDE VERWEISE: %d' % len(fehlend), file=sys.stderr)
        for nr, ziel in fehlend:
            print('  Zeile %-6d %s' % (nr, ziel), file=sys.stderr)
        return 2

    if dictfehler:
        print('', file=sys.stderr)
        print('WOERTERBUCH KAPUTT: %d Stellen' % len(dictfehler), file=sys.stderr)
        for nr, warum, text in dictfehler:
            print('  Zeile %-6d %-32s %s' % (nr, warum, text), file=sys.stderr)
        print('  Eine Waise ist ein SyntaxError: die IIFE bricht ab, OMEGA_TEST fehlt,'
              ' und der Selbsttest kann nichts melden.', file=sys.stderr)
        return 2
    if ins_leere:
        print('', file=sys.stderr)
        print('ZUGRIFF INS LEERE: %d ids, die es im Dokument nicht gibt'
              % len(ins_leere), file=sys.stderr)
        for i in ins_leere:
            print('  ' + i, file=sys.stderr)
        return 2


    # Klammern im gebauten JavaScript. Zuletzt, weil sie das ERGEBNIS prueft und nicht die
    # Quellen: die Dateien sind Stuecke einer IIFE und balancieren einzeln nicht.
    js_teile = re.findall(r'<script>(.*?)</script>', built, re.S)
    ok_kl, meld_kl = check_klammern(chr(10).join(js_teile), 'index.html')
    if not ok_kl:
        print('', file=sys.stderr)
        print('JAVASCRIPT-KLAMMERN: ' + meld_kl, file=sys.stderr)
        print('  Eine Klammer zu viel ist ein SyntaxError: die IIFE bricht ab,'
              ' OMEGA_TEST fehlt, und der Selbsttest zeigt NULL Zeilen statt einer roten.',
              file=sys.stderr)
        return 2
    sw_version, sw_meld = build_sw(built)
    if sw_version is None:
        print('', file=sys.stderr)
        print('SERVICE WORKER: ' + sw_meld, file=sys.stderr)
        print('  Ohne Version im Cachenamen liefert der Arbeiter nach jedem Push die ALTE'
              ' Fassung aus, und man sucht die fehlende Behebung im Code statt im Cache.',
              file=sys.stderr)
        return 2
    print('  ' + sw_meld)
    print('  Klammern geprueft: %s (%d Skriptbloecke)' % (meld_kl, len(js_teile)))
    print('  Element-ids geprueft: kein Zugriff ins Leere')
    print('  Woerterbuch geprueft: keine Waisen')
    print('  Verweise geprueft: %d lokale src/href, alle vorhanden'
          % len(local_refs(built)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
