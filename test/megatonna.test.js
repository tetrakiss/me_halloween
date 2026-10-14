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
  assert.equal(game.action(round.id, 'open', 4).remainingMs, 60000);
  assert.throws(() => game.action(round.id, 'open', 0), /CONFIRM_COST/);
  assert.equal(game.action(round.id, 'open', 0, true).remainingMs, 40000);
  assert.equal(game.action(round.id, 'open', 4).remainingMs, 40000);
  assert.equal(game.action(round.id, 'open', 2, true).remainingMs, 10000);
  assert.throws(() => game.action(round.id, 'open', 1, true), /CLUE_LIMIT/);
  assert.equal(game.view(game.get(round.id)).remainingMs, 10000);
});

test('wins advance cyclically through three stages; losses repeat the same stage and set', () => {
  const game = new MegatonnaGame({ now: () => 0 });
  let round = game.create(2);
  assert.throws(() => game.next(round.id), /ROUND_NOT_FINISHED/);
  for (const stage of [1, 2, 3]) {
    assert.equal(round.stage, stage);
    assert.equal(round.maxClues, 4 - stage);
    assert.equal(round.set, [2, 3, 1][stage - 1]);
    const priorId = round.id;
    game.action(priorId, 'cut', SETS[round.set - 1].answer);
    const next = game.next(priorId);
    assert.equal(game.next(priorId).id, next.id);
    round = next;
  }
  assert.equal(round.stage, 1);
  assert.ok(round.set >= 1 && round.set <= 3);
  const set = round.set;
  for (const wire of WIRES.filter(wire => wire !== SETS[set - 1].answer).slice(0, 3)) {
    game.action(round.id, 'cut', wire);
  }
  const retry = game.next(round.id);
  assert.equal(retry.set, set);
  assert.equal(retry.stage, 1);
  assert.equal(retry.remainingMs, 60000);
});

test('later rounds enforce two and one clues, while reopened clues remain free', () => {
  const game = new MegatonnaGame({ now: () => 0 });
  let round = game.create(1);
  game.action(round.id, 'cut', 'blue');
  round = game.next(round.id);
  game.action(round.id, 'open', 0);
  game.action(round.id, 'open', 1, true);
  assert.throws(() => game.action(round.id, 'open', 2, true), /CLUE_LIMIT/);
  assert.equal(game.action(round.id, 'open', 0).remainingMs, 40000);
  game.action(round.id, 'cut', 'yellow');
  round = game.next(round.id);
  game.action(round.id, 'open', 4);
  assert.throws(() => game.action(round.id, 'open', 0, true), /CLUE_LIMIT/);
  assert.equal(game.action(round.id, 'open', 4).remainingMs, 60000);
});

test('mistake limits decrease 3/2/1 and retrying preserves the current limit', () => {
  const game = new MegatonnaGame({ now: () => 0 });
  let round = game.create(1);
  for (let stage = 1; stage <= 3; stage++) {
    assert.equal(round.maxMistakes, 4 - stage);
    const wrong = WIRES.filter(wire => wire !== SETS[round.set - 1].answer);
    for (let i = 0; i < round.maxMistakes; i++) {
      const result = game.action(round.id, 'cut', wrong[i]);
      assert.equal(result.status, i === round.maxMistakes - 1 ? 'lost' : 'running');
      assert.equal(game.action(round.id, 'cut', wrong[i]).mistakes, i + 1);
    }
    const retry = game.next(round.id);
    assert.equal(retry.stage, stage);
    assert.equal(retry.maxMistakes, 4 - stage);
    assert.equal(retry.mistakes, 0);
    game.action(retry.id, 'cut', SETS[retry.set - 1].answer);
    round = game.next(retry.id);
  }
});

test('server clock expires rounds and pausing freezes remaining time', () => {
  let now = 0;
  const game = new MegatonnaGame({ now: () => now });
  const round = game.create();
  now = 10000;
  assert.equal(game.action(round.id, 'pause').remainingMs, 50000);
  now = 600000;
  assert.equal(game.view(game.get(round.id)).remainingMs, 50000);
  game.action(round.id, 'resume');
  now += 50000;
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
  now = 55000;
  const result = game.action(round.id, 'open', 1, true);
  assert.equal(result.status, 'lost');
  assert.equal(result.remainingMs, 0);
});
