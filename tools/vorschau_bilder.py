#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Erzeugt die Garagen-Vorschaubilder der OmegaSim-Fahrzeuge (Seitenansicht).

Die Garagen-Vorschau in src/60d-virtuell.js zeigt je Auto EIN Bild
img/autos/<modell>/vorschau.jpg in der Originalfarbe (Standardfarbe). Dieses
Skript zeichnet das Modell (auto.json + auto.bin + Texturen) seitlich, damit
die Vorschau das ganze Auto zeigt und das Aktualisieren einfach bleibt.

Aufruf (aus dem Repo-Wurzelverzeichnis):
    python tools/vorschau_bilder.py                # alle Modelle unter img/autos
    python tools/vorschau_bilder.py img/autos/v5r  # nur ein Modell

Sehr dichte Modelle (z. B. die Caravelle mit ~1,7 Mio. Dreiecken) werden fuer
die Vorschau per Vertex-Clustering reduziert, damit das Skript schnell bleibt.
Das Skript ueberschreibt vorschau.jpg; die alten Einzelbilder vorschau_<farbe>.jpg
bleiben liegen (werden nicht mehr angezeigt).

v1.6.37 BESTELLT: "Vorschau mit dem gewaehlten Untergrund und darauf das Auto ohne grauen Hintergrund
(transparent); das Skript so ueberarbeiten, dass alle Vorschauen so gut werden wie die vom Audi." Jetzt:
  - vorschau.png mit Alphakanal (transparent), weicher Bodenschatten unter den Raedern,
  - 3-fach ueberabgetastet und mit Lanczos verkleinert (glatte Kanten, keine Treppen),
  - das Auto steht unten im Bild (Raeder bei 88 % der Hoehe), damit es in der Garage auf dem Boden steht,
  - dichte Modelle werden nicht mehr reduziert (erst ab 3 Mio. Dreiecken; die Caravelle mit 1,7 Mio. dauert ~5 min,
    reduziert hatte sie Loecher und Flecken).

v1.6.81 BESTELLT: "Vorschaubilder nochmal aufhuebschen mit grauem Hintergrund (leichter Farbverlauf) und bei den Speed
Dreams Autos schauen, dass die Raeder korrekt platziert sind. Am besten alles wieder mit einem Skript." Jetzt:
  - grauer Studio-Hintergrund (senkrechter Verlauf, heller Lichtfleck hinter dem Auto), Bild deckend (kein Alpha mehr),
  - die Karosserie steht wie im Spiel (vfModellZeichnen) um die Bodenfreiheit ueber dem Boden; bisher stand sie auf
    y = 0, dadurch ragten bei den Speed-Dreams-Autos (Boxer 96, FMC GT4, Lynx 220) die Raeder durch die Kotfluegel,
  - der Bildausschnitt umfasst Karosserie UND Raeder (Raeder stehen auf der Bodenlinie),
  - dasselbe Skript zeichnet auch den Hubschrauber (tools/heli_vorschau.py) auf denselben Hintergrund:
        python tools/vorschau_bilder.py            # alle Autos und der Hubschrauber
        python tools/vorschau_bilder.py heli       # nur der Hubschrauber
"""

import json
import os
import sys
import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTOS = os.path.join(REPO, "img", "autos")

AUS_BREITE, AUS_HOEHE = 640, 360
SS = 3                 # Ueberabtastung
BREITE = AUS_BREITE * SS
HOEHE = AUS_HOEHE * SS
BODEN = 0.88           # Unterkante der Raeder in Anteilen der Bildhoehe
RAND = 0.09            # Anteil Rand um das Auto (Laenge/Hoehe)
GLAS_ROLLEN = ("glas", "scheinwerferglas")

# Licht aus der Kamerarichtung, leicht von oben und vorn.
LICHT = np.array([-0.62, 0.55, 0.42])
LICHT = LICHT / np.linalg.norm(LICHT)
FUELL = np.array([0.55, 0.25, -0.3])       # Aufhellung von der Gegen-/Frontseite
FUELL = FUELL / np.linalg.norm(FUELL)
AMBIENT = 0.42
HINTERGRUND_OBEN = (214, 217, 221)    # v1.6.81: grauer Studio-Hintergrund, oben hell ...
HINTERGRUND_UNTEN = (150, 154, 160)   # ... unten dunkler (leichter Verlauf)


def hintergrund(breite, hoehe):
    """Grauer Studio-Hintergrund (RGB, float32): senkrechter Verlauf, dazu ein weicher heller Fleck hinter dem Auto
    und eine leichte Abdunklung zu den Ecken."""
    y = np.linspace(0.0, 1.0, hoehe, dtype=np.float32)[:, None]
    x = np.linspace(-1.0, 1.0, breite, dtype=np.float32)[None, :]
    o = np.array(HINTERGRUND_OBEN, dtype=np.float32)
    u = np.array(HINTERGRUND_UNTEN, dtype=np.float32)
    t = (y ** 1.3)[..., None]
    bg = o * (1 - t) + u * t
    fleck = np.exp(-((x / 0.75) ** 2 + ((y - 0.55) / 0.45) ** 2))[..., None]
    ecke = np.clip(1.0 - 0.10 * (x ** 2)[..., None] - 0.06 * (y ** 2)[..., None], 0, 1)
    return np.clip(bg * ecke + 14.0 * fleck, 0, 255).astype(np.float32)


def auf_hintergrund(rgba):
    """PIL-RGBA (Auto/Hubschrauber mit Schatten, transparent) auf den grauen Hintergrund, deckendes RGB-Bild."""
    w, h = rgba.size
    bg = Image.fromarray(hintergrund(w, h).astype(np.uint8), "RGB").convert("RGBA")
    bg.alpha_composite(rgba)
    return bg.convert("RGB")

# Ab wie vielen Dreiecken wird fuer die Vorschau reduziert, auf wie viele?
REDUZIERE_AB = 3000000
REDUZIERE_ZIEL = 120000

# Bis zu dieser Flaechenzahl (in Pixeln) wird ein Dreieck mit der Meshgrid-Methode
# gefuellt (schnell fuer kleine Dreiecke), darueber per Scanline (schnell fuer grosse).
MESHGRID_MAX = 3000


def modell_pfade():
    """Alle Modellordner mit auto.json + auto.bin, sortiert; oder per Argument."""
    if len(sys.argv) > 1:
        return [os.path.abspath(a) for a in sys.argv[1:]]
    ordner = []
    for name in sorted(os.listdir(AUTOS)):
        p = os.path.join(AUTOS, name)
        if (os.path.isdir(p) and os.path.exists(os.path.join(p, "auto.json"))
                and os.path.exists(os.path.join(p, "auto.bin"))):
            ordner.append(p)
    return ordner


def lade(modell):
    """meta (dict), verts (N,8), daten (bytes), textur (dict name->RGBA-array)."""
    meta = json.load(open(os.path.join(modell, "auto.json"), encoding="utf-8"))
    daten = open(os.path.join(modell, "auto.bin"), "rb").read()
    n = meta["ecken"]
    verts = np.frombuffer(daten, dtype="<f4", count=n * 8, offset=0).reshape(n, 8).copy()
    textur = {}
    for t in meta["teile"]:
        if t["tex"] not in textur:
            textur[t["tex"]] = np.asarray(Image.open(os.path.join(modell, t["tex"])).convert("RGBA"))
    return meta, verts, daten, textur


def seiten_projektion(verts):
    """Seitenansicht: Kamera laengs +x (von rechts). +z (vorn) nach rechts, +y nach oben.
    Liefert eine Funktion, die (x,y,z)-Arrays zu (sx, sy, tiefe) mappt; tiefe = x (kleiner = naeher)."""
    z = verts[:, 2]
    y = verts[:, 1]
    zmin, zmax = float(z.min()), float(z.max())
    ymin, ymax = float(y.min()), float(y.max())
    dx = max(zmax - zmin, 1e-6)
    dy = max(ymax - ymin, 1e-6)
    skala = min((BREITE * (1 - 2 * RAND)) / dx, (HOEHE * (1 - 2 * RAND)) / dy)
    off_x = (BREITE - skala * dx) * 0.5 - skala * zmin
    off_y = HOEHE * BODEN + skala * ymin

    def bild(x, y, z):
        return off_x + skala * z, off_y - skala * y, x

    return bild


def _meshgrid(p, tex, tiefe, bild, glas):
    """Fuellung ueber das umschliessende Rechteck - schnell fuer kleine Dreiecke."""
    x0 = int(np.floor(p[:, 0].min()))
    x1 = int(np.ceil(p[:, 0].max()))
    y0 = int(np.floor(p[:, 1].min()))
    y1 = int(np.ceil(p[:, 1].max()))
    if x1 < 0 or y1 < 0 or x0 >= BREITE or y0 >= HOEHE:
        return
    x0 = max(0, x0); x1 = min(BREITE - 1, x1)
    y0 = max(0, y0); y1 = min(HOEHE - 1, y1)
    if x1 < x0 or y1 < y0:
        return
    ax, ay = p[0, 0], p[0, 1]
    bx, by = p[1, 0], p[1, 1]
    cx, cy = p[2, 0], p[2, 1]
    nenner = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(nenner) < 1e-9:
        return
    xs = np.arange(x0, x1 + 1)
    ys = np.arange(y0, y1 + 1)
    xx, yy = np.meshgrid(xs, ys)
    w0 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / nenner
    w1 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / nenner
    w2 = 1.0 - w0 - w1
    innen = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
    if not innen.any():
        return
    tt = w0 * p[0, 2] + w1 * p[1, 2] + w2 * p[2, 2]
    uu = w0 * p[0, 3] + w1 * p[1, 3] + w2 * p[2, 3]
    vv = w0 * p[0, 4] + w1 * p[1, 4] + w2 * p[2, 4]
    nx = w0 * p[0, 5] + w1 * p[1, 5] + w2 * p[2, 5]
    ny = w0 * p[0, 6] + w1 * p[1, 6] + w2 * p[2, 6]
    nz = w0 * p[0, 7] + w1 * p[1, 7] + w2 * p[2, 7]
    tw, th = tex.shape[1], tex.shape[0]
    tx = np.clip((uu - np.floor(uu)) * (tw - 1), 0, tw - 1).astype(int)
    ty = np.clip((vv - np.floor(vv)) * (th - 1), 0, th - 1).astype(int)
    tfarb = tex[ty, tx]
    sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
    vor = tiefe[sl]
    ztest = innen & (tt < vor)
    if not ztest.any():
        return
    beleuchtung = AMBIENT + (1.0 - AMBIENT) * (
        0.78 * np.clip(nx * LICHT[0] + ny * LICHT[1] + nz * LICHT[2], 0, 1)
        + 0.22 * np.clip(nx * FUELL[0] + ny * FUELL[1] + nz * FUELL[2], 0, 1))
    rgb = tfarb[..., :3].astype(np.float32) * beleuchtung[..., None]
    if glas:
        a = (tfarb[..., 3:4].astype(np.float32) / 255.0) * 0.85
        alt = bild[sl]
        neu = rgb * a + alt * (1.0 - a)
        bild[sl] = np.where(ztest[..., None], neu, alt)
    else:
        bild[sl] = np.where(ztest[..., None], rgb, bild[sl])
    tiefe[sl] = np.where(ztest, tt, vor)


def _scanline(p, tex, tiefe, bild, glas):
    """Scanline-Fuellung - nur vom Dreieck ueberdeckte Pixel, schnell fuer grosse Dreiecke."""
    ax, ay = p[0, 0], p[0, 1]
    bx, by = p[1, 0], p[1, 1]
    cx, cy = p[2, 0], p[2, 1]
    nenner = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(nenner) < 1e-9:
        return
    y0i = int(np.floor(min(ay, by, cy)))
    y1i = int(np.ceil(max(ay, by, cy)))
    if y1i < 0 or y0i >= HOEHE:
        return
    y0i = max(0, y0i); y1i = min(HOEHE - 1, y1i)
    if y1i < y0i:
        return
    kanten = ((0, 1), (1, 2), (2, 0))
    tw, th = tex.shape[1], tex.shape[0]
    for y in range(y0i, y1i + 1):
        yp = y + 0.5
        xs_int = []
        for i, j in kanten:
            ya = p[i, 1]; yb = p[j, 1]
            if (ya <= yp < yb) or (yb <= yp < ya):
                t = (yp - ya) / (yb - ya)
                xs_int.append(p[i, 0] + t * (p[j, 0] - p[i, 0]))
        if len(xs_int) < 2:
            continue
        xl, xr = min(xs_int), max(xs_int)
        x0 = max(0, int(np.ceil(xl)))
        x1 = min(BREITE - 1, int(np.floor(xr)))
        if x1 < x0:
            continue
        xp = np.arange(x0, x1 + 1, dtype=np.float32) + 0.5
        w0 = ((by - cy) * (xp - cx) + (cx - bx) * (yp - cy)) / nenner
        w1 = ((cy - ay) * (xp - cx) + (ax - cx) * (yp - cy)) / nenner
        w2 = 1.0 - w0 - w1
        innen = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not innen.any():
            continue
        tt = w0 * p[0, 2] + w1 * p[1, 2] + w2 * p[2, 2]
        uu = w0 * p[0, 3] + w1 * p[1, 3] + w2 * p[2, 3]
        vv = w0 * p[0, 4] + w1 * p[1, 4] + w2 * p[2, 4]
        nx = w0 * p[0, 5] + w1 * p[1, 5] + w2 * p[2, 5]
        ny = w0 * p[0, 6] + w1 * p[1, 6] + w2 * p[2, 6]
        nz = w0 * p[0, 7] + w1 * p[1, 7] + w2 * p[2, 7]
        tx = np.clip((uu - np.floor(uu)) * (tw - 1), 0, tw - 1).astype(int)
        ty = np.clip((vv - np.floor(vv)) * (th - 1), 0, th - 1).astype(int)
        tfarb = tex[ty, tx]
        vor = tiefe[y, x0:x1 + 1]
        ztest = innen & (tt < vor)
        if not ztest.any():
            continue
        beleuchtung = AMBIENT + (1.0 - AMBIENT) * (
            0.78 * np.clip(nx * LICHT[0] + ny * LICHT[1] + nz * LICHT[2], 0, 1)
            + 0.22 * np.clip(nx * FUELL[0] + ny * FUELL[1] + nz * FUELL[2], 0, 1))
        rgb = tfarb[..., :3].astype(np.float32) * beleuchtung[..., None]
        sl = (y, slice(x0, x1 + 1))
        if glas:
            a = (tfarb[..., 3:4].astype(np.float32) / 255.0) * 0.85
            alt = bild[sl]
            neu = rgb * a + alt * (1.0 - a)
            bild[sl] = np.where(ztest[..., None], neu, alt)
        else:
            bild[sl] = np.where(ztest[..., None], rgb, bild[sl])
        tiefe[sl] = np.where(ztest, tt, vor)


def rasterisiere(p, tex, tiefe, bild, glas):
    """Waehlt je nach Groesse: meshgrid (klein) oder Scanline (gross)."""
    x0 = int(np.floor(p[:, 0].min()))
    x1 = int(np.ceil(p[:, 0].max()))
    y0 = int(np.floor(p[:, 1].min()))
    y1 = int(np.ceil(p[:, 1].max()))
    flaeche = (max(x1, 0) - min(x0, BREITE - 1) + 1) * (max(y1, 0) - min(y0, HOEHE - 1) + 1)
    if flaeche <= MESHGRID_MAX:
        _meshgrid(p, tex, tiefe, bild, glas)
    else:
        _scanline(p, tex, tiefe, bild, glas)


def decimiere(verts, teile_alt, daten, ab, ziel):
    """Vertex-Clustering ueber ALLE Ecken (global, keine Risse zwischen Teilen).
    Liefert (verts_neu, teile_neu), wobei teile_neu ein 'idx'-Array in die neuen Ecken hat."""
    n = verts.shape[0]
    pos = verts[:, :3]
    lo = pos.min(axis=0)
    span = pos.max(axis=0) - lo
    # Fein starten, dann vergroebern, bis etwa `ziel` belegte Zellen uebrig bleiben.
    kante = max(span.max(), 1e-6) / 128.0
    eindeutig = None
    inv = None
    for _ in range(60):
        cell = ((pos - lo) / kante).astype(np.int64)
        zell_id = cell[:, 0] * 1000000 + cell[:, 1] * 1000 + cell[:, 2]
        eindeutig, inv = np.unique(zell_id, return_inverse=True)
        if eindeutig.size <= ziel:
            break
        kante *= 1.3
    # Repraesentant je Zelle: die Ecke am naechsten am Zellzentrum (behaelt UV + Normale).
    centro = np.zeros((eindeutig.size, 3), dtype=np.float64)
    np.add.at(centro, inv, pos)
    anzahl = np.bincount(inv, minlength=eindeutig.size).astype(np.float64)[:, None]
    centro /= anzahl
    dist = ((pos - centro[inv]) ** 2).sum(axis=1)
    sort = np.argsort(dist, kind="stable")
    inv_sort = inv[sort]
    erste = np.ones(n, dtype=bool)
    erste[1:] = inv_sort[1:] != inv_sort[:-1]
    rep = np.empty(eindeutig.size, dtype=np.int64)
    rep[inv_sort[erste]] = sort[erste]
    verts_neu = verts[rep]
    teile_neu = []
    for t in teile_alt:
        idx = np.frombuffer(daten, dtype="<u2", count=t["indizes"],
                            offset=ab + t["index0"] * 2).astype(np.int64) + t["ecke0"]
        if idx.size < 3:
            continue
        neu = inv[idx].reshape(-1, 3)
        keep = (neu[:, 0] != neu[:, 1]) & (neu[:, 1] != neu[:, 2]) & (neu[:, 0] != neu[:, 2])
        neu = neu[keep].astype(np.uint32)
        if neu.size:
            teile_neu.append({"name": t.get("name", ""), "rolle": t.get("rolle"),
                              "gruppe": t.get("gruppe"), "tex": t["tex"], "idx": neu})
    return verts_neu, teile_neu


def _lade_fallback_rad():
    """Gemeinsamer Rad-Fallback wie im Spiel: die Rad-Teile der Vulture V5.R (mit Texturen),
    damit auch Modelle ohne eigene Rad-Geometrie (z. B. FMC GT4, Boxer 96, Lynx 220) Raeder
    zeigen. Liefert (verts, textur, teile) mit teile[i]['idx'] als 1D-Eckenindex."""
    pfad = os.path.join(AUTOS, "v5r")
    if not os.path.exists(os.path.join(pfad, "auto.json")):
        return None
    meta, verts, daten, textur = lade(pfad)
    ab = meta["indexAb"]
    teile = []
    for t in meta["teile"]:
        if t.get("gruppe") != "rad":
            continue
        idx = (np.frombuffer(daten, dtype="<u2", count=t["indizes"],
                             offset=ab + t["index0"] * 2).astype(np.int64) + t["ecke0"])
        teile.append({"name": t.get("name"), "rolle": t.get("rolle"), "gruppe": t.get("gruppe"),
                      "tex": t["tex"], "achse": t.get("achse"), "idx": idx})
    if not teile:
        return None
    return verts, textur, teile


def zeichne(meta, verts, daten, textur):
    """Rendert das Modell als Seitenansicht, gibt das PIL-Bild zurueck."""
    tiefe = np.full((HOEHE, BREITE), np.inf, dtype=np.float32)
    # v1.6.81: Glas mischt gegen den echten Hintergrund (grauer Verlauf).
    bild = hintergrund(BREITE, HOEHE)

    ab = meta["indexAb"]
    gesamt = sum(t["indizes"] for t in meta["teile"]) // 3
    if gesamt > REDUZIERE_AB:
        verts, teile = decimiere(verts, meta["teile"], daten, ab, REDUZIERE_ZIEL)
    else:
        teile = [{"name": t.get("name"), "rolle": t.get("rolle"), "gruppe": t.get("gruppe"),
                  "tex": t["tex"],
                  "idx": (np.frombuffer(daten, dtype="<u2", count=t["indizes"],
                                        offset=ab + t["index0"] * 2).astype(np.int64) + t["ecke0"])}
                 for t in meta["teile"]]

    # Projektion aus der Karosserie (ohne Raeder - die liegen im Modell am Ursprung).
    # v1.5.157: Bei reduzierten Modellen ist t["idx"] (T,3) (je Dreieck drei Ecken); fuer die
    # Projektion muss der Index flach (1D) sein, sonst wird verts[koerper_idx] 3D und die
    # Rahmenbox falsch (Auto viel zu klein). reshape(-1) macht aus beiden Formen 1D.
    koerper_idx = np.concatenate([t["idx"].reshape(-1) for t in teile if t.get("gruppe") != "rad"]) \
        if any(t.get("gruppe") != "rad" for t in teile) else np.arange(verts.shape[0])
    ph = meta["physik"]
    achs = {"vorn": ph["vorderachse"], "hinten": ph["hinterachse"]}
    # v1.6.81: Aufbau wie im Spiel um die Bodenfreiheit angehoben (vfModellZeichnen: vfT(0, boden, ...)); die Raeder
    # stehen auf y = 0. Der Ausschnitt umfasst Karosserie und Raeder.
    boden = (ph["reifen"]["vorn"].get("bodenfreiheit", 0) + ph["reifen"]["hinten"].get("bodenfreiheit", 0)) / 2
    kverts = verts.copy()
    kverts[:, 1] += boden
    rahmen = [kverts[koerper_idx, :3]]
    for ax in ("vorn", "hinten"):
        r = ph["reifen"][ax]
        for dz, y in ((-r["radius"], 0.0), (r["radius"], 0.0), (0.0, 2 * r["radius"])):
            rahmen.append(np.array([[0.0, y, achs[ax] + dz]], dtype=np.float32))
    proj = seiten_projektion(np.concatenate(rahmen))
    sx_all, sy_all, tf_all = proj(kverts[:, 0], kverts[:, 1], kverts[:, 2])

    # Eigene Raeder des Modells, sonst der gemeinsame Rad-Fallback (Vulture V5.R) wie im Spiel,
    # damit auch Modelle ohne eigene Rad-Geometrie (FMC GT4, Boxer 96, Lynx 220) Raeder zeigen.
    rad_teile = [t for t in teile if t.get("gruppe") == "rad"]
    rad_quelle = (verts, textur, rad_teile) if rad_teile else _lade_fallback_rad()

    def rad_zeichne(quelle, seite, ax):
        if quelle is None:
            return
        rverts, rtex, rteile = quelle
        r = ph["reifen"][ax]
        z = achs[ax]
        skala = np.array([seite * r["breite"], 2 * r["radius"], 2 * r["radius"]])
        versatz = np.array([seite * r["spur"] / 2, r["radius"], z])
        for t in rteile:
            if t.get("achse") and t.get("achse") != ax:
                continue
            idx = t["idx"]
            if idx.size < 3:
                continue
            T = idx.size // 3
            tex = rtex[t["tex"]]
            pos = (rverts[idx, :3] * skala + versatz).reshape(T, 3, 3)   # (T,3,3)
            sx, sy, tf = proj(pos[:, :, 0], pos[:, :, 1], pos[:, :, 2])
            uu = rverts[idx, 6].reshape(T, 3)
            vv = rverts[idx, 7].reshape(T, 3)
            nx = rverts[idx, 3].reshape(T, 3) * seite
            ny = rverts[idx, 4].reshape(T, 3)
            nz = rverts[idx, 5].reshape(T, 3)
            # v1.5.157: kein Backface-Culling - das Rad zeigt so unabhaengig von Windung/Orientierung
            # immer seine Aussenflaeche; die nahe Seite gewinnt die Tiefe, die ferne bleibt verdeckt.
            for i in range(T):
                p = np.empty((3, 8), dtype=np.float32)
                p[:, 0] = sx[i]; p[:, 1] = sy[i]; p[:, 2] = tf[i]
                p[:, 3] = uu[i]; p[:, 4] = vv[i]
                p[:, 5] = nx[i]; p[:, 6] = ny[i]; p[:, 7] = nz[i]
                rasterisiere(p, tex, tiefe, bild, False)

    for t in teile:
        idx = t["idx"]
        if idx.size < 3:
            continue
        if t.get("gruppe") == "rad":
            continue
        T = idx.size // 3
        tex = textur[t["tex"]]
        glas = t.get("rolle") in GLAS_ROLLEN
        sx = sx_all[idx].reshape(T, 3)
        sy = sy_all[idx].reshape(T, 3)
        tf = tf_all[idx].reshape(T, 3)
        uu = verts[idx, 6].reshape(T, 3)
        vv = verts[idx, 7].reshape(T, 3)
        nx = verts[idx, 3].reshape(T, 3)
        ny = verts[idx, 4].reshape(T, 3)
        nz = verts[idx, 5].reshape(T, 3)
        flaeche = (sx[:, 1] - sx[:, 0]) * (sy[:, 2] - sy[:, 0]) - (sx[:, 2] - sx[:, 0]) * (sy[:, 1] - sy[:, 0])
        for i in range(T):
            if flaeche[i] >= 0:
                continue
            p = np.empty((3, 8), dtype=np.float32)
            p[:, 0] = sx[i]; p[:, 1] = sy[i]; p[:, 2] = tf[i]
            p[:, 3] = uu[i]; p[:, 4] = vv[i]
            p[:, 5] = nx[i]; p[:, 6] = ny[i]; p[:, 7] = nz[i]
            rasterisiere(p, tex, tiefe, bild, glas)

    # Raeder auf beide Seiten (Kamera bei -x): die nahe (seite -1) ist gespiegelt und zeigt so die
    # Felge/Aussenseite zur Kamera; die ferne liegt hinter der Karosserie.
    for seite in (-1, 1):
        for ax in ("vorn", "hinten"):
            rad_zeichne(rad_quelle, seite, ax)
    return mit_alpha_und_schatten(bild, tiefe)


def mit_alpha_und_schatten(bild, tiefe):
    """Auto mit Alphakanal (Deckung aus der Tiefe) ueber einem weichen Bodenschatten, verkleinert auf
    AUS_BREITE x AUS_HOEHE. Der Schatten ist eine verwischte Ellipse unter dem Auto, 55 % dunkel."""
    from PIL import ImageDraw, ImageFilter
    deck = np.isfinite(tiefe)
    ys, xs = np.nonzero(deck)
    rgba = np.zeros((HOEHE, BREITE, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.clip(bild, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(deck, 255, 0).astype(np.uint8)
    auto = Image.fromarray(rgba, "RGBA")
    schatten = Image.new("RGBA", (BREITE, HOEHE), (0, 0, 0, 0))
    if len(xs):
        x0, x1, yb = xs.min(), xs.max(), ys.max()
        b = (x1 - x0) * 0.52
        cx = (x0 + x1) / 2
        h = max(4, (x1 - x0) * 0.045)
        m = Image.new("L", (BREITE, HOEHE), 0)
        ImageDraw.Draw(m).ellipse([cx - b, yb - h, cx + b, yb + h * 0.8], fill=140)
        m = m.filter(ImageFilter.GaussianBlur(radius=h * 1.1))
        schatten.putalpha(m)
    schatten.alpha_composite(auto)
    return schatten.resize((AUS_BREITE, AUS_HOEHE), Image.LANCZOS)


def heli():
    """Hubschrauber (tools/heli_vorschau.py) auf denselben Hintergrund -> img/vf/vorschau.png."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import heli_vorschau
    ziel = os.path.join(REPO, "img", "vf", "vorschau.png")
    auf_hintergrund(heli_vorschau.rendern()).save(ziel, "PNG", optimize=True)
    print("heli ->", ziel)


def main():
    nur_heli = sys.argv[1:] == ["heli"]
    pfade = [] if nur_heli else modell_pfade()
    if not pfade and not nur_heli:
        print("Keine Modelle gefunden (img/autos/*/auto.json).")
        return 1
    for p in pfade:
        name = os.path.basename(p)
        meta, verts, daten, textur = lade(p)
        img = auf_hintergrund(zeichne(meta, verts, daten, textur))
        ziel = os.path.join(p, "vorschau.png")
        img.save(ziel, "PNG", optimize=True)
        print("%s: %d Dreiecke -> %s" % (name, sum(t["indizes"] for t in meta["teile"]) // 3, ziel))
    if nur_heli or len(sys.argv) == 1:
        heli()
    return 0


if __name__ == "__main__":
    sys.exit(main())
