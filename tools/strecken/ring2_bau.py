"""Toernerschleife 2.0 mit Bruecke: ring_v2.dxf -> Fahrbahnflaeche (Raster 2 mm) mit sauberer Kreuzung."""
import numpy as np, cv2
from dxfread import lies
import sys
DXF = sys.argv[1] if len(sys.argv) > 1 else 'ring_v2.dxf'
s, punkte = lies(DXF)
R = 2.0; X0, Y0, W, H = -1800, -900, 3600, 1800
px = lambda P: np.c_[(P[:, 0] - X0) / R, (Y0 + H - P[:, 1]) / R]
def schnitt(a, b):           # Parameter t auf Strecke a, wo sie die Gerade b schneidet
    p, r = a[0], a[1] - a[0]; q, s_ = b[0], b[1] - b[0]
    den = r[0] * s_[1] - r[1] * s_[0]; return ((q - p)[0] * s_[1] - (q - p)[1] * s_[0]) / den
if 'v1a' in DXF:
    weg = {39, 40, 41, 42, 43, 44}; ueber, unter = (), ()
else:
    weg = {35, 36, 37, 38, 39, 40, 51, 52, 53, 54, 55}; ueber, unter = (41, 42), (43, 44)
OUT = sys.argv[2] if len(sys.argv) > 2 else 'bahn'
waende = []
for j, P in enumerate(s):
    if j in weg: continue
    if (np.abs(P[:, 0]) >= 1799.9).all() or (np.abs(P[:, 1]) >= 899.9).all(): continue
    if j in ueber + unter:
        andere = unter if j in ueber else ueber
        ts = sorted(schnitt(P, s[k]) for k in andere)
        waende.append(np.vstack([P[0], P[0] + (P[1] - P[0]) * ts[0]]))
        waende.append(np.vstack([P[0] + (P[1] - P[0]) * ts[1], P[1]]))
        continue
    waende.append(P)
img = np.zeros((int(H / R), int(W / R)), np.uint8)
for P in waende: cv2.polylines(img, [np.round(px(P)).astype(np.int32)], False, 255, 2)
# kleine Rechteck-Markierungen (Start, Box) als Polylinie: nur wenn geschlossen und klein -> raus
np.save('waende.npy', np.array([0]))
start = punkte[0]
sp = tuple(np.round(px(np.array([start]))[0]).astype(int))
feld = img.copy(); maske = np.zeros((feld.shape[0] + 2, feld.shape[1] + 2), np.uint8)
cv2.floodFill(feld, maske, sp, 128)
bahn = (feld == 128).astype(np.uint8)
print('Flaeche m2', bahn.sum() * R * R / 1e6, 'Startpixel', sp)
np.save(OUT + '.npy', bahn)
