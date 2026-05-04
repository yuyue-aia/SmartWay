const { CHILDREN } = require('../constants/children');
const taskService = require('../services/task.service');

function listChildren(req, res) {
  res.json(CHILDREN);
}

async function listTasks(req, res) {
  const tasks = await taskService.getTasks(req.params.childId);
  res.json(tasks);
}

module.exports = {
  listChildren,
  listTasks
};
