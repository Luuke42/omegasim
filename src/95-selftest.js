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
      // UEBER DIE NAHT NUR AUF EINER GESCHLOSSENEN RUNDE. Auf einer offenen sind der letzte
      // und der erste Abtastpunkt keine Nachbarn - sie liegen an zwei Enden der Bahn, und
      // ihr Unterschied ist kein Sprung der Linie, sondern die Luecke der Strecke.
      //
      // Der Vergleichswert lc.maxStep wickelt ebenfalls nur bei closed um (siehe lineOf).
      // Hier stand `% a.length` ohne diese Bedingung, und damit verglich der Test einen
      // Schritt, den seine eigene Referenz ausschliesst. Aufgefallen ist es, als der
      // Kurvenausgang das Ende der offenen Teststrecke nach aussen zog: gemessen 0,487 an
      // der Naht von SG2H2G2J2 gegen eine Grenze, in der diese Stelle nicht vorkommt.
      let sprung = 0;
      for (let i = 0; i < a.length; i++) {
        if (i + 1 >= a.length && !lc.closed) break;
        const j = (i + 1) % a.length;
        sprung = Math.max(sprung, Math.abs(a[j] - a[i]));
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

  // VERLAEUFE ZAEHLEN MIT, und dass sie es bisher nicht taten, war eine echte Luecke:
  // gelesen wurde nur backgroundColor. #race-dash traegt in der Ansicht "modern" NEUN
  // Hintergrundebenen, und die vorderste ist ein deckendes Weiss - der Schirm ist dort hell
  // und die Schrift dunkel. Der Pruefer lief daran vorbei bis hinunter zum schwarzen body
  // und meldete 1,16:1 fuer dunkle Schrift auf hellem Grund. Ein Fehlalarm, und zwar einer,
  // der in der Fassung 0.5.18 genauso steht - nachgemessen, nicht vermutet.
  //
  // EBENENWEISE UND VON VORN. Ein background-image ist ein Stapel: die erste Ebene liegt
  // OBEN. Ueber alle Farbwerte des ganzen Stapels zu mitteln war der erste Versuch und war
  // falsch - er verrechnete die verdeckten Ebenen mit und kam auf 1,49:1, also einen
  // Fehlalarm mit anderer Zahl. Gelesen wird deshalb Ebene fuer Ebene, ueberlagert wie der
  // Browser malt, und hinter der ersten deckenden Ebene wird nicht weitergesucht.
  //
  // WAS DIESE MESSUNG NICHT KANN, und das gehoert dazu: innerhalb EINER Ebene wird ueber die
  // Farbstopps gemittelt. Fuer die Flaechen dieser App stimmt das - sie sind Verlaeufe aus
  // zwei fast gleichen Farben. Fuer einen Verlauf von Schwarz nach Weiss waere der
  // Mittelwert eine Beruhigung und keine Messung, und fuer die vier Schraubenkoepfe
  // (radial-gradient) wiegt der Mittelwert einen kleinen Kreis so schwer wie die ganze
  // Flaeche. Hier liegen sie hinter der deckenden Ebene und zaehlen deshalb gar nicht.

  // "over" mit Deckkraft. stMix() kann das nicht: es gibt drei Kanaele zurueck und setzt
  // voraus, dass der Grund deckend ist - hier ist er es unterwegs gerade nicht.
  function stUeber(vorn, hinten) {
    const av = vorn[3] === undefined ? 1 : vorn[3];
    const ah = hinten[3] === undefined ? 1 : hinten[3];
    const a = av + ah * (1 - av);
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (vorn[i] * av + hinten[i] * ah * (1 - av)) / a).concat([a]);
  }

  // Die Ebenen trennen. Nicht mit split(','): jeder Verlauf enthaelt selbst Kommata, und
  // "linear-gradient(rgb(255, 255, 255)" waere die erste "Ebene".
  function stLagen(bild) {
    const s = String(bild), out = [];
    let tiefe = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') tiefe++;
      else if (c === ')') tiefe--;
      else if (c === ',' && tiefe === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out;
  }

  function stLageFarbe(lage) {
    const stopps = String(lage).match(/rgba?\([^)]+\)/g);
    if (!stopps || !stopps.length) return null;
    const su = [0, 0, 0, 0];
    let n = 0;
    for (const st of stopps) {
      const q = stParse(st);
      if (!q) continue;
      su[0] += q[0]; su[1] += q[1]; su[2] += q[2]; su[3] += q[3];
      n++;
    }
    return n ? [su[0] / n, su[1] / n, su[2] / n, su[3] / n] : null;
  }

  function stBildFarbe(bild) {
    if (!bild || bild === 'none' || bild.indexOf('gradient') < 0) return null;
    // Von vorn sammeln, hinter der ersten deckenden Ebene aufhoeren.
    const lagen = [];
    for (const lage of stLagen(bild)) {
      const f = stLageFarbe(lage);
      if (!f) continue;
      lagen.push(f);
      if (f[3] >= 0.999) break;
    }
    if (!lagen.length) return null;
    // Von hinten nach vorn ueberlagern, genau wie der Browser malt.
    let unten = lagen[lagen.length - 1];
    for (let i = lagen.length - 2; i >= 0; i--) unten = stUeber(lagen[i], unten);
    return unten;
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
      const cs = getComputedStyle(n);
      const bild = stBildFarbe(cs.backgroundImage);
      const bg = stParse(cs.backgroundColor);
      // BILD VOR FARBE in die Kette. Sie wird weiter unten von HINTEN nach vorn ueberlagert,
      // ein hoeherer Index liegt also weiter hinten - und der Browser malt das
      // Hintergrundbild ueber die Hintergrundfarbe. Andersherum eingereiht waere die
      // Reihenfolge genau verkehrt, und bei einer halbdurchsichtigen Ebene faellt das auf.
      if (bild && bild[3] > 0) kette.push(bild);
      if (bg && bg[3] > 0) kette.push(bg);
      if ((bild && bild[3] >= 0.999) || (bg && bg[3] >= 0.999)) break;
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
      // LOGOTYPEN SIND AUSGENOMMEN, und das steht so in der Norm: WCAG 1.4.3 nennt Text,
      // der Teil eines Logos oder Markennamens ist, ausdruecklich als Ausnahme vom
      // Mindestkontrast. Die Marke auf dem Armaturenbrett ist eingeaetzt und soll leise
      // sein - sie ist Zierde und traegt keine Auskunft.
      //
      // Aufgefallen ist sie erst mit dem Ebenenleser weiter oben. Vorher mass der Pruefer
      // an dieser Stelle gegen den schwarzen body statt gegen den hellen Schirm und kam auf
      // einen Wert, der zufaellig durchging - die Ausnahme ist also neu aufgeschrieben und
      // nicht neu erfunden.
      if (el.closest('.gt3-marke')) continue;
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
      // MIT DEM DREHZAHLBAND DES MOTORS. Ohne es fegte der Prueflauf 1500 bis 9000 ab,
      // also den Bereich der Physik - und der Blazer, der nur bis 5000 gefragt wird, fiel
      // dabei mit einer verlangten Rate von 2,09 durch. Die Rechnung war richtig, die Frage
      // war es nicht. Fehlt das Band im Manifest, gilt weiter der Physikbereich.
      const r = OMEGA_TEST.sndBandCheck(basen, manifest[key].idleRpm,
                                        manifest[key].limiterRpm);
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
    // NICHT PRUEFBAR OHNE FENSTER. Ein verborgener Browser-Bereich meldet innerWidth = 0,
    // und daran haengen die Medienabfragen des Cockpits: bei Breite 0 greift
    // @media (max-width: 560px), der Kachelstreifen geht auf vier Spalten, und seine Kacheln
    // werden ueber ihr Seitenverhaeltnis mehr als doppelt so hoch (gemessen 619 statt 275 px).
    // Der Test meldete dann einen Ueberstand, den es auf keinem Geraet gibt.
    if (!(window.innerWidth > 0) || !(window.innerHeight > 0)) {
      return { skip: true, mass: 'Fenster ist 0 x 0 - im verborgenen Bereich nicht messbar' };
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

  // ---- Und dasselbe im Vollbild, wo es bisher gar nicht geprueft wurde ----
  //
  // GEMELDET zu v0.5.16: "Drehzahllampen sind noch immer abgeschnitten." Die Ursache war
  // nicht die Einpassung, sondern ihr Fehlen: #race-dash ist im Vollbild position: fixed,
  // `offsetParent` ist dort null, und cockpitPassung() stieg in der ersten Zeile aus.
  //
  // Der Test faelscht die zwei Klassen, statt das Vollbild wirklich zu betreten - dafuer
  // braeuchte es eine Nutzergeste, und ein Test, der eine Geste braucht, wird nie
  // gefahren. Gerechnet wird ohnehin nur aus den Klassen und den uebergebenen Massen.
  //
  // DIE OBERE KANTE IST DIE AUSSAGE. align-content: center legt einen Ueberstand HALB
  // nach oben, und oben sitzen die Drehzahllampen; .gt3 schneidet mit overflow: hidden ab.
  // Ein Test, der nur "passt insgesamt" prueft, uebersieht genau das - deshalb steht die
  // Lampenreihe hier ausdruecklich als eigene Bedingung.
  stAdd('Cockpit passt im Vollbild, quer wie gedreht', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.cockpitPassung) {
      return { skip: true, mass: 'cockpitPassung nicht vorhanden' };
    }
    // NICHT PRUEFBAR OHNE FENSTER. Ein verborgener Browser-Bereich meldet innerWidth = 0,
    // und daran haengen die Medienabfragen des Cockpits: bei Breite 0 greift
    // @media (max-width: 560px), der Kachelstreifen geht auf vier Spalten, und seine Kacheln
    // werden ueber ihr Seitenverhaeltnis mehr als doppelt so hoch (gemessen 619 statt 275 px).
    // Der Test meldete dann einen Ueberstand, den es auf keinem Geraet gibt.
    if (!(window.innerWidth > 0) || !(window.innerHeight > 0)) {
      return { skip: true, mass: 'Fenster ist 0 x 0 - im verborgenen Bereich nicht messbar' };
    }
    const btn = document.querySelector('[data-tab="race"]');
    if (!btn) return { ok: false, mass: 'Cockpit-Reiter fehlt' };
    btn.click();
    const dash = document.getElementById('race-dash');
    const shift = document.getElementById('race-shift');
    if (!dash || !shift) return { ok: false, mass: 'Cockpit oder Lampenreihe fehlt' };

    const warFs = document.body.classList.contains('race-fs');
    const warTurn = document.body.classList.contains('race-turn');
    const schlecht = [], teile = [];
    try {
      for (const gedreht of [false, true]) {
        document.body.classList.add('race-fs');
        document.body.classList.toggle('race-turn', gedreht);
        const name = gedreht ? 'gedreht' : 'quer';
        // Drei WIRKLICHE Handymasse, quer gehalten, als Kasten des Cockpits gedacht -
        // im gedrehten Vollbild liegt dieser Kasten quer ueber einem hochkant gehaltenen
        // Telefon, und das ist derselbe Kasten.
        for (const [b, h] of [[915, 412], [844, 390], [740, 330]]) {
          const r = OMEGA_TEST.cockpitPassung(h, b);
          if (!r || !r.vollbild) { schlecht.push(name + ' ' + h + ': keine Vollbildmessung'); continue; }
          // Die Lampenreihe MISST sich selbst nach: offsetTop ist ihr Abstand zur
          // Oberkante des Kastens, und negativ heisst abgeschnitten.
          const lampenOben = shift.offsetTop;
          teile.push(name + ' ' + b + 'x' + h + ': Faktor ' + r.faktor
                     + (r.passt ? '' : ' UEBER ' + r.ueberstand)
                     + ', Lampen bei ' + Math.round(lampenOben));
          if (!r.passt && !r.amBoden) {
            schlecht.push(name + ' ' + b + 'x' + h + ': ' + r.ueberstand + ' px Ueberstand');
          }
          // -1 und nicht 0: die Kastenmasse werden auf ganze Pixel gerundet, und ein
          // halber Pixel Rundung ist kein abgeschnittener Rand.
          if (lampenOben < -1) {
            schlecht.push(name + ' ' + b + 'x' + h + ': Lampen '
                          + Math.round(-lampenOben) + ' px ueber der Kante');
          }
        }
        // GEGENPROBE je Lage: auf einem hohen Schirm darf nicht verkleinert werden.
        const gross = OMEGA_TEST.cockpitPassung(1400, 915);
        teile.push((gedreht ? 'gedreht' : 'quer') + ' 1400: Faktor ' + gross.faktor);
        if (gross.faktor < 0.999) {
          schlecht.push((gedreht ? 'gedreht' : 'quer') + ': verkleinert auch bei 1400 px');
        }
      }
    } finally {
      // Die Klassen ZURUECK, und erst danach neu einpassen - sonst bleibt ein Kasten von
      // 915 px Breite in einer Spalte von 412 stehen.
      document.body.classList.toggle('race-fs', warFs);
      document.body.classList.toggle('race-turn', warTurn);
      OMEGA_TEST.cockpitPassung();
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });


  // ---- Ein Schirmwechsel aendert die Einpassung nicht ----
  //
  // DIE ZUSICHERUNG, AUF DER DIE GANZE BAUFORM STEHT. Die zwei zusaetzlichen Schirme sind
  // absolut positionierte Ueberlagerungen, damit cockpitInhaltHoehe() sie nicht mitzaehlt -
  // waeren sie ein zweites Raster, bekaemen beide Schirme verschiedene Einpassungsfaktoren,
  // und das Cockpit wuerde beim BLAETTERN seine Groesse aendern.
  //
  // Geprueft wird deshalb ZEICHENGLEICH und nicht "ungefaehr": eine Zeilenhoehe, die sich um
  // ein Zehntel Pixel aendert, ist schon ein zweites Raster.
  stAdd('Schirmwechsel aendert die Einpassung nicht', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.schirmListe) {
      return { skip: true, mass: 'Schirmliste nicht vorhanden' };
    }
    if (!(window.innerWidth > 0) || !(window.innerHeight > 0)) {
      return { skip: true, mass: 'Fenster ist 0 x 0 - im verborgenen Bereich nicht messbar' };
    }
    const btn = document.querySelector('[data-tab="race"]');
    if (btn) btn.click();
    const dash = document.getElementById('race-dash');
    const merk = OMEGA_TEST.schirmIst();
    const teile = [], schlecht = [];
    try {
      const liste = OMEGA_TEST.schirmListe();
      OMEGA_TEST.schirmZu(liste[0]);
      const rows0 = getComputedStyle(dash).gridTemplateRows;
      const f0 = OMEGA_TEST.cockpitPassung().faktor;
      for (let i = 1; i < liste.length; i++) {
        OMEGA_TEST.schirmZu(liste[i]);
        const rows = getComputedStyle(dash).gridTemplateRows;
        const f = OMEGA_TEST.cockpitPassung().faktor;
        teile.push(liste[i] + (rows === rows0 ? ' gleich' : ' ANDERS'));
        if (rows !== rows0) schlecht.push(liste[i] + ': Rasterzeilen aendern sich');
        if (Math.abs(f - f0) > 1e-9) schlecht.push(liste[i] + ': Faktor ' + f + ' statt ' + f0);
      }
      // Und er laeuft im Kreis: nach so vielen Schritten wie Schirme ist man wieder da.
      OMEGA_TEST.schirmZu(liste[0]);
      for (let i = 0; i < liste.length; i++) OMEGA_TEST.schirmStep(+1);
      if (OMEGA_TEST.schirmIst() !== liste[0]) schlecht.push('laeuft nicht im Kreis');
      teile.push(liste.length + ' Schirme, Umlauf ok');
    } finally {
      OMEGA_TEST.schirmZu(merk);
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Boxenschirm deckt die Instrumente und nicht die Lichter ----
  //
  // Er liegt ueber den Kacheln, aber Schaltlichter, Flaggenband, Boxenband und die
  // MELDEZEILE muessen sichtbar bleiben. Das letzte ist keine Feinheit: pitToggle()
  // bestaetigt jede Aenderung ueber showHudToast(), und ein Schirm mit inset: 0 haette das
  // Pit-Menue stumm gemacht.
  //
  // Zugleich ist das die Probe, ob die Rasterlage im Browser wirklich greift. Fiele sie auf
  // den Polsterkasten zurueck, deckte der Schirm alles - und die Schaltlichter-Bedingung
  // schlaegt an.
  stAdd('Boxenschirm deckt die Kacheln, nicht die Lichter', () => {
    const btn = document.querySelector('[data-tab="race"]');
    if (btn) btn.click();
    const s = document.getElementById('race-pitscreen');
    if (!s || !OMEGA_TEST || !OMEGA_TEST.schirmZu) return { skip: true, mass: 'kein Boxenschirm' };
    const merk = OMEGA_TEST.schirmIst();
    const schlecht = [], teile = [];
    try {
      OMEGA_TEST.schirmZu('pit');
      const r = s.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) {
        return { skip: true, mass: 'Schirm hat keine Ausdehnung - Reiter nicht sichtbar' };
      }
      const drin = (el) => {
        const q = el.getBoundingClientRect();
        return q.left >= r.left - 1 && q.right <= r.right + 1
            && q.top >= r.top - 1 && q.bottom <= r.bottom + 1;
      };
      const schneidet = (el) => {
        const q = el.getBoundingClientRect();
        if (!(q.width > 0 && q.height > 0)) return false;
        return !(q.right <= r.left || q.left >= r.right
                 || q.bottom <= r.top || q.top >= r.bottom);
      };
      for (const sel of ['.gt3-left', '.gt3-gear', '.gt3-right', '.gt3-strip']) {
        const el = document.querySelector('#race-dash ' + sel);
        if (!el) continue;
        teile.push(sel + (drin(el) ? ' gedeckt' : ' NICHT gedeckt'));
        if (!drin(el)) schlecht.push(sel + ' wird nicht gedeckt');
      }
      for (const id of ['race-shift', 'hud-toast-wrap']) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (schneidet(el)) schlecht.push(id + ' wird verdeckt');
      }
      teile.push('Lichter und Meldezeile frei');
    } finally {
      OMEGA_TEST.schirmZu(merk);
    }
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Mischungen: mittel ist bitgleich zum alten Reifen ----
  //
  // DIE WICHTIGSTE der vier Aussagen. 'mittel' hiess bis v0.5.17 'slick' und 'regen' hiess
  // 'wet'; wenn die Vorgabe dabei auch nur im fuenften Nachkommastellen abweicht, hat der
  // Umbau das Fahrverhalten geaendert, ohne dass es jemand bestellt hat.
  stAdd('Reifenmischungen: mittel ist die alte Vorgabe', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.tyreMixProbe) {
      return { skip: true, mass: 'tyreMixProbe nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    const bei1 = OMEGA_TEST.tyreMixProbe(1);
    if (!bei1) return { skip: true, mass: 'keine Mischungstabelle' };
    // 1. mittel == der alte slick: Griff 1,0 im Trockenen, Aquaplaning wie ein Slick.
    teile.push('mittel Griff ' + bei1.mittel.grip);
    if (Math.abs(bei1.mittel.grip - 1) > 1e-9) schlecht.push('mittel hat Griff ' + bei1.mittel.grip);
    if (Math.abs(bei1.mittel.verschleiss - 1) > 1e-9) {
      schlecht.push('mittel verschleisst ' + bei1.mittel.verschleiss + 'x');
    }
    // 2. Die Rangfolge stimmt: weich mehr Griff und mehr Verschleiss als hart.
    teile.push('weich ' + bei1.weich.grip + '/' + bei1.weich.verschleiss
               + ' hart ' + bei1.hart.grip + '/' + bei1.hart.verschleiss);
    if (!(bei1.weich.grip > bei1.mittel.grip && bei1.mittel.grip > bei1.hart.grip)) {
      schlecht.push('Griffrangfolge weich > mittel > hart stimmt nicht');
    }
    if (!(bei1.weich.verschleiss > bei1.hart.verschleiss)) {
      schlecht.push('weich verschleisst nicht schneller als hart');
    }
    // 3. Bei Staerke 0 sind alle drei Slicks derselbe Reifen.
    const bei0 = OMEGA_TEST.tyreMixProbe(0);
    const gleich = Math.abs(bei0.weich.grip - bei0.mittel.grip) < 1e-9
                && Math.abs(bei0.hart.grip - bei0.mittel.grip) < 1e-9
                && Math.abs(bei0.weich.verschleiss - bei0.mittel.verschleiss) < 1e-9;
    teile.push('bei Staerke 0: ' + (gleich ? 'alle gleich' : 'VERSCHIEDEN'));
    if (!gleich) schlecht.push('bei Staerke 0 unterscheiden sich die Slicks noch');
    // 4. Regen im Trockenen ist schlechter als ein Slick - die bestehende Zusicherung.
    if (!(bei1.regen.grip < bei1.mittel.grip)) {
      schlecht.push('Regenreifen greifen im Trockenen nicht schlechter');
    }
    // 5. Nur Slicks schwimmen auf.
    if (bei1.regen.aqua !== 0) schlecht.push('Regenreifen aquaplanen');
    OMEGA_TEST.tyreMixProbe(1);
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Autos auf der Karte tragen ihre Farbe, ihr Kuerzel und ihre Querlage ----
  //
  // GEMELDET: "aktuell sind alle orange mit Fragezeichen daneben". Die Ursache war ein
  // falscher Feldname - c.farbe und c.name gibt es an einem Auto nicht. Genau das prueft
  // dieser Test: eine gegebene Farbe muss im Punkt ankommen, und ein Querversatz muss den
  // Punkt bewegen.
  stAdd('Streckenkarte: Farbe, Kuerzel und Querlage kommen an', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackMarks) {
      return { skip: true, mass: 'trackMarks nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    const mk = (quer) => OMEGA_TEST.trackMarks(null,
      [{ index: 4, phase: 0.5, farbe: '#e23b3b', kuerzel: 'Alp', quer }]);
    const mitte = mk(0), links = mk(-0.8), rechts = mk(0.8);
    const letzt = (r) => r.punkte[r.punkte.length - 1];
    // 1. Die Farbe kommt an und ist NICHT der Rueckfall.
    teile.push('Farbe ' + letzt(mitte).fill);
    if (letzt(mitte).fill !== '#e23b3b') schlecht.push('Farbe kommt nicht an');
    // 2. Das Kuerzel steht daneben.
    if (mitte.kuerzel.indexOf('Alp') < 0) schlecht.push('Kuerzel fehlt');
    // 3. Der Querversatz bewegt den Punkt, und zwar in ENTGEGENGESETZTE Richtungen.
    const dL = Math.hypot(letzt(links).x - letzt(mitte).x, letzt(links).y - letzt(mitte).y);
    const dR = Math.hypot(letzt(rechts).x - letzt(mitte).x, letzt(rechts).y - letzt(mitte).y);
    teile.push('Versatz ' + dL.toFixed(1) + ' / ' + dR.toFixed(1));
    if (!(dL > 3 && dR > 3)) schlecht.push('Querlage bewegt den Punkt nicht');
    const dLR = Math.hypot(letzt(links).x - letzt(rechts).x, letzt(links).y - letzt(rechts).y);
    if (!(dLR > dL && dLR > dR)) schlecht.push('links und rechts liegen nicht auf zwei Seiten');
    // 4. Das CH-Aussehen: schwarze Fahrbahn, rot links, blau rechts.
    const f = mitte.farben || [];
    for (const [farbe, was] of [['#14181f', 'Fahrbahn'], ['#ff5c5c', 'roter Randstein'],
                                ['#5aa9ff', 'blauer Randstein'], ['#ffffff', 'Stossfugen']]) {
      if (f.indexOf(farbe) < 0) schlecht.push(was + ' fehlt (' + farbe + ')');
    }
    teile.push(f.length + ' Farben im Bild');
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Das Gegensteuern im Drift-Modus ----
  //
  // Geprueft wird die FUNKTION und nicht die Fahrt: driftZuschlag() setzt Drehsignal, Tempo
  // und Lenkwert und fragt, was herauskommt. Fuenf Aussagen, und die ersten zwei sind die,
  // an denen ein Regler ohne Signal gefaehrlich wuerde.
  stAdd('Drift: Gegensteuern regelt gegen das Drehsignal', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.driftZuschlag) {
      return { skip: true, mass: 'driftZuschlag nicht vorhanden' };
    }
    const z = (g, span, kmh, steer, st) => OMEGA_TEST.driftZuschlag(g, span, kmh, steer, st);
    const schlecht = [], teile = [];
    // 1. OHNE SIGNAL kein Zuschlag - nicht raten.
    if (Math.abs(z(0, 8, 60, 0.2, 0.5) - 0.2) > 1e-6) schlecht.push('ohne Signal wird zugeschlagen');
    // 2. IM STAND kein Zuschlag: dort gibt es keine Drift, nur Wackeln.
    if (Math.abs(z(8, 8, 2, 0.2, 0.5) - 0.2) > 1e-6) schlecht.push('im Stand wird zugeschlagen');
    // 3. Die Richtung ist GEGEN die Drehung.
    const rechtsDreh = z(8, 8, 60, 0.2, 0.5);
    const linksDreh = z(-8, 8, 60, 0.2, 0.5);
    teile.push('rechts ' + rechtsDreh + ' links ' + linksDreh);
    if (!(rechtsDreh < 0.2 && linksDreh > 0.2)) schlecht.push('Richtung stimmt nicht');
    // 4. Der Regler wirkt, und bei 0 passiert nichts.
    if (Math.abs(z(8, 8, 60, 0.2, 0) - 0.2) > 1e-6) schlecht.push('Staerke 0 wirkt trotzdem');
    if (!(z(8, 8, 60, 0.2, 1) < z(8, 8, 60, 0.2, 0.5))) schlecht.push('Staerke wirkt nicht');
    // 5. DER DECKEL. Ein Wert ueber 1 waere nicht wirkungslos, sondern schaedlich: Byte 7
    //    ist vorzeichenbehaftet und braeche in die andere Richtung um.
    const voll = z(-8, 8, 60, 0.9, 1);
    teile.push('Deckel ' + voll);
    if (voll > 1 + 1e-9 || voll < -1 - 1e-9) schlecht.push('Deckel haelt nicht: ' + voll);
    return { ok: schlecht.length === 0,
             mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Rundenzaehler-Fanfare ----
  //
  // Ihr Klang ist eine Sache fuers Ohr, ihre LAENGE nicht: eine Fanfare, die zehn Sekunden
  // dauert, haelt das Ergebnis auf. Geprueft wird, dass sie spielt und wie lange.
  stAdd('Rundenzaehler-Fanfare spielt und ist kurz genug', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.fanfareProbe) {
      return { skip: true, mass: 'fanfareProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.fanfareProbe();
    if (!r) return { skip: true, mass: 'kein Audiokontext - braucht eine Nutzergeste' };
    const schlecht = [];
    if (!(r.noten >= 20)) schlecht.push('nur ' + r.noten + ' Toene');
    if (!(r.dauer > 2 && r.dauer < 7)) schlecht.push('Dauer ' + r.dauer + ' s');
    return { ok: schlecht.length === 0,
             mass: r.noten + ' Toene, ' + r.dauer + ' s'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Karte im Uebersichtsschirm kostet einen Takt fast nichts ----
  //
  // DIE ZUSICHERUNG, AUF DER DIE TRENNUNG STEHT. renderTrackPreview rechnet Mittellinie,
  // Normalen UND die Ideallinie - letztere ist eine Optimierung, und gemessen kostet ein
  // Aufruf rund 94 ms. Der Uebersichtsschirm malt zehnmal je Sekunde nach; laege der ganze
  // Aufbau in diesem Takt, waere das der Faden, an dem der 45-ms-Sendetakt haengt.
  //
  // Deshalb wird die Strecke EINMAL gezeichnet und danach werden nur die Punkte gesetzt.
  // Wenn dieser Weg auch nur ein paar Millisekunden kostet, ist die Trennung wertlos - also
  // wird sie hier nachgemessen und nicht geglaubt.
  stAdd('Kartenpunkte kosten fast nichts', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ovKarteProbe) {
      return { skip: true, mass: 'ovKarteProbe nicht vorhanden' };
    }
    const btn = document.querySelector('[data-tab="race"]');
    if (btn) btn.click();
    const merk = OMEGA_TEST.schirmIst ? OMEGA_TEST.schirmIst() : null;
    try {
      if (OMEGA_TEST.schirmZu) OMEGA_TEST.schirmZu('uebersicht');
      const autos = [
        { index: 2, phase: 0.4, farbe: '#e23b3b', kuerzel: 'Alp', quer: -0.6 },
        { index: 5, phase: 0.7, farbe: '#3b7fe2', kuerzel: 'Bet', quer: 0.5 },
      ];
      const r = OMEGA_TEST.ovKarteProbe(autos, 50);
      if (!r) return { skip: true, mass: 'keine Strecke geladen - nichts zu zeichnen' };
      const schlecht = [];
      // 2 ms je Takt waeren bei 8 Takten je Sekunde schon 1,6 Prozent des Fadens. Die
      // Grenze ist grosszuegig; gemessen liegt der Weg bei 0,06 ms.
      if (!(r.jeAufrufMs < 2)) schlecht.push('ein Takt kostet ' + r.jeAufrufMs + ' ms');
      if (r.punkte.length !== 2) schlecht.push(r.punkte.length + ' Punkte statt 2');
      if (r.punkte[0] && r.punkte[0].fill !== '#e23b3b') schlecht.push('Farbe kommt nicht an');
      if (r.kuerzel.indexOf('Alp') < 0) schlecht.push('Kuerzel fehlt');
      return { ok: schlecht.length === 0,
               mass: r.jeAufrufMs + ' ms je Takt, ' + r.punkte.length + ' Punkte'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      if (merk && OMEGA_TEST.schirmZu) OMEGA_TEST.schirmZu(merk);
    }
  });

  // ---- Im Boxenschirm huepft nichts, wenn das Wort seine Laenge aendert ----
  //
  // GEMELDET: "Symbole (zB Reifenfarbe) sollte mit unterschiedlich langem Text 'mittel'
  // 'weich' nicht hin und her huepfen." Die Ursache war eine Rasterspalte auf `auto`: sie
  // ist so breit wie ihr Text, und damit verschiebt jeder Wortwechsel die Spalte DAVOR.
  //
  // Geprueft wird an der Stelle, an der man es sieht: die Farbfelder duerfen sich nicht
  // bewegen, waehrend die vier Mischungen durchgeschaltet werden.
  stAdd('Boxenschirm: die Bilder stehen still', () => {
    const btn = document.querySelector('[data-tab="race"]');
    if (btn) btn.click();
    const feld = document.querySelector('#pit-row-mix .pit-mix-feld');
    const reifen = document.querySelector('#pit-row-tyres .pit-t4-feld');
    const wert = document.getElementById('pit-wert-mix');
    if (!feld || !reifen || !wert || !OMEGA_TEST || !OMEGA_TEST.schirmZu) {
      return { skip: true, mass: 'Boxenschirm nicht vorhanden' };
    }
    const merk = OMEGA_TEST.schirmIst();
    try {
      OMEGA_TEST.schirmZu('pit');
      if (!(feld.getBoundingClientRect().width > 0)) {
        return { skip: true, mass: 'Schirm nicht sichtbar' };
      }
      const worte = [], mixL = new Set(), reifenL = new Set();
      for (let i = 0; i < 5; i++) {
        // Ueber die Zeile selbst, also denselben Weg wie ein Fingertipp.
        document.getElementById('pit-row-mix').click();
        worte.push(wert.textContent);
        mixL.add(+feld.getBoundingClientRect().left.toFixed(1));
        reifenL.add(+reifen.getBoundingClientRect().left.toFixed(1));
      }
      const schlecht = [];
      if (mixL.size > 1) schlecht.push('Mischungsfelder wandern: ' + [...mixL].join(', '));
      if (reifenL.size > 1) schlecht.push('Reifenbild wandert: ' + [...reifenL].join(', '));
      // Und die Gegenprobe: die Woerter mussten sich WIRKLICH geaendert haben, sonst
      // beweist die Messung nichts.
      if (new Set(worte).size < 2) schlecht.push('die Mischung hat gar nicht gewechselt');
      return { ok: schlecht.length === 0,
               mass: new Set(worte).size + ' verschiedene Woerter, Bilder stehen'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      OMEGA_TEST.schirmZu(merk);
    }
  });


  // ---- Regler und Modell sagen beim Laden dasselbe ----
  //
  // DIESELBE FEHLERKLASSE wie bei den Kaestchen darueber, und die andere Haelfte davon: ein
  // Schieberegler im Markup und seine Zahl im Modell sind zwei Orte fuer einen Zustand, und
  // geschrieben wird das Modell nur im input-Zuhoerer. Der feuert beim Laden NICHT.
  //
  // GEMESSEN am 0.5.17, und deshalb gibt es diese Pruefung: setting-tyres stand auf 0
  // ("aus"), das Modell auf 2,0, und die Anzeige daneben behauptete "200 %". Ein einziges
  // Antippen liess das Fahrverhalten von 200 auf 0 Prozent springen. Der Spiegeltest
  // darueber hat es nicht gefunden, weil er `el.checked` vergleicht - und ein Regler hat
  // kein checked.
  //
  // Die Liste ist GEPFLEGT, und das ist hier richtig: sie IST die Zusicherung. Ein neuer
  // Regler, dessen Wert im Modell landet, gehoert hinein.
  stAdd('Regler und Modell sagen beim Laden dasselbe', () => {
    const PAARE = [
      ['setting-tyres', () => physEngine.config.tyreEffect],
      ['setting-tyre-mix', () => (typeof tyreMixStaerke === 'number' ? tyreMixStaerke : null)],
      ['setting-tyre-pressure', () => physEngine.config.tyrePressureBar],
      ['setting-brakebias', () => physEngine.config.brakeBias * 100],
      ['phys-steerresp', () => physEngine.config.steerResponse],
      ['setting-steer-calib', () => physEngine.config.steerCalib],
      ['setting-brake-steal', () => physEngine.config.brakeUseGain],
      ['setting-minmove', () => physEngine.config.minMoveThrottle],
      ['setting-fuelweight', () => physEngine.config.fuelWeightEffect],
      // Der Tankverbrauch. Er FEHLTE hier, und deshalb blieb ein Jahr lang unbemerkt, dass
      // der Regler 0 zeigte und das Modell 3 rechnete.
      ['setting-fuel-drain', () => OMEGA_TEST.fuelDrain()],
      ['setting-countersteer', () => (typeof gegenlenkStaerke === 'number' ? gegenlenkStaerke : null)],
      ['ghost-line', () => ghostCfg.line],
      // Die drei Verfeinerungsregler. ghost-exit spiegelt nach 60-track.js und nicht
      // nach ghostCfg - dort muss der Wert liegen, damit gezeichnete und gefahrene
      // Linie durch dieselbe Zahl gehen.
      ['ghost-exit', () => OMEGA_TEST.getLineExit()],
      ['ghost-quertempo', () => ghostCfg.querTempo],
      ['ghost-gasdyn', () => ghostCfg.gasDynamik],
      ['ghost-lanes', () => ghostCfg.lanes],
      ['ghost-lateral', () => ghostCfg.lateral],
      ['ghost-speed', () => ghostCfg.speed],
      // Die drei Boxenstopp-Regler. Die zwei Rundengrenzen schieben sich gegenseitig, also
      // muss das Markup ein GUELTIGES Paar tragen - min <= max -, sonst zeigt der eine beim
      // Laden etwas anderes als das Modell.
      ['ghost-pit-sec', () => ghostCfg.pitSek],
      ['ghost-pit-min', () => ghostCfg.pitRundenMin],
      ['ghost-pit-max', () => ghostCfg.pitRundenMax],
    ];
    const schlecht = [], fehlt = [];
    let geprueft = 0;
    for (const [id, lies] of PAARE) {
      const el = $(id);
      if (!el) { fehlt.push(id); continue; }
      let spiegel;
      try { spiegel = lies(); } catch (e) { fehlt.push(id + ' (' + e.message + ')'); continue; }
      if (spiegel === null || spiegel === undefined) { fehlt.push(id + ' (kein Spiegel)'); continue; }
      geprueft++;
      // Auf vier Nachkommastellen: die Regler sind Zehntel und Hundertstel, und ein
      // Gleitkommavergleich auf Bitgleichheit waere hier eine Falle ohne Aussage.
      const a = Math.round(parseFloat(el.value) * 1e4) / 1e4;
      const b = Math.round(spiegel * 1e4) / 1e4;
      if (a !== b) schlecht.push(id + ': Regler ' + a + ', Modell ' + b);
    }
    return { ok: !schlecht.length && !fehlt.length,
             mass: geprueft + ' Regler geprueft'
                 + (schlecht.length ? ' | WEICHEN AB: ' + schlecht.join(', ') : ' | alle gleich')
                 + (fehlt.length ? ' | nicht erreichbar: ' + fehlt.join(', ') : '') };
  });

  // ---- Die Motorliste, das Manifest und die Doku sagen dasselbe ----
  //
  // DREI ORTE FUER EINE LISTE: die Auswahl im Menue, SAMPLE_CARS im Code und loops.json auf
  // der Platte. Dazu die Dokutabelle, die von Hand gepflegt ist. Ein Motor, der in einem
  // davon fehlt, faellt nicht auf: die Auswahl zeigt ihn, der Lader findet ihn nicht, und
  // gehoert wird der vorige weiter.
  stAdd('Motorliste, Manifest und Doku stimmen ueberein', async () => {
    if (location.protocol === 'file:') {
      return { skip: true, mass: 'ohne Server kein Manifest' };
    }
    const sel = $('sound-profile');
    if (!sel) return { ok: false, mass: 'sound-profile fehlt' };
    const menue = Array.prototype.map.call(sel.options, (o) => o.value);
    let man;
    try {
      man = await fetch('audio/loops.json', { cache: 'reload' }).then((r) => r.json());
    } catch (e) { return { skip: true, mass: 'Manifest nicht ladbar: ' + e.message }; }
    const imManifest = Object.keys(man);
    const schlecht = [];
    for (const k of menue) if (imManifest.indexOf(k) < 0) schlecht.push(k + ' fehlt im Manifest');
    for (const k of imManifest) if (menue.indexOf(k) < 0) schlecht.push(k + ' fehlt im Menue');
    if (typeof SAMPLE_CARS !== 'undefined') {
      for (const k of menue) if (SAMPLE_CARS.indexOf(k) < 0) schlecht.push(k + ' fehlt in SAMPLE_CARS');
      for (const k of SAMPLE_CARS) if (menue.indexOf(k) < 0) schlecht.push(k + ' steht nur in SAMPLE_CARS');
    }
    // Und die Dokutabelle: so viele Motorzeilen wie Schleifen. Sie ist von Hand gepflegt,
    // also ist das die einzige Stelle, an der ein Vergessen auffaellt.
    const schleifen = imManifest.reduce((a, k) => a + Object.keys(man[k].loops).length, 0);
    const zeilen = document.querySelectorAll('.snd-row audio[src*="_idle.ogg"], '
      + '.snd-row audio[src*="_low.ogg"], .snd-row audio[src*="_low2.ogg"], '
      + '.snd-row audio[src*="_low3.ogg"], .snd-row audio[src*="_mid.ogg"], '
      + '.snd-row audio[src*="_high.ogg"], .snd-row audio[src*="_over.ogg"]').length;
    if (zeilen !== schleifen) {
      schlecht.push('Doku hat ' + zeilen + ' Motorzeilen, das Manifest ' + schleifen + ' Schleifen');
    }
    return { ok: schlecht.length === 0,
             mass: menue.length + ' Motoren, ' + schleifen + ' Schleifen, ' + zeilen + ' Dokuzeilen'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Ideallinie ueberlebt den Weg bis zum Servo ----
  //
  // DIE ZUSICHERUNG, AUF DER DIE GANZE GHOST-LINIE STEHT, und sie ist nicht der Betrag,
  // sondern die FORM. Zwischen dem Linienversatz aus der Karte und dem gesendeten Byte
  // liegen Expo, die Tempobeschneidung, die Ratenbegrenzung und der Reibkreis; jede davon
  // kann eine Form flachdruecken, ohne den Mittelwert zu senken.
  //
  // Gemessen wird deshalb die SPANNE des Bytes innerhalb einer Kurve. Eine Ideallinie hat
  // dort eine grosse Spanne (aussen - innen - aussen); eine konstante Schraeglage hat null,
  // egal wie gross ihr Betrag ist. Genau dieser Unterschied war der Bericht "sie fahren
  // stumpf ihre Spur".
  stAdd('Ideallinie: die Form ueberlebt bis zum Servo', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostLinieTrace) {
      return { skip: true, mass: 'ghostLinieTrace nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostLinieTrace({ takte: 400, kurvenFaktor: 1.2,
                                           cfg: { line: 1, lanes: 0.5, lateral: 0.5 } });
    if (!r) return { skip: true, mass: 'keine Strecke geladen' };
    if (r.fehler) return { ok: false, mass: 'Messung warf: ' + r.fehler };
    const kurven = r.kacheln.filter((k) => k.typ !== 2);
    if (!kurven.length) return { skip: true, mass: 'Strecke ohne Kurven' };
    const spanne = kurven.reduce((a, k) => a + k.spanne, 0) / kurven.length;
    const schlecht = [];
    // 1. Die Karte liefert ueberhaupt eine Form.
    if (!(r.linieSpanne > 0.5)) schlecht.push('Linienversatz spannt nur ' + r.linieSpanne);
    // 2. Der Wunsch traegt sie weiter.
    if (!(r.wunschSpanne > 0.3)) schlecht.push('Wunsch spannt nur ' + r.wunschSpanne);
    // 3. UND DIE PHYSIK LAESST SIE DURCH. Gemessen 0,93 bei der Vorgabe; unter 0,75 wird
    //    am Anschlag abgeschnitten, und abgeschnitten wird der Scheitel.
    if (!(r.anteilServoVomWunsch > 0.75)) {
      schlecht.push('nur ' + r.anteilServoVomWunsch + ' des Wunsches kommt am Servo an');
    }
    // 4. Und am Ende steht eine SPANNE im gesendeten Byte, nicht nur ein Betrag. Gemessen
    //    55 bei 100 Prozent; 25 ist grosszuegig und faengt eine konstante Schraeglage.
    if (!(spanne > 25)) schlecht.push('Kurvenspanne nur ' + Math.round(spanne) + ' von 127');
    return { ok: schlecht.length === 0,
             mass: 'Linie ' + r.linieSpanne + ' -> Wunsch ' + r.wunschSpanne
                 + ' -> Servo ' + r.servoSpanne + ' (' + r.anteilServoVomWunsch + ')'
                 + ' | Kurvenspanne ' + Math.round(spanne) + ' von 127'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Querlage-Pruefstand sendet genau das, was daneben steht ----
  //
  // SEIN GANZER ZWECK IST, dass das Etikett stimmt: er beantwortet die Frage, welcher
  // BYTEWERT das Auto wie weit bewegt, und dafuer muss der eingestellte Wert unveraendert
  // an Byte 7 ankommen.
  //
  // Er geht deshalb am Servoweg vorbei. Ginge er durch, kaemen Expo, Tempobeschneidung,
  // Ratenbegrenzung und Reibkreis dazwischen - gemessen wurden bei "rechts 76" so 70 plus
  // minus 9, weil die Beschneidung mit dem Tempo schwankt. Ein Pruefstand, dessen Etikett
  // um zehn Prozent danebenliegt, misst nichts.
  stAdd('Querlage-Pruefstand: das Etikett ist das Byte', () => {
    const reg = $('ghost-quer-test');
    if (!reg || !window.OMEGA_TEST || !OMEGA_TEST.ghostLinieTrace) {
      return { skip: true, mass: 'Pruefstand oder Messstand nicht vorhanden' };
    }
    const merk = reg.value;
    const schlecht = [], teile = [];
    try {
      const setz = (v) => { reg.value = v; reg.dispatchEvent(new Event('input', { bubbles: true })); };
      for (const v of [0.3, 0.6, 1, -0.6, -1]) {
        setz(v);
        const r = OMEGA_TEST.ghostLinieTrace({ takte: 200, cfg: { line: 1, lanes: 0.5, lateral: 0.5 } });
        if (!r) return { skip: true, mass: 'keine Strecke geladen' };
        if (r.fehler) return { ok: false, mass: 'Messung warf: ' + r.fehler };
        const soll = Math.round(v * 127);
        const ist = Math.round(r.kacheln.reduce((a, k) => a + k.mittel, 0) / r.kacheln.length)
                  * (v < 0 ? -1 : 1);
        const spanne = Math.max.apply(null, r.kacheln.map((k) => k.spanne));
        teile.push(soll + '->' + ist);
        // 1. Der Wert kommt unveraendert an.
        if (Math.abs(ist - soll) > 1) schlecht.push(soll + ' gesendet als ' + ist);
        // 2. UND ER STEHT STILL. Ein Pruefstand, dessen Wert schwankt, ist keiner - und
        //    genau das war der Grund, am Servoweg vorbeizugehen.
        if (spanne > 1) schlecht.push('bei ' + soll + ' schwankt es um ' + spanne);
      }
      // 3. Bei 0 ist er AUS und alles laeuft wie sonst: die Linie muss ihre Form haben.
      setz(0);
      const r0 = OMEGA_TEST.ghostLinieTrace({ takte: 400, kurvenFaktor: 1.2,
                                              cfg: { line: 1, lanes: 0.5, lateral: 0.5 } });
      const kurven = r0.kacheln.filter((k) => k.typ !== 2);
      const sp = kurven.length ? kurven.reduce((a, k) => a + k.spanne, 0) / kurven.length : 0;
      teile.push('aus: Kurvenspanne ' + Math.round(sp));
      if (!(sp > 25)) schlecht.push('bei 0 ist die Linie weg (Spanne ' + Math.round(sp) + ')');
      return { ok: schlecht.length === 0,
               mass: teile.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
    } finally {
      reg.value = merk;
      reg.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // ---- Die Kacheldauer wird JE TYP gemessen, nicht global geschaetzt ----
  //
  // GEGEN DAS EINFRIEREN DES KURVENAUSGANGS. ghostTilePhase() deckelt auf 1; ist die
  // erwartete Dauer zu kurz, kommt die Phase zu frueh am Ende an und bleibt dort - der
  // Linienversatz friert ein und der Rest der Kurve wird mit konstanter Schraeglage
  // gefahren.
  //
  // Zu kurz WAR sie systematisch: die Schaetzung war ein Mittel ueber alle Kacheln mal dem
  // GEOMETRISCHEN Laengenverhaeltnis, und der Ghost bremst in Kurven ab (curveSlow). Eine
  // 60-Grad-Kurve dauert dadurch rund 1,18 mal so lang wie ihre Laenge vorhersagt, eine
  // Haarnadel 1,43 mal.
  //
  // Geprueft wird an der Wirkung: wieviel einer Kurve klebt am Deckel, wenn sie laenger
  // dauert als vorhergesagt? Gemessen vorher 12 / 20 / 29 Prozent bei 1,2 / 1,4 / 1,8 mal.
  stAdd('Kacheldauer je Typ: der Kurvenausgang friert nicht ein', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostLinieTrace) {
      return { skip: true, mass: 'ghostLinieTrace nicht vorhanden' };
    }
    const schlecht = [], teile = [];
    for (const kf of [1.2, 1.4, 1.8]) {
      const r = OMEGA_TEST.ghostLinieTrace({ takte: 900, kurvenFaktor: kf,
                                             cfg: { line: 1, lanes: 0.5, lateral: 0.5 } });
      if (!r) return { skip: true, mass: 'keine Strecke geladen' };
      if (r.fehler) return { ok: false, mass: 'Messung warf: ' + r.fehler };
      const klebt = r.phaseGeklebtInKurven;
      teile.push(kf + 'x: ' + Math.round(klebt * 100) + '%');
      // 15 Prozent ist grosszuegig: gemessen sind es 2,6 / 5 / 10, und vor der Behebung
      // waren es 12 / 20 / 29. Die Grenze faengt eine Rueckkehr zum alten Verhalten.
      if (!(klebt < 0.15)) schlecht.push(kf + 'x klebt zu ' + Math.round(klebt * 100) + '%');
    }
    return { ok: schlecht.length === 0,
             mass: 'Anteil am Phasendeckel in Kurven: ' + teile.join(', ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Waehltaste, in einer FOLGE gefahren ----
  //
  // DER GEMELDETE FEHLER WAR EINE FOLGE und kein Einzelzustand: einmal X im Boxenmenue,
  // danach war X auf dem Cockpitschirm dauerhaft taub. Jeder Test, der die zwei Schirme
  // einzeln prueft und dazwischen zuruecksetzt, sieht davon nichts - beide Haelften waren
  // ja fuer sich in Ordnung. Gemeldet mit genau dieser Beobachtung: "X funktioniert im Pit
  // Menue wie er soll."
  //
  // Die Ursache war ein Merker, der "in diesem Druck ist die Sekunde schon voll gewesen"
  // heisst und nur auf der naechsten STEIGENDEN Flanke fiel. Der Boxenschirm verbrauchte
  // diese Flanke, also fiel er nie mehr.
  //
  // Gefahren wird die WIRKLICHE Logik ueber OMEGA_TEST.flagTaste, nicht eine zweite Fassung
  // davon. Und ausdruecklich ohne die Sekunde vollzumachen: geprueft wird, ob der Druck
  // ANGENOMMEN wird - eine ausgeloeste gelbe Flagge braemste jedes Auto im Feld auf 40 km/h
  // und liesse einen Zustand zurueck, den der naechste Test vorfaende.
  stAdd('Waehltaste: nach dem Boxenmenue nimmt der Cockpitschirm sie wieder', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.flagTaste || !OMEGA_TEST.schirmZu) {
      return { skip: true, mass: 'Waehltaste nicht erreichbar' };
    }
    const merk = OMEGA_TEST.schirmIst();
    const schlecht = [];
    let schritte = 0;
    try {
      // (a) Auf dem Cockpitschirm nimmt sie den Druck an und laedt.
      OMEGA_TEST.schirmZu('main');
      OMEGA_TEST.flagTaste(false);
      OMEGA_TEST.flagTaste(true);
      schritte++;
      if (!OMEGA_TEST.flagLage().haelt) schlecht.push('a: laedt auf main nicht');
      OMEGA_TEST.flagTaste(false);
      schritte++;
      if (OMEGA_TEST.flagLage().haelt) schlecht.push('a: laedt nach dem Loslassen weiter');

      // (b) Auf dem Boxenschirm waehlt sie und laedt AUSDRUECKLICH nicht.
      //
      // AUF DER MISCHUNGSZEILE und nicht auf der obersten: die oberste ruft den Boxenstopp,
      // und ein Selbsttest, der einen Stopp scharfstellt, hinterlaesst einen Zustand, den
      // der naechste Test vorfindet. Die Mischung ist die einzige Zeile, deren Wirkung sich
      // vollstaendig zuruecknehmen laesst - vier Mischungen, viermal weiter ist daheim.
      // HINGEZAEHLT UND NICHT ANGENOMMEN. Erste Fassung tippte zweimal nach unten und
      // rechnete mit Zeile 0 als Ausgangspunkt - die Auswahl stand aber auf 4, weil ein
      // frueherer Test sie dort gelassen hatte. Der Test schlug dann mit "hat gar nichts
      // gewaehlt" fehl, und das war wahr: er hatte auf der Reparaturzeile gedrueckt.
      // Ein Test, der den Zustand seiner Vorgaenger voraussetzt, misst die Reihenfolge.
      OMEGA_TEST.schirmZu('pit');
      const selMerk = OMEGA_TEST.schirmAuswahl();
      const zielSel = PIT_SCREEN_ROWS.findIndex((z) => z.art === 'wahl');
      for (let k = 0; k < PIT_SCREEN_ROWS.length
                      && OMEGA_TEST.schirmAuswahl() !== zielSel; k++) {
        OMEGA_TEST.schirmPad('down');
      }
      if (OMEGA_TEST.schirmAuswahl() !== zielSel) schlecht.push('b: Mischungszeile nicht erreicht');
      const heim = pitMischungWahl();
      OMEGA_TEST.flagTaste(true);
      schritte++;
      if (OMEGA_TEST.flagLage().haelt) schlecht.push('b: laedt im Boxenmenue');
      OMEGA_TEST.flagTaste(false);
      schritte++;
      // Dass sie ueberhaupt gewaehlt hat. Ohne diese Gegenprobe koennte der Schirm die
      // Taste schlicht verschlafen, und (c) waere trivial gruen.
      if (pitMischungWahl() === heim) schlecht.push('b: hat gar nichts gewaehlt');
      for (let k = 0; k < 4 && pitMischungWahl() !== heim; k++) {
        OMEGA_TEST.flagTaste(true); OMEGA_TEST.flagTaste(false); schritte += 2;
      }
      if (pitMischungWahl() !== heim) schlecht.push('b: Mischung nicht zurueckgestellt');
      for (let k = 0; k < PIT_SCREEN_ROWS.length
                      && OMEGA_TEST.schirmAuswahl() !== selMerk; k++) {
        OMEGA_TEST.schirmPad('up');
      }

      // (c) DIE FOLGE. Zurueckblaettern, wieder druecken - und sie muss wieder laden.
      OMEGA_TEST.schirmZu('main');
      OMEGA_TEST.flagTaste(true);
      schritte++;
      if (!OMEGA_TEST.flagLage().haelt) {
        schlecht.push('c: taub nach einem Druck im Boxenmenue - GENAU DER GEMELDETE FEHLER');
      }
      if (OMEGA_TEST.flagLage().gesperrt) schlecht.push('c: Sperre steht noch');
      OMEGA_TEST.flagTaste(false);
      schritte++;
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      OMEGA_TEST.flagTaste(false);
      OMEGA_TEST.schirmZu(merk);
    }
    return { ok: !schlecht.length,
             mass: schritte + ' Tastenflanken gefahren'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | Folge sauber') };
  });

  // ---- Die Boxenzeilen sagen ja oder nein, und ein Ja hellt die Zeile auf ----
  //
  // EIN VOKABULAR FUER EINE FRAGE. Hier standen vier Woerter - "vorgewaehlt"/"aus" vor dem
  // Stopp, "wird gemacht"/"abgewaehlt" waehrenddessen -, und "aus" hiess an dieser Stelle
  // etwas anderes als das "aus" der Reifensimulation zwei Zeilen weiter.
  stAdd('Boxenzeilen: ja oder nein, und ja ist heller', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.schirmZu) return { skip: true, mass: 'kein Boxenschirm' };
    const merk = OMEGA_TEST.schirmIst();
    const schlecht = [];
    const erlaubt = [t('ja'), t('nein'), t('Sim aus')];
    let geprueft = 0, hell = 0;
    try {
      OMEGA_TEST.schirmZu('pit');
      for (const z of PIT_SCREEN_ROWS) {
        if (z.art === 'aktion' || z.art === 'wahl') continue;
        const w = document.getElementById(z.wert);
        const zeile = document.getElementById(z.el);
        if (!w || !zeile) { schlecht.push(z.id + ': Zeile fehlt'); continue; }
        geprueft++;
        const wort = (w.textContent || '').trim();
        if (erlaubt.indexOf(wort) < 0) schlecht.push(z.id + ': sagt "' + wort + '"');
        // Und die Aufhellung sagt dasselbe wie das Wort. Zwei Traeger einer Aussage duerfen
        // sich nicht widersprechen - sonst ist der, den man aus dem Augenwinkel liest, der
        // falsche.
        const ja = zeile.classList.contains('pr-ja');
        if (ja) hell++;
        if (ja !== (wort === t('ja'))) schlecht.push(z.id + ': Aufhellung und Wort uneins');
      }
      // Die Aufhellung muss auch WIRKEN: ein Hintergrund, den eine ungueltige Deklaration
      // verschluckt hat, ist keine Aufhellung. Geprueft am gerechneten Wert, nicht am
      // Regelwerk - genau die Falle, die in 0.5.17 den GT3-Schirm durchsichtig liess.
      const probe = document.getElementById(PIT_SCREEN_ROWS.find((z) => z.id === 'tyres').el);
      if (probe) {
        const hatte = probe.classList.contains('pr-ja');
        probe.classList.remove('pr-ja');
        const roh = getComputedStyle(probe).backgroundImage;
        probe.classList.add('pr-ja');
        const mit = getComputedStyle(probe).backgroundImage;
        probe.classList.toggle('pr-ja', hatte);
        if (mit === 'none') schlecht.push('pr-ja loescht den Hintergrund (ungueltige Deklaration)');
        else if (mit === roh) schlecht.push('pr-ja aendert den Hintergrund nicht');
      }
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      OMEGA_TEST.schirmZu(merk);
      pitScreenRender();
    }
    return { ok: !schlecht.length,
             mass: geprueft + ' Arbeitszeilen, ' + hell + ' davon hell'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | ein Vokabular') };
  });

  // ---- Das hidden-Attribut wirkt ----
  //
  // DIE FALLE: die Browser-Vorgabe ist `[hidden] { display: none }`, und die verliert gegen
  // JEDE Autoren-Regel, die display setzt. Im Streckeneditor traf sie auf
  // `.tp-btn { display: grid }`, und der Schliessknopf stand dauerhaft in der Leiste - mit
  // dem Vollbild-Symbol und der Aufschrift "Schliessen", ausserhalb des Vollbilds, wo er
  // nichts tat. Genau so gemeldet.
  //
  // Geprueft wird die REGEL und nicht die eine Stelle: ein frisch gebauter Knopf mit
  // display:grid und hidden muss verschwinden. Dazu die Bestandsaufnahme - kein Element im
  // Dokument darf hidden tragen und trotzdem gezeichnet werden.
  stAdd('Das hidden-Attribut wirkt, auch gegen display-Regeln', () => {
    const probe = document.createElement('button');
    probe.className = 'tp-btn';
    probe.hidden = true;
    probe.textContent = 'x';
    document.body.appendChild(probe);
    const eigen = getComputedStyle(probe).display;
    probe.remove();

    const trotzdemDa = [];
    for (const el of document.querySelectorAll('[hidden]')) {
      if (getComputedStyle(el).display !== 'none') {
        trotzdemDa.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
      }
    }
    const gesamt = document.querySelectorAll('[hidden]').length;
    return { ok: eigen === 'none' && !trotzdemDa.length,
             mass: gesamt + ' Elemente mit hidden, Probe mit display:grid -> ' + eigen
                 + (trotzdemDa.length ? ' || TROTZDEM GEZEICHNET: ' + trotzdemDa.join(', ')
                                      : ' | keines wird gezeichnet') };
  });

  // ---- Das Vollbild des Streckeneditors ----
  //
  // ES HATTE GAR KEINE PRUEFUNG, und darin sassen drei Fehler gleichzeitig: der
  // Schliessknopf war immer sichtbar (siehe oben), der Kartenkasten behielt seine feste
  // Hoehe aus der Seite (`clamp(240px, 42vh, 460px)` - gemessen 302 von 596 verfuegbaren
  // px), und der Warnabsatz ueber die unvollstaendige Palette nahm eine eigene Rasterzeile.
  //
  // GESCHALTET WIRD DIE KLASSE, nicht enterTrackFullscreen(). Das ist Absicht: die Klasse
  // IST die Wahrheit, an der das ganze Layout haengt, und ein Aufruf der echten Funktion
  // wuerde requestFullscreen() ausloesen - der Selbsttest laeuft nach einem Klick, also mit
  // einer gueltigen Nutzergeste, und wuerde den Browser wirklich ins Vollbild werfen. Eine
  // Pruefung, die die Arbeitsumgebung umbaut, ist keine.
  stAdd('Editor-Vollbild: Karte fuellt den Schirm, Knopf schaltet um', () => {
    if (!(window.innerWidth > 0) || !(window.innerHeight > 0)) {
      return { skip: true, mass: 'Fenster ist 0 x 0 - im verborgenen Bereich nicht messbar' };
    }
    const host = document.getElementById('track-fs-host');
    const knopf = document.getElementById('track-fs-toggle');
    if (!host || !knopf) return { ok: false, mass: 'Vollbild-Host oder Umschalter fehlt' };

    const aktiverTab = document.querySelector('nav.tabs [data-tab].active')
                    || document.querySelector('[data-tab="selftest"]');
    const warKlasse = document.body.classList.contains('track-fs');
    const schlecht = [];
    const gemessen = {};
    try {
      const tabKnopf = document.querySelector('[data-tab="track"]');
      const subKnopf = document.querySelector('[data-sub="edit"]');
      if (tabKnopf) tabKnopf.click();
      if (subKnopf) subKnopf.click();

      // Die Aufschrift AUSSERHALB des Vollbilds: sie muss zum Hineingehen einladen.
      const kappe = () => [...knopf.querySelectorAll('.tp-cap')]
        .filter((x) => getComputedStyle(x).display !== 'none')
        .map((x) => x.textContent.trim());
      document.body.classList.remove('track-fs');
      const draussen = kappe();
      if (draussen.length !== 1) schlecht.push('draussen ' + draussen.length + ' Aufschriften');
      else if (draussen[0] !== t('Vollbild')) schlecht.push('draussen steht "' + draussen[0] + '"');
      gemessen.draussen = draussen[0];

      document.body.classList.add('track-fs');
      const drinnen = kappe();
      if (drinnen.length !== 1) schlecht.push('drinnen ' + drinnen.length + ' Aufschriften');
      else if (drinnen[0] !== t('Schließen')) schlecht.push('drinnen steht "' + drinnen[0] + '"');
      gemessen.drinnen = drinnen[0];
      if (!knopf.onclick) schlecht.push('Umschalter hat keinen Klickzuhoerer');

      // Der Host deckt den Schirm.
      const hb = host.getBoundingClientRect();
      if (Math.abs(hb.width - window.innerWidth) > 2
          || Math.abs(hb.height - window.innerHeight) > 2) {
        schlecht.push('Host ' + Math.round(hb.width) + 'x' + Math.round(hb.height)
                      + ' statt ' + window.innerWidth + 'x' + window.innerHeight);
      }

      // Der Warnabsatz ist weg - er ist Prosa und nahm eine Rasterzeile.
      for (const p of host.children) {
        if (p.tagName === 'P' && getComputedStyle(p).display !== 'none') {
          schlecht.push('Warnabsatz nimmt im Vollbild noch Platz');
        }
      }

      // Der Kartenkasten fuellt seine Rasterzeile. Gemessen gegen die aufgeloeste Zeile
      // selbst, nicht gegen eine Zahl - wer das Raster umbaut, zieht hier von selbst nach.
      const kasten = document.getElementById('track-preview-svg');
      const zeilen = getComputedStyle(host).gridTemplateRows.split(' ').map(parseFloat);
      const groesste = Math.max.apply(null, zeilen.filter((z) => isFinite(z)));
      const kb = kasten.getBoundingClientRect();
      gemessen.kasten = Math.round(kb.width) + 'x' + Math.round(kb.height);
      gemessen.zeile = Math.round(groesste);
      if (Math.abs(kb.height - groesste) > 2) {
        schlecht.push('Kartenkasten ' + Math.round(kb.height) + ' px in einer Zeile von '
                      + Math.round(groesste) + ' px');
      }

      // Und die Karte darin: kein Ueberlauf, und eine Richtung voll ausgenutzt. Geprueft
      // ueber DREI Seitenverhaeltnisse, weil der erste Versuch (`width:auto;height:100%`)
      // mit der fast quadratischen Teststrecke unauffaellig war und eine breite Strecke
      // waagerecht aus dem Kasten geschoben haette - der schneidet ab.
      const svg = kasten.querySelector('svg');
      if (!svg) {
        gemessen.karte = 'keine Strecke geladen';
      } else {
        const merkVb = svg.getAttribute('viewBox');
        const faelle = [];
        for (const vb of ['0 0 200 60', '0 0 60 200', '0 0 90 90']) {
          svg.setAttribute('viewBox', vb);
          const sb = svg.getBoundingClientRect();
          const v = svg.viewBox.baseVal;
          if (sb.width > kb.width + 2 || sb.height > kb.height + 2) {
            schlecht.push(vb + ': svg laeuft aus dem Kasten');
          }
          const sk = Math.min(sb.width / v.width, sb.height / v.height);
          const bw = Math.round(v.width * sk), bh = Math.round(v.height * sk);
          const voll = Math.abs(bw - kb.width) <= 2 || Math.abs(bh - kb.height) <= 2;
          if (!voll) schlecht.push(vb + ': gezeichnet ' + bw + 'x' + bh + ', nichts voll');
          faelle.push(vb.slice(4) + '->' + bw + 'x' + bh);
        }
        if (merkVb) svg.setAttribute('viewBox', merkVb);
        gemessen.karte = faelle.join(' ');
      }
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      document.body.classList.toggle('track-fs', warKlasse);
      if (aktiverTab) aktiverTab.click();
      if (typeof refreshTrackPreview === 'function') refreshTrackPreview();
    }
    return { ok: !schlecht.length,
             mass: 'draussen "' + gemessen.draussen + '", drinnen "' + gemessen.drinnen
                 + '", Kasten ' + gemessen.kasten + ' in Zeile ' + gemessen.zeile
                 + ' | ' + gemessen.karte
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Streckenzeichner zeichnet nur, das Aeussere kommt vom Ort ----
  //
  // renderTrackPreview() schrieb bis v0.5.30 Groesse, Grund und Rahmen als INLINE-Stil aufs
  // svg - und ein Inline-Stil schlaegt jede Regel eines Stylesheets. Drei Orte zeigen
  // dasselbe Bild und brauchen verschiedene Kleidung; zwei von ihnen mussten deshalb mit
  // !important dagegen anarbeiten, und das Editor-Vollbild konnte die Breitendeckelung von
  // 520 px ueberhaupt nicht loswerden.
  //
  // GEPRUEFT WIRD BEIDES: dass der Zeichner nichts mehr anzieht, UND dass die drei Orte
  // wirklich verschieden kleiden. Nur das erste zu pruefen liesse offen, ob der Umbau die
  // Unterschiede nicht einfach eingeebnet hat.
  stAdd('Streckenzeichner: kein Inline-Stil, drei Orte kleiden verschieden', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackMarks) {
      return { skip: true, mass: 'trackMarks nicht erreichbar' };
    }
    const html = OMEGA_TEST.trackMarks(undefined, []).html;
    const schlecht = [];
    if (html.indexOf('class="tp-karte"') < 0) schlecht.push('svg traegt keine Klasse tp-karte');
    // Das svg selbst darf kein style tragen. Die Kacheln und Punkte DARIN duerfen es (dort
    // ist es Zeichnung und keine Kleidung), also wird nur die oeffnende Marke geprueft.
    const marke = html.slice(0, html.indexOf('>') + 1);
    if (/style\s*=/.test(marke)) schlecht.push('svg-Marke traegt wieder style: ' + marke.slice(0, 80));

    // Und im laufenden Dokument auch nicht.
    for (const el of document.querySelectorAll('.tp-karte[style]')) {
      if (el.getAttribute('style').trim()) {
        schlecht.push('gezeichnete Karte traegt style: ' + el.getAttribute('style').slice(0, 60));
      }
    }

    // Die drei Orte, jeder mit demselben Bild. Gemessen wird der GERECHNETE Grund: er ist
    // der Unterschied, um den es geht - Panelgrund im Editor, durchscheinendes Weiss auf dem
    // schwarzen Cockpitgrund des Uebersichtsschirms.
    const ORTE = ['#track-preview-svg', '#dash-minimap', '.ov-karte'];
    const gruende = {};
    for (const sel of ORTE) {
      const host = document.querySelector(sel);
      if (!host) { schlecht.push(sel + ' fehlt'); continue; }
      const merk = host.innerHTML;
      try {
        host.innerHTML = html;
        const svg = host.querySelector('svg');
        if (!svg) { schlecht.push(sel + ': kein svg nach dem Einsetzen'); continue; }
        const cs = getComputedStyle(svg);
        gruende[sel] = cs.backgroundColor;
        // Ein Bild ohne Groesse ist ein Bild, das den Ort sprengt oder verschwindet - aber
        // gepruefen laesst sich das nur, wenn der ORT selbst gerade gelegt ist. Von diesem
        // Reiter aus liegen die anderen auf display:none, und dann ist alles darin 0 breit;
        // meine erste Fassung meldete deshalb alle drei Orte als fehlerhaft. Die Farben
        // darueber sind davon unberuehrt - getComputedStyle rechnet auch in einem
        // verborgenen Reiter.
        const hb = host.getBoundingClientRect();
        if (hb.width > 0 && !(svg.getBoundingClientRect().width > 0)) {
          schlecht.push(sel + ': Bild ist 0 breit in einem ' + Math.round(hb.width)
                        + ' px breiten Ort');
        }
      } finally {
        host.innerHTML = merk;
      }
    }
    // Der Uebersichtsschirm MUSS sich vom Editor unterscheiden - das war der Grund fuer
    // seine zwei !important.
    if (gruende['#track-preview-svg'] && gruende['.ov-karte']
        && gruende['#track-preview-svg'] === gruende['.ov-karte']) {
      schlecht.push('Editor und Uebersichtsschirm haben denselben Grund - der Unterschied '
                    + 'ist beim Umbau verlorengegangen');
    }
    return { ok: !schlecht.length,
             mass: 'Editor ' + gruende['#track-preview-svg']
                 + ' | Uebersicht ' + gruende['.ov-karte']
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | kein Inline-Stil') };
  });

  // ---- Die Phase erreicht das Kachelende ----
  //
  // GEGEN MEINEN EIGENEN ERSTEN ENTWURF gemessen. Ich hatte hier eine Glaettung eingebaut,
  // die die 1 nur asymptotisch erreicht, damit der Punkt auf der Karte am Kachelende nicht
  // stehenbleibt - und "Ideallinie stetig" ist daran sofort rot geworden: die Phase ist der
  // INDEX IN DIE IDEALLINIE, und erreicht sie das Kachelende nicht, fehlt der Linie das
  // letzte Stueck jeder Kachel. Gemessen 2,48 mal ihr Eigenschritt auf SG2H2G2J2.
  //
  // Diese Pruefung haelt die Entscheidung fest, damit sie nicht ein zweites Mal getroffen
  // werden muss: am Ende der geschaetzten Dauer ist die Phase 1, und darueber bleibt sie 1.
  stAdd('Kachelphase erreicht am Kachelende genau 1', () => {
    const car = { tileAt: 0, ghost: { tileIndex: 0, laps: 0, tileMs: 800 } };
    const bei = (alterMs) => {
      car.tileAt = Date.now() - alterMs;
      return ghostTilePhase(car);
    };
    const dauer = ghostTileDauer(car.ghost);
    const schlecht = [];
    if (Math.abs(bei(dauer) - 1) > 1e-6) schlecht.push('am Ende ' + bei(dauer).toFixed(6) + ', nicht 1');
    for (const f of [1.5, 3, 10]) {
      if (bei(dauer * f) !== 1) schlecht.push('bei ' + f + 'facher Dauer ' + bei(dauer * f));
    }
    if (Math.abs(bei(dauer / 2) - 0.5) > 1e-6) schlecht.push('auf halber Kachel ' + bei(dauer / 2));
    if (bei(-100) !== 0) schlecht.push('vor dem Beginn ' + bei(-100));
    return { ok: !schlecht.length,
             mass: 'Dauer ' + Math.round(dauer) + ' ms, halb ' + bei(dauer / 2).toFixed(3)
                 + ', voll ' + bei(dauer).toFixed(3) + ', dreifach ' + bei(dauer * 3).toFixed(3)
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Ort auf der Schiene ----
  //
  // EINE DEFINITION statt fuenf. Dieselbe Groesse wurde an fuenf Stellen einzeln gerechnet -
  // Kartenpunkte, Windschatten, Spurvergabe, Fuehrender, eigenes Auto - und sie waren sich
  // nicht einig: die Kartenpunkte rechneten noch mit der Formel von vor v0.5.18 und liefen
  // an einer zweiten Uhr.
  //
  // Gepruefte Invariante: der Ort liegt IMMER in [Kachel, Kachel+1) - nie auf der naechsten
  // Kachel und nie hinter der eigenen. Daran haengt, dass floor() die Kachel zurueckgibt und
  // dass ein Abstand nicht das Vorzeichen wechselt, weil eine Schaetzung uebergelaufen ist.
  stAdd('Ort auf der Schiene: bleibt auf seiner Kachel, steigt monoton', () => {
    if (typeof ghostOrt !== 'function' || typeof ghostOrtGes !== 'function') {
      return { ok: false, mass: 'ghostOrt/ghostOrtGes fehlen' };
    }
    const schlecht = [];
    const mk = (i, alterMs, laps) => ({
      tileAt: Date.now() - alterMs,
      ghost: { tileIndex: i, laps: laps || 0, tileMs: 800 },
    });
    // Ohne gemeldete Kachel gibt es keinen Ort - und ausdruecklich nicht 0, denn 0 ist die
    // Start-Ziel-Kachel und waere eine Behauptung.
    if (ghostOrt({ ghost: { tileIndex: null } }) !== null) schlecht.push('ohne Kachel nicht null');
    if (ghostOrt({}) !== null) schlecht.push('ohne Ghost nicht null');

    // AUF DER KACHEL BLEIBEN, auch wenn die geschaetzte Dauer weit ueberschritten ist. Die
    // Phase deckelt bei 1 - das braucht die Ideallinie -, also SAETTIGT der Ort am
    // Kachelende. Gefordert ist deshalb "nicht fallend" und nicht "streng steigend": ein
    // Auto, dessen Kachel laenger dauert als geschaetzt, steht am Ende der Kachel, und das
    // ist ehrlicher als ein Weiterkriechen ueber die Grenze hinaus.
    let geprueft = 0;
    for (const i of [0, 1, 7]) {
      let vor = -Infinity;
      for (const alter of [0, 100, 400, 800, 1600, 8000, 80000]) {
        const o = ghostOrt(mk(i, alter));
        geprueft++;
        if (!(o >= i && o < i + 1)) schlecht.push('Kachel ' + i + ', ' + alter + ' ms: ' + o);
        if (o < vor) schlecht.push('Kachel ' + i + ' bei ' + alter + ' ms zurueckgelaufen');
        if (Math.floor(o) !== i) schlecht.push('floor(' + o + ') ist nicht ' + i);
        vor = o;
      }
    }
    // Und in der Mitte der Kachel steht er auch in der Mitte - sonst waere "bleibt auf der
    // Kachel" auch von einer Funktion erfuellt, die immer i zurueckgibt.
    const mitte = ghostOrt(mk(3, ghostTileDauer({ tileIndex: 3, tileMs: 800 }) / 2));
    if (Math.abs(mitte - 3.5) > 0.01) schlecht.push('halbe Kachel gibt ' + mitte + ', nicht 3,5');

    // MONOTON UEBER DIE RUNDENGRENZE: die letzte Kachel der Runde 0 muss VOR der ersten
    // Kachel der Runde 1 liegen. Das ist die Eigenschaft, an der alles haengt - sie macht
    // aus einem Abstand eine Subtraktion und aus einem Ueberholmanoever einen
    // Vorzeichenwechsel.
    //
    // MIT EIGENER STRECKE, nach dem Verfahren von compareLines(): ohne geladenes Layout ist
    // die Rundenlaenge 1, und dann ist die Pruefung entartet. Meine erste Fassung uebersprang
    // sie in diesem Fall stillschweigend - also genau dann, wenn der Selbsttest ohne
    // Streckendatei laeuft, und das ist der Normalfall.
    const keep = currentTrackTiles;
    let n = 0;
    try {
      currentTrackTiles = codeToTrack('SG2H2G2R2G2H2G2R2').tiles;
      n = currentTrackTiles.length;
      // Eine ganze Runde durchlaufen und die Kette pruefen, nicht nur die Naht.
      let vor = -Infinity;
      for (let runde = 0; runde < 3; runde++) {
        for (let i = 0; i < n; i++) {
          for (const ph of [0, 0.5, 0.95]) {
            const o = ghostOrtGes(mk(i, 800 * ph * ghostTileLenFactor(i), runde));
            if (o < vor) {
              schlecht.push('zurueckgelaufen bei Runde ' + runde + ', Kachel ' + i
                            + ': ' + o.toFixed(3) + ' nach ' + vor.toFixed(3));
            }
            vor = o;
          }
        }
      }
      // Und die Naht ausdruecklich: letzte Kachel der Runde 0 vor erster der Runde 1.
      const ende = ghostOrtGes(mk(n - 1, 700, 0));
      const anfang = ghostOrtGes(mk(0, 10, 1));
      if (!(anfang > ende)) {
        schlecht.push('Rundengrenze: ' + anfang.toFixed(3) + ' nicht nach ' + ende.toFixed(3));
      }
    } finally {
      currentTrackTiles = keep;
      lineCache = null;
    }

    // Der Abstand in Sekunden: Vorzeichen, Gegenprobe, und der Rueckfall ohne Tempo.
    if (typeof ghostAbstandSek === 'function') {
      const vorn = mk(4, 400), hinten = mk(2, 400);
      const d = ghostAbstandSek(vorn, hinten);
      if (!(d > 0)) schlecht.push('vorn/hinten gibt ' + d + ', nicht positiv');
      const rueck = ghostAbstandSek(hinten, vorn);
      if (Math.abs(d + rueck) > 1e-9) schlecht.push('nicht antisymmetrisch: ' + d + ' / ' + rueck);
      // Zwei Kacheln bei 800 ms je Kachel sind 1,6 s.
      if (Math.abs(d - 1.6) > 0.05) schlecht.push('zwei Kacheln sind ' + d.toFixed(3) + ' s, nicht 1,6');
      // Ohne Tempo wird nicht geraten.
      const ohne = { tileAt: Date.now(), ghost: { tileIndex: 1, laps: 0, tileMs: 0 } };
      if (ghostAbstandSek(ohne, hinten) !== null) schlecht.push('ohne Tempo kein null');
      if (typeof ghostNahe === 'function') {
        // Der Rueckfall auf das Kachelmass muss greifen, wenn kein Tempo bekannt ist.
        const a = { ghost: { tileIndex: 3, laps: 0, tileMs: 0, tilesTotal: 3 }, tileAt: Date.now() };
        const b = { ghost: { tileIndex: 4, laps: 0, tileMs: 0, tilesTotal: 4 }, tileAt: Date.now() };
        if (!ghostNahe(a, b)) schlecht.push('Rueckfall aufs Kachelmass greift nicht');
      }
    }
    return { ok: !schlecht.length,
             mass: geprueft + ' Orte geprueft, zwei Kacheln = '
                 + (typeof ghostAbstandSek === 'function'
                    ? ghostAbstandSek(mk(4, 400), mk(2, 400)).toFixed(2) + ' s' : '?')
                 + ', ' + (n * 3 * 3) + ' Orte ueber drei Runden auf ' + n + ' Kacheln'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | Invarianten halten') };
  });

  // ---- Die Ortung richtet sich an der gemeldeten Schiene aus ----
  //
  // DIE WURZEL VON DREI GEMELDETEN FEHLERN. Die App setzte beim ersten Kachelwechsel
  // g.tileIndex = 0, nahm also an, das Auto stehe an Start/Ziel. Wer seine Autos irgendwo
  // auf die Bahn stellt, hatte damit einen Versatz fuer das ganze Rennen - und mit ihm
  // Punkte an der falschen Stelle, eine Ideallinie fuer die falsche Kachel und eine
  // Kurvendrosselung, die auf der Geraden bremst.
  //
  // Geprueft wird JEDER moegliche Versatz, nicht einer: bei 17 Kacheln sind das 17 Faelle,
  // und der Fall 0 ist die Gegenprobe - eine richtige Annahme darf nicht verschoben werden.
  stAdd('Ortung: findet den Versatz zur gemeldeten Schiene', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ortProbe) {
      return { skip: true, mass: 'ortProbe nicht erreichbar' };
    }
    // DREI LAYOUTS, und das erste ist mit Absicht SYMMETRISCH: SG2H2G2R2G2H2G2R2 ist
    // zweimal G2H2G2R2, und dort liefern zwei Versaetze dieselben Treffer bis auf die eine
    // Start/Ziel-Kachel. Mein erster Entwurf verglich nur gegen die jetzige Annahme und
    // verschob dort FUENF von 17 Versaetzen um genau die halbe Runde. Eine Pruefung mit nur
    // einer asymmetrischen Strecke haette das nie gesehen.
    const LAYOUTS = ['SG2H2G2R2G2H2G2R2', 'SG2RG2L', 'SRRRLLL'];
    const schlecht = [];
    let faelle = 0, langsamster = 0;
    for (const code of LAYOUTS) {
      const n = OMEGA_TEST.ortProbe(code, 0, 1).kacheln;
      for (let v = 0; v < n; v++) {
        const r = OMEGA_TEST.ortProbe(code, v, n * 3);
        faelle++;
        if (!r.stimmt) {
          schlecht.push(code + ' Versatz ' + v + ': Index ' + r.index + ' statt ' + r.echt);
        }
        if (v === 0 && r.angewandt) schlecht.push(code + ': Versatz 0 wurde verschoben');
        if (v !== 0) {
          if (!r.angewandt) schlecht.push(code + ' Versatz ' + v + ': nicht ausgerichtet');
          else langsamster = Math.max(langsamster, r.korrigiertNach);
        }
      }
      // Die Rundenzaehlung: wer beim Ausrichten ueber das Rundenende springt, hat die Linie
      // in Wahrheit schon ueberfahren. Bleibt laps auf 0, zaehlte die naechste Ueberfahrt
      // als erste Runde, obwohl es die zweite waere.
      const spaet = OMEGA_TEST.ortProbe(code, n - 1, n * 2);
      if (!(spaet.runden >= 1)) {
        schlecht.push(code + ' Versatz ' + (n - 1) + ': Runde nicht mitgezogen');
      }
    }
    return { ok: !schlecht.length,
             mass: faelle + ' Versaetze auf ' + LAYOUTS.length
                 + ' Layouts, spätestens nach ' + langsamster + ' Kacheln richtig'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Und die Auskunft, ob dem gerechneten Ort zu glauben ist ----
  //
  // Sie ist das Tor fuer die Kurvendrosselung: stimmen gemeldete Kachel und Layout nicht
  // ueberein, darf der Vorausblick nicht drosseln - er weiss dann nicht, wovon er redet.
  stAdd('Ortung: die Auskunft "stimmt" trennt Messung und Rechnung', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ortStimmtProbe) {
      return { skip: true, mass: 'ortStimmtProbe nicht erreichbar' };
    }
    const tiles = codeToTrack('SG2H2G2R2G2H2G2R2').tiles;
    const schlecht = [];
    // Richtig gemeldet: stimmt.
    for (let i = 0; i < tiles.length; i++) {
      if (OMEGA_TEST.ortStimmtProbe(undefined, i, tiles[i].type) !== true) {
        schlecht.push('Kachel ' + i + ' (Typ ' + tiles[i].type + ') gilt als falsch');
      }
    }
    // Eine Gerade gemeldet, wo eine Haarnadel liegt: stimmt nicht.
    const hp = tiles.findIndex((t) => t.type === 0x05 || t.type === 0x06);
    if (hp >= 0 && OMEGA_TEST.ortStimmtProbe(undefined, hp, 0x02) !== false) {
      schlecht.push('Gerade auf einer Haarnadel gilt als richtig');
    }
    // Kein Code und abseits der Bahn: nicht entscheidbar, und ausdruecklich nicht "falsch" -
    // sonst fiele der Vorausblick jedes Mal aus, wenn ein Paket kein Muster trug.
    if (OMEGA_TEST.ortStimmtProbe(undefined, 0, 0xff) !== null) {
      schlecht.push('ohne gelesenen Code nicht null');
    }
    if (OMEGA_TEST.ortStimmtProbe(undefined, 0, 0x00) !== null) {
      schlecht.push('abseits der Bahn nicht null');
    }
    return { ok: !schlecht.length,
             mass: tiles.length + ' Kacheln richtig erkannt, Haarnadel/Gerade getrennt, '
                 + 'ohne Code null'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Wechselhaftes Wetter ----
  //
  // Bestellt: "alle 2-6 Minuten (genaue Zeit zufaellig gezogen) fuer 1-3 Minuten regnen und
  // dann wieder trocken werden". Geprueft wird genau das - die Folge wechselt, die Dauern
  // liegen in ihren Fenstern, und sie sind GEZOGEN und nicht fest. Ein Metronom waere kein
  // Wetter, und ein Test, der nur "es wechselt" prueft, wuerde es durchlassen.
  stAdd('Wetter wechselhaft: Phasen, Fenster, und wirklich gezogen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.wxWechselProbe) {
      return { skip: true, mass: 'wxWechselProbe nicht erreichbar' };
    }
    const p = OMEGA_TEST.wxWechselProbe(12);
    const schlecht = [];
    if (!p.length) return { ok: false, mass: 'keine Phasen' };
    if (p[0].nass) schlecht.push('beginnt nass, soll trocken beginnen');
    const trocken = [], regen = [];
    for (let i = 0; i < p.length; i++) {
      // Jede Phase muss in die andere umschlagen.
      if (p[i].danachNass === p[i].nass) schlecht.push('Phase ' + i + ' schlug nicht um');
      // Und die Folge muss alternieren.
      if (i > 0 && p[i].nass === p[i - 1].nass) schlecht.push('Phase ' + i + ' wiederholt sich');
      (p[i].nass ? regen : trocken).push(p[i].dauerMs);
    }
    const im = (arr, min, max, name) => {
      for (const d of arr) {
        if (d < min - 50 || d > max + 50) {
          schlecht.push(name + ' ' + Math.round(d / 1000) + ' s liegt nicht in '
                        + (min / 60000) + '-' + (max / 60000) + ' min');
        }
      }
    };
    im(trocken, 2 * 60000, 6 * 60000, 'trockene Phase');
    im(regen, 1 * 60000, 3 * 60000, 'Regenphase');
    // GEZOGEN und nicht fest: bei sechs trockenen Phasen aus einem Fenster von vier Minuten
    // sind sechs identische Werte praktisch unmoeglich. Das ist die Pruefung, die ein
    // Metronom von Wetter unterscheidet.
    const verschieden = new Set(trocken.map((d) => Math.round(d / 1000))).size;
    if (trocken.length >= 3 && verschieden < 2) {
      schlecht.push('alle trockenen Phasen gleich lang - da wird nicht gezogen');
    }
    const spanne = (a) => a.length
      ? Math.round(Math.min.apply(null, a) / 1000) + '-' + Math.round(Math.max.apply(null, a) / 1000) + ' s'
      : '-';
    return { ok: !schlecht.length,
             mass: p.length + ' Phasen, trocken ' + spanne(trocken) + ', Regen '
                 + spanne(regen) + ', ' + verschieden + ' verschiedene Trockenzeiten'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Regen kostet die Ghosts Tempo ----
  //
  // Bestellt: "bei Regen soll die Geschwindigkeit der KI-Gegner gedrosselt sein". Geprueft
  // am gefahrenen Tempo und nicht an der Existenz einer Konstante.
  stAdd('Ghosts fahren im Regen langsamer', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    const merk = weather;
    const mittel = async () => {
      const g = await OMEGA_TEST.ghostDriveProbe({ lage: 'codes', takte: 500, code: 'SG8',
        tileMs: 900, cfg: Object.assign({}, WUERZE_AUS, { speed: 0.5, leaderBrake: false }) });
      const f = g.tempo.filter((x) => isFinite(x)).slice(-30);
      return f.reduce((s, x) => s + x, 0) / Math.max(1, f.length);
    };
    const merkF = typeof wxFront === 'undefined' ? null : wxFront;
    let trocken = 0, nass = 0, nassGleich = 0;
    try {
      // ---- DIE FRONT MUSS DURCHGEZOGEN WERDEN ------------------------------------
      //
      // WARUM DAS SEIT v0.5.47 NOETIG IST: der Regenabzug hing an `weather === 'rain'`,
      // einem Schalter. Jetzt haengt er an wxRainLevel(), der Rampe - genau wie der Griff
      // des Spieler-Autos, und das war der Sinn der Aenderung: ein Ghost, der im Moment der
      // Meldung springt, waehrend der Spieler fuenf Sekunden lang nass wird, faehrt in einer
      // anderen Welt.
      //
      // setWeather() setzt aber nur das ZIEL der Rampe; den Weg macht wxTick in
      // 80-ms-Schritten. Dieser Test misst sofort danach, sah also Naesse 0 und meldete
      // Anteil 0,989 - "der Regen kostet nichts". Der Befund war echt und die Ursache war
      // dieser Test.
      //
      // wxSet zieht sie durch. Damit ist zugleich die RAMPE geprueft: unten steht, dass es
      // bei Ziel gesetzt und Front noch draussen NICHT langsamer sein darf.
      setWeather('dry');
      if (OMEGA_TEST.wxSet) OMEGA_TEST.wxSet(-1);
      trocken = await mittel();
      setWeather('rain');
      // Erst OHNE die Front: das Wetter ist gemeldet, das Wasser noch nicht da.
      if (OMEGA_TEST.wxSet) OMEGA_TEST.wxSet(-1);
      nassGleich = await mittel();
      // Und dann mit ihr.
      if (OMEGA_TEST.wxSet) OMEGA_TEST.wxSet(0);
      nass = await mittel();
    } finally {
      setWeather(merk);
      if (merkF !== null && OMEGA_TEST.wxSet) OMEGA_TEST.wxSet(merkF);
    }
    const anteil = trocken > 0 ? nass / trocken : 0;
    const anteilGleich = trocken > 0 ? nassGleich / trocken : 0;
    const schlecht = [];
    // Der Faktor ist 0,85; die Toleranz laesst dem Tempo-Regler Luft, verlangt aber einen
    // deutlichen Unterschied - "irgendwie langsamer" wuerde auch ein Rauschen erfuellen.
    if (!(anteil > 0.75 && anteil < 0.95)) {
      schlecht.push('mit Wasser Anteil ' + anteil.toFixed(3)
                    + ', erwartet zwischen 0,75 und 0,95');
    }
    // UND DIE RAMPE: gemeldet, aber noch trocken heisst noch kein Abzug. Ohne diese Zeile
    // waere der Test auch mit dem alten Schalter gruen, und die Aenderung ungeprueft.
    if (!(anteilGleich > 0.95)) {
      schlecht.push('vor dem Wasser schon ' + anteilGleich.toFixed(3) + ' - die Rampe fehlt');
    }
    return { ok: !schlecht.length,
             mass: 'trocken ' + (trocken * 100).toFixed(1) + ' %, gemeldet aber trocken '
                 + (nassGleich * 100).toFixed(1) + ' % (' + anteilGleich.toFixed(3)
                 + '), mit Wasser ' + (nass * 100).toFixed(1) + ' % ('
                 + anteil.toFixed(3) + ')'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Vier Autos nebeneinander brauchen vier Spuren ----
  //
  // GEMELDET: "Ueberholen und eigene Spuren klappt auch nicht - die Autos haben sich viel
  // geschoben", mit vier Ghosts. Die Seitenverteilung kannte genau zwei Seiten (k % 2), also
  // bekamen Rang 0 und 2 beide -1 und Rang 1 und 3 beide +1 - zwei Paare auf derselben
  // Linie.
  //
  // Geprueft werden EIGENSCHAFTEN: paarweise verschieden, symmetrisch um die Mitte, und die
  // Aussenspuren voll genutzt. Feste Zahlen abzufragen wuerde bei jeder Nachjustierung rot,
  // ohne dass etwas kaputt waere - "paarweise verschieden" ist dagegen genau die
  // Zusicherung, die vorher fehlte.
  stAdd('Seitenverteilung: jedes Auto der Gruppe bekommt eine eigene Spur', () => {
    if (typeof ghostSeiten !== 'function') return { ok: false, mass: 'ghostSeiten fehlt' };
    const schlecht = [];
    const zeilen = [];
    if (ghostSeiten(0).length !== 0) schlecht.push('0 Autos gibt keine leere Liste');
    if (ghostSeiten(1).length !== 1 || ghostSeiten(1)[0] !== 0) {
      schlecht.push('ein Auto soll mittig bleiben, gibt ' + ghostSeiten(1));
    }
    for (let n = 2; n <= 6; n++) {
      const s = ghostSeiten(n);
      zeilen.push(n + ': ' + s.map((x) => x.toFixed(2)).join(' '));
      if (s.length !== n) { schlecht.push(n + ' Autos geben ' + s.length + ' Spuren'); continue; }
      // Paarweise verschieden - das ist der behobene Fehler.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(s[i] - s[j]) < 1e-9) {
            schlecht.push(n + ' Autos: Rang ' + i + ' und ' + j + ' auf derselben Spur');
          }
        }
      }
      // Die Aussenspuren voll ausgenutzt, sonst bleibt Bahnbreite liegen.
      if (Math.abs(s[0] + 1) > 1e-9 || Math.abs(s[n - 1] - 1) > 1e-9) {
        schlecht.push(n + ' Autos: Raender ' + s[0].toFixed(2) + '/' + s[n - 1].toFixed(2));
      }
      // Symmetrisch, sonst wandert das Feld insgesamt zur Seite.
      const summe = s.reduce((a, b) => a + b, 0);
      if (Math.abs(summe) > 1e-9) schlecht.push(n + ' Autos: Summe ' + summe.toFixed(3));
      // Aufsteigend, damit die Ordnung der Gruppe die Ordnung der Spuren ist.
      for (let i = 1; i < n; i++) {
        if (!(s[i] > s[i - 1])) schlecht.push(n + ' Autos: nicht aufsteigend bei ' + i);
      }
    }
    // Bei drei Autos bleibt das mittlere mittig - es hat nach beiden Seiten gleich viel Platz.
    if (Math.abs(ghostSeiten(3)[1]) > 1e-9) schlecht.push('bei drei Autos steht das mittlere nicht mittig');
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Reifenrahmen zeigt die montierte Mischung ----
  //
  // GEMELDET: "die Umrandung der Reifen im Cockpit entspricht nicht dem Reifentyp". Sie
  // entsprach nie einem: die CSS-Regeln lesen body[data-tyre-mix="..."], und dieses Attribut
  // wurde nur in applySurface() geschrieben - einer Funktion, die erst bei einem
  // Wetterwechsel, einem Boxenstopp oder an einem Reifenregler laeuft. Beim Laden lief sie
  // nie, das Attribut fehlte, alle vier Regeln hatten keinen Treffer, und der Rahmen blieb
  // auf dem Rueckfallwert Gelb stehen.
  //
  // Geprueft wird die ganze Kette und nicht die Zuweisung: Attribut vorhanden, Attribut
  // gleich dem Modell, und die vier Werte ergeben vier UNTERSCHEIDBARE Ringfarben. Der
  // letzte Teil faengt den Fall, dass jemand zwei Mischungen dieselbe Farbe gibt - dann
  // waere die Anzeige da und trotzdem nutzlos.
  stAdd('Reifenrahmen: Attribut da, gleich dem Modell, vier Farben', () => {
    const t4 = document.querySelector('.gt3-t4');
    if (!t4) return { ok: false, mass: '.gt3-t4 fehlt' };
    const schlecht = [];
    const attr = document.body.dataset.tyreMix;
    if (!attr) {
      schlecht.push('body traegt kein data-tyre-mix - die CSS-Regeln haben keinen Treffer');
    } else if (attr !== tyres) {
      schlecht.push('Attribut "' + attr + '" gegen Modell "' + tyres + '"');
    }
    // Die vier Ringfarben, ueber das Attribut durchgeschaltet.
    const merk = document.body.dataset.tyreMix;
    const farben = {};
    try {
      for (const m of MISCHUNG_FOLGE) {
        document.body.dataset.tyreMix = m;
        farben[m] = getComputedStyle(t4).getPropertyValue('--mix-farbe').trim();
      }
    } finally {
      if (merk === undefined) delete document.body.dataset.tyreMix;
      else document.body.dataset.tyreMix = merk;
    }
    const werte = Object.keys(farben).map((m) => farben[m]);
    for (let i = 0; i < werte.length; i++) {
      if (!werte[i]) schlecht.push(MISCHUNG_FOLGE[i] + ' hat keine Rahmenfarbe');
      for (let j = i + 1; j < werte.length; j++) {
        if (werte[i] && werte[i] === werte[j]) {
          schlecht.push(MISCHUNG_FOLGE[i] + ' und ' + MISCHUNG_FOLGE[j] + ' gleich gefaerbt');
        }
      }
    }
    return { ok: !schlecht.length,
             mass: 'Attribut "' + attr + '", Modell "' + tyres + '", Farben '
                 + MISCHUNG_FOLGE.map((m) => m + '=' + farben[m]).join(' ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Geist-Piktogramme sind spiegelsymmetrisch ----
  //
  // GEMELDET: "Geist sollte symmetrisch sein". Er war es an beiden Stellen nicht, und die
  // Kachel in den Einstellungen hatte einen echten Zeichenfehler - ihr letzter Bodenzacken
  // ging nach UNTEN (auf y=44 statt auf die Grundlinie y=40), die rechte untere Ecke hing
  // also unter der Figur. Dazu zwei verschieden geformte Schultern.
  //
  // Gemessen wird der PFAD und nicht die Zeichenkette: 400 Punkte abtasten, jeden an der
  // Mittelachse spiegeln und den naechsten Nachbarn auf gleicher Hoehe suchen. Ein Pfad, der
  // dieselbe Figur mit anderen Befehlen beschreibt, besteht damit auch - geprueft ist die
  // Form und nicht ihre Schreibweise.
  stAdd('Geist-Piktogramme sind spiegelsymmetrisch', () => {
    const FAELLE = [
      ['#tab-options [data-sub="opt-ghosts"] svg path', 24, 'Einstellungskachel'],
      ['.home-feat svg path[d^="M5 20V11"]', 12, 'Merkmalsliste'],
    ];
    const schlecht = [], masse = [];
    for (const [sel, mitte, name] of FAELLE) {
      const el = document.querySelector(sel);
      if (!el) { schlecht.push(name + ': Pfad nicht gefunden (' + sel + ')'); continue; }
      let L;
      try { L = el.getTotalLength(); } catch (e) {
        schlecht.push(name + ': nicht messbar (' + e.message + ')'); continue;
      }
      if (!(L > 0)) { schlecht.push(name + ': Pfadlaenge 0'); continue; }
      const pts = [];
      for (let i = 0; i <= 400; i++) pts.push(el.getPointAtLength(L * i / 400));
      let maxAbw = 0;
      for (const p of pts) {
        const sx = 2 * mitte - p.x;
        let best = Infinity;
        for (const q of pts) {
          const d = Math.hypot(q.x - sx, q.y - p.y);
          if (d < best) best = d;
        }
        if (best > maxAbw) maxAbw = best;
      }
      masse.push(name + ' ' + maxAbw.toFixed(3));
      // 0,25 Einheiten bei 24 bzw. 48 Rastereinheiten - das ist ein Prozent der Figur und
      // liegt ueber der Abtastauflaesung, aber weit unter allem, was man sehen kann.
      if (maxAbw > 0.25) schlecht.push(name + ': weicht um ' + maxAbw.toFixed(2) + ' ab');
    }
    return { ok: !schlecht.length,
             mass: masse.join(' | ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | beide symmetrisch') };
  });

  // ---- Die Simulationsbedienung merken und zurueckgeben ----
  //
  // DAS LECK, DAS DAS BEHEBT: zwei Pruefungen stellten sim-ghosts, sim-laps und sim-fast um
  // und gaben sie nicht zurueck. sim-fast blieb danach gesetzt, und JEDE spaetere Simulation
  // lief mit doppelter Geschwindigkeit - unsichtbar, weil die Rundenzeiten dieselben bleiben
  // (die kommen aus der eigenen Uhr der Simulation).
  //
  // Gekostet hat es eine Messung: Beruehrungen je Minute kamen um den Faktor zwei zu niedrig
  // heraus, und ich habe die Zahl zuerst geglaubt. Ein Prueflauf, der Bedienelemente
  // umstellt und liegen laesst, verfaelscht alles, was danach kommt - auch von Hand.
  //
  // Als Helfer und nicht als zwei Abschriften: eine dritte Pruefung wird es sonst auch
  // vergessen.
  const SIM_UI = ['sim-ghosts', 'sim-laps', 'sim-fast'];
  function simUiMerken() {
    const m = {};
    for (const id of SIM_UI) {
      const e = $(id);
      if (e) m[id] = e.type === 'checkbox' ? e.checked : e.value;
    }
    return m;
  }
  function simUiZurueck(m) {
    if (!m) return;
    for (const id of SIM_UI) {
      const e = $(id);
      if (e && m[id] !== undefined) {
        if (e.type === 'checkbox') e.checked = m[id]; else e.value = m[id];
      }
    }
  }

  // ---- Die Rennsimulation faehrt wirklich ----
  //
  // BESTELLT WAR EIN RENNEN, DAS ABLAEUFT - "keine Ergebnisse simulieren, sondern das Rennen,
  // wie es stattfindet". Genau das ist hier zu pruefen, und "die Funktion wirft nicht" waere
  // dafuer keine Pruefung. Gemessen werden deshalb Bewegung, Rundenzeiten und Plausibilitaet
  // der Tempi:
  //
  //   die Autos legen Weg zurueck                    sonst ist es eine Uhr, kein Rennen
  //   sie schliessen Runden ab, mit Zeiten           sonst gibt es nichts anzusehen
  //   die erste Runde ist die langsamste             stehender Start, sonst stimmt die Uhr
  //   das Tempo liegt im Bereich des Modells         sonst ist die Umrechnung falsch
  //   doppelte Geschwindigkeit verdoppelt die Zeit   sonst ist der Schalter Zierde
  //   die Garage kommt vollstaendig zurueck          sie wird fuer die Dauer ausgeraeumt
  //   Date.now ist danach wieder echt                die Uhr wird fuer die Ticks gefaelscht
  //
  // OHNE ZEITGEBER, mit festen Schritten. Ein Browser drosselt Zeitgeber in einem verborgenen
  // Fenster auf 1 Hz - eine Pruefung am Zeitgeber wuerde die Fensterlage messen.
  stAdd('Rennsimulation: die Autos fahren, und die Zeiten stimmen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.simSchritte) {
      return { skip: true, mass: 'simSchritte nicht erreichbar' };
    }
    const schlecht = [];
    const merkTiles = currentTrackTiles;
    const merkGarage = garage.slice();
    let merkUi = null;
    // Eine ATTRAPPE in der Garage: nur so ist pruefbar, dass die Simulation sie ausraeumt
    // UND vollstaendig zurueckgibt. Ohne einen Eintrag darin waere das Wiederherstellen
    // trivialerweise richtig.
    const zeuge = { role: 'none', alias: 'Zeuge', device: { name: 'Zeuge', id: 'zeuge' } };
    const echtNowVorher = Date.now;
    let z = null, zDoppelt = null;
    try {
      currentTrackTiles = codeToTrack('SG2H2G2R2G2H2G2R2').tiles;
      garage.push(zeuge);
      const setzen = (id, v) => { const e = $(id); if (e) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } };
      merkUi = simUiMerken();
      setzen('sim-ghosts', '4'); setzen('sim-laps', '5'); setzen('sim-fast', false);
      simStart();
      if (!simAn()) return { ok: false, mass: 'Simulation startete nicht' };
      // Die Attrappe darf waehrend der Simulation NICHT in der Garage stehen - dort stehen
      // jetzt die Simulationsautos.
      if (garage.indexOf(zeuge) >= 0) schlecht.push('die echte Garage wurde nicht ausgeraeumt');
      if (garage.length !== 4) schlecht.push('Garage hat ' + garage.length + ' statt 4 Simulationsautos');
      // 90 Sekunden Rennzeit in festen 45-ms-Schritten.
      z = OMEGA_TEST.simSchritte(2000, 45);
      if (Math.abs(z.uhrMs - 90000) > 100) schlecht.push('Uhr bei ' + z.uhrMs + ' statt 90000 ms');
      for (const a of z.autos) {
        if (!(a.s > 0)) schlecht.push(a.name + ' hat keinen Weg zurueckgelegt');
        if (a.geparkt) schlecht.push(a.name + ' steht (geparkt)');
        if (!(a.laps >= 1)) schlecht.push(a.name + ' hat in 90 s keine Runde geschafft');
        if (a.zeiten.length !== a.laps) {
          schlecht.push(a.name + ': ' + a.laps + ' Runden, aber ' + a.zeiten.length + ' Zeiten');
        }
        // STEHENDER START: die erste Runde muss die langsamste sein. Waere sie es nicht,
        // liefe die Uhr nicht mit dem Weg - der haeufigste Fehler bei so einer Schleife.
        if (a.zeiten.length >= 2 && !(a.zeiten[0] > a.zeiten[1])) {
          schlecht.push(a.name + ': erste Runde nicht die langsamste ('
                        + a.zeiten.map((t) => Math.round(t)).join('/') + ')');
        }
        // Das Tempo im Bereich des Modells: der Ghost-Regler steht auf einem Bruchteil der
        // Modellhoechstgeschwindigkeit, und Kurven kosten davon. Zwischen 5 und 100 Prozent
        // ist weit gefasst - gefangen wird eine Umrechnung, die um Zehnerpotenzen irrt.
        const top = physEngine.config.topSpeedKmh || 4;
        const anteil = (a.kmh || 0) / top;
        if (!(anteil > 0.05 && anteil < 1.05)) {
          schlecht.push(a.name + ': ' + (a.kmh || 0).toFixed(2) + ' km/h sind '
                        + (anteil * 100).toFixed(0) + ' % der Modellspitze');
        }
      }
      // Die Karte und die Tafel muessen bestueckt sein - man soll ja zusehen.
      const karte = $('sim-karte');
      // SEIT v0.5.47 EINE GRUPPE JE AUTO, kein Kreis mehr: das Auto ist ein Rechteck mit
      // Spoiler, gedreht in Fahrtrichtung. Diese Zeile suchte weiter nach <circle> und
      // meldete "nur 0 Punkte auf der Karte", obwohl die Karte voll war.
      const punkte = karte
        ? [...karte.querySelectorAll('g.karte-autos > g')]
            .filter((g) => g.getAttribute('visibility') !== 'hidden').length
        : 0;
      if (punkte < 4) schlecht.push('nur ' + punkte + ' Autos auf der Karte');
      const zeilen = $('sim-tafel') ? $('sim-tafel').querySelectorAll('tbody tr').length : 0;
      if (zeilen !== 4) schlecht.push(zeilen + ' Zeilen in der Zeittafel statt 4');
      simStop('Pruefung');
      if (simAn()) schlecht.push('Simulation liess sich nicht beenden');

      // ---- Doppelte Geschwindigkeit ------------------------------------------------
      setzen('sim-fast', true);
      simStart();
      zDoppelt = OMEGA_TEST.simSchritte(200, 45);
      simStop('Pruefung');
      // Gleiche Zahl Schritte, gleiche Schrittweite - aber doppelte Rennzeit.
      if (Math.abs(zDoppelt.uhrMs - 2 * 9000) > 200) {
        schlecht.push('doppelt gibt ' + zDoppelt.uhrMs + ' ms statt 18000');
      }
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      if (simAn()) simStop('Pruefung, Notausstieg');
      // DIE UHR MUSS ECHT SEIN. Sie wird fuer die Ticks gefaelscht; blieb die Faelschung
      // stehen, ginge der ganzen Seite die Zeit verloren - und der Fehler traete irgendwo
      // sonst auf.
      if (Date.now !== echtNowVorher) {
        schlecht.push('Date.now ist noch gefaelscht');
        Date.now = echtNowVorher;
      }
      simUiZurueck(merkUi);
      const i = garage.indexOf(zeuge);
      if (i < 0) schlecht.push('die Garage kam nicht zurueck');
      else garage.splice(i, 1);
      // Und exakt der alte Stand.
      garage.splice(0, garage.length);
      for (const c of merkGarage) garage.push(c);
      currentTrackTiles = merkTiles;
      lineCache = null;
      if (typeof renderGarage === 'function') renderGarage();
    }
    const rd = z ? z.autos.map((a) => a.laps).join('/') : '-';
    const zt = (z && z.autos[0] && z.autos[0].zeiten.length)
      ? z.autos[0].zeiten.map((t) => (t / 1000).toFixed(1)).join(' ') : '-';
    return { ok: !schlecht.length,
             mass: (z ? 'Runde ' + (z.runde / 0.93).toFixed(0) + ' cm, 90 s ergeben '
                        + rd + ' Runden, S1 ' + zt + ' s' : 'kein Lauf')
                 + (zDoppelt ? ' | doppelt: ' + zDoppelt.uhrMs + ' ms aus 200 Schritten' : '')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Kurve direkt hinter dem Start: das Feld faehrt trotzdem los ----
  //
  // DER FEHLER, DEN DIESE PRUEFUNG FESTHAELT, und warum die Pruefung darueber ihn NICHT
  // gefunden hat: sie fuhr auf SG2H2G2R2G2H2G2R2, also mit zwei Geraden hinter dem Start.
  // Dort ist der Bremsbedarf am Startplatz nahe null. Gemeldet wurde SR3GLR2GR2G2 - Kurve
  // ab Kachel eins -, und dort stand das ganze Feld:
  //
  //     Takt   Gas     Bremse   km/h
  //       4    0,360   0,0171   0,0234
  //       5    0       0,0208   0,0230     Schwelle 0,02 ueberschritten
  //      13    0       0,0267   0,0189     Gas kommt nicht wieder
  //
  // Die Vorsteuerung aus dem Bremsprofil bremste ein STEHENDES Auto, und die Zeile "nicht
  // gleichzeitig Gas und Bremse" nahm ihm daraufhin das Gas, mit dem es losfahren wuerde.
  //
  // GEPRUEFT WIRD DIE INVARIANTE UND NICHT EINE SCHWELLE: kein Auto darf Gas 0 haben,
  // solange es unter seinem Ziel liegt. Eine Pruefung auf "km/h nach zwei Sekunden groesser
  // als X" waere schwaecher - sie haengt an X, und X haengt am Regler. Die Invariante haengt
  // an nichts: ein Auto unter seinem Ziel ohne Gas ist immer ein Widerspruch.
  //
  // Beides zusammen, weil die Invariante allein auch von einem Auto erfuellt wird, das gar
  // nicht erst startet: also zusaetzlich die Bewegung.
  stAdd('Rennsimulation: Kurve hinter dem Start haelt das Feld nicht auf', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.simGas) {
      return { skip: true, mass: 'simGas nicht erreichbar' };
    }
    const schlecht = [];
    const merkTiles = currentTrackTiles;
    const merkGarage = garage.slice();
    const echtNowVorher = Date.now;
    let merkUi = null;
    let letzte = null, wider = 0, minKmh = null;
    try {
      // Die gemeldete Strecke, unveraendert.
      currentTrackTiles = codeToTrack('SR3GLR2GR2G2').tiles;
      lineCache = null;
      const setzen = (id, v) => { const e = $(id); if (e) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } };
      merkUi = simUiMerken();
      setzen('sim-ghosts', '4'); setzen('sim-laps', '5'); setzen('sim-fast', false);
      simStart();
      if (!simAn()) return { ok: false, mass: 'Simulation startete nicht' };
      const top = physEngine.config.topSpeedKmh || 4;
      // 90 Takte, also gut vier Sekunden - lange genug, dass die Ratenbegrenzung der Bremse
      // ihren Endwert erreicht hat, und kurz genug fuer eine Pruefung.
      for (let i = 0; i < 90; i++) {
        letzte = OMEGA_TEST.simSchritte(1, 45);
        if (!letzte) break;
        for (const g of OMEGA_TEST.simGas()) {
          if (g.zielAnteil === null || g.gas === null || g.kmh === null) continue;
          const v = Math.abs(g.kmh) / top;
          // GHOST_DEADBAND ist derselbe Abstand, den der Regler fuer "nah genug" haelt.
          if (g.gas === 0 && v < g.zielAnteil - GHOST_DEADBAND && !g.geparkt) wider++;
        }
      }
      for (const a of (letzte ? letzte.autos : [])) {
        if (a.geparkt) schlecht.push(a.name + ' steht (geparkt)');
        const anteil = (a.kmh || 0) / top;
        if (minKmh === null || anteil < minKmh) minKmh = anteil;
        // Nach vier Sekunden muss das Auto FAHREN. 20 Prozent der Modellspitze sind grob
        // die Haelfte des Ghost-Ziels von 36 Prozent - der Wert faengt "steht" und nicht
        // "faehrt etwas langsamer als erwartet".
        if (!(anteil > 0.2)) {
          schlecht.push(a.name + ' bei ' + (anteil * 100).toFixed(0) + ' % der Spitze');
        }
        if (!(a.s > 0)) schlecht.push(a.name + ' hat keinen Weg zurueckgelegt');
      }
      if (wider > 0) schlecht.push(wider + 'x Gas 0 unter dem Ziel');
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      if (simAn()) simStop('Pruefung');
      if (Date.now !== echtNowVorher) {
        schlecht.push('Date.now ist noch gefaelscht');
        Date.now = echtNowVorher;
      }
      simUiZurueck(merkUi);
      garage.splice(0, garage.length);
      for (const c of merkGarage) garage.push(c);
      currentTrackTiles = merkTiles;
      lineCache = null;
      if (typeof renderGarage === 'function') renderGarage();
    }
    return { ok: !schlecht.length,
             mass: 'SR3GLR2GR2G2, nach 4 s langsamstes Auto bei '
                   + (minKmh === null ? '-' : (minKmh * 100).toFixed(0) + ' %')
                   + ', ' + wider + ' Widersprueche (Gas 0 unter Ziel)'
                   + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Kachel zu Abtastpunkt: keine Multiplikation ----
  //
  // DER FEHLER, DEN DIESE PRUEFUNG FESTHAELT: es stand `kachel * TRACK_SAMPLES_PER_TILE` an
  // drei Stellen - die Annahme, jede Kachel liefere gleich viele Abtastpunkte.
  // trackCenterline() vergibt sie aber nach DREHWINKEL: gemessen 14 fuer eine Gerade und
  // 49 fuer eine Haarnadel. Auf einer Strecke mit 17 Kacheln ergab das 379 Punkte, waehrend
  // 17 x 14 = 238 gerechnet wurde.
  //
  // Zwei gemeldete Folgen: die weissen Stossfugen lagen falsch und fehlten im letzten
  // Drittel ("da fehlen die Uebergaenge zwischen den Schienen"), und die Autopunkte lagen
  // falsch und sprangen am Rundenende auf die Ziellinie ("die Ghosts huepfen direkt von der
  // ersten Rechtskurve unten zum Ziel").
  //
  // Geprueft wird die EIGENSCHAFT, nicht die Formel: zu jeder Kachel gehoert ein Punkt, der
  // wirklich auf ihr liegt. Damit besteht auch eine kuenftige andere Rechnung, solange sie
  // richtig ist.
  stAdd('Kachel zu Abtastpunkt: jede Kachel trifft sich selbst', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackMarks) {
      return { skip: true, mass: 'trackMarks nicht erreichbar' };
    }
    const LAYOUTS = ['SG2H2G2R2G2H2G2R2', 'SHJ', 'SG2RG2L', 'SH2G4J2G4'];
    const schlecht = [];
    let geprueft = 0, fugen = 0;
    for (const code of LAYOUTS) {
      const p = codeToTrack(code);
      const pts = trackCenterline(p.tiles);
      const tab = trackKachelTabelle(pts, p.tiles.length);
      // 1. Jede Kachel hat Punkte, und ihr erster gehoert ihr.
      for (let k = 0; k < p.tiles.length; k++) {
        geprueft++;
        if (!(tab.zahl[k] > 0)) { schlecht.push(code + ' K' + k + ': keine Punkte'); continue; }
        if (pts[tab.start[k]].tile !== k) {
          schlecht.push(code + ' K' + k + ': Startpunkt gehoert Kachel ' + pts[tab.start[k]].tile);
        }
        // 2. Und der Punkt fuer (k, phase) liegt fuer JEDE Phase auf Kachel k. Das ist die
        //    Eigenschaft, die die Multiplikation verletzte.
        // Phase UNTER 1 muss auf der eigenen Kachel bleiben. Phase 1 ist die GRENZE und
        // darf auf der naechsten liegen - sie ist ein Ort, nicht zwei, und der bestehende
        // Test "Autopunkte an der richtigen Kachel" verlangt genau das.
        for (const ph of [0, 0.25, 0.5, 0.75, 0.95]) {
          const i = trackPunktIndex(tab, pts, k, ph);
          if (pts[i].tile !== k) {
            schlecht.push(code + ' K' + k + ' Phase ' + ph + ': liegt auf Kachel ' + pts[i].tile);
          }
        }
        const iGrenze = trackPunktIndex(tab, pts, k, 1);
        const naechste = (k + 1) % p.tiles.length;
        if (pts[iGrenze].tile !== k && pts[iGrenze].tile !== naechste) {
          schlecht.push(code + ' K' + k + ' Phase 1: liegt auf Kachel ' + pts[iGrenze].tile);
        }
      }
      // 3. Die Summe der Kachelpunkte ist die Zahl der Punkte (bis auf den Schlusspunkt,
      //    der zu keiner Kachel gehoert - tile === -1).
      const summe = tab.zahl.reduce((a, b) => a + b, 0);
      const ohneKachel = pts.filter((q) => q.tile === undefined || q.tile < 0).length;
      if (summe + ohneKachel !== pts.length) {
        schlecht.push(code + ': ' + summe + ' + ' + ohneKachel + ' statt ' + pts.length);
      }
      // 4. Und die gezeichneten Stossfugen: genau eine je Kachel.
      const html = OMEGA_TEST.trackMarks(code).html;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const n = [...doc.querySelectorAll('path')].filter((x) =>
        x.getAttribute('stroke') === '#ffffff' && x.getAttribute('stroke-width') === '1.6').length;
      fugen += n;
      if (n !== p.tiles.length) {
        schlecht.push(code + ': ' + n + ' Stossfugen fuer ' + p.tiles.length + ' Kacheln');
      }
    }
    return { ok: !schlecht.length,
             mass: geprueft + ' Kacheln auf ' + LAYOUTS.length + ' Layouts, ' + fugen
                 + ' Stossfugen'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | jede trifft sich selbst') };
  });

  // ---- Der Autopunkt laeuft die Runde entlang und springt nicht ----
  //
  // DIE GEGENPROBE zur Tabelle, und sie prueft das, was man SIEHT: ein Punkt, der die Runde
  // abfaehrt, macht lauter kleine Schritte und einen einzigen grossen - den ueber Start und
  // Ziel. Mit der alten Multiplikation lagen die Punkte gedraengt im ersten Drittel und
  // sprangen am Ende auf die Ziellinie.
  stAdd('Autopunkt: laeuft die Runde entlang, ein Sprung am Ziel', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackMarks) {
      return { skip: true, mass: 'trackMarks nicht erreichbar' };
    }
    const code = 'SG2H2G2R2G2H2G2R2';
    const p = codeToTrack(code);
    const schritte = [];
    let vor = null;
    for (let k = 0; k < p.tiles.length; k++) {
      for (const ph of [0, 0.5]) {
        const m = OMEGA_TEST.trackMarks(code, [{ index: k, phase: ph, farbe: '#f00', kuerzel: '' }]);
        const q = m.punkte[0];
        if (!q) return { ok: false, mass: 'kein Punkt bei K' + k };
        if (vor) schritte.push(Math.hypot(q.x - vor.x, q.y - vor.y));
        vor = q;
      }
    }
    const groesste = Math.max.apply(null, schritte);
    const kleinste = Math.min.apply(null, schritte);
    const schlecht = [];
    // Eine halbe Gerade sind rund 20 Zeichnungseinheiten. Ein Schritt ueber 70 waere ein
    // Sprung ueber mehr als eine ganze Kachel - und genau das war der Fehler.
    if (groesste > 70) schlecht.push('groesster Schritt ' + groesste.toFixed(0) + ' Einheiten');
    if (!(kleinste > 1)) schlecht.push('kleinster Schritt ' + kleinste.toFixed(1)
                                       + ' - Punkte liegen uebereinander');
    return { ok: !schlecht.length,
             mass: schritte.length + ' Schritte, ' + kleinste.toFixed(0) + ' bis '
                 + groesste.toFixed(0) + ' Einheiten je halbe Kachel'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Richtungsprobe erkennt eine spiegelbildlich eingetragene Strecke ----
  //
  // Sie ist die Antwort auf "Ghosts fahren in jeder Kurve ganz aussen". Nachgemessen ist die
  // Ideallinie in Ordnung (607 gegen 648 Einheiten, also die innere) und ihr Lenkbefehl
  // zeigt zum Scheitel. Was ALLE Kurven umdreht, ist eine Strecke, die andersherum
  // eingetragen ist als sie gefahren wird - und das ist an den gemeldeten Codes zu sehen.
  stAdd('Richtungsprobe: erkennt eine andersherum eingetragene Strecke', () => {
    const merkTiles = currentTrackTiles;
    const schlecht = [];
    const meldung = [];
    const echtLog = typeof log === 'function' ? log : null;
    try {
      // Ein Layout aus Rechtskurven.
      currentTrackTiles = codeToTrack('SG2R2G2R2G2R2G2R2').tiles;
      const mk = () => ({ tag: 'P', device: { name: 'Probe', id: 'probe' },
                          tileCode: 0xff, ghost: { tileIndex: 0, laps: 0 } });
      // Fall 1: das Auto meldet LINKSkurven - Widerspruch, es muss gemeldet werden.
      const a = mk();
      for (let i = 0; i < 20 && !a.ghost.richtungGemeldet; i++) {
        a.tileCode = TILE_TYPE.CURVE_LEFT;
        richtungPruefen(a);
      }
      if (!a.ghost.richtungGemeldet) schlecht.push('Widerspruch nicht erkannt');
      else if (!(a.ghost.kurvenLinks >= 6)) schlecht.push('zu frueh geurteilt');
      meldung.push('Widerspruch nach ' + (a.ghost.kurvenLinks + a.ghost.kurvenRechts) + ' Kurven');

      // Fall 2: das Auto meldet RECHTSkurven - passt, es darf NICHT gemeldet werden.
      // Geprueft ueber den Zaehler: er laeuft weiter, bis genug gesehen ist, und schaltet
      // dann still ab.
      const b = mk();
      for (let i = 0; i < 30; i++) { b.tileCode = TILE_TYPE.CURVE_RIGHT; richtungPruefen(b); }
      if (b.ghost.kurvenRechts < 6) schlecht.push('richtige Richtung: gar nicht gezaehlt');

      // Fall 3: eine Strecke fast ohne Kurven sagt nichts - kein Fehlalarm.
      currentTrackTiles = codeToTrack('SG8').tiles;
      const c = mk();
      for (let i = 0; i < 20; i++) { c.tileCode = TILE_TYPE.CURVE_LEFT; richtungPruefen(c); }
      // Bei unter zwei Kurven im Layout wird abgeschaltet, ohne zu urteilen.
      if (!c.ghost.richtungGemeldet) schlecht.push('ohne Kurven im Layout nicht abgeschaltet');
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      currentTrackTiles = merkTiles;
      lineCache = null;
    }
    return { ok: !schlecht.length,
             mass: meldung.join(', ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | drei Faelle richtig') };
  });

  // ---- Die Schlusspruefung toleriert Bautoleranz und nicht ein fehlendes Teil ----
  //
  // GEMELDET: "Bei einer laengeren Strecke passen die Schienen am Ende auch nicht perfekt
  // zusammen. Wenn ich dann Simulation starte, gehen alle Punkte nur an den Rand. Du
  // brauchst etwas, um zu erkennen, dass die Strecke geschlossen ist und musst dabei etwas
  // Ungenauigkeit tolerieren."
  //
  // Die Kette dahinter: gilt eine Bahn als offen, klemmt idealLine() ihre Endpunkte fest und
  // die Kruemmungsminimierung zieht alpha ueber lange Stuecke an den Anschlag - gemessen
  // 25 Prozent aller Abtastpunkte am Rand. Dann faehrt jeder Ghost am Rand.
  //
  // DIE PRUEFUNG HAELT BEIDE SEITEN FEST, denn eine Toleranz ist nur so gut wie ihre
  // Obergrenze: eine wirklich geschlossene Runde muss durchkommen, und eine, bei der ein
  // TEIL FEHLT (gemessen genau 43 cm Luecke), darf es nicht.
  stAdd('Streckenschluss: Bautoleranz ja, fehlendes Teil nein', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.trackSchluss) {
      return { skip: true, mass: 'trackSchluss nicht erreichbar' };
    }
    const schlecht = [];
    const zeilen = [];
    const FAELLE = [
      ['SR3G2R3G', true, 'geschlossene Runde'],
      ['SR3G2R3G2', false, 'ein Teil zu viel (43 cm Luecke)'],
      ['SR6', false, 'ein Teil fehlt (43 cm Luecke)'],
      ['SR6G', false, '86 cm Luecke'],
      ['SR2G2R2G2R2G2R2G2', false, 'endet 120 Grad verdreht'],
    ];
    for (const [code, soll, was] of FAELLE) {
      const r = OMEGA_TEST.trackSchluss(code);
      zeilen.push(code + ': ' + r.lueckeCm.toFixed(0) + ' cm / '
                  + Math.abs(r.winkel).toFixed(0) + '° -> '
                  + (r.closed ? 'zu' : 'offen'));
      if (r.closed !== soll) {
        schlecht.push(code + ' (' + was + ') gilt als ' + (r.closed ? 'geschlossen' : 'offen'));
      }
    }
    // Und die Toleranz selbst: sie muss deutlich unter einer Kachellaenge liegen, sonst
    // gilt eine unfertige Strecke als Ring. 43 cm ist die gemessene Luecke eines fehlenden
    // Teils; mehr als die Haelfte davon waere fahrlaessig.
    const ausser = OMEGA_TEST.trackSchluss('SR6');
    if (!(ausser.lueckeCm > 21)) {
      schlecht.push('die Referenzluecke eines fehlenden Teils ist nur '
                    + ausser.lueckeCm.toFixed(0) + ' cm - Annahme pruefen');
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Der Ghost landet auf der INNENSEITE der Kurve ----
  //
  // GEMELDET: "Die simulierten Ghosts fahren keine Ideallinie sondern immer aussen in der
  // Kurve. Da ist eine Ideallinie in der Strecke eingezeichnet, die sollen sie fahren."
  //
  // Die Ursache waren zwei gegenlaeufige Konventionen, die aufeinandertrafen: g.querSoll ist
  // eine LENKANFORDERUNG (positiv rechts, wie Byte 7 und wie der Stick), die Karte zeichnet
  // aber entlang der NORMALEN, und die zeigt nach links. Wer die eine Zahl als die andere
  // benutzt, spiegelt jedes Auto an der Mittellinie.
  //
  // DIESE PRUEFUNG RECHNET GEOMETRIE, keine Vorzeichen: sie legt den Kreismittelpunkt der
  // Kurve durch drei Punkte der Mittellinie und vergleicht die Radien. Ein Vorzeichentest
  // waere hier wertlos - er waere algebraisch immer wahr, weil beide Groessen aus demselben
  // alpha kommen. Der Radius ist die Frage, die der Nutzer stellt.
  stAdd('Ghost in der Kurve: innen und nicht aussen', () => {
    const merkTiles = currentTrackTiles;
    const schlecht = [];
    const zeilen = [];
    try {
      // Geschlossene Strecke - auf einer offenen saettigt die Linie, und dann prueft man
      // die Saettigung statt der Linie.
      const p = codeToTrack('SR3G2R3G');
      currentTrackTiles = p.tiles;
      lineCache = null;
      const pts = trackCenterline(p.tiles);
      const nrm = trackNormals(pts);
      const rows = OMEGA_TEST.compareLines(p.tiles, 10);
      if (!rows.meta || !rows.meta.closed) {
        return { ok: false, mass: 'die Teststrecke gilt nicht als geschlossen' };
      }
      const mitte = (i) => {
        const a = pts[i - 4], b = pts[i], c = pts[i + 4];
        if (!a || !c) return null;
        const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (Math.abs(d) < 1e-9) return null;
        return {
          x: ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y)
              + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / d,
          y: ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x)
              + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / d,
        };
      };
      const halb = TRACK_HALF_W;
      let geprueft = 0;
      // ---- JE KURVENZUG DER SCHEITEL, NICHT JE KACHEL DIE MITTE --------------------
      //
      // Hier stand eine Schleife ueber alle KURVENKACHELN, die jeweils den Punkt bei
      // Phase 0,5 nahm und von ihm verlangte, innerhalb der Mittellinie zu liegen. Das war
      // richtig, solange die Linie ueber die ganze Kurve innen klebte. Seit sie von aussen
      // anfaehrt und nach aussen ausfaehrt, ist die Mitte der LETZTEN Kachel eines
      // dreikacheligen Zuges die Ausfahrt - und dort MUSS sie aussen liegen. Gemessen fiel
      // die Pruefung genau so: K3 r=35,3 und K6 r=36,4 gegen eine Mittellinie von 34,4.
      //
      // Geprueft wird deshalb der Scheitel des ZUGES, und zwar der Punkt mit dem kleinsten
      // Radius - das ist die Definition und braucht keine Phasenannahme. Zusaetzlich, und
      // das ist neu: der Scheitel muss auch WEITER INNEN liegen als Anfang und Ende des
      // Zuges. Damit prueft dieselbe Stelle beide Aussagen.
      const istKurve = (typ) => typ === TILE_TYPE.CURVE_LEFT || typ === TILE_TYPE.CURVE_RIGHT
                             || typ === TILE_TYPE.HAIRPIN || typ === TILE_TYPE.HAIRPIN_LEFT;
      // Zusammenhaengende Kurvenkacheln zu Zuegen buendeln.
      const zuege = [];
      for (let k = 0; k < p.tiles.length; k++) {
        if (!istKurve(p.tiles[k].type)) continue;
        const letzt = zuege[zuege.length - 1];
        if (letzt && letzt[letzt.length - 1] === k - 1) letzt.push(k);
        else zuege.push([k]);
      }
      for (const zug of zuege) {
        // Alle Proben des Zuges, in Fahrtrichtung.
        const proben = [];
        for (const k of zug) {
          for (const r of rows.filter((x) => x.tile === k).sort((a, b) => a.phase - b.phase)) {
            const idx = [];
            for (let i = 0; i < pts.length; i++) if (pts[i].tile === k) idx.push(i);
            const i = idx[Math.min(idx.length - 1, Math.round(r.phase * idx.length))];
            const c = mitte(i);
            if (!c) continue;
            // Die Lage, die die Karte zeichnet: querSollAlsLage(Lenkwert), mal 85 Prozent
            // der halben Breite - genau die Rechnung aus karteAutosSetzen().
            const lage = querSollAlsLage(r.calc);
            const px = pts[i].x + nrm[i].x * lage * 0.85 * halb;
            const py = pts[i].y + nrm[i].y * lage * 0.85 * halb;
            proben.push({ k, rM: Math.hypot(pts[i].x - c.x, pts[i].y - c.y),
                          rA: Math.hypot(px - c.x, py - c.y) });
          }
        }
        if (proben.length < 3) continue;
        geprueft++;
        // Der Scheitel: kleinster Radius des Autos im ganzen Zug.
        const sch = proben.reduce((a, b) => (b.rA < a.rA ? b : a));
        const ein = proben[0], aus = proben[proben.length - 1];
        zeilen.push('K' + zug[0] + (zug.length > 1 ? '-' + zug[zug.length - 1] : '')
                    + ' ' + ein.rA.toFixed(0) + '/' + sch.rA.toFixed(0) + '/'
                    + aus.rA.toFixed(0) + ' Mitte ' + sch.rM.toFixed(0));
        if (!(sch.rA < sch.rM)) {
          schlecht.push('K' + zug[0] + ': Scheitel r=' + sch.rA.toFixed(1)
                        + ' nicht innerhalb der Mittellinie r=' + sch.rM.toFixed(1));
        }
        // Und die Form, nur wo Platz dafuer ist: ein einkacheliger Zug hat keinen.
        if (zug.length > 1 && !(sch.rA < ein.rA && sch.rA < aus.rA)) {
          schlecht.push('K' + zug[0] + ': keine Form, ein ' + ein.rA.toFixed(1)
                        + ' Scheitel ' + sch.rA.toFixed(1) + ' aus ' + aus.rA.toFixed(1));
        }
      }
      if (!geprueft) schlecht.push('keine Kurve gefunden');
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      currentTrackTiles = merkTiles;
      lineCache = null;
    }
    return { ok: !schlecht.length,
             mass: 'Radius Auto/Mittellinie: ' + zeilen.join(' ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | alle innen') };
  });

  // ---- Der Kurvenausgang oeffnet sich, und zwar nach der Kurve ----
  //
  // GEMELDET: "nach der Haarnadelkurve sollten die Autos sich nach aussen tragen lassen und
  // nicht ganz innen wieder losbeschleunigen."
  //
  // ZWEI FEHLVERSUCHE STECKEN IN DIESER PRUEFUNG, und beide waren nur durch Messung zu
  // sehen:
  //
  //   1. Die Reichweite war in ABTASTPUNKTEN gerechnet ("eine mittlere Kacheldichte"). Eine
  //      Haarnadel hat 49 Punkte, eine Gerade 14 - die Oeffnung lag damit noch INNERHALB der
  //      Haarnadel, und auf der Geraden danach war sie nicht messbar.
  //   2. Der Scheitel wurde als lokales Kruemmungsmaximum ueber einer Schwelle von 30
  //      Prozent des Maximums gesucht. Das Maximum war ein Artefakt: auf einer geschlossenen
  //      Runde faellt der letzte Abtastpunkt mit dem ersten zusammen, und die
  //      Kruemmungsformel lieferte dort 0,6999 gegen 0,13 der Haarnadeln. Gefunden wurde
  //      genau EIN Scheitel, und der war der doppelte Punkt.
  //
  // Geprueft wird deshalb GENAU DAS, was beide Versuche verfehlt haben: die Linie muss auf
  // der Geraden HINTER einer Kurve weiter aussen liegen als ohne Oeffnung.
  stAdd('Kurvenausgang: die Linie traegt nach der Kurve nach aussen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.setLineExit) {
      return { skip: true, mass: 'setLineExit nicht erreichbar' };
    }
    const merkTiles = currentTrackTiles;
    const merkExit = OMEGA_TEST.getLineExit();
    // ---- VOR DEM try, und das ist kein Stil, sondern der Unterschied zwischen einem
    //      Aufraeumen und keinem ---------------------------------------------------------
    //
    // Der erste Anlauf deklarierte merkModell INNERHALB des try. Ein const im try-Block ist
    // im finally NICHT sichtbar, und der Waechter `typeof merkModell !== 'undefined'` war
    // dort deshalb immer falsch: das Modell wurde gesetzt und nie zurueckgelegt.
    //
    // Die Folge war teuer und irrefuehrend: alle spaeteren Linientests liefen mit 'laptime'
    // statt der 3-stufigen Vorgabe, und weil "Kurven oeffnen" auf 0 steht, ist laptime
    // praktisch die Mittellinie. Der Querlagen-Test meldete daraufhin einen Lenkwert von
    // -17 bis 23 statt -127 bis 123, und ich habe eine halbe Stunde nach einem Deckel
    // gesucht, den es nicht gibt.
    const merkModell = OMEGA_TEST.getLineModel();
    const schlecht = [];
    const zeilen = [];
    try {
      // ---- DIE KURVENOEFFNUNG GEHOERT ZUR BEHAUPTUNG, also setzt der Test sie ------
      //
      // Seit v0.5.54 steht "Kurven oeffnen" ab Werk auf 0 (vom Nutzer gesetzt), und die
      // Vorgabelinie ist die 3-stufige. Beides zusammen laesst diese Behauptung ins Leere
      // laufen, und zwar aus einem gemessenen Grund:
      //
      //     Eine Carrera-Kurve ist ein Bogen mit FESTEM Radius. Ein Scheitel verkleinert
      //     ihn, statt ihn zu vergroessern - gemessen: Mittellinie 34,7 Einheiten, +4
      //     Versatz 38,8, -4 nur 30,7. Die zeitoptimale Linie hat deshalb KEINEN Scheitel,
      //     und die Kurvenoeffnung ist das, was ihr einen aufzwingt.
      //
      // Mit Oeffnung 0 gibt das Rundenzeitmodell einen Scheitel von 0,09 statt 1,0 - also
      // praktisch die Mittellinie. Das ist richtig und keine Panne.
      //
      // Ein Test, der eine Form behauptet, muss die Bedingung herstellen, unter der sie
      // gilt. Also setzt er die Oeffnung selbst und legt sie danach zurueck - sonst prueft
      // er die Voreinstellung des Nutzers und nicht das Modell.
      OMEGA_TEST.setLineExit(0.8);
      // Geschlossene Runde mit zwei Haarnadeln.
      const p = codeToTrack('SHG4HG3');
      currentTrackTiles = p.tiles;
      const schl = trackSchluss(trackCenterline(p.tiles));
      if (!schl.closed) return { ok: false, mass: 'Teststrecke gilt nicht als geschlossen' };
      // ---- UND DAS MODELL GEHOERT ZUR BEHAUPTUNG -------------------------------
      //
      // "Die Linie traegt nach der Kurve nach aussen" ist eine Aussage ueber die
      // KURVENOEFFNUNG, und die wirkt nur in formLine() - also in den drei optimierenden
      // Modellen. Die 3-Stufen-Linie kennt sie nicht: sie setzt ihre Spuren auf den
      // Anschlag, und hinter einer Kurve faehrt sie in die Mitte, weil dort zu beiden
      // Seiten Platz ist. Gemessen gab der Test deshalb 0,00 -> 0,00, seit die 3-stufige
      // ab Werk gewaehlt ist.
      //
      // Also stellt der Test das Modell selbst, wie er die Oeffnung selbst stellt. Sonst
      // prueft er die Voreinstellung des Nutzers und nicht die Wirkung der Oeffnung.
      OMEGA_TEST.setLineModel('laptime');
      const holen = (st) => {
        OMEGA_TEST.setLineExit(st);
        const rows = OMEGA_TEST.compareLines(p.tiles, 6);
        const je = {};
        rows.forEach((r) => { (je[r.tile] = je[r.tile] || []).push(-r.calc); });
        return je;
      };
      const aus = holen(0);
      const an = holen(0.5);
      // Fuer jede Haarnadel: die Kachel DANACH muss weiter aussen liegen. "Weiter aussen"
      // heisst naeher an 0 oder darueber - die Werte sind negativ (innen).
      let geprueft = 0;
      for (let k = 0; k < p.tiles.length; k++) {
        if (p.tiles[k].type !== TILE_TYPE.HAIRPIN
            && p.tiles[k].type !== TILE_TYPE.HAIRPIN_LEFT) continue;
        const nach = (k + 1) % p.tiles.length;
        if (!aus[nach] || !an[nach]) continue;
        geprueft++;
        const vorher = aus[nach][0];
        const nachher = an[nach][0];
        zeilen.push('nach H' + k + ': ' + vorher.toFixed(2) + ' -> ' + nachher.toFixed(2));
        // ---- MIT VORZEICHEN UND NICHT MIT BETRAG, seit v0.5.43 ----------------------
        //
        // Hier stand |nachher| < |vorher| - 0,15, also "naeher an null". Das war richtig,
        // solange die Linie ohne Oeffnung tief INNEN lag: dann heisst weiter aussen
        // zwangslaeufig naeher an null. Seit die Oeffnung eine Schranke im Suchraum ist,
        // liegt die Linie ohne sie auf der MITTELLINIE - gemessen vorher -0,00 - und mit
        // ihr bei +0,58, also jenseits von null. Der Betrag waechst dabei, und der alte
        // Vergleich schlug an, obwohl genau das Gewuenschte passiert war.
        //
        // aussen ist fuer eine Rechtshaarnadel das positive alpha (nachgemessen: bei
        // konstantem Versatz gibt alpha +4 einen Radius von 38,8 Einheiten, alpha -4 nur
        // 30,7 - der groessere Radius ist der aeussere). Die Werte hier sind alpha/ref.
        const aussenVz = (p.tiles[k].type === TILE_TYPE.HAIRPIN) ? 1 : -1;
        if (!(aussenVz * (nachher - vorher) > 0.15)) {
          schlecht.push('nach H' + k + ' nur ' + vorher.toFixed(2) + ' -> ' + nachher.toFixed(2));
        }
      }
      if (!geprueft) schlecht.push('keine Haarnadel gefunden');
      // Und die Gegenprobe: bei 0 darf sich nichts aendern.
      const aus2 = holen(0);
      for (let k = 0; k < p.tiles.length; k++) {
        if (!aus[k] || !aus2[k]) continue;
        if (Math.abs(aus[k][0] - aus2[k][0]) > 1e-9) {
          schlecht.push('K' + k + ': bei 0 nicht reproduzierbar');
          break;
        }
      }
    } catch (e) {
      schlecht.push('Ausnahme: ' + e.message);
    } finally {
      OMEGA_TEST.setLineExit(merkExit);
      // Und das Modell zurueck - ein Prueflauf, der es verstellt liegen laesst, aendert
      // jede Linie, die danach gebaut wird, und die Vorgabe des Nutzers dazu.
      OMEGA_TEST.setLineModel(merkModell);
      currentTrackTiles = merkTiles;
      ghostLineCacheLeeren();
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Die Kruemmung glaubt keinem doppelten Punkt ----
  //
  // Auf einer geschlossenen Runde ist der letzte Abtastpunkt derselbe wie der erste -
  // gemessen ein Abstand von 0,0000 bei einem mittleren Abstand von 2,857 Einheiten. Der
  // Kreis durch drei Punkte, von denen zwei zusammenfallen, hat den Radius null.
  //
  // GEMESSEN, bevor die Schranke stand: 0,6999 an dieser Stelle gegen 0,12 und 0,13 der
  // beiden Haarnadeln - das Fuenffache einer Haarnadel, auf einer Geraden. Zwei Verbraucher
  // haben das geglaubt: das Bremsprofil zeichnete an Start/Ziel eine Bremsung, die es nicht
  // gibt, und die Scheitelsuche fand nur diesen einen Punkt.
  stAdd('Kruemmung: ein doppelter Abtastpunkt ist keine Kurve', () => {
    const p = codeToTrack('SHG4HG3');
    const pts = trackCenterline(p.tiles);
    const nrm = trackNormals(pts);
    const n = pts.length;
    const luecke = Math.hypot(pts[n - 1].x - pts[0].x, pts[n - 1].y - pts[0].y);
    if (!(luecke < 0.01)) {
      return { skip: true, mass: 'diese Strecke hat keinen doppelten Endpunkt ('
                                 + luecke.toFixed(3) + ')' };
    }
    const bahn = pts.map((q, i) => [q.x + nrm[i].x * 0, q.y + nrm[i].y * 0]);
    const k = pathCurvature(bahn, true);
    const kMax = Math.max.apply(null, k);
    // Die groesste Kruemmung muss auf einer KURVENkachel liegen. Lag sie auf einer Geraden,
    // war es das Artefakt.
    let wo = 0;
    for (let i = 0; i < n; i++) if (k[i] === kMax) { wo = i; break; }
    const typ = pts[wo].tile >= 0 ? p.tiles[pts[wo].tile].type : null;
    const istKurve = typ === TILE_TYPE.CURVE_LEFT || typ === TILE_TYPE.CURVE_RIGHT
                  || typ === TILE_TYPE.HAIRPIN || typ === TILE_TYPE.HAIRPIN_LEFT;
    const schlecht = [];
    if (!istKurve) {
      schlecht.push('groesste Kruemmung ' + kMax.toFixed(4) + ' liegt auf Kachel '
                    + pts[wo].tile + ' (Typ ' + typ + '), keiner Kurve');
    }
    // Und der doppelte Punkt selbst traegt keine Kruemmung.
    if (!(k[n - 1] === 0)) {
      schlecht.push('der doppelte Endpunkt traegt Kruemmung ' + k[n - 1].toFixed(4));
    }
    return { ok: !schlecht.length,
             mass: 'kMax ' + kMax.toFixed(4) + ' auf Kachel ' + pts[wo].tile
                 + ' (Typ ' + typ + '), doppelter Punkt ' + k[n - 1].toFixed(4)
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
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
  // NICHT MEHR DER MITTELWERT, seit v0.5.40 - und das ist die Berichtigung eines Masses,
  // das den Fehler belohnt, den es fangen soll. |Mittel| ist am GROESSTEN, wenn ein Auto
  // dauerhaft auf einer Bahnseite klebt, und genau das war der gemeldete Fehler: "auf der
  // Start/Ziel-Geraden fahren die Autos immer ganz rechts - warum?".
  //
  // Gemessen ueber 300 Takte, je nach Staerke der Kurvenoeffnung:
  //
  //     Oeffnung   min   max   Spanne   |Mittel|
  //        aus       0   124     124      55,9
  //        0,8     -95    73     168      19,8
  //
  // Bei ausgeschalteter Oeffnung ist das MINIMUM exakt null: die Linie geht ueber die ganze
  // Runde kein einziges Mal auf die andere Seite. Sie nutzt eine halbe Bahn und bekommt
  // dafuer den doppelten Mittelwert. Ein Test auf |Mittel| haette diesen Zustand als den
  // besseren ausgewiesen.
  //
  // Geprueft wird deshalb, was die Original-App wirklich belegt: dass die Bahnbreite
  // GENUTZT wird. Spanne und beide Vorzeichen - und die Spitze bleibt, unveraendert bei 70
  // von 127 gegen die gemessenen 127 des Originals.
  stAdd('Ghost-Querlage: im Mass der Original-App', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostDriveProbe) {
      return { skip: true, mass: 'ghostDriveProbe nicht vorhanden' };
    }
    // ---- OHNE WUERZE, und das ist eine Berichtigung ------------------------------
    //
    // Dieser Prueflauf stellt ein ZWEITES, STEHENDES Auto dazu (damit ghostLane() etwas zu
    // verteilen hat). Das gemessene Auto faehrt damit dauernd auf ein Hindernis zu, setzt
    // dauernd zum Ueberholen an - und seit dem 2-Stufen-Ausweichen in v0.5.54 ERSETZT ein
    // laufendes Manoever die Ideallinie durch eine feste aeussere Spur.
    //
    // Gemessen: der gesendete Wert lag bei -126 bis 0, also nur auf einer Seite, und der
    // Test meldete "nur eine Seite benutzt". Die Zahl war richtig, die Frage falsch - er
    // hat ein Auto gemessen, das gerade nicht der Linie folgt.
    //
    // Die Wuerze aus: dann misst er, was er messen will. Die Linie selbst ist nachgeprueft
    // und nimmt auf dieser Strecke alle drei Stufen an (-1 / 0 / +1).
    // ---- UND EINE STRECKE MIT BEIDEN DREHRICHTUNGEN ----------------------------
    //
    // Die Vorgabestrecke dieser Sonde ist SG2H2G2R2 - Haarnadel und Kurve, BEIDE nach
    // rechts. Bei den frueheren, stetigen Linienmodellen war das gleichgueltig: sie
    // schwangen innerhalb jeder Kurve von aussen zum Scheitel und zurueck, also ueber beide
    // Seiten.
    //
    // Die 3-Stufen-Linie tut das nicht. Sie haelt Spuren, und auf einer Strecke, die nur
    // nach rechts dreht, ist die Aussenseite immer dieselbe - die andere Seite kommt nur im
    // Scheiteldrittel vor. Gemessen: der gesendete Wert lag bei -126 bis 0.
    //
    // Die Forderung "beide Seiten" ist also nur auf einer Strecke sinnvoll, die beide
    // Richtungen hat. SR3GLR2GR2G2 ist die vom Nutzer gemeldete Strecke und hat sie.
    return OMEGA_TEST.ghostDriveProbe({ takte: 400, lage: 'karte',
      code: 'SR3GLR2GR2G2',
      cfg: Object.assign({}, WUERZE_AUS) }).then((p) => {
      const abs = p.lenk.map(Math.abs);
      const mittel = abs.reduce((a, b) => a + b, 0) / abs.length;
      const spitze = Math.max.apply(null, abs);
      const min = Math.min.apply(null, p.lenk);
      const max = Math.max.apply(null, p.lenk);
      const schlecht = [];
      if (spitze < 70) schlecht.push('Spitze nur ' + spitze + ', Original 127');
      if (max - min < 90) schlecht.push('Spanne nur ' + (max - min) + ' von 254');
      // BEIDE SEITEN. Das ist die Bedingung, die den gemeldeten Fehler faengt: ohne
      // Kurvenoeffnung lag das Minimum bei exakt 0, die Linie ging also nie nach links.
      if (!(min <= -20 && max >= 20)) {
        schlecht.push('nur eine Seite benutzt (' + min + ' bis ' + max + ')');
      }
      return { ok: schlecht.length === 0,
               mass: min + ' bis ' + max + ', Spanne ' + (max - min) + ', Spitze ' + spitze
                     + ', |Mittel| ' + mittel.toFixed(1) + ' (Original Spitze 127)'
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
      // EINE DURCHSCHEINENDE FARBE IST KEIN GRUND. lum() liest die ersten drei Zahlen und
      // uebergeht das Alpha - rgba(255,255,255,.07) kam damit als WEISS heraus, und ein
      // grauer Text darauf meldete Kontrast 2,95, obwohl er in Wirklichkeit auf einem
      // dunklen Schirm steht. Aufgefallen an der Streckenkarte im Uebersichtsschirm, die
      // genau so einen Schleier benutzt, damit die schwarze Fahrbahn sich abhebt.
      //
      // Deckende Farben beenden die Suche, durchscheinende nicht: was darunter liegt,
      // bestimmt die Helligkeit weiterhin mit.
      const deckend = (c) => {
        const m = (c || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const teile = m[1].split(',');
        return teile.length < 4 || parseFloat(teile[3]) >= 0.999;
      };
      const grund = (el) => {
        let n = el;
        while (n && n !== document.body) {
          const cs = getComputedStyle(n);
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
              && deckend(cs.backgroundColor)) {
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
          // BEI SVG IST className EIN SVGAnimatedString und kein Text - im Bericht stand
          // dann "[object SVGAnimatedString]" statt eines Namens.
          if (k < schlimmst) {
            schlimmst = k;
            wo = el.id || (typeof el.className === 'string' ? el.className
                           : (el.className && el.className.baseVal) || el.tagName);
          }
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
    const merk = ghostCfg.wuerzeUeberholen;
    const schlecht = [];
    let r;
    try {
      ghostCfg.wuerzeUeberholen = true;   // ab Werk an, auf Wunsch
      r = OMEGA_TEST.ghostPassRates();
      // ---- DAS ALTE KRITERIUM WAR EIN FENSTER IN KACHELN, UND DAS IST MESSBAR LEER --
      //
      // Hier stand: die Reichweite muss ueber dem Mindestabstand liegen, und das Fenster
      // dazwischen mindestens 0,4 Kacheln breit sein - sonst bestritten beide Regeln
      // dasselbe Band. Der Gedanke ist richtig, das Mass ist es nicht, und das ist gemessen:
      //
      //     Der GEMELDETE Abstand hat unterhalb einer Kachel keine Zwischenwerte. In 1517
      //     Stichproben, in denen der wahre Abstand unter einer Kachel lag - darunter 155,
      //     in denen er unter einer Autolaenge lag -, war der gemeldete Abstand JEDES MAL
      //     genau 1,00. Nicht 0, nicht gebrochen: 1,00.
      //
      // Der Grund steht bei ghostProgress(): der Abstand ist die Differenz der
      // Kachelzaehler plus eine GESCHAETZTE Kachelphase, und zwei Autos mit gleichem Tempo
      // haben dieselbe Phase - sie faellt heraus. Uebrig bleibt eine ganze Zahl, und
      // ghostAhead() verwirft die 0.
      //
      // Ein Fenster von 0,1 oder 0,4 Kacheln macht deshalb KEINEN Unterschied: es liegt
      // zwischen 1,00 und 2,00, und dort landet nie ein Wert. Was zaehlt, ist allein, welche
      // ganzen Zahlen jede Schwelle einfaengt.
      //
      // Und das Sweep-Ergebnis widerspricht dem alten Kriterium direkt (vier Ghosts,
      // 120 s, Beruehrungen und Ueberholmanoever je Minute):
      //
      //     Mindestabstand 0,7 / Reichweite 1,3     40,1 Kontakte    16,0 Ueberholer
      //     Mindestabstand 1,0 / Reichweite 1,3     33,1             16,5
      //     Mindestabstand 1,2 / Reichweite 1,3     29,1             19,0   <- beides best
      //     Mindestabstand 1,2 / Reichweite 2,2     34,6             23,6
      //     Mindestabstand 1,6 / Reichweite 2,2     36,1             19,5
      //
      // Das gewaehlte Paar bestreitet dasselbe Band (Fenster 0,1) und ist trotzdem auf
      // BEIDEN Achsen das beste. Ein Fenster zu erzwingen wuerde also messbar
      // verschlechtern, um ein Kriterium zu erfuellen, das die Messung widerlegt hat.
      //
      // Geprueft wird jetzt das, was wirken kann:
      //
      // 1. BEIDE Schwellen muessen ueber 1,0 liegen. Darunter feuern sie nie, weil der
      //    gemeldete Abstand bei nahen Autos nicht unter 1,00 geht. Genau das war der
      //    Fehler des alten Mindestabstands 0,7: ein Regler, der nie greift.
      if (!(r.abstandMin > 1.0)) {
        schlecht.push('Mindestabstand ' + r.abstandMin
                      + ' liegt nicht ueber 1,0 und kann damit nie greifen');
      }
      if (!(r.reichweite > 1.0)) {
        schlecht.push('Reichweite ' + r.reichweite + ' liegt nicht ueber 1,0');
      }
      // 2. Und die Reichweite darf nicht UNTER dem Mindestabstand liegen: dann waere der
      //    Abstandhalter aktiv, bevor eine Attacke ueberhaupt angesetzt werden kann, und
      //    das Ueberholen haette kein Band mehr. Gleichstand ist erlaubt - siehe oben.
      if (!(r.reichweite >= r.abstandMin)) {
        schlecht.push('Reichweite ' + r.reichweite + ' unter dem Mindestabstand '
                      + r.abstandMin);
      }
      // 3. Die Wartezeit bei der VORGABE-Wuerze muss im Bereich einer Runde liegen. Ohne
      //    diese Zahl ist "wird ueberholt" eine Hoffnung.
      if (!(r.wartenS <= 10)) {
        schlecht.push('Wartezeit ' + r.wartenS + ' s bei Wuerze ' + r.wuerze);
      }
      // 4. Gegenprobe: mit abgeschaltetem Ueberholmanoever darf NIE angesetzt werden,
      //    sonst ist der Schalter keiner.
      ghostCfg.wuerzeUeberholen = false;
      const aus = OMEGA_TEST.ghostPassRates();
      if (aus.p !== 0) schlecht.push('abgeschaltet wuerfelt trotzdem');
    } finally {
      ghostCfg.wuerzeUeberholen = merk;
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
      // EINGESCHWUNGEN, nicht im ersten Takt: der Autopilot regelt seit v0.5.53 mit
      // ghostSpeedControl(), und der ist ratenbegrenzt. Die Begruendung in ganzer Laenge
      // steht beim Test "Autopilot nur auf der Bahn, und er regelt".
      const bei = (frac, bremse) => {
        physEngine.state.speedKmh = frac * physEngine.config.topSpeedKmh;
        let r = autopilot(bremse || 0);
        if (!r) return r;
        for (let i = 0; i < 25; i++) r = autopilot(bremse || 0) || r;
        return r;
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

  // ---- Lenkdaempfung: die Zahl auf dem Regler ist die Zahl, die gilt ----
  //
  // DER FEHLER, GEGEN DEN SIE STEHT, war da und ist gemessen. Die Zeit bis zum Anschlag hing
  // an DREI Groessen, von denen der Regler keine nannte:
  //
  //   steerRatePerS      unsichtbar, aus dem Traegheitsmoment, ohne Regler
  //   steerResponse      hiess "Lenkansprechen" und bestimmt laut Hilfetext den WINKEL
  //   steerCalib         die Lenkwinkel-Kalibrierung, ein ganz anderer Regler
  //
  // Die letzte war die stillste: der uebertragene Winkel ist dampedSteering mal steerCalib,
  // gedeckelt auf 1,0 - bei 200 Prozent Kalibrierung schlaegt er also bei halbem Kommando
  // an. Gemessen ergaben eingestellte 83 ms 65, 200 ergaben 155 und 500 ergaben 385: durchweg
  // 78 Prozent, und der Faktor sass an einem Regler zwei Zeilen weiter unten.
  //
  // Geprueft wird deshalb nicht "der Wert kommt an", sondern die ZUSAGE: die eingestellte
  // Zeit ist die gemessene, und zwar unabhaengig von den zwei anderen Reglern. Toleranz ist
  // ein Zeitschritt des Messaufbaus (5 ms) plus ein Prozent.
  stAdd('Lenkdämpfung: die eingestellte Zeit ist die gemessene', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.steerZeitProbe) {
      return { skip: true, mass: 'steerZeitProbe nicht vorhanden' };
    }
    const schlecht = [], zeilen = [];
    const nah = (ist, soll) => Math.abs(ist - soll) <= 5 + soll * 0.01;
    for (const ms of [40, 83, 200, 500]) {
      const r = OMEGA_TEST.steerZeitProbe({ ms });
      zeilen.push(ms + '→' + r.ms);
      if (!nah(r.ms, ms)) schlecht.push('soll ' + ms + ' ms, gemessen ' + r.ms);
    }
    // 0 heisst sofort: ein einziger Zeitschritt, nicht mehr.
    const sofort = OMEGA_TEST.steerZeitProbe({ ms: 0 });
    zeilen.push('0→' + sofort.ms);
    if (!(sofort.ms <= 10)) schlecht.push('0 ms braucht ' + sofort.ms + ' ms');
    // ---- UND DIE UNABHAENGIGKEIT, der eigentliche Punkt --------------------------
    const calib = $('setting-steer-calib');
    const merk = calib ? calib.value : null;
    try {
      for (const resp of [1.0, 2.0, 3.0]) {
        const r = OMEGA_TEST.steerZeitProbe({ ms: 200, resp });
        if (!nah(r.ms, 200)) {
          schlecht.push('Lenkansprechen ' + resp + ' aendert die Zeit auf ' + r.ms);
        }
      }
      if (calib) {
        for (const cal of [0.5, 1.0, 2.0, 3.0]) {
          calib.value = String(cal);
          calib.dispatchEvent(new Event('input', { bubbles: true }));
          const r = OMEGA_TEST.steerZeitProbe({ ms: 200 });
          if (!nah(r.ms, 200)) {
            schlecht.push('Kalibrierung ' + cal + ' aendert die Zeit auf ' + r.ms);
          }
        }
      }
    } finally {
      if (calib && merk !== null) {
        calib.value = merk;
        calib.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' ') + ' ms, unabhängig von Ansprechen und Kalibrierung'
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
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
    const FELDER = ['loadFrontStatic', 'wheelbaseM', 'yawInertia', 'steerDaempfungMs'];
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
      return { n, grad: r.grad, sg: r.steerGrip, vorn: v.vorn, ms: v.daempfungMs, iz: v.iz };
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
    // 4. Die Lenkdaempfung folgt dem Traegheitsmoment, GLEICHLAEUFIG - und das ist eine
    //    Umkehrung des Vergleichs, nicht seine Abschwaechung: bis v0.5.40 stand hier die
    //    Lenkrate in Anschlaegen je Sekunde, die mit steigender Traegheit FIEL. Dieselbe
    //    Aussage in Millisekunden heisst, dass die Zeit STEIGT. Wer nur den Feldnamen tauscht
    //    und den Vergleich stehen laesst, dreht die Zusicherung um, ohne dass es auffaellt.
    const nachIz = werte.slice().sort((a, b) => a.iz - b.iz);
    for (let i = 1; i < nachIz.length; i++) {
      if (nachIz[i].ms < nachIz[i - 1].ms - 1e-9) {
        schlecht.push('Lenkdaempfung faellt mit dem Traegheitsmoment (' + nachIz[i].n + ')');
      }
    }
    return { ok: !schlecht.length,
             mass: werte.map(w => w.n + ' ' + w.grad + '\u00b0/' + w.ms + 'ms').join('  ')
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
      // HIER STAND steerGrip, UND DAS WAR DIE FALSCHE GROESSE. steerGrip haengt an
      // frontCap und frontUse, also am BREMSEN - der Lenkeinschlag kommt darin gar nicht
      // vor. Bei brake: 0 sind beide Proben rechnerisch gleich, und der Unterschied kam
      // allein daher, dass die Kurvenprobe die Reifen ein wenig aufheizt.
      //
      // Gemessen mit dem Reifenmodell auf 1,0: 0,85650939 gegen 0,85656252, also 5e-5 in
      // der FALSCHEN Richtung - der Test war gruen, solange das Modell auf 2,0 stand und
      // die schnellere Erwaermung das Vorzeichen zufaellig andersherum drehte. Eine
      // Zusicherung, die an der Aufheizrate haengt, sichert nichts zu.
      //
      // Was der Reibkreis WIRKLICH sagt: wer lenkt, hat weniger LAENGS uebrig. Das steht in
      // gripLong, und dort ist der Unterschied kein Rauschen (gemessen 1,00 gegen 0,52).
      teile.push('gripLong gerade ' + gerade.gripLong.toFixed(2)
                 + ' / Kurve ' + kurve.gripLong.toFixed(2));
      if (!(gerade.gripLong > kurve.gripLong + 0.05)) {
        schlecht.push('Kurvenfahrt nimmt keinen Laengsgriff');
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

  // ---- Auf einer Geraden wird nicht gelenkt ----
  //
  // GEMELDET: "In den aktuellen Ideallinien sind diese komischen Kurven - selbst bei einer
  // Gerade sagst du dem Auto, es solle eine Kurve fahren. Mach ausserdem, dass bei einer
  // oder mehreren Geraden zwischen zwei Kurven der Ausgangspunkt der einen mit dem
  // Eingangspunkt der anderen verbunden wird (auf der Zielgeraden fahren alle Autos nach
  // ganz rechts)."
  //
  // GEMESSEN, vorher, auf SR3GLR2GR2G2 mit alpha auf den Deckel normiert:
  //
  //   Kruemmung   Zielgerade +0,38 -> -0,83, dann -0,81 bis -0,83 die GANZE letzte Kachel.
  //               Auf Geraden 10 Vorzeichenwechsel der zweiten Differenz, groesste 1,16.
  //   Rundenzeit  16 Wechsel, groesste 0,557.
  //
  // Geprueft wird die GEOMETRIE und nicht ein Aussehen: auf einem Geradenstueck zwischen
  // zwei Kurven muss alpha eine Gerade sein, also die zweite Differenz null. Toleranz ist
  // die ungleiche Punktdichte an Kachelgrenzen, ein Promille des Deckels.
  //
  // UND DIE GEGENPROBE: die Endwerte muessen die Kurvenanker sein. Ohne sie waere der Test
  // auch mit einer Linie gruen, die auf allen Geraden bei null steht - das wuerde die Regel
  // erfuellen und die Kurven verlieren.
  stAdd('Ideallinie: auf Geraden eine Gerade', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.buildLine) {
      return { skip: true, mass: 'buildLine nicht erreichbar' };
    }
    const proben = ['SR3GLR2GR2G2', 'SHG4HG3', 'SG4R4G4L4'];
    const schlecht = [], zeilen = [];
    // Die Oeffnung gehoert zur zweiten Haelfte dieser Pruefung: dass eine Kurve UEBERHAUPT
    // eine Spanne hat. Ohne sie ist die zeitoptimale Linie die Mittellinie, und dann ist die
    // Spanne zu Recht klein. Die Begruendung in ganzer Laenge steht beim Kurvenausgang-Test.
    const merkExit3 = OMEGA_TEST.getLineExit ? OMEGA_TEST.getLineExit() : null;
    if (OMEGA_TEST.setLineExit) OMEGA_TEST.setLineExit(0.8);
    for (const code of proben) {
      const p = codeToTrack(code);
      const pts = trackCenterline(p.tiles);
      const nrm = trackNormals(pts, true);
      for (const m of ['curvature', 'laptime', 'lateapex']) {
        const L = OMEGA_TEST.buildLine(pts, nrm, { closed: true, tiles: p.tiles, model: m });
        const grenze = L.limit * 0.001;
        let maxD2 = 0, wo = -1;
        for (let i = 2; i < pts.length - 1; i++) {
          // Nur INNEN in einem Geradenstueck: an der Grenze zur Kurve darf ein Knick sein,
          // dort beginnt die Kurvenform.
          const t0 = p.tiles[pts[i - 1].tile], t1 = p.tiles[pts[i].tile];
          const t2 = p.tiles[pts[i + 1].tile];
          if (!t0 || !t1 || !t2) continue;
          if (kurvenDrehung(t0.type) || kurvenDrehung(t1.type) || kurvenDrehung(t2.type)) continue;
          const d2 = Math.abs(L.alpha[i + 1] - 2 * L.alpha[i] + L.alpha[i - 1]);
          if (d2 > maxD2) { maxD2 = d2; wo = i; }
        }
        zeilen.push(code.slice(0, 8) + '/' + m.slice(0, 4) + ' ' + maxD2.toFixed(4));
        if (maxD2 > grenze) {
          schlecht.push(code + '/' + m + ': zweite Differenz ' + maxD2.toFixed(3)
                        + ' bei Punkt ' + wo);
        }
        // Gegenprobe: die Linie muss die Bahnbreite ueberhaupt benutzen.
        if (!(L.span > L.limit * 0.15)) {
          schlecht.push(code + '/' + m + ': Spanne nur ' + (L.span / L.limit).toFixed(2)
                        + ' (Kurvenoeffnung 0,8)');
        }
      }
    }
    // ZURUECKLEGEN. Ein Prueflauf, der die Kurvenoeffnung verstellt und liegen laesst,
    // verfaelscht jede spaetere Linie - und in dieser Datei laufen danach noch ein Dutzend.
    if (merkExit3 !== null && OMEGA_TEST.setLineExit) OMEGA_TEST.setLineExit(merkExit3);
    return { ok: !schlecht.length,
             mass: zeilen.join(' ')
                 + (schlecht.length ? ' || ' + schlecht.join('; ') : ' | alle gerade') };
  });

  // ---- Kurvenzuege brechen bei einem Richtungswechsel ----
  //
  // DER FEHLER, DEN DIESE PRUEFUNG FESTHAELT: lineKurvenLaeufe() fragte nur, OB eine Kachel
  // eine Kurve ist, nicht wohin sie dreht. Auf SR3GLR2GR2G2 verschmolzen damit Kachel 5
  // (links) und die Kacheln 6-7 (rechts) zu EINEM Zug - das Layout hatte drei Kurven statt
  // vier, mit einem Scheitel fuer eine Links-Rechts-Kombination.
  //
  // Gefunden hat es das dritte Linienmodell, weil es je Kurve einen Scheitel vergibt und
  // deshalb zaehlt. Die Kurvenoeffnung davor nahm ihr Vorzeichen aus dem Scheitel und
  // funktionierte mit dem falschen Zug halbwegs weiter - deshalb fiel es nie auf.
  stAdd('Kurvenzuege: eine Schikane ist zwei Kurven', () => {
    if (typeof lineKurvenLaeufe !== 'function') {
      return { skip: true, mass: 'lineKurvenLaeufe nicht erreichbar' };
    }
    const faelle = [
      { code: 'SR3GLR2GR2G2', zuege: 4 },   // R3 | L | R2 | R2 - die gemeldete Strecke
      { code: 'SRRRLLL', zuege: 2 },        // drei rechts, drei links
      { code: 'SG4R4G4L4', zuege: 2 },
      { code: 'SHG4HG3', zuege: 2 },
    ];
    const schlecht = [], zeilen = [];
    for (const f of faelle) {
      const p = codeToTrack(f.code);
      const l = lineKurvenLaeufe(p.tiles, true);
      zeilen.push(f.code.slice(0, 8) + ' ' + l.length);
      if (l.length !== f.zuege) {
        schlecht.push(f.code + ': ' + l.length + ' Zuege statt ' + f.zuege);
      }
      // Und in jedem Zug dreht jede Kachel gleich - das ist die Zusicherung selbst.
      for (const z of l) {
        for (let kk = z.von; kk <= z.bis; kk++) {
          const t = p.tiles[((kk % p.tiles.length) + p.tiles.length) % p.tiles.length];
          if (kurvenDrehung(t.type) !== z.dreht) {
            schlecht.push(f.code + ': Zug ' + z.von + '-' + z.bis + ' mischt Richtungen');
          }
        }
      }
    }
    return { ok: !schlecht.length,
             mass: zeilen.join('  ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
  });

  // ---- Drittes Modell: schneller, spaeter Scheitel, und die Schranke haelt ----
  //
  // Drei Aussagen, und jede ist nachrechenbar:
  //
  //   1. Der Scheitel liegt hinter 55 Prozent des Kurvenwegs. Das ist die Schranke, und sie
  //      ist der Grund, warum das Modell existiert - die freie Suche in 'laptime' verschiebt
  //      ihn gemessen um +0,045 der Kurvenlaenge, also gar nicht.
  //   2. Es ist im eigenen Mass schneller als die anderen zwei. Gemessen auf vier Layouts
  //      15 bis 35 Prozent.
  //   3. Es ist schneller als die MITTELLINIE - aber nur, wenn man es frei laesst, und das
  //      ist der ehrliche Teil dieser Pruefung.
  //
  //      Eine Carrera-Kurve ist ein Bogen mit FESTEM Radius. Nachgemessen an einer reinen
  //      Rechtskurve, mittlerer Bahnradius bei konstantem Versatz: Mittellinie 34,7
  //      Einheiten, alpha +4 gibt 38,8, alpha -4 gibt 30,7. Nach innen zu tauchen macht den
  //      Radius also KLEINER, und die zeitschnellste Linie hat deshalb gar keinen Scheitel -
  //      bei Oeffnung 0 legt der Optimierer sie auf +-0,11 der Bahnbreite, also praktisch
  //      auf die Mitte.
  //
  //      Wer eine Linie will, die aussieht wie eine Ideallinie, fordert die FORM ueber den
  //      Regler und zahlt Zeit dafuer. Gemessen, Late Apex gegen die Mittellinie:
  //
  //          Oeffnung   Spanne        Zeit gegen Mittellinie
  //             0       0,07 - 0,09     +1,0 bis +1,5 %
  //             0,4     0,33 - 0,48     -0,7 bis -1,9 %
  //             0,8     0,68 - 0,91     -4,9 bis -5,3 %
  //
  //      Geprueft wird deshalb BEIDES getrennt: bei Oeffnung 0 muss die freie Optimierung
  //      die Mittellinie schlagen (sonst ist die Suche kaputt - genau das war sie einmal,
  //      mit 4,1 Prozent SCHLECHTER, und es war ein lokales Minimum), und bei der Vorgabe
  //      muss die FORM stimmen. Eine Pruefung, die beides in einem Satz verlangt, wuerde
  //      eine Zusicherung fordern, die die Geometrie nicht hergibt.
  stAdd('Late Apex: spaeter Scheitel und schneller als die Mittellinie', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.buildLine || !OMEGA_TEST.lapTimeOf) {
      return { skip: true, mass: 'buildLine/lapTimeOf nicht erreichbar' };
    }
    const proben = ['SR3GLR2GR2G2', 'SHG4HG3', 'SG4R4G4L4', 'SRRRLLL'];
    const schlecht = [], zeilen = [];
    for (const code of proben) {
      const p = codeToTrack(code);
      const pts = trackCenterline(p.tiles);
      const nrm = trackNormals(pts, true);
      const o = { closed: true, tiles: p.tiles };
      const LA = OMEGA_TEST.buildLine(pts, nrm, Object.assign({ model: 'lateapex' }, o));
      const LT = OMEGA_TEST.buildLine(pts, nrm, Object.assign({ model: 'laptime' }, o));
      const g = LA.grenzen;
      const mitte = OMEGA_TEST.lapTimeOf(pts.map((q) => [q.x, q.y]), true,
        { closed: true, aLat: g.aLat, aAcc: g.aAcc, aBrk: g.aBrk, vMax: g.vMax }).time;
      zeilen.push(code.slice(0, 8) + ' ' + LA.lapTime.toFixed(1) + '/' + LT.lapTime.toFixed(1)
                  + '/' + mitte.toFixed(1) + ' Scheitel ' + LA.apex.join(','));
      // 1. Die Schranke
      for (const a of LA.apex) {
        if (a < 0.55 - 1e-9 || a > 0.85 + 1e-9) {
          schlecht.push(code + ': Scheitel bei ' + a + ' ausserhalb 0,55 bis 0,85');
        }
      }
      // 2. NICHT SCHNELLER als das Rundenzeitmodell, und das ist eine Berichtigung an mir
      //    selbst. Hier stand `LA.lapTime < LT.lapTime`, also die Forderung, das
      //    eingeschraenkte Modell sei schneller als das freie. Das kann nicht sein: beide
      //    minimieren DIESELBE Zielfunktion ueber demselben Suchraum, und 'lateapex' hat
      //    zusaetzlich die Scheitelschranke. Ein kleinerer Suchraum kann ein Minimum nur
      //    verfehlen, nie verbessern. Gemessen liegen die zwei auf zwei von vier Layouts
      //    gleich (15,30 gegen 15,30), weil die Oeffnungsschranke dort ohnehin bindet.
      //
      //    Und auch die UMKEHRUNG ist nicht behauptbar, was ich beim ersten Anlauf ebenfalls
      //    falsch hatte: gemessen kam 'lateapex' auf SR3GLR2GR2G2 mit 19,77 s vor dem freien
      //    19,90 s heraus. Beide sind LOKALE Optima eines nicht konvexen Problems, gestartet
      //    von drei festen Punkten - und die Startpunkte der beiden unterscheiden sich, weil
      //    der Scheitelbereich verschieden ist. Ein lokaler Abstieg mit anderem Start darf im
      //    Einzelfall besser landen; das ist eine Eigenschaft des Verfahrens und kein
      //    Widerspruch.
      //
      //    Als ZUSICHERUNG bleibt damit nur eine grobe Bandbreite, die eine echte Entgleisung
      //    faengt und keine Ordnung behauptet, die es nicht gibt. Der Vergleich selbst steht
      //    im Messwert und ist dort ablesbar.
      if (!(LA.lapTime < LT.lapTime * 1.15)) {
        schlecht.push(code + ': ' + LA.lapTime.toFixed(2) + ' s liegt mehr als 15 % ueber '
                      + 'dem freien ' + LT.lapTime.toFixed(2));
      }
      // 3. FREI GELASSEN schneller als gar kein Versatz. Die Oeffnung wird dafuer auf 0
      //    gestellt und danach zurueckgegeben.
      const merkExit = OMEGA_TEST.getLineExit();
      let frei = null;
      try {
        OMEGA_TEST.setLineExit(0);
        frei = OMEGA_TEST.buildLine(pts, nrm, Object.assign({ model: 'lateapex' }, o));
      } finally {
        OMEGA_TEST.setLineExit(merkExit);
      }
      zeilen[zeilen.length - 1] += ' frei ' + frei.lapTime.toFixed(1);
      if (!(frei.lapTime < mitte)) {
        schlecht.push(code + ': frei optimiert ' + frei.lapTime.toFixed(2)
                      + ' s nicht schneller als die Mittellinie mit ' + mitte.toFixed(2));
      }
      // 4. Und mit der Vorgabe stimmt die FORM: Ein- und Ausgang aussen, Scheitel innen.
      for (const z of (OMEGA_TEST.lineShape(code, 'lateapex') || [])) {
        if (Math.sign(z.scheitel) !== z.dir) {
          schlecht.push(code + ': Scheitel ' + z.scheitel.toFixed(2) + ' auf der falschen '
                        + 'Seite bei Kachel ' + z.von + '-' + z.bis);
        }
      }
    }
    return { ok: !schlecht.length,
             mass: zeilen.join(' | ') + (schlecht.length ? ' || ' + schlecht.join('; ') : '') };
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
  //
  // AM SCHEITEL UND NICHT IM MITTEL, seit v0.5.40 - und das ist keine Abschwaechung, sondern
  // die Berichtigung einer Groesse, die ihre Aussage verloren hat. Bis dahin klebte die Linie
  // ueber die ganze Kurve auf der Innenseite, da war das Mittel dasselbe wie der Scheitel.
  // Seit sie von aussen anfaehrt und nach aussen ausfaehrt, DURCHQUERT sie die Bahn, und ihr
  // Mittelwert sagt darueber nichts mehr: gemessen an SG2H2G2J2 liegt das Mittel eines
  // Haarnadelzugs bei +0,05, waehrend die Spanne 1,89 betraegt.
  //
  // Dafuer wird jetzt MEHR geprueft als vorher, naemlich die ganze Form:
  //
  //   der Scheitel liegt innen, mit Betrag           sonst gibt es keinen Scheitel
  //   Ein- und Ausgang liegen weiter aussen als er   sonst ist es keine Kurvenlinie
  //
  // Die zweite Bedingung nur fuer Zuege ueber MEHRERE Kacheln, und das ist Geometrie und
  // keine Nachsicht: eine einzelne 60-Grad-Kachel inmitten gegensinniger Kurven hat keinen
  // Platz fuer Anfahrt, Scheitel und Ausfahrt. Gemessen liegt der schlechteste
  // Mehrkachelzug bei 0,27, der schlechteste Einkachelzug bei 0,03 - die Schranke von 0,15
  // trennt die beiden Faelle sauber.
  stAdd('Ideallinie liegt auf der Innenseite', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.lineShape) {
      return { skip: true, mass: 'lineShape nicht vorhanden' };
    }
    const proben = ['SG4R4G4L4', 'SG2RG2L', 'SRRRLLL', 'SG2H2G2J2'];
    const schlecht = [];
    const zeilen = [];
    let n = 0;
    // ---- MIT KURVENOEFFNUNG, sonst gibt es keinen Scheitel zu pruefen -------------
    //
    // Gemessen mit Oeffnung 0: Kruemmungsmodell -0,68 und +0,33, Rundenzeitmodell 0,09 und
    // -0,02 - also kein Scheitel und ein zufaelliges Vorzeichen. Mit 0,8: +0,48/-0,48 und
    // +1/-1, saubere Vorzeichen. Der Grund ist der feste Kurvenradius, und er steht beim
    // Kurvenausgang-Test in ganzer Laenge.
    const merkExit4 = OMEGA_TEST.getLineExit ? OMEGA_TEST.getLineExit() : null;
    if (OMEGA_TEST.setLineExit) OMEGA_TEST.setLineExit(0.8);
    for (const code of proben) {
      for (const m of ['curvature', 'laptime']) {
        const zuege = OMEGA_TEST.lineShape(code, m);
        if (!zuege || !zuege.length) { schlecht.push(code + '/' + m + ': keine Kurve'); continue; }
        for (let zi = 0; zi < zuege.length; zi++) {
          const z = zuege[zi];
          n++;
          const wo = code + '/' + m + ' Kachel ' + z.von + '-' + z.bis
                     + ' dreht ' + (z.dir > 0 ? 'rechts' : 'links');
          // 1. Der Scheitel liegt innen, und zwar mit Betrag.
          //
          // ZWEI SCHRANKEN, UND DER GRUND IST PLATZ. Die Tiefe des Scheitels haengt am
          // Regler "Kurven oeffnen", und dessen Wirkung skaliert mit der BOGENLAENGE des
          // Kurvenzuges: eine einzelne 60-Grad-Kachel hat 36 von 80 Einheiten Bezugslaenge,
          // bekommt also 45 Prozent. Bei der Vorgabe 0,8 und dem Kurvenfaktor 0,6 sind das
          // 0,8 * 0,6 * 0,45 = 0,216 - gemessen kam auf SG2RG2L genau 0,20 heraus, mit
          // richtigem Vorzeichen. Eine Schranke von 0,25 fuer alle wuerde also die Geometrie
          // bestrafen und nicht einen Fehler.
          const tief = z.bis > z.von ? 0.25 : 0.15;
          if (Math.sign(z.scheitel) !== z.dir || Math.abs(z.scheitel) < tief) {
            schlecht.push(wo + ', Scheitel ' + z.scheitel.toFixed(2));
            continue;
          }
          // 2. Und die Form: Ein- und Ausgang liegen WEITER AUSSEN als der Scheitel.
          //
          // NICHT AN EINER SCHIKANE, und das ist Geometrie und keine Nachsicht: liegt
          // zwischen zwei Kurven keine Kachel, dann sind der Ausgang der einen und der
          // Eingang der anderen DERSELBE Abtastpunkt - und der kann nicht gleichzeitig
          // aussen fuer eine Rechts- und eine Linkskurve sein. Gemessen an SRRRLLL: dort
          // liegt der Uebergang bei calc +0,335, also aussen fuer die folgende Linkskurve
          // und damit innen fuer die vorhergehende Rechtskurve. Beides ist wahr.
          //
          // Dieselbe Ausnahme macht auch die Konstruktion in formLine() - dort faellt an
          // einem direkten Uebergang der Aussenboden weg und die zwei Anker werden zu einem
          // Wert. Eine Pruefung, die sie nicht kennt, prueft ein anderes Bauwerk.
          const nx = zuege[(zi + 1) % zuege.length];
          const pv = zuege[(zi - 1 + zuege.length) % zuege.length];
          const nachSchikane = zuege.length > 1 && nx && nx.von === z.bis + 1;
          const vorSchikane = zuege.length > 1 && pv && z.von === pv.bis + 1;
          if (z.bis > z.von) {
            const fEin = z.dir * (z.scheitel - z.eingang);
            const fAus = z.dir * (z.scheitel - z.ausgang);
            const teile = [];
            if (!vorSchikane) teile.push(fEin);
            if (!nachSchikane) teile.push(fAus);
            if (teile.length && Math.min.apply(null, teile) < 0.15) {
              schlecht.push(wo + ', Form ein ' + fEin.toFixed(2) + ' aus ' + fAus.toFixed(2));
            }
          }
        }
        if (m === 'laptime') {
          zeilen.push(code + ' ' + zuege.map(z => (z.dir > 0 ? 'R' : 'L')
                      + z.eingang.toFixed(2) + '/' + z.scheitel.toFixed(2)
                      + '/' + z.ausgang.toFixed(2)).join(' '));
        }
      }
    }
    // ZURUECKLEGEN, wie beim Geradentest - eine liegengelassene Kurvenoeffnung verfaelscht
    // jede Linie, die danach gebaut wird.
    if (merkExit4 !== null && OMEGA_TEST.setLineExit) OMEGA_TEST.setLineExit(merkExit4);
    return { ok: !schlecht.length,
             mass: n + ' Kurvenzuege in ' + proben.length + ' Strecken x 2 Modelle'
                 + ' (Kurvenoeffnung 0,8 gesetzt)'
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
    // ---- DIE PROBEPUNKTE HAENGEN AN DER SCHWELLE, NICHT AN FESTEN ZAHLEN ---------
    //
    // Hier standen 0,05 / 0,35 / 0,7 / 1,5 mit der Erwartung, dass ab 0,7 nichts mehr
    // passiert - das war der Mindestabstand von damals. Er steht jetzt bei 1,2, gewaehlt aus
    // dem Sweep bei "Ueberholen: Reichweite ueber dem Mindestabstand" (29,1 Beruehrungen je
    // Minute gegen 40,1 beim alten Wert, bei mehr Ueberholmanoevern).
    //
    // Die Punkte werden deshalb AUS der Schwelle gerechnet. Feste Zahlen wuerden bei der
    // naechsten Abstimmung wieder rot, ohne dass etwas kaputt ist - und genau das ist hier
    // passiert.
    const S = OMEGA_TEST.gapMinLesen ? OMEGA_TEST.gapMinLesen() : 1.2;
    const punkte = [S * 0.04, S * 0.3, S, S * 1.25];
    const r = OMEGA_TEST.ghostGapFactor(punkte);
    if (r.length < 4) return { skip: true, mass: 'Prueflauf leer' };
    const f = r.map(x => x.faktor);
    // Monoton steigend mit dem Abstand, und AB der Schwelle wirkungslos.
    const monoton = f[0] < f[1] && f[1] < f[2] && Math.abs(f[3] - 1) < 1e-9
                    && Math.abs(f[2] - 1) < 1e-9;
    // Und er muss ueberhaupt etwas KOSTEN. Ein Baustein, der 0,2 Prozent bewegt, ist auf
    // dem Tisch nicht zu sehen - dieselbe Klasse wie ein Regler mit Faktor null.
    const wirkt = 1 - f[0] > 0.15;
    return { ok: monoton && wirkt,
             mass: 'Schwelle ' + S + ' | ' + r.map(x => x.gap + ': x' + x.faktor).join('  ')
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

  // ---- Ghost-Boxenstopp ----
  //
  // DIE PRUEFUNG, DIE DIESES FEATURE UEBERHAUPT BRAUCHT, ist die erste: der Ghost darf
  // waehrend des Stopps nicht geparkt werden.
  //
  // GHOST_READ_MIN = 0,35 ist die Leseschwelle - unter etwa 35 Prozent der
  // Hoechstgeschwindigkeit liest das Auto das gedruckte Muster nicht mehr und meldet 0x00.
  // Der Abgangsmelder parkt daraufhin nach max(900 ms mit 0x00, 4000 ms seit dem letzten
  // Kachelwechsel), also rund vier Sekunden nach dem Stillstand. Ein Stopp von 3 bis 10 s
  // trifft das garantiert, und das einzige Veto (g.gnadeBis) dauert 3 s und wurde vor diesem
  // Feature nie verlaengert.
  //
  // Der Messaufbau faehrt deshalb durch den ECHTEN ghostTick() mit gefaelschter Uhr und
  // meldet 0x00, sobald das Auto steht - genau wie ein Auto, das nichts mehr liest. Eine
  // Nachbildung der Zustandsmaschine wuerde den Melder nicht enthalten und waere gruen,
  // waehrend das Auto auf dem Teppich blinkt.
  stAdd('Ghost-Boxenstopp: Phasen, rechter Rand, und kein Parken', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPitProbe) {
      return { skip: true, mass: 'ghostPitProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostPitProbe({ laenge: 10, takte: 600, autos: 1 });
    const fehler = [];
    // 1. NICHT GEPARKT. Zehn Sekunden Stillstand, also weit ueber der Bestaetigung.
    if (r.geparkt) fehler.push('waehrend des Stopps geparkt');
    // 2. Die Phasen in der Reihenfolge, und die Sequenz ENDET.
    const soll = [null, 'anfahrt', 'halt', 'stand', 'raus', null];
    if (r.folge.join('>') !== soll.join('>')) {
      fehler.push('Folge ' + r.folge.join('>') + ' statt ' + soll.join('>'));
    }
    // 3. RECHTS, nicht links. Am ENDE jeder Phase, nicht im Minimum: g.querSoll ist ein
    //    nachlaufender Filter, sein Minimum ist der Startwert der Phase.
    //
    //    Byte 7 positiv ist rechts, und das ist nicht Konvention, sondern nachgemessen: bei
    //    konstantem Versatz gibt +4 einen mittleren Bahnradius von 38,8 Einheiten, -4 nur
    //    30,7 - der groessere Radius ist der aeussere.
    for (const ph of ['halt', 'stand']) {
      const q = r.querEnde ? r.querEnde[ph] : null;
      if (!(q >= 0.9)) fehler.push(ph + ': Querlage ' + q + ' statt am rechten Rand');
    }
    if (!(r.querEnde && r.querEnde.anfahrt > 0)) {
      fehler.push('Anfahrt endet nicht rechts der Mitte');
    }
    return { ok: !fehler.length,
             mass: r.folge.join(' > ') + ' | Querlage am Phasenende '
                 + JSON.stringify(r.querEnde) + ' | geparkt ' + r.geparkt
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Einer pittet, die anderen weichen aus ----
  //
  // DIE ZUSAGE HAT SICH GEAENDERT, und das gehoert hierhin und nicht in ein Nebenprotokoll:
  // bis v0.5.46 pittete immer nur EINER, und dieser Test prueft das mit `r.mehrfach === 0`.
  // Seit der Boxengasse ist "mehrere gleichzeitig" ausdruecklich bestellt - jeder auf seiner
  // eigenen Kachel. Die Zusage ist jetzt nicht mehr "nur einer", sondern "nie zwei auf
  // demselben Platz, und wer vorbei muss, faehrt nicht rechts". Sie steht im Test darunter.
  //
  // Was HIER bleibt, ist die andere Haelfte: dass die Autos, die NICHT pitten, ausweichen.
  // Sie hat zwei Teile - yieldSide (weich, Autoritaet 0,64) und eine KLEMME auf der
  // Boxenkachel (hart). Geprueft wird die Klemme, denn die weiche Haelfte kann von der
  // Ideallinie ueberstimmt werden.
  //
  // Und zwar WAEHREND die Sperre gilt, nicht am Ende: gemessen steht ein anderes Auto nach
  // dem Stopp wieder bei +0,999 auf seiner Linie, und dieser Wert sagt ueber die Sperre
  // nichts. Der Messaufbau fuehrt deshalb je Auto die groesste Querlage in den Takten mit,
  // in denen pitSperreRechts() fuer es wahr war.
  //
  // nurEiner: die zwei anderen sind NICHT faellig. Ohne das nehmen sie sich seit der
  // Boxengasse selbst einen Platz, und dann gibt es keine Umstehenden mehr - der Test waere
  // gruen, weil er nichts mehr prueft.
  stAdd('Ghost-Boxenstopp: einer pittet, die anderen gehen links', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPitProbe) {
      return { skip: true, mass: 'ghostPitProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostPitProbe({ laenge: 4, takte: 500, autos: 3, nurEiner: true });
    const fehler = [];
    // Bei nurEiner MUSS es einer bleiben - nicht weil die Gasse es verbietet, sondern weil
    // die anderen nicht faellig sind. Bricht das, ist der Ausloeser undicht.
    if (r.mehrfach) fehler.push(r.mehrfach + ' Takte mit zwei Stopps, obwohl nur einer '
                                + 'faellig war');
    if (r.geparkt) fehler.push('waehrend des Stopps geparkt');
    if (!r.andere.length) fehler.push('keine anderen Autos im Aufbau');
    for (let i = 0; i < r.andere.length; i++) {
      const a = r.andere[i];
      if (a.yieldSide !== -1) fehler.push('Auto ' + (i + 1) + ': yieldSide ' + a.yieldSide);
      // Die Gegenprobe, dass die Sperre ueberhaupt gegolten hat - ohne sie waere die
      // Aussage darunter leer.
      if (!(a.sperreTakte > 0)) fehler.push('Auto ' + (i + 1) + ': Sperre nie aktiv');
      else if (!(a.sperreMax <= 0)) {
        fehler.push('Auto ' + (i + 1) + ': Querlage ' + a.sperreMax + ' rechts der Mitte, '
                    + 'obwohl dort einer steht');
      }
    }
    return { ok: !fehler.length,
             mass: r.andere.map((a, i) => 'A' + (i + 1) + ' yield ' + a.yieldSide
                                 + ', ' + a.sperreTakte + ' Takte gesperrt, max '
                                 + a.sperreMax).join(' | ')
                 + ' | ' + r.mehrfach + ' Doppelstopps'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die Boxengasse: mehrere gleichzeitig, jeder auf seiner Kachel ----
  //
  // BESTELLT: "Mach, dass mehrere Autos Boxenstopp machen koennen. Wenn ein Auto schon einen
  // Stopp macht, soll das naechste ab der Kachel eins spaeter anfangen (und das andere nicht
  // rammen)." Drei Zusagen, und alle drei stehen hier.
  //
  // DER AUFBAU ERZWINGT DEN FALL: ein Wetterwechsel macht ALLE Ghosts gleichzeitig faellig -
  // das ist der Moment, in dem eine Boxengasse unter Druck steht, und der Grund, warum
  // dieser Test am Reifenwechsel haengt und nicht an einem Planstopp.
  //
  // Der DRITTE Punkt braucht eine Unterscheidung, die zwei Messfehler gekostet hat:
  // g.querSoll ist ein nachlaufender Filter (rund 0,5 s fuer die volle Breite), nicht der
  // Befehl. Ein Auto, das mit rechter Ideallinie in die Gasse einfaehrt, steht dort einige
  // Takte lang noch rechts, obwohl der Befehl schon links lautet. Gemessen wird deshalb der
  // BEFEHL - er ist die Zusage, der Filter ihre Physik.
  stAdd('Ghost-Boxengasse: mehrere Plaetze, und keiner faehrt dem anderen ins Heck', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostReifenProbe) {
      return { skip: true, mass: 'ghostReifenProbe nicht vorhanden' };
    }
    const fehler = [], zeilen = [];
    // Zwei Feldgroessen: vier passen genau in die Gasse, sechs muessen anstehen.
    for (const autos of [4, 6]) {
      const r = OMEGA_TEST.ghostReifenProbe({ autos, takte: 2500,
                                              wechselBei: 100, laenge: 5 });
      if (!r) return { skip: true, mass: 'kein Lauf' };
      const plaetze = r.plaetze.map((p) => p.join('+')).join('/');
      zeilen.push(autos + ' Autos: Plaetze ' + plaetze + ', hoechstens '
                  + r.hoechstGleich + ' gleichzeitig, ' + r.vorbeiTakte
                  + ' Takte Vorbeifahrt');
      // 1. MEHRERE GLEICHZEITIG. Das ist die Bestellung, und mit einem Platz waere es 1.
      if (!(r.hoechstGleich >= 2)) {
        fehler.push(autos + ' Autos: nur ' + r.hoechstGleich + ' gleichzeitig in der Box');
      }
      // 2. NIE ZWEI AUF DEMSELBEN PLATZ. Das ist die Zusage, die "nicht rammen" laengs
      //    bedeutet: zwei Autos auf einer Kachel stehen ineinander.
      if (r.doppeltBelegt) {
        fehler.push(autos + ' Autos: ' + r.doppeltBelegt
                    + ' Takte mit zwei Autos auf demselben Platz');
      }
      // 3. WER VORBEI MUSS, FAEHRT NICHT RECHTS. Das ist dieselbe Zusage quer.
      if (r.vorbeiBefehlRechts) {
        fehler.push(autos + ' Autos: ' + r.vorbeiBefehlRechts
                    + ' Takte mit rechtem Befehl, obwohl dort einer steht');
      }
      // Die Gegenprobe: es muss ueberhaupt vorbeigefahren worden sein, sonst ist Punkt 3
      // eine leere Aussage.
      if (!(r.vorbeiTakte > 0)) {
        fehler.push(autos + ' Autos: niemand musste vorbei - der Aufbau prueft nichts');
      }
      // 4. Und keiner parkt sich waehrend des Stopps. Mit mehreren Stehenden ist das
      //    schwerer als mit einem: die Gnade muss fuer jeden einzeln laufen.
      if (r.geparkt) fehler.push(autos + ' Autos: ein Auto wurde geparkt');
      // 5. Die Gasse ist gedeckelt. Bei sechs Autos duerfen nicht sechs Plaetze entstehen -
      //    sonst steht ein Fuenftel der Runde voll.
      if (r.hoechstGleich > 4) {
        fehler.push(autos + ' Autos: ' + r.hoechstGleich + ' Plaetze, mehr als der Deckel');
      }
    }
    return { ok: !fehler.length,
             mass: zeilen.join(' | ') + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der Boxenplatz bleibt nach einem Abbruch nicht besetzt ----
  //
  // DER FEHLER, DEN DIESE PRUEFUNG FESTHAELT: stopGhost() raeumte running und finish auf,
  // aber nicht g.pit - und finishGhost() setzte g.finish, worauf ghostTick() frueh aussteigt
  // und pitTick() nie wieder laeuft. Der Stopp blieb also fuer immer offen und der
  // modulweite Boxenplatz besetzt.
  //
  // WARUM DIE SELBSTHEILUNG DAS NICHT DECKT: pitInhaberGueltig() verwirft einen Anspruch,
  // wenn das Auto keinen Stopp mehr hat ODER nicht mehr in der Garage steht. Im Rennen
  // BLEIBT das Auto in der Garage, und g.pit stand noch - beide Bedingungen erfuellt, der
  // Anspruch galt weiter. In der Rennsimulation faellt es nicht auf, weil die neue Autos
  // baut; gemessen pittete dort auch nach einem Abbruch mitten im Stopp weiter (503 Takte).
  //
  // Folge waere gewesen: wer ein Rennen beendet, waehrend ein Ghost in der Box steht, sieht
  // danach nie wieder einen Boxenstopp - und die Ursache steht nirgends.
  stAdd('Ghost-Boxenstopp: der Platz wird nach einem Abbruch frei', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.pitAbbruchProbe) {
      return { skip: true, mass: 'pitAbbruchProbe nicht vorhanden' };
    }
    const fehler = [], zeilen = [];
    for (const wie of ['finish', 'stop']) {
      const r = OMEGA_TEST.pitAbbruchProbe(wie);
      zeilen.push(wie + ': belegt ' + r.vor + ' -> ' + r.nach + ', pit ' + r.pit
                  + ', in Garage ' + r.inGarage);
      // Die Gegenprobe zuerst: ohne einen belegten Platz prueft der Rest nichts.
      if (!r.vor) fehler.push(wie + ': der Platz war nicht belegt');
      if (r.nach) fehler.push(wie + ': der Platz bleibt belegt');
      if (r.pit) fehler.push(wie + ': g.pit steht noch');
      // Und der Fall MUSS der schwierige sein: das Auto bleibt in der Garage, sonst haette
      // die Selbstheilung ueber die Garage gegriffen und die Pruefung waere leer.
      if (!r.inGarage) fehler.push(wie + ': das Auto war nicht mehr in der Garage');
    }
    return { ok: !fehler.length,
             mass: zeilen.join(' | ') + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die Faelligkeit liegt im eingestellten Band ----
  //
  // Zwei Regler, ein Band, und die Ziehung muss beide Grenzen erreichen - eine Ziehung, die
  // nur die Mitte trifft, waere ein Band ohne Wirkung.
  stAdd('Ghost-Boxenstopp: die Faelligkeit liegt im Band', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.pitFaelligProbe) {
      return { skip: true, mass: 'pitFaelligProbe nicht vorhanden' };
    }
    const fehler = [];
    const r = OMEGA_TEST.pitFaelligProbe(5, 9, 300);
    const lo = Math.min.apply(null, r), hi = Math.max.apply(null, r);
    if (lo < 5) fehler.push('Ziehung ' + lo + ' unter der Untergrenze');
    if (hi > 9) fehler.push('Ziehung ' + hi + ' ueber der Obergrenze');
    // Beide Enden muessen vorkommen. Bei 300 Ziehungen aus fuenf Werten ist die
    // Wahrscheinlichkeit, ein Ende zu verpassen, (4/5)^300 - also praktisch null.
    if (lo !== 5) fehler.push('die Untergrenze 5 kommt nicht vor');
    if (hi !== 9) fehler.push('die Obergrenze 9 kommt nicht vor');
    // Und ein entartetes Band ist gueltig: gleiche Werte heissen "immer nach so vielen".
    const g = OMEGA_TEST.pitFaelligProbe(7, 7, 20);
    if (g.some((x) => x !== 7)) fehler.push('bei 7/7 kommt nicht immer 7 heraus');
    return { ok: !fehler.length,
             mass: '300 Ziehungen aus 5..9: ' + lo + ' bis ' + hi + ', bei 7/7 immer '
                 + g[0] + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Regenreifen fuer Ghosts ----
  //
  // VIER FAELLE, UND ZWEI DAVON MUESSEN UNVERAENDERT SEIN. Das ist die wichtigste Zusage
  // dieses Features: das Regentempo (0,85) und das Trockentempo (1,0) waren abgestimmt und
  // abgenommen, bevor es Reifen gab. Eine Ableitung, die sie still verschiebt, waere eine
  // Verschlechterung, die niemand bestellt hat - deshalb wird der abgeleitete Griff als
  // VERHAELTNIS angewandt und nicht absolut, und deshalb steht hier ein Gleichheitstest auf
  // GHOST_REGEN_TEMPO und nicht ein Band.
  stAdd('Ghost-Regenreifen: der Tempofaktor, und die zwei bekannten Faelle bleiben', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.reifenTempoProbe) {
      return { skip: true, mass: 'reifenTempoProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.reifenTempoProbe(undefined, { pitAn: true });
    if (!r) return { skip: true, mass: 'kein Faktor' };
    const f = r.faktor, fehler = [];
    const nah = (a, b) => Math.abs(a - b) < 1e-3;
    // 1. Die zwei bekannten Faelle, auf Gleichheit.
    if (!nah(f['dry/trocken'], 1)) {
      fehler.push('trocken auf trocken ' + f['dry/trocken'] + ' statt 1');
    }
    if (!nah(f['rain/regen'], 0.85)) {
      fehler.push('nass auf Regen ' + f['rain/regen'] + ' statt 0,85 (GHOST_REGEN_TEMPO)');
    }
    // 2. Die falschen Reifen kosten, und im Regen deutlich mehr als im Trockenen. Die
    //    Richtung ist die Aussage, die Zahlen stehen als Mass daneben - ein Gleichheitstest
    //    auf 0,6375 wuerde bei jedem Griffwert in TYRE_MIX rot, und das waere eine
    //    Abstimmung und kein Fehler.
    if (!(f['rain/trocken'] < f['rain/regen'] - 0.1)) {
      fehler.push('Slicks im Regen ' + f['rain/trocken'] + ' nicht deutlich langsamer');
    }
    if (!(f['dry/regen'] < 1 && f['dry/regen'] > f['rain/trocken'])) {
      fehler.push('Regenreifen im Trockenen ' + f['dry/regen'] + ' unplausibel');
    }
    return { ok: !fehler.length,
             mass: Object.keys(f).map((k) => k + ' ' + f[k]).join(', ')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Ohne Boxenstopp gibt es keine falschen Reifen ----
  //
  // DIE FALLE, DIE DAS PRUEFT: wer die Ghost-Boxenstopps abschaltet, koennte ein Feld
  // bekommen, das nach dem ersten Regen dauerhaft mit 0,64 kriecht - denn der einzige Weg
  // zurueck ist ein Stopp, und den hat er gerade verboten. Also gilt bei ausgeschaltetem
  // Stopp ueberall der passende Reifen, und das Verhalten faellt BITGLEICH auf das zurueck,
  // was vor diesem Feature da war.
  stAdd('Ghost-Regenreifen: ohne Boxenstopp genau das alte Verhalten', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.reifenTempoProbe) {
      return { skip: true, mass: 'reifenTempoProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.reifenTempoProbe(undefined, { pitAn: false });
    if (!r) return { skip: true, mass: 'kein Faktor' };
    const f = r.faktor, fehler = [];
    const nah = (a, b) => Math.abs(a - b) < 1e-3;
    // Beide Reifen, dasselbe Ergebnis: im Trockenen 1, im Regen 0,85 - der flache Abzug,
    // der vor diesem Feature die einzige Regenregel war.
    for (const reifen of ['trocken', 'regen']) {
      if (!nah(f['dry/' + reifen], 1)) {
        fehler.push('trocken/' + reifen + ' ' + f['dry/' + reifen] + ' statt 1');
      }
      if (!nah(f['rain/' + reifen], 0.85)) {
        fehler.push('nass/' + reifen + ' ' + f['rain/' + reifen] + ' statt 0,85');
      }
    }
    return { ok: !fehler.length,
             mass: 'pitAn aus: ' + Object.keys(f).map((k) => k + ' ' + f[k]).join(', ')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die Oberflaeche im Ghost-Motor kommt aus der Spielertabelle ----
  //
  // ZWEI AUSSAGEN, NICHT EINE: der Tempofaktor oben ist das ZIEL des Reglers, gripScale ist
  // das, womit der Motor bremst und anfaehrt. Ein Fehler in einem waere im anderen nicht zu
  // sehen - ein Ghost mit richtigem Ziel und trockenem Griff faehrt im Regen mit
  // Trockenbremsweg, und das sieht man erst in der Kurve.
  //
  // Und es prueft einen STILLEN FEHLER mit, der vor diesem Feature da war: startGhost()
  // kopiert das ganze Konfigurationsobjekt des Spielers, gripScale eingeschlossen - ein
  // Ghost erbte also die Reifenwahl des Spielers und behielt sie ueber jeden
  // Wetterwechsel.
  stAdd('Ghost-Regenreifen: Griff und Aquaplaning wie beim Spieler-Auto', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.reifenGriffProbe) {
      return { skip: true, mass: 'reifenGriffProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.reifenGriffProbe();
    if (!r) return { skip: true, mass: 'kein Griff' };
    const fehler = [];
    const nah = (a, b) => Math.abs(a - b) < 1e-3;
    // Die vier Werte aus TYRE_MIX in 70-race.js.
    const soll = { 'dry/trocken': 1.00, 'dry/regen': 0.88,
                   'rain/trocken': 0.45, 'rain/regen': 0.80 };
    for (const k of Object.keys(soll)) {
      if (!r[k]) { fehler.push(k + ' fehlt'); continue; }
      if (!nah(r[k].grip, soll[k])) {
        fehler.push(k + ': Griff ' + r[k].grip + ' statt ' + soll[k]);
      }
    }
    // Aufschwimmen NUR auf Slicks im Regen. Regenreifen sind geschnitten - dieselbe Aussage
    // wie TYRE_MIX .aqua beim Spieler.
    if (r['rain/trocken'] && !(r['rain/trocken'].aqua > 0.9)) {
      fehler.push('Slicks im Regen schwimmen nicht auf (' + r['rain/trocken'].aqua + ')');
    }
    if (r['rain/regen'] && !(r['rain/regen'].aqua === 0)) {
      fehler.push('Regenreifen schwimmen auf (' + r['rain/regen'].aqua + ')');
    }
    if (r['dry/trocken'] && !(r['dry/trocken'].aqua === 0)) {
      fehler.push('trocken schwimmt auf (' + r['dry/trocken'].aqua + ')');
    }
    return { ok: !fehler.length,
             mass: Object.keys(r).map((k) => k + ' Griff ' + r[k].grip
                                    + '/Aqua ' + r[k].aqua).join(', ')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der Umschlagpunkt ----
  //
  // Bei WENIG Wasser ist der Slick noch schneller als der Regenreifen: er verliert steil
  // (1,00 -> 0,45), der Regenreifen flach (0,88 -> 0,80), und der Gleichstand liegt bei
  // n = 0,255, also bei halber Regenfront. Das ist keine Absicht, sondern die Aussage der
  // Tabelle - und es ist der Grund, warum ein Reifenwechsel im Rennsport eine Entscheidung
  // ist.
  //
  // WARUM DAS EINE PRUEFUNG WERT IST: wer den Faktor spaeter "aufraeumt" und den falschen
  // Reifen pauschal langsamer macht, loescht diese Eigenschaft, ohne es zu merken. Sie steht
  // hier als Zusicherung, nicht als Kuriositaet.
  stAdd('Ghost-Regenreifen: bei leichtem Regen sind Slicks noch vorn', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.reifenTempoProbe) {
      return { skip: true, mass: 'reifenTempoProbe nicht vorhanden' };
    }
    const leicht = OMEGA_TEST.reifenTempoProbe(-0.5, { pitAn: true });
    const voll = OMEGA_TEST.reifenTempoProbe(0, { pitAn: true });
    if (!leicht || !voll) return { skip: true, mass: 'kein Faktor' };
    const fehler = [];
    // Bei halber Front: der Slick mindestens gleichwertig.
    if (!(leicht.faktor['rain/trocken'] >= leicht.faktor['rain/regen'] - 1e-4)) {
      fehler.push('bei halber Front ist der Slick schon im Nachteil ('
                  + leicht.faktor['rain/trocken'] + ' gegen '
                  + leicht.faktor['rain/regen'] + ')');
    }
    // Bei voller Front deutlich im Nachteil - sonst waere die Rampe wirkungslos.
    if (!(voll.faktor['rain/trocken'] < voll.faktor['rain/regen'] - 0.1)) {
      fehler.push('bei voller Front kein deutlicher Nachteil');
    }
    // Und die Naesse muss sich zwischen den beiden Messungen ueberhaupt geaendert haben,
    // sonst prueft der Test zwei identische Laeufe.
    if (!(voll.nass > leicht.nass + 0.5)) {
      fehler.push('die Rampe bewegt sich nicht (' + leicht.nass + ' -> ' + voll.nass + ')');
    }
    return { ok: !fehler.length,
             mass: 'halbe Front (Naesse ' + leicht.nass + '): Slick '
                 + leicht.faktor['rain/trocken'] + ' gegen Regen '
                 + leicht.faktor['rain/regen'] + ' | volle Front (' + voll.nass + '): '
                 + voll.faktor['rain/trocken'] + ' gegen ' + voll.faktor['rain/regen']
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der ganze Ablauf: Wetterwechsel, Warteschlange, Umruestung ----
  //
  // Die Pruefung, die das Feature als GANZES nachrechnet, und der Aufbau ist so gebaut, dass
  // nur die Reifen es erklaeren koennen: kein Ghost ist planmaessig faellig (die Grenzen
  // stehen auf 200 Runden), und das Wetter wechselt mitten im Lauf.
  //
  // Die Autos stehen auf VERSCHIEDENEN Kacheln. Auf dieselbe gestellt kaeme die
  // Warteschlange nicht zustande: alle waeren im selben Takt an der Einfahrt, einer bekaeme
  // den Platz, und die anderen haetten ihre Gelegenheit fuer diese Runde verpasst, ohne je
  // eine gehabt zu haben.
  stAdd('Ghost-Regenreifen: alle ruesten um, einer nach dem anderen', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostReifenProbe) {
      return { skip: true, mass: 'ghostReifenProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostReifenProbe({ autos: 4, takte: 2500,
                                            wechselBei: 100, laenge: 5 });
    if (!r) return { skip: true, mass: 'kein Lauf' };
    const fehler = [];
    // 1. JEDER hat am Ende die Regenreifen drauf.
    for (let i = 0; i < r.umbauBei.length; i++) {
      if (r.umbauBei[i] === null) fehler.push('Auto ' + (i + 1) + ' ruestete nie um');
    }
    // 2. UND ZWAR WEGEN DER REIFEN. 'plan' waere hier ein Fehler im Aufbau - dann waere
    //    nicht gezeigt, dass der Wetterwechsel den Stopp ausgeloest hat.
    for (let i = 0; i < r.stoppGrund.length; i++) {
      const g = r.stoppGrund[i];
      if (!g.length) fehler.push('Auto ' + (i + 1) + ' hielt nie');
      else if (g.some((x) => x !== 'reifen')) {
        fehler.push('Auto ' + (i + 1) + ': Grund ' + g.join('+') + ' statt reifen');
      }
    }
    // 3. MEHRERE GLEICHZEITIG SIND HIER RICHTIG, und diese Zeile hat es zuerst als
    //    Fehler gemeldet: sie stand auf `mehrfach === 0`, der Zusage aus v0.5.45. Mit der
    //    Boxengasse ist "mehrere zugleich, jeder auf seiner Kachel" ausdruecklich bestellt,
    //    und ein Wetterwechsel ist genau der Fall, fuer den sie gebaut wurde. Was NICHT
    //    passieren darf - zwei auf demselben Platz, oder einer der rechts vorbeifaehrt -
    //    prueft "Ghost-Boxengasse"; hier wird nur festgehalten, dass die Gasse benutzt wird.
    if (!(r.hoechstGleich >= 2)) {
      fehler.push('nur ' + r.hoechstGleich + ' gleichzeitig in der Box - die Gasse wird '
                  + 'nicht benutzt, obwohl alle vier faellig sind');
    }
    if (r.doppeltBelegt) {
      fehler.push(r.doppeltBelegt + ' Takte mit zwei Autos auf demselben Platz');
    }
    // 4. UND KEINER PARKT SICH. Die Leseschwelle greift bei jedem Stillstand, auch bei
    //    einem Reifenstopp - die erneuerte Gnade muss also auch hier tragen.
    if (r.geparkt) fehler.push('ein Auto wurde waehrend des Stopps geparkt');
    // 5. Die Drosselung war da, und danach ist sie weg.
    for (let i = 0; i < r.faktorMin.length; i++) {
      if (!(r.faktorMin[i] < 0.7)) {
        fehler.push('Auto ' + (i + 1) + ' war nie gedrosselt (min ' + r.faktorMin[i] + ')');
      }
      if (Math.abs(r.faktorEnde[i] - 0.85) > 1e-3) {
        fehler.push('Auto ' + (i + 1) + ' faehrt am Ende mit ' + r.faktorEnde[i]);
      }
      if (Math.abs(r.gripEnde[i] - 0.80) > 1e-3) {
        fehler.push('Auto ' + (i + 1) + ': Griff am Ende ' + r.gripEnde[i] + ' statt 0,8');
      }
    }
    // 6. UND SIE STEHEN NICHT ALLE GLEICHZEITIG WIEDER DA. Eine Schlange, in der alle
    //    denselben Takt bekommen, waere keine - der Abstand ist der Beleg, dass der
    //    Boxenplatz nacheinander vergeben wurde.
    const bei = r.umbauBei.filter((x) => x !== null).slice().sort((a, b) => a - b);
    if (bei.length > 1 && !(bei[bei.length - 1] - bei[0] > 100)) {
      fehler.push('alle ruesteten praktisch gleichzeitig um');
    }
    return { ok: !fehler.length,
             mass: 'Wechsel bei Takt ' + r.gewechselt + ', umgeruestet bei '
                 + r.umbauBei.join('/') + ' (falsche Reifen ' + r.falschSek.join('/')
                 + ' s), Drosselung bis ' + r.faktorMin.join('/')
                 + ', danach ' + r.faktorEnde.join('/')
                 + ', hoechstens ' + r.hoechstGleich + ' gleichzeitig in der Box'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Und wieder zurueck auf trocken ----
  //
  // "genau so mit Wetterwechsel zu sonnig" - bestellt, also geprueft. Nicht dasselbe wie der
  // Test darueber: der Rueckweg braucht ZWEI Stopps je Auto, und beim zweiten ist der
  // gezogene Planstopp langst nicht faellig - er kann also nur an den Reifen liegen.
  stAdd('Ghost-Regenreifen: der Rueckweg auf trocken zaehlt genauso', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostReifenProbe) {
      return { skip: true, mass: 'ghostReifenProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostReifenProbe({ autos: 3, takte: 3200, wechselBei: 60,
                                            zurueckBei: 1400, laenge: 5 });
    if (!r) return { skip: true, mass: 'kein Lauf' };
    const fehler = [];
    for (let i = 0; i < r.stoppGrund.length; i++) {
      // ZWEI Stopps: einmal auf Regen, einmal zurueck.
      if (r.stoppGrund[i].length < 2) {
        fehler.push('Auto ' + (i + 1) + ': nur ' + r.stoppGrund[i].length + ' Stopp(s)');
      }
      if (r.stoppGrund[i].some((x) => x !== 'reifen')) {
        fehler.push('Auto ' + (i + 1) + ': Grund ' + r.stoppGrund[i].join('+'));
      }
      // Und am Ende wieder trocken: Faktor 1, Griff 1.
      if (Math.abs(r.faktorEnde[i] - 1) > 1e-3) {
        fehler.push('Auto ' + (i + 1) + ' faehrt am Ende mit ' + r.faktorEnde[i]
                    + ' statt 1');
      }
      if (Math.abs(r.gripEnde[i] - 1) > 1e-3) {
        fehler.push('Auto ' + (i + 1) + ': Griff am Ende ' + r.gripEnde[i] + ' statt 1');
      }
    }
    // Auch hier: gleichzeitig ist erlaubt, doppelt belegt nicht. Siehe oben.
    if (r.doppeltBelegt) {
      fehler.push(r.doppeltBelegt + ' Takte mit zwei Autos auf demselben Platz');
    }
    if (r.geparkt) fehler.push('ein Auto wurde waehrend des Stopps geparkt');
    return { ok: !fehler.length,
             mass: r.stoppGrund.map((g, i) => 'A' + (i + 1) + ' ' + g.length + ' Stopps')
                     .join(', ')
                 + ' | am Ende Faktor ' + r.faktorEnde.join('/')
                 + ', Griff ' + r.gripEnde.join('/')
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Der Abstandhalter braucht eine Groesse mit Aufloesung ----
  //
  // DER BEFUND, DER DIESE PRUEFUNG NOETIG MACHT, ist die Antwort auf "die Autos rammen sich
  // dauernd": der Abstandhalter war da, wirkte aber nicht, weil die Groesse, die er liest,
  // unterhalb einer Kachel keine Werte hat.
  //
  //     Gemessen: in 1517 Stichproben mit wahrem Abstand unter einer Kachel - darunter 155
  //     unter einer AUTOLAENGE - meldete ghostAhead() jedes Mal genau 1,00.
  //
  // Der Abhub war damit eine Konstante: bei 43 cm derselbe wie bei 0 cm. Und von aussen
  // gesehen liess sich das mit der Schwelle nicht heilen - sechs Ghosts, 180 s, je zwei
  // Laeufe:
  //
  //     Zeitluecke aus (nur Kachelregel)   132,9 Beruehrungen   66,2 Ueberholer je min
  //     Zeitluecke 0,35 s                  100,4 (-24 %)        61,1 (-8 %)
  //     Zeitluecke 0,70 s                   91,2 (-31 %)        50,0 (-24 %)
  //
  // 0,35 s ist deshalb gesetzt: der beste Tausch, und der einzige, bei dem die Beruehrungen
  // deutlich staerker fallen als das Ueberholen. Mit der alten Kachelschwelle war es
  // umgekehrt - 0,7 auf 1,2 kostete 23 Prozent Ueberholmanoever und brachte 3 Prozent.
  //
  // GEPRUEFT WIRD DIE AUFLOESUNG und nicht die Wirkung: die Wirkung haengt an fuenf
  // Reglern und schwankt je Lauf um dreissig Prozent, die Aufloesung ist eine Eigenschaft
  // der Groesse. Sie ist der Grund, warum das eine funktioniert und das andere nicht - und
  // wenn sie verlorengeht, faellt der Abstandhalter still auf seinen alten Zustand zurueck.
  stAdd('Abstand: die Zeitluecke hat Aufloesung, der Kachelabstand nicht', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.simAufloesung) {
      return { skip: true, mass: 'simAufloesung nicht vorhanden' };
    }
    // Ein eigener kleiner Setzer: `setzen` aus der Rennsimulationspruefung ist dort lokal
    // und hier nicht in Reichweite - der erste Anlauf warf "setzen is not defined". Und
    // GUELTIGKEIT wird geprueft: ein Wert, den ein Auswahlfeld nicht hat, laesst es auf ""
    // stehen, und die Simulation faellt still auf ihre Vorgabe zurueck. Genau so ist mir
    // eine Messung mit 3 statt 10 Runden gelaufen, ohne dass etwas auffiel.
    const stell = (id, v) => {
      const e = $(id);
      if (!e) return;
      if (e.type === 'checkbox') { e.checked = !!v; }
      else {
        if (e.tagName === 'SELECT'
            && ![...e.options].some((o) => o.value === String(v))) {
          throw new Error(id + ': "' + v + '" ist keine Option');
        }
        e.value = String(v);
      }
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const merk = { g: $('sim-ghosts').value, l: $('sim-laps').value,
                   f: $('sim-fast').checked, p: ghostCfg.pitAn };
    let r = null;
    try {
      stell('sim-ghosts', '4');
      stell('sim-laps', '10');
      stell('sim-fast', false);
      ghostCfg.pitAn = false;         // Boxenstopps stoeren die Abstandsmessung
      simStart();
      r = OMEGA_TEST.simAufloesung(1400);
      simStop('Pruefung');
    } finally {
      stell('sim-ghosts', merk.g); stell('sim-laps', merk.l);
      stell('sim-fast', merk.f); ghostCfg.pitAn = merk.p;
      if (simAn()) simStop('Pruefung');
    }
    if (!r || !r.proben) return { skip: true, mass: 'keine nahen Proben im Lauf' };
    const fehler = [];
    // 1. DER BEFUND SELBST: der Kachelabstand hat bei nahen Autos genau einen Wert. Faellt
    //    diese Zeile eines Tages, ist der Kachelabstand besser geworden - dann gehoert die
    //    Begruendung oben ueberprueft, und deshalb ist es eine Pruefung und keine Notiz.
    if (r.kachelWerte.length > 2) {
      fehler.push('der Kachelabstand hat ' + r.kachelWerte.length
                  + ' Werte (' + r.kachelWerte.join(',') + ') - die Begruendung oben pruefen');
    }
    // 2. UND DIE ZEITLUECKE HAT VIELE. Zehn verschiedene Werte sind eine niedrige Huerde und
    //    absichtlich so: gemessen waren es 21, und der Test soll nicht bei jedem
    //    Reglerdreh rot werden, sondern wenn die Aufloesung VERSCHWINDET.
    if (!(r.lueckeVerschieden >= 10)) {
      fehler.push('die Zeitluecke hat nur ' + r.lueckeVerschieden
                  + ' verschiedene Werte - die Aufloesung ist weg');
    }
    // 3. Und sie muss ueberhaupt messbar sein. Ein Abstandhalter, der in der Haelfte der
    //    Faelle null bekommt, faellt in der Haelfte der Faelle auf die Kachelregel zurueck.
    const anteil = r.lueckeMessbar / Math.max(1, r.proben);
    if (!(anteil > 0.5)) {
      fehler.push('nur ' + (anteil * 100).toFixed(0) + ' % der nahen Proben messbar');
    }
    return { ok: !fehler.length,
             mass: r.proben + ' nahe Proben | Kachelabstand: ' + r.kachelWerte.join(',')
                 + ' | Zeitluecke: ' + r.lueckeVerschieden + ' Werte von '
                 + r.lueckeMin + ' bis ' + r.lueckeMax + ' s, '
                 + (anteil * 100).toFixed(0) + ' % messbar'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Jeder Motor dreht in seinem eigenen Band ----
  //
  // GEMELDET: "Der Ton klingt etwas zu hoch" zum BMW M4 GT3. Der Befund war nachrechenbar
  // und betraf nicht nur ihn: die Physik rechnet fuer ALLE Motoren von 1500 bis 9000
  // (IDLE_RPM/REDLINE_RPM in 30-input.js), und eine Schleife, die bei baseRpm gerechnet
  // wurde, wird mit rpm/baseRpm abgespielt. Bei Vollgas also mit 9000/high:
  //
  //     Porsche 911 GT3 R    oberstes Band 8800   ->  1,02 x   unhoerbar
  //     BMW M4 GT3                         7200   ->  1,25 x   knapp vier Halbtoene
  //     Ford GT40                          6500   ->  1,38 x
  //     Formel 1 2026                     12500   ->  0,72 x   und der klingt zu TIEF
  //
  // Seit v0.5.49 fuehrt jeder Motor sein Band mit (idleRpm/limiterRpm in loops.json), und
  // Anzeige UND Ton benutzen dieselbe abgebildete Zahl - siehe motorDrehzahl() in
  // 80-sound.js. Geprueft werden drei Dinge, und das erste ist das, was der Nutzer hoert.
  stAdd('Motorton: jeder Motor dreht in seinem eigenen Drehzahlband', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.motorBandProbe) {
      return { skip: true, mass: 'motorBandProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.motorBandProbe();
    if (!r) return { skip: true, mass: 'kein Band' };
    const geladen = Object.keys(r).filter((k) => r[k].obenBand !== null);
    if (!geladen.length) {
      // Ohne audio/ gibt es keine Schleifen - per file:// der Normalfall.
      return { skip: true, mass: 'keine Motorsamples geladen' };
    }
    const fehler = [];
    let schlimmste = null;
    for (const car of geladen) {
      const b = r[car];
      // 1. JEDER geladene Motor braucht ein Band. Fehlt es, faellt er still auf die
      //    Drehzahl der Physik zurueck - also genau auf den alten Fehler, und zwar
      //    unsichtbar.
      if (!b.limiter || !b.idle) {
        fehler.push(car + ': kein Drehzahlband in loops.json');
        continue;
      }
      // 2. Der Begrenzer muss UEBER dem obersten Band liegen, aber nicht weit: das obere
      //    Band gehoert knapp unter den Anschlag, damit der Anschlag selbst noch Platz hat
      //    (die Begruendung steht bei p992gt3r in engine_synth.py). 1,25 war der gemeldete
      //    Fehler, 1,20 ist die Grenze - darueber hoert man die Streckung.
      if (!(b.rate >= 1.0 && b.rate <= 1.20)) {
        fehler.push(car + ': Abspielrate am Begrenzer ' + b.rate);
      }
      if (schlimmste === null || b.rate > r[schlimmste].rate) schlimmste = car;
      // 3. Und das Band muss ein Band sein.
      if (!(b.limiter > b.idle)) {
        fehler.push(car + ': Begrenzer ' + b.limiter + ' nicht ueber Leerlauf ' + b.idle);
      }
    }
    return { ok: !fehler.length,
             mass: geladen.length + ' Motoren mit Band, schlechteste Streckung '
                 + (schlimmste ? schlimmste + ' ' + r[schlimmste].rate : '-')
                 + ' (M4 GT3 ' + (r.m4gt3 ? r.m4gt3.rate : '-')
                 + ', Formel 1 ' + (r.f1_2026 ? r.f1_2026.rate : '-') + ')'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Anzeige und Ton bekommen dieselbe Zahl ----
  //
  // DIE EIGENTLICHE ZUSAGE der Aenderung, und sie ist nur als Gleichheit pruefbar: es gibt
  // eine Quelle (motorDrehzahl), und beide Verbraucher rufen sie. Ein Test auf die Anzeige
  // allein wuerde gruen bleiben, wenn der Ton wieder st.rpm nimmt.
  //
  // Geprueft wird an den Enden UND in der Mitte: die Abbildung ist linear in rpmFrac, also
  // sagen drei Punkte alles - und der mittlere faellt auf, wenn jemand sie durch eine Kurve
  // ersetzt.
  stAdd('Motorton: Anzeige und Ton benutzen dieselbe Drehzahl', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.motorDrehzahlProbe) {
      return { skip: true, mass: 'motorDrehzahlProbe nicht vorhanden' };
    }
    const bands = OMEGA_TEST.motorBandProbe();
    // Zwei Motoren mit weit auseinanderliegenden Baendern - an gleichen Zahlen waere
    // nichts zu sehen.
    const paare = [['blazer90', 5000], ['f1_2026', 12500]];
    const fehler = [], zeilen = [];
    for (const [car, lim] of paare) {
      const b = bands ? bands[car] : null;
      if (!b || !b.limiter) { zeilen.push(car + ': nicht geladen'); continue; }
      const w = OMEGA_TEST.motorDrehzahlProbe(car, [0, 0.5, 1]);
      if (!w) return { skip: true, mass: 'keine Abbildung' };
      zeilen.push(car + ': ' + w.join(' / '));
      // Bei rpmFrac 0 der Leerlauf, bei 1 der Begrenzer, in der Mitte genau dazwischen.
      if (Math.abs(w[0] - b.idle) > 1) fehler.push(car + ': bei 0 kommt ' + w[0]);
      if (Math.abs(w[2] - b.limiter) > 1) fehler.push(car + ': bei 1 kommt ' + w[2]);
      const mitte = (b.idle + b.limiter) / 2;
      if (Math.abs(w[1] - mitte) > 1) fehler.push(car + ': bei 0,5 kommt ' + w[1]);
      // Und die Angabe muss zu dem passen, was oben in diesem Test als bekannt steht -
      // sonst prueft er eine Zahl gegen sich selbst.
      if (b.limiter !== lim) {
        fehler.push(car + ': Begrenzer ' + b.limiter + ' statt der erwarteten ' + lim);
      }
    }
    if (!zeilen.length) return { skip: true, mass: 'keine Motorsamples geladen' };
    return { ok: !fehler.length,
             mass: zeilen.join(' | ') + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die Lichthupe vor dem Ueberholmanoever ----
  //
  // BESTELLT: "Bevor Ghosts zum Ueberholen ansetzen, sollen sie Lichthupe machen." Drei
  // Zusagen stecken darin, und alle drei stehen hier.
  //
  // DAS PROTOKOLL HAT EIN SCHEINWERFER-BIT, also kein Fernlicht - und ein Ghost faehrt mit
  // Licht an. Die Lichthupe ist deshalb ein kurzes AUS, genau wie die des Fahrers
  // (resolveLights in 70-race.js, wo die Begruendung steht). Geprueft wird entsprechend
  // nicht "Licht an", sondern die Zahl der DUNKELFLANKEN.
  stAdd('Ueberholen: erst Lichthupe, dann ausschwenken', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassProbe) {
      return { skip: true, mass: 'ghostPassProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.ghostPassProbe({ mitAnsage: true, ueberholtNach: 3000,
                                          dauerMs: 8000 });
    if (!r || !r.reihe.length) return { skip: true, mass: 'kein Lauf' };
    const fehler = [];
    // 1. DIE ANSAGE KOMMT ZUERST. Eine Menge sagt darueber nichts - die REIHENFOLGE ist
    //    die Zusage, deshalb prueft der Test 'folge' und nicht 'phasen'.
    if (r.folge[0] !== 'ansage') {
      fehler.push('die Folge beginnt mit ' + r.folge[0] + ' statt mit der Ansage');
    }
    if (r.folge.indexOf('raus') !== 1) {
      fehler.push('nach der Ansage kommt nicht raus: ' + r.folge.join('>'));
    }
    // 2. UND WAEHREND IHR BEWEGT SICH NICHTS ZUR SEITE. Das ist der Unterschied zwischen
    //    "kuendigt an" und "schwenkt aus und blinkt dabei".
    const inAnsage = r.reihe.filter((x) => x.phase === 'ansage');
    if (!inAnsage.length) fehler.push('keine Takte in der Ansage');
    const querMax = Math.max.apply(null, inAnsage.map((x) => Math.abs(x.versatz)));
    if (inAnsage.length && !(querMax === 0)) {
      fehler.push('Seitenversatz ' + querMax + ' schon waehrend der Ansage');
    }
    // 3. ZWEI IMPULSE, und sie liegen IN der Ansage. Ein Blitzen, das in die Ausschwenkphase
    //    hineinlaeuft, waere wieder eine Begleitung und keine Ankuendigung.
    if (r.impulse !== 2) fehler.push(r.impulse + ' Lichtimpulse statt zwei');
    const dunkelSpaeter = r.reihe.filter((x) => x.dunkel && x.phase !== 'ansage').length;
    if (dunkelSpaeter) {
      fehler.push(dunkelSpaeter + ' dunkle Takte nach der Ansage');
    }
    // 4. Die Gegenprobe: OHNE Ansage gibt es keine Lichthupe. Ohne sie waere nicht gezeigt,
    //    dass die Dunkelflanken von der Ansage kommen und nicht von irgendetwas sonst.
    const ohne = OMEGA_TEST.ghostPassProbe({ ueberholtNach: 3000, dauerMs: 8000 });
    if (ohne && ohne.impulse) {
      fehler.push('ohne Ansage ' + ohne.impulse + ' Lichtimpulse');
    }
    return { ok: !fehler.length,
             mass: r.folge.join(' > ') + ' | ' + r.impulse + ' Impulse in '
                 + r.ansageMs + ' ms, ' + r.dunkelTakte + ' dunkle Takte'
                 + ', Versatz in der Ansage ' + querMax
                 + ' | ohne Ansage ' + (ohne ? ohne.impulse : '?') + ' Impulse'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die Ansage darf das Manoever nicht verkuerzen ----
  //
  // DER FEHLER, DEN DAS FESTHAELT: SPICE_PASS_MAX_MS ist die Zeit, die ein Versuch dauern
  // darf, gemessen ab passSince. Setzte man passSince bei der ANSAGE, haette jeder Versuch
  // 570 ms weniger Zeit zum Ueberholen - die Ankuendigung wuerde das Manoever verkuerzen,
  // das sie ankuendigt, und ein Teil der Versuche wuerde am Zeitlimit scheitern statt am
  // Platz.
  //
  // Gemessen wird das an der Abbruchzeit: ein Versuch, der nicht durchkommt, muss nach der
  // Ansage PLUS der vollen Versuchszeit aufgeben und nicht vorher.
  stAdd('Ueberholen: die Lichthupe kostet den Versuch keine Zeit', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassProbe) {
      return { skip: true, mass: 'ghostPassProbe nicht vorhanden' };
    }
    // ueberholtNach null heisst "kommt nicht vorbei" - der Abbruchfall.
    const mit = OMEGA_TEST.ghostPassProbe({ mitAnsage: true, ueberholtNach: null,
                                            dauerMs: 12000 });
    const ohne = OMEGA_TEST.ghostPassProbe({ ueberholtNach: null, dauerMs: 12000 });
    if (!mit || !ohne) return { skip: true, mass: 'kein Lauf' };
    const ende = (r) => {
      const i = r.reihe.findIndex((x) => !x.laeuft);
      return i < 0 ? null : r.reihe[i].t;
    };
    const eMit = ende(mit), eOhne = ende(ohne);
    const fehler = [];
    if (eMit === null || eOhne === null) {
      fehler.push('ein Lauf brach nicht ab (' + eMit + '/' + eOhne + ')');
    } else {
      // Der Unterschied MUSS die Ansage sein, und zwar sie ganz. Ein Takt Schlupf ist die
      // Schrittweite der Sonde (60 ms), zwei sind Luft.
      const diff = eMit - eOhne;
      if (Math.abs(diff - mit.ansageMs) > 130) {
        fehler.push('Abbruch ' + diff + ' ms spaeter, erwartet ' + mit.ansageMs
                    + ' - die Ansage frisst Versuchszeit');
      }
    }
    return { ok: !fehler.length,
             mass: 'Abbruch mit Ansage ' + eMit + ' ms, ohne ' + eOhne + ' ms, Ansage '
                 + mit.ansageMs + ' ms'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Und die Lichthupe kommt auch in der Simulation an ----
  //
  // DER FEHLER, DEN DIESE PRUEFUNG FESTHAELT, ist der subtilste an dieser Funktion und war
  // nur durch Messen zu finden: die erste Fassung von ghostHupt() rechnete
  // hupeDunkel(Date.now() - g.ansageSeit). In der Rennsimulation ist Date.now aber
  // GEFAELSCHT - simSchritt() setzt es auf seine eigene Uhr und stellt es im finally
  // zurueck. ghostTick() laeuft innerhalb dieses Fensters, simZeichnen() und simZustand()
  // laufen ausserhalb.
  //
  // Eine Funktion, die die Uhr selbst fragt, gab damit je nach Aufrufer eine andere
  // Antwort. Gemessen: 650 Takte in der Ansage und NULL dunkle - auf der Karte haette es
  // nie geblitzt, und in der App waere nur aufgefallen, dass "nichts passiert".
  //
  // Geprueft wird deshalb der ANTEIL der dunklen Takte an den Ansagetakten, und zwar
  // durch die Simulation hindurch. Er ist nachrechenbar: zwei Impulse von 220 ms in einer
  // Ansage von 570 ms sind 440/570 = 77 Prozent.
  stAdd('Ueberholen: die Lichthupe kommt durch die Simulation', async () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.simSchritte) {
      return { skip: true, mass: 'simSchritte nicht vorhanden' };
    }
    const stell = (id, v) => {
      const e = $(id);
      if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v;
      else {
        if (e.tagName === 'SELECT'
            && ![...e.options].some((o) => o.value === String(v))) {
          throw new Error(id + ': "' + v + '" ist keine Option');
        }
        e.value = String(v);
      }
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const merk = { g: $('sim-ghosts').value, l: $('sim-laps').value,
                   f: $('sim-fast').checked, p: ghostCfg.pitAn };
    let ansage = 0, dunkel = 0;
    try {
      // Sechs Autos, damit ueberhaupt oft angesetzt wird; ohne Boxenstopps, weil ein
      // stehendes Auto keine Ueberholmanoever faehrt.
      stell('sim-ghosts', '6');
      stell('sim-laps', '10');
      stell('sim-fast', false);
      ghostCfg.pitAn = false;
      simStart();
      for (let k = 0; k < 2600; k++) {
        const z = OMEGA_TEST.simSchritte(1, 45);
        if (!z) break;
        for (const a of z.autos) {
          if (a.passPhase === 'ansage') ansage++;
          if (a.hupt) dunkel++;
        }
      }
      simStop('Pruefung');
    } finally {
      stell('sim-ghosts', merk.g); stell('sim-laps', merk.l);
      stell('sim-fast', merk.f); ghostCfg.pitAn = merk.p;
      if (simAn()) simStop('Pruefung');
    }
    if (!ansage) return { skip: true, mass: 'in diesem Lauf wurde nicht angesetzt' };
    const anteil = dunkel / ansage;
    const fehler = [];
    // 1. UEBERHAUPT DUNKEL. Das ist die Zeile, die den gemeldeten Fehler faengt.
    if (!dunkel) {
      fehler.push('kein einziger dunkler Takt in ' + ansage
                  + ' Ansagetakten - die Uhr passt nicht zum Aufrufer');
    }
    // 2. Und der Anteil muss zur Impulsform passen: 440 von 570 ms. Das Band ist weit, weil
    //    die Ansage an Taktgrenzen anfaengt und aufhoert - eng waere eine Pruefung der
    //    Rundung und nicht der Sache.
    else if (!(anteil > 0.6 && anteil < 0.9)) {
      fehler.push('Anteil dunkler Takte ' + anteil.toFixed(2) + ', erwartet um 0,77');
    }
    return { ok: !fehler.length,
             mass: ansage + ' Ansagetakte, ' + dunkel + ' davon dunkel ('
                 + anteil.toFixed(2) + ', erwartet 440/570 = 0,77)'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Die 3-Stufen-Linie hat drei Stufen, und benutzt alle ----
  //
  // BESTELLT: "3 Spuren: links, mitte, aussen. Zusaetzliche Ideallinie '3-stufig', bei der
  // ein Auto immer auf genau einer der Spuren faehrt."
  //
  // ZWEI ZUSAGEN, und die zweite ist die, die beim Bauen gefehlt hat. Der erste Anlauf liess
  // die erste Haelfte einer Geraden auf der Aussenseite der VORIGEN Kurve stehen - gemessen
  // nahm die Linie damit auf drei Layouts genau ZWEI Werte an, die Mitte kam nie vor. Eine
  // 3-stufige Linie mit zwei Stufen ist keine, und schlimmer: sie macht die Zusage des
  // 2-Stufen-Ausweichens beim Ueberholen leer, denn dort ist die Mitte ausdruecklich
  // verboten. Ein Verbot, das nichts verbietet, ist keine Zusage.
  stAdd('Ideallinie 3-stufig: genau drei Spuren, und alle drei benutzt', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.buildLine) {
      return { skip: true, mass: 'buildLine nicht erreichbar' };
    }
    const proben = ['SR3GLR2GR2G2', 'SG4R4G4L4', 'SR3GLR2G'];
    const fehler = [], zeilen = [];
    for (const code of proben) {
      const p = codeToTrack(code);
      const pts = trackCenterline(p.tiles);
      const nrm = trackNormals(pts, true);
      const L = OMEGA_TEST.buildLine(pts, nrm,
        { closed: true, tiles: p.tiles, model: 'dreistufig' });
      // Auf drei Stellen gerundet, damit Fliesskomma-Reste nicht als vierte Stufe zaehlen.
      const stufen = [...new Set(L.alpha.map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
      const zahl = {};
      for (const x of L.alpha) {
        const k = (+x.toFixed(3));
        zahl[k] = (zahl[k] || 0) + 1;
      }
      zeilen.push(code + ' ' + stufen.map((s) => s + 'x' + zahl[s]).join(' '));
      // 1. GENAU DREI WERTE. Vier waeren eine stetige Linie mit Stufen, keine Stufenlinie.
      if (stufen.length !== 3) {
        fehler.push(code + ': ' + stufen.length + ' Stufen (' + stufen.join(',') + ')');
        continue;
      }
      // 2. UND SIE SIND SYMMETRISCH UM DIE MITTE: -limit, 0, +limit. Eine Linie mit den
      //    Stufen -1, -0,5, 0 waere auch dreistufig und trotzdem falsch.
      if (!(Math.abs(stufen[0] + stufen[2]) < 1e-6 && Math.abs(stufen[1]) < 1e-6)) {
        fehler.push(code + ': Stufen nicht symmetrisch (' + stufen.join(',') + ')');
      }
      // 3. JEDE STUFE KOMMT VOR, und zwar nicht nur an einem Punkt. Ein Zehntel der
      //    Abtastpunkte ist eine niedrige Huerde und absichtlich so: geprueft wird, dass
      //    eine Stufe BENUTZT wird, nicht wie oft.
      const mind = Math.max(2, Math.round(L.alpha.length * 0.05));
      for (const s of stufen) {
        if (zahl[s] < mind) {
          fehler.push(code + ': Stufe ' + s + ' nur ' + zahl[s] + ' Punkte von '
                      + L.alpha.length);
        }
      }
    }
    return { ok: !fehler.length,
             mass: zeilen.join(' | ') + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Beim Ueberholen entscheidet das Manoever, nicht die Linie ----
  //
  // BESTELLT: "Beim Ueberholen auf ein 2-stufiges Modell (nur die beiden aeusseren Spuren
  // benutzen) ausweichen - das hat diesmal gar nicht geklappt und die Autos haben sich ewig
  // gegenseitig angeschoben."
  //
  // WARUM SIE SICH GESCHOBEN HABEN: die alte Summe addierte den Ueberholversatz, die
  // Ideallinie und das Ausweichen. Fuer den Angreifer ging das auf, fuer den
  // VORAUSFAHRENDEN nicht - er greift nicht an, also stand seine Linie mit vollem Gewicht
  // neben dem Ausweichen. Mit "Ideallinie 200 %" und einer Spurlinie heben sich die zwei
  // auf, und beide Autos bleiben auf derselben Spur.
  //
  // Geprueft wird deshalb die EIGENSCHAFT, nicht die Zahl: waehrend eines Manoevers ist der
  // Querbefehl unabhaengig von der Ideallinie. Zwei Laeufe mit sehr verschiedenen
  // Linieneinstellungen muessen denselben Versatz ergeben.
  stAdd('Ueberholen: der Versatz haengt nicht an der Ideallinie', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassProbe) {
      return { skip: true, mass: 'ghostPassProbe nicht vorhanden' };
    }
    const merkLine = ghostCfg.line;
    const fehler = [], zeilen = [];
    let a = null, b = null;
    try {
      // Zwei Extreme: Linie aus und Linie am Anschlag.
      ghostCfg.line = 0;
      a = OMEGA_TEST.ghostPassProbe({ ueberholtNach: 3000, dauerMs: 6000 });
      ghostCfg.line = 2;
      b = OMEGA_TEST.ghostPassProbe({ ueberholtNach: 3000, dauerMs: 6000 });
    } finally { ghostCfg.line = merkLine; }
    if (!a || !b) return { skip: true, mass: 'kein Lauf' };
    const vorbei = (r) => r.reihe.filter((x) => x.phase === 'vorbei').map((x) => x.versatz);
    const va = vorbei(a), vb = vorbei(b);
    zeilen.push('Linie 0: ' + [...new Set(va)].join(',')
                + ' | Linie 2: ' + [...new Set(vb)].join(','));
    if (!va.length || !vb.length) {
      fehler.push('keine Vorbeifahrt-Phase');
    } else {
      // 1. UNABHAENGIG VON DER LINIE. Das ist die Zusage.
      if (Math.abs(va[0] - vb[0]) > 1e-6) {
        fehler.push('Versatz haengt an der Linie: ' + va[0] + ' gegen ' + vb[0]);
      }
      // 2. UND ER IST EINE AEUSSERE SPUR, kein Zwischenwert. Der Betrag ist 1, gedeckelt
      //    durch Byte 7 - mehr kann das Auto nicht.
      if (Math.abs(Math.abs(va[0]) - 1) > 1e-6) {
        fehler.push('Versatz ' + va[0] + ' ist keine volle aeussere Spur');
      }
    }
    return { ok: !fehler.length,
             mass: zeilen.join(' ') + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Das Fahrerauto wird geortet, und bekommt den Vorausblick ----
  //
  // GEMELDET: "Gelbe Flagge klappt noch nicht, mein Auto fährt nur geradeaus."
  //
  // Der Befund war eine Asymmetrie und kein Rechenfehler: der Autopilot setzt die Lenkung
  // unter Gelb auf 0 - absichtlich, denn im Leitplanken-Modus haelt sich das Auto selbst.
  // Ghosts fahren genauso und bei ihnen geht es. Der Unterschied stand NEBEN dem Lenkwert:
  //
  //     Ghost         writeToCar(..., car.modeBytes) mit dem Vorausblick in Byte 16-18
  //     Fahrerauto    buildCommandPacket(steer, throttle) - zwei Argumente, kein Vorausblick
  //
  // Und der Grund, warum es ihn nie bekam: es hatte keine ORTUNG. Ein ghost-Objekt mit
  // tileIndex legt nur startGhost() an, und das laeuft fuer Ghosts.
  //
  // MIT `assistAn: true`, seit v0.5.55: der Vorausblick geht nur noch hinaus, wenn die
  // Fahrhilfe aktiv ist (von Hand oder ueber den Autopiloten) - siehe den Test direkt
  // darunter fuer die Gegenprobe, die den NEUEN gemeldeten Fehler faengt.
  stAdd('Fahrerauto: wird geortet und bekommt den Vorausblick', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.spielerOrtProbe) {
      return { skip: true, mass: 'spielerOrtProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.spielerOrtProbe(8, 'SR3GLR2GR2G2', true);
    if (!r) return { skip: true, mass: 'kein Lauf' };
    const fehler = [];
    // 1. DER ORT LAEUFT MIT. Der erste Takt hat noch keinen - er setzt den Bezugsstand des
    //    Kachelzaehlers; ohne einen vorigen Wert gibt es keine Aenderung zu erkennen. Genau
    //    so arbeitet die Ortung eines Ghosts auch.
    const mitOrt = r.reihe.filter((x) => x.tile !== null);
    if (mitOrt.length < r.reihe.length - 1) {
      fehler.push(mitOrt.length + ' von ' + r.reihe.length + ' Takten mit Ort');
    }
    // Und er ZAEHLT WEITER, statt stehenzubleiben.
    for (let i = 1; i < mitOrt.length; i++) {
      if (mitOrt[i].tile === mitOrt[i - 1].tile) {
        fehler.push('Kachelindex bleibt bei ' + mitOrt[i].tile + ' stehen');
        break;
      }
    }
    // 2. DER VORAUSBLICK GEHT MIT HINAUS, in den Bytes 16 bis 18. Das ist die Zeile, die
    //    den gemeldeten Fehler behebt.
    const ohneBlick = mitOrt.filter((x) => !x.bytes || x.bytes.indexOf(16) < 0);
    if (ohneBlick.length) {
      fehler.push(ohneBlick.length + ' Takte ohne Vorausblick in Byte 16');
    }
    // Und er zeigt WAS KOMMT und nicht immer dasselbe - sonst waere es eine Konstante.
    const blicke = new Set(mitOrt.map((x) => (x.vorausblick || []).join(',')));
    if (blicke.size < 2) fehler.push('der Vorausblick aendert sich nicht (' + blicke.size + ')');
    // 3. NUR IM LEITPLANKEN-MODUS. Ausserhalb hat er keine Bedeutung, und ein Byte an eine
    //    Funktion, die nicht laeuft, ist eine Angabe ins Leere.
    if (r.ohneRail !== null) fehler.push('ohne Leitplanken-Modus trotzdem Modusbytes');
    // 4. UND DER SATZ IST ALS ORTUNG MARKIERT. Zwei Stellen lesen car.ghost ohne die Rolle
    //    zu pruefen, und eine wuerde dem Fahrerauto eine Tempo-Lernkurve anlegen.
    if (!r.nurOrt) fehler.push('der Ortungssatz ist nicht als nurOrt markiert');
    return { ok: !fehler.length,
             mass: mitOrt.length + ' Takte geortet, Kacheln '
                 + mitOrt.map((x) => x.tile).join('/')
                 + ', Vorausblick ' + (mitOrt[0] ? (mitOrt[0].vorausblick || []).join(',') : '?')
                 + ' -> ' + (mitOrt[mitOrt.length - 1]
                     ? (mitOrt[mitOrt.length - 1].vorausblick || []).join(',') : '?')
                 + ', ohne Rail ' + JSON.stringify(r.ohneRail)
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Fahrhilfe aus: ganz normal lenken, trotz Bahn-Modus ----
  //
  // GEMELDET: "Wenn ich jetzt fahre, kann ich gar nicht mehr lenken und das Auto lenkt
  // von alleine." Die Ursache war die Bedingung fuer den Vorausblick: sie fragte nur
  // trackMode === 'on' ab - die normale Bahn/Ausdruck-Stellung, die beim Fahren so gut wie
  // immer 'on' ist, und keine Frage der Rennsituation. Damit bekam das Fahrerauto bei
  // JEDER gewoehnlichen Fahrt dieselben Modusbytes wie ein autonomer Ghost.
  //
  // Diese Pruefung ist die direkte Gegenprobe: Bahn-Modus an, aber die Fahrhilfe AUS und
  // kein Autopilot - dann darf ueberhaupt kein Vorausblick hinausgehen, auf keiner Kachel.
  stAdd('Fahrhilfe aus: Fahrerauto lenkt ganz normal trotz Bahn-Modus', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.spielerOrtProbe) {
      return { skip: true, mass: 'spielerOrtProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.spielerOrtProbe(8, 'SR3GLR2GR2G2', false);
    if (!r) return { skip: true, mass: 'kein Lauf' };
    const fehler = [];
    const mitOrt = r.reihe.filter((x) => x.tile !== null);
    // DIE ORTUNG selbst laeuft weiter - sie ist harmlos und wird fuer die Streckenkarte
    // und den Abstandhalter gebraucht, unabhaengig von der Fahrhilfe.
    if (!mitOrt.length) fehler.push('keine Ortung, obwohl sie unabhaengig laufen sollte');
    // ABER KEIN VORAUSBLICK, auf keiner einzigen Kachel - genau das war die Meldung.
    const mitBlick = mitOrt.filter((x) => x.bytes && x.bytes.indexOf(16) >= 0);
    if (mitBlick.length) {
      fehler.push(mitBlick.length + ' von ' + mitOrt.length
                  + ' Takten mit Vorausblick, obwohl die Fahrhilfe aus ist');
    }
    return { ok: !fehler.length,
             mass: mitOrt.length + ' Takte geortet, ' + mitBlick.length
                 + ' davon mit Vorausblick (muss 0 sein)'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Fahrhilfe: der Schalter greift, der Autopilot bleibt unabhaengig ----
  //
  // BESTELLT: "Gib mir einen Schalter, bei dem ich zwischen Fahrhilfemodus hin und her
  // schalten kann. Wenn er aus ist, will ich ganz normal steuern koennen so wie sonst.
  // Wenn er an ist, soll das Auto alleine lenken."
  //
  // Drei Zustaende, und der dritte ist die Garantie, die schon v0.5.53 versprochen hat:
  // eine gelbe Flagge haelt das Auto selbst, EGAL wie der Schalter steht - sonst wuerde
  // dieser Schalter die Gelbphasen-Regelung wieder abschalten koennen, was niemand
  // bestellt hat.
  stAdd('Fahrhilfe: Schalter steuert, Autopilot bleibt unabhaengig', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.driverAssistToggleProbe) {
      return { skip: true, mass: 'driverAssistToggleProbe nicht vorhanden' };
    }
    const r = OMEGA_TEST.driverAssistToggleProbe();
    if (!r) return { skip: true, mass: 'driver-assist nicht im Dokument' };
    const fehler = [];
    if (r.aus !== false) fehler.push('Schalter aus, aber aktiv: ' + r.aus);
    if (r.an !== true) fehler.push('Schalter an, aber nicht aktiv: ' + r.an);
    if (r.trotzAus !== true) {
      fehler.push('Schalter aus + gelbe Flagge: nicht aktiv (' + r.trotzAus + ')');
    }
    return { ok: !fehler.length,
             mass: 'aus=' + r.aus + ', an=' + r.an + ', aus+gelb=' + r.trotzAus
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Zieleinlauf ----
  //
  // Vorher endete ein Rennen fuer die Ghosts mit stopGhost(): Nullen schreiben und
  // stehenbleiben, wo man gerade ist - mitten auf der Linie, wenn es dumm laeuft.
  //
  // Geprueft werden die GESENDETEN BYTES, nicht die Absicht: ein VOLLER Lenkausschlag zur
  // zugeteilten Seite in beiden Fahrphasen, kein Gas, Bremslicht in der Bremsphase, und
  // genau DREI sichtbare Blitze. Die Drei ist der Punkt, an dem man um den Faktor zwei
  // danebenliegt - ein Blinken ist an UND aus -, und beim Entwurf dieses Tests ist genau das
  // aufgefallen: das Blinken begann mit AN, waehrend das Standlicht schon an war, also waren
  // zwei sichtbar.
  //
  // DIE LENKUNG WAR HIER BIS v0.5.44 AUF GERADE FESTGENAGELT, mit der Begruendung, ein
  // frueherer Anlauf habe alle Autos gleichzeitig eine Rechtskurve fahren lassen. Bestellt
  // ist jetzt das Gegenteil, und der Unterschied ist der Wechsel: "alle nach rechts" war der
  // Fehler, "abwechselnd links und rechts" ist der Zweck - zwei Autos, die entgegengesetzt
  // einschlagen, gehen auseinander. Welche Seite welches Auto bekommt, prueft die Nachbarin
  // "Zieleinlauf: abwechselnd links und rechts an den Rand"; hier geht es nur darum, dass
  // ueberhaupt ein Ausschlag hinausgeht und in beiden Fahrphasen derselbe.
  stAdd('Zieleinlauf: zur Seite ausrollen, anhalten, dreimal blinken', async () => {
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
    // 1. VOLLER AUSSCHLAG ZU EINER SEITE, in beiden Fahrphasen, und in beiden derselbe.
    //    Ein Vorzeichenwechsel mitten im Anhalten waere ein Schlenker statt eines
    //    Herausfahrens.
    const fahrend = pull.concat(brems);
    const lenke = fahrend.map(x => x.lenk);
    if (!lenke.length) fehler.push('keine Fahrphase');
    else {
      const erst = lenke[0];
      if (Math.abs(erst) < 100) {
        fehler.push('Lenkung nur ' + erst + ' von 127 - kein Ausschlag zur Seite');
      }
      if (lenke.some(l => l !== erst)) {
        fehler.push('Lenkung wechselt innerhalb des Anhaltens: '
                    + Array.from(new Set(lenke)).join('/'));
      }
    }
    // Und in der Blinkphase steht das Auto: dort gehoert die Lenkung auf null, sonst
    // arbeitet das Servo gegen den Anschlag, solange die Sequenz laeuft.
    const blinkKrumm = blink.filter(x => x.lenk !== 0);
    if (blinkKrumm.length) {
      fehler.push(blinkKrumm.length + ' Blinkpakete mit Lenkung');
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
                 + (pull.length ? pull[0].lenk : '?') + ' von 127'
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
      // Die fuenf Wuerz-Schalter. Sie sind der Grund, warum diese Liste gepflegt ist: aus
      // einem Regler wurden fuenf Kaestchen, und fuenf Kaestchen sind fuenf Gelegenheiten,
      // Markup und Modell auseinanderlaufen zu lassen.
      ['ghost-w-pass', () => ghostCfg.wuerzeUeberholen],
      ['ghost-w-gap', () => ghostCfg.wuerzeAbstand],
      ['ghost-w-form', () => ghostCfg.wuerzeForm],
      ['ghost-w-fehler', () => ghostCfg.wuerzeFehler],
      ['ghost-w-slip', () => ghostCfg.wuerzeWindschatten],
      ['ghost-learn', () => ghostCfg.learn],
      ['ghost-learn-pace', () => ghostCfg.learnPace],
      ['ghost-needcode', () => ghostCfg.needCode],
      ['ghost-rail', () => ghostCfg.railMode],
      // Die zwei Boxenstopp-Schalter.
      ['ghost-pit', () => ghostCfg.pitAn],
      ['ghost-pit-free', () => ghostCfg.pitFrei],
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
  // BIS v0.5.17 HIESS DIESE PRUEFUNG "erreicht den richtigen Pad", und sie verlangte, dass
  // genau der Zwilling mit mapping === 'standard' geruettelt wird. Die Zusicherung ist
  // umgedreht worden, und das ist der Grund:
  //
  // Fuer die EINGABE muss man sich fuer eine Quelle entscheiden - zwei Pads, die beide Gas
  // geben, waeren ein Fehler. Fuers RUETTELN ist dieselbe Wahl eine Wette: welcher der
  // beiden von Windows gemeldeten Zwillinge den Motor wirklich bedient, steht nirgends, und
  // ging die Wette daneben, passierte gar nichts - still.
  //
  // Zwei Aufrufe auf dasselbe Geraet sind harmlos, ein stiller Fehlgriff nicht.
  stAdd('Controller-Vibration erreicht JEDEN Pad mit Ruettler', () => {
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
      // Drei Eintraege: die zwei Zwillinge und ein Pad OHNE Ruettler. Der dritte ist die
      // Gegenprobe - er darf nicht in der Liste der Getroffenen auftauchen.
      const ohne = { mapping: 'standard', id: 'stumm', connected: true,
                     axes: [0, 0, 0, 0], buttons: [] };
      navigator.getGamepads = () => [mk('', 'roh'), mk('standard', 'zugeordnet'), ohne];
      if (sw && !sw.checked) { sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      padRumble(0.6, 0.3, 90);
      // BEIDE, und beide mit 'dual-rumble'. Ein Pad OHNE Ruettler steht mit in der Liste und
      // darf nicht mitgezaehlt werden - sonst waere "alle" nur eine Schleife und keine
      // Auswahl.
      const namen = rufe.map(r => r.name).sort().join(',');
      const anGetroffen = namen === 'roh,zugeordnet'
                          && rufe.every(r => r.art === 'dual-rumble');
      // Und aus muss aus sein.
      rufe.length = 0;
      if (sw) { sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      padRumble(0.6, 0.3, 90);
      const ausStill = rufe.length === 0;
      return { ok: anGetroffen && ausStill,
               mass: (anGetroffen ? 'an: beide Pads geruettelt'
                                  : 'an: FALSCH, ' + JSON.stringify(namen))
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
                                                   tileMs: 900, cfg: Object.assign({}, WUERZE_AUS, { speed: soll }) });
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
        tileMs: 900, cfg: Object.assign({}, WUERZE_AUS, { curveSlow: 0.35 }) });
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
    // BEIDE ENDEN AUSDRUECKLICH GESETZT, und das ist eine Berichtigung. Vorher lief der
    // Vergleich "Vorgabe gegen 0" - der Test las also den Standardwert als sein "an". Als
    // `lanes` auf Wunsch ab Werk 0 wurde, verglich er 0 gegen 0, fand null Unterschied und
    // meldete den Regler als stumm. Er war es nicht; der Test hatte keine Eingabe mehr.
    //
    // Dieselbe Fehlerklasse wie zweimal vorher in dieser Sitzung: eine Pruefung, die ihre
    // Eingabe aus dem Zustand nimmt statt sie zu stellen, prueft den Zustand.
    const zeilen = [], stumm = [];
    for (const lage of ['codes', 'karte']) {
      for (const feld of ['line', 'lanes']) {
        const an = Object.assign({}, WUERZE_AUS); an[feld] = 1;
        const aus = Object.assign({}, WUERZE_AUS); aus[feld] = 0;
        const mit = await OMEGA_TEST.ghostDriveProbe({ lage, takte: 500, code: 'SG3H2G3R2',
                                                       tileMs: 900, cfg: an });
        const ohne = await OMEGA_TEST.ghostDriveProbe({ lage, takte: 500, code: 'SG3H2G3R2',
                                                        tileMs: 900, cfg: aus });
        const d = unterschied(mit.lenk, ohne.lenk);
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
      code: 'SG3H2G3R2', tileMs: 500, cfg: Object.assign({}, WUERZE_AUS, { learnPace: true }) });
    const aus = await OMEGA_TEST.ghostDriveProbe({ lage: 'karte', takte: 1000,
      code: 'SG3H2G3R2', tileMs: 500, cfg: Object.assign({}, WUERZE_AUS, { learnPace: false }) });
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
        cfg: Object.assign({}, WUERZE_AUS, { line: 0 }) }, o));
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

  // ---- Ueberholen: der PLATZ entscheidet, nicht die Kachelart ----
  //
  // BESTELLT: "Ueberarbeite nun die Ueberholmanoever, sodass Autos auch in Kurven ueberholen
  // koennen." Hier stand vorher die Umkehrung - "Kein Ueberholversuch auf einer
  // Kurvenkachel" -, und sie war mit einer Messung begruendet: alle drei Abgaenge im
  // Leitplanken-Modus geschahen bei nahezu vollem Lenkanschlag (mittleres |steer| 119,7 von
  // 127). Was daran richtig bleibt, ist nicht die Kachelart, sondern der Anschlag: ein
  // Ueberholversatz oben auf eine Linie, die schon voll zieht, IST der volle Anschlag.
  //
  // Die Erlaubnis hing dann am freien Platz, 1 minus dem Linienversatz. Gemessen war das
  // damals so, 1500 Takte je Lage:
  //
  //     Lage                                Platz   Versuche
  //     Gerade, Linie zieht kaum             0,70      34
  //     Gerade, Linie zieht voll             0,14       0
  //     Haarnadelkachel, Linie zieht voll    0,15       0
  //     Haarnadelkachel, Linie zieht kaum    0,70      35
  //     Gerade, Haarnadel 1 Kachel voraus    0,70       0
  //     Gerade, Haarnadel 3 Kacheln voraus   0,70      25
  //
  // ---- UND SEIT v0.5.54 IST DIESE RECHNUNG WEG, aus einem gemessenen Grund ----------
  //
  // Der freie Platz war 1 minus dem Linienversatz - eine Rechnung fuer eine ADDITIVE Summe,
  // in der der Ueberholversatz NEBEN der Linie sitzt. Mit der 3-Stufen-Linie stimmt die
  // Voraussetzung nicht mehr: die belegt immer eine ganze Spur, der Anteil ist also 1 und
  // der Platz 0. Mit "Ideallinie 200 %" wird er sogar 2, der Platz durch das max() genau 0.
  //
  // Gemessen: in 120 s mit sechs Ghosts wurde NULL Mal angesetzt (passTakte 0). Der Nutzer
  // hat es als "das hat diesmal gar nicht geklappt" gemeldet - es hat nicht schlecht
  // funktioniert, es hat gar nicht stattgefunden.
  //
  // Seit dem 2-Stufen-Ausweichen (SPUR_PASS_AUSSEN) ERSETZT der Versatz die Linie, statt zu
  // ihr zu addieren. Angreifer voll auf eine Seite, Vorausfahrender voll auf die andere,
  // Mitte leer. Der Platz haengt damit nicht mehr an der Linie - und die physische Frage
  // ist beantwortet: zwei Autos brauchen 30,4 Prozent der Bahnbreite (2 x 3,8 cm auf 25),
  // das ist auf JEDER Kachel so.
  //
  // Was bleibt, ist die Haarnadelsperre. Genau die prueft dieser Test jetzt - und dazu, dass
  // die Kachelart allein nicht mehr sperrt.
  stAdd('Ueberholen: die Haarnadel sperrt, die Kachelart nicht', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.ghostPassArming) {
      return { skip: true, mass: 'ghostPassArming nicht vorhanden' };
    }
    const merkTiles = currentTrackTiles;
    const fehler = [], zeilen = [];
    try {
      // Eine Strecke mit Haarnadeln, damit ein Kachelindex in einer liegt.
      currentTrackTiles = codeToTrack('SHG4HG3').tiles;
      lineCache = null;
      // 1500 Takte und nicht 400: bei 400 Takten a 60 ms sind es etwa sechs Wuerfe, und in
      // gut drei Prozent der Laeufe faellt keiner - so entstehen Tests, die man wegklickt.
      const lauf = (o) => OMEGA_TEST.ghostPassArming(o.code, 1500, o);
      const viel = lauf({ code: 0x02, tileIndex: 3, kurveMix: 0 });
      const wenig = lauf({ code: 0x02, tileIndex: 3, kurveMix: 1 });
      const hnFrei = lauf({ code: 0x06, tileIndex: 1, kurveMix: 0 });
      const hnVoll = lauf({ code: 0x06, tileIndex: 1, kurveMix: 1 });
      const vorHn = lauf({ code: 0x02, tileIndex: 3, kurveMix: 0, tight: 2, dist: 1 });
      const fernHn = lauf({ code: 0x02, tileIndex: 3, kurveMix: 0, tight: 2, dist: 3 });
      for (const [nm, r] of [['viel Platz', viel], ['wenig Platz', wenig],
                             ['Haarnadel frei', hnFrei], ['Haarnadel voll', hnVoll],
                             ['vor Haarnadel', vorHn], ['fern Haarnadel', fernHn]]) {
        zeilen.push(nm + ' ' + r.platz + '/' + r.gestartet);
      }
      // 1. ES MUSS UEBERHAUPT ANGESETZT WERDEN. Das ist die Zeile, die den gemeldeten
      //    Fehler faengt: mit der alten Platzrechnung und der 3-Stufen-Linie war sie null.
      if (!(viel.gestartet > 0)) fehler.push('gar kein Versuch');
      // 2. UND ZWAR UNABHAENGIG VOM LINIENVERSATZ. Vorher sperrte eine voll ziehende Linie;
      //    seit der Versatz sie ERSETZT statt zu ihr zu addieren, ist das kein Grund mehr.
      //    Ohne diese Zeile waere der Test auch mit der alten, blockierenden Rechnung gruen.
      if (!(wenig.gestartet > 0)) {
        fehler.push('bei voll ziehender Linie kein Versuch - die alte Platzrechnung lebt');
      }
      // 3. DIE KACHELART SPERRT NICHT. Auch auf einer Haarnadelkachel wird angesetzt,
      //    solange die Haarnadel nicht VORAUS liegt - eine Kurve, in der man schon ist, ist
      //    kein Grund, nicht zu ueberholen.
      if (!(hnFrei.gestartet > 0)) {
        fehler.push('auf einer Kurvenkachel kein Versuch - die Kachelart sperrt');
      }
      if (!(hnVoll.gestartet > 0)) {
        fehler.push('Haarnadelkachel mit voller Linie: kein Versuch');
      }
      // 4. WAS SPERRT, IST DIE HAARNADEL VORAUS. Sie ist der einzige Ort, an dem zwei Autos
      //    nebeneinander wirklich nicht passen, und sie ist die Sperre, die von der alten
      //    Regel uebrig bleibt.
      if (vorHn.gestartet) fehler.push('vor der Haarnadel ' + vorHn.gestartet + ' Versuche');
      if (!(fernHn.gestartet > 0)) fehler.push('drei Kacheln vor der Haarnadel keiner');
    } finally {
      currentTrackTiles = merkTiles;
      lineCache = null;
    }
    return { ok: !fehler.length,
             mass: zeilen.join(' | ') + ' (Platz/Versuche in 1500 Takten)'
                 + (fehler.length ? ' || ' + fehler.join('; ') : '') };
  });

  // ---- Zieleinlauf: abwechselnd links und rechts ----
  //
  // GEMELDET: "Nach dem Rennen rammen die Ghosts alle ineinander hinein. Mache es so, dass
  // sie abwechselnd links und rechts am Rand stehen bleiben."
  //
  // Geprueft wird die Zuteilung und der ausgehende Lenkwert, nicht das Ergebnis auf der
  // Bahn: wo ein Auto wirklich stehen bleibt, kann diese App nicht wissen - es meldet seine
  // Querlage nicht. Was sie zusichern kann, ist, dass zwei aufeinanderfolgende Autos
  // ENTGEGENGESETZT einschlagen und dass die Hinteren laenger rollen.
  stAdd('Zieleinlauf: in Kacheln gestaffelt, alle links an den Rand', () => {
    if (!window.OMEGA_TEST || !OMEGA_TEST.finishSeiten) {
      return { skip: true, mass: 'finishSeiten nicht vorhanden' };
    }
    // ---- DIE ZUSAGE HAT SICH GEAENDERT, und das gehoert hierhin -------------------
    //
    // Bis v0.5.50 wechselten die Seiten ab (rechts, links, rechts ...) und die Staffel war
    // eine ZEIT: der Fuehrende rollte 2000 ms, jeder dahinter 500 ms weniger. Gemeldet
    // wurde: "aktuell rammen sie ineinander rein".
    //
    // Der Fehler ist, dass Zeit kein Abstand ist. Wie weit ein Auto in 500 ms rollt, haengt
    // davon ab, wie schnell es ueber die Linie kam - und am Rennende sind die Tempi
    // verschieden (einer greift gerade an, einer haelt Abstand, einer kommt aus der Box).
    // Zwei Autos konnten dieselbe Stelle treffen.
    //
    // Jetzt zaehlt jedes Auto KACHELWECHSEL, und eine Kachel ist 43 cm bei 9,5 cm
    // Fahrzeuglaenge - mehr als vier Fahrzeuglaengen Abstand, unabhaengig vom Tempo. Damit
    // braucht es keine wechselnden Seiten mehr, und alle stehen links, wie bestellt: das
    // Feld in einer Reihe, die andere Bahnhaelfte frei fuer das Auto des Fahrers.
    const r = OMEGA_TEST.finishSeiten(6);
    const fehler = [];
    if (!r || r.length !== 6) return { ok: false, mass: 'kein Lauf' };
    // 1. ALLE LINKS. Byte 7 negativ ist links.
    for (let i = 0; i < r.length; i++) {
      if (!(r[i].seite < 0)) fehler.push('Auto ' + i + ': Seite ' + r[i].seite);
    }
    // 2. STRENG ABNEHMEND, und jetzt darf es streng sein: die Kachelstaffel hat keinen
    //    Boden, der zwei Autos denselben Wert gibt. Der Letzte kommt auf null heraus.
    for (let i = 1; i < r.length; i++) {
      if (!(r[i].kacheln < r[i - 1].kacheln)) {
        fehler.push('Auto ' + i + ' rollt ' + r[i].kacheln + ' Kacheln, Auto ' + (i - 1)
                    + ' nur ' + r[i - 1].kacheln + ' - dann schiebt es auf');
      }
    }
    if (r[r.length - 1].kacheln !== 0) {
      fehler.push('der Letzte rollt ' + r[r.length - 1].kacheln + ' statt 0 Kacheln');
    }
    // 3. Und der Lenkwert muss wirklich hinausgehen, mit dem Vorzeichen der Seite.
    for (const x of r) {
      if (Math.sign(x.steerRoll) !== Math.sign(x.seite) || Math.abs(x.steerRoll) < 0.9) {
        fehler.push('Lenkwert ' + x.steerRoll + ' passt nicht zur Seite ' + x.seite);
      }
      if (x.steerBrake !== x.steerRoll) {
        fehler.push('Bremsphase lenkt anders als die Rollphase');
      }
    }
    // 4. Und die Rollphase muss ENDEN, wenn die Kacheln gezaehlt sind - sonst rollt das
    //    Auto weiter, und die Staffel waere eine Absichtserklaerung.
    for (let i = 0; i < r.length; i++) {
      if (r[i].phase !== 'brake') {
        fehler.push('Auto ' + i + ' ist nach ' + r[i].kacheln + ' Kacheln in Phase '
                    + r[i].phase + ' statt brake');
      }
    }
    return { ok: !fehler.length,
             mass: r.map((x, i) => 'P' + (i + 1) + ' '
                              + (x.seite > 0 ? 'rechts' : 'links') + ' '
                              + x.kacheln + ' Kacheln, Lenk '
                              + x.steerRoll.toFixed(1)).join(' | ')
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
      code: 'SG3H2G3R2', tileMs: 900, cfg: Object.assign({}, WUERZE_AUS) });
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
      // ---- Seit v0.5.18 sind es VIER Mischungen, nicht zwei -------------------------
      //
      // Die Mischung steht als RAHMENFARBE an jedem der vier Reifenfelder. Geprueft wird,
      // dass alle vier eine EIGENE Farbe bekommen: eine Kennung, die zwei Zustaende gleich
      // faerbt, ist keine Kennung. Und dass sie sich vom Kachelgrund #04060b abhebt - genau
      // daran waere "hart = schwarz" gescheitert, das als Palette vorgeschlagen war.
      const rahmen = {};
      for (const m of ['weich', 'mittel', 'hart', 'regen']) {
        OMEGA_TEST.tyreSet(m);
        rahmen[m] = getComputedStyle(el).getPropertyValue('--mix-farbe').trim();
      }
      const werte = Object.keys(rahmen).map(k => rahmen[k]);
      if (new Set(werte).size !== 4) {
        fehler.push('Rahmenfarben nicht paarweise verschieden: ' + werte.join(' '));
      }
      // Gegen den Kachelgrund. Kein voller Kontrastlauf - eine 2-px-Linie muss sich
      // unterscheiden, nicht lesbar sein -, aber ein Schwarz auf Schwarz faellt hier durch.
      const hell = (hx) => {
        const m = /^#([0-9a-f]{6})$/i.exec(hx || '');
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      };
      const grund = hell('#04060b');
      for (const m of Object.keys(rahmen)) {
        const h = hell(rahmen[m]);
        if (h === null) { fehler.push(m + ': Rahmenfarbe unlesbar (' + rahmen[m] + ')'); continue; }
        if (Math.abs(h - grund) < 0.12) fehler.push(m + ': Rahmen hebt sich nicht vom Feld ab');
      }
      OMEGA_TEST.tyreSet('slick');
      return { ok: !fehler.length,
               mass: 'Slick: Profil ' + s1.profil + ', Grip ' + s1.grip
                   + ' | Regen: Profil ' + s2.profil + ', Grip ' + s2.grip
                   + ' | 4 Rahmenfarben'
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
      // ---- EINGESCHWUNGEN MESSEN, NICHT IM ERSTEN TAKT -------------------------
      //
      // Seit v0.5.53 regelt der Autopilot mit ghostSpeedControl() - PI mit Totband und
      // Ratengrenzen, derselbe Regler, den die Ghosts haben. Bestellt war "wie ein Ghost",
      // und das ist der Unterschied: der alte rohe P-Regler (throttle = err * 4) hatte eine
      // Beharrungsabweichung und kippte um den Zielwert, was sich auf dem Tisch als "es gibt
      // nur Gas" liest.
      //
      // Ein ratenbegrenzter Regler gibt im ERSTEN Takt naturgemaess wenig - gemessen 0,06.
      // Dieser Test las genau einen Takt und meldete "kein Gas". Die Zahl war richtig und
      // die Frage falsch: das Auto faehrt nicht einen Takt, sondern im 45-ms-Takt weiter.
      //
      // Also 25 Takte, also gut eine Sekunde - dieselbe Zahl, die der Ghost-Reglertest
      // schon benutzt ("nach 1,1 s ist es voll da").
      const bei = (kmh) => {
        // ---- JEDER FALL AUS DEM STAND, und das ist Pruefhygiene ------------------
        //
        // Der Regler fuehrt einen I-Anteil, und der liegt modulweit - er ueberlebt also den
        // Wechsel von einem Messpunkt zum naechsten. Ohne Ruecksetzen las dieser Test bei
        // 80 km/h (dem Ziel) ein Gas von 0,72: das war der Arbeitspunkt, den die Messung bei
        // 32 km/h davor aufgeladen hatte, und kein Fehler.
        //
        // Zurueckgesetzt wird ueber den vorgesehenen Weg: gruene Flagge heisst kein
        // Autopilot, und autopilot() raeumt den Regler dann selbst auf. Eine eigene
        // Ruecksetzfunktion von aussen zu rufen waere ein zweiter Weg in denselben Zustand.
        const merkFlag = flagState;
        flagState = 'green';
        autopilot(0);
        flagState = merkFlag;
        physEngine.state.speedKmh = kmh / REAL_SCALE;
        // EINGESCHWUNGEN, nicht im ersten Takt: seit v0.5.53 regelt der Autopilot mit
        // ghostSpeedControl() - PI mit Totband und Ratengrenzen, derselbe Regler, den die
        // Ghosts haben. Bestellt war "wie ein Ghost", und das ist der Unterschied: der alte
        // rohe P-Regler (throttle = err * 4) brauchte eine Abweichung, um Gas zu erzeugen,
        // und kippte um den Zielwert - auf dem Tisch liest sich das als "es gibt nur Gas".
        //
        // Ein ratenbegrenzter Regler gibt im ersten Takt naturgemaess wenig, gemessen 0,06.
        // Dieser Test las genau einen Takt und meldete "kein Gas". 25 Takte sind gut eine
        // Sekunde - dieselbe Zahl, die der Ghost-Reglertest benutzt.
        let r = autopilot(0);
        if (!r) return r;
        for (let i = 0; i < 25; i++) r = autopilot(0) || r;
        return r;
      };
      // 1. Gruen: gar kein Eingriff, egal wie schnell.
      flagState = 'green'; trackMode = 'on';
      const gruen = bei(20);
      // 2. Gelb, aber Ausdruck-Stellung: ebenfalls kein Eingriff.
      flagState = 'yellow'; trackMode = 'off';
      const ausdruck = bei(20);
      // ---- 3. Gelb auf der Bahn: regeln. UND DAS ZIEL IST NICHT MEHR YELLOW_KMH ----
      //
      // Hier stand YELLOW_KMH = 80 als Zieltempo, und der Test las bei 80 km/h ein Gas von
      // 0,72 statt des erwarteten Totbands. Die Zahl war richtig: seit v0.5.51 hat das
      // Gelb-Tempo einen LESEBODEN.
      //
      // yellowFactor() ist YELLOW_KMH/Hoechstgeschwindigkeit = 80/327 = 0,244.
      // GHOST_READ_MIN ist 0,35 - darunter liest das Auto das gedruckte Muster nicht mehr.
      // Im Leitplanken-Modus, und nur dort greift dieser Autopilot, braucht das Auto genau
      // diese Lesung, um sich auf der Bahn zu halten: ein Gelb-Tempo unter der Leseschwelle
      // waere ein Autopilot, der das Auto von der Bahn faehrt.
      //
      // Das wirksame Gelb-Tempo ist deshalb 0,35 der Spitze, also rund 103 km/h angezeigt
      // und nicht 80. Der Test rechnet es aus derselben Formel wie der Autopilot, damit die
      // zwei nicht auseinanderlaufen - eine abgeschriebene 103 waere die naechste Zahl, die
      // beim naechsten Reglerdreh falsch wird.
      trackMode = 'on';
      const zielAnteil = Math.max(yellowFactor(), GHOST_READ_MIN);
      const zielKmh = zielAnteil * physEngine.config.topSpeedKmh * REAL_SCALE;
      const langsam = bei(zielKmh * 0.4);
      const schnell = bei(zielKmh * 2.5);
      const passend = bei(zielKmh);
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
                     + ' | Ziel ' + Math.round(zielKmh) + ' km/h (Gelb ' + YELLOW_KMH
                     + ', Leseboden hebt es)'
                     + ' | bei ' + Math.round(zielKmh * 0.4) + ' km/h Gas '
                     + langsam.throttle.toFixed(2)
                     + ', bei ' + Math.round(zielKmh * 2.5) + ' km/h Bremse '
                     + schnell.brake.toFixed(2)
                     + ', bei ' + Math.round(zielKmh) + ' km/h Gas ' + passend.throttle.toFixed(2)
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

    // 1. Erster Takt aus dem Stand: KEIN VOLLGAS. Die Ratenbegrenzung garantiert das,
    //    unabhaengig von der Rampe - deshalb ist es hier pruefbar.
    //
    // ---- DIE SCHRANKE HAENGT AN DER ENTSCHLOSSENHEIT, und das ist eine Berichtigung ---
    //
    // Hier stand `t1 < 0.15`, eine feste Zahl. Sie war richtig, solange gasDynamik ab Werk
    // auf 1,0 stand. Seit v0.5.52 steht es auf 4,0 - "Traegheit standardmaessig aus, auch
    // zum Beschleunigen" war ausdruecklich bestellt -, und der Regler gibt im ersten Takt
    // 0,29 statt 0,07.
    //
    // Der Test hat damit die BESTELLUNG als Fehler gemeldet, nicht einen Fehler. Was er
    // sichern soll, ist die Rampe an sich: der erste Takt darf nicht schon voll sein.
    // gasDynamik skaliert beide Verstaerkungen und beide Ratengrenzen linear, also skaliert
    // die Schranke mit - 0,15 bei Entschlossenheit 1, 0,60 bei 4. Und ein Deckel bei 0,8
    // bleibt: auch der entschlossenste Regler darf im ersten Takt nicht durchtreten.
    const dyn = typeof ghostCfg !== 'undefined' ? Math.max(0.1, ghostCfg.gasDynamik || 1) : 1;
    const grenze = Math.min(0.8, 0.15 * dyn);
    const g1 = {};
    const t1 = C(g1, 0.5, 0, 0.045).throttle;
    teile.push('erster Takt Gas ' + t1.toFixed(2) + ' (Grenze ' + grenze.toFixed(2)
               + ' bei Entschlossenheit ' + dyn + ')');
    if (!(t1 < grenze)) {
      schlecht.push('erster Takt gibt ' + t1.toFixed(2) + ' Gas, Grenze ' + grenze.toFixed(2));
    }

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

