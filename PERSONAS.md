# Personas

Who Company Surface is for, written so product, copy, and feature decisions
can be checked against real kinds of people: "would Rosa open this before a
customer call?", "can Nora find her way around a surface she didn't make?".
They are composites, not real people. Three of them are already in the seed
data (`PEOPLE` in `app/models/surface.server.ts`), and each has a seeded
surface to start a walkthrough from.

| Persona                                         | Role                             | Main job for the app                                          | Home surface (seed)           | Cards they reach for                         |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| [Maya](#maya-the-head-of-product)               | Head of Product                  | Keep a launch's brief, plan, numbers, and talk in one picture | Atlas launch (Product)        | Documents, boards, charts, chats, views      |
| [Dev](#dev-the-engineering-lead)                | Engineering Lead                 | Hand coding work to agents and see what came back             | Launch retro (Product)        | Agent chats, pull requests, web pages, notes |
| [Rosa](#rosa-the-customer-success-manager)      | Customer Success                 | Know everything about one account before the next call        | Northwind (Customers)         | Documents, web pages, notes, search          |
| [Kenji](#kenji-the-brand-designer)              | Brand designer                   | Gather references and decisions for a visual direction        | Brand refresh (Design)        | Images, GIFs, sketches, web pages, boards    |
| [Nora](#nora-the-new-hire)                      | New hire, any team               | Understand a project from its surface, without a guided tour  | Any, made by someone else     | Saved views, search, focus, links            |
| [The agent](#the-agent-a-user-without-a-screen) | Surface Agent, or any MCP client | Do work on a surface and leave it tidy for people             | Agent test drive (Playground) | Every kind, through MCP tools                |

Plus two [anti-personas](#who-this-is-not-for) to say no to.

---

## Maya, the Head of Product

**Context:** runs product at a 60-person software company. Owns the Atlas
launch: a brief, a backlog, a few metrics, and a dozen conversations with
engineering, design, and customer success that all touch it.

**Goals**

- One place where the launch is visible as a whole: what's decided, what's
  in flight, what the numbers say.
- Walk into a review and show the plan, not a slide about the plan.
- See how a decision in a chat connects to the doc and the issues it changed.

**Pains today**

- The brief lives in Notion, the issues in Linear, the numbers in a
  dashboard, the decisions in Slack threads nobody can find a week later.
- Every review starts with ten minutes of "where's the link?".
- Status decks are out of date the morning after they're written.

**How Maya uses Company Surface**

- The **launch brief** as a document, with `@` links to the board, the
  chart, and the chat where each call was made.
- An **issue board** for the launch, and **charts** hung under the brief.
- **Saved views** ("Atlas launch", "Launch numbers") to fly the canvas to
  the right cluster in a review, on any screen size.
- **Filters** and **search** to dim everything but the agent's work, or
  everything but documents, when the canvas gets busy.
- Asks the agent to **arrange** the surface into columns by workstream
  before a meeting.

**What would make Maya stay:** the surface becoming the place reviews
happen, so it stays current because people work in it.

**Objections:** "Isn't this another tool to keep in sync?" (today it is: the
boards and charts are mocks, not live Linear or analytics). "Who else can see
my edits?" (everyone sees the same store, but there are no permissions yet).

**Speak to Maya with:** "See your whole launch on one canvas, and how every
piece connects." Lead with the picture, not the card kinds.

**Walkthrough story:** Maya opens Atlas launch the morning of a launch
review, flies to the "Launch numbers" view, asks the agent in a chat to add
a chart of signups, links it into the brief, and saves a view for the
meeting.

---

## Dev, the Engineering Lead

**Context:** leads a team of five and runs several coding agents a day on
cleanup, upgrades, and flaky tests. Reviews more agent pull requests than
human ones.

**Goals**

- Start an agent on a task and come back to a pull request with the
  reasoning attached.
- See every agent's work side by side: which chat produced which PR, and
  what it read along the way.
- Close the loop: merging moves the linked issues to Done.

**Pains today**

- Agent transcripts vanish into terminal scrollback or a vendor UI that
  doesn't link to the PR.
- The docs page an agent relied on is lost by review time.
- Retros on agent work are anecdotes, not evidence.

**How Dev uses Company Surface**

- **Live agent chats** (with `ANTHROPIC_API_KEY` set) whose tool calls show
  as cards and leave cards on the surface.
- **Pull requests** hung in a column under the chat that opened them, moved
  draft → open → merged from the footer.
- **Web pages** for the docs the agent read, under the same chat.
- **Sticky notes** for retro takeaways, next to the chats they're about.
- Drives the surface from **Claude Code over MCP** (`.mcp.json`) while
  coding, so the canvas fills in without switching windows.

**What would make Dev stay:** pull requests backed by a real repository, and
agent chats that can be resumed with full context.

**Objections:** "The PRs aren't real" (true: no repository behind them yet).
"I won't leave my terminal" (MCP means Dev doesn't have to).

**Speak to Dev with:** "Every agent run, its PR, and what it read, in one
column." Be concrete and technical; Dev reads tool names.

**Walkthrough story:** Dev opens Launch retro after a week of agent work,
reads the three agent chats and their PRs, merges one, watches the linked
issue move to Done, and adds a sticky note about the flaky test.

---

## Rosa, the Customer Success Manager

**Context:** manages twelve accounts, Northwind among them. Northwind is
mid-rollout and asking about SSO.

**Goals**

- Before every call, know what was promised, what's open, and who asked.
- Hand an account to a teammate without a two-hour handover meeting.
- Bring product the customer's real words, linked to the issue they affect.

**Pains today**

- Account context is split across CRM notes, email, a shared doc, and
  memory.
- Product asks "which customers want this?" and the answer takes a day.

**How Rosa uses Company Surface**

- A **surface per account** in the Customers space, with an account
  **document** (the SSO plan) and the customer's own site as a **web page**.
- **Sticky notes** typed during calls, then linked to the doc.
- **⌘K search** for a phrase from a past message or issue ("SSO", an issue
  identifier), which flies to the card and flashes the row.
- **Chats** with Maya and Dev about the account, mentioned in the doc with
  `@`.

**What would make Rosa stay:** finding a customer's history in seconds, and
links from account surfaces into the product surfaces that mention them.

**Objections:** "Links can't cross surfaces" (true today: links and
references stay inside one surface, so Northwind can't point at an Atlas
issue). "Many sites won't load in the web card" (frame-blocking; the card
offers open-in-new-tab).

**Speak to Rosa with:** "Everything about an account on one page, ready
before the call." Plain words; no canvas or card jargon.

**Walkthrough story:** Rosa has a Northwind call in ten minutes, opens the
Northwind surface, searches for SSO, reads the plan, adds a note of the
customer's new question, and links it to the document.

---

## Kenji, the brand designer

**Context:** brand designer leading a refresh across logo, color, and
components. Works with two design boards and a lot of references.

**Goals**

- Keep references, sketches, and decisions together, with the reasons.
- Show the team a direction visually, and let them react in place.
- Track design work alongside engineering without leaving the visual space.

**Pains today**

- Moodboards in one tool, tickets in another, rationale in a doc nobody
  opens.
- Quick sketches happen on paper and never reach the team.

**How Kenji uses Company Surface**

- **Images and GIFs** as reference cards, letterboxed and readable in dark
  mode on their light mat.
- **Sketches** for quick logo and layout doodles, in Paint's sixteen colors.
- **Web pages** of color tools and component libraries.
- **Issue boards** (DSN, AST) for design reviews and asset requests.
- **Border colors** and **locked** cards to keep the moodboard where it was
  composed while the rest of the surface rearranges.

**What would make Kenji stay:** uploading files directly (today images are
https addresses only), and a sketch tool good enough to replace paper.

**Objections:** "I can't drop a file in" (true: no uploads). "It's not
Figma" (it isn't meant to be; it's where Figma links and decisions meet the
rest of the company).

**Speak to Kenji with:** "Your references, sketches, and decisions on one
canvas, next to the work they shape." Show, don't list.

**Walkthrough story:** Kenji opens Brand refresh, adds a GIF reference,
sketches a logo variation, locks the moodboard, and files a DSN issue for
the next design review that links the sketch.

---

## Nora, the new hire

**Context:** joined last week. Was told "it's all on the surface" and handed
a link.

**Goals**

- Understand what the project is, who's involved, and what's happening now,
  without asking five people.
- Find the one document that matters first.

**Pains today**

- Onboarding docs are stale, and the real context is in conversations Nora
  wasn't part of.
- A canvas someone else made can look like a wall of cards.

**How Nora uses Company Surface**

- **Saved views** in the left nav as a guided tour someone left behind.
- **Focus** (double-click a header) to read one card at full size, then
  back to the canvas.
- **Links** between cards to follow how things relate, and the agent stripe
  to tell people's work from agents'.
- **⌘K search** and **Recent** to get back to what was just read.
- The **surface switcher** to see every space and surface in the workspace.

**What would make Nora stay:** a surface that explains itself in the first
minute.

**Objections:** "Where do I start?" (there's no overview or pinned start
card yet; saved views are the closest thing). "Who's working on this?"
(the store is single-player today, so there's no presence or activity feed).

**Speak to Nora with:** "Everything the team knows, laid out so you can
follow it." Nora is the real test of empty states and first impressions.

**Walkthrough story:** Nora opens Atlas launch for the first time, works
through each saved view, focuses the brief, follows a link to the board,
and searches for the issue assigned to her.

---

## The agent, a user without a screen

**Context:** the Surface Agent in live agent chats, or any MCP client (Claude
Code, another agent) connected to `/api/mcp`. Reads and writes the same
store people do, and every change shows on open canvases within seconds.

**Goals**

- Know what's on a surface and how it relates before changing it.
- Make cards people can read: documents in Markdown, links that say why.
- Leave the canvas tidier than it found it.

**Pains today (for agents in general)**

- Tools that speak in internal names ("item", "window") instead of the
  words people use.
- No sense of space: an agent can add ten cards and bury the one a person
  was reading.

**How the agent uses Company Surface**

- `list_cards`, `get_card`, and `search` to read; `get_layout` to see where
  things sit.
- `create_document` and `append_to_document` in Markdown, with
  `[text](item:<id>)` references and `![](item:<id>)` embeds.
- `arrange_cards` and `move_card` to lay out what it made; `save_view` to
  frame it for people.
- Everything it makes is marked agent-made (the stripe, badge, and "By
  agent" filter), so people always know who did what.

**Speak to the agent with:** tool names and descriptions that say "card",
parameters that are obvious, and errors that say what to pass instead.

**Walkthrough story:** in Agent test drive, a person asks the agent to plan
a launch; it makes a brief, a board with three issues, and a chart, links
them, arranges them into a column, and saves a view.

---

## Who this is not for

**The diagrammer.** Wants flowcharts, shapes, and connectors drawn to the
pixel. Company Surface is a canvas of working cards, not a whiteboard;
flowchart shapes were removed on 2026-10-25, and features should not drift
back toward Miro.

**The system-of-record admin.** Wants Company Surface to replace Linear,
the CRM, or the repository, with permissions and audit trails. Boards, pull
requests, and charts are views of work that lives elsewhere (mocks today,
integrations later), not the source of truth.

---

## Using these personas

- **Feature check:** name the persona a feature is for and the job it does
  for them. If it serves none of them, question it. If it only serves the
  agent, check that people can still read what it leaves behind.
- **Copy check:** read labels and empty states as Rosa (plain words) and as
  Nora (no prior context). Say "card" everywhere people or agents read.
- **Walkthroughs:** each persona's story starts from a seeded surface, so a
  walkthrough can run against a fresh dev server with no setup.
- **Roadmap signals:** real integrations behind boards and pull requests
  (Maya, Dev), links across surfaces (Rosa), file uploads (Kenji), a
  surface overview or start card (Nora), and multiplayer with permissions
  (everyone) are the gaps these personas would raise first.
