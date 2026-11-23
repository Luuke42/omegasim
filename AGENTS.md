# AGENTS.md – Anleitung für KI-Agenten (und Menschen) an OmegaSim

OmegaSim ist eine offene Steuer-App für Carrera-HYBRID-Autos (Web Bluetooth und Android-App) mit Simulation, virtuellem
Fahren und Rennmodi. Lizenz: GNU AGPL-3.0-or-later (Code); mitgelieferte Modelle, Strecken, Klänge und Wiki-Texte haben
eigene Lizenzen (siehe `LICENSE`, `img/autos/*/LIZENZ.txt`, `img/strecken/LIZENZ.txt`, `audio/CREDITS.md`).
Diese Datei fasst die Wiki-Seite „Anleitung für KIs“ (https://omegasim.miraheze.org) für die Arbeit am Code zusammen.

## Issues: wo, und vor der Arbeit zuweisen
- Fehler und Wünsche stehen als **Issues auf https://github.com/Luuke42/omegasim/issues**.
- **Issues, Kommentare und Pull-Request-Beschreibungen auf Englisch** (dort arbeiten Leute aus mehreren Ländern mit).
  Code-Kommentare, Patchnotes und App-Texte bleiben deutsch (mit EN/ES-Übersetzung).
- **Vor der Bearbeitung prüfen, ob ein Issue schon jemandem zugewiesen ist.** Ist es frei: sich selbst zuweisen
  (bzw. das Konto, unter dem du arbeitest) und einen kurzen Kommentar „in Arbeit“ schreiben. Ist es vergeben: nicht
  parallel daran arbeiten, sondern im Issue nachfragen.
- Commits und Pull Requests nennen das Issue („Bezug: #12“ bzw. „Closes #12“, wenn es damit erledigt ist).
- Neue Fehlerberichte über die Vorlage „Fehler melden“ (Version, APK oder Browser, Gerät, Betriebssystem, Browser und
  Version, Gamepad, Screenshot oder Live-Log).

## Aufbau
| Ort | Inhalt |
|---|---|
| `src/00-index.head.html` | gesamtes Markup und CSS, inklusive Optionen, Hilfetexte und Patchnotes |
| `src/*.js` | die Logik, nummeriert in Ladereihenfolge; alle Dateien teilen sich EINEN Gültigkeitsbereich |
| `index.html`, `sw.js`, `app-update.json` | **erzeugt** – nie von Hand ändern |
| `tools/build.py` | baut `index.html` aus `src/` (Exit-Code prüfen!) |
| `tools/bump_version.py` | setzt die Version (Schema 1.<Woche>.<Push>) und baut `sw.js`/`app-update.json` neu |
| `android-app/` | native Android-Hülle mit dem Bluetooth-Plugin OmegaBle |
| `CARRERA_HYBRID.md` | Technik-Doku: Protokoll, Messungen, Begründungen |

## Ablauf einer Änderung
1. Änderung in `src/` machen. Zustand, den das Laden früh liest (z. B. `renderGarage`), mit `var` statt `let/const`
   anlegen (sonst Fehler durch die „temporal dead zone“ im gemeinsamen Gültigkeitsbereich).
2. Neue sichtbare Texte übersetzen: Englisch und Spanisch stehen als Wörterbücher in `src/10-ble-explorer.js`
   (Schlüssel = deutscher Text). Keine doppelten Schlüssel.
3. Neue Funktionen von Anfang an mit `<span class="wip-tag">WIP</span>` kennzeichnen.
4. Erklärungen zu Optionen nur ins ⓘ-Fenster (`<small>` im `.opt-label`), nie als Text unter die Zeile.
5. Keine Geviertstriche (—) in Texten.
6. Selbsttest schreiben: `stAdd('Name vX.Y.Z: …', () => ({ ok, mass }))` in `src/95-selftest.js`.
7. `python tools/build.py`, dann das größte Skript aus `index.html` mit `node --check` prüfen.
8. Selbsttest laufen lassen (Kachel „Selbsttest“, Adresszusatz `?st=Name` für einzelne Tests). Rot darf nur werden, was
   vorher schon rot war (bekannt: „Kontrast (WCAG)“).
9. Patchnotes ergänzen (Abschnitt je Nebenversion, deutsch, mit englischer Übersetzung im Wörterbuch).
10. Version mit `python tools/bump_version.py` setzen; die gültige Nummer ist die, die das Werkzeug ausgibt.

## Was man nicht kaputt machen darf
- **Den Sendeweg.** Die App schickt jedem Auto alle 45 ms ein Fahrpaket. Nichts darf diesen Takt verzögern oder Pakete
  unterdrücken. Änderungen daran nur mit Messung (Optionen → System: Funk-Rundlauf, Zähler „gesperrt“).
- **Bluetooth-Verbindungen.** Jede fehlgeschlagene Verbindung sauber trennen.
- **Gespeicherte Einstellungen.** Neue Speicherschlüssel statt alte umdeuten.
- **Die bitgleichen Fahrmodelle** „Omega“ und „Physik“ (Selbsttests prüfen das).

## Testen im Browser
- Ton beim automatischen Testen stumm schalten. In verborgenen Fenstern drosselt der Browser Zeitgeber.
- Nach dem Testen Server und Tabs schließen.
- Alles mit echten Autos (Kopplung, Latenz, Klang, Vibration) lässt sich nur am Tisch prüfen: das ausdrücklich sagen.

## Pull Requests und Pushes
- Nur `src/`, `tools/`, `android-app/` und Doku ändern; erzeugte Dateien werden beim Übernehmen neu gebaut.
- Beschreiben, was getestet wurde und was nicht. Änderungen an `android-app/` brauchen eine neue APK und einen Test am Auto.
- Keine Zugangsdaten eingeben oder auslesen; kein Force-Push; keine Historie umschreiben.
- Inhalte Dritter (Modelle, Strecken, Klänge) nur mit Lizenz/Freigabe und Eintrag in den Credits.
