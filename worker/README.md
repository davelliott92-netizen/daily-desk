# Suggestions helper (Cloudflare Worker, free)

The 6:30am Claude check needs a private place to leave its suggestions,
and your app collects them from there. This helper is that place. It's
protected by a password (`TOKEN`) that only you, the app and the
scheduled check know.

It can also show your iCloud calendars on Today (optional — see the end).

## Set it up (about 10 minutes, on your Mac)

1. Sign up free at dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Create Worker**, name it `desk-calendar`, and click **Deploy**.
3. Click **Edit code**.
   - Delete what's there.
   - Paste in all of `calendar-worker.js`.
   - Click **Deploy**.
4. Create the storage:
   - Go to **Storage & Databases → KV → Create namespace** and name it `desk`.
5. Back on the worker, go to **Settings**:
   - **Bindings → Add → KV namespace**. Set the variable name to `DESK` (capitals) and choose the `desk` namespace.
   - **Variables and Secrets → Add**:

     | Name | Type | Value |
     |---|---|---|
     | `TOKEN` | Secret | A long random password. Let your password manager create and save it. |
     | `ALLOWED_ORIGIN` | Text | `https://YOUR-USERNAME.github.io` |

   - Click **Deploy** if asked.
6. Copy the worker's address, e.g. `https://desk-calendar.yourname.workers.dev`.

## Connect the app

In the app, go to **Settings → Suggestions helper**, then:
1. Paste the address.
2. Paste the `TOKEN` password.
3. Tap **Check now**. It should say **Connected**.

## Optional: show your calendars on Today

Add one more secret, `CALENDARS`, with one iCloud "Public Calendar" link per line,
e.g. `Personal=webcal://…`.

To get a link:
1. On your iPhone, open **Calendar → Calendars**.
2. Tap **ⓘ** next to the calendar.
3. Turn on **Public Calendar → Share Link → Copy**.

Anyone with that exact link can view the calendar, so keep it private.
Turning Public Calendar off and on again creates a new link.

The calendar supports normal, all-day and multi-day events, and daily, weekly,
monthly-by-date and yearly repeats. It doesn't yet support rules like
"second Tuesday of the month".
