# Rennstand-Ansage

## Bedienung

Unter **Optionen → Ton** aktivieren. Intervall: 1–20 Runden (Standard 5).
Maximale Wartezeit: 5–30 Sekunden (Standard 30), ab der ersten Durchfahrt.
Sprechtempo: 100–175 %; eigene Lautstaerke: 0–200 %; optional Stadionhall.
Die Einstellungen werden gespeichert. Tempo veraendert auch die Tonhoehe.
Garage: Farbe und Marke/Modell je Auto, einschliesslich VW Kaefer.
Sonderfarben „keine“/„mehrfarbig“ werden nicht automatisch vergeben.

## Messung

Beispiel Intervall 5: Sobald das erste Auto Runde 5 beendet (Runde 6 beginnt),
wird der Messstand vorgemerkt. Nach drei Durchfahrten derselben Runde erfolgt
die Ansage; bei weniger als drei Autos werden alle abgewartet.
Die ersten drei Durchfahrtszeitpunkte bestimmen die Reihenfolge und die
Sekundenrueckstaende. Spaetere Runden aendern den eingefrorenen Messstand nicht.
Nach Ablauf der Wartezeit werden nur vorhandene Messwerte gesprochen.
Fehlende Durchfahrten werden nicht als Ueberrundung ausgegeben.

Einstieg: „Nach Runde drei …“. Farbe, Modell und gegebenenfalls lokale
Spielerkennung identifizieren die Fahrzeuge. Nicht zugeordnet: „Wagen“.
Die Ergebnisansage beginnt mit „Gewonnen hat …“ und verwendet die finale
Rennwertung; sie ist von der Zwischenstands-Messung getrennt.

## Grenzen

Nur lokale Teilnehmer in Rundenrennen und Endurance, keine entfernten Clients.
Eine laufende Spieler-Rundenzeit wird nicht abgebrochen. Warnungen und Rennende
haben Vorrang. Am Rennende keine zusaetzliche Zwischenstandsansage.
Deutsch/Englisch; Spanisch verwendet Englisch. Zahlenclips werden wiederverwendet.
Keine Online-TTS und keine native Android-Erweiterung erforderlich.

## Audio und Build

Die 78 erweiterten OGG-Clips sind im PR enthalten. Keine Neuerzeugung erforderlich.
Optional mit Piper, FFmpeg und den Abhaengigkeiten aus tools/requirements.txt:

```powershell
python .\tools\voice_rennstand_erweitert.py --piper C:\tools\piper
python .\tools\voice_rennstand_erweitert.py --check
# Nur VW und Rundenanfang ersetzen (vier Dateien):
python .\tools\voice_rennstand_erweitert.py --vw-nach --piper C:\tools\piper
```

```powershell
python .\tools\build.py
python .\tools\build.py --check
git diff --check
```

Generierte index.html, sw.js und app-update.json gehoeren zum Build.
Die offizielle Versionsnummer wird in diesem Feature nicht geaendert.
Der Service Worker laedt erweiterte Rennstand-Clips online netz-zuerst und nutzt
sie offline aus dem Cache. Bereits geladene WebAudio-Puffer bleiben bis zum
Neuladen der Seite bestehen.

## Abnahme

Automatische Rennstand-Tests im bestehenden Selbsttest ausfuehren.
Manuell: drei Fahrzeuge, Intervall 1 und 5; kurze Sekundenabstaende;
Wartegrenze bei fehlender Durchfahrt; neues Rennen/Abbruch; Ergebnis nur einmal;
DE/EN; VW und Sonderfarben; Lautstaerke/Tempo/Hall; Offline und Cache-Update.
Android und echter Bluetoothbetrieb werden am Zielgeraet getestet.
