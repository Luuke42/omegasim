  // ============================== ZWEI LAPTOPS (WIP) ==============================
  //
  // v1.5 BESTELLT (Plan Paket 7): "Zwei-Laptop-Modus: in der Garage neben Autos und Kamera 'Zweiter Laptop'
  // verbinden (WebRTC-Relais, Kopplungscode)." Nach Hybrid-Dash von Mo Kamit (MIT-Lizenz), Datei 98j-hd-relay.js.
  //
  // Ein Laptop schafft nur so viele Bluetooth-Verbindungen. Der Modus teilt sie:
  //   HOST (Laptop A)    faehrt das Rennen wie immer: Rennleitung, Zeiten, NPCs, eigenes Auto.
  //   HELFER (Laptop B)  verbindet die uebrigen Autos ueber SEIN Bluetooth und reicht nur die Pakete
  //                      ueber das WLAN hin und her. Er faehrt und misst nichts.
  //
  // Der Host sieht ein Helfer-Auto wie ein Bluetooth-Geraet: ein Stellvertreter mit derselben Oberflaeche wie
  // Web Bluetooth (gatt.connect, getPrimaryService, getCharacteristic, writeValueWithoutResponse,
  // characteristicvaluechanged, gattserverdisconnected) geht an garageGeraetAufnehmen(), wie die App-Bruecke
  // (05-app-bruecke.js). Rolle, Farbe, NPC-Fahren und Zeiten laufen wie bei jedem Auto.
  //
  // DIE VERBINDUNG ist ein WebRTC-Datenkanal von Laptop zu Laptop im selben WLAN, ohne Server und ohne
  // STUN/TURN: nichts verlaesst das Netz. Gekoppelt wird einmalig mit zwei Codes (Host-Code zum Helfer,
  // Antwort-Code zum Host). Mokamits Schnellkopplung ueber einen Supabase-Kanal fehlt (sie braucht einen
  // eigenen Server, siehe FRAGEN_OFFEN). Zwei Kanaele, beide geordnet und verlaesslich: ein verlorenes
  // "Stopp" darf nie ein Auto fahren lassen. Der Helfer haelt je Auto nur das neueste Paket.
  //
  // SICHERHEIT: Der Host pingt alle 400 ms. Hoert der Helfer ZL_STILL_MS nichts oder bricht die Verbindung,
  // schickt er jedem Auto ein Stopp-Paket (kein Gas, keine Lenkung), bis die Verbindung wieder steht.
  //
  // LATENZ: Jeder Befehl an ein Helfer-Auto laeuft zusaetzlich ueber das WLAN. Deshalb WIP und nur fuer Autos,
  // die sonst gar nicht verbunden werden koennten (am besten NPCs).

  const ZL_STILL_MS = 1200;
  const ZL_PING_MS = 400;
  const ZL_ID = 'helfer-';               // Vorsilbe der Kennung eines Helfer-Autos auf dem Host

  // var: renderGarage (90-ghosts.js) zeichnet die Garage-Zeile schon beim Laden, vor dieser Zuweisung.
  var zl = {
    rolle: null,          // null | 'host' | 'helfer'
    pc: null, ctl: null, io: null,
    offen: false,
    zuletztGehoert: 0,
    status: '',
    fremd: new Map(),     // Host: Schluessel -> Stellvertreter
    eigen: new Map(),     // Helfer: Schluessel -> { dev, rx, tx, name, id, pending, schreibt, n, verbunden }
    naechsterKey: 1,
    pingUhr: null, wachUhr: null, warStill: false,
    gesendet: 0, empfangen: 0,
  };

  // ---- Kopplungscodes: SDP, komprimiert und base64url ----
  async function zlCodeAus(art, beschreibung) {
    const roh = new TextEncoder().encode(JSON.stringify({ t: beschreibung.type, s: beschreibung.sdp }));
    let bytes = roh;
    const z = typeof CompressionStream === 'function';
    if (z) {
      const s = new Blob([roh]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(s).arrayBuffer());
    }
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = btoa(bin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
    return 'OS' + art + (z ? 'z' : 'r') + '.' + b64;
  }
  async function zlCodeEin(code, art) {
    const s = String(code || '').trim().replace(/[ \t\r\n]+/g, '');
    const m = /^OS([AB])([zr])[.]([A-Za-z0-9_-]+)$/.exec(s);
    if (!m) throw new Error(t('Das ist kein OmegaSim-Kopplungscode.'));
    if (m[1] !== art) throw new Error(art === 'A' ? t('Das ist ein Antwort-Code des Helfers: auf dem HOST einfügen.') : t('Das ist ein Host-Code: auf dem HELFER einfügen.'));
    const b64 = m[3].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (m[2] === 'z') {
      const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(st).arrayBuffer());
    }
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return { type: o.t, sdp: o.s };
  }
  function zlIceFertig(pc) {
    return new Promise((fertig) => {
      if (pc.iceGatheringState === 'complete') return fertig();
      const uhr = setTimeout(fertig, 3000);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(uhr); fertig(); } });
    });
  }

  // ---- Verbindung ----
  function zlNeu() {
    zlSchliessen(true);
    const pc = new RTCPeerConnection({ iceServers: [] });
    zl.pc = pc;
    pc.addEventListener('connectionstatechange', () => {
      if (pc !== zl.pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        zlZu(pc.connectionState === 'disconnected' ? t('Verbindung unterbrochen.') : t('Verbindung geschlossen.'));
      }
    });
    return pc;
  }
  function zlKanal(kanal) {
    kanal.binaryType = 'arraybuffer';
    if (kanal.label === 'os-ctl') zl.ctl = kanal; else zl.io = kanal;
    kanal.addEventListener('open', zlOffenPruefen);
    kanal.addEventListener('close', () => { if (zl.ctl === kanal || zl.io === kanal) zlZu(t('Verbindung geschlossen.')); });
    kanal.addEventListener('message', (e) => {
      zl.zuletztGehoert = performance.now();
      if (kanal.label === 'os-ctl') zlCtlEmpfangen(JSON.parse(e.data));
      else zlIoEmpfangen(new Uint8Array(e.data));
    });
  }
  function zlOffenPruefen() {
    if (!zl.ctl || !zl.io || zl.ctl.readyState !== 'open' || zl.io.readyState !== 'open' || zl.offen) return;
    zl.offen = true;
    zl.zuletztGehoert = performance.now();
    zlStatus(zl.rolle === 'host' ? t('Mit dem Helfer-Laptop verbunden.') : t('Mit dem Host-Laptop verbunden.'));
    log('Zwei Laptops: Verbindung offen (' + zl.rolle + ').', 'info');
    zlCtl({ t: 'hallo', v: 1 });
    if (zl.rolle === 'host') {
      clearInterval(zl.pingUhr);
      zl.pingUhr = setInterval(() => zlCtl({ t: 'ping' }), ZL_PING_MS);
    } else {
      zl.eigen.forEach((e, k) => { if (e.verbunden) zlCtl({ t: 'auto', k, id: e.id, name: e.name }); });
    }
    zlMalen();
  }
  function zlZu(grund) {
    const war = zl.offen;
    zl.offen = false;
    clearInterval(zl.pingUhr); zl.pingUhr = null;
    if (zl.rolle === 'helfer') zlAlleAnhalten();
    if (zl.rolle === 'host') zl.fremd.forEach((d) => d._weg());
    if (war) { zlStatus(grund + ' ' + t('Zum Weiterfahren neu koppeln.')); log('Zwei Laptops: ' + grund, 'err'); }
    zlMalen();
  }
  function zlSchliessen(still) {
    const pc = zl.pc;
    zl.pc = null;
    try { if (zl.ctl) zl.ctl.close(); } catch (e) { /* zu */ }
    try { if (zl.io) zl.io.close(); } catch (e) { /* zu */ }
    zl.ctl = null; zl.io = null;
    try { if (pc) pc.close(); } catch (e) { /* zu */ }
    if (!still) zlZu(t('Verbindung geschlossen.'));
  }
  function zlCtl(o) { if (zl.ctl && zl.ctl.readyState === 'open') zl.ctl.send(JSON.stringify(o)); }
  function zlIo(typ, k, daten) {
    const io = zl.io;
    if (!io || io.readyState !== 'open') return false;
    const quelle = daten instanceof ArrayBuffer ? new Uint8Array(daten) : new Uint8Array(daten.buffer, daten.byteOffset || 0, daten.byteLength);
    const p = new Uint8Array(quelle.length + 2);
    p[0] = typ; p[1] = k; p.set(quelle, 2);
    io.send(p.buffer);
    zl.gesendet++;
    return true;
  }
  // HOST Schritt 1: Code fuer den Helfer.
  async function zlHostStart() {
    zl.rolle = 'host';
    const pc = zlNeu();
    zlKanal(pc.createDataChannel('os-ctl', { ordered: true }));
    zlKanal(pc.createDataChannel('os-io', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await zlIceFertig(pc);
    zlStatus(t('Diesen Code auf dem Helfer-Laptop einfügen, dann dessen Antwort hier unten.'));
    return zlCodeAus('A', pc.localDescription);
  }
  // HOST Schritt 2: Antwort des Helfers.
  async function zlHostAntwort(code) {
    if (!zl.pc || zl.rolle !== 'host') throw new Error(t('Erst einen Host-Code erzeugen.'));
    await zl.pc.setRemoteDescription(await zlCodeEin(code, 'B'));
    zlStatus(t('Verbinde …'));
  }
  // HELFER: Host-Code nehmen, Antwort erzeugen.
  async function zlHelferStart(code) {
    zl.rolle = 'helfer';
    const angebot = await zlCodeEin(code, 'A');
    const pc = zlNeu();
    pc.addEventListener('datachannel', (e) => zlKanal(e.channel));
    await pc.setRemoteDescription(angebot);
    await pc.setLocalDescription(await pc.createAnswer());
    await zlIceFertig(pc);
    zlStatus(t('Diesen Antwort-Code auf dem Host-Laptop einfügen.'));
    zlWachhund();
    return zlCodeAus('B', pc.localDescription);
  }
  function zlCtlEmpfangen(m) {
    if (!m || typeof m !== 'object') return;
    if (zl.rolle === 'host') {
      if (m.t === 'auto') zlFremdesAuto(m.k, m.id, m.name);
      else if (m.t === 'weg') { const d = zl.fremd.get(m.k); if (d) d._weg(); }
    } else if (zl.rolle === 'helfer' && m.t === 'trennen') zlAnhalten(m.k);
    zlMalen();
  }
  function zlIoEmpfangen(p) {
    if (p.length < 2) return;
    zl.empfangen++;
    const typ = p[0], k = p[1], daten = p.subarray(2);
    if (typ === 1 && zl.rolle === 'helfer') zlHelferSchreiben(k, daten.slice());
    else if (typ === 2 && zl.rolle === 'host') { const d = zl.fremd.get(k); if (d) d._meldung(daten.slice()); }
  }

  // ---- HOST: der Stellvertreter ----
  class ZlMerkmal extends EventTarget {
    constructor(dev, schreibbar) {
      super();
      this.device = dev; this.value = null; this.uuid = schreibbar ? NUS_RX : NUS_TX;
      this.properties = schreibbar ? { writeWithoutResponse: true, write: false, notify: false } : { writeWithoutResponse: false, write: false, notify: true };
    }
    writeValueWithoutResponse(daten) {
      if (!this.device.gatt.connected) return Promise.reject(new Error('Helfer-Auto nicht verbunden'));
      if (!zlIo(1, this.device._k, daten)) return Promise.reject(new Error('Verbindung zum Helfer-Laptop steht nicht'));
      return Promise.resolve();
    }
    writeValueWithResponse(daten) { return this.writeValueWithoutResponse(daten); }
    writeValue(daten) { return this.writeValueWithoutResponse(daten); }
    startNotifications() { return Promise.resolve(this); }
    stopNotifications() { return Promise.resolve(this); }
  }
  class ZlGeraet extends EventTarget {
    constructor(k, id, name) {
      super();
      this._k = k;
      this.id = ZL_ID + id;
      this.name = name || ('HYBRID-Helfer-' + k);
      this._rx = new ZlMerkmal(this, true);
      this._tx = new ZlMerkmal(this, false);
      this._da = true;
      const dev = this;
      const dienst = {
        uuid: NUS_SERVICE, device: dev,
        getCharacteristic: async (u) => {
          const s = String(u).toLowerCase();
          if (s === dev._rx.uuid) return dev._rx;
          if (s === dev._tx.uuid) return dev._tx;
          throw new Error('Characteristic not found');
        },
        getCharacteristics: async () => [dev._rx, dev._tx],
      };
      this.gatt = {
        device: dev, connected: false,
        connect: async () => {
          if (!zl.offen || !dev._da) throw new Error('Helfer-Auto nicht erreichbar');
          dev.gatt.connected = true;
          return dev.gatt;
        },
        disconnect: () => {
          const war = dev.gatt.connected;
          dev.gatt.connected = false;
          zlCtl({ t: 'trennen', k: dev._k });
          if (war) setTimeout(() => dev.dispatchEvent(new Event('gattserverdisconnected')), 0);
        },
        getPrimaryService: async (u) => { if (String(u).toLowerCase() !== NUS_SERVICE) throw new Error('Service not found'); return dienst; },
        getPrimaryServices: async () => [dienst],
      };
    }
    _meldung(bytes) {
      if (!this.gatt.connected) return;
      this._tx.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this._tx.dispatchEvent(new Event('characteristicvaluechanged'));
    }
    _weg() {
      this._da = false;
      if (this.gatt.connected) { this.gatt.connected = false; this.dispatchEvent(new Event('gattserverdisconnected')); }
    }
    watchAdvertisements() { return Promise.resolve(); }
  }
  function zlFremdesAuto(k, id, name) {
    k = Number(k) & 0xff;
    let dev = zl.fremd.get(k);
    if (dev && dev.id !== ZL_ID + id) dev = null;
    if (!dev) { dev = new ZlGeraet(k, id, name); zl.fremd.set(k, dev); }
    dev._da = true;
    const imGarage = garage.find((c) => c.device === dev);
    if (imGarage) {
      if (!dev.gatt.connected && !imGarage.reconnectLaeuft) {
        verbindeGattSicher(imGarage).then(() => { imGarage.reconnectVersuche = 0; log(garageLabel(imGarage) + ': wieder da über den Helfer-Laptop.', 'info'); }).catch(() => {});
      }
      return Promise.resolve();
    }
    return garageGeraetAufnehmen(dev).then(() => { zlMalen(); showHudToast(t('Auto über den Helfer-Laptop: {n}').replace('{n}', dev.name)); });
  }

  // ---- HELFER: echte Autos am eigenen Bluetooth ----
  async function zlHelferAutoVerbinden() {
    if (!navigator.bluetooth) throw new Error(t('Dieser Browser hat kein Web Bluetooth. Chrome oder Edge verwenden.'));
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'HYBRID' }, { services: [NUS_SERVICE] }], optionalServices: [NUS_SERVICE] });
    return zlHelferGeraet(dev);
  }
  async function zlHelferGeraet(dev) {
    for (const [k, e] of zl.eigen) if (e.id === String(dev.id)) return k;
    const k = zl.naechsterKey++ & 0xff;
    const e = { dev, id: String(dev.id), name: dev.name || 'HYBRID', rx: null, tx: null, pending: null, schreibt: false, n: 0, verbunden: false };
    zl.eigen.set(k, e);
    await zlHelferGatt(k, e);
    dev.addEventListener('gattserverdisconnected', () => {
      if (!zl.eigen.has(k)) return;
      e.verbunden = false;
      zlCtl({ t: 'weg', k });
      zlMalen();
      let versuch = 0;
      const nochmal = () => {
        if (!zl.eigen.has(k) || e.verbunden || ++versuch > 5) return;
        setTimeout(() => zlHelferGatt(k, e).catch(nochmal), 1000 * versuch);
      };
      nochmal();
    });
    return k;
  }
  async function zlHelferGatt(k, e) {
    const srv = await e.dev.gatt.connect();
    const nus = await srv.getPrimaryService(NUS_SERVICE);
    e.rx = await nus.getCharacteristic(NUS_RX);
    e.tx = await nus.getCharacteristic(NUS_TX);
    await e.tx.startNotifications();
    if (!e.horcht) e.horcht = (ev) => { e.n++; zlIo(2, k, ev.target.value); };
    e.tx.removeEventListener('characteristicvaluechanged', e.horcht);
    e.tx.addEventListener('characteristicvaluechanged', e.horcht);
    e.verbunden = true;
    zlCtl({ t: 'auto', k, id: e.id, name: e.name });
    log('Helfer: ' + e.name + ' verbunden.', 'info');
    zlMalen();
  }
  // Das Neueste gewinnt: solange ein Schreiben laeuft, wartet nur das juengste Paket.
  function zlHelferSchreiben(k, bytes) {
    const e = zl.eigen.get(k);
    if (!e || !e.rx || !e.verbunden) return;
    if (e.schreibt) { e.pending = bytes; return; }
    e.schreibt = true;
    (async () => {
      let auf = bytes;
      while (auf) {
        try {
          if (e.rx.properties && e.rx.properties.writeWithoutResponse === false && e.rx.writeValueWithResponse) await e.rx.writeValueWithResponse(auf);
          else await e.rx.writeValueWithoutResponse(auf);
        } catch (err) { /* das naechste Paket kommt in ~45 ms */ }
        auf = e.pending; e.pending = null;
      }
      e.schreibt = false;
    })();
  }
  function zlStoppPaket() { return buildCommandPacket(0, 0, TRACK_BIT_ON); }
  function zlAnhalten(k) { zlHelferSchreiben(k, zlStoppPaket()); }
  function zlAlleAnhalten() { zl.eigen.forEach((e, k) => zlAnhalten(k)); }
  function zlHelferTrennen(k) {
    const e = zl.eigen.get(k);
    if (!e) return;
    zlAnhalten(k);
    zl.eigen.delete(k);
    zlCtl({ t: 'weg', k });
    setTimeout(() => { try { e.dev.gatt.disconnect(); } catch (err) { /* weg */ } }, 150);
    zlMalen();
  }
  function zlWachhundSchritt() {
    if (zl.rolle !== 'helfer' || !zl.eigen.size) return;
    const still = !zl.offen || performance.now() - zl.zuletztGehoert > ZL_STILL_MS;
    if (still) zlAlleAnhalten();
    if (still !== zl.warStill) { zl.warStill = still; zlMalen(); }
  }
  function zlWachhund() { clearInterval(zl.wachUhr); zl.wachUhr = setInterval(zlWachhundSchritt, 300); }

  // ---- Fenster ----
  const zlStil = document.createElement('style');
  zlStil.textContent = `
    .zl-fenster .k-pause-dialog { width: min(760px, 96vw); max-height: 94vh; overflow-y: auto; box-sizing: border-box; }
    .zl-fenster .k-pause-dialog p.zl-p { display: block; margin: 0 0 6px; font-size: 13px; }
    .zl-fenster h2 .wip-tag, .gar-a-zl .wip-tag { margin-left: 6px; font-size: 9px; vertical-align: 1px; }
    .zl-fenster textarea { width: 100%; box-sizing: border-box; font: 11px/1.3 monospace; min-height: 4.5em; }
    .zl-fenster .zl-knoepfe { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
    .zl-fenster .k-pause-dialog .opt-row.zl-row { padding: 0; border: 0; min-height: 0; background: none; box-shadow: none; display: block; }
    .zl-fenster .opt-row.menu-nav-sel { outline: 2px solid #fff; outline-offset: 2px; }
    .zl-lampe { display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em; color: #0b0c10; }
    .zl-lampe.gruen { background: #3ddc84; } .zl-lampe.gelb { background: #ffb02e; } .zl-lampe.rot { background: #ff5c5c; }
    .zl-fenster ul.zl-autos { margin: 4px 0; padding-left: 1.2em; font-size: 13px; }
    .zl-fenster [data-zeige] { display: none; }
    .zl-fenster[data-zeige="host"] [data-zeige="host"], .zl-fenster[data-zeige="helfer"] [data-zeige="helfer"], .zl-fenster[data-zeige=""] [data-zeige="wahl"] { display: block; }
    body.zl-helfer-seite > *:not(.zl-fenster):not(#hud-toast) { visibility: hidden; }
  `;
  document.head.appendChild(zlStil);
  const zlFenster = document.createElement('div');
  zlFenster.className = 'k-pause zl-fenster';
  zlFenster.id = 'zl-fenster';
  zlFenster.hidden = true;
  zlFenster.dataset.zeige = '';
  zlFenster.setAttribute('role', 'dialog');
  zlFenster.setAttribute('aria-modal', 'true');
  const zlR = (x) => '<div class="opt-row zl-row">' + x + '</div>';
  zlFenster.innerHTML = '<div class="k-pause-dialog" id="zl-dialog">'
    + '<h2>Zweiter Laptop <span class="wip-tag">WIP</span> <span class="zl-lampe rot" id="zl-lampe" data-i18n-skip>–</span></h2>'
    + '<p class="zl-p muted">Ein Laptop schafft nur so viele Bluetooth-Verbindungen. Ein zweiter Laptop im selben WLAN verbindet weitere Autos und reicht ihre Pakete weiter; gefahren und gewertet wird auf diesem Laptop (Host). Jedes Helfer-Auto hat etwas mehr Verzögerung, am besten als NPC.</p>'
    + '<p class="zl-p" id="zl-status" data-i18n-skip></p>'
    + '<div data-zeige="wahl"><div class="zl-knoepfe">' + zlR('<button type="button" class="primary" id="zl-wahl-host">Dieser Laptop ist der Host</button>')
    + zlR('<button type="button" id="zl-wahl-helfer">Dieser Laptop ist der Helfer</button>') + '</div></div>'
    + '<div data-zeige="host"><p class="zl-p">1. Code erzeugen und auf dem Helfer einfügen.</p><div class="zl-knoepfe">' + zlR('<button type="button" id="zl-host-code">Host-Code erzeugen</button>')
    + zlR('<button type="button" id="zl-host-kopieren">Kopieren</button>') + '</div><textarea id="zl-host-code-text" readonly data-i18n-skip data-preset-skip></textarea>'
    + '<p class="zl-p">2. Antwort-Code des Helfers hier einfügen.</p><textarea id="zl-host-antwort" data-i18n-skip data-preset-skip></textarea><div class="zl-knoepfe">' + zlR('<button type="button" class="primary" id="zl-host-verbinden">Verbinden</button>') + '</div>'
    + '<ul class="zl-autos" id="zl-autos-host" data-i18n-skip></ul></div>'
    + '<div data-zeige="helfer"><p class="zl-p">1. Host-Code hier einfügen, dann den Antwort-Code zum Host bringen.</p><textarea id="zl-helfer-angebot" data-i18n-skip data-preset-skip></textarea>'
    + '<div class="zl-knoepfe">' + zlR('<button type="button" class="primary" id="zl-helfer-antwort">Antwort-Code erzeugen</button>') + zlR('<button type="button" id="zl-helfer-kopieren">Kopieren</button>') + '</div>'
    + '<textarea id="zl-helfer-code-text" readonly data-i18n-skip data-preset-skip></textarea>'
    + '<p class="zl-p">2. Die Autos verbinden, die dieser Laptop tragen soll.</p><div class="zl-knoepfe">' + zlR('<button type="button" id="zl-helfer-auto">+ Auto verbinden</button>')
    + zlR('<button type="button" id="zl-helfer-seite">Als eigene Helfer-Seite öffnen</button>') + '</div><ul class="zl-autos" id="zl-autos-helfer" data-i18n-skip></ul></div>'
    + '<p class="zl-p muted" id="zl-zahlen" data-i18n-skip></p>'
    + '<div class="zl-knoepfe">' + zlR('<button type="button" id="zl-trennen">Verbindung trennen</button>') + zlR('<button type="button" id="zl-zu">Schließen</button>') + '</div></div>';
  document.body.appendChild(zlFenster);
  // Ausserhalb von header/main (i18nRoots): die festen Texte selbst uebersetzen, jetzt und bei jedem Sprachwechsel.
  if (typeof i18nApply === 'function') i18nApply(zlFenster);
  zlFenster.addEventListener('click', (e) => { if (e.target === zlFenster && !zlHelferSeite) zlFensterSchliessen(); });
  let zlHelferSeite = false;

  function zlFensterOffen() { const f = document.getElementById('zl-fenster'); return !!(f && !f.hidden); }
  function zlOeffnen(rolle) {
    zlFenster.hidden = false;
    if (rolle) zlFenster.dataset.zeige = rolle;
    else zlFenster.dataset.zeige = zl.rolle || zlFenster.dataset.zeige || '';
    zlMalen();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavIndex = 0; menuNavGezeigt = true; menuNavArmed = false; menuNavRender(); }
    return true;
  }
  // Schliessen beendet die Verbindung nicht; das tut nur "Verbindung trennen".
  function zlFensterSchliessen() {
    if (zlFenster.hidden || zlHelferSeite) return false;
    zlFenster.hidden = true;
    if (typeof renderGarage === 'function') renderGarage();
    if (typeof menuNavEnsureContext === 'function') { menuNavEnsureContext(); menuNavRender(); }
    return true;
  }
  function zlStatus(s) { zl.status = s; const el = $('zl-status'); if (el) el.textContent = s; }
  function zlEsc(x) { return String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function zlMalen() {
    if (typeof konsoleFahrenGeraete === 'function') konsoleFahrenGeraete();
    const lampe = $('zl-lampe');
    if (lampe) {
      lampe.className = 'zl-lampe ' + (zl.offen ? (zl.warStill ? 'gelb' : 'gruen') : 'rot');
      lampe.textContent = zl.offen ? t('VERBUNDEN') : t('NICHT VERBUNDEN');
    }
    const hl = $('zl-autos-helfer');
    if (hl) {
      hl.innerHTML = zl.eigen.size ? [...zl.eigen].map(([k, e]) => '<li><b>' + zlEsc(e.name) + '</b> <span class="muted">' + zlEsc(e.verbunden ? t('verbunden') : t('verbinde neu …'))
        + '</span> <button type="button" data-zl-trennen="' + k + '">' + zlEsc(t('Trennen')) + '</button></li>').join('')
        : '<li class="muted">' + zlEsc(t('Noch keine Autos.')) + '</li>';
      hl.querySelectorAll('[data-zl-trennen]').forEach((b) => { b.onclick = () => zlHelferTrennen(Number(b.dataset.zlTrennen)); });
    }
    const ho = $('zl-autos-host');
    if (ho) {
      ho.innerHTML = zl.fremd.size ? [...zl.fremd.values()].map((d) => {
        const car = garage.find((c) => c.device === d);
        return '<li><b>' + zlEsc(car ? garageLabel(car) : d.name) + '</b> <span class="muted">' + zlEsc(d.gatt.connected ? t('in der Garage') : d._da ? t('aus der Garage genommen') : t('getrennt')) + '</span></li>';
      }).join('') : '<li class="muted">' + zlEsc(t('Autos des Helfers erscheinen hier und in der Garage.')) + '</li>';
    }
    const z = $('zl-zahlen');
    if (z) z.textContent = zl.offen ? t('{s} gesendet · {e} empfangen').replace('{s}', zl.gesendet).replace('{e}', zl.empfangen) : '';
    const knopf = document.querySelector('#gar-list [data-act="zweiter-laptop"]');
    if (knopf) knopf.firstChild.textContent = zlKnopfText();
  }
  function zlKnopfText() {
    if (!zl || !zl.offen) return t('Zweiter Laptop');
    if (zl.rolle === 'host') return t('Zweiter Laptop · {n} Autos').replace('{n}', [...zl.fremd.values()].filter((d) => d.gatt.connected).length);
    return t('Zweiter Laptop · Helfer');
  }
  // Die Zeile in der Garage, links unter dem Showroom (renderGarage, 90-ghosts.js).
  function zlGarageZeile() {
    const z = document.createElement('div');
    z.className = 'opt-row opt-breit gar-a-aktion gar-a-zl';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'zweiter-laptop';
    b.appendChild(document.createTextNode(zlKnopfText()));
    const w = document.createElement('span');
    w.className = 'wip-tag';
    w.textContent = 'WIP';
    b.appendChild(w);
    if (zl && zl.offen) b.classList.add('primary');
    b.onclick = (e) => { e.stopPropagation(); zlOeffnen(); };
    z.appendChild(b);
    return z;
  }
  async function zlKopieren(id, knopf) {
    const el = $(id);
    if (!el) return;
    try { await navigator.clipboard.writeText(el.value); } catch (e) { el.select(); try { document.execCommand('copy'); } catch (e2) { /* von Hand */ } }
    if (knopf) { const alt = knopf.textContent; knopf.textContent = t('Kopiert'); setTimeout(() => { knopf.textContent = alt; }, 1200); }
  }
  (function zlAnbinden() {
    const an = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); };
    const fehler = (e) => zlStatus('⚠ ' + ((e && e.message) || e));
    an('zl-zu', zlFensterSchliessen);
    an('zl-wahl-host', () => { zlFenster.dataset.zeige = 'host'; zlMalen(); });
    an('zl-wahl-helfer', () => { zlFenster.dataset.zeige = 'helfer'; zlMalen(); });
    an('zl-host-code', async () => { try { $('zl-host-code-text').value = t('Erzeuge …'); $('zl-host-code-text').value = await zlHostStart(); } catch (e) { fehler(e); } });
    an('zl-host-kopieren', (ev) => zlKopieren('zl-host-code-text', ev.currentTarget));
    an('zl-host-verbinden', async () => { try { await zlHostAntwort($('zl-host-antwort').value); } catch (e) { fehler(e); } });
    an('zl-helfer-antwort', async () => {
      try { $('zl-helfer-code-text').value = t('Erzeuge …'); $('zl-helfer-code-text').value = await zlHelferStart($('zl-helfer-angebot').value); }
      catch (e) { $('zl-helfer-code-text').value = ''; fehler(e); }
    });
    an('zl-helfer-kopieren', (ev) => zlKopieren('zl-helfer-code-text', ev.currentTarget));
    an('zl-helfer-auto', async () => { try { await zlHelferAutoVerbinden(); } catch (e) { if (!(e && e.name === 'NotFoundError')) fehler(e); } });
    an('zl-trennen', () => { zlSchliessen(false); zlStatus(t('Verbindung geschlossen.')); });
    an('zl-helfer-seite', () => { window.open(location.pathname + '?helfer', '_blank', 'noopener'); });
    // ?helfer in der Adresse: die eigene Helfer-Seite. Das Fenster fuellt den Schirm und laesst sich nicht
    // schliessen, damit es mitten im Rennen nicht aus Versehen zugeht.
    try { zlHelferSeite = new URLSearchParams(location.search).has('helfer'); } catch (e) { zlHelferSeite = false; }
    if (zlHelferSeite) { document.body.classList.add('zl-helfer-seite'); document.title = 'OmegaSim Helfer'; zlOeffnen('helfer'); }
    // Waehrend der Kopplung fragt das Schliessen des Tabs erst nach (es wuerde die Autos des Helfers anhalten).
    window.addEventListener('beforeunload', (e) => {
      if (!zl.offen && !(zl.rolle === 'helfer' && zl.eigen.size)) return;
      e.preventDefault(); e.returnValue = '';
    });
    setInterval(() => { if (zlFensterOffen()) zlMalen(); }, 1000);
  })();
  i18nOnLangChange(() => { if (typeof i18nApply === 'function') i18nApply(zlFenster); if (zlFensterOffen()) zlMalen(); });

  // ---- Selbsttest: ohne zweiten Laptop, mit einer Attrappe der Datenkanaele ----
  stAdd('Zwei Laptops v1.5: Code hin und zurueck, Helfer-Auto in der Garage, Pakete ueber den Kanal, Stopp bei Stille', async () => {
    const f = [];
    const merk = { rolle: zl.rolle, offen: zl.offen, ctl: zl.ctl, io: zl.io, zuletzt: zl.zuletztGehoert, ping: zl.pingUhr };
    const gesendetIo = [], gesendetCtl = [];
    const kanal = (liste, label) => ({ label, readyState: 'open', send: (x) => liste.push(x), close() {} });
    let dev = null;
    try {
      // Codes.
      const code = await zlCodeAus('A', { type: 'offer', sdp: 'v=0 probe' });
      const zurueck = await zlCodeEin(code, 'A');
      if (zurueck.type !== 'offer' || zurueck.sdp !== 'v=0 probe') f.push('Code hin und zurueck');
      let falsch = false;
      try { await zlCodeEin(code, 'B'); } catch (e) { falsch = true; }
      if (!falsch) f.push('Host-Code auf dem Host angenommen');
      // Host mit Attrappen-Kanaelen.
      zl.rolle = 'host'; zl.offen = true; zl.ctl = kanal(gesendetCtl, 'os-ctl'); zl.io = kanal(gesendetIo, 'os-io');
      await zlFremdesAuto(250, 'probe', 'HYBRID-Probe');
      dev = zl.fremd.get(250);
      const car = garage.find((c) => c.device === dev);
      if (!car) f.push('Helfer-Auto nicht in der Garage');
      else {
        writeToCar(car, 0.3, 0.5, TRACK_BIT_ON);
        await new Promise((r) => setTimeout(r, 120));
        const p = gesendetIo.map((b) => new Uint8Array(b)).find((b) => b[0] === 1 && b[1] === 250);
        if (!p) f.push('kein Befehl ueber den Kanal');
        // Meldung vom Helfer kommt beim Auto an.
        let gehoert = 0;
        const horch = () => { gehoert++; };
        dev._tx.addEventListener('characteristicvaluechanged', horch);
        zlIoEmpfangen(Uint8Array.from([2, 250, 1, 2, 3]));
        dev._tx.removeEventListener('characteristicvaluechanged', horch);
        if (!gehoert) f.push('Meldung kommt nicht an');
        // Verbindung weg: das Auto meldet die Trennung.
        dev._weg();
        if (dev.gatt.connected) f.push('nach Verbindungsabbruch noch verbunden');
      }
      // Helfer: Stille -> Stopp-Paket an jedes Auto.
      const geschrieben = [];
      zl.rolle = 'helfer'; zl.offen = true; zl.zuletztGehoert = performance.now() - ZL_STILL_MS - 100;
      zl.eigen.set(251, { id: 'probe-h', name: 'Probe H', verbunden: true, pending: null, schreibt: false, n: 0,
                          rx: { properties: { writeWithoutResponse: true }, writeValueWithoutResponse: async (b) => { geschrieben.push(Array.from(b)); } } });
      zlWachhundSchritt();
      await new Promise((r) => setTimeout(r, 30));
      const stopp = Array.from(zlStoppPaket());
      if (!geschrieben.length || geschrieben[0].join() !== stopp.join()) f.push('kein Stopp-Paket bei Stille');
      zl.eigen.delete(251);
      // Garage-Zeile und Fenster.
      zl.rolle = null; zl.offen = false;
      renderGarage();
      const zeile = $('gar-list').querySelector('[data-act="zweiter-laptop"]');
      if (!zeile || !zeile.querySelector('.wip-tag')) f.push('Garage-Zeile fehlt');
      else {
        zeile.click();
        if (!zlFensterOffen()) f.push('Fenster oeffnet nicht');
        if (typeof konsoleZurueck === 'function' && (!konsoleZurueck() || zlFensterOffen())) f.push('Kreis schliesst nicht');
      }
    } catch (e) { f.push('Fehler: ' + e.message); }
    finally {
      zlFenster.hidden = true;
      if (dev) { const c = garage.find((x) => x.device === dev); if (c) { try { removeCar(c); } catch (e) { const i = garage.indexOf(c); if (i >= 0) garage.splice(i, 1); } } }
      zl.fremd.delete(250);
      zl.rolle = merk.rolle; zl.offen = merk.offen; zl.ctl = merk.ctl; zl.io = merk.io; zl.zuletztGehoert = merk.zuletzt;
      renderGarage();
    }
    return { ok: !f.length, mass: f.length ? f.join(' | ') : 'Code hin und zurueck, Helfer-Auto in der Garage, Befehl und Meldung ueber den Kanal, Stopp bei Stille, Zeile und Fenster' };
  });
