  // Lokales Rennintro auf Basis v1.1.44. Kein gemeinsamer Mehrspieler-Vorlauf.
  // Eigener Schalter, gespeichert durch die vorhandene Selbstsicherung.
  let rennintroAn = false, rennintroGeneration = 0, rennintroTimer = null;
  let rennintroStartGeneration = 0;
  let rennintroFertig = null, rennintroQuellen = [], rennintroAktiv = false;
  const rennintroBuffers = new Map();
  // Die vollstaendige Aufstellung braucht bei mehreren Autos mehr als 40 Sekunden.
  // Begrenzte parallele Downloads verhindern lange serielle Clip-Ladezeiten.
  // Ladelimit 20 s statt 10 s: auf langsamen Handys reichte das beim ersten Start nicht.
  // Einmal geladene Clips bleiben in rennintroBuffers; reisst das Limit, laufen die
  // Downloads im Hintergrund weiter und fuellen den Speicher fuer den naechsten Start.
  const RENINTRO_LADE_MS = 20000, RENINTRO_MAX_MS = 180000;

  function rennintroAbbrechen() {
    rennintroGeneration++;
    if (rennintroTimer !== null) clearTimeout(rennintroTimer);
    rennintroTimer = null;
    for (const q of rennintroQuellen) {
      q.onended = null;
      try { q.stop(); } catch (e) {}
      try { q.disconnect(); } catch (e) {}
    }
    rennintroQuellen = []; rennintroAktiv = false;
    const fertig = rennintroFertig; rennintroFertig = null;
    if (fertig) fertig(false);
  }

  // Dieselbe Reihenfolge wie auf dem Startschirm, nicht Garage oder Live-Rangliste.
  // Safety Car / Reinigungsauto sind in raceGridCars() bereits ausgeschlossen.
  // Identitaeten einmal kopieren: spaetere Garagenaenderungen aendern das Intro nicht.
  function rennintroStartaufstellung() {
    return raceGridCars().map((car) => {
      const farbe = carColor(car);
      return { farbeId: farbe.id, modellId: carModellWert(car.modellId) };
    });
  }

  function rennintroTeilnehmerFolge(aufstellung) {
    const folge = [];
    const cars = Array.isArray(aufstellung) ? aufstellung : [];
    if (cars.length === 1) folge.push('i:teilnehmer_einer');
    else folge.push('i:teilnehmer_anfang', ...rennstandZahlFolge(cars.length), 'i:teilnehmer_ende');
    cars.forEach((car, i) => {
      const farbeId = car && car.farbeId;
      const farbe = CAR_COLORS.some((c) => c.id === farbeId) && farbeId !== 'keine'
        ? farbeId : 'unbekannt';
      const modell = carModellWert(car && car.modellId) || 'auto';
      folge.push('i:startposition', ...rennstandZahlFolge(i + 1), 'i:startposition_wagen',
        'i:startfarbe_' + farbe, 'i:startmodell_' + modell);
    });
    return folge;
  }

  function rennintroFolge(modus, limit, wetter, pflichtstopps = 0, aufstellung = []) {
    const folge = ['i:willkommen', 'i:modus_' + modus];
    const n = Number.isFinite(limit) ? Math.max(0, Math.round(limit)) : 0;
    if (modus === 'laps' && n > 0) {
      folge.push('i:distanz');
      if (n === 1) folge.push('i:runde');
      else folge.push(...rennstandZahlFolge(n), 'i:runden');
    } else if (['practice', 'bestzeit', 'qualifying', 'endurance'].includes(modus)) {
      if (n > 0) {
        folge.push('i:zeitlimit');
        if (n === 1) folge.push('i:minute');
        else folge.push(...rennstandZahlFolge(n), 'i:minuten');
      }
      else folge.push('i:ohne_limit');
    }
    const stopps = Number.isFinite(pflichtstopps) ? Math.max(0, Math.round(pflichtstopps)) : 0;
    if (stopps === 0) folge.push('i:boxenstopps_keine');
    else if (stopps === 1) folge.push('i:boxenstopp_einer');
    else folge.push('i:boxenstopps_anzahl', ...rennstandZahlFolge(stopps), 'i:boxenstopps_pflicht');
    folge.push(...rennintroTeilnehmerFolge(aufstellung));
    folge.push(wetter === 'rain' ? 'i:wetter_regen' : 'i:wetter_trocken', 'i:bereit');
    return folge;
  }

  // Fehlt ein einzelner Clip (nicht im Manifest, HTTP-Fehler, nicht dekodierbar), wird nur
  // er ausgelassen. Vorher brach ein einzelner Fehler das ganze Intro ab, obwohl der
  // Optionstext "fehlende Aufnahmen werden ausgelassen" verspricht. Nur ein Abbruch
  // (Stopp, Neustart) bricht das Laden ab.
  async function rennintroClipsLaden(folge, spr, signal) {
    const quelle = spr === 'de' ? 'de' : 'en';
    const satz = {}, manifests = {}, fehlend = [];
    const keys = [...new Set(folge)];
    let cursor = 0;
    const laden = async (key) => {
      if (signal.aborted) throw new Error('Laden abgebrochen');
      try { await ladenEiner(key); } catch (e) {
        if (signal.aborted) throw e;
        fehlend.push(key + ' (' + e.message + ')');
      }
    };
    const ladenEiner = async (key) => {
      const cacheKey = quelle + ':' + key;
      if (rennintroBuffers.has(cacheKey)) { satz[key] = rennintroBuffers.get(cacheKey); return; }
      const prefix = key.slice(0, 2), name = key.slice(2);
      if (prefix !== 'n:' && prefix !== 'i:') throw new Error('Unbekannter Clip: ' + key);
      if (!manifests[prefix]) {
        const path = prefix === 'n:' ? 'audio/zahlen.json' : 'audio/rennintro.json';
        manifests[prefix] = (async () => {
          const res = await fetch(path, { signal });
          if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
          return (await res.json())[quelle];
        })();
      }
      const katalog = await manifests[prefix];
      const file = katalog && katalog[name];
      if (!file) throw new Error('Clip fehlt: ' + key);
      const res = await fetch('audio/' + file, { signal });
      if (!res.ok) throw new Error(file + ' HTTP ' + res.status);
      const buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
      if (signal.aborted) throw new Error('Laden abgebrochen');
      rennintroBuffers.set(cacheKey, buffer); satz[key] = buffer;
    };
    // Hoechstens sechs Requests gleichzeitig; jedes Manifest nur einmal anfordern.
    await Promise.all(Array.from({ length: Math.min(6, keys.length) }, async () => {
      while (cursor < keys.length) await laden(keys[cursor++]);
    }));
    return { satz, fehlend };
  }

  // Challenges ausgenommen: sie haben ihren eigenen Ablauf ("Auto muss stehen, dann kommt
  // eine Ampel"), und das Intro lief sonst vor jedem Versuch, beim Knockout vor jedem Start.
  function rennintroErlaubt(gruenZiel, mpPlan) {
    return rennintroAn && !mpPlan && typeof gruenZiel !== 'number'
      && !(typeof mp !== 'undefined' && mp.an) && soundEnabled
      && !(typeof challengeLaeuft === 'function' && challengeLaeuft())
      && rennstandLautstaerke > 0;
  }

  async function rennintroVorAmpel() {
    rennintroAbbrechen();
    const token = rennintroGeneration, spr = lang;
    const aufstellung = rennintroStartaufstellung();
    const folge = rennintroFolge(raceMode, raceLimit, raceWxStart, racePitRequired, aufstellung);
    const controller = new AbortController();
    rennintroAktiv = true;
    return new Promise((resolve) => {
      let erledigt = false;
      // abbrechen = false beim Ladelimit: die Downloads laufen weiter in den Speicher.
      const fertig = (ok, abbrechen = true) => {
        if (erledigt) return;
        erledigt = true;
        if (abbrechen) controller.abort();
        if (token === rennintroGeneration) {
          if (rennintroTimer !== null) clearTimeout(rennintroTimer);
          rennintroTimer = null; rennintroFertig = null;
          rennintroAktiv = false;
          for (const q of rennintroQuellen) {
            q.onended = null;
            try { q.stop(); } catch (e) {}
            try { q.disconnect(); } catch (e) {}
          }
          rennintroQuellen = [];
        }
        resolve(ok);
      };
      rennintroFertig = fertig;
      rennintroTimer = setTimeout(() => {
        log('Rennintro: Ladezeit ueberschritten; Start ohne Intro.', 'info');
        fertig(false, false);
      }, RENINTRO_LADE_MS);
      (async () => {
        try {
          if (!audioCtx) initEngineSound();
          await audioCtx.resume();
          const { satz, fehlend } = await rennintroClipsLaden(folge, spr, controller.signal);
          if (erledigt || token !== rennintroGeneration || !rennintroAn || !soundEnabled
              || spr !== lang || raceState !== 'countdown' || rennstandLautstaerke <= 0) {
            fertig(false); return;
          }
          if (fehlend.length) {
            log('Rennintro: ' + fehlend.length + ' Aufnahme(n) fehlen und werden ausgelassen: '
              + fehlend.slice(0, 4).join(', ') + (fehlend.length > 4 ? ' …' : ''), 'info');
          }
          const spielbar = folge.filter((key) => satz[key]);
          if (!spielbar.length) throw new Error('keine Aufnahme ladbar');
          if (audioCtx.state !== 'running') throw new Error('Audiokontext nicht aktiv');
          const tempo = rennstandTempoWert(rennstandTempo);
          const dauer = spielbar.reduce((sum, key) => sum + satz[key].duration / tempo + 0.08, 0);
          if (!Number.isFinite(dauer) || dauer <= 0 || dauer * 1000 > RENINTRO_MAX_MS)
            throw new Error('Ungueltige oder zu lange Ansage');
          clearTimeout(rennintroTimer);
          rennintroTimer = setTimeout(() => {
            log('Rennintro: Wiedergabe-Timeout; Start ohne weitere Ansage.', 'info');
            fertig(false);
          }, Math.min(RENINTRO_MAX_MS, Math.ceil((dauer + 1) * 1000)));
          let bei = audioCtx.currentTime + 0.03;
          spielbar.forEach((key, i) => {
            const src = audioCtx.createBufferSource();
            src.buffer = satz[key]; src.playbackRate.value = tempo;
            src.connect(rennstandGain());
            rennintroQuellen.push(src);
            if (i === spielbar.length - 1) src.onended = () => fertig(true);
            src.start(bei); bei += src.buffer.duration / tempo + 0.08;
          });
        } catch (err) {
          if (!erledigt && token === rennintroGeneration)
            log('Rennintro nicht ladbar (' + err.message + '); Start ohne Intro.', 'info');
          fertig(false);
        }
      })();
    });
  }

  const rennintroSchalter = $('setting-announce-intro');
  if (rennintroSchalter) {
    rennintroAn = rennintroSchalter.checked;
    rennintroSchalter.addEventListener('change', () => {
      rennintroAn = rennintroSchalter.checked;
      if (!rennintroAn) rennintroAbbrechen();
    });
  }
