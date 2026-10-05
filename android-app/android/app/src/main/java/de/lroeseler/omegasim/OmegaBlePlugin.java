package de.lroeseler.omegasim;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothStatusCodes;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * SCHNELLER STEUER-SCHREIBWEG, ohne den Umweg ueber das Community-Plugin.
 *
 * GEMELDET (nur in der App): "auf meinem schwaecheren Handy ist die Verzoegerung sehr gross" und
 * "apk, auch die original app von carrera, hat eine kleine merkbare Verzoegerung".
 *
 * Das Community-Plugin loest writeWithoutResponse erst nach onCharacteristicWrite auf; jeder
 * Steuerbefehl haengt dann am Rundlauf JS -> nativ -> GATT -> nativ -> JS. Hier dagegen:
 *   - writeControl() antwortet gar nicht (RETURN_NONE): kein Rueckweg ueber den Hauptthread.
 *   - Der GATT-Write laeuft auf einem eigenen Thread, "neuester gewinnt": je Geraet EIN Platz
 *     (AtomicReference), ein neuerer Befehl ersetzt den wartenden.
 *
 * NEU GEBAUT in v0.9.2 (die erste Fassung aus v0.8.124-126 hatte vier Fehler):
 *   1. Ein abgelehnter Write (GATT belegt, getrennt) stellte sich OHNE PAUSE sofort neu ein -
 *      eine Dauerschleife auf dem schwachen Handy. Jetzt: hoechstens 3 Versuche mit 3 ms Pause,
 *      und sobald ein neuerer Befehl wartet, wird der alte nicht weiter versucht.
 *   2. Der gemerkte GATT-Griff wurde bei JEDEM Fehlschlag verworfen (und per Reflexion neu
 *      gesucht). Jetzt erst nach 3 Fehlschlaegen in Folge - das ist der Fall "neu verbunden".
 *   3. Zwischen dem Pruefen von "gen" und dem Freigeben konnte ein neuer Befehl liegen bleiben
 *      (bis zum naechsten Takt). Jetzt atomar: Platz leeren, Lauf beenden, nochmal nachsehen.
 *   4. Die Web-Seite hielt jeden Befehl fuer geschrieben, auch ohne GATT. Jetzt meldet status()
 *      ehrlich "bereit" oder nicht, und die Seite faellt dann auf das Community-Plugin zurueck.
 * Dazu pause(): waehrend das Community-Plugin selbst einen GATT-Vorgang macht (Abo, Lesen,
 * Schreiben mit Antwort), schreibt OmegaBle nicht - Android erlaubt nur einen Vorgang zugleich.
 *
 * DIE VERBINDUNG LEIHEN wir uns vom Community-Plugin (deviceMap -> bluetoothGatt), per Reflexion
 * wie MainActivity.bluetoothTrennen().
 */
@CapacitorPlugin(name = "OmegaBle")
public class OmegaBlePlugin extends Plugin {

    private static final int VERSUCHE = 3;
    private static final long VERSUCH_PAUSE_MS = 3;
    private static final long PAUSE_HOECHSTENS_MS = 1500;   // falls die Seite das Ende vergisst

    /** Alles je Geraet. */
    private static final class Platz {
        final AtomicReference<byte[]> neu = new AtomicReference<>();
        final AtomicBoolean laeuft = new AtomicBoolean(false);
        volatile String dienst, merkmal;
        volatile BluetoothGatt gatt;
        volatile BluetoothGattCharacteristic ziel;
        int fehlInFolge;                                    // nur auf dem Schreib-Thread
        final AtomicLong geschrieben = new AtomicLong(), wiederholt = new AtomicLong(),
                         verworfen = new AtomicLong(), ersetzt = new AtomicLong();
    }

    private final Map<String, Platz> plaetze = new ConcurrentHashMap<>();
    private volatile long pauseBis = 0;
    private HandlerThread writeThread;
    private volatile Handler writeHandler;

    @Override
    public void load() {
        writeThread = new HandlerThread("OmegaBle-Write");
        writeThread.start();
        writeHandler = new Handler(writeThread.getLooper());
    }

    private Platz platz(String id) {
        Platz p = plaetze.get(id);
        if (p == null) {
            p = new Platz();
            Platz alt = plaetze.putIfAbsent(id, p);
            if (alt != null) p = alt;
        }
        return p;
    }

    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public void writeControl(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String service = call.getString("service");
        String characteristic = call.getString("characteristic");
        String value = call.getString("value");
        Handler h = writeHandler;
        if (deviceId == null || service == null || characteristic == null || value == null || h == null) return;
        Platz p = platz(deviceId);
        if (!service.equals(p.dienst) || !characteristic.equals(p.merkmal)) {
            p.dienst = service;
            p.merkmal = characteristic;
            p.ziel = null;
        }
        if (p.neu.getAndSet(hexZuBytes(value)) != null) p.ersetzt.incrementAndGet();
        if (p.laeuft.compareAndSet(false, true)) h.post(() -> abarbeiten(deviceId, p));
    }

    /** Ehrliche Auskunft fuer die Web-Seite: findet OmegaBle die Verbindung? Dazu die Zaehler. */
    @PluginMethod
    public void status(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String service = call.getString("service");
        String characteristic = call.getString("characteristic");
        JSObject r = new JSObject();
        boolean bereit = false;
        if (deviceId != null && service != null && characteristic != null) {
            Platz p = platz(deviceId);
            p.dienst = service;
            p.merkmal = characteristic;
            bereit = zielHolen(deviceId, p, false);
            r.put("geschrieben", p.geschrieben.get());
            r.put("wiederholt", p.wiederholt.get());
            r.put("verworfen", p.verworfen.get());
            r.put("ersetzt", p.ersetzt.get());
        }
        r.put("bereit", bereit);
        r.put("version", 2);
        call.resolve(r);
    }

    /** Waehrend das Community-Plugin einen GATT-Vorgang macht, nicht schreiben. */
    @PluginMethod
    public void pause(PluginCall call) {
        Boolean an = call.getBoolean("an", false);
        pauseBis = an != null && an ? SystemClock.uptimeMillis() + PAUSE_HOECHSTENS_MS : 0;
        call.resolve();
    }

    /** Auf dem Schreib-Thread: den jeweils neuesten Befehl schreiben, bis keiner mehr wartet. */
    private void abarbeiten(String deviceId, Platz p) {
        Handler h = writeHandler;
        if (h == null) { p.laeuft.set(false); return; }
        long warte = pauseBis - SystemClock.uptimeMillis();
        if (warte > 0) {                                    // pausiert: spaeter weiter, Lauf bleibt
            h.postDelayed(() -> abarbeiten(deviceId, p), Math.min(warte, 5));
            return;
        }
        byte[] wert = p.neu.getAndSet(null);
        if (wert != null) schreibenMitVersuchen(deviceId, p, wert);
        if (p.neu.get() != null) { h.post(() -> abarbeiten(deviceId, p)); return; }
        p.laeuft.set(false);
        // Kam genau jetzt ein Befehl, hat writeControl den Lauf nicht neu starten koennen.
        if (p.neu.get() != null && p.laeuft.compareAndSet(false, true)) h.post(() -> abarbeiten(deviceId, p));
    }

    private void schreibenMitVersuchen(String deviceId, Platz p, byte[] wert) {
        for (int versuch = 0; versuch < VERSUCHE; versuch++) {
            if (versuch > 0) {
                if (p.neu.get() != null) { p.verworfen.incrementAndGet(); return; }   // Neueres wartet
                p.wiederholt.incrementAndGet();
                SystemClock.sleep(VERSUCH_PAUSE_MS);
            }
            if (!zielHolen(deviceId, p, false)) continue;
            int erg = schreibeGatt(p.gatt, p.ziel, wert);
            if (erg == 0) { p.fehlInFolge = 0; p.geschrieben.incrementAndGet(); return; }
            if (erg < 0) break;                             // SecurityException: zwecklos
            if (++p.fehlInFolge >= VERSUCHE) {              // vermutlich neu verbunden
                p.gatt = null;
                p.ziel = null;
                p.fehlInFolge = 0;
            }
        }
        p.verworfen.incrementAndGet();
    }

    /** Gemerktes Ziel pruefen oder per Reflexion neu suchen. */
    private boolean zielHolen(String deviceId, Platz p, boolean neu) {
        if (!neu && p.gatt != null && p.ziel != null) return true;
        try {
            BluetoothGatt gatt = findeGatt(deviceId);
            if (gatt == null || p.dienst == null || p.merkmal == null) return false;
            BluetoothGattService s = gatt.getService(UUID.fromString(p.dienst));
            if (s == null) return false;
            BluetoothGattCharacteristic c = s.getCharacteristic(UUID.fromString(p.merkmal));
            if (c == null) return false;
            p.gatt = gatt;
            p.ziel = c;
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    /** 0 = angenommen, 1 = abgelehnt (belegt, getrennt), -1 = keine Berechtigung. */
    private static int schreibeGatt(BluetoothGatt gatt, BluetoothGattCharacteristic c, byte[] bytes) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int status = gatt.writeCharacteristic(c, bytes, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                return status == BluetoothStatusCodes.SUCCESS ? 0 : 1;
            }
            // Vor Android 13 haengt der Wert am geteilten Merkmal-Objekt; der Schreib-Thread ist
            // der einzige, der es fuer Steuerbefehle anfasst.
            synchronized (c) {
                c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                c.setValue(bytes);
                return gatt.writeCharacteristic(c) ? 0 : 1;
            }
        } catch (SecurityException e) {
            return -1;
        } catch (Throwable e) {
            return 1;
        }
    }

    /** Die GATT-Verbindung aus dem Community-Plugin holen (deviceMap -> bluetoothGatt). */
    private BluetoothGatt findeGatt(String deviceId) {
        try {
            PluginHandle h = getBridge().getPlugin("BluetoothLe");
            if (h == null) return null;
            Object plugin = h.getInstance();
            if (plugin == null) return null;
            Field karte = plugin.getClass().getDeclaredField("deviceMap");
            karte.setAccessible(true);
            Object m = karte.get(plugin);
            if (!(m instanceof Map)) return null;
            Object geraet = ((Map<?, ?>) m).get(deviceId);
            if (geraet == null) return null;
            Field f = geraet.getClass().getDeclaredField("bluetoothGatt");
            f.setAccessible(true);
            Object gatt = f.get(geraet);
            return gatt instanceof BluetoothGatt ? (BluetoothGatt) gatt : null;
        } catch (Throwable e) {
            return null;
        }
    }

    private static byte[] hexZuBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(hex.charAt(i * 2), 16);
            int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        Handler h = writeHandler;
        writeHandler = null;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (writeThread != null) {
            writeThread.quitSafely();
            writeThread = null;
        }
    }
}
