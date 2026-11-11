  // ============================== ZUFALLSEVENTS (v1.3.88, experimentell) ==============================
  //
  // BESTELLT: "Experimentell in die Renneinstellung 'Zufallsevents' einbauen mit ja/nein und wenn ja,
  // wie haeufig (alle 1-10 min) und wie lange (10 s - 120 s). Dabei soll zufaellig ein Sektor (wenn
  // vorhanden) oder die gesamte Bahn ausgesucht werden fuer Ereignisse, die sich auf das Fahrverhalten
  // und NPCs auswirken und vom Sprecher angesagt werden." Dazu (Erweiterung): jedes Event einzeln
  // schaltbar, Oelspur, Teile auf der Strecke (links/rechts, NPCs weichen aus, wer nicht ausweicht,
  // bekommt Schaden), Tank-Leck (ein Spielerauto), und es soll im Mehrspieler funktionieren.
  //
  // ---- DER PLAN STATT EINES WUERFELS JE TAKT ----------------------------------------------------
  // Beim Rennstart wird EINMAL ein Plan gewuerfelt: Zeitpunkte ab Gruen, Art, Dauer und drei
  // Zufallszahlen (Sektor, Teil, Seite bzw. Auto). Im Rennen laeuft nur noch eine seltene Zeitsteuerung
  // (ZEV_TAKT_MS) gegen die Rennuhr. Der Plan ist dieselbe Form wie der Wetterplan des WLAN-Mehrspielers:
  // das startende Telefon schickt ihn mit (mpPlanBauen -> plan.zev), alle anderen wuerfeln NICHT selbst
  // und folgen ihm ab derselben Gruenzeit. Sektor und Teil werden auf jedem Telefon aus derselben
  // Zufallszahl und derselben Strecke abgeleitet, also ist es ueberall derselbe Ort.
  //
  // ---- WAS IM 45-MS-TAKT PASSIERT, und es ist mit Absicht fast nichts ----------------------------
  // Spieler: nichts. Ihre Oberflaeche (Grip) wird nur beim Betreten/Verlassen des Bereichs neu gesetzt,
  // erkannt im ZEV_TAKT_MS-Zeitgeber. NPCs: je Takt ein Vergleich `zevAktiv !== null`; nur waehrend
  // eines Events ein Blick in eine Kachelmaske (Uint8Array, beim Start gebaut).
  //
  // ---- WO IST "IM SEKTOR" ----------------------------------------------------------------------
  // Jedes Auto hat einen Ortungssatz car.ghost mit tileIndex (NPCs ihren eigenen, Spieler 1-3 den aus
  // spielerOrt()/spielerOrtTick(), 90-ghosts.js) - der Kachelzaehler des Autos, auf die Teile der
  // Strecke ausgerichtet. Ein Auto ist im Bereich, wenn die Maske an seinem Teil 1 ist. Die Maske kommt
  // aus den Sektoren der Strecke (weitere Start/Ziel-Teile oder die Editor-Sektoren); ohne Sektoren, im
  // Ausdruck-Modus oder ohne bekannte Strecke gilt die ganze Bahn (Maske null = alle).

  const ZEV_ARTEN = ['dreck', 'gelb', 'oel', 'teile', 'leck'];
  // DIE FARBTABELLE je Ereignisart (Karte und Banner). Neue Ereignisse bekommen hier ihre Farbe.
  const ZEV_FARBE = { dreck: '#b07a35', gelb: '#ffd400', oel: '#9b59ff', teile: '#ff7a1a' };
  const ZEV_TAKT_MS = 200;
  const ZEV_GELB_REAKTION_MS = 1500;   // nach Eintritt bzw. nach der Ansage
  const ZEV_GELB_TOLERANZ_KMH = 5;     // erst ueber 85 km/h ...
  const ZEV_GELB_UEBER_MS = 1000;      // ... und das eine Sekunde lang
  const ZEV_STRAFE_ZEIT_S = 20;        // nicht abgeleistete Durchfahrtsstrafe im Ergebnis
  const ZEV_STRAFE_STAND_S = 2;        // Mindeststandzeit im Strafstopp (nichts wird gemacht)
  const ZEV_OEL_GRIP = 0.6;            // auf die volle Naesse obendrauf: Slicks 0,45 -> 0,27
  const ZEV_OEL_NPC_TEMPO = 0.6;       // NPCs fahren im Oel mit 60 % ihres Tempos
  const ZEV_TEILE_FREI = 0.3;          // Querlage zur freien Seite, ab der "ausgewichen" gilt
  const ZEV_TEILE_SCHADEN_MIN = 8, ZEV_TEILE_SCHADEN_MAX = 15;

  // var und nicht let: diese drei werden aus 40/70/90 gelesen (Physik, applySurface, ghostTick), und
  // ein let wuerde einen fruehen Aufruf in der temporalen Todeszone werfen lassen.
  var zevAktiv = null;                 // das laufende Bereichs-Event oder null
  var zevVerbrauch = [1, 1, 1, 1];     // Verbrauchsfaktor je Spieler (Tank-Leck: 2)
  var zevSpBereich = [0, 0, 0, 0];     // je Spieler: 0 frei, 1 verschmutzt/nass, 2 Oel
  function zevSpNeu() {
    return { drinSeit: null, ueberSeit: null, bestraft: false,
             teilePhase: 0, teileBest: -1, teileDrauf: false, letzteKachel: -1 };
  }
  var zev = {
    plan: null, i: 0, gruen: null,
    sp: { 1: zevSpNeu(), 2: zevSpNeu(), 3: zevSpNeu() },
    strafe: { 1: { offen: 0, zeitMs: 0, ab: 0 }, 2: { offen: 0, zeitMs: 0, ab: 0 }, 3: { offen: 0, zeitMs: 0, ab: 0 } },
    karte: null, banner: '', bannerArt: '', ansageLog: [], nrs: [],
  };

  // ---- Einstellungen ------------------------------------------------------------------------
  function zevSchalterAn() { const el = $('race-zev'); return !!(el && el.checked); }
  function zevArtAn(art) { const el = $('race-zev-' + art); return el ? !!el.checked : true; }
  function zevMinuten() {
    const el = $('race-zev-min');
    const v = el ? parseInt(el.value, 10) : 3;
    return Math.max(1, Math.min(10, Number.isFinite(v) ? v : 3));
  }
  function zevDauerS() {
    const el = $('race-zev-dauer');
    const v = el ? parseInt(el.value, 10) : 30;
    return Math.max(10, Math.min(120, Number.isFinite(v) ? v : 30));
  }
  // Was auf DIESER Strecke ueberhaupt geht: Teile brauchen eine bekannte Strecke (Ort und Seite),
  // ein Leck braucht die Tanksimulation.
  function zevStreckeBekannt() {
    return typeof trackMode === 'string' && trackMode === 'on'
      && !!currentTrackTiles && currentTrackTiles.length >= 4;
  }
  function zevOptionenLesen() {
    const arten = ZEV_ARTEN.filter((a) => zevArtAn(a)
      && (a !== 'teile' || zevStreckeBekannt())
      && (a !== 'leck' || (typeof fuelSimOn === 'function' && fuelSimOn())));
    return { an: zevSchalterAn(), min: zevMinuten(), dauerS: zevDauerS(), arten, ziele: [] };
  }

  // ---- Der Plan ----------------------------------------------------------------------------
  // Haeufigkeit = mittlerer Abstand zwischen zwei Event-Anfaengen, je Abstand zufaellig +-40 %.
  // Nie kuerzer als Dauer + 10 s: es laeuft hoechstens ein Event gleichzeitig.
  function zevPlanBauen(o, zufall) {
    const rnd = typeof zufall === 'function' ? zufall : Math.random;
    if (!o || !o.an || !o.arten || !o.arten.length) return null;
    const zeitRennen = RACE_MODES[raceMode] && RACE_MODES[raceMode].timed && raceMode !== 'laps' && raceLimit > 0;
    const gesamt = zeitRennen ? raceLimit * 60000 : 3 * 3600000;
    const mittel = o.min * 60000, dauer = o.dauerS * 1000;
    const r4 = () => Math.round(rnd() * 10000) / 10000;
    const liste = [];
    let t = mittel * (0.6 + 0.8 * rnd());
    // Kurzes Zeitrennen: laege das erste Event schon hinter dem Rennende, wird es nach vorn
    // geholt (30-70 % der Renndauer, mindestens 2 s). Sonst bliebe der Plan in einem kurzen
    // Rennen leer, und ein eingeschaltetes Event passierte nie.
    if (t >= gesamt) t = Math.max(2000, gesamt * (0.3 + 0.4 * rnd()));
    while (t < gesamt && liste.length < 300) {
      const art = o.arten[Math.min(o.arten.length - 1, Math.floor(rnd() * o.arten.length))];
      const e = { abMs: Math.round(t), art, dauerMs: art === 'leck' ? 0 : dauer, r1: r4(), r2: r4(), r3: r4() };
      if (art === 'leck' && o.ziele && o.ziele.length) e.ziel = o.ziele[Math.min(o.ziele.length - 1, Math.floor(rnd() * o.ziele.length))];
      liste.push(e);
      t += Math.max(dauer + 10000, mittel * (0.6 + 0.8 * rnd()));
    }
    return { v: 1, min: o.min, dauerS: o.dauerS, liste };
  }
  // Fuer den WLAN-Plan: die Ziele eines Tank-Lecks sind die aktiven Telefone (Kennung).
  function zevPlanFuerMp() {
    const o = zevOptionenLesen();
    try {
      const st = typeof mpLetzterStand !== 'undefined' ? mpLetzterStand : null;
      const leute = st && Array.isArray(st.fahrer) ? st.fahrer.filter((f) => typeof mpAktiv !== 'function' || mpAktiv(f)) : [];
      o.ziele = leute.map((f) => String(f.id));
      if (typeof mp !== 'undefined' && mp.id && o.ziele.indexOf(mp.id) < 0) o.ziele.push(mp.id);
    } catch (e) { o.ziele = []; }
    return zevPlanBauen(o);
  }

  // ---- Rennen: Start, Gruen, Ende -----------------------------------------------------------
  function zevRennStart(mpPlan) {
    zevAllesZurueck();
    let plan = null;
    if (mpPlan) plan = mpPlan.zev && Array.isArray(mpPlan.zev.liste) ? mpPlan.zev : null;
    else if (zevSchalterAn()) plan = zevPlanBauen(zevOptionenLesen());
    zev.plan = plan;
    zev.i = 0;
    zev.gruen = null;
    if (plan) log('Zufallsevents: ' + plan.liste.length + ' geplant (alle ~' + plan.min + ' min, '
                  + plan.dauerS + ' s).', 'info');
  }
  function zevGruen() { if (zev.plan) zev.gruen = rennZeitJetzt(); }
  // Rennende: laufendes Event still beenden, offene Durchfahrtsstrafen werden Zeitstrafen.
  function zevRennende() {
    if (zevAktiv !== null) zevEnde('rennende');
    for (const nr of [1, 2, 3]) {
      const s = zev.strafe[nr];
      if (s.offen > 0) {
        s.zeitMs += s.offen * ZEV_STRAFE_ZEIT_S * 1000;
        log((nr > 1 ? 'P' + nr + ': ' : '') + s.offen + ' Durchfahrtsstrafe(n) nicht abgeleistet: +'
            + s.offen * ZEV_STRAFE_ZEIT_S + ' s.', 'err');
        s.offen = 0;
      }
    }
    for (let nr = 1; nr <= 3; nr++) zevVerbrauch[nr] = 1;
    zev.plan = null; zev.gruen = null;
    zevBannerMalen(true);
  }
  function zevAllesZurueck() {
    if (zevAktiv !== null) zevEnde('reset');
    for (let nr = 1; nr <= 3; nr++) {
      zevVerbrauch[nr] = 1;
      zev.strafe[nr].offen = 0; zev.strafe[nr].zeitMs = 0; zev.strafe[nr].ab = 0;
      zev.sp[nr] = zevSpNeu();
    }
    zev.plan = null; zev.i = 0; zev.gruen = null;
    zevBannerMalen(true);
  }

  // Warum gerade kein Event starten darf ('' = es darf). Countdown und Ende fragt zevTick selbst.
  function zevSperre() {
    if (typeof raceFormationLap !== 'undefined' && raceFormationLap) return 'formation';
    if (typeof tutLaeuft === 'function' && tutLaeuft()) return 'tutorial';
    if (typeof challengeLaeuft === 'function' && challengeLaeuft()) return 'challenge';
    if (typeof flagState !== 'undefined' && flagState !== 'green') return 'gelb';
    if (typeof safetyCarFaehrt === 'function' && safetyCarFaehrt()) return 'sc';
    return '';
  }

  // ---- Die Zeitsteuerung -------------------------------------------------------------------
  function zevTick() {
    if (zev.plan === null && zevAktiv === null) return;
    if (rennPauseAktiv()) return;
    if (raceState !== 'racing' && raceState !== 'finishing') {
      // Rennen auf einem anderen Weg als finishRace() verlassen: nichts weiterwirken lassen.
      if (zevAktiv !== null && raceState !== 'countdown') zevEnde('rennende');
      return;
    }
    const jetzt = rennZeitJetzt();
    const sperre = zevSperre();
    if (zevAktiv !== null) {
      // Echte gelbe Flagge oder Safety Car: das Event weicht (die Neutralisierung gilt ohnehin
      // fuer alle), ohne Ansage - die Rennleitung spricht gerade selbst.
      if (sperre !== '' && sperre !== 'formation') zevEnde('abbruch');
      else if (jetzt >= zevAktiv.bis) zevEnde('zeit');
      else zevBereichTick(jetzt);
    }
    // Verschoben, nicht verworfen: ein faelliges Event wartet, bis es starten darf (Einfuehrungsrunde,
    // Gelb). Die Plan-Zeitpunkte der folgenden bleiben, wie sie sind.
    if (zevAktiv === null && sperre === '' && raceState === 'racing' && zev.gruen !== null && zev.plan) {
      const e = zev.plan.liste[zev.i];
      if (e && jetzt - zev.gruen >= e.abMs) { zev.i++; zevStarten(e, jetzt); }
    }
    zevBannerMalen(false);
  }
  // Ein Fehler wird EINMAL protokolliert und nicht fuenfmal je Sekunde.
  let zevFehlerZuletzt = '';
  setInterval(() => {
    try { zevTick(); } catch (e) {
      if (e.message !== zevFehlerZuletzt) { zevFehlerZuletzt = e.message; log('Zufallsevents: ' + e.message, 'warn'); }
    }
  }, ZEV_TAKT_MS);

  // Die Spielerplaetze, die gerade ein Auto fahren (1 und die aktiven Zusatzplaetze).
  function zevSpielerNrs() {
    const l = zev.nrs; l.length = 0;
    if (typeof playerCar !== 'undefined' && playerCar) l.push(1);
    if (typeof zusatzAktiv === 'function') for (const z of zusatzAktiv()) l.push(z.nr);
    return l;
  }
  function zevSpielerAuto(nr) {
    if (nr === 1) return typeof playerCar !== 'undefined' ? playerCar : null;
    const z = typeof zusatzPlatz === 'function' ? zusatzPlatz(nr) : null;
    return z ? z.car : null;
  }
  function zevKmh(nr) {
    const m = motorVon(nr);
    return m && m.state ? Math.abs(m.state.speedKmh || 0) * REAL_SCALE : 0;
  }

  // ---- Ort: Sektoren als Teilelisten ---------------------------------------------------------
  // Die Teile jedes Sektors in Fahrtrichtung, oder null ohne Sektoren.
  //   Weitere Start/Ziel-Teile: Sektor j reicht vom j-ten Start/Ziel-Teil bis vor das naechste
  //   (das erste Start/Ziel-Teil ist die Rundenlinie, sektorZiel() in 70-race.js).
  //   Editor-Sektoren (automatisch/manuell): aus dem Plan, Grenzen als Teile ab der Rundenlinie.
  function zevSektorKacheln(tiles) {
    const n = tiles ? tiles.length : 0;
    if (n < 4) return null;
    const starts = [];
    for (let i = 0; i < n; i++) if (tiles[i].type === TILE_TYPE.START) starts.push(i);
    if (starts.length > 1) {
      return starts.map((s, j) => {
        const bis = j + 1 < starts.length ? starts[j + 1] : starts[0] + n;
        const l = [];
        for (let k = s; k < bis; k++) l.push(k % n);
        return l;
      });
    }
    let p = null;
    try { p = typeof autoSektorPlanAktuell === 'function' ? autoSektorPlanAktuell() : null; } catch (e) { p = null; }
    if (!p || !(p.n > 1) || p.teile !== n) return null;
    const out = [];
    for (let j = 0; j < p.n; j++) {
      const von = j === 0 ? 0 : p.grenzen[j - 1];
      const bis = j < p.grenzen.length ? p.grenzen[j] : p.teile;
      const l = [];
      for (let k = von; k < bis; k++) l.push((p.s + k) % n);
      out.push(l);
    }
    return out;
  }
  // Der Bereich fuer ein Event aus der Zufallszahl r (0..1): ein Sektor oder die ganze Bahn.
  function zevBereichBauen(r) {
    if (!zevStreckeBekannt()) return { sektor: -1, zahl: 0, kacheln: null, maske: null };
    const tiles = currentTrackTiles, n = tiles.length;
    const sek = zevSektorKacheln(tiles);
    if (!sek || sek.length < 2) {
      const alle = [];
      for (let k = 0; k < n; k++) alle.push(k);
      return { sektor: -1, zahl: 1, kacheln: alle, maske: null };
    }
    const k = Math.max(0, Math.min(sek.length - 1, Math.floor((r || 0) * sek.length)));
    const maske = new Uint8Array(n);
    for (const t of sek[k]) maske[t] = 1;
    return { sektor: k, zahl: sek.length, kacheln: sek[k], maske };
  }
  // Ist dieses Auto gerade im Bereich des laufenden Events? Fuer Spieler und NPCs gleich.
  function zevImBereich(car) {
    const a = zevAktiv;
    if (a === null || !car) return false;
    if (a.maske === null) return true;
    const g = car.ghost;
    const t = g ? g.tileIndex : null;
    return t !== null && t !== undefined && a.maske[t] === 1;
  }
  // Nass wie Regen (Verschmutzung und Oel) fuer dieses Auto: 1, sonst 0. Gelesen in ghostNassAnteil().
  function zevNassVon(car) {
    const a = zevAktiv;
    if (a === null || (a.art !== 'dreck' && a.art !== 'oel')) return 0;
    return zevImBereich(car) ? 1 : 0;
  }

  // ---- Start und Ende ------------------------------------------------------------------------
  function zevStarten(e, jetzt) {
    if (!e || ZEV_ARTEN.indexOf(e.art) < 0) return false;
    if (e.art === 'leck') return zevLeckStarten(e);
    const b = zevBereichBauen(e.r1);
    let teil = -1, seite = '';
    if (e.art === 'teile') {
      if (!b.kacheln || !b.kacheln.length) { log('Zufallsevents: Teile ohne bekannte Strecke, entfaellt.', 'info'); return false; }
      teil = b.kacheln[Math.max(0, Math.min(b.kacheln.length - 1, Math.floor((e.r2 || 0) * b.kacheln.length)))];
      seite = (e.r3 || 0) < 0.5 ? 'links' : 'rechts';
    }
    zevAktiv = { art: e.art, ab: jetzt, bis: jetzt + Math.max(1000, e.dauerMs || 0), sektor: b.sektor,
                 zahl: b.zahl, kacheln: b.kacheln, maske: e.art === 'teile' ? null : b.maske,
                 teil, seite, farbe: ZEV_FARBE[e.art] };
    for (let nr = 1; nr <= 3; nr++) zev.sp[nr] = zevSpNeu();
    zev.karte = zevKartenInfoBauen();
    zevBereichTick(jetzt);
    const k = zevSektorWort(zevAktiv);
    const schluessel = e.art === 'dreck' ? 'dreck_' + k : e.art === 'oel' ? 'oel_' + k
                     : e.art === 'gelb' ? 'gelb_' + k : 'teile_' + k + '_' + seite;
    zevAnsage(schluessel);
    showHudToast(zevBannerText(jetzt));
    log('Zufallsevent: ' + zevAnsageText(schluessel, 'de'), 'info');
    zevKarteAuffrischen();
    zevBannerMalen(true);
    return true;
  }
  function zevEnde(grund) {
    const a = zevAktiv;
    if (a === null) return;
    zevAktiv = null;
    zev.karte = null;
    // Spieler zurueck auf die Oberflaeche des Wetters.
    for (let nr = 1; nr <= 3; nr++) {
      if (zevSpBereich[nr] !== 0) { zevSpBereich[nr] = 0; zevOberflaecheSpieler(nr); }
    }
    if (grund === 'zeit') {
      const k = zevSektorWort(a);
      const schluessel = a.art === 'gelb' ? 'gruen_' + k : a.art === 'teile' ? 'teile_weg' : 'sauber_' + k;
      zevAnsage(schluessel);
      showHudToast(t(a.art === 'gelb' ? 'GRÜN' : a.art === 'teile' ? 'TRÜMMER WEG' : 'FAHRBAHN SAUBER'));
      log('Zufallsevent beendet: ' + zevAnsageText(schluessel, 'de'), 'info');
    } else {
      log('Zufallsevent beendet (' + grund + ').', 'info');
    }
    zevKarteAuffrischen();
    zevBannerMalen(true);
  }
  // 0 = ganze Bahn, sonst die gesprochene Sektornummer (1..10).
  function zevSektorWort(a) { return a && a.sektor >= 0 && a.zahl > 1 ? Math.min(10, a.sektor + 1) : 0; }

  // ---- Je ZEV_TAKT_MS: Spieler im Bereich ------------------------------------------------------
  function zevBereichTick(jetzt) {
    const a = zevAktiv;
    if (a === null) return;
    for (const nr of zevSpielerNrs()) {
      const car = zevSpielerAuto(nr);
      if (!car) continue;
      if (a.art === 'dreck' || a.art === 'oel') {
        const soll = zevImBereich(car) ? (a.art === 'oel' ? 2 : 1) : 0;
        if (zevSpBereich[nr] !== soll) { zevSpBereich[nr] = soll; zevOberflaecheSpieler(nr); }
      } else if (a.art === 'gelb') {
        zevGelbPruefen(nr, zevImBereich(car), jetzt);
      } else if (a.art === 'teile') {
        zevTeilePruefen(nr, car);
      }
    }
  }

  // Die Oberflaeche eines Spielers neu setzen: Wetter, Reifen und das Event am Ort. Gerufen beim
  // Betreten/Verlassen des Bereichs und von applySurface() (Wetterrampe, Boxenstopp).
  function zevMischung(motor, mix, griff, nr) {
    if (!motor) return;
    const b = zevSpBereich[nr] | 0;
    mischungAnwenden(motor, mix, b ? Math.max(griff, 1) : griff);
    // Oel: weniger Griff als nass, und das Heck kommt beim Einlenken (Pacejka/Gran Hybrismo lesen
    // cfg.zevOel wie den Schalter "Uebersteuern"; die anderen Modi bekommen nur den Griffverlust).
    motor.config.zevOel = b === 2 ? 1 : 0;
    if (b === 2) motor.config.gripScale *= ZEV_OEL_GRIP;
  }
  function zevOberflaecheSpieler(nr) {
    if (typeof wxRainLevel !== 'function') return;
    const lvl = wxRainLevel(), griff = lvl * lvl;
    if (nr === 1) zevMischung(physEngine, tyres, griff, 1);
    else {
      const z = typeof zusatzPlatz === 'function' ? zusatzPlatz(nr) : null;
      if (z) zevMischung(z.motor, z.reifen, griff, nr);
    }
  }

  // ---- Gelbe Flagge im Sektor ----------------------------------------------------------------
  function zevGelbPruefen(nr, drin, jetzt) {
    const s = zev.sp[nr];
    if (!drin) { s.drinSeit = null; s.ueberSeit = null; return; }
    if (s.drinSeit === null) s.drinSeit = jetzt;
    if (s.bestraft) return;
    if (jetzt < Math.max(s.drinSeit, zevAktiv.ab) + ZEV_GELB_REAKTION_MS) return;
    const kmh = zevKmh(nr);
    if (kmh > YELLOW_KMH + ZEV_GELB_TOLERANZ_KMH) {
      if (s.ueberSeit === null) s.ueberSeit = jetzt;
      else if (jetzt - s.ueberSeit >= ZEV_GELB_UEBER_MS) { s.bestraft = true; zevStrafeGeben(nr, kmh); }
    } else s.ueberSeit = null;
  }
  // NPCs: im Bereich hoechstens das Gelb-Tempo (wie unter echter Gelber), im Oel 60 %.
  // Verschmutzung braucht hier nichts: sie kommt ueber ghostNassAnteil() in ghostReifenTempo().
  function zevNpcTempo(car, ziel) {
    const a = zevAktiv;
    if (a === null || !zevImBereich(car)) return ziel;
    if (a.art === 'oel') return ziel * ZEV_OEL_NPC_TEMPO;
    if (a.art === 'gelb') return Math.min(ziel, gelbGrenze());
    return ziel;
  }

  // ---- Durchfahrtsstrafe -----------------------------------------------------------------------
  function zevPraefix(nr) { return zevSpielerNrs().length > 1 ? 'P' + nr + ': ' : ''; }
  function zevStrafeGeben(nr, kmh) {
    zev.strafe[nr].offen += 1;
    zevAnsage('strafe_' + (zevSpielerNrs().length > 1 ? nr : 0));
    showHudToast(zevPraefix(nr) + t('DURCHFAHRTSSTRAFE') + ' · ' + t('BOX'));
    if (typeof padRumble === 'function') padRumble(0.4, 0.3, 300, 'meldung', nr);
    log(zevPraefix(nr) + 'Durchfahrtsstrafe: ' + Math.round(kmh) + ' km/h unter Gelb im Sektor. '
        + 'In die Box (anhalten, Box aktivieren).', 'err');
    zevBannerMalen(true);
  }
  // Fruehstart (70-race.js, v1.3.132): dieselbe Durchfahrtsstrafe, ohne Gelb-Ansage. Abgeleistet
  // ueber zevBoxStopp (Spieler 1 und 2/3), sonst +20 s am Rennende (zevRennende).
  function zevStrafeDazu(nr) {
    if (typeof zev === 'undefined' || !zev || !zev.strafe[nr]) return false;
    zev.strafe[nr].offen += 1;
    zevBannerMalen(true);
    return true;
  }
  function zevStrafeOffen(nr) { return typeof zev !== 'undefined' && zev && zev.strafe[nr] ? zev.strafe[nr].offen : 0; }
  function zevStrafeZeitMs(nr) { return typeof zev !== 'undefined' && zev && zev.strafe[nr] ? zev.strafe[nr].zeitMs : 0; }
  // Beim Beginn eines Boxenstopps (Auto steht in der Box). Ein Tank-Leck ist danach dicht. Rueckgabe:
  // true = dieser Stopp ist ein STRAFSTOPP - es wird nichts am Auto gemacht, nach ZEV_STRAFE_STAND_S
  // darf man los (abbrechen kann man ohnehin; die Strafe gilt ab dem Stehen als abgeleistet).
  function zevBoxStopp(nr) {
    if (typeof zev === 'undefined' || !zev) return false;
    if (zevVerbrauch[nr] !== 1) {
      zevVerbrauch[nr] = 1;
      showHudToast(zevPraefix(nr) + t('TANK-LECK REPARIERT'));
      log(zevPraefix(nr) + 'Tank-Leck in der Box repariert.', 'info');
    }
    const s = zev.strafe[nr];
    if (!s || !(s.offen > 0)) { zevBannerMalen(true); return false; }
    s.offen -= 1; s.ab += 1;
    zevAnsage('strafe_ab_' + (zevSpielerNrs().length > 1 ? nr : 0));
    showHudToast(zevPraefix(nr) + t('DURCHFAHRTSSTRAFE ABGELEISTET'));
    log(zevPraefix(nr) + 'Durchfahrtsstrafe abgeleistet (Strafstopp ohne Arbeiten).', 'info');
    zevBannerMalen(true);
    return true;
  }
  // Ergebnis: Text fuer die Strafen-Spalte (offen: DT, nach dem Ziel die Sekunden stehen dort schon
  // ueber strafeMsVon()).
  function zevStrafeLabel(nr) { return zevStrafeOffen(nr) > 0 ? 'DT' : ''; }

  // ---- Teile auf der Strecke -------------------------------------------------------------------
  // DIE HEURISTIK FUER SPIELER, und sie ist ehrlich keine Messung: das Auto meldet seine Querlage
  // nicht. Gelesen wird die angeforderte Querlage - bei Spieler 1 der geglaettete Lenkbefehl
  // playerCar.ghost.querSoll (20-protocol.js, dieselbe Groesse, nach der NPCs beim Ueberholen die
  // Seite waehlen), bei Spieler 2/3 der gesendete Lenkbefehl (outSteer). Positiv = rechts.
  // Auf dem Teil VOR den Truemmern und auf dem Truemmerteil wird das Maximum von (freie Seite x
  // Querlage) gemerkt. Verlaesst das Auto die beiden Teile nach vorn, gilt: Maximum >= 0,3 =
  // ausgewichen, sonst Treffer mit 8 bis 15 % Schaden je nach Tempo. Abgetastet im ZEV_TAKT_MS.
  function zevQuerlage(nr, car) {
    if (nr === 1) {
      if (car && car.ghost && typeof car.ghost.querSoll === 'number') return car.ghost.querSoll;
      return typeof physOutSteer === 'number' ? physOutSteer : 0;
    }
    const z = typeof zusatzPlatz === 'function' ? zusatzPlatz(nr) : null;
    return z && typeof z.outSteer === 'number' ? z.outSteer : 0;
  }
  function zevTeileFreiSeite(a) { return a.seite === 'rechts' ? -1 : 1; }   // Truemmer rechts -> links vorbei
  function zevTeilePruefen(nr, car) {
    const a = zevAktiv, s = zev.sp[nr];
    const g = car.ghost;
    const tk = g && g.tileIndex !== null && g.tileIndex !== undefined ? g.tileIndex : -1;
    const n = currentTrackTiles ? currentTrackTiles.length : 0;
    if (tk < 0 || !n || a.teil < 0) return;
    const vor = (a.teil - 1 + n) % n;
    if (tk === a.teil || tk === vor) {
      const w = zevTeileFreiSeite(a) * zevQuerlage(nr, car);
      if (s.teilePhase === 0) { s.teilePhase = 1; s.teileBest = w; } else if (w > s.teileBest) s.teileBest = w;
      if (tk === a.teil) s.teileDrauf = true;
    } else if (s.teilePhase === 1) {
      // Nach vorn heraus (bis 3 Teile hinter den Truemmern): vorbeigefahren.
      const nach = (tk - a.teil + n) % n;
      if (nach >= 1 && nach <= 3) {
        if (s.teileBest >= ZEV_TEILE_FREI) log(zevPraefix(nr) + 'Truemmern ausgewichen.', 'info');
        else zevTeileTreffer(nr);
      }
      s.teilePhase = 0; s.teileBest = -1; s.teileDrauf = false;
    }
  }
  function zevTeileTreffer(nr) {
    const m = motorVon(nr);
    const top = m && m.config ? m.config.topSpeedKmh * REAL_SCALE : 300;
    const anteil = Math.max(0, Math.min(1, zevKmh(nr) / Math.max(1, top)));
    const p = Math.round(ZEV_TEILE_SCHADEN_MIN + (ZEV_TEILE_SCHADEN_MAX - ZEV_TEILE_SCHADEN_MIN) * anteil);
    const schadenAn = typeof crashSchadenAn !== 'function' || crashSchadenAn();
    if (schadenAn) {
      if (nr === 1) { damage = Math.min(100, damage + p); if (typeof updateDamageFuelUI === 'function') updateDamageFuelUI(); }
      else { const z = zusatzPlatz(nr); schadenSetzenVon(z, z.schaden.wert + p); }
      if (typeof rennEreignisSchaden === 'function') rennEreignisSchaden(nr);
    }
    if (typeof padRumble === 'function') padRumble(0.55, 0.4, 260, 'crash', nr);
    showHudToast(zevPraefix(nr) + t('TRÜMMER GETROFFEN') + (schadenAn ? ' · ' + t('SCHADEN') + ' +' + p + ' %' : ''));
    log(zevPraefix(nr) + 'Truemmer getroffen' + (schadenAn ? ', Schaden +' + p + ' %.' : '.'), 'err');
    zev.letzterTreffer = { nr, p };
  }
  // NPCs: auf dem Teil davor und auf dem Truemmerteil voll auf die freie Seite (wie beim Ueberholen),
  // nicht bremsen. Gerufen aus ghostTick (pq-Kette); ohne Truemmer ein Vergleich.
  function zevAusweichQuer(car) {
    const a = zevAktiv;
    if (a === null || a.art !== 'teile') return null;
    const g = car && car.ghost;
    const tk = g ? g.tileIndex : null;
    if (tk === null || tk === undefined) return null;
    const n = currentTrackTiles.length;
    if (tk !== a.teil && tk !== (a.teil - 1 + n) % n) return null;
    return zevTeileFreiSeite(a) * (typeof passAussen === 'function' ? passAussen() : 1);
  }

  // ---- Tank-Leck ---------------------------------------------------------------------------
  function zevLeckStarten(e) {
    const lokal = zevSpielerNrs().slice();
    let nr = 0, fremd = null;
    const imMp = typeof mp !== 'undefined' && mp && mp.an && e.ziel;
    if (imMp) {
      if (String(e.ziel) === String(mp.id)) nr = lokal.length ? lokal[Math.min(lokal.length - 1, Math.floor((e.r1 || 0) * lokal.length))] : 0;
      else {
        const st = typeof mpLetzterStand !== 'undefined' ? mpLetzterStand : null;
        const f = st && Array.isArray(st.fahrer) ? st.fahrer.find((x) => String(x.id) === String(e.ziel)) : null;
        fremd = f && f.name ? f.name : t('ein anderes Auto');
      }
    } else {
      const frei = lokal.filter((n) => zevVerbrauch[n] === 1);
      if (!frei.length) return false;
      nr = frei[Math.min(frei.length - 1, Math.floor((e.r1 || 0) * frei.length))];
    }
    if (nr) {
      zevVerbrauch[nr] = 2;
      zevAnsage('leck_' + (lokal.length > 1 ? nr : 0));
      showHudToast(zevPraefix(nr) + t('TANK-LECK') + ' · ' + t('BOX'));
      log(zevPraefix(nr) + 'Tank-Leck: doppelter Verbrauch bis zum naechsten Boxenstopp.', 'err');
    } else if (fremd) {
      zevAnsage('leck_andere');
      showHudToast(t('TANK-LECK') + ': ' + fremd);
      log('Tank-Leck bei ' + fremd + '.', 'info');
    } else return false;
    zevBannerMalen(true);
    return true;
  }

  // ---- Ansagen -------------------------------------------------------------------------------
  // Die Texte, Wort fuer Wort wie in tools/voice_zufallsevents.py (dort werden daraus die Clips).
  const ZEV_ZAHL = { de: ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'],
                     en: ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] };
  function zevAnsageText(key, sprache) {
    const de = sprache === 'de', Z = ZEV_ZAHL[de ? 'de' : 'en'];
    const m = /^([a-z]+(?:_[a-z]+)?)_(\d+)(?:_(links|rechts))?$/.exec(key);
    if (key === 'teile_weg') return de ? 'Die Trümmerteile sind weggeräumt.' : 'The debris has been cleared.';
    if (key === 'leck_andere') return de ? 'Ein anderes Auto verliert Benzin.' : 'Another car is losing fuel.';
    if (!m) return key;
    const art = m[1], k = +m[2], z = Z[k] || '', seite = m[3];
    switch (art) {
      case 'dreck': return k ? (de ? 'Achtung, die Fahrbahn ist in Sektor ' + z + ' verschmutzt.' : 'Caution, the track is dirty in sector ' + z + '.')
                             : (de ? 'Achtung, die Fahrbahn ist verschmutzt.' : 'Caution, the track is dirty.');
      case 'oel': return k ? (de ? 'Achtung, Öl auf der Fahrbahn in Sektor ' + z + '.' : 'Caution, oil on the track in sector ' + z + '.')
                           : (de ? 'Achtung, Öl auf der Fahrbahn.' : 'Caution, oil on the track.');
      case 'sauber': return k ? (de ? 'Sektor ' + z + ' ist wieder sauber.' : 'Sector ' + z + ' is clean again.')
                              : (de ? 'Die Fahrbahn ist wieder sauber.' : 'The track is clean again.');
      case 'gelb': return k ? (de ? 'Gelbe Flagge in Sektor ' + z + '. Abbremsen auf achtzig.' : 'Yellow flag in sector ' + z + '. Slow down to eighty.')
                            : (de ? 'Gelbe Flagge auf der ganzen Strecke. Abbremsen auf achtzig.' : 'Yellow flag on the whole track. Slow down to eighty.');
      case 'gruen': return k ? (de ? 'Grüne Flagge, Sektor ' + z + ' ist wieder frei.' : 'Green flag, sector ' + z + ' is clear.')
                             : (de ? 'Grüne Flagge, die Strecke ist wieder frei.' : 'Green flag, the track is clear.');
      case 'teile': {
        const s = de ? (seite === 'links' ? 'linke Seite' : 'rechte Seite') : (seite === 'links' ? 'left side' : 'right side');
        return k ? (de ? 'Trümmerteile in Sektor ' + z + ', ' + s + '.' : 'Debris in sector ' + z + ', ' + s + '.')
                 : (de ? 'Trümmerteile auf der Strecke, ' + s + '.' : 'Debris on track, ' + s + '.');
      }
      case 'strafe': return k ? (de ? 'Durchfahrtsstrafe für Spieler ' + z + '. Bitte in die Box.' : 'Drive-through penalty for player ' + z + '. Please come into the pits.')
                              : (de ? 'Durchfahrtsstrafe. Bitte in die Box.' : 'Drive-through penalty. Please come into the pits.');
      case 'strafe_ab': return k ? (de ? 'Spieler ' + z + ' hat die Durchfahrtsstrafe abgeleistet.' : 'Player ' + z + ' has served the drive-through penalty.')
                                 : (de ? 'Durchfahrtsstrafe abgeleistet.' : 'Drive-through penalty served.');
      case 'leck': return k ? (de ? 'Spieler ' + z + ', dein Tank verliert Benzin. Komm in die Box.' : 'Player ' + z + ', your tank is losing fuel. Come into the pits.')
                            : (de ? 'Dein Tank verliert Benzin. Komm in die Box.' : 'Your tank is losing fuel. Come into the pits.');
      default: return key;
    }
  }
  // Alle Schluessel, die es geben kann (der Generator erzeugt genau diese; ein Selbsttest vergleicht).
  function zevAnsageSchluessel() {
    const l = [];
    for (let k = 0; k <= 10; k++) {
      for (const a of ['dreck', 'oel', 'sauber', 'gelb', 'gruen']) l.push(a + '_' + k);
      l.push('teile_' + k + '_links', 'teile_' + k + '_rechts');
    }
    for (let p = 0; p <= 3; p++) l.push('strafe_' + p, 'strafe_ab_' + p, 'leck_' + p);
    l.push('teile_weg', 'leck_andere');
    return l;
  }
  const zevClips = { buffers: {}, laden: {} };
  async function zevClipsLaden(spr) {
    const quelle = spr === 'de' ? 'de' : 'en';
    if (zevClips.buffers[quelle]) return zevClips.buffers[quelle];
    if (!audioCtx) return null;
    if (zevClips.laden[quelle]) return zevClips.laden[quelle];
    zevClips.laden[quelle] = (async () => {
      try {
        const res = await fetch('audio/zufallsevents.json');
        if (!res.ok) throw Error('HTTP ' + res.status);
        const manifest = await res.json(), satz = {};
        const entries = Object.entries(manifest[quelle] || {});
        for (let i = 0; i < entries.length; i += 6) {
          await Promise.all(entries.slice(i, i + 6).map(async ([key, file]) => {
            const response = await fetch('audio/' + file);
            if (!response.ok) throw Error(file);
            satz['z:' + key] = await audioCtx.decodeAudioData(await response.arrayBuffer());
          }));
        }
        zevClips.buffers[quelle] = satz; return satz;
      } catch (err) {
        log('Zufallsevent-Clips fehlen (' + err.message + '); Geraetestimme.', 'info');
        return null;
      } finally { delete zevClips.laden[quelle]; }
    })();
    return zevClips.laden[quelle];
  }
  // Ueber denselben Weg wie die Rennereignisse (80e): Warteschlange bzw. sofort, Stadionhall mit den
  // Piper-Clips; fehlt ein Clip, die Geraetestimme (ohne Hall); ohne beides bleibt der Toast/Banner.
  function zevAnsage(key) {
    const l = zev.ansageLog; l.push(key); if (l.length > 30) l.shift();
    if (typeof soundEnabled === 'undefined' || !soundEnabled) return false;
    const spr = lang === 'de' ? 'de' : 'en';
    const spielen = async (gueltig) => {
      const satz = await zevClipsLaden(spr);
      if (!gueltig()) return;
      const b = satz && satz['z:' + key];
      if (b) await ansagenPufferSpielen([b], { stadion: true });
      else await ansagenTextSpielen(zevAnsageText(key, spr), spr);
    };
    const erlaubt = () => soundEnabled;
    if (typeof ansageWarteschlange !== 'undefined' && !ansageWarteschlange) return ansagenSofort('event-zev', spielen, erlaubt);
    return rennAnsagen.einreihen('event-zev', 22, spielen, erlaubt);
  }

  // ---- Anzeige: Banner im Cockpit ------------------------------------------------------------
  function zevRestText(jetzt) {
    const a = zevAktiv;
    if (a === null) return '';
    const s = Math.max(0, Math.ceil((a.bis - jetzt) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function zevOrtText(a) {
    if (a.sektor >= 0 && a.zahl > 1) return t('SEKTOR') + ' ' + (a.sektor + 1);
    return t('GANZE BAHN');
  }
  function zevBannerText(jetzt) {
    const teile = [];
    const a = zevAktiv;
    if (a !== null) {
      const name = a.art === 'dreck' ? t('VERSCHMUTZT') : a.art === 'oel' ? t('ÖLSPUR')
                 : a.art === 'gelb' ? t('GELB') + ' · ' + YELLOW_KMH + ' km/h'
                 : t('TRÜMMER') + ' ' + t(a.seite === 'links' ? 'LINKS' : 'RECHTS');
      teile.push(name + ' · ' + zevOrtText(a) + ' · ' + zevRestText(jetzt));
    }
    const nrs = zevSpielerNrs(), mehr = nrs.length > 1;
    for (const nr of nrs) {
      const p = mehr ? 'P' + nr + ' ' : '';
      if (zevStrafeOffen(nr) > 0) teile.push(p + t('DURCHFAHRT: BOX'));
      if (zevVerbrauch[nr] !== 1) teile.push(p + t('TANK-LECK: BOX'));
    }
    return teile.join(' · ');
  }
  function zevBannerMalen(sofort) {
    const el = $('gt3-zev-text'), wrap = $('gt3-zev');
    if (!el || !wrap) return;
    const jetzt = rennZeitJetzt();
    const txt = (raceState === 'racing' || raceState === 'finishing') ? zevBannerText(jetzt) : '';
    if (!sofort && txt === zev.banner) return;
    zev.banner = txt;
    if (el.textContent !== txt) el.textContent = txt;
    const art = zevAktiv !== null ? zevAktiv.art : (txt ? 'strafe' : '');
    if (zev.bannerArt !== art) { zev.bannerArt = art; wrap.dataset.art = art; }
    document.body.classList.toggle('zev-an', !!txt);
  }

  // ---- Anzeige: Karte --------------------------------------------------------------------------
  function zevKartenInfoBauen() {
    const a = zevAktiv;
    if (a === null || !a.kacheln) return null;
    const kacheln = a.art === 'teile' ? [a.teil] : a.kacheln;
    return { sig: a.art + ':' + a.sektor + ':' + a.teil + ':' + a.seite + ':' + kacheln.length,
             art: a.art, farbe: a.farbe, kacheln, teil: a.teil, seite: a.seite };
  }
  function zevKartenInfo() { return zev.karte; }
  // Nur bei Start/Ende: die Ueberlagerung in die schon gezeichnete Karte des Rennen-Schirms setzen.
  // Ist die Karte noch nicht gezeichnet, bringt ovKarteMalen() sie beim ersten Zeichnen mit.
  function zevKarteAuffrischen() {
    const host = $('ov-karte');
    const svg = host && host.querySelector('svg');
    if (svg && typeof ovKarteGeo !== 'undefined' && ovKarteGeo && typeof karteEreignisSetzen === 'function') {
      karteEreignisSetzen(svg, ovKarteGeo, zev.karte);
    }
  }
