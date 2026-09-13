import { DIE_TYPES, createD10Geometry, groupTrianglesByMaterial } from './geometry.js';
import { DIE_VARIANTS, buildImageVariantTextures, buildNumericDieTextures, loadImage } from './textures.js';

let kiteUV = null;

// All ten kites are congruent, so one set of corners covers the type.
function getKiteUV() {
  if (kiteUV) return kiteUV;
  const { tris, uvs } = createD10Geometry();
  const g = groupTrianglesByMaterial(tris, uvs).get(1);
  const [ea, mid, eb] = g.uvs[0];
  kiteUV = [ea, mid, eb, g.uvs[1][2]];
  return kiteUV;
}

// UV v runs bottom-up, canvas y runs top-down, hence the flip. Pixels are
// already the right way round and are not touched.
function cropToKite(faceCanvas) {
  const w = faceCanvas.width;
  const h = faceCanvas.height;
  const pts = getKiteUV().map(([u, v]) => [u * w, (1 - v) * h]);

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));

  const out = document.createElement('canvas');
  out.width = Math.min(w, Math.ceil(Math.max(...xs))) - x0;
  out.height = Math.min(h, Math.ceil(Math.max(...ys))) - y0;

  const ctx = out.getContext('2d');
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - x0, y - y0) : ctx.moveTo(x - x0, y - y0)));
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(faceCanvas, -x0, -y0);
  return out;
}

// Flat previews only, not the dice themselves.
const FLIP_PREVIEW = new Set(['d6_yellow', 'd6_black']);

function rotate180(src) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.translate(src.width, src.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(src, 0, 0);
  return out;
}

const textureCache = new Map();
const faceCache = new Map();

export async function preloadKind(kind, assetsDir, fontFamily) {
  if (textureCache.has(kind)) return textureCache.get(kind);
  const variant = DIE_VARIANTS[kind];
  const cfg = DIE_TYPES[variant ? variant.type : kind];

  const textures = variant
    ? buildImageVariantTextures(
        await loadImage(`${assetsDir}/${variant.image}`),
        cfg.faceCount, cfg.capCount, variant, cfg.useCornerMask)
    : buildNumericDieTextures(cfg.faceCount, cfg.capCount, fontFamily);

  textureCache.set(kind, textures);
  return textures;
}

export const texturesFor = (kind) => textureCache.get(kind);

// readFaceValue returns material - 1, so the texture for a value is always
// at material value + 1 regardless of capCount.
export function faceImage(kind, value) {
  const key = `${kind}:${value}`;
  if (faceCache.has(key)) return faceCache.get(key);

  const textures = textureCache.get(kind);
  const src = textures && textures.get(value + 1);
  if (!src) return null;

  const variant = DIE_VARIANTS[kind];
  let out = (variant ? variant.type : kind) === 'd10' ? cropToKite(src) : src;
  if (FLIP_PREVIEW.has(kind)) out = rotate180(out);
  faceCache.set(key, out);
  return out;
}

// Face shown in the picker. Blank faces would make the three d6 types
// indistinguishable, so each one shows its sigil.
export const PREVIEW_VALUE = {
  d6: 6,
  d10_yellow: 0,
  d10_red: 0,
  d10_black: 0,
  d6_yellow: 2,
  d6_black: 2,
};
