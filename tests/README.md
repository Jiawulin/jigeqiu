# Test Selection

Run the smallest set that covers a change. A conversation ending is not a release
checkpoint. Report what actually ran and any untested risks.

## Targeted Commands

```sh
npm run test:unit -- --list
npm run test:unit -- desktop-keyboard
npm run test:unit -- prototype-json json-asset-transfer-ui
npm run test:unit -- tests/unit/workbench-backup.test.ts --dry-run

npm run test:browser -- --list
npm run test:browser -- transfer-formats --dry-run
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser -- transfer-formats
```

Selections are explicit, validated in full before execution, and deduplicated.
Unit names, `name.test.ts`, and `tests/unit/name.test.ts` are accepted.
Browser names correspond to existing `test:browser:<name>` scripts. The browser
runner executes them sequentially, preserving required builds (for example,
`static-first-use`), reports elapsed time, and stops on the first failure.
No names or unknown names fail instead of running everything.

Provide the existing Playwright module and Chromium; the runner does not install
dependencies or read personal browser profiles. Group related browser suites in
one command to reduce authorization requests without broadening permissions.

## Ownership

| Change | Focused checks |
| --- | --- |
| Transfer labels, format controls, help, preview discard | `data-transfer-components-i18n`, `json-asset-transfer-ui`; browser `transfer-formats` |
| Asset JSON parser/merge/deduplication | `prototype-json`, `json-import-service`; browser `json-assets` |
| Full backup, restore, journal, references | `workbench-backup`, `formal-storage-safety`; browser `workbench-backup` |
| Desktop keyboard | `desktop-keyboard`; browser `desktop-keyboard` |
| Launchpad drag/inertia | `launchpad-gestures`; browser `launchpad-inertia` or `launchpad-scroll-ownership`, according to the changed behavior |
| Shared keyboard/navigation/onboarding anchors | Add the affected navigation or onboarding suite, not every browser suite |
| JavaScript test infrastructure | The affected `tests/tooling/*.test.mjs` files and ESLint on edited JavaScript |
| Source TypeScript/TSX | Also run `npm run typecheck` |

Examples are starting points, not an automatic dependency graph. Include callers
when changing a shared contract. A label-only fix does not require every storage
round trip; a storage change must not rely on a label or screenshot test.

`transfer-formats` owns bookmark-panel layouts and help/format interaction.
`workbench-backup` owns restore-preview layouts, replacement, wrong-file guidance,
locks, rollback and recovery. Its duplicate empty bookmark-panel layout pass was
removed; the populated restore preview remains covered.
`json-assets` owns asset-only round trips, ignored workbench fields and deduplication.
Parser unit tests and browser round trips are complementary, not interchangeable.

## Layout Modes

The following modes apply to `transfer-formats`, `workbench-backup`, and screenshot
capture in `json-assets`; other browser suites retain their current behavior.

```sh
# Four representative layouts, no screenshots (default)
npm run test:browser -- transfer-formats

# Same assertions and layouts, with screenshots for visual inspection
npm run test:browser -- transfer-formats --screenshots

# Full 2 languages x 2 themes x 3 widths, with screenshots
npm run test:browser -- transfer-formats workbench-backup --matrix
```

Prefix browser commands with `PLAYWRIGHT_MODULE=...` where needed.
The four cases cover Chinese/English, light/dark, and 1440/390/320px, not every
combination. Use `--matrix` for shared layout/theme/language changes or release
visual acceptance. Data-safety and functional scenarios run in both modes.
Individual scripts accept `TEST_MATRIX=1` and `TEST_SCREENSHOTS=1`.
Without capture enabled, existing screenshots are left untouched and are not new
verification evidence. Results print the actual layout count and capture mode.

## Full Gates and Historical Coverage

Keep `npm run check` unchanged for delivery checkpoints, submissions, shared
infrastructure changes or an explicit full-check request. CI still runs that gate.
It does not include browser suites. `npm test` still runs all top-level unit files;
appending a filename to it does not narrow the glob. Use `test:unit` instead.

Do not delete quota, conflict, missing-lock, rollback, stale-preview or reference
tests just to shorten execution. Remove an obsolete assertion only after confirming
the product contract changed; remove duplicates only when the owner test is named.
Legacy collection storage still needs compatibility tests even though collection
management is not an active product feature. The old `collections` browser workflow
is not a default bookmark regression. `test:legacy` remains separately opt-in.

No claim of all-suite deduplication, real Safari/iPad acceptance, or broad performance
benchmarking is implied by this focused optimization.
