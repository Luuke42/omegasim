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
// v0.9.62: runden_ms (Rundenzeiten je Lauf) mit, damit die 3er-Serie auch fuer Community
// Strecken rechnen kann. Alte Zeilen haben die Spalte nicht und gelten als leer.
const CZ_BLATT = 'CommunityZeiten', CZ_KOPF = ['zeitpunkt', 'id', 'zeit_ms', 'fahrer', 'geraet', 'runden_ms'];
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
      const runden = Array.isArray(d.runden_ms) ? d.runden_ms.map(Number).filter((x) => isFinite(x)) : [];
      blattMit(CZ_BLATT, CZ_KOPF).appendRow([new Date(), id, Math.round(z), String(d.fahrer || '').slice(0, 16),
        String(d.geraet).slice(0, 40), runden.length ? JSON.stringify(runden) : '']);
      // v1.0.21: Spur der schnellsten Runde (die App schickt nur gewertete Runden).
      if (d.spur) {
        try {
          const r = runden.filter((x) => x >= 1000);
          spurSpeichern('community|' + id, d, r.length ? Math.min.apply(null, r) : z, 40);
        } catch (e) { /* die Zeit zaehlt auch ohne Spur */ }
      }
      return { ok: true };
    }
    return { ok: false, fehler: 'unbekannte Art' };
  } finally { lock.releaseLock(); }
}
function communityGet() {
  const zeiten = {};
  blattMit(CZ_BLATT, CZ_KOPF).getDataRange().getValues().slice(1).forEach((z) => {
    const id = String(z[1]);
    let rundenMs = [];
    try { rundenMs = JSON.parse(z[5] || '[]'); } catch (e) { rundenMs = []; }
    (zeiten[id] = zeiten[id] || []).push({ zeitpunkt: z[0], zeit_ms: Number(z[2]), fahrer: z[3], geraet: z[4],
      runden_ms: Array.isArray(rundenMs) ? rundenMs : [] });
  });
  Object.keys(zeiten).forEach((id) => { zeiten[id] = zeiten[id].sort((a, b) => a.zeit_ms - b.zeit_ms).slice(0, 100); });
  return { ok: true, community: true, tracks: communityStrecken(), zeiten: zeiten };
}

// ---- SPUREN (v1.0.21): Telemetrie einer Runde, je Liste und Geraet die beste ----
// BESTELLT: "Upload immer, ohne Wahl". Die App haengt an jede gewertete Zeit die Spur ihrer
// schnellsten Runde (Zwischenzeiten je Streckenteil, ~10 Proben je Sekunde). Gespeichert wird je
// Liste (challenge|modus|preset oder community|id) und Geraet nur die schnellste. Eine kaputte
// oder unplausible Spur kostet die Zeit NICHT - sie wird nur weggelassen.
const SP_BLATT = 'Spuren', SP_KOPF = ['zeitpunkt', 'liste', 'geraet', 'fahrer', 'zeit_ms', 'spur'];
const SP_MAX_ZEICHEN = 20000;
function spurPruefen(spur, rundeMs, minTeilMs) {
  if (!spur || typeof spur !== 'object') return 'keine Spur';
  const n = Number(spur.n), ms = Number(spur.ms), teile = spur.teile;
  if (!(n >= 3 && n <= 200) || !Array.isArray(teile) || teile.length !== n) return 'Teilzahl stimmt nicht';
  if (!/^[A-Z0-9@]{3,200}$/.test(String(spur.code || ''))) return 'Streckencode unplausibel';
  if (Math.abs(ms - rundeMs) > 50) return 'Spur passt nicht zur Runde';
  if (Number(teile[0]) !== 0) return 'Spur beginnt nicht bei 0';
  for (let k = 1; k <= n; k++) {
    const vor = Number(teile[k - 1]), nach = k < n ? Number(teile[k]) : ms;
    if (!isFinite(nach) || nach - vor < minTeilMs) return 'Teil zu schnell';
  }
  if (spur.proben && !Array.isArray(spur.proben)) return 'Proben unplausibel';
  return '';
}
function spurSpeichern(liste, d, rundeMs, minTeilMs) {
  const spur = d.spur;
  if (!spur) return '';
  const f = spurPruefen(spur, rundeMs, minTeilMs);
  if (f) return f;
  const roh = JSON.stringify({ v: 1, code: String(spur.code), n: Number(spur.n), ms: Math.round(Number(spur.ms)),
    teile: spur.teile.map((x) => Math.round(Number(x))),
    proben: (spur.proben || []).slice(0, 400).map((p) => (Array.isArray(p) ? p.slice(0, 6).map((x) => Math.round(Number(x) * 10) / 10) : [])) });
  if (roh.length > SP_MAX_ZEICHEN) return 'Spur zu gross';
  const sh = blattMit(SP_BLATT, SP_KOPF);
  const werte = sh.getDataRange().getValues();
  const geraet = String(d.geraet).slice(0, 40);
  for (let i = 1; i < werte.length; i++) {
    if (String(werte[i][1]) === liste && String(werte[i][2]) === geraet) {
      if (Number(werte[i][4]) <= Math.round(rundeMs)) return '';           // die alte ist schneller
      sh.getRange(i + 1, 1, 1, SP_KOPF.length).setValues([[new Date(), liste, geraet,
        String(d.fahrer || '').slice(0, 16), Math.round(rundeMs), roh]]);
      return '';
    }
  }
  sh.appendRow([new Date(), liste, geraet, String(d.fahrer || '').slice(0, 16), Math.round(rundeMs), roh]);
  return '';
}
// ?spurliste=<liste>: welche Geraete haben eine Spur (schnellste zuerst). ?spur=<liste>&geraet=<g>:
// die Spur selbst. Ohne Blatt einfach leer.
function spurGet(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss ? ss.getSheetByName(SP_BLATT) : null;
  const werte = sh ? sh.getDataRange().getValues().slice(1) : [];
  const liste = String(p.spurliste || p.spur || '');
  const zeilen = werte.filter((z) => String(z[1]) === liste).sort((a, b) => Number(a[4]) - Number(b[4]));
  if (p.spurliste) {
    return { ok: true, spurliste: liste, spuren: zeilen.slice(0, MAX_ZEILEN_ANTWORT)
      .map((z) => ({ geraet: String(z[2]), fahrer: String(z[3]), zeit_ms: Number(z[4]) })) };
  }
  const z = p.geraet ? zeilen.find((x) => String(x[2]) === String(p.geraet)) : zeilen[0];
  if (!z) return { ok: false, fehler: 'keine Spur' };
  let spur = null;
  try { spur = JSON.parse(z[5]); } catch (e) { return { ok: false, fehler: 'Spur kaputt' }; }
  return { ok: true, liste: liste, geraet: String(z[2]), fahrer: String(z[3]), zeit_ms: Number(z[4]), spur: spur };
}

// ---- STUDIE (v1.1.3: NARQ-S und Fahrverhaltens-Challenge) ----
// Eigenes Blatt "Studie2": die Spalten haben sich gegenueber v1.0 (18 NARQ-Items, Blatt "Studie")
// geaendert, und ein Anhaengen nach Position an die alte Kopfzeile wuerde die Spalten verschieben.
// Das alte Blatt bleibt unangetastet (nur Testdaten aus dem Entwicklermodus).
//
// LESEN: doGet gibt dieses Blatt NIE roh heraus. Es gibt genau zwei Wege:
//   ?studie=zusammenfassung   Anzahl, Mittel/Spanne je Kennwert und die Korrelationen der
//                             Hypothesen - Kennwerte erst ab 5 Teilnehmenden.
//   ?studie=daten             die anonymisierten Daten (OHNE Geraetekennung, Zeitpunkt, Controller,
//                             App-Version und Sprache), je Geraet nur die erste Teilnahme, in
//                             zufaelliger Reihenfolge. So steht es im Einwilligungstext der App.
const S2_BLATT = 'Studie2';
const S2_NARQ = 6, S2_ADM = [1, 2, 4], S2_RIV = [3, 5, 6];
const S2_STIL = ['sekunden', 'vollgas', 'gas', 'bremse', 'bremsungen', 'bremsKurve', 'lenkUnruhe', 'abfluege', 'rundenStreu'];
// v1.1.11: die virtuelle Fahrt (dieselbe Strecke in der App) in eigenen Spalten mit v_ davor - am ENDE
// angehaengt, damit schon vorhandene Zeilen nicht verrutschen (die Kopfzeile wird ergaenzt).
const S2_VIRTUELL = ['v_fahrt', 'v_fahrt_gueltig', 'v_fahrt_grund', 'v_runden_ms', 'v_beste_ms', 'v_gesamt_ms'].concat(S2_STIL.map((k) => 'v_' + k));
const S2_KOPF = ['zeitpunkt', 'geraet', 'alter', 'geschlecht', 'narq_version', 'narq_1', 'narq_2', 'narq_3', 'narq_4', 'narq_5',
  'narq_6', 'bewunderung', 'rivalitaet', 'selbst', 'rt_ms', 'rt_median', 'fruehstarts', 'verpasst', 'quelle', 'controller',
  'version', 'sprache', 'fahrt', 'fahrt_gueltig', 'fahrt_grund', 'preset', 'runden_ms', 'beste_ms', 'gesamt_ms'].concat(S2_STIL).concat(S2_VIRTUELL);
const S2_OEFFENTLICH = ['alter', 'geschlecht', 'narq_1', 'narq_2', 'narq_3', 'narq_4', 'narq_5', 'narq_6', 'bewunderung',
  'rivalitaet', 'selbst', 'rt_median', 'fruehstarts', 'verpasst', 'quelle', 'fahrt', 'fahrt_gueltig', 'preset', 'runden_ms',
  'beste_ms', 'gesamt_ms'].concat(S2_STIL).concat(S2_VIRTUELL.filter((k) => k !== 'v_fahrt_grund'));
const S2_MIN_N = 5;

function zahlIn(x, lo, hi) { const n = Number(x); return isFinite(n) && n >= lo && n <= hi ? n : ''; }
function studiePost(d) {
  if (!d.geraet) return { ok: false, fehler: 'keine Geräte-Kennung' };
  const alter = Number(d.alter);
  if (!(alter >= 18 && alter <= 99 && Math.round(alter) === alter)) return { ok: false, fehler: 'Alter unplausibel' };
  if (['w', 'm', 'd', 'k'].indexOf(d.geschlecht) < 0) return { ok: false, fehler: 'Geschlecht unbekannt' };
  if (d.volljaehrig !== true || d.einwilligung !== true) return { ok: false, fehler: 'ohne Einwilligung' };
  const narq = Array.isArray(d.narq) ? d.narq.map(Number) : [];
  if (narq.length !== S2_NARQ || narq.some((x) => !(x >= 1 && x <= 6 && Math.round(x) === x))) return { ok: false, fehler: 'NARQ-S unvollständig' };
  const selbst = Number(d.selbst);
  if (!(selbst >= 1 && selbst <= 7)) return { ok: false, fehler: 'Selbsteinschätzung fehlt' };
  const rt = Array.isArray(d.rt_ms) ? d.rt_ms.map(Number) : [];
  if (rt.length !== 10 || rt.some((x) => !(x >= 50 && x <= 3000))) return { ok: false, fehler: 'Reaktionszeiten unplausibel' };
  const mw = (nr) => nr.reduce((a, i) => a + narq[i - 1], 0) / nr.length;
  const f = d.fahrt && typeof d.fahrt === 'object' ? d.fahrt : null;
  const stil = f && f.stil && typeof f.stil === 'object' ? f.stil : {};
  const runden = f && Array.isArray(f.runden_ms) ? f.runden_ms.map(Number).filter((x) => x >= 500 && x <= 600000).slice(0, 12) : [];
  const grenzen = { sekunden: [0, 7200], vollgas: [0, 1], gas: [0, 1], bremse: [0, 1], bremsungen: [0, 600], bremsKurve: [0, 1],
                    lenkUnruhe: [0, 50], abfluege: [0, 60], rundenStreu: [0, 5] };
  const v = d.fahrt_virtuell && typeof d.fahrt_virtuell === 'object' ? d.fahrt_virtuell : null;
  const vStil = v && v.stil && typeof v.stil === 'object' ? v.stil : {};
  const vRunden = v && Array.isArray(v.runden_ms) ? v.runden_ms.map(Number).filter((x) => x >= 500 && x <= 600000).slice(0, 12) : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Die Facettenwerte rechnet der Server selbst nach, statt sie dem Telefon zu glauben.
    const zeile = [new Date(), String(d.geraet).slice(0, 40), alter, d.geschlecht, String(d.narqVersion || 'S6').slice(0, 8)]
      .concat(narq)
      .concat([mw(S2_ADM), mw(S2_RIV), selbst, JSON.stringify(rt), Number(d.rt_median) || '',
        Math.max(0, Number(d.fruehstarts) || 0), Math.max(0, Number(d.verpasst) || 0),
        String(d.quelle || '').slice(0, 20), String(d.controller || '').slice(0, 80), String(d.version || '').slice(0, 20),
        String(d.sprache || '').slice(0, 5),
        f ? 1 : 0, f && f.gueltig === true ? 1 : 0, f ? String(f.grund || '').slice(0, 60) : '', f ? String(f.preset || '').slice(0, 12) : '',
        JSON.stringify(runden), f ? zahlIn(f.beste_ms, 500, 600000) : '', f ? zahlIn(f.gesamt_ms, 500, 3600000) : ''])
      .concat(S2_STIL.map((k) => (f && stil[k] !== null && stil[k] !== undefined) ? zahlIn(stil[k], grenzen[k][0], grenzen[k][1]) : ''))
      .concat([v ? 1 : 0, v && v.gueltig === true ? 1 : 0, v ? String(v.grund || '').slice(0, 60) : '', JSON.stringify(vRunden),
        v ? zahlIn(v.beste_ms, 500, 600000) : '', v ? zahlIn(v.gesamt_ms, 500, 3600000) : ''])
      .concat(S2_STIL.map((k) => (v && vStil[k] !== null && vStil[k] !== undefined) ? zahlIn(vStil[k], grenzen[k][0], grenzen[k][1]) : ''));
    const blatt = blattMit(S2_BLATT, S2_KOPF);
    // Aeltere Blaetter haben die v_-Spalten noch nicht in der Kopfzeile: ergaenzen.
    if (blatt.getLastColumn() < S2_KOPF.length) blatt.getRange(1, 1, 1, S2_KOPF.length).setValues([S2_KOPF]);
    blatt.appendRow(zeile);
  } finally { lock.releaseLock(); }
  return { ok: true };
}

// Die Zeilen von Studie2 als Objekte, je Geraet nur die erste Teilnahme.
function studieZeilen() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(S2_BLATT);
  if (!sh) return [];
  const werte = sh.getDataRange().getValues();
  const kopf = werte[0].map(String);
  const gesehen = {};
  const out = [];
  werte.slice(1).forEach((z) => {
    const o = {};
    kopf.forEach((k, i) => { o[k] = z[i]; });
    const g = String(o.geraet || '');
    if (!g || gesehen[g]) return;
    gesehen[g] = true;
    out.push(o);
  });
  return out;
}
function studieZahl(x) { return x === '' || x === null || x === undefined || !isFinite(Number(x)) ? null : Number(x); }
function pearson(paare) {
  const n = paare.length;
  if (n < 3) return { r: null, n: n };
  const mx = paare.reduce((a, p) => a + p[0], 0) / n, my = paare.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  paare.forEach((p) => { sxy += (p[0] - mx) * (p[1] - my); sxx += (p[0] - mx) * (p[0] - mx); syy += (p[1] - my) * (p[1] - my); });
  return { r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null, n: n };
}
function studieMitUeberschaetzung(zeilen) {
  // Selbstueberschaetzung: Selbsteinschaetzung (1-7, als Anteil 0-1) minus Leistungsrang unter allen
  // gueltigen Fahrten (schnellste beste Runde = 1, langsamste = 0).
  const mitZeit = zeilen.filter((o) => Number(o.fahrt_gueltig) === 1 && studieZahl(o.beste_ms));
  const sortiert = mitZeit.map((o) => Number(o.beste_ms)).sort((a, b) => a - b);
  zeilen.forEach((o) => {
    o.ueberschaetzung = null;
    if (Number(o.fahrt_gueltig) !== 1 || !studieZahl(o.beste_ms) || sortiert.length < 2) return;
    const rang = sortiert.indexOf(Number(o.beste_ms));
    const leistung = 1 - rang / (sortiert.length - 1);
    o.ueberschaetzung = (Number(o.selbst) - 1) / 6 - leistung;
  });
  return zeilen;
}
const S2_HYPOTHESEN = { H1a: ['rivalitaet', 'bremsKurve'], H1b: ['rivalitaet', 'abfluege'], H2: ['bewunderung', 'ueberschaetzung'],
  H3: ['rivalitaet', 'vollgas'], H4: ['rt_median', 'beste_ms'], H5: ['lenkUnruhe', 'rundenStreu'] };
const S2_FAHRWERTE = ['beste_ms', 'vollgas', 'bremsKurve', 'abfluege', 'lenkUnruhe', 'rundenStreu', 'ueberschaetzung'];
function studieZusammenfassung() {
  const zeilen = studieMitUeberschaetzung(studieZeilen());
  const n = zeilen.length;
  // Fahrwerte nur aus gueltigen Fahrten (richtige Strecke, alle Runden gezaehlt).
  const wert = (o, k) => (S2_FAHRWERTE.indexOf(k) >= 0 && Number(o.fahrt_gueltig) !== 1) ? null : studieZahl(o[k]);
  const kennwerte = {};
  ['rivalitaet', 'bewunderung', 'rt_median', 'beste_ms', 'vollgas', 'bremsKurve', 'abfluege', 'lenkUnruhe', 'rundenStreu'].forEach((k) => {
    const v = zeilen.map((o) => wert(o, k)).filter((x) => x !== null);
    if (v.length < S2_MIN_N) return;
    kennwerte[k] = { n: v.length, mittel: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min.apply(null, v), max: Math.max.apply(null, v) };
  });
  const hypothesen = {};
  Object.keys(S2_HYPOTHESEN).forEach((h) => {
    const [x, y] = S2_HYPOTHESEN[h];
    const paare = zeilen.map((o) => [wert(o, x), wert(o, y)]).filter((p) => p[0] !== null && p[1] !== null);
    const r = pearson(paare);
    hypothesen[h] = paare.length >= S2_MIN_N ? r : { r: null, n: paare.length };
  });
  return { ok: true, n: n, kennwerte: kennwerte, hypothesen: hypothesen };
}
function studieDatenOeffentlich() {
  const zeilen = studieZeilen().map((o) => {
    const x = {};
    S2_OEFFENTLICH.forEach((k) => { x[k] = o[k] === undefined ? '' : o[k]; });
    return x;
  });
  // Zufaellige Reihenfolge, damit die Position nichts ueber den Zeitpunkt verraet.
  for (let i = zeilen.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = zeilen[i]; zeilen[i] = zeilen[j]; zeilen[j] = t;
  }
  return { ok: true, n: zeilen.length, spalten: S2_OEFFENTLICH, daten: zeilen };
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return antwort({ ok: false, fehler: 'kein JSON' }); }
  // STUDIE (v1.1.3): eigenes Blatt Studie2. doGet gibt es nur zusammengefasst oder anonymisiert
  // heraus (ohne Geraetekennung, Zeitpunkt, Controller) - siehe studieZusammenfassung.
  if (d && d.art === 'studie') {
    const cache = CacheService.getScriptCache();
    const cs = 's_' + String(d.geraet).slice(0, 40);
    if (cache.get(cs)) return antwort({ ok: false, fehler: 'zu schnell hintereinander' });
    cache.put(cs, '1', 60);
    return antwort(studiePost(d));
  }
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
    // v1.0.21: die Spur der schnellsten Runde (hotlap: zeit_ms, Rennen: beste Einzelrunde).
    if (d.spur) {
      try {
        const c = CHALLENGES[d.challenge];
        const r = Array.isArray(d.runden_ms) ? d.runden_ms.map(Number).filter((x) => isFinite(x) && x >= c.min) : [];
        const runde = d.modus === 'hotlap' ? Number(d.zeit_ms) : (r.length ? Math.min.apply(null, r) : 0);
        spurSpeichern(d.challenge + '|' + d.modus + '|' + d.preset, d, runde, c.min / Math.max(3, Number(d.spur.n) || 3) * 0.3);
      } catch (e) { /* die Zeit zaehlt auch ohne Spur */ }
    }
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
  // v1.1.3: Studie nur zusammengefasst oder anonymisiert (siehe studieZusammenfassung).
  if (p.studie === 'zusammenfassung') return antwort(studieZusammenfassung());
  if (p.studie === 'daten') return antwort(studieDatenOeffentlich());
  if (p.spurliste || p.spur) return antwort(spurGet(p));
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
