/**
 * e销宝 测试夹具：在临时目录里建一个内容完整的知识库。
 *
 * 所有涉及磁盘的测试都必须用临时目录，绝不能碰用户真实的
 * `$DSH_HOME/xiaobao/knowledge/`。
 *
 * @module test/helpers
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 已生成的种子目录。 */
export const SEED_DIR = join(ROOT, "data", "seed");

/** 读取种子数据。 */
export async function readSeed() {
  const cards = JSON.parse(await readFile(join(SEED_DIR, "phrase-cards.json"), "utf8"));
  const facts = JSON.parse(await readFile(join(SEED_DIR, "facts.json"), "utf8"));
  return { cards, facts };
}

/**
 * 建一个隔离的知识库实例。
 *
 * @param options - `{ seed }`：是否注入种子数据。
 * @returns `{ store, dir, cleanup }`。
 */
export async function makeStore(options = {}) {
  const { KnowledgeStore } = await import("../lib/host/store.js");
  const dir = await mkdtemp(join(tmpdir(), "xiaobao-test-"));
  const store = new KnowledgeStore({ root: dir });
  await store.load();
  if (options.seed !== false) {
    const seed = options.seed === undefined ? await readSeed() : options.seed;
    await store.seedIfEmpty(seed);
  }
  return {
    store,
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** 构造一个固定时刻，让生效期判定可重复。 */
export const FIXED_NOW = Date.parse("2026-10-15T10:00:00+08:00");

/**
 * 造一张最小可用的话术卡，供门禁与检索测试定制字段。
 *
 * @param overrides - 要覆盖的字段。
 */
export function card(overrides = {}) {
  return {
    id: "test_card_001",
    scenario: "测试场景",
    intent: "test_intent",
    product_ids: ["test-product"],
    customer_utterances: ["这句话是用来测试的"],
    stage: ["objection"],
    response_goal: "测试目标",
    approved_responses: ["这是已审核的测试说法。"],
    follow_up_questions: ["你还有什么顾虑？"],
    do_not_say: ["保证有效"],
    evidence_refs: ["test-fact-v1"],
    risk_level: "low",
    escalation: "none",
    status: "approved",
    version: 1,
    effective_from: "2026-10-01T00:00:00+08:00",
    expires_at: null,
    reviewed_by: "tester",
    updated_at: "2026-10-01T00:00:00+08:00",
    ...overrides,
  };
}

/** 造一条最小可用的产品事实。 */
export function fact(overrides = {}) {
  return {
    id: "test-fact-v1",
    product_id: "test-product",
    topic: "pricing",
    statement: "测试产品定价为 100 元每年。",
    details: ["没有其他折扣。"],
    source: "test-policy",
    reviewed_by: "tester",
    escalation: "none",
    status: "approved",
    version: 1,
    effective_from: "2026-10-01T00:00:00+08:00",
    expires_at: null,
    updated_at: "2026-10-01T00:00:00+08:00",
    ...overrides,
  };
}
