const express = require('express');
const { readStoredSchedule } = require('../lib/stored-route-schedule');
const router = express.Router();

router.get('/route-schedule', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readStoredSchedule());
});

module.exports = router;
