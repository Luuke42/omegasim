#!/usr/bin/env python3
"""Vorschaubild des RC Stunt Copters fuer die virtuelle Garage -> img/vf/vorschau.png (transparent).

v1.6.56 BESTELLT: "In der Vorschau in der Garage bei virtuell fehlt das Helikopter Modell". Der Hubschrauber hat kein
auto.json (tools/vorschau_bilder.py rechnet nur Autos); seine Daten liegen in img/vf/hub.bin: zwei uint32 (Ecken Rumpf,
Ecken Rotor), dann je Ecke x y z r g b (float32), je drei Ecken ein Dreieck, App-Koordinaten (+x links, +y oben, +z vorn).
Gezeichnet schraeg von vorn-seitlich, mit Z-Puffer, flacher Schattierung, 3-fach ueberabgetastet und einem weichen
Bodenschatten, wie die Autos. Aufruf aus dem Repo: python tools/heli_vorschau.py
v1.6.81: rendern() liefert das transparente Bild; tools/vorschau_bilder.py legt es auf den grauen Hintergrund der Autos
(python tools/vorschau_bilder.py heli). Direkt aufgerufen schreibt dieses Skript das Bild ebenfalls mit Hintergrund.
"""
import os
import struct
import numpy as np
from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B, H, SS = 640, 360, 3


def lade():
    raw = open(os.path.join(REPO, 'img', 'vf', 'hub.bin'), 'rb').read()
    nb, nr = struct.unpack_from('<II', raw, 0)
    a = np.frombuffer(raw, dtype=np.float32, count=(nb + nr) * 6, offset=8).reshape(-1, 6)
    return a.reshape(-1, 3, 6)


def rendern():
    T = lade().astype(np.float64)
    P = T[:, :, :3]; C = T[:, :, 3:6]
    # Blick: Gier 35 Grad (schraeg von vorn rechts), leicht von oben (12 Grad).
    g, n = np.radians(-145), np.radians(12)
    Ry = np.array([[np.cos(g), 0, np.sin(g)], [0, 1, 0], [-np.sin(g), 0, np.cos(g)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(n), -np.sin(n)], [0, np.sin(n), np.cos(n)]])
    Q = P @ Ry.T @ Rx.T
    mn, mx = Q.reshape(-1, 3).min(0), Q.reshape(-1, 3).max(0)
    W, Hh = B * SS, H * SS
    s = min(W * 0.86 / (mx[0] - mn[0]), Hh * 0.78 / (mx[1] - mn[1]))
    cx = (mn[0] + mx[0]) / 2
    X = (Q[:, :, 0] - cx) * s + W / 2
    Y = Hh * 0.86 - (Q[:, :, 1] - mn[1]) * s
    Z = Q[:, :, 2]
    # Licht von oben vorn links
    e1 = Q[:, 1] - Q[:, 0]; e2 = Q[:, 2] - Q[:, 0]
    N = np.cross(e1, e2); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    L = np.array([0.35, 0.8, -0.5]); L /= np.linalg.norm(L)
    hell = 0.42 + 0.58 * np.abs(N @ L)
    farbe = np.clip(C.mean(1) * hell[:, None], 0, 1)
    zb = np.full((Hh, W), np.inf); bild = np.zeros((Hh, W, 4))
    for i in np.argsort(-Z.mean(1)):
        x0, x1 = int(max(0, np.floor(X[i].min()))), int(min(W - 1, np.ceil(X[i].max())))
        y0, y1 = int(max(0, np.floor(Y[i].min()))), int(min(Hh - 1, np.ceil(Y[i].max())))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, bx, cx_), (ay, by, cy) = X[i], Y[i]
        d = (by - cy) * (ax - cx_) + (cx_ - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx_) + (cx_ - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx_) + (ax - cx_) * (ys - cy)) / d
        l3 = 1 - l1 - l2
        inn = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        z = l1 * Z[i, 0] + l2 * Z[i, 1] + l3 * Z[i, 2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        m = inn & (z < sub)
        sub[m] = z[m]
        bild[y0:y1 + 1, x0:x1 + 1][m] = np.append(farbe[i], 1.0)
    # Bodenschatten: Ellipse unter dem Hubschrauber
    sch = Image.new('L', (W, Hh), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(sch).ellipse([W * 0.2, Hh * 0.83, W * 0.8, Hh * 0.93], fill=110)
    sch = np.asarray(sch.filter(ImageFilter.GaussianBlur(SS * 10)), dtype=np.float64) / 255
    a = bild[:, :, 3]
    rgb = bild[:, :, :3]
    aus = np.zeros_like(bild)
    aus[:, :, :3] = rgb
    aus[:, :, 3] = a + (1 - a) * sch
    return Image.fromarray((np.clip(aus, 0, 1) * 255).astype(np.uint8), 'RGBA').resize((B, H), Image.LANCZOS)


def main():
    import sys
    sys.argv = [sys.argv[0], 'heli']
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import vorschau_bilder
    vorschau_bilder.main()


if __name__ == '__main__':
    main()
