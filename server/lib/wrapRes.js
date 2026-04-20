// 它本来是做“统一成功响应格式”的，但顺手也承担了“把 async 异常转交给 Express 错误中间件”的职责。
// return -> wrapRes 统一成功响应 throw  -> wrapRes catch -> next(err) -> 全局错误中间件
// 在同步代码里，throw new error, 会被 app.use(err) 捕捉到。在异步代码里，不会被捕捉到
/**
 * 
handler throw
-> wrapRes catch
-> next(err)
-> global error middleware
-> 统一 error response
 */

const wrap = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req, res, next);
    res.json({
      code: 1,
      data: result || null,
      message: 'success',
      error: ''
    })
  } catch(e) {
    next(e);
  }
} 

export default wrap;