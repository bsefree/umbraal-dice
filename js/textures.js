// color = die body, pen = icon ink, back = corner blend.
// edgeColor overrides the default wireframe where it would not show up.
export const DIE_VARIANTS = {
  d6_black: {
    type: 'd6', image: 'faces_d6_black.png',
    color: [0x1c, 0x1c, 0x1c], pen: [0xff, 0xff, 0xff], back: [0x10, 0x10, 0x10],
    borderMult: 0.1, edgeColor: 0xd1d1d1,
  },
  d6_yellow: {
    type: 'd6', image: 'faces_d6_yellow.png',
    color: [0xe0, 0xc0, 0x20], pen: [0x00, 0x00, 0x00], back: [0xa8, 0x8c, 0x10],
    borderMult: 0.1,
  },
  d10_black: {
    type: 'd10', image: 'faces_d10_black.png',
    color: [0x1c, 0x1c, 0x1c], pen: [0xff, 0xff, 0xff], back: [0x10, 0x10, 0x10],
    borderMult: 0.1, edgeColor: 0xd1d1d1,
  },
  d10_red: {
    type: 'd10', image: 'faces_d10_red.png',
    color: [0x8c, 0x10, 0x10], pen: [0xff, 0xe0, 0x8a], back: [0x5a, 0x08, 0x08],
    borderMult: 0.1,
  },
  d10_yellow: {
    type: 'd10', image: 'faces_d10_yellow.png',
    color: [0xe0, 0xc0, 0x20], pen: [0x00, 0x00, 0x00], back: [0xa8, 0x8c, 0x10],
    borderMult: 0.1,
  },
};

export const NUMERIC_LABEL_COLOR = [0xff, 0xd7, 0x00];
export const NUMERIC_DIE_COLOR = [0x20, 0x20, 0x20];
export const NUMERIC_EDGE_COLOR = 0x8a7a30;

const LABELS = [' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const maskCache = new WeakMap();

// The mask is the atlas's last cell. The -3 is real: the d6 sheets are 1789px
// wide where seven 256px cells would be 1792, so the mask starts three pixels
// early and ends flush with the edge.
function cornerMaskAlpha(atlas, cellSize, cornerMaskIndex) {
  let perAtlas = maskCache.get(atlas);
  if (!perAtlas) {
    perAtlas = new Map();
    maskCache.set(atlas, perAtlas);
  }
  if (perAtlas.has(cornerMaskIndex)) return perAtlas.get(cornerMaskIndex);

  const s = cellSize;
  const ctx = newCanvas(s, s).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(atlas, cornerMaskIndex * s - 3, 0, s, s, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  const out = new Float32Array(s * s);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] / 255;
  perAtlas.set(cornerMaskIndex, out);
  return out;
}

// faceIndex null gives a blank cap face. The icon's alpha selects between the
// body colour and the ink colour; the mask then blends toward `back`.
export function makeImageFaceTexture(atlas, cellSize, cornerMaskIndex, faceIndex,
  color, pen, back, borderMult, useCornerMask = true) {
  const s = cellSize;
  const canvas = newCanvas(s, s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (faceIndex === null) {
    ctx.fillStyle = `rgb(${back[0]},${back[1]},${back[2]})`;
    ctx.fillRect(0, 0, s, s);
    return canvas;
  }

  const border = Math.round(s * borderMult);
  const inner = s - border * 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(atlas, faceIndex * s, 0, s, s, border, border, inner, inner);

  const imageData = ctx.getImageData(0, 0, s, s);
  const px = imageData.data;
  const mask = useCornerMask ? cornerMaskAlpha(atlas, s, cornerMaskIndex) : null;

  for (let i = 0, p = 0; i < s * s; i++, p += 4) {
    const t = 1 - px[p + 3] / 255;
    const tt = mask ? mask[i] : 1;
    for (let c = 0; c < 3; c++) {
      px[p + c] = (color[c] * t + pen[c] * (1 - t)) * tt + back[c] * (1 - tt);
    }
    px[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function buildImageVariantTextures(atlas, faceCount, capCount, variant, useCornerMask = true) {
  const cellSize = atlas.naturalHeight || atlas.height;
  const { color, pen, back } = variant;
  const borderMult = variant.borderMult ?? 0.1;

  const textures = new Map();
  for (let c = 0; c < capCount; c++) {
    textures.set(c, makeImageFaceTexture(atlas, cellSize, faceCount, null,
      color, pen, back, borderMult, useCornerMask));
  }
  for (let f = 0; f < faceCount; f++) {
    textures.set(capCount + f, makeImageFaceTexture(atlas, cellSize, faceCount, f,
      color, pen, back, borderMult, useCornerMask));
  }
  return textures;
}

export function makeNumericFaceTexture(label, size, fontFamily,
  labelColor = NUMERIC_LABEL_COLOR, dieColor = NUMERIC_DIE_COLOR) {
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgb(${dieColor[0]},${dieColor[1]},${dieColor[2]})`;
  ctx.fillRect(0, 0, size, size);
  if (label.trim()) {
    ctx.fillStyle = `rgb(${labelColor[0]},${labelColor[1]},${labelColor[2]})`;
    ctx.font = `${Math.round(size * 0.75)}px ${fontFamily}`;
    ctx.textAlign = 'center';
    // Centre on the glyph's ink box, not the line box, or tall ascenders sit high.
    const m = ctx.measureText(label);
    ctx.fillText(label, size / 2, size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }
  return canvas;
}

export function buildNumericDieTextures(faceCount, capCount, fontFamily, size = 256) {
  const textures = new Map();
  for (let m = 0; m < capCount; m++) {
    textures.set(m, makeNumericFaceTexture(' ', size, fontFamily));
  }
  for (let f = 0; f < faceCount; f++) {
    const mi = capCount + f;
    textures.set(mi, makeNumericFaceTexture(
      mi < LABELS.length ? LABELS[mi] : String(f + 1), size, fontFamily));
  }
  return textures;
}
