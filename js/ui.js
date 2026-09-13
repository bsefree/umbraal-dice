import { faceImage, PREVIEW_VALUE } from './facepreview.js';

export const MAX_PER_TYPE = 9;

export const DICE_TYPES = [
  { kind: 'd6', label: 'Number D6' },
  { kind: 'd10_yellow', label: 'Yellow D10' },
  { kind: 'd10_red', label: 'Red D10' },
  { kind: 'd10_black', label: 'Black D10' },
  { kind: 'd6_yellow', label: 'Yellow D6' },
  { kind: 'd6_black', label: 'Black D6' },
];

const urlCache = new Map();

function imgFrom(key, build) {
  if (!urlCache.has(key)) {
    const canvas = build();
    if (!canvas) return null;
    urlCache.set(key, { url: canvas.toDataURL(), w: canvas.width, h: canvas.height });
  }
  const { url, w, h } = urlCache.get(key);
  const img = document.createElement('img');
  img.className = 'face';
  img.src = url;
  img.width = w;
  img.height = h;
  img.alt = '';
  img.draggable = false;
  return img;
}

// An <img> rather than the canvas itself: a canvas can only be in one place at
// a time, and the summary shows the same face repeatedly.
export const faceImg = (kind, value) =>
  imgFrom(`${kind}:${value}`, () => faceImage(kind, value));

// Silhouette for an empty slot, derived from the real face so the outline is
// exactly a square or a kite.
const silhouette = (kind) => imgFrom(`sil:${kind}`, () => {
  const src = faceImage(kind, PREVIEW_VALUE[kind]);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(232, 220, 192, 0.28)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
});

export class Picker {
  constructor(panel, rowsEl, backdrop) {
    this.panel = panel;
    this.rowsEl = rowsEl;
    this.backdrop = backdrop;
    this.counts = new Map(DICE_TYPES.map((d) => [d.kind, 0]));
    this.slots = new Map();
    this.onDismiss = null;
    this._build();

    backdrop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onDismiss) this.onDismiss();
    });
  }

  get open() {
    return !this.panel.hidden;
  }

  get total() {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  get selection() {
    const kinds = [];
    for (const { kind } of DICE_TYPES) {
      for (let i = 0; i < this.counts.get(kind); i++) kinds.push(kind);
    }
    return kinds;
  }

  show() {
    this.panel.hidden = false;
    this.backdrop.hidden = false;
  }

  hide() {
    this.panel.hidden = true;
    this.backdrop.hidden = true;
  }

  reset() {
    for (const { kind } of DICE_TYPES) {
      this.counts.set(kind, 0);
      this._paintSlot(kind);
    }
  }

  _build() {
    this.rowsEl.textContent = '';
    for (const { kind, label } of DICE_TYPES) {
      const row = document.createElement('div');
      row.className = 'row';

      const source = document.createElement('div');
      source.className = 'row-source';
      source.dataset.kind = kind;
      source.setAttribute('role', 'button');
      source.setAttribute('tabindex', '0');
      source.setAttribute('aria-label', `Add ${label}`);
      const preview = faceImg(kind, PREVIEW_VALUE[kind]);
      if (preview) source.appendChild(preview);

      const gutter = document.createElement('div');
      gutter.className = 'row-gutter';
      gutter.textContent = '\u203a';
      gutter.setAttribute('aria-hidden', 'true');

      const slot = document.createElement('div');
      slot.className = 'row-slot';
      slot.dataset.kind = kind;
      slot.dataset.count = '0';
      slot.setAttribute('role', 'button');
      slot.setAttribute('tabindex', '0');
      this.slots.set(kind, slot);

      row.append(source, gutter, slot);
      this.rowsEl.appendChild(row);

      this._wireDrag(source, kind, +1);
      this._wireDrag(slot, kind, -1);
      this._paintSlot(kind);
    }
  }

  _paintSlot(kind) {
    const slot = this.slots.get(kind);
    const count = this.counts.get(kind);
    const label = DICE_TYPES.find((d) => d.kind === kind).label;

    slot.dataset.count = String(count);
    slot.textContent = '';
    slot.setAttribute('aria-label',
      count === 0 ? `No ${label} chosen` : `${count} ${label}. Remove one`);

    const img = count === 0 ? silhouette(kind) : faceImg(kind, PREVIEW_VALUE[kind]);
    if (img) slot.appendChild(img);

    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = count >= MAX_PER_TYPE ? 'badge maxed' : 'badge';
      badge.textContent = String(count);
      slot.appendChild(badge);
    }
  }

  add(kind, delta) {
    const current = this.counts.get(kind);
    const next = Math.min(MAX_PER_TYPE, Math.max(0, current + delta));
    if (next === current) return false;
    this.counts.set(kind, next);
    this._paintSlot(kind);
    return true;
  }

  // direction is +1 on the source tile and -1 on the reserved slot.
  // A press that never moves counts as a tap and applies the same change.
  _wireDrag(el, kind, direction) {
    let start = null;
    let ghost = null;
    let dragging = false;

    const zoneAt = (x, y) => {
      const under = document.elementFromPoint(x, y);
      if (!under) return null;
      if (under.closest('.row-slot')) return 'right';
      if (under.closest('.row-source')) return 'left';
      return null;
    };

    const cleanUp = () => {
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
      for (const s of this.slots.values()) s.classList.remove('over');
      start = null;
      dragging = false;
    };

    el.addEventListener('pointerdown', (e) => {
      if (direction < 0 && this.counts.get(kind) === 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      dragging = false;
    });

    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;

      if (!dragging) {
        dragging = true;
        ghost = faceImg(kind, PREVIEW_VALUE[kind]);
        if (ghost) {
          ghost.id = 'ghost';
          const rect = el.querySelector('.face')?.getBoundingClientRect();
          if (rect) {
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${rect.height}px`;
          }
          document.body.appendChild(ghost);
        }
      }

      if (ghost) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      }
      const zone = zoneAt(e.clientX, e.clientY);
      this.slots.get(kind).classList.toggle('over', direction > 0 ? zone === 'right' : zone !== 'right');
    });

    el.addEventListener('pointerup', (e) => {
      if (!start) return;
      const wasDragging = dragging;
      const { clientX: x, clientY: y } = e;
      cleanUp();

      if (!wasDragging) {
        this.add(kind, direction);
        return;
      }

      // Any landing in the reserved column adds to this die's own row, so a
      // slightly off drop still does what was meant and can never add a die
      // that was not picked up.
      const zone = zoneAt(x, y);
      if (direction > 0) {
        if (zone === 'right') this.add(kind, +1);
      } else if (zone !== 'right') {
        this.add(kind, -1);
      }
    });

    el.addEventListener('pointercancel', cleanUp);

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.add(kind, direction);
      }
    });
  }
}

export function renderSummary(bodyEl, results) {
  bodyEl.textContent = '';
  if (!results || results.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing rolled yet.';
    bodyEl.appendChild(p);
    return;
  }

  for (const { kind, label } of DICE_TYPES) {
    const mine = results.filter((r) => r.kind === kind);
    if (mine.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'group';

    const faces = document.createElement('div');
    faces.className = 'group-faces';
    // The tally is dropped from the display but kept for screen readers.
    faces.setAttribute('aria-label', `${mine.length} ${label}`);
    for (const r of mine) {
      const img = faceImg(kind, r.value);
      if (img) faces.appendChild(img);
    }

    group.appendChild(faces);
    bodyEl.appendChild(group);
  }
}
