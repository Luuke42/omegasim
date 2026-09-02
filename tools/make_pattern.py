# -*- coding: utf-8 -*-
"""startziel-a4.svg direkt aus dem Original-PDF erzeugen, damit keine Zahl abgetippt wird.

    python tools/make_pattern.py [target_finish.pdf] [startziel-a4.svg]

Ohne Argumente werden die Dateien im Wurzelverzeichnis des Repos erwartet. Vorher
standen hier zwei feste Pfade auf einen Ordner, den es nach dem Aufraeumen nicht mehr
gibt - auf einem anderen Rechner haben sie ohnehin nie existiert.
"""
import io
import os
import re
import sys
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'target_finish.pdf')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, 'startziel-a4.svg')
if not os.path.exists(PDF):
    raise SystemExit('Original-PDF nicht gefunden: %s' % PDF
                     + chr(10) + 'Es ist fremdes Material und liegt nicht im Repo.')

PT = 25.4 / 72.0          # PDF user units are points
d = open(PDF, 'rb').read()

# page size
mb = re.search(rb'/MediaBox\[?\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', d)
PW, PH = float(mb.group(3)) * PT, float(mb.group(4)) * PT

# content stream
cs = re.search(rb'5 0 obj.*?stream\r?\n(.*?)endstream', d, re.S)
content = zlib.decompress(cs.group(1)).decode('latin1')

# every "x y w h re" — the first is the clip rectangle (preceded by "q"), the rest are bars
rects = [tuple(float(v) for v in m)
         for m in re.findall(r'([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re', content)]
clip, bars = rects[0], rects[1:]
bars.sort(key=lambda r: -r[1])            # top of page first

# the direction arrow: a single closed path of "m"/"l" points
pts = re.findall(r'([\d.]+) ([\d.]+) (?:m|l)', content)
arrow = [(float(x) * PT, float(y) * PT) for x, y in pts[:7]]

# PDF y grows upward, SVG y grows downward
def sy(y_pdf, h=0.0):
    return PH - (y_pdf + h)

body = []
for x, y, w, h in bars:
    body.append('    <rect x="%.3f" y="%.3f" width="%.3f" height="%.3f"/>'
                % (x * PT, sy(y * PT, h * PT), w * PT, h * PT))

arrow_d = 'M ' + ' L '.join('%.2f %.2f' % (x, sy(y)) for x, y in arrow) + ' Z'

thin = min(h for _, _, _, h in bars) * PT
thick = max(h for _, _, _, h in bars) * PT
gaps = []
prev = None
for x, y, w, h in bars:
    if prev is not None:
        gaps.append((prev - (y + h)) * PT)
    prev = y
tg, kg = min(gaps), max(gaps)
seq_bars = ''.join('1' if h * PT > (thin + thick) / 2 else '0' for _, _, _, h in bars)
seq_gaps = ''.join('1' if g > (tg + kg) / 2 else '0' for g in gaps)
length = ((bars[0][1] + bars[0][3]) - bars[-1][1]) * PT
xl, xr = bars[0][0] * PT, (bars[0][0] + bars[0][2]) * PT

# a printed scale check: two ticks exactly 100 mm apart, low on the page
ruler_y = sy(min(y for _, y, _, _ in bars) * PT) + 42
rx = (PW - 100) / 2

svg = f'''<svg xmlns="http://www.w3.org/2000/svg"
     width="{PW:.2f}mm" height="{PH:.2f}mm" viewBox="0 0 {PW:.2f} {PH:.2f}">
  <!--
    Start/Ziel-Muster. DIN A4 QUER, 1 SVG-Einheit = 1 mm.

    ERZEUGT AUS DEM ORIGINAL, nicht nachgemessen: alle Koordinaten stammen direkt aus
    target_finish.pdf (Vektor, aus Excel, 9 Rechtecke), umgerechnet mit 1 pt = 25,4/72 mm.
    Erzeuger: tools/make_pattern.py — bei Zweifeln neu erzeugen statt hier editieren.

    Die vorherige Fassung war eine Rekonstruktion aus einem Foto und durchgehend 10 bis
    22 Prozent zu breit (duenner Balken 4,4 statt {thin:.3f} mm). Sie hat ausserdem nur die
    Lueckenfolge nachgebildet — Balken UND Luecken tragen aber beide Information.

    Gemessen aus dem Original:
      duenner Balken {thin:.3f} mm      dicker Balken {thick:.3f} mm
      duenne Luecke  {tg:.3f} mm      dicke Luecke  {kg:.3f} mm
      Balkenbreite quer {bars[0][2] * PT:.1f} mm (x = {xl:.1f} bis {xr:.1f})
      Musterlaenge in Fahrtrichtung {length:.1f} mm
      Balken in Leserichtung {seq_bars[::-1]}   (1 = dick)
      Luecken in Leserichtung  {seq_gaps[::-1]}

    DRUCKEN: A4 quer, 100 % / "Tatsaechliche Groesse". NICHT "an Seite anpassen" — das
    verkleinert um mehrere Prozent und macht das Muster unlesbar. Zur Kontrolle ist unten
    eine 100-mm-Strecke aufgedruckt: nachmessen, bevor das Blatt ausgelegt wird.

    Der Pfeil zeigt in die Fahrtrichtung; gelesen wird von der Pfeilseite her. Ein
    rueckwaerts ueberfahrenes Muster ist eine andere Folge und damit ein anderer Code.
  -->

  <rect x="0" y="0" width="{PW:.2f}" height="{PH:.2f}" fill="#ffffff"/>

  <g fill="#000000">
{chr(10).join(body)}
  </g>

  <path d="{arrow_d}" fill="#000000" stroke="#000000" stroke-width="0.353"/>

  <!-- Maßstabsprobe: exakt 100 mm zwischen den Innenkanten der beiden Striche -->
  <g stroke="#000000" stroke-width="0.25" fill="none">
    <path d="M {rx:.2f} {ruler_y:.2f} L {rx:.2f} {ruler_y + 4:.2f}"/>
    <path d="M {rx + 100:.2f} {ruler_y:.2f} L {rx + 100:.2f} {ruler_y + 4:.2f}"/>
    <path d="M {rx:.2f} {ruler_y + 2:.2f} L {rx + 100:.2f} {ruler_y + 2:.2f}"/>
  </g>
  <text x="{PW / 2:.2f}" y="{ruler_y + 9:.2f}" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="3.2" fill="#000000"
        >100 mm — nachmessen: stimmt es nicht, ist der Ausdruck skaliert und unbrauchbar</text>
</svg>
'''

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(svg)
print('startziel-a4.svg erzeugt: %d Balken, duenn %.3f / dick %.3f mm, Laenge %.1f mm'
      % (len(bars), thin, thick, length))
print('  Balken in Leserichtung %s' % seq_bars[::-1])
print('  Luecken in Leserichtung %s' % seq_gaps[::-1])
