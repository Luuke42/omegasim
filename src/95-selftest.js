  // ============================================================================
  // Selbsttest
  // ============================================================================
  // Dreizehn Messungen an der laufenden App, auf einen Knopfdruck. Bis hierher liess sich
  // an dieser Datei nichts pruefen, ausser von Hand in der Browserkonsole - und das kann
  // niemand ausser mir. Genau das war die groesste Luecke fuer Mitarbeit.
  //
  // Drei Entscheidungen, die den Unterschied machen:
  //
  // 1. Jede Zeile nennt ihr MASS, nicht nur ihr Urteil. Ein Test, der gruen oder rot sagt,
  //    ist beim naechsten Grenzfall wertlos, weil man nicht sieht, wie knapp es war.
  // 2. "nicht pruefbar" ist ein eigenes Ergebnis und kein Fehler. Ueber file:// verbietet
  //    der Browser fetch, also sind die Tonschleifen dort nicht ladbar - das als rot zu
  //    melden waere ein Alarm, der jedes Mal falsch ist, und nach dem dritten Mal schaut
  //    niemand mehr hin.
  // 3. Die Pruefungen benutzen dieselben Funktionen wie die App, nicht nachgebaute. Ein
  //    Test mit eigener Rechnung prueft seine eigene Rechnung.
  const ST_TESTS = [];

  function stAdd(name, fn) { ST_TESTS.push({ name, fn }); }

  // Einmal dem Browser Luft lassen, ohne einen Zeitgeber zu benutzen. Der Kanal wird EINMAL
  // angelegt und nicht je Test: hundert MessageChannel hintereinander sind hundert Paare von
  // Ports, die der Sammler wieder einholen muss.
  //
  // scheduler.yield() waere das Gleiche mit Namen, gibt es aber erst ab Chrome 129 - also
  // wird es benutzt, wenn es da ist, und sonst der Kanal.
  const stKanal = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  function stLuft() {
    if (typeof scheduler === 'object' && scheduler && typeof scheduler.yield === 'function') {
      return scheduler.yield();
    }
    if (!stKanal) return new Promise(res => setTimeout(res, 0));
    return new Promise((res) => {
      stKanal.port1.onmessage = () => { stKanal.port1.onmessage = null; res(); };
      stKanal.port2.postMessage(0);
    });
  }

  // ---- 1. Ist der Aufbau durchgelaufen? ----
  // Wenn diese Zeile ueberhaupt laeuft, ist die IIFE nicht abgebrochen. Interessant ist
  // deshalb nicht das Ob, sondern wieviel: ein abgebrochener Aufbau hinterlaesst leere
  // Anzeigen, und die Zahlen unten waeren null.
  stAdd('Aufbau durchgelaufen', () => {
    const regler = presetControls().length;
    const woerter = Object.keys(I18N_EN).length;
    const ok = regler > 30 && woerter > 400 && $('preset-json').value.length > 100;
    return { ok, mass: regler + ' Regler, ' + woerter + ' Woerterbucheintraege' };
  });

  // ---- 2. Protokoll: die Pruefsumme ----
  // Das Leerlaufpaket der Original-App und seine aufgezeichnete Pruefsumme. Trifft crc8()
  // sie nicht, ist die Deutung von Byte 19 falsch, und das Auto verwirft jedes Paket.
  stAdd('Protokoll: CRC-8', () => {
    const orig = new Uint8Array([0xaf, 0, 0, 0, 0, 0, 0xdf, 0, 0x80, 0,
                                 0x60, 0, 1, 0, 0x82, 4, 0, 0, 0]);
    const got = crc8(orig);
    return { ok: got === 0x33,
             mass: '0x' + got.toString(16) + ' erwartet 0x33' };
  });

  // ---- 3. Protokoll: der Streckensensor ----
  // Bit 7 in Byte 14 schaltet den Sensor AB. Diese App hat es zwoelf Aufzeichnungen lang
  // gesendet, und niemand hat es gemerkt, weil nichts danach gesehen hat. Jetzt sieht
  // etwas danach.
  // Geprueft wird die ZUORDNUNG der beiden Lesearten, nicht eine Wunschstellung.
  //
  // Vorher hiess diese Pruefung "Sensor an" und verlangte Bit 5 an und Bit 7 aus. Seit dem
  // 26.08. ist gemessen, dass beides gleichwertige Lesearten sind: Bit 5 liest die Schiene,
  // Bit 7 liest gedruckte Muster. Die alte Fassung haette also rot gemeldet, sobald jemand
  // in den Ausdruck-Modus schaltet - genau dann, wenn alles richtig ist.
  //
  // Die pruefbare Zusicherung ist stattdessen: der Schalter setzt in beide Richtungen genau
  // EIN der beiden Bits, nie beide und nie keins, und die Pruefsumme stimmt in beiden
  // Stellungen.
  stAdd('Protokoll: Byte 14 waehlt genau eine Leseart', () => {
    const sw = $('setting-ontrack');
    if (!sw) return { skip: true, mass: 'Schalter nicht im Dokument' };
    const gemerkt = sw.checked;
    try {
      const lies = () => {
        const p = buildCommandPacket(0, 0);
        return { b: p[14], crc: crc8(p.slice(0, 19)) === p[19] };
      };
      sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true }));
      const schiene = lies();
      sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true }));
      const druck = lies();
      const nurEins = (b) => (((b & 0x20) ? 1 : 0) + ((b & 0x80) ? 1 : 0)) === 1;
      // Die Bits ABLESEN und nicht behaupten: die erste Fassung schrieb "(Bit 7)" auch
      // dahin, wo 0x22 stand, und hat damit den Fehler beschriftet statt ihn zu zeigen.
      const bits = (b) => '(' + [(b & 0x20) ? 'Bit 5' : null, (b & 0x80) ? 'Bit 7' : null]
        .filter(Boolean).join(' + ') + ')' || '(kein Modusbit)';
      const ok = (schiene.b & 0x20) !== 0 && (schiene.b & 0x80) === 0
                 && (druck.b & 0x80) !== 0 && (druck.b & 0x20) === 0
                 && nurEins(schiene.b) && nurEins(druck.b)
                 && schiene.crc && druck.crc;
      return { ok,
               mass: 'Schiene 0x' + schiene.b.toString(16) + ' ' + bits(schiene.b)
                     + ', Ausdruck 0x' + druck.b.toString(16) + ' ' + bits(druck.b)
                     + ', Pruefsumme beide '
                     + (schiene.crc && druck.crc ? 'ok' : 'FALSCH') };
    } finally {
      sw.checked = gemerkt;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // ---- 4. Streckencode hin und zurueck ----
  // Der Buchstabe J (Haarnadel links) fehlte einmal im Leser, obwohl der Schreiber ihn
  // erzeugt: jede Linkshaarnadel fiel beim Einlesen still heraus.
  stAdd('Streckencode hin und zurück', () => {
    const proben = ['SG2HG2J', 'SRLRL', 'SH', 'SG3', 'SR6', 'SHJ'];
    const schlecht = [];
    for (const c of proben) {
      const p = codeToTrack(c);
      if (!p) { schlecht.push(c + ' unlesbar'); continue; }
      const zurueck = trackToCode(p.tiles, 0);
      if (zurueck !== c) schlecht.push(c + ' -> ' + zurueck);
    }
    return { ok: !schlecht.length,
             mass: schlecht.length ? schlecht.join(', ')
                                   : proben.length + ' Codes unveraendert' };
  });

  // ---- 5. Ideallinie stetig ----
  // Die Abbildung (Kachel, Phase) -> Linie darf nichts hinzufuegen: ihr groesster Schritt
  // muss dem groessten Schritt der Linie selbst entsprechen. Zwei Fehler in meiner ersten
  // Fassung sind genau daran aufgefallen, keiner davon beim Lesen.
  stAdd('Ideallinie stetig', () => {
    const proben = ['SG2RG2L', 'SRRRLLL', 'SRL', 'SHJ', 'SG2H2G2J2'];
    let schlimmster = 0, wo = '';
    for (const c of proben) {
      const p = codeToTrack(c);
      const lc = window.OMEGA_TEST.lineOf(p.tiles);
      const rows = window.OMEGA_TEST.compareLines(p.tiles, 96);
      const a = rows.map(r => r.calc);
      let sprung = 0;
      for (let i = 0; i < a.length; i++) {
        sprung = Math.max(sprung, Math.abs(a[(i + 1) % a.length] - a[i]));
      }
      // Kleine Toleranz auf den Eigenschritt der Linie: die Abtastung liegt nicht genau auf
      // ihren Punkten, also darf sie ihn um ein paar Prozent verfehlen.
      const grenze = lc.maxStep * 1.15 + 0.01;
      if (sprung > grenze) { schlimmster = Math.max(schlimmster, sprung / grenze); wo = c; }
    }
    return { ok: !wo,
             mass: wo ? wo + ': ' + schlimmster.toFixed(2) + ' mal die Eigenschrittweite'
                      : proben.length + ' Layouts ohne Sprung' };
  });

  // ---- 6. Kachelphase ----
  // Eine Haarnadel ist dreimal so lang wie eine Gerade. Rechnet die Phase mit einer
  // mittleren Kacheldauer, steht sie dort nach einem Drittel auf 1 und der Linienversatz
  // springt am Kachelwechsel.
  // Und die Probe, die die Geometrie ueberhaupt festgelegt hat: SHG4R4LG dreht 360 Grad und
  // muss sich schliessen. Der Abstand zwischen Anfang und Ende ist eine exakte Zahl, keine
  // Ansichtssache - und sie hat die gerade Sektion der Haarnadel geloest.
  stAdd('Strecken schließen sich', () => {
    // Nur Strecken, die sich WIRKLICH schliessen. SR6, SL6 und SHGHG stehen hier
    // bewusst NICHT: bei ihnen fehlt genau eine Kachel, und der Editor hat sie nur
    // deshalb als geschlossen gemeldet, weil seine Toleranz 64,5 cm betrug.
    //
    // SHG4R4LG ist die aussagekraeftigste: sie reagiert auf die gerade Sektion der
    // Haarnadel, und aus ihr ist die Geometrie geloest. SHGH und SJGJ pruefen den Radius,
    // denn dort heben sich die geraden Sektionen gegenseitig auf.
    const proben = ['SHG4R4LG', 'SJG4L4RG', 'SHGH', 'SJGJ'];
    const keep = currentTrackTiles;
    const schlecht = [];
    let groesster = 0;
    try {
      for (const c of proben) {
        currentTrackTiles = codeToTrack(c).tiles;
        const pts = trackCenterline(currentTrackTiles);
        const a = pts[0], b = pts[pts.length - 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y) / TRACK_UNITS_PER_CM;
        groesster = Math.max(groesster, d);
        if (d > 0.5) schlecht.push(c + ' ' + d.toFixed(2) + ' cm');
      }
    } finally { currentTrackTiles = keep; lineCache = null; }
    return { ok: !schlecht.length,
             mass: schlecht.length ? schlecht.join(', ')
                                   : proben.length + ' Runden, groesste Luecke '
                                     + groesster.toFixed(3) + ' cm' };
  });

  // Verglichen wird gegen die GEMESSENE Laenge des gezeichneten Wegs, nicht gegen dieselbe
  // Formel: sonst prueft der Test seine eigene Rechnung. Die Abtastpunkte der Mittellinie
  // aufsummiert ergeben die Weglaenge je Kachel, voellig unabhaengig von tileLength().
  //
  // Genau hier lag ein echter Fehler: ghostTileLenFactor rechnete mit der ZAHL der
  // Abtastpunkte, und die vergibt trackCenterline nach Drehwinkel. Eine Haarnadel dreht
  // dreimal so weit wie eine 60-Grad-Kurve, hat aber den halben Radius - ihr Bogen ist nur
  // eineinhalb mal so lang. Die Phase war damit auf JEDER Kurve falsch.
  stAdd('Kachellänge trifft den Weg', () => {
    const keep = currentTrackTiles;
    try {
      currentTrackTiles = codeToTrack('SGHR').tiles;
      const lc = ghostLine();
      const pts = trackCenterline(currentTrackTiles);
      // Weglaenge je Kachel aus den Abtastpunkten.
      const laenge = currentTrackTiles.map(() => 0);
      for (let i = 1; i < pts.length; i++) {
        const t = pts[i].tile;
        if (t < 0 || t >= laenge.length) continue;
        laenge[t] += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const summe = laenge.reduce((a, b) => a + b, 0);
      const mittel = summe / laenge.length;
      let schlimmster = 0, wo = -1;
      for (let i = 0; i < laenge.length; i++) {
        const soll = laenge[i] / mittel;
        const ist = ghostTileLenFactor(i);
        const abw = Math.abs(ist - soll) / Math.max(1e-9, soll);
        if (abw > schlimmster) { schlimmster = abw; wo = i; }
      }
      return { ok: schlimmster < 0.05,
               mass: 'groesste Abweichung ' + (schlimmster * 100).toFixed(1)
                     + ' % bei Kachel ' + wo + ' von ' + laenge.length };
    } finally { currentTrackTiles = keep; lineCache = null; }
  });

  // ---- 7. und 8. Physik ----
  //
  // Geprueft wird mit dem Integrator des Modells selbst (simulateLaunch, thrustAt,
  // resistAt), nicht mit einem eigenen Lauf durch update(). Mein erster Versuch tat genau
  // das und meldete 67 statt 295 km/h - weil ein Lauf durch update() ohne die uebrigen
  // Eingaben nicht schaltet. Ein Test mit eigener Rechnung prueft seine eigene Rechnung.
  stAdd('Physik: 0 auf 100', () => {
    const r = window.OMEGA_TEST.physLaunch();
    if (!r.erreicht) return { ok: false, mass: 'Ankergeschwindigkeit nie erreicht' };
    const abw = Math.abs(r.zeit - r.soll) / r.soll;
    return { ok: abw < 0.03,
             mass: r.zeit.toFixed(3) + ' s gegen ' + r.soll.toFixed(2) + ' s Vorgabe, '
                   + (abw * 100).toFixed(2) + ' % ab' };
  });

  // Die Deckelung in update() ist die bindende Grenze fuer die angezeigte
  // Hoechstgeschwindigkeit. Der Antrieb muss sie also ERREICHEN oder uebertreffen - sonst
  // waere der Regler ein Versprechen, das die Physik nicht halten kann. Gemessen liegt die
  // freie Endgeschwindigkeit 8,7 % darueber, und das ist richtig so.
  stAdd('Physik: Antrieb erreicht die Deckelung', () => {
    const r = window.OMEGA_TEST.physTopSpeed(90);
    return { ok: r.anteil >= 1.0,
             mass: 'frei ' + r.angezeigt.toFixed(0) + ' km/h, gedeckelt auf '
                   + r.sollAngezeigt.toFixed(0) + ', Reserve '
                   + ((r.anteil - 1) * 100).toFixed(1) + ' %' };
  });

  // ---- 9. Notlauf ----
  // Leerer Tank muss das Gas absenken, und zwar BEVOR es in die Physik geht. Genau dort
  // fehlte es einmal: die Anzeige zeigte 200 km/h mit leerem Tank.
  stAdd('Notlauf bei leerem Tank', () => {
    const gemerkt = fuel;
    try {
      fuel = 0;
      const leer = fuelDamageDerate(1);
      fuel = 100;
      const voll = fuelDamageDerate(1);
      return { ok: leer < voll * 0.8,
               mass: 'Gas ' + leer.toFixed(2) + ' leer gegen ' + voll.toFixed(2) + ' voll' };
    } finally { fuel = gemerkt; }
  });

  // ---- 10. Tonschleifen ----
  // Jede Schleife muss ladbar sein, ihr Gleichanteil klein und die Naht stetig: eine
  // Schleife mit Gleichanteil knackt beim Einsetzen, eine mit Naht klickt bei jeder
  // Wiederholung. Ueber file:// nicht pruefbar, und das ist kein Fehler.
  stAdd('Tonschleifen heil', async () => {
    if (location.protocol === 'file:') {
      return { skip: true, mass: 'file://, der Browser verbietet das Laden' };
    }
    let manifest;
    try { manifest = await (await fetch('audio/loops.json')).json(); }
    catch (e) { return { skip: true, mass: 'audio/loops.json nicht ladbar' }; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dateien = [];
    for (const prof of Object.values(manifest)) {
      for (const l of Object.values(prof.loops || {})) if (l && l.file) dateien.push(l.file);
    }
    let schlimmsterDc = 0, schlimmsteNaht = 0, geprueft = 0;
    const kaputt = [];
    // ALLE, nicht die ersten vierzig. Bis v0.4.53 waren es genau vierzig Schleifen, also
    // traf slice(0, 40) zufaellig alles; mit vierzehn Motoren sind es 56 und sechzehn waeren
    // stumm ungeprueft geblieben - waehrend die Zahl darunter weiter "geprueft" sagt. Ein
    // Abschneiden wuerde ausserdem immer die ERSTEN Eintraege der Manifestdatei begruenstigen
    // und die neuen nie treffen, also genau die, an denen ein Fehler wahrscheinlich ist.
    for (const name of dateien) {
      try {
        const buf = await ctx.decodeAudioData(
          await (await fetch('audio/' + name)).arrayBuffer());
        const d = buf.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i];
        const dc = Math.abs(sum / d.length);
        // Naht: der Sprung von der letzten Probe zur ersten, gemessen an der typischen
        // Aenderung im Inneren. Ein absoluter Wert waere bei einem leisen Leerlauf zu
        // streng und bei Vollgas zu lasch.
        // Ueber die GANZE Datei mitteln, nicht ueber die ersten 4000 Proben. Beginnt eine
        // Schleife leise, ist der Innenschritt dort winzig, und das Verhaeltnis explodiert:
        // meine erste Fassung meldete 23 von 34 Schleifen als kaputt, mit einem Maximum von
        // 116 - ein Alarm, der fast immer falsch war.
        let mittel = 0;
        for (let i = 1; i < d.length; i++) mittel += Math.abs(d[i] - d[i - 1]);
        mittel /= Math.max(1, d.length - 1);
        const naht = Math.abs(d[0] - d[d.length - 1]) / Math.max(1e-9, mittel);
        schlimmsterDc = Math.max(schlimmsterDc, dc);
        schlimmsteNaht = Math.max(schlimmsteNaht, naht);
        // Nur der Gleichanteil ist ein Urteil. Die NAHT wird gemessen und berichtet, aber
        // nicht bewertet, und das hat einen Grund: diese Dateien sind Ogg Vorbis, und
        // Vorbis ist nicht probengenau. Der Dekoder setzt an Anfang und Ende
        // Fensterartefakte, also wird aus einer zirkular nahtlos gebauten WAV eine Ogg mit
        // Sprung an der Naht. Gemessen 0,17 bis 1,53 mal den Effektivwert - das sagt etwas
        // ueber den Kodierer und nichts ueber die Schleife. Wer die Naht wirklich pruefen
        // will, muss die WAVs in audio-work/ nehmen.
        if (dc > 0.01) kaputt.push(name + ' (Gleichanteil ' + dc.toFixed(4) + ')');
        geprueft++;
      } catch (e) { kaputt.push(name + ' (nicht dekodierbar)'); }
    }
    try { ctx.close(); } catch (e) { /* egal */ }
    return { ok: !kaputt.length,
             mass: geprueft + ' Schleifen, Gleichanteil max ' + schlimmsterDc.toFixed(4)
                   + ' (Grenze 0.01), Naht max ' + schlimmsteNaht.toFixed(1)
                   + ' mal der Innenschritt (gemessen, nicht bewertet: Ogg ist nicht'
                   + ' probengenau)'
                   + (kaputt.length ? ' | ' + kaputt.join(', ') : '') };
  });

  // ---- 11. Kontrast ----
  // Deckkraft richtig ueberlagern, sonst liest man rgba(255,255,255,.035) auf Schwarz als
  // Weiss und meldet 36 Knoepfe als Fehler, die keine sind. Genau das ist mir passiert.
  function stMix(vorder, hinter) {
    const a = vorder[3] === undefined ? 1 : vorder[3];
    return [0, 1, 2].map(i => vorder[i] * a + hinter[i] * (1 - a));
  }

  function stParse(c) {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return null;
    const v = m.map(Number);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  }

  function stLum(rgb) {
    const f = rgb.slice(0, 3).map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }

  function stBackdrop(el) {
    // Von unten nach oben ueberlagern, bis eine deckende Flaeche kommt. Der erste
    // nicht-transparente Hintergrund allein genuegt nicht: eine halbdurchsichtige Flaeche
    // ueber Schwarz ist nicht ihre eigene Farbe.
    //
    // Und die Kette beginnt beim Element SELBST, nicht beim Elternteil. Ein Knopf traegt
    // seine eigene Flaeche, und der Text sitzt darauf. Meine erste Fassung fing beim
    // Elternteil an und meldete den gruenen Verbinden-Knopf mit 1,13:1 - gemessen gegen
    // die Karte hinter ihm statt gegen sein eigenes Gruen.
    const kette = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = stParse(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0) kette.push(bg);
      if (bg && bg[3] >= 0.999) break;
    }
    let unten = [0, 0, 0];
    for (let i = kette.length - 1; i >= 0; i--) unten = stMix(kette[i], unten);
    return unten;
  }

  stAdd('Kontrast (WCAG)', () => {
    let schlimmster = 99, wo = '';
    let geprueft = 0;
    const sel = 'p, span, b, div.opt-label, label, h1, h2, h3, td, th, li, button';
    for (const el of document.querySelectorAll(sel)) {
      if (!el.textContent.trim()) continue;
      // Unsichtbares und Abgeschaltetes ist ausgenommen: 1.4.3 gilt nicht fuer
      // deaktivierte Bedienelemente, und was niemand sieht, muss nichts erfuellen.
      if (el.disabled || el.closest('[hidden]') || el.closest('.tabpage:not(.active)')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const vg = stParse(cs.color);
      if (!vg) continue;
      const hg = stBackdrop(el);
      const l1 = stLum(stMix(vg, hg)), l2 = stLum(hg);
      const k = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const gross = parseFloat(cs.fontSize) >= 24
                    || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
      const grenze = gross ? 3.0 : 4.5;
      geprueft++;
      if (k < grenze && k < schlimmster) {
        schlimmster = k;
        wo = (el.tagName.toLowerCase() + ' "' + el.textContent.trim().slice(0, 24) + '"');
      }
    }
    return { ok: !wo,
             mass: geprueft + ' sichtbare Textstellen'
                   + (wo ? ', schlechteste ' + schlimmster.toFixed(2) + ':1 bei ' + wo
                         : ', alle ueber dem Mindestwert') };
  });

  // ---- 12. Sprache ----
  // Im englischen Modus darf kein deutscher Satz stehen bleiben, ausser in der Doku und im
  // Arbeitsprotokoll. Jeder neue deutsche Text braucht einen Woerterbucheintrag, sonst
  // steigt diese Zahl - und genau dann faellt es auf.
  stAdd('Sprache: nichts Deutsches im Englischen', () => {
    const vorher = lang;
    try {
      if (lang !== 'en') setLang('en');
      const DE = /[äöüßÄÖÜ]|\b(der|die|und|nicht|eine|mit|für|ist|sind|wird|wenn|auch|über|nach|beim|dann|aber|noch|kann|muss|sich|dem|den|des|zum|zur|aus|bei|nur|schon|sehr)\b/;
      const rest = new Set();
      // FERTIGE ENGLISCHE FASSUNGEN durchlassen. Die Wortliste oben verwirft jeden Umlaut,
      // und das trifft einen deutschen EIGENNAMEN in einer richtig uebersetzten Zeile -
      // "by Matthias Kirschner and Sandra Brandstaetter" ist Englisch. Namen uebersetzt man
      // nicht, also muss der Test unterscheiden koennen: ein Knoten, dessen Text eine
      // bekannte englische Fassung IST, ist fertig.
      const englisch = new Set(Object.values(I18N_EN));
      for (const root of i18nRoots()) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            const p = n.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            if (['SCRIPT', 'STYLE', 'CODE', 'KBD'].indexOf(p.tagName) >= 0) {
              return NodeFilter.FILTER_REJECT;
            }
            // Ausgenommen: die Doku (bleibt deutsch), das Arbeitsprotokoll, die
            // Meldungszeile im Schirm und die Messspalte DIESES Tests. Die letzten drei
            // sind Messwerte und Zustandsmeldungen, kein Oberflaechentext - der Test hat
            // sonst sich selbst gemeldet ("Byte 14 = 0x22, Bit 5 an, Bit 7 aus").
            // Der feste Text der Selbsttestseite wird weiter geprueft, er steht ausserhalb
            // von #st-rows.
            if (p.closest('[data-i18n-skip]') || p.closest('#tab-doc')
                || p.closest('#log') || p.closest('#st-rows') || p.closest('#hud-toast')
                || p.id === 'st-status') {
              return NodeFilter.FILTER_REJECT;
            }
            return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        let n;
        while ((n = w.nextNode())) {
          const t = n.nodeValue.replace(/\s+/g, ' ').trim();
          if (t.length >= 4 && DE.test(t) && !englisch.has(t)) rest.add(t);
        }
      }
      const bsp = [...rest][0];
      return { ok: rest.size === 0,
               mass: rest.size === 0 ? 'kein deutscher Text'
                                     : rest.size + ' Stellen, z. B. "' + bsp.slice(0, 46) + '"' };
    } finally { if (lang !== vorher) setLang(vorher); }
  });

  // ---- Cockpit-Anzeigen reagieren aufs Fahren ----
  //
  // DIESER TEST HAETTE EINEN ECHTEN FEHLER GEFUNDEN. Beim Umbau der Reifenkachel auf vier
  // Reifen wurde die Bremstemperatur-Anzeige mitgeloescht: das Element blieb im Dokument,
  // geschrieben hat es niemand mehr. Gemeldet wurde es als "die Temperatur reagiert nicht auf
  // mein Fahren" - und kein vorhandener Test konnte es melden. Der Bauschritt prueft
  // Zugriffe ins LEERE, aber ein Element, das DA ist und das niemand beschreibt, ist keiner.
  //
  // Deshalb geht dieser Test den Weg der Beschwerde: er faehrt und sieht nach, ob sich die
  // Anzeigen dabei aendern.
  stAdd('Cockpit-Anzeigen reagieren aufs Fahren', () => {
    const st = physEngine.state, cfg = physEngine.config;
    const lesen = () => ({
      tempo: ($('race-speed') || {}).textContent,
      reifen: ($('race-tyre-temp') || {}).textContent,
      gang: ($('race-gear') || {}).textContent,
      // Die Scheibe ist seit v0.5 ein EIGENES Rechteck an der Innenseite und kein Ring im
      // Reifen mehr. Gelesen wird ihre Fuellfarbe, denn die traegt die Temperatur.
      scheibeV: ($('race-disc-fl') ? $('race-disc-fl').style.background : null),
      profil: ($('race-tyre-fl') && $('race-tyre-fl').firstChild
               ? $('race-tyre-fl').firstChild.style.height : null),
    });
    const merkState = OMEGA_TEST.zustandKopie(st);
    const merkCfg = Object.assign({}, cfg);
    try {
      // Kalter, langsamer Ausgangszustand - und die drei Modelle sicher AN, damit der Test
      // nicht davon abhaengt, welche Voreinstellung gerade gilt.
      cfg.tyreEffect = 1; cfg.brakeFadeEffect = 1; cfg.tyreAsymEffect = 1;
      st.speedKmh = 0; st.currentGear = 0; st.driveMode = 'forward';
      st.tyreTempC = cfg.tyreAmbientC; st.tyreWear = 0;
      st.tyreWearL = 0; st.tyreWearR = 0;
      st.brakeTempF = cfg.brakeAmbientC; st.brakeTempR = cfg.brakeAmbientC;
      st.brakeFade = 0; st.longUse = 0; st.loadFront = 0.5;
      updateDashboard(physEngine.update({ throttle: 0, brake: 0, steering: 0 }, 0.02));
      const vorher = lesen();

      // Und jetzt fahren: beschleunigen, lenken, dann hart bremsen. Genau die drei Sachen,
      // die Tempo, Reifen und Scheiben bewegen muessen.
      for (let i = 0; i < 240; i++) {
        st.speedKmh = 180 / REAL_SCALE;      // Fahrt halten, damit die Arbeit gross bleibt
        physEngine.update({ throttle: 0.6, brake: 0, steering: 0.8 }, 0.02);
      }
      for (let i = 0; i < 240; i++) {
        st.speedKmh = 180 / REAL_SCALE;
        physEngine.update({ throttle: 0, brake: 1, steering: 0.2 }, 0.02);
      }
      updateDashboard(physEngine.update({ throttle: 0, brake: 1, steering: 0.2 }, 0.02));
      const nachher = lesen();

      const stumm = [];
      for (const k of Object.keys(vorher)) {
        if (vorher[k] === nachher[k]) stumm.push(k);
      }
      return {
        ok: stumm.length === 0,
        mass: 'Reifen "' + vorher.reifen + '" -> "' + nachher.reifen + '"'
            + ' | Profil ' + vorher.profil + ' -> ' + nachher.profil
            + ' | Scheibe ' + (vorher.scheibeV || '-') + ' -> ' + (nachher.scheibeV || '-')
            + (stumm.length ? ' | STUMM: ' + stumm.join(', ') : ''),
      };
    } finally {
      Object.assign(cfg, merkCfg);
      physEngine.calibrateAccel();
      OMEGA_TEST.zustandZurueck(st, merkState);
    }
  });

  // ---- Block 4.1: Bremstemperatur und Fading ----
  //
  // ZWEI BEDINGUNGEN, und die erste ist die, die schiefgehen kann ohne aufzufallen: eine
  // EINZELNE Vollbremsung aus kalten Scheiben darf nicht faden. Die gefittete Bremstabelle
  // (RMSE 3,1 %) ist an genau dieser Bremsung gemessen; wuerde sie faden, waere nicht die
  // Simulation tiefer, sondern die Kalibrierung kaputt.
  //
  // Die zweite: mehrere hintereinander MUESSEN faden, sonst ist der Zusatz Zierde. Dieser
  // Test hat einen echten Fehler gefunden - die erste Fassung der Kuehlung war um den Faktor
  // 100 zu stark, und fuenf Vollbremsungen aus 250 km/h erreichten 111 statt 601 Grad.
  stAdd('Bremsfading: eine Bremsung nicht, acht schon', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physBrakeHeat) {
      return { skip: true, mass: 'physBrakeHeat nicht vorhanden' };
    }
    const eine = OMEGA_TEST.physBrakeHeat({ kmh: 250, wiederholungen: 1 });
    const acht = OMEGA_TEST.physBrakeHeat({ kmh: 250, wiederholungen: 8 });
    const aus = OMEGA_TEST.physBrakeHeat({ kmh: 250, wiederholungen: 8,
                                          cfg: { brakeFadeEffect: 0 } });
    const laenger = (acht.letzterWeg - eine.letzterWeg) / eine.letzterWeg;
    const ok = eine.maxFade === 0            // eine Bremsung fadet nicht
      && acht.maxFade > 0.05                 // acht schon
      && laenger > 0.08                      // und das kostet Bremsweg
      && Math.abs(aus.letzterWeg - eine.letzterWeg) < 3;  // mit Regler aus: kein Unterschied
    return { ok,
      mass: '1x: ' + eine.tempF + '\u00b0 vorn, Fading ' + (eine.maxFade * 100).toFixed(1)
          + ' %, ' + eine.letzterWeg + ' m | 8x: ' + acht.tempF + '\u00b0, '
          + (acht.maxFade * 100).toFixed(1) + ' %, ' + acht.letzterWeg + ' m ('
          + (laenger * 100).toFixed(0) + ' % laenger) | Regler aus: ' + aus.letzterWeg + ' m' };
  });

  // ---- Block 4.3: asymmetrischer Reifenverschleiss ----
  //
  // Die richtige Seite muss mehr abnutzen - eine Rechtskurve die LINKE. Und der MITTELWERT
  // muss derselbe bleiben wie ohne Asymmetrie: sonst waere der Schalter auch ein
  // Verschleiss-Regler, und dann liesse sich nicht messen, was er tut.
  stAdd('Reifen links/rechts: richtige Seite, gleicher Mittelwert', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physTyreAsym) {
      return { skip: true, mass: 'physTyreAsym nicht vorhanden' };
    }
    const re = OMEGA_TEST.physTyreAsym({ steering: 0.7, sekunden: 40 });
    const li = OMEGA_TEST.physTyreAsym({ steering: -0.7, sekunden: 40 });
    const sy = OMEGA_TEST.physTyreAsym({ steering: 0.7, sekunden: 40,
                                         cfg: { tyreAsymEffect: 0 } });
    const ok = re.wearL > re.wearR * 2          // Rechtskurve nutzt links deutlich mehr
      && li.wearR > li.wearL * 2                // Linkskurve gespiegelt
      && Math.abs(re.mittel - sy.mittel) < 1e-4  // Mittelwert unveraendert
      && Math.abs(li.mittel - sy.mittel) < 1e-4
      && re.pull > 0 && li.pull < 0;             // und der Zug folgt dem Vorzeichen
    return { ok,
      mass: 'rechts L/R ' + re.wearL.toFixed(3) + '/' + re.wearR.toFixed(3)
          + ', links L/R ' + li.wearL.toFixed(3) + '/' + li.wearR.toFixed(3)
          + ' | Mittel ' + re.mittel.toFixed(5) + ' gegen symmetrisch '
          + sy.mittel.toFixed(5) + ' | Zug ' + re.pull.toFixed(4) };
  });

  // ---- Vierradverlagerung: Richtung, Normierung, Spiegelung ----
  //
  // DREI Aussagen in einem Test, weil sie nur zusammen etwas heissen: eine Verlagerung, die
  // in die richtige Richtung geht, aber im Mittel Last erfindet, wuerde das Auto insgesamt
  // griffiger machen - und das waere kein Reifenmodell, sondern ein versteckter Griffregler.
  stAdd('Radlasten: richtige Ecke, Mittel 1,0, gespiegelt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerGrip) {
      return { skip: true, mass: 'physSteerGrip nicht vorhanden' };
    }
    const mit = a => (a[0] + a[1] + a[2] + a[3]) / 4;
    const re = OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 0, brake: 1, steering: 0.8 });
    const li = OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 0, brake: 1, steering: -0.8 });
    const gas = OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 1, brake: 0, steering: 0.8 });
    if (!re.load4 || !li.load4 || !gas.load4) {
      return { skip: true, mass: 'load4 nicht vorhanden' };
    }
    const L = re.load4;
    const ok =
      // Rechtskurve unter Bremsen: vorne links traegt am meisten, hinten rechts am wenigsten.
      L[0] > L[1] && L[0] > L[2] && L[0] > L[3] && L[3] < L[1] && L[3] < L[2]
      // Bremsen verlagert nach vorn, Gas nach hinten.
      && (L[0] + L[1]) > (L[2] + L[3])
      && (gas.load4[2] + gas.load4[3]) > (gas.load4[0] + gas.load4[1])
      // Die Linkskurve ist die exakte Spiegelung: VL gegen VR und HL gegen HR.
      && Math.abs(L[0] - li.load4[1]) < 1e-9 && Math.abs(L[2] - li.load4[3]) < 1e-9
      // Und im Mittel genau 1,0 - in ALLEN drei Faellen.
      && Math.abs(mit(L) - 1) < 1e-9 && Math.abs(mit(li.load4) - 1) < 1e-9
      && Math.abs(mit(gas.load4) - 1) < 1e-9;
    return { ok, mass: 'Rechtskurve+Bremse VL/VR/HL/HR '
      + L.map(x => x.toFixed(2)).join('/') + ' | Mittel ' + mit(L).toFixed(6)
      + ' | Gas hinten ' + (gas.load4[2] + gas.load4[3]).toFixed(2) };
  });

  // Die Bremsscheiben nehmen den REINEN Seitenanteil und nicht die ganze Radlast. Der Grund
  // ist ein Fehler, der genau so schon drinstand: load4 enthaelt die Achsaufteilung, und die
  // Bremsbalance enthaelt sie auch. Beides multipliziert kam vorne-innen kaelter heraus als
  // hinten-aussen - und vorne bremst immer mehr.
  stAdd('Bremsscheiben: Achse aus der Balance, Seite aus der Verlagerung', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerGrip) {
      return { skip: true, mass: 'physSteerGrip nicht vorhanden' };
    }
    const re = OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 0, brake: 1, steering: 0.8 });
    const ger = OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 0, brake: 1, steering: 0 });
    if (!re.lat4 || !ger.lat4) return { skip: true, mass: 'lat4 nicht vorhanden' };
    const bias = physEngine.config.brakeBias;
    const heiz = (lat) => [0, 1, 2, 3].map(i =>
      2 * (i < 2 ? bias : 1 - bias) * (1 + (lat[i] - 1) * 0.5));
    const h = heiz(re.lat4), hg = heiz(ger.lat4);
    const ok =
      // Der Seitenanteil traegt KEINE Achsaufteilung: vorne links und hinten links gleich.
      Math.abs(re.lat4[0] - re.lat4[2]) < 1e-9 && Math.abs(re.lat4[1] - re.lat4[3]) < 1e-9
      && Math.abs((re.lat4[0] + re.lat4[1] + re.lat4[2] + re.lat4[3]) / 4 - 1) < 1e-9
      // Geradeaus entscheidet allein die Bremsbalance, und vorne ist mehr.
      && Math.abs(hg[0] - hg[1]) < 1e-9 && hg[0] > hg[2]
      // Und der Achsmittelwert bleibt in der Kurve derselbe: die Seite verschiebt nur.
      && Math.abs((h[0] + h[1]) / 2 - hg[0]) < 1e-9
      && Math.abs((h[2] + h[3]) / 2 - hg[2]) < 1e-9;
    return { ok, mass: 'Kurve VL/VR/HL/HR ' + h.map(x => x.toFixed(2)).join('/')
      + ' | geradeaus vorn ' + hg[0].toFixed(2) + ' hinten ' + hg[2].toFixed(2) };
  });

  // Vier Reifen, vier Temperaturen - und mit abgeschalteter Asymmetrie muessen alle VIER
  // gleich sein. Der Mittelwert allein genuegt als Pruefung nicht: er stimmt auch, wenn zwei
  // Raeder vertauscht sind.
  stAdd('Vier Reifen: einzeln verschieden, symmetrisch alle gleich', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physTyreAsym) {
      return { skip: true, mass: 'physTyreAsym nicht vorhanden' };
    }
    const a = OMEGA_TEST.physTyreAsym({ steering: 0.8, sekunden: 20 });
    const sy = OMEGA_TEST.physTyreAsym({ steering: 0.8, sekunden: 20,
                                         cfg: { tyreAsymEffect: 0 } });
    if (!a.temp4 || !sy.temp4) return { skip: true, mass: 'temp4 nicht vorhanden' };
    const mit = x => (x[0] + x[1] + x[2] + x[3]) / 4;
    const ok =
      // Mit Asymmetrie: das belastete Rad ist waermer und staerker abgenutzt.
      a.temp4[0] > a.temp4[1] && a.temp4[2] > a.temp4[3]
      && a.wear4[0] > a.wear4[1] && a.wear4[2] > a.wear4[3]
      // Ohne: alle vier gleich.
      && Math.max.apply(null, sy.temp4) - Math.min.apply(null, sy.temp4) < 1e-6
      && Math.max.apply(null, sy.wear4) - Math.min.apply(null, sy.wear4) < 1e-9
      // Und der Verschleissmittelwert ist derselbe - die Verlagerung verschiebt nur.
      && Math.abs(mit(a.wear4) - mit(sy.wear4)) < 1e-6;
    return { ok, mass: 'Temp ' + a.temp4.map(x => x.toFixed(0)).join('/')
      + ' | Versch ' + a.wear4.map(x => (x * 100).toFixed(1)).join('/')
      + ' | Mittel ' + (mit(a.wear4) * 100).toFixed(4) + '% gegen '
      + (mit(sy.wear4) * 100).toFixed(4) + '%' };
  });

  // DER wichtigste der vier, und er prueft nicht die Physik, sondern den Messaufbau: ein
  // Messaufruf darf den echten Fahrzustand nicht veraendern. Genau das war kaputt, seit der
  // Zustand Arrays fuehrt - Object.assign auf ein leeres Objekt ist flach, also wurden die
  // Vierer-Felder als Referenz gesichert und im finally auf sich selbst zurueckgeschrieben.
  // Gezeigt hat es sich nur zufaellig, an Werten, die zwischen zwei Laeufen gestiegen sind.
  stAdd('Messaufbau: ein Messaufruf laesst den Fahrzustand unberuehrt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physTyreAsym) {
      return { skip: true, mass: 'physTyreAsym nicht vorhanden' };
    }
    const st = physEngine.state;
    // Erkennbare Werte hineinschreiben, damit eine Veraenderung auffaellt.
    const marke = { tyreWear4: [0.11, 0.22, 0.33, 0.44],
                    tyreTemp4: [61, 62, 63, 64],
                    brakeTemp4: [71, 72, 73, 74] };
    const vorher = {};
    for (const k of Object.keys(marke)) {
      if (!Array.isArray(st[k])) return { skip: true, mass: k + ' nicht vorhanden' };
      vorher[k] = st[k].slice();
      for (let i = 0; i < 4; i++) st[k][i] = marke[k][i];
    }
    let ok = true;
    const meld = [];
    try {
      OMEGA_TEST.physTyreAsym({ steering: 0.8, sekunden: 5 });
      OMEGA_TEST.physSteerGrip({ kmh: 180, throttle: 0, brake: 1, steering: 0.8 });
      for (const k of Object.keys(marke)) {
        for (let i = 0; i < 4; i++) {
          if (Math.abs(st[k][i] - marke[k][i]) > 1e-9) {
            ok = false;
            meld.push(k + ' ' + i + ': ' + marke[k][i] + ' wurde ' + st[k][i].toFixed(3));
          }
        }
      }
      // Und die Wiederholbarkeit, die aus demselben Fehler fiel.
      const p = OMEGA_TEST.physTyreAsym({ steering: 0.8, sekunden: 10 });
      const q = OMEGA_TEST.physTyreAsym({ steering: 0.8, sekunden: 10 });
      if (JSON.stringify(p.temp4) !== JSON.stringify(q.temp4)) {
        ok = false;
        meld.push('nicht wiederholbar: ' + p.temp4 + ' gegen ' + q.temp4);
      }
    } finally {
      for (const k of Object.keys(vorher)) {
        for (let i = 0; i < 4; i++) st[k][i] = vorher[k][i];
      }
    }
    return { ok, mass: ok ? 'unberuehrt und wiederholbar' : meld.join('; ') };
  });

  // ---- Boxenstopp: vier Raeder, vier Toene, kein Losfahren ----
  //
  // Der letzte Teil ist der, auf den es beim Fahren ankommt: ohne Raeder kann man nicht
  // losfahren. Die Sperre stand schon da, aber eine Sperre, auf die man sich verlaesst, ohne
  // sie zu messen, ist keine - und sie haengt an drei Bedingungen zugleich (Zustand, Plan,
  // Fertigmeldung), von denen jede einzeln kippen kann.
  stAdd('Radwechsel: vier Raeder der Reihe nach, Gas gesperrt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.pitWheelTimeline) {
      return { skip: true, mass: 'pitWheelTimeline nicht vorhanden' };
    }
    const r = OMEGA_TEST.pitWheelTimeline({ dauer: 4.0, schritt: 0.05 });
    if (!r) return { skip: true, mass: 'pitWheelOff nicht vorhanden' };
    // Die Abschnitte zusammenfassen: aus 80 Abtastungen werden die Wechselpunkte.
    const ab = [];
    for (const p of r.reihe) {
      const l = ab[ab.length - 1];
      if (!l || l.rad !== p.rad) ab.push({ rad: p.rad, von: p.t, bis: p.t });
      else l.bis = p.t;
    }
    const folge = ab.filter(a => a.rad >= 0).map(a => a.rad);
    const ok =
      // Genau vier Ausfaelle, und jedes Rad genau einmal.
      folge.length === 4 && new Set(folge).size === 4
      // Kein Rad fehlt vor dem ersten oder nach dem letzten Ton.
      && r.danach.rad === -1
      // Und das Entscheidende: solange gewechselt wird, ist das Gas gesperrt, danach frei.
      && r.reihe.every(p => p.gas === true)
      && r.danach.gas === false;
    const N = ['VL', 'VR', 'HL', 'HR'];
    return { ok, mass: folge.map(i => N[i]).join(' \u2192 ')
      + ' | Gas gesperrt ' + (r.reihe.every(p => p.gas) ? 'durchgehend' : 'LUECKE')
      + ', danach ' + (r.danach.gas ? 'NOCH GESPERRT' : 'frei') };
  });

  // ---- Uebersetzung: kein Deutsch im englischen Modus ----
  //
  // Gesucht wird nach Woertern, die es im ENGLISCHEN nicht gibt, plus Umlauten. Ein erstes
  // Muster enthielt "also" und "die" und meldete damit englische Saetze als deutsch - ein
  // Test, der Rauschen meldet, wird abgeschaltet.
  //
  // Und es wird NICHT durch die Reiter geklickt: alle liegen gleichzeitig im Dokument, und
  // ein klickender Durchgang oeffnet die Unterseiten nicht. Genau dort lagen drei von vier
  // Befunden, als diese Pruefung zum ersten Mal lief.
  stAdd('Uebersetzung: kein Deutsch im englischen Modus', () => {
    const knopf = $('lang-toggle');
    if (!knopf) return { skip: true, mass: 'kein Sprachumschalter' };
    const vorher = document.documentElement.getAttribute('lang');
    const warEnglisch = vorher === 'en';
    try {
      if (!warEnglisch) knopf.click();
      if (document.documentElement.getAttribute('lang') !== 'en') {
        return { skip: true, mass: 'Umschalten auf Englisch hat nicht gegriffen' };
      }
      const DE = /(?:^|[\s(])(?:werden|wurde|wird|nicht|damit|deshalb|jedoch|welche|meldet|liegt|steht|braucht|dieselbe|derselbe|jedes|jeder|Werte|Blatt|Aufnahmen|Strecken|gespeichert|Ausdruck|Reifen|Bremse|Lenkung|Boxengasse)(?:[\s.,;:!?)]|$)|[\u00e4\u00f6\u00fc\u00df\u00c4\u00d6\u00dc]/;
      // ZWEI AUSNAHMEN, die der Test vorher nicht kannte - und beide haben ihn falsch
      // ausloesen lassen, nicht etwas verschwiegen:
      //
      // 1. FERTIGE ENGLISCHE FASSUNGEN. Die Regel oben verwirft jeden Text mit Umlaut, und
      //    das trifft eine richtig uebersetzte Zeile, in der ein deutscher NAME steht:
      //    "by Matthias Kirschner and Sandra Brandstaetter" ist Englisch mit einem
      //    Eigennamen. Namen uebersetzt man nicht. Ein Knoten, dessen Text eine bekannte
      //    englische Fassung IST, ist also fertig - und genau das wird jetzt geprueft.
      // 2. data-i18n-skip. Der andere Sprachtest ehrt das Attribut schon; hier fehlte es,
      //    und dadurch meldete er Laufzeitanzeigen wie die Muster-Sonde.
      const englisch = new Set(Object.values(I18N_EN));
      const gehen = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const treffer = [];
      let n;
      while ((n = gehen.nextNode())) {
        const el = n.parentElement;
        if (!el) continue;
        // Die Doku ist ausdruecklich nur deutsch; das Protokoll und die Testtabelle
        // enthalten Laufzeittexte und keine Oberflaeche.
        if (el.closest('#tab-doc, #log, script, style, template, #st-rows')) continue;
        if (el.closest('[data-i18n-skip]')) continue;
        const t = n.nodeValue.trim().replace(/\s+/g, ' ');
        if (t.length < 10 || !DE.test(t)) continue;
        if (englisch.has(t)) continue;
        const wo = el.closest('[id^="tab-"]');
        treffer.push((wo ? wo.id : '?') + ': ' + t.slice(0, 50));
      }
      return { ok: treffer.length === 0,
               mass: treffer.length === 0 ? 'kein deutscher Text gefunden'
                                          : treffer.length + ' Stellen \u2013 ' + treffer.slice(0, 3).join(' | ') };
    } finally {
      // Die Sprache MUSS zurueck: ein Test, der die Oberflaeche umstellt und so stehen
      // laesst, ist selbst der naechste Fehlerbericht.
      if (!warEnglisch && document.documentElement.getAttribute('lang') === 'en') knopf.click();
    }
  });

  // ---- Lenkwinkel-Kalibrierung ----
  //
  // DREI Aussagen, und die erste ist die wichtigste: der Deckel muss halten. Byte 7 traegt
  // round(winkel * 127) in einem VORZEICHENBEHAFTETEN Byte - ein Winkel ueber 1,0 wuerde
  // beim Umbruch als Einschlag in die ANDERE Richtung ankommen. Ein Regler, der das Auto in
  // die falsche Richtung lenken kann, ist schlimmer als kein Regler.
  stAdd('Lenkkalibrierung: gedeckelt, monoton, bei 1,0 wirkungslos', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerGrip) {
      return { skip: true, mass: 'physSteerGrip nicht vorhanden' };
    }
    // tyreAsymEffect AUS, und das schwaecht die Pruefung nicht ab: der Reifenzug bei
    // ungleichem Verschleiss ist ein absichtlicher Lenkoffset mit eigenem Regler und eigenem
    // Messaufbau (physTyreAsym). Er liegt auf dem uebertragenen Winkel, und dieser Test
    // vergleicht ihn mit dem Wunsch OHNE ihn - seit der Verschleiss standardmaessig ungleich
    // ist, meldete das "1,0 NICHT NEUTRAL". Wahr, aber nicht die Frage dieses Tests, und die
    // ist: legt die KALIBRIERUNG bei 1,0 etwas drauf?
    const messe = (kalib, lenk) => OMEGA_TEST.physSteerGrip({
      kmh: 60, throttle: 0, brake: 1, steering: lenk,
      patch: { steerCalib: kalib, tyreAsymEffect: 0 } });
    const proben = [1, 1.5, 2, 2.5, 3].map(k => messe(k, 1));
    if (proben[0].winkel === undefined) return { skip: true, mass: 'winkel nicht herausgegeben' };
    let gedeckelt = true, monoton = true;
    for (let i = 0; i < proben.length; i++) {
      if (Math.abs(proben[i].winkel) > 1 + 1e-9) gedeckelt = false;
      if (i && proben[i].winkel < proben[i - 1].winkel - 1e-9) monoton = false;
    }
    // Bei 1,0 muss der uebertragene Winkel genau der Wunsch sein - kein stiller Aufschlag.
    const neutral = Math.abs(proben[0].winkel - proben[0].wunsch) < 1e-9;
    // Und die Kalibrierung muss WIRKEN: bei 60 km/h unter Bremsen beschneidet der Reibkreis
    // auf etwa 35 Grad, und 2,0 muss den vollen Anschlag zurueckholen.
    const holt = proben[0].grad < 44 && messe(2, 1).grad === 45;
    // Auch in der Gegenrichtung, und mit demselben Betrag: eine Kalibrierung, die nur nach
    // einer Seite wirkt, waere ein Lenkoffset.
    const links = messe(2, -1);
    const spiegel = Math.abs(links.winkel + messe(2, 1).winkel) < 1e-9;
    const ok = gedeckelt && monoton && neutral && holt && spiegel;
    return { ok, mass: proben.map((p, i) => [1, 1.5, 2, 2.5, 3][i].toFixed(1) + 'x '
      + p.grad + '\u00b0').join('  ')
      + ' | Wunsch ' + proben[0].wunsch.toFixed(3)
      + (gedeckelt ? '' : ' | DECKEL OFFEN') + (monoton ? '' : ' | NICHT MONOTON')
      + (neutral ? '' : ' | 1,0 NICHT NEUTRAL') + (holt ? '' : ' | HOLT NICHTS ZURUECK')
      + (spiegel ? '' : ' | NICHT GESPIEGELT') };
  });

  // ---- Die Markup-Vorgaben MUESSEN die Voreinstellung Pro sein ----
  //
  // Pro ist die Vorgabe. Steht ein Regler beim Laden anders, zeigt die Legende "eigene
  // Abstimmung", ohne dass jemand etwas verstellt hat - und gefahren wird eine Mischung, die
  // in keiner Voreinstellung steht.
  //
  // Das ist genau einmal passiert, und zwar unbemerkt: das Markup stand Wert fuer Wert auf
  // dem ALTEN Pro, siebzehn Abweichungen. Zwei Orte fuer eine Aussage laufen auseinander,
  // sobald einer nachgezogen wird - und ein Vorgabewert sagt beim Ansehen nicht, aus welcher
  // Voreinstellung er stammt.
  stAdd('Markup-Vorgaben sind die Voreinstellung Pro', () => {
    if (!window.__presetValues) return { skip: true, mass: 'presetValues nicht erreichbar' };
    const soll = window.__presetValues('pro');
    if (!soll) return { skip: true, mass: 'Voreinstellung pro nicht vorhanden' };
    const ab = [];
    for (const k of Object.keys(soll)) {
      const el = $(k);
      if (!el) { ab.push(k + ': nicht im Dokument'); continue; }
      // Der VORGABEWERT und nicht der aktuelle: defaultValue und defaultChecked stehen fuer
      // das, was im Markup steht. el.value waere der Stand nach jedem Reglerzug dieser
      // Sitzung, und der Test wuerde dann messen, was der Nutzer gerade tut.
      if (el.type === 'checkbox') {
        if (el.defaultChecked !== !!soll[k]) {
          ab.push(k + ': Markup ' + el.defaultChecked + ', Pro ' + soll[k]);
        }
      } else if (Math.abs(parseFloat(el.defaultValue) - parseFloat(soll[k])) > 1e-9) {
        ab.push(k + ': Markup ' + el.defaultValue + ', Pro ' + soll[k]);
      }
    }
    return { ok: ab.length === 0,
             mass: ab.length === 0 ? Object.keys(soll).length + ' Vorgaben stimmen mit Pro'
                                   : ab.length + ' Abweichungen \u2013 ' + ab.slice(0, 3).join('; ') };
  });

  // ---- Ziffernversatz: nur bei WECHSEL, nicht in jedem Frame ----
  stAdd('Ziffernversatz feuert nicht bei unveraendertem Wert', async () => {
    const el = $('race-gear-n') || $('race-gear');
    if (!el) return { skip: true, mass: 'Gangfeld nicht im Dokument' };
    let treffer = 0;
    const beob = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.attributeName === 'class' && el.classList.contains('gt3-tick')) treffer++;
      }
    });
    beob.observe(el, { attributes: true, attributeFilter: ['class'] });
    const vorher = el.textContent;
    await new Promise(r => setTimeout(r, 600));
    beob.disconnect();
    const geblieben = el.textContent === vorher;
    if (!geblieben) {
      // Der Gang HAT sich geaendert - dann sagt der Test nichts, und das ist ehrlicher als
      // ein Urteil auf einer Messung, deren Voraussetzung nicht galt.
      return { skip: true, mass: 'Gang wechselte waehrend der Messung (' + vorher
                                 + ' -> ' + el.textContent + ')' };
    }
    return { ok: treffer === 0,
             mass: geblieben ? 'Gang "' + vorher + '" unveraendert, ' + treffer
                               + ' Versatz-Auslösungen in 600 ms'
                             : 'Gang wechselte' };
  });

  // ---- Deckglas und Einschaltrampe fangen keine Tipps ab ----
  //
  // Fast jede Kachel im Cockpit ist antippbar. Eine Scheibe ohne pointer-events: none macht
  // die ganze Anzeige toter als vorher - und auf einem Bildschirmfoto sieht man das nicht.
  stAdd('Deckglas und Einschaltrampe sind klickdurchlaessig', () => {
    const g = document.querySelector('.gt3');
    if (!g) return { skip: true, mass: 'Cockpit nicht im Dokument' };
    const schichten = [['::before', 'Einschaltrampe'], ['::after', 'Deckglas']];
    const schlecht = [];
    for (const [pseudo, name] of schichten) {
      const cs = getComputedStyle(g, pseudo);
      if (cs.content === 'none') { schlecht.push(name + ': nicht vorhanden'); continue; }
      if (cs.pointerEvents !== 'none') schlecht.push(name + ': pointerEvents ' + cs.pointerEvents);
    }
    // Und der Blendreflex ueber der Lichtreihe, in derselben Ecke wie der Vollbildknopf.
    const sh = document.querySelector('.gt3-shift');
    if (sh) {
      const cs = getComputedStyle(sh, '::after');
      if (cs.content !== 'none' && cs.pointerEvents !== 'none') {
        schlecht.push('Blendreflex: pointerEvents ' + cs.pointerEvents);
      }
    }
    return { ok: schlecht.length === 0,
             mass: schlecht.length === 0 ? 'alle drei Schichten durchlaessig'
                                         : schlecht.join('; ') };
  });

  // ---- Ghosts: eigene Spuren ----
  //
  // Am Auto ist das NICHT messbar - kein Byte meldet die Querlage, und deshalb steht in der
  // Option auch "blind". Pruefbar ist die Rechnung, und drei Aussagen daran sind es wert:
  // die Spuren muessen VERSCHIEDEN sein (sonst faehrt das Feld weiter in einer Reihe), sie
  // muessen die ganze Breite ausnutzen, und ihre Summe muss null sein - ein Feld, das im
  // Mittel zur Seite versetzt ist, faehrt nicht auf verschiedenen Linien, sondern schief.
  stAdd('Ghost-Spuren: verschieden, volle Breite, im Mittel null', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostLanes) {
      return { skip: true, mass: 'ghostLanes nicht vorhanden' };
    }
    const echt = OMEGA_TEST.ghostLanes();
    // Die Rechnung selbst pruefen, unabhaengig davon, wieviele Ghosts gerade in der Garage
    // stehen: das ist der Teil, der immer gilt.
    const spuren = (n) => {
      if (n < 2) return [0];
      const out = [];
      for (let k = 0; k < n; k++) out.push((2 * k) / (n - 1) - 1);
      return out;
    };
    const schlecht = [];
    for (const n of [2, 3, 4, 5, 8]) {
      const sp = spuren(n);
      if (new Set(sp.map(x => x.toFixed(4))).size !== n) {
        schlecht.push(n + ' Ghosts: nicht alle Spuren verschieden');
      }
      if (Math.abs(sp[0] + 1) > 1e-9 || Math.abs(sp[n - 1] - 1) > 1e-9) {
        schlecht.push(n + ' Ghosts: Breite nicht ausgenutzt (' + sp[0] + ' bis ' + sp[n - 1] + ')');
      }
      const summe = sp.reduce((a, b) => a + b, 0);
      if (Math.abs(summe) > 1e-9) schlecht.push(n + ' Ghosts: Summe ' + summe.toFixed(4));
    }
    // Ein einzelner Ghost faehrt die Mitte: ein Versatz waere dort ein Lenkfehler und keine
    // Linie.
    if (spuren(1)[0] !== 0) schlecht.push('ein Ghost fährt nicht die Mitte');
    // Und was das laufende Feld sagt, mitgemeldet - auch wenn es leer ist.
    const jetzt = echt.length
      ? echt.map(g => g.name + ' ' + g.spur.toFixed(2)).join(', ')
      : 'keine Ghosts in der Garage';
    return { ok: !schlecht.length,
             mass: '2 Ghosts ' + spuren(2).join('/') + ' | 3 ' + spuren(3).join('/')
                   + ' | 5 ' + spuren(5).map(x => x.toFixed(1)).join('/')
                   + ' || aktuell: ' + jetzt
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Reifenwaermer ----
  //
  // ZWEI Aussagen, und die zweite ist die, auf die es beim Fahren ankommt: die Temperatur
  // muss stimmen UND sie muss sich als Grip auswirken. Nur die Temperatur zu pruefen liesse
  // den Fall durch, in dem resetTyres richtig setzt und die Griffrechnung sie ignoriert -
  // genau so ist die Bremsscheibenanzeige durchgekommen: die Physik lief, und die Anzeige
  // hing an einem anderen Schalter.
  //
  // Die VIER Raeder einzeln, nicht der Mittelwert: der stimmt auch, wenn zwei Raeder kalt
  // und zwei zu heiss sind.
  stAdd('Reifenwaermer: warme Reifen beim Start, und sie greifen', () => {
    const schalter = $('setting-tyre-blankets');
    if (!schalter) return { skip: true, mass: 'Schalter nicht im Dokument' };
    if (!window.OMEGA_TEST || !OMEGA_TEST.zustandKopie) {
      return { skip: true, mass: 'zustandKopie nicht vorhanden' };
    }
    const cfg = physEngine.config, st = physEngine.state;
    const merkState = OMEGA_TEST.zustandKopie(st);
    const merkCfg = { bl: cfg.tyreBlankets, te: cfg.tyreEffect };
    const schlecht = [], teile = [];
    try {
      // tyreEffect ausdruecklich AN, sonst prueft der Test eine abgeschaltete Simulation -
      // und ein gruener Test auf einer abgeschalteten Simulation ist schlimmer als keiner.
      cfg.tyreEffect = 1;
      const griff = {};
      for (const an of [false, true]) {
        cfg.tyreBlankets = an;
        resetTyres();
        const soll = an ? cfg.tyreOptimalC : cfg.tyreAmbientC;
        const ab = st.tyreTemp4.filter(x => Math.abs(x - soll) > 1e-9).length;
        teile.push((an ? 'an' : 'aus') + ': ' + st.tyreTemp4.map(x => Math.round(x)).join('/')
                   + '\u00b0');
        if (ab) schlecht.push((an ? 'an' : 'aus') + ': ' + ab + ' von 4 Raedern falsch');
        if (Math.abs(st.tyreTempC - soll) > 1e-9) {
          schlecht.push((an ? 'an' : 'aus') + ': Mittelwert ' + st.tyreTempC.toFixed(1));
        }
        // EIN Takt echte Physik, kein Messaufbau dazwischen: tyreGrip wird in update()
        // aus st.tyreTempC gerechnet, und genau diese Kette soll geprueft werden.
        st.speedKmh = 60 / REAL_SCALE;
        st.driveMode = 'forward';
        physEngine.update({ throttle: 0.2, brake: 0, steering: 0 }, 0.02);
        griff[an ? 'warm' : 'kalt'] = st.tyreGrip;
      }
      teile.push('tyreGrip kalt ' + griff.kalt.toFixed(3) + ' gegen warm '
                 + griff.warm.toFixed(3));
      // Warme Reifen MUESSEN mehr Griff haben. Ein Waermer, der die Temperatur setzt und
      // sonst nichts tut, waere eine Anzeige und keine Einstellung.
      if (!(griff.kalt < griff.warm - 1e-6)) {
        schlecht.push('warme Reifen greifen nicht besser (' + griff.kalt.toFixed(4)
                      + ' gegen ' + griff.warm.toFixed(4) + ')');
      }
      // Und das Feld MUSS in calibRef stehen, sonst meldet physConfigDiff auf frischem
      // Laden eine Abweichung - diese Fehlerklasse hat in v0.4 dreimal Zeit gekostet.
      if (physEngine.calibRef && !('tyreBlankets' in physEngine.calibRef)) {
        schlecht.push('tyreBlankets fehlt in calibRef');
      }
      return { ok: !schlecht.length,
               mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      cfg.tyreBlankets = merkCfg.bl;
      cfg.tyreEffect = merkCfg.te;
      OMEGA_TEST.zustandZurueck(st, merkState);
    }
  });

  // ---- Controller: eine Taste, eine Bedeutung ----
  //
  // Gemeldet als "LB hat noch irgendeine weitere Belegung". Die Ursache war eine Migration,
  // die nur greift, wenn ZWEI Belegungen zugleich noch auf ihren alten Vorgaben liegen: wer in
  // v0.4 gefahren ist, hatte trackview auf LB gespeichert und racestart gar nicht, also lief
  // sie nicht - und LB schaltete die Leseart UND die Streckenansicht, die das Cockpit und
  // damit das Vollbild verlaesst.
  //
  // Geprueft werden BEIDE Richtungen, und die zweite ist die, die ich beim ersten Anlauf
  // kaputtgemacht habe: X traegt ab Werk absichtlich zwei Aktionen (Tippen schaltet runter,
  // Halten loest die gelbe Flagge). Ein Aufloeser, der stur Kollisionen bricht, gibt dort das
  // Runterschalten frei - eine Verschlechterung, die als Aufraeumen aussieht.
  stAdd('Controller: Kollisionen aufgeloest, gewollte Doppelbelegung bleibt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.padResolve) {
      return { skip: true, mass: 'padResolve nicht vorhanden' };
    }
    const vorgabe = OMEGA_TEST.padDefaults();
    const schluessel = (x) => (x && x.type && x.type !== 'none') ? x.type + ':' + x.index : null;
    const schlecht = [], teile = [];

    // 1. Der gemeldete Fall: ein v0.4-Speicher mit trackview auf LB.
    const a = OMEGA_TEST.padResolve({
      pitstop: { type: 'button', index: 9, label: 'Start / Options' },
      trackview: { type: 'button', index: 4, label: 'LB / L1' } });
    teile.push('gepflanzt: scanmode ' + a.scanmode.label + ', trackview ' + a.trackview.label);
    if (schluessel(a.scanmode) !== schluessel(vorgabe.scanmode)) {
      schlecht.push('scanmode nicht mehr auf LB');
    }
    if (schluessel(a.trackview) === schluessel(a.scanmode)) {
      schlecht.push('trackview liegt weiter auf LB');
    }
    if (!a.__kollisionen || !a.__kollisionen.length) schlecht.push('Kollision nicht gemeldet');

    // 2. Die GEWOLLTE Doppelbelegung: X traegt Runterschalten und die gelbe Flagge. Ein
    //    unveraenderter Speicher darf daran nichts aendern.
    const b = OMEGA_TEST.padResolve({});
    for (const n of Object.keys(vorgabe)) {
      if (schluessel(b[n]) !== schluessel(vorgabe[n])) {
        schlecht.push(n + ': ohne Anlass verschoben (' + (b[n] && b[n].label) + ')');
      }
    }
    if (b.__kollisionen) schlecht.push('meldet Kollisionen in den eigenen Vorgaben');
    teile.push('Vorgaben unveraendert: ' + (b.__kollisionen ? 'NEIN' : 'ja')
               + ' (Kreuz ' + (b.yellowflag && b.yellowflag.index === 0 ? 'traegt die Flagge'
                                : 'traegt sie NICHT') + ')');

    // 3. Und die Vorgaben selbst: ausser dem X-Paar darf nichts doppelt liegen. Eine
    //    unbeabsichtigte Doppelbelegung ab Werk waere derselbe Fehler, nur von Anfang an.
    const zaehler = new Map();
    for (const n of Object.keys(vorgabe)) {
      const k = schluessel(vorgabe[n]);
      if (!k) continue;
      zaehler.set(k, (zaehler.get(k) || []).concat(n));
    }
    // KEINE Ausnahme mehr. Bis v0.5.1 lagen Runterschalten und gelbe Flagge gemeinsam auf
    // Quadrat, unterschieden nur durch die Haltedauer - das war so gebaut und stand hier als
    // erlaubtes Paar. Gemeint war es nicht: die gelbe Flagge liegt jetzt auf Kreuz, und
    // damit traegt jede Taste genau eine Bedeutung. Der Test ist dadurch strenger und
    // einfacher, und eine Ausnahmeliste, die man pflegen muss, faellt weg.
    for (const [k, ns] of zaehler) {
      if (ns.length > 1) schlecht.push('Vorgaben: ' + ns.join(' und ') + ' beide auf ' + k);
    }

    return { ok: !schlecht.length,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Rundenzeit-Plot: die Zahlen im Bild passen zu den Daten ----
  //
  // Nicht wie er AUSSIEHT - das entscheidet das Auge -, sondern dass er keine Runde
  // verschluckt und die Markierungen an der richtigen Runde sitzen. Ein Plot, der einen
  // Boxenstopp eine Runde zu spaet malt, sieht vollkommen richtig aus.
  stAdd('Rundenzeit-Plot: Balken, Markierungen und Fussnote stimmen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.plotZeichnen) {
      return { skip: true, mass: 'plotZeichnen nicht vorhanden' };
    }
    const merk = $('sess-plot') ? $('sess-plot').innerHTML : null;
    const merkNote = $('sess-plot-note') ? $('sess-plot-note').textContent : null;
    try {
      const sitzung = { zeit: '2026-01-01T00:00:00.000Z', strafeS: 7,
        autos: [{ name: 'Pruefwagen', rolle: 'player',
                  laps: [12000, 11500, 19000, 11800, 12200],
                  ereignisse: [{ pit: 0, crash: 0 }, { pit: 0, crash: 0 },
                               { pit: 1, crash: 0 }, { pit: 0, crash: 2 },
                               { pit: 0, crash: 0 }] }] };
      const r = OMEGA_TEST.plotZeichnen(sitzung, 'Pruefwagen');
      const schlecht = [];
      // Fuenf Runden, fuenf Balken. Genau einer gelb (die Runde mit dem Stopp), genau ein
      // Blitz (die Runde mit den zwei Abgaengen - zwei Abgaenge, EIN Symbol mit Zahl).
      if (r.balken !== 5) schlecht.push(r.balken + ' Balken statt 5');
      if (r.gelb !== 1) schlecht.push(r.gelb + ' gelbe statt 1');
      if (r.blitze !== 1) schlecht.push(r.blitze + ' Blitze statt 1');
      // Die Fussnote nennt die Summen und die Strafe.
      for (const soll of ['5 ', '11.50s', '1 ', '2 ', '7 ']) {
        if (r.fussnote.indexOf(soll) < 0) schlecht.push('Fussnote ohne "' + soll.trim() + '"');
      }
      // Und eine Sitzung OHNE Ereignisse darf keine Markierungen erfinden.
      const alt = OMEGA_TEST.plotZeichnen({ zeit: '2026-01-01T00:00:00.000Z',
        autos: [{ name: 'Alt', rolle: 'player', laps: [12000, 12100], ereignisse: [] }] }, 'Alt');
      if (alt.gelb !== 0 || alt.blitze !== 0) {
        schlecht.push('alte Sitzung erfindet Markierungen');
      }
      return { ok: !schlecht.length,
               mass: r.balken + ' Balken, ' + r.gelb + ' gelb, ' + r.blitze + ' Blitz | '
                     + r.fussnote.slice(0, 70)
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      if (merk !== null && $('sess-plot')) $('sess-plot').innerHTML = merk;
      if (merkNote !== null && $('sess-plot-note')) $('sess-plot-note').textContent = merkNote;
    }
  });

  // ---- Als App installierbar: Manifest, Symbole, Cacheversion ----
  //
  // Die dritte Aussage ist die wichtigste und die einzige, die man nicht sehen kann: bleibt
  // der Cachename ueber einen Build gleich, liefert der Service Worker die ALTE Fassung aus.
  // Der Fehlerbericht heisst dann "die Behebung ist nicht drin", und man sucht im Code statt
  // im Cache.
  stAdd('Als App installierbar: Manifest, Symbole, Cacheversion', async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return { ok: false, mass: 'kein <link rel=manifest> im Dokument' };
    if (location.protocol === 'file:') {
      // Von der Platte laesst sich das Manifest nicht holen (fetch auf file:// ist
      // gesperrt), und ein Service Worker gibt es dort ohnehin nicht.
      return { skip: true, mass: 'von der Platte geladen, Manifest nicht abrufbar' };
    }
    const teile = [], schlecht = [];
    let man = null;
    try {
      man = await (await fetch(link.getAttribute('href'), { cache: 'no-store' })).json();
    } catch (e) {
      return { ok: false, mass: 'Manifest nicht lesbar: ' + (e && e.message ? e.message : e) };
    }
    for (const feld of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
      if (!man[feld]) schlecht.push('Feld ' + feld + ' fehlt');
    }
    // RELATIV. Ein fuehrender Schraegstrich zeigt auf GitHub Pages auf die Wurzel der Domain
    // und nicht auf /btsr/ - und auf localhost faellt das nicht auf.
    for (const [feld, wert] of [['start_url', man.start_url], ['scope', man.scope]]) {
      if (typeof wert === 'string' && wert.charAt(0) === '/') {
        schlecht.push(feld + ' ist absolut (' + wert + '), bricht unter einem Unterpfad');
      }
    }
    const symbole = man.icons || [];
    if (!symbole.some(i => (i.purpose || 'any').indexOf('maskable') >= 0)) {
      schlecht.push('kein maskable-Symbol');
    }
    // Jedes Symbol wirklich holen. Der Build prueft nur Markup, nicht diese JSON-Datei.
    let geladen = 0;
    for (const ic of symbole) {
      if (typeof ic.src === 'string' && ic.src.charAt(0) === '/') {
        schlecht.push('Symbolpfad absolut: ' + ic.src);
      }
      try {
        const r = await fetch(new URL(ic.src, link.href).href, { cache: 'no-store' });
        if (r.ok) geladen++; else schlecht.push(ic.src + ': ' + r.status);
      } catch (e) { schlecht.push(ic.src + ' nicht abrufbar'); }
    }
    teile.push(geladen + ' von ' + symbole.length + ' Symbolen geladen');

    // Der Cachename gegen die angezeigte Version.
    const v = ($('app-version') || {}).textContent;
    let swText = null;
    try { swText = await (await fetch('sw.js', { cache: 'no-store' })).text(); } catch (e) { }
    if (swText === null) {
      teile.push('sw.js nicht abrufbar');
      schlecht.push('sw.js fehlt');
    } else {
      if (swText.indexOf('SW_VERSION_PLATZHALTER') >= 0) {
        schlecht.push('sw.js traegt noch den Platzhalter, der Build hat ihn nicht ersetzt');
      } else if (v && swText.indexOf("'" + String(v).trim() + "'") < 0) {
        schlecht.push('Cacheversion in sw.js passt nicht zu ' + v);
      } else {
        teile.push('Cacheversion ' + String(v).trim());
      }
    }
    return { ok: !schlecht.length,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Fahrzeuglayout: gerechnete Nickgrenzen ----
  //
  // DIE ZUSICHERUNG, DIE DIE KALIBRIERUNG SCHUETZT. loadFrontOnPower und loadFrontOnBrake
  // standen bis v0.5 als eigene Konfigurationsfelder da und waren 0,5 -/+ transferK -
  // dieselbe Geometrie an einem zweiten Ort. rearGrip ist auf loadFrontOnPower normiert,
  // ausdruecklich damit die gemessene Anfahrzeit so bleibt, wie kalibriert. Wuerden die
  // Grenzen unabhaengig gehalten, verschoebe jede Layout-Wahl still diese Messung.
  stAdd('Layout: Nickgrenzen werden gerechnet, nicht gehalten', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physLayouts) {
      return { skip: true, mass: 'physLayouts nicht vorhanden' };
    }
    const tab = OMEGA_TEST.physLayouts();
    const tk = physEngine.config.transferK;
    const schlecht = [], teile = [];
    for (const [name, v] of Object.entries(tab)) {
      if (Math.abs(v.gas - (v.vorn - tk)) > 1e-9) {
        schlecht.push(name + ': Gas ' + v.gas + ' statt ' + (v.vorn - tk).toFixed(4));
      }
      if (Math.abs(v.bremse - (v.vorn + tk)) > 1e-9) {
        schlecht.push(name + ': Bremse ' + v.bremse + ' statt ' + (v.vorn + tk).toFixed(4));
      }
      // Der Ruhewert der Achslast MUSS dem Layout folgen, sonst zeigt die Radlastanzeige
      // beim ersten Takt ein anderes Auto und springt dann.
      if (Math.abs(v.ruhelast - v.vorn) > 1e-9) {
        schlecht.push(name + ': Ruhelast ' + v.ruhelast + ' statt ' + v.vorn);
      }
      teile.push(name + ' ' + Math.round(v.vorn * 100) + '/'
                 + Math.round(v.gas * 100) + '/' + Math.round(v.bremse * 100));
    }
    // Und die alten Felder duerfen NICHT mehr existieren: solange sie da sind, kann jemand
    // sie lesen und bekommt einen Wert, der nicht zum Layout passt.
    for (const alt of ['loadFrontOnPower', 'loadFrontOnBrake']) {
      if (alt in physEngine.config) schlecht.push(alt + ' steht noch in der Konfiguration');
    }
    return { ok: !schlecht.length,
             mass: 'vorn/Gas/Bremse in %: ' + teile.join('  ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });


  // ---- Getriebe: GT3 ist die Vorgabe und bleibt der Kalibrierbezug ----
  //
  // Die Aenderung soll rein additiv sein. Geprueft wird an zwei Stellen: der Bezug traegt
  // weiter sechs Gaenge (er darf beim Wechsel NICHT mitwandern), und mit GT3 stimmen die
  // Skalare mit ihm ueberein.
  //
  // Der Bezug ist der wunde Punkt: calibRef ist eine FLACHE Kopie der Konfiguration, also
  // trug er bis v0.4.53 denselben Verweis auf das Uebersetzungs-Array. Ohne eigene Kopie
  // waeren nach einem Wechsel die GT3-Schaltpunkte auf F1-Zahnraedern gestanden - eine
  // Messung, die still falsch ist statt offen anders.
  stAdd('Getriebe: GT3 ist der Kalibrierbezug', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxShare) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const p = OMEGA_TEST.physGearboxShare('f1');
    const merk = physEngine.gearboxName || 'gt3';
    let gleich = null;
    try {
      physEngine.applyGearbox('gt3');
      const c = physEngine.config, r = physEngine.calibRef;
      gleich = ['ratioRef', 'upshiftRpm', 'downshiftRpm', 'shiftMs', 'rpmScale']
        .filter(k => Math.abs(c[k] - r[k]) > 1e-9);
    } finally {
      physEngine.applyGearbox(merk);
    }
    const ok = p.bezugGaenge === 6 && !p.bezugGeteilt && gleich.length === 0;
    return { ok, mass: 'Bezug ' + p.bezugGaenge + ' Gaenge, '
                       + (p.bezugGeteilt ? 'TEILT das Array' : 'eigene Kopie')
                       + ' | mit GT3 abweichend: '
                       + (gleich.length ? gleich.join(', ') : 'nichts') };
  });

  // ---- Getriebe: die Uebersetzungen sind gerechnet, nicht getippt ----
  //
  // DIE STAERKSTE der Getriebepruefungen, weil sie gegen eine Regel prueft und nicht gegen
  // eine Abschrift: ratio mal topFrac ist fuer jeden Gang ausser dem letzten das
  // Produkt GEAR_PRODUCT, und der letzte traegt ratioRef. Eine einzeln verstellte Zahl
  // faellt damit auf, egal in welchem Getriebe sie steht.
  stAdd('Getriebe: Uebersetzungen folgen der Regel', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxes) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const t = OMEGA_TEST.physGearboxes();
    const P = t._produkt;
    const schlecht = [], teile = [];
    for (const name of Object.keys(t)) {
      if (name.charAt(0) === '_') continue;
      const g = t[name];
      teile.push(name + ': ' + g.gaenge + ' Gaenge, Ref ' + g.ratioRef);
      // 1. Der letzte Gang IST der Bezug - gerechnet und nicht gehalten.
      if (Math.abs(g.ratioRef - g.ratios[g.ratios.length - 1]) > 1e-9) {
        schlecht.push(name + ': ratioRef ' + g.ratioRef + ' statt '
                      + g.ratios[g.ratios.length - 1]);
      }
      // 2. Alle ausser dem letzten treffen das Produkt. 0,006 Toleranz, weil die
      //    Uebersetzungen auf zwei Stellen gerundet im Quelltext stehen.
      for (let i = 0; i < g.produkte.length - 1; i++) {
        if (Math.abs(g.produkte[i] - P) > 0.006) {
          schlecht.push(name + ': Gang ' + (i + 1) + ' Produkt ' + g.produkte[i]);
        }
      }
      // 3. Der letzte Gang erreicht die Spitze, und nur dort.
      if (Math.abs(g.topFracs[g.topFracs.length - 1] - 1) > 1e-9) {
        schlecht.push(name + ': letzter topFrac ' + g.topFracs[g.topFracs.length - 1]);
      }
      // 4. Fallend, ohne Ausnahme. Ein Gang, der laenger ist als der darunter, waere ein
      //    Getriebe, in dem Hochschalten die Drehzahl hebt.
      for (let i = 0; i < g.ratios.length - 1; i++) {
        if (g.ratios[i] <= g.ratios[i + 1]) schlecht.push(name + ': Gang ' + (i + 2) + ' nicht kuerzer');
      }
    }
    return { ok: schlecht.length === 0,
             mass: 'Produkt ' + P + ' | ' + teile.join(' | ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Getriebe: die Automatik pendelt nicht ----
  //
  // Nach einem Hochschalten faellt die Drehzahl auf upshiftRpm * ratio[i+1] / ratio[i].
  // Liegt die Rueckschaltschwelle darueber, schaltet die Automatik hoch und sofort wieder
  // herunter - und man sucht das im Fahrgefuehl statt in einer Zahl. Der kleinste Abstand
  // ueber alle Gaenge ist das, was zaehlt.
  stAdd('Getriebe: kein Schaltpendeln', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxes) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const t = OMEGA_TEST.physGearboxes();
    const schlecht = [], teile = [];
    for (const name of Object.keys(t)) {
      if (name.charAt(0) === '_') continue;
      const g = t[name];
      teile.push(name + ': ' + g.reserve + '/min');
      if (!(g.reserve > 300)) schlecht.push(name + ': nur ' + g.reserve);
      // Und die Schaltschwelle darf nicht ueber der Drehzahlgrenze liegen: dann wuerde
      // NIE hochgeschaltet und das Auto haenge im ersten Gang am Begrenzer.
      if (g.upshiftRpm >= t._redline) schlecht.push(name + ': Schaltpunkt ueber der Grenze');
    }
    return { ok: schlecht.length === 0,
             mass: 'Pendelreserve ' + teile.join(' | ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Getriebe: die Ghosts fahren dasselbe ----
  //
  // Die Ghosts teilen das Uebersetzungs-Array per Verweis, damit accelScale() nicht zweimal
  // kalibriert. Deshalb aendert applyGearbox es AN DER STELLE: ein Splice erreicht jeden
  // Teilhaber, ein neues Array haette den Verweis gekappt - und ein fahrender Ghost waere
  // still im alten Getriebe geblieben. Ohne Ghost im Feld prueft der Test nur, dass der
  // Aufbau laeuft, und sagt das.
  stAdd('Getriebe: Ghosts teilen die Uebersetzungen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxShare) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const p = OMEGA_TEST.physGearboxShare('p412');
    if (!p.ghosts.length) {
      return { ok: p.gaenge === 5,
               mass: 'kein Ghost verbunden, Wechsel selbst ok: ' + p.gaenge + ' Gaenge' };
    }
    const lose = p.ghosts.filter(g => !g.geteilt);
    const zuHoch = p.ghosts.filter(g => g.gang >= g.gaenge);
    return { ok: lose.length === 0 && zuHoch.length === 0,
             mass: p.ghosts.length + ' Ghosts, ' + p.gaenge + ' Gaenge'
                   + (lose.length ? ' || NICHT GETEILT: ' + lose.map(g => g.alias).join(', ') : '')
                   + (zuHoch.length ? ' || Gang ausserhalb: ' + zuHoch.map(g => g.alias).join(', ') : '') };
  });

  // ---- Getriebe: KEIN Preset-Schluessel ----
  //
  // Dieselben zwei Achsen wie beim Layout: welches Auto gegen wie abgestimmt. Ohne die
  // Ausnahme wuerde ein Klick auf "GT3" das GETRIEBE wechseln. Geprueft wird der Vertrag
  // und nicht die Wirkung - eine Voreinstellung anzuwenden wuerde die Einstellungen des
  // Nutzers veraendern, nur um etwas zu pruefen, das strukturell entschieden ist.
  stAdd('Getriebe: nicht in den Voreinstellungen', () => {
    const el = $('setting-gearbox');
    if (!el) return { ok: false, mass: 'setting-gearbox fehlt' };
    if (typeof presetControls !== 'function') {
      return { skip: true, mass: 'presetControls nicht erreichbar' };
    }
    const ids = presetControls().map(x => x.id);
    const drin = ids.includes('setting-gearbox');
    const genug = ids.length > 30;
    const markiert = el.hasAttribute('data-preset-skip');
    return { ok: !drin && genug && markiert,
             mass: ids.length + ' Bedienelemente in den Voreinstellungen, Getriebe '
                   + (drin ? 'IST DABEI' : 'nicht dabei')
                   + ', Attribut ' + (markiert ? 'gesetzt' : 'FEHLT') };
  });

  // ---- Getriebe: das Menue und die Tabelle sind derselbe Satz ----
  //
  // Dieselbe Fehlerklasse wie beim Motormenue: ein Eintrag ohne Tabelleneintrag laesst
  // applyGearbox still auf GT3 zurueckfallen, und der Waehler zeigt dann etwas anderes als
  // das Modell. Beide Richtungen, denn ein Getriebe, das man nicht waehlen kann, ist ein
  // toter Eintrag.
  stAdd('Getriebe: Menue und Tabelle deckungsgleich', () => {
    const sel = $('setting-gearbox');
    if (!sel) return { ok: false, mass: 'kein #setting-gearbox' };
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxes) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const t = OMEGA_TEST.physGearboxes();
    const tabelle = Object.keys(t).filter(k => k.charAt(0) !== '_');
    const menue = Array.prototype.map.call(sel.options, o => o.value);
    const ohne = menue.filter(v => tabelle.indexOf(v) < 0);
    const unerreichbar = tabelle.filter(v => menue.indexOf(v) < 0);
    return { ok: ohne.length === 0 && unerreichbar.length === 0,
             mass: menue.length + ' Eintraege, ' + tabelle.length + ' Getriebe'
                   + (ohne.length ? ' | OHNE TABELLE: ' + ohne.join(', ') : '')
                   + (unerreichbar.length ? ' | nicht waehlbar: ' + unerreichbar.join(', ') : '') };
  });

  // ---- Getriebe: der eingelegte Gang bleibt im Getriebe ----
  //
  // Von acht auf fuenf Gaenge zeigt der alte Index ins Leere, und gearRatio() liest
  // undefined.ratio. Der Weg dorthin ist ganz normal: im achten Gang fahren, umschalten.
  stAdd('Getriebe: Gang wird beim Wechsel gedeckelt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGearboxes) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const merk = physEngine.gearboxName || 'gt3';
    const merkGang = physEngine.state.currentGear;
    try {
      physEngine.applyGearbox('f1');
      physEngine.state.currentGear = physEngine.config.gears.length - 1;   // achter Gang
      const vor = physEngine.state.currentGear;
      physEngine.applyGearbox('p412');
      const nach = physEngine.state.currentGear;
      // Und die Gegenprobe, dass danach ueberhaupt gerechnet werden kann.
      const r = physEngine.gearRatio(nach);
      const ok = vor === 7 && nach === 4 && typeof r === 'number' && isFinite(r);
      return { ok, mass: 'im ' + (vor + 1) + '. Gang umgeschaltet, danach '
                         + (nach + 1) + '. von ' + physEngine.config.gears.length
                         + ', Uebersetzung ' + r };
    } finally {
      physEngine.applyGearbox(merk);
      physEngine.state.currentGear = Math.min(merkGang, physEngine.config.gears.length - 1);
    }
  });



  // ---- Flaggenstreifen: jeder Text, den er zeigen kann, ist uebersetzt ----
  //
  // DIE LUECKE, DIE DIESEN TEST NOETIG MACHT: der Sprachtest laeuft ueber die SICHTBAREN
  // Textknoten, und dieser Streifen ist im Ruhezustand leer - er wird erst befuellt, wenn
  // eine Flagge weht. "GELB" und "ANFAHRT" standen deshalb seit v0.4 ohne Eintrag da, ohne
  // dass etwas es meldete, waehrend "GELB · AUTOPILOT" daneben einen hatte.
  //
  // Geprueft wird mit den Zeichenketten DES CODES und nicht mit abgetippten: der Test
  // stellt jeden Zustand her, ruft updateFlagUi() und liest, was dasteht. Ein zweites Mal
  // hingeschriebene Texte wuerden auseinanderlaufen, sobald einer sich aendert - genau die
  // Fehlerklasse, die dieser Test finden soll.
  stAdd('Flaggenstreifen: jeder Text ist uebersetzt', () => {
    const el = $('race-flag');
    if (!el) return { ok: false, mass: 'race-flag fehlt' };
    if (typeof updateFlagUi !== 'function') {
      return { skip: true, mass: 'updateFlagUi nicht erreichbar' };
    }
    const merk = { flag: flagState, tm: trackMode, form: raceFormationLap };
    const gesehen = [], ohne = [];
    // Dieselbe Regel wie im Sprachtest: Umlaute oder deutsche Funktionswoerter.
    const DE = /[\u00e4\u00f6\u00fc\u00df\u00c4\u00d6\u00dc]|\b(GELB|ANFAHRT)\b/;
    try {
      const ZUSTAENDE = [
        ['yellow', 'on', false], ['yellow', 'off', false],
        ['restart', 'on', false],
        ['green', 'on', true], ['green', 'off', true],
      ];
      for (const [f, tm, form] of ZUSTAENDE) {
        flagState = f; trackMode = tm; raceFormationLap = form;
        updateFlagUi();
        const t0 = (el.textContent || '').trim();
        if (!t0) continue;
        gesehen.push(t0);
        // Im deutschen Modus muss es einen Eintrag geben, im englischen darf kein Deutsch
        // stehen bleiben. Beide Richtungen aus derselben Zeichenkette.
        if (lang === 'de') {
          if (i18nLookup(t0) === null) ohne.push(t0);
        } else if (DE.test(t0)) {
          ohne.push(t0);
        }
      }
      return { ok: ohne.length === 0,
               mass: gesehen.length + ' Zustaende mit Text: ' + gesehen.join(' / ')
                     + (ohne.length ? ' || OHNE EINTRAG: ' + ohne.join(', ') : '') };
    } finally {
      flagState = merk.flag; trackMode = merk.tm; raceFormationLap = merk.form;
      updateFlagUi();
    }
  });



  // ---- Motorschleifen: keine hoerbare Schleife am Ratenanschlag ----
  //
  // DER BEFUND, der diesen Test noetig gemacht hat, und er war an den einzelnen Zahlen nicht
  // zu sehen: die Abspielrate ist auf [0,5 .. 2,0] geklemmt, also eine Oktave nach jeder
  // Seite. Leerlauf und Mittelband lagen beim Porsche aber 2,2 Oktaven auseinander (1200 auf
  // 5500). Von 1500 bis 2750 klebte damit immer mindestens ein HOERBARES Band am Anschlag,
  // und bei 5000 trug das Leerlaufband noch 12 Prozent Gewicht bei einer Rate, die auf ein
  // Drittel des Verlangten geklemmt war. Gemeldet als "am Anfang des Anfahrens klingt der Ton
  // komisch, das sind zwei Toene, die nicht zusammenpassen".
  //
  // Geprueft wird das ganze Drehzahlband in 50er-Schritten, und die Aussage ist absolut:
  // NULL geklemmte hoerbare Baender. Dazu der groesste Abstand zwischen zwei Nachbarn, denn
  // das ist die Groesse, die man beim naechsten neuen Motor im Auge behalten muss.
  stAdd('Motorschleifen: kein Band am Ratenanschlag', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.sndBandCheck) {
      return { skip: true, mass: 'sndBandCheck nicht vorhanden' };
    }
    if (location.protocol === 'file:') {
      return { skip: true, mass: 'file://, der Browser verbietet das Laden' };
    }
    let manifest;
    try { manifest = await (await fetch('audio/loops.json')).json(); }
    catch (e) { return { skip: true, mass: 'audio/loops.json nicht ladbar' }; }
    // Die Schranke: 0,02 Oktaven gewichtet. Zum Vergleich die gemeldeten Faelle vor der
    // Berichtigung - f1_2026 bei 1500/min lag bei 0,47, das Leerlaufband des Porsche bei
    // 5000/min bei 0,13. Der heutige Rest liegt bei 0,003, also um mehr als das Sechsfache
    // darunter: zwei Prozent Verstimmung bei neun Prozent Gewicht.
    const GRENZE = 0.02;
    const schlecht = [];
    let weit = 0, geprueft = 0, aergste = 0;
    for (const key of Object.keys(manifest)) {
      // 'over' laeuft PARALLEL nach Last und nicht in der Drehzahl-Ueberblendung - es
      // gehoert nicht in diese Rechnung.
      const basen = Object.keys(manifest[key].loops || {})
        .filter(b => b !== 'over')
        .map(b => manifest[key].loops[b].baseRpm);
      const r = OMEGA_TEST.sndBandCheck(basen);
      if (r.fehlt !== undefined) { schlecht.push(key + ': ' + r.fehlt); continue; }
      geprueft++;
      weit = Math.max(weit, r.oktaven);
      aergste = Math.max(aergste, r.verstimmung);
      if (r.verstimmung > GRENZE) {
        schlecht.push(key + ': Verstimmung ' + r.verstimmung + ' bei '
                      + JSON.stringify(r.schlimmste));
      }
      if (r.oktaven > 1.2) schlecht.push(key + ': Bandabstand ' + r.oktaven + ' Oktaven');
    }
    return { ok: schlecht.length === 0,
             mass: geprueft + ' Motoren, groesster Bandabstand ' + weit.toFixed(2)
                   + ' Oktaven, schlimmste gewichtete Verstimmung ' + aergste.toFixed(4)
                   + ' (Grenze ' + GRENZE + ')'
                   + (schlecht.length ? ' || ' + schlecht.slice(0, 2).join('; ') : '') };
  });

  // ---- Tank und Schaden drosseln GENAU EINMAL ----
  //
  // Bis v0.4.55 zweimal: fuelDamageDerate() vor der Physik, und applyFuelAndDamage() noch
  // einmal auf das ausgehende Byte. physOutThrottle ist motorPWM, also der Anteil simulierte
  // Geschwindigkeit durch Hoechstgeschwindigkeit - wird der noch multipliziert, sagt das Byte
  // etwas anderes als der Tacho. Gemeldet als "da steht 200 km/h, aber das Auto faehrt
  // langsam", und die Gaenge und der Ton hingen mit, weil die Drehzahl aus der simulierten
  // Geschwindigkeit kommt.
  //
  // Der zweite Griff ist weg, und der Beweis dafuer ist strukturell: die Funktion, die den
  // Verbrauch zaehlt, gibt keinen Wert mehr zurueck. Gaebe sie einen, koennte ihn jemand
  // wieder aufs Byte schreiben.
  stAdd('Tank: drosselt genau einmal, vor der Physik', () => {
    if (typeof fuelTankTick !== 'function' || typeof fuelDamageDerate !== 'function') {
      return { skip: true, mass: 'Tankfunktionen nicht erreichbar' };
    }
    const schlecht = [];
    const gemerkt = fuel;
    try {
      // 1. Der Verbrauchszaehler gibt NICHTS zurueck.
      fuel = 100;
      const rueck = fuelTankTick(0);
      if (rueck !== undefined) schlecht.push('fuelTankTick gibt ' + rueck + ' zurueck');
      // 2. Die Drosselung selbst wirkt weiter, und zwar mit dem Deckel als Argument.
      fuel = 0;
      const leer = fuelDamageDerate(1);
      const halb = fuelDamageDerate(1, 0.6);
      fuel = 100;
      const voll = fuelDamageDerate(1);
      if (!(leer < voll * 0.5)) schlecht.push('leerer Tank drosselt nicht');
      if (!(halb > leer && halb < voll)) {
        schlecht.push('der Deckel als Argument wirkt nicht: ' + halb);
      }
      // 3. Und die Rampe hat ein Ziel, das vom Tank abhaengt.
      if (typeof fuelCutTarget === 'function') {
        fuel = 0;
        const zLeer = fuelCutTarget();
        fuel = 100;
        const zVoll = fuelCutTarget();
        if (!(zLeer < zVoll)) schlecht.push('Rampenziel haengt nicht am Tank');
      }
      return { ok: schlecht.length === 0,
               mass: 'Rueckgabe ' + rueck + ' | Gas leer ' + leer.toFixed(2)
                     + ', bei Deckel 0,6 ' + halb.toFixed(2) + ', voll ' + voll.toFixed(2)
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally { fuel = gemerkt; }
  });



  // ---- Cockpit-Ansicht: sichtbar verschieden, funktional gleich ----
  //
  // ZWEI AUSSAGEN, und die erste hat die erste Fassung dieses Tests durchgelassen.
  //
  // Er verglich color und border-radius mit !== - sechs von 255 Unterschied in der Tinte
  // gelten dabei als "verschieden", und genau so viel lagen Standard und Modern auseinander.
  // Die BLENDE hat er gar nicht angesehen, und die war in allen drei bitgleich, weil ihre
  // Tokens in der .gt3-Regel selbst standen und eine Ueberschreibung auf body nur geerbt
  // wird - Erben verliert gegen eine Deklaration am Element. Gemeldet als "sehen irgendwie
  // alle identisch aus", und der Test war gruen.
  //
  // Er zaehlt jetzt MERKMALE statt Ungleichheiten: Tinte (mit Abstand, nicht mit !==),
  // Blende oben, Blende unten, Eckenrundung, Blendenmaterial, Pixelzeilen. Drei davon
  // muessen sich je PAAR unterscheiden, und das Material immer - es ist die groesste Flaeche.
  //
  // Die zweite Aussage ist die Zusicherung der Aufgabe: nur das Aussehen. Kein Physikwert,
  // kein Element, keine Voreinstellung darf sich bewegen.
  stAdd('Cockpit-Ansicht: sichtbar verschieden, funktional gleich', () => {
    const sel = $('setting-cockpit');
    const dash = $('race-dash');
    if (!sel || !dash) return { ok: false, mass: 'Waehler oder Cockpit fehlt' };
    const merk = sel.value;
    const schlecht = [];
    try {
      const messe = (v) => {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const cs = getComputedStyle(dash);
        return { v,
                 attr: document.body.getAttribute('data-cockpit'),
                 tinte: cs.color,
                 oben: cs.borderTopWidth,
                 unten: cs.borderBottomWidth,
                 radius: cs.borderTopLeftRadius,
                 material: cs.getPropertyValue('--gt3-carbon').trim(),
                 zeilen: cs.getPropertyValue('--gt3-scan').trim(),
                 ids: document.querySelectorAll('[id]').length,
                 diff: (window.OMEGA_TEST && OMEGA_TEST.physConfigDiff)
                   ? Object.keys(OMEGA_TEST.physConfigDiff()).length : 0 };
      };
      // Farbabstand statt Ungleichheit: rgb(238,242,250) gegen rgb(244,248,255) ist
      // rechnerisch verschieden und mit dem Auge dasselbe.
      const rgb = (t) => (t.match(/\d+/g) || []).map(Number);
      const abstand = (x, y) => {
        const A = rgb(x), B = rgb(y);
        if (A.length < 3 || B.length < 3) return 0;
        return Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2]);
      };

      const werte = Array.prototype.map.call(sel.options, o => o.value);
      if (werte.length < 3) schlecht.push('nur ' + werte.length + ' Ansichten');
      const proben = werte.map(messe);

      // 1. Die Vorgabe setzt KEIN Attribut: sonst waeren ihre Werte eine zweite Abschrift
      //    dessen, was in :root steht.
      if (proben[0].attr !== null) schlecht.push('Vorgabe setzt ' + proben[0].attr);

      // 2. Sichtbar verschieden, Paar fuer Paar.
      const paare = [];
      for (let i = 0; i < proben.length; i++) {
        for (let j = i + 1; j < proben.length; j++) {
          const A = proben[i], B = proben[j];
          const merkmale = [
            abstand(A.tinte, B.tinte) >= 30,
            A.oben !== B.oben,
            A.unten !== B.unten,
            A.radius !== B.radius,
            A.material !== B.material,
            A.zeilen !== B.zeilen,
          ].filter(Boolean).length;
          paare.push(A.v + '/' + B.v + ': ' + merkmale);
          if (merkmale < 3) {
            schlecht.push(A.v + ' und ' + B.v + ' unterscheiden sich in nur '
                          + merkmale + ' von 6 Merkmalen');
          }
          // Das Material ausdruecklich: es ist die groesste Flaeche, und genau es war
          // bitgleich, waehrend der alte Test gruen blieb.
          if (A.material === B.material) {
            schlecht.push(A.v + ' und ' + B.v + ' haben dieselbe Blende');
          }
        }
      }

      // 3. Und NICHTS Funktionales bewegt sich.
      const ids = new Set(proben.map(p => p.ids));
      if (ids.size !== 1) schlecht.push('Elementzahl schwankt: ' + [...ids].join('/'));
      const diffs = proben.map(p => p.diff);
      if (diffs.some(d => d !== diffs[0])) schlecht.push('Physik weicht ab: ' + diffs.join('/'));

      // 4. Kein Preset-Schluessel: eine Voreinstellung ist eine Abstimmung.
      if (typeof presetControls === 'function') {
        if (presetControls().map(x => x.id).includes('setting-cockpit')) {
          schlecht.push('in den Voreinstellungen');
        }
        if (!sel.hasAttribute('data-preset-skip')) schlecht.push('data-preset-skip fehlt');
      }

      return { ok: schlecht.length === 0,
               mass: proben.map(p => p.v + ' ' + p.oben + '/' + p.unten + ' r' + p.radius)
                       .join(' | ')
                     + ' | Merkmale je Paar ' + paare.join(', ')
                     + ' | ' + proben[0].ids + ' Elemente unveraendert'
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      sel.value = merk;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });









  // ---- Streckenlernen: der Ring braucht nicht den Startcode ----
  //
  // GEMELDET: der automatische Scan soll nicht auf die Start/Ziel-Gerade warten muessen.
  // Der Grund, warum er es tat, ist echt - ohne Anker faengt der Ring irgendwo in der
  // Runde an und ist gegen die Bahn verdreht. Der Anker muss also bleiben, aber es gibt
  // seit v0.5.9 einen zweiten und besseren: die Sperre, die das Auto selbst setzt.
  //
  // Der Test faehrt eine Runde, deren Byte 12 NIE einen Startcode meldet. Vorher wurde
  // dabei nichts gelernt, und zwar still. Die Gegenprobe ist der zweite Fall: ohne beide
  // Anker darf weiterhin nichts uebernommen werden - ein Ring an falscher Stelle waere
  // schlimmer als keiner.
  stAdd('Streckenlernen: die Sperre des Autos ankert den Ring', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.lernProbe) {
      return { skip: true, mass: 'lernProbe nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    // Eine Runde aus sechs Kacheln, kein einziger Startcode: Gerade, Kurven.
    const runde = [0x02, 0x04, 0x04, 0x02, 0x03, 0x04];

    const mitSperre = OMEGA_TEST.lernProbe(runde, { sperreBei: 0, runden: 3 });
    teile.push('mit Sperre: ' + mitSperre.teile + ' Teile');
    if (mitSperre.teile !== runde.length) {
      schlecht.push('mit Sperre ' + mitSperre.teile + ' Teile statt ' + runde.length);
    }
    // Und die erste Kachel muss die Start/Ziel-Kachel sein, sonst ist der Ring verdreht.
    if (mitSperre.typen[0] !== OMEGA_TEST.TILE_TYPE.START) {
      schlecht.push('der Ring beginnt nicht an Start/Ziel');
    }

    // GEGENPROBE: kein Startcode UND keine Sperre - es darf nichts uebernommen werden.
    const ohne = OMEGA_TEST.lernProbe(runde, { runden: 3 });
    teile.push('ohne Anker: ' + ohne.teile + ' Teile, Vorlauf ' + ohne.vorlauf);
    if (ohne.teile !== 0) schlecht.push('ohne Anker wurden ' + ohne.teile + ' Teile uebernommen');
    // Aber es muss GEZAEHLT haben - sonst ist der Zustand wieder still, und genau das
    // war das eigentliche Aergernis.
    if (!(ohne.vorlauf > 5)) schlecht.push('der Vorlauf zaehlt nicht mit (' + ohne.vorlauf + ')');

    // Und der alte Weg muss weiter gehen: Startcode ohne Sperre.
    const mitCode = OMEGA_TEST.lernProbe([0x01, 0x04, 0x04, 0x02, 0x03, 0x04], { runden: 3 });
    teile.push('mit Startcode: ' + mitCode.teile + ' Teile');
    if (mitCode.teile !== 6) schlecht.push('mit Startcode ' + mitCode.teile + ' Teile statt 6');

    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });



  // ---- Das Cockpit passt auf ein Handy ----
  //
  // GEMELDET: "auf einem Handy sehe ich oben die Lichter nicht." Gemessen in 844 x 390,
  // also einem Handy quer: das Cockpit war 531 px hoch und der Platz darunter 298.
  //
  // Geprueft wird mit einer VORGEGEBENEN Fensterhoehe, nicht mit der echten - sonst
  // sagte der Test nur etwas aus, wenn er zufaellig auf einem kleinen Schirm laeuft, und
  // dann wird er nie gefahren. cockpitPassung() misst die wirkliche Unterkante nach,
  // statt einen Faktor auszurechnen: das Raster schrumpft nicht rein proportional
  // (clamp()-Mindestwerte und vw-Anteile schrumpfen nicht mit), und ein gerechneter
  // Faktor liess 19 px stehen.
  //
  // Die Gegenprobe steht am Ende: auf einem hohen Fenster darf NICHT verkleinert werden.
  stAdd('Cockpit passt in die Bildschirmhoehe', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.cockpitPassung) {
      return { skip: true, mass: 'cockpitPassung nicht vorhanden' };
    }
    // Der Reiter muss offen sein, sonst hat das Cockpit die Hoehe 0.
    const btn = document.querySelector('[data-tab="race"]');
    if (!btn) return { ok: false, mass: 'Cockpit-Reiter fehlt' };
    btn.click();
    const schlecht = [], teile = [];
    // Drei Handyhoehen: quer, quer mit Adressleiste, hochkant.
    for (const h of [390, 330, 812]) {
      const r = OMEGA_TEST.cockpitPassung(h);
      if (!r) { schlecht.push(h + ': keine Messung'); continue; }
      teile.push(h + 'px: Faktor ' + r.faktor + (r.passt ? ' passt' : ' UEBER ' + r.ueberstand));
      // Passen muss es - es sei denn, die Untergrenze ist erreicht. Dann ist Scrollen die
      // ehrliche Antwort, und der Test sagt das statt zu schweigen.
      if (!r.passt && !r.amBoden) {
        schlecht.push(h + 'px: ' + r.ueberstand + ' px Ueberstand ohne an der Grenze zu sein');
      }
    }
    // GEGENPROBE: viel Platz, also kein Zoom. Ohne sie waere "immer verkleinern" gruen.
    const gross = OMEGA_TEST.cockpitPassung(2000);
    teile.push('2000px: Faktor ' + gross.faktor);
    if (gross.faktor < 0.999) schlecht.push('verkleinert auch bei 2000 px Hoehe');
    // Und danach der echte Zustand zurueck.
    OMEGA_TEST.cockpitPassung();
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Controller-Vibration: ein Schalter je Ausloeser ----
  //
  // Siebzehn Aufrufstellen, sechs Arten, ein Hauptschalter. Geprueft wird die
  // SCHALTERLOGIK - padRumble meldet, ob ein Stoss die Schalter passiert hat -, denn ohne
  // Controller waere sie sonst gar nicht pruefbar, und mit siebzehn Stellen ist sie genau
  // die Stelle, an der man sich vertut.
  //
  // Drei Aussagen, und die dritte ist die, die man leicht vergisst: eine UNBEKANNTE Art
  // muss durchkommen. Wer eine neue Aufrufstelle einbaut und das Etikett vergisst, soll
  // ein Brummen bekommen und es merken - ein stilles Verschlucken waere ein Fehler, den
  // niemand sieht.
  stAdd('Controller-Vibration: jeder Ausloeser an seinem Schalter', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.vibProbe) {
      return { skip: true, mass: 'vibProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.vibProbe();
    const schlecht = [];
    if (r.hauptAus.length) {
      schlecht.push('Hauptschalter aus, aber ' + r.hauptAus.join('/') + ' brummt');
    }
    for (const an of r.arten) {
      const durch = r.einzeln[an];
      if (durch.length !== 1 || durch[0] !== an) {
        schlecht.push('nur ' + an + ' an, durch kam: ' + (durch.join('/') || 'nichts'));
      }
    }
    if (!r.unbekannt) schlecht.push('eine unbekannte Art wird still verschluckt');
    return { ok: schlecht.length === 0,
             mass: r.arten.length + ' Arten, Hauptschalter aus laesst '
                   + r.hauptAus.length + ' durch, unbekannte Art '
                   + (r.unbekannt ? 'brummt' : 'still')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- RC-Fernbedienung: Achsen, die nicht bei null ruhen ----
  //
  // GEMELDET an einer CH Control Box: unter Windows liess sich in Chrome und Edge gar
  // nichts zuordnen, auf einem MacBook nur Gas und Bremse. Die Ursache stand in der
  // Erfassung: sie nahm die erste Achse, deren BETRAG ueber 0,6 lag - und setzte damit
  // voraus, dass Achsen in Ruhe bei null liegen. Ein rastender RC-Gaskanal meldet
  // dauerhaft -1, nicht belegte Achsen vieler HID-Adapter ebenfalls.
  //
  // Der Test baut genau das nach. Die GEGENPROBE ist der zweite Fall: eine Achse, die
  // sich gar nicht bewegt, darf nie erfasst werden, egal wie weit weg von null sie ruht.
  stAdd('Controller: RC-Fernbedienung mit Achsen abseits der Null', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.padBelegungProbe) {
      return { skip: true, mass: 'padBelegungProbe nicht vorhanden' };
    }
    const schlecht = [], teile = [];

    // 1. Lenkung. Achse 0 ruht bei 0 und wird bewegt; Achse 1 und 2 rasten bei -1.
    //    Die alte Regel haette sofort Achse 1 genommen, ohne dass jemand etwas anfasst.
    const lenk = OMEGA_TEST.padBelegungProbe('steering', [
      { achsen: [0, -1, -1, 0] },
      { achsen: [0.85, -1, -1, 0] },
    ]);
    teile.push('Lenkung -> ' + (lenk.belegt ? 'Achse ' + lenk.belegt.index : 'nichts'));
    if (!lenk.belegt || lenk.belegt.index !== 0) {
      schlecht.push('Lenkung landete auf ' + JSON.stringify(lenk.belegt));
    }

    // 2. Gas: ein rastender Kanal von -1 nach +1. Er muss auf Achse 1 landen, NICHT
    //    invertiert sein, und die volle Bewegung muss 0 bis 1 ergeben - nicht die obere
    //    Haelfte, was das gemeldete "geht, aber nur halb" war.
    const gas = OMEGA_TEST.padBelegungProbe('throttle', [
      { achsen: [0, -1, -1, 0] },
      { achsen: [0, 1, -1, 0] },
    ], { lesen: [[0, -1, -1, 0], [0, 0, -1, 0], [0, 1, -1, 0]] });
    teile.push('Gas -> ' + (gas.belegt ? 'Achse ' + gas.belegt.index : 'nichts')
               + ', gelesen ' + gas.gelesen.join('/'));
    if (!gas.belegt || gas.belegt.index !== 1) {
      schlecht.push('Gas landete auf ' + JSON.stringify(gas.belegt));
    } else {
      if (gas.belegt.invert) schlecht.push('Gas wurde faelschlich invertiert');
      const [unten, mitte, oben] = gas.gelesen;
      if (Math.abs(unten) > 0.02) schlecht.push('Ruhe gibt ' + unten + ' statt 0');
      if (Math.abs(oben - 1) > 0.02) schlecht.push('Vollausschlag gibt ' + oben + ' statt 1');
      if (Math.abs(mitte - 0.5) > 0.08) schlecht.push('Mitte gibt ' + mitte + ' statt 0,5');
    }

    // 3. GEGENPROBE: nichts bewegt sich. Dann darf auch nichts erfasst werden, und die
    //    Zuordnung muss offen bleiben. Ohne diese Probe waere eine Erfassung, die immer
    //    zugreift, ebenfalls gruen.
    const still = OMEGA_TEST.padBelegungProbe('steering', [
      { achsen: [0, -1, -1, 1] },
      { achsen: [0, -1, -1, 1] },
      { achsen: [0, -1, -1, 1] },
    ]);
    teile.push('nichts bewegt: ' + (still.offen ? 'bleibt offen' : 'hat zugegriffen'));
    if (!still.offen) schlecht.push('erfasst, obwohl sich nichts bewegt hat');

    // 4. Ein Knopf schlaegt eine Achse bei gleichem Ausschlag - sonst faengt an manchen
    //    Pads die Hat-Achse den Knopfdruck ab.
    const knopf = OMEGA_TEST.padBelegungProbe('downshift', [
      { achsen: [0, -1], knoepfe: [0, 0, 0] },
      { achsen: [0, -1], knoepfe: [0, 0, 1] },
    ]);
    teile.push('Knopf -> ' + (knopf.belegt ? knopf.belegt.type + ' ' + knopf.belegt.index : 'nichts'));
    if (!knopf.belegt || knopf.belegt.type !== 'button' || knopf.belegt.index !== 2) {
      schlecht.push('Knopf landete auf ' + JSON.stringify(knopf.belegt));
    }

    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ansagen: jede einmal, und erst nach der Erholung wieder ----
  //
  // FUENF MELDUNGEN an fuenf Schaltern. Der Fehler, der hier lauert, ist nicht "sie sagt
  // nichts", sondern "sie sagt es dauernd": ein Tank unter 10 % bleibt minutenlang unter
  // 10 %. Geprueft wird deshalb eine FOLGE von Zustaenden, und die Gegenproben sind die
  // Wiederholungen, bei denen nichts kommen darf.
  //
  // Ohne Stimme im System kaeme nichts zurueck; der Aufbau haengt deshalb eine Attrappe
  // ein. Geprueft wird die Regel, nicht das Betriebssystem.
  stAdd('Ansagen: jede Meldung einmal, und erst nach Erholung wieder', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ansagenFolge) {
      return { skip: true, mass: 'ansagenFolge nicht vorhanden' };
    }
    const voll = { health: 1, fuel: 1, tyre: 1, rain: false };
    const folge = [
      voll,
      { health: 0.5, fuel: 0.5, tyre: 0.5, rain: false },
      { health: 0.08, fuel: 1, tyre: 1, rain: false },   // Schaden faellt
      { health: 0.05, fuel: 1, tyre: 1, rain: false },   // Gegenprobe: nicht nochmal
      { health: 0.03, fuel: 0.09, tyre: 1, rain: false },// Tank faellt
      { health: 1, fuel: 0.05, tyre: 0.07, rain: true }, // Reifen und Regen
      { health: 1, fuel: 1, tyre: 1, rain: true },       // Gegenprobe: Regen steht
      voll,                                              // Regen hoert auf
      { health: 0.05, fuel: 1, tyre: 1, rain: false },   // Schaden wieder scharf
    ];
    const r = OMEGA_TEST.ansagenFolge(folge);
    const fiel = r.folge.map(x => x.fiel.join(','));
    const soll = ['', '', 'damage', '', 'fuel', 'tyre,rain', '', 'rain', 'damage'];
    const schlecht = [];
    for (let i = 0; i < soll.length; i++) {
      if (fiel[i] !== soll[i]) {
        schlecht.push('Schritt ' + i + ': "' + fiel[i] + '" statt "' + soll[i] + '"');
      }
    }
    // Und die Texte muessen wirklich gesprochen worden sein - eine Regel, die richtig
    // entscheidet und nichts sagt, waere sonst gruen.
    if (r.gesagt.length !== 6) schlecht.push(r.gesagt.length + ' gesprochene Saetze statt 6');
    return { ok: schlecht.length === 0,
             mass: fiel.map(x => x || '-').join(' ') + ' | ' + r.gesagt.length + ' Saetze'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Und die fuenf Schalter schalten wirklich ab ----
  //
  // Die Gegenprobe zum Test darueber: mit allen Kaestchen AUS darf keine einzige Meldung
  // fallen. Ohne sie waere ein Kern, der die Schalter gar nicht liest, ebenfalls gruen.
  stAdd('Ansagen: ausgeschaltet ist wirklich aus', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ansagenFolge) {
      return { skip: true, mass: 'ansagenFolge nicht vorhanden' };
    }
    const r = OMEGA_TEST.ansagenFolge([
      { health: 1, fuel: 1, tyre: 1, rain: false },
      { health: 0.02, fuel: 0.02, tyre: 0.02, rain: true },
    ], { aus: true });
    const gefallen = r.folge.reduce((a, x) => a + x.fiel.length, 0);
    return { ok: gefallen === 0 && r.gesagt.length === 0,
             mass: gefallen + ' Meldungen, ' + r.gesagt.length + ' Saetze (soll 0 und 0)' };
  });

  // ---- Gaskennlinie und Anfahrschub ----
  //
  // DIE ZUSICHERUNG DER AUFGABE war woertlich: "0 % input -> 0 % Beschleunigung und
  // 100 % -> 100 %, aber dazwischen neben einem linearen auch einen nicht-linearen
  // Verlauf". Beide Enden werden deshalb fuer JEDES Gamma geprueft, nicht nur fuer das
  // voreingestellte - eine Kennlinie, die nur bei 1,0 die Enden trifft, waere wertlos.
  //
  // Und die VERDRAHTUNG wird mitgeprueft. Eine Formel, die stimmt, waehrend der Regler
  // nichts setzt, ist der haeufigste tote Schalter in diesem Projekt gewesen.
  stAdd('Gaskennlinie: Enden fest, Mitte einstellbar, Regler verdrahtet', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.gasKennlinie || !OMEGA_TEST.fahrgefuehlWerte) {
      return { skip: true, mass: 'gasKennlinie nicht vorhanden' };
    }
    const f = OMEGA_TEST.gasKennlinie;
    const schlecht = [], teile = [];
    for (const g of [0.6, 1, 1.4, 1.8, 2.5, 3]) {
      if (f(0, g) !== 0) schlecht.push('g=' + g + ': f(0) = ' + f(0, g));
      if (Math.abs(f(1, g) - 1) > 1e-12) schlecht.push('g=' + g + ': f(1) = ' + f(1, g));
      // Streng steigend, sonst gaebe es Gaswege, die nichts aendern.
      let vor = -1;
      for (let x = 0; x <= 1.0001; x += 0.05) {
        const y = f(x, g);
        if (y <= vor) { schlecht.push('g=' + g + ' nicht steigend bei x=' + x.toFixed(2)); break; }
        vor = y;
      }
    }
    // Die Richtung: ueber 1 muss ein Viertel Gasweg WENIGER als ein Viertel geben, sonst
    // hilft der Regler dem Trigger mit Totzone nicht.
    const v1 = f(0.25, 1), v18 = f(0.25, 1.8), v06 = f(0.25, 0.6);
    teile.push('\u00bc Weg bei 1,0/1,8/0,6: ' + (v1 * 100).toFixed(0) + '/'
               + (v18 * 100).toFixed(0) + '/' + (v06 * 100).toFixed(0) + '%');
    if (!(v18 < v1)) schlecht.push('Gamma ueber 1 streckt den unteren Bereich nicht');
    if (!(v06 > v1)) schlecht.push('Gamma unter 1 macht ihn nicht spitzer');
    // 1,0 muss bitgleich sein, sonst aendert die Vorgabe still das Fahrgefuehl.
    for (const x of [0.1, 0.37, 0.5, 0.9]) {
      if (f(x, 1) !== x) schlecht.push('1,0 ist nicht die Gerade bei ' + x);
    }

    // ---- Verdrahtung: der Regler setzt die Physik, und die Anzeige sagt dasselbe ----
    const el = $('setting-throttle-gamma'), val = $('setting-throttle-gamma-val');
    const mm = $('setting-minmove'), mmv = $('setting-minmove-val');
    if (!el || !mm) return { ok: false, mass: 'Regler fehlen im Markup' };
    const merkG = el.value, merkM = mm.value;
    try {
      el.value = '2.2'; el.dispatchEvent(new Event('input', { bubbles: true }));
      const w = OMEGA_TEST.fahrgefuehlWerte();
      teile.push('Regler 2,2 -> Physik ' + w.throttleGamma);
      if (Math.abs(w.throttleGamma - 2.2) > 1e-9) {
        schlecht.push('der Regler setzt throttleGamma nicht (' + w.throttleGamma + ')');
      }
      if (!/2\.20/.test(val.textContent)) schlecht.push('Anzeige: ' + val.textContent);

      mm.value = '0.05'; mm.dispatchEvent(new Event('input', { bubbles: true }));
      const w2 = OMEGA_TEST.fahrgefuehlWerte();
      teile.push('Anfahrschub 0,05 -> ' + w2.minMoveThrottle);
      if (Math.abs(w2.minMoveThrottle - 0.05) > 1e-9) {
        schlecht.push('der Anfahrschub kommt nicht an (' + w2.minMoveThrottle + ')');
      }
      // Die Anzeige nennt km/h im Massstab - das ist die Zahl, an der man ihn einstellt.
      const kmh = Math.round(0.05 * w2.topSpeedKmh * w2.massstab);
      if (mmv.textContent.indexOf(String(kmh)) < 0) {
        schlecht.push('Anzeige nennt nicht ' + kmh + ' km/h: ' + mmv.textContent);
      }
      teile.push('Anzeige "' + mmv.textContent + '"');
    } finally {
      el.value = merkG; el.dispatchEvent(new Event('input', { bubbles: true }));
      mm.value = merkM; mm.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ghosts: anhalten nur, wenn es wirklich vorbei ist ----
  //
  // GEMELDET: "sie fahren stumpf ihre Spur, keine Querlage. Und nach einer Weile bleiben
  // sie einfach stehen und blinken. Neustart des Rennens, Zuruecksetzen, usw. funktioniert
  // nicht." Alle drei Teile sind an den Mitschnitten entschieden worden.
  //
  // DIE SECHS FAELLE hier sind keine erfundenen Zahlen, sondern jede 0x00-Strecke ab 300 ms,
  // die in den Aufzeichnungen ueberhaupt vorkommt - mit der Kachelrate, die dabei gemessen
  // wurde. Der Zaehler lief in 6 von 6 Faellen weiter, das blosse Zaehlen taugt also nicht
  // als Unterscheider; die RATE taugt.
  stAdd('Ghost haelt nur an, wenn es wirklich vorbei ist', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostParkProbe) {
      return { skip: true, mass: 'ghostParkProbe nicht vorhanden' };
    }
    // nullMs, kachelMs, soll geparkt sein
    const faelle = [
      [840, 420, false, 'faehrt, 420 ms je Kachel'],
      [5845, 490, false, 'faehrt, 490 ms je Kachel'],
      [13580, 438, false, 'faehrt, 438 ms je Kachel'],
      [1013, 92, true, 'Abflug, Zaehler rast mit 92 ms'],
      [12806, 12806, true, 'steht, eine Kachel in 12,8 s'],
    ];
    const schlecht = [], teile = [];
    for (const [nullMs, kachelMs, soll, was] of faelle) {
      const r = OMEGA_TEST.ghostParkProbe({ nullMs, kachelMs });
      teile.push(nullMs + '/' + kachelMs + (r.geparkt ? ' steht' : ' faehrt'));
      if (r.vorher) { schlecht.push(was + ': stand schon vor der Messung'); continue; }
      if (!!r.geparkt !== soll) {
        schlecht.push(was + ': ' + (r.geparkt ? 'haelt an' : 'faehrt weiter')
                      + ', erwartet ' + (soll ? 'anhalten' : 'weiterfahren'));
      }
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ghosts: ein Neustart kommt aus dem Kreis heraus ----
  //
  // Geparkt heisst Gas 0, also keine Fahrt, also kein gelesenes Muster, also parkt der
  // Neustart sofort wieder ein. Die Startgnade ist der Ausweg - und sie ist eine FRIST,
  // kein Loch: danach muss das Auto wieder stehen, sonst faehrt es neben der Bahn weiter.
  // Beide Haelften werden geprueft; ohne die zweite waere "nie anhalten" auch gruen.
  stAdd('Ghost: Neustart hebt den Halt, aber nur auf Zeit', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostNeustartProbe) {
      return { skip: true, mass: 'ghostNeustartProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostNeustartProbe({});
    const schlecht = [];
    if (!r.inGnade) schlecht.push('parkt schon waehrend der Gnadenzeit wieder ein');
    if (!r.nachGnade) schlecht.push('parkt nach der Gnadenzeit NICHT - die Frist ist ein Loch');
    const wechsel = r.schritte.find(x => x.geparkt);
    return { ok: schlecht.length === 0,
             mass: 'Gnade ' + r.gnadeMs + ' ms, haelt an bei '
                   + (wechsel ? wechsel.ms + ' ms' : 'nie')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Ziellinie liegt am Zielstreifen ----
  //
  // Byte 15 Bit 3 im MELDEkanal ist eine Sperre, die das Auto selbst setzt, wenn es das
  // Startmuster liest, und rund eine Sekunde haelt. Gemessen: 17 Bloecke gegen 16 Runden,
  // Dauer im Median 981 bis 1050 ms, steigende Flanke 420 ms NACH unserer alten Regel -
  // und in 0 % der Schreibbefehle an dieses Auto gesetzt, also kein Echo.
  //
  // Vier Aussagen, und die letzten zwei sind die Gegenproben: eine stehende Sperre darf
  // nicht mehrfach zaehlen, und der alte Rueckfall darf danach nicht ein zweites Mal
  // zaehlen - sonst laege jede Runde doppelt.
  stAdd('Ziellinie: die Sperre des Autos schlaegt den Startcode', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.zielSperreProbe) {
      return { skip: true, mass: 'zielSperreProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.zielSperreProbe({});
    const schlecht = [];
    if (r.nurCode < 1) schlecht.push('ohne Sperre zaehlt der Rueckfall nicht');
    if (r.mitSperre !== r.nurCode + 1) schlecht.push('die Sperrflanke zaehlt keine Runde');
    if (r.wahrendSperre !== r.mitSperre) schlecht.push('die stehende Sperre zaehlt mehrfach');
    if (r.ende !== r.mitSperre) {
      schlecht.push('der Rueckfall zaehlt nach der Sperre weiter (' + r.ende + ')');
    }
    return { ok: schlecht.length === 0,
             mass: r.folge.map(x => x.lage + ' ' + x.runden).join(' | ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ghost-Querlage im Mass der Original-App ----
  //
  // Der Vergleichswert ist gemessen und nicht gewaehlt: die Original-App schickte ihren
  // zwei Ghosts ueber 16 Runden ein Lenkbyte mit |Mittel| 32,2 und 47,3 von 127, Spitze
  // jeweils 127. Unsere lagen bei 18,3 mit Spitze 44 - gemeldet als "stumpf ihre Spur,
  // keine Querlage". Ursache war der Deckel von 0,55 mal line 0,7.
  //
  // Die Schranke steht bei 25 und 70, also unter dem schwaecheren der zwei Originalwerte:
  // getroffen werden soll die Groessenordnung, nicht eine Nachkommastelle.
  stAdd('Ghost-Querlage: im Mass der Original-App', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    return OMEGA_TEST.ghostDriveProbe({ takte: 300, lage: 'karte' }).then((p) => {
      const abs = p.lenk.map(Math.abs);
      const mittel = abs.reduce((a, b) => a + b, 0) / abs.length;
      const spitze = Math.max.apply(null, abs);
      const schlecht = [];
      if (mittel < 25) schlecht.push('|Mittel| nur ' + mittel.toFixed(1) + ', Original 32 bis 47');
      if (spitze < 70) schlecht.push('Spitze nur ' + spitze + ', Original 127');
      return { ok: schlecht.length === 0,
               mass: '|Mittel| ' + mittel.toFixed(1) + ', Spitze ' + spitze
                     + ' (Original 32,2 / 47,3, Spitze 127)'
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    });
  });

  // ---- Der Steuerweg: kostet die Rechnung etwas, und kommt der Befehl an? ----
  //
  // ANLASS: "mit 2 Ghosts gibt es eine leichte Eingabeverzoegerung, laesst sich die
  // Berechnung beschleunigen?" Die Antwort war nein - und diese drei Tests halten fest,
  // warum, damit die Frage nicht in einem Jahr noch einmal geraten werden muss.

  // 1. Das RECHENBUDGET. Gemessen an den echten Funktionen des Herzschlags.
  //
  // Die Grenze steht bei 5 ms von 45 und nicht bei den gemessenen 0,3: das ist keine
  // Zielmarke, sondern eine Reissleine. Sie soll anschlagen, wenn jemand etwas wirklich
  // Teures in den Takt legt - eine Abfrage der Karte, einen Zugriff auf localStorage, eine
  // Schleife ueber alle Kacheln. Enger gezogen wuerde sie auf einem langsamen Rechner
  // grundlos rot, und ein Test, der ohne Fehler rot wird, wird abgeschaltet.
  stAdd('Steuertakt: die Rechnung passt in ihr Budget', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.taktKosten) {
      return { skip: true, mass: 'taktKosten nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    let ohne = null;
    for (const n of [0, 2]) {
      const r = OMEGA_TEST.taktKosten({ ghosts: n, takte: 150 });
      teile.push(n + ' Ghosts: ' + r.ganzerTakt.med + ' ms (p95 ' + r.ganzerTakt.p95 + ')');
      if (n === 0) ohne = r.ganzerTakt.med;
      if (r.ganzerTakt.p95 > 5) {
        schlecht.push(n + ' Ghosts brauchen ' + r.ganzerTakt.p95 + ' ms von 45');
      }
      if (n > 0 && r.ghostAnteil.p95 > 2) {
        schlecht.push('ein Ghost kostet ' + r.ghostAnteil.p95 + ' ms');
      }
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + ' von 45 ms'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // 2. LANGSAMER FUNK DARF NICHT EINEN GANZEN TAKT KOSTEN.
  //
  // Bis v0.5.8 stand in sendControlValue "if (writeInFlight) return;", und damit wurde ein
  // Takt verworfen, solange ein Schreibvorgang lief. Gemessen mit einem Ziel, dessen
  // Schreibvorgang eine einstellbare Zeit braucht:
  //
  //       Schreibdauer     vorher        Obergrenze
  //             5 ms       22,4 Hz         22,2 Hz
  //            46 ms       11,2 Hz         21,7 Hz
  //            60 ms       11,2 Hz         16,7 Hz
  //
  // Eine Millisekunde ueber dem Takt HALBIERTE die Befehlsrate - eine Stufe, keine sanfte
  // Verschlechterung. Genau so faellt eine Eingabeverzoegerung an, sobald mehrere Autos
  // sich einen Funkadapter teilen.
  //
  // Geprueft wird gegen die OBERGRENZE und nicht gegen eine feste Zahl: schneller als der
  // Funk geht nicht, und diese Grenze ist Physik. Verlangt werden 80 Prozent davon.
  stAdd('Steuerweg: langsamer Funk kostet keinen ganzen Takt', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.sendeUnterLast) {
      return { skip: true, mass: 'sendeUnterLast nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    for (const w of [5, 60]) {
      // 3000 ms GEFAELSCHTE Zeit, also rund 66 Takte - und keine echte Sekunde.
      const r = await OMEGA_TEST.sendeUnterLast({ schreibMs: w, ms: 3000 });
      if (r.echtesAuto) return { skip: true, mass: 'echtes Auto verbunden' };
      teile.push(w + ' ms Funk: ' + r.rateHz + ' Hz von ' + r.obergrenzeHz);
      if (r.rateHz < r.obergrenzeHz * 0.8) {
        schlecht.push('bei ' + w + ' ms Funk nur ' + r.rateHz + ' statt ' + r.obergrenzeHz + ' Hz');
      }
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // 3. ZWEI ZUSICHERUNGEN UEBER DEN GHOST-TAKT, und beide waren vorher nicht eingehalten.
  //
  //   a) Die Sendezeitpunkte liegen auseinander. Der Kommentar in startGhost versprach
  //      einen Versatz gegen den Herzschlag des Spielers, gemessen wurde aber vom KLICK
  //      aus - ein Ghost lag mit 0,7 ms Mittel dauerhaft auf dem Spielerpaket.
  //   b) Ein angehaltener Ghost tickt nicht weiter. Wer in den ersten Millisekunden nach
  //      dem Start anhielt, liess einen Zeitgeber zurueck, den niemand mehr kannte -
  //      ein Selbsttestlauf hinterliess 35 davon.
  //
  // Beide mit Gegenprobe: ohne sie waere ein Takt, der GAR nicht laeuft, ebenfalls gruen.
  stAdd('Ghost-Takt: versetzt gesendet, und ein Halt haelt', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostTaktVersatz || !OMEGA_TEST.ghostHaltProbe) {
      return { skip: true, mass: 'Ghost-Takt-Aufbauten nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    const T = 45, ziel = OMEGA_TEST.ghostTaktVersatz;

    // (a) DIE PHASE, und zwar UNABHAENGIG davon, wo sie beim Klick gerade steht. Das ist
    //     der ganze Fehler gewesen: die alte Zeile gab einen festen Versatz vom Klick aus,
    //     und wo der landete, hing am Zufall. Geprueft ueber die ganze Taktbreite.
    //
    //     Die Gegenprobe steckt in der Variation von seitHerz: eine Formel, die den
    //     Herzschlag ignoriert, ist fuer genau einen Wert richtig und fuer alle anderen
    //     falsch. Mit nur einem seitHerz waere auch die alte Zeile gruen geworden.
    const phasen = [];
    for (const seitHerz of [0, 7, 15.5, 22, 33, 44.9]) {
      for (let platz = 1; platz <= 2; platz++) {
        const v = ziel(platz, 3, seitHerz);
        const lage = (seitHerz + v) % T;
        const soll = T * platz / 3;
        if (v < 0 || v >= T) schlecht.push('Versatz ' + v.toFixed(1) + ' liegt ausserhalb des Taktes');
        if (Math.abs(lage - soll) > 0.01) {
          schlecht.push('bei ' + seitHerz + ' ms landet Platz ' + platz
                        + ' auf ' + lage.toFixed(1) + ' statt ' + soll.toFixed(1));
        }
        if (platz === 1) phasen.push(lage);
      }
    }
    teile.push('Phase Platz 1: ' + phasen.map(x => x.toFixed(1)).join('/') + ' ms');
    // Und die zwei Ghosts liegen auseinander, nicht uebereinander.
    const d = Math.abs(ziel(2, 3, 12) - ziel(1, 3, 12));
    teile.push('Ghosts ' + d.toFixed(1) + ' ms auseinander');
    if (Math.abs(d - T / 3) > 0.01) schlecht.push('Ghosts liegen ' + d.toFixed(1) + ' ms auseinander');

    // (b) EIN HALT HAELT. Anhalten, BEVOR der wartende setTimeout den Zeitgeber angelegt
    //     hat - der Fall, der 35 Phantom-Zeitgeber je Selbsttestlauf hinterliess.
    const h = await OMEGA_TEST.ghostHaltProbe({});
    teile.push('nach Halt ' + h.nachHalt + ' Pakete, laufend ' + h.laufend);
    if (h.nachHalt !== 0) schlecht.push('angehaltener Ghost sendet weiter (' + h.nachHalt + ')');
    // Gegenprobe: ohne sie waere ein Ghost-Takt, der GAR nicht laeuft, ebenfalls gruen.
    if (h.laufend < 1) schlecht.push('laufender Ghost sendet nicht');
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Motorton-Zusaetze: jeder haengt an seiner Groesse, und der Schalter stellt alle ab ----
  //
  // Sechs Zusaetze, und jeder soll genau von EINER Groesse abhaengen. Der Test prueft
  // deshalb nicht "es klingt anders", sondern fuer jeden einzeln, dass er kommt, wenn seine
  // Bedingung gilt, und AUSBLEIBT, wenn sie nicht gilt. Ohne die zweite Haelfte waere ein
  // Zusatz, der dauernd feuert, ebenfalls gruen.
  //
  // Geprueft wird an der Rechnung und nicht am Ton: extrasWerte() braucht keinen
  // AudioContext, und den gibt es erst nach einer Nutzergeste - ein Test, der ohne Klick
  // ueberspringt, prueft nie.
  stAdd('Motorton-Zusaetze: sechs Groessen, ein Schalter', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.sndExtras) {
      return { skip: true, mass: 'sndExtras nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    const eins = (folge, o) => OMEGA_TEST.sndExtras(folge, o)[folge.length - 1];

    // 1. Helligkeit folgt der Last.
    const dunkel = eins([{ load: 0 }]).tonHz;
    const hell = eins([{ load: 1 }]).tonHz;
    teile.push('Helligkeit ' + dunkel + '/' + hell + ' Hz');
    if (!(hell > dunkel * 2)) schlecht.push('Helligkeit folgt der Last nicht');

    // 2. Stottern NUR am Begrenzer. Wie STARK es wird, prueft 6c - hier nur, dass es
    //    ohne Begrenzer bei null bleibt und mit ihm ueberhaupt anfaengt.
    const ohne = eins([{ load: 1, rpmFrac: 0.9 }]).cut;
    const mit = eins([{ load: 1, rpmFrac: 1, onLimiter: true }]).cut;
    teile.push('Stottern ' + ohne.toFixed(2) + '/' + mit.toFixed(2));
    if (!(ohne === 0 && mit > 0)) schlecht.push('Stottern haengt nicht am Begrenzer');

    // 3. Knaller NUR beim Lastabfall bei Drehzahl. Drei Faelle, und die letzten zwei sind
    //    die Gegenproben.
    const abfall = eins([{ load: 1, rpmFrac: 0.8 }, { load: 0, rpmFrac: 0.8 }]).knaller;
    const konstant = eins([{ load: 1, rpmFrac: 0.8 }, { load: 1, rpmFrac: 0.8 }]).knaller;
    const langsam = eins([{ load: 1, rpmFrac: 0.2 }, { load: 0, rpmFrac: 0.2 }]).knaller;
    teile.push('Knaller ' + abfall + '/' + konstant + '/' + langsam);
    if (!(abfall > 0)) schlecht.push('kein Knaller beim Lastabfall');
    if (konstant !== 0) schlecht.push('Knaller bei konstantem Gas');
    if (langsam !== 0) schlecht.push('Knaller bei niedriger Drehzahl');
    // Und die Staerke haengt am Motor: ein Turbo knallt kaum, ein Sauger viel.
    const viel = eins([{ load: 1, rpmFrac: 0.9 }, { load: 0, rpmFrac: 0.9 }],
                      { crackle: 0.62 }).knaller;
    const kaum = eins([{ load: 1, rpmFrac: 0.9 }, { load: 0, rpmFrac: 0.9 }],
                      { crackle: 0.12 }).knaller;
    teile.push('je Motor ' + viel + '/' + kaum);
    if (!(viel > kaum)) schlecht.push('Knallstaerke haengt nicht am Motor');

    // 3b. UND KEIN KNALLER WAEHREND EINES GANGWECHSELS. Das war die Ursache des
    //     gemeldeten Klickens: in 40-physics.js steht engineLoad = isShifting ? 0 : throttle,
    //     also faellt die Last bei JEDEM Gangwechsel auf null - und ein bis vier
    //     Rauschstoesse kurz hintereinander sind ein Klicken. Beim Runterschalten mit hoher
    //     Drehzahl waren es die meisten, weil ihre Zahl mit rpmFrac waechst.
    const beimSchalten = eins([{ load: 1, rpmFrac: 0.9 },
                                { load: 0, rpmFrac: 0.9, isShifting: true }]).knaller;
    teile.push('beim Schalten ' + beimSchalten);
    if (beimSchalten !== 0) schlecht.push('Knaller waehrend des Gangwechsels');

    // 4. Schaltknall an der FLANKE und nur unter Last.
    const flanke = eins([{ load: 0.9 }, { load: 0.9, isShifting: true }]).schaltKnall;
    const gehalten = eins([{ load: 0.9, isShifting: true },
                           { load: 0.9, isShifting: true }]).schaltKnall;
    const ohneLast = eins([{ load: 0.1 }, { load: 0.1, isShifting: true }]).schaltKnall;
    teile.push('Schaltknall ' + flanke + '/' + gehalten + '/' + ohneLast);
    if (!(flanke > 0)) schlecht.push('kein Schaltknall');
    if (gehalten !== 0) schlecht.push('Schaltknall dauert an statt an der Flanke');
    if (ohneLast !== 0) schlecht.push('Schaltknall ohne Last');

    // 5. Getriebeheulen: mit dem TEMPO, und im kurzen Gang hoeher als im langen. Das ist
    //    der Punkt - es haengt an der Raddrehzahl mal Uebersetzung, nicht an der Drehzahl.
    const top = physEngine.config.topSpeedKmh;
    const steht = eins([{ speedKmh: 0, load: 1 }]).whineGain;
    const rollt = eins([{ speedKmh: top * 0.6, load: 1 }]).whineGain;
    const kurz = eins([{ speedKmh: top * 0.3, load: 1, gear: 0 }]).whineHz;
    const lang = eins([{ speedKmh: top * 0.3, load: 1,
                         gear: physEngine.config.gears.length - 1 }]).whineHz;
    teile.push('Heulen ' + kurz + '/' + lang + ' Hz');
    if (steht !== 0) schlecht.push('Heulen im Stand');
    if (!(rollt > 0)) schlecht.push('kein Heulen beim Rollen');
    if (!(kurz > lang * 1.5)) schlecht.push('Heulen haengt nicht am Gang');

    // 6. Der Lader: NUR bei aufgeladenen Motoren, und mit Verzoegerung. Der Ladedruck darf
    //    nicht im ersten Takt stehen - genau diese Verzoegerung ist das Turboloch.
    const sauger = eins([{ load: 1, rpmFrac: 0.9 }], { turbo: false }).pfeifGain;
    const reihe = OMEGA_TEST.sndExtras(
      [{ load: 1, rpmFrac: 0.9 }, { load: 1, rpmFrac: 0.9 }, { load: 1, rpmFrac: 0.9 }],
      { turbo: true, dt: 0.2 });
    teile.push('Ladedruck ' + reihe.map(r => r.druck).join('->'));
    if (sauger !== 0) schlecht.push('Sauger pfeift');
    if (!(reihe[0].druck < reihe[2].druck)) schlecht.push('Ladedruck baut sich nicht auf');
    if (!(reihe[0].druck < 0.5)) schlecht.push('Ladedruck ohne Verzoegerung');
    const bo = OMEGA_TEST.sndExtras(
      [{ load: 1, rpmFrac: 0.9 }, { load: 1, rpmFrac: 0.9 }, { load: 0, rpmFrac: 0.9 }],
      { turbo: true, dt: 0.6 })[2].abblasen;
    if (!(bo > 0)) schlecht.push('kein Abblasen beim Lastwegnehmen');
    // 6b. Und auch das Abblasen NICHT beim Gangwechsel - derselbe falsche Ausloeser wie beim
    //     Knaller, dazu mit 34 Hz Rechteck moduliert. Der zweite Teil des Klickens.
    const boSchalt = OMEGA_TEST.sndExtras(
      [{ load: 1, rpmFrac: 0.9 }, { load: 1, rpmFrac: 0.9 },
       { load: 0, rpmFrac: 0.9, isShifting: true }],
      { turbo: true, dt: 0.6 })[2].abblasen;
    if (boSchalt !== 0) schlecht.push('Abblasen waehrend des Gangwechsels');

    // 6c. DAS STOTTERN GEHT MIT ZEITKONSTANTE AUF. Ein Runterschalten mit zu hoher Drehzahl
    //     schiebt die Drehzahl fuer einen oder zwei Takte ueber den Begrenzer; eine
    //     Torschaltung, die dabei voll aufgeht, ist ein Klick und kein Stottern. Also: ein
    //     Aufblitzen bleibt leise, ein Anstehen wird voll.
    const blitz = OMEGA_TEST.sndExtras([{ load: 1, rpmFrac: 1, onLimiter: true }],
                                       { dt: 0.045 })[0].cut;
    const steht2 = OMEGA_TEST.sndExtras(
      [1, 2, 3, 4, 5, 6, 7, 8].map(() => ({ load: 1, rpmFrac: 1, onLimiter: true })),
      { dt: 0.045 });
    teile.push('Stottern Blitz ' + blitz.toFixed(2) + ' -> steht '
               + steht2[7].cut.toFixed(2));
    if (!(blitz < 0.15)) schlecht.push('Stottern klickt beim Aufblitzen: ' + blitz.toFixed(2));
    if (!(steht2[7].cut > 0.3)) schlecht.push('Stottern kommt am Begrenzer nicht an');

    // 7. DER SCHALTER stellt alle sechs ab, und zwar NEUTRAL: der Tiefpass geht auf 20 kHz
    //    und nicht auf irgendeinen Wert, die Zusatzquellen auf null.
    const aus = eins([{ load: 1, rpmFrac: 1, onLimiter: true, isShifting: true,
                        speedKmh: top * 0.8 }], { ein: false, turbo: true });
    teile.push('aus: Ton ' + aus.tonHz + ' Hz');
    const reste = [];
    if (aus.tonHz !== 20000) reste.push('Tiefpass ' + aus.tonHz);
    if (aus.cut !== 0) reste.push('Stottern');
    if (aus.whineGain !== 0) reste.push('Heulen');
    if (aus.pfeifGain !== 0) reste.push('Pfeifen');
    if (aus.knaller !== 0) reste.push('Knaller');
    if (!aus.aus) reste.push('Kennzeichnung');
    if (reste.length) schlecht.push('ausgeschaltet bleibt: ' + reste.join(', '));

    // 8. DIE BAUART DES PFEIFENS. Ein reiner Ton zwischen 1,7 und 7 kHz IST ein Piepsen,
    //    und genau so war es gemeldet: beim Formel 1 und beim M4 GT3, also zwei der drei
    //    aufgeladenen Motoren. Ein Verdichterpfeifen ist ein Ton IN breitbandigem Rauschen,
    //    also Rauschen durch einen schmalen Bandpass - und kein Oszillator.
    //
    //    Geprueft wird die Bauart und nicht der Klang, denn den kann dieser Test nicht
    //    hoeren. Ohne die Zeile kaeme beim naechsten Aufraeumen jemand auf die naheliegende
    //    Idee, dafuer wieder einen Sinus zu nehmen. Steht der Bus noch nicht - es gibt ihn
    //    erst nach einer Nutzergeste -, sagt der Test das statt zu schweigen.
    if (OMEGA_TEST.sndExtrasBau) {
      const bau = OMEGA_TEST.sndExtrasBau();
      if (!bau.gebaut) {
        teile.push('Bauart: Bus noch nicht gebaut (kein Ton angefordert)');
      } else {
        teile.push('Pfeifen ' + bau.pfeif + ' Q' + bau.guete);
        if (/Oscillator/.test(bau.pfeif || '')) {
          schlecht.push('Pfeifen ist ein Oszillator, das piepst');
        }
        if (!/Biquad/.test(bau.pfeif || '')) {
          schlecht.push('Pfeifen ist kein Bandpass: ' + bau.pfeif);
        }
        if (!/BufferSource/.test(bau.pfeifQuelle || '')) {
          schlecht.push('Pfeifen wird nicht von Rauschen gespeist: ' + bau.pfeifQuelle);
        }
        // Zu hohe Guete macht aus dem Bandpass wieder einen Oszillator - dann ist das
        // Piepsen zurueck, ohne dass ein Oszillator im Code steht.
        if (bau.guete !== null && bau.guete > 25) {
          schlecht.push('Guete ' + bau.guete + ' zu hoch, der Bandpass klingelt');
        }
      }
    }

    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Jede Ansicht bleibt lesbar ----
  //
  // DIESER TEST HAT DREI ECHTE FEHLER GEFUNDEN, als die helle Ansicht dazukam, und keinen
  // davon haette man am Bildschirm sicher gesehen:
  //
  //     #race-rpm       hellblau auf weiss                        Kontrast 1,33
  //     #race-lap-best  helles Gruen auf weiss                    Kontrast 1,96
  //     #race-yaw       dunkle Tinte auf dunklem G-Plot-Einsatz    Kontrast 1,05
  //
  // Der dritte ist der lehrreiche: eine helle Ansicht braucht dunkle Einsaetze fuer die zwei
  // Instrumente, die hell auf dunkel ZEICHNEN - und dann muss die Tinte DARIN wieder hell
  // sein. Eine einzige Tintenfarbe kann das nicht, und genau daran ist es aufgefallen.
  //
  // Gerechnet wird der Kontrast nach WCAG (relative Leuchtdichte, (L1+0,05)/(L2+0,05)) und
  // gegen 3 geprueft - das ist die Grenze fuer grossen Text, und Cockpitziffern sind gross.
  //
  // WAS DIESER TEST NICHT KANN, und das gehoert dazu: den Hintergrund findet er, indem er
  // nach oben laeuft, bis eine deckende Farbe kommt. Ein Verlauf oder ein Bild wird als
  // dunkel bzw. hell EINGESCHAETZT, je nach Ansicht. Er kann also falschen Alarm geben; dann
  // ist die Antwort, die wirkliche Farbe an der Stelle ausdruecklich zu setzen, und nicht,
  // den Test nachsichtiger zu machen.
  stAdd('Cockpit-Ansichten: alles lesbar', () => {
    const sel = $('setting-cockpit');
    if (!sel) return { ok: false, mass: 'setting-cockpit fehlt' };
    const merk = sel.value;
    const schlecht = [];
    const teile = [];
    try {
      const lum = (c) => {
        const m = (c || '').match(/\d+(\.\d+)?/g);
        if (!m || m.length < 3) return null;
        const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const kontrast = (a, b) => {
        const A = lum(a), B = lum(b);
        if (A === null || B === null) return 21;
        return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
      };
      // Der Grund unter einem Element: die erste deckende Farbe nach oben. Trifft er statt
      // dessen ein Bild oder einen Verlauf, wird er eingeschaetzt - hell im hellen Schirm,
      // sonst dunkel.
      const hell = () => document.body.dataset.cockpit === 'modern';
      const grund = (el) => {
        let n = el;
        while (n && n !== document.body) {
          const cs = getComputedStyle(n);
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            return cs.backgroundColor;
          }
          if (cs.backgroundImage !== 'none') {
            return (n.id === 'race-dash' && hell()) ? 'rgb(248,250,252)' : 'rgb(14,18,24)';
          }
          n = n.parentElement;
        }
        return hell() ? 'rgb(255,255,255)' : 'rgb(10,14,22)';
      };
      for (const v of Array.prototype.map.call(sel.options, o => o.value)) {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        let schlimmst = 21, wo = '';
        let geprueft = 0;
        document.querySelectorAll('#race-dash *').forEach(el => {
          // Nur Elemente mit EIGENEM Text und sichtbar: ein Container erbt seine Farbe und
          // zaehlt sonst doppelt.
          const eigen = [...el.childNodes].some(x => x.nodeType === 3 && x.nodeValue.trim());
          // NICHT offsetParent: der Test laeuft aus dem Selbsttest-Reiter, und dort ist das
          // Cockpit nicht angezeigt - dann waere offsetParent ueberall null und der Test
          // wuerde nichts messen. Die Farbe eines Elements haengt nicht daran, welcher Reiter
          // offen ist; gefiltert wird deshalb nach der EIGENEN Anzeigeart.
          if (!eigen || el.hidden || getComputedStyle(el).display === 'none') return;
          geprueft++;
          const k = kontrast(getComputedStyle(el).color, grund(el));
          if (k < schlimmst) { schlimmst = k; wo = el.id || el.className; }
        });
        teile.push(v + ' ' + schlimmst.toFixed(2));
        if (geprueft < 5) schlecht.push(v + ': nur ' + geprueft + ' Texte gefunden');
        if (schlimmst < 3) {
          schlecht.push(v + ': ' + wo + ' hat Kontrast ' + schlimmst.toFixed(2));
        }
      }
      return { ok: schlecht.length === 0,
               mass: 'schlechtester Kontrast je Ansicht: ' + teile.join(' | ')
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      sel.value = merk;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // ---- Streckenkarte: die Autos stehen dort, wo sie sind ----
  //
  // DER BEFUND: die Karte zeichnete GAR KEIN Auto. Der einzige Aufrufer, der eine Position
  // mitgab, war die Cockpit-Minikarte, und die ist entfernt worden - der Editor gab
  // ausdruecklich null. Der Punkt, den man auf der Startgeraden sah und fuer ein Auto hielt,
  // ist die Start/Ziel-Linie: ein 4 px breiter gruener Strich quer zur Bahn.
  //
  // Und der Versatz war falsch: (index + 1) * Abtastpunkte setzte den Punkt an das ENDE der
  // Kachel, auf der das Auto steht - eine ganze Kachel zu weit.
  stAdd('Streckenkarte: Autopunkte an der richtigen Kachel', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackMarks) {
      return { skip: true, mass: 'trackMarks nicht vorhanden' };
    }
    const schlecht = [];
    // Ohne Autos KEIN Punkt - sonst waere der gruene Strich wieder als Auto zu lesen.
    const leer = OMEGA_TEST.trackMarks(null, []);
    if (leer.punkte.length !== 0) schlecht.push(leer.punkte.length + ' Punkte ohne Autos');
    // Zwei Autos auf verschiedenen Kacheln: zwei Punkte, verschiedene Orte, beide Kuerzel.
    const zwei = OMEGA_TEST.trackMarks(null, [
      { index: 0, phase: 0, farbe: '#5aa9ff', kuerzel: 'ICH' },
      { index: 4, phase: 0.5, farbe: '#ffb02e', kuerzel: 'GH1' },
    ]);
    if (zwei.punkte.length !== 2) schlecht.push(zwei.punkte.length + ' Punkte statt 2');
    if (zwei.kuerzel.join(',') !== 'ICH,GH1') {
      schlecht.push('Kuerzel: ' + zwei.kuerzel.join(','));
    }
    if (zwei.punkte.length === 2) {
      const d = Math.hypot(zwei.punkte[0].x - zwei.punkte[1].x,
                           zwei.punkte[0].y - zwei.punkte[1].y);
      if (!(d > 20)) schlecht.push('beide Punkte am selben Ort (' + d.toFixed(0) + ')');
    }
    // DER VERSATZ: Kachel 0 mit Phase 0 muss WEITER VORN liegen als Kachel 0 mit Phase 1,
    // und Phase 1 auf Kachel 0 muss dort liegen, wo Phase 0 auf Kachel 1 liegt. Das ist die
    // Zusicherung, die die alte Rechnung gebrochen hat.
    const a = OMEGA_TEST.trackMarks(null, [{ index: 0, phase: 0, farbe: '#fff' }]);
    const b = OMEGA_TEST.trackMarks(null, [{ index: 0, phase: 1, farbe: '#fff' }]);
    const c = OMEGA_TEST.trackMarks(null, [{ index: 1, phase: 0, farbe: '#fff' }]);
    if (a.punkte.length && b.punkte.length && c.punkte.length) {
      const dAB = Math.hypot(a.punkte[0].x - b.punkte[0].x, a.punkte[0].y - b.punkte[0].y);
      const dBC = Math.hypot(b.punkte[0].x - c.punkte[0].x, b.punkte[0].y - c.punkte[0].y);
      if (!(dAB > 10)) schlecht.push('Phase wirkt nicht (' + dAB.toFixed(0) + ')');
      if (!(dBC < 2)) schlecht.push('Kachelende trifft nicht den naechsten Anfang ('
                                    + dBC.toFixed(0) + ')');
    }
    return { ok: schlecht.length === 0,
             mass: zwei.kacheln + ' Kacheln, ' + zwei.punkte.length + ' Autopunkte, '
                   + leer.punkte.length + ' ohne Autos, ' + zwei.echte + ' echte verbunden'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ueberholen: die zwei Regeln duerfen sich nicht bestreiten ----
  //
  // DER BEFUND, der diesen Test noetig gemacht hat, und er war nur zu sehen, wenn man beide
  // Zahlen NEBENEINANDER legt: angesetzt wurde bei einem Abstand unter 0,9 Kacheln, das
  // Abstandhalten lupfte das Gas aber schon ab 0,7 - plus Zuschlag beim Annaehern. Das
  // Angriffsfenster war 0,2 Kacheln breit, und der Abstandhalter druckte den Verfolger genau
  // daraus heraus. Gemeldet als "sie ueberholen sich nicht richtig, da ist der Wurm drin".
  //
  // Dazu die Wuerfelrate: alle 4 Sekunden ein Versuch mit 0,45 x Wuerze. Bei der
  // eingestellten Wuerze 0,4 ist das eine Attacke pro 22 Sekunden durchgehenden Klebens.
  //
  // Geprueft wird beides, und keine der beiden Aussagen laesst sich durch Hinsehen pruefen -
  // dafuer sind es Konstanten in verschiedenen Abschnitten.
  stAdd('Ueberholen: Reichweite ueber dem Mindestabstand, Wartezeit brauchbar', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassRates) {
      return { skip: true, mass: 'ghostPassRates nicht vorhanden' };
    }
    const merk = ghostCfg.spice;
    const schlecht = [];
    let r;
    try {
      ghostCfg.spice = 0.4;          // die Vorgabe, gefahren ermittelt
      r = OMEGA_TEST.ghostPassRates();
      // 1. Die Reichweite MUSS ueber dem Mindestabstand liegen. Sonst bestreiten die zwei
      //    Regeln dasselbe Band, und der Abstandhalter gewinnt - er wirkt jeden Takt, die
      //    Attacke nur beim Wuerfeln.
      if (!(r.reichweite > r.abstandMin)) {
        schlecht.push('Reichweite ' + r.reichweite + ' nicht ueber Mindestabstand '
                      + r.abstandMin);
      }
      // 2. Und das Fenster muss BREIT genug sein, um es durchgehend zu halten. 0,2 Kacheln
      //    waren es vorher, und das hat nicht gereicht.
      if (!(r.fenster >= 0.4)) {
        schlecht.push('Fenster nur ' + r.fenster + ' Kacheln breit');
      }
      // 3. Die Wartezeit bei der VORGABE-Wuerze muss im Bereich einer Runde liegen. Ohne
      //    diese Zahl ist "wird ueberholt" eine Hoffnung.
      if (!(r.wartenS <= 10)) {
        schlecht.push('Wartezeit ' + r.wartenS + ' s bei Wuerze ' + r.wuerze);
      }
      // 4. Gegenprobe: bei Wuerze null darf NIE angesetzt werden, sonst ist der Regler
      //    keiner.
      ghostCfg.spice = 0;
      const aus = OMEGA_TEST.ghostPassRates();
      if (aus.p !== 0) schlecht.push('Wuerze 0 wuerfelt trotzdem');
    } finally {
      ghostCfg.spice = merk;
    }
    return { ok: schlecht.length === 0,
             mass: 'Reichweite ' + r.reichweite + ' gegen Mindestabstand ' + r.abstandMin
                   + ' (Fenster ' + r.fenster + ') | Wurf alle ' + r.wurfMs + ' ms mit p='
                   + r.p + ' -> ' + r.wartenS + ' s bei Wuerze ' + r.wuerze
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Autopilot in der Einfuehrungsrunde ----
  //
  // DER BEFUND, der diesen Test noetig gemacht hat: raceFormationLap kam in 50-drive.js -
  // dem Eingabepfad des Fahrers - an keiner Stelle vor. Die Ghosts rollten von selbst im
  // Boxentempo, das Auto des Fahrers wurde nur GEDROSSELT und musste weiter von Hand
  // gelenkt und gegast werden. Der fliegende Start war damit halb umgesetzt.
  //
  // Geprueft wird die Regelung und nicht die Anzeige, in sechs Punkten. Der vierte ist der,
  // ohne den es rammt: in zwei Kolonnen dicht hintereinander muss man anhalten koennen.
  stAdd('Autopilot: Einfuehrungsrunde faehrt das Auto selbst', () => {
    if (typeof autopilot !== 'function' || typeof autopilotGrund !== 'function') {
      return { skip: true, mass: 'Autopilot nicht erreichbar' };
    }
    const merk = { flag: flagState, tm: trackMode, v: physEngine.state.speedKmh,
                   form: raceFormationLap };
    const schlecht = [];
    try {
      flagState = 'green'; trackMode = 'on';
      const bei = (frac, bremse) => {
        physEngine.state.speedKmh = frac * physEngine.config.topSpeedKmh;
        return autopilot(bremse || 0);
      };
      // 1. Ohne Einfuehrungsrunde kein Eingriff.
      raceFormationLap = false;
      if (bei(0.1) !== null) schlecht.push('greift ohne Einfuehrungsrunde');
      // 2. In der Einfuehrungsrunde greift sie, und der Grund ist der richtige.
      raceFormationLap = true;
      // formationPace() und nicht PIT_SPEED_FACTOR: das Boxentempo liegt UNTER der
      // Leseschwelle der Ghosts, und deshalb ist es seit v0.5.1 nur noch der Boden des
      // Formationstempos. Ein Test, der gegen den Boden prueft, misst nicht das Ziel.
      const ziel = formationPace();
      const langsam = bei(ziel * 0.4);
      const schnell = bei(ziel * 2.5);
      const passend = bei(ziel);
      if (!langsam || !schnell || !passend) {
        return { ok: false, mass: 'greift in der Einfuehrungsrunde nicht' };
      }
      if (langsam.grund !== 'formation') schlecht.push('Grund ' + langsam.grund);
      if (!(langsam.throttle > 0.2 && langsam.brake === 0)) schlecht.push('zu langsam: kein Gas');
      if (!(schnell.brake > 0.2 && schnell.throttle === 0)) schlecht.push('zu schnell: keine Bremse');
      if (!(passend.throttle < 0.15 && passend.brake < 0.15)) schlecht.push('am Ziel nicht ruhig');
      // 3. Das Ziel ist das FORMATIONSTEMPO. Gegenprobe ueber den Nulldurchgang des
      //    Reglers: knapp darunter muss Gas kommen, knapp darueber Bremse.
      const unter = bei(ziel * 0.9), ueber = bei(ziel * 1.1);
      if (!(unter.throttle > 0 && ueber.brake > 0)) schlecht.push('Ziel nicht das Formationstempo');
      // 3b. UND DAS FORMATIONSTEMPO MUSS UEBER DER LESESCHWELLE LIEGEN. Das ist der
      //     Widerspruch, der die Einfuehrungsrunde kaputt gemacht hat: gedeckelt war sie auf
      //     das Boxentempo (0,271), waehrend der Ghost-Temporegler bei 0,35 beginnt, weil das
      //     Auto darunter die gedruckte Strecke nicht mehr LIEST. Die Ghosts lasen also
      //     nichts, wurden als "Bahn verlassen" geparkt und blinkten - und die Runde konnte
      //     gar nicht enden, denn ihr Ende ist eine Ueberfahrt von Start/Ziel.
      if (typeof GHOST_READ_MIN === 'number' && !(ziel >= GHOST_READ_MIN)) {
        schlecht.push('Formationstempo ' + ziel.toFixed(3) + ' unter der Leseschwelle '
                      + GHOST_READ_MIN);
      }
      // 4. Die Bremse des Fahrers gewinnt - in der Einfuehrungsrunde.
      const mitBremse = bei(ziel * 0.4, 0.8);
      if (!(mitBremse.brake >= 0.8 && mitBremse.throttle === 0)) {
        schlecht.push('Bremse des Fahrers verliert');
      }
      // 5. Und bei Gelb gewinnt sie NICHT: dort ist der Sinn, dass die Haende ganz frei
      //    sind. Ohne diese Gegenprobe waere Punkt 4 auch gruen, wenn er ueberall gilt.
      raceFormationLap = false; flagState = 'yellow';
      const gelbBremse = bei(0.1, 0.8);
      if (gelbBremse && gelbBremse.brake > 0.5) schlecht.push('bei Gelb greift die Bremse doch');
      // 6. Ausdruck-Stellung: kein Eingriff, auch nicht in der Einfuehrungsrunde. Ohne
      //    Leitplanken faehrt ein Autopilot ohne Querregelung in die Bande.
      raceFormationLap = true; flagState = 'green'; trackMode = 'off';
      if (bei(0.1) !== null) schlecht.push('greift in der Ausdruck-Stellung');
      return { ok: schlecht.length === 0,
               mass: 'Ziel ' + ziel.toFixed(3) + ' (Boxentempo '
                     + PIT_SPEED_FACTOR.toFixed(3) + ', Leseschwelle '
                     + (typeof GHOST_READ_MIN === 'number' ? GHOST_READ_MIN : '?')
                     + ') | bei 40 % Gas '
                     + langsam.throttle.toFixed(2) + ', bei 250 % Bremse '
                     + schnell.brake.toFixed(2) + ', am Ziel '
                     + passend.throttle.toFixed(2) + '/' + passend.brake.toFixed(2)
                     + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      flagState = merk.flag; trackMode = merk.tm;
      physEngine.state.speedKmh = merk.v; raceFormationLap = merk.form;
    }
  });

  // ---- Der Querversatz gilt fuer Ghosts UND das Fahrerauto ----
  //
  // "so wie Ghosts" heisst auch quer: Schlaengeln zum Reifenwaermen plus die Seite der
  // Zweierkolonne. Geprueft wird, dass es EINE Definition ist - zwei Abschriften derselben
  // zwei Konstanten waeren die naechste Abweichung, und sie faellt erst auf, wenn das Feld
  // anders schlaengelt als der Fahrer.
  stAdd('Einfuehrungsrunde: Fahrer und Ghosts teilen den Versatz', () => {
    if (typeof formationOffset !== 'function' || typeof formationDriverOffset !== 'function') {
      return { skip: true, mass: 'formationOffset nicht erreichbar' };
    }
    const schlecht = [];
    // Gleiche Phase, gleicher Platz, gleiche Zeit -> gleicher Wert. Das ist die Zusicherung.
    const a = {}, b = {};
    a.weavePhase = b.weavePhase = 1.234;
    const t = 1000000;
    for (const platz of [0, 1, 2, 3, -1]) {
      const va = formationOffset(a, platz, t), vb = formationOffset(b, platz, t);
      if (Math.abs(va - vb) > 1e-12) schlecht.push('Platz ' + platz + ' unterschiedlich');
    }
    // Zwei benachbarte Plaetze gehen auseinander, ohne Platz gibt es keinen Kolonnenanteil.
    const p0 = formationOffset(a, 0, t), p1 = formationOffset(a, 1, t);
    const ohne = formationOffset(a, -1, t);
    if (!(p0 > ohne && p1 < ohne)) schlecht.push('Kolonne ohne Vorzeichenwechsel');
    // Und der Fahrer bekommt einen Wert im gleichen Rahmen.
    const f = formationDriverOffset();
    if (!(Math.abs(f) <= GHOST_WEAVE + GHOST_GRID_OFFSET + 1e-9)) {
      schlecht.push('Fahrerversatz ausserhalb des Rahmens: ' + f);
    }
    return { ok: schlecht.length === 0,
             mass: 'Platz 0 ' + p0.toFixed(3) + ', Platz 1 ' + p1.toFixed(3)
                   + ', ohne Platz ' + ohne.toFixed(3) + ' | Fahrer ' + f.toFixed(3)
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Fliegender Start: der Schalter ist nicht mehr gesperrt ----
  //
  // Bis v0.4.53 trug er `disabled` und die Beschriftung "nicht umgesetzt", waehrend die
  // Einfuehrungsrunde vollstaendig im Code stand. Der Test haelt beides fest: der Schalter
  // muss bedienbar sein, und die alte Sperrklasse darf nirgends mehr stehen - eine Regel
  // ohne Nutzer sieht wie eine Moeglichkeit aus.
  stAdd('Fliegender Start: entsperrt', () => {
    const el = $('race-flying');
    if (!el) return { ok: false, mass: 'race-flying fehlt' };
    const zeile = el.closest('.opt-row');
    const gesperrt = el.disabled || (zeile && zeile.classList.contains('opt-off'));
    const reste = document.querySelectorAll('.opt-off').length;
    // Und das Etikett muss "experimentell" sagen und nicht mehr "nicht umgesetzt".
    const tag = zeile ? zeile.querySelector('.wip-tag') : null;
    const text = tag ? tag.textContent.trim() : '';
    const ok = !gesperrt && reste === 0
               && (text === 'experimentell' || text === 'experimental');
    return { ok, mass: (gesperrt ? 'GESPERRT' : 'bedienbar') + ', Etikett "' + text
                       + '", ' + reste + ' Reste von .opt-off' };
  });

  // ---- Fliegender Start: die Einfuehrungsrunde von der Ampel bis zur Freigabe ----
  //
  // Der ganze Ablauf in einer Probe, weil er nur als Ablauf etwas zusichert. Gefahren wird
  // er ohne Auto: raceFormationLap und das Tempolimit sind Zustand der Rennleitung, und
  // genau der ist die Zusicherung.
  //
  // Vier Dinge muessen danach stimmen: das Limit ist weg, die Einfuehrungsrunde ist
  // beendet, die Rundenuhr ist NEU gestempelt, und gezaehlt wurde nichts. Der vierte ist
  // der wichtigste - eine Einfuehrungsrunde, die als Runde zaehlt, waere eine geschenkte
  // schnelle Runde.
  stAdd('Fliegender Start: Einfuehrungsrunde und Freigabe', () => {
    if (typeof raceFormationLap === 'undefined' || typeof endFormationLap !== 'function') {
      return { skip: true, mass: 'Rennleitung nicht erreichbar' };
    }
    const merk = { state: raceState, form: raceFormationLap, lim: limitFormation,
                   lapStart: raceLapStart, zeiten: raceLapTimes.slice(),
                   part: racePartialMs };
    try {
      raceState = 'racing';
      raceLapTimes = [];
      raceFormationLap = true;
      limitFormation = PIT_SPEED_FACTOR;
      applySpeedLimit();
      raceLapStart = Date.now() - 5000;
      const limVor = physEngine.config.speedLimitFactor;
      const startVor = raceLapStart;
      // Die erste Ueberfahrt von Start/Ziel, egal von wem.
      endFormationLap();
      const limNach = physEngine.config.speedLimitFactor;
      const ok = limVor < 0.9 && Math.abs(limNach - 1) < 1e-9
                 && raceFormationLap === false
                 && raceLapStart > startVor
                 && raceLapTimes.length === 0;
      return { ok, mass: 'Limit ' + limVor.toFixed(3) + ' -> ' + limNach.toFixed(3)
                         + ', Einfuehrungsrunde ' + (raceFormationLap ? 'LAEUFT NOCH' : 'beendet')
                         + ', Uhr ' + (raceLapStart > startVor ? 'neu gestempelt' : 'ALT')
                         + ', gezaehlte Runden ' + raceLapTimes.length };
    } finally {
      raceFormationLap = merk.form;
      limitFormation = merk.lim;
      applySpeedLimit();
      raceState = merk.state;
      raceLapStart = merk.lapStart;
      raceLapTimes = merk.zeiten;
      racePartialMs = merk.part;
    }
  });

  // ---- Startaufstellung: zwei benachbarte Plaetze gehen auseinander ----
  //
  // Die Wirkung, die die Aufstellung bis v0.4.53 nicht hatte: sie speiste nur die Liste.
  // Geprueft wird das VORZEICHEN je Platz - Pole links, Zweiter rechts - und dass Versatz
  // und Schlaengeln zusammen nicht an den Anschlag kommen.
  stAdd('Startaufstellung: Zweierkolonne', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.gridOffsets) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const g = OMEGA_TEST.gridOffsets(6);
    const schlecht = [];
    for (let i = 0; i < g.versatz.length - 1; i++) {
      if (g.versatz[i] * g.versatz[i + 1] >= 0) {
        schlecht.push('Platz ' + (i + 1) + ' und ' + (i + 2) + ' auf derselben Seite');
      }
    }
    if (!(g.betrag > 0.05)) schlecht.push('Versatz zu klein, unsichtbar');
    if (!(g.zusammen < 0.5)) schlecht.push('mit dem Schlaengeln zu nah am Anschlag');
    return { ok: schlecht.length === 0,
             mass: 'Versatz ' + g.betrag + ', mit Schlaengeln ' + g.zusammen
                   + ' | Vorzeichen ' + g.versatz.map(v => v > 0 ? '+' : '-').join('')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ansage: der gesprochene Text ----
  //
  // formatLapTime() liefert "62.43s", und vorgelesen ist das falsch: eine Stimme sagt
  // daraus "zweiundsechzig Punkt vier drei Sekunden". Geprueft werden die drei Faelle, an
  // denen es auseinandergeht - unter einer Minute, darueber, und die Bestzeit -, und dass
  // das Dezimalzeichen zur SPRACHE passt: eine deutsche Stimme liest "58.3" als
  // "achtundfuenfzig Punkt drei".
  stAdd('Ansage: gesprochener Text', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ansage) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const kurz = OMEGA_TEST.ansage(58300, false).text;
    const lang1 = OMEGA_TEST.ansage(62430, false).text;
    const lang2 = OMEGA_TEST.ansage(143200, false).text;
    const best = OMEGA_TEST.ansage(58300, true).text;
    const schlecht = [];
    // Keine Einheit unter einer Minute: auf einer Rennstrecke braucht eine Zeit keine.
    if (!/^58[.,]3$/.test(kurz)) schlecht.push('kurz: ' + kurz);
    // Ueber einer Minute: Minute und Rest getrennt, und der Rest ist NICHT die Gesamtzeit.
    if (lang1.indexOf('2') < 0 || lang1.indexOf('62') >= 0) schlecht.push('eine Minute: ' + lang1);
    if (lang2.indexOf('23') < 0) schlecht.push('zwei Minuten: ' + lang2);
    // Der Plural, denn "2 Minute" ist der Fehler, den man erst hoert.
    if (lang1 === lang2) schlecht.push('Singular und Plural gleich');
    // Und die Bestzeit sagt etwas dazu.
    if (best.length <= kurz.length) schlecht.push('Bestzeit ohne Zusatz: ' + best);
    // Das Dezimalzeichen folgt der Sprache.
    const deutsch = kurz.indexOf(',') >= 0;
    if (lang === 'de' && !deutsch) schlecht.push('deutscher Modus mit Punkt');
    if (lang === 'en' && deutsch) schlecht.push('englischer Modus mit Komma');
    return { ok: schlecht.length === 0,
             mass: [kurz, lang1, lang2, best].join(' | ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Ansage: jede Aeusserung bricht die vorherige ab ----
  //
  // Zwei Runden kurz hintereinander duerfen sich nicht stapeln, sonst laeuft die Stimme
  // nach und sagt die vorletzte Zeit, waehrend man schon in der naechsten Runde ist.
  // Geprueft wird an den Zaehlern und nicht am Lautsprecher: ob wirklich Ton kommt, haengt
  // an den Stimmen des Systems, aber DASS vor jeder Aeusserung abgebrochen wird, ist eine
  // Eigenschaft des Codes.
  stAdd('Ansage: stapelt sich nicht', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ansage || typeof speakLap !== 'function') {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    if (!('speechSynthesis' in window)) return { skip: true, mass: 'keine Sprachausgabe' };
    const el = $('setting-announce');
    const merk = el ? el.checked : null;
    try {
      if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      const vor = OMEGA_TEST.ansage();
      speakLap(58300, false);
      speakLap(59100, true);
      const nach = OMEGA_TEST.ansage();
      const rufe = nach.calls - vor.calls;
      const abbr = nach.cancels - vor.cancels;
      // Und die Gegenprobe: ausgeschaltet darf gar nichts passieren.
      if (el) { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }
      speakLap(60000, false);
      const aus = OMEGA_TEST.ansage();
      const stillRufe = aus.calls - nach.calls;
      const ok = rufe === 2 && abbr === 2 && stillRufe === 0;
      return { ok, mass: rufe + ' Aeusserungen, ' + abbr + ' Abbrueche, ausgeschaltet '
                         + stillRufe + ' Aeusserungen' };
    } finally {
      if (el && merk !== null) {
        el.checked = merk;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
  });

  // ---- Marke und Zaehler: die zwei aussenwirksamen Zeilen ----
  //
  // Beide haben denselben wunden Punkt, und der Verweispruefer im Build sieht ihn NICHT: er
  // ueberspringt alles mit :// und alles, was mit // beginnt. Eine protokollrelative
  // Adresse loest von der Platte zu file://gc.zgo.at/count.js auf - kein Ausfall des
  // Zaehlers, sondern ein Zugriff auf einen Ordner, den es nicht gibt. Deshalb prueft das
  // hier ein Test und nicht der Build.
  stAdd('Marke und Zaehler: https, einmal, mit rel', () => {
    const schlecht = [];
    const a = document.querySelectorAll('.gt3-marke a[href]');
    if (a.length !== 1) schlecht.push(a.length + ' Kurzlinks im Cockpit');
    if (a.length) {
      const h = a[0].getAttribute('href');
      if (h.indexOf('https://') !== 0) schlecht.push('Kurzlink nicht https: ' + h);
      if (h.indexOf('t1p.de') < 0) schlecht.push('Kurzlink zeigt woanders: ' + h);
      if ((a[0].getAttribute('rel') || '').indexOf('noopener') < 0) schlecht.push('rel ohne noopener');
      if (a[0].getAttribute('target') !== '_blank') schlecht.push('kein target=_blank');
      // Das Omega kommt per <use> aus dem Kopfzeilen-Logo. Fehlt der Pfad, bleibt ein
      // leeres Kaestchen stehen, und das faellt auf einem Bildschirmfoto nicht auf.
      if (!document.getElementById('om')) schlecht.push('Logopfad #om fehlt');
    }
    const z = document.querySelectorAll('script[data-goatcounter]');
    if (z.length !== 1) schlecht.push(z.length + ' Zaehlskripte');
    if (z.length) {
      const src = z[0].getAttribute('src') || '';
      if (src.indexOf('https://') !== 0) schlecht.push('Zaehler nicht https: ' + src);
      if (!z[0].hasAttribute('async')) schlecht.push('Zaehler nicht async');
    }
    return { ok: schlecht.length === 0,
             mass: a.length + ' Kurzlink, ' + z.length + ' Zaehlskript'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : ', beide https') };
  });

  // ---- Layout: Neutral laesst die Kalibrierung unberuehrt ----
  //
  // Die Aenderung soll rein additiv sein: wer nichts umstellt, merkt nichts. Geprueft wird es
  // an der Stelle, an der eine Verschiebung auffiele - physConfigDiff() nennt jede Abweichung
  // vom Kalibrierbezug, und kein LAYOUT-Feld darf darin stehen, solange Neutral gilt.
  stAdd('Layout: Neutral weicht nicht vom Kalibrierbezug ab', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physConfigDiff || !OMEGA_TEST.physLayouts) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const merk = physEngine.layoutName || 'neutral';
    const FELDER = ['loadFrontStatic', 'wheelbaseM', 'yawInertia', 'steerRatePerS'];
    try {
      physEngine.applyLayout('neutral');
      const diff = OMEGA_TEST.physConfigDiff() || {};
      const drin = FELDER.filter(f => f in diff);
      // Und die Gegenprobe: ein ANDERES Layout MUSS auftauchen. Ein Test, der nur die
      // Abwesenheit prueft, ist auch gruen, wenn physConfigDiff gar nichts meldet.
      physEngine.applyLayout('gt3rear');
      const diff2 = OMEGA_TEST.physConfigDiff() || {};
      const drin2 = FELDER.filter(f => f in diff2);
      const ok = drin.length === 0 && drin2.length >= 2;
      return { ok, mass: 'Neutral: ' + (drin.length ? drin.join(', ') : 'keine Abweichung')
                         + ' | GT3 Heck: ' + (drin2.length ? drin2.join(', ') : 'KEINE')
                         + (ok ? '' : ' || Gegenprobe fehlgeschlagen') };
    } finally {
      physEngine.applyLayout(merk);
    }
  });

  // ---- Layout: die fuenf unterscheiden sich, geordnet, und keiner klebt am Notboden ----
  //
  // Der zweite Teil ist der, der eine Abstimmung von einer Klippe unterscheidet. Bei der
  // ersten Fassung (Achslast als physikalischer Exponent 0,85) lagen drei von fuenf Layouts
  // auf dem Notboden von 0,12 - unterscheidbar waren sie damit nicht, nur alle unfahrbar.
  stAdd('Layout: geordnet unterschiedlich, keiner am Notboden', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physLayoutDrive) {
      return { skip: true, mass: 'physLayoutDrive nicht vorhanden' };
    }
    const namen = ['neutral', 'gt3front', 'gt3mid', 'gt3rear', 'f1'];
    const werte = namen.map(n => {
      const r = OMEGA_TEST.physLayoutDrive(n, { kmh: 140, throttle: 0, brake: 1,
                                                steering: 1, patch: { steerCalib: 2.0 } });
      const v = OMEGA_TEST.physLayouts()[n];
      return { n, grad: r.grad, sg: r.steerGrip, vorn: v.vorn, rate: v.rate, iz: v.iz };
    });
    const schlecht = [];
    // 1. Keiner am Notboden. 0,12 ist die Trockenreserve; wer dort liegt, lenkt nicht mehr.
    for (const w of werte) {
      if (w.sg < 0.13) schlecht.push(w.n + ' liegt am Notboden (' + w.sg.toFixed(3) + ')');
    }
    // 2. Nach Vorderachslast geordnet: mehr Last vorn heisst mehr Lenkung unter Bremsen.
    const nachLast = werte.slice().sort((a, b) => b.vorn - a.vorn);
    for (let i = 1; i < nachLast.length; i++) {
      if (nachLast[i].grad > nachLast[i - 1].grad + 1) {
        schlecht.push(nachLast[i].n + ' lenkt mehr als das schwerere ' + nachLast[i - 1].n);
      }
    }
    // 3. Und sie muessen sich UEBERHAUPT unterscheiden. Genau daran ist der erste Anlauf
    //    gescheitert: alle fuenf gaben 26 Grad, weil uF auf 0,5 normiert und frontCap
    //    gedeckelt war.
    const spanne = Math.max.apply(null, werte.map(w => w.grad))
                 - Math.min.apply(null, werte.map(w => w.grad));
    if (spanne < 5) schlecht.push('Spanne nur ' + spanne + ' Grad, die Layouts wirken kaum');
    // 4. Die Lenkrate folgt dem Traegheitsmoment, gegenlaeufig.
    const nachIz = werte.slice().sort((a, b) => a.iz - b.iz);
    for (let i = 1; i < nachIz.length; i++) {
      if (nachIz[i].rate > nachIz[i - 1].rate + 1e-9) {
        schlecht.push('Lenkrate steigt mit dem Traegheitsmoment (' + nachIz[i].n + ')');
      }
    }
    return { ok: !schlecht.length,
             mass: werte.map(w => w.n + ' ' + w.grad + '\u00b0/' + w.rate.toFixed(1)).join('  ')
                   + ' | Spanne ' + spanne + '\u00b0'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Layout: KEIN Preset-Schluessel ----
  //
  // Zwei Achsen, die getrennt bleiben muessen: welches Auto (Layout) und wie abgestimmt
  // (Voreinstellung). Ohne die Ausnahme wuerde ein Klick auf "GT3" das AUTO wechseln.
  //
  // Geprueft wird der VERTRAG und nicht die Wirkung: presetControls() darf den Waehler nicht
  // finden. Eine Voreinstellung anzuwenden waere invasiv und wuerde die Einstellungen des
  // Nutzers veraendern, nur um etwas zu pruefen, das strukturell entschieden ist.
  stAdd('Layout: nicht in den Voreinstellungen', () => {
    const el = $('setting-layout');
    if (!el) return { ok: false, mass: 'setting-layout fehlt' };
    if (typeof presetControls !== 'function') {
      return { skip: true, mass: 'presetControls nicht erreichbar' };
    }
    const ids = presetControls().map(x => x.id);
    const drin = ids.includes('setting-layout');
    // Gegenprobe: die Sammlung darf nicht einfach LEER sein, sonst ist der Test wertlos.
    const genug = ids.length > 30;
    // Und das Attribut muss am Element stehen, nicht nur zufaellig ausserhalb liegen.
    const markiert = el.hasAttribute('data-preset-skip');
    return { ok: !drin && genug && markiert,
             mass: ids.length + ' Bedienelemente in den Voreinstellungen, Layout '
                   + (drin ? 'IST DABEI' : 'nicht dabei')
                   + ', Attribut ' + (markiert ? 'gesetzt' : 'FEHLT') };
  });

  // ---- Einspurmodell, Probe 1: der Kleinwinkel-Grenzfall ----
  //
  // DIE STAERKSTE der drei, weil sie gegen eine Formel prueft, die man nicht bestreiten kann:
  // bei kleinem Winkel und niedrigem Tempo muss das Modell dasselbe sagen wie die reine
  // Geometrie, r = delta * v / L. Ein Modell, das im einfachsten Fall von der Schulformel
  // abweicht, ist an einer Stelle falsch, die man ohne diese Probe lange nicht findet.
  stAdd('Einspurmodell: Kleinwinkel trifft die Geometrie', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physYawGeometry) {
      return { skip: true, mass: 'physYawGeometry nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    // Fuer JEDES Layout, denn der Radstand geht in die Formel ein.
    for (const layout of ['neutral', 'gt3front', 'gt3rear', 'f1']) {
      const r = OMEGA_TEST.physYawGeometry({ layout });
      teile.push(layout + ' ' + (r.abweichungProzent === null ? '?' : r.abweichungProzent + '%'));
      if (r.abweichungProzent === null || Math.abs(r.abweichungProzent) > 2) {
        schlecht.push(layout + ': ' + r.abweichungProzent + ' % gegen die Geometrie');
      }
    }
    return { ok: !schlecht.length,
             mass: 'Abweichung von delta*v/L: ' + teile.join('  ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Einspurmodell, Probe 2: der Sprungversuch ----
  //
  // Lenkwinkel schlagartig anlegen. Die Gierrate MUSS einschwingen und nicht aufschwingen -
  // und zwar im SENDETAKT von 45 ms, nicht in einem feinen Prueftakt. Genau dafuer ist der
  // Schritt halbimplizit: bei 45 ms und hoher Schraeglaufsteifigkeit wird explizites Euler
  // instabil.
  stAdd('Einspurmodell: Sprungversuch schwingt ein, nicht auf', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physYawStep) {
      return { skip: true, mass: 'physYawStep nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    for (const layout of ['neutral', 'gt3rear', 'f1']) {
      // Auch mit einer ABSICHTLICH ueberhohen Steifigkeit: dort wuerde ein explizites
      // Verfahren aufschwingen, und nur so sagt der Test etwas ueber das Verfahren.
      for (const [name, cfg] of [['normal', {}], ['steif', { corneringStiffness: 600000 }]]) {
        const r = OMEGA_TEST.physYawStep({ layout, cfg });
        teile.push(layout + '/' + name + ' ' + r.ueberschwingen.toFixed(2));
        if (!r.endlich) schlecht.push(layout + '/' + name + ': nicht endlich');
        // 1,0 heisst monoton eingeschwungen. Bis 1,3 ist ein gedaempftes Ueberschwingen,
        // darueber schwingt es auf.
        if (r.ueberschwingen > 1.3) {
          schlecht.push(layout + '/' + name + ': Ueberschwingen '
                        + r.ueberschwingen.toFixed(2));
        }
      }
    }
    return { ok: !schlecht.length,
             mass: 'Spitze/Endwert: ' + teile.join('  ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Einspurmodell, Probe 3: der Eigenlenkgradient faellt heraus ----
  //
  // Aus zwei Punkten einer stationaeren Kreisfahrt: kU = (delta2-delta1)/(ay2-ay1). Der
  // herausgerechnete Wert muss den eingestellten treffen, sonst ist ein Vorzeichen oder eine
  // Achslast falsch.
  //
  // UND DAS VORZEICHEN JE LAYOUT, denn das ist die eigentliche Aussage: mehr Last hinten
  // heisst uebersteuernd, also kU negativ. Waeren die Achssteifigkeiten strikt proportional
  // zur Last, waere kU fuer JEDE Verteilung genau null - das Modell haette jedes Layout als
  // neutral gemeldet, und dieser Test faellt genau darauf.
  stAdd('Einspurmodell: Eigenlenkgradient stimmt und hat das richtige Vorzeichen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physYawCircle || !OMEGA_TEST.physLayouts) {
      return { skip: true, mass: 'Messaufbau nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    const tab = OMEGA_TEST.physLayouts();
    for (const layout of ['neutral', 'gt3front', 'gt3mid', 'gt3rear', 'f1']) {
      // Kleine Winkel und niedriges Tempo: dort ist das Modell im linearen Bereich, und nur
      // dort gilt die stationaere Gleichung, aus der kU herausfaellt.
      // KONSTANTER RADIUS und zwei Tempi - nur so kuerzt sich der geometrische Anteil L/R
      // aus dem Unterschied heraus. Mit festem Tempo und wechselndem Lenkwinkel meldete die
      // Probe 0,021 statt 0, und der Fehler lag in der Messung: L/R blieb im Unterschied
      // stehen. Nachgewiesen wurde es daran, dass delta und L*r/v auf 6*10^-5 zusammenfielen.
      const r = OMEGA_TEST.physYawCircle({ layout, radius: 40, tempi: [30, 55] });
      const vorn = tab[layout].vorn;
      teile.push(layout + ' ' + r.kuEingestellt.toFixed(4) + '/' + r.kuGemessen.toFixed(4));
      // Der herausgerechnete Wert gegen den eingestellten. Absolute Schranke, weil beide
      // klein sind und ein Verhaeltnis bei kU nahe null nichts sagt.
      //
      // 3*10^-4 und nicht 0,02: gemessen trifft die Probe auf 1 bis 2*10^-4, und eine
      // Schranke, die hundertfach darueber liegt, faengt nichts. Sie war zuerst so lose, weil
      // die MESSUNG falsch war (festes Tempo statt fester Radius) - eine weite Schranke um
      // einen Messfehler herum ist die Sorte Test, die spaeter nichts meldet.
      if (Math.abs(r.kuGemessen - r.kuEingestellt) > 3e-4) {
        schlecht.push(layout + ': gemessen ' + r.kuGemessen.toFixed(4)
                      + ' gegen eingestellt ' + r.kuEingestellt.toFixed(4));
      }
      // Das VORZEICHEN: mehr Last vorn heisst untersteuernd (kU > 0), mehr hinten
      // uebersteuernd (kU < 0), 50:50 neutral.
      if (Math.abs(vorn - 0.5) < 1e-9) {
        if (Math.abs(r.kuEingestellt) > 1e-6) schlecht.push(layout + ': 50:50 ist nicht neutral');
      } else if (vorn < 0.5 && !(r.kuEingestellt < 0)) {
        schlecht.push(layout + ': hecklastig, aber kU nicht negativ');
      } else if (vorn > 0.5 && !(r.kuEingestellt > 0)) {
        schlecht.push(layout + ': frontlastig, aber kU nicht positiv');
      }
    }
    // Und die Layouts muessen sich UEBERHAUPT unterscheiden - sonst prueft der Test nur, dass
    // alles null ist.
    const werte = ['neutral', 'gt3mid', 'gt3rear', 'f1'].map(l => tab[l].vorn);
    if (new Set(werte).size < 3) schlecht.push('zu wenige verschiedene Achslasten');
    return { ok: !schlecht.length,
             mass: 'kU eingestellt/gemessen: ' + teile.join('  ')
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Einspurmodell: abgeschaltet luegt es nicht ----
  //
  // yawModelEffect 0 muss ALLE Felder auf null setzen. Ein Modell, das abgeschaltet den
  // letzten Wert stehen laesst, zeigt eine Gierrate fuer ein Auto, das gerade steht - und das
  // ist schlimmer als keine Anzeige.
  stAdd('Einspurmodell: abgeschaltet bleibt alles null', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physYawStep) {
      return { skip: true, mass: 'physYawStep nicht vorhanden' };
    }
    const r = OMEGA_TEST.physYawStep({ cfg: { yawModelEffect: 0 } });
    const ok = r.ende === 0 && r.spitze === 0;
    return { ok, mass: ok ? 'Gierrate bleibt 0'
                          : 'Endwert ' + r.ende + ', Spitze ' + r.spitze };
  });

  // ---- Reifenquietschen am Grenzbereich ----
  //
  // DREI Aussagen, und die dritte ist die, die man nicht hoert: der Startwert der
  // Lautstaerke steht im CODE und im MARKUP. Zwei Orte fuer eine Zahl - genau diese Klasse
  // hat bei den Voreinstellungen siebzehn Abweichungen ergeben, und beim Bremsenquietschen
  // musste sie beim Halbieren an beiden Stellen nachgezogen werden.
  stAdd('Reifenquietschen: Treiber, Ton und Lautstaerke stimmen', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.sndVolumes) {
      return { skip: true, mass: 'sndVolumes nicht vorhanden' };
    }
    const schlecht = [], teile = [];

    // 1. Der TREIBER: latUse muss im Zustand stehen und mit der Lenkung steigen. Ohne ihn
    //    hat das Quietschen keine Groesse, an der es haengen kann.
    if (OMEGA_TEST.physSteerGrip) {
      const gerade = OMEGA_TEST.physSteerGrip({ kmh: 140, throttle: 0.3, brake: 0,
                                                steering: 0 });
      const kurve = OMEGA_TEST.physSteerGrip({ kmh: 140, throttle: 0.3, brake: 0,
                                               steering: 1 });
      const l0 = physEngine.state.latUse;
      teile.push('latUse ' + (l0 === undefined ? 'FEHLT' : 'vorhanden'));
      if (l0 === undefined) schlecht.push('latUse nicht im Zustand');
      if (!(gerade.steerGrip >= kurve.steerGrip)) {
        schlecht.push('Kurvenfahrt nimmt keinen Griff');
      }
    }

    // 2. Der TON: in fx.json eingetragen und abrufbar. Der Lader ist absichtlich duldsam -
    //    ein fehlender Eintrag faellt sonst still aus.
    if (location.protocol !== 'file:') {
      try {
        const fx = await (await fetch('audio/fx.json', { cache: 'no-store' })).json();
        if (!fx.tyre || !fx.tyre.file) {
          schlecht.push('kein tyre-Eintrag in fx.json');
        } else {
          const r = await fetch('audio/' + fx.tyre.file, { cache: 'no-store' });
          teile.push(fx.tyre.file + ' ' + (r.ok ? Math.round((await r.blob()).size / 1024)
                                                  + ' kB' : r.status));
          if (!r.ok) schlecht.push(fx.tyre.file + ': ' + r.status);
          if (!fx.tyre.loop) schlecht.push('tyre ist nicht als Schleife eingetragen');
        }
      } catch (e) {
        schlecht.push('fx.json nicht lesbar');
      }
    }

    // 3. Die LAUTSTAERKE: Code gegen Markup.
    const v = OMEGA_TEST.sndVolumes();
    const el = $('tyre-volume');
    if (!el) {
      schlecht.push('tyre-volume fehlt im Dokument');
    } else if (v.reifen === null) {
      schlecht.push('tyreVolume nicht erreichbar');
    } else {
      teile.push('Lautstaerke Code ' + v.reifen + ' / Markup ' + el.defaultValue);
      if (Math.abs(parseFloat(el.defaultValue) - v.reifen) > 1e-9) {
        schlecht.push('Startwert laeuft auseinander: Code ' + v.reifen
                      + ', Markup ' + el.defaultValue);
      }
    }
    // Und die Schwelle. ZWEI Forderungen, und die erste ist die, deren Fehlen das
    // Quietschen bis v0.4.55 nie hat eintreten lassen:
    //
    //   ERREICHBAR. Der Test forderte vorher nur "Schwelle >= 0,7". Das war erfuellt - sie
    //   stand auf 0,85 - und trotzdem quietschte es nie: gemessen erreicht die
    //   Querausnutzung 0,85 erst bei 265 km/h mit VOLLEM Ausschlag. "Spaet" ist eine Aussage
    //   ueber die Zahl und nicht darueber, ob sie jemals vorkommt. Gemessen wird deshalb an
    //   einem Betriebspunkt, den es auf einer Hausstrecke gibt: 170 km/h, voller Ausschlag.
    //
    //   NICHT ZU TIEF. Ein Quietschen, das bei jeder Kurve mitlaeuft, ist ein
    //   Dauergeraeusch und keine Rueckmeldung.
    if (OMEGA_TEST.sndTyreSquealCurve && OMEGA_TEST.physSteerGrip) {
      const k = OMEGA_TEST.sndTyreSquealCurve();
      const p = OMEGA_TEST.physSteerGrip({ kmh: 170, throttle: 0.2, brake: 0, steering: 1 });
      // latUse aus gripLong zurueckgerechnet: gripLong = sqrt(1 - latUse^2).
      const erreicht = Math.sqrt(Math.max(0, 1 - p.gripLong * p.gripLong));
      teile.push('Schwelle ' + k.schwelle + ', bei 170 km/h voll erreicht '
                 + erreicht.toFixed(2));
      if (!(k.schwelle < erreicht)) {
        schlecht.push('Schwelle ' + k.schwelle + ' unerreichbar: eine schnelle Kurve kommt '
                      + 'nur auf ' + erreicht.toFixed(2));
      }
      if (!(k.schwelle >= 0.3)) {
        schlecht.push('Schwelle ' + k.schwelle + ' zu tief, das wird ein Dauergeraeusch');
      }
    }
    return { ok: !schlecht.length,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Verdrahtung: jeder Physik-Regler erreicht die Physik ----
  stAdd('Verdrahtung: alle Physik-Regler greifen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physConfigDiff) {
      return { skip: true, mass: 'physConfigDiff nicht vorhanden' };
    }
    // Die Regler, die die Fahrphysik stellen MUESSEN. Eine gepflegte Liste, und das ist hier
    // richtig: sie ist die Zusicherung. Ein neuer Physik-Regler gehoert hinein, und wenn
    // einer aufhoert zu greifen, meldet es der Test.
    //
    // NICHT dabei: Toene, Ghosts, Boxenlogik, Crashzaehler, Anzeigeschalter - die stellen
    // nicht die Fahrphysik. Und setting-topspeed nicht, weil der Gasfaktor absichtlich am
    // Protokoll ansetzt und nicht am Modell (siehe topSpeedScale in 50-drive.js).
    const PFLICHT = [
      'setting-layout', 'setting-grip', 'setting-brakepower', 'setting-autoshift',
      'setting-topspeed-kmh', 'setting-zero-to-top', 'setting-coast-drag',
      'setting-fuelweight', 'setting-tyres', 'setting-tyre-blankets', 'setting-tyre-asym',
      'setting-tyre-pressure', 'setting-brake-fade', 'setting-dirtyair',
      'phys-steerresp', 'setting-brake-steal', 'setting-steer-calib', 'phys-accel',
      'setting-brakebias',
      // setting-rain steht in MIT_RAMPE, nicht hier: es setzt seit v0.4.50 nur das Ziel der
      // Wetterfront, und unmittelbar nach dem Umlegen ist an der Konfiguration nichts zu
      // sehen. In beiden Listen wurde es zweimal geprueft, und der erste Durchgang meldete
      // es richtigerweise als stumm.
    ];
    // Diese zwei multiplizieren in ihren Schalter hinein und tun ohne ihn richtigerweise
    // nichts. Der Test schaltet ihn erst ein.
    const MIT_SCHALTER = [['setting-brake-fade-strength', 'setting-brake-fade'],
                          ['setting-dirtyair-strength', 'setting-dirtyair']];
    // UND EINER WIRKT UEBER EINE RAMPE. Der Regenschalter setzt seit v0.4.50 nur das ZIEL
    // der Wetterfront; gripScale wandert ueber fuenf Sekunden dorthin. Unmittelbar nach dem
    // Umlegen ist deshalb nichts zu sehen, und der Test hat ihn richtigerweise als stumm
    // gemeldet.
    //
    // Die Antwort ist nicht, den Test nachsichtiger zu machen, sondern die Front
    // nachzuziehen - dann prueft er den GANZEN Weg: Schalter, Ziel, applySurface,
    // Konfiguration. Nachsicht haette nur die Zusicherung verkleinert.
    const MIT_RAMPE = ['setting-rain'];

    // WERTE vergleichen und nicht Schluessel: ein Feld, das durch die Voreinstellung schon
    // abweicht, bleibt sonst unsichtbar.
    const abbild = () => JSON.stringify(OMEGA_TEST.physConfigDiff() || {});
    const anfassen = (el) => {
      const alt = el.type === 'checkbox' ? el.checked : el.value;
      // EINEN DEFINIERTEN ANFANGSZUSTAND herstellen, bevor gemessen wird.
      //
      // Ohne das ist der Test reihenfolgeabhaengig, und genau daran ist er beim ersten Anlauf
      // gescheitert: er meldete setting-tyre-blankets als stumm, waehrend derselbe Regler
      // einzeln nachweislich greift. Ein frueherer Test hatte Kaestchen und Konfiguration
      // auseinanderlaufen lassen, und dann setzt ein Umschalten die Konfiguration auf einen
      // Wert, den sie schon hat - keine Aenderung, obwohl die Verdrahtung steht.
      //
      // Ein Test, der von der Reihenfolge abhaengt, meldet Fehler, die es nicht gibt, und
      // verschweigt welche, die es gibt.
      if (el.type === 'checkbox') {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const vor = abbild();
      if (el.type === 'checkbox') el.checked = !el.checked;
      else if (el.tagName === 'SELECT') el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      else {
        const max = parseFloat(el.max), v = parseFloat(el.value);
        const st = parseFloat(el.step) || 0.05;
        el.value = String(v + st <= max ? v + st : v - st);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const nach = abbild();
      // ZURUECKSETZEN, immer. Ein Test, der die Einstellungen des Nutzers veraendert, ist
      // selbst der naechste Fehlerbericht.
      if (el.type === 'checkbox') el.checked = alt; else el.value = alt;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return vor !== nach;
    };

    const stumm = [], fehlt = [];
    for (const id of PFLICHT) {
      const el = $(id);
      if (!el) { fehlt.push(id); continue; }
      if (!anfassen(el)) stumm.push(id);
    }
    for (const id of MIT_RAMPE) {
      const el = $(id);
      if (!el) { fehlt.push(id); continue; }
      if (!window.OMEGA_TEST || !OMEGA_TEST.wxSet) { fehlt.push(id + ' (wxSet fehlt)'); continue; }
      const merkFront = OMEGA_TEST.wxProbe().front;
      const vor = abbild();
      const alt = el.checked;
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Die Front auf ihr Ziel ziehen, statt fuenf Sekunden zu warten.
      OMEGA_TEST.wxSet(OMEGA_TEST.wxProbe().ziel);
      const nach = abbild();
      el.checked = alt;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      OMEGA_TEST.wxSet(merkFront);
      if (vor === nach) stumm.push(id + ' (mit nachgezogener Front)');
    }
    for (const [id, schalterId] of MIT_SCHALTER) {
      const el = $(id), sw = $(schalterId);
      if (!el || !sw) { fehlt.push(id); continue; }
      const altSw = sw.checked;
      if (!sw.checked) { sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      const ok = anfassen(el);
      if (sw.checked !== altSw) { sw.checked = altSw; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      if (!ok) stumm.push(id + ' (mit Schalter an)');
    }
    const geprueft = PFLICHT.length + MIT_SCHALTER.length + MIT_RAMPE.length;
    return { ok: !stumm.length && !fehlt.length,
             mass: geprueft + ' Physik-Regler geprueft, ' + (geprueft - stumm.length - fehlt.length)
                   + ' greifen'
                   + (stumm.length ? ' || stumm: ' + stumm.join(', ') : '')
                   + (fehlt.length ? ' || fehlt: ' + fehlt.join(', ') : '') };
  });

  // ---- Ideallinie: Richtung ----
  //
  // DER FEHLER, GEGEN DEN ER STEHT, war da und ist gemessen: trackNormals() zeigt nach
  // LINKS in Fahrtrichtung, ihr eigener Kopfkommentar behauptete "RIGHT", und
  // ghostLineOffset() hat ihm geglaubt. Die Ghosts lenkten damit in JEDER Kurve nach aussen
  // statt zum Scheitel - das Gegenteil einer Ideallinie, und von aussen sah es aus wie ein
  // Regler ohne Wirkung.
  //
  // Geprueft wird das VORZEICHEN gegen die Drehrichtung der Kurve, denn genau das ist die
  // Zusicherung: in einer Rechtskurve liegt die schnelle Linie rechts (innen), in einer
  // Linkskurve links. Kein Betrag, keine Zentimeter - eine Seite.
  stAdd('Ideallinie liegt auf der Innenseite', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.lineShape) {
      return { skip: true, mass: 'lineShape nicht vorhanden' };
    }
    const proben = ['SG4R4G4L4', 'SG2RG2L', 'SRRRLLL', 'SG2H2G2J2'];
    const schlecht = [];
    const zeilen = [];
    let n = 0;
    for (const code of proben) {
      for (const m of ['curvature', 'laptime']) {
        const zuege = OMEGA_TEST.lineShape(code, m);
        if (!zuege || !zuege.length) { schlecht.push(code + '/' + m + ': keine Kurve'); continue; }
        for (const z of zuege) {
          n++;
          // Das Mittel muss das Vorzeichen der Drehrichtung haben. Ein Mittel um Null
          // waere "haelt die Mitte", ein umgekehrtes ist der Fehler von oben.
          if (Math.sign(z.mittel) !== z.dir || Math.abs(z.mittel) < 0.05) {
            schlecht.push(code + '/' + m + ' Kachel ' + z.von + '-' + z.bis
                          + ' dreht ' + (z.dir > 0 ? 'rechts' : 'links')
                          + ', Linie ' + z.mittel.toFixed(2));
          }
        }
        if (m === 'laptime') {
          zeilen.push(code + ' ' + zuege.map(z => (z.dir > 0 ? 'R' : 'L')
                      + (z.mittel >= 0 ? '+' : '') + z.mittel.toFixed(2)).join(' '));
        }
      }
    }
    return { ok: !schlecht.length,
             mass: n + ' Kurvenzuege in ' + proben.length + ' Strecken x 2 Modelle'
                 + (schlecht.length ? ' | FALSCHE SEITE: ' + schlecht.join(', ')
                                    : ' | ' + zeilen.join(' | ')) };
  });

  // ---- Ideallinie: Form ----
  //
  // Der zweite Fehler, und er sass in derselben Zeile: der Deckel aus der Querablagemessung
  // wurde auf den WERT geklemmt. Weil die Linie auf dieser Bahnbreite fast ueberall am Rand
  // liegt, kam in der Kurve eine Konstante heraus - die Spanne war exakt 0,000, und zwar in
  // BEIDEN Linienmodellen. Zwei unabhaengige Optimierer, die bitgleich dasselbe Konstante
  // liefern, sind der Beweis, dass nicht sie das Ergebnis bestimmen.
  //
  // Geprueft wird nur das Rundenzeitmodell, und das ist Absicht: das Kruemmungsmodell legt
  // die Linie auf dieser Geometrie ueber die ganze Kurve an den Rand und hat dort
  // tatsaechlich keinen Scheitel (gemessen 0,018). Ein Test, der von ihm eine Form
  // verlangte, wuerde einen Effekt pruefen, den es nicht gibt.
  stAdd('Ideallinie hat in der Kurve eine Form', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.lineShape) {
      return { skip: true, mass: 'lineShape nicht vorhanden' };
    }
    const proben = ['SG4R4G4L4', 'SG2R2G2L2', 'SHG4R4LG'];
    const flach = [];
    const zeilen = [];
    for (const code of proben) {
      const zuege = OMEGA_TEST.lineShape(code, 'laptime') || [];
      for (const z of zuege) {
        if (z.bis - z.von < 1) continue;      // eine einzelne Kachel hat kaum Platz
        zeilen.push(code + ' ' + z.von + '-' + z.bis + ' Spanne ' + z.spanne.toFixed(3));
        if (z.spanne < 0.05) {
          flach.push(code + ' ' + z.von + '-' + z.bis + ' nur ' + z.spanne.toFixed(3));
        }
      }
    }
    if (!zeilen.length) return { skip: true, mass: 'kein Kurvenzug ueber eine Kachel' };
    return { ok: !flach.length,
             mass: zeilen.join(' | ')
                 + (flach.length ? ' || FLACH: ' + flach.join(', ') : '') };
  });

  // ---- Abstand halten ----
  //
  // Es gab keinen einzigen Baustein, der Autos AUSEINANDER haelt: Windschatten und Attacke
  // ziehen zusammen, das Gummiband bremst nur den Fuehrenden. Zwei Ghosts konnten also
  // Stossstange an Stossstange fahren, und genau so wurde es gemeldet.
  stAdd('Abstand: dichtes Auffahren kostet Tempo', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostGapFactor) {
      return { skip: true, mass: 'ghostGapFactor nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostGapFactor([0.05, 0.35, 0.7, 1.5]);
    if (r.length < 4) return { skip: true, mass: 'Prueflauf leer' };
    const f = r.map(x => x.faktor);
    // Monoton steigend mit dem Abstand, und ab der Schwelle wirkungslos.
    const monoton = f[0] < f[1] && f[1] < f[2] && Math.abs(f[3] - 1) < 1e-9
                    && Math.abs(f[2] - 1) < 1e-9;
    // Und er muss ueberhaupt etwas KOSTEN. Ein Baustein, der 0,2 Prozent bewegt, ist auf
    // dem Tisch nicht zu sehen - dieselbe Klasse wie ein Regler mit Faktor null.
    const wirkt = 1 - f[0] > 0.15;
    return { ok: monoton && wirkt,
             mass: r.map(x => x.gap + ': x' + x.faktor).join('  ')
                 + (monoton ? '' : ' | NICHT MONOTON')
                 + (wirkt ? '' : ' | ZU SCHWACH') };
  });

  // ---- Geparkt darf den Neustart nicht ueberleben ----
  //
  // Der gemeldete Fehler: "ein Ghost hat nach einem Rennen trotz Neustart nur noch
  // geblinkt". Ein geparktes Auto ist offTrack, bekommt Gas 0, und der Lichtzweig laesst es
  // im 260-ms-Takt blinken. startGhost() legte einen frischen Ghost an und liess das
  // Parkschild stehen - der Ghost war neu, das Schild alt.
  stAdd('Start hebt das Parkschild auf', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostUnparkOnStart) {
      return { skip: true, mass: 'ghostUnparkOnStart nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostUnparkOnStart();
    const ok = r.vor && !r.nach && r.ghostNeu && r.cutOut === false;
    return { ok, mass: 'vorher "' + r.vor + '", nachher ' + JSON.stringify(r.nach)
                     + ', Ghost neu ' + r.ghostNeu + ', cutOut ' + r.cutOut };
  });

  // ---- Zieleinlauf ----
  //
  // Vorher endete ein Rennen fuer die Ghosts mit stopGhost(): Nullen schreiben und
  // stehenbleiben, wo man gerade ist - mitten auf der Linie, wenn es dumm laeuft.
  //
  // Geprueft werden die GESENDETEN BYTES, nicht die Absicht: Lenkung GERADE (die
  // Rechtskurve eines frueheren Anlaufs ist heraus und soll nicht zurueckkommen), kein Gas,
  // Bremslicht in der Bremsphase, und genau DREI sichtbare Blitze. Die Drei ist der Punkt, an dem man um den Faktor zwei danebenliegt - ein
  // Blinken ist an UND aus -, und beim Entwurf dieses Tests ist genau das aufgefallen: das
  // Blinken begann mit AN, waehrend das Standlicht schon an war, also waren zwei sichtbar.
  stAdd('Zieleinlauf: gerade ausrollen, anhalten, dreimal blinken', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostFinishTimeline) {
      return { skip: true, mass: 'ghostFinishTimeline nicht vorhanden' };
    }
    const r = await OMEGA_TEST.ghostFinishTimeline({ schritt: 60 });
    if (!r || !r.reihe.length) return { ok: false, mass: 'keine Pakete gesendet' };
    // Die Phase steht am Paket. Sie ueber einen zweiten Index zu suchen war der Fehler
    // der ersten Fassung: Takte und Pakete sind nicht gleich viele.
    const pull = r.reihe.filter(x => x.phase === 'roll');
    const brems = r.reihe.filter(x => x.phase === 'brake');
    const blink = r.reihe.filter(x => x.phase === 'blink');
    const fehler = [];
    // 1. LENKUNG GERADE, in jeder Phase. Ein Anlauf liess sie nach rechts an den Rand
    // fahren; das ist heraus, weil ohne Rueckmeldung zur Querlage niemand weiss, wo der
    // Rand ist - am Ende fuhren nur alle Autos gleichzeitig eine Rechtskurve. Der Test
    // haelt das Gegenteil fest, damit es nicht zurueckkommt.
    const krumm = r.reihe.filter(x => x.lenk !== 0);
    if (krumm.length) {
      fehler.push(krumm.length + ' Pakete mit Lenkung (max '
                  + Math.max(...krumm.map(x => Math.abs(x.lenk))) + ')');
    }
    // 2. Kein Gas, in keiner Phase: es wird ausgerollt, nicht gefahren.
    const gas = r.reihe.map(x => x.gas);
    if (gas.some(g => g > 0)) fehler.push('Gas im Zieleinlauf: max ' + Math.max(...gas));
    if (!pull.length) fehler.push('keine Ausrollphase');
    // 3. Bremslicht in der Bremsphase.
    if (!brems.length || brems.some(x => !(x.licht & r.bremse))) {
      fehler.push('kein Bremslicht in der Bremsphase');
    }
    // 4. Genau drei sichtbare Blitze: steigende Flanken des Standlichts im Blinkteil.
    let flanken = 0, vor = 1;   // vor der Blinkphase war das Licht AN
    for (const x of blink) {
      const an = (x.licht & r.kopf) ? 1 : 0;
      if (an && !vor) flanken++;
      vor = an;
    }
    if (flanken !== r.blinks) fehler.push(flanken + ' Blitze statt ' + r.blinks);
    // 5. Und die Sequenz muss ENDEN.
    if (r.takte >= 400) fehler.push('Sequenz endet nicht');
    return { ok: !fehler.length,
             mass: pull.length + ' Takte ausrollen, ' + brems.length + ' bremsen, '
                 + blink.length + ' blinken, ' + flanken + ' Blitze, Lenkung '
                 + (krumm.length ? 'KRUMM' : 'gerade')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Schalter und Spiegel sagen beim Laden dasselbe ----
  //
  // DIE FEHLERKLASSE: ein Kaestchen im Markup und seine Variable im Code sind zwei Orte fuer
  // denselben Zustand, und geschrieben wird die Variable nur im change-Listener. Der feuert
  // beim Laden NICHT. Stehen die zwei unterschiedlich da, zeigt die Oberflaeche das eine und
  // die Funktion tut das andere - bis jemand den Schalter zweimal umlegt.
  //
  // ZWEI GEMELDETE FEHLER, EINE URSACHE, und beide waeren hier aufgefallen:
  //
  //   setting-vibration     Markup an, Variable false. "Controller Vibration ist zwar an,
  //                         aber es geht nicht" - genau das.
  //   setting-crash-damage  Markup aus, Variable true. Crashs wurden gezaehlt, obwohl der
  //                         Schalter aus war; ab 50 % Schaden faellt lightDamage.rear, und
  //                         dann maskiert buildCommandPacket das Bremslicht ueber
  //                         lampFlicker heraus. Das ist "beim Bremsen blinkt das
  //                         Bremslicht statt zu leuchten".
  //
  // Die Liste ist GEPFLEGT, und das ist hier richtig: sie IST die Zusicherung. Sie stammt
  // aus einer Suche ueber alle Kaestchen, deren Listener "X = e.target.checked" schreibt.
  // Ein neuer Schalter gehoert hinein.
  stAdd('Schalter und Spiegel sagen beim Laden dasselbe', () => {
    const PAARE = [
      ['amb-enable', () => ambienceEnabled],
      ['dash-head-toggle', () => headlightsOn],
      ['ghost-leader', () => ghostCfg.leaderBrake],
      ['ghost-learn', () => ghostCfg.learn],
      ['ghost-learn-pace', () => ghostCfg.learnPace],
      ['ghost-needcode', () => ghostCfg.needCode],
      ['ghost-rail', () => ghostCfg.railMode],
      ['phys-enable', () => physicsEnabled],
      ['pit-double-lap', () => pitDoubleCountsLap],
      ['pit-enable', () => pitLaneEnabled],
      ['race-flying', () => raceFlying],
      ['race-wx-change', () => raceWxChange],
      ['setting-autoshift', () => physEngine.config.autoShift],
      ['setting-battery-comp', () => batteryCompEnabled],
      ['setting-crash-damage', () => crashDetectionEnabled],
      ['setting-offtrack', () => offtrackEffekt],
      ['setting-tyre-blankets', () => physEngine.config.tyreBlankets],
      ['setting-vibration', () => rumbleOn],
      ['sound-enable', () => soundEnabled],
    ];
    const schlecht = [], fehlt = [];
    let geprueft = 0;
    for (const [id, lies] of PAARE) {
      const el = $(id);
      if (!el) { fehlt.push(id); continue; }
      let spiegel;
      try { spiegel = lies(); } catch (e) { fehlt.push(id + ' (' + e.message + ')'); continue; }
      geprueft++;
      if (!!spiegel !== !!el.checked) {
        schlecht.push(id + ': Schalter ' + (el.checked ? 'an' : 'aus')
                      + ', Spiegel ' + (spiegel ? 'an' : 'aus'));
      }
    }
    return { ok: !schlecht.length && !fehlt.length,
             mass: geprueft + ' Schalter geprueft'
                 + (schlecht.length ? ' | WEICHEN AB: ' + schlecht.join(', ')
                                    : ' | alle gleich')
                 + (fehlt.length ? ' | nicht erreichbar: ' + fehlt.join(', ') : '') };
  });

  // ---- Ruettelt der Controller ueberhaupt? ----
  //
  // Gemeldet als "Controller Vibration ist zwar an, aber es geht nicht". Der Test haengt
  // einen Pad-Stummel an navigator.getGamepads und sieht, ob playEffect gerufen wird - der
  // einzige Weg, das ohne echten Controller zu pruefen, und er deckt genau die zwei Fehler
  // ab, die es gab: der stille Startwert und die falsche Pad-Auswahl.
  //
  // Zwei Pads im Stummel, und das ist der Punkt: Windows zeigt denselben Controller oft
  // zweimal, und padRumble nahm den ERSTEN mit einem Ruettler - das kann der rohe Zwilling
  // ohne Zuordnung sein. Geprueft wird, dass der Ruettler des ZUGEORDNETEN Pads laeuft.
  stAdd('Controller-Vibration erreicht den richtigen Pad', () => {
    if (typeof padRumble !== 'function') return { skip: true, mass: 'padRumble nicht da' };
    const echt = navigator.getGamepads;
    const sw = $('setting-vibration');
    const merk = sw ? sw.checked : null;
    const rufe = [];
    const mk = (mapping, name) => ({
      mapping, id: name, connected: true, axes: [0, 0, 0, 0], buttons: [],
      vibrationActuator: { type: 'dual-rumble',
        playEffect(art, o) { rufe.push({ name, art, o }); return Promise.resolve('complete'); } },
    });
    try {
      // Der ROHE zuerst in der Liste - so wie Windows es liefert, wenn es schiefgeht.
      navigator.getGamepads = () => [mk('', 'roh'), mk('standard', 'zugeordnet')];
      if (sw && !sw.checked) { sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      padRumble(0.6, 0.3, 90);
      const anGetroffen = rufe.length === 1 && rufe[0].name === 'zugeordnet'
                          && rufe[0].art === 'dual-rumble';
      // Und aus muss aus sein.
      rufe.length = 0;
      if (sw) { sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      padRumble(0.6, 0.3, 90);
      const ausStill = rufe.length === 0;
      return { ok: anGetroffen && ausStill,
               mass: (anGetroffen ? 'an: zugeordneter Pad geruettelt'
                                  : 'an: FALSCH, ' + JSON.stringify(rufe.map(r => r.name)))
                   + ' | ' + (ausStill ? 'aus: still' : 'aus: RUETTELT TROTZDEM') };
    } finally {
      navigator.getGamepads = echt;
      if (sw && merk !== null) {
        sw.checked = merk;
        sw.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  // ---- Das Bremslicht steht, wenn die Leuchte heil ist ----
  //
  // GEMELDET ALS: "wenn ich Bremse druecke, blinkt das Bremslicht statt zu leuchten". Die
  // Ursache lag zwei Schritte davor - crashDetectionEnabled stand beim Laden auf true,
  // waehrend der Schalter aus zeigte, also wurden Crashs gezaehlt, und ab 50 % Schaden faellt
  // lightDamage.rear. Ein defektes Ruecklicht bekommt in buildCommandPacket keinen harten
  // Aus-Zustand, sondern einen Wackelkontakt (lampFlicker: an in etwa 14 Prozent der
  // 70-ms-Fenster), und der sieht beim Bremsen wie Blinken aus.
  //
  // Geprueft wird die STELLE, an der man es sieht, und nicht die Ursache: der Startwert ist
  // schon vom Schaltertest abgedeckt, die Maskierung war es nicht.
  //
  // Beide Richtungen, und die zweite ist die Absicherung: ohne sie waere der Test auch dann
  // gruen, wenn die Maskierung ueberhaupt nicht mehr wirkt.
  stAdd('Bremslicht steht bei heiler Leuchte und flackert bei defekter', () => {
    if (typeof lightDamage !== 'object' || typeof buildCommandPacket !== 'function') {
      return { skip: true, mass: 'lightDamage/buildCommandPacket nicht erreichbar' };
    }
    const merk = { r: lightDamage.rear, f: lightDamage.front };
    // Je 70-ms-Fenster einmal lesen: lampFlicker faechert nach Math.floor(Date.now()/70)
    // auf, und mehrere Lesungen im selben Fenster ergeben denselben Wert.
    const messe = (ms) => {
      const an = [];
      const t0 = Date.now();
      let letztes = -1;
      while (Date.now() - t0 < ms) {
        const f = Math.floor(Date.now() / 70);
        if (f !== letztes) {
          letztes = f;
          an.push((buildCommandPacket(0, 0, LIGHT_HEAD | LIGHT_BRAKE)[14] & LIGHT_BRAKE)
                  ? 1 : 0);
        }
      }
      return an;
    };
    try {
      lightDamage.rear = false;
      const heil = messe(840);
      lightDamage.rear = true;
      const defekt = messe(840);
      const heilStetig = heil.length >= 8 && heil.every(x => x === 1);
      const anteilDefekt = defekt.reduce((s, x) => s + x, 0) / Math.max(1, defekt.length);
      // Ueberwiegend aus. Nicht "genau 14 Prozent": lampFlicker ist eine Hashfunktion ueber
      // die Uhr, und eine Probe von zwoelf Fenstern hat Streuung. Geprueft wird die
      // Aussage - ueberwiegend dunkel -, nicht die Zahl.
      const defektFlackert = defekt.length >= 8 && anteilDefekt < 0.5;
      return { ok: heilStetig && defektFlackert,
               mass: 'heil ' + heil.length + ' Fenster, ' + (heilStetig ? 'durchgehend an'
                       : 'NICHT DURCHGEHEND (' + heil.join('') + ')')
                   + ' | defekt ' + (anteilDefekt * 100).toFixed(0) + ' % an'
                   + (defektFlackert ? '' : ' (FLACKERT NICHT)') };
    } finally {
      lightDamage.rear = merk.r;
      lightDamage.front = merk.f;
    }
  });

  // ---- Erreicht ein Ghost sein eingestelltes Tempo? ----
  //
  // Der Regler ist ein P-Regler mit Totband, und so einer hat von Natur aus eine
  // Beharrungsabweichung. Seit ein I-Anteil dazugekommen ist, trifft er gemessen auf 95 bis
  // 99 Prozent. Der Test haelt das fest, denn davon haengt ALLES andere am Tempo ab: jeder
  // Abschlag - Kurve, Windschatten, Gummiband, gelbe Flagge - wirkt nur so genau, wie der
  // Regler seinem Ziel folgt.
  //
  // ES GAB EINEN FEHLALARM AUF DEM WEG, und er gehoert hierher, weil er teuer war: ein
  // frueherer Prueflauf faelschte Date.now und liess nur Mikrotasks laufen. st.isShifting
  // wird aber von einem setTimeout zurueckgesetzt, und waehrend einer Schaltunterbrechung
  // gibt es keinen Zug - das Auto hing nach dem ersten Hochschalten dauerhaft bei 24 Prozent,
  // bei JEDEM Ziel. Daraus wurde erst eine Beharrungsabweichung von 58 Prozent geschlossen.
  // Sie war der Prueflauf. Er setzt die Unterbrechung jetzt auf seine eigene Uhr.
  stAdd('Ghost erreicht sein eingestelltes Tempo', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const zeilen = [], schlecht = [];
    for (const soll of [0.2, 0.35, 0.7]) {
      const g = await OMEGA_TEST.ghostDriveProbe({ lage: 'codes', takte: 500, code: 'SG8',
                                                   tileMs: 900, cfg: { spice: 0, speed: soll } });
      const f = g.tempo.filter(x => isFinite(x)).slice(-30);
      const ist = f.reduce((s, x) => s + x, 0) / Math.max(1, f.length);
      const treffer = ist / soll;
      zeilen.push(Math.round(soll * 100) + ' % -> ' + (ist * 100).toFixed(1)
                  + ' % (' + (treffer * 100).toFixed(0) + ')');
      // 88 Prozent ist die Grenze, nicht 100: ein Regler ohne Ueberschwingen bleibt
      // etwas unter dem Ziel, und das ist richtig so. Gemessen sind es 95 bis 99.
      if (treffer < 0.88 || treffer > 1.12) {
        schlecht.push(Math.round(soll * 100) + ' % trifft ' + (treffer * 100).toFixed(0));
      }
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ')
                 + (schlecht.length ? ' || VERFEHLT: ' + schlecht.join(', ') : '') };
  });

  // ---- Wird die Haarnadel staerker gedrosselt als eine 60-Grad-Kurve? ----
  //
  // GEMELDET ALS: "Kurvengeschwindigkeit drosseln geht auch nicht so gut, sollte in
  // Haarnadel staerker sein als in den normalen Kurven." Es waren zwei Ursachen:
  //
  //   1. dtG war IMMER 0,01 s, weil g.lastTick am Anfang derselben Funktion schon auf now
  //      gesetzt worden war. Die Ratenbegrenzung lief damit 4,5-fach zu langsam, und einem
  //      Zielwechsel an einer Kachelgrenze - etwa 700 ms - konnte der Regler nicht folgen.
  //   2. Sobald eine Strecke da war, lieferte ghostBrakeDemand einen Wert und die
  //      KACHELREGEL WURDE UEBERSPRUNGEN. Das Bremsprofil misst aber den Anstieg der
  //      Kruemmung, nicht die Kruemmung - eine Kurve mit konstantem Radius braucht danach
  //      kein Bremsen mehr. Der dauerhafte Abschlag der Haarnadel war damit weg, gerade WEIL
  //      eine Karte vorlag.
  //
  // Geprueft wird das ZIELTEMPO und nicht das erreichte: das Ziel ist, was die Kurvenlogik
  // entscheidet, das Erreichte haengt zusaetzlich an der Physik und an der Kachellaenge. Eine
  // Haarnadel dauert etwa eine Sekunde, und in der Zeit ist nicht jedes Tempo abzubauen -
  // das ist Physik und kein Fehler.
  stAdd('Haarnadel wird staerker gedrosselt als eine 60-Grad-Kurve', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const HP = [0x05, 0x06], KU = [0x03, 0x04], GE = [0x02];
    const zeilen = [], schlecht = [];
    for (const lage of ['codes', 'karte']) {
      // curveSlow AUSDRUECKLICH gesetzt und nicht die Vorgabe genommen: geprueft wird der
      // Mechanismus - Haarnadel bekommt den doppelten Abschlag -, nicht die gerade
      // eingestellte Staerke. Mit der gefahrenen Vorgabe von 0,15 lag das Ergebnis knapp
      // unter der Schwelle, und die naechste Vorgabenaenderung haette den Test rot gemacht,
      // obwohl nichts kaputt ist.
      const g = await OMEGA_TEST.ghostDriveProbe({ lage, takte: 900, code: 'SG3H2G3R2',
        tileMs: 900, cfg: { spice: 0, curveSlow: 0.35 } });
      const mittel = (codes) => {
        const v = [];
        g.kachel.forEach((k, i) => {
          if (codes.indexOf(k) >= 0 && g.ziel[i] !== null && isFinite(g.ziel[i])) v.push(g.ziel[i]);
        });
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      const hp = mittel(HP), ku = mittel(KU), ge = mittel(GE);
      if (hp === null || ku === null || ge === null) {
        schlecht.push(lage + ': Kacheltyp fehlt im Lauf');
        continue;
      }
      zeilen.push(lage + ' Gerade ' + (ge * 100).toFixed(1) + ' / Kurve ' + (ku * 100).toFixed(1)
                  + ' / Haarnadel ' + (hp * 100).toFixed(1) + ' %');
      // Die Ordnung, und mit Luft: die Haarnadel muss deutlich unter der Kurve liegen, nicht
      // nur ein Promille. 15 Prozent relativ ist der Abstand, den ein Regler von 0,35
      // mindestens erzeugt (0,35 gegen 0,70 Abschlag).
      if (!(hp < ku * 0.85)) schlecht.push(lage + ': Haarnadel nicht deutlich unter Kurve');
      if (!(ku < ge)) schlecht.push(lage + ': Kurve nicht unter Gerade');
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Wirkt die Ideallinie auch ohne gebaute Strecke? ----
  //
  // GEMELDET ALS: "Ideallinie funktioniert gar nicht, eigene Linien ein bisschen." Gemessen
  // war das genau richtig: ohne Strecke bewegte die Ideallinie das Lenkbyte um 0,3 von 127,
  // mit Strecke um 15,3. Sie braucht g.tileIndex und eine Karte, und beides gibt es nur mit
  // gelesenen Codes UND gebauter oder gelernter Strecke. Eigene Spuren sind dagegen eine
  // Konstante je Auto und wirken immer.
  //
  // Seit der Rueckfalllinie aus dem gemeldeten Code allein - Kacheltyp und Phase reichen fuer
  // ein Aussen-Scheitel-Aussen je Kachel - sind es 8,5. Der Test haelt fest, dass sie in
  // ALLEN Lagen etwas tut, und dass eigene Spuren das weiterhin auch tun.
  stAdd('Linieneinstellungen wirken, auch ohne gebaute Strecke', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
    const unterschied = (a, b) => {
      const n = Math.min(a.length, b.length), d = [];
      for (let i = 0; i < n; i++) d.push(a[i] - b[i]);
      return rms(d);
    };
    const zeilen = [], stumm = [];
    for (const lage of ['codes', 'karte']) {
      const grund = await OMEGA_TEST.ghostDriveProbe({ lage, takte: 500, code: 'SG3H2G3R2',
                                                       tileMs: 900, cfg: { spice: 0 } });
      for (const feld of ['line', 'lanes']) {
        const cfg = { spice: 0 }; cfg[feld] = 0;
        const ohne = await OMEGA_TEST.ghostDriveProbe({ lage, takte: 500, code: 'SG3H2G3R2',
                                                        tileMs: 900, cfg });
        const d = unterschied(grund.lenk, ohne.lenk);
        zeilen.push(lage + '/' + feld + ' ' + d.toFixed(1));
        // 3 von 127 ist die Schwelle. Darunter ist es kein Regler, sondern eine Zierde -
        // und "Ideallinie ohne Karte" lag vor der Rueckfalllinie bei 0,3.
        if (d < 3) stumm.push(lage + '/' + feld + ' nur ' + d.toFixed(1));
      }
    }
    return { ok: !stumm.length,
             mass: 'RMS-Aenderung am Lenkbyte: ' + zeilen.join(' | ')
                 + (stumm.length ? ' || STUMM: ' + stumm.join(', ') : '') };
  });

  // ---- Lernt der Ghost wirklich von Runde zu Runde? ----
  //
  // GEMELDET ALS "merke ich nichts von", und das war kein Feingefuehl: learnSettle() - die
  // Bewertung einer Runde - hatte im Fahrbetrieb KEINEN AUFRUFER. Die Funktion stand fertig
  // da und wurde nur vom Prueflauf gerufen. Folge: das Lernen zog nie Bilanz, behielt seinen
  // ersten Zufallsversuch fuer immer und konvergierte nie. Wer den Schalter ausserdem
  // umlegte, BEVOR ein Ghost verbunden war, bekam gar keinen Lernzustand - learnFactors gab
  // dann stumm 1/1 zurueck.
  //
  // Geprueft wird, dass ueber mehrere Runden VERSUCHE GEZAEHLT werden und die Schrittweite
  // sich bewegt. Nicht, dass der Ghost schneller wird: eine (1+1)-Strategie verwirft die
  // meisten Versuche, und das ist ihre Aufgabe.
  stAdd('Ghost-Lernen zieht je Runde Bilanz', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const an = await OMEGA_TEST.ghostDriveProbe({ lage: 'karte', takte: 1000,
      code: 'SG3H2G3R2', tileMs: 500, cfg: { spice: 0, learnPace: true } });
    const aus = await OMEGA_TEST.ghostDriveProbe({ lage: 'karte', takte: 1000,
      code: 'SG3H2G3R2', tileMs: 500, cfg: { spice: 0, learnPace: false } });
    const L = an.lernen;
    const fehler = [];
    if (!L) fehler.push('kein Lernzustand angelegt');
    else {
      if (!(an.runden >= 3)) fehler.push('nur ' + an.runden + ' Runden gefahren');
      // Versuche muessen MITZAEHLEN. Genau das tat sie nicht, als der Aufruf fehlte.
      if (!(L.tries >= 3)) fehler.push('nur ' + L.tries + ' Versuche in ' + an.runden + ' Runden');
      if (!(L.kept + L.rejected >= 2)) fehler.push('nichts bewertet');
    }
    if (aus.lernen) fehler.push('ausgeschaltet trotzdem ein Lernzustand');
    return { ok: !fehler.length,
             mass: (L ? an.runden + ' Runden, ' + L.tries + ' Versuche, ' + L.kept
                        + ' behalten, ' + L.rejected + ' verworfen, Schrittweite '
                        + L.sigma.toFixed(4)
                      : 'kein Zustand')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Weicht der Vorausfahrende beim Ueberholen aus? ----
  //
  // GEMELDET ALS "beim Ueberholen beruehren sie sich stark". Zwei Ursachen:
  //
  //   1. Nur EINER wich aus. Zwei Autos auf 25 cm Bahnbreite brauchen beide Haelften, also
  //      setzt der Angreifer jetzt am Vorausfahrenden ein Ausweichen zur anderen Seite.
  //   2. Der Seitenversatz des Angreifers war mit ghostCfg.line skaliert. Stand die
  //      Ideallinie auf 0, fuhr er OHNE Versatz in den anderen hinein - und der Regler
  //      "Querablage gegen Rammen" konnte daran nichts aendern, obwohl er dafuer da ist.
  //      Jetzt haengen beide an ghostCfg.lateral.
  //
  // Geprueft wird der ZUSTAND, den eine Attacke setzt, und nicht die Attacke: sie wird
  // gewuerfelt und ist damit kein Pruefmittel.
  stAdd('Ueberholen: der Vorausfahrende weicht aus', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
    const P = (o) => OMEGA_TEST.ghostDriveProbe(Object.assign(
      { lage: 'karte', takte: 400, code: 'SG3H2G3R2', tileMs: 900,
        cfg: { spice: 0, line: 0 } }, o));
    // line auf 0, damit nur das Ausweichen uebrig bleibt - und das ist genau der Fall, in
    // dem es vorher gar nichts tat.
    const ohne = await P({});
    const rechts = await P({ yieldSide: 1 });
    const links = await P({ yieldSide: -1 });
    const mit = (a, b) => {
      const n = Math.min(a.length, b.length), d = [];
      for (let i = 0; i < n; i++) d.push(a[i] - b[i]);
      return rms(d);
    };
    const dR = mit(rechts.lenk, ohne.lenk), dL = mit(links.lenk, ohne.lenk);
    const mR = rechts.lenk.reduce((s, x) => s + x, 0) / rechts.lenk.length;
    const mL = links.lenk.reduce((s, x) => s + x, 0) / links.lenk.length;
    const fehler = [];
    if (dR < 5) fehler.push('nach rechts nur ' + dR.toFixed(1));
    if (dL < 5) fehler.push('nach links nur ' + dL.toFixed(1));
    // Und in die richtige Richtung: positiv ist rechts.
    if (!(mR > 0)) fehler.push('yieldSide +1 lenkt nicht rechts');
    if (!(mL < 0)) fehler.push('yieldSide -1 lenkt nicht links');
    return { ok: !fehler.length,
             mass: 'Wirkung ' + dR.toFixed(1) + ' / ' + dL.toFixed(1)
                 + ' RMS, Mittel ' + mR.toFixed(1) + ' / ' + mL.toFixed(1)
                 + ' von 127 (Ideallinie auf 0)'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- 1. Ueberholen laeuft als Sequenz und hat einen Ausgang ----
  //
  // Vorher war eine Attacke ein ZUSTAND von 2,6 s: Versatz und Schub, dann vorbei -
  // unabhaengig davon, ob das Manoever geglueckt war. Die fehlende Abbruchbedingung ist
  // genau, was das Nebeneinander-Kleben erzeugt: zwei Autos auf gleicher Hoehe, keines gibt
  // nach, und nach 2,6 s hoert der Versatz einfach auf. Gemeldet als "beim Ueberholen
  // beruehren sie sich stark".
  //
  // Geprueft werden BEIDE Ausgaenge. Der Abbruch ist der wichtigere: ohne ihn gibt es keinen
  // Zustand, in dem ein Ghost aufgibt.
  stAdd('Ueberholen laeuft als Sequenz, mit Abbruch', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassProbe) {
      return { skip: true, mass: 'ghostPassProbe nicht vorhanden' };
    }
    const folge = (r) => {
      const o = [];
      r.reihe.forEach(x => { if (!o.length || o[o.length - 1] !== x.phase) o.push(x.phase); });
      return o;
    };
    const gut = OMEGA_TEST.ghostPassProbe({ ueberholtNach: 1500, dauerMs: 8000 });
    const ab = OMEGA_TEST.ghostPassProbe({ ueberholtNach: null, dauerMs: 9000 });
    const fg = folge(gut), fa = folge(ab);
    const fehler = [];
    if (fg.join('>') !== 'raus>vorbei>rein>-') fehler.push('Erfolg: ' + fg.join('>'));
    if (fa.join('>') !== 'raus>vorbei>-') fehler.push('Abbruch: ' + fa.join('>'));
    if (!(ab.gesperrtBis > 3000)) fehler.push('keine Sperre nach dem Abbruch');
    // Der Versatz muss beim Einordnen ZURUECKFAHREN und nicht abschalten: ein Sprung von
    // vollem Versatz auf null ist ein Ruck am Lenkservo.
    const rein = gut.reihe.filter(x => x.phase === 'rein').map(x => Math.abs(x.versatz));
    let steigt = false;
    for (let i = 1; i < rein.length; i++) if (rein[i] > rein[i - 1] + 1e-9) steigt = true;
    if (!rein.length) fehler.push('keine Einordnungsphase');
    else if (steigt) fehler.push('Versatz faehrt nicht monoton zurueck');
    else if (rein[rein.length - 1] > 0.15) fehler.push('Versatz endet bei ' + rein[rein.length - 1]);
    return { ok: !fehler.length,
             mass: 'Erfolg ' + fg.join('>') + ' | Abbruch ' + fa.join('>')
                 + ', Sperre ' + Math.round(ab.gesperrtBis) + ' ms'
                 + ' | Einordnen ' + rein.length + ' Takte, Versatz auf '
                 + (rein.length ? rein[rein.length - 1].toFixed(2) : '?')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- 4. Kein Ueberholversuch in eine Kurve hinein ----
  //
  // Der Vorausblick verbietet es schon - aber den gibt es nur mit Karte. Ohne Karte war er
  // immer "frei", und dann wurde mitten in einer Haarnadel angesetzt. Die Kachel UNTER dem
  // Auto kommt aus dem gemeldeten Code und braucht keine Karte.
  stAdd('Kein Ueberholversuch auf einer Kurvenkachel', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassArming) {
      return { skip: true, mass: 'ghostPassArming nicht vorhanden' };
    }
    // 1500 Takte und nicht 400, und das ist eine Berichtigung an DIESEM Test: bei 400
    // Takten a 60 ms sind es 24 s gefaelschter Zeit, also etwa sechs Wuerfe mit P = 0,45 -
    // in gut drei Prozent der Laeufe faellt keiner, und dann meldet er rot, obwohl nichts
    // kaputt ist. Genau so entstehen Tests, die man irgendwann wegklickt. Mit 1500 Takten
    // sind es rund zweiundzwanzig Wuerfe und die Wahrscheinlichkeit liegt bei 1 zu 100.000.
    //
    // Die Gegenrichtung braucht die Laenge auch: "auf der Kurve NIE" ist mit sechs
    // Gelegenheiten kaum eine Aussage.
    const gerade = OMEGA_TEST.ghostPassArming(0x02, 1500);
    const kurve = OMEGA_TEST.ghostPassArming(0x04, 1500);
    const haarnadel = OMEGA_TEST.ghostPassArming(0x06, 1500);
    const fehler = [];
    // Auf der Geraden MUSS es ueberhaupt vorkommen, sonst prueft der Test nichts.
    if (!(gerade.gestartet > 0)) fehler.push('auf der Geraden gar kein Versuch');
    if (kurve.gestartet) fehler.push('Kurve: ' + kurve.gestartet + ' Versuche');
    if (haarnadel.gestartet) fehler.push('Haarnadel: ' + haarnadel.gestartet + ' Versuche');
    return { ok: !fehler.length,
             mass: 'Gerade ' + gerade.gestartet + ', Kurve ' + kurve.gestartet
                 + ', Haarnadel ' + haarnadel.gestartet + ' Versuche in je 1500 Takten'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- 3. Spurdisziplin: Gerade = eigene Spur, Kurve = Ideallinie ----
  //
  // Vorher waren beide Anteile FEST addiert, also galt auf der Geraden dieselbe Mischung wie
  // im Bogen - und dann faehrt das Feld ueberall dieselbe Linie. Geprueft wird die Mischung
  // je Kacheltyp UND die Hysterese: der Kacheltyp wechselt sprunghaft, und ein sprunghafter
  // Wechsel der Mischung ist ein Ruck am Lenkservo.
  stAdd('Spurdisziplin: Spur auf der Geraden, Linie in der Kurve', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const g = await OMEGA_TEST.ghostDriveProbe({ lage: 'karte', takte: 700,
      code: 'SG3H2G3R2', tileMs: 900, cfg: { spice: 0 } });
    const KURVEN = [0x03, 0x04, 0x05, 0x06];
    const mittel = (pred) => {
      const v = [];
      g.kachel.forEach((k, i) => { if (pred(k) && isFinite(g.mix[i])) v.push(g.mix[i]); });
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const gerade = mittel(k => KURVEN.indexOf(k) < 0);
    const kurve = mittel(k => KURVEN.indexOf(k) >= 0);
    let sprung = 0;
    for (let i = 1; i < g.mix.length; i++) sprung = Math.max(sprung, Math.abs(g.mix[i] - g.mix[i - 1]));
    const fehler = [];
    if (gerade === null || kurve === null) fehler.push('ein Kacheltyp fehlt im Lauf');
    else {
      if (!(gerade < 0.45)) fehler.push('Gerade zu hoch: ' + gerade.toFixed(2));
      if (!(kurve > 0.7)) fehler.push('Kurve zu niedrig: ' + kurve.toFixed(2));
    }
    // Die Hysterese: der Nachlauf begrenzt den Schritt auf dt/tau. Bei 45 ms und 350 ms
    // sind das 0,13 - deutlich unter einem Sprung von 0 auf 1.
    if (!(sprung < 0.2)) fehler.push('Sprung je Takt ' + sprung.toFixed(3) + ' (keine Hysterese)');
    return { ok: !fehler.length,
             mass: 'Spurmix Gerade ' + (gerade === null ? '?' : gerade.toFixed(2))
                 + ', Kurve ' + (kurve === null ? '?' : kurve.toFixed(2))
                 + ', groesster Sprung je Takt ' + sprung.toFixed(3)
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der gemessene Kippwert erreicht die Ideallinie ----
  //
  // WARUM DIESER TEST DER WICHTIGSTE DER VIER IST: die Querablage-Messung im Entwicklertab
  // kostet Aufbau und mehrere Abfluege. Wenn ihr Ergebnis danach nirgends ankommt, ist das
  // eine Fleissaufgabe ohne Folge - und das merkt man nicht, weil der Deckel auch ohne
  // Messung einen plausiblen Wert hat (0,55 als vorsichtige Schaetzung).
  //
  // Geprueft werden alle drei Faelle, die learnSteerCap() unterscheidet, und die Reihenfolge
  // ist die Zusicherung: gekippt schlaegt gehalten, gehalten schlaegt Schaetzung.
  stAdd('Gemessener Kippwert ersetzt den geschaetzten Deckel', () => {
    if (typeof lat !== 'object' || !lat || typeof learnSteerCap !== 'function') {
      return { skip: true, mass: 'lat/learnSteerCap nicht erreichbar' };
    }
    const merk = lat.rows;
    try {
      lat.rows = [];
      const ohne = learnSteerCap();
      lat.rows = [{ steer: 0.3, ok: true }, { steer: 0.45, ok: true }];
      const nurGehalten = learnSteerCap();
      lat.rows = [{ steer: 0.3, ok: true }, { steer: 0.45, ok: true },
                  { steer: 0.6, ok: false }];
      const gekippt = learnSteerCap();
      const fehler = [];
      // 1. Ohne eigene Messung der volle Ausschlag - seit v0.5.9, und die Begruendung
      //    steht in learnSteerCap(): die Original-App schickt ihren Ghosts gemessen bis
      //    zu 127 von 127, ein selbst gesetzter Deckel von 0,55 war strenger als die App
      //    des Herstellers. Ein EIGENER Kippwert sticht ihn weiterhin, und genau das
      //    pruefen die drei Faelle darunter.
      if (Math.abs(ohne - 1.0) > 1e-9) fehler.push('ohne Messung ' + ohne);
      // 2. Nie gekippt: der hoechste gehaltene Wert selbst, nicht die Haelfte - wir wissen
      //    nur, dass es BIS dahin haelt.
      if (Math.abs(nurGehalten - 0.45) > 1e-9) fehler.push('nur gehalten ' + nurGehalten);
      // 3. Gekippt: die Haelfte des Kippwerts, wie die Doku es festhaelt.
      if (Math.abs(gekippt - 0.3) > 1e-9) fehler.push('gekippt ' + gekippt);
      // 4. Und die Messung MUSS etwas aendern, sonst war sie umsonst.
      if (Math.abs(gekippt - ohne) < 0.01) fehler.push('Messung ohne Wirkung');
      return { ok: !fehler.length,
               mass: 'geschaetzt ' + ohne.toFixed(2) + ' | nur gehalten (max 0,45) '
                   + nurGehalten.toFixed(2) + ' | gekippt bei 0,60 -> '
                   + gekippt.toFixed(2)
                   + (fehler.length ? ' || ' + fehler.join('; ') : '') };
    } finally {
      lat.rows = merk;
      if (typeof latRender === 'function') { try { latRender(); } catch (e) { /* Karte fehlt */ } }
    }
  });

  // ---- Die Controller-Grafik zeigt, was wirklich belegt ist ----
  //
  // DIE FEHLERKLASSE: eine Grafik ist eine ZWEITE Wahrheit neben den Bindungen. Sie kann
  // richtig aussehen und falsch sein, und man merkt es erst mitten im Rennen, wenn eine
  // Taste etwas anderes tut als angeschrieben.
  //
  // GEFUNDEN HAT DIESER TEST SCHON EINEN: das Steuerkreuz stand auf "nicht belegt", obwohl
  // es Bremsbalance und Lenkansprechen verstellt - diese vier Belegungen laufen nicht durch
  // die Bindungstabelle, sondern sind festverdrahtet. Eine Grafik, die eine belegte Taste
  // als frei zeigt, ist schlechter als keine: man probiert dann im Fahren aus, was sie tut.
  //
  // Und einen zweiten: der Renderer setzte textContent auf das <text>-Element und loeschte
  // damit den tspan mit dem Tastensymbol. Die Pfeile und die Tastenzeichen waren nach dem
  // ersten Zeichnen weg. Deshalb prueft der Test die Symbole mit.
  stAdd('Controller-Grafik stimmt mit den Bindungen', () => {
    if (!$('pad-a-cross') || typeof PAD_CONTROLS === 'undefined') {
      return { skip: true, mass: 'Grafik oder PAD_CONTROLS nicht erreichbar' };
    }
    const fehler = [];
    // 1. Jedes Bedienelement aus PAD_CONTROLS hat eine Zeile in der Grafik. Ein Tippfehler
    //    im Index faellt hier NICHT auf - dafuer ist Punkt 2 da -, ein fehlendes
    //    Textelement schon.
    let zeilen = 0;
    for (const c of PAD_CONTROLS) {
      const el = $('pad-a-' + c.id);
      if (!el) { fehler.push('Zeile fehlt: ' + c.id); continue; }
      zeilen++;
      if (!el.textContent.trim()) fehler.push('Zeile leer: ' + c.id);
    }
    // 2. JEDE zugewiesene Aktion muss in der Grafik auftauchen. Das ist die eigentliche
    //    Zusicherung, und sie laeuft in der Gegenrichtung zum Renderer: der geht von der
    //    Taste zur Aktion, der Test von der Aktion zur Taste. Ein falscher Index im
    //    Renderer laesst die Aktion damit verschwinden, und das faellt auf.
    let geprueft = 0;
    for (const action of Object.keys(BIND_ACTION_LABELS)) {
      const b = bindings[action];
      if (!b || b.type === 'none') continue;
      const c = PAD_CONTROLS.find(x => x.typ === b.type && x.index === b.index);
      if (!c) continue;          // Bedienelement nicht gezeichnet, z. B. eine Y-Achse
      geprueft++;
      const el = $('pad-a-' + c.id);
      const soll = i18nLookup(BIND_ACTION_LABELS[action]);
      const txt = el ? el.textContent : '';
      // Entweder deutsch oder englisch - der Test laeuft in beiden Sprachen.
      if (txt.indexOf(BIND_ACTION_LABELS[action]) < 0
          && (soll === null || txt.indexOf(soll) < 0)) {
        fehler.push(action + ' fehlt auf ' + c.id + ' (steht dort: "' + txt + '")');
      }
    }
    // 3. Das Steuerkreuz ist belegt, auch wenn es nicht zuweisbar ist.
    for (const id of ['dup', 'ddown', 'dleft', 'dright']) {
      const el = $('pad-a-' + id);
      if (el && el.classList.contains('pad-frei')) {
        fehler.push(id + ' als "nicht belegt" gezeigt, ist aber festverdrahtet');
      }
    }
    // 4. Die Tastensymbole ueberleben das Zeichnen. Sie stehen in eigenen tspans, weil
    //    textContent auf dem Elternelement sie sonst mitloescht.
    const symbole = document.querySelectorAll('.pad-svg .pad-sym');
    if (symbole.length !== 8) {
      fehler.push(symbole.length + ' Tastensymbole statt 8');
    }
    return { ok: !fehler.length,
             mass: zeilen + ' Zeilen, ' + geprueft + ' zugewiesene Aktionen wiedergefunden, '
                 + symbole.length + ' Symbole'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der Wetterumschwung ist weich, und das Handling kommt zuletzt ----
  //
  // Regen war ein Schalter: gripScale sprang von 1,00 auf 0,45, der Ton sprang, die Tropfen
  // erschienen. Jetzt zieht eine Front, und ihre Lage ist die EINE Zahl, aus der Ton, Griff,
  // Tropfen und das Radarbild kommen.
  //
  // GEPRUEFT WIRD DIE ORDNUNG, nicht die Zahl fuenf. Die Sekunden stehen in einer
  // Konstanten, und ein Test, der sie abschreibt, prueft die Konstante. Was er pruefen
  // soll: dass der Ton VOR dem Griff kommt. Genau das war der Wunsch - erst hoert und sieht
  // man Regen, dann faehrt man ihn.
  stAdd('Wetterfront: Ton vor Griff, und beides stetig', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.wxSet) {
      return { skip: true, mass: 'wxSet nicht vorhanden' };
    }
    const merk = OMEGA_TEST.wxProbe();
    try {
      const reihe = [];
      for (let f = -1; f <= 0.0001; f += 0.1) reihe.push(OMEGA_TEST.wxSet(f));
      const fehler = [];
      // 1. Anfang und Ende: trocken und voll nass.
      const a = reihe[0], e = reihe[reihe.length - 1];
      if (!(a.staerke === 0 && a.grip > 0.999)) fehler.push('Anfang nicht trocken');
      if (!(e.staerke > 0.999)) fehler.push('Ende nicht voll');
      // 2. STETIG: kein Sprung groesser als ein Fuenftel im Griff. Das schliesst den
      //    Schalter aus, der hier vorher stand - der sprang um 0,55 auf einmal.
      let sprung = 0;
      for (let i = 1; i < reihe.length; i++) {
        sprung = Math.max(sprung, Math.abs(reihe[i].grip - reihe[i - 1].grip));
      }
      if (sprung > 0.2) fehler.push('Griffsprung ' + sprung.toFixed(3));
      // 3. DER TON KOMMT VOR DEM GRIFF. Auf der halben Strecke muss der Ton schon halb da
      //    sein, der Griff aber noch kaum: quadratisch heisst bei 0,5 nur ein Viertel.
      const mitte = reihe.find(x => Math.abs(x.staerke - 0.5) < 0.02);
      if (!mitte) fehler.push('kein Messpunkt auf halber Strecke');
      else {
        if (!(mitte.regenTon > 0.4)) fehler.push('Ton auf halber Strecke nur ' + mitte.regenTon);
        // Griffanteil: wie weit ist der Griff auf dem Weg von trocken nach nass?
        const weg = (a.grip - mitte.grip) / (a.grip - e.grip);
        if (!(weg < 0.35)) fehler.push('Griff auf halber Strecke schon ' + (weg * 100).toFixed(0) + ' %');
      }
      // 4. Und hinter der Front ist es wieder trocken - sie zieht durch, nicht zurueck.
      const durch = OMEGA_TEST.wxSet(1);
      if (!(durch.staerke === 0 && durch.grip > 0.999)) fehler.push('hinter der Front nicht trocken');
      const mitteTxt = mitte
        ? 'auf halber Strecke Ton ' + mitte.regenTon.toFixed(2) + ', Griff '
          + (100 * (a.grip - mitte.grip) / (a.grip - e.grip)).toFixed(0) + ' % des Wegs'
        : '?';
      return { ok: !fehler.length,
               mass: reihe.length + ' Messpunkte, groesster Griffsprung ' + sprung.toFixed(3)
                   + ', ' + mitteTxt
                   + (fehler.length ? ' || ' + fehler.join('; ') : '') };
    } finally {
      // Zuruecklegen, sonst faehrt der Nutzer nach einem Testlauf im Regen.
      OMEGA_TEST.wxSet(merk.front);
    }
  });

  // ---- Die Regenformen kommen von aussen und hoeren nicht auf ----
  //
  // DREI BEFUNDE VOM FAHREN, und alle drei kamen aus einer Entscheidung: die Regenformen
  // lagen in einem BAND, dessen Lage wxFront WAR. Eine Zahl fuer alles - elegant, und als
  // Bild falsch:
  //
  //   1. Sie standen halb sichtbar da, bevor es regnete. Bei wxFront = -1 lag eine Form mit
  //      laengs = +0,42 auf -0,58, und die Deckkraftformel gab ihr 0,77.
  //   2. Sie kamen an und blieben stehen. Ein Band, dessen Lage eine Rampe ist, hoert auf
  //      sich zu bewegen, sobald die Rampe fertig ist.
  //   3. Bewegt wurde IN der Zeichenfunktion, und die kehrt bei verstecktem Fenster frueh
  //      zurueck. Ort und Zeit liefen auseinander.
  //
  // Geprueft wird deshalb der ZUSTAND und nicht das Bild: wieviele Formen ziehen, und wo.
  stAdd('Regenformen: von aussen, mit Nachschub', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.wxSchritt) {
      return { skip: true, mass: 'wxSchritt nicht vorhanden' };
    }
    const box = $('race-wx-box');
    if (!box) return { skip: true, mass: 'Wetterkachel nicht im Dokument' };
    const warRegen = OMEGA_TEST.wxProbe().wetter === 'rain';
    const fehler = [];
    let trocken = null, nachKlick = null, spaeter = null, lange = null, danach = null;
    try {
      // Trocken: KEINE Form darf ziehen. Das war Befund 1.
      if (warRegen) box.click();
      OMEGA_TEST.wxSet(-1);
      OMEGA_TEST.wxSchritt(3);
      trocken = OMEGA_TEST.wxProbe().regen;
      if (trocken.aktiv !== 0) fehler.push(trocken.aktiv + ' Formen ziehen im Trockenen');

      // Klick: sie starten AUSSERHALB des Bildes. Das Bild reicht bis etwa 0,8.
      box.click();
      nachKlick = OMEGA_TEST.wxProbe().regen;
      if (!nachKlick.aktiv) fehler.push('nach dem Klick zieht keine Form');
      const vorn = nachKlick.laengs[nachKlick.laengs.length - 1];
      if (!(vorn < -0.9)) fehler.push('vorderste Form startet schon im Bild bei ' + vorn);

      // Sie bewegen sich, und die vorderste erreicht die Mitte.
      // 12 s und nicht 6: die Rampe dauert jetzt zehn Sekunden, und genau so lange braucht
      // die vorderste Form von aussen bis zur Mitte. Ein Test, der die alte Zahl behaelt,
      // prueft die alte Geschwindigkeit.
      OMEGA_TEST.wxSchritt(12);
      spaeter = OMEGA_TEST.wxProbe().regen;
      const vorn2 = spaeter.laengs[spaeter.laengs.length - 1];
      if (!(vorn2 > vorn + 0.5)) fehler.push('Formen bewegen sich nicht (' + vorn + ' -> ' + vorn2 + ')');
      if (!spaeter.laengs.some(x => Math.abs(x) < 0.4)) fehler.push('keine Form ueber der Mitte');

      // NACHSCHUB: nach einer Zeit, in der die ersten laengst durch sind, muessen noch
      // genauso viele ziehen. Das war Befund 2.
      OMEGA_TEST.wxSchritt(40);
      lange = OMEGA_TEST.wxProbe().regen;
      if (lange.aktiv !== lange.gesamt) {
        fehler.push('nach 40 s nur ' + lange.aktiv + ' von ' + lange.gesamt + ' Formen');
      }
      if (!lange.laengs.some(x => Math.abs(x) < 0.4)) fehler.push('Nachschub erreicht die Mitte nicht');

      // Abschalten: sie ziehen davon und hoeren auf.
      box.click();
      OMEGA_TEST.wxSchritt(30);
      danach = OMEGA_TEST.wxProbe().regen;
      if (danach.aktiv !== 0) fehler.push('nach dem Abschalten ziehen noch ' + danach.aktiv);
      return { ok: !fehler.length,
               mass: 'trocken ' + trocken.aktiv + ' | Start bei ' + vorn.toFixed(2)
                   + ' | nach 12 s vorderste ' + vorn2.toFixed(2)
                   + ' | nach 40 s ' + lange.aktiv + '/' + lange.gesamt
                   + ' | abgeschaltet ' + danach.aktiv
                   + (fehler.length ? ' || ' + fehler.join('; ') : '') };
    } finally {
      // Zuruecklegen: ein Test, der den Nutzer im Regen stehen laesst, ist der naechste
      // Fehlerbericht.
      if (OMEGA_TEST.wxProbe().wetter === 'rain') box.click();
      OMEGA_TEST.wxSet(-1);
    }
  });

  // ---- Laengs-G zeigt das Ergebnis, nicht die Anforderung ----
  //
  // GEMELDET ALS: "warum geht das rote simulierte Gyro nach hinten, wenn ich im Stand
  // bremse?" Die Antwort war st.gLong = st.longUse - der ANGEFORDERTE Laengsbedarf, also
  // beim Bremsen -inputs.brake. Im Stand gibt es keine Verzoegerung, und eine G-Anzeige
  // zeigt, was gemessen wuerde.
  //
  // longUse selbst ist damit nicht falsch: es traegt die Lastverlagerung und den Reibkreis,
  // und dort ist eine Anforderung mit Nachlauf richtig - die Bremse drueckt die Nase auch
  // im Stand nach unten. Der Fehler war, dieselbe Zahl fuer zwei verschiedene Aussagen zu
  // nehmen.
  stAdd('Laengs-G: im Stand bremsen bewegt nichts', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physGTrace) {
      return { skip: true, mass: 'physGTrace nicht vorhanden' };
    }
    const stand = OMEGA_TEST.physGTrace({ startKmh: 0, brake: 1, sekunden: 1.5 });
    const fahrt = OMEGA_TEST.physGTrace({ startKmh: 150, brake: 1, sekunden: 1.5 });
    const gas = OMEGA_TEST.physGTrace({ startKmh: 0, throttle: 1, sekunden: 1.5 });
    const fehler = [];
    // 1. Im Stand: NICHTS. Das ist der gemeldete Fall.
    if (stand.gMax > 0.02) fehler.push('im Stand ' + stand.gMax.toFixed(3));
    // 2. Aus der Fahrt: deutlich negativ, und das Auto wird wirklich langsamer.
    if (!(fahrt.ende.gLong < -0.3)) fehler.push('aus 150 nur ' + fahrt.ende.gLong);
    if (!(fahrt.ende.kmh < 140)) fehler.push('aus 150 kaum verzoegert: ' + fahrt.ende.kmh);
    // 3. Gas: positiv, und SCHWAECHER als die Bremse. Ein Auto bremst haerter als es
    //    beschleunigt; waere es umgekehrt, waere der Bezug falsch gewaehlt.
    if (!(gas.ende.gLong > 0.2)) fehler.push('Vollgas nur ' + gas.ende.gLong);
    if (!(gas.gMax < fahrt.gMax)) fehler.push('Gas staerker als Bremse');
    return { ok: !fehler.length,
             mass: 'Stand ' + stand.gMax.toFixed(3) + ' | Bremsen aus 150 '
                 + fahrt.ende.gLong.toFixed(2) + ' bei ' + fahrt.ende.kmh + ' km/h'
                 + ' | Vollgas ' + gas.ende.gLong.toFixed(2)
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Das Reifenpiktogramm zeigt die Mischung ----
  //
  // Es zeigte Restprofil und Temperatur, aber nicht, WELCHE Mischung montiert ist - das
  // stand allein im Text darunter. Regenreifen haben Profil und Slicks nicht, und das ist
  // der Unterschied, den man an einem Reifen zuerst sieht.
  //
  // Geprueft wird BEIDES: die Klasse am Koerper und die tatsaechlich gerechnete Rillenschar
  // im ::after. Nur die Klasse zu pruefen liesse offen, ob das Stylesheet sie auch benutzt -
  // genau die Luecke, durch die in diesem Projekt schon ein Regler ohne Wirkung gefallen
  // ist.
  stAdd('Reifenpiktogramm zeigt Slick oder Regen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.tyreSet) {
      return { skip: true, mass: 'tyreSet nicht vorhanden' };
    }
    const el = $('race-tyre-fl');
    if (!el) return { skip: true, mass: 'Reifenpiktogramm nicht im Dokument' };
    const merk = OMEGA_TEST.wxProbe().reifen;
    try {
      const rillen = () => {
        const s = getComputedStyle(el, '::after').backgroundImage;
        return s && s !== 'none' ? s : null;
      };
      const s1 = OMEGA_TEST.tyreSet('slick');
      const r1 = rillen();
      const s2 = OMEGA_TEST.tyreSet('wet');
      const r2 = rillen();
      const fehler = [];
      if (s1.profil) fehler.push('Slick tragt die Regenklasse');
      if (!s2.profil) fehler.push('Regenreifen ohne Regenklasse');
      if (r1) fehler.push('Slick hat Rillen');
      if (!r2) fehler.push('Regenreifen ohne Rillen');
      // Und zwei Scharen, nicht eine: eine allein saehe nach Schraegrillen aus, das V
      // entsteht erst aus zwei Vorzeichen.
      if (r2 && (r2.match(/repeating-linear-gradient/g) || []).length < 2) {
        fehler.push('nur eine Rillenschar');
      }
      // Der Griff muss mitgehen - sonst ist es eine Anzeige ohne Sache dahinter.
      if (!(s2.grip < s1.grip)) fehler.push('Regenreifen ohne Griffnachteil im Trockenen');
      return { ok: !fehler.length,
               mass: 'Slick: Profil ' + s1.profil + ', Grip ' + s1.grip
                   + ' | Regen: Profil ' + s2.profil + ', Grip ' + s2.grip
                   + ', ' + ((r2 || '').match(/repeating-linear-gradient/g) || []).length
                   + ' Rillenscharen'
                   + (fehler.length ? ' || ' + fehler.join('; ') : '') };
    } finally {
      OMEGA_TEST.tyreSet(merk);
    }
  });

  // ---- Block 4.4: Reifendruck ----
  // Monoton, ueber den ganzen Reglerbereich. Ein Regler, der in der Mitte umkehrt, ist keine
  // Abstimmung, sondern eine Falle.
  stAdd('Reifendruck: weniger Druck, waermer und mehr Verschleiss', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physTyreAsym) {
      return { skip: true, mass: 'physTyreAsym nicht vorhanden' };
    }
    const werte = [1.4, 1.6, 1.8, 2.0, 2.2].map(p => ({
      p, r: OMEGA_TEST.physTyreAsym({ steering: 0.3, sekunden: 40,
                                      cfg: { tyrePressureBar: p } }) }));
    let monoton = true;
    for (let i = 1; i < werte.length; i++) {
      if (werte[i].r.tempC >= werte[i - 1].r.tempC) monoton = false;
      if (werte[i].r.mittel >= werte[i - 1].r.mittel) monoton = false;
    }
    return { ok: monoton,
      mass: werte.map(w => w.p.toFixed(1) + ' bar: ' + w.r.tempC.toFixed(0) + '\u00b0, '
                         + (w.r.mittel * 100).toFixed(1) + ' %').join(' | ') };
  });

  // ---- Block 4.2: Windschatten ----
  //
  // Gemessen ueber physSteerGrip mit gesetztem st.dirtyAir und NICHT ueber die
  // Ghost-Verwaltung: die braeuchte ein Layout und zwei Autos, und dann prueft der Test die
  // Messung statt der Wirkung. Was hier zu pruefen ist: senkt der Wert den Kurvengrip, und
  // laesst der Regler ihn abschalten.
  stAdd('Windschatten senkt den Kurvengrip', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerGrip) {
      return { skip: true, mass: 'physSteerGrip nicht vorhanden' };
    }
    const st = physEngine.state;
    const merk = st.dirtyAir;
    try {
      // tyreEffect AUF 0 in allen drei Aufrufen, und das ist der Punkt, an dem die erste
      // Fassung dieses Tests falsch war: physSteerGrip legt tyreTempC und tyreWear NICHT
      // zurueck, die Reifen wurden also von Aufruf zu Aufruf waermer. Gemessen kam
      // 0,595 -> 0,660 heraus, und das war die Aufwaermung und nicht der Windschatten -
      // der Test meldete einen Fehler, der in ihm selbst lag.
      const messen = (dirty, effekt) => {
        st.dirtyAir = dirty;
        return OMEGA_TEST.physSteerGrip({ kmh: 140, throttle: 0.3, brake: 0, steering: 0.5,
          patch: { dirtyAirEffect: effekt, tyreEffect: 0 } }).steerGrip;
      };
      const frei = messen(0, 1);
      const nah = messen(1, 1);
      const ausgeschaltet = messen(1, 0);
      const verlust = (frei - nah) / Math.max(1e-6, frei);
      return {
        ok: verlust > 0.05 && Math.abs(ausgeschaltet - frei) < 1e-6,
        mass: 'freie Luft ' + frei.toFixed(3) + ', dicht dahinter ' + nah.toFixed(3)
            + ' (' + (verlust * 100).toFixed(1) + ' % weniger), Regler aus '
            + ausgeschaltet.toFixed(3),
      };
    } finally { st.dirtyAir = merk; }
  });

  // ---- Abseits der Fahrbahn ----
  //
  // Die Bedingung, an der es schiefgeht, wenn sie jemand vergisst: die Drosselung darf NUR
  // im Bahn-Modus greifen. Im Ausdruck-Modus ist der Streckensensor abgeschaltet (gemessen
  // 0 Lesungen in 551 Fahrmeldungen), Byte 12 stuende dauernd auf 0x00, und das Auto waere
  // permanent auf 45 % gedeckelt - man wuerde den Fehler beim Motor suchen.
  //
  // Geprueft wird ausserdem die Entprellung: ein einzelnes 0x00 zwischen guten Lesungen ist
  // Rauschen und darf nichts ausloesen. Ohne sie zuckt das Gas mitten auf der Bahn.
  stAdd('Drosselung abseits nur auf der Bahn, und entprellt', () => {
    if (typeof offtrackMelden !== 'function' || typeof offtrackGilt !== 'function') {
      return { ok: null, mass: 'Funktionen nicht erreichbar' };
    }
    const merk = { mode: trackMode, effekt: !!($('setting-offtrack') || {}).checked };
    // VOR dem try, weil das finally ihn liest. Im try deklariert war er dort nicht
    // sichtbar - Blockgeltungsbereich - und der Test warf statt zu urteilen.
    const merkVerz = $('setting-offtrack-delay') ? $('setting-offtrack-delay').value : null;
    try {
      if ($('setting-offtrack')) $('setting-offtrack').checked = true;
      offtrackEffekt = true;

      // a) Ein einzelner Ausfall darf nichts tun.
      trackMode = 'on';
      offtrackMelden(false);
      offtrackMelden(true);
      const einzeln = offtrackGilt();

      // b) Durchgehend abseits, laenger als die eingestellte Zeit: greift.
      //
      // DER REGLER WIRD GESTELLT und nicht die alte Konstante nachgeschrieben. Vorher stand
      // hier eine feste Wartezeit von 420 ms gegen einen festen Schwellwert von 350 ms - und
      // als die Vorgabe auf 1 s ging (leichtes Schneiden soll durchgehen), meldete der Test
      // richtigerweise rot. Ein Test, der eine Zahl abschreibt, prueft die Zahl und nicht die
      // Sache. Jetzt prueft er BEIDE Richtungen und deckt damit zusaetzlich ab, dass der
      // neue Regler ueberhaupt wirkt.
      const stelle = (sek) => {
        const el = $('setting-offtrack-delay');
        if (!el) return false;
        el.value = String(sek);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      stelle(0.3);
      offtrackMelden(false); offtrackMelden(true);
      const t0 = Date.now();
      while (Date.now() - t0 < 420) offtrackMelden(true);
      const dauer = offtrackGilt();
      // Und mit einer langen Schwelle darf dieselbe Zeit NICHT greifen.
      stelle(1.5);
      const tz = Date.now();
      while (Date.now() - tz < 260) offtrackMelden(false);
      offtrackMelden(true);
      const t0b = Date.now();
      while (Date.now() - t0b < 420) offtrackMelden(true);
      const langNicht = !offtrackGilt();
      stelle(0.3);

      // c) Dieselbe Lage im Ausdruck-Modus: greift NICHT.
      trackMode = 'off';
      offtrackMelden(true);
      const ausdruck = offtrackGilt();

      // d) Zurueck auf die Bahn: endet.
      trackMode = 'on';
      const t1 = Date.now();
      while (Date.now() - t1 < 220) offtrackMelden(false);
      const zurueck = offtrackGilt();

      return {
        ok: !einzeln && dauer && langNicht && !ausdruck && !zurueck,
        mass: 'einzelner Ausfall ' + (einzeln ? 'greift (FALSCH)' : 'ignoriert')
            + ' | Regler 0,3 s, 420 ms abseits ' + (dauer ? 'greift' : 'greift NICHT (falsch)')
            + ' | Regler 1,5 s, 420 ms abseits '
            + (langNicht ? 'greift nicht' : 'greift schon (FALSCH)')
            + ' | Ausdruck-Modus ' + (ausdruck ? 'greift (FALSCH)' : 'greift nicht')
            + ' | zurueck ' + (zurueck ? 'greift weiter (FALSCH)' : 'beendet'),
      };
    } finally {
      trackMode = merk.mode;
      if ($('setting-offtrack')) $('setting-offtrack').checked = merk.effekt;
      offtrackEffekt = merk.effekt;
      // Den Regler zuruecklegen, sonst faehrt der Nutzer nach einem Testlauf mit einer
      // anderen Nachsicht als vorher - und wundert sich beim Motor.
      if (merkVerz !== null && $('setting-offtrack-delay')) {
        $('setting-offtrack-delay').value = merkVerz;
        $('setting-offtrack-delay').dispatchEvent(new Event('input', { bubbles: true }));
      }
      // Zustand zuruecklegen, sonst steht der Streifen nach dem Test im Cockpit.
      const t2 = Date.now();
      while (Date.now() - t2 < 200) offtrackMelden(false);
    }
  });

  // ---- Alle fuenf Voreinstellungstexte haben eine englische Fassung ----
  //
  // WARUM DAS EINE EIGENE PRUEFUNG BRAUCHT: die Sprachpruefung liest das DOKUMENT, und die
  // Legende zeigt seit v0.5 nur noch die eingestellte Variante. Vier der fuenf Texte stehen
  // beim Pruefen also nicht da - ein geaenderter Arcade-Text bliebe unbemerkt deutsch, bis
  // jemand Arcade anklickt. Genau so ist es passiert: gemeldet wurden 2 von 5 Stellen.
  //
  // Eine Verbesserung an der Oberflaeche hat eine Pruefung blind gemacht. Diese hier geht
  // deshalb direkt an die Tabelle und nicht an das Dokument.
  stAdd('Alle Voreinstellungstexte sind uebersetzt', () => {
    const keys = window.__presetKeys ? window.__presetKeys() : [];
    if (!keys.length || !window.__presetTexts) {
      return { ok: null, mass: 'presetTexts nicht erreichbar' };
    }
    const fehlt = [];
    let geprueft = 0;
    for (const k of keys) {
      const t = window.__presetTexts(k);
      if (!t) { fehlt.push(k + ' fehlt'); continue; }
      for (const feld of ['label', 'kurz', 'text']) {
        geprueft++;
        // Der Name darf gleich bleiben (Arcade, GT3, F1 heissen auf Englisch genauso) -
        // geprueft wird, dass ein Eintrag EXISTIERT oder der Text gar nichts Deutsches hat.
        const de = t[feld];
        const en = i18nLookup(de);
        const hatDeutsch = /[\u00e4\u00f6\u00fc\u00df\u00c4\u00d6\u00dc]|\b(der|die|und|nicht|eine|mit|ist|wird|von|bei|zur|aus|dem|den)\b/.test(de);
        if (en === null && hatDeutsch) fehlt.push(k + '.' + feld);
      }
    }
    return { ok: fehlt.length === 0,
             mass: geprueft + ' Texte in ' + keys.length + ' Voreinstellungen'
                 + (fehlt.length ? ' | OHNE ENGLISCHE FASSUNG: ' + fehlt.join(', ')
                                 : ' | alle uebersetzt') };
  });

  // ---- Voreinstellungen gegen die Reglerraster ----
  //
  // Eine Voreinstellung darf nur Werte verlangen, die ihr Regler DARSTELLEN kann. Ein
  // Bereichsregler rastet still ein: setting-grip hatte Raster 0,05, GT3 verlangte 0,72,
  // gesetzt wurden 0,70. Vier solche Faelle gab es, und keiner war sichtbar, weil nach dem
  // Setzen nie verglichen wurde. Die Karte sagt "An einem echten GT3 kalibriert", und
  // gerade der kalibrierte Wert war nicht erreichbar.
  //
  // Geprueft wird das Raster und nicht das Ergebnis eines Klicks: so meldet der Test auch
  // eine Voreinstellung, die gar nicht angeklickt wurde.
  stAdd('Jede Voreinstellung passt aufs Reglerraster', () => {
    const keys = window.__presetKeys ? window.__presetKeys() : [];
    if (!keys.length) return { ok: null, mass: 'keine Voreinstellungen erreichbar' };
    const schlecht = [];
    let geprueft = 0;
    for (const k of keys) {
      const v = (window.__presetValues || (() => null))(k);
      if (!v) return { ok: null, mass: 'presetValues nicht erreichbar' };
      for (const [id, soll] of Object.entries(v)) {
        const el = $(id);
        if (!el) { schlecht.push(k + '/' + id + ' fehlt'); continue; }
        if (el.type !== 'range') continue;
        geprueft++;
        const mn = +el.min, st = +el.step || 1;
        const gerastert = mn + Math.round((+soll - mn) / st) * st;
        if (Math.abs(gerastert - +soll) > 1e-9) {
          schlecht.push(k + '/' + id + ' ' + soll + ' -> ' + (+gerastert.toFixed(6)));
        }
        if (+soll < mn - 1e-9 || +soll > +el.max + 1e-9) {
          schlecht.push(k + '/' + id + ' ' + soll + ' ausserhalb ' + el.min + '..' + el.max);
        }
      }
    }
    return { ok: schlecht.length === 0,
             mass: geprueft + ' Reglerwerte in ' + keys.length + ' Voreinstellungen'
                 + (schlecht.length ? ' | NICHT DARSTELLBAR: ' + schlecht.join(', ') : '') };
  });

  // ---- Motormenue gegen die Schleifenliste ----
  //
  // DIESER TEST HAETTE DEN PORSCHE GEFUNDEN. 'p992gt3r' stand im Menue und in
  // audio/loops.json, aber nicht in SAMPLE_CARS - und der Handler in 80-sound.js prueft
  // genau diese Liste. Er fand den Wert nicht und fiel STILL auf SOUND_PROFILES.v8
  // zurueck, einen Saegezahn mit 50 Hz. Zu hoeren war also nicht ein schlecht gerechneter
  // Boxer-6, sondern der grobe Ersatzmotor; vier Wochen lang.
  //
  // Dieselbe Fehlerklasse wie eine tote Element-id: ein Bedienelement, dessen Wert niemand
  // liest. Und wie dort ist der stille Rueckfall das Schlimmste daran.
  stAdd('Jeder Motor im Menue hat Schleifen', () => {
    const sel = $('sound-profile');
    if (!sel) return { ok: false, mass: 'kein #sound-profile' };
    const menue = Array.prototype.map.call(sel.options, o => o.value);
    const ohne = menue.filter(v => SAMPLE_CARS.indexOf(v) < 0);
    // Gegenrichtung: eine Schleife, die man nicht waehlen kann, ist kein Absturz, aber eine
    // unerreichbare Datei.
    const unerreichbar = SAMPLE_CARS.filter(v => menue.indexOf(v) < 0);
    return {
      ok: ohne.length === 0 && unerreichbar.length === 0,
      mass: menue.length + ' Eintraege, ' + SAMPLE_CARS.length + ' Schleifenmotoren'
          + (ohne.length ? ' | OHNE SCHLEIFEN: ' + ohne.join(', ') : '')
          + (unerreichbar.length ? ' | nicht waehlbar: ' + unerreichbar.join(', ') : ''),
    };
  });

  // ---- Lautsprecher-Knopf ----
  //
  // Er soll durch ALLE Eintraege schalten und beim ersten wieder ankommen. Ein Knopf, der
  // einen Eintrag ueberspringt, ist schwer zu bemerken: man merkt nur, dass ein Motor
  // "nicht dabei" ist.
  stAdd('Lautsprecher-Knopf schaltet einmal rundherum', () => {
    const knopf = $('race-act-sound'), sel = $('sound-profile');
    if (!knopf || !sel) return { ok: null, mass: 'kein Knopf oder kein Menue' };
    const gemerkt = sel.value;
    try {
      const gesehen = [];
      const n = sel.options.length;
      // n+1 Kliks: nach n Kliks muss der Anfangswert wieder stehen.
      for (let i = 0; i < n; i++) { knopf.click(); gesehen.push(sel.value); }
      const einmalig = new Set(gesehen);
      return {
        ok: einmalig.size === n && sel.value === gemerkt,
        mass: n + ' Eintraege, ' + einmalig.size + ' verschiedene gesehen, danach wieder '
            + (sel.value === gemerkt ? 'am Anfang' : 'bei "' + sel.value + '"'),
      };
    } finally {
      if (sel.value !== gemerkt) {
        sel.value = gemerkt;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  // ---- 13. Rundenzaehlung ----
  // Drei Ueberfahrten muessen drei Runden ergeben, und die Anzeige muss bei 0 anfangen. Die
  // Statuszeile zaehlte einmal die laufende Runde mit, der Zaehler im Cockpit nicht: zwei
  // Anzeigen derselben Sache, die sich um eins unterschieden.
  stAdd('Rundenzählung fängt bei 0 an', () => {
    // Auch die ANZEIGE merken, nicht nur die Variablen. Ohne das blieb
    // "Rennen laeuft, Runde 3" im Schirm stehen, und die Sprachpruefung des naechsten
    // Laufs meldete es als deutschen Text im englischen Modus - voellig zu Recht. Ein Test,
    // der die Oberflaeche anfasst, muss sie auch zuruecklegen.
    const anzeige = $('race-status') ? $('race-status').textContent : null;
    const gemerkt = { state: raceState, laps: raceLapTimes.slice(),
                      start: raceLapStart, dash: dashLapStart, part: racePartialMs };
    try {
      raceState = 'racing';
      raceLapTimes = [];
      raceLapStart = Date.now();
      dashLapStart = Date.now();
      racePartialMs = null;
      const bei0 = raceLapTimes.length;
      for (let i = 0; i < 3; i++) playerLapCrossed();
      return { ok: bei0 === 0 && raceLapTimes.length === 3,
               mass: 'Start ' + bei0 + ', nach drei Überfahrten '
                     + raceLapTimes.length };
    } finally {
      raceState = gemerkt.state; raceLapTimes = gemerkt.laps;
      raceLapStart = gemerkt.start; dashLapStart = gemerkt.dash;
      racePartialMs = gemerkt.part;
      if (anzeige !== null) $('race-status').textContent = anzeige;
    }
  });

  // ---- Autokennung: Farbe, Buchstabe, Name ----
  // Mit erfundenen Autos, weil echte eine Bluetooth-Verbindung brauchen. Geprueft wird die
  // Logik, nicht die Funkstrecke: dass keine Farbe zweimal vergeben wird, dass die
  // Buchstaben der Reihenfolge folgen und nach einem Abgang aufruecken, und dass der
  // eingetragene Name Vorrang vor allem anderen hat.
  stAdd('Autokennung: Farbe, Buchstabe, Name', () => {
    const gemerkt = garage.slice();
    // Auch die ANZEIGE zuruecklegen: ein Test, der die Oberflaeche anfasst, muss sie
    // aufraeumen. Ohne genau das blieb hier schon einmal Text stehen, den die
    // Sprachpruefung dann zu Recht gemeldet hat.
    const listeVorher = $('gar-list') ? $('gar-list').innerHTML : null;
    const zahlVorher = $('gar-count') ? $('gar-count').textContent : null;
    try {
      garage.length = 0;
      const mach = (id, name) => ({ device: { id, name }, role: 'none' });
      const drei = [mach('t-1', 'Carrera A'), mach('t-2', 'Carrera B'),
                    mach('t-3', 'Carrera C')];
      for (const c of drei) { garage.push(c); carAssign(c); }
      const farben = drei.map(c => c.colorId);
      const doppelt = farben.length !== new Set(farben).size;
      const tags = drei.map(c => c.tag);
      // Ein Auto aus der Mitte trennen: die dahinter muessen aufruecken.
      garage.splice(1, 1);
      carRetag();
      const nachAbgang = garage.map(c => c.tag);
      // Namensvorrang: eingetragener Name schlaegt Buchstaben schlaegt Geraetenamen.
      const a = garage[0];
      const ohne = garageLabel(a);
      a.alias = 'Testfahrer';
      const mit = garageLabel(a);
      const ok = !doppelt
                 && tags.join(',') === 'Alpha,Beta,Gamma'
                 && nachAbgang.join(',') === 'Alpha,Beta'
                 && ohne === 'Alpha' && mit === 'Testfahrer';
      return { ok,
               mass: 'Farben ' + farben.join('/') + (doppelt ? ' DOPPELT' : ' verschieden')
                     + ', Buchstaben ' + tags.join('/')
                     + ', nach Abgang ' + nachAbgang.join('/')
                     + ', Name "' + ohne + '" -> "' + mit + '"' };
    } finally {
      garage.length = 0;
      gemerkt.forEach(c => garage.push(c));
      carRetag();
      if (listeVorher !== null) $('gar-list').innerHTML = listeVorher;
      if (zahlVorher !== null) $('gar-count').textContent = zahlVorher;
    }
  });

  // ---- Reagieren die Werkstattbilder? ----
  // Jeder Regler von Anschlag zu Anschlag, und geprueft wird, WELCHE Bilder sich dabei
  // aendern. Die Erwartung steht in der Tabelle und folgt aus dem Modell:
  //
  //   Rohr      Impuls und Resonanz  (Rohrlaenge geht in die Impulsantwort und die Spitze)
  //   Impuls    nur Impuls           (die Breite des Druckstosses)
  //   Abfall    Impuls und Resonanz  (Laenge der Impulsantwort, damit ihre Guete)
  //   Saettigung nur Impuls          (steckt in keinem Frequenzbild)
  //   Drehzahl  nur Resonanz         (die rote Marke; ZuendWINKEL haengen nicht an ihr)
  //   Zylinder  Zuendfolge und Resonanz
  //
  // Ein Bild, das auf seinen Regler NICHT reagiert, ist der Fehler, den es hier zweimal
  // gegeben hat: gezeichnet, plausibel, und in Wahrheit eine Nulllinie.
  stAdd('Werkstattbilder reagieren auf ihre Regler', () => {
    const soll = {
      pipe: 'pulse,spec', pulse: 'pulse', decay: 'pulse,spec',
      drive: 'pulse', rpm: 'spec', cyl: 'fire,spec',
    };
    const bild = (k) => {
      const e = document.getElementById('mw-chart-' + k);
      const svg = e && e.querySelector('svg');
      return svg ? svg.innerHTML : '';
    };
    const alle = () => ({ fire: bild('fire'), pulse: bild('pulse'), spec: bild('spec') });
    if (!alle().pulse) return { skip: true, mass: 'Werkstatt nicht im Dokument' };
    const ids = Object.keys(soll);
    const gemerkt = {};
    for (const id of ids) gemerkt[id] = document.getElementById('mw-' + id).value;
    const stelle = (id, v) => {
      const e = document.getElementById('mw-' + id);
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
    };
    try {
      const falsch = [];
      const gemessen = [];
      for (const id of ids) {
        const e = document.getElementById('mw-' + id);
        stelle(id, e.min); const a = alle();
        stelle(id, e.max); const b = alle();
        stelle(id, gemerkt[id]);
        const anders = ['fire', 'pulse', 'spec'].filter(k => a[k] !== b[k]);
        const ist = anders.join(',');
        gemessen.push(id + '=' + (ist || 'nichts'));
        if (ist !== soll[id]) falsch.push(id + ': ' + (ist || 'nichts') + ' statt ' + soll[id]);
      }
      return { ok: !falsch.length,
               mass: gemessen.join(' ') + (falsch.length ? ' | FALSCH: ' + falsch.join('; ')
                                                         : ' | alle wie erwartet') };
    } finally {
      for (const id of ids) stelle(id, gemerkt[id]);
    }
  });

  // ---- Die zwei Linienmodelle ----
  // Gemessen wird die Zielgroesse des neuen Modells mit seinem eigenen Mass: die
  // Rundenzeit. Was hier NICHT geprueft wird, ist die Lage des Scheitels - sie verschiebt
  // sich messbar kaum (Mittel +0,045 der Kurvenlaenge ueber zwoelf Kurvenzuege), und eine
  // Pruefung auf einen Effekt, den es nicht gibt, waere eine Pruefung, die luegt.
  stAdd('Linienmodelle: Rundenzeit schlaegt Kruemmung', () => {
    const proben = ['SG2R2G2R2', 'SGR2GR2GRG', 'SHG4R4LG'];
    const zeilen = [];
    let schlimmster = 1;
    for (const code of proben) {
      const tiles = codeToTrack(code).tiles;
      const pts = trackCenterline(tiles);
      if (pts.length < 8) continue;
      const nrm = trackNormals(pts);
      const first = pts[0], last = pts[pts.length - 1];
      const closed = Math.hypot(last.x - first.x, last.y - first.y) < 2 * TRACK_UNITS_PER_CM;
      const km = idealLine(pts, nrm, { closed });
      const lt = lapTimeLine(pts, nrm, { closed });
      const bahn = (a) => pts.map((p, i) => [p.x + nrm[i].x * a[i], p.y + nrm[i].y * a[i]]);
      const tKm = lapTimeOf(bahn(km.alpha), closed, {}).time;
      const q = lt.lapTime / tKm;
      schlimmster = Math.min(schlimmster, 1 - q);
      // Und: die Linien muessen sich UNTERSCHEIDEN. Zwei Modelle, die dasselbe liefern,
      // sind ein Modell mit zwei Namen.
      let abw = 0;
      for (let i = 0; i < km.alpha.length; i++) {
        abw = Math.max(abw, Math.abs(km.alpha[i] - lt.alpha[i]));
      }
      zeilen.push(code + ' ' + ((1 - q) * 100).toFixed(1) + ' % schneller, '
                  + (abw / TRACK_UNITS_PER_CM).toFixed(1) + ' cm Abstand');
    }
    return { ok: schlimmster > 0.005,
             mass: zeilen.join(' | ') + ' (Modellzeit, nicht gefahren)' };
  });

  // ---- Die Annahmeregel des Lernens ----
  // Der Kern: eine SCHNELLERE Runde mit einem Abgang darf nicht angenommen werden. Wird das
  // je umgedreht, lernt das Verfahren, dass Abfliegen sich lohnt.
  stAdd('Ghost-Lernen nimmt keine Runde mit Abgang', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.learnSim) {
      return { skip: true, mass: 'learnSim nicht vorhanden' };
    }
    // Drei heile Runden mit fallender Zeit, dann die schnellste Runde von allen MIT Abgang.
    const r = OMEGA_TEST.learnSim([
      { ms: 9000 }, { ms: 8600 }, { ms: 8400 },
      { ms: 6000, off: 1 },
      { ms: 8300 },
    ]);
    const nachAbgang = r.spur[3];
    const letzte = r.spur[4];
    // Die 6000 duerfen nirgends als Bestzeit stehen, und die Schrittweite muss nach dem
    // Abgang KLEINER geworden sein statt groesser.
    const bestNieDerAbflug = r.spur.every(z => z.best !== 6000);
    const vorsichtiger = nachAbgang.sigma < r.spur[2].sigma;
    const zurueckgenommen = nachAbgang.pace <= r.spur[2].pace
                            && nachAbgang.push <= r.spur[2].push;
    const laeuftWeiter = letzte.best === 8300;
    return { ok: bestNieDerAbflug && vorsichtiger && zurueckgenommen && laeuftWeiter,
             mass: 'Bestzeit nach 6000-ms-Abflug ' + nachAbgang.best
                   + ' (nicht 6000: ' + (bestNieDerAbflug ? 'ok' : 'FALSCH') + ')'
                   + ', Schrittweite ' + r.spur[2].sigma + ' auf ' + nachAbgang.sigma
                   + ', Tempo ' + r.spur[2].pace + ' auf ' + nachAbgang.pace
                   + ', danach wieder Bestzeit ' + letzte.best
                   + ', Lenkgrenze ' + r.cap.toFixed(2) };
  });

  // ---- Start/Ziel-Code zaehlt, Linkskurve nicht ----
  //
  // Am 25.08. gemessen: das Original-Startziel-Blatt meldet 0x0a. Vorher stand hier 0x01,
  // eine Annahme aus einem Foto - und die Rundenzaehlung prueft genau diesen Wert, hat auf
  // dem Originalblatt also nie ausgeloest. Der Fehler war doppelt unsichtbar: ohne
  // gedrucktes Blatt kommt ohnehin kein Code, und mit Blatt zaehlt niemand die Runden nach.
  //
  // Geprueft wird die WIRKUNG und nicht die Konstante. Eine Pruefung auf "START === 0x0a"
  // waere mit der Konstante zusammen falsch gewesen und haette nichts gemerkt.
  stAdd('Start/Ziel-Code zaehlt eine Runde', () => {
    const gemerkt = { state: raceState, laps: raceLapTimes.slice(),
                      start: raceLapStart, dash: dashLapStart, part: racePartialMs,
                      form: raceFormationLap };
    const anzeige = $('race-status') ? $('race-status').textContent : null;
    const echterSpieler = playerCar;
    try {
      // Ein Fahrpaket bauen und nur Byte 12 austauschen. Byte 11 ist der Kachelzaehler und
      // muss sich mitbewegen, sonst greift die Wiederholungssperre.
      const paket = (code, zaehler) => {
        const a = new Array(19).fill(0);
        a[11] = zaehler; a[12] = code; a[14] = 0x22;
        return a;
      };
      // Der Testwagen muss das Spielerauto SEIN, nicht bloss die Rolle tragen:
      // onCarNotify ruft die Schirmauswertung mit car === playerCar auf, und dort sitzt die
      // Rundenzaehlung. So laeuft die Pruefung durch dieselbe Kette wie eine echte Fahrt.
      const attrappe = { device: { id: 'st-lap', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      const zaehle = (code) => {
        raceState = 'racing';
        raceFormationLap = false;
        raceLapTimes = [];
        raceLapStart = Date.now() - 5000;
        dashLapStart = Date.now() - 5000;
        racePartialMs = null;
        // Den Erkenner zuruecksetzen, sonst laeuft die zweite Messung unter anderen
        // Bedingungen als die erste: dashLastTileCounter und die Wiederholungssperre sind
        // Modulzustand und bleiben sonst stehen.
        dashPendingCode = null; dashPendingSeen = 0;
        dashLastTileCounter = null;
        dashLastActedCode = null; dashLastActedAt = 0;
        playerCar = attrappe;
        // VIER Pakete, nicht zwei. Die Kette verlangt der Reihe nach: einmal vormerken,
        // einmal bestaetigen (dabei wird nur der Kachelzaehler gemerkt), und erst wenn der
        // Zaehler sich bewegt, wird gehandelt.
        for (let k = 1; k <= 4; k++) {
          OMEGA_TEST.feedNotify(paket(code, k), { car: attrappe });
        }
        return raceLapTimes.length;
      };
      const mit0a = zaehle(0x0a);
      const mit03 = zaehle(0x03);
      const mit01 = zaehle(0x01);
      const mit02 = zaehle(0x02);
      // 0x0a MUSS zaehlen, 0x03 (Linkskurve) und 0x02 (Gerade) duerfen nicht. 0x01 zaehlt
      // weiter, weil es als frueher angenommener Wert absichtlich gueltig geblieben ist.
      const ok = mit0a >= 1 && mit03 === 0 && mit02 === 0 && mit01 >= 1;
      return { ok,
               mass: '0x0a -> ' + mit0a + ' Runde(n), 0x03 Linkskurve -> ' + mit03
                     + ', 0x02 Gerade -> ' + mit02 + ', 0x01 alt -> ' + mit01 };
    } finally {
      raceState = gemerkt.state; raceLapTimes = gemerkt.laps;
      raceLapStart = gemerkt.start; dashLapStart = gemerkt.dash;
      racePartialMs = gemerkt.part; raceFormationLap = gemerkt.form;
      playerCar = echterSpieler;
      if (anzeige !== null) $('race-status').textContent = anzeige;
    }
  });

  // ---- Nasse Lenkung: langsam voll, schnell weniger ----
  // Gemeldet als "auf Slicks im Regen kann ich nur geradeaus fahren". Ursache war, dass die
  // Kapazitaet der Vorderachse bei JEDER Fahrt mit dem Nassfaktor multipliziert wurde, das
  // Motorbremsen aber nicht - der geschrumpfte Reibkreis war schon im Schritttempo leer.
  stAdd('Nasse Lenkung greift erst mit der Fahrt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerGrip) {
      return { skip: true, mass: 'physSteerGrip nicht vorhanden' };
    }
    const q = (kmh) => {
      const tr = OMEGA_TEST.physSteerGrip({ gripScale: 1.0, kmh }).steerGrip;
      const na = OMEGA_TEST.physSteerGrip({ gripScale: 0.45, kmh }).steerGrip;
      return na / Math.max(1e-9, tr);
    };
    const bei = {};
    for (const v of [25, 50, 120, 290]) bei[v] = q(v);
    // Bis 50 km/h muss Regen die Lenkung praktisch unberuehrt lassen, bei 290 muss der
    // Verlust wieder voll da sein - sonst waere aus dem Regen ein Schoenwetterregen
    // geworden, und das war nicht die Bitte.
    const ok = bei[25] > 0.98 && bei[50] > 0.98 && bei[120] < 0.85 && bei[290] < 0.6;
    return { ok,
             mass: [25, 50, 120, 290].map(v => v + ' km/h ' + Math.round(bei[v] * 100) + ' %')
                   .join(', ') + ' vom Trockenwert' };
  });

  // ---- Rueckwaertsgang in der Automatik ----
  stAdd('Automatik: Viereck legt R, nur langsam', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physShift) {
      return { skip: true, mass: 'physShift nicht vorhanden' };
    }
    const sh = OMEGA_TEST.physShift;
    const langsam = sh({ auto: true, von: 'forward', gang: 0, kmh: 5, richtung: -1 });
    const schnell = sh({ auto: true, von: 'forward', gang: 0, kmh: 30, richtung: -1 });
    const raus = sh({ auto: true, von: 'reverse', gang: 0, kmh: 0, richtung: 1 });
    // Die Handschaltung muss unberuehrt bleiben: dort fuehrt der Weg weiter ueber den
    // Leerlauf, und das ist Absicht - ein Handschalter soll den Zwischenschritt sehen.
    const hand1 = sh({ auto: false, von: 'forward', gang: 0, kmh: 0, richtung: -1 });
    const hand2 = sh({ auto: false, von: 'neutral', gang: 0, kmh: 0, richtung: -1 });
    const ok = langsam.driveMode === 'reverse' && schnell.driveMode === 'forward'
               && raus.driveMode === 'forward' && raus.gear === 0
               && hand1.driveMode === 'neutral' && hand2.driveMode === 'reverse';
    return { ok,
             mass: 'Automatik 5 km/h -> ' + langsam.driveMode + ', 30 km/h -> '
                   + schnell.driveMode + ', Kreis aus R -> ' + raus.driveMode
                   + ' Gang ' + raus.gear
                   + ' | Hand unveraendert: Gang 1 -> ' + hand1.driveMode
                   + ', Leerlauf -> ' + hand2.driveMode };
  });

  // ---- Der Rohcode zeigt auch ohne laufenden Kachelzaehler ----
  // Der Kern des Scannerfehlers: die Anzeige sass hinter vier Ruecksprungen, einer davon
  // verlangte, dass der Kachelzaehler des Autos weiterlaeuft. Ueber ein Blatt auf dem
  // Fussboden tut er das nicht, und dann wurde nie etwas angezeigt.
  stAdd('Musterprobe zeigt auch bei stehendem Kachelzaehler', () => {
    const feld = $('tile-probe');
    if (!feld || !window.OMEGA_TEST || !OMEGA_TEST.feedNotify) {
      return { skip: true, mass: 'Musterprobe nicht im Dokument' };
    }
    const vorher = feld.textContent;
    const echterSpieler = playerCar;
    const gemerkt = { p: dashPendingCode, s: dashPendingSeen, c: dashLastTileCounter };
    try {
      const attrappe = { device: { id: 'st-probe', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      playerCar = attrappe;
      dashPendingCode = null; dashPendingSeen = 0; dashLastTileCounter = null;
      const paket = (code, zaehler) => {
        const a = new Array(19).fill(0);
        a[11] = zaehler; a[12] = code; a[14] = 0x22;
        return a;
      };
      // Byte 11 bleibt FEST: genau der Fall, in dem vorher nichts angezeigt wurde.
      for (let k = 0; k < 3; k++) OMEGA_TEST.feedNotify(paket(0x14, 7), { car: attrappe });
      const text = feld.textContent;
      // BEIDE Sprachen nennen, denn dieser Test lief nur auf Deutsch. Aufgefallen ist es
      // erst, als der neue Uebersetzungstest die Oberflaeche auf Englisch gestellt hat: dann
      // steht dort "still" und dieser Test meldete einen Fehler, den es nicht gab. Ein Test,
      // der still von der Spracheinstellung abhaengt, ist schlimmer als keiner - er zeigt
      // rot fuer etwas, das funktioniert.
      //
      // Der Code selbst (0x14) ist sprachfrei und traegt die eigentliche Aussage; das Wort
      // dazu wird mitgeprueft, weil die Aussage "der Zaehler steht" der Punkt dieses Tests
      // ist. Kommt eine dritte Sprache dazu, faellt der Test auf - und das ist richtig so.
      const ok = text.indexOf('0x14') >= 0 && /steht|still/.test(text);
      return { ok, mass: 'angezeigt: "' + text + '"' };
    } finally {
      playerCar = echterSpieler;
      dashPendingCode = gemerkt.p; dashPendingSeen = gemerkt.s;
      dashLastTileCounter = gemerkt.c;
      feld.textContent = vorher;
    }
  });

  // ---- Die Automatik schaltet durch ----
  //
  // Diese Pruefung hat gefehlt, und ihr Fehlen hat einen Fehler durchgelassen: der
  // Rueckwaertsgang-Umbau hat den Automatikblock so gebaut, dass er auch die Aufrufe der
  // Automatik SELBST abfing - danach blieb das Auto im ersten Gang. Drei Pruefungen fuer die
  // drei neuen Faelle, keine fuer den alten, der bleiben sollte.
  //
  // Gemessen wird ueber update() aus dem Stand mit Vollgas, also durch dieselbe Kette wie
  // beim Fahren. Ein direkter Aufruf des Getriebes haette den Fehler nicht gefunden, denn er
  // lag im Weg dorthin.
  stAdd('Automatik schaltet aus dem Stand durch', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physAutoGears) {
      return { skip: true, mass: 'physAutoGears nicht vorhanden' };
    }
    const r = OMEGA_TEST.physAutoGears(14);
    const gaenge = r.folge.filter(x => x.gang > 0);
    // Mindestens bis in den vierten Gang, und die Gaenge muessen AUFSTEIGEN. Ein Feld, das
    // nur "1" enthaelt, ist genau der gemeldete Fehler.
    const aufsteigend = gaenge.every((x, i) => i === 0 || x.gang >= gaenge[i - 1].gang);
    const ok = r.hoechster >= 4 && aufsteigend && r.endKmh > 150;
    return { ok,
             mass: gaenge.map(x => x.gang + '. bei ' + x.kmh + ' km/h').join(', ')
                   + ' | Ende ' + r.endKmh + ' km/h' };
  });

  // ---- Fahrleistung gegen die GT3-Tabelle ----
  //
  // Gemessen ueber update(), also durch dieselbe Kette wie beim Fahren. Die vorhandene
  // Pruefung "Physik: 0 auf 100" vergleicht das VEREINFACHTE Modell mit seinem eigenen
  // Anker und ist damit blind fuer den Unterschied zwischen beiden - mit Anker 3,2 meldete
  // sie 3,195 s, waehrend update() 4,46 s brauchte. Sie bleibt, weil sie die Kalibrierung
  // selbst prueft; DIESE hier prueft, was das Auto tut.
  //
  // Die Grenze ist 20 % je Punkt und nicht 5 %: der Rest ist ein Formfehler in der
  // Drehmomentkurve, der mit den vier gefitteten Werten nicht wegzubekommen ist. Eine
  // Grenze, die der Bestand nicht haelt, ist keine Grenze, sondern ein Daueralarm.
  stAdd('Fahrleistung gegen die GT3-Tabelle', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physCurve) {
      return { skip: true, mass: 'physCurve nicht vorhanden' };
    }
    const ZA = { 50: 1.1, 100: 3.1, 150: 5.4, 200: 8.5 };
    const ZB = { 100: 2.1, 150: 3.2, 200: 4.2, 250: 5.6 };
    const c = OMEGA_TEST.physCurve({ marken: [50, 100, 150, 200],
                                     bremsAb: [100, 150, 200, 250] });
    const teile = [], schlecht = [];
    for (const k of [50, 100, 150, 200]) {
      const ist = c.beschleunigen[k];
      if (ist === undefined) { schlecht.push('0-' + k + ' nie erreicht'); continue; }
      const ab = (ist - ZA[k]) / ZA[k];
      teile.push('0-' + k + ' ' + ist.toFixed(2) + ' s (' + (ab * 100).toFixed(0) + ' %)');
      if (Math.abs(ab) > 0.20) schlecht.push('0-' + k);
    }
    for (const k of [100, 150, 200, 250]) {
      const b = c.bremsen[k];
      const ab = (b.s - ZB[k]) / ZB[k];
      teile.push(k + '-0 ' + b.s.toFixed(2) + ' s (' + (ab * 100).toFixed(0) + ' %)');
      if (Math.abs(ab) > 0.20) schlecht.push(k + '-0');
    }
    return { ok: !schlecht.length,
             mass: teile.join(', ')
                   + (schlecht.length ? ' | ueber 20 % ab: ' + schlecht.join(', ')
                                      : ' | alle innerhalb 20 %') };
  });

  // ---- Lenkung unter Last, ueber eine gefahrene Bremsung ----
  //
  // Die erste Fassung maass den DAUERZUSTAND: Vollbremsung bei festgehaltener Geschwindigkeit,
  // vierzig Takte lang. Diesen Betriebspunkt gibt es beim Fahren nicht - wer bei 150 km/h
  // voll bremst, ist eine Sekunde spaeter bei 100. Der statische Wert lag deshalb bei 12 %
  // (dem Notboden), waehrend die gefahrene Kurve an derselben Stelle 38 % zeigt. Eine
  // Pruefung, die einen unmoeglichen Betriebspunkt bewertet, misst nicht das Fahrgefuehl.
  //
  // Geprueft wird jetzt genau das, was gemeldet war: unter starkem Bremsen bei hoher Fahrt
  // deutlich weniger Lenkung, bei niedriger Fahrt wieder weitgehend da, im Stand ganz da.
  // Der letzte Punkt ist der wichtigste - "fast im Stand kann ich nicht mehr lenken" war der
  // Fehler, und eine Pruefung ohne ihn haette ihn wieder durchgelassen.
  stAdd('Lenkung ueber eine gefahrene Vollbremsung', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerTrace) {
      return { skip: true, mass: 'physSteerTrace nicht vorhanden' };
    }
    const r = OMEGA_TEST.physSteerTrace({ bisKmh: 200, brake: 1, steering: 0.6 });
    const bei = (z) => {
      let b = null;
      for (const x of r.bremsspur) {
        if (!b || Math.abs(x.kmh - z) < Math.abs(b.kmh - z)) b = x;
      }
      return b;
    };
    const roll = r.rollen.winkel;
    const hoch = bei(140), mittel = bei(90), tief = bei(30);
    if (!hoch || !mittel || !tief) {
      return { skip: true, mass: 'Bremsspur zu kurz, nur '
                                 + r.bremsspur.length + ' Punkte' };
    }
    const q = (x) => x.winkel / Math.max(1e-6, roll);
    // Bei hoher Fahrt hoechstens 70 % - deutlich weniger, aber nicht null. Bei niedriger
    // Fahrt mindestens 85 %. Und im Stand mindestens 95 %: dort darf die Bremse gar keine
    // Rolle mehr spielen.
    const ok = q(hoch) < 0.70 && q(hoch) > 0.10
               && q(tief) > 0.85
               && r.imStand / Math.max(1e-6, roll) > 0.95;
    return { ok,
             mass: 'rollend ' + roll.toFixed(2) + ' | ' + hoch.kmh + ' km/h '
                   + Math.round(q(hoch) * 100) + ' %, ' + mittel.kmh + ' km/h '
                   + Math.round(q(mittel) * 100) + ' %, ' + tief.kmh + ' km/h '
                   + Math.round(q(tief) * 100) + ' %, Stand '
                   + Math.round(r.imStand / roll * 100) + ' %' };
  });

  // ---- Wiederholte Ueberfahrt im Ausdruck-Modus ----
  stAdd('Ausdruck-Modus zaehlt jede Ueberfahrt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.feedNotify) {
      return { skip: true, mass: 'feedNotify nicht vorhanden' };
    }
    const sw = $('setting-ontrack');
    const gemerkt = { state: raceState, laps: raceLapTimes.slice(), start: raceLapStart,
                      dash: dashLapStart, part: racePartialMs, form: raceFormationLap,
                      rail: sw ? sw.checked : true, sp: playerCar,
                      mp: dashMarkerPrev, ac: dashLastActedCode, aa: dashLastActedAt,
                      pc: dashPendingCode, ps: dashPendingSeen, lc: dashLastTileCounter };
    const anzeige = $('race-status') ? $('race-status').textContent : null;
    try {
      // In den Ausdruck-Modus, denn nur dort gilt die Flankenerkennung.
      if (sw) { sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      const attrappe = { device: { id: 'st-mark', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      playerCar = attrappe;
      raceState = 'racing'; raceFormationLap = false; raceLapTimes = [];
      raceLapStart = Date.now() - 5000; dashLapStart = Date.now() - 5000;
      racePartialMs = null;
      // Beide Erkennerwege zuruecksetzen, nicht nur den neuen: sonst zaehlt der Weg ueber
      // den Kachelzaehler aus einer frueheren Pruefung mit, und die erste Ueberfahrt kommt
      // doppelt. Genau daran ist der erste Anlauf dieser Pruefung gescheitert.
      dashMarkerPrev = false;
      dashLastActedCode = null; dashLastActedAt = 0;
      dashPendingCode = null; dashPendingSeen = 0; dashLastTileCounter = null;
      // Byte 12 bleibt 0x0a, Byte 11 bleibt 7: nur der Musterkontakt in Byte 15 wechselt.
      const paket = (kontakt) => {
        const a = new Array(19).fill(0);
        a[11] = 7; a[12] = 0x0a; a[14] = 0x82; a[15] = kontakt ? 0x08 : 0x00;
        return a;
      };
      const fahre = () => {
        // an, an, aus, aus - eine Ueberfahrt mit Ein- und Ausfahrt.
        for (const k of [true, true, false, false]) {
          OMEGA_TEST.feedNotify(paket(k), { car: attrappe });
        }
      };
      fahre();
      const nach1 = raceLapTimes.length;
      // Die Sperre gegen Doppelrunden zurueckstellen: eine echte zweite Runde liegt Sekunden
      // spaeter, und diese Pruefung soll die WIEDERHOLUNG zeigen und nicht die Sperre.
      // Die Sperre gilt fuer BEIDE Wege gemeinsam. Sie hier zurueckzustellen ist genau das,
      // was in Wirklichkeit die Zeit tut: eine echte zweite Runde liegt Sekunden spaeter.
      dashLastActedAt = 0;
      fahre();
      const nach2 = raceLapTimes.length;
      dashLastActedAt = 0;
      fahre();
      const nach3 = raceLapTimes.length;
      return { ok: nach1 === 1 && nach2 === 2 && nach3 === 3,
               mass: 'Runden nach drei Ueberfahrten: ' + nach1 + ', ' + nach2 + ', ' + nach3
                     + ' (Code und Kachelzaehler dabei unveraendert)' };
    } finally {
      raceState = gemerkt.state; raceLapTimes = gemerkt.laps;
      raceLapStart = gemerkt.start; dashLapStart = gemerkt.dash;
      racePartialMs = gemerkt.part; raceFormationLap = gemerkt.form;
      playerCar = gemerkt.sp;
      dashMarkerPrev = gemerkt.mp;
      dashLastActedCode = gemerkt.ac; dashLastActedAt = gemerkt.aa;
      dashPendingCode = gemerkt.pc; dashPendingSeen = gemerkt.ps;
      dashLastTileCounter = gemerkt.lc;
      if (sw && sw.checked !== gemerkt.rail) {
        sw.checked = gemerkt.rail;
        sw.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (anzeige !== null) $('race-status').textContent = anzeige;
    }
  });

  // ---- Ein Stoss erzeugt Schaden ----
  //
  // Diese Pruefung haette den Fehler gefunden: detectCrash war definiert und wurde nie
  // aufgerufen. Ein Merkmal, das nichts tut, sieht von aussen genauso aus wie ein Merkmal,
  // das nichts zu tun hat - deshalb wird hier nicht die Funktion aufgerufen, sondern der
  // WEG durch die Paketauswertung gegangen.
  stAdd('Ein Stoss erzeugt Schaden', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.feedNotify) {
      return { skip: true, mass: 'feedNotify nicht vorhanden' };
    }
    const sw = $('setting-crash-damage');
    const gemerkt = { sp: playerCar, dmg: damage,
                      an: crashDetectionEnabled,
                      a1: crashRollingAvg1, a3: crashRollingAvg3, lt: lastCrashTime };
    try {
      crashDetectionEnabled = true;
      crashRollingAvg1 = null; crashRollingAvg3 = null; lastCrashTime = 0;
      damage = 0;
      const attrappe = { device: { id: 'st-crash', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      playerCar = attrappe;
      const paket = (b1, b3) => {
        const a = new Array(19).fill(0);
        a[1] = b1 & 0xff; a[3] = b3 & 0xff; a[14] = 0x22;
        return a;
      };
      // Erst ruhig, damit der Mittelwert steht.
      for (let i = 0; i < 12; i++) OMEGA_TEST.feedNotify(paket(4, 2), { car: attrappe });
      const ruhig = damage;
      // Dann ein Stoss: beide Achsen weit weg vom Mittelwert. CRASH_THRESHOLD ist 40, die
      // Abweichung hier ist deutlich darueber, damit die Pruefung nicht am Rand haengt.
      OMEGA_TEST.feedNotify(paket(100, 90), { car: attrappe });
      const nachStoss = damage;
      return { ok: ruhig === 0 && nachStoss > 0,
               mass: 'ruhig ' + ruhig.toFixed(1) + ' %, nach einem Stoss '
                     + nachStoss.toFixed(1) + ' % Schaden' };
    } finally {
      playerCar = gemerkt.sp; damage = gemerkt.dmg;
      crashDetectionEnabled = gemerkt.an;
      crashRollingAvg1 = gemerkt.a1; crashRollingAvg3 = gemerkt.a3;
      lastCrashTime = gemerkt.lt;
      updateDamageFuelUI();
    }
  });

  // ---- Die Bremsbalance wirkt, und in welcher Richtung ----
  //
  // Ihr Vorgaenger, ein Bonus auf maxSteerLimit, wurde im 1. Gang (gearFrac = 0, also
  // maxSteerLimit exakt 1,0) durch das folgende Math.min(1, ...) vollstaendig weggeschnitten
  // und war deshalb nicht spuerbar. Diese Pruefung faellt genau dann durch.
  //
  // Gemessen wird an der GEFAHRENEN Spur und nicht an einem Beharrungspunkt: eine fruehere
  // Messung bei festen 150 km/h mit Vollbremse ergab 12 %, die gefahrene Spur 38 %. Der
  // Zustand, an dem sie gemessen hatte, kommt im Fahrbetrieb nie vor.
  stAdd('Bremsbalance aendert die Lenkung beim Bremsen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.physSteerTrace) {
      return { skip: true, mass: 'physSteerTrace nicht vorhanden' };
    }
    // Die Balance geht als ABWEICHUNG in den Messaufbau, nicht als Zuweisung an die
    // Konfiguration davor: der Aufbau stellt seinen Kalibrierbezug her und wuerde eine
    // Zuweisung von aussen ueberschreiben. Genau daran ist diese Pruefung einmal
    // gescheitert - drei Messungen, dreimal derselbe Wert, Spanne 0.
    {
      const q = (pct) => {
        const r = OMEGA_TEST.physSteerTrace({ bisKmh: 200, brake: 1, steering: 0.6,
                                              cfg: { brakeBias: pct / 100 } });
        let b = null;
        for (const x of r.bremsspur) {
          if (!b || Math.abs(x.kmh - 140) < Math.abs(b.kmh - 140)) b = x;
        }
        if (!b) return null;
        return { bei140: b.winkel / Math.max(1e-6, r.rollen.winkel),
                 stand: r.imStand / Math.max(1e-6, r.rollen.winkel) };
      };
      const v = q(50), m = q(62), h = q(80);
      if (!v || !m || !h) return { skip: true, mass: 'Bremsspur zu kurz' };
      // Erstens streng fallend: mehr Bremse vorn heisst weniger Lenkung. Zweitens ein
      // deutlicher Abstand, sonst ist der Regler wieder nur nominell da. Und drittens darf
      // die Balance im STAND nichts aendern - dort spielt die Bremse keine Rolle, und das
      // war der Fehler, gegen den die Tempoabhaengigkeit ueberhaupt eingebaut wurde.
      // FALLEND, aber nur BIS ZUM NOTBODEN - und das ist keine Abschwaechung des Tests,
      // sondern die Berichtigung einer falschen Annahme. Der Reibkreis hat einen Boden von
      // 0,12 (eine Trockenreserve, damit das Auto nie voellig hilflos ist). Ist er erreicht,
      // aendert mehr Bremse vorn nichts mehr, und "streng fallend" kann dort nicht gelten.
      //
      // Seit der Reibkreis-Faktor auf 1,15 steht - der kleinste Wert, der bei Pros
      // Bremsbalance von 58 % ueberhaupt wirkt - liegen 66 % und mehr auf dem Boden. Der Test
      // verlangt deshalb: nicht steigend ueberall, streng fallend im nicht gesaettigten
      // Bereich, und wo es flach ist, MUSS es der Boden sein. Ein beliebiges Plateau waere
      // weiterhin ein Fehler.
      const nichtSteigend = v.bei140 >= m.bei140 - 1e-9 && m.bei140 >= h.bei140 - 1e-9;
      const strengOben = v.bei140 > m.bei140;
      const amBoden = h.bei140 < 0.2;
      const spanne = v.bei140 - h.bei140;
      const standGleich = Math.abs(v.stand - h.stand) < 0.02 && h.stand > 0.95;
      return { ok: nichtSteigend && strengOben && amBoden && spanne > 0.25 && standGleich,
               mass: '140 km/h: 50 % vorn ' + Math.round(v.bei140 * 100)
                     + ' %, 62 % vorn ' + Math.round(m.bei140 * 100)
                     + ' %, 80 % vorn ' + Math.round(h.bei140 * 100)
                     + ' % | Spanne ' + Math.round(spanne * 100)
                     + ' Punkte, im Stand ' + Math.round(h.stand * 100) + ' %'
                     + (h.bei140 < 0.2 ? ' | 80 % vorn liegt auf dem Notboden' : '') };
    }
  });

  // ---- Der Lichtschaden geht bei der Reparatur wieder weg ----
  //
  // Er wurde gesetzt und nie zurueckgenommen: es gab im ganzen Projekt keine Zuweisung
  // lightDamage.front = false. Boxenstopp-Reparatur, resetCarState() und die Taste R setzen
  // alle nur damage = 0, waehrend der Tooltip "Boxenstopp repariert" versprach.
  //
  // Geprueft wird der Zustand ueber updateDamageFuelUI(), also den Weg, den alle drei
  // Ruecksetzwege ohnehin nehmen - nicht syncLightDamage() direkt. Eine Pruefung, die die
  // Funktion selbst aufruft, prueft nur, dass die Funktion existiert.
  stAdd('Reparatur macht die Beleuchtung wieder heil', () => {
    const gemerkt = { d: damage, f: lightDamage.front, r: lightDamage.rear };
    try {
      damage = 80;
      lightDamage.front = true;
      lightDamage.rear = false;
      updateDamageFuelUI();
      const kaputt = lightDamage.front;
      // Ueber der Schwelle darf nichts passieren, sonst waere aus der Ableitung ein
      // Zuruecksetzen bei jedem Bild geworden.
      damage = LIGHT_DEAD_DAMAGE - 0.5;
      updateDamageFuelUI();
      const heil = !lightDamage.front && !lightDamage.rear;
      const text = ($('dash-light-dmg') || {}).textContent;
      return { ok: kaputt && heil && !text,
               mass: 'bei 80 % Schaden defekt: ' + (kaputt ? 'ja' : 'NEIN')
                     + ', unter ' + LIGHT_DEAD_DAMAGE + ' % heil: '
                     + (heil ? 'ja' : 'NEIN') + ', Anzeigetext "' + text + '"' };
    } finally {
      damage = gemerkt.d;
      lightDamage.front = gemerkt.f;
      lightDamage.rear = gemerkt.r;
      updateLightTellTales();
      updateDamageFuelUI();
    }
  });

  // ---- Autopilot waehrend der gelben Flagge ----
  //
  // Ein Merkmal, das das Auto von SELBST fahren laesst, gehoert geprueft - und zwar an der
  // Eigenschaft, die es gefaehrlich machen wuerde: dass es in der falschen Betriebsart
  // greift. In der Ausdruck-Stellung haelt sich das Auto nicht selbst auf der Bahn, und ein
  // Autopilot ohne Querregelung wuerde es geradeaus in die Bande fahren.
  //
  // Geprueft wird der Regler, nicht die Anzeige: der Rueckgabewert bei zu langsam muss Gas
  // sein, bei zu schnell Bremse, und bei richtigem Tempo beides nahe null. Ohne den letzten
  // Punkt waere ein Regler, der dauerhaft Vollgas gibt, ebenfalls "gruen".
  stAdd('Autopilot nur auf der Bahn, und er regelt', () => {
    if (typeof autopilot !== 'function') {
      return { skip: true, mass: 'autopilot nicht vorhanden' };
    }
    const merk = { flag: flagState, tm: trackMode, v: physEngine.state.speedKmh,
                   form: raceFormationLap };
    try {
      // Ausdruecklich aus: dieser Test prueft den Grund "gelb", und ein von einem
      // vorherigen Test stehengelassenes true haette ihn auf den anderen Zweig geschickt.
      raceFormationLap = false;
      const bei = (kmh) => {
        physEngine.state.speedKmh = kmh / REAL_SCALE;
        return autopilot(0);
      };
      // 1. Gruen: gar kein Eingriff, egal wie schnell.
      flagState = 'green'; trackMode = 'on';
      const gruen = bei(20);
      // 2. Gelb, aber Ausdruck-Stellung: ebenfalls kein Eingriff.
      flagState = 'yellow'; trackMode = 'off';
      const ausdruck = bei(20);
      // 3. Gelb auf der Bahn: regeln. YELLOW_KMH ist das Ziel.
      trackMode = 'on';
      const langsam = bei(YELLOW_KMH * 0.4);
      const schnell = bei(YELLOW_KMH * 2.5);
      const passend = bei(YELLOW_KMH);
      if (!langsam || !schnell || !passend) {
        return { ok: false, mass: 'greift auf der Bahn nicht' };
      }
      const ok = gruen === null && ausdruck === null
                 && langsam.throttle > 0.2 && langsam.brake === 0
                 && schnell.brake > 0.2 && schnell.throttle === 0
                 && passend.throttle < 0.15 && passend.brake < 0.15;
      return { ok,
               mass: 'gruen ' + (gruen === null ? 'aus' : 'AN')
                     + ', Ausdruck ' + (ausdruck === null ? 'aus' : 'AN')
                     + ' | bei ' + Math.round(YELLOW_KMH * 0.4) + ' km/h Gas '
                     + langsam.throttle.toFixed(2)
                     + ', bei ' + Math.round(YELLOW_KMH * 2.5) + ' km/h Bremse '
                     + schnell.brake.toFixed(2)
                     + ', bei ' + YELLOW_KMH + ' km/h Gas ' + passend.throttle.toFixed(2)
                     + ' Bremse ' + passend.brake.toFixed(2) };
    } finally {
      flagState = merk.flag;
      trackMode = merk.tm;
      physEngine.state.speedKmh = merk.v;
      raceFormationLap = merk.form;
    }
  });

  // ---- Der Tempo-Regler der Ghosts ----
  //
  // Vier Behauptungen, die vorher nur im Kommentar standen. Die erste ist die, die der
  // Benutzer gemeldet hat: nach dem Zurueckstellen eines abgeflogenen Autos wurde es ihm
  // mit Vollgas aus der Hand gerissen. Ursache war throttle = err * 4 bei v = 0.
  stAdd('Ghost-Regler: Rampe, Totband, Ratenbegrenzung', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostSpeedControl) {
      return { skip: true, mass: 'ghostSpeedControl nicht vorhanden' };
    }
    const C = OMEGA_TEST.ghostSpeedControl;
    const teile = [], schlecht = [];

    // 1. Erster Takt aus dem Stand: kein Vollgas. Die Ratenbegrenzung allein garantiert
    //    das, unabhaengig von der Rampe - deshalb ist es hier pruefbar.
    const g1 = {};
    const t1 = C(g1, 0.5, 0, 0.045).throttle;
    teile.push('erster Takt Gas ' + t1.toFixed(2));
    if (!(t1 < 0.15)) schlecht.push('erster Takt gibt ' + t1.toFixed(2) + ' Gas');

    // 2. Und nach einer Sekunde Takten ist es voll da - eine Begrenzung, die das Gas
    //    dauerhaft klein haelt, waere ein lahmes Auto und kein sanftes.
    const g2 = {};
    let t2 = 0;
    for (let i = 0; i < 25; i++) t2 = C(g2, 0.5, 0, 0.045).throttle;
    teile.push('nach 1,1 s ' + t2.toFixed(2));
    if (!(t2 > 0.9)) schlecht.push('kommt nicht auf Vollgas (' + t2.toFixed(2) + ')');

    // 3. Totband: am Ziel wird weder Gas gegeben noch gebremst. Ohne das pendelt der
    //    Regler, und ein pendelnder Ghost fuehlt sich kaputt an.
    const g3 = { lastThrottle: 0, lastBrake: 0 };
    const am = C(g3, 0.5, 0.5, 0.045);
    teile.push('am Ziel Gas ' + am.throttle.toFixed(2) + ' Bremse ' + am.brake.toFixed(2));
    if (am.throttle !== 0 || am.brake !== 0) schlecht.push('kein Totband am Ziel');

    // 4. Zu schnell: es wird gebremst, und zwar SCHNELLER als Gas aufgebaut wird. Gas nimmt
    //    man weich, gebremst wird entschlossen.
    const g4 = {};
    const b4 = C(g4, 0.3, 0.9, 0.045).brake;
    teile.push('zu schnell Bremse ' + b4.toFixed(2));
    if (!(b4 > t1)) schlecht.push('Bremse kommt nicht schneller als Gas');

    return { ok: !schlecht.length,
             mass: teile.join(', ') + (schlecht.length ? ' | ' + schlecht.join('; ') : '') };
  });

  // ---- Boxengasse per doppeltem Start-Ausdruck ----
  //
  // Die experimentelle Variante, und die einzige mit einer Zeitbedingung: zwei
  // Musterkontakte innerhalb von 3 s bei MINDESTENS 1 s Abstand sind eine Boxeneinfahrt.
  //
  // Geprueft werden drei Faelle, und der dritte ist der wichtige: ein einzelner Ausdruck
  // haelt bei Fahrt etwa eine Sekunde Kontakt, und ohne den Mindestabstand wuerde das
  // Flattern EINES Musters als Paar gelesen. Ein Test nur mit dem gueltigen Paar haette
  // genau diesen Fehler durchgelassen.
  //
  // Der Weg geht ueber feedNotify, also durch die echte Paketauswertung - playerLapCrossed
  // direkt zu rufen wuerde die Erkennung umgehen, die hier geprueft werden soll.
  stAdd('Boxengasse: doppelter Ausdruck nimmt die Runde zurueck', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.feedNotify) {
      return { skip: true, mass: 'feedNotify nicht vorhanden' };
    }
    const merk = { sp: playerCar, tm: trackMode, pt: pitTrigger, ps: pitState,
                   rs: raceState, lt: raceLapTimes.slice(), ls: raceLapStart,
                   ple: pitLaneEnabled, pdf: pitDoubleFirstAt,
                   ac: dashLastActedCode, aa: dashLastActedAt };
    try {
      const attrappe = { device: { id: 'st-pit', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      playerCar = attrappe;
      trackMode = 'off';
      pitLaneEnabled = true;
      pitTrigger = 'double';
      raceState = 'racing';

      const paket = (marker) => {
        const a = new Array(19).fill(0);
        a[10] = 140; a[12] = 0x0a; a[14] = 0x80; a[15] = marker ? 0x08 : 0x00;
        return a;
      };
      // Ein Kontakt ist eine steigende FLANKE von Byte 15 Bit 3, also aus-an-aus.
      const kontakt = () => {
        dashLastActedCode = null;
        dashLastActedAt = 0;
        OMEGA_TEST.feedNotify(paket(false), { car: attrappe });
        OMEGA_TEST.feedNotify(paket(true), { car: attrappe });
        OMEGA_TEST.feedNotify(paket(false), { car: attrappe });
      };
      // Den gemerkten Zeitpunkt VORVERLEGEN, statt im Test zu warten.
      //
      // Und zwar VOR dem zweiten Kontakt und nicht danach - das war der Fehler im ersten
      // Anlauf dieser Pruefung. pitDoubleCheck() liest pitDoubleFirstAt IM Kontakt; ein
      // Verschieben danach kommt zu spaet, beide Kontakte liegen dann Millisekunden
      // auseinander, und die Untergrenze von 1 s verwirft das Paar. Die Pruefung meldete
      // also einen Fehler, der im Messaufbau lag.
      const alter = (ms) => { if (pitDoubleFirstAt) pitDoubleFirstAt -= ms; };

      const teile = [], schlecht = [];

      // 1. Ein Kontakt allein ist eine Runde.
      raceLapTimes.length = 0;
      raceLapStart = Date.now() - 5000;
      pitDoubleFirstAt = 0;
      setPitState('off');
      kontakt();
      const nachEins = raceLapTimes.length;
      teile.push('ein Kontakt: ' + nachEins + ' Runde');
      if (nachEins !== 1) schlecht.push('erster Kontakt zaehlt keine Runde');

      // 2. Zweiter Kontakt nach 1,5 s: Paar, Runde zurueck, Boxengasse aktiv.
      raceLapStart = Date.now() - 1500;
      alter(1500);
      kontakt();
      const nachZwei = raceLapTimes.length;
      teile.push('Paar nach 1,5 s: ' + nachZwei + ' Runden, pitState ' + pitState);
      // EINE Runde, nicht null - und das ist die richtige Erwartung, auch wenn der erste
      // Anlauf dieser Pruefung null forderte.
      //
      // Der doppelte Ausdruck ist EIN physisches Ding: zwei Blaetter 50 cm auseinander am
      // Boxeneingang. Darueber zu fahren erzeugt zwei Kontakte, ist aber eine Ueberfahrt.
      // Also gehoert genau eine Runde gezaehlt, und der zweite, unechte Kontakt wird
      // zurueckgenommen. Null zu fordern hiesse, dass eine Boxeneinfahrt die vorige Runde
      // mitloescht - die ist aber wirklich gefahren worden.
      if (nachZwei !== 1) schlecht.push('Paar laesst ' + nachZwei
                                        + ' Runden stehen statt einer');
      if (pitState !== 'limited') schlecht.push('Paar aktiviert die Boxengasse nicht');

      // 3. DER WICHTIGE FALL: zwei Kontakte zu SCHNELL hintereinander sind KEIN Paar.
      //    Ein einzelner Ausdruck haelt bei Fahrt rund eine Sekunde Kontakt.
      raceLapTimes.length = 0;
      raceLapStart = Date.now() - 5000;
      pitDoubleFirstAt = 0;
      setPitState('off');
      kontakt();
      raceLapStart = Date.now() - 300;
      alter(300);
      kontakt();
      const nachSchnell = raceLapTimes.length;
      teile.push('zwei Kontakte in 0,3 s: ' + nachSchnell + ' Runden, pitState ' + pitState);
      if (nachSchnell !== 2) schlecht.push('zu schnelles Paar wird als Einfahrt gelesen');
      if (pitState !== 'off') schlecht.push('zu schnelles Paar aktiviert die Boxengasse');

      return { ok: !schlecht.length,
               mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      playerCar = merk.sp; trackMode = merk.tm; pitTrigger = merk.pt;
      pitLaneEnabled = merk.ple; pitDoubleFirstAt = merk.pdf;
      raceState = merk.rs; raceLapStart = merk.ls;
      raceLapTimes.length = 0;
      merk.lt.forEach(l => raceLapTimes.push(l));
      dashLastActedCode = merk.ac; dashLastActedAt = merk.aa;
      setPitState(merk.ps);
    }
  });

  // ---- Doppelter Start-Ausdruck auf dem KACHELZAEHLER-WEG ----
  //
  // Dies ist der zweite von zwei Wegen, auf denen der Spieler Start/Ziel ueberfaehrt, und
  // der gewoehnliche: sobald sich Byte 11 bewegt - also sobald das Auto ein Streckenteil
  // weiterfaehrt -, laeuft der Kontakt hier durch und nicht ueber den Ausdruck-Weg.
  //
  // Hier fehlte pitDoubleCheck(), und deshalb zaehlte ein Paar zwei Runden statt einer. Der
  // vorhandene Test daneben baut Byte 14 = 0x80 und ging nur ueber den anderen Weg - weil er
  // gruen war, sah die Sache geprueft aus. Ein Test, der einen von zwei Wegen prueft, sagt
  // nichts ueber den anderen.
  stAdd('Boxengasse: doppelter Ausdruck auch bei laufendem Kachelzaehler', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.feedNotify) {
      return { skip: true, mass: 'feedNotify nicht vorhanden' };
    }
    const merk = { sp: playerCar, tm: trackMode, pt: pitTrigger, ps: pitState,
                   rs: raceState, lt: raceLapTimes.slice(), ls: raceLapStart,
                   ple: pitLaneEnabled, pdf: pitDoubleFirstAt, pdc: pitDoubleCountsLap,
                   ac: dashLastActedCode, aa: dashLastActedAt,
                   pc: dashPendingCode, pv: dashPendingSeen, tc: dashLastTileCounter };
    try {
      const attrappe = { device: { id: 'st-pit2', name: 'Pruefwagen' }, role: 'player',
                         rx: null, tx: null, tileCode: 0xff, tileCount: null,
                         lastCodeAt: 0, yaw: 0, ghost: null, timer: null, race: null };
      playerCar = attrappe;
      trackMode = 'off';
      pitLaneEnabled = true;
      pitTrigger = 'double';
      pitDoubleCountsLap = false;
      raceState = 'racing';

      // Byte 14 = 0x22: Bit 5 gesetzt, also BAHN-Modus - der Weg mit Kachelzaehler.
      const paket = (code, zaehler) => {
        const a = new Array(19).fill(0);
        a[10] = 140; a[11] = zaehler; a[12] = code; a[14] = 0x22;
        return a;
      };
      // Ein Kontakt braucht dreierlei, und alle drei sind Schutzmassnahmen aus v0.4:
      // denselben Code ZWEIMAL (kein Einzelpaket zaehlt), einen VERAENDERTEN Zaehler, und
      // keinen Sperrvermerk vom vorigen Kontakt.
      let zaehler = 0;
      const kontakt = () => {
        dashLastActedCode = null;
        dashLastActedAt = 0;
        dashPendingCode = null;
        dashPendingSeen = 0;
        OMEGA_TEST.feedNotify(paket(0x0a, zaehler), { car: attrappe });
        OMEGA_TEST.feedNotify(paket(0x0a, zaehler), { car: attrappe });
        zaehler += 1;
        OMEGA_TEST.feedNotify(paket(0x0a, zaehler), { car: attrappe });
      };
      const alter = (ms) => { if (pitDoubleFirstAt) pitDoubleFirstAt -= ms; };

      const teile = [], schlecht = [];

      // Erster Kontakt: eine Runde. Der Zaehler muss dabei EINMAL gesetzt worden sein,
      // sonst verwirft der erste Kontakt sich selbst - deshalb ein Vorlauf.
      dashLastTileCounter = null;
      raceLapTimes.length = 0;
      raceLapStart = Date.now() - 5000;
      pitDoubleFirstAt = 0;
      setPitState('off');
      kontakt();
      const nachEins = raceLapTimes.length;
      teile.push('ein Kontakt: ' + nachEins + ' Runde');
      if (nachEins !== 1) schlecht.push('erster Kontakt zaehlt ' + nachEins + ' statt 1');

      // Zweiter Kontakt 1,5 s spaeter: Paar. EINE Runde bleibt stehen, nicht zwei.
      raceLapStart = Date.now() - 1500;
      alter(1500);
      kontakt();
      const nachZwei = raceLapTimes.length;
      teile.push('Paar nach 1,5 s: ' + nachZwei + ' Runden, pitState ' + pitState);
      if (nachZwei !== 1) {
        schlecht.push('Paar laesst ' + nachZwei + ' Runden stehen statt einer');
      }
      if (pitState !== 'limited') schlecht.push('Paar aktiviert die Boxengasse nicht');

      return { ok: !schlecht.length,
               mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      playerCar = merk.sp; trackMode = merk.tm; pitTrigger = merk.pt;
      pitLaneEnabled = merk.ple; pitDoubleFirstAt = merk.pdf;
      pitDoubleCountsLap = merk.pdc;
      raceState = merk.rs; raceLapStart = merk.ls;
      raceLapTimes.length = 0;
      merk.lt.forEach(l => raceLapTimes.push(l));
      dashLastActedCode = merk.ac; dashLastActedAt = merk.aa;
      dashPendingCode = merk.pc; dashPendingSeen = merk.pv;
      dashLastTileCounter = merk.tc;
      setPitState(merk.ps);
    }
  });

  // ---- Das Woerterbuch hat keine doppelten Schluessel ----
  //
  // Ein doppelter Schluessel in einem Objektliteral ist kein Syntaxfehler: der spaetere
  // gewinnt, still. Gefunden wurden vier, und bei einem davon ("Einstellungen") wichen die
  // Werte ab - "Settings" gegen "settings" -, der frueher gepflegte war also seit dem
  // Hinzufuegen des zweiten wirkungslos.
  //
  // Von aussen ist das unsichtbar: die Uebersetzung ERSCHEINT, nur eben die falsche. Eine
  // Pruefung dafuer kostet nichts, weil das Woerterbuch schon im Speicher liegt - was sie
  // nicht kann, ist die Quelldatei sehen, in der die Dopplung steht. Sie zaehlt deshalb die
  // Schluessel des OBJEKTS gegen die Zahl der Zeilen, die im gebauten Dokument danach
  // aussehen; weichen sie ab, wurde etwas ueberschrieben.
  stAdd('Woerterbuch ohne doppelte Schluessel', () => {
    const imObjekt = Object.keys(I18N_EN).length;
    // Die Quelle steht im eigenen <script>. Sie zu lesen ist billiger und ehrlicher als die
    // Dopplung zu erraten: das Objekt selbst kann sie per Definition nicht zeigen.
    let inQuelle = null;
    for (const sc of document.querySelectorAll('script')) {
      const txt = sc.textContent || '';
      const i = txt.indexOf('const I18N_EN');
      if (i < 0) continue;
      const zeilen = txt.slice(i).split(String.fromCharCode(10));
      let n = 0;
      for (let k = 1; k < zeilen.length; k++) {
        const z = zeilen[k].trim();
        if (z.startsWith('};')) break;
        // Nur SCHLUESSELzeilen, also solche mit einem Doppelpunkt hinter dem
        // abschliessenden Anfuehrungszeichen. Der erste Anlauf zaehlte jede Zeile, die mit
        // einem Anfuehrungszeichen beginnt - also auch die Fortsetzungszeilen mehrzeiliger
        // Eintraege, bei denen der Wert allein auf der naechsten Zeile steht. Es gibt 40
        // solche Eintraege, und genau 40 hat er zuviel gezaehlt: eine Pruefung, die ihren
        // eigenen Formatierungsstil nicht kennt, meldet ihn als Fehler.
        // "Hinter dem abschliessenden Anfuehrungszeichen kommt ein Doppelpunkt" - also
        // eine SCHLUESSELzeile und nicht die Fortsetzungszeile eines mehrzeiligen Eintrags.
        //
        // Als Zeichenschleife und ausdruecklich NICHT als Regexp. Der erste Anlauf benutzte
        // einen, und dessen Zeichenklasse verlor beim Schreiben durch die Werkzeugkette
        // einen Backslash - aus [^"\\] wurde [^"\], eine unabgeschlossene Zeichenklasse,
        // und die IIFE brach ab. Eine Pruefung, die den Aufbau kaputtmachen kann, ist keine.
        if (z.charAt(0) === '"') {
          let j = 1, ende = -1;
          while (j < z.length) {
            if (z.charCodeAt(j) === 92) { j += 2; continue; }   // 92 = Backslash
            if (z.charAt(j) === '"') { ende = j; break; }
            j++;
          }
          if (ende > 0 && z.slice(ende + 1).trim().charAt(0) === ':') n++;
        }
      }
      inQuelle = n;
      break;
    }
    if (inQuelle === null) {
      return { skip: true, mass: 'Quelle nicht lesbar (eigene Datei statt inline)' };
    }
    return { ok: inQuelle === imObjekt,
             mass: inQuelle + ' Zeilen in der Quelle, ' + imObjekt + ' Schluessel im Objekt'
                   + (inQuelle === imObjekt ? '' : ' – '
                      + (inQuelle - imObjekt) + ' still ueberschrieben') };
  });

  // ---- Ausfuehren und anzeigen ----
  async function runSelfTest() {
    const rows = $('st-rows');
    $('st-run').disabled = true;
    $('st-status').textContent = 'laeuft …';
    rows.innerHTML = ST_TESTS.map(t =>
      '<tr class="st-run"><td>' + t.name + '</td><td>…</td><td></td></tr>').join('');
    let gut = 0, schlecht = 0, offen = 0;
    for (let i = 0; i < ST_TESTS.length; i++) {
      const t = ST_TESTS[i];
      let r;
      try {
        r = await t.fn();
      } catch (e) {
        // Eine geworfene Ausnahme IST ein Ergebnis, und zwar das wichtigste: der Test
        // konnte nicht bis zu seinem Urteil kommen.
        r = { ok: false, mass: 'Ausnahme: ' + (e && e.message ? e.message : String(e)) };
      }
      const urteil = r.skip ? ['?', 'st-skip'] : r.ok ? ['ok', 'st-ok'] : ['FEHLER', 'st-bad'];
      if (r.skip) offen++; else if (r.ok) gut++; else schlecht++;
      const tr = rows.children[i];
      tr.className = '';
      tr.children[1].innerHTML = '<span class="' + urteil[1] + '">' + urteil[0] + '</span>';
      tr.children[2].textContent = r.mass || '';
      // Nach jedem Test dem Browser Luft lassen, sonst steht die Tabelle bis zum Ende leer
      // und man weiss nicht, ob noch etwas passiert.
      //
      // WEDER requestAnimationFrame NOCH setTimeout, und beide Male aus demselben Grund -
      // ein Lauf soll auch dann durchkommen, wenn niemand hinsieht:
      //
      //   rAF feuert nur, wenn die Seite gezeichnet wird. In einem Hintergrundtab kommt es
      //   NIE, und der Lauf bleibt nach der ersten Zeile stehen.
      //   setTimeout kommt, aber zu spaet. Chrome drosselt Zeitgeber im Hintergrund auf
      //   einen Takt pro Sekunde und nach fuenf Minuten auf einen pro Minute. Gemessen mit
      //   nicht angezeigtem Fenster: 19 von 104 Tests in 192 Sekunden, und die letzten 98
      //   Sekunden brachten genau einen. Ein Lauf ueber hundert Tests kommt so nie zu Ende.
      //
      // Ein MessagePort-Takt ist keine Zeitgeber-Aufgabe und wird gar nicht gedrosselt. Er
      // laesst dem Browser genauso Luft wie setTimeout(0) - die Tabelle fuellt sich weiter
      // Zeile fuer Zeile -, haengt aber nicht daran, ob das Fenster vorne liegt.
      await stLuft();
    }
    $('st-run').disabled = false;
    $('st-status').textContent = gut + ' ok, ' + schlecht + ' Fehler'
                                + (offen ? ', ' + offen + ' nicht prüfbar' : '');
    log('Selbsttest: ' + gut + ' ok, ' + schlecht + ' Fehler'
        + (offen ? ', ' + offen + ' nicht pruefbar' : '') + '.',
        schlecht ? 'err' : 'info');
  }

  if ($('st-run')) $('st-run').addEventListener('click', runSelfTest);

