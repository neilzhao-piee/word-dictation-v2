# 自建识别中转（可选）

手写体中转：手机 → 你的中转（`scripts/ocr-relay.py`）→ Azure AI Vision **Read 3.2** → 逐词结果。

整条链路**可选**：不配置时 App 只用手机本机识别（ML Kit），流程完全可用。

- 为什么需要它：端上 ML Kit 对儿童手写识别率不够（ADR-0006 实测），本机增强也救不回来——见 [ADR-0010](adr/0010-cloud-ocr-relay.md)。
- 为什么是 Azure：Read API 带手写支持，免费层 **F0 ≈ 5000 次/月**，一次听写 1–2 次请求，够几个家庭用。
- 为什么要有令牌：relay 一旦暴露到公网，没有令牌就是给陌生人开你的额度账单——见 [ADR-0011](adr/0011-public-relay-endpoint.md)。

## 一、准备 Azure

1. Azure 门户新建 **Computer Vision**（或 AI Services）资源，定价层选 **F0**（免费）。
2. 区域选离你近的（如 `australiaeast`），记下 **Key 1** 和 **Endpoint**。
3. Endpoint 形如 `https://<region>.api.cognitive.microsoft.com`，**不要**带路径。

## 二、部署中转

```sh
sudo install -d -m 755 /opt/wd-ocr
sudo install -m 644 scripts/ocr-relay.py /opt/wd-ocr/ocr-relay.py
sudo install -m 644 scripts/wd-ocr.service /etc/systemd/system/wd-ocr.service

sudo install -m 600 scripts/wd-ocr.env.example /etc/wd-ocr.env
sudoedit /etc/wd-ocr.env        # 填 WD_OCR_KEY / WD_OCR_ENDPOINT，按需 WD_OCR_TOKEN
sudo openssl rand -hex 16       # 需要令牌时用它生成

sudo systemctl daemon-reload
sudo systemctl enable --now wd-ocr
curl -s localhost:8093/health   # {"ok": true, "configured": true}
```

环境变量全部取自 `EnvironmentFile`，脚本里没有任何地址或密钥：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WD_OCR_KEY` | 是 | Azure 密钥。只存在于这个文件（root 0600），不进 APK、不进仓库、不写日志 |
| `WD_OCR_ENDPOINT` | 是 | `https://<region>.api.cognitive.microsoft.com`（不带路径） |
| `WD_OCR_TOKEN` | 否 | 共享令牌；设置后 `POST /ocr` 必须带 `X-WD-Token`。对公网暴露时**必须**设置 |
| `WD_OCR_PORT` | 否 | 监听端口，默认 8093 |
| `WD_OCR_LANGUAGE` | 否 | 识别语言（如 `en`）；不设则自动检测 |

健康检查 `GET /health` 返回 `{"ok":true,"configured":<bool>}`；`configured:false` 时 `POST /ocr` 会回 **503 `relay-not-configured`**，App 会自动退回本机识别。

## 三、让手机够得着（两种）

**A. 同一局域网**：App 里把识别地址填成 `http://<中转机内网IP>:8093/ocr`（设置 → 识别服务器地址），令牌填 `WD_OCR_TOKEN`（如果设了）。无需公网。

**B. 公网 HTTPS（Cloudflare Tunnel 举例）**：家里没有静态公网 IP 也能用，且不用在路由器上开端口。

```sh
# 在装有 cloudflared 的机器上
sudo cloudflared tunnel login
sudo cloudflared tunnel create ocr-relay        # 记下 <tunnel-id>
```

`~/.cloudflared/config.yml`：

```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: ocr.example.com
    service: http://127.0.0.1:8093
  - service: http_status:404
```

```sh
sudo cloudflared tunnel route dns ocr-relay ocr.example.com   # 生成 proxied CNAME 到 <tunnel-id>.cfargotunnel.com
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

任何等价方案都行（Tailscale Funnel、frp、nginx + 证书）。要点只有三个：**HTTPS**、**令牌必设**、**只把 `/ocr` 暴露出去**。

## 四、告诉 App 地址和令牌

源码里**不含**任何地址或令牌（[ADR-0013](adr/0013-relay-config-is-deployment-data.md)），两个入口二选一：

1. **构建时**：编辑 `www/js/relay-config.js`

   ```js
   window.WD_RELAY = { url: 'https://ocr.example.com/ocr', token: '<openssl rand -hex 16 的结果>' };
   ```

   这份文件是提交在仓库里的**空模板**，自己填完不想被 git 看到就用
   `git update-index --skip-worktree www/js/relay-config.js`。

2. **装好之后**：App → 设置 → 识别服务器地址 / 识别服务令牌。设置值优先于构建配置，一台 APK 可随时改指。

地址留空 = 不启用云端识别，只用本机识别。随时可用「云端识别」开关整体关掉。

## 五、隐私与额度

- 照片只在内存里过一遍：relay 不写磁盘、不记录请求体，只记 method/path/status（ADR-0010）。
- 照片会离开手机（到你的 relay，再到 Azure）——这与你自己的局域网边界无关，是真实的数据出口，商店文案不能写"照片不出设备"。本仓库的文案按此措辞。
- F0 额度按月重置；用超了 Azure 返回 429，relay 会按其建议退避重试，最终失败时 App 退回本机识别。
- 令牌泄露（比如有人从 APK 里挖出来）只会消耗你的额度：改 `/etc/wd-ocr.env` 里的 `WD_OCR_TOKEN` 并更新 App 配置即可，不用重新发版逻辑。

## 六、排错

| 现象 | 原因 |
| --- | --- |
| `503 relay-not-configured` | `WD_OCR_KEY` / `WD_OCR_ENDPOINT` 没填，或改完没 `systemctl restart wd-ocr` |
| `401 unauthorized` | 令牌不一致（App 侧 `ocrCloudToken` / `relay-config.js` vs `WD_OCR_TOKEN`） |
| App 一直用本机识别 | 地址为空、开关关着、或者请求超时（默认 120 s 预算）→ 都会静默回落，属预期 |
| `ocr-cloud-status` 报错 | Azure 侧非 `succeeded`（图片过大、额度用尽、区域错），看 relay 日志的 status 码 |
