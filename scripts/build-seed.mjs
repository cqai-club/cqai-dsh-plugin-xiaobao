#!/usr/bin/env node
/**
 * e销宝 种子知识生成器。
 *
 * 本脚本把一份紧凑的卡片表展开为完整的话术卡与产品事实库，写入
 * `data/seed/`。保留脚本的理由是可维护性：新增一个场景只需在表里加一条，
 * 而不是手抄 15 个字段。
 *
 * 生成产物是**可直接编辑的 JSON**，用户应在配置页里按自己的真实产品替换
 * 内容后再审核发布——种子数据只是让插件开箱可用，不是可信的业务事实。
 *
 * 用法：node scripts/build-seed.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEED_DIR = join(ROOT, "data", "seed");

/** 种子内容的统一生效时间与审核人标记。 */
const EFFECTIVE_FROM = "2026-10-01T00:00:00+08:00";
const UPDATED_AT = "2026-10-01T00:00:00+08:00";
const REVIEWED_BY = "seed-fixture";
const PRODUCT_ID = "jianji-pro";

/**
 * 产品事实库。
 *
 * 这是价格、优惠、退款、交付与能力边界的**唯一权威来源**。话术卡只能通过
 * `evidence_refs` 引用它们，不能自带数字。
 */
const FACTS = [
  {
    id: "pricing-policy-v3",
    topic: "pricing",
    statement: "简记 Pro 提供个人版与家庭版两种订阅。",
    details: [
      "个人版 98 元/年，限 1 个账号使用。",
      "家庭版 168 元/年，最多 5 个账号共享。",
      "按月订阅为个人版 12 元/月。",
      "价格与套餐内容以官网结算页显示为准。",
    ],
  },
  {
    id: "trial-policy-v2",
    topic: "trial",
    statement: "新用户可以免费试用 14 天，试用期无需绑定支付方式。",
    details: [
      "试用期内功能与付费版一致。",
      "试用到期后自动回到免费版，不会自动扣费。",
    ],
  },
  {
    id: "discount-policy-v3",
    topic: "discount",
    statement: "当前公开优惠只有新用户首年 8 折。",
    details: [
      "首年 8 折仅限首次订阅，且不能与其他优惠叠加。",
      "除此之外不存在其他公开折扣、内部价或限时活动。",
      "销售人员无权给出未在本条声明中的任何折扣。",
    ],
    escalation: "suggest",
  },
  {
    id: "refund-policy-v3",
    topic: "refund",
    statement: "订阅后 7 天内未使用付费专享功能可以申请全额退款。",
    details: [
      "7 天从支付成功时刻起算。",
      "已使用付费专享功能的订单按剩余订阅期比例退款。",
      "退款申请需要提供订单号，由客服在 3 个工作日内处理。",
      "退款与赔付的最终判定权在客服，销售人员不得当场承诺结果。",
    ],
    escalation: "required",
  },
  {
    id: "delivery-policy-v2",
    topic: "delivery",
    statement: "简记 Pro 是数字订阅，支付成功后立即开通，没有物流环节。",
    details: [
      "账号权益在支付成功后通常 1 分钟内生效。",
      "若 10 分钟后仍未生效，需要联系客服核查订单。",
    ],
  },
  {
    id: "support-policy-v2",
    topic: "support",
    statement: "售后支持为工作日 9:00 到 18:00 在线客服。",
    details: [
      "非工作时间的留言会在下一个工作日处理。",
      "账号安全与数据问题优先处理。",
    ],
  },
  {
    id: "privacy-policy-v3",
    topic: "privacy",
    statement: "笔记内容在客户端加密后上传，服务端不保存明文笔记。",
    details: [
      "同步传输使用 TLS，静态存储使用服务端加密。",
      "平台不读取、不分析、不出售用户笔记内容。",
      "用户可以随时导出全部数据为 Markdown，也可以删除账号与全部数据。",
      "数据处理的具体范围以隐私政策页面为准。",
    ],
  },
  {
    id: "feature-core-v4",
    topic: "feature",
    statement: "简记 Pro 的核心能力是笔记、双向链接、标签、全平台同步与离线编辑。",
    details: [
      "支持 Windows、macOS、iOS、Android 与网页版。",
      "支持导出为 Markdown 与 PDF。",
      "离线编辑的内容会在恢复网络后自动合并。",
    ],
  },
  {
    id: "feature-limit-v2",
    topic: "feature_limit",
    statement: "简记 Pro 有两条明确的能力边界。",
    details: [
      "单个附件上限 200MB。",
      "个人版与家庭版都不提供团队协作权限管理，那属于企业版能力。",
    ],
  },
  {
    id: "sync-limit-v2",
    topic: "reliability",
    statement: "同步服务承诺月度可用性 99.5%。",
    details: [
      "这是服务等级目标，不是对个人用户的赔偿承诺。",
      "偶发的同步延迟通常在几分钟内自行恢复。",
    ],
    escalation: "suggest",
  },
  {
    id: "competitor-policy-v2",
    topic: "competitor",
    statement: "我们不在销售沟通中评价竞品的价格与缺陷。",
    details: [
      "可以客观说明简记 Pro 自己的功能与限制。",
      "不得声称竞品存在未经核实的安全问题或数据泄露。",
    ],
    escalation: "suggest",
  },
  {
    id: "forbidden-claims-v3",
    topic: "compliance",
    statement: "以下表达在任何销售沟通中都不允许出现。",
    details: [
      "不许承诺「保证有效」「一定有效」「百分之百」。",
      "不许编造限时优惠、虚假截止日期或虚假稀缺。",
      "不许承诺未在政策中声明的折扣、赠品或赔付。",
      "不许声称笔记内容绝对不可能丢失。",
    ],
    escalation: "required",
    forbidden_claims: [
      "保证有效",
      "一定有效",
      "百分之百",
      "绝对安全",
      "绝对不会丢失",
      "限时最后一天",
      "仅此一次",
      "内部价",
      "成本价",
    ],
  },
].map((fact) => ({
  product_id: PRODUCT_ID,
  status: "approved",
  version: 1,
  effective_from: EFFECTIVE_FROM,
  expires_at: null,
  reviewed_by: REVIEWED_BY,
  updated_at: UPDATED_AT,
  // 每条事实都必须能回答「依据来自哪里」——没有来源的事实不能作为权威依据。
  source: `种子政策文档 / ${fact.topic}`,
  // 默认不升级；需要人工介入的条目在表里显式声明。
  escalation: "none",
  ...fact,
}));

/**
 * 话术卡紧凑表。
 *
 * 每条一行，字段含义见开发计划 §6.2。`utterances` 是对应的客户原话样本，
 * 检索层用它们做相似度召回，因此写得越贴近真实表达，召回越准。
 */
const CARDS = [
  {
    intent: "price_concern",
    scenario: "价格异议：觉得整体偏贵",
    // 含口语化与方言变体：真实通话里客户常省字、带语气词，这些变体直接决定
    // 检索能否命中，因此和书面表达同等重要。
    utterances: [
      "你们这个价格有点贵", "太贵了吧", "这个价格是不是有点高", "比我想的贵不少",
      "介个东西咋卖", "多少钱那", "咋卖啊", "这个多少钱",
    ],
    responses: [
      "我理解，价格确实是购买前要考虑的因素。你主要是预算超出预期，还是还不确定它值不值这个价？",
    ],
    followups: ["你平时主要用它来做哪类记录？", "你现在用的是免费工具还是已经付费的工具？"],
    goal: "区分预算问题与价值不确定，避免直接降价",
    evidence: ["pricing-policy-v3", "trial-policy-v2"],
    risk: "medium",
    escalation: "none",
    stage: ["first_contact", "comparison", "objection"],
  },
  {
    intent: "price_concern",
    scenario: "价格异议：想找更便宜的方案",
    utterances: ["有没有便宜一点的", "有没有更划算的", "我就想要个最基础的", "按月付行不行", "能便宜不", "便宜点行不行"],
    responses: [
      "有的。个人版 98 元一年，也可以按月 12 元；如果你只是想先试，14 天试用不需要绑卡。",
    ],
    followups: ["你更在意总价低，还是想先短期试一下？"],
    goal: "提供更低门槛的选项，而不是打折",
    evidence: ["pricing-policy-v3", "trial-policy-v2"],
    risk: "low",
    escalation: "none",
    stage: ["objection", "comparison"],
  },
  {
    intent: "price_concern",
    scenario: "价格异议：拿竞品更低价施压",
    utterances: ["别家比你便宜一半", "XX 才几十块", "同样的功能人家更便宜", "你能做到那个价吗"],
    responses: [
      "我不评价别的产品定价。简记 Pro 目前的公开价格是个人版 98 元一年，家庭版 168 元一年，没有其他折扣。你可以先试用 14 天，看功能是否对得上你的需求再决定。",
    ],
    followups: ["你在别的产品上主要用哪些功能？我可以对着说清楚这边有没有。"],
    goal: "不评价竞品、不承诺折扣，把话题拉回需求匹配",
    evidence: ["pricing-policy-v3", "competitor-policy-v2", "discount-policy-v3"],
    risk: "medium",
    escalation: "none",
    stage: ["comparison", "objection"],
  },
  {
    intent: "discount_question",
    scenario: "优惠询问：有没有折扣",
    utterances: ["有没有优惠", "打个折吧", "有什么活动吗", "新用户有优惠吗", "能给个券吗"],
    responses: [
      "新用户首年 8 折是目前唯一的公开优惠，不能和其他优惠叠加。除此之外我没有其他折扣可以给。",
    ],
    followups: ["你是准备现在就订，还是想先试用看看？"],
    goal: "如实说明唯一公开优惠，不制造虚假稀缺",
    evidence: ["discount-policy-v3", "pricing-policy-v3"],
    risk: "medium",
    escalation: "none",
    stage: ["objection", "closing"],
  },
  {
    intent: "discount_question",
    scenario: "优惠询问：索要内部价或额外赠品",
    utterances: ["给我个内部价", "你们成本多少", "多送一年行不行", "私下给我便宜点"],
    responses: [
      "价格是统一的，我没有权限给内部价或者额外赠送。我能做的是帮你确认现在这个方案是否真的适合你。",
    ],
    followups: ["你主要是想控制预算，还是担心买了用不上？"],
    goal: "明确拒绝越权承诺，并转向需求确认",
    evidence: ["discount-policy-v3", "forbidden-claims-v3"],
    risk: "high",
    escalation: "required",
    stage: ["objection"],
  },
  {
    intent: "effectiveness_uncertain",
    scenario: "效果不确定：担心买来用不上",
    utterances: ["我怕买了用不上", "会不会用几天就闲置了", "我不确定能不能坚持用", "万一不适合我怎么办"],
    responses: [
      "这个担心很实际。可以先走 14 天免费试用，不用绑卡；试用到期会自动回到免费版，不会扣费。你先确认它能不能进到你的日常习惯里，再决定要不要订。",
    ],
    followups: ["你现在是怎么记录这些东西的？", "你希望它每天大概占你多少时间？"],
    goal: "用零风险的试用替代效果承诺",
    evidence: ["trial-policy-v2", "feature-core-v4", "forbidden-claims-v3"],
    risk: "medium",
    escalation: "none",
    stage: ["objection", "closing"],
  },
  {
    intent: "effectiveness_uncertain",
    scenario: "效果不确定：要求保证有效",
    utterances: ["你能保证有用吗", "保证我用了就有效果吗", "你敢承诺吗"],
    responses: [
      "我不能保证效果，这取决于你怎么用它，我不会给你一个做不到的承诺。我能确定的是功能范围和支持方式，也可以先让你试用 14 天自己判断。",
    ],
    followups: ["你希望它解决的具体问题是什么？我对着功能说清楚哪些能覆盖。"],
    goal: "拒绝效果承诺，同时不失去对话",
    evidence: ["forbidden-claims-v3", "trial-policy-v2"],
    risk: "high",
    escalation: "required",
    stage: ["objection"],
  },
  {
    intent: "fit_concern",
    scenario: "适配性：不确定是否适合自己的用法",
    utterances: ["这个适合我吗", "我做研究的能不能用", "我主要是想管理项目", "适不适合学生用"],
    responses: [
      "要看具体用法。简记 Pro 的核心是笔记、双向链接、标签和全平台同步，适合以文字记录为主的人。你主要是记录，还是需要管理任务进度和协作？",
    ],
    followups: ["你现在的记录主要是文字，还是有很多图片和表格？", "需不需要和别人一起编辑？"],
    goal: "先问清场景再判断匹配度，不硬推",
    evidence: ["feature-core-v4", "feature-limit-v2"],
    risk: "low",
    escalation: "none",
    stage: ["need_discovery", "comparison"],
  },
  {
    intent: "fit_concern",
    scenario: "适配性：需要团队协作",
    utterances: ["能几个人一起用吗", "团队协作支持吗", "同事也要编辑同一份", "需要权限管理"],
    responses: [
      "家庭版最多 5 个账号共享，但它没有团队协作的权限管理，那属于企业版能力。如果你的核心需求是多人权限，个人版和家庭版都不合适，我不想让你买了才发现这一点。",
    ],
    followups: ["你们大概几个人用？需要区分查看和编辑权限吗？"],
    goal: "如实说明能力边界，宁可不成单也不误导",
    evidence: ["feature-limit-v2", "pricing-policy-v3"],
    risk: "medium",
    escalation: "suggest",
    stage: ["need_discovery", "comparison"],
  },
  {
    intent: "fit_concern",
    scenario: "适配性：附件与容量限制",
    utterances: ["能传多大的文件", "我有很多扫描件", "单个文件有上限吗", "能放视频吗"],
    responses: [
      "单个附件上限是 200MB，所以大视频不适合放进来；扫描件和普通文档没问题。你的文件主要是哪一类，大概多大？",
    ],
    followups: ["你单个文件最大大概多少？"],
    goal: "用明确上限提前排除不适合的场景",
    evidence: ["feature-limit-v2"],
    risk: "low",
    escalation: "none",
    stage: ["need_discovery", "comparison"],
  },
  {
    intent: "competitor_comparison",
    scenario: "竞品比较：直接问哪家好",
    utterances: ["你和 XX 比怎么样", "为什么选你们不选别人", "XX 是不是更好", "你们比别人强在哪"],
    responses: [
      "我不评价别家产品。就简记 Pro 说，它的特点是笔记加双向链接，五个平台都能用，支持离线编辑和导出 Markdown，限制是附件 200MB、没有团队权限管理。你可以拿这几点对照你的需求。",
    ],
    followups: ["你最看重的是哪一点？同步、链接，还是导出？"],
    goal: "只陈述自身有依据的事实，不贬低竞品",
    evidence: ["competitor-policy-v2", "feature-core-v4", "feature-limit-v2"],
    risk: "medium",
    escalation: "none",
    stage: ["comparison"],
  },
  {
    intent: "competitor_comparison",
    scenario: "竞品比较：转述竞品的负面传闻",
    utterances: ["听说 XX 会泄露数据", "XX 是不是要倒闭了", "XX 被曝过安全问题吧"],
    responses: [
      "这个我没有核实过，不便评论别家的情况。我只能说简记 Pro 这边：笔记在客户端加密后上传，服务端不保存明文笔记，你可以导出全部数据。",
    ],
    followups: ["你比较在意的是数据归属还是服务稳定性？"],
    goal: "拒绝传播未核实信息，只讲自身可验证事实",
    evidence: ["competitor-policy-v2", "privacy-policy-v3"],
    risk: "high",
    escalation: "suggest",
    stage: ["comparison"],
  },
  {
    intent: "feature_question",
    scenario: "功能询问：核心能力",
    utterances: ["都有什么功能", "能做什么", "支持哪些平台", "有没有离线编辑"],
    responses: [
      "核心是笔记、双向链接、标签、全平台同步和离线编辑，Windows、macOS、iOS、Android 和网页版都有，可以导出 Markdown 和 PDF。",
    ],
    followups: ["你平时主要在电脑上还是手机上记？"],
    goal: "按已审核事实说明能力，不夸大",
    evidence: ["feature-core-v4"],
    risk: "low",
    escalation: "none",
    stage: ["first_contact", "need_discovery"],
  },
  {
    intent: "feature_question",
    scenario: "功能询问：导出与数据带走",
    utterances: ["能导出吗", "数据能带走吗", "以后不想用了怎么办", "支持 Markdown 吗"],
    responses: [
      "可以随时导出全部数据为 Markdown，也可以导出 PDF。不想用了就删账号和全部数据，不会把你锁在里面。",
    ],
    followups: ["你现在用的工具能导出吗？迁移过来大概是多大体量？"],
    goal: "用可导出的能力降低迁移顾虑",
    evidence: ["feature-core-v4", "privacy-policy-v3"],
    risk: "low",
    escalation: "none",
    stage: ["need_discovery", "objection"],
  },
  {
    intent: "feature_question",
    scenario: "功能询问：同步可靠性",
    utterances: ["同步会丢数据吗", "同步稳定吗", "会不会同步冲突", "多设备同时改怎么办"],
    responses: [
      "同步服务的目标是月度可用性 99.5%，多设备离线编辑的内容会在恢复网络后自动合并。我不能承诺绝不丢失，所以建议你也保留定期导出。",
    ],
    followups: ["你一般同时用几台设备？"],
    goal: "给出可验证指标，拒绝绝对化承诺",
    evidence: ["sync-limit-v2", "forbidden-claims-v3"],
    risk: "medium",
    escalation: "none",
    stage: ["objection", "comparison"],
  },
  {
    intent: "privacy_security",
    scenario: "隐私安全：担心内容被读取",
    utterances: ["你们会看我的笔记吗", "内容安全吗", "数据存哪里", "会不会被拿去训练"],
    responses: [
      "笔记在客户端加密后上传，服务端不保存明文笔记；平台不读取、不分析、也不出售你的内容。传输用 TLS，存储有服务端加密。具体范围以隐私政策页面为准。",
    ],
    followups: ["你是要记工作内容还是私人内容？"],
    goal: "用可核对的机制回答，不做绝对化保证",
    evidence: ["privacy-policy-v3", "forbidden-claims-v3"],
    risk: "high",
    escalation: "suggest",
    stage: ["objection", "comparison"],
  },
  {
    intent: "privacy_security",
    scenario: "隐私安全：要求删除数据",
    utterances: ["我要把数据全删掉", "怎么注销账号", "能不能彻底删除", "删除后你们还留着吗"],
    responses: [
      "可以在账号设置里删除账号与全部数据。具体保留期限与删除范围以隐私政策为准，如果需要确认删除结果，我可以帮你转接客服核实。",
    ],
    followups: ["你是要删部分内容还是整个账号？"],
    goal: "给出路径，涉及删除范围不确定时转客服核实",
    evidence: ["privacy-policy-v3", "support-policy-v2"],
    risk: "medium",
    escalation: "suggest",
    stage: ["after_sales", "objection"],
  },
  {
    intent: "hesitation",
    scenario: "犹豫延迟：想再考虑一下",
    utterances: ["我再想想", "过几天再说", "先看看再说", "我考虑考虑"],
    responses: [
      "没问题，不用急着定。你可以先用 14 天试用，不绑卡；试用期间你就能判断合不合适。需要的话我把今天说的价格和限制整理一句给你留底。",
    ],
    followups: ["你现在最不确定的是哪一点？价格、功能还是使用习惯？"],
    goal: "识别犹豫的真实原因，提供低压力下一步",
    evidence: ["trial-policy-v2", "pricing-policy-v3"],
    risk: "low",
    escalation: "none",
    stage: ["closing", "objection"],
  },
  {
    intent: "hesitation",
    scenario: "犹豫延迟：明确说要问别人",
    utterances: ["我问问家里人", "要和同事商量一下", "我得跟领导汇报"],
    responses: [
      "应该的。要不要我把价格、试用方式和两条能力边界整理成几句话，方便你直接转给他们看？",
    ],
    followups: ["他们最可能关心哪一点？我提前说清楚，免得你来回解释。"],
    goal: "帮助客户把决策信息带回去，而不是催单",
    evidence: ["pricing-policy-v3", "feature-limit-v2"],
    risk: "low",
    escalation: "none",
    stage: ["closing"],
  },
  {
    intent: "explicit_refusal",
    scenario: "明确拒绝：表示不需要",
    utterances: ["不需要", "不感兴趣", "别再推荐了", "我们用不上"],
    responses: [
      "好的，不打扰你。如果以后需要再说，我这边随时可以帮你确认功能和价格。",
    ],
    followups: [],
    goal: "尊重拒绝，立即停止推进",
    evidence: [],
    risk: "medium",
    escalation: "suggest",
    stage: ["closing"],
  },
  {
    intent: "explicit_refusal",
    scenario: "明确拒绝：要求不再联系",
    utterances: ["不要再打了", "别再联系我了", "再打我就投诉", "把我从名单里删掉"],
    responses: [
      "明白，我记下来，之后不再联系你。如果这次让你觉得被打扰了，我向你道歉。",
    ],
    followups: [],
    goal: "立即停止触达并记录，不做挽留",
    evidence: [],
    risk: "high",
    escalation: "required",
    stage: ["closing"],
  },
  {
    intent: "complaint_escalation",
    scenario: "投诉升级：表达不满",
    utterances: ["我要投诉", "你们服务太差了", "我要找你们领导", "这什么态度"],
    responses: [
      "抱歉给你带来不好的体验，这个我需要转给客服主管处理。我先把你遇到的情况和订单信息记下来，交接过去，由专人跟进。",
    ],
    followups: ["方便说一下大概是什么时候发生的吗？我好一并交接。"],
    goal: "立即转人工，不在线争辩或承诺处理结果",
    evidence: ["support-policy-v2"],
    risk: "high",
    escalation: "required",
    stage: ["after_sales"],
  },
  {
    intent: "complaint_escalation",
    scenario: "投诉升级：提及法律或监管",
    utterances: ["我要去消协投诉", "我要起诉你们", "找律师了", "12315 见"],
    responses: [
      "我理解你的顾虑，这类问题我无权处理，需要由专门团队对接。我现在就把你的诉求和相关信息转过去。",
    ],
    followups: [],
    goal: "停止自行处理，立即转人工，不做任何承诺",
    evidence: ["forbidden-claims-v3"],
    risk: "high",
    escalation: "required",
    stage: ["after_sales"],
  },
  {
    intent: "refund_request",
    scenario: "退款要求：购买后想退",
    utterances: ["我要退款", "能退钱吗", "买的不好了想退", "刚买就想退"],
    responses: [
      "退款需要按政策判定，我不能当场给你结果。订阅后 7 天内未使用付费专享功能可以申请全额退款；我需要把你的订单号和情况转给客服处理。",
    ],
    followups: ["你的订单号方便提供一下吗？"],
    goal: "说明政策，立即转人工，不承诺结果",
    evidence: ["refund-policy-v3"],
    risk: "high",
    escalation: "required",
    stage: ["after_sales"],
  },
  {
    intent: "refund_request",
    scenario: "退款要求：要求额外赔付",
    utterances: ["退钱还要赔偿", "耽误我事了得赔", "赔我误工费", "得给补偿"],
    responses: [
      "赔付不在我的处理范围内，我不能承诺任何金额。这个需要由客服团队按流程评估，我现在就转过去。",
    ],
    followups: [],
    goal: "明确无权限，立即转人工",
    evidence: ["refund-policy-v3", "forbidden-claims-v3"],
    risk: "high",
    escalation: "required",
    stage: ["after_sales"],
  },
  {
    intent: "onboarding_question",
    scenario: "上手问题：怎么开始",
    utterances: ["怎么开始用", "第一次用要做什么", "怎么导入我原来的笔记", "有教程吗", "咋用啊这", "这东西咋用"],
    responses: [
      "先用 14 天试用，不绑卡。装好之后如果要把原来的笔记迁过来，可以先把旧工具的内容导出成 Markdown，再批量导入。",
    ],
    followups: ["你现在用的是什么工具？我可以对着说迁移方式。"],
    goal: "给出可执行的起步路径",
    evidence: ["trial-policy-v2", "feature-core-v4"],
    risk: "low",
    escalation: "none",
    stage: ["first_contact", "closing"],
  },
  {
    intent: "billing_question",
    scenario: "账单问题：扣费与续费",
    utterances: ["会自动续费吗", "怎么取消订阅", "扣了我两次钱", "到期会自己扣吗"],
    responses: [
      "试用期结束会回到免费版，不会自动扣费。续费与取消都在账号设置里管理。如果出现重复扣费，属于账单核实，我转客服帮你查。",
    ],
    followups: ["你是想确认续费规则，还是已经看到具体的扣款记录？"],
    goal: "说明规则；出现实际扣款争议时转人工",
    evidence: ["trial-policy-v2", "support-policy-v2"],
    risk: "medium",
    escalation: "suggest",
    stage: ["after_sales", "closing"],
  },
  {
    intent: "account_issue",
    scenario: "账号问题：登录与找回",
    utterances: ["登录不上", "密码忘了", "账号被锁了", "换手机了数据没了"],
    responses: [
      "登录和找回需要核实账号归属，我不能在这里直接处理。你把注册邮箱或手机号准备好，我转客服帮你走找回流程。",
    ],
    followups: ["你还记得注册时用的邮箱或手机号吗？"],
    goal: "不在无核验的情况下处理账号，转客服",
    evidence: ["support-policy-v2"],
    risk: "medium",
    escalation: "suggest",
    stage: ["after_sales"],
  },
  {
    intent: "need_discovery",
    scenario: "需求挖掘：客户描述使用场景",
    utterances: ["我平时要记很多会议内容", "我做研究的要看很多文献", "我要整理客户资料", "我每天写工作日志"],
    responses: [
      "这类以文字记录为主的用法和它的核心能力比较对得上。你大概每天记多少条，需不需要按项目分开？",
    ],
    followups: ["这些内容你会不会需要经常回头检索？", "需不需要在不同设备之间同步？"],
    goal: "把客户描述转成可判断的需求，继续追问关键约束",
    evidence: ["feature-core-v4"],
    risk: "low",
    escalation: "none",
    stage: ["first_contact", "need_discovery"],
  },
  {
    intent: "need_discovery",
    scenario: "需求挖掘：预算与决策时间",
    // 「多少钱」「要花多少钱」也可被卡片 020 覆盖，但这里保留预算语境。
    utterances: ["预算不多", "要花多少钱", "我下个月才有预算", "先看看价格合不合适", "大概什么价位"],
    responses: [
      "个人版 98 元一年，按月 12 元；新用户首年 8 折，没有其他优惠。如果预算是主要约束，可以先按月试，或者先用 14 天试用判断值不值。",
    ],
    followups: ["你希望控制在什么范围？我看看哪个组合更合适。"],
    goal: "把预算信号转成明确选项，不擅自承诺折扣",
    evidence: ["pricing-policy-v3", "discount-policy-v3", "trial-policy-v2"],
    risk: "low",
    escalation: "none",
    stage: ["need_discovery", "closing"],
  },
];

/**
 * 展开紧凑表为完整话术卡。
 *
 * @returns 完整的话术卡数组。
 */
function buildCards() {
  return CARDS.map((spec, index) => ({
    id: `${spec.intent}_${String(index + 1).padStart(3, "0")}`,
    scenario: spec.scenario,
    intent: spec.intent,
    product_ids: [PRODUCT_ID],
    customer_utterances: spec.utterances,
    stage: spec.stage,
    response_goal: spec.goal,
    approved_responses: spec.responses,
    follow_up_questions: spec.followups,
    // 禁止表达来自已审核的合规事实，而不是逐卡手写，避免两处漂移。
    do_not_say: [
      "保证一定有效",
      "虚构限时优惠",
      "承诺未在政策中声明的折扣或赔付",
    ],
    evidence_refs: spec.evidence,
    risk_level: spec.risk,
    escalation: spec.escalation,
    status: "approved",
    version: 1,
    effective_from: EFFECTIVE_FROM,
    expires_at: null,
    reviewed_by: REVIEWED_BY,
    updated_at: UPDATED_AT,
  }));
}

/** 写出两份种子文件。 */
async function main() {
  await mkdir(SEED_DIR, { recursive: true });
  const cards = buildCards();
  await writeFile(join(SEED_DIR, "facts.json"), `${JSON.stringify(FACTS, null, 2)}\n`, "utf8");
  await writeFile(join(SEED_DIR, "phrase-cards.json"), `${JSON.stringify(cards, null, 2)}\n`, "utf8");
  const intents = new Set(cards.map((card) => card.intent));
  console.log(`e销宝：已生成 ${FACTS.length} 条产品事实、${cards.length} 张话术卡，覆盖 ${intents.size} 类意图。`);
  console.log(`意图：${[...intents].sort().join(", ")}`);
}

await main();
