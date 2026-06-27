# Manual Default Resume Selection

The resume library uses a user-selected default resume instead of automatically treating the latest edited resume as default. Default resume is a global fallback for resume-aware actions when a job has no linked resume, so making it explicit keeps downstream behavior predictable and prevents ordinary editing from silently changing which resume powers future actions.
