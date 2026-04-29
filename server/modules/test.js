import express from 'express';
import dayjs  from 'dayjs';

import redisClient from '../config/redis.js';

const router = express.Router();

/* GET users listing. */
router.get('/', async (req, res) => {
   try {
    const rod = `${Math.random()}hello`;
    await redisClient.set(rod, 'redis');
    const value = await redisClient.get(rod);

    res.json({ value, rod });
  } catch (e) {
    next(e);
  }
});


const start = '2026-05-30 16:30';
const end = '2026-05-30 17:30';




console.log(dayjs(start).valueOf(),  dayjs(end).valueOf())



export default router;

