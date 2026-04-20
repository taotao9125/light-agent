class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AppError';
    // 前端日志做分类
    this.code = options.code || 'APP_ERROR';
    this.status = options.status || 500;
    this.details = options.details || null
    this.isOperational = options.isOperational ?? true
  }
}

export default AppError;