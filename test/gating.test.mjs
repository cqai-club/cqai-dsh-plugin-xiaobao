/**
 * 门禁测试：未审核、已停用、未生效、已过期的内容绝不能进入实时检索。
 *
 * 这是开发计划 §6.3 与 §17 验收第 11 条的代码级证明，也是整个插件最重要的
 * 一条安全不变量。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isCardUsable, isFactUsable } from "../lib/shared/protocol.js";
import { card, fact, FIXED_NOW, makeStore } from "./helpers.mjs";

test("只有 approved 状态的话术卡可用", () => {
  for (const status of ["draft", "review", "retired"]) {
    assert.equal(isCardUsable(card({ status }), FIXED_NOW), false, `status=${status} 不应可用`);
  }
  assert.equal(isCardUsable(card({ status: "approved" }), FIXED_NOW), true);
});

test("未生效与已过期的话术卡都不可用", () => {
  assert.equal(isCardUsable(card({ effective_from: "2026-12-01T00:00:00+08:00" }), FIXED_NOW), false, "未生效不应可用");
  assert.equal(isCardUsable(card({ expires_at: "2026-10-01T00:00:00+08:00" }), FIXED_NOW), false, "已过期不应可用");
  // 边界：终止时刻恰好等于判定时刻即视为过期（左闭右开）。
  assert.equal(isCardUsable(card({ expires_at: new Date(FIXED_NOW).toISOString() }), FIXED_NOW), false);
  assert.equal(isCardUsable(card({ expires_at: null }), FIXED_NOW), true, "null 表示永不过期");
});

test("畸形输入一律判为不可用，而不是抛出", () => {
  for (const value of [null, undefined, "字符串", 42, [], {}]) {
    assert.equal(isCardUsable(value, FIXED_NOW), false);
  }
});

test("产品事实与话术卡共用同一套生效期规则", () => {
  assert.equal(isFactUsable(fact({ status: "draft" }), FIXED_NOW), false);
  assert.equal(isFactUsable(fact({ status: "approved" }), FIXED_NOW), true);
  assert.equal(isFactUsable(fact({ expires_at: "2026-01-01T00:00:00+08:00" }), FIXED_NOW), false);
});

test("知识库的实时集合严格排除不可用内容", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "approved_card", status: "approved" }), "tester");
    await store.putCard(card({ id: "draft_card", status: "draft" }), "tester");
    await store.putCard(card({ id: "retired_card", status: "retired" }), "tester");
    await store.putCard(card({ id: "future_card", status: "approved", effective_from: "2099-01-01T00:00:00+08:00" }), "tester");
    await store.putCard(card({ id: "expired_card", status: "approved", expires_at: "2020-01-01T00:00:00+08:00" }), "tester");

    const usable = store.usableCards(FIXED_NOW).map((entry) => entry.id);
    assert.deepEqual(usable, ["approved_card"], `实时集合只应有 approved_card，实际为 ${usable.join(", ")}`);

    // 而管理界面必须能看到全部五张——门禁不能妨碍人工审核。
    assert.equal(store.allCards().length, 5);
  } finally {
    await cleanup();
  }
});

test("停用一张卡片后它立刻从实时集合消失", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "live_card", status: "approved" }), "tester");
    assert.equal(store.usableCards(FIXED_NOW).length, 1);

    await store.retireCard("live_card", "reviewer");
    assert.equal(store.usableCards(FIXED_NOW).length, 0, "停用后不应再被检索到");
    // 停用是状态迁移，不是删除：历史与审计必须保留。
    assert.equal(store.card("live_card").status, "retired");
    assert.equal(store.card("live_card").version, 2, "停用应推进版本号");
  } finally {
    await cleanup();
  }
});

test("种子数据里的卡片全部处于可检索状态", async () => {
  const { store, cleanup } = await makeStore();
  try {
    const all = store.allCards();
    assert.ok(all.length >= 30, `种子应至少 30 张卡片，实际 ${all.length}`);
    assert.equal(store.usableCards(FIXED_NOW).length, all.length, "种子卡片应当全部已审核且已生效");
    assert.ok(store.usableFacts(FIXED_NOW).length >= 10, "种子事实应至少 10 条");
  } finally {
    await cleanup();
  }
});
