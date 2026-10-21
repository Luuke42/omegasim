
  // ============================== STATISTIKEN (v0.9.25) ==============================
  //
  // BESTELLT: "In den Optionen einen Tab mit Statistiken, in dem alle moeglichen spannenden
  // und messbaren Sachen stehen ... nimm aber nur die Sachen, die eh aufgezeichnet werden."
  // Quelle ist ausschliesslich, was schon gespeichert wird:
  //   chc.sessions.v1        jede beendete Sitzung (Modus, Autos, Rundenzeiten, Ereignisse,
  //                          Strecke) und die Summen je Auto (km, Runden, beste Runde)
  //   omegasim-challenges    eigene Challenge-Zeiten -> Medaillen
  //   carrera-hybrid-tracks  gespeicherte Strecken
  // NICHT gespeichert und deshalb NICHT hier: die Hoechstgeschwindigkeit. Siege werden aus den
  // gespeicherten Rundenzeiten der Rennen mit mehr als einem Auto abgeleitet.
  const STAT_RENNMODI = ['laps', 'endurance', 'qualifying', 'knockout', 'derby'];

  // Wer hat diese Sitzung gewonnen? Index in s.autos oder -1. Nur fuer Rennmodi mit mindestens
  // zwei Autos; Qualifying nach bester Einzelrunde, sonst meiste Runden, dann kuerzeste
  // Gesamtzeit.
  function statSieger(s) {
    if (!s || !Array.isArray(s.autos) || s.autos.length < 2 || STAT_RENNMODI.indexOf(s.modus) < 0) return -1;
    const wert = s.autos.map((a) => {
      const l = Array.isArray(a.laps) ? a.laps : [];
      return { n: l.length, summe: l.reduce((x, y) => x + y, 0), beste: l.length ? Math.min(...l) : Infinity };
    });
    let best = -1;
    wert.forEach((w, i) => {
      if (!w.n) return;
      if (best < 0) { best = i; return; }
      const b = wert[best];
      const besser = s.modus === 'qualifying' ? w.beste < b.beste
        : (w.n > b.n || (w.n === b.n && w.summe < b.summe));
      if (besser) best = i;
    });
    return best;
  }

  function statDaten() {
    const o = sessionStore();
    const s = o.sessions;
    const d = {
      sitzungen: s.length, rennen: 0, siege: 0, rennenMehr: 0, simKm: 0, realKm: 0, fahrMs: 0,
      runden: 0, besteMs: null, boxen: 0, crashs: 0, jeModus: {}, seit: s.length ? s[0].zeit : null,
      // v1.1.3: mit Kennung (Foto, Farbe).
      autos: Object.keys(o.cars).map((id) => Object.assign({ id }, o.cars[id])).sort((a, b) => (b.km || 0) - (a.km || 0)),
      medaillen: { 3: 0, 2: 0, 1: 0 }, strecken: 0, streckenGefahren: 0,
    };
    const codes = new Set();
    for (const e of s) {
      d.jeModus[e.modus] = (d.jeModus[e.modus] || 0) + 1;
      d.simKm += e.simKm || 0;
      d.realKm += e.realKm || 0;
      if (e.strecke) codes.add(e.strecke);
      const ich = (e.autos || []).findIndex((a) => a.rolle === 'player');
      // v0.9.87: alle gesteuerten Autos (Spieler 1 bis 3), nicht nur Spieler 1.
      for (const a of (e.autos || [])) {
        if (!/^player/.test(a.rolle || '') || !Array.isArray(a.laps)) continue;
        d.runden += a.laps.length;
        d.fahrMs += a.laps.reduce((x, y) => x + y, 0);
        for (const ev of (a.ereignisse || [])) { d.boxen += ev.pit || 0; d.crashs += ev.crash || 0; }
      }
      if (STAT_RENNMODI.indexOf(e.modus) >= 0) {
        d.rennen += 1;
        if ((e.autos || []).length >= 2) {
          d.rennenMehr += 1;
          if (ich >= 0 && statSieger(e) === ich) d.siege += 1;
        }
      }
    }
    d.streckenGefahren = codes.size;
    // Medaillen: je Challenge und Modus die beste eigene Zeit (wie die Kachel).
    try {
      const alle = chLesen(CH_STORE, {});
      for (const k of Object.keys(alle)) {
        const [id, modus, preset] = k.split('|');
        if (preset !== 'pro') continue;
        const def = CH_ALLE.find((x) => x.id === id);
        const l = alle[k];
        if (!def || !Array.isArray(l) || !l.length) continue;
        const n = chSterne(def, modus, Math.min(...l.map((z) => z.zeit)));
        if (n >= 1 && n <= 3) d.medaillen[n] += 1;
      }
    } catch (e) { /* ohne Challenge-Daten keine Medaillen */ }
    // v0.10.6: die Medaillen aus dem Bestzeit-Modus (je Strecke und Fahrer die beste).
    try {
      const bz = bestzeitLesen();
      for (const k of Object.keys(bz)) {
        for (const f of Object.values(bz[k].fahrer || {})) {
          if (f.medaille >= 1 && f.medaille <= 3) d.medaillen[f.medaille] += 1;
        }
      }
    } catch (e) { /* ohne Bestzeiten */ }
    try {
      // v0.9.87: die Ablage ist ein OBJEKT (Name -> Strecke), kein Feld - gezaehlt wurde
      // deshalb immer 0 ("gespeicherte Strecken gehen nicht").
      const t = JSON.parse(localStorage.getItem('carrera-hybrid-tracks') || '{}');
      d.strecken = Array.isArray(t) ? t.length : (t && typeof t === 'object' ? Object.keys(t).length : 0);
    } catch (e) { d.strecken = 0; }
    return d;
  }

  // ---- v1.1.3: FOTO, FARBE UND KM JE AUTO --------------------------------------------------
  // BESTELLT: "Statistiken, wenn verfuegbar: Autofoto, gestapeltes Balkendiagramm km je Auto,
  // Farbcodierung der Autos, auch als dezenter vertikaler Streifen links in jeder Tabellenzeile."
  // Farbe: das verbundene Auto, sonst die gemerkte (chc.cars.v1), sonst die zuletzt gefahrene, sonst
  // eine feste aus der Palette. Foto: die Garagenablage (omegasim-autofoto:<Kennung>).
  function statFarbe(a, i) {
    const g = (typeof garage !== 'undefined') ? garage.find((c) => c.device && String(c.device.id) === a.id) : null;
    if (g && typeof carColor === 'function') return carColor(g).hex;
    try {
      const m = (typeof carStore === 'function' ? carStore() : {})[a.id];
      const c = m && CAR_COLORS.find((x) => x.id === m.color);
      if (c) return c.hex;
    } catch (e) { /* ohne Ablage */ }
    if (a.farbe) return a.farbe;
    return CAR_AUTO_COLORS[i % CAR_AUTO_COLORS.length].hex;
  }
  function statFoto(id) {
    try { return id ? localStorage.getItem('omegasim-autofoto:' + id) : null; } catch (e) { return null; }
  }
  // km je Auto und Tag aus den gespeicherten Sitzungen (Runden x Streckenlaenge x Massstab), die
  // letzten STAT_TAGE Tage mit Fahrten. Zugeordnet ueber die Kennung, aeltere Sitzungen ueber den Namen.
  const STAT_TAGE = 10;
  function statKmJeTag(s, autos) {
    const tage = new Map(), laenge = new Map();
    const finde = (x) => autos.findIndex((a) => (x.id && a.id === x.id) || (!x.id && a.name === x.name));
    for (const e of s) {
      if (!e.strecke || !Array.isArray(e.autos)) continue;
      let m = laenge.get(e.strecke);
      if (m === undefined) {
        try { m = trackLaengeM(codeToTrack(e.strecke).tiles); } catch (er) { m = 0; }
        laenge.set(e.strecke, m);
      }
      if (!m) continue;
      const tag = String(e.zeit || '').slice(0, 10);
      if (!tag) continue;
      if (!tage.has(tag)) tage.set(tag, {});
      const zeile = tage.get(tag);
      for (const x of e.autos) {
        const i = finde(x);
        if (i < 0 || !Array.isArray(x.laps) || !x.laps.length) continue;
        zeile[i] = (zeile[i] || 0) + x.laps.length * m / 1000 * REAL_SCALE;
      }
    }
    return [...tage.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).slice(-STAT_TAGE);
  }
  function statKmSvg(tage, farben, namen) {
    if (!tage.length) return '';
    const W = 600, H = 170, L = 34, U = 22, O = 8;
    const summe = (z) => Object.values(z).reduce((x, y) => x + y, 0);
    const max = Math.max(0.001, ...tage.map(([, z]) => summe(z)));
    const bw = (W - L - 8) / tage.length;
    let h = '<svg class="stat-km" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="km">';
    [0, 0.5, 1].forEach((f) => {
      const y = O + (H - U - O) * (1 - f);
      h += '<line x1="' + L + '" x2="' + W + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,.12)"/>'
        + '<text x="' + (L - 4) + '" y="' + (y + 4).toFixed(1) + '" font-size="11" text-anchor="end" fill="#a3acbd">' + (max * f >= 10 ? Math.round(max * f) : (max * f).toFixed(1)) + '</text>';
    });
    tage.forEach(([tag, z], k) => {
      let y = H - U;
      const x = L + 4 + k * bw;
      Object.keys(z).map(Number).sort((p, q) => p - q).forEach((i) => {
        const hh = (H - U - O) * z[i] / max;
        y -= hh;
        h += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(2, bw - 6).toFixed(1) + '" height="' + Math.max(0, hh - 1).toFixed(1)
          + '" rx="2" fill="' + farben[i] + '"><title>' + tag + ' · ' + namen[i] + ': ' + z[i].toFixed(2) + ' km</title></rect>';
      });
      h += '<text x="' + (x + (bw - 6) / 2).toFixed(1) + '" y="' + (H - 6) + '" font-size="11" text-anchor="middle" fill="#a3acbd">' + tag.slice(8, 10) + '.' + tag.slice(5, 7) + '.</text>';
    });
    return h + '</svg>';
  }
  function statDauer(ms) {
    if (ms < 60000) return Math.round(ms / 1000) + ' s';
    const min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') + ' min';
  }
  function statZeichnen() {
    const host = $('stat-inhalt');
    if (!host) return;
    const d = statDaten();
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const kachel = (wert, name, klein, kl) => '<div class="stat-kachel' + (kl ? ' ' + kl : '') + '"><b data-i18n-skip>' + esc(wert) + '</b><span>'
      + esc(t(name)) + '</span>' + (klein ? '<small data-i18n-skip>' + esc(klein) + '</small>' : '') + '</div>';
    const km = (x) => x >= 100 ? Math.round(x) : x.toFixed(1);
    const modusName = (m) => (RACE_MODES[m] ? t(RACE_MODES[m].label) : m);
    let html = '';
    if (!d.sitzungen) {
      html += '<p class="muted">' + esc(t('Noch keine Sitzung gespeichert. Jede beendete Fahrt zählt mit.')) + '</p>';
    }
    html += '<div class="stat-raster">'
      + kachel(km(d.simKm) + ' km', 'Gefahren (simuliert)', (d.realKm * 1000).toFixed(0) + ' m ' + t('auf der Bahn'))
      + kachel(d.sitzungen, 'Sitzungen', d.seit ? t('seit') + ' ' + new Date(d.seit).toLocaleDateString() : '')
      + kachel(statDauer(d.fahrMs), 'Fahrzeit', d.runden + ' ' + t('Runden'))
      + kachel(d.rennen, 'Rennen', d.rennenMehr + ' ' + t('mit mehreren Autos'))
      + kachel(d.siege, 'Siege', d.rennenMehr ? Math.round(100 * d.siege / d.rennenMehr) + ' %' : '')
      + kachel(d.boxen, 'Boxenstopps')
      + kachel(d.crashs, 'Crashs')
      + kachel('🥇 ' + d.medaillen[3] + '  🥈 ' + d.medaillen[2] + '  🥉 ' + d.medaillen[1], 'Medaillen', '', 'stat-medaille')
      + kachel(d.streckenGefahren, 'Strecken gefahren', d.strecken + ' ' + t('gespeichert'))
      + '</div>';
    const modi = Object.keys(d.jeModus).sort((a, b) => d.jeModus[b] - d.jeModus[a]);
    if (modi.length) {
      html += '<h3 class="k-zwischen">' + esc(t('Sitzungen je Modus')) + '</h3><div class="stat-modi">'
        + modi.map((m) => '<span><b data-i18n-skip>' + d.jeModus[m] + '</b> ' + esc(modusName(m)) + '</span>').join('')
        + '</div>';
    }
    if (d.autos.length) {
      const farben = d.autos.map((a, i) => statFarbe(a, i));
      const namen = d.autos.map((a) => a.name || '?');
      const tage = statKmJeTag(sessionStore().sessions, d.autos);
      if (tage.length) {
        html += '<h3 class="k-zwischen">' + esc(t('Kilometer je Auto und Tag')) + '</h3>' + statKmSvg(tage, farben, namen)
          + '<div class="stat-legende">' + d.autos.map((a, i) => tage.some(([, z]) => z[i]) ? '<span><i style="background:' + farben[i] + '"></i><span data-i18n-skip>' + esc(namen[i]) + '</span></span>' : '').join('') + '</div>';
      }
      html += '<h3 class="k-zwischen">' + esc(t('Ranking: Kilometer je Auto')) + '</h3>'
        + '<table class="stat-tabelle"><thead><tr><th>#</th><th>' + esc(t('Auto')) + '</th><th>km</th><th>'
        + esc(t('Runden')) + '</th><th>' + esc(t('Sitzungen')) + '</th></tr></thead><tbody>'
        + d.autos.map((a, i) => {
          const foto = statFoto(a.id);
          return '<tr style="--stat-farbe:' + farben[i] + '"><td data-i18n-skip>' + (i + 1) + '</td><td data-i18n-skip><span class="stat-auto">'
            + (foto ? '<i class="stat-foto" style="background-image:url(&quot;' + foto + '&quot;)"></i>' : '<i class="stat-punkt" style="background:' + farben[i] + '"></i>')
            + esc(a.name || '?') + '</span>'
            + '</td><td data-i18n-skip>' + km(a.km || 0) + '</td><td data-i18n-skip>' + (a.runden || 0) + '</td><td data-i18n-skip>'
            + (a.sitzungen || 0) + '</td></tr>';
        }).join('')
        + '</tbody></table>';
    }
    // v1.1.3: Fahrstil der letzten Sitzung mit Kennwerten und der Mittelwert der letzten zehn (WIP).
    const mitStil = sessionStore().sessions.filter((e) => e.fahrstil);
    if (mitStil.length) {
      const letzte = mitStil[mitStil.length - 1].fahrstil, zehn = mitStil.slice(-10).map((e) => e.fahrstil);
      const mittel = (k) => { const v = zehn.map((x) => x[k]).filter((x) => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const zeig = (x, art) => x === null || x === undefined ? '–' : art === 'p' ? Math.round(x * 100) + ' %' : x.toFixed(2);
      html += '<h3 class="k-zwischen">' + esc(t('Fahrstil')) + ' <span class="wip-tag">WIP</span></h3>'
        + '<table class="stat-tabelle"><thead><tr><th>' + esc(t('Kennwert')) + '</th><th>' + esc(t('Letzte Sitzung')) + '</th><th>'
        + esc(t('Mittel der letzten {n}').replace('{n}', zehn.length)) + '</th></tr></thead><tbody>'
        + FAHRSTIL_NAMEN.map(([k, name, art]) => '<tr><td>' + esc(t(name)) + '</td><td data-i18n-skip>' + zeig(letzte[k], art)
          + '</td><td data-i18n-skip>' + zeig(mittel(k), art) + '</td></tr>').join('')
        + '</tbody></table>';
    }
    html += '<p class="muted stat-fuss">' + esc(t('Gespeichert werden die letzten 200 Sitzungen; die Kilometer und Runden je Auto zählen ohne Grenze. Die Höchstgeschwindigkeit zeichnet die App nicht auf. NPCs werden die Strecke des Fahrerautos gutgeschrieben.')) + '</p>';
    // v1.0.21: Rundenvergleich Teil fuer Teil steht auf einer eigenen Seite.
    html += '<p class="stat-fuss"><button type="button" id="stat-tele">' + esc(t('Telemetrie ansehen')) + '</button></p>';
    host.innerHTML = html;
    if ($('stat-tele')) $('stat-tele').addEventListener('click', () => teleSeiteOeffnen());
  }
