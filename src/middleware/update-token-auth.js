const crypto = require('crypto');
const config = require('../config');

function getUpdateToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return String(req.headers['x-update-token'] || '').trim();
}

function hasValidUpdateToken(req) {
  if (!config.githubUpdateToken) return false;
  const receivedToken = getUpdateToken(req);
  const expected = Buffer.from(config.githubUpdateToken);
  const received = Buffer.from(receivedToken);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function updateTokenAuth(req, res, next) {
  if (!config.githubUpdateToken) {
    res.status(503).json({ error: '服务端未配置 GITHUB_UPDATE_TOKEN，接口不可用' });
    return;
  }

  if (!hasValidUpdateToken(req)) {
    res.status(401).json({ error: '未授权' });
    return;
  }

  next();
}

module.exports = updateTokenAuth;
