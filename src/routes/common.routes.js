const express = require('express');
const taskService = require('../services/task.service');
const asyncHandler = require('../middleware/async-handler');

const router = express.Router();

router.get('/common/tasks', asyncHandler(async (req, res) => {
  const tasks = await taskService.getCommonTasks();
  res.json(tasks);
}));

module.exports = router;
