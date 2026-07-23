#!/usr/bin/env python3
"""
Stop hook: detect canonical-doc changes and remind Claude to invoke @historian.

Adapted from exlibris's battle-hardened version. Commit-aware: detects
watched-path changes both from commits landed since the historian last ran
(tracked via the state marker the historian advances) and from uncommitted
working-tree edits.

Mirror-specific addition — the worktree/branch gate: this repo will run
multi-agent orchestration with linked worktrees on feature branches. The
historian only operates in the primary checkout on main; implementation
worktrees get a silent no-op. Decisions made mid-implementation are journaled
when they land back on main.

The marker (.claude/.historian-last-seen, gitignored) is ADVANCED BY THE
HISTORIAN after it logs — not by this hook — so the historian's own journal
commit doesn't re-trigger the reminder. This hook only READS the marker, and
seeds it once on first run.

No-ops cleanly when:
- Already responding to a previous Stop hook (avoid loops)
- Not inside a git repo
- In a linked worktree, or on any branch other than main
- No new watched commits since the marker AND nothing uncommitted
- Only journal files changed (excluded to prevent self-triggering)
"""

import json
import os
import subprocess
import sys


WATCHED_PREFIXES = (
    "DESIGN.md",
    "docs/adr/",
    "docs/proposals/",
    "spike/OUTCOME",
    "spike-v2/OUTCOME",
    ".claude/skills/",
    ".claude/agents/",
    ".claude/commands/",
    ".claude/hooks/",
    "CLAUDE.md",
)

EXCLUDED_PREFIXES = (
    "docs/journal/",
)

STATE_FILE = ".claude/.historian-last-seen"


def _git(args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def _read_marker():
    try:
        with open(STATE_FILE) as fh:
            return fh.read().strip()
    except OSError:
        return None


def _write_marker(sha):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w") as fh:
            fh.write(sha + "\n")
    except OSError:
        pass


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    if data.get("stop_hook_active"):
        return 0

    cwd = data.get("cwd") or os.getcwd()
    try:
        os.chdir(cwd)
    except Exception:
        return 0

    # Must be inside a git repo.
    git_dir = _git(["rev-parse", "--git-dir"])
    if git_dir.returncode != 0:
        return 0

    # Worktree/branch gate: historian runs only in the primary checkout on
    # main. Linked worktrees have --git-dir != --git-common-dir.
    common_dir = _git(["rev-parse", "--git-common-dir"]).stdout.strip()
    if common_dir and os.path.realpath(git_dir.stdout.strip()) != os.path.realpath(common_dir):
        return 0
    if _git(["branch", "--show-current"]).stdout.strip() != "main":
        return 0

    head = _git(["rev-parse", "HEAD"]).stdout.strip()
    if not head:
        return 0

    marker = _read_marker()

    # First run after install: seed the marker at HEAD and no-op, so we don't
    # flag the entire pre-existing history as "unlogged."
    if marker is None:
        _write_marker(head)
        return 0

    changed: set[str] = set()

    # (1) Committed changes since the marker.
    if marker != head:
        diff = _git(["diff", "--name-only", f"{marker}..HEAD"])
        if diff.returncode == 0:
            changed.update(diff.stdout.splitlines())
        else:
            # Marker SHA is gone (rebase / amend / fresh clone). Reseed to HEAD
            # and rely on working-tree detection only for this run.
            _write_marker(head)

    # (2) Uncommitted working-tree changes (inline edits not yet committed).
    status = _git(["status", "--porcelain"])
    for line in status.stdout.splitlines():
        if not line.strip():
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        changed.add(path.strip().strip('"'))

    files = [f for f in changed if f and not f.startswith(EXCLUDED_PREFIXES)]
    # Match both directions: a changed file under a watched prefix, or a
    # collapsed untracked directory (git status shows "?? docs/") that
    # contains a watched prefix.
    material = sorted(
        {
            f
            for f in files
            if f.startswith(WATCHED_PREFIXES)
            or (f.endswith("/") and any(p.startswith(f) for p in WATCHED_PREFIXES))
        }
    )

    if not material:
        return 0

    file_list = "\n".join(f"  - {f}" for f in material)
    reason = (
        "Historian check: canonical docs changed since the last journal entry:\n"
        f"{file_list}\n\n"
        "Invoke @historian. It will: (1) decide if these are journal-worthy, "
        "(2) write a journal entry, (3) commit and push to origin/main, and "
        "(4) advance its state marker (.claude/.historian-last-seen) to the "
        "new HEAD. If the changes are trivial (typo, reformat, whitespace) or "
        "already logged, the historian says so and advances the marker without "
        "committing — so they aren't re-flagged next turn."
    )

    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
