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

  const HOME_GEARS = [1, 2, 3, 4, 5, 6];
  let homeRaf = null, homeT0 = 0, homeFlashAt = 0;

  // The hero is an SVG rev arc plus a gear number, drawn once and then only updated - not
  // rebuilt per frame. Rebuilding innerHTML at 60 Hz on the same thread that has to keep the
  // 45 ms control cadence is exactly the kind of thing that makes a car stutter.
  function homeBuild() {
    const bg = $('home-bg');
    if (!bg || bg.dataset.built) return;
    bg.dataset.built = '1';
    const ticks = [];
    for (let i = 0; i <= 20; i++) {
      const a = (-210 + i * 240 / 20) * Math.PI / 180;
      const r1 = i % 5 === 0 ? 74 : 80, r2 = 88;
      ticks.push('<line x1="' + (110 + Math.cos(a) * r1).toFixed(1) + '" y1="'
        + (110 + Math.sin(a) * r1).toFixed(1) + '" x2="' + (110 + Math.cos(a) * r2).toFixed(1)
        + '" y2="' + (110 + Math.sin(a) * r2).toFixed(1) + '" stroke="'
        + (i >= 16 ? '#ff4d5a' : '#3c4457') + '" stroke-width="' + (i % 5 === 0 ? 2.4 : 1.3) + '"/>');
    }
    bg.innerHTML =
      '<svg viewBox="0 0 460 220" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">'
      + '<g opacity=".5" transform="translate(300,10) scale(0.95)">'
      + '<circle cx="110" cy="110" r="96" fill="none" stroke="#1b2130" stroke-width="1.5"/>'
      + ticks.join('')
      + '<line id="home-needle" x1="110" y1="110" x2="110" y2="30" stroke="#ff2d3a"'
      + ' stroke-width="3.2" stroke-linecap="round"/>'
      + '<circle cx="110" cy="110" r="7" fill="#2a3040"/>'
      + '<text id="home-gear" x="110" y="168" text-anchor="middle" font-size="34"'
      + ' font-weight="800" fill="#f4f6fb" font-family="monospace">1</text>'
      + '</g>'
      + '</svg>';
  }

  function homeFrame(now) {
    if (!homeT0) homeT0 = now;
    // Math.max(0, ...): Math.pow with a fractional exponent returns NaN for a negative base,
    // and a NaN reaching setAttribute produces a browser error rather than a wrong picture.
    // My own test harness hit exactly that by calling this with a timestamp before homeT0.
    const t = Math.max(0, (now - homeT0) / 1000);
    const needle = $('home-needle');
    if (needle) {
      // A shift cycle: revs climb, snap back, next gear. Six gears then round again, which
      // is the same shape the real dash draws, only on a timer instead of on a throttle.
      const cycle = 1.65;
      const idx = Math.floor(t / cycle) % HOME_GEARS.length;
      const frac = (t % cycle) / cycle;
      const rev = 0.18 + 0.78 * Math.pow(frac, 0.72);
      const ang = -210 + rev * 240;
      needle.setAttribute('transform', 'rotate(' + (ang + 90).toFixed(1) + ' 110 110)');
      needle.setAttribute('stroke', rev > 0.86 ? '#ff2d3a' : '#ff7a45');
      const g = $('home-gear');
      if (g) g.textContent = String(HOME_GEARS[idx]);
    }
    // Das Omega im Hintergrund glitcht. Die Versaetze springen in Stufen und nicht
    // kontinuierlich, weil ein weiches Gleiten wie ein Fehler im Rendering aussieht und ein
    // Sprung wie ein Signalfehler - gemeint ist der Signalfehler. Die Schrittweite haengt an
    // einer Sinusfunktion mit unrunder Periode, damit sich das Muster nicht hoerbar
    // wiederholt.
    const mark = document.querySelector('.home-mark');
    if (mark) {
      const step = Math.floor(t * 7.3) % 5;
      const jump = step === 0 ? 6 : step === 2 ? -4 : step === 3 ? 2 : 0;
      mark.style.transform = 'translateY(-50%) translateX(' + jump + 'px)';
      // Und ab und zu ein harter Aussetzer, kurz genug, dass er als Stoerung liest.
      mark.style.opacity = (Math.floor(t * 11.7) % 23 === 0) ? '0.05' : '';
    }

    // Weather comes and goes on its own, and the lightning only strikes while it is wet -
    // a flash out of a dry sky would read as a rendering glitch rather than as weather.
    // Haeufiger als vorher: 17 s Zyklus mit 10 s trocken hiess, dass man den Regen selten
    // zu sehen bekam. Jetzt 11 s Zyklus, etwa die Haelfte nass.
    const wet = (t % 11) > 5;
    const hero = $('home-hero');
    if (hero) hero.classList.toggle('wet', wet);
    const flash = $('home-flash');
    if (flash) {
      if (wet && now - homeFlashAt > 1400 && Math.random() < 0.03) {
        homeFlashAt = now;
        flash.style.transition = 'none';
        flash.style.opacity = '0.5';
        // Two-stage decay: a real strike has a bright stroke and a dimmer afterglow.
        setTimeout(() => { flash.style.transition = 'opacity 90ms'; flash.style.opacity = '0.22'; }, 55);
        setTimeout(() => { flash.style.transition = 'opacity 520ms'; flash.style.opacity = '0'; }, 150);
      }
    }
    homeRaf = requestAnimationFrame(homeFrame);
  }

  function homeStart() {
    homeBuild();
    // Wieder GEZAEHLT, aber auf einen Zehner abgerundet.
    //
    // Hier stand eine feste 70, mit der Begruendung, die gezaehlten 73 haetten die Zeile
    // umgebrochen. Nachgezaehlt sind es inzwischen 59 - 33 Regler, 17 Ankreuzfelder, 9
    // Auswahlfelder -, die Behauptung "ueber 70" war also falsch. Eine Zahl, die niemand
    // nachrechnet, veraltet zwangslaeufig; genau deshalb gehoert sie gezaehlt.
    //
    // Das Abrunden loest das ursprungliche Problem sauberer als eine feste Zahl: "ueber 50"
    // ist kurz, bleibt bei jeder Aenderung wahr, und bricht die Zeile nicht um. Gezaehlt
    // werden nur Dinge, die man anfasst - Regler, Ankreuzfelder, Auswahlfelder - und keine
    // Textfelder oder versteckten Hilfsfelder.
    const el = $('home-param-count');
    if (el) {
      const echte = [...document.querySelectorAll(
        '#tab-options input[id], #tab-options select[id], '
        + '#tab-control input[id], #tab-control select[id]')]
        .filter(x => x.type === 'range' || x.type === 'checkbox' || x.tagName === 'SELECT');
      el.textContent = String(Math.max(10, Math.floor(echte.length / 10) * 10));
    }
    if (homeRaf !== null) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Draw one frame and stop. The rule already freezes the rain; the needle has to be
      // stopped here, because requestAnimationFrame does not know about the preference.
      homeFrame(performance.now());
      cancelAnimationFrame(homeRaf);
      homeRaf = null;
      return;
    }
    homeT0 = 0;
    homeRaf = requestAnimationFrame(homeFrame);
  }

  function homeStop() {
    if (homeRaf !== null) { cancelAnimationFrame(homeRaf); homeRaf = null; }
  }

  // Only animate while it is on screen. A rAF loop left running behind seven other tabs is
  // pure waste, and this loop shares its thread with the control heartbeat.
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.tab === 'home') homeStart(); else homeStop();
    });
  });

  $('btn-home').addEventListener('click', () => showTab('home'));
  // Der erste Knopf verbindet direkt, statt in die Garage zu schicken: von der Startseite
  // aus ist "Auto verbinden" das, was man als erstes will, und der Bluetooth-Dialog braucht
  // ohnehin einen Klick. Danach steht das Auto in der Garage und die Seite wechselt dorthin,
  // damit man die Rolle setzen kann.
  $('home-go').addEventListener('click', async () => {
    showTab('garage');
    await garageConnect();
  });
  // Cockpit, nicht Vollbild. Vollbild ist dort in der Ecke einen Klick entfernt, und wer von
  // der Startseite kommt, will erst einmal sehen, wo er landet.
  $('home-fs').addEventListener('click', () => showTab('race'));

  // It is the landing view, so it starts running.
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


