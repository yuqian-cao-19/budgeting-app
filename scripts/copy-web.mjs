// Copies the web app (which lives in the repo root so GitHub Pages can serve it) into www/,
// the folder Capacitor packs into the Android app. Run with: npm run build:web
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const WEB_FILES = ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icons', 'fonts', 'lib'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of WEB_FILES) cpSync(f, `www/${f}`, { recursive: true });
rmSync('www/icons/make_icons.py'); // a dev script, not part of the app
console.log(`Copied ${WEB_FILES.length} items into www/`);
