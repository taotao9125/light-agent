import express from 'express';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import service from './service.js';

const router = express.Router();



router.get('/', auth, wrap((req) => {
  const userId = req.uid;
  return service.getUser(userId);
}));

export default router;