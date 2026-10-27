#!/usr/bin/env python3
"""Optionaler Browsertest fuer Zeitbereinigung und sofortigen Listen-Refresh.
python -m pip install playwright; python -m playwright install chromium
Die App selbst benoetigt kein Playwright. Keine echten Benutzer-/Fahrzeugdaten.
"""
import argparse
import asyncio
import http.server
import json
from pathlib import Path
import threading
import test_statistik_bereinigung as original

original.HOOK += r"""
  Object.assign(window.__statTest, {
    mirror: c => trackToCode(chSpiegelTiles(codeToTrack(c).tiles), 0),
    times: statCleanZeitenPlan, limit: statCleanGrenze, track: statCleanStreckenKey,
    bz: BESTZEIT_STORE, tele: TELE_STORE, refresh: statCleanAuffrischen,
    rendererFailure: on => { renderSessions = on ? (() => { throw Error('Probe-Darstellung'); }) : window.__statOriginalRenderer; },
    compareReset: () => { teleVergleich = null; },
    en: on => { lang = on ? 'en' : 'de'; }
  });
  window.__statOriginalRenderer = renderSessions;
"""
CORE = r"""async () => {
 const T=__statTest, labels=[], check=(v,n)=>{if(!v)throw Error(n);labels.push(n)}, copy=x=>JSON.parse(JSON.stringify(x));
 const track='SG2RG2R', other='SG3RG3R';
 const car=(id,laps)=>({id,name:id,rolle:id==='a'?'player':'ghost',laps,
   ereignisse:laps.map((_,i)=>({pit:i+1,crash:i})),statistikBuchung:{id,km:1,realKm:.1,runden:laps.length,sitzungen:1}});
 const o={kmV:2,cars:{a:{name:'a',km:3,realKm:.3,runden:5,sitzungen:2,besteMs:2000},
   b:{name:'b',km:1,realKm:.1,runden:2,sitzungen:1,besteMs:4000}},sessions:[
   {zeit:'2026-10-20T12:00:00Z',strecke:track,modus:'laps',simKm:1,realKm:.1,fahrtstil:1,
     autos:[car('a',[2000,5000,6000]),car('b',[4000,8000])]},
   {zeit:'2026-10-21T12:00:00Z',strecke:other,modus:'laps',simKm:2,realKm:.2,autos:[car('a',[3000,9000])]}]};
 const bz={[T.track(track)]:{code:track,fahrer:{a:{name:'a',beste:2000,medaille:3,runden:12,datum:123},
   b:{name:'b',beste:5000,medaille:1,runden:7,datum:124}}},
   [T.track(other)]:{code:other,fahrer:{a:{name:'a',beste:1000,medaille:3,runden:10}}}};
 const spur=ms=>({ms,auto:'a',code:track,n:3,teile:[0,ms/3,ms*2/3],proben:[]});
 const tele={[T.track(track)]:{fahrer:{a:{beste:spur(2000),letzte:spur(5000),fahrt:{id:7,runden:[spur(2000),spur(5000),spur(7000)]}},
   'fremd:x':{beste:spur(1000)}}},[T.track(other)]:{fahrer:{a:{beste:spur(1000)}}}};
 const raw=JSON.stringify(o), br=JSON.stringify(bz), tr=JSON.stringify(tele);
 const p=T.times(o,track,5000,br,tr), b=p.bericht;
 check(b.runden===2&&b.sitzungen===1,'Nur kurze Runden auf gewaehlter Strecke betroffen');
 check(JSON.stringify(p.neu.sessions[0].autos[0].laps)==='[5000,6000]','Grenzwert selbst und laengere Zeiten bleiben');
 check(JSON.stringify(p.neu.sessions[1])===JSON.stringify(o.sessions[1]),'Andere Strecke bleibt byteinhaltlich unveraendert');
 check(p.neu.sessions[0].autos[0].ereignisse[0].pit===2&&p.neu.sessions[0].autos[0].ereignisse[1].pit===3,'Rundenereignisse behalten die korrekte Zuordnung');
 check(p.neu.sessions[0].autos[0].statistikBuchung.runden===2,'Rundenbuchung nach Teilbereinigung konsistent');
 check(p.neu.cars.a.runden===4&&p.neu.cars.b.runden===1&&p.neu.cars.a.sitzungen===2,'Rundensummen korrigiert, Sitzungsanzahl erhalten');
 check(p.neu.cars.a.km===3&&p.neu.cars.a.realKm===.3&&p.neu.sessions[0].simKm===1,'Alle gefahrenen Kilometer bleiben erhalten');
 check(p.neu.cars.a.besteMs===3000&&p.neu.cars.b.besteMs===8000,'Fahrzeugrekord aus vollstaendiger Resthistorie aktualisiert');
 check(JSON.stringify(o)===raw,'Planberechnung veraendert niemals die Originaldaten');
 const bp=JSON.parse(p.extra[T.bz].nachher), tp=JSON.parse(p.extra[T.tele].nachher);
 check(b.rekorde===1&&bp[T.track(track)].fahrer.a.beste===null&&bp[T.track(track)].fahrer.a.medaille===0,'Kurzer Time-Attack-Rekord samt Medaille zurueckgesetzt');
 check(bp[T.track(track)].fahrer.a.runden===12&&bp[T.track(track)].fahrer.b.beste===5000,'Bestzeit-Zaehler und gueltiger Rekord bleiben erhalten');
 check(bp[T.track(other)].fahrer.a.beste===1000,'Rekord anderer Strecke bleibt erhalten');
 check(b.spuren===2&&!tp[T.track(track)].fahrer.a.beste&&tp[T.track(track)].fahrer.a.fahrt.runden.length===2,'Kurze lokale Telemetriespuren entfernt');
 check(tp[T.track(track)].fahrer['fremd:x'].beste.ms===1000,'Fremde Online-Telemetrie unangetastet');
 check(tp[T.track(other)].fahrer.a.beste.ms===1000,'Telemetrie anderer Strecke unangetastet');
 check(T.limit('5,25')===5250&&T.limit(' 5.25 ')===5250,'Dezimalkomma und Dezimalpunkt unterstuetzt');
 for(const v of ['',0,-1,'NaN','Infinity','abc','1e3']){let err=false;try{T.limit(v)}catch(e){err=true}check(err,'Ungueltiger Grenzwert abgelehnt: '+v)}
 const allShort=copy(tele);allShort[T.track(track)].fahrer.a.letzte=allShort[T.track(track)].fahrer.a.beste;
 const shortPlan=T.times(o,track,5000,br,JSON.stringify(allShort));
 check(!JSON.parse(shortPlan.extra[T.tele].nachher)[T.track(track)].fahrer.a.letzte,'Auch ungueltige letzte Telemetrierunde geloescht');
 const old=copy(o);old.cars.a.sitzungen=300;
 check(T.times(old,track,5000,br,tr).neu.cars.a.besteMs===null,'Unvollstaendige Lebenszeit-Historie erfindet keine zweitbeste Zeit');
 const full=copy(o);full.sessions[0].autos[0].laps=[2000];full.sessions[0].autos[0].ereignisse=[{pit:1}];
 check(T.times(full,track,5000,br,tr).neu.sessions[0].autos[0].laps.length===0,'Sitzung ohne verbleibende Runde bleibt erhalten');
 const broken=copy(o);broken.sessions[0].autos[0].laps=[0,-5,5000];
 check(JSON.stringify(T.times(broken,track,5000,br,tr).neu.sessions[0].autos[0].laps)==='[5000]','Auch Null- und negative Fehlzeiten unter Grenzwert entfernt');
 const empty=T.times(o,track,1,br,tr);
 check(empty.bericht.runden===0&&empty.bericht.rekorde===0&&empty.bericht.spuren===0,'Leere Treffermenge ohne Datenverlust');
 check(T.track(track+'@90')===T.track(track),'Drehung des gleichen Layouts wird korrekt zugeordnet');
 const mirror=T.mirror(track);
 check(T.track(mirror)===T.track(track),'Gespiegeltes Layout folgt existierender Bestzeit-Zuordnung');
 await T.resetDb();
 for(const key of [T.store,T.bz,T.tele])localStorage.removeItem(key);
 localStorage.setItem(T.store,raw);localStorage.setItem(T.bz,br);localStorage.setItem(T.tele,tr);
 T.race('idle');await T.apply(raw,p,'Testzeiten');
 check((await T.backup()).version===2&&Object.keys((await T.backup()).extra).length===2,'Sicherung enthaelt alle drei betroffenen Ablagen');
 check(localStorage.getItem(T.bz)===p.extra[T.bz].nachher&&localStorage.getItem(T.tele)===p.extra[T.tele].nachher,'Alle Zeitablagen angewendet');
 let stale=false;try{await T.apply(raw,p,'stale')}catch(e){stale=true}check(stale,'Veralteter Sitzungsplan gesperrt');
 localStorage.setItem(T.store,raw);localStorage.setItem(T.bz,br);localStorage.setItem(T.tele,tr+' ');
 stale=false;try{await T.apply(raw,p,'stale')}catch(e){stale=true}check(stale,'Veraltete Telemetrie-Vorschau gesperrt');
 localStorage.setItem(T.tele,tr);localStorage.setItem(T.bz,br+' ');
 stale=false;try{await T.apply(raw,p,'stale')}catch(e){stale=true}check(stale,'Veraltete Bestzeit-Vorschau gesperrt');
 localStorage.setItem(T.bz,br);
 const set=Storage.prototype.setItem;
 try{Storage.prototype.setItem=function(k,v){if(k===T.tele&&v===p.extra[T.tele].nachher)throw Error('Quota');return set.call(this,k,v)};
   let fail=false;try{await T.apply(raw,p,'quota')}catch(e){fail=true}
   check(fail&&localStorage.getItem(T.store)===raw&&localStorage.getItem(T.bz)===br&&localStorage.getItem(T.tele)===tr,'Teilschreibfehler setzt alle drei Ablagen zurueck');
 }finally{Storage.prototype.setItem=set}
 check((await T.backup())!==null,'Sicherung bleibt nach Speicherfehler verfuegbar');
 T.race('racing');let running=false;try{await T.apply(raw,p,'running')}catch(e){running=true}check(running,'Zeitbereinigung waehrend Rennen gesperrt');T.race('idle');
 return {labels,o,bz,tele,track,other};
}"""

async def run(args):
    from playwright.async_api import async_playwright
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),original.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    async with async_playwright() as pw:
        opts={'headless':True,'args':['--no-sandbox']}
        if args.browser:opts['executable_path']=args.browser
        browser=await pw.chromium.launch(**opts)
        context=await browser.new_context(accept_downloads=True,viewport={'width':1100,'height':900})
        page=await context.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:','data:','blob:')) else route.abort())
        await page.goto(f'http://127.0.0.1:{server.server_port}/__stat_test.html',wait_until='load')
        await page.wait_for_function('window.__omegaFertig === true')
        fixture=await page.evaluate(CORE);labels=fixture.pop('labels')
        async def check(v,label):
            if not v:raise AssertionError(label)
            labels.append(label)
        async def seed():
            await page.evaluate('async f=>{const T=__statTest;await T.resetDb();localStorage.setItem(T.store,JSON.stringify(f.o));localStorage.setItem(T.bz,JSON.stringify(f.bz));localStorage.setItem(T.tele,JSON.stringify(f.tele));localStorage.removeItem(T.backupKey);T.race("idle");T.open();document.querySelector(".stat-clean").open=true;}',fixture)
        async def click(which,accept=True):
            async def dialog(d):
                if accept:await d.accept()
                else:await d.dismiss()
            if which=='undo':await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
            page.on('dialog',dialog)
            try:
                await page.locator('#stat-clean-'+which).click()
                await page.wait_for_function('!__statTest.busy()')
            finally:
                page.remove_listener('dialog',dialog)
        async def times():
            await page.locator('#stat-clean-track').select_option(await page.evaluate('f=>__statTest.track(f.track)',fixture))
            await page.locator('#stat-clean-seconds').fill('5')
        await seed(); await times()
        await check(not await page.locator('#stat-clean-times-delete').is_disabled(),'Zeitvorschau schaltet Loeschen frei')
        await check(await page.locator('#stat-clean-times-list li').count()==5,'Vorschau zeigt alle betroffenen Runden-/Rekord-/Telemetriegruppen')
        await click('times-delete',False)
        await check(await page.evaluate('__statTest.read().sessions[0].autos[0].laps.length')==3,'Abbrechen der Zeitloeschung erhaelt alle Daten')
        await page.locator('#stat-clean-times-hits').evaluate('(el)=>el.open=true')
        await click('times-delete')
        await check(await page.locator('#stat-clean-track').input_value()==await page.evaluate('f=>__statTest.track(f.track)',fixture) and await page.locator('#stat-clean-times-delete').is_disabled(),'Streckenauswahl erhalten, neue Vorschau ohne Treffer und Loeschen gesperrt')
        await check('3 Runde(n)' in await page.locator('#stat-clean-session option[value="0"]').text_content(),'Sitzungs-Auswahl liest neuen Datenstand')
        await check(await page.locator('#stat-clean-times-list li').count()==0,'Trefferliste unmittelbar nach Klick leer, ohne weitere Auswahl oder F5')
        await check(await page.locator('#stat-clean-seconds').input_value()=='5','Grenzwert bleibt nach Loeschung erhalten')
        await check(await page.locator('#stat-clean-times-hits').evaluate('(el)=>el.open'),'Offene Trefferansicht bleibt offen')
        await check('0 Runde(n)' in await page.locator('#stat-clean-times-preview').text_content(),'Aktuelle Vorschau zeigt sofort null Runden')
        await check('Zeiten gelöscht: 2 Runde(n), 1 Bestzeit-Rekord(e), 2 Telemetrie-Einträge.' in await page.locator('#stat-clean-status').text_content(),'Erfolgsmeldung nennt tatsaechlichen Loeschumfang')
        await check('Gespeichert:' in await page.locator('#stat-clean-refresh-info').text_content(),'Neuer UI-Stand im Menue erkennbar')

        await check('beste 5.00s' in await page.locator('#sess-list').text_content(),'Liste in Renneinstellungen sofort mit gueltiger Bestzeit aktualisiert')
        await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
        await check(await page.locator('#stat-clean-undo').is_enabled(),'Undo nach Zeitbereinigung sofort verfuegbar')
        await times()
        await check(await page.locator('#stat-clean-times-delete').is_disabled(),'Gleiche Vorschau nach Loeschung hat keine Treffer mehr')
        async with page.expect_download() as info:await page.locator('#stat-clean-backup').click()
        download=await info.value;envelope=json.loads(Path(await download.path()).read_text())
        await check(set(envelope['ablagen'])=={'chc.sessions.v1','omegasim-bestzeiten','omegasim-telemetrie'},'JSON-Sicherung enthaelt Sitzungen, Bestzeiten und Telemetrie')
        await page.reload(wait_until='load');await page.evaluate('__statTest.open();document.querySelector(".stat-clean").open=true')
        await click('undo')
        await check(await page.evaluate('f=>localStorage.getItem(__statTest.store)===JSON.stringify(f.o)&&localStorage.getItem(__statTest.bz)===JSON.stringify(f.bz)&&localStorage.getItem(__statTest.tele)===JSON.stringify(f.tele)',fixture),'Undo nach Neuladen stellt alle drei Ablagen exakt wieder her')
        await times();await click('times-delete');await click('undo')
        await check(await page.locator('#stat-clean-times-list li').count()==5 and await page.locator('#stat-clean-times-delete').is_enabled(),'Undo berechnet Trefferliste sofort neu bei erhaltener Strecke')
        await check('rückgängig gemacht' in await page.locator('#stat-clean-status').text_content(),'Undo bestaetigt sichtbare Wiederherstellung')
        await times();await click('times-delete')
        result=await page.evaluate('b=>__statTest.importBackup(b)',envelope)
        await check(result.get('nAblagen')==3,'Vorhandener JSON-Import stellt alle drei Ablagen wieder her')
        await seed();await times();await click('times-delete')
        await page.evaluate('localStorage.setItem(__statTest.bz,localStorage.getItem(__statTest.bz)+" ")')
        await page.locator('#stat-clean-undo').click()
        await page.wait_for_function('!__statTest.busy()')
        await check('geändert' in await page.locator('#stat-clean-status').text_content(),'Undo nach Bestzeit-Aenderung blockiert statt neue Daten zu ueberschreiben')
        await seed();await times();await click('times-delete')
        await page.evaluate('localStorage.setItem(__statTest.tele,localStorage.getItem(__statTest.tele)+" ")')
        await page.locator('#stat-clean-undo').click()
        await page.wait_for_function('!__statTest.busy()')
        await check('geändert' in await page.locator('#stat-clean-status').text_content(),'Undo nach Telemetrie-Aenderung blockiert')
        await seed();await page.locator('#stat-clean-session').select_option('0');await click('session-delete')
        await check(await page.locator('#stat-clean-session option').count()==2 and await page.locator('#stat-clean-session-delete').is_disabled(),'Sitzungsloeschung aktualisiert Liste und Button sofort')
        await check(await page.locator('#stat-clean-car option').count()==2,'Sitzungsloeschung entfernt Null-Summe ohne weitere Daten, Lebenszeiteintrag bleibt')
        await seed();await page.locator('#stat-clean-car').select_option('0');await click('car-delete')
        await check(await page.locator('#stat-clean-car option').count()==2 and await page.locator('#stat-clean-car-delete').is_disabled(),'Autoloeschung aktualisiert Liste und Button sofort')
        await seed();await page.locator('#stat-clean-session').select_option('0')
        await page.evaluate('__statTest.rendererFailure(true)');await click('session-delete')
        await check(await page.locator('#stat-clean-session option').count()==2,'Auswahlliste erneuert sich selbst bei Fehler einer anderen Darstellung')
        await check('Anzeige nicht vollständig aktualisiert:' in await page.locator('#stat-clean-status').text_content(),'Darstellungsfehler wird sichtbar statt nur im Log gemeldet')
        await page.evaluate('__statTest.rendererFailure(false)')
        await seed();await times();await page.locator('#stat-clean-seconds').fill('-2')
        await check(await page.locator('#stat-clean-times-delete').is_disabled(),'Ungueltiger Grenzwert deaktiviert UI-Loeschen')
        await page.locator('#stat-clean-seconds').fill('0,5')
        await check(await page.locator('#stat-clean-times-delete').is_disabled(),'Dezimalkomma und leere Treffermenge im UI korrekt')
        await seed();await page.evaluate('__statTest.en(true);__statTest.draw()');await times()
        await check('seconds' in await page.locator('#stat-clean-times-preview').text_content(),'Englische UI fuer Zeitvorschau verfuegbar')
        await page.evaluate('__statTest.en(false)');await seed();await times()
        await page.locator('#stat-clean-seconds').fill('5,25')
        await click('times-delete')
        await check(await page.locator('#stat-clean-seconds').input_value()=='5,25','Eigener Grenzwert inklusive Dezimalkomma bleibt nach Loeschung erhalten')
        await check(await page.locator('#stat-clean-times-list li').count()==0,'Dezimalgrenze sofort neu ausgewertet')
        await page.locator('#stat-clean-refresh').click()
        await check(await page.locator('#stat-clean-times-list li').count()==0 and await page.locator('#stat-clean-seconds').input_value()=='5,25','Manuelles Aktualisieren bewahrt Auswahl und erstellt frische Vorschau')
        await click('undo')
        await check(await page.locator('#stat-clean-times-delete').is_enabled(),'Undo ermittelt wieder Loeschkandidaten ohne Auswahlwechsel')
        await times();await click('times-delete')
        await page.reload(wait_until='load')
        await page.evaluate('__statTest.open();document.querySelector(".stat-clean").open=true')
        await times()
        await check(await page.locator('#stat-clean-times-list li').count()==0 and await page.locator('#stat-clean-times-delete').is_disabled(),'Nach F5 und erneuter Abfrage bleiben kurze Zeiten geloescht')
        await seed();await times()

        await seed();await times()
        await page.evaluate('()=>{const T=__statTest,o=T.read();o.sessions[0].autos[0].laps=[7000,8000];localStorage.setItem(T.store,JSON.stringify(o));}')
        await click('times-delete')
        await check('geändert' in await page.locator('#stat-clean-status').text_content(),'Veraltete Auswahl nach Speicherwechsel verhindert Loeschen')
        await page.locator('#stat-clean-refresh').click()
        await check(await page.locator('#stat-clean-times-list li').count()==4,'Aktualisierung liest geaenderten Speicher statt alten Vorschau-Abschluss')
        await click('times-delete')
        await check(await page.locator('#stat-clean-times-list li').count()==0,'Nach manuellem Refresh arbeitet Loeschknopf mit frischem Datenstand')
        await seed();await times()
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('#stat-clean-times-hits').evaluate('(el)=>el.open=true')
        await check(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'),'Mobile Ansicht ohne horizontalen Seitenueberlauf')
        await page.locator('#stat-clean-times-delete').scroll_into_view_if_needed()
        if args.screenshot:
            await page.screenshot(path=args.screenshot)
        await click('times-delete')
        await click('undo')
        await check(await page.evaluate('__statTest.read().sessions[0].autos[0].laps.length')==3,'Mobile Loeschen- und Undo-Knoepfe bedienbar')
        await check(not errors,'Keine JavaScript-Lade- oder Laufzeitfehler')
        for label in labels:print('OK:',label)
        print(f'BESTANDEN: {len(labels)} neue Zeit-/Refresh-Pruefungen.')
        if args.report:Path(args.report).write_text(json.dumps({'checks':labels,'pageerrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
        await context.close();await browser.close()
    server.shutdown()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--browser');parser.add_argument('--report');parser.add_argument('--screenshot')
    args=parser.parse_args()
    try:asyncio.run(run(args))
    except ModuleNotFoundError as e:
        raise SystemExit('Optionaler Browsertest: Playwright fehlt. Die App funktioniert ohne Playwright.') from e
