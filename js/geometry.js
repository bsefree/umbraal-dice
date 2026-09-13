const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Fan-triangulates each polygon face. Material index is materialSrc + 1, which
// leaves the low indices free for the blank cap faces.
// `edges` holds polygon boundaries only -- fan triangulation invents interior
// diagonals, and outlining those puts a false crease across every face.
function makeGeom(vertices, faces, tab, af, customUVs) {
  const verts = vertices.map(norm3);
  const tris = [];
  const uvs = [];
  const edgeSet = new Set();

  faces.forEach((face, faceIdx) => {
    const idx = face.slice(0, -1);
    const materialSrc = face[face.length - 1];
    const fl = idx.length;
    const aa = (2 * Math.PI) / fl;

    const uv = customUVs
      ? (k) => customUVs[faceIdx][k]
      : (k) => {
          const angle = af + aa * k;
          return [
            (Math.cos(angle) + 1 + tab) / 2 / (1 + tab),
            (Math.sin(angle) + 1 + tab) / 2 / (1 + tab),
          ];
        };

    for (let j = 0; j < fl - 2; j++) {
      tris.push([idx[0], idx[j + 1], idx[j + 2], materialSrc + 1]);
      uvs.push([uv(0), uv(j + 1), uv(j + 2)]);
    }
    for (let k = 0; k < fl; k++) {
      const a = idx[k];
      const b = idx[(k + 1) % fl];
      edgeSet.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  });

  const edges = [...edgeSet]
    .map((s) => s.split(',').map(Number))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  return { verts, tris, uvs, edges };
}

// UVs for a kite face from its real edge lengths. The generic n-gon formula
// assumes equal edges; a kite's short edges are about half its long ones, and
// using it stretches the artwork visibly.
function flattenKiteUV(pEa, pMid, pEb, pApex, margin = 0.06) {
  const Lm = dist3(pEa, pMid);
  const La = dist3(pApex, pEa);
  const D = dist3(pMid, pApex);

  const H = (D * D - La * La + Lm * Lm) / (2 * D);
  const W = Math.sqrt(Math.max(Lm * Lm - H * H, 0));

  const pts = [[-W, H], [0, 0], [W, H], [0, D]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const scale = (1 - 2 * margin) / span;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;

  return pts.map((p) => [0.5 + (p[0] - cx) * scale, 0.5 + (p[1] - cy) * scale]);
}

export function createD6Geometry() {
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const faces = [
    [0, 3, 2, 1, 1], [1, 2, 6, 5, 2], [0, 1, 5, 4, 3],
    [3, 7, 6, 2, 4], [0, 4, 7, 3, 5], [4, 5, 6, 7, 6],
  ];
  return makeGeom(vertices, faces, 0.1, Math.PI / 4, null);
}

export function createD10Geometry() {
  const a = (Math.PI * 2) / 10;
  const h = 0.115;
  const vertices = [];
  let b = 0;
  for (let i = 0; i < 10; i++) {
    vertices.push([Math.cos(b), Math.sin(b), h * (i % 2 ? 1 : -1)]);
    b += a;
  }
  vertices.push([0, 0, -1]);
  vertices.push([0, 0, 1]);

  // Ten quad kites, each assembled from an equatorial pair plus the apex.
  // Keep them as quads: splitting a kite into two independent faces outlines
  // the split as though it were a real edge.
  const numbered = [
    [5, 7, 11, 0], [4, 2, 10, 1], [1, 3, 11, 2], [0, 8, 10, 3], [7, 9, 11, 4],
    [8, 6, 10, 5], [9, 1, 11, 6], [2, 0, 10, 7], [3, 5, 11, 8], [6, 4, 10, 9],
  ];
  const belts = [
    [1, 0, 2], [1, 2, 3], [3, 2, 4], [3, 4, 5], [5, 4, 6],
    [5, 6, 7], [7, 6, 8], [7, 8, 9], [9, 8, 0], [9, 0, 1],
  ];

  const faces = [];
  for (const [ea, eb, apex, materialSrc] of numbered) {
    const belt = belts.find((t) => t.includes(ea) && t.includes(eb));
    if (!belt) throw new Error(`no belt triangle for kite edge (${ea},${eb})`);
    faces.push([ea, belt.find((v) => v !== ea && v !== eb), eb, apex, materialSrc]);
  }

  const normalized = vertices.map(norm3);
  const customUVs = faces.map(([ea, mid, eb, apex]) =>
    flattenKiteUV(normalized[ea], normalized[mid], normalized[eb], normalized[apex]));

  return makeGeom(vertices, faces, 0, (Math.PI * 6) / 5, customUVs);
}

// capCount offsets the material numbering so a d6's faces land on 2..7 and a
// d10's on 1..10. readFaceValue subtracts one to get the printed value.
export const DIE_TYPES = {
  d6: {
    geometry: createD6Geometry,
    faceCount: 6,
    capCount: 2,
    radiusFactor: 0.86,
    mass: 300,
    useCornerMask: true,
  },
  d10: {
    geometry: createD10Geometry,
    faceCount: 10,
    capCount: 1,
    radiusFactor: 0.86,
    mass: 340,
    // The vignette assumes a square face and lands lopsided on a kite.
    useCornerMask: false,
  },
};

export function groupTrianglesByMaterial(tris, uvs) {
  const groups = new Map();
  tris.forEach((tri, i) => {
    const mat = tri[3];
    if (!groups.has(mat)) groups.set(mat, { tris: [], uvs: [] });
    const g = groups.get(mat);
    g.tris.push(tri.slice(0, 3));
    g.uvs.push(uvs[i]);
  });
  return groups;
}

// Outward normal, resolved against the centroid (dice are convex, origin-centred).
export function faceNormal(v0, v1, v2) {
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const l = Math.hypot(n[0], n[1], n[2]);
  if (l < 1e-9) return [0, 0, 1];
  const u = [n[0] / l, n[1] / l, n[2] / l];
  const c = [(v0[0] + v1[0] + v2[0]) / 3, (v0[1] + v1[1] + v2[1]) / 3, (v0[2] + v1[2] + v2[2]) / 3];
  return u[0] * c[0] + u[1] * c[1] + u[2] * c[2] < 0 ? [-u[0], -u[1], -u[2]] : u;
}

export function localFaceNormals(verts, tris) {
  const out = new Map();
  for (const [i0, i1, i2, mat] of tris) {
    if (!out.has(mat)) out.set(mat, faceNormal(verts[i0], verts[i1], verts[i2]));
  }
  return out;
}
