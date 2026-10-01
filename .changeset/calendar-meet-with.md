---
"@ownmail/app": minor
"@nylas-labs/cli-kit": minor
---

"Meet with…" in the calendar. Search for people in the calendar sidebar and their busy times appear on the day and week grid as hatched blocks beside your own events, each labelled with the person's name, so you can see when everyone is free. A legend lists each person with a swatch and says in words whether they have busy times, none, or have not shared their availability. Only busy and free times are requested: event titles, guests and locations are never fetched or shown, and the people you pick are not saved. Up to five people can be shown at once, and if availability cannot be loaded or is rate limited the calendar says so and offers to try again.

`@nylas-labs/cli-kit` adds `getFreeBusy` to the grant-scoped v3 client, with the `FreeBusyRequest`, `FreeBusy` and `FreeBusyTimeSlot` types.
