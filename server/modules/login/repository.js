import executeQuery from '../../db.js';

const repository = {
 
  async getUserByUserName(userName) {
    const rows = await executeQuery(
      `
        SELECT * FROM users
        WHERE username = ?
      `,
      [userName]
    )

    return rows[0];
  }
  
};


export default repository;