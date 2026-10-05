  // ============================ MENUENAVIGATION (Phase 13, WIP) ======================
  //
  // BESTELLT: D-Pad/Pfeiltasten navigieren im Cockpit und in den Optionen, X/Enter
  // bestaetigt oder waehlt einen Regler an.
  //
  // ENG GESCHNITTEN, aus einer bereits gemachten Erfahrung dieses Projekts: eine
  // FRUEHERE, allgemeine Menuenavigation (siehe der Kommentar bei pollGamepad() in
  // 90-ghosts.js) griff auf jedem Tab und jedem fokussierbaren Element und wurde deshalb
  // wieder ausgebaut - eine Fehlbedienung verstellte einen Regler, den niemand im Blick
  // hatte. Diese Fassung bleibt vorsichtig, obwohl sie inzwischen (nach einem ersten
  // erfolgreichen Testlauf, BESTELLT: "jetzt ueberall so anlegen") auf JEDEM Tab
  // wirkt, mit EINER Ausnahme: dem Cockpit-Hauptschirm waehrend der Fahrt (siehe
  // menuNavContainer()) - und ein Regler AENDERT SICH weiterhin NICHT durch den
  // blossen Fokus: er muss erst mit der Waehltaste "angewaehlt" werden (menuNavArmed),
  // bevor links/rechts seinen Wert veraendert. Die Box- und Renneinstellungen-Schirme
  // im Cockpit haben ihre eigene, laengst gemessene Zeilenauswahl
  // (pitScreenPad/raceScreenPad, cockpitScreenWaehlen) und werden hier nicht
  // verdoppelt - flagTasteTick() und die Tastatur (30-input.js) reihen
  // menuNavActivate() nur als NEUE, erste Stufe vor die bestehende Kette ein.

  let menuNavIndex = 0;
  let menuNavArmed = false;
  let menuNavContextKey = null;
  // GEFUNDEN BEIM TESTEN: "runter" in einem frischen Menue huepfte gleich zum ZWEITEN
  // Eintrag, weil der erste Tastendruck den gemerkten Index 0 sofort um eins verschob,
  // ohne ihn je gezeigt zu haben. menuNavGezeigt haelt fest, ob der aktuelle Kontext
  // schon einmal gezeichnet wurde - der erste Tastendruck zeigt nur Zeile 0, erst der
  // naechste bewegt wirklich.
  let menuNavGezeigt = false;

  // ---- Halten mit Beschleunigung ----
  //
  // BESTELLT: "wenn ich bei einer Skala den rechts Button gedrueckt halte, soll die
  // Aenderungsgeschwindigkeit schneller zunehmen (nach 0.5s gedrueckt halten in
  // groesseren Schritten aendern)." PRAEZISIERT, nachdem die erste Fassung eine
  // Gnadenfrist nach dem Loslassen gab (ein kurzes Antippen kurz nach einem Zug blieb im
  // schnellen Modus): "wenn ich die Taste loslasse und druecke, soll SOFORT wieder
  // kleinschrittig adjustiert werden." Jedes Loslassen setzt die Beschleunigung deshalb
  // ausnahmslos zurueck - nur DURCHGEHENDES Halten ueber MENU_NAV_ACCEL_MS beschleunigt.
  //
  // EIN Zustand fuer beide Eingabewege: das Gamepad ruft menuNavAdjustGehalten() JEDEN
  // Takt mit dem rohen Tastendruck auf (es gibt kein natives Wiederholen), die Tastatur
  // bei jedem keydown (auch den vom Betriebssystem wiederholten - das native Wiederholen
  // ersetzt hier nur den Zeitgeber, die Beschleunigung rechnet trotzdem diese Uhr) und
  // bei jedem keyup mit gehalten=false.
  let menuNavHoldDir = null;         // 'left' | 'right' | null, null sofort beim Loslassen
  let menuNavHoldStart = 0;          // Beginn des AKTUELLEN, durchgehenden Zugs
  let menuNavLastStep = 0;
  const MENU_NAV_REPEAT_START_MS = 300;  // erstes Wiederholen nach dem ersten Schritt
  const MENU_NAV_REPEAT_MS = 120;        // Wiederholrate vor der Beschleunigung
  const MENU_NAV_ACCEL_MS = 500;         // ab so lange DURCHGEHEND gehalten: groessere Schritte
  const MENU_NAV_REPEAT_FAST_MS = 70;    // Wiederholrate NACH der Beschleunigung
  const MENU_NAV_STEP_BIG = 5;           // Schrittvielfaches NACH der Beschleunigung

  // ---- Subtile Schaltsounds ----
  //
  // BESTELLT: "wenn ich im Menue navigiere, sollen subtile angenehme Schaltsounds
  // kommen." playTone() (70-race.js) prueft selbst, ob Ton ueberhaupt an ist - kein
  // eigenes Gatter hier noetig. Laut und kurz wie das leiseste bestehende Beispiel im
  // Projekt (80-sound.js, das Boxenstopp-Klicken), nicht wie die kraeftigeren
  // Renn-Toene.
  function menuNavTonBewegen() { playTone(520, 0.035, 'sine', 0.05); }
  function menuNavTonAktivieren() { playTone(720, 0.05, 'sine', 0.08); }
  function menuNavTonAnwaehlen() {
    playTone(640, 0.04, 'triangle', 0.06);
    setTimeout(() => playTone(880, 0.04, 'triangle', 0.05), 40);
  }
  function menuNavTonAbwaehlen() {
    playTone(880, 0.04, 'triangle', 0.05);
    setTimeout(() => playTone(640, 0.04, 'triangle', 0.06), 40);
  }
  function menuNavTonVerstellen() { playTone(560, 0.025, 'sine', 0.04); }

  function menuNavSichtbar(el) { return el.offsetParent !== null; }

  // Der Container, dessen Zeilen gerade gelten: die offene Unterseite eines Tabs, oder
  // - wenn keine offen ist - dessen Kachel-/Startseite, oder - sonst - der ganze Tab.
  // null nur, wenn kein Tab aktiv ist (kommt praktisch nie vor) ODER auf dem
  // Cockpit-Tab: JEDER seiner Schirme hat schon eine eigene, laengst gemessene
  // Zeilenauswahl - der Hauptschirm gar keine (dort wird gefahren, und ein
  // Fokusraster ueber der Fahranzeige waere Ablenkung statt Hilfe - genau die
  // Fehlbedienung, wegen der die fruehere, allgemeine Fassung schon einmal ausgebaut
  // wurde), Box und Renneinstellungen ihre eigene (pitScreenPad/raceScreenPad,
  // cockpitScreenWaehlen). Eine generische Zeilenliste WUERDE dort etwas finden
  // (button-Elemente gibt es auf jedem Schirm) und genau deshalb die bestehende,
  // getestete Auswahl verdoppeln/uebertoenen - siehe den gefundenen Fehler "Waehltaste:
  // nach dem Boxenmenue nimmt der Cockpitschirm sie wieder". Der ganze Tab bleibt
  // deshalb aussen vor, nicht nur sein Hauptschirm.
  function menuNavContainer() {
    // Das Cockpit-Menue (Options 1 s halten, 51-konsole.js) liegt ueber allem und hat
    // Vorrang - auch im Cockpit, das sonst keine generische Zeilenliste bekommt.
    if (typeof konsoleFrageOffen === 'function' && konsoleFrageOffen()) return $('k-frage');
    if (typeof konsoleTourOffen === 'function' && konsoleTourOffen()) return $('k-tour-karte');
    // Die Mehrspieler-Anzeige "Info-Screen" liegt ueber allem (v0.8.41): sonst lief die Auswahl
    // unsichtbar darunter weiter.
    const mi = $('mp-info');
    if (mi && !mi.hidden) return mi;
    const tab = document.querySelector('.tabpage.active');
    if (!tab || tab.id === 'tab-race') return null;
    // Der TITELBILDSCHIRM hat keine Zeilen: jede Taste fuehrt nach Fahren (51-konsole.js).
    // Als Zeilenliste waere #lang-toggle die erste - und die Waehltaste schaltete die Sprache
    // um, statt weiterzugehen. So im Selbsttest passiert: der Rest der Suite lief englisch.
    if (tab.id === 'tab-home') return null;
    // Der Streckeneditor im VOLLBILD hat sein eigenes, vollstaendiges D-Pad-Schema
    // (trackEditorPad(), 60-track.js: hoch/runter/links/rechts/bestaetigen/rueckgaengig/
    // drehen) - eine generische Zeilenliste wuerde X/Kreuz/Dreieck dort wegschnappen,
    // bevor trackEditorPad() sie sieht. Ausserhalb des Vollbilds (Kachelseite, Editor
    // per Maus) gilt die normale Navigation weiter.
    if (tab.id === 'tab-track' && document.body.classList.contains('track-fs')) return null;
    const openSub = tab.querySelector('.subpage.on');
    if (openSub) return openSub;
    const homeSub = tab.querySelector('.subpage-home');
    if (homeSub) return homeSub;
    return tab;
  }

  // EINZELN abgefragt und nicht als eine Komma-Liste: querySelector() mit mehreren
  // durch Komma getrennten Mustern liefert das erste Element in DOKUMENT-Reihenfolge,
  // nicht das erste PASSENDE Muster in der Liste - eine Reglerzeile mit einem "-"-Knopf
  // VOR dem eigentlichen input[range] lieferte deshalb den Knopf, nicht den Regler.
  function menuNavControlFor(row) {
    return row.querySelector('input[type="checkbox"]')
      || row.querySelector('input[type="range"]')
      || row.querySelector('select')
      || row.querySelector('input[type="number"], input[type="text"]')
      || row.querySelector('button:not(.opt-label button):not(:disabled)')
      || row.querySelector('button:not(.opt-label button)');
  }

  function menuNavKindOf(control) {
    if (control.type === 'checkbox') return 'toggle';
    if (control.type === 'range') return 'range';
    if (control.tagName === 'SELECT') return 'select';
    if (control.type === 'text' || control.type === 'number') return 'text';
    return 'button';
  }

  // DOM-Reihenfolge ist Bildschirm-Reihenfolge: weder .opt-row noch .misc-tile werden
  // per CSS umsortiert. Drei Muster, der Reihe nach versucht:
  //
  //   1. Kacheln (.misc-tile) - die Kachel-/Startseiten von Entwicklertools, Optionen
  //      und Strecke.
  //   2. Einstellungszeilen (.opt-row) - die Optionen-Unterseiten.
  //   3. GENERELLER FALL - jedes sichtbare Bedienelement in DOM-Reihenfolge, fuer Tabs
  //      ohne eines der beiden obigen Muster (Garage, Mehrspieler, ...). Die Zeile IST
  //      hier das Element selbst: es gibt keine umschliessende .opt-row/.misc-tile, an
  //      der sich der Fokusrahmen zeigen liesse.
  //
  // Nur SICHTBARE Zeilen zaehlen - offsetParent ist null bei jedem display:none, egal
  // ob ueber eine Media-Query, ein bedingtes Feature oder eine geschlossene Unterseite.
  function menuNavRows() {
    const host = menuNavContainer();
    if (!host) return [];
    // .k-kachel/.k-knopf: die Kacheln des ACC-Menues (Hauptmenue, Fahren) samt der Knoepfe
    // IN einer Kachel (Scan/Editor/Laden auf STRECKE). Alle Kacheln werden RAEUMLICH
    // angesteuert (menuNavRaum), nicht mehr in einer Liste.
    const tiles = [...host.querySelectorAll('.misc-tile, .k-kachel, .k-knopf')].filter(menuNavSichtbar);
    if (tiles.length) return tiles.map((el) => ({ el, kind: 'tile', control: el }));

    // .mw-row gehoert dazu: die Motorwerkstatt sitzt als eigenes Raster am Ende der
    // Tonseite (.mw-grid, zwei Spalten ab 720px), zwischen lauter .opt-row-Zeilen. Ohne
    // sie hier mit aufzunehmen, waere jede Motorwerkstatt-Regelung fuer diese Funktion
    // unsichtbar, sobald auch nur eine einzige .opt-row auf derselben Unterseite steht -
    // genau das war "Motorwerkstatt so umsortieren, dass ich sie auch mit d-pad bedienen
    // kann": sie liess sich bislang gar nicht erreichen, nicht nur schlecht sortiert.
    // querySelectorAll haelt bei einer Selektorliste die DOKUMENT-Reihenfolge, nicht die
    // Reihenfolge der Selektoren - .opt-row- und .mw-row-Zeilen bleiben also gemischt in
    // ihrer Bildschirmreihenfolge.
    const optRows = [...host.querySelectorAll('.opt-row, .mw-row')].filter(menuNavSichtbar);
    // Auch .misc-back (v0.8.41): "← Optionen" in den Renneinstellungen und den Info-Seiten ist
    // ein goto-tab-Knopf und war fuer das Steuerkreuz nicht erreichbar.
    const back = host.querySelector('.subpage-back') || host.querySelector('.misc-back');
    const rows = [];
    if (back && menuNavSichtbar(back)) rows.push({ el: back, kind: 'button', control: back });
    if (optRows.length) {
      optRows.forEach((row) => {
        const control = menuNavControlFor(row);
        if (control) rows.push({ el: row, kind: menuNavKindOf(control), control });
        // KEIN EIGENER ZEILENEINTRAG MEHR fuer den Info-Knopf (bis B2/Phase-B-Feinschliff):
        // jede erklaerte Zeile brauchte damit zwei Tastendruecke, um vorbeizukommen. Der
        // Knopf bleibt im DOM (98c-opt-info.js braucht ihn fuers Antippen), aber
        // menuNavRows() ueberspringt ihn - Dreieck oeffnet ihn jetzt direkt ueber
        // menuNavOpenInfo(), ohne ihn erst anzuwaehlen.
      });
      return rows;
    }
    // "Meine Teile": die Zeilenliste ist das eigentliche Bedienelement - hoch/runter waehlt
    // die Sorte, links/rechts veraendert den Bestand (siehe menuNavAdjust, kind 'teile').
    // Die Paket-Knoepfe oben sind sekundaer und stehen hinten an.
    const teileZeilen = [...host.querySelectorAll('.teile-zeile')].filter(menuNavSichtbar);
    if (teileZeilen.length) {
      const tRows = [];
      if (back && menuNavSichtbar(back)) tRows.push({ el: back, kind: 'button', control: back });
      // Raumgrenzen (Breite/Tiefe) stehen ueber der Teileliste; links/rechts aendert sie.
      host.querySelectorAll('.raum-zeile').forEach((el) => {
        if (menuNavSichtbar(el)) tRows.push({ el, kind: 'raum', control: el, achse: el.dataset.achse });
      });
      teileZeilen.forEach((el) => tRows.push({ el, kind: 'teile', control: el }));
      host.querySelectorAll('button').forEach((el) => {
        if (el.classList.contains('subpage-back') || el.classList.contains('misc-back')) return;
        if (el.closest('.teile-zeile')) return;
        if (el.closest('.raum-zeile')) return;
        if (menuNavSichtbar(el)) tRows.push({ el, kind: 'button', control: el });
      });
      return tRows;
    }
    [...host.querySelectorAll(
      'button:not(.subpage-back), select, input[type="checkbox"], input[type="range"], '
      + 'input[type="number"], input[type="text"], a[href]:not([download]):not([target="_blank"]), '
      + '[data-ch-voll]',
    )].filter(menuNavSichtbar).forEach((el) => rows.push({ el, kind: menuNavKindOf(el), control: el }));
    return rows;
  }

  function menuNavContextNow() {
    const host = menuNavContainer();
    return host ? host.id : null;
  }

  // Wechselt der Kontext (Unterseite auf/zu, Kachel geoeffnet, Tab verlassen), faengt
  // ganz von vorn an - ein gemerkter Index aus einer anderen Zeilenliste zeigt sonst auf
  // eine zufaellige Stelle, sobald man zurueckkommt.
  // LETZTE AUSWAHL JE SEITE (v0.8.24, BESTELLT): beim Verlassen eines Kontexts wird die
  // Zeile gemerkt, beim Zurueckkommen steht die Auswahl wieder dort. Nicht fuer Dialoge
  // (#k-frage, Tutorial): die fangen immer oben an.
  const menuNavMerk = {};
  const MENU_NAV_OHNE_MERK = ['k-frage', 'k-tour-karte'];
  function menuNavMerkLeeren() { Object.keys(menuNavMerk).forEach((k) => { delete menuNavMerk[k]; }); }
  function menuNavEnsureContext() {
    const key = menuNavContextNow();
    if (key !== menuNavContextKey) {
      if (menuNavContextKey && menuNavGezeigt && !MENU_NAV_OHNE_MERK.includes(menuNavContextKey)) {
        menuNavMerk[menuNavContextKey] = menuNavIndex;
      }
      // Den Kontext verlassen: menuNavRender() scrollt document.body (nicht das
      // Fenster) fuer jede fokussierte Zeile, und dieser Bildlauf blieb sonst stehen -
      // ein anderer Tab konnte so scheinbar grundlos mitten im Bild aufschlagen, obwohl
      // niemand ihn dorthin gescrollt hat.
      if (menuNavContextKey !== null && key === null) document.body.scrollTop = 0;
      menuNavContextKey = key;
      menuNavArmed = false;
      if (key && menuNavMerk[key] !== undefined && !MENU_NAV_OHNE_MERK.includes(key)) {
        menuNavIndex = menuNavMerk[key];
        menuNavGezeigt = true;
      } else {
        menuNavIndex = 0;
        menuNavGezeigt = false;
      }
    }
  }

  function menuNavActive() {
    menuNavEnsureContext();
    return menuNavRows().length > 0;
  }

  function menuNavRender() {
    document.querySelectorAll('.menu-nav-sel').forEach((el) => {
      el.classList.remove('menu-nav-sel', 'menu-nav-armed');
    });
    const rows = menuNavRows();
    if (!rows.length) return;
    menuNavIndex = ((menuNavIndex % rows.length) + rows.length) % rows.length;
    const row = rows[menuNavIndex];
    row.el.classList.add('menu-nav-sel');
    if (menuNavArmed) row.el.classList.add('menu-nav-armed');
    if (typeof row.el.scrollIntoView === 'function') row.el.scrollIntoView({ block: 'nearest' });
    if (typeof garageFokusZeile === 'function') garageFokusZeile(row.el);
  }

  // ---- RAEUMLICH: der naechste Nachbar in der Richtung ------------------------------
  //
  // BESTELLT (ACC-Menue): "kacheln, dpad richtungen zum wählen". Gemessen von Mittelpunkt zu
  // Mittelpunkt; quer zur Richtung zaehlt die Abweichung zweieinhalbfach, damit "rechts" in
  // derselben Reihe bleibt. Seitwaerts nur zu Kacheln, die sich senkrecht UEBERLAPPEN - sonst
  // spraenge rechts am Rand schraeg nach oben; bei ACC passiert dort einfach nichts. Aus dem
  // Mock-up uebernommen und dort ausprobiert.
  function menuNavRaum(dir) {
    const rows = menuNavRows();
    if (!rows.length) return false;
    if (!menuNavGezeigt) { menuNavGezeigt = true; menuNavRender(); menuNavTonBewegen(); return true; }
    const cur = rows[menuNavIndex] || rows[0];
    const a = cur.el.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = -1, bestWert = Infinity;
    rows.forEach((r, i) => {
      if (r === cur) return;
      const b = r.el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const selbeZeile = b.bottom > a.top + 4 && b.top < a.bottom - 4;
      let haupt, quer;
      if (dir === 'right') { if (bx <= ax + 2 || !selbeZeile) return; haupt = b.left - a.right; quer = Math.abs(by - ay); }
      else if (dir === 'left') { if (bx >= ax - 2 || !selbeZeile) return; haupt = a.left - b.right; quer = Math.abs(by - ay); }
      else if (dir === 'down') { if (by <= ay + 2) return; haupt = b.top - a.bottom; quer = Math.abs(bx - ax); }
      else { if (by >= ay - 2) return; haupt = a.top - b.bottom; quer = Math.abs(bx - ax); }
      const wert = Math.max(0, haupt) + quer * 2.5
        - ((dir === 'down' || dir === 'up') && cur.el.contains(r.el) ? 1000 : 0);
      if (wert < bestWert) { bestWert = wert; best = i; }
    });
    // Am Rand einer Kachel mit Wert (data-quad, zeigt ◀ ▶): den Wert umschalten statt nichts
    // zu tun (v0.8.41, GEMELDET: Renntyp liess sich mit dem Steuerkreuz nicht waehlen).
    if (best < 0 && (dir === 'left' || dir === 'right') && cur.el.dataset && cur.el.dataset.quad
        && typeof konsoleQuadrat === 'function') { konsoleQuadrat(dir === 'left' ? -1 : 1); return true; }
    if (best < 0) return true;   // am Rand: nichts tun, aber die Taste ist verbraucht
    menuNavIndex = best;
    menuNavArmed = false;
    menuNavRender();
    menuNavTonBewegen();
    return true;
  }
  function menuNavTextfeldLoesen() {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input[type="text"], input[type="number"], input[type="url"], textarea')) a.blur();
  }
  function menuNavIstRaum() {
    const rows = menuNavRows();
    return rows.length > 0 && rows.every((r) => r.kind === 'tile');
  }
  // Links/rechts: auf Kacheln zum Nachbarn, auf einer Einstellungszeile DIREKT den Wert -
  // ohne vorheriges Anwaehlen, seit links/rechts keine Tabs mehr wechselt (das tun L1/R1).
  // Gibt zurueck, ob die Taste verbraucht wurde.
  function menuNavSeitwaerts(dir, gehalten) {
    if (typeof optInfoOffen === 'function' && optInfoOffen()) return true;
    menuNavEnsureContext();
    const rows = menuNavRows();
    if (!rows.length) return false;
    if (menuNavIstRaum()) { if (gehalten !== false) return menuNavRaum(dir); return true; }
    const row = rows[menuNavIndex];
    if (!row || !['range', 'select', 'toggle', 'teile'].includes(row.kind)) return false;
    menuNavGezeigt = true;
    menuNavAdjustGehalten(dir, gehalten !== false);
    return true;
  }

  function menuNavMove(dir) {
    // Waehrend das Info-Popup offen ist (98c-opt-info.js), soll hoch/runter NICHT den
    // dahinterliegenden, unsichtbaren Fokus verschieben - der naechste Blick nach dem
    // Schliessen saehe sonst eine andere Zeile ausgewaehlt, als man verlassen hatte.
    if (optInfoOffen()) return;
    // Ein offenes Textfeld beim Weiterbewegen schliessen (v0.8.41): sonst bleibt die
    // Handytastatur offen, und Tasten landen im Feld.
    menuNavTextfeldLoesen();
    menuNavEnsureContext();
    const rows = menuNavRows();
    if (!rows.length) return;
    if (rows.every((r) => r.kind === 'tile')) { menuNavRaum(dir); return; }
    menuNavArmed = false;
    // Der ERSTE Tastendruck in einem frischen Menue zeigt nur Zeile 0 - er bewegt noch
    // nicht. Sonst huepft "runter" sofort zur zweiten Zeile, ohne dass die erste je zu
    // sehen war.
    if (menuNavGezeigt) {
      menuNavIndex = ((menuNavIndex + (dir === 'up' ? -1 : 1)) % rows.length + rows.length) % rows.length;
    }
    menuNavGezeigt = true;
    menuNavRender();
    menuNavTonBewegen();
  }

  // X/Enter auf der fokussierten Zeile: Kachel/Knopf -> klicken, Kontrollkaestchen ->
  // umschalten, Regler/Auswahlfeld -> an- oder abwaehlen (kein Klick, kein Wertwechsel -
  // das macht erst menuNavAdjust()), Textfeld -> fokussieren und Inhalt markieren.
  function menuNavActivate() {
    menuNavEnsureContext();
    // Challenge-Karte im Vollbild: X (Kreuz) verkleinert sie, statt etwas darunter
    // auszuloesen (72-challenges.js, chKarteVoll/chKarteVollOffen).
    if (typeof chKarteVollOffen === 'function' && chKarteVollOffen()) {
      if (typeof chKarteVoll === 'function') chKarteVoll();
      menuNavTonAktivieren();
      return;
    }
    const rows = menuNavRows();
    if (!rows.length) return;
    menuNavGezeigt = true;
    const row = rows[menuNavIndex];
    if (row.kind === 'range' || row.kind === 'select') {
      menuNavArmed = !menuNavArmed;
      menuNavRender();
      if (menuNavArmed) menuNavTonAnwaehlen(); else menuNavTonAbwaehlen();
      return;
    }
    menuNavArmed = false;
    if (row.kind === 'text') {
      row.control.focus();
      if (typeof row.control.select === 'function') row.control.select();
    } else {
      row.control.click();
    }
    menuNavTonAktivieren();
    // Ein Klick kann den Kontext aendern (eine Kachel oeffnet ihre Unterseite) -
    // menuNavEnsureContext() faengt das ab, bevor neu gezeichnet wird.
    menuNavEnsureContext();
    menuNavRender();
  }

  // Dreieck ausserhalb des Cockpits (90-ghosts.js): oeffnet die Erklaerung der GERADE
  // fokussierten Zeile, ohne sie erst per Waehltaste anzusteuern - der Info-Knopf ist
  // seit B2 kein eigener Navigationsschritt mehr (siehe menuNavRows() oben). Gibt zurueck,
  // ob eine Erklaerung gefunden und geoeffnet wurde, damit der Aufrufer weiss, ob er noch
  // etwas anderes mit demselben Tastendruck tun soll (z. B. weiterhin das Licht schalten,
  // wenn die fokussierte Zeile keine Erklaerung hat).
  function menuNavOpenInfo() {
    menuNavEnsureContext();
    const rows = menuNavRows();
    if (!rows.length) return false;
    const row = rows[menuNavIndex];
    const info = row.el.querySelector ? row.el.querySelector('.opt-info-btn') : null;
    if (!info) return false;
    info.click();
    return true;
  }

  // links/rechts auf einer ANGEWAEHLTEN Zeile. Gibt zurueck, ob sie das gebraucht hat -
  // false heisst "nichts angewaehlt", und dann darf der Aufrufer die Taste fuer etwas
  // anderes nehmen (Tabwechsel, Cockpit-Schirm blaettern). `gross` multipliziert die
  // Schrittweite (siehe die Beschleunigung oben).
  function menuNavAdjust(dir, gross) {
    // "Verbraucht" und nicht "false" (siehe unten): waehrend das Info-Popup offen ist,
    // soll links/rechts weder einen Regler verstellen noch - ueber den false-Rueckgabewert
    // - den Aufrufer zum Tabwechsel verleiten. Ein offenes Modal blockiert beides.
    if (optInfoOffen()) return true;
    menuNavEnsureContext();
    const rows = menuNavRows();
    if (!rows.length) return false;
    const row = rows[menuNavIndex];
    // SEIT DEM ACC-MENUE OHNE ANWAHL: links/rechts verstellt die angewaehlte Zeile direkt
    // (menuNavSeitwaerts). Ein Kontrollkaestchen schaltet mit links wie mit rechts um.
    if (!row) return false;
    if (row.kind === 'toggle') {
      row.control.click();
      menuNavRender();
      menuNavTonVerstellen();
      return true;
    }
    const schritte = gross ? MENU_NAV_STEP_BIG : 1;
    if (row.kind === 'range') {
      for (let i = 0; i < schritte; i++) {
        if (dir === 'left') row.control.stepDown(); else row.control.stepUp();
      }
      row.control.dispatchEvent(new Event('input', { bubbles: true }));
      row.control.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (row.kind === 'select') {
      // Ein Auswahlfeld schaltet IMMER eine Option weiter, auch beim Beschleunigen. Der
      // grosse Schritt (MENU_NAV_STEP_BIG) ist fuer Skalen gedacht; bei einem Menue mit
      // wenigen Eintraegen ueberspringt er sonst die Haelfte - gemeldet als "manche Menues
      // schalten mehrere optionen auf einmal durch, sodass ich nicht nur eins weiterschalten
      // kann, sondern direkt viele".
      const n = row.control.options.length;
      const i0 = row.control.selectedIndex;
      const roh = i0 + (dir === 'left' ? -1 : 1);
      const i1 = Math.max(0, Math.min(n - 1, roh));
      if (i1 !== i0) {
        row.control.selectedIndex = i1;
        row.control.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (row.kind === 'teile') {
      // "Meine Teile": links/rechts veraendert den Bestand der fokussierten Sorte.
      if (typeof teileAendern === 'function') {
        const typ = row.el.dataset.teile;
        if (typ !== undefined) teileAendern(typ, dir === 'left' ? -1 : 1);
      }
    } else if (row.kind === 'raum') {
      // Raumgrenze: links/rechts aendert die fokussierte Achse (0,1 je Schritt, beim
      // Halten 0,5) - dieselbe Stelle wie die Minus/Plus-Knoepfe in "Meine Teile".
      if (typeof raumAendern === 'function') {
        const achse = row.achse;
        if (achse) raumAendern(achse, dir === 'left' ? -(gross ? 0.5 : 0.1) : (gross ? 0.5 : 0.1));
      }
    } else {
      return false;
    }
    menuNavRender();
    menuNavTonVerstellen();
    return true;
  }

  // GEMEINSAME Fassung fuer Gamepad UND Tastatur: bekommt bei jedem Gamepad-Takt bzw.
  // jedem Tastatur-keydown/keyup den aktuellen Haltezustand (gehalten=true/false), egal
  // ob dabei ein natives Wiederholen mitlief oder nicht - die Beschleunigung rechnet
  // ausschliesslich mit Date.now() und ist deshalb fuer beide Eingabewege gleich.
  function menuNavAdjustGehalten(dir, gehalten) {
    const jetzt = Date.now();
    if (!gehalten) {
      // Sofort und ausnahmslos zuruecksetzen - BESTELLT: "wenn ich die Taste loslasse
      // und druecke, soll sofort wieder kleinschrittig adjustiert werden." Keine
      // Gnadenfrist mehr: nur ein wirklich DURCHGEHENDER Zug beschleunigt.
      menuNavHoldDir = null;
      return;
    }
    const neu = menuNavHoldDir !== dir;
    if (neu) {
      menuNavHoldDir = dir;
      menuNavHoldStart = jetzt;
      menuNavLastStep = jetzt;
      menuNavAdjust(dir, false);
      return;
    }
    // NUR REGLER WIEDERHOLEN BEIM HALTEN. Ein Auswahlfeld schaltete nach 300 ms Halten
    // weiter - ein etwas laengerer Druck sprang so schon zwei Optionen. Gemeldet: "manche
    // Menues schalten mehrere Optionen auf einmal durch". Auswahlfelder: ein Druck, ein Schritt.
    // "Meine Teile" darf wie eine Skala beim Halten weiterlaufen (viel hin und her waehlen).
    const rows = menuNavRows();
    const zeile = rows[menuNavIndex];
    if (!zeile || (zeile.kind !== 'range' && zeile.kind !== 'teile' && zeile.kind !== 'raum')) return;
    const seitZugbeginn = jetzt - menuNavHoldStart;
    const beschleunigt = seitZugbeginn >= MENU_NAV_ACCEL_MS;
    const naechsterSchrittNach = menuNavLastStep === menuNavHoldStart
      ? MENU_NAV_REPEAT_START_MS
      : (beschleunigt ? MENU_NAV_REPEAT_FAST_MS : MENU_NAV_REPEAT_MS);
    if (jetzt - menuNavLastStep >= naechsterSchrittNach) {
      menuNavLastStep = jetzt;
      menuNavAdjust(dir, beschleunigt);
    }
  }

  // Gamepad-Name des obigen, damit der Aufrufer in 90-ghosts.js nicht raten muss, dass
  // er denselben Zustand mit der Tastatur teilt.
  function menuNavAdjustPad(dir, held) { menuNavAdjustGehalten(dir, held); }

  // Tabwechsel per rohem Steuerkreuz (nicht belegbar - siehe die Begruendung bei
  // pollGamepad()). Ueberspringt versteckte Tab-Knoepfe (data-parent, hidden) genau wie
  // die sichtbare Leiste sie ueberspringt.
  function menuNavTabWechsel(d) {
    // Kein Tabwechsel hinter einem offenen Info-Popup - sonst landet man beim
    // Schliessen ueberraschend auf einem anderen Tab, als man verlassen hatte.
    if (optInfoOffen()) return;
    // BESTELLT: "im submenü soll dpad linksrechts nicht den tab ändern, da will ich erst
    // Kreis drücken müssen, um das submenü zu verlassen (oder den zurückpfeil oben)."
    // Dasselbe Element, das menuNavContainer() schon fuer ein offenes Submenu sucht (oben,
    // .subpage.on) - keine neue Zustandsvariable noetig, nur dieselbe Frage noch einmal
    // gestellt.
    if (document.querySelector('.tabpage.active .subpage.on')) return;
    const buttons = [...document.querySelectorAll('.tab-btn')].filter((b) => b.offsetParent !== null);
    if (!buttons.length) return;
    const now = buttons.findIndex((b) => b.classList.contains('active'));
    const i = (((now < 0 ? 0 : now) + (d >= 0 ? 1 : -1)) % buttons.length + buttons.length) % buttons.length;
    buttons[i].click();
  }

