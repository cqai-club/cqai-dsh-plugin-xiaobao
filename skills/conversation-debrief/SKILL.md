---
name: conversation-debrief
description: 通话结束或销售人员主动结束会话后加载，输出复盘、跟进动作与知识缺口，产物只进审核队列。
---

# conversation-debrief

## 何时使用

- 销售人员点击「结束会话」后，需要一份通话复盘时。
- 通话中途暂停，需要阶段性小结时（只输出已发生部分，不预测后续）。
- 复盘中发现知识缺口，需要生成候选知识或候选话术卡时。

不要在通话还在进行时用于实时建议；实时建议走 `realtime-sales-coach`。

## 要做什么

1. **汇总输入**。本次会话的稳定转写（含说话人标签与置信度）、期间产生的建议与销售人员的采纳/修改/跳过记录、`get_customer_context` 中本次会话产生的已确认信息。
2. **写通话摘要**。3–6 句，按时间顺序讲清客户要什么、聊到了哪里、停在哪里。不复述逐句转写。
3. **提取需求**。客户明确表达的需求；推断另列，标注为推断。
4. **提取异议**。客户提出的每一类顾虑、销售的处理方式、以及**是否解决**。未解决的要保留，不要因为通话结束了就当已解决。
5. **列出未解问题**。客户问了但没有得到答案的问题，以及销售问了但客户没回答的问题。
6. **判断客户意向**。用低/中/高描述并给出依据（客户的具体行为或原话），不要只给一个分数。**不输出伪确定的成交概率百分比**。
7. **给建议跟进动作**。每条包含：做什么、什么时候、依据什么。动作限于人工跟进的范围内。
8. **提取知识缺口**。本次会话中出现的、知识库里没有依据或依据不足的情况：客户常问但政策没写的、话术卡里找不到合适表达的、政策之间冲突的、话术卡内容已明显过时的。
9. **生成候选内容**（可选）。针对知识缺口，用转写中的真实表达生成候选话术卡草案，按 §6.2 结构填写，`status` 一律为 `draft`。
10. **全部产物进入审核队列**，并在输出中明确说明这一点。

## 输出契约

```json
{
  "summary": "",
  "needs": [],
  "objections": [
    { "type": "", "customer_words": "", "handling": "", "resolved": false }
  ],
  "unresolved_questions": [],
  "intent_level": "low|medium|high",
  "intent_evidence": [],
  "follow_up_actions": [
    { "action": "", "when": "", "basis": "" }
  ],
  "knowledge_gaps": [],
  "candidate_cards": [],
  "handoff_occurred": false,
  "review_queue_only": true
}
```

字段含义与约束：

- `summary`：通话摘要，3–6 句，事实性，不带营销评价。
- `needs`：从客户原话归纳的需求；推断出的需求要显式标注"（推断）"。
- `objections[].customer_words`：客户原话片段，不改写。
- `objections[].resolved`：布尔值。客户没有明确表示接受时填 `false`。
- `unresolved_questions`：未得到回答的问题数组，写成问题本身。
- `intent_level`：`low` / `medium` / `high`；`intent_evidence` 必须至少给一条具体依据，否则 `intent_level` 只能是 `low`。
- `follow_up_actions[].basis`：依据（客户原话、政策条目、未解问题）。没有依据的动作不要写。
- `knowledge_gaps`：缺口描述，尽量带上客户原话，便于知识同事判断要不要补。
- `candidate_cards`：候选话术卡数组，结构按 §6.2，其中：
  - `status` 必须是 `draft`；
  - `approved_responses` 中的句子要来自本次会话中真实出现过或由销售确认过的表达；
  - `evidence_refs` 只填真实存在的政策条目；
  - `reviewed_by`、`effective_from` 留空，由审核人填写；
  - 拿不准的字段宁可留空，不要编造。
- `handoff_occurred`：本次通话是否建立过人工接管任务。
- `review_queue_only`：固定 `true`。这是对"不自动发布"的显式承诺。

## 候选话术卡结构（§6.2）

```json
{
  "id": "price_concern_001",
  "scenario": "价格异议",
  "intent": "price_concern",
  "product_ids": ["product-a"],
  "customer_utterances": ["太贵了", "有没有便宜一点的"],
  "stage": ["first_contact", "comparison"],
  "response_goal": "区分预算问题与价值不确定",
  "approved_responses": ["..."],
  "follow_up_questions": ["..."],
  "do_not_say": ["保证一定有效", "虚构限时优惠"],
  "evidence_refs": ["pricing-policy-v3"],
  "risk_level": "medium",
  "escalation": "none|suggest|required",
  "status": "draft|review|approved|retired",
  "version": 3,
  "effective_from": "2026-10-10T00:00:00+08:00",
  "expires_at": null,
  "reviewed_by": "user-id",
  "updated_at": "2026-10-10T00:00:00+08:00"
}
```

状态机由代码强制：`draft → review → approved → retired`。只有 `approved` 且在生效期内的话术卡能被检索到。**本 Skill 产出的卡片永远停在 `draft`**，能否进入实时库由人工审核决定。

## 知识缺口的处理

发现缺口时：

- 记入 `knowledge_gaps`，说明缺什么、客户原话是什么、影响多大；
- 不要用模型推断临时补一条"事实"塞进知识库；
- 缺口涉及价格、退款、承诺类内容时，标记为高优先级，并说明在补齐前实时建议应当走"无依据→提问或转人工"路径。

## 隐私与数据

- 复盘中可以引用客户原话，但不写入与业务无关的敏感信息（证件号、银行卡、密码、健康细节等）。输入里出现这类内容时脱敏或省略。
- 只使用当前会话允许使用的数据，不跨会话、不跨客户引用。
- 复盘对象是本次通话，不评价销售个人的绩效、能力或排名。

## 边界与禁止

- **绝不自动发布**。不调用任何发布/审核工具（不存在），不把 `status` 写成 `approved`，不把候选内容当作实时库依据。
- 不修改已有话术卡或产品政策。
- 不虚构客户需求、异议、意向或跟进动作；没有的信息就留空数组。
- 不给成交概率、不下"这个客户没戏"的结论。
- 不把推断写成客户事实。
- 不生成任何对外发送、外呼、改价、折扣、退款、合同类动作，这些能力不存在于本插件。
- 复盘尾部要明确写一句：产物仅进入审核队列，等待人工审核，不影响当前实时库。
