import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEchoServer } from '../server/index.mjs';

test('server saves an audio and photo capsule without exposing an API key', async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'echo-server-test-'));
  const server = createEchoServer({ dataDirectory, openAiApiKey: '' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.aiConfigured, false);

  const audio = Buffer.from('RIFF-test-audio');
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const response = await fetch(`${baseUrl}/api/echoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      triggeredAt: '2026-08-15T08:00:00.000Z',
      triggerSource: 'test',
      durationSeconds: 12.5,
      audioMimeType: 'audio/wav',
      audioBase64: audio.toString('base64'),
      photoMimeType: 'image/jpeg',
      photoBase64: photo.toString('base64'),
    }),
  });

  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.aiStatus, 'not_configured');
  assert.match(record.summary, /OPENAI_API_KEY/);
  assert.match(record.audioUrl, /\/audio$/);
  assert.match(record.photoUrl, /\/photo$/);

  const savedAudio = await readFile(join(dataDirectory, record.id, 'audio.wav'));
  assert.deepEqual(savedAudio, audio);

  const fetchedAudio = Buffer.from(await fetch(record.audioUrl).then((result) => result.arrayBuffer()));
  assert.deepEqual(fetchedAudio, audio);

  const summaryResponse = await fetch(`${baseUrl}/api/echoes/${record.id}/summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: '默认模型确认：桌面上有一张写着 15:30 的便签。',
      source: 'rokid-default-llm',
    }),
  });
  assert.equal(summaryResponse.status, 200);
  const updatedRecord = await summaryResponse.json();
  assert.equal(updatedRecord.summarySource, 'rokid-default-llm');
  assert.equal(updatedRecord.aiStatus, 'complete');
  assert.match(updatedRecord.summary, /15:30/);

  const latest = await fetch(`${baseUrl}/api/echoes/latest`).then((result) => result.json());
  assert.equal(latest.summary, updatedRecord.summary);
  assert.equal(latest.summarySource, 'rokid-default-llm');
});

test('server labels Craft simulator audio and does not claim it contains a recording', async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'echo-simulator-test-'));
  const server = createEchoServer({ dataDirectory, openAiApiKey: '' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/echoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      triggerSource: 'craft-simulator',
      triggeredAt: 'Craft Invalid Date',
      durationSeconds: 1,
      audioBase64: Buffer.from('RIFF-silence-placeholder').toString('base64'),
      simulated: true,
    }),
  });

  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.simulated, true);
  assert.equal(record.timestampSource, 'server_fallback');
  assert.equal(Number.isNaN(Date.parse(record.triggeredAt)), false);
  assert.match(record.summary, /静音占位/);
});
