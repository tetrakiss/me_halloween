(function () {
  const APP = document.getElementById('app');
  const MINI_APP_CONTEXT = window.MINI_APP_CONTEXT || { platform: 'web', initData: '' };
  let password = sessionStorage.getItem('adminPassword') || '';
  const familyFilterState = { query: '', tower: '', ageMin: '', ageMax: '', statuses: new Set() };
  let familyFiltersOpen = false;

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
  function groupOptions(groups, selected, emptyLabel = '— без ручной группы —') {
    return [`<option value="">${esc(emptyLabel)}</option>`]
      .concat(groups.map((group) => `<option value="${esc(group.id)}" ${group.id === selected ? 'selected' : ''}>${esc(group.name || group.id)}</option>`)).join('');
  }
  function familyCard(family, groups) {
    const childrenText = family.children.map((child) => `${child.name}|${child.age}`).join('\n');
    const hostingMark = family.quest ? '🎭' : family.hosting ? '🍬' : '<span class="choice-missing-mark">⚠️ тип не выбран</span>';
    return `<details class="admin-family" data-family-card="${esc(family.id)}">
      <summary><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
        <span class="admin-family-meta"><i>${family.children.length} дет.</i>${family.cancelled ? '❌' : family.groupingPaused ? '⏳ вне группы' : family.walking ? '🚶' : '⏸️'} ${hostingMark}</span></summary>
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
        <label><input type="checkbox" data-field="hosting" ${family.hosting ? 'checked' : ''}/> Раздаёт конфеты 🍬</label>
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
    const title = stop.hostType === 'special' ? stop.displayName : stop.tower;
    const address = stop.hostType === 'special'
      ? `${stop.tower} · этаж ${stop.floor}`
      : `этаж ${stop.floor} · квартира ${stop.apartmentCode}`;
    return `<li class="admin-route-stop" draggable="true" data-route-stop-id="${stop.id}" data-group="${esc(groupId)}"><span class="route-drag-handle" title="Перетащить">⠿</span><span class="admin-route-node">${index + 1}</span><span class="admin-route-address"><strong>${stop.isQuest ? '🎭' : '🍬'} ${esc(title)}</strong><small>${esc(address)}</small></span>
      <span class="route-controls"><button class="secondary tiny" data-route-move="up" data-group="${esc(groupId)}" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="secondary tiny" data-route-move="down" data-group="${esc(groupId)}" data-index="${index}" ${index === total - 1 ? 'disabled' : ''}>↓</button></span></li>`;
  }
  function groupCard(group, familiesById) {
    const members = group.memberFamilyIds.map((id) => familiesById.get(id)).filter(Boolean);
    const childCount = members.reduce((sum, family) => sum + family.children.length, 0);
    const questCount = group.stops.filter((stop) => stop.isQuest).length;
    const candyCount = group.stops.length - questCount;
    return `<div class="group-card" data-group-card="${esc(group.id)}">
      <div class="admin-grid"><div><label>Название группы</label><input type="text" data-group-name="${esc(group.id)}" value="${esc(group.name || group.id)}" /></div>
      <div class="button-row"><button class="small" data-save-group-name="${esc(group.id)}">Сохранить название</button>
      <button class="danger small" data-delete-group="${esc(group.id)}">Удалить группу</button></div></div>
      <div class="group-summary"><span>👧 ${childCount} детей</span><span>🎭 ${questCount} квестов</span><span>🍬 ${candyCount} с конфетами</span></div>
      <h4>Состав группы</h4>
      <ul class="group-members">${members.map((family) => `<li><div><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
        <small>${family.children.map((child) => `${esc(child.name)}, ${child.age}`).join(' · ')}</small></div>
        <button class="danger tiny" data-remove-member="${esc(family.id)}" data-group="${esc(group.id)}">Убрать из группы</button></li>`).join('') || '<li>В группе пока никого нет</li>'}</ul>
      <h4>Маршрут</h4>
      <ol class="admin-route">${group.stops.map((stop, index) => routeStop(stop, index, group.stops.length, group.id)).join('') || '<li>Маршрут пуст</li>'}</ol>
    </div>`;
  }
  function waitingFamilyCard(family, groups) {
    return `<li class="waiting-family" data-waiting-family="${esc(family.id)}"><div><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
      <small>${family.children.map((child) => `${esc(child.name)}, ${child.age}`).join(' · ')}</small></div>
      <div class="waiting-actions"><select data-waiting-group="${esc(family.id)}">${groupOptions(groups, '', '— выберите группу —')}</select>
      <button class="small" data-assign-waiting="${esc(family.id)}">Назначить</button>
      ${family.groupingPaused ? `<button class="secondary small" data-resume-grouping="${esc(family.id)}">Вернуть в автоподбор</button>` : ''}</div></li>`;
  }
  function dashboardOverview(families, groups, waitingFamilies) {
    const participatingFamilies = families.filter((family) => family.walking && !family.cancelled);
    const hostingFamilies = families.filter((family) => (family.hosting || family.quest) && !family.cancelled);
    const children = participatingFamilies.flatMap((family) => family.children);
    const waitingChildren = waitingFamilies.reduce((sum, family) => sum + family.children.length, 0);
    const assignedChildren = groups.reduce((sum, group) => (
      sum + group.memberFamilyIds.reduce((groupSum, familyId) => (
        groupSum + (families.find((family) => family.id === familyId)?.children.length || 0)
      ), 0)
    ), 0);
    const averageGroupSize = groups.length ? (assignedChildren / groups.length).toFixed(1) : '—';
    const ageCounts = new Map(Array.from({ length: 17 }, (_, index) => [index + 1, 0]));
    children.forEach((child) => ageCounts.set(Number(child.age), (ageCounts.get(Number(child.age)) || 0) + 1));
    const maxAgeCount = Math.max(1, ...ageCounts.values());
    const unconfiguredFamilies = families.filter((family) => !family.cancelled && !family.hosting && !family.quest);
    const ageBars = [...ageCounts.entries()].map(([age, count]) => {
      const height = count ? Math.max(8, Math.round(count / maxAgeCount * 100)) : 2;
      return `<div class="age-bar" title="${age} лет — ${count} детей">
        <span class="age-bar-value">${count || ''}</span>
        <div class="age-bar-track"><i style="height:${height}%"></i></div>
        <strong>${age}</strong>
      </div>`;
    }).join('');
    const metrics = [
      ['👧', children.length, 'Всего детей', `${participatingFamilies.length} семей участвуют`],
      ['👥', groups.length, 'Всего групп', `${assignedChildren} детей распределено`],
      ['🍬', hostingFamilies.filter((family) => !family.quest).length, 'Квартир с конфетами', 'обычная выдача'],
      ['🎭', hostingFamilies.filter((family) => family.quest).length, 'Квартир с квестами', 'остановки с заданием'],
      ['⏳', waitingFamilies.length, 'Ждут распределения', `${waitingChildren} детей`],
      ['⚖️', averageGroupSize, 'Средний размер группы', 'детей в группе'],
    ];
    return `<section class="admin-overview" aria-label="Сводка мероприятия">
      <div class="metric-grid">${metrics.map(([icon, value, label, note]) => `<article class="metric-card">
        <span class="metric-icon">${icon}</span><div><strong>${value}</strong><span>${label}</span><small>${note}</small></div>
      </article>`).join('')}</div>
      <article class="age-chart-card"><div class="overview-heading"><div><span class="overview-kicker">Возраст участников</span>
        <h3>Распределение детей по возрастам</h3></div><span class="chart-total">${children.length} всего</span></div>
        <div class="age-chart-scroll"><div class="age-chart" role="img" aria-label="Распределение детей от одного года до семнадцати лет">${ageBars}</div></div>
        <div class="age-chart-caption"><span>Возраст, лет</span><span>Высота столбца — количество детей</span></div>
      </article>
      ${unconfiguredFamilies.length ? `<button class="hosting-filter-button" data-activate-family-filter="unconfigured">
        <span><i>⚠️</i><b>Не выбран тип приёма гостей</b><small>${unconfiguredFamilies.length} семей — показать в общем списке</small></span><strong>Показать →</strong>
      </button>` : ''}
    </section>`;
  }
  async function renderDashboard() {
    APP.innerHTML = '<div class="card"><p>Загрузка…</p></div>';
    try {
      const [{ families }, { groups }, { specialPoints }, eventSettings] = await Promise.all([
        api('/families'), api('/groups'), api('/special-points'), api('/event-settings'),
      ]);
      const familiesById = new Map(families.map((family) => [family.id, family]));
      const waitingFamilies = families.filter((family) => family.walking && !family.cancelled && !family.currentGroupId);
      APP.innerHTML = `<section class="admin-section admin-actions"><div class="admin-section-head"><div><span class="section-kicker">Быстрые действия</span><h2>Управление событием</h2></div><span class="status-pill"><i></i>Система активна</span></div>
        <div class="admin-action-grid"><button id="backBtn" class="secondary small">← В приложение</button>
        <button id="distributeWaitingBtn" class="secondary small" ${waitingFamilies.length ? '' : 'disabled'}>🎲 Распределить ожидающих <span class="action-count">${waitingFamilies.length}</span></button>
        <button id="recomputeBtn" class="small">✦ Сформировать группы и маршруты</button></div><div id="adminActionMsg" class="search-hint"></div></section>
        <section class="admin-section test-data-section"><div class="admin-section-head"><div><span class="section-kicker">Тестовые данные</span><h2>Управление базой семей</h2></div><span class="test-data-badge">${families.length} семей</span></div>
          <div class="test-data-actions"><button id="addTestDataBtn" class="secondary small">🧪 Добавить 20 тестовых семей</button>
          <button id="deleteAllFamiliesBtn" class="danger small">⌫ Удалить все семьи, группы и маршруты</button></div>
          <p class="test-data-warning">Удаление очищает семьи, детей, участников, группы и маршруты. Спецточки и время начала сохраняются.</p>
          <div id="testDataMsg" class="search-hint" aria-live="polite"></div></section>
        ${dashboardOverview(families, groups, waitingFamilies)}
        <div class="card event-settings-card"><div class="event-settings-heading"><div><div class="countdown-kicker"><span class="countdown-dot"></span> Управление событием</div>
          <h3>Начало Монстрополии</h3></div><div class="server-clock"><span>Время сервера</span><strong>${esc(eventSettings.serverLocalNow.replace('T', ' '))}</strong></div></div>
          <p class="muted">Укажите дату и время по часам сервера. Часовой пояс отдельно не применяется.</p>
          <div class="event-settings-controls"><div><label>Дата и время начала</label><input type="datetime-local" id="eventStartLocal" value="${esc(eventSettings.eventStartLocal)}" /></div>
          <button id="saveEventStartBtn" class="small">Сохранить начало</button></div><div id="eventSettingsMsg" class="search-hint"></div></div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Маршрутизация</span><h2>Группы</h2></div><span class="metric-total">${groups.length}</span></div>${groups.map((group) => groupCard(group, familiesById)).join('') || '<p class="muted">Группы ещё не сформированы.</p>'}</div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Очередь</span><h2>Ожидают назначения</h2></div><span class="metric-total">${waitingFamilies.length}</span></div>
          <p class="muted">Здесь видны все активные семьи без группы. Их можно назначить вручную или вернуть в следующий автоматический подбор.</p>
          <ul class="waiting-list">${waitingFamilies.map((family) => waitingFamilyCard(family, groups)).join('') || '<li>Очередь пуста</li>'}</ul></div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Точки маршрута</span><h2>Спецточки</h2></div><span class="metric-total">${specialPoints.length}</span></div><div class="admin-grid"><div><label>Башня</label><select id="spTower">${towerOptions()}</select></div>
          <div><label>Этаж</label><input type="number" id="spFloor" value="0" /></div></div>
          <label>Название</label><input type="text" id="spName" placeholder="Название точки" /><button id="spAddBtn" class="secondary">+ Добавить</button>
          <div id="spMsg" class="search-hint"></div><ul class="plain-list">${specialPoints.map((point) => `<li>${point.quest ? '🎭' : '🍬'} ${esc(point.name)} — ${esc(point.tower)}, эт. ${point.floor}
          <button class="secondary tiny" data-toggle-sp="${esc(point.id)}" data-active="${point.active}">${point.active ? 'Выключить' : 'Включить'}</button>
          <button class="danger tiny" data-delete-sp="${esc(point.id)}">Удалить</button></li>`).join('') || '<li>Нет спецточек</li>'}</ul></div>
        <div class="card admin-collection" id="familiesSection"><div class="admin-section-head"><div><span class="section-kicker">Участники</span><h2>Зарегистрированные семьи</h2></div>
          <div class="family-filter-heading-actions"><span class="metric-total" id="familyFilterCount">${families.length}</span><button id="toggleFamilyFilters" class="secondary tiny family-filter-toggle" type="button" aria-expanded="${familyFiltersOpen}"><span id="familyFilterToggleText">Фильтры</span><i aria-hidden="true">⌄</i></button></div></div>
          <div class="family-filter-bar" id="familyFilterPanel" ${familyFiltersOpen ? '' : 'hidden'}>
            <div class="family-filter-primary"><label class="family-filter-search"><span>Поиск</span><input id="familyFilterQuery" type="text" placeholder="Башня, квартира или имя ребёнка" /></label>
            <label class="family-filter-tower"><span>Башня</span><select id="familyFilterTower"><option value="">Все башни</option>${towerOptions()}</select></label>
            <label class="family-filter-age"><span>Возраст ребёнка</span><span class="family-filter-age-inputs"><input id="familyFilterAgeMin" type="number" min="1" max="17" placeholder="от" /><input id="familyFilterAgeMax" type="number" min="1" max="17" placeholder="до" /></span></label></div>
            <fieldset class="family-filter-fieldset"><legend>Статусы — можно выбрать несколько</legend><div class="family-filter-chips">
              <label><input type="checkbox" value="walking" /> Идут в обход</label>
              <label><input type="checkbox" value="notWalking" /> Не идут в обход</label>
              <label><input type="checkbox" value="grouped" /> Уже в группе</label>
              <label><input type="checkbox" value="waiting" /> Ожидают группу</label>
              <label><input type="checkbox" value="hosting" /> Раздают конфеты</label>
              <label><input type="checkbox" value="quest" /> Проводят квест</label>
              <label><input type="checkbox" value="unconfigured" /> Формат не заполнен</label>
              <label><input type="checkbox" value="cancelled" /> Отменены</label>
            </div></fieldset>
            <div class="family-filter-result"><span id="familyFilterSummary">Показаны все семьи</span><button id="clearFamilyFilters" class="secondary tiny" type="button">Сбросить фильтры</button></div>
          </div>
          <p class="muted">Раскройте семью, чтобы увидеть все аккаунты и изменить анкету.</p><div id="familyCards">${families.map((family) => familyCard(family, groups)).join('')}</div>
          <p id="familyFilterEmpty" class="family-filter-empty" hidden>По выбранным фильтрам семьи не найдены.</p></div>`;
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
  function bindDashboard({ families, groups }) {
    document.getElementById('backBtn').onclick = () => {
      sessionStorage.setItem('skipNextAppSplash', '1');
      location.href = `/${location.search}${location.hash}`;
    };
    const familyById = new Map(families.map((family) => [family.id, family]));
    const filterQuery = document.getElementById('familyFilterQuery');
    const filterTower = document.getElementById('familyFilterTower');
    const filterAgeMin = document.getElementById('familyFilterAgeMin');
    const filterAgeMax = document.getElementById('familyFilterAgeMax');
    const filterStatusInputs = [...document.querySelectorAll('.family-filter-chips input')];
    const filterCount = document.getElementById('familyFilterCount');
    const filterSummary = document.getElementById('familyFilterSummary');
    const filterEmpty = document.getElementById('familyFilterEmpty');
    const filterPanel = document.getElementById('familyFilterPanel');
    const filterToggle = document.getElementById('toggleFamilyFilters');
    const filterToggleText = document.getElementById('familyFilterToggleText');
    const setFilterPanelOpen = (open) => {
      familyFiltersOpen = open;
      filterPanel.hidden = !open;
      filterToggle.setAttribute('aria-expanded', String(open));
    };
    filterToggle.onclick = () => setFilterPanelOpen(!familyFiltersOpen);
    const matchesStatus = (family, status) => ({
      walking: family.walking && !family.cancelled,
      notWalking: !family.walking && !family.cancelled,
      grouped: !!family.currentGroupId && !family.cancelled,
      waiting: family.walking && !family.cancelled && !family.currentGroupId,
      hosting: family.hosting && !family.quest && !family.cancelled,
      quest: family.quest && !family.cancelled,
      unconfigured: !family.cancelled && !family.hosting && !family.quest,
      cancelled: family.cancelled,
    })[status];
    const applyFamilyFilters = () => {
      const query = familyFilterState.query.trim().toLocaleLowerCase('ru');
      const activeStatuses = [...familyFilterState.statuses];
      const statusCategories = [
        ['walking', 'notWalking', 'cancelled'],
        ['grouped', 'waiting'],
        ['hosting', 'quest', 'unconfigured'],
      ];
      const minAge = Number(familyFilterState.ageMin) || 1;
      const maxAge = Number(familyFilterState.ageMax) || 17;
      let visibleCount = 0;
      document.querySelectorAll('[data-family-card]').forEach((card) => {
        const family = familyById.get(card.dataset.familyCard);
        const haystack = [family.tower, family.floor, family.apartmentCode, family.familyCode,
          ...family.children.map((child) => child.name)].join(' ').toLocaleLowerCase('ru');
        const matchesStatuses = statusCategories.every((category) => {
          const selected = category.filter((status) => familyFilterState.statuses.has(status));
          return !selected.length || selected.some((status) => matchesStatus(family, status));
        });
        const matchesAge = family.children.some((child) => Number(child.age) >= minAge && Number(child.age) <= maxAge);
        const matches = (!query || haystack.includes(query))
          && (!familyFilterState.tower || family.tower === familyFilterState.tower)
          && matchesStatuses
          && matchesAge;
        card.hidden = !matches;
        if (matches) visibleCount += 1;
      });
      filterCount.textContent = `${visibleCount} / ${families.length}`;
      const filterParts = [];
      if (familyFilterState.query) filterParts.push('поиск');
      if (familyFilterState.tower) filterParts.push(familyFilterState.tower);
      if (familyFilterState.ageMin || familyFilterState.ageMax) filterParts.push(`возраст ${minAge}–${maxAge}`);
      if (activeStatuses.length) filterParts.push(`${activeStatuses.length} стат.`);
      filterSummary.textContent = filterParts.length ? `Найдено семей: ${visibleCount} · ${filterParts.join(' · ')}` : 'Показаны все семьи';
      filterToggleText.textContent = filterParts.length ? `Фильтры · ${filterParts.length}` : 'Фильтры';
      filterToggle.classList.toggle('has-active-filters', filterParts.length > 0);
      filterEmpty.hidden = visibleCount !== 0;
    };
    filterQuery.value = familyFilterState.query;
    filterTower.value = familyFilterState.tower;
    filterAgeMin.value = familyFilterState.ageMin;
    filterAgeMax.value = familyFilterState.ageMax;
    filterStatusInputs.forEach((input) => { input.checked = familyFilterState.statuses.has(input.value); });
    filterQuery.oninput = () => { familyFilterState.query = filterQuery.value; applyFamilyFilters(); };
    filterTower.onchange = () => { familyFilterState.tower = filterTower.value; applyFamilyFilters(); };
    filterAgeMin.oninput = () => { familyFilterState.ageMin = filterAgeMin.value; applyFamilyFilters(); };
    filterAgeMax.oninput = () => { familyFilterState.ageMax = filterAgeMax.value; applyFamilyFilters(); };
    filterStatusInputs.forEach((input) => {
      input.onchange = () => {
        if (input.checked) familyFilterState.statuses.add(input.value); else familyFilterState.statuses.delete(input.value);
        applyFamilyFilters();
      };
    });
    document.getElementById('clearFamilyFilters').onclick = () => {
      familyFilterState.query = '';
      familyFilterState.tower = '';
      familyFilterState.ageMin = '';
      familyFilterState.ageMax = '';
      familyFilterState.statuses.clear();
      filterQuery.value = '';
      filterTower.value = '';
      filterAgeMin.value = '';
      filterAgeMax.value = '';
      filterStatusInputs.forEach((input) => { input.checked = false; });
      applyFamilyFilters();
    };
    document.querySelectorAll('[data-activate-family-filter]').forEach((button) => {
      button.onclick = () => {
        familyFilterState.statuses.add(button.dataset.activateFamilyFilter);
        filterStatusInputs.forEach((input) => { input.checked = familyFilterState.statuses.has(input.value); });
        setFilterPanelOpen(true);
        applyFamilyFilters();
        document.getElementById('familiesSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    applyFamilyFilters();
    document.querySelectorAll('[data-family-card]').forEach((card) => {
      const hosting = card.querySelector('[data-field="hosting"]');
      const quest = card.querySelector('[data-field="quest"]');
      hosting.onchange = () => { if (!hosting.checked) quest.checked = false; };
      quest.onchange = () => { if (quest.checked) hosting.checked = true; };
    });
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
      const message = document.getElementById('testDataMsg');
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
    document.getElementById('deleteAllFamiliesBtn').onclick = async () => {
      if (!confirm('Удалить ВСЕ семьи, группы и маршруты? Это действие нельзя отменить.')) return;
      const button = document.getElementById('deleteAllFamiliesBtn');
      const message = document.getElementById('testDataMsg');
      button.disabled = true;
      document.getElementById('addTestDataBtn').disabled = true;
      message.textContent = 'Удаляем семейные данные…';
      try {
        const result = await api('/test-data/all', { method: 'DELETE' });
        message.textContent = `Удалено: ${result.deleted.families} семей, ${result.deleted.children} детей, ${result.deleted.groups} групп, ${result.deleted.routes} точек маршрутов`;
        setTimeout(renderDashboard, 900);
      } catch (error) {
        button.disabled = false;
        document.getElementById('addTestDataBtn').disabled = false;
        message.textContent = error.message;
      }
    };
    document.getElementById('recomputeBtn').onclick = async () => {
      const message = document.getElementById('adminActionMsg'); message.textContent = 'Считаем…';
      try {
        const result = await api('/recompute', { method: 'POST' });
        const resumedText = result.resumedWaitingCount
          ? `, возвращено из очереди: ${result.resumedWaitingCount}`
          : '';
        message.textContent = `Готово: ${result.groupCount} групп${resumedText}, отправлено уведомлений: ${result.notifications.sent}, пропущено по лимиту: ${result.notifications.ignoredByCooldown}`;
        setTimeout(renderDashboard, 900);
      } catch (error) { message.textContent = error.message; }
    };
    document.getElementById('distributeWaitingBtn').onclick = async () => {
      const button = document.getElementById('distributeWaitingBtn');
      const message = document.getElementById('adminActionMsg');
      button.disabled = true;
      message.textContent = 'Начинаем со случайной семьи и заполняем свободные места…';
      try {
        const result = await api('/groups/distribute-unassigned', { method: 'POST' });
        const starter = families.find((family) => family.id === result.starterFamilyId);
        const starterText = starter
          ? ` Старт: ${starter.tower}, эт. ${starter.floor}, кв. ${starter.apartmentCode}.`
          : '';
        message.textContent = `Распределено семей: ${result.assignedFamilyCount}. Новых групп: ${result.createdGroupCount}. Осталось в очереди: ${result.waitingFamilyCount}.${starterText}`;
        setTimeout(renderDashboard, 1100);
      } catch (error) {
        button.disabled = false;
        message.textContent = error.message;
      }
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
    document.querySelectorAll('[data-remove-member]').forEach((button) => {
      button.onclick = async () => {
        if (!confirm('Убрать эту семью из группы? Регистрация сохранится, семья перейдёт в очередь ожидания.')) return;
        button.disabled = true;
        try {
          await api(`/groups/${encodeURIComponent(button.dataset.group)}/members/${encodeURIComponent(button.dataset.removeMember)}`, { method: 'DELETE' });
          await renderDashboard();
        } catch (error) { button.disabled = false; alert(error.message); }
      };
    });
    document.querySelectorAll('[data-delete-group]').forEach((button) => {
      button.onclick = async () => {
        const group = groups.find((item) => item.id === button.dataset.deleteGroup);
        if (!confirm(`Удалить группу «${group?.name || button.dataset.deleteGroup}»? Все её семьи перейдут в очередь ожидания.`)) return;
        button.disabled = true;
        try {
          await api(`/groups/${encodeURIComponent(button.dataset.deleteGroup)}`, { method: 'DELETE' });
          await renderDashboard();
        } catch (error) { button.disabled = false; alert(error.message); }
      };
    });
    document.querySelectorAll('[data-assign-waiting]').forEach((button) => {
      button.onclick = async () => {
        const familyId = button.dataset.assignWaiting;
        const groupId = document.querySelector(`[data-waiting-group="${CSS.escape(familyId)}"]`).value;
        if (!groupId) return void alert('Выберите группу');
        button.disabled = true;
        try {
          await api(`/groups/${encodeURIComponent(groupId)}/members`, { method: 'POST', body: { familyId } });
          await renderDashboard();
        } catch (error) { button.disabled = false; alert(error.message); }
      };
    });
    document.querySelectorAll('[data-resume-grouping]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api(`/families/${encodeURIComponent(button.dataset.resumeGrouping)}/grouping/resume`, { method: 'POST' });
          alert('Семья вернётся в группу при следующем формировании.');
          await renderDashboard();
        } catch (error) { button.disabled = false; alert(error.message); }
      };
    });
    const saveRouteOrder = async (group) => {
      await api(`/groups/${encodeURIComponent(group.id)}/route`, {
        method: 'PUT',
        body: { stopIds: group.stops.map((stop) => stop.id) },
      });
      await renderDashboard();
    };
    let draggedRouteStop = null;
    document.querySelectorAll('[data-route-stop-id]').forEach((item) => {
      item.ondragstart = (event) => {
        draggedRouteStop = { groupId: item.dataset.group, stopId: Number(item.dataset.routeStopId) };
        item.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(item.dataset.routeStopId));
      };
      item.ondragover = (event) => {
        if (draggedRouteStop?.groupId !== item.dataset.group) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        item.classList.add('is-drag-target');
      };
      item.ondragleave = () => item.classList.remove('is-drag-target');
      item.ondrop = async (event) => {
        event.preventDefault();
        item.classList.remove('is-drag-target');
        if (!draggedRouteStop || draggedRouteStop.groupId !== item.dataset.group) return;
        const group = groups.find((entry) => entry.id === item.dataset.group);
        const from = group.stops.findIndex((stop) => stop.id === draggedRouteStop.stopId);
        const to = group.stops.findIndex((stop) => stop.id === Number(item.dataset.routeStopId));
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = group.stops.splice(from, 1);
        group.stops.splice(to, 0, moved);
        try { await saveRouteOrder(group); } catch (error) { alert(error.message); await renderDashboard(); }
      };
      item.ondragend = () => {
        draggedRouteStop = null;
        document.querySelectorAll('.admin-route-stop').forEach((stop) => stop.classList.remove('is-dragging', 'is-drag-target'));
      };
    });
    document.querySelectorAll('[data-route-move]').forEach((button) => {
      button.onclick = async () => {
        const group = groups.find((item) => item.id === button.dataset.group); const index = Number(button.dataset.index);
        const target = button.dataset.routeMove === 'up' ? index - 1 : index + 1;
        [group.stops[index], group.stops[target]] = [group.stops[target], group.stops[index]];
        try { await saveRouteOrder(group); }
        catch (error) { alert(error.message); await renderDashboard(); }
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
