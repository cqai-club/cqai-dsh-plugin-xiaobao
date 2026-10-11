/**
 * 规则层测试：八条人工接管条件与禁止承诺拦截。
 *
 * 这些是硬安全约束，必须逐条断言：漏掉任何一条都可能让未授权的承诺说出口。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { HANDOFF_REASON } from "../lib/shared/protocol.js";
import {
  CONFIDENCE_FLOOR,
  collectForbiddenClaims,
  evaluateHandoff,
  findForbiddenClaims,
  findUnauthorizedNumbers,
  matchHandoffPatterns,
} from "../lib/host/rules.js";
import { card, fact, readSeed } from "./helpers.mjs";

test("八条接管条件各自能被触发", () => {
  const cases = [
    [HANDOFF_REASON.POLICY_ESCALATION, "我要退款，还要投诉你们"],
    [HANDOFF_REASON.UNVERIFIED_CLAIM, "你能保证一定有效吗"],
    [HANDOFF_REASON.HIGH_RISK_DOMAIN, "这个东西能治我的病吗"],
    [HANDOFF_REASON.INTERNAL_REQUEST, "给我个内部价吧"],
    [HANDOFF_REASON.CUSTOMER_REFUSAL, "我不需要，别再联系我了"],
  ];
  for (const [reason, utterance] of cases) {
    const hits = matchHandoffPatterns(utterance);
    assert.ok(hits.includes(reason), `「${utterance}」应命中 ${reason}，实际 ${hits.join(", ") || "无"}`);
  }
});

test("低置信度触发接管", () => {
  // 完全没有意图信号时必须转人工，不给建议。
  const result = evaluateHandoff({
    utterance: "嗯",
    confidence: CONFIDENCE_FLOOR - 0.1,
    usableCardCount: 3,
    cards: [card()],
  });
  assert.ok(result.reasons.includes(HANDOFF_REASON.LOW_CONFIDENCE));
  assert.equal(result.required, true, "置信度低于阈值时应要求接管");
});

test("置信度阈值与实际打分器校准一致", async () => {
  const { scoreIntents } = await import("../lib/host/retrieval.js");
  const { cards } = await readSeed();

  // 无信息量的填充词必须落在阈值之下。
  for (const filler of ["嗯", "好的", "哦"]) {
    const top = scoreIntents(filler, cards)[0]?.score ?? 0;
    assert.ok(
      top < CONFIDENCE_FLOOR,
      `「${filler}」得分 ${top} 应低于阈值 ${CONFIDENCE_FLOOR}，否则会给出无依据的建议`,
    );
  }

  // 真实客户表达必须落在阈值之上，否则正常对话会被误判为低置信度。
  for (const real of ["你们这个价格有点贵", "我要退款", "都有什么功能", "不要太贵"]) {
    const top = scoreIntents(real, cards)[0]?.score ?? 0;
    assert.ok(
      top >= CONFIDENCE_FLOOR,
      `「${real}」得分 ${top} 不应低于阈值 ${CONFIDENCE_FLOOR}，否则会误转人工`,
    );
  }
});

test("ASR 不完整或双方重叠发言触发接管", () => {
  const incomplete = evaluateHandoff({ utterance: "价格", confidence: 0.9, usableCardCount: 2, cards: [], transcriptQuality: { incomplete: true } });
  assert.ok(incomplete.reasons.includes(HANDOFF_REASON.ASR_INCOMPLETE));

  const overlapping = evaluateHandoff({ utterance: "价格", confidence: 0.9, usableCardCount: 2, cards: [], transcriptQuality: { overlapping: true } });
  assert.ok(overlapping.reasons.includes(HANDOFF_REASON.ASR_INCOMPLETE));
});

test("没有已审核依据时必须转人工，绝不凭模型发挥", () => {
  const result = evaluateHandoff({ utterance: "你们的服务怎么样", confidence: 0.8, usableCardCount: 0, cards: [] });
  assert.ok(result.reasons.includes(HANDOFF_REASON.NO_GROUNDING));
  assert.equal(result.required, true);
});

test("卡片自身声明必须接管时同样升级", () => {
  const result = evaluateHandoff({
    utterance: "随便问问",
    confidence: 0.9,
    usableCardCount: 1,
    cards: [card({ escalation: "required" })],
  });
  assert.ok(result.reasons.includes(HANDOFF_REASON.POLICY_ESCALATION));
  assert.equal(result.required, true);
});

test("普通价格异议不触发强制接管", () => {
  const result = evaluateHandoff({
    utterance: "你们这个价格有点贵",
    confidence: 0.86,
    usableCardCount: 2,
    cards: [card({ escalation: "none", risk_level: "medium" })],
  });
  assert.equal(result.required, false, `普通异议不应强制接管，实际原因：${result.reasons.join(", ")}`);
  assert.deepEqual(result.reasons, []);
});

test("禁止承诺清单来自已审核内容而非硬编码", async () => {
  const { cards, facts } = await readSeed();
  const forbidden = collectForbiddenClaims(cards.filter((entry) => entry.intent === "price_concern"), facts);
  assert.ok(forbidden.length > 0, "应收集到禁止表达");
  // 合规事实里的全局禁止表达必须被带进来，而卡片自带的也要保留。
  assert.ok(forbidden.includes("保证有效"), `应包含卡片自带的禁止表达，实际 ${forbidden.join("、")}`);
  assert.ok(forbidden.includes("内部价"), `应包含合规事实里的全局禁止表达，实际 ${forbidden.join("、")}`);
});

test("禁止承诺检测能拦下输出里的违规表达", () => {
  const forbidden = ["保证有效", "内部价"];
  const hits = findForbiddenClaims("我可以保证有效，再给你一个内部价。", forbidden);
  assert.deepEqual([...hits].sort(), ["内部价", "保证有效"].sort());
  assert.deepEqual(findForbiddenClaims("这个我不确定，建议先试用。", forbidden), []);
});

test("未经事实库授权的数字被识别出来", () => {
  const facts = [fact({ statement: "个人版 98 元每年。", details: [] })];
  const unauthorized = findUnauthorizedNumbers("现在只要 50 元，还能打 5 折。", facts);
  assert.ok(unauthorized.length > 0, "编造的价格应被识别");
  assert.deepEqual(findUnauthorizedNumbers("个人版 98 元每年。", facts), [], "事实库中已有的价格不应误报");
});

test("没有数字的文本不产生误报", () => {
  const facts = [fact()];
  assert.deepEqual(findUnauthorizedNumbers("这个我不确定，先帮你确认一下。", facts), []);
  assert.deepEqual(findUnauthorizedNumbers("支持三个平台同步。", facts), []);
});

test("退款与投诉类表达一律要求人工接管", async () => {
  const { cards } = await readSeed();
  const refundCards = cards.filter((entry) => entry.intent === "refund_request");
  for (const utterance of ["我要退款", "能退钱吗"]) {
    const result = evaluateHandoff({ utterance, confidence: 0.9, usableCardCount: 1, cards: refundCards });
    assert.equal(result.required, true, `「${utterance}」应要求人工接管`);
  }
});
