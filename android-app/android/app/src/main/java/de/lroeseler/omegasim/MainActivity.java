package de.lroeseler.omegasim;

import android.app.Activity;
import android.bluetooth.BluetoothGatt;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.PluginHandle;
import java.lang.reflect.Field;
import java.util.Map;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Die Huelle um index.html. Vor dem ersten Laden der Seite:
 *
 * 1. RUECKFALL einer Aktualisierung, die nie bestaetigt wurde (siehe OmegaUpdatePlugin).
 * 2. Die zwei eigenen Plugins anmelden. Das Bluetooth-Plugin meldet sich selbst an.
 * 3. Bildschirm an lassen: waehrend eines Rennens darf das Telefon nicht einschlafen.
 * 4. VOLLBILD. BESTELLT: "Vollbild nutzen - aktuell ist ein grauer Rand überall drumherum mit
 *    den Zurücktasten, menü, Zeit und Batteriestand usw." Statusleiste und Navigationsleiste
 *    verschwinden (immersiv); ein Wischen vom Rand holt sie kurz zurueck. Die Seite reicht
 *    bis unter die Kamera-Aussparung - der graue Rand war das Polster, das Capacitor fuer
 *    die Leisten und die Aussparung um die WebView legte. Die Web-App haelt mit
 *    env(safe-area-inset-*) selbst Abstand, wo es noetig ist (viewport-fit=cover).
 *    Nach jedem Fokuswechsel (Bluetooth-Auswahl, Benachrichtigung) wieder verstecken:
 *    Android zeigt die Leisten dabei von selbst wieder an.
 *    NACHGESCHAERFT (v0.8.26), GEMELDET: "Kannst du meine Android-Tasten ausblenden am
 *    Rand? Uhrzeit, Akkustand, aber auch Home-Button und Tab-Button." Ein einzelnes hide()
 *    in onCreate kam auf manchen Geraeten zu frueh (die Leisten kamen mit dem Laden der Seite
 *    wieder). Deshalb: zusaetzlich die alten Vollbild-Flaggen (bis Android 10), mehrfach
 *    nachgelegt (0,4 / 1,5 / 4 s nach dem Start) und von der Web-Seite aus abrufbar
 *    (OmegaHostPlugin.vollbild, gerufen beim Start, bei jedem Tabwechsel und nach dem
 *    Zurueckkommen in die App).
 * 5. BLUETOOTH BEIM SCHLIESSEN TRENNEN. GEMELDET: "Wenn ich die App schliesse und oeffne, zeigt
 *    das Auto an, es waere noch verbunden, ist es aber nicht. Und neu verbinden geht dann auch
 *    nicht." Das Plugin (@capacitor-community/bluetooth-le) schliesst seine GATT-Verbindungen
 *    nicht, wenn die Activity endet; der Prozess lebt weiter und mit ihm die Verbindung. Das
 *    Auto wirbt dann nicht mehr und ist fuer eine neue Suche unsichtbar. Das Plugin hat dafuer
 *    keinen Weg nach aussen, also per Reflexion: seine deviceMap, darin je Geraet das Feld
 *    bluetoothGatt - disconnect() und close(). Scheitert das (andere Plugin-Fassung), bleibt es
 *    beim alten Verhalten; die Web-Seite nimmt ein noch verbundenes Auto dann beim naechsten
 *    Verbinden direkt wieder auf (05-app-bruecke.js).
 * 6. ZURUECK-TASTE. BESTELLT: "Der 'zurueck' Pfeil (neben dem Home-Button) von meinem Handy
 *    soll, wenn ich ihn klicke, zum Startbildschirm fuehren." Ohne das App-Plugin faengt
 *    Capacitor die Taste nicht ab, und sie beendete die App. Jetzt fragt sie zuerst die Seite
 *    (window.omegaZurueck, 51-konsole.js): steht man nicht auf dem Startbildschirm, fuehrt die
 *    Seite dorthin und meldet "true". Nur auf dem Startbildschirm selbst gilt die Taste wie
 *    gewohnt (App schliessen).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        OmegaUpdatePlugin.beimStart(this);
        registerPlugin(OmegaUpdatePlugin.class);
        registerPlugin(OmegaHostPlugin.class);
        registerPlugin(OmegaBlePlugin.class);
        registerPlugin(OmegaSicherungPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        zurueckTasteAnbinden();
        vollbild();
        View d = getWindow().getDecorView();
        d.postDelayed(this::vollbild, 400);
        d.postDelayed(this::vollbild, 1500);
        d.postDelayed(this::vollbild, 4000);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) vollbild();
    }

    @Override
    public void onResume() {
        super.onResume();
        vollbild();
    }

    @Override
    public void onDestroy() {
        bluetoothTrennen();
        super.onDestroy();
    }

    private void bluetoothTrennen() {
        try {
            PluginHandle h = getBridge() != null ? getBridge().getPlugin("BluetoothLe") : null;
            Object plugin = h != null ? h.getInstance() : null;
            if (plugin == null) return;
            Field karte = plugin.getClass().getDeclaredField("deviceMap");
            karte.setAccessible(true);
            Object m = karte.get(plugin);
            if (!(m instanceof Map)) return;
            for (Object geraet : ((Map<?, ?>) m).values()) {
                try {
                    Field f = geraet.getClass().getDeclaredField("bluetoothGatt");
                    f.setAccessible(true);
                    Object gatt = f.get(geraet);
                    if (gatt instanceof BluetoothGatt) {
                        ((BluetoothGatt) gatt).disconnect();
                        ((BluetoothGatt) gatt).close();
                    }
                } catch (Throwable e) { /* naechstes Geraet */ }
            }
        } catch (Throwable e) { /* andere Plugin-Fassung: nichts zu tun */ }
    }

    private void zurueckTasteAnbinden() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) { weiterReichen(); return; }
                wv.evaluateJavascript(
                    "(function(){try{return !!(window.omegaZurueck&&window.omegaZurueck());}catch(e){return false;}})()",
                    (antwort) -> { if (!"true".equals(antwort)) weiterReichen(); });
            }

            private void weiterReichen() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    private void vollbild() { vollbildFuer(this); }

    @SuppressWarnings("deprecation")
    static void vollbildFuer(Activity a) {
        if (a == null) return;
        Window w = a.getWindow();
        if (w == null) return;
        View d = w.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        if (Build.VERSION.SDK_INT < 30) {
            d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, d);
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
