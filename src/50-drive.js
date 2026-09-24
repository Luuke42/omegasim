  // =========================================================================
  // Fahren: Regler, Kalibrierung, Makros
  // =========================================================================
  // Die Instanz der Physik, die Regler aus dem Optionentab, der automatische
  // Kalibrierungslauf und die Aufnahme/Wiedergabe von Fahrten.


  const physEngine = new CarreraPhysicsEngine();
  let physLastTime = null;
  // ---- DIE ZWEITE INSTANZ, fuer Spieler 2 ----------------------------------------
  //
  // Dieselbe Klasse, ein zweites Mal gebaut - genau wie jeder Ghost eine eigene bekommt
  // (startGhost in 90-ghosts.js). Die Klasse ist also nicht nur mehrfach instanziierbar,
  // sie wird es seit Langem auch. Einspielerig war allein DIESER Griff hier.
  //
  // Die Einstellungen werden bei jedem Umschalten uebernommen (siehe zweiSpielerSetzen):
  // beide Autos sollen sich gleich anfuehlen, sonst ist das Rennen entschieden, bevor es
  // losgeht. Die rund sechzig Regler im Optionentab schreiben weiterhin nur auf
  // physEngine.config - sie zu verdoppeln waere ein zweiter Ort fuer jede Zahl.
  const physEngine2 = new CarreraPhysicsEngine();
  let offtrack2RumbleAt = 0;
  // Den Physiktakt von Auto 2 vergessen. Dasselbe Bedürfnis wie beim Tank: ein
  // Prueflauf mit eigener Zeitbasis darf nicht ein dt zwischen zwei Uhren rechnen.
  function phys2TaktVergessen() { phys2LastTime = null; }
  physEngine2.spieler = 2;   // siehe den Konstruktor: Meldung, Ruck und Ton gehen dorthin
  let phys2LastTime = null;
  // AN als Standard, weil die Original-App es praktisch immer an hat und ein beleuchtetes
  // Auto auf dem Tisch besser zu sehen ist.
  //
  // NICHT weil der Streckensensor es braucht. Das stand hier eine Fassung lang, gestuetzt auf
  // eine Auszaehlung (Licht an: 11703 Codes in 40075 Paketen; Licht aus: 0 in 422), und es
  // ist widerlegt: in der Original-App wird die Strecke gelesen, ob das Licht an ist oder
  // aus. Die Korrelation war echt, aber nicht ursaechlich - 422 Pakete sind rund 20 Sekunden
  // und lagen am Sitzungsanfang, bevor etwas ueberfahren wurde.
  let headlightsOn = true;
  // ---- AUTO 2 BEKOMMT EIN EIGENES LICHT -----------------------------------------
  //
  // BESTELLT: "splitscreen: Lichter an/aus sollen unabhaengig voneinander klappen."
  //
  // Bis hierher war headlightsOn EINE gemeinsame Variable, siehe headlichtZwei() in
  // 70-race.js: Auto 2 legte nur seine eigene Lichthupe darueber, das Dauerlicht war
  // Auto 1s Schalter. Jetzt hat Auto 2 seinen eigenen - kein UI-Element dafuer noetig,
  // die Gamepad-Taste in pollPad2() reicht (dieselbe Begruendung wie bei der Lichthupe:
  // eine Absicht EINES Fahrers, kein gemeinsamer Zustand).
  let headlightsOn2 = true;
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

  // ---- DAS ZEICHEN FUER "WECHSELHAFT" ----------------------------------------------
  //
  // NEBEN der Lage und nicht an ihrer Stelle: waehrend des Verlaufs ist es trocken ODER
  // nass, und wer nur "wechselhaft" sieht, weiss nicht, worauf er gerade faehrt. Sonne und
  // Regen bleiben also die Hauptaussage, das Zeichen ist der Zusatz.
  //
  // EINE EIGENE FUNKTION, weil es zwei Aufrufer hat: die Fahrschleife (fuer den Fall, dass
  // der Modus aus den Renneinstellungen kommt) und die Wetterkachel beim Klick. Ohne den
  // zweiten erschien das Zeichen erst im naechsten Fahrtakt - und wenn das Cockpit gar
  // nicht der aktive Schirm ist, nie.
  //
  // raceWxStart steht in einer SPAETEREN Datei. Zur Laufzeit ist es da; die typeof-Pruefung
  // deckt nur den Fall ab, dass jemand diese Funktion beim Aufbau ruft.
  function wxZeichenSetzen() {
    const el = $('race-wx-wechsel');
    if (!el) return;
    el.style.display = (typeof raceWxStart === 'string' && raceWxStart === 'wechsel')
      ? '' : 'none';
  }

  function motorAnzeige() {
    const sel = $('sound-profile'), txt = $('race-act-sound-txt');
    if (!sel || !txt) return;
    const opt = sel.options[sel.selectedIndex];
    if (opt) txt.textContent = motorNamen(opt);
  }

  if ($('race-act-sound')) {
    $('race-act-sound').addEventListener('click', (e) => {
      const sel = $('sound-profile');
      if (!sel) return;
      const brauchbar = Array.prototype.filter.call(sel.options, o => !o.disabled && !o.hidden);
      if (!brauchbar.length) return;
      // ---- LINKE HAELFTE ZURUECK, RECHTE VOR -------------------------------------
      //
      // BESTELLT: "Wenn ich auf die rechte Haelfte des Buttons klicke, geht es zum
      // naechsten und bei der linken Haelfte zum vorherigen Ton."
      //
      // Bei 26 Eintraegen ist eine Richtung zu wenig: wer einen Motor um eins verpasst,
      // muesste sonst 25 mal druecken.
      //
      // EIN KLICK OHNE ORT GILT ALS VORWAERTS. Tastaturbedienung (Enter, Leertaste) und
      // knopf.click() aus einem Prueflauf liefern clientX = 0 - das ist kein Klick auf die
      // linke Haelfte, sondern gar keine Ortsangabe. Ohne diese Unterscheidung waere der
      // Knopf per Tastatur rueckwaerts, und der vorhandene Selbsttest haette still die
      // Gegenrichtung gemessen.
      const kasten = e.currentTarget.getBoundingClientRect();
      const hatOrt = typeof e.clientX === 'number' && (e.clientX > 0 || e.clientY > 0);
      const richtung = (hatOrt && e.clientX < kasten.left + kasten.width / 2) ? -1 : 1;
      const jetzt = brauchbar.findIndex(o => o.value === sel.value);
      const n = brauchbar.length;
      // Modulo mit Vorzeichen: (-1 % n) ist in JavaScript -1 und nicht n-1.
      const naechste = brauchbar[(((jetzt + richtung) % n) + n) % n];
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
        + ' \u00b7 ' + t('Lenkd\u00e4mpfung') + ' ' + physEngine.config.steerDaempfungMs + ' ms';
    };
    const anwenden = (melden) => {
      const name = physEngine.applyLayout($('setting-layout').value);
      // Falls der gespeicherte Name unbekannt war, faellt applyLayout auf neutral zurueck -
      // dann muss die Auswahl mitkommen, sonst zeigt sie etwas anderes als das Modell.
      if ($('setting-layout').value !== name) $('setting-layout').value = name;
      // ---- DER REGLER IST DIE AUTORITAET, NICHT DAS LAYOUT ----------------------
      //
      // Hier stand `steerDaempfungSetzen(physEngine.config.steerDaempfungMs, true)`: das
      // Layout hatte die Daempfung gerade aus dem Traegheitsmoment gesetzt, und der Regler
      // kam mit. Das war richtig, solange die Vorgabe ohnehin der abgeleitete Wert war.
      //
      // Seit v0.5.54 steht die Vorgabe auf SOFORT (0 ms, vom Nutzer bestellt). Mit der alten
      // Zeile waere sie nach dem ersten Fahrzeugwechsel wieder weg - man waehlt ein Layout
      // und die Lenkung ist plötzlich wieder traege, ohne dass irgendwo steht, warum. Genau
      // die Sorte stiller Ruecknahme, die man dem Geraet zuschreibt und nicht der App.
      //
      // Also umgekehrt: der Regler wird auf das Modell geschrieben und nicht das Modell auf
      // den Regler. Die Ableitung aus dem Traegheitsmoment (steerDaempfungFor) bleibt im
      // Modell und bleibt richtig - sie ist jetzt ein Vorschlag und keine Vorschrift.
      // Anzeige und Modell stimmen weiter ueberein, und die Pruefung "Regler und Modell
      // sagen beim Laden dasselbe" behaelt ihren Gegenstand.
      if ($('phys-steerdamp')) {
        steerDaempfungSetzen(parseFloat($('phys-steerdamp').value), false);
      }
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
      // 'omega' ist die Vorgabe und setzt KEIN Attribut: so stehen die Werte aus :root, und
      // die Vorgabe ist damit nicht eine zweite Kopie derselben Zahlen. Sie hiess bis
      // v0.5.16 'gt3'; unter diesem Namen steht jetzt eine ANDERE Ansicht, siehe die
      // Ueberleitung darunter.
      if (v === 'omega') document.body.removeAttribute('data-cockpit');
      else document.body.setAttribute('data-cockpit', v);
      if (melden) {
        const opt = $('setting-cockpit').selectedOptions[0];
        log('Cockpit-Ansicht: ' + (opt ? opt.textContent : v) + '.', 'info');
      }
      try { localStorage.setItem(COCKPIT_STORE, v); } catch (e) { /* privater Modus */ }
    };
    // ---- Ueberleitung: aus dem alten 'gt3' wird 'omega' -----------------------------
    //
    // Der gespeicherte Wert 'gt3' meinte bis v0.5.16 die VORGABE. Ab jetzt ist 'gt3' eine
    // eigene Ansicht mit schwarzen Kacheln - wer die App vorher benutzt hat, bekaeme also
    // beim naechsten Start still ein anderes Cockpit.
    //
    // Der Merker ist noetig und nicht Zierde: OHNE ihn liesse sich nicht unterscheiden, ob
    // ein gespeichertes 'gt3' von frueher stammt oder eine frische Wahl der neuen Ansicht
    // ist - und die Ueberleitung wuerde die neue Ansicht bei jedem Start wieder wegnehmen.
    const COCKPIT_UMBENANNT = 'chc.cockpit.omega.v1';
    try {
      if (!localStorage.getItem(COCKPIT_UMBENANNT)) {
        if (localStorage.getItem(COCKPIT_STORE) === 'gt3') {
          localStorage.setItem(COCKPIT_STORE, 'omega');
          log('Cockpit-Ansicht: die bisherige Vorgabe heisst jetzt "Omega". Unter "GT3" '
              + 'steht seit v0.5.16 eine neue Ansicht mit schwarzen Kacheln.', 'info');
        }
        localStorage.setItem(COCKPIT_UMBENANNT, '1');
      }
    } catch (e) { /* privater Modus */ }
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

  // ---- Drei Stellungen, ein abgeleiteter Schalter ------------------------------------
  //
  // physicsEnabled BLEIBT und wird abgeleitet: neun Stellen im Projekt verzweigen darauf
  // (Sendeweg, Fahrschleife, Schalttasten, Motorton), und sie alle auf eine dritte
  // Moeglichkeit umzuschreiben waere neun Gelegenheiten, eine zu vergessen.
  //
  // Der Drift-Modus faehrt wie "Aus" - rohe Stickstellung, keine Gaenge -, deshalb ist
  // physicsEnabled dort false. Was ihn unterscheidet, sitzt im Sendeweg: das Gegensteuern.
  function physModusAnwenden(melden) {
    const v = $('phys-mode') ? $('phys-mode').value : 'physik';
    driftModus = (v === 'drift');
    physicsEnabled = (v === 'physik');
    physLastTime = null;
    if (melden) {
      log('Steuerungsmodus: ' + (v === 'physik' ? 'Physik'
                             : v === 'drift' ? 'Drift (experimentell)'
                             : 'Aus, rohe Stickstellung'), 'info');
    }
  }
  if ($('phys-mode')) {
    $('phys-mode').addEventListener('change', () => physModusAnwenden(true));
    physModusAnwenden(false);
  }

  // Der Knopf ruft DIESELBE Funktion, die auch der Selbsttest benutzt: zwei Wege zu
  // einer Messung waeren zwei Messungen.
  if ($('drift-probe')) {
    $('drift-probe').addEventListener('click', async () => {
      const out = $('drift-probe-out');
      if (!window.OMEGA_TEST || !OMEGA_TEST.driftProbe) {
        out.textContent = 'Messstand nicht vorhanden.';
        return;
      }
      out.textContent = 'Vollgas geradeaus, ohne zu lenken \u2026';
      const r = await OMEGA_TEST.driftProbe(4000);
      if (!r.mitTempo) {
        out.textContent = 'Das Auto ist nicht gefahren \u2013 ohne Fahrt gibt es kein '
                        + 'Drehsignal, Byte 3 schwankt erst dann.';
        return;
      }
      const teile = [
        r.mitTempo + ' von ' + r.punkte + ' Messpunkten mit Tempo',
        r.geradeaus + ' davon ohne Lenkeingabe',
        'Drehsignal geradeaus: ' + (r.gyroGeradeaus === null ? '\u2013' : r.gyroGeradeaus),
        'insgesamt: ' + (r.gyroInsgesamt === null ? '\u2013' : r.gyroInsgesamt),
        'Massstab: ' + (r.spanEnde === null ? '\u2013' : Math.round(r.spanEnde)),
      ];
      // KEIN URTEIL. Ob 0,3 viel ist, entscheidet das Auto auf dem Teppich; diese Zeile
      // sagt nur, was gemessen wurde.
      out.textContent = teile.join(' \u00b7 ');
      log('Drift-Probe: ' + teile.join(' | '), 'info');
    });
  }

  if ($('setting-countersteer')) {
    const gegen = (v) => {
      gegenlenkStaerke = v;
      $('setting-countersteer-val').textContent = Math.round(v * 100) + '%';
    };
    $('setting-countersteer').addEventListener('input', (e) => gegen(parseFloat(e.target.value)));
    gegen(parseFloat($('setting-countersteer').value));
  }

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

  // DER PRUEFKNOPF. Er ist die Antwort auf "Vibration geht nicht", und er antwortet mit
  // einer Messung statt mit einer Vermutung: er loest einen Stoss aus und schreibt daneben,
  // was dabei vorgefunden wurde.
  //
  // Warum das noetig ist: zwischen "der Nutzer spuert nichts" und "der Code hat nichts
  // getan" liegen vier Moeglichkeiten, und sie sehen von aussen alle gleich aus - kein
  // Controller, ein Controller ohne Ruettler, der falsche von zwei gemeldeten Zwillingen,
  // oder ein abgeschalteter Hauptschalter. Ohne diese Zeile raet man zwischen ihnen.
  if ($('vib-test')) {
    $('vib-test').addEventListener('click', () => {
      const out = $('vib-test-out');
      const lage = vibrationLage();
      // AUSDRUECKLICH AN padRumble VORBEI, mit einer Art, die es nicht gibt: der Test soll
      // den WEG pruefen und nicht die Schalter. Wer den Hauptschalter aus hat, soll das als
      // Satz lesen und nicht als Schweigen.
      const stoss = rumbleOn ? ruettle({ duration: 260, startDelay: 0,
                                         strongMagnitude: 0.6, weakMagnitude: 0.4 }) : 0;
      const teile = [];
      if (!lage.pads.length) {
        teile.push('Kein Controller gemeldet. Eine Taste dr\u00fccken \u2013 der Browser '
                   + 'zeigt einen Controller erst, wenn er einmal benutzt wurde.');
      } else {
        for (const p of lage.pads) {
          teile.push(p.name + ' \u00b7 ' + p.mapping + ' \u00b7 '
                     + (p.ruettler ? 'R\u00fcttler: ' + (p.arten.length ? p.arten.join(', ')
                                                                        : 'ohne Angabe')
                                   : 'kein R\u00fcttler'));
        }
      }
      if (!lage.hauptschalter) teile.push('Hauptschalter steht AUS \u2013 nichts gesendet.');
      else teile.push('Stoss an ' + stoss + ' von ' + lage.pads.length + ' gesendet.');
      out.textContent = teile.join(' | ');
      log('R\u00fcttelprobe: ' + teile.join(' | '), 'info');
    });
  }

  // Ein Kaestchen je Ausloeser. Dieselbe Bauform wie oben: AUS DEM MARKUP lesen und danach
  // auf 'change' hoeren - der fehlende Anfangsabgleich hat hier schon einmal einen toten
  // Schalter ergeben, und mit sechs Kaestchen waeren es sechs.
  const VIB_KAESTCHEN = { 'vib-schalt': 'schalt', 'vib-abs': 'abs', 'vib-crash': 'crash',
                          'vib-abseits': 'abseits', 'vib-box': 'box',
                          'vib-meldung': 'meldung' };
  Object.keys(VIB_KAESTCHEN).forEach((id) => {
    const el = $(id);
    if (!el) return;
    const art = VIB_KAESTCHEN[id];
    RUMBLE_ARTEN[art] = el.checked;
    el.addEventListener('change', (e) => { RUMBLE_ARTEN[art] = e.target.checked; });
  });

  // Die Trigger-Vibration, dieselbe Bauform: AUS DEM MARKUP lesen, dann auf 'change'.
  if ($('vib-trigger')) {
    triggerRumbleOn = $('vib-trigger').checked;
    $('vib-trigger').addEventListener('change', (e) => { triggerRumbleOn = e.target.checked; });
  }

  // ---- Was kann der angeschlossene Controller wirklich? -------------------------------
  //
  // AUSGELESEN UND NICHT ANGENOMMEN. `vibrationActuator.effects` ist die Liste der
  // Effektarten, die dieser Pad annimmt. Ohne diese Zeile ist "die Trigger tun nichts"
  // nicht von "die Option ist kaputt" zu unterscheiden - und der haeufigste Fall ist, dass
  // der Pad die Art schlicht nicht kennt.
  //
  // Sie zieht bei jedem An- und Abstecken nach, denn vorher gibt es nichts auszulesen: der
  // Browser meldet einen Controller erst, wenn er einmal benutzt wurde.
  function triggerLageZeigen() {
    const el = $('vib-trigger-lage');
    if (!el) return;
    const lage = vibrationLage();
    if (!lage.pads.length) { el.textContent = 'noch kein Controller gemeldet'; return; }
    el.textContent = lage.pads.map((p) => {
      if (!p.ruettler) return p.name + ': kein R\u00fcttler';
      const kann = p.arten.indexOf('trigger-rumble') >= 0;
      return p.name + ': ' + (kann ? 'Trigger m\u00f6glich'
                                   : 'keine Trigger (' + (p.arten.join(', ') || 'ohne Angabe') + ')');
    }).join(' | ');
  }
  triggerLageZeigen();
  window.addEventListener('gamepadconnected', triggerLageZeigen);
  window.addEventListener('gamepaddisconnected', triggerLageZeigen);

  // ---- DIE INPUT/OUTPUT-KURVE, fuer Gas- UND Lenkkennlinie -------------------------
  //
  // BESTELLT: "Bei beiden die input/output uebersetzungskurve anzeigen." Eine Funktion
  // fuer beide Regler statt zwei fast identischer Zeichenroutinen: beide sind dieselbe
  // Kurvenfamilie (x^gamma, mit oder ohne Vorzeichen), nur mit anderem Wertebereich -
  // 0..1 fuers Gas, -1..1 fuer die Lenkung.
  //
  // GESAMPELT UND NICHT ANALYTISCH GEZEICHNET: eine SVG-Kurve durch 24 Stuetzpunkte
  // sieht bei diesen glatten Potenzfunktionen von einer geraden Linie nicht zu
  // unterscheiden aus, und ein Pfad aus Geradenstuecken bleibt bei jedem Exponenten
  // gleich einfach zu bauen - keine Bezier-Naeherung noetig.
  function kennlinienPlotZeichnen(pathId, fn, xMin, xMax) {
    const el = $(pathId);
    if (!el) return;
    const N = 24;
    const spanne = xMax - xMin;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = xMin + spanne * i / N;
      const y = fn(x);
      // x waagerecht 0..100, y senkrecht 60..0 (oben = groesster Wert) - derselbe
      // Wertebereich [xMin, xMax] fuer beide Achsen, weil Eingang und Ausgang bei
      // beiden Kennlinien denselben Bereich teilen.
      const px = (x - xMin) / spanne * 100;
      const py = 60 - (y - xMin) / spanne * 60;
      pts.push(px.toFixed(1) + ',' + py.toFixed(1));
    }
    el.setAttribute('d', 'M' + pts.join(' L'));
  }

  // GASKENNLINIE und ANFAHRSCHUB. Beide lesen ihren Anfangswert AUS DEM MARKUP und
  // haengen sich danach an 'input' - dasselbe Muster wie bei setting-vibration, wo der
  // fehlende Anfangsabgleich schon einmal einen toten Schalter ergeben hat.
  function gasKennlinieAnwenden() {
    const el = $('setting-throttle-gamma');
    if (!el) return;
    const g = parseFloat(el.value);
    physEngine.config.throttleGamma = g;
    const nah = Math.abs(g - 1) < 0.001;
    // Ein Beispiel statt einer nackten Zahl: was gibt ein Viertel Gasweg? Das ist die
    // Groesse, um die es beim Halten eines Tempos geht.
    const viertel = Math.round(100 * Math.pow(0.25, g));
    $('setting-throttle-gamma-val').textContent =
      g.toFixed(2) + (nah ? ' linear' : ' \u00b7 \u00bc Weg = ' + viertel + '%');
    kennlinienPlotZeichnen('setting-throttle-gamma-plot', (x) => gasKennlinie(x, g), 0, 1);
  }
  // LENKKENNLINIE. BESTELLT: "wie beschleunigungskurve auch lenkkurve einbauen als
  // option mit slider." Dieselbe Kurvenfamilie wie oben, bipolar - siehe expoSteer in
  // 40-physics.js, das genau diese Rechnung (Vorzeichen mal Betrag hoch Exponent) im
  // Fahrtakt schon ausfuehrt.
  function lenkKennlinieAnwenden() {
    const el = $('setting-steer-expo');
    if (!el) return;
    const e = parseFloat(el.value);
    physEngine.config.steerExpo = e;
    const nah = Math.abs(e - 1) < 0.001;
    const viertel = Math.round(100 * Math.pow(0.25, e));
    $('setting-steer-expo-val').textContent =
      e.toFixed(2) + (nah ? ' linear' : ' \u00b7 \u00bc Weg = ' + viertel + '%');
    kennlinienPlotZeichnen('setting-steer-expo-plot', (x) => lenkKennlinie(x, e), -1, 1);
  }
  function anfahrschubAnwenden() {
    const el = $('setting-minmove');
    if (!el) return;
    const v = parseFloat(el.value);
    physEngine.config.minMoveThrottle = v;
    // Im Massstab, nicht als Anteil: 0,16 sagt niemandem etwas, 47 km/h schon.
    const kmh = Math.round(v * physEngine.config.topSpeedKmh * REAL_SCALE);
    $('setting-minmove-val').textContent = Math.round(v * 100) + '% \u00b7 ' + kmh + ' km/h';
  }
  if ($('setting-throttle-gamma')) {
    gasKennlinieAnwenden();
    $('setting-throttle-gamma').addEventListener('input', gasKennlinieAnwenden);
  }
  if ($('setting-steer-expo')) {
    lenkKennlinieAnwenden();
    $('setting-steer-expo').addEventListener('input', lenkKennlinieAnwenden);
  }
  if ($('setting-minmove')) {
    anfahrschubAnwenden();
    $('setting-minmove').addEventListener('input', anfahrschubAnwenden);
  }

  // ---- Die Reifenfarbe: blau kalt, gruen im Fenster, rot zu heiss --------------------
  //
  // EINE FUNKTION FUER ZWEI ANZEIGEN. Sie stand bis v0.5.18 als lokaler Ausdruck in
  // updateRaceScreen(); seit der Boxenschirm dieselben vier Reifen ein zweites Mal zeichnet,
  // waere das eine Kopie - und eine Farbskala, die an zwei Orten steht, laeuft beim naechsten
  // Feinschliff auseinander.
  //
  // Als function-DEKLARATION und nicht als const: 70-race.js ist eine spaetere Datei im
  // zusammengefuegten Modul, und nur Deklarationen werden ueber Dateigrenzen hochgezogen.
  function reifenFarbe(T) {
    const cfgT = physEngine.config;
    if (cfgT.tyreEffect === 0) return '#4a5568';
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
  }

  // ---- Die Cockpit-Schirme -----------------------------------------------------------
  //
  // Drei Schirme, geblaettert mit dem Steuerkreuz links/rechts. Die WAHRHEIT ist die
  // Variable; das Attribut auf #race-dash gibt es nur, damit CSS auswaehlen kann - dieselbe
  // Bauform wie pitState und updatePitTiles().
  //
  // Ein vierter Schirm ist ein Eintrag in dieser Liste, eine CSS-Regel und ein Block im
  // Markup. Sonst nichts, und genau dafuer ist es eine Liste und keine Kette von if.
  //
  // Die Handlungen stehen als Pfeilfunktionen und nicht als blosse Verweise: die Ziele
  // liegen in 70-race.js, also einer SPAETEREN Datei. Bei function-Deklarationen greift die
  // Hochziehung zwar ohnehin, aber ein Verweis im Array wuerde beim Aufbau ausgewertet, und
  // diese Datei hat schon fuenf Ladeabbrueche an genau dieser Falle gekostet.
  const COCKPIT_SCREENS = [
    { id: 'main', name: 'Cockpit' },
    { id: 'pit', name: 'Box',
      pad: (d) => pitScreenPad(d),
      waehlen: () => pitScreenSelect(),
      malen: () => pitScreenRender() },
    { id: 'uebersicht', name: 'Rennen',
      malen: () => ovScreenRender() },
    // BESTELLT: "cockpit: weiteren screen mit Renneinstellungen einfuegen." waehlen()
    // ist generisch verdrahtet (cockpitScreenWaehlen()), pad() ist es NICHT - siehe die
    // Begruendung bei raceScreenPad() in 70-race.js und den Aufruf in pollGamepad()
    // (90-ghosts.js), der ihn genau wie pitScreenPad() von Hand mit einbindet.
    { id: 'renneinstellungen', name: 'Renneinstellungen',
      waehlen: () => raceScreenSelect(),
      malen: () => raceScreenRender() },
    // ---- NUR IM ZWEI-SPIELER-MODUS BLAETTERBAR ---------------------------------------
    //
    // Der Eintrag steht IMMER in der Liste und wird beim Blaettern uebersprungen, solange
    // der Modus aus ist. Die Alternative waere eine Liste, deren LAENGE sich aendert - und
    // an ihr haengen der Schirmzaehler, die Punkte unter dem Pfeil und zwei Selbsttests.
    // Eine Liste, die beim Umschalten kuerzer wird, verschiebt den gerade gezeigten Schirm.
    // Der Name ist "Beide" und nicht mehr "Auto 2": der Schirm zeigt seit v0.6.56 beide
    // Autos nebeneinander. Die id bleibt `auto2` - sie steht in gespeicherten Zustaenden
    // und in Prueflaeufen, und ein Name im Menue ist kein Grund, eine Kennung zu aendern.
    { id: 'auto2', name: 'Beide',
      nurZweiSpieler: true,
      malen: () => p2ScreenRender() },
  ];
  let cockpitScreen = 0;

  function cockpitScreenIst() { return COCKPIT_SCREENS[cockpitScreen]; }

  function cockpitScreenSet(i) {
    const n = COCKPIT_SCREENS.length;
    const next = ((i % n) + n) % n;
    if (next === cockpitScreen) return;
    cockpitScreen = next;
    const s = COCKPIT_SCREENS[next];
    const el = $('race-dash');
    if (el) el.dataset.screen = s.id;

    // EINEN LAUFENDEN FLAGGEN-LADEBALKEN ABBRECHEN, und das ist kein Feinschliff.
    // flagHoldPaint() laeuft an SEINER EIGENEN Uhr und loest bei voller Ladung aus,
    // unabhaengig davon, was pollGamepad gerade sieht. Wer X haelt und dabei blaettert,
    // bekaeme sonst eine Sekunde spaeter eine gelbe Flagge, waehrend er in ein Menue sieht.
    // Diese Stelle ist die einzige, die beide Richtungen abfaengt.
    if (typeof flagHoldRelease === 'function') flagHoldRelease(false);

    cockpitPunkteMalen();
    if (s.malen) s.malen();
    if (typeof showHudToast === 'function') showHudToast(t(s.name));

    // AUSDRUECKLICH KEIN cockpitPassung(): die Schirme sind Ueberlagerungen und aendern
    // grid-template-rows nicht. Ein Nachmessen waere Arbeit ohne Wirkung - und im Vollbild
    // sechs Layoutlaeufe auf einen Tastendruck waehrend der Fahrt.
  }

  // Ist dieser Schirm gerade blaetterbar? Nur der Schirm von Auto 2 kennt eine Sperre,
  // und ohne sie waere im Einzelspiel ein vierter Schirm zu durchblaettern, auf dem alle
  // Zahlen stehen bleiben - schlimmer als ein Schirm, den es nicht gibt.
  function cockpitScreenGilt(s) {
    if (!s) return false;
    if (s.nurZweiSpieler) return typeof zweiSpieler !== 'undefined' && !!zweiSpieler;
    return true;
  }

  // SCHRITTWEISE UND MIT ABBRUCH. Die Schleife laeuft hoechstens so oft, wie es Schirme
  // gibt: sonst dreht sie sich ewig, wenn einmal jeder Schirm gesperrt waere.
  function cockpitScreenStep(d) {
    const n = COCKPIT_SCREENS.length;
    const richtung = d >= 0 ? 1 : -1;
    let i = cockpitScreen;
    for (let k = 0; k < n; k++) {
      i = ((i + richtung) % n + n) % n;
      if (cockpitScreenGilt(COCKPIT_SCREENS[i])) { cockpitScreenSet(i); return; }
    }
  }

  // Was die Waehltaste auf DIESEM Schirm tut. Rueckgabe true heisst "verbraucht".
  //
  // DER SCHIRM ENTSCHEIDET, und zwar hier und an einer Stelle. Bis v0.5.28 stand die
  // Entscheidung im Gamepad-Zweig und hing an einem Merker, der nur auf der naechsten
  // steigenden Flanke fiel - die der Boxenschirm aber selbst verbraucht. Ein Schirm ohne
  // waehlen-Eintrag verbraucht die Taste nicht: auf der Rennuebersicht gibt es nichts zu
  // waehlen, und dort etwas zu erfinden waere schlimmer als nichts zu tun.
  function cockpitScreenWaehlen() {
    const s = cockpitScreenIst();
    return !!(s && s.waehlen && s.waehlen());
  }

  // Die Punkte AUS DER LISTE erzeugen, nicht aus dem Markup: ein vierter Schirm soll an
  // genau einer Stelle nachgetragen werden.
  function cockpitPunkteMalen() {
    const host = $('race-screen-dots');
    if (!host) return;
    if (host.children.length !== COCKPIT_SCREENS.length) {
      host.innerHTML = COCKPIT_SCREENS.map(() => '<i></i>').join('');
    }
    for (let i = 0; i < host.children.length; i++) {
      host.children[i].classList.toggle('an', i === cockpitScreen);
    }
  }

  // NUR VORWAERTS mit dem Finger. cockpitScreenStep() rechnet modulo, der letzte Schirm
  // fuehrt also zum ersten zurueck - eine zweite Richtung waere ein zweiter Knopf fuer eine
  // Bewegung, die man mit zwei Tipps ohnehin hat. Auf dem Steuerkreuz bleiben beide.
  //
  // ---- ENTPRELLT, seit v0.6.58 ------------------------------------------------------
  //
  // GEMELDET: "der vierte Screen ist manchmal nicht ansteuerbar" - und nachgestellt:
  // zwei schnelle Klicks auf DIESEN Knopf, von "Rennen" aus, ueberspringen "Beide" und
  // landen auf "Cockpit". cockpitScreenStep() selbst ist zustandslos richtig (jeder
  // einzelne Schritt geht genau einen Schirm weiter) - das Problem ist die FOLGE zweier
  // Schritte in kurzer Zeit, sei es durch einen ungeduldigen Doppel-Tipp (das Umschalten
  // gibt sofort ein Toast und einen neuen Punkt, aber auf einem ausgelasteten Bild kann
  // das einen Wimpernschlag brauchen) oder durch eine doppelt ausgeloeste Click-Meldung
  // des Browsers auf Touch-Geraeten.
  //
  // Eine Sperre von 220 ms nach jedem ERFOLGREICHEN Schritt filtert beides, ohne
  // absichtliches schnelles Weiterblaettern spuerbar zu bremsen - vier Schirme in einer
  // Sekunde bleiben moeglich. Das Steuerkreuz braucht das nicht: es hat seine eigene
  // Flankenerkennung (prevDpad), die pro Poll-Takt (45 ms) hoechstens einmal ausloest.
  let schirmKlickSperreBis = 0;
  if ($('race-screen-next')) {
    $('race-screen-next').addEventListener('click', () => {
      const jetzt = Date.now();
      if (jetzt < schirmKlickSperreBis) return;
      schirmKlickSperreBis = jetzt + 220;
      cockpitScreenStep(+1);
    });
  }
  cockpitPunkteMalen();

  // Zu einem bestimmten Schirm springen, wenn er existiert. Gerufen beim Rennstart.
  function cockpitScreenZu(id) {
    const i = COCKPIT_SCREENS.findIndex((s) => s.id === id);
    if (i >= 0) cockpitScreenSet(i);
  }

  // ---- Das Cockpit auf die Bildschirmhoehe einpassen ---------------------------------
  //
  // GEMELDET: "auf einem Handy sehe ich oben die Lichter nicht." Gemessen in 844 x 390,
  // also einem Handy quer: Kopfzeile 62 px, Cockpit 531 px hoch ab y = 86 - Fensterhoehe
  // 390, und die Seite scrollt dort nicht. 227 px liegen ausserhalb.
  //
  // Verkleinert wird das GANZE Instrumentenbrett und nicht seine Zeilenaufteilung: die
  // Anordnung ist der Sinn der Sache, und wer sie auf kleinen Schirmen umbaut, hat zwei
  // Cockpits zu pflegen.
  //
  // zoom und nicht transform: scale() - zoom aendert die Lage im Layout mit, es entsteht
  // also kein Loch darunter, und Treffer- wie Scrollrechnung stimmen von selbst. Der
  // uebliche Einwand ist die Browserunterstuetzung; hier belanglos, weil Web Bluetooth die
  // App ohnehin auf Chrome festlegt.
  // UNTERGRENZE 0,45, und sie ist gemessen und nicht geschaetzt. zoom verkleinert den
  // gezeichneten Kasten, aber der Inhalt braucht dabei relativ MEHR Zeilen - clamp()-
  // Mindestwerte und vw-Anteile schrumpfen nicht mit. Gemessen an einem Cockpit von
  // 495 px in einem Fenster von 390 px:
  //
  //      zoom   1     0,8   0,65  0,55  0,45  0,35
  //      hoch  495   418   362   323   286   247
  //
  // Fuer die verfuegbaren 298 px braucht es rund 0,47 - mit der frueheren Grenze von 0,55
  // blieb ein Ueberstand von 19 px stehen, und genau der ist der gemeldete Fehler.
  // Tiefer als 0,45 geht es nicht: darunter ist der Tacho nicht mehr zu entziffern, und
  // dann ist Scrollen ehrlicher als eine Anzeige, die man nicht lesen kann.
  const COCKPIT_MIN_ZOOM = 0.45;
  const COCKPIT_LUFT = 6;          // px, damit die untere Blende nicht am Rand klebt

  // `hoeheFuerTest` gibt eine Fensterhoehe vor. Ohne sie gilt die echte; mit ihr laesst
  // sich "passt es auf einem Handy quer" auf JEDEM Schirm pruefen - und ein Test, der nur
  // auf einem kleinen Fenster etwas aussagt, wird nie gefahren.
  // ---- Das Vollbild ist ein eigener Fall, und bis v0.5.16 gab es fuer ihn gar nichts --
  //
  // #race-dash ist im Vollbild position: fixed, und `offsetParent` ist dort NULL - die
  // Zeile unten stieg also sofort aus. Im Vollbild hat nie eine Einpassung stattgefunden.
  //
  // GEMESSEN auf 412 x 915 mit race-fs race-turn: Kasten ungedreht 915 x 412, davon 380
  // nutzbar, Inhalt 652. align-content: center legt den Ueberstand HALB nach oben, also
  // 136 px - und dort sitzen die Drehzahllampen. .gt3 schneidet mit overflow: hidden ab.
  // Genau das ist die Meldung "die Lampen oben sind abgeschnitten".
  //
  // UNTERGRENZE 0,5, aus demselben Grund wie COCKPIT_MIN_ZOOM: darunter ist der Tacho
  // nicht mehr zu entziffern, und dann ist ein abgeschnittener Rand ehrlicher.
  const RACE_FS_MIN_SCALE = 0.5;

  // WIE HOCH IST DER INHALT WIRKLICH? Zwei Antworten waren falsch, bevor die dritte
  // stimmte - beide Male lag der Fehler in der Messung und nicht in der Einpassung.
  //
  // NICHT scrollHeight: .race-rain ist position: absolute, 1134 px hoch und liegt bei
  // top: -162. Der Regenschleier liegt UEBER dem Cockpit und ist kein Inhalt, scrollHeight
  // zaehlt ihn aber mit und meldete 972 statt 528. Damit lief der Faktor bis an die
  // Untergrenze, obwohl laengst alles passte.
  //
  // UND AUCH NICHT die Ausdehnung der sichtbaren Kinder: .gt3 hat ACHT Rasterzeilen, von
  // denen im gedrehten Vollbild fuenf 0 hoch sind (Flagge, Banner, Toast, Fussleiste,
  // Marke). Ihre sieben Zwischenraeume zu je 4 px bleiben trotzdem stehen, und
  // align-content zentriert die ZEILEN samt Zwischenraeumen. Eine Messung vom ersten bis
  // zum letzten sichtbaren Kind laesst rund 20 px davon weg - der Test meldete daraufhin
  // "passt" und gleichzeitig "Lampen 3 px ueber der Kante", und beides war richtig.
  //
  // Gemessen wird deshalb, was das RASTER belegt.
  function cockpitInhaltHoehe(el) {
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const zeilen = (cs.gridTemplateRows || '').split(' ')
      .map((z) => parseFloat(z)).filter((z) => !isNaN(z));
    if (zeilen.length) {
      const luecke = parseFloat(cs.rowGap) || 0;
      return zeilen.reduce((a, b) => a + b, 0) + (zeilen.length - 1) * luecke + pad;
    }
    // RUECKFALL, falls das Cockpit einmal kein Raster ist: die Ausdehnung dessen, was im
    // Fluss liegt. Ueberlagerungen zaehlen auch hier nicht.
    let oben = Infinity, unten = -Infinity;
    for (const k of el.children) {
      if (!(k.offsetHeight > 0)) continue;
      const pos = getComputedStyle(k).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      oben = Math.min(oben, k.offsetTop);
      unten = Math.max(unten, k.offsetTop + k.offsetHeight);
    }
    if (!(unten > oben)) return 0;
    // offsetTop misst ab dem RANDKASTEN, die Polsterung gehoert also noch dazu.
    return (unten - oben) + pad;
  }

  function cockpitVollbildMasse(el, schirmB, schirmH, s) {
    // Der Kasten GROSS, die Darstellung klein. Unter zoom waere das sinnlos, weil die
    // vw-Anteile mitwachsen; unter scale() bleiben sie, wo sie sind, und der Inhalt
    // bekommt wirklich mehr Platz.
    el.style.width = Math.round(schirmB / s) + 'px';
    el.style.height = Math.round(schirmH / s) + 'px';
    el.style.setProperty('--race-scale', s.toFixed(4));
  }

  // BEIDE MASSE sind vorgebbar, und die Breite ist es aus einem Grund: die acht Kacheln
  // des Streifens haben ein Seitenverhaeltnis, ihre Hoehe waechst also mit der Kastenbreite
  // (gemessen 528 px Inhalt bei 1830 Breite, 841 bei 2560). Ein Test, der nur die Hoehe
  // vorgibt, prueft auf einem breiten Fenster eine Lage, in die ein Handy nie geraet.
  function cockpitVollbildPassung(el, hoeheFuerTest, breiteFuerTest) {
    const gedreht = document.body.classList.contains('race-turn');
    // UNGEDREHT GEDACHT: im gedrehten Vollbild liegt die Breite des Cockpits auf der Hoehe
    // des Schirms und umgekehrt.
    const schirmB = breiteFuerTest || (gedreht ? window.innerHeight : window.innerWidth);
    const schirmH = hoeheFuerTest || (gedreht ? window.innerWidth : window.innerHeight);
    if (!(schirmB > 0) || !(schirmH > 0)) return null;
    // EINE Einpassung, nicht zwei: der Weg in der Seite arbeitet mit zoom, dieser mit
    // Groesse und Skalierung. Beide zugleich waeren zwei Faktoren auf einer Zahl.
    el.style.zoom = '';

    let s = 1, braucht = 0, da = 0;
    for (let i = 0; i < 6; i++) {
      cockpitVollbildMasse(el, schirmB, schirmH, s);
      da = el.clientHeight;
      braucht = cockpitInhaltHoehe(el);
      if (!(da > 0) || !(braucht > 0)) break;
      // DIE SCHLEIFE LAEUFT WEITER, auch wenn es schon passt. Mit dem Faktor waechst der
      // Kasten, mit dem Kasten waechst der Streifen - seine Kacheln haben ein Seiten-
      // verhaeltnis. Wer beim ersten Treffer abbricht, laesst das Cockpit auf 76 % stehen,
      // wo 92 % gepasst haetten; das ist eine Fixpunktiteration und keine Suche nach dem
      // erstbesten Wert.
      const naechst = Math.min(1, Math.max(RACE_FS_MIN_SCALE, s * (da / braucht)));
      const fertig = Math.abs(naechst - s) < 0.002;
      s = naechst;
      if (fertig) break;
    }
    // Der letzte Schritt kann knapp ueber das Ziel gegangen sein. Dann lieber eine Spur
    // kleiner als ein abgeschnittener Rand - abgeschnitten war der gemeldete Fehler.
    cockpitVollbildMasse(el, schirmB, schirmH, s);
    da = el.clientHeight;
    braucht = cockpitInhaltHoehe(el);
    // OHNE TOLERANZ: ein einziger Pixel Ueberstand wird von align-content: center
    // halbiert und landet OBEN, wo die Lampen sitzen. Gemessen kam die Reihe mit einer
    // Toleranz von 1 px auf offsetTop -2.
    if (braucht > da && da > 0 && braucht > 0) {
      s = Math.max(RACE_FS_MIN_SCALE, s * (da / braucht));
      cockpitVollbildMasse(el, schirmB, schirmH, s);
      da = el.clientHeight;
      braucht = cockpitInhaltHoehe(el);
    }
    return { vollbild: true, gedreht, schirmB, schirmH, faktor: +s.toFixed(3),
             braucht: Math.round(braucht), da,
             amBoden: s <= RACE_FS_MIN_SCALE + 1e-6,
             passt: braucht <= da + 1,
             ueberstand: Math.max(0, Math.round(braucht - da)) };
  }

  // Die Vollbildmasse wieder abraeumen. Bleiben sie stehen, sitzt in der Seite ein Cockpit
  // von 915 px Breite in einer Spalte von 412.
  function cockpitFreigeben(el) {
    el.style.width = '';
    el.style.height = '';
    el.style.removeProperty('--race-scale');
  }

  // `breiteFuerTest` gilt nur im Vollbild: in der Seite steht die Breite des Cockpits in
  // der Spalte fest, und eine vorgegebene waere eine Zahl ohne Wirkung.
  function cockpitPassung(hoeheFuerTest, breiteFuerTest) {
    const el = $('race-dash');
    if (!el) return null;
    if (document.body.classList.contains('race-fs')) {
      return cockpitVollbildPassung(el, hoeheFuerTest, breiteFuerTest);
    }
    cockpitFreigeben(el);
    if (!el.offsetParent) return null;
    const fensterH = hoeheFuerTest || window.innerHeight;
    // ERST ZURUECKSETZEN, DANN MESSEN. Mit gesetztem zoom liefert getBoundingClientRect
    // bereits verkleinerte Werte, und die Rechnung liefe sich selbst nach - bei jedem
    // Aufruf ein Stueck kleiner.
    el.style.zoom = '';
    const oben = el.getBoundingClientRect().top;
    const noetig = el.offsetHeight;
    const platz = fensterH - oben - COCKPIT_LUFT;
    if (!(noetig > 0) || !(platz > 0)) return null;

    // NACHMESSEN STATT AUSRECHNEN, und das ist eine Berichtigung an meinem ersten Versuch:
    // der setzte platz/noetig als Faktor und war fertig. Gemessen kam damit ein Cockpit
    // heraus, das immer noch 44 px ueberstand - das Raster schrumpft nicht rein
    // proportional, weil einzelne Zeilen Mindesthoehen und in vh gerechnete Anteile haben.
    //
    // Also: Faktor setzen, WIRKLICHE Unterkante messen, nachbessern. Vier Durchgaenge
    // genuegen (jeder halbiert den Fehler); der Deckel ist dabei kein Schoenheitsfehler,
    // sondern die Zusicherung, dass diese Schleife endet.
    let f = Math.min(1, platz / noetig);
    for (let i = 0; i < 4; i++) {
      f = Math.min(1, Math.max(COCKPIT_MIN_ZOOM, f));
      el.style.zoom = f < 0.999 ? f.toFixed(4) : '';
      const unten = el.getBoundingClientRect().bottom;
      const rest = fensterH - COCKPIT_LUFT - unten;
      if (rest >= -1) break;                       // passt
      if (f <= COCKPIT_MIN_ZOOM + 1e-6) break;     // kleiner wird es nicht, siehe Konstante
      const hoehe = unten - oben;
      if (!(hoehe > 0)) break;
      f *= (hoehe + rest) / hoehe;
    }
    const unten = el.getBoundingClientRect().bottom;
    return { noetig, platz: Math.round(platz), faktor: +f.toFixed(3),
             fensterH, amBoden: f <= COCKPIT_MIN_ZOOM + 1e-6,
             passt: unten <= fensterH + 1,
             ueberstand: Math.max(0, Math.round(unten - fensterH)) };
  }

  // Bei jeder Groessenaenderung, bei jedem Drehen des Geraets, und beim Wechsel auf den
  // Reiter - vorher ist das Cockpit unsichtbar und hat die Hoehe 0.
  // OHNE DIE HUELLE reicht der Zuhoerer das EREIGNIS als erstes Argument durch, und das
  // ist `hoeheFuerTest`. `fensterH` war dann ein Event, `platz` NaN, und die Funktion stieg
  // ueber `!(platz > 0)` still aus - die Einpassung bei Groessenaenderung hat nie
  // stattgefunden.
  window.addEventListener('resize', () => cockpitPassung());
  // syncRaceRotation() und nicht nur cockpitPassung(): eine Drehung des Geraets kann die
  // Hochkant/Quer-Frage selbst aendern (race-turn), nicht nur die Einpassung darin. Vorher
  // stand hier nur cockpitPassung() - die Einpassung zog nach, aber die race-turn-Klasse
  // blieb auf dem Stand vor der Drehung stehen.
  window.addEventListener('orientationchange', () => setTimeout(syncRaceRotation, 120));
  document.querySelectorAll('[data-tab="race"]').forEach((b) => {
    b.addEventListener('click', () => setTimeout(cockpitPassung, 60));
  });
  // Und einmal beim Laden, falls der Reiter schon offen ist.
  setTimeout(cockpitPassung, 300);

  // Der Regler steht in PROZENT vorn, die Physik rechnet mit einem Anteil.
  $('setting-brakebias').addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    physEngine.config.brakeBias = pct / 100;
    $('setting-brakebias-val').textContent = pct + '% vorn';
  });

  // BESTELLT (GT7-Fahrmodus): "mehr Traegheit/Gewichtsverlagerung." transferK/loadTau
  // steuern st.loadFront schon im Fahrtakt (siehe 40-physics.js), hatten aber keinen
  // Regler - beide braucht der neue GT7-Preset.
  if ($('phys-transfer-k')) {
    $('phys-transfer-k').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      physEngine.config.transferK = v;
      $('phys-transfer-k-val').textContent = Math.round(v * 100) + '%';
    });
  }
  if ($('phys-load-tau')) {
    $('phys-load-tau').addEventListener('input', (e) => {
      const ms = parseInt(e.target.value, 10);
      physEngine.config.loadTau = ms / 1000;
      $('phys-load-tau-val').textContent = ms + ' ms';
    });
  }

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

  // NUR DER ZUHOERER. Der Anfangsabgleich steht bei der Deklaration von fuelDrainPerSec in
  // 70-race.js - von hier aus waere er eine Zuweisung an ein let einer SPAETEREN Datei, also
  // temporale Todeszone, und die nimmt den ganzen Aufbau mit. Genau das ist mir beim Bauen
  // passiert, und zwei Zeilen darueber stand die Warnung schon.
  $('setting-fuel-drain').addEventListener('input', (e) => {
    fuelDrainPerSec = parseFloat(e.target.value);
    $('setting-fuel-drain-val').textContent = fuelDrainPerSec.toFixed(1);
    // BESTELLT: "Wenn ich Schaden, Reifen, etc. ausstelle, soll der Zustand auf das Ideal
    // zurueckgesetzt werden." Sonst blieb ein leergefahrener Tank leer, obwohl die
    // Simulation aus ist, bis zum naechsten Boxenstopp - ein abgeschaltetes Modell soll
    // keine Spuren hinterlassen.
    if (fuelDrainPerSec === 0) fuel = 100;
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
    // BESTELLT: "Wenn ich Schaden, Reifen, etc. ausstelle, soll der Zustand auf das Ideal
    // zurueckgesetzt werden." Sonst blieb ein kaputtes Auto kaputt, obwohl das Schadensmodell
    // aus ist, bis zum naechsten Boxenstopp.
    if (!e.target.checked) damage = 0;
    log('Schadensmodell ' + (e.target.checked ? 'an' : 'aus') + '.', 'info');
  });

  $('setting-repair-time').addEventListener('input', (e) => {
    pitFullRepairS = parseInt(e.target.value, 10);
    $('setting-repair-time-val').textContent = pitFullRepairS + ' s';
  });

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
  // Den Regler und das Modell an EINER Stelle zusammenbringen. steerDaempfungSetzen wird
  // von drei Seiten gebraucht - vom Regler, vom Fahrzeugwechsel und vom Aufbau -, und drei
  // Kopien derselben zwei Zeilen sind der Weg zu einem Regler, der irgendwann etwas anderes
  // anzeigt als das Modell rechnet.
  function steerDaempfungAnzeige(ms) {
    return ms <= 0 ? t('sofort') : ms + ' ms';
  }
  function steerDaempfungSetzen(ms, auchRegler) {
    const v = Math.max(0, Math.min(500, Math.round(ms)));
    physEngine.config.steerDaempfungMs = v;
    if (auchRegler && $('phys-steerdamp')) $('phys-steerdamp').value = String(v);
    if ($('phys-steerdamp-val')) $('phys-steerdamp-val').textContent = steerDaempfungAnzeige(v);
    return v;
  }
  if ($('phys-steerdamp')) {
    $('phys-steerdamp').addEventListener('input', (e) => {
      steerDaempfungSetzen(parseFloat(e.target.value), false);
    });
    // Beim Aufbau aus dem MARKUP lesen und nicht aus dem Modell: so ist der Regler die
    // Wahrheit, und die Pruefung "Regler und Modell sagen beim Laden dasselbe" hat einen
    // Gegenstand. Stimmen die zwei nicht, faellt sie - genau dafuer ist sie da.
    steerDaempfungSetzen(parseFloat($('phys-steerdamp').value), false);
  }

  ['phys-steerresp', 'phys-accel', 'setting-steer-calib', 'setting-brake-steal',
   'setting-throttle-steer-relief'].forEach(id => {
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
      if (id === 'setting-throttle-steer-relief') {
        physEngine.config.throttleSteerRelief = v;
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
    // Die Einpassung haengt an DIESER Entscheidung: gedreht liegt die Cockpithoehe auf der
    // Schirmbreite. Sie hier zu rufen und nicht nur am resize-Zuhoerer stellt sicher, dass
    // sie die neue Klasse schon sieht.
    cockpitPassung();
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
    // Das Vollbild braucht einen Takt, bis der Browser die neue Fenstergroesse meldet.
    // syncRaceRotation() und nicht nur cockpitPassung(): raceIsPortrait() liest
    // window.innerWidth/innerHeight, und die koennen direkt nach requestFullscreen()/
    // orientation.lock() noch die ALTEN Masse zeigen - der erste Aufruf oben setzt
    // race-turn dann falsch, und cockpitPassung() allein haette daran nichts mehr
    // geaendert, weil sie die Klasse nur LIEST statt neu zu entscheiden. GEMELDET: "Full
    // screen im cockpit klappt manchmal nicht, vll wegen gleichzeitigem Drehen."
    setTimeout(() => syncRaceRotation(), 120);
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
    // GEFUNDEN: cockpitScreen blieb sonst auf 'pit'/'renneinstellungen' stehen, auch nach
    // dem Verlassen des Vollbilds. pitScreenOffen()/raceScreenOffen() (70-race.js) pruefen
    // NUR cockpitScreenIst().id, nicht ob tab-race ueberhaupt noch aktiv/im Vollbild ist -
    // ein Wechsel auf einen anderen Tab liess das D-Pad dort also weiter "essen", bevor
    // menuNavMove() es je sah. cockpitScreenZu('main') hier behebt das an der Quelle.
    cockpitScreenZu('main');
    cockpitPassung();
    setTimeout(() => cockpitPassung(), 120);
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


  // ---- DER SCHIRM VON AUTO 2 ---------------------------------------------------------
  //
  // Alles, was der zweiten Zeile im Hauptschirm nicht passt: Tank, Schaden, Reifen- und
  // Bremsentemperatur, Rundenzeiten. So bestellt - "Drehzahl und Geschwindigkeit fuer
  // beide Autos; alle weiteren Einstellungen auf weiteren Screens."
  //
  // GEZEICHNET WIRD NUR, WENN ER VORNE LIEGT (cockpitScreenSet ruft malen(), und der Takt
  // unten prueft es): neun Werte je 45 ms auf einen unsichtbaren Schirm zu schreiben waere
  // Arbeit fuer niemanden, und der Sendetakt hat Vorrang.
  // ---- DER VERGLEICHSSCHIRM: BEIDE AUTOS NEBENEINANDER ------------------------------
  //
  // BESTELLT: "Statt nur Player 2 soll er das Nötigste von Player 1 und 2 haben:
  // Geschwindigkeit, Drehzahllichter, schaden, reifen, tank, bremse, akku, motorsound."
  //
  // EINE Funktion fuer beide Spalten, mit einem Praefix als Argument. Zwei Kopien waeren
  // zwei Orte, an denen die naechste Groesse nur in einer Spalte landet - und in einem
  // Vergleich ist genau das der Fehler, den man am spaetesten bemerkt, weil die Spalte
  // ja etwas anzeigt.
  //
  // GEZEICHNET WIRD NUR, WENN ER VORNE LIEGT: der Takt in 70-race.js ruft malen() des
  // vorderen Schirms, alle 120 ms. Vierzehn Werte je 45 ms auf einen unsichtbaren Schirm
  // zu schreiben waere Arbeit fuer niemanden, und der Sendetakt hat Vorrang.
  function vglSpalte(pre, car, motor, tank, schaden) {
    const st = motor.state;
    // Die Schaltlichter aus SEINER Drehzahl. Dieselbe Funktion wie die grosse Leiste im
    // Cockpit - siehe schaltLampen(), dort steht auch die Farbregel.
    schaltLampen($(pre + '-shift'), st.rpmFrac, st.onLimiter);
    schreibeWert($(pre + '-speed'), Math.round(Math.abs(st.speedKmh) * REAL_SCALE));
    schreibeWert($(pre + '-gear'), gearLabel(st));
    schreibeWert($(pre + '-name'), car ? garageLabel(car) : 'kein Auto');
    // Tank in Litern, wie ueberall sonst in dieser App.
    schreibeWert($(pre + '-fuel'), fuelLiters(tank) + ' l');
    const tb = $(pre + '-fuel-bar');
    if (tb) {
      tb.style.width = Math.max(0, Math.min(100, tank)) + '%';
      tb.style.background = tank < 20 ? '#ffb02e' : '#2ee06a';
    }
    // ZUSTAND und nicht Schaden: voll gruen am Anfang, und jeder Crash nimmt ein Stueck
    // heraus. Ein Balken, der WAECHST, wenn etwas schlechter wird, liest sich rueckwaerts -
    // dieselbe Entscheidung wie beim Schadensbalken von Auto 1.
    const zustand = Math.max(0, 100 - schaden);
    schreibeWert($(pre + '-cond'), Math.round(zustand) + ' %');
    const zb = $(pre + '-cond-bar');
    if (zb) {
      zb.style.width = zustand + '%';
      zb.style.background = zustand < 50 ? '#ff5252' : zustand < 80 ? '#ffb02e' : '#2ee06a';
    }
    // VIER RAEDER, EIN WERT. Das Modell fuehrt tyreTemp4[] und brakeTemp4[] (Rueckfall
    // tyreTempC bzw. brakeTempF/R). Hier steht das Mittel: eine Zahl je Groesse hat Platz,
    // und die Frage "sind die Reifen warm" ist damit beantwortet.
    //
    // `brakeTempC` GIBT ES NICHT - der Name stand hier einen Anlauf lang und ergab 0 Grad,
    // waehrend der Reifen 20 zeigte.
    const mittel = (a) => (a && a.length) ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const reifen = mittel(st.tyreTemp4) !== null ? mittel(st.tyreTemp4) : (st.tyreTempC || 0);
    const bremse = mittel(st.brakeTemp4) !== null ? mittel(st.brakeTemp4)
      : ((st.brakeTempF || 0) + (st.brakeTempR || 0)) / 2;
    schreibeWert($(pre + '-tyre'), Math.round(reifen) + '\u00b0');
    // BESTELLT: "Balken fuer die Reifensimulation, um zu sehen, ob die Reifen verschlissen
    // sind." Restprofil und nicht Temperatur, dieselbe Groesse wie in den vier
    // Reifenfeldern des Hauptcockpits (1 - tyreWear), 100 % heisst neu.
    const tyb = $(pre + '-tyre-bar');
    if (tyb) {
      const rest = Math.max(0, Math.min(1, 1 - (typeof st.tyreWear === 'number' ? st.tyreWear : 0))) * 100;
      tyb.style.width = rest + '%';
      tyb.style.background = rest < 30 ? '#ff5252' : rest < 60 ? '#ffb02e' : '#2ee06a';
    }
    schreibeWert($(pre + '-brake'), Math.round(bremse) + '\u00b0');
    // Der Akku kommt aus Byte 10 des Autos (car.battery, in 90-ghosts.js je Auto gesetzt) -
    // eine gemessene Groesse und keine gerechnete. Ohne Auto oder ohne Meldung: ein Strich,
    // und keine erfundene Zahl.
    const roh = car && car.battery !== undefined && car.battery !== null ? car.battery : null;
    schreibeWert($(pre + '-batt'), roh === null ? '\u2013' : batteryPercent(roh) + ' %');
  }

  function p2ScreenRender() {
    vglSpalte('vgl1', typeof playerCar !== 'undefined' ? playerCar : null,
              physEngine, typeof fuel === 'number' ? fuel : 0,
              typeof damage === 'number' ? damage : 0);
    vglSpalte('vgl2', typeof playerCar2 !== 'undefined' ? playerCar2 : null,
              physEngine2,
              typeof tankZweiStand === 'function' ? tankZweiStand() : 0,
              typeof schadenVon === 'function' ? schadenVon(2) : 0);

    // ---- DIE RUNDENZAHL, jetzt je Auto neben seinem eigenen Namen -------------------
    // BESTELLT: vorher stand eine gemeinsame Kopfzeile ("Runden 3 : 5") ueber beiden
    // Spalten; die ist mitsamt Titel und Lage-Meldung weg, die Zahl steht jetzt einzeln
    // auf Hoehe von "Spieler 1"/"Spieler 2".
    const car2 = typeof playerCar2 !== 'undefined' ? playerCar2 : null;
    const lage = typeof boxZweiLage === 'function' ? boxZweiLage() : 'aus';
    const r1z = $('vgl1-runde');
    if (r1z) {
      const r1 = ((typeof playerCar !== 'undefined' && playerCar && playerCar.race
                   && playerCar.race.laps) || []).length;
      r1z.textContent = 'Runde ' + r1;
    }
    const r2z = $('vgl2-runde');
    if (r2z) {
      const r2 = ((car2 && car2.race && car2.race.laps) || []).length;
      r2z.textContent = 'Runde ' + r2;
    }

    // ---- DIE FUSSZEILE SAGT, WAS DER BOXENSTOPP GERADE BRAUCHT -----------------------
    //
    // GEMELDET: "Tanken soll unabhängig bei beiden klappen." Gemessen tut es das - beide
    // Autos tanken gleichzeitig und unabhaengig. Was fehlte, war die RUECKMELDUNG: der
    // Service beginnt erst im Stillstand, und das Auto rollt mit ueber 200 km/h aus. Der
    // Coast-Drag allein bringt es in acht Sekunden nur auf 174 - wer den Knopf drueckt und
    // wartet, sieht nichts passieren und haelt es fuer kaputt.
    //
    // Also steht hier jetzt, WIE WEIT es noch ist: Tempo gegen Schwelle. Und der zweite
    // Teil der Bedingung steht mit dabei, weil er nicht zu erraten ist - waehrend man auf
    // der Bremse steht, beginnt der Service nicht (Math.abs(p2Throttle) < 0.1, dieselbe
    // Regel wie bei Auto 1).
    const fuss = $('p2s-fuss');
    if (fuss) {
      if (!zweiSpieler) {
        fuss.textContent = 'Der 2-Spieler-Modus ist aus \u2013 rechts steht nichts.';
      } else if (!car2) {
        fuss.textContent = 'In der Garage einem Auto die Rolle "Spieler 2" geben.';
      } else if (lage === 'angefordert') {
        const kmh = Math.abs(physEngine2.state.speedKmh) * REAL_SCALE;
        const schwelle = PIT_STANDSTILL_KMH * REAL_SCALE;
        fuss.textContent = 'P2 Boxenstopp: bremsen und anhalten \u2013 '
          + Math.round(kmh) + ' km/h, nötig unter ' + Math.round(schwelle)
          + ', dann Finger vom Gas.';
      } else if (lage === 'service') {
        const offen = [];
        if (tankZweiStand() < 100 - 0.05) offen.push('tankt');
        if (schadenVon(2) > 0.05) offen.push('repariert');
        fuss.textContent = boxZweiFertig()
          ? 'P2 Boxenstopp: fertig, losfahren!'
          : 'P2 Boxenstopp: ' + (offen.join(', ') || 'Standzeit laeuft');
      } else {
        fuss.textContent = 'Boxenstopp: links f\u00fcr Auto 1, rechts f\u00fcr Auto 2.';
      }
    }
    const knopf2 = $('p2s-act-pit');
    if (knopf2) {
      knopf2.classList.toggle('warn', lage !== 'aus');
      knopf2.disabled = !zweiSpieler || !car2;
    }
    const knopf1 = $('vgl1-act-pit');
    if (knopf1) {
      knopf1.classList.toggle('warn',
        typeof pitState !== 'undefined' && pitState !== 'off');
    }
    // BESTELLT: "Spieler 1 und Spieler 2 sollen verschiedene Motorsounds haben duerfen."
    // Zwei Knoepfe statt einem - je einer zeigt SEIN EIGENES Auswahlfeld an.
    const ton1 = $('vgl1-act-sound-txt');
    if (ton1) {
      const sel1 = $('sound-profile');
      const opt1 = sel1 ? sel1.options[sel1.selectedIndex] : null;
      ton1.textContent = opt1 ? motorNamen(opt1) : 'Motor';
    }
    const ton = $('vgl-act-sound-txt');
    if (ton) {
      const sel2 = $('sound-profile-2');
      const opt = sel2 ? sel2.options[sel2.selectedIndex] : null;
      ton.textContent = opt ? motorNamen(opt) : 'Motor';
    }
  }

  if ($('p2s-act-pit')) {
    $('p2s-act-pit').addEventListener('click', () => {
      // Defensiv gerufen: 70-race.js wird SPAETER gebaut. Zur Laufzeit ist die Funktion da.
      if (typeof boxZweiAnfordern === 'function') boxZweiAnfordern();
      p2ScreenRender();
    });
  }
  // Die zwei Knoepfe fuer Auto 1 leiten auf die vorhandenen weiter, statt ihre Wirkung zu
  // verdoppeln: ein zweiter Weg in den Boxenstopp waere ein zweiter Ort, an dem die
  // Vorwahl entsteht - und die Vorwahl gibt es genau einmal, auf dem Boxenschirm.
  if ($('vgl1-act-pit')) {
    $('vgl1-act-pit').addEventListener('click', () => {
      const q = $('race-act-pit');
      if (q) q.click();
      p2ScreenRender();
    });
  }
  // BESTELLT: eigener Motor-Knopf fuer Auto 1 auf dem Vergleichsschirm, neben dem fuer
  // Auto 2 - genau wie die zwei Boxenstopp-Knoepfe. Leitet weiter wie beim Boxenstopp-
  // Knopf: derselbe Klick-Ort (links/rechts) geht an #race-act-sound, damit es EINEN Weg
  // durch Auto 1s Motorliste gibt statt die Zaehllogik zweimal zu pflegen.
  if ($('vgl1-act-sound')) {
    $('vgl1-act-sound').addEventListener('click', (e) => {
      const q = $('race-act-sound');
      if (!q) return;
      const r = e.currentTarget.getBoundingClientRect();
      const links = (e.clientX - r.left) < r.width / 2;
      const ev = new MouseEvent('click', { bubbles: true, clientX:
        links ? q.getBoundingClientRect().left + 4
              : q.getBoundingClientRect().right - 4 });
      q.dispatchEvent(ev);
      p2ScreenRender();
    });
  }
  // BESTELLT: "Spieler 1 und Spieler 2 sollen verschiedene Motorsounds haben duerfen."
  // Auto 1 hat seine Auswahl schon (#sound-profile, Kachel "Ton"/"Motorwerkstatt") -
  // Auto 2 braucht eine EIGENE, ohne die Motorliste ein zweites Mal von Hand im Markup zu
  // pflegen (drei Orte fuer eine Liste sind schon zwei zu viel, siehe 95-selftest.js).
  // Ein Klon von #sound-profile ist deshalb die ganze Datenhaltung: unsichtbar im DOM,
  // aber mit denselben <option>-Eintraegen und derselben Vorgabe wie Auto 1s Regler, bis
  // der Nutzer hier zum ersten Mal etwas anderes waehlt.
  if ($('sound-profile') && $('sound-profile-2') && !$('sound-profile-2').options.length) {
    $('sound-profile-2').innerHTML = $('sound-profile').innerHTML;
    $('sound-profile-2').value = $('sound-profile').value;
  }
  if ($('vgl-act-sound')) {
    $('vgl-act-sound').addEventListener('click', (e) => {
      // Dieselbe Bedienung wie beim Hauptschirm-Knopf (#race-act-sound): linke Haelfte
      // zurueck, rechte vor - aber auf der EIGENEN Liste fuer Auto 2, nicht auf Auto 1s.
      const sel = $('sound-profile-2');
      if (!sel) return;
      const brauchbar = Array.prototype.filter.call(sel.options, o => !o.disabled && !o.hidden);
      if (!brauchbar.length) return;
      const kasten = e.currentTarget.getBoundingClientRect();
      const hatOrt = typeof e.clientX === 'number' && (e.clientX > 0 || e.clientY > 0);
      const richtung = (hatOrt && e.clientX < kasten.left + kasten.width / 2) ? -1 : 1;
      const jetzt = brauchbar.findIndex(o => o.value === sel.value);
      const n = brauchbar.length;
      const naechste = brauchbar[(((jetzt + richtung) % n) + n) % n];
      sel.value = naechste.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      p2ScreenRender();
      showHudToast('AUTO 2: ' + motorNamen(naechste).toUpperCase());
    });
  }
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

  // ---- DIE SCHALTLICHTER, EINE WAHRHEIT FUER JEDE LEISTE ------------------------------
  //
  // Herausgeloest, weil es seit v0.6.56 ZWEI Leisten gibt: die grosse im Cockpit und je
  // eine je Auto auf dem Vergleichsschirm. Zwei Kopien dieser Farbregel waeren zwei Orte,
  // an denen jemand die blauen Lampen verschiebt.
  //
  // Gruen, dann rot, dann BLAU fuer die letzten zwei. Das blaue Paar UEBER dem roten und
  // nicht darunter ist das, was echte GT3-Lenkraeder benutzen, und es macht den Streifen
  // lesbar, ohne Lampen zu zaehlen.
  function schaltLampen(host, frac, amBegrenzer) {
    if (!host) return;
    const lamps = host.children;
    const n = lamps.length;
    const f = Math.max(0, Math.min(1, frac || 0));
    for (let i = 0; i < n; i++) {
      const lit = f >= (i + 1) / n;
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
    if (amBegrenzer && Math.floor(Date.now() / 90) % 2 === 0) {
      for (let i = 0; i < n; i++) {
        lamps[i].style.background = '#3d8bff';
        lamps[i].style.boxShadow = '0 0 8px #3d8bff';
      }
    }
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
    // DIESELBE ZAHL, DIE DER TON BEKOMMT. Die Begruendung steht bei motorDrehzahl() in
    // 80-sound.js: die Physik rechnet fuer alle Motoren von 1500 bis 9000, das Vorbild
    // dreht aber bis 5000 (Blazer) oder 12500 (Formel 1). Zwei Zahlen fuer dieselbe Sache
    // waeren eine Anzeige, die dem Ton widerspricht.
    $('race-rpm').textContent = Math.round(motorDrehzahl(st));
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
    schaltLampen($('race-shift'), frac, st.onLimiter);

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
    // BESTELLT: "balken für tank und schaden breiter und vertikal (oben = voll)."
    // .gt3-bar-v verankert die Fuellung unten (align-items:flex-end), height statt
    // width laesst sie also nach OBEN wachsen.
    $('race-fuel-bar').style.height = Math.max(0, fuel) + '%';
    $('race-fuel-bar').style.background = fuel < 20 ? '#ffb02e' : '#2ee06a';
    // Condition, not damage: full green at the start, and every crash takes a piece out.
    // A bar that GROWS as things get worse reads backwards at a glance. Every other bar on
    // this dash empties when something runs out, and this one now behaves the same way.
    // Internally `damage` still counts upward from 0; only the presentation is inverted, so
    // no crash, repair or pit-stop arithmetic had to be touched.
    const health = Math.max(0, Math.min(100, 100 - damage));
    $('race-dmg').textContent = Math.round(health) + '%';
    $('race-dmg-bar').style.height = health + '%';
    $('race-dmg-bar').style.background = health <= 20 ? '#ff5252'
                                       : (health <= 55 ? '#ffb02e' : '#2ee06a');
    // BESTELLT: "f\u00fcr batterie ebenfalls balken machen" - vorher stand hier nur die
    // Prozentzahl. null heisst "noch kein Dashboard-Byte gelesen" (siehe dashBattery in
    // 60-track.js), der Balken bleibt dann leer statt eine falsche Zahl zu zeigen.
    const battPct = dashBattery === null ? null : batteryPercent(dashBattery);
    $('race-batt').textContent = battPct === null ? '\u2013' : battPct + '%';
    $('race-batt-bar').style.height = (battPct === null ? 0 : battPct) + '%';
    $('race-batt-bar').style.background = battPct !== null && battPct < 20 ? '#ffb02e' : '#2ee06a';

    const live = !!(device && device.gatt && device.gatt.connected);
    // race-conn und race-track sassen in der entfernten Kachel "Strecke". Der
    // Weather icon plus the fitted tyres. The tyres matter more than the weather here:
    // they are what tells you whether the pit stop is still outstanding.
    const wet = weather === 'rain';
    $('race-wx-sun').style.display = wet ? 'none' : '';
    $('race-wx-rain').style.display = wet ? '' : 'none';
    $('race-wx-rain').style.color = wet ? '#5aa9ff' : '';
    // Das Zeichen fuer "wechselhaft". Siehe wxZeichenSetzen() - es steht als eigene
    // Funktion, weil die Wetterkachel es beim Klick SOFORT braucht und nicht erst im
    // naechsten Fahrtakt.
    wxZeichenSetzen();
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

      // Die Reifenfarbe steht seit v0.5.18 als eigene Funktion weiter unten: der Boxenschirm
      // zeichnet dieselben vier Reifen ein zweites Mal, und zwei Kopien derselben Rechnung
      // waeren zwei Orte, an denen die Skala auseinanderlaeuft.

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
    // ALLE Treffer und nicht der erste: seit v0.5.18 tragen die Zeilen des Boxenschirms
    // dieselben data-pit-Werte, und ein einzahliges querySelector haette dort nie sim-off
    // gesetzt - die Kachel im Streifen waere grau gewesen, die Zeile daneben nicht.
    for (const el of document.querySelectorAll('[data-pit="refuel"]')) {
      el.classList.toggle('sim-off', tankAus);
    }
    for (const el of document.querySelectorAll('[data-pit="repair"]')) {
      el.classList.toggle('sim-off', schadenAus);
    }
    const reifenKachel = $('race-tyre-box');
    if (reifenKachel) reifenKachel.classList.toggle('sim-off',
      physEngine.config.tyreEffect <= 0);

    // ---- DIE ZWEI GROESSEN AUF DEM STEUERKREUZ: REIFENWAHL UND TANKMENGE --------
    //
    // Die Kachel zeigt, was das Kreuz verstellt, und nichts anderes - derselbe Satz wie
    // vorher, nur sind es jetzt andere zwei Groessen. Bremsbalance und Lenkansprechen
    // standen hier bis v0.6.13; beide sind an ihren Reglern in den Optionen geblieben.
    //
    // EINE Abfrage ueber die Dateigrenze: pitKachelStand() steht in 70-race.js und liefert
    // alles Gebrauchte auf einmal. Fuenf einzelne Zugriffe waeren fuenf Stellen, an denen
    // jemand eine vergisst - und die Funktion ist zur Laufzeit da, auch wenn sie in einer
    // spaeteren Datei steht (Funktionsdeklarationen werden hochgezogen).
    if (typeof pitKachelStand === 'function') {
      const ps = pitKachelStand();
      const tn = $('race-pit-tyre');
      if (tn) tn.textContent = ps.mixName;
      const ring = $('race-pit-tyre-ring');
      if (ring) ring.setAttribute('stroke', ps.mixFarbe);
      const rillen = $('race-pit-tyre-rillen');
      if (rillen) rillen.style.display = ps.mixRegen ? '' : 'none';
      const trow = $('race-pit-tyre-row');
      if (trow) trow.classList.toggle('wx-warn', ps.mixWarnung);
      const fn = $('race-pit-fuel');
      if (fn) fn.textContent = ps.tankWort;
      const frow = $('race-pit-fuel-row');
      // "nein" ist kein Fehler, sondern eine Wahl - deshalb keine Warnfarbe, nur gedimmt.
      if (frow) frow.classList.toggle('aus', !ps.tankAn);
    }

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
  // page isn't being composited (hidden/minimised/background tab).
  //
  // WAS DIESER ABSATZ FRUEHER BEHAUPTETE, war zu viel: "Timer-driven, physics keeps
  // decelerating normally instead." Gemessen stimmt das nur mit Ton. Ein verborgenes
  // Fenster drosselt ALLE Zeitgeber auf 1 Hz - der Herzschlag lieferte dort 1,1 statt
  // 22,2 Pakete je Sekunde, und zwar samt wxTick, pitBoard und dem Tastaturtakt.
  //
  // ES SEI DENN, DIE SEITE TOENT. Mit laufendem Ton fielen in derselben verborgenen Lage
  // 133 Pakete in 6 Sekunden, also volle 22,2 Hz: eine hoerbare Seite ist von der
  // Drosselung ausgenommen. Der Motorton ist standardmaessig an, im Fahrbetrieb ist der
  // Takt also da - aber wer den Ton ausschaltet und das Fenster in den Hintergrund legt,
  // faehrt mit einem Steuertakt von einer Sekunde.
  //
  // Das ist trotzdem sicher, und zwar nicht durch Zufall: rAF steht in dieser Lage ganz,
  // die Gamepad-Abtastung damit auch, und die Wache im Herzschlag gibt nach PAD_STALE_MS
  // das Gas des Controllers frei. Die Tastatur wird beim blur-Ereignis geleert. Es bleibt
  // also kein Gas stehen - das Auto rollt aus, nur langsamer geregelt.
  //
  // Gegen rAF bleibt der Zeitgeber die bessere Wahl: rAF steht IMMER still, wenn die Seite
  // nicht gezeichnet wird, der Zeitgeber nur ohne Ton.
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
  // Der Zustand des Autopilot-Reglers. MODULWEIT, weil ghostSpeedControl() einen I-Anteil
  // fuehrt - ein Zustand, der je Takt neu entsteht, ist keiner. Zuruecksetzen tut ihn
  // autopilotZuruecksetzen(), gerufen wenn der Autopilot aussetzt: ein I-Anteil, der aus
  // einer alten gelben Phase stehen bleibt, gibt beim naechsten Mal sofort Gas.
  // EIN REGLER JE AUTO, und das ist keine Symmetrie um ihrer selbst willen: der Regler hat
  // einen I-Anteil. Ein gemeinsamer Zustand hiesse, dass die Abweichung von Auto 1 das Gas
  // von Auto 2 mitbestimmt - und umgekehrt. Genau davor warnt der Kommentar in autopilot()
  // schon fuer den Fall "Zustand je Takt neu angelegt": ein Zustand, den man teilt, ist
  // ebenso wenig ein I-Anteil wie einer, den man wegwirft.
  const autopilotRegler = {};
  const autopilotRegler2 = {};
  // `wer` waehlt den Regler. OHNE Angabe werden BEIDE geraeumt, und das ist die richtige
  // Vorgabe: die vorhandenen Aufrufstellen raeumen auf, wenn die gelbe Phase endet oder ein
  // Rennen beginnt - das gilt fuer das ganze Feld und nicht fuer ein Auto.
  function autopilotZuruecksetzen(wer) {
    const leeren = (r) => {
      r.iTerm = 0;
      r.lastThrottle = 0;
      r.lastBrake = 0;
      r.at = 0;
    };
    if (wer === undefined) { leeren(autopilotRegler); leeren(autopilotRegler2); return; }
    leeren(wer === 2 ? autopilotRegler2 : autopilotRegler);
  }

  // ====================================================================================
  // DIE FAHRHILFE: EIN SCHALTER STATT ZWEIER SLIDER
  // ====================================================================================
  //
  // GEMELDET: "Wenn ich jetzt fahre, kann ich gar nicht mehr lenken und das Auto lenkt
  // von alleine." Und dazu die Anweisung: "Gib mir einen Schalter, bei dem ich zwischen
  // Fahrhilfemodus hin und her schalten kann. Wenn er aus ist, will ich ganz normal
  // steuern koennen so wie sonst. Wenn er an ist, soll das Auto alleine lenken. In dem
  // Modus bestimme ich mit dem Lenk-Input nur die Querlage. Vergiss die beiden Slider."
  //
  // ---- DER BEFUND: DIE ORTUNG AUS v0.5.54 HAT ZU WEIT GEGRIFFEN ------------------
  //
  // spielerOrtTick() (90-ghosts.js) haengte dem Fahrerauto seinen Vorausblick
  // (car.modeBytes: Byte 10/15 plus die drei Kacheln in Byte 16-18) an genau EINE
  // Bedingung: trackMode === 'on'. Das ist die "Bahn"/"Ausdruck"-Stellung - die normale
  // Stellung beim Fahren auf der echten Bahn, nicht eine Alles-oder-nichts-Frage der
  // Rennsituation. modeBytes gingen also bei JEDER normalen Fahrt hinaus, nicht nur unter
  // Gelb.
  //
  // Diese Bytes sind aber keine Kleinigkeit: sie sind dieselben, mit denen ein Ghost sich
  // selbst auf der Bahn haelt (AUTO_MODE, gemessen an den eigenen Ghosts der App). Ein
  // echtes Auto, das sie bekommt, faehrt nach seiner eigenen Sensorik und dem Vorausblick -
  // die Lenkung des Fahrers wird dann nicht mehr als Winkel gelesen, sondern (wie beim
  // Ghost) als Querversatz obenauf. Ohne dass der Fahrer das je eingeschaltet haette, war
  // sein Auto damit dauerhaft im selben Modus wie ein autonomer Ghost.
  //
  // ---- DIE LOESUNG: EIN SCHALTER, DEN DER FAHRER SELBST BEDIENT ------------------
  //
  // driverAssistOn ersetzt die Bedingung "trackMode === 'on'" fuer das Fahrerauto. Ab Werk
  // AUS - das stellt "ganz normal steuern koennen so wie sonst" wieder her, unabhaengig
  // von der Bahn/Ausdruck-Stellung, die weiterhin nur bedeutet, ob die Strecke gerade
  // gelesen wird.
  //
  // Ist er AN, gilt fuer das Fahrerauto exakt dasselbe Verfahren wie fuer einen Ghost im
  // Leitplanken-Modus: das Auto haelt sich selbst auf der Bahn, und was im Lenkbyte
  // ankommt, ist keine Radstellung mehr, sondern die Querlage, die der Fahrer haben will.
  // Der Lenk-Input (steerX) geht dafuer UNVERAENDERT durch - nicht die Zahl aendert sich,
  // sondern die Bedeutung, die das Auto ihr gibt, sobald modeBytes dabei sind.
  //
  // AUTOPILOT BLEIBT UNABHAENGIG davon: unter Gelb oder in der Einfuehrungsrunde muss das
  // Auto sich selbst halten, damit die Regelung dort ueberhaupt funktioniert - das war die
  // eigentliche Bestellung hinter v0.5.53. Also ist die Bedingung eine ODER-Verknuepfung:
  // von Hand eingeschaltet, oder der Autopilot ist gerade aktiv. Faehrt man selbst mit
  // ausgeschalteter Fahrhilfe, aendert eine gelbe Flagge daran nichts - sie regelt weiter,
  // wie bestellt.
  //
  // DIE ZWEI SLIDER SIND WEG, wie angewiesen. Die Korrektur-zur-Mitte-Rechnung (lenkHilfe)
  // loeste ein anderes Problem - der Lenkbefehl blieb ein Winkel, nur weicher zur Mitte
  // gezogen - und war eine Software-Kruecke fuer genau das, was die Hardware selbst
  // besser kann, sobald sie den Vorausblick hat. Mit dem Schalter braucht es sie nicht
  // mehr.
  // ---- DREI MODI STATT ZWEI, wie bestellt ---------------------------------------
  //
  // BESTELLT: "Bei Einstellungen -> Fahrgefuehl -> Fahrhilfe: mach 3 Modi draus: aus
  // (standard), voll (auto lenkt komplett selbst), und Querlage (auto lenkt selbst, aber
  // mit nach links und rechts lenken bestimmt man die Querlage). Pass auf, dass du nicht
  // wieder den Standard-Modus kaputt machst."
  //
  //     aus   - Vorgabe. Der Lenk-Input IST der Lenkwinkel, keine modeBytes. Genau der
  //             Zustand, der vorher mit dem ausgeschalteten Schalter galt.
  //     quer  - was vorher der eingeschaltete Schalter war: modeBytes gehen hinaus, und
  //             derselbe Lenk-Input bedeutet fuer das Auto die Querlage.
  //     voll  - neu. Wie 'quer', aber der Lenk-Input wird NICHT weitergegeben: das Auto
  //             bestimmt auch die Querlage selbst.
  //
  // ---- WARUM 'aus' DER ERSTE EINTRAG UND DER VORGABEWERT IST --------------------
  //
  // Weil er genau das bedeuten muss, was er bisher bedeutet hat. Die Warnung war
  // ausdruecklich, und sie hat eine Vorgeschichte: die Fahrhilfe ist ueberhaupt nur
  // entstanden, weil die modeBytes ohne Zutun des Fahrers hinausgingen und er "gar nicht
  // mehr lenken" konnte. Der Vorgabewert ist deshalb nicht Geschmack, sondern der
  // eigentliche Zweck der ganzen Einstellung.
  const FAHRHILFE_MODI = ['aus', 'quer', 'voll'];
  let fahrhilfeModus = 'aus';

  // AN, wenn ein Fahrhilfe-Modus gewaehlt ist ODER der Autopilot gerade greift
  // (Gelb/Formation). autopilotGrund() steht weiter unten in dieser Datei; als
  // Funktionsdeklaration ist sie bereits vorhanden, wenn diese Funktion tatsaechlich zum
  // ersten Mal LAEUFT - das geschieht erst aus einem Zeitgeber, lange nach dem Laden.
  //
  // DER NAME BLEIBT, obwohl es jetzt drei Modi gibt: die Frage, die diese Funktion
  // beantwortet, ist unveraendert "gehen die modeBytes hinaus", und daran haengt genau ein
  // Aufrufer (spielerOrtTick in 90-ghosts.js). 'voll' und 'quer' unterscheiden sich NICHT
  // darin, ob das Auto sich selbst haelt - nur darin, ob der Fahrer die Querlage mitredet.
  function driverAssistAktiv() {
    return fahrhilfeModus !== 'aus' || !!autopilotGrund();
  }

  // ---- UND HIER LIEGT DIE FALLE, IN DIE ICH NICHT GETRETEN BIN ------------------
  //
  // 'voll' heisst: der Lenk-Input geht nicht mit hinaus. Das darf aber NUR gelten, wenn
  // die modeBytes tatsaechlich hinausgehen - denn nur dann liest das Auto die Null als
  // "Mitte der Bahn". Ohne modeBytes liest es sie als RADSTELLUNG, und dann faehrt es mit
  // gerade gestellten Raedern in die naechste Bande, ohne dass der Fahrer eingreifen kann.
  //
  // Die modeBytes haengen an drei Dingen (spielerOrtTick, 90-ghosts.js:3936): Bahn-Stellung,
  // driverAssistAktiv(), und einem Vorausblick, den es nur mit eingescannter Strecke gibt.
  // Diese Funktion rechnet das NICHT nach, sondern liest das ERGEBNIS: playerCar.modeBytes.
  // Eine nachgerechnete Bedingung waere eine zweite Fassung derselben Regel - und wenn die
  // beiden auseinanderlaufen, faehrt das Auto in die Bande.
  function fahrhilfeVollGilt() {
    return fahrhilfeModus === 'voll'
        && !!(typeof playerCar !== 'undefined' && playerCar && playerCar.modeBytes);
  }

  if ($('driver-assist')) {
    $('driver-assist').addEventListener('change', (e) => {
      fahrhilfeModus = FAHRHILFE_MODI.indexOf(e.target.value) >= 0 ? e.target.value : 'aus';
    });
    // Und einmal beim Laden aus dem Markup - dieselbe Regel wie bei jedem anderen Regler:
    // das Bedienelement ist die Wahrheit, das Modell folgt ihm. Ein unbekannter Wert faellt
    // auf 'aus' zurueck und nicht auf den ersten Eintrag: eine Fahrhilfe, die sich aus einer
    // kaputten Sicherung heraus selbst einschaltet, ist genau der gemeldete Fehler.
    const v = $('driver-assist').value;
    fahrhilfeModus = FAHRHILFE_MODI.indexOf(v) >= 0 ? v : 'aus';
  }

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

  // ---- UND ER GILT SEIT v0.6.53 FUER BEIDE AUTOS -------------------------------------
  //
  // Der Grund, warum das der wertvollste der offenen Punkte war: ohne ihn faehrt Auto 2
  // bei gelber Flagge mit Vollgas in eine Kolonne, die alle anderen gerade einhalten. Eine
  // gelbe Flagge, die fuer ein Auto im Feld nicht gilt, ist keine gelbe Flagge.
  //
  // Moeglich wurde es durch die Ortung aus v0.6.46: autopilotGrund() ist global (Flagge,
  // Einfuehrungsrunde, Bahn/Ausdruck-Stellung), der Rest haengt am Auto - Motor, Regler,
  // Kolonnenversatz, Abseits-Antwort. `wer` ist 1, wenn nichts dasteht.
  function autopilot(fahrerBremse, wer) {
    const zwei = wer === 2;
    const motor = zwei ? physEngine2 : physEngine;
    const regler = zwei ? autopilotRegler2 : autopilotRegler;
    const st = motor.state;
    // ---- STRECKENSCAN: EIGENE, FRUEHE ABZWEIGUNG ----------------------------------
    //
    // BESTELLT: "Streckenscan ... mit querlage = 0 in mittlerem Tempo ueber die Strecke
    // fahren und anhalten, wenn ein geschlossener Rundkurs gemessen wurde." Nicht ueber
    // autopilotGrund(): die beantwortet eine GLOBALE Frage (Gelb/Einfuehrungsrunde gelten
    // fuer beide Autos gleichermassen), ein Scan betrifft aber GENAU EIN Auto -
    // garageScan.car in 60-track.js. Ein globales 'scan' wuerde das jeweils andere Auto
    // mit hineinziehen, auch wenn nur eines tatsaechlich gescannt wird.
    const meinAuto = zwei ? (typeof playerCar2 !== 'undefined' ? playerCar2 : null) : playerCar;
    if (typeof garageScan !== 'undefined' && garageScan.aktiv && garageScan.car === meinAuto) {
      const v = Math.abs(st.speedKmh) / motor.config.topSpeedKmh;
      const dt = Math.max(0.01, Math.min(0.25, (Date.now() - (regler.at || Date.now())) / 1000));
      regler.at = Date.now();
      // formationPace(): dasselbe Mindesttempo wie die Einfuehrungsrunde - hoch genug,
      // um die Streckencodes zuverlaessig zu lesen (siehe GHOST_READ_MIN dort).
      // BESTELLT: "Scan-Modus [...] das Auto faehrt so schnell, dass es aus der
      // Haarnadelkurve rausfaehrt -> drosseln." Insgesamt 85 % der Einfuehrungsrunde, in
      // einer gemeldeten Haarnadel 65 %. Die Leseschwelle 0,35 (GHOST_READ_MIN) ist am
      // GEDRUCKTEN Muster gemessen; der Scan laeuft auf der Bahn (trackMode 'on').
      const ziel = formationPace() * (scanInHaarnadel(meinAuto) ? 0.65 : 0.85);
      const geregelt = ghostSpeedControl(regler, ziel, v, dt);
      return { grund: 'scan', throttle: geregelt.throttle, brake: geregelt.brake,
               steer: 0, lenkt: !abseitsJetztFuer(zwei ? 2 : 1) };
    }
    const grund = autopilotGrund();
    // AUSSETZER RAEUMEN DEN REGLER AUF. Ohne das traegt der I-Anteil ueber das Ende der
    // gelben Phase hinaus und gibt beim naechsten Mal aus dem Stand Gas.
    if (!grund) { autopilotZuruecksetzen(wer); return null; }
    // ---- WIE EIN GHOST, UND DAS IST DER BESTELLTE UNTERSCHIED ---------------------
    //
    // GEMELDET: "gelbe Flagge fuer mein Auto auf der Bahn fixen: es gibt nur Gas, sollte
    // stattdessen aber wie ein Ghost und entsprechend gedrosselt weiterfahren."
    //
    // Hier stand ein roher P-Regler: throttle = err * 4, brake = -err * 3. Ein reiner
    // P-Regler hat eine Beharrungsabweichung - er braucht eine Abweichung, um ueberhaupt Gas
    // zu erzeugen -, und ohne Totband kippt er um den Zielwert. Auf dem Tisch liest sich das
    // als "es gibt nur Gas": das Auto bekommt Gas, laeuft ueber das Ziel, bekommt Bremse,
    // faellt darunter, und so weiter.
    //
    // Ein Ghost hat fuer genau dieses Problem ghostSpeedControl(): PI mit Totband und
    // Ratengrenzen, und die Begruendung dafuer steht dort ausgeschrieben ("Ziel 35 Prozent,
    // erreicht 24" war die gemessene Beharrungsabweichung des alten P-Reglers). Der Fahrer
    // bekommt jetzt DENSELBEN Regler - "wie ein Ghost" ist wortwoertlich gemeint.
    //
    // Der Zustand liegt modulweit: der Regler hat einen I-Anteil, und ein Zustand, der bei
    // jedem Takt neu angelegt wird, ist kein I-Anteil.
    //
    // UND DER LESEBODEN. yellowFactor() ist YELLOW_KMH/Hoechstgeschwindigkeit = 80/327 =
    // 0,244, GHOST_READ_MIN ist 0,35: das Gelb-Tempo liegt unter der Drehzahl, bei der das
    // Auto das gedruckte Muster noch liest. Im Leitplanken-Modus - und nur dort greift
    // dieser Autopilot ueberhaupt - braucht das Auto genau diese Lesung, um sich auf der
    // Bahn zu halten. Ohne den Boden waere der Autopilot also die Ursache dafuer, dass das
    // Auto abfliegt. Dieselbe Zeile steht seit v0.5.51 auch bei den Ghosts.
    const ziel = grund === 'formation'
      ? formationPace()
      : Math.max(yellowFactor(), GHOST_READ_MIN);
    const v = Math.abs(st.speedKmh) / motor.config.topSpeedKmh;
    const dtA = Math.max(0.01, Math.min(0.25,
      (Date.now() - (regler.at || Date.now())) / 1000));
    regler.at = Date.now();
    const geregelt = ghostSpeedControl(regler, ziel, v, dtA);
    let throttle = geregelt.throttle;
    let brake = geregelt.brake;
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
             // Der Kolonnenversatz SEINES Autos: er haengt am Startplatz
             // (gridPosOf) und an einer eigenen Schlaengelphase - zwei Autos in
             // einer Zweierkolonne sollen nicht auf derselben Spur rollen.
             steer: grund === 'formation' && typeof formationDriverOffset === 'function'
               ? formationDriverOffset(zwei ? playerCar2 : playerCar) : 0,
             // ---- OB ER UEBERHAUPT LENKEN DARF -------------------------------------
             //
             // Neben der Bahn nicht. Beide Werte, die er liefert - 0 bei Gelb und der
             // Kolonnenversatz in der Einfuehrungsrunde -, sind QUERLAGEN und setzen
             // voraus, dass das Auto sich selbst auf der Bahn haelt. Ohne Streckenlesung
             // gehen die modeBytes nicht hinaus (spielerOrtTick, 90-ghosts.js), und dann
             // liest das Auto dieselbe Null als RADSTELLUNG: es faehrt mit geraden Raedern
             // weiter, und der Fahrer kann nichts dagegen tun.
             //
             // Genau das steht als Argument schon in der Doku ("ein Autopilot ohne
             // Querregelung wuerde es geradeaus in die Bande fahren") - dort als Grund
             // dafuer, dass der Autopilot im Ausdruck-Modus gar nicht anlaeuft. Neben der
             // Bahn gilt es genauso, nur voruebergehend.
             //
             // GAS UND BREMSE BLEIBEN BEI IHM. Eine gelbe Flagge bleibt eine gelbe
             // Flagge; hergegeben wird die Lenkung, damit man zurueckfahren kann, nicht
             // die Tempobegrenzung.
             lenkt: !abseitsJetztFuer(zwei ? 2 : 1) };
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

  // ---- UND DASSELBE FUER AUTO 2 ------------------------------------------------------
  //
  // Die drei Groessen darueber gelten fuer Auto 1 und bleiben, was sie sind: acht Stellen
  // lesen sie, der Pruefstand SCHREIBT sie (offtrackAktiv = true in 93-testbench.js), und
  // vier Selbsttests haengen daran. Sie in Zugriffsfunktionen zu verwandeln waere ein
  // Umbau, der mit dem Zwei-Spieler-Modus nichts zu tun hat.
  //
  // Auto 2 bekommt deshalb einen eigenen Satz derselben drei Zahlen, und `abseitsSatz()`
  // versteckt die Asymmetrie an EINER Stelle. Das ist bewusst die kleine Fassung, und der
  // Grund steht hier, damit niemand sie fuer Schlamperei haelt: ein dritter Spieler waere
  // der Moment, in dem daraus ein Datensatz je Auto werden muss.
  const abseitsZwei = { seit: null, wiederSeit: null, aktiv: false, zaehler: 0 };

  // Gerufen aus dem Meldekanal in 70-race.js (Auto 1) und aus dem Meldestrom je Auto in
  // 90-ghosts.js (Auto 2), also je Paket. `wer` ist 1, wenn nichts dasteht.
  function offtrackMelden(abseits, wer) {
    const jetzt = Date.now();
    if (wer === 2) {
      const a = abseitsZwei;
      if (abseits) {
        a.wiederSeit = null;
        if (a.seit === null) a.seit = jetzt;
        if (!a.aktiv && jetzt - a.seit >= offtrackEinMs) { a.aktiv = true; a.zaehler++; }
      } else {
        a.seit = null;
        if (a.wiederSeit === null) a.wiederSeit = jetzt;
        if (a.aktiv && jetzt - a.wiederSeit >= OFFTRACK_AUS_MS) a.aktiv = false;
      }
      // KEINE Anzeige: das Abseits-Schild im Cockpit gehoert Auto 1. Fuer Auto 2 steht es
      // auf dessen eigenem Schirm (siehe den Cockpit-Schirm "Auto 2").
      return;
    }
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

  // Die zwei Fragen von oben, jetzt mit Adressat. Fuer `wer === 1` ist es Wort fuer Wort
  // dieselbe Antwort wie vorher - deshalb rufen die acht vorhandenen Stellen weiter
  // abseitsJetzt() und offtrackGilt() und muessen nicht angefasst werden.
  function abseitsJetztFuer(wer) {
    if (wer === 2) return abseitsZwei.aktiv && trackMode === 'on';
    return abseitsJetzt();
  }

  function offtrackGiltFuer(wer) {
    return offtrackEffekt && abseitsJetztFuer(wer);
  }

  function abseitsZaehlerFuer(wer) {
    return wer === 2 ? abseitsZwei.zaehler : offtrackZaehler;
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
    // DIE KENNLINIE ZUERST, vor Tank und Schaden. Sie beschreibt, was der Daumen
    // MEINT; Tank und Schaden beschreiben, was das Auto daraus machen kann. Andersherum
    // wuerde die Kennlinie einen halbleeren Tank mitkruemmen.
    //
    // Nur nach vorn: die Bremse hat ihre eigene Kennlinie, und ein Bremspedal, das sich
    // je nach Gaseinstellung anders anfuehlt, waere eine Falle.
    const gasKurve = gasKennlinie(Math.max(0, throttleY), physEngine.config.throttleGamma);
    let rawThrottle = fuelDamageDerate(gasKurve, fuelCut);
    let rawBrake = Math.max(0, -throttleY);
    // Der rohe Lenk-Input geht unveraendert durch. Steht die Fahrhilfe auf 'quer' (siehe
    // driverAssistAktiv() oben), aendert das NICHT diese Zahl, sondern nur, wie das Auto
    // sie versteht: modeBytes gehen dann mit hinaus (spielerOrtTick in 90-ghosts.js), und
    // dieselbe Zahl wird zur Querlage statt zum Lenkwinkel.
    //
    // NUR 'voll' greift in die Zahl ein, und nur dann, wenn die modeBytes wirklich
    // hinausgehen - die Begruendung steht bei fahrhilfeVollGilt(). In 'aus' und 'quer' ist
    // diese Zeile dieselbe wie vorher.
    let steer = fahrhilfeVollGilt() ? 0 : steerX;
    // Bei gelber Flagge und in der Einfuehrungsrunde faehrt das Auto selbst. Siehe
    // autopilotGrund() fuer die zwei Gruende und autopilot() fuer die Regelung.
    const ap = autopilot(rawBrake);
    if (ap) {
      rawThrottle = ap.throttle;
      rawBrake = ap.brake;
      // Die Lenkung nur, wenn er sie fuehren DARF - siehe `lenkt` in autopilot().
      if (ap.lenkt) steer = ap.steer;
    }
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
        padRumble(0.12, 0.34, OFFTRACK_RUMBLE_MS, 'abseits');
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

  // ====================================================================================
  // DIE FAHRPHYSIK VON SPIELER 2
  // ====================================================================================
  //
  // ABSICHTLICH SCHMAL. physicsStep() darueber ist gewachsen, weil es alles traegt, was am
  // Fahrerauto haengt: Tank und Schaden, den Autopiloten unter Gelb, die Drosselung abseits
  // der Bahn, das Rumpeln im Controller, den Windschatten und die gefahrene Strecke. Jede
  // dieser Groessen haengt an der ORTUNG des Fahrerautos (spielerOrt in 90-ghosts.js) oder
  // an einem Zaehler, den es nur einmal gibt.
  //
  // Diese Funktion rechnet deshalb genau das, was "beide koennen fahren" braucht:
  // Gaskennlinie, Fahrphysik, Anzeige. Was Spieler 2 in dieser Fassung NICHT hat, steht
  // wortwoertlich im Hilfetext der Kachel, damit es niemand sucht:
  //
  //   kein Sprit und kein Schaden   sie sind globale Zaehler (70-race.js) und waeren fuer
  //                                zwei Autos zwei Zaehler. Ungleiche Regeln waeren
  //                                schlimmer als keine: der Modus soll fair sein.
  //   kein Autopilot unter Gelb     er greift auf die Ortung des Fahrerautos zu
  //   keine Abseits-Drosselung      dieselbe Ortung
  //   kein Windschatten            dito
  //
  // Was er HAT: eine eigene Physikinstanz, also eigene Gaenge, eigene Drehzahl, eigenes
  // Tempo, eigene Reifen- und Bremsentemperatur - alles, was den Wagen fahren laesst.
  function physicsStep2() {
    if (!physicsEnabled) { phys2LastTime = null; return; }
    const now = performance.now();
    const dt = phys2LastTime ? Math.min(0.25, (now - phys2LastTime) / 1000)
                             : CONTROL_SEND_INTERVAL_MS / 1000;
    phys2LastTime = now;
    // Dieselbe Kennlinie und derselbe Regler wie bei Spieler 1: der Daumen soll sich auf
    // beiden Pads gleich anfuehlen.
    const gasKurve = gasKennlinie(Math.max(0, p2Throttle), physEngine2.config.throttleGamma);
    // ---- ABSEITS DER BAHN AUCH FUER AUTO 2 --------------------------------------------
    //
    // VOR der Physik, genau wie bei Auto 1 - und die Begruendung dort ist es wert,
    // wiederholt zu werden: ein Gasfaktor NACH der Physik zeigte im Tacho volles Tempo,
    // waehrend das Auto langsamer fuhr. Hier sagen Anzeige und Auto dasselbe.
    let gas = gasKurve;
    // ---- SCHADEN KOSTET LEISTUNG, AUCH BEI AUTO 2 ---------------------------------
    //
    // Dieselbe Kennlinie wie bei Auto 1: bis zu 30 Prozent weniger Gas mit dem Schaden,
    // halbe Leistung im Totalschaden, und darunter ein BODEN - sonst liegt der Notlauf
    // unter minMoveThrottle, und dort zuckt das Auto statt zu fahren.
    //
    // ---- UND DER EIGENE TANK, seit v0.6.48 ----------------------------------------
    //
    // Hier stand als zweites Argument eine feste 1 mit dem Vermerk "der eigene Tank kommt
    // im naechsten Schritt". Jetzt ist er da: der Verbrauch laeuft in tankZweiTick(), die
    // Rampe des leeren Tanks in tankZweiCutRampe() - hier, weil dies die einzige Stelle mit
    // einem verlaesslichen dt ist, dasselbe Argument wie bei Auto 1.
    //
    // REIHENFOLGE WIE BEI AUTO 1: erst die Kennlinie (sie beschreibt, was der Daumen
    // MEINT), dann Tank und Schaden (sie beschreiben, was das Auto daraus machen kann).
    // Andersherum wuerde die Kennlinie einen halbleeren Tank mitkruemmen.
    fuelTankTick(p2Throttle, 2);
    gas = fuelDamageDerate(gas, tankZweiCutRampe(dt), 2);
    // ---- BOXENSTOPP, seit v0.6.54 -------------------------------------------------
    //
    // Der Takt zuerst, der Deckel danach: der Takt entscheidet ueber die Lage (angefordert,
    // Service, aus), und der Deckel liest sie. Umgekehrt haette der Deckel einen Takt lang
    // die alte Lage.
    //
    // EIN EIGENER DECKEL, weil der von Auto 1 ueber topSpeedScale in sendControlValue()
    // laeuft - und diesen Weg nimmt Auto 2 nicht (es geht ueber writeToCar, wie ein Ghost).
    boxZweiTick();
    gas = Math.min(gas, boxZweiDeckel());
    // ---- GELBE FLAGGE UND EINFUEHRUNGSRUNDE, seit v0.6.53 -------------------------
    //
    // Der wertvollste der offenen Punkte, und der Grund ist einfach: ohne ihn faehrt
    // Auto 2 bei Gelb mit Vollgas in eine Kolonne, die alle anderen gerade einhalten.
    // Eine gelbe Flagge, die fuer ein Auto im Feld nicht gilt, ist keine.
    //
    // DIESELBE Reihenfolge wie bei Auto 1: der Autopilot setzt Gas und Bremse NACH Tank
    // und Schaden. Ein Notlauf bleibt ein Notlauf, auch unter Gelb.
    let lenkung = p2Steer;
    let bremse = Math.max(0, -p2Throttle);
    const ap2 = autopilot(bremse, 2);
    if (ap2) {
      gas = ap2.throttle;
      bremse = ap2.brake;
      // Die Lenkung nur, wenn er sie fuehren DARF - siehe `lenkt` in autopilot().
      if (ap2.lenkt) lenkung = ap2.steer;
    }
    if (offtrackGiltFuer(2)) gas = Math.min(gas, OFFTRACK_GAS);
    // Und das Rumpeln, an seinen eigenen Pad. Bis v0.6.45 waere es der Pad von Spieler 1
    // gewesen; jetzt hat jeder Stoss eine Adresse.
    if (abseitsJetztFuer(2)) {
      const jetzt = Date.now();
      if (jetzt - offtrack2RumbleAt >= OFFTRACK_RUMBLE_MS - 40) {
        offtrack2RumbleAt = jetzt;
        padRumble(0.12, 0.34, OFFTRACK_RUMBLE_MS, 'abseits', 2);
      }
    }
    const out = physEngine2.update({ steering: lenkung, throttle: gas,
                                     brake: bremse,
                                     headlights: headlightsOn }, dt);
    // Der Motorton von Auto 2, aus SEINER Drehzahl - dieselbe Zahl, die seine Anzeige
    // bekommt. Defensiv gerufen, weil 80-sound.js SPAETER gebaut wird: zur Laufzeit ist die
    // Funktion da, zur Ladezeit waere ein Zugriff die temporale Todeszone.
    if (typeof updateEngineSound2 === 'function') updateEngineSound2();
    physOut2Steer = out.servoAngle;
    physOut2Throttle = out.motorPWM;
  }

  // Beim Umschalten die Einstellungen uebernehmen. Die rund sechzig Regler im Optionentab
  // schreiben nur auf physEngine.config; sie zu verdoppeln waere ein zweiter Ort fuer jede
  // Zahl. Also wird hier kopiert, und zwar bei JEDEM Einschalten - wer zwischendurch am
  // Fahrgefuehl gedreht hat, bekommt es fuer beide Autos.
  //
  // Die Gangtabelle wird MIT kopiert, aber als eigene Objekte: derselbe Satz Zahlen, nicht
  // dieselben Objekte. Sonst schriebe ein Schaltvorgang von Spieler 2 in die Gaenge von
  // Spieler 1 (genau diese Falle steht bei den Ghosts schon einmal beschrieben).
  function physEngine2Abgleichen() {
    Object.assign(physEngine2.config, physEngine.config);
    if (Array.isArray(physEngine.config.gears)) {
      physEngine2.config.gears = physEngine.config.gears.map(g => Object.assign({}, g));
    }
  }

  // ---- GLOBALE EINSTELLUNGEN GELTEN FUER BEIDE AUTOS ---------------------------------
  //
  // BESTELLT: "Globale einstellungen gelten für beide autos gleichermaßen: fahrgefühl
  // optionen, ob tank etc. an/aus".
  //
  // Bis v0.6.55 kopierte physEngine2Abgleichen() die Abstimmung nur BEIM ANSCHALTEN des
  // Modus. Wer danach am Fahrgefuehl drehte, verstellte nur Auto 1 - und zwei Autos mit
  // verschiedener Abstimmung sind kein faires Rennen, sondern ein Fehler, den man erst im
  // Fahren merkt.
  //
  // EIN ZUHOERER STATT SECHSUNDZWANZIG. Die Abstimmung wird an 26 einzelnen Stellen
  // geschrieben (accelerationFactor, brakeBias, steerResponse, tyreEffect, ...). Jede
  // davon um eine Kopierzeile zu ergaenzen waeren 26 Gelegenheiten, die 27. zu vergessen -
  // dieselbe Ueberlegung, die in 98b-sicherung.js zu EINEM Zuhoerer fuer alle Regler
  // gefuehrt hat ("ein Zuhoerer statt einer je Regler").
  //
  // 'input' UND 'change': Schieber melden beides, Auswahlfelder und Ankreuzfelder nur
  // 'change'. Beide zu nehmen kostet nichts, weil das Kopieren billig ist und nur bei
  // eingeschaltetem Modus ueberhaupt laeuft.
  //
  // WAS NICHT UEBER config LAEUFT, steht weiter unten in spielerZweiSenden(): die
  // Hoechstgeschwindigkeit und die Batteriekompensation sitzen im Sendeweg von Auto 1, den
  // Auto 2 gar nicht nimmt.
  for (const art of ['input', 'change']) {
    document.addEventListener(art, (e) => {
      if (!zweiSpieler) return;
      const el = e.target;
      if (!el || !el.closest || !el.closest('#tab-options, #tab-race')) return;
      physEngine2Abgleichen();
    }, true);
  }

  function zweiSpielerSetzen(an) {
    zweiSpieler = !!an;
    if (zweiSpieler) physEngine2Abgleichen();
    // Die zweite Motorstimme. Sie teilt die Schleifenpuffer mit Auto 1 (sie liegen je
    // Motormodell, nicht je Auto), bekommt aber eine eigene Stereoseite - zwei Motoren im
    // selben Drehzahlband aus einem Lautsprecher klingen wie ein verstimmter Motor.
    if (typeof stimmeZweiSetzen === 'function') stimmeZweiSetzen(zweiSpieler);
    else {
      p2Steer = 0; p2Throttle = 0; physOut2Steer = 0; physOut2Throttle = 0;
      // AUSSCHALTEN IST EIN HALTEBEFEHL, und zwar aus einem Grund, der beim Bauen leicht
      // untergeht: writeToCar() schickt nur, was es bekommt. Wird der Modus WAEHREND der
      // Fahrt abgeschaltet, hoert der Herzschlag einfach auf zu senden - und das Auto
      // behaelt das letzte Gas und faehrt allein weiter. Genau dieser Fehler ist in diesem
      // Projekt schon einmal passiert (Pad abgezogen, Auto fuhr weiter), deshalb geht die
      // Rolle zurueck: setCarRole('none') schickt dabei die Null.
      //
      // Die Rolle ZURUECKZUNEHMEN und nicht nur stillzulegen ist ausserdem das, was man in
      // der Garage sieht: ohne den Modus gibt es den vierten Knopf nicht, und eine Zeile
      // mit einer Rolle, die kein Knopf anzeigt, waere ein Zustand ohne Bedienung.
      if (typeof playerCar2 !== 'undefined' && playerCar2
          && typeof setCarRole === 'function') {
        setCarRole(playerCar2, 'none');
      }
    }
    // Liegt der Schirm von Auto 2 vorne, wenn der Modus ausgeht, muss er verlassen werden -
    // sonst starrt man auf neun Zahlen, die niemand mehr nachfuehrt, und der Pfeil kommt
    // nicht zurueck (cockpitScreenStep ueberspringt ihn dann ja gerade).
    if (!zweiSpieler && cockpitScreenIst() && cockpitScreenIst().nurZweiSpieler) {
      cockpitScreenZu('main');
    }
    // DAS KAESTCHEN GEHT MIT. Der Modus laesst sich seit v0.6.45 auch aus der Garage
    // einschalten (siehe setCarRole in 90-ghosts.js), und ein Schalter, der "aus" zeigt,
    // waehrend zwei Autos fahren, ist genau die Luege, die der Selbsttest "Schalter und
    // Spiegel sagen beim Laden dasselbe" sucht.
    //
    // OHNE Ereignis: .checked zu setzen loest kein 'change' aus, der Zuhoerer laeuft also
    // nicht zurueck in diese Funktion. Die Selbstsicherung schreibt gebuendelt auf
    // 'change'/'input' - deshalb wird sie hier von Hand angestossen, sonst ist der Modus
    // nach dem Neuladen wieder aus.
    const kaestchen = $('opt-zwei-an');
    if (kaestchen && kaestchen.checked !== zweiSpieler) {
      kaestchen.checked = zweiSpieler;
      if (typeof autoSicherungPlanen === 'function') autoSicherungPlanen();
    }
    if (typeof renderGarage === 'function') renderGarage();
    if (typeof zweiSpielerKachelZeichnen === 'function') zweiSpielerKachelZeichnen();
    // Der Spieler-Umschalter ueber der Bindungstabelle erscheint/verschwindet mit dem
    // Modus (siehe bindPlayerRowZeichnen in 90-ghosts.js, ueber renderBindTable erreicht).
    // Ohne diesen Ruf blieb er stehen, wie er beim Laden war, bis die naechste Zuordnung
    // oder ein Neuladen ihn zufaellig nachzog.
    if (typeof renderBindTable === 'function') renderBindTable();
    // Die Hoehe des Cockpits aendert sich mit der neuen Zeile, im Vollbild also auch der
    // Skalierungsfaktor. Ohne diesen Ruf steht die Zeile im Vollbild unter dem Rand.
    cockpitPassung();
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
  // Einmaliger Haken fuer "eine Wiedergabe ist fertig" - gesetzt von 90c-macro-track.js,
  // hier nur aufgerufen und sofort wieder geloescht. Kein neuer Zustand fuer eine spaetere
  // Datei, sondern derselbe Punkt, an dem stopPlayback() ohnehin schon "fertig" weiss.
  let macroPlaybackDoneCallback = null;

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
    if (macroPlaybackDoneCallback) {
      const fn = macroPlaybackDoneCallback;
      macroPlaybackDoneCallback = null;
      fn();
    }
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

