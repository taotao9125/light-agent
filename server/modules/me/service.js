import repository from './repository.js';
import AppError from '../../errors/appError.js';

const service = {
  async getUser(id) {
    const result = await repository.findById(id);
    if (!result) throw AppError('USER_NOT_FOUND');
    return result;
  }
};



export default service;