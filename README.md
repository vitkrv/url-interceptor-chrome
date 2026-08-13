
# URL Interceptor & Redirector (MV3)

A Chrome extension that intercepts and redirects URLs using user-defined rules. Supports:
- **Exact**, **Wildcard (*)**, and **Contain** modes
- Per-rule enable/disable
- Global enable/disable
- Independent User-Agent override with attach or replace modes
- Categories with filtered rule lists and drag-and-drop assignment
- Import/Export rules and categories as JSON
- Live **Logs** of applied rules via `declarativeNetRequest.onRuleMatchedDebug`
- Drag-and-drop reordering of rules
- Optional per-rule **Disable PW Bot Detection** page-variable override for redirected scripts



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
   - **Exact**: matches exactly the given full `http` or `https` URL.
   - **Wildcard**: use `*` to match any characters in the Source URL. Wildcard sources must start with `http://` or `https://`, for example `https://*.example.com/*`.
   - **Contain**: matches when the Source is a substring of the URL, for example `example.com/path`.
3. Optionally choose a **Category**.
4. Fill **Source** and **Destination** and **Save**.
5. Optionally enable **Disable PW Bot Detection** to make page reads of `window._pwBotScore` return `99` after the rule redirects a request.

### Categories
- **Uncategorized** always appears first and contains rules without a category.
- Category rows show total rules and enabled rules.
- Select a category to filter the rules list.
- Drag a rule to a category in the sidebar to assign or reassign it.
- Use **Settings** on a selected category to rename or remove it. Removing a category asks whether assigned rules should be deleted or moved to Uncategorized.

### Edit / Delete
- **Edit** opens a pre-filled modal.
- **Delete** asks for confirmation.
- Toggle a rule with the switch on each row.
- Drag and drop to reorder rules.

### Global Toggle
- Use the **Global redirects** switch on the top right to enable/disable redirect rules without deleting them.
- This switch does not control the User-Agent override.

### User-Agent Override
- Use **Customize UA** to choose an override type:
  - **Attach** appends the configured value to the existing User-Agent.
  - **Replace** sets the full User-Agent to the configured value.
- The default customization is **Attach** with `Playwire/2.0`.
- Use the UA switch beside **Customize UA** to enable or disable this feature independently from redirects.
- User-Agent values must be non-empty printable ASCII text and cannot contain tabs, newlines, or other control characters.

### Import/Export
- **Export** downloads `rules-export.json` with `{ categories, rules }`.
- **Import** accepts the exported object format, or the legacy array of rules with fields: `name`, `mode`, `source`, `destination`, `enabled`. Imported rules and categories get new IDs.

### Logs
- Click **Logs** to see entries in the format:
  ```
  [time] on page [page_url] rule [rule_name] applied
  ```
- Only active rules generate logs.
- User-Agent override enable, disable, and configuration changes are logged once per change.
- Click **Clear** to wipe logs.

## Permissions
- `declarativeNetRequest` and `declarativeNetRequestFeedback` (for logging)
- `declarativeNetRequest` is also used to modify the User-Agent request header when the override is enabled
- `scripting` for the optional page-variable override when **Disable PW Bot Detection** is enabled
- `storage`
- `host_permissions: <all_urls>` to allow redirection from any site

## Technical Notes
- Interception uses **dynamic DNR rules** via `updateDynamicRules`.
- The User-Agent override uses a reserved dynamic DNR rule ID separate from redirect rule IDs.
- **Exact** → `regexFilter: ^...$` (escaped)
- **Contain** → `urlFilter`
- **Wildcard** → `regexFilter` with `*` translated to `.*`
- We keep a stable mapping of your rule IDs to DNR numeric IDs.
- Log buffer capped at 1000 entries. Logged request URLs are stored without query strings or fragments.

## Angular UI?
This admin UI is implemented without a framework to remain zero-dependency and CSP-safe out of the box. If you **strictly require Angular + Angular Material** styling, say the word—I can provide a companion Angular source folder mirroring this UI (along with built assets) in an updated archive. Functionality will remain the same.
