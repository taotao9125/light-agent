import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import AppError from '../../errors/appError.js';
const router = express.Router();

router.get('/', auth, wrap(async function(req, res, next) {

  // 不要查pwd
  const [err, rows] = await to(executeQuery('SELECT id, username, role, create_at FROM `users` WHERE id = ?', [req.uid]));
  if (err) throw new AppError(err)
  if (!rows.length) throw new AppError('未查到me信息');
  return rows[0];
}));

export default router;