# Writalin

Calm, local-first notes for students: ADHD friendly, research friendly and PDF friendly.

Notes are plain Markdown files in a folder you choose (a **vault**), so they open cleanly in Obsidian and any text editor. An optional account (email code + password) syncs a vault between computers.

## What works today

- **Vaults:** pick a folder (File System Access API) or keep notes in the browser where folders aren't supported. Several vaults with a switcher. Fast index cached in IndexedDB.
- **Editor:** Obsidian-style live preview on CodeMirror 6. `/` menu for blocks, `[[` note links and `#` tag completion, collapsible headings, outline, focus mode (`Ctrl+.`), print layout preview with subtle page breaks, autosave with conflict detection.
- **Zones:** a left rail with a New note button, then Home, Calendar, Tasks and Activity (`Alt+1`…`Alt+4`). An open note has a side pane for a second workspace (its + adds a task, Tasks, Calendar, or a new or existing scratch pad), a bottom dock (Format, AI, Insert, Import, Export), and the `Ctrl+K` palette, where every command has a one-line description. Focus timer (30 min default, gentle 5 min break prompt).
- **Look and feel:** round, borderless controls; hover is a soft gradient that follows the cursor (`packages/ui/src/glow.ts`), off for reduced motion and on low-end devices.
- **Calendar zone:** full-page month/week/day, a panel for the selected day (reminders, notes, words written) and the next two weeks.
- **Activity zone:** GitHub-style contribution boxes for words written and notes created per day, with streaks and totals. Words are logged in `.writalin/activity.json`; notes count by their `created` date.
- **AI study helper (opt-in):** explain simply, summarize, main point, break into steps, flashcards, quiz, "Where was I?", and ask a question. Each account chooses the built-in key or its own Anthropic key; see below.
- **Links and tags:** backlinks ("Linked from"), rename-safe links (renaming a note rewrites links to it), tag filtering, full-text search.
- **Images and drawings:** paste, drop or insert an image; on its own line it gets a resize handle, S/M/L/Full sizes (Obsidian's `![[pic.png|320]]`), a grip to drag it to another line, and Delete. `/drawing` adds an SVG drawing box you draw on in place (pen, highlighter, eraser, colours, undo).
- **Reminder links:** type `[[` in a note and pick a reminder to link it (`[[Reminders#^id|text]]`). Clicking the link opens that day in the Calendar, and the reminder lists the notes that link to it.
- **Deleting:** notes, tasks, reminders and scratch pads delete straight away with an Undo in the toast.
- **Workspaces:** Tasks (vault-wide tasks in `Tasks.md` plus each note's own checklist, as cards: Today / Upcoming / No date), Calendar (notes by creation date, reminders in `Reminders.md`, month/week/day), scratch pads in `Scratch/` with "Move to note", PDF viewer (PDF.js, search, zoom, thumbnails, highlight → quote with page link), images, a second note side by side.
- **Themes:** Light, Dark, Midnight, Warm Paper, plus a custom theme editor with gradients and contrast warnings. Stored in `.writalin/themes/`.
- **Import / export:** Markdown, folders, Obsidian vaults, PDFs, images, `.zip`. Export a note as PDF (A4 print layout), Markdown or HTML; a vault as `.zip`.
- **Accounts and sync:** email one-time code sign-up, create a password, password sign-in, conflict-safe sync to Neon Postgres (both versions are kept if two computers edit the same note).

Not built yet (see the plan): Chrome extension, graph workspace, drawing boxes, extension reminders.

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
3. Add `RESEND_API_KEY` from [Resend](https://resend.com). Without `EMAIL_FROM`, codes come from `onboarding@resend.dev`, which Resend only delivers to your own Resend account email. To sign in anyone else, verify a domain in Resend and set `EMAIL_FROM`, e.g. `Writalin <login@your-domain.com>`.
4. Redeploy so the new variables apply. The API creates its tables the first time it runs (or run `DATABASE_URL=... pnpm --filter @writalin/web db:migrate`). See `apps/web/.env.example` for all variables.

### AI keys

- **Built-in:** set `ANTHROPIC_API_KEY` in Vercel. It's only read by the `/api/ai/*` functions and never reaches the browser. Each account gets `AI_DAILY_LIMIT_BUILTIN` requests a day (default 40).
- **Own key:** set `AI_KEY_ENCRYPTION_SECRET` (32+ random characters, e.g. `openssl rand -base64 48`). Keys people save are checked with Anthropic, encrypted with AES-256-GCM (key derived from that secret, bound to the account id) and stored in Neon. The browser only ever sees the last 4 characters. Rotating the secret makes saved keys unreadable, and people are asked to enter them again.
- Requests use `claude-opus-5-5` (override with `AI_MODEL`) with Anthropic's server-side fallback turned on, so a declined request is retried on Anthropic's recommended fallback model.

Sync uploads files up to 4 MB (Vercel's request size limit); larger PDFs stay on the computer for now.
