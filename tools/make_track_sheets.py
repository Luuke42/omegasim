#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Druckvorlagen zum Auslegen: Schneidebogen, Gerade, Kurve.

    python tools/make_track_sheets.py            alle Bogen nach ./
    python tools/make_track_sheets.py --nur cut  nur den Schneidebogen

WORAUS DIE ZAHLEN KOMMEN
========================

Alle Modulmasse stammen aus target_finish.pdf und sind nicht nachgemessen: sie kommen ueber
tools/make_pattern.py aus den Vektorkoordinaten der Original-Vorlage. Diese Datei tippt sie
nicht ab, sie liest sie aus startziel-a4.svg zurueck - eine abgetippte Zahl ist die
Gelegenheit, dass zwei Dateien dasselbe verschieden behaupten.

Die Streckenmasse kommen aus src/60-track.js und werden dort gelesen, nicht hier gewaehlt:
Kachellaenge 43 cm, Bahnbreite 25 cm, Kurvenradius 37 cm.

DIE KLEINSTE NUTZLAST
=====================

Am Auto gemessen (Benutzerbericht, 31.08.):

  - Die drei fuehrenden duennen Striche lassen sich ABSCHNEIDEN, das Blatt wird weiter
    gelesen. Der Vorlauf ist damit kein Nutzdatum.
  - EINES der beiden wiederholten Muster genuegt.
  - Nach einem Erkennen bleibt der Leser etwa eine Sekunde stumm. Bei 4 km/h
    Massstabstempo sind das 1,1 m Fahrweg.

Daraus folgt das Format. Das vollstaendige Blatt ist 75,5 mm lang; ohne die drei fuehrenden
duennen Balken und ihre Luecken bleiben rund 51 mm. Auf A4 HOCHKANT passen davon vier
uebereinander, mit Schnittlinien - ein Blatt fuer vier Marken statt eines Blattes fuer eine.

Und die 1-s-Sperre sagt, dass eine durchgehend bedruckte Bahn im AUSDRUCK-Modus verschwendet
ist: der Leser sieht die Wiederholung gar nicht. Die Gerade und die Kurve unten sind deshalb
ausdruecklich fuer den Fall gebaut, dass eine Papierbahn im BAHN-Modus gelesen wird, wo
Byte 12 fortlaufend latcht.

WAS NICHT BEKANNT IST
=====================

Nur das Wort fuer 0x01 (Start/Ziel im Ausdruck-Modus). Die Woerter fuer 0x02 (Gerade) und
0x04 (Rechtskurve) sind NICHT entziffert - der Versuch, sie aus Infrarot-Videobildern der
echten Schiene zu lesen, ist gescheitert: der Fluchtpunkt-Fit der Balkenlinien hat 237 bis
579 px Restabstand (bei echten parallelen Weltlinien waeren es wenige Pixel), und das
gemessene Dickenverhaeltnis lag bei 1,1 bis 1,7 statt der 1,83 der Vorlage. Die beiden
Breitenklassen verschwimmen im Rauschen von JPEG, Weitwinkel und Lichtfleck.

Deshalb tragen ALLE Bogen hier dasselbe Wort, naemlich das von Start/Ziel. Eine Gerade mit
dem Start/Ziel-Muster ist als Bahn nicht richtig - sie ist ein Versuchsblatt, und der
Aufdruck sagt das auch. Sobald ein Flachbett-Scan eines echten Streckenteils vorliegt, liest
tools/ verlaesslich das Wort daraus, und dann erzeugt dieselbe Datei die richtigen Bogen.
"""
import argparse
import io
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# ---- Streckenmasse, gelesen aus 60-track.js -----------------------------------------
def track_masse():
    """TRACK_TILE_CM, TRACK_WIDTH_CM und TRACK_RADIUS_CM aus der Quelle lesen.

    Gelesen und nicht abgetippt: die Werte stehen in src/60-track.js und sind dort begruendet
    (der Radius faellt aus dem Grundriss "eine Gerade plus zwei Kurven auf 37 x 86 cm"). Eine
    zweite Zahl hier waere die Gelegenheit, dass Editor und Druckvorlage verschiedene
    Strecken beschreiben.
    """
    p = os.path.join(REPO, 'src', '60-track.js')
    s = io.open(p, encoding='utf-8').read()
    m = re.search(r'TRACK_TILE_CM\s*=\s*([\d.]+)\s*,\s*TRACK_WIDTH_CM\s*=\s*([\d.]+)\s*,'
                  r'\s*TRACK_RADIUS_CM\s*=\s*([\d.]+)', s)
    if not m:
        raise SystemExit('Streckenmasse nicht in src/60-track.js gefunden')
    return float(m.group(1)) * 10, float(m.group(2)) * 10, float(m.group(3)) * 10


# ---- Das Muster, gelesen aus startziel-a4.svg ----------------------------------------
def muster():
    """Balken- und Lueckenfolge des Start/Ziel-Musters, in LESERICHTUNG.

    Zurueckgelesen aus startziel-a4.svg statt abgetippt. Das SVG ist selbst erzeugt (aus
    target_finish.pdf), also ist das die Kette ohne einen einzigen von Hand geschriebenen
    Millimeterwert.

    Leserichtung ist umgekehrt zur Zeichenreihenfolge: der Pfeil steht UNTER den Balken und
    zeigt in die Fahrtrichtung, das Auto erreicht das Muster also von unten.
    """
    p = os.path.join(REPO, 'startziel-a4.svg')
    s = io.open(p, encoding='utf-8').read()
    rects = re.findall(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/>',
                       s)
    bars = [(float(y), float(h)) for _, y, _, h in rects]
    if len(bars) != 9:
        raise SystemExit('startziel-a4.svg: %d Balken statt 9' % len(bars))
    bars.sort()
    hoehen = [h for _, h in bars]
    luecken = [bars[i + 1][0] - (bars[i][0] + bars[i][1]) for i in range(len(bars) - 1)]
    duenn, dick = min(hoehen), max(hoehen)
    kurz, lang = min(luecken), max(luecken)
    mitte_b, mitte_l = (duenn + dick) / 2, (kurz + lang) / 2
    # In Leserichtung, also umgedreht.
    b = ''.join('D' if h > mitte_b else 'd' for h in hoehen)[::-1]
    l = ''.join('L' if g > mitte_l else 'l' for g in luecken)[::-1]
    return {'bars': b, 'gaps': l, 'thin': duenn, 'thick': dick,
            'gap_s': kurz, 'gap_l': lang,
            'breite': float(rects[0][2]), 'x': float(rects[0][0])}


def kleinstes_wort(m, vorlauf_weg=3):
    """Das Muster ohne die fuehrenden duennen Balken.

    vorlauf_weg = 3, weil das am Auto gemessen ist: drei abgeschnitten, wird weiter gelesen.
    Mehr wegzunehmen ist nicht belegt und wird deshalb nicht angeboten.
    """
    b, l = m['bars'], m['gaps']
    assert all(c == 'd' for c in b[:vorlauf_weg]), \
        'die ersten %d Balken sind nicht alle duenn: %s' % (vorlauf_weg, b)
    return {'bars': b[vorlauf_weg:], 'gaps': l[vorlauf_weg:]}


def laenge(wort, m):
    lb = sum(m['thick'] if c == 'D' else m['thin'] for c in wort['bars'])
    lg = sum(m['gap_l'] if c == 'L' else m['gap_s'] for c in wort['gaps'])
    return lb + lg


# ---- SVG-Bausteine -------------------------------------------------------------------
def kopf(w, h, kommentar):
    return ('<svg xmlns="http://www.w3.org/2000/svg"\n'
            '     width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">\n'
            '  <!--\n%s\n  -->\n'
            '  <rect x="0" y="0" width="%.2f" height="%.2f" fill="#ffffff"/>\n'
            % (w, h, w, h, kommentar, w, h))


def pfeil(cx, cy, gross=1.0):
    """Ein Pfeil, der nach UNTEN zeigt: in Richtung wachsender y, also in Fahrtrichtung."""
    s = 5.0 * gross
    return ('  <path d="M %.2f %.2f L %.2f %.2f L %.2f %.2f L %.2f %.2f L %.2f %.2f '
            'L %.2f %.2f L %.2f %.2f Z" fill="#000000"/>\n'
            % (cx - s, cy - 1.6 * s, cx + s, cy - 1.6 * s, cx + s, cy - 0.2 * s,
               cx + 2 * s, cy - 0.2 * s, cx, cy + 1.6 * s,
               cx - 2 * s, cy - 0.2 * s, cx - s, cy - 0.2 * s))


def massprobe_senkrecht(x, y0):
    """100 mm in FAHRTRICHTUNG. Die Richtung ist nicht beliebig: die Modulmasse liegen
    entlang der Fahrt, und ein Drucker, der ungleich skaliert, faellt nur auf der Achse auf,
    auf der man nachmisst."""
    return ('  <g stroke="#000000" stroke-width="0.25" fill="none">\n'
            '    <path d="M %.2f %.2f h 4"/>\n'
            '    <path d="M %.2f %.2f h 4"/>\n'
            '    <path d="M %.2f %.2f v 100"/>\n'
            '  </g>\n'
            '  <text x="%.2f" y="%.2f" text-anchor="middle" transform="rotate(90 %.2f %.2f)"\n'
            '        font-family="Arial, Helvetica, sans-serif" font-size="3.0"\n'
            '        fill="#000000">100 mm senkrecht nachmessen</text>\n'
            % (x, y0, x, y0 + 100, x + 2, y0,
               x + 6, y0 + 50, x + 6, y0 + 50))


def balkenfolge(wort, m, x, y, breite, kommentar=None):
    """Ein Wort als Rechtecke, von y nach unten in Leserichtung."""
    out = []
    if kommentar:
        out.append('  <!-- %s -->\n' % kommentar)
    yy = y
    for i, c in enumerate(wort['bars']):
        h = m['thick'] if c == 'D' else m['thin']
        out.append('    <rect x="%.3f" y="%.3f" width="%.3f" height="%.3f"/>\n'
                   % (x, yy, breite, h))
        yy += h
        if i < len(wort['gaps']):
            yy += m['gap_l'] if wort['gaps'][i] == 'L' else m['gap_s']
    return ''.join(out), yy - y


# ---- 1. Schneidebogen, A4 hochkant ---------------------------------------------------
def bogen_schneiden(m, wort):
    """Soviele Marken auf ein A4-Blatt hochkant, wie hineinpassen.

    VOM BEDARF HER GERECHNET und nicht vom uebrigen Platz. Die erste Fassung liess oben und
    unten Rand und teilte den Rest auf vier Streifen - Schritt 41,25 mm bei 54,22 mm
    Wortlaenge. Jeder Streifen lief 13 mm in den naechsten, und im Bild stand ein Pfeil
    mitten in den Balken des Folgestreifens. Eine Aufteilung, die vom Rest rechnet, geht beim
    naechsten laengeren Wort wieder schief.
    """
    W, H = 210.02, 297.01
    BREITE = 176.0      # so breit wie moeglich: dass diese Breite reicht, ist gemessen
    X = 26.0            # links bleibt Platz fuer die senkrechte Massprobe
    PFEIL = 12.0        # Bauhoehe des Pfeils unter den Balken
    LUFT = 5.0          # bis zur Schnittlinie
    OBEN = 7.0
    lw = laenge(wort, m)
    schritt = lw + PFEIL + LUFT
    n = int((H - OBEN - 4.0) // schritt)
    assert n >= 2, 'nur %d Streifen - passt das Wort ueberhaupt?' % n

    komm = ('    SCHNEIDEBOGEN: %d Start/Ziel-Marken auf einem Blatt. A4 HOCHKANT,\n'
            '    1 SVG-Einheit = 1 mm.\n'
            '\n'
            '    WARUM MEHRERE AUF EIN BLATT: am Auto gemessen genuegt EIN Wort ohne\n'
            '    Vorlauf. Das vollstaendige Muster ist %.2f mm lang, ohne die drei\n'
            '    fuehrenden duennen Balken sind es %.2f mm - und davon passen %d\n'
            '    uebereinander, je Streifen %.2f mm mit Pfeil und Schnittluft.\n'
            '\n'
            '    Balken %s, Luecken %s, in Leserichtung (D = dick, L = breit).\n'
            '    Modul: duenn %.3f / dick %.3f mm, Luecke %.3f / %.3f mm, aus\n'
            '    target_finish.pdf ueber startziel-a4.svg zurueckgelesen, nicht\n'
            '    nachgemessen.\n'
            '\n'
            '    Die Balken sind %.0f mm breit statt der %.0f mm des Originals - so breit,\n'
            '    wie A4 hochkant mit Rand fuer die Massprobe zulaesst. Dass diese Breite\n'
            '    reicht, ist gemessen: der Sensor sitzt mittig unter dem Auto und braucht\n'
            '    nicht die ganze Bahnbreite.\n'
            '\n'
            '    DRUCKEN: 100 %% / "Tatsaechliche Groesse", NICHT "an Seite anpassen". Das\n'
            '    Kontrollmass steht SENKRECHT im linken Rand, also in Fahrtrichtung - dort\n'
            '    liegen die Modulmasse, und ein ungleich skalierender Drucker faellt nur auf\n'
            '    dieser Achse auf.\n'
            '\n'
            '    Der Pfeil zeigt in die Fahrtrichtung. Rueckwaerts ueberfahren ist das\n'
            '    Muster eine andere Folge und damit ein anderer Code.'
            % (n, laenge({'bars': m['bars'], 'gaps': m['gaps']}, m), lw, n, schritt,
               wort['bars'], wort['gaps'], m['thin'], m['thick'],
               m['gap_s'], m['gap_l'], BREITE, m['breite']))

    teile = [kopf(W, H, komm), '  <g fill="#000000">\n']
    for k in range(n):
        y = OBEN + k * schritt
        svg, _ = balkenfolge(wort, m, X, y, BREITE)
        teile.append(svg)
    teile.append('  </g>\n')
    for k in range(n):
        y = OBEN + k * schritt
        teile.append(pfeil(X + BREITE / 2, y + lw + 6.0, 0.62))
        if k < n - 1:
            ys = y + schritt - LUFT / 2
            teile.append('  <path d="M 4 %.2f H %.2f" stroke="#000000" stroke-width="0.2"\n'
                         '        stroke-dasharray="3 3" fill="none"/>\n' % (ys, W - 4))
    # Massprobe senkrecht im linken Rand: kostet keine Bauhoehe.
    teile.append(massprobe_senkrecht(8.0, (H - 100) / 2))
    teile.append('  <text x="%.2f" y="%.2f" text-anchor="middle"\n'
                 '        transform="rotate(-90 %.2f %.2f)"\n'
                 '        font-family="Arial, Helvetica, sans-serif" font-size="3.0"\n'
                 '        fill="#000000">Start/Ziel &#183; Ausdruck-Modus &#183; Code 0x01'
                 '</text>\n' % (W - 5.0, H / 2, W - 5.0, H / 2))
    teile.append('</svg>\n')
    return ''.join(teile)


# ---- 2. Gerade, A4 quer, zwei Blaetter je Kachel -------------------------------------
def bogen_gerade(m, wort, blatt, von_blatt, tile_mm, breite_mm):
    W, H = 297.01, 210.02
    BREITE = 277.0
    X = (W - BREITE) / 2
    lw = laenge(wort, m)
    # Wieviele Woerter passen auf die Blatthoehe, und wo faengt dieses Blatt an?
    nutz = H - 8.0
    versatz = blatt * nutz
    komm = ('    GERADE, Blatt %d von %d. A4 QUER, 1 SVG-Einheit = 1 mm.\n'
            '\n'
            '    EXPERIMENTELL, und zwar aus zwei Gruenden, die beide dazugesagt gehoeren:\n'
            '\n'
            '    1. Das Wort ist das von START/ZIEL (0x01). Das Wort der GERADEN (0x02) ist\n'
            '       nicht entziffert - der Versuch, es aus Infrarot-Videobildern der echten\n'
            '       Schiene zu lesen, ist gescheitert. Eine Bahn mit diesem Aufdruck meldet\n'
            '       also ueberall Start/Ziel und ist als Strecke falsch. Sie ist ein\n'
            '       Versuchsblatt.\n'
            '    2. Ob eine PAPIERbahn ueberhaupt wie die echte gelesen wird, haengt an der\n'
            '       Infrarot-Rueckstrahlung von Toner und Papier und ist erst am Auto\n'
            '       entschieden. Ein Blatt, das gedruckt aussieht wie die Bahn, ist noch\n'
            '       keine Bahn.\n'
            '\n'
            '    Fortlaufend wiederholtes Wort ueber die Blattgrenze hinweg: weil sich das\n'
            '    Wort wiederholt, ist eine Schnittkante mitten im Wort unschaedlich. Genau\n'
            '    das macht das Aneinanderlegen ueberhaupt moeglich.\n'
            '\n'
            '    JE BLATT %.0f mm Fahrweg, zwei also %.0f mm. Eine Kachel des Editors\n'
            '    ist %.0f mm lang - es fehlen 26 mm, und das ist kein Fehler, sondern das\n'
            '    Papierformat: mehr als 202 mm Fahrweg passen mit Rand nicht auf A4\n'
            '    quer. Weil sich das Wort wiederholt, ist es unschaedlich - man legt\n'
            '    so viele Blaetter, wie man braucht, und die Kachelgrenze liegt dort,\n'
            '    wo man sie haben will.\n'
            '\n'
            '    Bahnbreite laut Editor %.0f mm; die Balken sind %.0f mm breit, also etwas\n'
            '    breiter - Rand zum Beschneiden.\n'
            '\n'
            '    Fuer den AUSDRUCK-Modus ist diese Fassung Verschwendung: nach einem\n'
            '    Erkennen bleibt der Leser eine Sekunde stumm, das sind bei 4 km/h\n'
            '    Massstabstempo 1,1 m Fahrweg. Sie ist fuer den BAHN-Modus gebaut, wo\n'
            '    Byte 12 fortlaufend latcht.'
            % (blatt + 1, von_blatt, nutz, von_blatt * nutz, tile_mm, breite_mm,
               BREITE))
    teile = [kopf(W, H, komm), '  <g fill="#000000">\n']
    # Das Wort so oft wiederholen, dass die Blatthoehe voll ist, mit dem richtigen Versatz.
    k = int(versatz // lw)
    y = k * lw - versatz + 4.0
    while y < H - 2:
        yy = y
        for i, c in enumerate(wort['bars']):
            h = m['thick'] if c == 'D' else m['thin']
            if yy + h > 2 and yy < H - 2:
                oben_ = max(2.0, yy)
                unten_ = min(H - 2.0, yy + h)
                if unten_ > oben_:
                    teile.append('    <rect x="%.3f" y="%.3f" width="%.3f" height="%.3f"/>\n'
                                 % (X, oben_, BREITE, unten_ - oben_))
            yy += h
            if i < len(wort['gaps']):
                yy += m['gap_l'] if wort['gaps'][i] == 'L' else m['gap_s']
        y += lw
    teile.append('  </g>\n')
    # Passmarken an den beiden Kanten, an denen Blaetter zusammenstossen.
    for yy in (1.0, H - 1.0):
        teile.append('  <path d="M %.2f %.2f h 10" stroke="#000000" stroke-width="0.2"/>\n'
                     % (X - 12, yy))
        teile.append('  <path d="M %.2f %.2f h 10" stroke="#000000" stroke-width="0.2"/>\n'
                     % (X + BREITE + 2, yy))
    teile.append(massprobe_senkrecht(6.0, 55.0))
    teile.append('  <text x="%.2f" y="%.2f" text-anchor="middle"\n'
                 '        font-family="Arial, Helvetica, sans-serif" font-size="3.0"\n'
                 '        fill="#000000">Gerade, Blatt %d/%d &#183; EXPERIMENTELL, tr&#228;gt '
                 'das Start/Ziel-Wort</text>\n' % (W / 2, H - 4.0, blatt + 1, von_blatt))
    teile.append('</svg>\n')
    return ''.join(teile)


# ---- 3. Kurve, A4 quer, zwei Blaetter je Kachel --------------------------------------
def bogen_kurve(m, wort, blatt, von_blatt, radius_mm, breite_mm, grad_je_blatt):
    """Radiale Balken mit KONSTANTER BOGENLAENGE auf der Bahnmittellinie.

    Nicht konstanter Winkel, und das ist der Punkt: bei konstantem Winkel waere das
    Modulmass am aeusseren Rand groesser als am inneren, und der Sensor - der irgendwo
    zwischen beiden faehrt - laese je nach Linie eine andere Folge. Konstante Bogenlaenge auf
    der MITTELLINIE haelt das Modul dort genau richtig; nach aussen werden die Balken
    breiter, nach innen schmaler. Genau so sehen die Infrarot-Aufnahmen der echten Kurve
    auch aus.
    """
    W, H = 297.01, 210.02
    ri = radius_mm - breite_mm / 2
    ra = radius_mm + breite_mm / 2
    lw = laenge(wort, m)
    # JEDES BLATT ZEICHNET SEINEN SEKTOR IN DER BLATTMITTE, von -g/2 bis +g/2. Die erste
    # Fassung legte die Sektoren global aneinander (-15..0 und 0..+15), und dann lief Blatt 1
    # oben aus dem Blatt heraus: gemessen y = -23 mm. Der Winkel auf dem BLATT und die
    # Position im fortlaufenden Wort sind zwei verschiedene Dinge - man legt die Blaetter
    # ohnehin gedreht aneinander, das Blatt muss also nur seinen eigenen Bogen zeigen.
    a0, a1 = -grad_je_blatt / 2, grad_je_blatt / 2
    # Die Phase im Wort kommt aus der GLOBALEN Bogenlaenge dieses Blattes.
    s_offset = math.radians(blatt * grad_je_blatt) * radius_mm
    # Mittelpunkt links ausserhalb des Blattes, Sektor nach rechts offen.
    cx, cy = -ri + 14.0, H / 2
    komm = ('    KURVE, Blatt %d von %d. A4 QUER, 1 SVG-Einheit = 1 mm.\n'
            '\n'
            '    RADIALE BALKEN MIT KONSTANTER BOGENLAENGE AUF DER MITTELLINIE, nicht mit\n'
            '    konstantem Winkel. Bei konstantem Winkel waere das Modulmass am aeusseren\n'
            '    Rand groesser als am inneren, und der Sensor - der irgendwo zwischen beiden\n'
            '    faehrt - laese je nach Linie eine andere Folge. Konstante Bogenlaenge auf der\n'
            '    Mittellinie haelt das Modul dort genau richtig; nach aussen werden die\n'
            '    Balken breiter, nach innen schmaler. Genau so sehen die Infrarot-Aufnahmen\n'
            '    der echten Kurve auch aus.\n'
            '\n'
            '    Radius der Mittellinie %.0f mm, Bahnbreite %.0f mm, dieses Blatt %.0f Grad.\n'
            '    Zwei Blaetter ergeben die %.0f-Grad-Kachel des Editors.\n'
            '\n'
            '    EXPERIMENTELL, und dasselbe gilt wie fuer die Gerade: das Wort ist das von\n'
            '    START/ZIEL (0x01), weil das Wort der RECHTSKURVE (0x04) nicht entziffert\n'
            '    ist. Diese Kurve meldet also ueberall Start/Ziel.'
            % (blatt + 1, von_blatt, radius_mm, breite_mm, grad_je_blatt,
               grad_je_blatt * von_blatt))
    teile = [kopf(W, H, komm), '  <g fill="#000000">\n']
    # Bogenlaenge auf der Mittellinie, die dieses Blatt abdeckt.
    s0 = math.radians(a0) * radius_mm + s_offset
    s1 = math.radians(a1) * radius_mm + s_offset
    # Wo im fortlaufenden Wort liegt s0?
    s = math.floor(s0 / lw) * lw
    while s < s1:
        ss = s
        for i, c in enumerate(wort['bars']):
            hb = m['thick'] if c == 'D' else m['thin']
            b0, b1 = ss, ss + hb
            if b1 > s0 and b0 < s1:
                # Zurueck in BLATT-Winkel: der Versatz ist nur die Phase im Wort.
                w0 = math.degrees((max(b0, s0) - s_offset) / radius_mm)
                w1 = math.degrees((min(b1, s1) - s_offset) / radius_mm)
                teile.append('    ' + ring_sektor(cx, cy, ri, ra, w0, w1) + '\n')
            ss += hb
            if i < len(wort['gaps']):
                ss += m['gap_l'] if wort['gaps'][i] == 'L' else m['gap_s']
        s += lw
    teile.append('  </g>\n')
    teile.append('  <text x="%.2f" y="%.2f" text-anchor="middle"\n'
                 '        font-family="Arial, Helvetica, sans-serif" font-size="3.0"\n'
                 '        fill="#000000">Kurve, Blatt %d/%d &#183; EXPERIMENTELL, tr&#228;gt '
                 'das Start/Ziel-Wort</text>\n' % (W / 2, H - 4.0, blatt + 1, von_blatt))
    teile.append(massprobe_senkrecht(W - 18.0, 55.0))
    teile.append('</svg>\n')
    return ''.join(teile)


def ring_sektor(cx, cy, ri, ra, w0, w1):
    """Ein Ringsegment zwischen zwei Winkeln, als Pfad."""
    def pt(r, w):
        a = math.radians(w)
        return cx + r * math.cos(a), cy + r * math.sin(a)
    x1, y1 = pt(ra, w0)
    x2, y2 = pt(ra, w1)
    x3, y3 = pt(ri, w1)
    x4, y4 = pt(ri, w0)
    gross = 1 if (w1 - w0) > 180 else 0
    return ('<path d="M %.3f %.3f A %.3f %.3f 0 %d 1 %.3f %.3f L %.3f %.3f '
            'A %.3f %.3f 0 %d 0 %.3f %.3f Z"/>'
            % (x1, y1, ra, ra, gross, x2, y2, x3, y3, ri, ri, gross, x4, y4))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument('--nur', default=None, help='cut, gerade oder kurve')
    a = ap.parse_args()

    tile, breite, radius = track_masse()
    m = muster()
    wort = kleinstes_wort(m)
    lw = laenge(wort, m)
    voll = laenge({'bars': m['bars'], 'gaps': m['gaps']}, m)
    print('Muster aus startziel-a4.svg:')
    print('  vollstaendig  Balken %s  Luecken %s  %.2f mm' % (m['bars'], m['gaps'], voll))
    print('  ohne Vorlauf  Balken %s  Luecken %s  %.2f mm' % (wort['bars'], wort['gaps'], lw))
    print('  Modul duenn %.3f / dick %.3f mm, Luecke %.3f / %.3f mm'
          % (m['thin'], m['thick'], m['gap_s'], m['gap_l']))
    print('Streckenmasse aus 60-track.js: Kachel %.0f mm, Bahn %.0f mm, Radius %.0f mm'
          % (tile, breite, radius))

    schreiben = []
    if a.nur in (None, 'cut'):
        schreiben.append(('spur-schneidebogen-a4.svg', bogen_schneiden(m, wort)))
    if a.nur in (None, 'gerade'):
        for b in range(2):
            schreiben.append(('spur-gerade-%d-a4.svg' % (b + 1),
                              bogen_gerade(m, wort, b, 2, tile, breite)))
    if a.nur in (None, 'kurve'):
        for b in range(2):
            schreiben.append(('spur-kurve-%d-a4.svg' % (b + 1),
                              bogen_kurve(m, wort, b, 2, radius, breite, 15.0)))

    for name, svg in schreiben:
        p = os.path.join(REPO, name)
        io.open(p, 'w', encoding='utf-8', newline='\n').write(svg)
        print('  %s (%d Zeichen)' % (name, len(svg)))


if __name__ == '__main__':
    main()
