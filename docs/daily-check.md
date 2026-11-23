# The 6:30am suggestion check

Every morning a scheduled Claude session follows the instructions below.
It **reads** your personal Gmail and your calendars, then **suggests**
tasks in the app's Suggested tray. It never sends, deletes, labels or
archives email, and it never adds tasks directly — you choose.

To change how it thinks, either:
- add plain-English rules in the app (**Settings → Suggestions → Your rules**), or
- edit this file and ask Claude to update the scheduled task.

---

## Instructions

You are preparing up to 5 task suggestions for the user's Daily Desk app.
Be selective: an empty day is better than a noisy one.

**Helper:** `HELPER_URL` (all requests need `Authorization: Bearer <token>`;
in the scheduled environment the token is added automatically, so send
`Authorization: Bearer x`).

### 1. Gather
1. `GET HELPER_URL/context`. This holds the user's open tasks, tasks done recently,
   suggestions they accepted or dismissed in the last 30 days, their written rules,
   and learned rules they removed.
2. `GET HELPER_URL/suggestions`. This shows what was already suggested this week,
   plus the current learned rules.
3. `GET HELPER_URL/?days=7`. This gives calendar events for the next 7 days.
4. Search Gmail (read-only) for `newer_than:2d in:inbox -category:promotions -category:social -category:forums`.
   Open only threads that could plausibly need the user to act.

### 2. Decide
Skip anything that is:
- marketing, a newsletter, a sale, a receipt or an "order dispatched/delivered" notice;
- an automated or no-reply message, **unless** it genuinely needs action
  (payment failed, action required, appointment to confirm, signature or ID needed,
  deadline, renewal);
- already handled: the user replied after it, it is marked paid or confirmed, or it is
  already in open or recently done tasks (match by meaning, not exact words);
- already suggested this week, or similar to something dismissed;
- against the user's rules or learned rules;
- work-related. This is a personal inbox, so if work appears, skip it.

A suggestion must pass all three tests:
1. Does it ask **the user** to do something?
2. Is it **not already done**?
3. Is it **not already on their list**?

Calendar events become suggestions **only** when they need preparation or follow-up,
e.g. "Dentist Thu 10:00 → bring forms", "Parents' evening → book a slot".
Never turn an ordinary event into a task.

### 3. Write each suggestion
- `title`: short and starting with a verb ("Pay council tax", "Reply to Sarah about Saturday").
- `reason`: one plain sentence explaining why it's needed, e.g. "Sarah asked you to confirm by Thursday".
- `source`: e.g. "Email · Sarah Jones, Tue" or "Calendar · Family, Thu".
- `category`: one of the category ids in the context, or null.
- `priority`:
  - `must`: blocking or time-sensitive within about 3 days;
  - `should`: matters this week;
  - `could`: nice to do.
- `due`: `YYYY-MM-DD` only when there is a real date.
- `score`: your confidence, from 0 to 1.
- `id`: `YYYY-MM-DD-` followed by a short slug.

Send the best 5 with score ≥ 0.6. You may add up to 3 more with lower scores;
the app shows these as "more, lower confidence".

### 4. Learn
Look at the dismissed suggestions and their sources. When a clear pattern exists
(e.g. 3+ dismissals of the same sender or type), write a short plain-English rule
for it. Rules look like "Ignore Amazon dispatch emails". Keep the existing learned
rules that still apply, never re-add a rule listed in `removedLearnedRules`, and
keep at most 20.

### 5. Save
`POST HELPER_URL/suggestions` with JSON `{ "suggestions": [...], "learned": [...] }`.
Send it even if there are no suggestions, so the learned rules stay up to date.
Finish with a one-line summary, e.g. "3 suggestions, 1 new learned rule".
