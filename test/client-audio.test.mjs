import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function captureClass() {
  let definition;
  const window = { __ModuleLoader__: { load(value) { definition = value; } } };
  new Function("window", await readFile(new URL("../lib/client.js", import.meta.url), "utf8"))(window);
  return definition.factory(() => ({})).__internals.PcmCapture;
}

test("语音输入结束时提交不足一段的末尾，并先停止实际麦克风再等待识别", async () => {
  const PcmCapture = await captureClass();
  const received = [];
  let complete;
  const recognition = new Promise((resolve) => { complete = resolve; });
  let microphoneStopped = false;
  const capture = new PcmCapture({ onSegment: (audio, seconds) => {
    assert.equal(microphoneStopped, true);
    received.push({ audio, seconds });
    return recognition;
  } });
  capture.sourceRate = 16000;
  capture.stream = { getTracks: () => [{ stop() { microphoneStopped = true; } }] };
  capture.append(new Float32Array(8000).fill(0.2));
  assert.equal(received.length, 0);
  let finished = false;
  const finishing = capture.finish().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(received.length, 1);
  assert.equal(received[0].seconds, 0.5);
  assert.equal(Buffer.from(received[0].audio, "base64").byteLength, 44 + 8000 * 2);
  complete();
  await finishing;
  assert.equal(capture.stopped, true);
});

test("语音停顿触发提交，持续讲话不会在四秒处截断", async () => {
  const PcmCapture = await captureClass();
  const received = [];
  const capture = new PcmCapture({ onSegment: (_audio, seconds) => { received.push(seconds); } });
  capture.sourceRate = 16000;
  capture.append(new Float32Array(16000 * 5).fill(0.2));
  assert.equal(received.length, 0);
  capture.append(new Float32Array(16000));
  assert.deepEqual(received, [6]);
  await capture.finish();
  assert.equal(received.length, 1, "结束时不应再次提交已识别的段落");
});

test("取消录音丢弃末尾片段，结束静音不提交识别", async () => {
  const PcmCapture = await captureClass();
  const received = [];
  const options = { onSegment: () => received.push(true) };
  const cancelled = new PcmCapture(options);
  cancelled.sourceRate = 16000;
  cancelled.append(new Float32Array(8000).fill(0.2));
  cancelled.stop();
  await cancelled.finish();
  const silent = new PcmCapture(options);
  silent.sourceRate = 16000;
  silent.append(new Float32Array(16000));
  await silent.finish();
  assert.deepEqual(received, []);
});

test("持续声音在最大录音长度提交，避免等待无穷延长", async () => {
  const PcmCapture = await captureClass();
  const received = [];
  const capture = new PcmCapture({ onSegment: (_audio, seconds) => received.push(seconds) });
  capture.sourceRate = 16000;
  capture.append(new Float32Array(16000 * 12).fill(0.2));
  assert.deepEqual(received, [12]);
  capture.stop();
});
