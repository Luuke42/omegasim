# Klangquellen

Zwei klar getrennte Gruppen. Der Unterschied ist wichtig, weil nur die eine
Gruppe fremdes Aufnahmematerial enthaelt.

## Vollstaendig synthetisch — kein Aufnahmematerial

Vierzehn Motoren, und jeder gehoert zu einem wirklichen Auto: die acht Rennmotoren nach
technischen Angaben (Corvette C6.R, Corvette Z06 GT3.R, Mercedes-AMG GT3, Ferrari 296 GT3,
BMW M4 GT3, Huracan GT3 / R8 LMS, Aston Martin Vantage GT3, Porsche 911 GT3 R), der Ford
Mustang GT3 (V8 Cross-Plane), ein Formel 1 nach dem Reglement 2026 (1,6-l-V6 Turbo-Hybrid)
und vier historische Rennwagen (Ford GT40 Mk I, Lola T70 Mk3B, Ferrari 330 P4 / 412P,
Maserati MC12) — sowie alle
Effekte (Bremsenquietschen, Reifenquietschen, Crash-Varianten, Schlagschrauber,
Tankgeraeusch, Karosseriereparatur, Motorstart) sind von Grund auf gerechnet. Es wird nichts aus einer
Aufnahme abgespielt.

Jeder dieser Motoren hat vier Schleifen: drei Drehzahlbaender (`idle`, `mid`, `high`), die
nach Drehzahl ueberblendet werden, und eine Schubschleife (`over`) am mittleren Band, die
parallel dazu nach **Last** eingeblendet wird. Voll auf Zug ab 36 % Gas, voller Schub unter
6 %, dazwischen linear; die Summe aller Stimmen ist immer genau 1, damit im Uebergang kein
Loch und keine Beule entsteht.

Die Hubraum- und Auspuffdaten sind nicht geraten: die Laenge des Kruemmerprimaerrohrs
bestimmt die Resonanz physikalisch als `c / (4 L)`, und die Zylinderzahlen, Drehzahlgrenzen
und Kurbelwellenwinkel stammen aus den Motordefinitionen von engine-sim. Die drei
urspruenglichen Motoren behielten ihren Klang: fuer sie wurde die Rohrlaenge so gesetzt,
dass sie die vorher von Hand eingestellten Resonanzen (148 / 150 / 95 Hz) genau trifft.

### Was in v0.4.54 dazugekommen ist — vier historische Rennwagen, als WIP

| Schluessel | Motor | Was Angabe ist | Zuendfolge, Bankaufteilung |
|---|---|---|---|
| `gt40` | Ford GT40 Mk I | 4,7-l-V8 (289), 90 Grad, Cross-Plane, ~6500/min | 1-5-4-2-6-3-7-8, Haelften (Ford zaehlt 1–4 rechts) |
| `lolat70` | Lola T70 Mk3B | Chevrolet 5,0-l-V8, Cross-Plane, ~7000/min | 1-8-4-3-6-5-7-2, ungerade/gerade (GM) |
| `f330p4` | Ferrari 330 P4 / 412P | 4,0-l-V12, 60 Grad, ~8200/min | 1-7-5-11-3-9-6-12-2-8-4-10, Haelften |
| `mc12` | Maserati MC12 | 6,0-l-V12, 65 Grad, ~7800/min | 1-12-5-8-3-10-6-7-2-11-4-9, Haelften |

**Alle vier sind als WIP gekennzeichnet, und zwar aus zwei verschiedenen Gruenden.**

Der erste gilt fuer alle: nach Gehoer geprueft ist keiner. Die Geometrie stimmt — die
Bankaufteilung ist nachgerechnet, die zwei V12 zuenden je Bank gleichmaessig alle 120 Grad
mit 60 Grad Bankversatz, die drei Cross-Plane-V8 lumpig mit 90/180/270 —, aber die sieben
Klangregler (Rohrlaenge, Guete, Impulsbreite, Helligkeit, Rauschen, Klappern, Saettigung)
sind gesetzt und nicht gemessen.

Der zweite gilt fuer den Maserati und ist der ehrlichere. `banks_from_order()` legt
Zuendereignis *i* immer auf `i · 720/n`, **unabhaengig vom Bankwinkel**. Die 65 Grad des
MC12 gegen die 60 Grad des Ferrari sind also genau das, was dieses Modell nicht darstellen
kann; die beiden V12 unterscheiden sich hier nur in Drehzahl, Rohrlaenge und den
Klangreglern. Abgeschwaecht gilt dasselbe fuer die zwei neuen Cross-Plane-V8: bei einem
90-Grad-V8 mit gerader Nummerierung hat jede Bank zwangslaeufig dieselbe Folge von
Zuendabstaenden, nur anders gedreht — was sie unterscheidet, ist welche Zylinder sich einen
Kruemmer teilen, also die Phase der beiden Baenke gegeneinander, dazu Rohrlaenge und
Drehzahl. Sie werden sich untereinander und zur Corvette C6.R aehneln.

Gemessen an den erzeugten Dateien: alle sechzehn Schleifen sind nahtlos (Zyklusbindung
unter 2 %), ohne Gleichanteil und ohne Kodierungsdrift. Bei den V12 liegt im Leerlauf 43
bzw. 64 Prozent der Energie auf der Zuendrate, bei den V8 auf der Rohrresonanz — die
Rollenverteilung, die lange Rohre gegen einen hochdrehenden V12 erwarten lassen.

Damit sind es 86 statt 70 `.ogg`-Dateien, und mit der gerechneten Baenderleiter aus
v0.4.55 (ein Zwischenband je Motor, beim Formel 1 zwei) sind es 101.

### Was in v0.4.52 herausgefallen ist

Bis dahin waren es siebzehn Motoren mit 68 Schleifendateien. Acht sind heraus, und der
Grund ist bei beiden Gruppen derselbe: sie benannten kein Auto, das man kennt.

* **Sechs generische, gerechnete** — ein Strassen-Porsche (Boxer-6), ein Turbo-Reihensechser,
  ein Flat-Plane-V8, ein V10, ein Dreizylinder-Turbo und ein Formel-1-V12 nach dem Ferrari
  412 T2. Der V12 ist durch den 2026er V6 ersetzt: ein aktuelles Auto statt eines aus 1995.
* **Zwei Aufnahmen** — die Corvette C6 und ein zweiter Porsche, beide aus Aufnahmematerial
  geschnitten. Damit ist jetzt **jeder** Motor in diesem Ordner synthetisch, und der
  Unterschied, den dieses Dokument aufmacht, betrifft nur noch die Umgebungsgeraeusche.

Dazu sechs weitere Dateien, die von nichts gelesen wurden: drei `*_accel.ogg`, die in keiner
Datei standen, und drei `*_demo.ogg`, die nur ein `accel`-Block in `fx.json` nannte — den
kein Code las. Gefunden bei der Durchsicht auf nicht verdrahtete Teile, nicht beim Aufraeumen
der Motoren.

Damit waren es 70 statt 106 `.ogg`-Dateien. Mit den vier historischen Motoren oben waren es 86, mit der Baenderleiter sind es 101.

### Die zwei Quietschtoene, und warum es zwei sind

Bremse und Reifen quietschen nicht gleich, und ein Ton fuer beides waere fuer eines von
beiden falsch. Gemessen an ihrem eigenen Material:

| Ton | Laenge | Frequenzschwerpunkt | Naht (Verhaeltnis zum mittleren Schritt) |
|---|---|---|---|
| `brake_squeal.ogg` | 1,40 s | 3382 Hz | 1,41 |
| `tyre_squeal.ogg` | 1,60 s | 1473 Hz | 0,57 |

Das Bremsenquietschen ist **tonal und schmal**: drei enge Resonanzen bei 2,85 / 4,18 /
5,62 kHz mit Guete um 50, wie die Reibpaarung Belag gegen Scheibe. Es pfeift.

Das Reifenquietschen ist eine Groessenordnung tiefer und **breit**: Resonanzen bei 620 / 980 /
1650 Hz mit Guete um 12, dazu ein deutlich schwererer Rauschanteil (0,42 gegen 0,18), weil
der breitbandige Teil beim Reifen der Klang SELBST ist - Gummi, das auf Asphalt schert - und
nicht Fuellung unter einem Ton. Es scheuert.

Die **Tonhoehe ist absichtlich nicht eingebacken.** Der Spieler veraendert die
Abspielgeschwindigkeit mit der Reibkreis-Ausnutzung, so wie ein echtes Quietschen steigt,
wenn der Reifen sich seiner Grenze naehert. Ein eingebackener Verlauf wuerde dagegen
arbeiten und die Naht der Schleife hoerbar machen.

Beide sind zirkular konstruiert, im Frequenzbereich statt mit einem Zeitfilter: ein
Zeitfilter liesse die zwei Enden der Schleife nicht zusammenpassen, und eine Naht in einem
Ton, der ueber ganze Kurven laeuft, faellt weit mehr auf als eine in einem Einzelschlag.

### Die Rennmotoren, und was an ihnen Angabe ist und was Wahl

Aus den technischen Angaben kommen Zylinderzahl, Bauart, Kurbelwelle, Drehzahl und die
Zuendfolge. Aus der Zuendfolge folgt die Bankaufteilung, und daraus kommt der Charakter,
weil jede Bank ihren eigenen Kruemmer hat. Dabei entscheidet die Nummerierung des
Herstellers mit: GM zaehlt ungerade Zylinder links, Mercedes und BMW die erste Haelfte.
Unter der falschen Konvention wird aus der Ferrari-Folge `1-2-3-4-5-6` Unsinn
(120/120/480 Grad je Bank statt gleichmaessig 240).

**Nicht** aus den Angaben kommen Hubraum, Bohrung und Hub: das Modell synthetisiert
Zuendereignisse und rechnet keine Gasdynamik, es gibt also keine Groesse, in die ein
Hubraum eingehen koennte. Rohrlaenge, Impuls, Helligkeit, Rauschen, Klappern und Saettigung
sind nach Gehoer gesetzt.

Der achte, der Porsche 911 GT3 R, kam mit v0.4 dazu. An ihm ist die Bankaufteilung der
ganze Charakter, und sie ist nachgerechnet: Porsche zaehlt 1-2-3 auf der einen und 4-5-6 auf
der anderen Bank, und die Zuendfolge 1-6-2-4-3-5 ergibt damit zwei EXAKT gleichmaessige
Baenke im strengen Wechsel (0/240/480 gegen 120/360/600, Abstaende jeweils 240 Grad). Genau
deshalb klingt ein Boxer-6 hart und sauber und blubbert nicht - es gibt nichts Ungleiches zu
mischen. Unter der GM-Zaehlweise ergaebe dieselbe Zuendfolge 480/120/120 Grad je Bank, also
einen Motor, der dreimal kurz hintereinander auf einer Bank zuendet und dann eine
dreiviertel Umdrehung schweigt: zweiter bestaetigter Fall dieser Falle nach dem Ferrari 296.

Bei ihm sind zwei der gewaehlten Werte begruendet und nicht nur nach Gehoer gesetzt. Die
Rohrlaenge 20,5 Zoll (165 Hz) ist kuerzer als beim vorhandenen synthetischen Porsche mit
22,81 Zoll (148 Hz), weil DER ein Strassenmotor ist - ein Rennkruemmer ist kuerzer, und
kuerzer heisst hoeher; 165 Hz liegt dabei noch unter der Zuendrate bei 5500/min (275 Hz), es
droehnt also nicht. Und der Rauschanteil 0,17 ist der hoechste aller acht: das sind die
sechs Einzeldrosseln, die keinen gemeinsamen Sammler haben, der das Ansauggeraeusch daempft.
Hubraum, Bohrung, Hub und Verdichtung (4194 cm3, 104,5 x 81,5 mm, 13,2:1) gehen wie bei allen
anderen NICHT ein und stehen nur nachrichtlich im Namen.

Drei der sieben aelteren sind im Original aufgeladen (Ferrari 296 GT3, BMW M4 GT3, Aston Martin
Vantage GT3). Dieses Modell hat **keinen Lader**: Geometrie, Kurbelwelle und Zuendfolge
stimmen, der Ladedruck fehlt. Der Charakter der Bauart bleibt, das Pfeifen nicht.

Beim Corvette Z06 GT3.R widersprechen sich zwei gelieferte Angaben: die Kurbelwelle ist als
Flat-Plane (180 Grad) angegeben, die Zuendfolge `1-4-3-6-8-5-2-7` ergibt unter
GM-Nummerierung aber 180/270/180/90 Grad je Bank — die Signatur einer Cross-Plane, und
zeichengleich mit dem LS7.R des C6.R. Gebaut ist er nach der **Kurbelwelle**, weil die den
Klang entscheidet und weil sonst zwei Motoren identisch klingen wuerden und der Name
„Flat-Plane“ falsch waere.

Das Modell folgt dem Ansatz von ange-yaghi/engine-sim (MIT-Lizenz):
Zuendereignisse als Druckimpulse, gefaltet mit der Resonanz des
Auspuffkruemmers, dazu Ventiltrieb-Klappern im Nockenwellentakt,
Zuendungenauigkeit, Saettigung und Fehlzuendungen im Schubbetrieb. Der
Charakter entsteht aus den Zuendabstaenden: ein gleichmaessig zuendender
Sechszylinder klingt anders als ein V8 mit Cross-Plane-Kurbelwelle, dessen
Baenke ungleich zuenden — daher das Blubbern.

Die Fahrzeugnamen bezeichnen das nachempfundene Motorkonzept, nicht eine
Aufnahme des jeweiligen Fahrzeugs.

## Aus Pixabay-Aufnahmen geschnitten (lizenzfrei)

Hier wird tatsaechlich Aufnahmematerial verwendet — die Pixabay-Lizenz erlaubt
das, und es gab keinen Grund zu modellieren, was eine gute Aufnahme schon
liefert.

- **Corvette C6** (`corvette_idle/mid/high.ogg`) — aus
  `astonmartinvantagev12-chevrolet-corvette-c6-sound-effect-360531.mp3`.
  Basisdrehzahlen aus der gemessenen Zuendfrequenz abgeleitet (V8, vier
  Zuendungen je Kurbelwellenumdrehung). Zwei Korrekturen nach einer Rueckmeldung, sie klinge
  zu hoch: die Zuendfrequenzen von `mid` und `high` waren um rund 10 Prozent zu tief
  deklariert (gemessen 303 und 332 statt 269 und 301 Hz). Die eigentliche Ursache war aber
  die Streckung - `high` stand bei 4522/min, also lief die Schleife bei 9000 Redline am
  2.0-Anschlag. Der Faktor `rpmScale` 0,62 ist eine ausdrueckliche
  Geschmacksentscheidung und keine Messung; er weicht bewusst von der geometrischen
  Zentrierung ab, die beim Porsche verwendet wird, weil die Corvette danach immer noch zu
  hoch klang. Was NICHT zutraf: eine Oktavverwechslung. Gemessen traegt 118,4 Hz bei
  `idle` allein 40 Prozent der Energie, f0/2 und f0/4 je 0,01 Prozent.
- **Porsche (Aufnahme)** (`porsche_rec_idle/mid/high.ogg`) — aus einer eigenen Aufnahme
  des Nutzers (`porschesound/Porsche sounds.m4a`, nicht Teil dieses Repos, nicht Pixabay).
  Geschnitten von `tools/porsche_rec.py`. Die Aufnahme deckt nur 3230 bis 4522/min ab, also
  1:1,40 gegen die 1:6 der App; der Faktor `rpmScale` 0,961 zentriert sie geometrisch auf
  den Bereich der App, damit sie an beiden Enden etwa gleich stark klemmt. Ein erster
  Versuch nagelte stattdessen das obere Band an die Drehzahlgrenze und schob damit alles
  nach unten, bis die Schleife am unteren Ende eine Oktave zu tief lief.
  Steht als eigenes Profil neben dem synthetischen Porsche, damit beide vergleichbar sind.
- **Strecken-Ambience** (`amb_bed.ogg`, `amb_pass_0..4.ogg`) — aus
  `fjc_media-sounds-of-nuerburgring-engines-of-classic-race-cars-234929.mp3`.
  Der Teppich ist der Abschnitt mit der geringsten Energieschwankung, die
  Vorbeifahrten sind die mit der hoechsten.
- **Hupen f&uuml;r die Lichthupe** (`horn_car`, `horn_ship`, `horn_donkey`, `horn_goat`,
  `horn_fart`, `horn_fart2`) — aus sechs Pixabay-Aufnahmen, geschnitten von
  `tools/horn_sounds.py`.
  Zwei Entscheidungen dabei, beide gemessen begruendet: geschnitten wird auf das LAUTE
  EREIGNIS und nicht auf die erste Nicht-Stille (die Ziege meckert in der Quelldatei erst
  nach 3,3 s, ein Schnitt auf 2 s Hoechstdauer behielt also nur den Vorlauf und das Meckern
  war weg), und angepasst wird auf gleichen RMS statt gleiche Spitze (bei
  Spitzennormalisierung verschwindet der kurze Furz gegen die durchgehend laute
  Schiffshupe). Ergebnis: alle sechs bei RMS 0,130, Anschlagzeiten 60 bis 648 ms.

  Der sechste, `horn_fart2`, kam mit v0.4 dazu und wurde vom Nutzer geliefert
  (`freesound_community-fart-83471.mp3`, freesound community ueber Pixabay). Dieselbe
  Behandlung. Er ist mit 0,163 s der kuerzeste von allen, und das ist geprueft und kein
  Schnittfehler: die Rohdatei hat 0,24 s Vorlaufstille, und die gesamte Energie liegt
  gemessen zwischen 0,244 und 0,41 s. Der Schnitt enthaelt also 100 Prozent davon - der Ton
  IST so kurz.
- **Regen und Donner** (`rain_bed.ogg`, `thunder_0..2.ogg`) — aus
  `pwlpl-heavy-thunderstorm-sound-effect-473418.mp3`, nach demselben Verfahren.

Die unbearbeiteten Quelldateien sind nicht Teil dieses Repos.

### Boxenstopp-Schleifen (`pit_wrench`, `pit_fuel`, `pit_repair`)

Erzeugt von `tools/pit_sounds.py` (Tanken und Reparatur) bzw. `tools/engine_fx.py`
(Schlagschrauber). Alle drei sind Schleifen, weil sie so lange laufen wie ihre
Aufgabe. Schleifen werden **zirkular** im Frequenzbereich gebaut, sonst klickt die
Naht bei jedem Durchlauf; das Skript gibt den gemessenen Nahtsprung mit aus
(0,74 bzw. 0,25 relativ zum mittleren Schrittbetrag).

Reparatur und Schlagschrauber laufen absichtlich gleichzeitig und wurden deshalb
unterscheidbar angelegt: der Schrauber ist ein schneller, gleichmaessiger
Hammerzug (~26 Hz), die Reparatur wechselt zwischen Klopfen und Ratschenzuegen.

**Die Reparatur klang zweimal nach einem Lied**, und zweimal war die Ursache dieselbe:
jeder Schlag bekam eine gewuerfelte Grundfrequenz zwischen 150 und 240 Hz, und das sind
acht Halbtoene. Zwoelf Schlaege in einer Schleife von 2,4 s, die sich ewig wiederholt,
sind damit eine zwoelftoenige Melodie. Der erste Versuch behandelte das Abklingen - das
nimmt dem EINZELNEN Schlag die Tonhoehe, aber die Melodie steckt zwischen den Schlaegen.

Jetzt schlagen alle Klopfer auf **eine** Grundfrequenz (196 Hz, Streuung 0,18 Halbtoene;
ein Viertelton sind 0,5), weil ein Blechner auf dasselbe Blech schlaegt. Dazu kommen
Ratschenzuege: Transienten von ein bis zwei Millisekunden, die grundsaetzlich keine
Tonhoehe tragen koennen.

Der ausgegebene Pruefwert ist ausdruecklich das **Protokoll des Erzeugers** und keine
Spektralschaetzung. Der Grund ist gemessen: ein Schlag klingt in rund 6 ms ab, ein
Fenster von 40 ms gibt 25-Hz-Koerbe, und bei 196 Hz sind das 2,2 Halbtoene. Ein
Schaetzer, der groeber aufloest als der Effekt, den er messen soll, lieferte 4,16
Halbtoene Streuung fuer Schlaege, die alle auf derselben Frequenz erzeugt wurden.


## Nachpruefbarkeit der synthetischen Motoren

`tools/engine_synth.py` gibt fuer jede der 28 Schleifen vier Messwerte aus, und jeder
einzelne pruefte eine Behauptung, die ohne ihn nur eine Absicht gewesen waere:

- **Zyklus-Verriegelung** — die Schleife ist per Konstruktion ueber ganze 720-Grad-Zyklen
  periodisch, also *muss* alle Spektralenergie auf ganzzahligen Vielfachen von `rpm/120`
  liegen. Trifft bei allen 28 zu. Zwei frueher benutzte Pruefungen waren falsch: "der
  lauteste Peak ist die Zuendfrequenz" (ist er nicht, und muss er nicht sein — welche
  Harmonische gewinnt, haengt an der Impulsschaerfe und daran, wie die Baenke eines V
  verschraenkt zuenden) und eine Autokorrelation der Huellkurve, die schlicht beliebige
  Werte lieferte.
- **Gleichanteil** — bei sechs der 28 Schleifen war der Gleichanteil die *staerkste*
  Spektralkomponente. Er verschenkt Aussteuerung und kann an der Naht ticken. Jetzt 0,000
  ueberall.
- **Kodierdrift** (`dn`, `err`) — Vorbis arbeitet blockweise, und der Browser legt die
  *dekodierte* Laenge in die Schleife. Ueberzaehlige Abtastwerte landen genau am Uebergang.
  Gemessen: `dn = 0` bei allen 28, die Laenge uebersteht den Kodierzyklus also exakt; die
  Wellenformabweichung liegt bei 0,05–0,11 vom Vollausschlag, die normale gehoerangepasste
  Vorbis-Abweichung bei q4.
- **Reproduzierbarkeit** — der Seed kam vorher aus `hash()`, das Python pro Prozess
  zufaellig macht: jeder Lauf erzeugte andere Sounds, und die eingecheckten Dateien waren
  nie reproduzierbar. Jetzt `zlib.crc32` ueber den Namen; zwei Laeufe liefern
  byte-identische WAVs. Die `.ogg` unterscheiden sich trotzdem, weil libvorbis eine
  zufaellige Bitstream-Seriennummer in den Container stempelt — dafuer sind die WAVs in
  `audio-work/` da.

Was **nicht** geprueft ist: wie es klingt. Dass die Zuendstruktur richtig ist, sagt nichts
darueber, ob ein Motor ueberzeugt.
