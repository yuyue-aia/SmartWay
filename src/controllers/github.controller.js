const { updateFromGithub } = require('../services/github-update.service');
const { isWebRestartEnabled, scheduleWebRestart } = require('../services/restart.service');

async function updateGithub(req, res) {
  const shouldRestart = req.body?.restart === true;
  if (shouldRestart && !isWebRestartEnabled()) {
    res.status(503).json({ error: '服务端未启用重启能力，请配置 SMARTWAY_RESTART_MODE=exit' });
    return;
  }

  const result = await updateFromGithub();
  res.json({ ok: true, ...result, restartScheduled: shouldRestart });
  if (shouldRestart) scheduleWebRestart();
}

module.exports = {
  updateGithub
};
