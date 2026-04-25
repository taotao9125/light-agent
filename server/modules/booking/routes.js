import express from 'express';
import auth from '../../middlewares/auth.js';
import wrap from '../../lib/wrapRes.js';
import service from './service.js';
import requireRole from '../../middlewares/requireRole.js';

const router = express.Router();


router.get('/', auth, wrap((req) => service.getBookings(req)));
router.post('/create', auth, wrap((req) => service.createBooking(req)));
router.patch('/:id/cancel', auth, wrap((req) => service.cancelBooking(req)));
router.patch('/:id/review', auth, requireRole('admin'), wrap((req) => service.reviewBooking(req)));


export default router;