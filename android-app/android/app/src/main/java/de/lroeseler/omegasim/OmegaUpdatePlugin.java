package de.lroeseler.omegasim;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.WebView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SELBSTAKTUALISIERUNG DER WEB-APP, ohne die APK neu zu installieren.
 *
 * BESTELLT: "Ich will, dass ich die App einfach updaten kann ohne die APK neu installieren zu
 * muessen." Die APK bringt eine Fassung von index.html mit (assets/public). Neuere Fassungen
 * kommen von GitHub Pages: app-update.json nennt Version, Dateien und SHA-256. Geladen wird nur,
 * was sich geaendert hat; alles andere wird aus der laufenden Fassung kopiert. Danach zeigt die
 * WebView auf den neuen Ordner - ueber genau den Weg, den Capacitor dafuer hat
 * (CapWebViewSettings/serverBasePath, beim Start von Bridge gelesen).
 *
 * DIE HERKUNFT BLEIBT https://localhost. Damit bleiben localStorage, gemerkte Autos, Rekorde
 * und alle Einstellungen ueber jede Aktualisierung erhalten.
 *
 * DER RUECKFALL ist der wichtigste Teil. Die neue Fassung muss sich binnen WACHHUND_MS mit
 * bestaetigen() melden. Tut sie das nicht (Syntaxfehler, weisser Schirm), schaltet der Wachhund
 * zurueck; und wurde die App vorher beendet, macht es beimStart() beim naechsten Oeffnen.
 * Ohne das waere ein einziger kaputter Push eine App, die man neu installieren muss - genau das,
 * was vermieden werden sollte.
 *
 * Eine neue APK setzt das alles von selbst zurueck: Bridge.isNewBinary() leert den Pfad, und
 * die mitgelieferte Fassung gilt wieder, bis die naechste Aktualisierung kommt.
 */
@CapacitorPlugin(name = "OmegaUpdate")
public class OmegaUpdatePlugin extends Plugin {

    /** Muss zu APK_STUFE in tools/app_update.py passen. Hochzaehlen, wenn index.html neue
     *  native Faehigkeiten braucht - dann meldet pruefen() "neue APK noetig". */
    static final int APK_STUFE = 2;

    static final String QUELLE = "https://lukasroeseler.github.io/btsr/";
    static final String PREFS = "OmegaUpdate";
    static final String K_OFFEN = "offen";            // umgeschaltet, noch nicht bestaetigt
    static final String K_OFFEN_VERSION = "offenVersion";
    static final String K_VORHER = "vorher";          // Pfad davor, "" = mitgeliefert
    static final String K_ZURUECK = "zurueckgerollt"; // Version, die verworfen wurde
    static final long WACHHUND_MS = 25000;

    private volatile boolean laeuft = false;
    private volatile boolean abbruch = false;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    // ---- Beim Start, VOR Bridge ----------------------------------------------------------

    static void beimStart(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String offen = p.getString(K_OFFEN, "");
        if (!offen.isEmpty()) {
            // Der letzte Lauf hat umgeschaltet und nie bestaetigt: verwerfen.
            setzePfad(ctx, p.getString(K_VORHER, ""));
            p.edit().putString(K_OFFEN, "").putString(K_ZURUECK, p.getString(K_OFFEN_VERSION, "?")).apply();
        }
    }

    static void setzePfad(Context ctx, String pfad) {
        ctx.getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(WebView.CAP_SERVER_PATH, pfad == null ? "" : pfad).apply();
    }

    /** Der Ordner, aus dem die WebView gerade liest; "" heisst: mitgeliefert (assets/public). */
    static String aktiverPfad(Context ctx) {
        String p = ctx.getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .getString(WebView.CAP_SERVER_PATH, "");
        if (p == null || p.isEmpty() || !new File(p).isDirectory()) return "";
        return p;
    }

    /** Eine Datei der laufenden Fassung lesen, egal ob mitgeliefert oder geladen. */
    static InputStream oeffneAktiv(Context ctx, String rel) throws IOException {
        String pfad = aktiverPfad(ctx);
        if (pfad.isEmpty()) return ctx.getAssets().open("public/" + rel);
        return new FileInputStream(new File(pfad, rel));
    }

    static JSONObject aktivesVerzeichnis(Context ctx) {
        try (InputStream in = oeffneAktiv(ctx, "app-update.json")) {
            return new JSONObject(new String(lies(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    // ---- Methoden fuer die Web-App -----------------------------------------------------

    @PluginMethod
    public void stand(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSObject r = new JSObject();
        r.put("apkStufe", APK_STUFE);
        r.put("quelle", QUELLE);
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            r.put("apkVersion", pi.versionName);
            r.put("apkCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) {
            r.put("apkVersion", "?");
        }
        String pfad = aktiverPfad(ctx);
        r.put("eingebaut", pfad.isEmpty());
        JSONObject v = aktivesVerzeichnis(ctx);
        r.put("aktiv", v == null ? "" : v.optString("version", ""));
        r.put("offen", p.getString(K_OFFEN, ""));
        r.put("zurueckgerollt", p.getString(K_ZURUECK, ""));
        call.resolve(r);
    }

    /** Fragt die Quelle ab und sagt, ob und wie viel zu laden waere. Laedt nichts. */
    @PluginMethod
    public void pruefen(PluginCall call) {
        final String quelle = quelle(call);
        new Thread(() -> {
            try {
                JSONObject neu = holeVerzeichnis(quelle);
                Map<String, String> alt = hashes(aktivesVerzeichnis(getContext()));
                JSONArray d = neu.getJSONArray("dateien");
                long bytes = 0;
                int n = 0;
                for (int i = 0; i < d.length(); i++) {
                    JSONObject e = d.getJSONObject(i);
                    if (!e.getString("h").equals(alt.get(e.getString("p")))) {
                        bytes += e.optLong("g", 0);
                        n++;
                    }
                }
                JSObject r = new JSObject();
                r.put("version", neu.optString("version", ""));
                r.put("apk", neu.optInt("apk", 1));
                r.put("apkNoetig", neu.optInt("apk", 1) > APK_STUFE);
                r.put("dateien", n);
                r.put("bytes", bytes);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Keine Verbindung zur Update-Quelle: " + e.getMessage());
            }
        }, "OmegaUpdate-pruefen").start();
    }

    /** Laedt die neue Fassung, prueft jede Datei und schaltet um. Die Seite laedt danach neu. */
    @PluginMethod
    public void laden(PluginCall call) {
        if (laeuft) {
            call.reject("Es laeuft schon eine Aktualisierung.");
            return;
        }
        laeuft = true;
        abbruch = false;
        final String quelle = quelle(call);
        new Thread(() -> {
            File ziel = null;
            try {
                Context ctx = getContext();
                JSONObject neu = holeVerzeichnis(quelle);
                if (neu.optInt("apk", 1) > APK_STUFE) {
                    throw new IOException("Diese Fassung braucht eine neuere APK.");
                }
                String version = neu.getString("version");
                Map<String, String> alt = hashes(aktivesVerzeichnis(ctx));
                File wurzel = new File(ctx.getFilesDir(), "www");
                ziel = new File(wurzel, version.replaceAll("[^0-9A-Za-z._-]", "_") + "-" + System.currentTimeMillis());
                if (!ziel.mkdirs()) throw new IOException("Ordner nicht anlegbar: " + ziel);
                JSONArray d = neu.getJSONArray("dateien");
                long gesamt = 0, fertig = 0;
                for (int i = 0; i < d.length(); i++) gesamt += d.getJSONObject(i).optLong("g", 0);
                for (int i = 0; i < d.length(); i++) {
                    if (abbruch) throw new IOException("Vom Nutzer abgebrochen.");
                    JSONObject e = d.getJSONObject(i);
                    String rel = e.getString("p");
                    if (rel.contains("..") || rel.startsWith("/")) throw new IOException("Unzulaessiger Pfad: " + rel);
                    String soll = e.getString("h");
                    File f = new File(ziel, rel);
                    File eltern = f.getParentFile();
                    if (eltern != null && !eltern.isDirectory() && !eltern.mkdirs()) throw new IOException("Ordner: " + eltern);
                    boolean ok = false;
                    if (soll.equals(alt.get(rel))) {
                        // Unveraendert: aus der laufenden Fassung kopieren statt laden.
                        try (InputStream in = oeffneAktiv(ctx, rel)) {
                            ok = soll.equals(schreibe(in, f));
                        } catch (IOException ignoriert) {
                            ok = false;
                        }
                    }
                    if (!ok) {
                        String url = quelle + encodePfad(rel) + "?v=" + version;
                        String ist;
                        try (InputStream in = oeffneUrl(url)) {
                            ist = schreibe(in, f);
                        }
                        if (!soll.equals(ist)) throw new IOException("Pruefsumme falsch: " + rel);
                    }
                    fertig += e.optLong("g", 0);
                    JSObject fo = new JSObject();
                    fo.put("fertig", fertig);
                    fo.put("gesamt", gesamt);
                    fo.put("datei", rel);
                    notifyListeners("fortschritt", fo);
                }
                try (OutputStream out = new FileOutputStream(new File(ziel, "app-update.json"))) {
                    out.write(neu.toString().getBytes(StandardCharsets.UTF_8));
                }
                final String neuPfad = ziel.getAbsolutePath();
                SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                p.edit()
                    .putString(K_VORHER, aktiverPfad(ctx))
                    .putString(K_OFFEN, neuPfad)
                    .putString(K_OFFEN_VERSION, version)
                    .putString(K_ZURUECK, "")
                    .apply();
                setzePfad(ctx, neuPfad);
                JSObject r = new JSObject();
                r.put("version", version);
                call.resolve(r);
                // Kurz warten, damit die Antwort noch ankommt, dann umschalten.
                haupt.postDelayed(() -> getBridge().setServerBasePath(neuPfad), 400);
                haupt.postDelayed(() -> wachhund(neuPfad), WACHHUND_MS);
            } catch (Exception e) {
                if (ziel != null) loesche(ziel);
                call.reject("Aktualisierung abgebrochen: " + e.getMessage());
            } finally {
                laeuft = false;
            }
        }, "OmegaUpdate-laden").start();
    }

    private void wachhund(String pfad) {
        Context ctx = getContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!pfad.equals(p.getString(K_OFFEN, ""))) return;  // bestaetigt
        String vorher = p.getString(K_VORHER, "");
        p.edit().putString(K_OFFEN, "").putString(K_ZURUECK, p.getString(K_OFFEN_VERSION, "?")).apply();
        setzePfad(ctx, vorher);
        if (vorher.isEmpty()) getBridge().setServerAssetPath("public");
        else getBridge().setServerBasePath(vorher);
    }

    /** Die neue Fassung ist hochgekommen. Aufgeraeumt wird alles ausser ihr und der davor. */
    @PluginMethod
    public void bestaetigen(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString(K_OFFEN, "").apply();
        String aktiv = aktiverPfad(ctx), vorher = p.getString(K_VORHER, "");
        File[] alle = new File(ctx.getFilesDir(), "www").listFiles();
        if (alle != null) {
            for (File f : alle) {
                String a = f.getAbsolutePath();
                if (!a.equals(aktiv) && !a.equals(vorher)) loesche(f);
            }
        }
        call.resolve();
    }

    /** Zurueck zur Fassung, die in der APK steckt. */
    @PluginMethod
    public void eingebaut(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(K_OFFEN, "").putString(K_VORHER, "").apply();
        setzePfad(ctx, "");
        call.resolve();
        haupt.postDelayed(() -> getBridge().setServerAssetPath("public"), 300);
    }

    /** Bricht einen laufenden Download ab; der Thread sieht das Flag und raeumt auf. */
    @PluginMethod
    public void abbrechen(PluginCall call) {
        abbruch = true;
        call.resolve();
    }

    @PluginMethod
    public void vergessen(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_ZURUECK, "").apply();
        call.resolve();
    }

    // ---- Hilfen ------------------------------------------------------------------------

    private static String quelle(PluginCall call) {
        String q = call.getString("quelle", QUELLE);
        if (q == null || !q.startsWith("https://")) q = QUELLE;
        return q.endsWith("/") ? q : q + "/";
    }

    private static JSONObject holeVerzeichnis(String quelle) throws Exception {
        try (InputStream in = oeffneUrl(quelle + "app-update.json?t=" + System.currentTimeMillis())) {
            return new JSONObject(new String(lies(in), StandardCharsets.UTF_8));
        }
    }

    private static Map<String, String> hashes(JSONObject v) {
        Map<String, String> m = new HashMap<>();
        if (v == null) return m;
        JSONArray d = v.optJSONArray("dateien");
        if (d == null) return m;
        for (int i = 0; i < d.length(); i++) {
            JSONObject e = d.optJSONObject(i);
            if (e != null) m.put(e.optString("p"), e.optString("h"));
        }
        return m;
    }

    private static InputStream oeffneUrl(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        int code = c.getResponseCode();
        if (code != 200) throw new IOException("HTTP " + code + " fuer " + url);
        return c.getInputStream();
    }

    private static String encodePfad(String rel) {
        StringBuilder sb = new StringBuilder();
        for (String teil : rel.split("/")) {
            if (sb.length() > 0) sb.append('/');
            try {
                sb.append(java.net.URLEncoder.encode(teil, "UTF-8").replace("+", "%20"));
            } catch (Exception e) {
                sb.append(teil);
            }
        }
        return sb.toString();
    }

    /** Schreibt den Strom in die Datei und gibt die SHA-256 der geschriebenen Bytes zurueck. */
    private static String schreibe(InputStream in, File f) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] puffer = new byte[65536];
            int n;
            while ((n = in.read(puffer)) > 0) {
                md.update(puffer, 0, n);
                out.write(puffer, 0, n);
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    static byte[] lies(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] puffer = new byte[65536];
        int n;
        while ((n = in.read(puffer)) > 0) out.write(puffer, 0, n);
        return out.toByteArray();
    }

    private static void loesche(File f) {
        File[] kinder = f.listFiles();
        if (kinder != null) for (File k : kinder) loesche(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
