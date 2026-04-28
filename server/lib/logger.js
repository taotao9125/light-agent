const logger = {
  info(message, extra = {}) {
    console.log(
      JSON.stringify({
        level: 'info',
        message,
        // UTC 标准时间。
        timestamp: new Date().toISOString(),
        ...extra
      })
    )
  },
  error(message, extra = {}) {
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        timestamp: new Date().toISOString(),
        ...extra
      })
    )
  }
}

export default logger;