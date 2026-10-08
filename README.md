# Budget

A simple monthly expense tracker that installs on iPhone and Android as a home-screen app.
Your data never leaves the phone: no account, no server, and it costs nothing.

## Publish it (one time, free) with GitHub Pages

1. Sign in at https://github.com and click **New repository**. Name it `budget`, make it **Public**, and click **Create repository**.
2. On the new repo page, click **uploading an existing file**. Drag in everything inside this `budget-app` folder (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, and the `icons` folder). Then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, set Branch to **main** and folder to **/ (root)**, then click **Save**.
4. After about a minute your app will be live at `https://<your-username>.github.io/budget/`.

The repo is public, but it holds only the app's code. Your expenses stay on your phone.

## Install it on your phone

- **iPhone:** Open the URL in **Safari**, tap the **Share** button, then **Add to Home Screen**.
- **Android:** Open the URL in **Chrome**, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

Always open the app from its home-screen icon. On iPhone, the icon and Safari keep separate data.

## Good to know

- Data lives in the app's local storage on each phone. Two phones won't sync with each other.
- Deleting the home-screen app, or clearing website data in your browser settings, erases your expenses.
- Data older than 12 months is deleted automatically. The money it rolled over is still counted.
- Works offline once installed.

## Updating the app later

Upload the changed files to the repo again. Also change `CACHE = 'budget-v1'` in `sw.js` to a new value (for example `budget-v2`) so phones download the new version. The update shows up the second time you open the app.

## Run locally

```bash
python3 -m http.server 8765 --directory budget-app
```

Then open http://localhost:8765.
