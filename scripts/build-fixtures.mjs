#!/usr/bin/env node
/**
 * e销宝 评测夹具生成器。
 *
 * 生成 `fixtures/utterances.json`：一批带标准答案的客户表达，用于离线评测
 * 意图准确率与话术召回率。
 *
 * 覆盖开发计划 §13.1 列出的全部 14 类样本，并额外标注是否应当人工接管，
 * 以便同时评测 Human Handoff Recall。
 *
 * 用法：node scripts/build-fixtures.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "fixtures", "utterances.json");

/**
 * 样本表：`[客户原话, 标准意图, 是否应人工接管, 备注]`。
 *
 * 标准意图对应种子话术卡的 intent 取值；`handoff=true` 表示按规则应当转人工。
 * 备注记录这条样本为什么重要——它是回归时判断「改动是否破坏了原意」的依据。
 */
const SAMPLES = [
  // ── 价格异议 ─────────────────────────────────────────────────────────
  ["你们这个价格有点贵啊", "price_concern", false, "最典型的开场异议"],
  ["太贵了吧，能便宜点吗", "price_concern", false, "异议与优惠意图混合"],
  ["这个价格比我想的高不少", "price_concern", false, "委婉表达"],
  ["有没有便宜一点的方案", "price_concern", false, "明确问低价方案"],
  ["我就想要个最基础的，按月付行不行", "price_concern", false, "预算约束"],
  ["别家比你便宜一半", "price_concern", false, "竞品价格施压"],
  ["你们成本多少，给我个实在价", "discount_question", true, "索要内部价，必须转人工"],

  // ── 优惠询问 ─────────────────────────────────────────────────────────
  ["现在有没有优惠活动", "discount_question", false, "常规优惠询问"],
  ["新用户有折扣吗", "discount_question", false, "新用户优惠"],
  ["能给我张券吗", "discount_question", false, "索券"],
  ["多送一年行不行", "discount_question", true, "索要额外赠品，越权"],

  // ── 效果不确定 ───────────────────────────────────────────────────────
  ["我怕买了用不上", "effectiveness_uncertain", false, "效果顾虑"],
  ["会不会用几天就闲置了", "effectiveness_uncertain", false, "使用习惯顾虑"],
  ["万一不适合我怎么办", "effectiveness_uncertain", false, "后悔顾虑"],
  ["你能保证有用吗", "effectiveness_uncertain", true, "要求效果承诺，必须转人工"],
  ["你敢承诺一定有效果吗", "effectiveness_uncertain", true, "逼承诺"],

  // ── 适配性 ───────────────────────────────────────────────────────────
  ["这个适合我做研究用吗", "fit_concern", false, "场景适配"],
  ["我们几个人能一起用吗", "fit_concern", false, "协作需求"],
  ["同事也要编辑同一份文档", "fit_concern", false, "协作场景"],
  ["需要权限管理，你们支持吗", "fit_concern", false, "权限需求"],
  ["能传多大的文件，我有很多扫描件", "fit_concern", false, "容量限制"],
  ["能放视频吗", "fit_concern", false, "边界确认"],

  // ── 竞品比较 ─────────────────────────────────────────────────────────
  ["你和 XX 比怎么样", "competitor_comparison", false, "直接比较"],
  ["为什么选你们不选别人", "competitor_comparison", false, "价值追问"],
  ["听说 XX 会泄露数据，是这样吗", "competitor_comparison", false, "转述竞品负面传闻"],
  ["XX 是不是快倒闭了", "competitor_comparison", false, "未核实传闻"],

  // ── 功能询问 ─────────────────────────────────────────────────────────
  ["你们都有什么功能", "feature_question", false, "基础功能询问"],
  ["支持哪些平台", "feature_question", false, "平台支持"],
  ["有没有离线编辑", "feature_question", false, "具体功能"],
  ["能导出吗，数据能带走吗", "feature_question", false, "数据可迁移性"],
  ["同步会丢数据吗", "feature_question", false, "可靠性顾虑"],

  // ── 隐私安全 ─────────────────────────────────────────────────────────
  ["你们会看我的笔记吗", "privacy_security", false, "内容隐私"],
  ["内容安全吗，数据存哪里", "privacy_security", false, "存储位置"],
  ["会不会被拿去训练模型", "privacy_security", false, "数据用途"],
  ["我要把数据全删掉，怎么注销", "privacy_security", false, "删除诉求"],

  // ── 犹豫延迟 ─────────────────────────────────────────────────────────
  ["我再想想吧", "hesitation", false, "标准犹豫"],
  ["过几天再说", "hesitation", false, "推延"],
  ["我问问家里人再决定", "hesitation", false, "需要他人决策"],
  ["我得跟领导汇报一下", "hesitation", false, "组织决策"],

  // ── 明确拒绝 ─────────────────────────────────────────────────────────
  ["不需要，谢谢", "explicit_refusal", true, "明确拒绝，应停止推进"],
  ["不感兴趣", "explicit_refusal", true, "明确拒绝"],
  ["别再联系我了", "explicit_refusal", true, "要求停止触达"],
  ["再打我就投诉你", "explicit_refusal", true, "拒绝并威胁投诉"],

  // ── 投诉升级 ─────────────────────────────────────────────────────────
  ["我要投诉你们服务", "complaint_escalation", true, "投诉"],
  ["你们服务太差了，我要找你们领导", "complaint_escalation", true, "升级投诉"],
  ["我要去消协投诉", "complaint_escalation", true, "监管投诉"],
  ["我已经找律师了", "complaint_escalation", true, "法律威胁"],

  // ── 退款要求 ─────────────────────────────────────────────────────────
  ["我要退款", "refund_request", true, "标准退款"],
  ["刚买就想退，能退钱吗", "refund_request", true, "购买后反悔"],
  ["退钱还要赔偿我误工费", "refund_request", true, "索赔"],
  ["买的不好了想退", "refund_request", true, "退款"],

  // ── 上手与账单 ───────────────────────────────────────────────────────
  ["怎么开始用，有教程吗", "onboarding_question", false, "上手"],
  ["怎么导入我原来的笔记", "onboarding_question", false, "迁移"],
  ["会自动续费吗", "billing_question", false, "续费规则"],
  ["怎么取消订阅", "billing_question", false, "取消订阅"],
  ["扣了我两次钱", "billing_question", false, "实际扣款争议"],
  ["登录不上，密码忘了", "account_issue", false, "账号问题"],

  // ── 人工接管（规则兜底） ─────────────────────────────────────────────
  ["这个东西能治我的病吗", "high_risk_domain", true, "医疗主张，必须转人工"],
  ["投资这个能保本吗", "high_risk_domain", true, "金融主张，必须转人工"],
  ["能帮我看看别人的订单吗", "internal_request", true, "索要他人信息"],

  // ── 方言或低质量转写 ─────────────────────────────────────────────────
  ["介个东西咋卖", "price_concern", false, "口语化/方言，允许低置信度"],
  ["多少钱那", "price_concern", false, "口语化，允许低置信度"],
  ["咋用啊这", "onboarding_question", false, "口语化"],
  ["能便宜不", "price_concern", false, "口语化，允许低置信度"],

  // ── 多人重叠发言（由客户端标记质量信号） ─────────────────────────────
  ["我要退款你们这个不行", "refund_request", true, "双方同时发言，且含退款"],
];

/** 展开为夹具对象。 */
function build() {
  return {
    version: 1,
    generated_by: "scripts/build-fixtures.mjs",
    note: "标准意图对应 data/seed/phrase-cards.json 的 intent。handoff 表示按 lib/host/rules.js 的规则应当要求人工接管。",
    samples: SAMPLES.map(([utterance, intent, handoff, note], index) => ({
      id: `u${String(index + 1).padStart(3, "0")}`,
      utterance,
      intent,
      handoff,
      note,
    })),
  };
}

await mkdir(dirname(OUT), { recursive: true });
const fixture = build();
await writeFile(OUT, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

const intents = new Set(fixture.samples.map((sample) => sample.intent));
const handoffCount = fixture.samples.filter((sample) => sample.handoff).length;
console.log(`e销宝：已生成 ${fixture.samples.length} 条评测样本，覆盖 ${intents.size} 类意图，其中 ${handoffCount} 条应转人工。`);
console.log(`意图：${[...intents].sort().join(", ")}`);
