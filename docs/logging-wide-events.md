# Wide-Event Logging

The app uses **wide events only** for observability: no logger is exposed on context. See `.cursor/skills/logging-best-practices/SKILL.md` for the full practice.

## How it works

- **HTTP requests** – One wide event per request. Middleware (`src/middleware/wide-event.ts`) uses `c.get("appLogger")` to emit a single structured log in a `finally` block with:
  - `request_id`, `method`, `path`, `status_code`, `duration_ms`, `outcome`
  - `env.node_env`, `env.build_sha` (when `BUILD_SHA` is set)
  - Any context added by handlers via `ctx.addWideEventContext()`
  - `userDid` when the session is resolved (set via `addWideEventContext` in the session callback)
  - `error` when the request ended with an error

- **Ingester (firehose)** – Separate wide events, one per firehose event. The ingester receives an `emitWideEvent` callback (backed by the same pino instance) and emits `msg: "ingester"` events with `collection`, `event`, `did`, `uri`, `outcome`, `duration_ms`, and optional `error`. No HTTP request is involved.

- **No logger on context.** There is no `ctx.logger`. Handlers and utils add business context only via `ctx.addWideEventContext({ ... })`. Scrapers and other shared code do not log; callers add context to the appropriate wide event (request or ingester).

## Examples

```ts
// Prefer: add to the wide event
ctx.addWideEventContext({
  event: "wrote_books",
  userDid: agent.did,
  book_count: updatesToApply.length,
});
```
