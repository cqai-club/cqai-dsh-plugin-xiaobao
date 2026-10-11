#!/usr/bin/env node
/**
 * e销宝 交付前自检。
 *
 * 在一个命令里跑完全部可离线执行的检查，避免「测试过了但打包产物坏了」这类
 * 只在安装后才暴露的问题：
 *
 * 1. 所有 JS 产物的语法检查；
 * 2. 插件清单与产物的一致性（package.json / dsh.plugin.json / cordis.patch.yml）；
 * 3. 客户端模块工厂的形状与依赖边界；
 * 4. 种子数据能通过校验；
 * 5. 随包技能齐全；
 * 6. 全部单元测试；
 * 7. 离线评测达标。
 *
 * 全部检查都在**本进程内**完成，不派生子进程：DSH 的 Windows 沙箱禁止
 * 无管道继承的子进程启动，用 spawn 的检查在这个环境里会以 EPERM 失败。
 * 单元测试因此通过 node:test 的编程式 API 在进程内运行。
 *
 * 用法：node scripts/selfcheck.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "node:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 检查结果收集。 */
const results = [];
function record(name, ok, detail = "") {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✓" : "✗"} ${name}${detail === "" ? "" : `  ${detail}`}`);
}

// ── 1. 语法检查 ────────────────────────────────────────────────────────────
// 用动态 import 代替 `node --check`：能在同一进程里验证语法，且真正执行模块
// 的顶层代码，比纯语法解析更强。
const ARTIFACTS = [
	"lib/shared/protocol.js",
	"lib/shared/schemas.js",
	"lib/host/retrieval.js",
	"lib/host/rules.js",
	"lib/host/store.js",
	"lib/host/coach.js",
	"lib/index.js",
];

let syntaxOk = true;
for (const file of ARTIFACTS) {
	try {
		await import(new URL(`../${file}`, import.meta.url).href);
	} catch (error) {
		syntaxOk = false;
		record(`加载 ${file}`, false, error instanceof Error ? error.message : String(error));
	}
}
record(`模块可加载（${ARTIFACTS.length} 个）`, syntaxOk);

// client.js 不是 ES 模块（它是模块工厂注册脚本），因此单独做语法解析。
const clientCode = await readFile(join(ROOT, "lib", "client.js"), "utf8");
let clientParses = true;
try {
	// 只构造函数不执行，验证语法合法性。
	new Function("window", "globalThis", clientCode);
} catch (error) {
	clientParses = false;
	record("语法 lib/client.js", false, error instanceof Error ? error.message : String(error));
}
record("语法 lib/client.js", clientParses);

// ── 2. 清单一致性 ──────────────────────────────────────────────────────────
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(ROOT, "dsh.plugin.json"), "utf8"));

record("package.json 声明 dsh.bundle.patch", pkg.dsh?.bundle?.patch === "./cordis.patch.yml", String(pkg.dsh?.bundle?.patch));
record("dsh.plugin.json 版本与 package.json 一致", manifest.version === pkg.version, `${manifest.version} vs ${pkg.version}`);
record("清单 id 与包名一致", manifest.id === pkg.name, manifest.id);
record("客户端声明 platform: web", pkg.dsh?.client?.platform === "web");
record("清单 client.main 指向客户端产物", manifest.client?.main === "./lib/client.js", String(manifest.client?.main));
record("dependencies 为空（零运行时依赖）", Object.keys(pkg.dependencies ?? {}).length === 0, JSON.stringify(pkg.dependencies ?? {}));

const patch = await readFile(join(ROOT, "cordis.patch.yml"), "utf8");
const insertCount = (patch.match(/- insert:/gu) ?? []).length;
record("cordis.patch.yml 只有一条 insert", insertCount === 1, `实际 ${insertCount} 条`);
record("cordis.patch.yml 行名与包名一致", patch.includes(`name: ${pkg.name}`));

// ── 3. 客户端模块工厂形状 ──────────────────────────────────────────────────
record("客户端以 __ModuleLoader__.load 注册", clientCode.includes("window.__ModuleLoader__.load("));
record("客户端工厂 id 与包名一致", clientCode.includes(`id: "${pkg.name}"`));
record("客户端导出 apply 与 inject", clientCode.includes("exports.apply = apply") && clientCode.includes("exports.inject = inject"));
const requires = [...clientCode.matchAll(/require\("([^"]+)"\)/gu)].map((match) => match[1]);
const allowedRequires = /^(react|react\/jsx-runtime)$/u;
const badRequires = requires.filter((entry) => !allowedRequires.test(entry));
record("客户端只 require react 种子模块", badRequires.length === 0, badRequires.join(", "));

// ── 4. 种子数据可校验 ──────────────────────────────────────────────────────
const { normalizeCard, normalizeFact } = await import("../lib/shared/schemas.js");
const seedCards = JSON.parse(await readFile(join(ROOT, "data/seed/phrase-cards.json"), "utf8"));
const seedFacts = JSON.parse(await readFile(join(ROOT, "data/seed/facts.json"), "utf8"));
let dataOk = true;
for (const card of seedCards) {
	try {
		normalizeCard(card);
	} catch (error) {
		dataOk = false;
		record(`种子卡片 ${card.id}`, false, error.message);
	}
}
for (const fact of seedFacts) {
	try {
		normalizeFact(fact);
	} catch (error) {
		dataOk = false;
		record(`种子事实 ${fact.id}`, false, error.message);
	}
}
record(`种子数据可校验（${seedCards.length} 卡 / ${seedFacts.length} 事实）`, dataOk);

// ── 5. 随包技能齐全 ────────────────────────────────────────────────────────
const { BUNDLED_SKILLS } = await import("../lib/index.js");
let skillsOk = true;
for (const skill of BUNDLED_SKILLS) {
	try {
		const content = await readFile(join(ROOT, "skills", skill.dir, "SKILL.md"), "utf8");
		if (!content.startsWith("---")) throw new Error("缺少 YAML frontmatter");
		if (content.length < 500) throw new Error("正文过短");
		if (!content.includes(`name: ${skill.dir}`)) throw new Error("frontmatter 的 name 与目录名不一致");
	} catch (error) {
		skillsOk = false;
		record(`技能 ${skill.dir}`, false, error.message);
	}
}
record(`随包技能齐全（${BUNDLED_SKILLS.length} 个）`, skillsOk);

// ── 6. 单元测试（进程内） ──────────────────────────────────────────────────
// 用 node:test 的编程式 API 跑测试目录。
//
// `isolation: 'none'` 是必需的：默认隔离模式会为每个测试文件派生一个子进程，
// 而 DSH 的 Windows 沙箱禁止无管道继承的子进程启动（EPERM）。同进程运行既能
// 绕过该限制，也符合这些测试本身无副作用的设计。
const { readdir } = await import("node:fs/promises");
const testDir = join(ROOT, "test");
const testFiles = (await readdir(testDir))
	.filter((name) => name.endsWith(".test.mjs"))
	.sort();

let passed = 0;
let failedCount = 0;
const failedNames = [];
const stream = run({
	files: testFiles.map((name) => join(testDir, name)),
	concurrency: 1,
	isolation: "none",
	timeout: 120000,
});
for await (const event of stream) {
	if (event.type === "test:pass") passed += 1;
	if (event.type === "test:fail") {
		failedCount += 1;
		const name = event.data?.name ?? "未知测试";
		// 文件级失败事件的名字是文件名；只有测试级失败才值得单列。
		if (event.data?.details?.type !== "test" || event.data?.details?.passed === false) {
			failedNames.push(name);
		}
	}
}

record(`单元测试（${testFiles.length} 个文件，通过 ${passed}，失败 ${failedCount}）`, failedCount === 0);
if (failedCount > 0) {
	for (const name of [...new Set(failedNames)].slice(0, 10)) console.log(`    ✗ ${name}`);
}

// ── 7. 离线评测 ────────────────────────────────────────────────────────────
const { runEvaluation } = await import("./eval.mjs");
const evaluation = await runEvaluation();
const metrics = evaluation.metrics;
const evalOk = metrics.intent_accuracy >= 0.9 && metrics.recall_at_3 >= 0.85 && metrics.handoff_recall >= 0.95;
record(
	`离线评测达标（意图 ${(metrics.intent_accuracy * 100).toFixed(1)}% / 召回 ${(metrics.recall_at_3 * 100).toFixed(1)}% / 接管 ${(metrics.handoff_recall * 100).toFixed(1)}%）`,
	evalOk,
);

// ── 汇总 ───────────────────────────────────────────────────────────────────
const failed = results.filter((entry) => !entry.ok);
console.log("");
if (failed.length === 0) {
	console.log(`自检通过：${results.length} 项全部通过。`);
	console.log("");
	console.log("下一步：把本目录加入 desktop Profile 后重启应用。命令见 docs/install.zh.md。");
	process.exit(0);
}
console.log(`自检未通过：${failed.length} 项失败。`);
for (const entry of failed) console.log(`  - ${entry.name}  ${entry.detail}`);
process.exit(1);
