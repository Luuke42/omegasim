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

Seit v0.8.44 (80 Wochenstrecken) EIN Aufruf ?alle=1; die Kennungen liest das Skript aus
src/72-challenges.js (CH_KATALOG), und jede Liste steht in der Datei, auch leere - sonst fragte
die App fuer jede leere Liste live nach. Kennt das bereitgestellte Apps Script alle=1 noch nicht,
holt es die vier alten Listen einzeln wie bisher. Neu geschrieben wird bei jeder Aenderung und
spaetestens alle 6 Stunden (die App nimmt den Schnappschuss bis 8 Stunden).
"""
import re
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request

URL = os.environ.get('CH_URL') or ('https://script.google.com/macros/s/'
      'AKfycbxCgxLcORkrqnp1QU_9d3r1x6HuBor2ZlB6vFQFf1cT_noiVm_ePWPMWcKfbDsB7G-C/exec')
ALTE_IDS = ['oval', 'schlange', 'kehre', 'weitblick']
NEU_NACH_S = 6 * 3600
MODI = ['hotlap', 'rennen']
PRESETS = ['pro', 'arcade']
FELDER = ('zeit_ms', 'auto', 'fahrer', 'geraet', 'zeitpunkt', 'runden', 'runden_ms')
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


def kennungen():
    with open(os.path.join(os.path.dirname(HERE), 'src', '72-challenges.js'), encoding='utf-8') as f:
        s = f.read()
    a = s.index('const CH_KATALOG')
    ids = re.findall(r"\{ id: '([a-z0-9-]+)'", s[a:s.index('\n  };', a)])
    if len(ids) != 80:
        raise SystemExit('%d Kennungen statt 80 in CH_KATALOG' % len(ids))
    # Dauerrennen (feste Strecken) seit v0.9.10 mit im Schnappschuss.
    if 'const CH_DAUER' in s:
        b = s.index('const CH_DAUER')
        ids += re.findall(r"\{ id: '([a-z0-9-]+)'", s[b:s.index('\n  ];', b)])
    return ids


def eintrag(j):
    zeiten = [{k: z.get(k) for k in FELDER} for z in (j.get('zeiten') or [])][:MAX]
    return {'anzahl': j.get('anzahl', len(zeiten)), 'zeiten': zeiten}


def main():
    ids = kennungen()
    listen = {'%s|%s|%s' % (i, m, p): {'anzahl': 0, 'zeiten': []} for i in ids for m in MODI for p in PRESETS}
    j = holen({'alle': 1})
    if isinstance(j.get('listen'), dict):
        for schl, l in j['listen'].items():
            if schl in listen:
                listen[schl] = eintrag(l)
    else:
        print('Apps Script kennt alle=1 noch nicht - vier alte Strecken einzeln')
        for i in ALTE_IDS:
            for m in MODI:
                for p in PRESETS:
                    listen['%s|%s|%s' % (i, m, p)] = eintrag(holen({'challenge': i, 'modus': m, 'preset': p}))
    alt = None
    if os.path.exists(ZIEL):
        try:
            with open(ZIEL, encoding='utf-8') as f:
                alt = json.load(f)
        except ValueError:
            alt = None
    if alt and alt.get('listen') == listen:
        try:
            alter = time.time() - datetime.datetime.strptime(alt.get('stand', ''), '%Y-%m-%dT%H:%M:%SZ').replace(
                tzinfo=datetime.timezone.utc).timestamp()
        except ValueError:
            alter = NEU_NACH_S
        if alter < NEU_NACH_S:
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
