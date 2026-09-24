  // ============================ ZAHLENSYSTEME-TRAINER (WIP) ========================
  //
  // BESTELLT: "Binaer- und Hexadezimal-Trainer, bei denen jeweils vierstellige Zahlen
  // aus dem jeweiligen System gezeigt werden, die dann in Dezimalzahlen uebersetzt
  // werden muessen." Beide Trainer teilen dieselbe Logik, nur Basis und Element-ids
  // unterscheiden sich.

  function numTrainerState(basis, ids) {
    return { basis, ids, ziffern: 4, wert: 0, versucht: 0, richtig: 0, beantwortet: false };
  }
  const ntBin = numTrainerState(2, {
    zahl: 'nt-bin-zahl', input: 'nt-bin-input', check: 'nt-bin-check',
    neu: 'nt-bin-neu', feedback: 'nt-bin-feedback', score: 'nt-bin-score',
  });
  const ntHex = numTrainerState(16, {
    zahl: 'nt-hex-zahl', input: 'nt-hex-input', check: 'nt-hex-check',
    neu: 'nt-hex-neu', feedback: 'nt-hex-feedback', score: 'nt-hex-score',
  });

  function numTrainerNeueZahl(st) {
    st.wert = Math.floor(Math.random() * Math.pow(st.basis, st.ziffern));
    st.beantwortet = false;
    if ($(st.ids.zahl)) {
      $(st.ids.zahl).textContent = st.wert.toString(st.basis).toUpperCase().padStart(st.ziffern, '0');
    }
    if ($(st.ids.input)) $(st.ids.input).value = '';
    if ($(st.ids.feedback)) {
      $(st.ids.feedback).textContent = ' ';
      $(st.ids.feedback).className = 'numtrain-feedback';
    }
    if ($(st.ids.input)) $(st.ids.input).focus();
  }

  function numTrainerScoreRender(st) {
    const el = $(st.ids.score);
    if (!el) return;
    el.textContent = st.versucht === 0
      ? t('Noch keine Antwort.')
      : t('__R__ von __V__ richtig.').replace('__R__', st.richtig).replace('__V__', st.versucht);
  }

  function numTrainerCheck(st) {
    if (st.beantwortet) return; // erst "Neue Zahl", dann zaehlt die naechste Antwort
    const inputEl = $(st.ids.input);
    if (!inputEl) return;
    const antwort = parseInt(inputEl.value, 10);
    if (!Number.isFinite(antwort)) return;
    st.beantwortet = true;
    st.versucht++;
    const feedback = $(st.ids.feedback);
    if (antwort === st.wert) {
      st.richtig++;
      if (feedback) { feedback.textContent = t('Richtig!'); feedback.className = 'numtrain-feedback on-ok'; }
    } else if (feedback) {
      feedback.textContent = t('Leider nicht - richtig wäre __X__ gewesen.').replace('__X__', st.wert);
      feedback.className = 'numtrain-feedback on-bad';
    }
    numTrainerScoreRender(st);
  }

  function numTrainerWire(st) {
    if ($(st.ids.check)) $(st.ids.check).addEventListener('click', () => numTrainerCheck(st));
    if ($(st.ids.neu)) $(st.ids.neu).addEventListener('click', () => numTrainerNeueZahl(st));
    if ($(st.ids.input)) $(st.ids.input).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); numTrainerCheck(st); }
    });
  }

  numTrainerWire(ntBin);
  numTrainerWire(ntHex);
  numTrainerNeueZahl(ntBin);
  numTrainerNeueZahl(ntHex);
  i18nOnLangChange(() => { numTrainerScoreRender(ntBin); numTrainerScoreRender(ntHex); });

