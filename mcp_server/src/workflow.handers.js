
function sleep(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function bookingRoom(context) {
  // 业务任务函数：读取 workflow context 里的用户输入，返回本任务 output。
  const { userId, startTime, endTime } = context.userInput;
  await sleep(2000);
  return {
    ok: false,
    code: 'xxxxx',
    data: {
      bookingId: `booking_${Date.now()}`,
      userId,
      roomId: `room_${Math.floor(Math.random() * 100)}`,
      startTime,
      endTime
    }
  }
}

async function findingRoom() {
  // 业务任务函数：读取 workflow context 里的用户输入，返回本任务 output。
  await sleep(2000);
  return {"ok":true,"code":1,"data":[{"id":1,"name":"冒险岛","capacity":30,"location":"维亚大厦6层","booked_by":-1,"equipment":"投影仪-人体工程学座椅","status":"active","created_at":"2026-04-19T02:49:56.000Z","updated_at":"2026-04-19T02:49:56.000Z"},{"id":2,"name":"冒险岛","capacity":30,"location":"维亚大厦6层","booked_by":-1,"equipment":"投影仪-人体工程学座椅","status":"active","created_at":"2026-04-19T02:50:01.000Z","updated_at":"2026-04-19T02:50:01.000Z"}],"message":"success","error":""}
}


export {
  bookingRoom,
  findingRoom
}