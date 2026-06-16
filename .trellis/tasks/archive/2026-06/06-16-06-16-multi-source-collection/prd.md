# Multi-source collection selection

## Goal

Allow one collection run to include multiple collectable platforms instead of a single selected platform.

## Requirements

- The collection source control in collection config must support selecting multiple enabled automatic collection platforms.
- Collection intent sync must target all selected collectable platforms that have syncable platform settings.
- Boss intent sync must keep mapping keywords, city, degree, and unmapped notices into the Boss-specific configuration.
- V2EX intent sync must make V2EX participate through the selected source list and its existing feed configuration; it should not pretend to map Boss-only fields.
- V2EX feed keywords must be editable independently from the global collection intent.
- Starting automatic collection must run the selected collectable platforms in a single user action, preserving existing adapter behavior and job library writes.
- Reserved/manual-import platforms remain out of automatic collection until an automatic adapter exists.

## Acceptance Criteria

- [ ] The "本次采集来源" UI is a multi-select and can hold Boss plus V2EX together.
- [ ] The sync button no longer says "同步到 Boss 配置" when multiple platforms are selected.
- [ ] Selecting Boss + V2EX and starting automatic collection runs Boss and V2EX sequentially without requiring Boss session for V2EX.
- [ ] Boss-only validation still requires at least one Boss keyword when Boss is selected.
- [ ] V2EX feed settings are visible when V2EX is among the selected sources.
- [ ] V2EX feed settings provide an editable keyword field, and sync fills it from the global collection intent without preventing manual edits.
- [ ] Existing single-platform Boss and V2EX flows continue to work.

## Notes

- Current automatic adapters are Boss and V2EX. Liepin, Zhilian, Maimai, and LinuxDo are manual-import/reserved sources in the current codebase.
