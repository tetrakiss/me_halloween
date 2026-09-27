(function () {
  const APP = document.getElementById('app');
  let password = sessionStorage.getItem('adminPassword') || '';

  // ---------- Определение платформы (как в app.js мини-аппа) ----------
  function detectPlatform() {
    if (window.Telegram && window.Telegram.WebApp) return 'telegram';
    if (window.WebApp && window.WebApp.InitData) return 'max';
    return 'none';
  }
  const PLATFORM = detectPlatform();
  if (PLATFORM === 'telegram') {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }
  function getInitDataRaw() {
    if (PLATFORM === 'telegram') return window.Telegram.WebApp.initData;
    if (PLATFORM === 'max') return window.WebApp.InitData;
    return '';
  }

  // ---------- API-хелпер ----------
  // Если открыто в Telegram — шлём X-Platform/X-Init-Data (авто-доступ для
  // супер-админа @a_togulev, см. routes/admin.js). Иначе — пароль из формы.
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (PLATFORM === 'telegram') {
      headers['X-Platform'] = 'telegram';
      headers['X-Init-Data'] = getInitDataRaw();
    } else {
      headers['X-Admin-Password'] = password;
    }
    const res = await fetch(`/admin-api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }

  function renderLogin(errorText) {
    APP.innerHTML = `
      <div class="card">
        <h3>Вход</h3>
        ${errorText ? `<div class="search-hint" style="color:var(--danger)">${errorText}</div>` : ''}
        <label>Пароль администратора</label>
        <input type="text" id="pw" />
        <button id="loginBtn">Войти</button>
        <div id="loginMsg" class="search-hint"></div>
      </div>
    `;
    document.getElementById('loginBtn').onclick = async () => {
      password = document.getElementById('pw').value;
      try {
        await api('/families'); // просто проверяем, что пароль подходит
        sessionStorage.setItem('adminPassword', password);
        renderDashboard();
      } catch (e) {
        document.getElementById('loginMsg').textContent = 'Неверный пароль';
      }
    };
  }

  async function renderDashboard() {
    APP.innerHTML = `<div class="card"><p>Загрузка…</p></div>`;
    try {
      const [{ families }, { groups }, { specialPoints }] = await Promise.all([
        api('/families'),
        api('/groups'),
        api('/special-points'),
      ]);

      const groupOptions = ['<option value="">— без группы —</option>']
        .concat(groups.map((g) => `<option value="${g.id}">${g.id} (${g.childCount} детей)</option>`))
        .join('');

      const rows = families
        .map(
          (f) => `
        <tr>
          <td>${f.tower}, эт.${f.floor}, кв.${f.apartmentCode}</td>
          <td>${f.children.map((c) => `${c.name}(${c.age})`).join(', ')}</td>
          <td>${f.cancelled ? '❌ отменено' : f.walking ? '🚶 идёт' : '—'}</td>
          <td>${f.hosting ? '🍬' : ''}${f.quest ? ' 🎭' : ''}</td>
          <td>${f.currentGroupId || '—'}</td>
          <td>
            <select data-override="${f.id}">${groupOptions}</select>
            <button class="small" data-save="${f.id}">Задать</button>
          </td>
        </tr>`
        )
        .join('');

      const specialRows = specialPoints
        .map(
          (sp) => `
        <tr>
          <td>${sp.tower}, эт.${sp.floor}</td>
          <td>${sp.name}</td>
          <td>${sp.active ? '✅ активна' : '⏸️ выключена'}</td>
          <td>
            <button class="small" data-toggle-sp="${sp.id}" data-active="${sp.active}">${sp.active ? 'Выключить' : 'Включить'}</button>
            <button class="small danger" data-delete-sp="${sp.id}">Удалить</button>
          </td>
        </tr>`
        )
        .join('');

      APP.innerHTML = `
        <div class="card">
          <button id="recomputeBtn">🔄 Пересчитать группы и маршруты</button>
          <div id="recomputeMsg" class="search-hint"></div>
        </div>
        <div class="card">
          <h3>🏪 Спецточки маршрута (рестораны/магазины)</h3>
          <label>Башня</label>
          <select id="spTower">${window.TOWERS.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          <label>Этаж/уровень (например 0 для входа с улицы)</label>
          <input type="number" id="spFloor" value="0" />
          <label>Название</label>
          <input type="text" id="spName" placeholder="Пиццерия «Дядя Джо»" />
          <button id="spAddBtn" class="secondary">+ Добавить точку</button>
          <div id="spMsg" class="search-hint"></div>
          <table style="margin-top:12px">
            <tr><th>Расположение</th><th>Название</th><th>Статус</th><th></th></tr>
            ${specialRows || '<tr><td colspan="4">Пока нет ни одной спецточки</td></tr>'}
          </table>
        </div>
        <div class="card" style="overflow-x:auto">
          <h3>Семьи (${families.length})</h3>
          <table>
            <tr><th>Адрес</th><th>Дети</th><th>Статус</th><th>Хостинг/квест</th><th>Группа</th><th>Ручной override</th></tr>
            ${rows}
          </table>
        </div>
      `;

      document.getElementById('spAddBtn').onclick = async () => {
        const msg = document.getElementById('spMsg');
        const name = document.getElementById('spName').value.trim();
        if (!name) { msg.textContent = 'Введите название'; return; }
        try {
          await api('/special-points', {
            method: 'POST',
            body: {
              tower: document.getElementById('spTower').value,
              floor: Number(document.getElementById('spFloor').value) || 0,
              name,
            },
          });
          renderDashboard();
        } catch (e) {
          msg.textContent = e.message;
        }
      };

      document.querySelectorAll('[data-toggle-sp]').forEach((btn) => {
        btn.onclick = async () => {
          const active = btn.dataset.active === 'true';
          await api(`/special-points/${btn.dataset.toggleSp}`, { method: 'PATCH', body: { active: !active } });
          renderDashboard();
        };
      });
      document.querySelectorAll('[data-delete-sp]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Удалить эту спецточку?')) return;
          await api(`/special-points/${btn.dataset.deleteSp}`, { method: 'DELETE' });
          renderDashboard();
        };
      });

      document.getElementById('recomputeBtn').onclick = async () => {
        const msg = document.getElementById('recomputeMsg');
        msg.textContent = 'Считаем…';
        try {
          const res = await api('/recompute', { method: 'POST' });
          msg.textContent = `Готово: ${res.groupCount} групп`;
          renderDashboard();
        } catch (e) {
          msg.textContent = e.message;
        }
      };

      document.querySelectorAll('[data-save]').forEach((btn) => {
        btn.onclick = async () => {
          const familyId = btn.dataset.save;
          const select = document.querySelector(`[data-override="${familyId}"]`);
          try {
            await api('/override', { method: 'POST', body: { familyId, groupId: select.value || null } });
            btn.textContent = '✓';
          } catch (e) {
            alert(e.message);
          }
        };
      });
    } catch (e) {
      // В Telegram, но не @a_togulev — сообщаем и всё равно даём войти по паролю
      renderLogin(PLATFORM === 'telegram' ? 'Этот Telegram-аккаунт не является супер-администратором' : '');
    }
  }

  if (PLATFORM === 'telegram') {
    renderDashboard(); // пробуем авто-доступ, при неудаче renderDashboard сам покажет форму пароля
  } else if (password) {
    renderDashboard();
  } else {
    renderLogin();
  }
})();
