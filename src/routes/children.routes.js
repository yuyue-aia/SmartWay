const express = require('express');
const childrenController = require('../controllers/children.controller');
const recordsController = require('../controllers/records.controller');
const asyncHandler = require('../middleware/async-handler');
const validateChildId = require('../middleware/validate-child-id');

const router = express.Router();

router.get('/children', childrenController.listChildren);
router.get('/children/:childId/tasks', validateChildId, asyncHandler(childrenController.listTasks));
router.get('/children/:childId/records', validateChildId, asyncHandler(recordsController.listRecords));
router.post('/children/:childId/records', validateChildId, asyncHandler(recordsController.createRecord));

module.exports = router;
