# Werkzeuge für die freien Strecken (von Gnen54)

Diese Skripte stammen aus Gnen54s Fork (Commits bfa36b6 und 7a284ac vom 22.11.2026). Sie erzeugen die freien Strecken der virtuellen Fahrt in `img/strecken/*.json` aus DXF-Zeichnungen. Übernommen in OmegaSim 1.6.60.

| Datei | Zweck | Eingabe → Ausgabe |
|---|---|---|
| `dxfread.py` | DXF-Leser (LINE, LWPOLYLINE, SPLINE, ARC, POINT), `lies(fn)` → `(segs, pts)` | wird von den anderen Skripten importiert |
| `ring2_bau.py` | Törnerschleife 2.0 mit Brücke: DXF-Wände rastern, Kreuzung freischneiden | DXF → `bahn.npy` |
| `ring2_mitte.py` | Mittellinie durch das Raster | `bahn.npy`, `dt.npy` → `mitte2.npy` |
| `ring2_json.py` | `indeq-bruecke.json`: Punkte, Kacheln, Box, Brückenhöhe | `bahn.npy`, `mitte2.npy`, `ring_v2a.dxf`, `bv.npy` → JSON |
| `bucht_tiefe.py` | Tiefe der Boxenbucht je Punkt | `strecke.json bahn_xxx.npy` → JSON ergänzt |
| `boxgasse.py` | Boxengasse als eigene Fläche mit Randlinien | `strecke.json bahn_xxx.npy` → JSON ergänzt |

## Abhängigkeiten

Python 3 mit numpy, opencv-python, scipy und scikit-image. `ring2_mitte.py` braucht zusätzlich matplotlib.

## Lücken

- Für die Törnerschleife fehlen im Fork:
  - die DXF-Dateien `ring_v2.dxf`, `ring_v2a.dxf` und `Toernerschleife-V2a.dxf`;
  - die Brücke als STL bzw. `bv.npy`;
  - die Datei `dt.npy`.
- `indeq-ring.json` (ohne Brücke) hat kein Erzeugerskript; `ring_json.py` wurde nie eingecheckt.
- Die JSON-Dateien in `img/strecken/` sind byte-gleich mit denen im Fork.
