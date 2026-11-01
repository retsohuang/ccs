# settings.json is canonical-first

The canonical file `~/.claude/settings.json` wins over a session's save, which ccs keeps as a conflict copy unless it differs only in default keys. Upstream's newer-wins adoption let a session's stale copy revert committed settings 8 times between 2026-10-04 and 2026-11-01, so a setting now changes only by editing the canonical file, at the cost of losing in-session `/config` changes to a conflict copy at the next launch or sync.
