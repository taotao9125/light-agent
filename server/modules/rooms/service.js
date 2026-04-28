import repository from './repository.js';
import AppError from '../../errors/appError.js';
import { errorEvents } from '../../consts/logEvents.js';


const service = {
  async getRooms() {
    const result = await repository.findRooms();
    return result;
  },

  async getRoomById(req) {
    const roomdId = +req.params.id;
    const result = await repository.findRoomById(roomdId);
    if (!result) throw new AppError('会议室不存在', 404, {
      code: errorEvents.ROOM_NOT_FOUND,
      room_id: roomdId,
      user_id: req.uid,
    });
    return result;
  }
};



export default service;