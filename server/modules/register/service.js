import bcrypt from 'bcrypt';
import repository from './repository.js';
import AppError from '../../errors/appError.js';
import validate, {schema} from './validate.js';


const service = {
  async createUser(body) {
    const {
      username,
      password
    } = validate(schema, body);

    const isUserExist = await repository.isUserExist(username);
    if (isUserExist) throw new AppError('该用户已注册');

    const hashPwd = await bcrypt.hash(password, 10);

    await repository.create(username, hashPwd);
    
    return null;
  }
};


export default service;