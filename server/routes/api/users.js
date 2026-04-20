import express from 'express';
import executeQuery from '../../db.js';
import wrap from '../../lib/wrapRes.js';
import auth  from '../../middlewares/auth.js';
import AppError from '../../errors/appError.js';
import {to} from 'await-to-js';
const router = express.Router();


router.get('/', auth, wrap(async function(req, res, next) {
  const [err, result] = await to(executeQuery('SELECT `username`, `role` FROM `users`'))
  if (err) throw new AppError(err);
  return result;
}));

export default router;