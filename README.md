# Writalin

Calm, local-first notes for students: ADHD friendly, research friendly and PDF friendly.

Notes are plain Markdown files in a folder you choose (a **vault**), so they open cleanly in Obsidian and any text editor. An optional account (email code + password) syncs a vault between computers.

## What works today

- **Vaults:** pick a folder (File System Access API) or keep notes in the browser where folders aren't supported. Several vaults with a switcher. Fast index cached in IndexedDB.
- **Editor:** Obsidian-style live preview on CodeMirror 6. `/` menu for blocks, `[[` note links and `#` tag completion, collapsible headings, outline, focus mode (`Ctrl+.`), print layout preview with subtle page breaks, autosave with conflict detection.
- **Website shell:** Home (vault switcher, folders, recent notes, tags, search, today's tasks), split view with workspace tabs, bottom dock, `Ctrl+K` palette, focus timer (30 min default, gentle 5 min break prompt).
- **Links and tags:** backlinks ("Linked from"), rename-safe links (renaming a note rewrites links to it), tag filtering, full-text search.
- **Workspaces:** Tasks (every checklist item as a card, Today / Upcoming / No date), Calendar (notes by creation date, reminders, month/week/day), Scratch pad with "Move to note", PDF viewer (PDF.js, search, zoom, thumbnails, highlight → quote with page link), images, a second note side by side.
- **Themes:** Light, Dark, Midnight, Warm Paper, plus a custom theme editor with gradients and contrast warnings. Stored in `.writalin/themes/`.
- **Import / export:** Markdown, folders, Obsidian vaults, PDFs, images, `.zip`. Export a note as PDF (A4 print layout), Markdown or HTML; a vault as `.zip`.
- **Accounts and sync:** email one-time code sign-up, create a password, password sign-in, conflict-safe sync to Neon Postgres (both versions are kept if two computers edit the same note).

Not built yet (see the plan): Chrome extension, graph workspace, drawing boxes, AI tools, extension reminders.

## Repo layout

```
apps/web/            website (Vite + React PWA) and its Vercel functions in api/
packages/shared/     types and small utilities
packages/vault/      storage backends, Markdown parsing, index, links, tags, tasks, sync engine
packages/editor/     the shared CodeMirror note editor
packages/ui/         themes, timer, dock, command palette, modals
packages/workspaces/ tasks, calendar, scratch pad, PDF, image and side-note views
```

## Develop

```sh
pnpm install
pnpm dev          # http://localhost:5173 (API routes run inside the dev server)
pnpm test         # vitest
pnpm typecheck
```

Without `RESEND_API_KEY`, login codes are printed to the dev server log instead of emailed.

## Deploy (Vercel + Neon)

1. Create a Vercel project from this repo and set **Root Directory** to `apps/web`.
2. Add a Neon database (Vercel → Storage → Neon). It sets `DATABASE_URL`.
3. Run the schema once: `DATABASE_URL=... pnpm --filter @writalin/web db:migrate`.
4. Add `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend).
5. Deploy. See `apps/web/.env.example` for all variables.

Sync uploads files up to 4 MB (Vercel's request size limit); larger PDFs stay on the computer for now.
