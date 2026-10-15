'use strict';
(() => {
  const $ = id => document.getElementById(id), data = window.PassScenarios;
  const asset = name => '/games/pass/assets/' + name + '?v=1.0.22';
  let confettiTimer, typingTimer, requestTimer, previousRequest = '';
  let cameraLabels = [], shiftVisitors = [];
  let index = 0, tab = 'identity', phase = 'intro', answers = [], sound = true, audio;
  try { sound = localStorage.getItem('pass-sound') !== 'off'; } catch (_) {}
  const radio = $('radio');
  const tracks = [1, 2, 3].map(n => '/games/bomb/assets/audio/radio-' + n + '.mp3?v=1.0.12');
  let trackIndex = Math.floor(Math.random() * tracks.length), musicStarted = false;
  radio.src = tracks[trackIndex]; radio.volume = .22;
  function playRadio() {
    if (!sound || !musicStarted || document.hidden) return;
    const started = radio.play();
    if (started && started.catch) started.catch(() => {});
  }
  radio.addEventListener('ended', () => {
    trackIndex = (trackIndex + 1) % tracks.length; radio.src = tracks[trackIndex]; playRadio();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) radio.pause(); else playRadio(); });
  window.addEventListener('pagehide', () => radio.pause());
  function renderSound() {
    $('sound').textContent = sound ? 'ЗВУК: ВКЛ' : 'ЗВУК: ВЫКЛ';
    $('sound').setAttribute('aria-pressed', String(sound));
    $('sound').setAttribute('aria-label', sound ? 'Отключить музыку и звуки' : 'Включить музыку и звуки');
  }
  function beep(success = true) {
    if (!sound || document.hidden) return;
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return; audio = audio || new Audio(); audio.resume().catch(() => {}); const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.connect(gain); gain.connect(audio.destination); oscillator.type = 'square'; oscillator.frequency.value = success ? 660 : 165; gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16); oscillator.start(); oscillator.stop(audio.currentTime + .17); } catch (_) { /* Audio is optional on TV browsers. */ }
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function typeDialogue(text) {
    clearTimeout(typingTimer);
    const element = $('dialogue');
    element.classList.remove('typing');
    if (reducedMotion.matches) { element.textContent = text; return; }
    element.textContent = ''; element.classList.add('typing');
    let position = 0;
    function tick() {
      position++; element.textContent = text.slice(0, position);
      if (position < text.length) typingTimer = setTimeout(tick, /[.,!?]/.test(text[position - 1]) ? 180 : 32);
      else element.classList.remove('typing');
    }
    tick();
  }
  function drawGauge(value) {
    const point = (radius, angle) => { const a = angle * Math.PI / 180; return [130 + radius * Math.cos(a), 130 + radius * Math.sin(a)]; };
    const segments = $('gaugeSegments'); segments.replaceChildren();
    for (let i = 0; i < 16; i++) {
      const a = -155 + i * 130 / 16 + 1, b = -155 + (i + 1) * 130 / 16 - 1;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const points = [point(120,a), point(120,b), point(90,b), point(90,a)];
      path.setAttribute('d', 'M' + points.map(p => p.join(',')).join('L') + 'Z');
      path.setAttribute('class', 'gauge-segment' + (i < Math.ceil(value / 5) ? ' lit' : '') + (i >= 8 ? ' high' : ''));
      segments.append(path);
    }
    const angle = -155 + Math.min(80, Math.max(0, value)) / 80 * 130;
    $('gaugeNeedle').setAttribute('d', 'M' + point(85,angle).join(',') + 'L' + point(124,angle).join(','));
    $('radiationMeter').setAttribute('aria-valuenow', String(value));
  }
  function changeTab(next) {
    if (phase !== 'playing') return;
    tab = next;
    $('identityPanel').hidden = tab !== 'identity'; $('baggagePanel').hidden = tab !== 'baggage';
    $('identity').setAttribute('aria-pressed', String(tab === 'identity')); $('baggage').setAttribute('aria-pressed', String(tab === 'baggage'));
    typeDialogue(tab === 'identity' ? shiftVisitors[index].greeting : shiftVisitors[index].baggageLine);
  }
  function renderVisitor() {
    const visitor = shiftVisitors[index]; phase = 'playing'; $('overlay').hidden = true;
    $('cameraLabel').textContent = cameraLabels[index];
    $('date').textContent = data.date; $('progress').textContent = String(index + 1).padStart(2, '0') + ' / ' + String(shiftVisitors.length).padStart(2, '0');
    document.querySelector('.visitor').classList.toggle('roach', visitor.id === 'roach');
    document.querySelector('.visitor').classList.toggle('brahmin', visitor.id === 'brahmin');
    $('idPhoto').classList.toggle('wide-id', visitor.id === 'brahmin');
    $('portrait').src = asset(visitor.portrait); $('idPhoto').src = asset(visitor.idPhoto); $('portrait').alt = visitor.name + ', посетитель у шлюза';
    $('bagImage').src = asset(visitor.baggage);
    ['name', 'profession', 'issued', 'expires'].forEach(key => $(key).textContent = visitor[key]);
    $('radiation').textContent = String(visitor.radiation).padStart(3, '0'); drawGauge(visitor.radiation);
    clearInterval(requestTimer); previousRequest = '';
    changeTab('identity'); $('identity').focus();
    requestTimer = setInterval(() => {
      if (phase !== 'playing' || document.hidden) return;
      const request = data.pickRequest(shiftVisitors[index], previousRequest);
      previousRequest = request.text; typeDialogue(request.text);
    }, 15000);
  }
  function modal(title, text, outcome, button, correct) {
    $('resultTitle').textContent = title; $('resultText').textContent = text; $('outcome').textContent = outcome;
    document.querySelector('.modal').classList.toggle('failure', correct === false);
    $('continue').textContent = button; $('overlay').hidden = false; $('continue').focus();
  }
  function startConfetti() {
    clearTimeout(confettiTimer); $('confetti').replaceChildren();
    if (reducedMotion.matches) return;
    const colors = ['#f2cd55', '#6ab6ed', '#b9ed81', '#f3f0bc', '#e98b57'];
    for (let i = 0; i < 85; i++) {
      const piece = document.createElement('i');
      piece.style.left = Math.random() * 100 + '%';
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.setProperty('--drift', (Math.random() - .5) * 420 + 'px');
      piece.style.setProperty('--spin', (Math.random() - .5) * 1500 + 'deg');
      piece.style.animationDelay = Math.random() * 1.4 + 's';
      piece.style.animationDuration = 3.5 + Math.random() * 1.8 + 's';
      $('confetti').append(piece);
    }
    confettiTimer = setTimeout(() => $('confetti').replaceChildren(), 7000);
  }
  function showEnding(lost, lastVisitor) {
    phase = 'finished'; clearInterval(requestTimer); clearTimeout(typingTimer);
    $('overlay').hidden = true; $('ending').hidden = false;
    $('ending').classList.toggle('defeat', lost);
    $('ending').classList.toggle('victory', !lost);
    $('endingSticker').src = asset(lost ? 'dismissed.png' : 'legend.png');
    $('endingSticker').alt = lost ? 'ОТСТРАНЁН' : 'ЛЕГЕНДА УБЕЖИЩА';
    if (lost) $('ending').append($('endingSticker'));
    else document.querySelector('.ending-copy').insertBefore($('endingSticker'), $('endingEyebrow'));
    clearTimeout(confettiTimer); $('confetti').replaceChildren();
    if (!lost) startConfetti();
    const result = data.shiftStatus(answers);
    $('endingEyebrow').textContent = lost ? 'УБЕЖИЩЕ 13 · БЛОКИРОВКА ШЛЮЗА' : 'УБЕЖИЩЕ 13 · КОМНАТА ОТДЫХА';
    $('endingTitle').textContent = lost ? 'ДОПУСК ОТОЗВАН' : 'СМЕНА ПРИНЯТА';
    $('endingText').textContent = lost ? 'Три ошибки. Шлюз закрыт, инспектор отстранён.' : 'Убежище под защитой. Смотритель награждает вас за службу!';
    $('endingStats').textContent = 'ВЕРНЫХ РЕШЕНИЙ: ' + result.score + ' / ' + answers.length + '\nОШИБОК: ' + result.mistakes + ' / 3\nПРОВЕРЕНО: ' + answers.length + ' / ' + shiftVisitors.length;
    $('endingDetail').textContent = lost ? 'Последняя ошибка — ' + lastVisitor.name + '. ' + lastVisitor.explanation : (result.mistakes === 0 ? 'Без единой ошибки. Грамота заслужена!' : 'Смена завершена. В следующий раз попробуйте пройти без ошибок.');
    $('restart').focus();
  }
  function decide(admitted) {
    if (phase !== 'playing') return;
    const visitor = shiftVisitors[index], correct = admitted === data.canAdmit(visitor);
    answers.push({ name: visitor.name, admitted, correct }); phase = 'feedback'; clearInterval(requestTimer); clearTimeout(typingTimer); $('dialogue').classList.remove('typing'); beep(correct);
    const result = data.shiftStatus(answers); $('mistakes').textContent = result.mistakes + ' / 3';
    if (result.status === 'lost') { showEnding(true, visitor); return; }
    const outcome = admitted ? (visitor.admittedOutcome || visitor.outcome) : (visitor.rejectedOutcome || visitor.outcome);
    modal(correct ? 'ВЕРНО' : 'ОШИБКА', visitor.explanation, outcome, index === shiftVisitors.length - 1 ? 'ИТОГ СМЕНЫ · OK' : 'СЛЕДУЮЩИЙ ПОСЕТИТЕЛЬ · OK', correct);
  }
  function advance() {
    musicStarted = true; playRadio(); beep();
    if (phase === 'intro' || phase === 'finished') { index = 0; answers = []; clearTimeout(confettiTimer); $('confetti').replaceChildren(); $('ending').hidden = true; $('mistakes').textContent = '0 / 3'; shiftVisitors = data.createShift();
      cameraLabels = shiftVisitors.map((visitor, i) => 'КАМЕРА ' + ['ШЛЮЗА', 'ПОСТА', 'КОРИДОРА'][i % 3] + ' ' + String(i + 1).padStart(2, '0'));
      for (let i = cameraLabels.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cameraLabels[i], cameraLabels[j]] = [cameraLabels[j], cameraLabels[i]]; }
      $('report').replaceChildren(); renderVisitor(); }
    else if (phase === 'feedback') {
      if (index + 1 < shiftVisitors.length) { index++; renderVisitor(); }
      else { showEnding(false); }
    }
  }
  $('identity').onclick = () => { changeTab('identity'); beep(); }; $('baggage').onclick = () => { changeTab('baggage'); beep(); };
  $('reject').onclick = () => decide(false); $('admit').onclick = () => decide(true); $('continue').onclick = advance; $('restart').onclick = advance;
  $('sound').onclick = () => { sound = !sound; renderSound(); if (sound) { musicStarted = true; playRadio(); beep(); } else radio.pause(); try { localStorage.setItem('pass-sound', sound ? 'on' : 'off'); } catch (_) {} };
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) { $('notice').textContent = 'Полноэкранный режим недоступен в этом браузере.'; $('notice').hidden = false; setTimeout(() => { $('notice').hidden = true; }, 4000); } };
  document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'ВЫЙТИ ИЗ ЭКРАНА' : 'НА ВЕСЬ ЭКРАН'; });
  document.addEventListener('keydown', event => {
    const key = event.key, code = event.keyCode;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'].includes(key) && ![13, 461, 10009].includes(code)) return;
    if (key === 'Escape' || key === 'Backspace' || code === 461 || code === 10009) {
      if (phase === 'playing' && tab === 'baggage') { event.preventDefault(); changeTab('identity'); $('identity').focus(); } return;
    }
    if (event.repeat) { event.preventDefault(); return; }
    if (phase !== 'playing') { if (key === 'Enter' || code === 13) { event.preventDefault(); advance(); } else if (key.startsWith('Arrow')) event.preventDefault(); return; }
    if (key.startsWith('Arrow')) event.preventDefault();
    if (key === 'ArrowUp') { changeTab('identity'); $('identity').focus(); beep(); }
    if (key === 'ArrowDown') { changeTab('baggage'); $('baggage').focus(); beep(); }
    if (key === 'ArrowLeft') decide(false);
    if (key === 'ArrowRight') decide(true);
  });
  for (const visitor of data.visitors) for (const name of [visitor.portrait, visitor.idPhoto, visitor.baggage]) { const image = new Image(); image.src = asset(name); }
  for (const name of ['victory.webp', 'defeat.webp', 'dismissed.png', 'legend.png']) { const image = new Image(); image.src = asset(name); }
  renderSound(); $('date').textContent = data.date; $('continue').focus();
})();
