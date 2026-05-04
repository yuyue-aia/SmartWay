const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const HOMEWORK_DIR = path.join(ROOT_DIR, 'homework');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

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

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/children') {
    sendJson(res, 200, CHILDREN);
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
