# Browser workspace

Open **Browser** or the **+** in the tab strip to create an isolated Chromium page on the terminal host. Enter a web address, search phrase, or localhost URL. Browser navigation, clicking, typing, and scrolling happen in that real page, independent of iframe policies.

Each tab has its own cookie context. These are workspace browser tabs, not an attachment to an existing Safari or Chrome profile. Browser audio, file upload/download dialogs, extensions and password-manager integration are not provided by the image-based viewer.

## Layouts

- **Desktop:** persistent sidebar, browser tabs in the sidebar, terminal and browser split horizontally when a browser is open. The separator is draggable left and right; the terminal keeps at least 320px and the browser at least 420px.
- **Tablet:** labeled rail, browser tabs in a strip above the address bar, terminal and browser stacked vertically when a browser is open. The separator is draggable up and down between a 25% and 75% browser share.
- **Phone:** bottom navigation with Terminal, Browser, Agent, and Tools. One task surface is visible at a time. The key bar collapses to one row; the chevron reveals the remaining keys. Browser tabs and sharing controls live in the browser surface. The browser and terminal chrome is tightly padded, and after seven seconds without a touch it collapses to the content; the bottom navigation stays and the next touch wakes the chrome.

## Sharing

Human tabs start Private. On a phone or tablet, select **Share** to open the sharing row. On desktop, the sharing row is always visible. Select View only or Allow control, then Copy connection. Paste the connection JSON into your terminal agent. Changing permission rotates the token; choosing Private immediately rejects subsequent token requests. Commands already executing can finish. Closing a tab destroys its context.

The supplied endpoint accepts a Bearer token in the Authorization header:

- GET /content: current URL, title and visible text.
- GET /snapshot: current URL, title and JPEG image in base64.
- POST /action with JSON: navigate (url), back, forward, reload, click (x,y in the dimensions returned by /snapshot), type (text), key (Puppeteer key name), scroll (deltaY).

View tokens cannot invoke actions or change grants. Never paste the token into a visited web page.

Choose **Agent** to create a separate context with control granted. Hide view keeps the browser running headless. Reopen Agent to observe the same context. Revoking access also works on the agent context.

The viewer samples images once per second when open. This is remote interaction, not a native browser DOM exposed to the viewer's assistive technology. Agents can use /content for text. Keyboard Tab moves through the workspace interface; the Send field, Tab, and Enter buttons interact with page inputs.

Localhost means the terminal server host, not the phone or tablet. HTTP and HTTPS are supported; file URLs and embedded URL credentials are rejected.

## Runtime and trust

Puppeteer is a production dependency; `npm ci` downloads its compatible Chromium. `TERMINALONE_CHROME` can select an operator-installed compatible binary. Use the pinned runtime by default.

The existing loopback listener and request-origin checks protect workspace routes. User control keys stay in page memory and are never embedded in page URLs. API responses use no-store. At most eight contexts can remain open.

Grants protect cooperative API clients, not hostile processes that already have unrestricted access to the host shell or browser owner's application. The local server has the user's existing authority. Keep remote access behind the existing authenticated proxy.

Browser sessions and grants are in memory. Restarting the server closes them; saved browser profiles and seamless session persistence are not implemented.

## Validation

`npm run test:workspace` starts the workspace and its own local preview site, then exercises terminal input, tabs, sharing, revocation, the agent browser, hidden-agent navigation, reduced motion, and the phone, tablet, and desktop layouts. It captures evidence at 393×852, 820×1180, 1440×900, and 1920×1080.

[DESIGN.md](../DESIGN.md) lists the four named motions and the device-specific structures.
