  // ============================ STRECKE AUS DER AUFNAHME LERNEN (WIP) ================
  //
  // BESTELLT: "... vielleicht, dass das Auto mehrere Runden faehrt und dann durch die
  // Aufzeichnungen eine Strecke erschlossen und gezeichnet wird." Kein neuer Fahrweg und
  // kein neues Lernverfahren - beide gibt es schon und beide sind fuer sich gemessen:
  // der Makro-Rekorder (50-drive.js) spielt Lenk- und Gaswerte exakt erneut ab, und das
  // Hintergrund-Lernen (ghostCfg.learn, 60-track.js/90-ghosts.js) baut aus den echten,
  // vom Auto gemeldeten Streckencodes ein Layout zusammen - fuer JEDES Auto, das gerade
  // faehrt, gleich ob von Hand, als Ghost oder eben per Wiedergabe. Dieser Baustein
  // verbindet nur beide: Lernen einschalten, Zustand zuruecksetzen, Aufnahme abspielen,
  // Ergebnis zeichnen.

  function macroLearnRefreshButton() {
    const btn = $('btn-macro-learn-track');
    if (btn) btn.disabled = macro.length === 0 || recording || playing;
  }
  // Kein eigener Zaehler: derselbe macro.length/recording/playing, den btn-play schon
  // benutzt, nur nach jeder Aktion erneut geprueft.
  ['btn-record', 'btn-play', 'btn-stop-play', 'btn-load-macro'].forEach((id) => {
    if ($(id)) $(id).addEventListener('click', macroLearnRefreshButton);
  });
  if ($('macro-import')) $('macro-import').addEventListener('change', macroLearnRefreshButton);
  macroLearnRefreshButton();

  let macroLearnVorherigesLernen = null;

  function macroLearnKarteZeichnen() {
    const halter = $('macro-learn-karte');
    if (!halter) return;
    halter.innerHTML = (currentTrackTiles && currentTrackTiles.length >= 3)
      ? renderTrackPreview(currentTrackTiles, null, {}).html : '';
  }

  function macroLearnFertig() {
    if (macroLearnVorherigesLernen !== null) {
      ghostCfg.learn = macroLearnVorherigesLernen;
      macroLearnVorherigesLernen = null;
    }
    macroLearnKarteZeichnen();
    const status = $('macro-learn-status');
    if (status) {
      status.textContent = (currentTrackTiles && currentTrackTiles.length >= 3)
        ? t('__N__ Teile gelernt.').replace('__N__', currentTrackTiles.length)
        : t('Keine geschlossene Runde erkannt - nochmal versuchen.');
    }
    macroLearnRefreshButton();
  }

  if ($('btn-macro-learn-track')) {
    $('btn-macro-learn-track').addEventListener('click', () => {
      if (macro.length === 0 || recording || playing) return;
      macroLearnVorherigesLernen = ghostCfg.learn;
      ghostCfg.learn = true;
      learnReset();
      currentTrackTiles = freshTrackTiles();
      macroLearnKarteZeichnen();
      const status = $('macro-learn-status');
      if (status) status.textContent = t('lernt…');
      // Endlosschleife wuerde stopPlayback() und damit macroPlaybackDoneCallback nie
      // erreichen - fuer diesen einen Lauf immer genau einmal abspielen.
      if ($('chk-loop')) $('chk-loop').checked = false;
      playing = true; // dieselbe Sperre wie beim btn-play-Klick, siehe playbackLocked()
      $('btn-play').disabled = true;
      $('btn-stop-play').disabled = false;
      macroLearnRefreshButton(); // playing ist jetzt true - auch dieser Knopf sperrt sich
      macroPlaybackDoneCallback = macroLearnFertig;
      runPlayback();
    });
  }

  // ============================ RUNDEN WAEHREND DER AUFNAHME (Start/Ziel) ============
  //
  // BESTELLT: "Wichtig bei der Aufzeichnung sollte noch das Start/Ziel Target sein
  // (Ausdruck-Modus)... ich will, dass beruecksichtigt wird, wie schnell das Auto ueber
  // start/ziel faehrt (bei der ersten Runde ist es ja langsamer)."
  //
  // EIGENER, VON RENNZUSTAND UNABHAENGIGER Zaehler: car.race/carRaceNotify() (70-race.js)
  // legt nur waehrend eines GESTARTETEN Rennens Rundenzeiten ab (raceState==='racing') -
  // eine Aufnahme soll aber auch beim einfachen freien Fahren Runden erkennen. Dieselbe,
  // schon gemessene Erkennung wird trotzdem wiederverwendet und nicht neu erfunden:
  // zielSperreFlanke() (Byte 15 Bit 3, funktioniert auch im Ausdruck-Modus, dieselbe
  // Bevorzugung wie in carRaceNotify()) mit Rueckfall auf echte Streckencodes.
  let aufnahmeRunden = [];       // [{tStart, tEnde, ms}] in Makro-Millisekunden
  let aufnahmeRundenT0 = null;
  let aufnahmeRState = null;

  function aufnahmeRundenTick(b) {
    if (!aufnahmeRState) {
      aufnahmeRState = { pending: null, seen: 0, lastCount: null, sperreVor: false,
                          sperreGesehen: false, lastActed: 0 };
    }
    const r = aufnahmeRState, jetzt = Date.now();
    let ueberfahren = false;
    const sperreJetzt = (b[15] & ZIEL_SPERRE_BIT) !== 0;
    if (sperreJetzt && !r.sperreVor) {
      r.sperreGesehen = true;
      if (jetzt - r.lastActed >= TILE_REPEAT_BLOCK_MS) { r.lastActed = jetzt; ueberfahren = true; }
    }
    r.sperreVor = sperreJetzt;
    // Rueckfall nur, solange dieses Auto die Sperre noch nie gemeldet hat - sonst zaehlt
    // dieselbe Ueberfahrt doppelt (einmal je Erkennungsweg), genau wie in carRaceNotify().
    if (!ueberfahren && !r.sperreGesehen) {
      const code = b[12], count = b[11];
      if (code !== r.pending) { r.pending = code; r.seen = 1; } else {
        r.seen++;
        if (r.seen >= 2) {
          if (r.lastCount === null) {
            r.lastCount = count;
          } else if (count !== r.lastCount) {
            r.lastCount = count;
            if (isStartCode(code) && jetzt - r.lastActed >= TILE_REPEAT_BLOCK_MS) {
              r.lastActed = jetzt;
              ueberfahren = true;
            }
          }
        }
      }
    }
    if (!ueberfahren) return;
    const t = jetzt - recordStartTime;
    if (aufnahmeRundenT0 !== null) {
      aufnahmeRunden.push({ tStart: aufnahmeRundenT0, tEnde: t, ms: t - aufnahmeRundenT0 });
    }
    aufnahmeRundenT0 = t;
  }

  if ($('btn-record')) {
    // ZUSAETZLICHER Zuhoerer, nicht anstelle des bestehenden (der ist eine .onclick-
    // Zuweisung in 50-drive.js) - er laeuft NACH ihr, `recording` traegt also schon den
    // NEUEN Wert: wahr heisst "gerade erst gestartet", und nur dann wird zurueckgesetzt.
    $('btn-record').addEventListener('click', () => {
      if (recording) { aufnahmeRunden = []; aufnahmeRundenT0 = null; aufnahmeRState = null; }
    });
  }

  // ============================ PFAD AUS DER AUFNAHME (Physik, ohne Bahn) =============
  //
  // BESTELLT: "Ich m&ouml;chte aus den aufgezeichneten Werten eine Zeichnung." Anders als
  // "Strecke aus der Aufnahme lernen" oben (das braucht ein verbundenes Auto, das echte
  // Streckencodes meldet) rechnet dieser Weg die gefahrene Linie AUSSCHLIESSLICH aus den
  // gespeicherten Lenk-/Gaswerten - ueber dieselbe Physik-Engine, die auch ein Ghost
  // bekommt (CarreraPhysicsEngine, 40-physics.js), aber als eigene, isolierte Instanz und
  // rein im Speicher: kein Auto noetig, keine Echtzeit-Wiedergabe. Das ist der Teil, der
  // AUCH im Ausdruck-Modus funktioniert, weil er nie auf einen Streckencode angewiesen
  // ist.
  //
  // OHNE Ortsmessung ist das Koppelnavigation: jeder Schritt baut auf dem vorigen auf, und
  // kleine Fehler summieren sich. Eine "Schliesskorrektur" ueber die echten Start/Ziel-
  // Zeiten (aufnahmeRunden oben) waere denkbar, ist hier aber bewusst NICHT gebaut - ein
  // Korrekturschritt, der falsch ist, saehe fuer den Blick aufs Bild schlimmer aus als eine
  // ehrlich unkorrigierte, offene Linie. Was WIRKLICH gemessen ist und bleibt: die
  // Rundenzeiten aus aufnahmeRunden, angezeigt neben der Zeichnung.
  const SIM_KMH_ZU_CM_S_PFAD = 100000 / 3600;

  function macroPfadRekonstruieren(macroArr) {
    if (!macroArr || macroArr.length < 2) return null;
    const engine = new CarreraPhysicsEngine();
    Object.assign(engine.config, physEngine.config);
    engine.config.gears = physEngine.config.gears;
    if (typeof engine.calibrateAccel === 'function') engine.calibrateAccel();
    engine.state.driveMode = 'forward';
    engine.state.currentGear = 0;

    let x = 0, y = 0, heading = 0, letzteT = 0;
    const punkte = [{ x, y, t: 0 }];
    for (const schritt of macroArr) {
      const dtRoh = (schritt.t - letzteT) / 1000;
      letzteT = schritt.t;
      if (dtRoh <= 0) continue;
      // Gedeckelt: eine Luecke in der Aufzeichnung (z.B. nach einem Import) darf nicht als
      // ein einziger Riesenschritt in die Physik einfliessen.
      const dt = Math.min(dtRoh, 0.25);
      engine.update({
        steering: schritt.steer,
        throttle: Math.max(0, schritt.throttle),
        brake: Math.max(0, -schritt.throttle),
        headlights: false,
      }, dt);
      const v = engine.state.speedKmh;
      const strecke = v * SIM_KMH_ZU_CM_S_PFAD * TRACK_UNITS_PER_CM * dt;
      heading += (engine.state.yawRate || 0) * dt;
      x += strecke * Math.cos(heading);
      y += strecke * Math.sin(heading);
      punkte.push({ x, y, t: schritt.t });
    }
    return punkte;
  }

  // Eigene, kleine SVG-Zeichnung statt renderTrackPreview(): die nimmt zwingend ein
  // Kachel-Array (trackCenterline()), hier gibt es aber eine durchgehende Punktfolge ohne
  // Kacheln. Dieselbe Idee wie dort (Begrenzungsrahmen ausmessen, mit Rand zentrieren),
  // nur fuer eine Linie statt fuer eine Streckenmitte plus Ideallinie.
  function macroPfadSvgZeichnen(punkte) {
    if (!punkte || punkte.length < 2) return '';
    const pad = 20;
    const xs = punkte.map((p) => p.x), ys = punkte.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX) + pad * 2, h = Math.max(1, maxY - minY) + pad * 2;
    const ox = pad - minX, oy = pad - minY;
    const P = (p) => (p.x + ox).toFixed(1) + ' ' + (p.y + oy).toFixed(1);
    const bahn = 'M ' + punkte.map(P).join(' L ');
    const start = punkte[0];
    return '<svg viewBox="0 0 ' + w.toFixed(0) + ' ' + h.toFixed(0) + '" '
      + 'style="width:100%;height:auto;max-height:50vh;background:var(--panel);'
      + 'border:1px solid var(--border);border-radius:8px">'
      + '<path d="' + bahn + '" fill="none" stroke="var(--bad)" stroke-width="3" '
      + 'stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="' + (start.x + ox).toFixed(1) + '" cy="' + (start.y + oy).toFixed(1)
      + '" r="6" fill="var(--good)"/>'
      + '</svg>';
  }

  function macroPfadRefreshButton() {
    const btn = $('btn-macro-pfad-zeichnen');
    if (btn) btn.disabled = macro.length === 0;
  }
  ['btn-record', 'btn-play', 'btn-stop-play', 'btn-load-macro'].forEach((id) => {
    if ($(id)) $(id).addEventListener('click', macroPfadRefreshButton);
  });
  if ($('macro-import')) $('macro-import').addEventListener('change', macroPfadRefreshButton);
  macroPfadRefreshButton();

  if ($('btn-macro-pfad-zeichnen')) {
    $('btn-macro-pfad-zeichnen').addEventListener('click', () => {
      const punkte = macroPfadRekonstruieren(macro);
      const karte = $('macro-pfad-karte');
      const status = $('macro-pfad-status');
      const rundenEl = $('macro-pfad-runden');
      if (!punkte) {
        if (status) status.textContent = t('Keine Aufnahme vorhanden.');
        if (karte) karte.innerHTML = '';
        if (rundenEl) rundenEl.textContent = '';
        return;
      }
      if (karte) karte.innerHTML = macroPfadSvgZeichnen(punkte);
      if (status) {
        status.textContent = t('__N__ Punkte, rein rechnerisch (Koppelnavigation).')
          .replace('__N__', punkte.length);
      }
      if (rundenEl) {
        rundenEl.innerHTML = aufnahmeRunden.length
          ? aufnahmeRunden.map((r, i) => t('Runde __N__: __S__ s')
              .replace('__N__', i + 1).replace('__S__', (r.ms / 1000).toFixed(2))).join('<br>')
          : t('Keine Start/Ziel-Überfahrt in dieser Aufnahme erkannt - keine Rundenzeiten.');
      }
    });
  }

