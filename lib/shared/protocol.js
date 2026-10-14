/**
 * e销宝 共享协议层：Host 半侧与浏览器半侧共同引用的常量与枚举。
 *
 * 本模块必须保持零依赖、零副作用、可被两侧同时加载：只用语言内建能力，
 * 不引入 Node 或浏览器 API。任何一侧都不能在这里放状态。
 *
 * @module @cqaiclub/cqai-dsh-plugin-xiaobao/shared/protocol
 */

/** 插件包名：同时是 Bundle 包名、配置页 key 和客户端模块 id。 */
export const PLUGIN_ID = "@cqaiclub/cqai-dsh-plugin-xiaobao";

/** Host 路由前缀。浏览器半侧只用它拼请求，不重复字面量。 */
export const ROUTE_PREFIX = "/api/cqai-xiaobao";

/** 右侧 Sidebar 标签类型：实时陪练页的身份。 */
export const TAB_KIND = "xiaobao";

/** 右侧标签类型的注册 id；包名迁移时保留已有标签身份与主体槽位 key。 */
export const TAB_ID = "cqai-dsh-plugin-xiaobao/live";

/** 左侧工作台面板 id。 */
export const WORKBENCH_PANEL = "cqai-xiaobao";

/** 会话事件中的说话人标签。v1 由销售人员手工切换，不做自动分离。 */
export const SPEAKER = Object.freeze({
  CUSTOMER: "customer",
  SALES: "sales",
  UNKNOWN: "unknown",
});

/** 话术卡内容状态机。只有 APPROVED 才能进入实时检索集合。 */
export const CARD_STATUS = Object.freeze({
  DRAFT: "draft",
  REVIEW: "review",
  APPROVED: "approved",
  RETIRED: "retired",
});

/** 内容状态的全部取值，供校验器使用。 */
export const CARD_STATUS_VALUES = Object.freeze([
  CARD_STATUS.DRAFT,
  CARD_STATUS.REVIEW,
  CARD_STATUS.APPROVED,
  CARD_STATUS.RETIRED,
]);

/** 话术卡风险等级。 */
export const RISK_LEVEL = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

/** 风险等级的全部取值。 */
export const RISK_LEVEL_VALUES = Object.freeze([
  RISK_LEVEL.LOW,
  RISK_LEVEL.MEDIUM,
  RISK_LEVEL.HIGH,
]);

/** 话术卡的升级策略：不需要 / 建议 / 必须人工接管。 */
export const ESCALATION = Object.freeze({
  NONE: "none",
  SUGGEST: "suggest",
  REQUIRED: "required",
});

/** 升级策略的全部取值。 */
export const ESCALATION_VALUES = Object.freeze([
  ESCALATION.NONE,
  ESCALATION.SUGGEST,
  ESCALATION.REQUIRED,
]);

/** 销售阶段取值，与话术卡 stage 字段共用。 */
export const STAGE = Object.freeze({
  FIRST_CONTACT: "first_contact",
  NEED_DISCOVERY: "need_discovery",
  COMPARISON: "comparison",
  OBJECTION: "objection",
  CLOSING: "closing",
  AFTER_SALES: "after_sales",
});

/** 销售阶段的全部取值。 */
export const STAGE_VALUES = Object.freeze([
  STAGE.FIRST_CONTACT,
  STAGE.NEED_DISCOVERY,
  STAGE.COMPARISON,
  STAGE.OBJECTION,
  STAGE.CLOSING,
  STAGE.AFTER_SALES,
]);

/**
 * 人工接管原因码。规则引擎按这些码判定，界面按码显示。
 * 与开发计划 §5.2 的八类条件一一对应。
 */
export const HANDOFF_REASON = Object.freeze({
  /** 退款、赔付、投诉、法律或合同问题。 */
  POLICY_ESCALATION: "policy_escalation",
  /** 未核实的功能、价格、优惠或效果承诺。 */
  UNVERIFIED_CLAIM: "unverified_claim",
  /** 医疗、金融、隐私、安全等高风险主张。 */
  HIGH_RISK_DOMAIN: "high_risk_domain",
  /** 客户要求内部底价、内部资料或其他客户信息。 */
  INTERNAL_REQUEST: "internal_request",
  /** 意图置信度或说话人识别低于阈值。 */
  LOW_CONFIDENCE: "low_confidence",
  /** ASR 识别不完整，或客户与销售同时发言。 */
  ASR_INCOMPLETE: "asr_incomplete",
  /** 已审核知识没有足够依据。 */
  NO_GROUNDING: "no_grounding",
  /** 客户明确拒绝，需要结束或转人工服务。 */
  CUSTOMER_REFUSAL: "customer_refusal",
});

/** 全部接管原因码，供校验与界面文案映射使用。 */
export const HANDOFF_REASON_VALUES = Object.freeze(Object.values(HANDOFF_REASON));

/** 接管原因码到界面文案的映射。 */
export const HANDOFF_REASON_LABEL = Object.freeze({
  [HANDOFF_REASON.POLICY_ESCALATION]: "涉及退款、赔付、投诉或合同条款",
  [HANDOFF_REASON.UNVERIFIED_CLAIM]: "涉及未核实的功能或效果承诺",
  [HANDOFF_REASON.HIGH_RISK_DOMAIN]: "涉及医疗、金融、隐私或安全主张",
  [HANDOFF_REASON.INTERNAL_REQUEST]: "客户索要内部底价或他人信息",
  [HANDOFF_REASON.LOW_CONFIDENCE]: "意图置信度偏低",
  [HANDOFF_REASON.ASR_INCOMPLETE]: "转写不完整或双方同时发言",
  [HANDOFF_REASON.NO_GROUNDING]: "已审核知识中没有足够依据",
  [HANDOFF_REASON.CUSTOMER_REFUSAL]: "客户明确拒绝",
});

/** 建议的下一步动作。 */
export const NEXT_ACTION = Object.freeze({
  CLARIFY_NEED: "clarify_need",
  CLARIFY_VALUE: "clarify_value",
  PRESENT_FACT: "present_fact",
  HANDLE_OBJECTION: "handle_objection",
  PROPOSE_NEXT_STEP: "propose_next_step",
  /** 人工接管：不给出话术，只交接。 */
  HANDOFF: "handoff",
});

/** 全部下一步动作取值。 */
export const NEXT_ACTION_VALUES = Object.freeze(Object.values(NEXT_ACTION));

/** 反馈动作：销售对一条建议做了什么。 */
export const FEEDBACK_KIND = Object.freeze({
  ACCEPTED: "accepted",
  COPIED: "copied",
  EDITED: "edited",
  SKIPPED: "skipped",
  /** 已采用但客户反应不佳，用于效果回流。 */
  INEFFECTIVE: "ineffective",
});

/** 全部反馈动作取值。 */
export const FEEDBACK_KIND_VALUES = Object.freeze(Object.values(FEEDBACK_KIND));

/** 会话与连接状态。音频、ASR、推荐三者各自独立报告。 */
export const SESSION_STATE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  LISTENING: "listening",
  PAUSED: "paused",
  ENDED: "ended",
  ERROR: "error",
});

/** 服务健康状态，用于独立展示音频 / ASR / 推荐。 */
export const SERVICE_STATE = Object.freeze({
  UNKNOWN: "unknown",
  READY: "ready",
  /** 需要首次准备（例如 SenseVoice 首次下载模型）。 */
  PREPARING: "preparing",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
});

/** 客户端向 Host 上报的事件类型。 */
export const CLIENT_EVENT = Object.freeze({
  TRANSCRIPT_FINAL: "transcript.final",
  SESSION_START: "session.start",
  SESSION_PAUSE: "session.pause",
  SESSION_RESUME: "session.resume",
  SESSION_STOP: "session.stop",
  FEEDBACK: "coaching.feedback",
  HANDOFF: "human.handoff",
});

/** Host 返回给客户端的事件类型。 */
export const HOST_EVENT = Object.freeze({
  SUGGESTION: "coaching.suggestion",
  TRANSCRIPT: "transcript.final",
  HANDOFF: "human.handoff",
  DEBRIEF: "conversation.debrief",
});

/** 语音分段长度（毫秒）。v1 按语义分段做准实时，不是流式回调。 */
export const VOICE_SEGMENT_MS = 4000;

/** 平台 ASR 只接受 16 kHz 单声道 PCM16 的规范 WAV。 */
export const WAV_SPEC = Object.freeze({
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  byteRate: 32000,
  blockAlign: 2,
});

/** 稳定句触发推荐前等待的停顿（毫秒）。 */
export const STABLE_PAUSE_MS = 800;

/** 同一意图的建议抑制窗口（毫秒）：避免重复弹窗干扰销售节奏。 */
export const SUPPRESS_WINDOW_MS = 20000;

/** 建议生成的整体超时（毫秒）。超时即降级为模板建议。 */
export const SUGGEST_TIMEOUT_MS = 12000;

/** 检索返回的候选话术卡数量上限。 */
export const RECALL_LIMIT = 3;

/**
 * 判断一个话术卡在给定时刻是否可用于实时推荐。
 *
 * 这是唯一的内容门禁实现：Host 的检索入口和界面都用它，避免两处规则漂移。
 * 未审核、已停用、未生效、已过期四种情况一律不可用。
 *
 * @param card - 候选话术卡。
 * @param nowMs - 判定时刻的毫秒时间戳。
 * @returns 可用时返回 true。
 */
export function isCardUsable(card, nowMs) {
  if (card === null || typeof card !== "object") return false;
  if (card.status !== CARD_STATUS.APPROVED) return false;
  const from = Date.parse(card.effective_from ?? "");
  if (Number.isFinite(from) && nowMs < from) return false;
  const until = card.expires_at === null || card.expires_at === undefined ? Number.NaN : Date.parse(card.expires_at);
  if (Number.isFinite(until) && nowMs >= until) return false;
  return true;
}

/**
 * 判断一条产品事实在给定时刻是否可用。
 *
 * @param fact - 候选事实记录。
 * @param nowMs - 判定时刻的毫秒时间戳。
 * @returns 可用时返回 true。
 */
export function isFactUsable(fact, nowMs) {
  if (fact === null || typeof fact !== "object") return false;
  if (fact.status !== undefined && fact.status !== CARD_STATUS.APPROVED) return false;
  const from = Date.parse(fact.effective_from ?? "");
  if (Number.isFinite(from) && nowMs < from) return false;
  const until = fact.expires_at === null || fact.expires_at === undefined ? Number.NaN : Date.parse(fact.expires_at);
  if (Number.isFinite(until) && nowMs >= until) return false;
  return true;
}
