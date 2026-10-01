---
"@ownmail/app": minor
"@nylas-labs/cli-kit": patch
---

Calendar events now open beside the grid and can be rearranged by dragging. On desktop, clicking an event shows its details in a pane on the right, with a button in the top bar to show or hide it, so the week stays visible; Edit opens the editor as before, and phones keep the bottom sheet. In the day and week views you can drag across empty time to start a new event, drag an event to move it, and drag its top or bottom edge to resize it, all in 15-minute steps. Dropping outside the grid or pressing Escape cancels, and an event is put back with a message if the change cannot be saved. The same is available from the keyboard: Alt with an arrow key moves the focused event, Shift and Alt with Up or Down changes when it ends, and Enter saves. Read-only events cannot be moved, and moving one occurrence of a repeating event changes only that occurrence. The editor now offers times in 15-minute steps, keeps an event's real length when you edit it, and lets you change the date of an existing timed event.

`@nylas-labs/cli-kit` adds the optional `master_event_id` field to the v3 `Event` type.
