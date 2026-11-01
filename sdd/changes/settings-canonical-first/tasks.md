## 1. sdd setup committed in the fork

Blocked by: none

What it delivers: The fork carries its sdd setup in git, so a fresh checkout has the plugins, the change tree and the SDD block in CLAUDE.md ("sdd is committed in the fork").

- [x] 1.1 Run `sdd sync` from the repository root so the SDD block is written into CLAUDE.md; `.claude/settings.json` is already committed, and `sdd/changes/settings-canonical-first/` is staged with CLAUDE.md ("sdd is committed in the fork").

Acceptance criteria:
- [x] CLAUDE.md contains the SDD block that `sdd sync` writes, and running `sdd sync` a second time leaves `git diff CLAUDE.md` empty.
- [x] `AGENTS.md` is still a symlink to CLAUDE.md (`test -L AGENTS.md`).
- [x] `sdd validate settings-canonical-first` passes.

## 2. The newer-wins copy-in tests run on installed_plugins.json

Blocked by: 1

What it delivers: The copy-in mechanics that still serve `installed_plugins.json` keep their tests once settings.json stops using them ("The diverged settings adoption tests follow the new policy").

- [x] 2.1 In tests/unit/shared-manager.test.ts, inside the `diverged settings adoption` block, move each test that checks the newer-wins copy-in mechanics and uses settings.json only as the example file onto `installed_plugins.json` at an account's plugins path, keeping what it asserts: `preserves diverged bytes when canonical backup creation fails`, `does not let a stale Windows fallback roll back newer canonical settings`, `preserves divergence when the canonical settings symlink is dangling`, `preserves malformed managed JSON instead of poisoning canonical settings`, `aborts relinking when a writer replaces the path after it is claimed`, `refuses to publish when the canonical file changes before publication`, `keeps adopted bytes recoverable when canonical changes after verification`, `fails reconciliation when the managed source reappears during late cleanup`, `retries backup publication without replacing a concurrent backup`, `preserves regular and symlink-target modes under a restrictive umask`, `publishes with the mode the canonical inode carries at publication time`. Rename a test only where its title names settings.

Acceptance criteria:
- [x] `bun test tests/unit/shared-manager.test.ts` passes with no production code changed in this section.
- [x] `grep -n "settings.json" tests/unit/shared-manager.test.ts` shows none of the 11 moved tests still writing settings.json.

## 3. settings.json is canonical-first

Blocked by: 2

What it delivers: A session's stale save no longer overwrites `~/.claude/settings.json` on launch or `ccs sync`; it is kept as a conflict copy, and a save that differs only in default keys is dropped with no copy.

- [ ] 3.1 In src/management/shared-manager/types.ts, set the settings.json shared item's divergence policy to `canonical-first` ("settings.json is canonical-first").
- [ ] 3.2 In src/management/shared-manager/canonical-first-file-claims.ts, when the claimed file is settings.json and its bytes differ from the canonical content, run `keepTrackedDefaults` (src/management/shared-manager/tracked-defaults.ts) on the canonical content and the claimed content; when it reports `identical`, delete the claim and call `reportDroppedDefaults` with its `dropped` lines instead of writing a conflict copy. A `null` result (unparseable JSON) or a missing canonical keeps today's conflict-copy path ("A save that differs only in default keys leaves no conflict copy", "A divergent save becomes a conflict copy").
- [ ] 3.3 In tests/unit/shared-manager.test.ts, rewrite the settings.json tests of the `diverged settings adoption` block to expect the canonical file to win: the two `adopts a diverged ... settings.json` tests, `does not create a backup when the diverged copy matches the canonical file`, and the nested `tracked default keys` and `launch lines` tests. Each asserts on the files left on disk in the `mkdtemp` home ("The diverged settings adoption tests follow the new policy", "Settings change by editing the canonical file").

Acceptance criteria:
- [ ] Test: a stale save at `~/.ccs/shared/settings.json` with a newer mtime, after `ensureSharedDirectories`, leaves the canonical bytes unchanged, leaves the save in `settings.json.ccs-shared-conflict` beside the shared path, and the shared path is a symlink again.
- [ ] Test: the same at an account's `settings.json`, once through `linkSharedDirectories` and once through `ensureSharedDirectories` (the `ccs sync` path).
- [ ] Test: a second divergent save at the same path lands in `settings.json.ccs-shared-conflict-1`.
- [ ] Test: a save that differs only in `model`, only in top-level `effortLevel`, or only in a `modelSettings.<id>.effortLevel` leaves no conflict file, leaves the canonical bytes unchanged, restores the link, and prints the matching `Kept defaults in settings.json: ...` line on standard error.
- [ ] Test: a save identical to the canonical file leaves no conflict file and prints nothing.
- [ ] Test: a save that differs in a default key and in another key becomes a whole conflict copy, leaves the canonical bytes unchanged, and prints no `Kept defaults` line.
- [ ] Test: a save that is not valid JSON becomes a conflict copy and leaves the canonical bytes unchanged.
- [ ] `bun test tests/unit/shared-manager.test.ts tests/unit/shared-claude-memory.test.ts` passes.
- [ ] `bun run validate` passes.
