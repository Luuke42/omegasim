package de.lroeseler.omegasim;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * SICHERUNG, DIE EINE NEUINSTALLATION UEBERLEBT (v0.9.6).
 *
 * BESTELLT: "Idealerweise ueberleben meine Statistiken, geladenen Strecken, usw. auch eine
 * Neuinstallation der App mit neuer APK." Alles, was die Web-App speichert, liegt im
 * localStorage der WebView - und der gehoert zur Installation: ein Update behaelt ihn, ein
 * Deinstallieren loescht ihn.
 *
 * Darum schreibt die App eine Sicherungsdatei nach Dokumente/OmegaSim (sichtbar, ueberlebt das
 * Deinstallieren). Eine NEUE Installation darf die Datei der alten nicht einfach lesen (ab
 * Android 11 gehoert sie der alten), deshalb oeffnet sie sie ueber den Dateiwaehler (SAF) - ein
 * Tipp, und die Datei ist da.
 *
 *   speichern({text})   schreibt/ueberschreibt Dokumente/OmegaSim/OmegaSim-Sicherung.json
 *   oeffnen()           Dateiwaehler, liefert {text, name}
 */
@CapacitorPlugin(
    name = "OmegaSicherung",
    permissions = {
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "speicher")
    }
)
public class OmegaSicherungPlugin extends Plugin {

    static final String NAME = "OmegaSim-Sicherung.json";
    static final String ORDNER = "OmegaSim";
    private static final String PREFS = "omegasim-sicherung";

    @PluginMethod
    public void speichern(PluginCall call) {
        String text = call.getString("text");
        if (text == null) { call.reject("text fehlt"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("speicher") != PermissionState.GRANTED) {
            requestPermissionForAlias("speicher", call, "nachRecht");
            return;
        }
        schreibenAusfuehren(call, text);
    }

    @PermissionCallback
    private void nachRecht(PluginCall call) {
        if (getPermissionState("speicher") != PermissionState.GRANTED) {
            call.reject("Keine Erlaubnis, in Dokumente zu schreiben.");
            return;
        }
        schreibenAusfuehren(call, call.getString("text"));
    }

    private void schreibenAusfuehren(PluginCall call, String text) {
        // Im Hintergrund: die Datei kann einige MB haben (Autofotos), und der Plugin-Thread
        // traegt auch die Bluetooth-Aufrufe.
        new Thread(() -> {
            try {
                byte[] daten = text.getBytes(StandardCharsets.UTF_8);
                String ort;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ort = schreibenMediaStore(daten);
                else ort = schreibenAlt(daten);
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("ort", ort);
                r.put("bytes", daten.length);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Sicherung nicht geschrieben: " + e.getMessage());
            }
        }, "OmegaSicherung").start();
    }

    /** Ab Android 10: ueber MediaStore, die eigene Datei wiederverwenden, sonst neu anlegen. */
    private String schreibenMediaStore(byte[] daten) throws Exception {
        Context ctx = getContext();
        ContentResolver cr = ctx.getContentResolver();
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String alt = p.getString("uri", null);
        if (alt != null) {
            try (OutputStream o = cr.openOutputStream(Uri.parse(alt), "wt")) {
                if (o != null) {
                    o.write(daten);
                    return Environment.DIRECTORY_DOCUMENTS + "/" + ORDNER + "/" + NAME;
                }
            } catch (Exception e) {
                // Datei geloescht oder nicht mehr unsere: neu anlegen.
            }
        }
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, NAME);
        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS + "/" + ORDNER);
        Uri uri = cr.insert(MediaStore.Files.getContentUri("external"), v);
        if (uri == null) throw new IllegalStateException("MediaStore lehnt ab");
        try (OutputStream o = cr.openOutputStream(uri, "wt")) {
            if (o == null) throw new IllegalStateException("nicht beschreibbar");
            o.write(daten);
        }
        p.edit().putString("uri", uri.toString()).apply();
        return Environment.DIRECTORY_DOCUMENTS + "/" + ORDNER + "/" + NAME;
    }

    /** Android 7-9: direkt in den oeffentlichen Ordner Dokumente (mit Erlaubnis). */
    @SuppressWarnings("deprecation")
    private String schreibenAlt(byte[] daten) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), ORDNER);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Ordner nicht anlegbar");
        File f = new File(dir, NAME);
        try (FileOutputStream o = new FileOutputStream(f, false)) { o.write(daten); }
        return f.getAbsolutePath();
    }

    // ---- STRECKENBILD (v1.0.15) ----------------------------------------------------------
    // BESTELLT: "Editor-Screenshot: huebsches PNG mit Strecke, Code, OmegaSim-Link, Massen,
    // Laenge." Die WebView laedt keine Blob-Downloads; darum schreibt die App das Bild selbst
    // nach Bilder/OmegaSim (in der Galerie sichtbar).
    //   bild({name, base64})   name ohne Endung, base64 ohne "data:"-Vorspann
    @PluginMethod
    public void bild(PluginCall call) {
        String b64 = call.getString("base64");
        String name = call.getString("name", "OmegaSim-Strecke");
        if (b64 == null) { call.reject("base64 fehlt"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("speicher") != PermissionState.GRANTED) {
            requestPermissionForAlias("speicher", call, "nachRechtBild");
            return;
        }
        bildSchreiben(call, name, b64);
    }

    @PermissionCallback
    private void nachRechtBild(PluginCall call) {
        if (getPermissionState("speicher") != PermissionState.GRANTED) {
            call.reject("Keine Erlaubnis, in Bilder zu schreiben.");
            return;
        }
        bildSchreiben(call, call.getString("name", "OmegaSim-Strecke"), call.getString("base64"));
    }

    private void bildSchreiben(PluginCall call, String name, String b64) {
        new Thread(() -> {
            try {
                byte[] daten = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                String datei = name.replaceAll("[^A-Za-z0-9._-]", "_") + ".png";
                String ort;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, datei);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ORDNER);
                    ContentResolver cr = getContext().getContentResolver();
                    Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("MediaStore lehnt ab");
                    try (OutputStream o = cr.openOutputStream(uri, "w")) {
                        if (o == null) throw new IllegalStateException("nicht beschreibbar");
                        o.write(daten);
                    }
                    ort = Environment.DIRECTORY_PICTURES + "/" + ORDNER + "/" + datei;
                } else {
                    @SuppressWarnings("deprecation")
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ORDNER);
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Ordner nicht anlegbar");
                    File f = new File(dir, datei);
                    try (FileOutputStream o = new FileOutputStream(f, false)) { o.write(daten); }
                    ort = f.getAbsolutePath();
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("ort", ort);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Bild nicht gespeichert: " + e.getMessage());
            }
        }, "OmegaBild").start();
    }

    // ONBOARD-VIDEO (75-onboard.js): die Aufnahme kommt in Stuecken (je ~3 MB Base64), damit
    // kein riesiger Text auf einmal ueber die Bruecke muss. Erst in den Cache der App, am
    // Ende nach Filme/OmegaSim (in der Galerie sichtbar).
    //   videoTeil({name, base64, erster})   erster=true beginnt die Datei neu
    //   videoFertig({name, mime})            legt sie ab, liefert {ok, ort}
    @PluginMethod
    public void videoTeil(PluginCall call) {
        String b64 = call.getString("base64");
        String name = sauber(call.getString("name", "OmegaSim-Onboard.mp4"));
        boolean erster = Boolean.TRUE.equals(call.getBoolean("erster", false));
        if (b64 == null) { call.reject("base64 fehlt"); return; }
        new Thread(() -> {
            try {
                byte[] daten = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                File f = new File(getContext().getCacheDir(), "onboard-" + name);
                try (FileOutputStream o = new FileOutputStream(f, !erster)) { o.write(daten); }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("groesse", f.length());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Videoteil nicht geschrieben: " + e.getMessage());
            }
        }, "OmegaVideoTeil").start();
    }

    @PluginMethod
    public void videoFertig(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("speicher") != PermissionState.GRANTED) {
            requestPermissionForAlias("speicher", call, "nachRechtVideo");
            return;
        }
        videoAblegen(call);
    }

    @PermissionCallback
    private void nachRechtVideo(PluginCall call) {
        if (getPermissionState("speicher") != PermissionState.GRANTED) {
            call.reject("Keine Erlaubnis, in Filme zu schreiben.");
            return;
        }
        videoAblegen(call);
    }

    private static String sauber(String name) {
        return name.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private void videoAblegen(PluginCall call) {
        String name = sauber(call.getString("name", "OmegaSim-Onboard.mp4"));
        String mime = call.getString("mime", "video/mp4");
        new Thread(() -> {
            File quelle = new File(getContext().getCacheDir(), "onboard-" + name);
            try {
                if (!quelle.exists()) throw new IllegalStateException("keine Videodaten");
                String ort;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + ORDNER);
                    ContentResolver cr = getContext().getContentResolver();
                    Uri uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("MediaStore lehnt ab");
                    try (OutputStream o = cr.openOutputStream(uri, "w");
                         InputStream in = new java.io.FileInputStream(quelle)) {
                        if (o == null) throw new IllegalStateException("nicht beschreibbar");
                        kopieren(in, o);
                    }
                    ort = Environment.DIRECTORY_MOVIES + "/" + ORDNER + "/" + name;
                } else {
                    @SuppressWarnings("deprecation")
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), ORDNER);
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Ordner nicht anlegbar");
                    File f = new File(dir, name);
                    try (OutputStream o = new FileOutputStream(f, false);
                         InputStream in = new java.io.FileInputStream(quelle)) {
                        kopieren(in, o);
                    }
                    ort = f.getAbsolutePath();
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("ort", ort);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Video nicht gespeichert: " + e.getMessage());
            } finally {
                //noinspection ResultOfMethodCallIgnored
                quelle.delete();
            }
        }, "OmegaVideo").start();
    }

    private static void kopieren(InputStream in, OutputStream o) throws java.io.IOException {
        byte[] puf = new byte[1 << 16];
        int n;
        while ((n = in.read(puf)) > 0) o.write(puf, 0, n);
    }

    @PluginMethod
    public void oeffnen(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
        startActivityForResult(call, i, "geoeffnet");
    }

    @ActivityCallback
    private void geoeffnet(PluginCall call, ActivityResult ergebnis) {
        if (call == null) return;
        Intent d = ergebnis.getData();
        if (ergebnis.getResultCode() != android.app.Activity.RESULT_OK || d == null || d.getData() == null) {
            call.reject("abgebrochen");
            return;
        }
        Uri uri = d.getData();
        new Thread(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("nicht lesbar");
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] puf = new byte[65536];
                int n;
                while ((n = in.read(puf)) > 0) b.write(puf, 0, n);
                JSObject r = new JSObject();
                r.put("text", new String(b.toByteArray(), StandardCharsets.UTF_8));
                r.put("name", uri.getLastPathSegment());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Datei nicht lesbar: " + e.getMessage());
            }
        }, "OmegaSicherung-Lesen").start();
    }
}
