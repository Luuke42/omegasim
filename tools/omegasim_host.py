#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""OmegaSim Multiplayer, Version A: ein kleines Host-Programm fuers WLAN.

    python tools/omegasim_host.py                 Port 8080, dieses Verzeichnis
    python tools/omegasim_host.py --port 9000
    python tools/omegasim_host.py --laps 12        Rennlaenge fuer den Ueberblicksschirm
    python tools/omegasim_host.py --minutes 8      statt Runden eine Zeit

Danach:
    Auf dem PC       http://localhost:PORT/mp-overview.html   der Ueberblicksschirm
    Auf den Telefonen http://<IP-des-PC>:PORT/                die App

EXPERIMENTELL. Nicht, weil der Code wackelt, sondern weil eine Browserregel dazwischensteht,
die man verstehen muss, bevor man sie umgeht - siehe unten.


DER HARTE BEFUND, DER DEN GANZEN ENTWURF BESTIMMT
=================================================

Web Bluetooth verlangt einen SECURE CONTEXT. Das sind https://, http://localhost und -
deshalb laeuft OmegaSim von der Platte - file://.

    http://192.168.x.x IST KEINER.

Ein Host-Programm, das die App per HTTP ins WLAN liefert, kann sie also nicht so ausliefern,
dass die Telefone ihr Auto verbinden koennen. Das ist eine Browserregel und keine
Einstellungssache, und jeder Entwurf, der sie uebersieht, scheitert erst beim Verbinden -
also nachdem alles andere schon funktioniert.

ZWEI WEGE, und beide kosten eine Einrichtung je Telefon:

  1. URSPRUNG EINMALIG FREIGEBEN. In Chrome auf dem Telefon
     chrome://flags/#unsafely-treat-insecure-origin-as-secure oeffnen, dort
     http://<IP-des-PC>:PORT eintragen, Chrome neu starten. Einmal je Telefon, danach
     funktioniert alles ohne weiteres.

     Was man dabei tut: man erklaert diesem einen Ursprung fuer vertrauenswuerdig. Im
     Heim-WLAN mit einem PC, den man selbst betreibt, ist das vertretbar - aber es ist eine
     Ausnahme von einer Sicherheitsregel, und deshalb steht sie hier ausgeschrieben und
     nicht als Klickanleitung.

  2. EIGENE ZERTIFIZIERUNGSSTELLE. Eine CA erzeugen, sie auf jedem Telefon installieren, der
     Host liefert ueber https://. Aufwendiger einzurichten, danach ohne Flag. Dieses Programm
     macht das NICHT: openssl-Aufrufe und Zertifikatsverwaltung waeren mehr Code als der
     ganze Rest, und ein halb funktionierender Zertifikatspfad ist schlimmer als eine klare
     Anleitung.

DER UEBERBLICKSSCHIRM BRAUCHT NICHTS DAVON. Er laeuft auf http://localhost, ist damit ein
secure context, und er braucht ohnehin kein Bluetooth. Dieser Teil funktioniert ohne
Vorbehalt - er ist der Teil, der sofort trägt.


WARUM HTTP UND KEIN WEBSOCKET
=============================

Der erste Entwurf hatte einen handgeschriebenen WebSocket: Handshake mit SHA-1 und Base64,
dann Rahmen zerlegen. Das sind gut sechzig Zeilen, und jede davon kann ein Rahmenfehler sein,
der sich als "haengt manchmal" zeigt.

Gebraucht wird das nicht. Uebertragen werden Rundenzeiten, Rundenzahl und Position - eine
Rangliste. Sie aendert sich, wenn jemand eine Runde faehrt, also alle paar Sekunden. Zweimal
je Sekunde abzufragen ist dafuer reichlich und kostet bei vier Telefonen acht Anfragen je
Sekunde. Ein WebSocket waere hier Technik ohne Anlass.

Und ein Nebeneffekt, der wichtiger ist als die Ersparnis: eine abgerissene HTTP-Anfrage ist
ein Fehler in EINER Abfrage. Ein abgerissener WebSocket ist ein Zustand, den man wieder
aufbauen muss - und im WLAN unter einem Tisch mit vier Telefonen reisst er ab.


WAS DER HOST NICHT MACHT
========================

Er rechnet KEINE Physik und haelt KEINE Bluetooth-Verbindung. Jedes Telefon hat seine eigene
Verbindung zu seinem Auto und rechnet seine eigene Physik - das funktioniert nachgewiesen,
und es hat die Eigenschaft, die im Wohnzimmer zaehlt: reisst das WLAN ab, faehrt jeder
weiter. Nur die Rangliste steht dann still.

Ein Host, der alle Autos selbst verbindet, waere die andere Bauform. Sie braucht bleak und
eine zweite Physik in Python, und sie faellt komplett aus, wenn der PC hustet.
"""
import argparse
import http.server
import json
import os
import socket
import socketserver
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# ---- Der Zustand, den alle sehen -----------------------------------------------------
#
# EIN Schloss um alles. Der Zustand ist klein (ein Dict je Fahrer), und ein feineres
# Sperrschema waere hier mehr Fehlerquelle als Gewinn: die Anfragen dauern Mikrosekunden.
_lock = threading.Lock()
_fahrer = {}            # id -> {name, laps, letzte, beste, aktualisiert, abgaenge}
_rennen = {'start': None, 'laps': None, 'minutes': None}


def _jetzt():
    return time.time()


def zustand_lesen():
    """Die Rangliste, sortiert - und die Sortierung ist die eigentliche Entscheidung.

    Gewertet wird zuerst nach RUNDENZAHL und dann nach der Zeit der letzten Ueberfahrt: wer
    mehr Runden hat, ist vorn, und bei gleicher Rundenzahl der, der zuerst dort war. Das ist
    dieselbe Regel wie im Rennsport, und sie hat den Vorteil, dass sie ohne Streckenposition
    auskommt - die kennt der Host nicht.

    Eine Sortierung nach BESTZEIT waere falsch: sie beantwortet "wer ist schnell", nicht "wer
    fuehrt". Sie steht als Spalte daneben.
    """
    with _lock:
        leute = []
        for fid, f in _fahrer.items():
            leute.append({
                'id': fid, 'name': f['name'], 'laps': f['laps'],
                'letzte': f['letzte'], 'beste': f['beste'],
                'abgaenge': f.get('abgaenge', 0),
                'alter': round(_jetzt() - f['aktualisiert'], 1),
                # Der Zeitpunkt der letzten Ueberfahrt ist das ZWEITE Sortierkriterium und
                # muss deshalb mit ins Dict. Er stand nur im internen Zustand, und die
                # Sortierung griff auf ein Feld, das es im gebauten Dict nicht gab - dann
                # sortiert sie still nach einer Konstanten.
                'letzteZeitpunkt': f.get('letzteZeitpunkt', 0),
            })
        leute.sort(key=lambda x: (-x['laps'], x['letzteZeitpunkt']))
        rennen = dict(_rennen)
    if rennen['start']:
        rennen['laufzeit'] = round(_jetzt() - rennen['start'], 1)
        if rennen['minutes']:
            rennen['restSekunden'] = max(
                0, round(rennen['minutes'] * 60 - rennen['laufzeit'], 1))
    return {'fahrer': leute, 'rennen': rennen, 'zeit': round(_jetzt(), 1)}


def melden(daten):
    """Ein Telefon meldet seinen Stand. Alles optional ausser der Kennung."""
    fid = str(daten.get('id') or '')[:64]
    if not fid:
        return {'ok': False, 'fehler': 'keine Kennung'}
    with _lock:
        f = _fahrer.setdefault(fid, {'name': fid, 'laps': 0, 'letzte': None,
                                     'beste': None, 'abgaenge': 0,
                                     'aktualisiert': _jetzt()})
        if 'name' in daten:
            f['name'] = str(daten['name'])[:40]
        if 'laps' in daten:
            try:
                f['laps'] = int(daten['laps'])
            except (TypeError, ValueError):
                pass
        for k in ('letzte', 'beste'):
            if k in daten and daten[k] is not None:
                try:
                    f[k] = round(float(daten[k]), 3)
                except (TypeError, ValueError):
                    pass
        if 'abgaenge' in daten:
            try:
                f['abgaenge'] = int(daten['abgaenge'])
            except (TypeError, ValueError):
                pass
        f['letzteZeitpunkt'] = _jetzt()
        f['aktualisiert'] = _jetzt()
        # Der ERSTE Bericht startet die Uhr. Ein eigener Startknopf waere ein zweiter Ort,
        # an dem ein Rennen beginnt - und dann laufen die beiden auseinander.
        if _rennen['start'] is None:
            _rennen['start'] = _jetzt()
    return {'ok': True}


def zuruecksetzen():
    with _lock:
        _fahrer.clear()
        _rennen['start'] = None
    return {'ok': True}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=REPO, **kw)

    # Ruhiger Log: eine Zeile je Sekunde bei 2 Hz Abfrage und vier Telefonen waere acht
    # Zeilen je Sekunde, und dann sieht man die echten Meldungen nicht mehr.
    def log_message(self, fmt, *args):
        if self.path.startswith('/mp/'):
            return
        super().log_message(fmt, *args)

    def _json(self, obj, code=200):
        roh = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(roh)))
        # Kein Zwischenspeichern: eine gecachte Rangliste ist keine Rangliste.
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(roh)

    def do_GET(self):
        if self.path.startswith('/mp/state'):
            self._json(zustand_lesen())
            return
        if self.path.startswith('/mp/reset'):
            self._json(zuruecksetzen())
            return
        if self.path.startswith('/mp/info'):
            self._json({'rennen': dict(_rennen), 'adresse': eigene_adresse()})
            return
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/mp/report'):
            self.send_error(404)
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n > 8192:
                self._json({'ok': False, 'fehler': 'zu gross'}, 413)
                return
            daten = json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception as e:
            self._json({'ok': False, 'fehler': str(e)}, 400)
            return
        self._json(melden(daten))


class Server(socketserver.ThreadingTCPServer):
    # Ohne das haengt der Port nach einem Neustart in TIME_WAIT und der zweite Start
    # scheitert - genau in dem Moment, in dem man schnell etwas ausprobieren will.
    allow_reuse_address = True
    daemon_threads = True


def eigene_adresse():
    """Die IP, unter der die Telefone den PC erreichen.

    Ueber einen UDP-Socket zu einer Adresse ausserhalb, OHNE etwas zu senden: das Betriebs-
    system waehlt dabei die Schnittstelle, die es fuer den Weg nach draussen nehmen wuerde,
    und genau die ist die richtige. gethostbyname(gethostname()) liefert auf vielen Rechnern
    127.0.0.1 oder die Adresse eines VPN-Adapters.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--laps', type=int, default=None, help='Rennlaenge in Runden')
    ap.add_argument('--minutes', type=float, default=None, help='Rennlaenge in Minuten')
    a = ap.parse_args()
    _rennen['laps'] = a.laps
    _rennen['minutes'] = a.minutes

    ip = eigene_adresse()
    print('OmegaSim Host laeuft.')
    print('')
    print('  Ueberblicksschirm auf DIESEM PC:')
    print('    http://localhost:%d/mp-overview.html' % a.port)
    print('')
    print('  Die App auf den Telefonen:')
    print('    http://%s:%d/' % (ip, a.port))
    print('')
    print('  ACHTUNG, einmal je Telefon: Web Bluetooth braucht einen secure context, und')
    print('  http://%s:%d ist keiner. In Chrome auf dem Telefon' % (ip, a.port))
    print('    chrome://flags/#unsafely-treat-insecure-origin-as-secure')
    print('  oeffnen, dort http://%s:%d eintragen und Chrome neu starten.' % (ip, a.port))
    print('  Ohne das laedt die App, aber "Auto verbinden" bleibt ohne Wirkung.')
    print('')
    print('  Beenden mit Strg+C.')
    print('')
    with Server(('', a.port), Handler) as srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print(chr(10) + 'beendet.')


if __name__ == '__main__':
    main()
