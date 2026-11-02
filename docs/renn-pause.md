# Lokale Rennpause

Urspruenglich PR #9 (Playdater1974) auf Basis 1.1.54, uebernommen in 1.2.25 (WIP).

## Bedienung
Controllerbelegung: Pause / Fortsetzen einer freien Taste zuweisen (anfangs unbelegt).
Alternativ Pause im Cockpit. Erneuter Druck startet die Wiederanlaufampel.
Noch ein Druck waehrend der Ampel bricht den Wiederanlauf ab und bleibt pausiert.
Nach Gruen Gas/Bremse und Lenkung zuerst neutral stellen.

Gilt fuer lokale Fahrmodi inkl. Training, Endurance, Time Attack, Qualifying,
Runden, Knockout, Derby, virtuelles Fahren. Multiplayer und Kalibrierung ausgenommen.
Keine Renn-Neuinitialisierung beim normalen Fortsetzen.

## Durchgefuehrte Softwarepruefungen
- Build und build.py --check erfolgreich, 268 lokale Referenzen vorhanden.
- Drei Inline-Skriptbloecke syntaktisch geprueft; Chromium ohne Ladefehler.
- 45 gezielte Tests gegen echte App-Funktionen mit simulierten Uhren, Pads
  und BLE-Zielen: alle bestanden (tools/test_renn_pause.py).
- Alle 514 eingebauten Selbsttests nacheinander in separaten Chromium-Seiten
  fuer Original und Patch, identischer Zufallsstart: jeweils 495 bestanden,
  17 ohne ok-Ergebnis/ausgelassen, 2 bestehende Layout-/Kontrastbefunde.
  Keine neu hinzugekommenen Fehlschlaege.
- Native Paketneutralisierung aus OmegaBlePlugin.java separat mit Java 21
  kompiliert und getestet, CRC mit echtem JS-crc8 verglichen (0x47).
- Update-Manifest gegen LF-normalisierte Dateien geprueft.

## Test wiederholen
python tools/build.py
python tools/build.py --check

Optional (Python-Paket playwright und dessen Chromium erforderlich):
python tools/test_renn_pause.py

## Grenzen und erforderliche Handtests
KEIN Android-APK-Build und KEIN Test an echten Fahrzeugen/Controllern ausgefuehrt.
Native Warteschlangensperre ist erst nach neuem APK-Build verfuegbar;
auf alten APKs sperrt der JS-Sendepfad, aber schon nativ eingereihte Pakete
koennen nicht aus JavaScript zurueckgerufen werden.
Auch neue APKs koennen bereits an GATT/Fahrzeug uebergebene Befehle nicht widerrufen.
Neutralgas ist der vorhandene Software-Stopp, kein garantierter Hardware-Not-Aus.
Bluetooth-Latenz und Bremsweg bleiben. Erst mit niedriger Leistung testen.

Handtests: Spieler 1-3 und Gegner; Pause waehrend Startampel, Gelb,
Einfuehrungsrunde, Zielauslauf, Tank-/Reifen-/Reparaturstopp; Runden-/Sektor-
und Restzeit nach langer Pause; Abbruch; Verbindungsabbruch/Wiederverbinden.

## Aenderungen bei der Uebernahme (1.2.25)
- Native Sperre ueberlebt kein Neuladen mehr: die Seite ruft beim Laden
  OMEGA_BRUECKE.rennPause(false), das Plugin setzt sich in load() und bei
  jedem Seitenstart der WebView (onPageStarted) selbst zurueck.
- verzug (Summe der Pausen) wird beim Rennstart auf 0 gesetzt
  (rennUhrNullen). Damit gilt im Rennen rennZeitJetzt() = Date.now(), und die
  Wanduhr-Startzeit des WLAN-Mehrspielers liegt wieder exakt.
- Mehrspieler: keine Pause; eine schon laufende lokale Pause endet ohne Ampel,
  sobald der Mehrspieler aktiv ist oder ein Startplan des Hosts kommt.
- Pause im Countdown bricht ein laufendes Rennintro ab; Gruen kommt ueber die
  Wiederanlaufampel.
- Java: ohne Pause ist der Schreibpfad wieder exakt wie vorher (erster Versuch
  wird immer geschrieben); verworfen wird nur, wenn seit der Entnahme eine
  Pause begann.
- Selbsttest "Rennpause v1.2.25" in src/95-selftest.js.
