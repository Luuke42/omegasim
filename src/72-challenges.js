  // ============================== CHALLENGES (v0.8.30, experimentell) ==============================
  //
  // BESTELLT: "Implementiere Challenges". Der Plan dazu steht in mockup/challenges.html:
  //   - vier feste Strecken zum Nachbauen, zwei aus der Grundpackung, eine mit dem
  //     Haarnadel-Set, eine mit dem 30-Grad-Aussenkurven-Set;
  //   - je Strecke zwei Modi: BESTE RUNDE (beliebig viele Runden, die schnellste zaehlt) und
  //     RENNEN (feste Rundenzahl, die Gesamtzeit zaehlt) - BESTELLT: "Mach pro Strecke: beste
  //     Rundenzeit (unendlich viele Runden, beste wird gezaehlt) und das Rundenrennen";
  //   - je zwei Presets, Pro und Arcade: die Abstimmungen gleichen Namens aus 98-presets.js,
  //     dazu Steuerungsmodus Physik, trocken, voller Tank, keine Pflichtstopps, keine Ghosts;
  //   - "Auto muss stehen, dann kommt eine Ampel, dann los; die Zeit wird gespeichert";
  //   - Bestenliste mit Abstaenden, waagerechtes Histogramm (oben schnell), eigene Zeit
  //     markiert, "Du warst schneller als X % der Spieler".
  //
  // DIE RENNMASCHINE WIRD MITBENUTZT und nicht nachgebaut: Ampel (startRaceCountdown), Runden
  // (playerLapCrossed -> raceLapTimes), Ende (finishRace). Beste Runde laeuft als freies
  // Training MIT Ampel, das Rennen als Modus "Runden". Vier Haken in 70-race.js fragen
  // challengeLaeuft() bzw. rufen challengeRennenEnde(); sonst weiss die Rennmaschine nichts
  // von Challenges.
  //
  // WAS VORHER EINGESTELLT WAR, KOMMT DANACH ZURUECK: Regler, Rennmodus, Rundenzahl, Wetter,
  // Pflichtstopps, Tank, fliegender Start und die Strecke. Eine Challenge, die hinterher die
  // eigene Abstimmung ueberschrieben laesst, waere eine Falle.
  //
  // ONLINE-BESTENLISTE: ein Google Sheet mit Apps-Script-Web-App (Anleitung und Skript in
  // tools/challenges-apps-script.gs). Die App spricht nur ueber chHochladen() und
  // chListeLaden(); ein Umzug auf einen anderen Dienst aendert nur diese zwei.

  // NAMEN (v0.8.35): BESTELLT "Namen, die so aehnlich wie die von echten Rennstrecken sind (aber
  // anders), damit die nicht uebersetzt werden muessen" - Monza, Suzuka, Monte Carlo, Silverstone.
  const CHALLENGES = [
    // BESTELLT: "Ersetze das Oval noch durch SGR2GR2LGR3G". Es ist damit kein Oval mehr, daher
    // der neue Name. Geschlossen (Luecke 0,5 cm), 1,36 x 2,28 m, Grundpackung.
    { id: 'oval', name: 'Monzetta', code: 'SGR2GR2LGR3G', runden: 10, sets: ['grund'],
      idee: 'Zum Warmwerden: lange Gerade, ein kleiner Knick nach links, Bremspunkte lernen.' },
    { id: 'schlange', name: 'Suzuna', code: 'SRRRGLLRRRRGGGR', runden: 8, sets: ['grund'],
      idee: 'Die zwei Linkskurven bilden ein S. Wer dort sauber umlenkt, gewinnt.' },
    { id: 'kehre', name: 'Monte Carlito', code: 'SGRRRLHJRRRRG', runden: 8, sets: ['grund', 'haarnadel'],
      idee: 'Zwei Haarnadeln direkt hintereinander als enges S: voll in die Bremse, umlegen, sauber raus.' },
    { id: 'weitblick', name: 'Silverbrook', code: 'SQRRRWGQRRRW', runden: 8, sets: ['grund', 'dreissig'],
      idee: 'Lang und schmal: die weiten 30-Grad-Bögen machen die Längsseiten schnell.' },
  ];
  const CH_SET_NAME = { grund: 'Grundpackung', haarnadel: 'Haarnadel-Set', dreissig: '30°-Außenkurven-Set' };
  const CH_MODUS_NAME = { hotlap: 'Beste Runde', rennen: 'Rennen' };
  const CH_STORE = 'omegasim-challenges';
  const CH_ONLINE_STORE = 'omegasim-ch-online';
  // Die gemeinsame Bestenliste, fuer alle Kopien der App (btsr, omegasim, APK). BESTELLT: "Die
  // URL soll von beiden Repos genutzt werden." Unter Challenges > Online laesst sie sich
  // ueberschreiben; ein leeres Feld heisst "nur lokal".
  const CH_STANDARD_URL = 'https://script.google.com/macros/s/AKfycbxCgxLcORkrqnp1QU_9d3r1x6HuBor2ZlB6vFQFf1cT_noiVm_ePWPMWcKfbDsB7G-C/exec';
  const CH_GERAET_STORE = 'omegasim-geraet';
  const CH_STILL_MS = 1000;        // so lange muss das Auto stehen, bevor die Ampel kommt
  const CH_STILL_KMH = 1;
  const CH_FRUEHSTART_KMH = 3;     // dieselbe Schwelle wie raceMoveErkannt()

  let chWahl = 'oval', chModus = 'hotlap', chPreset = 'pro';
  let chLauf = null;               // laufende Challenge, siehe challengeStarten()
  let chWaechter = null;
  let chLetzt = null;              // letztes Ergebnis, fuer die Anzeige auf der Seite
  const chListen = {};             // Schluessel -> { zeiten, online, fehler, laedt }

  function chDef(id) { return CHALLENGES.find((c) => c.id === id) || CHALLENGES[0]; }
  function chSchluessel(id, modus, preset) { return id + '|' + modus + '|' + preset; }
  function chTiles(def) { const p = codeToTrack(def.code); return p ? p.tiles : []; }
  function challengeLaeuft() { return !!chLauf; }

  function chZeit(ms) {
    if (!Number.isFinite(ms)) return '–';
    const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
    const txt = m + ':' + s.toFixed(3).padStart(6, '0');
    return lang === 'en' ? txt : txt.replace('.', ',');
  }
  function chZahl(x, n) { const s = x.toFixed(n); return lang === 'en' ? s : s.replace('.', ','); }

  // Platzbedarf auf dem Boden in Metern, aus derselben Geometrie wie der Editor (Mittellinie
  // plus halbe Bahnbreite). Mit Drehung 0 gerechnet, unabhaengig von der Editor-Strecke.
  function chFlaeche(tiles) {
    const merk = trackRotationDeg;
    trackRotationDeg = 0;
    try {
      const pts = trackCenterline(tiles), nrm = trackNormals(pts);
      const xs = [], ys = [];
      pts.forEach((p, i) => {
        xs.push(p.x + nrm[i].x * TRACK_HALF_W, p.x - nrm[i].x * TRACK_HALF_W);
        ys.push(p.y + nrm[i].y * TRACK_HALF_W, p.y - nrm[i].y * TRACK_HALF_W);
      });
      const cm = (v) => v / TRACK_UNITS_PER_CM / 100;
      return [cm(Math.max(...xs) - Math.min(...xs)), cm(Math.max(...ys) - Math.min(...ys))];
    } finally { trackRotationDeg = merk; }
  }
  function chKarte(def, detailliert) {
    const merk = trackRotationDeg;
    trackRotationDeg = 0;
    try {
      return renderTrackPreview(chTiles(def), null,
        detailliert ? { detailed: true, echt: true, ohneLinie: true } : {}).html;
    } finally { trackRotationDeg = merk; }
  }

  // ---- Wertung, Rang, Verteilung: reine Rechnungen (Selbsttest) ----
  function chWertung(def, modus, rundenMs, flagge, fruehstart) {
    if (fruehstart) return { gueltig: false, zeit: null, grund: 'Frühstart' };
    if (modus === 'rennen') {
      if (!flagge || rundenMs.length < def.runden) {
        return { gueltig: false, zeit: null, grund: 'abgebrochen, nicht alle Runden gefahren' };
      }
      return { gueltig: true, zeit: rundenMs.slice(0, def.runden).reduce((a, b) => a + b, 0), grund: '' };
    }
    if (!rundenMs.length) return { gueltig: false, zeit: null, grund: 'keine volle Runde' };
    return { gueltig: true, zeit: Math.min(...rundenMs), grund: '' };
  }
  // Anteil der ANDEREN Zeiten, die langsamer sind als `zeit`, in Prozent.
  function chPerzentil(zeiten, zeit) {
    const andere = zeiten.filter((z) => z !== zeit);
    if (!andere.length) return 100;
    return Math.round(100 * andere.filter((z) => z > zeit).length / andere.length);
  }
  function chHistogramm(zeiten, n) {
    if (!zeiten.length) return [];
    const min = Math.min(...zeiten), max = Math.max(...zeiten);
    const k = n || Math.min(10, Math.max(3, Math.ceil(Math.sqrt(zeiten.length))));
    const w = (max - min) / k || 1;
    const klassen = Array.from({ length: k }, (_, i) => ({ von: min + i * w, bis: min + (i + 1) * w, anz: 0 }));
    zeiten.forEach((z) => { klassen[Math.min(k - 1, Math.floor((z - min) / w))].anz++; });
    return klassen;
  }

  // ---- Speicher: lokale Zeiten, Online-Einstellung, Geraetekennung ----
  function chLesen(schl, vorgabe) {
    try { return JSON.parse(localStorage.getItem(schl) || 'null') || vorgabe; } catch (e) { return vorgabe; }
  }
  function chSchreiben(schl, wert) {
    try { localStorage.setItem(schl, JSON.stringify(wert)); } catch (e) { /* privat */ }
  }
  function chGeraet() {
    let g = null;
    try { g = localStorage.getItem(CH_GERAET_STORE); } catch (e) { /* privat */ }
    if (!g) {
      g = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(CH_GERAET_STORE, g); } catch (e) { /* dann eben je Sitzung */ }
    }
    return g;
  }
  function chOnline() {
    return Object.assign({ url: CH_STANDARD_URL, fahrer: '', hochladen: true }, chLesen(CH_ONLINE_STORE, {}));
  }
  function chLokal(schl) { return (chLesen(CH_STORE, {})[schl] || []); }
  function chLokalSpeichern(erg) {
    const alle = chLesen(CH_STORE, {});
    const schl = chSchluessel(erg.id, erg.modus, erg.preset);
    const liste = (alle[schl] || []).concat([{ zeit: erg.zeit, runden: erg.runden, auto: erg.auto,
      fahrer: erg.fahrer, geraet: erg.geraet, datum: Date.now() }]);
    liste.sort((a, b) => a.zeit - b.zeit);
    alle[schl] = liste.slice(0, 30);
    chSchreiben(CH_STORE, alle);
  }

  // ---- Online ----
  function chHochladen(erg) {
    const o = chOnline();
    if (!o.url || !o.hochladen) return Promise.resolve(false);
    const def = chDef(erg.id);
    const eintrag = {
      challenge: erg.id, modus: erg.modus, preset: erg.preset, runden_soll: erg.modus === 'rennen' ? def.runden : 0,
      zeit_ms: Math.round(erg.zeit), runden_ms: erg.runden.map(Math.round), auto: erg.auto,
      fahrer: o.fahrer || '', geraet: chGeraet(), version: ($('app-version') || {}).textContent || '',
    };
    // text/plain und kein JSON-Kopf: so schickt der Browser keinen CORS-Vorabruf, den ein
    // Apps Script nicht beantworten kann.
    //
    // WIEDERHOLEN, GEMESSEN: Google leitet jede Antwort auf eine Echo-Seite um, und die kam im
    // Test sporadisch als 404 zurueck (derselbe Aufruf: 200, 404, 200). Das Skript ist dann
    // meist schon gelaufen, nur die Antwort fehlt. Deshalb bis zu zwei Wiederholungen, und
    // "zu schnell hintereinander" (die 15-s-Drossel je Geraet im Skript) heisst beim Wiederholen:
    // der erste Versuch ist angekommen. So entsteht keine doppelte Zeile.
    const senden = (versuch) => fetch(o.url, { method: 'POST', body: JSON.stringify(eintrag) })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.ok) return true;
        if (versuch > 0 && j && j.fehler === 'zu schnell hintereinander') return true;
        throw Object.assign(new Error((j && j.fehler) || 'abgelehnt'), { endgueltig: true });
      })
      .catch((e) => {
        if (!e.endgueltig && versuch < 2) return new Promise((ok) => setTimeout(ok, 1500)).then(() => senden(versuch + 1));
        log('Challenge: Hochladen fehlgeschlagen: ' + e.message, 'warn');
        return false;
      });
    return senden(0);
  }
  // ---- SCHNAPPSCHUSS AUS DEM REPO (v0.8.34) ----
  // BESTELLT: "das Google Sheet ab und zu in GitHub speichern per Action ... die lokalen + die
  // in der letzten Stunde gefetchten". Die Action (.github/workflows/challenges.yml) legt
  // stuendlich data/challenges.json ab; die App liest zuerst diese Datei (schnell, ohne Googles
  // Echo-Umleitung) und mischt die eigenen Zeiten dazu (chAlleZeiten). Nur fuer die gemeinsame
  // Liste - eine eigene Adresse steht nicht im Schnappschuss. Aelter als zwei Stunden, oder die
  // Datei fehlt (die Kopie auf luuke42 hat keine Action, die APK nur die mitgelieferte): dann
  // direkt beim Sheet fragen.
  const CH_SCHNAPPSCHUSS_MAX_MS = 2 * 3600 * 1000;
  let chSchnapp = null, chSchnappAt = 0;
  function chSchnappschuss() {
    if (chSchnapp && Date.now() - chSchnappAt < 10 * 60000) return chSchnapp;
    chSchnappAt = Date.now();
    chSchnapp = fetch('data/challenges.json?t=' + Math.floor(Date.now() / 600000))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.listen && Date.now() - Date.parse(j.stand) < CH_SCHNAPPSCHUSS_MAX_MS ? j : null))
      .catch(() => null);
    return chSchnapp;
  }
  function chListeLaden(schl, frisch) {
    const o = chOnline();
    if (!o.url) { chListen[schl] = { zeiten: null, online: false }; return Promise.resolve(); }
    chListen[schl] = Object.assign(chListen[schl] || {}, { laedt: true });
    const schnapp = !frisch && o.url === CH_STANDARD_URL ? chSchnappschuss() : Promise.resolve(null);
    return schnapp.then((j) => {
      const l = j && j.listen[schl];
      if (l) {
        chListen[schl] = { zeiten: l.zeiten || [], online: true, anzahl: l.anzahl || 0, stand: j.stand };
        if (chSeiteOffen()) chZeichneListe();
        return undefined;
      }
      return chListeLive(schl, o);
    });
  }
  function chListeLive(schl, o) {
    const [id, modus, preset] = schl.split('|');
    const url = o.url + (o.url.indexOf('?') >= 0 ? '&' : '?') + 'challenge=' + encodeURIComponent(id)
      + '&modus=' + encodeURIComponent(modus) + '&preset=' + encodeURIComponent(preset);
    // Einmal wiederholen: dieselbe sporadische 404 der Echo-Seite wie beim Hochladen.
    const holen = () => fetch(url).then((r) => r.json());
    return holen().catch(() => new Promise((ok) => setTimeout(ok, 1200)).then(holen)).then((j) => {
      if (!j || !j.ok) throw new Error((j && j.fehler) || 'keine Antwort');
      chListen[schl] = { zeiten: j.zeiten || [], online: true, anzahl: j.anzahl || 0, stand: null };
    }).catch((e) => {
      chListen[schl] = { zeiten: null, online: false, fehler: e.message };
    }).then(() => { if (chSeiteOffen()) chZeichneListe(); });
  }

  // ---- Einstellungen merken, setzen, zurueckstellen ----
  function chSetzen(id, wert) {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') { if (el.checked === !!wert) return; el.checked = !!wert; }
    else { if (String(el.value) === String(wert)) return; el.value = wert; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function chMerken() {
    return {
      regler: presetRead(), modus: $('race-mode').value, limit: raceLimit,
      wx: $('race-wx-start').value, pit: $('race-pit-required').value,
      tank: $('race-fuel-start').value, fliegend: $('race-flying').checked,
      tiles: currentTrackTiles, rot: trackRotationDeg,
    };
  }
  function chAnwenden(def, modus, preset) {
    applyPreset(preset);
    chSetzen('phys-mode', 'physik');
    chSetzen('race-mode', modus === 'rennen' ? 'laps' : 'practice');
    raceLimit = def.runden;
    $('race-limit').value = def.runden;
    chSetzen('race-wx-start', 'dry');
    chSetzen('race-pit-required', '0');
    chSetzen('race-fuel-start', FUEL_TANK_LITERS);
    chSetzen('race-flying', false);
    currentTrackTiles = chTiles(def);
    trackRotationDeg = 0;
    trackSel = null;
    refreshTrackPreview();
  }
  function chZuruecksetzen(m) {
    if (!m) return;
    for (const [id, wert] of Object.entries(m.regler)) chSetzen(id, wert);
    chSetzen('race-mode', m.modus);
    raceLimit = m.limit;
    $('race-limit').value = m.limit;
    chSetzen('race-wx-start', m.wx);
    chSetzen('race-pit-required', m.pit);
    chSetzen('race-fuel-start', m.tank);
    chSetzen('race-flying', m.fliegend);
    currentTrackTiles = m.tiles;
    trackRotationDeg = m.rot;
    trackSel = null;
    refreshTrackPreview();
  }

  // ---- Ablauf: starten, auf Stillstand warten, Ampel, fahren, werten ----
  function challengeStarten(ohneAuto) {
    if (chLauf) return;
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return; }
    if (!playerCar && !ohneAuto) {
      konsoleFrage(t('Kein Auto verbunden'),
        t('Für eine Challenge muss dein Auto verbunden sein. Ein Probelauf ohne Auto zeigt den Ablauf, wird aber nicht gewertet.'),
        [[t('Auto verbinden'), () => konsoleVerbinden()],
         [t('Probelauf'), () => challengeStarten(true)],
         [t('Abbrechen'), null]], true);
      return;
    }
    const def = chDef(chWahl);
    chLauf = { id: def.id, modus: chModus, preset: chPreset, phase: 'stehen', stillSeit: 0,
               hinweisAt: 0, fruehstart: false, probe: !playerCar, merk: chMerken() };
    chAnwenden(def, chModus, chPreset);
    showTab('race');
    showHudToast(t('Auto auf Start/Ziel stellen und anhalten'));
    clearInterval(chWaechter);
    chWaechter = setInterval(chWachen, 100);
    chZeichneDetail();
  }
  function chTempo() {
    try { return Math.abs(physEngine.state.speedKmh || 0); } catch (e) { return 0; }
  }
  function chWachen() {
    if (!chLauf) { clearInterval(chWaechter); chWaechter = null; return; }
    const v = chTempo(), jetzt = Date.now();
    if (chLauf.phase === 'stehen') {
      if (v < CH_STILL_KMH) {
        if (!chLauf.stillSeit) chLauf.stillSeit = jetzt;
        if (jetzt - chLauf.stillSeit >= CH_STILL_MS) {
          chLauf.phase = 'ampel';
          startRaceCountdown();
        }
      } else {
        chLauf.stillSeit = 0;
        if (jetzt - chLauf.hinweisAt > 2500) { chLauf.hinweisAt = jetzt; showHudToast(t('Auto anhalten')); }
      }
    } else if (chLauf.phase === 'ampel') {
      if (raceState === 'countdown' && v > CH_FRUEHSTART_KMH) {
        chLauf.fruehstart = true;
        requestRaceStop();
        showHudToast(t('Frühstart! Challenge abgebrochen'));
      } else if (raceState === 'racing') {
        chLauf.phase = 'faehrt';
      }
    }
  }
  // Die Rennen-Taste (R1, Knopf im Cockpit) waehrend des Wartens auf Stillstand: abbrechen,
  // statt die Ampel ohne Pruefung zu starten.
  function challengeToggle() {
    if (!chLauf || chLauf.phase !== 'stehen') return false;
    challengeAbbrechen();
    return true;
  }
  function challengeAbbrechen() {
    if (!chLauf) return;
    const m = chLauf.merk;
    chLauf = null;
    clearInterval(chWaechter); chWaechter = null;
    chZuruecksetzen(m);
    showHudToast(t('Challenge abgebrochen'));
    chZeichneDetail();
  }

  // Aus finishRace(): true heisst "die Challenge zeigt ihr Ergebnis selbst".
  function challengeRennenEnde(flagge) {
    if (!chLauf) return false;
    const lauf = chLauf;
    chLauf = null;
    clearInterval(chWaechter); chWaechter = null;
    const def = chDef(lauf.id);
    const rundenMs = raceLapTimes.map((l) => l.ms);
    const w = chWertung(def, lauf.modus, rundenMs, flagge, lauf.fruehstart);
    if (lauf.probe && w.gueltig) { w.gueltig = false; w.grund = 'Probelauf ohne Auto'; }
    const erg = Object.assign({ id: lauf.id, modus: lauf.modus, preset: lauf.preset, runden: rundenMs,
      auto: playerCar ? garageLabel(playerCar) : '', fahrer: chOnline().fahrer, geraet: chGeraet() }, w);
    chZuruecksetzen(lauf.merk);
    chLetzt = erg;
    const schl = chSchluessel(erg.id, erg.modus, erg.preset);
    if (erg.gueltig) {
      chLokalSpeichern(erg);
      chHochladen(erg).then(() => chListeLaden(schl)).then(() => chZeichneDetail());
    }
    // Das Ergebnis im Cockpit als Frage, mit dem Pad bedienbar: ansehen, nochmal, schliessen.
    setTimeout(() => {
      const titel = erg.gueltig
        ? (erg.modus === 'hotlap' ? t('Beste Runde') : t('Gesamtzeit')) + ': ' + chZeit(erg.zeit)
        : t('Nicht gewertet');
      const text = erg.gueltig ? chRangText(schl, erg.zeit) : t(erg.grund);
      konsoleFrage(titel, text, [
        [t('Ergebnis ansehen'), () => konsoleZeige('challenges', 'ch-' + erg.id)],
        [t('Nochmal'), () => { chWahl = erg.id; chModus = erg.modus; chPreset = erg.preset; challengeStarten(); }],
        [t('Schließen'), null]]);
    }, 900);
    chZeichneDetail();
    return true;
  }

  // ---- Anzeige ----
  // Online-Liste (Schnappschuss oder direkt) PLUS die eigenen Zeiten dieses Geraets, die dort
  // noch fehlen - so steht ein eben gefahrener Lauf sofort in der Liste, auch wenn der
  // Schnappschuss eine Stunde alt ist.
  function chAlleZeiten(schl) {
    const l = chListen[schl];
    const lok = chLokal(schl).map((z) => ({ zeit_ms: z.zeit, auto: z.auto, fahrer: z.fahrer, geraet: z.geraet }));
    if (l && l.online && l.zeiten) {
      const da = (z) => l.zeiten.some((x) => x.geraet === z.geraet && Math.abs(+x.zeit_ms - z.zeit_ms) < 2);
      const eintraege = l.zeiten.concat(lok.filter((z) => !da(z)));
      return { zeiten: eintraege.map((z) => +z.zeit_ms), online: true, eintraege };
    }
    return { zeiten: lok.map((z) => z.zeit_ms), online: false, eintraege: lok };
  }
  // Online je SPIELER (Geraet) gerechnet: seine Bestzeit zaehlt einmal. "Du warst schneller als X %
  // der Spieler" wuerde sonst von jemandem verzerrt, der dieselbe Strecke fuenfzigmal faehrt.
  function chBesteJeSpieler(eintraege, ich, zeit) {
    const beste = new Map();
    eintraege.forEach((z, i) => {
      const wer = z.geraet || ('?' + i);
      if (!beste.has(wer) || +z.zeit_ms < beste.get(wer)) beste.set(wer, +z.zeit_ms);
    });
    if (!beste.has(ich) || zeit < beste.get(ich)) beste.set(ich, zeit);
    return { werte: [...beste.values()], meine: beste.get(ich) };
  }
  function chRangText(schl, zeit) {
    const a = chAlleZeiten(schl);
    let alle = a.zeiten.indexOf(zeit) >= 0 ? a.zeiten : a.zeiten.concat([zeit]);
    if (a.online) {
      const b = chBesteJeSpieler(a.eintraege, chGeraet(), zeit);
      alle = b.werte; zeit = b.meine;
    }
    const platz = alle.filter((z) => z < zeit).length + 1;
    const p = chPerzentil(alle, zeit);
    return (a.online ? t('Du warst schneller als {p} % der Spieler.') : t('Schneller als {p} % deiner eigenen Läufe.'))
      .replace('{p}', p) + ' ' + t('Platz {a} von {b}.').replace('{a}', platz).replace('{b}', alle.length);
  }
  function chSeiteOffen() {
    const d = $('ch-detail');
    return !!(d && !d.hidden && d.closest('.subpage.on'));
  }
  function challengeSeiteZeigen(id) {
    if (id === 'online') { chOnlineZeichnen(); return; }
    if (!CHALLENGES.some((c) => c.id === id)) return;
    chWahl = id;
    const platz = document.querySelector('#sub-ch-' + id + ' .ch-platz');
    const d = $('ch-detail');
    if (platz && d && d.parentNode !== platz) platz.appendChild(d);
    if (d) d.hidden = false;
    chZeichneDetail();
    chListeLaden(chSchluessel(chWahl, chModus, chPreset));
  }
  function chZeichneDetail() {
    const d = $('ch-detail');
    if (!d) return;
    const def = chDef(chWahl), tiles = chTiles(def);
    $('ch-karte').innerHTML = chKarte(def, true);
    $('ch-idee').textContent = t(def.idee);
    const [bw, bh] = chFlaeche(tiles);
    const m = trackLaengeM(tiles);
    $('ch-fakten').textContent = t('Länge') + ' ' + chZahl(m, 2) + ' m · 1:50 ' + chZahl(m * 50 / 1000, 2) + ' km · '
      + t('Platzbedarf') + ' ' + chZahl(bw, 2) + ' × ' + chZahl(bh, 2) + ' m · ' + def.sets.map((s) => t(CH_SET_NAME[s])).join(' + ');
    document.querySelectorAll('#ch-modus button').forEach((b) => b.classList.toggle('an', b.dataset.m === chModus));
    document.querySelectorAll('#ch-preset button').forEach((b) => b.classList.toggle('an', b.dataset.p === chPreset));
    $('ch-modus-text').textContent = chModus === 'hotlap'
      ? t('So viele Runden du willst, die schnellste zählt. Schluss mit der Rennen-Taste (R1).')
      : t('{n} Runden ab stehendem Start, die Gesamtzeit zählt.').replace('{n}', def.runden);
    // Teile: nur, was unter Strecke > Meine Teile eingetragen ist.
    const bil = teileBilanz(tiles).filter((x) => x.hat !== null);
    const fehlt = bil.filter((x) => x.rest < 0);
    const teile = $('ch-teile');
    teile.className = 'ch-teile' + (fehlt.length ? ' fehlt' : bil.length ? ' da' : '');
    teile.textContent = !bil.length ? t('Tipp: Unter Strecke > Meine Teile eintragen, was du hast, dann prüft die App hier, ob alles da ist.')
      : fehlt.length ? t('Fehlt') + ': ' + fehlt.map((x) => (-x.rest) + '× ' + t(TILE_LABEL[x.typ])).join(', ')
      : t('Alle Teile da');
    const nm = $('ch-name');
    if (nm && document.activeElement !== nm) nm.value = chOnline().fahrer || '';
    const start = $('ch-start');
    start.textContent = chLauf ? t('Challenge abbrechen') : t('Challenge starten');
    // Letztes Ergebnis dieser Strecke
    const e = $('ch-ergebnis');
    if (chLetzt && chLetzt.id === chWahl) {
      e.hidden = false;
      const schl = chSchluessel(chLetzt.id, chLetzt.modus, chLetzt.preset);
      $('ch-erg-titel').textContent = t(CH_MODUS_NAME[chLetzt.modus]) + ' · ' + (chLetzt.preset === 'pro' ? 'Pro' : 'Arcade');
      $('ch-erg-zeit').textContent = chLetzt.gueltig ? chZeit(chLetzt.zeit) : t('Nicht gewertet');
      $('ch-erg-text').textContent = chLetzt.gueltig ? chRangText(schl, chLetzt.zeit) : t(chLetzt.grund);
    } else e.hidden = true;
    chZeichneListe();
  }
  function chZeichneListe() {
    const schl = chSchluessel(chWahl, chModus, chPreset);
    const l = chListen[schl] || {};
    const a = chAlleZeiten(schl);
    const o = chOnline();
    const st = $('ch-liste-status');
    st.textContent = l.laedt ? t('Lade Bestenliste …')
      : a.online ? t('Online-Bestenliste') + ': ' + a.zeiten.length + ' ' + t('Zeiten')
        + (l.stand ? ' · ' + t('Stand') + ' ' + new Date(l.stand).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) : '')
      : o.url ? t('Online-Bestenliste nicht erreichbar, hier stehen deine eigenen Zeiten.')
      : t('Deine Zeiten auf diesem Gerät. Für die gemeinsame Liste unter Challenges > Online eine Adresse eintragen.');
    // Eigene Bestzeit: aus dem letzten Lauf oder aus den lokalen Zeiten.
    const lok = chLokal(schl);
    const eigene = chLetzt && chLetzt.gueltig && schl === chSchluessel(chLetzt.id, chLetzt.modus, chLetzt.preset)
      ? chLetzt.zeit : (lok.length ? lok[0].zeit : null);
    const eintr = a.eintraege.slice().sort((x, y) => x.zeit_ms - y.zeit_ms);
    const tb = $('ch-liste');
    tb.innerHTML = '';
    const bester = eintr.length ? +eintr[0].zeit_ms : 0;
    const ich = chGeraet();
    eintr.slice(0, 50).forEach((z, i) => {
      const tr = document.createElement('tr');
      if (z.geraet === ich && +z.zeit_ms === eigene) tr.className = 'du';
      const zellen = [String(i + 1), (z.fahrer ? z.fahrer + ' · ' : '') + (z.auto || '–'), chZeit(+z.zeit_ms),
        i ? '+' + chZahl((z.zeit_ms - bester) / 1000, 3) : '–'];
      zellen.forEach((txt) => { const td = document.createElement('td'); td.textContent = txt; td.setAttribute('data-i18n-skip', ''); tr.appendChild(td); });
      tb.appendChild(tr);
    });
    // Histogramm, oben schnell, die eigene Klasse markiert.
    const h = $('ch-histo');
    h.innerHTML = '';
    const zeiten = a.zeiten.slice();
    if (eigene !== null && zeiten.indexOf(eigene) < 0) zeiten.push(eigene);
    const kl = chHistogramm(zeiten);
    const hoch = Math.max(1, ...kl.map((k) => k.anz));
    kl.forEach((k, i) => {
      const du = eigene !== null && eigene >= k.von && (eigene < k.bis || i === kl.length - 1);
      const lbl = document.createElement('span'); lbl.className = 'ch-h-lbl'; lbl.textContent = chZeit(Math.round(k.von)).slice(0, -2);
      const bahn = document.createElement('div'); bahn.className = 'ch-h-bahn';
      const bar = document.createElement('div'); bar.className = 'ch-h-bar' + (du ? ' du' : '');
      bar.style.width = Math.max(3, 100 * k.anz / hoch) + '%';
      bahn.appendChild(bar);
      const n = document.createElement('span'); n.className = 'ch-h-n'; n.textContent = k.anz;
      [lbl, n].forEach((x) => x.setAttribute('data-i18n-skip', ''));
      h.appendChild(lbl); h.appendChild(bahn); h.appendChild(n);
    });
    $('ch-perz').textContent = eigene !== null && zeiten.length > 1 ? chRangText(schl, eigene) : '';
  }
  function chKachelnZeichnen() {
    CHALLENGES.forEach((def) => {
      const el = document.querySelector('.ch-mini[data-ch="' + def.id + '"]');
      if (el && !el.dataset.fertig) { el.innerHTML = chKarte(def, false); el.dataset.fertig = '1'; }
    });
  }
  function chOnlineZeichnen() {
    const o = chOnline();
    $('ch-url').value = o.url;
    $('ch-fahrer').value = o.fahrer;
    $('ch-hochladen').checked = !!o.hochladen;
  }
  function chOnlineSpeichern() {
    chSchreiben(CH_ONLINE_STORE, { url: $('ch-url').value.trim(), fahrer: $('ch-fahrer').value.trim().slice(0, 16),
                                   hochladen: $('ch-hochladen').checked });
    Object.keys(chListen).forEach((k) => delete chListen[k]);
  }

  // ---- Verdrahtung ----
  document.querySelectorAll('#ch-modus button').forEach((b) => b.addEventListener('click', () => {
    chModus = b.dataset.m; chZeichneDetail(); chListeLaden(chSchluessel(chWahl, chModus, chPreset));
  }));
  document.querySelectorAll('#ch-preset button').forEach((b) => b.addEventListener('click', () => {
    chPreset = b.dataset.p; chZeichneDetail(); chListeLaden(chSchluessel(chWahl, chModus, chPreset));
  }));
  $('ch-start').addEventListener('click', () => { if (chLauf) challengeAbbrechen(); else challengeStarten(); });
  ['ch-url', 'ch-fahrer', 'ch-hochladen'].forEach((id) => $(id).addEventListener('change', chOnlineSpeichern));
  // Derselbe Name direkt auf der Strecken-Seite (BESTELLT: "im Challenges-Bildschirm nochmal
  // erlauben, dass ich meinen Username fuer die Bestenliste festlege").
  $('ch-name').addEventListener('change', () => {
    const o = chOnline();
    o.fahrer = $('ch-name').value.trim().slice(0, 16);
    chSchreiben(CH_ONLINE_STORE, o);
    $('ch-fahrer').value = o.fahrer;
  });
  $('ch-test').addEventListener('click', () => {
    chOnlineSpeichern();
    const st = $('ch-test-status');
    if (!chOnline().url) { st.textContent = t('Erst die Adresse eintragen.'); return; }
    st.textContent = t('Prüfe …');
    const schl = chSchluessel('oval', 'hotlap', 'pro');
    chListeLaden(schl, true).then(() => {
      const l = chListen[schl];
      st.textContent = l && l.online ? t('Verbunden.') + ' ' + (l.anzahl || 0) + ' ' + t('Zeiten auf der Liste.')
        : t('Keine Verbindung') + (l && l.fehler ? ': ' + l.fehler : '');
    });
  });
  setTimeout(chKachelnZeichnen, 0);
