
  // Lokale Rennpause: Rennzustand bleibt erhalten. Nur diese eigene Uhr steht;
  // Date.now()/performance.now() fuer Funk-Wachhund und Netzwerk bleiben echt.
  const rennPause = {
    phase: 'aus', verzug: 0, wandStart: 0, uhrStop: 0,
    generation: 0, ampelTimer: [], zeitTimer: new Set(),
    padVorher: {}, padSperre: {}, gasWarten: {}, inputWarten: new Set(), steerWarten: new Set(),
    letzterDruck: -Infinity, statusVorher: '', erststart: false, flagRestart: false,
    letzterHalt: -Infinity
  };

  function rennPauseAktiv() { return rennPause.phase !== 'aus'; }

  function rennZeitJetzt() {
    return rennPauseAktiv() ? rennPause.uhrStop : Date.now() - rennPause.verzug;
  }

  // ---- DER VERZUG GILT NUR FUER EIN RENNEN (v1.2.25) ----------------------------------
  // verzug ist die Summe aller Pausen. Er wuchs bisher ueber die ganze Sitzung und wurde nie
  // zurueckgesetzt - und der WLAN-Mehrspieler rechnet seine Startzeit in WANDUHR (r.startAt -
  // mp.offset, 97-sessions.js), die startRaceCountdown() dann gegen rennZeitJetzt() legt. Nach
  // einer frueheren lokalen Pause lag Gruen damit auf diesem Telefon um genau diese Pausen
  // spaeter als auf den anderen. Deshalb beim Rennstart auf 0: im Rennen gilt danach
  // rennZeitJetzt() === Date.now(), solange niemand pausiert, und im Mehrspieler kann niemand
  // pausieren (rennPauseErlaubt, rennPauseWache). Wartende Renn-Timeouts behalten dabei ihren
  // Wanduhr-Zeitpunkt, nur ihre Zielzeit wird in die neue Zaehlung umgerechnet.
  function rennUhrNullen() {
    if (rennPauseAktiv() || !rennPause.verzug) return;
    const v = rennPause.verzug;
    for (const z of rennPause.zeitTimer) z.bei += v;
    rennPause.verzug = 0;
  }

  // Pausierbare Renn-Timeouts; Browser-Timeouts selbst bleiben unveraendert.
  function rennZeitTimerStart(z) {
    if (z.abgebrochen || rennPauseAktiv()) return;
    z.native = setTimeout(() => {
      z.native = null;
      if (z.abgebrochen || rennPauseAktiv()) return;
      rennPause.zeitTimer.delete(z);
      z.fn(...z.args);
    }, Math.max(0, z.bei - rennZeitJetzt()));
  }

  function rennZeitTimeout(fn, ms, ...args) {
    const z = { rennZeitTimer: true, fn, args, native: null, abgebrochen: false,
      bei: rennZeitJetzt() + Math.max(0, Number(ms) || 0) };
    rennPause.zeitTimer.add(z);
    rennZeitTimerStart(z);
    return z;
  }

  function rennZeitTimeoutStop(z) {
    if (!z || !z.rennZeitTimer) { clearTimeout(z); return; }
    z.abgebrochen = true;
    if (z.native !== null) clearTimeout(z.native);
    z.native = null;
    rennPause.zeitTimer.delete(z);
  }

  function rennPauseTimerHalten() {
    for (const z of rennPause.zeitTimer) {
      if (z.native !== null) clearTimeout(z.native);
      z.native = null;
    }
  }

  function rennPauseTimerWeiter() {
    for (const z of [...rennPause.zeitTimer]) rennZeitTimerStart(z);
  }

  function rennPauseAmpelAbbrechen() {
    rennPause.generation++;
    rennPause.ampelTimer.forEach(clearTimeout);
    rennPause.ampelTimer = [];
  }

  function rennPauseMehrspieler() {
    try { return !!mp.an || !!mpi.an; } catch (_) { return false; }
  }

  // Verbundene Autos allein reichen nicht: Pause nur in der Fahr-/Rennansicht.
  function rennPauseFahransicht() {
    const tab = document.querySelector('.tabpage.active');
    return !!tab && tab.id === 'tab-race';
  }

  // Mehrspieler und Pause schliessen sich aus: eine Pause hielte nur DIESES Telefon an, die
  // anderen fuehren weiter, und die gemeinsame Uhr (Startzeit, Wetterplan, Rangliste) waere
  // nicht mehr gemeinsam. rennPauseErlaubt() verhindert das Beginnen; diese Wache beendet eine
  // lokale Pause, die schon lief, als der Mehrspieler dazukam (Beitritt, Startplan des Hosts).
  // Ohne Ampel: der Ablauf des Hosts geht vor, Gas und Lenkung muessen trotzdem erst neutral.
  function rennPauseWache() {
    if (!rennPauseAktiv() || !rennPauseMehrspieler()) return false;
    rennPauseBeenden();
    try { showHudToast(t('Pause beendet: Mehrspieler aktiv')); } catch (_) { /* ohne Hinweis */ }
    return true;
  }

  function rennPauseErlaubt() {
    if (!rennPauseFahransicht() || rennPauseMehrspieler()) return false;
    try {
      if (calibRunning) return false; // eigener zeitkritischer Kalibrierlauf
      return ['countdown', 'racing', 'finishing'].includes(raceState)
        || (typeof vfAktiv === 'function' && vfAktiv())
        || garage.some(c => c && c.rx);
    } catch (_) { return false; }
  }

  function rennPauseMotorHalten(m) {
    if (!m || !m.state) return;
    // Kein reset(): Gang, Tank, Reifen, Schaden, Runden bleiben erhalten.
    const st = m.state;
    for (const k of ['speedKmh', 'virtualSpeed', 'speed', 'throttle',
      'throttleSmooth', 'smoothedThrottle', 'acceleration', 'accel', 'accelG',
      'gLong', 'gLat', 'longUse', 'lateralG']) {
      if (typeof st[k] === 'number') st[k] = 0;
    }
  }

  function rennPauseEingabenSperren() {
    rennPause.gasWarten = { 1: true, 2: true, 3: true };
    rennPause.steerWarten.add("p2"); rennPause.steerWarten.add("p3");
    for (const source of Object.values(SRC)) {
      if (source !== SRC.MACRO) {
        rennPause.inputWarten.add(source); rennPause.steerWarten.add(source);
      }
    }
    if (typeof keys !== 'undefined') keys.clear();
    releaseAllInputs();
    if (playing) macroWert = { steer: 0, throttle: 0 };
    rennPauseMotorHalten(physEngine);
    physOutThrottle = 0; physOutSteer = 0; physLastTime = null;
    Object.assign(rcLage, rcLageNeu());
    for (const z of zusatzPlaetze()) {
      z.throttle = 0; z.steer = 0; z.outThrottle = 0; z.outSteer = 0; z.lastTime = null;
      rennPauseMotorHalten(z.motor);
      if (z.rcLage) Object.assign(z.rcLage, rcLageNeu());
    }
    for (const c of garage) if (c.ghost) rennPauseMotorHalten(c.ghost.engine);
    if (typeof VF !== 'undefined' && VF.aktiv) {
      VF.dyn = { vy: 0, r: 0 }; VF.ax = 0; VF.ay = 0;
    }
    if (typeof simState !== 'undefined' && simState) simState.wandZuvor = rennZeitJetzt();
  }

  function rennPauseFilterGas(nr, gas, bremse) {
    if (rennPauseAktiv()) return [0, 0];
    if (rennPause.gasWarten[nr]) {
      if (Math.abs(gas) < 0.001 && Math.abs(bremse) < 0.001) {
        rennPause.gasWarten[nr] = false;
      } else return [0, 0];
    }
    return [gas, bremse];
  }

  function rennPauseInput(source, value) {
    if (rennPauseAktiv()) return false;
    if (rennPause.inputWarten.has(source)) {
      if (Math.abs(value) <= INPUT_NEUTRAL_EPS) rennPause.inputWarten.delete(source);
      else return false;
    }
    return true;
  }

  function rennPauseLenkung(source, value) {
    if (rennPauseAktiv()) return false;
    if (rennPause.steerWarten.has(source)) {
      if (Math.abs(value) <= INPUT_NEUTRAL_EPS) rennPause.steerWarten.delete(source);
      else return false;
    }
    return true;
  }

  function rennPausePaket(payload) {
    if (!rennPauseAktiv() || !payload || payload.length !== 20 || payload[0] !== 0xaf) {
      return payload;
    }
    const p = new Uint8Array(payload);
    p[6] = 0xdf; p[7] = 0; p[9] = 0; p[14] |= LIGHT_BRAKE;
    p[19] = crc8(Array.from(p.slice(0, 19)));
    return p;
  }

  function rennPauseSenden(sofort = false) {
    const jetzt = performance.now();
    // Alle sofort neutralisieren; danach 10 Hz je Auto statt das Funkbudget zu fluten.
    if (!sofort && jetzt - rennPause.letzterHalt < 100) return;
    rennPause.letzterHalt = jetzt;
    const ziele = new Set(garage.filter(c => c && c.rx).map(c => c.rx));
    if (playerCar && playerCar.rx) ziele.add(playerCar.rx);
    try {
      const entry = charByUuid.get(controlSelect.value);
      if (entry && entry.char) ziele.add(entry.char);
    } catch (_) { /* kein Explorer-Steuerziel */ }
    for (const rx of ziele) {
      Promise.resolve(funkSchreiben(rx, buildCommandPacket(0, 0), null)).catch(() => {});
    }
  }

  function rennPauseTaste(pad, belegung, nr) {
    const binding = belegung && belegung.pause;
    const gedrueckt = !!pad && binding && binding.type === 'button'
      && readBindingValue(pad, binding) > BUTTON_CAPTURE_THRESHOLD;
    const vorher = !!rennPause.padVorher[nr];
    rennPause.padVorher[nr] = !!gedrueckt;
    // Nach Belegung erst loslassen, damit der Erfassungsdruck nicht pausiert.
    if (rennPause.padSperre[nr]) {
      if (!gedrueckt) rennPause.padSperre[nr] = false;
      return rennPauseAktiv();
    }
    // Menue-Eingaben still ignorieren, auch bei einer bereits aktiven Pause.
    // Die Flanke oben trotzdem merken: gehaltene Taste darf beim Wechsel ins
    // Cockpit keine Pause oder Wiederanlaufampel nachtraeglich ausloesen.
    if (!rennPauseFahransicht()) return rennPauseAktiv();
    if (gedrueckt && !vorher) {
      const now = performance.now();
      // Zwei Spieler im selben Poll duerfen Pause nicht sofort wieder aufheben.
      if (now - rennPause.letzterDruck >= 250) {
        rennPause.letzterDruck = now;
        rennPauseUmschalten();
      }
    }
    return rennPauseAktiv();
  }

  function rennPauseLicht(stufe) {
    setRaceLights(stufe);
    const el = document.getElementById('renn-pause-ui');
    if (!el) return;
    el.querySelectorAll('[data-pause-lampe]').forEach(dot => {
      const n = Number(dot.dataset.pauseLampe);
      dot.style.background = stufe === 'go' ? '#39c878'
        : (n <= Number(stufe) ? '#e53935' : '#424854');
      dot.style.boxShadow = stufe === 'go' ? '0 0 12px #39c878'
        : (n <= Number(stufe) ? '0 0 12px #e53935' : '');
    });
  }

  function rennPauseMalen() {
    const knopf = document.getElementById('race-act-pause');
    if (knopf) {
      knopf.disabled = !rennPauseAktiv() && !rennPauseErlaubt();
      const text = rennPause.phase === 'ampel' ? t('Wiederanlauf stoppen')
        : (rennPauseAktiv() ? t('Fortsetzen') : t('Pause'));
      // v1.2.30: ein Symbol oben rechts statt eines Schriftzugs (Pause = zwei Balken, Fortsetzen =
      // Dreieck, Wiederanlauf stoppen = Quadrat). Der Name steht im title/aria-label. WIP-Kennzeichen
      // von Anfang an, hier winzig. Nur bei Aenderung schreiben, das laeuft im Takt von updateRaceActButtons().
      const form = rennPause.phase === 'ampel' ? '<rect x="7" y="7" width="10" height="10" rx="1"/>'
        : (rennPauseAktiv() ? '<path d="M8 5.5v13l10.5-6.5z"/>' : '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>');
      const html = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + form + '</svg><span class="wip-tag">WIP</span>';
      if (knopf.dataset.pauseHtml !== html) { knopf.dataset.pauseHtml = html; knopf.innerHTML = html; }
      knopf.title = text + ' (WIP)';
      knopf.setAttribute('aria-label', text);
      knopf.classList.toggle('an', rennPauseAktiv());
    }
    const el = document.getElementById('renn-pause-ui');
    if (!el) return;
    el.hidden = !rennPauseAktiv();
    const ampel = rennPause.phase === 'ampel';
    document.getElementById('renn-pause-titel').textContent = ampel ? t('Wiederanlauf') : t('Pausiert');
    document.getElementById('renn-pause-hinweis').textContent = ampel
      ? t('Alle Autos bleiben bis zur grünen Ampel gesperrt.')
      : t('Fahr-Ausgabe und Rennabläufe sind angehalten. Nach der Ampel Gas und Bremse zunächst loslassen.');
    document.getElementById('renn-pause-weiter').textContent = ampel
      ? t('Wiederanlauf stoppen') : t('Weiter über Rennampel');
    // Das Overlay haengt an body, ausserhalb der Wurzeln von i18nApply(): ohne t() bliebe
    // "Beenden" auch im englischen und spanischen Modus deutsch.
    const ende = document.getElementById('renn-pause-ende');
    if (ende) ende.textContent = t('Beenden');
  }

  // Nur Abbruch oder Ampelfreigabe: kein raceGreen() fuer ein laufendes Rennen.
  function rennPauseBeenden() {
    if (!rennPauseAktiv()) return;
    rennPauseAmpelAbbrechen();
    rennPauseSenden(true); // noch mit aktiver Paketsperre
    rennPause.verzug += Date.now() - rennPause.wandStart;
    rennPause.phase = 'aus';
    rennPauseEingabenSperren();
    if (typeof window.OMEGA_BRUECKE.rennPause === 'function') {
      window.OMEGA_BRUECKE.rennPause(false);
    }
    rennPauseTimerWeiter();
    if ($('race-status')) $('race-status').textContent = rennPause.statusVorher;
    rennPauseMalen();
  }

  function rennPauseUmschalten() {
    if (rennPause.phase === 'ampel') {
      rennPauseAmpelAbbrechen();
      rennPause.phase = 'pause';
      rennPauseSenden(true); rennPauseMalen(); rennPauseLicht(0);
      return;
    }
    if (rennPause.phase === 'aus') {
      if (!rennPauseErlaubt()) {
        showHudToast(rennPauseMehrspieler() ? t('Pause nur im lokalen Betrieb verfügbar')
          : t('Aktuell kein pausierbarer Fahrbetrieb'));
        return;
      }
      rennPause.uhrStop = rennZeitJetzt();
      rennPause.wandStart = Date.now();
      rennPause.erststart = raceState === 'countdown';
      rennPause.flagRestart = flagState === 'restart';
      rennPause.statusVorher = $('race-status') ? $('race-status').textContent : '';
      rennPause.phase = 'pause';
      if (typeof window.OMEGA_BRUECKE.rennPause === 'function') {
        window.OMEGA_BRUECKE.rennPause(true);
      }
      rennPauseTimerHalten();
      if (rennPause.erststart) {
        rennZeitTimeoutStop(raceCountdownTimer); raceCountdownTimer = null;
        ampelPlan = null; ampelSchritt = null;
        // Ein laufendes Rennintro (80d-rennintro.js) ebenfalls abbrechen: es spielt auf der
        // Audiouhr weiter und wuerde danach die Startampel MITTEN in der Pause beginnen. Die
        // Generation zuerst, damit sein "weiter" in startRaceCountdown() nichts mehr tut; den
        // Start uebernimmt die Wiederanlaufampel (raceGreen()).
        if (typeof rennintroAbbrechen === 'function') {
          rennintroStartGeneration++;
          rennintroAbbrechen();
        }
      }
      rennPauseEingabenSperren(); rennPauseSenden(true);
      if ($('race-status')) $('race-status').textContent = t('Pausiert');
      rennPauseMalen(); rennPauseLicht(0);
      return;
    }
    rennPause.phase = 'ampel';
    rennPauseAmpelAbbrechen();
    const gen = rennPause.generation;
    const gueltig = () => rennPause.phase === 'ampel' && rennPause.generation === gen;
    rennPauseMalen();
    for (let i = 1; i <= 5; i++) {
      rennPause.ampelTimer.push(setTimeout(() => {
        if (!gueltig()) return;
        rennPauseLicht(i);
        ampelTon(440 + (i - 1) * 60, 0.18, 'square', 0.18);
      }, 600 + (i - 1) * 1000));
    }
    const warte = 4600 + 1000 + Math.random() * 2000;
    rennPause.ampelTimer.push(setTimeout(() => {
      if (!gueltig()) return;
      const erststart = rennPause.erststart, flagRestart = rennPause.flagRestart;
      rennPauseBeenden(); rennPauseLicht('go');
      ampelTon(880, 0.35, 'square', 0.22);
      if (erststart && raceState === 'countdown') raceGreen();
      else if (flagRestart && flagState === 'restart') setFlag('green');
      rennZeitTimeout(() => { if (!rennPauseAktiv()) setRaceLights(0); }, 900);
    }, warte));
  }
