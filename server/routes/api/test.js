import express from 'express';
import executeQuery from '../../db.js';
import {to} from 'await-to-js';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import AppError from '../../errors/appError.js';
import dayjs  from 'dayjs';
const router = express.Router();

/* GET users listing. */
router.get('/', (req, res) => {
  throw new Error('hahahha')
  res.send('23424')
});


export default router;

const start = '2026-05-03 10:30';
const end = '2026-05-03 12:30';


console.log(dayjs(start).valueOf(),  dayjs(end).valueOf(), 111)