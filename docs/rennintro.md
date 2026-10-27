# Lokales Rennintro (Basis 1.1.44)

## Umfang

- Optionen -> Ansagen -> **Rennintro vor der Ampel** (`setting-announce-intro`).
- Standard AUS, gespeichert in der vorhandenen Selbstsicherung, unabhaengig von Fahrzeugpresets.
- Willkommen, Modus, Rundendistanz bzw. Minutenlimit, Pflichtboxenstopps, Teilnehmerzahl,
  vollstaendige Startaufstellung (Position, Farbe, Modell), Startwetter und Bereitschaft.
- Teilnehmer und Reihenfolge entsprechen dem Startschirm (inklusive NPCs/Spielerautos,
  ohne Safety Car/Reinigungsauto); die Identitaeten werden beim Introstart eingefroren.
- Ohne Farbzuordnung nur der Artikel, ohne Modellzuordnung "Wagen". Ein Teilnehmer wird
  mit "einen Teilnehmer" angekuendigt, bei leerem Feld null Teilnehmer und keine Positionen.
- Vorproduzierte Piper-Clips: Deutsch/Englisch; Spanisch nutzt wie bisher Englisch.
- Verwendet Rennstand-Sprechtempo, Lautstaerke und Hall. Ton aus bzw. Lautstaerke 0 ueberspringt das Intro.
- Ampel erst nach dem letzten Clip; Fruehstartueberwachung schon ab Intro-Beginn (raceState ist dann bereits countdown).
- Nicht in Challenges (eigener Ablauf mit Ampel, sonst vor jedem Versuch ein Intro).
- Training mit aktivem Intro bekommt die Ampel, ohne Intro weiter unmittelbarer Start.
- Einzelne fehlende Clips werden ausgelassen (einmal im Protokoll); nur wenn keiner ladbar ist oder der Audiokontext fehlt, Start ohne Ansage.
- Lade-Timeout 20 s (maximal sechs parallele Downloads, geladene Clips bleiben im Speicher; nach dem Timeout laden sie im Hintergrund weiter); maximale Ansagedauer 180 s
  mit Wiedergabe-Watchdog, damit auch groessere Startfelder vollstaendig angesagt werden.
- Abbrechen stoppt Audios und verhindert nachtraegliche Ampeln. Ausschalten waehrend des
  Intros beendet die Ansage und geht zur Ampel weiter.
- WLAN-Mehrspieler, vorgegebener Gruen-Zeitpunkt und Multiplayer-Plan: KEIN Intro.
  `97-sessions.js` und der gemeinsame Startplan werden nicht geaendert.
- Keine Versionsanhebung; Basis/Anzeige bleibt 1.1.44.

## Patch einspielen (PowerShell, Repository-Wurzel)

Die heruntergeladene `rennintro-lokal.patch.txt` z. B. nach Downloads speichern.

```powershell
$patch = Join-Path $HOME 'Downloads\rennintro-lokal.patch.txt'
git status --short --branch
git apply --check -- $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch passt nicht. Nicht weiter ausfuehren.' }
git apply -- $patch
if ($LASTEXITCODE -ne 0) { throw 'Patch konnte nicht angewendet werden.' }
```

Der Patch aendert die Quellen. `index.html`, `sw.js` und `app-update.json` werden erst durch
`tools/build.py` neu erzeugt. Deshalb erst Audios erzeugen, DANACH bauen.

## Piper-Audios erzeugen

Vorhandene Installation wie fuer `voice_zahlen.py`:

```text
C:\tools\piper\piper\piper.exe
C:\tools\piper\de_DE-thorsten-medium.onnx
C:\tools\piper\de_DE-thorsten-medium.onnx.json
C:\tools\piper\en_US-ljspeech-medium.onnx
C:\tools\piper\en_US-ljspeech-medium.onnx.json
```

Auch `C:\tools\piper\piper.exe` wird unterstuetzt. Den Ordner bei Bedarf anpassen.
ffmpeg muss im PATH stehen. NumPy/SciPy wie bei den bisherigen Audiowerkzeugen:

```powershell
python -m pip install -r tools/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python-Abhaengigkeiten fehlen.' }

Get-Command ffmpeg -ErrorAction Stop | Out-Null
$piper = 'C:\tools\piper'
python tools/voice_rennintro.py --piper $piper
if ($LASTEXITCODE -ne 0) { throw 'Audio-Erzeugung fehlgeschlagen.' }

python tools/voice_rennintro.py --check
if ($LASTEXITCODE -ne 0) { throw 'Audios sind unvollstaendig.' }

python tools/build.py
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen.' }
python tools/build.py --check
if ($LASTEXITCODE -ne 0) { throw 'Build-Pruefung fehlgeschlagen.' }
git diff --check
git status --short --branch
```

94 Ogg-Clips insgesamt (50 zusaetzlich zum Boxenstopp-Intro) unter `audio/rennintro_*.ogg`. Vorhandene Zahlen 0-60 werden wiederverwendet.
Keine bestehenden Zahl-/Rennstand-/Warnclips werden ueberschrieben. Schon vorhandene Introclips
werden ausgelassen; fuer neue Texte/Stimmen:

```powershell
python tools/voice_rennintro.py --piper $piper --force
```

Optional nur eine Sprache erzeugen: `--sprache de` oder `--sprache en`.
`--check` prueft bewusst BEIDE Sprachen. Wenn im eigenen Repo die vorhandenen Zahlclips fehlen,
kann man sie mit dem bisherigen `python tools/voice_zahlen.py --piper $piper` erzeugen;
dieser bisherige Generator schreibt ALLE Zahlclips neu.

## Testen

1. Anwendung neu laden, bei lokalem Browser-Betrieb ggf. Strg+F5.
2. Optionen -> Ansagen -> Rennintro vor der Ampel einschalten.
3. Lokales Rundenrennen mit 5 Runden starten.
4. Erwartet: Willkommen, Modus, 5 Runden, trocken/regen, Bereitschaft; danach rote Lampen.
5. Im Intro abbrechen: keine spaetere Ampel und keine weiterlaufende Ansage.
6. Im Intro ausschalten: Ansage endet und die Ampel beginnt genau einmal.
7. Seite neu laden: Schalter bleibt gespeichert.
8. Schalter aus: bisheriger Start; Training weiterhin ohne Ampel.

Bei PWA/Android mit Update-Cache pruefen, dass wirklich die neu gebaute index.html verwendet
wird; keine Browserdaten pauschal loeschen, da dort Garage und Sitzungen gespeichert sind.
Eine Versionsanhebung fuer die spaetere Auslieferung ist hier nicht enthalten.

## Durchgefuehrte technische Tests

- Build und `build.py --check`, Element-IDs, Woerterbuch und JS-Klammern erfolgreich.
- Chromium: App startet als 1.1.44 ohne JavaScript-Laufzeitfehler.
- 20 Browser-Checks bestanden: Schalter-Default/Persistenz, Clipfolge, Ampel nach Intro,
  Fruehstart ab Intro, Abbruch/Neustart, Ausschalten, Training, Ton-aus,
  Multiplayer-Ausschluss, fehlende Clips und Lade-Timeout.
- Audio-Werkzeug: mit simuliertem Piper getestet; echter Funkfilter und ffmpeg/Ogg-Encoding,
  36 Dateien, Manifestpruefung und erneuter Lauf ohne Ueberschreiben erfolgreich.
- Echte Piper-Stimmen, reale Fahrzeuge/BLE und native Android-Wiedergabe nicht getestet.

Die Browser-Clips der automatisierten Tests sind synthetische kurze Testsignale, nicht die
noch lokal zu erzeugenden Sprachausgaben.

## Zusatzpatch Teilnehmer / Startaufstellung

Nach Einspielen erneut `python tools/voice_rennintro.py --piper <Piper-Ordner>` ausfuehren.
Ohne `--force` bleiben die bisherigen 44 Introclips unveraendert; pro Sprache kommen
25 Clips hinzu. `audio/rennintro.json` wird vom Generator aktualisiert, nicht vom Patch.
Danach `--check`, Build und Build-Pruefung ausfuehren. Die Version bleibt 1.1.44.

Test: drei Autos sortieren, verschiedene Farben/Modelle zuordnen und lokal starten.
Erwartet: "Wir haben heute drei Teilnehmer am Start", danach alle Positionen in der
angezeigten Reihenfolge, zum Beispiel "Auf Position eins haben wir den roten Porsche
Neun Elf". Anschliessend Wetter und Bereitschaft, erst danach Ampel. Einzelteilnehmer,
Safety Car, Reinigungsauto, fehlende Zuordnung, Abbruch und ausgeschaltetes Intro testen.
Multiplayer bleibt ausgeschlossen.
