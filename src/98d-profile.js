
  // ============================ PRESETS JE MENUE UND PROFILE (v0.9.14) ============================
  //
  // BESTELLT: "mach Vorschlaege fuer ein Speicherungssystem, je Menue (Fahrgefuehl,
  // Tastenbelegung), mit Presets und Namen zum Speichern" und (Familie) "ob es nicht Sinn macht,
  // ein globales Profil zu erstellen". Abgesegnet am Mock-up mockup/speichern.html.
  //
  // DREI EBENEN:
  //   1. Profil (global): wer spielt. Ein Profil ist ein vollstaendiger Stand aller Menues und der
  //      Tastenbelegung. Wechsel unter Optionen > System.
  //   2. Preset je Menue: ein benannter Stand fuer GENAU EIN Menue, oben auf jeder Seite.
  //   3. Geraetedaten (Autos, Strecken, Statistiken, Sprache): gehoeren keinem Profil.
  //
  // Alles speichert sich weiterhin von selbst (98b-sicherung.js). Ein Preset aendert nichts an
  // dieser Selbstsicherung - es ist nur ein benannter Stand, zu dem man wechseln kann.

  const MNP_STORE = 'chc.menupresets.v1';
  const PROFIL_STORE = 'chc.profile.v1';
  // Die Menues. root: das Element, dessen Optionszeilen zum Preset gehoeren.
  const MNP_BEREICHE = [
    { id: 'general', root: 'sub-opt-general', titel: 'Allgemein' },
    { id: 'feel', root: 'sub-opt-feel', titel: 'Fahrgefühl', werks: true },
    { id: 'sound', root: 'sub-opt-sound', titel: 'Ton' },
    { id: 'ghosts', root: 'sub-opt-ghosts', titel: 'Autonome Gegner' },
    { id: 'pad', root: 'sub-opt-pad', titel: 'Controller', pad: true },
    { id: 'race', root: 'tab-control', titel: 'Renneinstellungen' },
  ];
  function mnpLesenStore() {
    try { const s = JSON.parse(localStorage.getItem(MNP_STORE) || '{}'); return s && typeof s === 'object' ? s : {}; }
    catch (e) { return {}; }
  }
  function mnpSchreibenStore(s) {
    try { localStorage.setItem(MNP_STORE, JSON.stringify(s)); } catch (e) { /* voll oder privat */ }
  }
  function mnpBereich(s, id) {
    if (!s[id] || typeof s[id] !== 'object') s[id] = { eigene: {}, aktiv: null };
    if (!s[id].eigene) s[id].eigene = {};
    return s[id];
  }
  function mnpRegler(b) {
    const root = $(b.root);
    if (!root) return [];
    return [...root.querySelectorAll('.opt-row input[id]:not([type=file]):not([type=button]):not([data-preset-skip]), '
      + '.opt-row select[id]:not([data-preset-skip])')];
  }
  function mnpWert(el) { return el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value; }
  function mnpWerteLesen(b) {
    if (b.pad) return { b1: JSON.parse(JSON.stringify(bindings)), b2: JSON.parse(JSON.stringify(bindings2)),
                        b3: JSON.parse(JSON.stringify(bindingsVon(3))) };
    const o = {};
    for (const el of mnpRegler(b)) o[el.id] = mnpWert(el);
    return o;
  }
  function mnpWerteAnwenden(b, w) {
    if (!w) return 0;
    if (b.pad) {
      if (w.b1) { bindings = resolveBindingCollisions(migrateBindings({ ...DEFAULT_BINDINGS, ...w.b1 })); delete bindings.__kollisionen; saveBindings(); }
      if (w.b2) { bindings2 = resolveBindingCollisions({ ...DEFAULT_BINDINGS2, ...w.b2 }, DEFAULT_BINDINGS2); delete bindings2.__kollisionen; saveBindings2(); }
      if (w.b3) { const b3 = resolveBindingCollisions({ ...DEFAULT_BINDINGS2, ...w.b3 }, DEFAULT_BINDINGS2); delete b3.__kollisionen; zusatzPlatz(3).bindings = b3; saveBindingsVon(3); }
      if (typeof renderBindTable === 'function') renderBindTable();
      return 1;
    }
    let n = 0;
    for (const [id, v] of Object.entries(w)) if (presetSet(id, v)) n++;
    return n;
  }
  // Werkseinstellung eines Menues: die Werte, mit denen das Markup ausgeliefert wird.
  function mnpWerksWerte(b) {
    if (b.pad) return { b1: { ...DEFAULT_BINDINGS }, b2: { ...DEFAULT_BINDINGS2 }, b3: { ...DEFAULT_BINDINGS2 } };
    const o = {};
    for (const el of mnpRegler(b)) {
      if (el.type === 'checkbox') o[el.id] = el.defaultChecked;
      else if (el.tagName === 'SELECT') {
        const d = [...el.options].find((x) => x.defaultSelected) || el.options[0];
        if (d) o[el.id] = d.value;
      } else o[el.id] = el.type === 'range' || el.type === 'number' ? +el.defaultValue : el.defaultValue;
    }
    return o;
  }
  // Die Liste eines Menues: Werkspresets (mit Stern) und eigene. Im Fahrgefuehl sind die
  // kuratierten Abstimmungen (Arcade, Pro, ...) die Werkspresets, und die bisherige "Eigene
  // Abstimmung" (chc.presets.v1) erscheint mit - nichts geht verloren.
  function mnpListe(b) {
    const s = mnpBereich(mnpLesenStore(), b.id);
    const l = [];
    if (b.werks && typeof PRESETS === 'object') {
      for (const k of Object.keys(PRESETS)) l.push({ key: '*' + k, name: PRESETS[k].label, werks: true, werte: () => PRESETS[k].v });
    }
    l.push({ key: '*werk', name: t('Werkseinstellung'), werks: true, werte: () => mnpWerksWerte(b) });
    for (const n of Object.keys(s.eigene).sort()) l.push({ key: n, name: n, werte: () => s.eigene[n] });
    if (b.id === 'feel' && typeof presetStoreRead === 'function') {
      const alt = presetStoreRead();
      for (const n of Object.keys(alt).sort()) {
        if (!s.eigene[n]) l.push({ key: 'alt:' + n, name: n, alt: true, werte: () => alt[n] });
      }
    }
    return l;
  }
  function mnpGleich(b, w) {
    if (!w) return false;
    const jetzt = mnpWerteLesen(b);
    if (b.pad) {
      // Je Spieler vergleichen; ein Preset von vor v0.9.17 kennt Spieler 3 nicht und gilt fuer
      // ihn als "egal".
      const werk = { b1: DEFAULT_BINDINGS, b2: DEFAULT_BINDINGS2, b3: DEFAULT_BINDINGS2 };
      return ['b1', 'b2', 'b3'].every((k) => (k === 'b3' && !w[k])
        || JSON.stringify(jetzt[k]) === JSON.stringify({ ...werk[k], ...w[k] })
        || JSON.stringify(jetzt[k]) === JSON.stringify(w[k]));
    }
    return Object.entries(w).every(([id, v]) => !(id in jetzt) || String(jetzt[id]) === String(v));
  }
  function mnpSagen(b, text) {
    const el = document.querySelector('.mp-status[data-mp="' + b.id + '"]');
    if (el) el.textContent = text;
  }
  function mnpZeichnen(b) {
    const zeile = document.querySelector('.menu-preset[data-mp="' + b.id + '"]');
    if (!zeile) return;
    const s = mnpBereich(mnpLesenStore(), b.id);
    const liste = mnpListe(b);
    const sel = zeile.querySelector('select.mp-sel');
    sel.innerHTML = liste.map((e) => '<option value="' + e.key.replace(/"/g, '&quot;') + '">'
      + e.name.replace(/</g, '&lt;') + (e.werks ? ' ★' : '') + '</option>').join('');
    const aktiv = liste.find((e) => e.key === s.aktiv) || null;
    if (aktiv) sel.value = aktiv.key; else sel.selectedIndex = -1;
    const name = zeile.querySelector('.mp-name');
    name.textContent = aktiv ? aktiv.name + (aktiv.werks ? ' ★' : '') : t('– keins –');
    const geaendert = aktiv && !mnpGleich(b, aktiv.werte());
    zeile.querySelector('.mp-geaendert').textContent = geaendert ? '· ' + t('geändert') : '';
    const knoepfe = document.querySelector('.menu-preset-knoepfe[data-mp="' + b.id + '"]');
    if (knoepfe) {
      const loesch = knoepfe.querySelector('[data-mp-act="loeschen"]');
      if (loesch) loesch.disabled = !aktiv || aktiv.werks;
    }
  }
  function mnpWaehlen(b, key) {
    const e = mnpListe(b).find((x) => x.key === key);
    if (!e) return;
    const n = mnpWerteAnwenden(b, e.werte());
    const s = mnpLesenStore();
    mnpBereich(s, b.id).aktiv = key;
    mnpSchreibenStore(s);
    mnpSagen(b, t('„{n}“ geladen.').replace('{n}', e.name) + (b.pad ? '' : ' ' + t('{k} Regler gesetzt.').replace('{k}', n)));
    mnpZeichnen(b);
  }
  function mnpSpeichernUnter(b, vorschlag) {
    const name = (prompt(t('Name des Presets'), vorschlag || '') || '').trim().slice(0, 40);
    if (!name) return;
    const s = mnpLesenStore();
    const ber = mnpBereich(s, b.id);
    ber.eigene[name] = mnpWerteLesen(b);
    ber.aktiv = name;
    mnpSchreibenStore(s);
    mnpSagen(b, t('„{n}“ gespeichert.').replace('{n}', name));
    mnpZeichnen(b);
  }
  function mnpSpeichern(b) {
    const s = mnpLesenStore();
    const ber = mnpBereich(s, b.id);
    const aktiv = mnpListe(b).find((e) => e.key === ber.aktiv);
    if (!aktiv || aktiv.werks || aktiv.alt) { mnpSpeichernUnter(b, aktiv && !aktiv.werks ? aktiv.name : ''); return; }
    ber.eigene[aktiv.key] = mnpWerteLesen(b);
    mnpSchreibenStore(s);
    mnpSagen(b, t('„{n}“ gespeichert.').replace('{n}', aktiv.name));
    mnpZeichnen(b);
  }
  function mnpLoeschen(b) {
    const s = mnpLesenStore();
    const ber = mnpBereich(s, b.id);
    const aktiv = mnpListe(b).find((e) => e.key === ber.aktiv);
    if (!aktiv || aktiv.werks) return;
    konsoleFrage(t('Preset löschen?'), t('„{n}“ wird gelöscht. Die aktuellen Einstellungen bleiben, wie sie sind.').replace('{n}', aktiv.name),
      [[t('Löschen'), () => {
        const s2 = mnpLesenStore();
        const b2 = mnpBereich(s2, b.id);
        if (aktiv.alt && typeof presetStoreRead === 'function') {
          const alt = presetStoreRead(); delete alt[aktiv.name]; presetStoreWrite(alt);
          if (typeof presetStoreList === 'function') presetStoreList();
        } else delete b2.eigene[aktiv.key];
        b2.aktiv = null;
        mnpSchreibenStore(s2);
        mnpSagen(b, t('„{n}“ gelöscht.').replace('{n}', aktiv.name));
        mnpZeichnen(b);
      }], [t('Abbrechen'), null]]);
  }
  // Die Zeilen bauen: eine Preset-Zeile (◀ Name ▶, Steuerkreuz links/rechts waehlt) und drei
  // Knopfzeilen nebeneinander. data-preset-skip und ohne id: sie gehoeren selbst zu keinem Preset
  // und werden nicht selbstgesichert.
  function mnpZeilenBauen(b) {
    const root = $(b.root);
    if (!root || root.querySelector('.menu-preset')) return;
    const box = document.createElement('div');
    box.className = 'menu-preset-box';
    box.innerHTML = `
      <div class="opt-row menu-preset" data-mp="${b.id}">
        <div class="opt-label">${t('Preset')} <span class="wip-tag">${t('experimentell')}</span><small>${t('Ein benannter Stand nur für dieses Menü. ◀ ▶ wechselt sofort. „geändert“ heißt: seit dem Laden verstellt – gespeichert ist es trotzdem (alles speichert sich von selbst), „Speichern“ schreibt es ins Preset zurück. ★ = Werkspreset.')}</small></div>
        <span class="mp-wahl"><button type="button" class="mp-pf" data-d="-1" aria-label="${t('zurück')}">&#9664;</button>
          <b class="mp-name" data-i18n-skip></b><span class="mp-geaendert" data-i18n-skip></span>
          <button type="button" class="mp-pf" data-d="1" aria-label="${t('weiter')}">&#9654;</button></span>
        <select class="mp-sel" hidden data-preset-skip data-blaettern="1" aria-label="${t('Preset')}"></select>
      </div>
      <div class="menu-preset-knoepfe" data-mp="${b.id}">
        <div class="opt-row opt-breit"><button type="button" data-mp-act="speichern">${t('Speichern')}</button></div>
        <div class="opt-row opt-breit"><button type="button" data-mp-act="unter">${t('Speichern unter …')}</button></div>
        <div class="opt-row opt-breit"><button type="button" data-mp-act="loeschen">${t('Löschen')}</button></div>
      </div>
      <div class="muted mp-status" data-mp="${b.id}" data-i18n-skip></div>`;
    // Nach der Ueberschrift (und dem Zurueck-Knopf) einsetzen.
    const h = root.querySelector('h2');
    if (h && h.parentNode === root) h.insertAdjacentElement('afterend', box);
    else root.insertBefore(box, root.firstChild);
    const sel = box.querySelector('select.mp-sel');
    sel.addEventListener('change', () => mnpWaehlen(b, sel.value));
    box.querySelectorAll('.mp-pf').forEach((p) => p.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = sel.options.length;
      if (!n) return;
      const i = sel.selectedIndex < 0 ? (+p.dataset.d > 0 ? 0 : n - 1) : ((sel.selectedIndex + +p.dataset.d) % n + n) % n;
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    box.querySelector('[data-mp-act="speichern"]').onclick = () => mnpSpeichern(b);
    box.querySelector('[data-mp-act="unter"]').onclick = () => mnpSpeichernUnter(b, '');
    box.querySelector('[data-mp-act="loeschen"]').onclick = () => mnpLoeschen(b);
    // "geaendert" nachfuehren, sobald im Menue etwas verstellt wird.
    let faellig = null;
    const nach = (e) => {
      if (e.target && e.target.closest && e.target.closest('.menu-preset-box')) return;
      clearTimeout(faellig);
      faellig = setTimeout(() => mnpZeichnen(b), 250);
    };
    root.addEventListener('input', nach);
    root.addEventListener('change', nach);
    mnpZeichnen(b);
  }
  MNP_BEREICHE.forEach(mnpZeilenBauen);
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => MNP_BEREICHE.forEach(mnpZeichnen));
  // Die alte Ablage im Fahrgefuehl ("Oder auf diesem Geraet ablegen") ist jetzt die Preset-Zeile
  // oben; ihre Eintraege stehen dort in der Liste. Die Knoepfe bleiben im Dokument (Tests,
  // Garage), werden aber nicht mehr gezeigt.
  (function () {
    const n = $('preset-store-name');
    const zeile = n && n.closest('.row');
    if (zeile) { zeile.hidden = true; const p = zeile.previousElementSibling; if (p && p.tagName === 'P') p.hidden = true; }
  })();

  // ---- PROFILE ----------------------------------------------------------------------------
  // Ein Profil = alle Regler (dieselbe Auswahl wie die Selbstsicherung), die Tastenbelegung beider
  // Spieler und welches Preset je Menue aktiv war. Gewechselt wird so: den jetzigen Stand ins
  // aktive Profil schreiben, dann den des Ziels anwenden.
  function profilLesen() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROFIL_STORE) || 'null'); } catch (e) { /* kaputt */ }
    if (!p || typeof p !== 'object' || !p.profile) p = { aktiv: 'Standard', profile: {} };
    if (!p.profile[p.aktiv]) p.profile[p.aktiv] = null;   // noch kein Stand gemerkt
    return p;
  }
  function profilSchreiben(p) {
    try { localStorage.setItem(PROFIL_STORE, JSON.stringify(p)); } catch (e) { /* voll */ }
  }
  function profilStand() {
    const mp = mnpLesenStore();
    const aktivJe = {};
    for (const b of MNP_BEREICHE) aktivJe[b.id] = mnpBereich(mp, b.id).aktiv;
    return { regler: sicherungReglerLesen(), b1: JSON.parse(JSON.stringify(bindings)),
             b2: JSON.parse(JSON.stringify(bindings2)), b3: JSON.parse(JSON.stringify(bindingsVon(3))), menue: aktivJe };
  }
  function profilAnwenden(stand) {
    if (!stand) return;
    for (const [id, v] of Object.entries(stand.regler || {})) presetSet(id, v);
    mnpWerteAnwenden(MNP_BEREICHE.find((b) => b.pad), { b1: stand.b1, b2: stand.b2, b3: stand.b3 });
    const mp = mnpLesenStore();
    for (const b of MNP_BEREICHE) mnpBereich(mp, b.id).aktiv = (stand.menue || {})[b.id] || null;
    mnpSchreibenStore(mp);
    MNP_BEREICHE.forEach(mnpZeichnen);
  }
  function profilWechseln(name) {
    const p = profilLesen();
    if (name === p.aktiv || !(name in p.profile)) return;
    p.profile[p.aktiv] = profilStand();
    const ziel = p.profile[name];
    p.aktiv = name;
    profilSchreiben(p);
    if (ziel) profilAnwenden(ziel);
    profilZeichnen();
    showHudToast(t('Profil „{n}“').replace('{n}', name));
  }
  function profilNeu() {
    const name = (prompt(t('Name des neuen Profils'), '') || '').trim().slice(0, 24);
    if (!name) return;
    const p = profilLesen();
    if (name in p.profile) { showHudToast(t('Das Profil gibt es schon.')); return; }
    p.profile[p.aktiv] = profilStand();
    p.profile[name] = profilStand();      // Kopie des jetzigen Stands
    p.aktiv = name;
    profilSchreiben(p);
    profilZeichnen();
  }
  function profilUmbenennen() {
    const p = profilLesen();
    const name = (prompt(t('Neuer Name für „{n}“').replace('{n}', p.aktiv), p.aktiv) || '').trim().slice(0, 24);
    if (!name || name === p.aktiv || name in p.profile) return;
    p.profile[name] = p.profile[p.aktiv];
    delete p.profile[p.aktiv];
    p.aktiv = name;
    profilSchreiben(p);
    profilZeichnen();
  }
  function profilLoeschen() {
    const p = profilLesen();
    const namen = Object.keys(p.profile);
    if (namen.length < 2) { showHudToast(t('Das letzte Profil bleibt.')); return; }
    konsoleFrage(t('Profil löschen?'), t('„{n}“ wird gelöscht, die App wechselt zum nächsten Profil.').replace('{n}', p.aktiv),
      [[t('Löschen'), () => {
        const q = profilLesen();
        const weg = q.aktiv;
        const ziel = Object.keys(q.profile).find((n) => n !== weg);
        delete q.profile[weg];
        q.aktiv = ziel;
        profilSchreiben(q);
        if (q.profile[ziel]) profilAnwenden(q.profile[ziel]);
        profilZeichnen();
      }], [t('Abbrechen'), null]]);
  }
  function profilZeichnen() {
    const zeile = document.querySelector('.profil-zeile');
    if (!zeile) return;
    const p = profilLesen();
    const sel = zeile.querySelector('select');
    const namen = Object.keys(p.profile).sort();
    sel.innerHTML = namen.map((n) => '<option>' + n.replace(/</g, '&lt;') + '</option>').join('');
    sel.value = p.aktiv;
    zeile.querySelector('.mp-name').textContent = p.aktiv;
  }
  (function profilBauen() {
    const root = $('sub-opt-system');
    if (!root || root.querySelector('.profil-zeile')) return;
    const box = document.createElement('div');
    box.className = 'menu-preset-box profil-box';
    box.innerHTML = `
      <div class="opt-row profil-zeile">
        <div class="opt-label">${t('Profil')} <span class="wip-tag">${t('experimentell')}</span><small>${t('Wer spielt? Ein Profil merkt sich alle Einstellungen, die Tastenbelegung und das Preset je Menü. Autos, Strecken und Statistiken gehören keinem Profil, sie gelten immer.')}</small></div>
        <span class="mp-wahl"><button type="button" class="mp-pf" data-d="-1" aria-label="${t('zurück')}">&#9664;</button>
          <b class="mp-name" data-i18n-skip></b>
          <button type="button" class="mp-pf" data-d="1" aria-label="${t('weiter')}">&#9654;</button></span>
        <select hidden data-preset-skip data-blaettern="1" aria-label="${t('Profil')}"></select>
      </div>
      <div class="menu-preset-knoepfe">
        <div class="opt-row opt-breit"><button type="button" data-pr="neu">${t('Neues Profil')}</button></div>
        <div class="opt-row opt-breit"><button type="button" data-pr="um">${t('Umbenennen')}</button></div>
        <div class="opt-row opt-breit"><button type="button" data-pr="weg">${t('Löschen')}</button></div>
      </div>`;
    const h = root.querySelector('h2');
    if (h && h.parentNode === root) h.insertAdjacentElement('afterend', box); else root.insertBefore(box, root.firstChild);
    const sel = box.querySelector('select');
    sel.addEventListener('change', () => profilWechseln(sel.value));
    box.querySelectorAll('.mp-pf').forEach((pf) => pf.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = sel.options.length;
      if (n < 2) return;
      sel.selectedIndex = ((sel.selectedIndex + +pf.dataset.d) % n + n) % n;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    box.querySelector('[data-pr="neu"]').onclick = profilNeu;
    box.querySelector('[data-pr="um"]').onclick = profilUmbenennen;
    box.querySelector('[data-pr="weg"]').onclick = profilLoeschen;
    profilZeichnen();
  })();
  // Die neuen Zeilen haben eine Erklaerung im <small>: in den Info-Knopf damit (wie alle anderen,
  // 98c-opt-info.js laeuft schon vorher und ist wiederholbar).
  if (typeof optInfoEinrichten === 'function') optInfoEinrichten();
