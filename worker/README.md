# Calendar helper (Cloudflare Worker, free)

The app can't read iCloud calendar links directly, because browsers block it.
This tiny helper fetches your calendars and passes today's events to the app.
Your calendar links are stored only inside the helper, never in the app's public code.

## 1. Get your iCloud calendar links

Do this for **Personal** and **Family**.
Only the person who *owns* a calendar can do this. If someone else created Family, they'll need to do it for that one.

1. On your iPhone, open **Calendar** → **Calendars** (bottom middle).
2. Tap the **ⓘ** next to the calendar.
3. Turn on **Public Calendar** → **Share Link…** → **Copy**.
4. Paste it somewhere private for a moment, such as a note. It starts with `webcal://`.

*"Public" means anyone with this exact link could view the calendar. Nobody can find it without the link.
If one ever leaks, turn Public Calendar off and on again to get a new link.
Your family's normal sharing is unaffected.*

## 2. Create the helper

1. Sign up free at dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Create Worker**.
   - Name it `desk-calendar` and click **Deploy**.
3. Click **Edit code**.
   - Delete what's there and paste in all of `calendar-worker.js`.
   - Click **Deploy**.
4. Go back to the worker → **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   |---|---|---|
   | `TOKEN` | Secret | A long random password. A password manager can generate one. |
   | `CALENDARS` | Secret | One per line: `Personal=webcal://…` and `Family=webcal://…` |
   | `ALLOWED_ORIGIN` | Text | `https://YOUR-USERNAME.github.io` |

5. Copy the worker's address, e.g. `https://desk-calendar.yourname.workers.dev`.

## 3. Connect the app

In the app, go to **Settings → Calendar**:
- paste the helper address
- paste the `TOKEN` password
- tap **Check calendar now**

Today will now show your events every time you open the app.

## What's supported

- Normal events
- All-day and multi-day events
- Daily, weekly (including "Mon, Wed, Fri"), monthly-by-date and yearly repeats
- Skipped and moved occurrences

Not yet supported: rules like "second Tuesday of the month". Those events show on their first date only.
