# Insta Tracker

Compare your own Instagram followers and following using files you download from Instagram. Imports, history, and analysis run in your browser. This release does not log into Instagram, scrape profiles, call private APIs, upload relationship data, or fetch remote avatars.

## Run locally

Use Node.js 24 and npm. No API keys or environment files are required.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. For a production build and local preview:

```sh
npm test
npm run build
npm run preview
```

The preview uses `http://127.0.0.1:4173`. `dist/` is a static website that needs HTTPS when hosted; localhost is also supported. `npm run build` includes TypeScript checking. GitHub Actions runs the tests/build and retains the static build as an artifact. Pushing to GitHub does not deploy the existing Cloud Run app.

## Container deployment

The Dockerfile builds the site and serves it with unprivileged nginx on port 8080. Base images are pinned by digest. Build for Cloud Run’s Linux amd64 platform:

```sh
docker build --platform=linux/amd64 -t instagram-check:local .
docker run --rm --network=none instagram-check:local nginx -t
docker run --rm -p 127.0.0.1:8080:8080 instagram-check:local
```

The build context is an explicit source-file allowlist in `.dockerignore`. Add new source paths there when needed. No API key, mounted source directory, or server database is needed. The document is revalidated; hashed assets use immutable caching; missing paths return 404.

An AI Studio-managed Cloud Run deployment may include proxy-specific configuration. Before taking over deployment, review a new revision’s complete configuration, preserve service access settings and the existing origin, and keep the prior revision for rollback. Start with a zero-traffic preview revision and validate it before a traffic cutover. Future AI Studio publishing can conflict with an externally managed release. Do not delete the previous deployment’s mounted resources during migration.

`.dockerignore` limits Docker’s context, not a Cloud Build source upload. If using `gcloud --source`, separately restrict its upload with a reviewed `.gcloudignore` or a source-only staging directory. Export browser history before a production update; server rollback does not reverse a browser database upgrade.

## Import your account

1. Follow [Instagram’s official export instructions](https://help.instagram.com/181231772500920/). Choose your own profile, export to your device, select **Followers and following**, **All time**, and **JSON**. Menu names may vary.
2. Import the downloaded ZIP, or select all relationship JSON/CSV files together. ZIP processing reads only `followers[_N].json/csv` and `following[_N].json/csv`; unrelated categories are ignored.
3. Review the counts and warnings, enter your account username, and optionally provide the export date/time. Otherwise charts use the import time.
4. Confirm completeness only when every part of each supplied list is present. Click **Save snapshot**. Selecting files never saves automatically.
5. Import a later export for the same account and compare it with an earlier snapshot.

Official JSON array and wrapped relationship formats are supported. Simple JSON with `followers` / `following` arrays and CSV with a username column are also accepted. CSV can include string IDs and `list_type`; otherwise use a relationship filename. CSV parsing supports quoted commas and newlines. Do not combine separate exports into one snapshot.

Imports are bounded to 50 MiB per batch, 20 MiB per selected relationship file, 50 MiB total selected uncompressed content, 100 relationship files, 2,000 ZIP entries, and 100,000 entries per list. Encrypted or unsupported ZIP methods, malformed records, overlapping sources, path traversal, and missing numbered parts are rejected. An omitted final numbered part cannot be detected automatically; your completeness review matters.

## Read comparisons carefully

- A supplied empty list differs from a missing list. Unconfirmed or missing lists leave dependent comparisons unavailable.
- Change reports require an earlier snapshot from the same identified account. Older snapshots without an account must be assigned explicitly in Settings.
- Numeric source IDs support verified username changes. Official exports often provide usernames only: matching these is probable, and renamed or reused usernames cannot always be resolved. Conflicting identities suppress affected comparisons.
- Newly/no-longer-listed accounts are differences between exports, not proof of who performed a follow/unfollow action. Export timing and source accuracy can affect results.
- Trends use the selected account and leave gaps where data is unavailable.

The export workflow avoids automated Instagram collection. It is not a guarantee against account restrictions unrelated to this app. See [Instagram’s Terms](https://help.instagram.com/581066165581870/) and [scraping guidance](https://help.instagram.com/740480200552298/).

## Preserve your history

Use **Settings → Export backup** regularly and before moving browsers, changing the app address, or updating a deployment. IndexedDB belongs to the exact browser profile and origin; local preview and the live app have separate histories. Browser clearing/eviction can remove local data. Backups contain relationship information: keep them private.

Restore accepts versioned backups and the earlier `{ snapshots, users }` format, validates before showing a replacement confirmation, and writes both stores atomically. Invalid files or failed transactions preserve the previous database. Backups are limited to 50 MiB, 2,000 snapshots, 200,000 user records, and 2,000,000 relationship references. Saves enforce these limits so the resulting history remains exportable. Export and archive history before reaching the limits.

The v5 database upgrade repairs supported earlier username-based layouts and preserves legacy SHA-256 IDs. Unsupported or inconsistent records abort the upgrade without clearing data. Empty legacy lists without source metadata remain unproven. Existing account assignments are never guessed.

## Verification and release scope

The synthetic regression suite covers ZIP safety, import formats, ID matching, incomplete snapshots, legacy migration, atomic rollback, backup limits, CSV escaping, and import/restore UI flows. It does not certify every possible Instagram archive or every existing user database. Validate a representative fresh export and a backup copy before a production cutover.

The source started as a Google AI Studio export. React, styles, parsers, and charts are now bundled locally; the Gemini key setup, CDN scripts, remote avatar calls, and Google Drive sync are not part of this release. No personal exports or credentials belong in Git. The original exported source remains in repository history for review and rollback; after opening a v5 database, use a backup-aware rollback rather than serving an older database schema blindly.
