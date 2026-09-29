package de.lroeseler.omegasim;

import android.content.Context;
import android.content.Intent;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;

/**
 * DIESES TELEFON ALS MEHRSPIELER-HOST, ohne PC.
 *
 * Spricht dieselbe API wie tools/omegasim_host.py (siehe HostServer), damit der Mehrspieler-
 * Client in index.html nicht wissen muss, wer der Host ist. Dazu:
 *
 *   - NSD (mDNS, Dienst _omegasim._tcp): Gaeste finden den Host ohne Adresse abzutippen.
 *   - Ein Vordergrunddienst, damit Android den Server bei dunklem Bildschirm nicht beendet.
 *   - Der Host liefert auch die App selbst aus. Ein Tablet im WLAN oeffnet http://IP:8080/?info
 *     im Browser und ist Info-Screen, ohne irgendetwas zu installieren.
 */
@CapacitorPlugin(name = "OmegaHost")
public class OmegaHostPlugin extends Plugin {

    static final String DIENST = "_omegasim._tcp.";
    private static HostServer server;
    private NsdManager.RegistrationListener anmeldung;
    private WifiManager.MulticastLock multicast;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    // Vollbild erneut anlegen (Status- und Navigationsleiste weg), von der Web-Seite aus
    // gerufen. Liegt in diesem Plugin, weil es schon angemeldet ist - ein eigenes nur dafuer
    // waere eine zweite Stelle, an der die App registriert werden muss.
    @PluginMethod
    public void vollbild(PluginCall call) {
        if (getActivity() != null) getActivity().runOnUiThread(() -> MainActivity.vollbildFuer(getActivity()));
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 8080);
        Integer runden = call.getInt("runden");
        Integer minuten = call.getInt("minuten");
        String name = call.getString("name", "OmegaSim");
        try {
            if (server == null || !server.isAlive()) {
                server = new HostServer(getContext(), port);
                server.start(5000, false);
            }
            server.rennlaenge(runden, minuten);
        } catch (Exception e) {
            server = null;
            call.reject("Host startet nicht (Port " + port + " belegt?): " + e.getMessage());
            return;
        }
        try {
            Intent i = new Intent(getContext(), OmegaHostService.class);
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i);
            else getContext().startService(i);
        } catch (Exception e) {
            // Ohne Dienst laeuft der Server trotzdem, solange die App offen ist.
        }
        anmelden(name, port);
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (server != null) {
            server.stop();
            server = null;
        }
        abmelden();
        try {
            getContext().stopService(new Intent(getContext(), OmegaHostService.class));
        } catch (Exception ignoriert) {
            // war nicht gestartet
        }
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject r = new JSObject();
        boolean an = server != null && server.isAlive();
        r.put("laeuft", an);
        r.put("port", an ? server.getListeningPort() : 0);
        JSArray a = new JSArray();
        for (String ip : adressen()) a.put(ip);
        r.put("adressen", a);
        return r;
    }

    /** Sucht Hosts im WLAN. Liefert nach `ms` Millisekunden, was gefunden und aufgeloest ist. */
    @PluginMethod
    public void suchen(PluginCall call) {
        final int ms = call.getInt("ms", 3500);
        final NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        final JSArray gefunden = new JSArray();
        final List<String> schon = Collections.synchronizedList(new ArrayList<>());
        final LinkedList<NsdServiceInfo> warteschlange = new LinkedList<>();
        final boolean[] loest = {false};
        sperreMulticast(true);

        final Runnable[] naechste = new Runnable[1];
        naechste[0] = () -> {
            synchronized (warteschlange) {
                if (loest[0] || warteschlange.isEmpty()) return;
                loest[0] = true;
                NsdServiceInfo info = warteschlange.removeFirst();
                //noinspection deprecation
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo s, int fehler) {
                        synchronized (warteschlange) { loest[0] = false; }
                        haupt.post(naechste[0]);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo s) {
                        InetAddress h = s.getHost();
                        if (h instanceof Inet4Address) {
                            String adr = h.getHostAddress();
                            String schluessel = adr + ":" + s.getPort();
                            if (!schon.contains(schluessel)) {
                                schon.add(schluessel);
                                JSObject o = new JSObject();
                                o.put("name", s.getServiceName());
                                o.put("adresse", adr);
                                o.put("port", s.getPort());
                                synchronized (gefunden) { gefunden.put(o); }
                            }
                        }
                        synchronized (warteschlange) { loest[0] = false; }
                        haupt.post(naechste[0]);
                    }
                });
            }
        };

        final NsdManager.DiscoveryListener suche = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int f) { }
            @Override public void onStopDiscoveryFailed(String t, int f) { }
            @Override public void onDiscoveryStarted(String t) { }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceLost(NsdServiceInfo s) { }

            @Override
            public void onServiceFound(NsdServiceInfo s) {
                synchronized (warteschlange) { warteschlange.add(s); }
                haupt.post(naechste[0]);
            }
        };
        try {
            nsd.discoverServices(DIENST, NsdManager.PROTOCOL_DNS_SD, suche);
        } catch (Exception e) {
            sperreMulticast(false);
            call.reject("Suche nicht moeglich: " + e.getMessage());
            return;
        }
        haupt.postDelayed(() -> {
            try { nsd.stopServiceDiscovery(suche); } catch (Exception ignoriert) { /* schon beendet */ }
            sperreMulticast(false);
            JSObject r = new JSObject();
            synchronized (gefunden) { r.put("hosts", gefunden); }
            call.resolve(r);
        }, ms);
    }

    private void anmelden(String name, int port) {
        abmelden();
        try {
            NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
            NsdServiceInfo info = new NsdServiceInfo();
            info.setServiceName(name);
            info.setServiceType(DIENST);
            info.setPort(port);
            anmeldung = new NsdManager.RegistrationListener() {
                @Override public void onRegistrationFailed(NsdServiceInfo s, int f) { }
                @Override public void onUnregistrationFailed(NsdServiceInfo s, int f) { }
                @Override public void onServiceRegistered(NsdServiceInfo s) { }
                @Override public void onServiceUnregistered(NsdServiceInfo s) { }
            };
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, anmeldung);
        } catch (Exception e) {
            anmeldung = null;
        }
    }

    private void abmelden() {
        if (anmeldung == null) return;
        try {
            ((NsdManager) getContext().getSystemService(Context.NSD_SERVICE)).unregisterService(anmeldung);
        } catch (Exception ignoriert) {
            // war nicht angemeldet
        }
        anmeldung = null;
    }

    private void sperreMulticast(boolean an) {
        try {
            if (an) {
                if (multicast == null) {
                    WifiManager w = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    multicast = w.createMulticastLock("omegasim-nsd");
                    multicast.setReferenceCounted(false);
                }
                multicast.acquire();
            } else if (multicast != null && multicast.isHeld()) {
                multicast.release();
            }
        } catch (Exception ignoriert) {
            // ohne Sperre findet die Suche auf manchen Geraeten weniger
        }
    }

    /** Die IPv4-Adressen, unter denen die anderen Geraete dieses Telefon erreichen. */
    static List<String> adressen() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        // WLAN zuerst: das ist fast immer die gemeinte.
                        if (ni.getName().startsWith("wlan")) out.add(0, a.getHostAddress());
                        else out.add(a.getHostAddress());
                    }
                }
            }
        } catch (Exception ignoriert) {
            // keine Schnittstellen lesbar
        }
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        abmelden();
        sperreMulticast(false);
    }
}
