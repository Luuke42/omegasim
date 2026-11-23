package de.lroeseler.omegasim;

import android.os.Build;
import android.os.CombinedVibration;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.InputDevice;
import java.util.ArrayList;
import java.util.List;
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

    // ---- RUMBLE UEBER ANDROID (v1.5) ----
    // GEMELDET: "Weder ueber Bluetooth noch ueber Kabel reagiert das Rumble (beim Fahren ging es aber immer mal wieder,
    // ich glaube immer, wenn der Controller vor Start der App verbunden ist)." Die Seite rumpelte ueber die Gamepad-API
    // der WebView, und die kennt den Motor eines Controllers offenbar nur, wenn er schon beim Start da war. Hier geht
    // es direkt an den Vibrator des Eingabegeraets, bei jedem Aufruf neu gesucht (2 s zwischengespeichert): egal ob
    // Bluetooth oder Kabel, egal wann verbunden. Ab Android 12 beide Motoren einzeln (stark = erster, schwach = zweiter).
    private static List<InputDevice> ruettlerCache = null;
    private static long ruettlerZeit = 0;

    static synchronized List<InputDevice> ruettler() {
        long jetzt = SystemClock.uptimeMillis();
        if (ruettlerCache != null && jetzt - ruettlerZeit < 2000) return ruettlerCache;
        List<InputDevice> out = new ArrayList<>();
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null || d.isVirtual()) continue;
            int q = d.getSources();
            if ((q & InputDevice.SOURCE_GAMEPAD) != InputDevice.SOURCE_GAMEPAD
                && (q & InputDevice.SOURCE_JOYSTICK) != InputDevice.SOURCE_JOYSTICK) continue;
            try { if (hatMotor(d)) out.add(d); } catch (Throwable e) { /* Geraet weg */ }
        }
        ruettlerCache = out;
        ruettlerZeit = jetzt;
        return out;
    }
    private static boolean hatMotor(InputDevice d) {
        if (Build.VERSION.SDK_INT >= 31) return motorenNeu(d) > 0;
        Vibrator v = d.getVibrator();
        return v != null && v.hasVibrator();
    }
    private static int motorenNeu(InputDevice d) {
        VibratorManager vm = d.getVibratorManager();
        return vm == null ? 0 : vm.getVibratorIds().length;
    }
    private static void ruettelnNeu(InputDevice d, int a1, int a2, int ms) {
        VibratorManager vm = d.getVibratorManager();
        int[] ids = vm.getVibratorIds();
        if (ids.length == 0) return;
        if (ms <= 0 || (a1 == 0 && a2 == 0)) { vm.cancel(); return; }
        CombinedVibration.ParallelCombination p = CombinedVibration.startParallel();
        boolean eins = false;
        for (int i = 0; i < ids.length; i++) {
            int a = ids.length == 1 ? Math.max(a1, a2) : (i == 0 ? a1 : (i == 1 ? a2 : Math.max(a1, a2)));
            if (a > 0) { p.addVibrator(ids[i], VibrationEffect.createOneShot(ms, a)); eins = true; }
        }
        if (eins) vm.vibrate(p.combine());
    }
    static boolean ruetteln(double stark, double schwach, int ms) {
        int a1 = (int) Math.max(0, Math.min(255, Math.round(stark * 255)));
        int a2 = (int) Math.max(0, Math.min(255, Math.round(schwach * 255)));
        int dauer = Math.max(0, Math.min(5000, ms));
        boolean ok = false;
        for (InputDevice d : ruettler()) {
            try {
                if (Build.VERSION.SDK_INT >= 31) ruettelnNeu(d, a1, a2, dauer);
                else {
                    Vibrator v = d.getVibrator();
                    int a = Math.max(a1, a2);
                    if (dauer <= 0 || a == 0) v.cancel();
                    else if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(dauer, a));
                    else v.vibrate(dauer);
                }
                ok = true;
            } catch (Throwable e) { /* naechstes Geraet */ }
        }
        return ok;
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
        /** v1.5: Zahl der Gamepads mit Motor (0 = Seite bleibt bei der Gamepad-API). */
        @JavascriptInterface
        public int ruettlerDa() { try { return ruettler().size(); } catch (Throwable e) { return 0; } }
        /** v1.5: stark/schwach 0..1, Dauer in ms; true, wenn mindestens ein Geraet geruettelt hat. */
        @JavascriptInterface
        public boolean ruetteln(double stark, double schwach, int ms) { try { return OmegaPadNativ.ruetteln(stark, schwach, ms); } catch (Throwable e) { return false; } }
    }
}
