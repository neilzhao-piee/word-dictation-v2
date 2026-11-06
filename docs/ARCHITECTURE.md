# 架构

## 原则

1. **本地优先**：识别、发音、批改、存储全在设备内。网络是可选增强，不是依赖。
2. **无构建步骤**：`www/` 直接是脚本 + JSON，Capacitor 壳只打包静态资源（沿用 v1 的成功经验，降低维护面）。
3. **原生只用在原生必须的地方**：相机、TTS、OCR 走原生插件；其余全是 Web 技术。

## 分层

```
www/
  index.html          壳 + 导航
  css/app.css         移动优先样式
  js/
    app.js            hash 路由 + 各屏渲染
    i18n.js           t() + 语言加载/回退（en 为基准语言）
    i18n/*.json       五语言资源（见 L10N.md）
    storage.js        IndexedDB：profiles / lists / sessions / wrongWords / settings
    relay-config.js   可选云端识别中转的地址与令牌（空模板，见 ADR-0013）
    grade.js          纯函数：norm / levenshtein / closestMatch（可 node 单测）
    tts.js            原生 TTS（Capacitor）+ Web SpeechSynthesis 回退 + 变体选择
    ocr.js            OCR 适配层：按平台选 ML Kit / Vision / 手动输入回退
```

## 关键决策记录

### 存储用 IndexedDB，不用原生 SQLite
v1 的 SQLite 在服务器上；v2 要在端上。Capacitor 的 SQLite 插件引入原生依赖与升级风险，而本 App 数据量（每周一次听写）远未达到 IndexedDB 上限。**导出/备份走 JSON 文件导出**（阶段 1 末实现），数据不锁死在设备。

### 批改引擎是纯函数
`grade.js` 不碰 DOM、不碰网络，`levenshtein` + `ratio`（`1 - lev/max(len)`，cutoff 0.55）复刻 v1 服务端 `difflib.get_close_matches` 的行为。差异记录在测试里，真机错词数据出来后校准 cutoff。

### OCR 是分层的，不是单一的
- 印刷体：ML Kit（安卓）/ Vision（iOS）准确率高，端上免费
- 手写体：端上**预期不可靠**——靠「家长确认单词卡」闭环兜底；需要更准时可开可选的自建中转（ADR-0010 / ADR-0011 / ADR-0013），识别顺序为 云端 → ML Kit → 手动输入
- 任何 OCR 失败都不能阻断流程：家长可手输单词表

### TTS 变体
原生插件按 `languageCode`（en-AU / en-GB / en-US）发音。安卓的语音包由用户设备的 TTS 引擎决定（Google TTS 可按语言下载）；找不到目标变体时回退到任一英语语音并明示。iOS 系统自带三大变体。

## 与 v1 的关系

v1（`neilzhao-piee/word-dictation`：FastAPI + SQLite + 本地视觉模型）已冻结，只修 bug 不加功能。v2 不 import v1 代码，只移植其已验证的产品规则与算法（批改 cutoff、ISO 周统计、确认卡交互）。
