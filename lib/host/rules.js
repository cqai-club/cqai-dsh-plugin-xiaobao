/**
 * e销宝 规则层：人工接管判定与禁止承诺拦截。
 *
 * 这一层全部是确定性代码，且**不等待模型生成**——高风险的输入必须在第一
 * 时间得到「转人工」的回答，而不是让客户等一次可能出错的生成。见开发计划
 * §5.2（八条接管条件）与 §9.1（高风险意图规则优先）。
 *
 * @module cqai-dsh-plugin-xiaobao/host/rules
 */

import {
  CARD_STATUS,
  ESCALATION,
  HANDOFF_REASON,
  RISK_LEVEL,
  isFactUsable,
} from "../shared/protocol.js";

/**
 * 八类接管条件各自的触发词。
 *
 * 这些是**规则**而非模型判断：命中即接管，不做概率权衡。词表刻意保守——
 * 宁可多转一次人工，也不要让一次未授权的承诺说出去。
 */
export const HANDOFF_PATTERNS = Object.freeze({
  [HANDOFF_REASON.POLICY_ESCALATION]: [
    "退款", "退钱", "退货", "赔付", "赔偿", "投诉", "起诉", "律师", "法律", "合同",
    "违约", "工商", "12315", "消协", "仲裁",
  ],
  [HANDOFF_REASON.UNVERIFIED_CLAIM]: [
    "保证", "包治", "一定有效", "百分之百", "100%", "绝对", "永远不会", "根治", "立刻见效",
    "承诺", "无理由全额",
  ],
  [HANDOFF_REASON.HIGH_RISK_DOMAIN]: [
    // 医疗与健康主张。刻意收录「能治」「治好」这类动词短语，因为客户常说的是
    // 「能治我的病吗」而不是「治病」这个连续词。
    "医疗", "诊断", "处方", "治病", "能治", "治好", "治疗", "医治", "疗法", "疗效",
    "症状", "病情", "药物", "药效", "副作用", "抑郁", "焦虑", "康复", "痊愈",
    // 金融与资金主张。
    "投资", "收益", "理财", "保本", "贷款", "征信", "稳赚", "回报率",
    // 身份与凭据类敏感信息。
    "身份证号", "银行卡", "密码", "隐私数据", "验证码",
  ],
  [HANDOFF_REASON.INTERNAL_REQUEST]: [
    "底价", "内部价", "成本价", "进货价", "内部资料", "别人买", "其他客户", "同行报价",
    "内部折扣", "最低多少能卖",
  ],
  [HANDOFF_REASON.CUSTOMER_REFUSAL]: [
    "不需要", "不感兴趣", "别再打", "不要再联系", "别烦我", "挂了", "拉黑", "骚扰",
  ],
});

/**
 * 低置信度阈值：低于此值直接转人工，不生成建议。
 *
 * 取值校准自 <see cref="scoreIntents"/> 的实际行为（见 test/rules.test.mjs 的
 * 校准断言）：
 * - 「嗯」「好的」这类无信息量的话，与任何客户表述示例都不重叠，得分 0.0；
 * - 「不要太贵」这类口语化但意图明确的话，得分约 0.33。
 *
 * 因此 0.2 能够把「完全没有信号」与「信号弱但有」分开。注意这个值绑定于当前
 * 的字符 n-gram 打分器：若更换打分方式，必须重新校准，否则会误伤正常对话。
 */
export const CONFIDENCE_FLOOR = 0.2;

/**
 * 在文本中查找命中的规则类别。
 *
 * @param text - 客户原话。
 * @returns 命中的原因码数组（去重、按定义顺序）。
 */
export function matchHandoffPatterns(text) {
  const haystack = String(text ?? "").toLowerCase();
  if (haystack.length === 0) return [];
  const hits = [];
  for (const [reason, terms] of Object.entries(HANDOFF_PATTERNS)) {
    if (terms.some((term) => haystack.includes(term.toLowerCase()))) hits.push(reason);
  }
  return hits;
}

/**
 * 汇总全局禁止承诺清单。
 *
 * 来源有两处，全部是已审核内容：每张命中卡片自己的 `do_not_say`，以及
 * 所有已生效事实里标记为必须接管的条目。合并后交给界面展示，并由
 * <see cref="findForbiddenClaims"/> 用来拦截模型输出。
 *
 * @param cards - 本次命中的候选卡片。
 * @param facts - 本次可用的已审核事实。
 * @returns 去重后的禁止表达列表。
 */
export function collectForbiddenClaims(cards, facts) {
  const out = new Set();
  for (const card of cards ?? []) {
    for (const phrase of card.do_not_say ?? []) {
      const trimmed = phrase.trim();
      if (trimmed.length > 0) out.add(trimmed);
    }
  }
  for (const fact of facts ?? []) {
    for (const phrase of fact.forbidden_claims ?? []) {
      const trimmed = String(phrase).trim();
      if (trimmed.length > 0) out.add(trimmed);
    }
  }
  return [...out];
}

/**
 * 在建议文本里查找禁止承诺。
 *
 * 这是最后一道闸门：即使模型被注入内容诱导，这条检查也会在展示前拦下
 * 未授权承诺。见开发计划 §14.2 与 §16 风险表。
 *
 * @param text - 待检查的建议文本（主话术 + 备用话术 + 追问）。
 * @param forbidden - 禁止表达清单。
 * @returns 命中的禁止表达；无命中时返回空数组。
 */
export function findForbiddenClaims(text, forbidden) {
  const haystack = String(text ?? "");
  if (haystack.length === 0) return [];
  return (forbidden ?? []).filter((phrase) => {
    const needle = String(phrase).trim();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * 判定一次输入是否需要人工接管。
 *
 * 按开发计划 §5.2 的八条条件逐条检查。返回全部命中的原因，而不是只报第一
 * 条——销售需要看到完整风险，界面也要能一次性说清。
 *
 * @param input - 判定所需的全部上下文。
 * @param input.utterance - 当前的稳定客户语句。
 * @param input.confidence - 意图识别置信度。
 * @param input.usableCardCount - 已审核且可用的话术卡数量（Top-N 召回数）。
 * @param input.cards - 命中的候选卡片，用于读取卡片自身的升级策略。
 * @param input.transcriptQuality - `{ incomplete, overlapping }` 转写质量信号。
 * @param input.nowMs - 判定时刻。
 * @returns `{ required, suggested, reasons }`。
 */
export function evaluateHandoff(input) {
  const reasons = [];
  const utterance = String(input?.utterance ?? "");
  const confidence = typeof input?.confidence === "number" ? input.confidence : 0;
  const cards = Array.isArray(input?.cards) ? input.cards : [];

  // 1–4：词表命中的四类高风险条件。
  for (const reason of matchHandoffPatterns(utterance)) reasons.push(reason);

  // 5：意图置信度低于阈值。
  if (confidence < CONFIDENCE_FLOOR) reasons.push(HANDOFF_REASON.LOW_CONFIDENCE);

  // 6：ASR 识别不完整或双方同时发言。
  if (input?.transcriptQuality?.incomplete === true || input?.transcriptQuality?.overlapping === true) {
    reasons.push(HANDOFF_REASON.ASR_INCOMPLETE);
  }

  // 7：已审核知识没有足够依据。
  const usableCardCount = Number.isInteger(input?.usableCardCount) ? input.usableCardCount : cards.length;
  if (usableCardCount === 0) reasons.push(HANDOFF_REASON.NO_GROUNDING);

  // 卡片自身声明必须接管的，同样升级。
  const cardEscalation = cards.some((card) => card?.escalation === ESCALATION.REQUIRED);
  if (cardEscalation && !reasons.includes(HANDOFF_REASON.POLICY_ESCALATION)) {
    reasons.push(HANDOFF_REASON.POLICY_ESCALATION);
  }

  const unique = [...new Set(reasons)];

  // 什么情况下「必须」接管，而不是仅仅提示：
  // - 命中任何一条非置信度类的风险条件（退款、投诉、法律、未核实承诺、
  //   高风险主张、索要内部信息、客户明确拒绝、ASR 不可靠、知识不足）；
  // - 或置信度低于阈值——计划 §5.2 把「意图置信度低于阈值」本身列为接管
  //   条件，低置信度下生成的建议不可靠，宁可转人工。
  const riskReasons = unique.filter((reason) => reason !== HANDOFF_REASON.LOW_CONFIDENCE);
  const required = riskReasons.length > 0
    || unique.includes(HANDOFF_REASON.LOW_CONFIDENCE);
  const suggested = !required && cards.some((card) => card?.risk_level === RISK_LEVEL.HIGH);

  return { required, suggested, reasons: unique };
}

/**
 * 按已审核事实校验一次应答里出现的价格与政策数字。
 *
 * 开发计划 §17 验收第 7 条要求「价格、优惠、退款和功能回答通过事实库校验」。
 * 这里用保守策略：只要建议里出现了货币或百分比数字，就必须能在某条已生效
 * 事实的文本里找到同样的字面量，否则视为未经授权的报价。
 *
 * @param text - 待检查的建议文本。
 * @param facts - 已审核且在生效期内的事实。
 * @returns 未经授权的数字表述；无问题时返回空数组。
 */
export function findUnauthorizedNumbers(text, facts) {
  const haystack = String(text ?? "");
  if (haystack.length === 0) return [];

  // 抓取货币金额、折扣与百分比。刻意不抓普通整数，避免把「3 天」这类
  // 无害陈述误判成报价。
  const pattern = /(?:[¥￥$]\s?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:元|块|折|%|％)|\d+\s?折)/gu;
  const found = haystack.match(pattern);
  if (found === null) return [];

  const corpus = (facts ?? []).filter((fact) => isFactUsable(fact, Date.now()))
    .map((fact) => `${fact.statement ?? ""} ${(fact.details ?? []).join(" ")}`)
    .join("\n");

  return [...new Set(found)].filter((token) => {
    const normalized = token.replace(/\s+/gu, "");
    return !corpus.replace(/\s+/gu, "").includes(normalized);
  });
}

/**
 * 汇总知识库的证据依据，供复盘与推荐展示。
 *
 * @param cards - 本次候选卡片。
 * @param facts - 已审核事实。
 * @returns 可读的来源列表。
 */
export function describeSources(cards, facts) {
  const factIndex = new Map((facts ?? []).map((fact) => [fact.id, fact]));
  const sources = [];
  for (const card of cards ?? []) {
    sources.push({
      kind: "phrase_card",
      id: card.id,
      label: `${card.scenario ?? card.intent} v${card.version}`,
      status: card.status ?? CARD_STATUS.APPROVED,
    });
  }
  const seen = new Set();
  for (const card of cards ?? []) {
    for (const ref of card.evidence_refs ?? []) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const fact = factIndex.get(ref);
      sources.push({
        kind: "policy",
        id: ref,
        label: fact === undefined ? ref : `${fact.statement.slice(0, 40)} v${fact.version}`,
        status: fact?.status ?? "unknown",
      });
    }
  }
  return sources;
}
