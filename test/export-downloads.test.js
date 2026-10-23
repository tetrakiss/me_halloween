const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportDownload, getExportDownload } = require('../lib/export-downloads');

test('временная ссылка содержит случайный токен, отдаёт снимок и истекает через пять минут', () => {
  const buffer = Buffer.from('xlsx snapshot');
  const ticket = createExportDownload(buffer, 'participants.xlsx', 1000);
  const token = ticket.url.split('/').pop();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(getExportDownload('unknown', 1000), null);
  assert.equal(getExportDownload(token, 1001).buffer, buffer);
  assert.equal(getExportDownload(token, ticket.expiresAt - 1).filename, 'participants.xlsx');
  assert.equal(getExportDownload(token, ticket.expiresAt), null);
});

test('ссылка допускает повторное чтение менеджером загрузок, хранилище ограничено', () => {
  const first = createExportDownload(Buffer.from('first'), 'first.xlsx', 2000);
  const token = first.url.split('/').pop();
  assert.ok(getExportDownload(token, 2001));
  assert.ok(getExportDownload(token, 2002));
  for (let index = 0; index < 20; index += 1) createExportDownload(Buffer.from('new'), 'new.xlsx', 2003);
  assert.equal(getExportDownload(token, 2004), null);
});
