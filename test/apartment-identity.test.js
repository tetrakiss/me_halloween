const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { apartmentNumberKey, findApartmentConflict } = require('../lib/apartment-identity');

function testDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE families (
    id TEXT PRIMARY KEY,
    tower TEXT NOT NULL,
    floor INTEGER NOT NULL,
    apartment_code TEXT NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0
  )`);
  return db;
}

test('номер квартиры сравнивается только по цифрам', () => {
  assert.equal(apartmentNumberKey(' 22 06-Г '), '2206');
  assert.equal(apartmentNumberKey('2206'), '2206');
  assert.equal(apartmentNumberKey('кв. 2206 / г'), '2206');
});

test('не позволяет добавить номер без буквы поверх номера с буквой', () => {
  const db = testDb();
  db.prepare('INSERT INTO families VALUES (?, ?, ?, ?, 0)').run('family-1', 'Вена', 22, '2206Г');

  const conflict = findApartmentConflict(db, {
    tower: 'Вена', floor: 22, apartmentCode: ' 2206 ',
  });

  assert.equal(conflict.id, 'family-1');
  db.close();
});

test('не позволяет добавить номер с буквой поверх номера без буквы', () => {
  const db = testDb();
  db.prepare('INSERT INTO families VALUES (?, ?, ?, ?, 0)').run('family-1', 'Вена', 22, '2206');

  const conflict = findApartmentConflict(db, {
    tower: ' ВЕНА ', floor: 22, apartmentCode: '22-06г',
  });

  assert.equal(conflict.id, 'family-1');
  db.close();
});

test('другой этаж, другая башня, отменённая и текущая семья не конфликтуют', () => {
  const db = testDb();
  const insert = db.prepare('INSERT INTO families VALUES (?, ?, ?, ?, ?)');
  insert.run('family-1', 'Вена', 22, '2206Г', 0);
  insert.run('family-2', 'Вена', 22, '3301А', 1);

  assert.equal(findApartmentConflict(db, { tower: 'Вена', floor: 23, apartmentCode: '2206Г' }), null);
  assert.equal(findApartmentConflict(db, { tower: 'Стокгольм', floor: 22, apartmentCode: '2206Г' }), null);
  assert.equal(findApartmentConflict(db, { tower: 'Вена', floor: 22, apartmentCode: '3301' }), null);
  assert.equal(findApartmentConflict(db, { tower: 'Вена', floor: 22, apartmentCode: '2206', excludeFamilyId: 'family-1' }), null);
  db.close();
});
