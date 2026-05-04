const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 80);
const ROOT_DIR = __dirname;
const HOMEWORK_DIR = path.join(ROOT_DIR, 'homework');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const GITHUB_UPDATE_TOKEN = process.env.GITHUB_UPDATE_TOKEN || '';
const GITHUB_UPDATE_BRANCH = process.env.GITHUB_UPDATE_BRANCH || 'main';
const SMARTWAY_RESTART_MODE = process.env.SMARTWAY_RESTART_MODE || 'disabled';
const SMARTWAY_RESTART_DELAY_MS = Number(process.env.SMARTWAY_RESTART_DELAY_MS || 500);

const CHILDREN = [
  { id: 'yuxiao', name: '余晓' },
  { id: 'yuyue', name: '余跃' }
];
const CHILD_IDS = new Set(CHILDREN.map(child => child.id));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function isValidChildId(childId) {
  return CHILD_IDS.has(childId);
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error('请求内容过大');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizeTaskEntry(childId, entry) {
  const cleanEntry = String(entry || '').replace(/^\.\//, '');
  if (!cleanEntry || cleanEntry.includes('..') || path.isAbsolute(cleanEntry)) {
    return '';
  }
  return `/homework/${childId}/${cleanEntry}`;
}

async function getTasks(childId) {
  const tasksPath = path.join(HOMEWORK_DIR, childId, 'tasks.json');
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

function getUpdateToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return String(req.headers['x-update-token'] || '').trim();
}

function hasValidUpdateToken(req) {
  if (!GITHUB_UPDATE_TOKEN) return false;
  const receivedToken = getUpdateToken(req);
  const expected = Buffer.from(GITHUB_UPDATE_TOKEN);
  const received = Buffer.from(receivedToken);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function isValidGitBranchName(branchName) {
  return /^[A-Za-z0-9._/-]+$/.test(branchName)
    && !branchName.includes('..')
    && !branchName.startsWith('/')
    && !branchName.endsWith('/');
}

function isWebRestartEnabled() {
  return SMARTWAY_RESTART_MODE === 'exit';
}

function scheduleWebRestart() {
  const delayMs = Number.isFinite(SMARTWAY_RESTART_DELAY_MS) && SMARTWAY_RESTART_DELAY_MS >= 0
    ? SMARTWAY_RESTART_DELAY_MS
    : 500;

  setTimeout(() => {
    console.log('SmartWay 服务准备重启');
    const forceExit = setTimeout(() => process.exit(0), 5000);
    forceExit.unref();
    server.close(() => process.exit(0));
  }, delayMs).unref();
}

async function runGit(args) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: ROOT_DIR,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 60 * 1000,
    maxBuffer: 1024 * 1024
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function updateFromGithub() {
  const branch = GITHUB_UPDATE_BRANCH;
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

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/children') {
    sendJson(res, 200, CHILDREN);
    return;
  }

  if (pathname === '/api/github/update') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }
    if (!GITHUB_UPDATE_TOKEN) {
      sendJson(res, 503, { error: '服务端未配置 GITHUB_UPDATE_TOKEN，接口不可用' });
      return;
    }
    if (!hasValidUpdateToken(req)) {
      sendJson(res, 401, { error: '未授权' });
      return;
    }

    try {
      const payload = await readRequestBody(req);
      const shouldRestart = payload.restart === true;
      if (shouldRestart && !isWebRestartEnabled()) {
        sendJson(res, 503, { error: '服务端未启用重启能力，请配置 SMARTWAY_RESTART_MODE=exit' });
        return;
      }

      const result = await updateFromGithub();
      sendJson(res, 200, { ok: true, ...result, restartScheduled: shouldRestart });
      if (shouldRestart) scheduleWebRestart();
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message,
        details: error.details || undefined
      });
    }
    return;
  }

  const taskMatch = pathname.match(/^\/api\/children\/([^/]+)\/tasks$/);
  if (req.method === 'GET' && taskMatch) {
    const childId = decodeURIComponent(taskMatch[1]);
    if (!isValidChildId(childId)) {
      sendJson(res, 404, { error: '儿童账号不存在' });
      return;
    }
    sendJson(res, 200, await getTasks(childId));
    return;
  }

  const recordsMatch = pathname.match(/^\/api\/children\/([^/]+)\/records$/);
  if (recordsMatch) {
    const childId = decodeURIComponent(recordsMatch[1]);
    if (!isValidChildId(childId)) {
      sendJson(res, 404, { error: '儿童账号不存在' });
      return;
    }

    const recordsByChild = await readJsonFile(RECORDS_FILE, {});
    recordsByChild[childId] ||= [];

    if (req.method === 'GET') {
      sendJson(res, 200, recordsByChild[childId]);
      return;
    }

    if (req.method === 'POST') {
      const payload = await readRequestBody(req);
      if (!payload.taskId || typeof payload.taskId !== 'string') {
        sendJson(res, 400, { error: 'taskId 必填' });
        return;
      }

      const record = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        childId,
        taskId: payload.taskId,
        date: payload.date || new Date().toISOString().slice(0, 10),
        total: Number(payload.total || 0),
        correct: Number(payload.correct || 0),
        wrongItems: Array.isArray(payload.wrongItems) ? payload.wrongItems : [],
        createdAt: new Date().toISOString()
      };

      recordsByChild[childId].push(record);
      await writeJsonFile(RECORDS_FILE, recordsByChild);
      sendJson(res, 201, record);
      return;
    }
  }

  sendJson(res, 404, { error: '接口不存在' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const safePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const filePath = path.resolve(ROOT_DIR, `.${safePath}`);
  if (!filePath.startsWith(ROOT_DIR + path.sep) && filePath !== ROOT_DIR) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const content = await fs.readFile(finalPath);
    const contentType = MIME_TYPES[path.extname(finalPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendText(res, 404, 'Not Found');
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, requestUrl.pathname);
      return;
    }
    await serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`SmartWay 服务已启动：http://localhost:${PORT}`);
});
