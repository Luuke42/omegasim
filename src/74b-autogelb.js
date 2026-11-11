  // ============================== AUTOMATISCHE GELBE FLAGGE (v1.4.33, WIP) ==============================
  //
  // BESTELLT: "Option bei Rennoptionen (aus [Default], nur bei NPCs, bei allen Autos): Automatische Gelbe
  // Flagge; immer dann, wenn ein Auto (oder nur ein NPC) meldet, jenseits der Bahn zu sein. Dann fahren
  // die Autos weiter (auch mein Spielerauto) und ich kann aufstehen, um den NPC reinzustellen. Wenn der
  // dann fuer 3 s wieder faehrt, geht die Ampel los, ich kann meinen Controller nehmen, und weiter geht
  // das Rennen. Das Ganze soll mit Ansagen verbunden sein und Bescheid, wenn gelbe Flagge zu Ende ist."
  //
  // ---- WAS HIER NEU IST, und was nicht ----------------------------------------------------------
  // Die gelbe Flagge selbst ist die vorhandene (setFlag('yellow'), 90-ghosts.js): Tempo gedeckelt, kein
  // Ueberholen, Spielerautos im Autopiloten - genau das "die Autos fahren weiter, auch meins". Das Ende ist
  // die vorhandene Anfahrt-Ampel aus Gelb (yellowRestart): fuenf Lampen, aus = Gruen, bis dahin faehrt der
  // Autopilot (autopilotGrund 'restart'). Neu ist nur, WER sie ausruft und beendet.
  //
  // ---- ERKENNUNG: die vorhandenen Abflug-Melder, nichts im Funktakt ---------------------------------
  // NPC: geparkt mit 'Bahn verlassen' (ghostTick/parkCar, 0,9-1,8 s bestaetigtes 0x00, nach einem
  //      erfolglosen Rueckweg). Spieler 1-3: die Abseits-Uhr aus offtrackMelden (50-drive.js), mindestens
  //      AG_SPIELER_EIN_MS durchgehend 0x00. Abgefragt wird in einem eigenen 200-ms-Zeitgeber, der ohne
  //      Option nach einem Vergleich zurueckkehrt. Im 45-ms-Takt passiert dafuer nichts.
  //
  // ---- ENDE: "fuer 3 s wieder faehrt" ----------------------------------------------------------------
  // Je abgeflogenem Auto: nicht (mehr) geparkt bzw. nicht abseits, gueltiger Code und ein Kachelwechsel
  // hoechstens AG_KACHEL_FRISCH_MS alt - und das AG_FAEHRT_MS lang ohne Unterbrechung. Weil der letzte
  // Kachelwechsel nach 3 s juenger als 2 s sein muss, ist das Auto in der Zeit sicher gefahren. Erst wenn
  // ALLE abgeflogenen Autos so weit sind (und kein anderes Telefon mehr Gelb meldet), startet die Ampel.
  //
  // ---- WLAN-Mehrspieler ------------------------------------------------------------------------------
  // Der Host verteilt nur. Jedes Telefon meldet im Bericht (/mp/report, Feld `gelb`) die Abfluege SEINER
  // Autos; die anderen sehen es beim naechsten Abruf (/mp/state) und folgen: Gelb an, und wenn das Feld
  // leer wird, ihre eigene Anfahrt-Ampel. Ein Telefon meldet nie ein fremdes Gelb weiter (sonst hielten
  // sich zwei Telefone gegenseitig in Gelb). Die Option selbst schickt das startende Telefon im Plan mit.
  const AG_TAKT_MS = 200;
  const AG_SPIELER_EIN_MS = 1000;   // Spieler: so lange durchgehend 0x00 = abgeflogen (Fehlalarm-Schwelle)
  const AG_FAEHRT_MS = 3000;        // so lange muss das abgeflogene Auto wieder fahren
  const AG_KACHEL_FRISCH_MS = 2000; // letzter Kachelwechsel hoechstens so alt = es faehrt
  // var: updateFlagUi() (90-ghosts.js) fragt autoGelbBannerText(), und das kann beim Laden frueher passieren.
  var autoGelb = { phase: 'aus', liste: [], fremd: '', fremdName: '', quittiert: new Set(), banner: '',
                   ansageLog: [], feld: [], gemeldet: '' };

  // ---- Einstellung ----------------------------------------------------------------------------------
  function autoGelbModus() {
    const el = $('race-auto-gelb');
    const v = el ? el.value : 'aus';
    return v === 'npc' || v === 'alle' ? v : 'aus';
  }

  // ---- Wer kommt in Frage --------------------------------------------------------------------------
  function autoGelbSpielerNr(car) {
    if (!car) return 0;
    if (car === playerCar) return 1;
    return zweiSpieler ? spielerNrVon(car) : 0;
  }
  function autoGelbIstNpc(car) { return !!car && car.role === 'ghost'; }
  function autoGelbFeld(modus) {
    const l = autoGelb.feld; l.length = 0;
    const vf = typeof vfAktiv === 'function' && vfAktiv();
    for (const c of garage) {
      if (!c) continue;
      if (autoGelbIstNpc(c)) { if (c.ghost && c.ghost.running) l.push(c); }
      else if (modus === 'alle' && !vf && autoGelbSpielerNr(c) > 0) l.push(c);
    }
    return l;
  }
  // Seit wann meldet dieses Spielerauto durchgehend 0x00 (null = nicht abseits). Nur auf der Bahn: im
  // Ausdruck-Modus steht Byte 12 dauernd auf 0x00.
  function autoGelbAbseitsSeit(car) {
    if (trackMode !== 'on') return null;
    const nr = autoGelbSpielerNr(car);
    if (nr === 1) return offtrackSeit;
    if (nr >= 2) { const z = zusatzPlatz(nr); return z && z.abseits ? z.abseits.seit : null; }
    return null;
  }
  function autoGelbIstAb(car, jetzt) {
    if (autoGelbIstNpc(car)) return car.parked === 'Bahn verlassen';
    const s = autoGelbAbseitsSeit(car);
    return s !== null && s !== undefined && jetzt - s >= AG_SPIELER_EIN_MS;
  }
  function autoGelbFaehrt(car, jetzt) {
    if (autoGelbIstNpc(car)) {
      if (car.parked || !car.ghost || !car.ghost.running) return false;
    } else {
      const s = autoGelbAbseitsSeit(car);
      if (s !== null && s !== undefined) return false;
      // v1.4.52: Schuetteln zaehlt als Wiederaufnahme (spielerGeschuettelt, 50-drive.js): das Auto steht
      // noch und liest im Stand nichts, faehrt aber an. Danach muss es Kacheln melden wie jedes andere.
      if (car.schuettelAt && jetzt - car.schuettelAt <= AG_KACHEL_FRISCH_MS) return true;
    }
    if (car.tileCode === TILE_OFFTRACK) return false;
    return !!car.tileAt && jetzt - car.tileAt <= AG_KACHEL_FRISCH_MS;
  }

  // Wann darf ein NEUES Auto-Gelb beginnen ('' = es darf)?
  function autoGelbSperre() {
    if (raceState !== 'racing') return 'rennen';
    if (raceFormationLap) return 'formation';
    // v1.4.48 BESTELLT: "die gelbe Flagge sollte nicht automatisch direkt mit Rennbeginn getriggert werden."
    if (typeof abseitsInStartGnade === 'function' && abseitsInStartGnade()) return 'start';
    if (rennPauseAktiv()) return 'pause';
    if (typeof tutLaeuft === 'function' && tutLaeuft()) return 'tutorial';
    if (typeof challengeLaeuft === 'function' && challengeLaeuft()) return 'challenge';
    try { if (typeof st !== 'undefined' && st && st.schritt === 'fahrt-laeuft') return 'studie'; } catch (e) { /* ohne Studie */ }
    if (gelbDeaktiviert()) return 'gelb-aus';
    // Schon Gelb von Hand (oder dessen Anfahrt): das gilt, und es wird nichts uebernommen.
    if (flagState !== 'green' && autoGelb.phase === 'aus') return 'gelb';
    return '';
  }

  // ---- Name und Ort fuer Anzeige und Ansage --------------------------------------------------------
  function autoGelbSektor(car) {
    try {
      if (!zevStreckeBekannt()) return 0;
      const sek = zevSektorKacheln(currentTrackTiles);
      if (!sek || sek.length < 2) return 0;
      const ti = car && car.ghost ? car.ghost.tileIndex : null;
      if (ti === null || ti === undefined) return 0;
      for (let k = 0; k < sek.length; k++) if (sek[k].indexOf(ti) >= 0) return Math.min(10, k + 1);
    } catch (e) { /* ohne Sektor */ }
    return 0;
  }
  function autoGelbEintrag(car, jetzt) {
    const farbe = carColor(car);
    return { car, seit: jetzt, faehrtSeit: null, name: garageLabel(car), sektor: autoGelbSektor(car),
             farbeId: farbe && farbe.id !== 'keine' ? farbe.id : 'unbekannt',
             modellId: carModellWert(car.modellId) || '', nr: autoGelbSpielerNr(car),
             alias: String(car.alias || '').trim() };
  }
  // Der Satz fuer die Geraetestimme. Autoname wie im Rennstand (rennstandText): Fahrername, wenn so
  // eingestellt, sonst Farbe + Modell (oder Name) + "von Spieler n".
  function autoGelbText(x, spr) {
    const de = spr === 'de', L = de ? 'de' : 'en', Z = ZEV_ZAHL[L];
    let w;
    if (x.text) w = x.text;
    else if (x.alias && rennstandNamensart === 'fahrer') w = x.alias;
    else {
      const fw = RENNSTAND_FARBWORT[L][x.farbeId] || (de ? 'der' : 'the');
      w = fw + ' ' + (x.alias || RENNSTAND_MODELLWORT[L][x.modellId] || RENNSTAND_MODELLWORT[L]['']);
      if (x.nr) w += (de ? ' von Spieler ' : ' driven by player ') + x.nr;
    }
    w = w.charAt(0).toUpperCase() + w.slice(1);
    const k = x.sektor > 0 ? (de ? ' in Sektor ' : ' in sector ') + (Z[x.sektor] || x.sektor) : '';
    return de ? 'Gelbe Flagge. ' + w + ' hat einen Unfall gebaut' + k + '.'
              : 'Yellow flag. ' + w + ' has crashed' + k + '.';
  }
  // Die Clipfolge, wenn keine Geraetestimme spricht: der vorhandene Zufallsevent-Satz "Gelbe Flagge
  // [in Sektor X]. Abbremsen auf achtzig." und danach das Auto aus den Rennstand-Bausteinen
  // ("Der rote BMW von Spieler eins"). Einen Clip "hat einen Unfall gebaut" gibt es nicht.
  function autoGelbClipFolge(art, x) {
    if (art === 'ende') return ['z:gruen_' + (x.sektor || 0)];
    const l = ['z:gelb_' + (x.sektor || 0)];
    if (!x.text) {
      l.push('e:farbe_' + x.farbeId, 'e:modell_' + (x.modellId || 'auto'));
      if (x.nr) l.push('e:spieler' + x.nr);
    }
    return l;
  }
  function autoGelbStimme() {
    return typeof rennstandWebSpeechVerfuegbar === 'function' && rennstandWebSpeechVerfuegbar()
      && rennstandStimmenModus !== 'clips';
  }
  // Ueber die Ansagen-Warteschlange (80a) wie die Zufallsevents, etwas hoeher eingereiht (25 statt 22).
  function autoGelbAnsage(art, x) {
    const l = autoGelb.ansageLog;
    l.push(art === 'start' ? 'start:' + (x.text || x.name || '') + ':' + (x.sektor || 0) : 'ende:' + (x.sektor || 0));
    if (l.length > 30) l.shift();
    if (typeof soundEnabled === 'undefined' || !soundEnabled) return false;
    const spr = lang === 'de' ? 'de' : 'en';
    const spielen = async (gueltig) => {
      if (art === 'start' && autoGelbStimme()) {
        if (gueltig()) await ansagenTextSpielen(autoGelbText(x, spr), spr);
        return;
      }
      const z = await zevClipsLaden(spr);
      const e = art === 'start' && !x.text ? await rennstandClipsLaden(spr, true) : null;
      if (!gueltig()) return;
      const satz = Object.assign({}, e || {}, z || {});
      const folge = autoGelbClipFolge(art, x).map((k) => satz[k]);
      if (folge.every(Boolean)) await ansagenPufferSpielen(folge, { stadion: true });
      else if (folge[0]) await ansagenPufferSpielen([folge[0]], { stadion: true });
      else await ansagenTextSpielen(art === 'start' ? autoGelbText(x, spr) : zevAnsageText('gruen_' + (x.sektor || 0), spr), spr);
    };
    const erlaubt = () => soundEnabled;
    if (typeof ansageWarteschlange !== 'undefined' && !ansageWarteschlange) return ansagenSofort('event-autogelb', spielen, erlaubt);
    return rennAnsagen.einreihen('event-autogelb', 25, spielen, erlaubt);
  }

  // ---- Banner (Flaggenstreifen im Cockpit, aus updateFlagUi) ----------------------------------------
  function autoGelbBannerBauen(jetzt) {
    if (typeof autoGelb === 'undefined' || !autoGelb || autoGelb.phase !== 'gelb') return '';
    const l = autoGelb.liste;
    const ab = l.filter((e) => e.faehrtSeit === null);
    if (ab.length) {
      return String(ab[0].name).toUpperCase() + ' ' + t('NEBEN DER BAHN') + (ab.length > 1 ? ' +' + (ab.length - 1) : '');
    }
    if (l.length) {
      const spaet = Math.max.apply(null, l.map((e) => e.faehrtSeit));
      const s = Math.max(1, Math.ceil((AG_FAEHRT_MS - (jetzt - spaet)) / 1000));
      return t('WIEDERANLAUF IN') + ' ' + s + ' S';
    }
    if (autoGelb.fremd) return String(autoGelb.fremdName || '').toUpperCase() + ' ' + t('NEBEN DER BAHN');
    return '';
  }
  function autoGelbBannerText() {
    return typeof autoGelb === 'undefined' || !autoGelb ? '' : autoGelb.banner;
  }
  function autoGelbBannerSetzen(jetzt) {
    const txt = autoGelbBannerBauen(jetzt);
    if (txt === autoGelb.banner) return;
    autoGelb.banner = txt;
    updateFlagUi();
  }

  // ---- WLAN: das eigene Feld im Bericht, die fremden aus dem Abruf ----------------------------------
  // Form: "<sektor>|<farbeId>|<modellId>|<Name>" des ersten noch abgeflogenen Autos, '' = kein Gelb.
  function autoGelbMpFeld() {
    if (autoGelb.phase !== 'gelb' || !autoGelb.liste.length) return '';
    const e = autoGelb.liste[0];
    return (e.sektor || 0) + '|' + e.farbeId + '|' + (e.modellId || '') + '|' + String(e.name || '').replace(/\|/g, ' ').slice(0, 40);
  }
  function autoGelbMpMelden() {
    const feld = autoGelbMpFeld();
    if (feld === autoGelb.gemeldet) return;
    autoGelb.gemeldet = feld;
    if (typeof mp !== 'undefined' && mp.an && typeof mpBerichten === 'function') mpBerichten();
  }
  // Aus mpHolen (97-sessions.js), also hoechstens alle 1,5-3 s.
  function autoGelbMpPruefen(d) {
    let feld = '', name = '';
    const leute = (d && d.fahrer) || [];
    for (const f of leute) {
      if (!f || !f.id || f.id === mp.id || !f.gelb || !mpAktiv(f)) continue;
      feld = String(f.gelb); name = String(f.name || ''); break;
    }
    autoGelb.fremd = feld;
    autoGelb.fremdName = feld ? (feld.split('|')[3] || name) + (name ? ' (' + name + ')' : '') : '';
  }
  function autoGelbFremdInfo() {
    const p = String(autoGelb.fremd || '').split('|');
    const k = parseInt(p[0], 10);
    return { sektor: Number.isFinite(k) && k > 0 && k <= 10 ? k : 0, text: autoGelb.fremdName || p[3] || '?',
             name: autoGelb.fremdName };
  }

  // ---- Ablauf --------------------------------------------------------------------------------------
  function autoGelbZuruecksetzen() {
    autoGelb.phase = 'aus';
    autoGelb.liste.length = 0;
    autoGelb.quittiert.clear();
    autoGelbMpMelden();
    if (autoGelb.banner) { autoGelb.banner = ''; updateFlagUi(); }
  }
  function autoGelbBeginnen(e) {
    const war = autoGelb.phase;
    autoGelb.phase = 'gelb';
    if (flagState !== 'yellow') setFlag('yellow');
    showHudToast(t('GELBE FLAGGE') + ': ' + (e.name || e.text || ''));
    if (war !== 'gelb') log('Automatische Gelbe Flagge: ' + (e.name || e.text) + ' neben der Bahn'
                            + (e.sektor ? ' (Sektor ' + e.sektor + ')' : '') + '.', 'err');
    autoGelbAnsage('start', e);
  }
  function autoGelbTick() {
    const modus = autoGelbModus();
    if (modus === 'aus' && autoGelb.phase === 'aus' && !autoGelb.fremd) return;
    if (rennPauseAktiv()) return;
    if (raceState !== 'racing' && raceState !== 'finishing') {
      if (autoGelb.phase !== 'aus' || autoGelb.quittiert.size) autoGelbZuruecksetzen();
      autoGelb.fremd = '';
      return;
    }
    if (typeof mp === 'undefined' || !mp.an) autoGelb.fremd = '';
    const jetzt = rennZeitJetzt();
    // Von aussen beendet (Knopf "Freigeben", Rennende) oder von Hand wieder Gelb waehrend der Anfahrt:
    // die Rennleitung von Hand geht vor. Die betroffenen Autos loesen fuer DIESEN Abflug nicht erneut aus.
    if (autoGelb.phase === 'gelb' && flagState !== 'yellow') {
      for (const e of autoGelb.liste) autoGelb.quittiert.add(e.car);
      autoGelb.phase = 'aus'; autoGelb.liste.length = 0;
      log('Automatische Gelbe Flagge von Hand beendet.', 'info');
      autoGelbMpMelden();
    } else if (autoGelb.phase === 'anfahrt') {
      if (flagState === 'green') {
        autoGelb.phase = 'aus';
        autoGelbAnsage('ende', { sektor: autoGelb.endeSektor || 0 });
        log('Automatische Gelbe Flagge beendet, Gruen.', 'info');
      } else if (flagState === 'yellow') autoGelb.phase = 'aus';   // von Hand wieder Gelb
    }
    // Neue Abfluege.
    if (modus !== 'aus') {
      const feld = autoGelbFeld(modus);
      const sperre = autoGelbSperre();
      for (const c of feld) {
        const ab = autoGelbIstAb(c, jetzt);
        if (autoGelb.quittiert.has(c)) { if (!ab) autoGelb.quittiert.delete(c); continue; }
        if (!ab || sperre !== '' || autoGelb.liste.some((e) => e.car === c)) continue;
        const e = autoGelbEintrag(c, jetzt);
        autoGelb.liste.push(e);
        autoGelbBeginnen(e);
      }
    }
    // Ein anderes Telefon meldet Gelb.
    if (autoGelb.fremd && autoGelb.phase !== 'gelb' && autoGelbSperre() === '') {
      autoGelbBeginnen(autoGelbFremdInfo());
    }
    if (autoGelb.phase === 'gelb') {
      const l = autoGelb.liste;
      for (let i = l.length - 1; i >= 0; i--) {
        const c = l[i].car;
        // Abgemeldet oder als NPC angehalten: kommt nicht zurueck, haelt also auch kein Gelb.
        if (garage.indexOf(c) < 0 || (autoGelbIstNpc(c) && !(c.ghost && c.ghost.running))) { l.splice(i, 1); continue; }
        if (autoGelbFaehrt(c, jetzt)) { if (l[i].faehrtSeit === null) l[i].faehrtSeit = jetzt; }
        else l[i].faehrtSeit = null;
      }
      const alleZurueck = l.every((e) => e.faehrtSeit !== null && jetzt - e.faehrtSeit >= AG_FAEHRT_MS);
      if (alleZurueck && !autoGelb.fremd) {
        const sek = l.length && l.every((e) => e.sektor === l[0].sektor) ? l[0].sektor : 0;
        autoGelb.endeSektor = sek;
        l.length = 0;
        autoGelb.phase = 'anfahrt';
        yellowRestart();
        showHudToast(t('Wiederanlauf'));
        log('Automatische Gelbe Flagge: alle Autos fahren wieder, Anfahrt-Ampel.', 'info');
      }
    }
    autoGelbMpMelden();
    autoGelbBannerSetzen(jetzt);
  }
  let autoGelbFehlerZuletzt = '';
  setInterval(() => {
    try { autoGelbTick(); } catch (e) {
      if (e.message !== autoGelbFehlerZuletzt) { autoGelbFehlerZuletzt = e.message; log('Automatische Gelbe Flagge: ' + e.message, 'warn'); }
    }
  }, AG_TAKT_MS);
