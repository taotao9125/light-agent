import executeQuery from '../../db.js';

const repository = {
  async create(username, password) {
    await executeQuery(
      `
       INSERT INTO users (username, password_hash) VALUES (?, ?)
      `,
      [username, password]
    )
    return null;
  },

  
  async isUserExist(username) {
    const rows = await executeQuery(
      `
        SELECT id FROM users
        WHERE username = ?
      `,
      [username]
    )
    return !!rows[0];
  }
};


export default repository;