import express from 'express';
import wrap from '../../lib/wrapRes.js';
import service from './service.js';
const router = express.Router();


router.post('/', wrap((req) => service.createUser(req)));


export default router;
