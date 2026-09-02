  // ============================== VOREINSTELLUNGEN ==============================
  // presetControls() sucht NUR in #tab-options. Die Karte verspricht "nicht die
  // Rennlaenge, nicht das Wetter, nicht die Strecke", und dieses Versprechen hing einmal
  // daran, dass es ausserhalb der Optionen zufaellig keine .opt-row gab.
  // At the end of the IIFE for the same reason as the two blocks above: it reads the
  // controls at load time to fill the exchange field.

  // Only the sliders that decide how the car FEELS. Race length, weather, track and the
  // ghost settings are deliberately absent: those describe the race, not the car, and a
  // preset that silently changed the race length would be a trap rather than a convenience.
  // Jede Voreinstellung traegt ihren eigenen Erklaertext, und der Text steht HIER und
  // nicht im Markup: er beschreibt die Werte darunter, und zwei Orte fuer eine Aussage
  // laufen auseinander, sobald jemand einen Wert nachzieht.
  //
  // Die drei Kernwerte in jedem Text sind mit Absicht immer dieselben - Schaltung,
  // Beschleunigung, Reifenverschleiß - damit man die fuenf nebeneinander lesen kann.
  const PRESETS = {
    arcade: {
      label: 'Arcade',
      kurz: 'Der ursprüngliche Sim-Modus',
      text: 'Automatik, 2,0 s auf 100, voller Grip, kein Reifenverschleiß und kein '
          + 'Tankgewicht. Die Bremse steht am Anschlag, also der kürzeste Bremsweg von '
          + 'allen, und die Lenkkalibrierung auf 250 Prozent: der volle Einschlag liegt '
          + 'schon bei einem Viertel Stick an. 50 Abgänge erlaubt, kein Schaden. Zum '
          + 'Fahren ohne Nachdenken.',
      v: { 'setting-grip': 1.0, 'setting-brakepower': 1.5, 'setting-autoshift': true,
           'setting-zero-to-top': 2.0, 'setting-coast-drag': 0.4, 'setting-fuelweight': 0,
           'setting-tyres': 0, 'phys-steerresp': 2.6, 'setting-brakebias': 56,
           // Die engste Lenkung von allen: bei 250 Prozent liegt der volle Anschlag schon
           // bei einem Viertel Stick an. Weiter als 45 Grad kommt auch das nicht - das ist
           // die Mechanik des Autos.
           'setting-steer-calib': 2.5,
           // Reibkreis schwach: Arcade soll nicht dafuer bestraft werden, dass man bremst und
           // lenkt gleichzeitig.
           'setting-brake-steal': 0.4,
           // Waermer an: das ist die nachsichtigste Abstimmung, und kalte Reifen in den ersten
           // Runden sind genau die Sorte Huerde, die Arcade nicht haben soll.
           'setting-tyre-blankets': true,
           'phys-accel': 1.2,
           // crash-count ist ein INDEX in [1,2,3,4,5,10,20,50]: 7 = fuenfzig Crashs.
           'setting-fuel-drain': 0, 'setting-crash-count': 7,
           'setting-crash-damage': false,
           // Hoehere Schwelle heisst NACHSICHTIGER: gemeldet wird erst ueber ihr.
           'setting-crash-threshold': 60,
           'setting-repair-time': 2,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck.
           'setting-brake-fade': false,
           'setting-brake-fade-strength': 1.0,
           'setting-dirtyair': false,
           'setting-dirtyair-strength': 1.0,
           'setting-tyre-asym': false,
           'setting-tyre-pressure': 1.8,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 2.0 },
    },
    pro: {
      label: 'Pro',
      kurz: 'Halb so weit zwischen Arcade und Realismus GT3',
      text: 'Automatik, 2,6 s auf 100, voller Grip, kein Reifenverschleiß und kein '
          + 'Tankgewicht. Lenkkalibrierung 200 Prozent, damit auch enge Strecken gehen '
          + '– der volle Einschlag liegt bei etwa einem Drittel Stick an. Fading und '
          + 'Windschatten sind aus; sie stehen ab GT4 zur Verfügung.',
      // AUTOMATIK, obwohl Pro sonst die Zwischenstufe zu GT3 ist. Pro ist seit v0.5 die
      // Vorgabe, und wer beim ersten Start von Hand schalten muss und es nicht weiss, bleibt
      // im 1. Gang haengen - dann ist das Auto genau so traege, wie gemeldet wurde. Von Hand
      // schalten steht ab GT3 zur Verfuegung, und der Knopf RB schaltet es jederzeit um.
      v: { 'setting-grip': 1.0, 'setting-brakepower': 1.4, 'setting-autoshift': true,
           // 2,6 statt 3,2 s: gemessen brauchte das Motorbyte mit den alten Werten 24,9 s
           // Vollgas bis 90 %. Pro ist die Vorgabe und muss sich wie ein Auto anfuehlen,
           // nicht wie ein Anfahrversuch.
           'setting-zero-to-top': 2.6, 'setting-coast-drag': 0.6, 'setting-fuelweight': 0,
           'setting-tyres': 0, 'phys-steerresp': 2.4, 'setting-brakebias': 58,
           // Lenkkalibrierung 200 Prozent: der Reibkreis beschneidet den Einschlag beim
           // Anbremsen auf etwa 60 Prozent, und das holt ihn zurueck. Gemessen bei 60 km/h
           // unter Bremsen: 35 Grad ohne, volle 45 Grad ab einem Drittel Stick mit.
           'setting-steer-calib': 2.0,
           // Reibkreis 1,15, GEMESSEN. Bei Kalibrierung 200 Prozent waren 0,85 und 1,00 beide
           // unsichtbar (45 Grad rollend wie bremsend); 1,15 nimmt bei 80 km/h und
           // darueber 45 auf 26 Grad und laesst 40 bis 60 km/h unberuehrt. Ueber
           // 1,15 faellt es auf den Notboden von 11 Grad, und dann lenkt das Auto
           // unter Bremsen gar nicht mehr.
           'setting-brake-steal': 1.15,
           // Waermer an, weil Pro die Vorgabe ist: wer zum ersten Mal faehrt, soll nicht drei
           // Runden auf Grip warten und das fuer das Fahrverhalten halten.
           'setting-tyre-blankets': true,
           'phys-accel': 1.0,
           'setting-fuel-drain': 0, 'setting-crash-count': 4,
           'setting-crash-damage': false,
           'setting-crash-threshold': 40,
           'setting-repair-time': 4,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck. Bei Pro AUS -
           // es ist die Vorgabe, und die drei Effekte gehoeren zu den Klassen, die sich
           // ausdruecklich schwerer fahren.
           'setting-brake-fade': false,
           'setting-brake-fade-strength': 1.0,
           'setting-dirtyair': false,
           'setting-dirtyair-strength': 1.0,
           'setting-tyre-asym': false,
           'setting-tyre-pressure': 1.8,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 1.8 },
    },
    gt3: {
      label: 'GT3',
      kurz: 'Sportlich, mit Simulationstiefe',
      text: 'Von Hand schalten, 2,9 s auf 100, Reifenverschleiß und Tankgewicht knapp zur Hälfte. Bremsfading, Windschatten und ungleicher Verschleiß sind voll an. Die harte, gegen echte Werte kalibrierte Fassung steht daneben als Realismus GT3.',
      v: { 'setting-grip': 0.87, 'setting-brakepower': 1.15, 'setting-autoshift': false,
           'setting-zero-to-top': 2.9, 'setting-coast-drag': 0.9, 'setting-fuelweight': 0.45,
           'setting-tyres': 0.9, 'phys-steerresp': 1.9, 'setting-brakebias': 60,
           // Lenkkalibrierung 1,0 heisst: der uebertragene Winkel ist genau der gerechnete.
           // Die Klassen ab GT3 sind gegen gemessenes Verhalten abgestimmt, und eine
           // Kalibrierung darauf waere ein Aufschlag auf eine Messung.
           'setting-steer-calib': 1.55,
           'phys-accel': 1.0,
           'setting-crash-threshold': 35,
           // Bei Kalibrierung 1,0 wirkt schon 1,0 deutlich: 25 Grad statt 41 bei 100 km/h.
           'setting-brake-steal': 1.1,
           // Waermer AUS. Im GT-Sport sind Waermedecken meist untersagt, und die ersten Runden
           // auf kalten Reifen sind ein Teil dessen, was diese Klasse ausmacht.
           'setting-tyre-blankets': false,
           'setting-fuel-drain': 1.3, 'setting-crash-count': 4,
           'setting-crash-damage': true,
           'setting-repair-time': 11,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck.
           'setting-brake-fade': true,
           'setting-brake-fade-strength': 1.0,
           'setting-dirtyair': true,
           'setting-dirtyair-strength': 1.0,
           'setting-tyre-asym': true,
           'setting-tyre-pressure': 1.8,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 1.45 },
    },
    gt4: {
      label: 'GT4',
      kurz: 'Weniger Leistung, mehr Reserve',
      text: 'Automatik, 3,1 s auf 100, Reifenverschleiß und Tankgewicht knapp halb so stark wie im Realismus-GT3. Die Klasse direkt neben Pro: Bremsfading, Windschatten und ungleicher Verschleiß sind an, aber gutmütig eingestellt, und die Lenkkalibrierung liegt bei 175 Prozent.',
      v: { 'setting-grip': 0.95, 'setting-brakepower': 1.3, 'setting-autoshift': true,
           'setting-zero-to-top': 3.1, 'setting-coast-drag': 0.75, 'setting-fuelweight': 0.3,
           'setting-tyres': 0.45, 'phys-steerresp': 2.15, 'setting-brakebias': 59,
           // Lenkkalibrierung 1,0 heisst: der uebertragene Winkel ist genau der gerechnete.
           // Die Klassen ab GT3 sind gegen gemessenes Verhalten abgestimmt, und eine
           // Kalibrierung darauf waere ein Aufschlag auf eine Messung.
           'setting-steer-calib': 1.75,
           'phys-accel': 1.0,
           'setting-crash-threshold': 40,
           // Etwas gutmuetiger als GT3, wie die ganze Klasse.
           'setting-brake-steal': 1.05,
           // Waermer aus, wie GT3.
           'setting-tyre-blankets': true,
           'setting-fuel-drain': 0.7, 'setting-crash-count': 4,
           'setting-crash-damage': false,
           'setting-repair-time': 8,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck.
           'setting-brake-fade': true,
           'setting-brake-fade-strength': 0.95,
           'setting-dirtyair': true,
           'setting-dirtyair-strength': 0.95,
           'setting-tyre-asym': true,
           'setting-tyre-pressure': 1.8,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 1.6 },
    },
    f1: {
      label: 'F1',
      kurz: 'Das schärfste der fahrbaren',
      text: 'Von Hand schalten, 2,5 s auf 100, stärkster Reifenverschleiß der drei Klassen und die kürzeste Bremse. Die am feinsten dosierbare Lenkung, langes Ausrollen, und Windschatten wirkt am stärksten. Reifenwärmer an.',
      v: { 'setting-grip': 0.97, 'setting-brakepower': 1.45, 'setting-autoshift': false,
           'setting-zero-to-top': 2.5, 'setting-coast-drag': 1.2, 'setting-fuelweight': 0.6,
           'setting-tyres': 1.2, 'phys-steerresp': 1.6, 'setting-brakebias': 63,
           // Lenkkalibrierung 1,0 heisst: der uebertragene Winkel ist genau der gerechnete.
           // Die Klassen ab GT3 sind gegen gemessenes Verhalten abgestimmt, und eine
           // Kalibrierung darauf waere ein Aufschlag auf eine Messung.
           'setting-steer-calib': 1.4,
           'phys-accel': 1.0,
           'setting-crash-threshold': 30,
           // Der schaerfste Reibkreis, aber nicht am Notboden: bei Kalibrierung 1,0 gibt 1,15
           // schon 13 Grad, und das ist kein Fahren mehr.
           'setting-brake-steal': 1.1,
           // Waermer an. In der Formel 1 waren Waermedecken bis 2024 erlaubt und sind seit 2025
           // verboten - hier ist es die Einstellung, die zur schaerfsten Klasse passt.
           'setting-tyre-blankets': true,
           'setting-fuel-drain': 2.7, 'setting-crash-count': 3,
           'setting-crash-damage': true,
           'setting-repair-time': 16,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck.
           'setting-brake-fade': true,
           'setting-brake-fade-strength': 1.25,
           'setting-dirtyair': true,
           'setting-dirtyair-strength': 1.35,
           'setting-tyre-asym': true,
           'setting-tyre-pressure': 1.75,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 1.6 },
    },
    // DIE KALIBRIERTE FASSUNG, und sie steht hier, damit sie nicht verlorengeht.
    //
    // Das ist das GT3 aus v0.4 Wort fuer Wort: 3,2 s auf 100 ist die gemessene Reihe, gegen
    // die die Physik gefittet ist (RMSE 7,3 %), und die uebrigen Werte gehoeren dazu. Als die
    // drei Klassen an Pro gerueckt sind, waere diese Abstimmung sonst mitgewandert - und mit
    // ihr die einzige, deren Zahlen aus Messungen kommen und nicht aus einer Anpassung.
    realgt3: {
      label: 'Realismus GT3',
      kurz: 'Gegen echte Werte kalibriert',
      text: 'Von Hand schalten, 3,2 s auf 100 – die gemessene Reihe, gegen die die Physik gefittet ist –, voller Reifenverschleiß und volles Tankgewicht. Wenig Grip, schwache Bremse, langes Ausrollen, keine Reifenwärmer. Das ist die haerteste der sechs Abstimmungen und die einzige, deren Zahlen aus Messungen kommen und nicht aus einer Anpassung. Ein Fahrfehler kostet hier Zeit.',
      v: { 'setting-grip': 0.72, 'setting-brakepower': 0.85, 'setting-autoshift': false,
           'setting-zero-to-top': 3.2, 'setting-coast-drag': 1.25, 'setting-fuelweight': 1.0,
           'setting-tyres': 2.0, 'phys-steerresp': 1.3, 'setting-brakebias': 62,
           // Lenkkalibrierung 1,0 heisst: der uebertragene Winkel ist genau der gerechnete.
           // Die Klassen ab GT3 sind gegen gemessenes Verhalten abgestimmt, und eine
           // Kalibrierung darauf waere ein Aufschlag auf eine Messung.
           'setting-steer-calib': 1.0,
           'phys-accel': 1.0,
           'setting-crash-threshold': 30,
           // Bei Kalibrierung 1,0 wirkt schon 1,0 deutlich: 25 Grad statt 41 bei 100 km/h.
           'setting-brake-steal': 1.0,
           // Waermer AUS. Im GT-Sport sind Waermedecken meist untersagt, und die ersten Runden
           // auf kalten Reifen sind ein Teil dessen, was diese Klasse ausmacht.
           'setting-tyre-blankets': false,
           'setting-fuel-drain': 3.0, 'setting-crash-count': 5,
           'setting-crash-damage': true,
           'setting-repair-time': 20,
           // Block 4: Bremsfading, Windschatten, Reifenasymmetrie und -druck.
           'setting-brake-fade': true,
           'setting-brake-fade-strength': 1.0,
           'setting-dirtyair': true,
           'setting-dirtyair-strength': 1.0,
           'setting-tyre-asym': true,
           'setting-tyre-pressure': 1.8,
           // Gasfaktor: wie frueh das Auto volle Motorleistung bekommt. 1,0 ist
           // das Byte genau proportional zum Tacho, also die kalibrierte Fassung.
           'setting-topspeed': 1.0 },
    },
  };
  // Bis v0.4 hiess GT3 "real". Aeltere exportierte Abstimmungen und der Knopf im
  // Garagenschirm duerfen den alten Namen weiter benutzen.
  const PRESET_ALIAS = { real: 'gt3', realismus: 'gt3' };

  // Every control in an option row, found by walking the DOM rather than from a list. A
  // hand-kept list would silently omit whatever gets added next, and the omission would only
  // show up as a preset string that quietly drops a setting.
  function presetControls() {
    // NUR im Optionen-Tab suchen, nicht im ganzen Dokument.
    //
    // Die Karte verspricht ausdruecklich: "nicht die Rennlaenge, nicht das Wetter, nicht die
    // Strecke, denn die gehoeren zum Rennen und nicht zum Auto." Dieses Versprechen hing
    // vorher daran, dass es ausserhalb der Optionen zufaellig keine .opt-row gab. Sobald die
    // Renneinstellungen dieselbe Zeilenform bekamen, zog eine Voreinstellung Rennlaenge,
    // Wetter und Pflichtstopps mit - messbar daran, dass der Ausgabetext von 861 auf 1015
    // Zeichen wuchs. Jetzt steht das Versprechen im Selektor und nicht im Zufall.
    // data-preset-skip nimmt einzelne Bedienelemente aus, und es gibt genau einen Grund
    // dafuer: der Layout-Waehler beschreibt, WELCHES Auto man hat, und die Voreinstellungen
    // beschreiben, WIE es abgestimmt ist. Zwei Achsen. Ohne die Ausnahme wuerde ein Klick auf
    // "GT3" das Auto wechseln - und das ist keine Abstimmung, sondern ein anderer Wagen.
    //
    // Dasselbe Muster wie data-i18n-skip in der Uebersetzung: ein Attribut am Element, damit
    // die Ausnahme dort steht, wo sie gilt, und nicht in einer Liste woanders.
    return [...document.querySelectorAll(
      '#tab-options .opt-row input[id]:not([data-preset-skip]), '
      + '#tab-options .opt-row select[id]:not([data-preset-skip])')];
  }

  function presetRead() {
    const out = {};
    for (const el of presetControls()) {
      out[el.id] = el.type === 'checkbox' ? el.checked
                 : el.type === 'range' ? +el.value : el.value;
    }
    return out;
  }

  // Setting .value does not run the app's handlers, so both events are dispatched: 'input'
  // for the live readouts and 'change' for the ones that only commit on release. Sending
  // both to everything is harmless and beats guessing which control listens for which.
  function presetSet(id, val) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.type === 'checkbox') {
      if (el.checked === !!val) return true;
      el.checked = !!val;
    } else {
      if (String(el.value) === String(val)) return true;
      el.value = val;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function presetSay(t) { $('preset-status').textContent = t; }

  function applyPreset(key) {
    const p = PRESETS[key] || PRESETS[PRESET_ALIAS[key]];
    if (!p) return;
    let n = 0;
    const missing = [];
    for (const [id, val] of Object.entries(p.v)) {
      if (presetSet(id, val)) n++; else missing.push(id);
    }
    presetSay(p.label + ': ' + n + ' Regler gesetzt'
              + (missing.length ? ', nicht gefunden: ' + missing.join(', ') : ''));
    $('preset-json').value = JSON.stringify(presetRead());
  }

  // Die Knoepfe werden aus PRESETS GEBAUT statt einzeln gebunden. Vorher standen drei
  // Zeilen im Markup und drei im Skript, und ein vierter Eintrag haette an beiden Stellen
  // nachgetragen werden muessen - genau die Art Doppelpflege, die man beim fuenften
  // vergisst.
  function renderPresetButtons(host, klein) {
    if (!host) return;
    host.innerHTML = '';
    for (const [key, p] of Object.entries(PRESETS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = klein ? '' : 'preset-' + key;
      b.textContent = p.label;
      b.title = p.kurz + ' \u2013 ' + p.text;
      b.addEventListener('click', () => applyPreset(key));
      host.appendChild(b);
    }
  }
  renderPresetButtons($('preset-buttons'), false);

  // Fuer den Fahrmodus-Knopf im Cockpit. Ueber das Fenster, weil 50-drive.js VOR dieser
  // Datei gebaut wird und applyPreset dort zur Deklarationszeit noch nicht existiert - zur
  // Laufzeit schon. Genau dieser Unterschied hat in dieser Datei fuenf Ladeabbrueche
  // gekostet, deshalb steht er als Kommentar an beiden Enden.
  window.__applyPreset = applyPreset;
  window.__presetKeys = () => Object.keys(PRESETS);
  // Fuer den Cockpit-Knopf: er soll ab der EINGESTELLTEN Variante weiterschalten und nicht
  // immer bei der ersten anfangen. Ein Knopf, der aus "GT3" ein "Arcade" macht, wirkt wie
  // ein Ruecksprung. Als Funktion und nicht als Wert, weil sich die Antwort mit jedem
  // Reglerzug aendert.
  window.__presetActive = () => presetAktiv();
  // Die Sollwerte, fuer die Rasterpruefung im Selbsttest. Als Kopie hinausgegeben, damit
  // ein Test die Tabelle nicht versehentlich veraendert.
  window.__presetValues = (k) => (PRESETS[k] ? Object.assign({}, PRESETS[k].v) : null);
  // Die drei Texte je Voreinstellung, fuer die Sprachpruefung. Sie kann nicht ueber das
  // Dokument gehen: die Legende zeigt nur die EINGESTELLTE Variante, vier von fuenf Texten
  // stehen beim Pruefen also gar nicht da.
  window.__presetTexts = (k) => (PRESETS[k]
    ? { label: PRESETS[k].label, kurz: PRESETS[k].kurz, text: PRESETS[k].text } : null);
  window.__presetLabel = (k) => (PRESETS[k] || {}).label || k;

  // Der Erklaertext der EINGESTELLTEN Variante, aus demselben Objekt. Bis v0.5 standen alle
  // fuenf untereinander; das war eine Wand aus Text, in der man den eigenen Zustand nicht
  // fand.
  //
  // Der Punkt, an dem es interessant wird, ist nicht das Reduzieren, sondern der Fall
  // danach: wer nach einem Klick EINEN Regler verstellt, hat keine Variante mehr. Stuende
  // dann weiter der Text der letzten, waere er ab diesem Moment falsch - und unsichtbar
  // falsch, denn die Anzeige behauptet "GT3", das Auto faehrt etwas anderes.
  //
  // Deshalb wird nicht GEMERKT, was geklickt wurde, sondern GEMESSEN, was eingestellt ist.
  // Ein gemerkter Zustand kann auseinanderlaufen, ein gemessener nicht.
  function presetGleich(a, b) {
    // Toleranz statt ===: presetRead() wandelt nur range-Elemente in Zahlen, und eine
    // Schrittweite von 0.05 trifft 0.85 nicht zwangslaeufig exakt. 1e-6 ist enger als jede
    // Schrittweite und weiter als jeder Gleitkommafehler.
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    const za = +a, zb = +b;
    if (isFinite(za) && isFinite(zb)) return Math.abs(za - zb) < 1e-6;
    return String(a) === String(b);
  }

  function presetAktiv() {
    const ist = presetRead();
    for (const [key, p] of Object.entries(PRESETS)) {
      let passt = true;
      for (const [id, soll] of Object.entries(p.v)) {
        // Ein Schluessel, dessen Element es nicht (mehr) gibt, darf die Variante nicht
        // stillschweigend passend machen: dann waere jede Voreinstellung "aktiv", sobald
        // genug Regler fehlen.
        if (!(id in ist) || !presetGleich(ist[id], soll)) { passt = false; break; }
      }
      if (passt) return key;
    }
    return null;
  }

  function renderPresetLegende() {
    const key = presetAktiv();
    // Der Fahrmodus-Knopf im Cockpit zeigt dieselbe Auskunft und wird deshalb HIER
    // mitgeschrieben, aus derselben Rechnung. Er stand vorher fest auf "GT3" und log damit
    // beim Laden: die Markup-Vorgaben entsprechen keiner Variante, GT3 am naechsten mit
    // 6 von 13 abweichenden Reglern. Zwei Anzeigen derselben Sache, und eine davon falsch.
    const knopf = $('race-act-mode-txt');
    if (knopf) knopf.textContent = key ? PRESETS[key].label : 'Eigen';
    const host = $('preset-legend');
    if (!host) return;
    if (!key) {
      host.innerHTML = '<div class="preset-leg"><b>Eigene Abstimmung</b> <span class="muted">'
        + 'kein fertiger Satz</span><small>Mindestens ein Regler weicht von allen f\u00fcnf '
        + 'Voreinstellungen ab. Ein Klick oben setzt wieder einen ganzen Satz.</small></div>';
      return;
    }
    const p = PRESETS[key];
    host.innerHTML = '<div class="preset-leg"><b>' + p.label + '</b> <span class="muted">'
      + p.kurz + '</span><small>' + p.text + '</small></div>';
  }

  $('preset-export').addEventListener('click', () => {
    $('preset-json').value = JSON.stringify(presetRead());
    presetSay(presetControls().length + ' Regler hineingeschrieben, jetzt kopieren.');
  });

  $('preset-import').addEventListener('click', () => {
    const raw = $('preset-json').value.trim();
    if (!raw) { presetSay('Da steht nichts.'); return; }
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) { presetSay('Das ist kein JSON.'); return; }
    if (!cfg || typeof cfg !== 'object') { presetSay('Das ist keine Abstimmung.'); return; }
    // Checked against the controls, not trusted: this arrives by copy and paste, and a value
    // outside a slider's range sets the slider to its limit without saying so - which reads
    // as "it worked" when it did not.
    const bad = [], unknown = [];
    for (const [id, val] of Object.entries(cfg)) {
      const el = document.getElementById(id);
      // phys-trailbrake gab es bis v0.3. Es wird bewusst NICHT auf setting-brakebias
      // umgerechnet: ein Bonus auf die Lenkgrenze und ein Anteil der Bremskraft sind
      // verschiedene Groessen, und eine erfundene Umrechnung waere schlimmer als ein
      // ehrliches "uebergangen".
      if (!el) { unknown.push(id); continue; }
      if (el.type === 'checkbox') continue;
      if (el.tagName === 'SELECT') {
        if (![].some.call(el.options, o => o.value === val)) bad.push(id + '=' + val);
      } else {
        const v = +val;
        if (!isFinite(v) || v < +el.min || v > +el.max) bad.push(id + '=' + val);
      }
    }
    if (bad.length) { presetSay('Unbrauchbare Werte: ' + bad.join(', ')); return; }
    let n = 0;
    for (const [id, val] of Object.entries(cfg)) if (presetSet(id, val)) n++;
    presetSay(n + ' Regler gesetzt'
              + (unknown.length ? ', ' + unknown.length + ' unbekannt \u00fcbergangen' : ''));
  });

  $('preset-json').value = JSON.stringify(presetRead());
  renderPresetLegende();
  // Einmal beim Laden, aus der LETZTEN Quelldatei: hier sind alle let initialisiert.
  // In 50-drive.js gerufen war es die temporale Todeszone - currentTrackTiles steht in
  // 60-track.js, und typeof schuetzt dort nicht (bei einem let wirft schon typeof).
  if (window.__dirtyAirVerfuegbar) window.__dirtyAirVerfuegbar();

  // ---- Eigene Abstimmungen auf diesem Geraet ------------------------------------------
  // Strecken und Motoren haben ihre eigene Ablage schon (carrera-hybrid-tracks,
  // chc.motorwerkstatt.v1); die Abstimmung war das einzige, was nur ueber den Textkasten
  // ging - also kopieren, irgendwo hinlegen, wiederfinden.
  const PRESET_STORE = 'chc.presets.v1';

  function presetStoreRead() {
    try { return JSON.parse(localStorage.getItem(PRESET_STORE) || '{}') || {}; }
    catch { return {}; }
  }
  function presetStoreWrite(o) {
    try { localStorage.setItem(PRESET_STORE, JSON.stringify(o)); }
    catch (e) { presetSay('Konnte nicht ablegen: ' + e.message); }
  }
  function presetStoreList() {
    const sel = $('preset-store-list');
    if (!sel) return;
    const namen = Object.keys(presetStoreRead()).sort();
    sel.innerHTML = '<option value="">\u2013 abgelegt \u2013</option>'
      + namen.map(n => '<option>' + n.replace(/</g, '&lt;') + '</option>').join('');
  }

  if ($('preset-store-save')) {
    $('preset-store-save').addEventListener('click', () => {
      const name = $('preset-store-name').value.trim();
      if (!name) { presetSay('Erst einen Namen eingeben.'); return; }
      const o = presetStoreRead();
      const neu = !(name in o);
      o[name] = presetRead();
      presetStoreWrite(o);
      presetStoreList();
      $('preset-store-list').value = name;
      presetSay('"' + name + '" ' + (neu ? 'abgelegt' : 'überschrieben')
                + ', ' + Object.keys(o[name]).length + ' Regler.');
    });

    $('preset-store-load').addEventListener('click', () => {
      const name = $('preset-store-list').value;
      if (!name) { presetSay('Nichts ausgewählt.'); return; }
      const cfg = presetStoreRead()[name];
      if (!cfg) { presetSay('"' + name + '" ist nicht mehr da.'); return; }
      // Ueber den Textkasten und den vorhandenen Uebernehmen-Knopf: dessen Pruefung faengt
      // Werte ab, die es in dieser Fassung nicht mehr gibt oder die ausserhalb eines
      // Reglerbereichs liegen. Ein Speicherstand aus einer aelteren Fassung ist genau der
      // Fall, fuer den die Pruefung gebaut wurde - sie hier zu umgehen waere absurd.
      $('preset-json').value = JSON.stringify(cfg);
      $('preset-import').click();
      $('preset-store-name').value = name;
    });

    $('preset-store-del').addEventListener('click', () => {
      const name = $('preset-store-list').value;
      if (!name) { presetSay('Nichts ausgewählt.'); return; }
      const o = presetStoreRead();
      delete o[name];
      presetStoreWrite(o);
      presetStoreList();
      presetSay('"' + name + '" gelöscht.');
    });

    presetStoreList();
  }

  // ---- Die Knopfleiste in der Garage --------------------------------------------------
  // Sie ruft applyPreset(), also DIESELBE Funktion wie in den Optionen. presetSet() feuert
  // 'input' und 'change' mit bubbles, damit ziehen die Regler drueben von selbst nach -
  // es gibt keinen zweiten Zustand, der auseinanderlaufen koennte.
  renderPresetButtons($('gar-preset-buttons'), true);

  // Sichtbar nur, wenn ein Auto gesteuert wird. renderGarage() ruft das mit; ausserdem
  // einmal beim Laden, damit die Leiste nicht sichtbar startet.
  function updateGaragePresetRow() {
    const host = $('gar-preset');
    if (!host) return;
    const fahrer = typeof playerCar !== 'undefined' && playerCar
                   && garage.some(c => c === playerCar && c.role === 'player');
    host.style.display = fahrer ? '' : 'none';
  }
  window.__updateGaragePresetRow = updateGaragePresetRow;
  updateGaragePresetRow();


  // EIN Zuhoerer am Tab statt einer je Regler: presetControls() findet 45 Elemente, und
  // 45 Zuhoerer waeren 45 Stellen, an denen einer fehlen kann. Ueber die Blasenphase ist
  // auch ein Regler abgedeckt, der erst nach dem Laden dazukommt - und applyPreset()
  // feuert dieselben Ereignisse, also braucht es dort keinen zweiten Aufruf.
  if ($('tab-options')) {
    for (const ev of ['input', 'change']) {
      $('tab-options').addEventListener(ev, (e) => {
        if (e.target && e.target.closest && e.target.closest('.opt-row')) {
          renderPresetLegende();
        }
      });
    }
  }

})();
