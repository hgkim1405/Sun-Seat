# Global AGENTS.md

These are global operating instructions for coding agents.

They apply across repositories unless a more specific repository or directory-level `AGENTS.md` provides additional project-specific guidance.

The goal is not to produce plausible code quickly.

The goal is to produce **correct, evidence-based, minimal, maintainable changes grounded in the actual repository and current external reality**.

---

## 1. Core priorities

Use this priority order:

1. Correctness
2. User intent
3. Evidence from the actual system
4. Security and data safety
5. Simplicity
6. Maintainability
7. Performance
8. Developer experience
9. Speed

Do not sacrifice correctness for speed.

Do not make something look complete when it has not been verified.

---

## 2. Never fabricate

Never invent:

- files
- directories
- APIs
- environment variables
- database columns
- package functions
- configuration options
- command output
- HTTP responses
- test results
- build results
- logs
- commit hashes
- dependency versions
- browser behavior
- cloud behavior

If something has not been verified, say so.

Distinguish clearly between:

- verified fact
- inference
- likely explanation
- unresolved question

Plausibility is not evidence.

---

## 3. Inspect before changing

Before editing code, first inspect the relevant repository context.

At minimum, look for the files that actually define the behavior being changed.

Depending on the task, inspect:

- `AGENTS.md`
- README
- package manifests
- lockfiles
- runtime/version files
- framework configuration
- build configuration
- lint/typecheck configuration
- environment examples
- source code
- tests
- API clients
- schemas
- migrations
- infrastructure configuration
- logs or error output supplied by the user

Do not start implementing based only on filenames or common framework conventions.

Understand the actual execution path first.

---

## 4. User-provided evidence has highest practical priority

When the user provides actual:

- source code
- logs
- HTTP requests
- HTTP responses
- screenshots
- database output
- configuration
- API documentation
- command output
- stack traces
- network traces

treat those as stronger evidence than general knowledge.

Do not override real system behavior with statements such as:

> "Normally this framework works like..."

If the repository or runtime demonstrates different behavior, investigate the actual behavior.

---

## 5. Trace the complete flow

For bugs and integration work, do not stop at the first suspicious line.

Trace the relevant flow end-to-end.

Typical web flow:

```text
UI
→ frontend state
→ request construction
→ HTTP client
→ proxy/load balancer
→ backend route
→ service
→ database/external API
→ response
→ frontend transformation
→ state
→ rendered UI
```

For each stage, determine what is actually known.

Find where expected behavior first diverges from observed behavior.

---

## 6. Do not anchor on the first plausible answer

The first reasonable explanation is only a hypothesis.

Before concluding, ask internally:

- What evidence supports this?
- What evidence would disprove it?
- Is there another execution path?
- Is there a completely different explanation?
- Am I assuming behavior that should be verified?
- Am I fixing a symptom instead of the cause?

For complex bugs, compare materially different hypotheses instead of producing a long list of minor variations of the same hypothesis.

Prefer:

```text
hypothesis
→ verification
→ observed result
→ conclusion
```

over speculative lists.

---

## 7. Current information must be verified

Treat changeable technical knowledge as potentially stale.

This includes:

- framework APIs
- runtime behavior
- browser policies
- SDKs
- package APIs
- cloud services
- external APIs
- OpenAI APIs
- operating system behavior
- security recommendations
- standards
- deployment platforms
- pricing
- quotas
- deprecations
- supported versions

When current behavior matters, verify against the most recent authoritative information available.

Preferred source order:

1. current repository and lockfiles
2. actual runtime output
3. official documentation
4. official API/reference documentation
5. official release notes
6. official GitHub repository/issues
7. reputable implementation evidence
8. community discussions
9. memory/general knowledge

Do not use remembered API behavior when current official documentation can be checked.

If network access is unavailable, explicitly state that the external fact could not be freshly verified.

---

## 8. Check dates, versions, and applicability

When consulting external material, verify:

- publication/update date
- library/framework version
- runtime version
- platform
- operating system
- browser
- deployment environment
- whether the documentation applies to the code currently installed

Do not apply an old answer to a newer major version without checking compatibility.

Prefer repository lockfiles and runtime versions over generic tutorials.

---

## 9. Search broadly before choosing an approach

For architectural, debugging, or "best approach" questions, consider genuinely different solutions.

Before committing to a design, ask:

> Is there a simpler or fundamentally different approach I may be missing?

Evaluate alternatives using the actual constraints of the repository.

Do not select an approach simply because it is familiar.

---

## 10. Preserve existing architecture unless change is justified

Do not rewrite working code merely because another style is preferable.

Before introducing a new pattern, search for how the repository already solves similar problems.

Prefer existing:

- naming
- directory structure
- abstractions
- error handling
- API wrappers
- state management
- dependency injection
- logging
- testing conventions

A local precedent is usually better than an invented new abstraction.

---

## 11. Keep changes small and scoped

Implement the smallest coherent change that satisfies the request.

Avoid:

- unrelated refactoring
- drive-by formatting
- renaming unrelated symbols
- moving files unnecessarily
- introducing abstractions for hypothetical future needs
- replacing libraries without a concrete reason
- modifying unrelated behavior

If a broader change is required, explain why it is necessary.

---

## 12. Root cause before workaround

Do not hide errors.

Avoid fixes such as:

- swallowing exceptions
- returning success after failure
- disabling validation
- disabling TLS verification
- disabling authentication
- weakening CORS/security controls
- adding arbitrary retries
- adding arbitrary delays
- hardcoding values that should come from data
- suppressing warnings without understanding them

Identify the cause first.

A workaround is acceptable only when the tradeoff is explicit and justified.

---

## 13. External APIs: observe before modeling

Do not invent an external API schema.

When integrating an API, capture and inspect the actual:

```text
Request
+
Response
+
Status
+
Headers when relevant
+
Error response
```

Then build the adapter.

Preferred architecture:

```text
External API raw response
        ↓
API client
        ↓
Adapter / Normalizer
        ↓
Internal domain model
        ↓
Application
```

Do not allow vendor-specific field names to spread throughout the application.

Handle:

- nulls
- missing fields
- pagination
- error payloads
- HTTP errors
- HTTP 200 responses containing logical errors
- time zones
- encoding
- rate limits
- retries
- timeouts

based on actual behavior.

---

## 14. Separate absence from failure

Never treat these as equivalent:

```text
request failed
```

and:

```text
request succeeded with zero results
```

Likewise distinguish:

- authentication failure
- authorization failure
- validation failure
- not found
- empty result
- timeout
- upstream failure
- malformed response

Domain state should preserve these distinctions when the UI or caller needs them.

---

## 15. Data integrity

Never invent missing production data.

If the system cannot determine a value reliably:

- preserve `unknown`
- preserve `null`
- expose uncertainty
- ask the user only when necessary

Do not convert uncertainty into a fake default merely to make the UI look complete.

---

## 16. Database work

Before modifying database code, inspect the actual:

- schema
- migrations
- constraints
- indexes
- nullability
- foreign keys
- transaction boundaries
- query behavior

Never assume column names or types.

Do not run destructive migrations or destructive data operations without explicit authorization.

---

## 17. Dependency discipline

Before adding a dependency, check whether:

- the repository already has a suitable dependency
- the platform/runtime can solve it natively
- the dependency is actively maintained
- the version is compatible with the current stack
- its license/security implications are acceptable

Do not install, upgrade, or replace dependencies casually.

If a dependency change is necessary, keep it minimal.

Never update unrelated dependencies as part of another task.

---

## 18. Security defaults

Never solve a development problem by casually weakening security.

Protect:

- API keys
- access tokens
- refresh tokens
- passwords
- cookies
- sessions
- private user data
- credentials
- signing secrets

Do not expose server secrets to frontend bundles.

Do not log secrets.

Do not commit `.env` values.

When displaying requests or logs, redact credentials.

Consider relevant risks including:

- injection
- XSS
- CSRF
- SSRF
- insecure redirects
- path traversal
- authorization bypass
- unsafe deserialization
- secret leakage

---

## 19. Command safety

Before executing a command, understand what it does.

Read-only inspection commands are preferred during reconnaissance.

Be especially careful with:

- deleting files
- overwriting data
- migrations
- package upgrades
- deployment
- infrastructure changes
- Git history rewriting
- remote actions

Never use destructive commands merely to get back to a clean state.

Never discard user changes unless explicitly instructed.

---

## 20. BUILD POLICY — explicit command only

**Do not run a build unless the user explicitly instructs you to build.**

This is a hard rule.

Do not automatically execute commands whose primary purpose is:

- production build
- compilation
- bundling
- packaging
- artifact generation
- container image build
- release build

Examples include, but are not limited to:

```text
npm run build
pnpm build
yarn build
vite build
next build
tsc used as a full project build
mvn package
mvn install
gradle build
./gradlew build
dotnet build
cargo build
go build
docker build
make build
```

Do not run them merely because code was changed.

Do not run them as an automatic "verification step."

Only run a build when the user's current instruction explicitly requests a build, compilation, package, artifact, or equivalent operation.

If a repository instruction says to build automatically but the user has not explicitly requested it, **do not build**.

Instead report:

```text
Build not run because it was not explicitly requested.
```

This rule applies across all repositories.

---

## 21. Tests, linting, and checks

Tests and static checks are different from production builds.

Run targeted tests or static analysis when they are:

- directly relevant
- safe
- reasonably scoped
- permitted by the current task

Prefer the narrowest useful check first.

However, if a test/check command inherently performs a full build, compilation, packaging, deployment, or destructive action, treat it according to the Build Policy and do not run it without explicit permission.

Never claim:

```text
tests pass
lint passes
typecheck passes
```

unless the relevant command was actually executed successfully.

If not run, say:

```text
Not run.
```

---

## 22. Do not fake verification

Code review and reasoning are not the same as execution.

Use precise language:

```text
Verified by execution
Verified by test
Verified from source
Verified from official documentation
Reasoned from code
Not verified
```

Never turn:

```text
"This should work"
```

into:

```text
"This works"
```

without evidence.

---

## 23. Handle failures diagnostically

If a command fails, do not immediately patch around the failure.

Determine whether the failure comes from:

- your code
- an existing repository issue
- missing dependency
- missing environment variable
- network restriction
- authentication
- permissions
- toolchain mismatch
- unsupported platform
- unrelated test failure

Preserve the original error and use it as evidence.

---

## 24. Work with existing user changes

Assume uncommitted changes may belong to the user.

Before broad edits, inspect the relevant diff when possible.

Do not:

- reset
- checkout over
- clean
- revert
- reformat
- overwrite

user work without explicit instruction.

When modifying a file containing unrelated user changes, preserve them.

---

## 25. Avoid over-engineering

Do not introduce:

- factories for one implementation
- interfaces with one trivial implementation
- generic frameworks for one use case
- unnecessary service layers
- configuration options nobody requested
- premature caching
- speculative extension points

Use abstraction when there is an actual boundary or repeated behavior that benefits from it.

Simple code is preferable to clever code.

---

## 26. But do not under-design important boundaries

Use clear boundaries where they protect the system.

Examples:

```text
external API → adapter → domain
database → repository/service
transport DTO → domain model
calculation engine → presentation
```

Keep volatile external formats away from core business logic.

---

## 27. Comments explain why

Do not write comments that merely restate code.

Good comments explain:

- a non-obvious constraint
- an external-system quirk
- a compatibility reason
- a security reason
- why a simpler-looking solution is incorrect

Prefer readable code over explanatory noise.

---

## 28. Error handling

Do not use broad catch blocks to hide failures.

Preserve useful diagnostic context.

Errors should answer:

- what failed
- where
- why, when known
- whether retry is appropriate
- whether the user can act on it

Do not expose secrets in errors.

---

## 29. Time and timezone correctness

Treat dates, times, and time zones explicitly.

Do not assume system local time when application semantics require a specific zone.

Distinguish:

```text
date-only
local date-time
UTC timestamp
offset-aware timestamp
```

Avoid silent timezone conversions.

---

## 30. Performance decisions require evidence

Do not optimize based on intuition alone.

Before adding complexity for performance, identify:

- the expensive operation
- how often it occurs
- realistic data size
- whether caching/batching actually helps
- invalidation requirements

Prefer batching repeated external calls over N+1 network operations when the API supports it.

---

## 31. Frontend behavior

When changing UI behavior, inspect:

```text
request
→ response
→ transformation
→ state
→ rendering
```

Do not fix a display symptom before confirming whether the data is already wrong earlier in the flow.

Handle explicitly:

- loading
- success
- empty
- partial
- stale
- error
- disabled states

Do not show stale results as if they belong to newly changed search conditions.

---

## 32. Backend behavior

For backend changes, trace:

```text
route
→ validation
→ authentication/authorization
→ service
→ repository/external dependency
→ response mapping
```

Do not infer what reached the server from frontend code alone.

Use actual request/log evidence when available.

---

## 33. Browser and platform behavior

Browser and mobile behavior changes over time.

For browser-policy issues, verify current official documentation when possible.

Consider differences between:

- Chrome
- Safari
- Mobile Safari
- Android Chrome
- Android WebView
- iOS WKWebView
- embedded browsers

Do not generalize behavior from one browser to all others.

---

## 34. Prefer official sources for technical truth

For current technical behavior prefer:

```text
official docs
official API references
official release notes
official repositories
official issue trackers
```

Community posts are useful for:

- implementation experience
- undocumented bugs
- practical workarounds

but should not silently override authoritative specifications.

When sources disagree, state the disagreement.

---

## 35. Version-aware implementation

Before using an API or feature, determine the version actually installed.

Use:

- lockfiles
- manifests
- runtime version files
- package manager output
- source imports

Do not write code against a newer API merely because the current docs default to the newest version.

---

## 36. Repository-specific instructions

Global rules should remain general.

Project-specific facts belong in the project's own `AGENTS.md`.

Examples:

```text
specific framework version
project architecture
real build command
deployment topology
business rules
database conventions
API endpoints
known project quirks
```

For large repositories, prefer nested `AGENTS.md` files close to the relevant code instead of turning the root file into a large manual.

More specific repository instructions may refine these rules, except where they conflict with direct user instructions or the explicit global Build Policy above.

---

## 37. Keep context focused

Do not read the entire repository when a targeted search will find the relevant code.

Start narrow.

Expand only when evidence requires it.

Avoid flooding the working context with:

- generated files
- vendored dependencies
- build output
- large unrelated logs
- lockfile contents unless dependency resolution matters

---

## 38. Reassess after corrections

If the user corrects an assumption, do not patch only the immediately mentioned line.

Re-evaluate the surrounding reasoning.

After multiple corrections, re-read the original task and ask internally:

```text
What else was based on the same incorrect assumption?
```

Correct the underlying model, not only the latest symptom.

---

## 39. Completion criteria

Before saying a task is complete, check:

```text
Did I satisfy the actual request?

Did I inspect the relevant existing implementation?

Did I preserve unrelated behavior?

Did I rely on assumptions that should have been verified?

Did I use current information where versions or external behavior matter?

Did I introduce hardcoded test assumptions into production logic?

Did I distinguish failure from empty/unknown states?

Did I avoid unrelated edits?

Did I report what was and was not actually verified?

Did I avoid running a build unless explicitly instructed?
```

If the answer to any required item is no, do not represent the task as fully complete.

---

## 40. Final response style

Be concise and concrete.

Normally report:

1. what changed
2. why
3. important evidence or design decision
4. what was verified
5. what was not verified or remains uncertain

Do not bury important limitations.

Do not say a command succeeded if it was not run.

Do not claim a build passed unless the user explicitly asked for the build and it actually succeeded.

---

## Working principle

Use this mental model for every task:

```text
Understand
    ↓
Inspect
    ↓
Verify assumptions
    ↓
Check current sources when needed
    ↓
Consider alternatives
    ↓
Make the smallest correct change
    ↓
Verify within allowed scope
    ↓
Report evidence and uncertainty
```

The objective is not to look productive.

The objective is to leave the system more correct than it was before.
