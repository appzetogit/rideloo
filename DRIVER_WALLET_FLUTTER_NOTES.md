# Driver Wallet — Notes for the Flutter Developer

Covers the two things seen in the driver-app logs: the **Daily Subscription "Pay by Wallet"** error and the **wallet top-up "Minimum top-up amount is Rs 500"** error. One was a real backend bug (now fixed + deployed); the other is **not a bug** — it's a configured setting.

> **Hindi (short):** Pehla issue (Daily Subscription wallet payment) **backend bug tha, ab fix + deploy ho gaya hai** — Flutter me kuch nahi karna, bas test karo. Dusra issue (₹99 top-up "Minimum Rs 500") **bug nahi hai** — woh admin ka setting hai (minimum 500). Chhota amount allow karna hai to admin panel → Wallet Settings me minimum kam karo. Flutter me chaho to minimum API se padh ke pehle hi validate kar sakte ho.

---

## Issue 1 — Daily Subscription → "Pay by Wallet" failed ✅ FIXED & DEPLOYED

**Symptom:** tapping **Pay ₹199 by Wallet** on the Daily Subscription screen returned:
`Transaction numbers are only allowed on a replica set member or mongos`

**Cause:** pure **backend** — the wallet purchase ran inside a MongoDB multi-document transaction, which the production DB (standalone `mongod`) rejects. Not a Flutter issue.

**Status:** fixed in the backend and **deployed to production** (`app.rideloo.com`, backend restarted and healthy). The wallet purchase now settles with an atomic, balance-guarded debit (no transaction).

**Flutter action:** **none.** No app change or rebuild needed. Just verify:
- Driver with **≥ ₹199** wallet balance → **Pay ₹199 by Wallet** → succeeds, pass becomes active, wallet debited.
- Driver with **< ₹199** → clean message **"Not enough wallet balance"** (not the transaction error).
- **Pay by UPI / Card** was never broken — still works.

**Endpoint (unchanged):** `POST /api/v1/drivers/subscription/purchase` → body `{ "planId": "<id>", "paymentMethod": "wallet" }` (also `"razorpay"` / `"phonepe"`).

---

## Issue 2 — Wallet top-up "Minimum top-up amount is Rs 500" ⚙️ NOT A BUG (admin setting)

**Symptom (from your log):**
```
POST /api/v1/drivers/wallet/top-up/razorpay/order   payload: {amount: 99.0}
<-- 400  {success:false, message: "Minimum top-up amount is Rs 500"}
```

**This is correct, intended behavior.** The backend enforces a configurable **minimum top-up amount** (`minimum_amount_added_to_wallet`, currently **500**). ₹99 is below it, so it's rejected. There is nothing to fix in code.

**To allow smaller top-ups (business decision):** Admin panel → **Settings → Wallet Settings → "Minimum amount added to wallet"** → set to the desired value (e.g. `99` or `1`) → Save. Takes effect immediately, no deploy.

### Recommended Flutter-side improvement (optional but nice UX)
Right now the app lets the driver submit ₹99 and only learns the minimum from a 400 error. Instead, **read the minimum from the wallet API and validate before sending**, so it stays in sync with whatever admin configures:

- **`GET /api/v1/drivers/wallet`** returns the wallet, which includes **`minimumTopUpAmount`** (and `minimumTransferAmount`, `isWalletEnabled`, `isTransferEnabled`, `balance`, etc.).
- In the top-up UI: read `minimumTopUpAmount`, pre-fill / enforce it as the minimum, and show a friendly inline message like *"Minimum top-up is ₹{minimumTopUpAmount}"* before the user taps pay.
- This avoids the round-trip 400 and means you **never hardcode 500** in the app — if admin changes it, the app follows automatically.

**Top-up endpoints (unchanged):**
- `POST /api/v1/drivers/wallet/top-up/razorpay/order` → `{ "amount": <number ≥ minimumTopUpAmount> }`
- `POST /api/v1/drivers/wallet/top-up/phonepe/order`

---

## Quick reference

| Thing | Type | Who fixes it | Status |
|---|---|---|---|
| Daily Subscription "Pay by Wallet" crash | Backend bug | Backend (done) | ✅ Deployed to prod |
| Top-up "Minimum Rs 500" | Config/setting | Admin (Wallet Settings) | ⚙️ Change setting if you want < 500 |
| Top-up UX (validate min client-side) | Flutter enhancement | Flutter dev | Optional — read `minimumTopUpAmount` from `GET /drivers/wallet` |

**Auth for all driver endpoints:** `Authorization: Bearer <driverToken>`. Base URL `https://app.rideloo.com/api/v1`.
