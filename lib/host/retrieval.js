/**
 * e销宝 检索层：意图打分、三路召回、RRF 融合与重复抑制。
 *
 * 全部是确定性代码，不调用模型。原因见开发计划 §7.4：模型只负责在**已经
 * 检索好、已经过门禁**的证据范围内组织表达；「能找到什么」必须由代码决定，
 * 否则无法评测、无法解释、也无法保证不引用未审核内容。
 *
 * 三路召回：
 * 1. 关键词/词频打分——精确匹配客户表述里的实词。
 * 2. 字符 n-gram 余弦相似度——补偿中文分词缺失，对同义改写更宽容。
 * 3. 元数据过滤——产品、销售阶段、意图三条硬约束。
 *
 * @module @cqaiclub/cqai-dsh-plugin-xiaobao/host/retrieval
 */

import { RECALL_LIMIT } from "../shared/protocol.js";

/** 中文常用停用词：它们几乎不携带意图信息，参与打分只会引入噪声。 */
const STOPWORDS = new Set([
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "有", "和", "与",
  "就", "都", "也", "还", "很", "太", "吗", "呢", "吧", "啊", "呀", "个", "把", "被", "给",
  "对", "从", "到", "会", "能", "要", "想", "说", "一个", "什么", "怎么", "可以", "但是",
  "而且", "因为", "所以", "如果", "一下", "这个", "那个", "我们", "你们", "他们", "自己",
]);

/**
 * 把文本切成用于相似度计算的字符 n-gram 多重集合。
 *
 * 中文没有空格，按字符切分比按词切分可靠；同时把连续 ASCII 串按词保留，
 * 让「DeepSeek」「pro」这类词仍然作为整体参与匹配。
 *
 * @param text - 原始文本。
 * @param size - n-gram 的字符数，默认 2。
 * @returns 词项到出现次数的映射。
 */
export function ngrams(text, size = 2) {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, " ")
    .trim();
  const grams = new Map();
  if (normalized.length === 0) return grams;

  // 先按「ASCII 词 / 单个中文字」切成 token，再在 token 序列上取 n-gram。
  const tokens = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]/gu) ?? [];
  const n = Math.max(1, size);
  for (let i = 0; i + n <= tokens.length; i += 1) {
    const gram = tokens.slice(i, i + n).join("");
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  // token 数不足 n 时，退化为单 token，保证短句仍可比。
  if (grams.size === 0) {
    for (const token of tokens) grams.set(token, (grams.get(token) ?? 0) + 1);
  }
  return grams;
}

/**
 * 计算两个 n-gram 多重集合的余弦相似度。
 *
 * @param a - 第一个文本或已算好的 gram 映射。
 * @param b - 第二个文本或已算好的 gram 映射。
 * @returns 0 到 1 之间的相似度。
 */
export function cosineSimilarity(a, b) {
  const left = typeof a === "string" ? ngrams(a) : a;
  const right = typeof b === "string" ? ngrams(b) : b;
  if (left.size === 0 || right.size === 0) return 0;

  let dot = 0;
  // 遍历较小的一侧，减少查表次数。
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [gram, count] of small) {
    const other = large.get(gram);
    if (other !== undefined) dot += count * other;
  }
  if (dot === 0) return 0;

  let normLeft = 0;
  for (const count of left.values()) normLeft += count * count;
  let normRight = 0;
  for (const count of right.values()) normRight += count * count;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

/**
 * 从文本里取出携带信息的词项，用于关键词打分。
 *
 * 中文按字符 bigram 取词，ASCII 按词取词，并过滤停用词。
 *
 * @param text - 原始文本。
 * @returns 去重后的词项数组。
 */
export function keywords(text) {
  const normalized = String(text ?? "").toLowerCase();
  const out = new Set();
  for (const token of normalized.match(/[a-z0-9]{2,}/gu) ?? []) out.add(token);
  for (const gram of ngrams(text, 2).keys()) {
    if (gram.length >= 2 && !STOPWORDS.has(gram)) out.add(gram);
  }
  return [...out];
}

/**
 * 对一条客户语句给每个已知意图打分。
 *
 * 打分来源只有两处，全部来自已审核内容：话术卡的 `customer_utterances`
 * 相似度，以及卡片自身的 `intent` 声明。没有模型参与。
 *
 * @param utterance - 客户原话。
 * @param cards - 候选话术卡（调用方应传入已过门禁的集合）。
 * @returns 按分数降序的 `{ intent, score, matched }` 列表。
 */
export function scoreIntents(utterance, cards) {
  const byIntent = new Map();

  for (const card of cards) {
    if (!byIntent.has(card.intent)) {
      byIntent.set(card.intent, { intent: card.intent, best: 0, matched: [] });
    }
    const bucket = byIntent.get(card.intent);
    for (const example of card.customer_utterances ?? []) {
      const similarity = cosineSimilarity(utterance, example);
      if (similarity > bucket.best) bucket.best = similarity;
      if (similarity >= 0.2) bucket.matched.push(example);
    }
  }

  return [...byIntent.values()]
    .map((bucket) => ({
      intent: bucket.intent,
      // 相似度上限压到 0.95，避免完全一致时给出虚假的确定性。
      score: Math.min(0.95, bucket.best),
      matched: bucket.matched.slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));
}

/**
 * 关键词重叠度打分：命中卡片客户表述中的实词比例。
 *
 * @param utterance - 客户原话。
 * @param card - 候选话术卡。
 * @returns 0 到 1 之间的分数。
 */
function keywordScore(utterance, card) {
  const queryTerms = keywords(utterance);
  if (queryTerms.length === 0) return 0;
  const haystack = keywords([
    ...(card.customer_utterances ?? []),
    card.scenario ?? "",
    card.response_goal ?? "",
  ].join(" "));
  if (haystack.length === 0) return 0;
  const pool = new Set(haystack);
  let hits = 0;
  for (const term of queryTerms) if (pool.has(term)) hits += 1;
  return hits / queryTerms.length;
}

/**
 * 字符 n-gram 相似度打分：客户原话与卡片全部示例表述的最高相似度。
 *
 * @param utterance - 客户原话。
 * @param card - 候选话术卡。
 * @returns 0 到 1 之间的分数。
 */
function semanticScore(utterance, card) {
  let best = 0;
  for (const example of card.customer_utterances ?? []) {
    const similarity = cosineSimilarity(utterance, example);
    if (similarity > best) best = similarity;
  }
  return best;
}

/**
 * 元数据匹配度：产品、阶段、意图三条硬约束的满足情况。
 *
 * @param query - 检索请求。
 * @param card - 候选话术卡。
 * @returns 分数；产品不匹配时返回 0，调用方据此淘汰该卡。没有任何元数据
 *   约束时返回 undefined，表示该通道**弃权**而不是给所有人同一个分数——
 *   给所有人同分会把这条通道退化成按 id 排序，反而污染融合结果。
 */
function metadataScore(query, card) {
  // 产品是硬约束：客户问 A 产品，不能拿 B 产品的话术去答。
  if (query.productId !== undefined && Array.isArray(card.product_ids) && card.product_ids.length > 0) {
    if (!card.product_ids.includes(query.productId)) return 0;
  }

  let score = 0;
  let weight = 0;

  if (query.stage !== undefined) {
    weight += 1;
    const stages = card.stage ?? [];
    if (stages.length === 0 || stages.includes(query.stage)) score += 1;
  }
  if (query.intent !== undefined) {
    weight += 2; // 意图是最强的元数据信号，权重更高。
    if (card.intent === query.intent) score += 2;
  }

  // 没有给出任何元数据约束：本通道无法区分候选，弃权。
  if (weight === 0) return undefined;
  return score / weight;
}

/**
 * 混合检索：三路召回后融合。
 *
 * 融合分两部分，缺一不可：
 * 1. **量级**：每一路取该路最高分做归一化，得到可比的 0–1 分数。纯 RRF 只看
 *    排名，会让「关键词命中 1.0」和「勉强命中 0.1」拿到同样的排名奖励，实测
 *    中曾把完美匹配的卡片排到第二位。
 * 2. **排名**：叠加 RRF 项作为稳定性的次要信号，让多路同时命中的候选领先。
 *
 * @param query - `{ utterance, productId?, stage?, intent?, limit? }`。
 * @param cards - 已过门禁的候选话术卡。
 * @returns 按融合分数降序的 `{ card, score, channels }` 列表。
 */
export function searchCards(query, cards) {
  const utterance = String(query?.utterance ?? "");
  const limit = Number.isInteger(query?.limit) && query.limit > 0 ? query.limit : RECALL_LIMIT;
  if (utterance.trim().length === 0 || cards.length === 0) return [];

  const ranked = { keyword: [], semantic: [], metadata: [] };

  for (const card of cards) {
    const meta = metadataScore(query, card);
    if (meta === 0) continue; // 产品不匹配，直接淘汰。
    ranked.keyword.push({ card, score: keywordScore(utterance, card) });
    ranked.semantic.push({ card, score: semanticScore(utterance, card) });
    // 元数据通道弃权（undefined）时不参与，避免无差别打分。
    if (meta !== undefined) ranked.metadata.push({ card, score: meta });
  }

  for (const list of Object.values(ranked)) {
    list.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  }

  const K = 60;
  const fused = new Map();
  const CHANNEL_WEIGHT = { keyword: 0.35, semantic: 0.5, metadata: 0.15 };

  for (const [channel, list] of Object.entries(ranked)) {
    if (list.length === 0) continue;
    const top = list[0].score;
    const weight = CHANNEL_WEIGHT[channel] ?? 0.33;
    list.forEach((entry, index) => {
      if (entry.score <= 0) return;
      if (!fused.has(entry.card.id)) {
        fused.set(entry.card.id, { card: entry.card, score: 0, channels: {} });
      }
      const record = fused.get(entry.card.id);
      // 归一化后的量级分：该通道内的相对强度。
      const normalized = top > 0 ? entry.score / top : 0;
      // RRF 项：多路共同命中时叠加，让证据更充分的卡片胜出。
      const rrf = 1 / (K + index + 1);
      record.score += weight * normalized + 0.1 * rrf;
      record.channels[channel] = Number(entry.score.toFixed(4));
    });
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, limit);
}

/**
 * 建议抑制器：避免同一意图在短时间内反复弹出建议。
 *
 * 这是开发计划 §9.1「重复意图：合并或复用近期建议，避免重复弹窗」与
 * §16 风险表「推荐干扰销售节奏」的代码实现。
 */
export class SuppressionWindow {
  /** @type {Map<string, { at: number, suggestion: object }>} */
  #recent = new Map();

  /**
   * @param windowMs - 抑制窗口长度，默认 20 秒。
   */
  constructor(windowMs) {
    this.windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 20000;
  }

  /**
   * 查询某意图是否处于抑制窗口内。
   *
   * @param key - 抑制键，通常是 `<intent>|<productId>`。
   * @param nowMs - 判定时刻。
   * @returns 命中时返回上次的建议，否则返回 undefined。
   */
  recall(key, nowMs = Date.now()) {
    const entry = this.#recent.get(key);
    if (entry === undefined) return undefined;
    if (nowMs - entry.at > this.windowMs) {
      this.#recent.delete(key);
      return undefined;
    }
    return entry.suggestion;
  }

  /**
   * 记录一条刚产生的建议。
   *
   * @param key - 抑制键。
   * @param suggestion - 已通过校验的建议。
   * @param nowMs - 记录时刻。
   */
  remember(key, suggestion, nowMs = Date.now()) {
    this.#recent.set(key, { at: nowMs, suggestion });
  }

  /** 释放全部记录；会话结束时调用，避免跨会话误抑制。 */
  clear() {
    this.#recent.clear();
  }

  /** 当前记录的抑制条目数，供健康检查与测试使用。 */
  get size() {
    return this.#recent.size;
  }
}

/**
 * 事件幂等表：按 `event_id` 丢弃重复事件。
 *
 * ASR 重连、客户端重试、网络抖动都会重放事件；没有这层就会出现重复建议
 * 与重复反馈。见开发计划 §14.3。
 */
export class IdempotencyLog {
  /** @type {Map<string, number>} */
  #seen = new Map();

  /**
   * @param ttlMs - 记录保留时长。
   * @param maxEntries - 上限，超出时按时间淘汰最旧的。
   */
  constructor(ttlMs = 300000, maxEntries = 2000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * 标记一个事件已处理。
   *
   * @param id - 事件唯一标识。
   * @param nowMs - 判定时刻。
   * @returns 首次见到返回 true；重复返回 false。
   */
  admit(id, nowMs = Date.now()) {
    if (typeof id !== "string" || id.length === 0) return true; // 无 id 的事件不参与幂等。
    if (this.#seen.has(id)) return false;
    this.#seen.set(id, nowMs);
    // 先插入再淘汰：否则容量上限会被新条目突破一条。
    this.#evict(nowMs);
    return true;
  }

  /** 按 TTL 与容量上限淘汰。 */
  #evict(nowMs) {
    for (const [id, at] of this.#seen) {
      if (nowMs - at > this.ttlMs) this.#seen.delete(id);
    }
    if (this.#seen.size <= this.maxEntries) return;
    const sorted = [...this.#seen.entries()].sort((a, b) => a[1] - b[1]);
    const excess = this.#seen.size - this.maxEntries;
    for (let i = 0; i < excess; i += 1) this.#seen.delete(sorted[i][0]);
  }

  /** 当前记录数。 */
  get size() {
    return this.#seen.size;
  }
}
