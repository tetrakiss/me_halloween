(function () {
  const APP_BOOT_STARTED_AT = Date.now();
  const APP = document.getElementById('app');
  const MINI_APP_CONTEXT = window.MINI_APP_CONTEXT || { platform: 'web', initData: '' };

  function hashParams() {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
  }
  function detectPlatform() {
    if (MINI_APP_CONTEXT.platform === 'max') return 'max';
    if (MINI_APP_CONTEXT.platform === 'telegram') return 'telegram';
    return 'dev';
  }
  const PLATFORM = detectPlatform();
  if (PLATFORM === 'telegram' && window.Telegram?.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }
  function getInitDataRaw() {
    if (PLATFORM === 'telegram') return window.Telegram?.WebApp?.initData || MINI_APP_CONTEXT.initData;
    if (PLATFORM === 'max') return window.WebApp?.initData || MINI_APP_CONTEXT.initData;
    return '';
  }
  function getStartParam() {
    if (PLATFORM === 'telegram') {
      return window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
        new URLSearchParams(getInitDataRaw()).get('start_param') || '';
    }
    if (PLATFORM === 'max') {
      const rawInitData = getInitDataRaw();
      return window.WebApp?.initDataUnsafe?.start_param || hashParams().get('WebAppStartParam') ||
        new URLSearchParams(rawInitData).get('start_param') || '';
    }
    return '';
  }
  function devUserId() {
    return new URLSearchParams(location.search).get('dev_user') || 'dev-1';
  }
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Platform': PLATFORM };
    if (PLATFORM === 'dev') headers['X-Dev-User-Id'] = devUserId();
    else headers['X-Init-Data'] = getInitDataRaw();
    const response = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Ошибка запроса');
      error.code = data.code;
      throw error;
    }
    return data;
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;',
    })[char]);
  }
  function toast(message) {
    let element = document.getElementById('toast');
    if (!element) {
      element = document.createElement('div');
      element.id = 'toast';
      element.className = 'toast';
      document.body.appendChild(element);
    }
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
  }
  async function copyFamilyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const input = document.createElement('textarea');
      input.value = code;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    toast('Код семьи скопирован');
  }

  let state = { family: null, group: null, route: null, incomingVisits: null, isAdmin: false };
  let eventState = null;
  let serverClockOffsetMs = 0;
  let countdownTimer = null;
  let childRows = [{ name: '', age: '' }];
  let wishFamilyId = null;
  let currentRegistrationStep = 1;
  const skipReturnSplash = sessionStorage.getItem('skipNextAppSplash') === '1';
  sessionStorage.removeItem('skipNextAppSplash');
  const MIN_LOADING_MS = skipReturnSplash ? 0 : 2000;
  let isInitialLoad = true;
  const urlJoin = new URLSearchParams(location.search).get('join');
  const startParam = getStartParam();
  const startJoin = startParam.startsWith('join_') ? startParam.slice(5) : '';
  const joinCodeFromUrl = urlJoin || startJoin;
  let activeTab = joinCodeFromUrl ? 'join' : 'register';

  const ICONS = {
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5M4 5h9M4 19h9"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 10.8 12 4l8.4 6.8M5.9 9.4V20h12.2V9.4M10 20v-4.2a2 2 0 0 1 4 0V20"/></svg>',
    ghost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.8 20V10.8a6.2 6.2 0 0 1 12.4 0V20q-1.55 3.1-3.1 0-1.55 3.1-3.1 0-1.55 3.1-3.1 0-1.55 3.1-3.1 0zM9.9 9.6h.01M14.1 9.6h.01"/></svg>',
    key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="M11.8 11.8 20 20M16.5 15.5l-2.4 2.4M19 18l-1.6 1.6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7"/></svg>',
  };
  function sectionTitle(icon, text, aside = '') {
    return `<div class="form-section-head"><h4><span class="section-icon">${icon}</span>${text}</h4>${aside}</div>`;
  }
  function pluralChildren(count) {
    const mod10 = count % 10; const mod100 = count % 100;
    const noun = mod10 === 1 && mod100 !== 11 ? 'ребёнок' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'ребёнка' : 'детей';
    return `${count} ${noun}`;
  }
  function celebrationMarkup() {
    const colors = ['var(--accent)', 'var(--violet-2)', 'var(--success)', 'oklch(.975 .018 95)', 'var(--accent-hi)'];
    return `<div class="celebration-layer" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => {
      const x = [4, 12, 21, 30, 39, 48, 57, 65, 73, 82, 91, 96][index];
      const drift = index % 2 ? -(16 + index * 2) : 18 + index;
      const rotation = index % 2 ? `${-330 - index * 8}deg` : `${350 + index * 7}deg`;
      return `<i class="confetti" style="--x:${x}%;--c:${colors[index % colors.length]};--delay:${(index * .03).toFixed(2)}s;--drift:${drift}px;--r:${rotation}"></i>`;
    }).join('')}</div>`;
  }

  function adminButton() {
    return state.isAdmin ? `<button id="adminBtn" class="btn btn-ghost btn-sm admin-entry-button">${ICONS.admin}Администрирование</button>` : '';
  }
  function countdownCard() {
    const bat = '<svg viewBox="0 0 24 24"><path d="M12 7.6c-1.6-2.3-4-3.1-6.4-2.6.6 1 1 2.2.9 3.4-1-.4-2.1-.3-3 .3 1.5 1 2.5 2.7 2.9 4.6 1.6-.9 3.5-.8 5.6.4 2.1-1.2 4-1.3 5.6-.4.4-1.9 1.4-3.6 2.9-4.6-.9-.6-2-.7-3-.3-.1-1.2.3-2.4.9-3.4-2.4-.5-4.8.3-6.4 2.6z"/></svg>';
    const spark = '<svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 2.5l1.6 6 6 1.6-6 1.6-1.6 6-1.6-6-6-1.6 6-1.6z"/></svg>';
    const magic = `<span class="magic-orbit" aria-hidden="true"></span>
      <i class="mote m1" aria-hidden="true"></i><i class="mote m2" aria-hidden="true"></i><i class="mote m3" aria-hidden="true"></i><i class="mote m4" aria-hidden="true"></i>
      <span class="batfly b1" aria-hidden="true">${bat}</span><span class="batfly b2" aria-hidden="true">${bat}</span>
      <i class="spark s1" aria-hidden="true">${spark}</i><i class="spark s2" aria-hidden="true">${spark}</i><i class="spark s3" aria-hidden="true">${spark}</i>`;
    const brand = `<div class="cd-brand"><span class="mark" aria-hidden="true"><iframe src="bat-pixel-animation.html?v=20260927-5" title="" tabindex="-1"></iframe></span>
      <div><h1>Монстрополия</h1><p>Halloween 2026</p></div></div>`;
    if (!eventState?.eventStartAt) {
      return `<section class="cd cd-unset">${magic}<div class="cd-inner">${brand}<div class="cd-empty"><div>
        <div class="cd-head"><span class="cd-dot"></span><b>Начало мероприятия</b></div><h2>Скоро начинаем</h2>
        <p class="cd-sub">Организаторы скоро укажут время начала.</p></div></div></div></section>`;
    }
    return `<section class="cd" id="eventCountdown" aria-live="polite">${magic}<div class="cd-inner">${brand}
      <div class="cd-head"><span class="cd-dot"></span><b>До начала мероприятия</b></div>
      <div class="cd-tiles" role="timer" aria-label="Обратный отсчёт до начала мероприятия">
        <div class="cd-tile cd-tile-days"><span class="cd-n" data-countdown="days">00</span><span class="cd-l" data-countdown-label="days">дней</span></div>
        <div class="cd-tile"><span class="cd-n" data-countdown="hours">00</span><span class="cd-l" data-countdown-label="hours">часов</span></div>
        <div class="cd-tile"><span class="cd-n" data-countdown="minutes">00</span><span class="cd-l" data-countdown-label="minutes">минут</span></div>
        <div class="cd-tile"><span class="cd-n" data-countdown="seconds">00</span><span class="cd-l" data-countdown-label="seconds">секунд</span></div>
      </div><p class="cd-sub" id="countdownStatus">Готовим <em>костюмы</em> и <em>конфеты</em></p></div></section>`;
  }
  function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  function bindCountdown() {
    stopCountdown();
    const card = document.getElementById('eventCountdown');
    if (!card || !eventState?.eventStartAt) return;
    const previous = {};
    const update = () => {
      const remaining = Math.max(0, eventState.eventStartAt - (Date.now() + serverClockOffsetMs));
      const values = {
        days: Math.floor(remaining / 86400000),
        hours: Math.floor((remaining % 86400000) / 3600000),
        minutes: Math.floor((remaining % 3600000) / 60000),
        seconds: Math.floor((remaining % 60000) / 1000),
      };
      Object.entries(values).forEach(([key, value]) => {
        const element = card.querySelector(`[data-countdown="${key}"]`);
        const formatted = String(value).padStart(2, '0');
        if (element && previous[key] !== formatted) {
          element.textContent = formatted;
          element.classList.remove('magic-pop');
          void element.offsetWidth;
          element.classList.add('magic-pop');
          previous[key] = formatted;
        }
      });
      const words = {
        days: ['день', 'дня', 'дней'], hours: ['час', 'часа', 'часов'],
        minutes: ['минута', 'минуты', 'минут'], seconds: ['секунда', 'секунды', 'секунд'],
      };
      Object.entries(values).forEach(([key, value]) => {
        const mod10 = value % 10; const mod100 = value % 100;
        const word = mod10 === 1 && mod100 !== 11 ? words[key][0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? words[key][1] : words[key][2];
        const label = card.querySelector(`[data-countdown-label="${key}"]`);
        if (label) label.textContent = word;
      });
      if (remaining === 0) {
        card.classList.add('countdown-live');
        document.getElementById('countdownStatus').textContent = 'Мероприятие началось!';
        stopCountdown();
      }
    };
    update();
    countdownTimer = setInterval(update, 1000);
  }
  function bindAdminButton() {
    const button = document.getElementById('adminBtn');
    if (button) button.onclick = () => {
      location.href = `/admin.html${location.search}${location.hash}`;
    };
  }
  function loadingMarkup() {
    return `<div class="loading-splash" role="status" aria-label="Приложение загружается">
      <div class="loading-inner">
        <div class="loading-orbit" aria-hidden="true">
          <iframe class="loading-bat" src="bat-pixel-animation.html?v=20260927-5" title="" tabindex="-1"></iframe>
        </div>
        <div class="loading-copy">
          <span class="loading-kicker">HALLOWEEN BOT</span>
          <h2>Монстрополия</h2>
          <p>Собираем костюмы и конфеты</p>
          <span class="loading-track" aria-hidden="true"><i></i></span>
        </div>
      </div>
    </div>`;
  }
  function renderLoading() {
    stopCountdown();
    APP.innerHTML = loadingMarkup();
  }
  async function finishInitialLoading(isBoot) {
    if (!isBoot) return;
    const splash = APP.querySelector('.loading-splash');
    if (!splash) return;
    splash.classList.add('is-leaving');
    await new Promise((resolve) => setTimeout(resolve, 460));
  }
  function renderEntry() {
    APP.innerHTML = `${countdownCard()}${adminButton()}<div class="tabs">
      <button id="tabRegister" class="${activeTab === 'register' ? 'active' : ''}" aria-selected="${activeTab === 'register'}">Записать семью</button>
      <button id="tabJoin" class="${activeTab === 'join' ? 'active' : ''}" aria-selected="${activeTab === 'join'}">У нас есть код</button>
      </div><div id="tabContent"></div>`;
    bindAdminButton();
    document.getElementById('tabRegister').onclick = () => { activeTab = 'register'; currentRegistrationStep = 1; renderEntry(); };
    document.getElementById('tabJoin').onclick = () => { activeTab = 'join'; renderEntry(); };
    if (activeTab === 'register') renderRegisterForm();
    else renderJoinForm();
    bindCountdown();
  }
  function renderJoinForm() {
    document.getElementById('tabContent').innerHTML = `<section class="panel sect">
      <div class="sect-head"><h2><span class="h-ico">${ICONS.key}</span>Присоединиться к семье</h2></div>
      <p class="sect-p">Введите код, который получил уже зарегистрированный член семьи. Этот же код нужен, если вы зарегистрировались через Telegram, а теперь хотите открыть данные семьи в MAX — новую запись создавать не нужно.</p>
      <label class="fld"><span class="lbl">Код семьи</span><input class="ctl" type="text" id="joinCode" placeholder="Например ABC123" value="${esc(joinCodeFromUrl)}" autocomplete="off" autocapitalize="characters" /></label>
      <div id="joinMsg" class="wizard-status" aria-live="polite"></div>
      <button id="joinBtn" class="btn btn-primary">Присоединиться</button></section>`;
    document.getElementById('joinBtn').onclick = async () => {
      const code = document.getElementById('joinCode').value.trim();
      if (!code) return void (document.getElementById('joinMsg').textContent = 'Введите код');
      try { await api('/join', { method: 'POST', body: { familyCode: code } }); await loadMe(); }
      catch (error) { document.getElementById('joinMsg').textContent = error.message; }
    };
  }
  function syncChildRows() {
    childRows = childRows.map((child, index) => ({
      name: document.querySelector(`[data-child-name="${index}"]`)?.value ?? child.name,
      age: document.querySelector(`[data-child-age="${index}"]`)?.value ?? child.age,
    }));
  }
  function renderChildRows() {
    const container = document.getElementById('childrenList');
    container.innerHTML = childRows.map((child, index) => `<div class="kidrow child-row">
      <input class="ctl kid-name" type="text" placeholder="Имя" aria-label="Имя ребёнка ${index + 1}" data-child-name="${index}" value="${esc(child.name)}" />
      <input class="ctl kid-age" type="number" placeholder="Возраст" aria-label="Возраст ребёнка ${index + 1}" data-child-age="${index}" value="${esc(child.age)}" min="1" max="17" />
      <button type="button" class="kid-rm child-remove" data-remove="${index}" aria-label="Убрать ребёнка">${ICONS.close}</button></div>`).join('');
    const count = document.getElementById('childCount');
    if (count) count.textContent = pluralChildren(childRows.length);
    container.querySelectorAll('[data-remove]').forEach((button) => {
      button.onclick = () => {
        syncChildRows();
        if (childRows.length > 1) childRows.splice(Number(button.dataset.remove), 1);
        else childRows = [{ name: '', age: '' }];
        renderChildRows();
      };
    });
  }
  function readChildren() {
    syncChildRows();
    return childRows.map((child) => ({ name: child.name.trim(), age: Number(child.age) })).filter((child) => child.name && child.age);
  }
  function towerOptions(selected) {
    return window.TOWERS.map((tower) => `<option value="${esc(tower)}" ${tower === selected ? 'selected' : ''}>${esc(tower)}</option>`).join('');
  }
  function groupTitle(group) {
    const raw = String(group?.name || '');
    const generated = raw.match(/^group_(\d+)$/i);
    if (generated) return `Группа ${generated[1]}`;
    return raw || 'Ваш маршрут';
  }
  function renderRegisterForm() {
    document.getElementById('tabContent').innerHTML = `<div class="panel wizard">
      <div class="step-meta"><span class="step-count" id="stepCount">Шаг 1 из 5</span><span class="pill" id="stepHint">Адрес</span></div>
      <div class="wizard-progress" aria-hidden="true">${[1, 2, 3, 4, 5].map((step) => `<span class="progress-seg ${step === 1 ? 'done' : ''}" data-progress="${step}"></span>`).join('')}</div>

      <section class="form-step active" data-step="1">
        <div><h2 class="step-title">Где вы живёте?</h2><p class="step-copy">Укажите адрес, чтобы мы сделали маршрут.</p></div>
        <label class="fld"><span class="lbl">Башня</span><select class="ctl" id="tower">${towerOptions()}</select></label>
        <div class="row">
          <label class="fld"><span class="lbl">Этаж</span><input class="ctl" type="number" id="floor" min="0" max="200" placeholder="Например 22" /><span class="field-error" id="floorError">Укажите этаж числом</span></label>
          <label class="fld"><span class="lbl">Квартира</span><input class="ctl" type="text" id="apartmentCode" placeholder="Например 2206Г" /><span class="field-error" id="apartmentError">Укажите номер квартиры</span></label>
        </div><div class="step-actions first"><button class="btn btn-primary" type="button" data-next="2">Продолжить</button></div>
      </section>

      <section class="form-step" data-step="2">
        <div><h2 class="step-title">Хотите быть в группе с определённой семьёй?</h2><p class="step-copy">Если да — найдём уже зарегистрированную квартиру.</p></div>
        <div class="choice-grid" role="radiogroup" aria-label="Выбор совместной группы">
          <label class="choice"><input type="radio" name="groupChoice" value="no" checked /><span class="choice-box"><b>Нет</b><span>Подберём группу автоматически</span></span></label>
          <label class="choice"><input type="radio" name="groupChoice" value="yes" /><span class="choice-box"><b>Да</b><span>Найти знакомую семью</span></span></label>
        </div>
        <div class="group-search" id="groupSearch">
          <label class="fld"><span class="lbl">Башня семьи</span><select class="ctl" id="wishTower">${towerOptions()}</select></label>
          <label class="fld"><span class="lbl">Номер квартиры</span><input class="ctl" type="text" id="wishApartment" placeholder="Например 684" list="wishApartmentList" /><span class="field-error" id="wishError">Выберите зарегистрированную семью</span></label>
          <datalist id="wishApartmentList"></datalist><div id="wishHint" class="search-hint" aria-live="polite"></div>
        </div>
        <div class="step-actions"><button class="step-back" type="button" data-back="1" aria-label="Вернуться к адресу">${ICONS.back}</button><button class="btn btn-primary" type="button" data-next="3">Продолжить</button></div>
      </section>

      <section class="form-step" data-step="3">
        <div class="sect-head"><div><h2 class="step-title">Добавьте детей</h2><p class="step-copy">Имя и возраст помогут сформировать подходящую группу.</p></div><span class="pill" id="childCount">1 ребёнок</span></div>
        <div class="kids" id="childrenList"></div><button type="button" id="addChild" class="btn btn-ghost add-kid">${ICONS.plus}Добавить ребёнка</button>
        <p class="field-error" id="kidsError">Заполните имя и возраст каждого ребёнка от 1 до 17 лет</p>
        <div class="step-actions"><button class="step-back" type="button" data-back="2" aria-label="Вернуться к выбору группы">${ICONS.back}</button><button class="btn btn-primary" type="button" data-next="4">Продолжить</button></div>
      </section>

      <section class="form-step" data-step="4">
        <div><h2 class="step-title">Последние детали</h2><p class="step-copy">Отметьте, что будет ждать участников у вашей двери.</p></div>
        <div class="subblock">
          <div class="switch-row"><span class="sw-t">Раздаём конфеты в квартире 🍬</span><label class="switch"><input id="hosting" type="checkbox" aria-label="Раздаём конфеты в квартире" /><span class="track"></span></label></div>
          <div class="switch-row"><span class="sw-t">У нас будет квест 🎭</span><label class="switch"><input id="quest" type="checkbox" aria-label="У нас будет квест" /><span class="track"></span></label></div>
          <div id="questDurationWrap" hidden><label class="fld"><span class="lbl">Длительность квеста, минут</span><input class="ctl" type="number" id="questDuration" value="20" min="5" max="40" /></label></div>
        </div>
        <div class="step-actions"><button class="step-back" type="button" data-back="3" aria-label="Вернуться к детям">${ICONS.back}</button><button class="btn btn-primary" type="button" data-next="5">Проверить данные</button></div>
      </section>

      <section class="form-step" data-step="5">
        <div><h2 class="step-title">Всё верно?</h2><p class="step-copy">Проверьте данные перед записью семьи. Любой раздел можно быстро изменить.</p></div>
        <div class="review-list">
          <article class="review-card"><div class="review-head"><span>Адрес</span><button class="review-edit" type="button" data-edit-step="1">Изменить</button></div><div class="review-value" id="reviewAddress">—</div></article>
          <article class="review-card"><div class="review-head"><span>Совместная группа</span><button class="review-edit" type="button" data-edit-step="2">Изменить</button></div><div class="review-value" id="reviewGroup">—</div><p class="review-note" id="reviewGroupNote"></p></article>
          <article class="review-card"><div class="review-head"><span>Дети</span><button class="review-edit" type="button" data-edit-step="3">Изменить</button></div><div class="review-kids" id="reviewKids"></div></article>
          <article class="review-card"><div class="review-head"><span>Участие</span><button class="review-edit" type="button" data-edit-step="4">Изменить</button></div><div class="review-value" id="reviewOptions">—</div></article>
        </div>
        <div id="registerMsg" class="wizard-status" aria-live="polite"></div>
        <div class="step-actions"><button class="step-back" type="button" data-back="4" aria-label="Вернуться к настройкам">${ICONS.back}</button><button class="btn btn-primary" id="submitRegister" type="button">Подтвердить и записаться</button></div>
      </section>
    </div>`;
    renderChildRows();
    document.getElementById('addChild').onclick = () => { syncChildRows(); childRows.push({ name: '', age: '' }); renderChildRows(); };
    document.getElementById('hosting').onchange = (event) => {
      if (!event.target.checked) {
        document.getElementById('quest').checked = false;
        document.getElementById('questDurationWrap').hidden = true;
      }
    };
    document.getElementById('quest').onchange = (event) => {
      if (event.target.checked) document.getElementById('hosting').checked = true;
      document.getElementById('questDurationWrap').hidden = !event.target.checked;
    };
    document.querySelectorAll('input[name="groupChoice"]').forEach((radio) => {
      radio.onchange = () => {
        document.getElementById('groupSearch').classList.toggle('active', radio.value === 'yes' && radio.checked);
        if (radio.value === 'no' && radio.checked) {
          wishFamilyId = null;
          document.getElementById('wishApartment').value = '';
          document.getElementById('wishHint').textContent = '';
        }
      };
    });
    bindWishSearch();
    const setError = (inputId, errorId, visible) => {
      document.getElementById(inputId)?.setAttribute('aria-invalid', visible ? 'true' : 'false');
      document.getElementById(errorId)?.classList.toggle('show', visible);
    };
    const registrationData = () => ({
      tower: document.getElementById('tower').value,
      floor: Number(document.getElementById('floor').value),
      floorRaw: document.getElementById('floor').value,
      apartmentCode: document.getElementById('apartmentCode').value.trim(),
      children: readChildren(),
      wantsCompanion: document.querySelector('input[name="groupChoice"]:checked')?.value === 'yes',
      hosting: document.getElementById('hosting').checked,
      quest: document.getElementById('quest').checked,
      questDurationMin: Number(document.getElementById('questDuration').value) || 20,
    });
    const validateStep = (step) => {
      const data = registrationData();
      if (step === 1) {
        const badFloor = !data.floorRaw || !Number.isInteger(data.floor) || data.floor < 0 || data.floor > 200;
        const badApartment = !data.apartmentCode;
        setError('floor', 'floorError', badFloor); setError('apartmentCode', 'apartmentError', badApartment);
        return !badFloor && !badApartment;
      }
      if (step === 2) {
        const invalid = data.wantsCompanion && (!document.getElementById('wishApartment').value.trim() || !wishFamilyId);
        setError('wishApartment', 'wishError', invalid); return !invalid;
      }
      if (step === 3) {
        syncChildRows();
        const invalid = !childRows.length || childRows.some((child) => !child.name.trim() || !Number.isInteger(Number(child.age)) || Number(child.age) < 1 || Number(child.age) > 17);
        document.getElementById('kidsError').classList.toggle('show', invalid); return !invalid;
      }
      return true;
    };
    const renderReview = () => {
      const data = registrationData();
      document.getElementById('reviewAddress').textContent = `${data.tower} · этаж ${data.floor} · квартира ${data.apartmentCode}`;
      document.getElementById('reviewGroup').textContent = data.wantsCompanion ? `${document.getElementById('wishTower').value} · квартира ${document.getElementById('wishApartment').value.trim()}` : 'Подберём автоматически';
      document.getElementById('reviewGroupNote').textContent = data.wantsCompanion ? 'Пожелание будет учтено при формировании групп.' : 'Учтём возраст детей и вашу башню.';
      document.getElementById('reviewKids').innerHTML = data.children.map((child) => `<span class="review-kid">${esc(child.name)} · ${child.age}</span>`).join('');
      const options = [];
      if (data.hosting) options.push('Раздаём конфеты 🍬');
      if (data.quest) options.push(`Квест 🎭 · ${data.questDurationMin} мин`);
      document.getElementById('reviewOptions').textContent = options.length ? options.join(' · ') : 'Тип приёма гостей не выбран';
    };
    const showStep = (step) => {
      currentRegistrationStep = step;
      document.querySelectorAll('.form-step').forEach((section) => section.classList.toggle('active', Number(section.dataset.step) === step));
      document.querySelectorAll('.progress-seg').forEach((segment) => segment.classList.toggle('done', Number(segment.dataset.progress) <= step));
      const labels = ['Адрес', 'Группа', 'Дети', 'Участие', 'Проверка'];
      document.getElementById('stepCount').textContent = `Шаг ${step} из 5`;
      document.getElementById('stepHint').textContent = labels[step - 1];
      if (step === 5) renderReview();
      document.getElementById('tabContent').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    document.querySelectorAll('[data-next]').forEach((button) => { button.onclick = () => { if (validateStep(currentRegistrationStep)) showStep(Number(button.dataset.next)); }; });
    document.querySelectorAll('[data-back]').forEach((button) => { button.onclick = () => showStep(Number(button.dataset.back)); });
    document.querySelectorAll('[data-edit-step]').forEach((button) => { button.onclick = () => showStep(Number(button.dataset.editStep)); });
    showStep(currentRegistrationStep);
    document.getElementById('submitRegister').onclick = async () => {
      if (![1, 2, 3].every((step) => validateStep(step))) return;
      const data = registrationData();
      const message = document.getElementById('registerMsg');
      message.textContent = 'Сохраняем запись…';
      try {
        const response = await api('/register', { method: 'POST', body: {
          tower: data.tower, floor: data.floor, apartmentCode: data.apartmentCode, children: data.children,
          walking: true, hosting: data.hosting, quest: data.quest, questDurationMin: data.questDurationMin,
          wishFamilyId: data.wantsCompanion ? wishFamilyId : null,
        } });
        renderRegisteredSuccess(response.family);
      } catch (error) {
        if (error.code === 'APARTMENT_EXISTS') renderApartmentExists();
        else message.textContent = error.message;
      }
    };
  }
  function renderApartmentExists() {
    APP.innerHTML = `<div class="card state-card"><div class="state-icon">🏠</div><span class="form-kicker">Запись найдена</span><h3>Ваша квартира уже участвует</h3>
      <p>Для этой квартиры уже создана семейная запись. Не создавайте вторую запись — попросите код доступа у родных.</p>
      <p class="muted">Код также позволяет открыть одну и ту же семейную запись в разных приложениях: например, зарегистрироваться через Telegram, а затем войти в MAX.</p>
      <div class="form-actions"><button id="existingApartmentJoinBtn">Ввести код семьи</button>
      <button id="existingApartmentBackBtn" class="secondary">Вернуться</button></div></div>`;
    document.getElementById('existingApartmentJoinBtn').onclick = () => { activeTab = 'join'; renderEntry(); };
    document.getElementById('existingApartmentBackBtn').onclick = () => { activeTab = 'register'; renderEntry(); };
  }
  function bindWishSearch({
    towerId = 'wishTower',
    apartmentId = 'wishApartment',
    listId = 'wishApartmentList',
    hintId = 'wishHint',
    excludeFamilyId = null,
  } = {}) {
    let timer;
    const towerInput = document.getElementById(towerId);
    const apartmentInput = document.getElementById(apartmentId);
    const hint = document.getElementById(hintId);
    const resetWish = () => {
      wishFamilyId = null;
      hint.textContent = '';
      hint.className = 'search-hint';
    };
    towerInput.onchange = () => {
      apartmentInput.value = '';
      resetWish();
    };
    apartmentInput.oninput = (event) => {
      clearTimeout(timer); const value = event.target.value.trim(); wishFamilyId = null;
      if (!value) return void resetWish();
      timer = setTimeout(async () => {
        const tower = towerInput.value;
        try {
          const suggestions = await api(`/apartments-suggest?tower=${encodeURIComponent(tower)}&query=${encodeURIComponent(value)}`);
          document.getElementById(listId).innerHTML = suggestions.apartmentCodes.map((code) => `<option value="${esc(code)}"></option>`).join('');
          const found = await api(`/search?tower=${encodeURIComponent(tower)}&apartmentCode=${encodeURIComponent(value)}`);
          if (found.found && found.familyId === excludeFamilyId) {
            hint.textContent = 'Это ваша семья — выберите другую квартиру';
            hint.className = 'search-hint';
          } else if (found.found) { wishFamilyId = found.familyId; hint.textContent = `Нашли: ${found.childrenNames.join(', ')} — свяжем вас в одну группу`; hint.className = 'search-hint found'; }
          else { hint.textContent = 'Такая семья пока не зарегистрирована'; hint.className = 'search-hint'; }
        } catch { hint.textContent = ''; }
      }, 350);
    };
  }
  function renderRegisteredSuccess(family) {
    stopCountdown();
    const children = (family.children || []).map((child) => `${esc(child.name)}, ${child.age}`).join('<br>');
    APP.innerHTML = `<section class="family-state active celebrate">${celebrationMarkup()}
      <div class="success-card"><span class="success-seal" aria-hidden="true">${ICONS.check}</span><span class="success-kicker">Регистрация завершена</span>
        <h2>Ваша семья в игре</h2><p>Сохраните код: по нему близкие смогут присоединиться с другого устройства.</p></div>
      <div class="code-card"><span class="code-label">Код семьи</span><div class="code-row"><strong class="family-code">${esc(family.familyCode)}</strong>
        <button class="copy-code" id="familyCodeBtn" aria-label="Скопировать код семьи">${ICONS.copy}</button></div></div>
      <div class="family-summary">
        <div class="summary-item"><span>Адрес</span><b>${esc(family.tower)}, ${family.floor} этаж, кв. ${esc(family.apartmentCode)}</b></div>
        <div class="summary-item"><span>Дети</span><b>${children}</b></div>
        <div class="summary-item"><span>Раздаём конфеты</span><b>${family.hosting ? 'Да 🍬' : 'Нет'}</b></div>
        <div class="summary-item"><span>Квест</span><b>${family.quest ? `Будет · ${family.questDurationMin || 20} мин` : 'Нет'}</b></div>
      </div><div class="state-actions"><button id="shareBtn" class="btn btn-ghost btn-sm">Поделиться кодом</button><button id="continueBtn" class="btn btn-primary btn-sm">К данным семьи</button></div></section>`;
    document.getElementById('familyCodeBtn').onclick = () => copyFamilyCode(family.familyCode);
    document.getElementById('shareBtn').onclick = async () => {
      const text = `Присоединяйся к нашей записи в «Монстрополию»! Код семьи: ${family.familyCode}`;
      if (navigator.share) await navigator.share({ text }).catch(() => {}); else await copyFamilyCode(family.familyCode);
    };
    document.getElementById('continueBtn').onclick = loadMe;
  }
  function renderDashboard() {
    const family = state.family;
    const children = family.children.map((child) => `${esc(child.name)}, ${child.age}`).join('<br>');
    APP.innerHTML = `${countdownCard()}${adminButton()}<section class="family-home">
      <div class="family-success-card"><span class="success-seal" aria-hidden="true">${ICONS.check}</span><span class="family-success-kicker">Регистрация завершена</span>
        <h2>Ваша семья в игре</h2><p>Данные сохранены. По семейному коду близкие смогут присоединиться с другого устройства.</p></div>
      <div class="family-code-card"><span>Код семьи</span><div class="family-code-row">
        <strong class="family-code-value">${esc(family.familyCode)}</strong>
        <button class="family-copy-button" id="familyCodeBtn" aria-label="Скопировать код семьи">⧉</button></div></div>
      <div class="family-summary-grid" aria-label="Данные семьи">
        <div class="family-summary-item"><span>Адрес</span><b>${esc(family.tower)}<br>этаж ${family.floor}, кв. ${esc(family.apartmentCode)}</b></div>
        <div class="family-summary-item"><span>Дети</span><b>${children}</b></div>
        <div class="family-summary-item"><span>Раздаём конфеты</span><b>${family.hosting ? 'Да 🍬' : 'Нет'}</b></div>
        <div class="family-summary-item"><span>Квест</span><b>${family.quest ? `${family.questDurationMin || 20} минут` : 'Нет'}</b></div>
      </div>
      <div class="family-state-actions"><button id="editFamilyBtn" class="secondary">Изменить</button>
        <button id="showRouteBtn">К маршруту</button></div>
      <button id="deleteFamilyBtn" class="family-delete-button">Удалить семейную запись</button>
    </section>${renderIncomingVisitsCard()}${state.group ? renderRouteCard() : renderWaitingCard()}`;
    bindAdminButton();
    bindCountdown();
    document.getElementById('familyCodeBtn').onclick = () => copyFamilyCode(family.familyCode);
    document.getElementById('editFamilyBtn').onclick = renderEditForm;
    document.getElementById('deleteFamilyBtn').onclick = renderDeleteConfirmation;
    document.getElementById('showRouteBtn').onclick = () => document.getElementById('familyRouteCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('[data-door]').forEach((button) => {
      button.onclick = async () => { button.disabled = true;
        try { await api('/door-status', { method: 'POST', body: { hostId: button.dataset.door, status: 'no_answer' } }); button.textContent = 'Отправлено ✓'; }
        catch (error) { button.disabled = false; toast(error.message); }
      };
    });
  }
  function renderIncomingVisitsCard() {
    if (!state.family?.hosting && !state.family?.quest) return '';
    const visits = state.incomingVisits || { groupCount: 0, childCount: 0 };
    const kind = state.family.quest ? 'Квест в вашей квартире 🎭' : 'Раздача конфет в вашей квартире 🍬';
    const note = visits.groupCount
      ? 'Расчёт сделан по сформированным маршрутам.'
      : 'После формирования маршрутов здесь появится прогноз посещений.';
    return `<section class="card incoming-visits-card"><div class="countdown-kicker">${kind}</div>
      <h3>К вам придут</h3><div class="incoming-visits-grid">
        <div><strong>${visits.groupCount}</strong><span>групп</span></div>
        <div><strong>${visits.childCount}</strong><span>детей всего</span></div>
      </div><p class="muted">${note}</p></section>`;
  }
  function renderEditForm() {
    stopCountdown();
    const family = state.family;
    const currentWish = family.wishFamilies?.[0] || null;
    wishFamilyId = currentWish?.id || null;
    childRows = family.children.map((child) => ({ name: child.name, age: child.age }));
    APP.innerHTML = `<div class="card form-card">
      <div class="form-head"><span class="form-kicker">Настройки семьи</span><h3>Редактировать запись</h3><p>Измените адрес, состав семьи или формат участия.</p></div>
      <section class="form-section"><h4>Адрес</h4><div class="form-row form-row-address">
        <label class="form-field"><span>Башня <i>*</i></span><select id="editTower">${towerOptions(family.tower)}</select></label>
        <label class="form-field"><span>Этаж <i>*</i></span><input type="number" id="editFloor" value="${family.floor}" min="0" max="200" /></label>
        <label class="form-field"><span>Квартира <i>*</i></span><input type="text" id="editApartment" value="${esc(family.apartmentCode)}" /></label>
      </div></section>
      <section class="form-section"><h4>Хотим идти вместе</h4><p class="form-help">Чтобы убрать пожелание, очистите номер квартиры.</p><div class="form-row">
        <label class="form-field"><span>Башня</span><select id="editWishTower">${towerOptions(currentWish?.tower)}</select></label>
        <label class="form-field"><span>Квартира</span><input type="text" id="editWishApartment" value="${esc(currentWish?.apartmentCode || '')}" placeholder="Номер квартиры" list="editWishApartmentList" /></label></div>
        <datalist id="editWishApartmentList"></datalist><div id="editWishHint" class="search-hint form-status ${currentWish ? 'found' : ''}">${currentWish ? `Выбрана семья: ${esc(currentWish.childrenNames.join(', '))}` : ''}</div>
      </section>
      <section class="form-section"><h4>Дети</h4><div id="childrenList"></div><button type="button" id="addChild" class="secondary small">+ Добавить ребёнка</button></section>
      <section class="form-section"><h4>Участие</h4>
        <div class="toggle-row"><span><b>Участвуем в обходе</b><small>Дети идут по маршруту</small></span><input type="checkbox" id="editWalking" aria-label="Участвуем в обходе" ${family.walking ? 'checked' : ''} /></div>
        <div class="toggle-row"><span><b>Раздаём конфеты в квартире</b><small>Выдаём конфеты участникам</small></span><input type="checkbox" id="editHosting" aria-label="Раздаём конфеты в квартире" ${family.hosting ? 'checked' : ''} /></div>
        <div class="toggle-row"><span><b>У нас будет квест</b><small>Точка с заданием</small></span><input type="checkbox" id="editQuest" aria-label="У нас будет квест" ${family.quest ? 'checked' : ''} /></div>
        <div id="editQuestWrap" ${family.quest ? '' : 'hidden'}><label class="form-field"><span>Длительность квеста</span><input type="number" id="editQuestDuration" value="${family.questDurationMin || 20}" min="5" max="40" /></label></div>
      </section>
      <div id="editMsg" class="search-hint form-status" aria-live="polite"></div>
      <div class="form-actions"><button id="saveFamilyBtn">Сохранить</button><button id="cancelEditBtn" class="secondary">Отмена</button></div></div>`;
    renderChildRows();
    document.getElementById('addChild').onclick = () => { syncChildRows(); childRows.push({ name: '', age: '' }); renderChildRows(); };
    document.getElementById('editHosting').onchange = (event) => {
      if (!event.target.checked) {
        document.getElementById('editQuest').checked = false;
        document.getElementById('editQuestWrap').hidden = true;
      }
    };
    document.getElementById('editQuest').onchange = (event) => {
      if (event.target.checked) document.getElementById('editHosting').checked = true;
      document.getElementById('editQuestWrap').hidden = !event.target.checked;
    };
    bindWishSearch({ towerId: 'editWishTower', apartmentId: 'editWishApartment', listId: 'editWishApartmentList', hintId: 'editWishHint', excludeFamilyId: family.id });
    document.getElementById('cancelEditBtn').onclick = renderDashboard;
    document.getElementById('saveFamilyBtn').onclick = async () => {
      const floor = Number(document.getElementById('editFloor').value); const children = readChildren();
      if (!document.getElementById('editFloor').value || !Number.isInteger(floor) || floor < 0 || !children.length) return void (document.getElementById('editMsg').textContent = 'Проверьте этаж и данные детей');
      if (document.getElementById('editWishApartment').value.trim() && !wishFamilyId) return void (document.getElementById('editMsg').textContent = 'Выберите зарегистрированную семью из поиска или очистите номер квартиры');
      try {
        await api('/me', { method: 'PATCH', body: {
          tower: document.getElementById('editTower').value, floor, apartmentCode: document.getElementById('editApartment').value.trim(), children,
          walking: document.getElementById('editWalking').checked, hosting: document.getElementById('editHosting').checked,
          quest: document.getElementById('editQuest').checked, questDurationMin: Number(document.getElementById('editQuestDuration').value) || 20,
          wishFamilyId,
        } });
        toast('Запись семьи обновлена'); await loadMe();
      } catch (error) { document.getElementById('editMsg').textContent = error.message; }
    };
  }
  function renderDeleteConfirmation() {
    stopCountdown();
    APP.innerHTML = `<div class="card state-card danger-state"><div class="state-icon">!</div><span class="form-kicker">Опасное действие</span><h3>Удалить семейную запись?</h3>
      <p>Будут полностью удалены анкета, дети, пожелания и доступ всех членов семьи. Отменить это действие будет нельзя.</p>
      <div id="deleteFamilyMsg" class="search-hint form-status" aria-live="polite"></div>
      <div class="form-actions"><button id="cancelDeleteFamilyBtn" class="secondary">Отмена</button>
      <button id="confirmDeleteFamilyBtn" class="danger">Да, удалить полностью</button></div></div>`;
    document.getElementById('cancelDeleteFamilyBtn').onclick = renderDashboard;
    document.getElementById('confirmDeleteFamilyBtn').onclick = async () => {
      const button = document.getElementById('confirmDeleteFamilyBtn');
      const message = document.getElementById('deleteFamilyMsg');
      button.disabled = true;
      message.textContent = 'Удаляем…';
      try {
        await api('/me', { method: 'DELETE' });
        state = { family: null, group: null, route: null, incomingVisits: null, isAdmin: state.isAdmin };
        activeTab = 'register';
        toast('Запись семьи удалена');
        renderEntry();
      } catch (error) {
        button.disabled = false;
        message.textContent = error.message;
      }
    };
  }
  function renderWaitingCard() {
    const paused = state.family?.groupingPaused;
    return `<section class="card family-route-card family-route-empty" id="familyRouteCard"><div class="family-section-head">
      <div><span class="form-kicker">Маршрут обхода</span><h3>${paused ? 'Ожидаете перераспределения' : 'Группа ещё не сформирована'}</h3></div><span class="family-pill">Ожидание</span></div>
      <p>${paused ? 'Организатор убрал семью из прежней группы. После нового назначения здесь появится маршрут.' : 'Когда организаторы соберут группы, здесь появится порядок квартир и специальных точек.'}</p></section>`;
  }
  function renderRouteCard() {
    const items = (state.route || []).map((stop) => {
      const kind = stop.isQuest ? '🎭 Квест' : '🍬 Конфеты';
      const title = stop.isSpecial ? esc(stop.displayName) : esc(stop.tower);
      const address = stop.isSpecial ? `${esc(stop.tower)} · этаж ${stop.floor}` : `этаж ${stop.floor} · квартира ${esc(stop.apartmentCode)}`;
      return `<li class="stop family-route-stop ${stop.isQuest ? 'quest' : ''} ${stop.lastKnownStatus === 'no_answer' ? 'warned' : ''}">
        <div class="stop-num">${stop.seq}</div><div class="stop-info"><div class="addr">${title}</div><div class="stop-address">${address}</div>
        ${stop.lastKnownStatus === 'no_answer' ? '<div class="stop-warning">⚠️ ранее не открыли</div>' : ''}</div>
        <div class="route-stop-actions"><span class="route-kind">${kind}</span><button class="secondary small door-button" data-door="${esc(stop.hostId)}">Не открыли</button></div></li>`;
    }).join('');
    return `<section class="card family-route-card" id="familyRouteCard"><div class="family-section-head">
      <div><span class="form-kicker">Маршрут обхода</span><h3>${esc(groupTitle(state.group))}</h3></div>
      <span class="family-pill">${(state.route || []).length} точек</span></div>
      <p class="family-route-intro">Порядок, в котором ваша группа идёт по квартирам. Он обновляется после формирования групп.</p>
      ${items ? `<div class="family-route-cap"><span>⌂</span><small>Начало маршрута</small></div><ul class="route-list family-route-list">${items}</ul>
        <div class="family-route-cap family-route-cap-end"><span>✓</span><small>Маршрут завершён</small></div>` : '<p>Маршрут пока пуст.</p>'}</section>`;
  }
  async function loadMe() {
    const isBoot = isInitialLoad;
    const loadingStartedAt = isBoot ? APP_BOOT_STARTED_AT : Date.now();
    const minimumLoadingMs = isBoot ? MIN_LOADING_MS : 0;
    isInitialLoad = false;
    renderLoading();
    try {
      const requestStartedAt = Date.now();
      const [data, eventData] = await Promise.all([api('/me'), api('/event')]);
      serverClockOffsetMs = eventData.serverNow - ((requestStartedAt + Date.now()) / 2);
      eventState = eventData;
      const remainingLoadingMs = minimumLoadingMs - (Date.now() - loadingStartedAt);
      if (remainingLoadingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs));
      state = {
        family: data.family,
        group: data.group || null,
        route: data.route || null,
        incomingVisits: data.incomingVisits || null,
        isAdmin: !!data.isAdmin,
      };
      await finishInitialLoading(isBoot);
      if (!state.family) renderEntry(); else renderDashboard();
    } catch (error) {
      const remainingLoadingMs = minimumLoadingMs - (Date.now() - loadingStartedAt);
      if (remainingLoadingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs));
      await finishInitialLoading(isBoot);
      APP.innerHTML = `<div class="card"><p>Ошибка: ${esc(error.message)}</p></div>`;
    }
  }
  loadMe();
})();
