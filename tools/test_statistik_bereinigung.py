#!/usr/bin/env python3
"""Optionale Browser-Regressionspruefung; keine Voraussetzung fuer die App.
Python: pip install playwright; Browser: python -m playwright install chromium
Alternativ --browser <Pfad zu Chrome>. Alle Daten in einem frischen Testprofil.
"""
import argparse
import asyncio
import functools
import http.server
import json
from pathlib import Path
import threading

ROOT = Path(__file__).resolve().parents[1]
HOOK = r"""
  window.__statTest = {
    plan: statCleanPlan, key: statCleanAutoKey, apply: statCleanAnwenden, escape: statCleanEsc,
    undo: statCleanUndo, backup: statCleanBackupLesen,
    store: SESSION_STORE, backupKey: STAT_CLEAN_BACKUP, dbName: STAT_CLEAN_DB,
    resetDb: () => statCleanDbTransaktion('readwrite', (s, done) => { s.clear(); done(true); }),
    busy: () => statCleanBusy,
    carsWithData: statCleanAutos,

    draw: statZeichnen, data: statDaten, csv: sessionCsv,
    save: sessionSave, read: sessionStore,
    race: (s) => { raceState = s; },
    open: () => { showTab('options'); showSubpage('opt-stats'); },
    tests: ST_TESTS,
    importBackup: sicherungAnwenden,
    recordProbe: () => {
      const oldCars = garage.slice(), oldAll = raceAllCars, oldSim = simMeters, oldReal = realMeters;
      const c = { name: 'Probe', id: 'probe', role: 'player', laps: [{ ms: 10000 }], kennung: 'Probe' };
      try {
        garage.splice(0, garage.length, { device: { id: 'probe' } });
        raceAllCars = () => [c]; simMeters = 1000; realMeters = 10;
        const s = sessionRecord(); return { s, o: sessionStore() };
      } finally {
        garage.splice(0, garage.length, ...oldCars); raceAllCars = oldAll;
        simMeters = oldSim; realMeters = oldReal;
      }
    }
  };
"""
CORE = r"""async () => {
 const T = window.__statTest, checks = [];
 const check = (v,n) => { if (!v) throw Error(n); checks.push(n); };
 const clone = x => JSON.parse(JSON.stringify(x));
 const c = (name, laps, id, rolle='player') => ({ name, laps, id, rolle, ereignisse: [{ pit: 1 }] });
 const booked = (name, laps, id, km, realKm, rolle='player') =>
   Object.assign(c(name,laps,id,rolle), { statistikBuchung: { id, km, realKm, runden: laps.length, sitzungen: 1 } });
 const s = (autos, zeit='2026-10-20T12:00:00Z') => ({ zeit, modus: 'laps', strecke:'SGLGLGL',
   autos, simKm: 10, realKm: .1, fahrstil: { wert: 2 }, strafeS: 3 });
 const totals = (name, km=50, realKm=.5, runden=10, sitzungen=5, besteMs=3000) =>
   ({ name, km, realKm, runden, sitzungen, besteMs });
 const original = { kmV:2, cars: { a:totals('Gleich'), b:totals('Gleich'), alt:totals('Alt') }, sessions: [
   s([booked('Gleich',[3000,9000],'a',10,.1),booked('Gleich',[11000],'b',5,.05,'ghost')]),
   s([booked('Gleich',[12000],'a',20,.2),booked('Gleich',[15000],'b',5,.05,'ghost')],'2026-10-21T12:00:00Z'),
   s([c('Alt',[2000],'alt')],'2026-10-22T12:00:00Z') ] };
 check(T.escape('<img src=x onerror=alert(1)>').includes('&lt;img'), 'Namen und Kennungen werden HTML-sicher dargestellt');
 check(T.key(booked('Gleich',[1000],'a',1,.1),original)==='a', 'Exakte Buchungskennung hat stabile Zuordnung');
 const before = JSON.stringify(original);
 let p = T.plan(original,'auto','a');
 check(!('a' in p.neu.cars), 'Auto-Summe entfernt');
 check(JSON.stringify(p.neu.cars.b)===JSON.stringify(original.cars.b),'Gleichnamiges Auto anderer ID unveraendert');
 check(p.neu.sessions.length===3 && p.neu.sessions[0].autos[0].id==='b','Mitfahrer und Sitzungen bleiben erhalten');
 check(p.neu.sessions[0].simKm===0 && p.neu.sessions[0].realKm===0,'Sitzungskilometer des entfernten Spielers zaehlen nicht weiter');
 check(p.neu.sessions[0].fahrstil===null && p.neu.sessions[0].strafeS===null,'Fahrstil und Strafe des entfernten Spielers entfernt');
 check(JSON.stringify(original)===before,'Plan mutiert Original nicht');
 p=T.plan(original,'auto','b');
 check(p.neu.sessions[0].simKm===10 && p.neu.sessions[0].fahrstil.wert===2,'NPC-Loeschung behaelt Spielerdaten');
 p=T.plan(original,'auto','alt');
 check(p.neu.sessions.length===2 && p.bericht.sitzungen===1,'Leere Sitzung nach Auto-Loeschung entfernt');
 p=T.plan(original,'sitzung',0);
 check(p.neu.sessions.length===2,'Genau eine Sitzung entfernt');
 check(p.neu.cars.a.km===40 && p.neu.cars.a.realKm===.4,'Nur exakte km-Buchung abgezogen, alte km bleiben');
 check(p.neu.cars.a.runden===8 && p.neu.cars.a.sitzungen===4,'Runden und Sitzungsanzahl korrekt abgezogen');
 check(p.neu.cars.b.km===45 && p.neu.cars.b.runden===9,'Auch NPC-Buchung korrigiert');
 check(JSON.stringify(p.neu.cars.alt)===JSON.stringify(original.cars.alt),'Nicht beteiligtes Auto unveraendert');
 check(p.neu.cars.a.besteMs===null && p.bericht.besteUnbekannt===1,'Unbekannte historische zweitbeste Zeit wird nicht erfunden');
 const komplett=clone(original); komplett.cars.a.sitzungen=2;
 p=T.plan(komplett,'sitzung',0);
 check(p.neu.cars.a.besteMs===12000,'Bei vollstaendiger Historie naechste Bestzeit berechnet');
 p=T.plan(original,'sitzung',2);
 check(p.neu.cars.alt.km===50 && p.bericht.kmUnbekannt===1,'Legacy-km bleiben ohne exakte Buchung erhalten mit Warnung');
 check(p.neu.cars.alt.runden===9,'Legacy-Runden werden abgezogen');
 check(T.key(c('Gleich',[1000],'a'),original)==='a','ID hat Vorrang vor Namen');
 check(T.key(c('Gleich',[1000],null),original)==='name:Gleich','Mehrdeutige Legacy-Namen werden nicht geraten');
 check(T.key(c('Alt',[1000],null),original)==='alt','Eindeutiger Legacy-Name ist zuordenbar');
 const amb=clone(original); amb.sessions.push(s([c('Gleich',[1000],null)]));
 p=T.plan(amb,'auto','a');
 check(p.neu.sessions.at(-1).autos.length===1,'Mehrdeutige Legacy-Sitzung bleibt beim ID-Loeschen bestehen');
 p=T.plan(amb,'sitzung',3);
 check(p.bericht.zuordnungUnbekannt===1 && p.neu.cars.a.runden===10,'Unzuordenbare Sitzung aendert keine fremden Summen');
 let caught=false; try { T.plan(original,'sitzung',99); } catch(e) { caught=true; }
 check(caught,'Ungueltige Sitzung abgelehnt');
 const empty={kmV:2,cars:{},sessions:[]};
 check(Object.keys(T.data()).length>0,'Vorhandene Statistik-Auswertung verfuegbar');
 await T.resetDb();
 for (const k of [T.store,T.backupKey]) localStorage.removeItem(k);
 localStorage.setItem(T.store,JSON.stringify(original));
 localStorage.setItem('chc.cars.v1','{"keep":true}'); localStorage.setItem('omegasim-autofoto:a','photo');
 localStorage.setItem('omegasim-challenges','{"keep":true}');
 const raw=localStorage.getItem(T.store); p=T.plan(original,'sitzung',0); await T.apply(raw,p,'Test');
 check((await T.backup()).vorher===raw,'Original vor Loeschen lokal gesichert');
 check(JSON.parse(localStorage.getItem(T.store)).sessions.length===2,'Plan gespeichert');
 check(localStorage.getItem('chc.cars.v1')==='{"keep":true}' && localStorage.getItem('omegasim-autofoto:a')==='photo'
   && localStorage.getItem('omegasim-challenges')==='{"keep":true}','Garage, Foto und Challenges unangetastet');
 check(T.csv().includes('Summe je Auto') && T.data().sitzungen===2,'CSV und Statistiken lesen bereinigte Daten');
 let activeRaw=localStorage.getItem(T.store); T.race('racing'); caught=false;
 try {await T.apply(activeRaw,T.plan(p.neu,'sitzung',0),'gesperrt');} catch(e) {caught=true;}
 check(caught && localStorage.getItem(T.store)===activeRaw,'Loeschen im laufenden Rennen gesperrt');T.race('idle');
 localStorage.setItem(T.store,JSON.stringify(original)); caught=false;
 try {await T.apply(activeRaw,p,'veraltet');} catch(e) {caught=true;}
 check(caught && localStorage.getItem(T.store)===raw,'Veraltete Auswahl aendert nichts');
 const set=Storage.prototype.setItem, open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(){throw new DOMException('quota','QuotaExceededError');};
 caught=false;try {await T.apply(raw,p,'quota');}catch(e){caught=true;}finally{IDBFactory.prototype.open=open;}
 check(caught && localStorage.getItem(T.store)===raw,'Fehlgeschlagene Sicherung verhindert Loeschen');
 Storage.prototype.setItem=function(k,v) {if(k===T.store) throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v);};
 caught=false;try {await T.apply(raw,p,'write');}catch(e){caught=true;}finally{Storage.prototype.setItem=set;}
 check(caught && localStorage.getItem(T.store)===raw && (await T.backup()).vorher===raw,'Fehlgeschlagener Schreibvorgang behaelt Original und Sicherung');
 localStorage.setItem(T.store,JSON.stringify(empty));localStorage.removeItem(T.backupKey);
 const recorded=T.recordProbe();
 check(recorded.s && recorded.s.autos[0].statistikBuchung.id==='probe','Neue Sitzung speichert genaue Fahrzeugkennung fuer Loeschen');
 const b=recorded.s.autos[0].statistikBuchung;
 check(b.km===1 && b.realKm===.01 && b.runden===1,'Neue Sitzung speichert exakte Kilometerbuchung');
 const removed=T.plan(recorded.o,'sitzung',0);
 check(removed.neu.cars.probe.km===0 && removed.neu.cars.probe.realKm===0,'Aufzeichnung und Loeschen sind inverse km-Operationen');
 const many=clone(original);many.sessions=Array.from({length:201},(_,i)=>s([c('Alt',[10000],'alt')],String(i)));
 T.save(many);
 check(T.read().sessions.length===200,'Archivgrenze von 200 Sitzungen bleibt unveraendert');
 check(T.read().cars.alt.km===original.cars.alt.km,'Archivkuerzung reduziert keine Lebenszeit-Summen');
 return {checks,fixture:original};
}"""

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):
        super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):
        pass
    def do_GET(self):
        if self.path.split('?')[0]=='/__stat_test.html':
            text=(ROOT/'index.html').read_text(encoding='utf-8')
            marker='  window.__omegaFertig = true;'
            assert text.count(marker)==1
            text=text.replace(marker,HOOK+'\n'+marker)
            data=text.encode('utf-8');self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        else:
            super().do_GET()

async def run(args):
    from playwright.async_api import async_playwright
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    async with async_playwright() as pw:
        opts={'headless':True,'args':['--no-sandbox']}
        if args.browser:opts['executable_path']=args.browser
        browser=await pw.chromium.launch(**opts)
        context=await browser.new_context(accept_downloads=True,viewport={'width':1100,'height':900})
        page=await context.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        # Kein Zugriff auf fremde Dienste waehrend dieser rein lokalen Tests.
        await page.route('**/*',lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:', 'data:', 'blob:')) else route.abort())
        url=f'http://127.0.0.1:{server.server_port}/__stat_test.html'
        await page.goto(url,wait_until='load');await page.wait_for_function('window.__omegaFertig === true')
        result=await page.evaluate(CORE); labels=result['checks'];fixture=result['fixture']
        import importlib.util
        spec=importlib.util.spec_from_file_location('omega_build_check',ROOT/'tools/build.py')
        build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
        valid='// I18N_EN = keine Deklaration\r\n  const I18N_EN = {\r\n    "a": "b",\r\n  };\r\n  function unrelated() {}'
        assert build.check_dict(valid)==[], 'Woerterbuch mit CRLF wird korrekt abgeschlossen'
        labels.append('Woerterbuchpruefung ignoriert Kommentare und akzeptiert CRLF')
        invalid='  const I18N_EN = {\n    "waise",\n  };'
        assert build.check_dict(invalid), 'Waise wird weiter erkannt'
        labels.append('Woerterbuchpruefung erkennt weiterhin echte Waisen')
        async def check(ok,label):
            if not ok:raise AssertionError(label)
            labels.append(label)
        async def seed():
            await page.evaluate('async o=>{await __statTest.resetDb();localStorage.setItem(__statTest.store,JSON.stringify(o));localStorage.removeItem(__statTest.backupKey);__statTest.race("idle");__statTest.open();document.querySelector(".stat-clean").open=true;}',fixture)
        async def select(which,value):
            await page.locator('#stat-clean-'+which).select_option(value)
        async def click(which,accept=True):
            async def dialog(d):
                if accept:await d.accept()
                else:await d.dismiss()
            if which=='undo':await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
            page.once('dialog',dialog)
            await page.locator('#stat-clean-'+which).evaluate('(el)=>el.click()')
            await page.wait_for_function('!__statTest.busy()')
        await seed()
        await check(await page.locator('.stat-clean').is_visible(),'Bereinigungsbereich in Statistik-Unterseite sichtbar')
        await select('session','0');await click('session-delete',False)
        await check(await page.evaluate('__statTest.read().sessions.length')==3,'Abgebrochene Rueckfrage loescht nichts')
        await click('session-delete')
        await check(await page.evaluate('__statTest.read().sessions.length')==2,'Sitzung ueber echte UI geloescht')
        await check(await page.locator('#sess-list').text_content() is not None,'Renneinstellungen-Liste nach Bereinigung neu gezeichnet')
        await click('undo')
        await check(await page.evaluate('__statTest.read().sessions.length')==3,'Letzte Bereinigung ueber UI rueckgaengig')
        await seed(); await select('session','0');await click('session-delete')
        await page.evaluate('localStorage.setItem(__statTest.store,JSON.stringify({...__statTest.read(), changed:true}))')
        await page.wait_for_function('!document.getElementById("stat-clean-undo").disabled')
        await page.locator('#stat-clean-undo').evaluate('(el)=>el.click()')
        await page.wait_for_function('!__statTest.busy()')
        await check('geändert' in await page.locator('#stat-clean-status').text_content(),'Undo nach zwischenzeitlicher Fahrt/Datenaenderung gesperrt')
        await seed()
        options=await page.locator('#stat-clean-car option').evaluate_all('(xs)=>xs.map(x=>({v:x.value,t:x.textContent}))')
        key=next(x['v'] for x in options if '[a]' in x['t'])
        await select('car',key);await click('car-delete')
        await check(await page.evaluate('!("a" in __statTest.read().cars) && ("b" in __statTest.read().cars)'), 'Fahrzeug ueber UI selektiv entfernt')
        await check(await page.evaluate('__statTest.data().runden')==1,'Globale Spieler-Runden nach Auto-Loeschung korrekt')
        async with page.expect_download() as info:
            await page.locator('#stat-clean-backup').evaluate('(el)=>el.click()')
        download=await info.value
        path=await download.path(); envelope=json.loads(Path(path).read_text())
        await check(set(envelope['ablagen'])=={'chc.sessions.v1'},'JSON-Sicherung enthaelt nur Statistikablage im Importformat')
        imported=await page.evaluate('b=>__statTest.importBackup(b)',envelope)
        await check(imported.get('nAblagen')==1 and await page.evaluate('"a" in __statTest.read().cars'),'JSON-Sicherung durch vorhandenen Sicherungsimport wiederherstellbar')
        await seed();await page.evaluate('localStorage.setItem(__statTest.store,JSON.stringify({cars:{},sessions:[],kmV:2}));__statTest.draw();')
        await check(await page.locator('#stat-clean-car-delete').is_disabled() and await page.locator('#stat-clean-session-delete').is_disabled(),'Leere Statistik laesst keine Loeschung zu')
        await seed(); await select('session','0');await click('session-delete')
        await page.reload(wait_until='load'); await page.evaluate('__statTest.open();document.querySelector(".stat-clean").open=true')
        await click('undo')
        await check(await page.evaluate('__statTest.read().sessions.length')==3,'Lokale Sicherung und Undo ueberleben Neuladen')
        await check(not errors,'Keine JavaScript-Lade- oder Laufzeitfehler')
        if args.screenshot:
            await seed();await page.set_viewport_size({'width':390,'height':844});await page.locator('#stat-bereinigen').scroll_into_view_if_needed();await page.locator('#stat-bereinigen').screenshot(path=args.screenshot)
        # Vorhandene Tests fuer die betroffenen Statistik-/Sicherungspfade.
        relevant=await page.evaluate('async()=>{const r=[];for(const t of __statTest.tests.filter(x=>/^(Statistik:|Sicherung:|Telemetrie:|Telemetrie-Seite:)/.test(x.name))){try{r.push({name:t.name,result:await t.fn()});}catch(e){r.push({name:t.name,error:String(e)});}}return r;}')
        failed=[x for x in relevant if x.get('error') or x.get('result',{}).get('ok') is False]
        if failed:raise AssertionError('Vorhandene Regressionstests: '+json.dumps(failed,ensure_ascii=False))
        for label in labels:print('OK:',label)
        print(f'BESTANDEN: {len(labels)} gezielte Pruefungen; {len(relevant)} vorhandene Statistik-/Sicherungs-/Telemetrietests ohne Fehler.')
        if args.report:Path(args.report).write_text(json.dumps({'checks':labels,'existing':relevant,'pageerrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
        await context.close();await browser.close()
    server.shutdown()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--browser');parser.add_argument('--report');parser.add_argument('--screenshot')
    args=parser.parse_args()
    try:asyncio.run(run(args))
    except ModuleNotFoundError as e:
        raise SystemExit('Optionaler Browsertest: Playwright fehlt. Installieren: python -m pip install playwright; python -m playwright install chromium') from e
