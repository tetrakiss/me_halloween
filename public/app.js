(function () {
  const APP = document.getElementById('app');

  function detectPlatform() {
    if (window.WebApp?.initData) return 'max';
    if (window.Telegram?.WebApp?.initData) return 'telegram';
    return 'dev';
  }
  const PLATFORM = detectPlatform();
  if (PLATFORM === 'telegram') {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }
  function getInitDataRaw() {
    if (PLATFORM === 'telegram') return window.Telegram.WebApp.initData;
    if (PLATFORM === 'max') return window.WebApp.initData;
    return '';
  }
  function getStartParam() {
    if (PLATFORM === 'telegram') return window.Telegram.WebApp.initDataUnsafe?.start_param || '';
    if (PLATFORM === 'max') return window.WebApp.initDataUnsafe?.start_param || '';
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
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
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

  let state = { family: null, group: null, route: null, isAdmin: false };
  let childRows = [{ name: '', age: '' }];
  let wishFamilyId = null;
  const urlJoin = new URLSearchParams(location.search).get('join');
  const startParam = getStartParam();
  const startJoin = startParam.startsWith('join_') ? startParam.slice(5) : '';
  const joinCodeFromUrl = urlJoin || startJoin;
  let activeTab = joinCodeFromUrl ? 'join' : 'register';

  function adminButton() {
    return state.isAdmin ? '<button id="adminBtn" class="secondary">🛠️ Администрирование</button>' : '';
  }
  function bindAdminButton() {
    const button = document.getElementById('adminBtn');
    if (button) button.onclick = () => { location.href = '/admin.html'; };
  }
  function renderLoading() {
    APP.innerHTML = `<div class="loading-splash" role="status" aria-label="Приложение загружается">
      <iframe class="loading-bat" src="bat-pixel-animation.html" title="Летучая мышь" tabindex="-1"></iframe>
      <div class="loading-label">Монстрополия загружается…</div>
    </div>`;
  }
  function renderEntry() {
    APP.innerHTML = `${adminButton()}<div class="tabs">
      <button id="tabRegister" class="${activeTab === 'register' ? 'active' : ''}">Записать семью</button>
      <button id="tabJoin" class="${activeTab === 'join' ? 'active' : ''}">У нас есть код</button>
      </div><div id="tabContent"></div>`;
    bindAdminButton();
    document.getElementById('tabRegister').onclick = () => { activeTab = 'register'; renderEntry(); };
    document.getElementById('tabJoin').onclick = () => { activeTab = 'join'; renderEntry(); };
    if (activeTab === 'register') renderRegisterForm();
    else renderJoinForm();
  }
  function renderJoinForm() {
    document.getElementById('tabContent').innerHTML = `<div class="card"><h3>🔑 Присоединиться к семье</h3>
      <p class="muted">Введите код, который получил уже зарегистрированный член семьи.</p>
      <label>Код семьи</label><input type="text" id="joinCode" placeholder="Например ABC123" value="${esc(joinCodeFromUrl)}" />
      <button id="joinBtn">Присоединиться</button><div id="joinMsg" class="search-hint"></div></div>`;
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
      <input type="text" placeholder="Имя" data-child-name="${index}" value="${esc(child.name)}" />
      <input type="number" placeholder="Возраст" data-child-age="${index}" value="${esc(child.age)}" min="1" max="17" />
      ${childRows.length > 1 ? `<button type="button" class="secondary small" data-remove="${index}">✕</button>` : ''}</div>`).join('');
    container.querySelectorAll('[data-remove]').forEach((button) => {
      button.onclick = () => { syncChildRows(); childRows.splice(Number(button.dataset.remove), 1); renderChildRows(); };
    });
  }
  function readChildren() {
    syncChildRows();
    return childRows.map((child) => ({ name: child.name.trim(), age: Number(child.age) })).filter((child) => child.name && child.age);
  }
  function towerOptions(selected) {
    return window.TOWERS.map((tower) => `<option value="${esc(tower)}" ${tower === selected ? 'selected' : ''}>${esc(tower)}</option>`).join('');
  }
  function renderRegisterForm() {
    document.getElementById('tabContent').innerHTML = `<div class="card"><h3>🎃 Записать нашу семью</h3>
      <label>Башня</label><select id="tower">${towerOptions()}</select>
      <label>Этаж (укажите явно)</label><input type="number" id="floor" min="0" max="200" placeholder="Например 22" />
      <label>Номер квартиры</label><input type="text" id="apartmentCode" placeholder="Например 2206Г" />
      <label>Хотим идти с семьёй (необязательно)</label><p class="muted">Выберите башню и начните вводить номер квартиры зарегистрированной семьи.</p>
      <select id="wishTower">${towerOptions()}</select><input type="text" id="wishApartment" placeholder="Номер квартиры" list="wishApartmentList" />
      <datalist id="wishApartmentList"></datalist><div id="wishHint" class="search-hint"></div>
      <h3 class="section-title">👻 Дети</h3><div id="childrenList"></div><button type="button" id="addChild" class="secondary small">+ Добавить ребёнка</button>
      <div class="toggle-row"><span>Открываем дверь у себя 🍬</span><input type="checkbox" id="hosting" /></div>
      <div class="toggle-row"><span>У нас будет квест 🎭</span><input type="checkbox" id="quest" /></div>
      <div id="questDurationWrap" hidden><label>Сколько минут займёт квест?</label><input type="number" id="questDuration" value="20" min="5" max="40" /></div>
      <button id="submitRegister">Записаться 🎃</button><div id="registerMsg" class="search-hint"></div></div>`;
    renderChildRows();
    document.getElementById('addChild').onclick = () => { syncChildRows(); childRows.push({ name: '', age: '' }); renderChildRows(); };
    document.getElementById('quest').onchange = (event) => { document.getElementById('questDurationWrap').hidden = !event.target.checked; };
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
      } catch (error) { message.textContent = error.message; }
    };
  }
  function bindWishSearch() {
    let timer;
    document.getElementById('wishApartment').oninput = (event) => {
      clearTimeout(timer); const value = event.target.value.trim(); wishFamilyId = null;
      if (!value) return void (document.getElementById('wishHint').textContent = '');
      timer = setTimeout(async () => {
        const tower = document.getElementById('wishTower').value;
        try {
          const suggestions = await api(`/apartments-suggest?tower=${encodeURIComponent(tower)}&query=${encodeURIComponent(value)}`);
          document.getElementById('wishApartmentList').innerHTML = suggestions.apartmentCodes.map((code) => `<option value="${esc(code)}"></option>`).join('');
          const found = await api(`/search?tower=${encodeURIComponent(tower)}&apartmentCode=${encodeURIComponent(value)}`);
          const hint = document.getElementById('wishHint');
          if (found.found) { wishFamilyId = found.familyId; hint.textContent = `Нашли: ${found.childrenNames.join(', ')} — свяжем вас в одну группу`; hint.className = 'search-hint found'; }
          else { hint.textContent = 'Такая семья пока не зарегистрирована'; hint.className = 'search-hint'; }
        } catch { document.getElementById('wishHint').textContent = ''; }
      }, 350);
    };
  }
  function renderRegisteredSuccess(family) {
    APP.innerHTML = `<div class="card"><h3>✅ Готово!</h3><p>Нажмите на код, чтобы скопировать его для второго члена семьи:</p>
      <button class="family-code code-button" id="familyCodeBtn">${esc(family.familyCode)}</button>
      <button id="shareBtn" class="secondary">Поделиться кодом</button><button id="continueBtn">Дальше</button></div>`;
    document.getElementById('familyCodeBtn').onclick = () => copyFamilyCode(family.familyCode);
    document.getElementById('shareBtn').onclick = async () => {
      const text = `Присоединяйся к нашей записи в «Монстрополию»! Код семьи: ${family.familyCode}`;
      if (navigator.share) await navigator.share({ text }).catch(() => {}); else await copyFamilyCode(family.familyCode);
    };
    document.getElementById('continueBtn').onclick = loadMe;
  }
  function renderDashboard() {
    const family = state.family;
    APP.innerHTML = `${adminButton()}<div class="card"><h3>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</h3>
      <p class="muted">Дети: ${family.children.map((child) => `${esc(child.name)} (${child.age})`).join(', ')}</p>
      <button class="family-code code-button" id="familyCodeBtn">Код семьи: ${esc(family.familyCode)} 📋</button>
      <button id="editFamilyBtn" class="secondary">✏️ Редактировать запись семьи</button></div>
      ${state.group ? renderRouteCard() : renderWaitingCard()}`;
    bindAdminButton();
    document.getElementById('familyCodeBtn').onclick = () => copyFamilyCode(family.familyCode);
    document.getElementById('editFamilyBtn').onclick = renderEditForm;
    document.querySelectorAll('[data-door]').forEach((button) => {
      button.onclick = async () => { button.disabled = true;
        try { await api('/door-status', { method: 'POST', body: { hostId: button.dataset.door, status: 'no_answer' } }); button.textContent = 'Отправлено ✓'; }
        catch (error) { button.disabled = false; toast(error.message); }
      };
    });
  }
  function renderEditForm() {
    const family = state.family;
    childRows = family.children.map((child) => ({ name: child.name, age: child.age }));
    APP.innerHTML = `<div class="card"><h3>✏️ Редактировать запись семьи</h3>
      <label>Башня</label><select id="editTower">${towerOptions(family.tower)}</select>
      <label>Этаж (укажите явно)</label><input type="number" id="editFloor" value="${family.floor}" min="0" max="200" />
      <label>Номер квартиры</label><input type="text" id="editApartment" value="${esc(family.apartmentCode)}" />
      <h3 class="section-title">👻 Дети</h3><div id="childrenList"></div><button type="button" id="addChild" class="secondary small">+ Добавить ребёнка</button>
      <div class="toggle-row"><span>Участвуем в обходе 🚶</span><input type="checkbox" id="editWalking" ${family.walking ? 'checked' : ''} /></div>
      <div class="toggle-row"><span>Открываем дверь 🍬</span><input type="checkbox" id="editHosting" ${family.hosting ? 'checked' : ''} /></div>
      <div class="toggle-row"><span>У нас будет квест 🎭</span><input type="checkbox" id="editQuest" ${family.quest ? 'checked' : ''} /></div>
      <div id="editQuestWrap" ${family.quest ? '' : 'hidden'}><label>Длительность квеста</label><input type="number" id="editQuestDuration" value="${family.questDurationMin || 20}" min="5" max="40" /></div>
      <button id="saveFamilyBtn">Сохранить</button><button id="cancelEditBtn" class="secondary">Отмена</button><div id="editMsg" class="search-hint"></div></div>`;
    renderChildRows();
    document.getElementById('addChild').onclick = () => { syncChildRows(); childRows.push({ name: '', age: '' }); renderChildRows(); };
    document.getElementById('editQuest').onchange = (event) => { document.getElementById('editQuestWrap').hidden = !event.target.checked; };
    document.getElementById('cancelEditBtn').onclick = renderDashboard;
    document.getElementById('saveFamilyBtn').onclick = async () => {
      const floor = Number(document.getElementById('editFloor').value); const children = readChildren();
      if (!document.getElementById('editFloor').value || !Number.isInteger(floor) || floor < 0 || !children.length) return void (document.getElementById('editMsg').textContent = 'Проверьте этаж и данные детей');
      try {
        await api('/me', { method: 'PATCH', body: {
          tower: document.getElementById('editTower').value, floor, apartmentCode: document.getElementById('editApartment').value.trim(), children,
          walking: document.getElementById('editWalking').checked, hosting: document.getElementById('editHosting').checked,
          quest: document.getElementById('editQuest').checked, questDurationMin: Number(document.getElementById('editQuestDuration').value) || 20,
        } });
        toast('Запись семьи обновлена'); await loadMe();
      } catch (error) { document.getElementById('editMsg').textContent = error.message; }
    };
  }
  function renderWaitingCard() {
    return '<div class="card"><h3>⏳ Группа ещё не сформирована</h3><p class="muted">Когда организаторы соберут группы, здесь появится маршрут.</p></div>';
  }
  function renderRouteCard() {
    const items = (state.route || []).map((stop) => {
      const kind = stop.isQuest ? '🎭 Квест' : '🍬 Конфеты';
      const address = stop.isSpecial ? `${esc(stop.displayName)} — ${esc(stop.tower)}, этаж ${stop.floor}` : `${esc(stop.tower)}, этаж ${stop.floor}, квартира ${esc(stop.apartmentCode)}`;
      return `<li class="stop ${stop.isQuest ? 'quest' : ''} ${stop.lastKnownStatus === 'no_answer' ? 'warned' : ''}">
        <div class="stop-num">${stop.seq}</div><div class="stop-info"><div class="addr">${address}</div><div class="tag">${kind}</div>
        ${stop.lastKnownStatus === 'no_answer' ? '<div class="stop-warning">⚠️ ранее не открыли</div>' : ''}</div>
        <button class="secondary small door-button" data-door="${esc(stop.hostId)}">Не открыли 🚪</button></li>`;
    }).join('');
    return `<div class="card"><h3>🗺️ ${esc(state.group.name || 'Ваш маршрут')}</h3>${items ? `<ul class="route-list">${items}</ul>` : '<p>Маршрут пока пуст.</p>'}</div>`;
  }
  async function loadMe() {
    renderLoading();
    try {
      const data = await api('/me');
      state = { family: data.family, group: data.group || null, route: data.route || null, isAdmin: !!data.isAdmin };
      if (!state.family) renderEntry(); else renderDashboard();
    } catch (error) { APP.innerHTML = `<div class="card"><p>Ошибка: ${esc(error.message)}</p></div>`; }
  }
  loadMe();
})();
