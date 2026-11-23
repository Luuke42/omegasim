  // ============================== DUALSENSE-TRIGGER (v1.1.3, WIP) ==============================
  //
  // BESTELLT: "Wenn ABS an ist, ein DualSense-Triggereffekt auf dem linken Trigger (falls er
  // zugewiesen ist)." Die Gamepad-API erreicht die adaptiven Trigger nicht (siehe triggerRuettle in
  // 40-physics.js). Der einzige Weg im Browser ist WebHID: Chrome/Edge am Rechner, mit einmaliger
  // Freigabe ueber den Knopf in Optionen > Allgemein. In der APK (WebView) gibt es kein WebHID.
  //
  // Der Ausgabebericht des DualSense (offen dokumentiert, z. B. im Linux-Treiber hid-playstation):
  //   USB:       Bericht 0x02, 47 Byte: [0] valid_flag0 (0x04 rechter, 0x08 linker Trigger), ...,
  //              [10..20] Effekt rechter Trigger, [21..31] Effekt linker Trigger.
  //   Bluetooth: Bericht 0x31, 77 Byte: [0] Folge<<4, [1] 0x10, dann dieselben 47 Byte, am Ende
  //              CRC-32 (Startbyte 0xA2, dann Berichtskennung und Daten), little endian.
  // Effekt "Vibration" (0x26): Zonen ab Position aktiv, Staerke je Zone (3 Bit), Frequenz in Hz.
  // "Aus" ist 0x05 mit Nullen. Ohne Geraet am Tisch geschrieben - deshalb WIP.
  const DS_VENDOR = 0x054c, DS_PRODUKTE = [0x0ce6, 0x0df2];
  const DS_ABS = { position: 2, staerke: 6, frequenz: 28 };
  let dsGeraet = null, dsBt = false, dsFolge = 0, dsZustand = null, dsFehler = '';

  function dsVibration(position, staerke, frequenz) {
    const e = new Uint8Array(11);
    let zonen = 0, staerken = 0;
    const s = Math.max(0, Math.min(7, staerke - 1));
    for (let i = Math.max(0, Math.min(9, position)); i < 10; i++) { zonen |= 1 << i; staerken |= s << (3 * i); }
    e[0] = 0x26;
    e[1] = zonen & 0xff; e[2] = (zonen >> 8) & 0xff;
    e[3] = staerken & 0xff; e[4] = (staerken >>> 8) & 0xff; e[5] = (staerken >>> 16) & 0xff; e[6] = (staerken >>> 24) & 0xff;
    e[9] = frequenz & 0xff;
    return e;
  }
  function dsAus() { const e = new Uint8Array(11); e[0] = 0x05; return e; }
  // v1.5.29: WIDERSTAND ueber den Weg (Effekt "Feedback" 0x21, dieselbe Packung wie die Vibration ohne Frequenz):
  // ab Zone start (0..9) waechst die Staerke von s0 bis s1 (1..8). So wird ein Pedal nach unten fester.
  function dsWiderstand(start, s0, s1) {
    const e = new Uint8Array(11);
    let zonen = 0, staerken = 0;
    const a = Math.max(0, Math.min(9, start));
    for (let i = a; i < 10; i++) {
      const k = a === 9 ? 1 : (i - a) / (9 - a);
      const st = Math.max(0, Math.min(7, Math.round(s0 + (s1 - s0) * k) - 1));
      zonen |= 1 << i; staerken |= st << (3 * i);
    }
    e[0] = 0x21;
    e[1] = zonen & 0xff; e[2] = (zonen >> 8) & 0xff;
    e[3] = staerken & 0xff; e[4] = (staerken >>> 8) & 0xff; e[5] = (staerken >>> 16) & 0xff; e[6] = (staerken >>> 24) & 0xff;
    return e;
  }
  // ---- TRIGGER WIE BEI LIBRECORSA (v1.5.29, WIP) -----------------------------------------------------
  // BESTELLT: "Die Trigger-Effekte vom DualSense sollten, wenn sie gehen, immer so wie die bei LibreCorsa sein."
  // Nach der Beschreibung dort (kein Code uebernommen): L2 ist das Bremspedal, ein Widerstand, der ueber den Weg
  // fester wird; regelt das ABS, vibriert er (20 Hz), blockiert ein Rad (12 Hz); ohne ABS nahe der Haftgrenze ein
  // leichtes Summen (40 Hz). R2 ist das Gas: leichter Widerstand; drehen die Hinterraeder durch, vibriert er (35 Hz),
  // regelt die Traktionskontrolle (18 Hz); ohne TC nahe der Grenze ein schwaches Summen (40 Hz). Ein Effekt bleibt
  // DS_HALTE_MS stehen, damit ein Signal, das nur ein Bild flackert, nicht zwischen den Arten springt.
  // Gilt in allen Fahrgefuehlen mit Physik, echt und virtuell. RC (ohne Physik): Trigger aus.
  const DS_HZ = { abs: 20, block: 12, tc: 18, spin: 35, grenze: 40 };
  const DS_HALTE_MS = 150;
  // Rein, fuer den Selbsttest: aus dem Zustand die Art je Trigger. e: { physik, bremse (0..1), gas (0..1), abs (bool),
  // absAn (Hilfe aktiv), tcAn, nutzV, nutzH (Ausnutzung der Haftung vorn/hinten, 1 = Grenze), kmh }.
  function dsTriggerArt(e) {
    if (!e || !e.physik) return { links: 'aus', rechts: 'aus' };
    let links = 'pedal', rechts = 'gas';
    if (e.bremse > 0.05) {
      if (e.abs) links = 'abs';
      else if (!e.absAn && e.nutzV > 1.05 && e.kmh > 5) links = 'block';
      else if (!e.absAn && e.nutzV > 0.9) links = 'grenze';
    }
    if (e.gas > 0.4) {
      if (e.nutzH > 1.0) rechts = e.tcAn ? 'tc' : 'spin';
      else if (!e.tcAn && e.nutzH > 0.9) rechts = 'grenze';
    }
    return { links, rechts };
  }
  function dsEffekt(art, links) {
    switch (art) {
      // v1.6.5: Staerken wie LibreCorsa (dualsense-feedback.ts, slopeZones bei voller Trigger-Staerke):
      // Bremse ab Zone 1 von 3 auf 8, Gas erst ab 30 % des Wegs (Zone 3) von 1 auf 3.
      case 'pedal': return dsWiderstand(1, 3, 8);           // Bremse: wird nach unten fester
      case 'gas': return dsWiderstand(3, 1, 3);             // Gas: leicht, erst ab 30 % des Wegs
      case 'abs': return dsVibration(2, 6, DS_HZ.abs);
      case 'block': return dsVibration(2, 7, DS_HZ.block);
      case 'tc': return dsVibration(1, 5, DS_HZ.tc);
      case 'spin': return dsVibration(1, 6, DS_HZ.spin);
      case 'grenze': return dsVibration(links ? 3 : 2, 2, DS_HZ.grenze);
      default: return dsAus();
    }
  }
  const dsHalt = { links: { art: 'aus', bis: 0 }, rechts: { art: 'aus', bis: 0 } };
  // Haelt eine Vibration DS_HALTE_MS fest: eine neue Art gilt sofort, das Zurueckfallen auf den Grundzustand erst danach.
  function dsHalten(seite, art, jetzt) {
    const h = dsHalt[seite];
    const grund = art === 'pedal' || art === 'gas' || art === 'aus';
    if (!grund) { h.art = art; h.bis = jetzt + DS_HALTE_MS; return art; }
    if (h.bis > jetzt && h.art !== 'aus' && h.art !== 'pedal' && h.art !== 'gas') return h.art;
    h.art = art; h.bis = 0;
    return art;
  }
  // Die 47 Byte, die USB und Bluetooth gemeinsam haben.
  // v1.5.125: dazu die Richtungshaptik auf den beiden Griffmotoren. Der linke (niedrig/schwer)
  // steht auf Byte 3, der rechte (hoch/leicht) auf Byte 2 - wie bei LibreCorsa. Damit sie laufen,
  // wird im valid_flag0 Bit 1 (HAPTICS_SELECT) gesetzt und die ueberarbeitete Rumble-Auslegung
  // (Bit 2 von valid_flag2, COMPATIBLE_VIBRATION2, ab Firmware 2.21 / jeder DualSense Edge)
  // angeschaltet. Ohne Grippmotor bleibt Bit 0 (COMPATIBLE_VIBRATION, die alte Auslegung) frei,
  // damit ein reiner Trigger-Bericht nicht als Rumble gelesen wird.
  let dsGripLetzt = false;
  function dsGemeinsam(links, rechts, gripL, gripR) {
    const c = new Uint8Array(47);
    let f0 = 0x0C;               // linker (0x08) + rechter (0x04) Trigger
    const gl = Math.max(0, Math.min(1, +gripL || 0));
    const gr = Math.max(0, Math.min(1, +gripR || 0));
    // v1.5.158 (Review): auch die NULL nach einem Rumble mit Flag senden - ohne HAPTICS_SELECT ignoriert der Controller
    // die Bytes und behaelt den letzten Wert (Motor lief nach einem Rutsch weiter).
    const anMitNull = dsGripLetzt;
    dsGripLetzt = gl > 0 || gr > 0;
    if (gl > 0 || gr > 0 || anMitNull) {
      f0 |= 0x02;                // HAPTICS_SELECT: die beiden Grippmotor-Bytes gelten
      c[38] |= 0x04;             // COMPATIBLE_VIBRATION2: ueberarbeitete Rumble-Auslegung
      c[3] = Math.round(gl * 255);   // linker Grippmotor (niedrig/schwer)
      c[2] = Math.round(gr * 255);   // rechter Grippmotor (hoch/leicht)
    }
    c[0] = f0;
    if (rechts) c.set(rechts, 10);
    if (links) c.set(links, 21);
    return c;
  }
  let dsCrcTab = null;
  function dsCrc32(bytes) {
    if (!dsCrcTab) {
      dsCrcTab = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        dsCrcTab[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (const b of bytes) crc = dsCrcTab[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  // Rein, fuer den Selbsttest: die Bytes eines Berichts (ohne Berichtskennung) und die Kennung.
  function dsBericht(links, rechts, bt, folge, gripL, gripR) {
    const c = dsGemeinsam(links, rechts, gripL, gripR);
    if (!bt) return { id: 0x02, daten: c };
    const d = new Uint8Array(77);
    d[0] = (folge & 0x0f) << 4;
    d[1] = 0x10;
    d.set(c, 2);
    const fuerCrc = new Uint8Array(1 + 1 + 73);
    fuerCrc[0] = 0xa2; fuerCrc[1] = 0x31; fuerCrc.set(d.subarray(0, 73), 2);
    const crc = dsCrc32(fuerCrc);
    d[73] = crc & 0xff; d[74] = (crc >>> 8) & 0xff; d[75] = (crc >>> 16) & 0xff; d[76] = (crc >>> 24) & 0xff;
    return { id: 0x31, daten: d };
  }
  async function dsSenden(links, rechts, gripL, gripR) {
    // v1.5: in der App ueber das USB-Kabel (OmegaDsUsbPlugin), wenn die Dauerverbindung steht.
    if (dsUsb.offen) { dsUsbSenden(dsUsbBericht(links, rechts, gripL, gripR)); return; }
    if (!dsGeraet) return;
    const b = dsBericht(links, rechts, dsBt, dsFolge, gripL, gripR);
    dsFolge = (dsFolge + 1) & 0x0f;
    try { await dsGeraet.sendReport(b.id, b.daten); dsFehler = ''; }
    catch (e) { dsFehler = e.message || String(e); }
    dsLageZeigen();
  }
  function dsLageZeigen() {
    const el = $('ds-lage');
    if (!el) return;
    el.textContent = !('hid' in navigator) ? t('Nur in Chrome/Edge am Rechner (WebHID)')
      : !dsGeraet ? t('nicht verbunden')
      : (dsGeraet.productName || 'DualSense') + (dsBt ? ' · Bluetooth' : ' · USB') + (dsFehler ? ' · ' + dsFehler : '');
  }
  async function dsVerbinden() {
    if (!('hid' in navigator)) { dsLageZeigen(); return; }
    try {
      const liste = await navigator.hid.requestDevice({ filters: DS_PRODUKTE.map((p) => ({ vendorId: DS_VENDOR, productId: p })) });
      const g = liste && liste[0];
      if (!g) return;
      if (!g.opened) await g.open();
      dsGeraet = g;
      // Ueber Bluetooth meldet der DualSense den Ausgabebericht 0x31, ueber USB 0x02.
      dsBt = (g.collections || []).some((c) => (c.outputReports || []).some((r) => r.reportId === 0x31));
      dsZustand = null;
      dsLageZeigen();
      await dsSenden(dsAus(), dsAus());
    } catch (e) { dsFehler = e.message || String(e); dsLageZeigen(); }
  }
  // Der linke Trigger ist die Bremse, wenn sie auf Knopf 6 liegt (Vorgabe).
  function dsBremseLinks() {
    return !!(typeof bindings !== 'undefined' && bindings.brake && bindings.brake.type === 'button' && bindings.brake.index === 6);
  }
  // Der rechte Trigger ist das Gas, wenn es auf Knopf 7 liegt (Vorgabe).
  function dsGasRechts() {
    return !!(typeof bindings !== 'undefined' && bindings.throttle && bindings.throttle.type === 'button' && bindings.throttle.index === 7);
  }
  // v1.5.29: der Drehzahl-Hinweis auf dem Gas (v1.3.107) entfaellt; LibreCorsa zeigt die Drehzahl am Leuchtbalken,
  // nicht am Trigger, und ein summendes Gas stoerte beim echten Fahren die feine Dosierung.
  function dsEingang() {
    const st = physEngine && physEngine.state;
    const an = !!($('vib-trigger') ? $('vib-trigger').checked : true);
    if (!an || !physicsEnabled || !st) return { physik: false };
    return {
      physik: true,
      bremse: dsBremseLinks() ? Math.max(0, -(st.longUse || 0)) : 0,
      gas: dsGasRechts() ? Math.max(0, st.longUse || 0) : 0,
      abs: !!st.absActive && !!($('vib-abs') ? $('vib-abs').checked : true),
      absAn: true,
      tcAn: (st.setupTc || 0) > 0,
      nutzV: st.pacNutzV || 0, nutzH: st.pacNutzH || 0,
      kmh: Math.abs(st.speedKmh || 0),
    };
  }
  // ---- RICHTUNGSHAPTIK AUF DEN GRIFFMOTOREN (v1.5.125) --------------------------------------
  // BESTELLT: "Baue die Richtungshaptik auf den Griffmotoren ein. ... Untersteuern in linkskurve ->
  // rechts vibrieren, untersteuern in rechtskurve -> links vibrieren. Uebersteuern in rechtskurve ->
  // links vibrieren." Beim Gripverlust schiebt das Auto zur AUSSENSEITE der Kurve, also vibriert
  // genau der Griff auf der Aussenseite - Untersteuern (Front schiebt) und Uebersteuern (Heck kommt)
  // gleichermassen. Rueckgabewert: Staerke 0..1 je Griffmotor (links/rechts).
  // Die Staerke lehnt sich an die Rueckmeldung aus pacejkaRueckmeldung (50-drive.js) an, nur eben
  // auf EINE Seite statt auf beide Motoren, und wie bei LibreCorsa haelt sie, solange der Rutsch da ist.
  function dsGripCue() {
    const g = { links: 0, rechts: 0 };
    // v1.6.5: mit dem Mischer (41-rumble-mix.js, wie LibreCorsa) bekommen die Griffmotoren dessen Staerken:
    // links der tiefe (stark), rechts der hohe (schwach) Motor - genau wie bei LibreCorsa (low/high).
    if (typeof rumbleMixAktiv === 'function' && rumbleMixAktiv()) { g.links = rmZ.letztS; g.rechts = rmZ.letztW; return g; }
    const st = physEngine && physEngine.state;
    if (!rumbleOn || !physicsEnabled || !st || !st.pacZustand) return g;
    let dir = 0, mag = 0;
    if (st.pacZustand === 'ueber' && st.pacUeber > 0.03) {
      if (RUMBLE_ARTEN['rutschen'] === false) return g;
      dir = st.pacRichtung || Math.sign(st.dampedSteering);
      const max = (physEngine.config && physEngine.config.pacejkaUeberMax) || 0.35;
      const k = Math.min(1, st.pacUeber / Math.max(0.01, max));
      mag = 0.4 + 0.25 * k;              // stark, solange das Heck draussen ist (v1.5.150: schwaechere Staerke)
    } else if (st.pacZustand === 'unter' && st.pacNutzV > 1) {
      if (RUMBLE_ARTEN['untersteuern'] === false) return g;
      dir = Math.sign(st.dampedSteering);
      const k = Math.min(1, (1 - st.pacUnter) * 4);
      mag = 0.2 + 0.2 * k;            // maessig, solange die Front schiebt (v1.5.150: schwaechere Staerke)
    }
    if (!dir) return g;
    // Aussenseite = Gegenseite der Kurve: Rechtskurve (dir > 0) -> linker Griff, Linkskurve -> rechter Griff.
    if (dir > 0) g.links = mag; else g.rechts = mag;
    return g;
  }
  // Ob die Richtungshaptik den Unter-/Uebersteuer-Rumble uebernimmt. 50-drive.js fragt das, damit das
  // Unter-/Uebersteuern nicht ZUSAETZLICH ueber den allgemeinen Pad-Rumble geht (doppelte Staerke).
  function dsGripAktiv() {
    return !!(dsGeraet || dsUsb.offen) && rumbleOn;
  }
  function dsTick() {
    if (!dsGeraet && !dsUsb.offen) return;
    const jetzt = performance.now();
    const a = dsTriggerArt(dsEingang());
    const l = dsBremseLinks() ? dsHalten('links', a.links, jetzt) : 'aus';
    const r = dsGasRechts() ? dsHalten('rechts', a.rechts, jetzt) : 'aus';
    const grip = dsGripCue();
    // Auf ganze 8-Bit-Werte gerundet, damit ein nur um 1/255 schwankender Rutsch nicht neu sendet.
    const gl = Math.round(grip.links * 255);
    const gr = Math.round(grip.rechts * 255);
    const schluessel = l + '|' + r + '|' + gl + '|' + gr;
    if (schluessel === dsZustand) return;
    dsZustand = schluessel;
    dsSenden(dsEffekt(l, true), dsEffekt(r, false), gl / 255, gr / 255);
  }
  setInterval(dsTick, 60);
  if ($('ds-verbinden')) $('ds-verbinden').addEventListener('click', dsVerbinden);

  // ---- v1.5 (WIP, Plan Paket 6): TRIGGER UEBER USB IN DER ANDROID-APP, Stufe 1: Pruefknopf ----------------
  // Die WebView hat kein WebHID. OmegaDsUsbPlugin.java schreibt denselben USB-Bericht (0x02, 63 Bytes: Kennung,
  // die 47 Bytes aus dsGemeinsam, Rest 0) ueber die USB-Host-API. Erst wenn der Nutzer meldet, dass die Trigger
  // reagieren UND die Tasten danach noch gehen, wird daraus der Dauerbetrieb im Fahren.
  function dsUsbApp() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); }
  function dsUsbPlugin() { const C = window.Capacitor; return dsUsbApp() && C.isPluginAvailable && C.isPluginAvailable('OmegaDsUsb'); }
  function dsUsbBericht(links, rechts, gripL, gripR) {
    const b = dsBericht(links, rechts, false, 0, gripL, gripR);
    const out = new Uint8Array(63);
    out[0] = b.id;
    out.set(b.daten, 1);
    return out;
  }
  function dsUsbBase64(bytes) { let s = ''; bytes.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); }
  // Die Probe: 3 s Widerstand (beide fest), 2 s Vibration (links ABS, rechts durchdrehend), dann die
  // Richtungshaptik (v1.5.125): erst der linke, dann der rechte Griffmotor (Staerke 0,6), zum Schluss aus.
  function dsUsbFolge() {
    return [
      { bericht: dsUsbBase64(dsUsbBericht(dsWiderstand(1, 8, 8), dsWiderstand(1, 8, 8))), ms: 3000 },
      { bericht: dsUsbBase64(dsUsbBericht(dsVibration(2, 7, DS_HZ.abs), dsVibration(1, 6, DS_HZ.spin))), ms: 2000 },
      { bericht: dsUsbBase64(dsUsbBericht(dsAus(), dsAus(), 0.6, 0)), ms: 1500 },
      { bericht: dsUsbBase64(dsUsbBericht(dsAus(), dsAus(), 0, 0.6)), ms: 1500 },
      { bericht: dsUsbBase64(dsUsbBericht(dsAus(), dsAus())), ms: 0 },
    ];
  }
  function dsUsbLage(text) { const el = $('ds-usb-lage'); if (el) el.textContent = text; }
  // v1.5: das Protokoll steht unter dem Knopf (nicht nur im Live-Log) und laesst sich kopieren.
  function dsUsbProtokoll(text) {
    const z = $('ds-usb-proto-zeile'), ta = $('ds-usb-proto');
    if (!z || !ta) return;
    ta.value = text; z.hidden = !text;
  }
  if ($('ds-usb-proto-kopieren')) $('ds-usb-proto-kopieren').addEventListener('click', async () => {
    const ta = $('ds-usb-proto');
    try { await navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); try { document.execCommand('copy'); } catch (e2) { /* von Hand */ } }
    showHudToast(t('Protokoll kopiert'));
  });
  async function dsUsbTest() {
    if (!dsUsbPlugin()) { dsUsbLage(t('Braucht die neue APK.')); return; }
    if (dsUsb.offen) {
      const folge = [[dsWiderstand(1, 8, 8), dsWiderstand(1, 8, 8), 3000], [dsVibration(2, 7, DS_HZ.abs), dsVibration(1, 6, DS_HZ.spin), 2000], [dsAus(), dsAus(), 1500, 0.6, 0], [dsAus(), dsAus(), 1500, 0, 0.6], [dsAus(), dsAus(), 0]];
      dsUsbLage(t('Läuft …'));
      for (const [l, r, ms, gl, gr] of folge) { dsUsbSenden(dsUsbBericht(l, r, gl, gr)); if (ms) await new Promise((ok) => setTimeout(ok, ms)); }
      dsZustand = null;
      dsUsbLage(t('Gesendet ({w}). Haben die Trigger reagiert?').replace('{w}', 'USB'));
      return;
    }
    const C = window.Capacitor;
    dsUsbLage(t('Läuft …'));
    try {
      const r = await C.nativePromise('OmegaDsUsb', 'test', { folge: dsUsbFolge() });
      log('DualSense USB-Probe:\n' + ((r && r.protokoll) || ''), r && r.ok ? 'ok' : 'err');
      dsUsbProtokoll((r && r.protokoll) || '');
      dsUsbLage(r && r.ok ? t('Gesendet ({w}). Haben die Trigger reagiert?').replace('{w}', r.weg || '?') : t('Fehler, siehe Live-Log.'));
    } catch (e) {
      log('DualSense USB-Probe: ' + ((e && e.message) || e), 'err');
      dsUsbLage((e && e.message) || String(e));
      dsUsbProtokoll((e && e.message) || String(e));
    }
  }
  if ($('ds-usb-zeile')) $('ds-usb-zeile').hidden = !dsUsbApp();
  if ($('ds-usb-dauer-zeile')) $('ds-usb-dauer-zeile').hidden = !dsUsbApp();

  // ---- v1.5 (WIP, Paket 6 Stufe 2): DAUERVERBINDUNG BEIM FAHREN ----------------------------------------------
  // BESTELLT: "Trigger-Effekte richtig ins virtuelle und echte Fahren einbauen." Alle DS_USB_SUCH_MS fragt die Seite, ob
  // ein DualSense am Kabel haengt, und oeffnet die Verbindung (einmal Erlaubnis). Danach sendet dsTick ueber dsSenden
  // dieselben Effekte wie am PC, nur ueber das Kabel. Meldet die App "tasten" (nur Kabel, Tasten fielen weg), bleibt es
  // aus, bis das Kabel einmal abgezogen war.
  const DS_USB_SUCH_MS = 3000;
  const dsUsb = { offen: false, sucht: false, gesperrt: '', meldung: '' };
  function dsUsbAn() { return !!($('ds-usb-an') ? $('ds-usb-an').checked : true); }
  function dsUsbSenden(bytes) {
    try { window.Capacitor.nativePromise('OmegaDsUsb', 'senden', { bericht: dsUsbBase64(bytes) }).catch(() => {}); } catch (e) { /* weiter */ }
  }
  async function dsUsbSuchen() {
    if (!dsUsbPlugin() || dsUsb.sucht) return;
    const C = window.Capacitor;
    dsUsb.sucht = true;
    try {
      const l = await C.nativePromise('OmegaDsUsb', 'lage', {});
      if (!l || !l.gefunden) { dsUsb.gesperrt = ''; if (dsUsb.offen) { dsUsb.offen = false; dsZustand = null; } return; }
      if (l.offen === false && dsUsb.offen) { dsUsb.offen = false; dsZustand = null; }
      if (!dsUsbAn()) { if (dsUsb.offen) await dsUsbZu(); return; }
      if (dsUsb.offen || dsUsb.gesperrt) return;
      const r = await C.nativePromise('OmegaDsUsb', 'oeffnen', { aus: dsUsbBase64(dsUsbBericht(dsAus(), dsAus())) });
      if (r && r.ok) {
        dsUsb.offen = true; dsZustand = null;
        dsUsb.meldung = t('Trigger über USB aktiv ({w})').replace('{w}', r.weg || '?');
        showHudToast(t('DualSense-Trigger über USB aktiv'));
        log('DualSense USB: Trigger aktiv. ' + ((r && r.protokoll) || ''), 'ok');
      } else {
        dsUsb.gesperrt = (r && r.grund) || 'fehler';
        dsUsb.meldung = dsUsb.gesperrt === 'tasten'
          ? t('Nur am Kabel fallen die Tasten weg: Controller zuerst per Bluetooth verbinden, dann das Kabel einstecken.')
          : dsUsb.gesperrt === 'erlaubnis' ? t('USB-Zugriff nicht erlaubt.') : t('Fehler, siehe Live-Log.');
        if (dsUsb.gesperrt === 'tasten') showHudToast(dsUsb.meldung);
        log('DualSense USB: ' + dsUsb.gesperrt + '. ' + ((r && r.protokoll) || ''), 'info');
      }
      dsUsbLage(dsUsb.meldung);
    } catch (e) { /* alte APK: kein oeffnen */ dsUsb.gesperrt = 'apk'; }
    finally { dsUsb.sucht = false; }
  }
  async function dsUsbZu() {
    if (!dsUsb.offen) return;
    dsUsb.offen = false; dsZustand = null;
    try { await window.Capacitor.nativePromise('OmegaDsUsb', 'schliessen', { aus: dsUsbBase64(dsUsbBericht(dsAus(), dsAus())) }); } catch (e) { /* weg */ }
    dsUsbLage('');
  }
  if (dsUsbApp()) {
    setInterval(dsUsbSuchen, DS_USB_SUCH_MS);
    try { window.Capacitor.addListener('OmegaDsUsb', 'dsUsbZu', (r) => { dsUsb.offen = false; dsZustand = null; dsUsbLage(''); log('DualSense USB: zu (' + ((r && r.grund) || '') + ').', 'info'); }); } catch (e) { /* alte Capacitor-Fassung */ }
  }
  if ($('ds-usb-an')) $('ds-usb-an').addEventListener('change', () => { if (!dsUsbAn()) dsUsbZu(); else { dsUsb.gesperrt = ''; dsUsbSuchen(); } });
  if ($('ds-usb-test')) $('ds-usb-test').addEventListener('click', dsUsbTest);
  if ('hid' in navigator) {
    navigator.hid.addEventListener('disconnect', (e) => { if (e.device === dsGeraet) { dsGeraet = null; dsLageZeigen(); } });
  }
  dsLageZeigen();
