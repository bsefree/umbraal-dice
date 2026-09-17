import { DiceWorld } from '../js/physics.js';

const ROLLS = Number(process.argv[2] || 20000);
const world = new DiceWorld(8.3, 4.5);
const kindToType = () => 'd10';

const sums = new Map(), pairs = new Map();
const faceA = new Map(), faceB = new Map();
let timeouts = 0, totalTime = 0;

const t0 = Date.now();
for (let r = 0; r < ROLLS; r++) {
  world.throwDice(['d10_red', 'd10_red'], kindToType, 1);
  let settled = false, guard = 0;
  while (!settled && guard < 1200) { settled = world.step(1 / 60); guard++; }
  totalTime += world.simTime;
  if (world.simTime >= 10) timeouts++;
  const a = world.readFaceValue(world.dice[0]);
  const b = world.readFaceValue(world.dice[1]);
  sums.set(a + b, (sums.get(a + b) || 0) + 1);
  pairs.set(`${a},${b}`, (pairs.get(`${a},${b}`) || 0) + 1);
  faceA.set(a, (faceA.get(a) || 0) + 1);
  faceB.set(b, (faceB.get(b) || 0) + 1);
}
const secs = (Date.now() - t0) / 1000;
console.log(`${ROLLS} rolls of 2D10 in ${secs.toFixed(1)}s   avg settle ${(totalTime/ROLLS).toFixed(2)}s   timeouts ${timeouts}\n`);

// Two dice reading 0-9: sums 0-18, ways rise 1..10 then fall.
const ways = (s) => (s <= 9 ? s + 1 : 19 - s);
console.log('sum   observed   expected    diff     bar');
let chiSum = 0; const obs = [], exp = [];
for (let s = 0; s <= 18; s++) {
  const o = sums.get(s) || 0;
  const e = ROLLS * ways(s) / 100;
  chiSum += (o - e) ** 2 / e;
  obs.push(o); exp.push(Math.round(e));
  console.log(`${String(s).padStart(3)}${String(o).padStart(11)}${e.toFixed(0).padStart(11)}${((o-e)/e*100).toFixed(1).padStart(8)}%  ${'#'.repeat(Math.round(o/ROLLS*300))}`);
}
console.log(`\nchi2 on sums = ${chiSum.toFixed(2)}  (df=18, 95% crit 28.87, 99% crit 34.81)`);

let tot = 0, tot2 = 0;
for (const [s, n] of sums) { tot += s * n; tot2 += s * s * n; }
const mean = tot / ROLLS, sd = Math.sqrt(tot2 / ROLLS - mean * mean);
console.log(`mean ${mean.toFixed(4)} (expect 9)   sd ${sd.toFixed(4)} (expect ${Math.sqrt(2*(100-1)/12).toFixed(4)})`);

for (const [label, h] of [['die 1', faceA], ['die 2', faceB]]) {
  const keys = [...h.keys()].sort((a, b) => a - b);
  const e = ROLLS / 10;
  const c = keys.reduce((acc, k) => acc + (h.get(k) - e) ** 2 / e, 0);
  console.log(`${label}: ${keys.map(k => `${k}:${h.get(k)}`).join(' ')}`);
  console.log(`        chi2 ${c.toFixed(2)} (df=9, 99% crit 21.67)`);
}

let chiPair = 0; const e100 = ROLLS / 100;
for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) {
  const o = pairs.get(`${a},${b}`) || 0;
  chiPair += (o - e100) ** 2 / e100;
}
console.log(`\nindependence: chi2 on the 100 ordered pairs = ${chiPair.toFixed(2)}  (df=99, 99% crit 135.8)`);

// Percentile use: high die as tens, low as units, 00 read as 100.
let pct = 0, pct2 = 0;
for (const [k, n] of pairs) {
  const [a, b] = k.split(',').map(Number);
  const v = a * 10 + b === 0 ? 100 : a * 10 + b;
  pct += v * n; pct2 += v * v * n;
}
const pm = pct / ROLLS;
console.log(`as percentile (00 = 100): mean ${pm.toFixed(3)} (expect 50.5)  sd ${Math.sqrt(pct2/ROLLS - pm*pm).toFixed(3)} (expect 28.866)`);
console.log(JSON.stringify({ obs, exp }));
