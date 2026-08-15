export const DEFAULT_AUDIO_FORMAT = Object.freeze({
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  maxSeconds: 60,
});

function asBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value && value.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
  }
  throw new TypeError('Expected an ArrayBuffer or Uint8Array');
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export class RollingPcmBuffer {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || DEFAULT_AUDIO_FORMAT.sampleRate;
    this.channels = options.channels || DEFAULT_AUDIO_FORMAT.channels;
    this.bitsPerSample = options.bitsPerSample || DEFAULT_AUDIO_FORMAT.bitsPerSample;
    this.maxSeconds = options.maxSeconds || DEFAULT_AUDIO_FORMAT.maxSeconds;
    this.blockAlign = this.channels * (this.bitsPerSample / 8);
    this.bytesPerSecond = this.sampleRate * this.blockAlign;
    this.maxBytes = Math.floor(this.maxSeconds * this.bytesPerSecond);
    this.chunks = [];
    this.totalBytes = 0;
  }

  append(frameBuffer) {
    const incoming = asBytes(frameBuffer);
    if (!incoming.byteLength) {
      return;
    }

    let copy = new Uint8Array(incoming.byteLength);
    copy.set(incoming);

    if (copy.byteLength >= this.maxBytes) {
      const start = copy.byteLength - this.maxBytes;
      const alignedStart =
        start + ((this.blockAlign - (start % this.blockAlign)) % this.blockAlign);
      copy = copy.slice(alignedStart);
      this.chunks = [copy];
      this.totalBytes = copy.byteLength;
      return;
    }

    this.chunks.push(copy);
    this.totalBytes += copy.byteLength;
    this.trimToWindow();
  }

  trimToWindow() {
    let overflow = this.totalBytes - this.maxBytes;
    if (overflow <= 0) {
      return;
    }

    overflow = Math.ceil(overflow / this.blockAlign) * this.blockAlign;
    while (overflow > 0 && this.chunks.length) {
      const first = this.chunks[0];
      if (first.byteLength <= overflow) {
        this.chunks.shift();
        this.totalBytes -= first.byteLength;
        overflow -= first.byteLength;
        continue;
      }

      this.chunks[0] = first.slice(overflow);
      this.totalBytes -= overflow;
      overflow = 0;
    }
  }

  get durationSeconds() {
    return this.totalBytes / this.bytesPerSecond;
  }

  snapshot() {
    const result = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  clear() {
    this.chunks = [];
    this.totalBytes = 0;
  }
}

export function pcm16ToWav(pcm, options = {}) {
  const sampleRate = options.sampleRate || DEFAULT_AUDIO_FORMAT.sampleRate;
  const channels = options.channels || DEFAULT_AUDIO_FORMAT.channels;
  const bitsPerSample = options.bitsPerSample || DEFAULT_AUDIO_FORMAT.bitsPerSample;
  const pcmBytes = asBytes(pcm);
  const headerSize = 44;
  const result = new ArrayBuffer(headerSize + pcmBytes.byteLength);
  const view = new DataView(result);
  const output = new Uint8Array(result);
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);
  output.set(pcmBytes, headerSize);

  return result;
}
