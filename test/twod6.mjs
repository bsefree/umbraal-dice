import { DiceWorld } from '../js/physics.js';

const ROLLS = Number(process.argv[2] || 20000);
const world = new DiceWorld(8.3, 4.5);          // desktop arena for 2 dice
const kindToType = () => 'd6';

const sums = new Map();
const pairs = new Map();                         // ordered (a,b) -> count
const faceA = new Map(), faceB = new Map();
let timeouts = 0, totalTime = 0;

const t0 = Date.now();
for (let r = 0; r < ROLLS; r++) {
  world.throwDice(['d6', 'd6'], kindToType, 1);
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

const ways = { 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:5, 9:4, 10:3, 11:2, 12:1 };
console.log(`${ROLLS} rolls of 2D6 in ${secs.toFixed(1)}s   avg settle ${(totalTime/ROLLS).toFixed(2)}s   timeouts ${timeouts}\n`);

console.log('sum   observed   expected    diff     bar');
let chiSum = 0;
const obs = [], exp = [];
for (let s = 2; s <= 12; s++) {
  const o = sums.get(s) || 0;
  const e = ROLLS * ways[s] / 36;
  chiSum += (o - e) ** 2 / e;
  obs.push(o); exp.push(Math.round(e));
  const bar = '#'.repeat(Math.round(o / ROLLS * 200));
  console.log(`${String(s).padStart(3)}${String(o).padStart(11)}${e.toFixed(0).padStart(11)}${((o-e)/e*100).toFixed(1).padStart(8)}%  ${bar}`);
}
console.log(`\nchi2 on sums = ${chiSum.toFixed(2)}  (df=10, 95% crit 18.31, 99% crit 23.21)`);

// Mean and spread against theory.
let tot = 0, tot2 = 0;
for (const [s, n] of sums) { tot += s * n; tot2 += s * s * n; }
const mean = tot / ROLLS;
const sd = Math.sqrt(tot2 / ROLLS - mean * mean);
console.log(`mean ${mean.toFixed(4)} (expect 7)   sd ${sd.toFixed(4)} (expect 2.4152)`);

// Each die on its own.
for (const [label, h] of [['die 1', faceA], ['die 2', faceB]]) {
  const keys = [...h.keys()].sort((a, b) => a - b);
  const e = ROLLS / 6;
  const c = keys.reduce((acc, k) => acc + (h.get(k) - e) ** 2 / e, 0);
  console.log(`${label}: ${keys.map(k => `${k}:${h.get(k)}`).join(' ')}  chi2 ${c.toFixed(2)} (df=5, 99% crit 15.09)`);
}

// Do the two dice influence each other? 36 ordered outcomes should be flat.
let chiPair = 0;
const e36 = ROLLS / 36;
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const o = pairs.get(`${a},${b}`) || 0;
  chiPair += (o - e36) ** 2 / e36;
}
console.log(`\nindependence: chi2 on the 36 ordered pairs = ${chiPair.toFixed(2)}  (df=35, 99% crit 57.34)`);
console.log(JSON.stringify({ obs, exp }));
