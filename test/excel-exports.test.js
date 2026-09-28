const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { participantsWorkbookBuffer, routesWorkbookBuffer } = require('../lib/excel-exports');

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

test('экспорт участников создаёт Excel со строкой на каждого ребёнка', async () => {
  const buffer = await participantsWorkbookBuffer([
    {
      childName: 'Алиса', age: 8, tower: 'Вена', floor: 5, apartmentCode: '51',
      familyCode: 'ABC123', groupName: 'Летучие мыши', walking: 'Да',
      hostingType: 'Раздаёт конфеты', status: 'Активна',
    },
    {
      childName: 'Миша', age: 10, tower: 'Вена', floor: 5, apartmentCode: '51',
      familyCode: 'ABC123', groupName: 'Летучие мыши', walking: 'Да',
      hostingType: 'Раздаёт конфеты', status: 'Активна',
    },
  ]);
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet('Участники');
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell('A2').value, 'Алиса');
  assert.equal(sheet.getCell('C3').value, 'Вена');
  assert.equal(sheet.getCell('E3').value, '51');
  assert.equal(sheet.autoFilter, 'A1:J1');
});

test('экспорт маршрутов сохраняет этапы, адрес и время', async () => {
  const buffer = await routesWorkbookBuffer([{
    groupName: 'Привидения', childCount: 6,
    memberFamilies: 'Вена, эт. 5, кв. 51', memberChildren: 'Алиса, 8; Миша, 10',
    stage: 1, stopType: 'Квест', displayName: 'Квартира', tower: 'Вена',
    floor: 7, apartmentCode: '72', arrivalMin: 12, departureMin: 32,
  }]);
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet('Маршруты');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, 'Привидения');
  assert.equal(sheet.getCell('E2').value, 1);
  assert.equal(sheet.getCell('J2').value, '72');
  assert.equal(sheet.getCell('L2').value, 32);
});
