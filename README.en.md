# Workspace Manager

> 中文版: [**README.md**](README.md)

A single view over every VS Code workspace storage and Copilot chat session: disk usage, session inventory, **sessions hidden from the panel**, and stale index entries — all repairable in place.

> **It only recommends; it never deletes on its own.** Every deletion is triggered explicitly from the context menu, confirmed, and sent to the Recycle Bin.

*(Extension UI strings — command titles, setting descriptions, view name — follow your VS Code display language.)*

---

## ⚠️ Read this first

### 1. Reload the window after a repair (the extension offers you the button)

VS Code caches the chat session index **in memory**. If that workspace is open in a window, its next session change (sending a message / creating a session / renaming) writes the whole in-memory index back to disk and **overwrites** the repair you just made.

**You don't need to quit VS Code, and you don't need to switch windows** — the extension writes straight to disk and then offers an "**Reload Window Now**" button:

| Target workspace | What to do |
|---|---|
| It's the **current** window | Click "Reload Window Now" in the notification |
| It's open in **another** window | Run `Developer: Reload Window` there |
| It isn't open anywhere | Nothing to do |

> Why it works: `flushIndex()` only runs on **session changes**, and reloading does not trigger it — so the window between "written to disk" and "reloaded" is safe, as long as you don't send a message in those few seconds.
> To avoid reloading entirely, use the standalone script in `scripts\` (run it with VS Code fully closed).

### 2. "Clean Empty Sessions" looks at content, never at the title

The test is simply whether the session file's `requests` array is empty — i.e. **not a single message was ever sent**.
An empty title, or a title of "New Chat", is only a **hint**, not the criterion; **a session with content is never touched**.

### 3. The current workspace has no "Delete Storage" entry

It's not that clicking fails — the menu entry **never appears** (it uses a separate `contextValue`, and the `when` clause excludes it).
The reason: that storage is in use by VS Code. `state.vscdb` is a live SQLite connection, and force-deleting it can leave a **half-broken directory** that's harder to recover from than a full delete.

### 4. An accidental delete is recoverable — but quit VS Code first

A workspace storage directory name is a **stable hash of the workspace path** (same folder, same hash forever). Restore it from the Recycle Bin to its original location and it works again, sessions and state included.

⚠️ But if VS Code is still running, it has probably already re-created an empty directory with the same name → the restore **collides** and becomes `xxx (1)`.
**Correct order: quit VS Code → restore → then start it.**

---

## Glossary (read this — everything below depends on it)

Session visibility is decided by **two independent dimensions**. Mixing them up makes the panel impossible to understand.

**Dimension 1: does the index match the files?**

| Name | Meaning | In the panel |
|---|---|---|
| Normal | Indexed + file on disk | Shown |
| **Orphan** | **File on disk, not indexed** | **Invisible** — the file isn't lost, it just has no entry point |
| **Ghost** | **Indexed, no file on disk** | **Invisible** — see below |

**Dimension 2: is there any content?**

| Name | Meaning | In the panel |
|---|---|---|
| Has content | At least one message sent | Shown |
| **Empty session** | Not a single message sent (a freshly created file is ~1.5 KB and holds only UI state) | **Invisible**; a new chat may **flash briefly** and vanish — that's refresh throttling, **not a deletion** |

> **What the panel actually shows = indexed ∩ `isExternal:false` ∩ `initialLocation:"chat"` ∩ `isEmpty:false`**
> — that's the literal filter in `ChatService.getHistorySessionItems()`. It **does not check whether the file exists**.

### Why neither ghosts nor empty sessions show up

Neither appears in the panel. Different reasons, same outcome:

- **Empty sessions**: the index entry has `isEmpty: true` → filtered out by the condition above. The entry **still occupies a slot in the index** (only `clearSession` really removes it).
- **Ghosts**: a missing file **necessarily means no message was ever sent** — VS Code writes the JSONL and the index through the same path (`storeSessions`), so if a message was sent, the file exists. A ghost therefore also carries `isEmpty: true` → filtered out the same way.
- **The exception (the kind worth cleaning)**: the file was deleted or moved by an **external tool** while the index was left untouched — so the index still holds a stale `isEmpty: false`. Such a ghost **does** enter the list and only fails when you open it, showing up as a "blank item".

> That's why empty-session detection **must not trust the index's `isEmpty`** (it can be stale or simply wrong) — it has to read the file content. That's exactly what this extension does.

**External sessions**: Copilot CLI / Claude sessions whose ids start with `agent-host-` keep their data in `%APPDATA%\Code\agentSessionData\`.
Their ids contain `:` and `/`, so they can **never** line up with a file under `chatSessions\` — **never** treat them as ghosts.

---

## Usage

Explorer sidebar → **Workspace Manager**. Right-click a workspace node:

| Command | What it does |
|---|---|
| **One-Click Repair** | Removes empty sessions and dead entries, and brings hidden sessions back into the panel (how it works doesn't matter here — see the internals at the end) |
| **Restore Index Backup** | Rolls the index back to before the last change. **Swap-style**: clicking again swaps it back |
| **Clean Rebuildable Cache** | Clears each extension's workspace cache plus this extension's **old-format** index backups (to the Recycle Bin). **Touches** neither session data nor the index itself |
| Open This Workspace / Reveal Folder in Explorer / Copy Path | — |
| Delete This Workspace Storage | Visible only for non-current workspaces; goes to the Recycle Bin |

> Before touching the index, `state.vscdb` is backed up next to it as `state.vscdb.wsmgr-bak` — **exactly one copy, overwritten each time**, so it never piles up.

The title bar also has **Refresh**, **Generate Overview Report** and **Find Duplicate Sessions**. Hover a workspace node for the full story: target path, whether it exists, size breakdown, last used.

> **Find Duplicate Sessions**: fingerprints every session across all workspaces (**file size + SHA-1 of the first 64 KB**; ~46 ms for 105 files in practice).
> Duplicates can't occur within one workspace (the file name *is* the sessionId); they almost always come from a **session sync/migration tool** copying the same JSONL into several workspaces.
> It **only produces a report and deletes nothing**.

Expand a workspace and every row under **storage details** carries a category tag — so you don't have to guess whether something like `redhat.java` is safe to delete:

| Icon | Category | Meaning |
|---|---|---|
| 🔒 | **Data** | `chatSessions` / `chatEditingSessions` / `state.vscdb` / `workspace.json` — **do not touch** |
| 📦 | **Cleanable** | Extension workspace caches (rebuilt automatically, possibly a slow first run), old-format index backups |
| ❓ | **Unknown** | Purpose unclear — **not recommended to clean** |

> The classification policy is **better too few than too many**: only data is whitelisted, extension directories are treated as cache, and anything unrecognized gets no cleanup suggestion at all.
> `state.vscdb.backup` (VS Code's own) and the extra index backup are deliberately **not** cleanable — they're your safety net.

> The command palette also exposes the finer-grained **Repair Session Index** and **Clean Empty Sessions** if you want a single step.

**Right-clicking a session node** (Ctrl / Shift multi-select supported):

| Command | What it does |
|---|---|
| **Copy Sessions To…** | Copies to another workspace; the **source sessions are untouched** |
| **Move Sessions To…** | Copies to the target + moves the source files to the Recycle Bin + unregisters them from the source index |
| Delete Session | Goes to the Recycle Bin; multi-select supported |

⚠️ If a transfer involves the current workspace, you'll need to reload the window as prompted.

### Recommended workflow

Right-click a workspace → **One-Click Repair** → click "**Reload Window Now**".

That's it. (You can also do it step by step via **Repair Session Index** / **Clean Empty Sessions** in the command palette.)

### Avoiding gigantic sessions

Session files only ever grow: tool output and attachments are written verbatim (attachments are **base64-inlined**, so ×1.33), and the same data lands in both the `result` and `response` fields. Running a bare `git ls-files` in a repository with hundreds of thousands of files can produce a session hundreds of MB large.

| Habit | Why |
|---|---|
| **Bound your commands** | `git ls-files \| Select-Object -First 200`; list files with the Everything CLI (`es.exe`) instead of `Get-ChildItem -Recurse` |
| **Don't drop big files / images into the chat box** | Attachments are base64-inlined — a 5 MB image ≈ 6.7 MB of text. Say "here's the path, read what you need" instead |
| **One task, one session** | Longer sessions mean bigger snapshots; it also keeps old ones from being squeezed out by `trimEntries` into orphans |
| **Watch the size column** | Every row in the session list shows its size; anything over `wsManager.bigSessionMB` (default **50 MB**) gets a ⚠️ |
| **Don't keep chatting inside a monster** | It only grows. Jot down what matters → **Delete Session** |

> ⚠️ These sessions are a **single giant `kind0` snapshot (the whole file on one line)**, written via VS Code's "flat" path.
> Reading them line by line with `readline` will **hang** (a single line can be hundreds of MB).

### Standalone script (runs outside VS Code)

For when you want to skip the whole "reload" step — run it with VS Code fully closed.

```powershell
node scripts\repair-index.js --list                     # list every workspace
node scripts\repair-index.js --hash <hash>              # check-up, writes nothing
node scripts\repair-index.js --hash <hash> --apply      # write (quit VS Code first)
node scripts\repair-index.js --path "d:\your-project" --apply
```

If `Code.exe` is detected running, it **refuses to write** (`--force` overrides, at your own risk).

---

## Internals

### Where things live

```
%APPDATA%\Code\User\workspaceStorage\{hash}\
  ├── workspace.json            {"folder":"file:///…"} — which workspace this storage belongs to
  ├── chatSessions\{id}.jsonl   session data (kind0 full snapshot + kind1 deltas)
  ├── chatEditingSessions\
  ├── GitHub.copilot-chat\      debug-logs / transcripts / session resources
  └── state.vscdb               contains chat.ChatSessionStore.index (the session index)
```

The panel looks **only at the index inside `{hash}\state.vscdb`** — a file under `chatSessions\` with no index entry is as good as having no entry point:

```js
{ version: 1, entries: { "<sessionId>": { sessionId, title, lastMessageDate, timing,
    initialLocation: "panel", isEmpty, isExternal, lastResponseState, … } } }
```

> ⚠️ `initialLocation` must be exactly `"panel"` (the value of `ChatAgentLocation.Chat`) — any other value gets the entry filtered out of the panel.
> This is very easy to get wrong when rebuilding index entries.

### How orphans and ghosts come about

- `ChatSessionStore.trimEntries()` caps the index at **400 entries**, and it **deletes only index entries, never files** → older sessions beyond the cap become **orphans** (file present, no entry point)
- Moving session files between workspaces without updating the index turns an entire batch into orphans
- Sessions are **created empty**: the index entry is written on creation, but the JSONL only lands after the first message → abandoning one leaves a **ghost**
- So empty-session detection **can't rely on the `kind0` snapshot alone** (it always reads `"requests":[]`); it must also look for `"k":["requests",…]` deltas — and for large files, scan as a stream, return as soon as evidence is found, and **conservatively treat "nothing found" as "has content"**

### Why writes get overwritten, and why reloading fixes it

`ChatSessionStore.internalGetIndex()` is **synchronous** and returns the in-memory `indexCache`; `flushIndex()` then writes that whole object back to disk.
So writing to a workspace that's open in a window is a race against the in-memory copy — and the on-disk copy always loses.

**But `flushIndex()` only fires on session changes** (`storeSessions()`), and reloading a window doesn't trigger it (`onWillShutdown` merely joins an existing write task).
So "write to disk → reload immediately" is safe: the reload rebuilds `ChatSessionStore`, the in-memory cache is discarded, and everything is re-read from disk.

---

## Development

```powershell
# F5 → launch the Extension Development Host
node test\smoke.js      # smoke test (no VS Code required)
.\build.ps1             # package the vsix
```

## Roadmap

- Storage breakdown and cleanup suggestions
