const recordService = require('../services/record.service');

async function listRecords(req, res) {
  const records = await recordService.getRecords(req.params.childId);
  res.json(records);
}

async function createRecord(req, res) {
  const record = await recordService.createRecord(req.params.childId, req.body);
  res.status(201).json(record);
}

module.exports = {
  listRecords,
  createRecord
};
