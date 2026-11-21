# Cashfree Payments — Notes for the Flutter Developer

How Cashfree works in this app, what the backend already does, and exactly what the Flutter app must do. Base URL: `https://app.rideloo.com/api/v1`. Auth: `Authorization: Bearer <token>` (user or driver token depending on the flow).

Cashfree is wired **alongside** Razorpay — same `order → checkout → verify` shape, but Cashfree's SDK opens checkout with a **`payment_session_id`** instead of a key+order pair. Only **one** gateway is active at a time (set in Admin → Payment Gateways).

> **Hindi (short):** Cashfree backend me ab poora ready hai. App ko: (1) order banane ka API call karna hai, (2) server se mila **`paymentSessionId`** le ke Cashfree SDK kholna hai, (3) payment ke baad **verify** API call (`order_id` bhej ke) karna hai. Keys app/`.env` me nahi — backend DB me hoti hain. Sandbox me asli paisa nahi katta.

---

## 1. Current status
- Cashfree code is **merged in the backend** (not yet deployed/enabled). Keys are **not configured yet** — the admin must add the Cashfree **App ID + Secret Key** in **Admin → Payment Gateways** (use **sandbox** keys first) and set the environment.
- Keys live **server-side in the database only**, never in the app, never in `.env`. The **Secret Key never leaves the server** — the app only ever gets a `paymentSessionId`.
- Everything below must be **sandbox-tested** before going live.

## 2. The golden rule — the 3-step pattern (every Cashfree payment)
Every Cashfree flow is **order → checkout → verify**:

1. **Create order (server):** call the flow's `.../cashfree/order` endpoint. Server creates a Cashfree order and returns:
   ```json
   {
     "gateway": "cashfree",
     "orderId": "ufarecf_xxx_yyy_zzz",
     "paymentSessionId": "session_XXXXXXXX",
     "amount": 500,
     "currency": "INR",
     "isProduction": false
   }
   ```
   - `amount` is in **rupees** (not paise). `isProduction: false` → Cashfree **SANDBOX** environment; `true` → **PRODUCTION**.
2. **Open Cashfree checkout (app):** use the `flutter_cashfree_pg_sdk`. Build a session from **`paymentSessionId`** + **`orderId`**, with environment = SANDBOX when `isProduction` is false (else PRODUCTION). The user pays.
3. **Verify (server):** after the SDK returns, POST the **`order_id`** to the flow's `.../cashfree/verify` endpoint. The server fetches the order from Cashfree and credits the wallet / marks the ride paid **only if Cashfree reports the order as `PAID`**. **Payment is not "done" until verify returns success.**

If `verify` fails or is never called, nothing is credited — always call verify. Verify is **idempotent** (safe to retry with the same `order_id`).

## 3. Which gateway is active? (discovery)
Before showing a pay button:
- **`GET /common/payment-gateway`** → when Cashfree is the active gateway it returns `walletTopUpMode: "cashfree_checkout"`. Branch on this:
  - `"razorpay_checkout"` → Razorpay SDK (see RAZORPAY_FLUTTER_NOTES.md)
  - `"cashfree_checkout"` → Cashfree SDK (this doc)
  - `"phonepe_redirect"` → PhonePe redirect

## 4. Endpoints by flow

**Driver:**
| Flow | Order | Verify | Verify body |
|---|---|---|---|
| Wallet top-up | `POST /drivers/wallet/top-up/cashfree/order` | `POST /drivers/wallet/top-up/cashfree/verify` | `{ "order_id" }` |

**User:**
| Flow | Order | Verify | Verify body |
|---|---|---|---|
| Wallet top-up | `POST /users/wallet/cashfree/order` | `POST /users/wallet/cashfree/verify` | `{ "order_id" }` |
| Ride fare (pay online) | `POST /rides/:rideId/fare-payment/cashfree/order` | `POST /rides/:rideId/fare-payment/cashfree/verify` | `{ "order_id" }` |
| Ride completion | `POST /rides/:rideId/complete-payment/cashfree/order` | `POST /rides/:rideId/complete-payment/cashfree/verify` | `{ "order_id", "rating", "comment", "tipAmount" }` |
| Tip | `POST /rides/:rideId/tip/cashfree/order` | `POST /rides/:rideId/tip/cashfree/verify` | `{ "order_id", "rating", "comment", "tipAmount" }` |

- **Order request body:** `{ "amount": <rupees> }` for wallet top-ups. For fare/completion/tip the server computes the amount from the ride itself — completion/tip order bodies carry `{ "rating", "tipAmount" }` (same fields you already send to the Razorpay versions).
- **Completion & tip verify** also submit the rider's feedback, so they take `rating` + `comment` + `tipAmount` alongside `order_id` — identical to the Razorpay verify payloads, just `order_id` instead of the three `razorpay_*` fields.

## 5. Driver "Pay by UPI/Card" for the Daily Subscription — use wallet top-up
There is **no direct Cashfree endpoint for the subscription** (by decision — and none exists for Razorpay either). The online path for a subscription is **two steps**:

1. **Top up the wallet** via Cashfree: `POST /drivers/wallet/top-up/cashfree/order` → SDK → `.../verify` (section 2).
2. **Buy the pass from the wallet:** `POST /drivers/subscription/purchase` with `{ "planId": "<id>", "paymentMethod": "wallet" }`.

So "Pay by UPI/Card" on the subscription screen = *fill wallet with Cashfree, then pay the pass by wallet*. "Pay by Wallet" (when the balance already covers it) stays a single `purchase` call. Wallet payment is enabled by default (`payment_methods` = `wallet,gateway`).

## 6. Testing (SANDBOX — no real money)
- Admin sets **sandbox** App ID + Secret and environment = test/sandbox in Admin → Payment Gateways.
- Use Cashfree's **sandbox test cards / test UPI** from their docs. The SDK environment must be **SANDBOX** (driven by `isProduction: false` from the order response).
- **Wallet top-up has a ₹500 minimum** (`minimum_amount_added_to_wallet`). Test with ₹500+, or lower it in Admin → Wallet Settings. Below it returns `400` — expected.
- If an order call returns *"Cashfree is not configured…"*, the keys aren't set in admin yet.

## 7. What the Flutter dev must make sure of
1. **Open the SDK with `paymentSessionId`** from the order response — never hardcode keys.
2. **Amount is in rupees** here (unlike Razorpay's paise) — don't convert.
3. Pick SANDBOX vs PRODUCTION from **`isProduction`** in the order response.
4. **Always call `verify`** with `order_id` after the SDK returns; treat payment as complete only on a successful verify. Retry-safe.
5. On SDK cancel/failure, don't call verify; show retry.
6. For **completion/tip**, send the same `rating`/`comment`/`tipAmount` you send to the Razorpay verify.
7. Use `GET /common/payment-gateway` → `walletTopUpMode` to choose Cashfree vs Razorpay vs PhonePe rather than assuming.

---

**Summary:** Backend is ready for Cashfree across wallet top-up (driver + user), ride fare, ride completion, and tip — all `order → open SDK with paymentSessionId → verify(order_id)`, amounts in rupees, verify mandatory and idempotent. Subscription online pay routes through **wallet top-up → pay by wallet**. Still needed before production: add sandbox keys in admin, deploy, and sandbox-test every flow.
