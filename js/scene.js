import * as THREE from '../vendor/three.module.min.js';
import { DIE_TYPES, groupTrianglesByMaterial, faceNormal } from './geometry.js';
import { DIE_VARIANTS, NUMERIC_EDGE_COLOR } from './textures.js';
import { DiceWorld } from './physics.js';
import { preloadKind, texturesFor } from './facepreview.js';

export const CONFIG = {
  cameraElevation: 75,
  fov: 42,

  // Ambient sets the floor -- how close a face pointing away from the light
  // gets to its true painted colour. The key adds the shading on top.
  // Raise all three together (or use lightBoost) for overall brightness;
  // raise ambient alone, or lower the key, to soften the shading further.
  ambient: 0.95,
  keyLight: { intensity: 0.45, position: [3, -4, 8] },
  fillLight: { intensity: 0.18, position: [-4, 3, 3] },
  // Single multiplier over all three, for tuning without touching the ratio.
  lightBoost: 1,

  // Compensates the table for the brighter lighting so it stays as it was.
  areaPerDie: 28.8,
  arenaMin: 4.5,
  arenaMax: 16,

  edgeColor: 0x1a1a1a,
  tableBrightness: 0.93,  // multiplies the table texture only, not the dice
  shadows: true,
  shadowMapSize: 2048,
  maxPixelRatio: 2,
};

const SEARCH_MAX_DISTANCE = 400;

const KIND_TO_TYPE = (kind) => (DIE_VARIANTS[kind] ? DIE_VARIANTS[kind].type : kind);

export class DiceScene {
  constructor(canvas, { assetsDir = 'assets/dice', fontFamily = 'sans-serif', mobile = false } = {}) {
    this.canvas = canvas;
    this.assetsDir = assetsDir;
    this.fontFamily = fontFamily;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !mobile,
      powerPreference: mobile ? 'low-power' : 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (CONFIG.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, 1, 0.5, 2000);
    this.camera.up.set(0, 0, 1);

    this._buildLights();
    this._buildTable();

    this.world = new DiceWorld(9, 6.5);
    this.meshes = [];
    this.materialCache = new Map();
    this.geometryCache = new Map();

    this.rolling = false;
    this._running = false;
    this._raf = null;
    this._lastFrame = null;
    this._onSettled = null;

    this.arenaX = 9;
    this.arenaY = 6.5;
    this.resize();
  }

  _buildLights() {
    const boost = CONFIG.lightBoost ?? 1;
    this.scene.add(new THREE.AmbientLight(0xffffff, CONFIG.ambient * boost));

    const key = new THREE.DirectionalLight(0xfff4e2, CONFIG.keyLight.intensity * boost);
    key.position.set(...CONFIG.keyLight.position);
    if (CONFIG.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(CONFIG.shadowMapSize, CONFIG.shadowMapSize);
      key.shadow.bias = -0.0015;
      key.shadow.normalBias = 0.02;
    }
    this.scene.add(key, key.target);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(0xdde6ff, CONFIG.fillLight.intensity * boost);
    fill.position.set(...CONFIG.fillLight.position);
    this.scene.add(fill);
  }

  _buildTable() {
    this.tableMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.table = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.tableMaterial);
    this.table.receiveShadow = CONFIG.shadows;
    this.scene.add(this.table);
  }

  async loadTable(url) {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    // Stretched to fit rather than tiled, so clamp past the edges.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.tableMaterial.map = texture;
    this.tableMaterial.color.setScalar(CONFIG.tableBrightness);
    this.tableMaterial.needsUpdate = true;
    this._layoutTable();
    this.requestRender();
  }

  // The walled area is the largest rectangle that fits the screen, so the
  // screen corners fall outside it. The table is drawn much larger to cover them.
  // Where the four corners of the view meet the table, in world units.
  _visibleGround() {
    const corner = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const eye = this.camera.position;
    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;

    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corner.set(nx, ny, 0.5).unproject(this.camera);
      dir.copy(corner).sub(eye).normalize();
      // A ray angled above the horizon never lands; fall back to a distance
      // well past anything that could be on screen.
      const t = dir.z < -1e-6 ? -eye.z / dir.z : 1000;
      const x = eye.x + dir.x * t;
      const y = eye.y + dir.y * t;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
  }

  // The plane is sized to the visible ground rather than to some fixed
  // multiple of the rolling area. Oversizing it meant the screen showed only
  // the middle of the stretched image and the clamped edge pixels smeared
  // across everything beyond it.
  _layoutTable() {
    const g = this._visibleGround();
    const margin = 1.06;
    const w = (g.maxX - g.minX) * margin;
    const h = (g.maxY - g.minY) * margin;

    this.table.scale.set(w, h, 1);
    this.table.position.set((g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2, 0);

    const map = this.tableMaterial.map;
    if (map && map.image) {
      // Fit like a cover background: fill the plane, keep the image's own
      // proportions, crop whatever overflows.
      const tw = map.image.width;
      const th = map.image.height;
      const scale = Math.max(w / tw, h / th);
      const rx = w / scale / tw;
      const ry = h / scale / th;
      map.repeat.set(rx, ry);
      map.offset.set((1 - rx) / 2, (1 - ry) / 2);
    }
  }

  // Area grows with the dice count, so one die fills the screen and fifty get
  // room to scatter. Proportions follow the viewport, corrected for the
  // foreshortening the camera tilt applies to the depth axis.
  frame(diceCount = 0) {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const aspect = w / h;
    const elev = THREE.MathUtils.degToRad(CONFIG.cameraElevation);
    const effAspect = aspect / Math.sin(elev);

    const wanted = Math.sqrt((CONFIG.areaPerDie * Math.max(diceCount, 1)) / (4 * effAspect));
    this.arenaY = THREE.MathUtils.clamp(wanted, CONFIG.arenaMin, CONFIG.arenaMax);
    this.arenaX = this.arenaY * effAspect;
    this.camera.aspect = aspect;

    // Bisect for the closest distance that still holds all four corners.
    // Solving it directly means handling the trapezoid the tilt produces.
    //
    // far has to be pushed out of the way first. The fit test rejects points
    // beyond the far plane, so leaving it tight makes the test false at long
    // range as well as short, and the search walks past the band that fits
    // and pins to its upper bound.
    this.camera.near = 0.5;
    this.camera.far = SEARCH_MAX_DISTANCE * 4;

    const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(
      ([sx, sy]) => new THREE.Vector3(sx * this.arenaX, sy * this.arenaY, 0));
    const fitsAt = (d) => {
      this.camera.position.set(0, -d * Math.cos(elev), d * Math.sin(elev));
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1;
      });
    };
    let lo = 1;
    let hi = SEARCH_MAX_DISTANCE;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fitsAt(mid)) hi = mid; else lo = mid;
    }
    const distance = hi * 1.01;
    fitsAt(distance);

    this.camera.near = Math.max(0.1, distance * 0.05);
    this.camera.far = distance * 4;
    this.camera.updateProjectionMatrix();

    this.world.setArena(this.arenaX, this.arenaY);
    this._layoutTable();

    if (CONFIG.shadows) {
      const r = Math.max(this.arenaX, this.arenaY) * 1.3;
      const dir = new THREE.Vector3(...CONFIG.keyLight.position).normalize();
      this.keyLight.position.copy(dir.multiplyScalar(Math.max(20, r * 2)));
      const cam = this.keyLight.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = r * 6;
      cam.updateProjectionMatrix();
    }
  }

  resize() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
    this.renderer.setSize(
      this.canvas.clientWidth || window.innerWidth,
      this.canvas.clientHeight || window.innerHeight,
      false,
    );
    this.frame(this.meshes.length);
    this._containDice();
    this.requestRender();
  }

  // Turning a phone narrows the table. Nothing is stepping the physics once
  // the dice have settled, so the walls cannot push a stranded die back in.
  _containDice() {
    if (this.rolling) return;
    const margin = 0.9;
    let moved = false;
    for (const die of this.world.dice) {
      const p = die.body.position;
      const x = THREE.MathUtils.clamp(p.x, -this.arenaX + margin, this.arenaX - margin);
      const y = THREE.MathUtils.clamp(p.y, -this.arenaY + margin, this.arenaY - margin);
      if (x !== p.x || y !== p.y) {
        p.x = x;
        p.y = y;
        moved = true;
      }
    }
    if (moved) this._syncMeshes();
  }

  _geometryFor(dieType) {
    if (this.geometryCache.has(dieType)) return this.geometryCache.get(dieType);

    const cfg = DIE_TYPES[dieType];
    const { verts, tris, uvs, edges } = cfg.geometry();
    const r = cfg.radiusFactor;
    const s = verts.map((v) => [v[0] * r, v[1] * r, v[2] * r]);

    const positions = [];
    const normals = [];
    const uvArray = [];
    const groups = [];

    const byMaterial = groupTrianglesByMaterial(tris, uvs);
    let start = 0;
    for (const materialIndex of [...byMaterial.keys()].sort((a, b) => a - b)) {
      const g = byMaterial.get(materialIndex);
      // One normal for the whole face. Per-triangle normals leave a lighting
      // seam down the middle of every quad, worst on the d10's kites.
      const [a, b, c] = g.tris[0];
      const n = faceNormal(s[a], s[b], s[c]);
      for (let t = 0; t < g.tris.length; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = g.tris[t][k];
          positions.push(s[vi][0], s[vi][1], s[vi][2]);
          normals.push(n[0], n[1], n[2]);
          uvArray.push(g.uvs[t][k][0], g.uvs[t][k][1]);
        }
      }
      const count = g.tris.length * 3;
      groups.push([start, count, materialIndex]);
      start += count;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
    for (const [st, ct, m] of groups) geometry.addGroup(st, ct, m);

    const edgePositions = [];
    for (const [i, j] of edges) edgePositions.push(...s[i], ...s[j]);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));

    const result = { faces: geometry, edges: edgeGeometry };
    this.geometryCache.set(dieType, result);
    return result;
  }

  async ensureKind(kind) {
    if (this.materialCache.has(kind)) return;
    await preloadKind(kind, this.assetsDir, this.fontFamily);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const materials = [];
    for (const [materialIndex, canvas] of texturesFor(kind)) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, maxAniso);
      materials[materialIndex] = new THREE.MeshPhongMaterial({
        map: texture,
        shininess: 6,
        specular: 0x0a0a0a,
        // Nudge faces back so the edge pass wins the depth test cleanly.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }
    for (let i = 0; i < materials.length; i++) {
      if (!materials[i]) materials[i] = new THREE.MeshBasicMaterial({ visible: false });
    }
    this.materialCache.set(kind, materials);
  }

  _makeDieMesh(kind) {
    const { faces, edges } = this._geometryFor(KIND_TO_TYPE(kind));
    const mesh = new THREE.Mesh(faces, this.materialCache.get(kind));
    mesh.castShadow = CONFIG.shadows;

    const variant = DIE_VARIANTS[kind];
    const color = variant ? (variant.edgeColor ?? CONFIG.edgeColor) : NUMERIC_EDGE_COLOR;
    mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color })));
    return mesh;
  }

  clearDice() {
    for (const mesh of this.meshes) this.scene.remove(mesh);
    this.meshes = [];
    this.world.clearDice();
    this.requestRender();
  }

  // Resolves with one { kind, dieType, value } per die, in the order given.
  // value is 1-6 for a d6 and 0-9 for a d10.
  async roll(kinds) {
    for (const kind of new Set(kinds)) await this.ensureKind(kind);

    this.clearDice();
    this.frame(kinds.length);

    for (const die of this.world.throwDice(kinds, KIND_TO_TYPE, 1)) {
      const mesh = this._makeDieMesh(die.kind);
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this._syncMeshes();

    this.rolling = true;
    this._lastFrame = null;
    this.start();

    return new Promise((resolve) => {
      this._onSettled = () => resolve(this.world.dice.map((die) => ({
        kind: die.kind,
        dieType: die.dieType,
        value: this.world.readFaceValue(die),
      })));
    });
  }

  _syncMeshes() {
    this.world.dice.forEach((die, i) => {
      const mesh = this.meshes[i];
      if (!mesh) return;
      const p = die.body.position;
      const q = die.body.quaternion;
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
    });
  }

  requestRender() {
    this._needsRender = true;
    if (!this._running) this.start();
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      this._raf = null;
      if (!this._running) return;
      this._frame();
      if (this._running) this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  _frame() {
    const now = performance.now();
    let dt = this._lastFrame === null ? 1 / 60 : (now - this._lastFrame) / 1000;
    this._lastFrame = now;
    // Clamped so a backgrounded tab does not hand the sim a huge step.
    dt = Math.min(Math.max(dt, 1 / 240), 0.05);

    if (this.rolling) {
      const settled = this.world.step(dt);
      this._syncMeshes();
      this.renderer.render(this.scene, this.camera);
      if (settled) {
        this.rolling = false;
        const cb = this._onSettled;
        this._onSettled = null;
        if (cb) cb();
        this._needsRender = true;
      }
      return;
    }

    if (this._needsRender) {
      this._needsRender = false;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // Nothing moving: park the loop rather than redraw a static table.
    this.stop();
  }
}
