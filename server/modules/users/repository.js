import executeQuery from '../../db/db.js';


const repository = {
  async findAll() {
    const rows = await executeQuery(
      `
         SELECT id, username, role, create_at FROM users
      `
    )
    return rows;
  }
};


export default repository;