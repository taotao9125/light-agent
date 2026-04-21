import express from 'express';
import executeQuery from '../../db.js';
import wrap from '../../lib/wrapRes.js';
import auth from '../../middlewares/auth.js';
import {to} from 'await-to-js';
import dayjs from 'dayjs';
import AppError from '../../errors/appError.js';

const router = express.Router();


/* GET users listing. */
router.post('/', auth, wrap(async function(req, res, next) {
  const {
    room_id,
    start_time,
    end_time
  } = req.body;

  const uid = req.uid;

  if (!room_id) throw new AppError('缺少 room_id');
  if (!start_time) throw new AppError('缺少开始时间');
  if (!end_time) throw new AppError('结束时间');
  if (dayjs(start_time).valueOf() >= dayjs(end_time).valueOf()) throw new AppError('开始时间必须小于结束时间');

  const s = dayjs(start_time).format('YYYY-MM-DD HH:mm:ss');
  const e = dayjs(end_time).format('YYYY-MM-DD HH:mm:ss');

  // 这里需要事务锁住，防止竞态，A，B 同时抢同一个会议室同时间段
  const [rError, rRows] = await to(executeQuery(
    `
      SELECT id
      FROM bookings
      WHERE room_id=?
        AND status=1
        AND ? < end_time
        AND ? > start_time
    `,
   [room_id, s, e]
  ))

  if (rRows.length > 0) throw new AppError('时间段冲突');

 
  await to(executeQuery(
    'INSERT INTO `bookings` (user_id, room_id, start_time, end_time) VALUES (?, ?, ?, ?)',
    [uid, room_id, s,e]
  ))

  return null;
}));

export default router;