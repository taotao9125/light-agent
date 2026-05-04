import repository from './repository.js';
import AppError from '../../errors/appError.js';
import { errorEvents } from '../../consts/logEvents.js';

const service = {
  async getUser(id) {
    const result = await repository.findById(id);
    if (!result) throw new AppError('用户不存在', 404, { code: errorEvents.USER_NOT_FOUND, userId: id });
    return result;
  }
};



export default service;
