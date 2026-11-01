---
status: accepted
---

# The web app is React built with Vite and served by the gateway

The first page was one HTML string inside the gateway: no build step, no dependencies, a strict policy that allowed only inline script. It could not grow into a Claude Code or ChatGPT-class interface, so the page is now its own package, `packages/web`: React 19 with the React Compiler, Vite, Tailwind CSS and shadcn-style components over Radix, lucide icons, React Router in code (route objects, not a file tree), TanStack Query for the gateway's REST calls and TanStack Store for client state. The look follows Fluent 2 (neutral surfaces, communication-blue brand, 4 to 8 px corners, Segoe UI Variable), with light and dark themes.

The gateway serves the built files from `packages/web/dist` (the Docker image builds them in an earlier stage) and falls back to the old single-file page when there is no build, so a checkout that has not run `pnpm build:web` still works. The page policy changes from inline script to `script-src 'self'`; style stays `'unsafe-inline'` because React and Radix set style attributes. Assets are hashed and cached for good; the page itself is never cached.

We considered keeping the string page (no way to share components or test the UI), Next.js (a second server in the image for a page that is only a client of the gateway's API), and TanStack Start or file-based routing (more framework than a client of one API needs). TanStack AI is not used for chat yet: the gateway streams its own session events, which the page already turns into messages with a small tested reducer, and TanStack Charts is reserved for the usage panels (#40).
