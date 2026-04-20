import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
const router = express.Router();

/* GET users listing. */
router.get('/', auth,  async function(req, res, next) {
  const [err, result] = await to(executeQuery('SELECT * FROM `meeting_rooms`'))
  if (err) {
    res.status(500).send({ error: 'Database query failed' });
  }
  res.send(result);
});

export default router;