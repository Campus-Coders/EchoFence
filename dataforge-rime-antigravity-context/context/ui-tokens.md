# UI Tokens

## Design Direction

The interface should feel like a focused developer/voice-operations console rather than a generic chatbot.

Use the same visual language throughout the application.

## Colors

Define tokens in `app/globals.css`.

```css
@theme {
  --font-sans: "Inter", sans-serif;

  --color-background: #f6f7fb;
  --color-surface: #ffffff;
  --color-surface-secondary: #f9fafb;
  --color-surface-tertiary: #f2f5f7;

  --color-border: #e7eaf3;
  --color-text-primary: #101828;
  --color-text-secondary: #6a7282;
  --color-text-muted: #99a1af;

  --color-accent: #7c5cfc;
  --color-accent-light: #f3e8ff;
  --color-accent-muted: #faf5ff;
  --color-accent-foreground: #ffffff;

  --color-success: #10b981;
  --color-success-light: #d0fae5;
  --color-success-lightest: #ecfdf5;

  --color-info: #61a8ff;
  --color-info-light: #dbeafe;
  --color-info-lightest: #eff6ff;

  --color-warning: #ff8904;
  --color-error: #ef4444;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

## Typography

- Inter
- page heading: 28–32px
- section heading: 16–18px
- body: 14px
- metadata: 12px
- metric number: 28–32px

## Voice State Semantics

| State | Token |
|---|---|
| Listening | info |
| Thinking | accent |
| Tool running | warning |
| Speaking | success |
| Interrupted | error |
| Stale result blocked | warning |
| Rime active | success |

## Cards

- white surface
- 1px border
- rounded-xl/2xl
- 20–24px padding
- subtle shadow

## Buttons

Primary:

```text
bg-accent
text-accent-foreground
rounded-md
px-4 py-2
font-medium
```

Secondary:

```text
bg-surface
border border-border
text-text-primary
rounded-md
px-4 py-2
```

## Evidence Timeline

Use a compact timeline.

Each event should show:

- timestamp
- generation
- event name
- concise status
- optional duration

The stress case should visually make the stale generation obvious.

## Invariants

- no hardcoded colors in components
- no raw Tailwind color scales
- use tokens
- no decorative animation that makes timing evidence ambiguous
- prioritize readable state changes over visual effects
