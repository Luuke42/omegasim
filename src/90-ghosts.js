  // =========================================================================
  // Autonome Gegner, und alles was an ihnen haengt
  // =========================================================================
  // Gamepad-Belegung, die Messung der Querablage, die Ruettelerkennung, die gelbe
  // Flagge, die Rennwuerze und die Ideallinie fuer die Autos.
  //
  // Die Linie ist DIESELBE, die der Editor zeichnet. Sie war einmal doppelt und die
  // beiden Fassungen korrelierten mit r = 0.26 - wer im Editor eine Linie sieht und
  // zuschaut, wie das Auto eine andere faehrt, kann keiner von beiden trauen.

  // ---- Gamepad support with configurable bindings ----
  // Standard Gamepad API mapping (Xbox-style): axes[0]=left-stick X, buttons[6]=LT,
  // buttons[7]=RT (both report analog .value 0..1 even though they're "buttons"),
  // buttons[1]=B (right face button), buttons[2]=X (left face button).
  // Face-button indices are the same on Xbox and DualSense in the standard mapping;
  // only the printed names differ: buttons[0]=A/Cross, [1]=B/Circle, [2]=X/Square,
  // [3]=Y/Triangle. D-pad is buttons[12..15] (up/down/left/right).
  // Bumped when the default layout changes: a saved set from the old layout would keep
  // Boxenstopp on Y and collide with the headlight button that now lives there.
  const GAMEPAD_BINDINGS_KEY = 'carrera-hybrid-gamepad-bindings-v2';
  const DEFAULT_BINDINGS = {
    throttle: { type: 'button', index: 7, label: 'Rechter Trigger (R2 / RT)' },
    brake: { type: 'button', index: 6, label: 'Linker Trigger (L2 / LT)' },
    steering: { type: 'axis', index: 0, invert: false, label: 'Linker Stick (X-Achse)' },
    downshift: { type: 'button', index: 2, label: 'Quadrat (PS) / X (Xbox)' },
    upshift: { type: 'button', index: 1, label: 'Kreis (PS) / B (Xbox)' },
    headlights: { type: 'button', index: 3, label: 'Dreieck (PS) / Y (Xbox)' },
    lightflash: { type: 'button', index: 11, label: 'R3 (rechten Stick drücken)' },
    // Boxenstopp auf Start/Options, Streckenansicht auf die linke Schulter.
    //
    // Vorher war es umgekehrt, und das war eine Fehlbedienung mit Ansage: Options hat den
    // Tab gewechselt und damit das Cockpit verlassen, wo man gerade fuhr. Ein Knopf, der
    // mitten im Rennen den Bildschirm wegnimmt, gehoert nicht dorthin, wo die Hand ihn im
    // Vorbeigehen trifft - und ein Boxenstopp ist das, was man an dieser Stelle will.
    //
    // Die rechte Schulter bleibt das Rennen, die Trigger bleiben Gas und Bremse.
    pitstop: { type: 'button', index: 9, label: 'Options (PS) / Start (Xbox)' },
    // LB und RB machen jetzt die zwei Umschaltungen, die man WAEHREND der Fahrt braucht:
    // welche Kodierung gelesen wird, und ob von Hand geschaltet wird. Beide sind
    // Fahrentscheidungen und gehoeren unter die Zeigefinger.
    //
    // Rennen starten zieht dafuer um, und seit v0.5.1 auf Select: Kreuz traegt die gelbe
    // Flagge, weil "X" in PlayStation-Namen genau diese Taste ist - die alte Beschriftung
    // "X / Quadrat" war mehrdeutig und hat die Flagge auf der falschen Taste gehalten.
    //
    // Die Streckenansicht ist ab Werk UNBELEGT. Sie lag auf L3, und der linke Stick soll
    // beim Lenken nichts ausloesen; ausserdem verlaesst sie das Cockpit. Das Touchpad bleibt
    // ebenfalls frei, weil das System es als Zeiger fuehrt.
    scanmode: { type: 'button', index: 4, label: 'L1 (PS) / LB (Xbox)' },
    gearmode: { type: 'button', index: 5, label: 'R1 (PS) / RB (Xbox)' },
    // X hat ZWEI Bedeutungen: kurz ist Runterschalten, eine Sekunde gehalten die gelbe
    // Flagge - genau wie die Taste X auf der Tastatur. Das Halten ist der Schutz: die gelbe
    // Flagge bremst jedes Auto auf 40 km/h, und ein Knopf, der das mit einem Antippen tut,
    // liegt zu nah an der Hand.
    // KREUZ und nicht Quadrat. Die alte Beschriftung "X / Quadrat" war mehrdeutig: auf
    // einer Xbox ist Knopf 2 das X, auf einer PlayStation das Quadrat - und "X" bedeutet auf
    // einer PlayStation den Knopf 0. Gemeint war der PlayStation-Name.
    //
    // Damit liegt die gelbe Flagge ALLEIN auf ihrer Taste. Vorher teilte sie sich Quadrat mit
    // dem Runterschalten, unterschieden nur durch die Haltedauer - eine Taste mit zwei
    // Bedeutungen ist mitten im Rennen die falsche Sorte Ueberraschung.
    yellowflag: { type: 'button', index: 0, label: 'Kreuz (PS) / A (Xbox), 1 s halten' },
    // RENNSTART HAT AB WERK KEINE TASTE, und das ist eine Entscheidung ueber Folgen:
    // ein Rennen zu starten oder abzubrechen ist der eingreifendste Knopf der ganzen App -
    // er wirft eine laufende Wertung weg. Ein Knopf mit dieser Folge gehoert nicht dorthin,
    // wo die Hand ihn im Vorbeigehen trifft. Ueber die Oberflaeche ist er zwei Klicks weit
    // weg, und frei zuweisbar bleibt er.
    racestart: { type: 'none', index: -1, label: 'nicht belegt' },
    // Auf Select. Das Wetter umzuschalten ist harmlos und rueckgaengig machbar - genau die
    // Sorte Sache, die auf eine Menuetaste gehoert, die man beim Fahren trifft. Es hat
    // vorher der Rennstart getragen; siehe dort, warum er umgezogen ist.
    weather: { type: 'button', index: 8, label: 'Select / Share (PS) / Back (Xbox)' },
    // UNBELEGT ab Werk, ausdruecklich: der linke Stick soll nichts ausloesen, wenn man ihn
    // beim Lenken drueckt. Und die Streckenansicht verlaesst das Cockpit - genau der
    // Grund, aus dem L1 sie nicht mehr traegt.
    trackview: { type: 'none', index: -1, label: 'nicht belegt' },
    // Nicht belegt. Das Touchpad wird vom System als Zeiger erkannt, also loest ein Tippen
    // gleichzeitig einen Klick irgendwo in der Seite aus - eine Belegung darauf kaempft mit
    // dem Cursor. Frei zuweisbar bleibt es, nur eben nicht ab Werk.
    resetcar: { type: 'none', index: -1, label: 'nicht belegt' },
  };
  const BIND_ACTION_LABELS = {
    throttle: 'Gas', brake: 'Bremse', steering: 'Lenkung',
    downshift: 'Runterschalten', upshift: 'Hochschalten',
    headlights: 'Licht an/aus', lightflash: 'Lichthupe', pitstop: 'Boxenstopp',
    racestart: 'Rennen starten / abbrechen',
    scanmode: 'Leseart: Bahn oder Ausdruck',
    gearmode: 'Getriebe: Automatik oder von Hand',
    yellowflag: 'Gelbe Flagge (1 s halten)',
    weather: 'Wetter umschalten',
    trackview: 'Streckenansicht',
    resetcar: 'Auto zurücksetzen',
  };

  // Boxenstopp und Streckenansicht haben die Knoepfe getauscht. Gespeichertes liegt UEBER
  // der Vorgabe, eine neue Vorgabe kommt also bei niemandem an, der schon gefahren ist.
  //
  // Getauscht wird deshalb beim Laden, aber NUR wenn beide noch genau auf den alten
  // Vorgaben stehen (Boxenstopp auf 4, Streckenansicht auf 9). Dann hat sie niemand
  // angefasst und das Tauschen ist gefahrlos. Wer selbst zugewiesen hat, behaelt seine
  // Zuweisung - den Speicherschluessel zu erhoehen waere billiger gewesen und haette jede
  // eigene Zuweisung weggeworfen.
  function migrateBindings(b) {
    const ist = (x, i) => x && x.type === 'button' && x.index === i;
    if (ist(b.pitstop, 4) && ist(b.trackview, 9)) {
      b.pitstop = { ...DEFAULT_BINDINGS.pitstop };
      b.trackview = { ...DEFAULT_BINDINGS.trackview };
      b.__migrated = true;
    }
    // v0.5: LB und RB werden Leseart und Getriebe. Verschoben wird nur, wenn Rennstart und
    // Streckenansicht noch genau auf den ALTEN Vorgaben liegen (RB=5 und LB=4) - dann hat
    // sie niemand angefasst. Wer selbst zugewiesen hat, behaelt seine Zuweisung; die drei
    // neuen Aktionen bekommt er trotzdem, weil loadBindings die Vorgaben untermischt.
    if (ist(b.racestart, 5) && ist(b.trackview, 4)) {
      b.racestart = { ...DEFAULT_BINDINGS.racestart };
      b.trackview = { ...DEFAULT_BINDINGS.trackview };
      b.__migrated2 = true;
    }
    // v0.5.1: gelbe Flagge auf Kreuz, Rennstart auf Select, Streckenansicht und Wetter
    // unbelegt. JE AKTION UNABHAENGIG und nicht gekoppelt - die gekoppelte Fassung darueber
    // ist zweimal danebengegangen, und genau daran lag, dass L1 zwei Bedeutungen hatte: wer
    // trackview gespeichert hatte und racestart nicht, wurde von ihr nicht erfasst.
    //
    // Verschoben wird nur, wer noch auf SEINER alten Vorgabe liegt. Wer selbst zugewiesen
    // hat, behaelt seine Zuweisung, und der Kollisionsaufloeser faengt, was dabei doppelt
    // liegen bleibt.
    const ALT = { yellowflag: 2, racestart: 0, trackview: 10, weather: 8 };
    for (const n of Object.keys(ALT)) {
      if (ist(b[n], ALT[n])) {
        b[n] = { ...DEFAULT_BINDINGS[n] };
        b.__migrated3 = true;
      }
    }
    // v0.4.50: Select traegt das Wetter, Rennstart bekommt ab Werk keine Taste.
    //
    // JE AKTION UNABHAENGIG, wie darueber, und aus demselben Grund: die gekoppelte Fassung
    // ist in diesem Projekt zweimal danebengegangen. Wer racestart noch auf Select hat, wird
    // entlastet; wer weather selbst zugewiesen hat, behaelt es.
    //
    // Die Reihenfolge ist wichtig: ZUERST racestart raeumen, DANN weather setzen. Anders
    // herum liegen beide einen Moment auf Knopf 8, und der Kollisionsaufloeser wuerde eines
    // von beiden verschieben - ausgerechnet das, was gerade richtig gesetzt wurde.
    if (ist(b.racestart, 8)) {
      b.racestart = { ...DEFAULT_BINDINGS.racestart };
      b.__migrated4 = true;
    }
    if (b.weather && b.weather.type === 'none' && b.__migrated4) {
      b.weather = { ...DEFAULT_BINDINGS.weather };
    }
    return b;
  }

  // Der Fingerabdruck eines Eingangs: Art und Nummer. Die Achsenrichtung gehoert NICHT dazu -
  // zwei Aktionen auf derselben Achse mit verschiedenem Vorzeichen sind trotzdem dieselbe
  // Achse und stoeren sich.
  function bindingKey(x) {
    // type 'none' ist KEIN Eingang. Ohne diese Zeile kollidieren zwei unbelegte Aktionen
    // miteinander, und die zweite wuerde "aufgeloest" - eine Kollision, die es nicht gibt.
    if (!x || x.type === undefined || x.type === 'none') return null;
    return x.type + ':' + x.index;
  }

  // KOLLISIONEN AUFLOESEN, allgemein statt Fall fuer Fall.
  //
  // Der Anlass: LB schaltete die Leseart UND die Streckenansicht, und letztere verlaesst das
  // Cockpit und damit das Vollbild. Die Ursache war eine Migration, die nur greift, wenn
  // ZWEI Belegungen zugleich noch auf ihren alten Vorgaben liegen - wer in v0.4 gefahren ist,
  // hatte trackview gespeichert und racestart nicht, also lief sie nicht.
  //
  // Eine dritte Bedingung waere die Gelegenheit fuer den naechsten Fall. Hier gewinnt
  // stattdessen, wer auf seiner EIGENEN Vorgabe liegt; alle anderen auf demselben Eingang
  // gehen auf ihre Vorgabe zurueck. Damit ist es unerheblich, welcher Pfad die Kollision
  // erzeugt hat.
  //
  // Gemeldet wird sie, nicht still behoben: ein Knopf, der heimlich seine Bedeutung
  // wechselt, ist der naechste Fehlerbericht.
  function resolveBindingCollisions(b) {
    const namen = Object.keys(DEFAULT_BINDINGS);
    // Eingang -> Liste der Aktionen, die dort liegen.
    const belegt = new Map();
    const dazu = (k, n) => {
      if (!belegt.has(k)) belegt.set(k, []);
      belegt.get(k).push(n);
    };
    const bericht = [];

    // ERSTER DURCHGANG: wer auf seiner EIGENEN Vorgabe liegt, bekommt den Platz - und zwar
    // ohne Kollisionspruefung untereinander.
    //
    // Das ist der Punkt, an dem mein erster Anlauf falsch war: X traegt ab Werk ABSICHTLICH
    // zwei Aktionen, Runterschalten beim Tippen und die gelbe Flagge beim Halten. Ein
    // Aufloeser, der stur Kollisionen bricht, hat mir dort das Runterschalten freigegeben -
    // eine Verschlechterung, die als Aufraeumen aussah. Was in den Vorgaben zusammenliegt,
    // ist eine Entscheidung und kein Versehen.
    for (const n of namen) {
      const k = bindingKey(b[n]);
      if (k && k === bindingKey(DEFAULT_BINDINGS[n])) dazu(k, n);
    }

    // ZWEITER DURCHGANG: alle anderen. Wer auf einen schon belegten Eingang zeigt, geht auf
    // seine eigene Vorgabe zurueck; ist die auch besetzt, wird er freigegeben statt still auf
    // einem doppelten Knopf zu liegen.
    for (const n of namen) {
      const k = bindingKey(b[n]);
      if (!k) continue;
      const dort = belegt.get(k) || [];
      if (dort.includes(n)) continue;          // im ersten Durchgang platziert
      if (!dort.length) { dazu(k, n); continue; }
      const vorher = (b[n] && b[n].label) || k;
      const mit = dort.map(x => BIND_ACTION_LABELS[x] || x).join(' und ');
      const vk = bindingKey(DEFAULT_BINDINGS[n]);
      if (vk && !(belegt.get(vk) || []).length) {
        b[n] = { ...DEFAULT_BINDINGS[n] };
        dazu(vk, n);
        bericht.push((BIND_ACTION_LABELS[n] || n) + ': lag auf ' + vorher + ' zusammen mit '
                     + mit + ', zurueck auf ' + b[n].label);
      } else {
        // Unbelegt heisst type 'none' und nicht null - dieselbe Form wie resetcar ab Werk,
        // damit die Tabelle in den Optionen sie darstellen kann.
        b[n] = { type: 'none', index: -1, label: 'nicht belegt' };
        bericht.push((BIND_ACTION_LABELS[n] || n) + ': lag auf ' + vorher + ' zusammen mit '
                     + mit + ', jetzt unbelegt - bitte neu zuweisen');
      }
    }
    if (bericht.length) b.__kollisionen = bericht;
    return b;
  }

  function loadBindings() {
    try {
      const saved = JSON.parse(localStorage.getItem(GAMEPAD_BINDINGS_KEY) || 'null');
      if (!saved) return { ...DEFAULT_BINDINGS };
      return resolveBindingCollisions(migrateBindings({ ...DEFAULT_BINDINGS, ...saved }));
    } catch { return { ...DEFAULT_BINDINGS }; }
  }
  function saveBindings() { localStorage.setItem(GAMEPAD_BINDINGS_KEY, JSON.stringify(bindings)); }

  let bindings = loadBindings();
  if (bindings.__kollisionen) {
    for (const zeile of bindings.__kollisionen) log('Controller: ' + zeile, 'notify');
    delete bindings.__kollisionen;
    saveBindings();
  }
  if (bindings.__migrated3) {
    delete bindings.__migrated3;
    saveBindings();
    log('Controller: gelbe Flagge liegt jetzt auf Kreuz (PS) bzw. A (Xbox), Rennstart auf '
        + 'Select. Streckenansicht und Wetter sind ab Werk unbelegt - der linke Stick soll '
        + 'beim Lenken nichts ausloesen.', 'info');
  }
  if (bindings.__migrated) {
    delete bindings.__migrated;
    saveBindings();
    log('Controller: Boxenstopp liegt jetzt auf Start/Options, Streckenansicht auf LB/L1. '
        + 'Options hat vorher den Tab gewechselt und damit das Cockpit verlassen.', 'info');
  }
  if (bindings.__migrated2) {
    delete bindings.__migrated2;
    saveBindings();
    log('Controller: LB schaltet jetzt die Leseart (Bahn/Ausdruck), RB das Getriebe '
        + '(Automatik/von Hand). Rennen starten liegt auf A/Kreuz, Streckenansicht auf L3. '
        + 'X eine Sekunde halten gibt die gelbe Flagge.', 'info');
  }
  let listeningFor = null; // action key currently waiting for a new input, or null
  let padConnected = false;
  let prevDownshift = false, prevUpshift = false, prevHeadlights = false;
  // Die drei neuen Aktionen. padFlagFired merkt sich, dass die Sekunde in DIESEM Druck schon
  // voll war - ohne das wuerde die Flagge im Takt danach gleich wieder umgeschaltet.
  let prevScanMode = false, prevGearMode = false, prevYellowFlag = false;
  let padFlagFired = false;

  function bindingDescription(b) {
    if (b.label) return b.label;
    return b.type === 'axis' ? `Achse ${b.index}${b.invert ? ' (invertiert)' : ''}` : `Knopf ${b.index}`;
  }

  // ---- Die Controller-Grafik unter dem Cockpit --------------------------------------
  //
  // DIE ZUORDNUNG LAEUFT UMGEKEHRT zur Bindungstabelle. Die Tabelle sagt "Aktion -> Taste"
  // und kann nachschlagen; die Grafik braucht "Taste -> Aktion" und muss deshalb SUCHEN.
  // Das ist kein Umstand, sondern der Grund, warum es ueberhaupt eine eigene Funktion gibt:
  // eine Taste kann ZWEI Aktionen tragen, und eine Nachschlagetabelle koennte das nicht
  // zeigen.
  //
  // Die Indizes sind die des Standard-Gamepad-Bilds, also dieselben, aus denen die
  // Bindungen bestehen - hier wird nichts umgerechnet, nur benannt. Vertippt man sich, zeigt
  // die Zeile "nicht belegt", und der Selbsttest meldet es.
  const PAD_CONTROLS = [
    { id: 'cross', typ: 'button', index: 0 },   // Kreuz / A
    { id: 'circ', typ: 'button', index: 1 },    // Kreis / B
    { id: 'sq', typ: 'button', index: 2 },      // Quadrat / X
    { id: 'tri', typ: 'button', index: 3 },     // Dreieck / Y
    { id: 'l1', typ: 'button', index: 4 },
    { id: 'r1', typ: 'button', index: 5 },
    { id: 'l2', typ: 'button', index: 6 },
    { id: 'r2', typ: 'button', index: 7 },
    { id: 'select', typ: 'button', index: 8 },  // Select / Share / Back
    { id: 'options', typ: 'button', index: 9 },
    { id: 'l3', typ: 'button', index: 10 },
    { id: 'r3', typ: 'button', index: 11 },
    { id: 'dup', typ: 'button', index: 12 },
    { id: 'ddown', typ: 'button', index: 13 },
    { id: 'dleft', typ: 'button', index: 14 },
    { id: 'dright', typ: 'button', index: 15 },
    { id: 'ps', typ: 'button', index: 16 },
    { id: 'touchpad', typ: 'button', index: 17 },
    // Die Stickachsen. Nur die X-Achsen: die Lenkung liegt auf einer davon, und eine Zeile
    // je Achse waere vier Zeilen fuer zwei Bedienelemente.
    { id: 'lstick', typ: 'axis', index: 0 },
    { id: 'rstick', typ: 'axis', index: 2 },
  ];

  // FESTVERDRAHTETE BELEGUNGEN, die NICHT durch die Bindungstabelle laufen.
  //
  // Sie waeren in der Grafik als "nicht belegt" erschienen, und das ist schlicht falsch: das
  // Steuerkreuz verstellt Bremsbalance und Lenkansprechen im Fahren. Eine Grafik, die eine
  // belegte Taste als frei zeigt, ist schlechter als keine - man probiert dann im Rennen
  // aus, was sie tut.
  //
  // Frei zuweisbar sind sie nicht, deshalb stehen sie hier und nicht in DEFAULT_BINDINGS.
  // Und sie sind nicht ausschliesslich: im Streckeneditor und bei scharfem Boxenstopp
  // greifen erst diese zwei ab (siehe pollGamepad), danach gilt wieder das hier.
  const PAD_FIXED = {
    dup: 'Bremsbalance nach vorn',
    ddown: 'Bremsbalance nach hinten',
    dleft: 'Lenkansprechen kleiner',
    dright: 'Lenkansprechen größer',
  };

  function padDiagramRender() {
    if (!document.getElementById('pad-a-cross')) return;   // Karte nicht im Dokument
    for (const c of PAD_CONTROLS) {
      const el = document.getElementById('pad-a-' + c.id);
      if (!el) continue;
      // Alle Aktionen, die auf diesem Bedienelement liegen. Mehrzahl mit Absicht: eine
      // Doppelbelegung ist erlaubt und soll sichtbar sein, nicht verschwiegen.
      const treffer = Object.keys(BIND_ACTION_LABELS).filter((a) => {
        const b = bindings[a];
        return b && b.type === c.typ && b.index === c.index;
      });
      // Durch t(), weil der Text hier ENTSTEHT und nicht im Markup steht - der
      // Textknoten-Uebersetzer findet nur, was in der Vorlage liegt.
      // Reihenfolge: zugewiesen schlaegt festverdrahtet schlaegt frei. Wer eine Aktion auf
      // das Steuerkreuz legt, soll SIE sehen und nicht die Werksfunktion darunter.
      const fest = PAD_FIXED[c.id];
      el.textContent = treffer.length
        ? treffer.map((a) => t(BIND_ACTION_LABELS[a])).join(' + ')
        : (fest ? t(fest) : t('nicht belegt'));
      el.classList.toggle('pad-frei', !treffer.length && !fest);
      el.classList.toggle('pad-fest', !treffer.length && !!fest);
    }
  }

  // Beim Sprachwechsel neu zeichnen. Ohne diese Anmeldung bliebe die Grafik in der Sprache
  // stehen, in der sie zuletzt gezeichnet wurde - genau der Fall, fuer den die Anmeldung
  // gebaut wurde.
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(padDiagramRender);

  function renderBindTable() {
    // Die Grafik zieht hier mit. renderBindTable() ist die EINE Stelle, die nach jeder
    // Zuweisung laeuft; sie an sieben Aufrufstellen einzeln nachzuziehen waere die
    // Gelegenheit, eine zu vergessen.
    padDiagramRender();
    const body = $('bind-table-body');
    body.innerHTML = '';
    Object.keys(BIND_ACTION_LABELS).forEach(action => {
      const tr = document.createElement('tr');
      const listening = listeningFor === action;
      tr.innerHTML = `
        <td>${BIND_ACTION_LABELS[action]}</td>
        <td><span class="bind-value${listening ? ' bind-listening' : ''}">${listening ? 'Eingabe erwartet…' : bindingDescription(bindings[action])}</span></td>
        <td><button data-action="${action}" ${listening ? 'disabled' : ''}>Neu zuweisen</button></td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = () => {
        listeningFor = btn.dataset.action;
        // Die Ruhelage wird beim naechsten Takt frisch genommen, nicht jetzt: jetzt haelt
        // die Hand noch die Maus, und der Knueppel steht vielleicht noch nicht in Ruhe.
        bindRuhe = null;
        renderBindTable();
      };
    });
  }
  renderBindTable();
  // Hier stand der Aufruf von renderHelpPad(): die Controller-Belegung ein zweites Mal, nur
  // lesbar. Sie war doppelt - die zuweisbare Tabelle in derselben Karte zeigt dasselbe und
  // kann es aendern. Die Funktion ist mit weg; eine ohne Aufrufstelle ist dieselbe
  // Fehlerklasse wie eine tote Element-id.

  $('bind-reset').onclick = () => {
    bindings = { ...DEFAULT_BINDINGS };
    saveBindings();
    renderBindTable();
    log('Tastenbelegung auf Standard zurückgesetzt.', 'info');
  };

  const AXIS_CAPTURE_THRESHOLD = 0.6;
  const BUTTON_CAPTURE_THRESHOLD = 0.5;
  const DEADZONE = 0.12;

  const TRIGGER_DEADZONE = 0.06; // a slightly drifting trigger shouldn't creep the car

  // Rescale rather than hard-cut, so leaving the deadzone eases in from 0 instead of
  // jumping straight to 0.12 — the hard cut made small steering corrections feel notchy.
  function applyDeadzone(v, dz = DEADZONE) {
    const mag = Math.abs(v);
    if (mag < dz) return 0;
    return Math.sign(v) * ((mag - dz) / (1 - dz));
  }

  // Die Ruhelage beim Druck auf "zuordnen". Ohne sie misst die Erfassung den BETRAG,
  // und das ist die Annahme "Achsen ruhen bei null" - die fuer Gamepads stimmt und fuer
  // RC-Fernbedienungen falsch ist.
  let bindRuhe = null;

  function bindRuheNehmen(pad) {
    bindRuhe = {
      achsen: Array.prototype.slice.call(pad.axes || []),
      knoepfe: Array.prototype.map.call(pad.buttons || [],
                                        (b) => (b.value !== undefined ? b.value : (b.pressed ? 1 : 0))),
    };
  }

  // ---- Erfassen, was sich am WEITESTEN von seiner Ruhelage entfernt hat ---------------
  //
  // Nicht "die erste Achse ueber einem Betrag", sondern die groesste AENDERUNG. Das ist
  // der Unterschied, an dem eine RC-Fernbedienung haengt: ihr Gasknueppel rastet unten und
  // meldet dauerhaft -1, und nicht belegte Achsen melden bei vielen HID-Adaptern konstant
  // -1 statt 0. Mit dem Betrag rastet die Erfassung sofort auf so eine Achse ein, ohne dass
  // jemand etwas bewegt hat.
  //
  // Und es wird das MAXIMUM ueber alle Kanaele genommen und nicht der erste Treffer: an
  // einem Knueppel bewegen sich oft zwei Achsen mit, und der Kanal, der wirklich gemeint
  // ist, ist der mit dem groessten Ausschlag - nicht der mit dem kleinsten Index.
  function tryCaptureBinding(pad) {
    if (!listeningFor) return;
    const action = listeningFor;
    if (!bindRuhe) { bindRuheNehmen(pad); return; }
    let bester = null;
    for (let i = 0; i < pad.axes.length; i++) {
      const ruhe = bindRuhe.achsen[i] === undefined ? 0 : bindRuhe.achsen[i];
      const d = Math.abs(pad.axes[i] - ruhe);
      if (d > AXIS_CAPTURE_THRESHOLD && (!bester || d > bester.d)) {
        bester = { d, art: 'axis', i, ruhe, jetzt: pad.axes[i] };
      }
    }
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const v = b.value !== undefined ? b.value : (b.pressed ? 1 : 0);
      const ruhe = bindRuhe.knoepfe[i] === undefined ? 0 : bindRuhe.knoepfe[i];
      const d = Math.abs(v - ruhe);
      // Ein Knopf schlaegt eine Achse bei gleichem Ausschlag: er ist eindeutiger, und ein
      // Knopfdruck bewegt an manchen Pads eine Hat-Achse mit.
      if (d > BUTTON_CAPTURE_THRESHOLD && (!bester || d > bester.d + 0.001)) {
        bester = { d, art: 'button', i };
      }
    }
    if (!bester) return;
    if (bester.art === 'axis') {
      // Die Richtung: hat sich die Achse nach unten bewegt, ist sie invertiert. Gemessen
      // wird gegen die RUHELAGE und nicht gegen null.
      const invert = bester.jetzt < bester.ruhe;
      bindings[action] = {
        type: 'axis', index: bester.i, invert,
        // Die gelernte Spanne, siehe achsWert(). Sie startet an dem, was bisher gesehen
        // wurde, und waechst mit jeder Bewegung.
        ruhe: bester.ruhe,
        min: Math.min(bester.ruhe, bester.jetzt),
        max: Math.max(bester.ruhe, bester.jetzt),
        label: `Achse ${bester.i}${invert ? ' (invertiert)' : ''}`,
      };
      log(`Zuordnung gesetzt: ${BIND_ACTION_LABELS[action]} -> Achse ${bester.i}`
          + ` (Ruhe ${bester.ruhe.toFixed(2)}, Ausschlag ${bester.d.toFixed(2)})`, 'info');
    } else {
      bindings[action] = { type: 'button', index: bester.i, label: `Knopf ${bester.i}` };
      log(`Zuordnung gesetzt: ${BIND_ACTION_LABELS[action]} -> Knopf ${bester.i}`, 'info');
    }
    saveBindings();
    listeningFor = null;
    bindRuhe = null;
    renderBindTable();
  }

  // ---- Eine Achse auf ihre gelernte Spanne umrechnen ----------------------------------
  //
  // Ein RC-Gaskanal laeuft von -1 bis +1 und rastet unten. Roh gelesen und mit
  // Math.max(0, ...) beschnitten bekaeme man nur die obere Haelfte - "es geht, aber nur
  // halb", und genau so wurde es gemeldet.
  //
  // Die Spanne WAECHST nur. Sie nie zu schrumpfen ist Absicht: ein Knueppel, der einmal
  // ganz ausgeschlagen war, kann das wieder, und ein Zittern in der Mitte duerfte die
  // Spanne sonst zusammenziehen und den Ausschlag kuenstlich vergroessern.
  function achsWert(binding, roh) {
    if (binding.min === undefined || binding.max === undefined) return roh;
    if (roh < binding.min) binding.min = roh;
    if (roh > binding.max) binding.max = roh;
    const spanne = binding.max - binding.min;
    // Unter einem Zehntel ist noch nichts gelernt: dann lieber roh als eine Spreizung um
    // den Faktor zwanzig, die aus Rauschen Vollgas macht.
    if (spanne < 0.1) return roh;
    // Auf -1..+1, mit der Ruhelage als Null. Wer die Ruhelage am Rand hat (ein rastender
    // Gaskanal), bekommt damit von der Ruhe aus den vollen Weg nach einer Seite.
    const ruhe = binding.ruhe === undefined ? (binding.min + binding.max) / 2 : binding.ruhe;
    const weg = roh - ruhe;
    const nachOben = Math.max(0.05, binding.max - ruhe);
    const nachUnten = Math.max(0.05, ruhe - binding.min);
    return Math.max(-1, Math.min(1, weg >= 0 ? weg / nachOben : weg / nachUnten));
  }

  function readBindingValue(pad, binding) {
    if (!binding) return 0;
    if (binding.type === 'axis') {
      const raw = pad.axes[binding.index] ?? 0;
      const v = achsWert(binding, raw);
      return binding.invert ? -v : v;
    }
    const btn = pad.buttons[binding.index];
    if (!btn) return 0;
    return btn.value ?? (btn.pressed ? 1 : 0);
  }

  // Gamepad sampling MUST run on requestAnimationFrame. Chrome refreshes the gamepad
  // snapshot as part of the frame lifecycle, so a decoupled setInterval reads the same
  // snapshot twice or skips one at random — which showed up as the stick and triggers
  // visibly twitching back and forth instead of holding a steady value.
  //
  // rAF is suspended while the page isn't composited, so padLastPollTime + the watchdog
  // in controlHeartbeat() take over that safety job: if sampling stalls, the controller's
  // inputs are treated as released rather than frozen at their last value (otherwise the
  // heartbeat would happily keep re-sending full throttle after you tab away).
  let padLoopRunning = false;
  let padLoopPending = false;
  let padLastPollTime = 0;
  const PAD_STALE_MS = 400;
  function startPadLoop() {
    if (padLoopRunning) return;
    padLoopRunning = true;
    padLastPollTime = performance.now();
    schedulePadTick();
  }
  // padLoopPending keeps exactly one frame in flight, so re-arming from the watchdog can
  // never stack up several concurrent loops (which would double the poll rate).
  function schedulePadTick() {
    if (padLoopPending) return;
    padLoopPending = true;
    requestAnimationFrame(padLoopTick);
  }
  function padLoopTick() {
    padLoopPending = false;
    if (!padLoopRunning) return;
    pollGamepad();
    schedulePadTick();
  }

  window.addEventListener('gamepadconnected', (e) => {
    padConnected = true;
    $('pad-dot').classList.add('on');
    $('pad-status-text').textContent = `Verbunden: ${e.gamepad.id}`;
    log(`Gamepad verbunden: ${e.gamepad.id}`, 'info');
    startPadLoop();
  });
  window.addEventListener('gamepaddisconnected', () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    padConnected = Array.from(pads).some(p => p);
    if (!padConnected) {
      $('pad-dot').classList.remove('on');
      $('pad-status-text').textContent = 'kein Controller erkannt';
    }
  });

  // D-pad live tuning (standard mapping): up/down = acceleration factor,
  // left/right = steering damping (left = direct, right = sluggish).
  const DPAD = { up: 12, down: 13, left: 14, right: 15 };
  const prevDpad = { up: false, down: false, left: false, right: false };
  let prevLightFlash = false, prevPitstop = false, prevWeather = false;
  let prevRaceStart = false, prevTrackView = false, prevResetCar = false;

  function padButtonPressed(pad, index) {
    const btn = pad.buttons[index];
    if (!btn) return false;
    return (btn.value ?? (btn.pressed ? 1 : 0)) > BUTTON_CAPTURE_THRESHOLD;
  }

  // Das Steuerkreuz kommt NICHT auf allen Pads als Knopf. Im Standard-Mapping sind es die
  // Knoepfe 12 bis 15, aber viele Pads melden es als Hat-Achse - und dann war es hier
  // unsichtbar, obwohl Trigger und Knoepfe einwandfrei liefen. Genau dazu passt die
  // Beobachtung "Gamepad im Menue geht nicht, Fahren geht".
  //
  // Also beides: erst die Knoepfe, dann als Rueckfall die Achsen ab Index 4 - die Achsen 0
  // bis 3 sind die beiden Sticks und duerfen das Kreuz nicht ausloesen.
  const DPAD_AXIS_THRESHOLD = 0.6;
  function padDpad(pad, dir) {
    if (padButtonPressed(pad, DPAD[dir])) return true;
    const ax = pad.axes || [];
    for (let i = 4; i + 1 < ax.length; i += 2) {
      const x = ax[i] || 0, y = ax[i + 1] || 0;
      if (dir === 'left' && x < -DPAD_AXIS_THRESHOLD) return true;
      if (dir === 'right' && x > DPAD_AXIS_THRESHOLD) return true;
      if (dir === 'up' && y < -DPAD_AXIS_THRESHOLD) return true;
      if (dir === 'down' && y > DPAD_AXIS_THRESHOLD) return true;
    }
    return false;
  }

  // Hoch/runter auf dem Steuerkreuz ist die BREMSBALANCE. Vorher war es der
  // Beschleunigungsfaktor, und der ist eine Feinabstimmung, die man einmal setzt und stehen
  // laesst. Die Balance ist die Groesse, die ein Fahrer WAEHREND der Fahrt nachzieht - dafuer
  // hat ein GT3 einen Drehregler am Lenkrad.
  //
  // Der Weg geht ueber das Bedienelement und sein Ereignis, nicht direkt in die
  // Konfiguration: dann zieht die Anzeige in den Optionen von selbst nach, und es gibt
  // keinen zweiten Zustand.
  function nudgeBrakeBias(delta) {
    const input = $('setting-brakebias');
    if (!input) return;
    const v = Math.max(+input.min, Math.min(+input.max, parseInt(input.value, 10) + delta));
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    showHudToast(`Bremsbalance ${v}% vorn`);
  }

  function nudgeSteerResponse(delta) {
    // Keep the options slider in step, otherwise menu and controller drift apart.
    const input = $('phys-steerresp');
    const v = Math.round(Math.max(0.5, Math.min(3, parseFloat(input.value) + delta)) * 10) / 10;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    showHudToast(`Lenkansprechen ${steerRespPct(v)}%`);
  }


  // ================= Garage: several cars, and what each one does =================
  // Deliberately asymmetric. The PLAYER car keeps the whole existing path — sendControlValue,
  // the single 45 ms heartbeat, the options UI, the HUD — because that state lives in ~20
  // module variables with over a hundred references, and moving it into a vehicle object
  // would touch every one of them. Ghosts are objects with their own connection, their own
  // write lock and their own physics instance, which is far less code than the refactor
  // would have been.
  const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

  const garage = [];        // every connected car, in connection order
  let playerCar = null;     // the one the gamepad drives; sendControlValue writes here

  // ---------------------------------------------------------------- Kennung je Auto
  //
  // Reihenfolge wie gewuenscht, vergeben in der Reihenfolge des Verbindens. Die Werte sind
  // absichtlich kraeftig und nicht "echte" Autofarben: sie sollen sich auf einem dunklen
  // Schirm und auf einem Wohnzimmertisch unterscheiden, nicht schoen sein. Schwarz und
  // Weiss tragen je eine eigene Schriftfarbe mit, sonst waere der Buchstabe im Klecks
  // unlesbar - und eine Kennung, die man nicht liest, ist keine.
  const CAR_COLORS = [
    { id: 'weiss',   name: 'Wei\u00df',  hex: '#f2f4f8', ink: '#14161c' },
    { id: 'schwarz', name: 'Schwarz',    hex: '#15171c', ink: '#f2f4f8' },
    { id: 'rot',     name: 'Rot',        hex: '#e23b3b', ink: '#ffffff' },
    { id: 'blau',    name: 'Blau',       hex: '#3b7fe2', ink: '#ffffff' },
    { id: 'gruen',   name: 'Gr\u00fcn',  hex: '#35b45a', ink: '#0d1015' },
    { id: 'gelb',    name: 'Gelb',       hex: '#e8c72a', ink: '#14161c' },
    { id: 'lila',    name: 'Lila',       hex: '#9b5de5', ink: '#ffffff' },
    { id: 'orange',  name: 'Orange',     hex: '#f08a24', ink: '#14161c' },
  ];
  // Ausgeschrieben, nicht als Zeichen: "Alpha" liest sich in einer Ergebnisliste, ein
  // einzelnes Alpha sieht dort nach einem Tippfehler aus. Das Zeichen steht im Farbklecks,
  // wo der Platz fuer ein Wort fehlt. Zwoelf, weil acht Farben plus Doppelbelegung.
  const CAR_TAGS = [
    { wort: 'Alpha', zeichen: '\u03b1' }, { wort: 'Beta', zeichen: '\u03b2' },
    { wort: 'Gamma', zeichen: '\u03b3' }, { wort: 'Delta', zeichen: '\u03b4' },
    { wort: 'Epsilon', zeichen: '\u03b5' }, { wort: 'Zeta', zeichen: '\u03b6' },
    { wort: 'Eta', zeichen: '\u03b7' }, { wort: 'Theta', zeichen: '\u03b8' },
    { wort: 'Iota', zeichen: '\u03b9' }, { wort: 'Kappa', zeichen: '\u03ba' },
    { wort: 'Lambda', zeichen: '\u03bb' }, { wort: 'My', zeichen: '\u03bc' },
  ];
  const CAR_STORE = 'chc.cars.v1';

  function carStore() {
    try { return JSON.parse(localStorage.getItem(CAR_STORE) || '{}'); }
    catch (e) { return {}; }
  }
  // Gemerkt wird je GERAET, nicht je Platz in der Liste: verbindet man in anderer
  // Reihenfolge, soll dasselbe Auto dieselbe Farbe und denselben Namen haben. Eine
  // Rennaufstellung einmal einzutragen und dann durch eine Funkstoerung zu verlieren waere
  // genau das, was diese Kennung verhindern soll.
  function carRemember(car) {
    const all = carStore();
    all[String(car.device.id)] = { color: car.colorId, alias: car.alias || '' };
    try { localStorage.setItem(CAR_STORE, JSON.stringify(all)); } catch (e) { /* privat */ }
  }

  // Farbe fuer ein neu verbundenes Auto. Gemerktes hat Vorrang, sonst die naechste noch
  // freie Farbe der Reihe - zwei Autos in derselben Farbe waeren keine Zuordnung.
  function carAssign(car) {
    const merk = carStore()[String(car.device.id)] || {};
    const belegt = new Set(garage.filter(c => c !== car).map(c => c.colorId));
    car.colorId = (merk.color && CAR_COLORS.some(c => c.id === merk.color)
                   && !belegt.has(merk.color))
      ? merk.color
      : (CAR_COLORS.find(c => !belegt.has(c.id)) || CAR_COLORS[0]).id;
    car.alias = merk.alias || '';
    carRetag();
  }

  // Der Buchstabe folgt der Position in der Garage und wird deshalb NICHT gespeichert: er
  // ist die Reihenfolge des Verbindens, keine Eigenschaft des Autos. Trennt man eines aus
  // der Mitte, ruecken die dahinter auf.
  function carRetag() {
    garage.forEach((c, i) => {
      const t = CAR_TAGS[i] || { wort: 'Auto ' + (i + 1), zeichen: String(i + 1) };
      c.tag = t.wort;
      c.tagChar = t.zeichen;
    });
  }

  function carColor(car) {
    return CAR_COLORS.find(c => c.id === car.colorId) || CAR_COLORS[0];
  }

  // Der eine Name, den die ganze App benutzt - 23 Aufrufstellen haengen daran.
  // Reihenfolge mit Absicht: der eingetragene Name schlaegt alles, dann der griechische
  // Buchstabe, und erst wenn beides fehlt der BLE-Geraetename. Vorher stand der Geraetename
  // vorn, und in einer Rundenuebersicht sagte "Auto a1b2c3" nichts darueber, welches Auto
  // auf dem Tisch das war.
  function garageLabel(car) {
    if (car.alias) return car.alias;
    if (car.tag) return car.tag;
    return car.device.name || ('Auto ' + String(car.device.id).slice(0, 6));
  }

  // Farbpunkt fuer Listen, in denen die Farbe nur Anzeige und nicht Bedienung ist.
  function carDot(car) {
    if (!car || !car.device) return '';
    return '<span class="car-dot" style="background:' + carColor(car).hex + '"></span>';
  }

  // One write path for every non-player purpose: ghost driving and the identify blink.
  // Same single-writer discipline as the player car, just per car.
  // ---- Messung der Querablage ----
  // Eigener Sendetakt, absichtlich neben dem Ghost-Fahrer: der regelt Tempo und Linie, und
  // beides wuerde die Messung verwischen. Hier geht fuer die Dauer einer Stufe genau ein
  // Wertepaar hinaus - festes Gas, fester Lenkanteil - damit der einzige Unterschied
  // zwischen zwei Stufen der Lenkanteil ist.
  const lat = { on: false, car: null, steer: 0, dir: 1, timer: null, stepAt: 0,
                tiles: 0, lastCount: null, step: 0, rows: [] };

  // Der Deckel, wie er GERADE gilt, und woher er kommt. Ohne diese Anzeige ist nach einer
  // Messung nicht zu sehen, dass sie etwas geaendert hat - und dann wirkt sie wie eine
  // Fleissaufgabe ohne Folge.
  function latCapRender() {
    const el = $('lat-cap');
    if (!el) return;
    const cap = learnSteerCap();
    el.textContent = cap.toFixed(2) + ' (' + Math.round(cap * 127) + ' von 127, '
      + (cap * 45).toFixed(1) + '\u00b0)';
    const zeilen = (lat.rows || []);
    const gekippt = zeilen.find(r => !r.ok);
    const src = $('lat-cap-src');
    if (src) {
      // Durch t(), weil der Text hier ENTSTEHT: der Knoten-Uebersetzer findet nur, was in
      // der Vorlage steht. Der Messwert wird angehaengt und nicht eingesetzt - ein
      // Woerterbuchschluessel mit einer Zahl darin waere fuer jede Zahl ein eigener.
      src.textContent = gekippt
        ? t('gemessen: gekippt bei') + ' ' + gekippt.steer.toFixed(2) + ' \u2013 '
          + t('der Deckel ist die H\u00e4lfte davon')
        : zeilen.length
          ? t('gemessen: nie gekippt \u2013 der Deckel ist der h\u00f6chste gehaltene Wert')
          : t('gesch\u00e4tzt, noch nichts gemessen');
    }
  }

  function latRender() {
    latCapRender();
    $('lat-now').textContent = (lat.steer * lat.dir).toFixed(2);
    $('lat-raw').textContent = Math.round(lat.steer * lat.dir * 127);
    $('lat-step').textContent = lat.on ? String(lat.step) : '\u2013';
    $('lat-tiles').textContent = lat.tiles;
    if (!lat.rows.length) {
      $('lat-rows').innerHTML = '<tr><td colspan="4" class="muted">noch nichts gemessen</td></tr>';
      return;
    }
    $('lat-rows').innerHTML = lat.rows.map(r =>
      '<tr><td>' + r.steer.toFixed(2) + '</td><td>' + Math.round(r.steer * 127) + '</td>'
      + '<td>' + r.tiles + '</td>'
      + '<td' + (r.ok ? '' : ' class="cm-new"') + '>' + (r.ok ? 'hielt' : 'RUNTER') + '</td></tr>'
    ).join('');
  }

  function latStop(why) {
    if (lat.timer) { clearInterval(lat.timer); lat.timer = null; }
    lat.on = false;
    $('lat-start').textContent = 'Messung starten';
    $('lat-start').classList.remove('warn');
    if (lat.car) writeToCar(lat.car, 0, 0, trackModeBit() | LIGHT_HEAD);
    latRender();
    if (why) log('Querablage-Messung beendet: ' + why, 'info');
  }

  // Eine Stufe abschliessen und die naechste beginnen. ok=false heisst: hier ist es
  // gekippt, und dann ist die Messung fertig - weiter zu erhoehen wuerde nur bestaetigen,
  // was schon feststeht.
  function latCommit(ok) {
    if (!lat.on) return;
    lat.rows.push({ steer: lat.steer * lat.dir, tiles: lat.tiles, ok });
    if (!ok) {
      const held = lat.rows.filter(r => r.ok);
      const last = held.length ? held[held.length - 1].steer : 0;
      log('Querablage: gekippt bei ' + (lat.steer * lat.dir).toFixed(2) + ' ('
          + Math.round(lat.steer * 127) + ' von 127). Letzter haltender Wert '
          + last.toFixed(2) + '.', 'err');
      showHudToast('KIPPT BEI ' + (lat.steer * lat.dir).toFixed(2));
      latStop('Bahn verlassen');
      return;
    }
    lat.step++;
    lat.steer = Math.min(1, lat.steer + parseFloat($('lat-inc').value));
    lat.tiles = 0;
    lat.stepAt = Date.now();
    latRender();
    if (lat.steer >= 1) latStop('voller Lenkausschlag erreicht, ohne dass es kippte');
  }

  function latTick() {
    if (!lat.on || !lat.car) return;
    // Aus der Garage entfernt oder getrennt - dann ist die Messung ungueltig, nicht
    // stillschweigend zu Ende.
    if (!garage.includes(lat.car) || !lat.car.rx) { latStop('Auto nicht mehr verbunden'); return; }
    const hold = parseInt($('lat-hold').value, 10);
    if (Date.now() - lat.stepAt >= hold) { latCommit(true); return; }
    writeToCar(lat.car, lat.steer * lat.dir, parseFloat($('lat-throttle').value),
               trackModeBit() | LIGHT_HEAD);
  }

  // Aus dem Meldungsstrom: Kacheln zaehlen und den Abgang erkennen.
  function latNotify(car, b) {
    if (!lat.on || car !== lat.car) return;
    if (lat.lastCount !== null && b[11] !== lat.lastCount) { lat.tiles++; latRender(); }
    lat.lastCount = b[11];
    if (b[12] === TILE_OFFTRACK) latCommit(false);
  }

  async function writeToCar(car, steer, throttle, lightBits, modeBytes) {
    if (!car.rx || car.writeInFlight) return;
    car.writeInFlight = true;
    try {
      const pkt = buildCommandPacket(steer, throttle, lightBits, modeBytes);
      recWrite(pkt, garageLabel(car));
      if (car.rx.properties.writeWithoutResponse) await car.rx.writeValueWithoutResponse(pkt);
      else await car.rx.writeValueWithResponse(pkt);
    } catch (err) {
      // A disconnect mid-drive is normal; do not spam the log from a 22 Hz loop.
      car.writeErrors = (car.writeErrors || 0) + 1;
    } finally {
      car.writeInFlight = false;
    }
  }

  // Identify: blink the headlights of ONE car so it can be matched to its row.
  function blinkCar(car) {
    if (car.blinking) return;
    car.blinking = true;
    let n = 0;
    const iv = setInterval(() => {
      const on = n % 2 === 0;
      writeToCar(car, 0, 0, trackModeBit() | (on ? LIGHT_HEAD : 0));
      if (++n >= 10) {
        clearInterval(iv);
        car.blinking = false;
        writeToCar(car, 0, 0, trackModeBit() | LIGHT_HEAD);
        renderGarage();
      }
      renderGarage();
    }, 150);
  }

  function setCarRole(car, role) {
    if (role === 'player') {
      // Exactly one player. Anything that was the player falls back to no role rather than
      // silently becoming a ghost.
      garage.forEach(c => { if (c !== car && c.role === 'player') c.role = 'none'; });
      playerCar = car;
    } else if (playerCar === car) {
      playerCar = null;
    }
    car.role = role;
    if (role !== 'ghost') stopGhost(car);
    renderGarage();
    log(`${garageLabel(car)}: Rolle ${role === 'player' ? 'Steuern' : role === 'ghost' ? 'Ghost' : 'keine'}`, 'info');
  }

  function renderGarage() {
    const list = $('gar-list');
    if (!list) return;
    // Ueber das Fenster und nicht direkt: 98-presets.js wird NACH dieser Datei gebaut, die
    // Funktion existiert zur Deklarationszeit hier also noch nicht. Zur Laufzeit ist sie
    // da. Genau dieser Unterschied hat in dieser Datei schon fuenf Ladeabbrueche gekostet.
    if (window.__updateGaragePresetRow) window.__updateGaragePresetRow();
    // Vor dem Zeichnen: die Buchstaben folgen der Reihenfolge, und die aendert sich, wenn
    // ein Auto aus der Mitte getrennt wird.
    carRetag();
    $('gar-count').textContent = garage.length
      ? `${garage.length} Auto${garage.length === 1 ? '' : 's'} verbunden`
      : 'keine Autos verbunden';
    list.innerHTML = '';
    garage.forEach((car, i) => {
      const row = document.createElement('div');
      row.className = 'gar-row' + (car.role === 'player' ? ' is-player'
                                 : car.role === 'ghost' ? ' is-ghost' : '');
      const f = carColor(car);
      row.innerHTML = `
        <div>
          <div class="car-tag">
            <button class="car-chip" data-act="color"
                    style="background:${f.hex};color:${f.ink}"
                    title="Farbe wählen, gerade ${f.name}">${car.tagChar || ''}</button>
            <input class="car-name-in" data-act="alias" type="text" maxlength="18"
                   placeholder="${car.tag || 'Name'}"
                   value="${(car.alias || '').replace(/"/g, '&quot;')}"
                   aria-label="Name für die Rundenuebersicht">
          </div>
          <div class="gar-id">${car.tag || ''} &middot; ${String(car.device.id).slice(0, 12)}
            ${car.blinking ? '<span class="gar-blink">&nbsp;blinkt&hellip;</span>' : ''}</div></div>
        <div class="gar-roles">
          <button data-role="player" class="${car.role === 'player' ? 'on' : ''}">Steuern</button>
          <button data-role="ghost" class="${car.role === 'ghost' ? 'on ghost' : ''}">Ghost</button>
          <button data-role="none" class="${car.role === 'none' ? 'on off' : ''}">Aus</button>
        </div>
        <button data-act="drop">Trennen</button>
        ${car.role === 'ghost' ? `
        <div class="gar-speed">
          <label>Tempo</label>
          <input type="range" min="0.3" max="1" step="0.05"
                 value="${car.ghostSpeed === undefined || car.ghostSpeed === null
                          ? ghostCfg.speed : car.ghostSpeed}">
          <b></b>
          <button class="gar-speed-reset" data-act="speedreset"
                  title="Zurueck auf die Vorgabe aus den Optionen">&#8635;</button>
        </div>` : ''}`;
      // Clicking the row itself identifies the car; the buttons must not also blink it.
      row.onclick = (e) => { if (!e.target.closest('button')) blinkCar(car); };
      row.querySelectorAll('button[data-role]').forEach(b => {
        b.onclick = () => setCarRole(car, b.dataset.role);
      });
      row.querySelector('button[data-act="drop"]').onclick = () => disconnectCar(car);

      // Name: bei jedem Tastendruck merken, aber NICHT neu zeichnen - renderGarage()
      // waehrend des Tippens wuerde das Feld ersetzen und den Schreibstand mitnehmen.
      // Dasselbe Muster wie beim Temporegler eine Zeile weiter unten. Neu gezeichnet wird
      // erst beim Verlassen des Feldes.
      const nf = row.querySelector('input[data-act="alias"]');
      nf.addEventListener('input', () => { car.alias = nf.value.trim(); carRemember(car); });
      nf.addEventListener('change', () => { renderGarage(); renderRaceGrid(); });
      nf.addEventListener('click', (e) => e.stopPropagation());
      nf.addEventListener('pointerdown', (e) => e.stopPropagation());

      // Farbe: die Auswahl klappt unter dem Klecks auf, acht Farben brauchen keinen Dialog.
      // Schon belegte Farben bleiben waehlbar, sind aber angeschrieben: zwei gleiche Farben
      // sind eine schlechte Idee, aber es ist deine Entscheidung und nicht meine.
      const chip = row.querySelector('button[data-act="color"]');
      chip.onclick = (e) => {
        e.stopPropagation();
        const offen = document.querySelector('.car-pal');
        if (offen) offen.remove();
        const pal = document.createElement('div');
        pal.className = 'car-pal on';
        for (const fb of CAR_COLORS) {
          const b = document.createElement('button');
          b.style.background = fb.hex;
          b.className = fb.id === car.colorId ? 'on' : '';
          const wer = garage.find(c => c !== car && c.colorId === fb.id);
          b.title = fb.name + (wer ? ' (schon ' + garageLabel(wer) + ')' : '');
          b.setAttribute('aria-label', b.title);
          b.onclick = (ev) => {
            ev.stopPropagation();
            car.colorId = fb.id;
            carRemember(car);
            pal.remove();
            renderGarage();
            renderRaceGrid();
          };
          pal.appendChild(b);
        }
        document.body.appendChild(pal);
        const r = chip.getBoundingClientRect();
        // An den Klecks gesetzt, aber im Schirm gehalten: am rechten Rand waere die
        // Auswahl sonst zur Haelfte draussen.
        pal.style.top = (r.bottom + window.scrollY + 4) + 'px';
        pal.style.left = Math.min(r.left + window.scrollX,
          window.scrollX + document.documentElement.clientWidth - pal.offsetWidth - 8) + 'px';
        const zu = (ev) => {
          if (pal.contains(ev.target)) return;
          pal.remove();
          document.removeEventListener('pointerdown', zu, true);
        };
        // Erst im naechsten Takt lauschen, sonst schliesst der eigene Klick sofort wieder.
        setTimeout(() => document.addEventListener('pointerdown', zu, true), 0);
      };
      const sp = row.querySelector('.gar-speed input');
      if (sp) {
        const out = row.querySelector('.gar-speed b');
        const rst = row.querySelector('.gar-speed-reset');
        // Die Zeile sagt jetzt, WOHER ihr Wert kommt. Vorher war sie mit dem globalen Wert
        // vorbelegt und sah damit aus wie eine Anzeige desselben Werts - waehrend ein
        // einziges Antippen sie dauerhaft davon abkoppelte, ohne dass das irgendwo stand.
        const paint = () => {
          const eigen = car.ghostSpeed !== undefined && car.ghostSpeed !== null;
          out.textContent = Math.round(sp.value * 100) + ' %'
                            + (eigen ? '' : '\u00a0(Vorgabe)');
          out.classList.toggle('gar-speed-own', eigen);
          if (rst) rst.style.visibility = eigen ? '' : 'hidden';
        };
        paint();
        // Nur der Wert wird gesetzt, NICHT neu gezeichnet: renderGarage() beim Ziehen
        // aufzurufen wuerde den Regler unter dem Finger ersetzen und den Zug abbrechen.
        sp.addEventListener('input', () => { car.ghostSpeed = +sp.value; paint(); });
        if (rst) {
          rst.onclick = (ev) => {
            ev.stopPropagation();
            // Der Weg zurueck. Ohne ihn war das Einrasten endgueltig - es gab im ganzen
            // Projekt keine Stelle, die car.ghostSpeed wieder auf null setzt.
            car.ghostSpeed = null;
            sp.value = ghostCfg.speed;
            paint();
            showHudToast(garageLabel(car).toUpperCase() + ' FOLGT DER VORGABE');
          };
        }
        // Der Klick auf die Zeile laesst das Auto blinken - am Regler waere das laestig.
        sp.addEventListener('click', (e) => e.stopPropagation());
        sp.addEventListener('pointerdown', (e) => e.stopPropagation());
      }
      list.appendChild(row);
    });
    refreshGarageGo();
  }

  // "Losfahren" is the one button that turns a set of assigned roles into actually driving.
  // It needs a car to steer: ghosts alone would open a cockpit that answers to nothing.
  function refreshGarageGo() {
    const btn = $('gar-go');
    if (!btn) return;
    const player = garage.find(c => c.role === 'player');
    const ghosts = garage.filter(c => c.role === 'ghost').length;
    // Ein Fahrer ist NICHT mehr Voraussetzung. Vorher war der Knopf ohne "Steuern"-Auto
    // gesperrt, also liess sich ein Feld aus reinen Ghosts nicht losschicken - dabei ist
    // genau das ein sinnvoller Fall: zusehen, wie sie fahren.
    btn.disabled = !player && !ghosts;
    btn.title = !player && !ghosts
      ? (garage.length ? 'Erst ein Auto auf "Steuern" oder "Ghost" stellen'
                       : 'Erst ein Auto verbinden')
      : (player ? 'Ins Cockpit' : 'Ghosts starten')
        + (ghosts ? ', ' + ghosts + ' Ghost' + (ghosts === 1 ? '' : 's') : '');
    btn.textContent = player ? 'Losfahren' : (ghosts ? 'Ghosts starten' : 'Losfahren');
    // Anhalten ist nur scharf, wenn wirklich einer faehrt. Gepruefte Bedingung ist der
    // ZEITGEBER und nicht die Rolle: ein Auto auf "Ghost" zu stellen laesst es nicht
    // fahren, und ein Knopf, der dann etwas anzuhalten verspricht, luegt.
    const stop = $('gar-stop-ghosts');
    if (stop) {
      const fahren = garage.filter(c => c.role === 'ghost' && c.ghost && c.ghost.running);
      stop.disabled = !fahren.length;
      stop.title = fahren.length
        ? fahren.length + ' Ghost' + (fahren.length === 1 ? '' : 's')
          + ' ausrollen lassen und anhalten'
        : 'Kein Ghost f\u00e4hrt gerade';
    }
  }

  // GHOSTS ANHALTEN. Er fuehrt dieselbe Sequenz wie die Zielflagge aus - ausrollen,
  // anhalten, dreimal blinken. Ausrollen und nicht sofort stehen: ein Auto, das auf
  // Knopfdruck von Tempo auf null geht, macht einen Ruck, und die 700 ms kosten nichts.
  //
  // Ein ZWEITER Druck waehrend der Sequenz haelt hart an. Wer den Knopf noch einmal
  // drueckt, meint "jetzt" - und ein Knopf, der beim zweiten Mal dasselbe tut wie beim
  // ersten, naemlich nichts Sichtbares, ist der naechste Fehlerbericht.
  $('gar-stop-ghosts').onclick = () => {
    const ghosts = garage.filter(c => c.role === 'ghost' && c.ghost);
    if (!ghosts.length) return;
    const laufend = ghosts.filter(c => c.ghost.finish);
    if (laufend.length) {
      for (const c of laufend) { c.ghost.finish = null; c.ghost.freeRun = false; stopGhost(c); }
      log(laufend.length + ' Ghost' + (laufend.length === 1 ? '' : 's') + ' sofort gestoppt.',
          'info');
    } else {
      for (const c of ghosts) { c.ghost.freeRun = false; finishGhost(c); }
      log(ghosts.length + ' Ghost' + (ghosts.length === 1 ? '' : 's')
          + ': ausrollen, anhalten, dreimal blinken.', 'info');
    }
    refreshGarageGo();
  };

  $('gar-go').onclick = () => {
    const player = garage.find(c => c.role === 'player');
    const ghosts = garage.filter(c => c.role === 'ghost');
    if (!player && !ghosts.length) return;
    showTab('race');
    // The ghosts are started here rather than left to the race start, because "Losfahren"
    // from the Garage is also the way to drive WITHOUT arming a race - free practice with
    // company. Pressing it again RESTARTS them: startGhost begins with stopGhost, so a
    // second press resets each ghost to the start of its behaviour rather than stacking a
    // second engine on the same car.
    let n = 0;
    for (const c of garage) if (c.role === 'ghost') {
      startGhost(c);
      // Ohne das faehrt der Ghost nicht: ghostTick laesst ihn nur los, wenn ein Rennen
      // scharf ist. Freies Fahren ist genau der Fall, in dem keines laeuft.
      c.ghost.freeRun = true;
      n++;
    }
    log((player ? garageLabel(player) + ' im Cockpit' : 'Nur Ghosts')
        + (n ? ', ' + n + ' Ghost' + (n === 1 ? '' : 's') + ' gestartet' : ''), 'info');
    refreshGarageGo();
  };

  async function garageConnect() {
    if (!navigator.bluetooth) {
      alert('Web Bluetooth wird hier nicht unterstützt. Bitte in Chrome/Edge öffnen.');
      return;
    }
    try {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'HYBRID' }],
        optionalServices: [NUS_SERVICE],
      });
      if (garage.some(c => c.device.id === dev.id)) {
        log('Dieses Auto ist bereits verbunden.', 'info');
        return;
      }
      const srv = await dev.gatt.connect();
      const nus = await srv.getPrimaryService(NUS_SERVICE);
      const rx = await nus.getCharacteristic(NUS_RX);
      const tx = await nus.getCharacteristic(NUS_TX);
      const car = {
        device: dev, server: srv, rx, tx,
        role: 'none', writeInFlight: false, blinking: false,
        // Live telemetry, filled by the notify handler below.
        tileCode: 0xff, tileCount: null, lastCodeAt: 0, yaw: 0,
        ghost: null, timer: null,
      };
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', (e) => onCarNotify(car, e));
      dev.addEventListener('gattserverdisconnected', () => {
        log(`${garageLabel(car)} getrennt.`, 'err');
        removeCar(car);
      });
      garage.push(car);
      carAssign(car);
      // First car connected takes the wheel, as requested.
      if (!playerCar) setCarRole(car, 'player'); else renderGarage();
      log(`${garageLabel(car)} verbunden (${garage.length} insgesamt).`, 'info');
      playFx(fxBuffers.start[$('sound-profile').value] || fxBuffers.start.porsche, 0.85);
    } catch (err) {
      if (err && err.name === 'NotFoundError') log('Keine Auswahl getroffen.', 'info');
      else log('Verbinden fehlgeschlagen: ' + (err && err.message), 'err');
    }
  }

  // Per-car telemetry. Byte 12 is the tile code, byte 11 the tile counter, byte 3 a
  // rotation signal. lastCodeAt is what the ghost's off-track cut-out is built on.
  // e.target.value ist ein DataView, und ein DataView muss NICHT bei 0 seines Puffers
  // anfangen. new Uint8Array(v.buffer) ignoriert byteOffset und byteLength und liest damit ab
  // Pufferanfang - bei einem versetzten View sind das die falschen Bytes, und zwar stumm.
  // Genau dazu passt der Befund "Byte 12 meldet ueber 795 Pakete zu 100 Prozent 0x01".
  function notifyBytes(v) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }

  function onCarNotify(car, e) {
    const b = notifyBytes(e.target.value);
    if (b.length < 16) return;
    recNotify(b, garageLabel(car));
    // Lap timing for EVERY connected car, whatever its role: the start/finish code arrives
    // on its own notify stream, so there is no reason to only count the player's laps.
    carRaceNotify(car, b);
    // The player's car also drives the dashboard. Without this a car connected through the
    // Garage alone had no telemetry at all, because the dashboard subscription hangs off
    // the BLE explorer's discovery, which the Garage does not use.
    if (car === playerCar) handleDashboardBytes(b);
    const code = b[12];
    // Der Monitor bekommt JEDEN Wert, auch die, die alles andere hier verwirft - er ist
    // genau dafuer da, einen unbekannten Code zu finden.
    //
    // Und er bekommt sie von JEDEM Auto. Vorher stand hier "nur vom gesteuerten Auto, oder
    // von allen wenn es keines gibt" - wer ein Auto als Ghost ueber ein Muster schiebt und
    // gleichzeitig ein anderes steuert, bekam damit nichts zu sehen und musste glauben, der
    // Monitor sei kaputt. Ein Messwerkzeug, das Pakete nach Rolle verwirft, verwirft genau
    // die, die man messen wollte.
    cmTick(code, b, car);
    latNotify(car, b);
    shakeNotify(car, b);
    // 0x00 is a valid REPORT but not a valid READING, so it must not refresh the
    // last-seen-code timestamp — otherwise a car sitting beside the track looks alive.
    if (code !== 0xff && code !== TILE_OFFTRACK) car.lastCodeAt = Date.now();
    if (code !== car.tileCode) { car.tileCode = code; }
    if (car.tileCount !== b[11]) { car.tileCount = b[11]; car.tileAt = Date.now(); }
    // Der Streckenscan haengt jetzt an DIESEM Strom. Er hatte eine eigene Anmeldung ueber
    // charByUuid, und die wird nur von exploreServices() im Entwickler-Tab gefuellt - nach
    // einer Verbindung ueber die Garage war sie leer und der Scan brach mit "NUS TX nicht
    // gefunden" ab. Genau derselbe Fehler war beim Armaturenbrett schon einmal gefunden und
    // dort behoben worden (siehe den Kommentar oben), beim Scan blieb er stehen.
    if (trackScanning && trackScanCar === car) trackScanBytes(b);
    // Lernen laeuft nur, wenn nicht gerade von Hand gescannt wird - beide gleichzeitig in
    // dieselbe Karte schreiben zu lassen waere ein Wettlauf.
    if (!trackScanning && (car === playerCar || car.role === 'ghost')) {
      // Das erste passende Auto bekommt das Lernen und behaelt es, bis zurueckgesetzt wird.
      // Der Fahrer hat Vorrang: er faehrt die Runde bewusst, ein Ghost faehrt, was er kann.
      if (!learn.car || (car === playerCar && learn.car !== playerCar)) {
        if (learn.car !== car) { learnReset(); learn.car = car; }
      }
      if (learn.car === car) learnTick(b);
    }
    car.yaw = b[3] > 127 ? b[3] - 256 : b[3];
    car.battery = b[10];
  }

  function stopGhost(car) {
    // AUCH den wartenden setTimeout, nicht nur den laufenden Zeitgeber - siehe
    // ghostTaktLoeschen(). Ein Halt in den ersten Millisekunden nach dem Start liess sonst
    // einen Zeitgeber zurueck, den niemand mehr kannte.
    ghostTaktLoeschen(car);
    if (car.ghost) { car.ghost.running = false; car.ghost.finish = null; }
    if (car.rx) writeToCar(car, 0, 0, trackModeBit() | LIGHT_HEAD);
    // Der Knopf "Ghosts anhalten" haengt daran. Hier und nicht an den sieben Aufrufstellen:
    // eine davon wird sonst vergessen, und dann steht ein scharfer Knopf ohne Ghost.
    refreshGarageGo();
  }

  function removeCar(car) {
    stopGhost(car);
    const i = garage.indexOf(car);
    if (i >= 0) garage.splice(i, 1);
    if (playerCar === car) playerCar = null;
    renderGarage();
  }

  async function disconnectCar(car) {
    stopGhost(car);
    try { if (car.device.gatt.connected) car.device.gatt.disconnect(); } catch (e) { /* gone */ }
    removeCar(car);
  }

  $('gar-connect').onclick = garageConnect;
  $('gar-disconnect-all').onclick = () => { [...garage].forEach(disconnectCar); };
  renderGarage();


  // ===================== The ghost driver =====================
  // Signals it can actually rely on, all confirmed from the HCI logs:
  //   byte 12 = the tile under the sensor right now, 0xff = nothing being read
  //   byte 11 = tile counter, one step per tile
  //   byte  3 = a rotation signal
  //
  // The one thing the car does NOT report is which WAY a curve turns: 0x04 means "curve",
  // and the sign of byte 3 depends on the direction of travel over the piece, which no byte
  // reveals. Guessing it would send the ghost off the track at the first corner. The turn
  // direction therefore comes from the TRACK LAYOUT the user builds in the Strecke tab,
  // where left and right curves are distinct, and byte 11 says which piece we are on.
  //
  // Consequence, stated plainly: WITHOUT a layout a ghost can only hold a straight line. It
  // will run wide at the first curve and the cut-out below will stop it. That is a real
  // limitation, not a bug.
  // Amplitude of the formation-lap weave, as a fraction of full lock. Small on purpose:
  // it should read as warming tyres, not as a car out of control.
  const GHOST_WEAVE = 0.22;
  // Der Versatz der Zweierkolonne, in derselben Einheit wie das Schlaengeln: ein Anteil des
  // vollen Lenkeinschlags. Etwas kleiner als die Schlaengelamplitude, damit die beiden
  // Bewegungen sich nicht aufheben - zusammen bleiben sie unter 0,4, also weit vom Anschlag.
  //
  // Er darf deutlicher ausfallen als der Versatz gegen das Rammen bei voller Fahrt: in der
  // Einfuehrungsrunde geht es mit Boxentempo zu, und dort verzeiht ein seitlicher Versatz
  // mehr.
  const GHOST_GRID_OFFSET = 0.16;
  // DIE LESESCHWELLE. Unter diesem Anteil der Hoechstgeschwindigkeit faehrt das Auto so
  // langsam, dass es die gedruckte Strecke nicht mehr zuverlaessig liest - dann meldet Byte
  // 12 nur noch 0x00, der Vorausblick faellt aus, und der Abgangsmelder haelt das fuer "Bahn
  // verlassen". Genau darum beginnt der Temporegler bei 0,35 und nicht tiefer.
  //
  // Als Konstante, weil sie jetzt an ZWEI Stellen gilt: beim Regler (dessen min im Markup
  // steht) und beim Formationstempo. Dort fehlte sie, und das war der Fehler.
  const GHOST_READ_MIN = 0.35;
  // Das Tempo der Einfuehrungsrunde. NICHT einfach das Boxentempo: 80 km/h sind 0,271 von
  // 295, also unter der Leseschwelle. Ein Feld, das dort rollt, liest nichts mehr, parkt sich
  // selbst - gemeldet als "sie fahren nicht richtig los und fangen an zu blinken" - und die
  // Runde koennte gar nicht enden, denn ihr Ende ist eine Ueberfahrt von Start/Ziel, und die
  // muss gelesen werden.
  //
  // Das Maximum von beiden ist damit keine Bequemlichkeit, sondern die Bedingung dafuer, dass
  // die Einfuehrungsrunde ueberhaupt zu Ende geht.
  function formationPace() {
    return Math.max(PIT_SPEED_FACTOR, GHOST_READ_MIN);
  }

  // Der Startplatz eines Autos, oder -1 fuer "steht nicht in der Aufstellung". Als Funktion,
  // weil ihn jetzt zwei Stellen brauchen: startGhost() und das Auto des Fahrers. Zwei
  // Abschriften von indexOf(String(car.device.id)) waeren die naechste Abweichung.
  function gridPosOf(car) {
    if (!car || !car.device || typeof raceGridOrder === 'undefined') return -1;
    return raceGridOrder.indexOf(String(car.device.id));
  }

  // Der Querversatz in der Einfuehrungsrunde: Schlaengeln zum Reifenwaermen plus die Seite
  // der Zweierkolonne.
  //
  // EINE DEFINITION FUER BEIDE. Seit v0.4.54 faehrt auch das Auto des Fahrers diese Runde
  // selbst, und die zwei Konstanten duerfen nicht an zwei Orten stehen - sonst schlaengelt
  // das Feld anders als der Fahrer, und niemand sieht, warum.
  //
  // `halter` traegt nur die Phase, damit das Feld nicht als ein Block schwingt: fuer einen
  // Ghost ist das sein Ghost-Zustand, fuer den Fahrer ein eigenes Objekt. Er wird beim
  // ersten Aufruf gesetzt und nicht im Konstruktor - ein Auto, das nie in einer
  // Einfuehrungsrunde faehrt, braucht keine Phase.
  function formationOffset(halter, gridPos, now) {
    if (halter.weavePhase === undefined) halter.weavePhase = Math.random() * 6.283;
    let v = Math.sin(now / 700 + halter.weavePhase) * GHOST_WEAVE;
    if (gridPos >= 0) v += (gridPos % 2 ? -1 : 1) * GHOST_GRID_OFFSET;
    return v;
  }

  // Was das Auto des Fahrers quer tut, waehrend es die Einfuehrungsrunde selbst faehrt.
  // Gerufen aus physicsStep() in 50-drive.js.
  //
  // NUR SCHLAENGELN UND KOLONNE, keine Ideallinie. Das ist kein Nachlassen, sondern
  // dieselbe Wahl, die ein Ghost trifft: er sendet Lenkung null und laesst das Auto die
  // Arbeit machen, weil es sich in der Leitplanken-Stellung selbst auf der Bahn haelt. Der
  // Versatz ist ein kleiner Anstoss auf diese Null. Das Linienmodell der Ghosts haengt an
  // ihrem Kachelzustand in car.ghost, den das Fahrerauto nicht hat - und in einer
  // Einfuehrungsrunde geht es ohnehin ums Rollen in Formation und nicht um die Ideallinie.
  const formationFahrer = {};
  function formationDriverOffset() {
    const car = garage.find(c => c.role === 'player');
    return formationOffset(formationFahrer, gridPosOf(car), Date.now());
  }
  const GHOST_OFFTRACK_MS = 1500;   // measured: tiles last 0.4-2.7 s with no 0xff between
  // Wie lange 0x00 stehen muss, bevor der Ghost anhaelt. Vorher hielt ein EINZIGES 0x00-Paket
  // ihn sofort an, und das war die Ursache dafuer, dass Ghosts unterwegs stehen blieben.
  // Gemessen an den Aufzeichnungen, Dauer zusammenhaengender 0x00-Strecken:
  //     saubere Runden (202608211949):   Median  32 ms, 90 % <= 104 ms, Maximum  174 ms
  //     Sitzung mit echten Ausfluegen:   Median 1013 ms,               Maximum 5845 ms
  // Die beiden Verteilungen ueberschneiden sich nicht. 350 ms liegt dazwischen, doppelt so
  // weit ueber dem groessten Zwischenkachel-Aussetzer wie unter dem kleinsten echten Ausflug.
  // 900 statt 350 ms, und dazu eine zweite Bedingung. Ein Auto ist mitten auf der Bahn
  // stehen geblieben und hat geblinkt: 0x00 heisst "neben der Bahn", kommt aber zwischen zwei
  // Kacheln regelmaessig vor (Median 32 ms, gemessen), und ein etwas laengerer Ausfall reichte
  // fuer einen Fehlalarm.
  //
  // Die eigentliche Verbesserung ist die zweite Bedingung, nicht die Zeit: laeuft der
  // KACHELZAEHLER weiter, faehrt das Auto ueber Kacheln, und dann ist es auf der Bahn - egal
  // was Byte 12 dazwischen meldet. Das unterscheidet, was Zeit allein nicht unterscheiden
  // kann, naemlich einen Ausfall der Lesung von einem Abflug.
  const GHOST_OFFTRACK_CONFIRM_MS = 900;
  // Wie frisch muss der letzte Kachelwechsel sein, damit der Zaehler als LAUFEND gilt?
  // GHOST_TILE_MS_MAX ist die laengste je gefahrene Kachel; wer darueber liegt, steht.
  const GHOST_ZAEHLER_FRISCH_MS = 4000;
  // Wieviele Kachelabstaende in die Plausibilitaet eingehen. Drei genuegen: ein Abflug
  // laesst den Zaehler sofort rasen, und ein Mittel ueber zehn wuerde ihn verschleifen.
  const GHOST_ZAEHLER_FENSTER = 3;
  // Nach einem ausdruecklichen Start darf der Ghost fahren, OHNE schon einen Code gelesen
  // zu haben. Ohne diese Gnade kommt ein einmal geparktes Auto nie wieder hoch: es steht,
  // also liest es nichts, also parkt der Neustart es nach GHOST_OFFTRACK_MS wieder ein.
  // Drei Sekunden reichen fuer mehrere Kacheln - wer bis dahin nichts gelesen hat, liegt
  // wirklich neben der Bahn.
  const GHOST_START_GNADE_MS = 3000;
  const GHOST_YAW_GAIN = 0.045;     // rotation units -> steering; refined on the real car
  const GHOST_STEER_CURVE = 0.55;   // feed-forward lock in a curve, before the yaw loop

  const ghostCfg = {
    // 0,45, gefahren ermittelt: brauchbar liegt es zwischen 40 und 60 Prozent. Der Bereich
    // beginnt jetzt bei 0,35 und nicht bei 0,30 - darunter faehrt das Auto so langsam, dass
    // es die gedruckte Strecke nicht mehr zuverlaessig LIEST, und dann faellt der ganze
    // Vorausblick aus. Ein Regler, der eine kaputte Einstellung zulaesst, ist eine Falle.
    speed: 0.45,        // fraction of top speed on a straight
    // 0,15, gefahren ermittelt. 0,35 war zu viel: mit der berichtigten Ratenbegrenzung wirkt
    // der Abschlag jetzt wirklich, und die Haarnadel bekommt ohnehin das Doppelte.
    curveSlow: 0.15,    // how much of that is given up in a curve
    // 0.5 statt 0. Die Naeherungslogik in ghostAssignBias gab es laengst - gleiche Runde
    // und Kachelindex hoechstens eins auseinander ergibt gegenlaeufige Versaetze - aber sie
    // wurde mit diesem Faktor multipliziert, und der stand auf Null. Das Feature war da und
    // konnte nie wirken.
    lateral: 0.5,
    // Ideallinie, 0,7 statt 0,35. Gefahren war von 0,35 nichts zu merken, und die Rechnung
    // sagt warum: der Deckel begrenzt den Versatz auf 0,55, danach kam x 0,35 x 0,5 - also
    // 0,096 von 1, ein Sechstel dessen, was die Messung als sicher annimmt. Mit
    // GHOST_LINE_STEER = 1,0 und 0,7 sind es 0,385, viermal so viel; auf 100 Prozent genau
    // der Deckel. 0 = gerade Lenkung und nur der Anti-Ramm-Versatz.
    line: 0.7,
    // EIGENE SPUREN. Jeder Ghost haelt eine feste, ihm eigene Linie ueber die Bahnbreite -
    // unabhaengig von Abstand, Strecke und Kachelzahl. Das ist der Unterschied zu den zwei
    // anderen Linieneinstellungen: ghost-lateral wirkt nur bei zwei Autos nebeneinander,
    // ghost-line erst ab drei Streckenteilen. Beides null heisst "alle stumpf in der Mitte",
    // und genau so wurde es gemeldet.
    lanes: 0.5,
    // Rennwuerze. Ein Regler, fuenf Bausteine - siehe ghostSpice() weiter unten.
    spice: 0.4,
    // Lernen von Runde zu Runde, standardmaessig aus: es aendert das Fahrverhalten ueber
    // ein Rennen hinweg, und das soll niemand ungefragt bekommen.
    learnPace: false,
    leaderBrake: false, // hold the leader back for a while
    leaderBrakePct: 0.10,
    // Default ON: the measurement says this is the mode in which the car holds the track by
    // itself, which is the only configuration in which a ghost works at all today.
    railMode: true,
    // Lernt der Ghost die Strecke, waehrend er faehrt? Er meldet ohnehin je Kachel ihre Art,
    // also laesst sich das Layout aus einer gefahrenen Runde zusammensetzen - dasselbe, was
    // der Streckenscan von Hand macht, nur nebenbei. Sobald eine Runde geschlossen ist, wird
    // sie als Strecke uebernommen, wenn noch keine da ist, und ab dann hat der Ghost seinen
    // Vorausblick und bremst vor Kurven.
    learn: true,
    // Standard AUS. Anders herum war es die haeufigste Ursache fuer "ich starte das Rennen
    // und nichts passiert": ohne gedrucktes Muster meldet das Auto nie einen Code, und dann
    // stand der Ghost. Vorsicht, die nichts faehrt, ist keine Vorsicht. Wer gedruckte
    // Strecke liegen hat, kann es einschalten - dann haelt sich das Auto selbst auf der Bahn
    // und faehrt nur dort, wo es weiss, wo es ist.
    needCode: false,
  };

  // Per-tile behaviour, data-driven on purpose: the hairpin and left-curve codes are not
  // known yet, and adding them must not require touching code.
  // curve: 0 = gerade, 1 = 60-Grad-Kurve, 2 = Haarnadel. Die Zahl ist keine Kennung,
  // sondern ein Mass fuer die Enge - das Tempoprofil unten rechnet damit.
  const GHOST_TILE = {
    0x01: { curve: 0 },   // start/finish, behaves like a straight
    0x02: { curve: 0 },   // straight
    0x03: { curve: 1 },   // 60-Grad-Kurve links
    0x04: { curve: 1 },   // 60-Grad-Kurve rechts
    0x05: { curve: 2 },   // Haarnadel links  (gemessen 24.08.)
    0x06: { curve: 2 },   // Haarnadel rechts (gemessen 24.08.)
  };

  function ghostTileInfo(code) { return GHOST_TILE[code] || { curve: 0 }; }

  // Wie eng ist ein Kachel-TYP aus der Karte? Dieselbe Skala wie GHOST_TILE.curve, nur aus
  // dem Layout statt aus dem gemeldeten Code - der Vorausblick kennt nur das Layout.
  function tileTightness(t) {
    if (t === TILE_TYPE.HAIRPIN || t === TILE_TYPE.HAIRPIN_LEFT) return 2;
    if (t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.CURVE_RIGHT) return 1;
    return 0;
  }

  // Which way does the piece we are on turn? Only the layout knows.
  // Returns -1 (left), +1 (right) or 0 (straight / unknown).
  function ghostTurnDir(car, lookahead) {
    const tiles = currentTrackTiles;
    if (!tiles || tiles.length < 2 || car.ghost.tileIndex === null) return 0;
    const i = (car.ghost.tileIndex + (lookahead || 0)) % tiles.length;
    const t = tiles[i] && tiles[i].type;
    if (t === TILE_TYPE.CURVE_RIGHT || t === TILE_TYPE.HAIRPIN) return 1;
    if (t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.HAIRPIN_LEFT) return -1;
    return 0;
  }

  // Wie weit sind wir durch die aktuelle Kachel? 0 am Anfang, 1 am Ende.
  //
  // Es gibt kein Byte dafuer, aber die Kachelgrenzen sind bekannt (Byte 11 springt), also
  // laesst sich die Phase aus der Zeit seit dem Sprung geteilt durch die typische
  // Kacheldauer schaetzen. Die Dauer wird gleitend mitgefuehrt statt festgelegt: sie
  // haengt am Tempo, und ein fester Wert waere bei halbem Gas doppelt falsch.
  //
  // Warum die Phase ueberhaupt: fuer die eigenen Ghosts der Original-App erklaeren
  // Kachelindex UND Phase zusammen 85 Prozent der Lenkvarianz (Reststreuung 21.7 gegen
  // 56.7 bei einem der beiden Autos, 55 Prozent beim anderen). Eine Linie, die nur den
  // Kachelindex kennt, kann Anstellen, Scheitel und Herausfahren nicht trennen.
  const GHOST_TILE_MS_MIN = 250;    // schneller ist keine Kachel je gefahren worden
  const GHOST_TILE_MS_MAX = 4000;
  function ghostTilePhase(car) {
    const g = car.ghost;
    if (!g || !car.tileAt) return 0;
    // Die mitgefuehrte Dauer ist ein Mittel ueber ALLE Kacheln. Eine Haarnadel ist aber
    // dreimal so lang wie eine Gerade, also war die Phase dort nach einem Drittel bei 1 und
    // blieb dort stehen - und beim Kachelwechsel sprang der Linienversatz. Gemessen an der
    // Testfolge SGHGH waren das 0.39 quer ueber die Bahn, gegen 0.12 auf einer Strecke ohne
    // Haarnadel. Die relative Laenge kommt aus der Abtastdichte der Mittellinie, die
    // trackCenterline() ohnehin nach Drehwinkel vergibt.
    const dur = (g.tileMs || 800) * ghostTileLenFactor(g.tileIndex);
    return Math.max(0, Math.min(1, (Date.now() - car.tileAt) / dur));
  }

  // Wie lang ist diese Kachel WIRKLICH? In Zeichnungseinheiten, entlang der Mittellinie.
  //
  // Vorher wurde mit der Zahl der Abtastpunkte gerechnet, und die vergibt
  // trackCenterline() nach DREHWINKEL, nicht nach Laenge. Eine Haarnadel dreht dreimal so
  // weit wie eine 60-Grad-Kurve, hat aber nur den halben Radius - ihr Bogen ist also nur
  // eineinhalb mal so lang. Gemessen gegen eine Gerade von 43 cm:
  //
  //     60-Grad-Kurve   37 * pi/3      = 38,8 cm   gerechnet wurde 43 cm
  //     Haarnadel       28 + 18,5 * pi = 86,1 cm   gerechnet wurde 129 cm
  //
  // Die Phase sagt, welche Stelle der Ideallinie das Auto gerade liest. Sie war damit auf
  // JEDER Kurve falsch, nicht nur auf der Haarnadel. Gefunden hat es der Selbsttest.
  function tileLength(type) {
    if (type === TILE_TYPE.PIT) return TRACK_STEP * 2;
    if (!tileIsCurve(type)) return TRACK_STEP;
    const bogen = tileRadius(type) * Math.abs(tileTurnDeg(type)) * Math.PI / 180;
    const lead = (type === TILE_TYPE.HAIRPIN || type === TILE_TYPE.HAIRPIN_LEFT)
      ? TRACK_HAIRPIN_LEAD : 0;
    return bogen + lead;
  }

  function ghostTileLenFactor(tileIndex) {
    if (tileIndex === null || tileIndex === undefined) return 1;
    const tiles = currentTrackTiles;
    if (!tiles || !tiles.length) return 1;
    const n = tiles.length;
    const t = tiles[((tileIndex % n) + n) % n];
    if (!t) return 1;
    let summe = 0;
    for (const x of tiles) summe += tileLength(x.type);
    const mittel = summe / n;
    return mittel > 0 ? tileLength(t.type) / mittel : 1;
  }

  // Beim Kachelwechsel die gemessene Dauer gleitend nachziehen. Ausreisser werden verworfen
  // statt eingerechnet: ein verlorenes Paket sieht wie eine doppelt lange Kachel aus, und
  // genau dieser Fehler hat bei der Geschwindigkeitsmessung schon einmal 14 km/h ergeben.
  function ghostNoteTileTime(car, ms) {
    const g = car.ghost;
    if (!g || !(ms >= GHOST_TILE_MS_MIN && ms <= GHOST_TILE_MS_MAX)) return;
    g.tileMs = g.tileMs ? g.tileMs * 0.7 + ms * 0.3 : ms;
  }

  // VOLLER LINIENVERSATZ = VOLLER LENKAUSSCHLAG, vorher der halbe.
  //
  // Der Faktor 0,5 war eine zweite Sicherheit auf einer, die es schon gibt: der Versatz ist
  // durch learnSteerCap() ohnehin auf den halben Kippwert begrenzt (unvermessen 0,55). Beides
  // uebereinander ergab eine Anforderung von 0,096 bei der alten Vorgabe - gefahren war davon
  // nichts zu merken, und das war der Bericht.
  //
  // Die Regel der Doku - "die Ideallinie darf nie mehr als etwa die Haelfte des Kippwerts
  // anfordern" - bleibt eingehalten, denn genau die IST der Deckel. Bei 100 Prozent wird er
  // jetzt erreicht statt gedrittelt.
  const GHOST_LINE_STEER = 1.0;   // voller Linienversatz = voller Lenkausschlag

  function ghostTurnOf(t) {
    return t === TILE_TYPE.CURVE_RIGHT || t === TILE_TYPE.HAIRPIN ? 1
         : t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.HAIRPIN_LEFT ? -1 : 0;
  }

  // Der ZUSAMMENHAENGENDE Kurvenzug, in dem eine Kachel liegt: Anfang, Laenge, Position
  // darin, und wohin die Kurvenzuege davor und danach drehen.
  //
  // Das ist der Kern der Korrektur. Die erste Fassung behandelte jede Kachel als eigene
  // Kurve, also ging der Ghost in einer Doppelkurve zweimal von aussen nach innen nach
  // aussen - in einer Kurve, die er in einem Zug fahren soll. Aufgefallen ist es an der
  // Sprungmessung: bei SRRRLLL sprang der Versatz an der Nahtstelle um 1.9 von einem
  // Abtastpunkt zum naechsten, und ein Sprung im Versatz ist ein Ruck am Lenkservo.
  function ghostRun(tiles, idx) {
    const n = tiles.length;
    const at = (k) => tiles[((k % n) + n) % n].type;
    const dir = ghostTurnOf(at(idx));
    if (dir === 0) return { dir: 0 };
    let back = 0, fwd = 0;
    while (back < n - 1 && ghostTurnOf(at(idx - back - 1)) === dir) back++;
    while (fwd < n - 1 - back && ghostTurnOf(at(idx + fwd + 1)) === dir) fwd++;
    return {
      dir,
      len: back + fwd + 1,
      pos: back,                                   // Position in diesem Kurvenzug
      prevDir: ghostTurnOf(at(idx - back - 1)),
      nextDir: ghostTurnOf(at(idx + fwd + 1)),
      tight: Math.max.apply(null, Array.from({ length: back + fwd + 1 },
                                             (_, k) => tileTightness(at(idx - back + k)))),
    };
  }

  // Wo soll ein Kurvenzug anfangen und aufhoeren, in Einheiten von -1 (links) bis +1?
  //
  // Regel: aussen hinein, aussen heraus - AUSSER die naechste Kurve dreht andersherum. Dann
  // bleibt man auf der eigenen Innenseite, denn die ist die Aussenseite der naechsten.
  // Genau das ist eine S-Kurve: die erste wird geopfert, damit die zweite passt.
  //
  // Die Ausnahme gehoert NUR an den Ausgang. Am Eingang hatte ich sie auch stehen, und das
  // war ein Vorzeichenfehler: die Aussenseite dieser Kurve IST schon die Innenseite der
  // vorigen, wenn die andersherum dreht (bei entgegengesetzter Drehrichtung ist
  // -dir == prevDir). Der Eingang trifft also von selbst, wo der vorige Kurvenzug endet -
  // die Ausnahme hat ihn genau auf die falsche Seite gelegt. Aufgefallen an der
  // Sprungmessung: SRL und SHJ sprangen an der Nahtstelle um 2.000, also ueber die ganze
  // Bahnbreite, und zwar innerhalb eines Abtastschritts.
  function ghostRunEnds(run) {
    const outside = -run.dir, inside = run.dir;
    return {
      entry: outside,
      exit:  (run.nextDir !== 0 && run.nextDir !== run.dir) ? inside : outside,
    };
  }

  // ---- Ruetteln erkennen: "ich habe das Auto hochgehoben und zurueckgestellt" ----
  //
  // Es gibt keinen Beschleunigungssensor im Protokoll. Was es gibt, sind Byte 1 und Byte 3,
  // die sich aendern, wenn das Auto bewegt wird. Die Frage war, ab welcher Aenderung man
  // "wird geschuettelt" von "liegt nur da" unterscheiden kann.
  //
  // Die Antwort aus den Mitschnitten: mit einer FESTEN Schwelle gar nicht. Gemessen, Summe
  // der Betraege von Byte 1 und 3 ueber neun Meldungen (etwa 400 ms):
  //
  //                       Median   90 %   99 %    max
  //     Gas neutral    B1     3     20    106    390
  //                    B3     0     73    150    569
  //     Gas offen      B1    14     35    292    581
  //                    B3    29     66    168    335
  //
  // Die Verteilungen ueberlappen fast vollstaendig, und der Grund ist der Datensatz selbst:
  // "Gas neutral" enthaelt Ausrollen, Hochheben und Herumtragen durcheinander. Kein
  // Mitschnitt ist mit "liegt still" gegen "wird geschuettelt" beschriftet. Eine feste
  // Zahl waere hier also geraten, und geraten heisst: entweder faehrt der Ghost von selbst
  // wieder los, oder er reagiert nie.
  //
  // Deshalb RELATIV statt absolut: waehrend ein Auto steht, lernt es seinen eigenen
  // Ruhewert, und ausgeloest wird bei einem Vielfachen davon. Das braucht keine
  // Beschriftung und passt sich an, was das einzelne Auto im Ruhezustand meldet. Der
  // absolute Boden darunter verhindert, dass ein voellig stilles Auto (Ruhewert 0) auf
  // jedes Rauschen anspringt. Beides ist in den Optionen einstellbar, und der Rohwert
  // steht im Entwicklertab - schuetteln, ablesen, einstellen.
  const SHAKE_WIN = 9;              // Meldungen im Fenster, etwa 400 ms
  const SHAKE_SETTLE_MS = 1200;     // so lange erst zuhoeren, bevor ausgeloest werden kann
  let shakeFloor = 130;             // absoluter Boden
  let shakeFactor = 6;              // Vielfaches des gelernten Ruhewerts

  function sgn8(v) { return v > 127 ? v - 256 : v; }

  function shakeNotify(car, b) {
    if (!car.shake) car.shake = { p1: null, p3: null, win: [], sum: 0, quiet: [], base: null };
    const sh = car.shake;
    const v1 = sgn8(b[1]), v3 = sgn8(b[3]);
    if (sh.p1 !== null) {
      const d = Math.abs(v1 - sh.p1) + Math.abs(v3 - sh.p3);
      sh.win.push(d);
      sh.sum += d;
      if (sh.win.length > SHAKE_WIN) sh.sum -= sh.win.shift();
    }
    sh.p1 = v1; sh.p3 = v3;
    if (sh.win.length < SHAKE_WIN) return;

    if (!car.parked) { sh.quiet = []; sh.base = null; sh.parkedAt = 0; return; }
    // Erst zuhoeren, dann urteilen. Der Ruhewert ist der Median der Fenster in der
    // Lernphase - der Median und nicht der Mittelwert, damit ein einzelner Stoss beim
    // Abstellen ihn nicht hochzieht.
    if (!sh.parkedAt) sh.parkedAt = Date.now();
    if (Date.now() - sh.parkedAt < SHAKE_SETTLE_MS) { sh.quiet.push(sh.sum); return; }
    if (sh.base === null) {
      const q = sh.quiet.slice().sort((a, x) => a - x);
      sh.base = q.length ? q[Math.floor(q.length / 2)] : 0;
    }
    const thr = Math.max(shakeFloor, sh.base * shakeFactor);
    car.shakeValue = sh.sum;
    car.shakeThreshold = thr;
    if (sh.sum >= thr) unparkCar(car, 'geruettelt');
  }

  // ---- Anhalten und wieder losfahren ----
  // Vorher versuchte ein Ghost, nach einem Abgang weiterzufahren, sobald wieder ein
  // Streckencode kam. Auf dem Tisch heisst das: er dreht sich neben der Bahn im Kreis, und
  // wer ihn zurueckstellt, muss ihn im Fahren treffen. Jetzt bleibt er stehen, bis man ihn
  // schuettelt - dieselbe Handbewegung, mit der man ihn ohnehin zurueckstellt.
  function parkCar(car, reason) {
    if (car.parked === reason) return;
    car.parked = reason;
    if (car.shake) { car.shake.parkedAt = 0; car.shake.quiet = []; car.shake.base = null; }
    if (car.ghost) { car.ghost.cutOut = true; car.ghost.attackUntil = 0; }
    if (car.rx) writeToCar(car, 0, 0, trackModeBit() | LIGHT_HEAD);
    log(garageLabel(car) + ': steht (' + reason + '). Auto anheben, zur\u00fcckstellen und '
        + 'kurz sch\u00fctteln, dann f\u00e4hrt es weiter.', 'err');
    showHudToast(garageLabel(car).toUpperCase() + ' STEHT, SCH\u00dcTTELN');
  }

  // Ueber diese Zeit fuehrt das Ziel-Tempo nach dem Entparken von 0 hoch.
  //
  // Warum ueberhaupt: solange geparkt, wird jede Runde speedKmh = 0 erzwungen. Im ersten
  // Takt danach ist v = 0, also err = target, und wegen throttle = err * GHOST_KP_GAS stand
  // die Gasanforderung ab einem Ziel von etwa einem Viertel sofort auf 1,0. Wer ein
  // abgeflogenes Auto zurueckstellt und schuettelt, bekam es mit Vollgas aus der Hand
  // gerissen.
  //
  // Die Rampe liegt auf dem ZIEL und nicht auf dem Gas. Das Gas ist die Antwort des
  // Reglers; eine Rampe darauf waere ein zweiter Regler, der gegen den ersten arbeitet.
  const GHOST_UNPARK_RAMP_MS = 2500;

  // Der Tempo-Regler der Ghosts. Vorher standen die Verstaerkungen 4 und 3 hart im Code und
  // waren nirgends benannt - man konnte sie nicht diskutieren, ohne die Zeile zu suchen.
  //
  // GHOST_DEADBAND ist der Teil, der das Pendeln beendet: ein P-Regler ohne Totband
  // ueberschwingt immer, und bei diesen Verstaerkungen sichtbar. 1,5 Prozent vom
  // Tempobereich sind bei 4 km/h Modellhoechstgeschwindigkeit rund 4 km/h auf dem Tacho.
  const GHOST_DEADBAND = 0.015;
  const GHOST_KP_GAS = 2.2;      // war 4: eine Abweichung von einem Viertel gab Vollgas
  const GHOST_KP_BREMSE = 3.0;   // hoeher als Gas: gebremst wird entschlossen
  const GHOST_SLEW_GAS = 1.6;    // Anteil je Sekunde; voll durchtreten dauert 0,6 s
  const GHOST_SLEW_BREMSE = 4.0; // Bremse darf schneller kommen, 0,25 s auf voll

  // ---- Warum hier KEINE Vorsteuerung steht -----------------------------------------
  //
  // Ein Anlauf hat es versucht: den Gasbefehl ausrechnen, der ein Tempo im
  // Beharrungszustand haelt, aus thrustAt() gegen resistAt() per Bisektion. Das ist falsch,
  // und der Grund ist wichtiger als der Fehler - thrustAt() rechnet mit der INNEREN
  // Gaskennung des Fahrzeugmodells, waehrend e.update() eine andere Groesse bekommt.
  // Dazwischen liegen minMoveThrottle, die Gangbaender und die Abbildung auf das Gasbyte.
  // Gemessen lieferte die Bisektion 2,3 Prozent, wo der Arbeitspunkt bei 23 liegt.
  //
  // Stattdessen ein I-Anteil, siehe ghostSpeedControl. Er muss die Abbildung nicht kennen,
  // weil er sie erlaeuft, und er bleibt richtig, wenn jemand am Antriebsstrang dreht.
  //
  // GHOST_KI_GAS: 1,2 je Sekunde. Bei einer Abweichung von 0,11 - der gemessenen
  // Beharrungsabweichung - baut sich damit in etwa 0,8 s der fehlende Gasanteil auf. Deutlich
  // langsamer als der P-Anteil, wie es sich fuer einen I-Anteil gehoert.
  const GHOST_KI_GAS = 1.2;
  // Wie schnell der I-Anteil beim Bremsen wieder abgebaut wird. Ohne das drueckt er beim
  // Kurvenausgang sofort wieder Vollgas: er ist auf der Geraden davor volllaufen.
  const GHOST_KI_ABBAU = 3.0;

  // Der Tempo-Regler, AUSGELAGERT damit er pruefbar ist.
  //
  // Vorher stand er als sechs Zeilen mitten in ghostTick, und dort ist er nur mit einem
  // vollstaendigen Ghost samt Bluetooth-Verbindung erreichbar - also gar nicht. Eine
  // Behauptung wie "nach dem Entparken gibt er nicht sofort Vollgas" war damit nicht
  // nachweisbar, sondern nur lesbar. Jetzt ist sie messbar.
  //
  // Er ist absichtlich ZUSTANDSBEHAFTET (g.lastThrottle/lastBrake) und nicht rein: die
  // Ratenbegrenzung braucht den letzten Ausgang. Der Zustand liegt am Ghost, nicht in der
  // Funktion, damit mehrere Autos sich nicht gegenseitig stoeren.
  //
  // TOTBAND: vorher waren die Verstaerkungen 4 und 3, und damit ergab eine Abweichung von
  // einem Viertel schon Vollgas beziehungsweise ein Drittel Vollbremsung - der Ghost
  // pendelte zwischen beidem statt zu fahren. Ohne Totband findet ein P-Regler keine Ruhe.
  //
  // ASYMMETRISCH, und das ist eine Aussage ueber Autos: Gas nimmt man weich, gebremst wird
  // entschlossen. Deshalb die hoehere Bremsverstaerkung und die lockerere Ratenbegrenzung
  // fuer die Bremse.
  function ghostSpeedControl(g, target, v, dtG) {
    const err = target - v;
    // DER I-ANTEIL IST DER ARBEITSPUNKT, der P-Anteil korrigiert darum herum.
    //
    // Ohne ihn musste die Abweichung das ganze Gas erzeugen - und eine Abweichung, die Gas
    // erzeugt, verschwindet nicht. Das ist die Beharrungsabweichung eines reinen P-Reglers,
    // und sie war hier gross: Ziel 35 Prozent, erreicht 24, gemessen auf reiner Gerade ohne
    // jede Lenkung. Jeder Abschlag auf das Zieltempo - Kurve, Windschatten, Gummiband, gelbe
    // Flagge - wurde dadurch in einen Bereich gequetscht, in dem er im Rauschen verschwand.
    //
    // ER STEHT IM TOTBAND AUCH, und das ist der Punkt des Totbands: es soll das Pendeln um
    // den Zielwert beenden, nicht das Gas abstellen. Vorher fiel das Auto im Totband auf
    // null Gas, verlor Tempo, bis die Abweichung das Totband verliess, gab Gas, kam ins
    // Totband, fiel auf null - ein Saegezahn genau um den Zielwert.
    const iAlt = g.iTerm || 0;
    let iNeu = Math.max(0, Math.min(1, iAlt + err * GHOST_KI_GAS * dtG));
    const roh = Math.abs(err) < GHOST_DEADBAND
      ? { t: Math.max(0, Math.min(1, iNeu)), b: 0 }
      : { t: Math.max(0, Math.min(1, iNeu + err * GHOST_KP_GAS)),
          b: Math.max(0, Math.min(1, -err * GHOST_KP_BREMSE)) };
    // ANTI-WINDUP, zwei Faelle, und beide sind hier notwendig:
    //
    // 1. Wird gebremst, wird der I-Anteil ABGEBAUT und nicht nur nicht weiter geladen. Er
    //    ist auf der Geraden davor volllaufen, und ohne Abbau drueckt er am Kurvenausgang
    //    sofort wieder Vollgas - genau der Ruck, den ein Ghost nicht haben soll.
    // 2. Steht der Ausgang am Anschlag, wird nicht weiter integriert. Sonst laedt sich der
    //    I-Anteil waehrend einer langen Vollgasphase auf einen Wert, den er danach erst
    //    wieder abbauen muss, und das Auto ueberschiesst sein neues, kleineres Ziel.
    if (roh.b > 0.02) iNeu = Math.max(0, iAlt * (1 - Math.min(1, GHOST_KI_ABBAU * dtG)));
    else if (roh.t >= 1 && err > 0) iNeu = iAlt;
    g.iTerm = iNeu;
    const zieh = (ist, soll, rate) => {
      const max = rate * dtG;
      return soll > ist ? Math.min(soll, ist + max) : Math.max(soll, ist - max);
    };
    const throttle = zieh(g.lastThrottle || 0, roh.t, GHOST_SLEW_GAS);
    const brake = zieh(g.lastBrake || 0, roh.b, GHOST_SLEW_BREMSE);
    g.lastThrottle = throttle;
    g.lastBrake = brake;
    return { throttle, brake };
  }

  // ---- Zieleinlauf: ausrollen, anhalten, dreimal blinken -----------------------------
  //
  // Vorher endete ein Rennen fuer die Ghosts mit stopGhost(): Zeitgeber weg, Nullen
  // geschrieben, Auto stand mit dunklem Licht da. Jetzt rollt es aus und meldet sich.
  //
  // KEINE RECHTSKURVE MEHR. Ein Anlauf hat versucht, sie an den rechten Rand zu fahren -
  // das ist wieder heraus. Ohne Rueckmeldung zur Querlage ist "an den Rand" eine offene
  // Steuerung: das Auto weiss nicht, wo der Rand ist, es weiss nur, dass es rechts
  // einschlaegt. Auf der Bahn sah das nicht nach Herausfahren aus, sondern danach, dass am
  // Ende jedes Rennens alle Autos gleichzeitig eine Rechtskurve fahren. Geradeaus
  // anzuhalten ist ehrlicher und war auch das, was gewuenscht wurde.
  //
  // Die Sequenz schreibt weiter KEINE Modus-Bytes und kein Modus-Bit: der
  // Leitplanken-Modus soll das stehende Auto nicht weiter fuehren wollen.
  const FINISH_ROLL_MS = 700;       // ausrollen, Gas schon auf null
  const FINISH_BRAKE_MS = 450;
  const FINISH_BLINKS = 3;
  const FINISH_BLINK_MS = 260;

  function finishGhost(car) {
    const g = car.ghost;
    if (!g) { stopGhost(car); return; }
    if (g.finish) return;           // laeuft schon, nicht neu anstossen
    g.finish = { phase: 'roll', at: Date.now() };
  }

  // Ein Takt der Sequenz. Laeuft im gewohnten Zeitgeber des Ghosts und schreibt die Bytes
  // direkt, nicht durch die Physik: ein Parkmanoever ueber zwei Sekunden braucht kein
  // Fahrzeugmodell, und der Tempo-Regler wuerde bei Ziel 0 nur dagegenarbeiten.
  function ghostFinishTick(car) {
    const g = car.ghost, f = g.finish, now = Date.now();
    const seit = now - f.at;
    const bit = trackModeBit();
    if (f.phase === 'roll') {
      if (seit >= FINISH_ROLL_MS) { f.phase = 'brake'; f.at = now; return; }
      // Gas aus, Lenkung GERADE. Ausrollen und nicht hart abschneiden: das Auto rollt sonst
      // mit einem Ruck aus, und die Bremsphase danach setzt den Punkt sowieso.
      writeToCar(car, 0, 0, bit | LIGHT_HEAD);
      return;
    }
    if (f.phase === 'brake') {
      if (seit >= FINISH_BRAKE_MS) { f.phase = 'blink'; f.at = now; return; }
      writeToCar(car, 0, 0, bit | LIGHT_HEAD | LIGHT_BRAKE);
      return;
    }
    // Dreimal blinken. Ein Blinken ist AN und AUS, also zaehlt der Schritt Halbphasen und
    // die Grenze steht auf dem Doppelten - hier faellt man sonst um den Faktor zwei daneben.
    const schritt = Math.floor(seit / FINISH_BLINK_MS);
    if (schritt >= FINISH_BLINKS * 2) {
      g.finish = null;
      stopGhost(car);               // Zeitgeber aus, Standlicht an
      return;
    }
    // MIT AUS ANFANGEN. Die zwei Phasen davor hatten das Standlicht durchgehend an; ein
    // Blinken, das mit AN beginnt, hat seinen ersten Blitz also unsichtbar an das Standlicht
    // angeklebt - man sieht zwei und zaehlt drei. Ungerade = an ergibt bei sechs Halbphasen
    // genau drei sichtbare Blitze.
    writeToCar(car, 0, 0, bit | (schritt % 2 === 1 ? LIGHT_HEAD : 0));
  }

  function unparkCar(car, why) {
    if (!car.parked) return;
    car.parked = null;
    if (car.ghost) {
      car.ghost.cutOut = false; car.ghost.offSince = 0;
      car.ghost.unparkAt = Date.now();
      // Den I-Anteil loeschen. Er ist waehrend des Stillstands nicht gewachsen (geparkt wird
      // ghostSpeedControl nicht gerufen), aber der Wert VOR dem Abflug steht noch da - und
      // der gehoert zu einem Tempo, das dieses Auto gerade nicht hat. Mit ihm wuerde die
      // Anfahrrampe umgangen.
      car.ghost.iTerm = 0;
    }
    log(garageLabel(car) + ': ' + why + ', f\u00e4hrt weiter.', 'info');
    showHudToast(garageLabel(car).toUpperCase() + ' F\u00c4HRT');
  }

  // ---- Gelbe Flagge: eine Sekunde halten ----
  //
  // Sie ist die folgenreichste Taste im Cockpit - sie bremst JEDES Auto auf 40 km/h - und
  // X liegt neben allem anderen. Ein Fehltipper mitten in einer Runde ist teuer. Und die
  // Taste war doppelt belegt: derselbe kurze Druck hiess je nach Zustand "Gelb" oder
  // "Anfahrt starten".
  //
  // Eine Sekunde halten macht aus einem Versehen eine Absicht. Der Ladebalken laeuft im
  // Knopf selbst, damit die Rueckmeldung dort ist, wo die Wirkung angeschrieben steht -
  // und nicht in einer Meldezeile, auf die man beim Fahren nicht sieht.
  const FLAG_HOLD_MS = 1000;
  const FLAG_HOLD_TICK_MS = 40;
  let flagHoldStart = null;
  let flagHoldTimer = null;

  // ZEITGEBER und nicht requestAnimationFrame. Erster Versuch war rAF, und der zaehlte
  // nicht: rAF wird vom Browser angehalten, solange die Seite nicht gezeichnet wird
  // (verdeckt, minimiert, Hintergrundtab). Gemessen blieb der Balken bei 0,0 % stehen und
  // die Flagge loeste nie aus.
  //
  // Dieselbe Falle ist in physicsStep() schon aufgeschrieben, mit demselben Schluss - dort
  // haette sie ein Auto weiterfahren lassen, waehrend die Physik stand. Eine Geste, deren
  // Fortschritt an der Bildrate haengt, ist keine Zeitmessung.
  function flagHoldPaint() {
    const b = $('race-act-flag');
    if (!b) return;
    if (flagHoldStart === null) { b.style.removeProperty('--hold'); return; }
    const p = Math.min(1, (Date.now() - flagHoldStart) / FLAG_HOLD_MS);
    b.style.setProperty('--hold', (p * 100).toFixed(1) + '%');
    if (p >= 1) flagHoldRelease(true);
  }

  function flagHoldPress() {
    if (flagHoldStart !== null) return;          // schon am Halten
    if (flagState === 'restart') return;         // die Ampel laeuft, nichts umschalten
    flagHoldStart = Date.now();
    flagHoldPaint();
    flagHoldTimer = setInterval(flagHoldPaint, FLAG_HOLD_TICK_MS);
  }

  // ausgeloest = true heisst: die Sekunde ist voll. Sonst wurde zu frueh losgelassen, und
  // dann passiert ausdruecklich NICHTS - ein halber Druck darf keine halbe Wirkung haben.
  function flagHoldRelease(ausgeloest) {
    if (flagHoldStart === null) return;
    flagHoldStart = null;
    if (flagHoldTimer !== null) { clearInterval(flagHoldTimer); flagHoldTimer = null; }
    const b = $('race-act-flag');
    if (b) b.style.removeProperty('--hold');
    if (!ausgeloest) return;
    if (flagState === 'green') setFlag('yellow');
    else if (flagState === 'yellow') yellowRestart();
  }

  // ---- Gelbe Flagge ----
  // Wie in der Original-App: alles rollt langsam und mittig weiter, keiner ueberholt, die
  // Lichter blinken. Genau die Phase, in der man ein Auto von Hand zurueckstellt.
  let flagState = 'green';          // green | yellow | restart
  function setFlag(next) {
    if (next === flagState) return;
    flagState = next;
    if (next === 'yellow') {
      limitYellow = yellowFactor();
      applySpeedLimit();
      // Angriffe abbrechen: waehrend Gelb wird nicht ueberholt.
      garage.forEach(c => { if (c.ghost) { c.ghost.attackUntil = 0; c.ghost.attackSide = 0; } });
      log('GELBE FLAGGE. Alle Autos ' + YELLOW_KMH + ' km/h, mittig, kein Ueberholen. '
          + 'Stehende Autos bleiben stehen, bis sie geschuettelt werden. Nochmal X startet '
          + 'die Ampel.', 'err');
      showHudToast('GELBE FLAGGE');
      setRaceLights(0);
    } else if (next === 'green') {
      limitYellow = 1;
      applySpeedLimit();
      log('Gr\u00fcn. Volle Kontrolle.', 'info');
      showHudToast('GR\u00dcN');
    }
    updateFlagUi();
  }

  function updateFlagUi() {
    document.body.classList.toggle('flag-yellow', flagState !== 'green');
    const b = $('race-act-flag');
    if (b) {
      // DURCH t(), und das ist die Hausregel fuer im Code zusammengesetzte Texte: der
      // Uebersetzer laeuft ueber die Textknoten des Dokuments, und was danach per
      // textContent hineingeschrieben wird, hat er nie gesehen. Gefunden hat es der
      // Flaggentest - aber erst, als die App zufaellig auf Englisch stand.
      b.textContent = t(flagState === 'yellow' ? 'Freigeben'
                    : flagState === 'restart' ? 'Anfahrt' : 'Gelbe Flagge');
      b.classList.toggle('flagged', flagState !== 'green');
      // Waehrend der Anfahrt ist der Knopf gesperrt: die Ampel laeuft, ein zweites
      // Umschalten mitten hinein waere ein Zustand, den niemand gemeint hat.
      b.disabled = flagState === 'restart';
    }
    const el = $('race-flag');
    if (el) {
      // Der Autopilot wird HIER angeschrieben und nicht in einer eigenen Kachel: der
      // Flaggenstreifen ist die einzige Anzeige, die waehrend Gelb etwas Neues sagt, und
      // ein Auto, das von selbst Gas gibt, ohne dass das irgendwo steht, sieht beim ersten
      // Mal wie ein durchgehendes Auto aus.
      //
      // DIE BEDINGUNG STAND HIER ABGESCHRIEBEN, mit dem Vermerk: waeren es drei Stellen,
      // gehoerte eine Funktion daraus. Mit der Einfuehrungsrunde sind es drei, also fragt
      // die Anzeige jetzt die Regelung - autopilotGrund() in 50-drive.js, direkt gerufen,
      // weil Funktionsdeklarationen ueber den einen Skriptblock hinweg hochgezogen werden
      // und 50 ohnehin vor 90 gebaut wird.
      //
      // Und die Einfuehrungsrunde steht MIT DRIN, aus demselben Grund, der schon fuer Gelb
      // aufgeschrieben war: ein Auto, das von selbst Gas gibt, ohne dass das irgendwo steht,
      // sieht beim ersten Mal wie ein durchgehendes Auto aus.
      const grund = autopilotGrund();
      const flaggenText = flagState === 'yellow' ? (grund === 'yellow' ? 'GELB · AUTOPILOT' : 'GELB')
                     : flagState === 'restart' ? 'ANFAHRT'
                     : grund === 'formation' ? 'EINFÜHRUNGSRUNDE · AUTOPILOT'
                     : raceFormationLap ? 'EINFÜHRUNGSRUNDE' : '';
      el.textContent = flaggenText ? t(flaggenText) : '';
      el.style.display = el.textContent ? '' : 'none';
    }
  }

  // Aus Gelb heraus wird nicht einfach umgeschaltet, sondern angefahren: dieselbe Ampel wie
  // beim Start, damit der Moment, ab dem wieder ueberholt werden darf, fuer alle derselbe
  // und sichtbar ist.
  function yellowRestart() {
    if (flagState !== 'yellow') return;
    flagState = 'restart';
    updateFlagUi();
    let step = 3;
    setRaceLights(3);
    playTone(660, 0.18, 'square', 0.18);
    const t = setInterval(() => {
      step--;
      if (step > 0) { setRaceLights(step); playTone(660, 0.18, 'square', 0.18); return; }
      clearInterval(t);
      setRaceLights('go');
      playTone(880, 0.35, 'square', 0.22);
      setFlag('green');
      setTimeout(() => setRaceLights(0), 900);
    }, 1000);
  }

  // ---- Rennwuerze ----
  //
  // Warum ueberhaupt: zwei Ghosts mit gleicher Einstellung fahren gleich schnell, ewig
  // hintereinander, und nichts passiert. Ein Rennen entsteht nicht aus Zufall allein,
  // sondern daraus, dass Abstaende sich AENDERN und dass Naehe etwas bewirkt. Deshalb sind
  // es fuenf Bausteine und nicht ein Rauschen:
  //
  //   1. TAGESFORM   Ein begrenzter Zufallslauf je Auto, alle paar Sekunden fortgesetzt.
  //                  Sorgt fuer streuende Rundenzeiten - der Grundstoff, aus dem Abstaende
  //                  entstehen. Ein reines Rauschen pro Takt waere unsichtbar, weil es
  //                  sich innerhalb einer Runde wegmittelt; ein Zufallslauf haelt an.
  //   2. FEHLER      Selten, kurz, deutlich: beim Anbremsen einer Kurve verliert das Auto
  //                  fuer eine halbe Sekunde Tempo. Das ist der Moment, in dem ein
  //                  Rueckstand entsteht, den man SIEHT - anders als bei langsam
  //                  auseinanderdriftenden Rundenzeiten.
  //   3. WINDSCHATTEN Dicht hinter einem anderen wird man schneller. Das ist der Baustein,
  //                  der Ueberholvorgaenge aus der POSITION entstehen laesst statt aus dem
  //                  Wuerfel: wer aufholt, holt schneller weiter auf.
  //   4. ATTACKE     Wer lange klebt, versucht es - auf der anderen Seite der Ideallinie,
  //                  mit einem kurzen Schub. Ohne diesen Baustein kaeme der Verfolger bis
  //                  auf einen Meter und blieb dort, weil beide dieselbe Linie fahren.
  //   5. GUMMIBAND   Der Fuehrende wird gebremst, proportional zum Vorsprung und begrenzt.
  //                  Haelt das Feld zusammen, ohne die Reihenfolge zu verfaelschen.
  //
  // Alles skaliert mit EINEM Regler, und auf 0 ist jeder Baustein wirkungslos - das ist
  // die Einstellung, in der die Ideallinie und die Querablage gemessen werden koennen.
  const SPICE_FORM_MS = 2600;      // wie oft die Tagesform fortgeschrieben wird
  const SPICE_FORM_AMP = 0.075;    // volle Wuerze: +/- 7.5 % Dauertempo
  const SPICE_FORM_STEP = 0.03;    // Schrittweite des Zufallslaufs
  const SPICE_MISTAKE_P = 0.055;   // Wahrscheinlichkeit je angebremster Kurve
  const SPICE_MISTAKE_MS = [420, 900];
  const SPICE_MISTAKE_CUT = 0.45;  // wieviel Tempo der Fehler kostet
  const SPICE_SLIP_TILES = 1.3;    // bis hierher wirkt Windschatten
  const SPICE_SLIP_GAIN = 0.11;
  const SPICE_ATTACK_MS = 2600;
  const SPICE_ATTACK_ARM_MS = 900;  // so lange muss man kleben, bevor es losgeht
  const SPICE_ATTACK_P = 0.45;      // und dann wird gewuerfelt, sonst ist es kein Rennen
  // WIE NAH "in Reichweite" ist, und das MUSS ueber SPICE_GAP_MIN liegen.
  //
  // Vorher stand hier 0,9 als Zahl im Code, waehrend der Abstandhalter ab 0,7 lupft (plus
  // Zuschlag beim Annaehern). Das Angriffsfenster war damit 0,2 Kacheln breit, und der
  // Abstandhalter druckte den Verfolger genau daraus heraus - er pendelte um 0,8, wurde
  // gelupft, fiel zurueck, und eine Attacke kam fast nie zustande. Zwei Regeln, die
  // dasselbe Band bestreiten.
  //
  // 1,3 loest es an der richtigen Stelle: der Abstandhalter sagt weiter "nicht kleben", die
  // Attacke sagt "du bist in Reichweite". Waehrend einer Attacke ist der Abstandhalter aus,
  // der Verfolger darf also heran - genau dafuer ist die Ausnahme dort.
  const SPICE_ATTACK_RANGE = 1.3;
  // WIE OFT gewuerfelt wird. Vorher alle 4000 ms: bei Wuerze 0,4 ist die
  // Wahrscheinlichkeit 0,18 je Versuch, also eine Attacke pro 22 Sekunden durchgehenden
  // Klebens. Das liest sich nicht als Rennen, sondern als Kolonne.
  //
  // 1200 ms ergeben bei Wuerze 0,4 eine Wartezeit von 6,7 Sekunden und bei voller Wuerze
  // 2,7 - oft genug, um es zu sehen, selten genug, dass es nicht im Sekundentakt zerrt. Die
  // Wahrscheinlichkeit selbst bleibt, damit die Wuerze weiter der eine Regler ist.
  const SPICE_ATTACK_RETRY_MS = 1200;
  const SPICE_ATTACK_GAIN = 0.07;
  // ERST AUSWEICHEN, DANN BESCHLEUNIGEN. Vorher kamen Seitenversatz und Temposchub
  // gleichzeitig, also schob der Angreifer, solange er noch genau hinter dem anderen lag -
  // und dann beruehren sich zwei Autos, statt aneinander vorbeizufahren. 400 ms sind bei
  // GHOST_BIAS_STEP genug, um den Versatz aufzubauen.
  const SPICE_ATTACK_SIDE_MS = 400;
  // Wie stark Angreifer und Vorausfahrender zur Seite gehen. Getrennt von der Ideallinie:
  // das ist ein Ausweichen und keine Linienwahl, und es haengt deshalb an ghostCfg.lateral -
  // dem Regler, der ausdruecklich "Querablage gegen Rammen" heisst. Vorher war der
  // Seitenversatz des Angreifers mit ghostCfg.line skaliert: stand die Ideallinie auf 0,
  // fuhr er OHNE Versatz in den Vorausfahrenden.
  const GHOST_PASS_STEER = 0.8;

  // ---- 1. UEBERHOLEN ALS SEQUENZ ----------------------------------------------------
  //
  // Vorher war eine Attacke ein ZUSTAND von 2,6 s: Seitenversatz und Temposchub, dann
  // vorbei - unabhaengig davon, ob das Manoever geglueckt war. Genau die fehlende
  // Abbruchbedingung erzeugt das Nebeneinander-Kleben, in dem Beruehrungen passieren: zwei
  // Autos auf gleicher Hoehe, keines gibt nach, und nach 2,6 s hoert der Versatz einfach auf.
  //
  // Jetzt vier Phasen mit Ausgang:
  //
  //   raus    Seitenversatz aufbauen, NOCH KEIN Schub. 400 ms.
  //   vorbei  Schub an, Versatz gehalten.
  //   rein    vorne heraus - Versatz faehrt ueber 700 ms zurueck auf die eigene Linie.
  //   Abbruch nach 5 s nicht vorbei: Schub aus, einordnen, und eine laengere Sperre, damit
  //           er es nicht sofort wieder versucht. Ein Ghost, der es dreimal in Folge
  //           probiert und dreimal daneben liegt, ist genau der, der rammt.
  const SPICE_PASS_MAX_MS = 5000;      // so lange darf ein Versuch dauern
  const SPICE_PASS_TUCK_MS = 700;      // so lange dauert das Einordnen
  const SPICE_PASS_CLEAR = 0.45;       // Kacheln VOR dem anderen = geschafft
  const SPICE_PASS_BLOCK_MS = 6000;    // Sperre nach einem Abbruch

  // ---- 2. ZEITLUECKE STATT KACHELABSTAND -------------------------------------------
  //
  // Der Mindestabstand rechnete in Kacheln. Das ist die falsche Groesse: wer mit hohem
  // Tempodelta auf eine Kachel Abstand zufaehrt, ist gefaehrlich; wer bei gleichem Tempo
  // eine halbe Kachel hinterherfaehrt, nicht. Der noetige Abstand waechst deshalb mit der
  // ANNAEHERUNGSRATE.
  //
  // Die Rate wird numerisch aus dem Abstand gebildet und nicht aus den Tempi: Tempi muessten
  // erst ueber Kachellaengen in Kacheln je Sekunde umgerechnet werden, und diese Umrechnung
  // haengt am Layout. Der Abstand selbst ist schon in Kacheln, seine Ableitung also in
  // Kacheln je Sekunde - ohne eine einzige Annahme.
  const SPICE_GAP_PER_CLOSING = 0.5;   // Kacheln Aufschlag je Kachel/s Annaeherung
  const SPICE_GAP_GLATT = 0.3;         // Glaettung der Ableitung, 0..1

  // ---- 3. SPURDISZIPLIN ------------------------------------------------------------
  //
  // Auf der Geraden soll jeder seine eigene Spur halten - dann faehrt man hintereinander,
  // aber auf verschiedenen Linien. In der Kurve wollen alle zum Scheitel, und dort soll die
  // Ideallinie das Sagen haben. Vorher waren beide Anteile FEST addiert, also galt auf der
  // Geraden dieselbe Mischung wie im Bogen.
  //
  // MIT HYSTERESE, und die ist der Punkt: der Kacheltyp wechselt sprunghaft, und ein
  // sprunghafter Wechsel der Mischung ist ein Ruck am Lenkservo. Der Mix laeuft deshalb mit
  // einer Zeitkonstante nach - 350 ms, etwa eine halbe Kachel bei diesen Tempi.
  const GHOST_MIX_TAU = 0.35;          // s
  const GHOST_LANE_DROP = 0.5;         // in der Kurve bleibt die halbe Spur
  const GHOST_LINE_STRAIGHT = 0.35;    // auf der Geraden wirkt ein Drittel der Linie
  const SPICE_BAND_PER_TILE = 0.022;
  const SPICE_BAND_MAX = 0.13;
  // 6. ABSTAND. Es gab keinen Baustein, der Autos auseinander haelt: Windschatten und
  // Attacke ziehen sie zusammen, das Gummiband bremst nur den Fuehrenden. Zwei Ghosts
  // konnten also Stossstange an Stossstange fahren, und genau so wurde es gemeldet.
  //
  // 0,7 Kacheln sind bei 43 cm Kachellaenge etwa 30 cm, also zwei bis drei Fahrzeuglaengen.
  // Der Abzug greift linear ab dieser Schwelle und ist bei Beruehrung am groessten.
  //
  // WAEHREND EINER ATTACKE GILT ER NICHT. Sonst waere das Ueberholen weg, und das
  // funktioniert gerade - der Verfolger muss dichter heran duerfen als der, der nur
  // mitfaehrt. Das ist der ganze Unterschied zwischen Hinterherfahren und Angreifen.
  const SPICE_GAP_MIN = 0.7;    // Kacheln, ab hier wird gelupft
  const SPICE_GAP_LIFT = 0.26;  // hoechster Tempoabzug bei Beruehrung

  // Fortschritt in Kacheln seit dem Start, mit Bruchteil. Absichtlich NICHT ueber den
  // Kachelindex der Karte: ohne eingescannte Strecke gibt es keinen, und Abstaende soll man
  // auch dann messen koennen.
  function ghostProgress(car) {
    const g = car.ghost;
    if (!g) return 0;
    return (g.tilesTotal || 0) + ghostTilePhase(car);
  }

  function ghostFieldRacing() {
    return garage.filter(c => c.ghost && (c.role === 'ghost' || c === playerCar));
  }

  // Das Auto direkt voraus und der Abstand in Kacheln. null, wenn keiner voraus ist.
  function ghostAhead(car) {
    const me = ghostProgress(car);
    let best = null, bestGap = Infinity;
    for (const o of ghostFieldRacing()) {
      if (o === car) continue;
      const gap = ghostProgress(o) - me;
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = o; }
    }
    return best ? { car: best, gap: bestGap } : null;
  }

  // Wie schnell schrumpft der Abstand, in Kacheln je Sekunde? Numerisch aus dem Abstand
  // selbst, nicht aus den Tempi: der Abstand ist schon in Kacheln, seine Ableitung also in
  // Kacheln je Sekunde - eine Umrechnung ueber Kachellaengen wuerde eine Layout-Annahme
  // einfuehren, die hier keine braucht.
  //
  // Geglaettet, weil eine Ableitung auf einer geschaetzten Groesse rauscht: der Abstand
  // enthaelt die Phase innerhalb der Kachel, und die ist eine Schaetzung aus der gemessenen
  // Kacheldauer.
  function ghostClosing(car, gap) {
    const g = car.ghost;
    const now = Date.now();
    if (gap === null) { g.gapLast = undefined; g.naehern = 0; return 0; }
    let roh = 0;
    if (g.gapLast !== undefined && g.gapAt) {
      const dtg = Math.max(0.02, (now - g.gapAt) / 1000);
      roh = (g.gapLast - gap) / dtg;
    }
    g.gapLast = gap; g.gapAt = now;
    g.naehern = (g.naehern || 0) * (1 - SPICE_GAP_GLATT) + roh * SPICE_GAP_GLATT;
    return g.naehern;
  }

  // Tagesform fortschreiben. Begrenzter Zufallslauf: er haelt an, laeuft aber nicht weg.
  function ghostFormTick(car) {
    const g = car.ghost, now = Date.now();
    if (!g.formAt) { g.formAt = now; g.form = 0; return; }
    if (now - g.formAt < SPICE_FORM_MS) return;
    g.formAt = now;
    const amp = SPICE_FORM_AMP * ghostCfg.spice;
    g.form = Math.max(-amp, Math.min(amp,
      (g.form || 0) + (Math.random() * 2 - 1) * SPICE_FORM_STEP * ghostCfg.spice));
  }

  // Alle fuenf Bausteine auf das Zieltempo. Rueckgabe: der Faktor, und ob gerade attackiert
  // wird (das braucht die Linie, nicht das Tempo).
  function ghostSpice(car, aheadTight) {
    const g = car.ghost, now = Date.now();
    if (!ghostCfg.spice) { g.attackUntil = 0; return { factor: 1, attack: 0 }; }

    ghostFormTick(car);
    let f = 1 + (g.form || 0);

    // 2. Fehler: gewuerfelt wird EINMAL je angebremster Kurve, nicht je Takt - sonst
    // haengt die Fehlerrate an der Taktfrequenz und nicht am Rennen.
    if (aheadTight.tight > 0 && aheadTight.dist <= 1) {
      if (g.mistakeArmed !== aheadTight.key) {
        g.mistakeArmed = aheadTight.key;
        if (Math.random() < SPICE_MISTAKE_P * ghostCfg.spice) {
          const d = SPICE_MISTAKE_MS[0]
                  + Math.random() * (SPICE_MISTAKE_MS[1] - SPICE_MISTAKE_MS[0]);
          g.mistakeUntil = now + d;
          log(garageLabel(car) + ': verbremst sich.', 'info');
        }
      }
    } else if (aheadTight.tight === 0) {
      g.mistakeArmed = null;
    }
    if (g.mistakeUntil && now < g.mistakeUntil) f *= (1 - SPICE_MISTAKE_CUT * ghostCfg.spice);

    const ah = ghostAhead(car);
    const onStraight = aheadTight.tight === 0;

    // 3. Windschatten
    if (ah && ah.gap <= SPICE_SLIP_TILES && onStraight) {
      f *= 1 + SPICE_SLIP_GAIN * ghostCfg.spice * (1 - ah.gap / SPICE_SLIP_TILES);
    }

    // 4. Attacke
    if (ah && ah.gap <= SPICE_ATTACK_RANGE) {
      if (!g.closeSince) g.closeSince = now;
    } else {
      g.closeSince = 0;
    }
    // ---- Die Ueberholsequenz fortschreiben ----
    if (g.attackUntil) {
      const seit = now - (g.passSince || now);
      const ziel = g.passZiel;
      // Geschafft? Der Fortschritt entscheidet, nicht die Uhr.
      const durch = ziel && ziel.ghost
        && ghostProgress(car) > ghostProgress(ziel) + SPICE_PASS_CLEAR;
      if (g.passPhase !== 'rein' && durch) {
        g.passPhase = 'rein'; g.passAt = now;
        log(garageLabel(car) + ': vorbei an '
            + (ziel ? garageLabel(ziel) : '?') + ', ordnet sich ein.', 'info');
      } else if (g.passPhase === 'raus' && seit > SPICE_ATTACK_SIDE_MS) {
        g.passPhase = 'vorbei';
      }
      if (g.passPhase === 'rein' && now - g.passAt > SPICE_PASS_TUCK_MS) {
        g.attackUntil = 0; g.attackSide = 0; g.passZiel = null; g.passPhase = null;
      } else if (g.passPhase !== 'rein' && seit > SPICE_PASS_MAX_MS) {
        // ABBRUCH. Der wichtigste Ausgang: ohne ihn klebt der Verfolger neben dem anderen,
        // bis die Uhr ablaeuft, und genau dort beruehren sich zwei Autos.
        g.attackUntil = 0; g.attackSide = 0; g.passZiel = null; g.passPhase = null;
        g.passBlockUntil = now + SPICE_PASS_BLOCK_MS;
        log(garageLabel(car) + ': kommt nicht vorbei, ordnet sich wieder ein.', 'info');
      }
    }
    if (!g.attackUntil && g.closeSince && now - g.closeSince > SPICE_ATTACK_ARM_MS
        && onStraight
        // 4. KEIN ANGRIFF IN EINE KURVE HINEIN. onStraight prueft den Vorausblick, und den
        // gibt es nur mit Karte - ohne Karte ist er immer "frei", und dann wurde auch mitten
        // in einer Haarnadel angesetzt. Der gemeldete Code der Kachel UNTER dem Auto braucht
        // keine Karte und schliesst genau diesen Fall.
        && ghostTileInfo(car.tileCode).curve === 0
        && now > (g.passBlockUntil || 0)
        && now - (g.attackTriedAt || 0) > SPICE_ATTACK_RETRY_MS) {
      g.attackTriedAt = now;
      if (Math.random() < SPICE_ATTACK_P * ghostCfg.spice) {
        // attackUntil bleibt als "eine Sequenz laeuft"-Marke; die Phasen entscheiden.
        // Die Obergrenze steht jetzt bei SPICE_PASS_MAX_MS, nicht bei SPICE_ATTACK_MS.
        g.attackUntil = now + SPICE_PASS_MAX_MS + SPICE_PASS_TUCK_MS;
        g.passSince = now;
        g.passPhase = 'raus';
        // Die andere Seite als die, auf der die Linie gerade liegt. Genau dafuer ist die
        // Linie da: ohne sie waere "die andere Seite" nicht definiert.
        const lo = ghostLineOffset(car);
        g.attackSide = lo >= 0 ? -1 : 1;
        // UND DER VORAUSFAHRENDE WEICHT MIT AUS, zur anderen Seite. Vorher wich nur einer
        // aus, und zwei Autos auf 25 cm Bahnbreite brauchen beide Haelften - gemeldet als
        // "beim Ueberholen beruehren sie sich stark".
        //
        // Gesetzt wird es am ANDEREN Auto, und das ist Absicht: der Vorausfahrende weiss
        // nicht, dass hinter ihm einer ansetzt, und soll es hier erfahren. Ein Ghost, der
        // jeden Takt selbst nachsieht, ob ihn wer angreift, waere dieselbe Rechnung n-mal.
        if (ah.car && ah.car.ghost) {
          ah.car.ghost.yieldSide = -g.attackSide;
          ah.car.ghost.yieldUntil = now + SPICE_ATTACK_MS;
        }
        log(garageLabel(car) + ': setzt zum Ueberholen an, '
            + (ah.car ? garageLabel(ah.car) + ' weicht aus.' : 'freie Bahn.'), 'info');
        showHudToast(garageLabel(car).toUpperCase() + ' ATTACKIERT');
      }
    }
    // Der Schub gilt NUR in der Phase 'vorbei': in 'raus' baut sich erst der Versatz auf,
    // in 'rein' ist das Manoever gelaufen und ein Schub waere nur noch Draengeln.
    if (g.attackUntil && g.passPhase === 'vorbei') {
      f *= 1 + SPICE_ATTACK_GAIN * ghostCfg.spice;
    }

    // 6. Abstand halten, mit ZEITLUECKE statt festem Kachelabstand. Der noetige Abstand
    // waechst mit der Annaeherungsrate: eine Kachel Abstand bei einer Kachel je Sekunde
    // Annaeherung ist eine Sekunde bis zur Beruehrung, eine Kachel bei gleichem Tempo ist
    // unbegrenzt. Nicht waehrend einer Attacke: wer angreift, darf dichter heran, sonst gibt
    // es kein Ueberholen.
    const naehern = ghostClosing(car, ah ? ah.gap : null);
    const noetig = SPICE_GAP_MIN + SPICE_GAP_PER_CLOSING * Math.max(0, naehern);
    if (ah && !g.attackUntil && ah.gap < noetig) {
      f *= 1 - SPICE_GAP_LIFT * ghostCfg.spice * (1 - ah.gap / noetig);
    }

    // 5. Gummiband: nur den Fuehrenden, und nur wenn es einen Zweiten gibt.
    const field = ghostFieldRacing();
    if (field.length > 1) {
      const mine = ghostProgress(car);
      let leader = true, second = -Infinity;
      for (const o of field) {
        if (o === car) continue;
        const p = ghostProgress(o);
        if (p > mine) leader = false;
        if (p > second) second = p;
      }
      if (leader && second > -Infinity) {
        const lead = Math.max(0, mine - second);
        f *= 1 - Math.min(SPICE_BAND_MAX, lead * SPICE_BAND_PER_TILE) * ghostCfg.spice;
      }
    }

    // Der Seitenversatz faehrt beim Einordnen ZURUECK statt abzuschalten. Ein Sprung von
    // vollem Versatz auf null ist ein Ruck am Lenkservo und sieht aus wie ein Fehler.
    const versatz = !g.attackUntil ? 0
      : g.passPhase === 'rein'
        ? (g.attackSide || 0) * Math.max(0, 1 - (now - g.passAt) / SPICE_PASS_TUCK_MS)
        : (g.attackSide || 0);
    return { factor: f, attack: versatz, phase: g.passPhase || null };
  }

  // ---- Die Ideallinie ----
  // Rueckgabe: -1 ganz links, +1 ganz rechts, 0 Mitte. Vorzeichen wie bei der Lenkung,
  // positiv = rechts.
  //
  // Aussen anstellen, innen scheiteln, aussen heraus - ueber den GANZEN Kurvenzug, nicht je
  // Kachel. Die Haarnadel scheitelt spaeter als die 60-Grad-Kurve: bei 180 Grad wird tief
  // hineingebremst und der Scheitel liegt hinter der Mitte. 0.62 gegen 0.5.
  //
  // Was hier NICHT behauptet wird: dass die Zahl Zentimeter bedeutet. Es gibt keine
  // Rueckmeldung zur Querlage, also ist das eine offene Steuerung - ein Lenkanteil, den das
  // Auto gegen seine eigene Bahnfuehrung stellt. Die Annahme dahinter, ausgesprochen: ein
  // kleiner anhaltender Lenkanteil verschiebt, wo das Auto sitzt. Ob und wieviel dabei
  // herauskommt, sagen Rundenzeit und Abgaenge im Ergebnisfenster, nicht diese Funktion.
  function ghostLineHeuristic(car) {
    const tiles = currentTrackTiles;
    const g = car.ghost;
    if (!tiles || tiles.length < 3 || !g || g.tileIndex === null) return 0;
    const n = tiles.length;
    const at = (k) => tiles[((g.tileIndex + k) % n + n) % n].type;
    const ph = ghostTilePhase(car);
    const run = ghostRun(tiles, g.tileIndex);

    if (run.dir !== 0) {
      // Ist die ganze Runde eine Kurve, gibt es kein Aussen und kein Innen mehr - dann ist
      // es ein Kreis, und die schnellste Linie darauf ist die innere. Kein Sonderfall aus
      // Vorsicht, sondern weil die Formel unten sonst ueber die ganze Runde einmal
      // durchschwingen wuerde.
      if (run.len >= n) return run.dir;
      const ends = ghostRunEnds(run);
      const apex = run.tight >= 2 ? 0.62 : 0.5;
      const t = (run.pos + ph) / run.len;          // 0 am Kurveneingang, 1 am Ausgang
      return t < apex
        ? ends.entry + (run.dir - ends.entry) * (t / apex)
        : run.dir + (ends.exit - run.dir) * ((t - apex) / (1 - apex));
    }

    // Auf der Geraden: heraustragen, was aus der letzten Kurve kommt, und anstellen fuer
    // die naechste. Beide Anteile liegen in verschiedenen Haelften der Kachel, koennen sich
    // also nicht widersprechen, und an beiden Kachelgrenzen treffen sie genau den Wert, mit
    // dem der Kurvenzug endet bzw. anfaengt - deshalb gibt es dort keinen Sprung.
    let off = 0;
    if (ghostTurnOf(at(-1)) !== 0) {
      const prev = ghostRun(tiles, g.tileIndex - 1);
      off += ghostRunEnds(prev).exit * Math.max(0, 1 - ph / 0.5);
    }
    if (ghostTurnOf(at(1)) !== 0) {
      const next = ghostRun(tiles, g.tileIndex + 1);
      off += ghostRunEnds(next).entry * Math.max(0, (ph - 0.5) / 0.5);
    }
    return Math.max(-1, Math.min(1, off));
  }

  // ---- EINE Ideallinie fuer Bild und Auto ----
  //
  // Hier lagen zwei verschiedene Linien im Programm, und das war ein echter Fehler, kein
  // Schoenheitsproblem: der Editor zeichnete eine Minimalkruemmungslinie (idealLine(),
  // Relaxation ueber die Mittellinie, 2000 Durchlaeufe, auf die Bahnbreite begrenzt), und
  // die Ghosts fuhren meine Handregel "aussen, Scheitel, aussen". Wer im Editor eine Linie
  // sieht und dann zuschaut, wie das Auto eine andere faehrt, kann keiner von beiden
  // trauen.
  //
  // Also: die Ghosts lesen jetzt genau die Linie aus dem Editor. Die Vorzeichen passen ohne
  // Umrechnung bis auf das VORZEICHEN: trackNormals() zeigt nach LINKS in Fahrtrichtung
  // (gemessen, siehe dort), positive Lenkung ist rechts. Deshalb steht in ghostLineOffset()
  // ein Minus. Geteilt durch die Spanne ergibt das den Bereich -1 bis +1, den die
  // Ghost-Lenkung erwartet.
  //
  // Dazu kommt das Bremsprofil, das der Editor ohnehin schon rechnet und rot einfaerbt:
  // brakeProfile() misst den ANSTIEG der Kruemmung voraus, nicht die Kruemmung selbst - eine
  // Kurve, die man schon mit konstantem Radius faehrt, braucht kein Bremsen mehr. Das ist
  // genau die Groesse, die ein Tempoprofil braucht, und sie war da.
  //
  // Die Handregel bleibt als Rueckfall fuer den Fall, dass die Relaxation nichts findet
  // (zu wenige Kacheln), und weil sie ohne Layout-Geometrie auskommt.
  let lineCache = null;
  function ghostLine() {
    const tiles = currentTrackTiles;
    if (!tiles || tiles.length < 3) return null;
    // Das Modell gehoert in den Schluessel: sonst behaelt der Zwischenspeicher die Linie
    // des alten Modells, und der Schalter waere ohne Wirkung, bis sich das Layout aendert.
    if (lineCache && lineCache.tiles === tiles
        && lineCache.model === getLineModel()) return lineCache;
    const pts = trackCenterline(tiles);
    if (pts.length < 8) return null;
    const nrm = trackNormals(pts);
    const first = pts[0], last = pts[pts.length - 1];
    // 2 cm, nicht 60 Zeichnungseinheiten. Die 60 sind 64,5 cm, und eine Kachel ist
    // 43 cm lang: eine Strecke, bei der genau ein Teil fehlt, galt damit als geschlossen.
    // Im Editor war dieselbe Zahl schon berichtigt, hier stand sie noch - und hier ist sie
    // folgenreicher, weil die Ghosts danach im Kreis herum vorausschauen.
    const closed = Math.hypot(last.x - first.x, last.y - first.y) < 2 * TRACK_UNITS_PER_CM;
    const line = buildLine(pts, nrm, { closed });
    const path = pts.map((p, i) => [p.x + nrm[i].x * line.alpha[i],
                                    p.y + nrm[i].y * line.alpha[i]]);
    const brake = brakeProfile(path, closed);
    // Abtastpunkte je Kachel. Sie sind NICHT gleich viele: eine Haarnadel dreht dreimal so
    // weit und bekommt entsprechend mehr Punkte (siehe trackCenterline). Wer hier mit einer
    // festen Zahl je Kachel rechnet, laeuft auf einer Strecke mit Haarnadel aus dem Takt -
    // und zwar schleichend, weil es auf einer Strecke ohne Haarnadel stimmt.
    const ranges = tiles.map(() => ({ start: -1, count: 0 }));
    pts.forEach((p, i) => {
      if (p.tile < 0 || p.tile >= ranges.length) return;
      const r = ranges[p.tile];
      if (r.start < 0) r.start = i;
      r.count++;
    });
    lineCache = { tiles, alpha: line.alpha, limit: line.limit, span: line.span,
                  brake, ranges, closed, points: pts.length,
                  model: line.model, lapTime: line.lapTime || null,
                  gain: line.gain || 0 };
    return lineCache;
  }

  // Abtastindex fuer (Kachel, Phase). null, wenn es zu dieser Kachel keine Punkte gibt.
  function ghostLineIndex(lc, tileIndex, phase) {
    if (!lc || tileIndex === null || tileIndex === undefined) return null;
    const r = lc.ranges[((tileIndex % lc.ranges.length) + lc.ranges.length) % lc.ranges.length];
    if (!r || r.start < 0 || !r.count) return null;
    const k = Math.min(r.count - 1, Math.max(0, Math.floor(phase * r.count)));
    return r.start + k;
  }

  // ---------------------------------------------------------------- Lernen je Runde
  //
  // (1+1)-Strategie, das einfachste, was hier funktioniert: ein Elternwert, ein Kind je
  // Runde, behalten oder verwerfen. Kein Verlauf, keine Population - eine Runde ist eine
  // Auswertung, und in einem Rennen gibt es davon zwanzig, nicht zwanzigtausend. Alles
  // Groessere waere ein Verfahren, das nie genug Daten bekommt.
  //
  // Zwei Groessen werden gedreht, und zwar genau die zwei, die dieses Auto ueberhaupt hat:
  //
  //   pace  - Faktor auf das Grundtempo. Mehr Tempo, mehr Risiko.
  //   push  - Faktor auf den Ausschlag der Ideallinie. Weiter aussen anstellen und
  //           weiter innen scheiteln kostet Lenkanteil, und Lenkanteil ist das, was das
  //           Auto von der Bahn holt.
  //
  // Die Annahmeregel ist der eigentliche Inhalt: schneller UND kein Abgang. Ein Abgang
  // macht den Versuch ungueltig, egal wie schnell die Runde war. Sonst lernt das Verfahren
  // zuverlaessig, dass Abfliegen sich lohnt, solange man vorher schnell genug war.
  const LEARN_SIGMA0 = 0.055;   // Anfangsschrittweite, in Anteilen
  const LEARN_SIGMA_MIN = 0.012;
  const LEARN_SIGMA_MAX = 0.10;
  // Harte Deckel. pace nach oben, weil ein Ghost, der schneller faehrt als der Spieler es
  // koennte, kein Gegner mehr ist, sondern ein Aergernis.
  const LEARN_PACE = [0.75, 1.30];
  const LEARN_PUSH = [0.40, 1.25];

  function learnState(car) {
    if (!car.learn) {
      car.learn = { pace: 1, push: 1, sigma: LEARN_SIGMA0,
                    bestMs: null, tryPace: null, tryPush: null,
                    kept: 0, rejected: 0, offs: 0, tries: 0 };
    }
    return car.learn;
  }

  // Der Kippwert aus der Messung im Entwicklertab, als Obergrenze fuer den Lenkanteil.
  // Ohne Messung wird NICHT geraten: dann gilt ein vorsichtiger Vorgabewert, und der Grund
  // steht daneben. Ein erfundener Kippwert waere schlimmer als keiner, weil er wie eine
  // Messung aussieht.
  function learnSteerCap() {
    const zeilen = (typeof lat === 'object' && lat && lat.rows) ? lat.rows : [];
    const gekippt = zeilen.find(r => !r.ok);
    if (gekippt) {
      // Kippwert vorhanden: die Haelfte davon, wie die Doku es fuer die Ideallinie
      // festhaelt.
      return Math.max(0.15, Math.min(1, gekippt.steer * 0.5));
    }
    const hielten = zeilen.filter(r => r.ok);
    if (hielten.length) {
      // Gemessen, aber nie gekippt: dann ist der hoechste haltende Wert selbst die Grenze.
      // Ihn zu halbieren waere zu vorsichtig, ihn zu ueberschreiten unbelegt - wir wissen
      // nur, dass es BIS hierhin haelt, und nicht, wo es aufhoert.
      return Math.max(0.15, Math.min(1, hielten[hielten.length - 1].steer));
    }
    // Keine eigene Messung - aber eine fremde, und die ist besser als ein Vorgabewert aus
    // Vorsicht. Hier stand 0,55 mit dem Vermerk "einen Kippwert zu erfinden waere schlimmer
    // als keinen zu haben". Der Kippwert ist weiterhin nicht gemessen; was jetzt gemessen
    // ist, ist der Lenkbefehl, den die ORIGINAL-APP ihren eigenen Ghosts schickt:
    //
    //     Aufzeichnung 21.08., zwei Ghosts ueber 16 Runden
    //       Ghost 1   |Lenkbyte| im Mittel 32,2 von 127, Spitze 127, ungleich 0 in 56,3 %
    //       Ghost 2   |Lenkbyte| im Mittel 47,3 von 127, Spitze 127, ungleich 0 in 80,0 %
    //
    //     unsere Ghosts, Vorgabe, gemessen mit ghostDriveProbe
    //       mit Karte |Lenkbyte| im Mittel 18,3, Spitze 44
    //
    // Die Original-App faehrt also regelmaessig VOLLEN Anschlag, unsere kamen nie ueber ein
    // Drittel. Gemeldet wurde das als "sie fahren stumpf ihre Spur, keine Querlage" - und
    // das war keine Feinheit, sondern ein Deckel bei 0,55, der obendrein mit line = 0,7
    // multipliziert wird und damit bei 0,385 endete.
    //
    // Ein Deckel, der strenger ist als die App des Herstellers, ist keine Vorsicht, sondern
    // eine Einschraenkung ohne Beleg. Wer sein Auto kippen sieht, misst den Kippwert im
    // Entwicklertab unter "Querablage" - eine ECHTE Messung sticht diesen Wert weiterhin.
    return 1.0;
  }

  // Vor jeder Runde einen Versuch ziehen.
  function learnPropose(car) {
    if (!ghostCfg.learnPace || !car.ghost) return;
    const L = learnState(car);
    const w = () => (Math.random() * 2 - 1 + Math.random() * 2 - 1) / 2;   // grob normal
    L.tryPace = Math.max(LEARN_PACE[0], Math.min(LEARN_PACE[1], L.pace + w() * L.sigma));
    L.tryPush = Math.max(LEARN_PUSH[0], Math.min(LEARN_PUSH[1], L.push + w() * L.sigma));
    L.tries++;
  }

  // Nach jeder Runde bewerten. ms = Rundenzeit, offs = Abgaenge in DIESER Runde.
  function learnSettle(car, ms, offs) {
    if (!ghostCfg.learnPace || !car.ghost) return;
    const L = learnState(car);
    if (L.tryPace === null) { L.bestMs = L.bestMs === null ? ms : Math.min(L.bestMs, ms); return; }
    if (offs > 0) {
      // Abgang: Versuch verworfen, UND zurueckgenommen. Beides, nicht nur eins: nach einem
      // Abflug ist die Elternstellung selbst verdaechtig, weil der Versuch von ihr nur
      // wenig entfernt war. Ein Prozent Tempo weniger ist billig, ein Abflug nicht.
      L.rejected++; L.offs++;
      L.pace = Math.max(LEARN_PACE[0], L.pace * 0.97);
      L.push = Math.max(LEARN_PUSH[0], L.push * 0.95);
      L.sigma = Math.max(LEARN_SIGMA_MIN, L.sigma * 0.6);
      log(garageLabel(car) + ': Abgang, Versuch verworfen und vorsichtiger.', 'info');
    } else if (L.bestMs === null || ms < L.bestMs) {
      // Schneller und heil: behalten, und den naechsten Schritt etwas groesser wagen.
      L.pace = L.tryPace; L.push = L.tryPush;
      L.bestMs = ms; L.kept++;
      L.sigma = Math.min(LEARN_SIGMA_MAX, L.sigma * 1.15);
    } else {
      L.rejected++;
      L.sigma = Math.max(LEARN_SIGMA_MIN, L.sigma * 0.9);
    }
    L.tryPace = null; L.tryPush = null;
    learnPropose(car);
  }

  // Die zwei Faktoren, die der Fahrer gerade benutzt: waehrend einer Runde der Versuch,
  // sonst der Elternwert.
  function learnFactors(car) {
    if (!ghostCfg.learnPace || !car.learn) return { pace: 1, push: 1 };
    const L = car.learn;
    return { pace: L.tryPace === null ? L.pace : L.tryPace,
             push: L.tryPush === null ? L.push : L.tryPush };
  }

  // ---- Rueckfall ohne Karte: nur der gemeldete Code und die Phase --------------------
  //
  // GEMESSEN WAR DAS PROBLEM: ohne gebaute oder gelernte Strecke bewegte die Ideallinie das
  // Lenkbyte um 0,3 von 127 - also nichts. Mit Strecke sind es 15,3. Beide anderen
  // Linieneinstellungen wirken ohne Karte weiter (eigene Spuren 18,4), und deshalb kam der
  // Eindruck "eigene Linien gehen ein bisschen, Ideallinie gar nicht" - er war richtig.
  //
  // Was OHNE Karte trotzdem bekannt ist: der Code der Kachel, auf der das Auto JETZT liegt
  // (Byte 12), und die Phase darin (aus dem Kachelzaehler und der gemessenen Kacheldauer).
  // Das reicht fuer ein Aussen-Scheitel-Aussen je Kachel.
  //
  // WAS DAS NICHT KANN, und das gehoert dazu: es sieht die Kachel nicht, die kommt. Eine
  // Doppelkurve wird deshalb zweimal einzeln gefahren statt in einem Zug - genau der Fehler,
  // wegen dem die kartengestuetzte Handregel auf ganze Kurvenzuege umgebaut wurde. Ohne
  // Karte ist das nicht zu vermeiden; grob ist besser als nichts, und der Regler sagt
  // jetzt, in welchem der drei Faelle er steckt.
  function ghostLineFromCode(car) {
    const g = car.ghost;
    if (!g || !car.tileAt) return 0;
    const dir = ghostTurnOf(car.tileCode);
    if (!dir) return 0;                       // Gerade, Start/Ziel, keine Lesung
    const tight = ghostTileInfo(car.tileCode).curve;
    const ph = ghostTilePhase(car);
    // Der Scheitel der Haarnadel liegt spaeter, aus demselben Grund wie in der Handregel:
    // bei 180 Grad wird tief hineingebremst.
    const apex = tight >= 2 ? 0.62 : 0.5;
    // Aussen ist -dir, innen +dir. Linear hin und zurueck.
    const v = ph < apex
      ? -dir + 2 * dir * (ph / apex)
      : dir - 2 * dir * ((ph - apex) / (1 - apex));
    return Math.max(-1, Math.min(1, v));
  }

  function ghostLineOffset(car) {
    const lc = ghostLine();
    const g = car.ghost;
    if (!lc || !g) return ghostLineMitDeckel(car, ghostLineHeuristic(car)
                                             || ghostLineFromCode(car));
    const i = ghostLineIndex(lc, g.tileIndex, ghostTilePhase(car));
    if (i === null) return ghostLineMitDeckel(car, ghostLineHeuristic(car)
                                             || ghostLineFromCode(car));
    // span statt limit als Bezug: die Relaxation nutzt die Bahnbreite nicht immer voll aus,
    // und dann waere der Ausschlag der Ghost-Lenkung kuenstlich klein. Der Regler
    // "Ideallinie" soll die ganze gefundene Linie bedeuten, nicht einen Bruchteil davon.
    const ref = Math.max(1e-6, lc.span || lc.limit);
    // DAS VORZEICHEN IST GEDREHT, und das war ein echter Fehler, kein Feinschliff.
    //
    // trackNormals() zeigt nach LINKS in Fahrtrichtung. Gemessen: auf der ersten Geraden
    // ist das Skalarprodukt der Normale mit der Fahrtrichtungs-Rechten genau -1, nicht +1.
    // Der Kopfkommentar der Funktion behauptet das Gegenteil, und diese Zeile hat ihm
    // geglaubt - also lenkten die Ghosts in JEDER Kurve nach aussen statt zum Scheitel.
    // In 60-track.js:849 steht der Irrtum fuer die Randsteine schon berichtigt; hier nicht.
    //
    // Die Linie selbst war immer richtig: sie ist mit 581 gegen 648 Zeichnungseinheiten
    // kuerzer als die Mittellinie, also die INNERE - Geometrie, keine Ansichtssache.
    const roh = Math.max(-1, Math.min(1, -lc.alpha[i] / ref));
    // Lernfaktor und die harte Grenze aus dem Kippwert. Die Grenze steht NACH dem Faktor:
    // das Lernen darf das Tempo hochtreiben, aber nicht ueber die Lenkung hinaus, bei der
    // das Auto gemessen die Bahn verlaesst.
    const f = learnFactors(car);
    const cap = learnSteerCap();
    // DER DECKEL SKALIERT, ER SCHNEIDET NICHT AB. Vorher stand hier eine Klemme auf den
    // Wert, und weil die Linie auf dieser Bahnbreite fast ueberall am Rand liegt, kam in der
    // Kurve eine KONSTANTE heraus: die Spanne ueber 16 Abtastpunkte war exakt 0,000, und
    // zwar in beiden Linienmodellen. Zwei unabhaengige Optimierer, die bitgleich dasselbe
    // Konstante liefern, sind der Beweis, dass nicht sie das Ergebnis bestimmen, sondern
    // die Klemme. Der Scheitel war da und wurde weggeschnitten.
    //
    // Skaliert bleibt die Grenze dieselbe (|roh| <= 1, also |Ausgabe| <= cap), aber die Form
    // ueberlebt: gemessen 0,144 Kurvenspanne im Rundenzeitmodell statt 0,000.
    const roh2 = Math.max(-1, Math.min(1, roh * f.push));
    return roh2 * cap;
  }

  // Lernfaktor und Kippwert-Deckel, fuer die zwei Rueckfallquellen. Sie gingen vorher OHNE
  // Deckel hinaus: die Handregel liefert bis +/-1, die gerechnete Linie war auf 0,55
  // begrenzt - der Rueckfall durfte also fast das Doppelte anfordern, obwohl die Messung
  // sagt, dass das Auto darueber die Bahn verlaesst. Ein Rueckfall, der mehr darf als der
  // Normalfall, ist keine Vorsicht.
  function ghostLineMitDeckel(car, roh) {
    const f = learnFactors(car);
    const cap = learnSteerCap();
    return Math.max(-1, Math.min(1, roh * f.push)) * cap;
  }

  // Bremsbedarf an der Stelle, an der das Auto gerade ist: 0 = freie Fahrt, 1 = voll
  // anbremsen. Aus demselben Profil, das der Editor rot zeichnet.
  function ghostBrakeDemand(car) {
    const lc = ghostLine();
    const g = car.ghost;
    if (!lc || !g) return null;
    const i = ghostLineIndex(lc, g.tileIndex, ghostTilePhase(car));
    return i === null ? null : lc.brake[i];
  }

  // Die engste Kachel in den naechsten n Schritten, und wie weit sie weg ist. Daraus baut
  // ghostTick sein Tempoprofil: vor einer Haarnadel muss frueher und tiefer verzoegert
  // werden als vor einer 60-Grad-Kurve, und danach darf frueher wieder Gas kommen.
  function ghostAheadTightest(car, depth) {
    const tiles = currentTrackTiles;
    const out = { tight: 0, dist: 99 };
    if (!tiles || tiles.length < 2 || !car.ghost || car.ghost.tileIndex === null) return out;
    for (let k = 0; k <= depth; k++) {
      const t = tiles[(car.ghost.tileIndex + k) % tiles.length];
      const tg = tileTightness(t && t.type);
      if (tg > out.tight) { out.tight = tg; out.dist = k; }
    }
    return out;
  }

  // The three tile types the car is about to meet, in the form the original app sent them.
  // Gemessenes Alphabet: 0x01 Start, 0x02 Gerade, 0x03 Kurve links, 0x04 Kurve rechts,
  // 0x05 Haarnadel links, 0x06 Haarnadel rechts. Die Boxengasse geht als Gerade hinaus,
  // was sie auch ist.
  // ACHTUNG, hier lag ein stiller Fehler: solange HAIRPIN = 0x101 war, ging eine Haarnadel
  // im Vorausblick als (0x101 & 0xff) = 0x01 hinaus, also als START/ZIEL. Das Auto bekam
  // vor jeder Haarnadel die Ansage "Ziellinie". Mit den gemessenen Codes ist es ein
  // Durchreicher, und der Fehler kann nicht wiederkommen.
  function ghostLookahead(car) {
    const tiles = currentTrackTiles;
    const i0 = car.ghost ? car.ghost.tileIndex : null;
    if (!tiles || tiles.length < 3 || i0 === null || i0 === undefined) return null;
    // Every TILE_TYPE value already IS its own wire code (see the constant above), so
    // this is now a plain pass-through for the three tile types that can appear here.
    const code = (t) => (t === TILE_TYPE.START || t === TILE_TYPE.STRAIGHT
                         || t === TILE_TYPE.CURVE_LEFT || t === TILE_TYPE.CURVE_RIGHT
                         || t === TILE_TYPE.HAIRPIN_LEFT || t === TILE_TYPE.HAIRPIN)
                        ? t : 0x02;
    const at = (k) => code(tiles[(i0 + k) % tiles.length].type);
    return { 16: at(0), 17: at(1), 18: at(2) };
  }

  function startGhost(car) {
    stopGhost(car);
    // GEPARKT UEBERLEBTE DEN NEUSTART, und das war der gemeldete Fehler "ein Ghost hat nach
    // einem Rennen trotz Neustart nur noch geblinkt".
    //
    // Ein geparktes Auto ist offTrack, bekommt also Gas 0, und der Lichtzweig in ghostTick
    // laesst es im 260-ms-Takt blinken. startGhost() legte einen frischen Ghost an, liess
    // car.parked aber stehen - der Ghost war neu, das Parkschild alt, und niemand loeschte
    // es ausser dem Schuetteln.
    //
    // Hier ist die richtige Stelle: startGhost() heisst "dieses Auto faehrt jetzt los", und
    // das gilt fuer beide Wege dorthin (Rennstart und "Losfahren" aus der Garage). Wer
    // startet, hat das Auto zurueckgestellt.
    if (car.parked) {
      log(garageLabel(car) + ': stand (' + car.parked + '), Start hebt es auf.', 'info');
      car.parked = null;
    }
    if (car.ghost) { car.ghost.cutOut = false; car.ghost.offSince = 0; }
    const e = new CarreraPhysicsEngine();
    // Die Abstimmung des gesteuerten Autos UEBERNEHMEN, nicht nur dieselbe Klasse benutzen.
    // Der Kommentar hier behauptete vorher "same acceleration as the player's car", gemeint
    // war aber nur "dieselbe Klasse mit Standardwerten": wer 0 auf 100 oder den
    // Beschleunigungsfaktor verstellte, verstellte damit nur sein eigenes Auto, und die
    // Ghosts blieben auf den Werkseinstellungen. Zwei Autos derselben Klasse, die anders
    // beschleunigen, sind kein Rennen.
    //
    // Kopiert wird das ganze Konfigurationsobjekt, nicht eine Liste einzelner Felder: eine
    // Liste veraltet beim naechsten neuen Regler, und dann faellt genau derselbe Fehler
    // wieder an. Die Ausnahmen stehen darunter und sind einzeln begruendet.
    Object.assign(e.config, physEngine.config);
    // gears und der Drehmomentverlauf sind gemeinsame Tabellen, kein Zustand - sie duerfen
    // nicht kopiert, sondern muessen geteilt werden, sonst rechnet accelScale() zweimal
    // dieselbe Kalibrierung.
    e.config.gears = physEngine.config.gears;

    // Ausnahmen, die NICHT vom Fahrer kommen duerfen:
    e.config.autoShift = true;        // ein Ghost schaltet nicht von Hand
    // Der Boxenlimiter des Fahrers gilt nur fuer den Fahrer. Kopiert man ihn mit, kriecht
    // das ganze Feld, sobald der Fahrer in die Box faehrt.
    e.config.speedLimitFactor = 1;
    // Lenkung bleibt frei, wie besprochen: keine Abnahme mit dem Tempo, keine Expo-Kurve.
    e.config.speedSteerReduction = 0;
    e.config.steerExpo = 1;
    e.config.steerResponse = 1;
    // UND DIE LENKKALIBRIERUNG AUF 1, was in dieser Liste gefehlt hat.
    //
    // Sie ist dafuer da, dass der STICK des Fahrers auf engen Strecken die 45 Grad des Autos
    // erreicht. Ein Ghost hat keinen Stick: sein Lenkbefehl ist schon ein Anteil des vollen
    // Einschlags, und der Versatz der Ideallinie ist durch learnSteerCap() ausdruecklich auf
    // den halben Kippwert begrenzt. Mit der Kalibrierung des Fahrers wurde dieser Deckel
    // hinterher wieder mit 2,0 multipliziert - gemessen lagen bei Ideallinie 100 % dann 118
    // von 127 an, also praktisch Vollausschlag, statt der gedeckelten 70.
    //
    // Die Folge war eine stille Kopplung: die Stellung eines Reglers fuer das Fahrerauto
    // aenderte, wie stark die Ghosts ihre Linie fahren. Genau die Sorte Verbindung, die man
    // beim Abstimmen nicht findet.
    e.config.steerCalib = 1;
    e.config.fuelWeightEffect = 0;   // ghosts carry no fuel and take no damage for now
    e.config.tyreEffect = 0;
    // Nach dem Kopieren neu kalibrieren: accelScale() haengt an topSpeedKmh, an der
    // Anfahrzeit und an den Gaengen, und die kommen jetzt vom Fahrer.
    if (typeof e.calibrateAccel === 'function') e.calibrateAccel();
    e.state.driveMode = 'forward';
    e.state.currentGear = 0;
    // freeRun: darf dieser Ghost fahren, ohne dass ein Rennen laeuft? "Losfahren" aus der
    // Garage setzt es. Ohne dieses Flag verlangte ghostTick raceState 'racing' und setzte
    // Lenkung, Gas UND die Geschwindigkeit auf null - der Knopf startete also nachweislich
    // einen Ghost, der sich nicht bewegen konnte, obwohl der Kommentar daneben "freies
    // Fahren mit Begleitung" behauptete.
    car.ghost = { engine: e, tileIndex: null, lastCount: car.tileCount,
                  lastTick: 0, bias: 0, laps: 0, cutOut: false, freeRun: false,
                  // Faehrt dieser Ghost? NICHT car.timer pruefen: der wird erst in einem
                  // setTimeout gesetzt, damit vier Autos nicht in derselben Millisekunde
                  // senden - im Moment des Klicks ist er noch null.
                  // Rundenuhr und Abgangsstand fuer die Lernbilanz.
                  lapStart: 0, offAtLapStart: 0,
                  // Ueberholsequenz und Spurmischung.
                  passPhase: null, passZiel: null, passSince: 0, passBlockUntil: 0,
                  kurveMix: 0, naehern: 0,
                  // Der Startplatz, EINMAL nachgesehen und nicht je Takt: indexOf ueber die
                  // Aufstellung laeuft sonst 22 Mal je Sekunde je Auto. -1 heisst "steht
                  // nicht in der Liste", und dann gibt es keinen Versatz - eine Paritaet aus
                  // -1 waere geraten und keine Aufstellung.
                  gridPos: gridPosOf(car),
                  // Die Kachelabstaende der letzten Wechsel, fuer die Plausibilitaet des
                  // Zaehlers. Leer heisst "noch nichts gesehen", und dann zaehlt er nicht.
                  tileRing: [],
                  // Startgnade: siehe GHOST_START_GNADE_MS. Ohne sie kommt ein geparktes
                  // Auto nie wieder hoch, weil es zum Lesen fahren muesste und zum Fahren
                  // gelesen haben muesste.
                  gnadeBis: Date.now() + GHOST_START_GNADE_MS,
                  running: true };
    // Den ersten Versuch ziehen, wenn gelernt werden soll. Ohne ihn steht tryPace auf null,
    // und learnSettle() kehrt in genau diesem Fall frueh zurueck, OHNE einen zu ziehen - das
    // Lernen kaeme also auch mit der neuen Rundenbilanz nie in Gang. Der Schalter selbst ruft
    // learnPropose nur fuer Autos, die beim Umlegen schon verbunden sind; wer ihn vorher
    // einschaltet, bekam gar keinen Lernzustand.
    if (ghostCfg.learnPace) learnPropose(car);

    ghostPhasenSetzen();
  }

  // ---- Der Sendetakt der Ghosts ------------------------------------------------------
  //
  // ZWEI FEHLER STANDEN HIER, und beide waren nur mit einer Messung zu sehen.
  //
  // 1. DER VERSATZ GING VOM KLICK AUS. Der Kommentar sagte "Stagger against the player's
  //    heartbeat"; gemessen hat der setTimeout aber vom Aufruf, und die Phase des
  //    Herzschlags steht seit dem Laden der Seite fest - die zwei hatten nichts
  //    miteinander zu tun. Ueber 4 s mit zwei Ghosts, Abstand jedes Ghost-Pakets zum
  //    naechstgelegenen Spielerpaket:
  //
  //        Ghost 0    Mittel  0,7 ms     58 von 88 Paketen unter 5 ms
  //        Ghost 1    Mittel 15,1 ms
  //
  //    Ein Ghost lag also DAUERHAFT auf dem Sendezeitpunkt des Spielers, und welcher es
  //    traf, hing am Zufall des Klickzeitpunkts (im zweiten Lauf war es der andere). Soll
  //    sind 45/3 = 15 ms. Zwei Zeitgeber gleicher Periode driften kaum gegeneinander,
  //    deshalb blieb eine einmal getroffene Ueberdeckung minutenlang stehen.
  //
  //    WAS ICH DAZU NICHT MESSEN KANN: ob gleichzeitiges Senden auf dem Funk wirklich etwas
  //    kostet. Jede der drei Verbindungen hat ihr eigenes Verbindungsintervall, und der
  //    Adapter teilt sich ohnehin auf. Behoben, weil der Kommentar eine Zusicherung gab,
  //    die der Code nicht einhielt - nicht, weil eine Messung einen Gewinn zeigt.
  //
  // 2. DER WARTENDE ZEITGEBER HATTE KEINEN GRIFF. stopGhost() loeschte car.timer, der in
  //    den ersten Millisekunden aber noch null ist, weil der Zeitgeber erst IM setTimeout
  //    angelegt wird - der Kommentar in startGhost sagte das sogar. Wer in diesem Fenster
  //    anhielt oder neu startete, bekam danach einen 45-ms-Zeitgeber auf einem Auto, das
  //    niemand mehr faehrt, und der tickte bis zum Neuladen weiter.
  //
  //    GEMESSEN, indem setInterval/clearInterval mitgezaehlt wurden: ein Durchlauf der
  //    Selbsttests hinterliess 35 solcher Phantom-Zeitgeber. Sie kosten wenig Rechenzeit -
  //    ein ghostTick sind 0,05 ms -, aber jeder von ihnen schreibt weiter an sein Auto,
  //    und ein Ghost, den man angehalten hat, soll nicht weiterfahren.
  function ghostTaktLoeschen(car) {
    if (car.startTimer) { clearTimeout(car.startTimer); car.startTimer = null; }
    if (car.timer) { clearInterval(car.timer); car.timer = null; }
  }

  // Wie lange muss dieses Auto warten, damit sein erster Takt auf seinem Platz landet?
  //
  // ALS REINE RECHNUNG herausgezogen, damit sie ohne Zeitgeber pruefbar ist: ein
  // verborgenes Fenster drosselt setInterval auf 1 Hz, und ein Test, der auf echte Takte
  // wartet, misst dort die Drosselung statt dieser Formel.
  //
  // seitHerz = wie lange der letzte Herzschlag her ist. Das Ergebnis ist so gewaehlt, dass
  // (seitHerz + Wartezeit) modulo Takt genau auf dem Platz liegt - unabhaengig davon, wo
  // die Phase gerade steht. GENAU DAS konnte die alte Zeile nicht: sie mass vom Klick.
  function ghostTaktVersatz(platz, teile, seitHerz) {
    const ziel = CONTROL_SEND_INTERVAL_MS * platz / teile;
    let warten = (ziel - seitHerz) % CONTROL_SEND_INTERVAL_MS;
    if (warten < 0) warten += CONTROL_SEND_INTERVAL_MS;
    return warten;
  }

  // Einen Ghost auf seinen Platz im Takt setzen. platz von 1 an, teile = Zahl der Autos.
  function ghostTaktSetzen(car, platz, teile) {
    ghostTaktLoeschen(car);
    // herzschlagAt steht in 20-protocol.js. Ohne bisherigen Herzschlag (0) ist es der
    // Versatz vom Seitenstart - dieselbe Auskunft wie vorher, nur ohne falschen Kommentar.
    const warten = ghostTaktVersatz(platz, teile, performance.now() - herzschlagAt);
    car.startTimer = setTimeout(() => {
      car.startTimer = null;
      // Die Wache fragt jetzt, ob dieses Auto ueberhaupt noch faehrt, und nicht nur, ob es
      // ein Ghost ist. Ein angehaltener Ghost behaelt seine Rolle.
      if (car.role !== 'ghost' || !car.ghost || !car.ghost.running) return;
      car.timer = setInterval(() => ghostTick(car), CONTROL_SEND_INTERVAL_MS);
    }, Math.round(warten));
  }

  // Alle fahrenden Ghosts neu verteilen. Gerufen aus startGhost, also immer dann, wenn sich
  // die Zahl der Autos aendert. NICHT aus stopGhost: startGhost ruft stopGhost als erstes,
  // und dann verteilte jeder Start zweimal. Ein Ghost, der aussteigt, hinterlaesst eine
  // Luecke im Takt, und eine Luecke kostet nichts.
  function ghostPhasenSetzen() {
    const fahren = garage.filter(c => c.role === 'ghost' && c.ghost && c.ghost.running);
    fahren.forEach((c, i) => ghostTaktSetzen(c, i + 1, fahren.length + 1));
  }

  // ---- Windschatten (Block 4.2) ------------------------------------------------------
  //
  // Wieviel Nachlauf hat das FAHRERAUTO gerade? 0 = freie Luft, 1 = direkt hinter einem
  // Auto. Die Physik in 40-physics.js kennt nur st.dirtyAir und soll nicht wissen muessen,
  // dass es Ghosts gibt; hier steht die Messung, dort die Wirkung.
  //
  // Reichweite eine Kachellaenge (43 cm auf dem Teppich, im Massstab rund 32 m). Der Verlauf
  // ist quadratisch abfallend und nicht linear: Abtrieb im Nachlauf erholt sich mit dem
  // Abstand schnell, und linear haette eine halbe Kachel noch die halbe Wirkung - zu weit
  // weg, um es zu spueren.
  const DIRTY_AIR_REICHWEITE = 1.0;   // in Kachellaengen

  function dirtyAirLevel() {
    const tiles = currentTrackTiles;
    // Unter drei Kacheln gibt es keine Kurvenkennung und keinen sinnvollen Abstand. Genau
    // deshalb ist der Schalter in den Optionen gesperrt und nicht bloss wirkungslos.
    if (!tiles || tiles.length < 3) return 0;
    if (dashMinimapIndex === null) return 0;

    // NUR IN DER KURVE. Auf der Geraden ist Windschatten ein VORTEIL, und den zu simulieren
    // hiesse das Modell in der Gegenrichtung zu erfinden: das Auto beschleunigt in echt
    // nicht besser, weil eines vorausfaehrt. In der Kurve ist der Abtriebsverlust ein
    // Nachteil, und den bildet der Reibkreis ehrlich ab. Ein halbes Modell, das seine
    // Haelfte kennt, ist besser als ein ganzes, das raet.
    if (!tileIsCurve(tiles[dashMinimapIndex].type)) return 0;

    const n = tiles.length;
    const meine = dashMinimapIndex + dashTilePhase();
    let naechster = Infinity;
    for (const c of garage) {
      if (c.role !== 'ghost' || !c.ghost || c.ghost.tileIndex === null) continue;
      const seine = c.ghost.tileIndex + ghostTilePhase(c);
      // Nur nach VORN, und modulo Rundenlaenge: wer vorn faehrt, hat freie Luft.
      let d = seine - meine;
      while (d < 0) d += n;
      while (d >= n) d -= n;
      if (d > 0 && d < naechster) naechster = d;
    }
    if (!isFinite(naechster) || naechster > DIRTY_AIR_REICHWEITE) return 0;
    const nah = 1 - naechster / DIRTY_AIR_REICHWEITE;
    return nah * nah;
  }

  // ---- Lenkmessung: wirkt ein gesendeter Lenkbefehl im Bahn-Modus? -------------------
  //
  // Zwei Phasen mit demselben Aufbau, nur der seitliche Versatz unterscheidet sie. Gezaehlt
  // werden Abgaenge und Rundenzeiten je Ghost; die Auswertung ist danach ein Vergleich von
  // zwei Zahlenpaaren und kein Eindruck.
  //
  // Die Zaehlung haengt an ghostTick und nicht an einem eigenen Zeitgeber: dort laufen die
  // Kachelwechsel und der Byte-12-Zustand ohnehin durch, und ein zweiter Takt waere ein
  // zweiter Ort, an dem dasselbe gezaehlt wird.
  const lmState = {
    aktiv: false,
    phase: null,          // 'A' (Versatz 0) oder 'B' (Versatz 1)
    rundenZiel: 5,
    daten: {},            // phase -> kennung -> { runden: [ms], abgaenge, letzteRunde }
    warOff: {},           // kennung -> war im letzten Takt abseits
  };

  function lmLeer(kennung, phase) {
    if (!lmState.daten[phase]) lmState.daten[phase] = {};
    if (!lmState.daten[phase][kennung]) {
      lmState.daten[phase][kennung] = { runden: [], abgaenge: 0, letzteRunde: null };
    }
    return lmState.daten[phase][kennung];
  }

  function lmVersatzSetzen(wert) {
    const el = $('ghost-lateral');
    if (!el) return;
    el.value = String(wert);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function lmSay(text) {
    const el = $('lm-status');
    if (el) el.textContent = text;
  }

  function lmGhosts() {
    return garage.filter(c => c.role === 'ghost' && c.ghost);
  }

  // Die drei Bedingungen werden GEPRUEFT und nicht erwaehnt: unter einer von ihnen misst der
  // Versuch garantiert "keine Wirkung", und zwar aus Gruenden, die mit der Frage nichts zu
  // tun haben.
  function lmPruefen() {
    const fehlt = [];
    if (!currentTrackTiles || currentTrackTiles.length < 3) {
      fehlt.push('mindestens drei Streckenteile (jetzt '
                 + (currentTrackTiles ? currentTrackTiles.length : 0) + ')');
    }
    if (lmGhosts().length < 2) {
      fehlt.push('mindestens zwei Ghosts (jetzt ' + lmGhosts().length + ')');
    }
    if (trackMode !== 'on') fehlt.push('Bahn-Modus (jetzt Ausdruck)');
    return fehlt;
  }

  function lmStart() {
    const fehlt = lmPruefen();
    if (fehlt.length) {
      lmSay('Nicht startbar, es fehlt: ' + fehlt.join('; ') + '.');
      log('Lenkmessung nicht startbar: ' + fehlt.join('; '), 'warn');
      return;
    }
    lmState.aktiv = true;
    lmState.phase = 'A';
    lmState.rundenZiel = parseInt(($('lm-laps') || { value: '5' }).value, 10);
    lmState.daten = {};
    lmState.warOff = {};
    lmVersatzSetzen(0);
    lmRender();
    lmSay('Phase A laeuft: Versatz 0 %. Fahre ' + lmState.rundenZiel
          + ' Runden, dann schaltet es selbst um.');
    log('Lenkmessung gestartet, Phase A (Versatz 0 %).', 'info');
  }

  function lmStop(grund) {
    if (!lmState.aktiv) return;
    lmState.aktiv = false;
    lmState.phase = null;
    lmSay(grund || 'abgebrochen');
    lmRender();
  }

  // Aus ghostTick gerufen, je Takt und Ghost.
  function lmTick(car, rundeVoll) {
    if (!lmState.aktiv) return;
    const kennung = garageLabel(car);
    const d = lmLeer(kennung, lmState.phase);
    // Abgang: Flanke auf 0x00. Die Flanke und nicht der Zustand - sonst zaehlt ein langer
    // Abflug hundert Abgaenge.
    const offJetzt = car.tileCode === TILE_OFFTRACK;
    if (offJetzt && !lmState.warOff[kennung]) d.abgaenge++;
    lmState.warOff[kennung] = offJetzt;

    if (rundeVoll) {
      const now = Date.now();
      if (d.letzteRunde !== null) d.runden.push(now - d.letzteRunde);
      d.letzteRunde = now;
      lmRender();
      // Phase wechseln, wenn ALLE Ghosts das Ziel haben. Der schnellste allein waere ein
      // ungleicher Vergleich: der langsame haette in Phase B mehr Runden.
      const alle = lmGhosts().every(c => {
        const x = lmState.daten[lmState.phase][garageLabel(c)];
        return x && x.runden.length >= lmState.rundenZiel;
      });
      if (alle) {
        if (lmState.phase === 'A') {
          lmState.phase = 'B';
          lmState.warOff = {};
          lmVersatzSetzen(1);
          lmSay('Phase B laeuft: Versatz 100 %. Noch ' + lmState.rundenZiel + ' Runden.');
          log('Lenkmessung: Phase B (Versatz 100 %).', 'info');
        } else {
          lmStop('fertig. Vergleiche die zwei Phasen: aendern sich Abgaenge und '
                 + 'Rundenzeiten nicht, wertet die Firmware die Lenkung nicht aus.');
          log('Lenkmessung fertig.', 'ok');
        }
      }
    }
  }

  function lmRender() {
    const host = $('lm-rows');
    if (!host) return;
    const zeilen = [];
    for (const phase of ['A', 'B']) {
      const p = lmState.daten[phase];
      if (!p) continue;
      for (const kennung of Object.keys(p)) {
        const d = p[kennung];
        const n = d.runden.length;
        const mittel = n ? d.runden.reduce((a, b) => a + b, 0) / n : null;
        const beste = n ? Math.min.apply(null, d.runden) : null;
        zeilen.push('<tr><td>' + (phase === 'A' ? 'A, Versatz 0 %' : 'B, Versatz 100 %')
          + '</td><td>' + kennung + '</td><td>' + n + '</td><td>'
          + (mittel === null ? '&ndash;' : (mittel / 1000).toFixed(2) + ' s') + '</td><td>'
          + (beste === null ? '&ndash;' : (beste / 1000).toFixed(2) + ' s') + '</td><td>'
          + d.abgaenge + '</td></tr>');
      }
    }
    host.innerHTML = zeilen.length ? zeilen.join('')
      : '<tr><td colspan="6" class="muted">noch nichts gemessen</td></tr>';
  }

  function lmCsv() {
    // Dieselben Konventionen wie der Renn-Export: Semikolon, Komma-Dezimal, BOM. Ein
    // deutsches Excel liest sonst eine Spalte mit Punkten als Text.
    const komma = (x) => String(x).replace('.', ',');
    const z = ['Phase;Versatz;Auto;Runde;Zeit_s;Abgaenge_gesamt'];
    for (const phase of ['A', 'B']) {
      const p = lmState.daten[phase];
      if (!p) continue;
      for (const kennung of Object.keys(p)) {
        const d = p[kennung];
        d.runden.forEach((ms, i) => {
          z.push(phase + ';' + (phase === 'A' ? '0' : '100') + ';' + kennung + ';'
                 + (i + 1) + ';' + komma((ms / 1000).toFixed(3)) + ';' + d.abgaenge);
        });
      }
    }
    if (z.length === 1) { lmSay('nichts zu exportieren'); return; }
    const blob = new Blob(['\ufeff' + z.join(String.fromCharCode(13, 10))],
                          { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lenkmessung.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if ($('lm-start')) $('lm-start').addEventListener('click', lmStart);
  if ($('lm-stop')) $('lm-stop').addEventListener('click', () => lmStop('abgebrochen'));
  if ($('lm-csv')) $('lm-csv').addEventListener('click', lmCsv);

  function ghostTick(car) {
    const g = car.ghost;
    if (!g) return;
    const now = Date.now();
    const dt = g.lastTick ? Math.min(0.25, (now - g.lastTick) / 1000)
                          : CONTROL_SEND_INTERVAL_MS / 1000;
    g.lastTick = now;
    // Zieleinlauf hat Vorrang vor allem anderen: keine Linie, keine Wuerze, kein
    // Leitplanken-Modus. Steht die Sequenz, gilt nur noch sie.
    if (g.finish) { ghostFinishTick(car); return; }
    const e = g.engine, cfg = e.config;

    // Follow the tile counter so we know where on the layout we are.
    if (car.tileCount !== null && car.tileCount !== g.lastCount) {
      // Die Dauer der gerade verlassenen Kachel, fuer die Phasenschaetzung der Linie.
      if (g.tileStart) {
        ghostNoteTileTime(car, now - g.tileStart);
        // Die letzten Abstaende getrennt mitfuehren: ghostNoteTileTime mittelt fuer den
        // Vorausblick, hier wird die RATE gebraucht, und ein Mittel verschleift genau den
        // Ausschlag, an dem ein Abflug zu erkennen ist.
        g.tileRing = g.tileRing || [];
        g.tileRing.push(now - g.tileStart);
        if (g.tileRing.length > GHOST_ZAEHLER_FENSTER) g.tileRing.shift();
      }
      g.tileStart = now;
      g.tilesTotal = (g.tilesTotal || 0) + 1;
      g.lastCount = car.tileCount;
      g.tileIndex = g.tileIndex === null ? 0 : g.tileIndex + 1;
      let lmRundeVoll = false;
      if (currentTrackTiles.length) {
        g.tileIndex %= currentTrackTiles.length;
        if (g.tileIndex === 0) {
          g.laps++; lmRundeVoll = true;
          // DIE RUNDENBILANZ DES LERNENS, und sie hatte bis hier keinen Aufrufer im
          // Fahrbetrieb. learnSettle() stand fertig da und wurde nur vom Prueflauf gerufen -
          // also zog das Lernen nie Bilanz, behielt seinen ersten Zufallsversuch fuer immer
          // und konvergierte nie. Gemeldet als "Ghost lernt von Runde zu Runde: merke ich
          // nichts von", und das war nicht Feinheit, sondern ein fehlender Aufruf.
          //
          // Abgaenge werden je RUNDE gebraucht, nicht insgesamt: die Annahmeregel heisst
          // "schneller UND kein Abgang", und ein Abflug aus Runde drei darf Runde neun nicht
          // mehr belasten.
          if (g.lapStart) {
            const abgGesamt = (car.race && car.race.offLap) || 0;
            learnSettle(car, now - g.lapStart, abgGesamt - (g.offAtLapStart || 0));
            g.offAtLapStart = abgGesamt;
          }
          g.lapStart = now;
        }
      }
      // Die Lenkmessung zaehlt hier mit, wo Kachelwechsel und Rundenschluss ohnehin
      // durchlaufen. Ein eigener Zeitgeber waere ein zweiter Ort fuer dieselbe Zaehlung.
      lmTick(car, lmRundeVoll);
    }

    // Cut-out. Two detectors, and the first one is new: code 0x00 IS the off-track report,
    // so there is no need to wait for a timeout. The timeout stays as a backstop for the case
    // where notifications stop arriving altogether, which 0x00 cannot cover.
    // Ohne Streckencode haelt der Ghost an. Das ist die richtige Vorsicht, solange eine
    // gedruckte Strecke liegt - aber solange keine liegt, hat das Auto NIE einen Code
    // gemeldet (!car.lastCodeAt), und dann faehrt der Ghost gar nicht erst los. Von aussen
    // sieht das aus wie ein kaputtes Feature. Der Schalter erlaubt Fahren ohne Codes; das
    // Auto haelt sich dann nicht selbst auf der Bahn, deshalb ist er standardmaessig an.
    const noCode = !car.lastCodeAt || (now - car.lastCodeAt > GHOST_OFFTRACK_MS);
    // 0x00 muss STEHEN, nicht nur einmal auftreten. Ohne diese Entprellung hielt ein
    // einzelnes 0x00-Paket den Ghost sofort an, und weil solche Pakete zwischen zwei
    // Kacheln regelmaessig vorkommen (Median 32 ms), blieb er unterwegs immer wieder stehen.
    if (car.tileCode === TILE_OFFTRACK) {
      if (!g.offSince) g.offSince = now;
    } else {
      g.offSince = 0;
    }
    const offSteht = g.offSince > 0 && (now - g.offSince) >= GHOST_OFFTRACK_CONFIRM_MS;
    // Ein bestaetigter Abgang STELLT AB. Vorher war das ein Zustand, der von selbst wieder
    // wegging, sobald ein Code kam - das Auto fuhr dann neben der Bahn weiter, statt auf
    // die Hand zu warten, die es zurueckstellt.
    //
    // ---- DER KACHELZAEHLER, UND JETZT MIT SEINER RATE -----------------------------------
    //
    // Hier stand "zaehlerLaeuft = letzter Kachelwechsel juenger als 900 ms", und daneben der
    // Vermerk, dass ungemessen sei, ob der Zaehler neben der Bahn weiterlaeuft. Er ist jetzt
    // gemessen, an allen sechs 0x00-Strecken ab 300 ms in den Mitschnitten: er laeuft in
    // 6 von 6 Faellen weiter. Das blosse Zaehlen taugt also NICHT als Unterscheider.
    //
    // Die RATE taugt, und sie trennt die gemessenen Faelle vollstaendig:
    //
    //      840 ms 0x00, 420 ms je Kachel   faehrt
    //     5845 ms 0x00, 490 ms je Kachel   faehrt
    //    13580 ms 0x00, 438 ms je Kachel   faehrt
    //      839 ms 0x00, 140 ms je Kachel   Abflug, der Zaehler rast
    //     1013 ms 0x00,  92 ms je Kachel   Abflug, der Zaehler rast
    //    12806 ms 0x00, eine Kachel        steht
    //
    // Also zwei Fragen statt einer: kam ueberhaupt noch ein Wechsel (sonst steht es), und
    // kamen die letzten Wechsel in einem Abstand, den ein fahrendes Auto haben kann.
    // GHOST_TILE_MS_MIN = 250 steht seit jeher im Code mit der Begruendung "schneller ist
    // keine Kachel je gefahren worden" - es hatte hier nur noch keinen Leser.
    const zaehlerFrisch = g.tileStart && (now - g.tileStart) < GHOST_ZAEHLER_FRISCH_MS;
    const ring = g.tileRing || [];
    const zaehlerPlausibel = ring.length > 0
      && (ring.reduce((a, b) => a + b, 0) / ring.length) >= GHOST_TILE_MS_MIN;
    const zaehlerLaeuft = !!(zaehlerFrisch && zaehlerPlausibel);
    // UND DAS GILT JETZT FUER BEIDE ZWEIGE. Vorher hielt offConfirmed allein an, ohne den
    // Zaehler zu fragen - und vier der sechs gemessenen 0x00-Strecken sind laenger als die
    // 900 ms Bestaetigung. Genau so bleibt ein fahrendes Auto stehen und blinkt.
    const offConfirmed = offSteht && !zaehlerLaeuft;
    // DIE BEWEISLAGE ENTSCHEIDET, und bis v0.4.55 tat sie es nicht - der Ghost blieb neben
    // der Bahn nicht stehen. Zwei Vetos konnten den Halt verhindern, und mindestens eines
    // griff immer:
    //
    //   noCode wird nach GHOST_OFFTRACK_MS ohne GUELTIGEN Code wahr, und car.lastCodeAt wird
    //   bei 0x00 ausdruecklich NICHT gesetzt (siehe recNotify). Ein Auto, das lange genug
    //   neben der Bahn liegt, erfuellt "!noCode" also nie mehr - und mit needCode AUS lautete
    //   die Bedingung (offConfirmed && !noCode). Nach 1,5 s war der Halt unerreichbar.
    //
    //   zaehlerLaeuft schaut auf den KACHELZAEHLER. Zaehlt der neben der Bahn weiter, ist das
    //   Veto dauerhaft aktiv. Ob er das tut, kann diese App nicht entscheiden: es haengt an
    //   der Firmware, und ich habe es nicht gemessen.
    //
    // Also nach der Beweislage getrennt, statt die Vetos zu raten:
    //
    //   offConfirmed ist ein POSITIVES ZEUGNIS - 0x00 steht 900 ms, und einzelne 0x00-Pakete
    //   zwischen zwei Kacheln dauern im Median 32 ms. Das genuegt allein.
    //   noCode ist das FEHLEN eines Zeugnisses und behaelt beide Gegenproben: nur mit
    //   needCode, und nur wenn der Kachelzaehler auch steht.
    // NICHT WAEHREND DER EINFUEHRUNGSRUNDE. Auch im Formationstempo ist das Lesen
    // grenzwertig, und ein Feld, das sich beim Anrollen selbst abstellt, ist schlimmer als
    // eines, das eine verlorene Kachel uebersieht - es rollt ohnehin nur, und die Leitplanke
    // haelt es. Der Melder ist fuer eine Runde gebaut, in der gefahren wird.
    // ---- DIE STARTGNADE ----------------------------------------------------------------
    //
    // Direkt nach einem ausdruecklichen Start haelt der Ghost NICHT an. Das ist der Ausweg
    // aus einem Kreis, der sonst nicht zu verlassen ist:
    //
    //     geparkt  ->  Gas 0  ->  das Auto bewegt sich nicht  ->  es liest kein Muster
    //              ->  0x00 steht weiter, der Kachelzaehler steht  ->  parkt sofort wieder
    //
    // Gemeldet als "nach einer Weile bleiben sie einfach stehen und blinken. Neustart des
    // Rennens, Zuruecksetzen, usw. funktioniert nicht" - und der zweite Satz ist genau
    // dieser Kreis. Wer auf Start drueckt, hat das Auto gerade in die Hand genommen und
    // hingestellt; drei Sekunden Vertrauen sind die Antwort darauf, nicht ein weiterer
    // Knopf.
    //
    // SIE GILT FUER BEIDE ZWEIGE, und das ist eine Berichtigung an meinem ersten Versuch:
    // ich hatte sie nur auf noCode gelegt, in der Annahme, das sei der Zweig, der zuschlaegt.
    // ghostCfg.needCode ist aber standardmaessig AUS - es parkt also praktisch immer nur
    // der 0x00-Zweig, und eine Gnade, die genau ihn ausspart, waere wirkungslos gewesen.
    //
    // Gefaehrlich ist das nicht: nach dem Entparken laeuft die Anfahrrampe ueber
    // GHOST_UNPARK_RAMP_MS = 2500 ms, das Auto rollt in diesen drei Sekunden also kaum an.
    // Liegt es wirklich neben der Bahn, meldet es weiter 0x00 und steht danach wieder.
    const gnade = g.gnadeBis && now < g.gnadeBis;
    const parken = !gnade && !raceFormationLap
                   && (offConfirmed || (ghostCfg.needCode && noCode && !zaehlerLaeuft));
    if (parken && !car.parked) {
      parkCar(car, 'Bahn verlassen');
    }
    const offTrack = !!car.parked;
    const armed = (raceState === 'racing' || raceState === 'finishing' || g.freeRun)
                  && !car.parked;
    // Abgaenge zaehlen, nicht nur melden. Ohne eine Zahl je Runde ist "die Linie hilft"
    // oder "die Linie schmeisst ihn raus" nicht entscheidbar, und dann wird der Regler nach
    // Gefuehl gedreht. Gezaehlt wird die FLANKE, nicht das Paket - ein zwei Sekunden langer
    // Abgang ist ein Abgang, nicht vierzig.
    if (offTrack && !g.cutOut) {
      if (!car.race) car.race = { laps: [], lapStart: null, pending: null, seen: 0,
                                  lastActed: 0, lastCount: null };
      car.race.offLap = (car.race.offLap || 0) + 1;
    }
    if (offTrack !== g.cutOut) {
      g.cutOut = offTrack;
      log(`${garageLabel(car)}: ${offTrack ? 'kein Streckencode, Ghost hält' : 'Streckencode wieder da'}`,
          offTrack ? 'err' : 'info');
    }

    let steer = 0, throttle = 0, brake = 0, weave = 0;
    if (armed && !offTrack) {
      // ---- speed ----
      // Eigenes Tempo je Auto, sonst das globale. So laesst sich ein Feld mit
      // unterschiedlich schnellen Gegnern aufstellen, statt dass alle gleich schnell fahren.
      // Eigenes Tempo, wenn eines gesetzt ist, sonst die Vorgabe. Der Unterschied ist in
      // der Garage jetzt sichtbar und zuruecknehmbar - er rastete vorher beim ersten
      // Antippen dauerhaft ein und machte den globalen Regler fuer dieses Auto stumm, ohne
      // dass irgendwo stand, dass das passiert ist.
      let target = (car.ghostSpeed === undefined || car.ghostSpeed === null)
        ? ghostCfg.speed : car.ghostSpeed;
      // Der gelernte Tempofaktor. Er steht VOR der gelben Flagge, damit das Limit unter
      // Gelb wirklich das Limit ist: ein lernender Ghost darf sich nicht ueber eine
      // Neutralisierung hinwegsetzen.
      target = Math.max(0.05, Math.min(1, target * learnFactors(car).pace));
      // Gelbe Flagge: alle auf denselben Wert, und zwar bevor irgendetwas anderes daran
      // dreht. Gleiches Tempo fuer alle heisst von selbst "kein Ueberholen".
      const underYellow = flagState !== 'green';
      if (underYellow) target = Math.min(target, yellowFactor());
      // ---- Tempoprofil statt eines einzigen Kurvenabschlags ----
      // Vorher gab es genau zwei Zustaende: "Kurve in Sicht" oder nicht, und beide bekamen
      // denselben Abschlag. Mit den gemessenen Haarnadelcodes geht es genauer, und das ist
      // der Teil einer Ideallinie, den wir ueberhaupt beeinflussen koennen (siehe unten):
      // das LAENGSprofil - wann verzoegert wird, wie tief, und ab wann wieder Gas kommt.
      //
      //   Haarnadel: doppelter Abschlag, und die Verzoegerung beginnt zwei Kacheln vorher
      //   60-Grad:   einfacher Abschlag, eine Kachel vorher
      //   Gerade:    voll, sobald die engste Kachel in Sicht hinter uns liegt
      const here = ghostTileInfo(car.tileCode).curve;
      const ahead = ghostAheadTightest(car, 2);
      // Kennung der naechsten engen Stelle, damit der Fehlerwurf EINMAL je Kurve faellt und
      // nicht zwanzig Mal pro Sekunde.
      ahead.key = (g.tileIndex === null ? -1 : g.tileIndex) + ':' + ahead.dist;
      // Waehrend Gelb keine Wuerze: kein Windschatten, keine Attacke, kein Gummiband, und
      // auch keine Tagesform - sonst waere "alle gleich schnell" wieder aufgehoben.
      // 3. SPURDISZIPLIN: wieviel Kurve ist gerade? 0 = Gerade, 1 = Kurve oder Haarnadel.
      // Nur die Kachel unter dem Auto und die direkt naechste zaehlen - der weitere
      // Vorausblick gehoert zum Bremsen, nicht zur Frage "fahre ich jetzt meine Spur oder die
      // Linie".
      //
      // MIT HYSTERESE. Der Kacheltyp wechselt sprunghaft, und ein sprunghafter Wechsel der
      // Mischung ist ein Ruck am Lenkservo. 350 ms Zeitkonstante sind bei diesen Tempi etwa
      // eine halbe Kachel.
      const kurveJetzt = Math.min(1, Math.max(here, ahead.dist <= 1 ? ahead.tight : 0));
      g.kurveMix = g.kurveMix === undefined ? kurveJetzt
        : g.kurveMix + (kurveJetzt - g.kurveMix) * Math.min(1, dt / GHOST_MIX_TAU);
      const spice = underYellow ? { factor: 1, attack: 0 } : ghostSpice(car, ahead);
      target *= spice.factor;
      // Was gilt: die Kachel unter dem Auto, oder die naechste enge in Reichweite. Die
      // Reichweite haengt von der Enge ab - vor einer Haarnadel zwei Kacheln, vor einer
      // normalen Kurve eine.
      // Wenn es eine gerechnete Linie gibt, kommt der Bremsbedarf von dort: er ist stetig
      // und liegt an der richtigen STELLE innerhalb der Kachel, waehrend die Kachelregel nur
      // "enge Kachel in Sicht" kennt und dann die ganze Kachel gleich behandelt.
      // DER STAERKERE DER ZWEI GILT, nicht der eine ODER der andere. Vorher stand hier
      // "if (bd === null && tight > 0)": sobald eine Strecke da war, lieferte
      // ghostBrakeDemand einen Wert und die Kachelregel wurde KOMPLETT uebersprungen.
      //
      // Das war ein echter Verlust, denn die zwei sagen Verschiedenes. Das Bremsprofil misst
      // den ANSTIEG der Kruemmung - eine Kurve, die man schon mit konstantem Radius faehrt,
      // braucht danach kein Bremsen mehr, und das ist fuer eine BREMSE richtig. Der
      // dauerhafte Tempoabschlag einer engen Kurve ist aber keine Bremsung, sondern eine
      // Grenze, und die gilt bis zum Kurvenausgang. Gemeldet als "in der Haarnadel sollte
      // stärker gedrosselt werden als in normalen Kurven" - mit Karte war der Unterschied
      // vollstaendig weg.
      //
      // Addiert werden sie NICHT: zwei Abschlaege auf dieselbe Groesse, die beide dasselbe
      // meinen, ergeben zusammen einen stehenden Ghost. Das Maximum ist die Aussage
      // "so langsam mindestens".
      const bd = ghostBrakeDemand(car);
      const reach = ahead.tight >= 2 ? 2 : 1;
      const tight = Math.max(here, ahead.dist <= reach ? ahead.tight : 0);
      // Bremsprofil: voller Bremsbedarf kostet das Doppelte dessen, was der Regler fuer eine
      // normale Kurve sagt.
      const abzugProfil = bd === null ? 0 : Math.min(0.85, 2 * ghostCfg.curveSlow * bd);
      // Kachelregel: curveSlow beschreibt die 60-Grad-Kurve, die Haarnadel bekommt das
      // Doppelte (tileTightness = 2), gedeckelt damit ein hoher Regler den Ghost nicht
      // zum Stehen bringt.
      const abzugKachel = tight > 0 ? Math.min(0.85, ghostCfg.curveSlow * tight) : 0;
      target *= 1 - Math.max(abzugProfil, abzugKachel);
      // ERST AB ZWEI GHOSTS, wie beim Gummiband. Mit einem einzigen Ghost ist dieser eine
      // der Fuehrende und wurde gebremst, ohne dass es jemanden gibt, den er einholen soll -
      // von aussen sah das aus wie "der Ghost ist zu langsam". Ein Rennen ist NICHT
      // Bedingung: auch im freien Fahren gibt es einen Fuehrenden.
      const feldGross = garage.filter(c => c.role === 'ghost' && c.ghost).length > 1;
      if (ghostCfg.leaderBrake && feldGross && ghostLeader() === car) {
        target *= (1 - ghostCfg.leaderBrakePct);
      }
      // Einfuehrungsrunde: alle rollen im Formationstempo, was ihr eigener Regler auch
      // sagt. Das ist NICHT das Boxentempo - siehe formationPace(): darunter liest das Auto
      // die Bahn nicht mehr.
      if (raceFormationLap) target = Math.min(target, formationPace());

      // Die Anfahrrampe: sie greift NUR nach einem Entparken und laeuft von selbst aus.
      if (g.unparkAt) {
        const seit = now - g.unparkAt;
        if (seit >= GHOST_UNPARK_RAMP_MS) g.unparkAt = 0;
        else target *= seit / GHOST_UNPARK_RAMP_MS;
      }

      const v = Math.abs(e.state.speedKmh) / cfg.topSpeedKmh;
      // DAS dt VON OBEN, und das ist eine Berichtigung. Hier stand
      //
      //     const dtG = Math.max(0.01, Math.min(0.5, (now - (g.lastTick || now)) / 1000));
      //     g.lastTick = now;
      //
      // und g.lastTick war am Anfang derselben Funktion schon auf now gesetzt worden. Die
      // Differenz war also immer genau NULL, und dtG fiel auf seinen Boden von 0,01 s.
      //
      // Folge: die Ratenbegrenzung des Tempo-Reglers lief bei 45-ms-Takten 4,5-fach zu
      // langsam. GHOST_SLEW_GAS = 1,6 je Sekunde sollte "voll durchtreten in 0,6 s" heissen
      // und hiess 2,8 s; die Bremse 0,25 s und hiess 1,1 s. Damit konnte der Ghost einem
      // Zielwechsel an einer Kachelgrenze gar nicht folgen - eine Kachel dauert bei diesen
      // Tempi etwa 700 ms. Genau das war "Kurvengeschwindigkeit drosseln geht nicht so gut":
      // die LOGIK war richtig (Ziel gemessen 35 % Gerade, 22,7 % Kurve, 10,5 % Haarnadel),
      // nur kam das Gas nie dort an.
      //
      // Ein zweiter Zeitgeber in derselben Funktion ist die Ursache. Jetzt gibt es einen.
      const dtG = Math.max(0.01, dt);
      // Herausgegeben fuer den Prueflauf: das ZIEL ist, was die Kurvenlogik entscheidet. Das
      // erreichte Tempo haengt zusaetzlich an der Physik, und ein Prueflauf mit kuenstlicher
      // Kacheluhr verfaelscht es - dann prueft man seinen Prueflauf.
      g.lastTarget = target;
      const st2 = ghostSpeedControl(g, target, v, dtG);
      g.lastFF = g.iTerm || 0;
      throttle = st2.throttle;
      brake = st2.brake;
      // VORSTEUERUNG aus dem Bremsprofil der Linie. Das Profil weiss, dass eine Kurve kommt,
      // BEVOR der Regler eine Abweichung sieht - genau das ist der Unterschied zwischen
      // Bremsen und Hinterherbremsen.
      //
      // Sie ist ausdruecklich ein BODEN auf dem Bremsbefehl und kein zweiter Regler. Ein
      // zweiter Regler auf derselben Groesse arbeitet gegen den ersten; Vorsteuerung plus
      // Rueckfuehrung ist EIN Regler mit zwei Eingaengen, und das ist die uebliche Bauform.
      //
      // Sie greift nur, wo es ein Bremsprofil gibt, also mit gelernter oder gebauter
      // Strecke - deshalb traegt die Kurvendrosselung ihr WIP-Zeichen.
      if (bd !== null && bd > 0) {
        brake = Math.max(brake, Math.min(1, bd * ghostCfg.curveSlow * 1.5));
        if (brake > 0.02) throttle = 0;   // nicht gleichzeitig Gas und Bremse
        g.lastBrake = brake;
        g.lastThrottle = throttle;
      }

      // ---- steering ----
      // In guard-rail mode the CAR steers itself. Comparing the two halves of the 20.08
      // capture - before and after bit 5 came on at 37.8 s - the time spent off the track
      // fell from 18.2 % to 3.1 % (130 of 713 notifies against 17 of 547), and departures
      // from one every 2.9 s to one every 9.8 s. All three departures under guard rail
      // happened at close to full lock (mean |steer| 119.7 of 127), none with no steering
      // at all. So a ghost sends zero steering and lets the car do the work; the layout goes
      // to the car as a lookahead instead of into a steering command here.
      // The transition counts behind the percentages are small (n=8 and n=3) and are not
      // load-bearing; the six-fold difference in time off track rests on 1260 notifies.
      // The offset against ramming stays available, because two cars on one line still
      // collide; it is a small nudge on top of zero, not a control loop.
      // Warming the tyres on the formation lap: a slow weave, phase-shifted per car so the
      // field does not swing as one block. Purely cosmetic — the car holds the track by
      // itself in guard-rail mode, so this is a small offset on top of zero, not steering.
      // ZWEIERKOLONNE plus Schlaengeln, aus formationOffset() - derselbe Satz, den seit
      // v0.4.54 auch das Auto des Fahrers benutzt. Zwei benachbarte Startplaetze gehen auf
      // entgegengesetzte Seiten, also Pole links, Zweiter rechts, Dritter links.
      //
      // Auf die Bahn stellen muss man von Hand - das kann die App nicht -, aber wer fahrend
      // nebeneinander liegt, ist damit gesagt.
      if (raceFormationLap) weave = formationOffset(g, g.gridPos, now);
      if (ghostCfg.railMode) {
        // Zero steering plus the anti-ramming offset. There is no lateral feedback to close
        // a loop with, so this is deliberately the conservative choice rather than a guess.
        //
        // Und jetzt ist sie umgesetzt: die vorwaerts gesteuerte Linie aus Kachelindex und
        // Phase (ghostLineOffset). Genau das Verfahren, das die Original-App nachweislich
        // benutzt - 85 Prozent der Lenkvarianz ihrer eigenen Ghosts erklaeren sich daraus,
        // 55 Prozent beim zweiten Auto. Der Regler steht standardmaessig auf 35 Prozent und
        // auf 0 verhaelt sich der Ghost wie vorher.
        // Bei einer Attacke die ANDERE Seite fahren, nicht die Ideallinie - sonst klebt
        // der Verfolger auf derselben Spur und kommt nie vorbei.
        // Mittig fahren unter Gelb: keine Ideallinie, kein Ausweichen. Das ist der Sinn
        // der Phase - eine vorhersagbare Spur, damit man ein Auto von Hand dazwischen
        // stellen kann.
        // Drei Quellen fuer den Querversatz, und sie sind bewusst an VERSCHIEDENEN Reglern:
        //
        //   Ideallinie   ghostCfg.line     - wo man faehrt, wenn nichts los ist
        //   Ueberholen   ghostCfg.lateral  - Angreifer zur Seite, Vorausfahrender zur andern
        //   eigene Spur  ghostCfg.lanes    - die feste Linie dieses Autos
        //
        // Vorher hing der Seitenversatz des Angreifers an ghostCfg.line. Stand die Ideallinie
        // auf 0, fuhr er ohne Versatz in den Vorausfahrenden - der Regler fuer "Querablage
        // gegen Rammen" konnte daran nichts aendern, obwohl er genau dafuer da ist.
        const weiche = (!underYellow && g.yieldUntil && now < g.yieldUntil)
          ? (g.yieldSide || 0) : 0;
        // SPURDISZIPLIN: auf der Geraden zaehlt die eigene Spur, in der Kurve die Ideallinie.
        // Vorher waren beide fest addiert, also galt auf der Geraden dieselbe Mischung wie im
        // Bogen - und dann faehrt das Feld ueberall dieselbe Linie.
        //
        // Die Spur bleibt in der Kurve zur HAELFTE stehen und nicht bei null: alle auf
        // denselben Scheitel zu schicken waere realistisch und wuerde sie zusammenfuehren -
        // und Beruehrungen sind hier nicht zurueckzuregeln, weil keine Querlage gemeldet wird.
        const mix = g.kurveMix || 0;
        const spurGewicht = 1 - GHOST_LANE_DROP * mix;
        const linieGewicht = GHOST_LINE_STRAIGHT + (1 - GHOST_LINE_STRAIGHT) * mix;
        // UEBERKREUZBLENDE zwischen Ueberholversatz und Linie statt einer harten Umschaltung:
        // beim Einordnen faehrt der Versatz zurueck, und ein "attack ? A : B" wuerde am Ende
        // sprunghaft auf die Linie zurueckfallen.
        const anteilA = Math.min(1, Math.abs(spice.attack || 0));
        const quer = underYellow ? 0
          : (spice.attack || 0) * ghostCfg.lateral * GHOST_PASS_STEER
            + (1 - anteilA) * ghostLineOffset(car) * ghostCfg.line * GHOST_LINE_STEER
              * linieGewicht
            + weiche * ghostCfg.lateral * GHOST_PASS_STEER;
        steer = quer
              + g.bias * ghostCfg.lateral * 0.25
              + ghostLane(car) * ghostCfg.lanes * GHOST_LANE_STEER * spurGewicht;
      } else {
        // Fallback for cars not in guard-rail mode: the old layout-plus-yaw controller.
        const dir = ghostTurnDir(car, 0);
        const yawTarget = dir * 8;
        steer = dir * GHOST_STEER_CURVE + (yawTarget - car.yaw) * GHOST_YAW_GAIN;
        // Dieselbe Aufteilung wie im Leitplanken-Modus, siehe dort.
        // Dieselbe Aufteilung und dieselbe Blende wie im Leitplanken-Modus, siehe dort.
        const weiche2 = (g.yieldUntil && now < g.yieldUntil) ? (g.yieldSide || 0) : 0;
        const mix2 = g.kurveMix || 0;
        const anteilA2 = Math.min(1, Math.abs(spice.attack || 0));
        steer += (spice.attack || 0) * ghostCfg.lateral * GHOST_PASS_STEER
               + (1 - anteilA2) * ghostLineOffset(car) * ghostCfg.line * GHOST_LINE_STEER
                 * (GHOST_LINE_STRAIGHT + (1 - GHOST_LINE_STRAIGHT) * mix2)
               + weiche2 * ghostCfg.lateral * GHOST_PASS_STEER
               + g.bias * ghostCfg.lateral * 0.25
               + ghostLane(car) * ghostCfg.lanes * GHOST_LANE_STEER
                 * (1 - GHOST_LANE_DROP * mix2);
      }
      steer = Math.max(-1, Math.min(1, steer + weave));
    }

    const out = e.update({ steering: steer, throttle, brake, headlights: true }, dt);
    // Put the car into the mode where it keeps itself on the track: bit 5 of byte 14, plus
    // the three-tile lookahead in bytes 16-18. Bit 7 stays CLEAR, because it was clear
    // throughout the guard-rail capture; the headlight bit and the brake bit are as sent
    // there. Without a scanned layout there is no lookahead to send - the mode bit still
    // goes out, since the car may well hold the track on the pattern alone, but that is
    // untested and the log says so rather than pretending otherwise.
    if (ghostCfg.railMode) {
      const la = ghostLookahead(car);
      // Byte 10 = 0x20 and byte 15 bit 3, as measured on the app's own ghosts - not the 0x30
      // from the human-driven guard-rail session, which was a different mode.
      car.modeBytes = Object.assign({ 10: AUTO_MODE.b10, 15: AUTO_MODE.b15 }, la || {});
      car.railLight = LIGHT_HEAD | RAIL_MODE.b14bit | (brake > 0.05 ? LIGHT_BRAKE : 0);
      if (!la && !g.warnedNoLayout) {
        g.warnedNoLayout = true;
        log(`${garageLabel(car)}: Leitplanken-Modus ohne eingescannte Strecke: `
            + 'Vorausblick fehlt, das Auto bekommt nur das Modus-Bit', 'err');
      }
    } else {
      car.modeBytes = null; car.railLight = null;
    }
    // Off the track or before the green light, send a HARD zero. Letting the physics coast
    // down would keep a byte on the motor for another second or two, and "stops driving"
    // has to mean stops, not eases off — the car is somewhere it should not be.
    const drive = (armed && !offTrack) ? out.motorPWM : 0;
    if (!armed || offTrack) { e.state.speedKmh = 0; e.state.virtualSpeed = 0; }
    let lights = car.railLight !== null && car.railLight !== undefined
      ? car.railLight
      : (trackModeBit() | LIGHT_HEAD | (brake > 0.05 ? LIGHT_BRAKE : 0));
    // Unter Gelb blinken alle, und ein stehendes Auto blinkt schneller - so findet man auf
    // dem Tisch sofort, welches gemeint ist.
    if (flagState !== 'green' || car.parked) {
      const period = car.parked ? 260 : 520;
      const on = Math.floor(Date.now() / period) % 2 === 0;
      lights = trackModeBit() | (on ? LIGHT_HEAD : 0) | (on ? 0 : LIGHT_BRAKE);
    }
    writeToCar(car, (armed && !offTrack) ? out.servoAngle : 0, drive, lights, car.modeBytes);
  }

  // The leader among the ghosts, by laps then tile index. Used for the hold-back setting.
  function ghostLeader() {
    let best = null;
    garage.forEach(c => {
      if (c.role !== 'ghost' || !c.ghost) return;
      if (!best) { best = c; return; }
      const a = c.ghost, b = best.ghost;
      if (a.laps > b.laps || (a.laps === b.laps && (a.tileIndex || 0) > (b.tileIndex || 0))) best = c;
    });
    return best;
  }

  // Side by side? Then split them: one a little left, the other a little right. This is a
  // guess, not a measurement — nothing reports where on the track width a car is — so it
  // only ever applies a small offset.
  // Wer neben wem faehrt, und wer deshalb wohin ausweicht. Der Vergleich ist der
  // Kachelindex innerhalb der Runde: gleiche Runde und hoechstens eine Kachel Abstand heisst
  // bei 43 cm Kachellaenge, dass sie sich tatsaechlich beruehren koennen.
  // 0.25 bei 200 ms Takt heisst voller Versatz nach 0.8 s. Mit 0.18 bei 500 ms waren es
  // 3 s - und "innerhalb einer Kachel" dauert bei real 2.5 km/h nur ein bis zwei Sekunden,
  // der Versatz waere also nie angekommen.
  const GHOST_BIAS_STEP = 0.25;
  const GHOST_BIAS_MS = 200;
  // So lange nach dem Gruen gilt das Feld als "nebeneinander", egal was die Kachelzaehler
  // sagen. Danach entscheidet der Abstand. Sechs Sekunden sind bei real gut 2 km/h etwa
  // drei Meter Fahrt - lang genug, dass sich die Abstaende bilden.
  const GHOST_GRID_MS = 6000;
  // Die feste Spur EINES Ghosts, -1 bis +1. Gleichmaessig ueber das Feld verteilt und
  // symmetrisch um die Mitte, damit das Feld nicht insgesamt zur Seite wandert.
  //
  // Die Position kommt aus der GARAGE und nicht aus dem Rennstand: eine Spur, die sich mit
  // dem Kachelindex aendert, ist keine Linie, sondern ein Zickzack. Und sie ist nicht
  // gewuerfelt - gewuerfelt waere sie bei jedem Aufruf anders, und dann faehrt kein Auto
  // eine Linie, sondern zittert.
  //
  // Bei EINEM Ghost ist die Spur die Mitte, und das ist richtig: "verschiedene Linien" hat
  // bei einem Auto keine Bedeutung, und ein einzelner Versatz waere ein Lenkfehler.
  // Wieviel Lenkung eine ganze Spurbreite bedeutet. 0,16 in derselben Groessenordnung wie
  // GHOST_LINE_STEER: es ist ein Halten neben der Mitte und kein Ausweichmanoever, und mehr
  // waere auf der Schiene ohnehin nur ein Kampf gegen die Firmware.
  const GHOST_LANE_STEER = 0.16;

  function ghostLane(car) {
    const gs = garage.filter(c => c.role === 'ghost' && c.ghost);
    if (gs.length < 2) return 0;
    const k = gs.indexOf(car);
    if (k < 0) return 0;
    return (2 * k) / (gs.length - 1) - 1;
  }

  function ghostAssignBias() {
    const gs = garage.filter(c => c.role === 'ghost' && c.ghost);
    const want = new Map(gs.map(c => [c, 0]));
    // Erst die Gruppen bilden, dann die Seiten verteilen. Paarweise zuzuweisen war bei drei
    // Autos auf derselben Kachel falsch: die Paare (A,B), (A,C) und (B,C) schrieben
    // nacheinander, der letzte gewann, und A und B landeten beide auf derselben Seite - sie
    // waeren sich weiter in die Quere gekommen.
    // Am Start stehen alle auf derselben Stelle, also gilt "nebeneinander" fuer alle -
    // und zwar unabhaengig davon, ob schon eine Kachel gemeldet wurde. Vorher hing das an
    // tileIndex, und der ist beim Start null: das Feld fuhr die ersten Sekunden auf einer
    // Spur, genau dort, wo es am dichtesten ist.
    const fresh = raceStartedAt && (Date.now() - raceStartedAt) < GHOST_GRID_MS;
    const near = fresh ? gs : gs.filter(c => gs.some(o => o !== c
      && o.ghost.laps === c.ghost.laps
      && Math.abs((o.ghost.tilesTotal || 0) - (c.ghost.tilesTotal || 0)) <= 1));
    // Nach Kachelindex sortiert, damit die Seiten stabil bleiben, solange sie
    // nebeneinander fahren, und nicht bei jedem Aufruf tauschen.
    near.sort((a, b) => (a.ghost.tileIndex || 0) - (b.ghost.tileIndex || 0)
                        || String(a.device && a.device.id).localeCompare(String(b.device && b.device.id)));
    near.forEach((c, k) => want.set(c, k % 2 === 0 ? -1 : 1));
    // Nachgezogen statt gesetzt. Ein Sprung von 0 auf den vollen Versatz ist ein Ruck am
    // Lenkservo, und der sieht aus wie ein Fehler statt wie ein Ausweichen.
    for (const c of gs) {
      const t = want.get(c) || 0;
      const cur = c.ghost.bias || 0;
      const d = t - cur;
      c.ghost.bias = Math.abs(d) <= GHOST_BIAS_STEP ? t : cur + Math.sign(d) * GHOST_BIAS_STEP;
      // Einmal melden, wenn es greift - sonst sieht man nicht, ob die Logik ueberhaupt
      // ausloest, und "die fahren nicht versetzt" bleibt eine Vermutung.
      const near = t !== 0;
      if (near !== !!c.ghost.wasNear) {
        c.ghost.wasNear = near;
        if (near) log(garageLabel(c) + ': nebeneinander, weicht aus.', 'info');
      }
    }
  }
  setInterval(ghostAssignBias, GHOST_BIAS_MS);

  // ---- Pruefzugang ----
  // Absichtlich schmal und absichtlich vorhanden. Bis hierher liess sich an dieser Datei
  // nichts pruefen, ausser von Hand im Browser - die groesste Luecke fuer jeden, der
  // mitarbeiten will, und die Ursache dafuer, dass Fehler wie der Buchstabe J im
  // Streckencode-Leser monatelang unentdeckt blieben.
  //
  // Nur REINE Funktionen, kein Zustand, kein Schreibzugriff. Was hier steht, kann eine
  // Pruefung aufrufen, ohne ein Auto zu verbinden oder auf eine Zeitmessung zu warten.
  // ---- Linienmodell und Lernen bedienen ----
  //
  // Die Modellwahl geht durch setLineModel(), damit der Editor dieselbe Linie zeichnet, die
  // gefahren wird. Der Zwischenspeicher muss dabei fallen: er haelt sonst die Linie des
  // alten Modells fest, und der Schalter waere ohne Wirkung.
  for (const b of document.querySelectorAll('[data-linemodel]')) {
    b.addEventListener('click', () => {
      const m = b.dataset.linemodel;
      // ghostCfg.lineModel stand hier bis v0.4 daneben und wurde nie gelesen: der echte
      // Zustand liegt in 60-track.js hinter setLineModel(). Ein zweiter Speicherort ohne
      // Leser ist keine Redundanz, sondern eine Falle.
      setLineModel(m);
      lineCache = null;
      for (const o of document.querySelectorAll('[data-linemodel]')) {
        o.classList.toggle('sel', o.dataset.linemodel === m);
      }
      // Editor neu zeichnen: die Linie hat sich gerade geaendert, und die gezeichnete muss
      // die gefahrene sein.
      try { refreshTrackPreview(); } catch (e) { /* Editor nicht im Dokument */ }
      const lc = ghostLine();
      log('Linienmodell: ' + (m === 'laptime' ? 'Rundenzeit' : 'Kr\u00fcmmung')
          + (lc && lc.lapTime ? ', Modellzeit ' + lc.lapTime.toFixed(2)
             + ' (' + (lc.gain * 100).toFixed(1) + ' % schneller als Kr\u00fcmmung)' : ''),
          'info');
    });
  }

  if ($('ghost-learn-pace')) {
    $('ghost-learn-pace').addEventListener('change', (e) => {
      ghostCfg.learnPace = e.target.checked;
      if (!ghostCfg.learnPace) {
        // Ausschalten heisst zurueck auf Werk: sonst bliebe ein gelernter Faktor stehen,
        // ohne dass irgendwo sichtbar waere, dass er wirkt.
        garage.forEach(c => { c.learn = null; });
        log('Ghost-Lernen aus, Faktoren zur\u00fcckgesetzt.', 'info');
      } else {
        garage.forEach(c => { if (c.ghost) learnPropose(c); });
        log('Ghost-Lernen an: je Runde ein Versuch, behalten nur wenn schneller und ohne '
            + 'Abgang. Lenkgrenze ' + learnSteerCap().toFixed(2)
            + ((lat.rows && lat.rows.length) ? ' (gemessen).' : ' (Vorgabe, nicht gemessen).'),
            'info');
      }
    });
  }

  // ---- Die Messstaende stehen in 93-testbench.js -------------------------------
  //
  // window.OMEGA_TEST war 2449 Zeilen lang und lag mitten in dieser Datei - 39 % von
  // ihr. Sie heisst "der Ghost-Fahrer" und enthaelt daneben die Garage, die Flaggen,
  // die Lenkmessung und die Controller-Belegung; wer den Fahrer suchte, blaetterte
  // durch die Prueflaeufe hindurch.
  //
  // Der Schnitt ist sauber: der Block ist EIN Ausdruck und haengt an nichts, was nach
  // ihm kommt. Die IIFE geht ueber alle Quelldateien, der Bereich ist also derselbe -
  // die Messstaende sehen weiterhin jede Funktion und jeden Zustand dieser Datei.


  // Ghosts launch on green, not before.
  function launchGhosts() {
    garage.forEach(c => { if (c.role === 'ghost') startGhost(c); });
    const n = garage.filter(c => c.role === 'ghost').length;
    // Die haeufigste Ursache fuer "ich starte das Rennen und es passiert nichts": ohne
    // gedruckte Strecke unter dem Auto meldet es NIE einen Streckencode, und mit
    // "Ghost braucht Streckencode" haelt der Ghost dann still. Das stand bisher nur als
    // eine Zeile im Protokoll, wo es niemand sucht. Der Streckenscan ist dafuer NICHT
    // notwendig - der fehlt nur den Vorausblick; entscheidend ist das gedruckte Muster.
    const blind = garage.filter(c => c.role === 'ghost' && !c.lastCodeAt);
    if (blind.length && ghostCfg.needCode) {
      const msg = blind.length === n
        ? 'Ghosts stehen: kein Streckencode gelesen. Optionen \u2192 "Ghost braucht '
          + 'Streckencode" ausschalten, dann fahren sie auch ohne gedruckte Strecke.'
        : blind.length + ' von ' + n + ' Ghosts stehen: kein Streckencode gelesen.';
      log(msg, 'err');
      showHudToast('GHOST OHNE STRECKENCODE');
    }
    if (n && !currentTrackTiles.some(t => tileIsCurve(t.type))) {
      log('Warnung: kein Streckenlayout mit Kurven geladen, Ghosts können nur geradeaus halten.', 'err');
    }
  }

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    // Prefer a standard-mapping pad: Windows often exposes the same physical controller
    // twice (e.g. a DualSense over Bluetooth showing up as both a mapped and a raw HID
    // device), and picking the raw one gives meaningless axis/button indices.
    const list = Array.from(pads).filter(p => p);
    const pad = list.find(p => p.mapping === 'standard') || list[0];
    if (!pad) {
      // Do NOT tear the loop down here: a Bluetooth pad can drop out of the snapshot for
      // a frame or two, and killing the loop on that would need a fresh connect event to
      // ever come back. Keep polling, just neutralise the inputs meanwhile.
      if (padConnected) {
        releaseInput(SRC.PAD);
        prevLightFlash = false;
      }
      padConnected = false;
      return;
    }
    padConnected = true;
    padLastPollTime = performance.now();

    if (listeningFor) {
      tryCaptureBinding(pad);
    } else {
      const throttleRaw = applyDeadzone(Math.max(0, readBindingValue(pad, bindings.throttle)), TRIGGER_DEADZONE);
      const brakeRaw = applyDeadzone(Math.max(0, readBindingValue(pad, bindings.brake)), TRIGGER_DEADZONE);
      const steerRaw = applyDeadzone(readBindingValue(pad, bindings.steering));

      $('pad-live-throttle').textContent = throttleRaw.toFixed(2);
      $('pad-live-brake').textContent = brakeRaw.toFixed(2);
      $('pad-live-steer').textContent = steerRaw.toFixed(2);
      // Damit sich nicht wieder raten laesst, ob das Kreuz erkannt wird: hier steht, was
      // ankommt und woher - als Knopf oder als Achse.
      const dl = ['up', 'down', 'left', 'right'].filter(d => padDpad(pad, d));
      const asBtn = [12, 13, 14, 15].some(i => padButtonPressed(pad, i));
      $('pad-live-dpad').textContent = dl.length ? dl.join('+') + (asBtn ? ' (Knopf)' : ' (Achse)')
        : (pad.buttons.length > 15 ? 'nichts' : 'nichts, Pad hat nur ' + pad.buttons.length + ' Knoepfe');
      $('pad-live-axes').textContent = (pad.axes || []).length + ': '
        + [...(pad.axes || [])].map(v => v.toFixed(1)).join(' ');

      // No tab gate any more, and setThrottleLogical (not setThrottle) so that pressing
      // the throttle actually goes FORWARD — setThrottle takes screen-space and was
      // silently inverting the gamepad's logical value.
      // applyDeadzone already returns exactly 0 inside the deadzone, so a pad at rest is
      // silent here and no longer overwrites whatever the keyboard is holding.
      applySteerInput(SRC.PAD, steerRaw);
      applyThrottleInput(SRC.PAD, throttleRaw - brakeRaw);

      // Headlight flash, edge-triggered: one press = one three-blink burst, the way GT3
      // drivers signal a pass. The handbrake that used to sit on this button is gone, and
      // with it the special case that had to exclude it from selecting reverse.
      const flashNow = readBindingValue(pad, bindings.lightflash) > BUTTON_CAPTURE_THRESHOLD;
      if (flashNow && !prevLightFlash) triggerHeadlightFlash();
      prevLightFlash = flashNow;

      // Headlights on/off, edge-triggered. Drives the same checkbox the options menu uses
      // so the two can never disagree.
      const headNow = readBindingValue(pad, bindings.headlights) > BUTTON_CAPTURE_THRESHOLD;
      // Triangle: reset in the editor, headlights otherwise.
      if (headNow && !prevHeadlights && trackEditorPad('reset')) {
        // consumed by the editor
      } else if (headNow && !prevHeadlights) {
        headlightsOn = !headlightsOn;
        const cb = $('dash-head-toggle');
        if (cb) cb.checked = headlightsOn;
        showHudToast(headlightsOn ? 'Licht an' : 'Licht aus');
      }
      prevHeadlights = headNow;

      const wxNow = readBindingValue(pad, bindings.weather) > BUTTON_CAPTURE_THRESHOLD;
      if (wxNow && !prevWeather) setWeather(weather === 'rain' ? 'dry' : 'rain');
      prevWeather = wxNow;

      // Pit stop only from a standstill — a real crew does not service a moving car.
      // LB und RB machen nur noch Autodinge. Sie blaetterten ausserhalb des Cockpits durch
      // die Tabs, und das war eine der Quellen der Fehlbedienungen: ein Griff zum
      // Boxenstopp-Knopf im falschen Moment sprang in einen anderen Tab.
      const pitstopNow = readBindingValue(pad, bindings.pitstop) > BUTTON_CAPTURE_THRESHOLD;
      if (pitstopNow && !prevPitstop) requestPitStop();
      prevPitstop = pitstopNow;

      // One button, both directions: start when idle, abort when running.
      const raceStartNow = readBindingValue(pad, bindings.racestart) > BUTTON_CAPTURE_THRESHOLD;
      if (raceStartNow && !prevRaceStart) toggleRace();
      prevRaceStart = raceStartNow;

      const trackViewNow = readBindingValue(pad, bindings.trackview) > BUTTON_CAPTURE_THRESHOLD;
      if (trackViewNow && !prevTrackView) toggleTrackView();
      prevTrackView = trackViewNow;

      // Leseart und Getriebe gehen ueber die Bedienelemente in den Optionen und deren
      // 'change'-Ereignis - wie der Knopf im Cockpit und die Reifenkachel. Damit gibt es
      // keinen zweiten Zustand, und die Optionen ziehen von selbst nach.
      const scanNow = readBindingValue(pad, bindings.scanmode) > BUTTON_CAPTURE_THRESHOLD;
      if (scanNow && !prevScanMode) {
        const sw = $('setting-ontrack');
        if (sw) { sw.checked = !sw.checked; sw.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      prevScanMode = scanNow;

      const gearNow = readBindingValue(pad, bindings.gearmode) > BUTTON_CAPTURE_THRESHOLD;
      if (gearNow && !prevGearMode) {
        const sw = $('setting-autoshift');
        if (sw) {
          sw.checked = !sw.checked;
          sw.dispatchEvent(new Event('change', { bubbles: true }));
          showHudToast(sw.checked ? 'AUTOMATIK' : 'VON HAND');
        }
      }
      prevGearMode = gearNow;

      // Gelbe Flagge auf HALTEN. Dieselben zwei Funktionen wie die Taste X, nicht eine
      // zweite Fassung der Logik: flagHoldPress startet den Ladebalken, flagHoldRelease(true)
      // loest aus. Zu frueh losgelassen passiert nichts - ein halber Druck darf keine halbe
      // Wirkung haben.
      const flagNow = readBindingValue(pad, bindings.yellowflag) > BUTTON_CAPTURE_THRESHOLD;
      if (flagNow && !prevYellowFlag) { padFlagFired = false; flagHoldPress(); }
      if (flagNow && !padFlagFired && flagHoldStart !== null
          && Date.now() - flagHoldStart >= FLAG_HOLD_MS) {
        padFlagFired = true;
        flagHoldRelease(true);
      }
      if (!flagNow && prevYellowFlag && !padFlagFired) flagHoldRelease(false);
      prevYellowFlag = flagNow;

      const resetNow = readBindingValue(pad, bindings.resetcar) > BUTTON_CAPTURE_THRESHOLD;
      if (resetNow && !prevResetCar) resetCarState();
      prevResetCar = resetNow;

      const downshiftNow = readBindingValue(pad, bindings.downshift) > BUTTON_CAPTURE_THRESHOLD;
      const upshiftNow = readBindingValue(pad, bindings.upshift) > BUTTON_CAPTURE_THRESHOLD;
      // No gear-range guards here any more: triggerShift() does its own bounds checking
      // and needs to see a downshift AT gear 0 (that is how manual mode selects reverse)
      // and an upshift while in reverse (how it comes back out).
      // X / Square and B / Circle are shift buttons while driving and build/undo in the
      // editor. The editor gets first refusal, and only in fullscreen.
      if (downshiftNow && !prevDownshift && !trackEditorPad('confirm')
          && physicsEnabled && !physEngine.state.isShifting) {
        physEngine.triggerShift(-1);
      }
      if (upshiftNow && !prevUpshift && !trackEditorPad('undo')
          && physicsEnabled && !physEngine.state.isShifting) {
        physEngine.triggerShift(1);
      }
      prevDownshift = downshiftNow;
      prevUpshift = upshiftNow;

      const dUp = padDpad(pad, 'up'), dDown = padDpad(pad, 'down');
      const dLeft = padDpad(pad, 'left'), dRight = padDpad(pad, 'right');
      // Two consumers can claim the D-pad before the normal bindings see it: the track
      // editor in fullscreen, and an armed pit stop. Each returns true when it took the
      // press, so at every other moment the pad keeps its usual job (accel and steering
      // trim) — the meaning is never changed permanently, only while something is
      // genuinely waiting for a decision.
      // Nur noch zwei Verbraucher vor der Fahrfunktion: der Streckeneditor im Vollbild und
      // ein scharfer Boxenstopp. Die allgemeine Menuenavigation ist ausgebaut - sie griff auf
      // jedem Tab und auf jedes fokussierbare Element, und genau daraus kamen die
      // Fehlbedienungen: ein Druck aufs Steuerkreuz verstellte irgendeinen Regler, den man
      // gerade nicht im Blick hatte. Die Programmierschule hing an derselben Kette und ist
      // mit ausgebaut; sie laesst sich weiterhin mit Maus und Finger bedienen.
      if (dUp && !prevDpad.up && !trackEditorPad('up') && !pitQuickMenu('up')) nudgeBrakeBias(+1);
      if (dDown && !prevDpad.down && !trackEditorPad('down') && !pitQuickMenu('down')) nudgeBrakeBias(-1);
      if (dLeft && !prevDpad.left && !trackEditorPad('left') && !pitQuickMenu('left')) nudgeSteerResponse(-0.1);
      if (dRight && !prevDpad.right && !trackEditorPad('right') && !pitQuickMenu('right')) nudgeSteerResponse(+0.1);
      prevDpad.up = dUp; prevDpad.down = dDown; prevDpad.left = dLeft; prevDpad.right = dRight;

    }
    // Keep prev-flags fresh even while rebinding, otherwise they go stale and the first
    // press after a rebind is swallowed (or fires twice).
    if (listeningFor) {
      prevDownshift = readBindingValue(pad, bindings.downshift) > BUTTON_CAPTURE_THRESHOLD;
      prevUpshift = readBindingValue(pad, bindings.upshift) > BUTTON_CAPTURE_THRESHOLD;
    }
  }

  // Some browsers/pads report as already-connected on page load without firing the event.
  if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(p => p)) {
    padConnected = true;
    startPadLoop();
  }














  // Steht ABSICHTLICH am Ende des IIFE: der Ladeaufruf unten liest playerCar und
  // controlSelect, die weiter oben noch in der temporalen Todeszone liegen. Weiter
  // vorne eingehaengt bricht das gesamte Skript beim Laden ab - genau das ist beim
  // ersten Versuch passiert.

  // ================= Programmierschule =================
  // Two editable curves over time, a simulation, and a plot of what the car actually did.
  // The teaching point is the gap between the two: a square input never produces a square
  // movement, because the car has mass, the tyres need time and the steering has a top
  // speed. Everything here reuses the SAME physics instance class the car is driven with —
  // a separate toy model would teach a fiction.
