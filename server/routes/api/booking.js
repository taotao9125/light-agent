import express from 'express';
import executeQuery, {createPool} from '../../db.js';
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

  const pool = createPool();
  const trans = await pool.getConnection();



  try {
    await trans.beginTransaction();
    const [rows]  = await trans.execute(
    `
      SELECT id
      FROM bookings
      WHERE room_id=?
        AND status=1
        AND ? < end_time
        AND ? > start_time
      FOR UPDATE
    `,
   [room_id, s, e]);

  if (rows.length > 0) throw new AppError('时间段冲突');

   console.log('查完了，3秒后插入', new Date())
   await new Promise(resolve => setTimeout(resolve, 3000));
   console.log('插入', new Date())
    
   await to(trans.execute(
    'INSERT INTO `bookings` (user_id, room_id, start_time, end_time) VALUES (?, ?, ?, ?)',
    [uid, room_id, s,e]
  ))

   await trans.commit();

   return null;

  } catch (e) {
     console.log('进入 catch ')
     await trans.rollback();
     throw e;
  } finally {
    trans.release();
  }


}));



router.get('/me', auth,wrap(async function(req, res) {
   const uid = req.uid;
   // 这里我选择了我定了哪些会议室，但会议室表中只有user_id, 我如何也将把个人信心也拿到，是不是再
   // 查user表，传userid

   const [err, rows] = await to(executeQuery(
    `
      SELECT
        b.*,
        u.username,
        u.role,
        mr.name,
        mr.location
      FROM bookings b
      JOIN users u
        ON b.user_id = u.id
      JOIN meeting_rooms mr
        on b.room_id = mr.id
      WHERE user_id=?
    `,
   [uid]
  ))
  return rows;
}))

export default router;