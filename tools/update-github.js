#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const DEFAULT_TIMEOUT_MS = 60 * 1000;

function printUsage() {
  console.log(`用法：
  在项目根目录 .env 中配置 SMARTWAY_UPDATE_URL 和 SMARTWAY_UPDATE_TOKEN 后执行：npm run update:github

.env 示例：
  SMARTWAY_UPDATE_URL="https://你的域名/api/github/update"
  SMARTWAY_UPDATE_TOKEN="你的安全令牌"

可选环境变量：
  SMARTWAY_UPDATE_TIMEOUT_MS=60000
  SMARTWAY_RESTART=1   # 更新成功后请求远端 Web 服务重启
`);
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readConfig() {
  const url = String(process.env.SMARTWAY_UPDATE_URL || '').trim();
  const token = String(process.env.SMARTWAY_UPDATE_TOKEN || '').trim();
  const timeoutMs = Number(process.env.SMARTWAY_UPDATE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const restart = isEnabled(process.env.SMARTWAY_RESTART);

  if (!url || !token) {
    printUsage();
    throw new Error('缺少 SMARTWAY_UPDATE_URL 或 SMARTWAY_UPDATE_TOKEN');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error('SMARTWAY_UPDATE_URL 不是合法 URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('SMARTWAY_UPDATE_URL 只支持 http 或 https');
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('SMARTWAY_UPDATE_TIMEOUT_MS 必须是正数');
  }

  return { url: parsedUrl.toString(), token, timeoutMs, restart };
}

async function updateGithub({ url, token, timeoutMs, restart }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ restart }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { raw: text };
    }

    if (!response.ok) {
      const message = data.error || data.raw || `请求失败：HTTP ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.details = data.details;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.name === 'AbortError') {
      throw new Error(`请求远端更新接口超时：${timeoutMs}ms`);
    }

    const cause = error.cause?.message || error.cause?.code || '';
    const message = cause
      ? `请求远端更新接口失败：${error.message}（${cause}）`
      : `请求远端更新接口失败：${error.message}`;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const config = readConfig();
  const result = await updateGithub(config);

  console.log('GitHub 内容更新接口调用成功');
  console.log(`分支：${result.branch || '-'}`);
  console.log(`是否更新：${result.updated ? '是' : '否'}`);
  if (result.before) console.log(`更新前：${result.before}`);
  if (result.after) console.log(`更新后：${result.after}`);
  console.log(`远端重启：${result.restartScheduled ? '已安排' : '未安排'}`);
  if (result.output) console.log(`输出：${result.output}`);
}

main().catch(error => {
  console.error(`调用失败：${error.message}`);
  if (error.details) {
    console.error('详情：');
    console.error(Array.isArray(error.details) ? error.details.join('\n') : String(error.details));
  }
  process.exit(1);
});
