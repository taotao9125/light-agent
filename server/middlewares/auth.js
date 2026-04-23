import jwt from 'jsonwebtoken';
import AppError from '../errors/appError.js';

const JWT_SECRET = process.env.JWT_SEC;
export default function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next(new AppError('未提供 token, 请登陆'));
    return;
  }
  const token = authHeader.split(' ')[1];

  if (!token) next(new AppError('格式错误')); 
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.uid = decoded.uid;
    req.role = decoded.role;
    next();
  } catch (e) {
    next(e)
  }
}