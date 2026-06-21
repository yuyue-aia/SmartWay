#!/usr/bin/env node

/**
 * 半自动下载守护：
 *  - 通过 CDP 控制已打开的浏览器
 *  - 把下载强制落到 ~/Downloads/wedrive_batch
 *  - 监听 Browser.downloadProgress 等"completed"
 *  - 完成一次后：把文件移动到 downloads/doc-pdfs/，更新 ledger，自动导航到下一个分享链接
 *
 * 你的事：每次页面加载好后，点「下载」按钮（如果有滑块就过一下）。
 *
 * 用法：
 *   node tools/manual-wedrive.js [--list=/tmp/pdf_list_full.json] [--out=downloads/doc-pdfs]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const argv = process.argv.slice(2);
const get = (key, def) => {
  const m = argv.find(a => a.startsWith('--' + key + '='));
  return m ? m.split('=').slice(1).join('=') : def;
};
const LIST_PATH = get('list', '/tmp/pdf_list_full.json');
const OUT_DIR = path.resolve(get('out', 'downloads/doc-pdfs'));
const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'wedrive_batch');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const LEDGER_PATH = path.join(OUT_DIR, '_ledger.json');
const ledger = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8')) : {};
const items = JSON.parse(fs.readFileSync(LIST_PATH, 'utf-8'));

function shareCodeOf(url) {
  const m = String(url || '').match(/[?&]k=([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

const pending = items
  .map(it => ({ name: it.name, code: shareCodeOf(it.url), url: it.url }))
  .filter(it => it.code && !ledger[it.code]);

console.log(`待下载：${pending.length} 个  →  ${OUT_DIR}`);
console.log(`下载落点：${DOWNLOAD_DIR}\n`);

if (!pending.length) {
  console.log('全部已下载，无事可做。');
  process.exit(0);
}

(async () => {
  const ver = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json());
  const browserWs = ver.webSocketDebuggerUrl;
  const tabs = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const tab = tabs.find(t => t.type === 'page' && /drive\.weixin\.qq\.com/.test(t.url));
  if (!tab) {
    console.error('找不到 drive.weixin.qq.com 的 tab，请先打开任一分享链接');
    process.exit(1);
  }
  console.log(`使用 tab: ${tab.url.slice(0, 80)}\n`);

  let bid = 1, tid = 1;
  const browser = new WebSocket(browserWs);
  const tabSock = new WebSocket(tab.webSocketDebuggerUrl);
  await Promise.all([
    new Promise(r => browser.once('open', r)),
    new Promise(r => tabSock.once('open', r))
  ]);

  function send(ws, idRef, method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idRef.id++;
      const handler = data => {
        const m = JSON.parse(data.toString());
        if (m.id === id) {
          ws.off('message', handler);
          if (m.error) reject(new Error(method + ': ' + m.error.message));
          else resolve(m.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  const browserCall = (method, params) => send(browser, { get id() { return bid; }, set id(v) { bid = v; } }, method, params);
  const tabCall = (method, params) => send(tabSock, { get id() { return tid; }, set id(v) { tid = v; } }, method, params);

  // 强制下载到独立目录
  await browserCall('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: DOWNLOAD_DIR,
    eventsEnabled: true
  });
  console.log('已设置下载目录\n');

  // 监听浏览器级下载事件
  const inFlight = new Map(); // guid -> { fileName, suggestedName }
  let resolveCompleted = null;
  let completedFile = null;

  browser.on('message', data => {
    const m = JSON.parse(data.toString());
    if (m.method === 'Browser.downloadWillBegin') {
      inFlight.set(m.params.guid, {
        suggestedName: m.params.suggestedFilename,
        url: m.params.url
      });
      console.log(`  ↓ 开始下载: ${m.params.suggestedFilename}`);
    } else if (m.method === 'Browser.downloadProgress') {
      const info = inFlight.get(m.params.guid);
      if (m.params.state === 'completed' && info) {
        const fname = info.suggestedName;
        completedFile = fname;
        if (resolveCompleted) {
          const r = resolveCompleted;
          resolveCompleted = null;
          r(fname);
        }
      } else if (m.params.state === 'canceled' && info) {
        console.log(`  ! 下载被取消: ${info.suggestedName}`);
      }
    }
  });

  function waitForDownload(timeoutMs = 5 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      if (completedFile) {
        const f = completedFile;
        completedFile = null;
        return resolve(f);
      }
      const timer = setTimeout(() => {
        resolveCompleted = null;
        reject(new Error('等待下载超时'));
      }, timeoutMs);
      resolveCompleted = (f) => {
        clearTimeout(timer);
        completedFile = null;
        resolve(f);
      };
    });
  }

  function moveAndLog(srcName, item) {
    const src = path.join(DOWNLOAD_DIR, srcName);
    if (!fs.existsSync(src)) {
      // 等一下让 .crdownload 完成重命名
      return new Promise(r => setTimeout(r, 500)).then(() => moveAndLog(srcName, item));
    }
    let dest = path.join(OUT_DIR, srcName);
    let i = 1;
    while (fs.existsSync(dest)) {
      const ext = path.extname(srcName);
      const base = srcName.slice(0, -ext.length);
      dest = path.join(OUT_DIR, `${base}__${i}${ext}`);
      i++;
    }
    fs.renameSync(src, dest);
    ledger[item.code] = path.basename(dest);
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
    return dest;
  }

  // 主循环：导航 → 等下载完成 → 移动 → 下一个
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const tag = `[${i + 1}/${pending.length}]`;
    const target = `https://drive.weixin.qq.com/s?k=${item.code}`;
    console.log(`\n${tag} ${item.name}`);
    console.log(`  打开: ${target}`);
    console.log(`  → 请在浏览器里点「下载」（如有滑块过一下）`);

    // 清掉残留态
    completedFile = null;
    inFlight.clear();

    try {
      await tabCall('Page.navigate', { url: target });
    } catch (e) {
      console.log(`  ✗ 导航失败：${e.message}`);
      continue;
    }

    try {
      const fname = await waitForDownload();
      const dest = await moveAndLog(fname, item);
      console.log(`  ✓ 完成: ${path.basename(dest)}`);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      console.log(`  在 5 分钟内你没有完成下载，跳过这一项。再次运行脚本会自动续跑。`);
    }
  }

  console.log(`\n全部完成。已下载累计：${Object.keys(ledger).length}/${items.length}`);
  browser.close();
  tabSock.close();
  process.exit(0);
})().catch(e => {
  console.error('致命错误:', e.message);
  process.exit(1);
});
