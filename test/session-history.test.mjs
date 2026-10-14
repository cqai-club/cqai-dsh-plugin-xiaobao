import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { apply, mergeConversationTurns } from "../lib/index.js";
import { normalizeConversationHistory, normalizeConversationTurnId } from "../lib/shared/schemas.js";

const turn = (text, turnId, at = 1) => ({ speaker: "customer", text, at_ms: at, ...(turnId === undefined ? {} : { turn_id: turnId }) });

async function mount(t) {
  const root = await mkdtemp(join(tmpdir(), "xiaobao-history-"));
  const disposers = [];
  let handler;
  apply({
    logger: { info() {}, warn() {} },
    get() { return undefined; },
    inject() {},
    effect(factory) { const dispose = factory(); disposers.push(dispose); return dispose; },
    webServer: { register(definition) { handler = definition.handler; return () => undefined; } },
  }, { dataRoot: root });
  t.after(async () => { disposers.reverse().forEach((dispose) => dispose?.()); await rm(root, { recursive: true, force: true }); });
  let nextEvent = 0;
  async function call(action, body) {
    const request = { method: "POST", url: `/api/cqai-xiaobao/${action}`, socket: { remoteAddress: "127.0.0.1" },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ session_id: "history-test", event_id: `history-event-${++nextEvent}`, ...body })); } };
    let status;
    let payload;
    await handler(request, { writeHead(value) { status = value; }, end(value) { payload = JSON.parse(value); } });
    return { status, payload };
  }
  return { call };
}

test("稳定轮次身份保留，非法可选 turn_id 明确拒绝", () => {
  assert.deepEqual(normalizeConversationHistory([{ speaker: "customer", text: " A ", turn_id: " turn-a " }]),
    [{ speaker: "customer", text: "A", turn_id: "turn-a" }]);
  assert.equal(normalizeConversationTurnId(undefined), undefined);
  for (const invalid of [null, 123, "", "  ", "x".repeat(161)]) {
    assert.throws(() => normalizeConversationTurnId(invalid), /turn_id/);
    assert.throws(() => normalizeConversationHistory([{ speaker: "customer", text: "A", turn_id: invalid }]), /turn_id/);
  }
});

test("稳定 ID 的旧轮重试原位更新，保留后续原文及原始时间", () => {
  const saved = [turn("A", "a", 10), turn("B", "b", 20), turn("C", "c", 30)];
  const merged = mergeConversationTurns(saved, [turn("A", "a")], turn("B 已重新确认", "b", 99));
  assert.deepEqual(merged.map((entry) => entry.text), ["A", "B 已重新确认", "C"]);
  assert.deepEqual(merged.map((entry) => entry.at_ms), [10, 20, 30]);
  assert.deepEqual(saved.map((entry) => entry.text), ["A", "B", "C"], "合并不能修改传入数组");
});

test("失败轮通过后续历史补入时放在对应成功轮前面", () => {
  const merged = mergeConversationTurns([turn("A", "a"), turn("C", "c")],
    [turn("A", "a"), turn("B", "b")], turn("C", "c"));
  assert.deepEqual(merged.map((entry) => entry.turn_id), ["a", "b", "c"]);
});

test("旧无 ID 的 A/B/A/C 窗口不膨胀，截短窗口不删除后续内容", () => {
  const saved = [turn("A"), turn("B"), turn("A"), turn("C")];
  assert.deepEqual(mergeConversationTurns(saved, saved).map((entry) => entry.text), ["A", "B", "A", "C"]);
  assert.deepEqual(mergeConversationTurns(saved, [turn("A")]).map((entry) => entry.text), ["A", "B", "A", "C"]);
  assert.deepEqual(mergeConversationTurns(saved, saved, turn("C")).map((entry) => entry.text), ["A", "B", "A", "C", "C"],
    "旧调用方的新一句话不能仅因文本相同而被吞掉");
});

test("真实路由 A→失败 B→成功 C→重试 B 后，交接与复盘仍保留 C", async (t) => {
  const { call } = await mount(t);
  const a = turn("价格有点贵", "a");
  const b = turn("有没有优惠", "b");
  const c = turn("我主要是偶尔使用", "c");
  const send = (value, history) => call("suggest", { utterance: value.text, turn_id: value.turn_id, speaker: value.speaker, history });
  assert.equal((await send(a, [])).status, 200);
  assert.equal((await send(b, "invalid-history")).status, 400);
  assert.equal((await send(c, [a, b])).status, 200);
  assert.equal((await send(b, [a])).status, 200);
  const handoff = (await call("handoff", {})).payload.task;
  assert.deepEqual(handoff.customer_utterances, [a.text, b.text, c.text]);
  const report = (await call("debrief", {})).payload.report;
  assert.equal(report.customer_turns, 3);
});

test("真实路由中的同文新轮保留，稳定 ID 重试不增加客户轮次", async (t) => {
  const { call } = await mount(t);
  const a = turn("还是觉得贵", "a");
  const b = turn("还是觉得贵", "b");
  for (const [value, history] of [[a, []], [b, [a]], [b, [a]]]) {
    assert.equal((await call("suggest", { utterance: value.text, turn_id: value.turn_id, history })).status, 200);
  }
  assert.equal((await call("debrief", {})).payload.report.customer_turns, 2);
  assert.deepEqual((await call("handoff", {})).payload.task.customer_utterances, [a.text, b.text]);
});

test("真实路由兼容旧无 ID 历史，重复首句不增加额外会话记录", async (t) => {
  const { call } = await mount(t);
  const history = [];
  for (const text of ["A", "B", "A", "C", "D"]) {
    assert.equal((await call("suggest", { utterance: text, history })).status, 200);
    history.push({ speaker: "customer", text });
  }
  assert.equal((await call("debrief", {})).payload.report.customer_turns, 5);
  assert.deepEqual((await call("handoff", {})).payload.task.customer_utterances, ["A", "B", "A", "C", "D"]);
});
