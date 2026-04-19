import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {to} from 'await-to-js';


dotenv.config();
let pool = null;

async function initPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_BASE,
      waitForConnections: true,
      connectionLimit: 10
    })
  }
  return pool;
}

async function executeQuery(sql, p = []) {
  const pool = await initPool();
  const [e, result] = await to(pool.execute(sql, p)); 
  if (e) return e
  return result[0];
}

export default executeQuery;