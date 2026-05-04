import executeQuery, { createPool } from '../../db/db.js';



// async function createTransaction() {
//   const pool = createPool();
//   const transaction = await pool.getConnection();
//   return transaction;
// }


// function closureConnection() {
//   let connection = null;
//   return async function connectionFactory() {
//     if (connection) return connection;
//     const pool = createPool();
//     connection = await pool.getConnection();
//     return connection;
//   }
// }


async function createConnection() {
  const pool = createPool();
  return await pool.getConnection();
}




const repository = {

  async findBooking(id) {
    const rows = await executeQuery(
      `
        SELECT * from bookings
        WHERE id = ?
      `,
      [id]
    );
    return rows;
  },

  async findAllBookings(userId) {
    const isUser = userId !== undefined && userId !== null;
    const whereSql = isUser ? `WHERE user_id = ?` : '';
    const params = isUser ? [userId] : [];

    const rows = await executeQuery(
      `
        SELECT 
          b.*,
          u.id as user_id,
          u.username,
          u.role,
          mr.id as room_id,
          mr.name,
          mr.location,
          mr.capacity,
          mr.equipment
        FROM bookings b
        JOIN users u
          on b.user_id = u.id
        JOIN meeting_rooms mr
          on b.room_id = mr.id
        ${whereSql}
        ORDER BY b.start_time ASC
      `,
      params
    )

    return rows;
  },

  async createBooking(connection, roomId, startTime, endTime, userId, status) {
    await connection.execute(
      `
          INSERT INTO bookings (room_id, start_time, end_time, user_id, status) VALUES (?, ?, ?, ?, ?)
        `,
      [roomId, startTime, endTime, userId, status]
    );
    return null;
  },

  async findConfilictBooking(connection, roomId, startTime, endTime) {
    const rows = await connection.execute(
      `
          SELECT id
          FROM bookings
          WHERE room_id=?
            AND ? < end_time
            AND ? > start_time
          FOR UPDATE
        `,
      [roomId, startTime, endTime]
    );

    return rows[0];
  },

  async cancelBooking(bookingId, status, cancelReason, canceledAt, userId) {
    // where => 等于 js filter
    // in(1,2) = x === 1 || x === 2
    const result = await executeQuery(
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
      [status, canceledAt, cancelReason, bookingId, userId]
    )
    return result;
  },


  async updateBooking(bookingId, status, remark, reviewTime) {
    const result = await executeQuery(
      `
        UPDATE bookings
        SET
          status= ?,
          review_remark = ?,
          review_at =?
        WHERE id = ?
        AND status = 0
      `,
      [status, remark, reviewTime, bookingId]
    )
    return result;

  }
}


export default repository;

export { createConnection };
