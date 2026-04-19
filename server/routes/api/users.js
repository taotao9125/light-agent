import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
const router = express.Router();


/* GET users listing. */
router.get('/', async function(req, res, next) {
  const [err, result] = await to(executeQuery('SELECT * FROM `users`'))
  if (err) {
    res.status(500).send({ error: 'Database query failed' });
  }
  res.send(result);
});

export default router;