/**
 * 语音 Remote 桥接回归。使用平台真实的 RemoteResult/SpeechCatalog 外形，
 * 从 apply 注册的右侧 slot 取 bridge，无需渲染 React 或启动麦克风。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const CLIENT_PATH = new URL("../lib/client.js", import.meta.url);
const PROVIDER_ID = "sensevoice-local";
const LANGUAGE = "en";
const TRANSCRIPT = { text: "The price is a little high.", audioSeconds: 4, inferenceSeconds: 0.12 };

const success = (value) => ({ ok: true, value });
const failure = (message) => ({ ok: false, error: { code: "gateway/internal", message, details: {} } });

function provider(id = PROVIDER_ID, preparation = { phase: "ready" }, location = "host-local") {
  return { id, name: "SenseVoiceSmall", location, languages: ["auto", "zh", "en"], preparation };
}

function catalog(preparation = { phase: "ready" }, patch = {}) {
  return {
    providers: [provider(PROVIDER_ID, preparation)],
    selection: { providerId: PROVIDER_ID, language: LANGUAGE },
    maxAudioBytes: 4_000_000,
    maxDurationSeconds: 60,
    ...patch,
  };
}

/** 局部注入轮询 timer，不修改任何进程全局，也不等待真实下载时长。 */
function timers() {
  const scheduled = new Map();
  let nextId = 0;
  return {
    setTimeout(callback) {
      const id = ++nextId;
      scheduled.set(id, true);
      queueMicrotask(() => {
        if (scheduled.delete(id)) callback();
      });
      return id;
    },
    clearTimeout(id) { scheduled.delete(id); },
  };
}

async function loadBridge(remote) {
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  const timer = timers();
  new Function("window", "setTimeout", "clearTimeout", await readFile(CLIENT_PATH, "utf8"))(window, timer.setTimeout, timer.clearTimeout);
  const react = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: Symbol("Fragment") };
  const exported = definition.factory((specifier) => {
    assert.equal(specifier, "react");
    return react;
  });
  const slots = new Map();
  let detachSpeech;
  const dispose = exported.apply({
    slots: {
      inject(_name, callback) { return callback(); },
      register(meta, component) { slots.set(meta.name, component); return () => undefined; },
    },
    inject(names, callback) {
      if (!names.includes("remote.speech")) return () => undefined;
      detachSpeech = callback({ get: (name) => name === "remote.speech" ? remote : undefined });
      return detachSpeech;
    },
  });
  const { bridge } = slots.get("sidebar.right.pane.tab")({}).props;
  return { speech: bridge.speech, dispose() { detachSpeech?.(); dispose(); } };
}

test("语音桥解包 catalog/prepare/transcribe，并固定准备时选定的识别器与语言", async (t) => {
  const calls = { catalog: 0, prepare: [], transcribe: [] };
  let changedSelection = false;
  const bridge = await loadBridge({
    async catalog(...args) {
      assert.equal(args.length, 0, "speech/catalog 不接受业务参数");
      calls.catalog += 1;
      if (changedSelection) return success(catalog({ phase: "ready" }, {
        providers: [provider(), provider("other-cloud", { phase: "ready" }, "cloud")],
        selection: { providerId: "other-cloud", language: "zh" },
      }));
      return success(catalog({ phase: calls.catalog === 1 ? "unprepared" : "ready" }));
    },
    async prepare(...args) {
      assert.equal(args.length, 2, `client api: speech/prepare expected 2 argument(s), got ${args.length}`);
      calls.prepare.push(args);
      return success(undefined);
    },
    async transcribe(...args) {
      assert.equal(args.length, 2, "speech/transcribe 接收一个转写请求和一个取消信号");
      assert.ok(args[1] instanceof AbortSignal);
      calls.transcribe.push(args);
      return success(TRANSCRIPT);
    },
  });
  t.after(bridge.dispose);
  const prepared = await bridge.speech.prepare({ signal: new AbortController().signal });
  assert.equal(prepared.providerId, PROVIDER_ID);
  assert.equal(prepared.language, LANGUAGE);
  assert.equal(calls.prepare.length, 1);
  assert.equal(calls.prepare[0][0], PROVIDER_ID);
  assert.deepEqual(calls.prepare[0][1], {}, "显式传入空准备选项，满足平台的两个参数槽位");
  assert.ok(calls.prepare[0][1]?.language === undefined, "prepare 的协议选项没有 language 字段");
  changedSelection = true;
  const signal = new AbortController().signal;
  const transcript = await bridge.speech.transcribe("WAV_BASE64", 4, signal);
  assert.deepEqual(transcript, TRANSCRIPT, "转写结果应解包为 Transcript");
  assert.equal(calls.transcribe.length, 1);
  assert.deepEqual(calls.transcribe[0][0], { audioBase64: "WAV_BASE64", providerId: PROVIDER_ID, language: LANGUAGE });
});

for (const method of ["catalog", "prepare", "transcribe"]) {
  test(`${method} 的 Remote 错误保留原始 message`, async (t) => {
    const message = `${method}：连接已断开，请检查语音服务`;
    let catalogCalls = 0;
    const bridge = await loadBridge({
      async catalog() {
        catalogCalls += 1;
        return method === "catalog" ? failure(message) : success(catalog({ phase: catalogCalls === 1 ? "unprepared" : "ready" }));
      },
      async prepare() { return method === "prepare" ? failure(message) : success(undefined); },
      async transcribe() { return method === "transcribe" ? failure(message) : success(TRANSCRIPT); },
    });
    t.after(bridge.dispose);
    if (method === "transcribe") {
      await bridge.speech.prepare();
      await assert.rejects(bridge.speech.transcribe("WAV_BASE64", 4), (error) => error.message.includes(message));
    } else {
      await assert.rejects(bridge.speech.prepare(), (error) => error.message.includes(message));
    }
  });
}

test("语音提供方确实为空时准确提示，并且不启动准备或转写", async (t) => {
  let prepared = 0;
  let transcribed = 0;
  const bridge = await loadBridge({
    async catalog() { return success(catalog({ phase: "ready" }, { providers: [], selection: { providerId: "", language: "zh" } })); },
    async prepare() { prepared += 1; return success(undefined); },
    async transcribe() { transcribed += 1; return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  await assert.rejects(bridge.speech.prepare(), /没有.*语音|未注册语音|无.*语音.*提供|未.*语音.*提供/);
  assert.equal(prepared, 0);
  assert.equal(transcribed, 0);
});

test("所选识别器已不存在时拒绝开始，不能回退到列表首个云端识别器", async (t) => {
  const calls = [];
  const bridge = await loadBridge({
    async catalog() { return success(catalog({ phase: "ready" }, {
      providers: [provider("first-cloud", { phase: "ready" }, "cloud")],
      selection: { providerId: "removed-local", language: "zh" },
    })); },
    async prepare(id) { calls.push(["prepare", id]); return success(undefined); },
    async transcribe(request) { calls.push(["transcribe", request]); return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  await assert.rejects(bridge.speech.prepare(), /选择|选中|所选|已选/);
  assert.deepEqual(calls, [], "没有用户选定的识别器时不能使用第一项并外送音频");
});

test("prepare RPC 只启动后台任务，桥接须继续检查 catalog 到 ready", async (t) => {
  let polls = 0;
  let prepareCalls = 0;
  const progress = [];
  const phases = ["unprepared", "loading", "loading", "ready"];
  const bridge = await loadBridge({
    async catalog() {
      const phase = phases[Math.min(polls++, phases.length - 1)];
      return success(catalog(phase === "loading" ? { phase, startedAt: Date.now() } : { phase }));
    },
    async prepare() { prepareCalls += 1; return success(undefined); },
    async transcribe() { return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  const selected = await bridge.speech.prepare({ onProgress: (value) => progress.push(value) });
  assert.equal(selected.providerId, PROVIDER_ID);
  assert.equal(polls, 4, "RemoteResult<void> 成功不能提前当作模型已准备好");
  assert.equal(prepareCalls, 1);
  assert.ok(progress.length > 0, "准备过程应能向 UI 报告状态");
});

test("后台准备失败显示 Host 失败原因，不继续轮询或转写", async (t) => {
  let polls = 0;
  let transcribed = 0;
  const message = "模型校验失败：下载文件不完整";
  const bridge = await loadBridge({
    async catalog() {
      polls += 1;
      return success(catalog(polls === 1 ? { phase: "unprepared" } : { phase: "failed", message }));
    },
    async prepare() { return success(undefined); },
    async transcribe() { transcribed += 1; return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  await assert.rejects(bridge.speech.prepare(), (error) => error.message.includes(message));
  assert.equal(polls, 2);
  assert.equal(transcribed, 0);
});

test("准备轮询中的 Remote catalog 错误也保留原始原因", async (t) => {
  let polls = 0;
  const message = "准备期间语音连接断开";
  const bridge = await loadBridge({
    async catalog() { return ++polls === 1 ? success(catalog({ phase: "unprepared" })) : failure(message); },
    async prepare() { return success(undefined); },
    async transcribe() { return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  await assert.rejects(bridge.speech.prepare(), (error) => error.message.includes(message));
  assert.equal(polls, 2);
});

test("退出语音准备会停止客户端轮询，不启动转写", async (t) => {
  let polls = 0;
  let transcribed = 0;
  const controller = new AbortController();
  const bridge = await loadBridge({
    async catalog() {
      polls += 1;
      return success(catalog(polls === 1 ? { phase: "unprepared" } : { phase: "loading", startedAt: Date.now() }));
    },
    async prepare() { return success(undefined); },
    async transcribe() { transcribed += 1; return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  await assert.rejects(bridge.speech.prepare({
    signal: controller.signal,
    onProgress() { controller.abort(new Error("用户已离开语音面板")); },
  }), /用户已离开语音面板/);
  assert.equal(polls, 2);
  await assert.rejects(bridge.speech.transcribe("WAV_BASE64", 4, controller.signal), /用户已离开语音面板/);
  assert.equal(transcribed, 0);
});

test("已处于 standby 的本地识别器可直接使用，不重新启动后台准备", async (t) => {
  let prepareCalls = 0;
  const bridge = await loadBridge({
    async catalog() { return success(catalog({ phase: "standby" })); },
    async prepare() { prepareCalls += 1; return success(undefined); },
    async transcribe() { return success(TRANSCRIPT); },
  });
  t.after(bridge.dispose);
  assert.deepEqual(await bridge.speech.prepare(), { providerId: PROVIDER_ID, language: LANGUAGE });
  assert.equal(prepareCalls, 0);
});
