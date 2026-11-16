# Razorpay Payments — Notes for the Flutter Developer

How Razorpay works in this app, what's already configured, and exactly what the Flutter app must do. Base URL: `https://app.rideloo.com/api/v1`. Auth: `Authorization: Bearer <token>` (user or driver token depending on the flow).

> **Hindi (short):** Razorpay ab **server pe configure ho gaya hai (TEST mode)** — keys app me ya `.env` me nahi hoti, woh backend ke database me hoti hain. App ko sirf: (1) order banane ka API call karna hai, (2) server se mila **keyId + orderId** le ke Razorpay SDK kholna hai, (3) payment ke baad **verify** API call karna hai. Test mode me asli paisa nahi katta.

---

## 1. Current status
- **Razorpay is configured and enabled in TEST mode** on production (`app.rideloo.com`).
- Keys are stored **server-side in the database** (admin Payment Gateways), **not** in the app and **not** in `.env`. The Flutter app must **never** hardcode the key/secret.
- **Key secret stays on the server only.** The app only ever receives the **public Key ID** (`rzp_test_…`) in an order response — never the secret.

## 2. The golden rule — the 3-step pattern (same for every Razorpay payment)
Every Razorpay flow in this app is **order → checkout → verify**:

1. **Create order (server):** call the flow's `.../razorpay/order` endpoint with the amount. Server creates a Razorpay order and returns:
   ```json
   { "keyId": "rzp_test_…", "orderId": "order_XXXX", "amount": 50000, "currency": "INR" }
   ```
   - `amount` is in **paise** (₹500 → `50000`). Pass it straight to the SDK.
   - `keyId` comes **from this response** — use it to open the SDK. **Do not hardcode a key in the app.**
2. **Open Razorpay checkout (app):** use the `razorpay_flutter` SDK with `key: keyId`, `order_id: orderId`, `amount`, `currency`. The user pays.
3. **Verify (server):** on SDK success you get `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`. POST them to the flow's `.../razorpay/verify` endpoint. The server checks the signature + captures the payment and only then credits the wallet / marks the booking paid. **The payment is not "done" until verify returns success.**

If `verify` fails or is never called, the money is **not** credited — always call verify.

## 3. Which gateway is active? (discovery)
Before showing a pay button, the app can ask the server which gateway is on:

- **`GET /common/payment-gateway`** → returns:
  ```json
  { "activeGateway": { "slug": "razor_pay", "walletTopUpMode": "razorpay_checkout", "supportsWalletTopUp": true, ... } }
  ```
  - `walletTopUpMode: "razorpay_checkout"` → open the Razorpay SDK (this doc).
  - `walletTopUpMode: "phonepe_redirect"` → PhonePe redirect flow instead.
  - Only **one** gateway is active at a time. Right now it's **Razorpay**.

## 4. Endpoints by flow (all follow the order → verify pattern)

**Driver:**
| Flow | Order | Verify |
|---|---|---|
| Wallet top-up | `POST /drivers/wallet/top-up/razorpay/order` | `POST /drivers/wallet/top-up/razorpay/verify` |
| Daily subscription (gateway) | `POST /drivers/subscription/purchase` with `{ "planId", "paymentMethod": "razorpay" }` → returns `requiresPayment: true` + the order to pay | pass to Razorpay, then the subscription is activated on payment verification |

**User:**
| Flow | Order | Verify |
|---|---|---|
| Wallet top-up | `POST /users/wallet/razorpay/order` | `POST /users/wallet/razorpay/verify` |
| Ride completion payment | `POST /rides/:rideId/complete-payment/razorpay/order` | `POST /rides/:rideId/complete-payment/razorpay/verify` |
| Ride fare (pay online) | `POST /rides/:rideId/fare-payment/razorpay/order` | `POST /rides/:rideId/fare-payment/razorpay/verify` |
| Tip | `POST /rides/:rideId/tip/razorpay/order` | `POST /rides/:rideId/tip/razorpay/verify` |
| Rental advance | `POST /users/rental-advance/razorpay/order` | `POST /users/rental-advance/razorpay/verify` |
| Bus booking | `POST /users/bus-bookings/order` | `POST /users/bus-bookings/verify` |
| Pooling booking | `POST /users/pooling/bookings/order` | `POST /users/pooling/bookings/verify` |

Order request body is `{ "amount": <number in rupees> }` (server converts to paise), except subscription which takes `{ planId, paymentMethod }`.

## 5. Testing (TEST mode — no real money)
- Use a Razorpay **test card**: `4111 1111 1111 1111`, any future expiry, any CVV, any name. (UPI test: use Razorpay's test UPI `success@razorpay`.)
- **Wallet top-up has a ₹500 minimum** (admin setting `minimum_amount_added_to_wallet`). Test top-ups with **₹500+**, or lower that minimum in Admin → Wallet Settings. A smaller amount returns `400 "Minimum top-up amount is Rs 500"` — that's expected, not a bug.
- If an order call returns `"Razorpay keys are demo placeholders…"`, the server still has demo keys (it doesn't now — real test keys are set).

## 6. What the Flutter dev must make sure of
1. **Take `keyId` from the order response** and pass it to the SDK — never ship a hardcoded key.
2. **Amount is in paise** in the order response — don't multiply again.
3. **Always call the `verify` endpoint** after a successful SDK result; treat payment as complete only on a successful verify response.
4. On SDK failure/cancel, don't call verify; show a retry.
5. (Nice to have) Call `GET /common/payment-gateway` to decide Razorpay-checkout vs PhonePe-redirect instead of assuming.

## 7. WebView note
If the pay screen runs inside the Flutter WebView (web Razorpay checkout), the app already spoofs the User-Agent so UPI-intent apps show (`main.jsx`). No action needed — just don't strip that logic.

---

**Summary:** Server-side config is done (Razorpay test keys live in the DB, enabled). No key goes in the app or `.env`. The app follows **order → open SDK with returned keyId/orderId → verify**. Verify is mandatory.
