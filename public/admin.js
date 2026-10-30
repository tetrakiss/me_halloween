(function () {
  const APP = document.getElementById('app');
  const MINI_APP_CONTEXT = window.MINI_APP_CONTEXT || { platform: 'web', initData: '' };
  let password = sessionStorage.getItem('adminPassword') || '';
  const familyFilterState = { query: '', tower: '', ageMin: '', ageMax: '', statuses: new Set() };
  let familyFiltersOpen = false;
  const groupFilterState = { name: '', apartment: '', telegram: '' };
  const sectionState = new Map([['Сводка мероприятия', true], ['Управление событием', true]]);

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
  function adminHeaders(includeJson = true) {
    const headers = includeJson ? { 'Content-Type': 'application/json' } : {};
    if (PLATFORM === 'telegram') {
      headers['X-Platform'] = 'telegram';
      headers['X-Init-Data'] = getInitDataRaw();
    } else headers['X-Admin-Password'] = password;
    return headers;
  }
  async function api(path, { method = 'GET', body } = {}) {
    const headers = adminHeaders();
    const response = await fetch(`/admin-api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  }
  async function downloadExport(path, filename) {
    const data = await api(`${path}?download=1`);
    const url = new URL(data.url, location.origin).href;
    const message = document.getElementById('adminActionMsg');
    message.textContent = 'Файл готов. Ссылка действует 5 минут. ';
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = 'Скачать Excel';
    link.rel = 'noopener noreferrer';
    message.appendChild(link);
    const telegram = window.Telegram?.WebApp;
    if (PLATFORM === 'telegram' && location.protocol === 'https:' &&
        typeof telegram?.downloadFile === 'function' && telegram.isVersionAtLeast?.('8.0')) {
      const requestDownload = (event) => {
        event?.preventDefault();
        try {
          telegram.downloadFile({ url, file_name: filename }, (accepted) => {
            if (!accepted) link.textContent = 'Скачивание отменено — повторить';
          });
        } catch {
          link.onclick = null;
          link.textContent = 'Скачать Excel по ссылке';
        }
      };
      link.onclick = requestDownload;
      requestDownload();
    } else {
      link.click();
    }
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
    const hostingMark = family.quest ? '🎭' : family.hosting ? '🍬' : family.candyBrought ? '🍬 принесли конфеты' : family.wishFamilyIds?.length ? '🔗 допущены по пожеланию' : '<span class="choice-missing-mark">⏳ ждём конфеты</span>';
    const chaperoneMark = family.adultChaperone ? '<span class="chaperone-mark">🧑‍🤝‍🧑 сопровождает</span>' : '';
    return `<details class="admin-family" data-family-card="${esc(family.id)}">
      <summary><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
        <span class="admin-family-meta"><i>${family.children.length} дет.</i>${family.cancelled ? '❌' : family.groupingPaused ? '⏳ вне группы' : family.walking ? '🚶' : '⏸️'} ${hostingMark} ${chaperoneMark}</span></summary>
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
        <label><input type="checkbox" data-field="adultChaperone" ${family.adultChaperone ? 'checked' : ''}/> Сопровождает группу 🧑‍🤝‍🧑</label>
        <label><input type="checkbox" data-field="hosting" ${family.hosting ? 'checked' : ''}/> Раздаёт конфеты 🍬</label>
        <label><input type="checkbox" data-field="quest" ${family.quest ? 'checked' : ''}/> Квест</label>
        <label data-candy-brought-label ${family.hosting || family.quest ? 'hidden' : ''}><input type="checkbox" data-field="candyBrought" ${family.candyBrought ? 'checked' : ''}/> Принесли конфеты 🍬</label>
        <label><input type="checkbox" data-field="cancelled" ${family.cancelled ? 'checked' : ''}/> Отмена</label>
      </div>
      <label>Длительность квеста, мин.</label><input type="number" data-field="questDurationMin" value="${family.questDurationMin || 20}" min="5" max="60" />
      <p class="muted">Текущая группа: <strong>${esc(groups.find((group) => group.id === family.currentGroupId)?.name || family.currentGroupId || 'Не назначена')}</strong></p>
      <label>Ручная группа</label><select data-field="manualGroup">${groupOptions(groups, family.manualGroupId)}</select>
      <div class="button-row"><button class="small" data-save-family="${esc(family.id)}">Сохранить все данные</button>
      <p class="muted">Ручное назначение применяется сразу, без ограничения по количеству детей.</p>
      <button class="secondary small" data-save-override="${esc(family.id)}">Применить группу</button>
      <button class="danger small" data-delete-family="${esc(family.id)}">Удалить семью</button></div>
      <div class="search-hint" data-family-msg="${esc(family.id)}"></div>
    </details>`;
  }
  function routeStop(stop, index, total, groupId, hasFinal = false) {
    const title = stop.hostType === 'special' ? stop.displayName : stop.tower;
    const address = stop.hostType === 'special'
      ? `${stop.tower} · этаж ${stop.floor}`
      : `этаж ${stop.floor} · квартира ${stop.apartmentCode}`;
    return `<li class="admin-route-stop" draggable="${!stop.isFinal}" data-route-stop-id="${stop.id}" data-group="${esc(groupId)}"><span class="route-drag-handle" title="Перетащить">⠿</span><span class="admin-route-node">${index + 1}</span><span class="admin-route-address"><strong>${stop.isQuest ? '🎭' : '🍬'} ${esc(title)}</strong><small>${esc(address)}</small></span>
      <span class="route-controls"><button class="secondary tiny" data-route-move="up" data-group="${esc(groupId)}" data-index="${index}" ${index === 0 || stop.isFinal ? 'disabled' : ''}>↑</button>
      <button class="secondary tiny" data-route-move="down" data-group="${esc(groupId)}" data-index="${index}" ${stop.isFinal || index === total - 1 || (hasFinal && index === total - 2) ? 'disabled' : ''}>↓</button></span></li>`;
  }
  function memberWishBadges(family, group, familiesById) {
    return (family.wishFamilyIds || []).map((id) => {
      const friend = familiesById.get(id);
      if (!friend) return '';
      const together = group.memberFamilyIds.includes(id);
      return `<small class="member-wish${together ? '' : ' member-wish-missing'}" title="${together ? 'В одной группе' : 'Пожелание не выполнено: семья в другой группе или ожидает'}">🔗 ${esc(friend.tower)}, кв. ${esc(friend.apartmentCode)}${together ? '' : ' ⚠️'}</small>`;
    }).join('');
  }
  function normalizeGroupSearch(value) {
    return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  }
  function groupMatchesFilters(group, familiesById, filters) {
    const members = group.memberFamilyIds.map((id) => familiesById.get(id)).filter(Boolean);
    const name = normalizeGroupSearch(filters.name);
    const apartment = normalizeGroupSearch(filters.apartment);
    const telegram = normalizeGroupSearch(filters.telegram).replace(/^@/, '');
    const tokens = apartment.split(/\s+/).filter(Boolean);
    return (!name || normalizeGroupSearch(group.name || group.id).includes(name))
      && (!apartment || members.some((family) => {
        const address = normalizeGroupSearch(`${family.tower} ${family.apartmentCode}`);
        return tokens.every((token) => address.includes(token));
      }))
      && (!telegram || members.some((family) => (family.parents || []).some((parent) =>
        parent.platform === 'telegram' && (normalizeGroupSearch(parent.username).replace(/^@/, '').includes(telegram)
          || normalizeGroupSearch(`${parent.firstName || ''} ${parent.lastName || ''}`).includes(telegram)))));
  }
  function groupCard(group, familiesById) {
    const members = group.memberFamilyIds.map((id) => familiesById.get(id)).filter(Boolean);
    const childCount = members.reduce((sum, family) => sum + family.children.length, 0);
    const chaperoneCount = members.filter((family) => family.adultChaperone).length;
    const questCount = group.stops.filter((stop) => stop.isQuest).length;
    const candyCount = group.stops.length - questCount;
    const needsAttention = childCount > 0 && childCount < 5;
    const startLocation = String(group.startLocation || '').trim();
    const startStop = `<li class="admin-route-stop admin-route-start"><span class="route-drag-handle route-start-icon">⌂</span><span class="admin-route-node">Старт</span><span class="admin-route-address"><strong>Место сбора группы</strong><small>${esc(startLocation || 'Пока не указано')}</small></span></li>`;
    return `<div class="group-card" data-group-card="${esc(group.id)}">
      <div class="admin-grid"><div><label>Название группы</label><input type="text" data-group-name="${esc(group.id)}" value="${esc(group.name || group.id)}" /></div>
      <div><label>Место сбора — старт</label><select data-group-start="${esc(group.id)}">${towerOptions(group.startTower || 'Вена')}</select><p class="muted">Парковка −2 этаж выбранной башни</p></div></div>
      <div class="button-row"><button class="small" data-save-group="${esc(group.id)}">Сохранить группу</button>
      <button class="danger small" data-delete-group="${esc(group.id)}">Удалить группу</button></div>
      <div class="group-summary"><span>👧 ${childCount} детей</span><span class="group-chaperone-count">🧑‍🤝‍🧑 ${chaperoneCount} сопровождающих</span><span>🎭 ${questCount} квестов</span><span>🍬 ${candyCount} с конфетами</span></div>
      ${needsAttention ? `<div class="group-capacity-warning">⚠️ В группе осталось ${childCount} детей. Маршрут обновлён автоматически, но состав группы стоит проверить вручную.</div>` : ''}
      <h4>Состав группы</h4>
      <ul class="group-members">${members.map((family) => `<li><div><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
        <small>${family.children.map((child) => `${esc(child.name)}, ${child.age}`).join(' · ')}</small>${family.adultChaperone ? '<small class="member-chaperone">🧑‍🤝‍🧑 Есть сопровождающий взрослый</small>' : ''}</div>
        <div class="member-actions">${memberWishBadges(family, group, familiesById)}<button class="danger tiny" data-remove-member="${esc(family.id)}" data-group="${esc(group.id)}">Убрать из группы</button></div></li>`).join('') || '<li>В группе пока никого нет</li>'}</ul>
      <h4>Маршрут · ${group.stops.length} остановок</h4><p class="muted">Не более 3 остановок в одной башне. Собственные квартиры доступны только с квестом.${group.stops.filter((stop) => !stop.isFinal).length < 8 ? ' Основной маршрут короче 8 остановок: проверьте доступность принимающих квартир.' : ''} Финальная спецточка добавляется сверх основных остановок и остаётся последней.</p>
      <ol class="admin-route">${startStop}${group.stops.map((stop, index) => routeStop(stop, index, group.stops.length, group.id, !!group.stops.at(-1)?.isFinal)).join('') || '<li>Квартиры маршрута пока не добавлены</li>'}</ol>
      <div class="search-hint" data-route-warning="${esc(group.id)}" aria-live="polite"></div>
      <button class="small" data-save-route="${esc(group.id)}" disabled>Сохранить маршрут</button>
      <div class="search-hint" data-route-message="${esc(group.id)}" aria-live="polite"></div>
    </div>`;
  }
  function waitingFamilyCard(family, groups) {
    return `<li class="waiting-family" data-waiting-family="${esc(family.id)}"><div><strong>${esc(family.tower)}, эт. ${family.floor}, кв. ${esc(family.apartmentCode)}</strong>
      <small>${family.children.map((child) => `${esc(child.name)}, ${child.age}`).join(' · ')}</small>${family.adultChaperone ? '<small class="member-chaperone">🧑‍🤝‍🧑 Есть сопровождающий взрослый</small>' : ''}</div>
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
      ['🧑‍🤝‍🧑', participatingFamilies.filter((family) => family.adultChaperone).length, 'Сопровождающих семей', 'готовы идти с группой'],
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
  function hostVisitsSection(families, groups, extraVisits) {
    const byId = new Map(families.map((f) => [f.id, f]));
    const describe = (group) => {
      const children = group.memberFamilyIds.flatMap((id) => byId.get(id)?.children || []);
      const ages = children.map((child) => Number(child.age));
      const count = children.length;
      const noun = count % 10 === 1 && count % 100 !== 11 ? 'ребёнок' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'ребёнка' : 'детей';
      const age = ages.length ? ` (${Math.min(...ages)}–${Math.max(...ages)} лет)` : '';
      return `${group.name || group.id} — ${count} ${noun}${age}`;
    };
    const hosts = families.filter((f) => !f.cancelled && (f.hosting || f.quest))
      .sort((a, b) => a.tower.localeCompare(b.tower) || a.floor - b.floor || a.apartmentCode.localeCompare(b.apartmentCode));
    return `<details class="card admin-collection"><summary>Квартиры с квестами и конфетами · ${hosts.length}</summary>
      <p class="muted">Дополнительные посещения добавляются сверх автоматического маршрута, сверх 8 основных остановок и финальной спецточки.</p>
      ${hosts.map((host) => {
        const visiting = groups.filter((g) => g.stops.some((stop) => stop.hostType === 'family' && stop.hostId === host.id));
        const available = groups.filter((g) => !visiting.includes(g));
        const children = visiting.reduce((sum, g) => sum + g.memberFamilyIds.reduce((n, id) => n + (byId.get(id)?.children.length || 0), 0), 0);
        return `<details class="host-visits-card"><summary>${host.quest ? '🎭' : '🍬'} ${esc(host.tower)}, кв. ${esc(host.apartmentCode)} · Групп: ${visiting.length} · Детей: ${children}</summary>
          <ul class="plain-list">${visiting.map((g) => `<li>${esc(describe(g))}${extraVisits.some((v) => v.familyId === host.id && v.groupId === g.id) ? ' · 📌 добавлено вручную' : ''}</li>`).join('') || '<li class="muted">Посещения ещё не назначены</li>'}</ul>
          <label>Добавить группу<select data-host-visit-group="${esc(host.id)}" ${available.length ? '' : 'disabled'}><option value="">${available.length ? 'Выберите группу' : 'Все группы уже посещают квартиру'}</option>${available.map((g) => `<option value="${esc(g.id)}">${esc(describe(g))}</option>`).join('')}</select></label>
          <button class="secondary small" data-add-host-visit="${esc(host.id)}" ${available.length ? '' : 'disabled'}>+ Добавить посещение</button>
          <div class="search-hint" data-host-visit-msg="${esc(host.id)}" aria-live="polite"></div>
        </details>`;
      }).join('') || '<p class="muted">Принимающих квартир пока нет.</p>'}</details>`;
  }
  function makeDashboardSections() {
    const titles = ['Управление событием', 'Управление базой семей', 'Сводка мероприятия',
      'Каталог названий групп', 'Начало Монстрополии', 'Группы', 'Ожидают назначения',
      'Спецточки', 'Зарегистрированные семьи', 'Квартиры с квестами и конфетами'];
    [...APP.children].forEach((section, index) => {
      const key = titles[index];
      section.dataset.sectionKey = key;
      if (!section.id) section.id = `admin-section-${index}`;
      if (section.tagName === 'DETAILS') {
        section.open = sectionState.get(key) || false;
        section.ontoggle = () => sectionState.set(key, section.open);
        return;
      }
      const details = document.createElement('details');
      details.className = section.className + ' admin-collapsible';
      details.dataset.sectionKey = key;
      if (section.id) details.id = section.id;
      const summary = document.createElement('summary');
      const heading = section.querySelector(':scope > .admin-section-head, :scope > .event-settings-heading');
      if (heading) {
        const filters = heading.querySelector('.family-filter-heading-actions');
        if (filters) section.insertBefore(filters, heading.nextSibling);
        summary.append(heading);
      } else summary.textContent = key;
      details.append(summary);
      const content = document.createElement('div');
      content.className = 'admin-section-content';
      content.append(...section.childNodes);
      details.append(content);
      details.open = sectionState.get(key) || false;
      details.ontoggle = () => sectionState.set(key, details.open);
      section.replaceWith(details);
    });
    const sections = [...APP.children];
    // Keep the summary first and destructive tools at the end without replacing controls.
    APP.prepend(sections[2]);
    APP.append(sections[1]);
    const navigation = document.createElement('nav');
    navigation.className = 'admin-navigation';
    navigation.setAttribute('aria-label', 'Разделы панели управления');
    navigation.innerHTML = '<span class="admin-nav-caption">Рабочее пространство</span>';
    [2, 0, 5, 6, 8, 9, 7, 3, 4, 1].forEach((index) => {
      const section = sections[index];
      const link = document.createElement('a');
      link.href = `#${section.id}`;
      link.textContent = titles[index];
      if (index === 1) link.className = 'admin-nav-danger';
      link.onclick = (event) => {
        event.preventDefault();
        section.open = true;
        sectionState.set(titles[index], true);
        navigation.querySelectorAll('a').forEach((item) => item.removeAttribute('aria-current'));
        link.setAttribute('aria-current', 'location');
        section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        const summary = section.querySelector(':scope > summary');
        summary.tabIndex = -1;
        summary.focus({ preventScroll: true });
      };
      navigation.append(link);
    });
    APP.prepend(navigation);
  }
  async function renderDashboard() {
    APP.innerHTML = '<div class="card"><p>Загрузка…</p></div>';
    try {
      const [{ families }, { groups }, { specialPoints }, eventSettings, { names }, { visits: extraVisits }] = await Promise.all([
        api('/families'), api('/groups'), api('/special-points'), api('/event-settings'), api('/group-names'), api('/extra-host-visits'),
      ]);
      const familiesById = new Map(families.map((family) => [family.id, family]));
      const waitingFamilies = families.filter((family) => family.walking && !family.cancelled && !family.currentGroupId);
      const eligibleWaitingCount = waitingFamilies.filter((family) => family.hosting || family.quest || family.candyBrought || family.wishFamilyIds?.length).length;
      APP.innerHTML = `<section class="admin-section admin-actions"><div class="admin-section-head"><div><span class="section-kicker">Быстрые действия</span><h2>Управление событием</h2></div><span class="status-pill"><i></i>Система активна</span></div>
        <div class="admin-action-grid"><button id="backBtn" class="secondary small">← В приложение</button>
        <button id="distributeWaitingBtn" class="secondary small" ${eligibleWaitingCount ? '' : 'disabled'}>🎲 Распределить ожидающих <span class="action-count">${eligibleWaitingCount}</span></button>
        <button id="recomputeRoutesBtn" class="secondary small" ${groups.length ? '' : 'disabled'}>↻ Пересчитать только маршруты</button>
        <button id="recomputeBtn" class="small">✦ Сформировать группы и маршруты</button>
        <button id="remindCandyBtn" class="secondary small">🍬 Напомнить о конфетах</button>
        <button id="exportParticipantsBtn" class="secondary small">⇩ Участники Excel</button>
        <button id="routeScheduleBtn" class="secondary small">◷ Расписание маршрутов</button>
        <button id="exportRoutesBtn" class="secondary small">⇩ Маршруты Excel</button></div><div id="adminActionMsg" class="search-hint"></div></section>
        <section class="admin-section test-data-section"><div class="admin-section-head"><div><span class="section-kicker">Тестовые данные</span><h2>Управление базой семей</h2></div><span class="test-data-badge">${families.length} семей</span></div>
          <div class="test-data-actions"><button id="addTestDataBtn" class="secondary small">🧪 Добавить 20 тестовых семей</button>
          <button id="deleteAllFamiliesBtn" class="danger small">⌫ Удалить все семьи, группы и маршруты</button></div>
          <p class="test-data-warning">Удаление очищает семьи, детей, участников, группы и маршруты. Спецточки и время начала сохраняются.</p>
          <div id="testDataMsg" class="search-hint" aria-live="polite"></div></section>
        ${dashboardOverview(families, groups, waitingFamilies)}
        <details class="card admin-collection"><summary>🎃 Каталог названий групп · ${names.length}</summary>
          <p class="muted">Название подбирается по среднему возрасту детей. Изменения каталога применяются к новым группам; существующие названия сохраняются.</p>
          ${[...names, { id: '', name: '', age_min: 1, age_max: 17 }].map((item) => `<div class="admin-grid" data-catalog-row="${item.id}">
            <label>Название<input data-name type="text" maxlength="80" value="${esc(item.name)}" placeholder="Новое название" /></label>
            <label>Возраст от<input data-min type="number" min="1" max="17" value="${item.age_min}" /></label>
            <label>Возраст до<input data-max type="number" min="1" max="17" value="${item.age_max}" /></label>
            <div class="button-row"><button class="small" data-save-catalog>${item.id ? 'Сохранить' : 'Добавить'}</button>${item.id ? '<button class="danger small" data-delete-catalog>Удалить</button>' : ''}</div>
            <div data-catalog-msg class="search-hint"></div></div>`).join('')}
        </details>
        <div class="card event-settings-card"><div class="event-settings-heading"><div><div class="countdown-kicker"><span class="countdown-dot"></span> Управление событием</div>
          <h3>Начало Монстрополии</h3></div><div class="server-clock"><span>Время сервера</span><strong>${esc(eventSettings.serverLocalNow.replace('T', ' '))}</strong></div></div>
          <p class="muted">Укажите дату и время по часам сервера. Часовой пояс отдельно не применяется.</p>
          <div class="event-settings-controls"><div><label>Дата и время начала</label><input type="datetime-local" id="eventStartLocal" value="${esc(eventSettings.eventStartLocal)}" /></div>
          <button id="saveEventStartBtn" class="small">Сохранить начало</button></div><div id="eventSettingsMsg" class="search-hint"></div>
          <label><input type="checkbox" id="doorStatusEnabled" ${eventSettings.doorStatusEnabled ? 'checked' : ''} /> Активировать отметки «Не открыли»</label>
          <p class="muted">Кнопка доступна участникам только после начала события. До этого времени отметки не сохраняются.</p><div id="doorStatusSettingsMsg" class="search-hint" aria-live="polite"></div>
          <label><input type="checkbox" id="registrationClosed" ${eventSettings.registrationClosed ? 'checked' : ''} /> Закрыть регистрацию новых семей</label>
          <p class="muted">Вход по коду существующей семьи остаётся доступным.</p><div id="registrationSettingsMsg" class="search-hint" aria-live="polite"></div>
          <label><input type="checkbox" id="childrenAdditionClosed" ${eventSettings.childrenAdditionClosed ? 'checked' : ''} /> Запретить добавление новых детей</label>
          <p class="muted">Удалять детей и редактировать данные семьи можно.</p><div id="childrenAdditionSettingsMsg" class="search-hint" aria-live="polite"></div></div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Маршрутизация</span><h2>Группы</h2></div><span class="metric-total" id="groupFilterCount">${groups.length}</span></div>
          <div class="family-filter-bar"><div class="family-filter-primary">
            <label><span>Название группы</span><input type="search" id="groupFilterName" placeholder="Например, Тыквята" /></label>
            <label><span>Квартира участника</span><input type="search" id="groupFilterApartment" placeholder="Например, 1606 или Стамбул 1606" /></label>
            <label><span>Telegram участника</span><input type="search" id="groupFilterTelegram" placeholder="Имя или @username" /></label>
          </div><div class="family-filter-result"><span id="groupFilterSummary" role="status" aria-live="polite"></span><button class="secondary tiny" type="button" id="clearGroupFilters">Сбросить фильтры</button></div></div>
          <p class="muted" id="groupFilterEmpty" hidden>По выбранным фильтрам группы не найдены.</p><p class="muted">До 6 детей в группе. Превышение — только для семей, которые хотят ходить вместе. При распределении ожидающих пожелания объединяют семьи; для освобождения мест могут переноситься семьи без связей. Полное формирование пересобирает все группы и маршруты.</p>${groups.map((group) => groupCard(group, familiesById)).join('') || '<p class="muted">Группы ещё не сформированы.</p>'}</div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Очередь</span><h2>Ожидают назначения</h2></div><span class="metric-total">${waitingFamilies.length}</span></div>
          <p class="muted">Здесь видны все активные семьи без группы. Их можно назначить вручную или вернуть в следующий автоматический подбор.</p>
          <ul class="waiting-list">${waitingFamilies.map((family) => waitingFamilyCard(family, groups)).join('') || '<li>Очередь пуста</li>'}</ul></div>
        <div class="card admin-collection"><div class="admin-section-head"><div><span class="section-kicker">Точки маршрута</span><h2>Спецточки</h2></div><span class="metric-total">${specialPoints.length}</span></div><div class="admin-grid"><div><label>Башня</label><select id="spTower">${towerOptions()}</select></div>
          <div><label>Этаж</label><input type="number" id="spFloor" value="0" /></div></div>
          <label>Название</label><input type="text" id="spName" placeholder="Название точки" /><button id="spAddBtn" class="secondary">+ Добавить</button>
          <div id="spMsg" class="search-hint"></div><ul class="plain-list">${specialPoints.map((point) => `<li>${point.routeFinal ? '🏁' : point.quest ? '🎭' : '🍬'} ${esc(point.name)}${point.routeFinal ? ' · финал для всех групп' : ''} — ${esc(point.tower)}, эт. ${point.floor}
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
              <label><input type="checkbox" value="adultChaperone" /> Есть сопровождающий</label>
              <label><input type="checkbox" value="hosting" /> Раздают конфеты</label>
              <label><input type="checkbox" value="quest" /> Проводят квест</label>
              <label><input type="checkbox" value="unconfigured" /> Формат не заполнен</label>
              <label><input type="checkbox" value="hostOnly" /> Без детей — принимают гостей</label>
              <label><input type="checkbox" value="candyBrought" /> Принесли конфеты</label>
              <label><input type="checkbox" value="candyNotBrought" /> Не принесли конфеты</label>
              <label><input type="checkbox" value="cancelled" /> Отменены</label>
            </div></fieldset>
            <div class="family-filter-result"><span id="familyFilterSummary">Показаны все семьи</span><button id="clearFamilyFilters" class="secondary tiny" type="button">Сбросить фильтры</button></div>
          </div>
          <p class="muted">Раскройте семью, чтобы увидеть все аккаунты и изменить анкету.</p><div id="familyCards">${families.map((family) => familyCard(family, groups)).join('')}</div>
          <p id="familyFilterEmpty" class="family-filter-empty" hidden>По выбранным фильтрам семьи не найдены.</p></div>${hostVisitsSection(families, groups, extraVisits)}`;
      makeDashboardSections();
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
    const groupFamiliesById = new Map(families.map((family) => [family.id, family]));
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const groupCards = [...document.querySelectorAll('[data-group-card]')];
    const applyGroupFilters = () => {
      let visible = 0;
      for (const card of groupCards) {
        const group = groupsById.get(card.dataset.groupCard);
        card.hidden = !group || !groupMatchesFilters(group, groupFamiliesById, groupFilterState);
        if (!card.hidden) visible += 1;
      }
      document.getElementById('groupFilterCount').textContent = `${visible} / ${groups.length}`;
      document.getElementById('groupFilterSummary').textContent = `Показано групп: ${visible} из ${groups.length}`;
      document.getElementById('groupFilterEmpty').hidden = !groups.length || visible > 0;
    };
    const groupFilterInputs = { name: 'groupFilterName', apartment: 'groupFilterApartment', telegram: 'groupFilterTelegram' };
    for (const [key, id] of Object.entries(groupFilterInputs)) {
      const input = document.getElementById(id);
      input.value = groupFilterState[key];
      input.oninput = () => { groupFilterState[key] = input.value; applyGroupFilters(); };
    }
    document.getElementById('clearGroupFilters').onclick = () => {
      for (const [key, id] of Object.entries(groupFilterInputs)) {
        groupFilterState[key] = '';
        document.getElementById(id).value = '';
      }
      applyGroupFilters();
    };
    applyGroupFilters();

    document.querySelectorAll('[data-add-host-visit]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.addHostVisit;
        const select = document.querySelector(`[data-host-visit-group="${CSS.escape(id)}"]`);
        const message = document.querySelector(`[data-host-visit-msg="${CSS.escape(id)}"]`);
        if (!select.value) { message.textContent = 'Выберите группу'; return; }
        button.disabled = true;
        message.textContent = 'Добавляем посещение и обновляем маршрут…';
        try {
          await api(`/hosts/${encodeURIComponent(id)}/visits`, { method: 'POST', body: { groupId: select.value } });
          await renderDashboard();
          document.querySelector(`[data-host-visit-group="${CSS.escape(id)}"]`)?.closest('.host-visits-card')?.setAttribute('open', '');
        } catch (error) { message.textContent = error.message; button.disabled = false; }
      };
    });

    document.getElementById('remindCandyBtn').onclick = async () => {
      if (!confirm('Отправить напоминание семьям со статусом «Ждём конфеты»? Успешно получившим его ранее повторное сообщение не отправится.')) return;
      const button = document.getElementById('remindCandyBtn');
      const message = document.getElementById('adminActionMsg');
      button.disabled = true;
      message.textContent = 'Отправляем напоминания. Не закрывайте страницу…';
      try {
        const result = await api('/notifications/waiting-candy', { method: 'POST' });
        message.textContent = `Напоминание: отправлено аккаунтам — ${result.sent}; уже получали — ${result.skipped}; ошибок — ${result.failed}. Повторное нажатие повторит только неуспешные отправки и охватит новых получателей.`;
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    };
    document.querySelectorAll('[data-catalog-row]').forEach((row) => {
      const id = row.dataset.catalogRow;
      row.querySelector('[data-save-catalog]').onclick = async () => {
        try {
          await api(`/group-names${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: {
            name: row.querySelector('[data-name]').value,
            ageMin: Number(row.querySelector('[data-min]').value), ageMax: Number(row.querySelector('[data-max]').value),
          } });
          await renderDashboard();
        } catch (error) { row.querySelector('[data-catalog-msg]').textContent = error.message; }
      };
      const deleteButton = row.querySelector('[data-delete-catalog]');
      if (deleteButton) deleteButton.onclick = async () => {
        if (!confirm('Удалить название из каталога? Названия существующих групп сохранятся.')) return;
        try { await api(`/group-names/${id}`, { method: 'DELETE' }); await renderDashboard(); }
        catch (error) { row.querySelector('[data-catalog-msg]').textContent = error.message; }
      };
    });
    document.getElementById('doorStatusEnabled').onchange = async (event) => {
      const checkbox = event.target;
      const value = checkbox.checked;
      const message = document.getElementById('doorStatusSettingsMsg');
      checkbox.disabled = true;
      try {
        const settings = await api('/door-status-settings', { method: 'PUT', body: { doorStatusEnabled: value } });
        message.textContent = !settings.doorStatusEnabled ? 'Отметки отключены' : settings.doorStatusActive ? 'Отметки активны' : 'Включено. Кнопка появится после начала события';
      } catch (error) { checkbox.checked = !value; message.textContent = error.message; }
      finally { checkbox.disabled = false; }
    };
    document.getElementById('childrenAdditionClosed').onchange = async (event) => {
      const checkbox = event.target;
      const value = checkbox.checked;
      checkbox.disabled = true;
      const message = document.getElementById('childrenAdditionSettingsMsg');
      try {
        await api('/children-addition-settings', { method: 'PUT', body: { childrenAdditionClosed: value } });
        message.textContent = value ? 'Добавление детей закрыто' : 'Добавление детей разрешено';
      } catch (error) { checkbox.checked = !value; message.textContent = error.message; }
      finally { checkbox.disabled = false; }
    };
    document.getElementById('registrationClosed').onchange = async (event) => {
      const checkbox = event.target;
      const value = checkbox.checked;
      checkbox.disabled = true;
      const message = document.getElementById('registrationSettingsMsg');
      try {
        await api('/registration-settings', { method: 'PUT', body: { registrationClosed: value } });
        message.textContent = value ? 'Регистрация закрыта' : 'Регистрация открыта';
      } catch (error) { checkbox.checked = !value; message.textContent = error.message; }
      finally { checkbox.disabled = false; }
    };
    document.getElementById('routeScheduleBtn').onclick = () => { location.href = `/route-schedule.html${location.search}${location.hash}`; };
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
      adultChaperone: family.adultChaperone && !family.cancelled,
      hosting: family.hosting && !family.quest && !family.cancelled,
      quest: family.quest && !family.cancelled,
      unconfigured: !family.cancelled && !family.hosting && !family.quest,
      hostOnly: !family.cancelled && !family.children.length && (family.hosting || family.quest),
      candyBrought: !family.cancelled && !family.hosting && !family.quest && family.candyBrought,
      candyNotBrought: !family.cancelled && !family.hosting && !family.quest && !family.candyBrought,
      cancelled: family.cancelled,
    })[status];
    const applyFamilyFilters = () => {
      const query = familyFilterState.query.trim().toLocaleLowerCase('ru');
      const activeStatuses = [...familyFilterState.statuses];
      const statusCategories = [
        ['walking', 'notWalking', 'cancelled'],
        ['grouped', 'waiting'],
        ['adultChaperone'],
        ['hosting', 'quest', 'unconfigured'],
        ['candyBrought', 'candyNotBrought'],
        ['hostOnly'],
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
        const matchesAge = (!familyFilterState.ageMin && !familyFilterState.ageMax) || family.children.some((child) => Number(child.age) >= minAge && Number(child.age) <= maxAge);
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
        document.getElementById('familiesSection').open = true;
        document.getElementById('familiesSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    applyFamilyFilters();
    document.querySelectorAll('[data-family-card]').forEach((card) => {
      const hosting = card.querySelector('[data-field="hosting"]');
      const quest = card.querySelector('[data-field="quest"]');
      const updateCandyVisibility = () => { card.querySelector('[data-candy-brought-label]').hidden = hosting.checked || quest.checked; };
      hosting.onchange = () => { if (!hosting.checked) quest.checked = false; updateCandyVisibility(); };
      quest.onchange = () => { if (quest.checked) hosting.checked = true; updateCandyVisibility(); };
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
    document.getElementById('recomputeRoutesBtn').onclick = async () => {
      const button = document.getElementById('recomputeRoutesBtn');
      const message = document.getElementById('adminActionMsg');
      button.disabled = true;
      message.textContent = 'Перестраиваем маршруты…';
      try {
        const result = await api('/recompute-routes', { method: 'POST' });
        message.textContent = `Готово: маршрутов — ${result.groupCount}, остановок — ${result.stopCount}. Состав и названия групп сохранены. Уведомления не отправлялись.`;
        setTimeout(renderDashboard, 2000);
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
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
    const bindExportButton = (id, path, filename, loadingText) => {
      document.getElementById(id).onclick = async () => {
        const button = document.getElementById(id);
        const message = document.getElementById('adminActionMsg');
        button.disabled = true;
        message.textContent = loadingText;
        try {
          await downloadExport(path, filename);
        } catch (error) {
          message.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    };
    bindExportButton('exportParticipantsBtn', '/export/participants.xlsx', 'halloween-participants.xlsx', 'Собираем список участников…');
    bindExportButton('exportRoutesBtn', '/export/routes.xlsx', 'halloween-routes.xlsx', 'Собираем маршруты…');
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
        message.textContent = `Распределено семей: ${result.assignedFamilyCount}. Перенесено между группами: ${result.movedFamilyCount || 0}. Новых групп: ${result.createdGroupCount}. Осталось в очереди: ${result.waitingFamilyCount}.${starterText}`;
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
          const result = await api(`/families/${encodeURIComponent(id)}`, { method: 'PATCH', body: {
            tower: field('tower').value, floor: Number(field('floor').value), apartmentCode: field('apartmentCode').value.trim(),
            children: parseChildren(field('children').value), walking: field('walking').checked, adultChaperone: field('adultChaperone').checked, hosting: field('hosting').checked,
            candyBrought: field('candyBrought').checked,
            quest: field('quest').checked, cancelled: field('cancelled').checked, questDurationMin: Number(field('questDurationMin').value) || 20,
          } });
          familyById.set(id, {
            ...familyById.get(id),
            tower: field('tower').value,
            floor: Number(field('floor').value),
            apartmentCode: field('apartmentCode').value.trim(),
            children: parseChildren(field('children').value),
            walking: field('walking').checked,
            adultChaperone: field('adultChaperone').checked,
            hosting: field('hosting').checked,
            quest: field('quest').checked,
            candyBrought: field('candyBrought').checked,
            cancelled: field('cancelled').checked,
          });
          applyFamilyFilters();
          message.textContent = result.notifications?.failed
            ? `Сохранено ✓. Уведомлений отправлено: ${result.notifications.sent}, ошибок отправки: ${result.notifications.failed}`
            : result.notifications?.sent
              ? `Сохранено ✓. Уведомлений о конфетах отправлено: ${result.notifications.sent}`
              : 'Сохранено ✓';
        } catch (error) { message.textContent = error.message; }
      };
    });
    document.querySelectorAll('[data-save-override]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.saveOverride; const card = document.querySelector(`[data-family-card="${CSS.escape(id)}"]`);
        button.disabled = true;
        button.textContent = 'Применяем…';
        try {
          await api('/override', { method: 'POST', body: { familyId: id, groupId: card.querySelector('[data-field="manualGroup"]').value || null } });
          await renderDashboard();
          const updatedCard = document.querySelector(`[data-family-card="${CSS.escape(id)}"]`);
          if (updatedCard) {
            updatedCard.open = true;
            updatedCard.querySelector('[data-save-override]').textContent = 'Применено ✓';
          }
        } catch (error) { button.disabled = false; button.textContent = 'Применить группу'; alert(error.message); }
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
    document.querySelectorAll('[data-save-group]').forEach((button) => {
      button.onclick = async () => {
        const id = button.dataset.saveGroup;
        const name = document.querySelector(`[data-group-name="${CSS.escape(id)}"]`).value.trim();
        const startTower = document.querySelector(`[data-group-start="${CSS.escape(id)}"]`).value;
        try { await api(`/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name, startTower } }); button.textContent = 'Сохранено ✓';
          const group = groups.find((entry) => entry.id === id);
          group.name = name; group.startTower = startTower; group.startLocation = `${startTower}, парковка -2 этаж`;
          document.querySelector(`[data-group-card="${CSS.escape(id)}"] .admin-route-start .admin-route-address small`).textContent = group.startLocation; }
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
    const savedRoutes = new Map(groups.map((group) => [group.id, [...group.stops]]));
    const routeElement = (attribute, id) => document.querySelector(`[${attribute}="${CSS.escape(id)}"]`);
    const updateRouteWarnings = () => {
      for (const group of groups) {
        const warnings = [];
        group.stops.forEach((stop, index) => {
          const others = groups.filter((other) => other.id !== group.id && savedRoutes.get(other.id)?.[index]?.hostType === stop.hostType
            && savedRoutes.get(other.id)?.[index]?.hostId === stop.hostId);
          if (others.length) {
            const address = stop.hostType === 'special' ? `${stop.tower}, ${stop.displayName}` : `${stop.tower}, кв. ${stop.apartmentCode}`;
            warnings.push(`Этап ${index + 1}: ${address} — ${others.map((other) => other.name || other.id).join(', ')}`);
          }
        });
        routeElement('data-route-warning', group.id).innerHTML = warnings.length
          ? `<p>⚠️ Возможны пересечения: одна точка на одинаковом этапе с другими группами. Сохранение доступно.</p><ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : '';
      }
    };
    const updateRouteDraft = (group) => {
      const card = routeElement('data-group-card', group.id);
      const list = card.querySelector('.admin-route');
      const nodes = new Map([...list.querySelectorAll('[data-route-stop-id]')].map((node) => [Number(node.dataset.routeStopId), node]));
      group.stops.forEach((stop, index) => {
        const node = nodes.get(stop.id);
        node.querySelector('.admin-route-node').textContent = index + 1;
        node.querySelectorAll('[data-route-move]').forEach((button) => {
          button.dataset.index = index;
          button.disabled = stop.isFinal || (button.dataset.routeMove === 'up' ? index === 0 : index === group.stops.length - 1 || !!group.stops[index + 1]?.isFinal);
        });
        list.append(node);
      });
      const dirty = group.stops.some((stop, index) => stop.id !== savedRoutes.get(group.id)[index]?.id);
      routeElement('data-save-route', group.id).disabled = !dirty;
      routeElement('data-route-message', group.id).textContent = dirty ? 'Есть несохранённые изменения маршрута.' : '';
      updateRouteWarnings();
    };
    document.querySelectorAll('[data-save-route]').forEach((button) => {
      button.onclick = async () => {
        const group = groups.find((entry) => entry.id === button.dataset.saveRoute);
        const card = routeElement('data-group-card', group.id);
        button.disabled = true;
        card.querySelectorAll('[data-route-move]').forEach((control) => { control.disabled = true; });
        card.querySelectorAll('[data-route-stop-id]').forEach((node) => { node.draggable = false; });
        let message;
        try {
          await api(`/groups/${encodeURIComponent(group.id)}/route`, { method: 'PUT', body: { stopIds: group.stops.map((stop) => stop.id) } });
          group.stops.forEach((stop) => { stop.waitMin = 0; });
          savedRoutes.set(group.id, [...group.stops]);
          message = 'Маршрут сохранён.';
        } catch (error) { message = error.message; }
        finally {
          card.querySelectorAll('[data-route-stop-id]').forEach((node) => { node.draggable = !group.stops.find((stop) => stop.id === Number(node.dataset.routeStopId))?.isFinal; });
          updateRouteDraft(group);
          routeElement('data-route-message', group.id).textContent = message;
        }
      };
    });
    updateRouteWarnings();
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
        if (from < 0 || to < 0 || from === to || group.stops[from].isFinal || group.stops[to].isFinal) return;
        const [moved] = group.stops.splice(from, 1);
        group.stops.splice(to, 0, moved);
        updateRouteDraft(group);
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
        updateRouteDraft(group);
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
