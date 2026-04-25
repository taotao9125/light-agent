import executeQuery from '../../db.js';

const repository = {
  async findById(id) {
    const rows = await executeQuery(
      `
        SELECT id, username, role, create_at
        FROM users
        WHERE id = ?
      `,
      [id]
    )
    return rows[0];
  }
}


export default repository;