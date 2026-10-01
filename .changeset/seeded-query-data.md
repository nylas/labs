---
"@ownmail/app": patch
---

Fix a crash in the conversation reader ("Cannot destructure property 'thread'"). When the reader's cached data was replaced by a background load, one render could see no data and the screen failed. The reader, mail lists, folders, calendar and contacts now keep showing what they already loaded until the new data arrives.
