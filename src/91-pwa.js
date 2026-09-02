  // ============================== ALS APP INSTALLIERBAR ==============================
  //
  // Rein zusaetzlich. Im Browser laeuft alles unveraendert weiter; wer nichts installiert,
  // merkt von diesem Abschnitt nichts.
  //
  // WAS ES BRINGT: Vollbild ohne Adresszeile, ein Symbol im Startmenue, und - durch den
  // Service Worker - dass die App auch ohne Netz startet. Web Bluetooth funktioniert
  // unveraendert, weil die installierte App dieselbe Herkunft behaelt wie die Seite.
  //
  // WAS ES NICHT BRINGT, und das ist der Punkt, der oft falsch erwartet wird: es loest das
  // Mehrspieler-Problem NICHT. Der secure context haengt an der Herkunft, und die ist nach
  // dem Installieren dieselbe wie vorher.

  // Der Arbeiter braucht selbst einen secure context. Von der Platte (file://) gibt es
  // keinen - dort wird nicht angemeldet, und das ist kein Mangel: von der Platte ist die App
  // ohnehin ohne Netz da. Die Abfrage ist Pflicht, denn ein Wurf im Ladepfad nimmt die ganze
  // IIFE mit, und dann fehlt OMEGA_TEST und der Selbsttest zeigt null Zeilen.
  if ('serviceWorker' in navigator && window.isSecureContext
      && location.protocol !== 'file:') {
    // Nach dem Laden anmelden und nicht davor: die Anmeldung holt Dateien, und das soll
    // nicht mit dem ersten Aufbau des Cockpits um die Leitung streiten.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
        log('Als App installierbar: Service Worker angemeldet (Bereich ' + reg.scope + ').',
            'info');
      }).catch((e) => {
        // KEIN Fehler fuer den Nutzer. Ohne Arbeiter fehlt nur der Betrieb ohne Netz; die
        // App selbst laeuft vollstaendig. Eine rote Meldung waere eine Uebertreibung.
        log('Kein Service Worker (' + (e && e.message ? e.message : e)
            + '). Die App laeuft, startet aber nicht ohne Netz.', 'info');
      });
    });
  }

  // Der Installationsknopf. Er erscheint NUR, wenn der Browser die Installation anbietet -
  // beforeinstallprompt feuert genau dann, und nur dann darf prompt() gerufen werden.
  //
  // Auf iOS feuert das Ereignis nie, dort bleibt der Knopf also weg. Das ist richtig: ohne
  // Web Bluetooth kann die App dort kein Auto fahren, und ein Knopf, der etwas verspricht,
  // was hinterher nicht geht, ist schlechter als keiner.
  {
    let angebot = null;
    const knopf = $('home-install');
    window.addEventListener('beforeinstallprompt', (e) => {
      // Die eigene Aufforderung des Browsers unterdruecken und selbst anbieten: sonst
      // erscheint sie irgendwann von sich aus, mitten im Fahren.
      e.preventDefault();
      angebot = e;
      if (knopf) knopf.hidden = false;
    });
    if (knopf) {
      knopf.addEventListener('click', async () => {
        if (!angebot) return;
        knopf.disabled = true;
        try {
          angebot.prompt();
          const { outcome } = await angebot.userChoice;
          log('Installation: ' + (outcome === 'accepted' ? 'angenommen' : 'abgelehnt')
              + '.', 'info');
        } finally {
          // Ein Angebot laesst sich nur EINMAL benutzen. Danach ist der Knopf sinnlos, und
          // ein Knopf, der nichts mehr tut, gehoert weg.
          angebot = null;
          knopf.disabled = false;
          knopf.hidden = true;
        }
      });
    }
    window.addEventListener('appinstalled', () => {
      if (knopf) knopf.hidden = true;
      log('OmegaSim ist als App installiert.', 'notify');
    });
  }
