const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getParticipantStats } = require('../lib/participant-stats');

function testDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE families (
      id TEXT PRIMARY KEY,
      tower TEXT NOT NULL,
      floor INTEGER NOT NULL,
      apartment_code TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
  `);
  return db;
}

test('счётчик участников исключает отменённые семьи и объединяет варианты номера квартиры', () => {
  const db = testDb();
  const insertFamily = db.prepare('INSERT INTO families (id, tower, floor, apartment_code, cancelled) VALUES (?, ?, ?, ?, ?)');
  insertFamily.run('f1', 'Вена', 22, '2206Г', 0);
  insertFamily.run('f2', ' вена ', 22, '22-06', 0);
  insertFamily.run('f3', 'Вена', 23, '2206', 0);
  insertFamily.run('f4', 'Вена', 24, '2401', 1);
  const insertChild = db.prepare('INSERT INTO children (family_id, name) VALUES (?, ?)');
  insertChild.run('f1', 'Алиса');
  insertChild.run('f2', 'Миша');
  insertChild.run('f3', 'Соня');
  insertChild.run('f4', 'Лёва');

  assert.deepEqual(getParticipantStats(db), { apartmentCount: 2, childCount: 3 });
  db.close();
});
