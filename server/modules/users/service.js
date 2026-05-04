import repository from './repository.js';

const service = {
  async getUsers() {
    const result = await repository.findAll();
    return result;
  }
};


export default service;
