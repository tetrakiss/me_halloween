'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { visitors, canAdmit, reasons } = require('../public/games/pass/scenarios');
test('first shift admits the medic and rejects the armed trader', () => { assert.equal(canAdmit(visitors[0]), true); assert.equal(canAdmit(visitors[1]), false); assert.deepEqual(reasons(visitors[1]), ['Оружие в багаже']); });
test('radiation limit includes 40 but excludes 41', () => { assert.equal(canAdmit({...visitors[0], radiation:40}), true); assert.equal(canAdmit({...visitors[0], radiation:41}), false); });
test('pass is valid on its issue and expiry dates', () => { assert.deepEqual(reasons({...visitors[0], issued:'24.10.2287', expires:'24.10.2287'}), []); assert.deepEqual(reasons({...visitors[0], issued:'25.10.2287'}), ['Пропуск не действует']); assert.deepEqual(reasons({...visitors[0], expires:'23.10.2287'}), ['Пропуск не действует']); });
test('identity mismatch and invalid documents prevent admission', () => { assert.equal(canAdmit({...visitors[0], identityMatches:false}), false); assert.equal(canAdmit({...visitors[0], expires:'31.02.2287'}), false); });
