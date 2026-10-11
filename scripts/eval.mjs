#!/usr/bin/env node
/**
 * e销宝 离线评测。
 *
 * 在**不联网、不调用模型**的前提下，对 `fixtures/utterances.json` 的每条样本
 * 跑完整的确定性链路（意图打分 → 混合检索 → 转人工判定），并计算开发计划
 * §13.2 列出的可离线测量项：
 *
 * - Intent Accuracy
 * - Phrase Retrieval Recall@3
 * - Human Handoff Recall
 * - Forbidden Claim Rate（在确定性链路上结构性地为 0，因为不经过模型）
 * - Grounded Response Rate（有已审核依据的建议占比）
 *
 * 报告同时给出未达标样本的明细，便于针对性补话术卡。
 *
 * 用法：
 *   node scripts/eval.mjs                      # 打印并写入 docs/eval-report.md
 *   node scripts/eval.mjs --json               # 只打印 JSON
 *   node scripts/eval.mjs --fixtures <path>    # 用留出集评测
 *
 * 也可作为模块导入：`runEvaluation()` 返回结构化结果，供自检脚本复用。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { KnowledgeStore } from "../lib/host/store.js";
import { searchCards, scoreIntents } from "../lib/host/retrieval.js";
import { evaluateHandoff } from "../lib/host/rules.js";
import { RECALL_LIMIT } from "../lib/shared/protocol.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 评测用的固定时刻；必须晚于种子数据的生效时间。 */
const NOW = Date.parse("2026-10-15T10:00:00+08:00");

/** 规则层能识别的「高风险」意图，它们的标准答案不在话术卡库里。 */
const RULE_ONLY_INTENTS = new Set(["high_risk_domain", "internal_request"]);

/** 载入种子知识库（在临时目录里，绝不写入随包目录）。 */
async function loadKnowledge() {
  // 关键：store 的 root 决定审计文件写到哪里。若指向随包的 data/seed/，
  // 每次评测都会在发布产物里留下 audit.jsonl。因此用临时目录承载 store，
  // 只把种子 JSON 读进来作为内容来源。
  const scratch = await mkdtemp(join(tmpdir(), "xiaobao-eval-"));
  const store = new KnowledgeStore({ root: scratch });
  const cards = JSON.parse(await readFile(join(ROOT, "data", "seed", "phrase-cards.json"), "utf8"));
  const facts = JSON.parse(await readFile(join(ROOT, "data", "seed", "facts.json"), "utf8"));
  await store.seedIfEmpty({ cards, facts });
  return { store, scratch };
}

/** 对一个样本跑完整链路。 */
function evaluateSample(store, sample) {
  const cards = store.usableCards(NOW);
  const ranked = searchCards({ utterance: sample.utterance, limit: RECALL_LIMIT }, cards);
  const intents = scoreIntents(sample.utterance, cards);
  const topIntent = intents[0]?.intent ?? "unknown";
  const topScore = intents[0]?.score ?? 0;

  // 转人工判定：用检索命中的卡片作为上下文。
  const handoff = evaluateHandoff({
    utterance: sample.utterance,
    confidence: topScore,
    usableCardCount: ranked.length,
    cards: ranked.map((entry) => entry.card),
    nowMs: NOW,
  });

  const recalledIntents = ranked.map((entry) => entry.card.intent);
  const ruleOnly = RULE_ONLY_INTENTS.has(sample.intent);

  return {
    id: sample.id,
    utterance: sample.utterance,
    expected_intent: sample.intent,
    predicted_intent: topIntent,
    confidence: Number(topScore.toFixed(3)),
    // 规则类样本（医疗/内部信息）不要求在话术库里召回，它们由规则直接接管。
    intent_correct: ruleOnly ? handoff.required : topIntent === sample.intent,
    recall_at_3: ruleOnly ? true : recalledIntents.includes(sample.intent),
    handoff_expected: sample.handoff === true,
    handoff_actual: handoff.required === true,
    handoff_reasons: handoff.reasons,
    recalled: ranked.map((entry) => entry.card.id),
    grounded: ranked.length > 0,
    rule_only: ruleOnly,
    note: sample.note,
  };
}

/** 计算一个分数的分位数。 */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** 生成 Markdown 报告。 */
function renderReport(result) {
  const { metrics, samples, knowledge } = result;
  const failures = samples.filter((sample) => !sample.intent_correct || !sample.recall_at_3);
  const handoffMisses = samples.filter((sample) => sample.handoff_expected && !sample.handoff_actual);
  const handoffFalsePositives = samples.filter((sample) => !sample.handoff_expected && sample.handoff_actual);

  const lines = [];
  lines.push("# e销宝 离线评测报告");
  lines.push("");
  lines.push("> 本报告由 `node scripts/eval.mjs` 生成。评测**不联网、不调用模型**，");
  lines.push("> 只覆盖确定性链路（意图打分 → 混合检索 → 转人工判定）。");
  lines.push("> 涉及模型生成质量的指标（Grounded Response Rate 的最终表述、Forbidden Claim Rate）");
  lines.push("> 需要在线评测，见文末说明。");
  lines.push("");
  lines.push(`- 评测时刻：\`${new Date(NOW).toISOString()}\``);
  lines.push(`- 知识库：话术卡 ${knowledge.cards} 张，产品事实 ${knowledge.facts} 条`);
  lines.push(`- 样本数：${samples.length} 条（其中 ${samples.filter((s) => s.rule_only).length} 条为规则类样本，不要求话术召回）`);
  lines.push("");
  lines.push("## 核心指标");
  lines.push("");
  lines.push("| 指标 | 目标 | 实测 | 结论 |");
  lines.push("|---|---|---|---|");
  lines.push(`| Intent Accuracy | ≥ 90% | ${(metrics.intent_accuracy * 100).toFixed(1)}% | ${mark(metrics.intent_accuracy >= 0.9)} |`);
  lines.push(`| Phrase Retrieval Recall@3 | ≥ 85% | ${(metrics.recall_at_3 * 100).toFixed(1)}% | ${mark(metrics.recall_at_3 >= 0.85)} |`);
  lines.push(`| Human Handoff Recall | ≥ 95% | ${(metrics.handoff_recall * 100).toFixed(1)}% | ${mark(metrics.handoff_recall >= 0.95)} |`);
  lines.push(`| Grounded Response Rate（确定性链路） | ≥ 95% | ${(metrics.grounded_rate * 100).toFixed(1)}% | ${mark(metrics.grounded_rate >= 0.95)} |`);
  lines.push(`| Forbidden Claim Rate（确定性链路） | ≤ 1% | ${(metrics.forbidden_claim_rate * 100).toFixed(1)}% | ${mark(metrics.forbidden_claim_rate <= 0.01)} |`);
  lines.push("");
  lines.push(`- 人工接管误报（不该接管却接管）：${handoffFalsePositives.length} 条`);
  lines.push(`- 置信度分布：p50 = ${fmt(metrics.confidence_p50)}，p95 = ${fmt(metrics.confidence_p95)}`);
  lines.push("");

  if (failures.length > 0) {
    lines.push("## 未达标样本");
    lines.push("");
    lines.push("| 编号 | 客户原话 | 标准意图 | 预测意图 | 置信度 | 召回 | 问题 |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const sample of failures) {
      const problems = [];
      if (!sample.intent_correct) problems.push("意图错误");
      if (!sample.recall_at_3) problems.push("未召回");
      lines.push(`| ${sample.id} | ${escapeCell(sample.utterance)} | ${sample.expected_intent} | ${sample.predicted_intent} | ${sample.confidence} | ${sample.recalled.join(", ") || "空"} | ${problems.join("、")} |`);
    }
    lines.push("");
  }

  if (handoffMisses.length > 0) {
    lines.push("## 漏转人工的样本（安全风险，优先修复）");
    lines.push("");
    lines.push("| 编号 | 客户原话 | 应转人工原因 |");
    lines.push("|---|---|---|");
    for (const sample of handoffMisses) {
      lines.push(`| ${sample.id} | ${escapeCell(sample.utterance)} | ${sample.note} |`);
    }
    lines.push("");
  }

  lines.push("## 指标口径");
  lines.push("");
  lines.push("- **Intent Accuracy**：预测意图与标准意图一致的比例。质量兜底类样本（医疗、金融、");
  lines.push("  索要他人信息）的判据改为「规则是否成功接管」——这类表达本就不该走话术库。");
  lines.push("- **Phrase Retrieval Recall@3**：标准意图出现在 Top-3 召回中的比例。规则类样本计入合格。");
  lines.push("- **Human Handoff Recall**：应转人工的样本中，实际被规则判定的比例。这是安全指标，漏报比误报严重。");
  lines.push("- **Grounded Response Rate**：至少召回一张已审核话术卡的比例。真正意义上的「有依据」");
  lines.push("  还需要模型正确引用，那部分需要在线评测。");
  lines.push("- **Forbidden Claim Rate**：确定性链路不经过模型生成，因此结构性为 0；");
  lines.push("  真实的禁止承诺拦截效果由 `test/rules.test.mjs` 的单元测试证明。");
  lines.push("");
  lines.push("## 这份报告不能证明什么");
  lines.push("");
  lines.push("评测样本与种子话术卡是由同一份夹具生成的，因此**存在过拟合**：口语化变体");
  lines.push("（如「介个东西咋卖」）在开发过程中被补进了卡片示例，指标随之升到 100%。");
  lines.push("这证明的是链路可用与门禁有效，**不是**真实通话上的泛化能力。");
  lines.push("");
  lines.push("要得到有意义的泛化指标，必须用**没有参与调参**的真实客户表达复测：");
  lines.push("");
  lines.push("1. 收集 100 条以上真实通话表达（开发计划阶段 0 的交付项）；");
  lines.push("2. 用其中 50 条补卡片示例，另 50 条作为留出集；");
  lines.push("3. 只对留出集跑本脚本（`--fixtures <path>` 指定留出集）；");
  lines.push("4. 留出集上的指标才是可信的泛化指标。");
  lines.push("");
  lines.push("## 在线评测的缺口");
  lines.push("");
  lines.push("以下指标无法离线测量，需要在接入真实模型后按同样样本表复测：");
  lines.push("");
  lines.push("- 模型输出的 `source_cards` 是否全部落在候选集内（结构校验会拒绝越界，但拒绝率需要统计）；");
  lines.push("- 模型表述是否引用了事实库之外的数字（`findUnauthorizedNumbers` 的拦截率）；");
  lines.push("- 建议延迟 p50/p95；");
  lines.push("- 销售的采纳率与主观帮助度。");
  lines.push("");
  lines.push("复测方法：启用插件后在配置页「试运行与评测」粘贴 `fixtures/utterances.json` 的");
  lines.push("`utterance` 字段，逐条核对；或调用 `POST /api/cqai-xiaobao/preview`。");
  lines.push("");
  return lines.join("\n");
}

/** 通过/未通过标记。 */
function mark(ok) {
  return ok ? "达标" : "**未达标**";
}

/** 格式化可空数值。 */
function fmt(value) {
  return value === null ? "n/a" : value.toFixed(3);
}

/** 转义 Markdown 表格单元格里的竖线。 */
function escapeCell(text) {
  return String(text).replace(/\|/gu, "\\|");
}

/**
 * 跑一次完整评测并返回结构化结果。
 *
 * @param options - `{ fixturesPath }` 指定样本表；缺省用随包夹具。
 * @returns `{ metrics, knowledge, samples, fixturesPath }`。
 */
export async function runEvaluation(options = {}) {
  const { store, scratch } = await loadKnowledge();
  try {
    const fixturesPath = options.fixturesPath ?? join(ROOT, "fixtures", "utterances.json");
    const fixture = JSON.parse(await readFile(fixturesPath, "utf8"));
    const samples = fixture.samples.map((sample) => evaluateSample(store, sample));

    const total = samples.length;
    const intentCorrect = samples.filter((sample) => sample.intent_correct).length;
    const recalled = samples.filter((sample) => sample.recall_at_3).length;
    const handoffExpected = samples.filter((sample) => sample.handoff_expected);
    const handoffHit = handoffExpected.filter((sample) => sample.handoff_actual).length;
    const grounded = samples.filter((sample) => sample.grounded).length;
    const confidences = samples.map((sample) => sample.confidence);

    return {
      fixturesPath,
      metrics: {
        intent_accuracy: Number((intentCorrect / total).toFixed(4)),
        recall_at_3: Number((recalled / total).toFixed(4)),
        handoff_recall: handoffExpected.length === 0 ? 1 : Number((handoffHit / handoffExpected.length).toFixed(4)),
        grounded_rate: Number((grounded / total).toFixed(4)),
        // 确定性链路不生成文本，因此不存在禁止承诺违规。
        forbidden_claim_rate: 0,
        confidence_p50: percentile(confidences, 50),
        confidence_p95: percentile(confidences, 95),
        total,
      },
      knowledge: {
        cards: store.usableCards(NOW).length,
        facts: store.usableFacts(NOW).length,
      },
      samples,
    };
  } finally {
    // 评测用的临时知识库必须清理，避免在系统临时目录里堆积。
    await rm(scratch, { recursive: true, force: true });
  }
}

/** 主流程。 */
async function main() {
  // 允许用 --fixtures 指定留出集；默认用随包夹具。
  const flagIndex = process.argv.indexOf("--fixtures");
  const fixturesPath = flagIndex >= 0 && process.argv[flagIndex + 1] !== undefined
    ? resolve(process.argv[flagIndex + 1])
    : join(ROOT, "fixtures", "utterances.json");

  const result = await runEvaluation({ fixturesPath });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const report = renderReport(result);
  await mkdir(join(ROOT, "docs"), { recursive: true });
  // 用留出集评测时写到独立文件，避免覆盖随包夹具的报告。
  const reportName = fixturesPath === join(ROOT, "fixtures", "utterances.json")
    ? "eval-report.md"
    : "eval-report-holdout.md";
  await writeFile(join(ROOT, "docs", reportName), report, "utf8");

  console.log("e销宝 离线评测结果");
  console.log("──────────────────────────────────");
  console.log(`夹具                  ${fixturesPath}`);
  console.log(`样本数                ${result.metrics.total}`);
  console.log(`Intent Accuracy       ${(result.metrics.intent_accuracy * 100).toFixed(1)}%   （目标 ≥ 90%）`);
  console.log(`Recall@3              ${(result.metrics.recall_at_3 * 100).toFixed(1)}%   （目标 ≥ 85%）`);
  console.log(`Human Handoff Recall  ${(result.metrics.handoff_recall * 100).toFixed(1)}%   （目标 ≥ 95%）`);
  console.log(`Grounded Rate         ${(result.metrics.grounded_rate * 100).toFixed(1)}%`);
  console.log(`置信度 p50 / p95      ${fmt(result.metrics.confidence_p50)} / ${fmt(result.metrics.confidence_p95)}`);
  console.log("──────────────────────────────────");
  console.log(`报告已写入 docs/${reportName}`);

  const failures = result.samples.filter((sample) => !sample.intent_correct || !sample.recall_at_3);
  if (failures.length > 0) {
    console.log(`\n未达标样本 ${failures.length} 条：`);
    for (const sample of failures.slice(0, 20)) {
      const problems = [];
      if (!sample.intent_correct) problems.push(`意图 ${sample.predicted_intent} ≠ ${sample.expected_intent}`);
      if (!sample.recall_at_3) problems.push(`未召回（Top3：${sample.recalled.join(", ") || "空"}）`);
      console.log(`  ${sample.id}  ${sample.utterance}  → ${problems.join("；")}`);
    }
    if (failures.length > 20) console.log(`  …另有 ${failures.length - 20} 条，见报告`);
  }
}

// 仅在作为脚本直接运行时执行主流程；被 import 时只暴露 runEvaluation。
// 用 realpath 比较，避免符号链接或大小写差异导致误判。
if (process.argv[1] !== undefined) {
  const { realpath } = await import("node:fs/promises");
  const [self, invoked] = await Promise.all([
    realpath(fileURLToPath(import.meta.url)).catch(() => fileURLToPath(import.meta.url)),
    realpath(resolve(process.argv[1])).catch(() => resolve(process.argv[1])),
  ]);
  if (self === invoked) await main();
}
