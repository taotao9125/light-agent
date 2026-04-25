import repository from './repository.js';
import AppError from '../../errors/appError.js';

const service = {
  async getUsers() {
    const result = repository.findAll();
    if (!result) throw AppError('USERS_NOT_FOUND');
    return result;
  }
};


export default service;