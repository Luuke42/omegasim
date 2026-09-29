#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Challenges-Bestenliste aus dem Google Sheet holen und als data/challenges.json ablegen.

    python tools/challenges_sync.py

Laeuft stuendlich in .github/workflows/challenges.yml. BESTELLT: "Kannst du das Google Sheet
ab und zu in GitHub speichern per Action? Die Zeiten sollen natuerlich sofort drin stehen, aber
koennten ja die lokalen + die in der letzten Stunde gefetchten sein."

Die App liest diese Datei zuerst (72-challenges.js) und mischt die eigenen, lokal gespeicherten
Zeiten dazu; ist sie aelter als zwei Stunden, fragt sie das Sheet direkt. Geschrieben wird nur,
wenn sich an den Listen etwas geaendert hat - sonst gaebe es jede Stunde einen leeren Commit.

Holt je Strecke, Modus und Preset eine Liste (4 x 2 x 2 = 16 Aufrufe) ueber dieselbe
doGet-Schnittstelle wie die App; am Apps Script muss dafuer nichts geaendert werden.
"""
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

URL = os.environ.get('CH_URL') or ('https://script.google.com/macros/s/'
      'AKfycbxCgxLcORkrqnp1QU_9d3r1x6HuBor2ZlB6vFQFf1cT_noiVm_ePWPMWcKfbDsB7G-C/exec')
IDS = ['oval', 'schlange', 'kehre', 'weitblick']
MODI = ['hotlap', 'rennen']
PRESETS = ['pro', 'arcade']
FELDER = ('zeit_ms', 'auto', 'fahrer', 'geraet', 'zeitpunkt')
MAX = 500
HERE = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(os.path.dirname(HERE), 'data', 'challenges.json')


def holen(q):
    # Die Echo-Umleitung von Google antwortet sporadisch mit 404 - also wiederholen.
    letzter = None
    for versuch in range(5):
        try:
            with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(q), timeout=40) as r:
                j = json.load(r)
            if j.get('ok'):
                return j
            letzter = RuntimeError(j.get('fehler') or 'nicht ok')
        except Exception as e:  # noqa: BLE001 - jeder Fehler heisst: nochmal
            letzter = e
        time.sleep(2 * (versuch + 1))
    raise SystemExit('Liste %s nicht erreichbar: %s' % (q, letzter))


def main():
    listen = {}
    for i in IDS:
        for m in MODI:
            for p in PRESETS:
                j = holen({'challenge': i, 'modus': m, 'preset': p})
                zeiten = [{k: z.get(k) for k in FELDER} for z in (j.get('zeiten') or [])][:MAX]
                listen['%s|%s|%s' % (i, m, p)] = {'anzahl': j.get('anzahl', len(zeiten)), 'zeiten': zeiten}
    alt = None
    if os.path.exists(ZIEL):
        try:
            with open(ZIEL, encoding='utf-8') as f:
                alt = json.load(f)
        except ValueError:
            alt = None
    if alt and alt.get('listen') == listen:
        print('unveraendert')
        return 0
    os.makedirs(os.path.dirname(ZIEL), exist_ok=True)
    stand = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with open(ZIEL, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'stand': stand, 'listen': listen}, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('geschrieben: %d Zeiten' % sum(len(v['zeiten']) for v in listen.values()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
