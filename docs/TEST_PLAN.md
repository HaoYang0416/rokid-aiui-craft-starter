# 回声 Echo 测试计划

每轮测试记录 Craft 版本、眼镜型号、系统版本、应用版本、日期和证据。

| Area | Scenario | Expected result | Craft | Device | Status |
|---|---|---|---|---|---|
| Launch | 首次启动 | 显示“尚未开启”，不会自动录音 | 待测 | 待测 | Not run |
| Craft fallback | Interactive InkView 不提供 RecorderManager | 明确显示“Craft 模拟模式”，可完成计时、触发、拍照和保存；不声称录到真实声音 | 待测 | N/A | Not run |
| Permission | 点击开启并允许麦克风 | 进入“正在回听”，缓冲计时增长 | 待测 | 待测 | Not run |
| Permission | 拒绝麦克风 | 给出可恢复错误，不上传任何数据 | 待测 | 待测 | Not run |
| Recorder startup | 宿主不返回 `onStart`/`onError` | 10 秒内退出“正在开启”并显示权限/官方 Recorder Test 诊断，不永久卡住 | 待测 | 待测 | Not run |
| Recorder frames | 已启动但不提供 PCM 帧 | 6 秒内停止并明确提示当前宿主可能未开放原始录音 | 待测 | 待测 | Not run |
| Buffer | 连续录音 75 秒 | 缓冲显示封顶 01:00，只保存最后 60 秒 | 待测 | 待测 | Not run |
| Stability | 连续运行 10 分钟 | 不崩溃，内存不持续增长 | 待测 | 待测 | Not run |
| Voice | 说“Rokid，回声” | 触发一次保存，不重复触发 | 待测 | 待测 | Not run |
| Key | Enter / GlobalHook | 与语音触发进入相同保存流程 | 待测 | 待测 | Not run |
| Camera | 拍照成功 | 保存触发照片并显示在结果卡片 | 待测 | 待测 | Not run |
| Camera | 拍照失败 | 音频仍保存，摘要按纯音频降级 | 待测 | 待测 | Not run |
| AI | 中文人名与数字 | 转写和摘要保留关键信息且不编造 | 待测 | 待测 | Not run |
| AI | 系统默认 LLM 可用 | 自动使用宿主默认模型，结果标记“Rokid 默认 LLM”，且记录回写 `summarySource` | 待测 | 待测 | Not run |
| AI fallback | 系统默认 LLM 不可用 | 保存仍成功；有服务端摘要时显示“伴随服务 AI”，否则显示安全的占位说明 | 待测 | 待测 | Not run |
| Network | 服务不可达 | 显示“保存未完成”，允许重试 | 待测 | 待测 | Not run |
| Retry | 网络恢复后重试 | 同一片段成功保存，不要求重新录音 | 待测 | 待测 | Not run |
| Privacy | 点击停止并清除 | 缓冲归零，服务端没有新增记录 | 待测 | 待测 | Not run |
| Privacy | 页面切入后台 | 未触发缓冲停止并清空 | 待测 | 待测 | Not run |
| Interrupt | 电话/TTS/系统占用麦克风 | 显示中断状态，可由用户重新开启 | 待测 | 待测 | Not run |

## 自动测试

运行 `npm test`，当前覆盖：

- 环形缓冲只保留最新窗口
- PCM16 WAV 文件头与数据长度
- AIUI `.ink` 配置与 JavaScript 语法
- 无 AI Key 时仍可保存音频和照片
- 已保存音频可通过服务 URL 读取
- 宿主默认 LLM 摘要可回写记录与 `latest.json`

## 必须记录的性能数据

- 1、5、10 分钟时的进程内存
- 10 分钟持续录音的电量下降与镜腿温度体感
- 语音唤醒到拍照调用、拍照完成、上传完成、摘要完成的时间
- 一分钟 WAV 实际大小和触发照片大小
