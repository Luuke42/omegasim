  // ============================== AKKU-AUFZEICHNUNG (WIP) ==============================
  //
  // v1.5 (Plan Paket 1, Punkt 6): "Kennlinie statt Gerade (Stuetzpunkte aus aufgezeichneten Rohwerten ueber eine ganze
  // Akkuladung; dafuer schreibt die Telemetrie den Rohwert und die Fahrzeit mit, und der Nutzer faehrt einmal einen Akku
  // leer)." Je Auto (Kennung) alle AKKU_AUFZ_TAKT_MS ein Punkt: Zeit seit Beginn, Fahrzeit (Teilzaehler hat sich in den
  // letzten 3 s bewegt), kleinster und groesster Rohwert im Abschnitt (unter Gas sackt die Spannung ab). Springt der
  // Rohwert um AKKU_AUFZ_GELADEN nach oben, war der Akku am Ladegeraet: eine neue Aufzeichnung beginnt, die alte bleibt
  // als "vorher". Entwicklertools > Entwickler: je Auto eine Zeile mit CSV kopieren und Loeschen.

  const AKKU_AUFZ_STORE = 'omegasim-akku-aufz.v1';
  const AKKU_AUFZ_TAKT_MS = 10000, AKKU_AUFZ_MAX = 3000, AKKU_AUFZ_GELADEN = 5, AKKU_AUFZ_FAEHRT_MS = 3000;
  // var: onCarNotify (90-ghosts.js) kann vor dieser Datei melden.
  var akkuAufz = null;
  let akkuAufzSchmutzig = false;
  function akkuAufzDaten() {
    if (!akkuAufz) {
      try { akkuAufz = JSON.parse(localStorage.getItem(AKKU_AUFZ_STORE) || '{}') || {}; } catch (e) { akkuAufz = {}; }
    }
    return akkuAufz;
  }
  function akkuAufzSichern() {
    if (!akkuAufzSchmutzig) return;
    try { localStorage.setItem(AKKU_AUFZ_STORE, JSON.stringify(akkuAufzDaten())); } catch (e) { /* voll oder privat */ }
    akkuAufzSchmutzig = false;
  }
  setInterval(() => { akkuAufzSichern(); akkuAufzZeigen(); }, 30000);

  // Rein (fuer den Selbsttest gibt der Aufrufer die Zeit vor). roh = Byte 10, zaehler = Byte 11 (Teilzaehler).
  function akkuMitschreiben(car, roh, zaehler, jetzt) {
    if (!car || !car.device || car.sim || !(roh > 0)) return;
    const id = String(car.device.id);
    const D = akkuAufzDaten();
    let A = D[id];
    const lz = car.akkuAufzLauf || (car.akkuAufzLauf = { zaehler: null, bewegt: 0, letzt: null, min: Infinity, max: 0, abschnitt: null });
    if (lz.zaehler !== zaehler) { if (lz.zaehler !== null) lz.bewegt = jetzt; lz.zaehler = zaehler; }
    const neu = () => ({ name: garageLabel(car), start: Date.now(), fz: 0, punkte: [] });
    if (!A) A = D[id] = { aktuell: neu(), vorher: null };
    const a = A.aktuell;
    a.name = garageLabel(car);
    // Fahrzeit: nur, solange sich der Teilzaehler bewegt.
    if (lz.letzt !== null) {
      const dt = Math.max(0, Math.min(2000, jetzt - lz.letzt));
      if (jetzt - lz.bewegt < AKKU_AUFZ_FAEHRT_MS) a.fz += dt / 1000;
    }
    lz.letzt = jetzt;
    if (lz.abschnitt === null) lz.abschnitt = jetzt;
    lz.min = Math.min(lz.min, roh); lz.max = Math.max(lz.max, roh);
    if (jetzt - lz.abschnitt < AKKU_AUFZ_TAKT_MS) return;
    // Geladen? Dann beginnt eine neue Aufzeichnung.
    const letzter = a.punkte[a.punkte.length - 1];
    if (letzter && lz.max >= letzter.max + AKKU_AUFZ_GELADEN) {
      A.vorher = a.punkte.length ? a : A.vorher;
      A.aktuell = neu();
    }
    const z = A.aktuell;
    z.punkte.push({ t: Math.round((Date.now() - z.start) / 1000), fz: Math.round(z.fz), min: lz.min, max: lz.max });
    if (z.punkte.length > AKKU_AUFZ_MAX) z.punkte.splice(0, z.punkte.length - AKKU_AUFZ_MAX);
    lz.abschnitt = jetzt; lz.min = Infinity; lz.max = 0;
    akkuAufzSchmutzig = true;
  }
  function akkuAufzCsv(id) {
    const A = akkuAufzDaten()[id];
    if (!A) return '';
    const zeilen = ['aufzeichnung;sekunden;fahrzeit_s;roh_min;roh_max'];
    [['vorher', A.vorher], ['aktuell', A.aktuell]].forEach(([art, a]) => {
      if (!a) return;
      a.punkte.forEach((p) => zeilen.push([art, p.t, p.fz, p.min, p.max].join(';')));
    });
    return zeilen.join(String.fromCharCode(10));
  }
  function akkuAufzZeit(s) { s = Math.round(s || 0); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function akkuAufzZeigen() {
    const box = $('akku-aufz-liste');
    if (!box) return;
    const D = akkuAufzDaten();
    const ids = Object.keys(D);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    box.innerHTML = ids.length ? ids.map((id) => {
      const a = D[id].aktuell, p = a.punkte[a.punkte.length - 1];
      const min = a.punkte.reduce((m, q) => Math.min(m, q.min), Infinity);
      return '<div class="opt-row"><div class="opt-label"><b>' + esc(a.name || id) + '</b><span class="muted" style="font-size:12px"> · '
        + esc(t('{n} Punkte, Laufzeit {l}, Fahrzeit {f}, Rohwert {r} (kleinster {m})').replace('{n}', a.punkte.length)
          .replace('{l}', akkuAufzZeit(p ? p.t : 0)).replace('{f}', akkuAufzZeit(a.fz)).replace('{r}', p ? p.min + '–' + p.max : '–').replace('{m}', Number.isFinite(min) ? min : '–'))
        + (D[id].vorher ? esc(' · ' + t('dazu eine frühere Ladung')) : '') + '</span></div>'
        + '<button type="button" data-akku-csv="' + esc(id) + '">' + esc(t('CSV kopieren')) + '</button>'
        + '<button type="button" data-akku-weg="' + esc(id) + '">' + esc(t('Löschen')) + '</button></div>';
    }).join('') : '<p class="muted">' + esc(t('Noch keine Daten. Ein verbundenes Auto schreibt alle 10 s einen Punkt.')) + '</p>';
    box.querySelectorAll('[data-akku-csv]').forEach((b) => b.addEventListener('click', async () => {
      const csv = akkuAufzCsv(b.dataset.akkuCsv);
      try { await navigator.clipboard.writeText(csv); showHudToast(t('CSV kopiert')); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = csv; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showHudToast(t('CSV kopiert')); } catch (e2) { /* von Hand */ } ta.remove(); }
    }));
    box.querySelectorAll('[data-akku-weg]').forEach((b) => b.addEventListener('click', () => {
      delete akkuAufzDaten()[b.dataset.akkuWeg]; akkuAufzSchmutzig = true; akkuAufzSichern(); akkuAufzZeigen();
    }));
  }
  akkuAufzZeigen();
  i18nOnLangChange(akkuAufzZeigen);

  stAdd('Akku v1.5: Aufzeichnung alle 10 s mit Fahrzeit und Min/Max, neue Ladung erkannt, CSV', () => {
    const f = [];
    let roh = null;
    try { roh = localStorage.getItem(AKKU_AUFZ_STORE); } catch (e) { roh = null; }
    const merk = akkuAufz;
    try {
      akkuAufz = {};
      const car = { device: { id: 'probe-akku' }, alias: 'Akku Probe', tag: 'A' };
      let jetzt = 1000, zaehler = 0;
      // 60 s fahren (Zaehler bewegt sich jede Sekunde), Rohwert schwankt 150/146.
      for (let i = 0; i < 300; i++) { jetzt += 200; if (i % 5 === 0) zaehler = (zaehler + 1) % 256; akkuMitschreiben(car, i % 2 ? 146 : 150, zaehler, jetzt); }
      // 30 s stehen.
      for (let i = 0; i < 150; i++) { jetzt += 200; akkuMitschreiben(car, 149, zaehler, jetzt); }
      const A = akkuAufz['probe-akku'];
      if (!A || A.aktuell.punkte.length < 8 || A.aktuell.punkte.length > 10) f.push('Punkte ' + (A && A.aktuell.punkte.length) + ' statt 9');
      else {
        const p = A.aktuell.punkte[0];
        if (p.min !== 146 || p.max !== 150) f.push('Min/Max ' + p.min + '/' + p.max);
        if (!(A.aktuell.fz > 55 && A.aktuell.fz < 66)) f.push('Fahrzeit ' + A.aktuell.fz.toFixed(1) + ' s statt ~60');
      }
      // Geladen: Rohwert springt auf 156.
      for (let i = 0; i < 60; i++) { jetzt += 200; akkuMitschreiben(car, 156, zaehler, jetzt); }
      const B = akkuAufz['probe-akku'];
      if (!B.vorher || B.vorher.punkte.length < 8 || !B.aktuell.punkte.length || B.aktuell.punkte.length > 2 || B.aktuell.punkte[0].max !== 156)
        f.push('neue Ladung nicht erkannt (vorher ' + (B.vorher ? B.vorher.punkte.length : 0) + ', jetzt ' + B.aktuell.punkte.length + ')');
      const csv = akkuAufzCsv('probe-akku').split(String.fromCharCode(10));
      if (csv[0] !== 'aufzeichnung;sekunden;fahrzeit_s;roh_min;roh_max' || !/^vorher;/.test(csv[1]) || !/^aktuell;/.test(csv[csv.length - 1])) f.push('CSV ' + csv.slice(0, 2).join(' / '));
      // Sim-Autos zaehlen nicht.
      akkuMitschreiben({ device: { id: 'sim' }, sim: true }, 150, 1, jetzt);
      if (akkuAufz.sim) f.push('Sim-Auto aufgezeichnet');
    } finally {
      akkuAufz = merk; akkuAufzSchmutzig = false;
      try { if (roh === null) localStorage.removeItem(AKKU_AUFZ_STORE); else localStorage.setItem(AKKU_AUFZ_STORE, roh); } catch (e) { /* privat */ }
    }
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'Punkt je 10 s mit Min/Max, Fahrzeit nur bei Bewegung, Ladung startet neu, CSV mit vorher/aktuell' };
  });
