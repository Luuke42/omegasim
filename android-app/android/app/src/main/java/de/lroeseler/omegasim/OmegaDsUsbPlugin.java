package de.lroeseler.omegasim;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;
import android.view.InputDevice;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * DUALSENSE-TRIGGER UEBER USB AUF ANDROID (v1.5, WIP, Stufe 1: Pruefknopf).
 *
 * BESTELLT (Plan Paket 6): die adaptiven Trigger des DualSense auch in der Android-App, ueber das
 * USB-Kabel. Im Browser macht das WebHID (80b-dualsense.js); die WebView kennt WebHID nicht. Hier
 * schreibt die App den Ausgabebericht 0x02 (USB-Form, 63 Bytes) selbst ueber die USB-Host-API.
 *
 * UNGEPRUEFTES RISIKO: Android haelt die HID-Schnittstelle fuer den Gamepad-Treiber. claimInterface(force)
 * nimmt sie ihm weg; solange liefern die Tasten vermutlich keine Eingaben. Deshalb in Stufe 1 nur ein
 * TEST: Folge abspielen (je Schritt ein Bericht und eine Dauer), danach die Schnittstelle sofort wieder
 * freigeben. Der Nutzer berichtet, ob die Trigger reagiert haben und ob die Tasten danach noch gehen.
 *
 *   lage()              {host, gefunden, erlaubt, name}
 *   test({folge})       folge = [{bericht: Base64, ms}], liefert {ok, weg, protokoll}
 */
@CapacitorPlugin(name = "OmegaDsUsb")
public class OmegaDsUsbPlugin extends Plugin {

    private static final int SONY = 0x054C;
    private static final int[] PRODUKTE = { 0x0CE6, 0x0DF2 };   // DualSense, DualSense Edge
    private static final String AKTION = "de.lroeseler.omegasim.DS_USB_ERLAUBNIS";

    private static int hidNummer(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_HID) return d.getInterface(i).getId();
        return 3;
    }

    private UsbManager usb() { return (UsbManager) getContext().getSystemService(Context.USB_SERVICE); }

    private UsbDevice finden() {
        UsbManager m = usb();
        if (m == null) return null;
        for (UsbDevice d : m.getDeviceList().values()) {
            if (d.getVendorId() != SONY) continue;
            for (int p : PRODUKTE) if (d.getProductId() == p) return d;
        }
        return null;
    }

    @PluginMethod
    public void lage(PluginCall call) {
        JSObject r = new JSObject();
        r.put("host", getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST));
        UsbDevice d = finden();
        r.put("gefunden", d != null);
        r.put("erlaubt", d != null && usb().hasPermission(d));
        r.put("name", d != null ? (d.getProductName() != null ? d.getProductName() : "DualSense") : "");
        r.put("offen", dauer != null);
        call.resolve(r);
    }

    @PluginMethod
    public void test(PluginCall call) {
        final List<byte[]> berichte = new ArrayList<>();
        final List<Integer> dauern = new ArrayList<>();
        try {
            JSONArray folge = call.getArray("folge");
            for (int i = 0; folge != null && i < folge.length(); i++) {
                JSONObject s = folge.getJSONObject(i);
                berichte.add(Base64.decode(s.getString("bericht"), Base64.DEFAULT));
                dauern.add(Math.max(0, Math.min(10000, s.optInt("ms", 0))));
            }
        } catch (Exception e) {
            call.reject("Folge unlesbar: " + e.getMessage());
            return;
        }
        if (berichte.isEmpty()) { call.reject("Folge leer"); return; }
        final UsbDevice d = finden();
        if (d == null) {
            // v1.5: statt nur eines Fehlers die Liste der USB-Geraete, damit sich sehen laesst, was Android meldet.
            StringBuilder p = new StringBuilder("Kein DualSense am USB-Kabel gefunden.\nUSB-Geraete:");
            UsbManager m = usb();
            if (m == null) p.append(" (kein USB-Host)");
            else for (UsbDevice x : m.getDeviceList().values()) p.append("\n  ").append(String.format("%04x:%04x", x.getVendorId(), x.getProductId())).append(" ").append(x.getProductName());
            antwort(call, false, "", p.toString());
            return;
        }
        if (usb().hasPermission(d)) { abspielen(call, d, berichte, dauern); return; }
        // Erlaubnis erfragen: das System zeigt einen Dialog und meldet das Ergebnis per Broadcast.
        final Context ctx = getContext();
        BroadcastReceiver empfaenger = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                try { ctx.unregisterReceiver(this); } catch (Exception e) { /* schon weg */ }
                boolean ja = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (!ja) { antwort(call, false, "", "USB-Zugriff nicht erlaubt (Dialog abgelehnt oder geschlossen)."); return; }
                abspielen(call, d, berichte, dauern);
            }
        };
        ContextCompat.registerReceiver(ctx, empfaenger, new IntentFilter(AKTION), ContextCompat.RECEIVER_NOT_EXPORTED);
        Intent absicht = new Intent(AKTION).setPackage(ctx.getPackageName());
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        usb().requestPermission(d, PendingIntent.getBroadcast(ctx, 0, absicht, flags));
    }

    // ---- STUFE 2 (v1.5): DAUERBETRIEB BEIM FAHREN ----------------------------------------------------------
    // BESTELLT: "Bitte also nun Trigger-Effekte richtig ins virtuelle und echte Fahren einbauen." Eine Verbindung bleibt
    // offen; die Seite schickt bei jeder Aenderung des Effekts einen Bericht (senden), ein eigener Schreib-Thread sendet
    // immer nur den NEUESTEN (kein Rueckstau, keine zusaetzliche Latenz). Android gibt einer App die HID-Schnittstelle nur
    // mit claimInterface(force): haengt der Controller NUR am Kabel, verschwindet er dabei als Gamepad (keine Tasten mehr).
    // Darum prueft oeffnen() nach dem Belegen, ob noch ein Sony-Gamepad da ist (z. B. ueber Bluetooth); wenn nicht, gibt
    // es die Schnittstelle sofort zurueck und meldet grund "tasten". Abziehen des Kabels schliesst von selbst.
    private static final class Dauer {
        UsbDevice d; UsbDeviceConnection c; UsbInterface hid; UsbEndpoint aus; boolean belegt; int hidId;
        final AtomicReference<byte[]> neu = new AtomicReference<>();
        volatile boolean laeuft = true; Thread faden; int fehler = 0; long gesendet = 0;
    }
    private volatile Dauer dauer = null;
    private BroadcastReceiver abzieher = null;

    private static boolean sonyGamepadDa() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice x = InputDevice.getDevice(id);
            if (x == null || x.isVirtual() || x.getVendorId() != SONY) continue;
            if ((x.getSources() & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD) return true;
        }
        return false;
    }
    private static int schreiben(Dauer z, byte[] b) {
        int n = -1;
        if (z.belegt && z.aus != null) n = z.c.bulkTransfer(z.aus, b, b.length, 100);
        if (n < 0) n = z.c.controlTransfer(0x21, 0x09, 0x0200 | (b[0] & 0xff), z.hidId, b, b.length, 100);
        return n;
    }
    private void mitErlaubnis(final UsbDevice d, final Runnable ja, final Runnable nein) {
        if (usb().hasPermission(d)) { ja.run(); return; }
        final Context ctx = getContext();
        BroadcastReceiver empfaenger = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                try { ctx.unregisterReceiver(this); } catch (Exception e) { /* schon weg */ }
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) ja.run(); else nein.run();
            }
        };
        ContextCompat.registerReceiver(ctx, empfaenger, new IntentFilter(AKTION), ContextCompat.RECEIVER_NOT_EXPORTED);
        Intent absicht = new Intent(AKTION).setPackage(ctx.getPackageName());
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        usb().requestPermission(d, PendingIntent.getBroadcast(ctx, 0, absicht, flags));
    }

    @PluginMethod
    public void oeffnen(final PluginCall call) {
        if (dauer != null) { JSObject r = new JSObject(); r.put("ok", true); r.put("weg", dauer.belegt ? "interrupt" : "control"); r.put("protokoll", "schon offen"); call.resolve(r); return; }
        final UsbDevice d = finden();
        if (d == null) { JSObject r = new JSObject(); r.put("ok", false); r.put("grund", "fehlt"); r.put("protokoll", "Kein DualSense am USB-Kabel."); call.resolve(r); return; }
        final byte[] aus = Base64.decode(call.getString("aus", ""), Base64.DEFAULT);
        mitErlaubnis(d, () -> new Thread(() -> oeffnenJetzt(call, d, aus), "omega-ds-usb-auf").start(), () -> {
            JSObject r = new JSObject(); r.put("ok", false); r.put("grund", "erlaubnis"); r.put("protokoll", "USB-Zugriff nicht erlaubt."); call.resolve(r);
        });
    }
    private void oeffnenJetzt(PluginCall call, UsbDevice d, byte[] aus) {
        StringBuilder p = new StringBuilder();
        Dauer z = new Dauer();
        z.d = d;
        String grund = "";
        try {
            for (int i = 0; i < d.getInterfaceCount(); i++) if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_HID) { z.hid = d.getInterface(i); break; }
            if (z.hid == null) throw new Exception("keine HID-Schnittstelle");
            z.hidId = z.hid.getId();
            for (int i = 0; i < z.hid.getEndpointCount(); i++) {
                UsbEndpoint e = z.hid.getEndpoint(i);
                if (e.getDirection() == UsbConstants.USB_DIR_OUT && e.getType() == UsbConstants.USB_ENDPOINT_XFER_INT) z.aus = e;
            }
            z.c = usb().openDevice(d);
            if (z.c == null) throw new Exception("openDevice fehlgeschlagen");
            boolean vorher = sonyGamepadDa();
            z.belegt = z.c.claimInterface(z.hid, true);
            p.append("Gamepad vorher: ").append(vorher).append(", claimInterface: ").append(z.belegt).append("\n");
            if (z.belegt) {
                SystemClock.sleep(700);
                if (!sonyGamepadDa()) {
                    // Kein Bluetooth-Gamepad mehr erkannt. Fuer die Trigger egal: Die Schnittstelle bleibt
                    // belegt und die Trigger laufen ueber den Interrupt-Endpunkt - derselbe Weg, den der Test
                    // (abspielen) erfolgreich nutzt. (Vorher wurde hier freigegeben und auf den Steuerkanal
                    // ausgewichen; das war unzuverlaessig. Die Tasten L2/R2 kommen laut Nutzer trotzdem an.)
                    p.append("kein Gamepad nach dem Belegen: Schnittstelle bleibt belegt, Trigger ueber den Interrupt-Endpunkt\n");
                }
            }
            int n = aus.length > 0 ? schreiben(z, aus) : 0;
            p.append("erster Bericht: ").append(n).append(" Bytes\n");
            if (n < 0) throw new Exception("Senden fehlgeschlagen");
        } catch (Exception e) {
            p.append("Fehler: ").append(e.getMessage()).append("\n");
            if (z.c != null) {
                if (z.belegt) { try { z.c.releaseInterface(z.hid); } catch (Exception e2) { /* weg */ } }
                try { z.c.close(); } catch (Exception e2) { /* weg */ }
            }
            JSObject r = new JSObject(); r.put("ok", false); r.put("grund", grund.isEmpty() ? "fehler" : grund); r.put("protokoll", p.toString()); call.resolve(r);
            return;
        }
        z.faden = new Thread(() -> {
            while (z.laeuft) {
                byte[] b = z.neu.getAndSet(null);
                if (b == null) { synchronized (z) { try { z.wait(200); } catch (InterruptedException e) { return; } } continue; }
                int n = -1;
                try { n = schreiben(z, b); } catch (Exception e) { n = -1; }
                if (n < 0) { if (++z.fehler > 20) { schliessenIntern("Senden scheitert"); return; } } else { z.fehler = 0; z.gesendet++; }
            }
        }, "omega-ds-usb-schreiber");
        z.faden.start();
        dauer = z;
        abzieherAn();
        JSObject r = new JSObject(); r.put("ok", true); r.put("weg", z.belegt ? "interrupt" : "control"); r.put("protokoll", p.toString()); call.resolve(r);
    }
    private void abzieherAn() {
        if (abzieher != null) return;
        abzieher = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                UsbDevice x = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                Dauer z = dauer;
                if (z != null && x != null && x.getDeviceName().equals(z.d.getDeviceName())) schliessenIntern("Kabel abgezogen");
            }
        };
        ContextCompat.registerReceiver(getContext(), abzieher, new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED), ContextCompat.RECEIVER_EXPORTED);
    }
    private synchronized void schliessenIntern(String grund) {
        Dauer z = dauer;
        if (z == null) return;
        dauer = null;
        z.laeuft = false;
        synchronized (z) { z.notifyAll(); }
        try { if (z.belegt) z.c.releaseInterface(z.hid); } catch (Exception e) { /* weg */ }
        try { z.c.close(); } catch (Exception e) { /* weg */ }
        JSObject r = new JSObject(); r.put("grund", grund);
        notifyListeners("dsUsbZu", r);
    }

    @PluginMethod
    public void senden(PluginCall call) {
        Dauer z = dauer;
        if (z == null) { JSObject r = new JSObject(); r.put("ok", false); call.resolve(r); return; }
        z.neu.set(Base64.decode(call.getString("bericht", ""), Base64.DEFAULT));
        synchronized (z) { z.notifyAll(); }
        JSObject r = new JSObject(); r.put("ok", true); r.put("gesendet", z.gesendet); call.resolve(r);
    }

    @PluginMethod
    public void schliessen(PluginCall call) {
        Dauer z = dauer;
        String b64 = call.getString("aus", "");
        if (z != null && b64 != null && !b64.isEmpty()) { try { schreiben(z, Base64.decode(b64, Base64.DEFAULT)); } catch (Exception e) { /* weg */ } }
        schliessenIntern("geschlossen");
        call.resolve();
    }

    private static void antwort(PluginCall call, boolean ok, String weg, String protokoll) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        r.put("weg", weg);
        r.put("protokoll", protokoll);
        call.resolve(r);
    }

    private void abspielen(final PluginCall call, final UsbDevice d, final List<byte[]> berichte, final List<Integer> dauern) {
        new Thread(() -> {
            StringBuilder p = new StringBuilder();
            UsbDeviceConnection c = null;
            UsbInterface hid = null;
            String weg = "";
            boolean ok = false;
            try {
                p.append(d.getProductName()).append(" ").append(String.format("%04x:%04x", d.getVendorId(), d.getProductId()))
                 .append(", ").append(d.getInterfaceCount()).append(" Schnittstellen\n");
                for (int i = 0; i < d.getInterfaceCount(); i++) {
                    UsbInterface f = d.getInterface(i);
                    p.append("  #").append(f.getId()).append(" Klasse ").append(f.getInterfaceClass())
                     .append(", ").append(f.getEndpointCount()).append(" Endpunkte\n");
                    if (hid == null && f.getInterfaceClass() == UsbConstants.USB_CLASS_HID) hid = f;
                }
                if (hid == null) throw new Exception("keine HID-Schnittstelle");
                UsbEndpoint aus = null;
                for (int i = 0; i < hid.getEndpointCount(); i++) {
                    UsbEndpoint e = hid.getEndpoint(i);
                    if (e.getDirection() == UsbConstants.USB_DIR_OUT && e.getType() == UsbConstants.USB_ENDPOINT_XFER_INT) aus = e;
                }
                c = usb().openDevice(d);
                if (c == null) throw new Exception("openDevice fehlgeschlagen");
                boolean belegt = c.claimInterface(hid, true);
                p.append("Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append("), claimInterface: ").append(belegt)
                 .append(", OUT-Endpunkt: ").append(aus != null).append("\n");
                // v1.5: GEMELDET "Damit sie reagieren, musste er erst per Bluetooth und dann Kabel verbunden sein." Vermutlich
                // haelt Android's Gamepad-Treiber die Schnittstelle, wenn der Controller nur am Kabel haengt. Dann trotzdem
                // ueber den Steuerkanal (SET_REPORT, Endpunkt 0), der keine belegte Schnittstelle braucht.
                if (!belegt) { hid = null; p.append("Schnittstelle nicht belegbar: Versuch ueber den Steuerkanal ohne Belegen\n"); }
                final int hidId = hidNummer(d);
                for (int i = 0; i < berichte.size(); i++) {
                    byte[] b = berichte.get(i);
                    int n = -1;
                    if (aus != null && belegt) { n = c.bulkTransfer(aus, b, b.length, 200); weg = "interrupt"; }
                    if (n < 0) {
                        // SET_REPORT (Ausgabe, Bericht 0x02) ueber den Steuerkanal.
                        n = c.controlTransfer(0x21, 0x09, 0x0200 | (b[0] & 0xff), hidId, b, b.length, 200);
                        weg = belegt ? "control" : "control ohne Belegen";
                    }
                    p.append("Schritt ").append(i + 1).append(": ").append(n).append(" Bytes (").append(weg).append(")\n");
                    if (n < 0) throw new Exception("Senden fehlgeschlagen");
                    Thread.sleep(dauern.get(i));
                }
                ok = true;
            } catch (Exception e) {
                p.append("Fehler: ").append(e.getMessage()).append("\n");
            } finally {
                if (c != null) {
                    if (hid != null) { try { c.releaseInterface(hid); } catch (Exception e) { /* weg */ } }
                    try { c.close(); } catch (Exception e) { /* weg */ }
                    p.append("Schnittstelle freigegeben\n");
                }
            }
            JSObject r = new JSObject();
            r.put("ok", ok);
            r.put("weg", weg);
            r.put("protokoll", p.toString());
            call.resolve(r);
        }, "omega-ds-usb").start();
    }
}
