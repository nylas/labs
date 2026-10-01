---
"@ownmail/app": minor
---

Cleaner bubbles in the Conversation view. Each bubble now leaves out anything an earlier message in the thread already showed, even when the sender's mail app did not mark it as a quote, and drops signatures. When someone answers point by point between quoted lines, or writes below a quote, each answer appears under a short reference to the line it answers, with the name of the person who wrote that line. Small system lines in the stream show what email normally hides in headers: a person added to the thread, someone moved from To to Cc, or a changed subject. Quoted text the thread has not shown before stays available in the bubble, and "Show original" is still on every message.
