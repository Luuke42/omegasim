/**
 * @OnlyCurrentDoc
 *
 * OmegaSim Challenges: Online-Bestenliste als Google Sheet (Apps Script Web-App).
 *
 * BERECHTIGUNG: Die Zeile @OnlyCurrentDoc oben beschränkt das Skript auf DIESES eine Sheet,
 * in dem es steckt. Google fragt dann nur nach "Tabellen ansehen und verwalten, in denen
 * diese App installiert ist", nicht nach allen Tabellen des Kontos.
 *
 * EINRICHTEN (einmal, etwa 5 Minuten):
 *  1. https://sheets.new öffnen (neues Google Sheet). Name z. B. "OmegaSim Challenges".
 *  2. Menü Erweiterungen > Apps Script. Den Inhalt von Code.gs durch diese Datei ersetzen,
 *     speichern (Disketten-Symbol).
 *  3. Oben rechts "Bereitstellen" > "Neue Bereitstellung" > Zahnrad > "Web-App".
 *       Beschreibung:    OmegaSim Challenges
 *       Ausführen als:   Ich
 *       Zugriff:         Jeder
 *     "Bereitstellen" klicken, Google fragt nach Berechtigungen: dein Konto wählen,
 *     "Erweitert" > "Zu OmegaSim Challenges (unsicher) wechseln" > "Zulassen".
 *     (Die Warnung kommt, weil das Skript nicht von Google geprüft ist. Dank @OnlyCurrentDoc
 *     bekommt es nur Zugriff auf dieses eine Sheet. Steht im Dialog "alle deine Tabellen",
 *     fehlt die Zeile @OnlyCurrentDoc ganz oben: dann abbrechen und die Datei neu einfügen.)
 *  4. Die angezeigte Web-App-URL kopieren (endet auf /exec).
 *  5. In OmegaSim: Challenges > Online > "Adresse der Web-App" einfügen, Namen eintragen,
 *     "Verbindung testen". Fertig.
 *
 * Das Blatt "Zeiten" legt das Skript beim ersten Eintrag selbst an. Jede Zeile ist ein Lauf.
 * Einträge löschen oder korrigieren geht direkt im Sheet.
 *
 * ÄNDERUNGEN AM SKRIPT: nach dem Speichern "Bereitstellen" > "Bereitstellungen verwalten" >
 * Stift > Version "Neue Version" > "Bereitstellen". Die URL bleibt dieselbe.
 */

const BLATT = 'Zeiten';
const KOPF = ['zeitpunkt', 'challenge', 'modus', 'preset', 'zeit_ms', 'runden_ms', 'auto', 'fahrer', 'geraet', 'version'];
// id -> Runden im Rennen und Mindestrundenzeit in ms. Die App rechnet Streckenlaenge geteilt
// durch 2,5 m/s - rund 50 % ueber dem gemessenen Hoechsttempo der Autos (1,64 m/s) - und
// verwirft schnellere Runden selbst (72-challenges.js, chMinRundeMs). Hier stehen die Werte
// um gut 2 % darunter, damit das Sheet nie eine Runde ablehnt, die die App knapp zaehlt.
// v0.8.44: alle 80 Wochenstrecken (72-challenges.js, CH_KATALOG), 4 % unter der App.
const CHALLENGES = {
  'wa01-imolina': { runden: 12, min: 1220 },
  'wa02-zandwoorde': { runden: 12, min: 1810 },
  'wa03-hockenhain': { runden: 12, min: 1810 },
  'wa04-brandsby': { runden: 12, min: 1550 },
  'wa05-oultonia': { runden: 12, min: 1380 },
  'wa06-magnycour': { runden: 12, min: 1810 },
  'wa07-estorilla': { runden: 12, min: 1520 },
  'wa08-jerezito': { runden: 12, min: 1680 },
  'wa09-assenburg': { runden: 12, min: 1850 },
  'wa10-mugellino': { runden: 12, min: 1550 },
  'wa11-donningham': { runden: 12, min: 1850 },
  'wa12-knockhilly': { runden: 12, min: 1810 },
  'wa13-zolderen': { runden: 12, min: 1850 },
  'wa14-oscherlingen': { runden: 12, min: 1810 },
  'wa15-sachsenried': { runden: 12, min: 1710 },
  'wa16-anderstrup': { runden: 12, min: 1810 },
  'wa17-hungarella': { runden: 12, min: 1850 },
  'wa18-misanello': { runden: 12, min: 1680 },
  'wa19-kyalamo': { runden: 12, min: 1850 },
  'wa20-salzbergring': { runden: 12, min: 1810 },
  oval: { runden: 10, min: 2010 },
  schlange: { runden: 8, min: 2310 },
  'wb03-interlagoa': { runden: 10, min: 2310 },
  'wb04-montrealle': { runden: 10, min: 1980 },
  'wb05-barcelonetta': { runden: 10, min: 2140 },
  'wb06-castelletto': { runden: 10, min: 1980 },
  'wb07-sepangga': { runden: 10, min: 1980 },
  'wb08-fujimoro': { runden: 10, min: 2310 },
  'wb09-laguna-sekka': { runden: 10, min: 2310 },
  'wb10-watkins-dale': { runden: 10, min: 2140 },
  'wb11-road-atlantica': { runden: 10, min: 2310 },
  'wb12-sebringa': { runden: 10, min: 2140 },
  'wb13-daytonella': { runden: 10, min: 2140 },
  'wb14-bathursta': { runden: 10, min: 2140 },
  'wb15-phillip-isle': { runden: 10, min: 1980 },
  'wb16-portimanta': { runden: 10, min: 2140 },
  'wb17-aragonita': { runden: 10, min: 2310 },
  'wb18-shanghaio': { runden: 10, min: 2310 },
  'wb19-istanbella': { runden: 10, min: 2310 },
  'wb20-losaya': { runden: 10, min: 2310 },
  kehre: { runden: 8, min: 2290 },
  'wc02-macaolo': { runden: 8, min: 2760 },
  'wc03-bakuna': { runden: 8, min: 2130 },
  'wc04-singaporta': { runden: 8, min: 2760 },
  'wc05-long-beacho': { runden: 8, min: 2760 },
  'wc06-adelaina': { runden: 8, min: 2430 },
  'wc07-pauvilla': { runden: 8, min: 2590 },
  'wc08-detroita': { runden: 8, min: 2760 },
  'wc09-jeddara': { runden: 8, min: 2130 },
  'wc10-norisburg': { runden: 8, min: 2760 },
  'wc11-villa-reala': { runden: 8, min: 2760 },
  'wc12-surfers-parada': { runden: 8, min: 2260 },
  'wc13-montjuicita': { runden: 8, min: 2760 },
  'wc14-pedralbia': { runden: 8, min: 2590 },
  'wc15-avusa': { runden: 8, min: 2590 },
  'wc16-monsanta': { runden: 8, min: 2430 },
  'wc17-boavistella': { runden: 8, min: 2430 },
  'wc18-miamira': { runden: 8, min: 2760 },
  'wc19-vegasina': { runden: 8, min: 2760 },
  'wc20-marinella-bay': { runden: 8, min: 2760 },
  weitblick: { runden: 8, min: 2120 },
  'wd02-francorella': { runden: 8, min: 2710 },
  'wd03-le-mansard': { runden: 8, min: 2120 },
  'wd04-reimsville': { runden: 8, min: 2420 },
  'wd05-oesterwald': { runden: 8, min: 2250 },
  'wd06-mosporto': { runden: 8, min: 2420 },
  'wd07-road-amerigo': { runden: 8, min: 2710 },
  'wd08-talladina': { runden: 8, min: 2120 },
  'wd09-brookfeld': { runden: 8, min: 2710 },
  'wd10-montlherine': { runden: 8, min: 2420 },
  'wd11-rouenna': { runden: 8, min: 2750 },
  'wd12-nivella': { runden: 8, min: 2120 },
  'wd13-zeltbach': { runden: 8, min: 2450 },
  'wd14-pergusella': { runden: 8, min: 2580 },
  'wd15-charadella': { runden: 8, min: 2550 },
  'wd16-crystal-parc': { runden: 8, min: 2120 },
  'wd17-goodwald': { runden: 8, min: 2280 },
  'wd18-thruxford': { runden: 8, min: 2250 },
  'wd19-jaramilla': { runden: 8, min: 2710 },
  'wd20-nuerbelberg': { runden: 8, min: 2450 },
  // Dauerrennen (feste Strecken, 72-challenges.js CH_DAUER). Fehlten bis v0.9.10 - das Sheet
  // lehnte ihre Zeiten als "unbekannte Challenge" ab.
  'dauer-homington': { runden: 20, min: 2010 },
  'dauer-circuitdusol': { runden: 20, min: 2920 },
  'dauer-balkonia': { runden: 100, min: 4180 },
};
const MODI = ['hotlap', 'rennen'];
const PRESETS = ['pro', 'arcade'];
const MAX_ZEILEN_ANTWORT = 500;

function antwort(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function blatt() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BLATT);
  if (!sh) {
    sh = ss.insertSheet(BLATT);
    sh.appendRow(KOPF);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Einen Lauf eintragen. Die App schickt JSON als text/plain (kein CORS-Vorabruf).
// SPALTEN NACH KOPF statt nach Stelle: die Zeilen im Sheet duerfen in jeder Reihenfolge
// stehen, solange die Kopfzeile die Namen traegt. Das macht das Skript robust gegen
// umgeordnete oder leicht verschobene Spalten.
function spalten() {
  const sh = blatt();
  const kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const m = {};
  kopf.forEach((name, i) => { if (name) m[String(name).toLowerCase()] = i; });
  return m;
}
function zelle(sp, zeile, name) {
  const i = sp[name];
  return i === undefined ? '' : zeile[i];
}
function zelleZahl(sp, zeile, name) {
  return Number(zelle(sp, zeile, name)) || 0;
}
function zeileZuEintrag(sp, z) {
  let runden = 0, rundenMs = [];
  try { rundenMs = JSON.parse(zelle(sp, z, 'runden_ms') || '[]'); runden = Array.isArray(rundenMs) ? rundenMs.length : 0; }
  catch (e) { rundenMs = []; }
  return { zeitpunkt: zelle(sp, z, 'zeitpunkt'), zeit_ms: zelleZahl(sp, z, 'zeit_ms'),
    auto: zelle(sp, z, 'auto'), fahrer: zelle(sp, z, 'fahrer'), geraet: zelle(sp, z, 'geraet'),
    runden: runden, runden_ms: rundenMs };
}
// ---- COMMUNITY-STRECKEN (v0.9.10) ---------------------------------------------------------
// Eigene Strecken, die alle sehen und fahren koennen. Zwei Blaetter, beide legt das Skript selbst
// an: "Community" (eine Zeile je Strecke) und "CommunityZeiten" (eine Zeile je Lauf). Ob eine
// Strecke schon da ist (auch gespiegelt), prueft die App vor dem Einreichen - dafuer braucht es
// die Streckengeometrie, und die steht in der App.
// v0.9.45: sechste Spalte "preset" (Abstimmung, mit der die Strecke gefahren wird: arcade, pro,
// gt3, f1, realgt3). Alte Zeilen haben sie nicht und gelten als pro. Eine vorhandene Tabelle
// bekommt die Kopfzelle beim ersten Eintrag nachgetragen.
const C_BLATT = 'Community', C_KOPF = ['zeitpunkt', 'id', 'code', 'name', 'geraet', 'preset'];
const C_PRESETS = ['arcade', 'pro', 'gt3', 'f1', 'realgt3'];
const CZ_BLATT = 'CommunityZeiten', CZ_KOPF = ['zeitpunkt', 'id', 'zeit_ms', 'fahrer', 'geraet'];
function blattMit(name, kopf) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(kopf); sh.setFrozenRows(1); }
  return sh;
}
function communityStrecken() {
  return blattMit(C_BLATT, C_KOPF).getDataRange().getValues().slice(1)
    .map((z) => ({ zeitpunkt: z[0], id: String(z[1]), code: String(z[2]), name: String(z[3]),
                   preset: C_PRESETS.indexOf(String(z[5] || '')) >= 0 ? String(z[5]) : 'pro' }))
    .filter((t) => t.id && t.code);
}
function communityPost(d) {
  if (!d.geraet) return { ok: false, fehler: 'keine Geräte-Kennung' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (d.art === 'community-strecke') {
      const code = String(d.code || '');
      if (!/^[A-Z0-9@]{3,200}$/.test(code)) return { ok: false, fehler: 'Streckencode unplausibel' };
      const alle = communityStrecken();
      const gleich = alle.find((t) => t.code === code);
      if (gleich) return { ok: true, id: gleich.id, schonDa: true };
      const max = alle.reduce((m, t) => Math.max(m, parseInt(t.id, 10) || 0), 0);
      const id = String(max + 1).padStart(4, '0');
      const sh = blattMit(C_BLATT, C_KOPF);
      if (sh.getRange(1, 6).getValue() !== 'preset') sh.getRange(1, 6).setValue('preset');
      const preset = C_PRESETS.indexOf(String(d.preset || '')) >= 0 ? String(d.preset) : 'pro';
      sh.appendRow([new Date(), id, code, String(d.name || ('Strecke ' + id)).slice(0, 32),
        String(d.geraet).slice(0, 40), preset]);
      return { ok: true, id: id };
    }
    if (d.art === 'community-zeit') {
      const id = String(d.id || '');
      if (!communityStrecken().some((t) => t.id === id)) return { ok: false, fehler: 'unbekannte Strecke' };
      const z = Number(d.zeit_ms);
      if (!isFinite(z) || z < 1000 || z > 3600000) return { ok: false, fehler: 'Zeit unplausibel' };
      blattMit(CZ_BLATT, CZ_KOPF).appendRow([new Date(), id, Math.round(z), String(d.fahrer || '').slice(0, 16),
        String(d.geraet).slice(0, 40)]);
      return { ok: true };
    }
    return { ok: false, fehler: 'unbekannte Art' };
  } finally { lock.releaseLock(); }
}
function communityGet() {
  const zeiten = {};
  blattMit(CZ_BLATT, CZ_KOPF).getDataRange().getValues().slice(1).forEach((z) => {
    const id = String(z[1]);
    (zeiten[id] = zeiten[id] || []).push({ zeitpunkt: z[0], zeit_ms: Number(z[2]), fahrer: z[3], geraet: z[4] });
  });
  Object.keys(zeiten).forEach((id) => { zeiten[id] = zeiten[id].sort((a, b) => a.zeit_ms - b.zeit_ms).slice(0, 100); });
  return { ok: true, community: true, tracks: communityStrecken(), zeiten: zeiten };
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return antwort({ ok: false, fehler: 'kein JSON' }); }
  if (d && (d.art === 'community-strecke' || d.art === 'community-zeit')) {
    const cache = CacheService.getScriptCache();
    const cs = 'c_' + String(d.geraet).slice(0, 40);
    if (cache.get(cs)) return antwort({ ok: false, fehler: 'zu schnell hintereinander' });
    cache.put(cs, '1', 10);
    return antwort(communityPost(d));
  }
  const fehler = pruefen(d);
  if (fehler) return antwort({ ok: false, fehler: fehler });
  // Drossel: höchstens ein Eintrag je Gerät alle 15 Sekunden.
  const cache = CacheService.getScriptCache();
  const schl = 'g_' + String(d.geraet).slice(0, 40);
  if (cache.get(schl)) return antwort({ ok: false, fehler: 'zu schnell hintereinander' });
  cache.put(schl, '1', 15);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sp = spalten();
    const sh = blatt();
    // Zeile in KOPF-Reihenfolge schreiben, damit umgeordnete Spalten nichts verschieben.
    const zeile = KOPF.map((name) => {
      if (name === 'zeitpunkt') return new Date();
      if (name === 'challenge') return d.challenge;
      if (name === 'modus') return d.modus;
      if (name === 'preset') return d.preset;
      if (name === 'zeit_ms') return Math.round(d.zeit_ms);
      if (name === 'runden_ms') return JSON.stringify(d.runden_ms || []);
      if (name === 'auto') return String(d.auto || '').slice(0, 40);
      if (name === 'fahrer') return String(d.fahrer || '').slice(0, 16);
      if (name === 'geraet') return String(d.geraet).slice(0, 40);
      if (name === 'version') return String(d.version || '').slice(0, 20);
      return '';
    });
    sh.appendRow(zeile);
  } finally { lock.releaseLock(); }
  return antwort({ ok: true });
}

// Plausibilität: bekannte Werte, sinnvolle Zeiten, im Rennen die richtige Rundenzahl.
function pruefen(d) {
  if (!d || !(d.challenge in CHALLENGES)) return 'unbekannte Challenge';
  if (MODI.indexOf(d.modus) < 0) return 'unbekannter Modus';
  if (PRESETS.indexOf(d.preset) < 0) return 'unbekanntes Preset';
  const c = CHALLENGES[d.challenge];
  const z = Number(d.zeit_ms);
  if (!isFinite(z) || z < c.min || z > 3600000) return 'Zeit unplausibel';
  const r = Array.isArray(d.runden_ms) ? d.runden_ms.map(Number) : [];
  if (r.some((x) => !isFinite(x))) return 'Rundenzeit unplausibel';
  if (d.modus === 'rennen') {
    if (r.length < c.runden) return 'Rundenzahl stimmt nicht';
    if (r.slice(0, c.runden).some((x) => x < c.min)) return 'Runde unter der Mindestzeit';
    const summe = r.slice(0, c.runden).reduce((a, b) => a + b, 0);
    if (Math.abs(summe - z) > 50) return 'Gesamtzeit passt nicht zu den Runden';
  } else if (r.length && Math.abs(Math.min.apply(null, r) - z) > 50) {
    return 'beste Runde passt nicht zu den Runden';
  }
  if (!d.geraet) return 'keine Geräte-Kennung';
  return '';
}

// Bestenliste: ?challenge=oval&modus=hotlap&preset=pro -> schnellste Zeiten zuerst.
// ?alle=1 (v0.8.44): alle Listen auf einmal, fuer den stuendlichen Schnappschuss (80 Strecken
// x 2 Modi x 2 Presets waeren sonst 320 Aufrufe).
function doGet(e) {
  const p = (e && e.parameter) || {};
  // DIAGNOSE: ?debug=1 zeigt, ob ein Sheet gebunden ist, die Kopfzeile und wie viele Zeilen je
  // Challenge darin stehen. Seit v0.9.3 OHNE Adresse und Namen des Sheets und ohne die letzte
  // Zeile - die Web-App ist oeffentlich, und die letzte Zeile enthielt Geraete-ID und Namen.
  if (p.debug) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss ? ss.getSheetByName(BLATT) : null;
    let kopf = [], zeilen = 0, challenges = [];
    if (sh) {
      const werte = sh.getDataRange().getValues();
      zeilen = Math.max(0, werte.length - 1);
      kopf = (werte[0] || []).map((x) => String(x));
      const sp = {};
      kopf.forEach((name, i) => { if (name) sp[String(name).toLowerCase()] = i; });
      const gez = {};
      werte.slice(1).forEach((z) => {
        const c = sp['challenge'] === undefined ? '' : String(z[sp['challenge']] || '');
        if (!c) return;
        gez[c] = (gez[c] || 0) + 1;
      });
      challenges = Object.keys(gez).sort().map((c) => ({ id: c, n: gez[c] }));
    }
    return antwort({ ok: true, debug: true, gebunden: !!ss,
      blatt: sh ? BLATT : null,
      kopf: kopf, zeilen: zeilen, challenges: challenges });
  }
  if (p.community) return antwort(communityGet());
  const sp = spalten();
  const werte = blatt().getDataRange().getValues().slice(1);
  if (p.alle) {
    const listen = {};
    werte.forEach((z) => {
      const k = zelle(sp, z, 'challenge') + '|' + zelle(sp, z, 'modus') + '|' + zelle(sp, z, 'preset');
      if (!zelle(sp, z, 'challenge')) return;
      (listen[k] = listen[k] || []).push(zeileZuEintrag(sp, z));
    });
    Object.keys(listen).forEach((k) => {
      const l = listen[k].sort((a, b) => a.zeit_ms - b.zeit_ms);
      listen[k] = { anzahl: l.length, zeiten: l.slice(0, MAX_ZEILEN_ANTWORT) };
    });
    return antwort({ ok: true, alle: true, listen: listen });
  }
  const liste = werte
    .filter((z) => zelle(sp, z, 'challenge') === p.challenge
      && zelle(sp, z, 'modus') === p.modus && zelle(sp, z, 'preset') === p.preset)
    .map((z) => zeileZuEintrag(sp, z))
    .sort((a, b) => a.zeit_ms - b.zeit_ms);
  return antwort({ ok: true, anzahl: liste.length, zeiten: liste.slice(0, MAX_ZEILEN_ANTWORT) });
}
