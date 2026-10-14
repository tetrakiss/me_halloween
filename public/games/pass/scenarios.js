'use strict';
(function(root) {
  const date = '24.10.2287';
  const visitors = [
    { id: 'marta', name: 'МАРТА КЕЙН', profession: 'ВРАЧ', issued: '12.10.2287', expires: '30.10.2287', radiation: 18, identityMatches: true, weapon: false,
      portrait: 'marta.webp', idPhoto: 'marta-id.webp', baggage: 'marta-bag.webp', greeting: 'Меня вызвали к заболевшему смотрителю.', baggageLine: 'Бинты, лекарства, ножницы. Всё для медблока.', explanation: 'Фото совпадает, пропуск действует, радиация 18 из 40. В сумке лекарства и медицинские ножницы — оружия нет.', outcome: 'МЕДБЛОК: Марта прибыла на дежурство. Смотритель получит помощь.', rejectedOutcome: 'МЕДБЛОК: Врач не допущен. Приём пациентов задерживается.' },
    { id: 'nina', name: 'НИНА ВЕЙЛ', profession: 'ТОРГОВКА', issued: '19.10.2287', expires: '29.10.2287', radiation: 24, identityMatches: true, weapon: true,
      portrait: 'nina.webp', idPhoto: 'nina-id.webp', baggage: 'nina-bag.webp', greeting: 'Принесла консервы и батарейки. Меня ждут на складе.', baggageLine: 'Обычный товар. Ткань можете не разворачивать.', explanation: 'Фото совпадает, пропуск действует, радиация 24 из 40. Но под тканью справа лежит пистолет: видны рукоятка и спусковая скоба.', outcome: 'ОХРАНА: Нина отправлена на внешний пост для сдачи оружия.', admittedOutcome: 'ОХРАНА: Вооружённый посетитель прошёл внутрь. Зафиксировано нарушение.' }
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
  const api = { date, visitors, reasons, canAdmit: visitor => reasons(visitor).length === 0 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PassScenarios = api;
})(typeof window !== 'undefined' ? window : globalThis);
