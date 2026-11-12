# JIGEQIU 记个球

**Turn your bookmarks into a personal workspace.**

JIGEQIU is a self-hostable bookmark manager that runs locally with a single command. Bring everyday browsing
together with desktop shortcuts, a launchpad, global search, and nested folders.
No account, application backend, database, or API key required. Use it as a
Chrome / Edge new tab extension or deploy the Web version on your own site.

[简体中文](README.md) | **English**

[Live Demo](https://jiawulin.github.io/) · [Quick Start](#quick-start) ·
[Usage](#usage) · [Self-Hosting](#self-hosting) · [MIT License](LICENSE)

![JIGEQIU desktop with website shortcuts and global search](.github/images/desktop-light.jpg)

## Features

| Capability | Details |
| --- | --- |
| Bookmark management | Nested folders, keywords, search, bulk moves, and a recycle bin |
| Desktop workspace | Independent shortcuts, desktop folders, pages, and taskbar pins |
| Launchpad | Browse all bookmarks with pinyin search and keyboard navigation |
| Global search | Find bookmarks, switch search engines, and run quick commands |
| Import and backup | Bookmark HTML/JSON exchange and asset backup with search engines, desktop folders, and taskbar pins |
| Personalization | Light and dark themes, glass surfaces, built-in and custom local wallpapers |
| Bilingual interface | Saved choice first; first use follows supported browser preferences (Chinese/English), otherwise Chinese; switch in the interface |
| Browser extension | Load the extracted ZIP locally and open a new tab; no server required |
| Static deployment | No application backend, database, or API key required in production |

## Screenshots

### App Drawer

Browse your entire library in the launchpad and find websites by title, keywords,
or pinyin.

![App drawer with all bookmarks and launchpad search](.github/images/launchpad.jpg)

### Search and Commands

Type `/` in global search to list quick commands and search engine shortcuts.

![Global search showing the slash-command list](.github/images/search-commands.jpg)

### Custom Search Engines

Click the engine icon on the left of the desktop search bar to open the picker.
Switch between general search, knowledge communities, video sites, and developer
tools. Use the add button to choose from the built-in catalog or define your own
engine name, command, and search URL.

![Desktop search engine picker with multiple providers, commands, and an add button](.github/images/search-engines.jpg)

### Bookmark Library

Organize websites into folders and search, edit, or move bookmarks in one workspace.

![Bookmark library with folder navigation and management actions](.github/images/bookmark-library.jpg)

### Dark Desktop

Switch appearance while keeping the same bookmarks and desktop layout.

![JIGEQIU desktop in dark mode](.github/images/desktop-dark.jpg)

Screenshots use demonstration bookmarks, not personal browser data.

## Try It Online

Visit the **[demo entry page](https://jiawulin.github.io/)** and select JIGEQIU to open the demo.

Both the demo and self-hosted deployments keep bookmarks in each visitor's
browser. Different domains, ports, and browser profiles have separate data.
Use export and import to move your bookmarks between them.

## Quick Start

### Choose Your Download

Open **Assets** in [Releases](https://github.com/jiawulin/jigeqiu/releases).
Replace `X.Y.Z` below with your chosen release version. Usually you need only one ZIP.

| Goal | Download | Next step |
| --- | --- | --- |
| Use JIGEQIU as your Chrome / Edge new tab | `jigeqiu-extension-X.Y.Z.zip` | [Install the extension](#install-the-extension-no-build-required) |
| Host it on your domain, server, or static hosting | `jigeqiu-vX.Y.Z-web.zip` | [Deploy the Web package](#deploy-the-web-package-no-build-required) |
| Develop, modify, or build the application | Clone the repository or download Source code | [Run from source](#run-from-source-for-development) |
| Check download integrity | `SHA256SUMS.txt` | [Verify downloads](#verify-downloads-optional) |

**The ZIPs are not interchangeable.** The Web package cannot be loaded as an
extension, and the extension does not need a website server.
GitHub's **Source code (zip / tar.gz)** archives are source files, not ready-to-use packages.

### Install the Extension (No Build Required)

For Chrome / Edge users who want a new tab workspace. No Node.js, commands,
or web server is required.

1. Download `jigeqiu-extension-X.Y.Z.zip` and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the folder directly containing
   **`manifest.json`**, not the ZIP or an outer folder without the manifest.
5. Open a new tab, confirm any browser prompt to keep the new tab change,
   and read the privacy notice on first launch.

This is not a double-click CRX installer or an extension-store installation.
Keep the extracted folder in place: the browser still needs its files.
Resolve any conflict with another extension replacing the new tab.
Local installation does not mean remote icons, external search, or websites work offline.

Website icons do not use third-party favicon aggregation services. Bookmark forms and Launchpad share discovery and validation. Failed automatic icons and manual refreshes try homepage declarations, manifests and common icon paths. CORS and extension site permissions still apply; image URLs can be entered manually. SVGs are displayed only as external images. Local icon caches can still be cleared in appearance settings.

#### Extension Updates and Data

1. Export an asset backup from **Manage → Import & export → Backup & restore** and keep it outside the browser.
2. Close open JIGEQIU extension pages and replace the files in the **original installation
   folder** with the complete new package, keeping its folder and extension identity unchanged.
3. Click **Reload** on the extensions page, open a new tab, and check your version and bookmarks.

**Do not uninstall before updating:** uninstalling can remove local data.
Asset backups cover bookmarks, search engines, desktop folders and taskbar pins, but exclude wallpaper, appearance, history, trash and icon caches.
Web, Chrome, and Edge data do not sync automatically. Export and import manually
to move assets between them; back up before upgrading or changing browsers.
See the [extension documentation](extension/README.md) for source builds, storage, and testing.

### Web Deployment Security

> **Public and LAN deployments must use HTTPS for protected save operations.**
> Adding/editing bookmarks, deleting them in Manage, and confirming HTML/JSON
> imports depend on Web Locks to coordinate writes across tabs and avoid
> overwriting changes. A plain HTTP domain or LAN IP may load the page, but these
> operations are explicitly rejected when Web Locks is unavailable; they do not
> proceed with only a risk warning.
> Local access through `http://localhost` or `http://127.0.0.1` is an exception and
> needs no local certificate. The browser must still support Web Locks and allow
> site storage.

### Run From Source (For Development)

Requirements: Node.js 24.x, npm 10.8.2 or later, and a modern browser with Web Locks support.

Clone this repository, or download and extract the source ZIP:

```sh
git clone https://github.com/jiawulin/jigeqiu.git
```

Enter the project folder, install dependencies, and start the app:

```sh
cd jigeqiu
npm install
npm run dev
```

For a ZIP download, replace the `cd` path with the extracted source folder.

Visit **[http://127.0.0.1:3000](http://127.0.0.1:3000)** in your browser.
No application backend or database is required; keep the server process running.

#### Optional Settings

Copy `.env.example` to `.env` to change the bind address (`HOST`) or port (`PORT`), or set `DISABLE_HMR=true`
to disable development hot reload and file watching. Shell variables take precedence.
No `.env` file is needed for the defaults; use the matching address if you change the port.
The server listens on `127.0.0.1` by default. For LAN access, set `HOST=0.0.0.0`,
use a trusted network, and access the site over HTTPS.

### Deploy the Web Package (No Build Required)

No Node.js installation or local build is required.

1. Download `jigeqiu-vX.Y.Z-web.zip` for your chosen release, not the extension or Source code archive.
2. Extract the ZIP contents into your Nginx web root. The root should directly contain `index.html`, `assets/`, and `wallpapers/`.
3. Configure the site, reload Nginx, and open its address in your browser.

Example for a local Nginx site (adjust `root` to your deployment path):

```nginx
server {
    listen 127.0.0.1:8080;
    server_name localhost;
    root /var/www/jigeqiu;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Validate and reload the configuration, then open **[http://127.0.0.1:8080](http://127.0.0.1:8080)**:

```sh
nginx -t
nginx -s reload
```

The HTTP configuration above is only for local loopback access. For a LAN IP or
public domain, configure HTTPS and redirect HTTP requests to HTTPS; otherwise,
save operations that depend on Web Locks will be rejected.
Use the `SHA256SUMS.txt` release attachment to verify the ZIP.
The app uses hash routing, so no additional SPA route rewrites are required.

Before updating, export an asset backup, then replace the full site files while
keeping the same domain, protocol, and port. Moving to another address does not
automatically transfer browser data; use export and import.
Do not double-click `index.html`; access the app through your static server's URL.

### Verify Downloads (Optional)

Place both ZIPs and `SHA256SUMS.txt` from the same release in one directory:

```sh
sha256sum --check SHA256SUMS.txt
# macOS
shasum -a 256 -c SHA256SUMS.txt
```

If you downloaded only one ZIP, this command reports the other as missing,
not that your downloaded file is corrupt. Alternatively, calculate that file's
SHA256 and compare it with the matching line in the checksum file.

## Usage

### Import Your Bookmarks

1. Export your browser bookmarks as an HTML file from its bookmark manager.
2. In JIGEQIU, open **Manage → Import & export → Bookmark transfer**, then select **Browser bookmarks · HTML** under **Import bookmarks**.
3. Select the file, review the import preview, and confirm.
4. Open **All Bookmarks** to browse and organize the imported folders and websites.

The importer primarily targets Chrome bookmark HTML. For files exported by other
browsers, review the preview before confirming. Previewing or canceling does not
write to your library, and importing does not automatically populate your desktop.

### Set Up Your Desktop

- Add bookmarks from the desktop, or pin existing bookmarks from the library or launchpad.
- Use library folders to organize assets and desktop folders to group shortcuts independently.
- Pin frequently used bookmarks to the taskbar, or access your entire library through the launchpad.
- Open **Manage → Appearance** to switch themes, select a wallpaper, or upload a local background.
- Choose from four built-in backgrounds, or keep multiple images in **My backgrounds**. New uploads never replace earlier images; select or delete each image individually.

Removing a desktop shortcut or unpinning a taskbar item does not delete the
bookmark. Deleted bookmarks go to the recycle bin; pin them again after restoring
if you want them back on your desktop.

### Search and Commands

Use global search to find bookmarks by title, domain, or keywords, or send your
query to the selected search engine. The launchpad also supports pinyin search.
Add engines from the built-in catalog or configure your own.
Type `/` in the search box to see the available commands.

| Command | Action |
| --- | --- |
| `/all` | Open all bookmarks |
| `/start` | Open the launchpad |
| `/add` | Add a bookmark |
| `/search` | Manage search engines |
| `/theme` | Open appearance settings |
| `/dark`, `/light` | Enable dark or light mode |
| `/trash` | Open the recycle bin |
| `/help` | Open the user guide |

The guide in the bottom-right corner provides keyboard shortcuts, search commands,
and instructions.

### Back Up and Migrate

Open **Manage → Import & Export**:

- **Bookmark transfer** imports/exports browser HTML and merges bookmark asset JSON without changing the workbench.
- **Backup & restore** exports bookmarks, library folders, legacy collections, search engines and default engine, desktop shortcuts/folders (including empty folders), and ordered taskbar pins.

Import is above export, with independent HTML/JSON format choices; both use expanded square single-select controls. Hover, focus, or tap the question
icons for format guidance: HTML exchanges browser bookmarks; JSON preserves JIGEQIU-specific bookmark
fields. Use Backup & restore to include the workbench.

Restore previews current and resulting counts. Bookmark assets must be replaced; search engines,
desktop and taskbar are optional. Retained layouts keep valid entries and list invalid entries before removal.
Existing trash is retained, and identity conflicts block restore. Full backups can also explicitly merge
only bookmark assets in Bookmark transfer. Both formats exclude trash, history, language, wallpaper,
appearance, icon caches and temporary windows. Icon configuration is retained, but remote images
are not downloaded or guaranteed to work offline.
JSON types are identified by content, not filenames. Bookmark JSON cannot restore a workbench;
the page directs you to Bookmark transfer. A full backup selected for bookmark import offers
Backup & restore or an explicit bookmark-only merge. Selecting a file never writes data.
Backup statistics distinguish bookmark folders from desktop folders and hide legacy collection
counts; compatible legacy data remains in backups.
Keep regular backups outside your browser, especially before clearing site data
or changing your deployment address.

## Self-Hosting

### Build

```sh
npm ci
npm run build
```

### Publish Static Files

Upload the **entire contents of `dist/`** to the root of an HTTPS website:

```text
site-root/
├── index.html
├── favicon.ico
├── assets/
└── wallpapers/
```

Use Nginx, Caddy, or an HTTPS-enabled static hosting provider.
Production serves static files only; no Express process, Node.js runtime,
or database server is needed.

Preview the production build locally:

```sh
npm run preview
```

Deployment requirements:

- Use HTTPS for public domains and LAN IPs; HTTP is supported on `localhost` and `127.0.0.1`. Protected writes require a secure context, Web Locks, and available browser storage.
- Default builds deploy at the site root; keep all asset directories. Opening files directly with `file://` is not supported.
- Pages use hash routes such as `/#/library`; application-level route rewrites are unnecessary.
- Use the development server for local development and a static file server for production.

HTTPS is a prerequisite for secure-context APIs outside trusted local origins,
not a guarantee of Web Locks support or permission to use browser storage.
Do not remove write-lock checks to work around deployment issues.
The lightweight onboarding cookie fallback only remembers welcome exposure;
it does not remove bookmark-save or import restrictions.

## Data and Privacy

The Web version keeps bookmarks and preferences in browser LocalStorage; the
extension uses its own `chrome.storage.local` without account sync.
Icon caches and custom wallpapers use IndexedDB. The website server distributes
application files, not your bookmark library. Web and extension origins and
different browser profiles keep separate data; installation or updates do not merge them.

On insecure HTTP origins, onboarding alone falls back to a lightweight cookie
lasting up to 400 days. It remembers welcome exposure, not bookmarks or full task
progress, and is sent with requests to the same host. Browser policies or clearing
data may remove it sooner. Related notices dismiss after about six seconds,
pause while hovered or focused, and do not repeat within the current page session.
This fallback does not bypass HTTPS/Web Locks requirements for protected writes.

Clearing site data, deleting a browser profile, or ending a private browsing
session can remove local data. Storage capacity depends on the browser and
device. The recycle bin is not a substitute for an independent backup.

Online fonts, website icons, and external websites you open can generate network
requests. Use trusted builds and a dedicated site origin. Never include private
URLs, personal bookmark backups, cookies, or credentials in public issues.

## Development and Contributions

Built with React, TypeScript, Vite, Tailwind CSS, Lucide, and Motion.
HTML parsing uses parse5; pinyin indexing uses pinyin-pro.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build static assets |
| `npm run build:extension` | Build the unpacked extension in `dist-extension/` |
| `npm run package:extension` | Build the extension ZIP and SHA256 manifest |
| `npm run preview` | Preview the production build |
| `npm test` | Run unit tests |
| `npm run test:unit -- <names>` | Run only the named unit test files |
| `npm run test:browser -- <suites>` | Run selected browser suites once each |
| `npm run typecheck` | Check TypeScript types |
| `npm run lint` | Lint JavaScript tooling and test runners |
| `npm run check` | Run tests, contract checks, lint, types, scoped formatting, and the build |

Browser regression tests require a separate Playwright and Chromium installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser:static-first-use
```

Issues and pull requests are welcome. Include reproduction steps, browser details,
and expected behavior in bug reports. Keep changes focused, add tests for behavior
changes, and run `npm run check` before submitting.
Use synthetic fixtures and isolated browser contexts for testing.

### Maintainer Releases

Commit and push application changes along with matching root versions in
`package.json` and `package-lock.json` to `master`. After checks pass, create
and push the matching `vX.Y.Z` tag on that commit. For example, after setting
the version to `0.1.4`:

```sh
git tag v0.1.4
git push origin v0.1.4
```

**Push only the tag; do not publish an empty Release first.** The release
workflow checks, builds both ZIPs and a combined checksum file, creates a draft,
uploads and downloads the assets for verification, then publishes automatically.
New releases include package-specific installation and update instructions.
You can add change notes after publication; existing Release descriptions are not overwritten.
Ordinary `master` pushes update the Pages demo and temporary extension Artifact,
not the formal Release.

## License

The source code is available under the [MIT License](LICENSE), allowing use,
modification, and redistribution with the required copyright and permission notices.

Third-party dependencies and assets retain their own licenses.
See the [background credits](public/wallpapers/CREDITS.md) for built-in image sources.
