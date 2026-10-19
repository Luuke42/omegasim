  // ============================== HOME ==============================
  // Der Schirm beim Laden, erreichbar ueber das Logo. Die Zahl der Einstellungen wird
  // zur Laufzeit gezaehlt, damit sie nicht veraltet.
  // At the end of the IIFE like the blocks above: it reads physEngine.config at load time to
  // count the handling parameters, and anything doing that from the middle of the file trips
  // over a const declared further down.

  // The claim on the front page has to be TRUE, so it is counted rather than typed. A number
  // written by hand goes stale on the first new slider and then the front page is lying.
  // countHandlingParams() stand hier und wurde von niemandem gerufen: es ist der Rest
  // der festen Zahl 70 auf der Startseite, die inzwischen gezaehlt wird.

  // DIE STARTSEITE IST SEIT DEM ACC-MENUE DER TITELBILDSCHIRM (51-konsole.js). Drehzahl-
  // nadel, Regen und Blitz der alten Startseite sind mit ihr entfallen, ebenso die Knoepfe
  // "Auto verbinden" und "Zur Garage" - verbunden wird jetzt auf der Kachel AUTO im
  // Fahren-Schirm. Geblieben ist die gezaehlte Zahl der Einstellungen: sie steht jetzt unter
  // Info -> Funktionen.
  //
  // Wieder GEZAEHLT, aber auf einen Zehner abgerundet: "ueber 50" ist kurz, bleibt bei jeder
  // Aenderung wahr und bricht die Zeile nicht um. Gezaehlt werden nur Dinge, die man anfasst -
  // Regler, Ankreuzfelder, Auswahlfelder -, keine Textfelder oder versteckten Hilfsfelder.
  function homeStart() {
    const el = $('home-param-count');
    if (el) {
      const echte = [...document.querySelectorAll(
        '#tab-options input[id], #tab-options select[id], '
        + '#tab-control input[id], #tab-control select[id]')]
        .filter(x => x.type === 'range' || x.type === 'checkbox' || x.tagName === 'SELECT');
      el.textContent = String(Math.max(10, Math.floor(echte.length / 10) * 10));
    }
  }
  homeStart();

  // The two warning tones have no file, so the documentation plays the code. That also means
  // the page can never demonstrate a sound the game no longer makes.
  for (const [id, n] of [['snd-fuel-20', 1], ['snd-fuel-10', 2]]) {
    const b = $(id);
    if (!b) continue;
    b.addEventListener('click', () => {
      if (!audioCtx || !soundEnabled) {
        $('snd-fuel-note').textContent = 'Ton ist aus, in den Optionen einschalten.';
        return;
      }
      $('snd-fuel-note').textContent = '';
      playFuelWarning(n);
    });
  }

  // ---- TITEL-GLITCH JE BUCHSTABE (v0.8.38) ----
  // BESTELLT: "je Buchstabe je Seite (oben, unten) zufaellig festlegen, ob der Glitch-Effekt
  // blau oder rot ist." Bei jedem Laden neu gewuerfelt; die Animation je Buchstabe versetzt,
  // damit nicht alle im Gleichtakt springen. Der Titel traegt aria-label, die Buchstaben sind
  // fuer Bildschirmleser ausgeblendet.
  (function titelGlitchZerlegen() {
    const farbe = () => (Math.random() < 0.5 ? 'var(--glitch-c)' : 'var(--glitch-r)');
    document.querySelectorAll('.home-titel .home-titel-text').forEach((wort) => {
      const text = wort.textContent;
      wort.textContent = '';
      for (const ch of text) {
        const b = document.createElement('span');
        b.className = 'gl-b';
        b.setAttribute('data-t', ch);
        b.setAttribute('aria-hidden', 'true');
        b.textContent = ch;
        b.style.setProperty('--gl-o', farbe());
        b.style.setProperty('--gl-u', farbe());
        b.style.setProperty('--gl-d', (-Math.random() * 3.2).toFixed(2) + 's');
        b.style.setProperty('--gl-e', (-Math.random() * 2.7).toFixed(2) + 's');
        wort.appendChild(b);
      }
      wort.classList.add('gl-zerlegt');
    });
  })();
