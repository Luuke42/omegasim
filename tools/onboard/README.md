# Onboard-Kamera (WIP)

OmegaSim zeigt das Bild einer Kamera im Auto als Cockpit-Schirm „Onboard“: Zeiten oben links, Tempo, Gang und Tank unten in der Mitte, wie beim virtuellen Fahren. Aufnahmen sind möglich, und die Anzeige ist mit im Video. Eingeschaltet wird die Kamera in der **Garage → Onboard-Kamera**.

Es gibt zwei Quellen.

## 1. USB (Webcam-Weg)

Alles, was sich am Tablet oder PC wie eine Webcam meldet, zum Beispiel eine analoge FPV-Mikrokamera (5,8 GHz) im Auto und ein USB-Empfänger (UVC) am Tablet. Dafür braucht es keine eigene Firmware. Grundlage ist gnen54s Zweig `onboard`.

## 2. WLAN: M5Stack Timer Camera (ESP32)

Die Timer Camera X (ESP32 mit 8 MB PSRAM, OV3660) sendet ein MJPEG-Bild über WLAN. OmegaSim braucht von der Firmware nur zwei Dinge:

1. **MJPEG-Strom** (`multipart/x-mixed-replace`) unter einer Adresse, z. B. `http://192.168.1.50/stream`.
2. Für **Aufnahmen** zusätzlich den Kopf `Access-Control-Allow-Origin: *` am Strom. Ohne ihn zeigt OmegaSim das Bild, nimmt aber nicht auf („ohne Aufnahme (CORS)“).

### Firmware aufspielen

- Arduino IDE: den M5Stack-Boardverwalter installieren, Board „M5TimerCAM“ wählen und in der Bibliotheksverwaltung die Bibliothek **Timer-CAM** von M5Stack installieren. Danach das Web-Kamera-Beispiel öffnen, WLAN-Name und Passwort eintragen und hochladen. Quelltext: https://github.com/m5stack/TimerCam-arduino
- Alternative: das Arduino-ESP32-Beispiel **CameraWebServer**. Es streamt auf Port 81 (`http://<ip>:81/stream`) und setzt den CORS-Kopf schon. Die Pinbelegung der Timer Camera in `camera_pins.h` bitte gegen die M5Stack-Dokumentation prüfen.
- Auflösung: VGA (640×480) oder kleiner ist ein guter Anfang, das hält die Verzögerung klein. JPEG-Qualität ungefähr 12.

### In OmegaSim

- Garage → Onboard-Kamera → Quelle „M5Stack Timer Camera (WLAN)“ → Adresse eintragen (z. B. `192.168.1.50`) → Einschalten.
- Steht nur eine IP da, versucht OmegaSim zuerst `/stream` auf Port 80 und dann Port 81.
- Am besten gibt der Router der Kamera eine feste IP.
- Bricht das Bild ab, zum Beispiel weil der Akku im Auto gewechselt wurde, verbindet OmegaSim nach 4 s von selbst neu, solange die Kamera eingeschaltet ist.

### Wichtig: https

Die veröffentlichte Webseite läuft über https, und ein Browser lädt dort kein `http://`-Kamerabild („gemischte Inhalte“). So geht es:

- **Android-App**: erlaubt es.
- **„Start OmegaSim.bat“** (localhost): erlaubt es.
- Webseite über https: geht nur mit einer Kamera-Firmware, die selbst https anbietet. Das ist auf dem ESP32 aufwendig und hier nicht vorgesehen.

## Stand

WIP. Am Gerät noch nicht geprüft: Verzögerung über WLAN, Bildrate, Akkulaufzeit der Kamera im Auto, Gewicht und Halter. Video speichern in der Android-App braucht die neue APK (`OmegaSicherungPlugin.videoTeil/videoFertig`).
