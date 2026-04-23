import express from 'express';
import executeQuery, {createPool} from '../../db.js';
import wrap from '../../lib/wrapRes.js';
import auth from '../../middlewares/auth.js';
import {to} from 'await-to-js';
import dayjs from 'dayjs';
import AppError from '../../errors/appError.js';

const router = express.Router();

/**
 * booking admin/user
 * booking/create 创建
 * booking/:id  admin/user
 * booking/:id/cancel admin/user
 * booking/:id/review admin
 */

const bookingStatus = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  CANCELLED: 3
}

// 现在我的数据库里 status 字段都是1了，因为之前没加审批，默认就是可用了。 如何批量改数据

/* GET users listing. */
router.post('/create', auth, wrap(async function(req, res, next) {
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
    'INSERT INTO `bookings` (user_id, room_id, start_time, end_time, status) VALUES (?, ?, ?, ?, ?)',
    [uid, room_id, s,e, bookingStatus.PENDING]
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




router.get('/', auth,wrap(async function(req, res) {
   const isAdmin = req.role === 'admin';
   const uid = req.uid;
   // 这里我选择了我定了哪些会议室，但会议室表中只有user_id, 我如何也将把个人信心也拿到，是不是再
   // 查user表，传user
  const userSql = !isAdmin ? 'WHERE user_id=?' : '';
  const params = !isAdmin ? [uid] : [];
  const sql = `
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
      ${userSql}
      ORDER BY b.start_time ASC
  `

   const rows = await executeQuery(sql, params);


   return rows;
}))


// status 0 -> 1/2
router.patch('/:id/review', auth, wrap(async function(req, res) {
   const roomId = +req.params.id;
   const uid = +req.uid;
   const isAdmin = req.role === 'admin';

   if (!isAdmin) throw new AppError('非管理员无法操作')


   const review_reason = req.body.review_reason;
   const STATUS = +req.body.review === 1 ? bookingStatus.APPROVED : bookingStatus.REJECTED;

   if (!review_reason) {
    throw new AppError('缺少review备注')
   }


   // 参数要传进去，不要拼接sql
   const r = await executeQuery(
    `
      UPDATE bookings
        SET 
          status=?,
          review_at=?,
          review_remark=?
      WHERE id = ?
        AND status=0
    `,
    [STATUS, dayjs().format('YYYY-MM-DD HH:mm:ss'), review_reason, roomId]
   )

   if (r.affectedRows > 0) {
      return {};
   }

   const rows = await executeQuery(
    `
      SELECT id, user_id
      FROM bookings
      WHERE id = ?
    `,
    [roomId]
  )

   if (rows.length === 0) {
    throw new AppError('预定不存在')
  }


  throw new AppError('review失败')


}));


// status 0/1 -> 3
// 可以多次取消？那最后的取消时间就会变了 ->  AND cancelled_at = NULL
router.patch('/:id/cancel', auth, wrap(async function(req, res) {
  const roomId = +req.params.id;
  const uid = +req.uid;

  const r = await executeQuery(
    `
      UPDATE bookings
      SET 
        status = ?,
        cancelled_at = ?,
        cancel_reason = ?
      WHERE id = ?
       AND user_id = ?
       AND status IN (0, 1)
       AND cancelled_at IS NULL
    `,
    [bookingStatus.CANCELLED, dayjs().format('YYYY-MM-DD HH:mm:ss'), '不鸡吧需要了', roomId, uid]
  )

  if (r.affectedRows > 0) {
    return {};
  }

  


  const rows = await executeQuery(
    `
      SELECT id, user_id, status
      FROM bookings
      WHERE id = ?
    `,
    [roomId]
  )

  if (rows.length === 0) {
    throw new AppError('预定不存在')
  }

  if (rows[0].user_id !== uid) {
    throw new AppError('你无权取消别人的预定')
  }

  if (rows[0].status === bookingStatus.CANCELLED) {
    throw new AppError('该预订已经取消过了');
  }

  throw new AppError('取消失败')
}))

export default router;