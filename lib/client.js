window.__ModuleLoader__.load({
	id: "@cqaiclub/cqai-dsh-plugin-xiaobao",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region shared/protocol (镜像)
		/**
		* 浏览器半侧必须是一个自包含的单文件模块工厂——平台按 `/plugins/<id>/client.js`
		* 直接提供它，工厂内部只能用 `require` 拿平台种子模块（react 等）。因此这里
		* 镜像了 `lib/shared/protocol.js` 里界面真正用到的常量。
		*
		* 这些镜像值由 `test/client-shape.test.mjs` 断言与 Host 侧保持一致：任何一侧
		* 改了常量而另一侧没跟上，测试会失败。
		*/
		const PLUGIN_ID = "@cqaiclub/cqai-dsh-plugin-xiaobao";
		const ROUTE_PREFIX = "/api/cqai-xiaobao";
		const TAB_KIND = "xiaobao";
		const TAB_ID = "cqai-dsh-plugin-xiaobao/live";
		const WORKBENCH_PANEL = "cqai-xiaobao";
		const VOICE_SEGMENT_MS = 4000;
		/** 平台 ASR 只接受规范的 16 kHz 单声道 PCM16 WAV。 */
		const WAV_SAMPLE_RATE = 16000;
		/** 低于此能量的片段视为静音，不送识别，省一次推理也省一次可能的误识别。 */
		const SILENCE_RMS_THRESHOLD = 0.012;
		const CARD_STATUS_LABELS = {
			draft: "草稿",
			review: "待审核",
			approved: "已发布",
			retired: "已停用",
		};
		const RISK_LABELS = { low: "低", medium: "中", high: "高" };
		const FEEDBACK_LABELS = {
			accepted: "已采用",
			copied: "已复制",
			edited: "已修改",
			skipped: "不适用",
			ineffective: "效果不佳",
		};
		const INTENT_LABELS = {
			price_concern: "价格顾虑", need_discovery: "了解需求", competitor_comparison: "竞品比较",
			refund_request: "退款诉求", unknown: "待确认",
			account_issue: "账号问题", billing_question: "账单咨询", complaint_escalation: "投诉处理",
			discount_question: "优惠咨询", effectiveness_uncertain: "效果顾虑", explicit_refusal: "明确拒绝",
			feature_question: "功能咨询", fit_concern: "是否适合", hesitation: "还在考虑",
			onboarding_question: "使用指引", privacy_security: "隐私与安全",
		};
		function intentLabel(intent) { return INTENT_LABELS[intent] ?? intent ?? "待确认"; }
		const EXAMPLE_UTTERANCES = ["你们这个价格有点贵，有没有便宜一点的", "我不确定这个适不适合我", "我想退款，应该怎么处理"];
		function isSubmitKey(event) {
			return event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229 && event.nativeEvent?.keyCode !== 229;
		}
		function InlineIcon({ name, size = 18 }) {
			const paths = {
				mic: ["M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Z", "M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"],
				send: ["m3 11 18-8-8 18-2-8-8-2Z", "m11 13 10-10"],
				stop: ["M5 5h14v14H5z"],
				assistant: ["M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-5l-5 3v-3a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z", "M8 10h.01M16 10h.01M8 14h8"],
				user: ["M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M4 21v-2a8 8 0 0 1 16 0v2"],
				pause: ["M6 5h4v14H6zM14 5h4v14h-4z"],
				cancel: ["m6 6 12 12M18 6 6 18"],
				plus: ["M12 5v14M5 12h14"],
				book: ["M12 6v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z"],
				check: ["m5 12 4 4L19 6"],
				chevron: ["m6 9 6 6 6-6"],
			};
			const solid = name === "stop" || name === "pause";
			return react.createElement("svg", { className: "cqaiXb-icon", "data-icon": name, width: size, height: size, viewBox: "0 0 24 24", fill: solid ? "currentColor" : "none", stroke: solid ? "none" : "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0, verticalAlign: "middle" }, "aria-hidden": "true", focusable: "false" }, (paths[name] ?? paths.assistant).map((d, index) => react.createElement("path", { key: index, d })));
		}
		//#endregion

		//#region styles
		const styles = `
.cqaiXb{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit}
.cqaiXb *{box-sizing:border-box}
.cqaiXb-icon[data-icon=stop]{color:var(--dsw-alias-state-error-primary,currentColor)}
.cqaiXb-scroll{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:10px 12px 16px}
.cqaiXb-head{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.cqaiXb-title{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}
.cqaiXb-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
.cqaiXb-dot[data-state=listening]{background:var(--dsw-alias-state-success-primary)}
.cqaiXb-dot[data-state=connecting],.cqaiXb-dot[data-state=paused]{background:var(--dsw-alias-state-warn-primary)}
.cqaiXb-dot[data-state=error]{background:var(--dsw-alias-state-error-primary)}
.cqaiXb-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
.cqaiXb-tag[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.cqaiXb-tag[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.cqaiXb-tag[data-tone=bad]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.cqaiXb-svc{display:flex;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:11px}
.cqaiXb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px;display:grid;gap:8px;min-width:0}
.cqaiXb-card>h4{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600;letter-spacing:.02em}
.cqaiXb-quote{margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.cqaiXb-quote[data-primary=true]{font-size:14px}
.cqaiXb-turn{display:flex;gap:8px;font-size:12.5px;line-height:1.6;padding:3px 0}
.cqaiXb-who{flex:none;width:34px;color:var(--dsw-alias-label-tertiary);font-size:11px;padding-top:2px}
.cqaiXb-who[data-speaker=customer]{color:var(--dsw-alias-brand-primary)}
.cqaiXb-text{min-width:0;overflow-wrap:anywhere}
.cqaiXb-text[data-provisional=true]{color:var(--dsw-alias-label-tertiary);font-style:italic}
.cqaiXb-actions{display:flex;flex-wrap:wrap;gap:6px}
.cqaiXb button{font:inherit;cursor:pointer;min-height:28px;padding:3px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
.cqaiXb button:not([data-variant=primary]):hover:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.cqaiXb button:disabled{opacity:.45;cursor:not-allowed}
.cqaiXb button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cqaiXb button[data-variant=primary]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-inverse,#fff))}
.cqaiXb button[data-variant=danger]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.cqaiXb-risk{border-left:3px solid var(--dsw-alias-state-warn-primary);padding:6px 10px;background:var(--dsw-alias-bg-layer-2);border-radius:0 8px 8px 0;font-size:12px;line-height:1.65}
.cqaiXb-risk[data-level=high]{border-left-color:var(--dsw-alias-state-error-primary)}
.cqaiXb-risk ul{margin:4px 0 0;padding-left:18px}
.cqaiXb-risk li{margin:2px 0}
.cqaiXb-src{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.7;overflow-wrap:anywhere}
.cqaiXb-src code{font-family:ui-monospace,monospace}
.cqaiXb-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.65;margin:0}
.cqaiXb-empty{padding:16px 8px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.7}
.cqaiXb-error{margin:0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}
.cqaiXb-input,.cqaiXb-select,.cqaiXb-textarea{font:inherit;font-size:12.5px;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);width:100%;min-width:0}
.cqaiXb-textarea{min-height:60px;resize:vertical;line-height:1.6}
.cqaiXb-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cqaiXb-grid2{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.cqaiXb-foot{flex:none;display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.cqaiXb-console{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit}
.cqaiXb-tabs{flex:none;display:flex;flex-wrap:wrap;gap:14px;padding:10px 20px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cqaiXb-tab{background:none;border:0;border-bottom:2px solid transparent;padding:5px 1px 7px;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12.5px;cursor:pointer}
.cqaiXb-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}
.cqaiXb-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 28px;display:grid;gap:12px;align-content:start}
.cqaiXb-list{display:grid;gap:8px}
.cqaiXb-item{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);padding:10px 12px;display:grid;gap:6px;min-width:0}
.cqaiXb-item h5{margin:0;font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.cqaiXb-mono{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.cqaiXb-kv{display:grid;gap:4px;grid-template-columns:max-content 1fr;font-size:12px;line-height:1.6}
.cqaiXb-kv dt{color:var(--dsw-alias-label-tertiary)}
.cqaiXb-kv dd{margin:0;overflow-wrap:anywhere}
.cqaiXb-h2{margin:0 0 2px;font-size:16px}
.cqaiXb-metrics{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
.cqaiXb-metric{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2)}
.cqaiXb-metric b{display:block;font-size:18px;font-weight:600}
.cqaiXb-metric span{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.cqaiXb,.cqaiXb-console{container-type:inline-size;font-size:13px;line-height:1.6}
.cqaiXb-console *{box-sizing:border-box}
.cqaiXb-console button,.cqaiXb button{font:inherit;cursor:pointer;min-height:36px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);transition:background 120ms,border-color 120ms}
.cqaiXb-console button:not([data-variant=primary]):hover:not(:disabled),.cqaiXb button:not([data-variant=primary]):hover:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.cqaiXb-console button:disabled,.cqaiXb button:disabled{opacity:.5;cursor:not-allowed}
.cqaiXb-console button[data-variant=primary],.cqaiXb button[data-variant=primary]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-inverse,#fff))}
.cqaiXb-console button[data-variant=primary]:not(:disabled):is(:hover,:focus-visible,:active),.cqaiXb button[data-variant=primary]:not(:disabled):is(:hover,:focus-visible,:active){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-inverse,#fff))}
.cqaiXb-console button[data-variant=danger]{color:var(--dsw-alias-state-error-primary)}
.cqaiXb-console :is(button,input,textarea,select,summary):focus-visible,.cqaiXb :is(button,input,textarea,select,summary):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.cqaiXb-console [hidden],.cqaiXb [hidden]{display:none!important}
.cqaiXb-console .cqaiXb-tabs{gap:6px;padding:0 24px 12px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cqaiXb-console .cqaiXb-tab{flex:none;border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap;display:flex;align-items:center;gap:6px}
.cqaiXb-console .cqaiXb-tab[data-active=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}
.cqaiXb-hero{padding:24px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cqaiXb-brand{display:flex;gap:12px;align-items:center;min-width:0}
.cqaiXb-brandmark{width:42px;height:42px;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.cqaiXb-hero h2{font-size:20px;letter-spacing:-.02em;margin:0;font-weight:650}
.cqaiXb-hero p{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.cqaiXb-count{min-width:20px;padding:0 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);font-size:11px}
.cqaiXb-body{width:100%;margin:0;padding:22px 24px 32px;gap:16px}
.cqaiXb-panel{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.cqaiXb-body h3{margin:0;font-size:16px}
.cqaiXb-sectionhead{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.cqaiXb-toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}
.cqaiXb-field{display:grid;gap:5px;min-width:0;flex:1}
.cqaiXb-field>span,.cqaiXb-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.cqaiXb-toolbar .cqaiXb-field:first-child{flex:2;min-width:min(240px,100%)}
.cqaiXb-input,.cqaiXb-select,.cqaiXb-textarea{font-size:13px;min-height:38px;padding:8px 10px}
.cqaiXb-textarea{min-height:94px}
.cqaiXb-list{gap:12px}
.cqaiXb-item{padding:16px;gap:10px;border-radius:12px;align-content:start}
.cqaiXb-item h5{font-size:14px;line-height:1.55}
.cqaiXb-quote{font-size:14px;line-height:1.8;margin:0}
.cqaiXb-note,.cqaiXb-src{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.cqaiXb-quote[data-primary=true]{font-size:16px;line-height:1.9}
.cqaiXb-card{padding:16px;gap:12px;border-radius:12px}
.cqaiXb-card>h4{font-size:13px}
.cqaiXb-card>:is(h2,h3){margin:0;font-size:13px;color:var(--dsw-alias-label-secondary);font-weight:600}
.cqaiXb-card[data-emphasis=true]{border-color:var(--dsw-alias-brand-primary)}
.cqaiXb-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
.cqaiXb-metric{padding:14px;border-radius:10px}
.cqaiXb-metric b{font-size:22px;overflow-wrap:anywhere}
.cqaiXb-metric span{font-size:12px}
.cqaiXb-notice{padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px}
.cqaiXb-notice[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
.cqaiXb-error{font-size:13px;display:grid;gap:8px}
.cqaiXb-empty{padding:32px 16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.cqaiXb-empty strong{display:block;color:var(--dsw-alias-label-primary);font-size:15px;margin-bottom:6px}
.cqaiXb-details{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.cqaiXb-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;min-height:32px;line-height:32px}
.cqaiXb-details[open] summary{margin-bottom:8px}
.cqaiXb-confirm{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px;display:grid;gap:8px;background:var(--dsw-alias-bg-layer-1)}
.cqaiXb-examples{display:flex;flex-wrap:wrap;gap:8px}
.cqaiXb-examples button{font-size:12px;text-align:left;max-width:100%}
.cqaiXb-preview{display:grid;gap:16px;width:100%;min-width:0;margin:0}
.cqaiXb-preview .cqaiXb-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
.cqaiXb-workspace,.cqaiXb-inputColumn,.cqaiXb-results{display:grid;gap:16px;align-content:start;min-width:0}
.cqaiXb-inputLabel{font-size:13px;font-weight:600}
.cqaiXb-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cqaiXb-welcome{padding:24px;display:grid;gap:8px;text-align:center}
.cqaiXb-welcome h3{margin:0;font-size:16px}
.cqaiXb-chip{font-size:12px!important}
@container (min-width:800px){.cqaiXb[data-wide=true] .cqaiXb-workspace{grid-template-columns:minmax(240px,.8fr) minmax(0,1.2fr)}}
.cqaiXb-scroll{gap:16px;padding:16px}
.cqaiXb-foot{padding:12px 16px;gap:8px}
.cqaiXb[data-wide=true]{height:100%;min-height:0;width:100%;min-width:0;margin:0;overflow:hidden}
.cqaiXb[data-wide=true]>.cqaiXb-head{display:none}
.cqaiXb[data-wide=true] .cqaiXb-scroll{overflow:auto}
.cqaiXb[data-wide=true] .cqaiXb-head,.cqaiXb[data-wide=true] .cqaiXb-svc{background:transparent}
.cqaiXb[data-wide=true] .cqaiXb-foot{position:sticky;bottom:0;background:var(--dsw-alias-bg-layer-1)}
@container (min-width:800px){.cqaiXb-list[data-grid=true]{grid-template-columns:repeat(2,minmax(0,1fr))}.cqaiXb-metrics{grid-template-columns:repeat(6,minmax(0,1fr))}}
@container (max-width:500px){.cqaiXb-hero{padding:16px}.cqaiXb-console .cqaiXb-tabs{padding-left:16px;padding-right:16px}.cqaiXb-body{padding:16px}.cqaiXb-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cqaiXb-scroll{padding:12px}.cqaiXb-card{padding:12px}.cqaiXb-toolbar .cqaiXb-field{flex-basis:100%}}
@media (prefers-reduced-motion:reduce){.cqaiXb button,.cqaiXb-console button{transition:none}}
.cqaiXb-chat{flex:1;min-height:0;overflow:auto;position:relative;width:100%;scrollbar-gutter:stable}
.cqaiXb-thread{display:flex;flex-direction:column;gap:28px;padding:24px;width:100%;min-height:100%}
.cqaiXb-message{display:flex;align-items:flex-start;gap:12px;min-width:0;width:100%}
.cqaiXb-avatar{width:32px;height:32px;flex:none;border-radius:10px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-border-l1)}
.cqaiXb-messageHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;margin-bottom:10px;color:var(--dsw-alias-label-primary)}
.cqaiXb-messageHead strong{font-weight:600}
.cqaiXb-messageBody{min-width:0;flex:1;overflow-wrap:anywhere}
.cqaiXb-messageMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.cqaiXb-message[data-role=user] .cqaiXb-avatar{color:var(--dsw-alias-label-secondary)}
.cqaiXb-message[data-role=user] .cqaiXb-messageBody>p{display:inline-block;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:0 12px 12px;padding:12px 16px;margin:0;font-size:14px;line-height:1.8;white-space:pre-wrap;max-width:100%}
.cqaiXb-strategy{display:grid;gap:16px;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.cqaiXb-strategySection{display:grid;align-content:start;gap:5px;min-width:0}
.cqaiXb-strategySection h4{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.cqaiXb-strategySection p{margin:0;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}
.cqaiXb-strategySection[data-primary=true]{padding:14px 16px;border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.cqaiXb-strategySection[data-primary=true] p{font-size:16px}
.cqaiXb-composer{flex:none;padding:16px 24px 18px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:grid;gap:10px;min-width:0}
.cqaiXb-composeBox{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:8px}
.cqaiXb-composeBox:focus-within{border-color:var(--dsw-alias-brand-primary)}
.cqaiXb-composeBox textarea{border:0;background:transparent;min-height:60px;max-height:180px;padding:4px;font-size:14px;resize:vertical}
.cqaiXb-composeBox textarea:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.cqaiXb-composeTools{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cqaiXb-composeTools button,.cqaiXb-sessionBar button{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.cqaiXb-composeTools select{width:auto;max-width:100%;min-height:34px;font-size:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);padding:5px 8px}
.cqaiXb-sessionBar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.cqaiXb-composeMeta{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cqaiXb-listenOption{font-size:12px;color:var(--dsw-alias-label-secondary)}
.cqaiXb-listenOption summary{cursor:pointer;padding:4px 0;min-height:28px}
.cqaiXb-listenOption[open]{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);width:100%;display:grid;gap:8px}
.cqaiXb-listenOption[open] summary{font-weight:600}
.cqaiXb-strategySection ul{margin:0;padding-left:18px;font-size:13px;line-height:1.8}
.cqaiXb-chatWelcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px 12px;text-align:center;min-height:220px}
.cqaiXb-chatWelcome h2,.cqaiXb-chatWelcome h3{font-size:22px;margin:0;letter-spacing:-.02em}
.cqaiXb-chatWelcome>p{font-size:13px;margin:0;color:var(--dsw-alias-label-secondary);line-height:1.8}
.cqaiXb-chatWelcome>.cqaiXb-avatar{width:48px;height:48px;border-radius:16px}
.cqaiXb-chatWelcome .cqaiXb-examples{justify-content:center;gap:10px;margin-top:8px}
.cqaiXb-chatWelcome .cqaiXb-examples button{padding:10px 14px}
.cqaiXb-chat .cqaiXb-error,.cqaiXb-chat .cqaiXb-notice{margin:16px 24px 0}
.cqaiXb-newMessages{position:sticky;bottom:12px;align-self:center;box-shadow:0 2px 8px var(--dsw-alias-border-l1)}
@container (min-width:800px){.cqaiXb-strategy{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:24px}.cqaiXb-strategy>*{grid-column:1/-1}.cqaiXb-strategySection[data-overview=true]{grid-column:auto}}
@container (max-width:500px){.cqaiXb-thread{padding:16px;gap:20px}.cqaiXb-message{gap:8px}.cqaiXb-avatar{width:28px;height:28px;border-radius:8px}.cqaiXb-strategy{padding:14px;gap:12px}.cqaiXb-strategySection[data-primary=true]{padding:10px}.cqaiXb-composer{padding:12px;gap:8px}.cqaiXb-chatWelcome h2,.cqaiXb-chatWelcome h3{font-size:18px}.cqaiXb-chat .cqaiXb-error,.cqaiXb-chat .cqaiXb-notice{margin:12px 12px 0}.cqaiXb-composeTools{gap:6px}.cqaiXb-sessionBar{padding:8px 12px;gap:8px}}
`;
		//#endregion

		//#region http
		/**
		* 调用 Host 接口。所有请求都带同源凭据并禁用缓存：会话状态随时间变化，
		* 缓存过的建议会误导销售。
		*/
		async function request(action, init = {}) {
			const response = await fetch(`${ROUTE_PREFIX}/${action}`, {
				method: init.method ?? "GET",
				headers: init.body === void 0 ? void 0 : { "content-type": "application/json" },
				body: init.body === void 0 ? void 0 : JSON.stringify(init.body),
				cache: "no-store",
				credentials: "same-origin",
			});
			const payload = await response.json().catch(() => void 0);
			if (response.status === 404 && payload === void 0) throw new Error("e销宝服务尚未加载。请重新检查连接；若刚安装或更新插件，请重启易宝工坊后再试。");
			if (payload === void 0) throw new Error(`服务暂时无法响应（HTTP ${response.status}），请稍后重试。`);
			if (!response.ok && response.ok !== void 0) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
			if (payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
			return payload;
		}

		/** 生成本地事件 id，用于服务端幂等。 */
		function eventId(prefix) {
			return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		}
		//#endregion

		//#region voice
		/**
		* 把 16 kHz 单声道 Float32 采样编码为平台 ASR 要求的规范 WAV。
		*
		* 头部必须逐字段对上 `validateWave` 的校验，否则音频会被直接拒绝：
		* RIFF/WAVE/fmt 块长 16/audioFormat 1/单声道/16000Hz/32000Bps/块对齐 2/
		* 16 位/`data` 块，且两处长度字段都要自洽。
		*
		* @param samples - 归一化到 [-1, 1] 的采样。
		* @returns 完整 WAV 字节。
		*/
		function encodeWav(samples) {
			const dataBytes = samples.length * 2;
			const buffer = new ArrayBuffer(44 + dataBytes);
			const view = new DataView(buffer);
			const writeAscii = (offset, text) => {
				for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
			};
			writeAscii(0, "RIFF");
			view.setUint32(4, 36 + dataBytes, true);
			writeAscii(8, "WAVE");
			writeAscii(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, WAV_SAMPLE_RATE, true);
			view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			writeAscii(36, "data");
			view.setUint32(40, dataBytes, true);
			for (let i = 0; i < samples.length; i += 1) {
				const clamped = Math.max(-1, Math.min(1, samples[i]));
				view.setInt16(44 + i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
			}
			return new Uint8Array(buffer);
		}

		/** 把字节编码成 base64（平台 wire 格式，不带 data URL 前缀）。 */
		function toBase64(bytes) {
			let text = "";
			for (let i = 0; i < bytes.length; i += 8192) {
				text += String.fromCharCode(...bytes.subarray(i, i + 8192));
			}
			return btoa(text);
		}

		/** 计算一段采样的均方根能量，用于跳过静音片段。 */
		function rms(samples) {
			if (samples.length === 0) return 0;
			let sum = 0;
			for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
			return Math.sqrt(sum / samples.length);
		}

		/** 线性插值重采样。浏览器可能拒绝 16 kHz 的 AudioContext，需要兜底。 */
		function resample(input, fromRate, toRate) {
			if (fromRate === toRate) return input;
			const ratio = fromRate / toRate;
			const length = Math.max(1, Math.floor(input.length / ratio));
			const out = new Float32Array(length);
			for (let i = 0; i < length; i += 1) {
				const position = i * ratio;
				const left = Math.floor(position);
				const right = Math.min(left + 1, input.length - 1);
				const fraction = position - left;
				out[i] = input[left] * (1 - fraction) + input[right] * fraction;
			}
			return out;
		}

		/**
		* 麦克风分段采集器。
		*
		* 检测到说话后约 700 毫秒停顿时切段，持续讲话最长 12 秒；每段独立送平台 ASR。
		* 平台接受完整的规范 WAV，ASR 不保留跨段音频上下文。
		* 结束录音会补交末尾片段并等待识别，取消录音则直接丢弃。
		*
		* 卸载时必须调用 `stop()`：它会停止音轨并关闭 AudioContext，否则会留下
		* 一个持续占用麦克风的孤儿会话（开发计划 §4.3 明确禁止）。
		*/
		class PcmCapture {
			constructor(options) {
				this.onSegment = options.onSegment;
				this.onError = options.onError;
				this.segmentMs = options.segmentMs ?? VOICE_SEGMENT_MS;
				this.buffer = [];
				this.collected = 0;
				this.stopped = false;
				this.silenceMs = options.silenceMs ?? 700;
				this.maxSegmentMs = Math.max(this.segmentMs, options.maxSegmentMs ?? 12000);
				this.silentFrames = 0;
				this.hasVoice = false;
				this.pending = Promise.resolve();
			}

			/** 请求麦克风并开始采集。 */
			async start() {
				if (navigator.mediaDevices === void 0 || typeof AudioContext === "undefined") {
					throw new Error("当前环境不支持麦克风采集");
				}
				this.stream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
					video: false,
				});
				if (this.stopped) { for (const track of this.stream.getTracks()) track.stop(); this.stream = undefined; return; }

				// 优先直接以 16 kHz 建上下文，省一次重采样；不支持时回落。
				try {
					this.context = new AudioContext({ sampleRate: WAV_SAMPLE_RATE });
				} catch {
					this.context = new AudioContext();
				}
				this.sourceRate = this.context.sampleRate;

				this.source = this.context.createMediaStreamSource(this.stream);
				// 4096 帧在 16 kHz 下约 256ms，回调频率适中且不丢帧。
				this.processor = this.context.createScriptProcessor(4096, 1, 1);
				this.processor.onaudioprocess = (event) => {
					if (this.stopped) return;
					const chunk = event.inputBuffer.getChannelData(0);
					// 必须复制：inputBuffer 的底层数组会被复用。
					this.append(new Float32Array(chunk));
				};

				// ScriptProcessor 需要一个汇点才会持续触发；用静音增益避免回授。
				this.sink = this.context.createGain();
				this.sink.gain.value = 0;
				this.source.connect(this.processor);
				this.processor.connect(this.sink);
				this.sink.connect(this.context.destination);
			}

			/** 累积采样，够一段就切出去。 */
			append(chunk) {
				if (this.stopped || this.finishing) return;
				this.buffer.push(chunk);
				this.collected += chunk.length;
				if (rms(chunk) >= SILENCE_RMS_THRESHOLD) { this.hasVoice = true; this.silentFrames = 0; }
				else if (this.hasVoice) this.silentFrames += chunk.length;
				const silenceComplete = this.hasVoice && this.silentFrames >= this.sourceRate * this.silenceMs / 1000;
				const maximumComplete = this.collected >= this.sourceRate * this.maxSegmentMs / 1000;
				if (!silenceComplete && !maximumComplete) return;
				this.flush();
			}

			/** 在停顿或结束录音时提交已收集的完整片段。 */
			flush() {
				if (this.collected === 0) return this.pending;
				const merged = new Float32Array(this.collected);
				let offset = 0;
				for (const part of this.buffer) {
					merged.set(part, offset);
					offset += part.length;
				}
				this.buffer = [];
				this.collected = 0;
				this.hasVoice = false;
				this.silentFrames = 0;
				const previous = this.pending;
				const current = this.emit(merged);
				this.pending = Promise.all([previous, current]).then(() => undefined);
				return this.pending;
			}

			/** 把一段采样重采样、静音过滤后交给回调。 */
			emit(samples) {
				try {
					const resampled = resample(samples, this.sourceRate, WAV_SAMPLE_RATE);
					if (rms(resampled) < SILENCE_RMS_THRESHOLD) return; // 整段静音，不送识别。
					// 少于 0.3 秒的片段既不可靠也不值得一次推理。
					if (resampled.length < WAV_SAMPLE_RATE * 0.3) return;
					return Promise.resolve(this.onSegment(toBase64(encodeWav(resampled)), resampled.length / WAV_SAMPLE_RATE)).catch((error) => { this.onError?.(error); });
				} catch (error) {
					this.onError?.(error);
				}
			}

			/** 停止实际录音，等待末尾转写完成；取消操作仍使用 stop() 丢弃未发片段。 */
			async finish() {
				if (this.stopped) return;
				if (this.finishing) return this.finishing;
				if (this.processor) this.processor.onaudioprocess = null;
				for (const track of this.stream?.getTracks() ?? []) track.stop();
				this.finishing = this.flush();
				try { await this.finishing; } finally { this.stop(); }
			}

			/** 停止采集并释放全部媒体资源。可重复调用。 */
			stop() {
				this.stopped = true;
				if (this.processor) this.processor.onaudioprocess = null;
				for (const node of [this.processor, this.source, this.sink]) { try { node?.disconnect(); } catch {} }
				for (const track of this.stream?.getTracks() ?? []) track.stop();
				this.context?.close?.().catch(() => void 0);
				this.processor = void 0;
				this.source = void 0;
				this.sink = void 0;
				this.stream = void 0;
				this.context = void 0;
				this.buffer = [];
				this.collected = 0;
				this.hasVoice = false;
				this.silentFrames = 0;
			}
		}
		//#endregion

		//#region hooks
		/** 订阅 bridge 的能力变化（语音可用性会异步就绪）。 */
		function useBridgeVersion(bridge) {
			const [, force] = react.useState(0);
			react.useEffect(() => bridge.subscribe(() => force((value) => value + 1)), [bridge]);
		}

		/** 载入一次异步数据，带手动刷新。 */
		function useAsyncData(loader, deps) {
			const [state, setState] = react.useState({ loading: true, error: "", data: void 0 });
			const generation = react.useRef(0);
			const reload = react.useCallback(async () => {
				const current = ++generation.current;
				setState((previous) => ({ ...previous, loading: true, error: "" }));
				return loader()
					.then((data) => {
						if (current === generation.current) setState({ loading: false, error: "", data });
					})
					.catch((cause) => {
						const message = cause instanceof Error ? cause.message : String(cause);
						if (current === generation.current) setState((previous) => ({ ...previous, loading: false, error: message }));
					});
			}, deps);
			react.useEffect(() => { reload(); return () => { generation.current += 1; }; }, [reload]);
			return { ...state, reload };
		}
		//#endregion

		//#region live panel
		/** 连续销售对话：每条输入与本轮策略共同留在会话中，输入区始终可见。 */
		function LiveCoachPanel({ bridge, wide = false, active = true }) {
			useBridgeVersion(bridge);
			const service = useAsyncData(() => request("health"), []);
			const [state, setState] = react.useState("idle");
			const [speaker, setSpeaker] = react.useState("customer");
			const [manual, setManual] = react.useState("");
			const [messages, setMessages] = react.useState([]);
			const [busy, setBusy] = react.useState(false);
			const [recognizing, setRecognizing] = react.useState(false);
			const [voiceMode, setVoiceMode] = react.useState("");
			const [error, setError] = react.useState("");
			const [notice, setNotice] = react.useState("");
			const [pendingAction, setPendingAction] = react.useState("");
			const [failedUtterance, setFailedUtterance] = react.useState(null);
			const [handoffTask, setHandoffTask] = react.useState(null);
			const [debrief, setDebrief] = react.useState(null);
			const [unread, setUnread] = react.useState(false);
			const [sessionId, setSessionId] = react.useState(() => eventId("s"));
			const mounted = react.useRef(true);
			const activeRef = react.useRef(active);
			const previousActive = react.useRef(active);
			const sessionRef = react.useRef(sessionId);
			const stateRef = react.useRef(state);
			const speakerRef = react.useRef(speaker);
			const turnsRef = react.useRef([]);
			const latestBundle = react.useRef(null);
			const capture = react.useRef(null);
			const captureEpoch = react.useRef(0);
			const captureAbort = react.useRef(null);
			const voiceModeRef = react.useRef("");
			const dictationPieces = react.useRef([]);
			const recognitionQueue = react.useRef(Promise.resolve());
			const analysisQueue = react.useRef(Promise.resolve());
			const pendingRequests = react.useRef(0);
			const busyRef = react.useRef(false);
			const actionRef = react.useRef("");
			const inputRef = react.useRef(null);
			const focusAfterReset = react.useRef(false);
			const chatRef = react.useRef(null);
			const followNewest = react.useRef(true);
			activeRef.current = active;
			sessionRef.current = sessionId;
			stateRef.current = state;
			speakerRef.current = speaker;
			const changeState = react.useCallback((next) => { stateRef.current = next; setState(next); }, []);

			/** 排队生成策略。重试复用本轮消息，历史只包含客户/销售原话。 */
			const analyze = react.useCallback((text, who, options = {}) => {
				const trimmed = text.trim();
				if (!trimmed || stateRef.current === "ended") return Promise.resolve(false);
				pendingRequests.current += 1;
				busyRef.current = true;
				setBusy(true);
				const task = analysisQueue.current.catch(() => void 0).then(async () => {
					let turn;
					try {
						if (!mounted.current || sessionRef.current !== sessionId || stateRef.current === "ended" || (options.valid && !options.valid())) return false;
						const previous = options.retryId ? turnsRef.current.find((item) => item.id === options.retryId) : null;
						const previousIndex = previous ? turnsRef.current.findIndex((item) => item.id === previous.id) : turnsRef.current.length;
						const history = turnsRef.current.slice(0, previousIndex).slice(-10).map((item) => ({ turn_id: item.id, speaker: item.speaker, text: item.text }));
						turn = previous ?? { id: eventId("turn"), assistantId: eventId("advice"), role: "user", speaker: who, text: trimmed, at: Date.now() };
						turn = { ...turn, status: "pending", error: "" };
						const assistant = { id: turn.assistantId, role: "assistant", forTurn: turn.id, at: Date.now(), status: "pending", feedbackKind: "" };
						turnsRef.current = previous ? turnsRef.current.map((item) => item.id === turn.id ? turn : item) : [...turnsRef.current, turn];
						setMessages((items) => previous
							? items.map((item) => item.id === turn.id ? turn : item.id === turn.assistantId ? assistant : item)
							: [...items, turn, assistant]);
						setError("");
						setNotice("");
						const payload = await request("suggest", {
							method: "POST",
							body: { session_id: sessionId, turn_id: turn.id, utterance: trimmed, speaker: who, history, event_id: eventId("utt") },
						});
						if (!mounted.current || sessionRef.current !== sessionId) return false;
						if (payload.suggestion == null) throw new Error("这一轮尚未获得策略，请重试。");
						latestBundle.current = payload;
						const suggestionId = payload.suggestion_id ?? payload.suggestion.id ?? turn.assistantId;
						turnsRef.current = turnsRef.current.map((item) => item.id === turn.id ? { ...item, status: "done" } : item);
						setMessages((items) => items.map((item) => item.id === turn.id ? { ...item, status: "done" } : item.id === turn.assistantId ? { ...assistant, status: "done", bundle: payload, suggestionId } : item));
						setFailedUtterance((previousFailure) => previousFailure?.turnId === turn.id ? null : previousFailure);
						setNotice("本轮策略已生成，可复制话术或继续补充对话。");
						return true;
					} catch (cause) {
						if (mounted.current && sessionRef.current === sessionId && turn) {
							const message = cause instanceof Error ? cause.message : String(cause);
							turnsRef.current = turnsRef.current.map((item) => item.id === turn.id ? { ...item, status: "error", error: message } : item);
							setMessages((items) => items.map((item) => item.id === turn.id || item.id === turn.assistantId ? { ...item, status: "error", error: message } : item));
							setFailedUtterance({ turnId: turn.id, text: trimmed, speaker: who });
						}
						return false;
					} finally {
						pendingRequests.current = Math.max(0, pendingRequests.current - 1);
						busyRef.current = pendingRequests.current > 0;
						if (mounted.current && sessionRef.current === sessionId) setBusy(busyRef.current);
					}
				});
				analysisQueue.current = task;
				return task;
			}, [sessionId]);

			const submitManual = react.useCallback(async () => {
				if (busyRef.current || actionRef.current || stateRef.current === "ended" || (voiceModeRef.current === "dictation" && ["connecting", "recording", "recognizing"].includes(stateRef.current))) return;
				const submitted = manual;
				if (!submitted.trim()) return;
				const sameFailure = failedUtterance?.text === submitted.trim() && failedUtterance?.speaker === speaker;
				const succeeded = await analyze(submitted, speaker, { retryId: sameFailure ? failedUtterance.turnId : undefined });
				if (succeeded && mounted.current) {
					setManual((current) => current === submitted ? "" : current);
					inputRef.current?.focus();
				}
			}, [manual, speaker, failedUtterance, analyze]);

			/** 取消才中断识别；结束录音会先处理最后一个片段。 */
			const cancelCapture = react.useCallback((message = "语音输入已取消，现有草稿已保留。") => {
				captureEpoch.current += 1;
				captureAbort.current?.abort();
				capture.current?.stop();
				capture.current = null;
				voiceModeRef.current = "";
				dictationPieces.current = [];
				setVoiceMode("");
				setRecognizing(false);
				if (["connecting", "recording", "listening", "recognizing"].includes(stateRef.current)) {
					changeState("paused");
					setNotice(message);
					request("session", { method: "POST", body: { session_id: sessionId, state: "paused" } }).catch(() => void 0);
				}
			}, [sessionId, changeState]);

			const startCapture = react.useCallback(async (mode = "dictation") => {
				if (!activeRef.current || actionRef.current || ["connecting", "recording", "listening", "recognizing", "ended"].includes(stateRef.current)) return;
				const speech = bridge.speech;
				if (speech === null) { setError("语音服务暂不可用，可以直接输入文字继续对话。"); return; }
				const epoch = ++captureEpoch.current;
				captureAbort.current?.abort();
				const abort = new AbortController();
				captureAbort.current = abort;
				const isCurrent = () => mounted.current && activeRef.current && sessionRef.current === sessionId && captureEpoch.current === epoch && !abort.signal.aborted;
				voiceModeRef.current = mode;
				setVoiceMode(mode);
				dictationPieces.current = [];
				setError("");
				setNotice("正在准备语音输入…");
				changeState("connecting");
				let instance;
				try {
					const selection = await speech.prepare({ signal: abort.signal, onProgress: (message) => { if (isCurrent()) setNotice(message); } });
					if (!isCurrent()) return;
					recognitionQueue.current = Promise.resolve();
					instance = new PcmCapture({
						segmentMs: bridge.segmentMs,
						onError: (cause) => { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)); },
						onSegment: (audioBase64, seconds) => {
							if (instance.stopped || !isCurrent()) return;
							const segmentSpeaker = speakerRef.current;
							recognitionQueue.current = recognitionQueue.current.catch(() => void 0).then(async () => {
								// finish() 已停止实际录音，但已入队的片段仍须完成识别。
								if (!isCurrent()) return;
								setRecognizing(true);
								try {
									const result = await speech.transcribe(audioBase64, seconds, abort.signal, selection);
									if (!isCurrent()) return;
									const text = String(result?.text ?? "").trim();
									if (!text) return;
									if (mode === "dictation") dictationPieces.current.push(text);
									else await analyze(text, segmentSpeaker, { valid: isCurrent });
								} catch (cause) {
									if (isCurrent()) setError(`识别失败：${cause instanceof Error ? cause.message : String(cause)}`);
								} finally {
									if (isCurrent()) setRecognizing(false);
								}
							});
							return recognitionQueue.current;
						},
					});
					capture.current = instance;
					await instance.start();
					if (!isCurrent() || instance.stopped) { instance.stop(); if (capture.current === instance) capture.current = null; return; }
					changeState(mode === "dictation" ? "recording" : "listening");
					setNotice(mode === "dictation" ? "正在录音，结束后将文字填入输入框，可修改再发送。" : "持续监听中：完整语音片段会自动分析，请按需切换输入内容类型。");
					request("session", { method: "POST", body: { session_id: sessionId, state: "listening" } }).catch(() => void 0);
				} catch (cause) {
					instance?.stop();
					if (capture.current === instance) capture.current = null;
					if (!isCurrent()) return;
					abort.abort();
					voiceModeRef.current = "";
					setVoiceMode("");
					changeState("error");
					setNotice("");
					const message = cause instanceof Error ? cause.message : String(cause);
					setError(message.includes("NotAllowed") || message.includes("Permission") ? "麦克风权限被拒绝。请允许本应用使用麦克风，或直接输入文字。" : `无法启动语音输入：${message}`);
				}
			}, [analyze, bridge, sessionId, changeState]);

			const stopRecording = react.useCallback(async () => {
				if (stateRef.current === "connecting") { cancelCapture("已停止等待语音，仍可直接输入文字。"); return true; }
				const instance = capture.current;
				if (!instance || stateRef.current === "recognizing") return false;
				const epoch = captureEpoch.current;
				const mode = voiceModeRef.current;
				const isCurrent = () => mounted.current && activeRef.current && sessionRef.current === sessionId && captureEpoch.current === epoch;
				changeState("recognizing");
				setRecognizing(true);
				setNotice(mode === "dictation" ? "录音已结束，正在识别最后一段…" : "正在处理最后一段对话…");
				try {
					await instance.finish();
					await recognitionQueue.current;
					if (!isCurrent()) return false;
					capture.current = null;
					if (mode === "dictation") {
						const text = dictationPieces.current.join("\n").trim();
						if (text) {
							setManual((current) => current.trim() ? `${current}\n${text}` : text);
							setNotice("语音已转为文字，可修改后发送。");
							inputRef.current?.focus();
						} else setNotice("没有识别到清晰语音，可以重新录音或直接输入。");
					} else setNotice("持续监听已暂停，已识别的对话与策略保留在本次会话。");
					voiceModeRef.current = "";
					setVoiceMode("");
					setRecognizing(false);
					changeState("paused");
					captureEpoch.current += 1;
					captureAbort.current?.abort();
					request("session", { method: "POST", body: { session_id: sessionId, state: "paused" } }).catch(() => void 0);
					return true;
				} catch (cause) {
					if (isCurrent()) {
						cancelCapture();
						setError(cause instanceof Error ? cause.message : String(cause));
					}
					return false;
				}
			}, [sessionId, changeState, cancelCapture]);

			/** 每次反馈带这张历史策略卡的 id，后续消息不会改变反馈目标。 */
			const feedback = react.useCallback(async (message, kind, copyText, copyLabel = "话术") => {
				if (actionRef.current || busyRef.current || message.status !== "done") return;
				const action = `${message.id}:${kind}`;
				actionRef.current = action;
				setPendingAction(action);
				let copied = false;
				setMessages((items) => items.map((item) => item.id === message.id ? { ...item, feedbackError: "", feedbackNotice: "" } : item));
				try {
					if (kind === "copied") { await navigator.clipboard.writeText(copyText ?? message.bundle.suggestion.recommended_reply ?? ""); copied = true; }
					await request("feedback", { method: "POST", body: { session_id: sessionId, kind, suggestion_id: message.suggestionId, event_id: eventId("fb") } });
					if (mounted.current && sessionRef.current === sessionId) setMessages((items) => items.map((item) => item.id === message.id ? { ...item, ...(kind !== "copied" ? { feedbackKind: kind } : {}), feedbackNotice: kind === "copied" ? `已复制${copyLabel}，反馈已记录。` : `已记录反馈：${FEEDBACK_LABELS[kind] ?? kind}。` } : item));
				} catch (cause) {
					if (mounted.current && sessionRef.current === sessionId) setMessages((items) => items.map((item) => item.id === message.id ? { ...item, feedbackError: kind === "copied" && !copied ? "无法写入剪贴板，请手动选择文本复制。" : cause instanceof Error ? cause.message : String(cause), feedbackNotice: copied ? `已复制${copyLabel}，反馈暂未保存。` : "" } : item));
				} finally {
					actionRef.current = "";
					if (mounted.current && sessionRef.current === sessionId) setPendingAction("");
				}
			}, [sessionId]);

			const handoff = react.useCallback(async () => {
				if (actionRef.current || busyRef.current || handoffTask) return;
				actionRef.current = "handoff";
				setPendingAction("handoff");
				setError("");
				const bundle = latestBundle.current;
				try {
					const payload = await request("handoff", { method: "POST", body: { session_id: sessionId, reason: bundle?.handoff?.reasons?.[0] ?? "manual", risk_reasons: bundle?.handoff?.reasons ?? [], unknown: bundle?.handoff?.required ? ["等待人工确认客户诉求"] : [], event_id: eventId("ho") } });
					if (mounted.current && sessionRef.current === sessionId) { setHandoffTask(payload.task); setNotice("人工协助任务已建立，交接内容已加入对话。"); }
				} catch (cause) { if (mounted.current && sessionRef.current === sessionId) setError(cause instanceof Error ? cause.message : String(cause)); }
				finally { actionRef.current = ""; if (mounted.current && sessionRef.current === sessionId) setPendingAction(""); }
			}, [sessionId, handoffTask]);

			const finishSession = react.useCallback(async () => {
				if (actionRef.current || busyRef.current || stateRef.current === "ended" || (voiceModeRef.current === "dictation" && ["connecting", "recording", "recognizing"].includes(stateRef.current))) return;
				actionRef.current = "finish";
				setPendingAction("finish");
				setError("");
				try {
					if (capture.current && !(await stopRecording())) return;
					if (!mounted.current || sessionRef.current !== sessionId) return;
					cancelCapture("");
					changeState("ended");
					setNotice("正在整理本次对话…");
					const payload = await request("debrief", { method: "POST", body: { session_id: sessionId } });
					if (mounted.current && sessionRef.current === sessionId) { setDebrief(payload.report); setNotice("会话已结束，复盘已加入对话。可以开始新会话。"); }
				} catch (cause) {
					if (mounted.current && sessionRef.current === sessionId) { changeState("paused"); setError(cause instanceof Error ? cause.message : String(cause)); setNotice("复盘未生成，仍可重试结束并复盘。"); }
				} finally { actionRef.current = ""; if (mounted.current && sessionRef.current === sessionId) setPendingAction(""); }
			}, [sessionId, stopRecording, cancelCapture, changeState]);

			const newSession = () => {
				if (busyRef.current || actionRef.current) return;
				cancelCapture("");
				const nextId = eventId("s");
				sessionRef.current = nextId;
				setSessionId(nextId);
				changeState("idle");
				turnsRef.current = [];
				latestBundle.current = null;
				setMessages([]);
				setDebrief(null);
				setHandoffTask(null);
				setFailedUtterance(null);
				setError("");
				setNotice("新会话已准备好，输入对话即可开始。");
				followNewest.current = true;
				setUnread(false);
				focusAfterReset.current = true;
			};
			const retryTurn = async (turnId) => {
				if (busyRef.current || actionRef.current || stateRef.current === "ended") return;
				const turn = turnsRef.current.find((item) => item.id === turnId);
				if (!turn) return;
				const succeeded = await analyze(turn.text, turn.speaker, { retryId: turn.id });
				if (succeeded && mounted.current) setManual((current) => current.trim() === turn.text ? "" : current);
			};

			react.useEffect(() => {
				mounted.current = true;
				return () => { mounted.current = false; captureEpoch.current += 1; captureAbort.current?.abort(); capture.current?.stop(); capture.current = null; };
			}, []);
			react.useEffect(() => {
				if (focusAfterReset.current) { focusAfterReset.current = false; if (activeRef.current) inputRef.current?.focus(); }
			}, [sessionId]);
			react.useEffect(() => {
				if (active) { if (!previousActive.current) service.reload(); previousActive.current = true; return; }
				previousActive.current = false;
				cancelCapture("离开销售助手后已停止录音，返回后可继续文字或语音输入。");
			}, [active, sessionId, service.reload, cancelCapture]);
			react.useEffect(() => {
				const chat = chatRef.current;
				if (!chat) return;
				if (followNewest.current) { chat.scrollTop = chat.scrollHeight; setUnread(false); }
				else if (messages.length > 0) setUnread(true);
			}, [messages, debrief, handoffTask]);

			const interactionBusy = busy || pendingAction !== "";
			const speechReady = bridge.speech !== null;
			const voiceWorking = ["connecting", "recording", "listening", "recognizing"].includes(state);
			const dictating = voiceMode === "dictation" && voiceWorking;
			const stateLabel = { idle: turnsRef.current.length > 0 ? "对话进行中" : "等待对话", connecting: "准备语音中", recording: "正在录音", listening: "持续监听中", recognizing: "正在处理语音", paused: "语音已暂停", ended: "会话已结束", error: "语音未启动" }[state] ?? state;
			const heading = wide ? "h3" : "h2";
			const voiceButtonLabel = state === "connecting" ? "取消语音准备" : state === "recognizing" ? "取消识别" : state === "listening" ? "暂停监听" : state === "recording" ? "结束录音" : "语音输入";
			const voiceButtonIcon = state === "recording" ? "stop" : state === "listening" ? "pause" : state === "connecting" || state === "recognizing" ? "cancel" : "mic";
			const voiceButtonAction = state === "connecting" || state === "recognizing" ? () => cancelCapture() : state === "listening" || state === "recording" ? stopRecording : () => startCapture("dictation");

			return react.createElement("section", { className: "cqaiXb cqaiXb-agent", "data-cqai-xiaobao-live": "", "data-wide": wide ? "true" : undefined },
				react.createElement("style", null, styles),
				react.createElement("header", { className: "cqaiXb-sessionBar" },
					react.createElement("div", { className: "cqaiXb-row" },
						react.createElement("span", { className: "cqaiXb-tag", "data-tone": state === "listening" || state === "recording" ? "ok" : state === "error" ? "bad" : undefined }, stateLabel),
						react.createElement("span", { className: "cqaiXb-note" }, service.loading ? "检查连接中…" : service.error ? "连接异常" : service.data ? `${service.data.knowledge?.approved_cards ?? 0} 条已发布话术` : "尚未连接服务"),
					),
					react.createElement("div", { className: "cqaiXb-actions" },
						react.createElement("button", { type: "button", disabled: interactionBusy || handoffTask !== null || turnsRef.current.length === 0, onClick: handoff }, pendingAction === "handoff" ? "正在建立任务…" : handoffTask ? "人工协助已建立" : "请求人工协助"),
						react.createElement("button", { type: "button", disabled: interactionBusy || dictating || state === "recognizing" || state === "ended" || turnsRef.current.length === 0, onClick: finishSession }, pendingAction === "finish" ? "正在生成复盘…" : "结束并复盘"),
						react.createElement("button", { type: "button", disabled: interactionBusy, onClick: newSession }, react.createElement(InlineIcon, { name: "plus", size: 14 }), "新会话"),
					),
				),
				react.createElement("div", { className: "cqaiXb-chat", role: "region", "aria-label": "本次销售对话", tabIndex: 0, ref: chatRef, onScroll: () => { const chat = chatRef.current; followNewest.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80; if (followNewest.current) setUnread(false); } },
					service.error ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, react.createElement("p", { style: { margin: 0 } }, service.error), react.createElement("button", { type: "button", disabled: service.loading, onClick: service.reload }, service.loading ? "正在重试…" : "重新连接")) : null,
					error ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, error, react.createElement("button", { type: "button", onClick: () => setError("") }, "关闭提示")) : null,
					react.createElement("div", { className: "cqaiXb-thread" },
						messages.length === 0 ? react.createElement("div", { className: "cqaiXb-chatWelcome" },
							react.createElement("div", { className: "cqaiXb-avatar" }, react.createElement(InlineIcon, { name: "assistant", size: 24 })),
							react.createElement(heading, null, "销售策略助手"),
							react.createElement("p", null, "告诉我客户说了什么，或你准备怎样回应。我会判断顾虑、明确沟通目标，给出可执行的策略和话术。"),
							react.createElement("div", { className: "cqaiXb-examples", "aria-label": "对话示例" }, EXAMPLE_UTTERANCES.map((example, index) => react.createElement("button", { key: example, type: "button", disabled: interactionBusy || state === "ended", onClick: () => { setSpeaker("customer"); setManual(example); inputRef.current?.focus(); } }, ["客户觉得太贵", "客户担心不适合", "客户要求退款"][index]))),
						) : null,
						messages.map((message) => message.role === "user"
							? react.createElement("article", { className: "cqaiXb-message", "data-role": "user", "data-message-role": "user", "data-turn-id": message.id, key: message.id },
								react.createElement("div", { className: "cqaiXb-avatar" }, react.createElement(InlineIcon, { name: "user", size: 18 })),
								react.createElement("div", { className: "cqaiXb-messageBody" },
									react.createElement("div", { className: "cqaiXb-messageHead" }, react.createElement("strong", null, message.speaker === "customer" ? "客户原话" : "我的回应"), react.createElement("time", { className: "cqaiXb-messageMeta", dateTime: new Date(message.at).toISOString() }, new Date(message.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))),
									react.createElement("p", { className: "cqaiXb-quote" }, message.text),
								),
							)
							: react.createElement(AgentStrategyMessage, { key: message.id, message, feedback, retryTurn, pendingAction, interactionBusy, ended: state === "ended" })),
						handoffTask ? react.createElement("article", { className: "cqaiXb-message", "data-role": "assistant" },
							react.createElement("div", { className: "cqaiXb-avatar" }, react.createElement(InlineIcon, { name: "assistant", size: 18 })),
							react.createElement("div", { className: "cqaiXb-messageBody cqaiXb-strategy" }, react.createElement("strong", null, "人工协助任务已建立"), react.createElement("dl", { className: "cqaiXb-kv" }, react.createElement("dt", null, "任务号"), react.createElement("dd", null, handoffTask.task_id), react.createElement("dt", null, "原因"), react.createElement("dd", null, reasonLabel(handoffTask.reason)), react.createElement("dt", null, "客户原话"), react.createElement("dd", null, handoffTask.customer_utterances?.join(" / ") || "暂无客户原话"))),
						) : null,
						debrief ? react.createElement("article", { className: "cqaiXb-message", "data-role": "assistant" },
							react.createElement("div", { className: "cqaiXb-avatar" }, react.createElement(InlineIcon, { name: "assistant", size: 18 })),
							react.createElement("div", { className: "cqaiXb-messageBody cqaiXb-strategy" }, react.createElement(heading, null, "本次会话复盘"), react.createElement("dl", { className: "cqaiXb-kv" }, react.createElement("dt", null, "客户发言"), react.createElement("dd", null, String(debrief.customer_turns ?? 0)), react.createElement("dt", null, "建议条数"), react.createElement("dd", null, String(debrief.stats?.suggestions ?? 0)), react.createElement("dt", null, "采纳率"), react.createElement("dd", null, debrief.stats?.acceptance_rate == null ? "暂无数据" : `${Math.round(debrief.stats.acceptance_rate * 100)}%`), react.createElement("dt", null, "知识缺口"), react.createElement("dd", null, String(debrief.knowledge_gaps?.length ?? 0))), (debrief.next_steps ?? []).map((step, index) => react.createElement("p", { className: "cqaiXb-note", key: index }, step)), react.createElement("p", { className: "cqaiXb-note" }, "复盘生成的候选知识会进入审核，不会自动发布。")),
						) : null,
					),
				),
				unread ? react.createElement("button", { type: "button", className: "cqaiXb-newMessages", onClick: () => { followNewest.current = true; if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; setUnread(false); } }, "查看新消息") : null,
				react.createElement("footer", { className: "cqaiXb-composer" },
					react.createElement("div", { className: "cqaiXb-status", role: "status", "aria-live": "polite", "aria-atomic": "true" }, busy ? "正在分析这一轮对话…" : recognizing && state !== "recording" ? "正在识别语音…" : notice),
					react.createElement("div", { className: "cqaiXb-composeBox" },
						react.createElement("textarea", { ref: inputRef, className: "cqaiXb-textarea", "aria-label": "对话输入", rows: 3, value: manual, disabled: state === "ended", placeholder: speaker === "customer" ? "输入客户原话，或用语音补充…" : "输入我的回应，继续这段对话…", onChange: (event) => setManual(event.target.value), onKeyDown: (event) => { if (isSubmitKey(event)) { event.preventDefault(); submitManual(); } } }),
						react.createElement("div", { className: "cqaiXb-composeTools" },
							react.createElement("select", { className: "cqaiXb-select", "aria-label": "输入内容类型", value: speaker, disabled: state === "ended", onChange: (event) => setSpeaker(event.target.value) }, react.createElement("option", { value: "customer" }, "客户原话"), react.createElement("option", { value: "sales" }, "我的回应")),
							react.createElement("div", { className: "cqaiXb-actions" },
								react.createElement("button", { type: "button", disabled: state === "ended" || (!speechReady && !voiceWorking) || pendingAction !== "" || !active, onClick: voiceButtonAction, "aria-label": voiceButtonLabel, "aria-pressed": state === "recording" || state === "listening" }, react.createElement(InlineIcon, { name: voiceButtonIcon, size: 18 }), voiceButtonLabel),
								react.createElement("button", { type: "button", "data-variant": "primary", disabled: !manual.trim() || interactionBusy || dictating || state === "ended", onClick: submitManual }, react.createElement(InlineIcon, { name: "send", size: 16 }), busy ? "分析中…" : "发送"),
							),
						),
					),
					react.createElement("div", { className: "cqaiXb-composeMeta" },
						react.createElement("span", { className: "cqaiXb-note" }, state === "ended" ? "会话已结束，开始新会话后可继续。" : "Enter 发送 · Shift + Enter 换行"),
						react.createElement("details", { className: "cqaiXb-listenOption" }, react.createElement("summary", null, "持续监听"), react.createElement("p", { className: "cqaiXb-note" }, "开启后，完整语音片段会直接进入本次对话并生成策略。说话人需要手动切换。"), react.createElement("button", { type: "button", disabled: !speechReady || state === "ended" || (voiceWorking && voiceMode !== "continuous") || state === "connecting" || state === "recognizing" || interactionBusy || !active, onClick: state === "listening" ? stopRecording : () => startCapture("continuous") }, state === "listening" ? "暂停监听" : "持续监听")),
					),
				),
			);
		}

		/** 历史策略卡保留自己的建议与反馈状态。 */
		function AgentStrategyMessage({ message, feedback, retryTurn, pendingAction, interactionBusy, ended }) {
			const bundle = message.bundle;
			const suggestion = bundle?.suggestion;
			const labels = { clarify_need: "先确认客户的使用场景和主要顾虑。", clarify_value: "先说明与客户需求有关的价值，再确认是否解决顾虑。", present_fact: "先核实并说明已审核的产品事实。", handle_objection: "先回应客户顾虑，再用问题确认下一步。", propose_next_step: "确认当前疑问后，商量一个具体的下一步。", handoff: "整理已知信息，交由人工确认。" };
			const section = (title, text, primary = false, overview = false) => text ? react.createElement("section", { className: "cqaiXb-strategySection", "data-primary": primary ? "true" : undefined, "data-overview": overview ? "true" : undefined }, react.createElement("h4", null, title), react.createElement("p", null, text)) : null;
			const isPending = (kind) => pendingAction === `${message.id}:${kind}`;
			return react.createElement("article", { className: "cqaiXb-message", "data-role": "assistant", "data-message-role": "assistant", "data-for-turn": message.forTurn, "data-suggestion-id": message.suggestionId ?? message.id, key: message.id },
				react.createElement("div", { className: "cqaiXb-avatar" }, react.createElement(InlineIcon, { name: "assistant", size: 18 })),
				react.createElement("div", { className: "cqaiXb-messageBody" },
					react.createElement("div", { className: "cqaiXb-messageHead" }, react.createElement("strong", null, "e销宝 · 销售策略"), react.createElement("time", { className: "cqaiXb-messageMeta", dateTime: new Date(message.at).toISOString() }, new Date(message.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))),
					message.status === "pending" ? react.createElement("div", { className: "cqaiXb-strategy", role: "status", "aria-live": "polite", "aria-busy": "true" }, "正在判断客户顾虑，整理这一轮的沟通策略…") : null,
					message.status === "error" ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, message.error, react.createElement("button", { type: "button", disabled: interactionBusy || ended, onClick: () => retryTurn(message.forTurn) }, "重试这一轮")) : null,
					suggestion ? react.createElement("div", { className: "cqaiXb-strategy" },
						react.createElement("div", { className: "cqaiXb-row" }, react.createElement("span", { className: "cqaiXb-tag" }, intentLabel(suggestion.intent)), bundle.degraded ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, "已审核话术模式") : null, bundle.handoff?.required ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "bad" }, "需要人工确认") : null),
						section("客户判断", suggestion.customer_assessment ?? suggestion.reason ?? `当前识别到：${intentLabel(suggestion.intent)}。`, false, true),
						section("本轮沟通目标", suggestion.communication_goal ?? labels[suggestion.next_action] ?? "确认客户的主要顾虑与下一步需求。", false, true),
						section("建议策略", suggestion.strategy ?? labels[suggestion.next_action] ?? "先回应顾虑，再核实客户需求。", false, true),
						section("建议话术", suggestion.recommended_reply, true),
						section("可以追问", suggestion.follow_up_question),
						react.createElement("section", { className: "cqaiXb-strategySection", "data-risk": bundle.handoff?.required ? "high" : undefined }, react.createElement("h4", null, "注意事项"),
							(bundle.handoff?.reasons?.length ?? 0) > 0 ? react.createElement("ul", null, bundle.handoff.reasons.map((reason) => react.createElement("li", { key: reason }, reasonLabel(reason)))) : null,
							(suggestion.do_not_say?.length ?? 0) > 0 ? react.createElement("p", null, `不要承诺：${suggestion.do_not_say.join("；")}`) : null,
							!bundle.handoff?.reasons?.length && !suggestion.do_not_say?.length ? react.createElement("p", null, (suggestion.confidence ?? 1) < .5 ? "当前判断需要确认，可先追问客户再作回应。" : "当前没有额外注意事项。") : null,
						),
						suggestion.alternative_reply ? react.createElement("details", { className: "cqaiXb-details" }, react.createElement("summary", null, "备用说法"), react.createElement("p", { className: "cqaiXb-quote" }, suggestion.alternative_reply), react.createElement("button", { type: "button", disabled: interactionBusy, onClick: () => feedback(message, "copied", suggestion.alternative_reply, "备用说法") }, "复制备用说法")) : null,
						react.createElement("details", { className: "cqaiXb-details" }, react.createElement("summary", null, react.createElement(InlineIcon, { name: "book", size: 14 }), "查看依据"),
							suggestion.reason ? react.createElement("p", { className: "cqaiXb-note" }, suggestion.reason) : null,
							(bundle.sources ?? []).map((source, index) => react.createElement("p", { className: "cqaiXb-src", key: `${source.id}-${index}` }, `${source.kind === "phrase_card" ? "话术卡" : "产品与政策"} · ${source.label ?? source.id} · ${source.id}`)),
							!bundle.sources?.length ? react.createElement("p", { className: "cqaiXb-note" }, "本轮未找到可引用的已审核依据。") : null,
							react.createElement("p", { className: "cqaiXb-note" }, `判断置信度 ${Math.round((suggestion.confidence ?? 0) * 100)}%${bundle.suppressed ? " · 参考近期建议" : ""}`),
							bundle.degraded_reason ? react.createElement("p", { className: "cqaiXb-note" }, `服务状态：${bundle.degraded_reason}`) : null,
						),
						react.createElement("div", { className: "cqaiXb-actions" },
							react.createElement("button", { type: "button", disabled: interactionBusy, onClick: () => feedback(message, "copied") }, isPending("copied") ? "复制中…" : "复制话术"),
							react.createElement("button", { type: "button", disabled: interactionBusy || message.feedbackKind === "accepted", "aria-pressed": message.feedbackKind === "accepted", onClick: () => feedback(message, "accepted") }, isPending("accepted") ? "记录中…" : message.feedbackKind === "accepted" ? "已采用 ✓" : "采用建议"),
							react.createElement("button", { type: "button", disabled: interactionBusy || message.feedbackKind === "skipped", "aria-pressed": message.feedbackKind === "skipped", onClick: () => feedback(message, "skipped") }, isPending("skipped") ? "记录中…" : "不适用"),
							react.createElement("button", { type: "button", disabled: interactionBusy || message.feedbackKind === "ineffective", "aria-pressed": message.feedbackKind === "ineffective", onClick: () => feedback(message, "ineffective") }, isPending("ineffective") ? "记录中…" : "效果不佳"),
						),
						message.feedbackError ? react.createElement("p", { className: "cqaiXb-error", role: "alert" }, message.feedbackError) : null,
						message.feedbackNotice ? react.createElement("p", { className: "cqaiXb-note", role: "status", "aria-live": "polite" }, message.feedbackNotice) : null,
					) : null,
				),
			);
		}

		/** 人工接管原因码到界面文案。 */
		function reasonLabel(reason) {
			const labels = {
				manual: "销售主动请求人工协助",
				policy_escalation: "涉及退款、赔付、投诉或合同条款",
				unverified_claim: "涉及未核实的功能或效果承诺",
				high_risk_domain: "涉及医疗、金融、隐私或安全主张",
				internal_request: "客户索要内部底价或他人信息",
				low_confidence: "意图置信度偏低",
				asr_incomplete: "转写不完整或双方同时发言",
				no_grounding: "已审核知识中没有足够依据",
				customer_refusal: "客户明确拒绝",
			};
			return labels[reason] ?? String(reason);
		}

		/** 右侧标签页的标题。 */
		function LiveCoachTitle({ useTabInfo }) {
			const info = typeof useTabInfo === "function" ? useTabInfo() : void 0;
			return react.createElement(react.Fragment, null, "e销宝", info?.tab?.title ? ` · ${info.tab.title}` : null);
		}
		//#endregion

		//#region knowledge console
		/** 配置页与工作台共用的知识管理控制台。 */
		function KnowledgeConsole({ bridge, compact }) {
			const [tab, setTab] = react.useState(compact ? "live" : "cards");
			const [error, setError] = react.useState("");
			const [notice, setNotice] = react.useState("");
			const [pending, setPending] = react.useState("");
			const mutationLock = react.useRef(false);
			const panelId = react.useId();
			const nav = react.useRef(null);
			const state = useAsyncData(() => request("knowledge"), []);
			const audit = useAsyncData(() => request("audit", { method: "GET" }), []);

			const cards = state.data?.cards ?? [];
			const facts = state.data?.facts ?? [];
			const health = state.data?.health;
			const reviewCount = cards.filter((card) => card.status === "draft" || card.status === "review").length;

			/** 统一的写操作包装：刷新数据并把错误显示在界面上。 */
			const mutate = react.useCallback(async (action, body) => {
				if (mutationLock.current) return false;
				mutationLock.current = true;
				setPending(action);
				setError("");
				setNotice("");
				try {
					await request(action, { method: "POST", body });
					setNotice(action.endsWith("approve") ? "话术已发布，后续推荐将使用最新内容。" : action.endsWith("retire") ? "话术已停用，不再参与推荐。" : "话术已退回待审。审核通过后可重新发布。");
					await Promise.all([state.reload(), audit.reload()]);
					return true;
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					return false;
				} finally {
					mutationLock.current = false;
					setPending("");
				}
			}, [state.reload, audit.reload]);

			const tabs = [
				...(compact ? [["live", "实时陪练"]] : []),
				["cards", "话术库"],
				["review", "审核队列"],
				["facts", "产品与政策"],
				["versions", "版本与健康"],
				["preview", "试运行"],
				["privacy", "连接与隐私"],
			];
			const descriptions = {
				cards: ["话术库", "查找可用话术，管理发布与审核状态。"],
				review: ["审核队列", "确认内容与依据后再发布，未审核的话术不会参与推荐。"],
				facts: ["产品与政策", "核对产品能力、价格和服务政策的权威依据。"],
				versions: ["版本与健康", "查看知识缺口、内容冲突和最近的操作记录。"],
			};
			const refresh = () => { state.reload(); audit.reload(); };
			const loading = state.loading || audit.loading;
			const selectTab = (id) => { setTab(id); setNotice(""); setError(""); };

			return react.createElement("div", {
				className: "cqaiXb-console",
				"data-cqai-xiaobao-console": compact ? "compact" : "full",
			},
				react.createElement("style", null, styles),

				react.createElement("header", { className: "cqaiXb-hero" },
					react.createElement("div", { className: "cqaiXb-brand" },
						react.createElement("div", { className: "cqaiXb-brandmark" }, react.createElement(XiaobaoIcon, { size: 24 })),
						react.createElement("div", null,
							react.createElement("h2", null, compact ? "e销宝" : "e销宝 · 知识管理"),
							react.createElement("p", null, compact ? "听懂客户顾虑，找到有依据的回应。" : "让每一句建议，都有审核过的依据。"))),
					react.createElement("div", { className: "cqaiXb-row" },
						state.data ? react.createElement("span", { className: "cqaiXb-tag" }, `${health?.counts?.approved_cards ?? 0} 条已发布话术`) : null,
						react.createElement("button", { type: "button", disabled: loading || pending !== "", onClick: refresh }, loading ? "正在连接…" : "刷新数据")),
				),

				react.createElement("div", { className: "cqaiXb-tabs", role: "tablist", "aria-label": "e销宝功能", ref: nav,
					onKeyDown: (event) => {
						const buttons = [...nav.current.querySelectorAll('[role="tab"]')];
						const current = buttons.indexOf(document.activeElement);
						if (current < 0) return;
						const next = event.key === "ArrowRight" ? (current + 1) % buttons.length : event.key === "ArrowLeft" ? (current + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
						if (next < 0) return;
						event.preventDefault(); buttons[next].focus(); selectTab(tabs[next][0]);
					} },
					tabs.map(([id, label]) => react.createElement("button", {
						key: id,
						type: "button",
						className: "cqaiXb-tab",
						role: "tab",
						id: `${panelId}-tab-${id}`,
						"aria-selected": tab === id,
						"aria-controls": `${panelId}-panel-${id}`,
						tabIndex: tab === id ? 0 : -1,
						"data-active": tab === id ? "true" : void 0,
						onClick: () => selectTab(id),
					}, label, id === "review" && reviewCount > 0 ? react.createElement("span", { className: "cqaiXb-count" }, reviewCount) : null)),
				),

				compact ? react.createElement("div", { className: "cqaiXb-panel", role: "tabpanel", id: `${panelId}-panel-live`, "aria-labelledby": `${panelId}-tab-live`, hidden: tab !== "live" }, react.createElement(LiveCoachPanel, { bridge, wide: true, active: tab === "live" })) : null,
				react.createElement("div", { className: "cqaiXb-body", role: "tabpanel", id: `${panelId}-panel-${tab === "live" ? "inactive" : tab}`, "aria-labelledby": `${panelId}-tab-${tab}`, hidden: tab === "live", tabIndex: 0, "aria-busy": state.loading },
					descriptions[tab] ? react.createElement("div", { className: "cqaiXb-sectionhead" }, react.createElement("div", null, react.createElement("h3", null, descriptions[tab][0]), react.createElement("p", { className: "cqaiXb-note" }, descriptions[tab][1]))) : null,
					error !== "" ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, error, react.createElement("button", { type: "button", onClick: () => setError("") }, "关闭提示")) : null,
					notice !== "" ? react.createElement("div", { className: "cqaiXb-notice", "data-tone": "ok", role: "status" }, notice) : null,
					state.loading ? react.createElement("p", { className: "cqaiXb-note", role: "status" }, state.data ? "正在更新，先显示上次读取的内容…" : "正在读取知识库…") : null,
					state.error !== "" ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, state.error, react.createElement("div", null, react.createElement("button", { type: "button", disabled: state.loading, onClick: state.reload }, "重新检查连接"))) : null,

					tab === "versions" && health !== void 0 ? react.createElement("div", { className: "cqaiXb-metrics" },
						metric("话术卡", health.counts.cards),
						metric("已发布", health.counts.approved_cards),
						metric("产品事实", health.counts.facts),
						metric("知识缺口", health.gaps.length),
						metric("冲突", health.conflicts.length),
						metric("过期", health.expired.length),
					) : null,

					tab === "cards" && state.data ? react.createElement(CardList, { cards, mutate, pending }) : null,
					tab === "review" && state.data ? react.createElement(ReviewQueue, { cards, mutate, pending }) : null,
					tab === "facts" && state.data ? react.createElement(FactList, { facts }) : null,
					tab === "versions" && state.data ? react.createElement(react.Fragment, null,
						audit.error ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, `操作记录读取失败：${audit.error}`, react.createElement("button", { type: "button", onClick: audit.reload, disabled: audit.loading }, "重试读取记录")) : null,
						react.createElement(VersionHealth, { health, audit: audit.data?.entries ?? [] })) : null,
					tab === "preview" ? react.createElement(Preview, {}) : null,
					tab === "privacy" ? react.createElement(PrivacyPanel, { bridge }) : null,
				),
			);
		}

		/** 一个指标卡。 */
		function metric(label, value) {
			return react.createElement("div", { className: "cqaiXb-metric", key: label },
				react.createElement("b", null, String(value)),
				react.createElement("span", null, label),
			);
		}

		/** 话术库列表。 */
		function CardList({ cards, mutate, pending }) {
			const [filter, setFilter] = react.useState("");
			const [status, setStatus] = react.useState("all");
			const query = filter.trim().toLocaleLowerCase();
			const shown = cards.filter((card) => (status === "all" || card.status === status) && (query === "" || [card.id, card.intent, intentLabel(card.intent), card.scenario, ...(card.customer_utterances ?? []), ...(card.approved_responses ?? [])].join(" ").toLocaleLowerCase().includes(query)));
			return react.createElement(react.Fragment, null,
				react.createElement("div", { className: "cqaiXb-toolbar" },
					react.createElement("label", { className: "cqaiXb-field" }, react.createElement("span", null, "搜索话术"), react.createElement("input", {
					className: "cqaiXb-input",
					type: "search",
					placeholder: "搜索场景、客户表达或话术内容",
					value: filter,
					onChange: (event) => setFilter(event.target.value),
				})),
					react.createElement("label", { className: "cqaiXb-field" }, react.createElement("span", null, "发布状态"), react.createElement("select", { className: "cqaiXb-select", value: status, onChange: (event) => setStatus(event.target.value) }, react.createElement("option", { value: "all" }, "全部状态"), Object.entries(CARD_STATUS_LABELS).map(([value, label]) => react.createElement("option", { key: value, value }, label)))),
					(filter !== "" || status !== "all") ? react.createElement("button", { type: "button", onClick: () => { setFilter(""); setStatus("all"); } }, "清空筛选") : null),
				react.createElement("p", { className: "cqaiXb-note", role: "status" }, `显示 ${shown.length} / ${cards.length} 条话术`),
				react.createElement("div", { className: "cqaiXb-list", "data-grid": "true" },
					shown.map((card) => react.createElement("article", { className: "cqaiXb-item", key: card.id },
						react.createElement("h5", null,
							card.scenario,
							react.createElement("span", { className: "cqaiXb-tag", "data-tone": card.status === "approved" ? "ok" : "warn" }, CARD_STATUS_LABELS[card.status] ?? card.status),
							react.createElement("span", { className: "cqaiXb-tag" }, `v${card.version}`),
							react.createElement("span", { className: "cqaiXb-tag", "data-tone": card.risk_level === "high" ? "bad" : void 0 }, `风险 ${RISK_LABELS[card.risk_level] ?? card.risk_level}`),
						),
						react.createElement("p", { className: "cqaiXb-quote" }, card.approved_responses?.[0] ?? "（无话术）"),
						react.createElement("span", { className: "cqaiXb-tag" }, intentLabel(card.intent)),
						react.createElement("details", { className: "cqaiXb-details" }, react.createElement("summary", null, "客户表达与内容依据"),
							react.createElement("p", { className: "cqaiXb-src" }, (card.customer_utterances ?? []).join(" / ") || "暂无表达示例"),
							react.createElement("p", { className: "cqaiXb-mono" }, `${card.id} · 依据 ${(card.evidence_refs ?? []).join(" / ") || "未填写"}`)),
						react.createElement(CardActions, { card, mutate, pending }),
					)),
				),
				shown.length === 0 ? react.createElement("div", { className: "cqaiXb-empty" }, react.createElement("strong", null, cards.length === 0 ? "话术库还是空的" : "没有找到匹配的话术"), cards.length === 0 ? "请先准备并审核产品话术。" : "试试更短的关键词，或清空筛选条件。") : null,
			);
		}

		function CardActions({ card, mutate, pending }) {
			const [confirm, setConfirm] = react.useState("");
			const action = `cards/${encodeURIComponent(card.id)}/${confirm}`;
			const labels = { approve: "发布", retire: "停用", status: "退回待审" };
			return react.createElement("div", null,
				react.createElement("div", { className: "cqaiXb-actions" },
					card.status === "approved" ? react.createElement("button", { type: "button", disabled: !!pending, onClick: () => setConfirm("retire") }, "停用话术") : react.createElement("button", { type: "button", disabled: !!pending, onClick: () => setConfirm("approve") }, "审核并发布"),
					card.status !== "review" ? react.createElement("button", { type: "button", disabled: !!pending, onClick: () => setConfirm("status") }, card.status === "draft" || card.status === "retired" ? "提交审核" : "退回待审") : null),
				confirm ? react.createElement("div", { className: "cqaiXb-confirm", role: "group", "aria-label": `确认${labels[confirm]}`, style: { marginTop: "10px" } },
					react.createElement("p", { className: "cqaiXb-note" }, confirm === "approve" ? "发布后将参与实时推荐。请确认话术及引用的产品事实均已审核。" : "操作后这条话术将不再参与推荐，仍可在话术库中查看。"),
					react.createElement("div", { className: "cqaiXb-actions" },
						react.createElement("button", { type: "button", "data-variant": confirm === "approve" ? "primary" : "danger", disabled: !!pending, onClick: async () => { const ok = await mutate(action, { actor: "ui", ...(confirm === "status" ? { status: "review" } : {}) }); if (ok) setConfirm(""); } }, pending === action ? "正在保存…" : `确认${labels[confirm]}`),
						react.createElement("button", { type: "button", disabled: !!pending, onClick: () => setConfirm("") }, "取消"))) : null);
		}

		/** 审核队列：只显示草稿与待审核内容。 */
		function ReviewQueue({ cards, mutate, pending }) {
			const awaitingReview = cards.filter((card) => card.status === "draft" || card.status === "review");
			return react.createElement(react.Fragment, null,
				react.createElement("p", { className: "cqaiXb-note" }, "未审核内容不参与实时推荐。发布前请确认价格、优惠与效果表述都能在「产品与政策」里找到依据。"),
				awaitingReview.length === 0
					? react.createElement("p", { className: "cqaiXb-empty" }, "审核队列为空。")
					: react.createElement("div", { className: "cqaiXb-list" },
						awaitingReview.map((card) => react.createElement("article", { className: "cqaiXb-item", key: card.id },
							react.createElement("h5", null,
								card.scenario,
								react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, CARD_STATUS_LABELS[card.status]),
								react.createElement("span", { className: "cqaiXb-tag" }, `v${card.version}`),
							),
							react.createElement("p", { className: "cqaiXb-quote" }, card.approved_responses?.[0] ?? "（待补话术）"),
							react.createElement("div", { className: "cqaiXb-src" }, `依据：${(card.evidence_refs ?? []).join(" / ") || "（未声明依据）"}`),
							(card.evidence_refs ?? []).length === 0
								? react.createElement("p", { className: "cqaiXb-note" }, "这张卡没有声明依据。涉及价格或效果时不应发布。")
								: null,
							react.createElement(CardActions, { card, mutate, pending }),
						)),
					),
			);
		}

		/** 产品事实与政策列表。 */
		function FactList({ facts }) {
			const groups = new Map();
			for (const fact of facts) {
				if (!groups.has(fact.topic)) groups.set(fact.topic, []);
				groups.get(fact.topic).push(fact);
			}
			return react.createElement(react.Fragment, null,
				react.createElement("p", { className: "cqaiXb-note" }, "这里是价格、优惠、退款、配送与产品能力的唯一权威来源。话术卡不能自带数字，只能引用这里的事实。"),
				facts.length === 0 ? react.createElement("p", { className: "cqaiXb-empty" }, "还没有产品事实。") : null,
				[...groups.entries()].map(([topic, list]) => react.createElement("section", { key: topic },
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px", marginTop: "10px" } }, topic),
					react.createElement("div", { className: "cqaiXb-list" },
						list.map((fact) => react.createElement("article", { className: "cqaiXb-item", key: fact.id },
							react.createElement("h5", null,
								fact.statement,
								react.createElement("span", { className: "cqaiXb-tag", "data-tone": fact.status === "approved" ? "ok" : "warn" }, CARD_STATUS_LABELS[fact.status] ?? fact.status),
								react.createElement("span", { className: "cqaiXb-tag" }, `v${fact.version}`),
								fact.escalation === "required" ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "bad" }, "必须转人工") : null,
							),
							(fact.details ?? []).length > 0 ? react.createElement("ul", { style: { margin: "0", paddingLeft: "18px", fontSize: "12.5px", lineHeight: "1.7" } },
								fact.details.map((detail, index) => react.createElement("li", { key: index }, detail)),
							) : null,
							fact.forbidden_claims?.length > 0 ? react.createElement("p", { className: "cqaiXb-src" }, `全局禁止表达：${fact.forbidden_claims.join("；")}`) : null,
							react.createElement("div", { className: "cqaiXb-mono" }, `${fact.id} · 来源 ${fact.source} · 审核 ${fact.reviewed_by ?? "未记录"}`),
						)),
					),
				)),
			);
		}

		/** 版本与健康：冲突、缺口、悬空引用与审计流水。 */
		function VersionHealth({ health, audit }) {
			if (health === void 0) return react.createElement("p", { className: "cqaiXb-note" }, "正在检查知识库…");
			return react.createElement(react.Fragment, null,
				health.conflicts.length > 0 ? react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "内容冲突"),
					react.createElement("p", { className: "cqaiXb-note" }, "同一意图下有多张已发布卡片给出不同的主话术。请人工确认保留哪一张。"),
					health.conflicts.map((item) => react.createElement("p", { className: "cqaiXb-src", key: item.intent }, `${item.intent}：${item.card_ids.join(" / ")}`)),
				) : null,

				health.gaps.length > 0 ? react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "知识缺口"),
					react.createElement("p", { className: "cqaiXb-note" }, "这些意图被客户表达覆盖，但没有任何已发布卡片。缺口出现时实时建议会转人工。"),
					react.createElement("p", { className: "cqaiXb-src" }, health.gaps.join(" / ")),
				) : null,

				health.dangling_refs.length > 0 ? react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "悬空依据引用"),
					react.createElement("p", { className: "cqaiXb-note" }, "卡片引用了不存在的产品事实。这类卡片在审核时应先修好依据。"),
					health.dangling_refs.map((item, index) => react.createElement("p", { className: "cqaiXb-src", key: index }, `${item.card} → ${item.ref}`)),
				) : null,

				health.expired.length > 0 ? react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "已过期内容"),
					react.createElement("p", { className: "cqaiXb-src" }, health.expired.join(" / ")),
				) : null,

				health.not_yet_effective.length > 0 ? react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "尚未生效"),
					react.createElement("p", { className: "cqaiXb-src" }, health.not_yet_effective.join(" / ")),
				) : null,

				react.createElement("section", null,
					react.createElement("h3", { className: "cqaiXb-h2", style: { fontSize: "13px" } }, "操作审计"),
					react.createElement("p", { className: "cqaiXb-note" }, "最近的操作记录。发布、停用、回滚、推荐与反馈都会留痕。"),
					audit.length === 0
						? react.createElement("p", { className: "cqaiXb-empty" }, "暂无审计记录。")
						: react.createElement("div", { className: "cqaiXb-list" },
							audit.slice(0, 40).map((entry, index) => react.createElement("div", { className: "cqaiXb-item", key: index },
								react.createElement("div", { className: "cqaiXb-row" },
									react.createElement("span", { className: "cqaiXb-tag" }, entry.action),
									entry.subject ? react.createElement("span", { className: "cqaiXb-mono" }, entry.subject) : null,
									react.createElement("span", { className: "cqaiXb-note" }, entry.actor ?? ""),
								),
								react.createElement("div", { className: "cqaiXb-mono" }, new Date(entry.at).toLocaleString("zh-CN")),
								entry.detail !== void 0 ? react.createElement("div", { className: "cqaiXb-src" }, JSON.stringify(entry.detail)) : null,
							)),
						),
				),
			);
		}

		/** 试运行：不写入会话、不写审计的只读沙盘。 */
		function Preview() {
			const [text, setText] = react.useState("");
			const [result, setResult] = react.useState(null);
			const [error, setError] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const runLock = react.useRef(false);
			const textId = react.useId();

			const run = react.useCallback(async () => {
				const trimmed = text.trim();
				if (trimmed.length === 0 || runLock.current) return;
				runLock.current = true;
				setBusy(true);
				setError("");
				setResult(null);
				try {
					setResult(await request("preview", { method: "POST", body: { utterance: trimmed } }));
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setResult(null);
				} finally {
					runLock.current = false;
					setBusy(false);
				}
			}, [text]);

			return react.createElement("section", { className: "cqaiXb-preview" },
				react.createElement("div", null, react.createElement("h3", null, "先试一句客户原话"), react.createElement("p", { className: "cqaiXb-note" }, "查看建议、引用依据和风险。这里的试练不会写入会话或审计。")),
				react.createElement("article", { className: "cqaiXb-item" },
				react.createElement("label", { className: "cqaiXb-label", htmlFor: textId }, "客户原话"),
				react.createElement("textarea", {
					id: textId,
					className: "cqaiXb-textarea",
					value: text,
					disabled: busy,
					placeholder: "例如：你们这个价格有点贵，有没有便宜一点的",
					onChange: (event) => { setText(event.target.value); setResult(null); setError(""); },
					onKeyDown: (event) => { if ((event.ctrlKey || event.metaKey) && isSubmitKey(event)) { event.preventDefault(); run(); } },
				}),
				react.createElement("div", { className: "cqaiXb-examples", "aria-label": "示例客户表达" }, EXAMPLE_UTTERANCES.map((example, index) => react.createElement("button", { key: example, type: "button", disabled: busy, onClick: () => { setText(example); setResult(null); setError(""); document.getElementById(textId)?.focus(); } }, ["价格有点贵", "不知道是否适合", "想了解退款"][index]))),
				react.createElement("div", { className: "cqaiXb-actions" },
					react.createElement("button", { type: "button", "data-variant": "primary", disabled: busy || text.trim().length === 0, onClick: run }, busy ? "正在生成建议…" : "生成试练建议"),
					text ? react.createElement("button", { type: "button", disabled: busy, onClick: () => { setText(""); setResult(null); setError(""); } }, "清空") : null,
					react.createElement("span", { className: "cqaiXb-note" }, "Ctrl / ⌘ + Enter 提交")),
				),
				error !== "" ? react.createElement("div", { className: "cqaiXb-error", role: "alert" }, error, react.createElement("div", null, react.createElement("button", { type: "button", disabled: busy, onClick: run }, "重试"))) : null,
				busy ? react.createElement("p", { className: "cqaiXb-note", role: "status" }, "正在检索已审核话术，请稍候…") : null,
				result === null && !busy && !error ? react.createElement("div", { className: "cqaiXb-empty" }, react.createElement("strong", null, "建议将显示在这里"), "输入客户原话，或点选一个示例开始试练。") : null,

				result !== null ? react.createElement(react.Fragment, null,
					react.createElement("div", { className: "cqaiXb-metrics" },
						metric("客户意图", intentLabel(result.suggestion?.intent)),
						metric("置信度", `${Math.round((result.suggestion?.confidence ?? 0) * 100)}%`),
						metric("召回", result.recalled?.length ?? 0),
						metric("用时", `${((result.latency_ms ?? 0) / 1000).toFixed(1)} 秒`),
					),
					react.createElement("article", { className: "cqaiXb-item" },
						react.createElement("h5", null, "可以这样回应", result.degraded ? react.createElement("span", { className: "cqaiXb-tag" }, "已审核话术") : null),
						react.createElement("p", { className: "cqaiXb-quote", "data-primary": "true" }, result.suggestion?.recommended_reply ?? "（无）"),
						result.suggestion?.follow_up_question ? react.createElement("p", { className: "cqaiXb-quote" }, `追问：${result.suggestion.follow_up_question}`) : null,
						result.suggestion?.reason ? react.createElement("p", { className: "cqaiXb-note" }, `依据：${result.suggestion.reason}`) : null,
					),
					react.createElement("details", { className: "cqaiXb-item" },
						react.createElement("summary", null, "查看检索依据"),
						(result.recalled ?? []).length === 0
							? react.createElement("p", { className: "cqaiXb-note" }, "没有召回任何已发布话术卡。")
							: (result.recalled ?? []).map((entry) => react.createElement("div", { className: "cqaiXb-mono", key: entry.id },
								`${entry.id} · 融合分 ${entry.score} · 通道 ${Object.keys(entry.channels ?? {}).join("+")}`)),
					),
					result.handoff?.reasons?.length > 0 ? react.createElement("div", { className: "cqaiXb-risk", "data-level": result.handoff.required ? "high" : "medium" },
						react.createElement("strong", null, result.handoff.required ? "会要求人工接管" : "会提示风险"),
						react.createElement("ul", null, result.handoff.reasons.map((reason) => react.createElement("li", { key: reason }, reasonLabel(reason)))),
					) : null,
				) : null,
			);
		}

		/** 连接与隐私：如实说明当前的数据处理方式，不做无法兑现的承诺。 */
		function PrivacyPanel({ bridge }) {
			return react.createElement(react.Fragment, null,
				react.createElement("p", { className: "cqaiXb-note" }, "这里如实说明 e销宝 当前的数据处理方式。"),
				react.createElement("article", { className: "cqaiXb-item" },
					react.createElement("h5", null, "语音与转写"),
					react.createElement("div", { className: "cqaiXb-kv" },
						react.createElement("dt", null, "识别方式"), react.createElement("dd", null, "使用平台当前选定的语音识别器，停顿后分段识别；语音输入先填入草稿，持续监听会自动生成策略"),
						react.createElement("dt", null, "音频留存"), react.createElement("dd", null, "不落盘。每段音频只存在于内存中，识别完成后即丢弃"),
						react.createElement("dt", null, "转写留存"), react.createElement("dd", null, "仅保留在本次会话的内存里，供复盘使用；插件不写入独立数据库"),
						react.createElement("dt", null, "写入审计的字段"), react.createElement("dd", null, "只记录意图、是否降级、是否转人工、延迟与模型路由，**不记录客户原话**"),
					),
				),
				react.createElement("article", { className: "cqaiXb-item" },
					react.createElement("h5", null, "服务状态"),
					react.createElement("div", { className: "cqaiXb-kv" },
						react.createElement("dt", null, "语音服务"), react.createElement("dd", null, bridge.speech === null ? "不可用（未启用语音输入插件）" : "可用"),
						react.createElement("dt", null, "采集方式"), react.createElement("dd", null, "约 700 毫秒停顿后识别，持续讲话最长 12 秒；结束录音会处理最后一段"),
						react.createElement("dt", null, "知识库位置"), react.createElement("dd", null, react.createElement("code", null, "$DSH_HOME/xiaobao/knowledge/")),
					),
				),
				react.createElement("article", { className: "cqaiXb-item" },
					react.createElement("h5", null, "模型调用"),
					react.createElement("p", { className: "cqaiXb-note" }, "生成建议时会把当前客户语句、最近数轮对话、已审核话术卡与产品事实发送给模型。客户原话被明确标记为不可信数据，模型无法通过它改变插件规则、权限或价格政策。"),
					react.createElement("p", { className: "cqaiXb-note" }, "模型不可用或输出非法时，面板会显示由已审核话术卡直接生成的模板建议，并标注「已降级」。"),
				),
			);
		}
		//#endregion

		//#region apply
		/** 只要求 slots；其余服务按需 inject，缺席时对应能力降级而不是整体挂起。 */
		const inject = ["slots"];

		/**
		* 浏览器插件主体。
		*
		* 注册四件事：右侧实时陪练标签页、插件自己的配置页、左侧工作台面板，
		* 以及可选的语音能力桥接。全部注册都由 `ctx.slots.inject` 托管，插件
		* 停用时自动解除。
		*
		* @param ctx - 浏览器插件上下文。
		*/
		function apply(ctx) {
			/** 界面与 Host 之间的桥：把可选能力集中在一处，便于面板如实显示可用性。 */
			const listeners = new Set();
			const bridge = {
				speech: null,
				segmentMs: VOICE_SEGMENT_MS,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				notify() {
					for (const listener of listeners) listener();
				},
			};

			// ── 可选：平台的语音识别远程服务 ──────────────────────────────
			ctx.inject(["remote.speech"], (child) => {
				const speech = child.get("remote.speech");
				if (speech === void 0) return;
				const lifetime = new AbortController();
				let preparedSelection;
				const unwrap = (result) => {
					if (result?.ok !== true) throw result?.error instanceof Error ? result.error : new Error(result?.error?.message ?? "平台语音服务调用失败");
					return result.value;
				};
				const readCatalog = async () => unwrap(await speech.catalog());
				const selectionOf = (catalog) => {
					const providerId = catalog?.selection?.providerId;
					if (!catalog?.providers?.length) throw new Error("平台未注册语音识别器，请在插件管理中启用语音输入插件。");
					if (!catalog.providers.some((provider) => provider.id === providerId)) throw new Error("平台选定的语音识别器不可用，请在语音输入设置中重新选择。");
					return { providerId, language: catalog.selection.language ?? "auto" };
				};
				const waitForUpdate = (signal) => new Promise((resolve, reject) => {
					const aborted = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(signal.reason ?? new Error("已停止等待语音")); };
					const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 750);
					if (signal.aborted) aborted();
					else signal.addEventListener("abort", aborted, { once: true });
				});
				bridge.speech = {
					/**
					* 确保识别器就绪。SenseVoice 首次使用需要下载并校验模型，
					* 这一步可能耗时数分钟，因此由界面显式触发而不是自动执行。
					*/
					async prepare({ signal: caller, onProgress } = {}) {
						const signal = caller ? AbortSignal.any([caller, lifetime.signal]) : lifetime.signal;
						signal.throwIfAborted();
						let catalog = await readCatalog();
						signal.throwIfAborted();
						const selection = selectionOf(catalog);
						const selectedProvider = () => catalog.providers.find((provider) => provider.id === selection.providerId);
						if (!["ready", "standby"].includes(selectedProvider()?.preparation?.phase ?? "ready")) {
							// Remote 按声明参数槽位校验数量；可选 options 也必须显式传入。
							unwrap(await speech.prepare(selection.providerId, {}));
							catalog = await readCatalog();
						}
						while (true) {
							signal.throwIfAborted();
							const provider = selectedProvider();
							if (!provider) throw new Error("语音识别器已卸载，请重新检查语音输入插件。");
							const state = provider.preparation ?? { phase: "ready" };
							if (state.phase === "ready" || state.phase === "standby") { preparedSelection = selection; return selection; }
							if (state.phase === "failed") throw new Error(state.message ?? "语音识别器准备失败，请到语音输入设置中重试。");
							if (state.phase === "cancelled") throw new Error("语音识别器准备已取消，可重新开始监听。");
							const labels = { checking: "正在检查语音资源…", downloading: "正在下载语音模型，首次使用需要一些时间…", loading: "正在加载语音模型…", waking: "正在唤醒语音模型…", cancelling: "正在取消语音准备…", unprepared: "正在准备语音识别器…" };
							onProgress?.(labels[state.phase] ?? "正在准备语音识别器…");
							await waitForUpdate(signal);
							catalog = await readCatalog();
						}
					},
					/** 识别一段规范 WAV。 */
					async transcribe(audioBase64, seconds, caller, selection = preparedSelection) {
						const signal = caller ? AbortSignal.any([caller, lifetime.signal]) : lifetime.signal;
						signal.throwIfAborted();
						selection ??= selectionOf(await readCatalog());
						const request = {
							audioBase64,
							...selection,
						};
						void seconds;
						const result = await speech.transcribe(request, signal);
						signal.throwIfAborted();
						return unwrap(result);
					},
				};
				bridge.notify();
				return () => {
					lifetime.abort();
					bridge.speech = null;
					bridge.notify();
				};
			});

			// ── 右侧边栏：实时陪练标签页 ─────────────────────────────────
			ctx.inject(["sidebarRightTabs"], () => {
				const disposeType = ctx.sidebarRightTabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					// extension 是注册方自带的最高优先级档；与内置的 guide 不冲突
					// （kind 不同），因此不会挤掉任何现有标签页。
					priority: "extension",
					title: () => "e销宝",
					guide: [{
						id: "cqai-xiaobao-live",
						order: 45,
						title: () => "e销宝实时陪练",
						description: () => "实时转写、话术建议与人工接管",
						icon: XiaobaoIcon,
					}],
				});
				return () => disposeType();
			});

			const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: TAB_ID,
			}, (props) => react.createElement(LiveCoachPanel, { ...props, bridge })));

			const disposeTitle = ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: TAB_ID,
			}, LiveCoachTitle));

			// ── 插件管理页：e销宝 自己的配置页 ───────────────────────────
			// 键必须是包名：插件管理器用 `keysOf("plugins.bundle.config")` 与
			// 包名比对来决定是否渲染这一页。
			const disposeConfig = ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: PLUGIN_ID,
			}, (props) => react.createElement(KnowledgeConsole, { ...props, bridge, compact: false })));

			// ── 左侧工作台：知识库批量管理 ───────────────────────────────
			const disposeMain = ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: WORKBENCH_PANEL,
			}, (props) => react.createElement(KnowledgeConsole, { ...props, bridge, compact: true })));

			const disposePanelList = ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: WORKBENCH_PANEL,
				order: 46,
				label: "e销宝",
			}, ({ size }) => react.createElement(XiaobaoIcon, { size })));

			// 插件停用时释放全部注册；平台会在 fiber 卸载时调用这些 disposer，
			// 但显式返回一次让依赖关系在代码里可见。
			return () => {
				disposePanelList();
				disposeMain();
				disposeConfig();
				disposeTitle();
				disposeBody();
				bridge.speech = null;
				listeners.clear();
			};
		}

		/** e销宝 的统一图标，用内联 SVG 避免额外的资源请求。 */
		function XiaobaoIcon({ size }) {
			const edge = typeof size === "number" ? size : 18;
			return react.createElement("svg", {
				width: edge,
				height: edge,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				style: { display: "block", flexShrink: 0 },
				"aria-hidden": "true",
				draggable: false,
			},
				react.createElement("path", { d: "M20.5 12.2c0 3.9-3.8 7.1-8.5 7.1-.9 0-1.8-.1-2.6-.3L4.6 20.5l1.2-3.6C4.3 15.6 3.5 14 3.5 12.2c0-3.9 3.8-7.1 8.5-7.1s8.5 3.2 8.5 7.1Z" }),
				react.createElement("path", { d: "M7.9 13.2l2.6-2.7 1.9 1.8 3.6-3.7" }),
				react.createElement("path", { d: "M13.9 8.6h2.9v2.9" }),
			);
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// 导出内部构造，便于测试在不挂载 React 的前提下验证编码与形状。
		exports.__internals = { encodeWav, resample, rms, toBase64, request, PcmCapture };
		return module.exports;
	}
});
