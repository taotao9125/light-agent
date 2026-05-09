import { bookingRoom, findingRoom } from './workflow.handers.js';

const WORKFLOW_CONFIG = {
  // 工作流定义：描述这个流程是什么，以及包含哪些任务。
  name: 'book_meeting_room',
  description: '根据参会人数和会议时间自动预定一个可用会议室',
  tasks: [

    {
      // 当前最小 demo 用 name 作为任务标识；后续可以拆成 key + name。
      name: 'room_find_task',
      description: '查找可用会议室',
      // handler 是任务真正执行的业务函数。
      handler: findingRoom
    },

    {
      // 当前最小 demo 用 name 作为任务标识；后续可以拆成 key + name。
      name: 'booking_task',
      description: '预定会议室',
      // handler 是任务真正执行的业务函数。
      handler: bookingRoom
    }
  ]
}

export default WORKFLOW_CONFIG;