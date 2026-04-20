import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import AppError from '../../errors/appError.js';
const router = express.Router();

/* GET users listing. */
router.get('/', auth, wrap(async function(req, res, next) {
  const [err, result] = await to(executeQuery('SELECT * FROM `meeting_rooms`'))

  if (err) throw new AppError(err);
  return result;
}));



router.get('/:id', auth, wrap(async function(req, res, next){
  const id = req.params.id;
  const [err, rows] = await to(executeQuery(
    'SELECT * from `meeting_rooms` where id=?',
    [id]
  ))
  
  if (err) throw new AppError(err);

  return rows[0];
}))

export default router;