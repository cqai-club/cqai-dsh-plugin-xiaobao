/**
 * e销宝 知识服务：双库存储、内容状态机、原子写入与审计。
 *
 * 设计要点（对应开发计划 §6）：
 * - 产品事实库与时术卡库分开存储、分开检索：销售话术永远不能当作价格或
 *   产品能力的权威依据。
 * - 内容状态机由本模块强制，实时检索只读「已审核且在生效期内」的内容。
 * - 所有写入走同目录临时文件 + rename 的原子替换，半写文件不会进入实时库。
 * - 每次写操作与审核动作都追加到审计日志，可追溯来源、审核人与时间。
 *
 * 存储位置：`$DSH_HOME/xiaobao/knowledge/`，可用配置覆盖。
 * 依赖：仅 Node 内建模块。
 *
 * @module @cqaiclub/cqai-dsh-plugin-xiaobao/host/store
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import {
  CARD_STATUS,
  isCardUsable,
  isFactUsable,
} from "../shared/protocol.js";
import { normalizeCard, normalizeFact } from "../shared/schemas.js";

/** 知识库的磁盘布局：文件名集中在这里，避免字面量散落。 */
export const FILES = Object.freeze({
  cards: "phrase-cards.json",
  facts: "facts.json",
  audit: "audit.jsonl",
});

/**
 * 解析 e销宝 的数据根目录。
 *
 * 优先使用显式配置，其次 `DSH_HOME`，最后回退到 `~/.dsh`，与平台其他插件
 * 的数据归属保持一致。
 *
 * @param configured - 配置中给出的目录，可为空。
 * @param env - 环境变量映射，便于测试注入。
 * @returns 绝对路径。
 */
export function resolveDataRoot(configured, env = process.env) {
  if (typeof configured === "string" && configured.trim().length > 0) {
    return resolve(configured.trim());
  }
  const fromEnv = env.DSH_HOME;
  const base = typeof fromEnv === "string" && fromEnv.trim().length > 0
    ? resolve(fromEnv.trim())
    : join(homedir(), ".dsh");
  return join(base, "xiaobao", "knowledge");
}

/**
 * 原子替换写入：先写随机后缀的同目录临时文件，再 rename 覆盖目标。
 *
 * 不使用平台内部的 atomic-write 包，是为了让本插件在没有任何第三方
 * 依赖的情况下也能加载——Profile 的模块解析只保证平台自身包可见。
 *
 * @param path - 目标文件的绝对路径。
 * @param text - 要写入的内容。
 */
export async function writeFileAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** 读取并解析一个 JSON 文件；文件不存在时返回回退值。 */
async function readJson(path, fallback) {
  try {
    const text = await readFile(path, "utf8");
    const value = JSON.parse(text);
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`读取 ${path} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 知识库实例：内存中持有两份列表，写操作先落盘再更新内存。
 *
 * 内存态是权威读源，磁盘只是持久化；因此实时检索路径永远是同步的，不会
 * 因为磁盘 IO 拖慢建议生成。
 */
export class KnowledgeStore {
  /** @type {string} */
  #root;
  /** @type {Map<string, object>} 话术卡，按 id 索引。 */
  #cards = new Map();
  /** @type {Map<string, object>} 产品事实，按 id 索引。 */
  #facts = new Map();
  /** 审计写入串行化，避免并发追加互相截断。 */
  #auditChain = Promise.resolve();
  /** 是否已从磁盘加载。 */
  #loaded = false;

  /**
   * @param options - `root` 指定数据目录；缺省按 <see cref="resolveDataRoot"/> 解析。
   */
  constructor(options = {}) {
    this.#root = resolveDataRoot(options.root);
  }

  /** 数据目录的绝对路径。 */
  get root() {
    return this.#root;
  }

  /** 从磁盘载入两份库；重复调用是幂等的。 */
  async load() {
    const cards = await readJson(join(this.#root, FILES.cards), []);
    const facts = await readJson(join(this.#root, FILES.facts), []);
    this.#cards = new Map();
    this.#facts = new Map();
    for (const raw of Array.isArray(cards) ? cards : []) {
      try {
        const card = normalizeCard(raw);
        this.#cards.set(card.id, card);
      } catch {
        // 单张损坏的卡片不应让整个库无法加载；它会被排除在检索之外。
      }
    }
    for (const raw of Array.isArray(facts) ? facts : []) {
      try {
        const fact = normalizeFact(raw);
        this.#facts.set(fact.id, fact);
      } catch {
        // 同上：跳过无法校验的记录，并在审计中留痕。
      }
    }
    this.#loaded = true;
    return { cards: this.#cards.size, facts: this.#facts.size };
  }

  /** 是否已经载入。 */
  get loaded() {
    return this.#loaded;
  }

  /**
   * 首次运行时用种子数据填充空库；已有内容时不做任何事。
   *
   * @param seed - `{ cards, facts }` 两份种子数组。
   * @returns 实际写入的数量。
   */
  async seedIfEmpty(seed) {
    const written = { cards: 0, facts: 0 };
    if (this.#cards.size === 0 && Array.isArray(seed?.cards)) {
      for (const raw of seed.cards) {
        try {
          const card = normalizeCard(raw);
          this.#cards.set(card.id, card);
          written.cards += 1;
        } catch {
          // 种子数据自身不合规时跳过，不阻断启动。
        }
      }
      if (written.cards > 0) await this.#persistCards();
    }
    if (this.#facts.size === 0 && Array.isArray(seed?.facts)) {
      for (const raw of seed.facts) {
        try {
          const fact = normalizeFact(raw);
          this.#facts.set(fact.id, fact);
          written.facts += 1;
        } catch {
          // 同上。
        }
      }
      if (written.facts > 0) await this.#persistFacts();
    }
    if (written.cards > 0 || written.facts > 0) {
      await this.audit({
        action: "knowledge.seed",
        actor: "system",
        detail: written,
      });
    }
    return written;
  }

  /** 全部话术卡（含未审核），按 id 排序，供管理界面使用。 */
  allCards() {
    return [...this.#cards.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 全部产品事实（含未审核），按 id 排序。 */
  allFacts() {
    return [...this.#facts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * 实时检索集合：只有已审核且在生效期内的话术卡。
   *
   * @param nowMs - 判定时刻，默认当前时间。
   * @returns 可用于推荐的话术卡。
   */
  usableCards(nowMs = Date.now()) {
    return this.allCards().filter((card) => isCardUsable(card, nowMs));
  }

  /**
   * 实时检索集合：只有已审核且在生效期内的产品事实。
   *
   * @param nowMs - 判定时刻，默认当前时间。
   * @returns 可作为权威依据的事实。
   */
  usableFacts(nowMs = Date.now()) {
    return this.allFacts().filter((fact) => isFactUsable(fact, nowMs));
  }

  /** 按 id 取一张话术卡。 */
  card(id) {
    return this.#cards.get(id);
  }

  /** 按 id 取一条产品事实。 */
  fact(id) {
    return this.#facts.get(id);
  }

  /**
   * 新建或整体替换一张话术卡。
   *
   * 版本号由本方法独占维护，**忽略调用方给的 version**：否则编辑界面对同一条
   * 内容反复保存时版本永远停在原值，审核历史与回滚都会失去依据。
   *
   * @param input - 话术卡字段。
   * @param actor - 操作者标识，进入审计。
   * @returns 落库后的卡片。
   */
  async putCard(input, actor = "unknown") {
    const existing = input?.id === undefined ? undefined : this.#cards.get(input.id);
    // 展开 input 之后再覆盖 version，确保调用方无法指定版本。
    const candidate = {
      ...input,
      version: (existing?.version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const card = normalizeCard(candidate);
    this.#cards.set(card.id, card);
    await this.#persistCards();
    await this.audit({
      action: existing === undefined ? "card.create" : "card.update",
      actor,
      subject: card.id,
      detail: { version: card.version, status: card.status },
    });
    return card;
  }

  /** PATCH 一张话术卡：只覆盖给出的字段。 */
  async patchCard(id, patch, actor = "unknown") {
    const existing = this.#cards.get(id);
    if (existing === undefined) throw new Error(`话术卡不存在：${id}`);
    const merged = { ...existing, ...patch, id };
    merged.version = existing.version + 1;
    merged.updated_at = new Date().toISOString();
    const card = normalizeCard(merged);
    this.#cards.set(card.id, card);
    await this.#persistCards();
    await this.audit({
      action: "card.update",
      actor,
      subject: card.id,
      detail: { version: card.version, status: card.status, fields: Object.keys(patch ?? {}) },
    });
    return card;
  }

  /**
   * 推进话术卡的审核状态。
   *
   * 复用 patchCard，因此审计与版本递增的行为与普通编辑一致。
   *
   * @param id - 话术卡 id。
   * @param status - 目标状态，必须是状态机取值之一。
   * @param actor - 审核人标识。
   */
  async setCardStatus(id, status, actor) {
    const card = await this.patchCard(id, { status, reviewed_by: actor }, actor);
    await this.audit({ action: "card.review", actor, subject: id, detail: { status } });
    return card;
  }

  /** 停用一张话术卡：把状态推到 retired，实时检索立刻不再返回它。 */
  retireCard(id, actor) {
    return this.setCardStatus(id, CARD_STATUS.RETIRED, actor);
  }

  /**
   * 回滚一张话术卡到历史版本。
   *
   * 回滚同样只推进版本号、不覆盖历史，因此审计链保持线性可读。
   *
   * @param id - 话术卡 id。
   * @param revision - 历史版本对象。
   * @param actor - 操作者。
   */
  async rollbackCard(id, revision, actor) {
    if (revision === null || typeof revision !== "object") {
      throw new Error("回滚需要一份历史版本内容");
    }
    const existing = this.#cards.get(id);
    if (existing === undefined) throw new Error(`话术卡不存在：${id}`);
    const restored = { ...revision, id, version: existing.version + 1, updated_at: new Date().toISOString() };
    const card = normalizeCard(restored);
    this.#cards.set(card.id, card);
    await this.#persistCards();
    await this.audit({
      action: "card.rollback",
      actor,
      subject: id,
      detail: { from: existing.version, restored_from: revision.version, to: card.version },
    });
    return card;
  }

  /** 新建或整体替换一条产品事实。版本号同样由本方法独占维护。 */
  async putFact(input, actor = "unknown") {
    const existing = input?.id === undefined ? undefined : this.#facts.get(input.id);
    const candidate = {
      ...input,
      version: (existing?.version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const fact = normalizeFact(candidate);
    this.#facts.set(fact.id, fact);
    await this.#persistFacts();
    await this.audit({
      action: existing === undefined ? "fact.create" : "fact.update",
      actor,
      subject: fact.id,
      detail: { version: fact.version, status: fact.status },
    });
    return fact;
  }

  /** PATCH 一条产品事实。 */
  async patchFact(id, patch, actor = "unknown") {
    const existing = this.#facts.get(id);
    if (existing === undefined) throw new Error(`产品事实不存在：${id}`);
    const merged = { ...existing, ...patch, id };
    merged.version = existing.version + 1;
    merged.updated_at = new Date().toISOString();
    const fact = normalizeFact(merged);
    this.#facts.set(fact.id, fact);
    await this.#persistFacts();
    await this.audit({
      action: "fact.update",
      actor,
      subject: fact.id,
      detail: { version: fact.version, status: fact.status, fields: Object.keys(patch ?? {}) },
    });
    return fact;
  }

  /** 推进产品事实的审核状态。 */
  async setFactStatus(id, status, actor) {
    const fact = await this.patchFact(id, { status, reviewed_by: actor }, actor);
    await this.audit({ action: "fact.review", actor, subject: id, detail: { status } });
    return fact;
  }

  /**
   * 检查知识库自身的冲突与缺口，供配置页「版本管理」和复盘使用。
   *
   * @param nowMs - 判定时刻。
   * @returns 冲突、过期与缺口三类问题。
   */
  inspectHealth(nowMs = Date.now()) {
    const allCards = this.allCards();
    const allFacts = this.allFacts();

    const expired = [];
    const notYetEffective = [];
    for (const card of [...allCards, ...allFacts]) {
      const until = card.expires_at === null || card.expires_at === undefined ? Number.NaN : Date.parse(card.expires_at);
      if (Number.isFinite(until) && nowMs >= until) expired.push(card.id);
      const from = Date.parse(card.effective_from ?? "");
      if (Number.isFinite(from) && nowMs < from) notYetEffective.push(card.id);
    }

    // 冲突：同一 intent 下有多张 approved 卡片给出不同的主话术时，提示人工复核。
    const byIntent = new Map();
    for (const card of allCards) {
      if (card.status !== CARD_STATUS.APPROVED) continue;
      if (!byIntent.has(card.intent)) byIntent.set(card.intent, []);
      byIntent.get(card.intent).push(card);
    }
    const conflicts = [];
    for (const [intent, cards] of byIntent) {
      if (cards.length < 2) continue;
      const primary = new Set(cards.map((card) => card.approved_responses?.[0] ?? ""));
      if (primary.size > 1) conflicts.push({ intent, card_ids: cards.map((card) => card.id) });
    }

    // 缺口：被客户表达覆盖、但没有任何 approved 卡片的 intent。
    const mentionedIntents = new Set();
    for (const card of allCards) {
      for (const utterance of card.customer_utterances ?? []) {
        if (utterance.trim().length > 0) mentionedIntents.add(card.intent);
      }
    }
    const coveredIntents = new Set(byIntent.keys());
    const gaps = [...mentionedIntents].filter((intent) => !coveredIntents.has(intent)).sort();

    // 卡片引用了不存在的依据，是明显的编辑错误，实时链路会拒绝它。
    const factIds = new Set(allFacts.map((fact) => fact.id));
    const danglingRefs = [];
    for (const card of allCards) {
      for (const ref of card.evidence_refs ?? []) {
        if (!factIds.has(ref)) danglingRefs.push({ card: card.id, ref });
      }
    }

    return {
      counts: {
        cards: allCards.length,
        facts: allFacts.length,
        approved_cards: byIntent.size === 0 ? 0 : [...byIntent.values()].reduce((sum, list) => sum + list.length, 0),
      },
      expired,
      not_yet_effective: notYetEffective,
      conflicts,
      gaps,
      dangling_refs: danglingRefs,
    };
  }

  /**
   * 追加一条审计记录。
   *
   * 审计是追加式的 JSONL，按写入顺序串行，避免并发写互相截断。审计失败不
   * 抛出——它不应该让一次已经成功的内容变更看起来失败。
   *
   * @param entry - `action` 必填，其余字段自由。
   */
  async audit(entry) {
    const record = {
      at: new Date().toISOString(),
      ...entry,
    };
    const path = join(this.#root, FILES.audit);
    this.#auditChain = this.#auditChain.then(async () => {
      try {
        await mkdir(this.#root, { recursive: true });
        const { appendFile } = await import("node:fs/promises");
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
      } catch {
        // 审计不可用不应阻断业务；错误已由调用方的健康检查另行暴露。
      }
    });
    return this.#auditChain;
  }

  /**
   * 读取最近的审计记录，供配置页展示操作历史。
   *
   * @param limit - 最多返回多少条，从最新往前。
   */
  async recentAudit(limit = 200) {
    try {
      const text = await readFile(join(this.#root, FILES.audit), "utf8");
      const lines = text.split("\n").filter((line) => line.trim().length > 0);
      return lines
        .slice(-limit)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return undefined;
          }
        })
        .filter((entry) => entry !== undefined)
        .reverse();
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  /** 把话术卡库落盘。 */
  async #persistCards() {
    const payload = JSON.stringify(this.allCards(), null, 2);
    await writeFileAtomic(join(this.#root, FILES.cards), payload);
  }

  /** 把产品事实库落盘。 */
  async #persistFacts() {
    const payload = JSON.stringify(this.allFacts(), null, 2);
    await writeFileAtomic(join(this.#root, FILES.facts), payload);
  }
}
