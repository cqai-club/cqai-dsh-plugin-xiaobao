# e销宝 安装与运维

面向使用者与维护者。安装、启停、升级、卸载，以及安装后该验证什么。

## 前置条件

| 项目 | 要求 | 怎么确认 |
|---|---|---|
| 应用 | 易宝工坊桌面版（DSH 2.x / Harness `0.2.0-rc.2`） | 关于页面或应用版本号 |
| Profile | 一个可写现有 Profile | 本插件按你的 Profile 安装，不修改应用本体 |
| Node | `^22.19.0 \|\| >=24.0.0` | 仅开发时需要；运行时由应用自带 |
| 语音（可选） | Profile 中启用了语音输入插件 | 见下方「启用语音」 |

**本插件不需要 `npm install`。** `dependencies` 为空，只有 Node 内建模块与平台注入的服务。

## 安装

三种方式等价，按场景选一种。

### 方式一：插件管理界面（推荐）

1. 打开「插件管理 → 添加插件」。
2. 填入 **npm 包名** `@cqaiclub/cqai-dsh-plugin-xiaobao`，或者本目录的**绝对路径**：

   ```text
   C:\Users\Huan LIU\插件\cqai-dsh-plugin-xiaobao
   ```

3. 按提示重启应用。

### 方式二：按 npm 包名安装

插件已发布到 npm，可以直接用包名安装，无需本地目录：

```bash
dsh plugin --profile <profile> add @cqaiclub/cqai-dsh-plugin-xiaobao
```

指定版本（推荐，避免后续发版带来意外升级）：

```bash
dsh plugin --profile <profile> add @cqaiclub/cqai-dsh-plugin-xiaobao@0.2.0
```

在「插件管理 → 添加插件」里填写包名 `@cqaiclub/cqai-dsh-plugin-xiaobao` 也是同样的效果。

### 方式三：从本地目录安装

用应用自带的 DSH CLI，`<profile>` 换成你的 Profile 名（本机默认是 `desktop`）：

```bash
dsh plugin --profile <profile> add "C:\Users\Huan LIU\插件\cqai-dsh-plugin-xiaobao"
```

适合开发调试：改完源码直接装本地目录，不必先发版。

### 确认安装结果

检查 Profile 的组合结果，确认 `cqai-xiaobao` 这一行已经进去：

```bash
dsh --profile <profile> --dump-config
```

在输出里应能找到：

```yaml
- id: cqai-xiaobao
  name: "@cqaiclub/cqai-dsh-plugin-xiaobao"
  config: {}
```

**安装前请备份 Profile 配置。** 插件只插入自己的一行，但这个习惯值得保持。

## 安装后验证

按顺序核对；任一项不符就是安装没完成，而不是功能问题。

1. **右侧边栏出现标签页**：打开任意会话，点右侧栏顶部的「+」，引导页里应出现「e销宝实时陪练」，或直接在标签类型里看到「e销宝」。
2. **配置页可打开**：「插件管理」里找到 `@cqaiclub/cqai-dsh-plugin-xiaobao`，它的详情页应渲染出 e销宝 的知识管理界面（七个页签）。
3. **知识库已就绪**：在配置页看指标卡——「话术卡 30 / 已发布 30 / 产品事实 12」。这说明种子知识注入了空库。
4. **文字链路可用**：在实时面板底部的输入框粘一句「你们这个价格有点贵」，回车。应出现意图 `price_concern`、主建议、来源里的 `price_concern_001`。
5. **转人工生效**：输入「我要退款」，应显示「需要人工接管」并给出原因，且不生成承诺性话术。
6. **左侧工作台**：左侧栏出现「e销宝」入口，默认打开全宽销售策略对话，也可切换到知识管理。

命令行快速核对（把端口换成本机实际端口，见应用启动日志里的 URL）：

```bash
curl -s "http://127.0.0.1:<port>/api/cqai-xiaobao/health"
```

应返回 JSON，含 `"plugin":"@cqaiclub/cqai-dsh-plugin-xiaobao"`、`knowledge.cards` 数量与当前模型路由。

## 启用语音（可选）

文字链路不依赖语音。要用麦克风实时识别，需要 Profile 中启用平台的语音输入 bundle：

```yaml
- id: speech-to-text
  name: '@deepseek-ai/dsh-experimental-speech-to-text'
  config:
    defaultProvider: sensevoice-local
- id: speech-to-text-sensevoice
  name: '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice'
  config:
    dataRoot: !!js dshHomePath('speech-to-text', 'sensevoice')
- id: api-speech-to-text
  name: '@deepseek-ai/dsh-experimental-api-speech-to-text'
- id: ui-voice-input
  name: '@deepseek-ai/dsh-experimental-client-ui-voice-input'
```

**首次使用需要下载并校验模型**（SenseVoiceSmall ONNX + Silero VAD，约 1GB），可能需要数分钟。面板上的「语音输入」或「持续监听」会触发这一步；准备过程中面板显示 ASR 状态，失败时给出具体阶段与原因。

如果语音不可用，面板会给出不可用原因，并保留下方的手动输入框——这是设计好的降级路径，不是故障。

## 首次配置建议

种子知识只是让插件开箱可用，**不是**可信的业务事实。上线前请至少做完这几件事：

1. **替换产品事实。** 在配置页「产品与政策」里改成本产品的真实价格、优惠、退款、配送、售后与能力边界。每条都要填 `source`（依据来自哪里）与 `reviewed_by`。
2. **核对禁止承诺。** `forbidden-claims-v3` 里的全局禁止表达会由代码强制拦截，按你所在行业补充。
3. **替换话术卡。** 用真实通话里的客户表达替换 `customer_utterances`——检索靠它做相似度召回，写得越贴近真实说法越准。
4. **逐条审核。** 种子卡片已标记为 `approved`；改动后请走「审核队列 → 通过并发布」，让审计链从你的操作开始。
5. **试运行验证。** 用「试运行」页签粘真实客户原话，确认召回与接管判定符合预期。

## 启停与卸载

| 操作 | 做法 | 结果 |
|---|---|---|
| 停用 | 插件管理里关闭 `@cqaiclub/cqai-dsh-plugin-xiaobao` | 标签页、配置页、工作台入口与工具、技能一起移除 |
| 重新启用 | 插件管理里打开 | 重新加载，知识库从磁盘读回 |
| 卸载 | 插件管理里移除 | 同上；**不会删除** `$DSH_HOME/xiaobao/` 下的业务数据 |

卸载不清理业务数据是刻意的：话术卡与审计是你积累的资产，不该被一次卸载带走。要清理请手动处理：

```text
$DSH_HOME\xiaobao\knowledge\
```

## 升级

从 `0.1.x` 的旧包 `cqai-dsh-plugin-xiaobao` 升级到 `0.2.0` 时，先停用或移除旧包，再添加 `@cqaiclub/cqai-dsh-plugin-xiaobao@0.2.0`。保留 `$DSH_HOME/xiaobao/` 下的数据；不要同时启用两个包，以免重复注册相同面板、路由和 Host 行。新的包名也需要更新 Profile 里原来的 `name` 或通过插件管理重新添加。

1. 记住当前版本（`dsh.plugin.json` 的 `version`）。
2. 用新版目录替换旧目录。
3. 重启应用。
4. 按上面「安装后验证」重跑一遍。**平台小版本升级后尤其要跑**——客户端模块的工厂契约是静默失败的，形状不对时不会报错。

知识库在升级时保持不变；种子注入只在库为空时发生，不会覆盖你的内容。

## 兼容性

| 契约 | 本插件依赖的形态 | 平台升级后怎么检查 |
|---|---|---|
| Bundle patch | `dsh.bundle.patch` 指向 `cordis.patch.yml` | `--dump-config` 里 `cqai-xiaobao` 行存在 |
| 客户端模块工厂 | `window.__ModuleLoader__.load({id, factory})` | 面板没出现时**首先查这里**；形状不对是静默失败 |
| 右侧标签类型 | `ctx.sidebarRightTabs.register({id, kind, priority, title, guide})` | 引导页里能看到「e销宝实时陪练」 |
| 配置页槽位 | `plugins.bundle.config`，`key` 为包名 | 插件详情页能渲染出知识管理 |
| 面板槽位 | `main` + `sidebar.panellist` | 左侧栏出现「e销宝」 |
| 语音远程服务 | `ctx.remote.speech.{catalog,prepare,transcribe}` 的 `RemoteResult`：检查 `ok` 并读取 `value` | 开始监听时识别器准备成功，转写返回真实文本；准备期间可停止等待 |
| WAV 输入 | 16 kHz / 单声道 / PCM16 / 规范头 | 语音报「识别失败」时查这里；`test/client-shape.test.mjs` 有字节级断言 |

## 故障排查

事项按「先看面板，再看日志」的顺序。

**面板没出现**
1. 确认插件已启用（插件管理里的开关）。
2. 确认已重启应用。
3. 打开浏览器开发者工具看 Console：客户端模块加载失败会在这里留下痕迹。
4. 运行 `node scripts/selfcheck.mjs`——它会检查工厂形状与种子数据。

**面板出现但建议一直「已降级」**
模型路由不可用。检查「设置 → 模型」是否选定了 provider 与 model；再 `curl` 一下 `/health` 看 `model` 字段是否为 `null`。降级状态下话术仍然有依据，只是表述来自模板。

**ASR 不可用**
语音输入 bundle 未启用，或模型尚未准备完成。面板会显示具体阶段。「连接与隐私」页签可以看到当前语音服务状态。

**建议里没有来源 / 来源为空**
检索没有命中任何已审核卡片。去「版本与健康」看「知识缺口」列表，补对应意图的话术卡。

**配置页显示为零张卡片**
知识库位置可能被 `dataRoot` 配置指到了别处。`/health` 返回的 `data_root` 是实际路径。

## 隐私

如实说明，便于你判断是否合规：

- **音频不落盘。** 每段录音只存在于内存中，识别完成后即丢弃。
- **转写不落盘。** 只保留在本次会话的内存里，供复盘使用；插件不写入独立数据库，应用重启即消失。
- **审计不记录客户原话。** `audit.jsonl` 只写意图、是否降级、是否转人工、延迟与模型路由。
- **模型调用会发送**当前客户语句、最近数轮对话、已审核话术卡与产品事实。客户原话被明确标记为**不可信数据**，模型无法通过它改变插件规则、权限或价格政策。
- 所有 HTTP 接口**只服务本机**（非环回地址一律 403）。

上线前请确认：录音告知、音频留存与转写保留策略符合你所在地区的要求。本插件提供了最小留存的默认值，但合规判断不能由插件代替。
