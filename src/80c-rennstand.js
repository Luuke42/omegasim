  // =========================================================================
  // Rennstand aus lokalen Rennwertungsdaten und vorproduzierten Piper-Clips.
  // Keine Namen-TTS, kein Onlinedienst und keine native Android-Erweiterung.
  // =========================================================================
  let rennstandAn = false, rennstandIntervall = 5;
  let rennstandTempo = 1, rennstandLautstaerke = 1, rennstandBus = null;
  let rennstandHall = 0, rennstandHallWet = null, rennstandHallDry = null;
  let rennstandHallNodes = [];
  const RENNSTAND_HALL_DAUER = 1.2;
  let rennstandKompressor = null, rennstandWartend = null, rennstandSatzRunde = null;
  let rennstandErgebnisGeplant = false, rennstandErgebnisGesprochen = false;
  let rennstandGeneration = 0, rennstandTimer = null, rennstandBis = 0;
  let rennstandQuellen = [], rennstandGemeldet = new Set();
  const rennstandBuffers = {}, rennstandLaden = {};
  const rennstandMesspunkte = new Map();
  let rennstandMessGeneration = 0, rennstandMessTimer = null;
  let rennstandWarteSekunden = 30;
  // v1.1.35 BESTELLT: Ergebnisansage eigener Schalter (Standard an), Zwischenstand bleibt
  // Standard aus. v1.1.36 BESTELLT: der Name aus der Garage ist entweder eine
  // AUTOBEZEICHNUNG ("Porsche" -> "der rote Porsche") oder ein FAHRERNAME
  // ("Max Mustermann" -> "Max Mustermann", ohne Farbe). Standard: Autobezeichnung.
  let rennstandErgebnisAn = true, rennstandNamensart = 'auto', rennstandSprache = null;

  function rennstandWarteWert(wert) {
    if (wert === null || String(wert).trim() === '') return 30;
    const n = Number(wert);
    return Number.isFinite(n) ? Math.max(5, Math.min(30, Math.round(n))) : 30;
  }

  function rennstandIntervallWert(wert) {
    const n = Number(wert);
    return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.round(n))) : 5;
  }

  function rennstandAbbrechen() {
    rennstandGeneration++;
    if (rennstandTimer !== null) clearTimeout(rennstandTimer);
    rennstandTimer = null;
    rennstandWartend = null; rennstandSatzRunde = null;
    for (const q of rennstandQuellen) { try { q.stop(); } catch (e) {} }
    rennstandQuellen = [];
    rennstandBis = 0;
    if (rennstandSprache) {
      rennstandSprache = null;
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    if (rennstandBus) {
      try { rennstandBus.disconnect(); } catch (e) {}
      rennstandBus = null;
      for (const node of rennstandHallNodes) { try { node.disconnect(); } catch (e) {} }
      rennstandHallNodes = []; rennstandHallWet = null; rennstandHallDry = null;
    }
  }

  function rennstandReset() {
    rennstandAbbrechen();
    rennstandGemeldet.clear();
    rennstandMesspunkte.clear(); rennstandMessGeneration++;
    if (rennstandMessTimer !== null) clearTimeout(rennstandMessTimer);
    rennstandMessTimer = null;
    rennstandErgebnisGeplant = false; rennstandErgebnisGesprochen = false;
  }

  function rennstandBeschaeftigt() {
    if (rennstandSprache) return true;
    return rennstandBis > 0 && audioCtx && audioCtx.currentTime < rennstandBis;
  }

  // Rangfolge wie bisher nach vollendeten Runden und Wertungszeit.
  // Live-Luecken getrennt aus monotoner Ortung und gemessenem Tempo.
  // Finale Wertung behaelt ihre tatsaechlichen Runden-/Zeitdifferenzen.
  function rennstandWerten(cars, live = false, streckenKacheln = 0) {
    const rows = cars.map((c, i) => {
      const laps = Array.isArray(c.laps) ? c.laps : [];
      const valid = laps.every((l) => l && Number.isFinite(l.ms) && l.ms >= 0);
      return { id: c.id || ('local:' + i), role: c.role, farbe: c.farbe, farbeId: c.farbeId, modellId: carModellWert(c.modellId),
               alias: c.alias || '', laps, rate: Number.isFinite(c.rate) && c.rate > 0 ? c.rate : null,
               runden: laps.length,
               summe: valid ? laps.reduce((a, l) => a + l.ms, 0) : null,
               ort: Number.isFinite(c.ort) ? c.ort : -1 };
    });
    rows.sort((a, b) => (b.runden - a.runden)
      || ((a.summe === null ? Infinity : a.summe) - (b.summe === null ? Infinity : b.summe))
      || (b.ort - a.ort) || String(a.id).localeCompare(String(b.id)));
    const leader = rows[0];
    return rows.map((x, i) => {
      let rundenZurueck = leader ? leader.runden - x.runden : 0;
      let msZurueck = leader && x.runden === leader.runden
        && x.summe !== null && leader.summe !== null ? Math.max(0, x.summe - leader.summe) : null;
      if (live && leader && i > 0) {
        const dist = leader.ort - x.ort;
        // Monotone Ortung und gemessenes Kacheltempo, wie ghostAbstandSek.
        // Ein Zaehlerunterschied an Start/Ziel ist KEINE Ueberrundung.
        if (streckenKacheln > 0 && leader.ort >= 0 && x.ort >= 0 && dist >= 0) {
          rundenZurueck = Math.floor(dist / streckenKacheln);
          msZurueck = leader.rate && x.rate
            ? dist / ((leader.rate + x.rate) / 2) * 1000 : null;
        } else {
          // Ohne Ortung nur dieselbe abgeschlossene Runde vergleichen.
          // Keine Ueberrundung aus dem kurzzeitig unterschiedlichen Zaehler erfinden.
          rundenZurueck = 0;
          const n = Math.min(leader.runden, x.runden);
          const sum = (z) => z.laps.slice(0, n).reduce((a, l) => a + l.ms, 0);
          msZurueck = n > 0 && leader.summe !== null && x.summe !== null
            ? Math.max(0, sum(x) - sum(leader)) : null;
        }
      }
      return Object.assign({}, x, { platz: i + 1, rundenZurueck, msZurueck });
    });
  }

  function rennstandRohdaten() {
    const cars = raceAllCars().filter((c) => c.role !== 'safetycar' && c.role !== 'reinig');
    // Spieler 1: nur akzeptierte Rennrunden, nicht der Garagen-Fallback.
    for (const c of cars) if (c.role === 'player') c.laps = raceLapTimes;
    return cars;
  }

  function rennstandDaten() {
    // Keine Positions-/Temposchaetzung mehr fuer die Ansage.
    return rennstandWerten(rennstandRohdaten());
  }

  // Zeitstempel der n-ten akzeptierten Durchfahrt auf derselben Date.now()-Uhr.
  // Keine Summe von Rundenzeiten: Anlauf und Strafzeiten verschieben sonst den Abstand.
  function rennstandDurchfahrt(car, n) {
    const lap = Array.isArray(car.laps) ? car.laps[n - 1] : null;
    return lap && Number.isFinite(lap.crossedAt) ? lap.crossedAt : null;
  }

  function rennstandMessstand(cars, n, bis) {
    // Alle mit derselben vollendeten Messrunde; danach gefahrene Runden sind irrelevant.
    // Nur bereits erfolgte Durchfahrten dieser Messrunde aufnehmen.
    const rows = cars.map((c, i) => ({
      id: c.id || ('local:' + i), role: c.role, farbe: c.farbe,
      farbeId: c.farbeId, modellId: carModellWert(c.modellId), alias: c.alias || '',
      crossedAt: rennstandDurchfahrt(c, n), runden: n,
    })).filter((c) => c.crossedAt !== null && c.crossedAt <= bis);
    rows.sort((a, b) => a.crossedAt - b.crossedAt || String(a.id).localeCompare(String(b.id)));
    const leader = rows[0];
    return rows.map((c, i) => Object.assign({}, c, {
      platz: i + 1, rundenZurueck: 0, msZurueck: c.crossedAt - leader.crossedAt,
    }));
  }

  function rennstandMessstandGueltig(messung) {
    const cars = rennstandRohdaten();
    // Pruefe nur die eingefrorenen Teilnehmer. Spaetere Durchfahrten anderer
    // Autos aendern den bereits gemessenen Top-3-Zwischenstand nicht.
    return messung.rows.every((row) => {
      const c = cars.find((c, i) => (c.id || ('local:' + i)) === row.id);
      return c && rennstandDurchfahrt(c, messung.n) === row.crossedAt;
    });
  }

  // Messrunde n vormerken, sobald das erste Fahrzeug sie beendet hat.
  // Freigabe, sobald drei (oder alle bei kleinerem Feld) dieselbe Runde beendet
  // haben. Die fruehesten Durchfahrten bestimmen die Top 3 dieser Messrunde.
  // Nach eingestellten 5–30 s nur vorhandene Messungen sprechen, nie einen Rundenabstand erfinden.
  function rennstandMessungAktualisieren(cars, intervall, messpunkte, gemeldet, jetzt = Date.now(), warteSekunden = rennstandWarteSekunden) {
    for (const [n] of messpunkte) {
      if (!cars.some((c) => rennstandDurchfahrt(c, n) !== null)) messpunkte.delete(n);
    }
    const max = cars.reduce((n, c) => Math.max(n, (c.laps || []).length), 0);
    if (max > 0 && max % intervall === 0 && !messpunkte.has(max) && !gemeldet.has(max)) {
      const zeiten = cars.map((c) => rennstandDurchfahrt(c, max)).filter((t) => t !== null);
      if (zeiten.length) messpunkte.set(max, { n: max, start: Math.min(...zeiten) });
    }
    const fertig = [], ziel = Math.min(3, cars.length);
    for (const [n, punkt] of messpunkte) {
      const rows = rennstandMessstand(cars, n, jetzt);
      const timeout = jetzt - punkt.start >= rennstandWarteWert(warteSekunden) * 1000;
      if (!rows.length || (rows.length < ziel && !timeout)) continue;
      messpunkte.delete(n); gemeldet.add(n);
      fertig.push({ n, bis: jetzt, rows: rows.slice(0, 3), timeout: rows.length < ziel });
    }
    return fertig.sort((a, b) => a.n - b.n);
  }

  function rennstandBezugsrunde(rows) {
    // rows kommt aus rennstandWerten(): das fuehrende Auto steht immer zuerst.
    // Unabhaengig davon, ob NPC, Spieler 1, 2 oder 3 fuehrt.
    return rows.length ? rows[0].runden : 0;
  }

  function rennstandMeilenstein(n, intervall, gemeldet) {
    if (!Number.isInteger(n) || n <= 0 || n % intervall !== 0 || gemeldet.has(n)) return false;
    gemeldet.add(n);
    return true;
  }

  // Alle vorhandenen Zahlen 0..60 sprechen normal. Groessere ganze Zahlen werden
  // ziffernweise gelesen, nicht still auf 60 gekappt und nicht falsch zusammengesetzt.
  function rennstandZahlFolge(n) {
    if (!Number.isFinite(n)) return [];
    n = Math.max(0, Math.round(n));
    return n <= 60 ? ['n:' + n] : String(n).split('').map((z) => 'n:' + z);
  }

  function rennstandFarbe(hex) {
    const c = CAR_COLORS.find((x) => String(x.hex).toLowerCase() === String(hex || '').toLowerCase());
    return c ? 'r:farbe_' + c.id : null;
  }

  function rennstandSpielerNr(role) {
    return role === 'player' ? 1 : role === 'player2' ? 2 : role === 'player3' ? 3 : 0;
  }

  function rennstandClipFolge(rows, runde, ergebnis = false) {
    const folge = [];
    const add = (key, pause = 0.055) => folge.push({ key, pause });
    const zahl = (n) => rennstandZahlFolge(n).forEach((key) => add(key));
    const ende = () => {
      if (folge.length) folge[folge.length - 1].pause = 0.32;
    };
    const wagen = (x) => {
      // Explizite ID hat Vorrang; Hex-Rueckfall fuer alte Daten und bestehende Tests.
      const farbe = CAR_COLORS.find((c) => c.id === x.farbeId)
        || CAR_COLORS.find((c) =>
          String(c.hex).toLowerCase() === String(x.farbe || '').toLowerCase());
      // Bei 'keine' nur den Artikel sprechen: 'der BMW', kein Farbwort.
      add('e:farbe_' + (farbe && farbe.id !== 'keine' ? farbe.id : 'unbekannt'));
      add('e:modell_' + (carModellWert(x.modellId) || 'auto'));
      // Garage-Rollen, nicht Ranglistenplatz: NPCs erhalten keinen Spielerzusatz.
      const nr = rennstandSpielerNr(x.role);
      if (nr) add('e:spieler' + nr);
    };
    const sekunden = (z) => {
      if (z === 10) { add('e:eine_sekunde'); return; }
      zahl(Math.floor(z / 10));
      if (z % 10) { add('n:komma', 0.02); zahl(z % 10); }
      add('e:sekunden');
    };
    const rueckstand = (x) => {
      if (x.rundenZurueck > 0) {
        if (x.rundenZurueck === 1) add('e:eine_runde');
        else { zahl(x.rundenZurueck); add('e:runden'); }
        return;
      }
      if (!Number.isFinite(x.msZurueck)) { add('e:unbekannt'); return; }
      const z = Math.max(0, Math.round(x.msZurueck / 100));
      if (z === 0) { add('e:gleich'); return; }
      const minuten = Math.floor(z / 600), rest = z % 600;
      if (!minuten) { sekunden(rest); return; }
      if (minuten === 1) add('e:eine_minute');
      else { zahl(minuten); add('e:minuten'); }
      if (rest) { add('e:und'); sekunden(rest); }
      else add('e:rueckstand');
    };
    // Rundennummer wie bisher: vollendete Bezugsrunden.
    // Messrunde = vollendete Bezugsrunde. Den bereits vorhandenen Rundenclip
    // verwenden: fuer 'zwischenstand' wurden keine neuen Aufnahmen ausgeliefert.
    if (!ergebnis) { add('e:runde'); zahl(runde); ende(); }
    for (const x of rows.slice(0, 3)) {
      if (x.platz === 1) { add(ergebnis ? 'e:gewonnen' : 'e:fuehrt_start'); wagen(x); }
      else {
        add(x.platz === 2 ? 'e:zweiter' : 'e:dritter');
        rueckstand(x); wagen(x);
      }
      ende();
    }
    return folge;
  }

  // ---- Autonamen ueber die Stimme des Geraets (v1.1.35) ----------------------------
  // Ein frei vergebener Name ("Max Mustermann") laesst sich nicht vorproduzieren. Dann
  // spricht die Stimme des Browsers den GANZEN Satz - Aufnahme und Systemstimme mitten im
  // Satz zu wechseln klingt nach zwei Sprechern. Ohne einen einzigen Namen unter den drei
  // bleiben die Aufnahmen; ohne Systemstimme (Android-App) auch.
  function rennstandNameVon(x) { return String((x && x.alias) || '').trim(); }
  function rennstandStimmeNoetig(rows) {
    return ('speechSynthesis' in window)
      && rows.slice(0, 3).some((x) => rennstandNameVon(x));
  }
  const RENNSTAND_FARBWORT = {
    de: { weiss: 'der weiße', schwarz: 'der schwarze', rot: 'der rote', blau: 'der blaue',
          gruen: 'der grüne', gelb: 'der gelbe', lila: 'der lilafarbene', orange: 'der orangene',
          mehrfarbig: 'der mehrfarbige' },
    en: { weiss: 'the white', schwarz: 'the black', rot: 'the red', blau: 'the blue',
          gruen: 'the green', gelb: 'the yellow', lila: 'the purple', orange: 'the orange',
          mehrfarbig: 'the multicoloured' },
  };
  // Gesprochen, nicht geschrieben: "911" liest die deutsche Stimme sonst "neunhundertelf".
  const RENNSTAND_MODELLWORT = {
    de: { '': 'Wagen', bmw: 'BMW', porsche911: 'Porsche Neun Elf', fordmustang: 'Ford Mustang',
          ferrari: 'Ferrari', audi: 'Audi', mclaren: 'McLaren', mercedes: 'Mercedes',
          redbull: 'Red Bull', vwkaefer: 'VW Käfer' },
    en: { '': 'car', bmw: 'BMW', porsche911: 'Porsche nine eleven', fordmustang: 'Ford Mustang',
          ferrari: 'Ferrari', audi: 'Audi', mclaren: 'McLaren', mercedes: 'Mercedes',
          redbull: 'Red Bull', vwkaefer: 'Volkswagen Beetle' },
  };
  // Derselbe Satzbau wie rennstandClipFolge(), nur als Text. Fahrername: nur der Name, ohne
  // Farbe und ohne "von Spieler eins" - der Name sagt schon, wer es ist. Autobezeichnung:
  // der Name steht an der Stelle der Marke ("der rote Porsche s42").
  function rennstandText(rows, runde, ergebnis, spr) {
    const de = spr === 'de', L = de ? 'de' : 'en';
    const wagen = (x) => {
      const name = rennstandNameVon(x);
      if (name && rennstandNamensart === 'fahrer') return name;
      const farbe = CAR_COLORS.find((c) => c.id === x.farbeId)
        || CAR_COLORS.find((c) => String(c.hex).toLowerCase() === String(x.farbe || '').toLowerCase());
      const fw = (farbe && RENNSTAND_FARBWORT[L][farbe.id]) || (de ? 'der' : 'the');
      const nr = rennstandSpielerNr(x.role);
      return fw + ' ' + (name || RENNSTAND_MODELLWORT[L][carModellWert(x.modellId)])
        + (nr ? (de ? ' von Spieler ' : ' driven by player ') + nr : '');
    };
    // z in Zehntelsekunden, wie in rennstandClipFolge().
    const sek = (z) => {
      if (z === 10) return de ? 'einer Sekunde' : 'one second';
      const t = z % 10 ? (z / 10).toFixed(1) : String(z / 10);
      return (de ? t.replace('.', ',') : t) + (de ? ' Sekunden' : ' seconds');
    };
    const rueck = (x) => {
      if (x.rundenZurueck > 0) {
        return x.rundenZurueck === 1 ? (de ? 'einer Runde Rückstand' : 'one lap behind')
          : x.rundenZurueck + (de ? ' Runden Rückstand' : ' laps behind');
      }
      if (!Number.isFinite(x.msZurueck)) return de ? 'unbekanntem Rückstand' : 'an unknown gap';
      const z = Math.max(0, Math.round(x.msZurueck / 100));
      if (z === 0) return de ? 'gleichem Wertungsstand' : 'equal race time';
      const min = Math.floor(z / 600), rest = z % 600;
      const minText = min === 1 ? (de ? 'einer Minute' : 'one minute')
        : min + (de ? ' Minuten' : ' minutes');
      const teil = !min ? sek(rest) : rest ? minText + (de ? ' und ' : ' and ') + sek(rest) : minText;
      return teil + (de ? ' Rückstand' : ' behind');
    };
    const saetze = [];
    if (!ergebnis) saetze.push((de ? 'Nach Runde ' : 'After lap ') + runde + '.');
    for (const x of rows.slice(0, 3)) {
      if (x.platz === 1) {
        saetze.push((ergebnis ? (de ? 'Gewonnen hat ' : 'The winner is ')
          : (de ? 'Es führt aktuell ' : 'Currently leading is ')) + wagen(x) + '.');
      } else {
        saetze.push((x.platz === 2 ? (de ? 'Dahinter mit ' : 'Next, with ')
          : (de ? 'Auf Platz drei mit ' : 'In third place, with '))
          + rueck(x) + (de ? ' ' : ', ') + wagen(x) + '.');
      }
    }
    return saetze.join(' ');
  }
  function rennstandSprechen(rows, runde, ergebnis) {
    try {
      const text = rennstandText(rows, runde, ergebnis, lang);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'de' ? 'de-DE' : 'en-US';
      u.rate = rennstandTempoWert(rennstandTempo);
      u.volume = Math.min(1, rennstandLautstaerke);
      const fertig = () => {
        if (rennstandSprache !== u) return;
        rennstandSprache = null; lapAnsageBeendet();
      };
      u.onend = fertig; u.onerror = fertig;
      // Manche Stimmen melden kein Ende: nach grob geschaetzter Sprechdauer freigeben.
      setTimeout(fertig, 3000 + text.length * 110 / u.rate);
      window.speechSynthesis.cancel();
      rennstandSprache = u;
      window.speechSynthesis.speak(u);
      rennstandSatzRunde = ergebnis ? null : runde;
      announceCalls++;
      return true;
    } catch (err) {
      rennstandSprache = null;
      log('Rennstand-Sprachausgabe fehlgeschlagen: ' + err.message, 'info');
      return false;
    }
  }

  async function rennstandClipsLaden(spr) {
    if (!audioCtx || !(rennstandAn || rennstandErgebnisAn)) return null;
    const quelle = spr === 'de' ? 'de' : 'en'; // Spanisch wie vorhandene Clips: Englisch.
    if (rennstandBuffers[quelle]) return rennstandBuffers[quelle];
    if (rennstandLaden[quelle]) return rennstandLaden[quelle];
    rennstandLaden[quelle] = (async () => {
      try {
        const satz = {};
        for (const [path, prefix] of [['audio/zahlen.json', 'n:'], ['audio/rennstand-erweitert.json', 'e:']]) {
          const res = await fetch(path);
          if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
          const manifest = await res.json();
          const entries = Object.entries(manifest[quelle] || {});
          if (!entries.length) throw new Error('Sprache fehlt in ' + path);
          // Kleine Pakete begrenzen parallele Decodes auf Mobilgeraeten.
          for (let i = 0; i < entries.length; i += 4) {
            await Promise.all(entries.slice(i, i + 4).map(async ([key, file]) => {
              const response = await fetch('audio/' + file);
              if (!response.ok) throw new Error(file + ' HTTP ' + response.status);
              satz[prefix + key] = await audioCtx.decodeAudioData(await response.arrayBuffer());
            }));
          }
        }
        rennstandBuffers[quelle] = satz;
        return satz;
      } catch (err) {
        log('Rennstand-Aufnahmen nicht ladbar (' + err.message + '). Keine unvollstaendige Ansage.', 'info');
        return null;
      } finally { delete rennstandLaden[quelle]; }
    })();
    return rennstandLaden[quelle];
  }

  async function rennstandSpielen(rows, runde, ergebnis = false, messung = null) {
    const token = rennstandGeneration, spr = lang;
    if (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
        || performance.now() < lapAnsageRuheBis) return false;
    const perStimme = rennstandStimmeNoetig(rows);
    const satz = perStimme ? null : await rennstandClipsLaden(spr);
    if (token !== rennstandGeneration || spr !== lang
        || !(ergebnis ? rennstandErgebnisAn : rennstandAn) || !soundEnabled
        || rennstandLautstaerke <= 0 || !['laps', 'endurance'].includes(raceMode)
        || !audioCtx || !(ergebnis ? raceState === 'finished'
          : ['racing', 'finishing'].includes(raceState)) || (!perStimme && !satz)) return false;
    // Auch nach dem asynchronen Laden erneut pruefen. Keine Rundenzeit abbrechen.
    if (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
        || performance.now() < lapAnsageRuheBis) return false;
    // Den eingefrorenen Messstand der benannten Runde sprechen, nicht die
    // inzwischen aktuelle Rundenzahl oder Ortung nach dem asynchronen Clip-Laden.
    if (!rows.length || (messung && !rennstandMessstandGueltig(messung))) return false;
    if (perStimme) return rennstandSprechen(rows, runde, ergebnis);
    const folge = rennstandClipFolge(rows, runde, ergebnis);
    const fehlendeClips = [...new Set(folge.filter((x) => !satz[x.key]).map((x) => x.key))];
    if (fehlendeClips.length) {
      log('Rennstand: benoetigte Clips fehlen (' + fehlendeClips.join(', ')
        + '), Ansage ausgelassen.', 'info');
      return false;
    }
    const sprechtempo = rennstandTempoWert(rennstandTempo);
    let t0 = audioCtx.currentTime + 0.03;
    try {
      for (const x of folge) {
        const src = audioCtx.createBufferSource();
        src.buffer = satz[x.key];
        src.playbackRate.value = sprechtempo;
        src.connect(rennstandGain());
        src.onended = () => { rennstandQuellen = rennstandQuellen.filter((q) => q !== src); };
        src.start(t0); rennstandQuellen.push(src);
        t0 += (src.buffer.duration + x.pause) / sprechtempo;
      }
      rennstandBis = t0 + (rennstandHall > 0 ? RENNSTAND_HALL_DAUER : 0); rennstandSatzRunde = ergebnis ? null : runde;
      announceCalls++;
      return true;
    } catch (err) {
      rennstandAbbrechen();
      log('Rennstand-Wiedergabe fehlgeschlagen: ' + err.message, 'info');
      return false;
    }
  }


  function rennstandErgebnisErlaubt() {
    return rennstandErgebnisAn && soundEnabled && rennstandLautstaerke > 0
      && raceState === 'finished' && ['laps', 'endurance'].includes(raceMode);
  }

  function rennstandErgebnisDaten() {
    // Gleiche Fahrzeuge und gleiche Sortierung wie renderRaceResults(), nicht
    // die zeitweise abweichenden Ortungsdaten der Live-Anzeige.
    const cars = raceAllCars().filter((c) => c.role !== 'safetycar'
      && c.role !== 'reinig' && c.laps.length);
    const rows = rennstandWerten(cars);
    rows.sort((a, b) => (b.runden - a.runden)
      || ((a.summe === null ? Infinity : a.summe) - (b.summe === null ? Infinity : b.summe))
      || (cars.findIndex((c) => c.id === a.id) - cars.findIndex((c) => c.id === b.id)));
    const leader = rows[0];
    return rows.map((x, i) => Object.assign({}, x, {
      platz: i + 1, rundenZurueck: leader.runden - x.runden,
      msZurueck: x.runden === leader.runden && x.summe !== null && leader.summe !== null
        ? Math.max(0, x.summe - leader.summe) : null,
    }));
  }

  function rennstandErgebnisNochAuslauf(jetzt) {
    // Rueckfahrt zum Startplatz ist kein Wertungslauf mehr. Nur echte
    // NPC-Auslaufrunden abwarten, hoechstens bis zum vorhandenen Auslauf-Limit.
    return ghostAuslaufBis > jetzt
      && garage.some((c) => c.role === 'ghost' && c.ghost && c.ghost.auslauf);
  }

  function rennstandRennende(fanfare) {
    if (rennstandErgebnisGeplant || rennstandErgebnisGesprochen
        || !rennstandErgebnisErlaubt()) return false;
    rennstandErgebnisGeplant = true;
    const token = rennstandGeneration;
    const fanfareDauer = fanfare && Number.isFinite(fanfare.dauer) ? fanfare.dauer : 0;
    const fanfareBis = audioCtx ? audioCtx.currentTime + fanfareDauer + 0.35 : 0;
    const pruefen = async () => {
      if (token !== rennstandGeneration) return;
      rennstandTimer = null;
      if (!rennstandErgebnisErlaubt()) return;
      if (rennstandErgebnisNochAuslauf(Date.now()) || rennstandBeschaeftigt()
          || lapAnsageBeschaeftigt() || performance.now() < lapAnsageRuheBis
          || (audioCtx && audioCtx.currentTime < fanfareBis)) {
        rennstandTimer = setTimeout(pruefen, 100);
        return;
      }
      const rows = rennstandErgebnisDaten();
      if (!rows.length) return;
      const ok = await rennstandSpielen(rows, rennstandBezugsrunde(rows), true);
      if (token !== rennstandGeneration) return;
      if (ok) rennstandErgebnisGesprochen = true;
      else if (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
          || performance.now() < lapAnsageRuheBis) {
        rennstandTimer = setTimeout(pruefen, 100);
      }
    };
    rennstandTimer = setTimeout(pruefen, 100);
    return true;
  }

  function rennstandErlaubt() {
    return rennstandAn && soundEnabled && rennstandLautstaerke > 0 && !raceFormationLap
      && ['racing', 'finishing'].includes(raceState)
      && ['laps', 'endurance'].includes(raceMode);
  }

  // Keine starre 800-ms-Sprechsperre: Browser-TTS und Zahlenclips werden bis zu
  // ihrem echten Ende beobachtet. Danach 300 ms Abstand, ohne Rundenzeiten zu kuerzen.
  function rennstandWarten(messung, delay) {
    const n = messung.n, rows = messung.rows;
    rennstandWartend = n;
    const token = rennstandGeneration;
    const pruefen = async () => {
      if (token !== rennstandGeneration) return;
      rennstandTimer = null;
      if (!rennstandErlaubt()) { rennstandWartend = null; return; }
      if (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
          || performance.now() < lapAnsageRuheBis) {
        rennstandTimer = setTimeout(pruefen, 100);
        return;
      }
      if (!rennstandMessstandGueltig(messung)) {
        rennstandGemeldet.delete(n); rennstandMesspunkte.set(n, { n, start: Date.now() });
        rennstandWartend = null; return;
      }
      const ok = await rennstandSpielen(rows, n, false, messung);
      if (token !== rennstandGeneration) return;
      if (!ok && !rennstandMessstandGueltig(messung)) {
        rennstandGemeldet.delete(n); rennstandMesspunkte.set(n, { n, start: Date.now() });
        rennstandWartend = null;
      } else if (!ok && (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
          || performance.now() < lapAnsageRuheBis)) {
        rennstandTimer = setTimeout(pruefen, 100);
      } else rennstandWartend = null;
    };
    rennstandTimer = setTimeout(pruefen, Math.max(0, delay));
  }

  // Laufende Zwischenstands-/Ergebnisansagen werden nicht fuer eine neue
  // Spielerzeit unterbrochen. Diese Sprachansage entfaellt, ohne Nachholwarteschlange.
  // Rundenwertung, Anzeige, Bestzeit und Rundenton bleiben unveraendert.
  function rennstandVorRundenzeit() {
    return !rennstandBeschaeftigt();
  }

  function rennstandMessungPruefen() {
    if (rennstandMessTimer !== null) clearTimeout(rennstandMessTimer);
    rennstandMessTimer = null;
    if (!rennstandErlaubt()) return false;
    const cars = rennstandRohdaten();
    const fertig = rennstandMessungAktualisieren(cars, rennstandIntervall,
      rennstandMesspunkte, rennstandGemeldet);
    if (rennstandMesspunkte.size) {
      const token = rennstandMessGeneration;
      rennstandMessTimer = setTimeout(() => {
        if (token === rennstandMessGeneration) rennstandMessungPruefen();
      }, 100);
    }
    if (!fertig.length) return false;
    const messung = fertig[fertig.length - 1];
    if (messung.timeout) log('Rennstand nach Runde ' + messung.n
      + ': Wartegrenze erreicht; nur ' + messung.rows.length
      + ' gemessene Fahrzeuge angesagt, keine erfundene Ueberrundung.', 'info');
    if (rennstandTimer !== null) clearTimeout(rennstandTimer);
    if (!rennstandBeschaeftigt()) rennstandAbbrechen();
    else rennstandGeneration++;
    rennstandWarten(messung, 100);
    return true;
  }

  function rennstandRunde() {
    if (!rennstandErlaubt()) return false;
    // Boxen-Doppeltrigger erst nach der moeglichen Rundenruecknahme auswerten.
    const token = rennstandMessGeneration;
    if (pitLaneEnabled && pitTrigger === 'double' && pitDoubleRunden === 0) {
      setTimeout(() => {
        if (token === rennstandMessGeneration) rennstandMessungPruefen();
      }, PIT_DOUBLE_WINDOW_MS + 50);
      return true;
    }
    return rennstandMessungPruefen();
  }

  // Die vorhandene Selbstsicherung (98b-sicherung.js) speichert beide Controls.
  // Kein zweiter localStorage-Wert, der beim Start die Selbstsicherung ueberschreibt.
  // data-preset-skip haelt die Fahrzeug-Abstimmungen unabhaengig.
  const rennstandSchalter = $('setting-announce-stand');
  const rennstandRegler = $('setting-announce-stand-interval');
  if (rennstandSchalter) {
    rennstandSchalter.checked = rennstandAn;
    rennstandSchalter.addEventListener('change', () => {
      rennstandAn = rennstandSchalter.checked;
      rennstandMesspunkte.clear(); rennstandMessGeneration++;
      rennstandAbbrechen();
      if (rennstandAn) rennstandClipsLaden(lang);
    });
  }
  if (rennstandRegler) {
    rennstandRegler.value = String(rennstandIntervall);
    rennstandRegler.addEventListener('change', () => {
      rennstandIntervall = rennstandIntervallWert(rennstandRegler.value);
      rennstandMesspunkte.clear(); rennstandMessGeneration++;
      rennstandRegler.value = String(rennstandIntervall);
      rennstandAbbrechen();
    });
    numSteuer('setting-announce-stand-interval');
  }

  const rennstandErgebnisSchalter = $('setting-announce-result');
  if (rennstandErgebnisSchalter) {
    rennstandErgebnisAn = rennstandErgebnisSchalter.checked;
    rennstandErgebnisSchalter.addEventListener('change', () => {
      rennstandErgebnisAn = rennstandErgebnisSchalter.checked;
      if (rennstandErgebnisAn) rennstandClipsLaden(lang);
    });
  }
  const rennstandNamensWahl = $('setting-announce-stand-namensart');
  if (rennstandNamensWahl) {
    const lesen = () => { rennstandNamensart = rennstandNamensWahl.value === 'fahrer' ? 'fahrer' : 'auto'; };
    rennstandNamensWahl.addEventListener('change', lesen);
    lesen();
  }

  // Selbstsicherung speichert den Parameter; laufende Messpunkte bleiben erhalten.
  const rennstandWarteRegler = $('setting-announce-stand-wait');
  if (rennstandWarteRegler) {
    const lesen = () => {
      rennstandWarteSekunden = rennstandWarteWert(rennstandWarteRegler.value);
      rennstandWarteRegler.value = String(rennstandWarteSekunden);
    };
    rennstandWarteRegler.addEventListener('change', lesen);
    lesen();
    numSteuer('setting-announce-stand-wait');
  }

  i18nOnLangChange(() => {
    rennstandAbbrechen();
    if (rennstandAn) rennstandClipsLaden(lang);
  });

  function rennstandTempoWert(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(1, Math.min(1.75, n)) : 1;
  }
  function rennstandLautWert(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 1;
  }
  function rennstandHallWert(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }
  function rennstandHallAnwenden() {
    if (!rennstandHallWet) return;
    rennstandHallDry.gain.setTargetAtTime(1 - 0.2 * rennstandHall, audioCtx.currentTime, 0.02);
    rennstandHallWet.gain.setTargetAtTime(rennstandHall * 0.7, audioCtx.currentTime, 0.02);
  }
  function rennstandGain() {
    if (!rennstandBus || rennstandBus.context !== audioCtx) {
      if (rennstandBus) { try { rennstandBus.disconnect(); } catch (e) {} }
      rennstandBus = audioCtx.createGain();
      if (rennstandKompressor) { try { rennstandKompressor.disconnect(); } catch (e) {} }
      // Nur der Rennstand erhaelt den Boost und eine Begrenzung lauter Spitzen.
      rennstandKompressor = audioCtx.createDynamicsCompressor();
      rennstandKompressor.threshold.value = -3;
      rennstandKompressor.knee.value = 3;
      rennstandKompressor.ratio.value = 20;
      rennstandKompressor.attack.value = 0.003;
      rennstandKompressor.release.value = 0.08;
      for (const node of rennstandHallNodes) { try { node.disconnect(); } catch (e) {} }
      rennstandHallDry = audioCtx.createGain();
      rennstandHallWet = audioCtx.createGain();
      const hall = audioCtx.createConvolver();
      hall.normalize = false;
      const impulse = audioCtx.createBuffer(2, Math.ceil(audioCtx.sampleRate * RENNSTAND_HALL_DAUER), audioCtx.sampleRate);
      // Festes diffuses Stereo-Nachhallmuster, keine externe Audiodatei.
      let seed = 314159;
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          seed = (1664525 * seed + 1013904223) >>> 0;
          const t = i / audioCtx.sampleRate;
          data[i] = t < 0.035 ? 0 : (seed / 4294967296 * 2 - 1)
            * Math.exp(-6 * t / RENNSTAND_HALL_DAUER) * 0.06;
        }
      }
      hall.buffer = impulse;
      rennstandBus.connect(rennstandHallDry).connect(rennstandKompressor);
      rennstandBus.connect(hall).connect(rennstandHallWet).connect(rennstandKompressor);
      rennstandKompressor.connect(audioCtx.destination);
      rennstandHallNodes = [hall, rennstandHallDry, rennstandHallWet];
      rennstandHallAnwenden();
    }
    rennstandBus.gain.value = rennstandLautstaerke;
    return rennstandBus;
  }
  // Selbstsicherung speichert diese Controls; getrennt von Fahrzeug-Presets.
  [
    ['setting-announce-stand-reverb', rennstandHallWert, (v) => {
      rennstandHall = v; rennstandHallAnwenden();
    }],
    ['setting-announce-stand-speed', rennstandTempoWert, (v) => {
      // Tempo pro Ansage festhalten, damit die Clip-Startzeiten zusammenpassen.
      rennstandTempo = v;
    }],
    ['setting-announce-stand-volume', rennstandLautWert, (v) => {
      rennstandLautstaerke = v;
      if (rennstandBus) rennstandBus.gain.setTargetAtTime(v, audioCtx.currentTime, 0.015);
      if (v === 0) rennstandAbbrechen();
    }],
  ].forEach(([id, normalisieren, setzen]) => {
    const el = $(id), anzeige = $(id + '-val');
    if (!el) return;
    const lesen = () => {
      const v = normalisieren(el.value);
      el.value = String(v); setzen(v);
      if (anzeige) anzeige.textContent = Math.round(v * 100) + '%';
    };
    el.addEventListener('input', lesen);
    el.addEventListener('change', lesen);
    lesen();
  });
