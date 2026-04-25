import AppError from "../errors/appError.js"
export default function requireRole(role) {
    return function(req, res, next) {
      if (req.role !== role) {
        return next(new AppError('无权限'))
      }
      next();
    }
}