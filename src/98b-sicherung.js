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
  // Websitedaten, im privaten Modus, auf einem iPhone auch nach sieben Tagen ohne Besuch -
  // und navigator.storage.persist() wird nirgends angefordert. Fuer die Sitzungshistorie
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
  const SICHERUNG_EXTRA = ['race-mode'];

  function sicherungRegler() {
    const sel = SICHERUNG_REITER.map((t) =>
      '#' + t + ' .opt-row input[id]:not([type=file]):not([type=button]), '
      + '#' + t + ' .opt-row select[id]').join(', ');
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
  function autoSicherungSchreiben() {
    try { localStorage.setItem(AUTO_STORE, JSON.stringify(sicherungReglerLesen())); }
    catch (e) { /* privater Modus oder voll - dann eben nicht */ }
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
    ['chc.layout.v1', 'Streckenlayout', (v) => (v && Object.keys(v).length) || null],
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
        && e.target.closest('#tab-options, #tab-control')) autoSicherungPlanen();
  }, true);
  document.addEventListener('input', (e) => {
    if (e.target && e.target.closest
        && e.target.closest('#tab-options, #tab-control')) autoSicherungPlanen();
  }, true);
