package de.lroeseler.omegasim;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;

/**
 * DAS GAMEPAD DIREKT (v0.10.4).
 *
 * GEMELDET: "Latenz in der APK ist langsamer als im Browser." Im Browser liest Chrome das
 * Gamepad in einem eigenen Prozess; in der App laufen die Ereignisse ueber den Android-
 * Hauptthread, den sich die WebView mit jeder Bluetooth-Meldung aller Autos teilt
 * (Capacitor reicht jede Meldung als JSON ueber genau diesen Thread). Bei vier, fuenf Autos
 * sind das ein paar hundert Nachrichten je Sekunde vor jedem Stickausschlag in der Schlange.
 *
 * Hier landet jedes Achsereignis direkt aus MainActivity.dispatchGenericMotionEvent in
 * fluechtigen Feldern, und die Seite liest sie im 45-ms-Herzschlag synchron ueber
 * window.OmegaPad.lesen() (JavaBridge-Thread, kein Hauptthread). Die Ereignisse laufen
 * trotzdem weiter an die WebView - Menues und Knoepfe bleiben beim Web-Gamepad.
 *
 * Nur die sechs analogen Werte (zwei Sticks, zwei Trigger). Mehrere Controller (Spieler 2/3)
 * lassen sich nicht sicher einer Web-Gamepad-Nummer zuordnen; dann meldet lesen() die Zahl
 * der Geraete, und die Seite bleibt beim Web-Gamepad.
 */
public final class OmegaPadNativ {
    private OmegaPadNativ() {}

    static volatile float lx, ly, rx, ry, lt, rt;
    static volatile long ereignisZeit = 0;      // uptimeMillis des letzten Ereignisses
    static volatile long ereignisse = 0;
    static volatile int geraet = -1, zweitGeraet = -1;
    static volatile long zweitZeit = 0;
    // Wie alt war ein Ereignis, als es hier ankam (Android-Eingabeweg)? Mittel ueber 64.
    static volatile float zustellMittel = 0;

    static void aufnehmen(MotionEvent ev) {
        if (ev == null || ev.getAction() != MotionEvent.ACTION_MOVE) return;
        int quelle = ev.getSource();
        if ((quelle & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK
            && (quelle & InputDevice.SOURCE_GAMEPAD) != InputDevice.SOURCE_GAMEPAD) return;
        int id = ev.getDeviceId();
        long jetzt = SystemClock.uptimeMillis();
        if (geraet != -1 && id != geraet) {
            // Ein zweiter Controller: merken, damit die Seite die Direktwerte NICHT nimmt.
            zweitGeraet = id;
            zweitZeit = jetzt;
            return;
        }
        geraet = id;
        lx = ev.getAxisValue(MotionEvent.AXIS_X);
        ly = ev.getAxisValue(MotionEvent.AXIS_Y);
        rx = ev.getAxisValue(MotionEvent.AXIS_Z);
        ry = ev.getAxisValue(MotionEvent.AXIS_RZ);
        lt = Math.max(ev.getAxisValue(MotionEvent.AXIS_LTRIGGER), ev.getAxisValue(MotionEvent.AXIS_BRAKE));
        rt = Math.max(ev.getAxisValue(MotionEvent.AXIS_RTRIGGER), ev.getAxisValue(MotionEvent.AXIS_GAS));
        float zustellung = jetzt - ev.getEventTime();
        zustellMittel = zustellMittel == 0 ? zustellung : zustellMittel + (zustellung - zustellMittel) / 64f;
        ereignisZeit = jetzt;
        ereignisse++;
    }

    /** Fuer die Seite: synchron, ohne Hauptthread. */
    public static final class Js {
        @JavascriptInterface
        public String lesen() {
            long jetzt = SystemClock.uptimeMillis();
            boolean zwei = zweitGeraet != -1 && jetzt - zweitZeit < 10000;
            long alter = ereignisZeit == 0 ? -1 : jetzt - ereignisZeit;
            return lx + "," + ly + "," + rx + "," + ry + "," + lt + "," + rt + ","
                + alter + "," + (zwei ? 2 : (geraet == -1 ? 0 : 1)) + "," + ereignisse + ","
                + Math.round(zustellMittel);
        }
    }
}
