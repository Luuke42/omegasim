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
const CHALLENGES = { oval: 10, schlange: 8, kehre: 8, weitblick: 8 };   // id -> Runden im Rennen
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
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return antwort({ ok: false, fehler: 'kein JSON' }); }
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
    blatt().appendRow([new Date(), d.challenge, d.modus, d.preset, Math.round(d.zeit_ms),
      JSON.stringify(d.runden_ms || []), String(d.auto || '').slice(0, 40), String(d.fahrer || '').slice(0, 16),
      String(d.geraet).slice(0, 40), String(d.version || '').slice(0, 20)]);
  } finally { lock.releaseLock(); }
  return antwort({ ok: true });
}

// Plausibilität: bekannte Werte, sinnvolle Zeiten, im Rennen die richtige Rundenzahl.
function pruefen(d) {
  if (!d || !(d.challenge in CHALLENGES)) return 'unbekannte Challenge';
  if (MODI.indexOf(d.modus) < 0) return 'unbekannter Modus';
  if (PRESETS.indexOf(d.preset) < 0) return 'unbekanntes Preset';
  const z = Number(d.zeit_ms);
  if (!isFinite(z) || z < 1500 || z > 3600000) return 'Zeit unplausibel';
  const r = Array.isArray(d.runden_ms) ? d.runden_ms.map(Number) : [];
  if (r.some((x) => !isFinite(x) || x < 1500)) return 'Rundenzeit unplausibel';
  if (d.modus === 'rennen') {
    if (r.length < CHALLENGES[d.challenge]) return 'Rundenzahl stimmt nicht';
    const summe = r.slice(0, CHALLENGES[d.challenge]).reduce((a, b) => a + b, 0);
    if (Math.abs(summe - z) > 50) return 'Gesamtzeit passt nicht zu den Runden';
  } else if (r.length && Math.abs(Math.min.apply(null, r) - z) > 50) {
    return 'beste Runde passt nicht zu den Runden';
  }
  if (!d.geraet) return 'keine Geräte-Kennung';
  return '';
}

// Bestenliste: ?challenge=oval&modus=hotlap&preset=pro -> schnellste Zeiten zuerst.
function doGet(e) {
  const p = (e && e.parameter) || {};
  const werte = blatt().getDataRange().getValues().slice(1);
  const liste = werte
    .filter((z) => z[1] === p.challenge && z[2] === p.modus && z[3] === p.preset)
    .map((z) => ({ zeitpunkt: z[0], zeit_ms: Number(z[4]), auto: z[6], fahrer: z[7], geraet: z[8] }))
    .sort((a, b) => a.zeit_ms - b.zeit_ms);
  return antwort({ ok: true, anzahl: liste.length, zeiten: liste.slice(0, MAX_ZEILEN_ANTWORT) });
}
