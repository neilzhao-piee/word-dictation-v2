# ADR 0011: Public HTTPS endpoint for the OCR relay (reverse tunnel + shared token)

Date: 2026-11-06. Status: Accepted.
Amended by ADR-0013: the address and token are deployment configuration, not a
compile-time default baked into the source.

Amends ADR-0010: the relay is no longer LAN-only. It answers on a public HTTPS
hostname (`https://ocr.<your-domain>/ocr`), because dictation sessions also happen
away from home Wi-Fi — the first field test ran at an office, where the LAN URL
silently degraded to on-device ML Kit.

Everything ADR-0010 decided still holds: the Azure key stays on the relay, photos
are transient (ADR-0001), and the cloud → ML Kit → manual degradation chain is
unchanged.

## Context

ADR-0010 assumed "home Wi-Fi only" and made the relay URL a plain `http://` LAN
address, editable in Settings. That failed in the field: on an office network the
app could not reach the LAN address, fell back to local ML Kit, and the
handwritten list was still unreadable — the very problem cloud OCR was chosen to
solve.

Constraints discovered:

- Home lines rarely come with a static public IP, and opening a port on the
  router would expose an unauthenticated API to the whole internet.
- Child homework photos crossing the public internet in cleartext is not
  acceptable, so plain HTTP port forwarding is out as well.
- An outbound-only reverse tunnel (Cloudflare Tunnel, or any equivalent such as
  Tailscale Funnel) needs no port forwarding, no static IP, and terminates TLS at
  the edge. The household already ran `cloudflared` and owned a Cloudflare-hosted
  domain, so this was the cheapest option — any domain works.

## Decision

- One ingress hostname on the existing tunnel (`ocr.<your-domain> →
  http://<relay-host>:8093`) plus a proxied CNAME to `<tunnel-id>.cfargotunnel.com`
  — see `docs/OCR-RELAY.md`. Nothing new to operate home-side beyond the relay.
- Require a shared access token on `POST /ocr` (`X-WD-Token`, 32 hex chars,
  constant-time compare; `WD_OCR_TOKEN` in `/etc/wd-ocr.env`). The token is
  embedded in the app bundle because there is no account system: it keeps
  strangers, scanners and quota-abuse bots off the Azure F0 allowance, and it is
  revocable by editing the env file. `OPTIONS` advertises `X-WD-Token` so the
  WebView preflight passes. When `WD_OCR_TOKEN` is unset the relay keeps the
  unauthenticated behaviour (LAN-only deployments and unit probes).
- For the private family build the relay URL was a compile-time default and **not
  shown in the settings UI** (the `settings.ocrCloudUrl` input was removed): a
  visible address is the easiest way for the endpoint to leak, and one family does
  not need per-user relay addresses. The `ocrCloudUrl` storage key stayed honoured
  so an operator could override it without a rebuild.
  ADR-0013 supersedes that part for the open-source build, which ships no default
  address and therefore needs the fields back.
- The "cloud recognition" toggle stays. `X-WD-Token` is sent on every request;
  a dead tunnel, offline phone or 401 all degrade to ML Kit exactly as before.

## Consequences

- Dictation works from any network with internet access; at home the photo
  makes a round trip via Cloudflare instead of staying on the LAN.
- Photos are encrypted in transit but do leave the house before reaching Azure —
  the tunnel is a delivery path, not an on-premise boundary. The relay still
  never writes a photo to disk or a log line.
- The token ships inside the APK. Anyone who extracts it can spend the F0 quota
  until it is rotated; acceptable for a self-hosted family build, and the ADR-0010
  follow-up (per-family relays or a shared backend with real auth) is the
  store-release answer.
- Operational: nobody needs to touch the router. Rolling back is removing the
  ingress entry + DNS record and unsetting `WD_OCR_TOKEN`.
