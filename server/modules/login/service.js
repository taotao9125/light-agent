import bcrypt from 'bcrypt';
import jwt  from  'jsonwebtoken';
import repository from './repository.js';
import AppError from '../../errors/appError.js';



const emailReg = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;


const service = {
  
  async login(body) {
    const {
      username,
      password
    } = body;

    
    if (!emailReg.test(username)) new AppError('邮箱格式不正确');
    if (!password) throw new AppError('密码不能为空');

    const user = await repository.getUserByUserName(username)
    if (!user) throw new AppError('未注册'); 

    const isPasswordError = await bcrypt.compare(password, user.password_hash)
    if (!isPasswordError) throw new AppError('密码错误'); 
    
    const secretKey = process.env.JWT_SEC;
    const token = jwt.sign({username, uid: user.id, role: user.role}, secretKey, { expiresIn: '1day' });

    return token;

  }
};


export default service;