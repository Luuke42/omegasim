  // ============================ TUTORIAL (experimentell) ================================
  //
  // BESTELLT: "To the title screen, also add a tutorial button. When I click it, it leads me
  // through the steps and teases some of the capabilities of the app."
  //
  // Eine Bildfolge auf den ECHTEN Schirmen: je Schritt ein Scheinwerfer auf das Element, um
  // das es geht (der Rest abgedunkelt), und eine Karte mit Bild, Titel und zwei Saetzen.
  // Bedienbar wie jedes Menue: die Karte ist ein menuNav-Container (50b-menu-nav.js), Kreuz
  // waehlt (vorgewaehlt: Weiter), Kreis geht einen Schritt zurueck, auf dem ersten schliesst
  // er. Startet nie von selbst - nur ueber den Knopf, Dreieck oder T auf dem Titel (die
  // Steuerung: Kreis oder S).
  //
  // Der erste Schritt steht schon auf FAHREN und nicht auf dem Titel: auf dem Titel
  // verbraucht konsolePadTitel() jede Taste, dort gaebe es kein Weiter.

  // v1.3.15: das Tutorial auf dem Titel ist keine Bildfolge mehr (bis v1.3.14 K_TOUR, neun
  // Karten ueber die Schirme), sondern die gefuehrte Fahrt mit Ansage am Ende dieser Datei
  // (tutorialStarten). Die Fuehrungen unten (Steuerung, Editor, Raum, ...) bleiben Karten.

  // DIE STEUERUNG BEIM FAHREN. BESTELLT: "neben dem Tutorial-Button noch einen Button zur
  // Steuerung ... nur mit Gamepad ... am Ende, wo man das Bild vom Controller sieht und die
  // Belegung aendern kann", dann: "Bitte im Hintergrund den Cockpit Screen zeigen und auch
  // sagen, dass man auf die Tasten druecken kann. Hier soll es nur um die Steuerung beim
  // Fahren gehen." Also auf dem Cockpit, nur Fahrtasten, und jede gedrueckte Taste wird auf
  // der Karte angezeigt (konsoleTourPad). Solange die Fuehrung offen ist, faehrt nichts: der
  // Pad wird verbraucht, blaettern geht mit dem Steuerkreuz links/rechts. `knoepfe` sind die
  // Tasten des Schritts (Standard-Belegung, BIND_DEFAULTS in 90-ghosts.js).
  const K_STEUERUNG = [
    { tab: 'race', ziel: null, bild: 'controller', titel: 'Steuerung beim Fahren',
      text: 'Diese Führung gilt nur mit Gamepad (PS5, PS4 oder Xbox). Drück ruhig die Tasten, die Karte zeigt, was du drückst. Weiter mit dem Steuerkreuz nach rechts.' },
    { tab: 'race', ziel: null, taste: 'R2 · L2', knoepfe: [7, 6], titel: 'Gas und Bremse',
      text: 'R2 gibt Gas, L2 bremst. Je tiefer du drückst, desto stärker.' },
    { tab: 'race', ziel: null, taste: 'L-STICK', knoepfe: ['lenk'], titel: 'Lenken',
      text: 'Der linke Stick lenkt.' },
    { tab: 'race', ziel: null, taste: '○ □', knoepfe: [1, 2], titel: 'Schalten',
      text: 'Kreis schaltet hoch, Quadrat runter. Im Stand geht Quadrat bis in den Rückwärtsgang.' },
    { tab: 'race', ziel: null, taste: '✕', knoepfe: [0], titel: 'Boxenstopp und Flagge',
      text: 'Kreuz tippen fordert den Boxenstopp an. Eine Sekunde halten zeigt die gelbe Flagge.' },
    { tab: 'race', ziel: null, taste: 'L1 · R1', knoepfe: [4, 5], titel: 'Boxenstopp vorwählen',
      text: 'L1 wählt die Reifen, R1 die Tankmenge für den nächsten Stopp.' },
    { tab: 'race', ziel: null, taste: '△ · R3', knoepfe: [3, 11], titel: 'Licht',
      text: 'Dreieck schaltet das Licht, R3 gibt Lichthupe.' },
    { tab: 'race', ziel: null, taste: '◀ ▶', knoepfe: [14, 15], titel: 'Cockpit-Schirme',
      text: 'Das Steuerkreuz blättert die Schirme: Box, Rennen, Einstellungen. Hier blättert es die Schritte.' },
    { tab: 'race', ziel: null, taste: 'OPTIONS', knoepfe: [9], titel: 'Menü',
      text: 'Options öffnet das Fahren-Menü und bringt dich zurück ins Cockpit.' },
    { tab: 'race', ziel: null, taste: 'L3 · SHARE', knoepfe: [10, 8], titel: 'Vollbild und Lesemodus',
      text: 'L3 schaltet das Vollbild, Share wechselt zwischen Bahn und Ausdruck.' },
    { tab: 'options', sub: 'opt-pad', ziel: ['#pad-zoom'], bild: 'controller', titel: 'Alle Tasten und die Belegung',
      text: 'Hier siehst du alle Tasten. Mit „Neu zuweisen“ belegst du jede Funktion um.' },
  ];
  // DER STRECKENEDITOR. BESTELLT: "Ueberarbeite den Streckeneditor und fuege dort auch ein
  // Tutorial ein wie bei den anderen Sachen." Laeuft im Vollbild des Editors; der Pad
  // gehoert solange der Fuehrung (Kreuz oder rechts weiter, Kreis oder links zurueck).
  const K_EDITOR = [
    { tab: 'track', sub: 'edit', ziel: null, bild: 'strecke-bahn', titel: 'Der Streckeneditor',
      text: 'Hier baust du deine Strecke nach. Oben die Aktionen, in der Mitte die Karte, unten die Teile.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-preview-svg'], taste: 'L1 · R1', titel: 'Teil auswählen',
      text: 'L1 und R1 (Tastatur Q und E) wählen das vorige oder nächste Teil. Tippen auf die Karte geht auch. Das gewählte Teil ist gelb.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-palette'], taste: '◀ ▶ ✕', titel: 'Teil einfügen',
      text: 'Wähl unten ein Teil mit dem Steuerkreuz und drück Kreuz (Enter). Es kommt hinter das gewählte Teil.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-delete-sel'], taste: '□', titel: 'Teil entfernen',
      text: 'Quadrat (Entf) nimmt das gewählte Teil heraus. Start und Ziel bleiben immer.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-rotate-left', '#track-rotate-right'], taste: '△', titel: 'Drehen',
      text: 'Dreieck (R) dreht die ganze Strecke um 45 Grad, mit Umschalt andersherum.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-undo'], taste: '○', titel: 'Rückgängig',
      text: 'Kreis (Z) nimmt die letzte Änderung zurück, auch mehrmals.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-fs-info'], bild: 'strecke-frei', titel: 'Länge und Teile',
      text: 'Oben steht die Länge in Metern und im Maßstab 1:50. Hast du unter Meine Teile deinen Karton eingetragen, siehst du hier, was fehlt.' },
    { tab: 'track', sub: 'edit', ziel: ['#track-fs-toggle'], taste: 'L3', titel: 'Schließen',
      text: 'L3 oder Esc schließt den Editor. Die Strecke bleibt, speichern kannst du sie unter Strecke laden.' },
  ];

  // v0.9.45 BESTELLT: "Baue ein Tutorial fuer den Raum-Editor mit ein, so wie beim
  // Streckeneditor." Die Ziele liegen im Raumgestalter (Vollbild, 60b-raum.js).
  const K_RAUM = [
    { tab: 'track', sub: 'raum', ziel: null, bild: 'strecke-bahn', titel: 'Der Raumgestalter',
      text: 'Hier zeichnest du den Platz, auf dem deine Bahn liegt: Boden, auf dem sie stehen darf, und Möbel, die im Weg sind. Zufallsstrecken aus dem Editor passen dann hinein.' },
    { tab: 'track', sub: 'raum', ziel: ['#raum-ds-flaeche'], taste: '✕', titel: 'Malen',
      text: 'Tippen oder ziehen malt. Am Gamepad bewegen Stick oder Steuerkreuz den Cursor, Kreuz (Leertaste) malt, gehalten weiter.' },
    { tab: 'track', sub: 'raum', ziel: ['[data-rd-modus="moebel"]', '[data-rd-modus="boden"]'], taste: '□', titel: 'Möbel oder Boden',
      text: 'Möbel sperrt Fläche, Boden gibt sie wieder frei. Quadrat (M) schaltet um.' },
    { tab: 'track', sub: 'raum', ziel: ['[data-rd-werkzeug="pinsel"]', '[data-rd-werkzeug="rechteck"]'], taste: '△', titel: 'Pinsel oder Rechteck',
      text: 'Der Pinsel malt, solange du drückst. Beim Rechteck ziehst du von Ecke zu Ecke, am Gamepad Kreuz für die erste und Kreuz für die zweite Ecke. Dreieck (R) schaltet um.' },
    { tab: 'track', sub: 'raum', ziel: ['[data-rd-groesse="10"]', '[data-rd-groesse="60"]'], taste: 'L1 · R1', titel: 'Pinselgröße',
      text: '10, 30 oder 60 cm. L1 und R1 wechseln die Größe.' },
    { tab: 'track', sub: 'raum', ziel: ['.raum-ds-vorlagen'], bild: 'strecke-frei', titel: 'Vorlagen',
      text: 'Rechteck, L, U und Oval als schneller Anfang. Danach mit dem Pinsel anpassen.' },
    { tab: 'track', sub: 'raum', ziel: ['#raum-ds-undo'], taste: 'SHARE', titel: 'Rückgängig',
      text: 'Select bzw. Share (Strg+Z) nimmt den letzten Strich zurück, auch mehrmals.' },
    { tab: 'track', sub: 'raum', ziel: ['#raum-ds-probe'], taste: 'OPTIONS', titel: 'Strecke einpassen',
      text: 'Zeigt die Strecke aus dem Editor im Raum, gedreht und verschoben, so dass die ganze Bahn mit 2 cm Abstand hineinpasst.' },
    { tab: 'track', sub: 'raum', ziel: ['#raum-ds-fertig'], taste: '○', titel: 'Schließen',
      text: 'Kreis oder Esc schließt. Unter Strecke, Raum speicherst du den Raum mit Namen und lädst ihn später wieder.' },
  ];

  // v1.0.45 BESTELLT: "in den Optionen eine extra Kachel mit Tutorials ... Neue Tutorials:
  // Safetycar erklaeren (von hinten losfahren, parkt dann am Rand und andere NPCs ueberholen
  // automatisch). Tutorial fuer Meisterschaft. Tutorial fuer Time Attack und Lesen von
  // Telemetrie. Tutorial fuer Challenges." Alle drei laufen auf den echten Schirmen.
  const K_SAFETY = [
    { tab: 'fahren', ziel: ['#fa-auto'], bild: 'auto', titel: 'Safety Car: die Rolle',
      text: 'In der Garage gibst du einem Auto die Rolle Safety Car. Es gibt nur eines je Rennen und nur auf der Bahn. Es zaehlt keine Runde und steht nicht im Ergebnis.' },
    { tab: 'fahren', ziel: null, bild: 'start', titel: 'Faehrt von hinten los',
      text: 'Bei gelber Flagge faehrt das Safety Car los. Dein Auto und die NPCs schliessen von hinten auf und drosseln auf rund 35 Prozent.' },
    { tab: 'fahren', ziel: null, bild: 'strecke-bahn', titel: 'Parkt am Rand',
      text: 'Nach Gruen faehrt es bis Start/Ziel und haelt rechts am Rand. Die Lichter gehen aus, es steht wie ein geparktes Auto.' },
    { tab: 'fahren', ziel: null, bild: 'fahren', titel: 'Andere ueberholen automatisch',
      text: 'Nach Gruen ueberholen die anderen Autos das Safety Car automatisch und fahren weiter. Es wartet am Rand auf die naechste gelbe Phase.' },
  ];
  const K_MEISTER = [
    { tab: 'fahren', ziel: ['#fa-profil'], bild: 'rennen', titel: 'Meisterschaft',
      text: 'Mehrere Rennen hintereinander. Unter der Kachel Meisterschaft waehlst du die Rennen und siehst den Punktestand.' },
    { tab: 'fahren', ziel: null, bild: 'start', titel: 'Punkte und Aufstellung',
      text: 'Je Platzierung gibt es Punkte. Die Startaufstellung des naechsten Rennens richtet sich nach dem Zwischenstand.' },
    { tab: 'fahren', ziel: ['#fa-renn'], bild: 'rennoptionen', titel: 'Einstellungen je Rennen',
      text: 'Dauer, Wetter, Pflichtstopps und die Abstimmung stellst du wie in einem normalen Rennen ein.' },
  ];
  const K_TIMEATTACK = [
    { tab: 'fahren', ziel: ['#fa-renn'], bild: 'rennen', titel: 'Time Attack',
      text: 'Im Renntyp Bestzeit faehrst du allein gegen die Uhr. NPCs fahren als Verkehr, zaehlen aber nicht in der Wertung.' },
    { tab: 'fahren', ziel: null, bild: 'start', titel: 'Telemetrie lesen',
      text: 'Unter Optionen, Telemetrie waehlst du deine Runde. Die Karte zeigt Teil fuer Teil, wo du Zeit gewinnst und verlierst, Tempo, Gas und Bremse.' },
    { tab: 'options', sub: 'opt-telemetrie', ziel: null, bild: 'strecke-bahn', titel: 'Telemetrie-Seite',
      text: 'Vergleiche deine Runden. Die Telemetrie ist noch im Aufbau (WIP), aber die Karte zeigt schon, wo du Zeit liegen laesst.' },
  ];
  const K_CHALLENGES = [
    { tab: 'challenges', ziel: null, bild: 'rennen', titel: 'Challenges',
      text: 'Feste Aufgaben mit Ziel: eine Runde, eine Zeit, ein Gegner. Hier im Reiter Challenges findest du die Aufgaben und deine Medaillen.' },
    { tab: 'challenges', ziel: null, bild: 'start', titel: 'Einstellen',
      text: 'Unter der Streckenkarte stellst du Modus und Preset ein. Erfuellst du das Ziel, bekommst du eine Medaille.' },
  ];

  const K_PAD_NAMEN = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SHARE',
    9: 'OPTIONS', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'PS' };
  const kTourPadVorher = [];
  let kTourLenkVorher = false;
  // Aus pollGamepad (90-ghosts.js): waehrend der Steuerungs-Fuehrung gehoert der Pad ihr.
  // Gibt true zurueck, wenn die Fuehrung den Pad verbraucht hat - dann faehrt nichts.
  function konsoleTourPad(pad) {
    // v1.3.31: die Wahl "Mit Bahn / Auf dem Boden" der Einfuehrung nimmt das Pad (Steuerkreuz und
    // Kreuz/A), bis Kreuz wieder losgelassen ist - sonst loeste derselbe Druck danach im Cockpit
    // einen Boxenstopp aus (flagTasteTick sieht eine neue Flanke).
    if (typeof tutWahlOffen === 'function' && tutWahlOffen()) { tutWahlPad(pad); return true; }
    if (!kTourOffen) return false;
    // Editor-Fuehrung: im Vollbild bedient sonst der Editor den Pad; hier blaettert er nur.
    if (kTourListe === K_EDITOR || kTourListe === K_RAUM) {
      const neu = [];
      for (let i = 0; i < pad.buttons.length; i++) {
        const n = !!(pad.buttons[i] && pad.buttons[i].pressed);
        if (n && !kTourPadVorher[i]) neu.push(i);
        kTourPadVorher[i] = n;
      }
      if (neu.includes(0) || neu.includes(15)) konsoleTourWeiter();
      else if (neu.includes(1) || neu.includes(14)) konsoleTourZurueck();
      return true;
    }
    if (kTourListe !== K_STEUERUNG) return false;
    const neu = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const n = !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
      if (n && !kTourPadVorher[i]) neu.push(i);
      kTourPadVorher[i] = n;
    }
    const lenk = Math.abs((pad.axes || [])[0] || 0) > 0.5;
    if (lenk && !kTourLenkVorher) neu.push('lenk');
    kTourLenkVorher = lenk;
    if (neu.includes(15)) { konsoleTourWeiter(); return true; }
    if (neu.includes(14)) { konsoleTourZurueck(); return true; }
    if (neu.length) {
      const s = kTourListe[kTourSchritt] || {};
      const k = neu[neu.length - 1];
      const name = k === 'lenk' ? 'L-STICK' : (K_PAD_NAMEN[k] || ('#' + k));
      const treffer = (s.knoepfe || []).some((x) => neu.includes(x));
      const live = $('k-tour-live');
      if (live) {
        live.hidden = false;
        live.textContent = (treffer ? '✓ ' : '') + t('Gedrückt') + ': ' + name;
        live.classList.toggle('treffer', treffer);
      }
      if (treffer) $('k-tour-taste').classList.add('gedrueckt');
    }
    return true;
  }
  // Wo eine Fuehrung endet: das Tutorial auf Fahren, die Steuerung dort, wo sie hinfuehrt.
  const K_TOUR_ENDE = new Map([[K_STEUERUNG, 'bleiben'], [K_EDITOR, 'bleiben'], [K_RAUM, 'bleiben'],
                               [K_SAFETY, 'fahren'], [K_MEISTER, 'fahren'], [K_TIMEATTACK, 'fahren'], [K_CHALLENGES, 'fahren']]);

  let kTourOffen = false;
  let kTourSchritt = 0;
  let kTourListe = K_STEUERUNG;
  function konsoleTourOffen() { return kTourOffen; }

  function konsoleTourStart(liste) {
    // Ohne Liste (frueher K_TOUR): das gefuehrte Tutorial (v1.3.15).
    if (!Array.isArray(liste)) { tutorialStarten(); return; }
    kTourListe = liste;
    kTourOffen = true;
    kTourSchritt = 0;
    const d = $('k-tour');
    if (d) d.hidden = false;
    konsoleTourZeigen();
  }
  function konsoleTourZu(fertig) {
    kTourOffen = false;
    const d = $('k-tour');
    if (d) d.hidden = true;
    document.querySelectorAll('.menu-nav-sel').forEach((el) => el.classList.remove('menu-nav-sel'));
    menuNavEnsureContext();
    if (fertig && K_TOUR_ENDE.get(kTourListe) === 'bleiben') return;
    if (fertig || kAktiverTab() !== 'fahren') konsoleZeige('fahren');
    setTimeout(() => { menuNavEnsureContext(); konsoleFokusAuf('fa-auto'); }, 0);
  }
  function konsoleTourWeiter() {
    if (kTourSchritt >= kTourListe.length - 1) { konsoleTourZu(true); return; }
    kTourSchritt++;
    konsoleTourZeigen();
  }
  function konsoleTourZurueck() {
    if (kTourSchritt <= 0) { konsoleTourZu(false); return; }
    kTourSchritt--;
    konsoleTourZeigen();
  }

  // Das Rechteck um alle Ziele eines Schritts; null, wenn keines sichtbar ist.
  function kTourRechteck(ziele) {
    let r = null;
    for (const sel of ziele || []) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      r = r ? { l: Math.min(r.l, b.left), o: Math.min(r.o, b.top), r: Math.max(r.r, b.right), u: Math.max(r.u, b.bottom) }
            : { l: b.left, o: b.top, r: b.right, u: b.bottom };
    }
    return r;
  }

  function konsoleTourZeigen() {
    const s = kTourListe[kTourSchritt];
    if (!s) return;
    const offen = document.querySelector('.tabpage.active .subpage.on');
    const subJetzt = offen ? offen.id.replace(/^sub-/, '') : '';
    if ((s.tab && kAktiverTab() !== s.tab) || (s.sub || '') !== subJetzt) {
      kZurueckLaeuft = true;
      try { konsoleZeige(s.tab || kAktiverTab(), s.sub || ''); } finally { kZurueckLaeuft = false; }
    }
    $('k-tour-schritt').textContent = (kTourSchritt + 1) + ' / ' + kTourListe.length;
    if ($('k-tour-live')) { $('k-tour-live').hidden = true; $('k-tour-live').textContent = ''; }
    $('k-tour-taste').classList.remove('gedrueckt');
    $('k-tour-titel').textContent = t(s.titel);
    $('k-tour-text').textContent = t(s.text);
    // Eine Taste statt eines Bildes (Steuerung), sonst das Foto.
    $('k-tour-taste').hidden = !s.taste;
    $('k-tour-taste').textContent = s.taste || '';
    $('k-tour-bild').hidden = !!s.taste;
    if (!s.taste) $('k-tour-bild').src = 'img/' + s.bild + '.jpg';
    $('k-tour-zurueck').hidden = kTourSchritt === 0;
    const letzter = kTourSchritt === kTourListe.length - 1;
    $('k-tour-weiter').textContent = letzter
      ? (K_TOUR_ENDE.get(kTourListe) === 'bleiben' ? t('Fertig') : t('Los geht\'s')) + ' ▶' : t('Weiter') + ' ▶';
    // Erst malen lassen, dann messen: der Schirm ist eben erst gewechselt.
    setTimeout(konsoleTourSpot, 30);
    menuNavEnsureContext();
    const rows = menuNavRows();
    const iw = rows.findIndex((r) => r.el.id === 'k-tour-weiter');
    menuNavIndex = iw >= 0 ? iw : 0;
    menuNavGezeigt = true;
    menuNavRender();
  }

  function konsoleTourSpot() {
    if (!kTourOffen) return;
    const s = kTourListe[kTourSchritt];
    const spot = $('k-tour-spot'), karte = $('k-tour-karte'), d = $('k-tour');
    // Ein Ziel weiter unten auf einer langen Seite erst in die Sicht holen.
    const erstes = s.ziel && document.querySelector(s.ziel[0]);
    if (erstes) {
      const b = erstes.getBoundingClientRect();
      if (b.height && (b.bottom > innerHeight || b.top < 0)) erstes.scrollIntoView({ block: 'center' });
    }
    const r = kTourRechteck(s.ziel);
    d.classList.toggle('ohne-spot', !r);
    spot.hidden = !r;
    // Die Karte dorthin, wo das Ziel NICHT ist: darunter oder darueber, wenn dort Platz
    // ist, sonst daneben (eine hohe Kachel am Telefon laesst oben und unten nichts frei -
    // gesehen: die Karte lag ueber dem Knopf "Verbinden" der Kachel AUTOS).
    karte.classList.remove('oben', 'unten', 'links', 'rechts');
    // NIE UNTER DIE KOPFZEILE (gemeldet: "Boxen mit Text verschwinden unter der Navibar
    // ganz oben, bei Nr. 5 und 6"): oben beginnt die Karte unter dem Kopf.
    const kopf = $('k-kopf');
    const kopfUnten = kopf && kopf.offsetParent !== null ? kopf.getBoundingClientRect().bottom : 0;
    karte.style.top = '';
    if (!r) { karte.classList.add('unten'); return; }
    const rand = 4;
    spot.style.left = (r.l - rand) + 'px';
    spot.style.top = (r.o - rand) + 'px';
    spot.style.width = (r.r - r.l + 2 * rand) + 'px';
    spot.style.height = (r.u - r.o + 2 * rand) + 'px';
    const h = karte.offsetHeight + 16;
    if (innerHeight - r.u >= h) karte.classList.add('unten');
    else if (r.o - kopfUnten >= h) { karte.classList.add('oben'); karte.style.top = (kopfUnten + 6) + 'px'; }
    else karte.classList.add(r.l > innerWidth - r.r ? 'links' : 'rechts');
  }

  (() => {
    const kn = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    kn('k-tutorial-start', (e) => { e.stopPropagation(); tutorialStarten(); });
    kn('k-steuerung-start', (e) => { e.stopPropagation(); konsoleTourStart(K_STEUERUNG); });
    kn('k-starten-start', (e) => { e.stopPropagation(); konsoleTitelWeiter(); });
    // v1.0.45 BESTELLT: "in den Optionen eine extra Kachel mit Tutorials" - jede Kachel in
    // der Liste startet ihre Fuehrung auf dem passenden Schirm.
    const K_TOUREN = { steuerung: K_STEUERUNG, editor: K_EDITOR, raum: K_RAUM,
                       safety: K_SAFETY, meister: K_MEISTER, time: K_TIMEATTACK, challenges: K_CHALLENGES };
    document.querySelectorAll('.tut-knopf').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (K_TOUREN[el.dataset.tour]) konsoleTourStart(K_TOUREN[el.dataset.tour]); else tutorialStarten();
      });
    });
    kn('k-tour-weiter', () => konsoleTourWeiter());
    kn('k-tour-zurueck', () => konsoleTourZurueck());
    kn('k-tour-ende', () => konsoleTourZu(false));
    window.addEventListener('resize', () => { if (kTourOffen) konsoleTourSpot(); });
  })();


  // ============================ GEFUEHRTES TUTORIAL (v1.3.15, ohne WIP seit v1.3.31) =====
  //
  // BESTELLT: "Tutorial von Grund auf ueberarbeiten: mit freundlicher Frauenstimme und
  // Heranfuehrung an Funktionen. Fange an mit einer Willkommensnachricht ... Dafuer muss nur
  // ein Auto und Gamepad verbunden sein. Dann Gas, Bremse, Lenken nacheinander erklaeren und
  // jeweils warten, bis die Taste gedrueckt wurde ... Erstmal Arcade als Steuerungsmodus, dann
  // nach X Sekunden 'Nun wird ein realistischeres Einlenken simuliert', dann Beschleunigung,
  // Untersteuern. Dann Tankvorgang initiieren und Minigame erklaeren. Dann Motorsound aendern
  // ... Abschlussansage ... und zurueck ins Menue automatisch. Sollte insgesamt max. 3 min dauern."
  //
  // Eine Zustandsmaschine im Cockpit. Phasen: 'warten' (Auto oder Gamepad fehlen noch: Hinweis
  // gesprochen und als Text), 'lauf' (TUT_SCHRITTE der Reihe nach), danach zurueck ins Menue.
  // Jeder Schritt: beim Betreten eine Aktion (vorher), dann der Clip, dann - falls `warte` -
  // die Wartebedingung mit Zeitlimit `s` (laeuft ab dem Clipende; wer schon waehrend des Clips
  // drueckt, zaehlt). `min` ist die Mindestdauer ab Beginn des Schritts (Fahrzeit), `lob` ein
  // kurzer Clip nach erfuellter Bedingung. Ein abgelaufenes Limit geht ohne Lob weiter; den
  // Boxenstopp loest das Tutorial dann selbst aus.
  //
  // LAST: ein Takt alle TUT_TAKT_MS (100 ms) per setTimeout, nicht im 45-ms-Herzschlag. Die
  // Tasten liest er ueber die vorhandene Belegung (readBindingValue auf demselben Pad, das
  // pollGamepad faehrt); gefahren wird ganz normal ueber pollGamepad, das Tutorial verbraucht
  // keine Taste.
  //
  // ABBRUCH: im Cockpit Options oder Esc (beide fuehren ins Menue; wer das Cockpit verlaesst,
  // beendet das Tutorial), vorher Kreis oder Esc (konsoleZurueck), jederzeit der Knopf "Beenden".
  // Fahrgefuehl, Motorklang und Boxeneinstellungen werden vorher gesichert und am Ende oder beim
  // Abbruch wiederhergestellt.
  //
  // STIMME: Piper de_DE-kerstin-low (tools/voice_tutorial.py, audio/tutorial.json). Fuer Englisch
  // und Spanisch gibt es ohne neuen Download keine Piper-Frauenstimme: dort spricht
  // speechSynthesis den uebersetzten Text (falls das Geraet eine Stimme hat), sonst bleibt es
  // beim Text. Fehlt ein Clip, steht der Text so lange da, wie man zum Lesen braucht.

  // Wortlaut der Clips, derselbe wie TEXTE in tools/voice_tutorial.py (der Selbsttest vergleicht).
  // Das ist der ANZEIGETEXT. Piper bekommt einen eigenen Sprechtext (SPRECH im Werkzeug, "sprech" im
  // Manifest) mit Lautschreibung fuer englische Woerter. GEMELDET: "'Tutorial / App' wird deutsch
  // ausgesprochen. Nimm dann lieber deutsche Begriffe 'Einfuehrung' und 'Aepp'."
  const TUT_SPRUCH = {
    voraussetzung: 'Für die Einführung brauchst du ein verbundenes Auto und ein Gamepad. Ich warte, bis beides bereit ist.',
    willkommen: 'Willkommen bei OmegaSim! In dieser Einführung lernst du die App kennen und drehst deine ersten Runden.',
    gas: 'Drücke die Gas-Taste, um zu beschleunigen.',
    bremse: 'Drücke jetzt die Bremstaste, um zu bremsen.',
    links: 'Lenke nach links.',
    rechts: 'Und jetzt nach rechts.',
    gut: 'Sehr gut!',
    prima: 'Prima!',
    arcade: 'Fahr jetzt ein paar Runden im Arcade-Modus. Das Auto lenkt direkt ein und bremst kräftig.',
    pacejka: 'Nun wird ein realistischeres Einlenken simuliert.',
    beschleunigung: 'Das Auto beschleunigt jetzt langsamer, wie ein echter Rennwagen.',
    untersteuern: 'Fährst du zu schnell in eine Kurve, schiebt das Auto geradeaus. Das ist Untersteuern. Bremse also vor der Kurve.',
    box_erklaerung: 'Zeit für einen Boxenstopp. Gleich erscheinen Tasten auf dem Schirm. Drückst du sie schnell und richtig, ist die Crew schneller.',
    box: 'Tippe jetzt die Boxenstopp-Taste und halte an.',
    box_fertig: 'Die Regenreifen sind drauf. Fahr weiter.',
    motor: 'Der Motorsound wird nun geändert zu Ford Mustang.',
    garage: 'Im Garagenmenü passt du den Motorsound für jedes Auto einzeln an.',
    optionen: 'Ansagen, Tastenbelegung, Fahrverhalten und vieles mehr stellst du im Optionenmenü ein.',
    abschluss: 'Du hast die Einführung abgeschlossen. Herzlich willkommen bei OmegaSim!',
    // v1.3.31 (nach 1.3.30) BESTELLT: "Wenn ein Auto verbunden ist, aber nicht als [Spieler 1], weise
    // darauf hin, dass ich die Rolle in der Garage fuer das Auto aendern muss. Lass mich waehlen, ob ich
    // das Tutorial mit Bahn oder auf dem Boden mache. Fuege noch ein, dass ich das Licht aus- und
    // einschalte am Anfang. Nach dem Boxenstopp aendere das Wetter, lasse mich die Reifeneinstellung zu
    // Regen wechseln, und noch einen Stopp machen. Dann den Abschlusstext. WIP-Label dann weg."
    rolle: 'Dein Auto ist verbunden, hat aber nicht die Rolle Spieler 1. Stelle sie in der Garage auf Spieler 1.',
    modus_frage: 'Fährst du auf der Bahn oder auf dem Boden? Wähle mit dem Steuerkreuz und bestätige.',
    modus_bahn: 'Gut, wir fahren auf der Bahn.',
    modus_boden: 'Gut, wir fahren auf dem Boden, ohne Streckenteile.',
    licht: 'Schalte das Licht mit der Licht-Taste aus und wieder ein.',
    arcade_boden: 'Fahr jetzt ein wenig herum, im Arcade-Modus. Das Auto lenkt direkt ein und bremst kräftig.',
    regen: 'Jetzt fängt es an zu regnen. Mit Trockenreifen rutscht das Auto viel mehr.',
    reifen: 'Wähle für den Boxenstopp Regenreifen. Drücke dazu die Reifen-Taste, bis Regen angezeigt wird.',
    // v1.3.66 (nach 1.3.65) BESTELLT: "nur 1x Pitstop und zwar erst Regen, dabei kurz warten, damit die
    // Stimme sich nicht mit 'es regnet' ueberlagert. Dafuer vorher noch Rueckwaertsgang erklaeren und am
    // Ende manuelle Gangschaltung."
    rueckwaerts: 'Jetzt fährst du rückwärts. Halte an, drücke die Runterschalt-Taste und gib dann Gas.',
    vorwaerts: 'Mit der Hochschalt-Taste geht es wieder vorwärts.',
    schalten: 'Jetzt schaltest du selbst, die Automatik ist aus. Schalte mit der Hochschalt-Taste einen Gang hoch.',
    runter: 'Und mit der Runterschalt-Taste wieder einen Gang runter.',
    automatik: 'Ab jetzt schaltet wieder die Automatik.',
  };
  // zeige: Text auf dem Schirm, {taste} = Tastenname aus der aktuellen Belegung (Aktion `taste`).
  // Die Clips sprechen generisch ("die Gas-Taste"), denn sie koennen nicht jede Belegung abdecken.
  // modus: nur auf der Bahn ('bahn') oder nur auf dem Boden ('boden'). box: Teil eines Boxenstopps
  // (steht/spiel/fertig), uebersprungen, wenn es dazu nichts zu tun gibt.
  const TUT_SCHRITTE = [
    { id: 'willkommen', titel: 'Willkommen bei OmegaSim', clip: 'willkommen' },
    // Bahn oder Boden: Steuerkreuz und Kreuz/A, Maus, Finger, Pfeiltasten und Enter. Ohne Wahl
    // bleibt es nach dem Limit bei der eingestellten Fahrweise.
    { id: 'modus', titel: 'Bahn oder Boden?', clip: 'modus_frage', taste: 'dpad',
      zeige: 'Wähle mit {taste} und bestätige mit ✕ / A. Maus, Finger und Pfeiltasten gehen auch.',
      warte: 'wahl', s: 8 },
    { id: 'modus_bahn', titel: 'Mit Bahn', clip: 'modus_bahn', modus: 'bahn' },
    { id: 'modus_boden', titel: 'Auf dem Boden', clip: 'modus_boden', modus: 'boden' },
    { id: 'gas', titel: 'Gas geben', clip: 'gas', taste: 'throttle', zeige: 'Drücke {taste}, um zu beschleunigen.',
      warte: 'gas', s: 6, lob: 'gut' },
    { id: 'bremse', titel: 'Bremsen', clip: 'bremse', taste: 'brake', zeige: 'Drücke {taste}, um zu bremsen.',
      warte: 'bremse', s: 6, lob: 'prima' },
    { id: 'links', titel: 'Lenken', clip: 'links', taste: 'steering', zeige: 'Lenke mit {taste} nach links.',
      warte: 'links', s: 6 },
    { id: 'rechts', titel: 'Lenken', clip: 'rechts', taste: 'steering', zeige: 'Und jetzt mit {taste} nach rechts.',
      warte: 'rechts', s: 6, lob: 'gut' },
    { id: 'licht', titel: 'Licht', clip: 'licht', taste: 'headlights',
      zeige: 'Schalte das Licht mit {taste} aus und wieder ein.', warte: 'licht', s: 6, lob: 'gut' },
    // "nach X Sekunden": 20 s Arcade ab Beginn des Schritts (der Clip zaehlt mit).
    { id: 'arcade', titel: 'Fahrgefühl: Arcade', clip: 'arcade', min: 20, modus: 'bahn' },
    { id: 'arcade_boden', titel: 'Fahrgefühl: Arcade', clip: 'arcade_boden', min: 20, modus: 'boden' },
    { id: 'pacejka', titel: 'Fahrgefühl: Pacejka', clip: 'pacejka', vorher: 'pacejka' },
    { id: 'beschleunigung', titel: 'Beschleunigung', clip: 'beschleunigung', min: 6 },
    { id: 'untersteuern', titel: 'Untersteuern', clip: 'untersteuern', min: 10 },
    // Rueckwaertsgang, wie er mit den Einstellungen der Einfuehrung (Pacejka, Automatik) geht:
    // im Stand die Runterschalt-Taste legt R ein (40-physics.js triggerShift), Gas faehrt rueckwaerts,
    // die Hochschalt-Taste legt wieder vorwaerts ein. Ist "Rueckwaerts mit Gas und Bremse" an, nennt
    // die Karte das zusaetzlich.
    { id: 'rueckwaerts', titel: 'Rückwärtsgang', clip: 'rueckwaerts', taste: 'downshift',
      zeige: 'Halte an, drücke {taste} (Rückwärtsgang) und gib dann Gas.', warte: 'rueck', s: 8, lob: 'gut' },
    { id: 'vorwaerts', titel: 'Vorwärts', clip: 'vorwaerts', taste: 'upshift',
      zeige: 'Mit {taste} geht es wieder vorwärts.', warte: 'vorwaerts', s: 6, nurRueck: true },
    // EIN Boxenstopp, und zwar erst im Regen: Wetter umstellen, warten, bis die App-eigene
    // Regen-Ansage (Ansagen-Schalter Regen) gesprochen ist (ruhe), dann Regenreifen waehlen und der
    // Stopp, der sie aufzieht.
    { id: 'regen', titel: 'Regen', clip: 'regen', vorher: 'regen', ruhe: true },
    { id: 'reifen', titel: 'Regenreifen', clip: 'reifen', taste: 'tyreSelect',
      zeige: 'Drücke {taste}, bis als Reifenwahl „Regen“ angezeigt wird.', warte: 'reifen', s: 8, lob: 'prima' },
    { id: 'box_erklaerung', titel: 'Boxenstopp', clip: 'box_erklaerung', taste: 'spiel',
      zeige: 'Zeit für einen Boxenstopp. Gleich erscheinen vier Tasten auf dem Schirm ({taste}). Drückst du sie schnell und richtig, ist die Crew schneller.' },
    { id: 'box', titel: 'Boxenstopp', clip: 'box', taste: 'yellowflag', zeige: 'Tippe {taste} (Boxenstopp) und halte an.',
      warte: 'box_an', s: 10 },
    { id: 'box_steht', titel: 'Boxenstopp', zeige: 'Halte an. Die Crew beginnt, sobald das Auto steht.',
      warte: 'box_steht', s: 6, box: 'steht' },
    { id: 'box_spiel', titel: 'Boxen-Minispiel', taste: 'spiel', zeige: 'Drücke die vier Tasten der Reihe nach ({taste}).',
      warte: 'box_fertig', s: 12, box: 'spiel' },
    { id: 'box_fertig', titel: 'Regenreifen', clip: 'box_fertig', box: 'fertig' },
    // Handschaltung: Automatik aus, einmal hoch, einmal runter, Automatik wieder an.
    { id: 'schalten', titel: 'Selbst schalten', clip: 'schalten', vorher: 'manuell', taste: 'upshift',
      zeige: 'Die Automatik ist aus. Schalte mit {taste} einen Gang hoch.', warte: 'hoch', s: 6 },
    { id: 'runter', titel: 'Selbst schalten', clip: 'runter', taste: 'downshift',
      zeige: 'Und mit {taste} wieder einen Gang runter.', warte: 'runter', s: 6, lob: 'gut' },
    { id: 'automatik', titel: 'Automatik', clip: 'automatik', vorher: 'automatik' },
    { id: 'motor', titel: 'Motorsound', clip: 'motor', vorher: 'motor', min: 4 },
    { id: 'garage', titel: 'Garage', clip: 'garage' },
    { id: 'optionen', titel: 'Optionen', clip: 'optionen' },
    { id: 'abschluss', titel: 'Geschafft', clip: 'abschluss' },
  ];
  const TUT_TAKT_MS = 100;
  const TUT_LUECKE_S = 0.3;      // Pause nach jedem Clip
  const TUT_LADE_MS = 4000;      // so lange wartet der Start hoechstens auf die Clips
  // Vor dem Regen-Clip: mindestens so lange warten, dass die App-eigene Regen-Ansage (Pruefung
  // alle 500 ms, 70-race.js) anfangen kann, und hoechstens so lange, bis sie fertig ist.
  const TUT_RUHE_MIN_S = 1.2, TUT_RUHE_MAX_S = 4;
  // Bis 1.3.30: "insgesamt max. 3 min". Mit Licht, Wahl, Regen, Regenreifen und zweitem Stopp
  // (v1.3.31): "halte es so knapp wie moeglich (Zielwert <= 4 min inkl. Zeitlimits)". Seit v1.3.66
  // ein Stopp statt zwei, dafuer Rueckwaertsgang und Handschaltung: weiter hoechstens 4 min.
  const TUT_MAX_S = 240;
  const TUT_SCHWELLE = 0.5;      // Gas, Bremse, Lenkausschlag
  // Ziel des Motorklang-Schritts. Die Ansage sagt "Ford Mustang"; steht schon der Mustang v2
  // drin, wird es der gerechnete Mustang.
  const TUT_MOTOR = 'mustang2v';
  const TUT_MOTOR_ERSATZ = 'mustang';

  // Wie lange ein Schritt hoechstens dauert (Clip, Mindestdauer, Zeitlimit, Lob). `dauer` sind
  // die Clipdauern aus dem Manifest. Der Selbsttest prueft die Summe gegen TUT_MAX_S.
  // `modus`: 'bahn' oder 'boden' (ohne Angabe: der laengere der beiden Wege).
  function tutBudget(dauer, modus) {
    if (!modus) return Math.max(tutBudget(dauer, 'bahn'), tutBudget(dauer, 'boden'));
    const d = (k) => (k && dauer && dauer[k] > 0 ? dauer[k] + TUT_LUECKE_S : 0);
    return TUT_SCHRITTE.filter((s) => !s.modus || s.modus === modus)
      .reduce((sum, s) => sum + Math.max(d(s.clip) + (s.ruhe ? TUT_RUHE_MAX_S : 0), s.min || 0) + (s.s || 0) + d(s.lob), 0);
  }

  // ---- Tastennamen aus der aktuellen Belegung ----
  const TUT_KNOPF = { 0: '✕ / A', 1: '○ / B', 2: '□ / X', 3: '△ / Y', 4: 'L1 / LB', 5: 'R1 / RB', 6: 'L2 / LT',
    7: 'R2 / RT', 8: 'Share / Back', 9: 'Options / Start', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶' };
  const TUT_ACHSE = { 0: 'Linker Stick', 1: 'Linker Stick', 2: 'Rechter Stick', 3: 'Rechter Stick' };
  function tutTasteName(aktion) {
    if (aktion === 'spiel') return tutTasteName('downshift') + ' ' + t('oder') + ' ' + tutTasteName('upshift');
    if (aktion === 'dpad') return '◀ ▶';
    const b = typeof bindings !== 'undefined' && bindings ? bindings[aktion] : null;
    // Licht ohne Pad-Taste: der Lichtschalter im Cockpit (#dash-head-toggle) geht immer.
    if (aktion === 'headlights' && (!b || b.type === 'none' || !(b.index >= 0))) return t('Licht-Schalter im Cockpit');
    if (!b || b.type === 'none' || !(b.index >= 0)) return t('nicht belegt');
    if (b.type === 'button' && TUT_KNOPF[b.index]) return TUT_KNOPF[b.index];
    if (b.type === 'axis' && TUT_ACHSE[b.index]) return t(TUT_ACHSE[b.index]);
    return t(b.label || ('#' + b.index));
  }

  // ---- Die echte Umgebung. Der Selbsttest ersetzt Teile davon durch Attrappen. ----
  function tutPad() {
    if (typeof padsFuerSpieler !== 'function') return null;
    let p = padsFuerSpieler().p1;
    if (p && typeof padNativ === 'function') p = padNativ(p);
    return p || null;
  }
  let tutVoiceGain = null, tutQuelle = null;
  const tutBuffers = new Map();
  let tutManifest = null, tutLadenLaeuft = null, tutSprache = null;
  // Wie die Rennintro-Clips (80d-rennintro.js): Manifest, dann hoechstens sechs Downloads
  // gleichzeitig. Ein fehlender Clip laesst nur seinen Ton aus. Seit 1.3.94 gibt es auch
  // englische Clips (audio/tutorial.json, Abschnitt "en"); ohne sie bleibt es bei speechSynthesis.
  function tutClipsLaden() {
    if (tutLadenLaeuft) return tutLadenLaeuft;
    tutLadenLaeuft = (async () => {
      try {
        if (!tutManifest) {
          const res = await fetch('audio/tutorial.json');
          if (!res.ok) throw new Error('tutorial.json HTTP ' + res.status);
          tutManifest = await res.json();
        }
        if (!audioCtx && typeof initEngineSound === 'function') initEngineSound();
        if (!audioCtx) return;
        // Sprache der Clips: de (Kerstin) oder en (falls vorhanden). Wechselt die Sprache,
        // werden die alten Puffer verworfen und die neuen geladen.
        const sp = (lang === 'en') ? 'en' : 'de';
        if (tutSprache !== sp) { tutBuffers.clear(); tutSprache = sp; }
        const katalog = tutManifest[sp] || {};
        const keys = Object.keys(TUT_SPRUCH).filter((k) => !tutBuffers.has(k) && katalog[k]);
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(6, keys.length) }, async () => {
          while (i < keys.length) {
            const k = keys[i++];
            try {
              const r = await fetch('audio/' + katalog[k].datei);
              if (!r.ok) throw new Error('HTTP ' + r.status);
              tutBuffers.set(k, await audioCtx.decodeAudioData(await r.arrayBuffer()));
            } catch (e) { log('Tutorial: Clip ' + k + ' nicht ladbar (' + e.message + '), der Text bleibt stehen.', 'info'); }
          }
        }));
      } catch (e) {
        log('Tutorial: Aufnahmen nicht ladbar (' + e.message + '), nur Text.', 'info');
      } finally {
        tutLadenLaeuft = null;
        tut.geladen = true;
      }
    })();
    return tutLadenLaeuft;
  }
  function tutVerstummen() {
    if (tutQuelle) {
      tutQuelle.onended = null;
      try { tutQuelle.stop(); } catch (e) { /* schon aus */ }
      tutQuelle = null;
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ohne Sprachausgabe */ }
  }
  // Lesedauer, wenn nichts gesprochen wird: rund 15 Zeichen je Sekunde, mindestens 2 s.
  function tutLesedauer(text) { return Math.max(2, String(text || '').length / 15); }
  // Spielt einen fertigen Clip (de oder en) und liefert dessen Dauer in Sekunden, sonst null.
  function tutClipAbspielen(buf) {
    try {
      if (audioCtx.state !== 'running') audioCtx.resume();
      if (!tutVoiceGain || tutVoiceGain.context !== audioCtx) {
        tutVoiceGain = audioCtx.createGain();
        tutVoiceGain.gain.value = 1.0;
        tutVoiceGain.connect(audioCtx.destination);
      }
      const q = audioCtx.createBufferSource();
      q.buffer = buf;
      q.connect(tutVoiceGain);
      q.onended = () => { if (tutQuelle === q) { tutQuelle = null; tutClipFertig(); } };
      q.start(audioCtx.currentTime + 0.02);
      tutQuelle = q;
      return buf.duration + 0.02;
    } catch (e) { return null; }
  }
  // Spricht `key` und gibt die Dauer in Sekunden zurueck (bei speechSynthesis geschaetzt; das
  // Ende kuerzt den Schritt dann ueber tutClipFertig()).
  function tutSprechenEcht(key) {
    const de = TUT_SPRUCH[key] || '';
    tutVerstummen();
    if (typeof soundEnabled !== 'undefined' && !soundEnabled) return tutLesedauer(t(de));
    // DE und EN: fertige Aufnahme, aber nur aus dem Satz der eigenen Sprache (tutSprache) - nach einem
    // Sprachwechsel lagen bis 1.3.131 noch die Clips der anderen Sprache im Speicher.
    if (lang === 'de' || lang === 'en') {
      const buf = tutSprache === lang ? tutBuffers.get(key) : null;
      if (buf && audioCtx) {
        const d = tutClipAbspielen(buf);
        if (d !== null) return d;
      }
      // Deutsch ohne Clip bleibt still wie bis 1.3.92 (der Text steht da): die Geraetestimme las den
      // deutschen Satz sonst mit en-US-Stimme oder mit einer ganz anderen Stimme als Kerstin vor.
      if (lang === 'de') return tutLesedauer(de);
    }
    // EN ohne Clip / ES: Geraetestimme, eine weibliche, wenn sie sich am Namen erkennen laesst.
    const text = t(de);
    try {
      const ss = window.speechSynthesis;
      if (!ss || typeof SpeechSynthesisUtterance !== 'function') return tutLesedauer(text);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'es' ? 'es-ES' : 'en-US';
      const stimmen = (ss.getVoices() || []).filter((v) => (v.lang || '').toLowerCase().startsWith(lang));
      u.voice = stimmen.find((v) => /female|zira|aria|jenny|samantha|susan|hazel|libby|helena|laura|elvira|monica|paulina|lucia|sabina/i.test(v.name))
        || stimmen[0] || null;
      u.onend = () => tutClipFertig();
      ss.speak(u);
      return text.length / 11 + 1;
    } catch (e) { return tutLesedauer(text); }
  }
  // Boxeneinstellungen, die der Stopp im Tutorial braucht: Knopf statt Doppelausdruck (der
  // lehnt den Knopf ab), ueberall halten (nicht nur neben der Bahn), Minispiel an.
  function tutBoxMerken() { return { an: pitLaneEnabled, trig: pitTrigger, modus: pitModus }; }
  function tutBoxVorbereiten() { pitLaneEnabled = true; pitTrigger = 'anywhere'; pitModus = 'minigame'; }
  function tutBoxZurueck(m) {
    if (!m) return;
    pitLaneEnabled = m.an; pitTrigger = m.trig; pitModus = m.modus;
    if (!pitLaneEnabled && pitState !== 'off') setPitState('off');
  }
  function tutPresetMerken() { return { regler: presetRead(), zuletzt: presetZuletzt }; }
  function tutPresetZurueck(m) {
    if (!m) return;
    for (const [id, val] of Object.entries(m.regler)) presetSet(id, val);
    setzeBrakeStealLast();
    setzeGran();
    presetZuletzt = m.zuletzt;
    try {
      if (m.zuletzt) localStorage.setItem(PRESET_ZULETZT_STORE, m.zuletzt);
      else localStorage.removeItem(PRESET_ZULETZT_STORE);
    } catch (e) { /* privat */ }
    if (typeof renderPresetLegende === 'function') renderPresetLegende();
  }
  // Bahn oder Boden: derselbe Schalter wie FAHREN > Strecke (#setting-ontrack, 50-drive.js). Aus
  // ist das Fahren auf dem Boden ohne Streckenteile (trackMode 'off', keine Bahnerkennung).
  function tutBahnSetzen(an) {
    const cb = $('setting-ontrack');
    if (!cb || cb.checked === !!an) return;
    cb.checked = !!an;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Licht wie die Licht-Taste im Cockpit (pollGamepad): Merker und Schalter gemeinsam.
  function tutLichtSetzen(an) {
    headlightsOn = !!an;
    const cb = $('dash-head-toggle');
    if (cb) cb.checked = headlightsOn;
  }
  function tutReifenMerken() { return { tyres, wunsch: mischungWunsch }; }
  function tutReifenZurueck(m) {
    if (!m) return;
    mischungWunsch = m.wunsch;
    if (tyres !== m.tyres) { tyres = m.tyres; applySurface(); }
  }
  function tutMotorSetzen(v) {
    const sel = $('sound-profile');
    if (!sel || !v || sel.value === v) return;
    if (![...sel.options].some((o) => o.value === v)) return;
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const TUT_ECHT = {
    jetzt: () => performance.now(),
    laden: () => { tutClipsLaden(); },
    bereit: () => tut.geladen || tut.umg.jetzt() - tut.startAb > TUT_LADE_MS,
    autoDa: () => {
      if (typeof playerCar === 'undefined' || !playerCar) return false;
      const g = playerCar.device && playerCar.device.gatt;
      return !g || g.connected !== false;
    },
    // Ein Auto ist verbunden, aber keines hat die Rolle Spieler 1 (NPC, Safety Car, Aus ...).
    autoVerbunden: () => typeof garage !== 'undefined' && garage.length > 0,
    padDa: () => !!tutPad(),
    eingaben: () => {
      const p = tutPad();
      if (!p || typeof bindings === 'undefined') return { gas: 0, bremse: 0, lenk: 0 };
      const w = (b) => (b ? readBindingValue(p, b) || 0 : 0);
      return { gas: Math.max(0, w(bindings.throttle)), bremse: Math.max(0, w(bindings.brake)), lenk: w(bindings.steering) };
    },
    tab: () => kAktiverTab(),
    insFahren: () => konsoleZeige('fahren'),
    insCockpit: () => konsoleInsCockpit(false),
    insMenue: () => { if (kAktiverTab() === 'race') konsoleZumMenue(true); },
    presetMerken: tutPresetMerken,
    presetSetzen: (key) => applyPreset(key),
    presetZurueck: tutPresetZurueck,
    motorLesen: () => ($('sound-profile') ? $('sound-profile').value : ''),
    motorSetzen: tutMotorSetzen,
    boxMerken: tutBoxMerken,
    boxVorbereiten: tutBoxVorbereiten,
    boxZurueck: tutBoxZurueck,
    boxZustand: () => pitState,
    boxAnfordern: () => { if (pitState === 'off') requestPitStop(); },
    boxAbbrechen: () => { if (pitState === 'limited') requestPitStop(); },
    bahnLesen: () => !!($('setting-ontrack') || {}).checked,
    bahnSetzen: tutBahnSetzen,
    lichtLesen: () => !!headlightsOn,
    lichtSetzen: tutLichtSetzen,
    wetterLesen: () => weather,
    wetterSetzen: (w) => setWeather(w),
    reifenMerken: tutReifenMerken,
    reifenZurueck: tutReifenZurueck,
    reifenWahl: () => pitMischungWahl(),
    reifenWahlSetzen: (m) => { mischungWunsch = m; },
    // Gang als Zahl: -1 rueckwaerts, 0 Leerlauf, 1.. vorwaerts.
    gang: () => { const st = physEngine.state; return st.driveMode === 'reverse' ? -1 : st.driveMode === 'neutral' ? 0 : st.currentGear + 1; },
    rueckFaehrt: () => physEngine.state.driveMode === 'reverse' && Math.abs(physEngine.state.speedKmh) > 0.3,
    vorwaertsSetzen: () => { if (physEngine.state.driveMode === 'reverse') physEngine.triggerShift(1); },
    gasBremseRueck: () => typeof gasBremseAn === 'function' && gasBremseAn(),
    automatikSetzen: (an) => {
      const cb = $('setting-autoshift');
      if (!cb || cb.checked === !!an) return;
      cb.checked = !!an;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    },
    // Spricht oder klingt gerade eine Ansage der App (Ansagen-Schlange, Rundenzeit, Rennstand)?
    ansageBeschaeftigt: () => !!((typeof ansagenWarten === 'function' && ansagenWarten())
      || (typeof lapAnsageBeschaeftigt === 'function' && lapAnsageBeschaeftigt())
      || (typeof rennstandBeschaeftigt === 'function' && rennstandBeschaeftigt())),
    sprechen: tutSprechenEcht,
    verstummen: tutVerstummen,
  };

  // ---- Zustand ----
  const tut = { an: false, phase: 'aus', i: -1, schrittAb: 0, clipBis: 0, warteAb: null, erfuellt: false,
    lobDran: false, boxService: false, umg: TUT_ECHT, merk: null, timer: null, startAb: 0, geladen: false,
    hinweise: [], protokoll: [], ende: '', modus: null, wahl: 'bahn', wahlAktiv: false, wahlSperre: false,
    wahlPadVorher: null, lichtVorher: null, lichtWechsel: 0, gangVorher: null, ruheAus: true };
  function tutLaeuft() { return tut.an; }
  function tutWahlOffen() { return tut.an && (tut.wahlAktiv || tut.wahlSperre); }
  function tutSchrittId() { return tut.phase === 'lauf' && TUT_SCHRITTE[tut.i] ? TUT_SCHRITTE[tut.i].id : tut.phase; }

  // opts.umgebung: Attrappen (Selbsttest); opts.ohneTimer: der Test taktet selbst (tutTick).
  function tutorialStarten(opts) {
    const o = opts || {};
    if (tut.an) tutAbbrechen('Neustart');
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) konsoleTourZu(false);
    tut.umg = Object.assign({}, TUT_ECHT, o.umgebung || {});
    Object.assign(tut, { an: true, phase: 'warten', i: -1, clipBis: 0, warteAb: null, erfuellt: false, lobDran: false,
      boxService: false, merk: null, startAb: tut.umg.jetzt(), geladen: false, hinweise: [],
      protokoll: [], ende: '', modus: null, wahl: 'bahn', wahlAktiv: false, wahlSperre: false, wahlPadVorher: null,
      lichtVorher: null, lichtWechsel: 0, gangVorher: null, ruheAus: true });
    tut.umg.laden();
    if (tut.umg.tab() === 'home') tut.umg.insFahren();
    const ui = $('tut-ui');
    if (ui) ui.hidden = false;
    tutTick();
    if (!o.ohneTimer) tutTakt();
  }
  function tutTakt() {
    clearTimeout(tut.timer);
    tut.timer = setTimeout(() => { tutTick(); if (tut.an) tutTakt(); }, TUT_TAKT_MS);
  }
  function tutClipFertig() {
    if (tut.an) tut.clipBis = Math.min(tut.clipBis, tut.umg.jetzt());
  }
  function tutSprich(key) {
    const s = tut.umg.sprechen(key, TUT_SPRUCH[key]);
    const dauer = Number.isFinite(s) && s > 0 ? s : tutLesedauer(TUT_SPRUCH[key]);
    tut.clipBis = tut.umg.jetzt() + (dauer + TUT_LUECKE_S) * 1000;
  }
  function tutFehlt() {
    const f = [];
    if (!tut.umg.autoDa()) f.push(tut.umg.autoVerbunden() ? 'rolle' : 'auto');
    if (!tut.umg.padDa()) f.push('pad');
    return f;
  }

  function tutTick() {
    if (!tut.an) return;
    const u = tut.umg, jetzt = u.jetzt();
    if (tut.phase === 'warten') {
      // Wer zum Titel geht, ist raus.
      if (u.tab() === 'home') { tutAbbrechen('Titel'); return; }
      const fehlt = tutFehlt();
      if (!u.bereit()) { tutVoraussetzungZeigen(fehlt); return; }
      if (fehlt.length) {
        // Jeder Hinweis einmal, und nicht in einen laufenden hinein: erst "Auto und Gamepad",
        // spaeter (Auto verbunden, falsche Rolle) der Rollen-Hinweis.
        const hinweis = fehlt.includes('rolle') ? 'rolle' : 'voraussetzung';
        if (!tut.hinweise.includes(hinweis) && jetzt >= tut.clipBis) { tut.hinweise.push(hinweis); tutSprich(hinweis); }
        tutVoraussetzungZeigen(fehlt);
        return;
      }
      // Alles da: sichern, Arcade, ins Cockpit, los.
      u.verstummen();
      tut.merk = { preset: u.presetMerken(), motor: u.motorLesen(), box: u.boxMerken(), bahn: u.bahnLesen(),
        licht: u.lichtLesen(), wetter: u.wetterLesen(), reifen: u.reifenMerken() };
      u.presetSetzen('arcade');
      u.boxVorbereiten();
      u.insCockpit();
      tut.phase = 'lauf';
      tutSchritt(0);
      return;
    }
    if (tut.phase !== 'lauf') return;
    if (u.tab() !== 'race') { tutAbbrechen('Cockpit verlassen'); return; }
    const s = TUT_SCHRITTE[tut.i];
    if (s.warte && !tut.erfuellt && tutBedingung(s.warte)) {
      tut.erfuellt = true;
      const el = $('tut-taste');
      if (el) el.classList.add('gedrueckt');
    }
    // Erst still sein, bis die Regen-Ansage der App durch ist (hoechstens TUT_RUHE_MAX_S).
    if (s.ruhe && !tut.ruheAus) {
      const seit = jetzt - tut.schrittAb;
      if (seit < TUT_RUHE_MIN_S * 1000 || (seit < TUT_RUHE_MAX_S * 1000 && u.ansageBeschaeftigt())) return;
      tut.ruheAus = true;
      if (s.clip) tutSprich(s.clip);
      return;
    }
    if (jetzt < tut.clipBis) return;
    if (jetzt < tut.schrittAb + (s.min || 0) * 1000) return;
    if (s.warte && !tut.erfuellt) {
      if (tut.warteAb === null) tut.warteAb = jetzt;
      if (jetzt - tut.warteAb < (s.s || 0) * 1000) return;
      // Zeitlimit: weiter ohne Lob. Den Boxenstopp loest das Tutorial dann selbst aus, und ein
      // Auto, das nicht anhaelt, faehrt nicht mit dem Boxenbegrenzer weiter.
      if (s.warte === 'box_an') u.boxAnfordern();
      if (s.warte === 'box_steht') u.boxAbbrechen();
      // Keine Wahl: es bleibt bei der eingestellten Fahrweise. Keine Regenreifen gewaehlt: das
      // Tutorial waehlt sie, damit der zweite Stopp sie aufzieht.
      if (s.warte === 'wahl') tutWahlBestaetigen();
      if (s.warte === 'reifen') u.reifenWahlSetzen('regen');
      // Noch im Rueckwaertsgang: vorwaerts einlegen, sonst faehrt das Auto beim naechsten Gas zurueck.
      if (s.warte === 'vorwaerts') u.vorwaertsSetzen();
    } else if (s.lob && tut.erfuellt && !tut.lobDran) {
      tut.lobDran = true;
      tutSprich(s.lob);
      return;
    }
    tutSchritt(tut.i + 1);
  }

  function tutBedingung(w) {
    const u = tut.umg;
    if (w === 'box_an') return u.boxZustand() !== 'off';
    if (w === 'box_steht') {
      const steht = u.boxZustand() === 'servicing';
      if (steht) tut.boxService = true;
      return steht;
    }
    if (w === 'box_fertig') return u.boxZustand() !== 'servicing';
    if (w === 'wahl') return !!tut.modus;
    if (w === 'reifen') return u.reifenWahl() === 'regen';
    if (w === 'rueck') return u.rueckFaehrt();
    if (w === 'vorwaerts') return u.gang() >= 0;
    if (w === 'hoch' || w === 'runter') {
      // Ein Schaltvorgang in die verlangte Richtung, verglichen von Takt zu Takt.
      const g = u.gang();
      const ok = tut.gangVorher !== null && (w === 'hoch' ? g > tut.gangVorher : g < tut.gangVorher);
      tut.gangVorher = g;
      return ok;
    }
    if (w === 'licht') {
      // Aus UND wieder ein: zwei Wechsel, egal in welchem Zustand das Licht anfing.
      const l = u.lichtLesen();
      if (tut.lichtVorher !== null && l !== tut.lichtVorher) tut.lichtWechsel++;
      tut.lichtVorher = l;
      return tut.lichtWechsel >= 2;
    }
    const e = u.eingaben() || {};
    if (w === 'gas') return (e.gas || 0) >= TUT_SCHWELLE;
    if (w === 'bremse') return (e.bremse || 0) >= TUT_SCHWELLE;
    if (w === 'links') return (e.lenk || 0) <= -TUT_SCHWELLE;
    if (w === 'rechts') return (e.lenk || 0) >= TUT_SCHWELLE;
    return true;
  }
  // Schritte, die nichts zu tun haetten: kein Warten aufs Anhalten, wenn das Auto schon steht
  // (oder kein Stopp angefordert ist), kein Minispiel und kein "Fertig" ohne Stopp.
  function tutUeberspringen(s) {
    if (s.modus && s.modus !== tut.modus) return true;
    const z = tut.umg.boxZustand();
    if (z === 'servicing') tut.boxService = true;
    if (s.box === 'steht') return z !== 'limited';
    if (s.box === 'spiel') return z !== 'servicing';
    if (s.box === 'fertig') return !tut.boxService;
    if (s.nurRueck) return tut.umg.gang() !== -1;
    return false;
  }

  function tutSchritt(n) {
    while (n < TUT_SCHRITTE.length && tutUeberspringen(TUT_SCHRITTE[n])) n++;
    if (n >= TUT_SCHRITTE.length) { tutEnde(); return; }
    const u = tut.umg, s = TUT_SCHRITTE[n];
    Object.assign(tut, { i: n, schrittAb: u.jetzt(), clipBis: u.jetzt(), warteAb: null, erfuellt: false, lobDran: false });
    tut.protokoll.push(s.id);
    // Jeder Boxenstopp zaehlt fuer sich (der zweite nicht mit dem Service des ersten).
    if (s.warte === 'box_an') tut.boxService = false;
    if (s.warte === 'licht') { tut.lichtVorher = u.lichtLesen(); tut.lichtWechsel = 0; }
    if (s.warte === 'hoch' || s.warte === 'runter') tut.gangVorher = null;
    if (s.vorher === 'manuell') u.automatikSetzen(false);
    if (s.vorher === 'automatik') u.automatikSetzen(true);
    if (s.warte === 'wahl') { tut.modus = null; tut.wahl = u.bahnLesen() ? 'bahn' : 'boden'; tut.wahlAktiv = true; tut.wahlPadVorher = null; }
    if (s.vorher === 'regen') u.wetterSetzen('rain');
    if (s.vorher === 'pacejka') u.presetSetzen('propacejka');
    if (s.vorher === 'motor') u.motorSetzen(u.motorLesen() === TUT_MOTOR ? TUT_MOTOR_ERSATZ : TUT_MOTOR);
    tut.ruheAus = !s.ruhe;
    tutSchrittZeigen(s);
    if (s.clip && !s.ruhe) tutSprich(s.clip);
  }

  // Gesichertes zurueck, genau einmal. Gerufen am Ende und beim Abbruch.
  function tutZurueckstellen() {
    const m = tut.merk, u = tut.umg;
    tut.merk = null;
    if (!m) return;
    try { u.presetZurueck(m.preset); } catch (e) { log('Tutorial: Fahrgefühl nicht zurückgestellt (' + e.message + ')', 'warn'); }
    try { u.motorSetzen(m.motor); } catch (e) { log('Tutorial: Motorklang nicht zurückgestellt (' + e.message + ')', 'warn'); }
    try { u.boxZurueck(m.box); } catch (e) { log('Tutorial: Boxeneinstellungen nicht zurückgestellt (' + e.message + ')', 'warn'); }
    try { if (u.wetterLesen() !== m.wetter) u.wetterSetzen(m.wetter); } catch (e) { log('Tutorial: Wetter nicht zurückgestellt (' + e.message + ')', 'warn'); }
    try { u.reifenZurueck(m.reifen); } catch (e) { log('Tutorial: Reifen nicht zurückgestellt (' + e.message + ')', 'warn'); }
    try { if (u.lichtLesen() !== m.licht) u.lichtSetzen(m.licht); } catch (e) { /* Licht bleibt */ }
    try { u.bahnSetzen(m.bahn); } catch (e) { log('Tutorial: Bahn/Boden nicht zurückgestellt (' + e.message + ')', 'warn'); }
  }
  function tutAus(grund) {
    clearTimeout(tut.timer);
    tut.timer = null;
    tut.umg.verstummen();
    tutZurueckstellen();
    tut.an = false;
    tut.ende = grund;
    tut.wahlAktiv = false; tut.wahlSperre = false;
    const ui = $('tut-ui');
    if (ui) ui.hidden = true;
  }
  function tutEnde() {
    const imCockpit = tut.umg.tab() === 'race';
    tut.phase = 'fertig';
    tutAus('fertig');
    if (imCockpit) tut.umg.insMenue();
  }
  function tutAbbrechen(grund) {
    if (!tut.an) return;
    const imCockpit = tut.umg.tab() === 'race';
    tut.phase = 'abgebrochen';
    tutAus(grund || 'abgebrochen');
    // Nur aus dem Cockpit (Knopf "Beenden"); wer schon im Menue ist, bleibt dort.
    if (imCockpit) tut.umg.insMenue();
  }

  // ---- Anzeige ----
  function tutText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }
  function tutVoraussetzungZeigen(fehlt) {
    tutText('tut-fortschritt', '');
    tutText('tut-titel', t('Bereit machen'));
    tutText('tut-text', [
      fehlt.includes('rolle') ? '✗ ' + t('Auto: verbunden, aber nicht Spieler 1. Unter FAHREN, AUTOS, GARAGE die Rolle auf Spieler 1 stellen.')
        : (fehlt.includes('auto') ? '✗ ' : '✓ ') + t('Auto: unter FAHREN in der Kachel AUTOS verbinden.'),
      (fehlt.includes('pad') ? '✗ ' : '✓ ') + t('Gamepad: einschalten und eine Taste drücken.'),
    ].join('\n'));
    const tk = $('tut-taste');
    if (tk) tk.hidden = true;
    tutWahlZeigen();
    tutText('tut-hinweis', t('Abbrechen: Kreis oder Esc'));
    const ui = $('tut-ui');
    if (ui) ui.classList.add('unten');
  }
  function tutSchrittZeigen(s) {
    // Gezaehlt werden die Schritte des gewaehlten Wegs (vor der Wahl: der eingestellte).
    const weg = tut.modus || tut.wahl;
    const liste = TUT_SCHRITTE.filter((x) => !x.modus || x.modus === weg);
    tutText('tut-fortschritt', (liste.indexOf(s) + 1) + ' / ' + liste.length);
    tutText('tut-titel', t(s.titel));
    const taste = s.taste ? tutTasteName(s.taste) : '';
    let text = t(s.zeige || TUT_SPRUCH[s.clip] || '').replace('{taste}', taste);
    if (s.id === 'rueckwaerts' && tut.umg.gasBremseRueck()) text += ' ' + t('Oder im Stand Gas und Bremse zugleich halten.');
    tutText('tut-text', text);
    const tk = $('tut-taste');
    if (tk) {
      tk.hidden = !s.taste || s.taste === 'spiel';
      tk.textContent = taste;
      tk.classList.remove('gedrueckt');
    }
    tutWahlZeigen();
    tutText('tut-hinweis', t('Beenden: Options oder Esc'));
    const ui = $('tut-ui');
    if (ui) ui.classList.remove('unten');
  }
  // ---- Wahl: Mit Bahn / Auf dem Boden ----
  // w: 'links' (Bahn), 'rechts' (Boden) oder 'ok'. Gerufen von Pad, Tastatur und Klick.
  function tutWahlTaste(w) {
    if (!tut.an || !tut.wahlAktiv) return;
    if (w === 'links') tut.wahl = 'bahn';
    else if (w === 'rechts') tut.wahl = 'boden';
    else if (w === 'ok') { tutWahlBestaetigen(); return; }
    tutWahlZeigen();
  }
  function tutWahlBestaetigen() {
    if (!tut.wahlAktiv) return;
    tut.wahlAktiv = false;
    tut.modus = tut.wahl === 'boden' ? 'boden' : 'bahn';
    tut.umg.bahnSetzen(tut.modus === 'bahn');
    tutWahlZeigen();
  }
  function tutWahlPad(pad) {
    const dp = (r) => (typeof padDpad === 'function' ? padDpad(pad, r)
      : !!(pad.buttons[r === 'left' ? 14 : 15] && pad.buttons[r === 'left' ? 14 : 15].pressed));
    const jetzt = { l: dp('left'), r: dp('right'), ok: !!(pad.buttons[0] && pad.buttons[0].pressed) };
    const v = tut.wahlPadVorher;
    tut.wahlPadVorher = jetzt;
    if (tut.wahlSperre) { if (!jetzt.ok) tut.wahlSperre = false; return; }
    if (!v) return;
    if (jetzt.l && !v.l) tutWahlTaste('links');
    if (jetzt.r && !v.r) tutWahlTaste('rechts');
    if (jetzt.ok && !v.ok) { tut.wahlSperre = true; tutWahlTaste('ok'); }
  }
  function tutWahlZeigen() {
    const box = $('tut-wahl');
    if (!box) return;
    box.hidden = !(tut.an && tut.wahlAktiv);
    box.querySelectorAll('[data-wahl]').forEach((b) => b.classList.toggle('gewaehlt', b.dataset.wahl === tut.wahl));
  }
  (() => {
    const b = $('tut-beenden');
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); tutAbbrechen('Knopf'); });
    document.querySelectorAll('#tut-wahl [data-wahl]').forEach((k) => {
      k.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!tut.wahlAktiv) return;
        tut.wahl = k.dataset.wahl;
        tutWahlBestaetigen();
      });
    });
    // Tastatur: Pfeile waehlen, Enter/Leertaste/X bestaetigen. In der Erfassungsphase, damit die
    // Pfeile in der Wahl nicht zugleich lenken (30-input.js hoert in der Blasenphase).
    window.addEventListener('keydown', (e) => {
      if (!tut.an || !tut.wahlAktiv) return;
      const k = e.key;
      const w = (k === 'ArrowLeft' || k === 'ArrowUp') ? 'links' : (k === 'ArrowRight' || k === 'ArrowDown') ? 'rechts'
        : (k === 'Enter' || k === ' ' || k === 'x' || k === 'X') ? 'ok' : null;
      if (!w) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) tutWahlTaste(w);
    }, true);
  })();
