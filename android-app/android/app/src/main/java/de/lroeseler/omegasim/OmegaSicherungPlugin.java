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
