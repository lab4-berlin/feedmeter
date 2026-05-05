# FeedMeter — Backend Setup (5 minutes)

The app stores data in your own Google Sheet, accessed through a tiny Google Apps Script that you deploy as a public Web App. The Web App is gated by a passcode you set yourself. There is no other server to manage and everything stays inside your Google account.

## Step 1 — Create the sheet

1. Go to https://sheets.new and create a blank spreadsheet.
2. Name it something like **FeedMeter**.

You can leave it empty — the script will create the `entries` and `settings` tabs the first time it runs.

## Step 2 — Add the Apps Script

1. In the spreadsheet menu, click **Extensions → Apps Script**.
2. Delete whatever is in the editor (`function myFunction() { ... }`).
3. Open `apps-script.gs` from this repository, copy its **entire contents**, and paste into the Apps Script editor.
4. Click the **floppy-disk Save** icon (or `Cmd/Ctrl + S`). Give the project a name (e.g. *FeedMeter API*).

## Step 3 — Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to **Select type** → choose **Web app**.
3. Fill in:
   - **Description**: `FeedMeter API v1`
   - **Execute as**: **Me** (your Google account)
   - **Who has access**: **Anyone**
4. Click **Deploy**.
5. Google will ask you to authorize the script. Click **Authorize access**, pick your account, click **Advanced → Go to FeedMeter API (unsafe)**, then **Allow**. (It's safe — *you* are the developer; the warning shows because it's not a verified Google app.)
6. Copy the **Web app URL** that ends in `/exec`. It looks like:

   ```
   https://script.google.com/macros/s/AKfycbz.../exec
   ```

   Keep this URL — you'll paste it into the FeedMeter app on first launch.

> Whenever you change the script later, you'll need to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so your edits go live. Re-using the same deployment keeps the URL stable.

## Step 4 — Set your passcode

1. Run the script once to seed defaults: in the Apps Script editor, with `doGet` visible, change the function dropdown to **`ensureInit_`** and click **Run**. Authorize again if prompted. (You can also just open the app in your browser; the first request will seed the sheet.)
2. Switch back to the spreadsheet. You'll now see two tabs: **`entries`** and **`settings`**.
3. In the **`settings`** tab, change the value of the `passcode` row from `changeme` to whatever you want (e.g. a memorable phrase). Use something only your trusted users know — anyone with this passcode and the URL can read/write your data.

While you're there you can also tweak:

| key | default | what it means |
|-----|---------|---------------|
| `passcode` | `changeme` | shared family passcode |
| `feedingIntervalMin` | `180` | minutes between feedings (used for the "next feeding due" countdown) |
| `pumpIntervalMin` | `240` | minutes between pumping sessions |
| `user` (rows) | `Mama`, `Papa` | the predefined people who can log entries — add as many `user` rows as you like |

You can edit these in the sheet at any time, or from the in-app settings panel later.

## Step 5 — Open the app

1. Open the FeedMeter web page on your phone or computer.
2. On first launch you'll see a setup screen:
   - Paste the **Web app URL** (ends in `/exec`).
   - Enter the **passcode**.
3. Pick your name from the list, or tap **+ Add new** to add yourself.

That's it. Every entry is stored in the `entries` tab in the sheet with: who logged it, when, and the feed details. You can open the sheet any time to chart, share, or export.

## Privacy & security notes

- The Apps Script runs as **you**. Only your Google account can see/modify the underlying sheet through the Sheets UI.
- The Web App URL is public, but every request must include the right passcode. If the passcode leaks, change it in the `settings` tab — old clients will need to re-enter it.
- HTTPS only. Google handles TLS.
- Data never touches a third party — it goes from your phone to Google directly.

## Troubleshooting

- **"Invalid passcode"**: re-check the passcode value in the `settings` sheet (no extra spaces).
- **"Failed to fetch" / network error**: double-check the URL ends in `/exec` and that the deployment is set to **Anyone** under "Who has access".
- **You changed the script and nothing happened**: you need a new version. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**.
- **You want to fully reset**: delete the rows in `entries` (keep the header row).
