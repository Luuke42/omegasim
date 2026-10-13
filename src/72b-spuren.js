  // ====================================================================================
  // SPUREN ONLINE (v1.0.21, WIP): Telemetrie der Bestenlisten
  // ====================================================================================
  //
  // BESTELLT (Plan "Telemetrie der Bestzeiten und Challenger", Phase 3): jede hochgeladene Zeit
  // traegt die Spur ihrer schnellsten Runde (teleSpurFuerUpload, 70b-telemetrie.js); das Apps
  // Script haelt je Liste und Geraet die schnellste (Blatt "Spuren"). Hier:
  //   - spurKnoepfe: in der Challenge-Bestenliste bekommt jede Zeile mit Spur "Telemetrie";
  //   - spurAnsehen: die Spur holen, als fremden Fahrer in den Telemetrie-Speicher legen und
  //     die Telemetrie-Seite mit ihr als B oeffnen;
  //   - spurRekord: die schnellste Spur einer Liste (fuer den Challenger, Phase 4).
  // Solange das Skript nicht neu bereitgestellt ist, antwortet es auf ?spurliste= mit der
  // gewoehnlichen Bestenliste - erkannt am fehlenden Feld "spuren", dann gibt es keine Knoepfe.

  var spurListen = {};                 // liste -> { at, map: { geraet: {zeit_ms, fahrer} }, laeuft }
  var spurCache = {};                  // liste|geraet -> { spur, fahrer, zeit_ms, geraet }
  var SPUR_LISTE_MS = 300000;

  function spurUrl() { const o = chOnline(); return o && o.url ? o.url : ''; }
  function spurAbfrage(url, q) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + q; }

  function spurListeHolen(liste) {
    const url = spurUrl();
    if (!url) return Promise.resolve(null);
    const e = spurListen[liste] || (spurListen[liste] = { at: 0, map: null, laeuft: null });
    if (e.laeuft) return e.laeuft;
    e.at = Date.now();
    e.laeuft = fetch(spurAbfrage(url, 'spurliste=' + encodeURIComponent(liste)))
      .then((r) => r.json())
      .then((j) => {
        e.laeuft = null;
        if (j && j.ok && Array.isArray(j.spuren)) {
          e.map = {};
          j.spuren.forEach((s) => { e.map[s.geraet] = s; });
        }
        return e.map;
      })
      .catch(() => { e.laeuft = null; return e.map; });
    return e.laeuft;
  }

  function spurHolen(liste, geraet) {
    const k = liste + '|' + (geraet || '*');
    if (spurCache[k]) return Promise.resolve(spurCache[k]);
    const url = spurUrl();
    if (!url) return Promise.resolve(null);
    return fetch(spurAbfrage(url, 'spur=' + encodeURIComponent(liste) + (geraet ? '&geraet=' + encodeURIComponent(geraet) : '')))
      .then((r) => r.json())
      .then((j) => {
        if (!j || !j.ok || !j.spur || !Array.isArray(j.spur.teile)) return null;
        spurCache[k] = j;
        return j;
      })
      .catch(() => null);
  }

  // Die schnellste Spur einer Liste (Weltrekord), fuer den Challenger.
  function spurRekord(liste) { return spurHolen(liste, null); }

  function spurKnoepfe(liste, tb) {
    const fuellen = (m) => {
      tb.querySelectorAll('tr').forEach((tr) => {
        const td = tr.querySelector('.ch-spur');
        if (!td) return;
        td.innerHTML = '';
        const g = tr.dataset.geraet;
        if (!g || !m || !m[g]) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ch-spur-knopf';
        b.textContent = t('Telemetrie');
        b.addEventListener('click', () => spurAnsehen(liste, g));
        td.appendChild(b);
      });
    };
    const e = spurListen[liste];
    if (e && e.map) fuellen(e.map);
    if (!e || Date.now() - e.at > SPUR_LISTE_MS) {
      spurListeHolen(liste).then((m) => { if (m && tb.isConnected) fuellen(m); });
    }
  }

  // Eine fremde Spur in den Telemetrie-Speicher legen (Fahrer "fremd:<geraet>") und den
  // Schluessel der Auswahl zurueckgeben.
  function spurFremdMerken(r) {
    const tiles = codeToTrack(r.spur.code).tiles;
    const d = teleLesen();
    const k = bestzeitSchluessel(tiles);
    const e = d[k] || (d[k] = { fahrer: {} });
    e.datum = e.datum || Date.now();
    const wer = 'fremd:' + r.geraet;
    e.fahrer[wer] = { beste: Object.assign({}, r.spur, { auto: (r.fahrer || '?') + ' (online)', datum: Date.now(), fremd: true }) };
    teleSchreiben(d);
    return { strecke: k, wahl: wer + '|beste' };
  }

  function spurAnsehen(liste, geraet) {
    showHudToast(t('Spur wird geladen …'));
    spurHolen(liste, geraet).then((r) => {
      if (!r) { showHudToast(t('Spur nicht verfügbar')); return; }
      const m = spurFremdMerken(r);
      teleWahl.b = m.wahl;
      teleSeiteOeffnen(m.strecke);
    });
  }
