import * as CANNON from '../vendor/cannon-es.module.js';
import { DIE_TYPES, localFaceNormals, faceNormal } from './geometry.js';

// Z is up throughout, here and in the renderer.

const GRAVITY_Z = -32;
const WALL_HEIGHT = 11;   // lid height; also the ceiling for spawn layers

const SETTLE_LINEAR_EPS = 0.25;
const SETTLE_ANGULAR_EPS = 0.25;
const SETTLE_HOLD_TIME = 0.2;
const MAX_ROLL_TIME = 10;

const GROUND_RESTITUTION = 0.6;
const GROUND_FRICTION = 0.6;
const WALL_RESTITUTION = 0.2;
const WALL_FRICTION = 0;
const DIE_DIE_RESTITUTION = 0.3;
const DIE_DIE_FRICTION = 0.3;
const MASS_SCALE = 50;

const LINEAR_DAMPING = 0.12;
const ANGULAR_DAMPING = 0.04;

const FIXED_TIMESTEP = 1 / 120;
const MAX_SUBSTEPS = 8;

// Uniform random rotation. Without it every die starts on the same face and
// the results skew no matter how far it tumbles.
function randomQuaternion() {
  const u1 = Math.random();
  const u2 = Math.random();
  const u3 = Math.random();
  return new CANNON.Quaternion(
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  );
}

const hullCache = new Map();

// Hull is built from triangles, not the polygon faces: normalising the d10's
// vertices onto the unit sphere leaves its apex ~5% of the radius out of the
// kite's plane, and ConvexPolyhedron requires planar faces.
// Faces must also wind counter-clockwise seen from outside.
function convexHullFor(dieType, radius) {
  const key = `${dieType}@${radius.toFixed(5)}`;
  if (hullCache.has(key)) return hullCache.get(key);

  const { verts, tris } = DIE_TYPES[dieType].geometry();
  const s = verts.map((v) => [v[0] * radius, v[1] * radius, v[2] * radius]);

  const faces = tris.map(([i0, i1, i2]) => {
    const n = faceNormal(s[i0], s[i1], s[i2]);
    const e1 = [s[i1][0] - s[i0][0], s[i1][1] - s[i0][1], s[i1][2] - s[i0][2]];
    const e2 = [s[i2][0] - s[i0][0], s[i2][1] - s[i0][1], s[i2][2] - s[i0][2]];
    const raw = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    return raw[0] * n[0] + raw[1] * n[1] + raw[2] * n[2] > 0 ? [i0, i1, i2] : [i0, i2, i1];
  });

  const shape = new CANNON.ConvexPolyhedron({
    vertices: s.map((v) => new CANNON.Vec3(v[0], v[1], v[2])),
    faces,
  });
  hullCache.set(key, shape);
  return shape;
}

class Die {
  constructor(body, dieType, kind, normals) {
    this.body = body;
    this.dieType = dieType;
    this.kind = kind;
    this.faceNormals = normals;
    this.settledSince = null;
  }
}

export class DiceWorld {
  constructor(arenaX = 8, arenaY = 6) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, GRAVITY_Z) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    this.world.solver.iterations = 12;

    this.groundMat = new CANNON.Material('ground');
    this.wallMat = new CANNON.Material('wall');
    this.dieMat = new CANNON.Material('die');

    this.world.addContactMaterial(new CANNON.ContactMaterial(this.groundMat, this.dieMat, {
      restitution: GROUND_RESTITUTION, friction: GROUND_FRICTION,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.wallMat, this.dieMat, {
      restitution: WALL_RESTITUTION, friction: WALL_FRICTION,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.dieMat, this.dieMat, {
      restitution: DIE_DIE_RESTITUTION, friction: DIE_DIE_FRICTION,
    }));

    this.dice = [];
    this.simTime = 0;
    this._staticBodies = [];
    this.setArena(arenaX, arenaY);
  }

  // Planes, not boxes. Convex-vs-large-box contacts in cannon produce bad
  // normals: dice gain energy on every bounce and eventually tunnel through
  // the floor. Plane-vs-convex uses a different routine and is stable.
  setArena(arenaX, arenaY) {
    this.arenaX = arenaX;
    this.arenaY = arenaY;
    for (const b of this._staticBodies) this.world.removeBody(b);
    this._staticBodies = [];

    // A plane's solid side is below its normal, so the normal faces the dice.
    const addPlane = (normal, point, material) => {
      const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane() });
      body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(...normal));
      body.position.set(...point);
      this.world.addBody(body);
      this._staticBodies.push(body);
    };

    addPlane([0, 0, 1], [0, 0, 0], this.groundMat);
    addPlane([-1, 0, 0], [arenaX, 0, 0], this.wallMat);
    addPlane([1, 0, 0], [-arenaX, 0, 0], this.wallMat);
    addPlane([0, -1, 0], [0, arenaY, 0], this.wallMat);
    addPlane([0, 1, 0], [0, -arenaY, 0], this.wallMat);
    addPlane([0, 0, -1], [0, 0, WALL_HEIGHT], this.wallMat);
  }

  clearDice() {
    for (const die of this.dice) this.world.removeBody(die.body);
    this.dice = [];
    this.simTime = 0;
  }

  spawnDie(dieType, kind, position, velocity, angularVelocity, scale = 1) {
    const cfg = DIE_TYPES[dieType];
    const body = new CANNON.Body({
      mass: cfg.mass / MASS_SCALE,
      material: this.dieMat,
      position: new CANNON.Vec3(...position),
      quaternion: randomQuaternion(),
      linearDamping: LINEAR_DAMPING,
      angularDamping: ANGULAR_DAMPING,
    });
    body.addShape(convexHullFor(dieType, scale * cfg.radiusFactor));
    body.velocity.set(...velocity);
    body.angularVelocity.set(...angularVelocity);
    this.world.addBody(body);

    const { verts, tris } = cfg.geometry();
    const die = new Die(body, dieType, kind, localFaceNormals(verts, tris));
    this.dice.push(die);
    return die;
  }

  throwDice(kinds, kindToType, scale = 1) {
    this.clearDice();
    const n = kinds.length;
    const radius = 0.86 * scale;
    const minGap = radius * 2.4;
    const limX = Math.max(radius, this.arenaX - radius * 1.3);
    const limY = Math.max(radius, this.arenaY - radius * 1.3);
    const layerStep = 2.4 * scale;

    // Scattered by rejection sampling rather than laid on a grid: pick a random
    // spot, keep it if it clears the dice already placed, otherwise try again.
    // When a layer runs out of room the next die starts a fresh layer above it,
    // so a big handful stacks instead of spawning inside itself.
    let layer = 0;
    let placed = [];
    const spread = () => [(Math.random() * 2 - 1) * limX, (Math.random() * 2 - 1) * limY];
    const clearance = (x, y) => {
      let gap = Infinity;
      for (const p of placed) gap = Math.min(gap, Math.hypot(x - p[0], y - p[1]));
      return gap;
    };

    const dice = [];
    for (let i = 0; i < n; i++) {
      let best = spread();
      let bestGap = clearance(best[0], best[1]);
      for (let a = 1; a < 24 && bestGap < minGap; a++) {
        const cand = spread();
        const gap = clearance(cand[0], cand[1]);
        if (gap > bestGap) {
          best = cand;
          bestGap = gap;
        }
      }
      if (bestGap < minGap && placed.length) {
        layer++;
        placed = [];
        best = spread();
      }
      placed.push(best);

      const [x, y] = best;
      // Capped below the lid. A die spawned above it starts inside solid space
      // and gets slammed back down.
      const z = Math.min(
        3 * scale + layer * layerStep + Math.random() * 0.6 * scale,
        WALL_HEIGHT - 1.5 * scale);

      // Sideways fling plus a small pop, biased gently back toward the middle
      // so a die spawned near a wall does not simply drop against it.
      const speed = 1.6 + Math.random() * 2.2;
      const dir = Math.random() * Math.PI * 2;
      const vel = [
        Math.cos(dir) * speed - x * 0.3,
        Math.sin(dir) * speed - y * 0.3,
        0.2 + Math.random(),
      ];
      const spin = () => (Math.random() * 2 - 1) * (9 + Math.random() * 13);
      dice.push(this.spawnDie(kindToType(kinds[i]), kinds[i], [x, y, z],
        vel, [spin(), spin(), spin()], scale));
    }
    return dice;
  }

  step(dt) {
    this.world.step(FIXED_TIMESTEP, dt, MAX_SUBSTEPS);
    this.simTime += dt;

    let allSettled = true;
    for (const die of this.dice) {
      const v = die.body.velocity;
      const w = die.body.angularVelocity;
      const still = Math.hypot(v.x, v.y, v.z) < SETTLE_LINEAR_EPS
        && Math.hypot(w.x, w.y, w.z) < SETTLE_ANGULAR_EPS;
      if (!still) {
        die.settledSince = null;
        allSettled = false;
      } else if (die.settledSince === null) {
        die.settledSince = this.simTime;
        allSettled = false;
      } else if (this.simTime - die.settledSince < SETTLE_HOLD_TIME) {
        allSettled = false;
      }
    }
    if (this.simTime > MAX_ROLL_TIME) allSettled = true;
    return allSettled && this.dice.length > 0;
  }

  // Whichever face normal points closest to straight up.
  readFaceValue(die) {
    let bestMat = null;
    let bestDot = -2;
    const q = die.body.quaternion;
    const tmp = new CANNON.Vec3();
    for (const [mat, n] of die.faceNormals) {
      tmp.set(n[0], n[1], n[2]);
      const z = q.vmult(tmp).z;
      if (z > bestDot) {
        bestDot = z;
        bestMat = mat;
      }
    }
    return bestMat - 1;
  }
}
