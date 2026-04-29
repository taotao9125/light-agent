import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import logger from './lib/logger.js';


dotenv.config();



function createPoolFactory() {
  let pool = null;
  return function(){
    if (!pool) {
       pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        password: process.env.DB_PASSWORD,
        user: process.env.DB_USER,
        database: process.env.DB_BASE,
        waitForConnections: true,
        connectionLimit: 10
      })
      logger.info('MySQL connection pool created');
    }
    return pool;
  }
}






const createPool = createPoolFactory();


async function executeQuery(sql, p = []) {
  const pool = createPool();
  try {
     const [rows] = await pool.execute(sql, p);
     return rows;
  } catch (e) {
     return Promise.reject(e);
  }
}


export default executeQuery;
export {createPool};