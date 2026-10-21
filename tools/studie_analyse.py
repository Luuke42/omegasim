#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Auswertung der OmegaSim-Studie (NARQ-S und Fahrverhaltens-Challenge).

Datenquelle ist der anonymisierte Abruf der Web-App (Apps Script, tools/challenges-apps-script.gs):

    python tools/studie_analyse.py --url https://script.google.com/macros/s/.../exec
    python tools/studie_analyse.py --json studie.json      # gespeicherte Antwort von ?studie=daten
    python tools/studie_analyse.py --csv studie.csv        # Export des Blatts Studie2 (eine Zeile je Geraet!)

Ergebnis: ein Bericht als Markdown (Standard studie_bericht.md), die Daten als CSV
(studie_daten.csv) und, falls matplotlib installiert ist, je Hypothese ein Streudiagramm.

Benoetigt: numpy, pandas, scipy (matplotlib optional).

Hypothesen (vorab festgelegt, alle gerichtet positiv):
    H1a  Rivalitaet          <-> Bremsen in der Kurve (Anteil der Bremszeit auf Kurventeilen)
    H1b  Rivalitaet          <-> Abfluege je Minute
    H2   Bewunderung         <-> Selbstueberschaetzung (Selbsteinschaetzung minus Leistungsrang)
    H3   Rivalitaet          <-> Vollgas-Anteil
    H4   Reaktionszeit       <-> beste Rundenzeit (langsamer reagieren, langsamer fahren)
    H5   Lenkunruhe          <-> Streuung der Rundenzeiten
Getestet: Pearson r mit 95-%-KI (Fisher z), einseitiger p-Wert, Holm-Korrektur ueber die sechs
Tests, dazu Spearman rho und die Partialkorrelation unter Kontrolle von Alter und Geschlecht.
Fahrwerte gehen nur aus gueltigen Fahrten ein (richtige Strecke, alle Runden gezaehlt).
NARQ-S: Back et al. (2013), Bewunderung = Items 1, 2, 4; Rivalitaet = Items 3, 5, 6.
"""
import argparse
import json
import math
import os
import sys
import urllib.request

import numpy as np
import pandas as pd
from scipy import stats

ADM, RIV = ['narq_1', 'narq_2', 'narq_4'], ['narq_3', 'narq_5', 'narq_6']
FAHRWERTE = ['beste_ms', 'gesamt_ms', 'vollgas', 'gas', 'bremse', 'bremsungen', 'bremsKurve', 'lenkUnruhe',
             'abfluege', 'rundenStreu', 'ueberschaetzung']
HYPOTHESEN = [
    ('H1a', 'rivalitaet', 'bremsKurve', 'Rivalität ↔ Bremsen in der Kurve'),
    ('H1b', 'rivalitaet', 'abfluege', 'Rivalität ↔ Abflüge je Minute'),
    ('H2', 'bewunderung', 'ueberschaetzung', 'Bewunderung ↔ Selbstüberschätzung'),
    ('H3', 'rivalitaet', 'vollgas', 'Rivalität ↔ Vollgas-Anteil'),
    ('H4', 'rt_median', 'beste_ms', 'Reaktionszeit ↔ beste Runde'),
    ('H5', 'lenkUnruhe', 'rundenStreu', 'Lenkunruhe ↔ Streuung der Rundenzeiten'),
]
NUMERISCH = ['alter', 'selbst', 'rt_median', 'fruehstarts', 'verpasst', 'fahrt', 'fahrt_gueltig', 'bewunderung', 'rivalitaet',
             'narq_1', 'narq_2', 'narq_3', 'narq_4', 'narq_5', 'narq_6', 'beste_ms', 'gesamt_ms', 'sekunden', 'vollgas', 'gas',
             'bremse', 'bremsungen', 'bremsKurve', 'lenkUnruhe', 'abfluege', 'rundenStreu']


def laden(a):
    if a.url:
        url = a.url + ('&' if '?' in a.url else '?') + 'studie=daten'
        with urllib.request.urlopen(url, timeout=60) as r:
            j = json.loads(r.read().decode('utf-8'))
        if not j.get('ok'):
            sys.exit('Abruf abgelehnt: %s' % j)
        return pd.DataFrame(j['daten'])
    if a.json:
        with open(a.json, encoding='utf-8') as f:
            j = json.load(f)
        return pd.DataFrame(j['daten'] if isinstance(j, dict) else j)
    if a.csv:
        return pd.read_csv(a.csv)
    sys.exit('Bitte --url, --json oder --csv angeben.')


def vorbereiten(df):
    df = df.copy()
    for k in NUMERISCH:
        if k in df.columns:
            df[k] = pd.to_numeric(df[k].replace('', np.nan), errors='coerce')
    # Facetten selbst nachrechnen (wie der Server), falls sie fehlen.
    if set(ADM) <= set(df.columns):
        df['bewunderung'] = df[ADM].mean(axis=1)
        df['rivalitaet'] = df[RIV].mean(axis=1)
    gueltig = df.get('fahrt_gueltig', pd.Series(0, index=df.index)).fillna(0) == 1
    for k in FAHRWERTE:
        if k in df.columns:
            df.loc[~gueltig, k] = np.nan
    # Selbstueberschaetzung: Selbsteinschaetzung (1-7 -> 0-1) minus Leistungsrang (schnellste = 1).
    df['ueberschaetzung'] = np.nan
    mit = gueltig & df['beste_ms'].notna() if 'beste_ms' in df.columns else gueltig & False
    if mit.sum() >= 2:
        rang = df.loc[mit, 'beste_ms'].rank(method='average', ascending=True)
        leistung = 1 - (rang - 1) / (mit.sum() - 1)
        df.loc[mit, 'ueberschaetzung'] = (df.loc[mit, 'selbst'] - 1) / 6 - leistung
    df['beste_s'] = df['beste_ms'] / 1000 if 'beste_ms' in df.columns else np.nan
    return df


def cronbach(df, items):
    x = df[items].dropna()
    k = len(items)
    if len(x) < 3:
        return float('nan'), len(x)
    var_items = x.var(axis=0, ddof=1).sum()
    var_sum = x.sum(axis=1).var(ddof=1)
    return (k / (k - 1)) * (1 - var_items / var_sum) if var_sum > 0 else float('nan'), len(x)


def pearson_ki(r, n):
    if n < 4 or not np.isfinite(r) or abs(r) >= 1:
        return (float('nan'), float('nan'))
    z, se = math.atanh(r), 1 / math.sqrt(n - 3)
    return (math.tanh(z - 1.96 * se), math.tanh(z + 1.96 * se))


def partial(df, x, y, kontrolle):
    d = df[[x, y] + kontrolle].dropna()
    if len(d) < len(kontrolle) + 4:
        return float('nan'), len(d)
    Z = np.column_stack([np.ones(len(d))] + [d[k].values for k in kontrolle])
    def rest(v):
        b, *_ = np.linalg.lstsq(Z, v, rcond=None)
        return v - Z @ b
    rx, ry = rest(d[x].values.astype(float)), rest(d[y].values.astype(float))
    if rx.std() == 0 or ry.std() == 0:
        return float('nan'), len(d)
    return float(np.corrcoef(rx, ry)[0, 1]), len(d)


def holm(ps):
    idx = sorted(range(len(ps)), key=lambda i: (np.inf if not np.isfinite(ps[i]) else ps[i]))
    m = sum(1 for p in ps if np.isfinite(p))
    out, lauf = [float('nan')] * len(ps), 0.0
    for rang, i in enumerate(idx):
        if not np.isfinite(ps[i]):
            continue
        lauf = max(lauf, min(1.0, (m - rang) * ps[i]))
        out[i] = lauf
    return out


def zahl(x, n=2):
    return '–' if x is None or (isinstance(x, float) and not np.isfinite(x)) else ('%.*f' % (n, x))


def bericht(df, ziel, bilder):
    z = []
    z.append('# OmegaSim-Studie: Auswertung\n')
    n, nf = len(df), int((df.get('fahrt_gueltig', 0) == 1).sum())
    z.append('Teilnehmende: **%d** (eine Teilnahme je Gerät), davon mit gültiger Fahrt: **%d**.\n' % (n, nf))
    if 'alter' in df:
        z.append('Alter: M = %s, SD = %s, Spanne %s–%s.\n' % (zahl(df.alter.mean(), 1), zahl(df.alter.std(), 1),
                                                         zahl(df.alter.min(), 0), zahl(df.alter.max(), 0)))
    if 'geschlecht' in df:
        g = df.geschlecht.map({'w': 'weiblich', 'm': 'männlich', 'd': 'divers', 'k': 'keine Angabe'}).value_counts()
        z.append('Geschlecht: ' + ', '.join('%s %d' % (k, v) for k, v in g.items()) + '.\n')
    a1, n1 = cronbach(df, ADM)
    a2, n2 = cronbach(df, RIV)
    z.append('Reliabilität (Cronbachs α): Bewunderung %s (n = %d), Rivalität %s (n = %d). Bei drei Items je Facette sind niedrige Werte zu erwarten.\n'
             % (zahl(a1), n1, zahl(a2), n2))
    z.append('\n## Beschreibende Werte\n')
    z.append('| Kennwert | n | M | SD | Min | Max |')
    z.append('|---|---|---|---|---|---|')
    for k in ['bewunderung', 'rivalitaet', 'selbst', 'rt_median', 'beste_s', 'vollgas', 'gas', 'bremse', 'bremsungen',
              'bremsKurve', 'lenkUnruhe', 'abfluege', 'rundenStreu', 'ueberschaetzung']:
        if k not in df:
            continue
        v = df[k].dropna()
        z.append('| %s | %d | %s | %s | %s | %s |' % (k, len(v), zahl(v.mean()), zahl(v.std()), zahl(v.min()), zahl(v.max())))
    z.append('\n## Hypothesen\n')
    z.append('Gerichtet positiv; p einseitig, Holm-korrigiert über die sechs Tests. Partielle r: kontrolliert für Alter und Geschlecht (weiblich = 1).\n')
    z.append('| | Zusammenhang | n | r [95-%-KI] | p (einseitig) | p (Holm) | Spearman ρ | partielles r |')
    z.append('|---|---|---|---|---|---|---|---|')
    df['weiblich'] = (df.get('geschlecht') == 'w').astype(float) if 'geschlecht' in df else np.nan
    zeilen, ps = [], []
    for h, x, y, text in HYPOTHESEN:
        if x not in df or y not in df:
            zeilen.append((h, text, 0, float('nan'), (float('nan'),) * 2, float('nan'), float('nan'), float('nan')))
            ps.append(float('nan'))
            continue
        d = df[[x, y]].dropna()
        nn = len(d)
        if nn >= 4 and d[x].std() > 0 and d[y].std() > 0:
            r, p2 = stats.pearsonr(d[x], d[y])
            p1 = p2 / 2 if r > 0 else 1 - p2 / 2
            rho = stats.spearmanr(d[x], d[y]).correlation
        else:
            r, p1, rho = float('nan'), float('nan'), float('nan')
        pr, _ = partial(df, x, y, ['alter', 'weiblich'])
        zeilen.append((h, text, nn, r, pearson_ki(r, nn), p1, rho, pr))
        ps.append(p1)
    for (h, text, nn, r, ki, p1, rho, pr), ph in zip(zeilen, holm(ps)):
        z.append('| %s | %s | %d | %s [%s, %s] | %s | %s | %s | %s |' % (h, text, nn, zahl(r), zahl(ki[0]), zahl(ki[1]),
                 zahl(p1, 3), zahl(ph, 3), zahl(rho), zahl(pr)))
    z.append('\nH3 aus dem ersten Entwurf (Rivalität ↔ Kontakte und Überholversuche gegen NPCs) ist ohne NPCs in der Studienfahrt nicht messbar und deshalb durch den Vollgas-Anteil ersetzt.\n')
    if bilder:
        z.append('\n## Streudiagramme\n')
        for b in bilder:
            z.append('![](%s)\n' % os.path.basename(b))
    with open(ziel, 'w', encoding='utf-8') as f:
        f.write('\n'.join(z))


def diagramme(df, ordner):
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
    except ImportError:
        return []
    out = []
    for h, x, y, text in HYPOTHESEN:
        if x not in df or y not in df:
            continue
        d = df[[x, y]].dropna()
        if len(d) < 3:
            continue
        fig, ax = plt.subplots(figsize=(4.2, 3.4), dpi=120)
        ax.scatter(d[x], d[y], s=18, alpha=.75)
        if d[x].std() > 0:
            b = np.polyfit(d[x], d[y], 1)
            xs = np.linspace(d[x].min(), d[x].max(), 20)
            ax.plot(xs, np.polyval(b, xs), lw=1.2)
        ax.set_xlabel(x); ax.set_ylabel(y); ax.set_title('%s: %s (n = %d)' % (h, text, len(d)), fontsize=9)
        fig.tight_layout()
        p = os.path.join(ordner, 'studie_%s.png' % h)
        fig.savefig(p); plt.close(fig)
        out.append(p)
    return out


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--url'); a.add_argument('--json'); a.add_argument('--csv')
    a.add_argument('--aus', default='.', help='Ordner fuer Bericht, CSV und Diagramme')
    a = a.parse_args()
    os.makedirs(a.aus, exist_ok=True)
    df = vorbereiten(laden(a))
    df.to_csv(os.path.join(a.aus, 'studie_daten.csv'), index=False)
    bilder = diagramme(df, a.aus)
    ziel = os.path.join(a.aus, 'studie_bericht.md')
    bericht(df, ziel, bilder)
    print('Bericht: %s (%d Teilnehmende)' % (ziel, len(df)))


if __name__ == '__main__':
    main()
