# jword capture (Chrome extension)

Reads the job posting in the current tab and opens jword's `/capture` page to review it, then add
it as a new application or update one you already track. See
[decision 016](../../docs/decisions/016-browser-extension-capture.md).

The extension never talks to jword's server and holds no credentials. It reads the page you click
it on, shows jword's `/capture` page in Chrome's side panel, and hands the posting to that page. Saving uses your
normal jword sign-in.

## Install (unpacked)

```bash
pnpm ext:build            # bundles into packages/extension/dist
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose `packages/extension/dist`.
3. Pin "jword capture" to the toolbar.
4. Optional: open the extension's **Options** to set the jword address. The default is
   `http://localhost:3200` (local dev). For the hosted tracker enter its `https://` address; Chrome
   asks you to allow the extension on that site.

After changing extension code, run `pnpm ext:build` again and press the reload icon on the
extension card.

## Use

Open a job posting, click the jword button (or press **Alt+Shift+J**). The side panel opens with
the posting filled in (status defaults to Applied). Check the fields (anything guessed is called out), choose a matching
application to update or **New application**, and save. If the panel asks you to sign in, do
it in the new tab it opens, then click "I've signed in"; the posting is kept.

## Permissions

| Permission                                | Why                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `activeTab`, `scripting`                  | Read the job page only when you click the button.                       |
| `sidePanel`                               | Show the review page next to the job posting.                           |
| `storage`                                 | Remember the jword address; hold the latest posting per browser window. |
| host `localhost`, `127.0.0.1`             | Hand the posting to a local jword `/capture` page.                      |
| optional `https://*/*` (granted per site) | Hand it to your hosted jword, only after you approve that site.         |

## Supported sites

See [SITES.md](SITES.md), including how to add a site.

## Tests

- `pnpm vitest run --project unit packages/extension`: extractors against fixtures.
- `pnpm test:e2e tests/e2e/extension.spec.ts`: loads the built extension into Chromium.
