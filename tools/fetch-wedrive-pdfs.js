#!/usr/bin/env node

/**
 * 批量下载微盘分享链接里的 PDF。
 *
 * 输入：JSON 数组，元素 { name, url }，url 形如 https://drive.weixin.qq.com/s?k=<share_code>
 * 流程（每个 share_code）：
 *   1) POST /diskshare/file_list  → 拿 file_id + 真实 name + size
 *   2) POST /webdisk/download func=2 → 反垃圾校验
 *   3) POST /webdisk/download func=4 → 拿 download_info.url + 临时 cookie wedrive_downkey
 *   4) GET  download_info.url      → 真实 PDF 字节流
 *
 * Cookie 来源：手动从已登录的浏览器导出，写入 .env 的 WEDRIVE_COOKIE。
 * 安全：仅访问 drive.weixin.qq.com，对最终下载 URL 做协议+主机白名单校验。
 *
 * 用法：
 *   node tools/fetch-wedrive-pdfs.js <list.json> [--limit N] [--out DIR]
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const COOKIE = String(process.env.WEDRIVE_COOKIE || '').trim();
const SID_OVERRIDE = process.env.WEDRIVE_SID || '';
const ORIGIN = 'https://drive.weixin.qq.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// 微盘下载会重定向到 *.qq.com 的 CDN（如 szfront.wxwork.qq.com / drive.weixin.qq.com）
const ALLOWED_HOST_SUFFIXES = ['.qq.com'];
const REQ_TIMEOUT_MS = 60000;
const SLEEP_MS_BETWEEN = Number(process.env.WEDRIVE_INTERVAL_MS || 4000); // 限速，避免风控
const MAX_RETRIES = 3;

if (!COOKIE) {
  console.error('缺少 WEDRIVE_COOKIE。把已登录浏览器里 drive.weixin.qq.com 的 cookie 串放进 .env：\n  WEDRIVE_COOKIE="wedrive_uin=...; wedrive_sid=...; wedrive_skey=...; wedrive_ticket=...; ..."');
  process.exit(1);
}

function getSid() {
  if (SID_OVERRIDE) return SID_OVERRIDE;
  const m = COOKIE.match(/wedrive_sid=([^;]+)/);
  if (!m) throw new Error('cookie 里没有 wedrive_sid，且未设置 WEDRIVE_SID');
  return m[1];
}

const SID = getSid();
let downKey = (COOKIE.match(/wedrive_downkey=([^;]+)/) || [, ''])[1];

function rand() {
  return Date.now().toString() + Math.floor(Math.random() * 1e10).toString().padStart(10, '0');
}

function buildCookie() {
  // 把 cookie 中的 wedrive_downkey 替换成最新值
  const updated = COOKIE.replace(/wedrive_downkey=[^;]+/, '').replace(/;\s*;/g, ';').replace(/;\s*$/, '');
  return updated + (downKey ? `; wedrive_downkey=${downKey}` : '');
}

async function postForm(pathName, body) {
  const url = `${ORIGIN}${pathName}?sid=${SID}&r=${rand()}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'cookie': buildCookie(),
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': UA,
        'origin': ORIGIN,
        'referer': ORIGIN + '/'
      },
      body,
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${pathName}: ${text.slice(0, 200)}`);
    if (json && json.head && json.head.ret !== 0) {
      throw new Error(`API 错误 ret=${json.head.ret} ${pathName}: ${json.head.msg || ''}`);
    }
    return json || {};
  } finally {
    clearTimeout(t);
  }
}

function shareCodeOf(item) {
  const m = String(item.url || '').match(/[?&]k=([A-Za-z0-9]+)/);
  if (!m) throw new Error('无法解析 share_code: ' + item.url);
  return m[1];
}

function safeFileName(name, fallback) {
  const cleaned = String(name || fallback).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim();
  return cleaned || fallback;
}

function assertAllowedUrl(rawUrl) {
  const u = new URL(rawUrl);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('协议非法: ' + rawUrl);
  const host = u.hostname.toLowerCase();
  const ok = ALLOWED_HOST_SUFFIXES.some(s => host === s.slice(1) || host.endsWith(s));
  if (!ok) throw new Error('主机不在白名单: ' + host);
  return u;
}

async function fetchOne(item, outDir) {
  const code = shareCodeOf(item);

  // 1. file_list
  const fl = await postForm('/diskshare/file_list', `share_code=${code}&parent_id=&file_pos=0&filenum=20`);
  const list = (fl.body && fl.body.file_list) || [];
  if (!list.length) throw new Error('file_list 为空');
  const file = list[0];
  const fileId = file.file_id;
  const realName = safeFileName(file.name, item.name || `${code}.pdf`);
  const size = file.size;

  // 2. func=2 反垃圾
  await postForm('/webdisk/download', `func=2&file_id=${encodeURIComponent(fileId)}`);

  // 3. func=4 拿真实 URL
  const dl = await postForm(
    '/webdisk/download',
    `func=4&f=json&return_type=2&file_id=${encodeURIComponent(fileId)}&captcha_ticket=&captcha_randstr=&share_code=${code}`
  );
  const info = dl.body && dl.body.download_info;
  if (!info || !info.url) throw new Error('无 download_info.url，可能命中验证码或权限限制');
  if (info.cookie_name === 'wedrive_downkey' && info.cookie_value) {
    downKey = info.cookie_value; // 服务端下发的临时 key，下一次 GET 用
  }
  assertAllowedUrl(info.url);

  // 4. GET PDF
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS * 2);
  let buf;
  try {
    const res = await fetch(info.url, {
      method: 'GET',
      headers: {
        'cookie': buildCookie(),
        'user-agent': UA,
        'referer': ORIGIN + '/'
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`下载 HTTP ${res.status}`);
    if (res.url) assertAllowedUrl(res.url);
    const ct = res.headers.get('content-type') || '';
    if (!/pdf|octet-stream/i.test(ct)) throw new Error('意外 content-type: ' + ct);
    buf = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }

  if (size && Math.abs(buf.length - size) > 1024) {
    // size 与实际差距较大时报警但仍写入
    console.warn(`  ! 大小偏差: 服务端 ${size} vs 实际 ${buf.length}`);
  }

  let dest = path.join(outDir, realName);
  // 重名时加序号
  let i = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(realName);
    const base = realName.slice(0, -ext.length);
    dest = path.join(outDir, `${base}__${i}${ext}`);
    i++;
  }
  fs.writeFileSync(dest, buf);
  return { dest, bytes: buf.length, realName };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  const listPath = argv.find(a => !a.startsWith('--'));
  const limitArg = argv.find(a => a.startsWith('--limit='));
  const outArg = argv.find(a => a.startsWith('--out='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const outDir = path.resolve(outArg ? outArg.split('=')[1] : 'downloads/doc-pdfs');

  if (!listPath) {
    console.error('用法: node tools/fetch-wedrive-pdfs.js <list.json> [--limit=N] [--out=DIR]');
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
  fs.mkdirSync(outDir, { recursive: true });

  // 已下载的 share_code 索引（断点续跑）
  const ledgerPath = path.join(outDir, '_ledger.json');
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')) : {};

  const failures = [];
  let interval = SLEEP_MS_BETWEEN;
  const total = Math.min(items.length, limit);
  console.log(`SID=${SID}  共 ${total} 个待下载  →  ${outDir}  (间隔 ${interval}ms)\n`);

  for (let i = 0; i < total; i++) {
    const item = items[i];
    const code = (() => { try { return shareCodeOf(item); } catch { return null; } })();
    const tag = `[${i + 1}/${total}]`;

    if (code && ledger[code]) {
      console.log(`${tag} ◷ 跳过(已下载) ${ledger[code]}`);
      continue;
    }

    let attempt = 0;
    let ok = false;
    while (attempt < MAX_RETRIES && !ok) {
      attempt++;
      try {
        const r = await fetchOne(item, outDir);
        console.log(`${tag} ✓ ${r.realName}  (${(r.bytes / 1024).toFixed(1)} KB)`);
        if (code) ledger[code] = r.realName;
        fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
        ok = true;
      } catch (e) {
        const msg = e.message || String(e);
        const rateLimited = /HTTP 429|ret=-28092|ret=-13/.test(msg);
        if (rateLimited && attempt < MAX_RETRIES) {
          const back = Math.min(60000, 8000 * attempt);
          console.log(`${tag} ⏳ 限流(${msg.slice(0, 60)})，退避 ${back}ms 后重试 (${attempt}/${MAX_RETRIES})`);
          await sleep(back);
          interval = Math.min(15000, interval + 2000); // 后续整体放慢
        } else {
          console.log(`${tag} ✗ ${item.name || item.url}  → ${msg}`);
          failures.push({ item, error: msg });
          break;
        }
      }
    }
    if (i < total - 1) await sleep(interval);
  }

  console.log(`\n完成：成功 ${Object.keys(ledger).length}/${total}`);
  if (failures.length) {
    const failPath = path.join(outDir, '_failures.json');
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`失败清单: ${failPath}（再跑一次脚本即会自动续跑未下载项）`);
  }
}

main().catch(e => {
  console.error('致命错误:', e.message);
  process.exit(1);
});
