# follow-builders-sidecar-codex

This is a local patch fork of `AMortalsOdyssey/follow-builders-sidecar`.

The upstream sidecar is OpenClaw-only. This fork keeps the upstream feed, state,
and card pipeline, but replaces the delivery and scheduling assumptions so it can
run cleanly in Codex without `openclaw`.

## Current shape

The live configuration is stored at:

- `~/.follow-builders-sidecar/config.json`
- `~/.follow-builders-sidecar/state.json`
- `~/.follow-builders-sidecar/credentials.json`

Public-safe sample files live in:

- `config/sidecar.config.sample.json`
- `config/credentials.sample.json`

Only commit those sample files. Keep real secrets, chat IDs, and webhook URLs in local files outside git.

The current production delivery path is:

1. Codex automation wakes at the scheduled time.
2. `scripts/run-sidecar.js --prepare-only` prepares feed JSON.
3. The agent reads the prepared JSON and writes a card payload JSON.
4. `scripts/send-agent-payload.js` sends the final card through a Feishu bot webhook.
5. Sidecar state is updated for daily dedupe and freshness tracking.

The fork now also supports a static web archive target:

6. If `delivery.targets` includes `web`, the normalized payload is written into `web/data/`.
7. The static archive UI under `web/` reads those JSON files and shows a calendar-based card archive.

## What changed from upstream

- `openclaw` cron inspection is optional.
  If `openclaw` is not installed, status and prepare-only runs continue with an empty cron list.
- New delivery driver: `lark_cli_feishu_card`.
- New delivery driver: `feishu_webhook_card`.
- New sender: `scripts/send-lark-cli-card.js`.
- New sender: `scripts/send-feishu-webhook-card.js`.
- `scripts/run-sidecar.js` and `scripts/send-agent-payload.js` can deliver through:
  - `lark-cli im +messages-send --msg-type interactive`
  - Feishu bot webhook `msg_type=interactive`
- Feed content loading now prefers GitHub Contents API first, then raw GitHub, then local bundled feeds.
- GitHub commit freshness and dedupe can use a local `github.token` from `credentials.json`.
- Webhook card delivery now supports avatar fetching and avatar upload.
- If Pillow is installed, avatar images are cropped to circles before upload.
- If cropping fails, avatar upload falls back to the original image instead of skipping the avatar entirely.

## Live configuration

Current live settings:

- `language = bilingual`
- `timezone = Asia/Shanghai`
- `frequency = daily`
- `generation.mode = agent_native`
- `delivery.driver = feishu_webhook_card`
- `delivery.targets` can include `feishu`, `web`, or both

Additional configured paths currently present:

- `delivery.larkCli.chatId = oc_xxx`
- `delivery.webhook.url = <configured in local config>`

The webhook URL is stored in the local config file and should be treated as sensitive.

## Bilingual rules

The automation prompt and payload generation rules are currently tuned for real bilingual output:

- `summary`: English first, then Chinese
- every `headline`: English first, then Chinese in the same string
- every `body`: English paragraph first, then Chinese paragraph immediately after

This is not just a UI preference. The scheduled automation prompt has been updated so the generated payload follows these rules consistently.

## Web archive

Static site files live in:

- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/data/index.json`
- `web/data/digests/*.json`

The archive is built as a static card UI with:

- collapsible left calendar sidebar
- latest day selected by default
- per-section cards so builders with multiple posts repeat their profile header on each card
- card-mode rendering that mirrors the Feishu layout

Cloudflare Pages can serve the `web/` directory directly. A minimal `wrangler.toml` is included with:

- `pages_build_output_dir = "web"`

## Avatar behavior

Webhook delivery now attempts avatar rendering for card items that have a usable source profile or handle:

1. Fetch avatar from the source profile or inferred handle URL.
2. Crop to a circle with `scripts/circle-avatar.py`.
3. Upload to Feishu with:
   `lark-cli im images create --as bot`
4. Inject the returned `img_key` into the interactive card.

Current dependency:

- `Pillow` is installed in the local user Python environment and is required for stable circle cropping.

If Pillow becomes unavailable later, the sender falls back to uploading the original avatar image.

## GitHub API behavior

This fork uses GitHub for two different jobs:

1. GitHub API:
   - discover `feed-*.json`
   - find latest relevant commits
   - determine freshness and same-day dedupe
2. Feed content loading:
   - first via GitHub Contents API
   - then via raw GitHub URL
   - then via local bundled feed files

Current local credentials support:

- `credentials.json > github.token`

This is used to raise GitHub API limits and make commit-based freshness reliable.

## Configure

### Webhook card delivery

```bash
cd /path/to/follow-builders-sidecar-codex/scripts
node sidecar-configure.js \
  --driver feishu_webhook_card \
  --webhook-url 'https://open.feishu.cn/open-apis/bot/v2/hook/...' \
  --generation-mode agent_native \
  --language bilingual \
  --timezone Asia/Shanghai \
  --frequency daily
```

### lark-cli card delivery

This path still exists, but it is not the current production path.

```bash
cd /path/to/follow-builders-sidecar-codex/scripts
node sidecar-configure.js \
  --driver lark_cli_feishu_card \
  --lark-cli-chat-id oc_xxx \
  --lark-cli-as user \
  --generation-mode agent_native \
  --language bilingual \
  --timezone Asia/Shanghai \
  --frequency daily
```

## Codex automation shape

Use Codex automation instead of OpenClaw cron:

1. Run:
   `node scripts/run-sidecar.js --prepare-only --input-json-out /tmp/fb-sidecar-raw.json --payload-out /tmp/fb-sidecar-payload.json`
2. If the result is `needs_payload`, read `/tmp/fb-sidecar-raw.json`.
3. Generate `/tmp/fb-sidecar-payload.json` from grounded feed content only.
4. Run:
   `node scripts/send-agent-payload.js --input-json /tmp/fb-sidecar-raw.json --payload /tmp/fb-sidecar-payload.json`

For dry runs:

```bash
node scripts/send-agent-payload.js \
  --input-json /tmp/fb-sidecar-raw.json \
  --payload /tmp/fb-sidecar-payload.json \
  --skip-delivery
```

## Manual commands

### Check status

```bash
node scripts/sidecar-status.js
```

### Print a webhook card without sending

```bash
FOLLOW_BUILDERS_FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...' \
node scripts/send-feishu-webhook-card.js \
  --file /tmp/fb-sidecar-payload.json \
  --print-card
```

### Send a webhook card

```bash
FOLLOW_BUILDERS_FEISHU_WEBHOOK_URL='https://open.feishu.cn/open-apis/bot/v2/hook/...' \
node scripts/send-feishu-webhook-card.js \
  --file /tmp/fb-sidecar-payload.json
```

### Print an lark-cli card without sending

```bash
node scripts/send-lark-cli-card.js \
  --file /tmp/fb-sidecar-payload.json \
  --print-card
```

## Limitations

- This fork still does not use OpenClaw cron, OpenClaw delivery accounts, or `openclaw infer`.
- The webhook sender depends on a valid Feishu bot webhook that is already added to the target group.
- Avatar upload depends on `lark-cli` bot identity being available for `im images create`.
- Podcast and blog avatar coverage depends on whether there is a stable avatar source to fetch.
- If GitHub API and raw GitHub both fail, the fork will still deliver using local bundled feeds, which is resilient but not always the freshest possible view.
