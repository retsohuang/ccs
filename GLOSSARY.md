# CCS

The vocabulary of CCS, the CLI that runs Claude Code and other agents under several accounts that share one `~/.claude`.

## Language

**Base snapshot**:
The canonical `installed_plugins.json` as ccs last saw it for one home, kept so a record merge can tell an uninstall from an install.
_Avoid_: backup, pre-image

**Canonical file**:
The `~/.claude` copy of a shared item, which ccs keeps as the source of truth for every account.
_Avoid_: master copy, main file

**Conflict copy**:
A session's save that differs from the canonical file, kept beside the shared path as `<name>.ccs-shared-conflict` (then `-1`, `-2`, ...).
_Avoid_: recovery file, backup

**Default keys**:
The settings.json keys a session may switch without the switch becoming the default: `model`, `effortLevel` and each `modelSettings.<id>.effortLevel`.
_Avoid_: tracked keys

**Record merge**:
Combining a home's copy of `installed_plugins.json` with the canonical file one record at a time, a record being keyed by plugin id, scope and project path.
_Avoid_: adoption, sync
