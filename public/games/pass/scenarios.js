'use strict';
(function(root) {
  const date = '24.10.2287';
  const visitors = [
    { id: 'marta', name: 'МАРТА КЕЙН', profession: 'ВРАЧ', issued: '12.10.2287', expires: '30.10.2287', radiation: 18, identityMatches: true, weapon: false,
      portrait: 'marta.webp', idPhoto: 'marta-id.webp', baggage: 'marta-bag.webp', greeting: 'Меня вызвали к заболевшему смотрителю.', baggageLine: 'Бинты, лекарства, ножницы. Всё для медблока.', explanation: 'Фото совпадает, пропуск действует, радиация 18 из 40. В сумке лекарства и медицинские ножницы — оружия нет.', outcome: 'МЕДБЛОК: Марта прибыла на дежурство. Смотритель получит помощь.', rejectedOutcome: 'МЕДБЛОК: Врач не допущен. Приём пациентов задерживается.' },
    { id: 'nina', name: 'НИНА ВЕЙЛ', profession: 'ТОРГОВКА', issued: '19.10.2287', expires: '29.10.2287', radiation: 24, identityMatches: true, weapon: true,
      portrait: 'nina.webp', idPhoto: 'nina-id.webp', baggage: 'nina-bag.webp', greeting: 'Принесла консервы и батарейки. Меня ждут на складе.', baggageLine: 'Обычный товар. Ткань можете не разворачивать.', explanation: 'Фото совпадает, пропуск действует, радиация 24 из 40. Но под тканью справа лежит пистолет: видны рукоятка и спусковая скоба.', outcome: 'ОХРАНА: Нина отправлена на внешний пост для сдачи оружия.', admittedOutcome: 'ОХРАНА: Вооружённый посетитель прошёл внутрь. Зафиксировано нарушение.' }
,
    {"id": "boris", "name": "БОРИС РЖАВЫЙ", "profession": "МЕХАНИК", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 40, "identityMatches": true, "weapon": false, "portrait": "boris.webp", "idPhoto": "boris-id.webp", "baggage": "boris-bag.webp", "greeting": "Мне нужно починить насос. Пропуск здесь.", "baggageLine": "Ключи, провод и масло. Обычный набор механика.", "explanation": "Фото совпадает, пропуск действует. Радиация ровно 40 — это разрешено. В сумке только инструменты.", "outcome": "ТЕХСЛУЖБА: Борис приступил к ремонту насоса.", "admittedOutcome": "ТЕХСЛУЖБА: Борис приступил к ремонту насоса.", "rejectedOutcome": "ДИСПЕТЧЕР: Посетитель с действующим допуском задержан. Работа сектора нарушена."},
    {"id": "lev", "name": "ЛЕВ КРОСС", "profession": "КУРЬЕР", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 12, "identityMatches": false, "weapon": false, "portrait": "lev.webp", "idPhoto": "lev-id.webp", "baggage": "lev-bag.webp", "greeting": "Доставка в архив. Передам письма и сразу уйду.", "baggageLine": "Письма и паёк. Больше ничего.", "explanation": "В пропуске другой человек: широкое лицо и большой шрам. У посетителя узкое лицо без шрама. Чистый багаж не исправляет чужой пропуск.", "outcome": "ОХРАНА: Курьер с чужим пропуском отправлен на проверку.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "ОХРАНА: Курьер с чужим пропуском отправлен на проверку."},
    {"id": "oskar", "name": "ОСКАР ФИНЧ", "profession": "ПОВАР", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 41, "identityMatches": true, "weapon": false, "portrait": "oskar.webp", "idPhoto": "oskar-id.webp", "baggage": "oskar-bag.webp", "greeting": "На кухне ждут продукты. Можно проходить?", "baggageLine": "Крупа, кружка и форма для кухни.", "explanation": "Личность совпадает, пропуск действует, оружия нет. Но радиация 41 превышает предел 40. Поварской колпак не является нарушением.", "outcome": "САНПОСТ: Оскар направлен на дезактивацию.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "САНПОСТ: Оскар направлен на дезактивацию."},
    {"id": "vera", "name": "ВЕРА СТОУН", "profession": "ОХРАННИЦА", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 9, "identityMatches": true, "weapon": true, "portrait": "vera.webp", "idPhoto": "vera-id.webp", "baggage": "vera-bag.webp", "greeting": "Я на смену. Откройте шлюз.", "baggageLine": "Личные вещи и снаряжение.", "explanation": "Пропуск и радиация в норме. Под ремнём лежит боевой нож — видны часть лезвия и гарда. Правило действует и для охраны.", "outcome": "ОХРАНА: Вера отправлена сдавать нож на внешний пост.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "ОХРАНА: Вера отправлена сдавать нож на внешний пост."},
    {"id": "semyon", "name": "СЕМЁН ПАЙК", "profession": "ЭЛЕКТРИК", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 35, "identityMatches": true, "weapon": false, "portrait": "semyon.webp", "idPhoto": "semyon-id.webp", "baggage": "semyon-bag.webp", "greeting": "Меня вызвали из-за перебоев со светом.", "baggageLine": "Плоскогубцы, отвёртки, кабель и детали.", "explanation": "Личность совпадает, даты действуют, радиация 35. В багаже инструменты и провода, оружия нет.", "outcome": "ЭНЕРГОБЛОК: Семён восстановил питание жилого сектора.", "admittedOutcome": "ЭНЕРГОБЛОК: Семён восстановил питание жилого сектора.", "rejectedOutcome": "ДИСПЕТЧЕР: Посетитель с действующим допуском задержан. Работа сектора нарушена."},
    {"id": "ada", "name": "АДА МОРРОУ", "profession": "ЖИТЕЛЬНИЦА", "issued": "12.10.2287", "expires": "23.10.2287", "radiation": 7, "identityMatches": false, "weapon": false, "portrait": "ada.webp", "idPhoto": "ada-id.webp", "baggage": "ada-bag.webp", "greeting": "Возвращаюсь домой. Вот мой пропуск.", "baggageLine": "Одежда, книга и игрушка для ребёнка.", "explanation": "На фото в пропуске другая женщина: широкое лицо и короткие тёмные волосы. У посетительницы узкое лицо и длинные волосы. Кроме того, пропуск истёк вчера, 23.10.", "outcome": "ОХРАНА: Ада остановлена для установления личности.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "ОХРАНА: Ада остановлена для установления личности."},
    {"id": "grigory", "name": "ГРИГОРИЙ ВОСС", "profession": "СБОРЩИК", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 63, "identityMatches": true, "weapon": true, "portrait": "grigory.webp", "idPhoto": "grigory-id.webp", "baggage": "grigory-bag.webp", "greeting": "Нашёл полезные вещи для склада.", "baggageLine": "Всего пара банок и куртка.", "explanation": "Личность совпадает, пропуск действует. Но радиация 63 выше нормы, а под курткой видны рычаг и кольцо гранаты.", "outcome": "САНПОСТ: Григорий изолирован; охрана изъяла гранату.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "САНПОСТ: Григорий изолирован; охрана изъяла гранату."},
    {"id": "roza", "name": "РОЗА БЕЛЛ", "profession": "ПРАЧКА", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 22, "identityMatches": true, "weapon": false, "portrait": "roza.webp", "idPhoto": "roza-id.webp", "baggage": "roza-bag.webp", "greeting": "Несу чистую одежду в жилой сектор.", "baggageLine": "Вещей много, но всё после стирки.", "explanation": "Фото совпадает, пропуск действует, радиация 22. Полная сумка содержит одежду и принадлежности для стирки, оружия нет.", "outcome": "ЖИЛОЙ СЕКТОР: Роза доставила чистую одежду.", "admittedOutcome": "ЖИЛОЙ СЕКТОР: Роза доставила чистую одежду.", "rejectedOutcome": "ДИСПЕТЧЕР: Посетитель с действующим допуском задержан. Работа сектора нарушена."},
    {"id": "daniel", "name": "ДАНИЭЛЬ РИД", "profession": "САНИТАР", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 16, "identityMatches": false, "weapon": true, "portrait": "daniel.webp", "idPhoto": "daniel-id.webp", "baggage": "daniel-bag.webp", "greeting": "Доставка для медблока. Не задерживайте.", "baggageLine": "Медицинские пакеты. Очень нужные.", "explanation": "В пропуске другой человек: пожилой светлокожий мужчина с прямыми седыми волосами. Между медпакетами также видны ствол и скоба пистолета.", "outcome": "ОХРАНА: Чужой пропуск и оружие изъяты на внешнем посту.", "admittedOutcome": "ОХРАНА: Посетитель допущен с нарушением. Безопасность шлюза под угрозой.", "rejectedOutcome": "ОХРАНА: Чужой пропуск и оружие изъяты на внешнем посту."},
    {"id": "elsa", "name": "ЭЛЬЗА МАРШ", "profession": "АРХИВИСТ", "issued": "12.10.2287", "expires": "30.10.2287", "radiation": 38, "identityMatches": true, "weapon": false, "portrait": "elsa.webp", "idPhoto": "elsa-id.webp", "baggage": "elsa-bag.webp", "greeting": "Меня ждут в архиве. Принесла книги.", "baggageLine": "Книги, карандаши и футляр для очков.", "explanation": "Личность совпадает, пропуск действует, радиация 38. На старом фото нет очков — это допустимо. В сумке нет оружия.", "outcome": "АРХИВ: Эльза вернула книги и приступила к работе.", "admittedOutcome": "АРХИВ: Эльза вернула книги и приступила к работе.", "rejectedOutcome": "ДИСПЕТЧЕР: Посетитель с действующим допуском задержан. Работа сектора нарушена."}
  ];
  function parseDate(value) { const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value); if (!parts) return NaN; const d = new Date(Date.UTC(+parts[3], +parts[2] - 1, +parts[1])); return d.getUTCDate() === +parts[1] && d.getUTCMonth() === +parts[2] - 1 ? +d : NaN; }
  function reasons(visitor, today = date) {
    const result = [];
    if (!visitor.identityMatches) result.push('Чужой пропуск');
    const now = parseDate(today), from = parseDate(visitor.issued), until = parseDate(visitor.expires);
    if (!Number.isFinite(now) || !Number.isFinite(from) || !Number.isFinite(until) || now < from || now > until) result.push('Пропуск не действует');
    if (visitor.weapon) result.push('Оружие в багаже');
    if (!Number.isFinite(visitor.radiation) || visitor.radiation > 40 || visitor.radiation < 0) result.push('Радиация выше нормы');
    return result;
  }
  const requests = {
    neutral: [
      'Можно уже пройти? Меня ждут внутри.',
      'Пожалуйста, откройте шлюз, когда закончите.',
      'Все документы перед вами. Пропустите меня?',
      'Скажите, можно входить? Я здесь давно стою.',
      'Может, уже впустите? За дверью холодно.',
      'Проверьте спокойно, только пустите меня сегодня.',
      'Мне нужно внутрь. Что ещё показать?',
      'Я подожду, но прошу не затягивать с допуском.'
    ],
    aggressive: [
      'Хватит тянуть! Открывайте шлюз!',
      'Сколько можно проверять? Впустите уже!',
      'Вы там уснули? Мне нужно внутрь!',
      'Документы перед вами. Открывайте дверь!',
      'Я не собираюсь стоять здесь весь день. Пустите!',
      'Заканчивайте эту проверку и впускайте меня!'
    ],
    flattering: [
      'Сразу видно опытного инспектора. Вы ведь меня пустите?',
      'У вас такой внимательный взгляд. Разрешите пройти?',
      'Говорят, вы лучший на этом посту. Надеюсь на ваш допуск.',
      'Как приятно встретить понимающего человека. Откроете?',
      'Вы здесь самый разумный. Можно мне внутрь?',
      'Убежищу повезло с вами. Сделайте доброе дело, впустите.'
    ]
  };
  function requestTypes(visitor) { return ['neutral', reasons(visitor).length === 0 ? 'aggressive' : 'flattering']; }
  function pickRequest(visitor, previous = '', random = Math.random) {
    const types = requestTypes(visitor);
    const type = types[Math.min(types.length - 1, Math.floor(random() * types.length))];
    const pool = requests[type].filter(text => text !== previous);
    return { type, text: pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] };
  }
  function createShift(random = Math.random) {
    const shift = visitors.slice();
    for (let i = shift.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shift[i], shift[j]] = [shift[j], shift[i]];
    }
    return shift;
  }
  const api = { date, visitors, createShift, reasons, requests, requestTypes, pickRequest, canAdmit: visitor => reasons(visitor).length === 0 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PassScenarios = api;
})(typeof window !== 'undefined' ? window : globalThis);
