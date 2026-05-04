import bcrypt from 'bcrypt';
import jwt  from  'jsonwebtoken';
import repository from './repository.js';
import AppError from '../../errors/appError.js';
import validate from '../../lib/validate.js';
import {schema} from '../register/validate.js';
import logger from '../../lib/logger.js';
import {errorEvents} from '../../consts/logEvents.js';


const service = {
  
  
  async login(body) {
    const {
      username,
      password
    } = validate(schema, body);

    const user = await repository.getUserByUserName(username)
    if (!user) throw new AppError('用户名或密码错误', 401, {
      code: errorEvents.USER_OR_PASSWORD_ERROR
    }); 

    const isPasswordError = await bcrypt.compare(password, user.password_hash)
    if (!isPasswordError) throw new AppError('用户名或密码错误', 401, {
      code: errorEvents.USER_OR_PASSWORD_ERROR
    }); 
    
    const secretKey = process.env.JWT_SEC;
    const token = jwt.sign({username, uid: user.id, role: user.role}, secretKey, { expiresIn: '1day' });

    logger.info(`用户 ${username} 登录成功`);

    return token;

  }
};


export default service;
