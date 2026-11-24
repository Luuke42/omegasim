import numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from skimage.graph import route_through_array
from scipy.ndimage import uniform_filter1d
b = np.load('bahn.npy').astype(bool); dt = np.load('dt.npy')
R = 2.0
rc = lambda p: (int(round((900 - p[1]) / R)), int(round((p[0] + 1800) / R)))
mm = lambda r: np.array([r[1] * R - 1800, 900 - r[0] * R])
kost = np.where(b, 1.0 / (dt + 1.0) ** 2 * 1e4 + 0.01, 1e9)
NW, SE = np.array([-303., 232.]), np.array([532., -392.])
SW, NE = np.array([(-205.37 + 38.70) / 2, (-126.97 - 357.16) / 2]), np.array([(115.19 + 367.59) / 2, (162.71 - 9.47) / 2])
route = [(-110, 720), (-900, 725), (-1600, 450), (-1300, 175), (-800, 235), 'NW',
         'SE', (590, -640), (-500, -700), (-1600, -450), (-1000, -250), 'SW',
         'NE', (600, 265), (1020, -300), (1300, -790), (1580, -400), (1610, 300), (1400, 760), (-110, 720)]
fix = {'NW': NW, 'SE': SE, 'SW': SW, 'NE': NE}
def snap(p):
    r0, c0 = rc(p); w = 50
    sub = dt[r0 - w:r0 + w + 1, c0 - w:c0 + w + 1]; i = np.unravel_index(np.argmax(sub), sub.shape)
    return mm((r0 - w + i[0], c0 - w + i[1]))
route = [r if isinstance(r, str) else tuple(snap(np.array(r, float))) for r in route]
P = []
for a, c in zip(route[:-1], route[1:]):
    if a in ('NW', 'SW'):                       # gerade durch die Kreuzung
        A, C = fix[a], fix[c]; n = int(np.hypot(*(C - A)) / R)
        P += [A + (C - A) * t for t in np.linspace(0, 1, n, endpoint=False)]; continue
    A = fix[a] if isinstance(a, str) else np.array(a, float); C = fix[c] if isinstance(c, str) else np.array(c, float)
    weg, _ = route_through_array(kost, rc(A), rc(C), fully_connected=True, geometric=True)
    P += [mm(r) for r in weg[:-1]]
M = np.array(P)
# Start/Ziel-Gerade oben (Gnen54 19.11.: "Schlenker ... die eigentlich gerade sein sollen"): die Wegsuche
# zog an der Einmuendung der Boxengasse zur breiteren Stelle. Mitte zwischen Aussenrand (868,2) und
# Steg/Innenrand (589,0 / 585,4) = 727,6 mm, von x -1240 bis 1150.
def gerade(M):
    m = (M[:, 1] > 600) & (M[:, 0] > -1240) & (M[:, 0] < 1150)
    M = M.copy(); M[m, 1] = 727.6; return M
M = gerade(M)
# glaetten (ausser im geraden Kreuzungsstueck: dort sind die Punkte schon gerade)
for _ in range(3): M = np.c_[uniform_filter1d(M[:, 0], 25, mode='wrap'), uniform_filter1d(M[:, 1], 25, mode='wrap')]
M2 = gerade(M); w = np.clip((np.minimum(M[:, 0] + 1240, 1150 - M[:, 0])) / 120, 0, 1) * (M[:, 1] > 600)
M = M * (1 - w[:, None]) + M2 * w[:, None]     # innen exakt gerade, an den Enden weich in die Kurven
np.save('mitte2.npy', M)
d = np.hypot(*np.diff(np.vstack([M, M[:1]]), axis=0).T); print('Laenge %.2f m' % (d.sum() / 1000))
fig, ax = plt.subplots(figsize=(24, 12)); ax.imshow(b, extent=(-1800, 1800, -900, 900), cmap='gray')
ax.plot(M[:, 0], M[:, 1], 'r-', lw=1)
for i in range(0, len(M), 300): ax.annotate('', M[i + 5], M[i], arrowprops=dict(color='y', arrowstyle='->', lw=2))
fig.savefig('mitte2.png', dpi=50, bbox_inches='tight')
