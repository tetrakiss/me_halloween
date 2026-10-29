'use strict';
(() => {
  const bunker = document.getElementById('bunker');
  const sound = document.getElementById('sound');
  const music = new Audio();
  music.preload = 'none';
  music.volume = .35;
  let enabled = true, disposed = false, lastTrack = -1, lastEvent = -1;
  let queue = [], eventTimer;
  const sequenceTimers = new Set();
  function later(action, delay) {
    const timer = setTimeout(() => { sequenceTimers.delete(timer); action(); }, delay);
    sequenceTimers.add(timer);
  }
  function render() {
    sound.textContent = enabled ? 'Выключить музыку' : 'Включить музыку';
    sound.setAttribute('aria-pressed', String(enabled));
  }
  async function play() {
    if (!enabled || document.hidden || disposed) return;
    const source = music.src;
    try { await music.play(); } catch (error) {
      if (error.name === 'AbortError' || source !== music.src || !enabled || document.hidden || disposed) return;
      enabled = false;
      render();
    }
  }
  function nextTrack() {
    if (!queue.length) {
      queue = [1, 2, 3, 4, 5, 6, 7];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      if (queue[0] === lastTrack) [queue[0], queue[1]] = [queue[1], queue[0]];
    }
    lastTrack = queue.shift();
    music.src = `/games/bomb/assets/audio/radio-${lastTrack}.mp3?v=1.0.55`;
    play();
  }
  sound.onclick = () => {
    enabled = !enabled;
    render();
    if (enabled) play(); else music.pause();
  };
  music.addEventListener('ended', nextTrack);
  music.addEventListener('error', () => { enabled = false; render(); });
  function resetEvent() {
    sequenceTimers.forEach(clearTimeout);
    sequenceTimers.clear();
    bunker.classList.remove('unlock', 'open', 'delivery', 'party', 'robot-passing', 'resident-passing');
  }
  function schedule(delay = 16000 + Math.random() * 12000) {
    clearTimeout(eventTimer);
    if (!document.hidden && !disposed) eventTimer = setTimeout(runEvent, delay);
  }
  function openDoor(visitor) {
    bunker.classList.add('unlock');
    later(() => bunker.classList.add('open'), 2000);
    // Sliding takes 3.6 seconds. Nobody crosses until the doorway is clear.
    if (visitor) later(() => bunker.classList.add(visitor), 6000);
    // The longest crossing ends at 16 seconds, before closing starts.
    later(() => bunker.classList.remove('open'), 17500);
    later(() => bunker.classList.remove('unlock'), 21500);
    later(() => { resetEvent(); schedule(); }, 24000);
  }
  function runEvent() {
    if (document.hidden || disposed) return;
    let event;
    do { event = Math.floor(Math.random() * 5); } while (event === lastEvent);
    lastEvent = event;
    resetEvent();
    if (event < 3) {
      openDoor(['robot-passing', 'resident-passing', null][event]);
    } else {
      bunker.classList.add(event === 3 ? 'delivery' : 'party');
      later(() => { resetEvent(); schedule(); }, 16500);
    }
  }
  document.addEventListener('visibilitychange', () => {
    bunker.classList.toggle('paused', document.hidden);
    if (document.hidden) { clearTimeout(eventTimer); resetEvent(); music.pause(); }
    else { schedule(); play(); }
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(eventTimer);
    resetEvent();
    music.pause();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { disposed = false; schedule(); play(); }
  });
  // Try autoplay; browsers that require a gesture expose the same music button.
  nextTrack();
  // The first opening shows the coffee robot; later visitors are random.
  lastEvent = 0;
  openDoor('robot-passing');
})();
