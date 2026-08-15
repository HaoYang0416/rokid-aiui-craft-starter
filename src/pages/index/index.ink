<script type="application/json" def>
{
  "navigationBarTitleText": "回声 Echo",
  "description": "维护最近一分钟声音缓冲，并在用户说出回声指令时保存触发照片、音频和 AI 摘要。",
  "schema": {
    "data": {
      "type": "object",
      "properties": {}
    }
  }
}
</script>

<script setup>
import wx from 'wx';
import { ECHO_CONFIG } from '../../config.js';
import { RollingPcmBuffer, pcm16ToWav } from '../../lib/rolling-audio.js';
import { saveEchoCapsule } from '../../lib/echo-api.js';

function formatSeconds(value) {
  const seconds = Math.max(0, Math.min(ECHO_CONFIG.rewindSeconds, Math.floor(value || 0)));
  return `00:${String(seconds).padStart(2, '0')}`;
}

function formatSavedAt(value) {
  const date = value ? new Date(value) : new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function errorText(error) {
  if (!error) {
    return '未知错误';
  }
  return error.message || error.errMsg || String(error);
}

const SIMULATED_FRAME_MS = 500;

export default {
  data: {
    phase: 'idle',
    phaseLabel: '尚未开启',
    helperText: '按一次开启回声，开始滚动保留最近一分钟声音',
    bufferedSeconds: 0,
    bufferLabel: '00:00',
    isArmed: false,
    isBusy: false,
    canRetry: false,
    lastError: '',
    triggerLabel: '',
    summary: '',
    transcript: '',
    photoUrl: '',
    audioUrl: '',
    savedAt: '',
    aiStatus: '',
    simulatorMode: false,
    modeBadge: '未触发即丢弃',
  },

  onLoad() {
    this.audioBuffer = new RollingPcmBuffer({
      sampleRate: ECHO_CONFIG.sampleRate,
      channels: ECHO_CONFIG.channels,
      bitsPerSample: ECHO_CONFIG.bitsPerSample,
      maxSeconds: ECHO_CONFIG.rewindSeconds,
    });
    this.pendingEcho = null;
    this.stopReason = '';
    this.setupRecorder();
  },

  onReady() {
    this.setupCamera();
  },

  onShow() {
    this.setupCamera();
  },

  onHide() {
    if (this.data.phase === 'capturing' || this.data.phase === 'processing') {
      return;
    }
    this.disarmEcho({ silent: true });
  },

  onUnload() {
    this.disarmEcho({ silent: true });
    this.cameraCtx = null;
    this.pendingEcho = null;
  },

  setupCamera() {
    try {
      if (wx.media && typeof wx.media.createCameraContext === 'function') {
        this.cameraCtx = wx.media.createCameraContext();
        return;
      }
      if (typeof wx.createCameraContext === 'function') {
        this.cameraCtx = wx.createCameraContext();
      }
    } catch (error) {
      console.warn('Echo camera unavailable', errorText(error));
      this.cameraCtx = null;
    }
  },

  setupRecorder() {
    let recorder;
    try {
      if (wx.media && typeof wx.media.getRecorderManager === 'function') {
        recorder = wx.media.getRecorderManager();
      } else if (typeof wx.getRecorderManager === 'function') {
        recorder = wx.getRecorderManager();
      }
    } catch (error) {
      console.warn('Echo recorder unavailable', errorText(error));
      this.enableSimulatorMode();
      return;
    }

    if (!recorder) {
      this.enableSimulatorMode();
      return;
    }

    this.simulatorMode = false;
    this.recorder = recorder;
    recorder.onStart(() => {
      this.setData({
        phase: 'armed',
        phaseLabel: '正在回听',
        helperText: '说“Rokid，回声”保存刚才一分钟',
        isArmed: true,
        isBusy: false,
        lastError: '',
      });
      this.startBufferMeter();
    });

    recorder.onFrameRecorded((payload) => {
      if (!this.data.isArmed || !this.audioBuffer || !payload || !payload.frameBuffer) {
        return;
      }
      try {
        this.audioBuffer.append(payload.frameBuffer);
      } catch (error) {
        this.showError(`音频缓冲失败：${errorText(error)}`);
      }
    });

    recorder.onError((payload) => {
      this.stopBufferMeter();
      this.showError(`录音失败：${(payload && payload.errMsg) || '未知错误'}`);
    });

    recorder.onInterruptionBegin(() => {
      if (!this.data.isBusy) {
        this.setData({
          phaseLabel: '录音被中断',
          helperText: '返回页面后请重新开启回声',
          isArmed: false,
        });
      }
    });

    recorder.onInterruptionEnd(() => {
      if (!this.data.isBusy && !this.data.isArmed) {
        this.setData({ helperText: '按一次重新开启回声' });
      }
    });

    recorder.onStop(() => {
      this.stopBufferMeter();
      if (this.stopReason === 'capture' || this.stopReason === 'privacy') {
        this.stopReason = '';
        return;
      }
      this.setData({
        phase: 'idle',
        phaseLabel: '回听已停止',
        helperText: '按一次重新开启回声',
        isArmed: false,
        isBusy: false,
      });
    });
  },

  enableSimulatorMode() {
    this.simulatorMode = true;
    this.recorder = null;
    this.setData({
      phase: 'idle',
      phaseLabel: 'Craft 模拟模式',
      helperText: '可验证触发、拍照与保存；真实录音需在眼镜上测试',
      simulatorMode: true,
      modeBadge: 'Craft 模拟音频',
      lastError: '',
    });
  },

  startSimulatedRecording() {
    this.stopSimulatedRecording();
    const bytesPerSecond =
      ECHO_CONFIG.sampleRate * ECHO_CONFIG.channels * (ECHO_CONFIG.bitsPerSample / 8);
    const silenceFrame = new ArrayBuffer(
      Math.floor(bytesPerSecond * (SIMULATED_FRAME_MS / 1000)),
    );

    this.setData({
      phase: 'armed',
      phaseLabel: '模拟回听中',
      helperText: '仅模拟一分钟计时；语音唤醒或按键可触发完整流程',
      isArmed: true,
      isBusy: false,
      lastError: '',
    });
    this.simulationAudioTimer = setInterval(() => {
      if (this.data.isArmed && !this.data.isBusy && this.audioBuffer) {
        this.audioBuffer.append(silenceFrame);
      }
    }, SIMULATED_FRAME_MS);
    this.startBufferMeter();
  },

  stopSimulatedRecording() {
    if (this.simulationAudioTimer) {
      clearInterval(this.simulationAudioTimer);
      this.simulationAudioTimer = null;
    }
  },

  startBufferMeter() {
    this.stopBufferMeter();
    this.bufferMeter = setInterval(() => {
      this.refreshBufferMeter();
    }, 500);
  },

  stopBufferMeter() {
    if (this.bufferMeter) {
      clearInterval(this.bufferMeter);
      this.bufferMeter = null;
    }
    this.refreshBufferMeter();
  },

  refreshBufferMeter() {
    const seconds = this.audioBuffer ? this.audioBuffer.durationSeconds : 0;
    this.setData({
      bufferedSeconds: Math.floor(seconds),
      bufferLabel: formatSeconds(seconds),
    });
  },

  async armEcho() {
    if (this.data.isArmed || this.data.isBusy) {
      return;
    }

    this.audioBuffer.clear();
    this.pendingEcho = null;
    this.setData({
      phase: 'starting',
      phaseLabel: this.simulatorMode ? '正在开启模拟' : '正在开启',
      helperText: this.simulatorMode ? '准备静音占位缓冲' : '请允许麦克风访问',
      bufferedSeconds: 0,
      bufferLabel: '00:00',
      isBusy: true,
      canRetry: false,
      lastError: '',
      summary: '',
      transcript: '',
      photoUrl: '',
      audioUrl: '',
      savedAt: '',
      aiStatus: '',
    });

    if (this.simulatorMode) {
      this.startSimulatedRecording();
      return;
    }

    if (!this.recorder) {
      this.showError('当前环境没有提供录音能力');
      return;
    }

    try {
      await this.recorder.start({
        sampleRate: ECHO_CONFIG.sampleRate,
        numberOfChannels: ECHO_CONFIG.channels,
        format: 'pcm',
      });
    } catch (error) {
      this.showError(`无法开启回声：${errorText(error)}`);
    }
  },

  async disarmEcho(options = {}) {
    this.stopSimulatedRecording();
    this.stopBufferMeter();
    if (this.recorder && (this.data.isArmed || this.data.phase === 'starting')) {
      this.stopReason = 'privacy';
      try {
        await this.recorder.stop();
      } catch (_) {}
    }
    if (this.audioBuffer) {
      this.audioBuffer.clear();
    }
    this.pendingEcho = null;
    const nextData = {
      bufferedSeconds: 0,
      bufferLabel: '00:00',
      isArmed: false,
      isBusy: false,
      canRetry: false,
    };
    if (!options.silent) {
      Object.assign(nextData, {
        phase: 'idle',
        phaseLabel: '已停止并清除',
        helperText: '未触发的声音已经丢弃',
      });
    }
    this.setData(nextData);
  },

  async captureTriggerPhoto() {
    if (!this.cameraCtx) {
      this.setupCamera();
    }
    if (!this.cameraCtx || typeof this.cameraCtx.takePhoto !== 'function') {
      throw new Error('相机不可用');
    }
    return this.cameraCtx.takePhoto({
      quality: 'high',
      enableSystemPreview: false,
    });
  },

  async triggerEcho(source) {
    if (!this.data.isArmed || this.data.isBusy) {
      return;
    }

    const durationSeconds = this.audioBuffer.durationSeconds;
    if (durationSeconds < 0.25) {
      this.showError('缓冲中还没有足够的声音，请稍后再试');
      return;
    }

    const pcmSnapshot = this.audioBuffer.snapshot();
    const sourceLabel = source === 'voice' ? '语音“Rokid，回声”' : '眼镜按键';
    this.setData({
      phase: 'capturing',
      phaseLabel: '正在定格',
      helperText: '保存触发画面与刚才一分钟',
      isArmed: false,
      isBusy: true,
      canRetry: false,
      lastError: '',
      triggerLabel: sourceLabel,
    });

    const photoPromise = this.captureTriggerPhoto().catch((error) => {
      console.warn('Echo photo capture failed', errorText(error));
      return null;
    });

    this.stopReason = 'capture';
    if (this.simulatorMode) {
      this.stopSimulatedRecording();
      this.stopBufferMeter();
    } else {
      try {
        await this.recorder.stop();
      } catch (error) {
        console.warn('Echo recorder stop failed', errorText(error));
      }
    }

    try {
      const photo = await photoPromise;
      const wav = pcm16ToWav(pcmSnapshot, {
        sampleRate: ECHO_CONFIG.sampleRate,
        channels: ECHO_CONFIG.channels,
        bitsPerSample: ECHO_CONFIG.bitsPerSample,
      });
      const triggeredAt = new Date().toISOString();
      this.pendingEcho = {
        triggeredAt,
        triggerSource: source,
        durationSeconds,
        audioMimeType: 'audio/wav',
        audioBase64: wx.arrayBufferToBase64(wav),
        photoMimeType: photo && photo.mimeType ? photo.mimeType : '',
        photoBase64: photo && photo.data ? wx.arrayBufferToBase64(photo.data) : '',
        simulated: this.simulatorMode,
      };
      await this.uploadPendingEcho();
    } catch (error) {
      this.showSaveError(error);
    }
  },

  async uploadPendingEcho() {
    if (!this.pendingEcho) {
      this.showError('没有可以重试的回声片段');
      return;
    }

    this.setData({
      phase: 'processing',
      phaseLabel: 'AI 正在回想',
      helperText: this.simulatorMode ? '保存模拟片段并理解触发画面' : '转写声音并理解触发画面',
      isBusy: true,
      canRetry: false,
      lastError: '',
    });

    try {
      const result = await saveEchoCapsule({
        apiBaseUrl: ECHO_CONFIG.apiBaseUrl,
        timeout: ECHO_CONFIG.requestTimeoutMs,
        payload: this.pendingEcho,
      });
      this.setData({
        phase: 'saved',
        phaseLabel: '回声已保存',
        helperText: this.simulatorMode
          ? 'Craft 流程已验证；真实录音请在眼镜上测试'
          : '按一次可开启下一段回溯',
        isBusy: false,
        canRetry: false,
        summary: result.summary || '片段已保存，暂时没有生成摘要。',
        transcript: result.transcript || '',
        photoUrl: result.photoUrl || '',
        audioUrl: result.audioUrl || '',
        savedAt: formatSavedAt(result.triggeredAt || this.pendingEcho.triggeredAt),
        aiStatus: result.aiStatus || '',
      });
      this.pendingEcho = null;
      this.audioBuffer.clear();
      this.refreshBufferMeter();
    } catch (error) {
      this.showSaveError(error);
    }
  },

  retrySave() {
    this.uploadPendingEcho();
  },

  showSaveError(error) {
    this.stopBufferMeter();
    this.setData({
      phase: 'error',
      phaseLabel: '保存未完成',
      helperText: '片段仍保留在内存中，可以重试',
      isArmed: false,
      isBusy: false,
      canRetry: !!this.pendingEcho,
      lastError: errorText(error),
    });
  },

  showError(message) {
    this.stopBufferMeter();
    this.setData({
      phase: 'error',
      phaseLabel: '需要处理',
      helperText: message,
      isArmed: false,
      isBusy: false,
      lastError: message,
    });
  },

  onVoiceWakeup(event) {
    if (!this.data.isArmed || this.data.isBusy) {
      return;
    }
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    this.triggerEcho('voice');
  },

  onKeyUp(event) {
    if (!event || (event.code !== 'Enter' && event.code !== 'GlobalHook')) {
      return;
    }
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (this.data.isArmed) {
      this.triggerEcho('key');
      return;
    }
    if (!this.data.isBusy && !this.data.canRetry) {
      this.armEcho();
    }
  },
};
</script>

<page>
  <view class="page-shell">
    <view class="top-row">
      <text class="brand">回声 ECHO</text>
      <text class="privacy">{{modeBadge}}</text>
    </view>

    <view class="memory-orb {{isArmed ? 'memory-orb-armed' : ''}}">
      <text class="buffer-time">{{bufferLabel}}</text>
      <text class="buffer-total">/ 01:00</text>
    </view>

    <view class="status-block">
      <text class="status-title">{{phaseLabel}}</text>
      <text class="status-helper">{{helperText}}</text>
    </view>

    <view class="action-row" role="navigation">
      <button
        ink:if="{{!isArmed && !isBusy && !canRetry}}"
        class="primary-button"
        bindtap="armEcho"
      >开启回声</button>
      <button
        ink:if="{{isArmed && !isBusy}}"
        class="secondary-button"
        bindtap="disarmEcho"
      >停止并清除</button>
      <button
        ink:if="{{canRetry && !isBusy}}"
        class="primary-button"
        bindtap="retrySave"
      >重试保存</button>
    </view>

    <view class="result-card" ink:if="{{phase === 'saved'}}">
      <image
        ink:if="{{photoUrl}}"
        class="trigger-photo"
        src="{{photoUrl}}"
        mode="aspectFit"
      ></image>
      <view class="result-copy">
        <text class="result-meta">{{savedAt}} · {{triggerLabel}}{{simulatorMode ? ' · 模拟音频' : ''}}</text>
        <text class="summary">{{summary}}</text>
        <text class="transcript" ink:if="{{transcript}}">“{{transcript}}”</text>
      </view>
    </view>

    <view class="error-card" ink:if="{{lastError}}">
      <text class="error-text">{{lastError}}</text>
    </view>

    <text class="footnote" ink:if="{{isArmed}}">{{simulatorMode ? 'Craft 未录入真实声音；语音唤醒或按键可触发' : '语音唤醒或 Enter / 镜腿键均可触发'}}</text>
  </view>
</page>

<style>
.page-shell {
  --echo-green: #40ff5e;
  --echo-green-soft: #143f20;
  --echo-black: #020603;
  --echo-surface: #08110a;
  --echo-line: #1b4d27;
  --echo-muted: #87a78d;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  background-color: var(--echo-black);
  color: var(--echo-green);
}

.top-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 15px;
  line-height: 18px;
  font-weight: 700;
  color: var(--echo-green);
}

.privacy {
  font-size: 11px;
  line-height: 14px;
  color: var(--echo-muted);
}

.memory-orb {
  width: 126px;
  height: 126px;
  box-sizing: border-box;
  border: 2px solid var(--echo-line);
  border-radius: 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--echo-surface);
  box-shadow: 0 0 18px #12351a;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.memory-orb-armed {
  border-color: var(--echo-green);
  box-shadow: 0 0 24px #1a6d2b;
}

.buffer-time {
  font-size: 31px;
  line-height: 34px;
  font-weight: 700;
  color: var(--echo-green);
}

.buffer-total {
  font-size: 12px;
  line-height: 16px;
  color: var(--echo-muted);
}

.status-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.status-title {
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
  text-align: center;
  color: var(--echo-green);
}

.status-helper {
  width: 100%;
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  color: var(--echo-muted);
}

.action-row {
  width: 100%;
  display: flex;
  justify-content: center;
}

.primary-button, .secondary-button {
  width: 170px;
  box-sizing: border-box;
  padding: 9px 14px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 18px;
  text-align: center;
}

.primary-button {
  color: var(--echo-black);
  background-color: var(--echo-green);
  border: 1px solid var(--echo-green);
}

.secondary-button {
  color: var(--echo-green);
  background-color: var(--echo-surface);
  border: 1px solid var(--echo-line);
}

.result-card {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--echo-line);
  border-radius: 14px;
  background-color: var(--echo-surface);
}

.trigger-photo {
  width: 112px;
  height: 84px;
  border-radius: 10px;
  background-color: #000000;
}

.result-copy {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.result-meta {
  font-size: 10px;
  line-height: 13px;
  color: var(--echo-muted);
}

.summary {
  font-size: 13px;
  line-height: 17px;
  color: #d9ffe0;
}

.transcript {
  font-size: 11px;
  line-height: 15px;
  color: var(--echo-muted);
  font-style: italic;
}

.error-card {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #7d3030;
  border-radius: 10px;
  background-color: #210909;
}

.error-text {
  font-size: 12px;
  line-height: 16px;
  color: #ffb3b3;
  text-align: center;
}

.footnote {
  font-size: 10px;
  line-height: 13px;
  color: var(--echo-muted);
  text-align: center;
}
</style>
