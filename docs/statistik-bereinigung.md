# Selektive Statistikbereinigung

Basis: OmegaSim 1.1.55, Commit d6746ed2a16f594a2561bfdd4d7827439858ec62.
Keine Release-Versionsanhebung und keine native Android-Aenderung.

## Bedienung
Optionen -> Statistiken -> **Statistiken bereinigen** aufklappen.

- Auto anhand Name und Kennung auswaehlen. Entfernt seine Lebenszeit-Statistik
  und seine Anteile aus gespeicherten Sitzungen. Mitfahrer und Garagenkonfiguration
  (einschliesslich Foto, Name und Farbe) bleiben erhalten.
- Einzelne Sitzung anhand Datum/ISO-Zeit, Modus, Autos, Runden, Bestzeit und
  Streckencode auswaehlen. Entfernt nur diese Sitzung.
- Umfang und Sonderfaelle werden vor dem Loeschen angezeigt und nochmals bestaetigt.
- Falls durch Auto-Loeschung keine Teilnehmer uebrigbleiben, wird die Sitzung entfernt.
  Beim Loeschen von Spieler 1 werden auch seine sitzungsweiten Kilometer, Fahrstil-
  und Strafdaten entfernt. Bei NPC-Loeschung bleiben diese Spielerwerte erhalten.
- Beide Ansichten (Statistiken und die Sitzungsliste in Renneinstellungen) sowie
  CSV-Exports verwenden danach die bereinigte Statistikablage.
- Bereinigung und Undo sind im laufenden Rennen/Training oder virtuellen Fahren gesperrt.

## Wichtig: Altdaten und Kilometer
Die Lebenszeit-Summen sind unabhaengig von den letzten maximal 200 Sitzungen.
Sie werden bewusst NICHT aus diesem begrenzten Archiv neu aufgebaut.

Neu gespeicherte Sitzungen erhalten pro Auto `statistikBuchung` mit dem exakt
gebuchten Schluessel und den km-/Runden-/Sitzungsbeitraegen. Beim Loeschen werden
nur diese exakten km-Beitraege abgezogen; aeltere korrekte Summen bleiben erhalten.

Alte Sitzungen haben diese Buchung nicht. Bei ihrer Loeschung werden Runden und
Sitzungsanzahl abgezogen, soweit die Zuordnung eindeutig ist. Die Lebenszeit-
Kilometer bleiben fuer diese Anteile unveraendert; Vorschau und Rueckfrage weisen
explizit darauf hin. Die aus Sitzungen berechneten Gesamtkilometer werden dagegen
sofort um die geloeschte Sitzung bereinigt. Alte km-Beitraege werden nicht geraten.

Geraetekennungen haben Vorrang vor Namen. Namenszuordnung bei Altdaten erfolgt nur,
wenn genau eine passende Fahrzeugsumme existiert. Mehrdeutige Altdaten erscheinen
als eigene `name:...`-Gruppe und werden nicht auf ein gleichnamiges Auto umgebucht.

Enthaelt eine geloeschte Sitzung die Fahrzeug-Bestzeit, wird die naechste Bestzeit
nur bei vollstaendiger Historie ermittelt. Fehlen aeltere Sitzungen, wird der Rekord
zurueckgesetzt und ab kuenftigen Fahrten neu gefuehrt. Die UI kennzeichnet diesen
Zeitraum, statt eine historische zweitbeste Zeit zu erfinden.

## Zeiten unter X Sekunden je Strecke
Die neue Auswahl **Zu kurze Zeiten je Strecke loeschen** erfasst alle gespeicherten
Sitzungsrunden mit Zeiten strikt unter dem eingegebenen Grenzwert in Sekunden.
Dezimalkomma und Dezimalpunkt funktionieren. Genau der Grenzwert bleibt erhalten.
Strecke wird ueber ihren Code ausgewaehlt; Drehung und gespiegeltes Layout gehoeren
wie bei den vorhandenen Bestzeiten zur gleichen Strecke. Andere Strecken bleiben
unveraendert. Vor dem Loeschen zeigen Vorschau und Trefferliste den Umfang.

Rundenzeiten und ihre indexbezogenen Boxen-/Crash-Ereignisse werden zusammen
entfernt; verbleibende Runden bekommen durchgehend neue Listenindizes. Leere
Sitzungen und Teilnehmer bleiben erhalten: die Fahrt hat trotzdem stattgefunden.
Rundenanzahl und betroffene Fahrzeugrekorde werden korrigiert. Kilometer,
Sitzungsanzahl und Kilometerbuchungen bleiben bewusst unveraendert. Eine falsche
Zeit beweist keine falsche gefahrene Entfernung. Fahrstil einer betroffenen
Spieler-1-Sitzung wird verworfen, da er ohne Neuberechnung nicht belastbar ist.

Zusaetzlich werden zu kurze lokale Time-Attack-Bestzeiten samt ihrer Medaille
zurueckgesetzt. Diese Ablage hat keine vollstaendige Historie fuer einen
zweitbesten Rekord. Der Zaehler bisheriger Time-Attack-Runden bleibt unveraendert;
eine neue gueltige Fahrt setzt den naechsten Rekord. Lokale Telemetrie-Eintraege
(beste/letzte Runde und Runden der letzten Fahrt) unter dem Grenzwert werden auch
entfernt. Online-/fremde Telemetrie und Challenge-Daten bleiben unveraendert.
Einzelne gezielt ausgewaehlte Runden sind mit diesem Filter noch nicht vorgesehen.

Nach jeder Bereinigung und nach Rueckgaengig werden Auswahl- und Statistiklisten
sofort aus der Ablage neu aufgebaut. Veraltete Auswahlen/Loeschplaene werden
zurueckgesetzt, der Bereinigungsbereich bleibt aufgeklappt. Ein Darstellungsfehler
der Renneinstellungen kann die erneuerte Loeschliste nicht mehr verhindern.

## Sicherung und Rueckgaengig
Vor jeder Loeschung wird der vorherige Statistikstand automatisch und bytegetreu
unter `chc.statistics.undo.v1` gesichert. Schlaegt die Sicherung fehl (z.B. voller
Speicher), wird NICHT geloescht. Diese lokale Sicherung gilt fuer die letzte
Bereinigung; die naechste Loeschung ersetzt sie.

`Letzte Bereinigung rueckgaengig` funktioniert auch nach Neuladen, aber nur,
solange die betroffenen Ablagen seit der Loeschung unveraendert sind. Das verhindert,
dass nachtraeglich aufgezeichnete Fahrten unbemerkt verloren gehen.

`Statistik-Sicherung als JSON` exportiert den VORHERIGEN Statistikstand im Format
des vorhandenen Sicherungsimports. Unter Optionen -> Sicherung kann die Datei
wieder geladen werden. Sie ersetzt die ganze Statistikablage, nicht einzelne
Runden; spaeter aufgezeichnete Sitzungen in dieser Ablage gehen dabei verloren.
Bei Zeitbereinigung enthaelt die Sicherung zusaetzlich den vorherigen Stand der
lokalen Bestzeit- und Telemetrieablage; beim Import werden auch diese ersetzt.
Garagen-/Reglerdaten sind nicht enthalten und werden beim Import nicht ersetzt.
Vor einer solchen Wiederherstellung ggf. den aktuellen Stand gesondert sichern.

JSON-Downloads sind fuer den Browser vorgesehen. In der Android-WebView nutze
fuer externe Dateien die vorhandene native Sicherungsfunktion VOR dem Bereinigen.
Die automatische lokale Sicherung/Undo funktioniert auch ohne Dateidownload.
Lokale Sicherung verschwindet, wenn Website-/App-DATEN geloescht werden!
Bei Deployment nur den Cache/Service Worker erneuern, nicht die Benutzerdaten.

## Build
`python tools/build.py`
`python tools/build.py --check`

Eine kleine Reparatur der Woerterbuchpruefung in build.py ist enthalten: nur eine
wirkliche I18N_EN-Deklaration beginnt die Pruefung, und CRLF-Zeilenenden duerfen
nicht das Ende des Woerterbuchs verbergen. Der Fehler trat bereits in der Basis auf.

## Optionale automatisierte Browserpruefung
Kein Playwright-Zwang fuer App oder manuelle Tests auf dem Webserver.

Voraussetzungen nur fuer das optionale Testskript:
`python -m pip install playwright`
`python -m playwright install chromium`

Ausfuehrung:
`python tools/test_statistik_bereinigung.py`
Alternativ mit vorhandenem Chrome:
`python tools/test_statistik_bereinigung.py --browser <Pfad-zu-Chrome>`

Das Skript startet einen lokalen Testserver und verwendet ein frisches Browserprofil.
Es exportiert Testzugriffe nur im temporaeren Test-HTML, nicht in index.html.
Getestet: selektive Auto-/Sitzungsloeschung, Legacy-Daten, gleiche Namen, exakte km,
Bestzeiten, Rueckfrage, lokale Sicherung, Undo, Quota-/Schreibfehler, Schutz vor
veralteter Auswahl und laufender Fahrt, JSON-Import sowie vorhandene Statistik-,
Sicherungs- und Telemetrietests.

## Manuelle Pruefung auf dem eigenen Webserver
1. Vorher Optionen -> Sicherung exportieren.
2. Mit unkritischen Testdaten eine Sitzung entfernen; Liste und Tabellen vergleichen.
3. Rueckgaengig ausfuehren und mit dem alten Stand vergleichen.
4. Ein altes Auto entfernen; gleichnamige/andere Autos und Garage muessen bleiben.
5. Altdaten-Warnungen kontrollieren; keine stillen Kilometer-Schaetzungen.
6. Auf Android die lokale Sicherung/Undo pruefen.

## Mehrere Speicherablagen und Grenzen
Die Zeitbereinigung sichert den Originalstand aller drei Ablagen vor dem Schreiben.
Bei erkannten Schreibfehlern werden bereits geschriebene Ablagen zurueckgenommen.
Bei ploetzlichem Browser-/Systemabbruch waehrend des Schreibens gibt es keine
atomare localStorage-Transaktion. Die Sicherung bleibt fuer den manuellen Import
erhalten. Deshalb vor Bereinigungen zusaetzlich Optionen -> Sicherung nutzen.

## Zusaetzliche optionale Tests
`python tools/test_statistik_zeiten.py` (Playwright/Chromium nur fuer Automatisierung)
prueft Zeitgrenzen, Streckenisolation, Ereignisindizes, Rekorde, Telemetrie,
Drei-Ablagen-Sicherung/Undo, Speicherfehler und den sofortigen Listen-Refresh.
Manuelle Tests auf dem Webserver bleiben ohne Playwright moeglich.


## Sichtbare Live-Aktualisierung nach der Bereinigung

- Nach Loeschen und Rueckgaengig werden Statistik, Sitzungsliste und Bereinigungsbereich aus dem aktuellen localStorage neu gezeichnet. Kein Seiten-Reload, keine Loeschung der Website-Daten.
- Die ausgewaehlte Strecke, die eingegebene Sekundengrenze und die offene Trefferansicht bleiben erhalten. Die Zeitvorschau wird neu berechnet: nach erfolgreicher Zeitbereinigung stehen dort null Treffer, der Loeschknopf ist gesperrt.
- Eine Statusmeldung nennt den Loeschumfang. `Gespeichert: … Fahrzeug(e), … Sitzung(en).` zeigt den geladenen Stand.
- `Anzeige aktualisieren` liest die gespeicherten Daten erneut ein, ohne zu loeschen oder die Rueckgaengig-Sicherung zu ersetzen.
- Fahrzeug- und Sitzungsauswahl werden zurueckgesetzt, damit kein alter Index versehentlich einen anderen Datensatz loescht.
- Darstellungsfehler erscheinen sichtbar im Status. Eine erfolgreich gespeicherte Bereinigung wird deswegen nicht automatisch rueckgaengig gemacht.

Optionaler Regressionstest: `python tools/test_statistik_zeiten.py` (Playwright und Chromium nur fuer den Test erforderlich).


## Speicherfix und datenbasierte Listen (Folgepatch statistik-speicher.patch)

- Rueckgaengig-Sicherungen werden asynchron in IndexedDB gespeichert: Datenbank
  `omegasim-statistics-backups`, Object Store `backup`. Kein neuer grosser Eintrag
  unter `chc.statistics.undo.v1` im LocalStorage.
- Ein vorhandener gueltiger LocalStorage-Undo-Stand wird zuerst dauerhaft nach
  IndexedDB migriert; erst danach wird der alte Eintrag entfernt. Bei Fehlern
  bleibt er erhalten. Keine Garagen-, Foto- oder anderen Website-Daten loeschen.
- `pending` sichert die neue Operation VOR der Statistik-Schreibung. Erst die
  erfolgreiche Bereinigung ersetzt `current`. Fehlgeschlagene Versuche behalten
  das vorhandene Undo; bei unvollstaendiger Ruecknahme bleibt pending exportierbar.
- Waehrend der Sicherung sind Loeschknopf/Undo gegen Doppelklick gesperrt.
  Datenstand und Fahrtzustand werden nach der asynchronen Sicherung erneut geprueft.
  Verfuegbare Web Locks koordinieren Bereinigungen mehrerer Tabs.
- IndexedDB kann bei fehlendem Geraetespeicher oder gesperrtem Browserspeicher
  ebenfalls scheitern. Dann keine ungesicherte Loeschung, sondern sichtbarer Fehler.
- Autoauswahl und Fahrzeugtabellen blenden reine Null-Summen ohne Sitzungsanteil
  aus. Echte verbleibende Lebenszeit-Kilometer, Runden, Sitzungen oder Fahrzeugrekorde
  sowie Trainingssitzungen ohne Runde bleiben sichtbar.
- Streckenauswahl der Zeitbereinigung enthaelt nur gespeicherte numerische
  Sitzungszeiten, lokale Bestzeiten oder bereinigbare lokale Telemetriezeiten.
  Leere Strecken-/Fahrerhuellen und ausschliesslich fremde Telemetrie genuegen nicht.
- Nach Entfernen der letzten Zeit verschwindet die Strecke sofort aus der Auswahl;
  eine Meldung erklaert das. Rueckgaengig bringt die Daten und die Listeneintraege
  ohne F5 zurueck. Gespeicherte Strecken in der Garage werden nicht geloescht.
- Die Erklaerung zur Sicherung steht hinter dem i im Kreis neben der Ueberschrift.
- Website-Daten weiterhin NICHT loeschen: das wuerde auch IndexedDB-Sicherungen
  und die eigentlichen Statistikdaten entfernen. Bei Deployment im gleichen
  Browser-Ursprung (Schema, Host und Port) bleiben die Daten erhalten.

### Zusatztests
`tools/test_statistik_speicher.py` ist ein optionaler isolierter Browsertest mit
Playwright. 46 neue Pruefungen: echter LocalStorage-Quota-Fall, UI-Klick,
F5/Undo/JSON-Export, Migration/Fehler, Schutz der bisherigen Sicherung,
Fahrtstart waehrend Sicherung sowie leere Auto-/Streckeneintraege.
Die bisherigen 54 + 78 Pruefungen und 7 vorhandenen Tests bestehen ebenfalls.
Manuelles Testen auf dem Webserver erfordert weiterhin kein Playwright.

## Uebernahme in OmegaSim (Nacharbeiten)

- Alle Texte laufen ueber das normale Woerterbuch (`t()`, I18N_EN und I18N_ES in
  `src/10-ble-explorer.js`); `#stat-bereinigen` ist nicht mehr `data-i18n-skip`.
  Spanisch zeigt damit Spanisch statt Deutsch.
- Altsitzungen ohne `statistikBuchung`, deren Auto beim Speichern nicht in der Garage
  stand, tragen in der Sitzung `a.id`, gebucht wurde aber unter `name:<Name>`.
  `statCleanAutoKey` bildet das jetzt nach: das Auto steht nur noch einmal in der
  Auswahl und seine Anteile werden zugeordnet statt uebersprungen.
- Selbsttest `Statistikbereinigung v1.2.15` (src/95-selftest.js): Vorschau, zu kurze
  Zeiten, Ruecknahme auf Probe-Schluesseln, Altdaten-Zuordnung und Spanisch.
- Bereich als WIP gekennzeichnet.
