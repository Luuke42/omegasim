"""Boxengasse als eigene Flaeche aus dem DXF-Raster: Dreiecke + weisse Randlinien (Karteneinheiten).
python3 boxgasse.py strecke.json bahn_xxx.npy"""
import sys, json, numpy as np, cv2
from scipy.spatial import cKDTree
K = 0.093023; R = 2.0; HALF_MM = 25 / 2 * 10 * 1.0   # 125 mm = TRACK_HALF_W in mm (25 cm Bahn)
js, bn = sys.argv[1], sys.argv[2]
d = json.load(open(js)); b = np.load(bn).astype(np.uint8)
P = np.array([p[:2] for p in d['pts']], float)
# Versatz wie bucht_tiefe.py (dort bestimmt und gemerkt)
v = d['_versatz']
mm = lambda Q: np.c_[(Q[:, 0] + v[0]) / K, -(Q[:, 1] + v[1]) / K]
ed = lambda Q: np.c_[Q[:, 0] * K - v[0], -Q[:, 1] * K - v[1]]
H, W = b.shape
M = mm(P)
# Hauptbahn-Band: alles naeher als die halbe Bahn (DXF-Bahn ~134 mm) an der Mittellinie
yy, xx = np.mgrid[0:H, 0:W]; pix = np.c_[xx.ravel() * R - 1800, 900 - yy.ravel() * R]
Mf = np.vstack([np.linspace(M[i], M[(i + 1) % len(M)], 6, endpoint=False) for i in range(len(M))])
dist, _ = cKDTree(Mf).query(pix, distance_upper_bound=400); dist = dist.reshape(H, W)
gasse = (b > 0) & (dist > 138)
bx = d['boxPunkt']; bxm = mm(np.array([bx]))[0]
n_lab, lab = cv2.connectedComponents(gasse.astype(np.uint8), connectivity=8)
lb = lab[int(round((900 - bxm[1]) / R)), int(round((bxm[0] + 1800) / R))]
gasse = (lab == lb).astype(np.uint8)
# etwas unter die Hauptbahn ziehen, damit keine Fuge bleibt
gasse_d = cv2.dilate(gasse, np.ones((5, 5), np.uint8)) & (b > 0)
cs, _ = cv2.findContours(gasse_d, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea); c = cv2.approxPolyDP(c, 1.2, True)[:, 0, :].astype(float)
poly = np.c_[c[:, 0] * R - 1800, 900 - c[:, 1] * R]          # mm
print('Gasse: %.0f cm2, %d Ecken' % (gasse.sum() * R * R / 100, len(poly)))
# Ear clipping
def flaeche(Q): return 0.5 * np.sum(Q[:, 0] * np.roll(Q[:, 1], -1) - np.roll(Q[:, 0], -1) * Q[:, 1])
Q = poly if flaeche(poly) > 0 else poly[::-1]
idx = list(range(len(Q))); tri = []
def innen(p, a, b_, c_):
    def s(p1, p2, p3): return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = s(p, a, b_), s(p, b_, c_), s(p, c_, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
guard = 0
while len(idx) > 3 and guard < 100000:
    guard += 1; ok = False
    for k in range(len(idx)):
        i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
        a, b_, c_ = Q[i0], Q[i1], Q[i2]
        if (b_[0] - a[0]) * (c_[1] - a[1]) - (b_[1] - a[1]) * (c_[0] - a[0]) <= 0: continue
        if any(innen(Q[j], a, b_, c_) for j in idx if j not in (i0, i1, i2)): continue
        tri.append((i0, i1, i2)); idx.pop(k); ok = True; break
    if not ok: break
if len(idx) == 3: tri.append(tuple(idx))
print('Dreiecke', len(tri), 'Rest', len(idx))
E = ed(Q)
d['boxDreiecke'] = [round(float(x), 2) for t in tri for j in t for x in E[j]]
# Randlinien: Konturpunkte, die an Gras grenzen (nicht an Hauptbahn, nicht an den Steg)
n2, lab2 = cv2.connectedComponents((b == 0).astype(np.uint8), connectivity=8)
r0, c0 = int(round((900 - 573) / R)), int(round((500 + 1800) / R)); steg = lab2 == lab2[r0, c0]
sd = cv2.distanceTransform((~steg).astype(np.uint8), cv2.DIST_L2, 3) * R
cc = cv2.findContours(gasse, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
cc = max(cc, key=cv2.contourArea)[:, 0, :]
wand = np.array([dist[y, x] > 150 and sd[y, x] > 8 for x, y in cc])
linien, akt = [], []
for (x, y), w in zip(cc, wand):
    if w: akt.append((x * R - 1800, 900 - y * R))
    elif len(akt) > 5: linien.append(np.array(akt)); akt = []
    else: akt = []
if len(akt) > 5: linien.append(np.array(akt))
out = []
for L in linien:
    L = L[::3]
    if len(L) < 3: continue
    out.append([[round(float(x), 2), round(float(y), 2)] for x, y in ed(L)])
d['boxRand'] = out
print('Randlinien', len(out), [len(o) for o in out])
json.dump(d, open(js, 'w'), separators=(',', ':'))
