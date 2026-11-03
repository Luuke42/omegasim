#!/usr/bin/env python3
"""Stadionhall-Regressionspruefung mit echtem Web Audio in Chromium.
Optional: py tools/test_rennereignis_hall.py --browser PFAD
Benoetigt Playwright und Chromium, keine Piper-Stimmen oder Fahrzeugdaten.
"""
from pathlib import Path
import argparse
import functools
import http.server
import json
import threading
from playwright.sync_api import sync_playwright
from test_rennereignisse import HOOK

ROOT = Path(__file__).resolve().parents[1]
HALL_HOOK = r"""
  window.__hallTest = {
    gain: rennstandGain, buffers: ansagenPufferSpielen,
    time: () => audioCtx.currentTime, destination: () => audioCtx.destination,
    config: (hall,tempo=1,volume=1) => {
      rennstandHall=hall;rennstandTempo=tempo;rennstandLautstaerke=volume;
      rennstandHallAnwenden();if(rennstandBus)rennstandBus.gain.value=volume;
    },
    values: () => ({wet:rennstandHallWet.gain.value,dry:rennstandHallDry.gain.value,
      volume:rennstandBus.gain.value,bus:rennstandBus}),
    setup: async () => {
      __ansageTest.setup();
      audioCtx=new AudioContext();await audioCtx.resume();
      rennstandGain=__hallTest.gain;
      rennstandHall=0;rennstandTempo=1;rennstandLautstaerke=1;
      const records=window.__hallRecords=[];
      const original=audioCtx.createBufferSource.bind(audioCtx);
      audioCtx.createBufferSource=()=>{
        const q=original(),r={node:q,disconnects:0};records.push(r);
        const connect=q.connect.bind(q),start=q.start.bind(q),disc=q.disconnect.bind(q);
        q.connect=dest=>{r.destination=dest;return connect(dest);};
        q.start=t=>{r.start=t;r.rate=q.playbackRate.value;r.key=q.buffer.key;
          r.ends=t+q.buffer.duration/r.rate;return start(t);};
        q.disconnect=()=>{r.disconnects++;return disc();};return q;
      };
      const buffer=(key,duration=.04)=>{const a=audioCtx.createBuffer(1,Math.round(duration*48000),48000);a.key=key;a.getChannelData(0).fill(.01);return a;};
      window.__hallBuffer=buffer;
      const basis={},neu={};
      for(let n=0;n<=60;n++)basis['n:'+n]=buffer('n:'+n);
      for(const key of ['farbe_rot','modell_ferrari','spieler1'])basis['e:'+key]=buffer('e:'+key);
      for(const key of ['damage','pit1','penalty_start','seconds','penalty_player1'])neu['v:'+key]=buffer('v:'+key);
      rennstandClipsLaden=async()=>basis;rennEreignisClipsLaden=async()=>neu;
    },
    missing: () => {rennEreignisClipsLaden=async()=>null;rennstandClipsLaden=async()=>null;},
    close: () => audioCtx.close()
  };
"""
CORE = r"""async () => {
  const T=__ansageTest,H=__hallTest,labels=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);labels.push(label);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const near=(a,b)=>Math.abs(a-b)<.005;
  const idle=async()=>{for(let n=0;n<150&&T.q.beschaeftigt;n++)await wait(40);
    if(T.q.beschaeftigt)throw Error('Warteschlange haengt');};
  await H.setup();H.config(.65,1.5,.8);
  T.damage(1); // Noch kein Schaden, darf keinen Audioknoten starten.
  check(__hallRecords.length===0,'Keine Schadensansage oberhalb Grenze');
  T.health(1,20);check(T.damage(1),'Schadensereignis eingereiht');await idle();
  let records=__hallRecords.slice();
  check(records.length===4,'Schadenssatz hat alle vier Bausteine');
  check(records.every(r=>r.destination===H.values().bus),'Schaden am gemeinsamen Stadionbus');
  check(records.every(r=>near(r.rate,1.5)),'Ereignis verwendet eingestelltes Intro-Tempo');
  check(near(records[1].start-records[0].start,.04/1.5+.055),'Clip-Abstaende zum Tempo passend');
  check(near(H.values().wet,.65*.7)&&near(H.values().dry,1-.65*.2),'Parametrierter Wet/Dry-Hall');
  check(near(H.values().volume,.8),'Parametrierte Lautstaerke am gemeinsamen Bus');
  check(H.time()>=records.at(-1).ends+1.15,'Queue wartet kompletten Hallausklang');
  const bus=H.values().bus;
  let from=__hallRecords.length;T.pit(1);await idle();records=__hallRecords.slice(from);
  check(records.length===1&&records[0].key==='v:pit1'&&records[0].destination===bus,'Box am selben Hallbus');
  from=__hallRecords.length;T.penalty(1,5);await idle();records=__hallRecords.slice(from);
  check(records.length===4&&records.every(r=>r.destination===bus),'Zeitstrafe mit Zahl komplett am Hallbus');
  const live=H.buffers([__hallBuffer('live',.5)],{stadion:true});await wait(100);
  H.config(.25,1,1);await wait(180);
  check(near(H.values().wet,.175)&&near(H.values().dry,.95),'Hall-Aenderung wirkt live ohne Bus-Neubau');
  check(H.gain()===bus,'Identischer Bus wie Rennintro, kein separater Hall');await live;

  H.config(0,1,1);const begin=performance.now();
  await H.buffers([__hallBuffer('nohall')],{stadion:true});
  check(performance.now()-begin<500,'Hall 0 ohne zusaetzliche Nachhall-Wartezeit');
  check(near(H.values().wet,0),'Hallregler 0 schaltet Wet-Pfad ab');
  H.config(.8,1.75,.7);from=__hallRecords.length;
  await H.buffers([__hallBuffer('legacy')]);records=__hallRecords.slice(from);
  check(records[0].destination===H.destination()&&records[0].rate===1,'Bisherige Runden-/Warnclips bleiben trocken und unveraendert');

  // Nachhall blockiert auch die nachgereihte Rundenzeit, ohne einen Satz abzubrechen.
  H.config(.5,1,1);from=__hallRecords.length;__audioEvents.length=0;
  T.pit(1);T.lap(12500);await wait(450);
  check(!__audioEvents.some(x=>x.startsWith('tts-start:')),'Rundenzeit startet nicht waehrend Ereignis-Nachhall');
  await idle();
  check(__audioEvents.some(x=>x.startsWith('tts-start:')),'Wartende Rundenzeit wird nach Hallende nachgeholt');
  check(!__audioEvents.includes('CANCEL')&&!__audioEvents.includes('STOP'),'Prioritaet ohne Unterbrechung');

  // Reset in der Hallphase muss resolve(false) liefern und Timer sicher entfernen.
  let done=false,result=null;
  const pending=H.buffers([__hallBuffer('abort')],{stadion:true}).then(v=>{done=true;result=v;});
  await wait(180);check(!done,'Promise bleibt im Nachhall offen');
  T.reset();await pending;
  check(done&&result===false,'Abbruch waehrend Hallphase gibt Queue frei');
  const disconnects=__hallRecords.at(-1).disconnects;await wait(1250);
  check(__hallRecords.at(-1).disconnects===disconnects,'Kein zweites Ende durch verwaisten Halltimer');

  // Bestehender Sprach-Fallback ist funktionsfaehig, kann technisch keinen Hall tragen.
  __audioEvents.length=0;H.missing();T.penalty(1,5);await idle();
  check(__audioEvents.some(x=>x.startsWith('tts-start:')),'Fehlende Clips: expliziter Geraetestimmen-Fallback bleibt erhalten');
  await H.close();return labels;
}"""

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--browser');a=ap.parse_args()
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '  window.__omegaFertig = true;',HOOK+'\n'+HALL_HOOK+'\n  window.__omegaFertig = true;',1)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path.split('?')[0] in ('/','/index.html'):
                data=html.encode();self.send_response(200)
                self.send_header('Content-Type','text/html; charset=utf-8')
                self.end_headers();self.wfile.write(data)
            else:super().do_GET()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=a.browser,
                args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
            context=browser.new_context(service_workers='block');page=context.new_page();errors=[]
            page.add_init_script('window.requestAnimationFrame=()=>0;')
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/index.html',wait_until='load')
            assert page.evaluate('!!window.__omegaFertig'),'App nicht geladen'
            labels=page.evaluate(CORE)
            assert not errors,errors
            print(json.dumps({'passed':len(labels),'checks':labels},ensure_ascii=False,indent=2))
            browser.close()
    finally:server.shutdown()

if __name__=='__main__':main()
