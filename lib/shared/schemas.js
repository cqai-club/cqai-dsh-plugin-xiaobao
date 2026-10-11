/**
 * e销宝 共享校验层：话术卡、产品事实与模型建议的结构校验。
 *
 * 这一层的存在理由是开发计划 §7.4 的硬要求：模型输出必须经过代码校验，
 * 而不能靠模型自觉。凡校验失败的输出一律拒绝并降级，绝不半信半疑地展示。
 *
 * 零依赖、零副作用，Host 与浏览器两侧共用。
 *
 * @module cqai-dsh-plugin-xiaobao/shared/schemas
 */

import {
  CARD_STATUS_VALUES,
  ESCALATION_VALUES,
  NEXT_ACTION,
  NEXT_ACTION_VALUES,
  RISK_LEVEL_VALUES,
  STAGE_VALUES,
} from "./protocol.js";

/** 校验失败时抛出的错误；`issues` 列出全部问题，便于一次修完。 */
export class SchemaError extends Error {
  /**
   * @param subject - 被校验对象的名称，用于定位。
   * @param issues - 人类可读的问题列表。
   */
  constructor(subject, issues) {
    super(`${subject} 校验失败：${issues.join("；")}`);
    this.name = "SchemaError";
    this.subject = subject;
    this.issues = issues;
  }
}

/** 判断是否为普通对象（排除 null 与数组）。 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 收集器的极简实现：累积问题，最后统一抛出。 */
function collector() {
  const issues = [];
  return {
    issues,
    /** 记录一个问题。 */
    fail(message) {
      issues.push(message);
    },
    /** 断言条件成立，否则记录问题。 */
    require(condition, message) {
      if (!condition) issues.push(message);
      return condition;
    },
    /** 全部问题一次性抛出。 */
    throwIfAny(subject) {
      if (issues.length > 0) throw new SchemaError(subject, issues);
    },
  };
}

/**
 * 校验字符串字段。
 * @returns 通过时返回裁掉首尾空白的值，否则返回 undefined。
 */
function takeString(source, key, c, options = {}) {
  const value = source[key];
  if (value === undefined) {
    if (options.required === true) c.fail(`缺少必填字段 ${key}`);
    return undefined;
  }
  if (typeof value !== "string") {
    c.fail(`${key} 必须是文本`);
    return undefined;
  }
  const trimmed = value.trim();
  if (options.required === true && trimmed.length === 0) {
    c.fail(`${key} 不能为空`);
    return undefined;
  }
  return trimmed;
}

/**
 * 校验字符串数组字段。
 * @returns 通过时返回去重后的数组，否则返回 undefined。
 */
function takeStringArray(source, key, c, options = {}) {
  const value = source[key];
  if (value === undefined) {
    if (options.required === true) c.fail(`缺少必填数组 ${key}`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    c.fail(`${key} 必须是数组`);
    return undefined;
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") {
      c.fail(`${key} 的元素必须是文本`);
      return undefined;
    }
    const trimmed = item.trim();
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
  }
  if (options.required === true && out.length === 0) {
    c.fail(`${key} 至少要有一项`);
    return undefined;
  }
  return out;
}

/**
 * 校验枚举字段。
 * @returns 通过时返回值，否则返回 undefined。
 */
function takeEnum(source, key, allowed, c, options = {}) {
  const value = source[key];
  if (value === undefined) {
    if (options.required === true) c.fail(`缺少必填字段 ${key}`);
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    c.fail(`${key} 必须是 ${allowed.join(" / ")} 之一`);
    return undefined;
  }
  return value;
}

/**
 * 校验 ISO 8601 时间字段；允许显式的 null（表示永不过期）。
 * @returns 通过时返回规范化字符串或 null，否则返回 undefined。
 */
function takeTimestamp(source, key, c, options = {}) {
  if (!Object.hasOwn(source, key)) {
    if (options.required === true) c.fail(`缺少必填时间 ${key}`);
    return undefined;
  }
  const value = source[key];
  if (value === null) {
    if (options.nullable === false) {
      c.fail(`${key} 不允许为 null`);
      return undefined;
    }
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    c.fail(`${key} 必须是 ISO 8601 时间或 null`);
    return undefined;
  }
  return value;
}

/** 校验一个编号或标识符字段的非空性。 */
function takeId(source, key, c, options = {}) {
  const value = takeString(source, key, c, { required: options.required !== false });
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    c.fail(`${key} 含非法字符（只允许字母、数字、._:-）`);
    return undefined;
  }
  return value;
}

/**
 * 校验一张话术卡，返回规范化副本。
 *
 * 字段集与开发计划 §6.2 一致。未知字段一律丢弃，避免模型或人工输入夹带
 * 任意内容进入实时链路。
 *
 * @param input - 待校验的候选对象。
 * @param options - `partial` 为 true 时只校验出现的字段（用于 PATCH）。
 * @returns 规范化后的话术卡。
 * @throws {SchemaError} 存在任何问题时。
 */
export function normalizeCard(input, options = {}) {
  const partial = options.partial === true;
  const c = collector();
  if (!isPlainObject(input)) throw new SchemaError("话术卡", ["必须是对象"]);
  const out = {};

  const assign = (key, value) => {
    if (value !== undefined) out[key] = value;
  };

  assign("id", takeId(input, "id", c, { required: !partial }));
  assign("scenario", takeString(input, "scenario", c, { required: !partial }));
  assign("intent", takeId(input, "intent", c, { required: !partial }));
  assign("product_ids", takeStringArray(input, "product_ids", c));
  assign("customer_utterances", takeStringArray(input, "customer_utterances", c));
  assign("stage", takeStringArray(input, "stage", c));
  assign("response_goal", takeString(input, "response_goal", c));
  assign("approved_responses", takeStringArray(input, "approved_responses", c, { required: !partial }));
  assign("follow_up_questions", takeStringArray(input, "follow_up_questions", c));
  assign("do_not_say", takeStringArray(input, "do_not_say", c));
  assign("evidence_refs", takeStringArray(input, "evidence_refs", c));
  assign("risk_level", takeEnum(input, "risk_level", RISK_LEVEL_VALUES, c, { required: !partial }));
  assign("escalation", takeEnum(input, "escalation", ESCALATION_VALUES, c, { required: !partial }));
  assign("status", takeEnum(input, "status", CARD_STATUS_VALUES, c, { required: !partial }));
  assign("effective_from", takeTimestamp(input, "effective_from", c));
  assign("expires_at", takeTimestamp(input, "expires_at", c));
  assign("reviewed_by", takeString(input, "reviewed_by", c));
  assign("updated_at", takeTimestamp(input, "updated_at", c));

  if (Object.hasOwn(input, "version")) {
    const version = input.version;
    if (!Number.isInteger(version) || version < 1) c.fail("version 必须是大于 0 的整数");
    else out.version = version;
  } else if (!partial) {
    c.fail("缺少必填字段 version");
  }

  // stage 的每一项必须是已知阶段；未知阶段会让元数据过滤静默失效。
  if (out.stage !== undefined) {
    for (const item of out.stage) {
      if (!STAGE_VALUES.includes(item)) c.fail(`stage 含未知阶段 ${item}`);
    }
  }

  c.throwIfAny("话术卡");
  return out;
}

/**
 * 校验一条产品事实或政策，返回规范化副本。
 *
 * 事实库回答「产品是什么、可以做什么、多少钱、限制是什么」；它是价格与
 * 产品能力的唯一权威来源，因此 source/version/审核人必须齐全。
 *
 * @param input - 待校验的候选对象。
 * @param options - `partial` 为 true 时只校验出现的字段。
 * @returns 规范化后的事实记录。
 * @throws {SchemaError} 存在任何问题时。
 */
export function normalizeFact(input, options = {}) {
  const partial = options.partial === true;
  const c = collector();
  if (!isPlainObject(input)) throw new SchemaError("产品事实", ["必须是对象"]);
  const out = {};

  const assign = (key, value) => {
    if (value !== undefined) out[key] = value;
  };

  assign("id", takeId(input, "id", c, { required: !partial }));
  assign("product_id", takeId(input, "product_id", c, { required: !partial }));
  assign("topic", takeId(input, "topic", c, { required: !partial }));
  assign("statement", takeString(input, "statement", c, { required: !partial }));
  assign("details", takeStringArray(input, "details", c));
  // 合规事实会在这里声明全局禁止表达；规则层靠它拦截模型输出，不能丢。
  assign("forbidden_claims", takeStringArray(input, "forbidden_claims", c));
  assign("source", takeString(input, "source", c, { required: !partial }));
  assign("reviewed_by", takeString(input, "reviewed_by", c));
  assign("escalation", takeEnum(input, "escalation", ESCALATION_VALUES, c, { required: !partial }));
  assign("status", takeEnum(input, "status", CARD_STATUS_VALUES, c, { required: !partial }));
  assign("effective_from", takeTimestamp(input, "effective_from", c));
  assign("expires_at", takeTimestamp(input, "expires_at", c));
  assign("updated_at", takeTimestamp(input, "updated_at", c));

  if (Object.hasOwn(input, "version")) {
    const version = input.version;
    if (!Number.isInteger(version) || version < 1) c.fail("version 必须是大于 0 的整数");
    else out.version = version;
  } else if (!partial) {
    c.fail("缺少必填字段 version");
  }

  c.throwIfAny("产品事实");
  return out;
}

/** 建议 JSON 允许出现的字段全集。多出的字段一律丢弃。 */
export const SUGGESTION_FIELDS = Object.freeze([
  "intent",
  "confidence",
  "recommended_reply",
  "alternative_reply",
  "follow_up_question",
  "reason",
  "do_not_say",
  "next_action",
  "human_handoff",
  "source_cards",
  "policy_refs",
]);

/**
 * 校验模型返回的建议 JSON，并施加来源白名单。
 *
 * 这是整个链路最关键的一道闸门。除了结构校验，还强制执行三条计划 §7.4 的
 * 约束：
 * 1. `source_cards` 只能引用本次检索交给模型的候选卡；
 * 2. `policy_refs` 只能引用已审核且在生效期内的产品事实；
 * 3. 二者越界即视为模型在编造依据，整条建议判为不可用。
 *
 * @param input - 模型输出的候选结构。
 * @param context - `allowedCardIds` 与 `allowedPolicyRefs` 两个白名单集合。
 * @returns 规范化后的建议。
 * @throws {SchemaError} 存在任何问题时。
 */
export function normalizeSuggestion(input, context) {
  const c = collector();
  if (!isPlainObject(input)) throw new SchemaError("建议", ["必须是对象"]);

  const allowedCards = context?.allowedCardIds ?? new Set();
  const allowedPolicies = context?.allowedPolicyRefs ?? new Set();
  const out = {};

  out.intent = takeId(input, "intent", c, { required: true }) ?? "unknown";

  const confidence = input.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    c.fail("confidence 必须是 0 到 1 之间的数字");
  } else {
    out.confidence = confidence;
  }

  const recommended = takeString(input, "recommended_reply", c, { required: true });
  if (recommended !== undefined) out.recommended_reply = recommended;

  const alternative = takeString(input, "alternative_reply", c);
  if (alternative !== undefined) out.alternative_reply = alternative;

  const followUp = takeString(input, "follow_up_question", c);
  if (followUp !== undefined) out.follow_up_question = followUp;

  const reason = takeString(input, "reason", c);
  if (reason !== undefined) out.reason = reason;

  out.do_not_say = takeStringArray(input, "do_not_say", c) ?? [];

  // next_action 是低风险字段：取值不认识时回落为默认动作，而不是让一条
  // 内容正确的建议因为一个分类标签被整条丢弃。
  const nextAction = NEXT_ACTION_VALUES.includes(input.next_action)
    ? input.next_action
    : NEXT_ACTION.PROPOSE_NEXT_STEP;
  out.next_action = nextAction;

  if (typeof input.human_handoff !== "boolean") {
    c.fail("human_handoff 必须是布尔值");
  } else {
    out.human_handoff = input.human_handoff;
  }

  // 来源白名单：模型不得引用本次未提供的卡片。
  const cards = takeStringArray(input, "source_cards", c) ?? [];
  const unknownCards = cards.filter((id) => !allowedCards.has(id));
  if (unknownCards.length > 0) {
    c.fail(`source_cards 引用了未提供的卡片 ${unknownCards.join(", ")}（模型编造了依据）`);
  }
  out.source_cards = cards;

  // 政策白名单：模型不得引用未审核或已过期的政策。
  const policies = takeStringArray(input, "policy_refs", c) ?? [];
  const unknownPolicies = policies.filter((id) => !allowedPolicies.has(id));
  if (unknownPolicies.length > 0) {
    c.fail(`policy_refs 引用了未审核或已过期的依据 ${unknownPolicies.join(", ")}（模型编造了依据）`);
  }
  out.policy_refs = policies;

  c.throwIfAny("建议");
  return out;
}

/**
 * 在模型输出里寻找第一个 JSON 对象。
 *
 * 模型常把 JSON 包在 ```json 围栏或解释性文字里；这里做一次宽松提取，但仍
 * 要求结果能被 JSON.parse 解析。解析失败返回 undefined，由调用方降级。
 *
 * @param text - 模型的原始文本输出。
 * @returns 解析出的对象，失败时返回 undefined。
 */
export function extractJsonObject(text) {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  if (fenced !== null) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // 退而求其次：从第一个 { 到最后一个 } 的切片。
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = tryParse(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/** 尝试解析一段文本为普通对象。 */
function tryParse(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
