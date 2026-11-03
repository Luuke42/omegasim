  // Nur lokale Fahrer 1-3; keine neue WLAN-Ereignissynchronisierung.
  const rennEreignisAn = { damage: false, pit: false, penalty: false };
  let rennEreignisGrenze = 30;
  const rennEreignisLatch = new Map(), rennEreignisBuffers = {}, rennEreignisLaden = {};
  function rennEreignisGrenzwert(v) {
    if (v === null || String(v).trim() === '') return 30;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 30;
  }
  function rennEreignisAuto(nr) {
    if (nr === 1) return playerCar;
    const z = zweiSpieler && zusatzPlatz(nr);
    return z && z.car || null;
  }
  function rennEreignisIdentitaet(nr) {
    if (![1, 2, 3].includes(nr)) return null;
    const car = rennEreignisAuto(nr);
    if (!car) return null;
    const farbe = carColor(car);
    return { nr, farbeId: farbe.id === 'keine' ? 'unbekannt' : farbe.id,
      modellId: carModellWert(car.modellId) || 'auto' };
  }
  function rennEreignisReset() { rennEreignisLatch.clear(); }
  function rennEreignisSchadenErholen() {
    for (const nr of [1, 2, 3]) {
      const car = rennEreignisAuto(nr), latch = rennEreignisLatch.get(nr);
      if (!car || (latch && (latch.car !== car || 100 - schadenVon(nr) >= Math.min(100, rennEreignisGrenze + 8)))) {
        rennEreignisLatch.delete(nr);
      }
    }
  }
  function rennEreignisSchaden(nr) {
    if (!rennEreignisAn.damage || !crashSchadenAn() || rennPauseAktiv()
        || !['racing', 'finishing'].includes(raceState) || raceFormationLap) return false;
    rennEreignisSchadenErholen();
    if (100 - schadenVon(nr) >= rennEreignisGrenze || rennEreignisLatch.has(nr)) return false;
    const car = rennEreignisAuto(nr);
    if (!car) return false;
    rennEreignisLatch.set(nr, { car });
    return rennEreignisMelden('damage', nr);
  }
  function rennEreignisBox(nr) {
    if (rennPauseAktiv() || !['racing', 'finishing'].includes(raceState) || raceFormationLap) return false;
    return rennEreignisMelden('pit', nr);
  }
  function rennEreignisStrafe(nr, sekunden) {
    if (!Number.isFinite(sekunden) || sekunden <= 0 || rennPauseAktiv()
        || !['countdown', 'racing', 'finishing', 'finished'].includes(raceState) || raceFormationLap) return false;
    return rennEreignisMelden('penalty', nr, sekunden);
  }
  function rennEreignisZahlFolge(n) {
    if (!Number.isInteger(n) || n < 0 || n > 999) return null;
    const folge = [], hundert = Math.floor(n / 100), rest = n % 100;
    if (hundert) folge.push('v:hundred_' + hundert);
    if (rest || !hundert) folge.push(rest <= 60 ? 'n:' + rest : 'v:number_' + rest);
    return folge;
  }
  function rennEreignisFolge(art, x, sekunden) {
    if (art === 'damage') return ['e:farbe_' + x.farbeId, 'e:modell_' + x.modellId,
      'e:spieler' + x.nr, 'v:damage'];
    if (art === 'pit') return ['v:pit' + x.nr];
    if (sekunden === 1) return ['v:penalty_one', 'v:penalty_player' + x.nr];
    const z = Math.round(sekunden * 10), zahl = rennEreignisZahlFolge(Math.floor(z / 10));
    if (!zahl) return null;
    if (z % 10) zahl.push('n:komma', 'n:' + z % 10);
    return ['v:penalty_start', ...zahl, 'v:seconds', 'v:penalty_player' + x.nr];
  }
  function rennEreignisText(art, x, sekunden, spr) {
    const de = spr === 'de', L = de ? 'de' : 'en';
    if (art === 'pit') return de ? 'Spieler ' + x.nr + ' ist in der Box.' : 'Player ' + x.nr + ' is in the pits.';
    if (art === 'penalty') return de ? 'Zeitstrafe von ' + (sekunden === 1 ? 'einer Sekunde' : String(sekunden).replace('.', ',') + ' Sekunden')
      + ' für Spieler ' + x.nr + '.' : 'Time penalty of ' + sekunden + (sekunden === 1 ? ' second' : ' seconds') + ' for player ' + x.nr + '.';
    let farbe = RENNSTAND_FARBWORT[L][x.farbeId] || (de ? 'der' : 'the');
    farbe = farbe.charAt(0).toUpperCase() + farbe.slice(1);
    return farbe + ' ' + RENNSTAND_MODELLWORT[L][x.modellId]
      + (de ? ' von Spieler ' : ' driven by player ') + x.nr
      + (de ? ' ist schwer beschädigt.' : ' is badly damaged.');
  }
  async function rennEreignisClipsLaden(spr) {
    const quelle = spr === 'de' ? 'de' : 'en';
    if (rennEreignisBuffers[quelle]) return rennEreignisBuffers[quelle];
    if (!audioCtx) return null;
    if (rennEreignisLaden[quelle]) return rennEreignisLaden[quelle];
    rennEreignisLaden[quelle] = (async () => {
      try {
        const res = await fetch('audio/rennereignisse.json');
        if (!res.ok) throw Error('HTTP ' + res.status);
        const manifest = await res.json(), satz = {};
        const entries = Object.entries(manifest[quelle] || {});
        for (let i = 0; i < entries.length; i += 4) {
          await Promise.all(entries.slice(i, i + 4).map(async ([key, file]) => {
            const response = await fetch('audio/' + file);
            if (!response.ok) throw Error(file);
            satz['v:' + key] = await audioCtx.decodeAudioData(await response.arrayBuffer());
          }));
        }
        rennEreignisBuffers[quelle] = satz; return satz;
      } catch (err) {
        log('Rennereignis-Clips fehlen (' + err.message + '). Bitte Piper-Erzeugung ausfuehren.', 'info');
        return null;
      } finally { delete rennEreignisLaden[quelle]; }
    })();
    return rennEreignisLaden[quelle];
  }
  function rennEreignisMelden(art, nr, sekunden = 0) {
    if (!rennEreignisAn[art] || !soundEnabled) return false;
    const x = rennEreignisIdentitaet(nr), spr = lang;
    if (!x) return false;
    const spielen = async gueltig => {
      const neu = await rennEreignisClipsLaden(spr), basis = await rennstandClipsLaden(spr, true);
      if (!gueltig()) return;
      const satz = { ...basis, ...neu }, keys = rennEreignisFolge(art, x, sekunden);
      const folge = keys && keys.map(k => satz[k]);
      if (folge && folge.every(Boolean)) await ansagenPufferSpielen(folge, { stadion: true });
      else {
        // Web Speech laesst sich nicht an einen Web-Audio-Convolver anschliessen.
        log('Rennereignis: Sprachclips fehlen; Geraetestimme ohne Stadionhall. Bitte Piper-Clips erzeugen und deployen.', 'info');
        await ansagenTextSpielen(rennEreignisText(art, x, sekunden, spr), spr);
      }
    };
    const erlaubt = () => rennEreignisAn[art] && soundEnabled && lang === spr;
    // v1.3.39: "Ansagen in Warteschlange" aus - die laufende Ansage endet sofort, die
    // Schlange wird geleert, und die Meldung spielt direkt (keine Wartenden).
    if (!ansageWarteschlange) return ansagenSofort('event-' + art, spielen, erlaubt);
    return rennAnsagen.einreihen('event-' + art, 20, spielen, erlaubt);
  }
  for (const [art, id] of Object.entries({damage: 'setting-announce-event-damage',
      pit: 'setting-announce-event-pit', penalty: 'setting-announce-event-penalty'})) {
    const el = $(id); if (!el) continue;
    rennEreignisAn[art] = el.checked;
    el.addEventListener('change', () => {
      rennEreignisAn[art] = el.checked;
      // v1.3.39: beim Ausschalten sofort still, wenn gerade eine Meldung dieser Art laeuft.
      if (!el.checked) ansagenArtStoppen('event-' + art);
      if (el.checked && audioCtx) {
        ladeAnzeigeMit('klang-ereignisse',
          Promise.allSettled([rennEreignisClipsLaden(lang), rennstandClipsLaden(lang, true)]));
      }
    });
  }
  const rennEreignisGrenzfeld = $('setting-announce-event-damage-limit');
  if (rennEreignisGrenzfeld) {
    rennEreignisGrenze = rennEreignisGrenzwert(rennEreignisGrenzfeld.value);
    rennEreignisGrenzfeld.addEventListener('input', () => {
      rennEreignisGrenze = rennEreignisGrenzwert(rennEreignisGrenzfeld.value);
    });
    rennEreignisGrenzfeld.addEventListener('change', () => {
      rennEreignisGrenze = rennEreignisGrenzwert(rennEreignisGrenzfeld.value);
      rennEreignisGrenzfeld.value = rennEreignisGrenze;
    });
  }

  numSteuer('setting-announce-event-damage-limit');
