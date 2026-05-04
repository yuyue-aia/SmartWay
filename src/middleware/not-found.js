function notFound(req, res) {
  res.status(404).json({ error: req.path.startsWith('/api/') ? '接口不存在' : 'Not Found' });
}

module.exports = notFound;
