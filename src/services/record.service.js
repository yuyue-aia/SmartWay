const { z } = require('zod');
const config = require('../config');
const { readJsonFile, writeJsonFile } = require('../repositories/json-file.repository');

const recordInputSchema = z.object({
  taskId: z.string().min(1, 'taskId 必填'),
  date: z.string().optional(),
  total: z.coerce.number().finite().nonnegative().default(0),
  correct: z.coerce.number().finite().nonnegative().default(0),
  wrongItems: z.array(z.unknown()).default([])
});

async function getRecords(childId) {
  const recordsByChild = await readJsonFile(config.recordsFile, {});
  return Array.isArray(recordsByChild[childId]) ? recordsByChild[childId] : [];
}

async function createRecord(childId, payload) {
  const parsed = recordInputSchema.safeParse(payload || {});
  if (!parsed.success) {
    const error = new Error(parsed.error.issues[0]?.message || '请求参数不合法');
    error.statusCode = 400;
    throw error;
  }

  const recordsByChild = await readJsonFile(config.recordsFile, {});
  recordsByChild[childId] = Array.isArray(recordsByChild[childId]) ? recordsByChild[childId] : [];

  const record = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    childId,
    taskId: parsed.data.taskId,
    date: parsed.data.date || new Date().toISOString().slice(0, 10),
    total: parsed.data.total,
    correct: parsed.data.correct,
    wrongItems: parsed.data.wrongItems,
    createdAt: new Date().toISOString()
  };

  recordsByChild[childId].push(record);
  await writeJsonFile(config.recordsFile, recordsByChild);
  return record;
}

module.exports = {
  getRecords,
  createRecord
};
