// 发生了错误，谁发生了错误，错误是什么，错误的上下文是什么
// 400 是你传错了 401 是你没登录 403 是你没资格 404 是东西不存在 409 是业务撞车了 500 是服务器炸了
class AppError extends Error {
  constructor(message, statusCode = 500, context = {}) {
    super(message);
    this.status = statusCode;
    this.context = context;
  }
}

export default AppError;