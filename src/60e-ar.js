  // ==================================================================================================
  // AUGMENTED REALITY (v1.6.60, WIP, Prototyp)
  // ==================================================================================================
  // BESTELLT: "For the chrome version, build an AR prototype that can be launched through the virtual garage. The aim
  // is for the virtual car to drive in my home and for the helicopter to fly in my home."
  //
  // WebXR "immersive-ar" (Chrome auf Android mit ARCore, ueber https - die GitHub-Pages-Fassung). In der App (Android-
  // WebView) gibt es WebXR nicht; der Knopf "AR" in der virtuellen Garage erscheint nur, wo der Browser es anbietet.
  //
  // Ablauf:
  //   1. Tipp auf "AR" (Nutzergeste): die AR-Sitzung wird SOFORT angefragt (hit-test, local; dom-overlay fuer HUD und
  //      Touch-Steuerung), dann startet die normale virtuelle Fahrt mit opts.ar (virtuellStarten): ihre Schicht liegt im
  //      Wurzelelement der Ueberlagerung, durchsichtig, die Leinwand unsichtbar; gezeichnet wird in die Ebene der Sitzung.
  //   2. Bodensuche: ein Kreis zeigt, wo der Strahl aus der Bildmitte den Boden trifft (hit-test). Ein Tipp setzt die
  //      Strecke dorthin, gedreht so, dass sie vom Betrachter wegfuehrt. "Neu platzieren" setzt sie wieder zurueck.
  //   3. Danach laeuft alles wie sonst (Fahren, Fliegen, Tore, Runden, HUD). Je Bild der Sitzung: Physik (vfBild) und
  //      je Auge die Szene (vfSzeneMalen) mit der Projektion der Kamera und Welt = Anker * Drehung * Massstab.
  //
  // MASSSTAB: Die Welt der virtuellen Fahrt ist die echte Carrera-Bahn (TRACK_UNITS_PER_CM Einheiten je cm), in AR also
  // 1:1 - die Strecke liegt in Originalgroesse auf dem Boden, Auto und Hubschrauber passen dazu (Hubschrauber ~5 cm,
  // Flughoehe bis ~2,8 m). VF_AR_MASSSTAB vergroessert bei Bedarf (z. B. 2 = doppelt so gross).
  const VF_AR_MASSSTAB = 1;
  let vfArUnterstuetzt = null;   // null = noch nicht geprueft
  function vfArMoeglich() { return vfArUnterstuetzt === true; }
  function vfArPruefen() {
    if (vfArUnterstuetzt !== null) return;
    vfArUnterstuetzt = false;
    try {
      if (navigator.xr && navigator.xr.isSessionSupported) {
        navigator.xr.isSessionSupported('immersive-ar').then((ja) => {
          vfArUnterstuetzt = !!ja;
          const k = document.querySelector('[data-vf="ar"]');
          if (k) k.hidden = !(ja || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
        }).catch(() => { vfArUnterstuetzt = false; });
      }
    } catch (e) { vfArUnterstuetzt = false; }
  }
  setTimeout(vfArPruefen, 0);

  // v1.6.63 GEMELDET: "Wenn ich den AR-Knopf klicke, oeffnen sich 2 Fenster, die mich fragen, ob sie die Kamera benutzen
  // duerfen. Wenn ich bei beiden OK klicke, passiert nichts, nur der Hintergrund zeigt ein kurzes eingefrorenes
  // Kamerabild." Die zwei Fenster sind Chrome (Seite darf die Kamera) und Android (Chrome darf die Kamera) - beim ersten
  // Mal. Danach endete die Sitzung: bis 1.6.62 baute die Seite erst die ganze virtuelle Fahrt auf (Sekunden, Texturen,
  // Modelle) und setzte die AR-Ebene erst danach; die Sitzung bekam so lange kein Bild. Jetzt:
  //   1. Sitzung da -> sofort eine XR-faehige Leinwand, AR-Ebene, Bezugsraum und ein Bildtakt, der nur durchsichtig
  //      loescht und den Boden sucht (vfArBild ohne Fahrt);
  //   2. erst im naechsten Takt die virtuelle Fahrt, die genau diese Leinwand uebernimmt (virtuellStarten, opts.ar.cv).
  // Kein doppelter Start (vfArLaeuft). Endet die Sitzung, ohne dass die Strecke stand, zeigt ein Fenster das Protokoll
  // (vfArLog) und den Hinweis, es nochmal zu versuchen.
  let vfArLaeuft = null;
  function vfArLog(ar, text) {
    const z = ((performance.now() - ar.t0) / 1000).toFixed(1) + ' s: ' + text;
    ar.protokoll.push(z);
    if (ar.protokoll.length > 40) ar.protokoll.shift();
    try { log('AR ' + z, 'info'); } catch (e) { /* egal */ }
  }
  // v1.6.65 GEMELDET: "Nothing happens when I click on AR". Bis 1.6.64 meldete der Start Fehler nur als HUD-Hinweis (in
  // der Garage nicht zu sehen), eine haengende oder fehlgeschlagene Anfrage liess den Laufmerker und die unsichtbare
  // Vollbild-Ueberlagerung stehen - danach schluckte sie jeden Tipp. Jetzt: Fehler als Fenster mit Protokoll, die
  // Ueberlagerung faengt keine Tipps (pointer-events), sofortige Rueckmeldung am Knopf, Waechter nach 12 s.
  function vfArMeldung(titel, text, ar) {
    const prot = ar && ar.protokoll && ar.protokoll.length ? '\n\n' + t('Protokoll:') + '\n' + ar.protokoll.slice(-12).join('\n') : '';
    if (typeof konsoleFrage === 'function') konsoleFrage(titel, text + prot, [[t('Nochmal'), () => vfArStarten()],
      [t('Marker-AR (ohne ARCore)'), () => vfMarkerStarten()], [t('Schließen'), null]], true);
    else showHudToast(titel + ': ' + text);
  }
  function vfArKnopf(text) {
    document.querySelectorAll('[data-vf="ar"]').forEach((b) => {
      if (!b.dataset.text) b.dataset.text = b.innerHTML;
      b.innerHTML = text || b.dataset.text;
      b.disabled = !!text;
    });
  }
  function vfArStarten() {
    if (VF.aktiv) {
      vfArMeldung(t('AR konnte nicht starten'), t('Eine virtuelle Fahrt läuft noch. Erst beenden, dann AR tippen.'));
      return;
    }
    if (vfArLaeuft) {
      // Haengt ein alter Versuch (keine Sitzung nach 12 s), aufraeumen und neu beginnen.
      if (!vfArLaeuft.session && performance.now() - vfArLaeuft.t0 > 12000) { vfArAufraeumen(vfArLaeuft); vfArLaeuft = null; }
      else return;
    }
    // v1.6.67: ohne WebXR-AR (App, Handys ohne ARCore wie Galaxy A16/A41) die Marker-AR mit der Kamera.
    if (!(navigator.xr && navigator.xr.requestSession) || !vfArMoeglich()) { vfMarkerStarten(); return; }
    vfArKnopf(t('AR startet …'));
    const wurzel = document.createElement('div');
    wurzel.className = 'vf-ar-wurzel';
    document.body.appendChild(wurzel);
    const ar = { session: null, wurzel, cv: null, gl: null, frame: null, ref: null, hitSrc: null, treffer: null, platz: null, kamera: null,
                 layerOk: false, t0: performance.now(), protokoll: [], bilder: 0, fehler: null };
    vfArLaeuft = ar;
    vfArLog(ar, 'Sitzung angefragt (AR unterstuetzt: ' + vfArUnterstuetzt + ')');
    const fehlschlag = (titel, m) => {
      if (vfArLaeuft === ar) vfArLaeuft = null;
      ar.beendet = true;
      wurzel.remove();
      vfArKnopf('');
      vfArLog(ar, 'Fehler: ' + m);
      log('AR: ' + m, 'warn');
      vfArMeldung(titel, m + '\n\n' + t('Hinweise: Chrome auf dem Handy aktualisieren; im Play Store „Google Play-Dienste für AR“ installieren bzw. aktualisieren; Kamera für Chrome und diese Seite erlauben.'), ar);
    };
    // Waechter: kommt nach 12 s keine Sitzung (Anfrage haengt), aufraeumen und melden.
    setTimeout(() => { if (!ar.session && !ar.beendet) fehlschlag(t('AR antwortet nicht'), t('Chrome hat die AR-Sitzung nach 12 s nicht gestartet.')); }, 12000);
    // Sofort anfragen (Nutzergeste), alles andere danach.
    let anfrage;
    try {
      anfrage = navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['hit-test', 'dom-overlay'],
      domOverlay: { root: wurzel },
    });
    } catch (e) { fehlschlag(t('AR konnte nicht starten'), (e && e.message) || String(e)); return; }
    anfrage.then((session) => {
      if (ar.beendet) { session.end().catch(() => {}); return; }   // der Waechter hat schon aufgegeben
      ar.session = session;
      vfArKnopf('');
      vfArLog(ar, 'Sitzung laeuft' + (session.domOverlayState ? ' (Ueberlagerung ' + session.domOverlayState.type + ')' : ' (ohne Ueberlagerung)'));
      session.addEventListener('end', () => vfArEnde(ar));
      // Tipps auf Knoepfe der Ueberlagerung sind keine AR-Auswahl (Steuerung, Knopfleiste).
      wurzel.addEventListener('beforexrselect', (e) => { if (e.target && e.target.closest && e.target.closest('button, .vf-touch, .vf-knoepfe, input, select')) e.preventDefault(); });
      session.addEventListener('select', () => vfArPlatzieren(ar));
      // 1. Leinwand und AR-Ebene sofort.
      ar.cv = document.createElement('canvas');
      ar.cv.style.visibility = 'hidden';
      ar.gl = ar.cv.getContext('webgl', { antialias: true, alpha: false, xrCompatible: true });
      if (!ar.gl) { vfArLog(ar, 'kein WebGL'); session.end().catch(() => {}); return; }
      (ar.gl.makeXRCompatible ? ar.gl.makeXRCompatible() : Promise.resolve()).then(() => {
        if (ar.beendet) return;
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, ar.gl) });
        ar.layerOk = true;
        vfArLog(ar, 'AR-Ebene bereit');
        session.requestAnimationFrame(vfArBild);
        return session.requestReferenceSpace('local').then((ref) => {
          ar.ref = ref;
          vfArLog(ar, 'Bezugsraum local');
          return session.requestReferenceSpace('viewer').then((viewer) => session.requestHitTestSource({ space: viewer }))
            .then((src) => { ar.hitSrc = src; vfArLog(ar, 'Bodensuche bereit'); })
            .catch((e) => vfArLog(ar, 'Bodensuche nicht moeglich: ' + e.message + ' (Strecke dann vor dir)'));
        });
      }).catch((e) => { vfArLog(ar, 'AR-Ebene: ' + (e && e.message)); session.end().catch(() => {}); });
      // 2. Die virtuelle Fahrt einen Takt spaeter (uebernimmt ar.cv).
      setTimeout(() => {
        if (ar.beendet) return;
        let ok = false;
        try { ok = virtuellStarten({ ar }); } catch (e) { vfArLog(ar, 'Start der Fahrt: ' + e.message); }
        vfArLog(ar, ok ? 'virtuelle Fahrt gestartet' : 'virtuelle Fahrt startet nicht');
        if (!ok) { session.end().catch(() => {}); return; }
        vfArHinweis(ar);
      }, 0);
    }).catch((e) => {
      if (ar.beendet) return;
      fehlschlag(t('AR konnte nicht starten'), (e && e.name ? e.name + ': ' : '') + ((e && e.message) || String(e)));
    });
  }
  // Ende der Sitzung (Nutzer, Browser oder Fehler): Fahrt beenden, aufraeumen, bei einem fruehen Ende das Protokoll zeigen.
  function vfArEnde(ar) {
    if (ar.endeGemeldet) return;
    ar.endeGemeldet = true;
    ar.beendet = true;
    vfArLog(ar, 'Sitzung beendet nach ' + ar.bilder + ' Bildern');
    if (VF.aktiv && VF.ar === ar) virtuellBeenden(); else vfArAufraeumen(ar);
    if (vfArLaeuft === ar) vfArLaeuft = null;
    vfArKnopf('');
    if (!ar.platz && !ar.vonHand) {
      setTimeout(() => vfArMeldung(t('AR wurde beendet'),
        t('Die AR-Sitzung hat geendet, bevor die Strecke stand. Beim ersten Mal fragen Chrome und Android nach der Kamera - danach bitte nochmal AR tippen.'), ar), 300);
    }
  }
  // Ein Bild der AR-Sitzung. Vor dem Start der Fahrt (und waehrend sie laedt) nur durchsichtig loeschen und den Boden
  // suchen; danach Physik und Anzeige wie sonst (vfBild), gezeichnet in vfArMalen.
  function vfArBild(zeit, frame) {
    const ar = vfArLaeuft;
    if (!ar || ar.beendet) return;
    // Doppelte Anmeldungen im selben Bild: nur eine rechnet, die andere endet hier.
    if (ar.letzteZeit === zeit) return;
    ar.letzteZeit = zeit;
    ar.bilder++;
    const fahrt = VF.aktiv && VF.ar === ar;
    if (!fahrt) ar.session.requestAnimationFrame(vfArBild);
    ar.frame = frame;
    try {
      if (fahrt) vfBild(zeit);
      if (!fahrt || VF.laedt) vfArMalen(frame);
    } catch (e) {
      if (!ar.fehler) { ar.fehler = e; vfArLog(ar, 'Fehler im Bild: ' + e.message); }
    } finally { ar.frame = null; }
  }

  // Strecke an die Trefferstelle setzen, gedreht vom Betrachter weg.
  function vfArPlatzieren(ar) {
    if (ar.platz || !VF.aktiv || VF.laedt) return;
    let m = ar.treffer;
    if (!m && !ar.hitSrc && ar.kamera) {
      const k = ar.kamera, f = [-k[8], -k[10]], l = Math.hypot(f[0], f[1]) || 1;
      m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k[12] + f[0] / l * 1.2, k[13] - 1.2, k[14] + f[1] / l * 1.2, 1];
    }
    if (!m) return;
    vfArLog(ar, 'Strecke platziert');
    let yaw = 0;
    if (ar.kamera) { const f = [-ar.kamera[8], -ar.kamera[10]]; yaw = Math.atan2(-f[0], -f[1]); }
    // Mitte der Strecke (Mittellinie) in den Anker.
    let cx = 0, cy = 0;
    if (VF.pts && VF.pts.length) { VF.pts.forEach((p) => { cx += p.x; cy += p.y; }); cx /= VF.pts.length; cy /= VF.pts.length; }
    ar.platz = { x: m[12], y: m[13], z: m[14], yaw, cx, cy, s: VF_AR_MASSSTAB / (TRACK_UNITS_PER_CM * 100) };
    vfArHinweis(ar);
  }
  // Welt der virtuellen Fahrt -> Raum der AR-Sitzung (Meter): T(Anker) * Ry(yaw) * S(s) * T(-Mitte).
  function vfArWelt(p) {
    return vfKette(vfT(p.x, p.y, p.z), vfRy(p.yaw), vfS(p.s, p.s, p.s), vfT(-p.cx, 0, -p.cy));
  }
  // Ein Punkt der AR-Sitzung zurueck in die Welt der Fahrt (fuer Licht und Ton: das Auge).
  function vfArZurueck(p, q) {
    const dx = q[0] - p.x, dy = q[1] - p.y, dz = q[2] - p.z;
    const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
    const rx = c * dx + s * dz, rz = -s * dx + c * dz;
    return [rx / p.s + p.cx, dy / p.s, rz / p.s + p.cy];
  }

  // Zielkreis fuer die Bodensuche (Ring in der x-z-Ebene, Radius 1, 6 Zahlen je Ecke wie die Farbmodelle).
  function vfArRingBauen(gl) {
    const a = [], n = 40, r0 = 0.8, r1 = 1;
    for (let i = 0; i < n; i++) {
      const w0 = i / n * Math.PI * 2, w1 = (i + 1) / n * Math.PI * 2;
      const p = (r, w) => [Math.cos(w) * r, 0.002, Math.sin(w) * r];
      const q = [p(r0, w0), p(r1, w0), p(r1, w1), p(r0, w0), p(r1, w1), p(r0, w1)];
      q.forEach((v) => a.push(v[0], v[1], v[2], 0.4, 1.6, 1.8));
    }
    return vfPuffer(gl, a);
  }
  function vfArFarbeMalen(gl, pv, pu, welt) {
    gl.useProgram(VF.prog);
    if (!VF.loc) VF.loc = { m: gl.getUniformLocation(VF.prog, 'm'), w: gl.getUniformLocation(VF.prog, 'w'), nebel: gl.getUniformLocation(VF.prog, 'nebel'), alf: gl.getUniformLocation(VF.prog, 'alf'), sonne: gl.getUniformLocation(VF.prog, 'sonne'),
                            dunst: gl.getUniformLocation(VF.prog, 'dunst'), aug: gl.getUniformLocation(VF.prog, 'aug'),
                            p: gl.getAttribLocation(VF.prog, 'p'), c: gl.getAttribLocation(VF.prog, 'c'), pv: new Float32Array(16), w16: new Float32Array(16) };
    const L = VF.loc;
    for (let i = 0; i < 16; i++) { L.pv[i] = pv[i]; L.w16[i] = welt[i]; }
    gl.uniformMatrix4fv(L.m, false, L.pv);
    gl.uniformMatrix4fv(L.w, false, L.w16);
    vfTzSetzen(gl, L);
    gl.uniform1f(L.alf, 1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pu.b);
    gl.enableVertexAttribArray(L.p); gl.enableVertexAttribArray(L.c);
    gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(L.c, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, pu.n);
    gl.disableVertexAttribArray(L.p); gl.disableVertexAttribArray(L.c);
  }

  // Ein Bild in die AR-Ebene: Kamerabild kommt vom System (durchsichtig loeschen), darueber je Auge die Szene.
  function vfArMalen(frame) {
    const ar = vfArLaeuft, gl = ar && ar.gl;
    if (!ar || !ar.ref || !ar.layerOk || !gl) return;
    const pose = frame.getViewerPose(ar.ref);
    if (!pose) return;
    ar.kamera = pose.transform.matrix;
    if (!ar.platz && ar.hitSrc) {
      const h = frame.getHitTestResults(ar.hitSrc);
      const p = h.length ? h[0].getPose(ar.ref) : null;
      ar.treffer = p ? p.transform.matrix : null;
    }
    const layer = ar.session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const proj = Array.from(view.projectionMatrix), sicht = Array.from(view.transform.inverse.matrix);
      if (!ar.platz || !VF.aktiv || VF.laedt || !VF.prog) {
        if (ar.treffer && VF.prog) {
          if (!ar.ring) ar.ring = vfArRingBauen(gl);
          // Ring mit 15 cm Radius flach auf dem Treffer.
          const m = ar.treffer;
          vfArFarbeMalen(gl, vfMal(proj, sicht), ar.ring, vfKette(vfT(m[12], m[13], m[14]), vfS(0.15, 0.15, 0.15)));
        }
        continue;
      }
      const welt = vfArWelt(ar.platz);
      const blick = vfMal(sicht, welt);
      const pv = vfMal(proj, blick);
      const pos = view.transform.position;
      const auge = vfArZurueck(ar.platz, [pos.x, pos.y, pos.z]);
      VF.augeJetzt = auge;
      vfSzeneMalen(gl, pv, blick, auge);
    }
  }

  // Hinweis und Knopf "Neu platzieren" in der Ueberlagerung.
  function vfArHinweis(ar) {
    const sch = VF.schicht;
    if (!sch) return;
    let h = sch.querySelector('.vf-ar-hinweis');
    if (!h) { h = document.createElement('div'); h.className = 'vf-ar-hinweis'; sch.appendChild(h); }
    h.textContent = t('Handy langsam über den Boden bewegen, bis der Kreis erscheint, dann tippen: dort steht die Strecke.');
    h.hidden = !!ar.platz;
    let k = sch.querySelector('.vf-ar-neu');
    if (!k) {
      k = document.createElement('button');
      k.type = 'button'; k.className = 'vf-ar-neu';
      k.textContent = t('Neu platzieren');
      k.onclick = (e) => { e.stopPropagation(); ar.platz = null; vfArHinweis(ar); };
      sch.appendChild(k);
    }
    k.hidden = !ar.platz;
  }
  function vfArAufraeumen(ar) {
    if (!ar) return;
    ar.vonHand = ar.vonHand || !!VF.beendenVonHand;
    if (vfArLaeuft === ar && ar.beendet) vfArLaeuft = null;
    try { if (ar.hitSrc) ar.hitSrc.cancel(); } catch (e) { /* egal */ }
    if (ar.session && !ar.beendet) { ar.vonHand = true; ar.beendet = true; ar.session.end().catch(() => {}); if (vfArLaeuft === ar) vfArLaeuft = null; }
    if (ar.wurzel) ar.wurzel.remove();
  }
