
function sleep(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function bookingRoom(context) {
  // 业务任务函数：读取 workflow context 里的用户输入，返回本任务 output。
  const { userId, startTime, endTime } = context.userInput;
  await sleep(2000);
  return {
    ok: true,
    data: {
      bookingId: `booking_${Date.now()}`,
      userId,
      roomId: `room_${Math.floor(Math.random() * 100)}`,
      startTime,
      endTime
    }
  }
}


export {
  bookingRoom
}