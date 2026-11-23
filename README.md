# Daily Desk

A calm daily list, kanban board and habit tracker that lives on your
iPhone, iPad and Mac as a home-screen app.

- **No per-use costs.** It is plain HTML, CSS and JavaScript, hosted free on GitHub Pages.
- **Works offline.** Changes save on the device instantly and sync when you're back online.
- **Built to be changed.** Everything is small, readable files (see "Where things live").

---

## Setup (about 30 minutes, once)

### Step 1 — Put the app online (GitHub Pages)

1. Create a free account at github.com.
2. Click **+ → New repository**. Name it `daily-desk`, leave it **Public**, click **Create repository**.
   - Public is needed for free hosting. Only the app's code is public, never your tasks or calendar.
3. On the new repository page, click **uploading an existing file**.
   - Drag in *everything inside* this folder: `index.html`, `css`, `js`, `icons`, `worker`, and the rest.
   - Click **Commit changes**.
4. Go to **Settings → Pages**.
   - Under "Branch", choose `main` and `/ (root)`, then click **Save**.
5. After a minute your app is at `https://YOUR-USERNAME.github.io/daily-desk/`.

*If you've connected GitHub to Claude, Claude can do steps 2–4 for you.*

### Step 2 — Add it to your devices

- **iPhone / iPad:** open the address in **Safari** → Share button → **Add to Home Screen**.
- **Mac:** open it in Safari → **File → Add to Dock**.

At this point the app works, but each device keeps its own separate list.
Step 3 links them.

### Step 3 — Sync between devices (Firebase, free)

1. Go to console.firebase.google.com and sign in with your Google account.
2. **Create a project** called `daily-desk`. You can turn Google Analytics off.
3. Turn on sign-in:
   - Go to **Build → Authentication → Get started**.
   - Under **Sign-in method**, enable **Email/Password**.
   - Go to Authentication **Settings → Authorized domains → Add domain** and enter `YOUR-USERNAME.github.io`.
4. Create the database:
   - Go to **Build → Firestore Database → Create database**.
   - Choose location **europe-west2 (London)** and **production mode**.
   - Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
5. Connect the app:
   - Go to **Project settings** (gear icon) → **Your apps** → the **</>** (web) icon.
   - Register an app called "Daily Desk". You'll be shown a `firebaseConfig` block.
   - Copy those six values into `js/config.js` (the top of the file).
   - Re-upload `js/config.js` to GitHub.
6. Sign in from each device:
   - **On the device that already has your tasks**, open the app → **Settings → Sync** and click **Create account** with your email and a password.
   - On your other devices, use **Sign in** with the same email and password.

### Step 4 — Calendar (optional)

See `worker/README.md`. It takes about 10 minutes and shows today's events from your Personal and Family iCloud calendars at the top of Today.

---

## How it works (the rules baked in)

- **Today** shows tasks due today and anything you're Doing. Done items stay visible, crossed out, for the rest of the day.
- **Nothing turns red.**
  - Missed dates go to **Carried over**, with **Today** or **Let go**.
  - Let go removes the date and keeps the task on the Board.
- **Habits never go overdue.** Tick them or don't. The Habits screen shows what happened, with no streaks. Tap any square to fix a day you forgot to tick.
- **Busy mode** shows your top 3 Musts (soonest first), with "+N more", plus your core (starred) habits and a brain-dump box. Everything else is hidden, never deleted.
- **Quick add** understands:
  - `#home` (category, by the start of its name)
  - `!must` / `!should` / `!could` (or `!m` / `!s` / `!c`)
  - `today`, `tomorrow`, `fri`, `27/11`, `+3d`
  - On Today, a task with no date is added for today.
  - The `+` button with an empty box opens the full editor.
- **Work** is hidden outside work hours (set in Settings).
- **Board:** tap a card to edit or move it. On iPad and Mac, drag cards between columns. The Ideas column can be hidden in Settings or on the Board.

## Where things live (for making changes)

| You want to change… | Edit this |
|---|---|
| Colours (day and night) | `css/app.css` — the two token blocks at the top |
| Board columns, priority names, default habits and categories | `js/config.js` |
| What appears on Today / Busy / Board / Habits / Settings | `js/app.js` — one function per screen (`viewToday`, `viewBusy`, `viewBoard`, `viewHabits`, `viewSettings`) |
| Quick-add shortcuts (`#`, `!`, dates) | `js/parse.js` |
| How data is saved | `js/store.js` |
| Syncing | `js/sync.js` |
| Offline support | `sw.js` — bump `VERSION` after uploading changes so devices refresh promptly |

After changing a file, upload it to GitHub again. Devices pick up the new version the next time the app is opened, or the time after.

## Backups

Use **Settings → Export backup** about monthly and save the file to iCloud Drive.
**Import backup** restores it.

## Coming next

- **v1.5 — Suggested tasks (built).**
  - A daily 6:30am check by Claude reads your personal Gmail and both calendars.
  - It writes up to 5 well-reasoned suggestions into the tray at the top of Today.
  - The tray stays hidden until suggestions arrive. The check's instructions are in `docs/daily-check.md`.
  - Steer it with your own rules in **Settings → Suggestions**.
- **v2 — Project desk.** Free-form cards per project, with zoom and desk colours, for iPad and Mac.
