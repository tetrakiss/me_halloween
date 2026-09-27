(function () {
  const APP = document.getElementById('app');

  // ---------- Определение платформы ----------
  function detectPlatform() {
    if (window.Telegram && window.Telegram.WebApp) return 'telegram';
    if (window.WebApp && window.WebApp.InitData) return 'max';
    return 'dev';
  }

  function getInitDataRaw(platform) {
    if (platform === 'telegram') return window.Telegram.WebApp.initData;
    if (platform === 'max') return window.WebApp.InitData;
    return '';
  }

  const PLATFORM = detectPlatform();

  if (PLATFORM === 'telegram') {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }

  // dev-режим: ?dev_user=123 в URL, чтобы тестировать локально без бота
  function devUserId() {
    return new URLSearchParams(location.search).get('dev_user') || 'dev-1';
  }

  // ---------- API-хелпер ----------
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Platform': PLATFORM };
    if (PLATFORM === 'dev') {
      headers['X-Dev-User-Id'] = devUserId();
    } else {
      headers['X-Init-Data'] = getInitDataRaw(PLATFORM);
    }
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }

  // ---------- Состояние ----------
  let state = { family: null, group: null, route: null };
  let childRows = [{ name: '', age: '' }];
  let wishFamilyId = null;

  const joinCodeFromUrl = new URLSearchParams(location.search).get('join');

  // ---------- Рендер: загрузка ----------
  function renderLoading() {
    APP.innerHTML = '<div class="suggested">Загрузка… 👻</div>';
  }

  // ---------- Рендер: выбор регистрация/присоединение ----------
  let activeTab = joinCodeFromUrl ? 'join' : 'register';

  function renderEntry() {
    APP.innerHTML = `
      <div class="tabs">
        <button id="tabRegister" class="${activeTab === 'register' ? 'active' : ''}">Записать семью</button>
        <button id="tabJoin" class="${activeTab === 'join' ? 'active' : ''}">У нас есть код</button>
      </div>
      <div id="tabContent"></div>
    `;
    document.getElementById('tabRegister').onclick = () => { activeTab = 'register'; renderEntry(); };
    document.getElementById('tabJoin').onclick = () => { activeTab = 'join'; renderEntry(); };

    if (activeTab === 'register') renderRegisterForm();
    else renderJoinForm();
  }

  function renderJoinForm() {
    const el = document.getElementById('tabContent');
    el.innerHTML = `
      <div class="card">
        <h3>🔑 Присоединиться к семье</h3>
        <p style="font-size:13px;color:var(--text-dim)">
          Если второй родитель уже зарегистрировал вашу семью — введите код, который он получил.
        </p>
        <label>Код семьи</label>
        <input type="text" id="joinCode" placeholder="Например ABC123" value="${joinCodeFromUrl || ''}" />
        <button id="joinBtn">Присоединиться</button>
        <div id="joinMsg" class="search-hint"></div>
      </div>
    `;
    document.getElementById('joinBtn').onclick = async () => {
      const code = document.getElementById('joinCode').value.trim();
      const msg = document.getElementById('joinMsg');
      if (!code) { msg.textContent = 'Введите код'; return; }
      try {
        const data = await api('/join', { method: 'POST', body: { familyCode: code } });
        state.family = data.family;
        await loadMe();
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'search-hint';
      }
    };
  }

  function renderRegisterForm() {
    const el = document.getElementById('tabContent');
    el.innerHTML = `
      <div class="card">
        <h3>🎃 Записать нашу семью</h3>

        <label>Башня</label>
        <select id="tower">${window.TOWERS.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>

        <label>Номер квартиры (например 2206Г)</label>
        <input type="text" id="apartmentCode" placeholder="2206Г" />

        <label>Хотим идти с семьёй (необязательно)</label>
        <p style="font-size:12px;color:var(--text-dim);margin:2px 0 8px">
          Сначала выберите башню, затем начните вводить номер квартиры — подскажем совпадения из уже записавшихся.
        </p>
        <select id="wishTower">${window.TOWERS.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
        <input type="text" id="wishApartment" placeholder="Номер квартиры" list="wishApartmentList" />
        <datalist id="wishApartmentList"></datalist>
        <div id="wishHint" class="search-hint"></div>

        <h3 style="margin-top:18px">👻 Дети</h3>
        <div id="childrenList"></div>
        <button type="button" id="addChild" class="secondary small">+ Добавить ребёнка</button>

        <div class="toggle-row">
          <span>Открываем дверь у себя 🍬</span>
          <input type="checkbox" id="hosting" />
        </div>
        <div class="toggle-row">
          <span>У нас будет квест 🎭</span>
          <input type="checkbox" id="quest" />
        </div>
        <div id="questDurationWrap" style="display:none">
          <label>Сколько минут займёт квест?</label>
          <input type="number" id="questDuration" value="20" min="5" max="40" />
        </div>

        <button id="submitRegister">Записаться 🎃</button>
        <div id="registerMsg" class="search-hint"></div>
      </div>
    `;

    renderChildRows();
    document.getElementById('addChild').onclick = () => {
      childRows.push({ name: '', age: '' });
      renderChildRows();
    };

    document.getElementById('quest').onchange = (e) => {
      document.getElementById('questDurationWrap').style.display = e.target.checked ? 'block' : 'none';
    };

    let wishTimer;
    document.getElementById('wishApartment').oninput = (e) => {
      clearTimeout(wishTimer);
      const val = e.target.value.trim();
      const hint = document.getElementById('wishHint');
      wishFamilyId = null;
      if (!val) { hint.textContent = ''; return; }
      const wishTower = document.getElementById('wishTower').value;

      wishTimer = setTimeout(async () => {
        const authHeaders = PLATFORM === 'dev'
          ? { 'X-Platform': 'dev', 'X-Dev-User-Id': devUserId() }
          : { 'X-Platform': PLATFORM, 'X-Init-Data': getInitDataRaw(PLATFORM) };

        // Автоподсказки уже существующих номеров квартир в этой башне
        try {
          const sugRes = await fetch(
            `/api/apartments-suggest?tower=${encodeURIComponent(wishTower)}&query=${encodeURIComponent(val)}`,
            { headers: authHeaders }
          );
          const sugData = await sugRes.json();
          const list = document.getElementById('wishApartmentList');
          list.innerHTML = (sugData.apartmentCodes || [])
            .map((code) => `<option value="${code}"></option>`)
            .join('');
        } catch {
          // подсказки необязательны — если не получилось, просто не показываем
        }

        // Точное совпадение — для реальной привязки к пожеланию
        try {
          const res = await fetch(
            `/api/search?tower=${encodeURIComponent(wishTower)}&apartmentCode=${encodeURIComponent(val)}`,
            { headers: authHeaders }
          );
          const data = await res.json();
          if (data.found) {
            wishFamilyId = data.familyId;
            hint.textContent = `Нашли: ${data.childrenNames.join(', ')} — свяжем вас в одну группу`;
            hint.className = 'search-hint found';
          } else {
            hint.textContent = 'Такая семья пока не зарегистрирована';
            hint.className = 'search-hint';
          }
        } catch {
          hint.textContent = '';
        }
      }, 350);
    };

    document.getElementById('submitRegister').onclick = async () => {
      const msg = document.getElementById('registerMsg');
      const tower = document.getElementById('tower').value;
      const apartmentCode = document.getElementById('apartmentCode').value.trim();
      const floorMatch = /^(\d+?)(\d{2})/.exec(apartmentCode);
      const floor = floorMatch ? Number(floorMatch[1]) : null;

      const children = childRows
        .map((_, i) => ({
          name: document.querySelector(`[data-child-name="${i}"]`).value.trim(),
          age: Number(document.querySelector(`[data-child-age="${i}"]`).value),
        }))
        .filter((c) => c.name && c.age);

      if (!apartmentCode || !floor || children.length === 0) {
        msg.textContent = 'Заполните номер квартиры и хотя бы одного ребёнка';
        return;
      }

      try {
        const data = await api('/register', {
          method: 'POST',
          body: {
            tower,
            floor,
            apartmentCode,
            children,
            walking: true,
            hosting: document.getElementById('hosting').checked,
            quest: document.getElementById('quest').checked,
            questDurationMin: Number(document.getElementById('questDuration').value) || 20,
            wishFamilyId,
          },
        });
        state.family = data.family;
        renderRegisteredSuccess(data.family);
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }

  function renderChildRows() {
    const wrap = document.getElementById('childrenList');
    wrap.innerHTML = childRows
      .map(
        (c, i) => `
      <div class="child-row">
        <input type="text" placeholder="Имя" data-child-name="${i}" value="${c.name}" />
        <input type="number" placeholder="Возраст" data-child-age="${i}" value="${c.age}" min="1" max="17" />
        ${childRows.length > 1 ? `<button type="button" class="secondary small" data-remove="${i}">✕</button>` : ''}
      </div>`
      )
      .join('');
    wrap.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        childRows.splice(Number(btn.dataset.remove), 1);
        renderChildRows();
      };
    });
  }

  function renderRegisteredSuccess(family) {
    APP.innerHTML = `
      <div class="card">
        <h3>✅ Готово!</h3>
        <p>Ваш код семьи (покажите второму родителю, чтобы он тоже мог видеть маршрут):</p>
        <div class="family-code">${family.familyCode}</div>
        <button id="shareBtn" class="secondary">Поделиться кодом</button>
        <button id="continueBtn">Дальше</button>
      </div>
    `;
    document.getElementById('shareBtn').onclick = () => {
      const text = `Присоединяйся к нашей записи в «Монстрополию»! Код семьи: ${family.familyCode}`;
      if (navigator.share) navigator.share({ text });
      else navigator.clipboard.writeText(text);
    };
    document.getElementById('continueBtn').onclick = () => loadMe();
  }

  // ---------- Рендер: дашборд (анкета + маршрут) ----------
  function renderDashboard() {
    const f = state.family;
    APP.innerHTML = `
      <div class="card">
        <h3>${f.tower}, эт. ${f.floor}, кв. ${f.apartmentCode}</h3>
        <p style="font-size:13px;color:var(--text-dim)">
          Дети: ${f.children.map((c) => `${c.name} (${c.age})`).join(', ')}
        </p>
        <div class="family-code" style="font-size:16px">Код семьи: ${f.familyCode}</div>
      </div>
      ${state.group ? renderRouteCard() : renderWaitingCard()}
    `;

    if (state.route) {
      state.route.forEach((stop) => {
        const btn = document.getElementById(`doorBtn-${stop.seq}`);
        if (btn) {
          btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = 'Отправлено ✓';
            try {
              await api('/door-status', {
                method: 'POST',
                body: { hostId: stop.hostId, status: 'no_answer' },
              });
            } catch {
              btn.disabled = false;
              btn.textContent = 'Не открыли 🚪';
            }
          };
        }
      });
    }
  }

  function renderWaitingCard() {
    return `
      <div class="card">
        <h3>⏳ Группа ещё не сформирована</h3>
        <p style="font-size:14px;color:var(--text-dim)">
          Как только организаторы соберут группы — здесь появится ваш маршрут. Загляните позже 🎃
        </p>
      </div>
    `;
  }

  function renderRouteCard() {
    if (!state.route || state.route.length === 0) {
      return `<div class="card"><h3>🗺️ Маршрут</h3><p>Пока пусто — заглянуть попозже.</p></div>`;
    }
    const items = state.route
      .map((stop) => {
        const warned = stop.lastKnownStatus === 'no_answer';
        const label = stop.isSpecial
          ? `🏪 ${stop.displayName}`
          : `${stop.tower}, эт. ${stop.floor}, кв. ${stop.apartmentCode}`;
        return `
        <li class="stop ${stop.isQuest ? 'quest' : ''} ${warned ? 'warned' : ''}">
          <div class="stop-num">${stop.seq}</div>
          <div class="stop-info">
            <div class="addr">${label}</div>
            ${stop.isQuest ? '<div class="tag">🎭 КВЕСТ</div>' : ''}
            ${warned ? '<div class="stop-warning">⚠️ ранее не открыли</div>' : ''}
          </div>
          <button id="doorBtn-${stop.seq}" class="secondary small" style="width:auto;margin:0">Не открыли 🚪</button>
        </li>`;
      })
      .join('');
    return `
      <div class="card">
        <h3>🗺️ Ваш маршрут</h3>
        <ul class="route-list">${items}</ul>
      </div>
    `;
  }

  // ---------- Загрузка данных ----------
  async function loadMe() {
    renderLoading();
    try {
      const data = await api('/me');
      if (!data.family) {
        renderEntry();
        return;
      }
      state.family = data.family;
      state.group = data.group;
      state.route = data.route;
      renderDashboard();
    } catch (e) {
      APP.innerHTML = `<div class="card"><p>Ошибка: ${e.message}</p></div>`;
    }
  }

  loadMe();
})();
