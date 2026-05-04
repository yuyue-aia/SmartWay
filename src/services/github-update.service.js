const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);

function isValidGitBranchName(branchName) {
  return /^[A-Za-z0-9._/-]+$/.test(branchName)
    && !branchName.includes('..')
    && !branchName.startsWith('/')
    && !branchName.endsWith('/');
}

async function runGit(args) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: config.rootDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 60 * 1000,
    maxBuffer: 1024 * 1024
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function updateFromGithub() {
  const branch = config.githubUpdateBranch;
  if (!isValidGitBranchName(branch)) {
    const error = new Error('GITHUB_UPDATE_BRANCH 配置不合法');
    error.statusCode = 500;
    throw error;
  }

  const status = await runGit(['status', '--porcelain']);
  if (status.stdout) {
    const error = new Error('工作区存在未提交内容，已停止从 GitHub 更新');
    error.statusCode = 409;
    error.details = status.stdout.split('\n');
    throw error;
  }

  const before = await runGit(['rev-parse', 'HEAD']);
  await runGit(['fetch', 'origin', branch]);
  const pull = await runGit(['pull', '--ff-only', 'origin', branch]);
  const after = await runGit(['rev-parse', 'HEAD']);

  return {
    branch,
    updated: before.stdout !== after.stdout,
    before: before.stdout,
    after: after.stdout,
    output: pull.stdout || pull.stderr || 'Already up to date.'
  };
}

module.exports = {
  updateFromGithub,
  isValidGitBranchName
};
