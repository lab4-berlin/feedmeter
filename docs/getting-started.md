# Getting started with FeedMeter

Welcome! This guide gets you set up in about **5 minutes**. You don't need to know any code — just copy and paste once.

FeedMeter saves your feedings into **your own Google Sheet**. Nothing goes anywhere else: no signup, no app store, no monthly fee. The trade-off is that you have to do this small one-time setup yourself.

You'll need:

- A Google account (Gmail counts).
- A computer for the setup (a phone works too, but it's fiddlier).
- About 5 minutes.

## What you're about to do

1. Make a new Google Sheet — this is where your feedings will live.
2. Paste a small script into it — this is what lets the app talk to your sheet.
3. Publish it — this gives you a private link the app uses.
4. Set a passcode — so only you and your family can use it.
5. Open the app and connect it.

---

## 1. Make the sheet

1. Go to **[sheets.new](https://sheets.new)** in your browser. A blank spreadsheet appears.
2. Click the title (top-left, says *Untitled spreadsheet*) and rename it **FeedMeter**.

Leave the sheet itself empty — the app will fill it in.

## 2. Paste the script

1. In the spreadsheet, click **Extensions → Apps Script** in the menu bar. A new tab opens with a code editor.
2. You'll see some sample code (`function myFunction() { … }`). **Select all of it and delete it.**
3. Open this file in a new tab: **[apps-script.gs](../apps-script.gs)**. Click the **Raw** button (top-right of the file view), then select all (⌘A / Ctrl+A) and copy (⌘C / Ctrl+C).
4. Paste it into the empty Apps Script editor.
5. Press **⌘S** (Mac) or **Ctrl+S** (Windows) to save. If asked, name the project **FeedMeter**.

## 3. Publish it

This step gives you a private URL the app will use.

1. Click **Deploy → New deployment** (top-right of the Apps Script editor).
2. Click the gear icon ⚙️ next to **Select type** → choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Google will ask you to authorize the script. Don't be alarmed by the scary "unsafe" warning — it shows up because *you* are the developer of this script and Google hasn't reviewed it. Click:
   - **Authorize access** → pick your Google account.
   - **Advanced** → **Go to FeedMeter (unsafe)** → **Allow**.
6. Copy the **Web app URL**. It ends in `/exec` and looks like `https://script.google.com/macros/s/AKfycbz…/exec`.

**Keep this URL handy** — you'll paste it into the app in step 5.

## 4. Set your passcode

The passcode is the password your family will share to use the app.

1. Back in the Apps Script editor, find the dropdown next to the **Run** ▶️ button (it might say *Select function*). Pick **`init`** and click **Run**. Authorize again if prompted.
2. Switch back to your spreadsheet (the browser tab with the green grid icon). You'll now see two new tabs at the bottom: **`entries`** and **`settings`**.
3. Click the **`settings`** tab.
4. Find the row that says **`passcode`** and change `changeme` to a passphrase only your family knows. Something like `little-mango-2024`.

While you're there, you can also:

- Change `feedingIntervalMin` (default `180`) — minutes between feedings, used for the *next feeding due* countdown.
- Add more `user` rows for each family member who'll log feedings.

## 5. Open the app and connect it

1. Open FeedMeter on your phone or computer.
2. On first launch you'll see a setup screen. Paste:
   - The **URL** you copied in step 3.
   - The **passcode** you set in step 4.
3. Pick your name from the list, or tap **+ Add new** to add yourself.

You're done. Tap **Left**, **Right**, **Bottle**, or **Pump** the next time you feed.

> Want a quick tour of what's where? See [What FeedMeter does](./what-feedmeter-does.md).

---

## Inviting family

Anyone with the **URL** and **passcode** can use the app from their own phone. Send them both, plus a link to the app, and they'll go through step 5 above on their own device.

> Tip: on a phone, after opening the app in Safari (iOS) or Chrome (Android), tap **Share → Add to Home Screen** so it behaves like a real app.

## Common questions

**Is my data private?** Yes. The sheet lives in your Google account. Only people who know both the URL *and* the passcode can read or write it.

**Where can I see my data?** Just open the spreadsheet. Every feeding is a row in the **`entries`** tab.

**I want to change the passcode.** Open the `settings` tab in your sheet and edit the `passcode` cell. Family members will need to re-enter the new passcode in the app once.

**Something isn't working.** See the [troubleshooting section in SETUP.md](../dev-docs/SETUP.md#troubleshooting) for the most common issues.
