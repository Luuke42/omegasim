  // ====================================================================================
  // ONLINE-STRECKENZEITEN (v1.3.15, WIP): Bestzeit und beste 3 Runden fuer JEDE Strecke
  // ====================================================================================
  //
  // BESTELLT: "Ich moechte die Moeglichkeit, Statistiken (wie bei Challenges, also Bestzeiten
  // und beste 3 Runden) fuer jede eingegebene Strecke abzurufen. In den Optionen soll es
  // Online-Optionen geben, darin wie im Challenges-Menue der Name und Option, dass Zeiten online
  // synchronisierbar werden. Standardmaessig aus. Es soll ein Pop-up-Menue kommen, wenn zum
  // ersten Mal eine Strecke im Editor erstellt wurde, mit Frage, ob die Zeiten online gespeichert
  // werden sollen, und sagen, dass der Name und die Strecke dann oeffentlich gespeichert werden.
  // Fuege im Challenges-Menue ein Menue ein, wo alle Strecken, zu denen mehr als 3 verschiedene
  // Leute eine Zeit gefahren haben, aufgelistet werden. Ich will meine lokal gespeicherten Zeiten
  // auch mit den Online-Zeiten [sehen], wenn ich meine nicht online teile."
  //
  // NACHBESSERUNG (nach 1.3.20) BESTELLT: "Gespiegelt sollte dieselbe sein, rueckwaerts eine
  // andere." / "In Challenges -> Community-Strecken sollten auch noch die stehen, die beigetragen
  // wurden." / "Bitte auch die Fahr-Presets (Pacejka und so) beruecksichtigen."
  //
  // DER SCHLUESSEL EINER STRECKE (skSchluessel, eigener Schluessel nur fuer diese Zeiten):
  //   - Streckencode OHNE Drehung (trackToCode(tiles, 0)): die Drehung ist nur die Lage der Karte.
  //   - Von Code und Code des SPIEGELBILDS (skSpiegelLR: jedes Teil links/rechts getauscht, die
  //     Reihenfolge bleibt) gilt der kleinere. Ein Spiegelbild ist dieselbe Strecke.
  //   - RUECKWAERTS gefahren (Reihenfolge umgekehrt) ist eine ANDERE Strecke.
  //   - Die Lage von Start/Ziel bleibt Teil des Codes.
  // bestzeitSchluessel() (70-race.js) bleibt unveraendert: an ihm haengen die lokalen Time-Attack-
  // Bestzeiten, die Telemetrie und die Statistik-Bereinigung; ein anderer Schluessel dort wuerde
  // gespeicherte Daten verwaisen lassen. Das Apps Script rechnet denselben Schluessel (stSchluessel)
  // und beim Lesen neu, statt der gespeicherten Spalte zu trauen.
  //
  // FAHRGEFUEHL: Jede Zeit traegt das Preset, mit dem sie gefahren wurde (presetAktiv(),
  // 98-presets.js; 'eigen' bei einer eigenen Abstimmung, 'unbekannt' bei Eintraegen von vor der
  // Nachbesserung). Bestzeit und beste 3 Runden werden je Fahrgefuehl verglichen.
  //
  // LATENZ: Im Rennen wird je Runde und je gelesenem Teil nur ein Wert an ein Feld gehaengt
  // (skRunde, skTeilGelesen). Pruefen, Speichern und Senden laufen erst nach dem Rennen
  // (skSitzungEnde -> setTimeout), Abrufe nur beim Oeffnen einer Ansicht, mit Zwischenspeicher.
  const SK_STORE = 'omegasim-strecken-zeiten';
  const SK_STORE_V = 'omegasim-strecken-zeiten-v';
  const SK_OPT_STORE = 'omegasim-strecken-online';
  const SK_CACHE_STORE = 'omegasim-strecken-cache';
  // v1.3.25 BESTELLT: "Nicht nur Strecken mit 3 Personen anzeigen, sondern alle." Vorher 4.
  const SK_MIN_FAHRER = 1;
  const SK_LISTE_MS = 5 * 60000;           // Community-Strecken hoechstens alle 5 min holen
  const SK_ZEITEN_MS = 2 * 60000;          // Zeiten einer Strecke hoechstens alle 2 min
  // Alle Presets aus 98-presets.js plus 'eigen' und 'unbekannt'. Dieselbe Liste steht im Apps
  // Script (ST_FAHRGEFUEHLE); der Selbsttest prueft, dass jedes Preset darin steht.
  const SK_FAHRGEFUEHLE = ['arcade', 'simplus', 'propacejka', 'gran', 'acc', 'pro', 'gt3', 'f1', 'realgt3',
                           'omega', 'rc', 'eigen', 'unbekannt'];

  // ---- Einstellungen: Schalter (Standard AUS) und die einmalige Frage ----
  function skOpt() {
    const o = chLesen(SK_OPT_STORE, {});
    return { sync: !!(o && o.sync === true), gefragt: !!(o && o.gefragt === true) };
  }
  function skOptSetzen(teil) {
    chSchreiben(SK_OPT_STORE, Object.assign(skOpt(), teil));
    skOptZeichnen();
  }
  function skSyncAn() { return skOpt().sync; }
  function skUrl() { const o = chOnline(); return o && o.url ? o.url : ''; }

  // ---- Schluessel: Spiegelbild = dieselbe Strecke, rueckwaerts = eine andere ----
  function skSpiegelLR(tiles) {
    const tausch = {
      [TILE_TYPE.CURVE_LEFT]: TILE_TYPE.CURVE_RIGHT, [TILE_TYPE.CURVE_RIGHT]: TILE_TYPE.CURVE_LEFT,
      [TILE_TYPE.HAIRPIN]: TILE_TYPE.HAIRPIN_LEFT, [TILE_TYPE.HAIRPIN_LEFT]: TILE_TYPE.HAIRPIN,
      [TILE_TYPE.WEIT_RIGHT]: TILE_TYPE.WEIT_LEFT, [TILE_TYPE.WEIT_LEFT]: TILE_TYPE.WEIT_RIGHT,
      [TILE_TYPE.KLEIN_RIGHT]: TILE_TYPE.KLEIN_LEFT, [TILE_TYPE.KLEIN_LEFT]: TILE_TYPE.KLEIN_RIGHT,
    };
    return tiles.map((x) => (tausch[x.type] !== undefined ? Object.assign({}, x, { type: tausch[x.type] }) : x));
  }
  function skSchluessel(tiles) {
    const a = trackToCode(tiles, 0), b = trackToCode(skSpiegelLR(tiles), 0);
    return a < b ? a : b;
  }
  function skSchluesselAusCode(code) {
    const p = codeToTrack(code);
    return p && p.tiles.length >= 3 ? skSchluessel(p.tiles) : '';
  }

  // ---- Fahrgefuehl ----
  function skFgGueltig(fg) { return SK_FAHRGEFUEHLE.indexOf(fg) >= 0 ? fg : 'unbekannt'; }
  // Das aktuelle Fahrgefuehl des Spielers. presetRead() liest alle Regler - nur nach dem Rennen
  // und beim Zeichnen einer Ansicht rufen, nie im Fahrtakt.
  function skFgAktuell() {
    let k = null;
    try { k = typeof presetAktiv === 'function' ? presetAktiv() : null; } catch (e) { k = null; }
    return k && SK_FAHRGEFUEHLE.indexOf(k) >= 0 ? k : 'eigen';
  }
  function skFgName(fg) {
    if (fg === 'eigen') return t('Eigene Abstimmung');
    if (fg === 'unbekannt') return t('unbekannt');
    return typeof window.__presetLabel === 'function' ? t(window.__presetLabel(fg)) : fg;
  }

  // Ein Name: derselbe Wert wie der Name der Challenges-Bestenliste (CH_ONLINE_STORE).
  function skNameSetzen(name) {
    const o = chOnline();
    o.fahrer = String(name || '').trim().slice(0, 16);
    chSchreiben(CH_ONLINE_STORE, o);
    ['ch-fahrer', 'ch-name', 'on-fahrer'].forEach((id) => { const el = $(id); if (el && document.activeElement !== el) el.value = o.fahrer; });
  }
  function skOptZeichnen() {
    const n = $('on-fahrer'), s = $('on-sync');
    if (n && document.activeElement !== n) n.value = chOnline().fahrer || '';
    if (s) s.checked = skSyncAn();
  }
  // BESTELLT: beim ersten Speichern einer Strecke im Editor einmal fragen. Ja schaltet das
  // Synchronisieren ein, Nein laesst es aus; gefragt wird nur einmal (gemerkt). Rueckgabe true,
  // wenn die Frage gezeigt wurde.
  function skErsteStreckeFrage() {
    const o = skOpt();
    if (o.gefragt) return false;
    chSchreiben(SK_OPT_STORE, Object.assign(o, { gefragt: true }));
    if (o.sync) return false;
    konsoleFrage(t('Zeiten online speichern?'),
      t('Zeiten zu dieser Strecke online speichern? Dann werden dein Name und die Strecke öffentlich gespeichert.')
        + '\n' + t('Ändern kannst du das jederzeit unter Optionen > Online.'),
      [[t('Ja, online speichern'), () => {
         const feld = $('k-frage-eingabe-feld');
         const name = ((feld ? feld.value : '') || kFrageWert || '').trim();
         if (name) skNameSetzen(name);
         skOptSetzen({ sync: true });
         showHudToast(t('Zeiten werden online gespeichert'));
       }],
       [t('Nein, nur lokal'), () => skOptZeichnen()]], true, null,
      { label: t('Name in der Bestenliste'), wert: chOnline().fahrer || '' });
    return true;
  }

  // ---- Aufzeichnen im Rennen (nur Felder fuellen) ----
  let skLauf = null;          // { tiles, runden: [{ ms, gelesen, ungueltig }] }
  let skGelesen = [];         // gelesene Teile seit der letzten Ueberfahrt
  function skTeilGelesen(code) {
    if (raceState !== 'racing' && raceState !== 'finishing') { if (skGelesen.length) skGelesen = []; return; }
    if (skGelesen.length < 400 && !isStartCode(code)) skGelesen.push(code);
  }
  // Aus playerLapCrossed(): Runde i (ab 0) ist gezaehlt, ms ihre Zeit, ungueltig = die
  // Rennmaschine selbst wertet sie nicht (unter der Mindestzeit).
  function skRunde(i, ms, ungueltig) {
    if (typeof challengeLaeuft === 'function' && challengeLaeuft()) { skLauf = null; skGelesen = []; return; }
    if (i === 0 || !skLauf) {
      const tiles = (typeof currentTrackTiles !== 'undefined' && currentTrackTiles) || [];
      skLauf = tiles.length >= 3 ? { tiles: tiles.slice(), runden: [] } : null;
    }
    const gelesen = skGelesen;
    skGelesen = [];
    if (!skLauf || skLauf.runden.length >= 200) return;
    skLauf.runden.push({ ms: Math.round(ms), gelesen, ungueltig: !!ungueltig });
  }
  // Aus finishRace() (nicht bei Challenges, die haben ihre eigenen Listen).
  function skSitzungEnde() {
    const lauf = skLauf;
    skLauf = null; skGelesen = [];
    if (!lauf || !lauf.runden.length) return;
    setTimeout(() => { try { skAuswerten(lauf); } catch (e) { log('Streckenzeiten: ' + e.message, 'warn'); } }, 1500);
  }
  // Dieselben Pruefungen wie die Challenges: Mindestrundenzeit aus der Laenge (chMinRundeMs) und
  // 90 % der Teile erkannt (chRundePruefen). Ungueltige Runden bleiben als 0 in der Folge stehen,
  // damit die 3er-Serie nur wirklich aufeinanderfolgende gueltige Runden zusammenzaehlt
  // (chDreierBeste verwirft jede Gruppe mit einer Runde unter der Mindestzeit).
  function skAuswerten(lauf) {
    const tiles = lauf.tiles;
    const code = trackToCode(tiles, 0);
    const def = { code, runden: 1 };
    const minMs = chMinRundeMs(def);
    let quote = 1;
    const runden = lauf.runden.map((r) => {
      if (r.ungueltig || !(r.ms >= minMs)) return 0;
      const pr = chRundePruefen(def, r.gelesen || []);
      if (!pr.ok) return 0;
      quote = Math.min(quote, pr.quote);
      return r.ms;
    });
    const gueltig = runden.filter((x) => x > 0);
    if (!gueltig.length) return null;
    const o = chOnline();
    const teilen = skSyncAn() && !!o.url;
    const e = { zeit: Math.min(...gueltig), runden, datum: Date.now(), fahrer: o.fahrer || '',
      auto: (typeof playerCar !== 'undefined' && playerCar) ? garageLabel(playerCar) : '', geraet: chGeraet(),
      quote: Math.round(quote * 100) / 100, geteilt: teilen, code,
      fahrgefuehl: skFgGueltig(lauf.fahrgefuehl || skFgAktuell()) };
    const key = skSchluessel(tiles);
    skLokalSpeichern(key, e);
    if (teilen) skHochladen(key, e, o);
    if (skSeiteOffen('edit')) skEditorZeichnen();
    return { key, eintrag: e, gesendet: teilen };
  }

  // ---- Lokale Zeiten ----
  // Einmalig: Ablagen aus 1.3.20 hatten den alten Schluessel (rueckwaerts = dieselbe). Neu
  // einsortiert nach dem gefahrenen Code, wenn er dabei ist, sonst nach dem alten Schluessel.
  function skMigrieren(d) {
    let v = null;
    try { v = localStorage.getItem(SK_STORE_V); } catch (e) { v = '2'; }
    if (v === '2') return d;
    const neu = {};
    Object.keys(d).forEach((k) => {
      (Array.isArray(d[k]) ? d[k] : []).forEach((e) => {
        const nk = skSchluesselAusCode(e.code || k) || k;
        (neu[nk] = neu[nk] || []).push(e);
      });
    });
    Object.keys(neu).forEach((k) => { neu[k].sort((a, b) => a.zeit - b.zeit); neu[k] = neu[k].slice(0, 30); });
    chSchreiben(SK_STORE, neu);
    try { localStorage.setItem(SK_STORE_V, '2'); } catch (e) { /* privat */ }
    return neu;
  }
  function skLokalAlle() {
    const d = chLesen(SK_STORE, {});
    return skMigrieren(d && typeof d === 'object' && !Array.isArray(d) ? d : {});
  }
  function skLokalSpeichern(key, e) {
    const alle = skLokalAlle();
    alle[key] = (Array.isArray(alle[key]) ? alle[key] : []).concat([e]).sort((a, b) => a.zeit - b.zeit).slice(0, 30);
    const keys = Object.keys(alle);
    if (keys.length > 200) {
      const neu = (k) => Math.max(0, ...alle[k].map((x) => x.datum || 0));
      keys.sort((a, b) => neu(b) - neu(a)).slice(200).forEach((k) => { delete alle[k]; });
    }
    chSchreiben(SK_STORE, alle);
  }
  // Eigene Zeiten dieser Strecke: die neue Ablage plus die Time-Attack-Bestzeiten
  // (omegasim-bestzeiten), deren gespeicherter Code auf denselben Schluessel fuehrt.
  function skLokal(key) {
    const eig = (skLokalAlle()[key] || []).map((z) => ({ zeit_ms: +z.zeit, fahrer: z.fahrer || '', auto: z.auto || '',
      geraet: z.geraet || chGeraet(), runden_ms: Array.isArray(z.runden) ? z.runden.map(Number) : [], quelle: 'lokal',
      fahrgefuehl: skFgGueltig(z.fahrgefuehl) }));
    const alle = typeof bestzeitLesen === 'function' ? bestzeitLesen() : {};
    Object.keys(alle).forEach((k) => {
      const bz = alle[k];
      if (!bz || !bz.fahrer || skSchluesselAusCode(bz.code || k) !== key) return;
      Object.values(bz.fahrer).forEach((f) => {
        if (f && f.beste > 0) eig.push({ zeit_ms: +f.beste, fahrer: chOnline().fahrer || '', auto: f.name || '',
          geraet: chGeraet(), runden_ms: [], quelle: 'lokal', fahrgefuehl: 'unbekannt' });
      });
    });
    return eig;
  }

  // ---- Senden: ueber die Warteschlange der Challenges (CH_AUSGANG, offline-fest) ----
  function skStreckenName(key) {
    try {
      const store = loadTrackStore();
      for (const name of Object.keys(store)) {
        const tl = migrateTiles((store[name].tiles || []).slice());
        if (tl.length >= 3 && skSchluessel(tl) === key) return name.slice(0, 32);
      }
    } catch (e) { /* ohne Namen */ }
    return '';
  }
  function skHochladen(key, e, o) {
    const p = codeToTrack(key);
    const eintrag = { art: 'strecke-zeit', strecke: key, code: e.code || key, teile: p ? p.tiles.length : 0,
      zeit_ms: Math.round(e.zeit), runden_ms: e.runden.map(Math.round), fahrer: e.fahrer, auto: String(e.auto || '').slice(0, 40),
      geraet: e.geraet, quote: e.quote, fahrgefuehl: skFgGueltig(e.fahrgefuehl), streckenname: skStreckenName(key),
      version: ($('app-version') || {}).textContent || '' };
    eintrag.nr = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    eintrag.url = o.url;
    chAusgangSchreiben(chAusgangLesen().concat([eintrag]));
    chAusgangZeichnen();
    if (!chNetzErlaubt()) { chSpaeter(); return; }
    chAusgangSenden();
  }
  // Aus chEintragSenden, wenn das Sheet eine Streckenzeit bestaetigt hat.
  function skNachUpload(key) {
    const z = skOnline.zeiten[key];
    if (z) z.at = 0;
    skOnline.listeAt = 0;
    if (skSeiteOffen('edit')) skEditorZeichnen();
    if (skSeiteOffen('ch-sk') && skDetail && skDetail.strecke === key) skDetailZeichnen();
  }

  // ---- Online lesen (auch mit Schalter AUS: Lesen schickt nichts Persoenliches) ----
  const skOnline = { liste: null, listeAt: 0, listeLaedt: false, listeFehler: false, zeiten: {} };
  let skCacheGeladen = false;
  function skCacheLaden() {
    if (skCacheGeladen) return;
    skCacheGeladen = true;
    const c = chLesen(SK_CACHE_STORE, null);
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c.liste) && !skOnline.liste) { skOnline.liste = c.liste; skOnline.listeAt = 0; }
    if (c.zeiten && typeof c.zeiten === 'object') {
      Object.keys(c.zeiten).forEach((k) => {
        const z = c.zeiten[k];
        if (!skOnline.zeiten[k] && z && Array.isArray(z.zeiten)) skOnline.zeiten[k] = { zeiten: z.zeiten, at: 0, stand: z.stand || 0 };
      });
    }
  }
  function skCacheSchreiben() {
    const keys = Object.keys(skOnline.zeiten).filter((k) => Array.isArray(skOnline.zeiten[k].zeiten))
      .sort((a, b) => (skOnline.zeiten[b].stand || 0) - (skOnline.zeiten[a].stand || 0)).slice(0, 30);
    const zeiten = {};
    keys.forEach((k) => { zeiten[k] = { zeiten: skOnline.zeiten[k].zeiten.slice(0, 100), stand: skOnline.zeiten[k].stand || 0 }; });
    try { localStorage.setItem(SK_CACHE_STORE, JSON.stringify({ liste: skOnline.liste, zeiten })); } catch (e) { /* voll */ }
  }
  function skGet(query) {
    const url = skUrl();
    if (!url) return Promise.reject(new Error('keine Adresse'));
    const holen = () => fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + query, { cache: 'no-store' }).then((r) => r.json());
    // Einmal wiederholen: dieselbe sporadische 404 der Google-Echo-Seite wie bei den Challenges.
    return holen().catch(() => new Promise((ok) => setTimeout(ok, 1200)).then(holen));
  }
  // Community-Strecken: ?strecken=1&geraet=<g> -> { ok, strecken: [{ strecke, name, fahrer, beste_ms,
  // beste_fahrer, laeufe, eigene, je: { <fahrgefuehl>: { fahrer, beste_ms, beste_fahrer } } }] }.
  // Die Geraetekennung (zufaellig, ohne Personenbezug, geht ohnehin mit jeder Zeit mit) laesst den
  // Server auch eigene Strecken mit weniger Fahrern liefern.
  function skListeHolen(frisch) {
    skCacheLaden();
    if (!skUrl() || skOnline.listeLaedt || !chNetzErlaubt()) return Promise.resolve(skOnline.liste);
    if (!frisch && skOnline.liste && Date.now() - skOnline.listeAt < SK_LISTE_MS) return Promise.resolve(skOnline.liste);
    skOnline.listeLaedt = true;
    return skGet('strecken=1&geraet=' + encodeURIComponent(chGeraet())).then((j) => {
      if (!j || !j.ok || !Array.isArray(j.strecken)) throw new Error((j && j.fehler) || 'keine Antwort');
      skOnline.liste = j.strecken; skOnline.listeFehler = false;
      skCacheSchreiben();
    }).catch(() => { skOnline.listeFehler = true; })
      .then(() => { skOnline.listeLaedt = false; skOnline.listeAt = Date.now(); return skOnline.liste; });
  }
  // Zeiten einer Strecke: ?strecke=<code> -> { ok, strecke, anzahl, zeiten: [...] }
  function skZeitenHolen(key, frisch) {
    skCacheLaden();
    const z = skOnline.zeiten[key] || (skOnline.zeiten[key] = { zeiten: null, at: 0 });
    if (!skUrl() || z.laedt || !chNetzErlaubt()) return Promise.resolve(z);
    if (!frisch && z.zeiten && Date.now() - z.at < SK_ZEITEN_MS) return Promise.resolve(z);
    z.laedt = true;
    return skGet('strecke=' + encodeURIComponent(key)).then((j) => {
      if (!j || !j.ok || !Array.isArray(j.zeiten)) throw new Error((j && j.fehler) || 'keine Antwort');
      z.zeiten = j.zeiten; z.fehler = false; z.stand = Date.now(); z.anzahl = j.anzahl || j.zeiten.length;
      skCacheSchreiben();
    }).catch(() => { z.fehler = true; })
      .then(() => { z.laedt = false; z.at = Date.now(); return z; });
  }

  // ---- Zusammenfuehren: online + lokal in EINER Liste ----
  function skAlleZeiten(key) {
    const on = skOnline.zeiten[key];
    const online = on && Array.isArray(on.zeiten) ? on.zeiten.map((z) => ({ zeit_ms: +z.zeit_ms, fahrer: String(z.fahrer || ''),
      auto: String(z.auto || ''), geraet: String(z.geraet || ''), fahrgefuehl: skFgGueltig(z.fahrgefuehl),
      runden_ms: Array.isArray(z.runden_ms) ? z.runden_ms.map(Number) : [], quelle: 'online' })) : [];
    const da = (z) => online.some((x) => x.geraet === z.geraet && Math.abs(x.zeit_ms - z.zeit_ms) < 2);
    const lokal = skLokal(key).filter((z) => !da(z));
    return { eintraege: online.concat(lokal).filter((z) => z.zeit_ms > 0), online: !!(on && Array.isArray(on.zeiten)),
             laedt: !!(on && on.laedt), fehler: !!(on && on.fehler), stand: on ? on.stand : 0 };
  }
  // Je Fahrer (Geraet) die beste Runde, schnellste zuerst.
  function skBestzeiten(eintraege) {
    const beste = new Map();
    eintraege.forEach((z, i) => {
      const wer = z.geraet || ('?' + z.fahrer + '_' + i);
      if (!beste.has(wer) || z.zeit_ms < beste.get(wer).zeit_ms) beste.set(wer, z);
    });
    return [...beste.values()].sort((a, b) => a.zeit_ms - b.zeit_ms);
  }
  // Je Fahrer die beste Summe aus drei aufeinanderfolgenden gueltigen Runden.
  function skDreier(eintraege, minMs) {
    const beste = new Map();
    eintraege.forEach((z, i) => {
      const b = chDreierBeste(z.runden_ms, minMs);
      if (b === null) return;
      const wer = z.geraet || ('?' + z.fahrer + '_' + i);
      if (!beste.has(wer) || b < beste.get(wer).best) beste.set(wer, Object.assign({}, z, { best: b }));
    });
    return [...beste.values()].sort((a, b) => a.best - b.best);
  }
  // Eigene Strecken (lokal gespeicherte Zeiten) als Eintraege wie aus ?strecken=1.
  function skEigeneStrecken() {
    const alle = skLokalAlle();
    return Object.keys(alle).filter((k) => Array.isArray(alle[k]) && alle[k].length && codeToTrack(k)).map((k) => {
      const je = {};
      alle[k].forEach((e) => {
        const fg = skFgGueltig(e.fahrgefuehl);
        if (!je[fg] || e.zeit < je[fg].beste_ms) je[fg] = { fahrer: 1, beste_ms: +e.zeit, beste_fahrer: e.fahrer || '' };
      });
      const best = alle[k].reduce((a, b) => (a.zeit <= b.zeit ? a : b));
      return { strecke: k, name: skStreckenName(k), fahrer: 1, beste_ms: +best.zeit, beste_fahrer: best.fahrer || '',
               je, eigene: true, nurLokal: true };
    });
  }
  // Community-Strecken: alle mit MEHR als 3 verschiedenen Fahrern (auch wenn der Server mehr
  // schickt) und alle, zu denen dieses Geraet Zeiten beigetragen hat (online: eigene=true vom
  // Server, lokal: omegasim-strecken-zeiten). Meiste Fahrer zuerst, dann die schnellere Bestzeit.
  function skCommunityGefiltert(liste, eigene) {
    const raus = [];
    const gesehen = {};
    (Array.isArray(liste) ? liste : []).forEach((s) => {
      if (!s || typeof s.strecke !== 'string' || !codeToTrack(s.strecke)) return;
      const k = skSchluesselAusCode(s.strecke) || s.strecke;
      if (gesehen[k]) return;
      gesehen[k] = Object.assign({}, s, { strecke: k, eigene: !!s.eigene });
      raus.push(gesehen[k]);
    });
    (Array.isArray(eigene) ? eigene : []).forEach((s) => {
      if (gesehen[s.strecke]) { gesehen[s.strecke].eigene = true; if (!gesehen[s.strecke].name && s.name) gesehen[s.strecke].name = s.name; return; }
      gesehen[s.strecke] = s;
      raus.push(s);
    });
    return raus.filter((s) => (+s.fahrer || 0) >= SK_MIN_FAHRER || s.eigene)
      .sort((a, b) => ((+b.fahrer || 0) - (+a.fahrer || 0)) || ((+a.beste_ms || 0) - (+b.beste_ms || 0)));
  }

  // ---- Anzeige ----
  let skFgWahl = null;          // gewaehltes Fahrgefuehl in der Streckenansicht (null = das eigene aktuelle)
  function skSeiteOffen(key) { const p = $('sub-' + key); return !!(p && p.classList.contains('on')); }
  function skZelle(tr, txt, kl) {
    const td = document.createElement('td');
    td.textContent = txt;
    td.setAttribute('data-i18n-skip', '');
    if (kl) td.className = kl;
    tr.appendChild(td);
    return td;
  }
  function skWer(z) { return (z.fahrer || t('ohne Namen')) + (z.auto ? ' · ' + z.auto : ''); }
  function skMarke(td, z) {
    if (z.quelle !== 'lokal') return;
    const m = document.createElement('span');
    m.className = 'sk-lokal';
    m.textContent = t('nur lokal');
    td.appendChild(document.createTextNode(' '));
    td.appendChild(m);
  }
  // Zeichnet Fahrgefuehl-Auswahl, Status, Bestzeiten und beste 3 Runden einer Strecke in `host`.
  function skZeichnen(host, key) {
    if (!host) return;
    const p = codeToTrack(key);
    const minMs = p ? chMinRundeMs({ code: key, runden: 1 }) : 0;
    const a = skAlleZeiten(key);
    const aktuell = skFgAktuell();
    const wahl = skFgWahl || aktuell;
    // Chips: das eigene aktuelle Fahrgefuehl immer, dazu jedes, zu dem es Zeiten gibt.
    const fgs = [aktuell];
    a.eintraege.forEach((z) => { if (fgs.indexOf(z.fahrgefuehl) < 0) fgs.push(z.fahrgefuehl); });
    if (fgs.indexOf(wahl) < 0) fgs.push(wahl);
    fgs.sort((x, y) => SK_FAHRGEFUEHLE.indexOf(x) - SK_FAHRGEFUEHLE.indexOf(y));
    host.innerHTML = '';
    const chips = document.createElement('div');
    chips.className = 'sk-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('Fahrgefühl'));
    fgs.forEach((fg) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sk-chip' + (fg === wahl ? ' an' : '');
      b.dataset.fg = fg;
      b.setAttribute('aria-pressed', fg === wahl ? 'true' : 'false');
      b.setAttribute('data-i18n-skip', '');
      const n = new Set(a.eintraege.filter((z) => z.fahrgefuehl === fg).map((z) => z.geraet)).size;
      b.textContent = skFgName(fg) + (n ? ' (' + n + ')' : '');
      b.onclick = () => { skFgWahl = fg; skZeichnen(host, key); };
      chips.appendChild(b);
    });
    host.appendChild(chips);
    const eintraege = a.eintraege.filter((z) => z.fahrgefuehl === wahl);
    const st = document.createElement('p');
    st.className = 'muted sk-status';
    st.setAttribute('data-i18n-skip', '');
    const lokalN = eintraege.filter((z) => z.quelle === 'lokal').length;
    st.textContent = (!skUrl() ? t('Nur auf diesem Gerät (keine Online-Adresse eingestellt).')
      : a.laedt && !a.online ? t('Lade Bestenliste …')
      : a.online ? t('Online-Bestenliste') + ': ' + (eintraege.length - lokalN) + ' ' + t('Zeiten')
        + (a.stand ? ' · ' + t('Stand') + ' ' + new Date(a.stand).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) : '')
      : a.fehler ? t('Online-Bestenliste nicht erreichbar, hier stehen deine eigenen Zeiten.')
      : t('Lade Bestenliste …'))
      + (lokalN ? ' · ' + t('nur lokal') + ': ' + lokalN : '')
      + (skSyncAn() ? '' : ' · ' + t('Deine Zeiten werden nicht geteilt.'));
    host.appendChild(st);
    const ich = chGeraet();
    const tabelle = (kopf, zeilen, leer) => {
      const h = document.createElement('h3');
      h.className = 'ch-zweite';
      h.textContent = kopf;
      host.appendChild(h);
      const tb = document.createElement('table');
      tb.className = 'ch-tabelle';
      const body = document.createElement('tbody');
      tb.appendChild(body);
      host.appendChild(tb);
      if (!zeilen.length) {
        const tr = document.createElement('tr');
        const td = skZelle(tr, leer, 'muted');
        td.colSpan = 4;
        body.appendChild(tr);
      }
      return body;
    };
    const best = skBestzeiten(eintraege);
    const b1 = tabelle(t('Bestzeit'), best, t('Noch keine Zeit auf dieser Strecke.'));
    best.slice(0, 30).forEach((z, i) => {
      const tr = document.createElement('tr');
      if (z.geraet === ich) tr.className = 'du';
      skZelle(tr, String(i + 1));
      skMarke(skZelle(tr, skWer(z)), z);
      skZelle(tr, chZeit(z.zeit_ms));
      skZelle(tr, i ? '+' + chZahl((z.zeit_ms - best[0].zeit_ms) / 1000, 3) : '–');
      b1.appendChild(tr);
    });
    const drei = skDreier(eintraege, minMs);
    const b3 = tabelle(t('Beste 3 Runden'), drei, t('Noch keine 3er-Serie'));
    drei.slice(0, 30).forEach((z, i) => {
      const tr = document.createElement('tr');
      if (z.geraet === ich) tr.className = 'du';
      skZelle(tr, String(i + 1));
      skMarke(skZelle(tr, skWer(z)), z);
      skZelle(tr, chZeit(Math.round(z.best / 3)));
      skZelle(tr, i ? '+' + chZahl((z.best - drei[0].best) / 3000, 3) : '–');
      b3.appendChild(tr);
    });
    const hw = document.createElement('p');
    hw.className = 'muted ch-stats';
    hw.textContent = t('Durchschnitt der drei schnellsten aufeinanderfolgenden Runden.');
    host.appendChild(hw);
  }
  // Im Editor: die Zeiten der Strecke, die gerade im Editor ist.
  function skEditorZeichnen() {
    const host = $('sk-editor-inhalt');
    if (!host) return;
    const tiles = (typeof currentTrackTiles !== 'undefined' && currentTrackTiles) || [];
    if (tiles.length < 3) {
      host.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('Keine Strecke im Editor. Scanne oder baue zuerst eine Strecke.');
      host.appendChild(p);
      return;
    }
    const key = skSchluessel(tiles);
    skZeichnen(host, key);
    const z = skOnline.zeiten[key];
    if (skUrl() && !(z && z.laedt) && !(z && z.zeiten && Date.now() - z.at < SK_ZEITEN_MS)) {
      skZeitenHolen(key, false).then(() => { if (skSeiteOffen('edit')) skZeichnen($('sk-editor-inhalt'), key); });
    }
  }
  // Die Bestzeit einer Listenzeile: fuer das eigene aktuelle Fahrgefuehl, sonst die schnellste
  // ueberhaupt mit ihrem Fahrgefuehl.
  function skListenBestzeit(s, aktuell) {
    const je = s.je && typeof s.je === 'object' ? s.je : null;
    if (je && je[aktuell] && je[aktuell].beste_ms) return { ms: +je[aktuell].beste_ms, wer: je[aktuell].beste_fahrer || '', fg: aktuell };
    if (je) {
      let b = null;
      Object.keys(je).forEach((fg) => { if (je[fg] && je[fg].beste_ms && (!b || +je[fg].beste_ms < b.ms)) b = { ms: +je[fg].beste_ms, wer: je[fg].beste_fahrer || '', fg }; });
      if (b) return b;
    }
    return s.beste_ms ? { ms: +s.beste_ms, wer: s.beste_fahrer || '', fg: 'unbekannt' } : null;
  }
  // Challenges > Community (v1.3.62: die Strecken stehen in der gemeinsamen Liste mit den Community
  // Challenges, communityZeichnen in 72-challenges.js). Hier Statuszeile, Leertext und eine Zeile.
  function skListeStatus() {
    skCacheLaden();
    const liste = skCommunityGefiltert(skOnline.liste, skEigeneStrecken());
    return (!skUrl() ? t('Nur auf diesem Gerät (keine Online-Adresse eingestellt).')
      : skOnline.listeLaedt && !skOnline.liste ? t('Lade die gemeinsame Liste …')
      : skOnline.listeFehler && !skOnline.liste ? t('Gemeinsame Liste nicht erreichbar.')
      : t('Strecken mit Zeiten: {n}').replace('{n}', liste.filter((s) => (+s.fahrer || 0) >= SK_MIN_FAHRER).length))
      + ' · ' + t('Dein Fahrgefühl') + ': ' + skFgName(skFgAktuell());
  }
  function skListeLeerText() {
    return t('Noch keine Strecke mit Zeiten. Schalte unter Optionen > Online das Synchronisieren ein, damit deine Strecken hier erscheinen.');
  }
  function skZeile(s, aktuell) {
    const row = document.createElement('div');
    row.className = 'community-zeile';
    row.dataset.art = 'strecke';
    const auf = document.createElement('button');
    auf.type = 'button';
    auf.className = 'community-oeffnen';
    auf.setAttribute('aria-label', t('Strecke öffnen') + ': ' + (s.name || s.strecke));
    auf.onclick = () => skDetailOeffnen(s);
    const mini = document.createElement('span');
    mini.className = 'community-mini';
    mini.setAttribute('aria-hidden', 'true');
    try {
      const p = codeToTrack(s.strecke);
      if (p) { const merk = trackRotationDeg; trackRotationDeg = 0; try { mini.innerHTML = renderTrackPreview(p.tiles, null, {}).html; } finally { trackRotationDeg = merk; } }
    } catch (e) { /* ohne Bild */ }
    auf.appendChild(mini);
    const tx = document.createElement('div');
    tx.className = 'community-text';
    const b = document.createElement('b');
    b.setAttribute('data-i18n-skip', '');
    b.textContent = s.name ? s.name + ' · ' + s.strecke : s.strecke;
    if (s.eigene) {
      const m = document.createElement('span');
      m.className = 'community-modus sk-eigene';
      m.textContent = s.nurLokal ? t('eigene Zeiten') + ', ' + t('nur lokal') : t('eigene Zeiten');
      b.appendChild(document.createTextNode(' '));
      b.appendChild(m);
    }
    const em = document.createElement('em');
    em.setAttribute('data-i18n-skip', '');
    const bz = skListenBestzeit(s, aktuell);
    em.textContent = t('{n} Fahrer').replace('{n}', +s.fahrer || 0)
      + (bz ? ' · ' + t('Bestzeit') + ' ' + chZeit(bz.ms) + ' (' + (bz.wer ? bz.wer + ', ' : '') + skFgName(bz.fg) + ')' : '');
    tx.appendChild(b); tx.appendChild(em);
    auf.appendChild(tx);
    row.appendChild(auf);
    return row;
  }
  // Eine Strecke aus der Liste: Karte, Zeiten, In den Editor laden.
  let skDetail = null;
  function skDetailOeffnen(s) {
    skDetail = s;
    skFgWahl = null;
    showSubpage('ch-sk');
  }
  function skDetailZeichnen() {
    if (!skDetail) { showSubpage('ch-community'); return; }
    const key = skDetail.strecke;
    const p = codeToTrack(key);
    if ($('sk-titel')) $('sk-titel').textContent = skDetail.name || key;
    const karte = $('sk-karte');
    if (karte) {
      karte.innerHTML = '';
      try {
        if (p) { const merk = trackRotationDeg; trackRotationDeg = 0; try { karte.innerHTML = renderTrackPreview(p.tiles, null, { detailed: true, cars: [] }).html; } finally { trackRotationDeg = merk; } }
      } catch (e) { /* ohne Bild */ }
    }
    if ($('sk-fakten')) {
      $('sk-fakten').textContent = (skDetail.name ? skDetail.name + ' · ' : '') + t('Code') + ' ' + key + (p ? ' · ' + t('Länge') + ' ' + chZahl(trackLaengeM(p.tiles), 2) + ' m · '
        + p.tiles.length + ' ' + t('Teile') : '') + ' · ' + t('{n} Fahrer').replace('{n}', +skDetail.fahrer || 0);
    }
    skZeichnen($('sk-detail-inhalt'), key);
    const z = skOnline.zeiten[key];
    if (skUrl() && !(z && z.laedt) && !(z && z.zeiten && Date.now() - z.at < SK_ZEITEN_MS)) {
      skZeitenHolen(key, false).then(() => { if (skSeiteOffen('ch-sk') && skDetail && skDetail.strecke === key) skZeichnen($('sk-detail-inhalt'), key); });
    }
  }
  function skInEditorLaden() {
    if (!skDetail) return false;
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return false; }
    const p = codeToTrack(skDetail.strecke);
    if (!p) return false;
    currentTrackTiles = p.tiles;
    trackRotationDeg = 0;
    const rv = $('track-rotation-val');
    if (rv) rv.textContent = '0°';
    if ($('track-name')) $('track-name').value = skDetail.name || '';
    refreshTrackPreview();
    showHudToast(t('Strecke in den Editor geladen'));
    showTab('track');
    showSubpage('edit');
    return true;
  }

  // ---- Verdrahtung ----
  if ($('on-fahrer')) $('on-fahrer').addEventListener('change', () => skNameSetzen($('on-fahrer').value));
  if ($('on-sync')) $('on-sync').addEventListener('change', () => skOptSetzen({ sync: !!$('on-sync').checked, gefragt: true }));
  if ($('sk-zurueck')) $('sk-zurueck').addEventListener('click', () => showSubpage('ch-community'));
  if ($('sk-laden')) $('sk-laden').addEventListener('click', skInEditorLaden);
  if ($('sk-editor-auffrischen')) {
    $('sk-editor-auffrischen').addEventListener('click', () => {
      const tiles = currentTrackTiles || [];
      if (tiles.length < 3) { skEditorZeichnen(); return; }
      const key = skSchluessel(tiles);
      skZeitenHolen(key, true).then(() => skEditorZeichnen());
      skEditorZeichnen();
    });
  }
  skOptZeichnen();
