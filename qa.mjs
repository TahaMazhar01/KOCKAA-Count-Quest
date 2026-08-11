/* Full QA sweep against the LIVE deployment. */
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.env.GAME_URL || process.env.QA_URL || "https://kockaa-count-quest.vercel.app/";
fs.mkdirSync("qa", { recursive: true });

const B = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
});

const R = { url: URL, pass: [], fail: [], warn: [] };
const ok = (n, d) => R.pass.push(d ? `${n} — ${d}` : n);
const bad = (n, d) => R.fail.push(d ? `${n} — ${d}` : n);
const warn = (n, d) => R.warn.push(d ? `${n} — ${d}` : n);

const page = await B.newPage({ viewport: { width: 1440, height: 860 } });
const errs = [];
page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
page.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
page.on("response", r => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });

const W = (f, t = 240000) => page.waitForFunction(f, null, { timeout: t, polling: 150 });
const settle = () => W(() => !window.__GAME.flying());

// ---------- 1. load ----------
const t0 = Date.now();
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !document.getElementById("playBtn").disabled, null, { timeout: 120000 });
R.loadMs = Date.now() - t0;
await page.screenshot({ path: "qa/01-start.png" });
R.loadMs < 20000 ? ok("Loads and reaches PLAY", R.loadMs + "ms") : warn("Slow first load", R.loadMs + "ms");

// ---------- 2. deployment freshness ----------
const fresh = await page.evaluate(() => {
  const h = document.documentElement.outerHTML;
  return {
    twinJets: h.includes("read as a jetpack"),
    planetSurface: h.includes("planetSurface"),
    twoStep: h.includes("tap the planet again"),
    flashCfg: h.includes("FLASH_MAX"),
    gateRing: h.includes("A gate you fly THROUGH"),
    credit: h.includes("etsy.com/shop/KOCKAA"),
  };
});
R.freshness = fresh;
Object.values(fresh).every(Boolean)
  ? ok("Live build is current", "all six latest-change markers present")
  : bad("Live build is STALE", JSON.stringify(fresh));

// ---------- 3. hub ----------
await page.click("#playBtn");
await settle(); await page.waitForTimeout(400);
await page.screenshot({ path: "qa/02-hub.png" });
const hub = await page.evaluate(() => ({
  phase: window.__GAME.S.phase,
  cont: document.getElementById("continueBtn").textContent.trim(),
  stars: document.getElementById("hubStars").textContent.trim(),
}));
R.hub = hub;
hub.phase === "hub" ? ok("Hub opens") : bad("Hub did not open", hub.phase);
/START HERE|CONTINUE/.test(hub.cont) ? ok("Start-here button labelled", hub.cont) : bad("Start button label", hub.cont);

// ---------- 4. two-step planet navigation ----------
const aim = () => page.evaluate(() => {
  const G = window.__GAME, T = G.THREE, c = G.camera();
  let b = null; G.scene().traverse(o => { if (!b && o.isMesh && o.userData && o.userData.kind === "planet" && o.userData.pi === 0) b = o; });
  const v = new T.Vector3(); b.getWorldPosition(v); v.project(c);
  return { x: (v.x * .5 + .5) * innerWidth, y: (-v.y * .5 + .5) * innerHeight };
});
let a = await aim(); await page.mouse.click(a.x, a.y); await settle(); await page.waitForTimeout(300);
const lvl1 = await page.evaluate(() => ({ lvl: window.__GAME.Hub.level, panel: document.getElementById("stagePanel").classList.contains("on") }));
await page.screenshot({ path: "qa/03-closeview.png" });
(lvl1.lvl === "planet" && !lvl1.panel) ? ok("1st click = close view only") : bad("1st click wrong", JSON.stringify(lvl1));

a = await aim(); await page.mouse.click(a.x, a.y); await page.waitForTimeout(800);
const lvl2 = await page.evaluate(() => ({ panel: document.getElementById("stagePanel").classList.contains("on"), n: document.querySelectorAll(".sBtn").length, locked: document.querySelectorAll(".sBtn.lock").length, next: document.querySelectorAll(".sBtn.next").length }));
await page.screenshot({ path: "qa/04-stages.png" });
(lvl2.panel && lvl2.n === 20) ? ok("2nd click = stage panel", `${lvl2.n} stages, ${lvl2.locked} locked, ${lvl2.next} highlighted`) : bad("2nd click wrong", JSON.stringify(lvl2));
lvl2.next === 1 ? ok("Next stage highlighted") : warn("Next-stage highlight", String(lvl2.next));

await page.click("#spBack"); await page.waitForTimeout(500);
const back1 = await page.evaluate(() => ({ lvl: window.__GAME.Hub.level, panel: document.getElementById("stagePanel").classList.contains("on") }));
(back1.lvl === "planet" && !back1.panel) ? ok("Back steps out one level") : bad("Back behaviour", JSON.stringify(back1));

// ---------- 5. gameplay: gates, right and wrong ----------
await page.evaluate(() => {
  const G = window.__GAME; window.__MODE = "right";
  window.__AP = setInterval(() => {
    if (G.S.qState !== "fly") return;
    const gs = G.gates(); if (!gs.length) return;
    const i = window.__MODE === "right" ? gs.findIndex(g => g.c) : gs.findIndex(g => !g.c);
    if (i < 0) return;
    G.S.lane = i; G.S.laneTarget = i; G.S.tween = null; G.S.queue.length = 0;
  }, 40);
});
await page.evaluate(() => window.__GAME.goStage(1, 1, 0));
await W(() => window.__GAME.S.qState === "fly");
const q = await page.evaluate(() => ({ lead: document.getElementById("qlead").textContent, row: document.getElementById("qbig").textContent.trim(), gates: window.__GAME.gates() }));
R.sampleQuestion = q;
(q.gates.filter(g => g.c).length === 1) ? ok("Exactly one correct gate", q.row + " → " + JSON.stringify(q.gates)) : bad("Gate correctness", JSON.stringify(q.gates));

await W(() => window.__GAME.S.correct > 0);
await page.waitForTimeout(250);
await page.screenshot({ path: "qa/05-correct.png" });
const c1 = await page.evaluate(() => ({ coins: window.__GAME.S.coins, filled: !!document.querySelector("#qbig .cell.blank.filled") }));
(c1.coins >= 10 && c1.filled) ? ok("Correct answer rewards + fills blank", "coins " + c1.coins) : bad("Correct-answer handling", JSON.stringify(c1));

await page.evaluate(() => window.__MODE = "wrong");
await W(() => window.__GAME.S.wrong > 0);
await page.waitForTimeout(250);
await page.screenshot({ path: "qa/06-wrong.png" });
const w1 = await page.evaluate(() => ({ coins: window.__GAME.S.coins, big: document.getElementById("fbBig").textContent, txt: document.getElementById("fbTxt").textContent }));
/It is/.test(w1.txt) ? ok("Wrong answer teaches the right one", w1.txt) : bad("Wrong-answer feedback", JSON.stringify(w1));

// rounds must keep advancing (this was a real bug once)
const adv = await page.evaluate(async () => {
  const G = window.__GAME, r0 = G.S.round;
  await new Promise(r => setTimeout(r, 60000));
  return { from: r0, to: G.S.round };
});
adv.to > adv.from ? ok("Rounds advance", `${adv.from} → ${adv.to}`) : bad("Stage stuck on one round", JSON.stringify(adv));
await page.evaluate(() => clearInterval(window.__AP));

// ---------- 6. collect + flash + line ----------
await page.evaluate(() => window.__GAME.goStage(0, 0, 0));
await W(() => window.__GAME.S.qState === "collect");
await page.waitForTimeout(1500);
await page.screenshot({ path: "qa/07-collect.png" });
const col = await page.evaluate(() => ({ tray: document.getElementById("tray").classList.contains("on"), orbs: window.__GAME.S.orbCount }));
(col.tray && col.orbs > 0) ? ok("Collect mode: ten-frame + gems", col.orbs + " gems") : bad("Collect mode", JSON.stringify(col));

const flashHold = await page.evaluate(async () => {
  const G = window.__GAME;
  G.goStage(0, 1, 0);
  const wait = f => new Promise(r => { const i = setInterval(() => { if (f()) { clearInterval(i); r(); } }, 30); });
  await wait(() => G.S.qState === "flash");
  const t = G.time(); await wait(() => G.S.qState !== "flash");
  return +(G.time() - t).toFixed(2);
});
flashHold >= 1.0 ? ok("Quick Look hold is readable", flashHold + "s") : bad("Quick Look too fast", flashHold + "s");

await page.evaluate(() => window.__GAME.goStage(2, 1, 0));
await W(() => window.__GAME.S.qState === "line");
await page.waitForTimeout(700);
await page.screenshot({ path: "qa/08-line.png" });
const ln = await page.evaluate(() => ({ ans: window.__GAME.S.q.answer, min: window.__GAME.S.q.min, max: window.__GAME.S.q.max, drop: document.getElementById("dropBtn").classList.contains("on") }));
await page.evaluate(() => { const G = window.__GAME, q = G.S.q; G.S.linePos = (q.answer - q.min) / Math.max(1, q.max - q.min); });
await page.waitForTimeout(250); await page.click("#dropBtn"); await page.waitForTimeout(900);
await page.screenshot({ path: "qa/09-line-result.png" });
const lnOk = await page.evaluate(() => window.__GAME.S.correct > 0);
(ln.drop && lnOk) ? ok("Number line scores a correct drop", `${ln.min}–${ln.max}, target ${ln.ans}`) : bad("Number line", JSON.stringify(ln));

// ---------- 7. question generation audit, all 75 stages ----------
const audit = await page.evaluate(() => {
  const G = window.__GAME, r = { n: 0, noAns: 0, dupe: 0, missing: 0, neg: 0, badLen: 0, teen: 0 };
  for (let pi = 0; pi < G.PLANETS.length; pi++)
    for (let mi = 0; mi < G.PLANETS[pi].moons.length; mi++)
      for (let s = 0; s < 5; s++)
        for (let k = 0; k < 24; k++) {
          const q = G.makeQuestion({ pi, mi, s, p: { lanes: 3 + Math.min(2, (s / 2) | 0), speed: 8, spacing: 28 } });
          r.n++;
          if (q.answer == null || isNaN(q.answer)) { r.noAns++; continue; }
          if (q.answer < 0) r.neg++;
          if (q.answer >= 11 && q.answer <= 19) r.teen++;
          if (q.options) {
            if (new Set(q.options).size !== q.options.length) r.dupe++;
            if (q.options.indexOf(q.answer) === -1) r.missing++;
            if (q.kind !== "compare" && q.kind !== "nearest" && q.options.length !== q.lanes) r.badLen++;
          }
        }
  return r;
});
R.audit = audit;
(audit.noAns + audit.dupe + audit.missing + audit.neg + audit.badLen === 0)
  ? ok("Question generator clean", `${audit.n} questions, ${Math.round(audit.teen / audit.n * 100)}% teens`)
  : bad("Question generator", JSON.stringify(audit));

const react = await page.evaluate(() => {
  const out = [];
  for (let s = 0; s < 5; s++) { const sp = 7.5 + s * 1.4; let g = 26 + s * 2; if (g / sp < 1.7) g = Math.ceil(sp * 1.7); out.push(g / sp); }
  return +Math.min(...out).toFixed(2);
});
react >= 1.7 ? ok("Reaction-time floor respected", react + "s min") : bad("Reaction time too short", react + "s");

// ---------- 8. audio ----------
const audio = await page.evaluate(async () => {
  const A = window.__GAME.Audio, g = A._debug();
  A.setOn("sfx", false); A.setOn("music", true);
  const music = await A._probe(1400);
  A.setOn("music", false); A.setOn("sfx", true);
  const sp = A._probe(1500); A.correct(3); setTimeout(() => A.coin(2), 250); setTimeout(() => A.wrong(), 650);
  const sfx = await sp;
  A.setOn("music", false); A.setOn("sfx", false);
  await new Promise(r => setTimeout(r, 350));
  const mp = A._probe(800); A.fanfare();
  const muted = await mp;
  A.setOn("music", true); A.setOn("sfx", true);
  return { state: g.state, graph: g.graph, music, sfx, muted };
});
R.audio = audio;
(audio.state === "running" && audio.music > 0.01 && audio.sfx > 0.05)
  ? ok("Audio produces signal", `music ${audio.music}, sfx ${audio.sfx}`) : bad("Audio", JSON.stringify(audio));
audio.muted < 0.02 ? ok("Mute silences everything", String(audio.muted)) : bad("Mute leaks", String(audio.muted));

R.errorsMain = [...new Set(errs)].slice(0, 10);
R.errorsMain.length === 0 ? ok("No console or network errors") : bad("Errors on main page", R.errorsMain.join(" | "));
await page.close();

// ---------- 9. responsive ----------
R.responsive = [];
for (const [n, w, h] of [["laptop-1366x625", 1366, 625], ["tablet-820x1180", 820, 1180],
["phone-390x740", 390, 740], ["phone-land-740x390", 740, 390], ["desktop-1920x950", 1920, 950]]) {
  const q2 = await B.newPage({ viewport: { width: w, height: h } });
  const e2 = [];
  q2.on("pageerror", e => e2.push(e.message));
  await q2.goto(URL, { waitUntil: "load" });
  await q2.waitForFunction(() => !document.getElementById("playBtn").disabled, null, { timeout: 120000 });
  const start = await q2.evaluate(() => { const wr = document.getElementById("start"), c = wr.querySelector(".card"), r = c.getBoundingClientRect(); return { clipped: r.top < -1, reach: wr.scrollHeight <= wr.clientHeight || r.top >= -1 }; });
  await q2.click("#playBtn"); await q2.waitForTimeout(1800);
  await q2.evaluate(() => window.__GAME.goStage(1, 0, 0));
  await q2.waitForFunction(() => window.__GAME.S.qState === "fly", null, { timeout: 120000, polling: 150 });
  await q2.waitForTimeout(600);
  await q2.screenshot({ path: `qa/vp-${n}.png` });
  const hud = await q2.evaluate(() => {
    const ids = ["prog", "qpanel", "coins", "tray", "streak", "pauseBtn", "menuBtn", "aLeft", "aRight", "dropBtn"], bx = {};
    for (const id of ids) { const e = document.getElementById(id); const r = e.getBoundingClientRect(); if (r.width > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0") bx[id] = r; }
    const ks = Object.keys(bx), off = [], ov = [];
    for (const k of ks) { const r = bx[k]; if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) off.push(k); }
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const A2 = bx[ks[i]], B2 = bx[ks[j]]; if (Math.min(A2.right, B2.right) - Math.max(A2.left, B2.left) > 2 && Math.min(A2.bottom, B2.bottom) - Math.max(A2.top, B2.top) > 2) ov.push(ks[i] + "×" + ks[j]); }
    return { off: off.join(",") || "-", ov: ov.join(",") || "-" };
  });
  R.responsive.push({ size: n, startClipped: start.clipped, off: hud.off, overlaps: hud.ov, errors: e2.length });
  await q2.close();
}
const respBad = R.responsive.filter(r => r.startClipped || r.off !== "-" || r.overlaps !== "-" || r.errors);
respBad.length === 0 ? ok("Responsive clean at 5 sizes") : bad("Responsive problems", JSON.stringify(respBad));

console.log(JSON.stringify(R, null, 1));
await B.close();
