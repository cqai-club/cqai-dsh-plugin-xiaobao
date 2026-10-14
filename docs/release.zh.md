# e销宝 发版流程

仓库：<https://github.com/cqai-club/cqai-dsh-plugin-xiaobao>。公开 npm 包：`@cqaiclub/cqai-dsh-plugin-xiaobao`。主分支是 `main`；发布工作流同时支持 `master`。

## 日常发版

1. 同步修改 `package.json`、`dsh.plugin.json` 的版本，补充 `CHANGELOG.md`。同一个 npm 版本不可重复发布；未升级版本的合并会跳过 npm 发布。
2. 运行 `node scripts/selfcheck.mjs`，确认单元测试、清单、客户端加载和离线评测全部通过。
3. 提交到功能分支，创建以 `main` 为目标的 PR。`ci.yml` 在 Node 22.19 和 24 上自检，并从实际 tarball 解包再自检。
4. 合并 PR 后，`publish.yml` 自动验证、打包，使用 npm Trusted Publishing 发布，再验证 registry 和创建 GitHub Release / tarball 附件。

`workflow_dispatch` 可手动重跑 `main` / `master` 的发布任务。网络或认证错误会使任务失败，不会被当成“版本不存在”。已发布版本会先核对包内容再跳过 npm；任务重跑不会移动已有版本标签。

项目没有运行时依赖，CI 不需要安装依赖，也不依赖本机生成的 `package-lock.json`。

## 首次 npm 配置

当前包迁移到 `@cqaiclub` 作用域，发布账号必须有 `cqaiclub` 组织的写入权限。旧的无作用域包不会自动转移到新组织。`0.2.0` 已于 2026-10-14 完成首次公开发布；当前待发版本为 `0.2.1`，合并后用于完成第一次 OIDC 自动发布。

首次发布与配置 Trusted Publisher 需要 npm 账号认证；2FA / WebAuthn 由账号拥有者完成。npm 要求包已存在后才能配置 Trusted Publisher。先检查并打包，再首次发布：

```bash
node scripts/selfcheck.mjs
npm pack --ignore-scripts --pack-destination /path/to/release-artifacts
npm publish /path/to/release-artifacts/bootstrap-package.tgz --access public
```

为包配置以下 GitHub Trusted Publisher：

| 字段 | 值 |
|---|---|
| Organization or user | `cqai-club` |
| Repository | `cqai-dsh-plugin-xiaobao` |
| Workflow filename | `publish.yml` |
| Environment | 留空，与工作流一致 |
| Allowed actions | 允许直接 `npm publish` |

npm CLI 11.15 及以上可运行以下配置命令；也可在 npm 包设置的 Trusted Publisher 页面填写相同字段：

```bash
npm trust github @cqaiclub/cqai-dsh-plugin-xiaobao \
  --repository=cqai-club/cqai-dsh-plugin-xiaobao \
  --file=publish.yml --allow-publish --yes
npm trust list @cqaiclub/cqai-dsh-plugin-xiaobao
```

工作流拥有 `id-token: write`，不需要把 npm 发布 token 写入 GitHub Secret。GitHub Release 使用仓库提供的 `GITHUB_TOKEN` 和 `contents: write`。不要在 PR 检查中授予发布权限。

新 Trusted Publisher 配置需在 npm 规定的有效窗口内完成第一次 CI 发布；若已手工发布当前版本，下一次需要升级版本再合并。具体要求以 [npm Trusted Publishing 文档](https://docs.npmjs.com/trusted-publishers/)为准，配置应尽量靠近首个自动发布时间。

## 发布后验证

```bash
npm view @cqaiclub/cqai-dsh-plugin-xiaobao@0.2.1 version dist.integrity --registry=https://registry.npmjs.org/
```

还应从 registry 的实际 tarball 解包，运行包里的 `scripts/selfcheck.mjs`，确认随包代码、知识种子和技能完整。GitHub Release 的 tag、版本和 tarball 应与 npm 版本对应。

本次从旧包升级时，按[安装说明](install.zh.md)停用旧包后安装新包；数据目录继续使用 `$DSH_HOME/xiaobao/`。
