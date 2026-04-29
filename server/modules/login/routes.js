import express from 'express';
import wrap from '../../lib/wrapRes.js';
import service from './service.js';
const router = express.Router();


/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: 用户登录
 *     tags:
 *        - Auth
 *     requestBody:
 *        required: true
 *        content:
 *         application/json:
 *           example:
 *             username: "john_doe@qq.com"
 *             password: "123456"
 *     responses:
 *       200:
 *         description: 登录成功，返回用户信息和 token
 *         content:
 *          application/json:
 *            example:
 *              token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 */
router.post('/', wrap((req) => service.login(req.body)));


export default router;