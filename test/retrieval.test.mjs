/**
 * 检索层测试：意图打分、混合召回、RRF 融合、抑制与幂等。
 *
 * 重点是证明「能检索到什么」由代码决定且可复现，而不是模型的自由发挥。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IdempotencyLog,
  SuppressionWindow,
  cosineSimilarity,
  keywords,
  ngrams,
  scoreIntents,
  searchCards,
} from "../lib/host/retrieval.js";
import { card, readSeed } from "./helpers.mjs";

test("n-gram 切分对中文按字符、对 ASCII 按词", () => {
  const grams = ngrams("价格很贵 pro 版");
  assert.ok(grams.size > 0);
  // 「pro」作为整体参与，而不是被拆成 p/r/o。
  assert.ok([...grams.keys()].some((gram) => gram.includes("pro")), "应保留 ASCII 词");
});

test("余弦相似度对同义改写比对无关句更敏感", () => {
  const near = cosineSimilarity("你们这个价格有点贵", "这个价格是不是有点贵");
  const far = cosineSimilarity("你们这个价格有点贵", "支持哪些平台");
  assert.ok(near > far, `相近表达(${near}) 应高于无关表达(${far})`);
  assert.equal(cosineSimilarity("", "任意"), 0);
});

test("意图打分只使用已审核卡片里的客户表述", async () => {
  const { cards } = await readSeed();
  const ranked = scoreIntents("你们这个价格有点贵", cards);
  assert.ok(ranked.length > 0, "应至少给一个意图打分");
  assert.equal(ranked[0].intent, "price_concern", `首选意图应为 price_concern，实际 ${ranked[0].intent}`);
  assert.ok(ranked[0].score > 0.5, "高度相似的表达应给出较高分");
  // 分数必须落在合法区间，否则会污染下游的置信度门禁。
  for (const entry of ranked) assert.ok(entry.score >= 0 && entry.score <= 0.95);
});

test("混合检索把匹配度最高的卡片排在首位", async () => {
  const { cards } = await readSeed();
  const ranked = searchCards({ utterance: "太贵了，有没有便宜一点的" }, cards);
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].card.intent, "price_concern");
  assert.ok(ranked.length <= 3, "默认最多返回 3 条");
});

test("RRF 融合会记录来自哪些通道", async () => {
  const { cards } = await readSeed();
  const ranked = searchCards({ utterance: "你们会看我的笔记吗" }, cards);
  assert.ok(ranked.length > 0);
  const top = ranked[0];
  assert.ok(Object.keys(top.channels).length > 0, "应记录命中通道");
  assert.ok(top.score > 0);
  assert.equal(top.card.intent, "privacy_security", `应命中隐私意图，实际 ${top.card.intent}`);
});

test("产品不匹配的卡片在元数据层被直接淘汰", () => {
  const cards = [
    card({ id: "product_a_card", intent: "price_concern", product_ids: ["product-a"], customer_utterances: ["太贵了"] }),
    card({ id: "product_b_card", intent: "price_concern", product_ids: ["product-b"], customer_utterances: ["太贵了"] }),
  ];
  const ranked = searchCards({ utterance: "太贵了", productId: "product-a" }, cards);
  assert.ok(ranked.every((entry) => entry.card.id === "product_a_card"), "不应召回其它产品的卡片");
});

test("空语句与空候选集返回空结果，而不是抛出", () => {
  assert.deepEqual(searchCards({ utterance: "   " }, [card()]), []);
  assert.deepEqual(searchCards({ utterance: "太贵了" }, []), []);
});

test("拒绝语会命中 explicit_refusal", async () => {
  const { cards } = await readSeed();
  const ranked = searchCards({ utterance: "我不需要，别再联系我了" }, cards);
  const intents = ranked.map((entry) => entry.card.intent);
  assert.ok(intents.includes("explicit_refusal"), `应命中明确拒绝，实际 ${intents.join(", ")}`);
});

test("抑制窗口内的同一意图不会重复产出建议", () => {
  const window = new SuppressionWindow(20000);
  const key = "price_concern|product-a";
  assert.equal(window.recall(key, 1000), undefined, "首次不应命中抑制");
  window.remember(key, { marker: true }, 1000);
  assert.deepEqual(window.recall(key, 5000), { marker: true }, "窗口内应复用");
  assert.equal(window.recall(key, 30000), undefined, "超出窗口后应失效");
  assert.equal(window.size, 0, "过期项应被清理");
});

test("幂等表丢弃重复事件且按容量淘汰", () => {
  const log = new IdempotencyLog(60000, 3);
  assert.equal(log.admit("event-1", 1000), true);
  assert.equal(log.admit("event-1", 1100), false, "重复事件应被丢弃");
  assert.equal(log.admit("", 1200), true, "无 id 的事件不参与幂等");

  for (const id of ["a", "b", "c"]) log.admit(id, 2000);
  assert.ok(log.size <= 3, `容量上限应生效，实际 ${log.size}`);
});

test("关键词提取会过滤停用词", () => {
  const terms = keywords("你们的这个价格是不是很贵啊");
  assert.ok(!terms.includes("的"), "停用词不应出现");
  assert.ok(terms.length > 0);
});
