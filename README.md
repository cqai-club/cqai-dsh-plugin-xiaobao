# e销宝 (e-Xiaobao)

A realtime sales-coaching copilot plugin for **易宝工坊** (DeepSeek Harness), aimed at small teams serving consumers.

While a salesperson is on a call, they open the **e销宝** panel in the right sidebar. Each time the customer finishes a sentence, the panel shows **one primary reply, one alternative, one suggested follow-up question, risk warnings, and the sources behind them**. The salesperson keeps full control of what gets said — e销宝 never speaks for them.

> 中文文档是主文档：[`README.zh.md`](README.zh.md) · [`安装说明`](docs/install.zh.md) · [`验收对照`](docs/acceptance.zh.md)

## What it does

- **Realtime coaching panel** (right sidebar tab): live transcript with provisional/final distinction, customer/sales speaker tags, intent + confidence, primary reply, alternative, follow-up, risk warnings, sources, and accept / edit / skip / human-handoff actions.
- **Knowledge management page** (this plugin's own page in the Plugins manager): phrase cards, review queue, product facts and policies, version health, a read-only preview sandbox, and connection/privacy details.
- **Sales strategy conversation** (left sidebar and coaching tab): a full-width conversation with one fixed composer. Each response includes customer assessment, communication goal, strategy, reply, follow-up, and cautions. Dictation fills the editable composer; optional continuous listening submits recognized segments. Feedback stays attached to its response. Switching tabs retains the conversation and pauses capture; failed submissions keep their text for retry.
- **Five agent tools**: `search_phrase_cards`, `get_product_policy`, `get_customer_context`, `save_coaching_feedback`, `request_human_handoff`.
- **Seven runtime skills**: `b2c-sales-context`, `b2c-need-discovery`, `product-recommendation`, `realtime-sales-coach`, `objection-handling`, `human-handoff`, `conversation-debrief`.

It deliberately does **not** register any tool that sends messages, places calls, changes prices or discounts, or issues refunds. That boundary lives in code, not in a prompt.

## The core design decision

Everything that can be computed deterministically is computed by code, not delegated to the model:

| Code decides | Model does |
|---|---|
| Which phrase cards are retrieved (keyword + character n-gram + metadata, fused) | Organise the retrieved evidence into one sentence a salesperson can say out loud |
| Content gating — only `approved`, in-effect content is retrievable | — |
| The eight human-handoff conditions | — |
| Forbidden-claim and unauthorised-number interception | — |
| Source allow-listing (a model citing an unprovided source is discarded whole) | — |
| Duplicate-suggestion suppression, idempotency, audit | — |

Model output passes three gates: constrained input, structural validation plus a source allow-list, and pre-display interception. Any failure falls back to a **template suggestion** built directly from the top approved phrase card — and the panel labels it as degraded. Degradation is a designed path, not an error path.

## Install

See [`docs/install.zh.md`](docs/install.zh.md). Short version: point the Plugins manager's "add plugin" at this directory's absolute path, then restart the app.

No `npm install` is needed — `dependencies` is empty; only Node built-ins and injected platform services are used.

The npm package is `@cqaiclub/cqai-dsh-plugin-xiaobao`. Install it through the app's plugin manager or `dsh plugin --profile <profile> add @cqaiclub/cqai-dsh-plugin-xiaobao@0.2.0`. When migrating from the old unscoped package, disable it before enabling the new package; existing data stays under `$DSH_HOME/xiaobao/`. See [release instructions](docs/release.zh.md) and [changes](CHANGELOG.md).

## Data location

`$DSH_HOME/xiaobao/knowledge/` — `phrase-cards.json`, `facts.json`, `audit.jsonl`. Seed knowledge (30 phrase cards, 12 facts) is injected only into an empty store. The seed content exists to make the plugin usable out of the box; it is **not** trustworthy business fact — replace it before real use.

## Develop

```bash
node scripts/build-seed.mjs      # regenerate seed knowledge
node scripts/build-fixtures.mjs  # regenerate evaluation fixtures
node scripts/eval.mjs            # offline evaluation → docs/eval-report.md
node --test-isolation=none --test "test/*.test.mjs"
node scripts/selfcheck.mjs       # pre-delivery check (includes all tests + evaluation)
```

`--test-isolation=none` is required: the default isolation mode spawns a child process per test file, which the DSH Windows sandbox forbids (EPERM).

## Known limitations

Stated plainly so the boundaries are not misjudged:

- **Voice is segmented.** The platform accepts one complete 16 kHz mono WAV and returns its transcript. A pause of about 700 ms submits a segment, with a roughly 12 s cap during continuous speech; finishing dictation also submits the remaining audio. Recognition latency depends on the local model.
- **Speaker labels are manual.** The platform does not diarise; customer/sales is a manual toggle and can be wrong.
- **Retrieval is in-process JSON plus character n-grams**, not pgvector or BM25. Fine into the low thousands of cards.
- **Evaluation is over-fitted.** Samples and seed cards come from the same fixture, so the reported metrics are 100%. That shows the pipeline and gates work; it does **not** show generalisation to real calls. See [`docs/eval-report.md`](docs/eval-report.md) for the held-out re-measurement procedure.

## License

MIT — see [`LICENSE`](LICENSE).
