  // ====================================================================================
  // TELEMETRIE: JEDE RUNDE ALS ZWISCHENZEITEN JE TEIL (v1.0.21, WIP)
  // ====================================================================================
  //
  // BESTELLT (Plan "Telemetrie der Bestzeiten und Challenger"): eine Runde wird als
  // Zwischenzeiten je Teil gespeichert - die einzige Ortsangabe, die das Auto verlaesslich
  // liefert (der bestaetigte Kachelwechsel in handleDashboardBytes, 70-race.js). Daraus
  // werden die Telemetrie-Seite, das Live-Delta im Cockpit und spaeter der Challenger, der
  // eine Runde physisch nachfaehrt.
  //
  // Eine Spur: { v, code, n, ms, teile: [t0 = 0, t1, ...], proben: [[t, v%, gas, bremse,
  // gang, lenk], ...], datum, auto }. teile[k] = ms seit Rundenstart beim Erreichen von
  // tiles[k] (tiles[0] ist Start/Ziel). proben etwa 10 je Sekunde aus der Fahrphysik.
  //
  // Gueltig ist eine Spur nur, wenn genau n-1 Teilwechsel zwischen zwei Ueberfahrten lagen,
  // die Zeiten steigen und die Runde selbst gewertet wurde. Alles mit `var` und Funktionen:
  // diese Datei wird VOR 80/90 geladen und beim Laden nur angelegt (temporale Todeszone).

  var TELE_STORE = 'omegasim-telemetrie';
  var TELE_PROBE_MS = 100;            // etwa 10 Proben je Sekunde
  var TELE_PROBEN_MAX = 900;          // 90 s; laengere Runden werden ausgeduennt
  var TELE_STRECKEN_MAX = 40;         // so viele Strecken haelt der Speicher
  var teleLauf = null;                // { start, ev: [[t, code]], pr: [], probeAt }
  var teleVergleich = null;           // { start, teile } fuer das Live-Delta
  var teleRennSpuren = [];            // je Runde des laufenden Rennens die Spur (oder null)
  var TELE_UPLOAD_PROBEN = 200;       // fuer das Hochladen ausgeduennt (~4 KB)

  function teleRennenAktiv() {
    return (raceState === 'racing' || raceState === 'finishing') && raceLapStart !== null
      && !raceFormationLap;
  }
  // Der Lauf gehoert immer zur Runde, die raceLapStart gerade misst. Beginnt eine neue (Start,
  // erste Bewegung, Ueberfahrt), faengt er neu an - ohne eigenen Haken an jeder dieser Stellen.
  function teleLaufHier() {
    if (!teleRennenAktiv()) { teleLauf = null; return null; }
    if (!teleLauf || teleLauf.start !== raceLapStart) {
      teleLauf = { start: raceLapStart, ev: [], pr: [], probeAt: 0 };
      teleVergleichSetzen();
    }
    return teleLauf;
  }

  // Aus handleDashboardBytes: ein bestaetigter Teilwechsel des eigenen Autos.
  function teleKachel(code, jetzt) {
    const l = teleLaufHier();
    if (!l) return;
    l.ev.push([jetzt - l.start, code]);
    teleDeltaZeigen(l);
  }

  // Aus physicsStep, jeden Takt; gespeichert wird etwa alle 100 ms.
  function teleProbe(gas, bremse) {
    const l = teleLauf;
    if (!l || !teleRennenAktiv() || l.start !== raceLapStart) return;
    const jetzt = Date.now();
    if (jetzt - l.probeAt < TELE_PROBE_MS) return;
    l.probeAt = jetzt;
    const st = physEngine.state, top = physEngine.config.topSpeedKmh || 1;
    l.pr.push([jetzt - l.start, Math.round(Math.abs(st.speedKmh) / top * 1000) / 10,
      Math.round((gas || 0) * 100), Math.round((bremse || 0) * 100), st.currentGear | 0,
      Math.round((typeof physOutSteer === 'number' ? physOutSteer : 0) * 100)]);
  }

  // Die reine Rechnung: aus den Teilwechseln einer Runde die Spur, oder null.
  // ev: [[t, code]] seit Rundenstart; der Wechsel auf Start/Ziel, der diese Ueberfahrt
  // ausgeloest hat, steht am Ende und gehoert zur naechsten Runde.
  // soll (optional): die Teilecodes der Strecke, tiles[k].type.
  //
  // v1.0.25 GEMELDET: "Telemetrie klappt gar nicht. Ich bin Time Attack gefahren, aber finde
  // die Daten nirgends." Verlangt waren GENAU n-1 Teilwechsel - auf der echten Bahn faellt
  // aber oft ein Teil aus oder ein Wechsel kommt doppelt (dieselbe Erfahrung, nach der die
  // Challenge-Pruefung 10 % Fehllesungen erlaubt). Dann wurde jede Runde verworfen.
  // Jetzt: stimmt die Zahl nicht, werden die Lesungen ueber ihre ART (Gerade/rechts/links,
  // chKlasse) der Strecke zugeordnet - laengste gemeinsame Folge wie bei chRundePruefen -,
  // und fehlende Teile bekommen eine Zeit zwischen ihren Nachbarn. Gilt, solange mindestens
  // TELE_ZUORDNUNG_MIN der Teile zugeordnet sind; `geschaetzt` sagt, wie viele es nicht waren.
  function teleSpurBauen(ev, ms, n, code, soll) {
    if (!(ms > 0) || !(n >= 3)) return null;
    const e = ev.filter((x) => x[1] !== 0x00 && x[1] !== 0xff);
    while (e.length && e[e.length - 1][0] >= ms - 5) e.pop();
    const fertig = (teile, geschaetzt) => {
      for (let k = 1; k < teile.length; k++) if (!(teile[k] > teile[k - 1]) || teile[k] >= ms) return null;
      const sp = { v: 1, code, n, ms: Math.round(ms), teile: teile.map(Math.round) };
      if (geschaetzt) sp.geschaetzt = geschaetzt;
      return sp;
    };
    if (e.length === n - 1) {
      const sp = fertig([0].concat(e.map((x) => x[0])), 0);
      if (sp) return sp;
    }
    if (!Array.isArray(soll) || soll.length !== n || typeof chKlasse !== 'function') return null;
    const a = soll.slice(1).map(chKlasse), b = e.map((x) => chKlasse(x[1]));
    if (b.length > a.length * 1.5) return null;
    // LCS mit Rueckverfolgung: Paare (Teil j, Lesung i).
    const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let j = 1; j <= a.length; j++) {
      for (let i = 1; i <= b.length; i++) {
        m[j][i] = a[j - 1] === b[i - 1] ? m[j - 1][i - 1] + 1 : Math.max(m[j - 1][i], m[j][i - 1]);
      }
    }
    const zeit = new Array(n).fill(null);
    zeit[0] = 0;
    let j = a.length, i = b.length, paare = 0;
    while (j > 0 && i > 0) {
      if (a[j - 1] === b[i - 1] && m[j][i] === m[j - 1][i - 1] + 1) { zeit[j] = e[i - 1][0]; paare++; j--; i--; }
      else if (m[j - 1][i] >= m[j][i - 1]) j--;
      else i--;
    }
    if (paare < Math.max(2, Math.ceil(TELE_ZUORDNUNG_MIN * (n - 1)))) return null;
    // Luecken linear zwischen den Nachbarn; hinter dem letzten zugeordneten Teil bis ms.
    for (let k = 1; k < n; k++) {
      if (zeit[k] !== null) continue;
      let r = k + 1;
      while (r < n && zeit[r] === null) r++;
      const tr = r < n ? zeit[r] : ms;
      zeit[k] = zeit[k - 1] + (tr - zeit[k - 1]) / (r - k + 1);
    }
    return fertig(zeit, (n - 1) - paare);
  }
  var TELE_ZUORDNUNG_MIN = 0.75;
  // Was mit den Runden der laufenden Fahrt passiert ist - fuer die Zusammenfassung am Ende.
  var teleSitzung = { gespeichert: 0, geschaetzt: 0, verworfen: 0 };

  // Aus playerLapCrossed, nach dem Einfuegen der Runde: Spur fertigstellen und merken.
  function teleRunde(start, jetzt, gewertet) {
    const l = teleLauf;
    teleLauf = null;
    // Je Runde des Rennens eine Stelle, damit der Upload die Spur der schnellsten findet.
    const i = typeof raceLapTimes !== 'undefined' ? raceLapTimes.length - 1 : -1;
    if (i === 0) { teleRennSpuren = []; teleSitzung = { gespeichert: 0, geschaetzt: 0, verworfen: 0 }; teleFahrtId = Date.now(); }
    if (i >= 0) teleRennSpuren[i] = null;
    if (!l || l.start !== start) return null;
    const tiles = currentTrackTiles;
    if (!tiles || tiles.length < 3) return null;
    const spur = teleSpurBauen(l.ev, jetzt - start, tiles.length, trackToCode(tiles, 0), tiles.map((x) => x.type));
    if (!spur) {
      if (gewertet) {
        teleSitzung.verworfen++;
        log('Telemetrie: Runde nicht gespeichert - ' + l.ev.length + ' Teilwechsel gelesen, die Strecke hat '
            + tiles.length + ' Teile, zu wenige liessen sich zuordnen.', 'info');
      }
      return null;
    }
    if (gewertet) { teleSitzung.gespeichert++; if (spur.geschaetzt) teleSitzung.geschaetzt++; }
    let pr = l.pr;
    if (pr.length > TELE_PROBEN_MAX) {
      const k = pr.length / TELE_PROBEN_MAX;
      pr = Array.from({ length: TELE_PROBEN_MAX }, (_, i) => pr[Math.floor(i * k)]);
    }
    spur.proben = pr;
    spur.datum = Date.now();
    spur.runde = i + 1;
    spur.auto = typeof playerCar !== 'undefined' && playerCar ? garageLabel(playerCar) : '';
    if (i >= 0) teleRennSpuren[i] = spur;
    if (gewertet) teleMerken(spur, typeof playerCar !== 'undefined' ? playerCar : null);
    return spur;
  }

  // Fuer chHochladen/communityPost (v1.0.21, BESTELLT: "Upload immer, ohne Wahl"): die Spur
  // der schnellsten Runde des Laufs, Proben ausgeduennt. Hat gerade diese Runde keine Spur
  // (ein Teil nicht gelesen), geht nichts mit - eine langsamere Runde waere nicht der Rekord.
  function teleSpurFuerUpload(runden) {
    if (!Array.isArray(runden) || !runden.length) return null;
    let best = 0;
    runden.forEach((ms, i) => { if (+ms < +runden[best]) best = i; });
    const sp = teleRennSpuren[best];
    if (!sp || Math.abs(sp.ms - runden[best]) > 50) return null;
    let pr = sp.proben || [];
    if (pr.length > TELE_UPLOAD_PROBEN) {
      const k = pr.length / TELE_UPLOAD_PROBEN;
      pr = Array.from({ length: TELE_UPLOAD_PROBEN }, (_, j) => pr[Math.floor(j * k)]);
    }
    return { v: 1, code: sp.code, n: sp.n, ms: sp.ms, teile: sp.teile.slice(), proben: pr };
  }

  function teleLesen() {
    try { return JSON.parse(localStorage.getItem(TELE_STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function teleSchreiben(d) {
    try { localStorage.setItem(TELE_STORE, JSON.stringify(d)); } catch (e) {
      // Voll: die aeltesten Strecken weg und noch einmal.
      const k = Object.keys(d).sort((a, b) => (d[a].datum || 0) - (d[b].datum || 0));
      k.slice(0, Math.ceil(k.length / 2)).forEach((x) => delete d[x]);
      try { localStorage.setItem(TELE_STORE, JSON.stringify(d)); } catch (e2) { /* aufgegeben */ }
    }
  }
  var teleFahrtId = 0;                 // eine Fahrt = ein Rennen/Time Attack, gesetzt bei Runde 1
  var TELE_FAHRT_MAX = 30;             // so viele Runden einer Fahrt
  function teleDuenn(spur, max) {
    const pr = spur.proben || [];
    if (pr.length <= max) return spur;
    const k = pr.length / max;
    return Object.assign({}, spur, { proben: Array.from({ length: max }, (_, j) => pr[Math.floor(j * k)]) });
  }
  function teleWer(car) { return car && car.device ? String(car.device.id) : 'spieler1'; }
  // Beste und letzte Spur je Strecke (gespiegelt = gleich, wie Time Attack) und Fahrer.
  function teleMerken(spur, car) {
    const tiles = currentTrackTiles;
    const d = teleLesen();
    const k = bestzeitSchluessel(tiles);
    const e = d[k] || (d[k] = { fahrer: {} });
    e.datum = Date.now();
    const f = e.fahrer[teleWer(car)] || (e.fahrer[teleWer(car)] = {});
    f.letzte = spur;
    // v1.0.28 GEMELDET: "In der Telemetrie wird nur letzte = beste Runde angezeigt." Gemerkt
    // waren nur diese zwei. Jetzt dazu ALLE gewerteten Runden der letzten Fahrt auf dieser
    // Strecke (f.fahrt), mit ausgeduennten Proben; die Fahrten anderer Strecken werden dabei
    // geloescht - der Speicher reicht nicht fuer alle Runden aller Strecken.
    if (!f.fahrt || f.fahrt.id !== teleFahrtId) f.fahrt = { id: teleFahrtId, runden: [] };
    f.fahrt.runden.push(teleDuenn(spur, TELE_UPLOAD_PROBEN));
    if (f.fahrt.runden.length > TELE_FAHRT_MAX) f.fahrt.runden.shift();
    Object.keys(d).forEach((x) => {
      if (x === k || !d[x].fahrer) return;
      Object.values(d[x].fahrer).forEach((ff) => { if (ff) delete ff.fahrt; });
    });
    if (!f.beste || spur.ms < f.beste.ms) f.beste = spur;
    const alle = Object.keys(d);
    if (alle.length > TELE_STRECKEN_MAX) {
      alle.sort((a, b) => (d[a].datum || 0) - (d[b].datum || 0))
        .slice(0, alle.length - TELE_STRECKEN_MAX).forEach((x) => delete d[x]);
    }
    teleSchreiben(d);
  }
  // Die beste eigene Spur auf den gerade gelegten Teilen (oder null).
  function teleBeste(car, tilesOpt) {
    const tiles = tilesOpt || currentTrackTiles;
    if (!tiles || tiles.length < 3) return null;
    const e = teleLesen()[bestzeitSchluessel(tiles)];
    const f = e && e.fahrer[teleWer(car)];
    return f && f.beste ? f.beste : null;
  }

  // Eine Spur auf die gelegten Teile ausrichten: gleiche Richtung = wie gespeichert,
  // gespiegelt = Start/Ziel bleibt, die Dauern der uebrigen Teile in umgekehrter Folge.
  // Rueckgabe: teile[] (ms seit Rundenstart je Teil) oder null.
  function teleAusrichten(spur, tiles) {
    if (!spur || !tiles || spur.n !== tiles.length) return null;
    const n = tiles.length;
    if (spur.code === trackToCode(tiles, 0)) return spur.teile.slice();
    let spiegel = null;
    try { spiegel = trackToCode(chSpiegelTiles(tiles), 0); } catch (e) { return null; }
    if (spur.code !== spiegel) return null;
    const dauer = [];
    for (let k = 0; k < n; k++) dauer.push((k + 1 < n ? spur.teile[k + 1] : spur.ms) - spur.teile[k]);
    const neu = [dauer[0]];
    for (let k = n - 1; k >= 1; k--) neu.push(dauer[k]);
    const teile = [0];
    for (let k = 0; k < n - 1; k++) teile.push(teile[k] + neu[k]);
    return teile;
  }

  // ---- LIVE-DELTA IM COCKPIT (Time Attack) ----------------------------------------------
  // An jedem Teilwechsel: die eigene Zeit bis hierher gegen die beste eigene Spur. Gruen =
  // schneller als die Bestrunde, rot = langsamer.
  function teleVergleichSetzen() {
    teleVergleich = null;
    const el = $('race-lap-delta');
    if (el) { el.textContent = ''; el.className = 'gt3-delta'; }
    if (raceMode !== 'bestzeit') return;
    const teile = teleAusrichten(teleBeste(typeof playerCar !== 'undefined' ? playerCar : null), currentTrackTiles);
    if (teile) teleVergleich = { teile };
  }
  function teleDelta(teileVgl, k, tMs) {
    if (!teileVgl || k < 1 || k >= teileVgl.length) return null;
    return tMs - teileVgl[k];
  }
  function teleDeltaText(d) {
    const s = Math.abs(d / 1000).toFixed(2);              // Punkt wie formatLapTime
    return (d > 0 ? '+' : d < 0 ? '−' : '±') + s;
  }
  function teleDeltaZeigen(l) {
    const el = $('race-lap-delta');
    if (!el || !teleVergleich) return;
    const d = teleDelta(teleVergleich.teile, l.ev.length, l.ev[l.ev.length - 1][0]);
    if (d === null) return;
    el.textContent = teleDeltaText(d);
    el.className = 'gt3-delta ' + (d <= 0 ? 'schneller' : 'langsamer');
  }
