  // ============================== STUDIE (v1.0, experimentell) ==============================
  //
  // BESTELLT: Persoenlichkeitstest (NARQ, Narzissmus) plus Selbsteinschaetzung des CH-Fahrkoennens
  // und ein Reaktionszeittest mit dem Gamepad, in den Optionen. Alter, Geschlecht und die
  // Bestaetigung 18+ sind Pflicht. Die Ergebnisse gehen in ein eigenes Blatt "Studie" im Sheet
  // der Challenges ("Ja, eigenes Blatt"), verknuepft ueber die Geraetekennung, nie per GET
  // lesbar, mit Einwilligungstext.
  //
  // NARQ-S (Kurzform, 6 Items): Back, Kuefner, Dufner, Gerlach, Rauthmann & Denissen (2013), JPSP
  // 105(6), 1013-1037. 6-stufig (1 = trifft ueberhaupt nicht zu ... 6 = trifft vollkommen zu).
  // Bewunderung (ADM): Items 1, 2, 4; Rivalitaet (RIV): 3, 5, 6. Werte = Mittelwerte.
  // v1.1.3: Wortlaut DE/EN und Instruktion vom Nutzer geliefert (vorher 18 Items aus dem
  // Gedaechtnis). Datensaetze tragen narqVersion 'S6'.
  //
  // NICHTS WIRD VOR DEM LETZTEN SCHRITT GESENDET. Abbrechen heisst: nichts ist passiert.
  const STUDIE_STORE = 'omegasim-studie';
  // Kontakt fuer Rueckfragen und Loeschwuensche (Einwilligungstext). Leer = Hinweis "folgt".
  const STUDIE_KONTAKT = 'roeseler.lukas@gmail.com';
  const NARQ_VERSION = 'S6';
  const NARQ_ITEMS = [
    'Ich ziehe viel Kraft daraus, eine ganz besondere Person zu sein',               // ADM-1
    'Mit meinen besonderen Beiträgen schaffe ich es, im Mittelpunkt zu stehen',      // ADM-2
    'Ich reagiere genervt, wenn eine andere Person mir die Schau stiehlt',          // RIV-1
    'Ich habe es verdient, als große Persönlichkeit angesehen zu werden',            // ADM-3
    'Ich will, dass meine Konkurrenten scheitern',                                   // RIV-2
    'Die meisten Menschen sind ziemliche Versager',                                  // RIV-3
  ];
  const NARQ_ADM = [1, 2, 4], NARQ_RIV = [3, 5, 6];
  const NARQ_SKALA = ['trifft überhaupt nicht zu', '', '', '', '', 'trifft vollkommen zu'];
  const NARQ_INSTRUKTION = 'Wie sehr treffen die folgenden Aussagen auf Sie zu? Antworten Sie bitte anhand der folgenden Skala. Der Wert 1 bedeutet: trifft überhaupt nicht zu, der Wert 6 bedeutet: trifft vollkommen zu. Mit den Werten dazwischen können Sie Ihre Einschätzung abstufen.';
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
        + '<p><b>' + stEsc(t('Worum es geht')) + ':</b> ' + stEsc(t('Hängen Persönlichkeit, Reaktionszeit und die eigene Einschätzung mit dem Fahrverhalten und den Rundenzeiten in OmegaSim zusammen?')) + '</p>'
        + '<p><b>' + stEsc(t('Was du tust')) + ':</b> ' + stEsc(t('6 Aussagen zur Persönlichkeit bewerten, eine Frage zu deinem Fahrkönnen beantworten, einen Reaktionstest mit dem Controller machen (10 Durchgänge) und danach, wenn du magst, eine Fahrverhaltens-Challenge fahren: 5 Runden auf Homington (nur Teile der Grundpackung) mit dem Fahrgefühl Sim+ – auf der echten Bahn, virtuell in der App oder beides.')) + '</p>'
        + '<p><b>' + stEsc(t('Wie lange')) + ':</b> ' + stEsc(t('Fragen und Reaktionstest etwa 3 Minuten. Fahrt auf der Bahn etwa 10 Minuten (Strecke aufbauen etwa 5, fünf Runden etwa 3–5). Virtuelle Fahrt etwa 5 Minuten. Insgesamt also 3 bis 18 Minuten, je nachdem, was du fährst.')) + '</p>'
        + '<p><b>' + stEsc(t('Was gespeichert wird')) + ':</b> ' + stEsc(t('Alter, Geschlecht, deine Antworten, die Reaktionszeiten, der Name des Controllers, die App-Version, die zufällige Gerätekennung dieser App und – mit Fahrt – Rundenzeiten und Fahrstil-Kennwerte (Gas, Bremse, Lenkung, Abflüge). Dein Name wird nicht abgefragt, und die Studienfahrt erscheint in keiner Bestenliste.')) + '</p>'
        + '<p><b>' + stEsc(t('Wo')) + ':</b> ' + stEsc(t('In einer Tabelle des Projekts. Öffentlich zugänglich gemacht werden die Daten nur in anonymisierter Form: ohne Gerätekennung, ohne Zeitpunkt und ohne Controller-Namen, in zufälliger Reihenfolge. Ausgewertet wird für Forschung und Lehre.')) + '</p>'
        + '<p><b>' + stEsc(t('Freiwillig')) + ':</b> ' + stEsc(t('Die Teilnahme ist freiwillig, und du musst mindestens 18 Jahre alt sein. Du kannst jederzeit abbrechen; vor dem letzten Schritt wird nichts gesendet. Mit deiner Gerätekennung kannst du später die Löschung verlangen, solange die Daten noch nicht anonymisiert veröffentlicht sind.')) + ' <code>' + stEsc(chGeraet()) + '</code></p>'
        + '<p><b>' + stEsc(t('Kontakt')) + ':</b> ' + stEsc(STUDIE_KONTAKT || t('folgt')) + '</p></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Alter')) + '</div><input type="number" id="st-alter" min="18" max="99" step="1" style="width:84px" value="' + stEsc(st.alter) + '"></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Geschlecht')) + '</div><select id="st-geschlecht"><option value="">–</option>'
        + STUDIE_GESCHLECHT.map((g) => '<option value="' + g[0] + '"' + (st.geschlecht === g[0] ? ' selected' : '') + '>' + stEsc(t(g[1])) + '</option>').join('') + '</select></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Ich bin mindestens 18 Jahre alt.')) + '</div><label class="tgl"><input type="checkbox" id="st-18"' + (st.volljaehrig ? ' checked' : '') + '><span></span></label></div>'
        + '<div class="opt-row"><div class="opt-label">' + stEsc(t('Ich habe den Text gelesen, nehme freiwillig teil und bin einverstanden, dass meine Daten in anonymisierter Form öffentlich zugänglich gemacht werden.')) + '</div><label class="tgl"><input type="checkbox" id="st-ok"' + (st.einwilligung ? ' checked' : '') + '><span></span></label></div>'
        + '<p class="muted" id="st-hinweis"></p>'
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="weiter" id="st-weiter">' + stEsc(t('Weiter')) + '</button></div>';
    } else if (st.schritt === 'narq') {
      const i = st.item;
      h += '<p class="muted">' + stEsc(t('Aussage')) + ' ' + (i + 1) + ' / ' + NARQ_ITEMS.length + ' · ' + '</p><p class="muted" style="font-size:12px">' + stEsc(t(NARQ_INSTRUKTION)) + '</p>'
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
    } else if (st.schritt === 'fahrt-info') {
      // v1.1.11 BESTELLT: "In der Studie erlaube mir, virtuell zu fahren (selbe Strecke, selbe
      // Rundenanzahl zusaetzlich zur physischen Bahn); erklaere vorher, wie lange das alles dauert."
      h += '<div class="studie-text"><p><b>' + stEsc(t('Fahrverhaltens-Challenge')) + '</b></p>'
        + '<p>' + stEsc(t('Auf der Bahn: Baue Homington aus der Grundpackung auf (der Plan erscheint beim Start), stelle dein Auto auf Start/Ziel und fahre 5 Runden – etwa 10 Minuten.')) + '</p>'
        + '<p>' + stEsc(t('Virtuell: dieselbe Strecke und dieselben 5 Runden in der App, ohne Bahn und Auto – etwa 5 Minuten. Du kannst beides fahren, nacheinander.')) + '</p>'
        + '<p class="muted">' + stEsc(t('Fahrgefühl Sim+, trocken, keine Bestenliste. Gemessen werden Rundenzeiten, Gas, Bremse, Lenkung und Abflüge. Ohne Fahrt kannst du auch gleich abschließen.')) + '</p></div>'
        + '<div class="studie-knoepfe"><button type="button" class="primary" data-st="fahren">' + stEsc(t('Auf der Bahn fahren')) + '</button>'
        + '<button type="button" class="primary" data-st="fahren-virtuell">' + stEsc(t('Virtuell fahren')) + '</button>'
        + '<button type="button" data-st="ohne-fahrt">' + stEsc(t('Ohne Fahrt abschließen')) + '</button></div>';
    } else if (st.schritt === 'fahrt-mehr') {
      const fertig = (f) => f ? (f.gueltig ? t('gefahren') : t('gefahren, nicht gewertet')) + (f.beste_ms ? ' · ' + t('beste Runde') + ' ' + (f.beste_ms / 1000).toFixed(2).replace('.', ',') + ' s' : '') : t('noch nicht');
      h += '<div class="studie-text"><p><b>' + stEsc(t('Fahrverhaltens-Challenge')) + '</b></p>'
        + '<p>' + stEsc(t('Auf der Bahn')) + ': ' + stEsc(fertig(st.fahrt)) + '</p>'
        + '<p>' + stEsc(t('Virtuell')) + ': ' + stEsc(fertig(st.fahrtVirtuell)) + '</p></div>'
        + '<div class="studie-knoepfe">'
        + (st.fahrt ? '' : '<button type="button" data-st="fahren">' + stEsc(t('Auch auf der Bahn fahren (etwa 10 Minuten)')) + '</button>')
        + (st.fahrtVirtuell ? '' : '<button type="button" data-st="fahren-virtuell">' + stEsc(t('Auch virtuell fahren (etwa 5 Minuten)')) + '</button>')
        + '<button type="button" class="primary" data-st="abschliessen">' + stEsc(t('Abschließen und senden')) + '</button></div>';
    } else if (st.schritt === 'fahrt-laeuft') {
      h += '<p>' + stEsc(t('Die Studienfahrt läuft. Nach der letzten Runde geht es hier weiter.')) + '</p>'
        + '<div class="studie-knoepfe"><button type="button" data-st="ohne-fahrt">' + stEsc(t('Ohne Fahrt abschließen')) + '</button></div>';
    } else if (st.schritt === 'senden') {
      h += '<p>' + stEsc(t('Wird gesendet …')) + '</p>';
    } else if (st.schritt === 'danke') {
      const med = rtMedian(st.rt);
      h += '<p><b>' + stEsc(st.nurUeben ? t('Übung beendet.') : t('Danke für deine Teilnahme!')) + '</b></p>'
        + '<p>' + stEsc(t('Deine Reaktionszeit (Median)')) + ': <b>' + (med ? Math.round(med) + ' ms' : '–') + '</b> · '
        + stEsc(t('Frühstarts')) + ': ' + st.frueh + '</p>'
        + (st.fehler ? '<p class="muted">' + stEsc(st.fehler) + '</p>' : '')
        + (st.nurUeben ? '' : studieErgebnisHtml())
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
    // v1.1.3: danach die Fahrverhaltens-Challenge (oder ohne Fahrt abschliessen).
    st.schritt = 'fahrt-info';
    studieZeichnen();
  }
  // Die Daten der Studie; mit Fahrt kommen Rundenzeiten und Fahrstil dazu.
  function studieDaten() {
    const w = narqWerte(st.narq);
    const daten = { art: 'studie', alter: st.alter, geschlecht: st.geschlecht, volljaehrig: true, einwilligung: true,
      narq: st.narq, narqVersion: NARQ_VERSION, bewunderung: w.bewunderung, rivalitaet: w.rivalitaet, selbst: st.selbst,
      rt_ms: st.rt, rt_median: rtMedian(st.rt), fruehstarts: st.frueh, verpasst: st.verpasst,
      quelle: st.quelle, controller: String(st.controller).slice(0, 80),
      version: (($('app-version') || {}).textContent || '').slice(0, 20), sprache: typeof lang === 'string' ? lang : '' };
    if (st.fahrt) daten.fahrt = st.fahrt;
    if (st.fahrtVirtuell) daten.fahrt_virtuell = st.fahrtVirtuell;
    return daten;
  }
  // v1.1.3: aus 72-challenges.js, wenn die Studienfahrt endet.
  function studieFahrtFertig(erg, stil) {
    if (!st || st.schritt !== 'fahrt-laeuft') return;
    const virtuell = st.fahrtArt === 'virtuell';
    // Virtuelle Fahrt mit Escape/✕ beendet: abgebrochen, nicht gewertet - zurueck zur Auswahl.
    if (virtuell && typeof VF !== 'undefined' && VF.abbruch) {
      st.schritt = st.fahrt ? 'fahrt-mehr' : 'fahrt-info'; st.fahrtArt = null;
      studieZurueckZeigen();
      return;
    }
    const r = Array.isArray(erg.runden) ? erg.runden.map(Math.round) : [];
    const fahrt = { strecke: 'studie-homington', art: virtuell ? 'virtuell' : 'bahn', preset: erg.preset || 'simplus', gueltig: !!erg.gueltig,
                    grund: erg.gueltig ? '' : String(erg.grund || '').slice(0, 60), runden_ms: r.slice(0, 12),
                    beste_ms: r.length ? Math.min.apply(null, r) : null, gesamt_ms: erg.gueltig ? Math.round(erg.zeit) : null,
                    stil: stil || null };
    if (virtuell) st.fahrtVirtuell = fahrt; else st.fahrt = fahrt;
    st.fahrtArt = null;
    // Die virtuelle Fahrt endet mit der Challenge (einen Takt spaeter: die Challenge raeumt noch auf).
    if (virtuell && typeof vfAktiv === 'function' && vfAktiv()) setTimeout(() => { virtuellBeenden(); studieZurueckZeigen(); }, 0);
    if (st.fahrt && st.fahrtVirtuell) { studieZurueckZeigen(); studieAbschliessen(); return; }
    st.schritt = 'fahrt-mehr';
    studieZurueckZeigen();
  }
  function studieZurueckZeigen() {
    showTab('options');
    if (typeof subpageZeigen === 'function') subpageZeigen('opt-studie');
    studieZeichnen();
  }
  function studieAbschliessen() {
    const daten = studieDaten();
    const d = studieLesen();
    d.gesendet = new Date().toISOString();
    d.ausstehend = daten;
    studieSchreiben(d);
    st.schritt = 'senden';
    studieZeichnen();
    studieSenden(daten, false);
  }
  // ---- AKTUELLER STAND ALLER TEILNEHMENDEN (v1.1.3) -----------------------------------------
  // BESTELLT: "Fahrverhaltens-Challenge (keine Nicknames, aktuelle Ergebnisse danach)". Der Server
  // liefert nur Zusammenfassungen (?studie=zusammenfassung): Anzahl, Mittel und Spanne je Kennwert
  // und die Korrelationen der Hypothesen - erst ab 5 Teilnehmenden.
  const STUDIE_KENNWERTE = [['rivalitaet', 'Rivalität', 2], ['bewunderung', 'Bewunderung', 2], ['rt_median', 'Reaktionszeit (ms)', 0],
    ['beste_ms', 'Beste Runde (s)', -3], ['vollgas', 'Vollgas-Anteil', 'p'], ['bremsKurve', 'Bremsen in der Kurve', 'p'],
    ['abfluege', 'Abflüge je Minute', 2], ['lenkUnruhe', 'Lenkunruhe', 2], ['rundenStreu', 'Streuung der Rundenzeiten', 'p']];
  const STUDIE_HYPOTHESEN = {
    H1a: 'Rivalität ↔ Bremsen in der Kurve', H1b: 'Rivalität ↔ Abflüge', H2: 'Bewunderung ↔ Selbstüberschätzung',
    H3: 'Rivalität ↔ Vollgas-Anteil', H4: 'Reaktionszeit ↔ beste Runde', H5: 'Lenkunruhe ↔ Streuung der Rundenzeiten' };
  function studieZusammenfassungHolen() {
    const url = (chOnline() || {}).url;
    if (!url) return;
    fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'studie=zusammenfassung')
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { st.zusammenfassung = j; if (st.schritt === 'danke') studieZeichnen(); } })
      .catch(() => { /* ohne Netz: nur die eigenen Werte */ });
  }
  function studieEigeneWerte() {
    const w = narqWerte(st.narq), f = st.fahrt || {}, s = f.stil || {};
    return { rivalitaet: w.rivalitaet, bewunderung: w.bewunderung, rt_median: rtMedian(st.rt), beste_ms: f.beste_ms,
             vollgas: s.vollgas, bremsKurve: s.bremsKurve, abfluege: s.abfluege, lenkUnruhe: s.lenkUnruhe, rundenStreu: s.rundenStreu };
  }
  function studieZahl(x, art) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    if (art === 'p') return Math.round(x * 100) + ' %';
    if (art === -3) return (x / 1000).toFixed(2);
    return Number(x).toFixed(art);
  }
  function studieErgebnisHtml() {
    const ich = studieEigeneWerte(), z = st.zusammenfassung;
    let h = '<h3 class="k-zwischen">' + stEsc(t('Deine Werte und alle Teilnehmenden')) + '</h3>';
    h += '<table class="stat-tabelle"><thead><tr><th>' + stEsc(t('Kennwert')) + '</th><th>' + stEsc(t('Du')) + '</th><th>'
      + stEsc(t('Mittel aller')) + '</th><th>' + stEsc(t('Spanne')) + '</th></tr></thead><tbody>'
      + STUDIE_KENNWERTE.map(([k, name, art]) => {
        const a = z && z.kennwerte ? z.kennwerte[k] : null;
        return '<tr><td>' + stEsc(t(name)) + '</td><td data-i18n-skip>' + studieZahl(ich[k], art) + '</td><td data-i18n-skip>'
          + (a ? studieZahl(a.mittel, art) : '–') + '</td><td data-i18n-skip>' + (a ? studieZahl(a.min, art) + ' – ' + studieZahl(a.max, art) : '–') + '</td></tr>';
      }).join('') + '</tbody></table>';
    if (!z) return h + '<p class="muted">' + stEsc(t('Der Stand aller Teilnehmenden wird geladen …')) + '</p>';
    h += '<p class="muted">' + stEsc(t('Teilnehmende bisher')) + ': <b data-i18n-skip>' + (z.n || 0) + '</b></p>';
    if (z.hypothesen && Object.keys(z.hypothesen).length) {
      h += '<h3 class="k-zwischen">' + stEsc(t('Aktueller Stand der Hypothesen')) + '</h3><table class="stat-tabelle"><tbody>'
        + Object.keys(STUDIE_HYPOTHESEN).map((k) => {
          const x = z.hypothesen[k];
          return '<tr><td data-i18n-skip>' + k + '</td><td>' + stEsc(t(STUDIE_HYPOTHESEN[k])) + '</td><td data-i18n-skip>'
            + (x && x.n >= 5 && isFinite(x.r) ? 'r = ' + x.r.toFixed(2) + ' (n = ' + x.n + ')' : '–') + '</td></tr>';
        }).join('') + '</tbody></table>'
        + '<p class="muted">' + stEsc(t('Korrelationen ab 5 Teilnehmenden. Ohne Namen, nur zusammengefasst.')) + '</p>';
    }
    return h;
  }
  function studieSenden(daten, still) {
    const url = (chOnline() || {}).url;
    if (!url) { if (!still) { st.fehler = t('Keine Adresse für den Upload eingestellt; die Daten bleiben auf dem Gerät.'); st.schritt = 'danke'; studieZeichnen(); } return; }
    fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ geraet: chGeraet() }, daten)) })
      .then((r) => r.json())
      .then((j) => {
        if (!j || !j.ok) throw new Error((j && j.fehler) || 'abgelehnt');
        const d = studieLesen(); d.ausstehend = null; studieSchreiben(d);
        if (!still) { st.schritt = 'danke'; studieZeichnen(); studieZusammenfassungHolen(); }
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
    else if (a === 'fahren' || a === 'fahren-virtuell') {
      const zurueck = st.schritt;
      st.schritt = 'fahrt-laeuft';
      st.fahrtArt = a === 'fahren-virtuell' ? 'virtuell' : 'bahn';
      if (typeof studieChallengeStarten !== 'function' || !studieChallengeStarten(st.fahrtArt === 'virtuell')) {
        st.schritt = zurueck; st.fahrtArt = null;
      }
    } else if (a === 'ohne-fahrt') { st.fahrt = null; st.fahrtVirtuell = null; studieAbschliessen(); return; }
    else if (a === 'abschliessen') { studieAbschliessen(); return; }
    studieZeichnen();
  }
  // v1.0.12 BESTELLT: "Studie erstmal nur zum Testen drin haben." Die Kachel erscheint nur im
  // Entwicklermodus (Optionen > Entwickler bzw. ?dev in der Adresse).
  // v1.1.3: fuer alle sichtbar (WIP) - Kontakt und Einwilligungstext stehen, das Apps Script ist erneuert.
  function studieKachelZeigen() {
    const k = $('opt-studie-kachel');
    if (k) k.hidden = false;
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
