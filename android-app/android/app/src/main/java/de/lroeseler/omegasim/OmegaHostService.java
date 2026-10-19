package de.lroeseler.omegasim;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Haelt den Prozess am Leben, solange dieses Telefon Host ist. Er selbst tut nichts - der
 * Server laeuft in OmegaHostPlugin. Ohne ihn beendet Android den Server, sobald der
 * Bildschirm eine Weile dunkel ist, und alle Gaeste melden "kein Kontakt zum Host".
 *
 * Art "connectedDevice": die App haelt eine Verbindung zu einem Geraet (dem Auto) und zu den
 * Telefonen im WLAN. Ab Android 14 verlangt diese Art eine der zugehoerigen Berechtigungen;
 * CHANGE_WIFI_MULTICAST_STATE (fuer die Host-Suche ohnehin noetig) ist eine davon und wird
 * bei der Installation erteilt. Scheitert der Start trotzdem, laeuft der Host ohne Dienst weiter.
 */
public class OmegaHostService extends Service {

    static final String KANAL = "omegasim-host";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && nm != null) {
                nm.createNotificationChannel(new NotificationChannel(KANAL, "Mehrspieler-Host", NotificationManager.IMPORTANCE_LOW));
            }
            Intent oeffnen = new Intent(this, MainActivity.class);
            PendingIntent pi = PendingIntent.getActivity(this, 0, oeffnen, PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, KANAL) : new Notification.Builder(this);
            String adr = OmegaHostPlugin.adressen().isEmpty() ? "" : " · http://" + OmegaHostPlugin.adressen().get(0) + ":8080";
            Notification n = b
                .setContentTitle("OmegaSim-Host läuft")
                .setContentText("Andere Geräte im WLAN können beitreten" + adr)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            } else {
                startForeground(42, n);
            }
        } catch (Exception e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
