# Code Standards

## Engineering Mindset

- Read all context files before implementing.
- Think before coding.
- Scope is sacred.
- One feature at a time.
- Every feature must be testable.
- Prefer simple explicit code.
- Treat failures as expected.
- Never fake a working behavior for the demo.

## TypeScript

- strict mode
- never use `any`
- use `unknown` and narrow
- avoid type assertions unless unavoidable and explained
- explicitly type function parameters and return values
- use `type` for object shapes/unions
- use `interface` only when extension is needed
- `const` by default

## Next.js

- App Router only
- Server Components by default
- `"use client"` only when browser state/APIs/events/client libraries require it
- route handlers only in `app/api`
- business logic belongs in `agent/` or `lib/`, not route handlers
- do not fetch directly from Client Components unless the feature specifically requires browser transport

## Components

- one component per file
- named exports
- no default component exports
- props type directly above component
- no inline styles
- use UI tokens, not hardcoded colors

## API Routes

Every route:

1. validates input
2. uses try/catch
3. logs with route prefix
4. returns a consistent wrapper

```ts
return NextResponse.json({
  success: true,
  data: result,
});
```

Errors:

```ts
return NextResponse.json(
  { success: false, error: "Unable to complete request" },
  { status: 500 },
);
```

Never expose raw provider/API errors to the browser.

## Agent Code

Every agent function:

- has explicit input/output types
- has try/catch
- logs failures
- never imports React
- never imports UI components
- never directly manipulates browser APIs

## Generation Fence Invariant

No asynchronous operation may mutate user-visible conversational state without checking that its generation is still active.

Bad:

```ts
const result = await slowTool();
speak(result);
```

Required pattern:

```ts
const result = await slowTool();

if (!isGenerationActive(generationId)) {
  recordStaleResult(generationId);
  return;
}

speak(result);
```

## Interruption Invariant

An interruption must:

1. mark old generation stale
2. stop/invalidate queued speech
3. abort cancellable work
4. accept the new turn
5. prevent old results from speaking

These operations should be coordinated rather than duplicated across components.

## Rime Invariant

Rime is the primary spoken-output provider.

Never:

- use Rime only for a greeting
- make another provider the default
- hide a fallback
- claim Rime spoke audio that was produced elsewhere

## Logging

Console errors must have context:

```text
[voice/interrupt]
[agent/orchestrator]
[rime/client]
[evaluation/stress]
```

No empty catch blocks.

## Evidence

Do not log secrets.

Do not store API keys in test fixtures.

Measurements must distinguish:

- requested stop vs observed stop
- cached vs uncached where applicable
- cold vs warm where applicable
- tool latency vs speech latency

## Dependencies

Do not add packages casually.

Prefer:

- Next.js
- React
- Tailwind
- shadcn/ui
- Zod
- official Rime integration
- LiveKit Agents where useful

If a new package is required, document why before installing it.
