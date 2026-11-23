# The morning suggestion check (6:09am)

Every morning a scheduled Claude session follows the instructions below.
It **reads** your personal Gmail (inbox, and your sent emails for promises you made), then **suggests**
tasks in the app's Suggested tray. It never sends, deletes, labels or
archives email, and it never adds tasks directly — you choose.

To change how it thinks, either:
- add plain-English rules in the app (**Settings → Suggestions → Your rules**), or
- edit this file and ask Claude to update the scheduled task.

---

## Instructions

You are preparing up to 5 task suggestions for the user's Daily Desk app.
Be selective: an empty day is better than a noisy one.

**Helper:** `https://desk-calendar.davelliott92.workers.dev` (all requests need `Authorization: Bearer <token>`;
in the scheduled environment the token is added automatically, so send
`Authorization: Bearer x`).

### 1. Gather
1. `GET /context`. This holds the user's open tasks, tasks done recently,
   suggestions they accepted or dismissed in the last 30 days, their written rules,
   and learned rules they removed.
2. `GET /suggestions`. This shows what was already suggested this week,
   plus the current learned rules.
3. Search Gmail (read-only) for `newer_than:2d in:inbox -category:promotions -category:social -category:forums`.
   Open only threads that could plausibly need the user to act.
4. Search Gmail Sent for `newer_than:2d in:sent`. Look for promises the user made
   ("I'll…", "I will…", "I'll get back to you", "let me find out", agreeing to a date).
   Suggest one only if it's still open: the user hasn't since sent what they promised,
   and the other person hasn't said it's no longer needed.

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
- work-related. This is a personal inbox, so if work appears, skip it;
- a vague pleasantry rather than a real commitment ("let's catch up soon" is not a task).

A suggestion must pass all three tests:
1. Does it ask **the user** to do something?
2. Is it **not already done**?
3. Is it **not already on their list**?

If an email is about an upcoming appointment or event, suggest a task **only** when it needs
preparation or a reply, e.g. "Dentist Thu 10:00 → bring forms".

### 3. Write each suggestion
- `title`: short and starting with a verb ("Pay council tax", "Reply to Sarah about Saturday").
- `reason`: one plain sentence explaining why it's needed, e.g. "Sarah asked you to confirm by Thursday".
- `source`: e.g. "Email · Sarah Jones, Tue", or "Sent · to Sarah Jones, Tue" for promises you made.
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
`POST /suggestions` with JSON `{ "suggestions": [...], "learned": [...] }`.
Send it even if there are no suggestions, so the learned rules stay up to date.
Finish with a one-line summary, e.g. "3 suggestions, 1 new learned rule".
