import executeQuery from '../../db/db.js';



const repository = {
  async findRooms() {
    const rows = await executeQuery(
      `
        SELECT * FROM meeting_rooms
      `,
    )
    return rows;
  },

  async findRoomById(id) {
    const rows = await executeQuery(
      'SELECT * from `meeting_rooms` where id = ?',
      [id]
    )
    return rows[0];
  }
}


export default repository;