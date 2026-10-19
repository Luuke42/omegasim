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
  // Die 47 Byte, die USB und Bluetooth gemeinsam haben.
  function dsGemeinsam(links) {
    const c = new Uint8Array(47);
    c[0] = 0x08;                 // nur der linke Trigger
    c.set(links, 21);
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
  function dsBericht(links, bt, folge) {
    const c = dsGemeinsam(links);
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
  async function dsSenden(links) {
    if (!dsGeraet) return;
    const b = dsBericht(links, dsBt, dsFolge);
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
      await dsSenden(dsAus());
    } catch (e) { dsFehler = e.message || String(e); dsLageZeigen(); }
  }
  // Der linke Trigger ist die Bremse, wenn sie auf Knopf 6 liegt (Vorgabe).
  function dsBremseLinks() {
    return !!(typeof bindings !== 'undefined' && bindings.brake && bindings.brake.type === 'button' && bindings.brake.index === 6);
  }
  function dsTick() {
    if (!dsGeraet) return;
    const absAn = !!($('vib-abs') ? $('vib-abs').checked : true);
    const soll = absAn && dsBremseLinks() && physicsEnabled && !!(physEngine.state && physEngine.state.absActive) ? 'abs' : 'aus';
    if (soll === dsZustand) return;
    dsZustand = soll;
    dsSenden(soll === 'abs' ? dsVibration(DS_ABS.position, DS_ABS.staerke, DS_ABS.frequenz) : dsAus());
  }
  setInterval(dsTick, 60);
  if ($('ds-verbinden')) $('ds-verbinden').addEventListener('click', dsVerbinden);
  if ('hid' in navigator) {
    navigator.hid.addEventListener('disconnect', (e) => { if (e.device === dsGeraet) { dsGeraet = null; dsLageZeigen(); } });
  }
  dsLageZeigen();
