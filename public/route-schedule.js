(function () {
  const root = document.getElementById('scheduleApp');
  let data = null;
  let selectedGroup = '';
  let loading = false;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clock = (value) => {
    if (!value) return '—';
    const [date, time] = value.split(' ');
    return date === data.eventStartLocal?.split(' ')[0] ? time : `${date} ${time}`;
  };
  const backUrl = `/${location.search}${location.hash}`;
  function render() {
    const t = data.timing;
    const groups = data.groups.filter((group) => !selectedGroup || group.id === selectedGroup);
    root.innerHTML = `<section class="card">
      <div class="schedule-toolbar"><button id="scheduleBack" class="secondary small">← В приложение</button><button id="scheduleRefresh" class="secondary small">Обновить</button><button id="schedulePrint" class="secondary small">Печать</button>
      <label>Группа<select id="scheduleGroup"><option value="">Все группы</option>${data.groups.map((group) => `<option value="${esc(group.id)}" ${group.id === selectedGroup ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select></label></div>
      <div class="schedule-summary"><p>Начало мероприятия: <strong>${esc(data.eventStartLocal || 'не задано')}</strong></p><p>Сбор: <strong>${t.gathering} минут</strong></p><p>Выход групп: <strong>${esc(clock(data.groups[0]?.departureLocal))}</strong></p></div>
      <p class="schedule-note">Квест — ${t.quest} мин · конфеты — ${t.candy} мин · переход в башне — ${t.insideTower} мин · между башнями — ${t.betweenTowers} мин. Первый переход считается от парковки стартовой башни каждой группы. Все группы выходят одновременно, через ${t.gathering} минут после начала мероприятия.</p>
      <p class="schedule-note">Расписание рассчитано по сохранённым маршрутам. Автоматическое обновление — раз в минуту. Ожидание перед посещением, если назначено, указано в таблице. Дополнительный запас на задержки не заложен. Обновлено: ${esc(data.generatedAt)}.</p>
      ${data.eventStartAt === null ? '<p class="schedule-warning">Задайте дату и время начала мероприятия в админке, чтобы увидеть время посещений.</p>' : ''}
      <p class="${data.conflicts.length ? 'schedule-warning' : 'schedule-note'}">${data.conflicts.length ? `Возможные пересечения посещений: ${data.conflicts.length}. Квартиры и группы отмечены в таблицах.` : 'Пересечений расчётных интервалов посещений нет.'}</p>
      <p id="scheduleError" role="status" aria-live="polite"></p>
    </section>
    ${groups.map((group) => `<section class="card schedule-group"><h2>${esc(group.name)}</h2><p>${esc(group.startLocation)}</p>
      <p class="schedule-note">Сбор ${esc(clock(group.gatheringLocal))}–${esc(clock(group.departureLocal))} · окончание ${esc(clock(group.endLocal))}${group.waitingMin ? ` · ожидание по маршруту: ${group.waitingMin} мин` : ''}</p>
      <div class="schedule-scroll"><table class="schedule-table"><thead><tr><th scope="col">Этап</th><th scope="col">Адрес</th><th scope="col">Формат</th><th scope="col">Приход</th><th scope="col">Уход</th></tr></thead><tbody>
      ${group.stops.map((stop) => `<tr class="${stop.conflicts.length ? 'schedule-conflict' : ''}"><td>${stop.seq}</td><td>${esc(stop.tower)}<small>${stop.hostType === 'special' ? esc(stop.displayName) : `Квартира ${esc(stop.apartmentCode)}`} · этаж ${esc(stop.floor)}</small>${stop.conflicts.length ? `<small>⚠️ Пересечение с группами: ${stop.conflicts.map((conflict) => esc(conflict.groupName)).join(', ')}</small>` : ''}</td><td>${stop.isQuest ? '🎭 Квест' : '🍬 Конфеты'}<small>Переход: ${stop.travelMin} мин${stop.waitMin ? ` · ожидание: ${stop.waitMin} мин` : ''}</small></td><td>${esc(clock(stop.arrivalLocal))}</td><td>${esc(clock(stop.departureLocal))}</td></tr>`).join('') || '<tr><td colspan="5">Маршрут пока пуст</td></tr>'}
      </tbody></table></div></section>`).join('') || '<section class="card"><p>Группы ещё не сформированы.</p></section>'}`;
    document.getElementById('scheduleBack').onclick = () => { location.href = backUrl; };
    document.getElementById('schedulePrint').onclick = () => window.print();
    document.getElementById('scheduleRefresh').onclick = load;
    document.getElementById('scheduleGroup').onchange = (event) => { selectedGroup = event.target.value; render(); };
  }
  async function load() {
    if (loading) return;
    loading = true;
    const button = document.getElementById('scheduleRefresh');
    if (button) button.disabled = true;
    try {
      const response = await fetch('/public-api/route-schedule', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить расписание');
      data = result;
      if (selectedGroup && !data.groups.some((group) => group.id === selectedGroup)) selectedGroup = '';
      render();
    } catch (error) {
      if (data) document.getElementById('scheduleError').textContent = `Не удалось обновить данные: ${error.message}. Показано последнее загруженное расписание.`;
      else {
        root.innerHTML = `<section class="card"><h2>Не удалось открыть расписание</h2><p>${esc(error.message)}</p><button id="scheduleBack" class="secondary">В приложение</button></section>`;
        document.getElementById('scheduleBack').onclick = () => { location.href = backUrl; };
      }
    } finally {
      loading = false;
      const refresh = document.getElementById('scheduleRefresh');
      if (refresh) refresh.disabled = false;
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  load();
})();
