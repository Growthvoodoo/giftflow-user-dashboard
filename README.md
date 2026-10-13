# GiftFlow Dashboard

The staff print station for GiftFlow. Warehouse staff log in, see the gift
cards waiting, preview each one and print a single card or the whole day's
batch — without access to the Shopify admin.

It is a small Node server plus one page. It holds no order data itself: every
request goes to the GiftFlow app's staff API, using a key only this server
knows. The browser never sees the key.

## What staff can do

- See cards **To print**, **Needs approval**, **On hold**, **Printed**, **Packed** or **All**, with counts
- Search by order number, customer, recipient or message
- Preview a card at its real proportions, with the message and who it's from
- **Print** one card, a selection, or **Print all** — a print-ready PDF opens in a
  preview with Print and Download buttons, and cards can be marked printed automatically
- Mark cards printed or packed, or send them back to "To print"
- Approve or reject customer-uploaded images
- Get a notice when new cards come in while the page is open (refreshes every minute)

## Setup

Needs Node 20 or newer, and a running GiftFlow app.

```bash
npm install
cp .env.example .env
```

1. In the GiftFlow app in Shopify admin: **Settings → Staff print dashboard → Create key**.
2. In `.env` set `GIFTFLOW_URL` (the GiftFlow app's URL — its `SHOPIFY_APP_URL`),
   `GIFTFLOW_API_KEY` (the key) and `SESSION_SECRET` (`openssl rand -hex 32`).
3. Add a login for each person:

   ```bash
   npm run user:add -- anna "Anna"
   ```

4. Check everything is connected, then start it:

   ```bash
   npm run check
   npm start            # http://localhost:4000
   ```

Manage users with `npm run user:list` and `npm run user:remove -- anna`.
Passwords are stored bcrypt-hashed in `data/users.json`.

## Printing tips

- Print at **100% / actual size**, not "fit to page", so cards come out at
  their real size and the crop marks line up.
- Card size, bleed, crop marks and layout are set in the GiftFlow app
  (Settings → Print); the dashboard shows the current size at the top.
- Each card's order number is printed in the bleed, outside the trim, so a
  stack of cards can be matched to orders and the number is cut away.

## Running it for real

- Serve it over HTTPS (behind nginx, Caddy or similar) and set
  `SECURE_COOKIES=true`.
- Keep it on the warehouse network or behind a VPN if you can; it is a login
  page in front of customer messages.
- Run it with a process manager (`pm2 start server.js --name giftflow-dashboard`,
  or a systemd unit) so it restarts on reboot.

## Security notes

- Logins are rate-limited (5 failed attempts per IP per 15 minutes).
- Sessions last one working day (12 hours) in a signed, http-only cookie.
- State-changing calls require a header a cross-site form cannot send.
- Message HTML is sanitized by GiftFlow and again in the browser before display.
