# dsh-gemini-multimodal

给 DeepSeek Harness 装上**多模态感知**:harness 主模型(如 DeepSeek)是纯文本的,这个插件把"看/听"外包给 **Gemini** —— 图片/音频/视频/文档理解、转录、图片生成。

## 为什么

DeepSeek 模型只支持文本。当任务涉及截图、图表、语音、视频片段或 PDF 时,这个插件让 agent 真的能看能听——判断仍由主模型负责。

## 两种 provider(选一个)

| provider | 需要什么 | 什么时候用 |
|---|---|---|
| `gemini_api` | **aistudio.google.com** 申请的 Gemini API key | 默认;直接 REST,快,一次 HTTP |
| `antigravity_cli` | 本地 [`agy`](https://antigravity.google) CLI,用 Google 账号登录 | 不用管 key;消耗 Antigravity/Google One 额度 |

**key 去哪搞(gemini_api):** 打开 `aistudio.google.com` → 用你的 Google 账号登录 → **Get API key** → Create API key。key 以 `AIza...` 或 `AQ.` 开头,两种都行。Pro/Google One 订阅同样走 API 免费层(图片生成在免费层限流)。

**antigravity_cli 配置:** `curl -fsSL https://antigravity.google/cli/install.sh | bash`,然后跑一次 `agy` 并登录,无需 key。

## 快速开始

```sh
dsh plugin --profile web add dsh-gemini-multimodal
```

在 profile/settings 层配置:

```yaml
- id: gemini-multimodal
  name: dsh-gemini-multimodal
  config:
    provider: gemini_api        # 或 antigravity_cli
    api_key: <你的 gemini key>  # 仅 gemini_api 需要
    # output_dir: /图片输出目录  # 生成图存放处(默认系统临时目录)
```

## 工具

| 工具 | 作用 |
|---|---|
| `media_understand` | 分析图片/音频/视频/URL(OCR、图表、界面、语音内容) |
| `media_transcribe` | 音频/视频逐字转录(带时间戳) |
| `image_generate` | 文本 → PNG 存本地(免费层出图配额低,可能 429) |
| `read_document` | 总结/问答 PDF、Office、文本文件 |

## 安全说明(antigravity_cli)

headless `agy -p` 无法弹窗审批,插件默认带 `--dangerously-skip-permissions`(该次运行 agent 有完整工具权限)。要收紧:设 `skip_permissions: false`,并在 `~/.gemini/antigravity-cli/settings.json` 加 allow 规则(如 `read_file(...)`、拒绝 `shell`)。需要更小信任边界时优先用 `gemini_api`。

## 隐私

- `gemini_api`:媒体以 base64 内联发给 Google Gemini API——插件不落盘,key 只在你配置文件里。
- `antigravity_cli`:媒体由本地 agent 读取,按 agy 流程发给 Google。
- 本插件不写任何日志。

## 开发

```bash
npm install
npm run typecheck
npm test          # mime 映射 / agy 参数 / smoke(无网络)
npm run build
```

## License

MIT
