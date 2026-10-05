
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
      autos: Object.values(o.cars).slice().sort((a, b) => (b.km || 0) - (a.km || 0)),
      medaillen: { 3: 0, 2: 0, 1: 0 }, strecken: 0, streckenGefahren: 0,
    };
    const codes = new Set();
    for (const e of s) {
      d.jeModus[e.modus] = (d.jeModus[e.modus] || 0) + 1;
      d.simKm += e.simKm || 0;
      d.realKm += e.realKm || 0;
      if (e.strecke) codes.add(e.strecke);
      const ich = (e.autos || []).findIndex((a) => a.rolle === 'player');
      const a = ich >= 0 ? e.autos[ich] : null;
      if (a && Array.isArray(a.laps)) {
        d.runden += a.laps.length;
        d.fahrMs += a.laps.reduce((x, y) => x + y, 0);
        for (const ms of a.laps) if (d.besteMs === null || ms < d.besteMs) d.besteMs = ms;
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
    try {
      const t = JSON.parse(localStorage.getItem('carrera-hybrid-tracks') || '[]');
      d.strecken = Array.isArray(t) ? t.length : 0;
    } catch (e) { d.strecken = 0; }
    return d;
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
      + kachel(d.besteMs !== null ? formatLapTime(d.besteMs) : '–', 'Beste Runde')
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
      html += '<h3 class="k-zwischen">' + esc(t('Ranking: Kilometer je Auto')) + '</h3>'
        + '<table class="stat-tabelle"><thead><tr><th>#</th><th>' + esc(t('Auto')) + '</th><th>km</th><th>'
        + esc(t('Runden')) + '</th><th>' + esc(t('Beste Runde')) + '</th><th>' + esc(t('Sitzungen')) + '</th></tr></thead><tbody>'
        + d.autos.map((a, i) => '<tr><td data-i18n-skip>' + (i + 1) + '</td><td data-i18n-skip>' + esc(a.name || '?')
          + '</td><td data-i18n-skip>' + km(a.km || 0) + '</td><td data-i18n-skip>' + (a.runden || 0) + '</td><td data-i18n-skip>'
          + (a.besteMs ? formatLapTime(a.besteMs) : '–') + '</td><td data-i18n-skip>' + (a.sitzungen || 0) + '</td></tr>').join('')
        + '</tbody></table>';
    }
    html += '<p class="muted stat-fuss">' + esc(t('Gespeichert werden die letzten 200 Sitzungen; die Kilometer und Runden je Auto zählen ohne Grenze. Die Höchstgeschwindigkeit zeichnet die App nicht auf. Ghosts werden die Strecke des Fahrerautos gutgeschrieben.')) + '</p>';
    host.innerHTML = html;
  }
