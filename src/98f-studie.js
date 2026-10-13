  // ============================== STUDIE (v1.0, experimentell) ==============================
  //
  // BESTELLT: Persoenlichkeitstest (NARQ, Narzissmus) plus Selbsteinschaetzung des CH-Fahrkoennens
  // und ein Reaktionszeittest mit dem Gamepad, in den Optionen. Alter, Geschlecht und die
  // Bestaetigung 18+ sind Pflicht. Die Ergebnisse gehen in ein eigenes Blatt "Studie" im Sheet
  // der Challenges ("Ja, eigenes Blatt"), verknuepft ueber die Geraetekennung, nie per GET
  // lesbar, mit Einwilligungstext.
  //
  // NARQ: Back, Kuefner, Dufner, Gerlach, Rauthmann & Denissen (2013), JPSP 105(6), 1013-1037.
  // 18 Aussagen, 6-stufig (1 = trifft gar nicht zu ... 6 = trifft voll und ganz zu).
  // Bewunderung (Admiration): Items 1, 2, 3, 5, 7, 8, 15, 16, 18; Rivalitaet: 4, 6, 9, 10, 11, 12,
  // 13, 14, 17. Werte = Mittelwerte. DER DEUTSCHE WORTLAUT IST AUS DEM GEDAECHTNIS NOTIERT und
  // muss vor dem Einsatz gegen das Original geprueft werden.
  //
  // NICHTS WIRD VOR DEM LETZTEN SCHRITT GESENDET. Abbrechen heisst: nichts ist passiert.
  const STUDIE_STORE = 'omegasim-studie';
  // Kontakt fuer Rueckfragen und Loeschwuensche (Einwilligungstext). Leer = Hinweis "folgt".
  const STUDIE_KONTAKT = '';
  const NARQ_ITEMS = [
    'Ich bin großartig.',
    'Ich werde einmal berühmt sein.',
    'Ich zeige anderen gern, wie besonders ich bin.',
    'Ich reagiere genervt, wenn mir jemand anderes die Show stiehlt.',
    'Ich genieße meine Erfolge sehr.',
    'Ich freue mich heimlich über Misserfolge meiner Rivalen.',
    'Meistens gelingt es mir, in Gesprächen die Aufmerksamkeit auf mich zu ziehen.',
    'Ich verdiene es, als große Persönlichkeit angesehen zu werden.',
    'Ich will, dass meine Rivalen scheitern.',
    'Ich genieße es, wenn andere mir unterlegen sind.',
    'Ich ärgere mich häufig, wenn ich kritisiert werde.',
    'Ich kann es kaum ertragen, wenn eine andere Person im Mittelpunkt steht.',
    'Die meisten Menschen werden nichts Großes erreichen.',
    'Andere Menschen sind nichts wert.',
    'Etwas ganz Besonderes zu sein, gibt mir viel Kraft.',
    'Mit meinen besonderen Beiträgen schaffe ich es, im Mittelpunkt zu stehen.',
    'Die meisten Menschen sind irgendwie Versager.',
    'Meistens gehe ich sehr geschickt mit anderen Menschen um.',
  ];
  const NARQ_ADM = [1, 2, 3, 5, 7, 8, 15, 16, 18], NARQ_RIV = [4, 6, 9, 10, 11, 12, 13, 14, 17];
  const NARQ_SKALA = ['trifft gar nicht zu', '', '', '', '', 'trifft voll und ganz zu'];
  const STUDIE_GESCHLECHT = [['w', 'weiblich'], ['m', 'männlich'], ['d', 'divers'], ['k', 'keine Angabe']];
  const RT_DURCHGAENGE = 10, RT_MIN_WARTE = 1500, RT_MAX_WARTE = 4000, RT_FRUEH_MS = 100, RT_FENSTER_MS = 2000;

  // Rein, fuer den Selbsttest: Mittelwerte der beiden Facetten (null, wenn etwas fehlt).
  function narqWerte(antworten) {
    const mw = (nr) => {
      const v = nr.map((i) => antworten[i - 1]);
      return v.every((x) => x >= 1 && x <= 6) ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 1000) / 1000 : null;
    };
    return { bewunderung: mw(NARQ_ADM), rivalitaet: mw(NARQ_RIV) };
  }
  function rtMedian(liste) {
    if (!liste.length) return null;
    const s = liste.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function studieLesen() {
    try { return JSON.parse(localStorage.getItem(STUDIE_STORE) || 'null') || {}; } catch (e) { return {}; }
  }
  function studieSchreiben(d) { try { localStorage.setItem(STUDIE_STORE, JSON.stringify(d)); } catch (e) { /* privat */ } }

  // Laufender Durchgang (nur im Speicher, bis gesendet wird).
  let st = null;
  function studieNeu() {
    return { schritt: 'start', alter: '', geschlecht: '', volljaehrig: false, einwilligung: false,
             narq: new Array(NARQ_ITEMS.length).fill(0), item: 0, selbst: 0, rt: [], frueh: 0, verpasst: 0,
             quelle: '', controller: '', nurUeben: false };
  }
  function stEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

  function studieZeichnen() {
    const host = $('studie-inhalt');
    if (!host) return;
    if (!st) st = studieNeu();
    const d = studieLesen();
    if (d.ausstehend && st.schritt === 'start') studieSenden(d.ausstehend, true);
    let h = '';
    if (st.schritt === 'start' && d.gesendet && !st.nochmal) {
      h += '<p>' + stEsc(t('Danke, du hast teilgenommen am')) + ' ' + stEsc(new Date(d.gesendet).toLocaleDateString()) + '.</p>'
        + (d.ausstehend ? '<p class="muted">' + stEsc(t('Die Daten sind noch nicht angekommen; sie werden beim nächsten Öffnen erneut gesendet.')) + '</p>' : '')
        + '<p class="muted">' + stEsc(t('Deine Gerätekennung')) + ': <code>' + stEsc(chGeraet()) + '</code></p>'
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="ueben">' + stEsc(t('Reaktionstest üben (wird nicht gesendet)')) + '</button></div>';
    } else if (st.schritt === 'start') {
      h += '<div class="studie-text">'
        + '<p><b>' + stEsc(t('Worum es geht')) + ':</b> ' + stEsc(t('Hängen Persönlichkeit, Reaktionszeit und die eigene Einschätzung mit den Rundenzeiten in OmegaSim zusammen?')) + '</p>'
        + '<p><b>' + stEsc(t('Was du tust')) + ':</b> ' + stEsc(t('18 Aussagen zur Persönlichkeit bewerten, eine Frage zu deinem Fahrkönnen beantworten und einen Reaktionstest mit dem Controller machen (10 Durchgänge). Dauer etwa 5 Minuten.')) + '</p>'
        + '<p><b>' + stEsc(t('Was gespeichert wird')) + ':</b> ' + stEsc(t('Alter, Geschlecht, deine Antworten, die Reaktionszeiten, der Name des Controllers, die App-Version und die zufällige Gerätekennung dieser App. Über die Gerätekennung werden die Antworten mit deinen hochgeladenen Challenge-Zeiten verknüpft (dort steht dein Fahrername, falls du einen eingetragen hast). Dein Klarname wird nicht abgefragt.')) + '</p>'
        + '<p><b>' + stEsc(t('Wo')) + ':</b> ' + stEsc(t('In einer Tabelle des Projekts, die nicht öffentlich abrufbar ist. Ausgewertet wird nur für Forschung; veröffentlicht werden nur zusammengefasste Ergebnisse.')) + '</p>'
        + '<p><b>' + stEsc(t('Freiwillig')) + ':</b> ' + stEsc(t('Du kannst jederzeit abbrechen. Vor dem letzten Schritt wird nichts gesendet. Mit deiner Gerätekennung kannst du später die Löschung verlangen.')) + ' <code>' + stEsc(chGeraet()) + '</code></p>'
        + '<p><b>' + stEsc(t('Kontakt')) + ':</b> ' + stEsc(STUDIE_KONTAKT || t('folgt')) + '</p></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Alter')) + '</div><input type="number" id="st-alter" min="18" max="99" step="1" style="width:84px" value="' + stEsc(st.alter) + '"></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Geschlecht')) + '</div><select id="st-geschlecht"><option value="">–</option>'
        + STUDIE_GESCHLECHT.map((g) => '<option value="' + g[0] + '"' + (st.geschlecht === g[0] ? ' selected' : '') + '>' + stEsc(t(g[1])) + '</option>').join('') + '</select></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Ich bin mindestens 18 Jahre alt.')) + '</div><label class="tgl"><input type="checkbox" id="st-18"' + (st.volljaehrig ? ' checked' : '') + '></label></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Ich habe den Text gelesen und willige ein.')) + '</div><label class="tgl"><input type="checkbox" id="st-ok"' + (st.einwilligung ? ' checked' : '') + '></label></div>'
        + '<p class="muted" id="st-hinweis"></p>'
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="weiter" id="st-weiter">' + stEsc(t('Weiter')) + '</button></div>';
    } else if (st.schritt === 'narq') {
      const i = st.item;
      h += '<p class="muted">' + stEsc(t('Aussage')) + ' ' + (i + 1) + ' / ' + NARQ_ITEMS.length + ' · ' + stEsc(t('Wie sehr trifft das auf dich zu?')) + '</p>'
        + '<div class="studie-frage">' + stEsc(t(NARQ_ITEMS[i])) + '</div>'
        + '<div class="studie-skala">' + [1, 2, 3, 4, 5, 6].map((v) => '<button type="button" data-st="narq" data-v="' + v + '"' + (st.narq[i] === v ? ' class="primary"' : '') + '><b>' + v + '</b>'
          + (NARQ_SKALA[v - 1] ? '<small>' + stEsc(t(NARQ_SKALA[v - 1])) + '</small>' : '') + '</button>').join('') + '</div>'
        + '<div class="studie-knoepfe"><button type="button" data-st="zurueck">' + stEsc(t('Zurück')) + '</button><button type="button" class="warn" data-st="abbrechen">' + stEsc(t('Abbrechen')) + '</button></div>';
    } else if (st.schritt === 'selbst') {
      h += '<div class="studie-frage">' + stEsc(t('Wie gut fährst du Carrera Hybrid, verglichen mit anderen?')) + '</div>'
        + '<div class="studie-skala sieben">' + [1, 2, 3, 4, 5, 6, 7].map((v) => '<button type="button" data-st="selbst" data-v="' + v + '"' + (st.selbst === v ? ' class="primary"' : '') + '><b>' + v + '</b>'
          + (v === 1 ? '<small>' + stEsc(t('viel schlechter')) + '</small>' : v === 4 ? '<small>' + stEsc(t('durchschnittlich')) + '</small>' : v === 7 ? '<small>' + stEsc(t('viel besser')) + '</small>' : '') + '</button>').join('') + '</div>'
        + '<div class="studie-knoepfe"><button type="button" data-st="zurueck">' + stEsc(t('Zurück')) + '</button><button type="button" class="warn" data-st="abbrechen">' + stEsc(t('Abbrechen')) + '</button></div>';
    } else if (st.schritt === 'rt-info') {
      const pad = studiePadFinden();
      h += '<div class="studie-text"><p>' + stEsc(t('Gleich wird das Feld unten grün. Drück dann so schnell du kannst eine Taste am Controller. Drückst du vorher, zählt das als Frühstart und der Durchgang wird wiederholt.')) + '</p>'
        + '<p class="muted">' + (pad ? stEsc(t('Controller erkannt')) + ': ' + stEsc(pad.id) : stEsc(t('Kein Controller erkannt. Drück eine Taste am Controller, damit er erscheint; ohne Controller zählt Tippen auf das Feld.'))) + '</p></div>'
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="rt-los">' + stEsc(t('Reaktionstest starten')) + '</button>'
        + (st.nurUeben ? '' : '<button type="button" class="warn" data-st="abbrechen">' + stEsc(t('Abbrechen')) + '</button>') + '</div>';
    } else if (st.schritt === 'rt') {
      h += '<div class="studie-rt" id="st-rt-feld" data-zustand="warte"><b id="st-rt-text">' + stEsc(t('Warte …')) + '</b>'
        + '<small id="st-rt-stand">' + st.rt.length + ' / ' + RT_DURCHGAENGE + '</small></div>';
    } else if (st.schritt === 'senden') {
      h += '<p>' + stEsc(t('Wird gesendet …')) + '</p>';
    } else if (st.schritt === 'danke') {
      const med = rtMedian(st.rt);
      h += '<p><b>' + stEsc(st.nurUeben ? t('Übung beendet.') : t('Danke für deine Teilnahme!')) + '</b></p>'
        + '<p>' + stEsc(t('Deine Reaktionszeit (Median)')) + ': <b>' + (med ? Math.round(med) + ' ms' : '–') + '</b> · '
        + stEsc(t('Frühstarts')) + ': ' + st.frueh + '</p>'
        + (st.fehler ? '<p class="muted">' + stEsc(st.fehler) + '</p>' : '')
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="fertig">' + stEsc(t('Fertig')) + '</button></div>';
    }
    host.innerHTML = h;
    studieFormPruefen();
    if (st.schritt === 'rt') studieRtStarten();
  }

  function studieFormPruefen() {
    const b = $('st-weiter');
    if (!b) return;
    const a = parseInt(($('st-alter') || {}).value, 10);
    st.alter = Number.isFinite(a) ? a : '';
    st.geschlecht = ($('st-geschlecht') || {}).value || '';
    st.volljaehrig = !!($('st-18') || {}).checked;
    st.einwilligung = !!($('st-ok') || {}).checked;
    let fehlt = '';
    if (!(a >= 18 && a <= 99)) fehlt = t('Alter zwischen 18 und 99 eintragen.');
    else if (!st.geschlecht) fehlt = t('Geschlecht wählen (auch „keine Angabe“ geht).');
    else if (!st.volljaehrig) fehlt = t('Bitte bestätigen, dass du mindestens 18 bist.');
    else if (!st.einwilligung) fehlt = t('Ohne Einwilligung geht es nicht weiter.');
    b.disabled = !!fehlt;
    if ($('st-hinweis')) $('st-hinweis').textContent = fehlt;
  }

  // ---- Reaktionstest -------------------------------------------------------------------------
  // Zeitbasis performance.now(). Das Signal gilt ab dem Bild NACH dem Umfaerben (zweiter
  // requestAnimationFrame), das ist der Moment, in dem es auf dem Schirm steht. Der Tastendruck
  // nimmt, wenn vorhanden, den Zeitstempel des Gamepads (Gamepad.timestamp: wann sich sein Zustand
  // zuletzt aenderte) statt des Abfragezeitpunkts.
  let rt = null;
  function studiePadFinden() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find((p) => p && p.connected) || null; } catch (e) { return null; }
  }
  function studiePadGedrueckt(p) { return !!(p && p.buttons && p.buttons.some((b) => b && b.pressed)); }
  // Nur solange die Seite offen ist: wer mitten im Test zurueckgeht, bricht ihn ab (sonst
  // blieben Tasten und Pad fuer Menue und Auto gesperrt).
  function studieTestAktiv() {
    if (!st || st.schritt !== 'rt') return false;
    const seite = $('sub-opt-studie');
    if (seite && seite.classList.contains('on')) return true;
    st.schritt = 'rt-info'; rt = null;
    return false;
  }
  function studieRtStarten() {
    if (rt) return;
    rt = { phase: 'warte', signal: 0, ende: 0, vorher: true, kanal: new MessageChannel() };
    st.controller = (studiePadFinden() || {}).id || '';
    const feld = $('st-rt-feld');
    feld.addEventListener('pointerdown', () => studieDruck(performance.now(), 'tippen'));
    rt.kanal.port1.onmessage = studieRtTakt;
    studieRtDurchgang();
  }
  function studieRtDurchgang() {
    const feld = $('st-rt-feld');
    if (!feld || !rt) return;
    rt.phase = 'warte';
    feld.dataset.zustand = 'warte';
    $('st-rt-text').textContent = t('Warte …');
    $('st-rt-stand').textContent = st.rt.length + ' / ' + RT_DURCHGAENGE;
    rt.signalAb = performance.now() + RT_MIN_WARTE + Math.random() * (RT_MAX_WARTE - RT_MIN_WARTE);
    rt.signal = 0;
    rt.kanal.port2.postMessage(0);
  }
  // Ein MessagePort-Takt statt setTimeout: wird nicht gedrosselt und fragt das Pad etwa jede
  // Millisekunde ab, nur solange der Test laeuft.
  function studieRtTakt() {
    if (!rt || !studieTestAktiv()) { rt = null; return; }
    const jetzt = performance.now();
    const p = studiePadFinden();
    const unten = studiePadGedrueckt(p);
    if (unten && !rt.vorher) {
      const ts = p && p.timestamp && p.timestamp <= jetzt && p.timestamp > jetzt - 50 ? p.timestamp : jetzt;
      studieDruck(ts, 'controller');
    }
    rt.vorher = unten;
    if (!rt) return;
    const zeigen = () => {
      $('st-rt-feld').dataset.zustand = 'jetzt';
      $('st-rt-text').textContent = t('JETZT!');
    };
    if (rt.phase === 'warte' && jetzt >= rt.signalAb) {
      rt.phase = 'umfaerben';
      rt.umfaerbenAb = jetzt;
      requestAnimationFrame(() => {
        if (!rt || rt.phase !== 'umfaerben') return;
        zeigen();
        requestAnimationFrame((ts) => { if (rt && rt.phase === 'umfaerben') { rt.signal = ts; rt.phase = 'signal'; } });
      });
    } else if (rt.phase === 'umfaerben' && jetzt - rt.umfaerbenAb > 100) {
      // Kein Bildtakt (Fenster verdeckt, Energiesparen): dann ohne ihn, ab jetzt.
      zeigen();
      rt.signal = jetzt; rt.phase = 'signal';
    } else if (rt.phase === 'signal' && jetzt - rt.signal > RT_FENSTER_MS) {
      st.verpasst++;
      studieRtMeldung(t('Zu langsam, nochmal.'));
      return;
    }
    if (rt.phase !== 'pause') rt.kanal.port2.postMessage(0);
  }
  function studieDruck(zeit, quelle) {
    if (!rt) return;
    if (rt.phase === 'warte' || rt.phase === 'umfaerben' || (rt.phase === 'signal' && zeit - rt.signal < RT_FRUEH_MS)) {
      st.frueh++;
      studieRtMeldung(t('Zu früh! Der Durchgang wird wiederholt.'));
      return;
    }
    if (rt.phase !== 'signal') return;
    st.rt.push(Math.round((zeit - rt.signal) * 10) / 10);
    if (!st.quelle) st.quelle = quelle; else if (st.quelle !== quelle) st.quelle = 'gemischt';
    if (st.rt.length >= RT_DURCHGAENGE) { rt.phase = 'pause'; studieRtFertig(); return; }
    studieRtMeldung(Math.round(zeit - rt.signal) + ' ms', true);
  }
  function studieRtMeldung(text, gut) {
    rt.phase = 'pause';
    const feld = $('st-rt-feld');
    if (feld) feld.dataset.zustand = gut ? 'gut' : 'frueh';
    if ($('st-rt-text')) $('st-rt-text').textContent = text;
    if ($('st-rt-stand')) $('st-rt-stand').textContent = st.rt.length + ' / ' + RT_DURCHGAENGE;
    setTimeout(() => { if (rt && studieTestAktiv()) { rt.phase = 'warte'; studieRtDurchgang(); } }, 1200);
  }
  function studieRtFertig() {
    rt = null;
    if (st.nurUeben) { st.schritt = 'danke'; studieZeichnen(); return; }
    const w = narqWerte(st.narq);
    const daten = { art: 'studie', alter: st.alter, geschlecht: st.geschlecht, volljaehrig: true, einwilligung: true,
      narq: st.narq, bewunderung: w.bewunderung, rivalitaet: w.rivalitaet, selbst: st.selbst,
      rt_ms: st.rt, rt_median: rtMedian(st.rt), fruehstarts: st.frueh, verpasst: st.verpasst,
      quelle: st.quelle, controller: String(st.controller).slice(0, 80),
      version: (($('app-version') || {}).textContent || '').slice(0, 20), sprache: typeof lang === 'string' ? lang : '' };
    const d = studieLesen();
    d.gesendet = new Date().toISOString();
    d.ausstehend = daten;
    studieSchreiben(d);
    st.schritt = 'senden';
    studieZeichnen();
    studieSenden(daten, false);
  }
  function studieSenden(daten, still) {
    const url = (chOnline() || {}).url;
    if (!url) { if (!still) { st.fehler = t('Keine Adresse für den Upload eingestellt; die Daten bleiben auf dem Gerät.'); st.schritt = 'danke'; studieZeichnen(); } return; }
    fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ geraet: chGeraet() }, daten)) })
      .then((r) => r.json())
      .then((j) => {
        if (!j || !j.ok) throw new Error((j && j.fehler) || 'abgelehnt');
        const d = studieLesen(); d.ausstehend = null; studieSchreiben(d);
        if (!still) { st.schritt = 'danke'; studieZeichnen(); }
      })
      .catch((e) => {
        if (still) return;
        st.fehler = t('Senden fehlgeschlagen, wird beim nächsten Öffnen erneut versucht') + ' (' + e.message + ').';
        st.schritt = 'danke'; studieZeichnen();
      });
  }

  function studieKlick(ev) {
    const b = ev.target.closest('[data-st]');
    if (!b || b.disabled) return;
    const a = b.dataset.st, v = parseInt(b.dataset.v, 10);
    if (a === 'weiter') { studieFormPruefen(); if (b.disabled) return; st.schritt = 'narq'; st.item = 0; }
    else if (a === 'narq') {
      st.narq[st.item] = v;
      if (st.item < NARQ_ITEMS.length - 1) st.item++; else st.schritt = 'selbst';
    } else if (a === 'selbst') { st.selbst = v; st.schritt = 'rt-info'; }
    else if (a === 'zurueck') {
      if (st.schritt === 'selbst') { st.schritt = 'narq'; st.item = NARQ_ITEMS.length - 1; }
      else if (st.item > 0) st.item--; else st.schritt = 'start';
    } else if (a === 'abbrechen' || a === 'fertig') { st = studieNeu(); }
    else if (a === 'ueben') { st = Object.assign(studieNeu(), { nurUeben: true, schritt: 'rt-info' }); }
    else if (a === 'rt-los') { st.rt = []; st.frueh = 0; st.verpasst = 0; st.quelle = ''; st.schritt = 'rt'; }
    studieZeichnen();
  }
  // v1.0.12 BESTELLT: "Studie erstmal nur zum Testen drin haben." Die Kachel erscheint nur im
  // Entwicklermodus (Optionen > Entwickler bzw. ?dev in der Adresse).
  function studieKachelZeigen() {
    const k = $('opt-studie-kachel');
    if (k) k.hidden = !(typeof konsoleDev === 'function' && konsoleDev());
  }
  studieKachelZeigen();
  if ($('setting-dev')) $('setting-dev').addEventListener('change', studieKachelZeigen);
  if ($('studie-inhalt')) {
    $('studie-inhalt').addEventListener('click', studieKlick);
    $('studie-inhalt').addEventListener('input', studieFormPruefen);
    $('studie-inhalt').addEventListener('change', studieFormPruefen);
  }
  // Leertaste/Enter waehrend des Tests: als Druck, ohne dass Menue oder Fahrtasten reagieren.
  window.addEventListener('keydown', (e) => {
    if (!studieTestAktiv() || e.repeat) return;
    e.preventDefault(); e.stopImmediatePropagation();
    studieDruck(performance.now(), 'taste');
  }, true);
