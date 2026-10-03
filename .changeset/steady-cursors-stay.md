---
"@ownmail/app": patch
"ownmail": patch
---

Fix arrow-key navigation in Contacts, which reset on every re-render and did nothing. Typing in mail search now re-renders only the search box, Contacts rows re-render only when their own state changes, and dragging a calendar event re-renders only when it crosses into a new time slot. The mail and contacts screens are now loaded only on the pages that show them.
