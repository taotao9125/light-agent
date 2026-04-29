import redisClient, {connectRedis} from '../config/redis.js'
import logger from '../lib/logger.js';
import redisKeys from '../consts/redis.js';


async function sendNotification() {
  await connectRedis();

  logger.info('Notification worker started, waiting for messages...');
  while (true) {
    const result = await redisClient.blPop(redisKeys.NOTIFICATIONS, 0);
    const message = result.element;
    logger.info('Received notification message', JSON.parse(message));
  }

}


sendNotification().catch(err => {
  logger.error('Failed to send notification', err);
  process.exit(1);
})


