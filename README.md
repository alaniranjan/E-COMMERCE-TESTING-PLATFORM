# AI-Powered E-commerce Testing Platform

A Playwright + TypeScript test automation framework for e-commerce applications, with an AI layer
(local open-source LLM via Ollama) for test-case generation and failure analysis.

> **Status:** Phases 1–8 of 11 (framework, POM, UI coverage, API automation, reporting, local LLM layer, AI test-case generator, AI failure analyzer, AI bug report drafts)
> plus the execution dashboard (Phase 9 core). AI features, API tests and Allure arrive in later phases.

- **UI automation uses the practice e-commerce application** [SauceDemo](https://www.saucedemo.com/).
- **API automation uses a controlled test API**: a local mock REST API in `mock-api/`, started automatically by
  Playwright. SauceDemo does not expose a public API, so no endpoints are attributed to it.

## Tech stack

| Area | Tool |
|---|---|
| Test runner | Playwright Test |
| Language | TypeScript, Node.js ≥ 18 |
| Browsers | Chromium, Firefox, WebKit |
| Config | dotenv (`.env`) |
| Reports | Allure 3, Playwright HTML, JSON, structured JSONL logs |
| AI | Ollama (local, open-source models), default `qwen2.5:7b`, behind an `AIProvider` interface |

## Folder structure

```
config/        environments.ts (per-env defaults), testConfig.ts (paths, retries, tags), globalSetup.ts
allurerc.mjs   Allure 3 report config: history, grouping, failure categories
utils/         config.ts (validated env), logger.ts, testData.ts, fileUtils, dateUtils, priceUtils
pages/         BasePage + LoginPage, ProductsPage, ProductDetailsPage, CartPage, CheckoutPage
components/    Header, ProductCard, CartItem (reused across pages)
fixtures/      testFixtures.ts (page objects, data, logging, Allure labels), authFixture.ts, apiFixtures.ts
test-data/     users, products, checkout, negative-data (+ optional <TEST_ENV>/ overrides)
tests/ui/      login, product, cart, checkout, negative, e2e-purchase specs
tests/api/     auth, products, cart, order API specs
api/           ApiClient (APIRequestContext wrapper), AuthApi, ProductApi, CartApi, OrderApi, JSON schemas
mock-api/      Controlled test API (Express, in-memory): auth, products, cart, orders, fault injection
ai/            AIProvider interface, BaseAIProvider (redaction, limits), OllamaProvider, MockAIProvider, factory
ai/prompts/    Versioned prompt templates (testCasePrompt, failurePrompt, rootCausePrompt, bugPrompt, correctionPrompt)
ai/parsers/    AIResponseParser: safe JSON extraction + schema/semantic validation
ai/services/   TestCaseGenerator, FailureAnalyzer, RootCauseAnalyzer, BugReportGenerator, structuredCall (validate + retry), guardrails, stores
analyzer/      TestResultParser, TraceCollector, ScreenshotCollector, LogCollector, signals, EvidenceBuilder
tests/ai-demo/ Controlled failures for demonstrating the analyzer (run only on request)
ai/context/    Short description of the application under test, given to the generator
ai/eval/       Labelled failure cases for measuring AI accuracy
tests/ai/      AI layer tests (fake Ollama server) + live model checks
scripts/       ai-check (health + sample prompts), ai-benchmark (model comparison), generate-test-cases
```

## Setup

```bash
npm install
npx playwright install                  # download browsers
sudo npx playwright install-deps        # Linux only: OS libraries (needed for WebKit)
cp .env.example .env                    # then fill in values
```

### Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `TEST_ENV` | Selects defaults and `test-data/<env>/` overrides | `qa` |
| `BASE_URL` | Application under test — change this to target another store | `https://www.saucedemo.com` |
| `TEST_USER_PASSWORD` | Shared password for SauceDemo demo users | shown on SauceDemo login page |
| `HEADLESS` | `true` / `false` | `true` |
| `ACTION_TIMEOUT`, `NAVIGATION_TIMEOUT` | ms | `10000`, `30000` |
| `API_BASE_URL` | Controlled test API (mock) | `http://127.0.0.1:3001` |
| `API_USERNAME`, `API_PASSWORD` | Seeded mock API user | local-only values |
| `API_RESPONSE_TIME_MS` | Response-time budget for API assertions | `1000` |
| `AI_PROVIDER` | `ollama` or `mock` (deterministic, no model) | `ollama` |
| `AI_MODEL` | Ollama model name | `qwen2.5:7b` |
| `OLLAMA_BASE_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `AI_TIMEOUT` | Per-request timeout (ms); CPU inference is slow | `120000` |
| `AI_MAX_TOKENS`, `AI_TEMPERATURE` | Output limit and randomness | `1024`, `0.2` |
| `AI_MAX_PROMPT_CHARS` | Longer prompts are truncated (middle removed) | `12000` |
| `AI_GENERATION_TIMEOUT` | Timeout for long generations (ms) | `600000` |
| `AI_KEEP_ALIVE` | How long Ollama keeps the model loaded | `30m` |
| `AI_APP_CONTEXT_FILE` | Application description given to the generator | `ai/context/saucedemo.md` |
| `AI_FAILURE_PROMPT` | Failure-analysis prompt version (`failure-v1`, `failure-v2`) | `failure-v2` |

`.env` is git-ignored. Missing or malformed values fail fast with a clear message.

## Running tests

```bash
npm test                          # all tests, all browsers
npm run test:ui                   # tests/ui only
npm run test:api                  # API tests (starts the mock API automatically)
npm run mock-api                  # run the mock API on its own, e.g. to explore it with curl
npm run test:ai                   # AI layer tests (live-model tests skip if Ollama is not running)
npm run ai:check                  # is the AI provider usable? health + timed sample prompts
npm run ai:benchmark -- qwen2.5:3b qwen2.5:7b   # compare models on labelled failures
npm run ai:generate -- "User should be able to add a product to cart and complete checkout." [--max 5] [--types functional,negative]
npm run ai:analyze [-- --root-cause]  # analyze failed tests in reports/results.json
npm run ai:bug-report             # analysis + bug report drafts for failed tests in reports/results.json
npm run test:ai-demo              # run the controlled failures, analyze them, draft bug reports, rebuild Allure
npm run ai:eval                   # failure analyzer accuracy on held-out labelled cases
npm run test:smoke                # @smoke tagged tests
npm run test:regression           # @regression tagged tests
npm run test:chromium             # Chromium UI tests + API tests
npm run test:headed               # watch the browser
npm run test:debug                # Playwright Inspector
npm run report                    # open Playwright HTML report
npm run allure:generate           # build the Allure report from the last run
npm run allure:open               # serve the Allure report
npm run report:allure             # generate + open
npm run typecheck                 # TypeScript check
```

## Reporting

Every run produces two reports from the same results, plus structured logs.

| Output | When | Location |
|---|---|---|
| Allure results (raw) | every run, cleared at start | `reports/allure-results/` |
| Allure report | `npm run allure:generate` | `reports/allure/` |
| Allure history (trends) | appended on each generate | `reports/allure-history.jsonl` |
| Playwright HTML report | every run | `reports/html/` |
| JSON results | every run | `reports/results.json` |
| Screenshot, video | failed tests | `test-results/<test>/`, attached to both reports |
| Playwright trace | failed tests | `test-results/<test>/trace.zip` → `npx playwright show-trace <path>` |
| Structured run log | every run | `reports/logs/<runId>.jsonl` (secrets masked) |
| Per-test log | failed tests | `test-log.jsonl` attachment |
| API request/response log | failed API tests | `api-exchanges.json` attachment (secrets masked) |

**Allure report contents**

- **Grouping:** Epic (UI Automation / API Automation) → Feature (describe block) → Story (nested describe).
- **Labels, added automatically** by the `testLogging` fixture ([fixtures/testFixtures.ts](fixtures/testFixtures.ts)), so
  spec files contain no reporting code:
  - severity from tags: `@e2e` blocker, `@smoke` critical, `@known-issue` minor, otherwise normal
  - a `tc` label with the test case id (TC01…)
  - the Playwright tags
- **Environment:** `TEST_ENV`, `BASE_URL`, `API_BASE_URL`, headless mode, run id, Node and OS.
- **Steps:** Playwright steps and `test.step` blocks, with attachments on the step where they happened.
- **Failure categories** ([allurerc.mjs](allurerc.mjs)): rule-based regex on the error text, first match wins.

  | Category | Matches |
  |---|---|
  | Infrastructure / environment | browser launch failures, connection refused, network errors |
  | Locator timeout (possible selector or synchronisation issue) | locator actions that time out |
  | API contract mismatch (status or schema) | `toHaveStatus` / `toMatchSchema` failures |
  | Assertion failure (possible product defect) | any other failed assertion |
  | Test errors (broken tests) | non-assertion exceptions |

  These are heuristics, not root-cause analysis. The AI failure analyzer (Phase 7) is the evidence-based layer on top.
- **History:** trend and per-test history across runs, from `reports/allure-history.jsonl`.

Allure 3 is pure Node, so no Java is needed. It does not overwrite an existing report folder, so
`allure:generate` deletes `reports/allure` first.

**Logs**

Every line has `timestamp`, `level`, `runId`, `test`, `browser`, `action`, and `status`/`error` where relevant.
The current test is tracked per worker, so page-object actions (e.g. `login`) are tagged with the test that ran them.
Passwords, tokens and `Authorization` headers are masked. `LOG_LEVEL` (default `INFO`) controls the file; the
per-test attachment always includes `DEBUG` lines such as each API request.

## Test coverage

37 UI tests per browser + 66 API tests. Suites are built from tags: `@smoke` (11), `@regression` (103),
`@negative` (51), `@boundary` (5), `@api` (66), `@e2e` (1). API tests run once in the browser-less `api` project.

| ID | Scenario | Spec |
|---|---|---|
| TC01–TC06 | Valid login, invalid username/password, empty username/password, locked user | login |
| — | Logout; protected page requires login | login |
| TC07 | Product list displayed (6 products with name, description, price, button) | product |
| TC08 | Product details match the listing | product |
| TC09 | Sorting A–Z, Z–A, price low–high, high–low (expected order from test data) | product |
| TC10–TC11 | Add / remove product from the listing | product |
| TC12 | Every listing price matches test data; details price matches listing | product |
| TC13–TC15 | Add one, add multiple, remove from cart | cart |
| TC16 | Cart badge count increments/decrements and survives reload | cart |
| TC17 | Cart line sum, item total, 8% tax and grand total | cart |
| TC18 | Valid checkout reaches the overview with payment and shipping info | checkout |
| TC19–TC21 | Missing first name / last name / postal code | checkout |
| TC22 | All fields empty; whitespace-only fields (known issue) | checkout |
| TC23 | Order completion, cart cleared, back to products | checkout |
| E2E | Login → listing → details → cart → checkout → review → confirmation, one `test.step` per stage | e2e-purchase |
| — | Non-existent product id, cart/checkout require login, empty-cart checkout (known issue), cart persists across logout | negative |

### Known issues (`@known-issue`)

These tests assert the correct behaviour and use `test.fail()` because SauceDemo does not implement it. They show as
passing ("expected to fail"). If SauceDemo ever fixes the behaviour, Playwright reports them as failed so the
annotation can be removed.

| Test | Current SauceDemo behaviour |
|---|---|
| TC22 whitespace-only checkout fields are rejected | `"   "` is accepted for first name, last name and postal code |
| Checkout with an empty cart is blocked | Checkout starts with zero items |

## API automation

**API automation uses a controlled test API**, not SauceDemo. `mock-api/` is a small Express server with in-memory
data (seeded with the SauceDemo catalog names for familiarity). Playwright's `webServer` starts it before tests and
stops it afterwards.

```
tests/api/*.spec.ts ─▶ fixtures/apiFixtures.ts ─▶ api/ProductApi, CartApi, OrderApi, AuthApi
                                                        │
                                                        ▼
                                  api/ApiClient.ts (Playwright APIRequestContext:
                                  bearer token, timing, JSON parsing, masked exchange log)
                                                        │ HTTP
                                                        ▼
                                  mock-api/ (Express, in-memory, 127.0.0.1:3001)
```

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | — | 201; 409 if username taken |
| POST | `/api/auth/login` | — | 200 `{ token }`; 401 bad credentials; 403 locked user |
| GET | `/api/products` | — | Filters `category`, `minPrice`, `maxPrice`; `sort`; `page`, `pageSize` (1–50) |
| GET | `/api/products/:id` | — | 404 unknown, 400 non-numeric id |
| POST | `/api/products` | Bearer | 201 + `Location`; 409 duplicate SKU; price 0.01–10000 |
| PUT / PATCH / DELETE | `/api/products/:id` | Bearer | Full replace / partial update / 204 delete |
| GET | `/api/cart` | Bearer | Per-user cart with line totals and subtotal |
| POST | `/api/cart/items` | Bearer | Quantity 1–10 per product; 409 above stock |
| PATCH / DELETE | `/api/cart/items/:productId` | Bearer | Change quantity / remove line |
| DELETE | `/api/cart` | Bearer | Clear cart (204) |
| POST | `/api/orders` | Bearer | 201; 8% tax; empty cart 400; `Idempotency-Key` replays return 200 with the same order |
| GET | `/api/orders`, `/api/orders/:id` | Bearer | Own orders only (others' orders are 404) |
| PATCH | `/api/orders/:id` | Bearer | `{ "status": "cancelled" }`; 409 if already cancelled |

Errors always use `{ "error": { "code", "message", "details?" } }`.

**What the API tests cover**

| Check | How |
|---|---|
| Status codes | Custom `toHaveStatus()` prints the response body on mismatch |
| Response body | `toMatchObject` / `toEqual` against expected values from `test-data/api-data.json` |
| JSON schema | Custom `toMatchSchema()` (Ajv) with `additionalProperties: false`, so unexpected fields fail |
| Authentication | Missing token, invalid token, bad credentials, locked user, masked secrets in logs |
| Required fields / missing parameters | Each required product field omitted; missing shipping fields; empty and malformed bodies |
| Invalid input | Wrong types, unknown fields, invalid enum, non-numeric id, whitespace-only names |
| Boundary values | Price 0 / 0.01 / 10000 / 10000.01, name length 100/101, quantity 0/1/10/11, page size 0/1/50/51 |
| Duplicate requests | Duplicate SKU (409), duplicate username (409), `Idempotency-Key` replay creates one order |
| Response time | Custom `toRespondWithin()` against `API_RESPONSE_TIME_MS`; a delay fault proves the timing is real |
| Server errors | A 500 fault is surfaced with its error body, then the endpoint recovers |

**Isolation and fault injection**

- Every test registers its own user (`apiUser` fixture), so carts and orders never collide in parallel runs.
- `faults.inject({ path, status, delayMs, times })` makes the mock return an error or respond slowly **only for the
  calling test** (matched by an `X-Fault-Scope` header). Phase 7 uses this for the "API returned 500" AI demo.
- When an API test fails, the full request/response log is attached to the report as `api-exchanges.json`, with
  passwords, tokens and `Authorization` headers masked. The AI failure analyzer will use this as evidence.

## AI layer (local LLM)

The platform uses **prompting on a local open-source model**, not a model trained from scratch. Everything that talks
to a model goes through one interface, so the provider or model can change via configuration.

```
services (Phase 6+) ──▶ AIProvider (interface)
                            ▲
                     BaseAIProvider ── redact secrets ─ limit prompt size ─ log sizes/timings (never content)
                       ▲          ▲
             OllamaProvider   MockAIProvider      (future: OpenAIProvider, HuggingFaceProvider)
                   │
                   ▼ HTTP /api/chat
             Ollama (127.0.0.1:11434) ─ qwen2.5:7b
```

| Piece | Responsibility |
|---|---|
| `AIProvider` | `generate()`, `generateJSON()`, `healthCheck()`; typed `AIProviderError` codes: `UNAVAILABLE`, `MODEL_NOT_FOUND`, `TIMEOUT`, `INVALID_RESPONSE`, `UNSUPPORTED`, `CONFIG`, `PROVIDER_ERROR` |
| `BaseAIProvider` | Applies redaction and size limits before any provider code runs, so no provider can skip them |
| `OllamaProvider` | Chat API, JSON mode / JSON-schema structured output, timeouts, error mapping, model and vision capability checks |
| `MockAIProvider` | Deterministic responses for testing AI-using code without a model; goes through the same safety path |
| `providerFactory` | `AI_PROVIDER` → instance. New provider = extend `BaseAIProvider`, implement `complete()` + `healthCheck()`, add a case |

**Safety (§29, §30)**

- **Redaction** ([ai/security/redact.ts](ai/security/redact.ts)) masks, before sending:
  - bearer tokens, JWTs and AWS keys
  - `password=` / `"token": "…"` style fields and credentials embedded in URLs
  - long hex tokens, email addresses, and card numbers (checked with Luhn so order ids are not masked)
  - the exact passwords configured in `.env`
- **Limits:** prompts over `AI_MAX_PROMPT_CHARS` are truncated keeping the start and end; output is capped by `AI_MAX_TOKENS`.
- **Logging:** only sizes, token counts, timings and redaction counts are logged, never prompt or response text.
- **Honest capabilities:** images sent to a text-only model are refused (`UNSUPPORTED`), not silently dropped. `healthCheck()`
  reports `supportsVision`, so screenshot analysis can say when visual inspection is unavailable.
- **Failures never break tests:** every failure is a typed error, so callers can show "AI analysis unavailable" and keep
  the normal Playwright result.

**Setup**

Installed without root from Ollama's standalone Linux build (the official script needs `sudo`):

```bash
mkdir -p ~/.local/ollama ~/.local/bin
curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | zstd -d | tar -x -C ~/.local/ollama
ln -sf ~/.local/ollama/bin/ollama ~/.local/bin/ollama
ollama serve                 # keep running (or: sudo script from ollama.com for a system service)
ollama pull qwen2.5:7b       # 4.7 GB; qwen2.5:3b (1.9 GB) is the faster option
npm run ai:check
```

**Model choice: baseline measurements**

`npm run ai:benchmark` on this development laptop (Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz, 8 threads, 15 GB RAM, CPU only, no GPU acceleration). It uses a deliberately
plain prompt on 6 labelled failures from `ai/eval/failure-cases.json`:

| Model | Correct classifications | Valid JSON | Avg time per analysis | Cold load |
|---|---|---|---|---|
| qwen2.5:3b | 3/6 | 6/6 | ~15 s | — (already loaded) |
| qwen2.5:7b | 4/6 | 6/6 | ~26 s | ~49 s |

Six cases are too few to separate the models; the 3B model over-predicts `ENVIRONMENT_FAILURE`. Both models return
schema-valid JSON, but a valid shape is not a correct answer. In one check the model chose `APPLICATION_DEFECT` while its own
reason described a test-script typo. This is why Phase 7 adds engineered prompts, evidence requirements and consistency checks,
and why AI output is always advisory.

## AI test case generator

Turns a requirement into **draft** structured test cases (§13, §14). A QA engineer reviews every case before it is used
(`reviewStatus: "pending"`). Generated JavaScript is never executed.

```
requirement ─▶ input checks ─▶ prompt (role, rules, app context, schema, example) ─▶ model (JSON-schema constrained)
                                                                                         │
            ┌─────────────── correction prompt (errors + previous answer) ◀── invalid ──┤
            │                                                                            │ valid
            └──▶ model ─▶ still invalid ─▶ status "failed", every attempt recorded       ▼
                                                    post-processing: renumber ids, remove duplicate titles,
                                                    flag overclaims, flag possibly invented messages,
                                                    report missing requested types ─▶ saved to reports/ai-generated/
```

| Step | What happens |
|---|---|
| Input checks | Requirement 10–4000 chars, 1–15 cases, known types; rejected before calling the model |
| Prompt (`testcase-v2`) | [ai/prompts/testCasePrompt.ts](ai/prompts/testCasePrompt.ts): role, rules, application context, requirement, output schema, one example, uncertainty handling (`assumptions`) |
| Structured output | The JSON Schema is sent to Ollama as a constraint, and validated again on our side |
| Safe extraction | [ai/parsers/AIResponseParser.ts](ai/parsers/AIResponseParser.ts): direct parse → code fence → JSON inside prose (string-aware bracket matching, nested candidates) → conservative repair (trailing commas, typographic quotes). Cut-off JSON is reported, not guessed; nothing is evaluated |
| Validation | Ajv schema (types, enums, required fields, sizes) + semantic checks (blank text, copied prompt example) |
| Retry | One correction prompt: the original task, the specific errors, the rejected answer and "write fewer, shorter cases" when output was cut off |
| Failure | After 2 attempts, or on a provider error (offline, timeout, missing model), the result is `failed` with a reason. It never throws, and provider errors are not retried |
| Reviewer warnings | Duplicate titles removed; overclaims ("guarantees", "fully secure") flagged; **grounding check**: quoted text and `Error:`/`Epic sadface:` messages must appear in the requirement or app context, otherwise "possibly invented"; missing requested types listed |

Output per case: `id`, `title`, `type` (functional, negative, boundary, validation, security, api, ui, regression,
smoke), `priority`, `preconditions`, `steps`, `expectedResult`, `reviewStatus`, `warnings`. The saved result also
records model, prompt version, assumptions, each attempt (duration, errors, raw output preview) and total time.

**Measured results** for "User should be able to add a product to cart and complete checkout." (5 cases, CPU):

| Run | Result |
|---|---|
| qwen2.5:3b, prompt v1 (160 s) | Valid JSON, but: invented message `'Cart is empty'`, skipped Continue/Overview, "empty cart" case added a product, 4 of 5 cases repeated one flow, only functional/negative |
| qwen2.5:3b, prompt v2 (152 s) | Correct page flow, no invented messages; still repetitive, 7-step cases, positive titles on negative tests |
| qwen2.5:7b, prompt v2 (212 s) | 5 distinct scenarios incl. an API case, full flow to Finish, failure-worded titles; one invented message (`Error: Your cart is empty`), now caught by the grounding check |

Prompt v2 added the real checkout flow to the context and rules for distinct scenarios, preconditions instead of
repeated setup, failure-worded titles and type coverage. The 7B model follows these rules noticeably better, so it is
the default. The remaining gaps show why generated cases stay drafts: near-duplicates with different titles and
unquoted invented behaviour still need a human reviewer.

## AI failure analyzer

When tests fail, `npm run ai:analyze` collects the evidence for each failure, asks the local model for a classification
and a possible root cause, applies deterministic guardrails, and saves the result next to the test (§15–§19, §31).

```
reports/results.json ─▶ TestResultParser (failed tests, last attempt, attachments)
                              │
       ┌──────────────────────┼─────────────────────┬──────────────────────┬─────────────────────┐
       ▼                      ▼                     ▼                      ▼                     ▼
 error + location     TraceCollector         ScreenshotCollector     LogCollector          test source excerpt
                      actions (readable      PNG size + page         test log + API        (only the failing
                      selectors), failed     accessibility           request log           test's body,
                      action, last URL,      snapshot at failure     (/__test/ calls       failing line marked)
                      console, failed        (error-context)         excluded)
                      requests (3rd-party
                      marked)
       └──────────────────────┴─────────────┬───────┴──────────────────────┴─────────────────────┘
                                            ▼
                        signals: rule-based observations (HTTP 5xx, ECONNREFUSED, browser launch,
                                 401/403, similar-named element, value mismatch)
                                            ▼
                        EvidenceBuilder: compact text (~2–4k chars), secrets redacted by BaseAIProvider
                                            ▼
                        FailureAnalyzer ─ prompt failure-v2 ─ JSON schema ─ validate + 1 correction retry
                                            ▼
                        guardrails ─▶ reports/ai-analysis/<run>/  (JSON per test, index.json, report.md)
                                   └▶ "AI failure analysis" attachment in Allure
```

**Output** (per failed test): `classification` (§16: APPLICATION_DEFECT, TEST_SCRIPT_DEFECT, TEST_DATA_DEFECT,
ENVIRONMENT_FAILURE, NETWORK_FAILURE, AUTHENTICATION_FAILURE, UNKNOWN), `classificationReason`, `summary`,
`possibleRootCause`, `evidence`, `recommendedInvestigation`, `suggestedBugTitle`, `suggestedBugDescription`,
`confidence` + `confidenceLabel` ("AI confidence estimate: 78%"), `modelConfidence`, `confidenceAdjustments`,
`removedEvidence`, `signals`, `conflicts`, `visualInspection`, and the note
**"AI analysis is advisory and requires human verification."**

**Guardrails** ([ai/services/analysisGuards.ts](ai/services/analysisGuards.ts))

| Rule | Why |
|---|---|
| Summary and root cause must be hedged ("possible", "likely"); otherwise "Possible cause:" is prefixed | AI guesses are never presented as confirmed (§15) |
| Each evidence item must match the collected evidence (quoted fragment, or most of its words); others are moved to `removedEvidence` | Removes invented facts, e.g. "the checkout completed successfully" when it did not |
| If the AI contradicts a *strong* rule-based signal (e.g. HTTP 500 → APPLICATION_DEFECT), the conflict is listed and confidence is capped at 50% | Catches reasoning that ignores unambiguous facts |
| Confidence caps: never above 85%; UNKNOWN ≤ 40%; fewer than two grounded evidence items ≤ 60%, none ≤ 30% | Confidence is a heuristic for attention, not a probability (§31); the model's own number is kept for comparison |
| Text-only model: the screenshot is not sent, and the analysis says "Visual inspection: unavailable" | The system never pretends a text model looked at pixels (§19); the page accessibility snapshot is used instead |
| Provider offline / timeout / missing model → `status: "unavailable"`, "AI analysis unavailable - AI provider is offline." | AI is an enhancement; test results are never changed (§34, §48) |

**Root-cause service** (§18): `npm run ai:analyze -- --root-cause` adds up to three ranked possible causes, each
with its own grounded evidence and confidence, plus checks to confirm them. It is optional because it costs another
model call.

**Caching and cost** (§30): identical evidence + model + prompt version is answered from `reports/ai-analysis/cache/`.
Evidence sections are individually capped; stack traces, snapshots and logs are truncated safely.

**Controlled demo failures** (`tests/ai-demo/`, §40–§41): four tests fail on purpose, each for a known reason. They run
only when requested (a normal `npx playwright test` does not include them). Expected answers live in
`ai/eval/demo-ground-truth.json`, not in the test file, because the failing test's source is part of the evidence.
AI-DEMO-003's server error comes from an automatic fixture that makes the mock API return 500, so the test reads like
one hitting a real backend defect. The test-harness call that sets this up is excluded from the evidence.

**Measured accuracy** (qwen2.5:7b, CPU-only i5-8250U, ~2–3 min per failure)

| Prompt | Held-out cases (6, `npm run ai:eval`) | Demo failures (4, `npm run test:ai-demo`) | Total |
|---|---|---|---|
| Plain baseline prompt (Phase 5, no evidence pipeline) | 4/6 | — | — |
| `failure-v1` | 4/6 | 3/4 | 7/10 |
| `failure-v2` (default) | **5/6** | 2/4 | 7/10 |

- **Held-out cases:** `ai/eval/failure-cases.json` was never used to write or tune prompts. v2 added two general rules:
  look for a skipped step before blaming a selector, and treat a wrong expected value read from test data as
  TEST_DATA_DEFECT. v2 fixed the held-out test-data case.
- **Demos:** on the demos v2 did not help. In AI-DEMO-001 it named the test-data source in its root cause but still
  labelled it TEST_SCRIPT_DEFECT. In AI-DEMO-003 it chose ENVIRONMENT_FAILURE for an HTTP 500; the guardrail flagged the
  conflict with the rule-based signal and lowered confidence from 80% to 50%.
- **Right label, wrong reason:** in AI-DEMO-002, both versions labelled the missing "Finish" click correctly
  (TEST_SCRIPT_DEFECT) but blamed the selector instead of the skipped step. Accuracy numbers alone hide this, which is
  why reports show the reasoning and evidence.
- **Confidence is not calibrated:** the average confidence of wrong answers (80%) was *higher* than that of right
  answers (73–75%). The estimate is useful for spotting guardrail flags, not for trusting an answer. Every analysis
  says it requires human verification.
- **Grounding check:** it removed invented claims (e.g. "the checkout process completed successfully"), and once removed
  a correct paraphrase. It errs on the side of dropping evidence.
- **Consistent misses:** EVAL-001 ("Finish button does nothing" → APPLICATION_DEFECT) was classified TEST_SCRIPT_DEFECT
  in every run. The model tends to blame the test when a UI action has no effect.
- **Selecting a prompt:** `AI_FAILURE_PROMPT=failure-v1` switches versions for comparison. Ten cases are few; more
  labelled failures would be the first step before trusting these numbers.

## AI bug report drafts

`npm run ai:bug-report` (and `npm run test:ai-demo`) turns each failed test and its AI analysis into a **draft** bug
report (§17). Drafts are saved to `reports/bug-reports/<run>/` as Markdown (ready to paste into a tracker) and JSON, and
attached to the test in Allure as "AI bug report draft". **Nothing is submitted to Jira or any tracker** (`submitted: false`
always); a person reviews, edits and files.

**Facts come from the evidence; the model writes the narrative.** Anything that can be stated exactly is never left to
the model:

| Section | Source |
|---|---|
| Environment (browser, env, URLs, page at failure, OS, Node, Playwright, test file, run) | Evidence, exact |
| Actual result: raw error | Evidence, exact (secrets masked) |
| Evidence (screenshot, video, trace + `show-trace` command, failing API call, page state, rule-based observations) | Evidence, exact |
| Recorded actions (appendix) | Trace or API log, exact, to check the written steps against |
| Possible root cause, classification, confidence | Phase 7 analysis (already hedged and guarded) |
| Title, summary, preconditions, steps to reproduce, expected/actual narrative, severity + priority suggestions with reasons, additional investigation | Model (prompt `bug-v1`), then checked |

**Report type** is derived from the analysis, so a broken test is not filed as a product bug:
APPLICATION_DEFECT → PRODUCT BUG; TEST_SCRIPT/TEST_DATA_DEFECT → TEST MAINTENANCE; ENVIRONMENT/NETWORK_FAILURE →
INFRASTRUCTURE; AUTHENTICATION_FAILURE, UNKNOWN or no analysis → NEEDS TRIAGE.

**Review notes** flag:
- quoted text that does not appear in the evidence (possibly invented)
- more written steps than recorded actions
- critical severity on a test-maintenance report
- any conflict carried over from the analysis

**Fallback:** if the model is offline or its output stays invalid, the draft still has every factual section, a
title built from the test name and error, and a clear "AI sections unavailable" line (§48). Secrets are masked in the
prompt and again on the final Markdown.

**Measured results** (demo failures, qwen2.5:7b, CPU; ~3–4 min per draft on top of the analysis)

| Demo | Report type | Draft quality |
|---|---|---|
| AI-DEMO-001 wrong expected price | TEST MAINTENANCE | Correct steps and expected value; inherits the analysis' TEST_SCRIPT label |
| AI-DEMO-002 missing "Finish" click | TEST MAINTENANCE | Title says "Incorrect selector": the draft faithfully repeats the analysis' wrong reason |
| AI-DEMO-003 HTTP 500 on POST /api/orders | PRODUCT BUG | Accurate title, steps ("register a new user and log in"), expected/actual and evidence |
| AI-DEMO-004 selector typo | TEST MAINTENANCE | Correct, but one step quoted the selector; a review note now flags code in steps |

Known limitations:
- Every draft was rated **major / P2**. The model does not yet differentiate severity well, so treat these as
  placeholders for the reviewer.
- A draft is only as good as the analysis it builds on.

**Bugs found while building this**
- Node's built-in `fetch` abandons a response after 300 s without data. That silently cut off one draft, and the
  message wrongly said "provider is offline". Ollama is now called through `undici` with those internal limits switched
  off, so `AI_GENERATION_TIMEOUT` is the only limit, and fallback messages state the real reason (offline vs timeout).
- **Fault-injection leak:** the demo's fault-injection call (`/__test/faults`) was excluded from the API log but still
  appeared in the *test log* section of the evidence, so earlier AI-DEMO-003 analyses could see that the 500 was
  injected. Test-harness calls are now removed from every evidence section, with a regression test. The AI-DEMO-003
  results in the tables above were measured before this fix and should be re-measured.
- **Cache misses:** evidence for the same failure differed between runs (API timings, the order of background
  requests), so the cache rarely hit. Timings are now excluded from the cache key and requests are sorted; the
  evidence of all four demos was verified identical across two runs.

## Dashboard

A local web dashboard to run suites, watch progress live, and browse saved results and history.

```bash
npm run dashboard:install     # once
npm run dashboard             # builds the UI and serves everything at http://127.0.0.1:4000
npm run dashboard:dev         # development: UI with hot reload at http://127.0.0.1:5173
```

| Page | What it shows |
|---|---|
| Dashboard | Latest run stats (total, passed, failed, skipped, pass/fail %, duration), pass-rate gauge, last 12 runs, recent runs |
| Run Tests | Pick a suite (Smoke, Regression, UI, API, All) and browser, click **RUN TESTS**, watch live progress and console output. A browser choice limits UI tests; API tests always run once. |
| Execution History | Every run, filterable by suite and status, paginated |
| Run details | Per-test status, error, screenshot, video, trace download and `show-trace` command, links to that run's **Allure report** and Playwright HTML report |

The dashboard covers test execution and results only. The AI features (test-case generator, failure analysis, bug report drafts) run from the command line; see the AI sections above.

**How it works**

```
React + daisyUI  ──REST──▶  Express (127.0.0.1:4000)  ──spawns──▶  npx playwright test <suite args>
                                   │                                     │
                                   ▼                                     ▼
                          SQLite (node:sqlite)  ◀── imports ──  reports/runs/<runId>/results.json
                          runs, test_results                    + html/, allure/, test-results/, output.log
```

- The dashboard does not change the test framework. Each run's report folders are redirected with Playwright's
  own options (`PLAYWRIGHT_JSON_OUTPUT_FILE`, `PLAYWRIGHT_HTML_OUTPUT_DIR`, `--output`), so every run keeps its own
  screenshots, videos, traces and HTML report.
- Suites are a fixed list mapped to Playwright arguments. The API never builds a command from user text.
- One run at a time. Starting a second returns `409` with the active run id.
- The server listens on `127.0.0.1` only. Change with `DASHBOARD_HOST` / `DASHBOARD_PORT`.
- Database: `dashboard/data/dashboard.db` (git-ignored). Delete it to reset history.

**REST API**

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/dashboard/summary` | Latest run, totals, recent runs, trend |
| GET | `/api/dashboard/meta` | Suites, browsers, environment, active run |
| GET | `/api/runs?page=&pageSize=&suite=&status=` | Paginated run history |
| POST | `/api/runs` `{ "suite": "smoke", "browser": "chromium" }` | Start a run (`202`, or `409` if busy) |
| GET | `/api/runs/:id` | Run, its test results, live progress while running |
| GET | `/api/tests/:id` | One test result |
| GET | `/artifacts/<runId>/...` | Screenshots, videos, traces, HTML report |
