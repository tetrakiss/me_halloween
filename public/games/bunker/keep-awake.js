'use strict';
(() => {
  const video = document.getElementById('keep-awake');
  let lock = null, pending = false, stopped = false, generation = 0;
  let retryTimer;
  function active() { return !stopped && !document.hidden; }
  function stopVideo() { video.pause(); }
  function fallback() {
    if (!active() || !video.paused) return;
    try {
      const playing = video.play();
      if (playing && playing.catch) playing.catch(() => {});
    } catch (_) { /* Older TVs may require a real click before playback. */ }
  }
  async function acquire() {
    if (!active() || lock || pending) return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      fallback();
      return;
    }
    pending = true;
    const requestGeneration = generation;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      // A request can finish after leaving the page, including a back-cache restore.
      if (!active() || generation !== requestGeneration) {
        await acquired.release();
        return;
      }
      lock = acquired;
      stopVideo();
      acquired.addEventListener('release', () => {
        if (lock !== acquired) return;
        lock = null;
        // Avoid a tight request loop if the device revokes wake locks repeatedly.
        if (active()) {
          fallback();
          clearTimeout(retryTimer);
          retryTimer = setTimeout(acquire, 15000);
        }
      });
    } catch (_) {
      if (active() && generation === requestGeneration) fallback();
    } finally {
      pending = false;
      if (active() && generation !== requestGeneration) acquire();
    }
  }
  function release() {
    generation++;
    clearTimeout(retryTimer);
    stopVideo();
    const held = lock;
    lock = null;
    if (held) held.release().catch(() => {});
  }
  // Real gestures can unlock legacy media playback; synthetic mouse events cannot.
  ['pointerdown', 'click', 'keydown'].forEach(type => {
    document.addEventListener(type, acquire, { passive: true });
  });
  document.addEventListener('fullscreenchange', acquire);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release(); else acquire();
  });
  window.addEventListener('pagehide', () => { stopped = true; release(); });
  window.addEventListener('pageshow', () => { stopped = false; acquire(); });
  acquire();
})();
