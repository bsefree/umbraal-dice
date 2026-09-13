import { DiceScene, CONFIG } from './scene.js';
import { preloadKind } from './facepreview.js';
import { Picker, DICE_TYPES, renderSummary } from './ui.js';

const ASSETS = 'assets/dice';
const TABLE_TEXTURE = `${ASSETS}/table_surface.png`;
const FONT_FAMILY = 'Umbraal';
const SUMMARY_DELAY_MS = 500;

// One page that adapts. Detection picks render quality and layout density.
// ?mode=mobile or ?mode=desktop forces either.
function detectMobile() {
  const forced = new URLSearchParams(location.search).get('mode');
  if (forced === 'mobile') return true;
  if (forced === 'desktop') return false;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  // iPads report a Mac user agent; touch points are the giveaway.
  const iPadish = navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || '');
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent)
    || iPadish || (coarse && small);
}

// Canvas text falls back silently if the face is not loaded, so wait for it.
async function loadFont() {
  if (!document.fonts) return 'serif';
  try {
    await document.fonts.load(`192px ${FONT_FAMILY}`);
    await document.fonts.ready;
    return document.fonts.check(`192px ${FONT_FAMILY}`) ? FONT_FAMILY : 'serif';
  } catch {
    return 'serif';
  }
}

function showFallback(message, detail) {
  // Always log first. This runs from the error handler, so throwing in here
  // would replace the real failure with a useless one about this function.
  console.error('[dice]', message, detail);
  const el = document.getElementById('fallback');
  if (!el) return;
  el.hidden = false;
  const wrap = document.createElement('div');
  const h = document.createElement('p');
  h.textContent = message;
  const d = document.createElement('p');
  d.className = 'fallback-detail';
  d.textContent = detail;
  wrap.append(h, d);
  el.replaceChildren(wrap);
}

async function main() {
  // A failure during startup would otherwise leave a bare background with
  // nothing to go on. After boot, errors go to the console instead of
  // covering a table that is still usable.
  let booted = false;
  const onStartupFailure = (err) => {
    window.__diceStatus = 'error: ' + (err && err.stack ? err.stack : err);
    if (booted) return;
    showFallback('Something went wrong starting up.', String(err && err.message ? err.message : err));
  };
  window.__diceStatus = 'starting';
  addEventListener('error', (e) => onStartupFailure(e.error || e.message));
  addEventListener('unhandledrejection', (e) => onStartupFailure(e.reason));

  const mobile = detectMobile();
  document.documentElement.dataset.mode = mobile ? 'mobile' : 'desktop';

  if (mobile) {
    CONFIG.shadows = false;
    CONFIG.maxPixelRatio = 1.5;
    // Closer in on a small screen: area scales with the square of apparent
    // size, so 0.44 of the table area per die renders them about 50% larger.
    CONFIG.areaPerDie = 12.8;
    CONFIG.arenaMin = 3;
  }

  const fontFamily = await loadFont();

  let scene;
  try {
    scene = new DiceScene(document.getElementById('table'), { assetsDir: ASSETS, fontFamily, mobile });
  } catch (err) {
    showFallback('This needs WebGL.', `The dice are drawn in 3D by the browser. ${err.message}`);
    return;
  }

  try {
    await Promise.all(DICE_TYPES.map((d) => preloadKind(d.kind, ASSETS, fontFamily)));
  } catch (err) {
    showFallback('The dice artwork did not load.',
      `Check that the assets folder sits next to index.html. ${err.message}`);
    return;
  }

  // A missing table texture is cosmetic; the plain surface still works.
  try {
    await scene.loadTable(TABLE_TEXTURE);
  } catch {}

  const rollBtn = document.getElementById('roll');
  const rerollBtn = document.getElementById('reroll');
  const countBtn = document.getElementById('count');
  const summaryEl = document.getElementById('summary');
  const summaryBody = document.getElementById('summary-body');
  const summaryBackdrop = document.getElementById('summary-backdrop');

  const picker = new Picker(
    document.getElementById('picker'),
    document.getElementById('picker-rows'),
    document.getElementById('picker-backdrop'),
  );

  const state = { rolling: false, results: null, lastKinds: null };

  const summaryOpen = () => !summaryEl.hidden;
  const showSummary = () => {
    renderSummary(summaryBody, state.results);
    summaryEl.hidden = false;
    summaryBackdrop.hidden = false;
  };
  const hideSummary = () => {
    summaryEl.hidden = true;
    summaryBackdrop.hidden = true;
  };

  const refresh = () => {
    rollBtn.disabled = state.rolling;
    countBtn.disabled = state.rolling || !state.results || picker.open;
    // Appears alongside the count, and only while there is a roll to repeat.
    rerollBtn.hidden = !state.lastKinds || state.rolling || picker.open;
  };

  picker.onDismiss = () => {
    picker.hide();
    refresh();
  };
  summaryBackdrop.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hideSummary();
  });

  async function doRoll(kinds) {
    if (!kinds || kinds.length === 0) return;

    picker.hide();
    hideSummary();
    state.rolling = true;
    state.results = null;
    state.lastKinds = kinds;
    refresh();

    const results = await scene.roll(kinds);

    state.rolling = false;
    state.results = results;
    refresh();

    setTimeout(() => {
      if (state.rolling) return;
      showSummary();
      refresh();
    }, SUMMARY_DELAY_MS);
  }

  rollBtn.addEventListener('click', () => {
    if (state.rolling) return;
    if (picker.open) {
      // With nothing chosen this does nothing, rather than closing the picker.
      doRoll(picker.selection);
      return;
    }
    hideSummary();
    picker.reset();
    picker.show();
    refresh();
  });

  rerollBtn.addEventListener('click', () => {
    if (state.rolling || picker.open || !state.lastKinds) return;
    doRoll(state.lastKinds);
  });

  countBtn.addEventListener('click', () => {
    if (state.rolling || !state.results || picker.open) return;
    if (summaryOpen()) hideSummary(); else showSummary();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (summaryOpen()) hideSummary();
    else if (picker.open) picker.hide();
    refresh();
  });

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scene.resize(), 120);
  };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);

  scene.resize();
  refresh();
  booted = true;
  window.__dice = { scene, picker, state };
  window.__diceStatus = 'booted';
}

main();
