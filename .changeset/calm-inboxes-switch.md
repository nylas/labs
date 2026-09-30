---
"@ownmail/app": patch
---

Switch between inboxes without a full page reload: the app shows a switching overlay, clears the previous inbox's cached mail, calendar, and contact state, and stays in the current section. Switching waits for in-flight saves, and plain form posts keep working as a fallback.
