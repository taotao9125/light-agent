import { describe, it, expect, vi, beforeEach } from 'vitest';



// vi.mock('./utils.js', ({
//   withTransaction: vi.fn(callback => callback())
// }))


import service from './service.js';
import repo from './repository.js';
import * as utils from './utils.js';

vi.mock('./repository.js');
vi.mock('./utils.js');




// vi.mock('./utils.js', ({
//   withTransaction: vi.fn(callback => callback())
// }))



/**
 * 只 mock 测试对象里面的外部依赖， 外部依赖隔离，方便 mock，这也是把route, service, repository 分层的好处。
 * 如果不分层，如果我只想测试业务逻辑，那怎么伪造token, 怎么执行中间件, app 怎么启动等等一系列依赖问题
 */


/**
 *     /\         E2E 测试 (少量)
      /  \        集成测试 (适量)
     /____\       单元测试 (大量) ← 你在这里
 */



beforeEach(() => {
  vi.clearAllMocks();
})


describe('booking.cancel.service', () => {

  it('你无权取消别人的预定', async () => {

    repo.cancelBooking.mockResolvedValue({
      affectedRows: 0
    })

    repo.findBooking.mockResolvedValue([{
      id: 1,
      user_id: 2,
      status: 0
    }])
    await expect(service.cancelBooking({
      params: {
        id: 1
      },
      uid: 3
    })).rejects.toThrow('你无权取消别人的预定');

  });

  /**
   * UPDATE 没更新到任何行
        ↓
      再查 booking
        ↓
      查不到
        ↓
      抛 BOOKING_NOT_FOUND
   */
  it('改预定记录不存在', async () => {
    repo.cancelBooking.mockResolvedValue({
      affectedRows: 0
    })

    repo.findBooking.mockResolvedValue([]);
    await expect(service.cancelBooking({
      params: {
        id: 1
      },
      uid: 3
    })).rejects.toThrow('无预定记录');
  })


  it('时间段冲突', async () => {

    utils.withTransaction.mockImplementation((callback) => callback());
    utils.redisClientRpush.mockImplementation(() => { });
    repo.findConflictBooking.mockResolvedValue([{}]);

    await expect(service.createBooking({
      body: {
        start_time: 1779611400000,
        end_time: 1779615000000,
        room_id: 1
      },
      uid: 333
    })).rejects.toThrow('时间段冲突');

  })

  it('创建成功', async () => {
    utils.withTransaction.mockImplementation((callback) => callback());
    utils.redisClientRpush.mockImplementation(() => { });
    repo.findConflictBooking.mockResolvedValue([]);
    await expect(service.createBooking({
      body: {
        start_time: 1779611400000,
        end_time: 1779615000000,
        room_id: 1
      },
      uid: 333
    })).resolves.toBeNull();

  })



})
