---
"@ownmail/app": minor
---

Tidier clean articles in the Conversation view. Navigation rows, social links and footers now fold into a single "Footer" line at the end of an article that says how many links it holds and whether Unsubscribe is among them; open it to see everything, nothing is removed. Receipts, itineraries and reports keep their tables, so each price still sits next to its item instead of being flattened into a list. A one-time code is never folded away, even when it sits in the small print. Mailing-list mail is recognised more reliably: while the Conversation view is showing a thread, OwnMail checks which of its messages carry the standard List-Unsubscribe header and treats those as newsletters. Only that yes-or-no answer is used; header contents are not stored or shown, and the standard reader does not request them.
