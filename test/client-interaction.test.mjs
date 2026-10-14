/**
 * 回归用户操作触发的行为。通过平台模块工厂与 slots 取出真实组件，
 * 用保留 state/ref 的小型 hook harness 重绘，不依赖 DOM 或额外 React 安装。
 * 文字操作不执行 effect；语音回归按 React commit 顺序执行 effect/cleanup，
 * 以验证退出面板时真正释放采集，并忽略晚到的转写。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const CLIENT_PATH = new URL("../lib/client.js", import.meta.url);
const CUSTOMER_TEXT = "这个价格有点贵，有没有优惠？";
const SUGGESTION = {
  ok: true,
  suggestion_id: "suggestion-first",
  suggestion: {
    intent: "price_concern",
    confidence: 0.8,
    recommended_reply: "主建议：我们先确认你的预算和使用需求。",
    alternative_reply: "备用说法：你更关心预算，还是产品是否适合？",
    follow_up_question: "你主要准备在哪些场景使用？",
    customer_assessment: "客户正在比较价格，尚未确认产品价值。",
    communication_goal: "确认客户更在意预算还是使用价值。",
    strategy: "先共情，再提出一个开放问题，不承诺额外优惠。",
    do_not_say: [],
    human_handoff: false,
  },
  handoff: { required: false, reasons: [] },
  sources: [],
};

function hookHarness({ effects = false } = {}) {
  const cells = [];
  let cursor = 0;
  let pendingEffects = [];
  function cell(initialize) {
    const index = cursor++;
    if (!(index in cells)) cells[index] = initialize();
    return cells[index];
  }
  function memo(factory, deps) {
    const entry = cell(() => ({ value: factory(), deps }));
    if (deps === undefined || entry.deps === undefined || deps.length !== entry.deps.length || deps.some((value, index) => !Object.is(value, entry.deps[index]))) {
      entry.value = factory();
      entry.deps = deps;
    }
    return entry.value;
  }
  const react = {
    Fragment: Symbol("Fragment"),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const entry = cell(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [entry.value, (value) => { entry.value = typeof value === "function" ? value(entry.value) : value; }];
    },
    useRef: (initial) => cell(() => ({ current: initial })),
    useEffect(callback, deps) {
      const entry = cell(() => ({ kind: "effect", initialized: false, deps: undefined, cleanup: undefined }));
      if (!effects) return;
      if (!entry.initialized || deps === undefined || deps.length !== entry.deps?.length || deps.some((value, index) => !Object.is(value, entry.deps[index]))) {
        entry.initialized = true;
        entry.deps = deps;
        pendingEffects.push(() => { entry.cleanup?.(); entry.cleanup = callback(); });
      }
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useId: () => cell(() => `test-hook-${cursor}`),
  };
  function expand(element) {
    if (Array.isArray(element)) return element.map(expand);
    if (element === null || typeof element !== "object") return element;
    if (typeof element.type === "function") return expand(element.type(element.props));
    return { ...element, props: { ...element.props, children: expand(element.props.children) } };
  }
  return {
    react,
    render(Component, props) {
      cursor = 0;
      const tree = expand(Component(props));
      const commit = pendingEffects;
      pendingEffects = [];
      commit.forEach((effect) => effect());
      return tree;
    },
    unmount() { cells.filter((entry) => entry?.kind === "effect").forEach((entry) => entry.cleanup?.()); },
  };
}

async function loadClient({ effects = false, remoteSpeech, AudioContext } = {}) {
  const harness = hookHarness({ effects });
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  new Function("window", "AudioContext", await readFile(CLIENT_PATH, "utf8"))(window, AudioContext);
  const exported = definition.factory((specifier) => {
    assert.equal(specifier, "react");
    return harness.react;
  });
  const registrations = new Map();
  const detach = [];
  const dispose = exported.apply({
    slots: {
      inject(_name, callback) { return callback(); },
      register(meta, component) { registrations.set(meta.name, component); return () => undefined; },
    },
    inject(names, callback) {
      if (!remoteSpeech || !names.includes("remote.speech")) return () => undefined;
      const disposer = callback({ get: (name) => name === "remote.speech" ? remoteSpeech : undefined });
      detach.push(disposer);
      return disposer;
    },
  });
  const element = registrations.get("sidebar.right.pane.tab")({});
  let props = element.props;
  return {
    exported,
    render(next = {}) { props = { ...props, ...next }; return harness.render(element.type, props); },
    unmount() { harness.unmount(); detach.forEach((callback) => callback?.()); dispose(); },
  };
}

function nodes(tree) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") {
      found.push(value);
      visit(value.props?.children);
    }
  }
  visit(tree);
  return found;
}

function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree !== null && typeof tree === "object") return content(tree.props?.children);
  return tree === undefined || tree === null || typeof tree === "boolean" ? "" : String(tree);
}

function find(tree, predicate, message) {
  const found = nodes(tree).find(predicate);
  assert.ok(found, message);
  return found;
}

function input(tree) {
  return find(tree, (node) => node.type === "textarea" && node.props["aria-label"] === "对话输入", "应有统一对话输入框");
}

function button(tree, label) {
  return find(tree, (node) => node.type === "button" && content(node) === label, `应有「${label}」按钮`);
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/** 在 --test-isolation=none 下也精确还原全局描述符，避免影响其他测试。 */
function mockGlobals(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  });
}

function enter(overrides = {}) {
  return { key: "Enter", keyCode: 13, nativeEvent: {}, preventDefault() {}, ...overrides };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 不使用设备，只把可控的 PCM 交给组件建立的 ScriptProcessor 回调。 */
function fakeAudio() {
  const contexts = [];
  const streams = [];
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    constructor({ sampleRate = 16000 } = {}) {
      this.sampleRate = sampleRate;
      this.destination = node();
      this.closed = false;
      contexts.push(this);
    }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { this.processor = { ...node(), onaudioprocess: null }; return this.processor; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    async close() { this.closed = true; }
  }
  return {
    AudioContext,
    contexts,
    streams,
    navigator: { mediaDevices: { async getUserMedia() {
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { track, getTracks: () => [track] };
      streams.push(stream);
      return stream;
    } } },
    push(seconds, amplitude) {
      const context = contexts.at(-1);
      assert.ok(context?.processor?.onaudioprocess, "组件应已启动假音频采集");
      const samples = new Float32Array(Math.round(seconds * context.sampleRate)).fill(amplitude);
      context.processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    },
  };
}

function speechRemote(transcribe) {
  return {
    async catalog() { return { ok: true, value: {
      providers: [{ id: "test-local", name: "假本地识别器", location: "host-local", languages: ["zh"], preparation: { phase: "ready" } }],
      selection: { providerId: "test-local", language: "zh" }, maxAudioBytes: 4_000_000, maxDurationSeconds: 60,
    } }; },
    async prepare() { return { ok: true, value: undefined }; },
    async transcribe(request, signal) {
      const text = await transcribe(request, signal);
      return { ok: true, value: { text, audioSeconds: 0.5, inferenceSeconds: 0 } };
    },
  };
}

function voiceFetch(suggestions) {
  return async (url, init) => {
    if (url.endsWith("/health")) return response({ ok: true, knowledge: { approved_cards: 30 }, model: null });
    if (url.endsWith("/session")) return response({ ok: true });
    assert.ok(url.endsWith("/suggest"), `意外请求：${url}`);
    suggestions.push(JSON.parse(init.body));
    return response(SUGGESTION);
  };
}

test("复制备用说法只写入备用文本，并记录一次复制反馈", async (t) => {
  const writes = [];
  const feedback = [];
  mockGlobals(t, {
    navigator: { clipboard: { writeText: async (text) => { writes.push(text); } } },
    fetch: async (url, init) => {
      if (url.endsWith("/suggest")) return response(SUGGESTION);
      assert.ok(url.endsWith("/feedback"), `意外请求：${url}`);
      feedback.push(JSON.parse(init.body));
      return response({ ok: true });
    },
  });
  const client = await loadClient();
  input(client.render()).props.onChange({ target: { value: CUSTOMER_TEXT } });
  await button(client.render(), "发送").props.onClick();
  await button(client.render(), "复制备用说法").props.onClick();
  assert.deepEqual(writes, [SUGGESTION.suggestion.alternative_reply]);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].kind, "copied");
  assert.match(content(client.render()), /已复制备用说法/);
});

test("手动生成失败保留客户输入，重试成功不重复记录同一句对话", async (t) => {
  let calls = 0;
  const attempts = [];
  mockGlobals(t, {
    fetch: async (_url, init) => {
      attempts.push(JSON.parse(init.body));
      return ++calls === 1 ? response({ ok: false, error: "连接暂时中断" }, 503) : response(SUGGESTION);
    },
  });
  const client = await loadClient();
  input(client.render()).props.onChange({ target: { value: CUSTOMER_TEXT } });
  await button(client.render(), "发送").props.onClick();
  let tree = client.render();
  assert.equal(input(tree).props.value, CUSTOMER_TEXT);
  assert.equal(button(tree, "发送").props.disabled, false);
  assert.match(content(find(tree, (node) => node.props?.role === "alert", "应显示生成失败提示")), /连接暂时中断/);
  await button(tree, "发送").props.onClick();
  tree = client.render();
  assert.equal(input(tree).props.value, "");
  assert.equal(calls, 2);
  assert.ok(attempts[0].turn_id);
  assert.equal(attempts[1].turn_id, attempts[0].turn_id, "失败重试必须沿用原轮次身份");
  assert.equal(nodes(tree).filter((node) => node.props?.["data-message-role"] === "user").length, 1);
});

test("中文输入法组合期间的 Enter 不提交或阻止确认候选词", async (t) => {
  let calls = 0;
  let prevented = 0;
  mockGlobals(t, { fetch: async () => { calls += 1; return response(SUGGESTION); } });
  const client = await loadClient();
  input(client.render()).props.onChange({ target: { value: CUSTOMER_TEXT } });
  const textarea = input(client.render());
  for (const composing of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
    textarea.props.onKeyDown(enter({ ...composing, preventDefault() { prevented += 1; } }));
  }
  assert.equal(calls, 0);
  assert.equal(prevented, 0);
  assert.equal(input(client.render()).props.value, CUSTOMER_TEXT);
  textarea.props.onKeyDown(enter({ preventDefault() { prevented += 1; } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "输入法结束后普通 Enter 应正常提交");
  assert.equal(prevented, 1);
  assert.equal(input(client.render()).props.value, "");
});

test("生成请求尚未结束时快速点击和按 Enter 只发出一次请求", async (t) => {
  let calls = 0;
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  mockGlobals(t, { fetch: async () => { calls += 1; return pending; } });
  const client = await loadClient();
  input(client.render()).props.onChange({ target: { value: CUSTOMER_TEXT } });
  const tree = client.render();
  const submit = button(tree, "发送").props.onClick;
  const first = submit();
  const second = submit();
  input(tree).props.onKeyDown(enter());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "即使 React 尚未重绘，ref 锁也应阻止重复请求");
  assert.equal(button(client.render(), "分析中…").props.disabled, true);
  resolveRequest(response(SUGGESTION));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(nodes(client.render()).filter((node) => node.props?.["data-message-role"] === "user").length, 1);
  assert.equal(input(client.render()).props.value, "");
});

test("两轮客户/助手历史都保留，并把首轮反馈绑定到首轮建议", async (t) => {
  const secondText = "如果只是偶尔使用，是不是不太划算？";
  const second = {
    ...SUGGESTION,
    suggestion_id: "suggestion-second",
    suggestion: {
      ...SUGGESTION.suggestion,
      recommended_reply: "第二轮建议：我们一起确认你的使用频率。",
      customer_assessment: "客户透露使用频率较低，希望避免闲置。",
      communication_goal: "确认客户实际使用频率，再判断方案是否合适。",
    },
  };
  const suggestions = [];
  const feedback = [];
  const copied = [];
  mockGlobals(t, {
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith("/suggest")) {
        suggestions.push(body);
        return response(suggestions.length === 1 ? SUGGESTION : second);
      }
      assert.ok(url.endsWith("/feedback"), `意外请求：${url}`);
      feedback.push(body);
      return response({ ok: true });
    },
  });
  const client = await loadClient();
  input(client.render()).props.onChange({ target: { value: CUSTOMER_TEXT } });
  await button(client.render(), "发送").props.onClick();
  input(client.render()).props.onChange({ target: { value: secondText } });
  await button(client.render(), "发送").props.onClick();
  const tree = client.render();
  const users = nodes(tree).filter((node) => node.props?.["data-message-role"] === "user");
  const assistants = nodes(tree).filter((node) => node.props?.["data-message-role"] === "assistant");
  assert.equal(users.length, 2);
  assert.equal(assistants.length, 2);
  assert.match(content(users[0]), /这个价格有点贵/);
  assert.match(content(users[1]), /偶尔使用/);
  assert.ok(content(assistants[0]).includes(SUGGESTION.suggestion.recommended_reply));
  assert.ok(content(assistants[1]).includes(second.suggestion.recommended_reply));
  for (const field of ["customer_assessment", "communication_goal", "strategy"]) {
    assert.ok(content(assistants[0]).includes(SUGGESTION.suggestion[field]), `首轮应显示策略字段 ${field}`);
  }
  assert.equal(assistants[0].props["data-for-turn"], users[0].props["data-turn-id"]);
  assert.equal(assistants[1].props["data-for-turn"], users[1].props["data-turn-id"]);
  assert.ok(Array.isArray(suggestions[1].history), "后续分析请求应携带原始对话历史");
  assert.ok(suggestions[1].history.some((turn) => turn.speaker === "customer" && turn.text === CUSTOMER_TEXT));
  assert.equal(suggestions[0].turn_id, users[0].props["data-turn-id"]);
  assert.equal(suggestions[1].turn_id, users[1].props["data-turn-id"]);
  assert.equal(suggestions[1].history[0].turn_id, suggestions[0].turn_id);
  assert.ok(suggestions[1].history.every((turn) => ["customer", "sales", "unknown"].includes(turn.speaker)), "历史不能把助手推断作为客户事实发送");
  const firstId = assistants[0].props["data-suggestion-id"];
  const secondId = assistants[1].props["data-suggestion-id"];
  assert.equal(firstId, SUGGESTION.suggestion_id);
  assert.equal(secondId, second.suggestion_id);
  await button(assistants[0], "复制话术").props.onClick();
  assert.deepEqual(copied, [SUGGESTION.suggestion.recommended_reply], "历史消息的复制应使用该轮话术，不能复制最新回应");
  assert.equal(feedback[0].suggestion_id, firstId);
  assert.notEqual(feedback[0].suggestion_id, secondId);
  const firstCard = find(client.render(), (node) => node.props?.["data-suggestion-id"] === firstId, "首轮助手卡应保留");
  await button(firstCard, "采用建议").props.onClick();
  assert.equal(feedback.length, 2);
  assert.equal(feedback[1].suggestion_id, firstId);
  assert.equal(feedback[1].kind, "accepted");
  const updated = nodes(client.render()).filter((node) => node.props?.["data-message-role"] === "assistant");
  const accepted = find(updated[0], (node) => node.type === "button" && /^已采用/.test(content(node)), "首轮采用反馈应独立显示成功状态");
  assert.equal(accepted.props.disabled, true);
  assert.equal(button(updated[1], "采用建议").props.disabled, false);
});

test("未加载插件造成的非 JSON 404 显示可操作的连接说明", async (t) => {
  mockGlobals(t, { fetch: async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError("Unexpected token <"); } }) });
  const { exported } = await loadClient();
  await assert.rejects(exported.__internals.request("knowledge"), (error) => {
    assert.match(error.message, /e销宝服务尚未加载/);
    assert.match(error.message, /重新检查连接/);
    assert.match(error.message, /重启易宝工坊/);
    assert.doesNotMatch(error.message, /HTTP 404|Unexpected token/);
    return true;
  });
});

test("普通语音输入结束时补交 0.5 秒音频，只填草稿，发送后才分析", async (t) => {
  const audio = fakeAudio();
  const suggestions = [];
  const transcriptions = [];
  const transcript = "我想知道这个产品是否适合偶尔使用。";
  mockGlobals(t, { navigator: audio.navigator, fetch: voiceFetch(suggestions) });
  const client = await loadClient({ effects: true, AudioContext: audio.AudioContext, remoteSpeech: speechRemote(async (request) => {
    transcriptions.push(request);
    return transcript;
  }) });
  t.after(client.unmount);
  await button(client.render(), "语音输入").props.onClick();
  audio.push(0.5, 0.12);
  assert.equal(transcriptions.length, 0, "录音尚未停顿时不应丢弃或提前切走短片段");
  await button(client.render(), "结束录音").props.onClick();
  assert.equal(transcriptions.length, 1);
  const wav = Buffer.from(transcriptions[0].audioBase64, "base64");
  assert.equal(wav.readUInt32LE(40), 16000, "末尾 0.5 秒应作为完整 16 kHz PCM16 WAV 提交");
  assert.equal(transcriptions[0].providerId, "test-local");
  assert.equal(transcriptions[0].language, "zh");
  assert.equal(suggestions.length, 0, "普通语音输入不应自动发送客户原话");
  const tree = client.render();
  assert.equal(input(tree).props.value, transcript);
  assert.equal(nodes(tree).filter((entry) => entry.props?.["data-message-role"] === "user").length, 0);
  assert.ok(audio.streams[0].track.stopped, "结束录音后必须释放音轨");
  assert.ok(audio.contexts[0].closed, "结束录音后必须关闭音频上下文");
  await button(tree, "发送").props.onClick();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].utterance, transcript);
  assert.equal(input(client.render()).props.value, "");
});

test("持续监听自动分析完整语音片段，取消识别后晚到的下一段不会产生消息", async (t) => {
  const audio = fakeAudio();
  const suggestions = [];
  let calls = 0;
  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  mockGlobals(t, { navigator: audio.navigator, fetch: voiceFetch(suggestions) });
  const client = await loadClient({ effects: true, AudioContext: audio.AudioContext, remoteSpeech: speechRemote(async () => {
    calls += 1;
    return calls === 1 ? "我觉得这个价格有点贵。" : late;
  }) });
  t.after(client.unmount);
  await button(client.render(), "持续监听").props.onClick();
  audio.push(0.5, 0.12);
  audio.push(0.75, 0);
  await tick();
  assert.equal(calls, 1);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].utterance, "我觉得这个价格有点贵。");
  assert.equal(input(client.render()).props.value, "", "持续监听的已识别片段进入对话而不是占用草稿");
  audio.push(0.5, 0.12);
  audio.push(0.75, 0);
  await tick();
  assert.equal(calls, 2);
  const stopping = button(client.render(), "暂停监听").props.onClick();
  button(client.render(), "取消识别").props.onClick();
  resolveLate("这句晚到的转写应被取消。");
  await stopping;
  await tick();
  const tree = client.render();
  assert.equal(suggestions.length, 1);
  assert.equal(nodes(tree).filter((entry) => entry.props?.["data-message-role"] === "user").length, 1);
  assert.doesNotMatch(content(tree), /这句晚到的转写/);
  assert.ok(audio.streams[0].track.stopped);
  assert.ok(audio.contexts[0].closed);
});

test("离开持续监听面板会停止录音，晚到转写不填草稿或自动生成消息", async (t) => {
  const audio = fakeAudio();
  const suggestions = [];
  let calls = 0;
  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  mockGlobals(t, { navigator: audio.navigator, fetch: voiceFetch(suggestions) });
  const client = await loadClient({ effects: true, AudioContext: audio.AudioContext, remoteSpeech: speechRemote(async () => { calls += 1; return late; }) });
  t.after(client.unmount);
  await button(client.render(), "持续监听").props.onClick();
  audio.push(0.5, 0.12);
  audio.push(0.75, 0);
  await tick();
  assert.equal(calls, 1);
  client.render({ active: false });
  assert.ok(audio.streams[0].track.stopped, "退出面板须马上释放音轨，无需等待 ASR 响应");
  assert.ok(audio.contexts[0].closed);
  resolveLate("已经离开的会话不应新增这一句。");
  await tick();
  const tree = client.render();
  assert.equal(suggestions.length, 0);
  assert.equal(input(tree).props.value, "");
  assert.equal(nodes(tree).filter((entry) => entry.props?.["data-message-role"] === "user").length, 0);
  assert.doesNotMatch(content(tree), /已经离开的会话不应新增/);
});
