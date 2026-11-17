# NFC business card – published pages

This repository publishes the card page, the owner app and the admin page for every customer.
Customer data never comes here: it stays in each customer's own Google account (or server).

## How it is organised

| Folder / file | What it is |
| --- | --- |
| `site/` | The shared pages (card page, `app/`, `admin/`), the same for every customer |
| `google/` | The server part for Google (Code, Core, appsscript.json); published as `downloads/` for administrators |
| `customers.json` | One entry per customer: folder, web app address, version |
| `tools/build-sites.js` | Builds the website: one folder per customer with its own `config.json` |
| `.github/workflows/publish.yml` | Runs the build and publishes after every change |

Links per customer: `https://mhhwilbrink.github.io/Kaart/<folder>/` (card page), `…/<folder>/app/`, `…/<folder>/admin/`.
The entry with `"folder": ""` is the main address (`https://mhhwilbrink.github.io/Kaart/`).

## Add a customer

1. The customer makes a copy of the template Sheet, runs **NFC card → 1. Install**, publishes, and sends you the web app address.
2. On github.com open `customers.json` → pencil (edit) and add an entry:
   ```json
   { "folder": "acme", "name": "Acme", "endpoint": "https://script.google.com/macros/s/…/exec", "defaultCardId": "card-001", "version": "latest" }
   ```
   (put a comma after the entry above it.) Click **Commit changes**.
3. After about a minute the pages are live. Send the customer their admin link `…/Kaart/acme/admin/` and the app link `…/Kaart/acme/app/`.

## Updates

- New pages: every customer with `"version": "latest"` gets them automatically.
- Hold a customer back: set `"version": "v2.17.0"` (any release tag).
- Server part (Apps Script): runs in the customer's own Google account, so their administrator installs it.
  The admin page shows a notice with the files and the steps as soon as a newer version is published.

Note: this repository is public. Use neutral folder names if customers should not be recognisable.
