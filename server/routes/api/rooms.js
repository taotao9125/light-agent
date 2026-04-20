import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
const router = express.Router();

/* GET users listing. */
router.get('/', auth,  wrap(async function(req, res, next) {
  const [err, result] = await to(executeQuery('SELECT * FROM `meeting_rooms`'))
  if (err) {
    res.status(500).send({ error: 'Database query failed' });
  }
  return result;
}));

export default router;