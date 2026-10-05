
  // ============================ KONSOLE: MENUE IM ACC-STIL (WIP) ======================
  //
  // BESTELLT: "menüführung soll stark wie assetto corsa competizione aussehen. Alles folgende
  // mit PS5 tastenlayout: kacheln, dpad richtungen zum wählen, x bestätigen, kreis zurück,
  // schultertasten zum tab wechseln." Titelbildschirm, Hauptmenue (Fahren, Mehrspieler,
  // Optionen; klein Info, Patchnotes, Entwickler), und ein Fahren-Schirm mit drei Spalten
  // Auto / Rennoptionen / Strecke und darunter "Rennen starten". Vorher als Mock-up gebaut
  // (mockup/menue.html) und vom Nutzer abgenommen, mit einer Aenderung: "Der Optionen-Tab
  // schickt mich direkt in ein weiteres Menü. Ich will dort erst die Teilmenüs zum
  // Draufklicken" - die Optionen oeffnen deshalb ihre Kachelseite, nicht die erste Liste.
  //
  // DIE MECHANIK DARUNTER BLEIBT: showTab() und showSubpage() (10-ble-explorer.js), die
  // Zeilenliste von menuNav (50b-menu-nav.js) und jede Element-id. Diese Schicht legt
  // Kopfzeile, Pfad, Reiterleiste (L1/R1), Rueckweg (Kreis) mit Stapel, Beschreibung und
  // Fussleiste darueber und baut die neuen Schirme (#tab-home als Titel, #tab-fahren) sowie
  // das Cockpit-Menue (#k-pause, Options 1 s halten) und den Frage-Dialog (#k-frage).
  //
  // KEIN HAUPTMENUE MEHR. BESTELLT: "Tabs nach ganz oben und 'Hauptmenü' Zurückpfeil wegtun,
  // zur Landing page muss ich nicht zurück, dafür kann ich die App gerne neu starten; dann
  // wie vorher: Oben links nur logo und rechts daneben alle tabs". Der Titel fuehrt direkt
  // nach FAHREN; die Ebene 1 ist die Wurzel, Kreis tut dort nichts.
  //
  // BEIM LADEN NICHTS AUSFUEHREN, was spaetere Dateien braucht: garage, currentTrackTiles,
  // raceState stehen als const/let weiter unten und liegen hier noch in der temporalen
  // Todeszone - ein Zugriff wuerfe und naehme die ganze IIFE mit. Deshalb nur Funktionen und
  // Ereignisse; gestartet wird per setTimeout(konsoleStart, 0) am Ende dieser Datei.

  // INFO steht seit v0.8.27 unter den Optionen, oben ist Platz fuer CHALLENGES. BESTELLT:
  // "Schieb INFO in Optionen, sodass ich dort eine weitere Ebene habe und oben Platz habe
  // fuer Challenges."
  // BESTELLT (v0.8.35): "Reihenfolge der Tabs oben: FAHREN, MEHRSPIELER, CHALLENGES, OPTIONEN".
  const K_EBENE1 = ['fahren', 'mp', 'challenges', 'options', 'misc'];
  const K_NAME = {
    home: 'Titel', fahren: 'Fahren', garage: 'Garage', race: 'Cockpit',
    options: 'Optionen', control: 'Renneinstellungen', track: 'Strecke', mp: 'WLAN Mehrspieler',
    info: 'Info', challenges: 'Challenges', misc: 'Entwickler', doc: 'Doku', school: 'Programmierschule',
    dev: 'BLE-Werkbank', selftest: 'Selbsttest', probe: 'Code-Sonde', numtrain: 'Zahlensysteme',
    record: 'Aufnahme-Modus',
  };
  // Zu welchem Reiter der Ebene 1 eine tiefe Seite gehoert: der Reiter bleibt hervorgehoben,
  // und Kreis fuehrt dorthin, wenn der Stapel leer ist.
  const K_ELTERN = {
    garage: 'fahren', info: 'options', control: 'fahren', track: 'fahren',
    doc: 'misc', school: 'misc', dev: 'misc', selftest: 'misc', probe: 'misc',
    numtrain: 'misc', record: 'misc',
  };
  const K_BILD = {
    home: 'titel', fahren: 'fahren', garage: 'garage', control: 'rennen',
    mp: 'mehrspieler', options: 'optionen', info: 'info', challenges: 'challenges', misc: 'mehrspieler',
  };

  let kStapel = [];
  let kZurueckLaeuft = false;
  let kFrageOffen = false;
  let kFrageWert = '';        // aktueller Wert der Namenseingabe im Frage-Dialog
  let kLetzterTab = 'home';

  function kAktiverTab() {
    const t = document.querySelector('.tabpage.active');
    return t ? t.id.replace(/^tab-/, '') : '';
  }
  // MENUE statt FAHREN: ueberall ausser im Cockpit, und im Cockpit, solange dessen Menue
  // offen ist. Daran haengt, ob Kreuz/Kreis/Quadrat/L1/R1/Options Menue- oder Fahrtasten sind.
  function konsoleMenue() {
    return kAktiverTab() !== 'race' || kFrageOffen
      || (typeof konsoleTourOffen === 'function' && konsoleTourOffen());
  }
  function konsoleFrageOffen() { return kFrageOffen; }
  function konsoleDev() {
    const cb = $('setting-dev');
    return !!(cb && cb.checked) || /[?&]dev\b/.test(location.search);
  }

  // ---- Wechsel verfolgen: aus dem .tab-btn-Klick gerufen (10-ble-explorer.js) --------
  function konsoleNachTab(neu, alt, altSub) {
    // Die Ebene 1 ist die Wurzel: wer dort ankommt, hat keinen Rueckweg mehr (Kreis tut
    // dort nichts), also auch keinen Stapel. Der Titel kommt nie auf den Stapel. Jeder
    // Eintrag merkt die Unterseite, die beim Verlassen offen war - Kreis oeffnet sie wieder.
    if (K_EBENE1.includes(neu)) kStapel = [];
    else if (!kZurueckLaeuft && alt && alt !== neu && alt !== 'home') {
      kStapel.push({ tab: alt, sub: altSub || '' });
      if (kStapel.length > 40) kStapel.shift();
    }
    kLetzterTab = neu;
    // Nach dem Umschalten zeichnen, nicht davor: der neue Tab ist erst danach .active.
    setTimeout(() => {
      konsoleZeichnen();
      // Auf dem Fahren-Schirm ist die Auswahl von Anfang an sichtbar: AUTO ohne Auto und
      // RENNEN STARTEN mit Auto.
      if (neu === 'fahren') {
        menuNavEnsureContext();
        if (!menuNavGezeigt) konsoleFokusAuf(playerCar ? 'fa-start' : 'fa-auto');
      }
      // Die gemerkte Stelle auch ZEIGEN (v0.8.41): vorher war sie aktiv, aber unmarkiert.
      menuNavEnsureContext();
      if (menuNavGezeigt) menuNavRender();
    }, 0);
  }
  function konsoleNachSubpage(key) {
    // Mehrspieler: Beitreten, Status und Rangliste gehoeren zu beiden Wegen (PC und App) und
    // wandern in die Unterseite, die gerade aufgeht - sofort, damit die Zeilenliste von
    // menuNav sie schon beim ersten Druck sieht.
    const mpg = $('mp-gemeinsam');
    const platz = key && document.querySelector('#sub-' + key + ' .mp-platz');
    if (mpg && platz && mpg.parentNode !== platz) platz.appendChild(mpg);
    setTimeout(() => {
      konsoleZeichnen();
      menuNavEnsureContext();
      if (menuNavGezeigt) menuNavRender();
    }, 0);
  }

  function konsoleZeige(tab, sub) {
    showTab(tab);
    if (sub) showSubpage(sub);
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
  }

  // ---- ZURUECK-TASTE DES HANDYS: zum Startbildschirm (v0.8.29) ----
  // BESTELLT: "Der 'zurueck' Pfeil (neben dem Home-Button) von meinem Handy soll, wenn ich ihn
  // klicke, zum Startbildschirm fuehren." In der App fragt MainActivity diese Funktion; true
  // heisst "erledigt", false (schon auf dem Startbildschirm) laesst die Taste die App schliessen.
  // Im Browser dasselbe ueber einen Verlaufseintrag: Zurueck landet auf popstate statt die
  // Seite zu verlassen, und auf dem Startbildschirm geht es wie gewohnt zurueck.
  function omegaZurueck() {
    if ($('mp-info') && !$('mp-info').hidden && typeof mpiStop === 'function') { mpiStop(); return true; }
    const imEditor = document.body.classList.contains('track-fs');
    const tour = typeof konsoleTourOffen === 'function' && konsoleTourOffen();
    if (kAktiverTab() === 'home' && !imEditor && !tour && !kFrageOffen) return false;
    if (typeof optInfoOffen === 'function' && optInfoOffen()) optInfoSchliessen();
    if (kFrageOffen) konsoleFrageZu();
    if (tour) konsoleTourZu(false);
    if (imEditor && typeof exitTrackFullscreen === 'function') exitTrackFullscreen();
    const logo = document.querySelector('#k-kopf .hdr-logo');
    if (logo) logo.click(); else konsoleZeige('home');
    return true;
  }
  window.omegaZurueck = omegaZurueck;
  if (!(window.OMEGA_APP && window.OMEGA_APP.nativ) && window.history && history.pushState) {
    try { history.pushState({ omega: 1 }, ''); } catch (e) { /* file:// o. ae. */ }
    window.addEventListener('popstate', () => {
      if (omegaZurueck()) { try { history.pushState({ omega: 1 }, ''); } catch (e) { /* egal */ } }
      else history.back();
    });
  }

  // KREIS / Esc: eine Ebene zurueck. Erst was offen ist (Info-Fenster, Cockpit-Menue,
  // Unterseite), dann der Stapel, zuletzt die Eltern-Ebene.
  function konsoleZurueck() {
    if (typeof optInfoOffen === 'function' && optInfoOffen()) { optInfoSchliessen(); return true; }
    // Challenge-Karte im Vollbild: Kreis verkleinert sie, statt die Unterseite zu schliessen.
    if (typeof chKarteVollOffen === 'function' && chKarteVollOffen()) {
      if (typeof chKarteVoll === 'function') chKarteVoll();
      return true;
    }
    if ($('mp-info') && !$('mp-info').hidden && typeof mpiStop === 'function') { mpiStop(); return true; }
    menuNavTextfeldLoesen();
    if (kFrageOffen) { konsoleFrageZu(); return true; }
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) { konsoleTourZurueck(); return true; }
    const lb = $('lb-wrap');
    if (lb && lb.classList.contains('on') && $('lb-close')) { $('lb-close').click(); return true; }
    const tab = kAktiverTab();
    if (tab === 'info' && document.querySelector('#tab-info .subpage.on')) { konsoleZeige('fahren'); return true; }
    if (document.querySelector('.tabpage.active .subpage.on')) { showSubpage(''); return true; }
    if (tab === 'home' || tab === 'fahren') return false;
    // BESTELLT: "wenn ich aus menues mit kreistaste zurueckgehe, will ich zu fahren kommen."
    // Der Stapel fuehrte sonst in den zuletzt besuchten Menue-Reiter zurueck; Kreis soll
    // aber immer auf dem Fahren-Reiter landen.
    kZurueckLaeuft = true;
    try { showTab('fahren'); } finally { kZurueckLaeuft = false; }
    menuNavTonAbwaehlen();
    return true;
  }

  // ---- Reiterleisten (L1/R1) --------------------------------------------------------
  //
  // OBEN, neben dem Logo, immer die Ebene 1. Darunter, nur wenn es sie gibt, eine flache
  // zweite Leiste mit der inneren Ebene: in einer offenen Unterseite ihre Geschwister (die
  // Optionen-Kategorien, die Mehrspieler-Wege), in der BLE-Werkbank ihre Unterreiter, in den
  // Renneinstellungen die drei Karten. Die Schultertasten wirken auf die innerste.
  function konsoleReiter() { return konsoleReiterInnen() || konsoleReiterEbene1(); }
  function konsoleReiterInnen() {
    const tab = kAktiverTab();
    const tp = document.querySelector('.tabpage.active');
    if (!tp || tab === 'home' || tab === 'race') return null;
    const offen = tp.querySelector('.subpage.on');
    if (offen) {
      const kacheln = [...(tab === 'info' ? document.querySelectorAll('#sub-home-options .misc-tile.info-open')
                                          : tp.querySelectorAll('.subpage-home .misc-tile.subpage-open'))]
        .filter((k) => !k.hidden);
      if (kacheln.length >= 2) {
        return kacheln.map((k) => ({
          text: (k.querySelector('b') || k).textContent.trim(),
          // Dauerrennen-Kacheln (data-ch) zeigen alle dieselbe Kategorie-Unterseite sub-ch-e;
          // der aktive ist der, dessen Strecke gerade offen ist (chWahl). So sind sie auf
          // derselben Ebene wie die Wochenkategorien - BESTELLT: "wöchentliche Challenges und
          // Dauerrennen sind auf verschiedenen menü-ebenen, bitte angleichen".
          an: k.dataset.ch ? k.dataset.ch === chWahl
              : k.dataset.sub === offen.id.replace(/^sub-/, ''),
          wahl: () => {
            if (k.dataset.ch && typeof challengeSeiteZeigen === 'function') challengeSeiteZeigen(k.dataset.ch);
            else showSubpage(k.dataset.sub);
          },
        }));
      }
      return null;
    }
    if (tab === 'dev') {
      return [...document.querySelectorAll('#tab-dev .subtab-btn')].map((b) => ({
        text: b.textContent.trim(), an: b.classList.contains('active'), wahl: () => b.click(),
      }));
    }
    if (tab === 'control') {
      const karten = [['race-card', 'Einstellungen'], ['race-results', 'Ergebnisse'], ['sess-card', 'Sitzungen']]
        .filter(([id]) => $(id));
      return karten.map(([id, text], i) => ({
        text: t(text), an: i === (konsoleReiter.renn || 0),
        wahl: () => {
          konsoleReiter.renn = i;
          const el = $(id);
          if (el && !el.hidden) el.scrollIntoView({ block: 'start' });
          konsoleZeichnen();
        },
      }));
    }
    return null;
  }
  // Die Ebene 1 ist die Wurzel: ein Wechsel dort leert den Stapel (konsoleNachTab). Auf einer
  // tiefen Seite (Garage, Strecke, Doku, ...) bleibt ihr Reiter hervorgehoben. Ein Klick auf
  // den schon gewaehlten Reiter schliesst eine offene Unterseite - fuer Maus und Touch der
  // Weg zurueck zu den Kacheln, jetzt wo der Zurueckpfeil oben fehlt.
  function konsoleReiterEbene1() {
    const tab = kAktiverTab();
    if (!tab || tab === 'home' || tab === 'race') return null;
    let wurzel = tab;
    while (K_ELTERN[wurzel]) wurzel = K_ELTERN[wurzel];
    return K_EBENE1.filter((x) => x !== 'misc' || konsoleDev()).map((x) => ({
      text: t(K_NAME[x]), an: x === wurzel,
      wahl: () => {
        if (x === tab) {
          if (document.querySelector('.tabpage.active .subpage.on')) showSubpage('');
          return;
        }
        konsoleZeige(x);
      },
    }));
  }
  function konsoleReiterSchritt(d) {
    // Waehrend des Tutorials bleibt der Schirm, wo die Fuehrung ihn hinstellt.
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) return true;
    const r = konsoleReiter();
    if (!r || !r.length) return false;
    let i = r.findIndex((x) => x.an);
    if (i < 0) i = d > 0 ? -1 : 0;
    r[((i + d) % r.length + r.length) % r.length].wahl();
    menuNavTonBewegen();
    return true;
  }

  // ---- WISCHEN WECHSELT DIE REITER (v0.9.4) -------------------------------------------
  // BESTELLT: "mach, dass ich mit swipe nach links und rechts so wie mit den Schultertasten
  // die Tabs wechseln kann". Dieselbe Funktion wie L1/R1 (innerste Leiste). Nicht im Cockpit,
  // im Editor, auf Reglern, Karten und in waagrecht scrollbaren Bereichen - dort gehoert die
  // Wischgeste dem Inhalt. Mindestens 60 px, deutlich waagrecht, in hoechstens 0,7 s.
  (function wischenAnbinden() {
    const NICHT = '.tp-karte, input, select, textarea, canvas, .k-pause, .lb-wrap, #mp-info, .k-kein-wischen';
    let a = null;
    document.addEventListener('touchstart', (e) => {
      a = null;
      if (e.touches.length !== 1) return;
      const z = e.target;
      if (!z || !z.closest || z.closest(NICHT) || document.body.classList.contains('track-fs')) return;
      for (let el = z; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 4) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') return;
        }
      }
      a = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!a || !e.changedTouches.length) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - a.x, dy = p.clientY - a.y, dt = performance.now() - a.t;
      a = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy) || dt > 700) return;
      const tab = document.querySelector('.tabpage.active');
      if (!tab || tab.id === 'tab-home' || tab.id === 'tab-race') return;
      if (typeof konsoleFrageOffen === 'function' && konsoleFrageOffen()) return;
      konsoleReiterSchritt(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  // ---- Quadrat: schneller Wechsel auf Kacheln mit data-quad --------------------------
  function konsoleQuadWechsel(q, dir) {
    if (q === 'renntyp') {
      const s = $('race-mode');
      s.selectedIndex = (s.selectedIndex + dir + s.options.length) % s.options.length;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (q === 'bahn') {
      const cb = $('setting-ontrack');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (q === 'profil') {
      if ($('race-act-mode')) $('race-act-mode').click();
    } else if (q === 'motor') {
      const s = $('sound-profile');
      const opts = s ? [...s.options].filter((o) => !o.disabled) : [];
      if (opts.length) {
        const n = opts[(opts.indexOf(s.selectedOptions[0]) + dir + opts.length) % opts.length];
        s.value = n.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      return false;
    }
    menuNavTonVerstellen();
    konsoleFahrenZeichnen();
    return true;
  }
  function konsoleQuadrat(richtung) {
    const dir = richtung === -1 ? -1 : 1;
    menuNavEnsureContext();
    const zeile = menuNavRows()[menuNavIndex];
    const el = zeile && zeile.el;
    const q = el && el.dataset ? el.dataset.quad : null;
    if (!q) return false;
    return konsoleQuadWechsel(q, dir);
  }
  // Die Schaltstellungen einer Kachel (Anzahl Punkte und welcher gefuellt ist), aus denselben
  // Bedienelementen, die konsoleQuadWechsel() weiterdreht - damit Zahl und Punkt nicht
  // auseinanderlaufen koennen.
  function kQuadPunkte(quad) {
    if (quad === 'bahn') {
      const cb = $('setting-ontrack');
      return { anzahl: 2, index: cb && cb.checked ? 1 : 0 };
    }
    if (quad === 'renntyp') {
      const s = $('race-mode');
      return { anzahl: s ? s.options.length : 0, index: s ? s.selectedIndex : -1 };
    }
    if (quad === 'profil') {
      const keys = window.__presetKeys ? window.__presetKeys() : [];
      const aktiv = window.__presetActive ? window.__presetActive() : null;
      return { anzahl: keys.length, index: aktiv ? keys.indexOf(aktiv) : -1 };
    }
    if (quad === 'motor') {
      const s = $('sound-profile');
      const opts = s ? [...s.options].filter((o) => !o.disabled) : [];
      const sel = s && s.selectedOptions[0];
      return { anzahl: opts.length, index: sel ? opts.indexOf(sel) : -1 };
    }
    return { anzahl: 0, index: -1 };
  }

  // ---- Titel: jede Taste fuehrt nach FAHREN ------------------------------------------
  // BESTELLT: "Standardmäßig komme ich danach in den Tab, der 'FAHREN' heißt."
  function konsoleTitelWeiter() {
    if (kAktiverTab() !== 'home') return false;
    kStapel = [];
    konsoleZeige('fahren');
    return true;
  }

  // ---- Fahren: Start und Auto --------------------------------------------------------
  async function konsoleAuto() {
    if (!playerCar && !garage.some((c) => c.device)) {
      const lage = await garageConnect({ stumm: true });
      konsoleFahrenZeichnen();
      if (lage) {
        konsoleFrage(t('Bluetooth nicht bereit'), t(bluetoothLageText(lage)),
          [[t('Nochmal verbinden'), () => konsoleAuto()], [t('Schließen'), null]]);
        return;
      }
      // Nach dem Verbinden auf RENNEN STARTEN, wie bestellt: wenige Klicks bis zum Fahren.
      if (playerCar) konsoleFokusAuf('fa-start');
      return;
    }
    konsoleZeige('garage');
  }
  // VERBINDEN: immer die Bluetooth-Auswahl, auch wenn schon Autos da sind (das naechste wird
  // Ghost). Eine nicht bereite Bluetooth-Lage kommt in denselben Dialog wie bei AUTO.
  async function konsoleVerbinden() {
    const vorher = kAutos().length;
    const lage = await garageConnect({ stumm: true });
    konsoleFahrenZeichnen();
    if (lage) {
      konsoleFrage(t('Bluetooth nicht bereit'), t(bluetoothLageText(lage)),
        [[t('Nochmal verbinden'), () => konsoleVerbinden()], [t('Schließen'), null]]);
      return;
    }
    if (kAutos().length > vorher) konsoleFokusAuf('fa-start');
  }
  // RENNEN STARTEN: fehlt das Auto, erst die Bluetooth-Auswahl, dann ins Cockpit und die
  // Startampel. Freies Training startet genauso (die Ampel gibt den Beginn der Sitzung).
  //
  // TROTZDEM STARTEN. BESTELLT: "erlaube mir zum Debuggen auch auf Starten zu drücken, wenn
  // kein Auto verbunden ist. Aktuell kommt 'Bluetooth Adapter ist aus...'. Das ist ok, aber
  // ich will eine Option 'trotzdem starten', damit ich dann sehen kann, ob das Cockpit da ist
  // und noch gut funktioniert." Statt alert() ein Dialog, der mit dem Pad bedienbar ist.
  function kRennenLaeuft() {
    try { return raceState === 'racing' || raceState === 'countdown' || raceState === 'finishing'; } catch (e) { return false; }
  }
  async function konsoleLosfahren(ohneAuto) {
    // Laeuft schon ein Rennen (Options fuehrt mitten im Rennen hierher), geht es nur zurueck.
    if (kRennenLaeuft()) { konsoleInsCockpit(); return; }
    if (!playerCar && !ohneAuto) {
      const lage = await garageConnect({ stumm: true });
      if (!playerCar) {
        konsoleFahrenZeichnen();
        const grund = lage ? t(bluetoothLageText(lage)) : t('Die Bluetooth-Auswahl wurde ohne Auto geschlossen.');
        konsoleFrage(t('Kein Auto verbunden'),
          grund + '\n\n' + t('Zum Ausprobieren geht es trotzdem ins Cockpit: Anzeigen, Menüs, Ampel und Ton laufen, an ein Auto wird nichts gesendet.'),
          [[t('Trotzdem starten'), () => konsoleLosfahren(true)],
           [t('Nochmal verbinden'), () => konsoleLosfahren()],
           [t('Abbrechen'), null]], true);
        return;
      }
    }
    showTab('race');
    if (raceState === 'idle' || raceState === 'finished') toggleRace();
  }

  // ---- Frage-Dialog (#k-frage): wie das Cockpit-Menue, mit dem Pad bedienbar ----------
  // knoepfe: [[Text, Funktion oder null], ...]; der erste ist vorgewaehlt.
  // `bild` ist optionales HTML (z. B. ein Strecken-SVG) fuer die Vorschau im Dialog.
  // `eingabe` ist optional { label, wert }: eine Namenseingabe; der aktuelle Wert steht
  // in kFrageWert und wird von der Klick-Funktion der Knoepfe gelesen.
  function konsoleFrage(titel, text, knoepfe, wip, bild, eingabe) {
    const d = $('k-frage');
    if (!d) return;
    $('k-frage-titel').textContent = titel;
    if (wip) {
      const w = document.createElement('span');
      w.className = 'wip-tag';
      w.textContent = t('experimentell');
      $('k-frage-titel').appendChild(document.createTextNode(' '));
      $('k-frage-titel').appendChild(w);
    }
    const bd = $('k-frage-bild');
    if (bd) {
      if (bild) { bd.innerHTML = bild; bd.hidden = false; }
      else { bd.innerHTML = ''; bd.hidden = true; }
    }
    const ei = $('k-frage-eingabe');
    if (ei) {
      if (eingabe) {
        ei.hidden = false;
        const lbl = ei.querySelector('label');
        if (lbl) lbl.textContent = eingabe.label || '';
        const feld = $('k-frage-eingabe-feld');
        if (feld) {
          feld.value = eingabe.wert || '';
          feld.addEventListener('input', () => { kFrageWert = feld.value.trim(); });
          setTimeout(() => { try { feld.focus(); } catch (e) {} }, 0);
        }
        kFrageWert = (eingabe.wert || '').trim();
      } else {
        ei.hidden = true;
        kFrageWert = '';
      }
    }
    $('k-frage-text').textContent = text || '';
    const host = $('k-frage-knoepfe');
    host.innerHTML = '';
    knoepfe.forEach(([tx, fn]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = tx;
      b.addEventListener('click', () => { konsoleFrageZu(); if (fn) fn(); });
      host.appendChild(b);
    });
    kFrageOffen = true;
    d.hidden = false;
    menuNavEnsureContext();
    menuNavIndex = 0; menuNavGezeigt = true;
    menuNavRender();
    konsoleZeichnen();
  }
  function konsoleFrageZu() {
    const d = $('k-frage');
    kFrageOffen = false;
    if (d) d.hidden = true;
    // Leeren: der Text bliebe sonst unsichtbar im Dokument stehen, nach einem Sprachwechsel
    // in der alten Sprache (der Sprachtest hat ihn gefunden).
    ['k-frage-titel', 'k-frage-text', 'k-frage-knoepfe'].forEach((id) => { if ($(id)) $(id).textContent = ''; });
    document.querySelectorAll('.menu-nav-sel').forEach((el) => el.classList.remove('menu-nav-sel'));
    menuNavEnsureContext();
    if (kAktiverTab() === 'fahren') konsoleFokusAuf(playerCar ? 'fa-start' : 'fa-auto');
    konsoleZeichnen();
  }

  // ---- Rechter Stick: Bildlauf (aus pollGamepad) --------------------------------------
  // BESTELLT: "rechter Stick soll scrollen können". Vorher stand dort document.body.scrollTop
  // - im Standardmodus rollt der body aber nicht, das Dokument tut es (scrollingElement), und
  // der Stick blieb wirkungslos. Jetzt: zuerst ein offener Dialog, dann die Seite. Die
  // Bruchteile werden gesammelt, sonst verschluckt das Runden auf ganze Pixel einen leicht
  // geneigten Stick.
  let kRollRest = 0;
  function konsoleBildlauf(dy) {
    kRollRest += dy;
    const ganz = Math.trunc(kRollRest);
    if (!ganz) return false;
    kRollRest -= ganz;
    const ziele = [
      kFrageOffen && document.querySelector('#k-frage .k-pause-dialog'),
      document.scrollingElement, document.body,
    ];
    for (const el of ziele) {
      if (!el) continue;
      const vor = el.scrollTop;
      el.scrollTop = vor + ganz;
      if (el.scrollTop !== vor) return true;
    }
    return false;
  }
  function konsoleFokusAuf(id) {
    const rows = menuNavRows();
    const i = rows.findIndex((r) => r.el.id === id);
    if (i >= 0) { menuNavIndex = i; menuNavGezeigt = true; menuNavRender(); }
  }

  // ---- Cockpit <-> Fahren-Menue (Options, Esc, Knopf ☰) ------------------------------
  //
  // BESTELLT: "Menü knopf soll direkt zum FAHREN menü führen, ohne Auswahl dazwischen" und
  // "options 1x ins menü, nochmal zurück zum cockpit". Das Auswahlmenue (Weiterfahren,
  // Boxenstopp, ...) ist damit weg: der Boxenstopp liegt auf Kreuz, Abbrechen auf dem
  // Knopf im Cockpit, alles andere im Fahren-Menue. War das Cockpit im Vollbild, kommt es
  // auf dem Rueckweg wieder so.
  // RUECKWEG (v0.8.24): wer aus einer Menueseite per Options ins Cockpit ging, kommt mit
  // Options genau dorthin zurueck, samt offener Unterseite; sonst nach Fahren.
  let kCockpitVollbild = false;
  let kMenueRueck = null;
  let kErgebnisWartet = false;
  function konsoleZumMenue() {
    kCockpitVollbild = document.body.classList.contains('race-fs');
    if (kCockpitVollbild) exitRaceFullscreen();
    // BESTELLT: "im Cockpit soll der Menue-Knopf das laufende Rennen/Training immer
    // beenden." Vorher blieb ein Rennen im Hintergrund laufen, wenn man ueber den
    // Menue-Knopf in die Menues wechselte - die Ampel lief weiter, das Auto fuhr ohne
    // Fahrer. Der Menue-Knopf ist ein Ausstieg, also beendet er auch die Sitzung.
    if (typeof kRennenLaeuft === 'function' && kRennenLaeuft()
        && typeof requestRaceStop === 'function') {
      requestRaceStop();
    }
    const r = kMenueRueck;
    kMenueRueck = null;
    if (r && r.tab && r.tab !== 'race' && r.tab !== 'home') konsoleZeige(r.tab, r.sub || '');
    else konsoleZeige('fahren');
  }
  function konsoleInsCockpit(merken) {
    if (merken) {
      const offen = document.querySelector('.tabpage.active .subpage.on');
      kMenueRueck = { tab: kAktiverTab(), sub: offen ? offen.id.replace(/^sub-/, '') : '' };
    }
    showTab('race');
    if (kCockpitVollbild && !document.body.classList.contains('race-fs')) enterRaceFullscreen();
    if (kErgebnisWartet) {
      kErgebnisWartet = false;
      if ($('k-ergebnis')) $('k-ergebnis').hidden = true;
      if (typeof cockpitScreenZu === 'function') cockpitScreenZu('uebersicht');
    }
  }
  // RENNENDE: im Cockpit die Uebersicht, sonst eine Einblendung statt eines harten Sprungs.
  function konsoleRennenBeendet() {
    if (kAktiverTab() === 'race') {
      if (typeof cockpitScreenZu === 'function') cockpitScreenZu('uebersicht');
      return;
    }
    kErgebnisWartet = true;
    const b = $('k-ergebnis');
    if (b) b.hidden = false;
  }

  // ---- Zeichnen: Kopf, Reiter, Beschreibung, Fuss, Hintergrund -----------------------
  function konsoleZeichnen() {
    const tab = kAktiverTab();
    document.body.classList.toggle('k-titel-an', tab === 'home');
    // Der Fahren-Schirm fuellt genau den Bildschirm (CSS: body.k-kacheln).
    document.body.classList.toggle('k-kacheln', tab === 'fahren');
    // Hintergrund
    const bg = $('k-bg');
    if (bg) {
      let name = K_BILD[tab] || 'mehrspieler';
      if (tab === 'track') name = ($('setting-ontrack') || {}).checked ? 'strecke-bahn' : 'strecke-frei';
      const url = 'url(img/' + name + '-bg.jpg)';
      if (bg.dataset.bild !== name) { bg.style.backgroundImage = url; bg.dataset.bild = name; }
    }
    // Status
    const st = $('k-status');
    if (st) {
      let n = 0;
      try { n = garage.filter((c) => c.device).length; } catch (e) { n = 0; }
      st.textContent = '';
      const a = document.createElement('span');
      a.className = n ? 'k-an' : '';
      a.textContent = n ? '● ' + n + ' ' + t(n === 1 ? 'Auto' : 'Autos') : '○ ' + t('kein Auto');
      st.appendChild(a);
      // Kein Etikett "Neues Menü" mehr daneben - BESTELLT: "Mach das 'Neues Menü' Label oben
      // rechts weg". Als WIP gekennzeichnet bleibt das Menue in den Patchnotes.
    }
    // Reiter: oben die Ebene 1, darunter die innere Leiste, falls es eine gibt.
    const r1 = konsoleReiterEbene1();
    const r2 = konsoleReiterInnen();
    const fuell = (leiste, host, r) => {
      if (!leiste) return;
      leiste.hidden = !r;
      if (!r || !host) return;
      host.innerHTML = '';
      r.forEach((x) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = x.text;
        if (x.an) b.className = 'an';
        b.addEventListener('click', () => x.wahl());
        host.appendChild(b);
      });
    };
    fuell($('k-leiste'), $('k-reiter'), r1);
    fuell($('k-leiste2'), $('k-reiter2'), r2);
    document.body.classList.toggle('k-innen', !!r2);
    // Immer, nicht nur auf dem Fahren-Schirm: sonst stuenden seine Kacheln nach einem
    // Sprachwechsel anderswo noch in der alten Sprache da ("Härte 50 %" im Englischen).
    konsoleFahrenZeichnen();
    if (tab === 'track') konsoleStreckeModus();
  }

  // Keine Beschreibungszeile und keine Fussleiste mit Tastenbelegung mehr. BESTELLT: "Nimm den
  // Footer mit den Tastenbelegungen weg und auch oben das L1 und R1. Entferne auch den Tipp
  // unten". Die Tasten bleiben dieselben, nur ihre Anzeige entfaellt.

  // ---- Fahren: die Info-Zeilen aus dem echten Zustand ---------------------------------
  function kZeilen(host, paare) {
    if (!host) return;
    host.innerHTML = '';
    for (const [l, w] of paare) {
      // Auch die BESCHRIFTUNG darf ein Knoten sein: die Autos-Kachel gibt den Farbpunkt mit
      // Namen als Span. Mit textContent stand dort "[object HTMLSpanElement]" (GEMELDET).
      const a = document.createElement('span'); a.className = 'k-l';
      if (l instanceof Node) a.appendChild(l); else a.textContent = l;
      const b = document.createElement('span'); b.className = 'k-w';
      if (w instanceof Node) b.appendChild(w); else b.textContent = w;
      host.appendChild(a); host.appendChild(b);
    }
  }
  function kAutos() {
    try { return garage.filter((c) => c.device); } catch (e) { return []; }
  }
  const K_ROLLE = { player: 'Steuern', player2: 'Spieler 2', ghost: 'Ghost', none: 'Aus' };
  function kPunkt(farbe, text) {
    const s = document.createElement('span');
    const p = document.createElement('i'); p.className = 'k-punkt'; p.style.background = farbe;
    s.appendChild(p); s.appendChild(document.createTextNode(text));
    return s;
  }
  function kTeile() {
    try { return currentTrackTiles.length; } catch (e) { return 0; }
  }
  function kCode() {
    try { return currentTrackTiles.length > 1 ? trackToCode(currentTrackTiles) : ''; } catch (e) { return ''; }
  }

  function konsoleFahrenZeichnen() {
    if (!$('fa-auto')) return;
    const autos = kAutos();
    $('fa-auto-titel').textContent = autos.length ? autos.length + ' ' + t('verbunden') : t('Autos verbinden');
    // BESTELLT v0.8.126: mehrere verbundene Autos mit Fotos gemeinsam zeigen (die Garage auf dem
    // Fahren-Schirm). Erst ab zwei Fotos, sonst bleibt es beim einen Bild des Fahrer-Autos.
    const mitFotos = autos.filter((c) => typeof autoFoto === 'function' && autoFoto(c));
    const galerieAn = mitFotos.length >= 2;
    const faAuto = $('fa-auto');
    if (faAuto) faAuto.classList.toggle('k-auto-mehr', galerieAn);
    // Das eigene Foto des Fahrer-Autos (Garage) statt des Beispielbilds.
    const fahrer = autos.find((c) => c.role === 'player') || autos[0];
    const afoto = fahrer && typeof autoFoto === 'function' ? autoFoto(fahrer) : '';
    const ab = $('fa-auto-bild');
    let abNeu;
    if (galerieAn) {
      abNeu = 'galerie:' + mitFotos.map((c) => (c.device ? c.device.id : '') + ':' + autoFoto(c).length).join('|');
    } else {
      abNeu = afoto ? 'foto:' + afoto.length : 'auto';
    }
    if (ab && ab.dataset.bild !== abNeu) {
      if (galerieAn) {
        ab.style.backgroundImage = 'none';
        ab.innerHTML = '';
        const gal = document.createElement('div');
        gal.className = 'k-auto-galerie';
        mitFotos.forEach((c) => {
          const zelle = document.createElement('div');
          zelle.className = 'k-auto-zelle';
          zelle.style.backgroundImage = 'url("' + autoFoto(c) + '")';
          zelle.title = garageLabel(c);
          const lab = document.createElement('span');
          const dot = document.createElement('i');
          dot.style.background = carColor(c).hex;
          lab.appendChild(dot);
          lab.appendChild(document.createTextNode(garageLabel(c)));
          zelle.appendChild(lab);
          gal.appendChild(zelle);
        });
        ab.appendChild(gal);
      } else {
        ab.style.backgroundImage = afoto ? 'url("' + afoto + '")' : 'url(img/auto.jpg)';
        ab.innerHTML = '';
      }
      ab.dataset.bild = abNeu;
    }
    kZeilen($('fa-auto-info'), autos.length
      ? autos.map((c) => [kPunkt(carColor(c).hex, garageLabel(c)), t(K_ROLLE[c.role] || c.role)])
      : [[t('Status'), t('nicht verbunden')]]);
    const rm = $('race-mode');
    const modus = rm.selectedOptions[0] ? rm.selectedOptions[0].textContent : '';
    $('fa-renn-titel').textContent = modus;
    // Rennoptionen-Kachel wechselt mit dem Rennmodus das Bild (BESTELLT v0.8.53).
    const rmBild = { practice: 'rennoptionen-practice', endurance: 'rennoptionen-endurance',
                     qualifying: 'rennoptionen-qualifying', laps: 'rennoptionen-laps',
                     knockout: 'knockout', derby: 'derby' }[rm.value];
    const rb = $('fa-renn-bild');
    if (rb && rmBild && rb.dataset.bild !== rmBild) {
      rb.style.backgroundImage = 'url(img/' + rmBild + '.jpg)';
      rb.dataset.bild = rmBild;
    }
    const wx = $('race-wx-start');
    kZeilen($('fa-renn-info'), [
      // Freies Training laeuft ohne Ende: dort steht das Unendlich statt einer Minutenzahl.
      rm.value === 'practice' ? [t('Dauer'), '∞']
        : [($('race-limit-label') || {}).textContent || t('Dauer'), ($('race-limit') || {}).value || '–'],
      [t('Wetter'), wx && wx.selectedOptions[0] ? wx.selectedOptions[0].textContent : '–'],
      [t('Pflichtboxenstopps'), ($('race-pit-required') || {}).value || '0'],
    ]);
    const bahn = ($('setting-ontrack') || {}).checked;
    const foto = konsoleFoto();
    $('fa-strecke-titel').textContent = bahn ? t('Auf der Bahn') : t('Frei');
    const bild = $('fa-strecke-bild');
    // BESTELLT v0.8.126: ist eine Strecke eingegeben und der Modus steht auf "auf der Bahn",
    // zeigt das Band die Streckenvorschau aus dem Editor statt des Beispielbilds.
    let teileAn = 0;
    try { teileAn = currentTrackTiles.length; } catch (e) { teileAn = 0; }
    const vorschauAn = bahn && teileAn >= 3 && typeof renderTrackPreview === 'function';
    const faStrecke = $('fa-strecke');
    if (faStrecke) faStrecke.classList.toggle('k-vorschau', vorschauAn);
    // Im Ausdruck-Modus zeigt das Band das eigene Streckenfoto, sobald es eines gibt. Nur neu
    // setzen, wenn es sich geaendert hat: die Daten-URL ist einige hundert KB lang.
    let bildNeu;
    if (vorschauAn) {
      try { bildNeu = 'karte:' + trackToCode(currentTrackTiles, trackRotationDeg); }
      catch (e) { bildNeu = 'karte'; }
    } else {
      bildNeu = !bahn && foto ? 'foto:' + foto.length : (bahn ? 'strecke-bahn' : 'strecke-frei');
    }
    if (bild && bild.dataset.bild !== bildNeu) {
      let gezeichnet = false;
      if (vorschauAn) {
        try {
          const res = renderTrackPreview(currentTrackTiles, null, { detailed: true });
          bild.style.backgroundImage = 'none';
          bild.innerHTML = res.html;
          gezeichnet = true;
        } catch (e) { /* Fall: Foto */ }
      }
      if (!gezeichnet) {
        bild.style.backgroundImage = !bahn && foto ? 'url("' + foto + '")' : 'url(img/' + (bahn ? 'strecke-bahn' : 'strecke-frei') + '.jpg)';
        bild.innerHTML = '';
      }
      bild.dataset.bild = bildNeu;
    }
    kZeilen($('fa-strecke-info'), bahn
      ? [[t('Teile'), String(kTeile())], ['Code', kCode() || '–']]
      : [[t('Modus'), t('Ausdruck, ohne Bahn')], [t('Streckenfoto'), foto ? t('hochgeladen') : t('keins')]]);
    ['fa-scan', 'fa-laden'].forEach((id) => { if ($(id)) $(id).hidden = !bahn; });
    // BESTELLT: "wenn ich auf TRACK klicke, sollen alle Optionen sichtbar sein" - auch im
    // Bahn-Modus sollen die Druckvorlagen erreichbar bleiben.
    if ($('fa-druck')) $('fa-druck').hidden = false;
    if ($('fa-foto')) $('fa-foto').hidden = bahn;
    if ($('fa-foto-weg')) $('fa-foto-weg').hidden = bahn || !foto;
    $('fa-profil-titel').textContent = ($('race-act-mode-txt') || {}).textContent || '–';
    const sp = $('sound-profile');
    const motor = sp && sp.selectedOptions[0] ? sp.selectedOptions[0].textContent.split(':')[0].trim() : '–';
    $('fa-motor-titel').textContent = motor;
    const training = rm.value === 'practice';
    $('fa-start-titel').textContent = kRennenLaeuft() ? t('Zurück ins Rennen')
      : (training ? t('Training starten') : t('Rennen starten'));
    $('fa-start-unter').textContent = modus + ' · ' + (bahn ? t('auf der Bahn') : t('frei'));
    // Punkte rechts neben dem Wert (in derselben .k-kopf-Zeile): so viele, wie es
    // Schaltstellungen gibt, die gewaehlte gefuellt. Bei zu vielen (z. B. Motorsound mit
    // 27 Motoren) wuerden die Punkte nicht mehr passen - dort stehen Pfeile im Markup.
    // Fuer 6..10 Stellungen ohne Pfeile reicht auch der Platz nicht mehr: dann eine kompakte
    // "N/M"-Anzeige statt der Punkte (BESTELLT: "N/8"-Readout, wenn die Punkte drangeln).
    [['fa-strecke-punkte', 'bahn'], ['fa-renn-punkte', 'renntyp'],
     ['fa-profil-punkte', 'profil']].forEach(([id, quad]) => {
      const host = $(id);
      if (!host) return;
      const p = kQuadPunkte(quad);
      let html = '';
      if (p.anzahl <= 5) {
        for (let i = 0; i < p.anzahl; i++) html += '<i' + (i === p.index ? ' class="an"' : '') + '></i>';
      } else if (p.anzahl > 0) {
        const n = p.index >= 0 ? p.index + 1 : '&ndash;';
        html = '<b class="k-quad-zahl">' + n + '/' + p.anzahl + '</b>';
      }
      if (host.innerHTML !== html) host.innerHTML = html;
    });
  }

  // ---- Streckenfoto (Ausdruck-Modus, experimentell) --------------------------------
  // Verkleinert auf hoechstens 1400 px und als JPEG im localStorage: so bleibt es ueber einen
  // Neustart erhalten und passt mit einigen hundert KB in den Speicher. Die EXIF-Drehung
  // wendet der Browser beim Zeichnen selbst an.
  const K_FOTO = 'omegasim-streckenfoto';
  function konsoleFoto() {
    try { return localStorage.getItem(K_FOTO) || ''; } catch (e) { return ''; }
  }
  // Was der Uebersichtsschirm im Cockpit zeigt: das Foto nur im Ausdruck-Modus.
  function konsoleStreckenfotoAktiv() {
    return ($('setting-ontrack') || {}).checked ? '' : konsoleFoto();
  }
  function konsoleFotoSetzen(daten) {
    try {
      if (daten) localStorage.setItem(K_FOTO, daten); else localStorage.removeItem(K_FOTO);
    } catch (e) { return false; }
    konsoleZeichnen();
    return true;
  }
  function konsoleFotoLesen(datei, groesse) {
    return new Promise((ok, nein) => {
      const url = URL.createObjectURL(datei);
      const img = new Image();
      img.onload = () => {
        const f = Math.min(1, (groesse || 1400) / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * f));
        c.height = Math.max(1, Math.round(img.naturalHeight * f));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); nein(new Error('kein Bild')); };
      img.src = url;
    });
  }

  // Strecke: auf der Bahn Scan/Editor/Laden, frei Druckvorlagen/Editor.
  function konsoleStreckeModus() {
    const bahn = ($('setting-ontrack') || {}).checked;
    document.querySelectorAll('#sub-home-track [data-modus]').forEach((k) => {
      k.hidden = k.dataset.modus !== (bahn ? 'bahn' : 'frei');
    });
  }

  // ---- Gamepad: Titel und Options halten (aus pollGamepad, 90-ghosts.js) -------------
  const kPadVorher = [];
  let kOptionsSeit = 0, kOptionsGefeuert = false;
  let kTitelSperre = false;   // nach dem Titel: warten, bis alle Tasten losgelassen sind

  // Steuerkreuz im Menue: erster Druck sofort, gehalten nach 350 ms alle 120 ms - wie im
  // Mock-up. Fuer Einstellungszeilen hat menuNavAdjustGehalten() seine eigene Uhr.
  const kWdh = {};
  function konsoleWdh(dir, gedrueckt) {
    const jetzt = performance.now();
    const z = kWdh[dir] || (kWdh[dir] = { an: false, seit: 0, letzt: 0 });
    if (!gedrueckt) { z.an = false; return false; }
    if (!z.an) { z.an = true; z.seit = jetzt; z.letzt = jetzt; return true; }
    if (jetzt - z.seit > 350 && jetzt - z.letzt > 120) { z.letzt = jetzt; return true; }
    return false;
  }
  // Gibt true zurueck, wenn der Titel die Tasten verbraucht hat - dann tut pollGamepad in
  // diesem Takt sonst nichts (kein Hochschalten mit Kreis auf dem Titelbildschirm).
  function konsolePadTitel(pad) {
    let neu = false;
    for (let i = 0; i < pad.buttons.length; i++) {
      const n = !!(pad.buttons[i] && pad.buttons[i].pressed);
      if (n && !kPadVorher[i]) neu = i;
      kPadVorher[i] = n;
    }
    if (kTitelSperre) {
      if (kPadVorher.some(Boolean)) return true;
      kTitelSperre = false;
      return false;
    }
    if (kAktiverTab() !== 'home') return false;
    if (neu === 14 || neu === 15 || neu === 4 || neu === 5) { setLang(lang === 'de' ? 'en' : 'de'); return true; }
    // BESTELLT: "'Press any key' und 'press triangle for tutorial' ist auch etwas
    // verwirrend. Ich wuerde sagen: X zum Starten, Dreieck fuer Tutorial, Kreis fuer
    // Steuerung." Alle anderen Tasten tun auf dem Titel nichts mehr.
    if (neu === 0) { konsoleTitelWeiter(); kTitelSperre = true; return true; }
    if (neu === 3) { kTitelSperre = true; konsoleTourStart(K_TOUR); return true; }
    if (neu === 1) { kTitelSperre = true; konsoleTourStart(K_STEUERUNG); return true; }
    return true;
  }
  // Options: im Cockpit ins Fahren-Menue, in den Menues zurueck ins Cockpit. Nur die
  // steigende Flanke zaehlt - eine gehaltene Taste springt nicht hin und her.
  function konsoleOptionsTaste(gedrueckt) {
    if (gedrueckt && !konsoleOptionsTaste.vorher && !kFrageOffen
        && !(typeof konsoleTourOffen === 'function' && konsoleTourOffen())
        && !document.body.classList.contains('track-fs')) {
      const tab = kAktiverTab();
      if (tab === 'race') {
        // BESTELLT: "Options waehrend einer Challenge beendet die Challenge und zeigt das
        // Ergebnis". requestRaceStop() -> finishRace() -> challengeRennenEnde() wertet und
        // zeigt den Ergebnis-Dialog. Nichts zaehlt mehr, auch der Abbruch in die Rennmaschine.
        if (typeof challengeLaeuft === 'function' && challengeLaeuft() && kRennenLaeuft()) {
          requestRaceStop();
        } else {
          konsoleZumMenue();
        }
      }
      else if (tab && tab !== 'home') konsoleInsCockpit(true);
    }
    konsoleOptionsTaste.vorher = gedrueckt;
  }

  // ---- Tastatur ----------------------------------------------------------------------
  // IM ERFASSUNGSLAUF (capture), damit der Titel jede Taste bekommt, bevor die Fahrtasten
  // sie sehen, und damit Esc/Q/E/Leertaste in Menues nicht zusaetzlich fahren.
  window.addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (e.target && e.target.closest && e.target.closest('input[type="text"], input[type="number"], textarea, select')) return;
    if (kAktiverTab() === 'home' && !e.ctrlKey && !e.altKey && !e.metaKey && k !== 'tab' && k !== 'shift') {
      e.preventDefault(); e.stopImmediatePropagation();
      // Tastatur wie am Pad: Enter, Leertaste oder X starten, T das Tutorial, S die Steuerung.
      if (k === 'arrowleft' || k === 'arrowright') setLang(lang === 'de' ? 'en' : 'de');
      else if (k === 't') konsoleTourStart(K_TOUR);
      else if (k === 's') konsoleTourStart(K_STEUERUNG);
      else if (k === 'enter' || k === ' ' || k === 'x') konsoleTitelWeiter();
      return;
    }
    if (kAktiverTab() === 'race' && !kFrageOffen && k === 'escape' && !document.body.classList.contains('track-fs')) {
      e.preventDefault(); e.stopImmediatePropagation();
      konsoleZumMenue();
      return;
    }
    if (!konsoleMenue() || e.repeat) return;
    if (document.body.classList.contains('track-fs')) return;
    if (k === 'escape' || k === 'backspace') {
      if (konsoleZurueck()) { e.preventDefault(); e.stopImmediatePropagation(); }
    } else if (k === 'q' || k === 'e') {
      if (konsoleReiterSchritt(k === 'q' ? -1 : 1)) { e.preventDefault(); e.stopImmediatePropagation(); }
    } else if (k === ' ') {
      if (konsoleQuadrat()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }, true);

  // ---- Klicks ------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    // Titel: ein Klick irgendwo (ausser auf Sprache, Links, Knoepfe) fuehrt weiter.
    if (kAktiverTab() === 'home' && e.target.closest('#tab-home')
        && !e.target.closest('#lang-toggle, a, button, .app-update')) {
      konsoleTitelWeiter();
      return;
    }
    const k = e.target.closest('[data-k-sub]');
    if (k) { setTimeout(() => showSubpage(k.dataset.kSub), 0); }
    const sc = e.target.closest('[data-k-scroll]');
    if (sc) setTimeout(() => konsoleHinScrollen(sc.dataset.kScroll), 30);
  });

  // Zu einem Element auf der offenen Seite springen und die Zeile darum anwaehlen - fuer
  // "Strecke laden", das im Editor bei den gespeicherten Strecken landet (dort wird eine
  // Strecke auch gespeichert, deshalb keine zweite Liste).
  function konsoleHinScrollen(id) {
    const el = $(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    const rows = menuNavRows();
    const i = rows.findIndex((r) => r.el === el || r.el.contains(el));
    if (i >= 0) { menuNavIndex = i; menuNavGezeigt = true; menuNavRender(); }
  }

  function konsoleEinrichten() {
    const kn = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    kn('fa-auto', (e) => { if (!e.target.closest('.k-knopf')) konsoleAuto(); });
    kn('fa-verbinden', () => { konsoleVerbinden(); });
    kn('fa-garage', () => konsoleZeige('garage'));
    kn('fa-start', () => { konsoleLosfahren(); });
    kn('fa-renn', () => konsoleZeige('control'));
    kn('fa-strecke', (e) => { if (!e.target.closest('.k-knopf')) konsoleZeige('track'); });
    kn('fa-scan', () => konsoleZeige('track', 'scan'));
    kn('fa-editor', () => konsoleZeige('track', 'edit'));
    kn('fa-laden', () => konsoleZeige('track', 'laden'));
    kn('fa-druck', () => konsoleZeige('track', 'print'));
    kn('fa-profil', () => konsoleZeige('options', 'opt-feel'));
    // BESTELLT: "wenn ich auf den Header tippe, soll es zur naechsten Option schalten".
    // Der Kachelkopf (Titel + Wert) dreht die Schaltstellung weiter, der Rest der Kachel
    // oeffnet wie bisher die Unterseite. Das Gamepad bleibt unveraendert (Quadrat/links/rechts).
    [['fa-strecke', 'bahn'], ['fa-renn', 'renntyp'], ['fa-profil', 'profil'], ['fa-motor', 'motor']]
      .forEach(([tileId, quad]) => {
        const tile = $(tileId);
        if (!tile) return;
        tile.querySelectorAll('.k-kk, .k-kt').forEach((el) => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            konsoleQuadWechsel(quad, 1);
          });
        });
      });
    // Die Pfeile des Motorsound-Kachelkopfs blaettern vor und zurueck (nicht das Gamepad).
    document.querySelectorAll('.k-arrow').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        konsoleQuadWechsel(el.dataset.quad, parseInt(el.dataset.dir, 10));
      });
    });
    kn('race-menue', () => konsoleZumMenue());
    document.querySelectorAll('.info-open').forEach((el) => el.addEventListener('click', () => konsoleZeige('info', el.dataset.sub)));
    kn('mp-erkl-knopf', (e) => { e.stopPropagation(); optInfoOeffnen(t('Beitreten und Rangliste'), $('mp-erkl').innerHTML); });
    kn('mp-app-erkl-knopf', (e) => { e.stopPropagation(); optInfoOeffnen(t('Host'), $('mp-app-erkl').innerHTML); });
    kn('k-ergebnis', () => { kErgebnisWartet = true; konsoleInsCockpit(); });
    kn('fa-motor', () => konsoleZeige('options', 'opt-sound'));
    kn('fa-foto', () => { const d = $('fa-foto-datei'); if (d) { d.value = ''; d.click(); } });
    kn('fa-foto-weg', () => {
      konsoleFrage(t('Streckenfoto löschen?'), '', [[t('Löschen'), () => { konsoleFotoSetzen(''); }], [t('Abbrechen'), null]]);
    });
    const datei = $('fa-foto-datei');
    if (datei) {
      datei.addEventListener('change', () => {
        const f = datei.files && datei.files[0];
        if (!f) return;
        konsoleFotoLesen(f).then((daten) => {
          if (!konsoleFotoSetzen(daten)) {
            konsoleFrage(t('Foto zu groß'), t('Der Speicher des Browsers ist voll. Ein kleineres Bild versuchen.'), [[t('Schließen'), null]]);
          }
        }).catch(() => konsoleFrage(t('Kein Bild'), t('Diese Datei ließ sich nicht als Bild lesen.'), [[t('Schließen'), null]]));
      });
    }
    for (const id of ['race-mode', 'setting-ontrack', 'sound-profile', 'race-limit', 'race-wx-start', 'setting-dev']) {
      const el = $(id);
      if (el) el.addEventListener('change', () => setTimeout(konsoleZeichnen, 0));
    }
    // SOFORT und nicht verzoegert: setLang() ruft diese Neuzeichner VOR dem Uebersetzen der
    // Textknoten, und Pfad/Status/Fussleiste sind zusammengesetzt - verzoegert stuenden sie
    // im englischen Modus einen Takt lang deutsch da (der Sprachtest hat "HAUPTMENÜ" gefunden).
    if (typeof i18nOnLangChange === 'function') i18nOnLangChange(konsoleZeichnen);
    // Der Status (Autos) und die Fahren-Kacheln aendern sich auch ohne Tab-Wechsel.
    setInterval(() => {
      const tab = kAktiverTab();
      if (tab === 'fahren') konsoleZeichnen();
    }, 1500);
    // Der gemeinsame Mehrspieler-Block steht zuerst beim Weg ueber den PC.
    const mpg = $('mp-gemeinsam'), platz = document.querySelector('#sub-mp-pc .mp-platz');
    if (mpg && platz) platz.appendChild(mpg);
    konsoleZeichnen();
  }
  setTimeout(konsoleEinrichten, 0);

