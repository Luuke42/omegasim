  // ============================== RUMBLE-MISCHUNG WIE LIBRECORSA (v1.6.5) ==============================
  //
  // BESTELLT: "Mache, dass die Vibrationen der normalen Rumble Motoren und der haptic triggers so wie bei LibreCorsa.org
  // sind. Wir haben jetzt auch AGPL, koennen also auch Code von LibreCorsa uebernehmen." Die Mischung folgt
  // KhazP/librecorsa (AGPL-3.0), src/lib/sim/gamepad-haptics.ts (hapticMagnitudes, layerRumble) und
  // src/lib/sim/dualsense-feedback.ts, uebertragen auf die Zustaende von OmegaSim:
  //   schwacher Motor (hoch): Randstein-Pulse (bis 15 Hz), Schieben der Vorderraeder ueber der Haftgrenze;
  //   starker Motor (tief):   Stoss (Huellkurve, klingt in 0,1 s ab), ausbrechendes Heck bzw. durchdrehende Raeder,
  //                            ABS, rauer Boden neben der Bahn, dazu 60 % des Randstein-Pulses.
  // Die Cues werden "in den Rest" geschichtet (acc + e * (1 - acc)): nichts uebersteuert, nichts uebertoent. Gesendet
  // wird hoechstens alle RM.takt ms ein Effekt von RM.dauer ms (wie LibreCorsa: 60/90 ms), nur bei Aenderung.
  // Jeder Cue haengt an seiner Art in Optionen > Vibration (RUMBLE_ARTEN), auch im virtuellen Fahren:
  //   Randstein 'kerb', Schieben 'untersteuern', Heck/Durchdrehen 'rutschen', ABS 'abs', Boden 'abseits', Stoss 'crash'.
  // Einzelereignisse (Schalten, Box, Meldung) gehen weiter ueber padRumble; im Takt des Mischers werden sie als kurze
  // Huellkurve beigemischt (rmImpuls), damit der naechste Mischtakt sie nicht abschneidet.
  const RM = { takt: 60, dauer: 90, eps: 0.03, kerbHz: 12, kerbMaxHz: 15, stossAbklingS: 0.1 };
  const rmZ = { kerbPhase: 0, stoss: 0, stossW: 0, impulsBis: 0, impulsS: 0, impulsW: 0, letztS: 0, letztW: 0,
                gesendetAt: 0, letztTick: 0, laeuft: false };
  function rmSmooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  function rmSchicht(acc, e) { e = Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0; return acc + e * (1 - acc); }
  function rmArt(art) { return !(typeof RUMBLE_ARTEN !== 'undefined' && RUMBLE_ARTEN[art] === false); }
  // Der Mischer uebernimmt das Dauer-Rumble, sobald gefahren wird: virtuell, oder im Cockpit mit Physik.
  function rumbleMixAktiv() {
    if (typeof rumbleOn !== 'undefined' && !rumbleOn) return false;
    if (typeof VF !== 'undefined' && VF.aktiv) return true;
    return !!(typeof physicsEnabled !== 'undefined' && physicsEnabled && document.querySelector('#tab-race.active'));
  }
  // Ein Einzelereignis als kurze Huellkurve (padRumble ruft das, solange der Mischer laeuft).
  function rmImpuls(stark, schwach, ms) {
    const jetzt = performance.now();
    rmZ.impulsBis = Math.max(rmZ.impulsBis, jetzt + Math.max(30, ms || 60));
    rmZ.impulsS = Math.max(rmZ.impulsBis > jetzt ? rmZ.impulsS : 0, stark || 0);
    rmZ.impulsW = Math.max(rmZ.impulsBis > jetzt ? rmZ.impulsW : 0, schwach || 0);
  }
  // Ein Stoss (Aufprall, Beruehrung): setzt die Huellkurve, die in RM.stossAbklingS abklingt.
  function rmStoss(staerke) { rmZ.stoss = Math.max(rmZ.stoss, Math.max(0, Math.min(1, staerke))); }
  // Die Cues aus dem laufenden Zustand. Rein bis auf rmZ (Phase, Huellkurven), dt in s.
  function rmCues(dt) {
    const c = { kerb: 0, schieben: 0, heck: 0, abs: 0, boden: 0 };
    if (typeof VF !== 'undefined' && VF.aktiv) {
      const P = VF.P || (typeof VF_GT3 !== 'undefined' ? VF_GT3 : null), z = VF.dyn || {};
      const kmh = Math.abs((physEngine.state.speedKmh || 0) * TACHO_SCALE * (VF.tempoFaktor || 1));
      if (VF.kerbJetzt && kmh > 3) c.kerb = (0.55 + 0.35 * Math.min(1, kmh / 300));
      if (P && P.C && P.BV) {
        const spV = Math.tan(Math.PI / (2 * P.C)) / P.BV, spH = Math.tan(Math.PI / (2 * P.C)) / P.BH;
        c.schieben = 0.4 * rmSmooth(0.95, 1.3, Math.abs(z.aV || 0) / spV);
        c.heck = 0.45 * rmSmooth(1.0, 1.6, Math.abs(z.aH || 0) / spH);
      }
      if (VF.abseits) c.boden = 0.4 * 0.6 * rmSmooth(10, 90, kmh);
    } else {
      const st = physEngine && physEngine.state;
      if (st) {
        c.schieben = 0.4 * rmSmooth(1.0, 1.35, st.pacNutzV || 0);
        const um = (physEngine.config && physEngine.config.pacejkaUeberMax) || 0.35;
        c.heck = 0.45 * Math.min(1, (st.pacUeber || 0) / um);
        if (st.pacLeistung) c.heck = Math.max(c.heck, 0.6 * Math.min(1, (st.pacUeber || 0) / um));
        if (st.absActive) c.abs = 0.5;
      }
    }
    // Randstein-Puls: die Phase laeuft mit ihrer Rate weiter (kein Sprung bei Tempowechsel).
    rmZ.kerbPhase = (rmZ.kerbPhase + Math.min(RM.kerbMaxHz, RM.kerbHz) * dt) % 1;
    rmZ.stoss *= dt > 0 ? Math.exp(-dt / RM.stossAbklingS) : 1;
    return c;
  }
  // Mischt die Cues zu den zwei Motorstaerken (stark = tiefer/linker, schwach = hoher/rechter Motor).
  function rmMischen(c) {
    const kerbAn = rmArt('kerb') && c.kerb > 0 && rmZ.kerbPhase < 0.5 ? c.kerb : 0;
    let schwach = rmSchicht(0, kerbAn);
    schwach = rmSchicht(schwach, rmArt('untersteuern') ? c.schieben : 0);
    let stark = rmSchicht(0, rmArt('crash') ? rmZ.stoss : 0);
    stark = rmSchicht(stark, rmArt('abs') ? c.abs : 0);
    stark = rmSchicht(stark, rmArt('rutschen') ? c.heck : 0);
    stark = rmSchicht(stark, rmArt('abseits') ? c.boden : 0);
    stark = rmSchicht(stark, 0.6 * kerbAn);
    if (performance.now() < rmZ.impulsBis) { stark = rmSchicht(stark, rmZ.impulsS); schwach = rmSchicht(schwach, rmZ.impulsW); }
    return { stark, schwach };
  }
  function rmTick() {
    const jetzt = performance.now();
    const dt = rmZ.letztTick ? Math.min(0.25, (jetzt - rmZ.letztTick) / 1000) : RM.takt / 1000;
    rmZ.letztTick = jetzt;
    if (!rumbleMixAktiv()) {
      if (rmZ.letztS || rmZ.letztW) { rmZ.letztS = 0; rmZ.letztW = 0; }
      rmZ.laeuft = false;
      return;
    }
    rmZ.laeuft = true;
    const m = rmMischen(rmCues(dt));
    rmZ.letztS = m.stark; rmZ.letztW = m.schwach;
    // Nur der Gamepad-API-Weg; der DualSense (80b) liest rmZ.letztS/letztW fuer seine Griffmotoren selbst.
    if (m.stark < 0.02 && m.schwach < 0.02 && jetzt - rmZ.gesendetAt > RM.dauer) return;
    try {
      ruettle({ duration: RM.dauer, startDelay: 0, strongMagnitude: m.stark, weakMagnitude: m.schwach }, rumblePad(1));
      rmZ.gesendetAt = jetzt;
    } catch (e) { /* ohne Pad */ }
  }
  setInterval(rmTick, RM.takt);
