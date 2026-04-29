import redisClient from '../config/redis.js';
import AppError from '../errors/appError.js';


export default function rateLimit(options = {
  windowMs: 60 * 1000, // 1 minute
  max: 100 // limit each IP to 100 requests per windowMs
}) {
  return async function(req, res, next) {
    try {
      const key = `rate-limit:${req.ip}`;
      const count = await redisClient.incr(key);
      console.log(`IP ${req.ip} has made ${count} requests in the last ${options.windowMs / 1000} seconds.`);
      if (count === 1) {
        await redisClient.expire(key, options.windowMs / 1000);
      }

      if (count > options.max) {
        return next(new AppError('请求过于频繁，请稍后再试', 429, { code: 'RATE_LIMIT_EXCEEDED' }));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}