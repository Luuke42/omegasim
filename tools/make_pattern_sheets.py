#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Streifenmuster zum Auslegen: eine Gerade und eine 60-Grad-Rechtskurve, ohne
Strichcode-Anspruch, randlos bis zum Blattrand gedruckt.

    python tools/make_pattern_sheets.py

BESTELLT (Verlauf): "ausdrucke für geraden und kurven machen nur mit kachelmuster, ohne
strichcodes experimentell" -> nach Ansicht von fünf Infrarot-Fotos (app_screenshots/)
und einer Referenzzeichnung des Nutzers verworfen zugunsten von: "DIN A4 Blatt
horizontal. Dann gilt, die Trapeze sind oben ~5mm und unten ~20mm breit. Die weißen
Lücken sollen genau dieselben Maße nur eben kopfüber haben." Zuletzt: "now make it so
they run to the border of the pages" / "the curve also needs the trapecoids" - beide
Blaetter randlos, die Kurve mit dergleichen direkt vorgegebenen Innen-/Aussenbreite wie
die Gerade oben/unten, statt einer aus dem Radienverhaeltnis berechneten.

WARUM EIN EIGENES SKRIPT UND NICHT tools/make_track_sheets.py ERWEITERT
========================================================================

Jenes Skript behauptet Maschinenlesbarkeit - ein Strichcode-Wort je Kachelart -, und
genau das ist dort ein bekannter, dokumentierter Fehler: die Woerter der Geraden (0x02)
und der Rechtskurve (0x04) sind nicht entziffert, jedes Blatt dort traegt deshalb
notgedrungen das Wort von Start/Ziel (0x01). Dieses Skript hier gibt genau diesen
Anspruch NICHT ab: ein reines Muster zum Auslegen und Fotografieren, ohne jede
Behauptung ueber Maschinenlesbarkeit.

WARUM TRAPEZE UND KEINE PARALLELEN BALKEN
============================================

Ein erster Entwurf hier zeichnete parallele Rechtecke quer zur Fahrtrichtung - nach
CARRERA_HYBRID.md ("die Balken bedecken die ganze Kachel... in Kurven laufen sie
radial") eine vertretbare Lesart. Der Nutzer hat das anhand von fuenf eigenen
Infrarot-Fotos UND einer eigenen Referenzzeichnung korrigiert: es sind Trapeze, nicht
Rechtecke - senkrecht stehende Keile nebeneinander, oben schmal (~5mm) und unten breit
(~20mm), mit einer Luecke dazwischen, die exakt dieselbe Form kopfueber hat. Eine
genaue Herleitung der Millimeterzahlen aus den Fotos ist NICHT versucht - CARRERA_
HYBRID.md dokumentiert einen bereits gemachten, gescheiterten Versuch genau dazu
(31.08., Fluchtpunkt-Fit-Restabstand 237-579 px statt weniger) und rät zu einem
Flachbett-Scan statt eines weiteren Fotoversuchs. Die Zahlen 5/20 mm sind daher eine
grobe Ausseneinschaetzung, direkt uebernommen, keine Messung.

RANDLOS: das Muster fuellt die ganze A4-Seite, keine Kalibrier-/Beschriftungsraender
mehr (BESTELLT: "make it so they run to the border of the pages") - Kontrollmass und
Beschriftung stehen nur noch als Kommentar im SVG-Kopf, nicht mehr auf der Seite.

WARUM JETZT DOCH EIN STRICHCODE-BAND, ZUSAETZLICH ZU DEN TRAPEZEN
====================================================================

BESTELLT: "Ausdruck zum runden zaehlen klappt nicht mehr, wieder so machen wie vorher (da hat
mir jemand falsches feedback gegeben)."

Der Fehler steckt nicht in den Trapezen, sondern darin, dass DIESES Skript hier - anders als
tools/make_track_sheets.py - nie ein Strichcode-Wort auf das Blatt gebracht hat, ausdruecklich
("KEIN STRICHCODE-ANSPRUCH", siehe oben und der Modultitel). Was vorher die Rundenzaehlung
angetrieben hat, war ein Nebeneffekt eines bekannten, dort dokumentierten Fehlers: weil die
Woerter der Geraden (0x02) und der Rechtskurve (0x04) nie entziffert sind, tragen ALLE Bogen
aus jenem Skript notgedrungen das Wort von Start/Ziel - und genau das setzt am Auto die
Start/Ziel-Sperre (ZIEL_SPERRE_BIT, Byte 15 Bit 3, siehe zielSperreFlanke() in src/70-race.js):
das Auto setzt dieses Bit SELBST, sobald sein Sensor optisch ein Startmuster liest, unabhaengig
vom gemeldeten Kachelcode. Eine zusammengeklebte Ausdruck-Schleife aus lauter Start/Ziel-
Mustern loest also auf jeder Kachel eine steigende Flanke aus, und die ist es, die die Runde
zaehlt (carRaceNotify() bevorzugt sie ausdruecklich vor dem Code-Rueckfall). Der Rat, den
Strichcode wegzulassen, weil er "nur experimentell" und ohne Anspruch auf Maschinenlesbarkeit
sei, war das falsche Feedback aus der Bestellung oben: der Strichcode war nie nur eine
Behauptung ueber Maschinenlesbarkeit, die man folgenlos fallen lassen konnte - er war die
einzige Quelle der Rundenzaehlung im Ausdruck-Modus.

Deshalb bekommt jede Kachel hier jetzt ZUSAETZLICH ein kleines Strichcode-Band mit demselben
Start/Ziel-Wort wie make_track_sheets.py - zurueckgelesen aus derselben Quelle
(startziel-a4.svg) ueber dessen eigene muster()/kleinstes_wort(), nicht neu erfunden oder
abgetippt. Das Band sitzt an einem Rand der Kachel (oben bei der Geraden, am Anfang des
Sektors bei der Kurve) und deckt trotzdem die VOLLE Bahnbreite/den vollen Radiusbereich ab -
der Sensor sitzt mittig unter dem Auto und braucht die volle Breite nicht, aber welche Breite
er tatsaechlich sieht, ist nicht vermessen, und ein Band ueber die volle Breite kostet nichts.
Die Trapezflaeche bleibt in Form und Aufteilung unveraendert, nur ihr Bewegungs-/Winkelbereich
schrumpft um das Band - REVERTIERT wird an den Trapezen nichts.
"""
import io
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import make_track_sheets as mts  # liefert muster()/kleinstes_wort()/laenge(), siehe oben

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

W, H = 297.01, 210.02   # A4 quer


def kopf(kommentar):
    return ('<svg xmlns="http://www.w3.org/2000/svg"\n'
            '     width="%.2fmm" height="%.2fmm" viewBox="0 0 %.2f %.2f">\n'
            '  <!--\n%s\n  -->\n'
            '  <rect x="0" y="0" width="%.2f" height="%.2f" fill="#ffffff"/>\n'
            % (W, H, W, H, kommentar, W, H))


# ---- Strichcode-Band (Start/Ziel-Wort), siehe Modulkopf: das ist der Nachtrag, der die
# Rundenzaehlung im Ausdruck-Modus wiederherstellt. -----------------------------------
def strichcode_band_laenge(wort, m):
    """Bandhoehe/-winkel fuer EIN Wort plus etwas Luft, damit ein Schnitt/Uebergang nicht
    ausgerechnet mitten im einzigen Repeat landet. Ein Repeat genuegt, weil das Band immer
    bei Phase 0 anfaengt (siehe balkenband()/balkenring()) - das erste Wort ist also immer
    vollstaendig."""
    return mts.laenge(wort, m) + 6.0


def balkenband(wort, m, x0, breite, y0, y1):
    """Das Start/Ziel-Wort fortlaufend wiederholt zwischen y0 und y1, ueber die volle
    Breite [x0, x0+breite]. Dieselbe Balkenschleife wie bogen_gerade() in
    make_track_sheets.py, nur auf ein festes Band statt auf die ganze Seite beschraenkt -
    das Wort selbst kommt von dort (mts.muster()/mts.kleinstes_wort()), nicht abgetippt."""
    out = []
    y = y0
    while y < y1:
        yy = y
        for i, c in enumerate(wort['bars']):
            h = m['thick'] if c == 'D' else m['thin']
            if yy + h > y0 and yy < y1:
                oben_ = max(y0, yy)
                unten_ = min(y1, yy + h)
                if unten_ > oben_:
                    out.append('    <rect x="%.3f" y="%.3f" width="%.3f" height="%.3f"/>\n'
                               % (x0, oben_, breite, unten_ - oben_))
            yy += h
            if i < len(wort['gaps']):
                yy += m['gap_l'] if wort['gaps'][i] == 'L' else m['gap_s']
        y += mts.laenge(wort, m)
    return ''.join(out)


def balkenring(wort, m, kart, ri, ra, radius_mid, a0, a1):
    """Radiale Entsprechung zu balkenband(): dasselbe Wort, konstante Bogenlaenge auf dem
    Mittelradius radius_mid = (ri+ra)/2 DIESES Blattes (nicht auf dem echten 370-mm-Radius
    der Bahn) - Version A zeichnet ohnehin einen anderen, seiten-passenden Radius als
    Version B, und die SVG-Einheiten sind trotzdem echte Millimeter: konstante Bogenlaenge
    auf dem jeweils EIGENEN Mittelradius haelt die Balkenlaenge auf JEDEM Blatt fuer sich
    genommen richtig. kart(r, winkel_deg) kommt aus kachel_kurve() und legt Mittelpunkt und
    Winkelrichtung fest - hier nicht verdoppelt, nur wiederverwendet. Das Band beginnt immer
    bei a0 mit Phase 0, dieselbe Begruendung wie in balkenband()."""
    out = []
    s_ende = math.radians(a1 - a0) * radius_mid
    s = 0.0
    lw = mts.laenge(wort, m)
    while s < s_ende:
        ss = s
        for i, c in enumerate(wort['bars']):
            hb = m['thick'] if c == 'D' else m['thin']
            b0, b1 = ss, ss + hb
            if b1 > 0 and b0 < s_ende:
                w0 = a0 + math.degrees(max(b0, 0.0) / radius_mid)
                w1 = a0 + math.degrees(min(b1, s_ende) / radius_mid)
                p1, p2 = kart(ri, w0), kart(ri, w1)
                p3, p4 = kart(ra, w1), kart(ra, w0)
                out.append('    <path d="M %.3f %.3f L %.3f %.3f L %.3f %.3f L %.3f %.3f Z"/>\n'
                           % (p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]))
            ss += hb
            if i < len(wort['gaps']):
                ss += m['gap_l'] if wort['gaps'][i] == 'L' else m['gap_s']
        s += lw
    return ''.join(out)


# ---- 1. Gerade, senkrechte Trapez-Balken, randlos bis zum Blattrand -----------------
def kachel_gerade(wort, m, oben_mm=5.0, unten_mm=20.0):
    """N senkrechte Trapeze nebeneinander, jedes von oben_mm (Blattoberkante) auf
    unten_mm (Blattunterkante) verbreitert, ueber die GANZE Seitenbreite und -hoehe -
    randlos, keine Kalibrierraender mehr. Balken+Luecke ist bei jeder Hoehe konstant
    (oben_mm + unten_mm) - deshalb ist die Luecke von selbst dieselbe Form kopfueber,
    ohne separat gezeichnet zu sein. Eine ERFUNDENE Folge: das echte Wort der Geraden
    (Byte 12 = 0x02) ist nicht entziffert (CARRERA_HYBRID.md)."""
    periode = oben_mm + unten_mm
    n = max(2, round(W / periode))
    breite_ist = n * periode
    x0 = (W - breite_ist) / 2

    # Strichcode-Band an der Blattoberkante, ueber die volle Breite (siehe Modulkopf: der
    # Sensor braucht die volle Bahnbreite nicht, ein volles Band kostet aber nichts und
    # macht die genaue Sensorposition irrelevant). Die Trapeze ruecken dafuer nach unten -
    # ihre Form bleibt gleich, nur ihr oberes Ende liegt jetzt bei code_h statt bei 0.
    lw = mts.laenge(wort, m)
    code_h = strichcode_band_laenge(wort, m)

    komm = ('    GERADE, SENKRECHTE TRAPEZ-BALKEN + STRICHCODE-BAND. A4 QUER,\n'
            '    1 SVG-Einheit = 1 mm.\n'
            '\n'
            '    DIE TRAPEZE sind experimentell, zum Auslegen und Vergleichen mit einer\n'
            '    Infrarot-Aufnahme der echten Bahn: %d Stueck nebeneinander, randlos bis\n'
            '    zum linken/rechten Blattrand, jedes oben %.0f mm und unten %.0f mm\n'
            '    breit - eine ERFUNDENE Folge, das echte Wort der Geraden (Byte 12 =\n'
            '    0x02) ist nicht entziffert (CARRERA_HYBRID.md, gescheiterter\n'
            '    Messversuch vom 31.08.). Balken + Luecke ist bei jeder Hoehe konstant\n'
            '    %.0f mm, die Luecke ist deshalb von selbst dieselbe Form kopfueber.\n'
            '\n'
            '    DAS STRICHCODE-BAND oben (%.1f mm hoch, volle Breite) traegt das\n'
            '    Start/Ziel-Wort aus make_track_sheets.py/startziel-a4.svg (Balken %s,\n'
            '    Luecken %s, %.2f mm lang) - NACHGETRAGEN, weil genau dieser Code am Auto\n'
            '    die Start/Ziel-Sperre setzt (ZIEL_SPERRE_BIT, Byte 15 Bit 3), und die\n'
            '    treibt die Rundenzaehlung im Ausdruck-Modus an. Ohne ihn zaehlt eine\n'
            '    zusammengeklebte Ausdruck-Schleife keine Runde mehr - genau das war der\n'
            '    gemeldete Fehler ("Ausdruck zum runden zaehlen klappt nicht mehr").\n'
            '\n'
            '    DRUCKEN: 100 %% / "Tatsaechliche Groesse", NICHT "an Seite anpassen".\n'
            '    Randlos: ein Drucker ohne echten Randlos-Druck schneidet aussen etwas ab.'
            % (n, oben_mm, unten_mm, periode, code_h, wort['bars'], wort['gaps'], lw))

    teile = [kopf(komm), '  <g fill="#000000">\n']
    teile.append(balkenband(wort, m, 0.0, W, 0.0, code_h))
    for k in range(n):
        mitte = x0 + (k + 0.5) * periode
        to, tu = mitte - oben_mm / 2, mitte + oben_mm / 2
        bo, bu = mitte - unten_mm / 2, mitte + unten_mm / 2
        teile.append('    <path d="M %.3f %.3f L %.3f %.3f L %.3f %.3f L %.3f %.3f Z"/>\n'
                     % (to, code_h, tu, code_h, bu, H, bo, H))
    teile.append('  </g>\n')
    teile.append('</svg>\n')
    return ''.join(teile), n


# ---- 2. 60-Grad-Rechtskurve, radiale Trapez-Keile, randlos --------------------------
def kurve_radien_randlos(grad_gesamt=60.0):
    """Version A: ra = W (die Sehne des Sektors beruehrt beide Seitenraender), ri so
    gewaehlt, dass die Innenkante ebenfalls die Blattoberkante beruehrt - der Sektor
    fuellt die ganze Seite, ohne ueber sie hinauszugehen."""
    halb = math.radians(grad_gesamt / 2.0)
    ra = W / 2.0 / math.sin(halb)
    ri = (ra - H) / math.cos(halb)
    return ri, ra


def kachel_kurve(wort, m, ri, ra, innen_mm=5.0, aussen_mm=20.0, grad_gesamt=60.0,
                 versionshinweis=''):
    """JEDER KEIL EIN TRAPEZ MIT UNABHAENGIG VORGEGEBENER INNEN-/AUSSENBREITE (nicht ein
    Kreissektor bei konstantem Winkel wie in einer Vorfassung): ring_sektor()s konstanter
    Winkel haette Innen- und Aussenbreite nicht unabhaengig treffen koennen, weil ihr
    Verhaeltnis vom Radienverhaeltnis abhaengt. Hier werden Innen- und Aussenbreite
    UNABHAENGIG als Winkel eingesetzt (Sehne statt Bogen an der Innen-/Aussenkante) -
    dieselben zwei Zahlen wie bei der Geraden (5/20 mm), nur radial statt geradlinig.

    ri/ra werden von aussen vorgegeben (siehe kurve_radien_randlos() fuer die randlos
    passende Fassung, und main() fuer die echte, ueberstehende Fassung B).

    wort/m sind das Start/Ziel-Wort aus make_track_sheets.py (siehe Modulkopf): ein
    Winkelbereich am Anfang des Sektors bekommt statt Trapezen ein Strichcode-Band davon -
    die Trapeze fuellen den Rest des Sektors, ihre Form ist unveraendert."""
    halb_deg = grad_gesamt / 2.0

    cx = W / 2.0
    cy = H - ra   # Aussenkante (Winkel 90 Grad, gerade nach unten) beruehrt y=H (Fassung A) -
                  # bei groesserem ra als in kurve_radien_randlos() liegt y=H dann NICHT mehr
                  # auf der Aussenkante, sondern mittendrin: das Blatt zeigt nur einen
                  # Ausschnitt, der Rest ist wie vorgesehen abgeschnitten.

    # winkel_deg=0 zeigt hier gerade nach unten (+90 Grad im math. Standardwinkel) -
    # dieselbe Konvention wie ring_sektor()/bogen_kurve() in make_track_sheets.py.
    def kart(r, winkel_deg):
        a = math.radians(90.0 + winkel_deg)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    # Strichcode-Zone: von -halb_deg bis -halb_deg+code_deg, ueber die volle Radialbreite
    # ri..ra. radius_mid ist der Mittelradius DIESES Blattes (siehe balkenring()), nicht der
    # echte 370-mm-Bahnradius - Fassung A zeichnet ohnehin einen anderen, seiten-passenden
    # Radius als Fassung B.
    radius_mid = (ri + ra) / 2.0
    code_deg = math.degrees(strichcode_band_laenge(wort, m) / radius_mid)
    code_deg = min(code_deg, grad_gesamt * 0.5)  # darf dem Muster nie mehr als die Haelfte nehmen
    a0_code, a1_code = -halb_deg, -halb_deg + code_deg

    theta_innen = math.degrees(innen_mm / ri)   # Winkel, bei dem die Sehne an der Innenkante = innen_mm
    theta_aussen = math.degrees(aussen_mm / ra)  # dito an der Aussenkante
    theta_periode = theta_innen + theta_aussen
    muster_grad = grad_gesamt - code_deg   # Trapeze bekommen den Sektor MINUS die Codezone
    n = max(1, int(muster_grad / theta_periode))

    komm = ('    RECHTSKURVE, 60 GRAD, RADIALE TRAPEZ-KEILE + STRICHCODE-BAND. A4 QUER,\n'
            '    1 SVG-Einheit = 1 mm. Experimentell, zum Auslegen und Vergleichen mit\n'
            '    einer Infrarot-Aufnahme.\n'
            '\n'
            '    %s'
            '    Aussenradius %.1f mm, Innenradius %.1f mm.\n'
            '\n'
            '    %d Keile ueber %.1f der %.0f Grad, jeder ein TRAPEZ mit unabhaengig\n'
            '    vorgegebener Innenbreite (%.0f mm) und Aussenbreite (%.0f mm) -\n'
            '    dieselben zwei Zahlen wie bei der Geraden (5/20 mm), grob am Foto\n'
            '    geschaetzt (CARRERA_HYBRID.md: eine genauere Herleitung ist dort\n'
            '    bereits gescheitert dokumentiert, 31.08.). Anders als ein Kreissektor\n'
            '    bei konstantem Winkel trifft das beide Breiten unabhaengig, nicht nur\n'
            '    die eine mit der anderen rechnerisch aus dem Radienverhaeltnis.\n'
            '\n'
            '    DIE VERBLEIBENDEN %.1f GRAD am Sektoranfang tragen statt Trapezen ein\n'
            '    STRICHCODE-BAND ueber die volle Radialbreite: das Start/Ziel-Wort aus\n'
            '    make_track_sheets.py/startziel-a4.svg (Balken %s, Luecken %s), mit\n'
            '    konstanter Bogenlaenge auf dem Mittelradius %.1f mm dieses Blattes -\n'
            '    NACHGETRAGEN, weil genau dieser Code am Auto die Start/Ziel-Sperre\n'
            '    setzt (ZIEL_SPERRE_BIT, Byte 15 Bit 3, src/70-race.js) und damit die\n'
            '    Rundenzaehlung im Ausdruck-Modus antreibt. Ohne ihn zaehlt eine\n'
            '    zusammengeklebte Ausdruck-Schleife keine Runde mehr.\n'
            '\n'
            '    DRUCKEN: 100 %% / "Tatsaechliche Groesse", NICHT "an Seite anpassen".'
            % (versionshinweis, ra, ri, n, muster_grad, grad_gesamt, innen_mm, aussen_mm,
               code_deg, wort['bars'], wort['gaps'], radius_mid))

    teile = [kopf(komm), '  <g fill="#000000">\n']
    teile.append(balkenring(wort, m, kart, ri, ra, radius_mid, a0_code, a1_code))
    for k in range(n):
        mitte = a1_code + (k + 0.5) * theta_periode
        ti_l, ti_r = mitte - theta_innen / 2, mitte + theta_innen / 2
        ta_l, ta_r = mitte - theta_aussen / 2, mitte + theta_aussen / 2
        p1, p2 = kart(ri, ti_l), kart(ri, ti_r)
        p3, p4 = kart(ra, ta_r), kart(ra, ta_l)
        teile.append('    <path d="M %.3f %.3f L %.3f %.3f L %.3f %.3f L %.3f %.3f Z"/>\n'
                     % (p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]))
    teile.append('  </g>\n')
    teile.append('</svg>\n')
    return ''.join(teile), n


def main():
    # Das Start/Ziel-Wort, EINMAL aus startziel-a4.svg gelesen und an alle drei Blaetter
    # weitergereicht (siehe Modulkopf: WARUM JETZT DOCH EIN STRICHCODE-BAND).
    m = mts.muster()
    wort = mts.kleinstes_wort(m)
    print('Strichcode-Wort aus startziel-a4.svg (ueber make_track_sheets.muster()):')
    print('  Balken %s  Luecken %s  %.2f mm' % (wort['bars'], wort['gaps'], mts.laenge(wort, m)))

    svg, n = kachel_gerade(wort, m)
    print('Gerade: %d Trapeze, randlos ueber %.1f x %.1f mm' % (n, W, H))
    p = os.path.join(REPO, 'muster-gerade-a4.svg')
    io.open(p, 'w', encoding='utf-8', newline='\n').write(svg)
    print('  muster-gerade-a4.svg (%d Zeichen)' % len(svg))

    ri, ra = kurve_radien_randlos()
    svg, n = kachel_kurve(wort, m, ri, ra, versionshinweis=(
        '    Version A, randlos: Aussenradius so gewaehlt, dass die Sehne ueber den\n'
        '    vollen 60-Grad-Winkel genau die Blattbreite ergibt; Innenradius so, dass\n'
        '    die Innenkante ebenfalls die Blattoberkante beruehrt. Der Sektor fuellt\n'
        '    damit die ganze Seite, OHNE ueber sie hinauszugehen.\n'))
    print('Kurve A: %d Keile, randlos passend, Innenradius %.1f mm, Aussenradius %.1f mm'
          % (n, ri, ra))
    p = os.path.join(REPO, 'muster-kurve-60grad-a4.svg')
    io.open(p, 'w', encoding='utf-8', newline='\n').write(svg)
    print('  muster-kurve-60grad-a4.svg (%d Zeichen)' % len(svg))

    # ---- Version B: echte Groesse, bewusst ueberstehend -----------------------------
    #
    # BESTELLT: "Mach bei der Rechtskurve mit Trapezen es so, dass sie bis an den Rand
    # des Blattes gehen als Rechtskurve, 60° Version B. Ich weiß, dass sie dadurch
    # abgeschnitten werden." Kein Faktor, keine Anpassung an die Seite: der echte Radius
    # und die echte Breite aus 60-track.js (370/250 mm), unskaliert. Ein 60-Grad-Sektor
    # bei dieser Groesse ist deutlich groesser als A4 quer - das Blatt zeigt nur den
    # Ausschnitt, der hineinpasst, der Rest ist abgeschnitten, absichtlich.
    real_radius_mm, real_breite_mm = 370.0, 250.0
    ri_b, ra_b = real_radius_mm - real_breite_mm / 2, real_radius_mm + real_breite_mm / 2
    svg, n = kachel_kurve(wort, m, ri_b, ra_b, versionshinweis=(
        '    Version B, echte Groesse (Radius %.0f mm, Breite %.0f mm aus 60-track.js,\n'
        '    UNSKALIERT) - deutlich groesser als A4 quer, das Blatt zeigt nur den\n'
        '    Ausschnitt, der hineinpasst. Der Rest ist ABSICHTLICH abgeschnitten, nicht\n'
        '    verkleinert wie in Version A.\n' % (real_radius_mm, real_breite_mm)))
    print('Kurve B: %d Keile, echte Groesse (abgeschnitten), Innenradius %.1f mm, Aussenradius %.1f mm'
          % (n, ri_b, ra_b))
    p = os.path.join(REPO, 'muster-kurve-60grad-versionb-a4.svg')
    io.open(p, 'w', encoding='utf-8', newline='\n').write(svg)
    print('  muster-kurve-60grad-versionb-a4.svg (%d Zeichen)' % len(svg))


if __name__ == '__main__':
    main()
