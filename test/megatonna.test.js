const test = require('node:test');
const assert = require('node:assert/strict');
const { MegatonnaGame, SETS, WIRES } = require('../lib/megatonna');

test('any three dossiers uniquely identify the correct wire in every set', () => {
  for (const set of SETS) {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++) {
      const candidates = set.clues[a][1].filter(i => set.clues[b][1].includes(i) && set.clues[c][1].includes(i));
      assert.deepEqual(candidates.map(i => WIRES[i]), [set.answer]);
    }
  }
});

test('opening order controls cost; repeated readings and rejected confirmation are free', () => {
  const game = new MegatonnaGame({ now: () => 1000 });
  const round = game.create();
  assert.equal(game.action(round.id, 'open', 4).remainingMs, 180000);
  assert.throws(() => game.action(round.id, 'open', 0), /CONFIRM_COST/);
  assert.equal(game.action(round.id, 'open', 0, true).remainingMs, 170000);
  assert.equal(game.action(round.id, 'open', 4).remainingMs, 170000);
  assert.equal(game.action(round.id, 'open', 2, true).remainingMs, 155000);
  assert.equal(game.action(round.id, 'open', 1, true).remainingMs, 135000);
  assert.equal(game.action(round.id, 'open', 3, true).remainingMs, 110000);
});

test('server clock expires rounds and pausing freezes remaining time', () => {
  let now = 0;
  const game = new MegatonnaGame({ now: () => now });
  const round = game.create();
  now = 10000;
  assert.equal(game.action(round.id, 'pause').remainingMs, 170000);
  now = 600000;
  assert.equal(game.view(game.get(round.id)).remainingMs, 170000);
  game.action(round.id, 'resume');
  now += 170000;
  assert.equal(game.view(game.get(round.id)).status, 'lost');
  assert.throws(() => game.action(round.id, 'cut', 'blue'), /ROUND_NOT_RUNNING/);
});

test('three distinct mistakes lose; repeated click is idempotent; rewards reflect mistakes', () => {
  const game = new MegatonnaGame();
  const round = game.create(1);
  game.action(round.id, 'cut', 'red');
  assert.equal(game.action(round.id, 'cut', 'red').mistakes, 1);
  game.action(round.id, 'cut', 'yellow');
  assert.equal(game.action(round.id, 'cut', 'white').status, 'lost');
  for (let set = 1; set <= 3; set++) {
    const clean = game.create(set);
    assert.equal(game.action(clean.id, 'cut', SETS[set - 1].answer).reward, 2);
    const messy = game.create(set);
    game.action(messy.id, 'cut', 'red');
    assert.equal(game.action(messy.id, 'cut', SETS[set - 1].answer).reward, 1);
  }
});

test('dossier penalty can exhaust time and answers are not exposed in round responses', () => {
  let now = 0;
  const game = new MegatonnaGame({ now: () => now });
  const round = game.create();
  assert.equal(Object.hasOwn(round, 'answer'), false);
  assert.deepEqual(round.clues, []);
  game.action(round.id, 'open', 0);
  now = 175000;
  const result = game.action(round.id, 'open', 1, true);
  assert.equal(result.status, 'lost');
  assert.equal(result.remainingMs, 0);
});
