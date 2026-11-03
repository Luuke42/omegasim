  // ====================================================================================
  // CHALLENGES-STARTSEITE: Community-Vorschau und Laden beim Oeffnen (v1.3.58, v1.3.62)
  // ====================================================================================
  //
  // BESTELLT (v1.3.58): "Strukturiere die Challenges um: Wenn ich auf den Tab klicke, fange an,
  // die Zeiten zu laden mit Lade-Symbol (drehendes Streckenteil) unten links (ohne WIP-Label).
  // ... Der Community-Tab [soll] ganz oben stehen (vor woechentlichen Challenges) und Network ganz
  // unten. ... Die Vorschau sollte wie die anderen Dauerrennen etc. Vorschauen die Anzahl Spieler
  // haben, aber auch ein Schwierigkeits-Label (z. B. Pacejka)."
  // BESTELLT (v1.3.62): "Macht es Sinn, die beiden Community-Dinger zusammenzulegen? Dann zeige
  // immer die ersten 3 Strecken + eine Kachel in derselben Groesse 'Alle anzeigen' bzw. wenn es
  // nur 1 Strecke gibt, dann die." - Ja: EINE Rangliste aus Community Challenges und Strecken mit
  // Zeiten (commEintraege), EINE Listenseite (sub-ch-community, Filter Alle/Challenges/Strecken).
  //
  // ZUSAMMENFUEHRUNG: Steht die Strecke einer Challenge auch unter den Strecken mit Zeiten
  // (gleicher Schluessel skSchluessel: Code ohne Drehung, Spiegelbild = dieselbe), erscheint sie
  // nur einmal, als Challenge, mit deren Fahrerzahl.
  // RANG = meiste verschiedene Fahrer (Geraete), bei Gleichstand meiste Laeufe.
  // SCHWIERIGKEIT = Fahrgefuehl: bei einer Challenge die vorgeschriebene Abstimmung (tr.preset),
  // bei einer Strecke das Fahrgefuehl mit den meisten Fahrern, bei Gleichstand das der
  // schnelleren Bestzeit.
  // KACHELN: die ersten bis zu 3 Eintraege; gibt es mehr, danach "Alle anzeigen" in derselben
  // Groesse. Sonst steht an dieser Stelle "Strecke einreichen" (ebenfalls gleich gross): ohne sie
  // waere das Einreichen einer eigenen Challenge bei hoechstens 3 Eintraegen nicht erreichbar.
  //
  // Geladen wird beim Oeffnen des Tabs (10-ble-explorer.js) im Hintergrund, mit denselben
  // Zwischenspeichern wie die Listen (2 bzw. 5 Minuten) und nie waehrend Countdown/Rennen
  // (chNetzErlaubt). Die Ladeanzeige ist die drehende Gerade aus 59-lade.js, unten links.
  const CH_V_KARTEN = 3;

  // ---- Rangliste: reine Rechnungen (Selbsttest) ----
  function chVorschauStreckeLaeufe(s) {
    if (+s.laeufe > 0) return +s.laeufe;
    if (s.nurLokal) { const l = skLokalAlle()[s.strecke]; return Array.isArray(l) ? l.length : 0; }
    return 0;
  }
  // data: communitySicht(), strecken: Eintraege wie aus ?strecken=1 (Vorgabe: aktuelle Liste + eigene).
  function commEintraege(data, strecken) {
    const d = data || communitySicht();
    const liste = strecken || skCommunityGefiltert(skOnline.liste, skEigeneStrecken());
    const raus = [];
    const schluessel = new Set();
    for (const tr of d.tracks || []) {
      const key = skSchluesselAusCode(tr.code) || tr.code;
      if (schluessel.has(key)) continue;
      schluessel.add(key);
      raus.push({ art: 'challenge', tr, key, spieler: communitySpieler(d, tr.id), laeufe: (d.times[tr.id] || []).length });
    }
    for (const s of liste || []) {
      const key = skSchluesselAusCode(s.strecke) || s.strecke;
      if (schluessel.has(key)) continue;
      schluessel.add(key);
      raus.push({ art: 'strecke', s, key, spieler: +s.fahrer || 0, laeufe: chVorschauStreckeLaeufe(s) });
    }
    // Stabil sortiert: bei voellig gleichem Stand bleiben Challenges vorn.
    return raus.map((e, i) => [e, i]).sort((a, b) => (b[0].spieler - a[0].spieler) || (b[0].laeufe - a[0].laeufe) || (a[1] - b[1]))
      .map((x) => x[0]);
  }
  // Das haeufigste Fahrgefuehl einer Strecke (meiste Fahrer), bei Gleichstand das der schnelleren
  // Bestzeit; ohne Angaben je Fahrgefuehl das der Bestzeit.
  function chVorschauFahrgefuehl(s) {
    const je = s && s.je && typeof s.je === 'object' ? s.je : null;
    let best = null;
    if (je) {
      Object.keys(je).forEach((fg) => {
        const e = je[fg] || {};
        const n = +e.fahrer || 0, ms = +e.beste_ms || Infinity;
        if (!best || n > best.n || (n === best.n && ms < best.ms)) best = { fg, n, ms };
      });
    }
    if (best) return skFgGueltig(best.fg);
    const bz = skListenBestzeit(s || {}, skFgAktuell());
    return bz ? skFgGueltig(bz.fg) : 'unbekannt';
  }

  // ---- Zeichnen ----
  function chVorschauMini(tiles) {
    if (!tiles || tiles.length < 3) return '';
    const merk = trackRotationDeg;
    trackRotationDeg = 0;
    try { return renderTrackPreview(tiles, null, {}).html; } catch (e) { return ''; } finally { trackRotationDeg = merk; }
  }
  function chVorschauSpielerText(sp, lf) {
    return (sp === 1 ? t('1 Spieler') : t('{n} Spieler').replace('{n}', sp))
      + ' · ' + (lf === 1 ? t('1 Ergebnis') : t('{n} Ergebnisse').replace('{n}', lf));
  }
  // Eine Karte im Markup der Wochen-/Dauerrennen-Kacheln (ch-kachel).
  function chVorschauKarteBauen() {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'misc-tile ch-kachel ch-v-karte';
    k.innerHTML = '<span class="ch-mini" aria-hidden="true"></span><b class="ch-k-name" data-i18n-skip></b>'
      + '<span class="ch-k-info" data-i18n-skip></span><em class="ch-k-woche" data-i18n-skip></em>'
      + '<em class="ch-k-anzahl" data-i18n-skip></em>';
    return k;
  }
  // z: { laedt, leer, tiles, code, name, info, label, art, spieler, laeufe, oeffnen }
  function chVorschauKarte(karte, z) {
    const mini = karte.querySelector('.ch-mini');
    const name = karte.querySelector('.ch-k-name');
    const info = karte.querySelector('.ch-k-info');
    const woche = karte.querySelector('.ch-k-woche');
    const anzahl = karte.querySelector('.ch-k-anzahl');
    karte.classList.toggle('ch-v-leer', !!(z.leer || z.laedt));
    karte.classList.toggle('ch-v-laedt', !!z.laedt);
    if (z.art) karte.dataset.art = z.art; else delete karte.dataset.art;
    info.textContent = '';
    if (z.laedt) {
      mini.innerHTML = typeof ladeAnimationHtml === 'function' ? ladeAnimationHtml('') : '';
      name.textContent = t('Lädt …');
      woche.textContent = '';
      anzahl.textContent = ''; anzahl.hidden = true;
    } else if (z.leer) {
      mini.innerHTML = '';
      name.textContent = z.name;
      woche.textContent = z.info || '';
      anzahl.textContent = ''; anzahl.hidden = true;
    } else {
      mini.innerHTML = chVorschauMini(z.tiles);
      name.textContent = z.name;
      info.textContent = z.info || '';
      woche.innerHTML = '';
      const l = document.createElement('span');
      l.className = 'ch-v-label';
      l.textContent = z.label;
      woche.appendChild(l);
      if (z.art === 'challenge') {
        const a = document.createElement('span');
        a.className = 'ch-v-art';
        a.textContent = t('Challenge');
        woche.appendChild(document.createTextNode(' '));
        woche.appendChild(a);
      }
      anzahl.hidden = false;
      anzahl.textContent = chVorschauSpielerText(z.spieler, z.laeufe);
    }
    karte.setAttribute('aria-label', (z.laedt ? t('Lädt …') : z.name) + (z.leer || z.laedt ? ''
      : ', ' + (z.art === 'challenge' ? t('Challenge') + ', ' : '') + z.label + ', ' + chVorschauSpielerText(z.spieler, z.laeufe)));
    karte.onclick = z.oeffnen;
  }
  function chVorschauEintragDaten(e, data) {
    if (e.art === 'challenge') {
      const tr = e.tr, p = codeToTrack(tr.code), best = communityBesteZeit(data, tr.id);
      return { art: 'challenge', tiles: p ? p.tiles : null, code: tr.code, name: tr.id + ' · ' + tr.name,
        info: best ? t('Bestzeit') + ' ' + chZeit(best) : t('Noch keine Zeit'), label: communityPresetName(tr.preset),
        spieler: e.spieler, laeufe: e.laeufe, oeffnen: () => challengeSeiteZeigen(tr.id) };
    }
    const s = e.s, p = codeToTrack(s.strecke), fg = chVorschauFahrgefuehl(s), bz = skListenBestzeit(s, fg);
    return { art: 'strecke', tiles: p ? p.tiles : null, code: s.strecke, name: s.name || s.strecke,
      info: bz ? t('Bestzeit') + ' ' + chZeit(bz.ms) : t('Noch keine Zeit'), label: skFgName(fg),
      spieler: e.spieler, laeufe: e.laeufe, oeffnen: () => skDetailOeffnen(s) };
  }
  function chVorschauZeichnen() {
    const gitter = $('ch-v-gitter');
    if (!gitter) return;
    if (typeof skCacheLaden === 'function') skCacheLaden();
    const data = communitySicht();
    const alle = commEintraege(data);
    const laedt = (communityHolt && !communityOnline) || (skOnline.listeLaedt && !skOnline.liste);
    const zeigen = alle.slice(0, CH_V_KARTEN);
    const daten = zeigen.length ? zeigen.map((e) => chVorschauEintragDaten(e, data))
      : [laedt ? { laedt: true, leer: true, oeffnen: () => showSubpage('ch-community') }
               : { leer: true, name: t('Noch nichts in der Community'),
                   info: t('Reiche deine Strecke als Challenge ein oder fahr ein Rennen auf deiner Strecke.'),
                   oeffnen: () => showSubpage('ch-community') }];
    const vorhanden = [...gitter.querySelectorAll('.ch-v-karte')];
    const vorAlle = $('ch-v-alle');
    while (vorhanden.length < daten.length) { const k = chVorschauKarteBauen(); gitter.insertBefore(k, vorAlle); vorhanden.push(k); }
    while (vorhanden.length > daten.length) vorhanden.pop().remove();
    daten.forEach((z, i) => chVorschauKarte(vorhanden[i], z));
    // Nur wenn es mehr gibt als gezeigt: "Alle anzeigen" (gleich gross). Sonst "Strecke einreichen".
    const mehr = alle.length > zeigen.length;
    if (vorAlle) {
      vorAlle.hidden = !mehr;
      const n = vorAlle.querySelector('.ch-k-anzahl');
      if (n) n.textContent = mehr ? t('{n} weitere').replace('{n}', alle.length - zeigen.length) : '';
    }
    if ($('ch-v-einreichen')) $('ch-v-einreichen').hidden = mehr;
  }

  // ---- Laden beim Oeffnen des Tabs ----
  // Rueckgabe: ein Promise, das nach beiden Abrufen (oder sofort, wenn nichts zu holen ist) erfuellt ist.
  function chVorschauLaden() {
    const jobs = [];
    if (chNetzErlaubt()) {
      if (communityUrl() && !communityHolt && (!communityOnline || Date.now() - communityOnlineAt > 120000)) {
        jobs.push(ladeAnzeigeMit('ch-community', communityHolen(false)));
      }
      if (typeof skCacheLaden === 'function') skCacheLaden();
      if (skUrl() && !skOnline.listeLaedt && (!skOnline.liste || Date.now() - skOnline.listeAt > SK_LISTE_MS)) {
        jobs.push(ladeAnzeigeMit('ch-strecken', skListeHolen(false)));
      }
    }
    chVorschauZeichnen();
    return Promise.all(jobs.map((j) => Promise.resolve(j).catch(() => null))).then(() => { chVorschauZeichnen(); });
  }
  if ($('ch-v-einreichen')) $('ch-v-einreichen').addEventListener('click', () => communityEinreichenStarten());
  setTimeout(() => { try { chVorschauZeichnen(); } catch (e) { /* noch nicht bereit */ } }, 0);
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => { try { chVorschauZeichnen(); } catch (e) { /* egal */ } });
