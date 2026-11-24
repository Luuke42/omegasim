
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
  // BESTELLT (v0.9.20): "Tausche die Tabs WLAN MEHRSPIELER und CHALLENGES (zuerst CHALLENGES)".
  // v1.3.5 BESTELLT: "WLAN-Mehrspieler nicht als eigenen Tab, sondern als Button in der
  // FAHREN -> Garage-Kachel" - mp ist jetzt eine tiefe Seite unter Fahren (#fa-mp).
  const K_EBENE1 = ['fahren', 'challenges', 'options', 'misc'];
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
    garage: 'fahren', info: 'options', control: 'fahren', track: 'fahren', mp: 'fahren',
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
    // v1.1.3: in der virtuellen Fahrt faehrt das Pad, kein Menue (60d-virtuell.js).
    if (typeof vfAktiv === 'function' && vfAktiv()) return false;
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
    // v1.3.5: zurueck auf dem Titel ist wieder "Starten" gewaehlt (96-home.js).
    // try: waehrend des Ladens liegen HOME_START & Co. (96-home.js) noch in der Todeszone.
    if (neu === 'home') { try { homeFokusSetzen(HOME_START); } catch (e) { /* noch nicht geladen */ } }
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
    // Raumgestalter offen: die Zurueck-Taste schliesst ihn (v0.9.45, "komme nicht mehr raus").
    if (typeof raumDsOffen === 'function' && raumDsOffen()) { raumDsSchliessen(); return true; }
    if ($('mp-info') && !$('mp-info').hidden && typeof mpiStop === 'function') { mpiStop(); return true; }
    // v1.0.22: die Zurueck-Taste schliesst auch die Meisterschaft (vorher kam man nur ueber das Kreuz raus).
    if (typeof meisterOffen === 'function' && meisterOffen()) { meisterSchliessen(); return true; }
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
    // v1.4.33: Kreis schliesst das Setup-Fenster (98i-setup.js) und bleibt in der Garage.
    if (typeof setupFensterOffen === 'function' && setupFensterOffen()) { setupSchliessen(); return true; }
    if (typeof kiFensterOffen === 'function' && kiFensterOffen()) { kiSchliessen(); return true; }
    if (typeof showFensterOffen === 'function' && showFensterOffen()) { showSchliessen(); return true; }
    if (typeof karFensterOffen === 'function' && karFensterOffen()) { karSchliessen(); return true; }
    if (typeof zlFensterOffen === 'function' && zlFensterOffen()) { zlFensterSchliessen(); return true; }
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
    if (typeof streckenbildOffen === 'function' && streckenbildOffen()) { streckenbildZu(); return true; }
    if (typeof menuNavGarageZurueck === 'function' && menuNavGarageZurueck()) return true;
    const tab = kAktiverTab();
    // Eine Community-Strecke (v0.9.49) geht zurueck in ihre Liste, nicht auf die Kacheln.
    if (typeof chCommunitySeiteOffen === 'function' && chCommunitySeiteOffen()) { showSubpage('ch-community'); return true; }
    // v1.3.15: eine Strecke mit Zeiten geht zurueck in die Liste (seit v1.3.62 die gemeinsame Community-Seite).
    if ($('sub-ch-sk') && $('sub-ch-sk').classList.contains('on')) { showSubpage('ch-community'); return true; }
    if (tab === 'info' && document.querySelector('#tab-info .subpage.on')) { konsoleZeige('fahren'); return true; }
    if (document.querySelector('.tabpage.active .subpage.on')) { showSubpage(''); return true; }
    // v1.3.15: das gefuehrte Tutorial wartet auf Auto und Gamepad - Kreis/Esc bricht es ab.
    if (typeof tutLaeuft === 'function' && tutLaeuft()) { tutAbbrechen('Kreis/Esc'); return true; }
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
              : k.dataset.sub === (offen.id === 'sub-ch-strecke' ? 'ch-community'
                : offen.id === 'sub-ch-sk' ? 'ch-community' : offen.id.replace(/^sub-/, '')),
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
          let el = $(id);
          // Noch kein Rennen: der Platzhalter "Aktuell keine Ergebnisse verfuegbar" (v1.0.22).
          if (id === 'race-results' && el && el.style.display === 'none' && $('race-results-leer')) el = $('race-results-leer');
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
    const WISCH_RAND_PX = 48;
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
      // v0.9.33, GEMELDET: "Swipen passiert auch, wenn ich rechts nur meine Handy-Buttons haben
      // moechte und dazu vom Rand aus 1 cm nach innen wische." Eine Geste, die am Rand
      // beginnt, gehoert dem System (Navigationsleiste, Zurueck-Geste) - quer liegt die
      // Unterkante des Telefons links oder rechts. Rund 1,2 cm (48 px) an allen Seiten ausser oben.
      const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
      if (x0 < WISCH_RAND_PX || x0 > window.innerWidth - WISCH_RAND_PX || y0 > window.innerHeight - WISCH_RAND_PX) return;
      a = { x: x0, y: y0, t: performance.now() };
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
  // ---- FAHRMODUS ECHT | VIRTUELL (v1.6.23, Issue #7, WIP) ----
  // BESTELLT: "Auf der FAHREN-Seite ein Umschalter zwischen echtem und virtuellem Fahren statt der Kachel 'Virtuell
  // fahren'. Im Modus Virtuell zeigt die Garage das gewaehlte virtuelle Auto und die Optionen der virtuellen Fahrt;
  // im Modus Echt wie bisher. Spaeter dritter Modus Augmented Reality." Gemerkt unter FAHR_MODUS_STORE. Im Modus
  // Virtuell zeigt die Autos-Kachel das virtuelle Auto (Vorschaubild, Name, Strecke), Verbinden und Mehrspieler sind
  // ausgeblendet, "Garage" oeffnet die Optionen der virtuellen Fahrt und die Startkachel startet sie.
  var FAHR_MODUS_STORE = 'omegasim-fahrmodus';
  function fahrModusVirtuell() { try { return localStorage.getItem(FAHR_MODUS_STORE) === 'virtuell'; } catch (e) { return false; } }
  function fahrModusSetzen(m) {
    const v = m === 'virtuell';
    try { localStorage.setItem(FAHR_MODUS_STORE, v ? 'virtuell' : 'echt'); } catch (e) { /* egal */ }
    konsoleFahrenZeichnen();
    if (typeof chFahrtGewechselt === 'function') chFahrtGewechselt();   // v1.6.56: Challenges zeigen die Zeiten des Modus
  }
  // Garage im passenden Modus oeffnen: virtuell mit den Optionen der virtuellen Fahrt rechts.
  // v1.6.32: im Modus Virtuell die eigenstaendige virtuelle Garage (#tab-vgarage, 60d-virtuell.js).
  function konsoleGarageOeffnen() {
    if (fahrModusVirtuell() && typeof vfGarageZeigen === 'function') { vfGarageZeigen(); window.scrollTo(0, 0); return; }
    try { garVirtuellAuf = false; } catch (e) { /* egal */ }
    konsoleZeige('garage');
  }
  function konsoleVirtuellStarten() {
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return; }
    if (typeof virtuellStarten === 'function') virtuellStarten();
  }
  function konsoleQuadWechsel(q, dir) {
    if (q === 'fahrmodus') {
      fahrModusSetzen(fahrModusVirtuell() ? 'echt' : 'virtuell');
    } else if (q === 'renntyp') {
      const s = $('race-mode');
      // v1.2.4: nur erlaubte Renntypen (renntypenFiltern sperrt die anderen je Sensormodus).
      const n = s.options.length;
      let i = s.selectedIndex;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!s.options[i].disabled) break;
      }
      s.selectedIndex = i;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (q === 'bahn' && fahrModusVirtuell() && typeof vfStreckeWechseln === 'function') {
      vfStreckeWechseln(dir);   // v1.6.23: virtuell blaettert die Kachel durch gebaute Bahn und Rollrennstrecken
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
    if (quad === 'bahn' && fahrModusVirtuell() && typeof vfStreckenListe === 'function') {
      const l = vfStreckenListe();
      return { anzahl: l.length, index: l.indexOf(vfFreiWahl()) };
    }
    if (quad === 'bahn') {
      const cb = $('setting-ontrack');
      return { anzahl: 2, index: cb && cb.checked ? 1 : 0 };
    }
    if (quad === 'renntyp') {
      const s = $('race-mode');
      const frei = s ? [...s.options].filter((o) => !o.disabled) : [];
      return { anzahl: frei.length, index: s ? frei.indexOf(s.options[s.selectedIndex]) : -1 };
    }
    if (quad === 'profil') {
      const keys = window.__presetKeysFahren ? window.__presetKeysFahren()
        : (window.__presetKeys ? window.__presetKeys() : []);
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

  // ---- Mehrspieler-Stand in der Autos-Kachel (v1.3.5) --------------------------------
  // "Dort dann anzeigen, wenn man hostet oder wo man beigetreten ist." Aus dem vorhandenen
  // Zustand: mpAppHost (Host-Plugin der App, 97b-app.js), mp (Fahrer) und mpi (Info-Screen),
  // beide 97-sessions.js. Nur Text setzen - gerufen beim Zeichnen der Kachel und wenn sich der
  // Zustand aendert, nie im Takt.
  function konsoleMpStatus() {
    const el = $('fa-mp-status');
    if (!el) return;
    let text = '';
    try {
      const ohne = (h) => String(h || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      if (mpAppHost.laeuft) text = t('Host:') + ' ' + (ohne(mpAppHost.url) || t('keine WLAN-Adresse'));
      else if (mp.an && mp.host) text = t('Verbunden mit') + ' ' + ohne(mp.host);
      else if (mpi.an && mpi.host) text = t('Info-Screen:') + ' ' + ohne(mpi.host);
    } catch (e) { text = ''; }
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  }

  // ---- Verbindungsfehler in der Autos-Kachel (v1.5, WIP) ------------------------------
  // "Verbinden fehlgeschlagen: <Grund>" unter dem Status, bis zum naechsten erfolgreichen Verbinden. Die
  // Lage kommt aus 90-ghosts.js (verbLage). Nur Text setzen - gerufen, wenn sie sich aendert und beim
  // Zeichnen der Kachel, nie im Takt. Antippen oeffnet den Dialog mit "Protokoll kopieren".
  function konsoleVerbLage() {
    const el = $('fa-verb-lage');
    if (!el) return;
    let text = '', hinweis = false;
    try { text = verbLageText(); hinweis = verbLage.art === 'hinweis'; } catch (e) { text = ''; }
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('hinweis', hinweis);
    el.hidden = !text;
  }
  function konsoleVerbFrage() {
    let text = '';
    try { text = verbLageText(); } catch (e) { text = ''; }
    if (!text) return false;
    konsoleFrage(t(verbLage.art === 'hinweis' ? 'Schonend verbunden' : 'Verbinden fehlgeschlagen'), text,
      [[t('Protokoll kopieren'), async () => { if (!(await verbProtoKopieren())) konsoleZeige('garage'); }],
       [t('Nochmal verbinden'), () => konsoleVerbinden()], [t('Schließen'), null]], true);
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
      // v1.5: kein Auto und ein Fehlschlag - der Grund kommt als Dialog, nicht nur ins Live-Log.
      else if (verbLage.art === 'fehler') konsoleVerbFrage();
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
    // v1.5: Fehlschlag (kein neues Auto, aber ein Grund) - als Dialog mit "Protokoll kopieren".
    else if (verbLage.art === 'fehler') konsoleVerbFrage();
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
    // v1.6.56 BESTELLT: "Alles soll analog gehandhabt sein, also auch woechentliche und Dauerrennen, Karriere usw."
    // Im Modus Virtuell faehrt das virtuelle Auto auf der Strecke des Editors; das Rennen selbst (Ampel, Wertung,
    // Karriere, Meisterschaft) laeuft wie mit dem echten Auto, die virtuelle Fahrt fuehrt kein eigenes (extern).
    if (fahrModusVirtuell() && typeof virtuellStarten === 'function' && !(typeof vfAktiv === 'function' && vfAktiv())) {
      if (!currentTrackTiles || currentTrackTiles.length < 4) { showHudToast(t('Diese Runde braucht eine Strecke: erst scannen, laden oder bauen.')); return; }
      if (!virtuellStarten({ tiles: currentTrackTiles, extern: 'rennen' })) return;
      if (raceState === 'idle' || raceState === 'finished') toggleRace();
      return;
    }
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
  function konsoleZumMenue(bestaetigt) {
    // BESTELLT (v0.9.22): "Wenn ich waehrend eines Rennens auf Optionen oder den Zurueckpfeil
    // klicke, sag mir 'Ein Wechsel ins Menue beendet das Rennen.' mit 'Rennen beenden' und
    // 'Weiterfahren'. Solange der Screen da ist, soll das Rennen weitergehen." Der Dialog
    // haelt nichts an; Weiterfahren ist vorgewaehlt, damit ein versehentlicher Druck nichts
    // beendet.
    if (!bestaetigt && typeof kRennenLaeuft === 'function' && kRennenLaeuft()) {
      const knoepfe = [[t('Weiterfahren'), null], [t('Rennen beenden'), () => konsoleZumMenue(true)]];
      if (typeof mp !== 'undefined' && mp.an && mp.rennenId && typeof mpRennenBeendenFuerAlle === 'function') {
        knoepfe.push([t('Rennen für alle beenden'), () => { mpRennenBeendenFuerAlle(); konsoleZumMenue(true); }]);
      }
      konsoleFrage(t('Ein Wechsel ins Menü beendet das Rennen.'), '', knoepfe);
      return;
    }
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

  // ---- Reiterleisten fuellen, zweite Leiste als Fenster (v1.5.x) ----------------------
  // BESTELLT: "Darstellung der Submenü-Leiste: hier sind vor allem bei den Optionen zu viele
  // Reiter nebeneinander. Zeige immer nur 3 oder 4 und dann gib mit Pfeilen an, ob links und
  // rechts auch noch Tabs sind. Und dann rutschen die durch beim Durchschalten."
  //
  // konsoleZeichnen() laeuft oft (auf dem Fahren-Schirm alle 1,5 s, dazu bei jedem Wechsel).
  // Gebaut wird deshalb nur, wenn sich die BESCHRIFTUNGEN aendern; sonst wechselt hoechstens
  // die Markierung und die Lage des Fensters. Die Klicks haengen an der Leiste (ein Zuhoerer,
  // konsoleEinrichten) und lesen die aktuelle Liste aus kLeisteStand, nicht aus einer alten
  // Huelle - so bleibt ein nicht neu gebauter Knopf richtig verdrahtet.
  const K_FENSTER_MAX = 4;
  const kLeisteStand = { eins: { sig: null, r: null }, zwei: { sig: null, r: null, start: 0, an: false, sicht: 0 } };
  let kSchmalMq = null;
  // Wie viele Reiter das Fenster fasst: 4, im Hochformat und in schmalen Fenstern 3. Die
  // Medienabfrage wird einmal angelegt und meldet Drehen/Groessenwechsel selbst.
  function kFensterSicht() {
    if (!kSchmalMq && window.matchMedia) {
      kSchmalMq = window.matchMedia('(orientation: portrait), (max-width: 620px)');
      const neu = () => { try { konsoleZeichnen(); } catch (e) { /* Ladefolge */ } };
      if (kSchmalMq.addEventListener) kSchmalMq.addEventListener('change', neu);
    }
    return kSchmalMq && kSchmalMq.matches ? K_FENSTER_MAX - 1 : K_FENSTER_MAX;
  }
  // Der erste sichtbare Reiter. Der aktive steht moeglichst mittig (bei 4 an zweiter Stelle),
  // an den Enden liegt das Fenster buendig. Ohne aktiven Reiter bleibt es, wo es war.
  function kFensterStart(n, aktiv, sicht, vorher) {
    if (n <= sicht) return 0;
    const max = n - sicht;
    if (aktiv < 0) return Math.max(0, Math.min(max, vorher || 0));
    return Math.max(0, Math.min(max, aktiv - Math.floor((sicht - 1) / 2)));
  }
  function kLeisteFuellen(name, leiste, host, r, fenster) {
    if (!leiste) return;
    const st = kLeisteStand[name];
    const warZu = leiste.hidden;
    if (leiste.hidden !== !r) leiste.hidden = !r;
    st.r = r;
    if (!r || !host) return;
    let sig = '';
    for (let i = 0; i < r.length; i++) sig += r[i].text + '\n';
    const neuGebaut = sig !== st.sig;
    if (neuGebaut) {
      st.sig = sig;
      host.textContent = '';
      r.forEach((x, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = x.text;
        b.dataset.i = i;
        if (x.an) b.className = 'an';
        host.appendChild(b);
      });
    } else {
      const kn = host.children;
      for (let i = 0; i < kn.length && i < r.length; i++) {
        const an = !!r[i].an;
        if (kn[i].classList.contains('an') !== an) kn[i].classList.toggle('an', an);
      }
    }
    if (!fenster) return;
    const n = r.length, sicht = kFensterSicht();
    const an = n > sicht;
    const aktiv = r.findIndex((x) => x.an);
    const start = kFensterStart(n, aktiv, sicht, st.start);
    if (!neuGebaut && !warZu && st.an === an && st.sicht === sicht && st.start === start) return;
    // Rutschen nur beim Durchschalten: erscheint die Leiste gerade erst oder ist sie neu
    // gebaut, steht das Fenster sofort richtig.
    const springen = neuGebaut || warZu || st.an !== an || st.sicht !== sicht;
    st.an = an; st.sicht = sicht; st.start = start;
    leiste.classList.toggle('k-fenster-an', an);
    leiste.style.setProperty('--k-sicht', String(sicht));
    host.style.transition = springen ? 'none' : '';
    host.style.transform = an && start ? 'translateX(' + (-start * 100 / sicht).toFixed(4) + '%)' : '';
    // Reiter ausserhalb des Fensters nimmt die Tab-Taste nicht: ein Fokus dort wuerde das
    // Fenster von selbst verschieben.
    const kn = host.children;
    for (let i = 0; i < kn.length; i++) kn[i].tabIndex = !an || (i >= start && i < start + sicht) ? 0 : -1;
    const pl = $('k-pfeil-l'), pr = $('k-pfeil-r');
    if (pl) { pl.hidden = !an; pl.disabled = !an || start <= 0; }
    if (pr) { pr.hidden = !an; pr.disabled = !an || start + sicht >= n; }
  }

  // ---- Zeichnen: Kopf, Reiter, Beschreibung, Fuss, Hintergrund -----------------------
  function konsoleZeichnen() {
    const tab = kAktiverTab();
    document.body.classList.toggle('k-titel-an', tab === 'home');
    // Der Fahren-Schirm fuellt genau den Bildschirm (CSS: body.k-kacheln).
    document.body.classList.toggle('k-kacheln', tab === 'fahren');
    // v1.1.3: die Garage mit fester Hoehe und zwei Bildlaeufen (CSS: body.k-garage).
    document.body.classList.toggle('k-garage', tab === 'garage');
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
    kLeisteFuellen('eins', $('k-leiste'), $('k-reiter'), r1, false);
    kLeisteFuellen('zwei', $('k-leiste2'), $('k-band2'), r2, true);
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
  const K_ROLLE = { player: 'Steuern', player2: 'Spieler 2', player3: 'Spieler 3', ghost: 'NPC',
                    safetycar: 'Safety Car', challenger: 'Challenger', reinig: 'Reinigungsfahrzeug (WIP)', none: 'Aus' };
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

  // v1.5: Symbole auf der Garagenkachel: zweiter Laptop verbunden (98m-zwei-laptops.js), Onboard-Kamera mit Bild
  // (75-onboard.js). Wird auch von dort bei jeder Aenderung gerufen.
  const K_SYMBOL_LAPTOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>';
  const K_SYMBOL_KAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  function konsoleFahrenGeraete() {
    const el = $('fa-auto-geraete');
    if (!el) return;
    let laptop = false, kamera = false;
    try { laptop = typeof zl !== 'undefined' && !!zl && !!zl.offen; } catch (e) { laptop = false; }
    try { kamera = typeof onboardAktiv === 'function' && onboardAktiv(); } catch (e) { kamera = false; }
    const html = (laptop ? '<i title="' + t('Zweiter Laptop verbunden') + '">' + K_SYMBOL_LAPTOP + '</i>' : '')
      + (kamera ? '<i title="' + t('Onboard-Kamera verbunden') + '">' + K_SYMBOL_KAMERA + '</i>' : '');
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = !html;
  }
  function konsoleFahrenZeichnen() {
    if (!$('fa-auto')) return;
    konsoleFahrenGeraete();
    const autos = kAutos();
    // v1.6.23 (Issue #7): Modus Virtuell - die Autos-Kachel zeigt das virtuelle Auto.
    const vfM = fahrModusVirtuell(), vfId = vfM && typeof vfAutoWahl === 'function' ? vfAutoWahl() : '';
    document.body.classList.toggle('fm-virtuell', vfM);
    if (typeof chFahrtZeichnen === 'function') chFahrtZeichnen();   // v1.6.56: Umschalter auf der Challenge-Seite
    document.querySelectorAll('#fa-modus [data-fm]').forEach((b) => {
      const an = (b.dataset.fm === 'virtuell') === vfM;
      b.classList.toggle('an', an); b.setAttribute('aria-pressed', an ? 'true' : 'false');
    });
    if ($('fa-verbinden')) $('fa-verbinden').hidden = vfM;
    if ($('fa-mp')) $('fa-mp').hidden = vfM;
    $('fa-auto-titel').textContent = vfM ? t('Virtuelles Auto') : autos.length ? autos.length + ' ' + t('verbunden') : t('Autos verbinden');
    // BESTELLT v0.8.126: mehrere verbundene Autos mit Fotos gemeinsam zeigen (die Garage auf dem
    // Fahren-Schirm). Erst ab zwei Fotos, sonst bleibt es beim einen Bild des Fahrer-Autos.
    // v0.9.31, GEMELDET: "mit 2 Autos 'Steuern' und 'Spieler 2' wurde nur eins angezeigt" -
    // die Galerie kam erst ab ZWEI FOTOS. Jetzt ab zwei verbundenen Autos; eines ohne Foto
    // steht als Farbflaeche mit seinem Zeichen darin.
    const mitFotos = autos.filter((c) => c.role !== 'none').slice(0, 4);
    const galerieAn = !vfM && mitFotos.length >= 2;
    const faAuto = $('fa-auto');
    if (faAuto) faAuto.classList.toggle('k-auto-mehr', galerieAn);
    // Das eigene Foto des Fahrer-Autos (Garage) statt des Beispielbilds.
    const fahrer = autos.find((c) => c.role === 'player') || autos[0];
    const afoto = fahrer && typeof autoFoto === 'function' ? autoFoto(fahrer) : '';
    const ab = $('fa-auto-bild');
    let abNeu;
    if (galerieAn) {
      abNeu = 'galerie:' + mitFotos.map((c) => (c.device ? c.device.id : '') + ':' + c.role + ':' + autoFoto(c).length).join('|');
    } else {
      abNeu = afoto ? 'foto:' + afoto.length : 'auto';
    }
    if (vfM) abNeu = 'vf:' + vfId;
    if (ab && ab.dataset.bild !== abNeu) {
      if (galerieAn) {
        ab.style.backgroundImage = 'none';
        ab.innerHTML = '';
        const gal = document.createElement('div');
        gal.className = 'k-auto-galerie';
        mitFotos.forEach((c) => {
          const zelle = document.createElement('div');
          zelle.className = 'k-auto-zelle';
          const f = autoFoto(c);
          if (f) zelle.style.backgroundImage = 'url("' + f + '")';
          else {
            zelle.style.background = 'linear-gradient(135deg,' + carColor(c).hex + ' 0%,' + carColor(c).hex + ' 55%,rgba(0,0,0,.55) 100%)';
            zelle.dataset.zeichen = c.tagChar || '';
            zelle.classList.add('k-auto-ohne-foto');
          }
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
      } else if (vfM) {
        // Vorschaubild des virtuellen Autos (Seitenansicht), dahinter das Bild der virtuellen Fahrt.
        // v1.6.37: transparentes Vorschaubild auf dem Garagenbild der virtuellen Fahrt (BESTELLT: garage_virtual).
        // v1.6.81: die Vorschaubilder haben jetzt einen eigenen grauen Hintergrund (BESTELLT: "Vorschaubilder nochmal
        // aufhuebschen mit grauem Hintergrund (leichter Farbverlauf)") - sie fuellen die Kachel allein.
        ab.style.backgroundImage = 'url("' + vfVorschauUrl(vfId) + '")';
        ab.innerHTML = '';
      } else {
        ab.style.backgroundImage = afoto ? 'url("' + afoto + '")' : 'url(img/garage.jpg)';   // v1.0.15: Garagenfoto (BESTELLT)
        ab.innerHTML = '';
      }
      ab.dataset.bild = abNeu;
    }
    konsoleMpStatus();
    konsoleVerbLage();
    kZeilen($('fa-auto-info'), vfM ? [[t('Auto'), vfAutoName(vfId)], [t('Strecke'), vfStreckeName()]] : autos.length
      ? autos.map((c) => [kPunkt(carColor(c).hex, garageLabel(c)), t(K_ROLLE[c.role] || c.role)])
      : [[t('Status'), t('nicht verbunden')]]);
    const rm = $('race-mode');
    const modus = rm.selectedOptions[0] ? rm.selectedOptions[0].textContent : '';
    $('fa-renn-titel').textContent = modus;
    // Rennoptionen-Kachel wechselt mit dem Rennmodus das Bild (BESTELLT v0.8.53).
    const rmBild = { practice: 'rennoptionen-practice', endurance: 'rennoptionen-endurance',
                     qualifying: 'rennoptionen-qualifying', laps: 'rennoptionen-laps',
                     knockout: 'knockout', derby: 'derby', bestzeit: 'rennoptionen-bestzeit' }[rm.value];
    const rb = $('fa-renn-bild');
    if (rb && rmBild && rb.dataset.bild !== rmBild) {
      rb.style.backgroundImage = 'url(img/' + rmBild + '.jpg)';
      rb.dataset.bild = rmBild;
    }
    const wx = $('race-wx-start');
    kZeilen($('fa-renn-info'), [
      // Freies Training laeuft ohne Ende: dort steht das Unendlich statt einer Minutenzahl.
      rm.value === 'bestzeit' ? [t('Bestzeit'), (() => {
        const b = typeof bestzeitAktuell === 'function' ? bestzeitAktuell(playerCar) : null;
        return b ? formatLapTime(b.beste) + ' ' + (typeof chSterneZeichen === 'function' ? chSterneZeichen(b.medaille) : '') : '–';
      })()]
      : rm.value === 'practice' ? [t('Dauer'), (+(($('race-limit') || {}).value) > 0 ? $('race-limit').value + ' min' : '∞')]
        : [($('race-limit-label') || {}).textContent || t('Dauer'), ($('race-limit') || {}).value || '–'],
      [t('Wetter'), wx && wx.selectedOptions[0] ? wx.selectedOptions[0].textContent : '–'],
      [t('Pflichtboxenstopps'), ($('race-pit-required') || {}).value || '0'],
    ]);
    const bahn = ($('setting-ontrack') || {}).checked;
    const foto = konsoleFoto();
    // v1.6.23: im Modus Virtuell die gewaehlte Strecke der virtuellen Fahrt (gebaute Bahn oder Rollrennstrecke).
    const vfK = vfM && typeof vfFreiWahl === 'function' ? vfFreiWahl() : '';
    const vfFreiKarte = vfK && typeof vfFreiCache !== 'undefined' ? vfFreiCache[vfK] || null : null;
    if (vfK && !vfFreiKarte && typeof vfFreiLaden === 'function') vfFreiLaden(vfK).then(() => konsoleFahrenZeichnen(), () => {});
    $('fa-strecke-titel').textContent = vfM ? vfStreckeName() : bahn ? t('Auf der Bahn') : t('Frei');
    const bild = $('fa-strecke-bild');
    // BESTELLT v0.8.126: ist eine Strecke eingegeben und der Modus steht auf "auf der Bahn",
    // zeigt das Band die Streckenvorschau aus dem Editor statt des Beispielbilds.
    let teileAn = 0;
    try { teileAn = currentTrackTiles.length; } catch (e) { teileAn = 0; }
    const vorschauAn = (vfM ? !vfK : bahn) && teileAn >= 3 && typeof renderTrackPreview === 'function';
    const faStrecke = $('fa-strecke');
    if (faStrecke) faStrecke.classList.toggle('k-vorschau', vorschauAn || !!vfFreiKarte);
    // Im Ausdruck-Modus zeigt das Band das eigene Streckenfoto, sobald es eines gibt. Nur neu
    // setzen, wenn es sich geaendert hat: die Daten-URL ist einige hundert KB lang.
    let bildNeu;
    if (vorschauAn) {
      try { bildNeu = 'karte:' + trackToCode(currentTrackTiles, trackRotationDeg); }
      catch (e) { bildNeu = 'karte'; }
    } else {
      bildNeu = !bahn && foto ? 'foto:' + foto.length : (bahn ? 'strecke-bahn' : 'strecke-frei');
    }
    if (vfK) bildNeu = 'vffrei:' + vfK + (vfFreiKarte ? ':da' : '');
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
      // v1.6.23: Rollrennstrecke von oben (derselbe Zeichner wie das Ladebild der virtuellen Fahrt).
      if (!gezeichnet && vfFreiKarte && typeof vfLadeKarteSvg === 'function') {
        try { bild.style.backgroundImage = 'none'; bild.innerHTML = vfLadeKarteSvg(null, vfFreiKarte.pts); gezeichnet = true; } catch (e) { /* Fall: Bild */ }
      }
      if (!gezeichnet) {
        bild.style.backgroundImage = !bahn && foto ? 'url("' + foto + '")' : 'url(img/' + (bahn ? 'strecke-bahn' : 'strecke-frei') + '.jpg)';
        bild.innerHTML = '';
      }
      bild.dataset.bild = bildNeu;
    }
    kZeilen($('fa-strecke-info'), vfM
      ? [[t('Fahrtrichtung'), typeof vfGegenAn === 'function' && vfGegenAn() ? t('Gegenrichtung') : t('Normal')],
         vfK ? [t('Strecke'), t('nur virtuell')] : [t('Teile'), String(kTeile())]]
      : bahn
      ? [[t('Teile'), String(kTeile())], ['Code', kCode() || '–']]
      : [[t('Modus'), t('Ausdruck, ohne Bahn')], [t('Streckenfoto'), foto ? t('hochgeladen') : t('keins')]]);
    // v0.9.45 BESTELLT: "zeige im FAHREN-Menue in der Streckenkachel (wenn sie auf Bahn
    // eingestellt ist) 'Raum' an".
    ['fa-scan', 'fa-laden', 'fa-raum'].forEach((id) => { if ($(id)) $(id).hidden = !bahn; });
    // v0.9.33, BESTELLT: Druckvorlagen und Editor je nach Modus - die Vorlagen sind fuer die
    // gedruckte Strecke (FREI), der Editor baut die Carrera-Bahn nach (AUF DER BAHN).
    if ($('fa-druck')) $('fa-druck').hidden = bahn;
    if ($('fa-editor')) $('fa-editor').hidden = !bahn;
    if ($('fa-foto')) $('fa-foto').hidden = bahn;
    if ($('fa-foto-weg')) $('fa-foto-weg').hidden = bahn || !foto;
    // v1.0.45 BESTELLT: "Reinigungsfahrzeug (WIP)" - der Knopf erscheint im Autos- und im
    // Strecken-Menue, nur auf der Bahn und nur wenn die Rolle 'reinig' gesetzt ist.
    const reinigAn = bahn && garage.some((c) => c.role === 'reinig');
    if ($('fa-reinig-stre')) $('fa-reinig-stre').hidden = !reinigAn;
    // (fa-profil ist seit v0.10.5 die Meisterschaft-Kachel, ohne Abstimmungsanzeige.)

    // v1.6.23: virtuell zaehlen nur Editor und Laden (gebaute Bahn) und die Fahrtrichtung.
    if (vfM) {
      ['fa-scan', 'fa-raum', 'fa-druck', 'fa-foto', 'fa-foto-weg', 'fa-reinig-stre'].forEach((id) => { if ($(id)) $(id).hidden = true; });
      ['fa-editor', 'fa-laden'].forEach((id) => { if ($(id)) $(id).hidden = !!vfK; });
    }
    const faR = $('fa-richtung');
    if (faR) {
      faR.hidden = !vfM;
      const gg = typeof vfGegenAn === 'function' && vfGegenAn();
      faR.textContent = '⇄ ' + (gg ? t('Gegenrichtung') : t('Normal'));
      faR.setAttribute('aria-pressed', gg ? 'true' : 'false');
      faR.title = t('Fahrtrichtung');
    }
    const training = rm.value === 'practice';
    $('fa-start-titel').textContent = kRennenLaeuft() ? t('Zurück ins Rennen')
      : vfM ? t('Virtuell fahren') : (training ? t('Training starten') : t('Rennen starten'));
    $('fa-start-unter').textContent = modus + ' · ' + (vfM ? t('virtuell') : bahn ? t('auf der Bahn') : t('frei'));
    // Punkte rechts neben dem Wert (in derselben .k-kopf-Zeile): so viele, wie es
    // Schaltstellungen gibt, die gewaehlte gefuellt. Bei zu vielen (z. B. Motorsound mit
    // 27 Motoren) wuerden die Punkte nicht mehr passen - dort stehen Pfeile im Markup.
    // Fuer 6..10 Stellungen ohne Pfeile reicht auch der Platz nicht mehr: dann eine kompakte
    // "N/M"-Anzeige statt der Punkte (BESTELLT: "N/8"-Readout, wenn die Punkte drangeln).
    [['fa-strecke-punkte', 'bahn'], ['fa-renn-punkte', 'renntyp']].forEach(([id, quad]) => {
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
    // v1.3.5: Steuerkreuz links/rechts waehlt den Knopf (96-home.js), L1/R1 die Sprache.
    if (neu === 14 || neu === 15) { homeFokusSchritt(neu === 14 ? -1 : 1); return true; }
    if (neu === 4 || neu === 5) { wechsleSprache(); return true; }
    // BESTELLT: "'Press any key' und 'press triangle for tutorial' ist auch etwas
    // verwirrend. Ich wuerde sagen: X zum Starten, Dreieck fuer Tutorial, Kreis fuer
    // Steuerung." Alle anderen Tasten tun auf dem Titel nichts mehr.
    // v1.3.5: Kreuz (A am Xbox-Pad) loest den GEWAEHLTEN Knopf aus - vorgewaehlt ist Starten.
    if (neu === 0) { kTitelSperre = true; homeFokusAusloesen(); return true; }
    if (neu === 3) { kTitelSperre = true; tutorialStarten(); return true; }
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
        } else if (typeof vfAktiv === 'function' && vfAktiv()) {
          // Virtuelle Fahrt: Options beendet sie wie Escape (zurueck in die Garage), statt das Menue
          // unter der 3D-Schicht zu oeffnen.
          virtuellBeenden();
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
    // v1.1.3: waehrend der virtuellen Fahrt (60d-virtuell.js) gehoeren die Tasten dem Fahren; Escape beendet sie.
    // Dieser Zuhoerer laeuft in der Capture-Phase vor allen anderen - ohne diese Zeile oeffnete Escape das Menue.
    if (typeof vfAktiv === 'function' && vfAktiv()) {
      if (k === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); virtuellBeenden(); }
      else if (k === 'c' && !e.repeat) { e.preventDefault(); vfKameraWechseln(); }
      return;
    }
    if (e.target && e.target.closest && e.target.closest('input[type="text"], input[type="number"], textarea, select')) return;
    // Der Meisterschaftsschirm hat seine eigene Tastatur (73-meisterschaft.js).
    if (typeof meisterOffen === 'function' && meisterOffen() && !kFrageOffen) return;
    // Reaktionstest der Studie (98f-studie.js): jede Taste ist dort ein Druck.
    if (typeof studieTestAktiv === 'function' && studieTestAktiv()) return;
    if (kAktiverTab() === 'home' && !e.ctrlKey && !e.altKey && !e.metaKey && k !== 'tab' && k !== 'shift') {
      e.preventDefault(); e.stopImmediatePropagation();
      // Tastatur wie am Pad: Pfeile links/rechts waehlen den Knopf, Enter, Leertaste oder X
      // loesen ihn aus (v1.3.5), Q/E wie L1/R1 die Sprache. T und S bleiben als Abkuerzung.
      if (k === 'arrowleft' || k === 'arrowright') homeFokusSchritt(k === 'arrowleft' ? -1 : 1);
      else if (k === 'q' || k === 'e') wechsleSprache();
      else if (k === 't') tutorialStarten();
      else if (k === 's') konsoleTourStart(K_STEUERUNG);
      else if (k === 'enter' || k === ' ' || k === 'x') homeFokusAusloesen();
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
    kn('fa-auto', (e) => {
      if (e.target.closest('.k-knopf')) return;
      if (fahrModusVirtuell()) { konsoleGarageOeffnen(); return; }
      // v1.5: ein Tipp auf die Fehlerzeile oeffnet den Dialog dazu statt der Kachel.
      if (e.target.closest('#fa-verb-lage') && konsoleVerbFrage()) return;
      konsoleAuto();
    });
    kn('fa-verbinden', () => { konsoleVerbinden(); });
    kn('fa-garage', () => konsoleGarageOeffnen());
    kn('fa-mp', () => konsoleZeige('mp'));
    kn('vg-zurueck', () => konsoleZeige('fahren'));
    kn('vg-einstellungen', () => konsoleZeige('options', 'opt-virtuell'));
    // v1.6.23: im Modus Virtuell startet die Startkachel die virtuelle Fahrt (die Kachel "Virtuell fahren" ist dem
    // Umschalter Echt | Virtuell gewichen). Ein Tipp auf eine Seite des Umschalters waehlt sie, sonst wechselt er.
    kn('fa-start', () => { if (fahrModusVirtuell() && !kRennenLaeuft()) konsoleVirtuellStarten(); else konsoleLosfahren(); });
    // v1.6.37 BESTELLT: "the real/virtual button should be as big as the box ... I click the box and it switches".
    kn('fa-modus', () => fahrModusSetzen(fahrModusVirtuell() ? 'echt' : 'virtuell'));
    // v1.1.3 BESTELLT: "Tippe ich bei der Kachel STRECKE auf STRECKE oder AUF DER BAHN, soll
    // umgeschaltet werden; tippe ich auf das Bild, oeffnet sich das Menue dazu." Vorher schaltete nur
    // der Text selbst um, ein Tipp daneben in der Kopfzeile oeffnete das Menue. Jetzt oeffnet nur das
    // Bild (und Gamepad/Tastatur, die die Kachel als Ganzes ausloesen: e.target ist dann die Kachel),
    // alles andere ausser den Knoepfen schaltet um.
    // v1.1.15 GEMELDET: "Wenn ich auf das Bild klicke, fuehre mich zu den Optionen. Wenn ich auf eine der
    // beiden Ueberschriften druecke, aendere den Modus." Die Infozeile (.k-ki) liegt ueber dem groessten
    // Teil des Bildes, und ein Tipp dort schaltete bisher um. Jetzt umgekehrt: NUR die beiden
    // Ueberschriften (.k-kk, .k-kopf) schalten, alles andere auf der Kachel oeffnet die Optionen.
    const kachelKlick = (quad, oeffnen) => (e) => {
      if (e.target.closest('.k-knopf')) return;
      if (e.target.closest('.k-kk, .k-kopf')) { konsoleQuadWechsel(quad, 1); return; }
      oeffnen();
    };
    kn('fa-renn', kachelKlick('renntyp', () => konsoleZeige('control')));
    // v1.6.23: im Modus Virtuell oeffnet das Bild die Optionen der virtuellen Fahrt (dort auch Strecke und Richtung).
    kn('fa-strecke', kachelKlick('bahn', () => { if (fahrModusVirtuell()) konsoleGarageOeffnen(); else konsoleZeige('track'); }));
    kn('fa-richtung', () => { if (typeof vfRichtungWechseln === 'function') vfRichtungWechseln(); menuNavTonVerstellen(); konsoleFahrenZeichnen(); });
    kn('fa-scan', () => konsoleZeige('track', 'scan'));
    kn('fa-editor', () => konsoleZeige('track', 'edit'));
    kn('fa-laden', () => konsoleZeige('track', 'laden'));
    kn('fa-raum', () => konsoleZeige('track', 'raum'));
    kn('fa-druck', () => konsoleZeige('track', 'print'));
    kn('fa-profil', () => meisterOeffnen());
    // v1.0.45 BESTELLT: "Reinigungsfahrzeug starten" im Autos- und Strecken-Menue.
    kn('fa-reinig-stre', () => reinigStarten());
    // BESTELLT: "wenn ich auf den Header tippe, soll es zur naechsten Option schalten".
    // Der Kachelkopf (Titel + Wert) dreht die Schaltstellung weiter, der Rest der Kachel
    // oeffnet wie bisher die Unterseite. Das Gamepad bleibt unveraendert (Quadrat/links/rechts).
    // (v1.1.3: das Umschalten steckt jetzt in kachelKlick oben - fuer die ganze Kachel ausser dem Bild.)
    // Die Pfeile des Motorsound-Kachelkopfs blaettern vor und zurueck (nicht das Gamepad).
    document.querySelectorAll('.k-arrow').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        konsoleQuadWechsel(el.dataset.quad, parseInt(el.dataset.dir, 10));
      });
    });
    kn('race-menue', () => konsoleZumMenue());
    // Reiterleisten (v1.5.x): ein Zuhoerer je Leiste statt einem je Knopf (kLeisteFuellen baut
    // nicht mehr bei jedem Zeichnen neu). Die Pfeile der zweiten Leiste schalten wie L1/R1.
    [['k-reiter', 'eins'], ['k-band2', 'zwei']].forEach(([id, name]) => {
      const h = $(id);
      if (!h) return;
      h.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        const r = kLeisteStand[name].r;
        const x = b && r ? r[parseInt(b.dataset.i, 10)] : null;
        if (x) x.wahl();
      });
    });
    kn('k-pfeil-l', () => { konsoleReiterSchritt(-1); });
    kn('k-pfeil-r', () => { konsoleReiterSchritt(1); });
    document.querySelectorAll('.info-open').forEach((el) => el.addEventListener('click', () => konsoleZeige('info', el.dataset.sub)));
    kn('mp-erkl-knopf', (e) => { e.stopPropagation(); optInfoOeffnen(t('Beitreten und Rangliste'), $('mp-erkl').innerHTML); });
    kn('mp-app-erkl-knopf', (e) => { e.stopPropagation(); optInfoOeffnen(t('Host'), $('mp-app-erkl').innerHTML); });
    kn('k-ergebnis', () => { kErgebnisWartet = true; konsoleInsCockpit(); });
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
    // v1.5.x: und danach noch einmal. Die zweite Leiste liest ihre Beschriftung von den
    // Kacheln, und die sind beim ersten Aufruf noch nicht uebersetzt - sie blieb sonst bis
    // zum naechsten Wechsel in der alten Sprache stehen.
    if (typeof i18nOnLangChange === 'function') {
      i18nOnLangChange(() => { konsoleZeichnen(); setTimeout(konsoleZeichnen, 0); });
    }
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

  // ---- GROESSE DER REITERLEISTEN (v0.9.37) ----------------------------------------------
  // Zwei Regler unter Optionen > Allgemein; der Wert ist ein Zoom auf die Reiterknoepfe (Schrift,
  // Abstaende und Hoehe zusammen). Gespeichert wird er wie jeder Regler (98b-sicherung.js).
  (function reiterGroesse() {
    const setzen = (id, varName) => {
      const el = $(id);
      if (!el) return;
      const v = Math.max(0.6, Math.min(1.8, parseFloat(el.value) || 1));
      document.documentElement.style.setProperty(varName, String(v));
      if ($(id + '-val')) $(id + '-val').textContent = Math.round(v * 100) + '%';
    };
    [['setting-reiter1', '--reiter1'], ['setting-reiter2', '--reiter2']].forEach(([id, v]) => {
      const el = $(id);
      if (!el) return;
      ['input', 'change'].forEach((art) => el.addEventListener(art, () => setzen(id, v)));
      setzen(id, v);
      // Nach dem Wiederherstellen der gespeicherten Regler (98b) noch einmal.
      setTimeout(() => setzen(id, v), 300);
    });
  })();

