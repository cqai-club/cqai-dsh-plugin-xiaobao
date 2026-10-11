# e销宝 发版流程

面向维护者。记录一次完整发版要做什么，以及本机环境里几个非显然的坑。

适用前提：本机是 DSH 的 Windows 沙箱（`workspace-write`），可写范围只有工作区。

## 一、发版前自检

```bash
node scripts/selfcheck.mjs
```

必须 **18 项全过**。这一步同时跑 86 个单元测试与离线评测。

改过知识库或夹具后，先重建：

```bash
node scripts/build-seed.mjs
node scripts/build-fixtures.mjs
node scripts/eval.mjs
```

`prepublishOnly` 会在 `npm publish` 前再自动跑一次自检——坏包发不出去。

## 二、升版本

**两份清单必须同步**，`selfcheck` 会断言它们一致：

- `package.json` → `version`
- `dsh.plugin.json` → `version`

> ⚠️ 不要用 `npm version patch`。它会 spawn 一个带管道的 git 子进程，在本沙箱下直接失败（`spawn EPERM`）。手工改这两处即可。

然后提交并打标签：

```bash
git add -A
git commit -F <提交信息文件>
git tag -a v0.1.1 -m "e销宝 v0.1.1"
```

## 三、推到 GitHub

仓库：`https://github.com/cqai-club/cqai-dsh-plugin-xiaobao`

### 本机必须的 SSH 变通（重要）

直接 `git push` 会失败：

```
ssh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
```

原因：Git for Windows 自带的 `ssh.exe` 是 MSYS 程序，需要创建 signal pipe，而沙箱禁止该操作。

解决办法是让 git 改用 **Windows 原生 OpenSSH**，中间垫一个包装器补上选项（`GIT_SSH` 只能给可执行文件路径，无法传参）：

`C:\Users\HUANLI~1\插件\.ssh-home\git-ssh.cmd`（内容全 ASCII、CRLF；`cmd.exe` 用 OEM 代码页读 `.cmd`，非 ASCII 注释会被当成命令执行）：

```bat
@echo off
"C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=NUL -o BatchMode=yes %*
```

每次推送前设置两个环境变量：

```powershell
$env:GIT_SSH = "C:\Users\HUANLI~1\插件\.ssh-home\git-ssh.cmd"
$env:GIT_SSH_VARIANT = "ssh"   # 不设会被判为 simple 变体，从而拒绝传 -p
git push origin main --follow-tags
```

补充说明：

- 端口 22 被网络阻断，所以远程地址用 **SSH over 443**：
  `ssh://git@ssh.github.com:443/cqai-club/cqai-dsh-plugin-xiaobao.git`
- `UserKnownHostsFile=NUL` 是必需的：真实的 `~/.ssh/known_hosts` 在工作区外，沙箱不允许写入。
- 不要试图用 `GIT_SSH_COMMAND` 或 `core.sshCommand`——它们经 `sh` 执行，同样触发 signal pipe 限制。
- 包装器路径刻意用 8.3 短名，避免用户名里的空格。

## 四、发布到 npm

包名 `cqai-dsh-plugin-xiaobao`（公开、unscoped）。

### 认证

`npm login` 的会话凭据**不足以发布**——账号开了 2FA，会得到：

```
403 Two-factor authentication or granular access token with bypass 2fa
enabled is required to publish packages.
```

两个可用途径：

1. **一次性密码**：`npm publish --otp=<6 位码> --ignore-scripts`
2. **合规令牌**：npmjs.com → Access Tokens → **Granular Access Token**，权限 `Read and write`、Packages 选 **All packages**（新包无法单独勾选）、并**打开 2FA bypass 开关**；或直接用 **Classic Token 的 Automation 类型**（天生绕过 2FA）。

### 发布

令牌不要写进插件目录（会被打进 tarball）。放在包目录之外，用完即删：

```powershell
$cfg = "C:\Users\Huan LIU\插件\.npmrc-publish"
Set-Content -Path $cfg -Value "//registry.npmjs.org/:_authToken=<令牌>" -NoNewline -Encoding ascii
npm publish --userconfig $cfg
Remove-Item $cfg -Force
```

### 关于「being processed」

有时 `npm publish` 立刻返回 exit 0 并打印：

```
npm notice Your package is being processed and may take a few minutes to become available.
```

此时 registry 上可能只看到 `0.0.0-stage` 占位版本，**这是正常的**——那是 npm 暂存发布留下的占位记录。等 1–5 分钟后新版本会出现并成为 `latest`。`npm install` 取的是 `latest`，不受影响。

### 发布后必须验证

不要只看发布日志。从干净目录装回来，再对**装回来的那份**跑它自带的自检：

```powershell
mkdir .verify-install; cd .verify-install
npm install cqai-dsh-plugin-xiaobao@<版本>
cd node_modules\cqai-dsh-plugin-xiaobao
node scripts/selfcheck.mjs
```

通过后删掉 `.verify-install`。这样才能证明 registry 上那一份是完整、可加载、可运行的。

## 五、提交 CQAI Club 市场

用 Agent 工具 `cqai_club_submit_plugin`，需带 `confirmed: true`，DSH 会再弹一次批准请求。投稿只提交资料，不上传安装包，也不会自动上架。

### 当前阻塞（截至 2026-10-11）

投稿会被 Host 拒绝：

```
请先更新 e宝工坊内的 CQAI Club 基础插件，当前版本尚不支持俱乐部扩展。
```

诊断结果：本机易宝工坊 `0.0.14` 内置的 `@cqaiclub/dsn-account` 是 **0.1.1**，缺少俱乐部扩展 API v1 的三项契约：

| 契约 | 实际 |
|---|---|
| `extensionApiVersion: 1` | 未声明 |
| `@cqaiclub/dsn-account/club-ui` 导出 | 无（只有 `.`、`./protocol`、`./client`、`./cordis.patch.yml`、`./package.json`） |
| `useResource` | 全部产物中均无 |

而 `0.0.14` **已经是最新 release**（`cqai-club/ebao-studio`，2026-10-09），所以升级应用也无法解决。`@cqaiclub/dsn-account` 不发布到公共 npm，只随应用交付，因此也无法单独更新。

**结论**：市场投稿需要等一个包含 eBao Studio PR #47 的新版易宝工坊发布。在此之前，插件只能通过 npm 或本地目录安装。届时重跑本节即可。