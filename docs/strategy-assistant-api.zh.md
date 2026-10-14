# 连续销售策略助手接口

`POST /api/cqai-xiaobao/suggest` 接受当前客户原话或销售补充，并返回本轮客户判断、沟通目标、策略、可用话术、风险与来源。销售补充属于沟通上下文，不能作为客户已确认事实或产品政策使用。

```json
{
  "session_id": "本次沟通的会话标识",
  "event_id": "本次提交的唯一事件标识",
  "turn_id": "turn-3",
  "speaker": "sales",
  "utterance": "我已解释使用场景，接下来应该怎么追问？",
  "history": [
    { "turn_id": "turn-1", "speaker": "customer", "text": "这个价格有点贵" },
    { "turn_id": "turn-2", "speaker": "sales", "text": "我已经解释了使用场景" }
  ]
}
```

`history` 可选，只接受 `customer`、`sales`、`unknown` 三种说话人和非空 `text`。提交本轮输入之前的最近沟通原文，排除助手生成的策略与话术。服务端保留最后 24 条，每条最多 4000 字符。若客户端已将本轮输入追加到 `history`，同时传入 `history_includes_current: true`，服务端才移除尾部的本轮副本，避免把客户真正重复的发言误删。省略 `history` 时使用服务端已有会话原文。客户端补入的销售轮次会纳入后续上下文与复盘。

当前输入和每条历史都可携带 `turn_id`，值为去除首尾空白后 1 至 160 字符的文本，身份仅在本次 `session_id` 内使用。客户端为每个新输入生成独立身份；重试旧轮时保留原 `turn_id`，即使内容相同的新一句话也使用新身份。Host 按身份在原位置更新，保留原始时间和后续轮次。例如 A → 失败 B → 成功 C 后重试 B，最终会话仍是 A、B、C，复盘与人工交接不会丢失 C。

旧调用方可以省略 `turn_id`。无身份的历史按说话人和原文顺序匹配，缩短历史窗口不会删除已有的后续原文，重复首句也不会使完整窗口膨胀；无身份的当前输入始终记作新轮，以保留真正重复的客户发言。因此，需要原位重试的调用方应提供稳定 `turn_id`。若尾部历史与当前输入都有身份，只有身份相同的副本才会被 `history_includes_current` 移除。

`speaker: "customer"` 将本轮输入视为客户表达。`speaker: "sales"` 会生成针对销售补充或追问的策略，检索时结合最近一条客户表达；提示中明确标注为销售补充。对未知说话人不做客户事实确认。

响应保留原有 `suggestion` 结构，增加以下字段：

| 字段 | 作用 |
|---|---|
| `suggestion.customer_assessment` | 对客户需求或顾虑的初步判断，未确认内容必须保留待验证边界 |
| `suggestion.communication_goal` | 这一轮优先解决的沟通问题 |
| `suggestion.strategy` | 先做什么、再确认什么，以及推进的步骤 |
| `suggestion_id` | 本轮建议的独立标识；反馈时提交这个值，避免同意图建议混淆 |

新策略字段与话术共用未经授权数字、禁止承诺和来源白名单门禁。旧模型输出缺少新字段时，按本次已审核话术卡的场景与 `response_goal` 补充摘要；模型不可用时同样提供有依据的模板策略。没有依据或命中必须接管规则时，只提供核实和人工接管方向。

新的追问、销售补充、会话、模型路由或审核知识版本都会重新判断。短时间内只有同一会话、相同输入和相同上下文的重复监听结果可以复用。`event_id` 继续用于同一提交的幂等处理：相同事件重复提交返回 `duplicate: true`，不再次生成建议。要重新分析或重试旧轮，使用新的 `event_id`，同时保留该轮的 `turn_id`。

验证使用隔离知识库或内存夹具，不调用付费模型：

```sh
node --test-isolation=none --test test/coach-context.test.mjs test/schemas.test.mjs test/routes.test.mjs test/session-history.test.mjs
```
