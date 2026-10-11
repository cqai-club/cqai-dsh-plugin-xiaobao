/**
 * e销宝 Host 半侧：HTTP 路由、Agent 工具与运行时技能。
 *
 * 职责边界（开发计划 §8.1）：
 * - 本插件不改动 Harness 核心，只注册自己的路由、工具与技能。
 * - 长时间持有的东西只有知识库的内存态与建议抑制表，没有音频连接——
 *   语音由浏览器半侧按分段驱动平台 ASR。
 * - 所有注册都由 `ctx.effect` 托管，卸载时连同定时器与订阅一起释放。
 *
 * 依赖策略：`webServer` 是硬依赖（没有它就没有任何接口）；`skills`、`tools`、
 * `llm`、`agentDefaultModel` 一律**惰性解析**，缺席时对应能力降级而不是让
 * 整个插件挂起。这样即使部署裁剪了某个服务，实时陪练的文字链路仍然可用。
 *
 * @module cqai-dsh-plugin-xiaobao
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FEEDBACK_KIND_VALUES,
  PLUGIN_ID,
  ROUTE_PREFIX,
  SESSION_STATE,
} from "./shared/protocol.js";
import { SchemaError } from "./shared/schemas.js";
import { KnowledgeStore, resolveDataRoot } from "./host/store.js";
import { Coach } from "./host/coach.js";
import { IdempotencyLog, SuppressionWindow } from "./host/retrieval.js";

/** 插件行名；与 `cordis.patch.yml` 中的 id 一致。 */
export const name = "cqai-xiaobao";

/**
 * 硬依赖只有 webServer：它提供路由载体，也是插件被装载的意义所在。
 * 其余服务在用到时惰性解析。
 */
export const inject = ["webServer"];

/** 技能目录：随包发布，运行时按需读取内容。 */
const SKILL_ROOT = fileURLToPath(new URL("../skills/", import.meta.url));

/** 随包提供的七个技能；顺序即界面展示顺序。 */
export const BUNDLED_SKILLS = Object.freeze([
  { dir: "b2c-sales-context", description: "e销宝 的产品、客户、价格、政策与沟通边界权威上下文，以及五个可用工具的使用规则。" },
  { dir: "b2c-need-discovery", description: "从客户表达中识别需求、场景、约束与未知信息，并严格区分事实、推断与未知。" },
  { dir: "product-recommendation", description: "根据已确认需求推荐适合的产品或下一步，强制引用已审核产品事实并说明不适用条件。" },
  { dir: "realtime-sales-coach", description: "实时判断客户意图、检索已审核话术卡并生成受约束的结构化建议与风险提示。" },
  { dir: "objection-handling", description: "用 C 端版 ACRC 处理价格、适配、效果、竞品与服务顾虑，禁止虚假稀缺与未授权折扣。" },
  { dir: "human-handoff", description: "判断人工接管条件并整理可交接的客户原话、已确认事实、未知信息与风险原因。" },
  { dir: "conversation-debrief", description: "通话结束后复盘需求、异议、未解问题与知识缺口，产物只进待审核队列。" },
]);

/** 路由前缀的字符长度，用于从 URL 里切出动作段。 */
const PREFIX_LENGTH = ROUTE_PREFIX.length;

/** 单次请求体的字节上限；防止超长正文占满内存。 */
const MAX_BODY_BYTES = 1024 * 1024;

/** 是否来自本机。所有接口都只服务本机应用，不做跨机暴露。 */
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress;
  if (typeof address !== "string") return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** 统一的 JSON 响应。 */
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

/** 读取并解析请求体，超过上限时拒绝。 */
async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("请求体超过上限");
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("请求体必须是 JSON 对象");
    }
    return value;
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 从 URL 中取出动作段与查询参数。 */
function routeOf(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  return {
    action: url.pathname.slice(PREFIX_LENGTH).replace(/^\/+/u, ""),
    query: url.searchParams,
  };
}

/**
 * 惰性解析一个可选服务。
 *
 * @param ctx - 插件上下文。
 * @param key - 服务名。
 * @returns 服务实例，缺席时返回 undefined。
 */
function optional(ctx, key) {
  try {
    return ctx.get(key);
  } catch {
    return undefined;
  }
}

/**
 * 插件主体。
 *
 * @param ctx - Host 插件上下文。
 * @param config - 插件行配置；`dataRoot` 可覆盖知识库位置。
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console;
  const dataRoot = resolveDataRoot(config.dataRoot ?? ctx.config?.dataRoot);
  const store = new KnowledgeStore({ root: dataRoot });
  const suppression = new SuppressionWindow(config.suppressWindowMs);
  const idempotency = new IdempotencyLog();
  const coach = new Coach({
    store,
    suppression,
    logger,
    // 惰性读取：模型配置可能在插件装载之后才就绪，而且该服务是可选的。
    llm: optional(ctx, "llm"),
    route: () => optional(ctx, "agentDefaultModel")?.currentSelection(),
  });

  /** 每个会话的内存态：轮次、建议与反馈。v1 不做跨会话持久化。 */
  const sessions = new Map();

  /** 取一个会话的状态，不存在时创建。 */
  function session(id) {
    const key = typeof id === "string" && id.length > 0 ? id : "default";
    if (!sessions.has(key)) {
      sessions.set(key, {
        id: key,
        state: SESSION_STATE.IDLE,
        turns: [],
        suggestions: [],
        feedback: [],
        gaps: [],
        intentSignals: [],
        unresolved: [],
        started_at: null,
      });
    }
    return sessions.get(key);
  }

  // ── 知识库载入与种子注入 ───────────────────────────────────────────────
  const ready = (async () => {
    const loaded = await store.load();
    try {
      const seedDir = fileURLToPath(new URL("../data/seed/", import.meta.url));
      const cards = JSON.parse(await readFile(join(seedDir, "phrase-cards.json"), "utf8"));
      const facts = JSON.parse(await readFile(join(seedDir, "facts.json"), "utf8"));
      const written = await store.seedIfEmpty({ cards, facts });
      if (written.cards > 0 || written.facts > 0) {
        logger.info?.(`e销宝：已注入种子知识（话术卡 ${written.cards} 张，事实 ${written.facts} 条）`);
      }
    } catch (error) {
      // 种子缺失或损坏不应该阻断插件：空库同样可以打开配置页去录入内容。
      if (error?.code !== "ENOENT") {
        logger.warn?.(`e销宝：种子数据注入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    logger.info?.(`e销宝：知识库已就绪（话术卡 ${store.allCards().length} 张，事实 ${store.allFacts().length} 条）于 ${dataRoot}`);
    return { loaded, dataRoot };
  })();

  /** 确保知识库已载入后再处理请求。 */
  function whenReady() {
    return ready;
  }

  // ── HTTP 路由 ──────────────────────────────────────────────────────────
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "prefix",
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, error: "仅允许本机应用访问" });
          return;
        }
        try {
          await whenReady();
          const result = await dispatch(req, res);
          if (result === undefined) writeJson(res, 404, { ok: false, error: "接口不存在" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = error instanceof SchemaError ? 400 : 500;
          writeJson(res, status, { ok: false, error: message, issues: error instanceof SchemaError ? error.issues : undefined });
        }
      },
    });
    return () => dispose();
  }, "cqai-xiaobao: http routes");

  /**
   * 路由分派：把动作段映射到具体处理函数。
   *
   * 所有写操作都要求 `actor`（操作者标识），并落审计；所有幂等写操作要求
   * `event_id`，重复请求直接被丢弃。见开发计划 §11.5 与 §14.3。
   */
  async function dispatch(req, res) {
    const { action, query } = routeOf(req);
    const method = req.method ?? "GET";

    // GET /health
    if (method === "GET" && action === "health") {
      const selection = coach.currentRoute();
      writeJson(res, 200, {
        ok: true,
        plugin: PLUGIN_ID,
        data_root: dataRoot,
        knowledge: store.inspectHealth().counts,
        model: selection ?? null,
        // 语音能力由浏览器半侧通过平台 speech 远程服务探测，这里只报告是否
        // 已启用语音插件，避免 Host 侧误报。
        sessions: sessions.size,
      });
      return true;
    }

    // GET /knowledge —— 配置页与工作台的主数据源
    if (method === "GET" && action === "knowledge") {
      writeJson(res, 200, {
        ok: true,
        cards: store.allCards(),
        facts: store.allFacts(),
        health: store.inspectHealth(),
      });
      return true;
    }

    // GET /audit
    if (method === "GET" && action === "audit") {
      const limit = Number.parseInt(query.get("limit") ?? "200", 10);
      writeJson(res, 200, { ok: true, entries: await store.recentAudit(Number.isFinite(limit) ? limit : 200) });
      return true;
    }

    // POST /cards —— 新建或整体替换
    if (method === "POST" && action === "cards") {
      const body = await readBody(req);
      const card = await store.putCard(body.card ?? body, actorOf(body));
      writeJson(res, 200, { ok: true, card });
      return true;
    }

    // POST /cards/:id/approve | /retire | /status | /rollback
    const cardAction = /^cards\/([^/]+)\/(approve|retire|status|rollback)$/u.exec(action);
    if (method === "POST" && cardAction !== null) {
      const [, id, verb] = cardAction;
      const body = await readBody(req);
      const actor = actorOf(body);
      if (verb === "approve") {
        writeJson(res, 200, { ok: true, card: await store.setCardStatus(decodeURIComponent(id), "approved", actor) });
        return true;
      }
      if (verb === "retire") {
        writeJson(res, 200, { ok: true, card: await store.retireCard(decodeURIComponent(id), actor) });
        return true;
      }
      if (verb === "status") {
        writeJson(res, 200, { ok: true, card: await store.setCardStatus(decodeURIComponent(id), body.status, actor) });
        return true;
      }
      writeJson(res, 200, { ok: true, card: await store.rollbackCard(decodeURIComponent(id), body.revision, actor) });
      return true;
    }

    // PATCH /cards/:id
    const cardPatch = /^cards\/([^/]+)$/u.exec(action);
    if (method === "PATCH" && cardPatch !== null) {
      const body = await readBody(req);
      const card = await store.patchCard(decodeURIComponent(cardPatch[1]), body.patch ?? {}, actorOf(body));
      writeJson(res, 200, { ok: true, card });
      return true;
    }

    // GET /facts, POST /facts, POST /facts/:id/approve
    if (method === "GET" && action === "facts") {
      writeJson(res, 200, { ok: true, facts: store.allFacts() });
      return true;
    }
    if (method === "POST" && action === "facts") {
      const body = await readBody(req);
      const fact = await store.putFact(body.fact ?? body, actorOf(body));
      writeJson(res, 200, { ok: true, fact });
      return true;
    }
    const factApprove = /^facts\/([^/]+)\/approve$/u.exec(action);
    if (method === "POST" && factApprove !== null) {
      const body = await readBody(req);
      writeJson(res, 200, { ok: true, fact: await store.setFactStatus(decodeURIComponent(factApprove[1]), "approved", actorOf(body)) });
      return true;
    }

    // POST /suggest —— 文字链路的核心入口
    if (method === "POST" && action === "suggest") {
      const body = await readBody(req);
      if (!idempotency.admit(body.event_id)) {
        writeJson(res, 200, { ok: true, duplicate: true });
        return true;
      }
      const text = String(body.utterance ?? "").trim();
      if (text.length === 0) {
        writeJson(res, 400, { ok: false, error: "utterance 不能为空" });
        return true;
      }
      const state = session(body.session_id);
      const bundle = await coach.suggest({
        utterance: text,
        speaker: body.speaker ?? "customer",
        productId: body.product_id,
        stage: body.stage,
        history: state.turns,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        transcriptQuality: body.transcript_quality,
        sessionId: state.id,
      });

      // 记录轮次与建议，供复盘使用。
      state.turns.push({ speaker: body.speaker ?? "customer", text, at_ms: Date.now() });
      state.suggestions.push({
        at_ms: Date.now(),
        intent: bundle.suggestion.intent,
        source_cards: bundle.suggestion.source_cards,
        degraded: bundle.degraded === true,
        latency_ms: bundle.latency_ms,
      });
      if (bundle.handoff.required) {
        state.unresolved.push({ at_ms: Date.now(), text, reasons: bundle.handoff.reasons });
      }
      // 知识缺口：检索没有命中任何已审核卡片。
      if (bundle.recalled.length === 0) {
        state.gaps.push({ intent: bundle.suggestion.intent, scenario: "实时对话未命中已审核话术", utterances: [text] });
      }

      await store.audit({
        action: "coaching.suggest",
        actor: body.actor ?? "sales",
        subject: state.id,
        detail: {
          intent: bundle.suggestion.intent,
          degraded: bundle.degraded === true,
          handoff: bundle.handoff.required,
          latency_ms: bundle.latency_ms,
          model: bundle.model,
        },
      });

      writeJson(res, 200, { ok: true, ...bundle, session_state: state.state });
      return true;
    }

    // POST /feedback —— 采纳、修改、跳过与效果反馈
    if (method === "POST" && action === "feedback") {
      const body = await readBody(req);
      if (!idempotency.admit(body.event_id)) {
        writeJson(res, 200, { ok: true, duplicate: true });
        return true;
      }
      const kind = body.kind;
      if (!FEEDBACK_KIND_VALUES.includes(kind)) {
        writeJson(res, 400, { ok: false, error: `kind 必须是 ${FEEDBACK_KIND_VALUES.join(" / ")} 之一` });
        return true;
      }
      const state = session(body.session_id);
      const entry = {
        at_ms: Date.now(),
        kind,
        suggestion_id: body.suggestion_id ?? null,
        edited_text: typeof body.edited_text === "string" ? body.edited_text : null,
        note: typeof body.note === "string" ? body.note : null,
      };
      state.feedback.push(entry);
      await store.audit({ action: "coaching.feedback", actor: body.actor ?? "sales", subject: state.id, detail: entry });
      writeJson(res, 200, { ok: true, feedback: entry });
      return true;
    }

    // POST /handoff —— 建立人工接管任务
    if (method === "POST" && action === "handoff") {
      const body = await readBody(req);
      if (!idempotency.admit(body.event_id)) {
        writeJson(res, 200, { ok: true, duplicate: true });
        return true;
      }
      const state = session(body.session_id);
      // 交接材料必须附客户原话、已确认事实、未知信息与风险原因。
      const task = {
        task_id: `handoff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        session_id: state.id,
        created_at: new Date().toISOString(),
        reason: body.reason ?? "manual",
        customer_utterances: state.turns.filter((turn) => turn.speaker === "customer").slice(-5).map((turn) => turn.text),
        confirmed_facts: (body.confirmed_facts ?? []).slice(0, 20),
        unknown: (body.unknown ?? []).slice(0, 20),
        risk_reasons: (body.risk_reasons ?? []).slice(0, 20),
        policy_refs: (body.policy_refs ?? []).slice(0, 20),
        suggested_direction: body.suggested_direction ?? null,
      };
      await store.audit({ action: "human.handoff", actor: body.actor ?? "sales", subject: state.id, detail: { reason: task.reason } });
      writeJson(res, 200, { ok: true, task });
      return true;
    }

    // POST /session —— 会话状态迁移
    if (method === "POST" && action === "session") {
      const body = await readBody(req);
      const state = session(body.session_id);
      const next = body.state;
      if (typeof next !== "string" || !Object.values(SESSION_STATE).includes(next)) {
        writeJson(res, 400, { ok: false, error: "state 取值非法" });
        return true;
      }
      state.state = next;
      if (next === SESSION_STATE.LISTENING && state.started_at === null) state.started_at = new Date().toISOString();
      await store.audit({ action: "session.state", actor: body.actor ?? "sales", subject: state.id, detail: { state: next } });
      writeJson(res, 200, { ok: true, session_state: state.state });
      return true;
    }

    // POST /debrief —— 结束后复盘
    if (method === "POST" && action === "debrief") {
      const body = await readBody(req);
      const state = session(body.session_id);
      const report = coach.debrief(state);
      await store.audit({
        action: "conversation.debrief",
        actor: body.actor ?? "sales",
        subject: state.id,
        detail: { suggestions: report.stats.suggestions, gaps: report.knowledge_gaps.length },
      });
      writeJson(res, 200, { ok: true, report });
      return true;
    }

    // POST /preview —— 配置页「试运行与评测」：粘贴客户表达看召回与建议
    if (method === "POST" && action === "preview") {
      const body = await readBody(req);
      const text = String(body.utterance ?? "").trim();
      if (text.length === 0) {
        writeJson(res, 400, { ok: false, error: "utterance 不能为空" });
        return true;
      }
      // 试运行不写入任何会话状态，也不写审计：它是只读的沙盘。
      const bundle = await coach.suggest(
        { utterance: text, productId: body.product_id, stage: body.stage, sessionId: "preview" },
        { nowMs: Date.now() },
      );
      writeJson(res, 200, { ok: true, ...bundle });
      return true;
    }

    return undefined;
  }

  /** 从请求体里取操作者标识；缺失时用固定值，保证审计不缺字段。 */
  function actorOf(body) {
    return typeof body?.actor === "string" && body.actor.trim().length > 0 ? body.actor.trim() : "unknown";
  }

  // ── Agent 工具 ─────────────────────────────────────────────────────────
  // 惰性注入：tools 服务缺席时不注册工具，文字链路仍可用。
  ctx.inject(["tools"], (child) => {
    const registry = child.get("tools");
    if (registry === undefined) return;
    child.effect(() => {
      const disposers = [];
      for (const tool of buildTools({ store, coach, session })) {
        disposers.push(registry.register(tool));
      }
      return () => {
        for (const dispose of disposers.reverse()) dispose();
      };
    }, "cqai-xiaobao: agent tools");
  });

  // ── 运行时技能 ─────────────────────────────────────────────────────────
  // 技能正文是异步读取的，而 register 是同步的。因此先并行读完全部正文，
  // 再一次性注册——不在注册后修改内容，那既不可靠也不符合服务契约。
  const skillsReady = (async () => {
    const loaded = [];
    for (const skill of BUNDLED_SKILLS) {
      try {
        const content = await readFile(join(SKILL_ROOT, skill.dir, "SKILL.md"), "utf8");
        loaded.push({ ...skill, content });
      } catch (error) {
        logger.warn?.(`e销宝：技能 ${skill.dir} 正文读取失败，已跳过：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return loaded;
  })();

  ctx.inject(["skills"], (child) => {
    const registry = child.get("skills");
    if (registry === undefined) return;
    child.effect(() => {
      /**
       * 已注册技能的注销器；技能正文就绪后填充，卸载时一并调用。
       * 用对象包住数组，让异步回调与同步清理函数共享同一份引用。
       */
      const state = { disposers: [], disposed: false };
      skillsReady
        .then((loaded) => {
          if (state.disposed) return;
          for (const skill of loaded) {
            state.disposers.push(registry.register({
              name: skill.dir,
              description: skill.description,
              source: "runtime",
              content: skill.content,
            }));
          }
          logger.info?.(`e销宝：已注册 ${loaded.length} 个运行时技能`);
        })
        .catch((error) => {
          logger.warn?.(`e销宝：技能注册失败：${error instanceof Error ? error.message : String(error)}`);
        });
      return () => {
        state.disposed = true;
        for (const dispose of state.disposers.reverse()) dispose();
      };
    }, "cqai-xiaobao: bundled skills");
  });

  // ── 卸载清理 ───────────────────────────────────────────────────────────
  ctx.effect(() => () => {
    coach.dispose();
    sessions.clear();
    logger.info?.("e销宝：已释放建议会话与订阅");
  }, "cqai-xiaobao: session teardown");
}

/**
 * 构造首版五个工具。
 *
 * 刻意不注册发送消息、自动外呼、改价、折扣、退款或合同类工具——那是开发
 * 计划 §2.3 与 §10.3 的明确边界，也是本插件的安全前提。
 *
 * @param deps - `{ store, coach, session }`。
 * @returns 工具定义数组。
 */
function buildTools(deps) {
  const { store, coach, session } = deps;

  /** 工具输出统一走 JSON 文本渲染。 */
  const render = (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }];
  const objectOutput = { schema: { type: "object", additionalProperties: true, properties: {} }, render };

  return [
    {
      name: "search_phrase_cards",
      description: "查找已审核且在生效期内的话术卡。按客户原话做关键词、字符相似度与元数据混合检索，返回 Top 3 候选卡及其来源。返回空表示已审核知识中没有依据，此时应转人工。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          utterance: { type: "string", description: "客户原话" },
          product_id: { type: "string", description: "可选，限定产品" },
          stage: { type: "string", description: "可选，销售阶段" },
          limit: { type: "number", description: "可选，返回条数，默认 3" },
        },
        required: ["utterance"],
      },
      output: objectOutput,
      execute(args) {
        return import("./host/retrieval.js").then(({ searchCards }) => {
          const limit = Number.isInteger(args?.limit) ? args.limit : 3;
          const ranked = searchCards(
            { utterance: String(args?.utterance ?? ""), productId: args?.product_id, stage: args?.stage, limit },
            store.usableCards(),
          );
          return {
            count: ranked.length,
            cards: ranked.map((entry) => ({
              id: entry.card.id,
              scenario: entry.card.scenario,
              intent: entry.card.intent,
              response_goal: entry.card.response_goal,
              approved_responses: entry.card.approved_responses,
              follow_up_questions: entry.card.follow_up_questions,
              do_not_say: entry.card.do_not_say,
              evidence_refs: entry.card.evidence_refs,
              risk_level: entry.card.risk_level,
              escalation: entry.card.escalation,
              version: entry.card.version,
              score: Number(entry.score.toFixed(4)),
            })),
            note: ranked.length === 0 ? "没有命中已审核话术卡，不要自行编造说法。" : undefined,
          };
        });
      },
    },
    {
      name: "get_product_policy",
      description: "查询权威的产品、价格、优惠、退款、配送与售后政策。这是价格与产品能力的唯一权威来源；返回为空表示没有已审核依据，此时不得给出任何数字或承诺。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          product_id: { type: "string", description: "可选，限定产品" },
          topic: { type: "string", description: "可选，主题如 pricing / refund / delivery / feature" },
        },
      },
      output: objectOutput,
      execute(args) {
        const facts = store.usableFacts().filter((fact) => {
          if (typeof args?.product_id === "string" && fact.product_id !== args.product_id) return false;
          if (typeof args?.topic === "string" && fact.topic !== args.topic) return false;
          return true;
        });
        return {
          count: facts.length,
          facts: facts.map((fact) => ({
            id: fact.id,
            product_id: fact.product_id,
            topic: fact.topic,
            statement: fact.statement,
            details: fact.details,
            source: fact.source,
            version: fact.version,
            effective_from: fact.effective_from,
            expires_at: fact.expires_at,
            reviewed_by: fact.reviewed_by,
          })),
          note: facts.length === 0 ? "没有已审核依据，不得推断价格或政策。" : undefined,
        };
      },
    },
    {
      name: "get_customer_context",
      description: "读取当前会话允许使用的客户上下文：已确认的需求、场景、预算信号与未知信息。只返回本会话内已记录的内容，不读取外部客户档案。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { session_id: { type: "string", description: "会话标识，缺省为 default" } },
      },
      output: objectOutput,
      execute(args) {
        const state = session(args?.session_id);
        const customerTurns = state.turns.filter((turn) => turn.speaker === "customer");
        return {
          session_id: state.id,
          session_state: state.state,
          // 只回客户原话，不做「推断成事实」的加工——推断属于 b2c-need-discovery 的活。
          customer_utterances: customerTurns.slice(-10).map((turn) => turn.text),
          unresolved: state.unresolved.slice(-10),
          note: "本工具只提供客户原话与已知未解问题，不提供推断结论；推断必须由模型显式标注。",
        };
      },
    },
    {
      name: "save_coaching_feedback",
      description: "记录销售对一条建议的采纳、修改、跳过或效果反馈。同一 event_id 重复提交会被忽略。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          session_id: { type: "string" },
          kind: { type: "string", description: "accepted / copied / edited / skipped / ineffective" },
          suggestion_id: { type: "string" },
          edited_text: { type: "string", description: "kind=edited 时填写销售实际使用的说法" },
          event_id: { type: "string", description: "幂等键" },
        },
        required: ["kind"],
      },
      output: objectOutput,
      execute(args) {
        const allowed = FEEDBACK_KIND_VALUES;
        if (!allowed.includes(args?.kind)) throw new Error(`kind 必须是 ${allowed.join(" / ")} 之一`);
        const state = session(args?.session_id);
        const entry = {
          at_ms: Date.now(),
          kind: args.kind,
          suggestion_id: args.suggestion_id ?? null,
          edited_text: args.edited_text ?? null,
        };
        state.feedback.push(entry);
        return store.audit({ action: "coaching.feedback", actor: "agent", subject: state.id, detail: entry })
          .then(() => ({ saved: true, feedback: entry }));
      },
    },
    {
      name: "request_human_handoff",
      description: "建立人工接管任务，附客户原话、已确认事实、未知信息、风险原因、相关政策来源与建议处理方向。用于退款、投诉、法律、未核实承诺、高风险主张或知识不足等情形。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          session_id: { type: "string" },
          reason: { type: "string", description: "接管原因码或简短说明" },
          confirmed_facts: { type: "array", items: { type: "string" } },
          unknown: { type: "array", items: { type: "string" } },
          risk_reasons: { type: "array", items: { type: "string" } },
          policy_refs: { type: "array", items: { type: "string" } },
          suggested_direction: { type: "string" },
        },
        required: ["reason"],
      },
      output: objectOutput,
      execute(args) {
        const state = session(args?.session_id);
        const task = {
          task_id: `handoff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          session_id: state.id,
          created_at: new Date().toISOString(),
          reason: args.reason,
          customer_utterances: state.turns.filter((turn) => turn.speaker === "customer").slice(-5).map((turn) => turn.text),
          confirmed_facts: args.confirmed_facts ?? [],
          unknown: args.unknown ?? [],
          risk_reasons: args.risk_reasons ?? [],
          policy_refs: args.policy_refs ?? [],
          suggested_direction: args.suggested_direction ?? null,
        };
        return store.audit({ action: "human.handoff", actor: "agent", subject: state.id, detail: { reason: task.reason } })
          .then(() => task);
      },
    },
  ];
}
