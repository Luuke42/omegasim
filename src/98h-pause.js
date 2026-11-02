
  // UI erst nach allen Modulen initialisieren, keine TDZ beim Laden.
  if (!bindings.pause) bindings.pause = { ...DEFAULT_BINDINGS.pause };
  for (const z of zusatzPlaetze()) {
    if (z.bindings && !z.bindings.pause) z.bindings.pause = { ...DEFAULT_BINDINGS.pause };
  }
  const pauseStyle = document.createElement('style');
  pauseStyle.textContent = `
    #renn-pause-ui[hidden]{display:none}
    #renn-pause-ui{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;
      background:rgba(0,0,0,.68);padding:18px}
    #renn-pause-ui .pause-panel{width:min(440px,100%);box-sizing:border-box;
      background:#161b25;color:#fff;border:1px solid #586174;border-radius:14px;
      padding:24px;text-align:center;font:16px system-ui}
    #renn-pause-ui .pause-lampen{display:flex;justify-content:center;gap:12px;margin:20px 0}
    #renn-pause-ui .pause-saeule{display:grid;gap:8px}
    #renn-pause-ui [data-pause-lampe]{width:26px;height:26px;border-radius:50%;
      background:#424854;display:block}
    #renn-pause-ui button{margin:6px;padding:12px 18px;cursor:pointer}
    #renn-pause-ui p{line-height:1.5}
  `;
  document.head.appendChild(pauseStyle);
  const pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'renn-pause-ui'; pauseOverlay.hidden = true;
  pauseOverlay.setAttribute('role', 'dialog'); pauseOverlay.setAttribute('aria-modal', 'true');
  pauseOverlay.setAttribute('aria-labelledby', 'renn-pause-titel');
  const pauseLampen = Array.from({ length: 5 }, (_, k) =>
    `<span class="pause-saeule"><i data-pause-lampe="${k + 1}"></i>`
      + `<i data-pause-lampe="${k + 1}"></i></span>`).join('');
  pauseOverlay.innerHTML = `<div class="pause-panel">
    <h2><span id="renn-pause-titel">Pausiert</span> <span class="wip-tag">WIP</span></h2><div class="pause-lampen">${pauseLampen}</div>
    <p id="renn-pause-hinweis"></p>
    <button type="button" id="renn-pause-weiter">Weiter über Rennampel</button>
    <button type="button" id="renn-pause-ende">Beenden</button>
  </div>`;
  document.body.appendChild(pauseOverlay);
  document.getElementById('renn-pause-weiter').onclick = rennPauseUmschalten;
  document.getElementById('renn-pause-ende').onclick = () => {
    rennPauseBeenden();
    if (['countdown', 'racing', 'finishing'].includes(raceState)) requestRaceStop();
    else if (vfAktiv()) virtuellBeenden();
    else for (const c of garage) if (c.ghost && c.ghost.running) stopGhost(c);
  };
  document.getElementById('race-act-pause').onclick = rennPauseUmschalten;
  // Fahr-/Boxen-Tastatur waehrend Pause nicht durch das Overlay hindurch ausloesen.
  window.addEventListener('keydown', e => {
    if (!rennPauseAktiv() || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ',
      'x', 'X', 'q', 'Q', 'c', 'C', 'f', 'F', 'r', 'R'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  // Diagnose und lokale Teststeuerung; keine Multiplayer-Pause.
  window.OMEGA_PAUSE = Object.freeze({
    umschalten: rennPauseUmschalten,
    status: () => ({ phase: rennPause.phase, rennzeit: rennZeitJetzt(),
      verzug: rennPause.verzug, lokal: !rennPauseMehrspieler() })
  });
  i18nOnLangChange(rennPauseMalen);
  rennPauseMalen();
