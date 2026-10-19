# jword capture (Chrome extension)

Reads the job posting in the current tab and opens a jword review panel on the right side of
that page. From the panel you add the posting as a new application or update one you already
track. See [decision 016](../../docs/decisions/016-browser-extension-capture.md) (capture rules) and
[decision 017](../../docs/decisions/017-extension-overlay-capture-api.md) (overlay and API).

The panel is an extension page framed into the job tab, so the job site cannot read it. It talks
only to the extension's background worker. The worker calls jword's `/api/extension/*`
endpoints, and Chrome sends your normal jword sign-in cookie with those calls. The extension
stores no password or token.

## Install

Other people install from jword itself: **Extension** in the nav (`/extension`) downloads the
Developer-mode zip and lists the steps (decision 027). A Chrome Web Store listing is planned.

```bash
pnpm ext:build            # bundles into packages/extension/dist and writes the release zips
```

`ext:build` writes (all git-ignored):

| Output                                     | Use                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `dist/`                                    | Load unpacked while developing.                                           |
| `release/jword-capture-<v>.zip`            | Developer-mode zip; keeps the manifest `key`, so the id stays pinned.     |
| `release/jword-capture-<v>-store.zip`      | Chrome Web Store upload; no `key` (the store rejects it, assigns an id).  |
| `../../public/downloads/jword-capture.zip` | The Developer-mode zip served by jword at `/downloads/jword-capture.zip`. |

The root `pnpm build` (Vercel's build command) runs `ext:build` first, so every deploy serves a
fresh zip.

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose `packages/extension/dist` (or the unzipped release). The id shown
   must be `bnjlbmpmikpggohfhmfpddeeokbjpkbk` (pinned by the manifest `key`).
3. On the jword server, set `JWORD_EXTENSION_IDS` (comma list; the older `JWORD_EXTENSION_ID` still
   works) to `bnjlbmpmikpggohfhmfpddeeokbjpkbk`, plus the store id once the store item exists.
   Without it the API refuses every call.
4. Pin "jword capture" to the toolbar.
5. The default jword address is `https://jword.work`. For local development open the extension's
   **Options** and enter `http://localhost:3200`. Another `https://` address makes Chrome ask you
   to allow the extension on that site.

After changing extension code, run `pnpm ext:build` again and press the reload icon on the
extension card. Pages captured before the reload need a refresh.

## Use

Open a job posting, click the jword button (or press **Alt+Shift+J**). The panel opens beside the
page with the posting filled in (status defaults to Applied). Check the fields (anything guessed is
called out), choose a matching application to update or **New application**, and save. The **X**
closes the panel. Clicking the button again re-reads the page; this is useful when LinkedIn
switches jobs without reloading.

The panel shows which account it saves to ("Saving to you@example.com"). If you are signed out, it
says so: click **Sign in to jword** (a new email creates an account), sign in in the tab that
opens, then click **Try again**. The posting is kept. **Watch this company** appears only for the
owner, who has discovery features (the panel asks `/api/extension/session`).

## Permissions

| Permission                                | Why                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `activeTab`, `scripting`                  | Read the job page and draw the panel, only when you click the button.                  |
| `storage`                                 | Remember the jword address; hold the capture shown in each tab's panel.                |
| host `jword.work`                         | Call jword's capture API with your session.                                            |
| host `localhost`, `127.0.0.1`             | Call a local jword's capture API with your session (development).                      |
| optional `https://*/*` (granted per site) | Call another jword address, only after you approve that site in Options.               |
| web-accessible `overlay.*`                | Lets the panel page be framed into the job tab (dynamic URL, so sites can't probe it). |

## Supported sites

See [SITES.md](SITES.md), including how to add a site.

## Tests

- `pnpm vitest run --project unit packages/extension`: extractors and the worker's API client.
- `pnpm test:e2e tests/e2e/extension.spec.ts`: loads the built extension into Chromium.
- `pnpm test:e2e tests/e2e/extension-api.spec.ts`: the API's Origin, session, and field checks.

### Watch a company without an application

On a supported job-board page, click the jword toolbar icon and choose **Watch this company**.
Confirm the company (or select an existing one), review the board check, then **Add to watchlist**.
Workday board landing pages and postings are both supported, including `myworkdaysite.com`
recruiting links. No URL copying or application is required. Already-watched companies link to
the watchlist for editing. After rebuilding the extension, reload it in `chrome://extensions`
and refresh the job-board tab to load the new action.
