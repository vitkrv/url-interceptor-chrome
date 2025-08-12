
# URL Interceptor & Redirector (MV3)

A Chrome extension that intercepts and redirects URLs using user-defined rules. Supports:
- **Exact**, **Wildcard (*)**, and **Contain** modes
- Per-rule enable/disable
- Global enable/disable
- Import/Export rules as JSON
- Live **Logs** of applied rules via `declarativeNetRequest.onRuleMatchedDebug`



## Installation (Load Unpacked)
1. Download and unzip the archive.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.
5. Click the extension icon → **Options** to open the Admin panel.

The extension ships with **all assets locally**; no network/CDN required.

## Usage
### Create a Rule
1. Click **+ New Rule**.
2. Choose **Mode**:
   - **Exact**: matches exactly the given URL.
   - **Wildcard**: use `*` to match any characters in the Source URL.
   - **Contain**: matches when the Source is a substring of the URL.
3. Fill **Source** and **Destination** and **Save**.

### Edit / Delete
- **Edit** opens a pre-filled modal.
- **Delete** asks for confirmation.
- Toggle a rule with the switch on each row.

### Global Toggle
- Use the switch on the top right to enable/disable **all** interception without deleting rules.

### Import/Export
- **Export** downloads `rules-export.json` with your rules.
- **Import** selects a JSON file (array of rules with fields: `name`, `mode`, `source`, `destination`, `enabled`). Imported rules get new IDs.

### Logs
- Click **Logs** to see entries in the format:
  ```
  [time] on page [page_url] rule [rule_name] applied
  ```
- Only active rules generate logs.
- Click **Clear** to wipe logs.

## Permissions
- `declarativeNetRequest` and `declarativeNetRequestFeedback` (for logging)
- `storage`
- `host_permissions: <all_urls>` to allow redirection from any site

## Technical Notes
- Interception uses **dynamic DNR rules** via `updateDynamicRules`.
- **Exact** → `regexFilter: ^...$` (escaped)
- **Contain** → `urlFilter`
- **Wildcard** → `regexFilter` with `*` translated to `.*`
- We keep a stable mapping of your rule IDs to DNR numeric IDs.
- Log buffer capped at 1000 entries.

## Angular UI?
This admin UI is implemented without a framework to remain zero-dependency and CSP-safe out of the box. If you **strictly require Angular + Angular Material** styling, say the word—I can provide a companion Angular source folder mirroring this UI (along with built assets) in an updated archive. Functionality will remain the same.
