const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const port = Number(process.env.PORT || 80);

module.exports = {
  port,
  rootDir,
  homeworkDir: path.join(rootDir, 'homework'),
  sharedDir: path.join(rootDir, 'shared'),
  dataDir: path.join(rootDir, 'data'),
  recordsFile: path.join(rootDir, 'data', 'records.json'),
  githubUpdateToken: process.env.GITHUB_UPDATE_TOKEN || '',
  githubUpdateBranch: process.env.GITHUB_UPDATE_BRANCH || 'main',
  restartMode: process.env.SMARTWAY_RESTART_MODE || 'disabled',
  restartDelayMs: Number(process.env.SMARTWAY_RESTART_DELAY_MS || 500)
};
