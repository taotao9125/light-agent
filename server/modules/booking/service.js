import dayjs from 'dayjs';
import repository from './repository.js';
import AppError from '../../errors/appError.js';
import validate, { createBookingSchema } from './validate.js';
import logger from '../../lib/logger.js';
import { errorEvents } from '../../consts/logEvents.js';
import { withTransaction, redisClientRpush } from './utils.js';
import redisKeys from '../../consts/redis.js';

const BookingStatus = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  CANCELLED: 3
};

const CANCEL_REASON = '不鸡吧需要了';



function formatTime(time) {
  return dayjs(time).format('YYYY-MM-DD HH:mm:ss');
}

function now() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

function getBookingId(req) {
  return +req.params.id;
}

function getUserId(req) {
  return +req.uid;
}

function canViewAllBookings(req) {
  return req.role === 'admin';
}

/**
 * bookings/
 *  create
 *  cancel
 *  review
 *  list
 * 
 */


const service = {
  async getBookings(req) {
    const uid = canViewAllBookings(req) ? null : req.uid;
    const result = await repository.findAllBookings(uid);
    return result;
  },

  async createBooking(req) {
    const {
      room_id,
      start_time,
      end_time
    } = validate(createBookingSchema, req.body);

    const userId = req.uid;


    const s = formatTime(start_time);
    const e = formatTime(end_time);


    await withTransaction(async function (connection) {
      const confilictBooking = await repository.findConfilictBooking(connection, room_id, s, e);
      if (confilictBooking.length > 0) {
        throw new AppError('时间段冲突', 409, {
          code: errorEvents.TIME_CONFLICT,
          user_id: userId,
          room_id,
          start_time: s,
          end_time: e
        });
      }

      console.log('查完了，3秒后插入', new Date())
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('插入', new Date());

      await repository.createBooking(connection, room_id, s, e, userId, BookingStatus.PENDING);
      logger.info('BOOKING_CREATED', { userId, roomId: room_id, startTime: s, endTime: e });


      await redisClientRpush(redisKeys.NOTIFICATIONS, {
        user_id: userId,
        room_id,
        start_time: s,
        end_time: e
      })
    })

    return null;

  },


  async cancelBooking(req) {

    const bookingId = getBookingId(req);
    const uid = getUserId(req);


    const result = await repository.cancelBooking(
      bookingId,
      BookingStatus.CANCELLED,
      CANCEL_REASON,
      now(),
      uid
    )


    // 更新成功
    if (result.affectedRows > 0) {
      logger.info('BOOKING_CANCELLED', { bookingId, userId: uid });
      return {};
    }

    const booking = await repository.findBooking(bookingId);

    if (booking.length === 0) throw new AppError('无预定记录', 404, { bookingId, userId: uid, code: errorEvents.BOOKINT_NOT_FOUND });
    // TODO 管理员可以取消别人的
    if (booking[0].user_id !== uid) throw new AppError('你无权取消别人的预定', 403, { bookingId, userId: uid, code: errorEvents.BOOKING_CANCEL_FORBIDDEN });
    if (booking[0].status === BookingStatus.CANCELLED) throw new AppError('该预订已经取消过了', 409, { bookingId, userId: uid, code: errorEvents.BOOKING_ALREADY_CANCELLED });

    throw new AppError('取消失败', 500, { bookingId, userId: uid });

  },

  async reviewBooking(req) {
    const bookingId = getBookingId(req);
    // const uid = +req.uid;
    const isAdmin = canViewAllBookings(req);
    const {
      review_reason,
      review
    } = req.body;

    const status = +review === 1 ? BookingStatus.APPROVED : BookingStatus.REJECTED;

    if (!isAdmin) throw new AppError('非管理员无法操作', 403, { bookingId, userId: req.uid, status, code: errorEvents.BOOKING_UPDATE_FORBIDDEN });

    const result = await repository.updateBooking(
      bookingId,
      status,
      review_reason,
      now()
    );

    if (result.affectedRows > 0) {
      logger.info('BOOKING_REVIEWED', { bookingId, review, userId: req.uid });
      return {};
    }

    const booking = await repository.findBooking(bookingId);
    if (booking.length === 0) throw new AppError('BOOKING_NOT_FOUND', 404, { bookingId, userId: req.uid, code: errorEvents.BOOKINT_NOT_FOUND });
    if (booking[0].status !== BookingStatus.PENDING) throw new AppError('状态已流转', 409, { bookingId, userId: req.uid, code: errorEvents.BOOKING_UPDATE_FORBIDDEN });

    throw new AppError('审核失败', 500, { bookingId, userId: req.uid, status });

  }
};



export default service;
