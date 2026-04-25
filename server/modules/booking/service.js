import dayjs from 'dayjs';
import repository, { createConnection } from './repository.js';
import AppError from '../../errors/appError.js';



const BookingStatus = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  CANCELLED: 3
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
    const isAdmin = req.role === 'admin';
    const uid = req.uid;
    const result = repository.findAllBookings(!isAdmin ? uid : null);
    return result;
  },

  async createBooking(req) {
    const {
      room_id,
      start_time,
      end_time
    } = req.body;
    const userId = req.uid;

    if (!room_id) throw new AppError('缺少 room_id');
    if (!start_time) throw new AppError('缺少开始时间');
    if (!end_time) throw new AppError('结束时间');
    if (dayjs(start_time).valueOf() >= dayjs(end_time).valueOf()) throw new AppError('开始时间必须小于结束时间');
    const s = dayjs(start_time).format('YYYY-MM-DD HH:mm:ss');
    const e = dayjs(end_time).format('YYYY-MM-DD HH:mm:ss');

    const connection = await createConnection();


    try {
      // 开启事务
      await connection.beginTransaction();
      const confilictBooking = await repository.findConfilictBooking(room_id, s, e);

      if (confilictBooking.length > 0) throw new AppError('时间段冲突');
      console.log('查完了，3秒后插入', new Date())
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('插入', new Date())

      await repository.createBooking(room_id, s, e, userId, BookingStatus.PENDING);

      // 提交事务
      await connection.commit();
      return null;
    } catch (e) {
      // 撤销这次事务里已经做过的所有操作
      connection.rollback();
      throw e;
    } finally {
      //  把数据库连接还回连接池
      connection.release();
    }

  },


  async cancelBooking(req) {

    const bookingId = +req.params.id;
    const uid = +req.uid;


    const result = await repository.cancelBooking(
      bookingId,
      BookingStatus.CANCELLED,
      '不鸡吧需要了',
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      uid
    )


    // 更新成功
    if (result.affectedRows > 0) return {};

    const booking = await repository.findBooking(bookingId);

    if (booking.length === 0) throw new AppError('BOOKING_NOT_FOUND');
    // TODO 管理员可以取消别人的
    if (booking[0].user_id !== uid) throw new AppError('你无权取消别人的预定');
    if (booking[0].status === BookingStatus.CANCELLED) throw new AppError('该预订已经取消过了');

    throw new AppError('取消失败')

  },

  async reviewBooking(req) {
    const bookingId = +req.params.id;
    // const uid = +req.uid;
    const isAdmin = req.role === 'admin';
    const {
      review_reason,
      review
    } = req.body;
    
    const status = +review === 1 ? BookingStatus.APPROVED : BookingStatus.REJECTED;

    if (!isAdmin) throw AppError('非管理员无法操作');

    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const result = await repository.updateBooking(
      bookingId, 
      status, 
      review_reason,
      now
    );

    if (result.affectedRows > 0) return {};

    const booking = await repository.findBooking(bookingId);
    if (booking.length === 0) throw new AppError('BOOKING_NOT_FOUND');
    if (booking[0].status !== BookingStatus.PENDING) throw new AppError('状态已流转');


  }
};



export default service;