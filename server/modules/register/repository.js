import executeQuery from '../../db.js';

const repository = {
  async create(username, password) {
    await executeQuery(
      `
       INSERT INTO USERS (username, password_hash) VALUES (?, ?)
      `,
      [username, password]
    )
    return null;
  },

  async isUserExist(username) {
    const rows = executeQuery(
      `
        SELECT id FROM USERS
        WHERE username = ?
      `,
      [username]
    )
    return !!rows[0];
  }
};


export default repository;