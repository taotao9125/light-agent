import AppError from '../errors/appError.js';
import { errorEvents } from '../consts/logEvents.js';

export default function requireRole(role) {
  return function(req, res, next) {
    if (req.role !== role) {
      return next(new AppError('无权限', 403, {
        code: errorEvents.ROLE_FORBIDDEN,
        requiredRole: role,
        currentRole: req.role,
        userId: req.uid
      }));
    }
    next();
  }
}
