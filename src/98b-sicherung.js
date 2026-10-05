  // ================================================================================
  // SICHERUNG: alles, was diese App sich merkt, in EINER Datei
  // ================================================================================
  //
  // BESTELLT: "Wo ist in der Garage die Speichermoeglichkeit? Die Fahreinstellungen und
  // globale Einstellungen (Autonamen, Rundenzeiten, letzter eingestellter Rennmodus, ...)
  // sollen alle als Datei gespeichert und importiert werden koennen."
  //
  // ---- WARUM DAS NOETIG IST, UND NICHT NUR BEQUEM --------------------------------
  //
  // Alles liegt in localStorage. Ein Browser darf das raeumen - beim Aufraeumen von
  // Websitedaten, im privaten Modus, auf einem iPhone auch nach sieben Tagen ohne Besuch.
  // navigator.storage.persist() wird seit v0.8.96 angefordert (unten, best effort). Fuer die Sitzungshistorie
  // (bis 200 Rennen mit allen Rundenzeiten) ist das die eigentliche Schwachstelle: die ist
  // nicht nachbaubar, anders als eine Abstimmung.
  //
  // Diese Datei ist die Antwort darauf. Ein Umzug auf IndexedDB waere die groessere und ist
  // hier ausdruecklich NICHT gemacht.
  //
  // ---- WARUM EINE PRAEFIXREGEL UND KEINE LISTE VON SCHLUESSELN -------------------
  //
  // Beim Sammeln habe ich zwoelf Schluessel-Konstanten im Quelltext gefunden - und einen
  // dreizehnten erst, als ich in den localStorage eines laufenden Browsers geschaut habe:
  // carrera-hybrid-gamepad-bindings-v2, die komplette Tastenbelegung des Gamepads, 1223
  // Byte muehsame Handarbeit. Eine Liste haette ihn nicht enthalten, und die Sicherung
  // haette still ohne ihn funktioniert.
  //
  // Genau so veraltet jede Liste. Die Regel dagegen erfasst auch den vierzehnten
  // Schluessel, den es noch nicht gibt - und ein Selbsttest prueft, dass jede bekannte
  // Konstante unter die Regel faellt. Wer einen Schluessel mit anderem Praefix einfuehrt,
  // erfaehrt es von dem Test und nicht von einem Nutzer mit verlorenen Rundenzeiten.
  const SICHERUNG_PRAEFIXE = ['chc.', 'carrera-hybrid', 'omegasim'];
  const SICHERUNG_TYP = 'omegasim-sicherung';
  const SICHERUNG_VERSION = 1;

  // Die Selbstsicherung der Regler. Sie liegt ABSICHTLICH NICHT im Buendel: die Regler
  // stehen dort schon in ihrem eigenen Abschnitt, und zweimal dieselbe Sache in einer Datei
  // heisst, beim Einlesen entscheiden zu muessen, welche der beiden gewinnt.
  const AUTO_STORE = 'chc.auto.v1';

  // ---- WAS ALS "EINSTELLUNG" GILT ------------------------------------------------
  //
  // Dieselbe Zeilenform wie presetControls(), aber ZWEI Reiter: die Abstimmung steht in den
  // Optionen, die Renneinstellungen (Rundenzahl, Sektoren, Wetter, Pflichtstopps,
  // Startfuellung) in der Steuerung. Nachgezaehlt im Browser: 97 und 8.
  //
  // UND ZWEI UNTERSCHIEDE ZU presetControls(), beide gewollt:
  //
  //   1. data-preset-skip wird hier NICHT beachtet. Das Attribut nimmt den Layout-Waehler
  //      aus, weil eine Abstimmung beschreibt, WIE ein Auto eingestellt ist, und nicht
  //      WELCHES man hat. Eine Sicherung beschreibt aber genau beides - sie soll den Stand
  //      des Geraets wiederherstellen, nicht eine Abstimmung uebertragen.
  //   2. race-mode kommt namentlich dazu. Er liegt als einziger Renn-Waehler AUSSERHALB
  //      einer .opt-row, und er war ausdruecklich bestellt ("letzter eingestellter
  //      Rennmodus"). Eine benannte Ausnahme mit Grund - und kein aufgeweiteter Selektor,
  //      der nebenbei sess-plot-pick mitnehmen wuerde.
  const SICHERUNG_REITER = ['tab-options', 'tab-control'];
  const SICHERUNG_EXTRA = ['race-mode', 'mp-force-preset', 'grid-selbst'];

  function sicherungRegler() {
    // .opt-row sind die Abstimmungs- und Rennregler, .mw-row die Motorwerkstatt-Regler
    // (Zylinder, Bauart, Kurbelwelle ...) - beide sollen beim Neuladen wieder da sein.
    const sel = SICHERUNG_REITER.map((t) =>
      '#' + t + ' .opt-row input[id]:not([type=file]):not([type=button]), '
      + '#' + t + ' .opt-row select[id], '
      + '#' + t + ' .mw-row input[id]:not([type=file]):not([type=button]), '
      + '#' + t + ' .mw-row select[id]').join(', ');
    const els = [...document.querySelectorAll(sel)];
    for (const id of SICHERUNG_EXTRA) {
      const el = document.getElementById(id);
      if (el && els.indexOf(el) < 0) els.push(el);
    }
    return els;
  }

  function sicherungReglerLesen() {
    const out = {};
    for (const el of sicherungRegler()) {
      out[el.id] = el.type === 'checkbox' ? el.checked
                 : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
    }
    return out;
  }

  // Alle Schluessel dieser App, zur Laufzeit gefunden. Die Selbstsicherung bleibt draussen.
  function sicherungSchluessel() {
    const raus = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === AUTO_STORE) continue;
        if (SICHERUNG_PRAEFIXE.some((p) => k.indexOf(p) === 0)) raus.push(k);
      }
    } catch (e) { /* privater Modus: dann gibt es eben nichts zu sichern */ }
    return raus.sort();
  }

  // ---- DER UMSCHLAG ---------------------------------------------------------------
  //
  // Die Ablagen kommen ROH hinein, als Zeichenkette, genau wie sie im localStorage stehen.
  // Sie zu zerlegen und wieder zusammenzusetzen hiesse, das Format jeder einzelnen kennen
  // zu muessen - und ein Formatwechsel in 97-sessions.js wuerde dann die Sicherung
  // beschaedigen, ohne dass dort jemand daran denkt. Roh durchgereicht ist die Sicherung
  // von allen Formaten unabhaengig.
  function sicherungLesen() {
    const ablagen = {};
    for (const k of sicherungSchluessel()) {
      try { ablagen[k] = localStorage.getItem(k); } catch (e) { /* uebergehen */ }
    }
    return {
      typ: SICHERUNG_TYP,
      version: SICHERUNG_VERSION,
      // Die Version aus dem Fuss und nicht aus einer zweiten Quelle: build.py
      // schreibt sie dort hinein, und zwei Stellen liefen sonst auseinander.
      app: ($('app-version') ? $('app-version').textContent.trim() : null),
      erstellt: new Date().toISOString(),
      regler: sicherungReglerLesen(),
      ablagen,
    };
  }

  // ---- VERSIONSFEST IN BEIDE RICHTUNGEN ------------------------------------------
  //
  // BESTELLT war, dass die Sicherung auch dann funktioniert, wenn neue Werte dazukommen.
  // Das sind ZWEI Faelle, und der heutige Preset-Import behandelt nur einen davon:
  //
  //   Datei kennt einen Regler, die App nicht  -> gezaehlt, benannt, uebergangen.
  //   App kennt einen Regler, die Datei nicht  -> bleibt stehen und wird BERICHTET.
  //
  // Der zweite ist der, der fehlte. Er ist der haeufigere von beiden - jede Sicherung ist
  // aelter als die App, in die sie geladen wird - und der unangenehmere: ein Regler, der
  // stumm auf der Werksvorgabe stehen bleibt, sieht aus wie ein wiederhergestellter.
  function sicherungPruefen(b) {
    if (!b || typeof b !== 'object') return { fehler: 'Das ist keine Sicherung.' };
    if (b.typ !== SICHERUNG_TYP) {
      return { fehler: 'Das ist keine OmegaSim-Sicherung (Typ: '
                     + (b.typ === undefined ? 'fehlt' : String(b.typ).slice(0, 40)) + ').' };
    }
    if (!(b.version <= SICHERUNG_VERSION)) {
      return { fehler: 'Diese Sicherung ist Fassung ' + b.version
                     + ', diese App versteht bis ' + SICHERUNG_VERSION
                     + '. Bitte die App aktualisieren.' };
    }
    const regler = b.regler && typeof b.regler === 'object' ? b.regler : {};
    // presetPruefen() aus 98-presets.js - dieselbe Pruefung, die der Preset-Import nutzt.
    const { bad, unknown } = presetPruefen(regler);
    const neu = sicherungRegler().map((el) => el.id)
      .filter((id) => !Object.prototype.hasOwnProperty.call(regler, id));
    const ablagen = b.ablagen && typeof b.ablagen === 'object' ? b.ablagen : {};
    const fremd = Object.keys(ablagen)
      .filter((k) => !SICHERUNG_PRAEFIXE.some((p) => k.indexOf(p) === 0));
    return { bad, unknown, neu, fremd,
             regler: Object.keys(regler).length, ablagen: Object.keys(ablagen).length };
  }

  function sicherungAnwenden(b) {
    const p = sicherungPruefen(b);
    if (p.fehler) return p;
    // Unbrauchbare Werte brechen ab und aendern NICHTS. Eine halb angewandte Sicherung ist
    // schlimmer als eine abgelehnte: danach weiss niemand mehr, was der Stand ist.
    if (p.bad.length) {
      return { fehler: 'Unbrauchbare Werte, nichts geaendert: ' + p.bad.join(', ') };
    }
    // ZUERST die Ablagen, DANN die Regler. Manche Regler schreiben beim Setzen in eine
    // Ablage (der Layout-Waehler in chc.layout.v1, die Sprache in omegasim-lang); in der
    // anderen Reihenfolge wuerde die eben geladene Ablage vom Regler ueberschrieben.
    //
    // FREMDE SCHLUESSEL BLEIBEN DRAUSSEN. Eine Datei aus fremder Hand darf nicht beliebige
    // Schluessel in den localStorage dieser Herkunft schreiben - die Praefixregel gilt beim
    // Einlesen genauso wie beim Sichern.
    //
    // ---- UND EINE ENTSCHEIDUNG, DIE MAN SEHEN MUSS ------------------------------
    //
    // GELADEN WIRD ZUSAMMENGEFUEHRT UND NICHT ERSETZT. Was die Sicherung enthaelt, wird
    // geschrieben; was seit der Sicherung dazugekommen ist, BLEIBT. Eine Strecke, die man
    // gestern gebaut hat, ueberlebt also das Laden einer Sicherung von vorletzter Woche.
    //
    // Die Gegenrichtung waere "genau dieser Stand, alles andere weg" - und das heisst, beim
    // Laden einer alten Sicherung Rundenzeiten und Strecken zu loeschen, die nicht darin
    // stehen. Das ist Datenverlust auf Knopfdruck, ausgeloest von jemandem, der gerade das
    // Gegenteil wollte. Wer wirklich aufraeumen will, loescht die Websitedaten - da fragt
    // der Browser nach, und hier fragt niemand.
    //
    // Aufgefallen ist es der Sonde: sie erwartete zuerst, dass ein zwischendurch angelegter
    // Schluessel nach dem Laden weg ist. Er war es nicht, und die Sonde hatte unrecht, nicht
    // der Code. Sie prueft jetzt die Zusammenfuehrung - und die Karte in der Garage sagt es.
    let nAblagen = 0;
    for (const [k, v] of Object.entries(b.ablagen || {})) {
      if (!SICHERUNG_PRAEFIXE.some((pf) => k.indexOf(pf) === 0)) continue;
      if (typeof v !== 'string') continue;
      try { localStorage.setItem(k, v); nAblagen++; } catch (e) { /* voll oder privat */ }
    }
    let nRegler = 0;
    for (const [id, val] of Object.entries(b.regler || {})) {
      if (presetSet(id, val)) nRegler++;
    }
    return Object.assign(p, { nRegler, nAblagen });
  }

  // ---- SELBSTSICHERUNG: DIE REGLER UEBERLEBEN EINEN NEUSTART ---------------------
  //
  // GEMESSEN, und es war eine Ueberraschung: vor dieser Aenderung ueberlebte KEIN EINZIGER
  // der 105 Regler einen Neustart. Im localStorage eines laufenden Browsers standen sieben
  // Schluessel - Sprache, Layout, Cockpit, Getriebe, Mehrspieler, Gamepad - und kein
  // einziger Optionswert. Sie fielen beim Laden auf die Vorgaben im Markup zurueck, also
  // auf die Voreinstellung "Pro".
  //
  // Wer die Reifenabnutzung einstellte und den Browser schloss, fand sie beim naechsten Mal
  // auf Werkseinstellung - ohne Hinweis. Das ist nicht dasselbe wie die Dateisicherung, und
  // keins von beiden ersetzt das andere: die Datei ist gegen Datenverlust, das hier gegen
  // die alltaegliche Ueberraschung.
  //
  // EIN ZUHOERER AM DOKUMENT, nicht einer je Regler: 105 Zuhoerer waeren 105 Stellen, an
  // denen ein spaeter dazukommender Regler vergessen wird. Dieselbe Begruendung wie bei
  // updateGaragePresetRow() in 98-presets.js.
  let autoSicherungFaellig = null;
  let autoSicherungAt = 0;
  function autoSicherungSchreiben() {
    try { localStorage.setItem(AUTO_STORE, JSON.stringify(sicherungReglerLesen())); autoSicherungAt = Date.now(); }
    catch (e) { /* privater Modus oder voll - dann eben nicht */ }
    if (typeof sichStandZeigen === 'function') sichStandZeigen();
  }
  function autoSicherungPlanen() {
    // Gebuendelt: ein Zug am Schieberegler feuert 'input' dutzendfach, und jedes Mal alle
    // 105 Regler zu lesen und JSON zu bauen waere Arbeit im Fahrbetrieb.
    if (autoSicherungFaellig !== null) return;
    autoSicherungFaellig = setTimeout(() => {
      autoSicherungFaellig = null;
      autoSicherungSchreiben();
    }, 400);
  }
  function autoSicherungLaden() {
    let roh = null;
    try { roh = localStorage.getItem(AUTO_STORE); } catch (e) { return 0; }
    if (!roh) return 0;
    let cfg;
    try { cfg = JSON.parse(roh); } catch (e) { return 0; }
    if (!cfg || typeof cfg !== 'object') return 0;
    // ---- EINMALIGE UMSTELLUNG: DER ALTE VORGABEWERT STECKT NOCH IN DER SELBSTSICHERUNG --
    //
    // v0.7.9 hob steerExpo (Lenkkennlinie) von 1.15 auf 1.3 an. v0.7.52 hat das
    // zurueckgenommen: "beim gas geben ist die Lenkung jetzt extrem schwach... mach es so
    // wie in v0.6.xx". GEMELDET DANACH, mit v0.7.52 laengst installiert: "das mit dem
    // Lenken beim Beschleunigen fuehlt sich noch nicht so gut an" - der neue Vorgabewert
    // im Markup aendert NICHTS an einer bereits vorhandenen Selbstsicherung, und wer die
    // App zwischen v0.7.9 und v0.7.51 irgendeine Einstellung geaendert hat (das genuegt,
    // autoSicherungSchreiben() sichert dabei ALLE Regler auf einmal, nicht nur den
    // beruehrten), hat 1.3 dort liegen - und die ueberschreibt seither lautlos jeden neuen
    // Vorgabewert. Einmalig markiert (chc.migrate.steerexpo115.v1), damit ein SPAETER
    // bewusst auf 1.3 gestellter Wert nicht ein zweites Mal zurueckgedreht wird.
    if (cfg['setting-steer-expo'] === 1.3) {
      let migriert = false;
      try { migriert = localStorage.getItem('chc.migrate.steerexpo115.v1') === '1'; }
      catch (e) { /* privater Modus: dann eben jedes Mal, schadet nicht */ }
      if (!migriert) {
        cfg['setting-steer-expo'] = 1.15;
        try {
          localStorage.setItem('chc.migrate.steerexpo115.v1', '1');
          // ZURUECKGESCHRIEBEN und nicht nur im Speicher berichtigt: sonst stuende die 1.3
          // beim naechsten Laden wieder roh in der Ablage, der Migrationsschalter wuerde
          // eine zweite Korrektur verhindern (er ist ja schon gesetzt), und die Berichtigung
          // waere genau einmal wirksam gewesen und dann nie wieder.
          localStorage.setItem(AUTO_STORE, JSON.stringify(cfg));
        } catch (e) { /* privater Modus oder voll - dann eben nur fuer diese Sitzung */ }
      }
    }
    // ---- EINMALIGE UEBERNAHME DER KENNLINIEN 2,45 (v0.8.40) --------------------------
    // BESTELLT: "Gas- und Bremskennlinien standardmaessig auf 2,45 einstellen", die Lenkung
    // wie Gas und Bremse. Dieselbe Falle wie oben: die Selbstsicherung haelt die alten
    // Vorgaben fest. Nur wer noch GENAU auf der alten Vorgabe steht, bekommt die neue;
    // eigene Werte bleiben, und der Schalter verhindert ein zweites Mal.
    {
      let erledigt = false;
      try { erledigt = localStorage.getItem('chc.migrate.kennlinien245.v1') === '1'; } catch (e) { /* privat */ }
      if (!erledigt) {
        const alt = { 'setting-throttle-gamma': 1, 'setting-brake-gamma': 1.3, 'setting-steer-expo': 1.15 };
        let geaendert = false;
        for (const [id, wert] of Object.entries(alt)) {
          if (cfg[id] === wert) { cfg[id] = 2.45; geaendert = true; }
        }
        try {
          localStorage.setItem('chc.migrate.kennlinien245.v1', '1');
          if (geaendert) localStorage.setItem(AUTO_STORE, JSON.stringify(cfg));
        } catch (e) { /* dann eben nur fuer diese Sitzung */ }
      }
    }
    // AUCH HIER GEPRUEFT. Die eigene Ablage ist nicht vertrauenswuerdiger als eine Datei:
    // sie kann aus einer aelteren Fassung stammen, in der ein Regler andere Grenzen hatte.
    const { bad } = presetPruefen(cfg);
    const schlecht = new Set(bad.map((x) => x.split('=')[0]));
    let n = 0;
    for (const [id, val] of Object.entries(cfg)) {
      if (schlecht.has(id)) continue;
      if (presetSet(id, val)) n++;
    }
    return n;
  }

  // ---- WAS LIEGT GERADE IM BROWSER? ------------------------------------------------
  //
  // BESTELLT: "Zeige bei der Sicherung noch an, ob irgendetwas geladen ist, sodass ich es
  // weiss, bevor dann das Auto wieder als generisches weisses 'alpha' verbunden wird."
  //
  // DIE AUTOS SIND DER KERN, und deshalb stehen sie zuerst und mit NAMEN: carAssign() in
  // 90-ghosts.js holt Name und Farbe aus chc.cars.v1 anhand der Geraete-Kennung. Liegt
  // dort nichts, bekommt das naechste Auto den naechsten freien Namen ("Alpha") und die
  // naechste freie Farbe. Das ist der Moment, den man VORHER wissen will - nachher laesst
  // er sich nur noch von Hand richten.
  //
  // GEZAEHLT WIRD, WAS WIRKLICH DA IST, und nicht, was da sein koennte: jede Zeile kommt
  // aus einem Blick in die Ablage. Eine Liste der Ablagen mit "vorhanden/nicht vorhanden"
  // waere eine Aufzaehlung von Namen, die niemandem sagt, ob sein Auto seinen Namen
  // behaelt.
  const LAGE_ABLAGEN = [
    // Schluessel, Name, und wie man den Inhalt zaehlt. `zahl` gibt null zurueck, wenn es
    // nichts zu zaehlen gibt - dann wird die Zeile weggelassen.
    ['chc.layout.v1', 'Fahrzeug-Layout', (v) => (v && Object.keys(v).length) || null],
    ['carrera-hybrid-tracks', 'Strecken', (v) => (Array.isArray(v) ? v.length : null)],
    ['chc.sessions.v1', 'Sitzungen', (v) => (Array.isArray(v) ? v.length
                                             : (v && v.sitzungen ? v.sitzungen.length : null))],
    ['carrera-hybrid-macros', 'Aufnahmen', (v) => (Array.isArray(v) ? v.length
                                                   : (v ? Object.keys(v).length : null))],
    ['chc.motorwerkstatt.v1', 'Motorwerkstatt', (v) => (v && Object.keys(v).length) || null],
    ['chc.presets.v1', 'eigene Voreinstellungen', (v) => (v && Object.keys(v).length) || null],
    ['carrera-hybrid-gamepad-bindings-v2', 'Tastenbelegung',
      (v) => (v && Object.keys(v).length ? 1 : null)],
  ];

  function lageLesen() {
    const hol = (k) => {
      let roh = null;
      try { roh = localStorage.getItem(k); } catch (e) { return null; }
      if (!roh) return null;
      try { return JSON.parse(roh); } catch (e) { return null; }
    };
    // Die Autos, mit Name und Farbe. Die Geraete-Kennung bleibt DRAUSSEN: sie ist lang,
    // sagt niemandem etwas, und sie ist die einzige Angabe hier, die ein Geraet
    // identifiziert.
    const autos = [];
    const roh = hol('chc.cars.v1') || {};
    for (const k of Object.keys(roh)) {
      const e = roh[k] || {};
      autos.push({ alias: e.alias || '', colorId: e.color || null });
    }
    const regler = hol(AUTO_STORE);
    return {
      autos,
      regler: regler && typeof regler === 'object' ? Object.keys(regler).length : 0,
      posten: LAGE_ABLAGEN.map(([k, name, zahl]) => {
        const v = hol(k);
        const n = v === null ? null : zahl(v);
        return n ? { name, n } : null;
      }).filter(Boolean),
    };
  }

  function lageZeichnen() {
    const el = $('sich-lage');
    if (!el) return null;
    const l = lageLesen();
    // Die Farbe eines gemerkten Autos aus derselben Tabelle, aus der carAssign() sie
    // nimmt - sonst zeigt die Zeile eine andere Farbe als das Auto nachher hat.
    const farbe = (id) => {
      if (typeof CAR_COLORS === 'undefined') return null;
      const c = CAR_COLORS.find((x) => x.id === id);
      return c ? c : null;
    };
    const teile = [];
    if (l.autos.length) {
      const namen = l.autos.map((a, i) => {
        const f = farbe(a.colorId);
        const punkt = f ? '<span class="sich-farbe" style="background:' + f.hex
                          + '"></span>' : '';
        // Ohne eingetragenen Namen zeigt die Zeile die FARBE als Kennung - genau die
        // bekommt das Auto beim Verbinden auch wieder.
        const wie = a.alias ? a.alias : (f ? f.name : 'ohne Namen');
        return '<span class="sich-auto">' + punkt + wie + '</span>';
      });
      teile.push('<span class="sich-punkt"><b>' + l.autos.length + ' Auto'
                 + (l.autos.length === 1 ? '' : 's') + ' gemerkt:</b> '
                 + namen.join(', ') + '</span>');
    }
    if (l.regler) {
      teile.push('<span class="sich-punkt">' + l.regler + ' Einstellungen</span>');
    }
    for (const p of l.posten) {
      teile.push('<span class="sich-punkt">' + p.n + ' ' + p.name + '</span>');
    }
    const leer = !l.autos.length && !l.regler && !l.posten.length;
    el.classList.toggle('leer', leer);
    if (leer) {
      el.innerHTML = '<b>Im Browser liegt nichts.</b> Ein neu verbundenes Auto bekommt '
                   + 'den n\u00e4chsten freien Namen und die n\u00e4chste freie Farbe '
                   + '\u2013 das erste also &bdquo;Alpha&ldquo; in Wei\u00df.';
    } else {
      let kopf = '<b>Im Browser liegt:</b>';
      // UND DIE FOLGE FUER DAS NAECHSTE AUTO, ausgesprochen. Ohne sie muss man aus
      // "0 Autos gemerkt" selbst schliessen, was beim Verbinden passiert.
      let fuss = l.autos.length
        ? 'Ein bekanntes Auto bekommt seinen Namen und seine Farbe zur\u00fcck; ein neues '
          + 'den n\u00e4chsten freien.'
        : '<b>Keine Autos gemerkt</b> \u2013 ein neu verbundenes bekommt '
          + '&bdquo;Alpha&ldquo; in Wei\u00df.';
      el.innerHTML = kopf + '<div class="sich-punkte">' + teile.join('') + '</div>'
                   + '<div style="margin-top:5px">' + fuss + '</div>';
    }
    return l;
  }

  // Beim Laden, und nach jedem Einlesen oder Loeschen. Die Garage ruft sie beim Verbinden
  // nicht: dort aendert sich der Bestand erst, wenn ein Name oder eine Farbe gesetzt wird,
  // und dann laeuft carRemember() - siehe den Ruf in renderGarage().
  lageZeichnen();

  // ---- DIE BEDIENUNG IN DER GARAGE ------------------------------------------------
  function sicherungSagen(t, art) {
    const el = $('sich-status');
    if (!el) return;
    el.textContent = t;
    el.className = 'muted' + (art ? ' sich-' + art : '');
  }

  // Was nach einem Einlesen zu sagen ist. Getrennt von sicherungAnwenden(), damit die
  // Sonde dasselbe Ergebnis lesen kann, das hier zu Text wird.
  function sicherungBericht(r) {
    if (r.fehler) return r.fehler;
    let t = r.nRegler + ' Einstellungen und ' + r.nAblagen + ' Ablagen geladen.';
    if (r.neu.length) {
      t += ' ' + r.neu.length + ' Einstellung' + (r.neu.length === 1 ? '' : 'en')
         + ' gibt es erst seit dieser Sicherung und bleibt'
         + (r.neu.length === 1 ? '' : 'en') + ' auf dem bisherigen Wert: '
         + r.neu.slice(0, 6).join(', ') + (r.neu.length > 6 ? ' und weitere' : '') + '.';
    }
    if (r.unknown.length) {
      t += ' ' + r.unknown.length + ' Eintrag' + (r.unknown.length === 1 ? '' : 'e')
         + ' aus der Datei kennt diese App nicht: '
         + r.unknown.slice(0, 6).join(', ') + (r.unknown.length > 6 ? ' und weitere' : '')
         + '.';
    }
    if (r.fremd.length) {
      t += ' ' + r.fremd.length + ' fremde Ablage' + (r.fremd.length === 1 ? '' : 'n')
         + ' uebergangen.';
    }
    return t;
  }

  if ($('sich-export')) {
    $('sich-export').onclick = () => {
      const b = sicherungLesen();
      const txt = JSON.stringify(b, null, 2);
      const blob = new Blob([txt], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'omegasim-sicherung-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      sicherungSagen(Object.keys(b.regler).length + ' Einstellungen und '
                     + Object.keys(b.ablagen).length + ' Ablagen gesichert ('
                     + Math.round(txt.length / 1024) + ' kB).', 'ok');
    };
  }

  if ($('sich-import')) {
    $('sich-import').onclick = () => $('sich-datei').click();
    $('sich-datei').onchange = async (e) => {
      const datei = e.target.files[0];
      e.target.value = '';
      if (!datei) return;
      let b;
      try {
        b = JSON.parse(await datei.text());
      } catch (err) {
        sicherungSagen('Die Datei ist nicht lesbar: ' + err.message, 'bad');
        return;
      }
      const r = sicherungAnwenden(b);
      sicherungSagen(sicherungBericht(r), r.fehler ? 'bad' : 'ok');
      // Der Bestand hat sich gerade geaendert - die Lage neu hinschreiben.
      lageZeichnen();
      if (!r.fehler) {
        // Die Ablagen werden erst beim Laden gelesen - Strecken, Sitzungen, Autonamen,
        // Gamepad. Ehrlich hingeschrieben statt selbst neu zu laden: ein erzwungenes
        // Neuladen mitten in einer Verbindung trennt das Auto.
        sicherungSagen(sicherungBericht(r)
          + ' Strecken, Rundenzeiten, Autonamen und Tastenbelegung sind nach einem Neuladen'
          + ' der Seite da.', 'ok');
        lageZeichnen();
      }
    };
  }

  // Beim Laden: die Selbstsicherung anwenden, BEVOR irgendwer die Regler liest.
  //
  // Sie laeuft hier und nicht in 50-drive.js, und das ist keine Bequemlichkeit: diese Datei
  // ist die letzte, die der Erzeuger einbaut, also sind alle let aller Dateien initialisiert
  // und presetSet() darf jeden Regler anfassen. Frueher gerufen waere es die temporale
  // Todeszone - dieselbe Falle, die bei dirtyAirVerfuegbar() dokumentiert ist.
  const autoGeladen = autoSicherungLaden();
  if (autoGeladen) {
    log('Einstellungen aus der letzten Sitzung geladen: ' + autoGeladen + ' Regler.', 'info');
  }
  // ---- DIE ANZEIGETEXTE DER SCHIEBEREGLER, EINMAL BEIM LADEN --------------------
  //
  // GEMESSEN, und es war eine Ueberraschung: ZEHN Regler zeigten einen Text, der nicht zu
  // ihrer Stellung passte. Der schlimmste war ghost-lanes - Regler auf 1, Anzeige "aus".
  //
  //     Kennung               steht auf   zeigte
  //     ghost-lanes            1 (100 %)   "aus"
  //     ghost-lateral          2            80 %
  //     ghost-line             2           100 %
  //     ghost-quertempo        4           2.0
  //     ghost-exit             0            80 %
  //     ghost-gasdyn           4           1.0
  //     ghost-speed            0,55         50 %
  //     setting-topspeed       1,8         160 %
  //     setting-crash-count    4           10
  //     setting-repair-time    4           10 s
  //
  // ---- DIE URSACHE IST EINE ZWEITE QUELLE FUER DENSELBEN WERT -------------------
  //
  // Der Zahlentext steht als statischer Inhalt im Markup, und die Zuhoerer schreiben ihn
  // erst bei 'input'. Wer also die Vorgabe eines Reglers aendert - und genau das ist bei
  // der Kalibrierung dutzendfach passiert -, laesst den alten Text stehen. Es gibt keine
  // Meldung, nichts bricht, und die Anzeige luegt bis zur ersten Beruehrung des Reglers.
  //
  // ---- WARUM EIN DURCHLAUF UND NICHT ZEHN NACHGETRAGENE AUFRUFE ------------------
  //
  // ghost-quer-test (80-sound.js) und setting-tyres machen es richtig: Funktion benennen,
  // an 'input' binden, einmal mit dem Markup-Wert aufrufen. Das zehnmal nachzutragen waere
  // zehn Stellen, an denen Regler Nummer elf fehlt - dieselbe Begruendung wie bei
  // updateGaragePresetRow(): ein Zuhoerer statt einer je Regler.
  //
  // NACHGEMESSEN, DASS ES FOLGENLOS IST: ein zweiter Durchlauf aendert nichts mehr (0 von
  // 10 Abweichungen). Die Zuhoerer sind idempotent, sie lesen den Reglerstand und schreiben
  // ihn zurueck - ein 'input' ohne Nutzerhandlung setzt also nichts anderes.
  //
  // HIER UND NICHT FRUEHER, aus demselben Grund wie die Selbstsicherung darueber: erst in
  // dieser Datei sind alle Zuhoerer gebunden. In 80-sound.js gerufen waere es die Haelfte.
  //
  // Der Aufruf steht NACH autoSicherungLaden(), und das ist der Grund, warum mir der Fehler
  // so lange entgangen ist: presetSet() feuert 'input' auf jeden Regler, eine vorhandene
  // Selbstsicherung raeumt die Texte also nebenbei mit auf. Sichtbar war die Luege nur beim
  // allerersten Start - und das ist genau der Fall, den ein neuer Nutzer sieht.
  function reglerTexteAuffrischen() {
    let n = 0;
    for (const el of document.querySelectorAll('input[type=range][id]')) {
      if (!document.getElementById(el.id + '-val')) continue;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      n++;
    }
    return n;
  }
  reglerTexteAuffrischen();

  // 'change' UND 'input': Auswahlfelder und Ankreuzfelder melden nur 'change', Schieber
  // melden beides. Beide zu nehmen kostet nichts, weil das Schreiben gebuendelt ist.
  document.addEventListener('change', (e) => {
    if (e.target && e.target.closest
        && (e.target.closest('#tab-options, #tab-control, #tab-mp')
            || SICHERUNG_EXTRA.indexOf(e.target.id) >= 0)) autoSicherungPlanen();
  }, true);
  document.addEventListener('input', (e) => {
    if (e.target && e.target.closest
        && (e.target.closest('#tab-options, #tab-control, #tab-mp')
            || SICHERUNG_EXTRA.indexOf(e.target.id) >= 0)) autoSicherungPlanen();
  }, true);
  // BESTELLT: "alle einstellungen im browsercache gespeichert werden und auch bei neuladen
  // der seite da bleiben (bei apk im cache speichern)". localStorage ueberlebt das Neuladen,
  // aber der Browser (oder die WebView in der APK) kann es verwerfen. storage.persist() bittet
  // um dauerhafte Aufbewahrung - best effort, kein Fehler, wenn die Anfrage abgelehnt wird.
  if (navigator.storage && navigator.storage.persist) {
    try { navigator.storage.persist(); } catch (e) { /* nicht moeglich - dann eben nicht */ }
  }

  // ==== SICHERUNG, DIE EINE NEUINSTALLATION UEBERLEBT (v0.9.6) ============================
  //
  // BESTELLT: "Idealerweise ueberleben meine Statistiken, geladenen Strecken, usw. auch eine
  // Neuinstallation der App mit neuer APK." Ein APK-Update behaelt den localStorage, ein
  // Deinstallieren loescht ihn. In der App (ab APK 0.9.6, Plugin OmegaSicherung) wird darum
  // die ganze Sicherung - dieselbe wie "Sicherung speichern" - als Datei nach
  // Dokumente/OmegaSim/OmegaSim-Sicherung.json geschrieben: alle 2 Minuten, wenn sich etwas
  // geaendert hat, und sofort, wenn die App in den Hintergrund geht. Nach einer
  // Neuinstallation bietet die App beim ersten (leeren) Start an, sie wieder einzulesen.
  //
  // Der Merker steht unter einem Schluessel OHNE Sicherungs-Praefix, sonst aenderte er die
  // Sicherung bei jedem Schreiben und sie wuerde jedes Mal neu geschrieben.
  const SICH_DATEI_MERK = 'sicherungsdatei.v1';
  const SICH_GEFRAGT = 'sicherungsdatei.gefragt';
  function sichNativ() {
    const C = window.Capacitor;
    try {
      return !!(window.OMEGA_APP && window.OMEGA_APP.nativ && C && typeof C.isPluginAvailable === 'function'
                && C.isPluginAvailable('OmegaSicherung'));
    } catch (e) { return false; }
  }
  function sichHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h + ':' + s.length;
  }
  function sichMerk() {
    try { return JSON.parse(localStorage.getItem(SICH_DATEI_MERK) || 'null'); } catch (e) { return null; }
  }
  let sichSchreibt = false;
  async function sichDateiSchreiben(grund) {
    if (!sichNativ() || sichSchreibt) return null;
    const b = sicherungLesen();
    if (!Object.keys(b.ablagen).length && !Object.keys(b.regler).length) return null;
    const h = sichHash(JSON.stringify({ r: b.regler, a: b.ablagen }));
    const alt = sichMerk();
    if (alt && alt.hash === h && grund !== 'hand') return null;
    sichSchreibt = true;
    try {
      const r = await window.Capacitor.nativePromise('OmegaSicherung', 'speichern', { text: JSON.stringify(b) });
      try { localStorage.setItem(SICH_DATEI_MERK, JSON.stringify({ at: Date.now(), ort: r && r.ort, hash: h })); } catch (e) { /* voll */ }
      sichStandZeigen();
      return r;
    } catch (e) {
      log('Sicherungsdatei nicht geschrieben: ' + (e && e.message), 'warn');
      if (grund === 'hand') throw e;
      return null;
    } finally { sichSchreibt = false; }
  }
  function sichStandZeigen() {
    const el = $('sich-auto');
    if (!el) return;
    const uhr = (ms) => new Date(ms).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });
    let txt = t('Alles wird automatisch gespeichert, du musst nichts laden.');
    if (autoSicherungAt) txt += ' ' + t('Einstellungen zuletzt um {u}.').replace('{u}', uhr(autoSicherungAt));
    if (sichNativ()) {
      const m = sichMerk();
      txt += ' ' + (m && m.at
        ? t('Sicherungsdatei (übersteht eine Neuinstallation) zuletzt um {u}: {o}.').replace('{u}', uhr(m.at)).replace('{o}', m.ort || 'Dokumente/OmegaSim')
        : t('Die Sicherungsdatei in Dokumente/OmegaSim wird gleich angelegt.'));
    }
    el.textContent = txt;
  }
  async function sichWiederherstellen() {
    let r;
    try { r = await window.Capacitor.nativePromise('OmegaSicherung', 'oeffnen', {}); }
    catch (e) { if (e && e.message !== 'abgebrochen') sicherungSagen(String((e && e.message) || e), 'bad'); return false; }
    let b;
    try { b = JSON.parse(r.text); } catch (e) { sicherungSagen(t('Die Datei ist nicht lesbar') + ': ' + e.message, 'bad'); return false; }
    const erg = sicherungAnwenden(b);
    sicherungSagen(sicherungBericht(erg), erg.fehler ? 'bad' : 'ok');
    if (erg.fehler) { showHudToast(t('Sicherung nicht geladen')); return false; }
    try { localStorage.setItem(SICH_GEFRAGT, '1'); } catch (e) { /* egal */ }
    showHudToast(t('Sicherung geladen, die App startet neu …'));
    setTimeout(() => location.reload(), 1500);
    return true;
  }
  // In der App gehen "Sicherung speichern" und "Sicherung laden" ueber den nativen Weg: ein
  // Blob-Download (a.download) erreicht in der WebView keinen Ordner.
  if (sichNativ()) {
    if ($('sich-export')) $('sich-export').onclick = async () => {
      try {
        const r = await sichDateiSchreiben('hand');
        sicherungSagen(t('Gespeichert: {o}').replace('{o}', (r && r.ort) || 'Dokumente/OmegaSim'), 'ok');
      } catch (e) { sicherungSagen(String((e && e.message) || e), 'bad'); }
    };
    if ($('sich-import')) $('sich-import').onclick = () => { sichWiederherstellen(); };
    setInterval(() => { sichDateiSchreiben('takt'); }, 120000);
    setTimeout(() => { sichDateiSchreiben('start'); }, 20000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) sichDateiSchreiben('weg'); });
    // ERSTER START NACH EINER NEUINSTALLATION: nichts Gespeichertes da.
    let leer = true;
    try {
      leer = !['chc.sessions.v1', 'carrera-hybrid-tracks', 'chc.cars.v1', AUTO_STORE]
        .some((k) => localStorage.getItem(k)) && !localStorage.getItem(SICH_GEFRAGT);
    } catch (e) { leer = false; }
    if (leer && typeof konsoleFrage === 'function') {
      setTimeout(() => konsoleFrage(t('Frühere Daten wiederherstellen?'),
        t('Die App sichert alles automatisch in Dokumente/OmegaSim (Datei OmegaSim-Sicherung.json). Nach einer Neuinstallation kannst du sie hier wieder einlesen: Einstellungen, Strecken, Statistiken, Autos und Tastenbelegung.'),
        [[t('Sicherungsdatei wählen'), () => { sichWiederherstellen(); }],
         [t('Neu anfangen'), () => { try { localStorage.setItem(SICH_GEFRAGT, '1'); } catch (e) { /* egal */ } }]]), 1800);
    }
  }
  sichStandZeigen();

  // ==== AUSWAHLFELDER MIT WENIGEN WERTEN ALS "◀ WERT ▶" (v0.9.7) =========================
  //
  // BESTELLT: "Dropdowns mit weniger als 5 Optionen lieber mit Durchschaltmoeglichkeit". Jedes
  // Auswahlfeld einer Optionszeile mit hoechstens 4 Werten bekommt zwei Pfeile und den Wert
  // dazwischen; ein Tipp schaltet weiter (am Ende wieder von vorn). Das <select> bleibt im
  // Dokument, nur unsichtbar - Speicherung, Presets und das Steuerkreuz (menuNavAdjust, links/
  // rechts) arbeiten weiter mit ihm. Ausgenommen sind Felder, deren Liste zur Laufzeit gefuellt
  // wird (Preset-, Sitzungs- und Diagrammwahl).
  const BLAETTERN_MAX = 4;
  const BLAETTERN_NICHT = /store|preset|sess|plot|ablage/i;
  const blaetternFelder = [];
  function blaetternBauen(sel) {
    if (sel.dataset.blaettern) return;
    sel.dataset.blaettern = '1';
    const box = document.createElement('span');
    box.className = 'opt-blaettern';
    const pfeil = (txt, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ob-pf';
      b.textContent = txt;
      b.setAttribute('data-i18n-skip', '');
      b.setAttribute('aria-label', d < 0 ? t('zurück') : t('weiter'));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const n = sel.options.length;
        if (!n || sel.disabled) return;
        sel.selectedIndex = ((sel.selectedIndex + d) % n + n) % n;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return b;
    };
    const wert = document.createElement('span');
    wert.className = 'ob-wert';
    wert.setAttribute('data-i18n-skip', '');
    box.appendChild(pfeil('\u25C0', -1));
    box.appendChild(wert);
    box.appendChild(pfeil('\u25B6', 1));
    sel.insertAdjacentElement('afterend', box);
    sel.classList.add('ob-versteckt');
    const zeigen = () => {
      const o = sel.options[sel.selectedIndex];
      const txt = o ? o.textContent.trim() : '';
      if (wert.textContent !== txt) wert.textContent = txt;
      box.classList.toggle('aus', !!sel.disabled);
    };
    sel.addEventListener('change', zeigen);
    blaetternFelder.push(zeigen);
    zeigen();
  }
  function blaetternAuffrischen() { blaetternFelder.forEach((f) => f()); }
  function blaetternAlle() {
    document.querySelectorAll('.opt-row select').forEach((sel) => {
      if (sel.multiple || sel.hidden || sel.style.display === 'none') return;
      if (BLAETTERN_NICHT.test(sel.id || '')) return;
      if (sel.options.length < 2 || sel.options.length > BLAETTERN_MAX) return;
      blaetternBauen(sel);
    });
  }
  blaetternAlle();
  // Werte, die Code ohne 'change' setzt, und uebersetzte Optionstexte holt ein leiser Abgleich
  // nach (rund ein Dutzend Felder, einmal je Sekunde).
  setInterval(blaetternAuffrischen, 1000);
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => setTimeout(blaetternAuffrischen, 0));
