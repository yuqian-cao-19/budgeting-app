# Budget

A simple monthly expense tracker that installs on iPhone and Android as a home-screen app.
Your data never leaves the phone: no account, no server, and it costs nothing.

App is live at `https://yuqian-cao-19.github.io/budgeting-app/`.

The repo is public, but it holds only the app's code. Your expenses stay on your phone.

## Install it on your phone

- **iPhone:** Open the URL in **Safari**, tap the **Share** button, then **Add to Home Screen**.
- **Android:** Open the URL in **Chrome**, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

Always open the app from its home-screen icon. On iPhone, the icon and Safari keep separate data.

## Import from Chase

1. On chase.com, open your card's activity, choose **Download account activity**, and pick the **CSV** file type. Pick any date range; overlapping ranges are fine.
2. In the app, go to **Settings → Import from Chase** and select the file.
3. Review the list. Each charge gets a suggested category, which you can change. You can also mark a charge **Split ½**, or uncheck charges you don't want.

How the import handles charges:

- Nothing is hidden. Skipped charges are listed in a collapsed **Skipped** section at the bottom, each with the reason it was skipped:
  - **Already imported** or **Before your history starts:** shown greyed out. They can't be added, because that would double-count them or put them outside the months the app tracks.
  - **You unchecked this in an earlier import** or **Payment or deposit:** tick it (and pick a category) to add it anyway. A payment or deposit is added as a refund.
- Importing the same dates twice is safe, because already-imported charges never come in again.
- Returns are added as refunds, which reduce your spending.
- Charges that match an expense you entered by hand (same amount, within 2 days) are flagged and left unchecked, so they aren't counted twice.
- "Bills & Utilities" charges are left unchecked, because your fixed bills already count them.
- The app remembers the category you pick for each merchant and uses it next time.

The file is read on your phone and never uploaded anywhere.

## Shared Google Sheet

**Settings → Shared Google Sheet** adds your share of charges your partner paid for. You review every row before it's added, on the same screen as the Chase import.

1. Paste the sheet's link. If the sheet has several tabs, copy the link while the right tab is open.
2. Tap **Sync from sheet** and sign in with Google. The app only asks for read-only access.
3. The first time, pick who you are (**Rain** or **Will**). The app uses your share column. You can change it later in Settings.

Which rows come in:

- **Your partner paid and your share is more than $0:** listed for review, using your share as the amount. Split rows show "Split · you pay $25.00 of $50.00". Untick it to count the full amount instead.
- **You paid:** goes to **Skipped**, because it should already be in Chase or your own entries. You can tick it to add it anyway.
- **Your share is $0** (e.g. "No - Will pay full" when you're Rain), already imported, or before your history starts: shown greyed out under **Skipped**.
- **Square?** and **Date Cleared** are ignored. Paying each other back doesn't change what you spent.

About dates:

- You can change each row's date on the review screen. Use this to move a lump sum like "Restaurant $300" into the month it belongs to.
- If a row's date is later changed in the sheet, it's flagged "Already imported from the sheet with a different date" and left unchecked, so it isn't counted twice.
- Rows with no date are flagged so you can set one.

The sheet is read straight from your phone. Your sheet data is never cached or sent anywhere else.

### One-time Google setup (about 15 minutes, free)

Both phones use the same Client ID. Each of you signs in with your own Google account.

1. Go to https://console.cloud.google.com and sign in. Create a new project, named for example `Budget app`.
2. Search for **Google Sheets API** in the search bar at the top, open it, and click **Enable**.
3. Open **Google Auth Platform** (in some versions of the console it's called **OAuth consent screen**) and click **Get started**:
   - App name: `Budget`. User support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree to the policy and click **Create**.
4. Under **Audience**, find **Test users** and add **both** your Gmail address and your partner's.
5. Under **Clients**, click **Create client**:
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add these two:
     - `https://yuqian-cao-19.github.io`
     - `http://localhost:8765`
   - Click **Create** and copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
6. Paste the Client ID into `app.js` near the top (`const GOOGLE_CLIENT_ID = '...'`), bump `CACHE` in `sw.js`, and upload both files to GitHub.

The first time you sign in, Google shows a **"Google hasn't verified this app"** warning. That's expected for a personal app in testing mode. Tap **Continue**. You may need to sign in again about once an hour when you sync.

## Good to know

- Data lives in the app's local storage on each phone. Two phones won't sync with each other.
- Deleting the home-screen app, or clearing website data in your browser settings, erases your expenses.
- Data older than 12 months is deleted automatically. The money it rolled over is still counted.
- Works offline once installed.

## Updating the app later

Upload the changed files to the repo again. Also bump the `CACHE` value in `sw.js` (for example `budget-v2` → `budget-v3`) so phones download the new version. The update shows up the second time you open the app.

## Run locally

```bash
python3 -m http.server 8765 --directory ~/Documents/budget-app
```

Then open http://localhost:8765. Offline caching is turned off on localhost, so you always see your latest edits.
