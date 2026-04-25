import bcrypt from 'bcrypt';
import jwt  from  'jsonwebtoken';
import repository from './repository.js';
import AppError from '../../errors/appError.js';
import validate, {schema} from '../register/validate.js';


const service = {
  
  async login(body) {
    const {
      username,
      password
    } = validate(schema, body);

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