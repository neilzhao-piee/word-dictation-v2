# Word Dictation (v2)

给家庭用的英文听写 App：家长拍照上传单词表 → 确认单词卡 → 逐词发音听写 → 拍照答卷 → 自动批改 + 错词本 + 每周正确率。

Capacitor 壳 + 纯 JS（无构建步骤），**本地优先**：发音、批改、历史、错词全在手机里（IndexedDB）。手写识别可选走你自己部署的轻量中转（见 [docs/OCR-RELAY.md](docs/OCR-RELAY.md)），不配置就只用端上识别。

## 产品规则（不可动摇）

1. **单词卡必须经家长确认才开始听写**——OCR 只是加速器，家长可增删改。这是产品灵魂，不是可选项。
2. **逐词发音，点确认才读下一个**——不是一口气读完整表。
3. **离线可用**——无网络时全流程照常。云端识别是可选项：没配置、断网、超时都自动回落到本机识别，失败还能手输单词表。

## 快速开始

网页预览（看流程用；相机、原生 TTS、ML Kit 在浏览器里不可用）：

```sh
python3 -m http.server 8080 -d www   # 打开 http://localhost:8080
```

安卓真机：

```sh
npm install
npx cap add android          # 首次
npm run sync                 # www/ → android/
scripts/patch-android.sh     # 系统栏配色（edge-to-edge）+ 五语言 locales_config
npx cap run android          # 或 npx cap open android 用 Android Studio
```

要求 Android 8.0+、Android SDK platform 35 / build-tools 35.0.0。iOS 在计划中（阶段 3，需要 Mac + Xcode）。

> 上架或自用打包前请把 `capacitor.config.json` 里的 `appId` 换成你自己的命名空间（仓库里保留的是作者的占位值）。

## 测试

纯 node，无浏览器：

```sh
npm test     # grade / ocr / storage 三组
```

批改阈值、OCR 结果解析、存储结构都有断言钉住——改这些行为前先改测试。

## 云端识别（可选）

手写体在端上识别率不够（ADR-0006 的实测结论），所以留了一条**可选**的云端通道：

- 中转脚本：[scripts/ocr-relay.py](scripts/ocr-relay.py) + systemd 单元 [scripts/wd-ocr.service](scripts/wd-ocr.service)，转发到你自己的 Azure AI Vision **Read 3.2**（免费层 F0 约 5000 次/月，够几个家庭每周听写）。
- 地址与令牌**不进源码**：`www/js/relay-config.js` 提交的是空模板，本机填好即可（或装好后在 App「设置」里填，设置优先）。
- 地址留空 = 不做云端识别，只用手机本机识别。

部署步骤、环境变量、Cloudflare Tunnel 写法：[docs/OCR-RELAY.md](docs/OCR-RELAY.md)。

## 语言支持

- **界面**：简体中文、繁体中文、English、日本語、한국어（`www/js/i18n/*.json`，`en` 为基准语言，键集合必须完全一致）
- **单词发音**：澳洲英语 `en-AU`、英式英语 `en-GB`、美式英语 `en-US`

## 隐私

- 不收集个人数据，无账号、无广告、无追踪 SDK；听写记录只存在本机。
- **默认全在本机**：识别、批改、统计都不联网。
- 开启云端识别后：照片经 HTTPS 送到**你自己部署的**中转，再转给识别服务（Azure）。中转只在内存里持有图片，**不落盘、不记录内容**，识别完即丢弃（ADR-0001 / ADR-0010）。照片从不发给第三方分析或存储服务。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层、关键决策 |
| [docs/OCR-RELAY.md](docs/OCR-RELAY.md) | 自建识别中转（可选） |
| [docs/L10N.md](docs/L10N.md) | 五语言规范（占位符、敬体、地区口音） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 阶段规划 |
| [docs/adr/](docs/adr/) | 架构决策记录 |
| [GLOSSARY.md](GLOSSARY.md) | 领域词汇表 |
| [docs/manual-zh.md](docs/manual-zh.md) | 给家长的使用说明（中文） |

## 工单与协作

GitHub Issues（约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)，triage 标签见 [docs/agents/triage-labels.md](docs/agents/triage-labels.md)）。

## 许可

MIT，见 [LICENSE](LICENSE)。
