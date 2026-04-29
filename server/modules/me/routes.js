import express from 'express';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import service from './service.js';

const router = express.Router();

/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: 获取当前用户信息
 *     tags:
 *        - User
 *     responses:
 *       200:
 *        description: 获取用户信息
 *        content:
 *          application/json:
 *           example:
 *             id: 1
 *             username: "john_doe"
 *             email: "xxx@yyy.com"
 */
router.get('/', auth, wrap((req) => {
  const userId = req.uid;
  return service.getUser(userId);
}));

export default router;