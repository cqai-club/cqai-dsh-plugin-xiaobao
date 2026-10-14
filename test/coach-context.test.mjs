import assert from "node:assert/strict";
import { test } from "node:test";
import { Coach, applyDisplayGuards, parseSuggestion, templateSuggestion } from "../lib/host/coach.js";
import { SuppressionWindow } from "../lib/host/retrieval.js";
import { card, fact, FIXED_NOW } from "./helpers.mjs";

function fixture() {
  const source = card({ intent: "price_concern", scenario: "价格异议", response_goal: "区分预算限制与价值疑问", customer_utterances: ["你们价格太贵了", "预算有限"] });
  const policy = fact();
  const calls = [];
  const suggestion = { intent: "price_concern", confidence: 0.9, recommended_reply: "我理解你的顾虑，我们先确认你关注的使用场景。", next_action: "clarify_value", human_handoff: false, source_cards: [source.id], policy_refs: [policy.id] };
  const coach = new Coach({
    store: { usableCards: () => [source], usableFacts: () => [policy] },
    suppression: new SuppressionWindow(), route: () => ({ provider: "fixture", model: "fixture-model" }),
    llm: { async *stream(options) { calls.push(options); yield { type: "text-delta", text: JSON.stringify(suggestion) }; } },
  });
  const request = { utterance: "你们价格太贵了", speaker: "customer", history: [], intentCandidates: [{ intent: "price_concern", score: 0.9 }], cards: [source], facts: [policy], forbidden: ["保证有效"], handoff: { required: false, reasons: [] } };
  return { coach, calls, request, source, suggestion };
}

test("相同意图的新追问与销售补充都会重新判断，缓存不串会话", async () => {
  const { coach, calls } = fixture();
  try {
    const input = { utterance: "你们价格太贵了", speaker: "customer", sessionId: "one", history: [] };
    const options = { nowMs: FIXED_NOW, intentCandidates: [{ intent: "price_concern", score: 0.9 }] };
    await coach.suggest(input, options);
    assert.equal((await coach.suggest(input, options)).suppressed, true, "完全相同的监听输入可复用");
    await coach.suggest({ ...input, utterance: "这个价格太贵了，预算有限" }, options);
    await coach.suggest({ ...input, history: [{ speaker: "sales", text: "我已经解释过使用场景，客户仍在犹豫" }] }, options);
    await coach.suggest({ ...input, sessionId: "two" }, options);
    assert.equal(calls.length, 4);
    assert.match(calls[2].messages[0].content[0].text, /销售补充：我已经解释过使用场景/);
  } finally { coach.dispose(); }
});

test("销售追问沿用最近客户表达并在模型上下文中保留角色", async () => {
  const { coach, calls } = fixture();
  try {
    const bundle = await coach.suggest({ utterance: "那我接下来怎么说？", speaker: "sales", sessionId: "sales-question", history: [{ speaker: "customer", text: "你们价格太贵了" }] }, { nowMs: FIXED_NOW });
    assert.equal(bundle.degraded, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0].messages[0].content[0].text, /<销售补充>那我接下来怎么说？<\/销售补充>/);
    assert.match(calls[0].messages[0].content[0].text, /客户原话：你们价格太贵了/);
  } finally { coach.dispose(); }
});

test("模板与旧模型建议都能提供有依据的策略摘要", () => {
  const { request, source, suggestion, coach } = fixture();
  try {
    for (const output of [templateSuggestion(request), parseSuggestion(JSON.stringify(suggestion), request).suggestion,
      parseSuggestion(JSON.stringify({ ...suggestion, strategy: "  " }), request).suggestion]) {
      assert.match(output.customer_assessment, /初步判断/);
      assert.equal(output.communication_goal, source.response_goal);
      assert.ok(output.strategy.includes(source.response_goal));
    }
    const noGrounding = templateSuggestion({ ...request, cards: [], handoff: { required: true, reasons: ["no_grounding"] } });
    assert.match(noGrounding.customer_assessment, /不足/);
    assert.match(noGrounding.strategy, /人工确认/);
  } finally { coach.dispose(); }
});

test("客户判断、沟通目标与策略同样拦截未经授权数字和承诺", () => {
  const { request, suggestion, coach } = fixture();
  try {
    for (const field of ["customer_assessment", "communication_goal", "strategy"]) {
      for (const invalid of ["承诺保证有效。", "告诉客户只要 50 元，还能打 5 折。"] ) {
        const result = applyDisplayGuards({ ...suggestion, [field]: invalid }, request);
        assert.ok(result.blocked.length > 0, `${field} 不能绕过展示前门禁`);
        assert.equal(result.suggestion.degraded, true);
        assert.equal(result.suggestion.human_handoff, true);
        assert.notEqual(result.suggestion[field], invalid);
      }
    }
  } finally { coach.dispose(); }
});
