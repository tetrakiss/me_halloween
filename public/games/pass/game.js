'use strict';
(() => {
  const $ = id => document.getElementById(id), data = window.PassScenarios;
  const asset = name => '/games/pass/assets/' + name + '?v=1.0.16';
  let typingTimer, requestTimer, previousRequest = '';
  let cameraLabels = [], shiftVisitors = [];
  let index = 0, tab = 'identity', phase = 'intro', answers = [], sound = true, audio;
  function beep(success = true) {
    if (!sound) return;
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
    $('date').textContent = data.date; $('progress').textContent = String(index + 1).padStart(2, '0') + ' / ' + String(data.visitors.length).padStart(2, '0');
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
  function decide(admitted) {
    if (phase !== 'playing') return;
    const visitor = shiftVisitors[index], correct = admitted === data.canAdmit(visitor);
    answers.push({ name: visitor.name, admitted, correct }); phase = 'feedback'; clearInterval(requestTimer); clearTimeout(typingTimer); $('dialogue').classList.remove('typing'); beep(correct);
    const outcome = admitted ? (visitor.admittedOutcome || visitor.outcome) : (visitor.rejectedOutcome || visitor.outcome);
    modal(correct ? 'ВЕРНО' : 'ОШИБКА', visitor.explanation, outcome, index === data.visitors.length - 1 ? 'ИТОГ СМЕНЫ · OK' : 'СЛЕДУЮЩИЙ ПОСЕТИТЕЛЬ · OK', correct);
  }
  function advance() {
    beep();
    if (phase === 'intro' || phase === 'finished') { index = 0; answers = []; shiftVisitors = data.createShift();
      cameraLabels = data.visitors.map((visitor, i) => 'КАМЕРА ' + ['ШЛЮЗА', 'ПОСТА', 'КОРИДОРА'][i % 3] + ' ' + String(i + 1).padStart(2, '0'));
      for (let i = cameraLabels.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cameraLabels[i], cameraLabels[j]] = [cameraLabels[j], cameraLabels[i]]; }
      $('report').replaceChildren(); renderVisitor(); }
    else if (phase === 'feedback') {
      if (index + 1 < data.visitors.length) { index++; renderVisitor(); }
      else { phase = 'finished'; const score = answers.filter(a => a.correct).length;
        $('report').replaceChildren(...answers.map(answer => { const row = document.createElement('p'); row.textContent = (answer.correct ? '✓ ' : '✕ ') + answer.name + ' — ' + (answer.admitted ? 'ДОПУСК' : 'ОТКАЗАНО'); return row; }));
        modal('СМЕНА ЗАВЕРШЕНА', 'Верных решений: ' + score + ' / ' + data.visitors.length, score === data.visitors.length ? 'Шлюз под контролем. Отличная первая смена, инспектор.' : 'Изучите разбор и попробуйте пройти смену без ошибок.', 'ПОВТОРИТЬ СМЕНУ · OK');
      }
    }
  }
  $('identity').onclick = () => { changeTab('identity'); beep(); }; $('baggage').onclick = () => { changeTab('baggage'); beep(); };
  $('reject').onclick = () => decide(false); $('admit').onclick = () => decide(true); $('continue').onclick = advance;
  $('sound').onclick = () => { sound = !sound; $('sound').textContent = sound ? 'ЗВУК: ВКЛ' : 'ЗВУК: ВЫКЛ'; $('sound').setAttribute('aria-pressed', String(sound)); beep(); };
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
  $('date').textContent = data.date; $('continue').focus();
})();
