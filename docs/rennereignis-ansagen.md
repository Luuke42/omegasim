# Erweiterte Rennereignis-Ansagen

Basis: OmegaSim 1.2.29, Commit 83ae47ab274f6fdb41b650ee16f2ced6eb9c060b.
Keine Versionsanhebung und keine native Android-Aenderung.

## Einstellungen unter Optionen → Ansagen

- Schwere Beschaedigung ansagen (Standard aus): Farbe, Modell und lokale Spielernummer.
- Zustandsgrenze (1–100 %, Standard 30): Restzustand, nicht angesammelter Schaden.
  Nur strikt unter der Grenze, nur bei eingeschaltetem Schadensmodell und im aktiven Rennen.
  Pro Spieler einmal; Reparatur auf mindestens Grenze + 8 Prozentpunkte (maximal 100 %)
  gibt die Meldung frei. Derby-Health bleibt ein eigener Zustand ohne diesen Hook.
- Spieler in der Box ansagen (Standard aus): einmal beim Uebergang zum tatsaechlichen
  Service. Kein Ereignis bei blosser Anforderung oder beim Boxengassen-Einfahren.
- Zeitstrafen ansagen (Standard aus): neu verhaengte Sekunden fuer Fruehstart und Rammen;
  fehlende Pflichtstopps erst am regulaeren Rennende. Kein Strafsatz fuer reine Bremse.

Alle vier Parameter werden von der bestehenden Selbstsicherung erfasst; data-preset-skip
nimmt sie nur aus Fahrgefuehl-Presets heraus, nicht aus der Sicherung.
Schwere-Beschaedigung ersetzt bei aktiviertem neuen Schalter die alte allgemeine
Schadenswarnung. Die neue Boxenmeldung ersetzt dann die alte Anforderungsansage.
Garagennamen sind fuer diese Meldungen nicht massgeblich: feste Farbe/Modell/Spieler.
Die lokalen Fahrer 1–3 werden beruecksichtigt; keine neue WLAN-Ereignissynchronisierung.

## Audio-Reihenfolge

Aktive Saetze werden zu Ende gespielt, auch wenn Ereignisse eintreffen. Danach
wartende Ereignisse in FIFO-Reihenfolge, danach wartende Rundenzeiten. Allgemeine
Warnungen werden ebenfalls serialisiert. Rennstand/Ergebnis warten auf die Queue;
Rundenzeiten waehrend eines Rennstands werden vorgemerkt statt verworfen.
300 ms Abstand zwischen Meldungen; kein Audio-Overlap. Die Queue ist waehrend
Rennpause/Wiederanlauf fuer neue Wiedergabe gesperrt. Ein bereits aktiver Satz darf
zu Ende spielen. Neues Rennen, manueller Abbruch und globales Sound-Aus leeren die
Queue; reguläres Rennende laesst die vorgemerkten Ereignisse zu Ende laufen.
Ein einzelner Schalter verwirft wartende Meldungen seiner Art, kuerzt aber keinen
aktiven fremden Satz. Defekte Web Speech ohne Ende wird durch einen 120-s-Watchdog
abgebrochen; ein normal eintreffendes Ereignis loest nie diesen Abbruch aus.

Seit OmegaSim 1.3.39 gilt das alles nur mit dem Schalter "Ansagen in Warteschlange"
(Optionen, Ansagen; Vorgabe an). Zusaetzlich verfallen wartende Rundenzeiten, die
laenger als 2,5 s auf ihren Platz warten wuerden (kurze Strecken, 4-5-s-Runden), und
das Ausschalten einer Ansageart macht einen gerade laufenden Satz DIESER Art sofort
still. Mit dem Schalter aus gilt das Verhalten vor diesem PR: jede neue Ansage beendet
die laufende sofort, nichts wird nachgeholt, und die Schlange laeuft gar nicht; die
Rennereignisse beenden dann ebenfalls die laufende Ansage und spielen direkt.

## Sprachdateien mit Piper

```powershell
py tools/voice_rennereignisse.py --piper 'C:\tools\piper'
py tools/voice_rennereignisse.py --check
py tools/build.py
py tools/build.py --check
```

Der Parameter ist der vorhandene Modellordner wie bei voice_zahlen.py:
`piper/piper.exe`, `de_DE-thorsten-medium.onnx`, `en_US-ljspeech-medium.onnx`
und beide `.onnx.json`-Dateien. FFmpeg muss im PATH sein, NumPy in derselben
Python-Umgebung installiert. Das Skript laedt nichts herunter.

116 neue OGG-Bausteine plus `audio/rennereignisse.json`. Vorhandene Zahlen-
und Fahrzeugclips bleiben unveraendert. Die Zahlen 61–99 und Hunderter
verhindern das ziffernweise Vorlesen grosser Strafzeiten (GUI: bis 900 s insgesamt).
Zehntelsekunden und die Singularform einer Sekunde sind beruecksichtigt.
Clips unter `audio/` einchecken; Modelle und audio-work nicht einchecken.

Erst nach Erzeugung erneut bauen: build.py aktualisiert die Dateiliste/Hashes
in app-update.json. Die APK uebernimmt dieselben Assets via tools/apk_www.py.
Fehlende Clips koennen im Browser auf Geraete-TTS zurueckfallen; ohne TTS in der
Android-WebView bleiben sie stumm mit Protokollhinweis. Deshalb vor APK/Deployment
immer den Clip-Check ausfuehren. Kein partieller Satz, wenn ein Baustein fehlt.

## Pruefung

Optional: `py tools/test_rennereignisse.py` (Playwright + Chromium nur fuer den Test).
Die Audiopruefungen benutzen synthetische Puffer und einen Stimmen-Mock, keine
Piper-Stimmen und keine echten Autos. Sie pruefen Prioritaet, Nicht-Unterbrechung,
Offline-Clip-Pfad, Pause, Schwellen/Hysterese, Reset und Settings nach Neuladen.
Vorhandene Ansagen-/Rennstandtests werden mitgeprueft; alte synchrone Clip-Proben
sind vom Queue-Test isoliert. Der fruehere Selbsttest, der absichtliche Abbrueche
forderte ("Ansage: stapelt sich nicht"), gilt seit 1.3.39 wieder fuer den Schalter
"Ansagen in Warteschlange" aus; beide Wege prueft "Ansagen v1.3.39: Warteschlange
abschaltbar ...".

Vor PR manuell pruefen: DE/EN-Aufnahmen anhoeren, reale Crash-Flanken fuer alle
lokalen Spieler, Boxenanfordern vs. Servicebeginn, Fruehstart/Rammstrafe/Pflichtstopps,
Ereignis waehrend Rundenzeit/Rennstand, Ton aus, neues Rennen, Pause und Android-APK.
Eine Fruehstartstrafe wird bei der Erkennung gemeldet und nicht nochmals beim
spaeteren Rundenzeit-Zuschlag. Nicht pauschal Website-Daten loeschen.

## Stadionhall-Korrektur

Alle drei neuen Ereignisarten spielen ihre Sprachclips ueber `rennstandGain()`
ab, denselben Web-Audio-Bus wie das Rennintro. Die bestehenden Rennstand-Regler
steuern damit auch hier Hall (0–100 %), Lautstaerke und Tempo. Die Hall-Impulse
werden nicht in die OGG-Dateien eingebrannt, sondern live angewandt. Keine neuen
Piper-Dateien erforderlich. Die bestehende Intro-Pitch-Behandlung bleibt gleich.

Die Warteschlange bleibt bis zum Ende des Nachhalls (1,2 s bei aktivem Hall)
belegt. Laufende Saetze werden nicht unterbrochen. Beim Abbruch wird auch der
Nachhall-Wartetimer entfernt. Der Standardpfad fuer Rundenzeit-/Warnclips bleibt
unveraendert.

Fehlen benoetigte Clips, bleibt die Geraetestimme als Fallback erhalten und
die App protokolliert, dass dieser Pfad keinen Hall ermoeglicht. Fuer garantierten
Stadionhall alle Piper-Dateien mit deployen; Hall-Regler muss groesser als 0 sein.
