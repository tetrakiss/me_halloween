'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { visitors, canAdmit, reasons } = require('../public/games/pass/scenarios');
test('first shift admits the medic and rejects the armed trader', () => { assert.equal(canAdmit(visitors[0]), true); assert.equal(canAdmit(visitors[1]), false); assert.deepEqual(reasons(visitors[1]), ['Оружие в багаже']); });
test('radiation limit includes 40 but excludes 41', () => { assert.equal(canAdmit({...visitors[0], radiation:40}), true); assert.equal(canAdmit({...visitors[0], radiation:41}), false); });
test('pass is valid on its issue and expiry dates', () => { assert.deepEqual(reasons({...visitors[0], issued:'24.10.2287', expires:'24.10.2287'}), []); assert.deepEqual(reasons({...visitors[0], issued:'25.10.2287'}), ['Пропуск не действует']); assert.deepEqual(reasons({...visitors[0], expires:'23.10.2287'}), ['Пропуск не действует']); });
test('identity mismatch and invalid documents prevent admission', () => { assert.equal(canAdmit({...visitors[0], identityMatches:false}), false); assert.equal(canAdmit({...visitors[0], expires:'31.02.2287'}), false); });
test('all twenty-one visitors have complete scenarios and dedicated images', () => {
  assert.equal(visitors.length, 21);
  assert.equal(new Set(visitors.map(v => v.id)).size, 21);
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
      assert.ok(requests[line.type].concat((visitor.speech && visitor.speech[line.type]) || []).includes(line.text));
      assert.notEqual(pickRequest(visitor, line.text, () => value).text, line.text);
    }
  }
  for (const pool of Object.values(requests)) assert.ok(pool.length >= 5);
});
test('new shifts sample ten unique visitors without mutating the scenario catalog', () => {
  const {createShift} = require('../public/games/pass/scenarios');
  const original = visitors.map(v => v.id);
  const shift = createShift(() => 0);
  assert.equal(shift.length, 10);
  assert.equal(new Set(shift.map(v => v.id)).size, 10);
  assert.ok(shift.every(v => original.includes(v.id)));
  assert.notDeepEqual(shift.map(v => v.id), original);
  assert.deepEqual(visitors.map(v => v.id), original);
  assert.notDeepEqual(createShift(() => 0).map(v => v.id), createShift(() => .99).map(v => v.id));
});

test('three mistakes end the shift immediately, including on the last visitor', () => {
  const {shiftStatus} = require('../public/games/pass/scenarios');
  assert.equal(shiftStatus([{correct:false},{correct:true},{correct:false}]).status, 'running');
  assert.equal(shiftStatus([{correct:false},{correct:false},{correct:false}]).status, 'lost');
  assert.equal(shiftStatus(Array.from({length:10}, (_,i)=>({correct:i>=3}))).status, 'lost');
});
test('completing the queue with zero, one or two errors wins', () => {
  const {shiftStatus} = require('../public/games/pass/scenarios');
  for (const mistakes of [0,1,2]) {
    const result=shiftStatus(Array.from({length:10},(_,i)=>({correct:i>=mistakes})));
    assert.equal(result.status,'won');assert.equal(result.mistakes,mistakes);assert.equal(result.score,10-mistakes);
  }
});
test('unusual appearance alone never rejects the ghoul or radroach', () => {
  for (const [id,allowed] of [['ghoul',true],['robot',false],['roach',true],['deathclaw',false]]) {
    assert.equal(canAdmit(visitors.find(v=>v.id===id)),allowed,id);
  }
});
test('expired passes reject otherwise safe visitors and use flattering speech', () => {
  const {requestTypes}=require('../public/games/pass/scenarios');
  for(const id of ['roza','elsa','skeleton']) {
    const v=visitors.find(v=>v.id===id);
    assert.deepEqual(reasons(v),['Пропуск не действует']);
    assert.equal(canAdmit(v),false);assert.deepEqual(requestTypes(v),['neutral','flattering']);
  }
});
test('new unusual visitor cases have the intended admission decisions', () => {
  for(const [id,allowed]of [['mutant',true],['brahmin',true],['skeleton',false],['robodog',false],['roachman',false]])assert.equal(canAdmit(visitors.find(v=>v.id===id)),allowed,id);
});
