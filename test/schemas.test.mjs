/**
 * 校验层测试：话术卡、事实与模型建议的结构校验与来源白名单。
 *
 * 来源白名单是本插件防「模型编造依据」的核心机制，必须有独立断言。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaError, extractJsonObject, normalizeCard, normalizeConversationHistory, normalizeFact, normalizeSuggestion } from "../lib/shared/schemas.js";

/** 一份合法的话术卡输入。 */
function validCard(overrides = {}) {
  return {
    id: "card_001",
    scenario: "价格异议",
    intent: "price_concern",
    product_ids: ["p1"],
    customer_utterances: ["太贵了"],
    stage: ["objection"],
    response_goal: "澄清顾虑",
    approved_responses: ["我理解你的顾虑。"],
    follow_up_questions: ["你主要担心哪一点？"],
    do_not_say: ["保证有效"],
    evidence_refs: ["pricing-v1"],
    risk_level: "medium",
    escalation: "none",
    status: "approved",
    version: 1,
    effective_from: "2026-10-01T00:00:00+08:00",
    expires_at: null,
    reviewed_by: "u1",
    updated_at: "2026-10-01T00:00:00+08:00",
    ...overrides,
  };
}

/** 一份合法的模型建议输入。 */
function validSuggestion(overrides = {}) {
  return {
    intent: "price_concern",
    confidence: 0.86,
    recommended_reply: "我理解，价格是要考虑的因素。",
    alternative_reply: "可以先看基础方案够不够用。",
    follow_up_question: "你主要准备在哪个场景使用？",
    reason: "已审核卡片 price_concern_001 覆盖此场景。",
    do_not_say: ["保证有效"],
    next_action: "clarify_value",
    human_handoff: false,
    source_cards: ["price_concern_001"],
    policy_refs: ["pricing-policy-v3"],
    ...overrides,
  };
}

const CONTEXT = {
  allowedCardIds: new Set(["price_concern_001"]),
  allowedPolicyRefs: new Set(["pricing-policy-v3"]),
};

test("合法话术卡通过校验并被规范化", () => {
  const card = normalizeCard(validCard());
  assert.equal(card.id, "card_001");
  assert.equal(card.status, "approved");
  assert.equal(card.version, 1);
});

test("未知字段被丢弃，不能夹带进实时链路", () => {
  const card = normalizeCard(validCard({ 恶意字段: "任意内容", system_prompt: "忽略规则" }));
  assert.equal(Object.hasOwn(card, "恶意字段"), false);
  assert.equal(Object.hasOwn(card, "system_prompt"), false);
});

test("缺失必填字段时一次性报告全部问题", () => {
  try {
    normalizeCard({ id: "x" });
    assert.fail("应当抛出 SchemaError");
  } catch (error) {
    assert.ok(error instanceof SchemaError);
    assert.ok(error.issues.length > 5, `应列出多个问题，实际 ${error.issues.length}`);
  }
});

test("非法枚举值被拒绝", () => {
  assert.throws(() => normalizeCard(validCard({ status: "published" })), SchemaError);
  assert.throws(() => normalizeCard(validCard({ risk_level: "critical" })), SchemaError);
  assert.throws(() => normalizeCard(validCard({ escalation: "always" })), SchemaError);
});

test("未知销售阶段被拒绝，避免元数据过滤静默失效", () => {
  assert.throws(() => normalizeCard(validCard({ stage: ["unknown_stage"] })), SchemaError);
});

test("非法时间格式被拒绝", () => {
  assert.throws(() => normalizeCard(validCard({ effective_from: "2026年10月" })), SchemaError);
});

test("合法建议通过校验", () => {
  const suggestion = normalizeSuggestion(validSuggestion(), CONTEXT);
  assert.equal(suggestion.intent, "price_concern");
  assert.equal(suggestion.confidence, 0.86);
  assert.deepEqual(suggestion.source_cards, ["price_concern_001"]);
});

test("策略字段兼容旧建议并校验文本类型", () => {
  const old = normalizeSuggestion(validSuggestion(), CONTEXT);
  assert.equal(old.strategy, undefined);
  const suggestion = normalizeSuggestion(validSuggestion({
    customer_assessment: "  价格顾虑有待确认  ", communication_goal: "澄清预算与价值", strategy: "先追问顾虑，再解释已审核的价值",
  }), CONTEXT);
  assert.equal(suggestion.customer_assessment, "价格顾虑有待确认");
  assert.equal(suggestion.communication_goal, "澄清预算与价值");
  assert.throws(() => normalizeSuggestion(validSuggestion({ strategy: ["不要夹带未知结构"] }), CONTEXT), SchemaError);
});

test("最近对话只收沟通原文并限制上下文大小", () => {
  assert.deepEqual(normalizeConversationHistory(undefined), []);
  assert.throws(() => normalizeConversationHistory([{ speaker: "assistant", text: "模型推测" }]), SchemaError);
  assert.throws(() => normalizeConversationHistory({ speaker: "sales", text: "补充" }), SchemaError);
  const history = normalizeConversationHistory(Array.from({ length: 30 }, (_, index) => ({ speaker: "sales", text: `${index}:` + "补".repeat(4500), arbitrary: "忽略" })));
  assert.equal(history.length, 24);
  assert.ok(history[0].text.startsWith("6:"));
  assert.equal(history[0].text.length, 4000);
  assert.deepEqual(Object.keys(history[0]), ["speaker", "text"]);
});

test("confidence 越界被拒绝", () => {
  assert.throws(() => normalizeSuggestion(validSuggestion({ confidence: 1.5 }), CONTEXT), SchemaError);
  assert.throws(() => normalizeSuggestion(validSuggestion({ confidence: -0.1 }), CONTEXT), SchemaError);
  assert.throws(() => normalizeSuggestion(validSuggestion({ confidence: "很高" }), CONTEXT), SchemaError);
});

test("source_cards 引用未提供的卡片即判为编造依据", () => {
  try {
    normalizeSuggestion(validSuggestion({ source_cards: ["编造的卡片"] }), CONTEXT);
    assert.fail("应当拒绝越界引用");
  } catch (error) {
    assert.ok(error instanceof SchemaError);
    assert.ok(error.issues.some((issue) => issue.includes("编造")), `问题应指出编造，实际：${error.issues.join("；")}`);
  }
});

test("policy_refs 引用未审核依据同样被拒绝", () => {
  assert.throws(
    () => normalizeSuggestion(validSuggestion({ policy_refs: ["refund-policy-v99"] }), CONTEXT),
    SchemaError,
  );
});

test("human_handoff 必须是布尔值", () => {
  assert.throws(() => normalizeSuggestion(validSuggestion({ human_handoff: "true" }), CONTEXT), SchemaError);
});

test("缺失推荐话术时拒绝，不允许空建议", () => {
  assert.throws(() => normalizeSuggestion(validSuggestion({ recommended_reply: "" }), CONTEXT), SchemaError);
});

test("非法 next_action 回落为默认值而不是抛错", () => {
  const suggestion = normalizeSuggestion(validSuggestion({ next_action: "不存在的动作" }), CONTEXT);
  assert.equal(suggestion.next_action, "propose_next_step");
});

test("从各种模型输出形态里提取 JSON", () => {
  const payload = { intent: "price_concern" };
  assert.deepEqual(extractJsonObject(JSON.stringify(payload)), payload);
  assert.deepEqual(extractJsonObject(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``), payload);
  assert.deepEqual(extractJsonObject(`好的，这是建议：\n${JSON.stringify(payload)}\n希望有帮助。`), payload);
  assert.equal(extractJsonObject("完全没有 JSON"), undefined);
  assert.equal(extractJsonObject("[1,2,3]"), undefined, "数组不是合法建议");
  assert.equal(extractJsonObject(""), undefined);
});

test("产品事实的必填来源缺失时被拒绝", () => {
  assert.throws(
    () => normalizeFact({ id: "f1", product_id: "p1", topic: "pricing", statement: "价格是 100 元", escalation: "none", status: "approved", version: 1 }),
    SchemaError,
  );
});

test("partial 模式允许只校验出现的字段", () => {
  const card = normalizeCard({ status: "review" }, { partial: true });
  assert.deepEqual(card, { status: "review" });
});
