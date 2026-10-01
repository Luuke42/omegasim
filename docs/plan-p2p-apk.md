# OmegaSim als Android-App mit WLAN-Mehrspieler ohne PC

**Umgesetzt ab v0.8.12** (experimentell). Der ursprüngliche Plan steht darunter; dieser
Abschnitt sagt, was gebaut ist und wo es liegt.

## Stand

| Teil | Wo | Stand |
|---|---|---|
| Capacitor-Hülle | `android-app/` (`npx cap sync android`) | gebaut, lokal kompiliert |
| Bluetooth-Brücke | `src/05-app-bruecke.js`, also **in index.html** | fertig, auf dem Telefon zu bestätigen |
| Selbstaktualisierung | `OmegaUpdatePlugin.java`, `tools/app_update.py`, `app-update.json` | fertig |
| Host im Telefon | `OmegaHostPlugin.java`, `HostServer.java`, `OmegaHostService.java` | fertig |
| Info-Screen | `src/97-sessions.js` (`mpi…`), `#mp-info` | fertig, im Browser getestet |
| Release | `.github/workflows/android.yml`, Tag `apk-v<Version>` | wartet auf die Secrets |

### Updates ohne neue APK

BESTELLT: „Ich will, dass ich die App einfach updaten kann ohne die APK neu installieren zu
müssen.“

- `tools/build.py` schreibt bei jedem Bau `app-update.json`: Version, APK-Stufe und für jede
  Datei (index.html, audio/, icons/ …) die SHA-256. Textdateien werden mit LF gehasht, so wie
  GitHub Pages sie ausliefert.
- Die App fragt beim Start `https://lukasroeseler.github.io/btsr/app-update.json` ab. Ist die
  Version neuer, erscheint auf der Startseite „Update verfügbar“. Ein Tipp lädt **nur die
  geänderten Dateien**, alles andere wird aus der laufenden Fassung kopiert. Danach zeigt die
  WebView auf den neuen Ordner (Capacitor `serverBasePath`).
- Die Herkunft bleibt `https://localhost`. Damit bleiben alle Einstellungen, gemerkten Autos
  und Rekorde erhalten.
- **Rückfall:** Die neue Fassung muss sich binnen 25 s melden (`bestaetigen()`). Tut sie das
  nicht, schaltet die App zurück. Beim nächsten Start wird die Fassung nicht erneut angeboten.
- **Neue APK nötig** ist nur, wenn `APK_STUFE` steigt (in `tools/app_update.py` und
  `OmegaUpdatePlugin.java` gleichzeitig hochzählen, sobald index.html ein neues natives Plugin
  braucht). Dann bietet die App den Download der APK an.
- Quelle ist jeder Push auf `main` (Nutzerentscheid), sobald Pages ihn ausliefert.

### Info-Screen

BESTELLT: „Ich will ein Gerät sich einloggen lassen, das rein als Info-Screen fungiert
(Streckenscreen, ohne eigenes Auto; zB ein Tablet).“

- Die einfachste Variante braucht kein Installieren: Im Browser des Tablets
  `http://<Host>:8080/?info` öffnen. Das geht mit dem Telefon-Host und mit
  `tools/omegasim_host.py`, denn beide liefern die App selbst aus.
- In der App: Mehrspieler → „Als Info-Screen“.
- Der Info-Screen meldet sich mit `/mp/state?zuschauer=<id>`. Solange einer zusieht, schicken
  die Fahrer dreimal je Sekunde ihre Kartenpunkte (eigenes Auto und Ghosts) und den Kurzcode
  der Strecke. Ohne Zuschauer bleibt es bei Rundenschluss und Lebenszeichen.
- Zwischen zwei Berichten rechnet der Info-Screen jedes Auto mit seinem Tempo bis zu 0,8 s
  weiter.

### Eine APK bauen

Lokal (Werkzeuge in `%USERPROFILE%\.omegasim-android`, nicht im Repo):
`python tools/build.py && python tools/apk_www.py`, dann in `android-app`
`npx cap sync android`, dann `android\gradlew assembleRelease` mit den Umgebungsvariablen
`OMEGA_KEYSTORE`, `OMEGA_KEYSTORE_PASSWORD`, `OMEGA_KEY_ALIAS` und `OMEGA_KEY_PASSWORD`.

Über GitHub: einmal `gh auth login` und `tools/android_secrets.ps1`, danach baut jeder Tag
`apk-v0.8.12` eine signierte APK und hängt sie ans Release.

---

# Ursprünglicher Plan (28.09.2026)

## Ziel

- Eine APK, die **dieselbe `index.html`** ausführt wie der Browser. Es gibt keinen zweiten
  Codezweig: Neue Funktionen kommen automatisch in die App.
- Mehrere Telefone im selben WLAN fahren gegeneinander. **Eines davon ist Host**, ein PC
  ist nicht nötig.
- Jedes Telefon verbindet sein eigenes Auto und rechnet seine eigene Physik, wie heute mit
  `tools/omegasim_host.py`. Reißt das WLAN ab, fährt jeder weiter, nur die Rangliste
  bleibt stehen.
- Verteilung: Jeder Tag `v*` baut eine signierte APK und hängt sie an das GitHub-Release.

## Warum eine App nötig ist (und nicht nur der Browser)

Heute scheitert WLAN-Mehrspieler am **Secure Context**:

- Web Bluetooth läuft nur unter `https://`, `http://localhost` oder `file://`.
- Eine App, die ein PC unter `http://192.168.x.x` ausliefert, kann deshalb kein Auto
  verbinden. Umgehen lässt sich das nur mit einem Chrome-Flag je Telefon oder einer eigenen
  Zertifizierungsstelle (siehe Kopf von `tools/omegasim_host.py`).

In einer App-Hülle entfällt das: Die Seite wird lokal ausgeliefert, unter
`https://localhost`. Dafür entsteht ein neues Problem: **Der Android-WebView hat kein Web
Bluetooth.** Das muss eine native Brücke nachbilden (Abschnitt 2).

## Bauform

```
 Telefon A (Host)                         Telefon B, C, D (Gäste)
 ┌────────────────────────────┐           ┌────────────────────────────┐
 │ WebView: index.html        │           │ WebView: index.html        │
 │   navigator.bluetooth ─────┼─ Shim ─┐  │   navigator.bluetooth ─ Shim
 │   fetch /mp/* ─────────────┼──┐     │  │   fetch http://A:8080/mp/* ──┐
 ├────────────────────────────┤  │     │  ├────────────────────────────┤ │
 │ BLE-Plugin ──► Auto A      │  │     │  │ BLE-Plugin ──► Auto B      │ │
 │ HTTP-Host :8080 ◄──────────┼──┘◄────┼──┼────────────────────────────┼─┘
 │  (gleiche API wie          │        │  └────────────────────────────┘
 │   omegasim_host.py)        │        │
 └────────────────────────────┘        └ jede App hat ihre eigene BLE-Verbindung
```

### 1. Hülle: Capacitor

- **Capacitor** (Ionic) packt einen Ordner `www/` in eine Android-App mit System-WebView.
  Die App lädt ihn unter `https://localhost` (`androidScheme: 'https'`), damit ist sie ein
  Secure Context.
- Neuer Ordner `android-app/` mit `capacitor.config.json`, `package.json` und dem
  erzeugten `android/`-Projekt.
- Ein Build-Schritt `tools/apk_www.py` kopiert `index.html`, `audio/`, `mp-overview.html`
  und das Manifest nach `android-app/www/`. **Die HTML-Datei wird nicht verändert.**
- Offen: Der Service-Worker (`sw.js`) ist in der App unnötig. Er sollte sich unter
  Capacitor nicht registrieren, dafür reicht eine Zeile Prüfung (`window.Capacitor`).

### 2. Web Bluetooth nachbilden: Shim über `@capacitor-community/bluetooth-le`

Die App nutzt genau diese Aufrufe (gezählt in `src/`):

| Web Bluetooth | Plugin (`BleClient`) |
|---|---|
| `navigator.bluetooth.getAvailability()` | `isEnabled()` |
| `navigator.bluetooth.requestDevice({filters, optionalServices})` | `requestDevice({services, namePrefix})` |
| `device.gatt.connect()` / `.connected` / `.disconnect()` | `connect(id, onDisconnect)` / eigener Zustand / `disconnect(id)` |
| `gattserverdisconnected` | Rückruf `onDisconnect` |
| `getPrimaryService(s)`, `getCharacteristic(s)` | `getServices(id)`, lokal gefiltert |
| `writeValueWithoutResponse` (13×) / `writeValueWithResponse` (4×) | `writeWithoutResponse` / `write` |
| `startNotifications` + `characteristicvaluechanged` | `startNotifications(id, svc, chr, cb)` |

- Eine Datei `android-app/www/ble-shim.js`, **vor** `index.html` eingebunden, und nur wenn
  `Capacitor.isNativePlatform()`. Sie baut `navigator.bluetooth` mit denselben Objekten
  und Ereignissen nach: `BluetoothDevice`, `gatt`, Service und Characteristic mit
  `value` als `DataView`.
- Die Web-App merkt davon nichts. Der Selbsttest läuft in der App unverändert mit.
- Nach dem Verbinden `requestConnectionPriority(HIGH)`, sonst gibt Android ein
  Verbindungsintervall von 30–50 ms. Dann passt der 45-ms-Sendetakt nicht mehr sicher
  hinein.
- Berechtigungen: `BLUETOOTH_SCAN` und `BLUETOOTH_CONNECT` (ab Android 12), bis Android 11
  Standort.

### 3. Host im Telefon: dieselbe API wie `omegasim_host.py`

Der Mehrspieler-Client in `src/97-sessions.js` spricht heute:

| Pfad | Zweck |
|---|---|
| `GET /mp/state` | Rangliste aller Telefone |
| `POST /mp/report` | eigener Stand (JSON, höchstens 8 KiB) |
| `GET /mp/info` | Rennlänge und Host-Adresse |
| `GET /mp/reset` | neues Rennen |
| `OPTIONS` | Vorabflug mit CORS `*` (sonst kommt der POST nie an) |

- Ein kleines **eigenes Capacitor-Plugin** `OmegaHost` (Java, NanoHTTPD, eine Datei) auf
  Port 8080. Es bildet genau diese fünf Antworten nach, samt Kopfzeilen (`no-store`,
  CORS). Die Logik von `melden()` und `zustand_lesen()` wird aus der Python-Datei
  übertragen, einschließlich der Wertungsregel.
- Zusätzlich liefert der Host `mp-overview.html` aus. Damit kann ein Fernseher oder
  Laptop im WLAN die Rangliste zeigen, ohne etwas zu installieren.
- **Vordergrunddienst** mit Benachrichtigung „OmegaSim-Host läuft“, damit Android den
  Server bei ausgeschaltetem Bildschirm nicht beendet.
- Ein Schalter „Dieses Telefon ist Host“ im Mehrspieler-Bereich. Dafür braucht die Web-App
  eine kleine Erweiterung: `window.OmegaHost?.start()`, fehlt im Browser einfach.

**Zwei Netzregeln von Android, die sonst erst beim ersten Test auffallen:**

- **Mixed Content.** Die App läuft unter `https://localhost`, der Host unter
  `http://192.168.x.x`. Der WebView blockiert das, bis in der Capacitor-Konfiguration
  `android.allowMixedContent: true` gesetzt ist.
- **Klartext-HTTP** ist ab Android 9 gesperrt. Nötig ist eine
  `network_security_config.xml` mit `cleartextTrafficPermitted="true"`. IP-Bereiche lassen
  sich dort nicht eingrenzen, darum gilt es für die ganze App. Vertretbar, weil die App
  sonst keine Netzanfragen stellt.

### 4. Finden statt Tippen

- **NSD/mDNS** (Android `NsdManager`): Der Host meldet `_omegasim._tcp`, Gäste zeigen eine
  Liste „Host gefunden: Telefon von …“. Das geht über das Plugin, die Web-App bekommt nur
  eine Adresse.
- **Rückfall:** Der Host zeigt `http://IP:8080` als Text und als QR-Code. Ein Gast gibt die
  Adresse von Hand ein, das Feld dafür gibt es heute schon. Einen QR-Scanner gibt es
  vorerst nicht, weil er eine Kameraberechtigung bräuchte, nur um eine Zeile Text zu
  sparen.
- Manche Router (Gast-WLAN, „AP-Isolation“) lassen Geräte nicht miteinander sprechen. Die
  App soll das melden: Sie fragt `/mp/info` und schreibt bei einer Zeitüberschreitung
  „Host nicht erreichbar, AP-Isolation?“.

### 5. GitHub-Release

`.github/workflows/apk.yml`, ausgelöst durch einen Tag `v*`:

1. `actions/setup-java` (JDK 21) und `actions/setup-node`.
2. `python tools/build.py`, dann `python tools/apk_www.py`.
3. `npx cap sync android`.
4. `./gradlew assembleRelease`. Signiert wird mit einem Keystore aus den Secrets
   (`ANDROID_KEYSTORE_B64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
   `ANDROID_STORE_PASSWORD`).
5. Die APK als `OmegaSim-<version>.apk` an das Release hängen (`gh release upload`).

- `versionName` kommt aus der Programmversion von `bump_version.py` (etwa `0.8.11`).
- `versionCode` ist Woche × 1000 + Push (0.8.11 → 8011). Er steigt damit streng, wie
  Android es für Updates verlangt.
- Den Keystore einmal erzeugen, sicher verwahren und nie ins Repo legen. Geht er
  verloren, lassen sich installierte Apps nicht mehr aktualisieren.

## Risiken

| Risiko | Was dagegen hilft |
|---|---|
| Brückenlatenz JS → nativ beim 45-ms-Takt | `writeWithoutResponse` ohne `await`-Kette. Messen: Selbsttest „Steuertakt“ in der App |
| Android drosselt Zeitgeber bei verdecktem WebView | derselbe Befund wie im Vorschaufenster: MessageChannel statt setTimeout; Bildschirm an halten (Wake Lock) |
| BLE und WLAN teilen sich 2,4 GHz | Router auf 5 GHz, und es erst mit vier Telefonen messen |
| Akku bei Host und Vordergrunddienst | Dienst nur während eines Rennens, danach beenden |
| Shim weicht in einem Randfall vom Browser ab (Reihenfolge der Ereignisse, `value`-Puffer) | Selbsttests mit Attrappe laufen in beiden Umgebungen; zusätzlich ein Shim-Test gegen den GATT-Explorer |
| iOS | nicht abgedeckt; dort gibt es auch kein Web Bluetooth im Browser |

## Aufwand (geschätzt)

| Teil | Sitzungen |
|---|---|
| Capacitor-Hülle, `apk_www.py`, Berechtigungen | 1 |
| BLE-Shim samt Tests | 1–2 |
| Host-Plugin (NanoHTTPD, Vordergrunddienst, NSD) | 2 |
| CI-Workflow und Signierung | 1 |
| Test auf echten Geräten (2–4 Telefone, echte Autos) | 1+ |

## Testplan

1. **Browser unverändert:** Die volle Selbsttest-Suite im Browser gibt dieselbe Zahl wie
   vorher (die HTML-Datei ist dieselbe).
2. **App ohne Auto:** Selbsttest-Kachel in der APK, 0 Fehler. „Nicht prüfbar“ nur dort, wo
   es auch im Browser steht.
3. **App mit Auto:**
   - verbinden
   - Lenkbyte und Gasbyte im Protokoll-Labor
   - Rundenzeiten
   - Ausdruck-Modus
   - Trennen und Wiederverbinden
4. **Zwei Telefone:** A ist Host, B findet ihn per NSD, beide fahren, die Rangliste auf
   beiden und auf `mp-overview.html` im Laptop-Browser stimmt.
5. **Störfälle:**
   - WLAN am Gast aus: Er fährt weiter, die Rangliste steht und läuft danach weiter.
   - Host-Bildschirm aus für 2 Minuten: Der Dienst lebt.
   - Host-App geschlossen: Gäste melden „kein Kontakt zum Host“.
6. **Release:** Tag setzen, die Action läuft durch, die APK installiert sich über eine
   ältere Version, ohne die gespeicherten Einstellungen zu verlieren.
