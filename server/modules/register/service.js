import bcrypt from 'bcrypt';
import repository from './repository.js';
import AppError from '../../errors/appError.js';
import validate from '../../lib/validate.js';
import {schema} from './validate.js';
import { logEvents, errorEvents } from '../../consts/logEvents.js';


const service = {
  async createUser(req) {
    const {
      username,
      password
    } = validate(schema, req.body);

    const isUserExist = await repository.isUserExist(username);
    if (isUserExist) throw new AppError('该用户已注册', 409, {
      code: errorEvents.USER_ALREADY_EXISTS,
      username
    });

    const hashPwd = await bcrypt.hash(password, 10);

    await repository.create(username, hashPwd);
    
    return null;
  }
};


export default service;
