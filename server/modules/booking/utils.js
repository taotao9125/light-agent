import { createConnection } from './repository.js';
import redisClient from '../../config/redis.js';

async function withTransaction(callback) {
  const connection = await createConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

async function redisClientRpush(key, payload) {
  return await redisClient.rPush(key, JSON.stringify(payload));
}

export {
  withTransaction,
  redisClientRpush
}