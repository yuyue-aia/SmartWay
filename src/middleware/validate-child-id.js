const { isValidChildId } = require('../constants/children');

function validateChildId(req, res, next) {
  const { childId } = req.params;
  if (!isValidChildId(childId)) {
    res.status(404).json({ error: '儿童账号不存在' });
    return;
  }
  next();
}

module.exports = validateChildId;
