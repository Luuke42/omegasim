  // Selektive Statistikbereinigung. Garagen- und Challengeablagen bleiben
  // unangetastet; Zeitbereinigung erfasst auch lokale Bestzeiten und Telemetrie. Kein Eingriff in den 45-ms-Fahrtakt; nur explizite Benutzeraktionen.
  const STAT_CLEAN_BACKUP = 'chc.statistics.undo.v1';
  const STAT_CLEAN_BACKUP_TYP = 'omegasim-statistik-sicherung';

  // Texte laufen ueber das normale Woerterbuch (I18N_EN/I18N_ES, 10-ble-explorer.js): der
  // deutsche Text ist der Schluessel, {x} sind Platzhalter fuer Zahlen und Namen. Vorher
  // stand hier eine eigene Weiche Deutsch/Englisch, und der Bereich war data-i18n-skip -
  // Spanisch sah deshalb Deutsch.
  function statCleanT(de, werte) {
    let s = typeof t === 'function' ? t(de) : de;
    if (werte) for (const k of Object.keys(werte)) s = s.split('{' + k + '}').join(String(werte[k]));
    return s;
  }
  function statCleanEsc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function statCleanZahl(x) { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
  function statCleanKopie(o) { return JSON.parse(JSON.stringify(o)); }

  // Derselbe Schluessel, unter dem sessionRecord() (97-sessions.js) die Summen gebucht hat.
  // Neue Sitzungen tragen ihn in statistikBuchung.id. Bei alten Sitzungen wird er so
  // nachgebildet, wie sessionRecord ihn damals vergeben hat: die Geraetekennung, wenn das
  // Auto in der Garage stand, sonst 'name:<Name>' - auch dann, wenn die Sitzung selbst eine
  // a.id traegt (das Auto war beim Speichern nicht in der Garage). Vorher galt in diesem
  // Fall a.id: das Auto stand doppelt in der Auswahl (einmal als 'name:X' aus dem Speicher,
  // einmal als a.id aus den Sitzungen) und seine Anteile galten als "nicht zuordenbar".
  // Zwei Autos gleichen Namens mit verschiedenen IDs werden nie zusammengelegt.
  function statCleanAutoKey(a, o) {
    if (a.statistikBuchung && typeof a.statistikBuchung.id === 'string') return a.statistikBuchung.id;
    const cars = (o && o.cars) || {};
    const hat = (k) => Object.prototype.hasOwnProperty.call(cars, k);
    const nameKey = 'name:' + String(a.name || '?');
    if (a.id != null && String(a.id)) {
      const id = String(a.id);
      if (hat(id)) return id;
      if (hat(nameKey)) return nameKey;
      return id;
    }
    const ids = Object.keys(cars).filter((id) => !id.startsWith('name:') && cars[id] && cars[id].name === a.name);
    return ids.length === 1 && !hat(nameKey) ? ids[0] : nameKey;
  }

  function statCleanPlan(o, art, key) {
    if (!o || !Array.isArray(o.sessions) || !o.cars || typeof o.cars !== 'object') {
      throw new Error(statCleanT('Ungültige Statistikdaten.'));
    }
    const neu = statCleanKopie(o);
    const bericht = { autos: 0, sitzungen: 0, anteile: 0, runden: 0, kmUnbekannt: 0,
      zuordnungUnbekannt: 0, besteUnbekannt: 0 };
    const geloescht = [];
    if (art === 'sitzung') {
      if (!Number.isInteger(key) || key < 0 || key >= o.sessions.length) throw new Error(statCleanT('Sitzung fehlt.'));
      const s = o.sessions[key];
      for (const a of (s.autos || [])) geloescht.push({ a, id: statCleanAutoKey(a, o) });
      neu.sessions.splice(key, 1);
      bericht.sitzungen = 1;
    } else if (art === 'auto') {
      const id = String(key);
      neu.sessions = [];
      o.sessions.forEach((s, i) => {
        const kopie = statCleanKopie(s);
        const weg = (s.autos || []).filter((a) => statCleanAutoKey(a, o) === id);
        if (!weg.length) { neu.sessions.push(kopie); return; }
        kopie.autos = (s.autos || []).filter((a) => statCleanAutoKey(a, o) !== id).map(statCleanKopie);
        weg.forEach((a) => geloescht.push({ a, id }));
        bericht.anteile += weg.length;
        if (!kopie.autos.length) { bericht.sitzungen++; return; }
        // Sitzungsweite Werte stammen von Spieler 1, nicht von allen Mitfahrern.
        // Nach Entfernen dieses Fahrers duerfen seine km/Fahrstil/Strafe nicht weiterzaehlen.
        if (weg.some((a) => a.rolle === 'player')) {
          kopie.simKm = 0; kopie.realKm = 0; kopie.fahrstil = null; kopie.strafeS = null;
        }
        neu.sessions.push(kopie);
      });
      if (Object.prototype.hasOwnProperty.call(neu.cars, id)) { delete neu.cars[id]; bericht.autos = 1; }
      if (!bericht.autos && !geloescht.length) throw new Error(statCleanT('Auto fehlt.'));
    } else { throw new Error(statCleanT('Unbekannte Bereinigung.')); }

    const beruehrt = new Set();
    for (const { a, id } of geloescht) {
      const laps = Array.isArray(a.laps) ? a.laps : [];
      bericht.runden += laps.length;
      if (art === 'auto') continue; // Nur diese Auto-Summen entfernt; Mitfahrer bleiben unveraendert.
      if (!Object.prototype.hasOwnProperty.call(neu.cars, id)) { bericht.zuordnungUnbekannt++; continue; }
      const c = neu.cars[id];
      c.runden = Math.max(0, (Number(c.runden) || 0) - laps.length);
      c.sitzungen = Math.max(0, (Number(c.sitzungen) || 0) - 1);
      const b = a.statistikBuchung;
      if (b && b.id === id && statCleanZahl(b.km) && statCleanZahl(b.realKm)) {
        c.km = +Math.max(0, (Number(c.km) || 0) - b.km).toFixed(3);
        c.realKm = +Math.max(0, (Number(c.realKm) || 0) - b.realKm).toFixed(4);
      } else {
        // Alte Sitzungen haben keine exakten Buchungen je Auto. Rekonstruktion aus
        // Runden/Bahnlaenge waere bei alten Versionen eine nicht belegbare Schaetzung.
        bericht.kmUnbekannt++;
      }
      if (laps.some((ms) => ms === c.besteMs)) beruehrt.add(id);
    }
    for (const id of beruehrt) {
      const c = neu.cars[id];
      const rest = [];
      let anzahl = 0;
      for (const s of neu.sessions) for (const a of (s.autos || [])) {
        if (statCleanAutoKey(a, o) !== id) continue;
        anzahl++;
        for (const ms of (a.laps || [])) if (statCleanZahl(ms) && ms > 0) rest.push(ms);
      }
      // Wenn aeltere Sitzungen bereits aus dem 200er Archiv gefallen sind, ist die
      // zweitbeste Lebenszeit-Runde unbekannt. Nicht einfach einen falschen Rekord setzen.
      if (c.sitzungen === anzahl) {
        c.besteMs = rest.length ? Math.min(...rest) : null;
      } else {
        c.besteMs = null;
        c.besteSeitBereinigung = new Date().toISOString();
        bericht.besteUnbekannt++;
      }
    }
    return { neu, bericht };
  }

  function statCleanGesperrt() {
    return (typeof raceState !== 'undefined' && ['countdown', 'racing', 'finishing'].includes(raceState))
      || (typeof vfAktiv === 'function' && vfAktiv());
  }
  function statCleanAktuell(raw) {
    if (statCleanGesperrt()) throw new Error(statCleanT('Bitte zuerst die laufende Fahrt beenden.'));
    if (localStorage.getItem(SESSION_STORE) !== raw) throw new Error(statCleanT(
      'Die Statistikdaten haben sich geändert. Bitte die Auswahl neu öffnen.'));
  }
  // Rueckgaengig-Daten gehoeren nicht in den kleinen localStorage. Jede Aktion
  // sichert zuerst dauerhaft in IndexedDB und wartet auf den Transaktionsabschluss.
  const STAT_CLEAN_DB = 'omegasim-statistics-backups';
  let statCleanBusy = false;

  function statCleanSpeicherFehler(e) {
    return new Error(statCleanT(
      'Statistik-Sicherung nicht verfügbar. Nichts weiter geändert. Bitte freien Gerätespeicher und die Browser-Speicherfreigabe prüfen; keine Website-Daten löschen.')
      + (e && e.name ? ' (' + e.name + ')' : ''));
  }
  function statCleanDbOeffnen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(statCleanSpeicherFehler()); return; }
      let req, fertig = false;
      const timer = setTimeout(() => { fertig = true; reject(statCleanSpeicherFehler({ name: 'Timeout' })); }, 8000);
      function fehler(e) { if (fertig) return; fertig = true; clearTimeout(timer); reject(statCleanSpeicherFehler(e)); }
      try { req = indexedDB.open(STAT_CLEAN_DB, 1); }
      catch (e) { fehler(e); return; }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('backup')) req.result.createObjectStore('backup');
      };
      req.onerror = () => fehler(req.error);
      req.onblocked = () => fehler({ name: 'Blocked' });
      req.onsuccess = () => {
        if (fertig) { req.result.close(); return; }
        fertig = true; clearTimeout(timer); resolve(req.result);
      };
    });
  }
  async function statCleanDbTransaktion(mode, arbeit) {
    const db = await statCleanDbOeffnen();
    return new Promise((resolve, reject) => {
      let tx, wert, fehler;
      try { tx = db.transaction('backup', mode); }
      catch (e) { db.close(); reject(statCleanSpeicherFehler(e)); return; }
      tx.oncomplete = () => { db.close(); resolve(wert); };
      tx.onabort = tx.onerror = () => { db.close(); reject(fehler || statCleanSpeicherFehler(tx.error)); };
      try {
        arbeit(tx.objectStore('backup'), x => { wert = x; }, e => { fehler = e; tx.abort(); });
      } catch (e) { fehler = e; tx.abort(); }
    });
  }
  function statCleanBackupGueltig(b) {
    try {
      if (!b || b.typ !== STAT_CLEAN_BACKUP_TYP || ![1, 2].includes(b.version)
          || !(b.vorher === null || typeof b.vorher === 'string') || typeof b.nachher !== 'string') return false;
      const o = JSON.parse(b.vorher || '{"cars":{},"sessions":[]}');
      return !!(o && o.cars && Array.isArray(o.sessions)
        && (b.version !== 2 || statCleanExtraGueltig(b.extra)));
    } catch (e) { return false; }
  }
  async function statCleanBackupMigrieren() {
    const raw = localStorage.getItem(STAT_CLEAN_BACKUP);
    if (raw === null) return;
    let b;
    try { b = JSON.parse(raw); } catch (e) { throw new Error(statCleanT('Alte Statistik-Sicherung ist beschädigt; bitte zuerst sichern.')); }
    if (!statCleanBackupGueltig(b)) throw new Error(statCleanT('Alte Statistik-Sicherung ist ungültig; bitte zuerst sichern.'));
    await statCleanDbTransaktion('readwrite', (store, done, fail) => {
      const req = store.get('legacy');
      req.onsuccess = () => { try {
        if (req.result && JSON.stringify(req.result) !== JSON.stringify(b)) {
          fail(new Error(statCleanT('Eine andere alte Sicherung ist bereits vorhanden. Bitte zuerst exportieren.'))); return;
        }
        store.put(b, 'legacy'); done(b);

      } catch (e) { fail(statCleanSpeicherFehler(e)); } };
    });
    // Erst nach dauerhaft erfolgreicher Migration den alten Platz freigeben.
    if (localStorage.getItem(STAT_CLEAN_BACKUP) === raw) localStorage.removeItem(STAT_CLEAN_BACKUP);
  }
  async function statCleanBackupLesen() {
    await statCleanBackupMigrieren();
    return statCleanDbTransaktion('readonly', (store, done) => {
      const req = store.getAll(), keys = store.getAllKeys();
      keys.onsuccess = () => {
        const daten = new Map(keys.result.map((k, i) => [k, req.result[i]]));
        for (const k of ['pending', 'current', 'legacy']) {
          const b = daten.get(k);
          if (statCleanBackupGueltig(b)) { done({ ...b, ablage: k }); return; }
        }
        done(null);
      };
    });
  }
  async function statCleanSichern(raw, nachher, aktion, extra = {}) {
    await statCleanBackupMigrieren();
    const b = { typ: STAT_CLEAN_BACKUP_TYP, version: 1, erstellt: new Date().toISOString(),
      aktion, vorher: raw, nachher, token: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() : Date.now() + '-' + Math.random() };
    if (Object.keys(extra).length) { b.version = 2; b.extra = extra; }
    await statCleanDbTransaktion('readwrite', (store, done, fail) => {
      const req = store.get('pending');
      req.onsuccess = () => { try {
        if (req.result) {
          fail(new Error(statCleanT(
            'Eine nicht abgeschlossene Bereinigung ist gesichert. Bitte zuerst Rückgängig oder JSON-Sicherung verwenden.'))); return;
        }
        store.put(b, 'pending'); done(b);

      } catch (e) { fail(statCleanSpeicherFehler(e)); } };
    });
    return b;
  }
  async function statCleanBackupAbschliessen(b, erfolg) {
    await statCleanDbTransaktion('readwrite', (store, done, fail) => {
      const req = store.get('pending');
      req.onsuccess = () => { try {
        if (!req.result || req.result.token !== b.token) {
          fail(new Error(statCleanT('Sicherungsstand hat sich geändert.'))); return;
        }
        if (erfolg) { store.put(b, 'current'); store.delete('legacy'); }
        store.delete('pending'); done(true);

      } catch (e) { fail(statCleanSpeicherFehler(e)); } };
    });
  }
  function statCleanPaareGleich(b, seite) {
    return Object.entries({ [SESSION_STORE]: b, ...(b.extra || {}) })
      .every(([key, pair]) => localStorage.getItem(key) === pair[seite]);
  }
  async function statCleanExklusiv(arbeit) {
    if (statCleanBusy) throw new Error(statCleanT('Bereinigung läuft bereits.'));
    statCleanBusy = true;
    const buttons = ['stat-clean-car-delete', 'stat-clean-session-delete', 'stat-clean-times-delete',
      'stat-clean-undo', 'stat-clean-refresh'];
    const vorher = buttons.map(id => [$(id), $(id) && $(id).disabled]);
    vorher.forEach(([el]) => { if (el) el.disabled = true; });
    const status = $('stat-clean-status');
    if (status) status.textContent = statCleanT('Sicherung und Bereinigung laufen …');
    try {
      // Web Locks koordinieren auch zwei Tabs desselben Ursprungs, falls verfügbar.
      return await (typeof navigator.locks !== 'undefined'
        ? navigator.locks.request('omegasim-statistics-cleanup', arbeit) : arbeit());
    } finally {
      statCleanBusy = false;
      vorher.forEach(([el, disabled]) => { if (el && el.isConnected) el.disabled = disabled; });
    }
  }
  async function statCleanAnwenden(raw, plan, aktion, meldung) {
    return statCleanExklusiv(async () => {
      statCleanAktuell(raw);
      const text = JSON.stringify(plan.neu), extra = plan.extra || {};
      statCleanExtraAktuell(extra, 'vorher');
      const b = await statCleanSichern(raw, text, aktion, extra);
      try {
        // Waehrend der asynchronen Sicherung koennen Fahrt/zweiter Tab Daten aendern.
        statCleanAktuell(raw); statCleanExtraAktuell(extra, 'vorher');
        statCleanSchreiben({ [SESSION_STORE]: { vorher: raw, nachher: text }, ...extra }, 'nachher');
      } catch (e) {
        // Alte Undo-Sicherung erst nach erfolgreicher Bereinigung ersetzen.
        if (statCleanPaareGleich(b, 'vorher')) {
          try { await statCleanBackupAbschliessen(b, false); } catch (r) { /* pending bleibt exportierbar */ }
        }
        throw e;
      }
      let warnung = '';
      try { await statCleanBackupAbschliessen(b, true); }
      catch (e) { warnung = ' ' + statCleanT('Sicherung bleibt als offene Wiederherstellung erhalten.'); }
      statCleanAuffrischen((meldung || statCleanT('Statistik bereinigt. Sicherung erstellt.')) + warnung);
    });
  }
  async function statCleanUndo() {
    return statCleanExklusiv(async () => {
      const b = await statCleanBackupLesen();
      if (!b) throw new Error(statCleanT('Keine Statistik-Sicherung vorhanden.'));
      const abgebrochen = b.ablage === 'pending' && statCleanPaareGleich(b, 'vorher');
      if (!abgebrochen) { statCleanAktuell(b.nachher); statCleanExtraAktuell(b.extra || {}, 'nachher'); }
      if (!confirm(abgebrochen
        ? statCleanT('Die Bereinigung wurde nicht geschrieben. Offenen Sicherungsversuch abschließen? Statistik bleibt unverändert.')
        : statCleanT('Letzte Statistik-Bereinigung rückgängig machen?'))) return;
      if (abgebrochen) {
        if (!statCleanPaareGleich(b, 'vorher')) throw new Error(statCleanT('Statistikdaten haben sich geändert.'));
      } else {
        statCleanAktuell(b.nachher); statCleanExtraAktuell(b.extra || {}, 'nachher');
        statCleanSchreiben({ [SESSION_STORE]: b, ...(b.extra || {}) }, 'vorher');
      }
      let warnung = '';
      try {
        await statCleanDbTransaktion('readwrite', (store, done, fail) => {
          const req = store.get(b.ablage);
          req.onsuccess = () => { try {
            if (JSON.stringify(req.result) !== JSON.stringify((({ ablage, ...rest }) => rest)(b))) {
              fail(new Error(statCleanT('Sicherungsstand hat sich geändert.'))); return;
            }
            store.delete(b.ablage); done(true);

          } catch (e) { fail(statCleanSpeicherFehler(e)); } };
        });
      } catch (e) { warnung = ' ' + statCleanT('Sicherungsmarker konnte nicht entfernt werden.'); }
      statCleanAuffrischen(statCleanT(abgebrochen ? 'Offener Sicherungsversuch abgeschlossen.'
        : 'Letzte Bereinigung rückgängig gemacht.') + warnung);
    });
  }
  // Ein Name/Foto oder eine Null-Summe allein ist keine Fahrzeugstatistik.
  function statCleanAutoHatDaten(c) {
    return !!(c && (['km', 'realKm', 'runden', 'sitzungen'].some(k => Number(c[k]) > 0)
      || (typeof c.besteMs === 'number' && Number.isFinite(c.besteMs))));
  }
  function statCleanAutos(o) {
    const autos = new Map(Object.keys(o.cars).filter(id => statCleanAutoHatDaten(o.cars[id]))
      .map(id => [id, o.cars[id].name || id]));
    for (const s of o.sessions) for (const a of (s.autos || [])) {
      const id = statCleanAutoKey(a, o);
      if (!autos.has(id)) autos.set(id, a.name || id);
    }
    return autos;
  }
  function statCleanUiZustand() {
    const host = $('stat-bereinigen'), track = $('stat-clean-track'), seconds = $('stat-clean-seconds');
    return {
      offen: !!(host && host.querySelector('details.stat-clean[open]')),
      track: track ? track.value : '', seconds: seconds ? seconds.value : '5',
      trefferOffen: !!($('stat-clean-times-hits') && $('stat-clean-times-hits').open)
    };
  }
  function statCleanAuffrischen(meldung = '') {
    const zustand = statCleanUiZustand(), warnungen = [];
    // Nur EIN Neuaufbau der Bereinigung, nachdem die anderen Ansichten aktualisiert sind.
    // Den Kontext vorher sichern; neue Listener lesen den aktuellen Speicherstand.
    for (const zeichnen of [() => statZeichnen(false), renderSessions,
      ...(typeof teleSeiteZeichnen === 'function' ? [teleSeiteZeichnen] : []),
      () => statBereinigungZeichnen(zustand)]) {
      try { zeichnen(); } catch (e) { warnungen.push(e.message || String(e)); }
    }
    const el = $('stat-clean-status');
    if (el) el.textContent = (meldung ? meldung + ' ' : '') + (warnungen.length
      ? statCleanT('Anzeige nicht vollständig aktualisiert: {m}', { m: warnungen.join('; ') })
      : statCleanT('Anzeige und Trefferliste aktualisiert.'));
    if (warnungen.length) log('Statistik-Darstellungsfehler: ' + warnungen.join('; '), 'err');
    if (typeof autoSicherungPlanen === 'function') autoSicherungPlanen();
  }
  function statCleanFehler(e) {
    const msg = statCleanT('Nicht gelöscht / nicht wiederhergestellt: {m}',
      { m: e && e.message ? e.message : String(e) });
    const el = $('stat-clean-status');
    if (el) el.textContent = msg;
    log(msg, 'err');
  }
  function statCleanBericht(b) {
    const teile = [statCleanT('Betroffen: {s} vollständige Sitzung(en), {a} Fahrzeuganteil(e), {r} Runde(n).',
      { s: b.sitzungen, a: b.anteile, r: b.runden })];
    if (b.kmUnbekannt) teile.push(statCleanT(
      'Altdaten ohne exakte Kilometerbuchung: Die Lebenszeit-Kilometer bleiben bei {n} Fahrzeuganteil(en) unverändert. Sitzungen und Runden werden abgezogen.',
      { n: b.kmUnbekannt }));
    if (b.zuordnungUnbekannt) teile.push(statCleanT(
      'Nicht eindeutig zuordenbare Altdaten: zugehörige Fahrzeug-Summen bleiben unverändert.'));
    if (b.besteUnbekannt) teile.push(statCleanT(
      'Eine gelöschte Bestzeit hat keine vollständig gespeicherte Historie. Der Fahrzeugrekord wird zurückgesetzt und ab der nächsten Fahrt neu geführt.'));
    return teile.join('\n');
  }

  // Die Erklaerung steht hinter dem i im Kreis (optInfoOeffnen, 98c-opt-info.js), nicht als
  // Fliesstext unter den Auswahlfeldern.
  const STAT_CLEAN_INFO = [
    'Vor jedem Löschen wird der bisherige Stand in der Browser-Datenbank (IndexedDB) gesichert. Die Sicherung enthält den Stand vor der letzten Bereinigung. Garage, Fotos und Challenges bleiben erhalten. Beim Entfernen eines Autos oder einer Sitzung bleiben die getrennten Bestzeit-Rekorde stehen; die Zeitbereinigung prüft sie zusätzlich.',
    'Rückgängig geht nur, solange sich die Statistik seit der Bereinigung nicht geändert hat. Erst die nächste erfolgreiche Löschung ersetzt die Sicherung. Für dauerhafte Sicherungen vorher Optionen → Sicherung nutzen. Die JSON-Datei lässt sich dort importieren und ersetzt dann die gesamte Statistikablage. Die Zeitbereinigung sichert auch lokale Bestzeiten und Telemetrie. Der JSON-Download funktioniert im Browser; in der App die vorhandene Sicherungsfunktion nutzen.',
  ];

  function statBereinigungZeichnen(zustand = statCleanUiZustand()) {
    const host = $('stat-bereinigen');
    if (!host) return;
    const offen = zustand.offen;
    const o = sessionStore();
    let raw;
    try { raw = localStorage.getItem(SESSION_STORE); } catch (e) { statCleanFehler(e); return; }
    const autos = statCleanAutos(o);
    const ids = [...autos.keys()].sort((a, b) => String(autos.get(a)).localeCompare(String(autos.get(b))));
    const esc = statCleanEsc;
    const txt = statCleanT;
    const backup = null; // Status nach dem Neuaufbau asynchron laden.
    host.innerHTML = '<details class="stat-clean"' + (offen ? ' open' : '') + '><summary>'
      + esc(txt('Statistiken bereinigen')) + ' <span class="wip-tag">WIP</span>'
      + ' <button type="button" class="opt-info-btn" id="stat-clean-info" aria-label="'
      + esc(txt('Erklärung anzeigen')) + '">i</button></summary>'
      + '<p id="stat-clean-refresh-info" class="stat-clean-note" aria-live="polite">'
      + esc(txt('Gespeichert: {a} Fahrzeug(e), {s} Sitzung(en).', { a: ids.length, s: o.sessions.length })) + '</p>'
      + '<label for="stat-clean-car">' + esc(txt('Fahrzeugstatistik entfernen')) + '</label>'
      + '<select id="stat-clean-car"><option value="">' + esc(txt('Auto auswählen …')) + '</option>'
      + ids.map((id, i) => '<option value="' + i + '">' + esc(autos.get(id) + ' [' + id + ']') + '</option>').join('')
      + '</select><p class="stat-clean-preview" id="stat-clean-car-preview"></p>'
      + '<button type="button" class="stat-clean-danger" id="stat-clean-car-delete" disabled>'
      + esc(txt('Ausgewählte Fahrzeugstatistik löschen')) + '</button>'
      + '<label for="stat-clean-session">' + esc(txt('Einzelne Sitzung löschen')) + '</label>'
      + '<select id="stat-clean-session"><option value="">' + esc(txt('Sitzung auswählen …')) + '</option>'
      + o.sessions.map((s, i) => {
        const laps = (s.autos || []).flatMap((a) => a.laps || []);
        const best = laps.length ? ' · ' + txt('beste {z}', { z: sessionFmt(Math.min(...laps)) }) : '';
        const mode = RACE_MODES[s.modus] ? t(RACE_MODES[s.modus].label) : s.modus;
        return { i, label: (s.zeit || '?') + ' · ' + mode + ' · '
          + (s.autos || []).map((a) => a.name).join(', ') + ' · ' + txt('{n} Runde(n)', { n: laps.length })
          + best + (s.strecke ? ' · ' + s.strecke : '') };
      }).reverse().map((s) => '<option value="' + s.i + '">' + esc(s.label) + '</option>').join('')
      + '</select><p class="stat-clean-preview" id="stat-clean-session-preview"></p>'
      + '<button type="button" class="stat-clean-danger" id="stat-clean-session-delete" disabled>'
      + esc(txt('Ausgewählte Sitzung löschen')) + '</button>'
      + statCleanZeitenHtml(o)
      + '<div class="stat-clean-actions"><button type="button" id="stat-clean-refresh">'
      + esc(txt('Anzeige aktualisieren')) + '</button>'
      + '<button type="button" id="stat-clean-undo"' + (backup ? '' : ' disabled') + '>'
      + esc(txt('Letzte Bereinigung rückgängig')) + '</button>'
      + '<button type="button" id="stat-clean-backup"' + (backup ? '' : ' disabled') + '>'
      + esc(txt('Statistik-Sicherung als JSON')) + '</button></div>'
      + (Object.values(o.cars).some((c) => c.besteSeitBereinigung) ? '<p class="stat-clean-note">' + esc(txt(
        'Hinweis: Zurückgesetzte Fahrzeug-Bestzeiten werden seit der Bereinigung neu geführt; ältere, nicht mehr gespeicherte Runden sind unbekannt.')) + '</p>' : '')
      + '<p id="stat-clean-status" role="status" aria-live="polite"></p></details>';

    $('stat-clean-info').addEventListener('click', (e) => {
      // Im <summary>: ohne preventDefault klappt der Knopf den Bereich mit auf oder zu.
      e.preventDefault(); e.stopPropagation();
      if (typeof optInfoOeffnen === 'function') {
        optInfoOeffnen(txt('Statistiken bereinigen'),
          STAT_CLEAN_INFO.map((p) => '<p>' + esc(txt(p)) + '</p>').join(''));
      }
    });

    function verdrahten(selId, previewId, buttonId, art, keyVon) {
      const sel = $(selId), preview = $(previewId), button = $(buttonId);
      let plan = null, key;
      sel.addEventListener('change', () => {
        plan = null; button.disabled = true; preview.textContent = '';
        if (sel.value === '') return;
        try {
          key = keyVon(Number(sel.value));
          plan = statCleanPlan(o, art, key);
          preview.textContent = statCleanBericht(plan.bericht);
          button.disabled = statCleanGesperrt();
        } catch (e) { statCleanFehler(e); }
      });
      button.addEventListener('click', async () => {
        if (!plan) return;
        try {
          statCleanAktuell(raw);
          const label = art === 'auto' ? autos.get(key) + ' [' + key + ']'
            : (o.sessions[key].zeit || '?') + ' · ' + (o.sessions[key].autos || []).map((a) => a.name).join(', ');
          if (!confirm(txt('Wirklich löschen: {x}?', { x: label }) + '\n\n'
              + statCleanBericht(plan.bericht) + '\n\n'
              + txt('Der vorherige Statistikstand wird lokal gesichert. Garagendaten bleiben erhalten.'))) return;
          await statCleanAnwenden(raw, plan, art + ': ' + label,
            txt('Statistik gelöscht: {x}. Lokale Sicherung erstellt.', { x: label }));
        } catch (e) { statCleanFehler(e); }
      });
    }
    verdrahten('stat-clean-car', 'stat-clean-car-preview', 'stat-clean-car-delete', 'auto', (i) => ids[i]);
    verdrahten('stat-clean-session', 'stat-clean-session-preview', 'stat-clean-session-delete', 'sitzung', (i) => i);
    statCleanZeitenVerdrahten(o, raw, zustand);
    $('stat-clean-refresh').addEventListener('click', () => {
      try { statCleanAuffrischen(); } catch (e) { statCleanFehler(e); }
    });
    $('stat-clean-undo').addEventListener('click', async () => { try { await statCleanUndo(); } catch (e) { statCleanFehler(e); } });
    $('stat-clean-backup').addEventListener('click', async () => {
      try {
        const b = await statCleanBackupLesen();
        if (!b) throw new Error(statCleanT('Keine Statistik-Sicherung vorhanden.'));
        // Vorheriger Statistikstand im Format des EXISTIERENDEN Sicherungsimports.
        // Import fuehrt nur diese Ablage zurueck; aktuelle Garagen-/Reglerdaten bleiben.
        const ums = { typ: SICHERUNG_TYP, version: SICHERUNG_VERSION,
          erstellt: b.erstellt, regler: {}, ablagen: { [SESSION_STORE]: b.vorher || '{"cars":{},"sessions":[],"kmV":2}' } };
        for (const [key, pair] of Object.entries(b.extra || {})) ums.ablagen[key] = pair.vorher || '{}';
        const url = URL.createObjectURL(new Blob([JSON.stringify(ums, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url;
        a.download = 'omegasim-statistik-sicherung-' + new Date(b.erstellt).toISOString().replace(/[:.]/g, '-') + '.json';
        a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (e) { statCleanFehler(e); }
    });
    const undoButton = $('stat-clean-undo'), backupButton = $('stat-clean-backup');
    statCleanBackupLesen().then(b => {
      if (undoButton.isConnected) undoButton.disabled = !b;
      if (backupButton.isConnected) backupButton.disabled = !b;
    }).catch(e => {
      if (undoButton.isConnected) statCleanFehler(e);
    });
  }

  // Zusammengesetzte Texte (Zahlen in Saetzen) erreicht der Textknoten-Uebersetzer nicht;
  // beim Sprachwechsel deshalb neu zeichnen, wenn der Bereich schon steht.
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => {
    const host = $('stat-bereinigen');
    if (host && host.childElementCount) statBereinigungZeichnen();
  });
