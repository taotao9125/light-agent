import repository from './repository.js';
import AppError from '../../errors/appError.js';




const service = {
  async getRooms() {
    const result = await repository.findRooms();
    if (!result) throw AppError('USER_NOT_FOUND');
    return result;
  },

  async getRoomById(req) {
    const roomdId = +req.params.id;
    const result = await repository.findRoomById(roomdId);
    if (!result) throw AppError('ROOM_NOT_FOUND');
    return result;
  }
};



export default service;