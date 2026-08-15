# Rokid Craft 操作记录

## 导入

- 工程目录：`src/`
- 首页：`pages/index/index`
- 应用名称：`回声 Echo`
- 版本：`0.1.0`

## 模拟器验证顺序

1. 先在仓库根目录运行 `npm run dev:server`。
2. 在 Craft 的 LLM 配置中把来源设为“系统默认 LLM”。工程不会指定模型名或 API Key。
3. 导入 `src/` 并打开 Interactive InkView。
4. Interactive InkView 会显示“Craft 模拟模式”；按“开启回声”启动静音占位缓冲。
5. 等待缓冲计时增长。这里验证的是交互流程，不是真实麦克风录音。
6. 在设备面板派发语音唤醒，或发送 Enter / `GlobalHook`。
7. 在相机面板上传图片或选择 Webcam 拍照。
8. 确认界面依次显示“正在定格”“AI 正在回想”“回声已保存”，结果时间旁显示“Rokid 默认 LLM”。
9. 检查 `server/data/<记录 ID>/` 中存在静音占位 WAV、照片和记录 JSON，且 `record.json` 中的 `simulated` 为 `true`、`summarySource` 为 `rokid-default-llm`。

真实录音需要在提供 `wx.media.getRecorderManager()` 的眼镜运行环境中验证；应用检测到该接口后会自动退出模拟模式并使用 PCM 帧。

如果真机停在“正在请求真机录音能力”，新版会在 10 秒内给出明确诊断。先在眼镜系统设置中确认运行 AIUI 应用的宿主拥有麦克风权限；若已经允许，运行官方 AIUI 仓库的 `samples/capabilities/pages/recorder` 示例。官方示例也无法收到 `onStart` 或 PCM 帧时，说明问题位于当前宿主/固件的原始录音能力，而不是 Echo 的参数配置。

## 真机地址

Craft 模拟器可以访问 `127.0.0.1`；眼镜真机不能把该地址当作电脑。真机联调前修改 `src/config.js`：

```js
apiBaseUrl: 'http://电脑的局域网IP:8787'
```

正式提交必须换成可访问的 HTTPS 地址，不要把 OpenAI API Key 放进 AIUI 工程。宿主默认 LLM 只接收转写文本和触发照片；真实 WAV 仍由伴随服务转写。

## 打包前

- 把 `src/config.js` 切换到生产 HTTPS 地址。
- 复核 `AGENTS.md` 只声明 camera、microphone、network 三项权限。
- 删除调试日志中的个人数据。
- 录制一段“开启 → 等待 → 说回声 → 展示记忆卡片”的演示视频。
- 根据真机结果更新 `docs/TEST_PLAN.md`。
