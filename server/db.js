import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {to} from 'await-to-js';
import AppError from './errors/appError.js';

dotenv.config();
let pool = null;


function createPoolFactory() {
  let pool = null;
  return function(){
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