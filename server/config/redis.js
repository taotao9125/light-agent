import { createClient } from 'redis';
import logger from '../lib/logger.js';
import AppError from '../errors/appError.js';


const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});



async function connectRedis() {
  try {
    await redisClient.connect();
    logger.info('Connected to Redis successfully');
  } catch (err) {
    throw new AppError('无法连接到 Redis 服务', 500, { code: 'REDIS_CONNECTION_FAILED' });
  }
}

export default redisClient;
export {connectRedis};