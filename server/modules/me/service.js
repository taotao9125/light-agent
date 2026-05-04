import repository from './repository.js';
import AppError from '../../errors/appError.js';
import { errorEvents } from '../../consts/logEvents.js';

const service = {
  async getUser(req) {
    const userId = req.uid;
    const result = await repository.findById(userId);
    if (!result) throw new AppError('用户不存在', 404, { code: errorEvents.USER_NOT_FOUND, userId });
    return result;
  }
};



export default service;
