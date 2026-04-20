import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SEC;

export default function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({error: '未提供 token, 请登陆'})
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
     return res.status(401).json({error: 'token 格式错误'})
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
   
    req.uid = decoded.uid;
   next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
       return res.status(401).json({ error: 'token 已过期，请重新登录' });
    }

    return res.status(401).json({ error: 'token 无效' });
  }
}