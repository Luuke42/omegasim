#!/usr/bin/env python3
"""Leichte Fassung eines Automodells fuer den Grafikmodus Performance -> auto_perf.json + auto_perf.bin.

v1.6.48 (GEMELDET: "jetzt ruckelt es beim DTM Audi"). Nachbau von Gnen54s tools/modell_perf.py (aus seinem Fork,
22.11.2026) ohne sein C-Programm: die Quadrik-Vereinfachung kommt aus dem Python-Paket fast_simplification.

Quality laedt weiter auto.bin in voller Aufloesung; Performance laedt die Datei, die auto.json unter "perf" nennt
(vfModellDaten in src/60d-virtuell.js). Die leichte Datei bringt NUR die Geometrie (teile, ecken, indizes, indexAb);
alles andere (Lichter, Kamera, Physik) bleibt aus auto.json.

Verfahren je Teil (Teile und Texturen bleiben, nur weniger Dreiecke):
- Teile mit mehr als KLEIN Dreiecken werden per Quadrik-Kantenkollaps auf ihren Anteil am Ziel verkleinert;
  Glas und Leuchten bleiben unveraendert (sie liegen knapp uebereinander und wuerden sich durchdringen).
- Normale und Texturkoordinate jeder neuen Ecke vom naechsten Originalpunkt desselben Teils (cKDTree).
- Ecken je Teil <= 65 535 (Indizes uint16).

Aufruf: python tools/modell_perf.py <ordner> <ziel_dreiecke_gesamt>
        z. B. python tools/modell_perf.py img/autos/audirs5 30000
Setzt in auto.json "perf": "auto_perf".
"""
import json
import os
import sys

import numpy as np
import fast_simplification
from scipy.spatial import cKDTree

KLEIN = 1500
MIN_ANTEIL = 0.35        # kein Teil unter 35 % seiner Dreiecke (duenne Teile wie Fluegel zerfielen sonst)
MIN_INNEN = 0.2          # Innenraum (Namen INT_...) darf staerker
KLEIN_FLAECHE = 200      # kleinere zusammenhaengende Flaechen bleiben ganz
BLEIBT = ('glas', 'scheinwerferglas', 'scheinwerfer', 'ruecklicht', 'blinker')


def lade(d):
    meta = json.load(open(os.path.join(d, 'auto.json'), encoding='utf-8'))
    raw = open(os.path.join(d, 'auto.bin'), 'rb').read()
    E = np.frombuffer(raw, dtype=np.float32, count=meta['ecken'] * 8).reshape(-1, 8)
    I = np.frombuffer(raw, dtype=np.uint16, count=meta['indizes'], offset=meta['indexAb'])
    return meta, E, I


def vereinfache_teil(V, T, a_t):
    """Jede zusammenhaengende Flaeche des Teils fuer sich mit demselben Anteil (v1.6.48: der Heckfluegel des Audi ist eine
    eigene kleine Flaeche und verschwand, wenn das ganze Teil gemeinsam vereinfacht wurde). Flaechen unter KLEIN_FLAECHE
    Dreiecken bleiben. Ecken an Texturnaehten sind nicht verschweisst; zusammenhaengend heisst hier ueber gemeinsame
    Lage (auf 1e-5 gerundet), damit Naehte eine Flaeche nicht zerteilen."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    _, lage = np.unique(np.round(V[:, :3], 5), axis=0, return_inverse=True)
    lage = lage.reshape(-1)
    TL = lage[T]
    nl = int(lage.max()) + 1
    zeilen = np.concatenate([TL[:, 0], TL[:, 1], TL[:, 2]]); spalten = np.concatenate([TL[:, 1], TL[:, 2], TL[:, 0]])
    g = coo_matrix((np.ones(len(zeilen)), (zeilen, spalten)), shape=(nl, nl))
    _, komp = connected_components(g, directed=False)
    dk = komp[TL[:, 0]]
    teileV, teileT, off = [], [], 0
    for k in np.unique(dk):
        Tk = T[dk == k]
        ecken = np.unique(Tk)
        neu = np.full(len(V), -1, dtype=np.int64); neu[ecken] = np.arange(len(ecken))
        Vk = V[ecken]; Tk = neu[Tk]
        if len(Tk) > KLEIN_FLAECHE:
            P, F = fast_simplification.simplify(Vk[:, :3].astype(np.float32), Tk.astype(np.int32), target_reduction=1 - a_t)
            if len(F) >= 4:
                nah = cKDTree(Vk[:, :3]).query(P)[1]
                V2 = np.empty((len(P), 8), dtype=np.float32); V2[:, :3] = P; V2[:, 3:8] = Vk[nah, 3:8]
                Vk, Tk = V2, F.astype(np.int64)
        teileV.append(np.asarray(Vk, dtype=np.float32)); teileT.append(Tk + off); off += len(Vk)
    return np.concatenate(teileV), np.concatenate(teileT)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    d, ziel = sys.argv[1], int(sys.argv[2])
    meta, E, I = lade(d)
    gesamt = meta['indizes'] // 3
    gross = sum(t['indizes'] // 3 for t in meta['teile'] if t['indizes'] // 3 > KLEIN and t.get('rolle') not in BLEIBT)
    fest = gesamt - gross
    anteil = max(0.05, min(1.0, (ziel - fest) / max(1, gross)))
    ecken_neu, idx_neu, teile_neu = [], [], []
    e0 = i0 = 0
    for t in meta['teile']:
        V = E[t['ecke0']:t['ecke0'] + t['ecken']]
        T = I[t['index0']:t['index0'] + t['indizes']].astype(np.int64).reshape(-1, 3)
        n = len(T)
        a_t = max(anteil, MIN_INNEN if str(t.get('name', '')).upper().startswith('INT_') else MIN_ANTEIL)
        if n > KLEIN and t.get('rolle') not in BLEIBT and a_t < 0.98:
            V2, T2 = vereinfache_teil(V, T, a_t)
        else:
            V2, T2 = np.asarray(V, dtype=np.float32), T
        assert len(V2) <= 65535, (t.get('name'), len(V2))
        nt = dict(t)
        nt.update({'ecke0': e0, 'ecken': int(len(V2)), 'index0': i0, 'indizes': int(T2.size)})
        teile_neu.append(nt)
        ecken_neu.append(V2)
        idx_neu.append(T2.reshape(-1).astype(np.uint16))
        e0 += len(V2)
        i0 += T2.size
    Ealle = np.concatenate(ecken_neu).astype(np.float32)
    Ialle = np.concatenate(idx_neu)
    index_ab = Ealle.nbytes
    with open(os.path.join(d, 'auto_perf.bin'), 'wb') as f:
        f.write(Ealle.tobytes())
        f.write(Ialle.tobytes())
    neu = int(Ialle.size // 3)
    info = {'lod': 'Performance-Fassung: %d statt %d Dreiecke (tools/modell_perf.py, Quadrik)' % (neu, gesamt),
            'ecken': int(len(Ealle)), 'indizes': int(Ialle.size), 'indexAb': int(index_ab), 'teile': teile_neu}
    json.dump(info, open(os.path.join(d, 'auto_perf.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    meta['perf'] = 'auto_perf'
    json.dump(meta, open(os.path.join(d, 'auto.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('%s: %d -> %d Dreiecke, %.1f MB' % (d, gesamt, neu, os.path.getsize(os.path.join(d, 'auto_perf.bin')) / 1e6))
    return 0


if __name__ == '__main__':
    sys.exit(main())
