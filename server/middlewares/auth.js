import jwt from 'jsonwebtoken';
import AppError from '../errors/appError.js';
import { errorEvents } from '../consts/logEvents.js';


export default function auth(req, res, next) {
  const JWT_SECRET = process.env.JWT_SEC;
  
  if (!JWT_SECRET) {
    next(new AppError('JWT_SEC 未配置', 500, {
      code: errorEvents.JWT_SECRET_NOT_CONFIGURED
    }));
    return;
  }

  const token = (req.headers.authorization || '').split(' ')[1];

  if (!token) {
    next(new AppError('缺少授权信息', 403, {
      code: errorEvents.TOKEN_NOT_FOUND
    })); 
    return;
  }
  

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.uid = decoded.uid;
    req.role = decoded.role;
    next();
  } catch (e) {
    next(new AppError('授权信息无效', 401, {
      code: errorEvents.TOKEN_INVALID,
      cause: e.message
    }));
  }
}
