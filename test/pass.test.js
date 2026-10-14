'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { visitors, canAdmit, reasons } = require('../public/games/pass/scenarios');
test('first shift admits the medic and rejects the armed trader', () => { assert.equal(canAdmit(visitors[0]), true); assert.equal(canAdmit(visitors[1]), false); assert.deepEqual(reasons(visitors[1]), ['Оружие в багаже']); });
test('radiation limit includes 40 but excludes 41', () => { assert.equal(canAdmit({...visitors[0], radiation:40}), true); assert.equal(canAdmit({...visitors[0], radiation:41}), false); });
test('pass is valid on its issue and expiry dates', () => { assert.deepEqual(reasons({...visitors[0], issued:'24.10.2287', expires:'24.10.2287'}), []); assert.deepEqual(reasons({...visitors[0], issued:'25.10.2287'}), ['Пропуск не действует']); assert.deepEqual(reasons({...visitors[0], expires:'23.10.2287'}), ['Пропуск не действует']); });
test('identity mismatch and invalid documents prevent admission', () => { assert.equal(canAdmit({...visitors[0], identityMatches:false}), false); assert.equal(canAdmit({...visitors[0], expires:'31.02.2287'}), false); });
test('all twelve visitors have complete scenarios and dedicated images', () => {
  assert.equal(visitors.length, 12);
  assert.equal(new Set(visitors.map(v => v.id)).size, 12);
  for (const visitor of visitors) {
    for (const field of ['portrait','idPhoto','baggage','greeting','baggageLine','explanation','outcome']) assert.ok(visitor[field], visitor.id + ': ' + field);
    assert.notEqual(visitor.portrait, visitor.idPhoto);
  }
});
test('speech pools follow admission eligibility and avoid consecutive duplicates', () => {
  const {requestTypes, pickRequest, requests} = require('../public/games/pass/scenarios');
  for (const visitor of visitors) {
    assert.deepEqual(requestTypes(visitor), ['neutral', canAdmit(visitor) ? 'aggressive' : 'flattering']);
    for (const value of [0, .49, .5, .99]) {
      const line = pickRequest(visitor, '', () => value);
      assert.ok(requestTypes(visitor).includes(line.type));
      assert.ok(requests[line.type].includes(line.text));
      assert.notEqual(pickRequest(visitor, line.text, () => value).text, line.text);
    }
  }
  for (const pool of Object.values(requests)) assert.ok(pool.length >= 5);
});
test('new shifts shuffle all visitors without omissions or mutating the scenario catalog', () => {
  const {createShift} = require('../public/games/pass/scenarios');
  const original = visitors.map(v => v.id);
  const shift = createShift(() => 0);
  assert.deepEqual(shift.map(v => v.id).sort(), original.slice().sort());
  assert.notDeepEqual(shift.map(v => v.id), original);
  assert.deepEqual(visitors.map(v => v.id), original);
  assert.notEqual(createShift(), createShift());
});
