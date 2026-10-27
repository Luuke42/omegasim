#!/usr/bin/env python3
"""Optional: IndexedDB-Sicherung, echter LocalStorage-Quota-Fall und Listenfilter.
Nur isoliertes Testprofil. Die App selbst braucht kein Playwright.
"""
import argparse
import asyncio
import http.server
import json
from pathlib import Path
import threading
import test_statistik_zeiten as times
import test_statistik_bereinigung as original

original.HOOK += r"""
  Object.assign(window.__statTest, {
    dbTx: statCleanDbTransaktion,
    setBackupDelay: ms => {
      statCleanSichern = async (...args) => {
        const b = await window.__statOriginalBackup(...args);
        if (ms) await new Promise(resolve => setTimeout(resolve, ms));
        return b;
      };
    }
  });
  window.__statOriginalBackup = statCleanSichern;
"""
CORE = r"""async () => {
 const T=__statTest, labels=[], check=(v,n)=>{if(!v)throw Error(n);labels.push(n)};
 const code='SG2RG2R', empty='SG3RG3R', foreign='SG4RG4R', key=T.track(code);
 const car=(laps,id='a')=>({id,name:id,rolle:'player',laps,statistikBuchung:{id,km:1,realKm:.01,runden:laps.length,sitzungen:1}});
 const data={kmV:2,cars:{a:{name:'a',km:1,realKm:.01,runden:2,sitzungen:1,besteMs:1000},
   zero:{name:'Nur Name',km:0,realKm:0,runden:0,sitzungen:0,besteMs:null},
   historic:{name:'Nur alte Kilometer',km:9,realKm:0,runden:0,sitzungen:0,besteMs:null}},
   sessions:[{zeit:'2026-10-24',modus:'laps',simKm:1,realKm:.01,strecke:code,autos:[car([1000,2000])]},
    {zeit:'2026-10-23',modus:'practice',simKm:0,realKm:0,strecke:empty,autos:[]}]};
 const raw=JSON.stringify(data), br=JSON.stringify({[key]:{fahrer:{a:{beste:1000,name:'a'}}},[empty]:{fahrer:{a:{beste:null,medaille:0}}}}),
   tr=JSON.stringify({[key]:{fahrer:{a:{beste:{ms:1000},letzte:{ms:2000},fahrt:{runden:[{ms:1000}]}}}},
    [empty]:{fahrer:{a:{fahrt:{runden:[]}}}},[foreign]:{fahrer:{'fremd:x':{beste:{ms:1000}}}}});
 async function reset(){await T.resetDb();localStorage.clear();T.race('idle');localStorage.setItem(T.store,raw);localStorage.setItem(T.bz,br);localStorage.setItem(T.tele,tr);}
 await reset();
 let p=T.times(data,code,5000,br,tr);
 check(!T.carsWithData(data).has('zero'),'Null-Summe ohne Sitzung wird ausgeblendet');
 check(T.carsWithData(data).has('historic'),'Echte alte Kilometer ohne Sitzung bleiben sichtbar');
 check(T.carsWithData({...data,sessions:[{autos:[{name:'Training',id:'train',laps:[]}]}]}).has('train'),'Trainingssitzung ohne Runde bleibt echte Fahrzeugstatistik');
 const set=Storage.prototype.setItem;
 let writes=0;
 Storage.prototype.setItem=function(k,v){if(k===T.backupKey){writes++;throw new DOMException('legacy quota','QuotaExceededError');}return set.call(this,k,v)};
 try{await T.apply(raw,p,'kein LocalStorage-Undo')}finally{Storage.prototype.setItem=set}
 check(writes===0,'Keine Undo-Schreibversuche im LocalStorage');
 check(localStorage.getItem(T.backupKey)===null,'Kein grosser neuer LocalStorage-Undo-Eintrag');
 check((await T.backup()).ablage==='current','Sicherung dauerhaft als IndexedDB-current gespeichert');
 check((await T.backup()).vorher===raw,'IndexedDB enthaelt Original inklusive Kilometer');
 check((await T.backup()).extra[T.tele].vorher===tr,'IndexedDB sichert Telemetrie mit');
 await T.undo();check(localStorage.getItem(T.store)===raw&&localStorage.getItem(T.bz)===br&&localStorage.getItem(T.tele)===tr,'Undo stellt alle drei Ablagen exakt wieder her');
 check(await T.backup()===null,'Erfolgreiches Undo entfernt verbrauchten Marker');
 // Alten Undo-Stand vor Verlust schuetzen, auch wenn neue Bereinigung scheitert.
 await reset();await T.apply(raw,p,'erste Bereinigung');
 const first=await T.backup(), cleaned=localStorage.getItem(T.store);
 const second=T.plan(T.read(),'sitzung',0), put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(v,k){if(k==='pending')throw new DOMException('disk full','QuotaExceededError');return put.call(this,v,k)};
 let failed=false;try{await T.apply(cleaned,second,'fehlende Sicherung')}catch(e){failed=true}finally{IDBObjectStore.prototype.put=put}
 check(failed&&localStorage.getItem(T.store)===cleaned,'Fehlende IndexedDB-Sicherung verhindert Loeschen');
 check((await T.backup()).token===first.token,'Fehlgeschlagene neue Sicherung behaelt altes Undo');
 Storage.prototype.setItem=function(k,v){if(k===T.store)throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)};
 failed=false;try{await T.apply(cleaned,second,'Schreibfehler')}catch(e){failed=true}finally{Storage.prototype.setItem=set}
 check(failed&&localStorage.getItem(T.store)===cleaned,'Statistik-Schreibfehler behaelt aktuellen Datenstand');
 check((await T.backup()).token===first.token,'Fehlgeschlagene Bereinigung ersetzt vorhandenes Undo nicht');
 // Migration aus der bisherigen App.
 await reset();const legacy={typ:'omegasim-statistik-sicherung',version:2,erstellt:'2026-10-24T12:00:00Z',aktion:'alt',vorher:raw,nachher:JSON.stringify(p.neu),extra:p.extra};
 localStorage.setItem(T.backupKey,JSON.stringify(legacy));
 IDBObjectStore.prototype.put=function(){throw new DOMException('disk full','QuotaExceededError')};
 failed=false;try{await T.backup()}catch(e){failed=true}finally{IDBObjectStore.prototype.put=put}
 check(failed&&localStorage.getItem(T.backupKey)===JSON.stringify(legacy),'Fehlgeschlagene Migration bewahrt alte LocalStorage-Sicherung');
 const migrated=await T.backup();
 check(migrated.ablage==='legacy'&&migrated.vorher===raw,'Vorhandene Sicherung korrekt nach IndexedDB migriert');
 check(localStorage.getItem(T.backupKey)===null,'Alten LocalStorage-Platz erst nach Migration freigegeben');
 localStorage.setItem(T.store,legacy.nachher);localStorage.setItem(T.bz,p.extra[T.bz].nachher);localStorage.setItem(T.tele,p.extra[T.tele].nachher);
 await T.undo();check(localStorage.getItem(T.store)===raw,'Migriertes Undo funktioniert');
 // Wirklicher voller LocalStorage, nicht nur ein simuliertes setItem.
 await reset();let quota=false,bytes=0;
 for(let i=0;i<100;i++){try{const block='X'.repeat(128*1024);localStorage.setItem('quota-probe-'+i,block);bytes+=block.length;}catch(e){quota=e.name==='QuotaExceededError';break}}
 check(quota&&bytes>1024*1024,'Echter Browser-LocalStorage bis Quota gefuellt');
 await T.apply(raw,p,'echtes Speicherlimit');
 check(T.read().sessions[0].autos[0].laps.length===0,'Zeitbereinigung trotz echtem LocalStorage-Limit erfolgreich');
 check((await T.backup()).vorher===raw,'Grosse Undo-Sicherung ausserhalb des vollen LocalStorage');
 await T.undo();check(localStorage.getItem(T.store)===raw,'Undo funktioniert beim echten LocalStorage-Limit');
 check(localStorage.getItem('quota-probe-0')!==null,'Andere lokale Daten werden nicht geloescht');
 // Abschlussschreibfehler: neue Sicherung bleibt als pending nutzbar.
 await reset();IDBObjectStore.prototype.put=function(v,k){if(k==='current')throw new DOMException('commit fail','QuotaExceededError');return put.call(this,v,k)};
 try{await T.apply(raw,p,'Abschlussfehler')}finally{IDBObjectStore.prototype.put=put}
 check((await T.backup()).ablage==='pending','Bei Abschlussfehler bleibt neue Sicherung exportierbar');
 check(T.read().sessions[0].autos[0].laps.length===0,'Erfolgreiche Datenbereinigung wird bei Markerfehler nicht falsch als fehlgeschlagen dargestellt');
 await T.undo();check(localStorage.getItem(T.store)===raw,'Offener Sicherungsstand kann rueckgaengig gemacht werden');
 // Zwischen asynchroner Sicherung und Loeschen gestartetes Rennen.
 await reset();T.setBackupDelay(150);
 const operation=T.apply(raw,p,'Fahrt startet');setTimeout(()=>T.race('racing'),50);
 failed=false;try{await operation}catch(e){failed=true}finally{T.race('idle');T.setBackupDelay(0)}
 check(failed&&localStorage.getItem(T.store)===raw,'Erneute Sperrpruefung nach asynchroner Sicherung schuetzt gestartete Fahrt');
 check(!T.busy(),'Fehler gibt die Bedienung wieder frei');
 await reset();return {labels,fixture:{data,raw,br,tr,key,code,empty,foreign}};
}"""

async def run(args):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),original.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(**({'executable_path':args.browser} if args.browser else {}),args=['--no-sandbox'])
        context=await browser.new_context(accept_downloads=True, service_workers="block")
        page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:d.accept())
        await page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'data:', 'blob:')) else route.abort())
        await page.goto(f'http://127.0.0.1:{server.server_port}/__stat_test.html')
        await page.wait_for_function('window.__omegaFertig===true')
        result=await page.evaluate(CORE);labels=result['labels'];fixture=result['fixture']
        async def check(v,label):
            if not v:raise AssertionError(label)
            labels.append(label)
        async def seed():
            await page.evaluate('async f=>{const T=__statTest;await T.resetDb();localStorage.clear();localStorage.setItem(T.store,f.raw);localStorage.setItem(T.bz,f.br);localStorage.setItem(T.tele,f.tr);T.open();document.querySelector(".stat-clean").open=true}',fixture)
        await seed()
        await check(await page.locator('#stat-clean-car option').count()==3,'Autoauswahl nur zwei echte Dateneintraege plus Platzhalter')
        await check(await page.locator('#stat-clean-track option').count()==2,'Streckenauswahl nur Zeitdaten, keine leeren oder ausschliesslich fremden Eintraege')
        await check(await page.locator('#stat-clean-info').count()==1,'Erklaerung zur Sicherung hinter dem i im Kreis')
        await check('Nur Name' not in await page.locator('#stat-inhalt').text_content(),'Leere Autos auch aus Statistik-Tabelle ausgeblendet')
        await check('Nur Name' not in await page.locator('#sess-list').text_content(),'Leere Fahrzeug-Summen auch in Renneinstellungen ausgeblendet')
        await page.locator('#stat-clean-track').select_option(fixture['key']);await page.locator('#stat-clean-seconds').fill('5')
        await page.evaluate('__statTest.setBackupDelay(250)')
        await page.locator('#stat-clean-times-delete').click()
        await check(await page.locator('#stat-clean-times-delete').is_disabled(),'Loeschknopf waehrend Sicherung gegen Doppelklick gesperrt')
        await page.wait_for_function('!__statTest.busy()');await page.evaluate('__statTest.setBackupDelay(0)')
        await check(await page.locator('#stat-clean-track option').count()==1,'Letzte Zeit geloescht: Strecke sofort aus Auswahl entfernt')
        await check('keine gespeicherten Zeiten' in await page.locator('#stat-clean-times-preview').text_content(),'Verschwundene Strecke wird sichtbar erklaert')
        await check('Zeiten gelöscht:' in await page.locator('#stat-clean-status').text_content(),'Erfolg trotz verschwundener Strecke sichtbar bestaetigt')
        await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
        await page.locator('#stat-clean-undo').click();await page.wait_for_function('!__statTest.busy()')
        await check(await page.locator('#stat-clean-track option').count()==2,'Undo bringt Strecke mit Zeitdaten sofort zurueck')
        await page.locator('#stat-clean-car').select_option('0');await page.locator('#stat-clean-car-delete').click();await page.wait_for_function('!__statTest.busy()')
        await check(await page.locator('#stat-clean-car option').count()==2,'Geloeschtes Auto sofort aus Auswahl entfernt, alte Kilometer bleiben')
        await page.reload(wait_until='load');await page.wait_for_function('typeof __statTest!=="undefined"');await page.evaluate('__statTest.open();document.querySelector(".stat-clean").open=true')
        await check(await page.locator('#stat-clean-car option').count()==2,'Autofilter bleibt nach F5 korrekt')
        await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
        async with page.expect_download() as d:await page.locator('#stat-clean-backup').click()
        downloaded=json.loads(Path(await (await d.value).path()).read_text())
        await check('chc.sessions.v1' in downloaded['ablagen'],'JSON-Export liest IndexedDB-Sicherung nach F5')
        await page.locator('#stat-clean-undo').click();await page.wait_for_function('!__statTest.busy()')
        await check(await page.locator('#stat-clean-car option').count()==3,'Auto-Undo nach F5 bringt Auswahl zurueck')
        # Noch einmal echter Quota-Fall mit UI-Klick, Reload und Rueckgaengig.
        await seed()
        await page.evaluate('()=>{for(let i=0;i<100;i++){try{localStorage.setItem("ui-quota-"+i,"Y".repeat(128*1024))}catch(e){if(e.name!=="QuotaExceededError")throw e;break}}}')
        await page.locator('#stat-clean-track').select_option(fixture['key']);await page.locator('#stat-clean-times-delete').click()
        await page.wait_for_function('!__statTest.busy()')
        await check('Zeiten gelöscht:' in await page.locator('#stat-clean-status').text_content(),'UI-Loeschen bei echtem Speicherlimit bestaetigt Erfolg')
        await page.reload(wait_until='load');await page.wait_for_function('typeof __statTest!=="undefined"');await page.evaluate('__statTest.open();document.querySelector(".stat-clean").open=true')
        await check(await page.locator('#stat-clean-track option').count()==1,'Zeitfilter bleibt nach F5 beim echten Quota-Fall korrekt')
        await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
        await page.locator('#stat-clean-undo').click();await page.wait_for_function('!__statTest.busy()')
        await check(await page.locator('#stat-clean-track option').count()==2,'UI-Undo nach F5 auch bei gefuelltem LocalStorage erfolgreich')
        await check(not errors,'Keine JavaScript-Lade- oder Laufzeitfehler')
        if args.screenshot:
            await page.set_viewport_size({'width':390,'height':844})
            await page.locator('#stat-clean-refresh-info').scroll_into_view_if_needed()
            await page.screenshot(path=args.screenshot)
        if args.report:Path(args.report).write_text(json.dumps({'checks':labels,'pageerrors':errors},ensure_ascii=False,indent=2))
        print('\n'.join('OK: '+n for n in labels));print(f'BESTANDEN: {len(labels)} Speicher- und Listenpruefungen.')
        await context.close();await browser.close()
    server.shutdown()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--browser');parser.add_argument('--report');parser.add_argument('--screenshot')
    asyncio.run(run(parser.parse_args()))
