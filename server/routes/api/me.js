import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
const router = express.Router();


router.get('/', auth, wrap(async function(req, res, next) {
  // 不要查pwd
  const [err, rows] = await to(executeQuery('SELECT id, username, create_at FROM `users` WHERE id = ?', [req.uid]));
  if (!rows.length) {
    res.send({ error: '未查到me信息' });
    return;
  }
  return rows[0];
}));

export default router;