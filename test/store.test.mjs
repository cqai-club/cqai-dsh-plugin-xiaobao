/**
 * 知识库测试：状态机、版本递增、原子写入、审计与冲突检查。
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";

import { FILES, KnowledgeStore, resolveDataRoot, writeFileAtomic } from "../lib/host/store.js";
import { card, fact, makeStore } from "./helpers.mjs";

test("数据根目录遵循 配置 > DSH_HOME > ~/.dsh 的优先级", () => {
  const configured = resolveDataRoot("D:/custom/root", { DSH_HOME: "C:/env/home" });
  assert.ok(configured.endsWith("custom") || configured.endsWith("root"), `应使用显式配置，实际 ${configured}`);

  const fromEnv = resolveDataRoot(undefined, { DSH_HOME: "C:/env/home" });
  assert.ok(fromEnv.includes("xiaobao"), `应落在 xiaobao 子目录，实际 ${fromEnv}`);

  const fallback = resolveDataRoot(undefined, {});
  assert.ok(fallback.includes("xiaobao"), "无环境变量时应回落到 ~/.dsh/xiaobao");
});

test("原子写入不会残留临时文件", async () => {
  const { dir, cleanup } = await makeStore({ seed: false });
  try {
    const target = join(dir, FILES.cards);
    await writeFileAtomic(target, JSON.stringify([card()]));
    const written = JSON.parse(await readFile(target, "utf8"));
    assert.equal(written.length, 1);

    // 临时文件必须是同目录、写入后清理过的。
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    assert.ok(!entries.some((name) => name.endsWith(".tmp")), `不应残留临时文件：${entries.join(", ")}`);
  } finally {
    await cleanup();
  }
});

test("新建卡片版本为 1，覆盖同 id 时递增", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    const first = await store.putCard(card({ id: "v_test" }), "tester");
    assert.equal(first.version, 1);
    const second = await store.putCard(card({ id: "v_test" }), "tester");
    assert.equal(second.version, 2, "覆盖同 id 应递增版本");
    assert.equal(store.allCards().length, 1, "不应产生重复记录");
  } finally {
    await cleanup();
  }
});

test("PATCH 只改给出的字段并递增版本", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "patch_test", scenario: "原场景" }), "tester");
    const patched = await store.patchCard("patch_test", { scenario: "新场景" }, "editor");
    assert.equal(patched.scenario, "新场景");
    assert.equal(patched.intent, "test_intent", "未给出的字段应保持");
    assert.equal(patched.version, 2);
  } finally {
    await cleanup();
  }
});

test("PATCH 不存在的卡片时明确报错", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await assert.rejects(() => store.patchCard("不存在", {}), /不存在/u);
  } finally {
    await cleanup();
  }
});

test("审核状态迁移写入 reviewed_by 并落审计", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "review_test", status: "review" }), "author");
    const approved = await store.setCardStatus("review_test", "approved", "reviewer-1");
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewed_by, "reviewer-1");

    const entries = await store.recentAudit(50);
    assert.ok(entries.some((entry) => entry.action === "card.review"), "应有审核审计记录");
    assert.ok(entries.every((entry) => typeof entry.at === "string"), "每条审计都应有时间戳");
  } finally {
    await cleanup();
  }
});

test("回滚恢复历史内容但继续递增版本，保持审计链线性", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    const original = await store.putCard(card({ id: "rb_test", scenario: "第一版" }), "author");
    await store.patchCard("rb_test", { scenario: "第二版" }, "author");
    const rolled = await store.rollbackCard("rb_test", original, "reviewer");

    assert.equal(rolled.scenario, "第一版", "应恢复历史内容");
    assert.equal(rolled.version, 3, "回滚不应回退版本号");

    const entries = await store.recentAudit(50);
    const rollbackEntry = entries.find((entry) => entry.action === "card.rollback");
    assert.ok(rollbackEntry !== undefined, "应有回滚审计");
    assert.equal(rollbackEntry.detail.restored_from, 1);
  } finally {
    await cleanup();
  }
});

test("审计是追加式的，多次操作全部留痕", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "a1" }), "u1");
    await store.putCard(card({ id: "a2" }), "u2");
    await store.putFact(fact({ id: "f1" }), "u3");
    const entries = await store.recentAudit(50);
    assert.ok(entries.length >= 3, `应至少三条审计，实际 ${entries.length}`);
    // recentAudit 从最新往前返回。
    assert.equal(entries[0].actor, "u3");
  } finally {
    await cleanup();
  }
});

test("载入时跳过损坏记录而不是让整个库无法加载", async () => {
  const { store, dir, cleanup } = await makeStore({ seed: false });
  try {
    await writeFile(join(dir, FILES.cards), JSON.stringify([
      card({ id: "good_card" }),
      { id: "broken_card", status: "不存在的状态" },
      "完全不是对象",
    ]), "utf8");

    const reloaded = new KnowledgeStore({ root: dir });
    await reloaded.load();
    assert.equal(reloaded.allCards().length, 1, "只应载入合法的那一条");
    assert.equal(reloaded.card("good_card").id, "good_card");
  } finally {
    await cleanup();
  }
});

test("种子注入是幂等的，不会覆盖已有内容", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    const first = await store.seedIfEmpty({ cards: [card({ id: "seed_1" })], facts: [fact({ id: "seed_f1" })] });
    assert.equal(first.cards, 1);
    assert.equal(first.facts, 1);

    const second = await store.seedIfEmpty({ cards: [card({ id: "seed_2" })], facts: [] });
    assert.equal(second.cards, 0, "非空时不应再注入");
    assert.equal(store.card("seed_2"), undefined);
  } finally {
    await cleanup();
  }
});

test("健康检查能发现冲突、缺口与悬空引用", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putFact(fact({ id: "real_fact" }), "u");
    // 同一 intent 下两张卡片给出不同主话术 → 冲突。
    await store.putCard(card({ id: "c1", intent: "conflict_intent", approved_responses: ["说法 A"] }), "u");
    await store.putCard(card({ id: "c2", intent: "conflict_intent", approved_responses: ["说法 B"] }), "u");
    // 引用不存在的事实 → 悬空引用。
    await store.putCard(card({ id: "c3", intent: "dangling_intent", evidence_refs: ["不存在的依据"] }), "u");
    // 只有 draft，没有 approved → 知识缺口。
    await store.putCard(card({ id: "c4", intent: "gap_intent", status: "draft" }), "u");

    const health = store.inspectHealth();
    assert.ok(health.conflicts.some((entry) => entry.intent === "conflict_intent"), "应报告冲突");
    assert.ok(health.dangling_refs.some((entry) => entry.ref === "不存在的依据"), "应报告悬空引用");
    assert.ok(health.gaps.includes("gap_intent"), `应报告知识缺口，实际 ${health.gaps.join(", ")}`);
  } finally {
    await cleanup();
  }
});

test("过期内容在健康检查里被单独列出", async () => {
  const { store, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "expired_card", expires_at: "2020-01-01T00:00:00+08:00" }), "u");
    await store.putCard(card({ id: "future_card", effective_from: "2099-01-01T00:00:00+08:00" }), "u");
    const health = store.inspectHealth();
    assert.ok(health.expired.includes("expired_card"));
    assert.ok(health.not_yet_effective.includes("future_card"));
  } finally {
    await cleanup();
  }
});

test("落盘后可以重新载入并保持一致", async () => {
  const { store, dir, cleanup } = await makeStore({ seed: false });
  try {
    await store.putCard(card({ id: "persist_1", scenario: "持久化测试" }), "u");
    await store.putFact(fact({ id: "persist_f1" }), "u");

    const reloaded = new KnowledgeStore({ root: dir });
    await reloaded.load();
    assert.equal(reloaded.card("persist_1").scenario, "持久化测试");
    assert.equal(reloaded.fact("persist_f1").id, "persist_f1");
  } finally {
    await cleanup();
  }
});
