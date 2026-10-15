# Tuberizer for YouTube (Chrome extension)

Adds an **AI Summary** button to YouTube watch pages. Clicking it opens the Tuberizer
summary for the current video in a large modal over YouTube, so you never leave the page.

## How it works

- `src/content.js` runs on `https://www.youtube.com/*` only. It injects the button into
  the watch page's action bar and, on click, opens a modal containing an iframe of
  `https://tuberizer.com/embed/youtube/<videoId>`.
- That route is the normal Tuberizer share page rendered without site chrome (it lives in the
  main Tuberizer web app repo), so the existing fetch-or-generate flow, loading and error states, and
  the Summary / Chat / Transcript tabs are reused as-is.
- The embed talks back to the content script with `postMessage` (origin-checked on both
  sides). It sends `ready`, `summary-status`, `seek` (timestamp clicks jump the YouTube
  video) and `close` (Escape pressed inside the iframe).
- Optional: a read-only Supabase lookup adds a small tick to the button on already-summarised videos.
  To turn it off, set `checkExistingSummaries: false` in `src/config.js`.

No build step, and no `permissions` or `host_permissions` are requested.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (or the unzipped release download).
4. Open any `youtube.com/watch?v=…` page (or refresh an open one) and click **AI Summary**.

After editing files, click the reload icon on the extension card, then refresh YouTube.

## Testing against a local Tuberizer

1. Run `npm run dev` in the Tuberizer web app repo (serves on `http://localhost:8080`).
2. Set `origin: "http://localhost:8080"` in `src/config.js` and reload the extension.
3. Chrome will ask whether youtube.com may access devices on your local network. Allow it,
   otherwise the iframe is blocked with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`.

The `/embed/youtube/:videoId` route must be deployed to tuberizer.com before the
production config works. Until then the modal shows "Couldn't load Tuberizer" after 20s.
