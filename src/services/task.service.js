const path = require('path');
const config = require('../config');
const { readJsonFile } = require('../repositories/json-file.repository');

function normalizeTaskEntry(childId, entry) {
  const cleanEntry = String(entry || '').replace(/^\.\//, '');
  if (!cleanEntry || cleanEntry.includes('..') || path.isAbsolute(cleanEntry)) {
    return '';
  }
  return `/homework/${childId}/${cleanEntry}`;
}

async function getTasks(childId) {
  const tasksPath = path.join(config.homeworkDir, childId, 'tasks.json');
  const tasks = await readJsonFile(tasksPath, []);
  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter(task => task && task.enabled !== false)
    .map(task => ({
      ...task,
      entry: normalizeTaskEntry(childId, task.entry)
    }))
    .filter(task => task.id && task.name && task.entry);
}

module.exports = {
  getTasks,
  normalizeTaskEntry
};
