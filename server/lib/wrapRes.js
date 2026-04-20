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