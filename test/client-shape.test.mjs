/**
 * 浏览器半侧测试。
 *
 * 这里验证两件容易静默失败的事：
 * 1. **模块工厂形状**——平台按 `window.__ModuleLoader__.load({id, factory})` 加载
 *    `client.js`。形状不对时不会有任何报错，插件只是永远不出现。
 * 2. **WAV 编码**——平台 ASR 用 `validateWave` 逐字段校验头部，一个字段不对
 *    整段音频就被拒绝，而界面上只会看到「识别失败」。
 *
 * 测试用桩 `window.__ModuleLoader__` 与桩 `react`，因此不需要浏览器环境。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_PATH = join(ROOT, "lib", "client.js");

/** 足以骗过 require 的最小 react 桩；不渲染任何东西。 */
function stubReact() {
	const noop = () => undefined;
	return {
		createElement: (type, props, ...children) => ({ type, props, children }),
		Fragment: Symbol("Fragment"),
		useState: (initial) => [typeof initial === "function" ? initial() : initial, noop],
		useEffect: noop,
		useMemo: (factory) => factory(),
		useCallback: (fn) => fn,
		useRef: (initial) => ({ current: initial }),
		useId: () => "test-id",
	};
}

/** 在桩环境里加载 client.js 并返回它的导出。 */
async function loadClient() {
	const code = await readFile(CLIENT_PATH, "utf8");
	const registrations = [];
	const previousWindow = globalThis.window;
	const previousFetch = globalThis.fetch;

	globalThis.window = {
		__ModuleLoader__: {
			load(definition) {
				registrations.push(definition);
			},
		},
	};
	// request() 会用到 fetch；测试里只关心它被调用时的形状。
	globalThis.fetch = async () => ({ status: 200, json: async () => ({ ok: true }) });

	try {
		// client.js 是 CJS 形状的工厂注册脚本，用 Function 求值即可。
		const run = new Function("window", "globalThis", code);
		run(globalThis.window, globalThis);
	} finally {
		if (previousWindow === undefined) delete globalThis.window;
		else globalThis.window = previousWindow;
	}

	assert.equal(registrations.length, 1, "client.js 必须恰好注册一个模块工厂");
	const definition = registrations[0];
	assert.equal(typeof definition.factory, "function", "factory 必须是函数");

	const exports_ = definition.factory((specifier) => {
		if (specifier === "react" || specifier === "react/jsx-runtime") return stubReact();
		throw new Error(`client.js 不应 require 平台种子表之外的模块：${specifier}`);
	});

	globalThis.fetch = previousFetch;
	return { definition, exports: exports_ };
}

test("client.js 注册了正确 id 的模块工厂", async () => {
	const { definition } = await loadClient();
	assert.equal(definition.id, "cqai-dsh-plugin-xiaobao", "模块 id 必须与包名一致");
});

test("工厂导出 apply 与 inject", async () => {
	const { exports: exported } = await loadClient();
	assert.equal(typeof exported.apply, "function");
	assert.ok(Array.isArray(exported.inject), "inject 必须是数组");
	assert.ok(exported.inject.includes("slots"), "必须声明 slots 依赖");
});

test("client.js 只 require 平台种子表里的模块", async () => {
	// loadClient 的 require 桩会对任何非 react 的请求抛错，
	// 因此走到这里就说明没有引入种子表之外的同步依赖。
	const { exports: exported } = await loadClient();
	assert.ok(exported.__internals !== void 0, "应导出内部构造用于测试");
});

test("apply 注册了实时标签页、配置页与工作台", async () => {
	const { exports: exported } = await loadClient();

	/** 记录所有槽位注册与标签类型注册。 */
	const slotRegistrations = [];
	const tabRegistrations = [];
	const injected = [];

	// 注意：平台在注册渲染函数时把它作为第二个实参传给 register，
	// 因此桩必须接收并记录它。
	const slots = {
		inject(name, factory) {
			injected.push(name);
			const dispose = factory();
			return typeof dispose === "function" ? dispose : () => undefined;
		},
		register(definition, component) {
			slotRegistrations.push({ definition, component });
			return () => undefined;
		},
	};

	const ctx = {
		slots,
		/**
		* 模拟平台的可选服务注入：只让 lifecycle 回调跑一次，
		* 并按名字决定哪些可选服务「可用」。这里除了 sidebarRightTabs
		* 之外全部保持缺席，以验证降级路径不会抛错。
		*/
		inject(services, callback) {
			const names = Array.isArray(services) ? services : [services];
			if (names.includes("sidebarRightTabs")) {
				return callback({
					get: (key) => (key === "sidebarRightTabs" ? ctx.sidebarRightTabs : void 0),
				});
			}
			return () => undefined;
		},
		sidebarRightTabs: {
			register(definition) {
				tabRegistrations.push(definition);
				return () => undefined;
			},
		},
	};

	const dispose = exported.apply(ctx);

	// 右侧标签类型
	assert.equal(tabRegistrations.length, 1, "应注册一个右侧标签类型");
	const tab = tabRegistrations[0];
	assert.equal(tab.kind, "xiaobao", "标签 kind 必须是 xiaobao");
	assert.equal(tab.priority, "extension");
	assert.equal(typeof tab.title, "function");
	assert.ok(Array.isArray(tab.guide) && tab.guide.length === 1, "应提供一条引导入口");

	// 槽位注册
	const names = slotRegistrations.map((entry) => entry.definition.name);
	assert.ok(names.includes("sidebar.right.pane.tab"), "应注册实时陪练主体");
	assert.ok(names.includes("sidebar.right.pane.tab.title"), "应注册标签标题");
	assert.ok(names.includes("plugins.bundle.config"), "应注册插件配置页");
	assert.ok(names.includes("main"), "应注册左侧工作台");
	assert.ok(names.includes("sidebar.panellist"), "应注册左侧面板入口");

	// 配置页的 key 必须是包名，否则插件管理器不会渲染它。
	const config = slotRegistrations.find((entry) => entry.definition.name === "plugins.bundle.config");
	assert.equal(config.definition.key, "cqai-dsh-plugin-xiaobao", "配置页 key 必须是包名");

	// 标签主体的 key 必须与标签类型注册 id 一致。
	const body = slotRegistrations.find((entry) => entry.definition.name === "sidebar.right.pane.tab");
	assert.equal(body.definition.key, tab.id, "标签主体 key 必须与标签类型 id 一致");

	// 面板入口 id 必须与 main 的 key 一致，否则点了会打开空面板。
	const panel = slotRegistrations.find((entry) => entry.definition.name === "sidebar.panellist");
	const main = slotRegistrations.find((entry) => entry.definition.name === "main");
	assert.equal(panel.definition.id, main.definition.key, "左侧入口 id 必须与 main 的 key 一致");

	// 每个注册都必须有渲染函数。
	for (const entry of slotRegistrations) {
		assert.equal(typeof entry.component, "function", `${entry.definition.name} 缺少渲染函数`);
	}

	assert.equal(typeof dispose, "function", "apply 应返回清理函数");
	assert.doesNotThrow(() => dispose());
});

test("WAV 编码严格符合平台 ASR 的头字段要求", async () => {
	const { exports: exported } = await loadClient();
	const { encodeWav } = exported.__internals;

	const samples = new Float32Array(1600); // 0.1 秒
	for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 10) * 0.5;
	const bytes = encodeWav(samples);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

	assert.equal(ascii(0, 4), "RIFF");
	assert.equal(view.getUint32(4, true), bytes.length - 8, "RIFF 块长必须自洽");
	assert.equal(ascii(8, 4), "WAVE");
	assert.equal(ascii(12, 4), "fmt ");
	assert.equal(view.getUint32(16, true), 16, "fmt 块长必须是 16");
	assert.equal(view.getUint16(20, true), 1, "必须是 PCM");
	assert.equal(view.getUint16(22, true), 1, "必须是单声道");
	assert.equal(view.getUint32(24, true), 16000, "采样率必须是 16 kHz");
	assert.equal(view.getUint32(28, true), 32000, "字节率必须是 32000");
	assert.equal(view.getUint16(32, true), 2, "块对齐必须是 2");
	assert.equal(view.getUint16(34, true), 16, "位深必须是 16");
	assert.equal(ascii(36, 4), "data");
	assert.equal(view.getUint32(40, true), bytes.length - 44, "data 块长必须自洽");
	assert.equal((bytes.length - 44) % 2, 0, "样本数据必须是偶数长度");
});

test("WAV 编码对超范围采样做钳制而不是回绕", async () => {
	const { exports: exported } = await loadClient();
	const { encodeWav } = exported.__internals;

	const samples = new Float32Array([2, -2, 0]);
	const bytes = encodeWav(samples);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(view.getInt16(44, true), 32767, "超出 +1 应钳制到最大正值");
	assert.equal(view.getInt16(46, true), -32768, "低于 -1 应钳制到最小负值");
	assert.equal(view.getInt16(48, true), 0);
});

test("重采样会改变长度并保持端点", async () => {
	const { exports: exported } = await loadClient();
	const { resample } = exported.__internals;

	const input = new Float32Array(48000); // 48 kHz 下 1 秒
	const output = resample(input, 48000, 16000);
	assert.equal(output.length, 16000, "48k→16k 应得到三分之一长度");

	// 同采样率时原样返回，不做无谓拷贝。
	const same = resample(input, 16000, 16000);
	assert.equal(same, input, "采样率相同时应直接返回原数组");
});

test("静音检测能区分静音与语音", async () => {
	const { exports: exported } = await loadClient();
	const { rms } = exported.__internals;

	assert.equal(rms(new Float32Array(100)), 0, "全零应为静音");
	assert.equal(rms(new Float32Array(0)), 0, "空数组不应抛错");

	const loud = new Float32Array(100).fill(0.5);
	assert.ok(rms(loud) > 0.4, "0.5 幅值应有较高能量");
});

test("toBase64 产出标准 base64", async () => {
	const { exports: exported } = await loadClient();
	const { toBase64 } = exported.__internals;

	const bytes = new Uint8Array([1, 2, 3, 4]);
	assert.equal(toBase64(bytes), Buffer.from([1, 2, 3, 4]).toString("base64"));

	// 跨 8192 分块边界必须仍然正确。
	const large = new Uint8Array(20000);
	for (let i = 0; i < large.length; i += 1) large[i] = i % 251;
	assert.equal(toBase64(large), Buffer.from(large).toString("base64"), "大数组分块编码结果必须一致");
});

test("界面镜像的常量与 Host 侧协议一致", async () => {
	const { exports: exported } = await loadClient();
	void exported;

	// 从 Host 协议模块取真值，再从 client.js 源码里取出镜像的字面量比对。
	const protocol = await import("../lib/shared/protocol.js");
	const code = await readFile(CLIENT_PATH, "utf8");

	assert.ok(code.includes(`"${protocol.ROUTE_PREFIX}"`), `client.js 里的路由前缀必须与协议一致：${protocol.ROUTE_PREFIX}`);
	assert.ok(code.includes(`"${protocol.TAB_KIND}"`), `缺省标签 kind 必须与协议一致：${protocol.TAB_KIND}`);
	assert.ok(code.includes(`"${protocol.TAB_ID}"`), `标签 id 必须与协议一致：${protocol.TAB_ID}`);
	assert.ok(code.includes(`"${protocol.PLUGIN_ID}"`), `包名必须与协议一致：${protocol.PLUGIN_ID}`);
	assert.ok(code.includes(`"${protocol.WORKBENCH_PANEL}"`), `工作台面板 id 必须与协议一致：${protocol.WORKBENCH_PANEL}`);
	assert.ok(code.includes(`VOICE_SEGMENT_MS = ${protocol.VOICE_SEGMENT_MS}`), "分段长度必须与协议一致");
	assert.ok(code.includes(`WAV_SAMPLE_RATE = ${protocol.WAV_SPEC.sampleRate}`), "采样率必须与协议一致");
});
