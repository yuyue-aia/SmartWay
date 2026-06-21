#!/usr/bin/env node

/**
 * 最小原型：通过「腾讯文档 MCP」读取一篇文档的正文，
 * 从正文里提取外链 PDF 地址，并把这些 PDF 下载到本地。
 *
 * 路线：官方 Open API / MCP（远程 MCP 服务，无需安装、无需企业资质）
 *   - MCP 端点：https://docs.qq.com/openapi/mcp
 *   - 鉴权：HTTP Header `Authorization: <token>`（token 在 https://docs.qq.com/open/auth/mcp.html 获取）
 *   - 读正文用 MCP 工具 `get_content`，入参 { file_id }
 *
 * 用法：
 *   1) 在项目根目录 .env 配置（见 deploy/.env.example）：
 *        TENCENT_DOCS_TOKEN="你的Token"
 *        TENCENT_DOCS_FILE_ID="w3_AUwAhgbfAMMCNDqz4EGDbSf61xqrn"   # 文档ID，或用命令行参数传入
 *   2) 运行：
 *        node tools/fetch-doc-pdfs.js [file_id]
 *        node tools/fetch-doc-pdfs.js --list        # 只读正文+打印PDF链接，不下载
 *
 * 说明：目标文档若是企业微信文档（doc.weixin.qq.com），与腾讯文档（docs.qq.com）
 *       账号体系不同，MCP 可能无法访问 —— 脚本会把 MCP 返回的错误如实打印出来，
 *       用于验证可行性。
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');

const MCP_ENDPOINT = process.env.TENCENT_DOCS_MCP_URL || 'https://docs.qq.com/openapi/mcp';
const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = Number(process.env.TENCENT_DOCS_TIMEOUT_MS || 60000);
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  process.env.TENCENT_DOCS_PDF_DIR || 'downloads/doc-pdfs'
);

// ---------- 通用工具 ----------

function printUsage() {
  console.log(`用法：
  在项目根目录 .env 中配置 TENCENT_DOCS_TOKEN（必填）后执行：
    node tools/fetch-doc-pdfs.js [file_id]

.env 示例：
  TENCENT_DOCS_TOKEN="你的Token（在 https://docs.qq.com/open/auth/mcp.html 获取）"
  TENCENT_DOCS_FILE_ID="w3_AUwAhgbfAMMCNDqz4EGDbSf61xqrn"

可选：
  --list                 仅读取正文并打印 PDF 链接，不下载
  TENCENT_DOCS_PDF_DIR   下载目录（默认 downloads/doc-pdfs）
  TENCENT_DOCS_MCP_URL   MCP 端点（默认 https://docs.qq.com/openapi/mcp）
`);
}

function readToken() {
  const token = String(process.env.TENCENT_DOCS_TOKEN || '').trim();
  if (!token) {
    printUsage();
    throw new Error('缺少 TENCENT_DOCS_TOKEN');
  }
  return token;
}

/**
 * SSRF 防护：只允许 http/https，且禁止访问内网/保留地址。
 * 命中规则（含安全基线 9./10./11./21./30. 及常见私网段、本地回环）则拒绝。
 */
function assertPublicHttpUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`非法 URL：${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`只允许 http/https：${rawUrl}`);
  }

  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    throw new Error(`拒绝访问本地地址：${host}`);
  }

  // 仅对“纯 IPv4 字面量”做内网判断，域名交给后续解析层（这里保守拒绝明显内网 IP）
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const blockedFirstOctets = new Set([9, 10, 11, 21, 30, 127]);
    const isPrivate =
      blockedFirstOctets.has(a) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local
      (a === 100 && b >= 64 && b <= 127); // CGNAT
    if (isPrivate) {
      throw new Error(`拒绝访问内网/保留地址：${host}`);
    }
  }
  // IPv6 回环/内网
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    throw new Error(`拒绝访问内网/保留 IPv6 地址：${host}`);
  }
  return u;
}

// ---------- 最小 MCP over Streamable HTTP 客户端 ----------

class McpHttpClient {
  constructor({ endpoint, token, timeoutMs }) {
    this.endpoint = endpoint;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
  }

  buildHeaders() {
    const headers = {
      Authorization: this.token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (PROTOCOL_VERSION) headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
    return headers;
  }

  /** 解析 Streamable HTTP 响应（可能是 JSON 或 SSE 流），返回与 id 匹配的 JSON-RPC 消息 */
  async parseResponse(response, expectId) {
    const sid = response.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}：${text.slice(0, 500)}`);
    }

    let messages = [];
    if (contentType.includes('text/event-stream')) {
      // 解析 SSE：收集所有 data: 行
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            messages.push(JSON.parse(payload));
          } catch {
            /* 忽略非 JSON 的 data 行 */
          }
        }
      }
    } else if (text) {
      try {
        const parsed = JSON.parse(text);
        messages = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new Error(`无法解析 MCP 响应：${text.slice(0, 500)}`);
      }
    }

    if (expectId == null) return null;
    const matched = messages.find(m => m && m.id === expectId);
    if (!matched) {
      throw new Error(`未在响应中找到 id=${expectId} 的结果：${text.slice(0, 500)}`);
    }
    if (matched.error) {
      throw new Error(`MCP 错误 ${matched.error.code}：${matched.error.message}`);
    }
    return matched.result;
  }

  async request(method, params, { notify = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const id = notify ? undefined : this.nextId++;
    const body = { jsonrpc: '2.0', method, ...(notify ? {} : { id }), ...(params ? { params } : {}) };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (notify) {
        // 通知无需返回体
        const sid = response.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        return null;
      }
      return await this.parseResponse(response, id);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`请求 MCP 超时：${this.timeoutMs}ms（method=${method}）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'smartway-fetch-doc-pdfs', version: '0.1.0' }
    });
    await this.request('notifications/initialized', undefined, { notify: true });
    return result;
  }

  async listTools() {
    const result = await this.request('tools/list', {});
    return (result && result.tools) || [];
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }
}

// ---------- 业务逻辑 ----------

/** 从 MCP callTool 的返回结构里抽出纯文本 */
function extractTextFromToolResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  const parts = [];
  const content = result.content || result.structuredContent || [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item.text === 'string') parts.push(item.text);
      else if (item) parts.push(JSON.stringify(item));
    }
  } else if (content) {
    parts.push(typeof content === 'string' ? content : JSON.stringify(content));
  }
  return parts.join('\n');
}

/** 从文本中提取 PDF 链接（去重） */
function extractPdfLinks(text) {
  if (!text) return [];
  const regex = /https?:\/\/[^\s"'<>()\][]+/gi;
  const all = text.match(regex) || [];
  const pdfs = all
    .map(u => u.replace(/[.,;:)]+$/, '')) // 去掉行尾标点
    .filter(u => /\.pdf(\?|#|$)/i.test(u) || /\bpdf\b/i.test(new URL(u).pathname));
  return [...new Set(pdfs)];
}

function safeFileNameFromUrl(rawUrl, index) {
  try {
    const u = new URL(rawUrl);
    let name = path.basename(decodeURIComponent(u.pathname));
    if (!name || !/\.pdf$/i.test(name)) name = `doc-${index + 1}.pdf`;
    return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
  } catch {
    return `doc-${index + 1}.pdf`;
  }
}

async function downloadPdf(rawUrl, destDir, index) {
  assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // 命中重定向后的最终地址也要校验，避免被引导到内网
    if (response.url) assertPublicHttpUrl(response.url);

    let fileName = safeFileNameFromUrl(rawUrl, index);
    const disposition = response.headers.get('content-disposition') || '';
    const m = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m && m[1]) fileName = decodeURIComponent(m[1]).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');

    const buffer = Buffer.from(await response.arrayBuffer());
    const dest = path.join(destDir, fileName);
    fs.writeFileSync(dest, buffer);
    return { url: rawUrl, dest, size: buffer.length };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const fileIdArg = argv.find(a => !a.startsWith('--'));
  const fileId = String(fileIdArg || process.env.TENCENT_DOCS_FILE_ID || '').trim();

  const token = readToken();
  if (!fileId) {
    printUsage();
    throw new Error('缺少 file_id（命令行参数或 TENCENT_DOCS_FILE_ID）');
  }

  const client = new McpHttpClient({ endpoint: MCP_ENDPOINT, token, timeoutMs: DEFAULT_TIMEOUT_MS });

  console.log(`连接 MCP：${MCP_ENDPOINT}`);
  const info = await client.initialize();
  console.log(`已连接：${info?.serverInfo?.name || 'tencent-docs'} ${info?.serverInfo?.version || ''}`);

  // 校验 get_content 工具是否存在（可行性验证的一部分）
  try {
    const tools = await client.listTools();
    const hasGetContent = tools.some(t => t.name === 'get_content');
    console.log(`可用工具数：${tools.length}，包含 get_content：${hasGetContent ? '是' : '否'}`);
  } catch (e) {
    console.log(`（tools/list 不可用，跳过：${e.message}）`);
  }

  console.log(`读取文档正文：file_id=${fileId}`);
  const result = await client.callTool('get_content', { file_id: fileId });
  const text = extractTextFromToolResult(result);
  if (!text) {
    console.log('正文为空或未返回文本，原始结果：');
    console.log(JSON.stringify(result, null, 2).slice(0, 2000));
    return;
  }

  const pdfs = extractPdfLinks(text);
  console.log(`\n提取到 ${pdfs.length} 个 PDF 链接：`);
  pdfs.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));

  if (listOnly || pdfs.length === 0) return;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`\n开始下载到：${OUTPUT_DIR}`);
  let ok = 0;
  for (let i = 0; i < pdfs.length; i++) {
    try {
      const r = await downloadPdf(pdfs[i], OUTPUT_DIR, i);
      ok++;
      console.log(`  ✓ ${path.basename(r.dest)}（${(r.size / 1024).toFixed(1)} KB）`);
    } catch (e) {
      console.log(`  ✗ ${pdfs[i]} -> ${e.message}`);
    }
  }
  console.log(`\n完成：成功 ${ok}/${pdfs.length}`);
}

main().catch(error => {
  console.error(`\n失败：${error.message}`);
  process.exit(1);
});
