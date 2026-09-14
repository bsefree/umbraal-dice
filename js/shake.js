// Shake-to-roll. Off until switched on from the toggle: iOS needs
// DeviceMotionEvent.requestPermission(), which only resolves when called
// during a user gesture and only on a secure origin, so enable() has to be
// reached synchronously from a tap handler.

const SAMPLE_MS = 90;
const REPEAT_WINDOW_MS = 700;
const HITS_REQUIRED = 2;

export function createShakeDetector(onShake, opts = {}) {
  // Sum of the per-axis change in m/s^2 between samples. Resting noise is
  // under 2, a deliberate shake runs 30-60.
  const threshold = opts.threshold ?? 25;
  const cooldown = opts.cooldown ?? 1500;
  const delay = opts.delay ?? 300;

  let enabled = false;
  let last = null;
  let hits = [];
  let blockedUntil = 0;

  const handle = (event) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.x === undefined) return;

    const now = performance.now();
    if (now < blockedUntil) {
      last = null;
      hits = [];
      return;
    }
    if (!last) {
      last = { x: a.x, y: a.y, z: a.z, t: now };
      return;
    }
    if (now - last.t < SAMPLE_MS) return;

    const jolt = Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
    last = { x: a.x, y: a.y, z: a.z, t: now };
    if (jolt < threshold) return;

    // Two jolts close together, so setting the phone down or knocking the
    // table does not throw the dice.
    hits = hits.filter((t) => now - t < REPEAT_WINDOW_MS);
    hits.push(now);
    if (hits.length < HITS_REQUIRED) return;

    hits = [];
    blockedUntil = now + cooldown;
    setTimeout(onShake, delay);
  };

  const supported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  let granted = false;

  async function requestAccess() {
    if (granted) return 'granted';
    const DME = window.DeviceMotionEvent;
    if (!DME) return 'unsupported';
    // Android and older iOS hand over readings without asking.
    if (typeof DME.requestPermission !== 'function') {
      granted = true;
      return 'granted';
    }
    try {
      const answer = await DME.requestPermission();
      if (answer !== 'granted') return 'denied';
    } catch {
      // Thrown rather than resolved when the call is not allowed here at all.
      return 'denied';
    }
    granted = true;
    return 'granted';
  }

  // Permission can be granted and still yield nothing -- no sensor, or a
  // browser that reports the event type but never fires it. Waiting for one
  // real reading is the only way to tell a working switch from a dead one.
  function firstSample(ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('devicemotion', probe);
        resolve(ok);
      };
      const probe = (event) => {
        const a = event.accelerationIncludingGravity;
        if (!a || a.x === null || a.x === undefined) return;
        finish(true);
      };
      window.addEventListener('devicemotion', probe);
      setTimeout(() => finish(false), ms);
    });
  }

  return {
    supported,
    get enabled() { return enabled; },

    // Resolves to one of: 'on', 'denied', 'insecure', 'unsupported', 'silent'.
    async enable() {
      if (enabled) return 'on';
      if (!supported) return 'unsupported';
      // iOS will not even offer the prompt over plain http.
      if (window.isSecureContext === false) return 'insecure';

      const access = await requestAccess();
      if (access !== 'granted') return access === 'unsupported' ? 'unsupported' : 'denied';

      last = null;
      hits = [];
      window.addEventListener('devicemotion', handle);
      enabled = true;

      if (!(await firstSample(1500))) {
        this.disable();
        return 'silent';
      }
      return 'on';
    },

    disable() {
      window.removeEventListener('devicemotion', handle);
      enabled = false;
      last = null;
      hits = [];
    },

    // Starts a fresh cooldown, for the moment dice finish settling while the
    // phone is still moving.
    suspend() {
      blockedUntil = performance.now() + cooldown;
      last = null;
      hits = [];
    },
  };
}
