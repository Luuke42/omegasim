"""Toernerschleife 2.0 Bruecke -> indeq-bruecke.json. Wie ring_json.py, dazu Hoehe je Punkt (4. Wert)."""
import numpy as np, json, cv2
from scipy.spatial import cKDTree
from skimage.morphology import skeletonize
from dxfread import lies
b = np.load('bahn.npy').astype(bool); R = 2.0
rc = lambda p: (int(round((900 - p[1]) / R)), int(round((p[0] + 1800) / R)))
M = np.load('mitte2.npy')
K = 0.093023
P = np.vstack([M, M[:1]]); s = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
u = np.arange(0, s[-1], 2.857 / K); M = np.c_[np.interp(u, s, P[:, 0]), np.interp(u, s, P[:, 1])]
_, punkte = lies('ring_v2a.dxf'); start_mm, box_mm = np.array(punkte[0]), np.array(punkte[1])
r = int(np.argmin(np.hypot(*(M - start_mm).T))); M = np.roll(M, -r, axis=0)
print('Laenge %.2f m, %d Punkte, Start %s' % (s[-1] / 1000, len(M), M[0].round()))
# Steg: schmale Nicht-Bahn-Komponente um (500, 573)
n_lab, lab = cv2.connectedComponents((~b).astype(np.uint8), connectivity=8)
steg_m = lab == lab[rc((500, 573))]
print('Steg Pixel', steg_m.sum())
sk = np.argwhere(skeletonize(steg_m)); S = np.c_[sk[:, 1] * R - 1800, 900 - sk[:, 0] * R]
# ordnen: vom linken Ende aus naechster Nachbar
o = [int(np.argmin(S[:, 0]))]; rest = set(range(len(S))) - {o[0]}; T = cKDTree(S)
while rest:
    d, j = T.query(S[o[-1]], k=12); nxt = [jj for jj in j if jj in rest]
    if not nxt: break
    o.append(nxt[0]); rest.discard(nxt[0])
S = S[o]
ed = lambda Q: np.c_[Q[:, 0] * K, -Q[:, 1] * K]
E = ed(M)
t = np.roll(E, -1, axis=0) - np.roll(E, 1, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
nrm = np.c_[t[:, 1], -t[:, 0]]
Se = ed(S); dd, j = cKDTree(Se).query(E); q = np.einsum('ij,ij->i', Se[j] - E, nrm)
box = np.where((dd < 200 * K) & (q > 0))[0]
grp = np.split(box, np.where(np.diff(box) > 1)[0] + 1); g = max(grp, key=len); b0, b1 = int(g[0]), int(g[-1])
print('Boxenabschnitt', b0, b1, '%.2f m' % ((b1 - b0) * 2.857 / K / 1000))
# Tiefe der Boxengasse: entlang der linken Normale (mm) durch Steg und Gasse bis zur Wand
nmm = np.c_[nrm[:, 0], -nrm[:, 1]]      # Editor-Normale zurueck in mm (y nach oben)
tief = []
for i in range(b0, b1 + 1):
    zust = 0
    for dmm in np.arange(0, 700, 2.0):
        pnt = M[i] + nmm[i] * dmm; rr, cc = rc(pnt)
        if not (0 <= rr < b.shape[0] and 0 <= cc < b.shape[1]): break
        auf = b[rr, cc]
        if zust == 0 and not auf: zust = 1
        elif zust == 1 and auf: zust = 2
        elif zust == 2 and not auf: tief.append(dmm); break
print('Tiefe mm median', np.median(tief), len(tief))
tiles, tile_of = [], np.zeros(len(E), int); i = 0
while i < len(E):
    if i == b0:
        tiles.append('PIT'); tile_of[b0:b1 + 1] = len(tiles) - 1; i = b1 + 1; continue
    jj = min(len(E), i + 14, b0 if i < b0 else len(E))
    tiles.append('START' if i == 0 else 'STRAIGHT'); tile_of[i:jj] = len(tiles) - 1; i = jj
# Hoehe: Bruecke (STL) auf der Geraden NW -> SE, Scheitel ueber der Kreuzung
v = np.load('bv.npy').reshape(-1, 3, 3)
def deck(x, z=129.6):              # senkrechter Strahl auf die Dreiecke, hoechster Treffer = Fahrbahn
    a, bb, c = v[:, 0], v[:, 1], v[:, 2]
    det = (bb[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - bb[:, 0]) * (a[:, 2] - c[:, 2])
    ok = np.abs(det) > 1e-9; det = np.where(ok, det, 1)
    l1 = ((bb[:, 2] - c[:, 2]) * (x - c[:, 0]) + (c[:, 0] - bb[:, 0]) * (z - c[:, 2])) / det
    l2 = ((c[:, 2] - a[:, 2]) * (x - c[:, 0]) + (a[:, 0] - c[:, 0]) * (z - c[:, 2])) / det
    l3 = 1 - l1 - l2; hit = ok & (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
    return float((l1 * a[:, 1] + l2 * bb[:, 1] + l3 * c[:, 1])[hit].max()) if hit.any() else 0.0
xs = np.arange(-500, 602, 5.0); prof = np.array([deck(x) for x in xs])
print('Profil', prof[::10].round(1))
NW, SE, SW, NE = np.array([-303., 232.]), np.array([532., -392.]), np.array([-340., -268.]), np.array([256., 78.])
d1 = (SE - NW) / np.linalg.norm(SE - NW); d2 = (NE - SW) / np.linalg.norm(NE - SW)
A = np.c_[d1, -d2]; tt = np.linalg.solve(A, SW - NW); C = NW + d1 * tt[0]
print('Kreuzung', C.round(), 'NW-C %.0f, C-SE %.0f' % (np.linalg.norm(C - NW), np.linalg.norm(SE - C)))
quer = np.abs((M - C) @ np.array([-d1[1], d1[0]])); laeng = (M - C) @ d1
richt = np.gradient(M, axis=0); richt /= np.linalg.norm(richt, axis=1)[:, None]
# Gnen54 19.11.: die Luecke im gestrichelten Pfeil = Mitte der Durchfahrt = Scheitel (STL-x 0) ueber der Kreuzung.
# Die flache Auffahrt (+x, 600 mm) reicht dabei etwas in die Kurve vor der Geraden.
auf_bruecke = (quer < 130) & (richt @ d1 > 0.7) & (laeng > -610) & (laeng < 510)
stl_x = -laeng

h = np.where(auf_bruecke, np.interp(stl_x, xs, prof, left=0, right=0), 0.0); h[h < 2.5] = 0
print('Brueckenpunkte', auf_bruecke.sum(), 'max Hoehe %.1f mm' % h.max())
versatz = (E.max(0) + E.min(0)) / 2; E = E - versatz
out = {'name': 'Törnerschleife 2.0 Brücke', 'quelle': 'Toernerschleife-V2a.dxf + Bruecke.stl (Gnen54), 3,60 x 1,80 m, Layout Driftstrecken.de',
       'breiteMm': 268.0, 'kacheln': tiles,
       'pts': [[round(float(x), 2), round(float(y), 2), int(tl), round(float(hh * K), 3)] for (x, y), tl, hh in zip(E, tile_of, h)]}
Sm = ed(S) - versatz
step = max(1, len(Sm) // 160)
out['steg'] = {'b': round(float(np.sum(steg_m) * R * R / (np.sum(np.hypot(*np.diff(S, axis=0).T)) + 1) * K), 2),
               'pts': [[round(float(x), 2), round(float(y), 2)] for x, y in Sm[::step]]}
out['boxBucht'] = round(float(np.median(tief) * K / 11.63 - 1.0), 2)
out['boxSeite'] = 1
out['boxPunkt'] = [round(float(vv), 2) for vv in (ed(box_mm[None])[0] - versatz)]
out['bruecke'] = {'mitte': [round(float(vv), 2) for vv in (ed(C[None])[0] - versatz)], 'richtung': [round(float(d1[0]), 4), round(float(-d1[1]), 4)],
                  'breite': round(259 * K, 2)}
json.dump(out, open('indeq-bruecke.json', 'w'), separators=(',', ':'))
print(len(tiles), 'Kacheln; Bucht', out['boxBucht'], 'Steg b', out['steg']['b'])
