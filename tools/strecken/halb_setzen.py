#!/usr/bin/env python3
"""Bahnbreite einer freien Strecke in echten Massen (25.11.2026, BESTELLT Gnen54: Toernerschleife "massstaeblich").

Bisher zeichnete die App jede freie Strecke mit der Carrera-Breite (25 cm = 11,63 Einheiten halb). Die
Toernerschleife ist aber 280 mm (mit Bruecke 268 mm) breit. Dieses Skript traegt 'halb' = breiteMm * K / 2 ein
und zieht die Buchttiefen (buchtPkt, gemessen ab 11,63) um die Verbreiterung ab, damit die Aussenkante der
Boxengasse bleibt, wo sie ist.

Aufruf: python3 tools/strecken/halb_setzen.py img/strecken/indeq-ring.json [weitere.json ...]
"""
import json, sys
K = 0.093023
ALT = 11.63
for f in sys.argv[1:]:
    d = json.load(open(f, encoding='utf-8'))
    if d.get('halb'):
        print(f, 'hat schon halb =', d['halb']); continue
    halb = round(d['breiteMm'] * K / 2, 3)
    mehr = halb - ALT
    if d.get('buchtPkt'):
        d['buchtPkt'] = [round(max(0.0, v - mehr), 2) if v > 0 else 0 for v in d['buchtPkt']]
    if d.get('boxBucht'):
        d['boxBucht'] = round(max(0.1, (d['boxBucht'] * ALT - mehr) / halb), 2)
    d['halb'] = halb
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f, 'halb', halb, '(+%.2f)' % mehr)
