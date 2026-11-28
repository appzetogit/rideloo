# Flutter Developer Notes: Razorpay + pending app-side items

**Date:** 27 Nov 2026
**Backend:** `https://app.rideloo.com/api/v1` (`https://rideloo.com/api/v1` also points to the same backend)
**Apps:** User `com.rideloo.user`, Driver (please confirm the applicationId)

---

## 1. Razorpay: "This payment has failed due to an issue with the merchant"

### What was happening
- The app called `POST /users/wallet/razorpay/order` and `POST /drivers/wallet/top-up/razorpay/order`. Orders were created (`201`).
- The `callbackUrl` in the response was built on **`app.rideloo.com`**, which is **not approved** in Razorpay. Only `https://rideloo.com` and `com.rideloo.user` are approved.
- Razorpay refused the payment as soon as checkout opened. Not a single `/razorpay/verify` call reached the server.

### Fixed on the backend (27 Nov) ✅
Order responses now return `callbackUrl` on the approved domain:

```json
// POST /api/v1/users/wallet/razorpay/order -> 201
{
  "keyId": "rzp_live_…3LCl",
  "orderId": "order_XXXX",
  "amount": 10000,
  "currency": "INR",
  "callbackUrl": "https://rideloo.com/api/v1/users/wallet/razorpay/callback"
}
```

Driver top-up: `https://rideloo.com/api/v1/drivers/wallet/top-up/razorpay/callback`

### What the app should do
1. **`key`:** always use `keyId` from the order response. Never hardcode a test or live key. Admin switches live/test from the panel.
2. **`order_id`:** use `orderId` from the response.
3. **`callback_url`:** if you pass it in checkout options (with `redirect: true`), use **only** `callbackUrl` from the response. **Do not build your own URL on `app.rideloo.com`.** If the SDK success callback is enough for you, don't pass `callback_url` at all.
4. **After success,** call verify with all three values from the SDK:
   - User: `POST /users/wallet/razorpay/verify`
   - Driver: `POST /drivers/wallet/top-up/razorpay/verify`
   - Body: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`
5. **Package name:** user app `com.rideloo.user` is approved. The **driver app's package** is not in the Razorpay approved list. Please share it, or its Play Store link, so it can be added to Razorpay. Without that, driver top-ups will keep failing.
6. Live mode only accepts apps published from the Play Store. If you are testing from a sideloaded APK and it still fails, admin can switch Razorpay to `test` from the panel for testing.

### If it still fails
Check the error reason for that payment in Razorpay dashboard → Transactions → Payments (or Orders) and share it. Nothing more needs changing in server code.

---

## 2. Socket stays on the old driver after switching accounts (bug) ⚠️

**Symptom:** After logging out of one driver (e.g. a Bike driver) and logging into another (e.g. a Cab driver), **Accept** on a ride shows *"This ride is for a different vehicle type than yours"*.

**Cause:** Ride offers come over HTTP with the new login. But Accept goes over the **socket**, and the socket is still connected with the **old driver's token**. The server checks Accept against the old driver. Server-side check: the new driver had `socketId: null` and the old driver had a socket.

**Fix:**
- On **logout:** `socket.disconnect()` and clear the token.
- On **login:** `socket.connect()` with the new driver's token (`auth: { token }`).
- If the token changes while the app is open, disconnect and reconnect the socket.

---

## 3. "KYC Verification - In Progress" screen for approved drivers ❓

Old (imported) drivers that are approved still see the KYC screen after login.

What the server sends (`GET /drivers/me`) for these drivers:
- `approve: true`
- `status: "approved"`
- documents `aadhaar`, `rc`, `license` each with `status: "approved"`, `verificationStatus: "approved"`, `reviewStatus: "approved"`

`GET /drivers/document-templates` currently returns `[]`.

**Question:** which field or value does the app check before showing the KYC screen? Please share the condition. The server will be aligned to it. The web driver app sends a driver to home when `approve: true`.

---

## 4. Earnings screen

- No separate earnings API. Earnings come from `GET /rides?limit=100` (completed rides, `driverEarnings`) and `GET /drivers/me` → `todaySummary` (today only).
- Old drivers' rides are from Aug–Sep 2026, so "Today / This week / This month" will show ₹0. That is correct.
- If you want a "Total / all-time" or month picker, it can be built from the same `/rides` list. A summary endpoint can also be added on the backend if needed (say so).

---

## 5. Useful facts
- **Test OTP mode is on:** every number's OTP is `1234`. It will be switched off with real SMS keys before launch.
- **Pending drivers** (`approve: false`) get `403` on `/drivers/wallet` and `/rides`, by design. Test with an approved driver.
- **Ride fare check:** for city rides the server refuses a fare that is far outside the tariff fare (below 0.6× or above 2.5×). Message: *"This fare does not match current prices. Please refresh the fare and try again."* (`400`, `details.expectedFare/minFare/maxFare`). Use the server's tariff (`/users/set-prices`) for the fare.
- **Support tickets:** `titleId` is optional now. For "Other", send `title: "Other: …"`.
