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

// 这些路径上的本地修改是远端服务器运行产生的数据，不阻断更新
const LOCAL_DATA_PATHS = ['data/records.json'];

async function safeRunGit(args) {
  try {
    return await runGit(args);
  } catch (error) {
    return { stdout: '', stderr: (error.stderr || error.message || '').toString().trim() };
  }
}

async function discardLocalDataChanges(statusOutput) {
  const lines = statusOutput.split('\n').filter(Boolean);
  const blockers = [];
  for (const line of lines) {
    // 形如 " M data/records.json" 或 "?? data/foo"
    const filePath = line.slice(3).trim();
    if (LOCAL_DATA_PATHS.includes(filePath)) {
      // 已跟踪文件：检出回 HEAD；未跟踪文件：忽略
      await safeRunGit(['checkout', '--', filePath]);
    } else {
      blockers.push(line);
    }
  }
  return blockers;
}

async function updateFromGithub() {
  const branch = config.githubUpdateBranch;
  if (!isValidGitBranchName(branch)) {
    const error = new Error('GITHUB_UPDATE_BRANCH 配置不合法');
    error.statusCode = 500;
    throw error;
  }

  let status = await runGit(['status', '--porcelain']);
  if (status.stdout) {
    const blockers = await discardLocalDataChanges(status.stdout);
    if (blockers.length) {
      const error = new Error('工作区存在未提交内容，已停止从 GitHub 更新');
      error.statusCode = 409;
      error.details = blockers;
      throw error;
    }
    status = await runGit(['status', '--porcelain']);
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
