  // =========================================================================
  // Rennstand aus lokalen Rennwertungsdaten und vorproduzierten Piper-Clips.
  // Keine Namen-TTS, kein Onlinedienst und keine native Android-Erweiterung.
  // =========================================================================
  let rennstandAn = false, rennstandIntervall = 5;
  let rennstandTempo = 1, rennstandLautstaerke = 1, rennstandBus = null;
  // UI-/Speicherparameter fuer die tempo-unabhaengige Tonhoehenverarbeitung.
  let rennstandTonhoehe = 0;
  let rennstandHall = 0, rennstandHallWet = null, rennstandHallDry = null;
  let rennstandHallNodes = [];
  const RENNSTAND_HALL_DAUER = 1.2;
  const RENNSTAND_PITCH_CACHE = new WeakMap();
  let rennstandTestTimer = null, rennstandTestGeneration = 0;
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
  // Stimme: bisheriges Auto-Verhalten beibehalten, optional Clips oder System-TTS erzwingen.
  let rennstandStimmenModus = 'auto', rennstandBrowserStimme = '';

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
    rennstandTestGeneration++;
    if (rennstandTestTimer !== null) clearTimeout(rennstandTestTimer);
    rennstandTestTimer = null;
    rennstandTestSetBusy(false);
    rennstandTestStatus('');
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

  // Die Browser-TTS liest eine deutsche Ziffer mit abschliessendem Punkt als Ordinalzahl
  // ("3." -> "dritte"). Deshalb Rundenzahlen fuer diesen Pfad ausschreiben, parallel zu
  // den vorproduzierten Zahlclips: 0..60 als Grundzahl, darueber ziffernweise.
  function rennstandRundenzahlText(wert) {
    const zahl = Number(wert);
    const n = Number.isFinite(zahl) ? Math.max(0, Math.round(zahl)) : 0;
    const bisZwanzig = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs',
      'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn',
      'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig'];
    const einheiten = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben',
      'acht', 'neun'];
    const zehner = { 2: 'zwanzig', 3: 'dreißig', 4: 'vierzig',
      5: 'fünfzig', 6: 'sechzig' };
    if (n <= 20) return bisZwanzig[n];
    if (n <= 60) {
      const rest = n % 10, dekade = Math.floor(n / 10);
      return rest ? einheiten[rest] + 'und' + zehner[dekade] : zehner[dekade];
    }
    const ziffern = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
    return String(n).split('').map((z) => ziffern[Number(z)]).join(' ');
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
  function rennstandWebSpeechVerfuegbar() {
    return typeof window !== 'undefined' && !!window.speechSynthesis
      && typeof window.speechSynthesis.speak === 'function'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }
  function rennstandBrowserVoiceKey(stimme) {
    return String(stimme.voiceURI || (stimme.name + '|' + stimme.lang));
  }
  function rennstandBrowserStimmeFinden() {
    if (!rennstandBrowserStimme || !rennstandWebSpeechVerfuegbar()) return null;
    try {
      return window.speechSynthesis.getVoices().find((v) =>
        rennstandBrowserVoiceKey(v) === rennstandBrowserStimme) || null;
    } catch (e) { return null; }
  }
  function rennstandStimmeNoetig(rows) {
    if (!rennstandWebSpeechVerfuegbar() || rennstandStimmenModus === 'clips') return false;
    if (rennstandStimmenModus === 'browser') return true;
    return rows.slice(0, 3).some((x) => rennstandNameVon(x));
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
    if (!ergebnis) saetze.push((de ? 'Nach Runde ' + rennstandRundenzahlText(runde)
      : 'After lap ' + runde) + '.');
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
      const browserStimme = rennstandBrowserStimmeFinden();
      if (browserStimme) u.voice = browserStimme;
      u.rate = rennstandTempoWert(rennstandTempo);
      // Web Speech kann die Stimme unabhaengig von der Sprechrate transponieren.
      u.pitch = rennstandPitchRatio(rennstandTonhoehe);
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

  async function rennstandClipsLaden(spr, force = false) {
    if (!audioCtx || (!force && !(rennstandAn || rennstandErgebnisAn))) return null;
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
    // Pitch-Shift vor dem Einplanen berechnen. Er veraendert nicht die Clipdauer;
    // die Sprechgeschwindigkeit wird erst bei playbackRate angewandt.
    if (token !== rennstandGeneration || spr !== lang || !soundEnabled
        || rennstandLautstaerke <= 0 || !['laps', 'endurance'].includes(raceMode)
        || !audioCtx || !(ergebnis ? raceState === 'finished'
          : ['racing', 'finishing'].includes(raceState)) || (!perStimme && !satz)
        || rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
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
    const pitch = rennstandTonhoeheWert(rennstandTonhoehe);
    const pitchRatio = rennstandPitchRatio(pitch);
    const effektivTempo = sprechtempo * pitchRatio;
    try {
      const vorbereitet = folge.map((x) => ({ x, buffer: rennstandPitchBuffer(satz[x.key], pitch) }));
      let t0 = audioCtx.currentTime + 0.03;
      for (const item of vorbereitet) {
        const src = audioCtx.createBufferSource();
        src.buffer = item.buffer;
        src.playbackRate.value = effektivTempo;
        src.connect(rennstandGain());
        src.onended = () => { rennstandQuellen = rennstandQuellen.filter((q) => q !== src); };
        src.start(t0); rennstandQuellen.push(src);
        t0 += (src.buffer.duration + item.x.pause * pitchRatio) / effektivTempo;
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


  function rennstandTestClipFolge() {
    // Lokale Piper-Aufnahmen: der Test benutzt exakt denselben Effektpfad wie das Rennen.
    return [
      { key: 'e:runde', pause: 0.08 },
      { key: 'n:5', pause: 0.42 },
      { key: 'e:fuehrt_start', pause: 0.05 },
      { key: 'e:farbe_rot', pause: 0.05 },
      { key: 'e:modell_porsche911', pause: 0.32 },
    ];
  }

  function rennstandTestSetBusy(busy) {
    const button = $('setting-announce-stand-test');
    if (button) {
      button.disabled = !!busy;
      button.textContent = busy
        ? (lang === 'de' ? 'Spielt …' : lang === 'es' ? 'Reproduciendo …' : 'Playing …')
        : (lang === 'de' ? 'Testen' : lang === 'es' ? 'Probar' : 'Test');
    }
  }

  function rennstandTestStatus(text) {
    const el = $('setting-announce-stand-test-status');
    if (el) el.textContent = text || '';
  }

  function rennstandBrowserTestSprechen(token, spr) {
    if (!rennstandWebSpeechVerfuegbar()) throw new Error('Browser-/Systemstimme ist nicht verfuegbar');
    const text = spr === 'de'
      ? 'Wir sind in Runde fünf. Es führt der rote Porsche.'
      : 'We are on lap five. The red Porsche is leading.';
    const u = new SpeechSynthesisUtterance(text);
    u.lang = spr === 'de' ? 'de-DE' : 'en-US';
    const browserStimme = rennstandBrowserStimmeFinden();
    if (browserStimme) u.voice = browserStimme;
    u.rate = rennstandTempoWert(rennstandTempo);
    u.pitch = rennstandPitchRatio(rennstandTonhoehe);
    u.volume = Math.min(1, rennstandLautstaerke);
    const fertig = () => {
      if (token !== rennstandTestGeneration || rennstandSprache !== u) return;
      if (rennstandTestTimer !== null) clearTimeout(rennstandTestTimer);
      rennstandTestTimer = null;
      rennstandSprache = null;
      rennstandTestSetBusy(false);
      rennstandTestStatus('');
    };
    u.onend = fertig; u.onerror = fertig;
    window.speechSynthesis.cancel();
    rennstandSprache = u;
    rennstandSatzRunde = null;
    rennstandTestStatus(spr === 'de'
      ? 'Browserstimme spielt; Hall und Lautstärke-Boost sind hier nicht verfügbar.'
      : 'System voice playing; reverb and volume boost are unavailable here.');
    rennstandTestTimer = setTimeout(fertig, 3000 + text.length * 110 / u.rate);
    window.speechSynthesis.speak(u);
    announceCalls++;
    return true;
  }

  async function rennstandTesten() {
    if (rennstandBeschaeftigt() || lapAnsageBeschaeftigt()
        || performance.now() < lapAnsageRuheBis) {
      rennstandTestStatus(lang === 'de' ? 'Bitte laufende Ansage abwarten.' : 'Please wait for the current announcement.');
      return false;
    }
    if (!soundEnabled) {
      rennstandTestStatus(lang === 'de' ? 'App-Ton ist ausgeschaltet.' : 'App sound is disabled.');
      return false;
    }
    if (rennstandLautstaerke <= 0) {
      rennstandTestStatus(lang === 'de' ? 'Rennstand-Lautstärke steht auf 0 %.' : 'Announcement volume is 0%.');
      return false;
    }
    const token = ++rennstandTestGeneration, spr = lang;
    rennstandTestSetBusy(true);
    rennstandTestStatus(lang === 'de' ? 'Beispiel wird vorbereitet …' : 'Preparing sample …');
    try {
      // Der Modus Browserstimme muss keinen AudioContext fuer die Wiedergabe verwenden.
      if (rennstandStimmenModus === 'browser') return await rennstandBrowserTestSprechen(token, spr);
      // Der Klick ist die Nutzeraktion, die AudioContext auf Mobilgeraeten freischaltet.
      if (typeof initEngineSound === 'function') initEngineSound();
      if (!audioCtx) throw new Error('AudioContext nicht verfuegbar');
      const ctx = audioCtx;
      const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
      const satzPromise = rennstandClipsLaden(spr, true);
      await Promise.all([resume, satzPromise]);
      const satz = await satzPromise;
      if (token !== rennstandTestGeneration || spr !== lang || ctx !== audioCtx) return false;
      if (!satz) throw new Error('Rennstand-Clips konnten nicht geladen werden');
      const folge = rennstandTestClipFolge();
      const fehlend = folge.filter((x) => !satz[x.key]).map((x) => x.key);
      if (fehlend.length) throw new Error('Testclips fehlen: ' + fehlend.join(', '));

      const pitch = rennstandTonhoeheWert(rennstandTonhoehe);
      const pitchRatio = rennstandPitchRatio(pitch);
      const tempo = rennstandTempoWert(rennstandTempo);
      const effektivTempo = tempo * pitchRatio;
      const vorbereitet = folge.map((x) => ({ x, buffer: rennstandPitchBuffer(satz[x.key], pitch) }));
      let t0 = audioCtx.currentTime + 0.03;
      for (const item of vorbereitet) {
        const src = audioCtx.createBufferSource();
        src.buffer = item.buffer;
        src.playbackRate.value = effektivTempo;
        src.connect(rennstandGain());
        src.onended = () => { rennstandQuellen = rennstandQuellen.filter((q) => q !== src); };
        src.start(t0); rennstandQuellen.push(src);
        t0 += (src.buffer.duration + item.x.pause * pitchRatio) / effektivTempo;
      }
      rennstandTestStatus(lang === 'de'
        ? 'Nach Runde 5 – Es führt aktuell der rote Porsche 911.' : 'Sample is playing with the current settings.');
      rennstandBis = t0 + (rennstandHall > 0 ? RENNSTAND_HALL_DAUER : 0);
      rennstandSatzRunde = null;
      const dauer = Math.max(0, (rennstandBis - audioCtx.currentTime) * 1000);
      rennstandTestTimer = setTimeout(() => {
        if (token !== rennstandTestGeneration) return;
        rennstandTestTimer = null;
        rennstandTestSetBusy(false);
        rennstandTestStatus('');
      }, dauer);
      announceCalls++;
      return true;
    } catch (err) {
      if (token === rennstandTestGeneration) {
        rennstandTestSetBusy(false);
        rennstandTestStatus('Test fehlgeschlagen: ' + err.message);
      }
      log('Rennstand-Test fehlgeschlagen: ' + err.message, 'info');
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

  const rennstandStimmenModusWahl = $('setting-announce-stand-voice-mode');
  if (rennstandStimmenModusWahl) {
    const browserOption = [...rennstandStimmenModusWahl.options].find((o) => o.value === 'browser');
    if (browserOption) browserOption.disabled = !rennstandWebSpeechVerfuegbar();
    const lesen = () => {
      let modus = ['auto', 'clips', 'browser'].includes(rennstandStimmenModusWahl.value)
        ? rennstandStimmenModusWahl.value : 'auto';
      if (modus === 'browser' && !rennstandWebSpeechVerfuegbar()) modus = 'clips';
      rennstandStimmenModus = modus;
      rennstandStimmenModusWahl.value = modus;
      const hinweis = $('setting-announce-stand-voice-help');
      if (hinweis)       hinweis.textContent = !rennstandWebSpeechVerfuegbar()
        ? 'Diese Plattform bietet keine Browserstimme; es werden vorproduzierte Clips verwendet.'
        : modus === 'browser'
          ? 'Browserstimme für alle Rennstand-Ansagen. Tempo und Pitch gelten; Hall und Lautstärke-Boost nur bei Clips.'
          : modus === 'clips'
            ? 'Immer die vorproduzierten Clips verwenden. Eigene Garagennamen werden dabei nicht gesprochen.'
            : 'Automatisch: bei eigenen Garagennamen Browserstimme, sonst vorproduzierte Clips.';
    };
    rennstandStimmenModusWahl.addEventListener('change', lesen);
    lesen();
  }

  const rennstandBrowserStimmenWahl = $('setting-announce-stand-browser-voice');
  const rennstandBrowserStimmenSchluessel = $('setting-announce-stand-browser-voice-key');
  function rennstandBrowserStimmenAktualisieren() {
    const select = rennstandBrowserStimmenWahl;
    if (!select) return;
    const gespeicherterSchluessel = (rennstandBrowserStimmenSchluessel && rennstandBrowserStimmenSchluessel.value)
      || select.value || rennstandBrowserStimme;
    let stimmen = [];
    if (rennstandWebSpeechVerfuegbar()) {
      try { stimmen = window.speechSynthesis.getVoices() || []; } catch (e) { stimmen = []; }
    }
    select.replaceChildren();
    const standard = document.createElement('option');
    standard.value = '';
    standard.textContent = 'Systemstandardstimme';
    select.appendChild(standard);
    const gesehen = new Set();
    for (const stimme of stimmen) {
      const key = rennstandBrowserVoiceKey(stimme);
      if (gesehen.has(key)) continue;
      gesehen.add(key);
      const option = document.createElement('option');
      option.value = key;
      option.textContent = stimme.name + (stimme.lang ? ' (' + stimme.lang + ')' : '')
        + (stimme.default ? ' – Standard' : '');
      select.appendChild(option);
    }
    const verfuegbar = gesehen.has(gespeicherterSchluessel);
    select.value = verfuegbar ? gespeicherterSchluessel : '';
    rennstandBrowserStimme = select.value;
    select.disabled = !rennstandWebSpeechVerfuegbar() || stimmen.length === 0;
    const hinweis = $('setting-announce-stand-browser-voice-help');
    if (hinweis) hinweis.textContent = !rennstandWebSpeechVerfuegbar()
      ? 'Keine Browserstimme verfügbar.'
      : stimmen.length
        ? 'Die Liste kommt vom Browser/Gerät; Stimmen können je nach Plattform variieren.'
        : 'Stimmen werden vom Browser geladen. Falls die Liste leer bleibt, wird die Systemstandardstimme verwendet.';
  }
  if (rennstandBrowserStimmenWahl) {
    rennstandBrowserStimmenWahl.addEventListener('change', () => {
      rennstandBrowserStimme = rennstandBrowserStimmenWahl.value || '';
      if (rennstandBrowserStimmenSchluessel) rennstandBrowserStimmenSchluessel.value = rennstandBrowserStimme;
    });
    if (rennstandBrowserStimmenSchluessel) {
      rennstandBrowserStimmenSchluessel.addEventListener('change', rennstandBrowserStimmenAktualisieren);
    }
    rennstandBrowserStimmenAktualisieren();
    if (rennstandWebSpeechVerfuegbar() && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', rennstandBrowserStimmenAktualisieren);
    }
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

  const rennstandTonhoeheRegler = $('setting-announce-stand-pitch');
  if (rennstandTonhoeheRegler) {
    const anzeige = $('setting-announce-stand-pitch-val');
    const lesen = () => {
      rennstandTonhoehe = rennstandTonhoeheWert(rennstandTonhoeheRegler.value);
      rennstandTonhoeheRegler.value = String(rennstandTonhoehe);
      if (anzeige) anzeige.textContent = rennstandTonhoeheText(rennstandTonhoehe);
    };
    rennstandTonhoeheRegler.addEventListener('input', lesen);
    rennstandTonhoeheRegler.addEventListener('change', lesen);
    lesen();
  }

  i18nOnLangChange(() => {
    rennstandAbbrechen();
    if (rennstandAn) rennstandClipsLaden(lang);
    rennstandBrowserStimmenAktualisieren();
    const anzeige = $('setting-announce-stand-pitch-val');
    if (anzeige) anzeige.textContent = rennstandTonhoeheText(rennstandTonhoehe);
    rennstandTestSetBusy(false);
  });

  function rennstandTonhoeheWert(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-6, Math.min(6, Math.round(n))) : 0;
  }
  function rennstandPitchRatio(v) {
    return Math.pow(2, rennstandTonhoeheWert(v) / 12);
  }

  function rennstandFFT(real, imag, inverse = false) {
    const n = real.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        let value = real[i]; real[i] = real[j]; real[j] = value;
        value = imag[i]; imag[i] = imag[j]; imag[j] = value;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / size;
      const stepReal = Math.cos(angle), stepImag = Math.sin(angle);
      for (let base = 0; base < n; base += size) {
        let wr = 1, wi = 0;
        for (let k = 0; k < size / 2; k++) {
          const even = base + k, odd = even + size / 2;
          const tr = wr * real[odd] - wi * imag[odd];
          const ti = wr * imag[odd] + wi * real[odd];
          real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
          real[even] += tr; imag[even] += ti;
          const nextWr = wr * stepReal - wi * stepImag;
          wi = wr * stepImag + wi * stepReal; wr = nextWr;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
    }
  }

  function rennstandPitchBuffer(original, semitones) {
    const pitch = rennstandTonhoeheWert(semitones);
    if (!original || pitch === 0) return original;
    const cached = RENNSTAND_PITCH_CACHE.get(original);
    if (cached && cached.pitch === pitch) return cached.buffer;

    // Phase-Vocoder: Zeitdehnung um das Pitch-Verhaeltnis, anschliessend
    // Resampling mit demselben Faktor. Die Clipdauer bleibt dadurch unveraendert.
    const ratio = rennstandPitchRatio(pitch);
    const fftSize = 1024, hop = fftSize >> 2, half = fftSize >> 1;
    const analysisHop = hop / ratio;
    const frameCount = Math.ceil((original.length + half) / analysisHop) + 1;
    const stretchedLength = frameCount * hop + fftSize;
    const window = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
    const norm = new Float64Array(stretchedLength);
    const channels = [];

    for (let channel = 0; channel < original.numberOfChannels; channel++) {
      const input = original.getChannelData(channel);
      const output = new Float64Array(stretchedLength);
      const real = new Float64Array(fftSize), imag = new Float64Array(fftSize);
      const previous = new Float64Array(half + 1), synthesis = new Float64Array(half + 1);
      let first = true;
      for (let frame = 0; frame < frameCount; frame++) {
        const center = Math.round(frame * analysisHop), inputStart = center - half;
        real.fill(0); imag.fill(0);
        for (let i = 0; i < fftSize; i++) {
          const sourceIndex = inputStart + i;
          if (sourceIndex >= 0 && sourceIndex < input.length) real[i] = input[sourceIndex] * window[i];
        }
        rennstandFFT(real, imag);
        for (let k = 0; k <= half; k++) {
          const magnitude = Math.hypot(real[k], imag[k]);
          const phase = Math.atan2(imag[k], real[k]);
          if (first) synthesis[k] = phase;
          else {
            const expected = 2 * Math.PI * k * analysisHop / fftSize;
            let delta = phase - previous[k] - expected;
            delta = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            const omega = 2 * Math.PI * k / fftSize + delta / analysisHop;
            synthesis[k] += omega * hop;
          }
          previous[k] = phase;
          real[k] = magnitude * Math.cos(synthesis[k]);
          imag[k] = magnitude * Math.sin(synthesis[k]);
          if (k > 0 && k < half) {
            real[fftSize - k] = real[k]; imag[fftSize - k] = -imag[k];
          }
        }
        first = false;
        rennstandFFT(real, imag, true);
        const outputStart = frame * hop;
        for (let i = 0; i < fftSize; i++) {
          output[outputStart + i] += real[i] * window[i];
          if (channel === 0) norm[outputStart + i] += window[i] * window[i];
        }
      }
      channels.push(output);
    }

    const length = Math.max(1, Math.round(original.length * ratio));
    const shifted = audioCtx.createBuffer(original.numberOfChannels, length, original.sampleRate);
    for (let channel = 0; channel < original.numberOfChannels; channel++) {
      const source = channels[channel], target = shifted.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const index = half + i;
        target[i] = index < source.length && norm[index] > 1e-10 ? source[index] / norm[index] : 0;
      }
    }
    RENNSTAND_PITCH_CACHE.set(original, { pitch, buffer: shifted });
    return shifted;
  }

  function rennstandTonhoeheText(v) {
    const n = rennstandTonhoeheWert(v), betrag = Math.abs(n);
    const einheit = lang === 'de' ? (betrag === 1 ? 'Halbton' : 'Halbtöne')
      : lang === 'es' ? (betrag === 1 ? 'semitono' : 'semitonos')
      : (betrag === 1 ? 'semitone' : 'semitones');
    return (n > 0 ? '+' : '') + n + ' ' + einheit;
  }
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

  const rennstandTestKnopf = $('setting-announce-stand-test');
  if (rennstandTestKnopf) {
    rennstandTestKnopf.addEventListener('click', () => { rennstandTesten(); });
    i18nOnLangChange(() => rennstandTestSetBusy(false));
  }
