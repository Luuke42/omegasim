import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent.parent
TEST=r"""async () => {
 const checks=[];
 const eq=(ok,name)=>{if(!ok)throw Error(name);checks.push(name)};
 const original={now:Date.now,timeout:window.setTimeout,clear:window.clearTimeout,random:Math.random};
 let wall=original.now(), seq=0;const timers=new Map();
 Date.now=()=>wall; Math.random=()=>0;
 window.setTimeout=(fn,ms,...args)=>{let id=++seq;timers.set(id,{at:wall+Math.max(0,Number(ms)||0),fn:()=>fn(...args)});return id};
 window.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else original.clear.call(window,id)};
 const advance=ms=>{let end=wall+ms,n=0;while(true){let due=[...timers].filter(([id,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;if(++n>10000)throw Error('timer loop');timers.delete(due[0]);wall=due[1].at;due[1].fn()}wall=end};
 try { return await __TEST_INTERNAL.run(`(async()=>{
  const tabVorher=document.querySelector('.tabpage.active');
  const testTab=id=>{document.querySelectorAll('.tabpage').forEach(el=>el.classList.toggle('active',el.id===id));};
  testTab('tab-race');
  raceState='racing'; raceMode='practice'; flagState='green'; raceAwaitingMove=false;
  raceStartedAt=rennZeitJetzt()-1000; raceLapStart=rennZeitJetzt()-500;
  let fired=0; rennZeitTimeout(()=>fired++,100);
  const before=rennZeitJetzt(), start=raceStartedAt, lap=raceLapStart;
  physEngine.state.speedKmh=5;physEngine.state.fuelLoad=.7;physEngine.state.tyreWear=.3;
  rennPauseUmschalten();
  eq(rennPause.phase==='pause'&&!document.getElementById('renn-pause-ui').hidden,'Pause-Overlay sichtbar');
  advance(10000); raceClockTick(); physicsStep(.1); pitLaneTick(); wxTick(); fuelTankTick(1);
  eq(rennZeitJetzt()===before&&fired===0,'Rennuhr und Renn-Timeout bleiben stehen');
  eq(physEngine.state.speedKmh===0&&physEngine.state.fuelLoad===.7&&physEngine.state.tyreWear===.3,'Tempo neutral; Tank und Reifen erhalten');
  let p=buildCommandPacket(1,1,0,{6:0x5e,7:127,9:127});
  eq(p[6]===0xdf&&p[7]===0&&p[9]===0&&p[19]===crc8(Array.from(p.slice(0,19))),'Paketsperre einschliesslich Overrides und CRC');
  const oldclock=$('race-clock').textContent;advance(1000);raceClockTick();
  eq($('race-clock').textContent===oldclock,'Rennanzeige bleibt waehrend Pause unveraendert');
  rennPauseUmschalten(); advance(5599);
  eq(rennPause.phase==='ampel'&&rennZeitJetzt()===before,'Ausgabesperre bis Ampel-Gruen');
  advance(1);
  eq(rennPause.phase==='aus'&&raceState==='racing'&&raceStartedAt===start&&raceLapStart===lap,'Wiederanlauf ohne Reset von Renn- und Rundenstart');
  eq(document.getElementById('renn-pause-ui').hidden,'Pause-Overlay nach Gruen geschlossen');
  advance(99);eq(fired===0,'Renn-Timeout behaelt Restzeit');advance(1);eq(fired===1,'Renn-Timeout setzt nach Restzeit fort');
  eq(rennPauseFilterGas(1,1,0)[0]===0,'Gehaltenes Gas gesperrt');rennPauseFilterGas(1,0,0);eq(rennPauseFilterGas(1,1,0)[0]===1,'Gas nach Neutralstellung freigegeben');
  eq(!rennPauseLenkung(SRC.KEY,1),'Gehaltene Lenkung gesperrt');rennPauseLenkung(SRC.KEY,0);eq(rennPauseLenkung(SRC.KEY,1),'Lenkung nach Neutralstellung freigegeben');
  let cancelled=0;const ct=rennZeitTimeout(()=>cancelled++,100);rennZeitTimeoutStop(ct);advance(100);eq(cancelled===0,'Renn-Timeout abbrechbar');
  for(const mode of Object.keys(RACE_MODES)){
   raceMode=mode;raceState='racing';raceStartedAt=rennZeitJetzt();raceLapStart=rennZeitJetzt();
   const st=raceStartedAt;rennPauseUmschalten();let paused=rennZeitJetzt();advance(1000);raceClockTick();
   eq(rennZeitJetzt()===paused&&raceStartedAt===st, 'Zeitstillstand in '+mode);
   rennPauseUmschalten();advance(5600);eq(rennPause.phase==='aus'&&raceStartedAt===st,'Wiederanlauf in '+mode);
  }
  raceState='finishing';rennPauseUmschalten();const finishingTime=rennZeitJetzt();advance(2000);nachZielTick();eq(raceState==='finishing'&&rennZeitJetzt()===finishingTime,'Zielauslauf bleibt pausiert');rennPauseBeenden();raceState='racing';
  flagState='restart';const oldFlag=setFlag;let flagCalls=0;setFlag=v=>{flagCalls++;flagState=v};rennPauseUmschalten();rennPauseUmschalten();advance(5600);eq(flagState==='green'&&flagCalls===1,'Gelb-Wiederstart endet nach Ampel mit Gruen');setFlag=oldFlag;
  const oldMalen=vfMalen,oldHud=vfHud,oldRaf=requestAnimationFrame;let painted=0;vfMalen=()=>painted++;vfHud=()=>{};window.requestAnimationFrame=()=>0;
  raceState='idle';VF.aktiv=true;rennPauseUmschalten();const pos=JSON.stringify({x:VF.x,y:VF.y,s:VF.s});vfBild(1234);eq(painted===1&&VF.dtBild===0&&JSON.stringify({x:VF.x,y:VF.y,s:VF.s})===pos,'Virtuelles Fahren zeichnet weiter ohne Bewegung');rennPauseBeenden();VF.aktiv=false;vfMalen=oldMalen;vfHud=oldHud;window.requestAnimationFrame=oldRaf;raceState='racing';
  raceMode='practice';flagState='yellow';rennPauseUmschalten();rennPauseUmschalten();advance(5600);
  eq(flagState==='yellow','Gelbe Flagge bleibt erhalten');flagState='green';
  rennPauseUmschalten();rennPauseUmschalten();advance(1000);rennPauseUmschalten();advance(10000);
  eq(rennPause.phase==='pause','Erneuter Druck stoppt Wiederanlauf-Ampel');rennPauseBeenden();
  let greenCalls=0;const oldgreen=raceGreen;raceGreen=()=>{greenCalls++;raceState='racing'};
  raceState='countdown';rennPauseUmschalten();rennPauseUmschalten();advance(5600);
  eq(greenCalls===1,'Unterbrochener Erststart genau einmal freigegeben');raceGreen=oldgreen;
  const bind={pause:{type:'button',index:0}}, pad={buttons:[{pressed:true,value:1}],axes:[]};
  for(const nr of [1,2,3]){
   rennPause.padVorher[nr]=false;rennPause.letzterDruck=-Infinity;
   rennPauseTaste(pad,bind,nr);rennPauseTaste(pad,bind,nr);
   eq(rennPause.phase==='pause','Controller '+nr+' flankengesteuert');rennPauseBeenden();
  }
  for(const tabId of ['tab-home','tab-fahren','tab-options']){
   testTab(tabId);rennPause.padVorher[1]=false;rennPause.letzterDruck=-Infinity;
   rennPauseTaste(pad,bind,1);
   eq(!rennPauseAktiv()&&!rennPauseErlaubt(),'Keine Pause im Menue '+tabId);
   testTab('tab-race');rennPauseTaste(pad,bind,1);
   eq(!rennPauseAktiv(),'Gehaltene Menue-Taste pausiert nicht beim Cockpitwechsel '+tabId);
   pad.buttons[0].value=0;pad.buttons[0].pressed=false;rennPauseTaste(pad,bind,1);
   pad.buttons[0].value=1;pad.buttons[0].pressed=true;rennPauseTaste(pad,bind,1);
   eq(rennPauseAktiv(),'Neuer Tastendruck im Cockpit erlaubt '+tabId);
   testTab(tabId);rennPause.padVorher[1]=false;rennPause.letzterDruck=-Infinity;
   rennPauseTaste(pad,bind,1);
   eq(rennPause.phase==='pause','Keine Wiederanlaufampel im Menue '+tabId);
   rennPauseBeenden();testTab('tab-race');
  }
  rennPause.padSperre[1]=true;rennPause.padVorher[1]=false;rennPause.letzterDruck=-Infinity;
  rennPauseTaste(pad,bind,1);eq(!rennPauseAktiv(),'Erfassungsdruck loest keine Pause aus');
  pad.buttons[0].value=0;pad.buttons[0].pressed=false;rennPauseTaste(pad,bind,1);
  pad.buttons[0].value=1;pad.buttons[0].pressed=true;rennPauseTaste(pad,bind,1);
  eq(rennPauseAktiv(),'Pause nach Loslassen der belegten Taste moeglich');rennPauseBeenden();
  mp.an=true;rennPauseUmschalten();eq(!rennPauseAktiv(),'Multiplayer-Pause gesperrt');mp.an=false;
  calibRunning=true;rennPauseUmschalten();eq(!rennPauseAktiv(),'Kalibrierung nicht durch lokale Pause unterbrochen');calibRunning=false;
  const writes=[];let release;const rx={properties:{writeWithoutResponse:true},writeValueWithoutResponse:p=>{writes.push(new Uint8Array(p));return writes.length===1?new Promise(r=>release=r):Promise.resolve()}};
  const one=funkSchreiben(rx,buildCommandPacket(0,.8),null);
  await funkSchreiben(rx,buildCommandPacket(0,.9),null);
  garage.push({rx,role:'ghost'});rennPauseUmschalten();release();await one;await Promise.resolve();
  eq(writes.length>=2&&writes.slice(1).every(p=>p[6]===0xdf),'Wartende Gasbefehle werden beim Nachsenden neutralisiert');
  let ghostPkt;const c={rx:{properties:{writeWithoutResponse:true},writeValueWithoutResponse:p=>{ghostPkt=p;return Promise.resolve()}}};
  await writeToCar(c,1,1,0);eq(ghostPkt&&ghostPkt[6]===0xdf&&ghostPkt[7]===0,'Separater Gegner-Sendepfad ebenfalls gesperrt');
  const beforeFlags={dashLastTileCounter,dashMarkerPrev};const sensor=new Uint8Array(20);sensor[10]=80;sensor[11]=7;sensor[15]=8;
  handleDashboardBytes(sensor);eq(dashLastTileCounter===7&&dashMarkerPrev===true,'Sensor-Baseline wird bei Pause weitergefuehrt');
  rennPauseBeenden();garage.pop();raceState='idle';
  if(tabVorher)testTab(tabVorher.id);
  return checks;
 })()`, {eq,advance,checks});
 } finally{Date.now=original.now;window.setTimeout=original.timeout;window.clearTimeout=original.clear;Math.random=original.random;}
}"""
async def main():
 html=(ROOT/'index.html').read_text().replace('  window.__omegaFertig = true;', '  window.__TEST_INTERNAL={run:(code,vars)=>{const {eq,advance,checks}=vars||{};return eval(code)}};\n  window.__omegaFertig = true;')
 target=ROOT/'_regression.html';target.write_text(html)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,args=['--allow-file-access-from-files'])
  page=await browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(target.as_uri(),wait_until='load')
  checks=await page.evaluate(TEST)
  for check in checks:print('PASS',check)
  print('PAGEERRORS',errors)
  if errors:raise RuntimeError(errors)
  await browser.close()
 target.unlink()
 print('TOTAL',len(checks))
asyncio.run(main())
