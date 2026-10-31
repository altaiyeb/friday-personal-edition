# FRIDAY Personal Edition

A privacy-first, offline-capable personal assistant and life-management dashboard.

## Features
- Local PIN gate and IndexedDB storage
- Tasks, notes, and pet profile placeholders for Lumi and Enzo
- BDT income/expense ledger and monthly category budgets
- Simple deterministic offline command parser
- Encrypted JSON backup/restore and CSV transaction export
- Installable PWA with service-worker caching

## Deploy with GitHub Pages
1. Upload the project files to the root of `altaiyeb/friday-personal-edition`.
2. Commit the files to the `main` branch.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions**.
5. Open the **Actions** tab and wait for the Pages deployment workflow to finish.
6. Your site URL will appear under **Settings → Pages**.

## Install on Android
Open the deployed HTTPS site in Chrome, open the browser menu, and choose **Add to Home screen** or **Install app**.

## Privacy and limitations
All app records are stored in this browser on this device. There is no cloud sync or remote AI. Clearing browser data can erase records; export encrypted backups regularly. The PIN gate is an application-level browser lock, not a replacement for Android device security. Keep your backup passphrase safe. Use HTTPS for Web Crypto and service-worker support.

## Development
This is an initial MVP. Recurring reminders, calendar sync, accounts, savings goals, schema migrations, and automated tests are not yet implemented. The UI is mobile-first and can be expanded incrementally.
