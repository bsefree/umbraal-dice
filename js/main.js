import { DiceScene, CONFIG } from './scene.js';
import { preloadKind } from './facepreview.js';
import { Picker, DICE_TYPES, renderSummary } from './ui.js';
import { createShakeDetector } from './shake.js';

const ASSETS = 'assets/dice';
const TABLE_TEXTURE = `${ASSETS}/table_surface.png`;
const FONT_FAMILY = 'Umbraal';

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

  // Shake to roll, on phones only. Throws whatever is currently chosen in the
  // picker, or repeats the last roll if there is one.
  const shake = createShakeDetector(() => {
    if (state.rolling || aboutOpen()) return;
    const kinds = picker.open ? picker.selection : state.lastKinds;
    if (kinds && kinds.length) doRoll(kinds);
  });

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

    // The phone is often still moving as the dice stop.
    shake.suspend();

    // No automatic summary. With a die or two the table already says what was
    // rolled; Count is there for when a handful is hard to read.
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
    if (aboutOpen()) closeTop();
    else if (summaryOpen()) hideSummary();
    else if (picker.open) picker.hide();
    refresh();
  });

  // ---- about ----
  const infoBtn = document.getElementById('info');
  const aboutEl = document.getElementById('about');
  const aboutBackdrop = document.getElementById('about-backdrop');
  const aboutBody = document.getElementById('about-body');
  let aboutLoaded = false;
  let aboutJustClosed = false;

  const noticeEl = document.getElementById('notice');
  const noticeBody = document.getElementById('notice-body');
  let topPanel = null;

  const aboutOpen = () => topPanel !== null;
  const dismissTop = () => closeTop();

  function openTop(el) {
    if (topPanel && topPanel !== el) topPanel.hidden = true;
    topPanel = el;
    el.hidden = false;
    aboutBackdrop.hidden = false;
    // Capture phase, so a click anywhere closes it before anything else can
    // act on it -- including the panel itself.
    document.addEventListener('pointerdown', dismissTop, true);
  }

  function closeTop() {
    document.removeEventListener('pointerdown', dismissTop, true);
    if (topPanel) topPanel.hidden = true;
    topPanel = null;
    aboutBackdrop.hidden = true;
    // Swallows the click that follows this pointerdown, so pressing a corner
    // dot while its panel is open closes it instead of closing and reopening.
    aboutJustClosed = true;
    setTimeout(() => { aboutJustClosed = false; }, 0);
  }

  function showNotice(lines) {
    noticeBody.replaceChildren(...lines.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));
    openTop(noticeEl);
  }

  async function openAbout() {
    if (!aboutLoaded) {
      try {
        const res = await fetch('info.html', { cache: 'no-cache' });
        if (res.ok) {
          aboutBody.innerHTML = await res.text();
          aboutLoaded = true;
        }
      } catch {
        // The copy written into index.html stands in.
      }
    }
    openTop(aboutEl);
  }

  infoBtn.addEventListener('click', () => {
    if (aboutJustClosed) return;
    openAbout();
  });

  // ---- shake toggle ----
  const shakeBtn = document.getElementById('shake-toggle');
  // Only worth offering where there is a sensor to read.
  if (mobile && shake.supported) shakeBtn.hidden = false;

  const SHAKE_TROUBLE = {
    denied: [
      'Motion access is switched off for this site.',
      'In Safari, tap the page settings button at the left of the address bar, choose Website Settings, and turn on Motion & Orientation. Then tap the shake button again.',
    ],
    insecure: [
      'Motion needs a secure connection.',
      'Open the site over https rather than by IP address, and try again.',
    ],
    unsupported: ['This device has no motion sensor to read.'],
    silent: [
      'No motion readings are coming through.',
      'Permission is granted, but the sensor is not reporting. Reloading the page usually clears this.',
    ],
  };

  shakeBtn.addEventListener('click', async () => {
    if (aboutJustClosed) return;
    if (shake.enabled) {
      shake.disable();
      shakeBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    // The permission prompt has to come out of this tap.
    shakeBtn.disabled = true;
    const result = await shake.enable();
    shakeBtn.disabled = false;
    shakeBtn.setAttribute('aria-pressed', result === 'on' ? 'true' : 'false');
    if (result !== 'on') showNotice(SHAKE_TROUBLE[result] || SHAKE_TROUBLE.denied);
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
