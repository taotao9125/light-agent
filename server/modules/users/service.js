import repository from './repository.js';

const service = {
  async getUsers() {
    const result = repository.findAll();
    return result;
  }
};


export default service;