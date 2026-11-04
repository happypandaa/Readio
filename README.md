# Readio

个人英语听读 Web 应用。产品需求、视觉原型和技术方案位于 `readio-docs/`，保持原样。

已实现完整 v1，包括文章管理、逐句音频与进度恢复、翻译查词、句子与生词收藏，以及 P1 的 JSON 导出/导入备份。样式与类名从原型迁移，没有原型面板。

## 平台接入（熊猫小抽屉）

本应用是 Node 应用（`runtime: node`），通过根目录 `panda.json` 声明入口和配置。前端为 Vite 构建产物（`dist/`），后端 `managed.mjs` 遵守平台控制协议。平台规则见熊猫小抽屉随附的 skill。

在平台「添加本地项目」选择本目录，或「从 Git 添加」本仓库。两把密钥（DeepSeek、豆包）在平台配置表单填写，由平台注入后端，无需维护 `.env`。模型、资源 ID 和音色使用内置默认值，如需修改请改代码。

后端接口使用 `/v1`，在 `panda.json` 的 `backend.apiPrefixes` 中声明。平台须采用支持该字段及标准 HTTP 健康回复的构建；前后端入口和原有浏览器数据存储继续使用原来的位置。

## 本地开发

需要 Node 20.6 或更高版本。项目使用 React 18、Vite 6，JSX 由 Vite 内置转换。

```sh
npm install
cp .env.example .env
# 填写 .env 中的两个 API Key 后，再启动：
npm run dev
```

本地开发才使用 `.env`；平台运行不读取 `.env`。真实密钥不包含在仓库中。

```dotenv
PORT=8787
DEEPSEEK_API_KEY=你的DeepSeek密钥
DEEPSEEK_MODEL=deepseek-flash
DOUBAO_API_KEY=你的豆包语音APIKey
DOUBAO_RESOURCE_ID=seed-tts-2.0
DOUBAO_VOICE=en_female_zendaya_p1_uranus_bigtts
```

只有 `DEEPSEEK_API_KEY` 和 `DOUBAO_API_KEY` 必填。豆包使用新版语音控制台「API Key 管理」中的 Key，无需 AppID。默认资源是 `seed-tts-2.0`，默认音色 Zendaya 是美式英语女声。资源和音色均可省略，服务端会采用默认值。

- 页面：[http://localhost:5173](http://localhost:5173)
- 后端：[http://127.0.0.1:8787](http://127.0.0.1:8787)。开发时页面请求 `/v1`，由 Vite 代理给后端。
- 密钥仅由 Node 读取，不带 `VITE_` 前缀，不进入前端构建。

## 验证两个真实接口

在开发页面打开浏览器开发者工具 Console，分别运行下面两段代码。请求只发给本地 `/v1`，不需要在浏览器里填写密钥。

DeepSeek：HTTP 200，且控制台显示 `choices[0].message.content` 的回复，即表示成功。

```js
{
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Reply with exactly: Readio is ready.' }],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
  console.log(response.status, result.choices[0].message.content);
}
```

豆包语音：HTTP 200、类型 `audio/mpeg`，并能听到英文朗读，即表示成功。如果浏览器拦截播放，可以点击插入页面的音频控件播放。

```js
{
  const response = await fetch('/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'Readio is ready. Let us read and listen.' }),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  console.log(response.status, blob.type, blob.size);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.controls = true;
  audio.onended = () => URL.revokeObjectURL(url);
  document.body.append(audio);
  audio.play().catch(() => console.log('请点击音频控件播放。'));
}
```

接口错误统一为 `{ "error": { "message": "原因" } }`；参数错误返回 400，上游网络、HTTP 或业务错误返回 502。请求体上限为 1MB。V3 文档未明确数字形式的文本上限，超出上游限制时返回服务的简短原因。

服务端使用豆包 V3 HTTP 接口，收齐并解码音频片段后向浏览器返回一个完整 MP3。前端仍调用 `/v1/audio/speech`，不需要处理流式协议。

## 构建与本地检查

```sh
npm test
npm run build
npm start
```

生产模式在 [http://127.0.0.1:8787](http://127.0.0.1:8787) 同时提供 `dist/` 页面和两个接口。测试用本地模拟上游验证请求、音频转换、参数校验与错误处理，不消耗真实 API，也不能替代真实凭证联调。

## 使用

1. 点击「添加文章」，粘贴英文正文，标题可留空。保存后自动分句并生成音频，最多 300 句；生成过程中也能进入学习。
2. 点击文章打开详情，再开始或继续学习。鼠标移到句子上，可播放、翻译、收藏；点击单词查看语境释义并收藏。
3. 播放栏可跳句、变速；空格播放/暂停，左右箭头跳句，T 翻译，S 收藏，Esc 关闭查词。输入框获得焦点时不触发学习快捷键。
4. 列表页「句子」「生词」可展开/紧凑显示、播放、取消收藏并撤销，或回到原文。删除文章会保留收藏快照。
5. 顶部「⋯」导出 JSON 备份或导入。导入会明确确认覆盖当前数据，音频不进备份，导入后自动重新生成。

所有业务数据存在当前浏览器的 IndexedDB；浏览器、主机名和端口不同，数据互不相通。请固定使用同一个地址，换浏览器或从开发地址换到生产地址前先导出备份。后端只代理服务，不保存学习数据。

## 浏览器数据集成检查

```sh
npm run test:browser
```

打开 [隔离自查页](http://127.0.0.1:8791/tests/browser-checks.html)。它使用模拟服务与短音频夹具，逐项验证数据库事务、缓存、并发、重试、删除保留收藏、备份覆盖/回滚和旧异步请求隔离，不消耗真实 API。页面只允许在固定沙盒地址运行，并会清空该沙盒地址的数据。正式学习请使用 5173 或 8787 端口。

完整验收结果与边界处理见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 相对于原技术方案的接口更新

- DeepSeek 原默认模型 `deepseek-chat` 已停用，改为当前 `deepseek-flash`，模型仍可通过 `.env` 修改。[官方模型调用说明](https://api-docs.deepseek.com/quick_start/)、[旧模型停用公告](https://api-docs.deepseek.com/news/news260424/)。
- 豆包使用支持新版 API Key 的 V3，使用 `X-Api-Key`、`X-Api-Resource-Id` 和 `X-Api-Request-Id`，无需旧版 AppID/Token/Cluster；前端输入输出格式保持原方案约定。`code=0` 的音频逐片合并，`code=20000000` 结束帧作为成功处理。原 V1 的 1024 字节限制不再沿用。[V3 官方文档](https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http?lang=zh)、[完整分帧说明](https://docs.volcengine.com/docs/doubao-voice/http-chunked-sse-unidirectional-streaming-v3?lang=zh)、[官方音色表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)。

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源。
