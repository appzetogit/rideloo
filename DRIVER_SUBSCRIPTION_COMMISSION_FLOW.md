# Driver Subscription (Daily Pass) + Ride Request + Commission — Flow Reference

**Status:** Documentation only — describes how the system works today (backend `Backend/src/modules/taxi`).
Nothing in here is a change; it's a map of the existing code so the team and the Flutter dev
share one mental model.

**Hindi (short):** Driver ko ride paane ke liye **daily pass** zaroori hai. Pass hai → wallet
balance check nahi hota + dispatch me dikhta hai. Pass nahi → koi ride offer hi nahi. Ride complete
hone par commission kata/credit hota hai — **cash ride** me wallet se commission **debit**, **online
ride** me `fare − commission` **credit**. Pass hone par commission **maaf** (par rider platform fee
phir bhi admin ko).

---

## 0. The three pieces and how they connect

```
PASS (subscription)  ──gates──►  RIDE REQUEST / DISPATCH  ──on complete──►  COMMISSION settlement
   (buy per day)                 (only paying drivers get offers)           (cash debit / online credit)
```

- A driver **must hold a paid daily pass** to receive and accept rides.
- The pass decides **whether** a driver is offered work and **whether** the wallet-minimum is checked.
- When a ride completes, commission is settled; **a covering pass waives the commission** (but never
  the rider's platform fee).

---

## 1. The pass model

**`DriverSubscription`** — one row per purchased pass
(`Backend/src/modules/taxi/driver/models/DriverSubscription.js`):

| Field | Meaning |
|---|---|
| `driverId` | owner |
| `planId`, `planName`, `amount` | which plan, price paid |
| `vehicleClasses` | classes the plan covers (bike/auto/car) |
| `startsAt`, `expiresAt` | the pass window (a fixed clock window — see §3) |
| `paymentMethod` | `wallet` \| `razorpay` \| `phonepe` \| `bonus` |
| `paidAt` | set when actually paid (null = unpaid/pending gateway) |
| `status` | `active` |
| `tripsCovered`, `commissionWaived` | usage counters, written at settlement |
| `expiryNotifiedAt` | set by the expiry sweep so it notifies once |

**`SubscriptionPlan`** (admin-managed, `audience: 'driver'`) — priced per **vehicle class**
(bike/auto/car), so a bike and a cab pass cost differently.

---

## 2. Settings — what is admin-controlled vs hardcoded ⚠️

`resolveDriverSubscriptionSettings()`
(`Backend/src/modules/taxi/driver/services/driverSubscriptionService.js:29`):

- **Hardcoded (admin switch ignored):**
  - `mode: 'subscription_only'` → **a paid pass is mandatory for every driver.**
  - `waiveWalletMinimum: true` → with a pass, the wallet balance is not checked.
  - `onExpiry: 'block'` → no pass ⇒ no rides.
- **Still admin-controlled:** `waive_commission` (default on), the plans, `payment_methods`
  (`wallet,gateway`), `multi_vehicle_rule` (`highest`), `cycle_start_hour` (default 6), `cycle_timezone`
  (default `Asia/Kolkata`).

> **Note for whoever maintains this:** the admin's `subscription_mode` / expiry / wallet-minimum
> toggles are effectively dead because the mode is hardcoded here. To ever make the pass optional,
> this function is the single place to change.

---

## 3. Pass window (cycle) — when a pass is valid

`getCycleWindow()` (`...driverSubscriptionService.js:61`):

- A pass is a **fixed clock window**, default **06:00 → next 06:00 (Asia/Kolkata)**.
- A pass bought at noon **still ends at 06:00 the next morning** — it is *not* 24 hours from payment.
- Servers run on UTC; the timezone offset is **measured** (via `Intl.DateTimeFormat`) so India's
  +5:30 is handled correctly.

"Active pass" everywhere means: `status:'active'` AND `paidAt != null` AND `expiresAt > now`
(`getActiveDriverSubscription`, `...driverSubscriptionService.js:108`).

---

## 4. How a driver gets a pass (purchase flows)

### 4a. Driver app — status + buy

| Action | Endpoint | Service |
|---|---|---|
| See status + buyable plans | `GET /drivers/subscription` | `getDriverSubscriptionStatus` (`:171`) |
| Buy today's pass | `POST /drivers/subscription/purchase` `{ planId, paymentMethod }` | `purchaseDriverSubscription` (`:221`) |
| History | `GET /drivers/subscription/history` | controller `getMySubscriptionHistory` |

`purchaseDriverSubscription` (`...driverSubscriptionService.js:221`):
- If a pass is **already active** → `409` (one per cycle).
- **`paymentMethod: "wallet"`** → create the row with `paidAt = now`, then an **atomic,
  balance-guarded wallet debit** (`applyDriverWalletAdjustment`, `requireSufficientFunds: true`,
  type `subscription_purchase`). If the balance can't cover it, the just-created row is **deleted**
  (no unpaid pass is ever left behind). *No DB transaction — "standalone mongod" rationale.*
- **`paymentMethod: razorpay/phonepe`** → create the row **unpaid** (`paidAt: null`), return
  `requiresPayment: true`. After the gateway verifies, `activateDriverSubscription` (`:386`) sets
  `paidAt` and re-syncs the wallet-blocked flag.

> **There is no direct "pay for subscription via gateway" endpoint.** Online = top up the wallet
> (Razorpay / Cashfree / PhonePe) first, then buy the pass with `paymentMethod: "wallet"`.
> (See `DRIVER_WALLET_FLUTTER_NOTES.md` / `DRIVER_DAILY_SUBSCRIPTION_FIX.md`.)

### 4b. Joining-bonus auto-pass (first time, on approval)

When an admin approves a driver (`adminService.js:5578`):
1. `grantDriverJoiningBonus` (`walletService.js:374`) credits a **fixed, class-based** bonus
   (`bike:100, auto:100, car:150`; else `env.driverWallet.joiningBonus`). Idempotent — paid once.
2. `purchaseDriverSubscriptionFromJoiningBonus` (`...driverSubscriptionService.js:319`) spends that
   bonus on as many **whole days** of the cheapest matching plan as it covers; leftover stays as
   wallet cash. Recorded with `paymentMethod: 'bonus'` (never reused afterwards).

### 4c. Expiry (pass ends)

Expiry is not an event — a pass lapses by comparison against `expiresAt`. A sweep runs every **5 min**
on each instance (`sweepExpiredDriverSubscriptions`, `driverSubscriptionExpiryService.js:23`):
- Atomically claims each lapsed pass on `expiryNotifiedAt` (so the 4 instances notify once).
- Recomputes the driver's wallet-blocked flag (`syncDriverWalletBlockedFlag`).
- Sends an FCM push: *"Your subscription has ended — activate your Daily Subscription…"*.

---

## 5. How the pass gates ride requests (dispatch)

When a rider books (`createRideRecord → startDispatchFlow → matching`), the pass is enforced in **two**
places:

### Gate 1 — Dispatch filter (who gets offered the ride)
`buildSubscriptionDriverFilter()` (`matchingService.js:41`): because the mode is `subscription_only`,
the driver-matching query is restricted to `_id ∈ { drivers with an active paid pass }`. A driver
**without** a pass — even if online and nearby — **never appears in the offer list**. This is combined
with the normal zone / vehicle-type / geo (`$near`) filters.

### Gate 2 — Go-online / accept check
`ensureDriverWalletCanAcceptRide()` (`walletService.js:197`) runs at:
- **Go online** — `driverController.js:2865`
- **Accept a ride** — `rideService.js:2000` (`acceptRideAssignment`)
- **Accept a bid** — `rideService.js:2617`

Logic: active pass → **skip the wallet-minimum check** (that's most of what the pass buys). No pass →
if balance is below the minimum, **block** with: *"Buy today's pass to go online and get rides."*
(An admin-disabled wallet blocks separately, regardless of balance.)

> **One-liner:** Pass → appears in dispatch **and** can go online/accept without a balance check.
> No pass → neither offered nor allowed to accept.

---

## 6. Commission flow (ride completion)

On `completed`, `settleCompletedRideWallet({ rideId })` (`walletService.js:447`) runs **once** per ride
(idempotent via the `walletSettledAt` guard):

1. **Resolve commission rate** — `resolveCommissionConfigForRide` (`:47`), priority:
   ride `pricingSnapshot` → `SetPrice` lookup (vehicle_type + transport_type + service_location) →
   parcel vehicle fallback → `env` default (`DRIVER_COMMISSION_PERCENT`, 20%). Percentage or fixed.
2. **Rider platform fee** (`pricingSnapshot.rider_platform_fee`) — never the driver's money; always
   goes to admin, clamped to `[0, fare]`.
3. **Pass waiver** — if the driver had an active pass **covering the ride's completion time** and
   `waive_commission` is on → `chargeableCommission = 0` (commission waived). The platform fee is
   **still** charged. The covering pass row is incremented: `tripsCovered += 1`,
   `commissionWaived += amount`.
4. **Settle to the wallet** — `commissionAmount = min(chargeableCommission + platformFee, fare)`,
   `driverEarnings = max(fare − commissionAmount, 0)`:

| Ride payment | Who holds the cash | Wallet effect | Txn type |
|---|---|---|---|
| **Cash / UPI** (driver collected directly) | Driver | **Debit** `−commissionAmount` | `commission_deduction` |
| **Online** (rider paid the platform) | Platform | **Credit** `+driverEarnings` (`fare − commission`) | `ride_earning` |

- **Pass + cash ride:** commission is 0 (waived), so only the platform fee (if any) is debited →
  effectively the driver keeps the whole fare minus the platform fee. That is the pass's value — the
  platform already earned from them via the pass that day.
- `collectedVia` records the real tender (cash/upi/online); `paymentMethod` is forced to `cash` for
  cash/UPI so settlement treats it cash-like.

---

## 7. End-to-end sequence

```
Driver approved
  └─ joining bonus (class-based) ─► auto daily-pass (cheapest plan, N whole days)

Each day:
  Buy pass ─ wallet debit (or gateway → wallet → buy) ─► DriverSubscription(active, paidAt, 06:00→06:00)
       │                                                            │
  Go online ─ ensureDriverWalletCanAcceptRide ─ active pass? ─ yes ─┘ (balance check skipped)
       │                                            no → "Buy today's pass to go online"
       ▼
  Rider books ─► matching + buildSubscriptionDriverFilter ─► only paying drivers get the offer
       ▼
  Accept / accept-bid ─ ensureDriverWalletCanAcceptRide (pass re-checked)
       ▼
  Trip complete ─► settleCompletedRideWallet:
        • commission rate (snapshot → SetPrice → fallback)
        • active pass + waive_commission? → commission waived (platform fee still charged)
        • CASH  → wallet DEBIT (commission + platform fee)
        • ONLINE→ wallet CREDIT (fare − commission)
        • pass row: tripsCovered++, commissionWaived += waived

Every 5 min: expiry sweep ─► lapsed pass → wallet-block recompute + "subscription ended" push
```

---

## 8. Caveats / things to know

1. **Mode is hardcoded mandatory** (`subscription_only`) — admin's subscription-mode / expiry /
   wallet-minimum switches are dead. Change `resolveDriverSubscriptionSettings` to alter this.
2. **Transaction vs standalone-mongod inconsistency:** `purchaseDriverSubscription` deliberately
   avoids DB transactions ("standalone mongod rejects them"), but `settleCompletedRideWallet` and
   `topUpDriverWallet` **use** `mongoose` transactions. Both can't be true on the same DB — confirm
   whether the production DB is actually a replica set, or these settlement paths would throw.
3. **Wallet minimum can be negative** (acts as a cash limit); with a pass this check is skipped.
4. **Commission + platform fee never exceed the fare** (clamped); `driverEarnings` never negative.
5. Expiry / dispatch loops run on **every PM2 instance** (atomic claims prevent double work);
   production is currently a single instance.
6. The joining bonus and the `bike/auto/car` amounts are **hardcoded**, not admin settings.

---

## 9. File / function reference

| Concern | File:function |
|---|---|
| Settings (hardcoded mode), cycle window, purchase, joining-bonus pass, activation | `driver/services/driverSubscriptionService.js` (`resolveDriverSubscriptionSettings:29`, `getCycleWindow:61`, `getActiveDriverSubscription:108`, `listPlansForDriver:144`, `getDriverSubscriptionStatus:171`, `purchaseDriverSubscription:221`, `purchaseDriverSubscriptionFromJoiningBonus:319`, `activateDriverSubscription:386`) |
| Wallet / commission settlement / accept gate / joining bonus | `driver/services/walletService.js` (`ensureDriverWalletCanAcceptRide:197`, `applyDriverWalletAdjustment:243`, `grantDriverJoiningBonus:374`, `syncDriverWalletBlockedFlag:358`, `topUpDriverWallet:407`, `settleCompletedRideWallet:447`) |
| Expiry sweep | `driver/services/driverSubscriptionExpiryService.js` (`sweepExpiredDriverSubscriptions:23`) |
| Dispatch gating | `services/matchingService.js` (`buildSubscriptionDriverFilter:41`, used at `:378`) |
| Accept / bid-accept call sites | `services/rideService.js` (`:2000`, `:2617`) |
| Go-online call site | `driver/controllers/driverController.js` (`:2865`) |
| Approval → bonus → auto-pass | `admin/services/adminService.js` (`:5578`, `:5589`) |
| Controller endpoints | `driver/controllers/driverSubscriptionController.js` |
| Models | `driver/models/DriverSubscription.js`, `driver/models/WalletTransaction.js`, `admin/models/SubscriptionPlan.js` |
