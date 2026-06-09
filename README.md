# aimanews

Static web digest generator for AI builder updates.

## Scope

This fork now keeps only the web publishing flow:

- fetch upstream feeds from `zarazhangrui/follow-builders`
- generate a normalized daily payload
- write static archive data into `web/data/`
- publish the web archive snapshot through git

Feishu/Lark/OpenClaw delivery code has been removed from the active runtime path.

## Main files

- `scripts/run-local-codex-sidecar.js`: local scheduled runner
- `scripts/send-agent-payload.js`: normalizes the payload and updates `web/data/`
- `scripts/web-archive.js`: static archive publishing logic
- `launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist`: local LaunchAgent example
- `web/`: static site assets

## Config

Sample config: `config/sidecar.config.sample.json`

Relevant delivery settings are now web-only:

```json
{
  "delivery": {
    "targets": ["web"],
    "web": {
      "outputDir": "/absolute/path/to/web",
      "siteUrl": "https://example.pages.dev"
    }
  }
}
```

## Useful commands

```bash
cd scripts
npm install
node sidecar-status.js
node sidecar-configure.js --web-output-dir /absolute/path/to/web
node run-sidecar.js --skip-delivery
node run-local-codex-sidecar.js --dry-run
```

- `node sidecar-status.js`: print the current sidecar config, persisted state, upstream feed compatibility, and detected cron jobs as JSON.
- `node sidecar-configure.js --web-output-dir /absolute/path/to/web`: update the configured web output directory used for archive publishing.
- `node run-sidecar.js --skip-delivery`: execute the main sidecar flow without publishing the final web output, useful for checking upstream detection and payload generation safely.
- `node run-local-codex-sidecar.js --dry-run`: execute the local LaunchAgent runner path in dry-run mode, useful for validating the real scheduled workflow without treating the run as a normal published delivery.

## Redeploy

Step by step:

1. Update the repo and install script dependencies.

```bash
cd /Users/yongzhenzhuang/Projects/aimanews
git pull
cd scripts
npm install
```

2. Confirm the web output directory in sidecar config.

```bash
node sidecar-configure.js --web-output-dir /Users/yongzhenzhuang/Projects/aimanews/web
node sidecar-status.js
```

Expected result:

- `node sidecar-configure.js` returns `status: "ok"`
- `config.delivery.web.outputDir` is `/Users/yongzhenzhuang/Projects/aimanews/web`
- `node sidecar-status.js` shows the same output directory
- `config.delivery.targets` is `["web"]`

3. Verify the generation path without publishing.

```bash
node run-sidecar.js --skip-delivery
node run-local-codex-sidecar.js --dry-run
```

Expected result:

- both commands exit successfully with exit code `0`
- `node run-sidecar.js --skip-delivery` usually returns either:
  - `status: "ok"` when the generation path is valid for current upstream content
  - `status: "skipped"` when there is no new eligible upstream content for the current day
- `node run-local-codex-sidecar.js --dry-run` updates `.runtime/local-runner/last-result.json`
  - it starts as `status: "in_progress"`
  - it finishes as `status: "ok"`, `status: "skipped"`, or `status: "error"`
  - a dry-run success should not be treated as a normal published delivery

4. Run one real local publish.

```bash
/Users/yongzhenzhuang/.nvm/versions/node/v20.20.0/bin/node /Users/yongzhenzhuang/Projects/aimanews/scripts/run-local-codex-sidecar.js
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

Expected result:

- the command exits successfully with exit code `0`
- `.runtime/local-runner/last-result.json` finishes with:
  - `status: "ok"`
  - `stage: "delivery"`
- the result usually also includes:
  - `prepare.status: "needs_payload"`
  - `delivery.status: "ok"`
  - `delivery.delivery.results.web.status: "ok"`
  - `delivery.delivery.results.web.digestPath`
  - `delivery.delivery.results.web.indexPath`
  - `delivery.delivered: true`

5. Scheduled MacOS task with a LaunchAgent.

How to set it up on macOS:

- Put the plist in `~/Library/LaunchAgents/`
- Load it into the current GUI user session with `launchctl bootstrap`
- Verify the loaded schedule with `launchctl print`
- Manually trigger one run with `launchctl kickstart -k` when needed

```bash
cp /Users/yongzhenzhuang/Projects/aimanews/launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist
launchctl bootout gui/501 /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist 2>/dev/null || true
launchctl bootstrap gui/501 /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist
launchctl print gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
launchctl kickstart -k gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
```

Expected schedule in the final output:

- `Hour = 20`
- `Minute = 0`

6. Configure or refresh the macOS task

- Change `launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist` when you need to adjust when or how macOS launches the runner.
- For schedule changes, edit `StartCalendarInterval`.
- For Node path changes, edit `ProgramArguments[0]`.
- For script path changes, edit `ProgramArguments[1]`.
- For environment differences between Terminal and LaunchAgent, edit `EnvironmentVariables`, especially `PATH` and `HOME`.
- For log locations, edit `StandardOutPath` and `StandardErrorPath`.


## Daily Scheduled Flow

Every day at `20:00`, the LaunchAgent runs:

```bash
/Users/yongzhenzhuang/.nvm/versions/node/v20.20.0/bin/node /Users/yongzhenzhuang/Projects/aimanews/scripts/run-local-codex-sidecar.js
```

What happens:

1. `run-local-codex-sidecar.js` starts a run, writes `last-result.json` as `in_progress`, and acquires a local lock.
2. It calls `run-sidecar.js --prepare-only` to inspect upstream feeds and decide whether there is a new same-day upstream commit worth processing.
   The upstream feed check currently looks for:
   - `feed-x.json`
   - `feed-podcasts.json`
   - `feed-blogs.json`
   It first tries dynamic discovery of `feed-*.json` files from the upstream repo root, then falls back to the legacy list above if dynamic discovery fails.
3. If upstream is valid, it writes the prepared snapshot into `.runtime/local-runner/latest-raw.json`.
4. It asks Codex to generate a structured digest payload and writes it into `.runtime/local-runner/latest-payload.json`.
5. It validates the payload shape and item count.
6. It calls `send-agent-payload.js`, which normalizes the payload and updates:
   - `web/data/index.json`
   - `web/data/latest.json`
   - `web/data/digests/YYYY-MM-DD.json`
7. The web archive publish step commits the refreshed static data.
8. `last-result.json` is updated to `ok`, `skipped`, or `error`, with `runId`, `startedAt`, and `finishedAt`.

The main runtime artifacts are:

- `.runtime/local-runner/last-result.json`
- `.runtime/local-runner/stdout.log`
- `.runtime/local-runner/stderr.log`
- `.runtime/local-runner/latest-raw.json`
- `.runtime/local-runner/latest-payload.json`

## Daily Failure Troubleshooting

Use this order:

1. Check whether the LaunchAgent itself is loaded and what schedule is active.

```bash
launchctl print gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex | egrep 'state =|active count|last exit code|Hour|Minute'
```

2. Check whether a run is still active.

```bash
ps -ax | grep run-local-codex-sidecar.js | grep -v grep
```

3. Check the latest result and timestamps.

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stdout.log /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stderr.log
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

4. Read recent logs.

```bash
tail -n 50 /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stderr.log
tail -n 20 /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stdout.log
```

5. Re-run manually through the same scheduled path.

```bash
launchctl kickstart -k gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
sleep 30
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

How to interpret common failures:

- `status = in_progress`: the current run has started but has not finished yet. Wait and re-check timestamps before trusting old log lines.
- `reason = upstream_unavailable`: upstream GitHub fetch failed during prepare. Check terminal connectivity to `api.github.com` and `raw.githubusercontent.com`.
- `reason = already_delivered`: the sidecar already published once for the same local day, so the run skipped by design.
- `reason = pipeline_failed`: payload generation failed before publish. Check `stderr.log` for validation or model-output errors.
- `error = Local Codex sidecar runner is already in progress`: another run still holds the lock.

Useful network checks when upstream fetch fails:

```bash
curl -I https://api.github.com
curl -I https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json
env | grep -i proxy
scutil --dns | grep nameserver
```

## Output

Successful runs update:

- `web/data/index.json`
- `web/data/latest.json`
- `web/data/digests/YYYY-MM-DD.json`

## License

MIT. See `LICENSE`.
