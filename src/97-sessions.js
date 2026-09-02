  // ============================== SITZUNGSDATEN ==============================
  //
  // Bis v0.4 ueberlebte KEINE einzige Rundenzeit ein Neuladen. raceLapTimes, dashLapTimes und
  // car.race.laps waren einfache Variablen im Modulbereich; in chc.cars.v1 standen nur Farbe
  // und Name. Ein Neuladen - oder auch nur ein Verbindungsabbruch, weil garage im Speicher
  // lebt - verlor alles, und der CSV-Export war der einzige Weg, etwas zu retten. Man musste
  // also VOR dem Fahren wissen, dass man exportieren will.
  //
  // Drei Entscheidungen, die den Aufbau bestimmen:
  //
  // 1. GESCHRIEBEN WIRD AM RENNENDE, nicht laufend. Ein Schreibvorgang je Runde waere bei
  //    einem Zwei-Minuten-Rennen ein Dutzend Zugriffe auf localStorage, und localStorage ist
  //    synchron - es blockiert den Faden, der den 45-ms-Sendetakt haelt. Genau dieser Takt
  //    war schon einmal die Ursache fuer ruckelndes Fahren.
  //
  // 2. DIE ZAHL DER SITZUNGEN IST BEGRENZT. localStorage hat je Ursprung ein paar Megabyte,
  //    und eine unbegrenzte Liste laeuft irgendwann dagegen - dann schlaegt der naechste
  //    Schreibvorgang fehl, und zwar der, der gerade wichtig war. 200 Sitzungen sind bei
  //    dieser Groesse reichlich und kosten nach oben nichts.
  //
  // 3. GESPEICHERT WIRD JE GERAET, wie schon bei Farbe und Name. Verbindet man in anderer
  //    Reihenfolge, gehoeren die Kilometer weiter zum richtigen Auto.
  const SESSION_STORE = 'chc.sessions.v1';
  const SESSION_MAX = 200;

  function sessionStore() {
    try {
      const o = JSON.parse(localStorage.getItem(SESSION_STORE) || '{}');
      return { cars: o.cars || {}, sessions: Array.isArray(o.sessions) ? o.sessions : [] };
    } catch (e) { return { cars: {}, sessions: [] }; }
  }

  function sessionSave(o) {
    try {
      if (o.sessions.length > SESSION_MAX) {
        o.sessions = o.sessions.slice(-SESSION_MAX);
      }
      localStorage.setItem(SESSION_STORE, JSON.stringify(o));
      return true;
    } catch (e) {
      // Ein voller Speicher ist kein Grund, das Rennen zu verlieren - aber er ist ein Grund,
      // es zu SAGEN. Still zu scheitern waere hier das Schlimmste: man faehrt weiter und
      // merkt es erst, wenn man die Zahlen sucht.
      log('Sitzung konnte nicht gespeichert werden: ' + e.message, 'err');
      showHudToast('SPEICHER VOLL');
      return false;
    }
  }

  // ---- Gefahrene Strecke -------------------------------------------------------------
  //
  // ZWEI Zahlen, und beide sind interessant, weil sie verschiedene Fragen beantworten:
  //
  //   simKm   die Strecke im MASSSTAB, also was der Tacho behauptet. Das ist die Zahl, die
  //           zu einer Rundenzeit passt: eine Runde in 8 s bei 200 km/h angezeigt sind
  //           440 simulierte Meter.
  //   realKm  die Strecke, die das Modellauto wirklich auf dem Teppich gefahren ist. Bei
  //           REAL_SCALE 73,75 ist das ein 74stel davon, und es ist die Zahl, die etwas
  //           ueber Reifen und Getriebe sagt.
  //
  // Nur eine von beiden zu speichern waere eine willkuerliche Wahl, und die jeweils andere
  // liesse sich nicht rekonstruieren, ohne REAL_SCALE zu kennen.
  let simMeters = 0;
  let realMeters = 0;

  // Aufgerufen aus physicsStep(), also im Fahrtakt. Absichtlich ohne jeden Speicherzugriff -
  // hier wird nur gezaehlt, geschrieben wird am Rennende.
  function trackDistance(kmh, dt) {
    if (!(dt > 0) || !isFinite(kmh)) return;
    const v = Math.abs(kmh);
    realMeters += v / 3.6 * dt;
    simMeters += v * REAL_SCALE / 3.6 * dt;
  }

  function distanceSnapshot() {
    return { simKm: +(simMeters / 1000).toFixed(3),
             realKm: +(realMeters / 1000).toFixed(4) };
  }

  // ---- Eine Sitzung ablegen ----------------------------------------------------------
  //
  // Der Aufruf steht in finishRace(), also an der einen Stelle, an der ein Rennen wirklich
  // vorbei ist. Er greift auf raceAllCars() zu, also auf dieselbe Funktion, aus der auch
  // die Ergebnistabelle und der CSV-Export lesen - damit gibt es keine zweite Wahrheit
  // darueber, wer welche Runden gefahren hat.
  function sessionRecord() {
    const autos = raceAllCars().filter(c => c.laps.length);
    if (!autos.length) return null;
    const o = sessionStore();
    const weg = distanceSnapshot();

    // Die Strecke als CODE und nicht als Name: ein Name kann sich aendern oder fehlen, der
    // Code beschreibt das Layout und laesst es auf einem anderen Geraet wieder aufbauen.
    let strecke = '';
    try {
      strecke = (typeof trackToCode === 'function' && currentTrackTiles.length > 1)
        ? trackToCode(currentTrackTiles) : '';
    } catch (e) { strecke = ''; }

    const eintrag = {
      // ISO, weil es sortierbar und zeitzonenfest ist. Der Anzeigetext wird daraus
      // gerechnet und nicht mitgespeichert - sonst haette man zwei Wahrheiten ueber ein
      // Datum, und die eine waere in der Sprache von damals.
      zeit: new Date().toISOString(),
      modus: raceMode,
      limit: raceLimit,
      strecke,
      wetter: typeof weather !== 'undefined' ? weather : null,
      simKm: weg.simKm,
      realKm: weg.realKm,
      autos: autos.map(c => ({
        name: c.name, kennung: c.kennung, rolle: c.role,
        // Nur die Millisekunden, nicht die ganzen Objekte: die Rundennummer ist der Index
        // plus eins, und sie zweimal zu speichern ist die Gelegenheit, dass sie
        // auseinanderlaufen.
        laps: c.laps.map(l => l.ms),
        // Ereignisse je Runde, nur fuer das gesteuerte Auto: Boxenstopps und Crashs werden
        // fuer den Fahrer erfasst, nicht fuer die Ghosts. Bei denen bleibt das Feld leer,
        // und der Plot zeichnet sie dann ohne Markierungen - ehrlicher, als fehlende Daten
        // als "kein Stopp" zu zeigen.
        ereignisse: (c.role === 'player' && typeof raceLapEvents !== 'undefined')
          ? raceLapEvents.slice(0, c.laps.length) : [],
      })),
      // Die Zeitstrafe der Sitzung, als EINE Zahl. Sie wird am Rennende vergeben und
      // gehoert keiner Runde - im Plot steht sie deshalb in der Fussnote.
      strafeS: (typeof racePenaltyMs === 'function') ? Math.round(racePenaltyMs() / 1000) : null,
      // Die Abstimmung mit. Ohne sie ist eine Rundenzeit eine Zahl ohne Bedingungen, und
      // dann kann man zwei Sitzungen nicht vergleichen.
      einstellungen: (typeof presetRead === 'function') ? presetRead() : null,
    };
    o.sessions.push(eintrag);

    // Und die Summen je Auto. Sie stehen NEBEN den Sitzungen und werden nicht daraus
    // gerechnet: die Sitzungsliste ist begrenzt, die Summen sollen es nicht sein.
    for (const c of autos) {
      const auto = garage.find(g => garageLabel(g) === c.name);
      const id = auto ? String(auto.device.id) : ('name:' + c.name);
      const e = o.cars[id] || { name: c.name, km: 0, realKm: 0, runden: 0, besteMs: null,
                                sitzungen: 0 };
      e.name = c.name;
      e.runden += c.laps.length;
      e.sitzungen += 1;
      // Die Strecke wird auf ALLE Autos gebucht, weil nur das Fahrerauto eine Physik hat und
      // die Ghosts dieselbe Runde fahren. Das ist eine Naeherung, und sie steht hier als
      // solche: ein Ghost fuhr nicht genau dieselbe Linie.
      e.km = +(e.km + weg.simKm).toFixed(3);
      e.realKm = +(e.realKm + weg.realKm).toFixed(4);
      const beste = Math.min.apply(null, c.laps.map(l => l.ms));
      if (e.besteMs === null || beste < e.besteMs) e.besteMs = beste;
      o.cars[id] = e;
    }

    if (!sessionSave(o)) return null;
    simMeters = 0;
    realMeters = 0;
    log('Sitzung gespeichert: ' + autos.length + ' Auto'
        + (autos.length === 1 ? '' : 's') + ', '
        + autos.reduce((a, c) => a + c.laps.length, 0) + ' Runden, '
        + weg.simKm.toFixed(1) + ' km simuliert ('
        + (weg.realKm * 1000).toFixed(0) + ' m auf dem Teppich).', 'ok');
    return eintrag;
  }

  // ---- Anzeige -----------------------------------------------------------------------
  function sessionFmt(ms) { return (ms / 1000).toFixed(2) + 's'; }

  // ---- Rundenzeit-Plot ----------------------------------------------------------------
  //
  // BALKEN und keine Linie: eine Runde ist eine abgeschlossene Einheit, keine stetige
  // Groesse. Eine Linie zwischen zwei Runden behauptet Zwischenwerte, die es nicht gibt.
  //
  // DIE Y-ACHSE BEGINNT NICHT BEI NULL, und das ist eine Entscheidung mit Begruendung: bei
  // null gestaucht sehen alle Runden gleich hoch aus, und der Unterschied zwischen 12,1 und
  // 12,8 Sekunden ist genau das, was interessiert. Die Achse ist beschriftet, damit die
  // Stauchung sichtbar ist und nicht taeuscht - eine unbeschriftete abgeschnittene Achse
  // waere eine Luege.
  //
  // ALS SVG und nicht als Canvas: es skaliert mit der Blattbreite, laesst sich mit den
  // Augen pruefen, und es gibt kein zweites Zeichensystem in diesem Projekt.
  function plotAufbauen(sitzung, autoName) {
    const host = $('sess-plot');
    const note = $('sess-plot-note');
    if (!host) return;
    if (!sitzung) {
      host.innerHTML = '';
      if (note) note.textContent = t('Noch keine Sitzung aufgezeichnet.');
      return;
    }
    const auto = (sitzung.autos || []).find(a => a.name === autoName)
              || (sitzung.autos || [])[0];
    const zeiten = (auto && auto.laps) || [];
    if (zeiten.length < 1) {
      host.innerHTML = '';
      if (note) note.textContent = t('Diese Sitzung hat keine gemessenen Runden.');
      return;
    }
    const ev = (auto && auto.ereignisse) || [];
    const beste = Math.min.apply(null, zeiten);
    const schlecht = Math.max.apply(null, zeiten);
    // Untere Kante etwas UNTER der besten Runde, obere etwas ueber der langsamsten: sonst
    // klebt der schnellste Balken auf der Achse und der langsamste am Rand.
    const spanne = Math.max(1, schlecht - beste);
    const yMin = Math.max(0, beste - spanne * 0.25);
    const yMax = schlecht + spanne * 0.18;
    const B = 34, hoehe = 150, links = 52, oben = 22, unten = 26;
    const breite = links + zeiten.length * B + 14;
    const yPos = (ms) => oben + (yMax - ms) / (yMax - yMin) * hoehe;
    const teile = [];
    teile.push('<svg viewBox="0 0 ' + breite + ' ' + (oben + hoehe + unten)
               // width:100% streckte die SVG auf die Blattbreite und height:auto zog die
               // Hoehe mit - aus 198 Einheiten wurden ueber 500 Pixel. Feste Breite mit
               // max-width: auf dem Telefon wird sie kleiner, auf dem Bildschirm nicht
               // groesser als vorgesehen.
               + '" style="width:' + breite + 'px;max-width:100%;height:auto"'
               + ' role="img" aria-label="Rundenzeiten je Runde">');
    // Bezugslinie auf der Bestzeit: so liest man den Abstand jeder Runde ohne zu rechnen.
    const yB = yPos(beste);
    teile.push('<line x1="' + links + '" y1="' + yB.toFixed(1) + '" x2="' + (breite - 8)
               + '" y2="' + yB.toFixed(1) + '" stroke="#3ddc84" stroke-width="1"'
               + ' stroke-dasharray="3 3"/>');
    teile.push('<text x="4" y="' + (yB + 3.5).toFixed(1) + '" font-size="9" fill="#3ddc84"'
               + ' font-family="monospace">' + formatLapTime(beste) + '</text>');
    // Und die obere Kante beschriftet, damit die abgeschnittene Achse sichtbar ist.
    teile.push('<text x="4" y="' + (oben + 4) + '" font-size="9" fill="#6f7a94"'
               + ' font-family="monospace">' + formatLapTime(Math.round(yMax)) + '</text>');
    teile.push('<line x1="' + links + '" y1="' + (oben + hoehe) + '" x2="' + (breite - 8)
               + '" y2="' + (oben + hoehe) + '" stroke="#2b3547" stroke-width="1"/>');
    for (let i = 0; i < zeiten.length; i++) {
      const ms = zeiten[i];
      const e = ev[i] || {};
      const x = links + i * B + 4;
      const w = B - 10;
      const y = yPos(ms);
      const h = Math.max(1, oben + hoehe - y);
      // Gelb bei Boxenstopp, gruen bei der schnellsten Runde, sonst blau. Die Reihenfolge
      // entscheidet: ein Boxenstopp erklaert eine lange Runde, und das ist die wichtigere
      // Aussage als "war nicht die schnellste".
      const farbe = e.pit ? '#ffb02e' : (ms === beste ? '#3ddc84' : '#5aa9ff');
      teile.push('<rect x="' + x + '" y="' + y.toFixed(1) + '" width="' + w + '" height="'
                 + h.toFixed(1) + '" fill="' + farbe + '" opacity="0.85" rx="1"/>');
      // Crashs als Blitz ueber dem Balken, mit Zahl ab zwei.
      if (e.crash) {
        teile.push('<text x="' + (x + w / 2) + '" y="' + (y - 3).toFixed(1)
                   + '" text-anchor="middle" font-size="11" fill="#ff5c5c">\u26a1'
                   + (e.crash > 1 ? '<tspan font-size="8">' + e.crash + '</tspan>' : '')
                   + '</text>');
      }
      teile.push('<text x="' + (x + w / 2) + '" y="' + (oben + hoehe + 11)
                 + '" text-anchor="middle" font-size="9" fill="#6f7a94"'
                 + ' font-family="monospace">' + (i + 1) + '</text>');
    }
    teile.push('<text x="' + links + '" y="' + (oben + hoehe + 23) + '" font-size="8.5"'
               + ' fill="#6f7a94">Runde</text>');
    teile.push('</svg>');
    host.innerHTML = teile.join('');

    // Die Fussnote traegt, was NICHT im Bild steht: die Zeitstrafe (sie gehoert keiner
    // Runde) und der Hinweis, wenn eine alte Sitzung keine Ereignisse mitbringt.
    if (note) {
      const stueck = [];
      const stopps = ev.reduce((a, x) => a + (x.pit || 0), 0);
      const crashs = ev.reduce((a, x) => a + (x.crash || 0), 0);
      // Ueber t() und nicht als deutsche Zeichenketten: die Fussnote entsteht im CODE, also
      // greift die Textknoten-Uebersetzung nicht von selbst - sie waere im englischen Modus
      // deutsch geblieben. Genau solche Stellen findet der Uebersetzungs-Selbsttest.
      stueck.push(zeiten.length + ' ' + t('gemessene Runden, beste') + ' '
                  + formatLapTime(beste));
      if (!ev.length) {
        stueck.push(t('diese Sitzung wurde vor v0.5 aufgezeichnet und trägt keine Ereignisse'));
      } else {
        stueck.push(stopps + ' ' + t(stopps === 1 ? 'Boxenstopp (gelb)' : 'Boxenstopps (gelb)'));
        stueck.push(crashs + ' ' + t(crashs === 1 ? 'Abgang (Blitz)' : 'Abgänge (Blitz)'));
      }
      if (sitzung.strafeS) {
        stueck.push(sitzung.strafeS + ' ' + t('s Zeitstrafe am Rennende'));
      }
      stueck.push(t('y-Achse abgeschnitten, siehe Beschriftung'));
      note.textContent = stueck.join(' \u00b7 ') + '.';
    }
  }

  // Die Auswahl fuellen und den Plot zeichnen. Neueste Sitzung zuerst, weil man die sucht.
  function plotAuswahl() {
    const pick = $('sess-plot-pick');
    if (!pick) return;
    const o = sessionStore();
    const eintraege = [];
    for (let i = o.sessions.length - 1; i >= 0; i--) {
      const st = o.sessions[i];
      for (const a of (st.autos || [])) {
        if (!a.laps || !a.laps.length) continue;
        eintraege.push({ i, name: a.name,
                         text: new Date(st.zeit).toLocaleString() + ' \u2013 ' + a.name });
      }
    }
    const vorher = pick.value;
    pick.innerHTML = eintraege.map((e, k) =>
      '<option value="' + k + '">' + e.text + '</option>').join('');
    const row = $('sess-plot-row');
    if (row) row.style.display = eintraege.length ? '' : 'none';
    if (!eintraege.length) { plotAufbauen(null); return; }
    if (vorher && pick.querySelector('option[value="' + vorher + '"]')) pick.value = vorher;
    const wahl = eintraege[parseInt(pick.value, 10) || 0];
    plotAufbauen(o.sessions[wahl.i], wahl.name);
    // Die Liste am ELEMENT ablegen und nicht in der Abschlussumgebung des Zuhoerers.
    //
    // Vorher hielt der Zuhoerer die eintraege des ERSTEN Verdrahtens fest. Nach einem
    // weiteren Rennen fuellt plotAuswahl die Auswahl neu, der Zuhoerer arbeitete aber
    // weiter mit der alten Liste - und ein Wechsel in der Auswahl haette die falsche
    // Sitzung gezeichnet. Gefunden beim Durchsehen, nicht beim Fahren: der Fehler zeigt
    // sich erst ab der zweiten Sitzung.
    pick.__eintraege = eintraege;
    if (!pick.__verdrahtet) {
      pick.__verdrahtet = true;
      pick.addEventListener('change', () => {
        const liste = pick.__eintraege || [];
        const e = liste[parseInt(pick.value, 10) || 0];
        if (e) plotAufbauen(sessionStore().sessions[e.i], e.name);
      });
    }
  }

  // Pruefzugang: den Plot mit GEGEBENEN Daten zeichnen, ohne den Sitzungsspeicher
  // anzufassen. Ein Test, der echte Sitzungen anlegt, veraendert die Daten des Nutzers.
  if (window.OMEGA_TEST) {
    window.OMEGA_TEST.plotZeichnen = (sitzung, name) => {
      plotAufbauen(sitzung, name);
      const host = $('sess-plot');
      const note = $('sess-plot-note');
      const html = host ? host.innerHTML : '';
      return { balken: (html.match(/<rect/g) || []).length,
               gelb: (html.match(/#ffb02e/g) || []).length,
               blitze: (html.match(/\u26a1/g) || []).length,
               fussnote: note ? note.textContent : '' };
    };
  }

  // Beim Sprachwechsel neu zeichnen: die Fussnote des Plots wird im Code zusammengesetzt und
  // ist damit fuer den Textknoten-Uebersetzer unerreichbar.
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => renderSessions());

  function renderSessions() {
    const host = $('sess-list');
    if (!host) return;
    // Der Plot zieht MIT der Liste nach und nicht auf eigenem Weg: eine Stelle, die die
    // Ergebnisse zeichnet, und zwei Darstellungen desselben Speichers.
    plotAuswahl();
    const o = sessionStore();
    const autos = Object.values(o.cars);
    const kopf = $('sess-summary');
    if (kopf) {
      kopf.textContent = o.sessions.length
        ? o.sessions.length + ' Sitzung' + (o.sessions.length === 1 ? '' : 'en') + ', '
          + autos.reduce((a, c) => a + c.runden, 0) + ' Runden, '
          + autos.reduce((a, c) => a + c.km, 0).toFixed(1) + ' km simuliert'
        : 'noch nichts gespeichert';
    }
    if (!o.sessions.length) { host.innerHTML = ''; return; }

    // Nach TAG gruppiert, neueste zuerst. Eine flache Liste von 200 Zeilen ist keine
    // Uebersicht, und der Tag ist die Einheit, in der man sich erinnert ("letzten Samstag").
    const tage = {};
    for (const s of o.sessions) {
      const tag = (s.zeit || '').slice(0, 10);
      (tage[tag] = tage[tag] || []).push(s);
    }
    const teile = [];
    teile.push('<table class="doc-tab"><thead><tr><th>Auto</th><th>Runden</th>'
               + '<th>Beste</th><th>km sim</th><th>m echt</th></tr></thead><tbody>');
    for (const c of autos.sort((a, b) => b.runden - a.runden)) {
      teile.push('<tr><td>' + String(c.name).replace(/</g, '&lt;') + '</td><td>' + c.runden
                 + '</td><td>' + (c.besteMs === null ? '–' : sessionFmt(c.besteMs))
                 + '</td><td>' + c.km.toFixed(1) + '</td><td>'
                 + (c.realKm * 1000).toFixed(0) + '</td></tr>');
    }
    teile.push('</tbody></table>');

    for (const tag of Object.keys(tage).sort().reverse()) {
      const liste = tage[tag];
      teile.push('<h3 style="font-size:13px; margin:16px 0 5px 0">' + tag + ' &middot; '
                 + liste.length + ' Sitzung' + (liste.length === 1 ? '' : 'en') + '</h3>');
      for (const s of liste.slice().reverse()) {
        const zeit = (s.zeit || '').slice(11, 16);
        const runden = s.autos.reduce((a, c) => a + c.laps.length, 0);
        const alle = s.autos.reduce((a, c) => a.concat(c.laps), []);
        const beste = alle.length ? Math.min.apply(null, alle) : null;
        teile.push('<div class="sess-row"><b>' + zeit + '</b> '
                   + (RACE_MODES[s.modus] ? RACE_MODES[s.modus].label : s.modus)
                   + ' &middot; ' + runden + ' Runden'
                   + (beste !== null ? ' &middot; beste ' + sessionFmt(beste) : '')
                   + (s.strecke ? ' &middot; <code>' + s.strecke + '</code>' : '')
                   + ' &middot; ' + s.simKm.toFixed(1) + ' km</div>');
      }
    }
    host.innerHTML = teile.join('');
  }

  // ---- Export ------------------------------------------------------------------------
  //
  // Dasselbe Format wie der vorhandene Rennergebnis-Export: Semikolon, Komma als
  // Dezimaltrenner, BOM. Das ist nicht Geschmack, sondern was ein deutsches Excel ohne
  // Nachfrage richtig oeffnet - und ein Export, den man erst reparieren muss, ist keiner.
  function sessionCsv() {
    const o = sessionStore();
    const z = (x) => String(x === null || x === undefined ? '' : x)
      .replace(/[";\n]/g, ' ');
    const komma = (x) => String(x).replace('.', ',');
    const zeilen = ['Datum;Zeit;Modus;Strecke;Auto;Kennung;Rolle;Runde;Zeit (s);km sim;m echt'];
    for (const s of o.sessions) {
      const tag = (s.zeit || '').slice(0, 10);
      const uhr = (s.zeit || '').slice(11, 19);
      for (const c of s.autos) {
        c.laps.forEach((ms, i) => {
          zeilen.push([tag, uhr, z(s.modus), z(s.strecke), z(c.name), z(c.kennung),
                       z(c.rolle), i + 1, komma((ms / 1000).toFixed(3)),
                       komma(s.simKm.toFixed(3)), komma((s.realKm * 1000).toFixed(1))].join(';'));
        });
      }
    }
    zeilen.push('');
    zeilen.push('Summe je Auto');
    zeilen.push('Auto;Sitzungen;Runden;Beste (s);km sim;m echt');
    for (const c of Object.values(o.cars)) {
      zeilen.push([z(c.name), c.sitzungen, c.runden,
                   c.besteMs === null ? '' : komma((c.besteMs / 1000).toFixed(3)),
                   komma(c.km.toFixed(3)), komma((c.realKm * 1000).toFixed(1))].join(';'));
    }
    return '﻿' + zeilen.join('\r\n');
  }

  if ($('sess-export')) {
    $('sess-export').addEventListener('click', () => {
      const blob = new Blob([sessionCsv()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'omegasim-sitzungen-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  if ($('sess-clear')) {
    $('sess-clear').addEventListener('click', () => {
      // Ohne Rueckfrage waere das die einzige Stelle in der App, an der ein Klick
      // unwiederbringlich Daten loescht. Und geloescht wird wirklich alles, auch die
      // Geraetekennungen - genau deshalb gibt es den Knopf.
      if (!confirm('Alle gespeicherten Sitzungen und Kilometerstände löschen? '
                   + 'Das lässt sich nicht zurücknehmen.')) return;
      try { localStorage.removeItem(SESSION_STORE); } catch (e) { /* privat */ }
      renderSessions();
      showHudToast('SITZUNGEN GELÖSCHT');
      log('Alle Sitzungsdaten gelöscht.', 'info');
    });
  }

  renderSessions();

  // ============================== MEHRSPIELER (Version A) ==============================
  //
  // WAS UEBER DIE LEITUNG GEHT: Rundenzahl, letzte und beste Rundenzeit, Abgaenge, Name.
  // Keine Physik, keine Lenkwerte, keine Position. Jedes Telefon rechnet seine eigene Physik
  // und haelt seine eigene Bluetooth-Verbindung; reisst das WLAN ab, faehrt jeder weiter und
  // nur die Rangliste steht still.
  //
  // GEMELDET WIRD BEIM RUNDENSCHLUSS, dazu einmal je fuenf Sekunden als Lebenszeichen. Ein
  // Bericht je Sendetakt waere 22 Anfragen je Sekunde fuer eine Zahl, die sich alle paar
  // Sekunden aendert - und er wuerde denselben Faden belasten, der den 45-ms-Sendetakt haelt.
  // Genau der war schon einmal die Ursache fuer ruckelndes Fahren.
  //
  // SOLANGE KEIN HOST EINGETRAGEN IST, PASSIERT GAR NICHTS: kein Zeitgeber, keine Anfrage.
  // Eine Mehrspielerfunktion, die im Hintergrund pollt, obwohl niemand mehrspielt, ist eine
  // Last ohne Gegenwert.
  const MP_STORE = 'chc.mp.v1';
  const MP_POLL_MS = 1500;      // Rangliste holen
  const MP_HEARTBEAT_MS = 5000; // Lebenszeichen, damit die eigene Zeile nicht blass wird
  const mp = { host: '', name: '', id: '', an: false, timer: null, letzterBericht: 0 };

  function mpLaden() {
    try {
      const o = JSON.parse(localStorage.getItem(MP_STORE) || '{}');
      mp.host = o.host || '';
      mp.name = o.name || '';
      // Die Kennung wird EINMAL erzeugt und bleibt. Ohne sie waere jeder Neustart ein neuer
      // Fahrer in der Rangliste, und nach drei Ladevorgaengen stehen dort vier Mal dieselbe
      // Person.
      mp.id = o.id || ('p' + Math.random().toString(36).slice(2, 10));
      mpSpeichern();
    } catch (e) { mp.id = 'p' + Math.random().toString(36).slice(2, 10); }
  }

  function mpSpeichern() {
    try {
      localStorage.setItem(MP_STORE, JSON.stringify(
        { host: mp.host, name: mp.name, id: mp.id }));
    } catch (e) { /* privater Modus */ }
  }

  function mpSay(text, schlecht) {
    const el = $('mp-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = schlecht ? 'var(--bad)' : '';
  }

  function mpUrl(pfad) {
    let h = mp.host.trim().replace(/\/+$/, '');
    if (h && !/^https?:\/\//.test(h)) h = 'http://' + h;
    return h + pfad;
  }

  // Der eigene Stand. Er kommt aus DENSELBEN Variablen, aus denen das Cockpit liest -
  // dashLapTimes und die Rundenzahl. Eine zweite Zaehlung waere eine zweite Wahrheit.
  function mpEigenerStand() {
    const zeiten = (typeof dashLapTimes !== 'undefined' && dashLapTimes) || [];
    const beste = zeiten.length ? Math.min.apply(null, zeiten) / 1000 : null;
    const letzte = zeiten.length ? zeiten[zeiten.length - 1] / 1000 : null;
    return { id: mp.id, name: mp.name || 'ohne Namen', laps: zeiten.length,
             letzte, beste,
             abgaenge: (typeof offtrackZaehler !== 'undefined') ? offtrackZaehler : 0 };
  }

  async function mpBerichten() {
    if (!mp.an) return;
    mp.letzterBericht = Date.now();
    try {
      await fetch(mpUrl('/mp/report'), {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mpEigenerStand()),
      });
    } catch (e) { /* die Rangliste zeigt es beim naechsten Holen */ }
  }

  // Aus playerLapCrossed gerufen. Eine Runde ist der Moment, in dem sich die Rangliste
  // wirklich aendert - alles andere ist Lebenszeichen.
  function mpRundeGefahren() {
    if (mp.an) mpBerichten();
  }

  async function mpHolen() {
    if (!mp.an) return;
    // Lebenszeichen, wenn lange kein Rundenschluss war: ohne das wird die eigene Zeile im
    // Ueberblicksschirm nach zehn Sekunden blass, obwohl man faehrt.
    if (Date.now() - mp.letzterBericht > MP_HEARTBEAT_MS) mpBerichten();
    try {
      const r = await fetch(mpUrl('/mp/state'), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      mpZeichnen(d);
      mpSay(t('verbunden') + ', ' + (d.fahrer || []).length + ' '
            + t('Fahrer'));
    } catch (e) {
      mpSay(t('kein Kontakt zum Host') + ': ' + e.message, true);
    }
  }

  function mpZeichnen(d) {
    const host = $('mp-rows');
    if (!host) return;
    const leute = d.fahrer || [];
    if (!leute.length) {
      host.innerHTML = '<tr><td colspan="5" class="muted">' + t('keine Daten') + '</td></tr>';
      return;
    }
    const zeit = (x) => (x === null || x === undefined) ? '&ndash;' : x.toFixed(2) + 's';
    host.innerHTML = leute.map((f, i) =>
      '<tr' + (f.id === mp.id ? ' style="color:var(--good)"' : '') + '>'
      + '<td>' + (i + 1) + '</td><td>' + String(f.name).replace(/</g, '&lt;') + '</td>'
      + '<td>' + f.laps + '</td><td>' + zeit(f.letzte) + '</td><td>' + zeit(f.beste)
      + '</td></tr>').join('');
  }

  function mpJoin() {
    mp.host = ($('mp-host') || { value: '' }).value.trim();
    mp.name = ($('mp-name') || { value: '' }).value.trim();
    if (!mp.host) { mpSay(t('Ohne Host-Adresse geht es nicht.'), true); return; }
    mpSpeichern();
    mp.an = true;
    if (mp.timer === null) mp.timer = setInterval(mpHolen, MP_POLL_MS);
    mpBerichten();
    mpHolen();
    log('Mehrspieler: bei ' + mp.host + ' angemeldet als "' + (mp.name || 'ohne Namen')
        + '".', 'info');
  }

  function mpLeave() {
    mp.an = false;
    if (mp.timer !== null) { clearInterval(mp.timer); mp.timer = null; }
    mpSay(t('nicht verbunden'));
    log('Mehrspieler verlassen.', 'info');
  }

  mpLaden();
  if ($('mp-host')) $('mp-host').value = mp.host;
  if ($('mp-name')) $('mp-name').value = mp.name;
  if ($('mp-join')) $('mp-join').addEventListener('click', mpJoin);
  if ($('mp-leave')) $('mp-leave').addEventListener('click', mpLeave);
