import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIRECTORY = join(currentDirectory, 'data');
const DEFAULT_BODY_LIMIT = 24 * 1024 * 1024;

function corsHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...extra,
  };
}

function sendJson(response, statusCode, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(
    statusCode,
    corsHeaders({
      'content-type': 'application/json; charset=utf-8',
      'content-length': encoded.byteLength,
      'cache-control': 'no-store',
    }),
  );
  response.end(encoded);
}

function sendBuffer(response, statusCode, body, contentType) {
  response.writeHead(
    statusCode,
    corsHeaders({
      'content-type': contentType,
      'content-length': body.byteLength,
      'cache-control': 'private, max-age=300',
    }),
  );
  response.end(body);
}

async function readJsonBody(request, limit = DEFAULT_BODY_LIMIT) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > limit) {
      throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw Object.assign(new Error('请求 JSON 无效'), { statusCode: 400 });
  }
}

function decodeBase64(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw Object.assign(new Error(`${fieldName} 不能为空`), { statusCode: 400 });
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.byteLength) {
    throw Object.assign(new Error(`${fieldName} 不是有效的 Base64`), { statusCode: 400 });
  }
  return buffer;
}

function extensionForMimeType(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '';
  }
}

function publicBaseUrl(request) {
  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol : 'http';
  return `${protocol}://${request.headers.host}`;
}

function extractResponseText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

async function openAiRequest(url, options, apiKey) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = { error: { message: text } };
  }
  if (!response.ok) {
    throw new Error(body.error?.message || `OpenAI 请求失败：${response.status}`);
  }
  return body;
}

async function transcribeAudio(audio, config) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'echo.wav');
  form.append('model', config.transcribeModel);
  form.append('language', 'zh');
  form.append('prompt', '这是一段来自智能眼镜的生活场景录音。请准确保留人名、数字、地点、约定和物品名称。');

  const body = await openAiRequest(
    `${config.openAiBaseUrl}/audio/transcriptions`,
    { method: 'POST', body: form },
    config.openAiApiKey,
  );
  return String(body.text || '').trim();
}

async function summarizeEcho(
  { transcript, photo, photoMimeType, durationSeconds, simulated },
  config,
) {
  const audioEvidence = simulated
    ? '音频说明：Craft 模拟器未提供真实录音，本次音频文件为静音占位；不要推断任何对话或环境声音。'
    : `录音转写：${transcript || '没有识别到清晰语音。'}`;
  const content = [
    {
      type: 'input_text',
      text: [
        '你是“回声 Echo”第一视角记忆助手。',
        `以下内容来自用户触发前约 ${Math.round(durationSeconds)} 秒。`,
        '请结合转写和触发时刻画面，用简洁中文写 2 到 3 句话。',
        '优先保留人名、数字、地点、约定、物品及下一步行动。',
        '只陈述证据能够支持的内容；听不清或看不清时明确说明，不要猜测。',
        audioEvidence,
      ].join('\n'),
    },
  ];

  if (photo && photoMimeType) {
    content.push({
      type: 'input_image',
      image_url: `data:${photoMimeType};base64,${photo.toString('base64')}`,
      detail: 'low',
    });
  }

  const body = await openAiRequest(
    `${config.openAiBaseUrl}/responses`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.summaryModel,
        input: [{ role: 'user', content }],
      }),
    },
    config.openAiApiKey,
  );
  return extractResponseText(body);
}

function createConfig(overrides = {}) {
  return {
    dataDirectory: overrides.dataDirectory || DEFAULT_DATA_DIRECTORY,
    bodyLimit: overrides.bodyLimit || DEFAULT_BODY_LIMIT,
    openAiApiKey:
      overrides.openAiApiKey !== undefined ? overrides.openAiApiKey : process.env.OPENAI_API_KEY || '',
    openAiBaseUrl: String(
      overrides.openAiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    ).replace(/\/+$/, ''),
    transcribeModel:
      overrides.transcribeModel || process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
    summaryModel: overrides.summaryModel || process.env.OPENAI_SUMMARY_MODEL || 'gpt-5.6-luna',
  };
}

function loadLocalEnvironment(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const source = readFileSync(filePath, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseTriggeredAt(value) {
  if (value === undefined || value === null || value === '') {
    return { date: new Date(), source: 'server' };
  }

  let candidate = value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    candidate = Number(value);
  }
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    return { date: new Date(), source: 'server_fallback' };
  }
  return { date, source: 'client' };
}

async function createEchoRecord(request, payload, config) {
  const audio = decodeBase64(payload.audioBase64, 'audioBase64');
  const simulated = Boolean(payload.simulated);
  const photo = payload.photoBase64 ? decodeBase64(payload.photoBase64, 'photoBase64') : null;
  const photoMimeType = photo ? String(payload.photoMimeType || '') : '';
  const photoExtension = photo ? extensionForMimeType(photoMimeType) : '';
  if (photo && !photoExtension) {
    throw Object.assign(new Error('仅支持 JPEG、PNG 或 WebP 触发照片'), { statusCode: 400 });
  }

  const parsedTriggeredAt = parseTriggeredAt(payload.triggeredAt);
  const triggeredAt = parsedTriggeredAt.date;

  const durationSeconds = Math.max(0, Math.min(60, Number(payload.durationSeconds) || 0));
  const id = `${triggeredAt.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const recordDirectory = join(config.dataDirectory, id);
  await mkdir(recordDirectory, { recursive: true });
  await writeFile(join(recordDirectory, 'audio.wav'), audio);
  if (photo) {
    await writeFile(join(recordDirectory, `photo${photoExtension}`), photo);
  }

  let transcript = '';
  let summary = '';
  let aiStatus = 'not_configured';
  let aiError = '';

  if (config.openAiApiKey) {
    try {
      if (!simulated) {
        transcript = await transcribeAudio(audio, config);
      }
      summary = await summarizeEcho(
        { transcript, photo, photoMimeType, durationSeconds, simulated },
        config,
      );
      aiStatus = 'complete';
    } catch (error) {
      aiStatus = 'failed';
      aiError = error.message || String(error);
    }
  }

  if (!summary) {
    if (simulated) {
      summary = config.openAiApiKey
        ? 'Craft 模拟片段已经保存，但本次画面摘要生成失败，可以稍后重新处理。'
        : 'Craft 模拟片段已经保存，音频为静音占位。配置服务端 OPENAI_API_KEY 后可生成触发画面摘要。';
    } else {
      summary = config.openAiApiKey
        ? '回声片段已经安全保存，但本次 AI 摘要生成失败，可以稍后重新处理。'
        : '回声片段已经安全保存。配置服务端 OPENAI_API_KEY 后，将自动生成录音转写和画面摘要。';
    }
  }

  const record = {
    id,
    triggeredAt: triggeredAt.toISOString(),
    timestampSource: parsedTriggeredAt.source,
    triggerSource: String(payload.triggerSource || 'unknown'),
    durationSeconds,
    simulated,
    audioFile: 'audio.wav',
    photoFile: photo ? `photo${photoExtension}` : '',
    photoMimeType,
    transcript,
    summary,
    aiStatus,
    aiError,
    models:
      aiStatus === 'not_configured'
        ? null
        : {
            transcription: simulated ? null : config.transcribeModel,
            summary: config.summaryModel,
          },
  };

  await writeFile(join(recordDirectory, 'record.json'), JSON.stringify(record, null, 2), 'utf8');
  await writeFile(join(config.dataDirectory, 'latest.json'), JSON.stringify(record, null, 2), 'utf8');

  const baseUrl = publicBaseUrl(request);
  return {
    ...record,
    audioUrl: `${baseUrl}/api/echoes/${id}/audio`,
    photoUrl: photo ? `${baseUrl}/api/echoes/${id}/photo` : '',
    recordUrl: `${baseUrl}/api/echoes/${id}`,
  };
}

function safeRecordId(value) {
  return /^[A-Za-z0-9-]+$/.test(value || '') ? value : '';
}

async function readRecord(dataDirectory, id) {
  const safeId = safeRecordId(id);
  if (!safeId) {
    throw Object.assign(new Error('记录 ID 无效'), { statusCode: 400 });
  }
  const recordPath = join(dataDirectory, safeId, 'record.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  return { record, recordDirectory: dirname(recordPath) };
}

export function createEchoServer(overrides = {}) {
  const config = createConfig(overrides);

  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    try {
      const url = new URL(request.url || '/', publicBaseUrl(request));
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          product: 'Echo',
          aiConfigured: Boolean(config.openAiApiKey),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/echoes') {
        const payload = await readJsonBody(request, config.bodyLimit);
        const result = await createEchoRecord(request, payload, config);
        sendJson(response, 201, result);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/echoes/latest') {
        const record = JSON.parse(await readFile(join(config.dataDirectory, 'latest.json'), 'utf8'));
        sendJson(response, 200, record);
        return;
      }

      const match = url.pathname.match(/^\/api\/echoes\/([^/]+)(?:\/(audio|photo))?$/);
      if (request.method === 'GET' && match) {
        const id = safeRecordId(match[1]);
        const asset = match[2] || '';
        const { record, recordDirectory } = await readRecord(config.dataDirectory, id);
        if (!asset) {
          sendJson(response, 200, record);
          return;
        }
        if (asset === 'audio') {
          const audio = await readFile(join(recordDirectory, basename(record.audioFile)));
          sendBuffer(response, 200, audio, 'audio/wav');
          return;
        }
        if (asset === 'photo' && record.photoFile) {
          const photo = await readFile(join(recordDirectory, basename(record.photoFile)));
          sendBuffer(response, 200, photo, record.photoMimeType || 'application/octet-stream');
          return;
        }
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'ENOENT' ? 404 : 500);
      sendJson(response, statusCode, {
        error: statusCode === 500 ? 'Echo 服务处理失败' : error.message,
        detail: statusCode === 500 ? error.message : undefined,
      });
    }
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  loadLocalEnvironment(join(currentDirectory, '..', '.env.local'));
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const server = createEchoServer();
  server.listen(port, host, () => {
    console.log(`Echo service listening on http://${host}:${port}`);
    console.log(`AI summary: ${process.env.OPENAI_API_KEY ? 'configured' : 'not configured'}`);
  });
}
