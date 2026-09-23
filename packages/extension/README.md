# jword capture (Chrome extension)

Reads the job posting in the current tab and opens a jword review panel on the right side of
that page. From the panel you add the posting as a new application or update one you already
track. See [decision 016](../../docs/decisions/016-browser-extension-capture.md) (capture rules) and
[decision 017](../../docs/decisions/017-extension-overlay-capture-api.md) (overlay and API).

The panel is an extension page framed into the job tab, so the job site cannot read it. It talks
only to the extension's background worker. The worker calls jword's `/api/extension/*`
endpoints, and Chrome sends your normal jword sign-in cookie with those calls. The extension
stores no password or token.

## Install (unpacked)

```bash
pnpm ext:build            # bundles into packages/extension/dist
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose `packages/extension/dist`. The id shown must be
   `bnjlbmpmikpggohfhmfpddeeokbjpkbk` (pinned by the manifest `key`).
3. On the jword server, set `JWORD_EXTENSION_ID=bnjlbmpmikpggohfhmfpddeeokbjpkbk` (`.env.local`
   for local dev, the Vercel project for hosted) and restart it. Without it the API refuses every
   call.
4. Pin "jword capture" to the toolbar.
5. Optional: open the extension's **Options** to set the jword address. The default is
   `http://localhost:3200` (local dev). For the hosted tracker enter its `https://` address; Chrome
   asks you to allow the extension on that site, which lets the worker call jword there.

After changing extension code, run `pnpm ext:build` again and press the reload icon on the
extension card. Pages captured before the reload need a refresh.

## Use

Open a job posting, click the jword button (or press **Alt+Shift+J**). The panel opens beside the
page with the posting filled in (status defaults to Applied). Check the fields (anything guessed is
called out), choose a matching application to update or **New application**, and save. The **X**
closes the panel. Clicking the button again re-reads the page; this is useful when LinkedIn
switches jobs without reloading.

If you are signed out, the panel says so. Click **Sign in to jword**, sign in in the tab that opens,
then click **Try again**. The posting is kept.

## Permissions

| Permission                                | Why                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `activeTab`, `scripting`                  | Read the job page and draw the panel, only when you click the button.                  |
| `storage`                                 | Remember the jword address; hold the capture shown in each tab's panel.                |
| host `localhost`, `127.0.0.1`             | Call a local jword's capture API with your session.                                    |
| optional `https://*/*` (granted per site) | Call your hosted jword's capture API, only after you approve that site.                |
| web-accessible `overlay.*`                | Lets the panel page be framed into the job tab (dynamic URL, so sites can't probe it). |

## Supported sites

See [SITES.md](SITES.md), including how to add a site.

## Tests

- `pnpm vitest run --project unit packages/extension`: extractors and the worker's API client.
- `pnpm test:e2e tests/e2e/extension.spec.ts`: loads the built extension into Chromium.
- `pnpm test:e2e tests/e2e/extension-api.spec.ts`: the API's Origin, session, and field checks.
