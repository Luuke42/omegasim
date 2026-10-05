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

  // TEXTE KURZ UND OHNE GEDANKENSTRICHE (BESTELLT: "Emdashes rausnehmen aus den
  // Tutorialtexten und bessere Formulierung nehmen. Moeglichst kurz und knapp.").
  const K_TOUR = [
    { tab: 'fahren', ziel: null, bild: 'titel', titel: 'Willkommen bei OmegaSim',
      text: 'OmegaSim steuert deine Carrera-Hybrid-Autos per Bluetooth. Mit echter Fahrphysik, simuliertem Motorsound und einem Cockpit wie im Rennsimulator.' },
    { tab: 'fahren', ziel: ['#fa-auto'], bild: 'auto', titel: 'Autos verbinden',
      text: 'Verbinde hier dein Auto. Das erste steuerst du selbst, jedes weitere fährt als Ghost gegen dich. Namen, Farben und Fotos stellst du in der Garage ein.' },
    { tab: 'fahren', ziel: ['#fa-strecke'], bild: 'strecke-frei', titel: 'Deine Strecke',
      text: 'Auf der Bahn liest das Auto die Schiene. Scanne deine Strecke oder bau sie im Editor nach. Ohne Bahn druckst du Vorlagen aus.' },
    { tab: 'fahren', ziel: ['#fa-renn'], bild: 'rennen', titel: 'Rennoptionen',
      text: 'Training, Qualifying, Rennen oder Endurance. Dazu Wetter, Pflichtstopps, Tank und Reifenverschleiß.' },
    { tab: 'fahren', ziel: ['#fa-profil', '#fa-motor'], bild: 'optionen', titel: 'Fahrgefühl und Motorsound',
      text: 'Links die Abstimmung, rechts der Motor. Jeder Klang kommt aus einer Motorsimulation.' },
    { tab: 'fahren', ziel: ['#fa-start'], bild: 'start', titel: 'Losfahren',
      text: 'Ein Druck startet die Ampel. Im Cockpit fordert Kreuz den Boxenstopp an, Options öffnet das Menü.' },
    { tab: 'fahren', ziel: null, bild: 'box', titel: 'Boxenstopp als Minigame',
      text: 'Beim Stopp erscheinen zehn Tasten. Triffst du Quadrat oder Kreis rechtzeitig, ist die Crew schneller fertig. Abschalten kannst du es unter Optionen, Allgemein, Tank & Schaden.' },
    { tab: 'mp', ziel: ['#k-reiter button:nth-child(2)', '#sub-home-mp .misc-grid'], bild: 'mehrspieler', titel: 'WLAN Mehrspieler und Info-Screen',
      text: 'Mehrere Telefone fahren in einer gemeinsamen Rangliste. Ein Tablet zeigt als Info-Screen Strecke und Zeiten.' },
    { tab: 'fahren', ziel: ['#fa-auto'], bild: 'fahren', titel: "Los geht's",
      text: 'Verbinde jetzt dein erstes Auto. Zum Tutorial kommst du jederzeit zurück: Klick auf das Omega oben links.' },
  ];

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

  const K_PAD_NAMEN = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SHARE',
    9: 'OPTIONS', 10: 'L3', 11: 'R3', 12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'PS' };
  const kTourPadVorher = [];
  let kTourLenkVorher = false;
  // Aus pollGamepad (90-ghosts.js): waehrend der Steuerungs-Fuehrung gehoert der Pad ihr.
  // Gibt true zurueck, wenn die Fuehrung den Pad verbraucht hat - dann faehrt nichts.
  function konsoleTourPad(pad) {
    if (!kTourOffen) return false;
    // Editor-Fuehrung: im Vollbild bedient sonst der Editor den Pad; hier blaettert er nur.
    if (kTourListe === K_EDITOR) {
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
  const K_TOUR_ENDE = new Map([[K_TOUR, 'fahren'], [K_STEUERUNG, 'bleiben'], [K_EDITOR, 'bleiben']]);

  let kTourOffen = false;
  let kTourSchritt = 0;
  let kTourListe = K_TOUR;
  function konsoleTourOffen() { return kTourOffen; }

  function konsoleTourStart(liste) {
    kTourListe = Array.isArray(liste) ? liste : K_TOUR;
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
    kn('k-tutorial-start', (e) => { e.stopPropagation(); konsoleTourStart(K_TOUR); });
    kn('k-steuerung-start', (e) => { e.stopPropagation(); konsoleTourStart(K_STEUERUNG); });
    kn('k-tour-weiter', () => konsoleTourWeiter());
    kn('k-tour-zurueck', () => konsoleTourZurueck());
    kn('k-tour-ende', () => konsoleTourZu(false));
    window.addEventListener('resize', () => { if (kTourOffen) konsoleTourSpot(); });
  })();
