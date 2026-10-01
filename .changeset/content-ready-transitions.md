---
"@ownmail/app": patch
---

OwnMail no longer shows one inbox, folder or item while another is loading. Switching inbox replaces the whole app with a loader instead of blurring the previous inbox behind a cover. Opening another folder, search, contact or calendar range shows a skeleton that already names where you are going, rather than leaving the previous list under the new title. A delete confirmation, a failed-action message or a failed event draft no longer carries over to the next contact, conversation or event, and a folder no longer opens at the scroll position of the one before it. A conversation now opens at its top rather than at the scroll position of the one read before it, and the loading rows match the list density you chose, so nothing shifts when mail arrives.
