  // ============================ INFO-POPUP FUER OPTIONEN (Phase 13) ==================
  //
  // BESTELLT: "Schiebe alle Infos zu den Optionen in ein Pop-up mit 'i' im Kreis. Wenn
  // ich drauftippe, geht das auf. Ansonsten ist es nicht sichtbar, mit Controller kann
  // ich es nicht ansteuern."
  //
  // DIE ERKLAERUNG BLEIBT IM MARKUP, wird nur versteckt und in der schon vorhandenen
  // Lightbox gezeigt (siehe lightboxOpen/lightboxClose, 94-engine-workshop.js, dort fuer
  // grosse Diagramme gebaut) - dieselbe Lightbox, nur mit Text statt einem geklonten SVG.
  // Eine zweite Kopie von 108 Erklaerungstexten irgendwo in JS waere die Gelegenheit,
  // eine Aenderung nur an einer Stelle nachzuziehen.
  //
  // EIN EIGENER ZEILENEINTRAG FUER DEN KNOPF: menuNavRows() (50b-menu-nav.js) waehlt je
  // Zeile GENAU EIN Bedienelement, mit fester Rangfolge (Kontrollkaestchen vor Regler vor
  // Auswahlfeld vor Textfeld vor Knopf) - ein Info-Knopf IN derselben Zeile waere fuer
  // die Menuenavigation nie erreichbar, weil Regler/Kontrollkaestchen immer zuerst
  // gewaehlt werden. Die Anpassung dafuer steht in menuNavRows() selbst.

  function optInfoEinrichten() {
    document.querySelectorAll('.opt-row').forEach((row) => {
      const label = row.querySelector('.opt-label');
      if (!label) return;
      // ALLE <small> eines Labels, nicht nur das erste. BESTELLT: "keinen Text unter die
      // Optionen, sondern immer hinter das i im Kreis". Beim Steuerungsmodus stand der
      // Pacejka-Absatz in einem zweiten <small> und blieb deshalb sichtbar unter der Zeile.
      const smalls = [...label.querySelectorAll('small')];
      if (!smalls.length || smalls.every((x) => x.classList.contains('opt-info-versteckt'))) return;
      const small = smalls[0];
      // Nicht ueber childNodes[0] geraten: manche Titel stecken selbst in einem <span>
      // (z.B. id="race-limit-label" fuer Werte, die JS nachfuehrt), dann ist das erste
      // Kind kein Textknoten und label.textContent haette faelschlich auch die
      // Erklaerung mitgenommen. Stattdessen ein Klon OHNE die <small> - was danach an
      // Text uebrig ist, ist der Titel, unabhaengig davon, wie er aufgebaut ist.
      const klon = label.cloneNode(true);
      klon.querySelectorAll('small').forEach((x) => x.remove());
      const titel = klon.textContent.trim();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-info-btn';
      btn.textContent = 'i';
      btn.setAttribute('aria-label', t('Erklärung anzeigen') + (titel ? ': ' + titel : ''));
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Beim Klick gelesen, nicht beim Einrichten: so steht der Text in der Sprache, die
        // gerade gilt (der Uebersetzer tauscht die Textknoten in den <small> selbst).
        optInfoOeffnen(titel, smalls.map((x) => x.innerHTML).join('<br><br>'));
      });
      label.insertBefore(btn, small);
      smalls.forEach((x) => x.classList.add('opt-info-versteckt'));
    });
  }

  function optInfoOeffnen(titel, html) {
    // lbQuelle gehoert der Diagramm-Lightbox (94-engine-workshop.js): auf null gesetzt,
    // damit ein spaeteres lightboxRefresh() (bei einem gedrehten Regler) nicht versucht,
    // ein Diagramm ueber diesen Text zu zeichnen.
    lbQuelle = null;
    $('lb-title').textContent = titel;
    $('lb-note').textContent = '';
    $('lb-body').innerHTML = '';
    const div = document.createElement('div');
    div.className = 'opt-info-text';
    div.innerHTML = html;
    $('lb-body').appendChild(div);
    const box = $('lb-wrap').querySelector('.lb-box');
    if (box) box.classList.add('lb-text');
    $('lb-wrap').classList.add('on');
  }

  // lightboxClose() raeumt .lb-body/lbQuelle schon auf; hier zusaetzlich die
  // Breitenklasse zuruecknehmen, die nur der Textfassung gehoert - ein danach
  // geoeffnetes Diagramm soll wieder seine volle Breite bekommen.
  function optInfoSchliessen() {
    const box = $('lb-wrap') && $('lb-wrap').querySelector('.lb-box');
    if (box) box.classList.remove('lb-text');
    lightboxClose();
  }

  function optInfoOffen() {
    const el = $('lb-wrap');
    return !!(el && el.classList.contains('on'));
  }

  optInfoEinrichten();

