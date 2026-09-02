# -*- coding: utf-8 -*-
"""Druckmuster erzeugen: Boxengasse, und Probemuster zum Knacken der Kodierung.

    python tools/make_patterns.py            alle Muster nach ./
    python tools/make_patterns.py --nur box  nur die Boxengasse

Woher die Muster kommen
=======================

Carrera Hybrid ist eine Kooperation von Carrera und Sturmkind, urspruenglich MODIPLAY, von
denselben Leuten, die DR!FT gemacht haben. Ein gedrucktes DR!FT-Muster funktioniert
nachgewiesen fuer beide Fahrzeugfamilien. Die Kodierung ist damit keine Carrera-Eigenheit,
sondern das aeltere DR!FT-Verfahren.

Das aendert die Richtung: nicht Muster erfinden und ausprobieren, sondern vorhandene
DR!FT-Muster lesen. Jedes davon ist ein beschriftetes Beispiel mit bekannter Bedeutung, und
ein Dutzend solcher Paare entscheidet die Regel - waehrend ein Dutzend selbst erfundener
Muster nur ein Dutzend unbekannte Zahlen liefert.

Und: die Firmware hat sich seit damals geaendert, mit unbekannter Auswirkung. Jedes
Muster-zu-Code-Paar braucht deshalb eine Datumsangabe.


Was seit v0.5 dazu bekannt ist
==============================

DIE FRUEHERE BEGRUENDUNG DIESES WERKZEUGS WAR FALSCH, und sie stand hier ueber sechzig
Zeilen lang. Sie lautete: dasselbe Blatt meldet 0x0a und unsere treue Kopie 0x03, die
Zeichnung ist nachweislich identisch, also liegt der Unterschied im DRUCK - Massstab,
Strichbreite, Schwaerze, Papier. Daraus folgten die acht Probemuster, die Vorlaufreihe und
die drei Boxengassen-Nummern.

Der Unterschied lag am MODUS. Ausdruck-Modus (Byte 14 Bit 7) und Bahn-Modus (Byte 14 Bit 5)
haben VERSCHIEDENE Codetabellen:

    Bahn-Modus                          Ausdruck-Modus
      0x02 Gerade                         0x01 Start/Ziel
      0x03 Linkskurve
      0x04 Rechtskurve
      0x05 / 0x06 Haarnadel
      0x0a Start/Ziel
      0x00 abseits der Bahn

Das gedruckte Start/Ziel-Blatt meldet im Ausdruck-Modus 0x01 und wird also gelesen. Die drei
frueheren Zahlen kamen aus verschiedenen Modi und waren nie ein Widerspruch.

Damit sind zwei Fragen dieses Werkzeugs BEANTWORTET statt offen, und zwar am Auto gemessen:

  - Die drei fuehrenden duennen Striche lassen sich abschneiden, das Blatt wird weiter
    gelesen. Der Vorlauf ist kein Nutzdatum. Die fuenf Vorlaufblaetter haben ihre Frage
    beantwortet.
  - Eines der beiden wiederholten Muster genuegt. Die kleinste tragende Nutzlast ist ein Wort
    ohne Vorlauf, etwa 54 mm.
  - Nach einem Erkennen bleibt der Leser etwa eine Sekunde stumm.

Offen bleibt allein die Kodierregel, also welche Balkenfolge welche Zahl ergibt. Dafuer sind
die acht Probemuster weiter da - aber der Weg ueber die Infrarot-Aufnahmen der ECHTEN
Streckenteile ist besser, weil dort Wort und Bedeutung beide bekannt sind. Ein selbst
erfundenes Muster liefert eine unbekannte Zahl; ein abgelesenes Bahnmuster liefert ein Paar.

Die erzeugten SVG liegen deshalb seit v0.5 NICHT mehr im Repo. Dieses Werkzeug erzeugt sie
auf Zuruf wieder; ausgeliefert wird nur startziel-a4.svg.

Was die Boxengasse betrifft: ihr altes Muster hatte NEUN GLEICH DICKE Balken (4,00 mm) und
nur unterschiedliche Luecken, dazu ein anderes Modulmass als das Original. Zwei unabhaengige
Gruende, warum ein Leser damit nicht synchronisiert, und beide werden hier behoben, indem das
Modulmass des Originals uebernommen wird. Die WAHL der Nummer 14 stand dagegen auf der
Katalognummern-Vermutung, die mit der falschen Diagnose zusammen faellt - sie ist geraten und
wird hier nicht mehr als begruendet ausgegeben.

Die Probemuster
===============

Jedes aendert GENAU EINEN Faktor gegen das bekannte Muster, damit aus einer Fahrt darueber
ein verwertbares Paar wird:

    p1  alles schmal                       gibt es ueberhaupt ein "leeres" Muster?
    p2  ein dicker Balken an Stelle 2      wiegt ein dicker Balken etwas, und wieviel?
    p3  eine breite Luecke an Stelle 2     wiegt eine breite Luecke etwas?
    p4  dicke Balken wie im Original,      trennt der Leser Balken und Luecken?
        aber alle Luecken schmal
    p5  Original, unveraendert             Kontrolle: kommt wieder 0x01?
    p6  Original, Reihenfolge umgedreht    haengt der Code an der Fahrtrichtung?
    p7  fuenf Balken statt neun            zaehlt die Balkenzahl mit?
    p8  dreizehn Balken statt neun         dito, in der anderen Richtung

p5 ist die wichtigste: ergibt sie im Ausdruck-Modus nicht wieder 0x01, ist die Messung selbst
nicht wiederholbar, und dann sind alle anderen Zahlen wertlos. Sie zuerst fahren.
"""

import argparse
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# ---- Modulmasse, aus target_finish.pdf ausgemessen ------------------------------------
# Sie werden uebernommen und nicht neu gewaehlt: das ist das einzige Mass, von dem belegt
# ist, dass das Auto es ueberhaupt liest (es meldet 0x03, also einen gueltigen Code).
PAGE_W, PAGE_H = 297.01, 210.02   # mm, A4 quer, wie im Original
BAR_X, BAR_W = 6.52, 275.93       # mm
FIRST_Y = 49.96                   # mm, oberer Rand des ersten Balkens
THIN, THICK = 3.60, 6.60          # Balkenhoehen
GAP_S, GAP_L = 3.51, 6.52         # Lueckenhoehen

# Das bekannte Muster, Zeichen fuer Zeichen aus dem PDF:
#   Balken  d D d d D d d d d      (d = 3,60 mm, D = 6,60 mm)
#   Luecken  l L L l L l l l       (l = 3,51 mm, L = 6,52 mm)
ORIG_BARS = 'dDddDdddd'
ORIG_GAPS = 'lLLlLlll'


def bars_svg(bars, gaps, titel, hinweis):
    """Ein A4-Querformat mit einem Balkenmuster, Pfeil und 100-mm-Kontrollmass."""
    assert len(gaps) == len(bars) - 1, 'zu %d Balken gehoeren %d Luecken' % (
        len(bars), len(bars) - 1)
    y = FIRST_Y
    rects = []
    for i, b in enumerate(bars):
        h = THICK if b == 'D' else THIN
        rects.append('    <rect x="%.3f" y="%.3f" width="%.3f" height="%.3f"/>'
                     % (BAR_X, y, BAR_W, h))
        y += h
        if i < len(gaps):
            y += GAP_L if gaps[i] == 'L' else GAP_S
    ende = y

    # Der Pfeil zeigt in die Fahrtrichtung, also quer zu den Balken, und sitzt unter dem
    # Muster wie im Original. Ohne ihn ist ein Muster ohne Richtung, und die Richtung ist
    # laut Probe p6 moeglicherweise codebestimmend.
    ax, ay = 132.5, ende + 8.0
    pfeil = ('M %.1f %.1f L %.1f %.1f L %.1f %.1f L %.1f %.1f L %.1f %.1f '
             'L %.1f %.1f L %.1f %.1f Z'
             % (ax, ay + 12, ax + 11.5, ay, ax + 23.9, ay + 12,
                ax + 17.5, ay + 12, ax + 17.5, ay + 24.7,
                ax + 6.5, ay + 24.7, ax + 6.5, ay + 12))

    # Kontrollmass: zwei Striche genau 100 mm auseinander. Damit ist der Druckmassstab
    # nachpruefbar, ohne der Druckvorschau zu glauben - und beim Original gegen Kopie war
    # genau das die erste Frage.
    ry = ende + 42
    ruler = ('    <g stroke="#000" stroke-width="0.4">'
             '<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/>'
             '<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/>'
             '<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/></g>'
             % (98.5, ry - 4, 98.5, ry + 4,
                198.5, ry - 4, 198.5, ry + 4,
                98.5, ry, 198.5, ry))

    return ('<svg xmlns="http://www.w3.org/2000/svg"\n'
            '     width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">\n'
            '  <rect width="%.2f" height="%.2f" fill="#fff"/>\n'
            '  <g fill="#000">\n%s\n'
            '    <path d="%s"/>\n'
            '  </g>\n'
            '%s\n'
            '  <text x="%.2f" y="%.2f" font-family="sans-serif" font-size="3.2"'
            ' fill="#000">100 mm Kontrollmass: nachmessen. Stimmt es nicht,'
            ' wurde skaliert gedruckt und das Muster ist ungueltig.</text>\n'
            '  <text x="8" y="%.2f" font-family="sans-serif" font-size="4.2"'
            ' fill="#000">%s</text>\n'
            '  <text x="8" y="%.2f" font-family="sans-serif" font-size="3.2"'
            ' fill="#000">%s</text>\n'
            '  <text x="8" y="%.2f" font-family="sans-serif" font-size="3.2"'
            ' fill="#000">Balken %s   Luecken %s   100 %% drucken, nicht skalieren</text>\n'
            '</svg>\n'
            % (PAGE_W, PAGE_H, PAGE_W, PAGE_H, PAGE_W, PAGE_H,
               '\n'.join(rects), pfeil, ruler,
               98.5, ry + 9,
               ry + 20, titel, ry + 26, hinweis, ry + 31, bars, gaps))


def spiegel(bars, gaps):
    """Dasselbe Muster in umgekehrter Reihenfolge."""
    return bars[::-1], gaps[::-1]


# ---- Vorlauf und Nutzlast, in FAHRTRICHTUNG -----------------------------------------
# Das bekannte Muster liest sich in Fahrtrichtung (der Pfeil zeigt zum Muster hin) als
#
#     Balken   d d d d D d d D d        Luecken   l l l L l L L l
#
# Vier fuehrende duenne Balken, dann die Nutzlast. Genau davon fehlten in der DR!FT-Fassung
# drei, und sie wurde trotzdem erkannt - also ist der Vorlauf kein Nutzdatum, sondern
# hoechstwahrscheinlich die Strecke, an der sich der Leser auf die schmale Modulbreite
# einstellt.
#
# Beides zusammengesetzt reproduziert die zwei bekannten Faelle Zeichen fuer Zeichen:
#   n = 4  ergibt ddddDddDd / lllLlLLl   (das vollstaendige Original)
#   n = 1  ergibt dDddDd    / LlLLl      (die Fassung ohne drei duenne)
NUTZ_BARS = 'DddDd'
NUTZ_GAPS = 'lLLl'


def mit_vorlauf(n):
    """Fahrtrichtung: n fuehrende duenne Balken, dann die bekannte Nutzlast.

    Die Luecke NACH dem letzten Vorlaufbalken ist breit - so steht es im Original, und so
    trennt sie den Vorlauf von der Nutzlast.
    """
    bars = 'd' * n + NUTZ_BARS
    gaps = ('l' * (n - 1) + 'L') if n > 0 else ''
    gaps += NUTZ_GAPS
    assert len(gaps) == len(bars) - 1, 'Vorlauf %d: %d Balken, %d Luecken' % (
        n, len(bars), len(gaps))
    return bars, gaps


MUSTER = {}


def fuer_id(n):
    """Balken- und Lueckenfolge fuer die Katalognummer n, nach beiden Regeln zugleich.

    n+1 Balken, der erste und der letzte dick, alle Luecken breit. Damit ist der Abstand der
    dicken Balken genau n UND die Zahl der breiten Luecken genau n - die beiden Regeln, die
    von 22 durchgerechneten Schemata als einzige das bekannte Muster erklaeren.
    """
    assert n >= 2, 'Katalognummern unter 2 sind vergeben oder unsinnig'
    bars = 'D' + 'd' * (n - 1) + 'D'
    gaps = 'L' * n
    laenge = 2 * THICK + (n - 1) * THIN + n * GAP_L
    assert laenge <= PAGE_W - 12, (
        'ID %d braucht %.1f mm und passt nicht auf A4 quer' % (n, laenge))
    return bars, gaps


# ---- Boxengasse ----------------------------------------------------------------------
# Die Katalognummer. Bekannt vergeben sind 2 Gerade, 3 Linkskurve, 4 Rechtskurve,
# 5/6 Haarnadel und 10 Start/Ziel. Unbekannt sind 1, 7, 8, 9 und alles ab 11 - dort sitzen
# die Kurven und die Schikane, die noch nie ueberfahren wurden. 14 laesst also Luft nach
# unten fuer die fehlenden Kurven und liegt trotzdem nicht so hoch, dass das Muster
# unhandlich wird: fuenfzehn Balken sind 158 mm, das Original hat 76 mm.
BOX_ID = 14
_bb, _gg = fuer_id(BOX_ID)
MUSTER['box'] = (
    'muster-boxengasse-a4.svg', _bb, _gg,
    'BOXENGASSE, Katalognummer %d (0x%02x)' % (BOX_ID, BOX_ID),
    'Gebaut nach beiden Regeln, die das bekannte Muster erklaeren: Abstand der dicken '
    'Balken = %d, Zahl der breiten Luecken = %d. Modulmass wie das Original. Wenn eine der '
    'beiden Regeln gilt, meldet das Auto 0x%02x.' % (BOX_ID, BOX_ID, BOX_ID))

# ---- Probemuster ---------------------------------------------------------------------
MUSTER['p1'] = ('muster-probe-1-a4.svg', 'ddddddddd', 'llllllll',
                'PROBE 1: alles schmal',
                'Frage: gibt es ueberhaupt einen Code fuer ein Muster ohne dicke Elemente?')
MUSTER['p2'] = ('muster-probe-2-a4.svg', 'dDddddddd', 'llllllll',
                'PROBE 2: ein dicker Balken an Stelle 2',
                'Frage: wieviel wiegt ein einzelner dicker Balken?')
MUSTER['p3'] = ('muster-probe-3-a4.svg', 'ddddddddd', 'lLllllll',
                'PROBE 3: eine breite Luecke an Stelle 2',
                'Frage: wiegt eine breite Luecke dasselbe wie ein dicker Balken?')
MUSTER['p4'] = ('muster-probe-4-a4.svg', ORIG_BARS, 'llllllll',
                'PROBE 4: Balken wie das bekannte Muster, alle Luecken schmal',
                'Frage: liest der Leser Balken und Luecken getrennt?')
MUSTER['p5'] = ('muster-probe-5-a4.svg', ORIG_BARS, ORIG_GAPS,
                'PROBE 5: KONTROLLE, das bekannte Muster unveraendert',
                'Erwartet wird 0x03. Kommt etwas anderes, ist die Messung nicht '
                'wiederholbar und alle anderen Proben sind wertlos. Diese zuerst fahren.')
_b, _g = spiegel(ORIG_BARS, ORIG_GAPS)
MUSTER['p6'] = ('muster-probe-6-a4.svg', _b, _g,
                'PROBE 6: das bekannte Muster, Reihenfolge umgedreht',
                'Frage: haengt der Code an der Fahrtrichtung? Wenn ja, muss der Pfeil '
                'auf jedem Blatt stimmen.')
MUSTER['p7'] = ('muster-probe-7-a4.svg', 'dDddD', 'lLLl',
                'PROBE 7: fuenf Balken statt neun',
                'Frage: zaehlt die Zahl der Balken mit, oder nur ihr Muster?')
MUSTER['p8'] = ('muster-probe-8-a4.svg', 'dDddDddddDddd', 'lLLlLlllLlll',
                'PROBE 8: dreizehn Balken statt neun',
                'Wie Probe 7, in der anderen Richtung.')

# ---- Vorlauf-Proben ------------------------------------------------------------------
# Dieselbe Nutzlast, verschieden lange Vorlaeufe. Melden alle denselben Code, ist der Vorlauf
# kein Nutzdatum; die kuerzeste noch gelesene Fassung sagt, wieviel Vorlauf der Leser braucht.
#
# v4 ist das vollstaendige Original und damit die Kontrolle: es MUSS wieder 0x03 ergeben.
# v1 ist die DR!FT-Fassung, von der berichtet ist, dass sie funktionierte.
for _n in (0, 1, 2, 4, 8):
    _b, _g = mit_vorlauf(_n)
    # In Fahrtrichtung gebaut, aber das Blatt wird von oben nach unten gezeichnet und von
    # unten nach oben ueberfahren - also gespiegelt ausgeben.
    _bo, _go = spiegel(_b, _g)
    _titel = 'VORLAUF %d: %d fuehrende duenne Balken' % (_n, _n)
    if _n == 4:
        _hinweis = ('Das vollstaendige Original, Kontrolle. Muss wieder 0x03 ergeben - '
                    'sonst ist die Messung nicht wiederholbar.')
    elif _n == 1:
        _hinweis = ('Die Fassung, von der berichtet ist, dass sie funktionierte: drei '
                    'fuehrende duenne Balken fehlen gegenueber dem Original.')
    else:
        _hinweis = ('Frage: reicht dieser Vorlauf? Melden alle Vorlauf-Blaetter denselben '
                    'Code, ist der Vorlauf kein Nutzdatum.')
    MUSTER['v%d' % _n] = ('muster-vorlauf-%d-a4.svg' % _n, _bo, _go, _titel, _hinweis)

# Zwei Ausweichnummern. Eine Fahrt kann damit drei Kandidaten pruefen statt einen, und jeder
# ist ein moeglicher Endstand und kein blosser Versuch.
for _n in (18, 22):
    _b2, _g2 = fuer_id(_n)
    MUSTER['box%d' % _n] = (
        'muster-boxengasse-%d-a4.svg' % _n, _b2, _g2,
        'BOXENGASSE, Katalognummer %d (0x%02x)' % (_n, _n),
        'Ausweichnummer, falls %d schon vergeben ist. Gleiche Bauart.' % BOX_ID)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--nur', nargs='*', default=None,
                    help='nur diese Muster, z. B. --nur box p5')
    ap.add_argument('--out', default=REPO, help='Zielordner (Vorgabe: Repo-Wurzel)')
    a = ap.parse_args()

    namen = a.nur or list(MUSTER)
    fehlend = [n for n in namen if n not in MUSTER]
    assert not fehlend, 'unbekannt: %s (bekannt: %s)' % (', '.join(fehlend),
                                                         ', '.join(MUSTER))
    for n in namen:
        datei, bars, gaps, titel, hinweis = MUSTER[n]
        svg = bars_svg(bars, gaps, titel, hinweis)
        p = os.path.join(a.out, datei)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(svg)
        laenge = sum(THICK if b == 'D' else THIN for b in bars) \
            + sum(GAP_L if g == 'L' else GAP_S for g in gaps)
        print('%-28s %2d Balken  %s / %s  Laenge %.2f mm'
              % (datei, len(bars), bars, gaps, laenge))


if __name__ == '__main__':
    main()
