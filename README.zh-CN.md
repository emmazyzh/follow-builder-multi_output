# aimanews

## 当前范围

这个分支现在只做下面几件事：

- 从 `zarazhangrui/follow-builders` 拉取上游 feed
- 生成统一的日报 payload
- 把归档数据写入 `web/data/`
- 通过 git 发布静态 Web 归档


## 主要文件

- `scripts/run-local-codex-sidecar.js`：本地定时运行入口
- `scripts/send-agent-payload.js`：标准化 payload 并更新 `web/data/`
- `scripts/web-archive.js`：静态归档发布逻辑
- `launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist`：本地 LaunchAgent 示例
- `web/`：静态站资源

## 配置

示例配置见 `config/sidecar.config.sample.json`。

Web 投递配置：

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

## 常用命令

```bash
cd scripts
npm install
node sidecar-status.js
node sidecar-configure.js --web-output-dir /absolute/path/to/web
node run-sidecar.js --skip-delivery
node run-local-codex-sidecar.js --dry-run
```

- `node sidecar-status.js`：输出当前 sidecar 配置、状态文件、上游 feed 兼容性，以及识别到的原始/sidecar cron job 信息。
- `node sidecar-configure.js --web-output-dir /absolute/path/to/web`：更新 Web 归档输出目录。
- `node run-sidecar.js --skip-delivery`：执行主流程，但不落地最终 Web 发布结果，适合安全检查上游探测和 payload 生成链路。
- `node run-local-codex-sidecar.js --dry-run`：按本地 LaunchAgent 的真实运行链路做一次 dry-run，适合排查定时任务是否能正常跑通。

## 重新部署

按这个顺序执行：

1. 更新仓库并安装脚本依赖。

```bash
cd /Users/yongzhenzhuang/Projects/aimanews
git pull
cd scripts
npm install
```

2. 确认 sidecar 配置里的 Web 输出目录。

```bash
node sidecar-configure.js --web-output-dir /Users/yongzhenzhuang/Projects/aimanews/web
node sidecar-status.js
```

预期结果：

- `node sidecar-configure.js` 返回 `status: "ok"`
- `config.delivery.web.outputDir` 是 `/Users/yongzhenzhuang/Projects/aimanews/web`
- `node sidecar-status.js` 里能看到同样的输出目录
- `config.delivery.targets` 是 `["web"]`

3. 先做不发布的验证。

```bash
node run-sidecar.js --skip-delivery
node run-local-codex-sidecar.js --dry-run
```

预期结果：

- 两条命令都正常退出，退出码是 `0`
- `node run-sidecar.js --skip-delivery` 通常会返回两种之一：
  - `status: "ok"`：说明生成链路对当前上游内容可正常工作
  - `status: "skipped"`：说明当天没有符合条件的新上游内容，这种情况也可能是正常的
- `node run-local-codex-sidecar.js --dry-run` 会更新 `.runtime/local-runner/last-result.json`
  - 开始时是 `status: "in_progress"`
  - 结束时会变成 `status: "ok"`、`status: "skipped"` 或 `status: "error"`
  - dry-run 即使成功，也不应当被视为一次正式发布成功

4. 手动跑一次真实发布。

```bash
/Users/yongzhenzhuang/.nvm/versions/node/v20.20.0/bin/node /Users/yongzhenzhuang/Projects/aimanews/scripts/run-local-codex-sidecar.js
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

预期结果：

- 命令正常退出，退出码是 `0`
- `.runtime/local-runner/last-result.json` 最终应包含：
  - `status: "ok"`
  - `stage: "delivery"`
- 一般还会看到：
  - `prepare.status: "needs_payload"`
  - `delivery.status: "ok"`
  - `delivery.delivery.results.web.status: "ok"`
  - `delivery.delivery.results.web.digestPath`
  - `delivery.delivery.results.web.indexPath`
  - `delivery.delivered: true`

5. 在 macOS 上配置 LaunchAgent 定时任务。

在 macOS 上的基本配置方式：

- 把 plist 放到 `~/Library/LaunchAgents/`
- 用 `launchctl bootstrap` 加载到当前图形用户会话
- 用 `launchctl print` 检查是否已经按预期生效
- 需要时用 `launchctl kickstart -k` 手动触发一次

```bash
cp /Users/yongzhenzhuang/Projects/aimanews/launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist
launchctl bootout gui/501 /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist 2>/dev/null || true
launchctl bootstrap gui/501 /Users/yongzhenzhuang/Library/LaunchAgents/com.yongzhenzhuang.follow-builders-sidecar-codex.plist
launchctl print gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
launchctl kickstart -k gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
```

最终输出里应该看到：

- `Hour = 20`
- `Minute = 0`

5. 修改 LaunchAgent 定时任务时间。

- 如果你要改“macOS 何时、用什么环境启动任务”，就改 `launchd/com.yongzhenzhuang.follow-builders-sidecar-codex.plist`
- 改定时时间：编辑 `StartCalendarInterval`
- 改 Node 路径：编辑 `ProgramArguments[0]`
- 改脚本路径：编辑 `ProgramArguments[1]`
- 改 LaunchAgent 和终端环境差异：编辑 `EnvironmentVariables`，重点看 `PATH` 和 `HOME`
- 改日志输出位置：编辑 `StandardOutPath` 和 `StandardErrorPath`


## 每日定时任务流程

每天 `20:00`，LaunchAgent 会执行：

```bash
/Users/yongzhenzhuang/.nvm/versions/node/v20.20.0/bin/node /Users/yongzhenzhuang/Projects/aimanews/scripts/run-local-codex-sidecar.js
```

执行过程如下：

1. `run-local-codex-sidecar.js` 启动一次 run，把 `last-result.json` 先写成 `in_progress`，并获取本地锁。
2. 它调用 `run-sidecar.js --prepare-only`，检查上游 feed，并判断当天是否有需要处理的新 commit。
   现在检查的上游 feed 文件包括：
   - `feed-x.json`
   - `feed-podcasts.json`
   - `feed-blogs.json`
   代码会先动态发现上游仓库根目录下的 `feed-*.json` 文件；如果动态发现失败，再回退到上面这份固定列表。
3. 如果上游有效，就把准备好的快照写入 `.runtime/local-runner/latest-raw.json`。
4. 然后调用 Codex 生成结构化 digest payload，写入 `.runtime/local-runner/latest-payload.json`。
5. 对 payload 的结构和 item 数量做校验。
6. 调用 `send-agent-payload.js`，标准化 payload 并更新：
   - `web/data/index.json`
   - `web/data/latest.json`
   - `web/data/digests/YYYY-MM-DD.json`
7. Web 归档发布步骤会提交刷新后的静态数据。
8. 最后把 `last-result.json` 更新成 `ok`、`skipped` 或 `error`，并记录 `runId`、`startedAt`、`finishedAt`。

主要运行产物：

- `.runtime/local-runner/last-result.json`
- `.runtime/local-runner/stdout.log`
- `.runtime/local-runner/stderr.log`
- `.runtime/local-runner/latest-raw.json`
- `.runtime/local-runner/latest-payload.json`

## 每日定时任务失败排查

建议按这个顺序查：

1. 先看 LaunchAgent 是否加载正常、当前生效的时间是否正确。

```bash
launchctl print gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex | egrep 'state =|active count|last exit code|Hour|Minute'
```

2. 看当前是不是还有任务在跑。

```bash
ps -ax | grep run-local-codex-sidecar.js | grep -v grep
```

3. 看最新结果和文件时间戳。

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stdout.log /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stderr.log
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

4. 读最近日志。

```bash
tail -n 50 /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stderr.log
tail -n 20 /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/stdout.log
```

5. 用同一条定时任务路径手动重跑。

```bash
launchctl kickstart -k gui/501/com.yongzhenzhuang.follow-builders-sidecar-codex
sleep 30
cat /Users/yongzhenzhuang/Projects/aimanews/.runtime/local-runner/last-result.json
```

常见结果解释：

- `status = in_progress`：本次任务已经启动但还没结束。先等一会儿，再看时间戳，不要直接把旧结果当成这次结果。
- `reason = upstream_unavailable`：prepare 阶段拉上游 GitHub 失败。重点检查 `api.github.com` 和 `raw.githubusercontent.com`。
- `reason = already_delivered`：同一个本地日期已经发布过一次，这是按设计跳过。
- `reason = pipeline_failed`：payload 生成或校验失败。去看 `stderr.log` 里的模型输出或校验错误。
- `error = Local Codex sidecar runner is already in progress`：另一个运行还持有锁。

上游拉取失败时常用的网络检查：

```bash
curl -I https://api.github.com
curl -I https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json
env | grep -i proxy
scutil --dns | grep nameserver
```

## 输出

成功运行后会更新：

- `web/data/index.json`
- `web/data/latest.json`
- `web/data/digests/YYYY-MM-DD.json`

## License

MIT，见 `LICENSE`。
