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

## Savings

The **Savings** tab holds your savings funds, like an emergency fund, travel or stocks. Each fund has one balance, an optional goal, and either or both of these monthly amounts:

- **🔁 Automatic (fixed):** a transfer that happens on its own, e.g. $300 a month into stocks. It's added to the balance on the 1st of each month, starting the month after you set it. It doesn't change Left to spend, because your budget is already after it.
- **🎯 From leftovers (flexible):** a target you aim to save at the end of the month, e.g. another $200 into stocks. It's set aside from **Left to spend** on Home. The small line under the big number shows what's actually left before savings.

How it works:
- **One fund per name.** A fund like "Stocks" can have both amounts, e.g. $300 automatic plus $200 from leftovers, so everything goes into one shared balance. Two funds can't have the same name. Funds with the same name from an earlier version were merged automatically.
- **Closing out a month:** when a new month starts, the app asks how much of last month's leftovers you moved into each fund that has a leftover target, pre-filled with each target. Whatever you don't move rolls into the new month. Tap **Later** to skip for now; a banner on Home stays until you close it out.
- **Goals:** each fund shows months to its goal on your plan (automatic + target) and at your actual pace (automatic + your average leftover deposits over the last 12 months). A month you saved nothing counts toward that average.
- **Editing a balance:** change a fund's balance to record a withdrawal (e.g. you spent part of your travel fund) or a correction. This doesn't affect your budget or your saving pace.
- **☆ Show on Home:** tap the star on a fund to list it on the Home screen. Tap it again to hide it.

Fund balances are kept indefinitely. Only their month-by-month history is trimmed to the last 12 months.

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
