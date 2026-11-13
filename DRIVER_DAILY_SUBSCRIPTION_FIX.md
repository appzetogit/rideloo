# Driver "Daily Subscription" — Payment Error Fix (Handoff for Flutter Dev)

**Error seen in the app:** `Transaction numbers are only allowed on a replica set member or mongos`
**Screen:** Driver app → **Daily Subscription** → tap **"Pay ₹199 by Wallet"**
**Status:** Fixed in the **backend** source. Needs backend **redeploy/restart** + retest. **No Flutter/Dart code change required.**

> **Hindi (short):** Yeh bug **backend** ka tha (MongoDB transaction), **Flutter app ka nahi**. Backend me fix ho gaya hai. Ab bas backend server ko **dobara deploy/restart** karna hai aur WebView me test karna hai. Flutter code me kuch change nahi karna.

---

## 1. Why this matters for the Flutter side

This product is a **Flutter WebView shell** wrapping a React web app. The "Daily Subscription" screen is **React rendered inside the WebView**, and the payment call goes to the **backend API** — so this error is **not** produced by Flutter/Dart code.

You do **not** need to change, rebuild, or re-release the Flutter app to fix this bug. But you are often the one who:
- notices/reports it from the device,
- coordinates the backend redeploy, and
- re-tests the flow in the WebView.

This doc gives you exactly what to check and how to confirm it's gone.

---

## 2. Root cause (plain English)

- The backend tried to run the wallet purchase inside a **MongoDB multi-document transaction** (`session.withTransaction(...)`).
- **Transactions require a replica set.** This deployment runs a **standalone `mongod`**, which rejects them with exactly that error message.
- So the moment a driver tapped **Pay by Wallet**, the purchase threw, and the WebView showed the red banner.

**Important:** The **"Pay by UPI / Card"** button was **never** broken — that path doesn't use a transaction. Only the **Wallet** button failed.

---

## 3. What was changed in the backend

Two files (backend only):

1. `Backend/src/modules/taxi/driver/services/walletService.js`
   - `applyDriverWalletAdjustment()` gained an optional `requireSufficientFunds` flag. When set on a debit, the wallet balance is decremented **atomically** (single guarded DB update: "only deduct if balance ≥ amount") — no transaction needed.

2. `Backend/src/modules/taxi/driver/services/driverSubscriptionService.js`
   - `purchaseDriverSubscription()` (the **Pay by Wallet** path) — removed the transaction. Now it **creates the subscription, then debits with the atomic guard**, and rolls the subscription back if the debit fails.
   - `purchaseDriverSubscriptionFromJoiningBonus()` (auto-buys a pass from a new driver's joining bonus) — same bug, same fix.

This matches how the rest of the backend already works around standalone MongoDB (atomic conditional updates instead of transactions).

---

## 4. ⚠️ Why you may STILL see the error (most common confusion)

Editing the source does **not** change a backend process that is already running. You will keep seeing the error until the **backend is restarted/redeployed with the new code**.

- If the app talks to the **production server** (PM2, ports 5000–5003): it does **not** have the fix until someone commits → pushes → pulls on the server → `pm2 reload all`.
- If the app talks to a **local dev backend** (`npm run dev` / nodemon): it auto-reloads on save, so it may already be live — but you must **tap "Pay by Wallet" again** to test. The banner in a screenshot is often left over from the previous failed attempt, not a new one.

### Backend restart steps (give to whoever owns the server)
```bash
# on the server, in the repo root
git pull
pm2 reload all        # reloads all 4 zicab-api instances
pm2 logs --lines 50   # watch for errors
```
For a local dev box, just restart `npm run dev --prefix Backend` (nodemon usually does this automatically).

---

## 5. How to verify it's fixed (test checklist)

Do this **after** the backend is restarted/redeployed.

**On the device / WebView:**
1. Log in as a **driver** whose wallet balance is **≥ ₹199**.
2. Open **Daily Subscription**.
3. Tap **"Pay ₹199 by Wallet"**.
   - ✅ Expected: purchase succeeds, the pass becomes **active**, wallet balance drops by ₹199, and a wallet transaction appears in history. **No red error banner.**
4. Tap **"Pay ₹199 by UPI / Card"** (regression check).
   - ✅ Expected: still works exactly as before (opens the gateway).
5. Edge case — driver with **less than ₹199** in wallet taps **Pay by Wallet**.
   - ✅ Expected: a clean message **"Not enough wallet balance"** — **not** the `Transaction numbers...` error.

**WebView tip:** if the screen looks stale after redeploy, **pull-to-refresh / clear the WebView cache** so it loads fresh. (The fix is server-side, but clearing cache rules out an old page.)

---

## 6. API reference (for your network inspection / logs)

Base URL: `/api/v1` · Auth: `Authorization: Bearer <driverToken>`

| Method | Endpoint | Purpose |
|---|---|---|
| `GET`  | `/drivers/subscription` | Current pass status + buyable plans |
| `POST` | `/drivers/subscription/purchase` | Buy a pass |
| `GET`  | `/drivers/subscription/history` | Past purchases |

**Purchase request body:**
```json
{ "planId": "<plan _id>", "paymentMethod": "wallet" }
```
`paymentMethod` is `"wallet"` | `"razorpay"` | `"phonepe"`.

**Purchase success response (wallet):**
```json
{
  "success": true,
  "data": {
    "subscription": { "...": "the new pass" },
    "requiresPayment": false,
    "amount": 199,
    "status": { "...": "fresh subscription status" }
  }
}
```
For `razorpay`/`phonepe`, `requiresPayment` is `true` and the app completes payment through the gateway, then the pass is activated on verification.

**Before the fix, the wallet purchase returned an error** whose message contained `Transaction numbers are only allowed on a replica set member or mongos`. If you ever see that string again in a response, the backend serving that request is **still running the old code** — it is not a Flutter issue.

---

## 7. One honest caveat

The code fix is in place and compiles cleanly, but it has **not yet been run against a live database with a real driver wallet**. Step 5 above is the actual end-to-end confirmation — please run it once on a restarted instance.
