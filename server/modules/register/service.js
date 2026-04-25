import bcrypt from 'bcrypt';
import repository from './repository.js';
import AppError from '../../errors/appError.js';



const emailReg = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;


const service = {
  async createUser(body) {
    const {
      username,
      password
    } = body;

    if (!emailReg.test(username)) throw new AppError('邮箱格式不正确');
    if (!password) throw new AppError('密码不能为空');
    const isUserExist = await repository.isUserExist(username);
    if (isUserExist) throw new AppError('该用户已注册');

    const hashPwd = await bcrypt.hash(password, 10);

    await repository.create(username, hashPwd);
    
    return null;
  }
};


export default service;