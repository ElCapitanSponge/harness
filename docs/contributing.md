---
title: Contributing
description: How to build, check and change the harness, including the code standards that CI enforces
sidebar:
  order: 90
---

# Contributing

## Before you push

```bash
pnpm typecheck   # TypeScript 7
pnpm lint        # oxlint, then ESLint
pnpm test        # Vitest
```

CI runs the same three, in that order, plus a job that builds the gateway image and starts it. A change is not done until its documentation page is written or updated.

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, with `Refs #N` or `Closes #N` for the issue.

## Repository layout

| Package | Purpose |
|---|---|
| `packages/core` | Shared Zod schemas and the tunnel protocol: chat request, heartbeat, tool calls, session events |
| `packages/tools` | The sandboxed file and command tools, skills, and the coding agent loop. Used by the CLI and the gateway |
| `packages/claude` | Runs the `claude` CLI and shapes its answers as OpenAI responses |
| `packages/lmstudio` | Wraps the `lms` CLI, with input checks |
| `packages/node-agent` | Runs on each device: dials the gateway, reports models and busy state, answers relayed chat, tool, Claude and model-control requests |
| `packages/gateway` | Device registry, router, tunnel, conversation store, OpenAI-compatible API and the web page |
| `packages/web` | The web interface (React) the gateway serves |
| `packages/cli` | The `harness` command |

Routing policy lives in `packages/gateway/src/router.ts`, separate from transport, so tiering and fallback rules can change without touching the HTTP code.

## Documentation

A feature is not done until its page in `docs/` is written or updated, and the [glossary](../GLOSSARY.md) has any new term. Every page needs a `title`, a `description` and a `sidebar.order` in its front matter, and links between pages are relative, so the folder reads on GitHub, can be copied into the wiki and can feed a documentation site later. `pnpm docs:check` (also part of `pnpm test`, so CI runs it) fails on a missing front matter field, a link to a file that does not exist, or a link to a heading that does not exist.

Where a page goes: `getting-started/` for the first hour, `guides/` for how to set up and use something, `reference/` for the complete lists (settings, commands, routes, protocol), `adr/` for decisions, `specs/` for plans. The page for a setting or a route goes in the reference as well as the guide.

## Code standards

These are enforced by the linter, not by review. A rule is an error or it is off; there are no warnings.

| Standard | How it is enforced |
|---|---|
| No `any` | `@typescript-eslint/no-explicit-any`, and the `no-unsafe-*` rules so an `any` cannot arrive from elsewhere |
| No `var` | `no-var`, `prefer-const` |
| Arrow functions only | `func-style: expression`, `prefer-arrow-callback`, and a restriction on assigning function expressions |
| Braces always | `arrow-body-style: always` (an arrow function always has a block body) and `curly: all` |
| Strict types | typescript-eslint `strictTypeChecked` and `stylisticTypeChecked` |
| Formatting | ESLint Stylistic (two spaces, double quotes, semicolons, trailing commas, one statement per line). There is no Prettier |

**What cannot be an arrow function.** Class methods, constructors, accessors and generators (`function*`). A generator needs a one-line `// eslint-disable-next-line func-style -- generators cannot be arrow functions` above it.

**Deliberate relaxations**, each in `eslint.config.ts` with its reason:

- Numbers may appear in template strings (`${count}`).
- Test files may use non-null assertions and `async` functions with nothing to await, since tests index into arrays they have just filled and fake async interfaces.

## Two linters, one rule in one place

`oxlint` (the Oxc linter) runs first. It takes about two seconds and covers the rules in its `correctness` category (`.oxlintrc.json`). ESLint takes about thirteen seconds and covers what oxlint does not: the type-aware strict rules, the arrow function and brace rules, and formatting. A rule is configured in one tool, not both. When the React front end arrives (see [the web experience spec](specs/web-experience-v2.md)), the hooks and React Compiler rules are added to ESLint.

## TypeScript 7 and 6

`tsc` is TypeScript 7, the native compiler, for `pnpm typecheck`. TypeScript 7 has no programmatic API yet, so `typescript` is an alias of `@typescript/typescript6` and is what ESLint's typescript-eslint loads, following the [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). `tsc6` is also available.

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

## The web app

`packages/web` is the page the gateway serves. `pnpm web` runs it with hot reload against a gateway on `localhost:8787` (set `GATEWAY_URL` for another); `pnpm build:web` builds it into `packages/web/dist`, which the gateway serves in preference to its built-in page. The same standards apply (arrow functions, braces, no `any`), plus the React hooks and React Compiler lint rules. See [ADR 0009](adr/0009-web-app-is-react-built-with-vite-served-by-the-gateway.md).

### Asking the person to confirm

Never call `window.confirm`, `alert` or `prompt` (ESLint `no-alert` fails on them). To ask for a yes or no, use `ConfirmDialog` from `components/ui/overlay.tsx`: it is a Radix alert dialog that takes focus on Cancel, closes on Escape and ignores a click outside. Pick `tone="destructive"` for something that cannot be undone and `tone="risky"` for something that lowers a safeguard. The caller owns `open`, so keep the dialog open while the action runs and show its error in the dialog.

### Touchscreens

Design for a phone first and give the mouse its extras. Anything revealed on hover (`opacity-0` with `group-hover:`) must also be shown on touch with `pointer-coarse:opacity-100`; `src/touch.test.tsx` fails on a line that does not. Touch sizes come from the shared parts: `Button`, `Input`, `Select` and `Choice` grow to 44px under `pointer-coarse:`, so use them rather than a bare `<button>`, and when you do write one add `pointer-coarse:min-h-11`. A control that is small by design (a switch, a checkbox) keeps its look and takes an invisible `pointer-coarse:after:` area instead. Do not rely on `title` to say what an icon does: a phone never shows it.

### Storybook and front-end tests

`pnpm storybook` opens Storybook 10 on port 6006 with the app's theme and a light/dark toggle in the toolbar. `pnpm --filter @harness/web build-storybook` builds a static copy (CI checks it builds).

There are three kinds of front-end test, all run by `pnpm test` in a DOM (jsdom), with no browser to install:

- **Unit tests** (`*.test.ts` beside the code in `src/lib`) for logic such as the conversation reducer and the API helpers.
- **Component tests** (`*.test.tsx`) that render a component with Testing Library and check behaviour that does not fit a story, such as a draft surviving a reload or untrusted markdown never becoming markup.
- **Stories** (`*.stories.tsx`). Write one for each state a component can be in (empty, loading, streaming, error, offline, locked). Put the expectations in a `play` function, with `expect` and `userEvent` from `storybook/test`. `src/stories.test.tsx` runs every story as a test and fails on a serious accessibility problem (colour contrast is left to the Storybook accessibility panel, because jsdom cannot paint).

A component that reads from the gateway gets its data from the story's `parameters.seed` (the query keys the app uses), so no story touches a network.
