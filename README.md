# TimeLog

Personal activity timer + daily task tracker + progress/heatmap views.
No frameworks, no build step — plain HTML/CSS/JS. Data lives in `localStorage`
on the device it's used on.

## Folder structure
```
timelog/
  index.html        entry point
  css/style.css      all styling
  js/app.js           all app logic (timer, tasks, progress, heatmap, history)
  manifest.json       PWA manifest (name, icons, standalone display)
  sw.js               service worker (offline shell caching)
  icons/              app icons for home-screen install
```

## Run locally
Just open `index.html` in a browser, or use a static server (VS Code
"Live Server" extension works fine) — a server is only needed so the
service worker can register (file:// blocks service workers in most browsers).

## Deploy to GitHub Pages
```bash
git init
git add .
git commit -m "TimeLog v1"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```
Then: repo **Settings → Pages → Source: main branch, root** → Save.
Your app will be live at `https://<username>.github.io/<repo>/`.

## Install on iPhone
Open the deployed URL in Safari → Share → **Add to Home Screen**.
It opens full-screen, uses the app icon, and works offline (shell is cached).

## Features
- **Timer**: type an activity, Start/Pause/Resume/Stop. Starting a new timer
  auto-stops whatever was running. Same activity can have multiple sessions
  per day — they're summed for display, not merged.
- **Tasks**: add free-form tasks for today, tap to start a timer for that
  task, checkbox to mark done (independent of the timer).
- **Recurring tasks**: check "Repeat daily" when adding a task — it's
  auto-added to every day going forward until you tap "Stop repeating".
- **Progress tab**: 7-day time chart + 30-day per-activity time breakdown.
- **Heatmap tab**: GitHub-style yearly contribution graph, colored by total
  time tracked per day, hover/tap for exact time.
- **History tab**: all-time day-by-day log, paginated ("Load more").
- **Export**: JSON backup button — do this occasionally since localStorage
  isn't guaranteed-durable (cache clears, storage pressure, etc).

## Data model
```js
{
  records: {
    "YYYY-MM-DD": {
      tasks: [{ id, name, done, recurringId? }],
      sessions: [{ id, activity, startTime, durationSec }]
    }
  },
  activeSession: null | { activity, firstStart, elapsedBeforePause, running, segStart },
  recurringTasks: [{ id, name }]
}
```
