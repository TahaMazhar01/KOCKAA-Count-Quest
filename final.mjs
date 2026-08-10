import { chromium } from "playwright-core";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const B = await chromium.launch({ executablePath: CHROME, headless: true,
  args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--mute-audio"] });
const errs=[]; const out={};
const p = await B.newPage({ viewport:{width:1440,height:860} });
p.on("pageerror",e=>errs.push("PAGEERROR: "+e.message));
p.on("console",m=>{ if(m.type()==="error") errs.push("CONSOLE: "+m.text()); });
p.on("response",r=>{ if(r.status()>=400) errs.push("HTTP "+r.status()); });
const W=(f,t=240000)=>p.waitForFunction(f,null,{timeout:t,polling:150});

await p.goto("http://localhost:8795/",{waitUntil:"load"});
await p.waitForFunction(()=>!document.getElementById("playBtn").disabled,null,{timeout:120000});
await p.screenshot({path:"shots/00-start.png"});
await p.click("#playBtn");
await p.waitForTimeout(2600);
await p.screenshot({path:"shots/01-hub.png"});
out.hub = await p.evaluate(()=>({phase:window.__GAME.S.phase}));

// one autopilot, mode flipped from outside
await p.evaluate(()=>{
  const G=window.__GAME; window.__MODE="right";
  window.__AP=setInterval(()=>{
    if(G.S.qState!=="fly") return;
    const gs=G.gates(); if(!gs.length) return;
    const i = window.__MODE==="right" ? gs.findIndex(g=>g.c) : gs.findIndex(g=>!g.c);
    if(i<0) return;
    G.S.lane=i; G.S.laneTarget=i; G.S.tween=null; G.S.queue.length=0;
  },40);
});

// ORDER / missing number
await p.evaluate(()=>window.__GAME.goStage(1,1,0));
await W(()=>window.__GAME.S.qState==="fly");
await p.waitForTimeout(300);
await p.screenshot({path:"shots/04-missing.png"});
out.q = await p.evaluate(()=>({lead:document.getElementById("qlead").textContent,
  row:document.getElementById("qbig").textContent.trim(), gates:window.__GAME.gates()}));

await W(()=>window.__GAME.S.correct>0);
await p.waitForTimeout(200);
await p.screenshot({path:"shots/05-correct.png"});
out.afterCorrect = await p.evaluate(()=>({correct:window.__GAME.S.correct,coins:window.__GAME.S.coins,
  blankFilled:!!document.querySelector("#qbig .cell.blank.filled")}));

await p.evaluate(()=>window.__MODE="wrong");
await W(()=>window.__GAME.S.wrong>0);
await p.waitForTimeout(200);
await p.screenshot({path:"shots/06-wrong.png"});
out.afterWrong = await p.evaluate(()=>({wrong:window.__GAME.S.wrong,coins:window.__GAME.S.coins,
  fbBig:document.getElementById("fbBig").textContent, fbTxt:document.getElementById("fbTxt").textContent,
  greenReveal:true}));

// COUNT / collect
await p.evaluate(()=>{window.__MODE="right"; window.__GAME.goStage(0,0,0);});
await W(()=>window.__GAME.S.qState==="collect");
await p.waitForTimeout(1500);
await p.screenshot({path:"shots/02-collect.png"});
out.collect = await p.evaluate(()=>({tray:document.getElementById("tray").classList.contains("on"),
  collected:window.__GAME.S.tCollected}));

// RANGE / number line
await p.evaluate(()=>window.__GAME.goStage(2,1,0));
await W(()=>window.__GAME.S.qState==="line");
await p.waitForTimeout(900);
await p.screenshot({path:"shots/07-line.png"});
out.line = await p.evaluate(()=>({answer:window.__GAME.S.q.answer,min:window.__GAME.S.q.min,
  max:window.__GAME.S.q.max,drop:document.getElementById("dropBtn").classList.contains("on")}));
await p.evaluate(()=>{const G=window.__GAME,q=G.S.q; G.S.linePos=(q.answer-q.min)/Math.max(1,q.max-q.min);});
await p.waitForTimeout(300);
await p.click("#dropBtn");
await p.waitForTimeout(900);
await p.screenshot({path:"shots/08-line-result.png"});
out.lineResult = await p.evaluate(()=>({correct:window.__GAME.S.correct}));
await p.evaluate(()=>clearInterval(window.__AP));

// audio
out.audio = await p.evaluate(async()=>{
  const A=window.__GAME.Audio,g=A._debug();
  A.setOn("sfx",false); A.setOn("music",true);
  const music=await A._probe(1400);
  A.setOn("music",false); A.setOn("sfx",true);
  const sp=A._probe(1500); A.correct(3); setTimeout(()=>A.coin(2),250); setTimeout(()=>A.wrong(),650);
  const sfx=await sp; A.setOn("music",true);
  return {state:g.state,graph:g.graph,music,sfx};
});
await p.close();

// responsive
const SIZES=[["laptop-1366x625",1366,625],["tablet-820x1180",820,1180],
             ["phone-390x740",390,740],["phone-land-740x390",740,390]];
out.responsive=[];
for(const [n,w,h] of SIZES){
  const q=await B.newPage({viewport:{width:w,height:h}});
  await q.goto("http://localhost:8795/",{waitUntil:"load"});
  await q.waitForFunction(()=>!document.getElementById("playBtn").disabled,null,{timeout:120000});
  const start=await q.evaluate(()=>{const wr=document.getElementById("start"),c=wr.querySelector(".card"),r=c.getBoundingClientRect();
    return {clipped:r.top<-1,reach:wr.scrollHeight<=wr.clientHeight||r.top>=-1};});
  await q.screenshot({path:`shots/vp-${n}-start.png`});
  await q.click("#playBtn");
  await q.waitForTimeout(1800);
  await q.evaluate(()=>window.__GAME.goStage(1,0,0));
  await q.waitForFunction(()=>window.__GAME.S.qState==="fly",null,{timeout:120000,polling:150});
  await q.waitForTimeout(600);
  await q.screenshot({path:`shots/vp-${n}-hud.png`});
  const hud=await q.evaluate(()=>{
    const ids=["prog","qpanel","coins","tray","pauseBtn","menuBtn","aLeft","aRight"],bx={};
    for(const id of ids){const e=document.getElementById(id);const r=e.getBoundingClientRect();
      if(r.width>0&&getComputedStyle(e).display!=="none") bx[id]=r;}
    const W2=innerWidth,H2=innerHeight,off=[],ov=[];const ks=Object.keys(bx);
    for(const k of ks){const r=bx[k]; if(r.left<-1||r.top<-1||r.right>W2+1||r.bottom>H2+1) off.push(k);}
    for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++){const a=bx[ks[i]],b=bx[ks[j]];
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2) ov.push(ks[i]+"×"+ks[j]);}
    return {off:off.join(",")||"-",ov:ov.join(",")||"-"};
  });
  out.responsive.push({size:n,startClipped:start.clipped,startReach:start.reach,off:hud.off,overlaps:hud.ov});
  await q.close();
}
out.errors=[...new Set(errs)].slice(0,8);
console.log(JSON.stringify(out,null,1));
await B.close();
