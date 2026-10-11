window.__ModuleLoader__.load({
	id: "cqai-dsh-plugin-xiaobao",
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
		const PLUGIN_ID = "cqai-dsh-plugin-xiaobao";
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
		//#endregion

		//#region styles
		const styles = `
.cqaiXb{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit}
.cqaiXb *{box-sizing:border-box}
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
.cqaiXb button:hover:not(:disabled){background:var(--dsw-alias-bg-overlay)}
.cqaiXb button:disabled{opacity:.45;cursor:not-allowed}
.cqaiXb button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.cqaiXb button[data-variant=primary]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff)}
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
			if (payload === void 0) throw new Error(`HTTP ${response.status}`);
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
		* v1 按固定时长切段（默认 4 秒），每段独立送平台 ASR。这不是流式识别：
		* 平台的语音服务接受的是一次完整的规范 WAV，返回整段文本。分段长度因此
		* 是「延迟」与「句子完整性」之间的取舍，4 秒是两者的折中。
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
				this.buffer.push(chunk);
				this.collected += chunk.length;
				const needed = Math.round((this.segmentMs / 1000) * this.sourceRate);
				if (this.collected < needed) return;

				const merged = new Float32Array(this.collected);
				let offset = 0;
				for (const part of this.buffer) {
					merged.set(part, offset);
					offset += part.length;
				}
				this.buffer = [];
				this.collected = 0;
				this.emit(merged);
			}

			/** 把一段采样重采样、静音过滤后交给回调。 */
			emit(samples) {
				try {
					const resampled = resample(samples, this.sourceRate, WAV_SAMPLE_RATE);
					if (rms(resampled) < SILENCE_RMS_THRESHOLD) return; // 整段静音，不送识别。
					// 少于 0.3 秒的片段既不可靠也不值得一次推理。
					if (resampled.length < WAV_SAMPLE_RATE * 0.3) return;
					this.onSegment(toBase64(encodeWav(resampled)), resampled.length / WAV_SAMPLE_RATE);
				} catch (error) {
					this.onError?.(error);
				}
			}

			/** 停止采集并释放全部媒体资源。可重复调用。 */
			stop() {
				this.stopped = true;
				try {
					if (this.processor !== void 0) {
						this.processor.onaudioprocess = null;
						this.processor.disconnect();
					}
					this.source?.disconnect();
					this.sink?.disconnect();
				} catch {
					// 资源可能已被浏览器回收，忽略。
				}
				for (const track of this.stream?.getTracks() ?? []) track.stop();
				this.context?.close?.().catch(() => void 0);
				this.processor = void 0;
				this.source = void 0;
				this.sink = void 0;
				this.stream = void 0;
				this.context = void 0;
				this.buffer = [];
				this.collected = 0;
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
			const reload = react.useCallback(() => {
				let alive = true;
				setState((previous) => ({ ...previous, loading: true }));
				loader()
					.then((data) => {
						if (alive) setState({ loading: false, error: "", data });
					})
					.catch((cause) => {
						const message = cause instanceof Error ? cause.message : String(cause);
						if (alive) setState({ loading: false, error: message, data: void 0 });
					});
				return () => {
					alive = false;
				};
			}, deps);
			react.useEffect(() => reload(), [reload]);
			return { ...state, reload };
		}
		//#endregion

		//#region live panel
		/**
		* 右侧边栏的实时陪练面板。
		*
		* 布局对齐开发计划 §4.1 的线框：会话头 → 服务状态 → 实时转写 →
		* 当前识别 → 推荐回应 → 备用说法 → 建议追问 → 风险 → 来源 → 操作栏。
		*
		* 一次只显示一条主建议与一条备用建议（§9.2），避免干扰销售节奏。
		*/
		function LiveCoachPanel({ bridge }) {
			useBridgeVersion(bridge);

			const [state, setState] = react.useState("idle");
			const [speaker, setSpeaker] = react.useState("customer");
			const [turns, setTurns] = react.useState([]);
			const [provisional, setProvisional] = react.useState("");
			const [bundle, setBundle] = react.useState(null);
			const [error, setError] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [recognizing, setRecognizing] = react.useState(false);
			const [manual, setManual] = react.useState("");
			const [copied, setCopied] = react.useState("");
			const [handoffTask, setHandoffTask] = react.useState(null);
			const [sessionId] = react.useState(() => `s-${Date.now().toString(36)}`);
			const capture = react.useRef(null);
			const turnsRef = react.useRef([]);

			react.useEffect(() => {
				turnsRef.current = turns;
			}, [turns]);

			/** 把一段客户或销售文本送进链路并取回建议。 */
			const analyze = react.useCallback(async (text, who) => {
				const trimmed = text.trim();
				if (trimmed.length === 0) return;
				setTurns((previous) => [...previous, { speaker: who, text: trimmed, at: Date.now() }]);
				if (who !== "customer") return; // 销售发言只入上下文，不触发客户异议建议。

				setBusy(true);
				setError("");
				try {
					const payload = await request("suggest", {
						method: "POST",
						body: {
							session_id: sessionId,
							utterance: trimmed,
							speaker: who,
							event_id: eventId("utt"),
							confidence: void 0,
						},
					});
					setBundle(payload);
					setCopied("");
					setHandoffTask(null);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setBusy(false);
				}
			}, [sessionId]);

			/** 启动语音采集。 */
			const startListening = react.useCallback(async () => {
				const speech = bridge.speech;
				if (speech === null) {
					setError("未检测到平台的语音识别服务。请启用语音输入插件，或改用手动输入。");
					return;
				}
				setError("");
				setState("connecting");
				try {
					// SenseVoice 首次使用需要准备（下载并校验模型），先确保就绪。
					await speech.prepare();
					const instance = new PcmCapture({
						segmentMs: bridge.segmentMs,
						onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
						onSegment: async (audioBase64, seconds) => {
							if (instance.stopped) return;
							setRecognizing(true);
							try {
								const result = await speech.transcribe(audioBase64, seconds);
								const text = String(result?.text ?? "").trim();
								if (text.length > 0) {
									setProvisional("");
									await analyze(text, speakerRef.current);
								}
							} catch (cause) {
								setError(`识别失败：${cause instanceof Error ? cause.message : String(cause)}`);
							} finally {
								setRecognizing(false);
							}
						},
					});
					await instance.start();
					if (instance.stopped) {
						instance.stop();
						return;
					}
					capture.current = instance;
					setState("listening");
					await request("session", { method: "POST", body: { session_id: sessionId, state: "listening" } }).catch(() => void 0);
				} catch (cause) {
					setState("error");
					const message = cause instanceof Error ? cause.message : String(cause);
					setError(message.includes("NotAllowed") || message.includes("Permission")
						? "麦克风权限被拒绝。请在系统设置里允许本应用使用麦克风，或改用手动输入。"
						: `无法启动语音采集：${message}`);
				}
			}, [analyze, bridge, sessionId]);

			/** 暂停采集但保留会话与转写。 */
			const pause = react.useCallback(async () => {
				capture.current?.stop();
				capture.current = null;
				setState("paused");
				setProvisional("");
				await request("session", { method: "POST", body: { session_id: sessionId, state: "paused" } }).catch(() => void 0);
			}, [sessionId]);

			/** 结束会话并取回复盘。 */
			const finish = react.useCallback(async () => {
				capture.current?.stop();
				capture.current = null;
				setState("ended");
				setProvisional("");
				try {
					const payload = await request("debrief", { method: "POST", body: { session_id: sessionId } });
					setBundle((previous) => ({ ...(previous ?? {}), debrief: payload.report }));
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [sessionId]);

			// 组件卸载时必须释放麦克风；这是开发计划 §4.3 的硬要求。
			react.useEffect(() => () => {
				capture.current?.stop();
				capture.current = null;
			}, []);

			// 用 ref 保存当前说话人，供采集回调读取而不重建采集器。
			const speakerRef = react.useRef(speaker);
			react.useEffect(() => {
				speakerRef.current = speaker;
			}, [speaker]);

			/** 记录销售对建议的反馈。 */
			const feedback = react.useCallback(async (kind) => {
				const text = bundle?.suggestion?.recommended_reply ?? "";
				if (kind === "copied") {
					try {
						await navigator.clipboard.writeText(text);
						setCopied("已复制主建议");
						setTimeout(() => setCopied(""), 2000);
					} catch {
						setError("无法写入剪贴板，请手动选择文本复制。");
						return;
					}
				}
				await request("feedback", {
					method: "POST",
					body: { session_id: sessionId, kind, suggestion_id: bundle?.suggestion?.intent ?? null, event_id: eventId("fb") },
				}).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
			}, [bundle, sessionId]);

			/** 建立人工接管任务。 */
			const handoff = react.useCallback(async () => {
				try {
					const payload = await request("handoff", {
						method: "POST",
						body: {
							session_id: sessionId,
							reason: bundle?.handoff?.reasons?.[0] ?? "manual",
							risk_reasons: bundle?.handoff?.reasons ?? [],
							unknown: bundle?.handoff?.required ? ["等待人工确认客户诉求"] : [],
							event_id: eventId("ho"),
						},
					});
					setHandoffTask(payload.task);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [bundle, sessionId]);

			const suggestion = bundle?.suggestion;
			const speechReady = bridge.speech !== null;
			const stateLabel = {
				idle: "未连接",
				connecting: "连接中",
				listening: "实时监听",
				paused: "已暂停",
				ended: "已结束",
				error: "服务异常",
			}[state] ?? state;

			return react.createElement("section", { className: "cqaiXb", "data-cqai-xiaobao-live": "" },
				react.createElement("style", null, styles),

				react.createElement("header", { className: "cqaiXb-head" },
					react.createElement("h1", { className: "cqaiXb-title" },
						react.createElement("span", { className: "cqaiXb-dot", "data-state": state }),
						"e销宝"),
					react.createElement("span", { className: "cqaiXb-tag" }, `会话 ${sessionId.slice(-6)}`),
					react.createElement("span", { className: "cqaiXb-tag", "data-tone": state === "listening" ? "ok" : state === "error" ? "bad" : "warn" }, stateLabel),
					recognizing ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, "识别中…") : null,
				),

				// 音频 / ASR / 推荐三者各自独立报告状态（§4.1 的要求）。
				react.createElement("div", { className: "cqaiXb-svc" },
					react.createElement("span", { className: "cqaiXb-tag", "data-tone": state === "listening" ? "ok" : void 0 },
						`麦克风 ${state === "listening" ? "采集中" : state === "connecting" ? "连接中" : "未采集"}`),
					react.createElement("span", { className: "cqaiXb-tag", "data-tone": speechReady ? "ok" : "bad" },
						`ASR ${speechReady ? "可用" : "不可用"}`),
					react.createElement("span", { className: "cqaiXb-tag", "data-tone": busy ? "warn" : "ok" },
						`推荐 ${busy ? "生成中" : "就绪"}`),
					react.createElement("span", { className: "cqaiXb-tag" }, `模型 ${bundle?.model ? "已接入" : "未知"}`),
				),

				react.createElement("div", { className: "cqaiXb-scroll" },
					error !== "" ? react.createElement("p", { className: "cqaiXb-error", role: "alert" }, error) : null,

					// ── 实时转写 ──────────────────────────────────────────
					react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, "实时转写"),
						turns.length === 0 && provisional === ""
							? react.createElement("p", { className: "cqaiXb-note" }, "还没有内容。开始监听，或在下方直接输入客户原话。")
							: null,
						turns.slice(-8).map((turn, index) => react.createElement("div", { className: "cqaiXb-turn", key: `${turn.at}-${index}` },
							react.createElement("span", { className: "cqaiXb-who", "data-speaker": turn.speaker }, turn.speaker === "customer" ? "客户" : "销售"),
							react.createElement("span", { className: "cqaiXb-text" }, turn.text),
						)),
						provisional !== "" ? react.createElement("div", { className: "cqaiXb-turn" },
							react.createElement("span", { className: "cqaiXb-who", "data-speaker": "customer" }, "客户"),
							react.createElement("span", { className: "cqaiXb-text", "data-provisional": "true" }, `${provisional}（临时）`),
						) : null,
						react.createElement("div", { className: "cqaiXb-row" },
							react.createElement("span", { className: "cqaiXb-note" }, "当前说话人："),
							react.createElement("button", {
								type: "button",
								"data-variant": speaker === "customer" ? "primary" : void 0,
								onClick: () => setSpeaker("customer"),
							}, "客户"),
							react.createElement("button", {
								type: "button",
								"data-variant": speaker === "sales" ? "primary" : void 0,
								onClick: () => setSpeaker("sales"),
							}, "销售"),
						),
						react.createElement("p", { className: "cqaiXb-note" }, "说话人由你手动切换：平台的语音识别返回整段文字，不做自动说话人分离。"),
					),

					// ── 当前识别 ──────────────────────────────────────────
					suggestion !== void 0 && suggestion !== null ? react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, "当前识别"),
						react.createElement("div", { className: "cqaiXb-row" },
							react.createElement("span", { className: "cqaiXb-tag" }, `意图 ${suggestion.intent ?? "未知"}`),
							react.createElement("span", { className: "cqaiXb-tag", "data-tone": (suggestion.confidence ?? 0) < 0.5 ? "warn" : "ok" },
								`置信度 ${Math.round((suggestion.confidence ?? 0) * 100)}%`),
							(suggestion.confidence ?? 0) < 0.5 ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, "需确认") : null,
							bundle?.suppressed ? react.createElement("span", { className: "cqaiXb-tag" }, "复用近期建议") : null,
							bundle?.degraded ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, "已降级") : null,
						),
						bundle?.intent_candidates?.length > 1 ? react.createElement("p", { className: "cqaiXb-src" },
							`其它候选：${bundle.intent_candidates.slice(1).map((item) => `${item.intent} ${Math.round(item.score * 100)}%`).join(" · ")}`) : null,
						bundle?.degraded && bundle?.degraded_reason ? react.createElement("p", { className: "cqaiXb-note" }, `降级原因：${bundle.degraded_reason}`) : null,
					) : null,

					// ── 推荐回应 ──────────────────────────────────────────
					suggestion !== void 0 && suggestion !== null ? react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, suggestion.human_handoff ? "建议：转人工" : "推荐回应"),
						react.createElement("p", { className: "cqaiXb-quote", "data-primary": "true" }, suggestion.recommended_reply),
						react.createElement("div", { className: "cqaiXb-actions" },
							react.createElement("button", { type: "button", onClick: () => feedback("copied") }, "复制"),
							react.createElement("button", { type: "button", "data-variant": "primary", onClick: () => feedback("accepted") }, "已采用"),
							react.createElement("button", { type: "button", onClick: () => feedback("skipped") }, "不适用"),
							react.createElement("button", { type: "button", onClick: () => feedback("ineffective") }, "效果不佳"),
							copied !== "" ? react.createElement("span", { className: "cqaiXb-note" }, copied) : null,
						),
						suggestion.alternative_reply ? react.createElement(react.Fragment, null,
							react.createElement("h4", null, "备用说法"),
							react.createElement("p", { className: "cqaiXb-quote" }, suggestion.alternative_reply),
							react.createElement("div", { className: "cqaiXb-actions" },
								react.createElement("button", {
									type: "button",
									onClick: async () => {
										try {
											await navigator.clipboard.writeText(suggestion.alternative_reply);
											await feedback("copied");
										} catch {
											setError("无法写入剪贴板。");
										}
									},
								}, "复制备用说法"),
							),
						) : null,
						suggestion.follow_up_question ? react.createElement(react.Fragment, null,
							react.createElement("h4", null, "建议追问"),
							react.createElement("p", { className: "cqaiXb-quote" }, suggestion.follow_up_question),
						) : null,
						suggestion.reason ? react.createElement("p", { className: "cqaiXb-note" }, `依据：${suggestion.reason}`) : null,
					) : null,

					// ── 风险提示 ──────────────────────────────────────────
					(bundle?.handoff?.reasons?.length > 0 || (suggestion?.do_not_say?.length ?? 0) > 0) ? react.createElement("div", {
						className: "cqaiXb-risk",
						"data-level": bundle?.handoff?.required ? "high" : "medium",
					},
						react.createElement("strong", null, bundle?.handoff?.required ? "需要人工接管" : "风险提示"),
						bundle?.handoff?.reasons?.length > 0 ? react.createElement("ul", null,
							bundle.handoff.reasons.map((reason) => react.createElement("li", { key: reason }, reasonLabel(reason))),
						) : null,
						(suggestion?.do_not_say?.length ?? 0) > 0 ? react.createElement("p", { className: "cqaiXb-src" }, `不要承诺：${suggestion.do_not_say.join("；")}`) : null,
					) : null,

					// ── 来源 ──────────────────────────────────────────────
					(bundle?.sources?.length ?? 0) > 0 ? react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, "来源"),
						react.createElement("div", { className: "cqaiXb-src" },
							bundle.sources.map((source, index) => react.createElement("div", { key: `${source.id}-${index}` },
								source.kind === "phrase_card" ? "话术卡 " : "政策 ",
								react.createElement("code", null, source.id),
								" · ",
								source.label,
							)),
						),
					) : null,

					// ── 复盘 ──────────────────────────────────────────────
					bundle?.debrief ? react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, "本次复盘"),
						react.createElement("div", { className: "cqaiXb-kv" },
							react.createElement("dt", null, "客户发言"), react.createElement("dd", null, String(bundle.debrief.customer_turns)),
							react.createElement("dt", null, "建议条数"), react.createElement("dd", null, String(bundle.debrief.stats.suggestions)),
							react.createElement("dt", null, "采纳率"), react.createElement("dd", null, bundle.debrief.stats.acceptance_rate === null ? "暂无数据" : `${Math.round(bundle.debrief.stats.acceptance_rate * 100)}%`),
							react.createElement("dt", null, "知识缺口"), react.createElement("dd", null, String(bundle.debrief.knowledge_gaps.length)),
						),
						react.createElement("div", null,
							bundle.debrief.next_steps.map((step, index) => react.createElement("p", { className: "cqaiXb-note", key: index }, `· ${step}`)),
						),
						react.createElement("p", { className: "cqaiXb-src" }, "复盘内容只作为候选进入审核队列，不会自动发布为话术。"),
					) : null,

					// ── 人工接管任务 ──────────────────────────────────────
					handoffTask !== null ? react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, "人工接管任务已建立"),
						react.createElement("div", { className: "cqaiXb-kv" },
							react.createElement("dt", null, "任务号"), react.createElement("dd", null, react.createElement("code", null, handoffTask.task_id)),
							react.createElement("dt", null, "原因"), react.createElement("dd", null, handoffTask.reason),
							react.createElement("dt", null, "客户原话"), react.createElement("dd", null, handoffTask.customer_utterances.join(" / ") || "（无）"),
						),
					) : null,

					// ── 手动输入（ASR 不可用时的降级路径） ────────────────
					react.createElement("div", { className: "cqaiXb-card" },
						react.createElement("h4", null, speechReady ? "手动补充" : "手动输入（语音不可用）"),
						react.createElement("textarea", {
							className: "cqaiXb-textarea",
							value: manual,
							placeholder: "粘贴或输入客户原话，回车提交",
							onChange: (event) => setManual(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									analyze(manual, speaker);
									setManual("");
								}
							},
						}),
						react.createElement("div", { className: "cqaiXb-actions" },
							react.createElement("button", {
								type: "button",
								"data-variant": "primary",
								disabled: manual.trim().length === 0 || busy,
								onClick: () => {
									analyze(manual, speaker);
									setManual("");
								},
							}, busy ? "生成中…" : "生成建议"),
							react.createElement("span", { className: "cqaiXb-note" }, "临时转写只更新字幕；只有稳定句才会触发建议。"),
						),
					),
				),

				react.createElement("footer", { className: "cqaiXb-foot" },
					state === "listening"
						? react.createElement("button", { type: "button", onClick: pause }, "暂停分析")
						: react.createElement("button", {
							type: "button",
							"data-variant": "primary",
							disabled: !speechReady || state === "connecting",
							onClick: startListening,
						}, state === "paused" ? "恢复分析" : "开始监听"),
					react.createElement("button", { type: "button", disabled: state === "idle" || state === "ended", onClick: finish }, "结束会话"),
					react.createElement("button", { type: "button", "data-variant": "danger", onClick: handoff }, "请求人工协助"),
				),
			);
		}

		/** 人工接管原因码到界面文案。 */
		function reasonLabel(reason) {
			const labels = {
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
			const [tab, setTab] = react.useState("cards");
			const [error, setError] = react.useState("");
			const state = useAsyncData(() => request("knowledge"), []);
			const audit = useAsyncData(() => request("audit", { method: "GET" }), []);

			const cards = state.data?.cards ?? [];
			const facts = state.data?.facts ?? [];
			const health = state.data?.health;

			/** 统一的写操作包装：刷新数据并把错误显示在界面上。 */
			const mutate = react.useCallback(async (action, body) => {
				setError("");
				try {
					await request(action, { method: "POST", body });
					state.reload();
					audit.reload();
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, [state, audit]);

			const tabs = [
				["cards", "话术库"],
				["review", "审核队列"],
				["facts", "产品与政策"],
				["versions", "版本与健康"],
				["preview", "试运行"],
				["privacy", "连接与隐私"],
			];

			return react.createElement("div", {
				className: compact ? "cqaiXb" : "cqaiXb-console",
				"data-cqai-xiaobao-console": compact ? "compact" : "full",
			},
				react.createElement("style", null, styles),

				compact ? null : react.createElement("div", { style: { padding: "14px 20px 0" } },
					react.createElement("h2", { className: "cqaiXb-h2" }, "e销宝 知识管理"),
					react.createElement("p", { className: "cqaiXb-note" }, "实时推荐只读取「已发布」且在生效期内的话术卡与产品事实。这里的每一次发布、停用与回滚都会写入审计。"),
				),

				react.createElement("div", { className: "cqaiXb-tabs", role: "tablist" },
					tabs.map(([id, label]) => react.createElement("button", {
						key: id,
						type: "button",
						className: "cqaiXb-tab",
						role: "tab",
						"data-active": tab === id ? "true" : void 0,
						onClick: () => setTab(id),
					}, label)),
				),

				react.createElement("div", { className: "cqaiXb-body" },
					error !== "" ? react.createElement("p", { className: "cqaiXb-error", role: "alert" }, error) : null,
					state.loading ? react.createElement("p", { className: "cqaiXb-note" }, "正在读取知识库…") : null,
					state.error !== "" ? react.createElement("p", { className: "cqaiXb-error" }, state.error) : null,

					health !== void 0 ? react.createElement("div", { className: "cqaiXb-metrics" },
						metric("话术卡", health.counts.cards),
						metric("已发布", health.counts.approved_cards),
						metric("产品事实", health.counts.facts),
						metric("知识缺口", health.gaps.length),
						metric("冲突", health.conflicts.length),
						metric("过期", health.expired.length),
					) : null,

					tab === "cards" ? react.createElement(CardList, { cards, mutate }) : null,
					tab === "review" ? react.createElement(ReviewQueue, { cards, mutate }) : null,
					tab === "facts" ? react.createElement(FactList, { facts }) : null,
					tab === "versions" ? react.createElement(VersionHealth, { health, audit: audit.data?.entries ?? [] }) : null,
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
		function CardList({ cards, mutate }) {
			const [filter, setFilter] = react.useState("");
			const shown = cards.filter((card) => filter === "" || card.intent.includes(filter) || card.scenario.includes(filter));
			return react.createElement(react.Fragment, null,
				react.createElement("input", {
					className: "cqaiXb-input",
					placeholder: "按意图或场景筛选",
					value: filter,
					onChange: (event) => setFilter(event.target.value),
				}),
				react.createElement("div", { className: "cqaiXb-list" },
					shown.map((card) => react.createElement("article", { className: "cqaiXb-item", key: card.id },
						react.createElement("h5", null,
							card.scenario,
							react.createElement("span", { className: "cqaiXb-tag", "data-tone": card.status === "approved" ? "ok" : "warn" }, CARD_STATUS_LABELS[card.status] ?? card.status),
							react.createElement("span", { className: "cqaiXb-tag" }, `v${card.version}`),
							react.createElement("span", { className: "cqaiXb-tag", "data-tone": card.risk_level === "high" ? "bad" : void 0 }, `风险 ${RISK_LABELS[card.risk_level] ?? card.risk_level}`),
						),
						react.createElement("p", { className: "cqaiXb-quote" }, card.approved_responses?.[0] ?? "（无话术）"),
						react.createElement("div", { className: "cqaiXb-mono" }, `${card.id} · 意图 ${card.intent}`),
						react.createElement("div", { className: "cqaiXb-src" }, `客户表达示例：${(card.customer_utterances ?? []).join(" / ")}`),
						react.createElement("div", { className: "cqaiXb-actions" },
							card.status === "approved"
								? react.createElement("button", { type: "button", "data-variant": "danger", onClick: () => mutate(`cards/${encodeURIComponent(card.id)}/retire`, { actor: "ui" }) }, "停用")
								: react.createElement("button", { type: "button", "data-variant": "primary", onClick: () => mutate(`cards/${encodeURIComponent(card.id)}/approve`, { actor: "ui" }) }, "发布"),
							react.createElement("button", {
								type: "button",
								onClick: () => mutate(`cards/${encodeURIComponent(card.id)}/status`, { actor: "ui", status: "review" }),
							}, "退回待审"),
						),
					)),
					shown.length === 0 ? react.createElement("p", { className: "cqaiXb-empty" }, "没有匹配的话术卡。") : null,
				),
			);
		}

		/** 审核队列：只显示草稿与待审核内容。 */
		function ReviewQueue({ cards, mutate }) {
			const pending = cards.filter((card) => card.status === "draft" || card.status === "review");
			return react.createElement(react.Fragment, null,
				react.createElement("p", { className: "cqaiXb-note" }, "未审核内容不参与实时推荐。发布前请确认价格、优惠与效果表述都能在「产品与政策」里找到依据。"),
				pending.length === 0
					? react.createElement("p", { className: "cqaiXb-empty" }, "审核队列为空。")
					: react.createElement("div", { className: "cqaiXb-list" },
						pending.map((card) => react.createElement("article", { className: "cqaiXb-item", key: card.id },
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
							react.createElement("div", { className: "cqaiXb-actions" },
								react.createElement("button", { type: "button", "data-variant": "primary", onClick: () => mutate(`cards/${encodeURIComponent(card.id)}/approve`, { actor: "ui" }) }, "通过并发布"),
								react.createElement("button", { type: "button", "data-variant": "danger", onClick: () => mutate(`cards/${encodeURIComponent(card.id)}/retire`, { actor: "ui" }) }, "停用"),
							),
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
		function Preview({ }) {
			const [text, setText] = react.useState("");
			const [result, setResult] = react.useState(null);
			const [error, setError] = react.useState("");
			const [busy, setBusy] = react.useState(false);

			const run = react.useCallback(async () => {
				const trimmed = text.trim();
				if (trimmed.length === 0) return;
				setBusy(true);
				setError("");
				try {
					setResult(await request("preview", { method: "POST", body: { utterance: trimmed } }));
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setResult(null);
				} finally {
					setBusy(false);
				}
			}, [text]);

			return react.createElement(react.Fragment, null,
				react.createElement("p", { className: "cqaiXb-note" }, "粘贴一句客户原话，看看会召回哪些话术卡、生成什么建议、是否触发人工接管。试运行不写入会话，也不写审计。"),
				react.createElement("textarea", {
					className: "cqaiXb-textarea",
					value: text,
					placeholder: "例如：你们这个价格有点贵，有没有便宜一点的",
					onChange: (event) => setText(event.target.value),
				}),
				react.createElement("div", { className: "cqaiXb-actions" },
					react.createElement("button", { type: "button", "data-variant": "primary", disabled: busy, onClick: run }, busy ? "运行中…" : "运行试运行"),
				),
				error !== "" ? react.createElement("p", { className: "cqaiXb-error" }, error) : null,

				result !== null ? react.createElement(react.Fragment, null,
					react.createElement("div", { className: "cqaiXb-metrics" },
						metric("意图", result.suggestion?.intent ?? "未知"),
						metric("置信度", `${Math.round((result.suggestion?.confidence ?? 0) * 100)}%`),
						metric("召回", result.recalled?.length ?? 0),
						metric("延迟(ms)", result.latency_ms ?? 0),
					),
					react.createElement("article", { className: "cqaiXb-item" },
						react.createElement("h5", null, "建议主话术", result.degraded ? react.createElement("span", { className: "cqaiXb-tag", "data-tone": "warn" }, "已降级") : null),
						react.createElement("p", { className: "cqaiXb-quote", "data-primary": "true" }, result.suggestion?.recommended_reply ?? "（无）"),
						result.suggestion?.follow_up_question ? react.createElement("p", { className: "cqaiXb-quote" }, `追问：${result.suggestion.follow_up_question}`) : null,
						result.suggestion?.reason ? react.createElement("p", { className: "cqaiXb-note" }, `依据：${result.suggestion.reason}`) : null,
					),
					react.createElement("article", { className: "cqaiXb-item" },
						react.createElement("h5", null, "召回明细"),
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
						react.createElement("dt", null, "识别方式"), react.createElement("dd", null, "平台内置的本地语音识别，按约 4 秒分段整段识别"),
						react.createElement("dt", null, "音频留存"), react.createElement("dd", null, "不落盘。每段音频只存在于内存中，识别完成后即丢弃"),
						react.createElement("dt", null, "转写留存"), react.createElement("dd", null, "仅保留在本次会话的内存里，供复盘使用；插件不写入独立数据库"),
						react.createElement("dt", null, "写入审计的字段"), react.createElement("dd", null, "只记录意图、是否降级、是否转人工、延迟与模型路由，**不记录客户原话**"),
					),
				),
				react.createElement("article", { className: "cqaiXb-item" },
					react.createElement("h5", null, "服务状态"),
					react.createElement("div", { className: "cqaiXb-kv" },
						react.createElement("dt", null, "语音服务"), react.createElement("dd", null, bridge.speech === null ? "不可用（未启用语音输入插件）" : "可用"),
						react.createElement("dt", null, "分段长度"), react.createElement("dd", null, `${bridge.segmentMs} 毫秒`),
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
				bridge.speech = {
					/**
					* 确保识别器就绪。SenseVoice 首次使用需要下载并校验模型，
					* 这一步可能耗时数分钟，因此由界面显式触发而不是自动执行。
					*/
					async prepare() {
						const catalog = await speech.catalog();
						const providerId = catalog?.selection?.providerId;
						const language = catalog?.selection?.language ?? "zh";
						if (providerId === void 0) throw new Error("平台没有可用的语音识别提供方");
						await speech.prepare(providerId, { language });
						return { providerId, language };
					},
					/** 识别一段规范 WAV。 */
					async transcribe(audioBase64, seconds) {
						const catalog = await speech.catalog();
						const request = {
							audioBase64,
							...(catalog?.selection?.providerId === void 0 ? {} : { providerId: catalog.selection.providerId }),
							language: "zh",
						};
						void seconds;
						return await speech.transcribe(request);
					},
				};
				bridge.notify();
				return () => {
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
		exports.__internals = { encodeWav, resample, rms, toBase64, request };
		return module.exports;
	}
});
