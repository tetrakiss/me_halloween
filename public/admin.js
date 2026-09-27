(function () {
  const APP = document.getElementById('app');
  const MINI_APP_CONTEXT = window.MINI_APP_CONTEXT || { platform: 'web', initData: '' };
  let password = sessionStorage.getItem('adminPassword') || '';

  function detectPlatform() {
    if (MINI_APP_CONTEXT.platform === 'max') return 'max';
    if (MINI_APP_CONTEXT.platform === 'telegram') return 'telegram';
    return 'none';
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
  function esc(value) {
    return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;',
    })[char]);
  }
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (PLATFORM === 'telegram') {
      headers['X-Platform'] = 'telegram';
      headers['X-Init-Data'] = getInitDataRaw();
    } else headers['X-Admin-Password'] = password;
    const response = await fetch(`/admin-api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }
  function towerOptions(selected) {
    return window.TOWERS.map((tower) => `<option value="${esc(tower)}" ${tower === selected ? 'selected' : ''}>${esc(tower)}</option>`).join('');
  }
  function renderLogin(errorText = '') {
    APP.innerHTML = `<div class="card"><h3>Вход</h3>${errorText ? `<div class="error-text">${esc(errorText)}</div>` : ''}
      <label>Пароль администратора</label><input type="password" id="pw" />
      <button id="loginBtn">Войти</button><div id="loginMsg" class="search-hint"></div></div>`;
    document.getElementById('loginBtn').onclick = async () => {
      password = document.getElementById('pw').value;
      try { await api('/families'); sessionStorage.setItem('adminPassword', password); renderDashboard(); }
      catch { document.getElementById('loginMsg').textContent = 'Неверный пароль'; }
    };
  }
  function participantText(parent) {
    const name = [parent.firstName, parent.lastName].filter(Boolean).join(' ') || 'Имя не передано';
    const username = parent.username ? `@${parent.username}` : 'без username';
    return `${esc(name)} · ${esc(username)} · ${esc(parent.platform)} ID ${esc(parent.platformUserId)}`;
  }
  function groupOptions(groups, selected) {
    return ['<option value="">— без ручной группы —</option>']
      .concat(groups.map((group) => `<option value="${esc(group.id)}" ${group.id === selected ? 'selected' : ''}>${esc(group.name || group.id)}</option>`)).join('');
  }
  function familyCard(family, groups) {
    const childrenText = family.children.map((child) => `${child.name}|${child.age}`).join('\n');
    return `<details class="admin-family" data-family-card="${esc(family.id)}">
      <summary><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
        <span>${family.cancelled ? '❌' : family.walking ? '🚶' : '⏸️'} ${family.hosting ? family.quest ? '🎭' : '🍬' : ''}</span></summary>
      <div class="admin-grid">
        <div><b>Код семьи:</b> ${esc(family.familyCode)}</div><div><b>ID:</b> ${esc(family.id)}</div>
        <div class="admin-wide"><b>Участники:</b><ul>${family.parents.map((parent) => `<li>${participantText(parent)}</li>`).join('') || '<li>Нет привязанных аккаунтов</li>'}</ul></div>
      </div>
      <label>Башня</label><select data-field="tower">${towerOptions(family.tower)}</select>
      <div class="admin-grid"><div><label>Этаж</label><input type="number" data-field="floor" value="${family.floor}" min="0" /></div>
      <div><label>Квартира</label><input type="text" data-field="apartmentCode" value="${esc(family.apartmentCode)}" /></div></div>
      <label>Дети — по одному в строке: Имя|возраст</label><textarea data-field="children">${esc(childrenText)}</textarea>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-field="walking" ${family.walking ? 'checked' : ''}/> Идёт</label>
        <label><input type="checkbox" data-field="hosting" ${family.hosting ? 'checked' : ''}/> Открывает дверь</label>
        <label><input type="checkbox" data-field="quest" ${family.quest ? 'checked' : ''}/> Квест</label>
        <label><input type="checkbox" data-field="cancelled" ${family.cancelled ? 'checked' : ''}/> Отмена</label>
      </div>
      <label>Длительность квеста, мин.</label><input type="number" data-field="questDurationMin" value="${family.questDurationMin || 20}" min="5" max="60" />
      <label>Ручная группа</label><select data-field="manualGroup">${groupOptions(groups, family.manualGroupId)}</select>
      <div class="button-row"><button class="small" data-save-family="${esc(family.id)}">Сохранить все данные</button>
      <button class="secondary small" data-save-override="${esc(family.id)}">Применить группу</button>
      <button class="danger small" data-delete-family="${esc(family.id)}">Удалить семью</button></div>
      <div class="search-hint" data-family-msg="${esc(family.id)}"></div>
    </details>`;
  }
  function routeStop(stop, index, total, groupId) {
    const address = stop.hostType === 'special'
      ? `${stop.displayName} — ${stop.tower}, этаж ${stop.floor}`
      : `${stop.tower}, этаж ${stop.floor}, квартира ${stop.apartmentCode}`;
    return `<li class="admin-route-stop"><span>${stop.isQuest ? '🎭' : '🍬'} ${esc(address)}</span>
      <span class="route-controls"><button class="secondary tiny" data-route-move="up" data-group="${esc(groupId)}" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="secondary tiny" data-route-move="down" data-group="${esc(groupId)}" data-index="${index}" ${index === total - 1 ? 'disabled' : ''}>↓</button></span></li>`;
  }
  function groupCard(group, familiesById) {
    const members = group.memberFamilyIds.map((id) => familiesById.get(id)).filter(Boolean);
    return `<div class="group-card" data-group-card="${esc(group.id)}">
      <div class="admin-grid"><div><label>Название группы</label><input type="text" data-group-name="${esc(group.id)}" value="${esc(group.name || group.id)}" /></div>
      <div><button class="small" data-save-group-name="${esc(group.id)}">Сохранить название</button></div></div>
      <p class="muted">${members.map((family) => `${esc(family.tower)} ${esc(family.apartmentCode)}`).join(' · ') || 'Нет участников'}</p>
      <ol class="admin-route">${group.stops.map((stop, index) => routeStop(stop, index, group.stops.length, group.id)).join('') || '<li>Маршрут пуст</li>'}</ol>
    </div>`;
  }
  async function renderDashboard() {
    APP.innerHTML = '<div class="card"><p>Загрузка…</p></div>';
    try {
      const [{ families }, { groups }, { specialPoints }, eventSettings] = await Promise.all([
        api('/families'), api('/groups'), api('/special-points'), api('/event-settings'),
      ]);
      const familiesById = new Map(families.map((family) => [family.id, family]));
      APP.innerHTML = `<div class="button-row top-actions"><button id="backBtn" class="secondary small">← В приложение</button>
        <button id="addTestDataBtn" class="secondary small">🧪 Добавить 20 тестовых семей</button>
        <button id="recomputeBtn" class="small">🔄 Сформировать группы и маршруты</button></div><div id="adminActionMsg" class="search-hint"></div>
        <div class="card event-settings-card"><div class="event-settings-heading"><div><div class="countdown-kicker"><span class="countdown-dot"></span> Управление событием</div>
          <h3>Начало Монстрополии</h3></div><div class="server-clock"><span>Время сервера</span><strong>${esc(eventSettings.serverLocalNow.replace('T', ' '))}</strong></div></div>
          <p class="muted">Укажите дату и время по часам сервера. Часовой пояс отдельно не применяется.</p>
          <div class="event-settings-controls"><div><label>Дата и время начала</label><input type="datetime-local" id="eventStartLocal" value="${esc(eventSettings.eventStartLocal)}" /></div>
          <button id="saveEventStartBtn" class="small">Сохранить начало</button></div><div id="eventSettingsMsg" class="search-hint"></div></div>
        <div class="card"><h3>👥 Группы (${groups.length})</h3>${groups.map((group) => groupCard(group, familiesById)).join('') || '<p>Группы ещё не сформированы.</p>'}</div>
        <div class="card"><h3>🏪 Спецточки</h3><div class="admin-grid"><div><label>Башня</label><select id="spTower">${towerOptions()}</select></div>
          <div><label>Этаж</label><input type="number" id="spFloor" value="0" /></div></div>
          <label>Название</label><input type="text" id="spName" placeholder="Название точки" /><button id="spAddBtn" class="secondary">+ Добавить</button>
          <div id="spMsg" class="search-hint"></div><ul class="plain-list">${specialPoints.map((point) => `<li>${point.quest ? '🎭' : '🍬'} ${esc(point.name)} — ${esc(point.tower)}, эт. ${point.floor}
          <button class="secondary tiny" data-toggle-sp="${esc(point.id)}" data-active="${point.active}">${point.active ? 'Выключить' : 'Включить'}</button>
          <button class="danger tiny" data-delete-sp="${esc(point.id)}">Удалить</button></li>`).join('') || '<li>Нет спецточек</li>'}</ul></div>
        <div class="card"><h3>🎃 Зарегистрированные семьи (${families.length})</h3>
          <p class="muted">Раскройте семью, чтобы увидеть все аккаунты и изменить анкету.</p>${families.map((family) => familyCard(family, groups)).join('')}</div>`;
      bindDashboard({ families, groups });
    } catch (error) {
      renderLogin(PLATFORM === 'telegram' ? 'Этот Telegram-аккаунт не является супер-пользователем' : error.message);
    }
  }
  function parseChildren(text) {
    return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, age] = line.split('|');
      return { name: (name || '').trim(), age: Number(age) };
    });
  }
  function bindDashboard({ groups }) {
    document.getElementById('backBtn').onclick = () => { location.href = '/'; };
    document.getElementById('saveEventStartBtn').onclick = async () => {
      const button = document.getElementById('saveEventStartBtn');
      const message = document.getElementById('eventSettingsMsg');
      const eventStartLocal = document.getElementById('eventStartLocal').value;
      if (!eventStartLocal) return void (message.textContent = 'Укажите дату и время начала');
      button.disabled = true;
      message.textContent = 'Сохраняем…';
      try {
        const result = await api('/event-settings', { method: 'PUT', body: { eventStartLocal } });
        message.textContent = `Сохранено: ${result.eventStartLocal.replace('T', ' ')}`;
        setTimeout(renderDashboard, 700);
      } catch (error) {
        button.disabled = false;
        message.textContent = error.message;
      }
    };
    document.getElementById('addTestDataBtn').onclick = async () => {
      const button = document.getElementById('addTestDataBtn');
      const message = document.getElementById('adminActionMsg');
      button.disabled = true;
      message.textContent = 'Создаём случайные анкеты…';
      try {
        const result = await api('/test-data', { method: 'POST', body: { count: 20 } });
        message.textContent = `Добавлено тестовых семей: ${result.created}`;
        setTimeout(renderDashboard, 700);
      } catch (error) {
        button.disabled = false;
        message.textContent = error.message;
      }
    };
    document.getElementById('recomputeBtn').onclick = async () => {
      const message = document.getElementById('adminActionMsg'); message.textContent = 'Считаем…';
      try {
        const result = await api('/recompute', { method: 'POST' });
        message.textContent = `Готово: ${result.groupCount} групп, отправлено уведомлений: ${result.notifications.sent}, пропущено по лимиту: ${result.notifications.ignoredByCooldown}`;
        setTimeout(renderDashboard, 900);
      } catch (error) { message.textContent = error.message; }
    };
    document.querySelectorAll('[data-save-family]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.saveFamily; const card = document.querySelector(`[data-family-card="${CSS.escape(id)}"]`);
        const field = (name) => card.querySelector(`[data-field="${name}"]`);
        const message = card.querySelector(`[data-family-msg="${CSS.escape(id)}"]`);
        try {
          await api(`/families/${encodeURIComponent(id)}`, { method: 'PATCH', body: {
            tower: field('tower').value, floor: Number(field('floor').value), apartmentCode: field('apartmentCode').value.trim(),
            children: parseChildren(field('children').value), walking: field('walking').checked, hosting: field('hosting').checked,
            quest: field('quest').checked, cancelled: field('cancelled').checked, questDurationMin: Number(field('questDurationMin').value) || 20,
          } });
          message.textContent = 'Сохранено ✓';
        } catch (error) { message.textContent = error.message; }
      };
    });
    document.querySelectorAll('[data-save-override]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.saveOverride; const card = document.querySelector(`[data-family-card="${CSS.escape(id)}"]`);
        try { await api('/override', { method: 'POST', body: { familyId: id, groupId: card.querySelector('[data-field="manualGroup"]').value || null } }); button.textContent = 'Применено ✓'; }
        catch (error) { alert(error.message); }
      };
    });
    document.querySelectorAll('[data-delete-family]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.deleteFamily;
        const card = document.querySelector(`[data-family-card="${CSS.escape(id)}"]`);
        const address = card.querySelector('summary strong')?.textContent || 'эту семью';
        if (!confirm(`Полностью удалить ${address}? Доступ всех членов семьи и анкета будут удалены.`)) return;
        button.disabled = true;
        try {
          await api(`/families/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await renderDashboard();
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
      };
    });
    document.querySelectorAll('[data-save-group-name]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.saveGroupName; const name = document.querySelector(`[data-group-name="${CSS.escape(id)}"]`).value.trim();
        try { await api(`/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }); button.textContent = 'Сохранено ✓'; }
        catch (error) { alert(error.message); }
      };
    });
    document.querySelectorAll('[data-route-move]').forEach((button) => {
      button.onclick = async () => {
        const group = groups.find((item) => item.id === button.dataset.group); const index = Number(button.dataset.index);
        const target = button.dataset.routeMove === 'up' ? index - 1 : index + 1;
        [group.stops[index], group.stops[target]] = [group.stops[target], group.stops[index]];
        try { await api(`/groups/${encodeURIComponent(group.id)}/route`, { method: 'PUT', body: { stopIds: group.stops.map((stop) => stop.id) } }); renderDashboard(); }
        catch (error) { alert(error.message); }
      };
    });
    document.getElementById('spAddBtn').onclick = async () => {
      const name = document.getElementById('spName').value.trim(); if (!name) return void (document.getElementById('spMsg').textContent = 'Введите название');
      try { await api('/special-points', { method: 'POST', body: { tower: document.getElementById('spTower').value, floor: Number(document.getElementById('spFloor').value) || 0, name } }); renderDashboard(); }
      catch (error) { document.getElementById('spMsg').textContent = error.message; }
    };
    document.querySelectorAll('[data-toggle-sp]').forEach((button) => { button.onclick = async () => { await api(`/special-points/${encodeURIComponent(button.dataset.toggleSp)}`, { method: 'PATCH', body: { active: button.dataset.active !== 'true' } }); renderDashboard(); }; });
    document.querySelectorAll('[data-delete-sp]').forEach((button) => { button.onclick = async () => { if (confirm('Удалить спецточку?')) { await api(`/special-points/${encodeURIComponent(button.dataset.deleteSp)}`, { method: 'DELETE' }); renderDashboard(); } }; });
  }
  if (PLATFORM === 'telegram') renderDashboard();
  else if (password) renderDashboard();
  else renderLogin();
})();
