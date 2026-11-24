"""Boxenbucht je Punkt aus der echten Boxengasse (DXF-Raster) statt fester Tiefe mit S-Rampe.
python3 bucht_tiefe.py strecke.json bahn_xxx.npy  -> schreibt 'buchtPkt' (Karteneinheiten jenseits der halben Bahn)."""
import sys, json, numpy as np, cv2
from scipy.ndimage import distance_transform_edt, uniform_filter1d
K = 0.093023; HALF = 25 / 2 * 0.930; R = 2.0
js, bn = sys.argv[1], sys.argv[2]
d = json.load(open(js)); b = np.load(bn).astype(bool); dt = distance_transform_edt(b)
P = np.array([p[:2] for p in d['pts']], float); n = len(P)
def mm(Q, v): return np.c_[(Q[:, 0] + v[0]) / K, -(Q[:, 1] + v[1]) / K]
def rc(Q): return np.clip(np.round((900 - Q[:, 1]) / R).astype(int), 0, b.shape[0] - 1), np.clip(np.round((Q[:, 0] + 1800) / R).astype(int), 0, b.shape[1] - 1)
def guete(v):
    r, c = rc(mm(P, v)); return dt[r, c].sum()
# Versatz suchen: grob, dann fein
best = (-1, None)
for vx in np.arange(-60, 60, 1.0):
    for vy in np.arange(-60, 60, 1.0):
        g = guete((vx, vy))
        if g > best[0]: best = (g, (vx, vy))
v0 = best[1]
for vx in np.arange(v0[0] - 1, v0[0] + 1, 0.05):
    for vy in np.arange(v0[1] - 1, v0[1] + 1, 0.05):
        g = guete((vx, vy))
        if g > best[0]: best = (g, (vx, vy))
v = best[1]; M = mm(P, v)
r, c = rc(M); print('Versatz', np.round(v, 2), 'mittlerer Abstand zum Rand mm %.0f' % (dt[r, c].mean() * R))
n_lab, lab = cv2.connectedComponents((~b).astype(np.uint8), connectivity=8)
r0, c0 = rc(np.array([[500., 573.]])); steg = lab == lab[r0[0], c0[0]]
Pc = np.vstack([P, P[:1]]); t = np.roll(Pc, -1, 0) - np.roll(Pc, 1, 0); t = t[:n] / np.linalg.norm(t[:n], axis=1)[:, None]
nrm = np.c_[t[:, 1], -t[:, 0]]                       # Editor: quer > 0 = links
nmm = np.c_[nrm[:, 0], -nrm[:, 1]]
seite = d.get('boxSeite', 1)
pit = np.array([d['kacheln'][p[2]] == 'PIT' for p in d['pts']])
tief = np.zeros(n)
for i in np.where(pit)[0]:
    for s_ in np.arange(0, 800, 1.0):
        q = M[i] + nmm[i] * s_ * seite; rr, cc = rc(q[None])
        if not b[rr[0], cc[0]] and not steg[rr[0], cc[0]]:
            tief[i] = s_; break
x = np.where(pit, np.maximum(0, tief * K - HALF), 0.0)
x[x < 1.5] = 0
x = uniform_filter1d(uniform_filter1d(x, 9, mode='wrap'), 9, mode='wrap') * pit
idx = np.where(pit)[0]
for k, f in enumerate([1 / 4, 2 / 4, 3 / 4]):      # weich hinein und hinaus statt Stufe
    x[idx[k]] *= f; x[idx[-1 - k]] *= f
d['buchtPkt'] = [round(float(y), 2) for y in x]
d['_versatz'] = [round(float(v[0]), 3), round(float(v[1]), 3)]
json.dump(d, open(js, 'w'), separators=(',', ':'))
print('Bucht je Punkt: max %.1f, Median (wo >0) %.1f Einheiten, %d Punkte' % (x.max(), np.median(x[x > 0]), (x > 0).sum()))
