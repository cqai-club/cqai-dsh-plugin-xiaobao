/**
 * 路由测试：用伪 req/res 直接驱动 Host 的 handler。
 *
 * 这样能在不启动 HTTP 服务器的情况下验证完整链路——包括幂等、门禁、
 * 转人工与错误码，是「接口真的能用」的证据。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { apply, BUNDLED_SKILLS } from "../lib/index.js";

/** 本次运行创建的全部临时知识库；文件级钩子统一清理。 */
const tempRoots = [];

after(async () => {
	for (const root of tempRoots) await rm(root, { recursive: true, force: true });
	tempRoots.length = 0;
});

/** 构造一个伪请求。 */
function makeRequest({ method = "GET", path = "/", body, remoteAddress = "127.0.0.1" } = {}) {
	const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
	return {
		method,
		url: path,
		socket: { remoteAddress },
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) yield chunk;
		},
	};
}

/** 构造一个伪响应，记录状态与载荷。 */
function makeResponse() {
	const response = {
		status: 0,
		headers: {},
		body: "",
		writeHead(status, headers) {
			response.status = status;
			response.headers = headers ?? {};
		},
		end(text) {
			response.body = text ?? "";
		},
		/** 解析返回的 JSON。 */
		json() {
			return JSON.parse(response.body);
		},
	};
	return response;
}

/**
 * 装载插件并把路由 handler 取出来。
 *
 * 用一个最小的 ctx 桩：只提供 webServer 与 logger。可选服务（llm、tools、
 * skills、agentDefaultModel）保持缺席，正是验证降级路径的方式。
 *
 * 知识库落在临时目录：测试绝不能碰用户真实的 `$DSH_HOME/xiaobao/`，
 * 否则一次测试就会污染或覆盖用户的业务数据。
 */
async function mountPlugin({ defaultConfig = false, llm, selection } = {}) {
	let handler;
	let disposed = false;
	const logs = [];
	const registered = { tools: [], skills: [] };
	const temporaryRoot = await mkdtemp(join(tmpdir(), "xiaobao-route-"));
	const dataRoot = defaultConfig ? join(temporaryRoot, "xiaobao", "knowledge") : temporaryRoot;
	tempRoots.push(temporaryRoot);

	const ctx = {
		logger: {
			info: (message) => logs.push(["info", message]),
			warn: (message) => logs.push(["warn", message]),
		},
		get config() {
			throw new Error('cannot get property "config" without inject');
		},
		get: (key) => key === "llm" ? llm : key === "agentDefaultModel" && selection ? { currentSelection: () => selection } : void 0,
		effect(factory) {
			const dispose = factory();
			return () => {
				disposed = true;
				return dispose?.();
			};
		},
		inject(services, callback) {
			const names = Array.isArray(services) ? services : [services];
			// 只开放 tools 与 skills 两个可选服务，用来验证注册路径；
			// llm 与 agentDefaultModel 保持缺席。
			// 子上下文必须提供 effect 与 get —— 平台注入的是完整的子 ctx，
			// 插件会在上面用 effect 托管注册的生命周期。
			const child = {
				effect(factory) {
					const dispose = factory();
					return () => dispose?.();
				},
				get: () => void 0,
			};
			if (names.includes("tools")) {
				callback({
					...child,
					get: (key) => (key === "tools" ? { register: (tool) => {
						registered.tools.push(tool);
						return () => undefined;
					} } : void 0),
				});
			}
			if (names.includes("skills")) {
				callback({
					...child,
					get: (key) => (key === "skills" ? { register: (skill) => {
						registered.skills.push(skill);
						return () => undefined;
					} } : void 0),
				});
			}
			return () => undefined;
		},
		webServer: {
			register(definition) {
				handler = definition.handler;
				return () => {
					handler = void 0;
				};
			},
		},
	};

	// 安装时 patch 的 config 为 {}；此时应使用 DSH_HOME，不能读取 ctx.config。
	const previousDshHome = process.env.DSH_HOME;
	try {
		if (defaultConfig) process.env.DSH_HOME = temporaryRoot;
		apply(ctx, defaultConfig ? {} : { dataRoot });
	} finally {
		if (previousDshHome === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previousDshHome;
	}
	// 技能正文是异步读取的，等一轮微任务让注册发生。
	await new Promise((resolve) => setTimeout(resolve, 50));

	/** 发一个请求并拿到响应。 */
	const call = async (options) => {
		const response = makeResponse();
		await handler(makeRequest(options), response);
		return response;
	};

	/** 清理临时知识库。 */
	const cleanup = () => rm(temporaryRoot, { recursive: true, force: true });

	return { call, logs, registered, dataRoot, cleanup, isDisposed: () => disposed, handler: () => handler };
}

test("health 报告插件身份与知识库规模", async () => {
	const { call } = await mountPlugin();
	const response = await call({ path: "/api/cqai-xiaobao/health" });
	assert.equal(response.status, 200);
	const payload = response.json();
	assert.equal(payload.ok, true);
	assert.equal(payload.plugin, "@cqaiclub/cqai-dsh-plugin-xiaobao");
	assert.ok(payload.knowledge.cards >= 30, `种子卡片应已载入，实际 ${payload.knowledge.cards}`);
	assert.equal(payload.model, null, "缺席 agentDefaultModel 时应如实报告无模型");
});

test("安装默认空配置能启动并从 DSH_HOME 读取知识库", async () => {
	const { call, dataRoot } = await mountPlugin({ defaultConfig: true });
	const health = await call({ path: "/api/cqai-xiaobao/health" });
	assert.equal(health.status, 200);
	assert.equal(health.json().data_root, dataRoot);
	const knowledge = await call({ path: "/api/cqai-xiaobao/knowledge" });
	assert.equal(knowledge.status, 200);
	assert.ok(knowledge.json().cards.length >= 30);
});

test("非本机请求被拒绝", async () => {
	const { call } = await mountPlugin();
	const response = await call({ path: "/api/cqai-xiaobao/health", remoteAddress: "192.168.1.20" });
	assert.equal(response.status, 403);
	assert.equal(response.json().ok, false);
});

test("未知动作返回 404", async () => {
	const { call } = await mountPlugin();
	const response = await call({ path: "/api/cqai-xiaobao/nonexistent" });
	assert.equal(response.status, 404);
});

test("文字链路能产出带来源的建议", async () => {
	const { call } = await mountPlugin();
	const response = await call({
		method: "POST",
		path: "/api/cqai-xiaobao/suggest",
		body: { utterance: "你们这个价格有点贵", session_id: "route-test", event_id: "e1" },
	});
	assert.equal(response.status, 200);
	const payload = response.json();
	assert.equal(payload.ok, true);
	assert.equal(payload.suggestion.intent, "price_concern");
	// 模型缺席时必须降级，但仍然给出已审核话术。
	assert.equal(payload.degraded, true);
	assert.ok(payload.suggestion.recommended_reply.length > 0, "降级也必须给出可用话术");
	assert.ok(payload.recalled.length > 0, "应召回已审核卡片");
	assert.ok(payload.sources.some((source) => source.kind === "phrase_card"), "应展示话术卡来源");
	assert.equal(payload.handoff.required, false);
	assert.ok(payload.suggestion_id.startsWith("suggestion_"));
	for (const field of ["customer_assessment", "communication_goal", "strategy"]) assert.ok(payload.suggestion[field].length > 0);
});

test("连续请求把销售补充交给模型并保留可追溯的轮次与建议标识", async () => {
	const calls = [];
	const llm = { async *stream(options) {
		calls.push(options);
		yield { type: "text-delta", text: JSON.stringify({ intent: "price_concern", confidence: 0.9, recommended_reply: "我们先确认你的具体使用场景。", human_handoff: false, source_cards: [], policy_refs: [] }) };
	} };
	const { call } = await mountPlugin({ llm, selection: { provider: "fixture", model: "fixture-model" } });
	const sessionId = "continuous-context";
	const customer = { speaker: "customer", text: "你们这个价格有点贵" };
	const sales = { speaker: "sales", text: "我已经解释了使用场景，客户仍有顾虑" };
	const followUp = { speaker: "sales", text: "接下来我应该怎么追问？" };
	const send = (turn, event, history) => call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body: { utterance: turn.text, speaker: turn.speaker, event_id: event, session_id: sessionId, ...(history === undefined ? {} : { history, history_includes_current: true }) } });
	const first = (await send(customer, "context-1")).json();
	const second = (await send(followUp, "context-2", [customer, sales, followUp])).json();
	assert.equal(second.degraded, false, "销售追问应沿用已知客户场景而不是丢失依据");
	assert.notEqual(first.suggestion_id, second.suggestion_id, "同一意图的不同轮次应有独立反馈标识");
	const prompt = calls[1].messages[0].content[0].text;
	assert.match(prompt, /销售补充：我已经解释了使用场景/);
	assert.equal(prompt.split(followUp.text).length - 1, 1, "当前输入不能同时出现在历史与本轮栏");
	await send({ speaker: "customer", text: "价格偏高，具体有什么功能？" }, "context-3");
	assert.match(calls[2].messages[0].content[0].text, /销售补充：接下来我应该怎么追问？/);
	const report = (await call({ method: "POST", path: "/api/cqai-xiaobao/debrief", body: { session_id: sessionId } })).json().report;
	assert.equal(report.customer_turns, 2, "补入已有窗口不应重复记录客户发言");
	assert.equal(report.sales_turns, 2);
	assert.equal(report.stats.suggestions, 3);
	const feedback = (await call({ method: "POST", path: "/api/cqai-xiaobao/feedback", body: { session_id: sessionId, suggestion_id: first.suggestion_id, kind: "accepted", event_id: "context-feedback" } })).json();
	assert.equal(feedback.feedback.suggestion_id, first.suggestion_id);
});

test("助手建议不能作为客户历史提交", async () => {
	const { call } = await mountPlugin();
	const response = await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body: { utterance: "价格有点贵", history: [{ speaker: "assistant", text: "未经确认的客户判断" }] } });
	assert.equal(response.status, 400);
	assert.ok(response.json().issues.some((issue) => issue.includes("speaker")));
});

test("客户真正重复同一句时保留上一轮上下文", async () => {
	const calls = [];
	const llm = { async *stream(options) {
		calls.push(options);
		yield { type: "text-delta", text: JSON.stringify({ intent: "price_concern", confidence: 0.9, recommended_reply: "我们先确认你的具体顾虑。", human_handoff: false, source_cards: [], policy_refs: [] }) };
	} };
	const { call } = await mountPlugin({ llm, selection: { provider: "fixture", model: "fixture-model" } });
	const body = { utterance: "你们这个价格有点贵", session_id: "repeat-context", speaker: "customer" };
	await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body: { ...body, event_id: "repeat-1" } });
	await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body: { ...body, event_id: "repeat-2", history: [{ speaker: "customer", text: body.utterance }] } });
	assert.equal(calls.length, 2, "新的同句轮次也要结合新增历史重新判断");
	assert.equal(calls[1].messages[0].content[0].text.split(body.utterance).length - 1, 2);
});

test("退款类表达在路由层被判定为必须转人工", async () => {
	const { call } = await mountPlugin();
	const response = await call({
		method: "POST",
		path: "/api/cqai-xiaobao/suggest",
		body: { utterance: "我要退款，还要投诉你们", session_id: "route-handoff", event_id: "e2" },
	});
	const payload = response.json();
	assert.equal(payload.handoff.required, true, "退款投诉必须转人工");
	assert.equal(payload.suggestion.human_handoff, true);
	assert.equal(payload.suggestion.next_action, "handoff");
});

test("重复的 event_id 被幂等丢弃，不重复生成建议", async () => {
	const { call } = await mountPlugin();
	const body = { utterance: "你们这个价格有点贵", session_id: "route-idem", event_id: "same-event" };
	const first = await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body });
	const second = await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body });

	assert.equal(first.json().duplicate, void 0);
	assert.equal(second.json().duplicate, true, "同一 event_id 应被判为重复");
});

test("空 utterance 返回 400", async () => {
	const { call } = await mountPlugin();
	const response = await call({ method: "POST", path: "/api/cqai-xiaobao/suggest", body: { utterance: "   " } });
	assert.equal(response.status, 400);
});

test("非法 JSON 请求体被拒绝且不影响后续请求", async () => {
	const { call, handler } = await mountPlugin();

	// 手动构造一个产出坏 JSON 的请求，走与 call 相同的 handler。
	const bad = makeRequest({ method: "POST", path: "/api/cqai-xiaobao/suggest" });
	bad[Symbol.asyncIterator] = async function* iterator() {
		yield Buffer.from("{ 坏掉的 JSON", "utf8");
	};
	const badResponse = makeResponse();
	await handler()(bad, badResponse);
	assert.equal(badResponse.status, 500, "坏 JSON 应返回错误");
	assert.equal(badResponse.json().ok, false);

	// 关键点：坏请求之后正常请求仍然成功。
	const response = await call({
		method: "POST",
		path: "/api/cqai-xiaobao/suggest",
		body: { utterance: "都有什么功能", session_id: "after-bad", event_id: "ok-1" },
	});
	assert.equal(response.status, 200, "坏请求不应破坏后续请求");
});

test("反馈接口校验 kind 并落审计", async () => {
	const { call } = await mountPlugin();
	const bad = await call({ method: "POST", path: "/api/cqai-xiaobao/feedback", body: { kind: "不存在的类型" } });
	assert.equal(bad.status, 400);

	const good = await call({
		method: "POST",
		path: "/api/cqai-xiaobao/feedback",
		body: { kind: "accepted", session_id: "fb-test", event_id: "fb-1" },
	});
	assert.equal(good.status, 200);
	assert.equal(good.json().feedback.kind, "accepted");

	const audit = await call({ path: "/api/cqai-xiaobao/audit" });
	const entries = audit.json().entries;
	assert.ok(entries.some((entry) => entry.action === "coaching.feedback"), "反馈应写入审计");
});

test("人工接管任务附客户原话与风险原因", async () => {
	const { call } = await mountPlugin();
	// 先制造一段对话，让接管任务能带上客户原话。
	await call({
		method: "POST",
		path: "/api/cqai-xiaobao/suggest",
		body: { utterance: "我要退款", session_id: "ho-test", event_id: "ho-utt" },
	});
	const response = await call({
		method: "POST",
		path: "/api/cqai-xiaobao/handoff",
		body: { session_id: "ho-test", reason: "policy_escalation", risk_reasons: ["policy_escalation"], event_id: "ho-1" },
	});
	const task = response.json().task;
	assert.ok(task.task_id.startsWith("handoff_"), "任务号应有可识别前缀");
	assert.deepEqual(task.customer_utterances, ["我要退款"], "接管任务必须附客户原话");
	assert.deepEqual(task.risk_reasons, ["policy_escalation"]);
});

test("会话状态迁移校验取值", async () => {
	const { call } = await mountPlugin();
	const bad = await call({ method: "POST", path: "/api/cqai-xiaobao/session", body: { session_id: "s1", state: "乱写" } });
	assert.equal(bad.status, 400);

	const good = await call({ method: "POST", path: "/api/cqai-xiaobao/session", body: { session_id: "s1", state: "listening" } });
	assert.equal(good.json().session_state, "listening");
});

test("复盘可追溯到会话且不自动发布", async () => {
	const { call } = await mountPlugin();
	await call({
		method: "POST",
		path: "/api/cqai-xiaobao/suggest",
		body: { utterance: "我要退款", session_id: "debrief-test", event_id: "d1" },
	});
	const response = await call({ method: "POST", path: "/api/cqai-xiaobao/debrief", body: { session_id: "debrief-test" } });
	const report = response.json().report;
	assert.equal(report.published, false, "复盘绝不能自动发布");
	assert.ok(report.objections.length > 0, "应提取到异议");
	assert.ok(report.customer_turns >= 1);
});

test("试运行是只读的，不写审计", async () => {
	const { call } = await mountPlugin();
	const before = (await call({ path: "/api/cqai-xiaobao/audit" })).json().entries.length;
	await call({ method: "POST", path: "/api/cqai-xiaobao/preview", body: { utterance: "你们这个价格有点贵" } });
	const after = (await call({ path: "/api/cqai-xiaobao/audit" })).json().entries.length;
	assert.equal(after, before, "试运行不应产生审计记录");
});

test("卡片状态迁移在路由层生效并受审计", async () => {
	const { call } = await mountPlugin();
	const knowledge = (await call({ path: "/api/cqai-xiaobao/knowledge" })).json();
	const target = knowledge.cards.find((card) => card.status === "approved");
	assert.ok(target !== undefined);

	const retired = await call({
		method: "POST",
		path: `/api/cqai-xiaobao/cards/${encodeURIComponent(target.id)}/retire`,
		body: { actor: "tester" },
	});
	assert.equal(retired.status, 200);
	assert.equal(retired.json().card.status, "retired");
	assert.equal(retired.json().card.version, target.version + 1, "停用应推进版本");

	const audit = (await call({ path: "/api/cqai-xiaobao/audit" })).json().entries;
	assert.ok(audit.some((entry) => entry.action === "card.review" && entry.actor === "tester"));
});

test("注册了五个工具，且不含任何越权工具", async () => {
	const { registered } = await mountPlugin();
	const names = registered.tools.map((tool) => tool.name).sort();
	assert.deepEqual(names, [
		"get_customer_context",
		"get_product_policy",
		"request_human_handoff",
		"save_coaching_feedback",
		"search_phrase_cards",
	]);

	// 明确断言不存在发送、外呼、改价、折扣、退款、合同类工具。
	const forbidden = /send|message|sms|email|call|campaign|discount|price_change|refund|contract/iu;
	for (const name of names) {
		assert.ok(!forbidden.test(name), `不应注册越权工具：${name}`);
	}

	// 每个工具都必须声明 output.render（平台注册时的硬性要求）。
	for (const tool of registered.tools) {
		assert.equal(typeof tool.output?.render, "function", `${tool.name} 缺少 output.render`);
		assert.equal(typeof tool.execute, "function", `${tool.name} 缺少 execute`);
	}
});

test("注册了七个运行时技能并读到正文", async () => {
	const { registered } = await mountPlugin();
	assert.equal(registered.skills.length, BUNDLED_SKILLS.length, "应注册全部随包技能");
	for (const skill of registered.skills) {
		assert.ok(skill.content.length > 500, `技能 ${skill.name} 正文过短，可能没读到文件`);
		assert.ok(skill.content.includes("---"), `技能 ${skill.name} 应含 YAML frontmatter`);
		assert.equal(skill.source, "runtime");
	}
});

test("卸载会释放路由与技能注册", async () => {
	const { handler } = await mountPlugin();
	assert.equal(typeof handler(), "function", "装载后应有路由 handler");
});
