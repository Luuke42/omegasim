# OmegaSim

Ein Rennspiel für Carrera-Hybrid-Autos, das im Browser läuft. Es steuert die Autos über
dieselbe Bluetooth-Schnittstelle wie die Hersteller-App, mit eigener Physik, eigenen
Motorklängen, autonomen Gegnern und einem Streckeneditor.

**Zum Fahren:** `index.html` in Chrome oder Edge öffnen. Keine Installation, kein Server,
kein Netz. Auf Windows und Android; iOS unterstützt Web Bluetooth nicht.
Auf Windows liegt zusätzlich `Start OmegaSim.bat` daneben.

**Als App:** über https (etwa GitHub Pages) lässt sich OmegaSim ins Startmenü legen –
Vollbild ohne Adresszeile und Start ohne Netz. Der Browser-Betrieb bleibt unverändert; wer
nichts installiert, merkt nichts. Was es ausdrücklich NICHT löst, ist der Mehrspieler-Fall:
der secure context hängt an der Herkunft, und die ist nach dem Installieren dieselbe.
Einzelheiten in `CARRERA_HYBRID.md`.

Der Cache wird **netz-zuerst** gefüllt: online immer aktuell, offline die letzte gesehene
Fassung. Cache-zuerst wäre hier die schlechteste Wahl – bei mehreren Builds am Tag liefert
er eine alte Fassung aus, während die neue schon daliegt.

## Mitarbeiten

`index.html` ist das **Ergebnis**, nicht die Quelle. Die Quelle liegt in `src/`:

```bash
python tools/build.py           # index.html aus src/ bauen
python tools/build.py --check   # prüfen, ob index.html noch zur Quelle passt
```

Zusammengebaut wird in Namensreihenfolge, ohne Trenner. Die Zahlenpräfixe **sind** die
Reihenfolge, und das ist Absicht: ein `let` oder `const`, das weiter oben gelesen wird als
es steht, bricht die ganze IIFE beim Laden ab. Eine Reihenfolge, die man im Verzeichnis
sieht, schützt davor besser als eine Liste im Code.

| Datei | Inhalt |
|---|---|
| `00-index.head.html` | Auszeichnung und Stilblock, endet mit `<script>` |
| `10-ble-explorer.js` | eigener Verbindungsweg, GATT-Baum, UUID-Liste |
| `20-protocol.js` | Kommandopaket, CRC-8, Bedeutung der Bytes |
| `30-input.js` | Eingabe-Vorrang, Telemetrie-Aufnahme, Tastatur |
| `40-physics.js` | `CarreraPhysicsEngine` |
| `50-drive.js` | Regler, Kalibrierung, Makros |
| `60-track.js` | Streckenmodell, Geometrie, Ideallinie, Editor, Scan |
| `70-race.js` | Armaturenbrett, Rennmodi, Boxengasse, Wetter |
| `80-sound.js` | Motorklang, Effekte, Streckenkulisse |
| `90-ghosts.js` | Gamepad, Querablage, Rütteln, gelbe Flagge, Rennwürze, Linie |
| `92-coding-school.js` | Programmierschule |
| `94-engine-workshop.js` | Motorwerkstatt |
| `96-home.js` | Home-Screen |
| `98-presets.js` | Voreinstellungen |
| `99-index.tail.html` | Abschluss |

Die drei am leichtesten herauslösbaren Teile sind `20-protocol.js`, `40-physics.js` und
`60-track.js`: sie greifen kaum nach außen.

### Prüfen

```bash
python tools/build.py --check    # Quelle und Ergebnis passen zusammen
python tools/bump_version.py     # Versionsnummer aus der Git-Historie, vor jedem Commit
```

Im Browser steht `window.OMEGA_TEST` bereit — reine Funktionen zum Nachmessen ohne
verbundenes Auto: Streckencode hin und zurück, Ideallinie abtasten, ein synthetisches
Meldungspaket durch den echten Weg schicken, die Boxenstopp-Kacheln schalten.

Die **Ladeprüfung** gehört in ein eigenes Dokument, nicht in die laufende Seite: zwei
Instanzen am selben DOM verfälschen sich gegenseitig. Ein `<iframe>` auf `index.html`,
`window.onerror` sammeln, dann `typeof OMEGA_TEST === 'object'` prüfen.

### Werkzeuge

```bash
python -m pip install -r tools/requirements.txt
```

`build.py`, `bump_version.py`, `parse_btsnoop.py` und `make_pattern.py` brauchen nur die
Standardbibliothek. Die Klangwerkzeuge brauchen numpy, scipy und `ffmpeg` im Pfad.

## Was gemessen ist und was nicht

Das Protokoll ist aus Bluetooth-HCI-Mitschnitten der Hersteller-App zurückgewonnen. Die
Doku im Tab **Sonstige → Doku** unterscheidet durchgehend zwischen *belegt* und
*unbestätigt* und nennt die Zahlen, auf denen eine Aussage steht. Wo eine Vermutung
widerlegt wurde, steht sie mit ihrer Widerlegung dort — das ist nützlicher als eine
aufgeräumte Doku, die nur das Endergebnis zeigt.

Tank, Schaden, Reifen und Boxenstopp sind **Spiel**, keine Telemetrie: das echte Auto hat
keinen Tankgeber und meldet keinen Schaden.

## Lizenz

MIT, siehe `LICENSE`. Die Herkunft jeder Audiodatei steht in `audio/CREDITS.md`,
synthetisch und aus Aufnahmen geschnitten getrennt benannt.
