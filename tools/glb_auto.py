#!/usr/bin/env python3
"""Ein Auto aus einer glTF-Binaerdatei (.glb, z. B. von Sketchfab) fuer die virtuelle Fahrt umwandeln.

    python tools/glb_auto.py <datei.glb> <Kennung> [--name "Anzeigename"] [--lack <skin.png>]

v1.6.27: zuerst fuer den "2019 Audi RS5 DTM" von Dave Love (Sketchfab, CC BY 4.0, siehe
img/autos/audirs5/LIZENZ.txt). Geschrieben wird nach img/autos/<Kennung>/ im selben Format wie tools/sd_auto.py:
  auto.bin   alle Ecken (Float32: x y z nx ny nz u v) und danach alle Indizes (Uint16, je Teil ab dessen ecke0)
  auto.json  Teile (Rolle, Textur, Bereiche in auto.bin), Lichter, Haube, Fahrzeugdaten (geschaetzt, WIP)
  *.jpg/png  die Texturen, verkleinert (hoechstens MAX_TEX Pixel; JPG, wenn sie keinen Alphakanal brauchen)
  shadow.png ein weicher Schattenfleck (selbst gezeichnet)

KOORDINATEN: glTF hat +y oben und (bei diesem Modell) +z vorn; rechtshaendig zeigt +x dann nach links - genau die
Konvention der App (+x links, +y oben, +z vorn). Es wird also nichts gedreht, nur in Metern belassen.

RAEDER: Die App zeichnet je Achse EIN Rad (gruppe 'rad', achse 'vorn'/'hinten') als Einheitsrad: Breite 1 laengs x,
Durchmesser 1 in y und z, Mitte im Ursprung, Aussenseite bei +x (das rechte Rad wird gespiegelt). Genommen wird das
linke Rad (x > 0) jeder Achse aus Felge, Nabe, Reifen und Lauffläche; Bremse und Scheibe drehen nicht und fallen weg.

WEGGELASSEN: der grosse Innenraum-Teil (Cockpit), Anzeigen, Fahrerschild und die unscharfe Felge (Rim_Blur) -
von aussen kaum zu sehen und gut ein Drittel aller Dreiecke.
"""
import io
import json
import math
import os
import struct
import sys

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MAX_TEX = 1024

# Materialname (Anfang) -> Rolle; None = weglassen. Erste passende gewinnt.
ROLLEN = [
    ('EXT_CarPaint', 'karosserie'), ('EXT_Misc', 'anbau'), ('AUDI_RS5_GRILL', 'anbau'), ('MIRROR', 'anbau'),
    ('EXT_Lights', 'licht'), ('EXT_Windows_Frame', 'anbau'), ('EXT_Windows', 'glas'), ('EXT_Number', 'anbau'),
    ('INT_Carbon', 'anbau'), ('INT_Cage', 'anbau'), ('INT_Dash', 'anbau'), ('INT_Steer', 'anbau'),
    ('EXT_Rims', 'rad'), ('EXT_Rim_Hub', 'rad'), ('EXT_Tire_Tread', 'rad'), ('EXT_Tire_Inside', 'rad'), ('EXT_Tire', 'rad'),
    ('EXT_Rim_Blur', None), ('EXT_Disc', None), ('EXT_Brakes', None), ('INT_', None), ('T5_', None),
]


def rolle_fuer(mat):
    for anfang, r in ROLLEN:
        if mat.startswith(anfang):
            return r
    return None


LACK = None   # --lack <png>: eigene Lackierung (Skin) statt der Grundfarbe des Lackmaterials


def textur_speichern(mat, ziel, kennung, schon):
    """Grundfarb-Textur des Materials verkleinert speichern; gibt den Dateinamen zurueck."""
    name = mat.name.split('.')[0].lower()
    if name in schon:
        return schon[name]
    im = getattr(mat, 'baseColorTexture', None)
    # Beim Audi liegt die Lackierung (Castrol-Skin) als eigene Datei bei; die Grundfarbe des Lackmaterials ist schwarz.
    if LACK and mat.name.startswith('EXT_CarPaint'):
        im = Image.open(LACK)
    if im is None:
        f = getattr(mat, 'baseColorFactor', None)
        farbe = tuple(int(c) for c in (f[:3] if f is not None else (180, 180, 180)))
        im = Image.new('RGB', (4, 4), farbe)
    im = im.convert('RGBA')
    if max(im.size) > MAX_TEX:
        s = MAX_TEX / max(im.size)
        im = im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS)
    # Nur Materialien mit alphaMode BLEND/MASK brauchen den Alphakanal; OPAQUE ignoriert ihn (beim Lack steht dort 0).
    modus = str(getattr(mat, 'alphaMode', None) or 'OPAQUE').upper()
    braucht_alpha = modus in ('BLEND', 'MASK') and im.getchannel('A').getextrema()[0] < 250
    datei = kennung + '_' + name + ('.png' if braucht_alpha else '.jpg')
    if braucht_alpha:
        im.save(os.path.join(ziel, datei), optimize=True)
    else:
        im.convert('RGB').save(os.path.join(ziel, datei), quality=86, optimize=True)
    schon[name] = datei
    return datei


def schatten_bauen(ziel):
    w, h = 128, 256
    im = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([18, 18, w - 18, h - 18], radius=30, fill=200)
    im = im.filter(ImageFilter.GaussianBlur(12))
    rgba = Image.merge('RGBA', (Image.new('L', (w, h), 0),) * 3 + (im,))
    rgba.save(os.path.join(ziel, 'shadow.png'), optimize=True)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    quelle, kennung = sys.argv[1], sys.argv[2]
    anzeige = sys.argv[sys.argv.index('--name') + 1] if '--name' in sys.argv else kennung
    global LACK
    LACK = sys.argv[sys.argv.index('--lack') + 1] if '--lack' in sys.argv else None
    ziel = os.path.join(REPO, 'img', 'autos', kennung)
    os.makedirs(ziel, exist_ok=True)
    sc = trimesh.load(quelle, force='scene')

    # Alle Teile in Weltlage sammeln.
    stuecke = []
    for knoten in sc.graph.nodes_geometry:
        T, g = sc.graph[knoten]
        m = sc.geometry[g]
        mat = m.visual.material
        r = rolle_fuer(mat.name)
        if r is None:
            continue
        v = trimesh.transform_points(m.vertices, T)
        n = m.vertex_normals @ T[:3, :3].T
        n = n / np.maximum(1e-9, np.linalg.norm(n, axis=1, keepdims=True))
        uv = m.visual.uv if getattr(m.visual, 'uv', None) is not None else np.zeros((len(v), 2))
        stuecke.append({'mat': mat, 'rolle': r, 'v': v, 'n': n, 'uv': np.asarray(uv, dtype=np.float64), 'f': np.asarray(m.faces)})

    # Raeder: Reifen links vorn/hinten bestimmen (Mitte, Radius, Breite).
    # Masse aus Reifen, Laufflaeche und Innenseite zusammen (der Teil EXT_Tire allein ist nur die Flanke).
    rv = np.vstack([s['v'] for s in stuecke if s['mat'].name.startswith('EXT_Tire')])
    achsen = {}
    for ax, sel in (('vorn', (rv[:, 0] > 0) & (rv[:, 2] > 0)), ('hinten', (rv[:, 0] > 0) & (rv[:, 2] < 0))):
        p = rv[sel]
        lo, hi = p.min(0), p.max(0)
        mitte = (lo + hi) / 2
        achsen[ax] = {'mitte': mitte, 'radius': float((hi[1] - lo[1]) / 2), 'breite': float(hi[0] - lo[0])}

    ecken, indizes, teile = [], [], []
    texs = {}

    def teil_anhaengen(name, rolle, gruppe, tex, v, n, uv, f, achse=None):
        # Je Teil hoechstens 65535 Ecken (Uint16-Indizes ab ecke0).
        if len(v) > 65535:
            raise SystemExit('Teil zu gross: ' + name)
        e0, i0 = len(ecken), len(indizes)
        for k in range(len(v)):
            ecken.append((float(v[k, 0]), float(v[k, 1]), float(v[k, 2]), float(n[k, 0]), float(n[k, 1]), float(n[k, 2]),
                          float(uv[k, 0]), float(uv[k, 1])))
        indizes.extend(int(x) for x in f.reshape(-1))
        t = {'name': name, 'rolle': rolle, 'gruppe': gruppe, 'tex': tex, 'ecke0': e0, 'ecken': len(v), 'index0': i0, 'indizes': len(f) * 3}
        if achse:
            t['achse'] = achse
        teile.append(t)

    def unter(s, maske):
        """Teilnetz aus den Dreiecken, deren Ecken alle in maske liegen."""
        fm = maske[s['f']].all(axis=1)
        f = s['f'][fm]
        benutzt = np.unique(f)
        neu = -np.ones(len(s['v']), dtype=np.int64)
        neu[benutzt] = np.arange(len(benutzt))
        return s['v'][benutzt], s['n'][benutzt], s['uv'][benutzt], neu[f]

    for s in stuecke:
        tex = textur_speichern(s['mat'], ziel, kennung, texs)
        name = s['mat'].name.split('.')[0]
        if s['rolle'] == 'rad':
            for ax, A in achsen.items():
                c, R, B = A['mitte'], A['radius'], A['breite']
                v = s['v']
                maske = (np.abs(v[:, 0] - c[0]) < B * 1.2) & (np.abs(v[:, 1] - c[1]) < R * 1.25) & (np.abs(v[:, 2] - c[2]) < R * 1.25)
                vv, nn, uu, ff = unter(s, maske)
                if not len(ff):
                    continue
                einh = np.column_stack(((vv[:, 0] - c[0]) / B, (vv[:, 1] - c[1]) / (2 * R), (vv[:, 2] - c[2]) / (2 * R)))
                nn = np.column_stack((nn[:, 0] * B, nn[:, 1] * 2 * R, nn[:, 2] * 2 * R))   # Normalen gegen die Skalierung
                nn = nn / np.maximum(1e-9, np.linalg.norm(nn, axis=1, keepdims=True))
                teil_anhaengen(name + ' ' + ax, 'rad', 'rad', tex, einh, nn, uu, ff, ax)
        elif s['rolle'] == 'licht':
            v = s['v']
            for teilname, rolle, maske in (('Scheinwerfer', 'scheinwerfer', v[:, 2] > 0), ('Ruecklichter', 'ruecklicht', v[:, 2] <= 0)):
                vv, nn, uu, ff = unter(s, maske)
                if len(ff):
                    teil_anhaengen(teilname, rolle, 'auto', tex, vv, nn, uu, ff)
        else:
            teil_anhaengen(name, s['rolle'], 'auto', tex, s['v'], s['n'], s['uv'], s['f'])

    alle = np.array([e[:3] for e in ecken if True])
    aufbau = np.vstack([s['v'] for s in stuecke if s['rolle'] != 'rad'])
    lo, hi = aufbau.min(0), aufbau.max(0)
    laenge, breite, hoehe = float(hi[2] - lo[2]), float(hi[0] - lo[0]), float(hi[1] - lo[1])
    vz, hz = float(achsen['vorn']['mitte'][2]), float(achsen['hinten']['mitte'][2])
    radstand = vz - hz

    # Lichter aus den Lichtteilen: je Seite die Mitte der vorderen bzw. hinteren Leuchten.
    lv = next(s for s in stuecke if s['rolle'] == 'licht')['v']

    def leuchten(maske, r):
        out = []
        for seite in (1, -1):
            p = lv[maske & (lv[:, 0] * seite > 0.2)]
            if len(p):
                m = (p.min(0) + p.max(0)) / 2
                out.append([round(float(m[0]), 3), round(float(m[1]), 3), round(float(p[:, 2].max() if r > 0 else p[:, 2].min()), 3), 0.14])
        return out
    front, rueck = leuchten(lv[:, 2] > 0, 1), leuchten(lv[:, 2] <= 0, -1)

    rv_, rh_ = achsen['vorn'], achsen['hinten']
    meta = {
        'name': anzeige, 'kennung': kennung,
        'quelle': '"2019 Audi RS5 DTM" (https://skfb.ly/pMuFP) von Dave Love, Sketchfab; umgewandelt mit tools/glb_auto.py',
        'lizenz': 'CC BY 4.0, siehe LIZENZ.txt',
        'koordinaten': 'm; +x links, +y oben, +z vorn',
        'ecken': len(ecken), 'indizes': len(indizes), 'indexAb': len(ecken) * 32, 'schritt': 32,
        'schatten': 'shadow.png',
        'lichter': {'front': front, 'rueck': rueck, 'brems': [l[:3] + [0.16] for l in rueck]},
        'haube': {'vor': 0.62, 'hoch': 1.02},
        # Fahrdaten GESCHAETZT (WIP): DTM 2019 (Class One) nach oeffentlichen Eckdaten - ~1115 kg ohne Fahrer, Radstand
        # aus dem Modell, Turbo-Vierzylinder bis ~9500/min, grosser Front- und Heckfluegel. Federn wie beim Spider NG1.
        'physik': {
            'masse': 1190.0, 'schwerpunktHoehe': 0.3, 'radstand': round(radstand, 4),
            'a': round(radstand * 0.5, 4), 'b': round(radstand * 0.5, 4),
            'vorderachse': round(vz, 4), 'hinterachse': round(hz, 4),
            'laenge': round(laenge, 3), 'breite': round(breite, 3), 'hoehe': round(hoehe, 3),
            'massenVerteilung': 0.8, 'lenkGrad': 30.0, 'bremsVorn': 0.57, 'cx': 0.42, 'stirnflaeche': 1.9,
            'auftriebVorn': 0.45, 'auftriebHinten': 0.5, 'fluegelVorn': 0.3, 'fluegelHinten': 0.55,
            'leerlauf': 1500.0, 'begrenzer': 9500.0,
            'reifen': {
                'vorn': {'radius': round(rv_['radius'], 4), 'breite': round(rv_['breite'], 4), 'spur': round(2 * float(rv_['mitte'][0]), 4), 'bodenfreiheit': 0.05, 'mu': 1.3},
                'hinten': {'radius': round(rh_['radius'], 4), 'breite': round(rh_['breite'], 4), 'spur': round(2 * float(rh_['mitte'][0]), 4), 'bodenfreiheit': 0.05, 'mu': 1.3},
            },
            'feder': {'vorn': {'k': 140000.0, 'druck': 12500.0, 'zug': 19000.0, 'weg': 0.07, 'stab': 60000.0},
                      'hinten': {'k': 130000.0, 'druck': 11000.0, 'zug': 18000.0, 'weg': 0.07, 'stab': 30000.0}},
            'gefedert': 1080.0,
        },
        'teile': teile,
    }
    with open(os.path.join(ziel, 'auto.bin'), 'wb') as f:
        f.write(b''.join(struct.pack('<8f', *e) for e in ecken))
        f.write(struct.pack('<%dH' % len(indizes), *indizes))
    with io.open(os.path.join(ziel, 'auto.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    schatten_bauen(ziel)
    print('Ecken', len(ecken), 'Indizes', len(indizes), 'Teile', len(teile), 'Laenge', round(laenge, 3), 'Radstand', round(radstand, 3),
          'Rad vorn', round(rv_['radius'], 3), round(rv_['breite'], 3), round(float(rv_['mitte'][0]), 3))


if __name__ == '__main__':
    main()
