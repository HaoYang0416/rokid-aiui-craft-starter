# Rokid Craft 操作记录

## 导入

- 工程目录：`src/`
- 首页：`pages/index/index`
- 应用名称：`回声 Echo`
- 版本：`0.1.0`

## 模拟器验证顺序

1. 先在仓库根目录运行 `npm run dev:server`。
2. 导入 `src/` 并打开 Interactive InkView。
3. 使用模拟器录音能力，按“开启回声”。
4. 等待缓冲计时增长。
5. 在设备面板派发语音唤醒，或发送 Enter / `GlobalHook`。
6. 在相机面板上传图片或选择 Webcam 拍照。
7. 确认界面依次显示“正在定格”“AI 正在回想”“回声已保存”。
8. 检查 `server/data/<记录 ID>/` 中存在音频、照片和记录 JSON。

## 真机地址

Craft 模拟器可以访问 `127.0.0.1`；眼镜真机不能把该地址当作电脑。真机联调前修改 `src/config.js`：

```js
apiBaseUrl: 'http://电脑的局域网IP:8787'
```

正式提交必须换成可访问的 HTTPS 地址，不要把 OpenAI API Key 放进 AIUI 工程。

## 打包前

- 把 `src/config.js` 切换到生产 HTTPS 地址。
- 复核 `AGENTS.md` 只声明 camera、microphone、network 三项权限。
- 删除调试日志中的个人数据。
- 录制一段“开启 → 等待 → 说回声 → 展示记忆卡片”的演示视频。
- 根据真机结果更新 `docs/TEST_PLAN.md`。

