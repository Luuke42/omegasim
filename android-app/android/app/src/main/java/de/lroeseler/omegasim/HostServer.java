package de.lroeseler.omegasim;

import android.content.Context;
import fi.iki.elonen.NanoHTTPD;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Der Mehrspieler-Host im Telefon. DIESELBE API wie tools/omegasim_host.py - wer hier etwas
 * aendert, aendert es dort mit (und umgekehrt), sonst verhaelt sich die App je nach Host anders:
 *
 *   GET  /mp/state[?zuschauer=ID]  Rangliste, Rennuhr, Strecke, Positionen, Zahl der Info-Screens
 *   POST /mp/report                eigener Stand eines Telefons (JSON, hoechstens 8 KiB)
 *   GET  /mp/info                  Rennlaenge und Adresse
 *   GET  /mp/reset                 neues Rennen
 *   POST /mp/race                  gemeinsames Rennen: {plan, phase, initiator, vorlaufMs}
 *                                  phase 'bereit' -> Bereitschaftsschirm; phase 'start' ->
 *                                  Startzeit in der Host-Uhr, nur wenn alle ausser dem
 *                                  Initiator bereit sind (v0.8.126)
 *   POST /mp/ready                 {id}: dieses Telefon ist bereit
 *   POST /mp/race/cancel           nur die Bereitschaftsrunde beenden (v0.9.2)
 *   POST /mp/leave                 {id}: dieses Telefon ist raus (v0.9.2)
 *   OPTIONS                        Vorabflug, CORS *
 *   alles andere                   die App selbst (laufende Fassung), fuer Browser im WLAN
 *
 * Gewertet wird wie dort: Runden absteigend, bei Gleichstand wer zuerst dort war.
 */
class HostServer extends NanoHTTPD {

    private final Context ctx;
    private final Map<String, JSONObject> fahrer = new HashMap<>();
    private final Map<String, Long> zuschauer = new HashMap<>();
    private Double start = null;
    private Integer runden = null, minuten = null;
    private String strecke = "";
    // GEMEINSAMER START (v0.8.42): Plan und Startzeit (Host-Uhr, ms), verteilt ueber /mp/state.
    private long raceId = 0;
    private Long startAt = null;
    private JSONObject plan = null;
    // BEREIT-GATE (v0.8.126): zwei Phasen. 'bereit' zeigt den Bereitschaftsschirm, 'start'
    // setzt die Startzeit - aber erst, wenn alle ausser dem Initiator bereit sind.
    private String phase = "idle";
    private String initiator = null;
    private final List<String> bereit = new ArrayList<>();
    // Host-Kennung (v0.9.2): die Renn-Nummer beginnt nach einem Neustart wieder bei 1.
    private final String boot = Long.toHexString(new java.util.Random().nextLong() & 0xffffffffL);
    // Wer bei "alle bereit" zaehlt: nur, wer sich in den letzten 15 s gemeldet hat.
    private static final double AKTIV_S = 15;

    HostServer(Context ctx, int port) {
        super(port);
        this.ctx = ctx.getApplicationContext();
    }

    synchronized void rennlaenge(Integer r, Integer m) {
        runden = r;
        minuten = m;
    }

    private static double jetzt() {
        return System.currentTimeMillis() / 1000.0;
    }

    @Override
    public Response serve(IHTTPSession s) {
        String uri = s.getUri();
        try {
            if (s.getMethod() == Method.OPTIONS) {
                Response r = newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "");
                return cors(r);
            }
            if (uri.startsWith("/mp/state")) {
                List<String> z = s.getParameters().get("zuschauer");
                return json(zustand(z != null && !z.isEmpty() ? z.get(0) : null));
            }
            if (uri.startsWith("/mp/reset")) return json(zuruecksetzen());
            if (uri.startsWith("/mp/info")) {
                JSONObject o = new JSONObject();
                o.put("rennen", rennen());
                List<String> a = OmegaHostPlugin.adressen();
                o.put("adresse", a.isEmpty() ? "" : a.get(0));
                return json(o);
            }
            if (uri.startsWith("/mp/report") || uri.startsWith("/mp/race")
                    || uri.startsWith("/mp/ready") || uri.startsWith("/mp/leave")) {
                if (s.getMethod() != Method.POST) return cors(newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "POST"));
                String laenge = s.getHeaders().get("content-length");
                int n = laenge == null ? 0 : Integer.parseInt(laenge.trim());
                if (n > 16384) {
                    JSONObject f = new JSONObject();
                    f.put("ok", false);
                    f.put("fehler", "zu gross");
                    return json(f);
                }
                byte[] b = new byte[n];
                int gelesen = 0;
                InputStream in = s.getInputStream();
                while (gelesen < n) {
                    int k = in.read(b, gelesen, n - gelesen);
                    if (k < 0) break;
                    gelesen += k;
                }
                JSONObject daten = new JSONObject(new String(b, 0, gelesen, StandardCharsets.UTF_8));
                if (uri.startsWith("/mp/race/cancel")) return json(rennenAbbrechen());
                if (uri.startsWith("/mp/race")) return json(rennenStarten(daten));
                if (uri.startsWith("/mp/leave")) return json(abmelden(daten));
                if (uri.startsWith("/mp/ready")) return json(bereitMelden(daten));
                return json(melden(daten));
            }
            return datei(uri);
        } catch (Exception e) {
            return cors(newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", String.valueOf(e.getMessage())));
        }
    }

    // ---- Zustand -----------------------------------------------------------------------

    private synchronized JSONObject rennen() throws Exception {
        JSONObject r = new JSONObject();
        r.put("start", start == null ? JSONObject.NULL : start);
        r.put("laps", runden == null ? JSONObject.NULL : runden);
        r.put("minutes", minuten == null ? JSONObject.NULL : minuten);
        r.put("id", raceId);
        r.put("startAt", startAt == null ? JSONObject.NULL : startAt);
        r.put("plan", plan == null ? JSONObject.NULL : plan);
        r.put("phase", phase);
        r.put("initiator", initiator == null ? JSONObject.NULL : initiator);
        r.put("bereit", new JSONArray(bereit));
        if (start != null) {
            double lauf = Math.round((jetzt() - start) * 10) / 10.0;
            r.put("laufzeit", lauf);
            if (minuten != null) r.put("restSekunden", Math.max(0, Math.round((minuten * 60 - lauf) * 10) / 10.0));
        }
        return r;
    }

    private synchronized JSONObject zustand(String zuschauerId) throws Exception {
        double t = jetzt();
        if (zuschauerId != null && !zuschauerId.isEmpty()) zuschauer.put(zuschauerId.substring(0, Math.min(64, zuschauerId.length())), System.currentTimeMillis());
        int aktiv = 0;
        Iterator<Map.Entry<String, Long>> it = zuschauer.entrySet().iterator();
        while (it.hasNext()) {
            long alter = System.currentTimeMillis() - it.next().getValue();
            if (alter > 60000) it.remove();
            else if (alter < 5000) aktiv++;
        }
        List<JSONObject> leute = new ArrayList<>();
        for (Map.Entry<String, JSONObject> e : fahrer.entrySet()) {
            JSONObject f = e.getValue();
            JSONObject o = new JSONObject();
            o.put("id", e.getKey());
            o.put("name", f.optString("name"));
            o.put("laps", f.optInt("laps"));
            o.put("letzte", f.has("letzte") ? f.get("letzte") : JSONObject.NULL);
            o.put("beste", f.has("beste") ? f.get("beste") : JSONObject.NULL);
            o.put("abgaenge", f.optInt("abgaenge"));
            o.put("alter", Math.round((t - f.optDouble("aktualisiert", t)) * 10) / 10.0);
            o.put("letzteZeitpunkt", f.optDouble("letzteZeitpunkt", 0));
            if (f.has("pos")) {
                o.put("pos", f.get("pos"));
                o.put("posAlter", Math.round((t - f.optDouble("posZeit", t)) * 1000) / 1000.0);
            }
            if (f.has("farbe")) o.put("farbe", f.get("farbe"));
            leute.add(o);
        }
        leute.sort((a, b) -> {
            int d = b.optInt("laps") - a.optInt("laps");
            if (d != 0) return d;
            return Double.compare(a.optDouble("letzteZeitpunkt"), b.optDouble("letzteZeitpunkt"));
        });
        JSONObject r = new JSONObject();
        r.put("fahrer", new JSONArray(leute));
        r.put("rennen", rennen());
        r.put("zeit", Math.round(t * 10) / 10.0);
        r.put("zeitMs", System.currentTimeMillis());
        r.put("boot", boot);
        r.put("zuschauer", aktiv);
        r.put("strecke", strecke);
        return r;
    }

    private synchronized JSONObject melden(JSONObject d) throws Exception {
        JSONObject ok = new JSONObject();
        String id = d.optString("id", "");
        if (id.isEmpty()) {
            ok.put("ok", false);
            ok.put("fehler", "keine Kennung");
            return ok;
        }
        if (id.length() > 64) id = id.substring(0, 64);
        double t = jetzt();
        JSONObject f = fahrer.get(id);
        if (f == null) {
            f = new JSONObject();
            f.put("name", id);
            f.put("laps", 0);
            f.put("abgaenge", 0);
            f.put("letzteZeitpunkt", t);
            fahrer.put(id, f);
        }
        if (d.has("name")) f.put("name", kuerze(d.optString("name"), 40));
        if (d.has("laps")) {
            int neu = d.optInt("laps", f.optInt("laps"));
            // Der Zeitpunkt fuer den Gleichstand gilt der letzten RUNDE, nicht dem letzten
            // Bericht - sonst gewinnt bei gleicher Rundenzahl, wer zuletzt ein Lebenszeichen
            // geschickt hat.
            if (neu != f.optInt("laps")) f.put("letzteZeitpunkt", t);
            f.put("laps", neu);
        }
        for (String k : new String[] {"letzte", "beste"}) {
            if (d.has(k) && !d.isNull(k)) f.put(k, Math.round(d.getDouble(k) * 1000) / 1000.0);
        }
        if (d.has("abgaenge")) f.put("abgaenge", d.optInt("abgaenge"));
        if (d.has("pos")) {
            f.put("pos", d.getJSONArray("pos"));
            f.put("posZeit", t);
        }
        if (d.has("farbe")) f.put("farbe", kuerze(d.optString("farbe"), 16));
        String code = d.optString("strecke", "");
        if (!code.isEmpty()) strecke = kuerze(code, 400);
        f.put("aktualisiert", t);
        if (start == null) start = t;
        ok.put("ok", true);
        return ok;
    }

    private synchronized JSONObject rennenStarten(JSONObject d) throws Exception {
        JSONObject o = new JSONObject();
        // OHNE phase (Telefone bis v0.8.96): sofort starten wie frueher (v0.9.2).
        String ph = d.has("phase") ? d.optString("phase", "start") : null;
        JSONObject p = d.optJSONObject("plan");
        if (p == null && "start".equals(ph)) p = plan;       // angekuendigter Plan
        if (p == null) {
            o.put("ok", false);
            o.put("fehler", "kein Plan");
            return o;
        }
        String ini = kuerze(d.optString("initiator", ""), 64);
        long jetzt = System.currentTimeMillis();
        if (ph == null || "start".equals(ph)) {
            // Alle AKTIVEN ausser dem Initiator muessen bereit sein.
            List<String> nichtBereit = new ArrayList<>();
            double t = jetzt();
            if (ph != null) {
                for (Map.Entry<String, JSONObject> e : fahrer.entrySet()) {
                    String fid = e.getKey();
                    if (fid.equals(ini) || bereit.contains(fid)) continue;
                    if (t - e.getValue().optDouble("aktualisiert", 0) > AKTIV_S) continue;
                    nichtBereit.add(e.getValue().optString("name", fid));
                }
            }
            if (!nichtBereit.isEmpty()) {
                o.put("ok", false);
                o.put("fehler", "nicht alle bereit: " + String.join(", ", nichtBereit));
                return o;
            }
            long vorlauf = Math.max(6000, Math.min(30000, d.optLong("vorlaufMs", 12000)));
            raceId++;
            startAt = jetzt + vorlauf;
            plan = p;
            start = startAt / 1000.0;
            phase = "start";
            bereit.clear();
            // Neues Rennen: Runden und Zeiten aller auf null, die Fahrer bleiben stehen.
            for (JSONObject f : fahrer.values()) {
                f.put("laps", 0);
                f.remove("letzte");
                f.remove("beste");
                f.put("letzteZeitpunkt", t);
            }
            o.put("ok", true);
            o.put("id", raceId);
            o.put("startAt", startAt);
            o.put("zeitMs", jetzt);
            o.put("plan", p);
            return o;
        }
        // phase == 'bereit': nur den Bereitschaftsschirm ankündigen, noch keine Startzeit.
        raceId++;
        plan = p;
        phase = "bereit";
        initiator = ini;
        bereit.clear();
        startAt = null;
        start = null;
        o.put("ok", true);
        o.put("id", raceId);
        o.put("zeitMs", jetzt);
        return o;
    }

    private synchronized JSONObject rennenAbbrechen() throws Exception {
        if ("bereit".equals(phase)) {
            phase = "idle";
            plan = null;
            initiator = null;
            bereit.clear();
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        return o;
    }

    private synchronized JSONObject abmelden(JSONObject d) throws Exception {
        String id = kuerze(d.optString("id", ""), 64);
        fahrer.remove(id);
        bereit.remove(id);
        JSONObject o = new JSONObject();
        o.put("ok", true);
        return o;
    }

    private synchronized JSONObject bereitMelden(JSONObject d) throws Exception {
        JSONObject o = new JSONObject();
        String id = d.optString("id", "");
        if (id.isEmpty()) {
            o.put("ok", false);
            o.put("fehler", "keine Kennung");
            return o;
        }
        if (!bereit.contains(id)) bereit.add(id);
        o.put("ok", true);
        return o;
    }

    private synchronized JSONObject zuruecksetzen() throws Exception {
        fahrer.clear();
        start = null;
        startAt = null;
        plan = null;
        phase = "idle";
        initiator = null;
        bereit.clear();
        JSONObject ok = new JSONObject();
        ok.put("ok", true);
        return ok;
    }

    private static String kuerze(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    // ---- Antworten ---------------------------------------------------------------------

    private static Response cors(Response r) {
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        r.addHeader("Access-Control-Allow-Headers", "Content-Type");
        r.addHeader("Access-Control-Max-Age", "600");
        r.addHeader("Cache-Control", "no-store");
        return r;
    }

    private static Response json(JSONObject o) {
        return cors(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", o.toString()));
    }

    private Response datei(String uri) {
        String rel = uri.replaceFirst("^/+", "");
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "nein");
        try {
            String pfad = OmegaUpdatePlugin.aktiverPfad(ctx);
            if (pfad.isEmpty()) {
                InputStream in = ctx.getAssets().open("public/" + rel);
                return newChunkedResponse(Response.Status.OK, art(rel), in);
            }
            File f = new File(pfad, rel);
            if (!f.isFile()) throw new IOException("fehlt");
            return newFixedLengthResponse(Response.Status.OK, art(rel), new FileInputStream(f), f.length());
        } catch (IOException e) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "nicht gefunden: " + rel);
        }
    }

    private static String art(String rel) {
        String r = rel.toLowerCase();
        if (r.endsWith(".html")) return "text/html; charset=utf-8";
        if (r.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (r.endsWith(".json")) return "application/json; charset=utf-8";
        if (r.endsWith(".webmanifest")) return "application/manifest+json";
        if (r.endsWith(".svg")) return "image/svg+xml";
        if (r.endsWith(".png")) return "image/png";
        if (r.endsWith(".ogg")) return "audio/ogg";
        if (r.endsWith(".mp3")) return "audio/mpeg";
        if (r.endsWith(".css")) return "text/css";
        return "application/octet-stream";
    }
}
