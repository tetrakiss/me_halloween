'use strict';
const express = require('express');
const { MegatonnaGame } = require('../lib/megatonna');

function createGameRouter(game = new MegatonnaGame()) {
  const router = express.Router();
  const buckets = new Map();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const now = Date.now();
    if (buckets.size > 4000) {
      for (const [key, bucket] of buckets) if (now - bucket.start > 60000) buckets.delete(key);
    }
    const key = req.ip;
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > 60000) bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
    if (++bucket.count > 240) return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
    next();
  });
  const handler = fn => (req, res) => {
    try { res.json(fn(req)); } catch (error) {
      const status = error.message === 'ROUND_NOT_FOUND' ? 404 : error.message === 'ROUND_LIMIT' ? 503 : 400;
      res.status(status).json({ error: error.message });
    }
  };
  router.post('/rounds', handler(req => req.body.previousId
    ? game.next(req.body.previousId) : game.create()));
  router.get('/rounds/:id', handler(req => game.view(game.get(req.params.id))));
  router.post('/rounds/:id/actions', handler(req => game.action(
    req.params.id, req.body.action, req.body.value, req.body.confirmed
  )));
  return router;
}
module.exports = { createGameRouter };
