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
