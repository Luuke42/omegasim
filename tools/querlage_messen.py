#!/usr/bin/env python3
# -*- coding: utf-8 -*-
u"""Wieviel Querversatz vertraegt die Bahn, bevor das Auto sie verliert?

DIE FRAGE, gestellt vom Nutzer: "schau in die BTSnoops, da muesstest du sehen, wie hoch der
Querlage-Byte ist, bevor der andere Byte auf 'neben Strecke' geht, also was die maximale
Breite ist, die du fuer Ueberholmanoever und Ideallinie nutzen kannst."

WAS DIE MITSCHNITTE WIRKLICH HERGEBEN, und der Unterschied ist wichtig genug, um ihn vorne
zu sagen: es gibt kein Byte, das eine Querlage MISST. Was es gibt, sind zwei Seiten
derselben Verbindung:

    Schreibbefehl (App -> Auto)   Byte 7, vorzeichenbehaftet: der ANGEFORDERTE Lenkwinkel
    Meldung       (Auto -> App)   Byte 12: der gelesene Streckencode, 0x00 heisst "kein Code"

Das ist keine Position, sondern eine Anforderung und ihre Folge. Genau daraus laesst sich
die Frage aber beantworten, und zwar besser als aus einer Positionsangabe: gesucht ist der
groesste Lenkwert, der ANHALTEND gefahren wurde, ohne dass der Streckensensor abriss.

VERFAHREN

  1. Alle Schreibbefehle und Meldungen einer Verbindung in eine gemeinsame Zeitleiste.
  2. Je Meldung: war der Sensor da (Byte 12 != 0x00) oder nicht?
  3. Je Meldung: welcher Lenkwert stand zu diesem Zeitpunkt an (der letzte geschriebene)?
  4. Daraus zwei Verteilungen - Lenkwerte MIT Code und Lenkwerte OHNE Code.

  Und die eigentliche Zahl: fuer jeden Abriss (Code -> kein Code) der Lenkwert im Fenster
  davor. Der 90er-Perzentil dieser Werte ist die Grenze, an der es kippt.

WARUM EIN FENSTER UND KEIN EINZELWERT: ein Auto verliert die Bahn nicht in dem Moment, in
dem der Stick ausschlaegt, sondern nachdem es eine Weile schraeg gefahren ist. Der Wert
genau beim Abriss ist deshalb oft schon wieder klein - man hat ja gegengelenkt.

Aufruf:  python tools/querlage_messen.py "<Ordner oder Datei>" [...]
"""
import os
import sys
import struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_btsnoop as pb


# Wie lange vor einem Abriss geschaut wird. 600 ms: bei 45 ms Sendetakt sind das gut
# dreizehn Befehle, also lange genug fuer eine Lenkbewegung und kurz genug, dass nicht die
# vorige Kurve mit hineinzaehlt.
FENSTER_MS = 600


def s8(b):
    return b - 256 if b > 127 else b


def zeitleiste(pfad):
    u"""(t_ms, art, bytes) je ATT-Paket, art in {'w','n'}."""
    try:
        recs = pb.parse_btsnoop(pfad)
    except Exception as e:
        return None, str(e)
    aus = []
    # parse_acl_stream liefert (ts, richtung, cid, att_pdu). Der ATT-Kopf ist ein Opcode und
    # ein 16-Bit-Handle, danach der Nutzwert - deshalb ab Byte 3.
    for ts, richtung, cid, att in pb.parse_acl_stream(recs):
        if cid != 0x0004 or len(att) < 4:
            continue
        op = att[0]
        val = att[3:]
        if len(val) < 16:
            continue
        t = ts / 1000.0
        if op in (0x52, 0x12):
            aus.append((t, 'w', val))
        elif op in (0x1B, 0x1D):
            aus.append((t, 'n', val))
    aus.sort(key=lambda x: x[0])
    return aus, None


# Ueber welche Zeit "anhaltend" gemittelt wird. 300 ms sind rund sieben Sendetakte.
HALT_MS = 300


def mittel_im_fenster(verlauf, t, ms):
    u"""Zeitgewichteter Mittelwert des Lenkbetrags ueber die letzten `ms`.

    ZEITGEWICHTET UND NICHT EINFACH GEMITTELT, und das ist hier der Unterschied zwischen
    einer Zahl und einem Artefakt: die Original-App lenkt BANG-BANG - gemessen ueber 23438
    Meldungen liegt der Median bei 0 und das 90er-Perzentil bei 127, also fast nur die zwei
    Endwerte. Ein Mittel ueber die PAKETE haengt dann daran, wie oft gesendet wurde; ein
    Mittel ueber die ZEIT sagt, wie schraeg das Auto wirklich stand.
    """
    summe = 0.0
    dauer = 0.0
    for k in range(len(verlauf) - 1, 0, -1):
        t1, l1 = verlauf[k]
        t0, _ = verlauf[k - 1]
        if t1 < t - ms:
            break
        a = max(t0, t - ms)
        d = t1 - a
        if d <= 0:
            continue
        summe += l1 * d
        dauer += d
    return (summe / dauer) if dauer > 0 else None


def auswerten(ereignisse):
    lenk = None
    mit, ohne = [], []
    mit_h, ohne_h = [], []
    abrisse = []
    verlauf = []            # (t, lenk) fuer das Rueckwaertsfenster
    letzter_code = None

    for t, art, v in ereignisse:
        if art == 'w':
            # Nur Steuerpakete: die anderen Schreibbefehle sind kuerzer oder tragen 0xaf nicht.
            if len(v) >= 8 and v[0] == 0xaf:
                lenk = abs(s8(v[7]))
                verlauf.append((t, lenk))
                if len(verlauf) > 4000:
                    del verlauf[:2000]
            continue

        if len(v) <= 12 or lenk is None:
            continue
        code = v[12]
        da = code != 0x00
        (mit if da else ohne).append(lenk)
        h = mittel_im_fenster(verlauf, t, HALT_MS)
        if h is not None:
            (mit_h if da else ohne_h).append(int(round(h)))

        if letzter_code is not None and letzter_code and not da:
            # Abriss. Der groesste ANHALTENDE Wert im Fenster davor - nicht der groesste
            # Einzelwert: ein einzelner Vollausschlag von 45 ms bewegt das Auto kaum.
            spitzen = []
            for k in range(len(verlauf) - 1, 0, -1):
                tt = verlauf[k][0]
                if tt < t - FENSTER_MS:
                    break
                hh = mittel_im_fenster(verlauf, tt, HALT_MS)
                if hh is not None:
                    spitzen.append(hh)
            if spitzen:
                abrisse.append(int(round(max(spitzen))))
        letzter_code = da

    return mit, ohne, abrisse, mit_h, ohne_h


def perz(xs, p):
    if not xs:
        return None
    ys = sorted(xs)
    i = int(round((len(ys) - 1) * p))
    return ys[i]


def zeig(name, xs):
    if not xs:
        print('    %-28s keine' % name)
        return
    print('    %-28s n=%-6d Median %3d   P90 %3d   P99 %3d   max %3d'
          % (name, len(xs), perz(xs, .5), perz(xs, .9), perz(xs, .99), max(xs)))


def dateien(argv):
    aus = []
    for a in argv:
        if os.path.isdir(a):
            for w, _, fs in os.walk(a):
                for f in sorted(fs):
                    if f.lower().endswith(('.cfa', '.log', '.btsnoop')):
                        aus.append(os.path.join(w, f))
        elif os.path.isfile(a):
            aus.append(a)
    return aus


def main():
    ziele = dateien(sys.argv[1:])
    if not ziele:
        print(__doc__)
        return 1
    alle_mit, alle_ohne, alle_abrisse = [], [], []
    for pfad in ziele:
        ev, fehler = zeitleiste(pfad)
        if fehler:
            print('%s: %s' % (os.path.basename(pfad), fehler))
            continue
        mit, ohne, abrisse, mit_h, ohne_h = auswerten(ev)
        if not mit and not ohne:
            continue
        print('%s  (%d Pakete)' % (os.path.basename(pfad), len(ev)))
        zeig('roh MIT Code', mit)
        zeig('anhaltend MIT Code', mit_h)
        zeig('anhaltend OHNE Code', ohne_h)
        zeig('anhaltende Spitze vor Abriss', abrisse)
        alle_mit += mit_h
        alle_ohne += ohne_h
        alle_abrisse += abrisse

    print('')
    print('ZUSAMMEN')
    zeig('anhaltend MIT Code', alle_mit)
    zeig('anhaltend OHNE Code', alle_ohne)
    zeig('anhaltende Spitze vor Abriss', alle_abrisse)
    if alle_abrisse:
        g = perz(alle_abrisse, .1)
        print('')
        print('    Das 10er-Perzentil der Abrissspitzen ist %d von 127, also %.2f.' % (g, g / 127.0))
        print('    Darunter reisst in 90 Prozent der Faelle nichts ab - das ist die Breite,')
        print('    die fuer Ideallinie und Ueberholen zu haben ist.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
