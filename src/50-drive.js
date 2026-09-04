  // =========================================================================
  // Fahren: Regler, Kalibrierung, Makros
  // =========================================================================
  // Die Instanz der Physik, die Regler aus dem Optionentab, der automatische
  // Kalibrierungslauf und die Aufnahme/Wiedergabe von Fahrten.


  const physEngine = new CarreraPhysicsEngine();
  let physLastTime = null;
  // AN als Standard, weil die Original-App es praktisch immer an hat und ein beleuchtetes
  // Auto auf dem Tisch besser zu sehen ist.
  //
  // NICHT weil der Streckensensor es braucht. Das stand hier eine Fassung lang, gestuetzt auf
  // eine Auszaehlung (Licht an: 11703 Codes in 40075 Paketen; Licht aus: 0 in 422), und es
  // ist widerlegt: in der Original-App wird die Strecke gelesen, ob das Licht an ist oder
  // aus. Die Korrelation war echt, aber nicht ursaechlich - 422 Pakete sind rund 20 Sekunden
  // und lagen am Sitzungsanfang, bevor etwas ueberfahren wurde.
  let headlightsOn = true;
  let raceLampHead = false;  // resolved headlight state, for the racing screen

  // Eine Stelle fuer die Leseart, zwei Bedienelemente darauf: der Schalter in den Optionen
  // und der Knopf im Cockpit. Zwei Orte mit eigener Logik waeren zwei Orte, die
  // auseinanderlaufen - der Knopf setzt deshalb den Schalter und nichts sonst.
  function applyScanMode() {
    const rail = $('setting-ontrack') ? $('setting-ontrack').checked : true;
    trackMode = rail ? 'on' : 'off';
    // Sofort in lightBits eintragen. Die Fahrschleife setzt es ohnehin jeden Takt neu
    // zusammen, aber bis dahin waere der Zustand widerspruechlich: trackMode schon
    // umgeschaltet, das gesendete Byte noch alt. Nur die zwei Modusbits werden angefasst,
    // Scheinwerfer und Bremslicht bleiben stehen - daher die Maske.
    lightBits = (lightBits & ~(TRACK_BIT_RAIL | TRACK_BIT_PRINT)) | trackModeBit();
    const b = $('race-act-scan');
    if (b) {
      // NUR die Spanne, nicht der Knopf: er traegt jetzt ein Sensorbild, und textContent
      // haette es mitgeloescht. Der Fehler faellt beim Lesen nicht auf, weil eine
      // Zuweisung an textContent harmlos aussieht.
      const t = $('race-act-scan-txt');
      if (t) t.textContent = rail ? 'Bahn' : 'Ausdruck';
      // Die Ausdruck-Stellung ist die ungewoehnliche und die, in der das Auto sich nicht
      // selbst haelt. Sie wird angeschrieben, damit man nicht versehentlich darin faehrt.
      b.classList.toggle('warn', !rail);
    }
    return rail;
  }

  $('setting-ontrack').addEventListener('change', () => {
    const rail = applyScanMode();
    // Kein 'err' mehr fuer die Ausdruck-Stellung: sie ist kein Fehler, sondern die einzige
    // Stellung, in der ein gedrucktes Muster ueberhaupt gelesen wird. Am 26.08. mit der
    // Original-App gemessen.
    log(rail
        ? 'Leseart: Kunststoffschiene (Byte 14 Bit 5). Das Auto haelt sich selbst auf der '
          + 'Bahn, liest aber keine gedruckten Muster.'
        : 'Leseart: gedruckte Muster (Byte 14 Bit 7). Nur hier werden Ausdrucke gelesen, '
          + 'dafuer haelt sich das Auto nicht selbst auf der Bahn.', 'info');
    showHudToast(rail ? 'LIEST BAHN' : 'LIEST AUSDRUCK');
  });

  // Der Fahrmodus im Cockpit. Er schaltet durch die Voreinstellungen und ruft
  // applyPreset() - dieselbe Funktion wie die Knoepfe in den Optionen und in der Garage.
  // Es gibt damit genau EINEN Weg, eine Abstimmung zu setzen, und die Regler ziehen
  // ueberall nach, weil presetSet() 'input' und 'change' mit bubbles feuert.
  //
  // Die Liste kommt aus PRESETS und nicht aus einem eigenen Array: ein sechster Eintrag
  // dort soll hier ohne Nacharbeit erscheinen.
  let fahrmodusIdx = -1;
  if ($('race-act-mode')) {
    $('race-act-mode').addEventListener('click', () => {
      const keys = window.__presetKeys ? window.__presetKeys() : [];
      if (!keys.length) return;
      // Beim ersten Druck da anfangen, wo die Regler stehen: sonst springt der Knopf von
      // einer eingestellten GT3-Abstimmung auf Arcade zurueck. Ist gar keine Variante
      // eingestellt (die Vorgaben sind ein sechster, milderer Satz), bleibt -1 und der
      // erste Druck gibt die erste Variante.
      if (fahrmodusIdx < 0 && window.__presetActive) {
        const aktiv = window.__presetActive();
        if (aktiv) fahrmodusIdx = keys.indexOf(aktiv);
      }
      fahrmodusIdx = (fahrmodusIdx + 1) % keys.length;
      const key = keys[fahrmodusIdx];
      window.__applyPreset(key);
      const txt = $('race-act-mode-txt');
      if (txt) txt.textContent = window.__presetLabel(key);
      showHudToast('ABSTIMMUNG ' + window.__presetLabel(key).toUpperCase());
    });
  }

  // Der Motorklang, durchgeschaltet. Er geht ueber das Bedienelement in den Optionen und
  // dessen 'change'-Ereignis, wie die Reifenkachel und der Leseart-Knopf: damit gibt es
  // keinen zweiten Zustand, und die Optionen ziehen von selbst nach.
  //
  // Die Reihenfolge ist die des MENUES und nicht eine eigene Liste - der erste Eintrag ist
  // damit Mercedes-AMG GT3, und ein neunter Rennmotor erscheint hier ohne Nacharbeit.
  // Ausgeblendete Eintraege werden uebersprungen: ein Knopf, der auf etwas Unsichtbares
  // schaltet, sieht wie ein Fehler aus.
  function motorNamen(opt) {
    // Nur der Wagenname, nicht die technische Beschreibung dahinter: "Mercedes-AMG GT3"
    // statt "Mercedes-AMG GT3: V8, Cross-Plane". Im Cockpit ist der Platz eine Zeile.
    //
    // Getrennt wird am ERSTEN von Doppelpunkt oder Komma. Nur am Doppelpunkt reicht nicht:
    // die acht Rennmotoren heissen "Name: Bauart", die aelteren Eintraege aber
    // "Mustang, V8, Cross-Plane" - dort blieb der ganze Text stehen.
    const t = opt.textContent.trim();
    const kandidaten = [t.indexOf(':'), t.indexOf(',')].filter(i => i > 0);
    let kurz = kandidaten.length ? t.slice(0, Math.min.apply(null, kandidaten)).trim() : t;
    // "Porsche" gibt es zweimal: als gerechneten Saugmotor und als Aufnahme. Beide auf
    // denselben Kurznamen zu bringen ist schlechter als ein zu langer Text - dann zeigt der
    // Knopf zwei verschiedene Motoren gleich an.
    if (t.indexOf('Aufnahme') >= 0) kurz += ' (Aufn.)';
    return kurz;
  }

  function motorAnzeige() {
    const sel = $('sound-profile'), txt = $('race-act-sound-txt');
    if (!sel || !txt) return;
    const opt = sel.options[sel.selectedIndex];
    if (opt) txt.textContent = motorNamen(opt);
  }

  if ($('race-act-sound')) {
    $('race-act-sound').addEventListener('click', () => {
      const sel = $('sound-profile');
      if (!sel) return;
      const brauchbar = Array.prototype.filter.call(sel.options, o => !o.disabled && !o.hidden);
      if (!brauchbar.length) return;
      const jetzt = brauchbar.findIndex(o => o.value === sel.value);
      const naechste = brauchbar[(jetzt + 1) % brauchbar.length];
      sel.value = naechste.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      motorAnzeige();
      showHudToast(motorNamen(naechste).toUpperCase());
    });
    motorAnzeige();
    // Auch wenn die Aenderung aus den Optionen kommt: sonst zeigt der Knopf einen Motor an,
    // der nicht spielt, und das ist schlechter als kein Text.
    if ($('sound-profile')) {
      $('sound-profile').addEventListener('change', motorAnzeige);
    }
  }

  if ($('race-act-scan')) {
    $('race-act-scan').addEventListener('click', () => {
      const sw = $('setting-ontrack');
      if (!sw) return;
      sw.checked = !sw.checked;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  applyScanMode();

  // ---- Fahrzeuglayout ----------------------------------------------------------------
  //
  // EIGENE Ablage und nicht die der Voreinstellungen: das Layout ist absichtlich kein
  // Preset-Schluessel (siehe data-preset-skip), also wuerde es sonst bei jedem Neuladen
  // zurueckfallen - und ein Auto, das sich beim Neuladen aendert, ist eine Falle.
  const LAYOUT_STORE = 'chc.layout.v1';
  if ($('setting-layout')) {
    const zeigeLayoutDaten = () => {
      const el = $('layout-info');
      if (!el) return;
      const c = physEngine.config;
      const vorn = Math.round(c.loadFrontStatic * 100);
      // Die Nickgrenzen werden GERECHNET angezeigt, damit man sieht, dass sie es sind.
      const gas = Math.round((c.loadFrontStatic - c.transferK) * 100);
      const bremse = Math.round((c.loadFrontStatic + c.transferK) * 100);
      el.textContent = vorn + ':' + (100 - vorn) + ' \u00b7 ' + c.wheelbaseM.toFixed(2)
        + ' m \u00b7 ' + c.yawInertia + ' kg\u00b7m\u00b2'
        + ' \u00b7 ' + t('vorn bei Gas') + ' ' + gas + '% / ' + t('bei Bremse') + ' '
        + bremse + '%'
        + ' \u00b7 ' + t('Lenkrate') + ' ' + physEngine.config.steerRatePerS.toFixed(1);
    };
    const anwenden = (melden) => {
      const name = physEngine.applyLayout($('setting-layout').value);
      // Falls der gespeicherte Name unbekannt war, faellt applyLayout auf neutral zurueck -
      // dann muss die Auswahl mitkommen, sonst zeigt sie etwas anderes als das Modell.
      if ($('setting-layout').value !== name) $('setting-layout').value = name;
      zeigeLayoutDaten();
      markDrivetrainChartsDirty();
      if (melden) {
        const opt = $('setting-layout').selectedOptions[0];
        log('Fahrzeuglayout: ' + (opt ? opt.textContent : name) + '.', 'info');
        showHudToast((opt ? opt.textContent : name).toUpperCase());
      }
      try { localStorage.setItem(LAYOUT_STORE, name); } catch (e) { /* privater Modus */ }
    };
    try {
      const gespeichert = localStorage.getItem(LAYOUT_STORE);
      if (gespeichert) $('setting-layout').value = gespeichert;
    } catch (e) { /* privater Modus */ }
    $('setting-layout').addEventListener('change', () => anwenden(true));
    // Beim Sprachwechsel neu zeichnen: die Datenzeile wird aus t()-Stuecken zusammengesetzt
    // und ist damit fuer den Textknoten-Uebersetzer unerreichbar.
    if (typeof i18nOnLangChange === 'function') i18nOnLangChange(zeigeLayoutDaten);
    anwenden(false);
  }

  // ---- Cockpit-Ansicht ---------------------------------------------------------------
  //
  // Sie setzt ein Attribut am body und sonst nichts. Kein Neuaufbau, keine Klasse an
  // einzelnen Kacheln: die drei Ansichten unterscheiden sich ausschliesslich in den acht
  // --gt3-Variablen, und das Umsetzen einer Variable faerbt jede Regel mit, die sie liest.
  //
  // EIGENE ABLAGE, wie beim Layout und beim Getriebe: der Waehler traegt data-preset-skip,
  // weil eine Voreinstellung eine Abstimmung ist und das Aussehen keine.
  const COCKPIT_STORE = 'chc.cockpit.v1';
  if ($('setting-cockpit')) {
    const ansichtAnwenden = (melden) => {
      const v = $('setting-cockpit').value;
      // 'gt3' ist die Vorgabe und setzt KEIN Attribut: so stehen die Werte aus :root, und
      // die Vorgabe ist damit nicht eine dritte Kopie derselben Zahlen.
      if (v === 'gt3') document.body.removeAttribute('data-cockpit');
      else document.body.setAttribute('data-cockpit', v);
      if (melden) {
        const opt = $('setting-cockpit').selectedOptions[0];
        log('Cockpit-Ansicht: ' + (opt ? opt.textContent : v) + '.', 'info');
      }
      try { localStorage.setItem(COCKPIT_STORE, v); } catch (e) { /* privater Modus */ }
    };
    try {
      const gespeichert = localStorage.getItem(COCKPIT_STORE);
      if (gespeichert) $('setting-cockpit').value = gespeichert;
    } catch (e) { /* privater Modus */ }
    $('setting-cockpit').addEventListener('change', () => ansichtAnwenden(true));
    ansichtAnwenden(false);
  }

  // ---- Getriebeart -------------------------------------------------------------------
  //
  // Dieselbe Bauform wie das Layout darueber, und aus demselben Grund eine EIGENE Ablage:
  // der Waehler traegt data-preset-skip, also fasst ihn presetControls() nicht an - und
  // ohne eigene Ablage faellt er bei jedem Neuladen auf GT3 zurueck.
  const GEARBOX_STORE = 'chc.gearbox.v1';
  if ($('setting-gearbox')) {
    const zeigeGetriebeDaten = () => {
      const el = $('gearbox-info');
      if (!el) return;
      const cfg = physEngine.config;
      // Dieselbe Rechnung, die die Doku fuer ihre Gangtabelle benutzt: topFrac mal
      // Hoechstgeschwindigkeit, hier in Tacho-Kilometern, also mit REAL_SCALE.
      const gaenge = cfg.gears.map((g, i) => (i + 1) + '. '
        + Math.round(g.topFrac * cfg.topSpeedKmh * REAL_SCALE)).join(' \u00b7 ');
      el.textContent = cfg.gears.length + ' ' + t('G\u00e4nge') + ' \u00b7 '
        + gaenge + ' km/h \u00b7 ' + t('Schaltzeit') + ' ' + cfg.shiftMs + ' ms';
    };
    // ZWEI ARGUMENTE UND NICHT EINES, und der Grund ist die Ladereihenfolge: `garage` ist
    // ein const in 90-ghosts.js, also in einer SPAETEREN Quelldatei. Beim ersten Aufruf hier
    // ist es noch in seiner temporalen Todeszone, und dort wirft schon `typeof garage` -
    // was die ganze IIFE mitnimmt und OMEGA_TEST verschwinden laesst. Beim Laden gibt es
    // ausserdem keine Ghosts, also ist der Verzicht nicht nur sicher, sondern richtig.
    const getriebeAnwenden = (melden, mitGhosts) => {
      const name = physEngine.applyGearbox($('setting-gearbox').value);
      // Wie beim Layout: war der abgelegte Name unbekannt, faellt applyGearbox auf gt3
      // zurueck, und dann muss die Auswahl mitkommen.
      if ($('setting-gearbox').value !== name) $('setting-gearbox').value = name;
      if (mitGhosts) {
        // Die Ghosts teilen das UEBERSETZUNGS-ARRAY per Verweis, sind also schon umgestellt.
        // Ihre SKALARE - Schaltpunkte, Schaltzeit, rpmScale, ratioRef - sind aber Kopien aus
        // dem Augenblick ihrer Einrichtung. Ohne diese Schleife schaltet ein fahrender Ghost
        // weiter nach den alten Punkten, und von aussen sieht das aus wie "der Ghost
        // schaltet falsch".
        garage.forEach(c => {
          if (!c.ghost || !c.ghost.engine || c.ghost.engine === physEngine) return;
          const gc = c.ghost.engine.config, pc = physEngine.config;
          gc.ratioRef = pc.ratioRef;
          gc.upshiftRpm = pc.upshiftRpm;
          gc.downshiftRpm = pc.downshiftRpm;
          gc.shiftMs = pc.shiftMs;
          gc.rpmScale = pc.rpmScale;
          c.ghost.engine.state.currentGear =
            Math.min(c.ghost.engine.state.currentGear, gc.gears.length - 1);
        });
      }
      zeigeGetriebeDaten();
      markDrivetrainChartsDirty();
      if (melden) {
        const opt = $('setting-gearbox').selectedOptions[0];
        log('Getriebe: ' + (opt ? opt.textContent : name) + '.', 'info');
        showHudToast((opt ? opt.textContent : name).toUpperCase());
      }
      try { localStorage.setItem(GEARBOX_STORE, name); } catch (e) { /* privater Modus */ }
    };
    try {
      const gespeichert = localStorage.getItem(GEARBOX_STORE);
      if (gespeichert) $('setting-gearbox').value = gespeichert;
    } catch (e) { /* privater Modus */ }
    $('setting-gearbox').addEventListener('change', () => getriebeAnwenden(true, true));
    if (typeof i18nOnLangChange === 'function') i18nOnLangChange(zeigeGetriebeDaten);
    getriebeAnwenden(false, false);
  }

  $('phys-enable').addEventListener('change', (e) => {
    physicsEnabled = e.target.checked;
    physLastTime = null;
  });

  $('dash-head-toggle').addEventListener('change', (e) => {
    headlightsOn = e.target.checked;
    // Keine Warnung mehr: die Behauptung, ohne Licht werde nicht gelesen, war falsch.
  });

  // Die Gangzahl im Cockpit schaltet denselben Schalter, den die Optionen zeigen. Ueber
  // click() und nicht ueber physEngine.config: so bleibt der Schalter die einzige Wahrheit,
  // und alles, was an seinem change-Ereignis haengt (Speichern, Anzeige, Voreinstellungen),
  // laeuft mit. Zwei Orte fuer denselben Zustand waeren zwei Orte, die auseinanderlaufen.
  if ($('race-gear')) {
    $('race-gear').addEventListener('click', () => {
      const sw = $('setting-autoshift');
      if (!sw) return;
      sw.checked = !sw.checked;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
      showHudToast(sw.checked ? 'AUTOMATIK' : 'MANUELL, I UND K ODER PAD');
    });
  }

  $('setting-autoshift').addEventListener('change', (e) => {
    physEngine.config.autoShift = e.target.checked;
    showHudToast(e.target.checked ? 'Automatikgetriebe' : 'Manuelles Getriebe');
  });

  // All three feed the launch model, so each one has to re-solve the calibration.
  $('setting-topspeed-kmh').addEventListener('input', (e) => {
    physEngine.config.topSpeedKmh = parseFloat(e.target.value);
    $('setting-topspeed-kmh-val').textContent = physEngine.config.topSpeedKmh.toFixed(1);
    physEngine.calibrateAccel();
    markDrivetrainChartsDirty();
  });

  // Der Regler steht in SEKUNDEN, weil die Physik damit rechnet und der Wert gegen eine
  // gemessene GT3-Reihe gefittet ist. Angezeigt wird trotzdem eine BESCHLEUNIGUNG in
  // Prozent, denn "weniger ist schneller" liest sich bei einem Regler, der neben
  // "Hoechstgeschwindigkeit" steht, unweigerlich als Fehler. Die Sekunden stehen zur
  // Kontrolle daneben - sie sind die Groesse, gegen die kalibriert wurde, und die will man
  // sehen koennen.
  const ACCEL_REF_S = 3.2;   // Bezugswert = 100 %
  function accelLabel(s) {
    return Math.round(ACCEL_REF_S / s * 100) + ' % ('
         + s.toFixed(1).replace('.', ',') + ' s auf 100)';
  }
  $('setting-zero-to-top').addEventListener('input', (e) => {
    physEngine.config.launchAnchorTimeS = parseFloat(e.target.value);
    $('setting-zero-to-top-val').textContent = accelLabel(physEngine.config.launchAnchorTimeS);
    physEngine.calibrateAccel();
    markDrivetrainChartsDirty();
  });
  $('setting-zero-to-top-val').textContent = accelLabel(+$('setting-zero-to-top').value);

  $('setting-coast-drag').addEventListener('input', (e) => {
    physEngine.config.coastDragPerS = parseFloat(e.target.value);
    $('setting-coast-drag-val').textContent = physEngine.config.coastDragPerS.toFixed(2);
    physEngine.calibrateAccel();
    markDrivetrainChartsDirty();
  });

  // AUS DEM MARKUP LESEN, nicht nur auf Aenderungen hoeren. Der Schalter stand auf an und
  // rumbleOn auf false: die Vibration war tot, bis man ihn zweimal umlegte. Gemeldet als
  // "Controller Vibration ist zwar an, aber es geht nicht" - und genau das war es.
  //
  // Dasselbe Muster wie bei setting-offtrack ein paar Zeilen weiter unten, das es schon
  // richtig macht. Ein Selbsttest prueft jetzt alle 19 gespiegelten Kaestchen.
  rumbleOn = $('setting-vibration').checked;
  $('setting-vibration').addEventListener('change', (e) => { rumbleOn = e.target.checked; });

  // Der Regler steht in PROZENT vorn, die Physik rechnet mit einem Anteil.
  $('setting-brakebias').addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    physEngine.config.brakeBias = pct / 100;
    $('setting-brakebias-val').textContent = pct + '% vorn';
  });

  // ---- Block 4: Bremstemperatur, Windschatten, Reifen -------------------------------
  //
  // Die Schalter setzen den Effekt auf 0 statt ein eigenes Flag zu fuehren. Ein zweiter
  // Zustand neben dem Wert waere die Gelegenheit, dass beide auseinanderlaufen - und die
  // Physik muesste dann zwei Sachen abfragen statt einer.
  function brakeFadeAnwenden() {
    const an = !$('setting-brake-fade') || $('setting-brake-fade').checked;
    const st = $('setting-brake-fade-strength');
    physEngine.config.brakeFadeEffect = an ? parseFloat(st ? st.value : 1) : 0;
  }
  if ($('setting-brake-fade')) {
    $('setting-brake-fade').addEventListener('change', brakeFadeAnwenden);
  }
  if ($('setting-brake-fade-strength')) {
    $('setting-brake-fade-strength').addEventListener('input', (e) => {
      $('setting-brake-fade-strength-val').textContent =
        Math.round(parseFloat(e.target.value) * 100) + '%';
      brakeFadeAnwenden();
    });
  }
  brakeFadeAnwenden();

  function dirtyAirAnwenden() {
    const an = !$('setting-dirtyair') || $('setting-dirtyair').checked;
    const st = $('setting-dirtyair-strength');
    physEngine.config.dirtyAirEffect = an ? parseFloat(st ? st.value : 1) : 0;
  }
  if ($('setting-dirtyair')) {
    $('setting-dirtyair').addEventListener('change', dirtyAirAnwenden);
  }
  if ($('setting-dirtyair-strength')) {
    $('setting-dirtyair-strength').addEventListener('input', (e) => {
      $('setting-dirtyair-strength-val').textContent =
        Math.round(parseFloat(e.target.value) * 100) + '%';
      dirtyAirAnwenden();
    });
  }
  dirtyAirAnwenden();

  // Der Windschatten braucht ein Streckenlayout, sonst multipliziert er eine Null. Der
  // Schalter wird deshalb GESPERRT und nicht bloss wirkungslos - das ist die Lehre aus dem
  // Ghost-Kapitel.
  //
  // NICHT BEIM LADEN RUFEN. currentTrackTiles steht in 60-track.js, also in einer spaeteren
  // Datei, und ein Zugriff von hier waere zur Ladezeit die temporale Todeszone. Hier stand
  // erst ein Schutz "typeof currentTrackTiles !== 'undefined'" - der schuetzt NICHT: bei
  // einem let in der Todeszone wirft schon typeof, anders als bei var. Die ganze IIFE brach
  // damit ab, OMEGA_TEST war undefiniert, und ein Zeitgeber warf danach im Sekundentakt
  // weiter.
  //
  // Gerufen wird deshalb von aussen: aus refreshTrackPreview(), wo sich die Kachelzahl
  // aendert, und einmal beim Laden aus 98-presets.js, der letzten Datei.
  function dirtyAirVerfuegbar() {
    const row = $('dirtyair-row');
    const sw = $('setting-dirtyair');
    const genug = currentTrackTiles.length >= 3;
    if (sw) sw.disabled = !genug;
    if (row) row.classList.toggle('sim-off', !genug);
  }
  window.__dirtyAirVerfuegbar = dirtyAirVerfuegbar;

  if ($('setting-tyre-asym')) {
    const asymAnwenden = () => {
      physEngine.config.tyreAsymEffect = $('setting-tyre-asym').checked ? 1 : 0;
    };
    $('setting-tyre-asym').addEventListener('change', asymAnwenden);
    asymAnwenden();
  }

  if ($('setting-tyre-pressure')) {
    const druckAnwenden = (v) => {
      physEngine.config.tyrePressureBar = v;
      $('setting-tyre-pressure-val').textContent = v.toFixed(2) + ' bar';
    };
    $('setting-tyre-pressure').addEventListener('input',
      (e) => druckAnwenden(parseFloat(e.target.value)));
    druckAnwenden(parseFloat($('setting-tyre-pressure').value));
  }

  $('setting-fuel-drain').addEventListener('input', (e) => {
    fuelDrainPerSec = parseFloat(e.target.value);
    $('setting-fuel-drain-val').textContent = fuelDrainPerSec.toFixed(1);
  });

  // Der Regler laeuft ueber den INDEX dieser Liste, nicht ueber den Wert: ein
  // Bereichsregler hat eine feste Schrittweite, und 1 2 3 4 5 10 20 50 hat keine. Die
  // Liste steht hier und nicht im Markup, damit Regler und Anzeige nicht auseinanderlaufen.
  const CRASH_STEPS = [1, 2, 3, 4, 5, 10, 20, 50];
  $('setting-crash-count').addEventListener('input', (e) => {
    const i = Math.max(0, Math.min(CRASH_STEPS.length - 1, parseInt(e.target.value, 10)));
    crashesToTotal = CRASH_STEPS[i];
    $('setting-crash-count-val').textContent = crashesToTotal;
  });

  // Der Anfangswert wird NICHT hier gelesen, sondern in 70-race.js neben der Deklaration.
  // Hier stand er einen Anlauf lang, und das war ein ReferenceError: crashDetectionEnabled
  // ist ein let aus 70-race.js, also einer SPAETEREN Datei, und eine Zuweisung vor der
  // ausgefuehrten Deklaration liegt in der temporalen Todeszone. Sie hat den ganzen
  // restlichen Aufbau abgebrochen - sichtbar nur an zwei Folgefehlern zu calibRunning und
  // playing, nicht an der Ursache. Der Listener darf bleiben: er laeuft erst auf eine
  // Nutzergeste, lange nach der Deklaration.
  $('setting-crash-damage').addEventListener('change', (e) => {
    // Umgedreht gegenueber vorher: der Schalter hiess "Crashs ausschalten" und war damit
    // eine doppelte Negation - angehakt bedeutete "kein Schaden". Jetzt heisst er "Schaden"
    // und angehakt bedeutet, dass es welchen gibt.
    //
    // STANDARD AUS, und der Kommentar sagte hier "Standard an": das Markup und die
    // Voreinstellung Pro setzen ihn beide auf false, und die entscheiden. Eine Absicht im
    // Kommentar, die der Vorgabe widerspricht, ist schlimmer als keine.
    crashDetectionEnabled = e.target.checked;
    // Der Zaehler "Crashs bis Schadensbalken voll" ist ohne Schadensmodell bedeutungslos.
    $('setting-crash-count').disabled = !e.target.checked;
    log('Schadensmodell ' + (e.target.checked ? 'an' : 'aus') + '.', 'info');
  });

  $('setting-repair-time').addEventListener('input', (e) => {
    pitFullRepairS = parseInt(e.target.value, 10);
    $('setting-repair-time-val').textContent = pitFullRepairS + ' s';
  });

  // Die kalibrierte Vorgabe fuer das Lenkansprechen. Sie ist der Bezug fuer die Anzeige,
  // damit dort 100 % steht, wo der Wert hingehoert - und nicht 200 %.
  const STEER_RESP_REF = 2.0;

  // Die EINE Stelle, an der aus steerResponse eine Prozentzahl wird. Vorher gab es drei, in
  // zwei Maszstaeben: die Optionen teilten durch den kalibrierten Bezug 2,0 und zeigten
  // 100 %, das Steuerkreuz und die Cockpitkachel nahmen den Rohwert und zeigten 200 %. Wer
  // im Menue 100 % einstellt und dann aufs Steuerkreuz sieht, haelt eines von beiden fuer
  // kaputt.
  //
  // Sie steht ABSICHTLICH hier, direkt unter ihrer Konstante, und nicht bei den
  // Steuerkreuz-Funktionen in 90-ghosts.js. Dort waere sie eine Datei SPAETER als
  // STEER_RESP_REF, und dieselbe Datei ruft sie zur Aufbauzeit auf - genau die temporale
  // Todeszone, die in diesem Projekt schon fuenf Ladeabbrueche gekostet hat. In einer
  // zusammengefuegten IIFE ist das Ende einer Datei nicht das Ende des Moduls.
  function steerRespPct(v) { return Math.round(v / STEER_RESP_REF * 100); }
  ['phys-steerresp', 'phys-accel', 'setting-steer-calib', 'setting-brake-steal'].forEach(id => {
    const input = $(id);
    const readout = $(id + '-val');
    const apply = () => {
      const v = parseFloat(input.value);
      readout.textContent = v.toFixed(2);
      if (id === 'phys-steerresp') {
        physEngine.config.steerResponse = v;
        // Bezug ist die kalibrierte Vorgabe 2.0, nicht der Rohwert. 200 % zu lesen, wo
        // die beste Einstellung liegt, laesst sie wie eine Uebertreibung aussehen.
        //
        // Und was 100 % BEDEUTET, steht jetzt im Modell: steerMaxDeg = 45, der mechanische
        // Anschlag. Bei 100 % fordert voller Stick genau diesen Anschlag an - darunter
        // erreicht man ihn nie, darueber schon vor dem Stickende.
        $('phys-steerresp-val').textContent = steerRespPct(v) + '%';
      }
      if (id === 'phys-accel') physEngine.config.accelerationFactor = v;
      if (id === 'setting-brake-steal') {
        physEngine.config.brakeUseGain = v;
        readout.textContent = Math.round(v * 100) + '%';
      }
      if (id === 'setting-steer-calib') {
        physEngine.config.steerCalib = v;
        // Als Prozent, weil der Wert ein Faktor auf eine Anforderung ist und kein Winkel.
        // Ein Grad-Wert waere hier die falsche Einheit und die naechste Verwechslung: der
        // Winkel ist immer auf 45 Grad gedeckelt, egal was hier steht.
        readout.textContent = Math.round(v * 100) + '%';
      }
      markDrivetrainChartsDirty();
    };
    input.addEventListener('input', apply);
    apply();
  });

  // ---- Settings sliders matching the official app's Geschwindigkeit/Reifengrip/
  // Bremswirkung concepts, each backed by a real existing lever (no invented settings) ----
  // Beim Laden aus dem Markup gelesen statt hart gesetzt: der Wert stand auf 1 und passte
  // nur zufaellig zum value="1" im Dokument. Eine Aenderung dort waere stillschweigend
  // wirkungslos geblieben, bis jemand den Regler einmal anfasst.
  let topSpeedScale = parseFloat(($('setting-topspeed') || {}).value) || 1;
  const BASE_BRAKE = { base: physEngine.config.brakeDecelBase,
                       aero: physEngine.config.brakeDecelAero };

  $('setting-topspeed').addEventListener('input', (e) => {
    topSpeedScale = parseFloat(e.target.value);
    $('setting-topspeed-val').textContent = Math.round(topSpeedScale * 100) + '%';
  });

  $('setting-grip').addEventListener('input', (e) => {
    const grip = parseFloat(e.target.value);
    $('setting-grip-val').textContent = grip.toFixed(2);
    // Less grip = authority falls off sooner with speed. The old 0.7*(1-grip) collapsed to
    // 0.07 at the default grip, i.e. no falloff worth feeling — the sluggishness came from
    // the damping instead, which is gone. This keeps a real floor so the higher gears
    // actually go flatter, and grip still moves it.
    physEngine.config.speedSteerReduction = 0.20 + 0.30 * (1 - grip);
    // Steering RESPONSE is deliberately not touched here: that is the driver's trim on the
    // D-pad, not a property of the tyres.
  });

  $('setting-brakepower').addEventListener('input', (e) => {
    const mult = parseFloat(e.target.value);
    $('setting-brakepower-val').textContent = mult.toFixed(2);
    physEngine.config.brakeDecelBase = BASE_BRAKE.base * mult;
    physEngine.config.brakeDecelAero = BASE_BRAKE.aero * mult;
    markDrivetrainChartsDirty();
  });

  // ---- Constant-power-over-battery-life compensation ----
  // The motor gets weaker as the pack drains and we cannot add power, so the only way to
  // make the car feel the same all session is to hold it back while the battery is still
  // strong. Deliberately OFF by default because it costs peak speed. Both inputs to this
  // are approximations: the battery percentage comes from an uncalibrated two-point
  // estimate of one status byte, and we have no proof our throttle byte maps linearly to
  // motor RPM — so treat this as "feels more even", not as a measured correction.
  let batteryCompEnabled = false;
  let batteryCompReference = 0.5;

  $('setting-battery-comp').addEventListener('change', (e) => { batteryCompEnabled = e.target.checked; });
  $('setting-battery-ref').addEventListener('input', (e) => {
    batteryCompReference = parseFloat(e.target.value);
    $('setting-battery-ref-val').textContent = Math.round(batteryCompReference * 100) + '%';
  });

  function batteryCompensationScale() {
    if (!batteryCompEnabled || dashBattery === null) return 1;
    const currentFraction = Math.max(0.05, batteryPercent(dashBattery) / 100);
    return Math.max(0.2, Math.min(1, batteryCompReference / currentFraction));
  }


  // Racing screen. Reads only state that already exists and is fed from updateDashboard,
  // i.e. the exact same source as the cockpit — the two cannot drift apart.
  let wakeLock = null;
  async function keepScreenAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* unsupported or refused — the screen just dims as usual */ }
  }

  // A real GT3's tank, so "fuel" reads as litres rather than an abstract percentage.
  // fuel itself STAYS a 0..100 internal quantity everywhere else (bar widths, fuelLoad,
  // massFactor) — only user-facing text is converted, at the point of display.
  const FUEL_TANK_LITERS = 110;
  function fuelLiters(pct) { return Math.round(Math.max(0, pct) / 100 * FUEL_TANK_LITERS); }

  // Fullscreen for the racing screen. Three things can fail independently and all three
  // are handled rather than assumed: the Fullscreen API (older iOS), the Orientation Lock
  // API (iOS Safari and desktop always refuse), and the user leaving fullscreen with the
  // system gesture instead of our button.
  function raceIsPortrait() { return window.innerHeight > window.innerWidth; }

  function syncRaceRotation() {
    const fs = document.body.classList.contains('race-fs');
    document.body.classList.toggle('race-turn', fs && raceIsPortrait());
  }

  async function enterRaceFullscreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* refused: we still lay out as if fullscreen */ }
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) { /* refused on iOS and desktop; the CSS rotation covers it */ }
    document.body.classList.add('race-fs');
    syncRaceRotation();
    $('race-fs').hidden = true; $('race-fs-exit').hidden = false;
  }

  async function exitRaceFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch (e) { /* already out */ }
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }
    catch (e) { /* never locked */ }
    document.body.classList.remove('race-fs', 'race-turn');
    $('race-fs').hidden = false; $('race-fs-exit').hidden = true;
  }

  $('race-fs').addEventListener('click', enterRaceFullscreen);
  $('race-fs-exit').addEventListener('click', exitRaceFullscreen);
  // The buttons now live inside #race-dash, which the rotation transform also moves, so
  // they stay in the top-right corner of the ROTATED view rather than of the screen.
  window.addEventListener('resize', syncRaceRotation);
  // Leaving fullscreen by swipe or Escape must put the buttons back too.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('race-fs')) {
      exitRaceFullscreen();
    }
  });

  // One place decides what the gear reads, so the racing screen and the driving tab can
  // never disagree. No "M" suffix: the mode is visible in the options, and a letter glued
  // to the gear number was noise on a display meant to be read at a glance.
  function gearLabel(st) {
    if (st.driveMode === 'reverse') return 'R';
    if (st.driveMode === 'neutral') return 'N';
    return String(st.currentGear + 1);
  }


  // Einen Wert schreiben UND, wenn er sich geaendert hat, die Anzeige 1 px nach unten
  // setzen. 80 ms, dann zurueck: eine Anzeige mit Masse setzt sich kurz, ein Textfeld nicht.
  //
  // DER VERGLEICH IST DER GANZE PUNKT. Der Schirm wird jeden Takt neu geschrieben; ohne ihn
  // bekaeme jede Ziffer in jedem Frame die Klasse und zuckte dauernd. Ein MutationObserver
  // haette dasselbe Problem gehabt: textContent auf denselben Wert zu setzen ersetzt den
  // Textknoten trotzdem und feuert.
  //
  // Und NICHT am Tacho. Der aendert sich jeden Takt - dort ist der Versatz ein Dauerzittern
  // und keine Rueckmeldung. Verwendet wird sie fuer die Werte, die SPRINGEN: Gang,
  // Rundenzahl, Rundenzeiten.
  function schreibeWert(el, txt) {
    if (!el) return;
    const neu = String(txt);
    if (el.textContent === neu) return;
    el.textContent = neu;
    // Die Klasse zweimal in Folge zu setzen startet die Animation nicht neu - sie muss
    // erst weg sein. Der Neustart des Bildaufbaus (offsetWidth) ist die uebliche und
    // billigste Art, das zu erzwingen.
    el.classList.remove('gt3-tick');
    void el.offsetWidth;
    el.classList.add('gt3-tick');
  }

  // out ist HERAUS, und zwar weil es nicht benutzt wurde: die Anzeige liest alles aus dem
  // Zustand st, und die Ausgaben des Modells (motorPWM, servoAngle, Lichter) gehen an das
  // Auto und nicht auf den Schirm. Ein Parameter, den der Aufrufer uebergibt und der Rumpf
  // nicht anfasst, liest sich wie eine Zusage.
  function updateRaceScreen(st) {
    const gearEl = $('race-gear');
    if (!gearEl) return;
    // Zahl und Kennzeichnung getrennt, weil die Zahl mittig bleiben muss. textContent auf
    // den Knopf zu schreiben wuerde beide Kindknoten loeschen.
    const nEl = $('race-gear-n');
    if (nEl) schreibeWert(nEl, gearLabel(st));
    else schreibeWert(gearEl, gearLabel(st));
    const mEl = $('race-gear-m');
    if (mEl) mEl.textContent = physEngine.config.autoShift ? '' : 'M';
    $('race-rpm').textContent = Math.round(st.rpm);
    // Shown as the real-world equivalent, at the cars' actual 1:50 scale. This comment used
    // to argue the opposite - "the scale is NOT 1/50" - on the grounds that the acceleration
    // and braking models were calibrated against a GT3 topping out at 285 km/h, so the factor
    // had to be 285/4. That reasoning had it backwards: it derived the scale from a chosen
    // top speed instead of deriving the top speed from the known scale. The cars are 1:50,
    // the measured ground speed at full throttle is about 5.9 km/h, so the dash reads
    // 5.9 x 50 = 295 km/h flat out. See the derivation at REAL_SCALE.
    $('race-speed').textContent = Math.round(Math.abs(st.speedKmh) * REAL_SCALE);

    // Shift LEDs. Green, then red, then BLUE for the last two. The blue pair above red,
    // not below it, is what real GT3 wheels use for "shift now", and it makes the strip
    // readable without counting lamps.
    const frac = Math.max(0, Math.min(1, st.rpmFrac));
    const lamps = $('race-shift').children;
    const n = lamps.length;
    for (let i = 0; i < n; i++) {
      const lit = frac >= (i + 1) / n;
      let col = '#12161f';
      if (lit) {
        if (i >= n - 2) col = '#3d8bff';
        else if (i >= n - 5) col = '#ff3b3b';
        else col = '#2ee06a';
      }
      lamps[i].style.background = col;
      lamps[i].style.boxShadow = lit
        ? 'inset 0 0 0 1px rgba(255,255,255,.25), 0 0 6px ' + col
        : 'inset 0 0 0 1px #262e3d';
    }
    // On the limiter the whole strip flashes blue, which no steady pattern can be mistaken
    // for.
    if (st.onLimiter && Math.floor(Date.now() / 90) % 2 === 0) {
      for (let i = 0; i < n; i++) {
        lamps[i].style.background = '#3d8bff';
        lamps[i].style.boxShadow = '0 0 8px #3d8bff';
      }
    }

    // ABS is a real flag in the model, so it earns a cell. Traction control does not exist
    // in this drivetrain and therefore gets no cell, rather than a permanent zero.
    $('race-abs').classList.toggle('active', st.absActive);

    // Headlight tell-tale. Reads the real state rather than sniffing the lamp's CSS
    // colour: there are two different "off" colours in this file (#3a4a6b and #444), so a
    // colour comparison silently matched the wrong one and the indicator never went out.
    // raceLampHead is whatever resolveLights() settled on, so a flash, the damage
    // flicker and the empty-tank blink all show up here too.
    $('race-light').classList.toggle('on', !!raceLampHead);

    $('race-fuel').textContent = fuelLiters(fuel) + ' l';
    $('race-fuel-bar').style.width = Math.max(0, fuel) + '%';
    $('race-fuel-bar').style.background = fuel < 20 ? '#ffb02e' : '#2ee06a';
    // Condition, not damage: full green at the start, and every crash takes a piece out.
    // A bar that GROWS as things get worse reads backwards at a glance. Every other bar on
    // this dash empties when something runs out, and this one now behaves the same way.
    // Internally `damage` still counts upward from 0; only the presentation is inverted, so
    // no crash, repair or pit-stop arithmetic had to be touched.
    const health = Math.max(0, Math.min(100, 100 - damage));
    $('race-dmg').textContent = Math.round(health) + '%';
    $('race-dmg-bar').style.width = health + '%';
    $('race-dmg-bar').style.background = health <= 20 ? '#ff5252'
                                       : (health <= 55 ? '#ffb02e' : '#2ee06a');
    $('race-batt').textContent = dashBattery === null ? '\u2013' : batteryPercent(dashBattery) + '%';

    const live = !!(device && device.gatt && device.gatt.connected);
    // race-conn und race-track sassen in der entfernten Kachel "Strecke". Der
    // Weather icon plus the fitted tyres. The tyres matter more than the weather here:
    // they are what tells you whether the pit stop is still outstanding.
    const wet = weather === 'rain';
    $('race-wx-sun').style.display = wet ? 'none' : '';
    $('race-wx-rain').style.display = wet ? '' : 'none';
    $('race-wx-rain').style.color = wet ? '#5aa9ff' : '';
    // G plot. Red is the simulation, green the car's own raw motion bytes — the two are
    // scaled independently on purpose: the real numbers are far noisier and much larger
    // relative to their range, so a shared scale would push one of them off the dial.
    const R = 42;
    $('race-g-sim').setAttribute('cx', (50 + Math.max(-1, Math.min(1, st.gLat)) * R).toFixed(1));
    $('race-g-sim').setAttribute('cy', (50 + Math.max(-1, Math.min(1, -st.gLong)) * R).toFixed(1));

    // Das Einspurmodell in zwei Zahlen. Beide sind Instrument.
    //
    // Die AUSNUTZUNG traegt den Vorbehalt, den die Messung ergeben hat: der Lenkbereich der
    // App geht bis 45 Grad und gehoert damit zu einem Modellauto, die angezeigten Tempi
    // gehoeren zu einem echten. Gemessen sind 4 Grad bei 120 km/h ein Radius von 36 Metern
    // und damit 3,1 g - richtig gerechnet und fuer ein echtes Auto unmoeglich. Ueber 100
    // Prozent steht deshalb ein Groesserzeichen: die Anzeige sagt dann "so faehrt kein Auto
    // durch diese Kurve" und tut nicht so, als waere es eine feine Abstufung.
    const yawEl = $('race-yaw');
    if (yawEl) {
      if (!(physEngine.config.yawModelEffect > 0)) {
        yawEl.textContent = t('aus');
      } else {
        // GIERRATE gegen ihren STATIONAEREN Wert und nicht die Ausnutzung.
        //
        // Die Ausnutzung stand hier und war gefahren gemessen dauerhaft ueber 100 Prozent -
        // eine Anzeige am Anschlag sagt nichts. Der Grund ist der Skalenwiderspruch der App
        // (Lenkbereich vom Modellauto, Tempi vom echten), und er laesst sich nicht wegrechnen.
        //
        // Ein VERHAELTNIS zweier Modellgroessen ist davon unberuehrt: 100 Prozent heisst
        // eingeschwungen, mehr heisst "dreht noch ein", weniger heisst "schiebt". Genau das
        // hat der Bauplan versprochen, und es ist die eine Aussage, die hier skalenfrei ist.
        const grad = Math.abs(st.yawRate * 180 / Math.PI);
        const soll = Math.abs(st.yawSteady);
        const anteil = soll > 0.02 ? Math.round(100 * Math.abs(st.yawRate) / soll) : null;
        yawEl.textContent = grad.toFixed(0) + '°/s'
          + (anteil === null ? '' : ' · ' + Math.min(999, anteil) + '%');
      }
    }
    const gx = Math.max(-1, Math.min(1, gyroRaw.x / gyroRaw.span));
    const gy = Math.max(-1, Math.min(1, gyroRaw.y / gyroRaw.span));
    $('race-g-real').setAttribute('cx', (50 + gx * R).toFixed(1));
    $('race-g-real').setAttribute('cy', (50 + gy * R).toFixed(1));

    // ---- Reifen und Bremsscheiben: vier echte Werte --------------------------------
    //
    // Bis v0.5 zeigten vier Felder ZWEI Werte (links/rechts verklebt) und vier Ringe ZWEI
    // Temperaturen (vorn/hinten verklebt). Das passte zum Modell. Seit der
    // Vierradverlagerung fuehrt es vier Radlasten, vier Reifentemperaturen, vier
    // Verschleisswerte und vier Scheibentemperaturen - also zeigt die Anzeige vier.
    //
    // DIE REIHENFOLGE STEHT AN EINER STELLE: das Modell fuehrt [vorne links, vorne rechts,
    // hinten links, hinten rechts], und dieses Feld hier in derselben. Eine zweite Zuordnung
    // irgendwo waere die Gelegenheit, links und rechts zu tauschen - und ein vertauschtes Rad
    // in einer Anzeige, die plausibel aussieht, findet man erst beim dritten Rennen.
    {
      const cfgT = physEngine.config;
      const aus = cfgT.tyreEffect === 0;
      // Der Fading-Schalter gilt fuer die WIRKUNG und NICHT fuer die Anzeige, und deshalb
      // steht hier keine Abfrage mehr auf ihn. Die Scheibentemperatur wird immer gerechnet
      // (brakeHeatRate * Math.max(1, brakeFadeEffect), also auch bei 0), und sie immer zu
      // zeigen ist die ehrlichere Aufteilung: mit abgeschaltetem Fading sind die Scheiben ein
      // Instrument ohne Folgen - man sieht sie gluehen und der Bremsweg bleibt gleich. Das
      // ist etwas anderes als abgeschaltet.
      //
      // Vorher hing die Farbe am Schalter, und die Pro-Abstimmung schaltet ihn aus: die
      // Scheiben blieben grau, obwohl die Physik lief. Gemeldet als "beim Bremsen von 150
      // auf 0 passiert nichts mit den Bremsscheiben" - und die Ursache war ein Schalter, der
      // zwei Dinge bedeutete.
      const REIFEN = ['race-tyre-fl', 'race-tyre-fr', 'race-tyre-rl', 'race-tyre-rr'];
      const SCHEIBEN = ['race-disc-fl', 'race-disc-fr', 'race-disc-rl', 'race-disc-rr'];

      // Reifenfarbe aus der Temperatur DIESES Rades: blau kalt, gruen im Fenster, rot zu
      // heiss. Dieselbe Rechnung wie bisher, nur je Rad statt einmal.
      const reifenFarbe = (T) => {
        if (aus) return '#4a5568';
        const warm = Math.max(0, Math.min(1, (T - cfgT.tyreAmbientC)
                                             / (cfgT.tyreOptimalC - cfgT.tyreAmbientC)));
        if (T > cfgT.tyreOptimalC) {
          const over = Math.min(1, (T - cfgT.tyreOptimalC)
                                   / (cfgT.tyreOverheatC - cfgT.tyreOptimalC));
          return 'rgb(' + Math.round(70 + 185 * over) + ', ' + Math.round(209 - 130 * over)
               + ', ' + Math.round(127 - 100 * over) + ')';
        }
        return 'rgb(' + Math.round(60 + 10 * warm) + ', ' + Math.round(140 + 69 * warm)
             + ', ' + Math.round(230 - 103 * warm) + ')';
      };

      // SCHEIBENFARBE, auf die gemessenen Temperaturen gelegt und nicht geraten.
      //
      // Die alte Skala spreizte den kalten Bereich ueber 275 Grad. Eine gefahrene Bremsung
      // aus 150 km/h erreicht aber nur 70 Grad, drei erreichen 176 - der ganze Vorgang
      // spielte sich in den ersten 15 bis 55 Prozent der Skala ab, wo sie fast nichts tut.
      // Gemeldet als "beim Bremsen von 150 auf 0 passiert nichts mit den Bremsscheiben", und
      // gemessen war es rgb(44,71,74) gegen rgb(42,51,70) kalt: die Farbe AENDERTE sich, nur
      // nicht sichtbar. Das ist derselbe Fehler wie keine Aenderung.
      //
      // Die Abschnitte, jeder aus einer Messung:
      //   25 bis 200 Grad   normales Fahren, eine bis drei Bremsungen  -> dunkelblau nach gruen
      //   200 bis 520 Grad  harter Renneinsatz, drei aus 250 km/h      -> gruen nach orange
      //   ab 520 Grad       hier setzt das Fading ein                  -> orange nach rot
      //   780 Grad          Fading voll                               -> volles rot
      // Damit sagt die Farbe etwas: rot heisst "die Bremse laesst nach", und ab 520 ist das
      // auch wahr.
      const scheibenFarbe = (T) => {
        const mischen = (a, b, x) => 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * x) + ', '
          + Math.round(a[1] + (b[1] - a[1]) * x) + ', '
          + Math.round(a[2] + (b[2] - a[2]) * x) + ')';
        const KALT = [42, 51, 70], WARM = [62, 209, 106];
        const HEISS = [255, 168, 62], ROT = [255, 48, 32];
        const start = cfgT.brakeFadeStartC, voll = cfgT.brakeFadeFullC;
        if (T >= start) {
          return mischen(HEISS, ROT,
            Math.min(1, (T - start) / Math.max(1, voll - start)));
        }
        if (T >= 200) return mischen(WARM, HEISS, (T - 200) / Math.max(1, start - 200));
        const u = cfgT.brakeAmbientC;
        return mischen(KALT, WARM, Math.max(0, (T - u) / Math.max(1, 200 - u)));
      };

      // Welches Rad gerade abgebaut ist. Beim Boxenstopp laeuft der Schrauberton ueber die
      // ganze Wechseldauer und man hoert darin vier Ansaetze - also zeigt die Anzeige vier
      // Ausfaelle, einen je Rad. Ohne das sieht man vier Toene und keine Bewegung.
      const abIdx = typeof pitWheelOff === 'function' ? pitWheelOff() : -1;
      for (let i = 0; i < 4; i++) {
        const el = $(REIFEN[i]);
        if (el && el.firstChild) {
          const ab = i === abIdx;
          el.classList.toggle('t4-ab', ab);
          const w = aus ? 0 : (st.tyreWear4 ? st.tyreWear4[i] : st.tyreWear);
          // Abgebaut heisst leer: es ist kein Reifen da, dessen Profil man zeigen koennte.
          const rest = ab ? 0 : Math.max(0, Math.min(100, 100 - w * 100));
          el.firstChild.style.height = rest + '%';
          el.firstChild.style.background =
            reifenFarbe(st.tyreTemp4 ? st.tyreTemp4[i] : st.tyreTempC);
        }
        const sc = $(SCHEIBEN[i]);
        if (sc) {
          sc.style.background =
            scheibenFarbe(st.brakeTemp4 ? st.brakeTemp4[i]
                                        : (i < 2 ? st.brakeTempF : st.brakeTempR));
        }
      }

      // Eine Zeile fuer beides, und sie nennt den BEREICH statt eines Mittelwerts: bei vier
      // verschiedenen Werten ist der Mittelwert die eine Zahl, die kein Rad hat. Das
      // heisseste Rad und der staerkste Verschleiss sind die Zahlen, auf die man reagiert.
      const tt = $('race-tyre-temp');
      if (tt) {
        if (aus) {
          tt.textContent = 'aus';
        } else {
          const t4 = st.tyreTemp4 || [st.tyreTempC];
          const w4 = st.tyreWear4 || [st.tyreWear];
          const b4 = st.brakeTemp4 || [st.brakeTempF, st.brakeTempR];
          const heiss = Math.round(Math.max.apply(null, t4));
          const kalt = Math.round(Math.min.apply(null, t4));
          const ab = Math.round(Math.max.apply(null, w4) * 100);
          const bmax = Math.round(Math.max.apply(null, b4));
          tt.textContent = (kalt === heiss ? heiss + '\u00b0' : kalt + '\u2013' + heiss + '\u00b0')
            + ' ' + ab + '%' + ' \u00b7 ' + bmax + '\u00b0';
        }
      }
    }

    // Abgeschaltete Simulationen kennzeichnen. Hier und nicht in den Umschaltfunktionen:
    // die Regler lassen sich auch in den Optionen bewegen, und dann muesste die Kachel dort
    // ebenfalls nachgezogen werden. Ein Ort, der jeden Takt aus dem Zustand liest, kann
    // nicht auseinanderlaufen.
    const tankAus = fuelDrainPerSec <= 0;
    const schadenAus = !crashDetectionEnabled;
    const tankKachel = document.querySelector('[data-pit="refuel"]');
    const schadenKachel = document.querySelector('[data-pit="repair"]');
    if (tankKachel) tankKachel.classList.toggle('sim-off', tankAus);
    if (schadenKachel) schadenKachel.classList.toggle('sim-off', schadenAus);
    const reifenKachel = $('race-tyre-box');
    if (reifenKachel) reifenKachel.classList.toggle('sim-off',
      physEngine.config.tyreEffect <= 0);

    // Dieselben zwei Groessen, die auf dem Steuerkreuz liegen - hoch/runter und
    // links/rechts. Die Kachel zeigt, was das Kreuz verstellt, und nichts anderes.
    $('race-trim-accel').textContent = Math.round(physEngine.config.brakeBias * 100) + '%';
    // Die Marke auf der Skala. Der Bereich kommt aus dem Bedienelement und nicht aus
    // Konstanten hier: eine zweite Kopie von min und max liefe beim naechsten Nachziehen
    // auseinander.
    const bm = $('race-bias-mark'), bi = $('setting-brakebias');
    if (bm && bi) {
      const lo = +bi.min, hi = +bi.max;
      const t = Math.max(0, Math.min(1,
        (physEngine.config.brakeBias * 100 - lo) / Math.max(1e-6, hi - lo)));
      // Oben ist VORN, also wird t umgedreht: viel Balance vorn heisst kleine y-Koordinate.
      bm.setAttribute('y', (2.5 + (1 - t) * 16.2).toFixed(2));
    }
    $('race-trim-steer').textContent = steerRespPct(physEngine.config.steerResponse) + '%';

    // Pit banner replaces the shift bar while the pit lane is active — impossible to miss,
    // which the old small field was not.
    // The banner has its own full-width row at the bottom now, so it no longer has to hide
    // the shift lights to be seen: losing the rev display on entering the pit lane was a
    // bad trade for a warning.
    const pit = $('gt3-pit');
    if (pitState === 'off') {
      pit.classList.remove('on');
    } else {
      pit.classList.add('on');
      $('race-pit-text').textContent = pitState === 'limited'
        ? 'PIT LIMITER ENGAGED \u00b7 '
          + Math.round(PIT_SPEED_FACTOR * physEngine.config.topSpeedKmh * REAL_SCALE) + ' KM/H'
        : 'PIT STOP \u00b7 ' + ((Date.now() - (pitServiceStart || Date.now())) / 1000).toFixed(1) + 's'
          + ' \u00b7 TANK +' + fuelLiters(pitFuelGained) + 'l'
          + ' \u00b7 REP +' + Math.round(pitDamageRepaired) + '%';
    }

    if (raceState === 'finished' && racePartialMs !== null) {
      // Nach dem Ende steht hier die abgebrochene Runde, mit Klammer als Zeichen dafuer,
      // dass sie nicht zaehlt.
      $('race-lap-now').textContent = '(' + formatLapTime(racePartialMs) + ')';
      return;
    }
    $('race-lap-now').textContent = raceLapStart !== null
      ? formatLapTime(Date.now() - raceLapStart)
      : (dashLapStart !== null ? formatLapTime(Date.now() - dashLapStart) : '\u2013');
    const laps = raceLapTimes.length ? raceLapTimes : dashLapTimes.map((ms, i) => ({ lap: i + 1, ms }));
    const best = laps.length ? Math.min(...laps.map(l => l.ms)) : null;
    schreibeWert($('race-lap-best'), best === null ? '\u2013' : formatLapTime(best));
    // Mode and remaining time/laps belong on the dash: that is where they are read.
    const modeEl = $('race-clock');
    if (modeEl && raceState !== 'racing') {
      modeEl.textContent = raceState === 'finished' ? 'beendet' : RACE_MODES[raceMode].label;
    }
    schreibeWert($('race-lap-last'), laps.length
      ? formatLapTime(laps[laps.length - 1].ms) : '\u2013');
    // Das Ziel gehoert in dieselbe Kachel: "Runde 3" allein sagt nicht, ob noch 17 oder
    // noch 2 kommen. Bei Endurance und Qualifying ist das Ziel eine ZEIT, also steht dort
    // die verbleibende Zeit - eine Rundenzahl anzuschreiben, die es in diesem Modus nicht
    // gibt, waere eine erfundene Angabe.
    $('race-lap-count').textContent = raceLapTarget(laps.length);
    $('race-lap-list').innerHTML = laps.slice().reverse().slice(0, 10).map(l =>
      `<li><span>${l.lap}</span><span${l.ms === best ? ' class="gt3-ok"' : ''}>${formatLapTime(l.ms)}</span></li>`
    ).join('');
  }

  // Hier standen sechs setTxt/setSty auf Elemente der entfernten alten Karte
  // (dash-gear, dash-speed, dash-rpm, dash-abs, dash-head, dash-brake). Alle geschuetzt
  // ueber setTxt/setSty, also harmlos - aber die Funktion sah aus, als zeichnete sie ein
  // Armaturenbrett, und das tut sie nicht: das macht updateRaceScreen().
  //
  // resolveLights() bleibt, und zwar nicht als Anzeige: es setzt lightBits und liefert
  // raceLampHead, die BEIDE ins gesendete Paket gehen.
  function updateDashboard(out) {
    const st = physEngine.state;
    updateRaceScreen(st);
    const lamp = resolveLights(out.lights.head, out.lights.brake);
    raceLampHead = lamp.head;
  }

  // Advances the simulation and publishes its shaped output into physOutSteer/
  // physOutThrottle for controlHeartbeat() to transmit. Driven by the heartbeat itself
  // (NOT requestAnimationFrame) on purpose: rAF is paused by the browser whenever the
  // page isn't being composited (hidden/minimised/background tab). With rAF, physics
  // would freeze while the heartbeat happily kept re-sending the last throttle value —
  // i.e. the car would keep driving at whatever speed it had when you looked away.
  // Timer-driven, physics keeps decelerating normally instead.
  // Autopilot fuer das FAHRERAUTO waehrend der gelben Flagge.
  //
  // Der Anlass: waehrend Gelb stellt man abgeflogene Ghosts von Hand zurueck auf die Bahn,
  // hat dabei beide Haende voll und keine am Controller - und das eigene Auto bleibt stehen
  // oder faehrt in die Bande.
  //
  // NUR in der Bahn-Stellung (Byte 14 Bit 5). Das ist keine Vorsicht, sondern eine Aussage
  // ueber Gemessenes: dort haelt sich das Auto nachgewiesen selbst auf der Strecke, der
  // Autopilot muss also nur Gas und Bremse stellen. In der Ausdruck-Stellung haelt es sich
  // nicht selbst, und ein Autopilot ohne Querregelung wuerde es geradeaus in die Bande
  // fahren - schlimmer als Stehenbleiben.
  //
  // Der Regler ist DERSELBE wie bei den Ghosts (Verstaerkung 4 auf Gas, 3 auf die Bremse),
  // und zwar aus einem inhaltlichen Grund: waehrend Gelb sollen alle Autos dasselbe tun.
  // Zwei verschiedene Regler, die beide 40 km/h halten wollen, ergeben zwei verschiedene
  // Geschwindigkeiten, und dann faehrt das Feld nicht geschlossen.
  //
  // Nicht waehrend der Anfahrt: sobald die Ampel laeuft, gehoert das Auto wieder dem
  // Fahrer, denn genau dann faengt das Rennen wieder an.
  // ZWEI GRUENDE, aus denen das Auto des Fahrers selbst faehrt, und beide sagen dasselbe:
  // die Haende sollen frei sein. Bei Gelb, um abgeflogene Ghosts zurueckzustellen; in der
  // Einfuehrungsrunde, weil das die Runde VOR dem Fahren ist.
  //
  // BIS v0.4.54 KANNTE DIESE STELLE NUR GELB, und das war eine halbe Umsetzung des
  // fliegenden Starts: die Ghosts rollten im Boxentempo von selbst, das Auto des Fahrers
  // wurde nur GEDROSSELT (limitFormation -> speedLimitFactor) und musste weiter von Hand
  // gelenkt und gegast werden. raceFormationLap kam in dieser Datei gar nicht vor.
  //
  // DER GRUND WIRD ZURUECKGEGEBEN und nicht nur ein Boolean: die Flaggenanzeige in
  // 90-ghosts.js braucht ihn auch, und dort stand die Bedingung bisher ein zweites Mal
  // abgeschrieben - mit dem Vermerk, dass bei einer dritten Stelle eine Funktion daraus
  // gehoert. Das hier ist die dritte Stelle.
  //
  // raceFormationLap und flagState werden ohne typeof gelesen: sie stehen in SPAETEREN
  // Quelldateien, aber diese Funktion laeuft erst zur Laufzeit - physicsStep() haengt am
  // 45-ms-Takt, und updateFlagUi() ruft sie nach dem Laden. Genau das galt fuer flagState
  // schon vorher.
  function autopilotGrund() {
    // Ausdruck-Stellung: nicht lenkfaehig. Ohne Leitplanken haelt sich das Auto nicht selbst
    // auf der Bahn, und ein Autopilot ohne Querregelung faehrt es geradeaus in die Bande.
    // trackMode ist ein STRING ('on'/'off') und kein Boolean - ein !trackMode waere hier
    // immer falsch gewesen.
    if (trackMode !== 'on') return null;
    if (raceFormationLap) {
      // Beides kann gelten: wenn in der Einfuehrungsrunde jemand abfliegt. Dann gewinnt der
      // LANGSAMERE, und das ist keine Rangfolge, sondern eine Rechnung.
      return (flagState === 'yellow' && yellowFactor() < formationPace())
        ? 'yellow' : 'formation';
    }
    return flagState === 'yellow' ? 'yellow' : null;
  }

  function autopilot(fahrerBremse) {
    const grund = autopilotGrund();
    if (!grund) return null;
    const st = physEngine.state;
    // DASSELBE Tempo wie die Ghosts, siehe formationPace(): sonst rollt das Feld mit 0,35
    // und der Fahrer mit 0,271, und die Kolonne faellt beim Anrollen auseinander.
    const ziel = grund === 'formation' ? formationPace() : yellowFactor();
    const v = Math.abs(st.speedKmh) / physEngine.config.topSpeedKmh;
    const err = ziel - v;
    let throttle = Math.max(0, Math.min(1, err * 4));
    let brake = Math.max(0, Math.min(1, -err * 3));
    // DIE BREMSE DES FAHRERS GEWINNT, aber nur in der Einfuehrungsrunde. Dort rollt das Feld
    // in zwei Kolonnen dicht hintereinander, und ein Auto, das man nicht anhalten kann, ist
    // ein Auto, das rammt. Bei Gelb bleibt es absichtlich beim vollen Eingriff: dort ist der
    // Sinn, dass die Haende ganz frei sind, waehrend man Autos aufsammelt.
    if (grund === 'formation' && fahrerBremse > 0.05) {
      brake = Math.max(brake, fahrerBremse);
      throttle = 0;
    }
    return { grund, throttle, brake,
             // Bei Gelb geradeaus - eine vorhersagbare Spur, damit man ein Auto von Hand
             // dazwischenstellen kann. In der Einfuehrungsrunde wie die Ghosts.
             steer: grund === 'formation' && typeof formationDriverOffset === 'function'
               ? formationDriverOffset() : 0 };
  }

  // ---- Abseits der Fahrbahn ----------------------------------------------------------
  //
  // Byte 12 meldet 0x00, wenn der Sensor keinen Streckencode sieht - das ist "neben der
  // Bahn". Bis v0.4 hat das nur die Ghosts angehalten und die Zeitzaehlung gefuettert; fuers
  // Fahrerauto hatte es keine Folge.
  //
  // ENTPRELLT, und das ist der Teil, ohne den es als Ruckeln auffaellt statt als Merkmal:
  // Byte 12 flattert, und ein einzelnes 0x00 zwischen guten Lesungen ist Rauschen. Steht so
  // schon in der Zeitleiste der Codes. Erst nach OFFTRACK_EIN_MS durchgehend abseits gilt
  // es, und nach OFFTRACK_AUS_MS wieder guter Lesung ist es vorbei - asymmetrisch, weil ein
  // verspaeteter Einsatz harmlos und ein verspaetetes Ende aergerlich ist.
  // EINSTELLBAR, Vorgabe 1000 ms. Vorher standen hier 350 ms fest, und das ist kuerzer
  // als das Ueberfahren einer Kachelkante: leichtes Schneiden wurde damit schon als Abflug
  // gedrosselt. Wer ganz ohne Nachsicht fahren will, stellt 0 ein.
  //
  // Es bleibt eine EINSCHALTVERZOEGERUNG und wird kein Mittelwert: 1 s durchgehend abseits
  // heisst abseits, ein einzelnes Paket dazwischen setzt die Uhr zurueck (siehe
  // offtrackMelden). Ein gleitendes Mittel wuerde dauerndes Streifen unsichtbar machen.
  let offtrackEinMs = 1000;
  const OFFTRACK_AUS_MS = 150;
  // 45 % und nicht 0: neben der Bahn muss man ZURUECKKOMMEN. Ein Auto, das dort
  // stehenbleibt, muss man holen, und dann ist die Drosselung eine Strafe statt einer
  // Rueckmeldung.
  const OFFTRACK_GAS = 0.45;
  // Der Rumble wird nachgetriggert, weil playEffect eine Dauer hat. Etwas kuerzer als die
  // Dauer, damit keine Luecke entsteht.
  const OFFTRACK_RUMBLE_MS = 220;
  let offtrackEffekt = true;
  let offtrackSeit = null;      // seit wann durchgehend 0x00
  let offtrackWiederSeit = null; // seit wann durchgehend etwas anderes
  let offtrackAktiv = false;
  let offtrackRumbleAt = 0;
  // Wie oft das Auto die Bahn verlassen hat, seit dem Laden. Als FLANKE gezaehlt: der
  // Zustand allein waere je Takt ein Abgang. Gebraucht wird er von der Mehrspieler-Rangliste,
  // und er ist die Zahl, die man nach einem Rennen wissen will - der Zeitanteil abseits
  // stand schon in der Fusszeile, die ANZAHL nicht.
  let offtrackZaehler = 0;

  // Gerufen aus dem Meldekanal in 70-race.js, also je Paket.
  function offtrackMelden(abseits) {
    const jetzt = Date.now();
    if (abseits) {
      offtrackWiederSeit = null;
      if (offtrackSeit === null) offtrackSeit = jetzt;
      if (!offtrackAktiv && jetzt - offtrackSeit >= offtrackEinMs) {
        offtrackAktiv = true;
        offtrackZaehler++;
      }
    } else {
      offtrackSeit = null;
      if (offtrackWiederSeit === null) offtrackWiederSeit = jetzt;
      if (offtrackAktiv && jetzt - offtrackWiederSeit >= OFFTRACK_AUS_MS) offtrackAktiv = false;
    }
    offtrackAnzeige();
  }

  // Wirkt nur im Bahn-Modus. Im Ausdruck-Modus ist der Streckensensor abgeschaltet
  // (gemessen 0 Lesungen in 551 Fahrmeldungen), Byte 12 steht dort praktisch immer auf
  // 0x00 - die Drosselung wuerde also IMMER greifen, und man wuerde den Fehler beim Motor
  // suchen.
  // ZWEI FRAGEN, die vorher eine waren:
  //
  //   abseitsJetzt()  - liegt das Auto neben der Bahn? Eine Tatsache, kein Schalter.
  //   offtrackGilt()  - soll die DROSSELUNG greifen? Die Tatsache plus ihr eigener Schalter.
  //
  // Getrennt, weil das Brummen bis v0.4.55 in derselben Klammer sass: wer die Drosselung
  // abschaltete, verlor auch die Rueckmeldung, obwohl er sie nicht abgeschaltet hatte. Das
  // Brummen haengt jetzt allein am Vibrationsschalter, die Drosselung allein am eigenen.
  function abseitsJetzt() {
    return offtrackAktiv && trackMode === 'on';
  }

  function offtrackGilt() {
    return offtrackEffekt && abseitsJetzt();
  }

  function offtrackAnzeige() {
    const el = $('gt3-offtrack');
    if (!el) return;
    // Nur ein- und ausblenden, den TEXT nie umschreiben. Hier stand einmal
    // t('ABSEITS \u00b7 GAS ' + Prozent + '%') - ein dynamischer Woerterbuchschluessel, und
    // solche gibt es hier nicht: nachgeschlagen werden ganze Textknoten. Eine Aenderung an
    // OFFTRACK_GAS haette die Uebersetzung still ausfallen lassen.
    el.style.display = offtrackGilt() ? 'block' : 'none';
  }

  // Ist das Auto neben der Bahn? Die entprellte Antwort, und ausdruecklich OHNE
  // offtrackEffekt und ohne den Bahn-Modus - das sind Fragen der Drosselung, nicht der Lage.
  // Die Boxengasse im Modus "Neben der Strecke" liest sie, um zu entscheiden, ob ein
  // angeforderter Stopp anfangen darf.
  function istAbseits() { return offtrackAktiv; }

  if ($('setting-offtrack-delay')) {
    const zeigeVerzoegerung = () => {
      $('setting-offtrack-delay-val').textContent = offtrackEinMs === 0
        ? 'sofort' : (offtrackEinMs / 1000).toFixed(1) + ' s';
    };
    offtrackEinMs = Math.round(parseFloat($('setting-offtrack-delay').value) * 1000);
    zeigeVerzoegerung();
    $('setting-offtrack-delay').addEventListener('input', (e) => {
      offtrackEinMs = Math.round(parseFloat(e.target.value) * 1000);
      zeigeVerzoegerung();
      // Die laufende Uhr NICHT zuruecksetzen: wer den Regler waehrend eines Abflugs
      // verschiebt, soll die neue Schwelle sofort auf die schon vergangene Zeit angewandt
      // sehen und nicht von vorn zaehlen.
      offtrackAnzeige();
    });
  }

  if ($('setting-offtrack')) {
    offtrackEffekt = $('setting-offtrack').checked;
    $('setting-offtrack').addEventListener('change', (e) => {
      offtrackEffekt = e.target.checked;
      offtrackAnzeige();
    });
  }

  // Der laufende Wert des Tankdeckels, siehe fuelCutTarget() in 70-race.js. 1 = offen.
  let fuelCut = 1;

  function physicsStep() {
    if (!physicsEnabled) { physLastTime = null; return; }
    const now = performance.now();
    const dt = physLastTime ? Math.min(0.25, (now - physLastTime) / 1000) : CONTROL_SEND_INTERVAL_MS / 1000;
    physLastTime = now;
    // Derated, not raw. Braking is left alone: brakes do not care how much fuel is left,
    // and a damaged car that cannot slow down would be the opposite of a limp mode.
    //
    // DIE RAMPE DES LEEREN TANKS laeuft hier, weil dies die einzige Stelle mit einem
    // verlaesslichen dt ist - dasselbe Argument, das weiter unten fuer die gefahrene Strecke
    // steht. Ein Tank, der leer wird, nimmt das Gas damit ueber knapp zwei Sekunden weg
    // statt in einem Takt, und die Simulation rollt aus.
    const cutZiel = fuelCutTarget();
    if (cutZiel > fuelCut) fuelCut = cutZiel;   // Tanken wirkt sofort
    else fuelCut += (cutZiel - fuelCut) * (1 - Math.exp(-dt / FUEL_CUT_TAU));
    let rawThrottle = fuelDamageDerate(Math.max(0, throttleY), fuelCut);
    let rawBrake = Math.max(0, -throttleY);
    let steer = steerX;
    // Bei gelber Flagge und in der Einfuehrungsrunde faehrt das Auto selbst. Siehe
    // autopilotGrund() fuer die zwei Gruende und autopilot() fuer die Regelung.
    const ap = autopilot(rawBrake);
    if (ap) { rawThrottle = ap.throttle; rawBrake = ap.brake; steer = ap.steer; }
    // Abseits der Bahn gedeckelt, und zwar VOR der Physik. Genau das war der Fehler beim
    // Gasfaktor: er wirkte nach der Physik auf die Ausgabe, der Tacho zeigte volles Tempo
    // und das Auto fuhr langsamer. Hier sagen Anzeige und Auto dasselbe.
    // Die Drosselung an ihrem Schalter ...
    if (offtrackGilt()) {
      rawThrottle = Math.min(rawThrottle, OFFTRACK_GAS);
    }
    // ... und das Brummen an seinem. padRumble() prueft rumbleOn selbst, also steht hier nur
    // die Frage, OB gebrummt werden soll - nicht, ob der Nutzer Vibration will.
    if (abseitsJetzt()) {
      const jetzt = Date.now();
      if (jetzt - offtrackRumbleAt >= OFFTRACK_RUMBLE_MS - 40) {
        offtrackRumbleAt = jetzt;
        // Dauerhaft und schwach, nicht ein Stoss wie beim Crash: ein Dauerrumble in
        // Crash-Staerke ist nach fuenf Sekunden nur noch nervig. Der schwache Motor traegt
        // mehr, das fuehlt sich nach Schotter an und nicht nach Aufprall.
        padRumble(0.12, 0.34, OFFTRACK_RUMBLE_MS);
      }
    }
    // Windschatten: gemessen wird in 90-ghosts.js (nur dort ist bekannt, wo die anderen
    // Autos sind), uebernommen wird hier. MIT Zeitkonstante - ein Windschatten, der zwischen
    // zwei Takten von 0 auf 1 springt, ist ein Grip-Sprung, und den spuert man als Ruck.
    //
    // Der Aufruf ist defensiv, weil 90-ghosts.js SPAETER gebaut wird: zur Ladezeit waere ein
    // direkter Zugriff die temporale Todeszone, zur Laufzeit ist er unproblematisch.
    const ziel = (typeof dirtyAirLevel === 'function') ? dirtyAirLevel() : 0;
    const ps = physEngine.state;
    ps.dirtyAir += (ziel - ps.dirtyAir) * Math.min(1, dt * 4);
    const out = physEngine.update({ steering: steer, throttle: rawThrottle, brake: rawBrake,
                                    headlights: headlightsOn }, dt);
    updateDashboard(out);
    // Gefahrene Strecke mitzaehlen, siehe 97-sessions.js. Hier und nicht dort, weil dies
    // der einzige Ort mit einem verlaesslichen dt ist - und ausdruecklich OHNE
    // Speicherzugriff: localStorage ist synchron und wuerde den 45-ms-Sendetakt stoeren.
    trackDistance(physEngine.state.speedKmh * REAL_SCALE, dt);
    physOutSteer = out.servoAngle;
    physOutThrottle = out.motorPWM;
  }

  // Hier stand die Lenkung ueber den Neigungssensor des Telefons. Sie ist entfernt: mit
  // einem Controller in der Hand wird sie nie benutzt, und ohne Controller ist ein Telefon,
  // das man kippt, kein Lenkrad - der Weg ueber den Schieber auf dem Schirm war in jedem
  // Versuch praeziser. SRC.TILT bleibt in der Quellenliste stehen, die Schiedsstelle in
  // 30-input.js kennt sie generisch und braucht keine Pflege.
  //
  // Nicht zu verwechseln mit gyroRaw in 70-race.js: das sind die rohen Bewegungsbytes des
  // AUTOS aus dem Meldekanal, und die speisen weiterhin den gruenen Punkt im G-Diagramm.

  // ---- Automated calibration test run ----
  // Sends a fixed, short test matrix directly (bypassing the physics engine) and
  // correlates the notify channel's bytes 1-3 (candidate yaw/lateral-accel telemetry,
  // see memory) against each known commanded steer/throttle window. Kept deliberately
  // brief/low-power on the forward-motion steps so the whole run fits a small area.
  const CALIB_MATRIX = [
    { label: 'Neutral (Baseline)', steer: 0, throttle: 0, ms: 1000 },
    { label: 'Lenkung 25% rechts (Stand)', steer: 0.25, throttle: 0, ms: 600 },
    { label: 'Lenkung 50% rechts (Stand)', steer: 0.5, throttle: 0, ms: 600 },
    { label: 'Lenkung 75% rechts (Stand)', steer: 0.75, throttle: 0, ms: 600 },
    { label: 'Lenkung 100% rechts (Stand)', steer: 1.0, throttle: 0, ms: 600 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Lenkung 25% links (Stand)', steer: -0.25, throttle: 0, ms: 600 },
    { label: 'Lenkung 50% links (Stand)', steer: -0.5, throttle: 0, ms: 600 },
    { label: 'Lenkung 75% links (Stand)', steer: -0.75, throttle: 0, ms: 600 },
    { label: 'Lenkung 100% links (Stand)', steer: -1.0, throttle: 0, ms: 600 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Mini-Schub vorwärts, geradeaus', steer: 0, throttle: 0.15, ms: 700 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Mini-Schub vorwärts + 50% rechts', steer: 0.5, throttle: 0.15, ms: 700 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Mini-Schub vorwärts + 50% links', steer: -0.5, throttle: 0.15, ms: 700 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Sanfte Bremse (30%)', steer: 0, throttle: -0.3, ms: 500 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 600 },
    { label: 'Gas-Vergleich: 15% (Ratter-Test)', steer: 0, throttle: 0.15, ms: 1000 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Gas-Vergleich: 30% (Ratter-Test)', steer: 0, throttle: 0.30, ms: 1000 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 500 },
    { label: 'Gas-Vergleich: 50% (Ratter-Test)', steer: 0, throttle: 0.50, ms: 1000 },
    { label: 'Neutral', steer: 0, throttle: 0, ms: 600 },
    { label: 'Drehung auf der Stelle (Vollausschlag rechts, wenig Gas)', steer: 1.0, throttle: 0.15, ms: 2000 },
    { label: 'Neutral (Ende)', steer: 0, throttle: 0, ms: 800 },
  ];

  let calibRunning = false;
  let calibNotifyLog = [];
  let calibStepLog = [];

  function calibNotifyListener(e) {
    calibNotifyLog.push({ t: Date.now(), bytes: notifyBytes(e.target.value) });
  }

  async function ensureCalibNotifySubscribed() {
    const entry = charByUuid.get(NUS_TX);
    if (!entry) throw new Error('NUS TX nicht gefunden (verbunden?)');
    if (!entry._calibSubscribed) {
      await entry.char.startNotifications();
      entry.char.addEventListener('characteristicvaluechanged', calibNotifyListener);
      entry._calibSubscribed = true;
    }
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function runCalibrationStep(step) {
    const tStart = Date.now();
    const endAt = tStart + step.ms;
    while (Date.now() < endAt && calibRunning) {
      await sendControlValue(step.steer, step.throttle);
      await sleep(45);
    }
    calibStepLog.push({ ...step, tStart, tEnd: Date.now() });
  }

  async function runCalibration() {
    const rxEntry = charByUuid.get(NUS_RX);
    if (!rxEntry) { alert('Nicht verbunden / NUS RX nicht gefunden.'); return; }
    try { await ensureCalibNotifySubscribed(); } catch (err) { alert(err.message); return; }

    calibRunning = true;
    calibNotifyLog = [];
    calibStepLog = [];
    $('calib-start').disabled = true;
    $('calib-stop').disabled = false;
    $('calib-results').innerHTML = '';

    for (const step of CALIB_MATRIX) {
      if (!calibRunning) break;
      $('calib-status').textContent = `Läuft: ${step.label}...`;
      await runCalibrationStep(step);
    }
    await sendControlValue(0, 0);

    $('calib-status').textContent = calibRunning ? 'Fertig.' : 'Abgebrochen.';
    calibRunning = false;
    $('calib-start').disabled = false;
    $('calib-stop').disabled = true;
    renderCalibResults();
  }

  function s8(b) { return b >= 128 ? b - 256 : b; }
  function meanOf(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }

  function renderCalibResults() {
    const rows = calibStepLog.map(step => {
      const samples = calibNotifyLog.filter(n => n.t >= step.tStart && n.t < step.tEnd);
      const b1 = samples.map(s => s8(s.bytes[1]));
      const b2 = samples.map(s => s.bytes[2]);
      const b3 = samples.map(s => s8(s.bytes[3]));
      return `<tr>
        <td>${step.label}</td><td>${step.steer}</td><td>${step.throttle}</td>
        <td>${samples.length}</td>
        <td>${meanOf(b1).toFixed(2)}</td><td>${meanOf(b2).toFixed(2)}</td><td>${meanOf(b3).toFixed(2)}</td>
      </tr>`;
    }).join('');
    $('calib-results').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:monospace">
        <thead><tr>
          <th style="text-align:left">Schritt</th><th>Lenkung</th><th>Gas</th><th>n</th>
          <th>Byte1 Ø</th><th>Byte2 Ø</th><th>Byte3 Ø</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  $('calib-start').onclick = runCalibration;
  $('calib-stop').onclick = () => { calibRunning = false; sendControlValue(0, 0); };

  // ---- Autonomous tab: record & playback ----
  const MACRO_STORE_KEY = 'carrera-hybrid-macros';
  let recording = false, playing = false;
  let macro = [];          // [{t, steer, throttle}]
  let recordStartTime = 0;
  let playTimers = [];

  function loadMacroStore() {
    try { return JSON.parse(localStorage.getItem(MACRO_STORE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveMacroStore(store) {
    localStorage.setItem(MACRO_STORE_KEY, JSON.stringify(store));
  }
  function refreshMacroList() {
    const store = loadMacroStore();
    const sel = $('macro-list');
    sel.innerHTML = '<option value="">-- gespeicherte Fahrten --</option>';
    Object.keys(store).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name} (${store[name].length} Schritte)`;
      sel.appendChild(opt);
    });
  }
  refreshMacroList();

  function playLog(msg) { $('play-log').textContent = msg; }

  $('btn-record').onclick = () => {
    if (playing) return;
    recording = !recording;
    $('btn-record').textContent = recording ? 'Aufnahme stoppen' : 'Aufnahme starten';
    $('btn-record').classList.toggle('primary', !recording);
    if (recording) {
      macro = [];
      recordStartTime = Date.now();
      $('record-status').textContent = 'nimmt auf…';
    } else {
      $('record-status').textContent = `bereit (${macro.length} Schritte aufgezeichnet)`;
    }
    $('btn-play').disabled = macro.length === 0 || recording;
  };

  $('btn-play').onclick = () => {
    if (recording || playing || macro.length === 0) return;
    playing = true;
    $('btn-play').disabled = true;
    $('btn-stop-play').disabled = false;
    runPlayback();
  };

  function runPlayback() {
    playTimers.forEach(clearTimeout);
    playTimers = [];
    const startedAt = Date.now();
    macro.forEach((step, i) => {
      const timer = setTimeout(() => {
        applySteerInput(SRC.MACRO, step.steer);
        applyThrottleInput(SRC.MACRO, step.throttle);
        playLog(`Schritt ${i + 1}/${macro.length}  t=${step.t}ms  steer=${step.steer.toFixed(2)}  throttle=${step.throttle.toFixed(2)}`);
        if (i === macro.length - 1) {
          if ($('chk-loop').checked && playing) {
            runPlayback();
          } else {
            stopPlayback();
          }
        }
      }, step.t);
      playTimers.push(timer);
    });
  }

  function stopPlayback() {
    playTimers.forEach(clearTimeout);
    playTimers = [];
    playing = false; // must be cleared BEFORE releasing, or playbackLocked blocks it
    $('btn-play').disabled = macro.length === 0;
    $('btn-stop-play').disabled = true;
    releaseInput(SRC.MACRO);
    playLog(playLog.lastMsg = 'Wiedergabe beendet.');
  }

  $('btn-stop-play').onclick = stopPlayback;

  $('btn-save-macro').onclick = () => {
    const name = $('macro-name').value.trim();
    if (!name) { alert('Bitte einen Namen für die Aufnahme eingeben.'); return; }
    if (macro.length === 0) { alert('Keine Aufnahme vorhanden.'); return; }
    const store = loadMacroStore();
    store[name] = macro;
    saveMacroStore(store);
    refreshMacroList();
    log(`Aufnahme "${name}" gespeichert (${macro.length} Schritte).`, 'info');
  };

  $('btn-load-macro').onclick = () => {
    const name = $('macro-list').value;
    if (!name) return;
    const store = loadMacroStore();
    if (!store[name]) return;
    macro = store[name];
    $('macro-name').value = name;
    $('record-status').textContent = `geladen: "${name}" (${macro.length} Schritte)`;
    $('btn-play').disabled = macro.length === 0 || recording;
  };

  $('btn-delete-macro').onclick = () => {
    const name = $('macro-list').value;
    if (!name) return;
    const store = loadMacroStore();
    delete store[name];
    saveMacroStore(store);
    refreshMacroList();
    log(`Aufnahme "${name}" gelöscht.`, 'info');
  };

  $('btn-export-macro').onclick = () => {
    if (macro.length === 0) { alert('Keine Aufnahme vorhanden.'); return; }
    const name = $('macro-name').value.trim() || 'aufnahme';
    const blob = new Blob([JSON.stringify(macro, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  $('btn-import-macro').onclick = () => $('macro-import').click();
  $('macro-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Ungültiges Format');
      macro = parsed;
      $('macro-name').value = file.name.replace(/\.json$/i, '');
      $('record-status').textContent = `importiert: ${macro.length} Schritte`;
      $('btn-play').disabled = macro.length === 0 || recording;
      log(`Aufnahme aus ${file.name} importiert (${macro.length} Schritte).`, 'info');
    } catch (err) {
      alert('Import fehlgeschlagen: ' + err.message);
    }
    e.target.value = '';
  };

  // ---- Protocol Lab: probe NUS RX/TX for the real command format ----
  const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  let labBytes = [128, 128];
  let labContinuousTimer = null;
  let labSweepTimer = null;

  function labRenderBytes() {
    const len = parseInt($('lab-len').value, 10);
    while (labBytes.length < len) labBytes.push(0);
    labBytes.length = len;
    const container = $('lab-bytes');
    container.innerHTML = '';
    labBytes.forEach((val, i) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
      wrap.innerHTML = `
        <label class="small" style="margin:0">Byte ${i}</label>
        <input type="range" min="0" max="255" value="${val}" style="width:100px" data-idx="${i}">
        <span class="muted" style="font-family:monospace;font-size:12px" data-idx-readout="${i}">${val} (0x${val.toString(16).padStart(2, '0')})</span>
      `;
      container.appendChild(wrap);
    });
    container.querySelectorAll('input[type=range]').forEach(input => {
      input.addEventListener('input', () => {
        labBytes[parseInt(input.dataset.idx, 10)] = parseInt(input.value, 10);
        labUpdatePreview();
      });
    });
    const sweepSel = $('lab-sweep-idx');
    sweepSel.innerHTML = '';
    labBytes.forEach((_, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = `Byte ${i}`;
      sweepSel.appendChild(opt);
    });
    labUpdatePreview();
  }

  function labUpdatePreview() {
    $('lab-preview').textContent = labBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const container = $('lab-bytes');
    labBytes.forEach((val, i) => {
      const input = container.querySelector(`input[data-idx="${i}"]`);
      const readout = container.querySelector(`[data-idx-readout="${i}"]`);
      if (input && document.activeElement !== input) input.value = val;
      if (readout) readout.textContent = `${val} (0x${val.toString(16).padStart(2, '0')})`;
    });
  }

  function labLog(msg) {
    const el = $('lab-tx-log');
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  async function labSend() {
    const entry = charByUuid.get(NUS_RX);
    if (!entry) { labLog('Keine NUS-RX-Characteristic gefunden (verbunden?).'); return; }
    const bytes = new Uint8Array(labBytes);
    try {
      if (entry.char.properties.writeWithoutResponse) await entry.char.writeValueWithoutResponse(bytes);
      else await entry.char.writeValueWithResponse(bytes);
      labLog(`SEND ${bufToHex(bytes)}`);
    } catch (err) {
      labLog('Fehler: ' + err.message);
    }
  }

  $('lab-len').addEventListener('change', labRenderBytes);
  $('lab-send').onclick = labSend;

  // Real sniffed idle/neutral command packet (20 bytes), confirmed authentic — safe to replay verbatim
  // since replaying identical bytes reproduces the same valid checksum without knowing the algorithm.
  // Byte offset 6 = throttle/brake (0xDF=idle, >0xDF=throttle, <0xDF=brake). Steering offset unknown.
  const KNOWN_IDLE_PACKET = [0xbf, 0x0f, 0x00, 0x08, 0x28, 0x00, 0xdf, 0x00, 0x86, 0x00, 0x00, 0x00, 0x00, 0xff, 0x02, 0x00, 0x00, 0x00, 0x00, 0xc1];
  $('lab-load-idle').onclick = () => {
    $('lab-len').value = '20';
    labBytes = KNOWN_IDLE_PACKET.slice();
    labRenderBytes();
    labLog('Bekanntes Idle-Paket geladen (20 Byte, Byte 6 = Gas/Bremse @ 0xDF=Leerlauf).');
  };

  $('lab-continuous').addEventListener('change', (e) => {
    if (e.target.checked) {
      const ms = Math.max(20, parseInt($('lab-interval').value, 10) || 100);
      labContinuousTimer = setInterval(labSend, ms);
    } else {
      clearInterval(labContinuousTimer);
      labContinuousTimer = null;
    }
  });

  $('lab-sweep-start').onclick = () => {
    const idx = parseInt($('lab-sweep-idx').value, 10);
    const speed = Math.max(5, parseInt($('lab-sweep-speed').value, 10) || 30);
    let val = 0;
    $('lab-sweep-start').disabled = true;
    $('lab-sweep-stop').disabled = false;
    labLog(`Sweep gestartet auf Byte ${idx}...`);
    labSweepTimer = setInterval(() => {
      labBytes[idx] = val;
      labUpdatePreview();
      labSend();
      val++;
      if (val > 255) {
        clearInterval(labSweepTimer);
        labSweepTimer = null;
        $('lab-sweep-start').disabled = false;
        $('lab-sweep-stop').disabled = true;
        labLog('Sweep beendet.');
      }
    }, speed);
  };
  $('lab-sweep-stop').onclick = () => {
    clearInterval(labSweepTimer);
    labSweepTimer = null;
    $('lab-sweep-start').disabled = false;
    $('lab-sweep-stop').disabled = true;
    labLog('Sweep gestoppt.');
  };

  async function labSubscribeTx() {
    const entry = charByUuid.get(NUS_TX);
    if (!entry) { labLog('Keine NUS-TX-Characteristic gefunden (verbunden?).'); return; }
    try {
      await entry.char.startNotifications();
      entry.char.addEventListener('characteristicvaluechanged', (e) => {
        labLog(`TX: ${bufToHex(e.target.value.buffer)}  |  ascii: ${bufToAscii(e.target.value.buffer)}`);
      });
      labLog('TX abonniert.');
      $('lab-subscribe').disabled = true;
      $('lab-subscribe').textContent = 'TX abonniert';
    } catch (err) {
      labLog('Notify-Fehler: ' + err.message);
    }
  }
  $('lab-subscribe').onclick = labSubscribeTx;

  labRenderBytes();

