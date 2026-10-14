'use strict';

const { randomUUID, randomInt } = require('node:crypto');
const WIRES = ['red', 'yellow', 'blue', 'green', 'white'];
const COSTS = [0, 20, 30];
const SETS = [
  { answer: 'blue', clues: [
    ['Нужный провод находится левее зелёного.', [0, 1, 2]],
    ['Нужный провод не красный и не белый.', [1, 2, 3]],
    ['Нужный провод находится правее жёлтого.', [2, 3, 4]],
    ['Нужный провод — третий или пятый слева.', [2, 4]],
    ['Нужный провод — красный или синий.', [0, 2]],
  ] },
  { answer: 'yellow', clues: [
    ['Нужный провод находится левее зелёного.', [0, 1, 2]],
    ['Нужный провод не красный и не белый.', [1, 2, 3]],
    ['Нужный провод — жёлтый, зелёный или белый.', [1, 3, 4]],
    ['Нужный провод — второй или пятый слева.', [1, 4]],
    ['Нужный провод находится левее синего.', [0, 1]],
  ] },
  { answer: 'green', clues: [
    ['Нужный провод — красный, жёлтый или зелёный.', [0, 1, 3]],
    ['Нужный провод не красный и не белый.', [1, 2, 3]],
    ['Нужный провод находится правее жёлтого.', [2, 3, 4]],
    ['Нужный провод находится правее синего.', [3, 4]],
    ['Нужный провод — первый или четвёртый слева.', [0, 3]],
  ] },
];

// No participant data is stored. A round token grants access only to that round.
class MegatonnaGame {
  constructor({ now = Date.now, maxRounds = 2000 } = {}) {
    this.now = now;
    this.maxRounds = maxRounds;
    this.rounds = new Map();
  }

  prune() {
    const threshold = this.now() - 2 * 60 * 60 * 1000;
    for (const [id, round] of this.rounds) {
      if (round.touchedAt < threshold) this.rounds.delete(id);
    }
  }

  create(set = randomInt(1, 4), stage = 1) {
    if (!Number.isInteger(set) || set < 1 || set > SETS.length) throw new Error('INVALID_SET');
    this.prune();
    if (this.rounds.size >= this.maxRounds) throw new Error('ROUND_LIMIT');
    const time = this.now();
    const round = { id: randomUUID(), set, stage, maxClues: 4 - stage, maxMistakes: 4 - stage,
      status: 'running', remainingMs: 60000,
      anchor: time, touchedAt: time, opened: [], cut: [], mistakes: 0, reward: 0 };
    this.rounds.set(round.id, round);
    return this.view(round);
  }

  next(id) {
    const previous = this.get(id);
    // Retrying a successful request cannot advance twice or reroll the set.
    if (previous.nextRoundId) return this.view(this.get(previous.nextRoundId));
    if (!['won', 'lost'].includes(previous.status)) throw new Error('ROUND_NOT_FINISHED');
    const next = previous.status === 'lost'
      ? this.create(previous.set, previous.stage)
      : previous.stage < 3 ? this.create(previous.set % 3 + 1, previous.stage + 1) : this.create();
    previous.nextRoundId = next.id;
    return next;
  }

  get(id) {
    const round = this.rounds.get(id);
    if (!round || this.now() - round.touchedAt > 2 * 60 * 60 * 1000) {
      this.rounds.delete(id);
      throw new Error('ROUND_NOT_FOUND');
    }
    this.tick(round);
    round.touchedAt = this.now();
    return round;
  }

  tick(round) {
    if (round.status !== 'running') return;
    const time = this.now();
    round.remainingMs = Math.max(0, round.remainingMs - Math.max(0, time - round.anchor));
    round.anchor = time;
    if (!round.remainingMs) { round.status = 'lost'; round.reason = 'time'; }
  }

  view(round) {
    this.tick(round);
    return { id: round.id, set: round.set, stage: round.stage, maxClues: round.maxClues,
      maxMistakes: round.maxMistakes,
      seriesComplete: round.status === 'won' && round.stage === 3,
      status: round.status, remainingMs: round.remainingMs,
      serverTime: this.now(), opened: [...round.opened], cut: [...round.cut], mistakes: round.mistakes,
      reward: round.reward, reason: round.reason || null,
      nextClueCost: round.opened.length >= round.maxClues ? null : COSTS[round.opened.length],
      clues: round.opened.map(index => ({ index, text: SETS[round.set - 1].clues[index][0] })) };
  }

  action(id, action, value, confirmed = false) {
    const round = this.get(id);
    if (action === 'open') {
      if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error('INVALID_CLUE');
      if (round.opened.includes(value)) return this.view(round);
      if (round.status !== 'running') throw new Error('ROUND_NOT_RUNNING');
      if (round.opened.length >= round.maxClues) throw new Error('CLUE_LIMIT');
      const cost = COSTS[round.opened.length];
      if (cost && confirmed !== true) throw new Error('CONFIRM_COST');
      round.opened.push(value);
      round.remainingMs = Math.max(0, round.remainingMs - cost * 1000);
      this.tick(round);
    } else if (action === 'cut') {
      if (!WIRES.includes(value)) throw new Error('INVALID_WIRE');
      // Duplicate requests cannot count the same wire as another mistake.
      if (round.cut.includes(value)) return this.view(round);
      if (round.status !== 'running') throw new Error('ROUND_NOT_RUNNING');
      round.cut.push(value);
      if (value === SETS[round.set - 1].answer) {
        round.status = 'won';
        round.reward = round.mistakes === 0 ? 2 : 1;
      } else if (++round.mistakes >= round.maxMistakes) {
        round.status = 'lost'; round.reason = 'mistakes';
      }
    } else if (action === 'pause') {
      if (round.status === 'running') round.status = 'paused';
    } else if (action === 'resume') {
      if (round.status === 'paused') { round.status = 'running'; round.anchor = this.now(); }
    } else throw new Error('INVALID_ACTION');
    return this.view(round);
  }
}

module.exports = { MegatonnaGame, SETS, WIRES, COSTS };
