# installed_plugins.json merges by record

Claude Code turns a home's `installed_plugins.json` symlink into a copy on every write, and whole-file newer-wins adoption then lost either the copy's plugin updates (16:32:38 on 2026-11-02) or the records other homes had added. ccs now combines the copy and the canonical file with a record merge, 3-way against the home's base snapshot, with the newest `lastUpdated` winning, at the cost of keeping one base snapshot per home and a merge that knows the registry's shape. Other shared plugin files keep newer-wins.
