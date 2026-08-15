export const ECHO_CONFIG = Object.freeze({
  // Craft 模拟器可使用 127.0.0.1。真机请改成电脑的局域网 IP 或 HTTPS 地址。
  apiBaseUrl: 'http://127.0.0.1:8787',
  rewindSeconds: 60,
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  requestTimeoutMs: 120000,
});
