# Readio 开发与验证

# Readio

个人英语听读 Web 应用。产品需求、视觉原型和技术方案位于 `readio-docs/`，保持原样。

已实现完整 v1，包括文章管理、逐句音频与进度恢复、翻译查词、句子与生词收藏，以及 P1 的 JSON 导出/导入备份。样式与类名从原型迁移，没有原型面板。

## 平台接入与运行

本应用采用统一应用清单 v2，带可选后台（声明 `backend`），通过根目录 `panda.json` 声明入口和配置。前端为 Vite 构建产物（`dist/`），后端 `managed.mjs` 遵守平台控制协议。平台规则见熊猫小抽屉随附的 skill。

在平台「添加本地项目」选择本目录，或「从 Git 添加」本仓库。在平台配置表单填写 DeepSeek 和 Fish Audio 的密钥。Fish 模型使用内置默认值，也可在表单中填写 `FISH_MODEL`。

后端接口使用 `/v1`，在 `panda.json` 的 `backend.apiPrefixes` 中声明。平台须采用支持该字段及标准 HTTP 健康回复的构建；前后端入口和原有浏览器数据存储继续使用原来的位置。

## 本地开发

需要 Node 20.6 或更高版本。项目使用 React 18、Vite 6，JSX 由 Vite 内置转换。

```sh
pnpm install
cp .env.example .env
# 填写 .env 中的两个 API Key 后，再启动：
pnpm run dev
```

本地开发才使用 `.env`；平台运行不读取 `.env`。真实密钥不包含在仓库中。

```dotenv
PORT=8787
DEEPSEEK_API_KEY=你的DeepSeek密钥
DEEPSEEK_MODEL=deepseek-flash
FISH_API_KEY=你的FishAudio密钥
FISH_MODEL=s2.1-pro-free
FISH_REFERENCE_ID=a18851e0129d4a43bf7589961cb6f300
```

`DEEPSEEK_API_KEY` 和 `FISH_API_KEY` 必填。Fish Audio 模型和音色可省略，默认使用 `s2.1-pro-free` 和适合教学朗读的美式英语女声 Jessica。Fish 公布的当前免费窗口截至 2026 年 11 月 30 日，后续以官方页面为准。[Fish Audio 开发者页面](https://fish.audio/developers/) · [Jessica 音色](https://fish.audio/m/a18851e0129d4a43bf7589961cb6f300/)

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

Fish Audio 成功合成时返回 HTTP 200 和 `audio/mpeg`。如果浏览器拦截播放，可以点击页面中的音频控件。

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

接口错误统一为 `{ "error": { "message": "原因", "code": "错误类型", "retryable": true, "service": "服务名称" } }`，区分 Key 无效、额度不足、权限、限流、网络和超时。参数错误返回 400，上游错误返回 502，请求体上限为 1MB。

服务端调用 Fish Audio 的 `/v1/tts`，通过 Bearer Key 鉴权，使用 `model` 请求头和 `reference_id` 指定模型和音色，再把 MP3 返回给 `/v1/audio/speech` 的调用方。[Fish Audio TTS 接口](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)

## 构建与本地检查

```sh
pnpm test
pnpm run build
pnpm start
```

生产模式在 [http://127.0.0.1:8787](http://127.0.0.1:8787) 同时提供 `dist/` 页面和两个接口。测试用本地模拟上游验证请求、音频转换、参数校验与错误处理，不消耗真实 API，也不能替代真实凭证联调。

## 使用

应用内置《How language shapes the way we think》和《Saying no at work can be good for your health》两篇英文文章，原始文本位于 `src/content/`。首次加载时自动加入当前浏览器的文章列表，并按正常流程生成音频；不会覆盖已有文章，刷新不会重复添加，手动删除后也不会自动恢复。导出备份会保留内置文章初始化标记，导入旧备份也会保留当前浏览器已有标记。

1. 点击「添加文章」，粘贴英文正文，标题可留空。保存后自动分句并生成音频，最多 300 句；列表、详情和学习页显示生成进度，整篇生成完成后才能播放。生成过程中可以阅读、翻译和查词，也可以停止生成，稍后继续；失败可以重试，已生成的音频会保留。
2. 点击文章打开详情，再开始或继续学习。鼠标移到句子上会出现句子工具条（从这句播放、翻译、收藏），移开约 0.2 秒、滚动页面或按 Esc 后消失；触屏设备上工具条固定在当前句。点击任意单词直接查看语境释义并收藏。
3. 播放栏可跳句、变速；空格播放/暂停，左右箭头跳句，T 翻译，S 收藏（优先作用于鼠标所在或键盘选中的句子，否则作用于当前句），Esc 先关闭查词，再收起工具条。键盘 Tab 到句子会显示工具条，再按 Tab 可选择句内单词，Enter/空格查词。输入框获得焦点时不触发学习快捷键。
4. 列表页「句子」「生词」可展开/紧凑显示、播放、取消收藏并撤销，或回到原文。删除文章会保留收藏快照。
5. 顶部「⋯」导出 JSON 备份或导入。导入会明确确认覆盖当前数据，音频不进备份，导入后自动重新生成。
6. 音频批量生成先完成首句请求，再展开最多 3 路并发。Key 无效、余额不足或权限错误会立即停止整批生成、取消正在进行的请求，并显示具体原因；修复配置后点击「重试生成」。网络或临时服务错误最多自动重试两次，仍失败则显示原因，供手动重试。

所有业务数据存在当前浏览器的 IndexedDB；浏览器、主机名和端口不同，数据互不相通。请固定使用同一个地址，换浏览器或从开发地址换到生产地址前先导出备份。后端只代理服务，不保存学习数据。

## 浏览器数据集成检查

```sh
pnpm run test:browser
```

打开 [隔离自查页](http://127.0.0.1:8791/tests/browser-checks.html)。它使用模拟服务与短音频夹具，逐项验证数据库事务、缓存、并发、重试、删除保留收藏、备份覆盖/回滚和旧异步请求隔离，不消耗真实 API。页面只允许在固定沙盒地址运行，并会清空该沙盒地址的数据。正式学习请使用 5173 或 8787 端口。

完整验收结果与边界处理见 [ACCEPTANCE.md](../ACCEPTANCE.md)。

## 相对于原技术方案的接口更新

- DeepSeek 原默认模型 `deepseek-chat` 已停用，改为当前 `deepseek-flash`，模型仍可通过 `.env` 修改。[官方模型调用说明](https://api-docs.deepseek.com/quick_start/)、[旧模型停用公告](https://api-docs.deepseek.com/news/news260424/)。

## 开源许可证

本项目采用 [MIT License](../LICENSE) 开源。
