
  // ============================== ANDROID-APP ==============================
  //
  // Alles hier schlaeft im Browser: window.OMEGA_APP setzt nur 05-app-bruecke.js, und nur
  // in der App. Zwei Aufgaben:
  //
  // 1. SELBSTAKTUALISIERUNG (Plugin OmegaUpdate). BESTELLT: "Ich will, dass ich die App
  //    einfach updaten kann ohne die APK neu installieren zu muessen." Beim Start einmal
  //    fragen, einen Hinweis zeigen, auf Tipp laden. Die neue Fassung meldet sich mit
  //    bestaetigen() - tut sie das nicht, schaltet die App von selbst zurueck.
  //
  // 2. HOST OHNE PC (Plugin OmegaHost): dieses Telefon traegt die Rangliste, die anderen
  //    finden es per Suche im WLAN, ein Tablet oeffnet /?info im Browser.
  // ---- APK-LINK AUF DER TITELSEITE (v0.8.36) ----
  // Nur im Browser: in der App ist sie schon installiert. Nicht auf iPhone/iPad, dort laeuft
  // keine APK. Auf der luuke42-Kopie liegt die APK im eigenen Repo (apk/OmegaSim.apk).
  //
  // v0.8.127: die luuke42-Kopie hat ein eigenes Release (mit Download-Zaehler). Alle APK-Links
  // dort zeigen darauf, sobald es eines gibt - die GitHub-API sagt es (CORS erlaubt); bis dahin
  // und ohne Netz bleibt die Datei im Repo der Rueckfall.
  (function apkLinkZeigen() {
    const a = $('home-apk');
    if (!a || (window.OMEGA_APP && window.OMEGA_APP.nativ)) return;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
    if (/(^|\.)luuke42\.github\.io$/i.test(location.hostname)) {
      const info = $('app-apk-link');
      a.href = 'apk/OmegaSim.apk';
      if (info) info.href = 'apk/OmegaSim.apk';
      fetch('https://api.github.com/repos/Luuke42/omegasim/releases/latest', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || !(j.assets || []).some((x) => x.name === 'OmegaSim.apk')) return;
          a.href = 'https://github.com/Luuke42/omegasim/releases/latest/download/OmegaSim.apk';
          if (info) info.href = 'https://github.com/Luuke42/omegasim/releases/latest';
        })
        .catch(() => { /* Datei im Repo bleibt */ });
    }
    a.hidden = false;
  })();

  (function appAnbinden() {
    const APP = window.OMEGA_APP;
    if (!APP || !APP.nativ) return;
    const C = window.Capacitor;
    const upd = (m, o) => C.nativePromise('OmegaUpdate', m, o || {});
    const hst = (m, o) => C.nativePromise('OmegaHost', m, o || {});
    const APP_STORE = 'chc.app.v1';
    let einstellung = { auto: true };
    try { einstellung = Object.assign(einstellung, JSON.parse(localStorage.getItem(APP_STORE) || '{}')); } catch (e) { /* privat */ }
    const merken = () => { try { localStorage.setItem(APP_STORE, JSON.stringify(einstellung)); } catch (e) { /* privat */ } };

    ['info-app-kachel', 'mp-app'].forEach((id) => { if ($(id)) $(id).hidden = false; });

    // VOLLBILD NACHLEGEN (ab APK 0.8.26; aeltere kennen die Methode nicht, dann bleibt es beim
    // Versuch in MainActivity). BESTELLT: Uhrzeit, Akku, Home- und Tab-Knopf ausblenden.
    // Beim Start, beim Zurueckkommen, bei jedem Tabwechsel und hoechstens alle 3 s bei einer
    // Beruehrung - so verschwinden die Leisten auch wieder, wenn man sie hergewischt hat.
    const vollbild = () => { hst('vollbild').catch(() => { /* aeltere APK */ }); };
    let vollbildZuletzt = 0;
    vollbild();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) vollbild(); });
    window.addEventListener('focus', vollbild);
    document.addEventListener('pointerdown', () => {
      const j = Date.now();
      if (j - vollbildZuletzt > 3000) { vollbildZuletzt = j; vollbild(); }
    }, { passive: true, capture: true });
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', vollbild));
    if ($('mp-app-hinweis')) $('mp-app-hinweis').hidden = true;

    // Die laufende Fassung ist hochgekommen: das ist die Bestaetigung, auf die der Wachhund
    // wartet. So frueh wie moeglich und doch erst, wenn der ganze Code gelaufen ist - diese
    // Datei steht fast am Ende des Aufbaus.
    upd('bestaetigen').catch(() => { /* aeltere APK ohne Plugin */ });

    const webVersion = () => (($('app-version') && $('app-version').textContent) || '').trim();
    function neuer(a, b) {
      const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d > 0;
      }
      return false;
    }
    const mb = (b) => (b / 1e6).toFixed(b < 1e6 ? 2 : 1).replace('.', ',') + ' MB';
    const meldung = (text, schlecht) => {
      const el = $('app-stand-meldung');
      if (el) { el.textContent = text; el.style.color = schlecht ? 'var(--bad)' : ''; }
    };

    let angebot = null;
    function hinweis(r) {
      const box = $('app-update');
      if (!box) return;
      angebot = r;
      if (r.apkNoetig) {
        $('app-update-text').textContent = t('Neue APK nötig für Fassung') + ' ' + r.version;
        $('app-update-laden-text').textContent = t('APK holen');
      } else {
        $('app-update-text').textContent = t('Update verfügbar') + ': ' + r.version
          + ' (' + mb(r.bytes) + ')';
        $('app-update-laden-text').textContent = t('Jetzt laden');
      }
      // Einen uebrig gebliebenen Ladebalken aus einem abgebrochenen Download zuruecksetzen,
      // sonst zeigte der Knopf beim naechsten Anbieten einen alten Fuellstand.
      const bar = $('app-update-balken');
      if (bar) { bar.hidden = true; if (bar.firstElementChild) bar.firstElementChild.style.width = '0%'; }
      box.hidden = false;
    }

    async function pruefen(still) {
      try {
        const r = await upd('pruefen');
        if (!neuer(r.version, webVersion())) {
          if (!still) meldung(t('Aktuell.') + ' ' + webVersion());
          return null;
        }
        if (still && einstellung.verworfen === r.version) return null;   // startete nicht
        hinweis(r);
        meldung(t('Neu verfügbar:') + ' ' + r.version + ', ' + r.dateien + ' '
                + t('Dateien') + ', ' + mb(r.bytes));
        return r;
      } catch (e) {
        if (!still) meldung(String(e && e.message || e), true);
        return null;
      }
    }

    C.addListener('OmegaUpdate', 'fortschritt', (d) => {
      const bar = $('app-update-balken');
      if (!bar || !d || !d.gesamt) return;
      bar.hidden = false;
      bar.firstElementChild.style.width = Math.round(100 * d.fertig / d.gesamt) + '%';
    });

    if ($('app-update-laden')) {
      $('app-update-laden').addEventListener('click', async () => {
        if (!angebot) return;
        if (angebot.apkNoetig) { window.open($('app-apk-link').href, '_blank'); return; }
        const knopf = $('app-update-laden');
        knopf.disabled = true;
        $('app-update-text').textContent = t('Lade') + ' ' + angebot.version + ' …';
        try {
          await upd('laden');
          $('app-update-text').textContent = t('Fertig, starte neu …');
          // Die Seite laedt jetzt von selbst neu (setServerBasePath).
        } catch (e) {
          knopf.disabled = false;
          $('app-update-text').textContent = String(e && e.message || e);
        }
      });
    }
    // Abbrechen: laufenden Download stoppen (auch aeltere APK meldet dann einen Fehler, der
    // den Knopf freigibt) und die Box wieder einklappen.
    if ($('app-update-abbrechen')) {
      $('app-update-abbrechen').addEventListener('click', () => {
        upd('abbrechen').catch(() => { /* aeltere APK ohne Plugin */ });
        const box = $('app-update');
        if (box) box.hidden = true;
      });
    }

    async function standZeigen() {
      try {
        const s = await upd('stand');
        if ($('app-stand-web')) $('app-stand-web').textContent = webVersion()
          + (s.eingebaut ? ' (' + t('mitgeliefert') + ')' : ' (' + t('geladen') + ')');
        if ($('app-stand-apk')) $('app-stand-apk').textContent = s.apkVersion + ' · Stufe ' + s.apkStufe;
        if ($('app-stand-quelle')) $('app-stand-quelle').textContent = s.quelle;
        if (s.zurueckgerollt) {
          // Nicht noch einmal anbieten, bis eine NOCH neuere Fassung da ist.
          einstellung.verworfen = s.zurueckgerollt;
          merken();
          // v0.9.42: mit dem Fehler, den die START-DIAGNOSE (00-index.head.html) gemerkt hat.
          let grund = '';
          try {
            const sf = JSON.parse(localStorage.getItem('omegasim-startfehler') || 'null');
            if (sf && sf.v === s.zurueckgerollt && sf.f) grund = ' ' + sf.f.m + ' (' + sf.f.z + ':' + sf.f.s + ')';
          } catch (e) { /* ohne Speicher */ }
          meldung(t('Die Fassung') + ' ' + s.zurueckgerollt + ' ' + t('startete nicht und wurde verworfen.') + grund, true);
          showHudToast(t('Update verworfen'));
          upd('vergessen').catch(() => {});
        }
        if ($('app-eingebaut')) $('app-eingebaut').disabled = !!s.eingebaut;
      } catch (e) { /* Plugin fehlt: aeltere APK */ }
    }

    if ($('app-pruefen')) $('app-pruefen').addEventListener('click', () => pruefen(false));
    if ($('app-eingebaut')) {
      $('app-eingebaut').addEventListener('click', () => {
        upd('eingebaut').catch((e) => meldung(String(e && e.message || e), true));
      });
    }
    if ($('app-auto')) {
      $('app-auto').checked = einstellung.auto !== false;
      $('app-auto').addEventListener('change', (e) => { einstellung.auto = e.target.checked; merken(); });
    }
    standZeigen();
    if (einstellung.auto !== false) setTimeout(() => pruefen(true), 3000);

    // ---- Host ohne PC ------------------------------------------------------------------
    let hostLaeuft = false;
    function hostZeigen(r) {
      hostLaeuft = !!(r && r.laeuft);
      const ip = r && r.adressen && r.adressen[0];
      const url = ip ? 'http://' + ip + ':' + r.port : '';
      if ($('mp-app-host')) $('mp-app-host').textContent = t(hostLaeuft ? 'Host beenden' : 'Dieses Telefon ist Host');
      if ($('mp-app-adresse')) $('mp-app-adresse').textContent = hostLaeuft ? (url || t('keine WLAN-Adresse')) : '';
      if ($('mp-app-info')) {
        $('mp-app-info').textContent = hostLaeuft && url
          ? t('Info-Screen im Browser:') + ' ' + url + '/?info' : '';
      }
    }

    if ($('mp-app-host')) {
      $('mp-app-host').addEventListener('click', async () => {
        try {
          if (hostLaeuft) {
            hostZeigen(await hst('stop'));
            return;
          }
          const r = await hst('start', { port: 8080, name: 'OmegaSim ' + (mp.name || 'Host') });
          hostZeigen(r);
          // Das Host-Telefon faehrt selbst mit, ueber die eigene Schleife.
          if ($('mp-host')) $('mp-host').value = 'http://127.0.0.1:' + (r.port || 8080);
          mpJoin();
        } catch (e) {
          mpSay(String(e && e.message || e), true);
        }
      });
      hst('status').then(hostZeigen).catch(() => {});
    }

    if ($('mp-app-suchen')) {
      $('mp-app-suchen').addEventListener('click', async () => {
        const box = $('mp-gefunden');
        const knopf = $('mp-app-suchen');
        knopf.disabled = true;
        if (box) box.textContent = t('Suche …');
        try {
          const r = await hst('suchen', { ms: 3500 });
          const liste = (r && r.hosts) || [];
          if (box) {
            box.innerHTML = '';
            if (!liste.length) box.textContent = t('Kein Host gefunden. Gleiches WLAN? Manche Router trennen Geräte voneinander.');
            liste.forEach((h) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.textContent = h.name + ' · ' + h.adresse;
              b.addEventListener('click', () => {
                if ($('mp-host')) {
                  $('mp-host').value = 'http://' + h.adresse + ':' + h.port;
                  $('mp-host').dispatchEvent(new Event('input', { bubbles: true }));
                }
              });
              box.appendChild(b);
            });
          }
        } catch (e) {
          if (box) box.textContent = String(e && e.message || e);
        } finally {
          knopf.disabled = false;
        }
      });
    }
  })();

