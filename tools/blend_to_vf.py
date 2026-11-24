#!/usr/bin/env python3
"""Den RC-Stunt-Copter (TREX 700) aus .blend in die App-Eckenform (x y z r g b) umwandeln.

Aufruf (mit Blender):  blender -b --python tools/blend_to_vf.py -- <pfad>.blend <ausgabe.json>

Ausgabedatei (JSON):  { "skala": <f>, "koordinaten": "...", "body": [x,y,z,r,g,b, ...],
                        "rotor": [x,y,z,r,g,b, ...], "bodyFaces": n, "rotorFaces": n,
                        "quelle": "...", "lizenz": "..." }

Koordinaten der App: +x links, +y oben, +z vorn. Das Modell hat +y Nase, +z oben, +x Breite.
Also  (ax, ay, az) = (tx, tz, ty) * skala  (Nase +y -> +z vorn, oben +z -> +y oben).
"""
import bpy
import json
import struct
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pfad = argv[0] if argv else 'RcHeli_1.blend'
aus_bin = argv[1] if len(argv) > 1 else 'img/vf/hub.bin'
aus_json = argv[2] if len(argv) > 2 else 'img/vf/hub.json'

# Massstab: Gesamtlaenge des Modells (mit Rotor) auf die Laenge des bisherigen Kasten-Hubschraubers
# bringen (Vorbild-Kasten ist ~6,37 Einheiten lang). Aus der BBox: 1,752 Einheiten -> Faktor.
SKALA = 3.64

bpy.ops.wm.open_mainfile(filepath=pfad)

# Objekte nach Rolle: body = Heli + canopy + Tail, rotor = Rotor
BODY_NAMEN = ('Heli', 'canopy', 'Tail')
ROTOR_NAMEN = ('Rotor',)

def farbe_fuer(material):
    """Diffusfarbe des Materials (oder ein Ersatz)."""
    if material and material.diffuse_color:
        c = material.diffuse_color
        return (c[0], c[1], c[2])
    return (0.7, 0.7, 0.7)

def sammeln(objekte, ziel):
    """Objekte in ziel ([x,y,z,r,g,b,...]) einsammeln (Weltkoordinaten, gedreht, skaliert)."""
    start = len(ziel)
    for o in objekte:
        me = o.data
        # Dreiecke bestimmen (auch bei Quads/Fans).
        me.calc_loop_triangles()
        mw = o.matrix_world
        for tri in me.loop_triangles:
            mat = None
            if tri.material_index < len(me.materials):
                mat = me.materials[tri.material_index]
            r, g, b = farbe_fuer(mat)
            for vi in tri.vertices:
                co = mw @ me.vertices[vi].co
                # (ax, ay, az) = (tx, tz, ty) * skala
                ziel.append(co.x * SKALA)
                ziel.append(co.z * SKALA)
                ziel.append(co.y * SKALA)
                ziel.append(r)
                ziel.append(g)
                ziel.append(b)
    return (len(ziel) - start) // 6

body = []
rotor = []
bf = sammeln([bpy.data.objects[n] for n in BODY_NAMEN if n in bpy.data.objects], body)
rf = sammeln([bpy.data.objects[n] for n in ROTOR_NAMEN if n in bpy.data.objects], rotor)

# Binärdatei: [uint32 bodyEcken][uint32 rotorEcken][body floats][rotor floats] (Float32, 6 je Ecke).
roh = struct.pack('<II', bf, rf) + struct.pack('<%df' % len(body), *body) + struct.pack('<%df' % len(rotor), *rotor)
import os
os.makedirs(os.path.dirname(aus_bin) or '.', exist_ok=True)
with open(aus_bin, 'wb') as f:
    f.write(roh)

meta = {
    'skala': SKALA,
    'koordinaten': 'App-Einheiten; +x links, +y oben, +z vorn (Modell +y Nase, +z oben, gedreht)',
    'bodyFaces': bf // 3,
    'rotorFaces': rf // 3,
    'eckenBody': bf,
    'eckenRotor': rf,
    'quelle': 'TREX 700 RC Stunt Copter, Modell von Belzar Sirus (Sketchfab, CC BY 4.0), '
              'https://skfb.ly/6BDFN',
    'lizenz': 'CC BY 4.0 (Belzar Sirus)',
}
with open(aus_json, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(meta, f, ensure_ascii=False)
print('OK: body %d faces, rotor %d faces, bodyEcken %d, rotorEcken %d -> %s (%d Bytes), %s'
      % (bf // 3, rf // 3, bf, rf, aus_bin, len(roh), aus_json))
