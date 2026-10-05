  // ============================== CHALLENGES (v0.8.30, experimentell) ==============================
  //
  // BESTELLT: "Implementiere Challenges". Der Plan dazu steht in mockup/challenges.html:
  //   - vier feste Strecken zum Nachbauen, zwei aus der Grundpackung, eine mit dem
  //     Haarnadel-Set, eine mit dem 30-Grad-Aussenkurven-Set;
  //   - je Strecke zwei Modi: BESTE RUNDE (beliebig viele Runden, die schnellste zaehlt) und
  //     RENNEN (feste Rundenzahl, die Gesamtzeit zaehlt) - BESTELLT: "Mach pro Strecke: beste
  //     Rundenzeit (unendlich viele Runden, beste wird gezaehlt) und das Rundenrennen";
  //   - das Pro-Preset: die Abstimmung gleichen Namens aus 98-presets.js,
  //     dazu Steuerungsmodus Physik, trocken, voller Tank, keine Pflichtstopps, keine Ghosts;
  //   - "Auto muss stehen, dann kommt eine Ampel, dann los; die Zeit wird gespeichert";
  //   - Bestenliste mit Abstaenden, waagerechtes Histogramm (oben schnell), eigene Zeit
  //     markiert, "Du warst schneller als X % der Spieler".
  //
  // DIE RENNMASCHINE WIRD MITBENUTZT und nicht nachgebaut: Ampel (startRaceCountdown), Runden
  // (playerLapCrossed -> raceLapTimes), Ende (finishRace). Beste Runde laeuft als freies
  // Training MIT Ampel, das Rennen als Modus "Runden". Vier Haken in 70-race.js fragen
  // challengeLaeuft() bzw. rufen challengeRennenEnde(); sonst weiss die Rennmaschine nichts
  // von Challenges.
  //
  // WAS VORHER EINGESTELLT WAR, KOMMT DANACH ZURUECK: Regler, Rennmodus, Rundenzahl, Wetter,
  // Pflichtstopps, Tank, fliegender Start und die Strecke. Eine Challenge, die hinterher die
  // eigene Abstimmung ueberschrieben laesst, waere eine Falle.
  //
  // ONLINE-BESTENLISTE: ein Google Sheet mit Apps-Script-Web-App (Anleitung und Skript in
  // tools/challenges-apps-script.gs). Die App spricht nur ueber chHochladen() und
  // chListeLaden(); ein Umzug auf einen anderen Dienst aendert nur diese zwei.

  // NAMEN (v0.8.35): BESTELLT "Namen, die so aehnlich wie die von echten Rennstrecken sind (aber
  // anders), damit die nicht uebersetzt werden muessen" - Monza, Suzuka, Monte Carlo, Silverstone.
  // WOCHENSTRECKEN (v0.8.44). BESTELLT: "Mache Vorschlaege fuer 20 verschiedene Strecken je
  // Kategorie (also 4x20), die nacheinander jede Woche rotieren ... Update soll jeweils Mittwochs
  // passieren." Abgesegnet am Mock-up mockup/wochenstrecken.html. Jede Kategorie hat 20 Strecken;
  // Woche 1 beginnt Mittwoch, 30.09.2026, 0:00 deutscher Zeit, nach 20 Wochen von vorn (chWoche).
  // Alle sind geschlossen, kreuzungsfrei (Bahnen > 30 cm auseinander), hoechstens 2,6 x 2,6 m und
  // aus den Teilen ihrer Kategorie baubar - der Selbsttest prueft das fuer alle 80. Die vier
  // bisherigen Strecken behalten ihre Kennung (oval, schlange, kehre, weitblick), damit ihre
  // Bestenlisten gelten; jede Liste haengt an der Kennung und kommt nach 20 Wochen wieder.
  // Kategorien: A kurz (Grundpackung, 8-12 Teile), B lang (13-15), C beide Haarnadeln, D beide
  // 30-Grad-Paare. Idee-Texte haben nur die vier alten, die anderen bekommen einen aus der
  // Kategorie (chIdee).
  const CH_KAT_SETS = { A: ['grund'], B: ['grund'], C: ['grund', 'haarnadel'], D: ['grund', 'dreissig'] };
  const CH_KATALOG = {
    A: [
      { id: 'wa01-imolina', name: 'Imolina', code: 'SRRRGRRR', runden: 12 },
      { id: 'wa02-zandwoorde', name: 'Zandwoorde', code: 'SRGRRLRRRLRR', runden: 12 },
      { id: 'wa03-hockenhain', name: 'Hockenhain', code: 'SRRRRLGRRRRL', runden: 12 },
      { id: 'wa04-brandsby', name: 'Brandsby', code: 'SRRRGGRRRG', runden: 12 },
      { id: 'wa05-oultonia', name: 'Oultonia', code: 'SRRGRRGRR', runden: 12 },
      { id: 'wa06-magnycour', name: 'Magnycour', code: 'SRRLRRGRRLRR', runden: 12 },
      { id: 'wa07-estorilla', name: 'Estorilla', code: 'SRGRRRLRRR', runden: 12 },
      { id: 'wa08-jerezito', name: 'Jerezito', code: 'SRRRLRRGRRG', runden: 12 },
      { id: 'wa09-assenburg', name: 'Assenburg', code: 'SRGRRGRLRRRG', runden: 12 },
      { id: 'wa10-mugellino', name: 'Mugellino', code: 'SRGRRGRGRR', runden: 12 },
      { id: 'wa11-donningham', name: 'Donningham', code: 'SRRRGLRRRGRG', runden: 12 },
      { id: 'wa12-knockhilly', name: 'Knockhilly', code: 'SRRRLRGRRRLR', runden: 12 },
      { id: 'wa13-zolderen', name: 'Zolderen', code: 'SRGRGRGRRLRR', runden: 12 },
      { id: 'wa14-oscherlingen', name: 'Oscherlingen', code: 'SRLRRRGRLRRR', runden: 12 },
      { id: 'wa15-sachsenried', name: 'Sachsenried', code: 'SRRGRGRGRRG', runden: 12 },
      { id: 'wa16-anderstrup', name: 'Anderstrup', code: 'SRRRGLRRRRLR', runden: 12 },
      { id: 'wa17-hungarella', name: 'Hungarella', code: 'SRRRLRGRRGRG', runden: 12 },
      { id: 'wa18-misanello', name: 'Misanello', code: 'SRRGRRLRRRG', runden: 12 },
      { id: 'wa19-kyalamo', name: 'Kyalamo', code: 'SRGRRRLGRRRG', runden: 12 },
      { id: 'wa20-salzbergring', name: 'Salzbergring', code: 'SRRRGRLRRRRL', runden: 12 },
    ],
    B: [
      { id: 'oval', name: 'Monzetta', code: 'SGR2GR2LGR3G', runden: 10,
        idee: 'Zum Warmwerden: lange Gerade, ein kleiner Knick nach links, Bremspunkte lernen.' },
      { id: 'schlange', name: 'Suzuna', code: 'SRRRGLLRRRRGGGR', runden: 8,
        idee: 'Die zwei Linkskurven bilden ein S. Wer dort sauber umlenkt, gewinnt.' },
      { id: 'wb03-interlagoa', name: 'Interlagoa', code: 'SRGRGGRRLRRLRRG', runden: 10 },
      { id: 'wb04-montrealle', name: 'Montrealle', code: 'SGRRRRLLRRRRG', runden: 10 },
      { id: 'wb05-barcelonetta', name: 'Barcelonetta', code: 'SRGLRRRRGLGRRR', runden: 10 },
      { id: 'wb06-castelletto', name: 'Castelletto', code: 'SRRLRRRGLRRRG', runden: 10 },
      { id: 'wb07-sepangga', name: 'Sepangga', code: 'SRRGRLRRGRRLR', runden: 10 },
      { id: 'wb08-fujimoro', name: 'Fujimoro', code: 'SGRRRLGRRLRRGRG', runden: 10 },
      { id: 'wb09-laguna-sekka', name: 'Laguna Sekka', code: 'SRRGRRGLRGRRRGL', runden: 10 },
      { id: 'wb10-watkins-dale', name: 'Watkins Dale', code: 'SRGRRLGRRRGLRR', runden: 10 },
      { id: 'wb11-road-atlantica', name: 'Road Atlantica', code: 'SRGRLRGRRGRLGRR', runden: 10 },
      { id: 'wb12-sebringa', name: 'Sebringa', code: 'SRLRRRGGRLRRRG', runden: 10 },
      { id: 'wb13-daytonella', name: 'Daytonella', code: 'SRGRGRGRLRRRLR', runden: 10 },
      { id: 'wb14-bathursta', name: 'Bathursta', code: 'SRRLRRGGRRLRRG', runden: 10 },
      { id: 'wb15-phillip-isle', name: 'Phillip Isle', code: 'SRRGLRRRGRLRR', runden: 10 },
      { id: 'wb16-portimanta', name: 'Portimanta', code: 'SRRGLRRGRRGLRR', runden: 10 },
      { id: 'wb17-aragonita', name: 'Aragonita', code: 'SRGRGGRRRLLRRRG', runden: 10 },
      { id: 'wb18-shanghaio', name: 'Shanghaio', code: 'SRRGRRGLGRRRGRL', runden: 10 },
      { id: 'wb19-istanbella', name: 'Istanbella', code: 'SRRLRGRGRGRLRRG', runden: 10 },
      { id: 'wb20-losaya', name: 'Losaya', code: 'SGRRLRRRGLGRRRG', runden: 10 },
    ],
    C: [
      { id: 'kehre', name: 'Monte Carlito', code: 'SGRRRLHJRRRRG', runden: 8,
        idee: 'Zwei Haarnadeln direkt hintereinander als enges S: voll in die Bremse, umlegen, sauber raus.' },
      { id: 'wc02-macaolo', name: 'Macaolo', code: 'SRRGHJRGRRLRRRGL', runden: 8 },
      { id: 'wc03-bakuna', name: 'Bakuna', code: 'SRGRRLRRRRJH', runden: 8 },
      { id: 'wc04-singaporta', name: 'Singaporta', code: 'SRRLRRLHGGJRRRRG', runden: 8 },
      { id: 'wc05-long-beacho', name: 'Long Beacho', code: 'SRRRGLRGHJRRRRLG', runden: 8 },
      { id: 'wc06-adelaina', name: 'Adelaina', code: 'SRGRLRRRRJHLRR', runden: 8 },
      { id: 'wc07-pauvilla', name: 'Pauvilla', code: 'SRRGHJRRLRRRRLG', runden: 8 },
      { id: 'wc08-detroita', name: 'Detroita', code: 'SRRGLGRRGHJRRLRR', runden: 8 },
      { id: 'wc09-jeddara', name: 'Jeddara', code: 'SRRRJHGRRLRR', runden: 8 },
      { id: 'wc10-norisburg', name: 'Norisburg', code: 'SRGRLRRRLGRRRJHG', runden: 8 },
      { id: 'wc11-villa-reala', name: 'Villa Reala', code: 'SRGRRLRRJHGRGRLR', runden: 8 },
      { id: 'wc12-surfers-parada', name: 'Surfers Parada', code: 'SRRRJRHLRRLRR', runden: 8 },
      { id: 'wc13-montjuicita', name: 'Montjuicita', code: 'SRGRLRGRRRGJHLRR', runden: 8 },
      { id: 'wc14-pedralbia', name: 'Pedralbia', code: 'SRHLJRRRGRRLRRG', runden: 8 },
      { id: 'wc15-avusa', name: 'Avusa', code: 'SHJRRGRRRLLRRRG', runden: 8 },
      { id: 'wc16-monsanta', name: 'Monsanta', code: 'SRRGRLRRRRJRHL', runden: 8 },
      { id: 'wc17-boavistella', name: 'Boavistella', code: 'SRRLHJRRRRGLRR', runden: 8 },
      { id: 'wc18-miamira', name: 'Miamira', code: 'SGRRRRLJRHLRGRRG', runden: 8 },
      { id: 'wc19-vegasina', name: 'Vegasina', code: 'SLRRRRJRRRRGGLHG', runden: 8 },
      { id: 'wc20-marinella-bay', name: 'Marinella Bay', code: 'SRRLLHGGRRJRRRRG', runden: 8 },
    ],
    D: [
      { id: 'weitblick', name: 'Silverbrook', code: 'SQRRRWGQRRRW', runden: 8,
        idee: 'Lang und schmal: die weiten 30-Grad-Bögen machen die Längsseiten schnell.' },
      { id: 'wd02-francorella', name: 'Francorella', code: 'SRRRQQRRWWLRRRGL', runden: 8 },
      { id: 'wd03-le-mansard', name: 'Le Mansard', code: 'SRRQRWGRRQRW', runden: 8 },
      { id: 'wd04-reimsville', name: 'Reimsville', code: 'SRGQRRRWQLRRRW', runden: 8 },
      { id: 'wd05-oesterwald', name: 'Österwald', code: 'SRRQWWRRRLQRR', runden: 8 },
      { id: 'wd06-mosporto', name: 'Mosporto', code: 'SRRRLQRWRRGQRW', runden: 8 },
      { id: 'wd07-road-amerigo', name: 'Road Amerigo', code: 'SRRLQWRRGRRLQWRR', runden: 8 },
      { id: 'wd08-talladina', name: 'Talladina', code: 'SRQWRRGRQWRR', runden: 8 },
      { id: 'wd09-brookfeld', name: 'Brookfeld', code: 'SLRRRQQRRGWWRLRR', runden: 8 },
      { id: 'wd10-montlherine', name: 'Montlhérine', code: 'SRGWRRQQRRWRLR', runden: 8 },
      { id: 'wd11-rouenna', name: 'Rouenna', code: 'SRGRWQRLRRWGRGQR', runden: 8 },
      { id: 'wd12-nivella', name: 'Nivella', code: 'SRQRRWGRQRRW', runden: 8 },
      { id: 'wd13-zeltbach', name: 'Zeltbach', code: 'SRRQGRWGRRQGRW', runden: 8 },
      { id: 'wd14-pergusella', name: 'Pergusella', code: 'SWRQRGRRWLQRRRG', runden: 8 },
      { id: 'wd15-charadella', name: 'Charadella', code: 'SLWRRRQWQRRRLRR', runden: 8 },
      { id: 'wd16-crystal-parc', name: 'Crystal Parc', code: 'SRRWRQGRRWRQ', runden: 8 },
      { id: 'wd17-goodwald', name: 'Goodwald', code: 'SRGRQRRQRWGRW', runden: 8 },
      { id: 'wd18-thruxford', name: 'Thruxford', code: 'SQRRRQWWRRLRR', runden: 8 },
      { id: 'wd19-jaramilla', name: 'Jaramilla', code: 'SRWQRRRLGRWQRRRL', runden: 8 },
      { id: 'wd20-nuerbelberg', name: 'Nürbelberg', code: 'SRRQRWGGRRQRWG', runden: 8 },
    ],
  };
  // DAUERRENNEN (BESTELLT): feste Strecken, die nicht mit den Wochen rotieren - die dritte
  // Kategorie unter den Wochenstrecken (ueber der Online-Kachel). Drei Strecken: eine kurze
  // aus der Grundpackung, eine lange mit Haarnadel-Set, und das 100-Runden-Rennen "Balkonia
  // 50 Kilometers" mit Pflichtboxenstopp und einem Regenfenster in Minute 2-4.
  const CH_DAUER = [
    { id: 'dauer-homington', name: 'Homington', code: 'SGR2GRGRLR3G@270', runden: 20, kat: 'E', sets: ['grund'] },
    { id: 'dauer-circuitdusol', name: 'Circuit Du Sol', code: 'SGRHLGJR4LR2GRG@270', runden: 20, kat: 'E', sets: ['grund', 'haarnadel'] },
    { id: 'dauer-balkonia', name: 'Balkonia 50 Kilometers', code: 'SG2RLGR3LGHLGLJR4G3R2@270', runden: 100, kat: 'E', sets: ['grund', 'grund', 'haarnadel'], max: 3.5, pit: 1, wx: [{ min: 2, wetter: 'rain' }, { min: 4, wetter: 'dry' }] },
  ];
  const CH_ALLE = [];
  Object.keys(CH_KATALOG).forEach((k) => CH_KATALOG[k].forEach((d, i) => {
    d.kat = k; d.woche = i + 1; d.sets = CH_KAT_SETS[k]; CH_ALLE.push(d);
  }));
  CH_DAUER.forEach((d) => CH_ALLE.push(d));
  // BESTELLT (Balkonia): ein festes Wetterfenster im Rennen (z. B. "Regen von Minute 2 bis 4").
  // Der Plan wird beim Anwenden der Challenge aus def.wx gebaut und im Rennstart (70-race.js)
  // ueber den vorhandenen mpWetter-Mechanismus gefahren; nach dem Lauf zurueckgesetzt.
  let chWetterPlan = null;
  // Wanduhr in Berlin als UTC-Zahl: so zaehlt ein Tag immer 24 h, auch ueber die Zeitumstellung.
  const CH_ANKER = Date.UTC(2026, 8, 30);          // Mittwoch, 30.09.2026, 0:00 in Berlin
  const CH_WOCHE_MS = 7 * 86400000;
  let chBerlinFmt = null;
  function chBerlinWand(ms) {
    try {
      if (!chBerlinFmt) chBerlinFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const p = {};
      chBerlinFmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    } catch (e) { return ms + 3600000; }      // ohne Zeitzonen-Daten: Winterzeit
  }
  // index 0-19 (davor gilt Woche 1), tage = volle oder angebrochene Tage bis zum naechsten Wechsel.
  function chWoche(ms) {
    const wand = chBerlinWand(ms === undefined ? Date.now() : ms);
    const n = Math.max(0, Math.floor((wand - CH_ANKER) / CH_WOCHE_MS));
    const naechste = wand < CH_ANKER ? CH_ANKER + CH_WOCHE_MS : CH_ANKER + (n + 1) * CH_WOCHE_MS;
    return { index: n % 20, woche: (n % 20) + 1, tage: Math.ceil((naechste - wand) / 86400000) };
  }
  function chAktuelle(ms) { const i = chWoche(ms).index; return 'ABCD'.split('').map((k) => CH_KATALOG[k][i]); }
  let CHALLENGES = chAktuelle();
  function chIdee(def) {
    if (def.idee) return t(def.idee);
    const tiles = chTiles(def);
    const gerade = tiles.map((x) => x.type === TILE_TYPE.STRAIGHT || x.type === TILE_TYPE.START);
    let g = 0;
    for (let i = 0; i < gerade.length; i++) {
      let l = 0;
      while (l < gerade.length && gerade[(i + l) % gerade.length]) l++;
      g = Math.max(g, l);
    }
    const vorlage = { A: 'Kurzer Kurs mit {n} Teilen: Rhythmus finden, jede Kurve zählt.',
                      B: 'Langer Kurs mit {n} Teilen, die längste Gerade hat {g} Teile: dort Anlauf holen.',
                      C: 'Stadtkurs mit beiden Haarnadeln: spät bremsen, eng einlenken, sauber raus.',
                      D: 'Schneller Kurs: die weiten 30-Grad-Bögen gehen fast voll, die engen Kurven entscheiden.',
                      E: 'Dauerrennen über {n} Teile: Ausdauer und saubere Runden zählen, die längste Gerade hat {g} Teile.' }[def.kat];
    return t(vorlage).replace('{n}', tiles.length).replace('{g}', g);
  }
  const CH_SET_NAME = { grund: 'Grundpackung', haarnadel: 'Haarnadel-Set', dreissig: '30°-Außenkurven-Set' };
  // BESTELLT (Balkonia): eine Strecke kann MEHRERE Packungen brauchen (z. B. zweimal Grund).
  // In der Anzeige zaehlt das, statt "Grundpackung + Grundpackung" zu wiederholen.
  function chSetsText(def) {
    const z = {};
    def.sets.forEach((s) => { z[s] = (z[s] || 0) + 1; });
    return Object.entries(z).map(([s, n]) => (n > 1 ? n + '× ' : '') + t(CH_SET_NAME[s])).join(' + ');
  }
  const CH_MODUS_NAME = { hotlap: 'Beste Runde', rennen: 'Rennen' };
  const CH_STORE = 'omegasim-challenges';
  const CH_ONLINE_STORE = 'omegasim-ch-online';
  // Die gemeinsame Bestenliste, fuer alle Kopien der App (btsr, omegasim, APK). BESTELLT: "Die
  // URL soll von beiden Repos genutzt werden." Unter Challenges > Online laesst sie sich
  // ueberschreiben; ein leeres Feld heisst "nur lokal".
  const CH_STANDARD_URL = 'https://script.google.com/macros/s/AKfycbxCgxLcORkrqnp1QU_9d3r1x6HuBor2ZlB6vFQFf1cT_noiVm_ePWPMWcKfbDsB7G-C/exec';
  const CH_GERAET_STORE = 'omegasim-geraet';
  const CH_STILL_MS = 1000;        // so lange muss das Auto stehen, bevor die Ampel kommt
  const CH_STILL_KMH = 1;
  const CH_FRUEHSTART_KMH = 3;     // dieselbe Schwelle wie raceMoveErkannt()

  // ---- GEGEN SCHUMMELN (v0.8.37) --------------------------------------------------------
  // BESTELLT: "pro Runde pruefen, ob 90 % der Teile korrekt sind (ab und zu gibt es
  // Fehllesungen). Sperre waehrend der Challenge die Einstellungen. Lege eine plausible
  // Mindestzeit fest."
  //
  // RUNDENPRUEFUNG: Auf der Schiene meldet das Auto jedes ueberfahrene Teil (70-race.js,
  // nach Bestaetigung und Kachelzaehler). Je Runde werden die gelesenen Teile gegen die
  // Strecke der Challenge gelegt. Verglichen wird die ART - Gerade, Rechts-, Linksdreher -,
  // nicht der genaue Code: die Hex-Codes stimmen noch nicht fuer alle Teile, und eine weite
  // 30-Grad-Kurve, die als 60-Grad-Kurve gelesen wird, ist keine andere Strecke. Masszahl ist
  // die laengste gemeinsame Folge geteilt durch die groessere der beiden Laengen: ein
  // fehlendes, ein falsches oder ein zusaetzliches Teil kostet je eines. Eine kuerzere oder
  // andere Bahn faellt damit heraus, eine einzelne Fehllesung nicht. Faehrt jemand die
  // Strecke andersherum, gilt dieselbe Strecke gespiegelt und rueckwaerts.
  const CH_PRUEF_QUOTE = 0.9;          
  // BESTELLT: "wenn eine Runde nicht zaehlt, einfach eine extra fahren". Im Rundenrennen
  // duerfen so viele Laeufe verpatzt werden, wie diese Reserve hergibt; die Wertung summiert
  // dann die ersten CH_EXTRA_LAPS gueltigen Runden. Die Strecke wird nie frueher beendet.
  const CH_EXTRA_LAPS = 3;
  // MINDESTZEIT: gemessen faehrt das Auto bei Vollgas etwa 5,9 km/h = 1,64 m/s (30-input.js,
  // REAL_SCALE, hochgerechnet aus 20 und 40 % Gas). 2,5 m/s liegt rund 50 % darueber und ist
  // damit auch fuer ein schnelleres Auto kein Hindernis; eine Runde, die schneller waere,
  // ist keine ganze Runde dieser Strecke. Dieselben Zahlen stehen im Apps Script.
  const CH_VMAX_MS = 2.5;
  function chMinRundeMs(def) { return Math.round(trackLaengeM(chTiles(def)) / CH_VMAX_MS * 1000); }
  function chKlasse(code) {
    if (!(code in TILE_LABEL)) return 'X';
    const d = tileTurnDeg(code);
    return d > 0 ? 'R' : d < 0 ? 'L' : 'G';
  }
  function chLcs(a, b) {
    const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] + 1 : Math.max(m[i - 1][j], m[i][j - 1]);
      }
    }
    return m[a.length][b.length];
  }
  // gelesen: die Codes einer Runde in Fahrreihenfolge (ohne Start/Ziel).
  function chRundePruefen(def, gelesen) {
    const soll = chTiles(def).slice(1).map((x) => chKlasse(x.type));
    const ist = gelesen.filter((c) => !isStartCode(c) && c !== TILE_OFFTRACK).map(chKlasse);
    const spiegel = soll.slice().reverse().map((k) => (k === 'R' ? 'L' : k === 'L' ? 'R' : k));
    const erkannt = Math.max(chLcs(soll, ist), chLcs(spiegel, ist));
    const quote = erkannt / Math.max(soll.length, ist.length, 1);
    return { ok: quote >= CH_PRUEF_QUOTE, erkannt, soll: soll.length, gelesen: ist.length, quote };
  }
  function chGrundText(w) { return t(w.grund || '').replace('{n}', w.n || ''); }

  let chWahl = 'oval', chModus = 'hotlap', chSpiegel = false;
  // BESTELLT: "bei dek challenges jeweils einen toggle ein, mit dem man die Strecke spiegeln
  // kann". Gespiegelt heisst hier wie in der Anti-Cheat-Pruefung (chRundePruefen): die
  // Schleife rueckwaerts fahren - Reihenfolge umkehren und links/rechts tauschen. So erkennt
  // die Wertung die gespiegelte Runde ohne Aenderung.
  function chSpiegelTiles(tiles) {
    const tausch = (t) => {
      switch (t.type) {
        case TILE_TYPE.CURVE_LEFT: return { type: TILE_TYPE.CURVE_RIGHT };
        case TILE_TYPE.CURVE_RIGHT: return { type: TILE_TYPE.CURVE_LEFT };
        // Die Haarnadel ist NICHT symmetrisch: erst ein gerades Stueck, dann 180 Grad.
        // Rueckwaerts gefahren liegt die Gerade am Ausgang (leadEnde, v0.9.27). Ohne das
        // ging jede gespiegelte Strecke mit beiden Haarnadeltypen um zwei Geraden-Stuecke
        // auseinander (gemeldet: "Balkonia spiegeln - Strecke geht kaputt").
        case TILE_TYPE.HAIRPIN: return { type: TILE_TYPE.HAIRPIN_LEFT, leadEnde: !t.leadEnde };
        case TILE_TYPE.HAIRPIN_LEFT: return { type: TILE_TYPE.HAIRPIN, leadEnde: !t.leadEnde };
        case TILE_TYPE.WEIT_RIGHT: return { type: TILE_TYPE.WEIT_LEFT };
        case TILE_TYPE.WEIT_LEFT: return { type: TILE_TYPE.WEIT_RIGHT };
        case TILE_TYPE.KLEIN_RIGHT: return { type: TILE_TYPE.KLEIN_LEFT };
        case TILE_TYPE.KLEIN_LEFT: return { type: TILE_TYPE.KLEIN_RIGHT };
        default: return { type: t.type };
      }
    };
    return [tiles[0], ...tiles.slice(1).map(tausch).reverse()];
  }
  // v0.8.80: Arcade entfernt. Challenges laufen nur mit dem Pro-Preset; der Schluessel der
  // Bestenliste behaelt das |pro|, damit die vorhandenen Zeiten weiter gelten.
  const chPreset = 'pro';
  let chLauf = null;               // laufende Challenge, siehe challengeStarten()
  let chWaechter = null;
  let chLetzt = null;              // letztes Ergebnis, fuer die Anzeige auf der Seite
  const chListen = {};             // Schluessel -> { zeiten, online, fehler, laedt }

  function chDef(id) {
    const c = CH_ALLE.find((x) => x.id === id);
    if (c) return c;
    // Community-Strecke als Challenge fahren: die Strecke wird aus dem eingereichten Code
    // aufgebaut, ein Lauf mit Ampel, Wertung nach erkannten Teilen.
    // Direkt nach Kennung, ohne Zusammenfuehrung: chDef laeuft auch im Fahrtakt.
    let tr = communityLesen().tracks.find((t) => t.id === id);
    if (!tr && communityOnline) tr = communityOnline.tracks.find((t) => t.id === id);
    if (tr) return { id: tr.id, code: tr.code, name: tr.name, runden: 1, pit: 0, wx: null, community: true };
    return CHALLENGES[0];
  }
  function chSchluessel(id, modus, preset) { return id + '|' + modus + '|' + preset; }
  // PFLICHTSTOPP (v0.8.39). BESTELLT: "bei Rundenrennen in Challenge 4 immer einen Pitstop
  // verpflichtend (egal wo und mit Pit-Minigame)". Kategorie D, nur im Modus Rennen.
  // BESTELLT (Balkonia): eine Strecke kann eine eigene Pflichtzahl angeben (def.pit).
  function chPitZahl(def, modus) {
    if (modus !== 'rennen') return 0;
    if (def.pit !== undefined) return def.pit;
    return def.kat === 'D' ? 1 : 0;
  }
  function chPflichtstopp(def, modus) { return chPitZahl(def, modus) > 0; }
  function chTiles(def) { const p = codeToTrack(def.code); return p ? p.tiles : []; }
  function challengeLaeuft() { return !!chLauf; }

  function chZeit(ms) {
    if (!Number.isFinite(ms)) return '–';
    const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
    const txt = m + ':' + s.toFixed(3).padStart(6, '0');
    return lang === 'en' ? txt : txt.replace('.', ',');
  }
  function chZahl(x, n) { const s = x.toFixed(n); return lang === 'en' ? s : s.replace('.', ','); }
  // Schwellen auf Zehntelsekunden runden, z. B. 4639 ms -> "4,6 s".
  function chSekunden(ms) { return chZahl(ms / 1000, 1) + ' s'; }

  // ---- STERNE (v0.8.79). BESTELLT: "auch offline Spass": Bronze fuer das Absolvieren,
  // Silber fuer eine ordentliche, Gold fuer eine gute Zeit. Die Schwellen sind je Strecke
  // und werden aus der Streckengeometrie gerechnet - eine gute Runde ist das, was die
  // Messung hergibt: die Geraden bei gemessener Vollgasgeschwindigkeit, die Kurven langsamer
  // (kalibriert an der besten Imolina-Pro-Runde 4,639 s auf 3,18 m). Der Nutzer testet die
  // Werte und kann die beiden Faktoren unten nachziehen. Nur Pro (v0.8.80: Arcade entfernt).
  const CH_STERNE_V_GERADE = 1.64;        // m/s, gemessene Vollgasgeschwindigkeit
  const CH_STERNE_V_KURVE = 0.565;        // m/s, kalibriert an Imolina-Pro
  const CH_STERNE_SILBER_FAKTOR = 1.5;    // Silber = 50 % langsamer als Gold
  // ---- KALIBRIERUNG AN GEMESSENEN ZEITEN (v0.9.20) ----------------------------------
  // BESTELLT: "Balkonia sollte Gold ab 16 s vergeben - kalibriere die anderen Strecken
  // entsprechend. Wenn ich mehr Zeiten habe, wird weiter kalibriert." Hier stehen die
  // Gold-Rundenzeiten (s), die am echten Auto festgelegt wurden. Jede Strecke darin bekommt
  // genau diese Zeit; alle anderen die Geometrie-Zeit mal dem Faktor, der die Referenzen im
  // Mittel trifft (geometrisches Mittel der Verhaeltnisse). Eine weitere Zeile hier = weiter
  // kalibriert, ohne an den Geschwindigkeiten oben zu drehen.
  const CH_GOLD_REFERENZ = { 'dauer-balkonia': 16 };
  let chKalibFaktor = null;
  function chKalibrierFaktor() {
    if (chKalibFaktor !== null) return chKalibFaktor;
    const logs = [];
    for (const id of Object.keys(CH_GOLD_REFERENZ)) {
      const def = CH_ALLE.find((d) => d.id === id);
      const geo = def ? chGeoGold(def) : 0;
      if (geo > 0) logs.push(Math.log(CH_GOLD_REFERENZ[id] * 1000 / geo));
    }
    chKalibFaktor = logs.length ? Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length) : 1;
    return chKalibFaktor;
  }
  function chSterneSchwellen(def) {
    // Eine Strecke kann ihre Gold-Zeit weiter selbst vorgeben (sternGold, Sekunden je Runde).
    const fest = def.sternGold !== undefined ? def.sternGold : CH_GOLD_REFERENZ[def.id];
    if (fest !== undefined) {
      const gold = Math.round(fest * 1000);
      return { silber: Math.round(gold * CH_STERNE_SILBER_FAKTOR), gold };
    }
    const gold = chGeoGold(def) * chKalibrierFaktor();
    return { silber: Math.round(gold * CH_STERNE_SILBER_FAKTOR), gold: Math.round(gold) };
  }
  // Die reine Geometrie-Zeit einer Runde (ms): Geraden bei Vollgas, Kurven langsamer.
  function chGeoGold(def) {
    const tiles = chTiles(def);
    let gerade = 0, kurve = 0;
    for (const t of tiles) {
      const len = tileLength(t.type);          // in TRACK_STEP-Einheiten
      if (tileIsCurve(t.type)) kurve += len; else gerade += len;
    }
    const m = TRACK_UNITS_PER_CM * 100;        // Einheiten -> cm -> m
    gerade /= m; kurve /= m;
    return (gerade / CH_STERNE_V_GERADE + kurve / CH_STERNE_V_KURVE) * 1000;
  }
  // 1 = Bronze (Challenge gefahren), 2 = Silber, 3 = Gold; 0 = keine Wertung.
  // Im Rennen (rennen) ist die Zeit die Summe ueber def.runden Runden, die Schwellen
  // werden entsprechend skaliert; Beste-Runde (hotlap) vergleicht eine einzelne Runde.
  function chSterne(def, modus, zeitMs) {
    if (!(zeitMs > 0)) return 0;
    const s = chSterneSchwellen(def);
    const runden = modus === 'rennen' ? (def.runden || 1) : 1;
    if (zeitMs <= s.gold * runden) return 3;
    if (zeitMs <= s.silber * runden) return 2;
    return 1;
  }
  function chSterneText(n) {
    const farben = { 1: 'var(--bronze)', 2: 'var(--silber)', 3: 'var(--gold)' };
    if (!farben[n]) return '';
    let s = '';
    for (let i = 0; i < n; i++) s += '★';
    for (let i = n; i < 3; i++) s += '☆';
    return '<span class="ch-sterne" style="color:' + farben[n] + '">' + s + '</span>';
  }
  // Sterne als Klartext (fuer den Ergebnis-Dialog, der keine HTML nimmt).
  function chSterneZeichen(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += '★';
    for (let i = n; i < 3; i++) s += '☆';
    return s;
  }
  function chSterneName(n) {
    return n >= 3 ? t('Gold') : n === 2 ? t('Silber') : n === 1 ? t('Bronze') : '';
  }
  // Bedingungen je Medaille, z. B. "Gold: bis 4,6 s · Silber: bis 7,0 s · Bronze: gefahren".
  // Im Rennen skaliert die Schwellen mit der Rundenzahl, wie chSterne es auch tut.
  function chMedailleHinweis(def, modus) {
    const s = chSterneSchwellen(def);
    const r = modus === 'rennen' ? (def.runden || 1) : 1;
    const gold = chSekunden(s.gold * r), silber = chSekunden(s.silber * r);
    return '<span class="ch-sterne" style="color:var(--gold)">' + chSterneZeichen(3) + '</span> ' + t('Gold')
      + ': ' + t('bis {zeit}').replace('{zeit}', gold) + '<br>'
      + '<span class="ch-sterne" style="color:var(--silber)">' + chSterneZeichen(2) + '</span> ' + t('Silber')
      + ': ' + t('bis {zeit}').replace('{zeit}', silber) + '<br>'
      + '<span class="ch-sterne" style="color:var(--bronze)">' + chSterneZeichen(1) + '</span> ' + t('Bronze')
      + ': ' + t('gefahren');
  }
  // Rang einer Kachel: erreichte Medaille + Perzentil ("TOP X %"). Beste der beiden Modi.
  function chKachelRang(def) {
    let best = null;
    for (const modus of ['hotlap', 'rennen']) {
      const schl = chSchluessel(def.id, modus, 'pro');
      const lok = chLokal(schl);
      const eig = lok.filter((z) => z.zeit > 0);
      if (!eig.length) continue;
      const zeit = Math.min(...eig.map((z) => z.zeit));
      const st = chSterne(def, modus, zeit);
      const a = chAlleZeiten(schl);
      let alle = a.zeiten.indexOf(zeit) >= 0 ? a.zeiten : a.zeiten.concat([zeit]);
      let meine = zeit;
      if (a.online) {
        const b = chBesteJeSpieler(a.eintraege, chGeraet(), zeit);
        alle = b.werte; meine = b.meine;
      }
      const p = chPerzentil(alle, meine);
      if (!best || st > best.st || (st === best.st && p > best.p)) best = { st, p, n: alle.length };
    }
    return best;
  }
  // Anzeige auf der Kachel: "★★★ Gold · TOP 5 %". Ohne Konkurrenz (nur der eigene Lauf) nur die
  // Medaille, sonst waere "TOP 100 %" bei einem einzigen Eintrag irrefuehrend.
  function chRangKachelText(r) {
    if (!r) return '';
    const top = Math.max(1, Math.round(100 - r.p));
    return chSterneText(r.st) + ' ' + chSterneName(r.st)
      + (r.n >= 2 ? ' &middot; ' + t('TOP {x} %').replace('{x}', top) : '');
  }

  // Platzbedarf auf dem Boden in Metern, aus derselben Geometrie wie der Editor (Mittellinie
  // plus halbe Bahnbreite). Mit Drehung 0 gerechnet, unabhaengig von der Editor-Strecke.
  function chFlaeche(tiles) {
    const merk = trackRotationDeg;
    trackRotationDeg = 0;
    try {
      const pts = trackCenterline(tiles), nrm = trackNormals(pts);
      const xs = [], ys = [];
      pts.forEach((p, i) => {
        xs.push(p.x + nrm[i].x * TRACK_HALF_W, p.x - nrm[i].x * TRACK_HALF_W);
        ys.push(p.y + nrm[i].y * TRACK_HALF_W, p.y - nrm[i].y * TRACK_HALF_W);
      });
      const cm = (v) => v / TRACK_UNITS_PER_CM / 100;
      return [cm(Math.max(...xs) - Math.min(...xs)), cm(Math.max(...ys) - Math.min(...ys))];
    } finally { trackRotationDeg = merk; }
  }
  function chKarte(def, detailliert) {
    const merk = trackRotationDeg;
    trackRotationDeg = 0;
    try {
      const tiles = chSpiegel ? chSpiegelTiles(chTiles(def)) : chTiles(def);
      return renderTrackPreview(tiles, null,
        detailliert ? { detailed: true, echt: true, ohneLinie: true } : {}).html;
    } finally { trackRotationDeg = merk; }
  }

  // ---- Wertung, Rang, Verteilung: reine Rechnungen (Selbsttest) ----
  // pruefung: je Runde das Ergebnis von chRundePruefen (fehlt es ganz, gilt jede Runde als
  // geprueft - so rechnen die Tests die reine Zeitwertung). minMs: Mindestrundenzeit.
  // fruehstart: seit v0.8.39 KEIN Abbruch mehr - das Auto wird nach dem Anfahren kurz
  // ausgebremst (70-race.js, fruehstartStrafeAktiv), die Strafe steckt in der Zeit.
  // pitDone: erledigte Stopps; bei Pflichtstopp (Kategorie D, Rennen) muss es >= 1 sein.
  function chWertung(def, modus, rundenMs, flagge, fruehstart, pruefung, minMs, geaendert, pitDone) {
    if (geaendert) return { gueltig: false, zeit: null, grund: 'Einstellungen während der Challenge geändert' };
    const geprueft = (i) => !pruefung || !!(pruefung[i] && pruefung[i].ok);
    const schnellGenug = (i) => !minMs || rundenMs[i] >= minMs;
    if (modus === 'rennen') {
      // BESTELLT: "wenn eine Runde nicht zaehlt, einfach eine extra fahren". Es zaehlen nur
      // die gueltigen Runden; der Lauf darf bis zu CH_EXTRA_LAPS mehr fahren (chAnwenden
      // erhoeht das Limit), und die Wertung summiert die schnellsten def.runden gueltigen.
      const gueltig = [];
      for (let i = 0; i < rundenMs.length; i++) {
        if (geprueft(i) && schnellGenug(i)) gueltig.push(rundenMs[i]);
      }
      if (!flagge) {
        return { gueltig: false, zeit: null, grund: 'abgebrochen' };
      }
      const pitSoll = chPitZahl(def, modus);
      if (pitSoll > 0 && pitDone !== undefined && !(pitDone >= pitSoll)) {
        return { gueltig: false, zeit: null, grund: 'Pflichtstopp fehlt' };
      }
      if (gueltig.length < def.runden) {
        return { gueltig: false, zeit: null, grund: 'nicht genug gültige Runden' };
      }
      return { gueltig: true, zeit: gueltig.slice(0, def.runden).reduce((a, b) => a + b, 0), grund: '' };
    }
    if (!rundenMs.length) return { gueltig: false, zeit: null, grund: 'keine volle Runde' };
    const gute = rundenMs.filter((ms, i) => geprueft(i) && schnellGenug(i));
    if (!gute.length) return { gueltig: false, zeit: null, grund: 'keine gültige Runde: Strecke nicht erkannt oder unter der Mindestzeit' };
    return { gueltig: true, zeit: Math.min(...gute), grund: '', gezaehlt: gute.length };
  }
  // Anteil der ANDEREN Zeiten, die langsamer sind als `zeit`, in Prozent.
  function chPerzentil(zeiten, zeit) {
    const andere = zeiten.filter((z) => z !== zeit);
    if (!andere.length) return 100;
    return Math.round(100 * andere.filter((z) => z > zeit).length / andere.length);
  }
  function chHistogramm(zeiten, n) {
    if (!zeiten.length) return [];
    const min = Math.min(...zeiten), max = Math.max(...zeiten);
    const k = n || Math.min(10, Math.max(3, Math.ceil(Math.sqrt(zeiten.length))));
    const w = (max - min) / k || 1;
    const klassen = Array.from({ length: k }, (_, i) => ({ von: min + i * w, bis: min + (i + 1) * w, anz: 0 }));
    zeiten.forEach((z) => { klassen[Math.min(k - 1, Math.floor((z - min) / w))].anz++; });
    return klassen;
  }

  // ---- Speicher: lokale Zeiten, Online-Einstellung, Geraetekennung ----
  function chLesen(schl, vorgabe) {
    try { return JSON.parse(localStorage.getItem(schl) || 'null') || vorgabe; } catch (e) { return vorgabe; }
  }
  function chSchreiben(schl, wert) {
    try { localStorage.setItem(schl, JSON.stringify(wert)); } catch (e) { /* privat */ }
  }
  function chGeraet() {
    let g = null;
    try { g = localStorage.getItem(CH_GERAET_STORE); } catch (e) { /* privat */ }
    if (!g) {
      g = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(CH_GERAET_STORE, g); } catch (e) { /* dann eben je Sitzung */ }
    }
    return g;
  }
  function chOnline() {
    return Object.assign({ url: CH_STANDARD_URL, fahrer: '', hochladen: true }, chLesen(CH_ONLINE_STORE, {}));
  }
  function chLokal(schl) { return (chLesen(CH_STORE, {})[schl] || []); }
  function chLokalSpeichern(erg) {
    const alle = chLesen(CH_STORE, {});
    const schl = chSchluessel(erg.id, erg.modus, erg.preset);
    const liste = (alle[schl] || []).concat([{ zeit: erg.zeit, runden: erg.runden, auto: erg.auto,
      fahrer: erg.fahrer, geraet: erg.geraet, datum: Date.now() }]);
    liste.sort((a, b) => a.zeit - b.zeit);
    alle[schl] = liste.slice(0, 30);
    chSchreiben(CH_STORE, alle);
  }

  // ---- COMMUNITY STRECKEN (v0.8.96, BESTELLT) -----------------------------------------
  // BESTELLT: "füge bei challenges als vierte section ein, dass Leute eine eigene Strecke
  // eintragen können und dort ihre Bestzeit aufnehmen können." Strecken bekommen vierstellige
  // IDs (0001, 0002, ...). Eigene Strecken werden mit vorhandenen zusammengefuehrt, auch wenn
  // sie gespiegelt sind (dieselbe Logik wie chSpiegelTiles). Sortiert wird nach (1) neuester
  // Zeit, (2) den meisten verschiedenen Spielern (ueber Geraet). Nur pro Preset.
  const COMMUNITY_STORE = 'omegasim-community';
  function communityLesen() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(COMMUNITY_STORE) || 'null'); } catch (e) { /* privat */ }
    if (!d || !Array.isArray(d.tracks)) d = { tracks: [], times: {}, nextId: 1 };
    if (!d.times) d.times = {};
    if (!d.nextId) d.nextId = 1;
    return d;
  }
  function communitySchreiben(d) {
    try { localStorage.setItem(COMMUNITY_STORE, JSON.stringify(d)); } catch (e) { /* privat */ }
  }
  // ---- GETEILT UEBER DAS SHEET (v0.9.10) ----
  // BESTELLT: die Community-Strecken sollen fuer alle sichtbar sein - vorher lagen sie nur auf
  // dem eigenen Geraet. Das Apps Script der Challenges fuehrt dafuer zwei Blaetter (Community,
  // CommunityZeiten). Die Liste wird hoechstens alle 2 Minuten geholt und mit den eigenen,
  // lokalen Daten zusammengefuehrt; ohne Netz bleibt alles wie bisher lokal. Eigene Strecken,
  // die online noch fehlen, werden beim naechsten Abgleich eingereicht.
  let communityOnline = null, communityOnlineAt = 0, communityHolt = false, communityFehler = false;
  function communityUrl() { const o = chOnline(); return o && o.url ? o.url : ''; }
  function communityPost(eintrag) {
    const url = communityUrl();
    if (!url) return Promise.resolve(null);
    const senden = (versuch) => fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ geraet: chGeraet() }, eintrag)) })
      .then((r) => r.json())
      .catch((e) => (versuch < 2 ? new Promise((ok) => setTimeout(ok, 1500)).then(() => senden(versuch + 1)) : null));
    return senden(0);
  }
  function communityHolen(frisch) {
    const url = communityUrl();
    if (!url || communityHolt) return Promise.resolve(communityOnline);
    if (!frisch && communityOnline && Date.now() - communityOnlineAt < 120000) return Promise.resolve(communityOnline);
    communityHolt = true;
    const holen = () => fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'community=1').then((r) => r.json());
    return holen().catch(() => new Promise((ok) => setTimeout(ok, 1200)).then(holen))
      .then((j) => {
        if (j && j.ok && Array.isArray(j.tracks)) { communityOnline = j; communityOnlineAt = Date.now(); communityFehler = false; }
        else { communityFehler = true; communityOnlineAt = Date.now(); }
        return communityOnline;
      })
      .catch(() => { communityFehler = true; communityOnlineAt = Date.now(); return communityOnline; })
      .then((j) => { communityHolt = false; return j; });
  }
  // Online-Liste + lokale Daten zu EINER Sicht. Online-Strecken haben ihre Server-Kennung; eine
  // lokale Strecke, die (auch gespiegelt) online schon steht, wird unter deren Kennung gefuehrt.
  function communitySicht() {
    const lokal = communityLesen();
    const on = communityOnline;
    if (!on) return lokal;
    const sicht = { tracks: [], times: {}, nextId: lokal.nextId, online: true };
    for (const tr of on.tracks) {
      sicht.tracks.push({ id: tr.id, code: tr.code, name: tr.name, online: true });
      sicht.times[tr.id] = (on.zeiten[tr.id] || []).map((z) => ({ zeit: z.zeit_ms, fahrer: z.fahrer || '', geraet: z.geraet,
        datum: Date.parse(z.zeitpunkt) || 0 }));
    }
    for (const tr of lokal.tracks) {
      const p = codeToTrack(tr.code);
      const gleich = p ? sicht.tracks.find((x) => { const q = codeToTrack(x.code); return q && communityGleiche(p.tiles, q.tiles); }) : null;
      const ziel = gleich ? gleich.id : tr.id;
      if (!gleich) sicht.tracks.push({ id: tr.id, code: tr.code, name: tr.name, online: false });
      const liste = sicht.times[ziel] = sicht.times[ziel] || [];
      for (const z of (lokal.times[tr.id] || [])) {
        if (!liste.some((x) => x.geraet === z.geraet && Math.abs(x.zeit - z.zeit) < 2)) liste.push(z);
      }
      liste.sort((a, b) => a.zeit - b.zeit);
    }
    return sicht;
  }
  // Lokale Strecken, die online fehlen, einreichen; ihre Zeiten hinterher. Laeuft still.
  function communityAbgleichen() {
    if (!communityOnline) return;
    const lokal = communityLesen();
    const fehlen = lokal.tracks.filter((tr) => {
      const p = codeToTrack(tr.code);
      return p && !communityOnline.tracks.some((x) => { const q = codeToTrack(x.code); return q && communityGleiche(p.tiles, q.tiles); });
    });
    fehlen.slice(0, 3).forEach((tr, i) => setTimeout(() => {
      communityPost({ art: 'community-strecke', code: tr.code, name: tr.name }).then((r) => {
        if (!r || !r.ok || !r.id) return;
        const meine = (lokal.times[tr.id] || []).filter((z) => z.geraet === chGeraet());
        if (meine.length) setTimeout(() => communityPost({ art: 'community-zeit', id: r.id, zeit_ms: meine[0].zeit, fahrer: meine[0].fahrer }), 11000);
        communityHolen(true).then(() => { if ($('community-bereich')) communityZeichnen(); });
      });
    }, i * 11000));
  }
  function communityCode(tiles) { return trackToCode(tiles, 0); }
  // Zwei Strecken sind dieselbe, wenn ihr Code gleich ist ODER die eine das Spiegelbild der
  // anderen ist (Reihenfolge umkehren + links/rechts tauschen, wie chSpiegelTiles).
  function communityGleiche(tilesA, tilesB) {
    const a = communityCode(tilesA);
    if (a === communityCode(tilesB)) return true;
    try { return a === communityCode(chSpiegelTiles(tilesB)); } catch (e) { return false; }
  }
  function communityFinde(data, tiles) {
    for (const t of data.tracks) {
      const p = codeToTrack(t.code);
      if (p && communityGleiche(tiles, p.tiles)) return t;
    }
    return null;
  }
  // Nimmt eine Strecke auf (oder fuehrt sie mit einer vorhandenen zusammen) und liefert die id.
  function communityEinreichen(data, tiles, name) {
    const vorhanden = communityFinde(data, tiles);
    if (vorhanden) return vorhanden.id;
    const id = String(data.nextId || 1).padStart(4, '0');
    data.tracks.push({ id, code: communityCode(tiles), name: (name || 'Strecke ' + id).slice(0, 32) });
    data.nextId = (data.nextId || 1) + 1;
    communitySchreiben(data);
    return id;
  }
  // Tragt eine Zeit ein (beste je Geraet bleibt bestehen, die Liste ist sortiert).
  function communityZeit(data, trackId, zeit, fahrer) {
    const geraet = chGeraet();
    const liste = data.times[trackId] = data.times[trackId] || [];
    liste.push({ zeit: Math.round(zeit), fahrer: (fahrer || '').slice(0, 16), geraet, datum: Date.now() });
    liste.sort((a, b) => a.zeit - b.zeit);
    if (liste.length > 50) liste.length = 50;
    communitySchreiben(data);
  }
  function communityNeuesteZeit(data, id) {
    let max = 0;
    for (const e of (data.times[id] || [])) if (e.datum > max) max = e.datum;
    return max;
  }
  function communitySpieler(data, id) {
    const set = new Set();
    for (const e of (data.times[id] || [])) set.add(e.geraet);
    return set.size;
  }
  // Sortierung: (1) neueste Zeit, (2) meisten verschiedenen Spieler.
  function communitySortiert(data) {
    return data.tracks.slice().sort((a, b) => {
      const ta = communityNeuesteZeit(data, a.id), tb = communityNeuesteZeit(data, b.id);
      if (ta !== tb) return tb - ta;
      return communitySpieler(data, b.id) - communitySpieler(data, a.id);
    });
  }
  function communityBesteZeit(data, id) {
    const l = data.times[id] || [];
    return l.length ? l[0].zeit : 0;
  }
  // Die Community-Seite: Liste der eingereichten Strecken (sortiert) und ein Knopf, um die
  // eigene Strecke aus dem Editor einzureichen.
  function communityZeichnen() {
    const bereich = $('community-bereich');
    if (!bereich) return;
    // Online-Liste im Hintergrund holen; sobald sie da ist, noch einmal zeichnen.
    if (communityUrl() && (!communityOnline || Date.now() - communityOnlineAt > 120000) && !communityHolt) {
      communityHolen(false).then((j) => { if (j) communityAbgleichen(); communityZeichnen(); });
    }
    const data = communitySicht();
    bereich.innerHTML = '';
    const stand = document.createElement('p');
    stand.className = 'muted community-stand';
    stand.setAttribute('data-i18n-skip', '');
    stand.textContent = data.online ? t('Gemeinsame Liste: {n} Strecken.').replace('{n}', data.tracks.length)
      : (communityUrl() ? (communityFehler ? t('Gemeinsame Liste nicht erreichbar, hier deine eigenen Strecken.') : t('Lade die gemeinsame Liste …'))
         : t('Nur auf diesem Gerät (keine Online-Adresse eingestellt).'));
    const ein = document.createElement('button');
    ein.className = 'primary';
    ein.textContent = t('Eigene Strecke einreichen');
    ein.onclick = () => {
      // BESTELLT: "wenn keine Strecke im Editor ist, soll die App sagen, dass man zuerst
      // scannen oder bauen soll." Kein stiller Abbruch - der Grund wird gesagt.
      if (!currentTrackTiles || currentTrackTiles.length < 2) {
        showHudToast(t('Keine Strecke im Editor. Scanne oder baue zuerst eine Strecke.'));
        return;
      }
      // BESTELLT: "beim Einreichen soll das Bild gezeigt und bestaetigt werden." Die
      // Vorschau (Streckenkarte) steht im Frage-Dialog, erst auf Einreichen wird gespeichert.
      const vorschau = (typeof renderTrackPreview === 'function')
        ? renderTrackPreview(currentTrackTiles, null, { detailed: true, cars: [] }).html : '';
      konsoleFrage(t('Strecke einreichen'),
        t('So sieht deine Strecke aus. Bitte prüfe das Bild, dann wird sie eingereicht.'),
        [[t('Einreichen'), () => {
           const name = prompt(t('Name der Strecke'), '') || 'Strecke ' + String(data.nextId || 1).padStart(4, '0');
           // Gibt es sie online schon (auch gespiegelt)? Dann nur deren Kennung nehmen.
           const schon = data.online ? data.tracks.find((x) => { const q = codeToTrack(x.code); return q && communityGleiche(currentTrackTiles, q.tiles); }) : null;
           if (schon) { showHudToast(t('Diese Strecke gibt es schon: {n}').replace('{n}', schon.id + ' · ' + schon.name)); return; }
           const lokal = communityLesen();
           const id = communityEinreichen(lokal, currentTrackTiles, name);
           communitySchreiben(lokal);
           communityPost({ art: 'community-strecke', code: communityCode(currentTrackTiles), name }).then((r) => {
             showHudToast(r && r.ok ? t('Strecke {n} für alle eingereicht.').replace('{n}', r.id) : t('Strecke {n} eingereicht (nur auf diesem Gerät).').replace('{n}', id));
             communityHolen(true).then(() => communityZeichnen());
           });
           communityZeichnen();
         }],
         [t('Abbrechen'), null]], true, vorschau);
    };
    bereich.appendChild(ein);
    bereich.appendChild(stand);
    const liste = communitySortiert(data);
    if (!liste.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('Noch keine Community-Strecken. Reiche deine Strecke ein.');
      bereich.appendChild(p);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'community-liste';
    for (const tr of liste) {
      const row = document.createElement('div');
      row.className = 'community-zeile';
      // BESTELLT: "community strecken: layout in der vorschau zeigen".
      const mini = document.createElement('span');
      mini.className = 'community-mini';
      mini.setAttribute('aria-hidden', 'true');
      try {
        const p = codeToTrack(tr.code);
        if (p) { const merk = trackRotationDeg; trackRotationDeg = 0; try { mini.innerHTML = renderTrackPreview(p.tiles, null, {}).html; } finally { trackRotationDeg = merk; } }
      } catch (e) { /* ohne Bild */ }
      row.appendChild(mini);
      const links = document.createElement('div');
      links.className = 'community-text';
      const b = document.createElement('b');
      b.setAttribute('data-i18n-skip', '');
      b.textContent = tr.id + ' \u00b7 ' + tr.name + (tr.online === false && data.online ? ' (' + t('nur hier') + ')' : '');
      const best = communityBesteZeit(data, tr.id);
      const spieler = communitySpieler(data, tr.id);
      const em = document.createElement('em');
      em.textContent = best ? t('Bestzeit') + ' ' + chZeit(best) + ' \u00b7 ' + spieler + ' ' + t('Spieler')
                             : t('Noch keine Zeit') + ' \u00b7 ' + spieler + ' ' + t('Spieler');
      links.appendChild(b); links.appendChild(em);
      // BESTELLT: "eine Zeit eintragen wie eine normale Challenge: Strecke fahren, dabei
      // prueft die App, dass man wirklich auf der Strecke faehrt (X % der Teile), misst die
      // Zeit und traegt sie beim Zieleinlauf ein." Kein Handtippen mehr - ein Lauf.
      const z = document.createElement('button');
      z.textContent = t('Zeit fahren');
      z.onclick = () => communityStarten(tr);
      row.appendChild(links); row.appendChild(z);
      wrap.appendChild(row);
    }
    bereich.appendChild(wrap);
  }

  // BESTELLT: "Zeit eintragen wie eine normale Challenge." Die Community-Strecke wird als
  // Challenge gefahren: Auto muss stehen, Ampel, dann wird die Strecke abgefahren und die
  // App prueft je Runde, wie viele Teile erkannt wurden (challengeRundeFertig/chRundePruefen),
  // misst die Zeit und traegt sie beim Zieleinlauf in die Community-Liste ein.
  function communityStarten(tr) {
    if (!tr) return;
    if (typeof challengeLaeuft === 'function' && challengeLaeuft()) {
      showHudToast(t('Erst die laufende Challenge beenden'));
      return;
    }
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return; }
    chWahl = tr.id;
    chModus = 'hotlap';
    chSpiegel = false;
    if (typeof challengeStarten === 'function') challengeStarten();
  }


  // ---- Online ----
  function chHochladen(erg) {
    const o = chOnline();
    if (!o.url || !o.hochladen) return Promise.resolve(false);
    const def = chDef(erg.id);
    const eintrag = {
      challenge: erg.id, modus: erg.modus, preset: erg.preset, runden_soll: erg.modus === 'rennen' ? def.runden : 0,
      zeit_ms: Math.round(erg.zeit), runden_ms: erg.runden.map(Math.round), auto: erg.auto,
      fahrer: o.fahrer || '', geraet: chGeraet(), version: ($('app-version') || {}).textContent || '',
    };
    // text/plain und kein JSON-Kopf: so schickt der Browser keinen CORS-Vorabruf, den ein
    // Apps Script nicht beantworten kann.
    //
    // WIEDERHOLEN, GEMESSEN: Google leitet jede Antwort auf eine Echo-Seite um, und die kam im
    // Test sporadisch als 404 zurueck (derselbe Aufruf: 200, 404, 200). Das Skript ist dann
    // meist schon gelaufen, nur die Antwort fehlt. Deshalb bis zu zwei Wiederholungen, und
    // "zu schnell hintereinander" (die 15-s-Drossel je Geraet im Skript) heisst beim Wiederholen:
    // der erste Versuch ist angekommen. So entsteht keine doppelte Zeile.
    const senden = (versuch) => fetch(o.url, { method: 'POST', body: JSON.stringify(eintrag) })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.ok) return true;
        if (versuch > 0 && j && j.fehler === 'zu schnell hintereinander') return true;
        throw Object.assign(new Error((j && j.fehler) || 'abgelehnt'), { endgueltig: true });
      })
      .catch((e) => {
        if (!e.endgueltig && versuch < 2) return new Promise((ok) => setTimeout(ok, 1500)).then(() => senden(versuch + 1));
        log('Challenge: Hochladen fehlgeschlagen: ' + e.message, 'warn');
        return false;
      });
    return senden(0);
  }
  // ---- SCHNAPPSCHUSS AUS DEM REPO (v0.8.34) ----
  // BESTELLT: "das Google Sheet ab und zu in GitHub speichern per Action ... die lokalen + die
  // in der letzten Stunde gefetchten". Die Action (.github/workflows/challenges.yml) legt
  // stuendlich data/challenges.json ab; die App liest zuerst diese Datei (schnell, ohne Googles
  // Echo-Umleitung) und mischt die eigenen Zeiten dazu (chAlleZeiten). Nur fuer die gemeinsame
  // Liste - eine eigene Adresse steht nicht im Schnappschuss. Aelter als zwei Stunden, oder die
  // Datei fehlt (die Kopie auf luuke42 hat keine Action, die APK nur die mitgelieferte): dann
  // direkt beim Sheet fragen.
  // v0.8.44: 8 h statt 2 h. Der Sync schreibt nur bei Aenderungen, dazu spaetestens alle 6 h
  // einen neuen Stand - vorher galt ein ruhiges Sheet nach zwei Stunden als veraltet, und die
  // App fragte dann doch wieder jede Liste live. 8 h passen zum 6-h-Takt: der Schnappschuss
  // gilt die meiste Zeit als frisch, und Google wird nur gefragt, wenn er wirklich fehlt
  // (z. B. die luuke42-Kopie ohne Action) oder zu alt ist.
  const CH_SCHNAPPSCHUSS_MAX_MS = 8 * 3600 * 1000;
  let chSchnapp = null, chSchnappAt = 0;
  function chSchnappschuss() {
    if (chSchnapp && Date.now() - chSchnappAt < 3 * 60000) return chSchnapp;
    chSchnappAt = Date.now();
    chSchnapp = fetch('data/challenges.json?t=' + Math.floor(Date.now() / 600000))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.listen && Date.now() - Date.parse(j.stand) < CH_SCHNAPPSCHUSS_MAX_MS ? j : null))
      .catch(() => null);
    return chSchnapp;
  }
  function chListeLaden(schl, frisch) {
    const o = chOnline();
    if (!o.url) { chListen[schl] = { zeiten: null, online: false }; return Promise.resolve(); }
    chListen[schl] = Object.assign(chListen[schl] || {}, { laedt: true });
    const schnapp = !frisch && o.url === CH_STANDARD_URL ? chSchnappschuss() : Promise.resolve(null);
    return schnapp.then((j) => {
      const l = j && j.listen[schl];
      if (l) {
        chListen[schl] = { zeiten: l.zeiten || [], online: true, anzahl: l.anzahl || 0, stand: j.stand };
        if (chSeiteOffen()) chZeichneListe();
        return undefined;
      }
      return chListeLive(schl, o);
    });
  }
  function chListeLive(schl, o) {
    const [id, modus, preset] = schl.split('|');
    const url = o.url + (o.url.indexOf('?') >= 0 ? '&' : '?') + 'challenge=' + encodeURIComponent(id)
      + '&modus=' + encodeURIComponent(modus) + '&preset=' + encodeURIComponent(preset);
    // Einmal wiederholen: dieselbe sporadische 404 der Echo-Seite wie beim Hochladen.
    const holen = () => fetch(url).then((r) => r.json());
    return holen().catch(() => new Promise((ok) => setTimeout(ok, 1200)).then(holen)).then((j) => {
      if (!j || !j.ok) throw new Error((j && j.fehler) || 'keine Antwort');
      chListen[schl] = { zeiten: j.zeiten || [], online: true, anzahl: j.anzahl || 0, stand: null };
    }).catch((e) => {
      chListen[schl] = { zeiten: null, online: false, fehler: e.message };
    }).then(() => { if (chSeiteOffen()) chZeichneListe(); });
  }

  // ---- Einstellungen merken, setzen, zurueckstellen ----
  function chSetzen(id, wert) {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') { if (el.checked === !!wert) return; el.checked = !!wert; }
    else { if (String(el.value) === String(wert)) return; el.value = wert; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function chMerken() {
    return {
      regler: presetRead(), modus: $('race-mode').value, limit: raceLimit,
      wx: $('race-wx-start').value, pit: $('race-pit-required').value,
      tank: $('race-fuel-start').value, fliegend: $('race-flying').checked,
      pitModus: $('pit-modus') ? $('pit-modus').value : null,
      tiles: currentTrackTiles, rot: trackRotationDeg,
    };
  }
  function chAnwenden(def, modus, preset) {
    applyPreset(preset);
    chSetzen('phys-mode', 'physik');
    chSetzen('race-mode', modus === 'rennen' ? 'laps' : 'practice');
    // Rennen: bis CH_EXTRA_LAPS mehr als die Soll-Rundenzahl, damit eine verpatzte Runde mit
    // einer extra ausgeglichen werden kann (siehe challengeRundeFertig).
    raceLimit = modus === 'rennen' ? def.runden + CH_EXTRA_LAPS : def.runden;
    $('race-limit').value = raceLimit;
    chSetzen('race-wx-start', 'dry');
    // BESTELLT (Balkonia): festes Wetterfenster, falls die Strecke eins mitbringt (def.wx).
    // Start bleibt trocken; die Wechsel kommen aus dem Plan. "Wetter aendert sich" wird
    // ausgeschaltet, sonst wuerde der Zufallswechsel dazwischenfunken.
    chWetterPlan = def.wx ? def.wx.map((e) => ({ abMs: e.min * 60000, wetter: e.wetter })) : null;
    if (def.wx) chSetzen('race-wx-change', false);
    const pit = chPitZahl(def, modus);
    chSetzen('race-pit-required', String(pit));
    if (pit > 0) {
      chSetzen('pit-modus', 'minigame');
      chSetzen('pit-trigger', 'anywhere');
    }
    chSetzen('race-fuel-start', FUEL_TANK_LITERS);
    chSetzen('race-flying', false);
    // Auf der Bahn: nur dort meldet das Auto jedes Teil, und nur dann laesst sich die Runde
    // gegen die Strecke pruefen.
    chSetzen('setting-ontrack', true);
    currentTrackTiles = chSpiegel ? chSpiegelTiles(chTiles(def)) : chTiles(def);
    trackRotationDeg = 0;
    trackSel = null;
    refreshTrackPreview();
  }
  function chZuruecksetzen(m) {
    if (!m) return;
    chWetterPlan = null;
    for (const [id, wert] of Object.entries(m.regler)) chSetzen(id, wert);
    chSetzen('race-mode', m.modus);
    raceLimit = m.limit;
    $('race-limit').value = m.limit;
    chSetzen('race-wx-start', m.wx);
    chSetzen('race-pit-required', m.pit);
    chSetzen('race-fuel-start', m.tank);
    chSetzen('race-flying', m.fliegend);
    if (m.pitModus !== null && m.pitModus !== undefined) chSetzen('pit-modus', m.pitModus);
    currentTrackTiles = m.tiles;
    trackRotationDeg = m.rot;
    trackSel = null;
    refreshTrackPreview();
  }

  // ---- Ablauf: starten, auf Stillstand warten, Ampel, fahren, werten ----
  function challengeStarten(ohneAuto) {
    if (chLauf) return;
    if (kRennenLaeuft()) { showHudToast(t('Erst das laufende Rennen beenden')); return; }
    if (!playerCar && !ohneAuto) {
      konsoleFrage(t('Kein Auto verbunden'),
        t('Für eine Challenge muss dein Auto verbunden sein. Ein Probelauf ohne Auto zeigt den Ablauf, wird aber nicht gewertet.'),
        [[t('Auto verbinden'), () => konsoleVerbinden()],
         [t('Probelauf'), () => challengeStarten(true)],
         [t('Abbrechen'), null]], true);
      return;
    }
    const def = chDef(chWahl);
    chLauf = { id: def.id, modus: chModus, preset: chPreset, phase: 'stehen', stillSeit: 0,
               hinweisAt: 0, fruehstart: false, probe: !playerCar, merk: chMerken(),
               gelesen: [], pruefung: [], geaendert: false, pruefAt: 0,
               community: !!def.community };
    chAnwenden(def, chModus, chPreset);
    chLauf.soll = chWachWerte(chPreset);
    chSperre(true);
    showTab('race');
    showHudToast(t('Auto auf Start/Ziel stellen und anhalten'));
    clearInterval(chWaechter);
    chWaechter = setInterval(chWachen, 100);
    chZeichneDetail();
  }
  // BESTELLT: "vor einer Challenge Username und Autoname zeigen, etwas eintragen muessen,
  // alles auf dem Startbildschirm." Der Startbildschirm fragt den Namen ab (Pflicht, sonst
  // startet nichts), zeigt das angeschlossene Auto und speichert den Namen fuer die
  // Bestenliste. Fuer Nicht-Challenge-Fahrten ist das nicht noetig.
  function challengeStartenDialog() {
    const o = chOnline();
    const auto = playerCar ? garageLabel(playerCar) : '';
    konsoleFrage(t('Challenge starten'),
      (auto ? t('Auto: {auto}').replace('{auto}', auto) + '\n' : '')
        + t('Dieser Name erscheint in der Bestenliste. Bitte Namen eintragen.'),
      [[t('Starten'), () => {
         const feld = $('k-frage-eingabe-feld');
         const name = ((feld ? feld.value : '') || kFrageWert || '').trim().slice(0, 16);
         if (!name) { showHudToast(t('Bitte zuerst einen Namen eintragen')); challengeStartenDialog(); return; }
         const no = chOnline(); no.fahrer = name; chSchreiben(CH_ONLINE_STORE, no);
         const nm = $('ch-name'); if (nm) nm.value = name;
         challengeStarten();
       }],
       [t('Abbrechen'), null]], true, null,
      { label: t('Name in der Bestenliste'), wert: o.fahrer });
  }
  function chTempo() {
    try { return Math.abs(physEngine.state.speedKmh || 0); } catch (e) { return 0; }
  }
  // Die Werte, die eine Challenge festlegt: das Preset, Steuerungsmodus, Bahn/Ausdruck.
  function chWachWerte(preset) {
    const ist = presetRead();
    const ids = Object.keys((window.__presetValues && window.__presetValues(preset)) || {}).concat(['phys-mode', 'setting-ontrack']);
    const o = {};
    ids.forEach((id) => { o[id] = ist[id]; });
    return o;
  }
  // SPERRE: die Regler der Optionen und der Fahrmodus-Knopf im Cockpit sind waehrend einer
  // Challenge ausgegraut. Was trotzdem aendert (Tastenkuerzel, Konsole), faengt chWachen ab.
  function chSperre(an) {
    const els = presetControls();
    ['phys-mode', 'setting-ontrack'].forEach((id) => { const e = $(id); if (e && els.indexOf(e) < 0) els.push(e); });
    els.forEach((el) => {
      if (an) {
        if (el.dataset.chSperre === undefined) { el.dataset.chSperre = el.disabled ? '1' : '0'; el.disabled = true; }
      } else if (el.dataset.chSperre !== undefined) {
        el.disabled = el.dataset.chSperre === '1';
        delete el.dataset.chSperre;
      }
    });
    if ($('ch-sperre')) $('ch-sperre').hidden = !an;
    if ($('race-act-mode')) $('race-act-mode').disabled = an;
  }
  // Aus 70-race.js: ein bestaetigtes Teil unter dem Auto (Schiene).
  function challengeTeilGelesen(code) {
    if (!chLauf) return;
    if (raceState !== 'racing' && raceState !== 'finishing') { chLauf.gelesen = []; return; }
    if (!isStartCode(code)) chLauf.gelesen.push(code);
  }
  // Aus playerLapCrossed(): Runde i ist gerade gezaehlt worden. Rueckgabe true, wenn die
  // Runde NICHT zaehlt (Strecke nicht erkannt oder zu schnell) - der Ton wird dann tiefer.
  function challengeRundeFertig(i) {
    if (!chLauf) return false;
    const def = chDef(chLauf.id);
    const pr = chRundePruefen(def, chLauf.gelesen);
    chLauf.pruefung[i] = pr;
    chLauf.gelesen = [];
    const ms = raceLapTimes[i] ? raceLapTimes[i].ms : 0;
    let ungueltig = false;
    if (!pr.ok) {
      ungueltig = true;
      showHudToast(t('Runde {n}: {a} von {b} Teilen erkannt, zählt nicht').replace('{n}', i + 1)
        .replace('{a}', pr.erkannt).replace('{b}', pr.soll));
    } else if (ms < chMinRundeMs(def)) {
      ungueltig = true;
      showHudToast(t('Runde {n} zu schnell, zählt nicht').replace('{n}', i + 1));
    }
    // Rundenrennen: eine verpatzte Runde ist kein Abbruch mehr - der Lauf laeuft weiter und
    // darf ein paar Runden mehr fahren, bis genug gueltige da sind. Die Rennmaschine zaehlt
    // bis CH_EXTRA_LAPS mehr; chWertung summiert dann nur die gueltigen.
    if (chLauf.modus === 'rennen' && ungueltig) {
      chLauf.extra = Math.max(0, (chLauf.extra || 0) + 1);
      showHudToast(t('Runde {n} zählt nicht – eine extra Runde, noch {m} Versuche').replace('{n}', i + 1)
        .replace('{m}', Math.max(0, CH_EXTRA_LAPS - chLauf.extra)));
    }
    return ungueltig;
  }
  function chWachen() {
    if (!chLauf) { clearInterval(chWaechter); chWaechter = null; return; }
    const v = chTempo(), jetzt = Date.now();
    // Einstellungen geaendert? Zweimal je Sekunde reicht.
    if (jetzt - chLauf.pruefAt > 500 && chLauf.soll) {
      chLauf.pruefAt = jetzt;
      const ist = chWachWerte(chLauf.preset);
      const anders = Object.keys(chLauf.soll).some((id) => String(ist[id]) !== String(chLauf.soll[id]));
      if (anders) {
        chLauf.geaendert = true;
        showHudToast(t('Einstellungen geändert, Challenge abgebrochen'));
        if (kRennenLaeuft()) requestRaceStop(); else challengeAbbrechen();
        return;
      }
    }
    if (chLauf.phase === 'stehen') {
      if (v < CH_STILL_KMH) {
        if (!chLauf.stillSeit) chLauf.stillSeit = jetzt;
        if (jetzt - chLauf.stillSeit >= CH_STILL_MS) {
          chLauf.phase = 'ampel';
          raceGridAnzeigen(startRaceCountdown);
        }
      } else {
        chLauf.stillSeit = 0;
        if (jetzt - chLauf.hinweisAt > 2500) { chLauf.hinweisAt = jetzt; showHudToast(t('Auto anhalten')); }
      }
    } else if (chLauf.phase === 'ampel') {
      // Frühstart: kein Abbruch mehr, die Ampel laeuft weiter, die Strafe kommt nach Gruen
      // (70-race.js, fruehstartStrafeAktiv).
      if (raceState === 'racing') chLauf.phase = 'faehrt';
    }
  }
  // Die Rennen-Taste (R1, Knopf im Cockpit) waehrend des Wartens auf Stillstand: abbrechen,
  // statt die Ampel ohne Pruefung zu starten.
  function challengeToggle() {
    if (!chLauf || chLauf.phase !== 'stehen') return false;
    challengeAbbrechen();
    return true;
  }
  function challengeAbbrechen() {
    if (!chLauf) return;
    const m = chLauf.merk;
    chLauf = null;
    clearInterval(chWaechter); chWaechter = null;
    chSperre(false);
    chZuruecksetzen(m);
    showHudToast(t('Challenge abgebrochen'));
    chZeichneDetail();
  }

  // Aus finishRace(): true heisst "die Challenge zeigt ihr Ergebnis selbst".
  function challengeRennenEnde(flagge) {
    if (!chLauf) return false;
    const lauf = chLauf;
    chLauf = null;
    clearInterval(chWaechter); chWaechter = null;
    const def = chDef(lauf.id);
    const rundenMs = raceLapTimes.map((l) => l.ms);
    const w = chWertung(def, lauf.modus, rundenMs, flagge, lauf.fruehstart,
                        lauf.probe ? null : lauf.pruefung, chMinRundeMs(def), lauf.geaendert, racePitDone);
    if (lauf.probe && w.gueltig) { w.gueltig = false; w.grund = 'Probelauf ohne Auto'; }
    const erg = Object.assign({ id: lauf.id, modus: lauf.modus, preset: lauf.preset, runden: rundenMs,
      auto: playerCar ? garageLabel(playerCar) : '', fahrer: chOnline().fahrer, geraet: chGeraet() }, w);
    chSperre(false);
    chZuruecksetzen(lauf.merk);
    chLetzt = erg;
    const schl = chSchluessel(erg.id, erg.modus, erg.preset);
    // BESTELLT: "Nach einem Rennen auch sagen, ob mein Ergebnis hochgeladen wurde."
    // chHochladen liefert true/false; ein Fehler beim Hochladen soll NICHT den ganzen
    // Lauf entwerten, nur die Meldung im Ergebnis-Dialog sagt es.
    let hochgeladen = null;
    if (erg.gueltig) {
      // Community-Strecke: die Zeit gehoert in die Community-Liste, nicht in die
      // woechentliche Challenge-Bestenliste. Alles andere (Ampel, Teilepruefung, Zeitmessung)
      // ist dieselbe Challenge-Maschinerie.
      if (lauf.community) {
        communityZeit(communityLesen(), erg.id, erg.zeit, erg.fahrer);
        hochgeladen = communityPost({ art: 'community-zeit', id: erg.id, zeit_ms: Math.round(erg.zeit), fahrer: erg.fahrer || '' })
          .then((r) => { hochgeladen = !!(r && r.ok); communityHolen(true).then(() => communityZeichnen()); return hochgeladen; })
          .catch(() => { hochgeladen = false; return false; });
        communityZeichnen();
      } else {
        chLokalSpeichern(erg);
        hochgeladen = chHochladen(erg)
          .then((ok) => { hochgeladen = ok; chListeLaden(schl); return ok; })
          .catch(() => { hochgeladen = false; return false; });
      }
    }
    // Das Ergebnis im Cockpit als Frage, mit dem Pad bedienbar: ansehen, nochmal, schliessen.
    setTimeout(() => {
      const titel = erg.gueltig
        ? (erg.modus === 'hotlap' ? t('Beste Runde') : t('Gesamtzeit')) + ': ' + chZeit(erg.zeit)
        : t('Nicht gewertet');
      let text;
      if (lauf.community) {
        text = erg.gueltig
          ? t('Zeit für die Community-Strecke {n} eingetragen.').replace('{n}', erg.id)
          : chGrundText(erg);
      } else {
        text = erg.gueltig ? chRangText(schl, erg.zeit) : chGrundText(erg);
        if (erg.gueltig) {
          const sterne = chSterne(def, erg.modus, erg.zeit);
          text += '\n\n' + chSterneName(sterne) + ' ' + chSterneZeichen(sterne);
          const o = chOnline();
          if (o.url && o.hochladen) {
            text += '\n\n' + (hochgeladen === true ? t('Ergebnis hochgeladen.')
              : hochgeladen === false ? t('Ergebnis konnte nicht hochgeladen werden – steht nur lokal.')
              : t('Ergebnis wird hochgeladen …'));
          }
        }
      }
      const knoepfe = lauf.community
        ? [[t('Nochmal'), () => { chWahl = erg.id; chModus = erg.modus; challengeStarten(); }],
           [t('Schließen'), null]]
        : [[t('Ergebnis ansehen'), () => konsoleZeige('challenges', 'ch-' + erg.id)],
           [t('Nochmal'), () => { chWahl = erg.id; chModus = erg.modus; challengeStarten(); }],
           [t('Schließen'), null]];
      konsoleFrage(titel, text, knoepfe);
    }, 900);
    chZeichneDetail();
    return true;
  }

  // ---- Anzeige ----
  // Online-Liste (Schnappschuss oder direkt) PLUS die eigenen Zeiten dieses Geraets, die dort
  // noch fehlen - so steht ein eben gefahrener Lauf sofort in der Liste, auch wenn der
  // Schnappschuss eine Stunde alt ist.
  function chAlleZeiten(schl) {
    const l = chListen[schl];
    const lok = chLokal(schl).map((z) => ({ zeit_ms: z.zeit, auto: z.auto, fahrer: z.fahrer,
      geraet: z.geraet, runden: Array.isArray(z.runden) ? z.runden.length : undefined,
      runden_ms: Array.isArray(z.runden) ? z.runden : undefined }));
    if (l && l.online && l.zeiten) {
      const da = (z) => l.zeiten.some((x) => x.geraet === z.geraet && Math.abs(+x.zeit_ms - z.zeit_ms) < 2);
      const eintraege = l.zeiten.concat(lok.filter((z) => !da(z)));
      return { zeiten: eintraege.map((z) => +z.zeit_ms), online: true, eintraege };
    }
    return { zeiten: lok.map((z) => z.zeit_ms), online: false, eintraege: lok };
  }
  // Online je SPIELER (Geraet) gerechnet: seine Bestzeit zaehlt einmal. "Du warst schneller als X %
  // der Spieler" wuerde sonst von jemandem verzerrt, der dieselbe Strecke fuenfzigmal faehrt.
  function chBesteJeSpieler(eintraege, ich, zeit) {
    const beste = new Map();
    eintraege.forEach((z, i) => {
      const wer = z.geraet || ('?' + i);
      if (!beste.has(wer) || +z.zeit_ms < beste.get(wer)) beste.set(wer, +z.zeit_ms);
    });
    if (!beste.has(ich) || zeit < beste.get(ich)) beste.set(ich, zeit);
    return { werte: [...beste.values()], meine: beste.get(ich) };
  }
  function chRangText(schl, zeit) {
    const a = chAlleZeiten(schl);
    let alle = a.zeiten.indexOf(zeit) >= 0 ? a.zeiten : a.zeiten.concat([zeit]);
    if (a.online) {
      const b = chBesteJeSpieler(a.eintraege, chGeraet(), zeit);
      alle = b.werte; zeit = b.meine;
    }
    const platz = alle.filter((z) => z < zeit).length + 1;
    const p = chPerzentil(alle, zeit);
    return (a.online ? t('Du warst schneller als {p} % der Spieler.') : t('Schneller als {p} % deiner eigenen Läufe.'))
      .replace('{p}', p) + ' ' + t('Platz {a} von {b}.').replace('{a}', platz).replace('{b}', alle.length);
  }
  function chSeiteOffen() {
    const d = $('ch-detail');
    return !!(d && !d.hidden && d.closest('.subpage.on'));
  }
  // Unterseiten je Kategorie (sub-ch-a ... sub-ch-d); der Inhalt ist die Strecke der Woche.
  // `id` ist sonst auch eine STECKEN-Kennung (z.B. 'oval', aus "Ergebnis ansehen"): dann wird
  // die Kategorie der Strecke geoeffnet und genau diese Strecke gezeigt, nicht die der Woche.
  function challengeSeiteZeigen(id) {
    if (chKarteVollAn && typeof chKarteVoll === 'function') chKarteVoll();
    if (id === 'online') { chOnlineZeichnen(); return; }
    if (id === 'community') { communityZeichnen(); return; }
    const k = 'abcd'.indexOf(id);
    if (k < 0) {
      const def = chDef(id);
      if (!def || def.id !== id) return;
      const kat = def.kat.toLowerCase();
      // 'e' = Dauerrennen (sub-ch-e), sonst die Wochenkategorien a-d.
      if ('abcde'.indexOf(kat) < 0) return;
      chWahl = def.id;
      // Die Kategorie-Unterseite oeffnen, wie showSubpage('ch-'+kat) es tae (nur die Kategorie-
      // Buchstaben existieren als Unterseiten; die Strecken-Kennung tut das nicht).
      document.querySelectorAll('.subpage').forEach(p => p.classList.remove('on'));
      document.querySelectorAll('.subpage-home').forEach(h => { h.style.display = 'none'; });
      const sp = $('sub-ch-' + kat);
      if (sp) sp.classList.add('on');
      const titel = document.querySelector('#sub-ch-' + kat + ' .ch-titel');
      if (titel) titel.textContent = def.name;
      const platz = document.querySelector('#sub-ch-' + kat + ' .ch-platz');
      const d = $('ch-detail');
      if (platz && d && d.parentNode !== platz) platz.appendChild(d);
      if (d) d.hidden = false;
      chZeichneDetail();
      chListeLaden(chSchluessel(chWahl, chModus, chPreset));
      return;
    }
    chWahl = CHALLENGES[k].id;
    const titel = document.querySelector('#sub-ch-' + id + ' .ch-titel');
    if (titel) titel.textContent = CHALLENGES[k].name;
    const platz = document.querySelector('#sub-ch-' + id + ' .ch-platz');
    const d = $('ch-detail');
    if (platz && d && d.parentNode !== platz) platz.appendChild(d);
    if (d) d.hidden = false;
    chZeichneDetail();
    chListeLaden(chSchluessel(chWahl, chModus, chPreset));
  }
  function chZeichneDetail() {
    const d = $('ch-detail');
    if (!d) return;
    const def = chDef(chWahl), tiles = chTiles(def);
    $('ch-karte').innerHTML = chKarte(def, true);
    $('ch-idee').textContent = chIdee(def);
    const [bw, bh] = chFlaeche(tiles);
    const m = trackLaengeM(tiles);
    $('ch-fakten').textContent = t('Länge') + ' ' + chZahl(m, 2) + ' m · '
      + t('Platzbedarf') + ' ' + chZahl(bw, 2) + ' × ' + chZahl(bh, 2) + ' m · ' + chSetsText(def);
    document.querySelectorAll('#ch-modus [data-m]').forEach((b) => b.classList.toggle('an', b.dataset.m === chModus));
    const mh = $('ch-medaille-hinweis');
    if (mh) mh.innerHTML = chMedailleHinweis(def, chModus);
    // Teile: nur, was unter Strecke > Meine Teile eingetragen ist.
    const bil = teileBilanz(tiles).filter((x) => x.hat !== null);
    const fehlt = bil.filter((x) => x.rest < 0);
    const teile = $('ch-teile');
    teile.className = 'ch-teile' + (fehlt.length ? ' fehlt' : bil.length ? ' da' : '');
    teile.textContent = !bil.length ? t('Tipp: Unter Strecke > Meine Teile eintragen, was du hast, dann prüft die App hier, ob alles da ist.')
      : fehlt.length ? t('Fehlt') + ': ' + fehlt.map((x) => (-x.rest) + '× ' + t(TILE_LABEL[x.typ])).join(', ')
      : t('Alle Teile da');
    const nm = $('ch-name');
    if (nm && document.activeElement !== nm) nm.value = chOnline().fahrer || '';
    const start = $('ch-start');
    start.textContent = chLauf ? t('Challenge abbrechen') : t('Challenge starten');
    // Letztes Ergebnis dieser Strecke
    const e = $('ch-ergebnis');
    if (chLetzt && chLetzt.id === chWahl) {
      e.hidden = false;
      const schl = chSchluessel(chLetzt.id, chLetzt.modus, chLetzt.preset);
      $('ch-erg-titel').textContent = t(CH_MODUS_NAME[chLetzt.modus]) + ' · Pro';
      $('ch-erg-zeit').textContent = chLetzt.gueltig ? chZeit(chLetzt.zeit) : t('Nicht gewertet');
      $('ch-erg-text').textContent = chLetzt.gueltig ? chRangText(schl, chLetzt.zeit) : chGrundText(chLetzt);
      const ergSterne = chLetzt.gueltig ? chSterne(chDef(chWahl), chLetzt.modus, chLetzt.zeit) : 0;
      const ergSt = $('ch-erg-sterne');
      if (ergSt) { ergSt.innerHTML = chSterneText(ergSterne); ergSt.hidden = !ergSterne; }
    } else e.hidden = true;
    // Legende der Sterne: Gold = gute, Silber = ordentliche, Bronze = gefahrene Zeit.
    const lg = $('ch-sterne-hinweis');
    if (lg) {
      lg.innerHTML = ''
        + '<span class="ch-sterne" style="color:var(--gold)">' + chSterneZeichen(3) + '</span> ' + t('Gold')
        + ' &middot; <span class="ch-sterne" style="color:var(--silber)">' + chSterneZeichen(2) + '</span> ' + t('Silber')
        + ' &middot; <span class="ch-sterne" style="color:var(--bronze)">' + chSterneZeichen(1) + '</span> ' + t('Bronze');
    }
    chZeichneListe();
  }
  function chZeichneListe() {
    const def = chDef(chWahl);
    const schl = chSchluessel(chWahl, chModus, chPreset);
    const l = chListen[schl] || {};
    const a = chAlleZeiten(schl);
    const o = chOnline();
    const st = $('ch-liste-status');
    st.textContent = l.laedt ? t('Lade Bestenliste …')
      : a.zeiten.length === 0 ? t('Noch keine Zeiten eingetragen. Fahr die Challenge, dann erscheint deine Zeit hier.')
      : a.online ? t('Online-Bestenliste') + ': ' + a.zeiten.length + ' ' + t('Zeiten')
        + (l.stand ? ' · ' + t('Stand') + ' ' + new Date(l.stand).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) : '')
      : o.url ? t('Online-Bestenliste nicht erreichbar, hier stehen deine eigenen Zeiten.')
      : t('Deine Zeiten auf diesem Gerät. Für die gemeinsame Liste unter Challenges > Online eine Adresse eintragen.');
    // BESTELLT: "für jede Challenge Statistiken zeigen": km je Spieler, Anzahl Spieler,
    // insgesamt gefahrene km. Streckenlaenge kennt die App (trackLaengeM); die Runden je
    // Eintrag kommen aus der Online-Liste (runden). Fehlt `runden` (aeltere Eintraege,
    // lokale ohne Laps), schaetzen wir aus der Zeit und der Mindestrundenzeit.
    const stats = $('ch-stats');
    if (stats) {
      const m = trackLaengeM(chTiles(def));
      const km = (runden) => m * (runden || 0) / 1000;   // 1:50-Massstab: km
      const eintraege = a.eintraege;
      const geraete = new Set();
      let kmGesamt = 0;
      eintraege.forEach((z) => {
        geraete.add(z.geraet || ('?' + z.fahrer + '_' + z.zeit_ms));
        let runden = z.runden;
        if (!runden || runden < 1) {
          // Ohne Rundenangabe: aus der Gesamtzeit und der Mindestrundenzeit schaetzen.
          runden = Math.max(1, Math.round((+z.zeit_ms) / (chMinRundeMs(def) || 1)));
        }
        kmGesamt += km(runden);
      });
      const kmEigene = (() => {
        const ich = chGeraet();
        const mein = eintraege.filter((z) => z.geraet === ich);
        if (!mein.length) return null;
        const bester = mein.reduce((a, b) => (+a.zeit_ms <= +b.zeit_ms ? a : b));
        let r = bester.runden;
        if (!r || r < 1) r = Math.max(1, Math.round(+bester.zeit_ms / (chMinRundeMs(def) || 1)));
        return km(r);
      })();
      let txt = t('Spieler') + ': ' + geraete.size + ' · ' + t('Gefahrene Strecke')
        + ': ' + chZahl(kmGesamt, 2) + ' km';
      if (kmEigene !== null) txt += ' · ' + t('Deine Strecke') + ': ' + chZahl(kmEigene, 2) + ' km';
      if (stats.textContent !== txt) stats.textContent = txt;
    }
    // Eigene Bestzeit: aus dem letzten Lauf oder aus den lokalen Zeiten.
    const lok = chLokal(schl);
    const eigene = chLetzt && chLetzt.gueltig && schl === chSchluessel(chLetzt.id, chLetzt.modus, chLetzt.preset)
      ? chLetzt.zeit : (lok.length ? lok[0].zeit : null);
    const eintr = a.eintraege.slice().sort((x, y) => x.zeit_ms - y.zeit_ms);
    // BESTELLT: "nur den besten Lauf je Geraet zeigen" und "eine Zeit meines langsameren
    // Geraets steht doppelt in der Liste". Ein Geraet (geraet) kann mehrere Eintraege haben
    // (mehrere Laeufe, oder dieselbe Zeit in Schnappschuss und lokal). Sortiert ist die Liste
    // schon nach Zeit, also bleibt je Geraet der erste (schnellste) Eintrag stehen.
    const eintrProGeraet = [];
    const gesehen = new Set();
    for (const z of eintr) {
      const wer = z.geraet || ('?' + z.zeit_ms + '_' + z.fahrer);
      if (gesehen.has(wer)) continue;
      gesehen.add(wer);
      eintrProGeraet.push(z);
    }
    const anzeige = eintrProGeraet;
    const tb = $('ch-liste');
    tb.innerHTML = '';
    const bester = anzeige.length ? +anzeige[0].zeit_ms : 0;
    const ich = chGeraet();
    const defS = chDef(chWahl);
    anzeige.slice(0, 50).forEach((z, i) => {
      const tr = document.createElement('tr');
      if (z.geraet === ich && +z.zeit_ms === eigene) tr.className = 'du';
      const sterne = chSterne(defS, chModus, +z.zeit_ms);
      const zellen = [String(i + 1), (z.fahrer ? z.fahrer + ' · ' : '') + (z.auto || '–'), chZeit(+z.zeit_ms),
        i ? '+' + chZahl((z.zeit_ms - bester) / 1000, 3) : '–'];
      zellen.forEach((txt) => { const td = document.createElement('td'); td.textContent = txt; td.setAttribute('data-i18n-skip', ''); tr.appendChild(td); });
      const st = document.createElement('td');
      st.innerHTML = chSterneText(sterne);
      st.setAttribute('data-i18n-skip', '');
      tr.appendChild(st);
      tb.appendChild(tr);
    });
    // Histogramm, oben schnell, die eigene Klasse markiert.
    const h = $('ch-histo');
    h.innerHTML = '';
    // EINE Zeit je Geraet (v0.9.20), wie die Tabelle darueber - GEMELDET: "Balken fuer mehrere
    // Zeiten, aber ich hab nur eine submittet" (die eigenen lokalen Laeufe zaehlten einzeln).
    const zeiten = eintrProGeraet.map((z) => +z.zeit_ms).filter((x) => x > 0);
    if (eigene !== null && zeiten.indexOf(eigene) < 0) zeiten.push(eigene);
    const kl = chHistogramm(zeiten);
    const hoch = Math.max(1, ...kl.map((k) => k.anz));
    kl.forEach((k, i) => {
      const du = eigene !== null && eigene >= k.von && (eigene < k.bis || i === kl.length - 1);
      const lbl = document.createElement('span'); lbl.className = 'ch-h-lbl'; lbl.textContent = chZeit(Math.round(k.von)).slice(0, -2);
      const bahn = document.createElement('div'); bahn.className = 'ch-h-bahn';
      const bar = document.createElement('div'); bar.className = 'ch-h-bar' + (du ? ' du' : '');
      bar.style.width = Math.max(3, 100 * k.anz / hoch) + '%';
      bahn.appendChild(bar);
      const n = document.createElement('span'); n.className = 'ch-h-n'; n.textContent = k.anz;
      [lbl, n].forEach((x) => x.setAttribute('data-i18n-skip', ''));
      h.appendChild(lbl); h.appendChild(bahn); h.appendChild(n);
    });
    $('ch-perz').textContent = eigene !== null && zeiten.length > 1 ? chRangText(schl, eigene) : '';
    chZeichneDreier(schl, a);
  }
  // BESTELLT: "bei Beste-Runde zwei Bestenlisten untereinander: die aktuelle plus eine mit
  // der besten Durchschnittszeit aus drei aufeinanderfolgenden Runden." Nur fuer Beste-Runde
  // (hotlap); Rennen hat feste Runden und die 3er-Serie ist dort ohne Bedeutung. Die Runden-
  // zeiten je Eintrag kommen aus der Online-Liste (runden_ms); aeltere Eintraege ohne sie
  // werden uebersprungen. Je Geraet zaehlt der beste 3er-Durchschnitt.
  // BESTELLT: "nur drei aufeinanderfolgende Zeiten, die alle gueltig waren". Die beste
  // Summe aus drei AUFEINANDERFOLGENDEN Runden, wobei jede Dreiergruppe verworfen wird,
  // in der eine Runde unter der Mindestzeit liegt (z. B. 1 s, weil das Auto kaum fuhr).
  // Rueckgabe null, wenn keine gueltige Dreiergruppe existiert.
  function chDreierBeste(rm, minMs) {
    if (!Array.isArray(rm) || rm.length < 3) return null;
    let best = Infinity;
    for (let i = 0; i + 2 < rm.length; i++) {
      if (rm[i] < minMs || rm[i + 1] < minMs || rm[i + 2] < minMs) continue;
      const sum = rm[i] + rm[i + 1] + rm[i + 2];
      if (sum < best) best = sum;
    }
    return Number.isFinite(best) ? best : null;
  }
  function chZeichneDreier(schl, a) {
    const tb = $('ch-liste-3er');
    if (!tb) return;
    const modus = schl.split('|')[1];
    // Ueberschrift und Hinweis gehoeren zur 3er-Serie: nur bei Beste-Runde zeigen.
    const h3 = $('ch-zweite-3er'), hinweis = $('ch-hinweis-3er');
    if (h3) h3.hidden = modus !== 'hotlap';
    if (hinweis) hinweis.hidden = modus !== 'hotlap';
    if (modus !== 'hotlap') { tb.innerHTML = ''; return; }
    const def = chDef(schl.split('|')[0]);
    const minMs = chMinRundeMs(def);
    const beste = new Map();
    a.eintraege.forEach((z) => {
      const rm = Array.isArray(z.runden_ms) ? z.runden_ms.map(Number) : [];
      const best = chDreierBeste(rm, minMs);
      if (best === null) return;
      const wer = z.geraet || ('?' + z.fahrer + '_' + z.zeit_ms);
      if (!beste.has(wer) || best < beste.get(wer).best) beste.set(wer, { best, fahrer: z.fahrer, auto: z.auto, geraet: z.geraet });
    });
    const eintr = Array.from(beste.values()).sort((x, y) => x.best - y.best).slice(0, 50);
    tb.innerHTML = '';
    if (!eintr.length) {
      tb.innerHTML = '<tr><td colspan="3" class="muted">' + t('Noch keine 3er-Serie') + '</td></tr>';
      return;
    }
    const ich = chGeraet();
    const bester = eintr[0].best;
    eintr.forEach((z, i) => {
      const tr = document.createElement('tr');
      if (z.geraet === ich) tr.className = 'du';
      const avg = z.best / 3;
      const zellen = [String(i + 1), (z.fahrer ? z.fahrer + ' · ' : '') + (z.auto || '–'),
        chZeit(Math.round(avg)), i ? '+' + chZahl((z.best - bester) / 3000, 3) : '–'];
      zellen.forEach((txt) => { const td = document.createElement('td'); td.textContent = txt; td.setAttribute('data-i18n-skip', ''); tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }
  function chKachelnZeichnen() {
    const w = chWoche();
    const wechsel = w.tage <= 1 ? t('Neue Strecke morgen') : t('Neue Strecke in {n} Tagen').replace('{n}', w.tage);
    CHALLENGES.forEach((def, i) => {
      const k = 'abcd'[i];
      const el = document.querySelector('.ch-mini[data-kat="' + k + '"]');
      if (el && el.dataset.id !== def.id) { el.innerHTML = chKarte(def, false); el.dataset.id = def.id; }
      const kachel = el && el.closest('.ch-kachel');
      if (!kachel) return;
      kachel.querySelector('.ch-k-name').textContent = def.name;
      kachel.querySelector('.ch-k-info').textContent = chSetsText(def) + ' · '
        + def.runden + ' ' + t('Runden') + ' · ' + wechsel;
      // Sichtbar auch im Konsolen-Layout, das die Beschreibungszeile der Kacheln ausblendet.
      // Die Woche steht seit v0.9.20 nur noch einmal, neben der Ueberschrift (BESTELLT).
      kachel.querySelector('.ch-k-woche').textContent =
        w.tage <= 1 ? t('neu morgen') : t('neu in {n} Tagen').replace('{n}', w.tage);
      // "Beliebteste Strecke" (BESTELLT): ein Banner auf der Kachel mit den meisten Spielern.
      const banner = kachel.querySelector('.ch-k-beliebt');
      if (banner) banner.hidden = !chBeliebtesteId || chBeliebtesteId !== def.id;
      // Erreichter Rang (Medaille + Perzentil) auf der Uebersicht.
      const rang = kachel.querySelector('.ch-k-rang');
      if (rang) rang.innerHTML = chRangKachelText(chKachelRang(def));
      chErgebnisseZeigen(kachel, def.id);
    });
    const kopf = $('ch-woche-kopf');
    if (kopf && CHALLENGES[0]) kopf.textContent = t('Woche') + ' ' + CHALLENGES[0].woche + '/20';
    chDauerKachelnZeichnen();
  }
  // Dauerrennen-Kacheln (sub-ch-e): feste Strecken, keine Wochenrotation.
  function chDauerKachelnZeichnen() {
    CH_DAUER.forEach((def) => {
      const el = document.querySelector('.ch-mini[data-dauer="' + def.id + '"]');
      if (el && el.dataset.id !== def.id) { el.innerHTML = chKarte(def, false); el.dataset.id = def.id; }
      const kachel = el && el.closest('.ch-kachel');
      if (!kachel) return;
      kachel.querySelector('.ch-k-name').textContent = def.name;
      kachel.querySelector('.ch-k-info').textContent = chSetsText(def) + ' · '
        + def.runden + ' ' + t('Runden');
      const woche = kachel.querySelector('.ch-k-woche');
      if (woche) woche.textContent = t('Dauerrennen');
      const rang = kachel.querySelector('.ch-k-rang');
      if (rang) rang.innerHTML = chRangKachelText(chKachelRang(def));
      chErgebnisseZeigen(kachel, def.id);
    });
  }
  // BESTELLT: "ein 'beliebteste Strecke'-Banner auf die Challenge mit den meisten Spielern".
  // Gezaehlt werden die Eintraege der Online-Listen des Schnappschusses (anzahl je
  // Strecke|Modus|Preset); ein Spieler kann mehrere Eintraege haben, naeher kommen wir ohne
  // eigene Spieler-Statistik nicht. Die Rechnung laeuft im Hintergrund und setzt das Banner.
  let chBeliebtesteId = null;
  // Ergebnisse je Strecke (alle Modi/Presets), aus demselben Schnappschuss. BESTELLT: "zeig bei
  // den woechentlichen Challenges an, wie viele Spieler jeweils Zeiten beigetragen haben
  // (einfach nur darunter: 'X Ergebnisse')".
  let chErgebnisse = null;
  let chSpielerJe = null;   // verschiedene Geraete je Strecke (alle Modi/Presets)
  function chErgebnisseZeigen(kachel, id) {
    let em = kachel.querySelector('.ch-k-anzahl');
    if (!em) {
      em = document.createElement('em');
      em.className = 'ch-k-anzahl';
      em.setAttribute('data-i18n-skip', '');
      const nach = kachel.querySelector('.ch-k-woche');
      if (nach && nach.nextSibling) kachel.insertBefore(em, nach.nextSibling); else kachel.appendChild(em);
    }
    const n = chErgebnisse ? (chErgebnisse[id] || 0) : null;
    em.hidden = n === null;
    // BESTELLT (v0.9.20): "je Strecke noch anzeigen, wie viele Spieler gespielt haben".
    const sp = chSpielerJe ? (chSpielerJe[id] || 0) : 0;
    em.textContent = (n === 1 ? t('1 Ergebnis') : t('{n} Ergebnisse').replace('{n}', n))
      + ' · ' + (sp === 1 ? t('1 Spieler') : t('{n} Spieler').replace('{n}', sp));
  }
  function chBeliebteste() {
    chSchnappschuss().then((j) => {
      if (!j || !j.listen) return;
      // Listen aus dem Schnappschuss in chListen legen, damit die Kachel-Raenge (Perzentil)
      // online + lokal mischen, nicht nur die eigenen Laeufe.
      Object.keys(j.listen).forEach((k) => {
        const l = j.listen[k];
        if (l && !chListen[k]) chListen[k] = { zeiten: l.zeiten || [], online: true, anzahl: l.anzahl || 0, stand: j.stand };
      });
      const summe = {};
      const geraete = {};
      Object.keys(j.listen).forEach((k) => {
        const id = k.split('|')[0];
        summe[id] = (summe[id] || 0) + (j.listen[k].anzahl || 0);
        if (!geraete[id]) geraete[id] = new Set();
        for (const z of (j.listen[k].zeiten || [])) geraete[id].add(z.geraet || ('?' + z.fahrer + '_' + z.zeit_ms));
      });
      chSpielerJe = {};
      Object.keys(geraete).forEach((id) => { chSpielerJe[id] = geraete[id].size; });
      const ids = CHALLENGES.map((d) => d.id);
      let best = null;
      ids.forEach((id) => { if (summe[id] > 0 && (best === null || summe[id] > summe[best])) best = id; });
      chBeliebtesteId = best;
      chErgebnisse = summe;
      chKachelnZeichnen();
    }).catch(() => { /* ohne Schnappschuss kein Banner */ });
  }
  setTimeout(chBeliebteste, 800);
  // Wechsel im laufenden Betrieb: jede Minute nachsehen; eine laufende Challenge behaelt ihre
  // Strecke (chLauf.id, chDef sucht im ganzen Katalog).
  function chWocheNachsehen() {
    const neu = chAktuelle();
    if (neu.every((d, i) => d === CHALLENGES[i])) { chKachelnZeichnen(); return; }
    CHALLENGES = neu;
    chKachelnZeichnen();
    if (!chLauf && chSeiteOffen()) {
      const offen = document.querySelector('.subpage.on[id^="sub-ch-"]');
      if (offen) challengeSeiteZeigen(offen.id.slice(7));
    }
  }
  setInterval(chWocheNachsehen, 60000);
  if (typeof i18nOnLangChange === 'function') i18nOnLangChange(() => {
    chKachelnZeichnen();
    // Auch wenn die Seite gerade zu ist: der Inhalt bleibt im Dokument, und der Idee-Text ist
    // zusammengesetzt, den kann der Textknoten-Uebersetzer nicht.
    const d = $('ch-detail');
    if (d && !d.hidden) chZeichneDetail();
  });
  function chOnlineZeichnen() {
    const o = chOnline();
    $('ch-url').value = o.url;
    $('ch-fahrer').value = o.fahrer;
    $('ch-hochladen').checked = !!o.hochladen;
  }
  function chOnlineSpeichern() {
    chSchreiben(CH_ONLINE_STORE, { url: $('ch-url').value.trim(), fahrer: $('ch-fahrer').value.trim().slice(0, 16),
                                   hochladen: $('ch-hochladen').checked });
    Object.keys(chListen).forEach((k) => delete chListen[k]);
  }

  // ---- Karte: Vollbild (BESTELLT) ------------------------------------------------
  // X auf der Karte (menuNavActivate klickt das Element), Kreis (konsoleZurueck) oder ein
  // Tap/Klick vergroessert bzw. verkleinert die Streckenkarte. Ein Zustand, damit die
  // Menuenavigation (50b-menu-nav.js) und der Rueckweg (51-konsole.js) dieselbe Frage
  // stellen koennen.
  let chKarteVollAn = false;
  function chKarteVoll() {
    const k = $('ch-karte');
    if (!k) return;
    chKarteVollAn = !chKarteVollAn;
    k.classList.toggle('ch-voll', chKarteVollAn);
  }
  function chKarteVollOffen() { return chKarteVollAn; }

  // ---- Verdrahtung ----
  // Ein Klick auf eine Haelfte waehlt sie; X (menuNavActivate klickt den Knopf selbst) oder ein
  // Klick daneben schaltet um.
  // Karte: Klick/Tap toggelt das Vollbild (X laeuft ueber menuNavActivate -> click).
  const chKarteEl = $('ch-karte');
  if (chKarteEl) chKarteEl.addEventListener('click', chKarteVoll);
  $('ch-modus').addEventListener('click', (e) => {
    const h = e.target.closest('[data-m]');
    chModus = h ? h.dataset.m : (chModus === 'hotlap' ? 'rennen' : 'hotlap');
    chZeichneDetail(); chListeLaden(chSchluessel(chWahl, chModus, chPreset));
  });
  // BESTELLT: "bei dek challenges jeweils einen toggle ein, mit dem man die Strecke spiegeln
  // kann". Der Umschalter zeichnet die Karte neu und merkt den Zustand fuer den Start.
  $('ch-spiegel').addEventListener('change', () => {
    chSpiegel = $('ch-spiegel').checked;
    chZeichneDetail();
  });
  $('ch-start').addEventListener('click', () => { if (chLauf) challengeAbbrechen(); else challengeStartenDialog(); });
  ['ch-url', 'ch-fahrer', 'ch-hochladen'].forEach((id) => $(id).addEventListener('change', chOnlineSpeichern));
  // Derselbe Name direkt auf der Strecken-Seite (BESTELLT: "im Challenges-Bildschirm nochmal
  // erlauben, dass ich meinen Username fuer die Bestenliste festlege").
  $('ch-name').addEventListener('change', () => {
    const o = chOnline();
    o.fahrer = $('ch-name').value.trim().slice(0, 16);
    chSchreiben(CH_ONLINE_STORE, o);
    $('ch-fahrer').value = o.fahrer;
  });
  $('ch-test').addEventListener('click', () => {
    chOnlineSpeichern();
    const st = $('ch-test-status');
    if (!chOnline().url) { st.textContent = t('Erst die Adresse eintragen.'); return; }
    st.textContent = t('Prüfe …');
    const schl = chSchluessel('oval', 'hotlap', 'pro');
    chListeLaden(schl, true).then(() => {
      const l = chListen[schl];
      st.textContent = l && l.online ? t('Verbunden.') + ' ' + (l.anzahl || 0) + ' ' + t('Zeiten auf der Liste.')
        : t('Keine Verbindung') + (l && l.fehler ? ': ' + l.fehler : '');
    });
  });
  setTimeout(chKachelnZeichnen, 0);
