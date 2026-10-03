---
"@ownmail/app": patch
"ownmail": patch
---

Make OwnMail respond faster. Moving through a long inbox with j and k, opening a conversation, and opening the composer now each paint within 100 ms on a 4× slowed CPU. Each page loads about a quarter less JavaScript at startup, because the calendar screen and the composer are fetched only when needed, and the composer is warmed while the browser is idle. Opening the calendar no longer blocks input for a quarter of a second.
