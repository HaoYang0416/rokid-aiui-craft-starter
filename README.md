# 回声 Echo

面向 Rokid Glasses 的一分钟回溯 demo。用户主动开启后，应用只在内存中滚动保留最近 60 秒声音；说出“Rokid，回声”时，保存触发时刻照片、前一分钟音频，并生成一段 AI 摘要。

> 隐私原则：未触发的声音只存在于内存，停止、离开页面或关闭应用时立即丢弃；只有用户主动触发的片段会发送到伴随服务。

## 当前 demo

- 16 kHz、单声道 PCM 一分钟环形缓冲
- AIUI `onVoiceWakeup` 语音唤醒触发
- Enter / `GlobalHook` 眼镜按键调试触发
- 触发瞬间拍照，拍照失败时自动降级为纯音频
- 在眼镜端把 PCM 封装为 WAV 后上传
- 服务端保存 `audio.wav`、触发照片和 `record.json`
- 配置 OpenAI API 后，先转写音频，再结合照片生成中文摘要
- 网络失败时保留本次片段并提供“重试保存”
- Craft Interactive InkView 未提供原始录音接口时，自动进入有明确标识的模拟模式，用静音占位验证计时、触发、拍照、上传和摘要链路

## 目录

```text
.
├─ src/                    # 可直接导入 Rokid Craft 的 AIUI 工程
│  ├─ pages/index/         # Echo 主界面与交互
│  ├─ lib/                 # 环形缓冲、WAV 编码和上传客户端
│  ├─ AGENTS.md
│  ├─ app.js
│  └─ app.json
├─ server/                 # 本地/云端伴随保存服务
│  └─ data/                # 运行时生成，Git 忽略
├─ tests/                  # 环形缓冲、WAV、页面语法和服务测试
├─ craft/                  # Craft 操作说明
└─ docs/                   # 产品、测试和提审材料
```

## 1. 启动伴随服务

需要 Node.js 20 或更高版本。

```powershell
Copy-Item .env.example .env.local
```

在 `.env.local` 填入 `OPENAI_API_KEY`。如果暂时不填，照片和音频仍会正常保存，返回结果会标记为“AI 未配置”。密钥只放在服务端，不能写入 `src/`。

```powershell
npm run dev:server
```

健康检查地址为 `http://127.0.0.1:8787/health`，保存的回声位于 `server/data/`。

AI 链路使用：

- `gpt-4o-mini-transcribe`：一分钟音频转写
- `gpt-5.6-luna`：结合转写和触发照片生成摘要

模型均可通过 `.env.local` 替换。实现方式对应 OpenAI 官方的[文件转写](https://developers.openai.com/api/docs/guides/speech-to-text)和[图像理解](https://developers.openai.com/api/docs/guides/images-vision)接口，服务端通过 Responses API 发送转写文本与 Base64 触发照片。

## 2. 在 Craft 中运行

1. 在 Rokid Craft 中导入 `src/` 目录。
2. Craft 模拟器和伴随服务在同一台电脑上时，保留 `src/config.js` 中的 `http://127.0.0.1:8787`。
3. 真机测试时，把地址改为电脑的局域网 IP，例如 `http://192.168.1.20:8787`，并确认电脑防火墙允许该端口。
4. 正式提审前改用 HTTPS 服务地址。
5. 当前 Craft Interactive InkView 不提供原始 `RecorderManager`，页面会显示“Craft 模拟模式”；按“开启回声”后可验证一分钟计时和完整保存链路，但生成的 WAV 是静音占位，不含真实环境声音。
6. 缓冲开始后派发语音唤醒，或用 Enter / `GlobalHook` 触发。真机/宿主提供 `RecorderManager` 时会自动改用真实 PCM 录音。

## 语音触发说明

当前公开 AIUI 页面事件稳定提供的是“唤醒词命中”，不保证把完整的“回声”命令文本传给页面。因此 demo 在 Echo 页面处于待命状态时，把一次语音唤醒事件视为“Rokid，回声”。这适合验证完整产品闭环，但会把其他唤醒也当成触发。

后续若宿主开放完整命令文本或 Agent 路由回调，再增加“回声”二次匹配，避免误触发。

## 验证

```powershell
npm test
```

自动测试覆盖一分钟尾部截断、WAV 文件头、AIUI 页面脚本语法，以及无 API Key 时的保存服务闭环。真机媒体和唤醒行为按照 [测试计划](docs/TEST_PLAN.md) 手动验证。

## 当前限制

- 应用必须保持前台；页面隐藏会停止并清空未触发缓冲。
- 一分钟缓冲依赖真机持续提供 PCM 帧，需要完成 1、5、10 分钟稳定性测试。
- Craft 模拟模式不能证明真机录音、权限、音频质量或持续采集稳定性；这些项目必须在提供 `RecorderManager` 的眼镜运行环境中验证。
- 公开 AIUI 没有文件系统写入接口，因此持久化由伴随服务完成。
- 目前没有连续相机帧或前置视频，只保存触发瞬间照片。
- 相机若需要系统预览，具体页面切换行为仍需真机确认。
