function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: '请求内容过大' });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    res.status(400).json({ error: '请求 JSON 格式不合法' });
    return;
  }

  const statusCode = error.statusCode || error.status || 500;
  const body = {
    ok: false,
    error: statusCode >= 500 ? '服务器内部错误' : error.message
  };

  if (error.details) body.details = error.details;
  if (statusCode >= 500) console.error(error);

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
