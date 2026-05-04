const express = require('express');
const rateLimit = require('express-rate-limit');
const githubController = require('../controllers/github.controller');
const asyncHandler = require('../middleware/async-handler');
const updateTokenAuth = require('../middleware/update-token-auth');

const router = express.Router();

const updateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' }
});

router.post('/github/update', updateLimiter, updateTokenAuth, asyncHandler(githubController.updateGithub));

module.exports = router;
