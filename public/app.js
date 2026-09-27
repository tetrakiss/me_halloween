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
  };
  function sectionTitle(icon, text, aside = '') {
    return `<div class="form-section-head"><h4><span class="section-icon">${icon}</span>${text}</h4>${aside}</div>`;
  }
  function pluralChildren(count) {
    const mod10 = count % 10; const mod100 = count % 100;
    const noun = mod10 === 1 && mod100 !== 11 ? 'ребёнок' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'ребёнка' : 'детей';
    return `${count} ${noun}`;
  }

  function adminButton() {
    return state.isAdmin ? `<button id="adminBtn" class="secondary admin-entry-button">${ICONS.admin}Администрирование</button>` : '';
  }
  function countdownCard() {
    const magic = `<span class="countdown-magic" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="countdown-bat bat-one" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 7.6C10.4 5.3 8 4.5 5.6 5c.6 1 1 2.2.9 3.4-1-.4-2.1-.3-3 .3 1.5 1 2.5 2.7 2.9 4.6 1.6-.9 3.5-.8 5.6.4 2.1-1.2 4-1.3 5.6-.4.4-1.9 1.4-3.6 2.9-4.6-.9-.6-2-.7-3-.3-.1-1.2.3-2.4.9-3.4-2.4-.5-4.8.3-6.4 2.6Z"/></svg></span>
      <span class="countdown-bat bat-two" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 7.6C10.4 5.3 8 4.5 5.6 5c.6 1 1 2.2.9 3.4-1-.4-2.1-.3-3 .3 1.5 1 2.5 2.7 2.9 4.6 1.6-.9 3.5-.8 5.6.4 2.1-1.2 4-1.3 5.6-.4.4-1.9 1.4-3.6 2.9-4.6-.9-.6-2-.7-3-.3-.1-1.2.3-2.4.9-3.4-2.4-.5-4.8.3-6.4 2.6Z"/></svg></span>
      <i class="countdown-spark spark-one" aria-hidden="true">✦</i><i class="countdown-spark spark-two" aria-hidden="true">✦</i><i class="countdown-spark spark-three" aria-hidden="true">✦</i>`;
    if (!eventState?.eventStartAt) {
      return `<section class="countdown-card family-countdown countdown-unset">
        ${magic}
        <div class="countdown-content"><div class="countdown-kicker"><span class="countdown-dot"></span> Монстрополия</div>
        <h2>Скоро начинаем</h2><p>Организаторы скоро укажут время начала мероприятия.</p></div></section>`;
    }
    return `<section class="countdown-card family-countdown" id="eventCountdown" aria-live="polite">
      ${magic}
      <div class="countdown-content"><div class="countdown-kicker"><span class="countdown-dot"></span> До начала мероприятия</div>
      <div class="countdown-grid">
        <div class="countdown-unit countdown-days"><strong data-countdown="days">00</strong><span>дней</span></div>
        <div class="countdown-unit"><strong data-countdown="hours">00</strong><span>часов</span></div>
        <div class="countdown-unit"><strong data-countdown="minutes">00</strong><span>минут</span></div>
        <div class="countdown-unit"><strong data-countdown="seconds">00</strong><span>секунд</span></div>
      </div>
      <div class="countdown-status" id="countdownStatus">Готовим <em>костюмы</em> и <em>конфеты</em></div></div>
    </section>`;
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
          element.classList.remove('countdown-tick');
          void element.offsetWidth;
          element.classList.add('countdown-tick');
          previous[key] = formatted;
        }
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
    document.getElementById('tabRegister').onclick = () => { activeTab = 'register'; renderEntry(); };
    document.getElementById('tabJoin').onclick = () => { activeTab = 'join'; renderEntry(); };
    if (activeTab === 'register') renderRegisterForm();
    else renderJoinForm();
    bindCountdown();
  }
  function renderJoinForm() {
    document.getElementById('tabContent').innerHTML = `<div class="form-card form-panel">
      <section class="form-section">${sectionTitle(ICONS.key, 'Присоединиться к семье')}
        <p class="form-help">Введите код, который получил уже зарегистрированный член семьи. Он открывает одну семейную запись и в Telegram, и в MAX.</p>
        <label class="form-field"><span>Код семьи <i>*</i></span><input type="text" id="joinCode" placeholder="Например ABC123" value="${esc(joinCodeFromUrl)}" autocomplete="off" /></label>
        <div id="joinMsg" class="search-hint form-status" aria-live="polite"></div>
      </section>
      <div class="form-actions"><button id="joinBtn">Присоединиться</button></div></div>`;
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
    container.innerHTML = childRows.map((child, index) => `<div class="child-row">
      <input type="text" placeholder="Имя ребёнка" aria-label="Имя ребёнка ${index + 1}" data-child-name="${index}" value="${esc(child.name)}" />
      <input type="number" placeholder="Возраст" aria-label="Возраст ребёнка ${index + 1}" data-child-age="${index}" value="${esc(child.age)}" min="1" max="17" />
      <button type="button" class="secondary small child-remove" data-remove="${index}" aria-label="Убрать ребёнка">${ICONS.close}</button></div>`).join('');
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
    document.getElementById('tabContent').innerHTML = `<div class="form-card form-panel">
      <section class="form-section">${sectionTitle(ICONS.home, 'Записать нашу семью')}
        <p class="form-help">Расскажите, откуда вы стартуете и кто отправится за конфетами.</p>
        <div class="form-row form-row-address">
          <label class="form-field address-tower"><span>Башня <i>*</i></span><select id="tower">${towerOptions()}</select></label>
          <label class="form-field"><span>Этаж <i>*</i></span><input type="number" id="floor" min="0" max="200" placeholder="22" /></label>
          <label class="form-field"><span>Квартира <i>*</i></span><input type="text" id="apartmentCode" placeholder="2206Г" /></label>
        </div>
        <div class="form-subblock"><strong>Хотим идти с семьёй (необязательно)</strong><p class="form-help">Выберите башню и начните вводить квартиру зарегистрированной семьи.</p>
        <div class="form-row form-row-stack"><label class="form-field"><span>Башня</span><select id="wishTower">${towerOptions()}</select></label>
        <label class="form-field"><span>Квартира</span><input type="text" id="wishApartment" placeholder="Номер квартиры" list="wishApartmentList" /></label></div>
        <datalist id="wishApartmentList"></datalist><div id="wishHint" class="search-hint form-status" aria-live="polite"></div></div>
      </section>
      <section class="form-section">${sectionTitle(ICONS.ghost, 'Дети', '<span class="family-pill" id="childCount">1 ребёнок</span>')}<div id="childrenList"></div><button type="button" id="addChild" class="secondary small add-child-button">${ICONS.plus}Добавить ребёнка</button></section>
      <section class="form-section participation-section">
        <div class="toggle-row"><span><b>Раздаём конфеты в квартире</b><small>Будем выдавать конфеты участникам</small></span><input type="checkbox" id="hosting" aria-label="Раздаём конфеты в квартире" /></div>
        <div class="toggle-row"><span><b>У нас будет квест</b><small>Добавить точку с заданием</small></span><input type="checkbox" id="quest" aria-label="У нас будет квест" /></div>
        <div id="questDurationWrap" hidden><label class="form-field"><span>Длительность квеста</span><input type="number" id="questDuration" value="20" min="5" max="40" /></label></div>
      </section>
      <div id="registerMsg" class="search-hint form-status" aria-live="polite"></div>
      <div class="form-actions"><button id="submitRegister">Записаться 🎃</button></div></div>`;
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
    bindWishSearch();
    document.getElementById('submitRegister').onclick = async () => {
      const floor = Number(document.getElementById('floor').value);
      const children = readChildren();
      const message = document.getElementById('registerMsg');
      if (!document.getElementById('floor').value || !Number.isInteger(floor) || floor < 0 || !document.getElementById('apartmentCode').value.trim() || !children.length) {
        message.textContent = 'Укажите этаж, номер квартиры и хотя бы одного ребёнка'; return;
      }
      try {
        const data = await api('/register', { method: 'POST', body: {
          tower: document.getElementById('tower').value, floor, apartmentCode: document.getElementById('apartmentCode').value.trim(), children,
          walking: true, hosting: document.getElementById('hosting').checked, quest: document.getElementById('quest').checked,
          questDurationMin: Number(document.getElementById('questDuration').value) || 20, wishFamilyId,
        } });
        renderRegisteredSuccess(data.family);
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
    APP.innerHTML = `<div class="card state-card success-card"><div class="state-icon">✓</div><span class="form-kicker">Анкета сохранена</span><h3>Семья участвует!</h3><p>Нажмите на код, чтобы скопировать его для второго члена семьи:</p>
      <button class="family-code code-button" id="familyCodeBtn">${esc(family.familyCode)}</button>
      <div class="form-actions"><button id="continueBtn">Дальше</button><button id="shareBtn" class="secondary">Поделиться кодом</button></div></div>`;
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
      <div class="family-success-card"><span class="family-success-kicker">Регистрация завершена</span>
        <h2>Ваша семья в игре</h2><p>Данные сохранены. По семейному коду близкие смогут присоединиться с другого устройства.</p></div>
      <div class="family-code-card"><span>Код семьи</span><div class="family-code-row">
        <strong class="family-code-value">${esc(family.familyCode)}</strong>
        <button class="family-copy-button" id="familyCodeBtn" aria-label="Скопировать код семьи">⧉</button></div></div>
      <div class="family-summary-grid" aria-label="Данные семьи">
        <div class="family-summary-item"><span>Адрес</span><b>${esc(family.tower)}<br>этаж ${family.floor}, кв. ${esc(family.apartmentCode)}</b></div>
        <div class="family-summary-item"><span>Дети</span><b>${children}</b></div>
        <div class="family-summary-item"><span>Открытая дверь</span><b>${family.hosting ? 'Да, выдаём конфеты' : 'Нет'}</b></div>
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
