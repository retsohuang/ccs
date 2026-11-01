## Problem Statement

A session's stale copy of settings.json overwrites the committed `~/.claude/settings.json` on the next ccs launch or `ccs sync`.

Claude Code saves settings.json by writing a temp file and renaming it over the path. When the path is the shared link (`~/.ccs/shared/settings.json`) or an account's link (`~/.ccs/instances/<account>/settings.json`), the rename replaces the link with a real file holding that session's copy of the settings. On every `ccs <profile>` launch and every `ccs sync`, ccs adopts a newer copy into the canonical file, because settings.json carries the `newer-wins` divergence policy (upstream #1681). A session that started before a dotfiles commit and saved later therefore brings back the old settings. This reverted committed dotfiles settings 8 times between 2026-10-04 and 2026-11-01 (the `settings.json.ccs-adopt*-recovery*` files in `~/.ccs/shared`). On 2026-11-01 it brought back removed bridge-session entries and dropped a new SessionStart hook in the dotfiles repo.

## Solution

The canonical file always wins for settings.json. When ccs finds a session's save in place of a link, it keeps the canonical file as it is, moves the save aside as a conflict copy, and restores the link. A save that differs from the canonical file only in default keys is dropped without a conflict copy, as the fork does today. To change a setting, edit `~/.claude/settings.json` (the dotfiles repo file) and commit it.

## Implementation Decisions

### settings.json is canonical-first

The shared item settings.json switches from `newer-wins` to `canonical-first`. The policy is hard-coded in the shared item list, not a config option. See ADR-0001.

Every reconcile point already follows the item's divergence policy, so the switch covers all of them:
- the canonical-first reconcile that `ensureSharedDirectories` runs before linking, over the shared path and every account path whose profile does not use profile-local shared resources (this runs on `ccs sync` and on every launch);
- the shared link at `~/.ccs/shared/settings.json`;
- each account's link, during `linkSharedDirectories` at launch.

With no canonical file, the existing canonical-first behavior applies unchanged: a single distinct variant is adopted as the canonical file, and several distinct variants are all moved aside as conflict copies with the existing warning.

### A divergent save becomes a conflict copy

A save whose bytes differ from the canonical file, and which is not equal to it apart from default keys, is moved aside unchanged as a conflict copy beside the path it was found at: `<name>.ccs-shared-conflict`, then `<name>.ccs-shared-conflict-1`, `-2` and so on. The canonical file's bytes and mtime do not change, and the link is restored. ccs prints the existing canonical-first warning line naming the path and the conflict copy, and nothing else. A save that cannot be parsed as JSON, or a canonical file that cannot be read, falls back to the byte comparison, so the save becomes a conflict copy.

### A save that differs only in default keys leaves no conflict copy

Before writing a conflict copy for settings.json, ccs runs the fork's tracked-defaults check (`keepTrackedDefaults`) with the canonical file and the save. When it reports the two equal apart from default keys, the save is deleted and the link is restored, with no conflict copy; ccs prints the same `Kept defaults in settings.json: ...` lines on standard error that it prints today for this case. A save byte-identical to the canonical file is deleted silently, as today. A save that differs in any other key becomes a whole conflict copy, and no `Kept defaults` line is printed for it.

### Settings change by editing the canonical file

The only way to change a setting for every account is to edit `~/.claude/settings.json` in the dotfiles repo and commit it. A change made inside a session (for example through `/config`) lasts until the next launch or `ccs sync`, which turns it into a conflict copy.

### The diverged settings adoption tests follow the new policy

In the `diverged settings adoption` block of the shared-manager tests, the tests whose subject is settings.json are rewritten to expect the canonical file to win: the two `adopts a diverged ... settings.json` tests, `does not create a backup when the diverged copy matches the canonical file`, and the nested `tracked default keys` tests including `launch lines`. The tests that check the newer-wins copy-in mechanics (failed backup, concurrent writers, publication races, file modes, malformed JSON, dangling canonical link, Windows copy fallback) and use settings.json only as the example file move onto `installed_plugins.json`, which still uses that copy-in path, and keep checking the same things. Tests that pass unchanged under the new policy stay as they are.

### sdd is committed in the fork

The fork commits its sdd setup: `.claude/settings.json`, the `sdd/` tree, and the SDD block that `sdd sync` writes into CLAUDE.md.

## Test seams

- Shared-manager filesystem. Isolates: `~/.claude`, `~/.ccs/shared` and `~/.ccs/instances` in a `mkdtemp` folder via HOME and CCS_HOME. Fake records: the files left on disk after `linkSharedDirectories` or `ccs sync` (`ensureSharedDirectories`) runs.
  Cases: a stale save at the shared path or at an account's path leaves the canonical file unchanged, puts the save in `.ccs-shared-conflict` and restores the link; a save differing only in `model` or effort leaves no conflict file; a save identical to the canonical file leaves nothing.

## Non-Goals

- A config option to choose the policy: Retso said so.
- Per-account rules and skills: out of scope for this change; revisited in its own grilling if Retso wants it.
- Any report of conflict copies beyond ccs's existing warning line: out of scope for this change; revisited if a `/config` change gets lost unseen.
- Stopping Claude Code's save from replacing the link, and the window until the next launch or sync: technically impossible from ccs, because Claude Code does the write.
- The 8 old `settings.json.ccs-adopt*-recovery*` files in `~/.ccs/shared`: out of scope for this change; Retso can trash them by hand.

## Impact

- Affected code:
  - Modified: src/management/shared-manager/types.ts, src/management/shared-manager/canonical-first-file-claims.ts, tests/unit/shared-manager.test.ts, CLAUDE.md
  - New: GLOSSARY.md, docs/adr/0001-settings-json-is-canonical-first.md

## Further Notes

- [Risk] A `/config` change made in a session is lost at the next launch or sync. -> Mitigation: it survives as a conflict copy, and the warning line names it.
- The settings.json branch in the diverged-file adopter (the `keepTrackedDefaults` call on copy-in) is no longer reached once settings.json is canonical-first. It is left in place; removing it is not part of this change.
- No user documentation describes settings.json adoption, so no docs page changes. No `--help` text changes.
- Release, after the change is merged into the fork's `main`: Retso runs it by hand. He cuts a retso release with his release flow, bumps the ccs formula in the `retsohuang/dotfiles` tap, and runs `brew upgrade ccs` on the MacBook Pro and the Mac mini. The MacBook Air does not install ccs. This is not a task of the change.
