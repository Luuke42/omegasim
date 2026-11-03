#!/usr/bin/env python3
"""Optionaler Browsertest mit synthetischen Audiopuffern, ohne Autos/Benutzerdaten.
py tools/test_rennereignisse.py
Voraussetzung nur fuer den Test: Playwright und Chromium. Keine Piper-Stimmen noetig.
"""
from pathlib import Path
import argparse
import functools
import http.server
import json
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HOOK = r"""
  window.__ansageTest = {
    Queue: RennAnsagenQueue, q: rennAnsagen, tts: ansagenTextSpielen,
    reset: () => { ansagenReset(); rennEreignisReset(); },
    damage: rennEreignisSchaden, pit: rennEreignisBox, penalty: rennEreignisStrafe,
    limit: rennEreignisGrenzwert, keys: rennEreignisFolge, number: rennEreignisZahlFolge,
    text: rennEreignisText, lap: speakLap, warning: ansage, stand: rennstandSpielen,
    standBusy: rennstandBeschaeftigt, toggles: rennEreignisAn,
    health: (n,h) => { if(n===1)damage=100-h;else zusatzPlatz(n).schaden.wert=100-h; },
    recover: rennEreignisSchadenErholen,
    state: s => { raceState=s; }, paused: on => { rennPauseAktiv=()=>on; },
    damageOn: on => { crashSchadenAn=()=>on; },
    open: () => { showTab('options'); showSubpage('opt-ansagen'); },
    save: autoSicherungSchreiben, allSettings: sicherungReglerLesen,
    setting: presetSet, tests: ST_TESTS,
    oldWarning: w => ansagenPruefen(w),
    setup: () => {
      ansagenReset();rennEreignisReset();rennstandAbbrechen();
      raceState='racing';raceMode='laps';raceFormationLap=false;
      soundEnabled=true;zweiSpieler=true;rennstandAn=true;rennstandErgebnisAn=true;
      rennEreignisGrenze=30;rennEreignisAn.damage=true;rennEreignisAn.pit=true;rennEreignisAn.penalty=true;
      ansageAn.lap=true;ansageAn.fuel=true;ansageAn.damage=true;ansageAn.pit=true;
      playerCar={role:'player',colorId:'rot',modellId:'ferrari'};
      zusatzPlatz(2).car={role:'player2',colorId:'blau',modellId:'bmw'};
      zusatzPlatz(3).car={role:'player3',colorId:'weiss',modellId:'mercedes'};
      damage=0;zusatzPlatz(2).schaden.wert=0;zusatzPlatz(3).schaden.wert=0;
      rennPauseAktiv=()=>false;crashSchadenAn=()=>true;
      const events=window.__audioEvents=[];
      const synth={speaking:false,pending:false,
        speak:u=>{synth.speaking=true;events.push('tts-start:'+u.text);
          setTimeout(()=>{synth.speaking=false;events.push('tts-end:'+u.text);if(u.onend)u.onend();},80);},
        cancel:()=>{events.push('CANCEL');synth.speaking=false;}};
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synth});
      audioCtx={get currentTime(){return performance.now()/1000;},destination:{},
        createBufferSource:()=>({playbackRate:{value:1},connect(){return this;},disconnect(){},
          start(t){ const node=this;
            setTimeout(()=>events.push('start:'+node.buffer.key),Math.max(0,(t-audioCtx.currentTime)*1000));
            node.timer=setTimeout(()=>{events.push('end:'+node.buffer.key);if(node.onended)node.onended();},Math.max(0,(t-audioCtx.currentTime+node.buffer.duration/node.playbackRate.value)*1000));},
          stop(){clearTimeout(this.timer);events.push('STOP');}})};
      const buffer=key=>({duration:.04,key});
      const basis={}, neu={};
      for(let n=0;n<=60;n++)basis['n:'+n]=buffer('n:'+n);
      basis['n:komma']=buffer('n:komma');basis['n:bestzeit']=buffer('n:bestzeit');
      for(const key of ['runde','fuehrt_start','farbe_rot','farbe_blau','farbe_weiss','farbe_unbekannt',
        'modell_ferrari','modell_bmw','modell_mercedes','spieler1','spieler2','spieler3'])basis['e:'+key]=buffer('e:'+key);
      for(const key of ['damage','pit1','pit2','pit3','penalty_start','penalty_one','seconds',
        'penalty_player1','penalty_player2','penalty_player3'])neu['v:'+key]=buffer('v:'+key);
      for(let n=61;n<=99;n++)neu['v:number_'+n]=buffer('v:number_'+n);
      for(let n=1;n<=9;n++)neu['v:hundred_'+n]=buffer('v:hundred_'+n);
      rennstandClipsLaden=async()=>basis;rennEreignisClipsLaden=async()=>neu;
      rennstandGain=()=>({});rennstandPitchBuffer=x=>x;rennstandTonhoehe=0;rennstandHall=0;
      voiceBuffers.fuel={de:buffer('fuel'),en:buffer('fuel')};
      lapAnsageRuheBis=0;return events;
    }
  };
"""
CORE = r"""async () => {
  const T=__ansageTest, labels=[], check=(v,n)=>{if(!v)throw Error(n);labels.push(n);},
    wait=ms=>new Promise(r=>setTimeout(r,ms)), starts=()=>__audioEvents.filter(x=>x.startsWith('start:'));
  T.setup();
  check(T.limit('')===30 && T.limit('foo')===30 && T.limit(-2)===1 && T.limit(200)===100,'Grenzwertvalidierung');
  check(T.number(300).join()==='v:hundred_3' && T.number(900).join()==='v:hundred_9','Grosse Strafen als Zahl, keine Ziffernfolge');
  check(T.keys('penalty',{nr:3},7.5).includes('n:komma'),'Dezimalstrafe');
  check(T.keys('penalty',{nr:2},1)[0]==='v:penalty_one','Singular einer Sekunde');
  check(T.text('damage',{nr:1,farbeId:'rot',modellId:'ferrari'},0,'de')==='Der rote Ferrari von Spieler 1 ist schwer beschädigt.','Deutscher Schadensatz');
  check(T.text('pit',{nr:2},0,'en')==='Player 2 is in the pits.','Englischer Boxensatz');
  T.health(1,30);check(!T.damage(1),'Genau Grenzwert keine Meldung');
  T.health(1,29);check(T.damage(1),'Schadensflanke Spieler 1');check(!T.damage(1),'Schadensmeldung nicht wiederholen');
  T.health(2,29);T.health(3,29);check(T.damage(2)&&T.damage(3),'Spieler 2/3 unabhaengige Latches');
  T.reset();T.health(1,29);T.damageOn(false);check(!T.damage(1),'Schadenmodell aus');
  T.damageOn(true);T.paused(true);check(!T.damage(1)&&!T.pit(1)&&!T.penalty(1,5),'Pause erzeugt keine Ereignisse');
  T.paused(false);T.state('idle');check(!T.damage(1)&&!T.pit(1),'Keine Rennmeldung im Leerlauf');
  T.state('racing');T.damage(1);T.health(1,37);T.recover();check(!T.damage(1),'Hysterese nicht zu frueh');
  T.health(1,38);T.recover();T.health(1,29);check(T.damage(1),'Reparatur gibt Meldung frei');
  T.reset();check(!T.penalty(1,0)&&!T.penalty(0,5)&&!T.pit(0),'Keine Nullstrafe oder NPC-Spielernummer');
  T.setup();T.lap(12500,false);T.pit(2);T.penalty(3,5);T.health(1,29);T.damage(1);
  await wait(2100);
  const a=starts();check(a[0]==='start:v:pit2','Ereignis vor wartender Rundenzeit');
  check(a.indexOf('start:v:penalty_start')<a.indexOf('start:e:farbe_rot'),'Ereignisse FIFO');
  check(__audioEvents.findIndex(x=>x.startsWith('tts-start:'))>__audioEvents.indexOf('end:v:damage'),'Rundenzeit nach Ereignissen');
  check(!__audioEvents.includes('CANCEL')&&!__audioEvents.includes('STOP'),'Kein Abbruch durch neue Meldung');
  T.setup();T.lap(10000,false);await wait(20);T.pit(1);await wait(700);
  check(__audioEvents.indexOf('tts-end:10,0')<__audioEvents.indexOf('start:v:pit1'),'Laufende Rundenzeit wird beendet');
  T.setup();const rows=[{platz:1,role:'player',farbeId:'rot',modellId:'ferrari',alias:''}];
  check(await T.stand(rows,1),'Rennstand startet');T.pit(3);T.lap(11000,false);await wait(1800);
  check(__audioEvents.indexOf('end:e:spieler1')<__audioEvents.indexOf('start:v:pit3'),'Laufender Rennstand wird beendet');
  check(__audioEvents.indexOf('end:v:pit3')<__audioEvents.indexOf('tts-start:11,0'),'Rundenzeit waehrend Rennstand wird nachgeholt');
  check(!__audioEvents.includes('STOP')&&!__audioEvents.includes('CANCEL'),'Kein Rennstandabbruch durch Ereignis');
  T.setup();T.pit(2);check(!await T.stand(rows,1),'Rennstand wartet auf Ereignisqueue');await wait(600);
  check(await T.stand(rows,1),'Rennstand nach Queue wieder erlaubt');await wait(700);
  T.setup();T.paused(true);T.lap(12000,false);await wait(120);check(!__audioEvents.length,'Queue pausiert');
  T.paused(false);await wait(450);check(__audioEvents.some(x=>x.startsWith('tts-start:')),'Queue nach Fortsetzen');
  T.setup();T.pit(1);T.toggles.pit=false;await wait(100);check(!__audioEvents.length,'Ausgeschaltete wartende Meldung entfaellt');
  T.setup();T.pit(1);T.reset();await wait(100);check(!__audioEvents.length,'Reset entfernt alte Queue');
  T.setup();T.oldWarning({health:.01});await wait(100);check(!__audioEvents.length,'Keine doppelte alte Schadenswarnung');
  T.setup();T.warning('fuel','Tank fast leer');await wait(15);T.pit(1);await wait(600);
  check(__audioEvents.indexOf('end:fuel')<__audioEvents.indexOf('start:v:pit1'),'Warnclip ebenfalls nicht unterbrochen');
  T.setup();delete window.speechSynthesis;T.lap(10500,false);T.pit(2);await wait(1000);
  check(starts()[0]==='start:v:pit2'&&starts().includes('start:n:10'),'Offline-Android: Ereignis- und Zahlenclips ohne Web Speech');
  T.setup();window.speechSynthesis.speak=()=>{window.speechSynthesis.speaking=true;};
  check(await T.tts('Probe','de',120)===false && __audioEvents.includes('CANCEL'),'Defekte TTS ohne Ende wird nur durch Fehler-Watchdog freigegeben');
  T.reset();return labels;
}"""

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--browser');ap.add_argument('--screenshot');a=ap.parse_args()
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('  window.__omegaFertig = true;',HOOK+'\n  window.__omegaFertig = true;',1)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path.split('?')[0] in ('/','/index.html'):
                data=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(data)
            else:super().do_GET()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=a.browser,args=['--no-sandbox'])
            context=browser.new_context(service_workers='block');page=context.new_page();errors=[]
            page.add_init_script('window.requestAnimationFrame=()=>0;')
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/index.html',wait_until='load')
            assert page.evaluate('!!window.__omegaFertig'),'App nicht geladen'
            labels=page.evaluate(CORE)
            # Echte vorhandene Selbstsicherung (auch data-preset-skip) nach Reload pruefen.
            page.reload(wait_until='load')
            page.evaluate("__ansageTest.setting('setting-announce-event-damage',true);__ansageTest.setting('setting-announce-event-pit',true);__ansageTest.setting('setting-announce-event-penalty',true);__ansageTest.setting('setting-announce-event-damage-limit',25);__ansageTest.save();")
            data=page.evaluate('__ansageTest.allSettings()')
            assert data['setting-announce-event-damage'] is True and str(data['setting-announce-event-damage-limit'])=='25'
            page.reload(wait_until='load')
            assert page.locator('#setting-announce-event-damage').is_checked()
            assert page.locator('#setting-announce-event-pit').is_checked()
            assert page.locator('#setting-announce-event-penalty').is_checked()
            assert page.locator('#setting-announce-event-damage-limit').input_value()=='25'
            assert page.evaluate('__ansageTest.toggles.damage&&__ansageTest.toggles.pit&&__ansageTest.toggles.penalty')
            labels.append('Alle vier Parameter durch vorhandene Selbstsicherung nach F5 wiederhergestellt')
            relevant=page.evaluate(r"""async()=>{const out=[];for(const t of __ansageTest.tests.filter(t=>/^(Ansage|Ansagen|Rundenansage aus Clips:|Rennstand:|Ton: alle fuenf)/.test(t.name))){try{out.push({name:t.name,result:await t.fn()});}catch(e){out.push({name:t.name,error:String(e)});}}return out;}""")
            failed=[x for x in relevant if x.get('error') or x.get('result',{}).get('ok') is False]
            assert not failed,json.dumps(failed,ensure_ascii=False)
            print('Vorhandene Ansagen-/Rennstandtests:',len(relevant),'; uebersprungen:',sum(bool(x.get('result',{}).get('skip')) for x in relevant))
            assert not errors,errors
            if a.screenshot:
                page.set_viewport_size({'width':390,'height':844})
                page.evaluate("__ansageTest.open()")
                page.locator('#setting-announce-event-damage').scroll_into_view_if_needed()
                page.screenshot(path=a.screenshot)
            for label in labels:print('OK:',label)
            print('BESTANDEN:',len(labels),'gezielte Pruefungen; keine JS-Ladefehler.')
            browser.close()
    finally:server.shutdown()
if __name__=='__main__':main()
