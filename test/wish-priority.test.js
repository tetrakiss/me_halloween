const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { db } = require('../db');
const { setFamilyWish, assertWishGroups } = require('../lib/wish-links');
const { buildGroups } = require('../lib/grouping-routing');
const router = require('../routes/admin');
const recompute = router.stack.find((entry) => entry.route?.path === '/recompute').route.stack[0].handle;

test('editing the middle of a wish chain preserves incoming links and full recompute keeps everyone together', async () => {
  for (let i = 0; i < 9; i += 1) {
    db.prepare('INSERT INTO families(id,family_code,tower,floor,apartment_code,candy_brought,walking,manual_group_id,created_at) VALUES (?,?,?,1,?,1,1,?,0)')
      .run(`f${i}`, `code${i}`, i % 2 ? 'Вена' : 'Стокгольм', `${i}`, i % 2 ? 'manual_a' : 'manual_b');
    db.prepare('INSERT INTO children(family_id,name,age) VALUES (?,?,?)').run(`f${i}`, `Child ${i}`, i % 2 ? 3 : 15);
  }
  setFamilyWish(db, 'f0', 'f1');
  setFamilyWish(db, 'f2', 'f1');
  setFamilyWish(db, 'f1', 'f3');
  for (let i = 3; i < 7; i += 1) setFamilyWish(db, `f${i}`, `f${i + 1}`);
  // Saving the middle family's unchanged form used to delete both incoming links.
  setFamilyWish(db, 'f1', 'f3');
  const links = () => db.prepare('SELECT family_a AS a,family_b AS b FROM wish_links').all();
  assert.equal(links().length, 7);
  // Clearing its own choice must still preserve wishes made by other families.
  setFamilyWish(db, 'f1', null);
  assert.ok(links().some(({ a, b }) => a === 'f0' && b === 'f1'));
  assert.ok(links().some(({ a, b }) => a === 'f1' && b === 'f2'));
  setFamilyWish(db, 'f1', 'f3');
  let body;
  const response = { json(value) { body = value; }, status() { return this; } };
  await recompute({}, response, (error) => { throw error; });
  assert.equal(body.ok, true);
  const groupIds = db.prepare("SELECT DISTINCT group_id FROM group_members WHERE family_id != 'f8'").all();
  assert.equal(groupIds.length, 1);
  assert.equal(db.prepare('SELECT child_count FROM groups WHERE id = ?').get(groupIds[0].group_id).child_count, 8);
  const snapshot = db.prepare('SELECT group_id,family_id FROM group_members ORDER BY family_id').all();
  await recompute({}, response, (error) => { throw error; });
  assert.deepEqual(db.prepare('SELECT group_id,family_id FROM group_members ORDER BY family_id').all(), snapshot);
});

test('wish invariant rejects split assignments before overwriting groups', () => {
  assert.throws(() => assertWishGroups([{ id: 'a', memberFamilyIds: ['1'] }, { id: 'b', memberFamilyIds: ['2'] }], [{ a: '1', b: '2' }]), /пожелание/);
});

test('full grouping keeps eligible wish components indivisible regardless of input order', () => {
  for (let shift = 0; shift < 15; shift += 1) {
    const families = Array.from({ length: 15 }, (_, i) => ({ id: `w${i}`, tower: i % 2 ? 'A' : 'B', children: [{ age: i + 2 }], walking: true, candyBrought: true, manualGroupId: i % 3 ? 'manual' : null }));
    const links = Array.from({ length: 8 }, (_, i) => ({ a: `w${i}`, b: `w${i + 1}` }));
    const groups = buildGroups([...families.slice(shift), ...families.slice(0, shift)], links);
    assertWishGroups(groups, links);
    const group = groups.find((g) => g.memberFamilyIds.includes('w0'));
    assert.equal(group.childCount, 9);
  }
});


test('eligible families remain together across a paused or ineligible intermediary', () => {
  for (const excluded of [{ groupingPaused: true, candyBrought: true }, { candyBrought: false }, { cancelled: true }]) {
    const families = [
      { id: 'left', tower: 'A', walking: true, candyBrought: true, children: [{ age: 3 }], manualGroupId: 'left-group' },
      { id: 'middle', tower: 'B', walking: true, children: [{ age: 8 }], ...excluded },
      { id: 'right', tower: 'C', walking: true, candyBrought: true, children: [{ age: 16 }], manualGroupId: 'right-group' },
    ];
    const wishes = [{ a: 'left', b: 'middle' }, { a: 'middle', b: 'right' }];
    const groups = buildGroups(families, wishes);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].memberFamilyIds.sort(), ['left', 'right']);
    assertWishGroups(groups, wishes);
  }
});

test('wish chains form first and independent families fill their remaining capacity', () => {
  const family = (id, age, extra = {}) => ({ id, tower: 'A', children: [{ age }, { age }], walking: true, candyBrought: true, ...extra });
  const families = [family('a', 4, { manualGroupId: 'chain' }), family('b', 14), family('single', 9, { manualGroupId: 'other' })];
  const groups = buildGroups(families, [{ a: 'a', b: 'b' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].childCount, 6);
  assert.deepEqual(groups[0].memberFamilyIds.sort(), ['a', 'b', 'single']);
});

test('two small chains combine before singles, and oversized chains receive no extra families', () => {
  const families = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, tower: 'A', children: [{ age: 8 }], walking: true, candyBrought: true }));
  const links = [{ a: 's0', b: 's1' }, { a: 's2', b: 's3' }, ...Array.from({ length: 6 }, (_, i) => ({ a: `s${i + 4}`, b: `s${i + 5}` }))];
  const groups = buildGroups(families, links);
  const small = groups.find((g) => g.memberFamilyIds.includes('s0'));
  assert.ok(small.memberFamilyIds.includes('s2'));
  assert.equal(small.childCount, 6);
  const oversized = groups.find((g) => g.memberFamilyIds.includes('s4'));
  assert.equal(oversized.childCount, 7);
  assertWishGroups(groups, links);
  assert.equal(new Set(groups.flatMap((g) => g.memberFamilyIds)).size, families.length);
});
