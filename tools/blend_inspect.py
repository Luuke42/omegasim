#!/usr/bin/env python3
"""RC-Stunt-Copter-Modell: Orientierung und Teilung bestimmen (Nase/Heck, Rotor).
Aufruf:  blender -b --python tools/blend_inspect.py -- <pfad>.blend
"""
import bpy
import mathutils
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pfad = argv[0] if argv else 'RcHeli_1.blend'
bpy.ops.wm.open_mainfile(filepath=pfad)

def wminmax(o):
    mn = [1e18] * 3
    mx = [-1e18] * 3
    for corner in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(corner)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

print('%-12s %-28s | min               max' % ('obj', 'name'))
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mn, mx = wminmax(o)
    print('%-12s %-28s | [%.3f %.3f %.3f] [%.3f %.3f %.3f]' %
          (o.name, o.name, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]))

# Um welchen Punkt liegt der Hauptrotor (Mast)? Mitte der Rotor-BBox in Z.
rot = bpy.data.objects.get('Rotor')
if rot:
    mn, mx = wminmax(rot)
    print('Rotor center = (%.3f, %.3f, %.3f)' % ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2))
