#!/usr/bin/env python3
"""Ein Auto aus Speed Dreams (Modell .acc, Daten .xml, Texturen) fuer die virtuelle Fahrt umwandeln.

    python tools/sd_auto.py <Ordner des Autos aus speed-dreams data/cars/models/...> <Kennung>

BESTELLT (v1.1.9): "Baue das v5r Auto aus Speeddreams ein. Das Auto soll auch Lichter und Bremslichter
haben und sich beim Lenken, Gas geben und Bremsen entsprechend verhalten durch Neigung ueber simulierte
Stossdaempfer." Quelle: der Vulture V5R (ls1-vulture-v5r) aus dem Speed-Dreams-SVN, GPL-2 oder spaeter
(siehe den Kopf der .xml). Die Ergebnisse stehen unter derselben Lizenz; LIZENZ.txt liegt daneben.

Geschrieben wird nach img/autos/<Kennung>/:
  auto.bin   alle Ecken (Float32: x y z nx ny nz u v) und danach alle Indizes (Uint16)
  auto.json  Teile (Rolle, Textur, Bereiche in auto.bin), Rad, Lichter, Fahrzeugdaten aus der .xml
  *.jpg/png  die Texturen, verkleinert

KOORDINATEN: In der .acc zeigt x nach vorn, y nach oben, z nach rechts (Speed Dreams dreht beim Laden
y_sd = -z_ac). Die App rechnet im Auto mit +z vorn, +x links, +y oben. Also x_app = -z, y_app = y,
z_app = x - eine Drehung, keine Spiegelung (die Schrift auf dem Auto bleibt lesbar).

WEGGELASSEN: der Innenraum (Sitz, Armaturen, Boden, Kaefig) - von aussen bei Modellgroesse unsichtbar und
die Haelfte aller Dreiecke - und Teile, deren Textur im Ordner fehlt.
"""
import json
import math
import os
import re
import struct
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Namensanfang -> Rolle. Erste passende gewinnt.
ROLLEN = [
    ('WIOUTSIDE', 'glas'), ('WIHEADLIGHTS', 'scheinwerferglas'), ('HL', 'scheinwerfer'), ('RL', 'ruecklicht'),
    ('BLINK', 'blinker'), ('MIR', 'karosserie'), ('MET', 'karosserie'), ('CFOUTSIDE', 'karosserie'),
    ('BDYCARBODY', 'karosserie'), ('BDYREARWING', 'karosserie'), ('BDYOUTERBANNER', 'karosserie'), ('BDYWIPER', 'karosserie'),
]
WEG = ('INT', 'DASH', 'DIS', 'FLOOR', 'TRANSTUNNEL', 'CFINTERIOR', 'WIINSIDE', 'BDYINNERBANNER', 'BDYCOLCHASSIS', 'GRILL')
# Texturgroesse in der App (lange Seite). Die Lackierung traegt Schrift und braucht am meisten.
TEXTUR_MAX = {'karosserie': 1024, 'rad': 256}


def acc_lesen(pfad):
    """Objekte einer AC3D-Datei: Name, erste Textur, Ecken (mit Normalen), Dreiecke als (Ecke, u, v)."""
    z = open(pfad, encoding='latin-1').read().split('\n')
    objekte, cur, i = [], None, 0
    while i < len(z):
        t = z[i].split()
        if not t:
            i += 1
            continue
        if t[0] == 'OBJECT':
            cur = {'name': '', 'tex': None, 'ecken': [], 'dreiecke': []}
            objekte.append(cur)
        elif t[0] == 'name':
            cur['name'] = t[1].strip('"')
        elif t[0] == 'texture' and cur['tex'] is None:
            cur['tex'] = t[1].strip('"')
        elif t[0] == 'loc':
            if any(abs(float(v)) > 1e-9 for v in t[1:4]):
                raise SystemExit('%s: loc wird nicht unterstuetzt' % cur['name'])
        elif t[0] == 'numvert':
            n = int(t[1])
            for k in range(n):
                w = [float(v) for v in z[i + 1 + k].split()]
                cur['ecken'].append(w + [0.0, 1.0, 0.0][len(w) - 3:] if len(w) < 6 else w[:6])
            i += n
        elif t[0] == 'SURF':
            typ = int(t[1], 16) & 0xF
            i += 1
            while not z[i].startswith('refs'):
                i += 1
            n = int(z[i].split()[1])
            refs = []
            for k in range(n):
                w = z[i + 1 + k].split()
                refs.append((int(w[0]), float(w[1]), float(w[2])))
            i += n
            if typ == 4:                                   # Dreiecksstreifen (Speed-Dreams-Erweiterung)
                for k in range(n - 2):
                    a, b, c = refs[k], refs[k + 1], refs[k + 2]
                    cur['dreiecke'].append((a, b, c) if k % 2 == 0 else (b, a, c))
            elif typ == 0:                                 # Vieleck -> Faecher
                for k in range(1, n - 1):
                    cur['dreiecke'].append((refs[0], refs[k], refs[k + 1]))
        i += 1
    return [o for o in objekte if o['dreiecke']]


def xml_lesen(pfad):
    s = re.sub(r'<!--.*?-->', '', open(pfad, encoding='utf-8').read(), flags=re.S)
    werte, pfadteile = {}, []
    for m in re.finditer(r'<section name="([^"]+)">|</section>|<att(num|str) name="([^"]+)"([^>]*)/>', s):
        if m.group(1):
            pfadteile.append(m.group(1))
        elif m.group(0) == '</section>':
            pfadteile.pop()
        else:
            v = re.search(r'val="([^"]*)"', m.group(4))
            werte['/'.join(pfadteile + [m.group(3)])] = v.group(1) if v else ''
    return werte


def zahl(w, schluessel, vorgabe=None):
    if schluessel not in w:
        if vorgabe is None:
            raise SystemExit('fehlt in der .xml: ' + schluessel)
        return vorgabe
    return float(w[schluessel])


def rolle_von(name):
    if name.startswith(WEG):
        return None
    for anfang, r in ROLLEN:
        if name.startswith(anfang):
            return r
    return 'karosserie'


def textur_schreiben(quelle, ziel_ordner, name, max_seite):
    bild = Image.open(quelle).convert('RGBA')
    f = min(1.0, max_seite / max(bild.size))
    if f < 1:
        bild = bild.resize((max(1, round(bild.size[0] * f)), max(1, round(bild.size[1] * f))), Image.LANCZOS)
    if bild.getchannel('A').getextrema()[0] == 255:
        datei = os.path.splitext(name)[0] + '.jpg'
        bild.convert('RGB').save(os.path.join(ziel_ordner, datei), quality=86, optimize=True)
    else:
        datei = os.path.splitext(name)[0] + '.png'
        bild.save(os.path.join(ziel_ordner, datei), optimize=True)
    return datei


def main(quelle, kennung):
    xmls = [f for f in os.listdir(quelle) if f.endswith('.xml')]
    if len(xmls) != 1:
        raise SystemExit('genau eine .xml erwartet, gefunden: %s' % xmls)
    w = xml_lesen(os.path.join(quelle, xmls[0]))
    modell = w.get('Graphic Objects/env') or w.get('Graphic Objects/car') or w.get('Graphic Objects/Ranges/1/car')
    ziel = os.path.join(REPO, 'img', 'autos', kennung)
    os.makedirs(ziel, exist_ok=True)

    ecken, indizes, teile, texturen = [], [], [], {}

    def tex(name, rolle):
        if name not in texturen:
            texturen[name] = textur_schreiben(os.path.join(quelle, name), ziel, name, TEXTUR_MAX.get(rolle, 256))
        return texturen[name]

    def anhaengen(objekte, rollen_fn, gruppe):
        for o in objekte:
            rolle = rollen_fn(o['name'])
            if rolle is None or not o['tex'] or not os.path.exists(os.path.join(quelle, o['tex'])):
                continue
            basis, karte, start = len(ecken), {}, len(indizes)
            for d in o['dreiecke']:
                for (vi, u, v) in d:
                    k = (vi, round(u, 5), round(v, 5))
                    if k not in karte:
                        x, y, zz, nx, ny, nz = o['ecken'][vi]
                        karte[k] = len(ecken) - basis
                        ecken.append((-zz, y, x, -nz, ny, nx, u, 1.0 - v))
                    indizes.append(karte[k])
            if len(ecken) - basis > 65535:
                raise SystemExit(o['name'] + ': zu viele Ecken fuer Uint16')
            teile.append({'name': o['name'], 'rolle': rolle, 'gruppe': gruppe, 'tex': tex(o['tex'], 'rad' if gruppe == 'rad' else rolle),
                          'ecke0': basis, 'ecken': len(ecken) - basis, 'index0': start, 'indizes': len(indizes) - start})

    anhaengen(acc_lesen(os.path.join(quelle, modell)), rolle_von, 'auto')
    rad_datei = 'wheel0.acc'
    if os.path.exists(os.path.join(quelle, rad_datei)):
        anhaengen(acc_lesen(os.path.join(quelle, rad_datei)), lambda n: 'rad', 'rad')
    schatten = None
    if os.path.exists(os.path.join(quelle, 'shadow.png')):
        schatten = textur_schreiben(os.path.join(quelle, 'shadow.png'), ziel, 'shadow.png', 128)

    roh = b''.join(struct.pack('<8f', *e) for e in ecken)
    pad = (-len(roh)) % 4
    roh += b'\0' * pad
    index_ab = len(roh)
    roh += struct.pack('<%dH' % len(indizes), *indizes)
    open(os.path.join(ziel, 'auto.bin'), 'wb').write(roh)

    # Fahrzeugdaten. Laengen in m, Kraefte in N, Federraten in N/m, Daempfer in N/(m/s).
    kn = 1000.0
    L = zahl(w, 'Front Axle/xpos') - zahl(w, 'Rear Axle/xpos')
    vorn = zahl(w, 'Car/front-rear weight repartition')
    reifen = {}
    for achse, sek in (('vorn', 'Front Right Wheel'), ('hinten', 'Rear Right Wheel')):
        felge = zahl(w, sek + '/rim diameter') * 0.0254 / 2
        breite = zahl(w, sek + '/tire width') / 1000
        flanke = breite * zahl(w, sek + '/tire height-width ratio')
        reifen[achse] = {'radius': round(felge + flanke, 4), 'breite': round(breite, 4), 'spur': round(2 * abs(zahl(w, sek + '/ypos')), 4),
                         'bodenfreiheit': zahl(w, sek + '/ride height') / 1000,
                         'mu': zahl(w, sek + '/Compounds/medium/mu', zahl(w, sek + '/mu', 1.2))}
    feder = {}
    for achse, sek, stab in (('vorn', 'Front Right Suspension', 'Front Anti-Roll Bar'), ('hinten', 'Rear Right Suspension', 'Rear Anti-Roll Bar')):
        feder[achse] = {'k': zahl(w, sek + '/spring') * kn, 'druck': zahl(w, sek + '/slow bump') * kn,
                        'zug': zahl(w, sek + '/slow rebound') * kn, 'weg': zahl(w, sek + '/suspension course', 0.1),
                        'stab': zahl(w, stab + '/spring', 0) * kn}
    lichter = {'brems': [], 'rueck': [], 'front': []}
    for k in range(1, 40):
        p = 'Graphic Objects/Light/%d/' % k
        if p + 'type' not in w:
            continue
        typ = w[p + 'type']
        # Speed Dreams: x vorn, y links, z oben -> App: x links, y oben, z vorn (dasselbe Vorzeichen).
        ort = [float(w[p + 'ypos']), float(w[p + 'zpos']), float(w[p + 'xpos']), float(w.get(p + 'size', 0.2))]
        (lichter['brems'] if typ == 'brake' else lichter['rueck'] if typ == 'rear' else lichter['front'] if typ.startswith('head') else []).append(ort)
    physik = {
        'masse': zahl(w, 'Car/mass'), 'schwerpunktHoehe': zahl(w, 'Car/GC height'), 'radstand': round(L, 4),
        # a = Schwerpunkt bis Vorderachse: je mehr vorn liegt, desto naeher.
        'a': round(L * (1 - vorn), 4), 'b': round(L * vorn, 4),
        'vorderachse': zahl(w, 'Front Axle/xpos'), 'hinterachse': zahl(w, 'Rear Axle/xpos'),
        'laenge': zahl(w, 'Car/body length'), 'breite': zahl(w, 'Car/body width'), 'hoehe': zahl(w, 'Car/body height'),
        'massenVerteilung': zahl(w, 'Car/mass repartition coefficient', 0.8),
        'lenkGrad': zahl(w, 'Steer/steer lock'), 'bremsVorn': zahl(w, 'Brake System/front-rear brake repartition'),
        'cx': zahl(w, 'Aerodynamics/Cx', 0.35), 'stirnflaeche': zahl(w, 'Aerodynamics/front area', 2.0),
        'auftriebVorn': zahl(w, 'Aerodynamics/front Clift', 0), 'auftriebHinten': zahl(w, 'Aerodynamics/rear Clift', 0),
        'fluegelVorn': zahl(w, 'Front Wing/area', 0) * 4 * math.sin(zahl(w, 'Front Wing/angle', 0) * math.pi / 180),
        'fluegelHinten': zahl(w, 'Rear Wing/area', 0) * 4 * math.sin(zahl(w, 'Rear Wing/angle', 0) * math.pi / 180),
        'leerlauf': zahl(w, 'Engine/tickover', 1000), 'begrenzer': zahl(w, 'Engine/revs limiter', 7000),
        'reifen': reifen, 'feder': feder,
    }
    radmasse = 2 * zahl(w, 'Front Right Wheel/mass', 25) + 2 * zahl(w, 'Rear Right Wheel/mass', 25)
    physik['gefedert'] = round(physik['masse'] - radmasse, 1)
    meta = {
        'name': re.search(r'<params name="([^"]+)"', open(os.path.join(quelle, xmls[0]), encoding='utf-8').read()).group(1),
        'kennung': kennung, 'quelle': 'Speed Dreams, data/cars/models/' + os.path.basename(os.path.normpath(quelle)),
        'lizenz': 'GPL-2.0-or-later (Speed Dreams)', 'koordinaten': 'm; +x links, +y oben, +z vorn',
        'ecken': len(ecken), 'indizes': len(indizes), 'indexAb': index_ab, 'schritt': 32,
        'teile': teile, 'schatten': schatten, 'lichter': lichter, 'physik': physik,
    }
    json.dump(meta, open(os.path.join(ziel, 'auto.json'), 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    open(os.path.join(ziel, 'LIZENZ.txt'), 'w', encoding='utf-8', newline='\n').write(
        '%s aus Speed Dreams (%s).\n\nModell, Texturen und Fahrzeugdaten: GNU General Public License, Version 2 oder\n'
        'spaeter (siehe den Kopf der Speed-Dreams-Datei %s). Umgewandelt mit tools/sd_auto.py:\nInnenraum entfernt, '
        'Texturen verkleinert, Koordinaten gedreht.\nhttps://www.gnu.org/licenses/old-licenses/gpl-2.0.html\n'
        % (meta['name'], meta['quelle'], xmls[0]))
    print('%s: %d Teile, %d Ecken, %d Dreiecke, auto.bin %d KB, Texturen %s'
          % (meta['name'], len(teile), len(ecken), len(indizes) // 3, len(roh) // 1024, sorted(set(texturen.values()))))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
