import assert from 'node:assert/strict';
import test from 'node:test';
import { RollingPcmBuffer, pcm16ToWav } from '../src/lib/rolling-audio.js';

test('production buffer is capped at one minute of 16 kHz mono PCM16', () => {
  const buffer = new RollingPcmBuffer();
  assert.equal(buffer.maxSeconds, 60);
  assert.equal(buffer.bytesPerSecond, 32000);
  assert.equal(buffer.maxBytes, 1920000);
});

test('rolling buffer keeps only the newest configured window', () => {
  const buffer = new RollingPcmBuffer({
    sampleRate: 4,
    channels: 1,
    bitsPerSample: 16,
    maxSeconds: 1,
  });

  buffer.append(Uint8Array.from([0, 1, 2, 3]).buffer);
  buffer.append(Uint8Array.from([4, 5, 6, 7, 8, 9]).buffer);

  assert.equal(buffer.totalBytes, 8);
  assert.equal(buffer.durationSeconds, 1);
  assert.deepEqual(Array.from(new Uint8Array(buffer.snapshot())), [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('wav encoder writes a valid mono PCM header', () => {
  const pcm = Uint8Array.from([1, 2, 3, 4]).buffer;
  const wav = pcm16ToWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);

  assert.equal(Buffer.from(bytes.slice(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(Buffer.from(bytes.slice(8, 12)).toString('ascii'), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 4);
  assert.deepEqual(Array.from(bytes.slice(44)), [1, 2, 3, 4]);
});
