'use strict';
(() => {
  const bunker = document.getElementById('bunker');
  const status = document.getElementById('status');
  const sound = document.getElementById('sound');
  const track = document.getElementById('track');
  const music = new Audio();
  music.preload = 'none';
  let enabled = false, disposed = false, eventTimer, finishTimer, lastEvent = -1, lastTrack = -1;
  let queue = [];
  const events = [
    ['visit', 'Сосед заглянул на чашечку кофе. Смена становится лучше.', '🤖'],
    ['delivery', 'Мяч найден. Отдел физкультуры благодарит за сотрудничество.'],
    ['party', 'Генератор в отличном настроении. Добавляем немного солнца!'],
    ['visit', 'Курьер доставил печенье. Радиационный фон — восхитительный.', '🧑‍🚀'],
    ['party', 'Проверка связи: вас слышно, вам рады. Хорошей смены!'],
    ['visit', 'Робот напоминает: перерыв на кофе предусмотрен уставом.', '🤖']
  ];
  function shuffledTracks() {
    const list = [1, 2, 3, 4, 5, 6, 7];
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    if (list[0] === lastTrack) [list[0], list[1]] = [list[1], list[0]];
    return list;
  }
  function render() { sound.textContent = enabled ? '❚❚ Выключить радио' : '▶ Включить радио'; sound.setAttribute('aria-pressed', String(enabled)); }
  async function play() {
    if (!enabled || document.hidden || disposed) return;
    const source = music.src;
    try { await music.play(); } catch (error) {
      if (error.name === 'AbortError' || music.src !== source || !enabled || document.hidden || disposed) return;
      enabled = false; render(); track.textContent = 'Нажмите «Включить радио», чтобы продолжить';
    }
  }
  function nextTrack() {
    if (!queue.length) queue = shuffledTracks();
    lastTrack = queue.shift();
    music.src = `/games/bomb/assets/audio/radio-${lastTrack}.mp3?v=1.0.55`;
    track.textContent = `Сейчас в эфире · мелодия ${lastTrack} / 7`;
    play();
  }
  music.volume = .35;
  sound.onclick = () => { enabled = !enabled; render(); if (enabled) { if (!music.src) nextTrack(); else play(); } else music.pause(); };
  document.getElementById('next').onclick = () => { enabled = true; render(); nextTrack(); };
  document.getElementById('volume').oninput = event => { music.volume = Number(event.target.value) / 100; };
  music.addEventListener('ended', nextTrack);
  music.addEventListener('error', () => { enabled = false; render(); track.textContent = 'Трек недоступен. Попробуйте следующий.'; });
  function schedule(delay = 20000 + Math.random() * 20000) { clearTimeout(eventTimer); if (!document.hidden && !disposed) eventTimer = setTimeout(runEvent, delay); }
  function resetEvent() { clearTimeout(finishTimer); bunker.classList.remove('visit', 'delivery', 'party'); }
  function runEvent() {
    if (document.hidden || disposed) return;
    let index; do { index = Math.floor(Math.random() * events.length); } while (index === lastEvent);
    lastEvent = index;
    const [name, message, visitor] = events[index];
    resetEvent();
    if (visitor) document.getElementById('visitor').firstChild.textContent = visitor;
    bunker.classList.add(name); status.textContent = message;
    finishTimer = setTimeout(() => { resetEvent(); status.textContent = 'Кофе готов. Всё работает. Почти всё.'; schedule(); }, 10000);
  }
  document.addEventListener('visibilitychange', () => {
    bunker.classList.toggle('paused', document.hidden);
    if (document.hidden) { clearTimeout(eventTimer); resetEvent(); music.pause(); }
    else { status.textContent = 'С возвращением! В убежище всё хорошо.'; schedule(); play(); }
  });
  function dispose() { disposed = true; clearTimeout(eventTimer); resetEvent(); music.pause(); }
  window.addEventListener('pagehide', dispose);
  window.addEventListener('pageshow', event => { if (event.persisted) { disposed = false; schedule(); play(); } });
  document.getElementById('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (_) { status.textContent = 'Располагайтесь поудобнее — заставка работает и в обычном окне.'; }
  };
  document.addEventListener('fullscreenchange', () => { document.getElementById('fullscreen').textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран'; });
  schedule(12000);
})();
