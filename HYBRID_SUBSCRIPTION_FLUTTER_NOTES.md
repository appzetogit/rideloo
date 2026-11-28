# Hybrid Subscription + Commission — Flutter Developer Notes

**Status:** Deployed & live on production (`app.rideloo.com`). Backend `subscription_mode = 'both'`,
commission 20% set on taxi SetPrices. This doc tells the Flutter/driver-app dev what changed and
what the app must handle. **No breaking API changes** — same endpoints, changed behaviour.

**Hindi (short):** Pehle pass zaroori tha — bina pass driver ko koi ride nahi milti thi. Ab **hybrid**
hai: pass waale ko **0% commission** (full fare), aur **bina pass waale ko bhi rides milti hain** par
**commission katega** (jab tak unka wallet minimum se upar hai). Driver app ko ab pass ko
**mandatory nahi** maanna — `required: false` aayega. Niche details.

---

## 1. What changed (business model)

Two tracks now coexist, decided per driver by whether they hold an **active paid pass**:

| | Track A — Pass holder | Track B — No pass (commission) |
|---|---|---|
| Gets ride offers? | ✅ Yes (even ₹0 / negative balance) | ✅ **Yes (NEW)** — as long as wallet ≥ minimum |
| Wallet minimum check | Waived | Enforced |
| Commission on completion | **0% (waived)** — keeps full fare | **Standard %** deducted |
| Blocked when? | Never (while pass active) | When wallet < minimum → recharge OR buy pass |

Before this change the backend was pass-mandatory: a passless driver was removed from every dispatch
wave. **Now a passless driver with enough wallet balance receives rides and pays commission.**

---

## 2. The one behaviour the app MUST get right

> **The driver app must NOT treat a subscription pass as mandatory anymore.**

- A driver can go online and receive rides **without** a pass (Track B).
- Decide "is a pass required?" from the backend, **never hardcode it**.
- Gate going-online on the **wallet** (blocked / below minimum), **not** on "has a pass".

If the app currently shows a "buy a pass to continue" paywall that blocks the home screen or the
go-online toggle, **remove that hard gate**. The pass becomes optional in hybrid mode.

---

## 3. API contract (unchanged endpoints)

### 3a. Subscription status — `GET /drivers/subscription`
```jsonc
{
  "success": true,
  "data": {
    "enabled": true,            // subscriptions can be bought
    "required": false,          // ⬅️ KEY: false in hybrid ('both'); true only in 'subscription_only'
    "status": "active" | "expired",
    "expiresAt": "2026-11-24T00:30:00.000Z" | null,
    "currentCycle": { "startsAt": "...", "expiresAt": "..." },
    "paymentMethods": ["wallet", "gateway"],
    "onExpiry": "commission",   // 'commission' = after expiry fall back to commission (not blocked)
    "subscription": { "id": "...", "planName": "...", "expiresAt": "...", ... } | null,
    "plans": [ { "id": "...", "name": "...", "amount": 199, "vehicleClasses": ["bike","car"] } ]
  }
}
```
**App logic:**
- `required === false` → **do not force** a pass. Show it as an optional offer ("Buy a pass for 0%
  commission"), not a blocker.
- `required === true` (only if an admin switches back to `subscription_only`) → pass mandatory, old
  behaviour.
- `status === 'active'` → show "Pass active until `expiresAt`", badge driver as 0%-commission.
- `status === 'expired'`/no pass → driver is on commission; that's fine, let them work.

### 3b. Buy a pass — `POST /drivers/subscription/purchase`
```jsonc
// body
{ "planId": "<plans[].id>", "paymentMethod": "wallet" }   // or "razorpay" / "phonepe"
```
- `wallet` → debits wallet immediately, returns active pass.
- `razorpay`/`phonepe` → returns `{ requiresPayment: true }`; after gateway verify the pass activates.
- **There is no direct gateway endpoint for the pass** — online purchase = top up wallet via gateway,
  then buy with `paymentMethod: "wallet"`. (See `DRIVER_WALLET_FLUTTER_NOTES.md`.)
- Errors: `409` "A subscription is already active…", `400` "Subscriptions are not enabled" (only if an
  admin set mode `off`), `400` "Choose a subscription plan".

### 3c. History — `GET /drivers/subscription/history`
Returns past passes with `tripsCovered`, `commissionWaived` per pass (useful for a "savings" screen).

### 3d. Go online — `PATCH /drivers/online`
```jsonc
{ "location": [lng, lat], "selfieImageUrl": "<optional>" }
```
- Backend allows it when: pass active **OR** wallet ≥ minimum. **No pass check beyond that.**
- Blocked → `403` with a mode-aware message:
  - hybrid/commission: **"Wallet balance is below the minimum. Recharge your wallet or buy a
    subscription pass to receive rides."**
  - subscription_only: "Buy today's pass to go online and get rides."
  - wallet disabled by admin: "Driver wallet is disabled by admin."
- **App:** on `403`, show the returned message and offer **both** actions — **Recharge wallet** and
  **Buy pass** (in hybrid). Don't assume "buy pass" is the only way back.

---

## 4. Wallet gating (how the app should decide "can go online")

The driver-wallet payload (`GET /drivers/me` / wallet endpoint, `serializeDriverWallet`) returns:
```jsonc
{ "balance": 250, "minimumBalanceForOrders": -500, "availableForOrders": 750, "isBlocked": false, ... }
```
- `isBlocked` already accounts for the pass: it is `true` only when the wallet is disabled, or the
  balance is below the minimum **and** no active pass covers the driver.
- **Gate the go-online button on `isBlocked`**, not on "has a pass". (The web app already does this.)
- A passless driver with `balance ≥ minimumBalanceForOrders` → `isBlocked: false` → can go online.

---

## 5. Commission (what the driver earns) — for display

Computed server-side at trip completion; the app just displays the result from the ride/earnings data:
- **Pass holder:** commission **0**, keeps full fare (minus any rider platform fee). The pass's
  `commissionWaived` grows — good for a "you saved ₹X with your pass" message.
- **No pass, cash ride:** commission (e.g. 20% of fare) **debited from wallet** — show "Commission ₹X
  deducted". Driver collected cash from rider.
- **No pass, online ride:** driver's wallet **credited** `fare − commission`.
- Commission % is admin-configured per vehicle/location (SetPrices). Don't hardcode it in the app;
  read fare/commission from the ride payload.

Optional but recommended UX: on the driver's earnings/summary screen, show whether a ride was
"0% (Pass)" or "Commission ₹X", so Track B drivers understand the deduction and are nudged toward a
pass.

---

## 6. Is native Flutter work needed?

The driver/user/admin apps are the **React/Vite web build rendered in the Flutter WebView**, so:
- If your driver screens (home, go-online, subscription, wallet) are the **web screens**, this is
  **already handled** on the web side — ships by rebuilding + redeploying the web app, **no Dart
  change**. The web `DriverHome.goOnline` already gates on `wallet.isBlocked`, not a pass paywall.
- **Only** if the native Flutter app has its **own** driver home / go-online / subscription screens
  (not the WebView) do you implement §2–§5 there in Dart.

Either way: **remove any native "pass mandatory" gate**, and drive everything off `required` +
`wallet.isBlocked`.

---

## 7. Config dependencies (already set on prod, FYI)

These are backend/admin settings the behaviour depends on — already configured, listed so you know
what drives it:
- `driver_subscription.subscription_mode = 'both'` (admin → Driver Subscription Settings). `off` =
  commission only, `subscription_only` = pass mandatory.
- `on_expiry = 'commission'` → an expired pass falls back to commission (driver keeps getting rides).
- **Commission % lives in SetPrices** (`admin_commission_from_driver`, type 1 = percentage). Currently
  20% on taxi. If it's 0, Track B drivers pay **0** commission — so this must be non-zero for the
  model to collect. Parcel/pooling/bus are separate and currently 0.

---

## 8. Test checklist (end to end)

1. **Pass driver, any balance (even ₹0/negative):** goes online ✅, gets rides ✅, completes → fare
   shows **0% commission**, full fare; pass `commissionWaived` increases.
2. **No-pass driver, balance ≥ minimum:** goes online ✅, **gets rides** ✅ (this is the new bit),
   completes → **commission deducted** (cash → wallet debit `commission_deduction`; online →
   `ride_earning` credit of `fare − commission`).
3. **No-pass driver, balance < minimum:** cannot go online / not dispatched → app shows "Recharge
   wallet or buy a pass". After recharge above minimum → can work on commission immediately.
4. **Pass expires mid-day:** driver keeps getting rides on commission (not blocked), gets an FCM
   "subscription ended" notice.

DB spot-check (server): a fresh completed ride shows `pricingSnapshot.admin_commission_from_driver:
20` and the right `commissionAmount` (0 for pass, ~20% for no-pass).

---

## 9. Files changed (backend reference)

- `Backend/src/modules/taxi/admin/data/defaultBusinessSettings.js` — `subscription_mode` default
  `off` → `both`.
- `Backend/src/modules/taxi/driver/services/driverSubscriptionService.js` —
  `resolveDriverSubscriptionSettings` now config-driven (reads `subscription_mode`, `on_expiry`).
- `Backend/src/modules/taxi/services/matchingService.js` — `buildSubscriptionDriverFilter` requires a
  pass only in `subscription_only`; in `both` a passless driver stays eligible (gated by
  `wallet.isBlocked`).
- `Backend/src/modules/taxi/driver/services/walletService.js` —
  `ensureDriverWalletCanAcceptRide` block message is mode-aware (recharge-or-pass).
- Commission settlement (`settleCompletedRideWallet`) already handled both tracks — unchanged.

See `DRIVER_SUBSCRIPTION_COMMISSION_FLOW.md` for the full backend flow.
