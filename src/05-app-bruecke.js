
  // =========================================================================
  // ANDROID-APP: Web Bluetooth aus dem nativen Plugin nachgebaut
  // =========================================================================
  //
  // Laeuft NUR in der Android-App (Capacitor) und ist im Browser ein einziger Vergleich.
  // Der Android-WebView hat kein Web Bluetooth; die App bringt dafuer das Plugin
  // @capacitor-community/bluetooth-le mit. Dieser Abschnitt baut daraus genau das Stueck
  // navigator.bluetooth nach, das OmegaSim benutzt - requestDevice, gatt.connect,
  // getPrimaryService(s), getCharacteristic(s), writeValueWithoutResponse/WithResponse,
  // startNotifications, die Ereignisse characteristicvaluechanged und gattserverdisconnected.
  // Der ganze uebrige Code merkt nicht, dass er in einer App laeuft.
  //
  // WARUM IN index.html UND NICHT IN DER APK: so kommt jede Berichtigung hier mit der
  // naechsten Web-Aktualisierung aufs Telefon, ohne neue APK (BESTELLT: "App einfach updaten,
  // ohne die APK neu installieren zu muessen").
  //
  // EIGENE IIFE und VOR allem anderen: 10-ble-explorer.js und 90-ghosts.js fragen
  // navigator.bluetooth schon beim Laden ab.
(() => {
  'use strict';

  // Kurznamen, wie Web Bluetooth sie annimmt, auf volle 128-Bit-UUIDs. Das Plugin kennt nur
  // die volle, kleingeschriebene Form.
  const NAMEN = { battery_service: 0x180f, device_information: 0x180a,
                  generic_access: 0x1800, generic_attribute: 0x1801,
                  heart_rate: 0x180d, device_name: 0x2a00, appearance: 0x2a01 };
  function uuid(u) {
    if (typeof u === 'string' && NAMEN[u] !== undefined) u = NAMEN[u];
    if (typeof u === 'number') {
      return ('0000' + u.toString(16)).slice(-4).padStart(8, '0') + '-0000-1000-8000-00805f9b34fb';
    }
    const s = String(u).toLowerCase();
    if (/^[0-9a-f]{4}$/.test(s)) return '0000' + s + '-0000-1000-8000-00805f9b34fb';
    if (/^[0-9a-f]{8}$/.test(s)) return s + '-0000-1000-8000-00805f9b34fb';
    return s;
  }

  function zuHex(daten) {
    const b = daten instanceof ArrayBuffer ? new Uint8Array(daten)
      : new Uint8Array(daten.buffer, daten.byteOffset || 0, daten.byteLength);
    let s = '';
    for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  // Per Tabelle statt Regex und parseInt (v0.8.41): rund 22 Meldungen je Sekunde und Auto
  // laufen hier durch, auf einem schwachen Handy auf demselben Faden wie die Antworten.
  const HEX_WERT = new Int8Array(128).fill(-1);
  '0123456789abcdef'.split('').forEach((c, i) => { HEX_WERT[c.charCodeAt(0)] = i; HEX_WERT[c.toUpperCase().charCodeAt(0)] = i; });
  function ausHex(hex) {
    const s = String(hex || '');
    const b = new Uint8Array(s.length >> 1);
    let j = 0, hoch = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const v = c < 128 ? HEX_WERT[c] : -1;
      if (v < 0) continue;
      if (hoch < 0) hoch = v; else { b[j++] = (hoch << 4) | v; hoch = -1; }
    }
    return new DataView(b.buffer, 0, j);
  }

  // Die reinen Umrechnungen sind auch im Browser erreichbar - fuer den Selbsttest, der sie
  // ohne Telefon pruefen soll. Sie tun nichts, solange niemand sie ruft.
  window.OMEGA_BRUECKE = { uuid, zuHex, ausHex };

  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()
      || typeof C.nativePromise !== 'function') return;
  window.OMEGA_APP = { nativ: true, plattform: C.getPlatform ? C.getPlatform() : 'android' };
  if (navigator.bluetooth) return;   // sollte ein WebView es einmal koennen: dann das echte

  const PLUGIN = 'BluetoothLe';
  const ruf = (methode, optionen) => C.nativePromise(PLUGIN, methode, optionen || {});

  // Ist das OmegaBle-Plugin registriert (neue APK)? Einmal geprueft und gemerkt, damit der
  // Steuertakt nicht bei jedem Befehl einen fehlgeschlagenen Aufruf bezahlt.
  let omegaBleDa = null;
  function omegaBleVerfuegbar() {
    if (omegaBleDa === null) {
      try { omegaBleDa = !!(C && typeof C.isPluginAvailable === 'function' && C.isPluginAvailable('OmegaBle')); }
      catch (e) { omegaBleDa = false; }
    }
    return omegaBleDa;
  }
  // Natives Direktschreiben, FEUER UND WEG (v0.9.2 neu): toNative OHNE gespeicherten Rueckruf -
  // writeControl antwortet ab APK 0.9.2 gar nicht (RETURN_NONE), es bleibt also auch kein Promise
  // je Takt liegen. Aeltere OmegaBle-Fassungen antworten noch; ohne Rueckruf verfaellt die Antwort.
  //
  // EHRLICHER RUECKFALL: OmegaBle meldet ueber status(), ob es die Verbindung findet. Solange das
  // nicht feststeht oder "nein" heisst, schreibt das Community-Plugin. Geprueft wird beim ersten
  // Befehl und danach alle 2 s, im Hintergrund. Kennt das Plugin status() nicht (APK 0.8.124-126),
  // bleibt es beim alten Verhalten: OmegaBle schreibt.
  const omegaLage = new Map();
  function omegaBleBereit(z) {
    let l = omegaLage.get(z.deviceId);
    if (!l) { l = { bereit: null, geprueft: 0, fragt: false, zaehler: null, alt: false }; omegaLage.set(z.deviceId, l); }
    const jetzt = performance.now();
    if (!l.fragt && jetzt - l.geprueft > 2000) {
      l.fragt = true;
      C.nativePromise('OmegaBle', 'status', z)
        .then((r) => {
          // Findet es die Verbindung, verwirft aber seit der letzten Frage nur noch (nichts
          // geschrieben, etwas verworfen): dann ebenfalls das Plugin nehmen.
          const v = l.zaehler;
          const nurVerworfen = v && r && r.geschrieben === v.geschrieben && r.verworfen > v.verworfen;
          l.bereit = !!(r && r.bereit) && !nurVerworfen;
          l.zaehler = r || null;
        })
        .catch(() => { l.bereit = true; l.alt = true; })
        .then(() => { l.fragt = false; l.geprueft = performance.now(); });
    }
    return l.bereit === true;
  }
  function omegaBleSchreiben(z, hex) {
    try {
      C.toNative('OmegaBle', 'writeControl', { deviceId: z.deviceId, service: z.service,
                                               characteristic: z.characteristic, value: hex });
      return true;
    } catch (e) { return false; }
  }
  // Waehrend das Community-Plugin selbst ans GATT geht (Abo, Lesen, Schreiben mit Antwort),
  // schreibt OmegaBle nicht: Android erlaubt nur EINEN GATT-Vorgang zugleich. Gezaehlt, weil
  // mehrere Vorgaenge ueberlappen koennen; das Plugin hebt die Pause nach 1,5 s selbst auf.
  let omegaPausen = 0;
  async function mitOmegaPause(fn) {
    if (!omegaBleVerfuegbar()) return fn();
    if (omegaPausen++ === 0) await C.nativePromise('OmegaBle', 'pause', { an: true }).catch(() => {});
    try { return await fn(); } finally {
      if (--omegaPausen === 0) C.nativePromise('OmegaBle', 'pause', { an: false }).catch(() => {});
    }
  }
  // Fuer die Anzeige "Funk-Rundlauf" (Optionen > System).
  window.OMEGA_BRUECKE.omegaInfo = () => {
    if (!omegaBleVerfuegbar()) return { weg: 'Plugin' };
    const l = [...omegaLage.values()][0];
    return { weg: l && l.bereit ? 'OmegaBle' : 'Plugin', alt: !!(l && l.alt), zaehler: l && l.zaehler };
  };

  let bereit = null;
  function starten() {
    // androidNeverForLocation passt zum Manifest (BLUETOOTH_SCAN mit neverForLocation): ab
    // Android 12 wird nicht nach dem Standort gefragt.
    if (!bereit) {
      bereit = ruf('initialize', { androidNeverForLocation: true }).catch((e) => {
        bereit = null;
        throw e;
      });
    }
    return bereit;
  }

  class Merkmal extends EventTarget {
    constructor(dienst, roh) {
      super();
      this.service = dienst;
      this.uuid = roh.uuid;
      this.properties = Object.assign({ read: false, write: false, writeWithoutResponse: false,
                                        notify: false, indicate: false }, roh.properties || {});
      this.value = null;
      this._abo = null;
    }
    get _ziel() {
      if (!this._zielCache) {
        this._zielCache = { deviceId: this.service.device.id, service: this.service.uuid,
                            characteristic: this.uuid };
      }
      return this._zielCache;
    }
    // TIMEOUT 300 ms statt der 5 s des Plugins (BluetoothLe.kt liest "timeout"): ein
    // Schreibvorgang, dessen Antwort verloren ist, haelt die Lenkung sonst fuenf Sekunden fest.
    //
    // NATIVES DIREKTSCHREIBEN (OmegaBlePlugin): der Community-Weg wartet auf onCharacteristicWrite,
    // und der Bridge-Rundlauf JS <-> nativ legt sich auf jede Lenk-/Gaseingabe. OmegaBle schreibt
    // mit WRITE_TYPE_NO_RESPONSE und loest sofort auf; die Web-Seite wartet NICHT auf den
    // Bridge-Rundlauf (fire-and-forget), damit der Steuertakt nie an ihm haengt. Faellt auf das
    // Community-Plugin zurueck, wenn OmegaBle fehlt oder nicht verbunden ist.
    writeValueWithoutResponse(daten) {
      const z = this._ziel;
      const hex = zuHex(daten);
      if (omegaBleVerfuegbar() && omegaBleBereit(z) && omegaBleSchreiben(z, hex)) return Promise.resolve();
      return ruf('writeWithoutResponse', { deviceId: z.deviceId, service: z.service,
                                           characteristic: z.characteristic, value: hex, timeout: 300 });
    }
    async writeValueWithResponse(daten) {
      const z = this._ziel;
      await mitOmegaPause(() => ruf('write', { deviceId: z.deviceId, service: z.service,
                                               characteristic: z.characteristic, value: zuHex(daten), timeout: 300 }));
    }
    writeValue(daten) { return this.writeValueWithResponse(daten); }
    async readValue() {
      const r = await mitOmegaPause(() => ruf('read', this._ziel));
      this.value = ausHex(r && r.value);
      return this.value;
    }
    async startNotifications() {
      const z = this._ziel;
      if (!this._abo) {
        // Der Ereignisname ist der, unter dem das Plugin meldet (BluetoothLe.kt):
        // notification|<Geraet>|<Dienst>|<Merkmal>, die UUIDs klein geschrieben.
        this._abo = C.addListener(PLUGIN, 'notification|' + z.deviceId + '|' + z.service
                                  + '|' + z.characteristic, (d) => {
          this.value = ausHex(d && d.value);
          this.dispatchEvent(new Event('characteristicvaluechanged'));
        });
      }
      await mitOmegaPause(() => ruf('startNotifications', z));
      return this;
    }
    async stopNotifications() {
      await mitOmegaPause(() => ruf('stopNotifications', this._ziel));
      if (this._abo) { this._abo.remove(); this._abo = null; }
      return this;
    }
  }

  class Dienst {
    constructor(geraet, roh) {
      this.device = geraet;
      this.uuid = roh.uuid;
      this.isPrimary = true;
      this._merkmale = (roh.characteristics || []).map((c) => new Merkmal(this, c));
    }
    async getCharacteristic(u) {
      const m = this._merkmale.find((c) => c.uuid === uuid(u));
      if (!m) throw new DOMException('Merkmal ' + u + ' nicht gefunden', 'NotFoundError');
      return m;
    }
    async getCharacteristics(u) {
      if (u === undefined) return this._merkmale.slice();
      return this._merkmale.filter((c) => c.uuid === uuid(u));
    }
  }

  class Gatt {
    constructor(geraet) { this.device = geraet; this.connected = false; this._dienste = null; }
    async connect() {
      await starten();
      const id = this.device.id;
      if (!this.device._trennAbo) {
        this.device._trennAbo = C.addListener(PLUGIN, 'disconnected|' + id, () => {
          this.connected = false;
          this._dienste = null;
          this.device.dispatchEvent(new Event('gattserverdisconnected'));
        });
      }
      await ruf('connect', { deviceId: id, timeout: 15000 });
      this.connected = true;
      // SCHNELLES VERBINDUNGSINTERVALL. Android waehlt sonst 30-50 ms, und der Sendetakt ist
      // 45 ms - dann faellt jedes zweite Paket auf das naechste Intervall. 1 = HIGH.
      ruf('requestConnectionPriority', { deviceId: id, connectionPriority: 1 }).catch(() => {});
      // Und alle 10 s nachlegen (v0.9.2): manche Autos/Telefone handeln das Intervall spaeter
      // wieder hoch, und ein langsames Intervall fuehlt sich genau wie Eingabeverzoegerung an.
      clearInterval(this._prio);
      this._prio = setInterval(() => {
        if (!this.connected) { clearInterval(this._prio); return; }
        ruf('requestConnectionPriority', { deviceId: id, connectionPriority: 1 }).catch(() => {});
      }, 10000);
      return this;
    }
    disconnect() {
      if (!this.connected) return;
      ruf('disconnect', { deviceId: this.device.id }).catch(() => {});
      // Web Bluetooth meldet die Trennung auch dann, wenn man selbst trennt.
      this.connected = false;
      this._dienste = null;
      setTimeout(() => this.device.dispatchEvent(new Event('gattserverdisconnected')), 0);
    }
    async _laden() {
      if (!this._dienste) {
        const r = await ruf('getServices', { deviceId: this.device.id });
        this._dienste = ((r && r.services) || []).map((s) => new Dienst(this.device, s));
      }
      return this._dienste;
    }
    async getPrimaryService(u) {
      const d = (await this._laden()).find((s) => s.uuid === uuid(u));
      if (!d) throw new DOMException('Dienst ' + u + ' nicht gefunden', 'NotFoundError');
      return d;
    }
    async getPrimaryServices(u) {
      const alle = await this._laden();
      return u === undefined ? alle.slice() : alle.filter((s) => s.uuid === uuid(u));
    }
  }

  class Geraet extends EventTarget {
    constructor(id, name) {
      super();
      // Die Kennung ist hier die MAC-Adresse - anders als im Browser STABIL ueber Neustarts.
      // Gemerkte Autos (Name, Farbe) finden ihr Auto damit wieder.
      this.id = id;
      this.name = name || '';
      this.gatt = new Gatt(this);
    }
  }

  const bekannte = new Map();

  // FILTER: Web Bluetooth verknuepft mehrere Filter mit ODER, das Plugin kennt einen. Steht
  // irgendwo ein Namensanfang, gilt er allein (so findet es auch Autos, die ihren Dienst
  // nicht bewerben); sonst die Dienste.
  async function requestDevice(o) {
    await starten();
    o = o || {};
    const filter = o.filters || [];
    const praefix = (filter.find((f) => f.namePrefix) || {}).namePrefix;
    const name = (filter.find((f) => f.name) || {}).name;
    const opt = { optionalServices: (o.optionalServices || []).map(uuid) };
    if (praefix) opt.namePrefix = praefix;
    else if (name) opt.name = name;
    else if (!o.acceptAllDevices) {
      const d = [];
      filter.forEach((f) => (f.services || []).forEach((s) => d.push(uuid(s))));
      if (d.length) opt.services = d;
    }
    // NOCH VERBUNDEN VOM LETZTEN MAL. GEMELDET: "Wenn ich die App schliesse und oeffne,
    // zeigt das Auto an, es waere noch verbunden, ist es aber nicht. Und neu verbinden geht
    // dann auch nicht." Das Plugin schliesst seine Verbindungen nicht, wenn die App zugeht:
    // der Prozess lebt weiter, die alte Verbindung auch, nur die Seite ist neu und weiss
    // nichts davon. Das Auto haelt sich fuer verbunden, wirbt deshalb nicht mehr - und die
    // Suche findet es nie. Also zuerst nachsehen, ob das System ein passendes Auto schon
    // verbunden hat, und das direkt nehmen; connect() legt darueber eine neue, eigene
    // Verbindung an, und die Verbindung zum Auto selbst steht ja noch.
    if (praefix) {
      try {
        const v = await ruf('getConnectedDevices', { services: [] });
        const frei = ((v && v.devices) || []).find((d) => d && d.deviceId && d.name
          && d.name.indexOf(praefix) === 0
          && !(bekannte.get(d.deviceId) && bekannte.get(d.deviceId).gatt.connected));
        if (frei) {
          let g0 = bekannte.get(frei.deviceId);
          if (!g0) { g0 = new Geraet(frei.deviceId, frei.name); bekannte.set(frei.deviceId, g0); }
          return g0;
        }
      } catch (e) { /* aeltere Plugins oder ohne Recht: dann eben suchen */ }
    }
    let r;
    try {
      r = await ruf('requestDevice', opt);
    } catch (e) {
      // Wie im Browser: Abbruch der Auswahl ist ein NotFoundError.
      throw new DOMException(String((e && e.message) || e), 'NotFoundError');
    }
    let g = bekannte.get(r.deviceId);
    if (!g) { g = new Geraet(r.deviceId, r.name); bekannte.set(r.deviceId, g); }
    else if (r.name) g.name = r.name;
    return g;
  }

  // getAvailability fragt NICHT nach Rechten: ein Info-Screen braucht kein Bluetooth, und eine
  // Rechteabfrage beim Oeffnen der App waere fuer ihn nur laestig. Solange nicht gestartet
  // wurde, heisst es "vorhanden"; der erste Klick auf Verbinden fragt dann.
  async function getAvailability() {
    if (!bereit) return true;
    try {
      await bereit;
      const r = await ruf('isEnabled');
      return !!(r && r.value);
    } catch (e) { return false; }
  }

  const bt = new EventTarget();
  bt.requestDevice = requestDevice;
  bt.getAvailability = getAvailability;
  bt.getDevices = async () => Array.from(bekannte.values());
  try {
    Object.defineProperty(navigator, 'bluetooth', { value: bt, configurable: true });
  } catch (e) { /* ohne Bluetooth bleibt die App ein Info-Screen */ }
})();

