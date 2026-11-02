# Fahrgefühl: Vorschläge für GT7/ACC-artiges Verhalten

Ziel: Die Autos sollen sich wie in **Gran Turismo 7** oder **Assetto Corsa Competizione** anfühlen – sowohl die echten Autos auf der Bahn (Physik-/Pacejka-Modell) als auch das **Virtuelle Fahren** (`60d-virtuell.js`). Dieser Text ist ein **Vorschlagskatalog** mit konkreten Ansatzpunkten im Code.

## Was GT7/ACC ausmacht

Ein Fahrgefühl, das sich „wie GT7/ACC“ anfühlt, hat meist diese Eigenschaften gemeinsam:

1. **Nachgiebiges, aber präzises Einlenken:** Das Auto dreht zunächst spürbar ein, der Gieraufbau ist nicht sofort, sondern mit einer kleinen Verzögerung (Reifenaufbau, Nachlauf).
2. **Gewichtsverlagerung sichtbar:** Beim Bremsen wird die Front belastet, das Heck entlastet; unter Gas umgekehrt. Das beeinflusst die Haftgrenze.
3. **Reifen arbeiten am Limit:** Kurvenkraft steigt zunächst fast linear, dann mit einem Scheitel; dahinter rutscht das Auto (unter- oder übersteuern). Das Limit ist **fühlbar** – man spürt, wann die Reifen aufgeben.
4. **Kombination Längs/Quer (Reibkreis):** Wer in der Kurve bremst oder Gas gibt, hat weniger Seitenkraft.
5. **Steuerung wird mit Tempo direkter** (weniger Lenkradwinkel nötig), gleichzeitig wird sie bei hohem Tempo **empfindlicher** (Stabilitätsgefühl).
6. **Traktionskontrolle/ABS** wirken als spürbare, aber nicht abrupte Begrenzer.
7. **Abtrieb/Downforce:** Mit Tempo wird die Haftgrenze höher (nicht nur der Luftwiderstand).

---

## Fall 1: Die echten Autos auf der Bahn (`40-physics.js`)

Das Modell ist ein **kinematisches/stationäres Einspurmodell**: Der Lenkbefehl wird über `steerDemand` → Reibkreis → Kalibrierung geformt, und im **Pacejka-Modus** (`pacejkaStep`) wird die **Ausnutzung** je Achse berechnet und der Lenkbefehl am Limit gekürzt (Untersteuern) bzw. ergänzt (Übersteuern). Das eigentliche **Schräglauf-basierte** Kurvenverhalten (Schwimmwinkel, Gierdynamik) ist im Zustand als **Instrument** vorhanden (`yawRate`, `slipAngle`, `alphaFront`, `alphaRear`, `kU`), stellt aber **nicht** die Lenkung – es ist reine Anzeige.

### Vorschlag 1.1 – Aus dem Instrument ein Stellglied machen
Der größte Hebel für „GT7/ACC“ ist, die Gierdynamik wirklich zu **fahren** und nicht nur anzuzeigen. Konkret:

- Die berechneten Größen `yawRate`, `slipAngle`, `alphaFront/Rear`, `latUse` (Instrument, siehe `yawStep`) in die **Lenk-/Tempo-Regelung** zurückführen.
- Statt nur `servoAngle = f(steerDemand)` den **Schwimmwinkel** als Korrektur einzubeziehen: Bei zu großem `slipAngle` das Heck „einziehen“ (Übersteuern abfangen), bei zu großem `alphaFront` den Einschlag begrenzen (Untersteuern).
- Das ergibt ein echtes **Gier-Bewegungsgesetz** wie im virtuellen Modell (`vfDynamik`), statt einer reinen Eingabe-Formung.

### Vorschlag 1.2 – Lastverlagerung stärker an die Haftgrenze koppeln
Heute beeinflusst `loadFront` die Ausnutzung (`vorn`/`hinten`), aber die Kopplung ist weich. Für ACC-Gefühl:

- Die **Gewichtsverlagerung** `dFz = m · ax · h / L` direkt in die Achslasten rechnen (im Pacejka-Modus steht das schon über `loadFront`, aber es wird über `Math.max(0.6, …)` gedeckelt). Deckel lockern, damit Trail-Braking und Lastwechsel **spürbar** werden.
- **Lastempfindlichkeit** (Reibwert sinkt mit Radlast, siehe `lastEmpf` im virtuellen Modell) auch in `pacejkaStep` einführen: So bleibt das Auto unter Last gutmütig, weil die entlastete Achse relativ mehr Griff behält.

### Vorschlag 1.3 – Reibkreis härter, aber stetig
- `uH` nutzt `rest = sqrt(1 − antrieb²)`. Der Antriebsanteil (0,7) ist fest. Für ACC: Antriebsanteil **achsenabhängig** (Heckantrieb 0,7, Frontantrieb weniger) und die Kombination aus Gas **und** Bremse stetiger machen.
- **ABS/Traktionskontrolle** als spürbare Begrenzer: heute teils nur am Reibkreis. Ein `absActive`/`tc`-Eingriff mit leichtem „Rattern“ (Sound/Vibration) macht das Limit fühlbar wie in ACC.

### Vorschlag 1.4 – Steuerungsgefühl mit Tempo
- **Tempoabhängige Lenkübersetzung**: Bei hohem Tempo weniger Lenkwinkel nötig, gleichzeitig feiner. Das gibt das „stabil bei Tempo, wendig bei Tempo“-Gefühl.
- **Selbstzentrierung/Nachlauf**: Ein leichtes Zurückdrehen der Räder (Kingspin-Nachlauf) macht das Lenkrad „lebendig“ – in GT7 sehr präsent. Als sanfte Kraft auf `steerDemand`.

### Vorschlag 1.5 – Abtrieb einbringen
- Wie im virtuellen Modell: `fz += k · v²` (Downforce) auch im Bahn-Modell. Bei hohem Tempo steigt die Haftgrenze, das Auto wird stabiler – ein Kernmerkmal von GT7/ACC-GT3.

### Vorschlag 1.6 – Der Pacejka-Übersteuern-Zuschlag weicher machen
- `st.pacUeber` baut mit `tau = 0.12 s` auf und hält über `pacejkaHaltMax`. Für ACC: den Aufbau **sanfter** (größeres Tau beim Aufbau), den **Halt** an das Gaspedal koppeln (weniger Gas = weniger Halt), und die **Stabilisierung** über einen echten `slipAngle`-Regler statt nur über „Gegenlenken“.
- **Feedback am Limit**: Untersteuern und Übersteuern vibrieren/quietschen bereits; das ist gut. Für ACC noch die **Drehzahl-/Ton-Charakteristik** beim Rutschen (Rad quietscht, Motor dreht hoch) verstärken.

### Vorschlag 1.7 – Kalibrierung und Voreinstellungen
- Die **Voreinstellung Pacejka** ist leicht untersteuernd (`pacejkaHeckReserve = 1,2`). Für ACC eine **„GT3“-Voreinstellung** anbieten, die `pacejkaUebersteuern` an hat, `pacejkaHeckReserve` näher an 1,0 und `lastEmpf` einbezieht – so fühlt sich ein GT3 im Grenzbereich beherrschbar, aber lebendig an.

---

## Fall 2: Das Virtuelle Fahren (`60d-virtuell.js`)

Das virtuelle Modell (`vfDynamik`, `VF_GT3`) ist bereits ein **dynamisches Einspurmodell mit Pacejka-Reifen**, Lastverlagerung, Reibkreis, ABS/TC und Lastempfindlichkeit. Es ist also schon ACC-nah. Die Vorschläge verfeinern es:

### Vorschlag 2.1 – Reifen mit Schräglauf-Kennlinie und Temperatur
- `muV`/`muH` sind fest. Für ACC: **Reifentemperatur** (kalt = weniger Grip, warm = optimal, überhitzt = weniger), wie es die echten GT3 haben. Das gibt einem 3-Runden-Lauf einen **Aufwärm-/Abbauverlauf**.
- **Camber** einbeziehen: Innenrad entlastet, Außenrad trägt. Vereinfacht über einen Camber-Korrekturfaktor auf `mu`.

### Vorschlag 2.2 – Reibkreis mit Antriebsverteilung
- `bremsVorn = 0,75` (75 % vorne) ist fest. Für ACC: **Bremsbalance** (nach hinten verstellbar) und **Antriebsverteilung** (bei AWD) einstellbar. Das verschiebt die Haftgrenze spürbar.
- `antriebMax = 7,0` (Traktion) und `tc = 0,60` – die **Traktionskontrolle** könnte als kurzes, fühlbares „Kapp“ beim Gasgeben wirken (Drehzahl-Sound, leichtes Ruckeln).

### Vorschlag 2.3 – Lastempfindlichkeit und Abtrieb verfeinern
- `lastEmpf = 0,15` ist schon da. Für ACC: **Lastempfindlichkeit pro Achse** (vorne anders als hinten) und **Abtrieb** über `kV`/`kH` bereits vorhanden – als Einstellwerte zugänglich machen, damit ein „GT3 mit Flügel“ anders fährt als ohne.

### Vorschlag 2.4 – Gierdämpfung und Stabilität
- `yawDamp = 1,5` dämpft die Gierrate. Für ACC: **elektronische Stabilitätskontrolle** als optionaler, spürbarer Eingriff (begrenzt die Gierrate sanft), damit das Auto am Limit beherrschbar bleibt, aber nicht „auf Schienen“ fährt.

### Vorschlag 2.5 – Steuerung
- `lenkGrad = 16` (Radeinschlag). Für ACC: **tempoabhängige Lenkübersetzung** und **Nachlauf-Selbstzentrierung**, damit die Vorderräder bei Tempo gerader stehen und beim Loslassen zurückdrehen.

### Vorschlag 2.6 – Fahrbahn-/Wettermodell
- `mu` (Griff-Faktor) wird von außen gesetzt. Für ACC: **Kerb-Verhalten** (über Curbs kurz den Grip verlieren), **Regen** mit Aquaplaning (auch im Virtuellen Fahren) – das ist im Bahn-Modell (`aquaFactor`) schon vorhanden, im Virtuellen noch nicht.

---

## Gemeinsame Punkte (beide Fälle)

1. **Gleiche Reifen-Philosophie:** Beide Modelle sollten dieselbe `Pacejka`-S-Kurve nutzen, nur mit anderen Parametern. So fühlt sich das virtuelle Auto wie das echte an.
2. **Feedback ist entscheidend:** GT7/ACC „fühlen“ sich gut an, weil das Limit hörbar/ spürbar ist (Reifen quietschen, Motor, Vibration). Die vorhandenen Vibrations-/Sound-Meldungen (`pacejkaRueckmeldung`, `80-sound.js`) ausbauen.
3. **Einstellbarkeit:** Die besten ACC-Autos sind **abstimmbar**. Ein paar Regler (Bremsbalance, Traktion, Abtrieb, Reifendruck) machen aus einem Preset ein „Fahrzeug“, das man kennenlernen kann.

## Wo man anfangen sollte (Reihenfolge)

1. **`vfDynamik`** um Reifentemperatur und Camber erweitern (größter „Realismus-Gewinn“ im Virtuellen Fahren).
2. **`pacejkaStep`** um `lastEmpf` (Lastempfindlichkeit) und einen sanfteren Übersteuern-Aufbau erweitern.
3. Beide auf **tempoabhängige Lenkübersetzung + Selbstzentrierung** umstellen.
4. **Abtrieb** (`k · v²`) ins Bahn-Modell bringen.
5. Aus dem **Einspurmodell-Instrument** (Gierdynamik) ein **Stellglied** machen – der Schritt, der das Fahrgefühl am meisten Richtung GT7/ACC verschiebt.
