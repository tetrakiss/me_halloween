'use strict';
(function () {
  const url = '/games/bomb/assets/audio/electric-spark.wav?v=1.0.12';
  const key = 'megatonna-sound';
  const button = document.getElementById('soundToggle');
  let enabled = true;
  try { enabled = localStorage.getItem(key) !== 'off'; } catch (_) {}
  let context, buffer, gain, fallbackUnlocked = false;
  const active = new Set();
  const fallback = new Audio(url);
  fallback.preload = 'auto';
  fallback.volume = .35;
  const file = fetch(url).then(response => {
    if (!response.ok) throw new Error('Sound unavailable');
    return response.arrayBuffer();
  }).catch(() => null);

  function stopSpark() {
    active.forEach(source => { try { source.stop(); } catch (_) {} });
    active.clear();
    fallback.pause();
  }
  const tracks = [1, 2, 3].map(n => `/games/bomb/assets/audio/radio-${n}.mp3?v=1.0.12`);
  let trackIndex = Math.floor(Math.random() * tracks.length);
  let interacted = false;
  const music = new Audio(tracks[trackIndex]);
  music.preload = 'none';
  music.volume = .22;
  function playMusic() {
    if (!enabled || document.hidden || !interacted) return;
    const started = music.play();
    if (started && started.catch) started.catch(() => {});
  }
  music.addEventListener('ended', () => {
    trackIndex = (trackIndex + 1) % tracks.length;
    music.src = tracks[trackIndex];
    playMusic();
  });
  function stop() {
    stopSpark();
    music.pause();
  }
  function unlock(event) {
    interacted = true;
    // The toggle handles its own playback after changing the shared preference.
    if (event.target.closest && event.target.closest('#soundToggle')) return;
    if (!enabled) return;
    playMusic();
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    if (AudioEngine) {
      if (!context) {
        try {
          context = new AudioEngine();
          gain = context.createGain();
          gain.gain.value = .35;
          gain.connect(context.destination);
          buffer = file.then(data => data ? new Promise(resolve => {
            // Callback form also supports older TV browsers.
            context.decodeAudioData(data, resolve, () => resolve(null));
          }) : null);
        } catch (_) { context = null; }
      }
      if (context) {
        const resumed = context.resume();
        if (resumed && resumed.catch) resumed.catch(() => {});
        return;
      }
    }
    if (!fallbackUnlocked) {
      fallbackUnlocked = true;
      fallback.volume = 0;
      const started = fallback.play();
      if (started && started.then) started.then(() => {
        fallback.pause(); fallback.currentTime = 0; fallback.volume = .35;
      }).catch(() => { fallback.volume = .35; fallbackUnlocked = false; });
      else { fallback.pause(); fallback.currentTime = 0; fallback.volume = .35; }
    }
  }
  async function playSpark() {
    if (!enabled || document.hidden) return;
    try {
      if (context && buffer) {
        const decoded = await buffer;
        if (!enabled || document.hidden || !decoded || context.state !== 'running') return;
        stopSpark();
        const source = context.createBufferSource();
        source.buffer = decoded;
        source.connect(gain);
        source.onended = () => active.delete(source);
        active.add(source);
        source.start();
      } else {
        fallback.currentTime = 0;
        fallback.volume = .35;
        const started = fallback.play();
        if (started && started.catch) started.catch(() => {});
      }
    } catch (_) { /* A blocked or unavailable sound never interrupts gameplay. */ }
  }
  function render() {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Звук включён. Отключить звук' : 'Звук выключен. Включить звук');
    button.classList.toggle('muted', !enabled);
    button.title = enabled ? 'Выключить все звуки' : 'Включить все звуки';
  }
  // Resume inside the remote's actual click, before awaiting the game server.
  document.addEventListener('click', unlock, true);
  button.onclick = () => {
    enabled = !enabled;
    if (!enabled) stop();
    else { unlock({ target: button.parentElement }); }
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) {}
    render();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else playMusic();
  });
  window.bombSound = { playSpark, stop };
  render();
})();
