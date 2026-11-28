# Rideloo: Flutter developer handoff (28 Nov 2026)

Everything the rider and driver apps need from the latest backend changes, in one place.

- **Base URL:** `https://rideloo.com/api/v1` (`https://app.rideloo.com/api/v1` is the same server)
- **Auth:** `Authorization: Bearer <token>` on every call marked 🔒
- **Test OTP mode is on:** every number logs in with OTP `1234`. This will be turned off before launch.

### Contents
1. [Payments: Cashfree is now the gateway](#1-payments-cashfree-is-now-the-gateway)
2. [Common Cashfree flow](#2-common-cashfree-flow-every-payment)
3. [Rider wallet top-up](#3-rider-wallet-top-up)
4. [Driver wallet top-up](#4-driver-wallet-top-up)
5. [Ride payments: end of ride, cash fare online, tip](#5-ride-payments)
6. [Rental advance + booking (⚠️ breaking change)](#6-rental-advance--booking-️-breaking-change)
7. [When the app closes mid-payment](#7-when-the-app-closes-mid-payment)
8. [Driver logout + push notifications](#8-driver-logout--push-notifications)
9. [SOS button](#9-sos-button)
10. [Other pending app-side items](#10-other-pending-app-side-items)
11. [Testing checklist](#11-testing-checklist)
12. [What changed for the app (quick list)](#12-what-changed-for-the-app-quick-list)

---

## 1. Payments: Cashfree is now the gateway

Razorpay is **off**. Cashfree is on, in **test (sandbox)** mode. Admin can change the gateway at any time, so the app must **never hardcode a gateway**.

### `GET /common/payment-gateway` (public)
```json
{
  "success": true,
  "data": {
    "activeGateway": {
      "slug": "cashfree",
      "label": "Cashfree",
      "supportsWalletTopUp": true,
      "walletTopUpMode": "cashfree_checkout",
      "supportsRentalAdvance": true,
      "rentalAdvanceMode": "cashfree_checkout",
      "supportsRidePayment": true,
      "ridePaymentMode": "cashfree_checkout"
    }
  }
}
```

| Feature | Flag | Mode → what to open |
|---|---|---|
| Wallet top-up (rider and driver) | `supportsWalletTopUp` | `walletTopUpMode` |
| Rental advance | `supportsRentalAdvance` | `rentalAdvanceMode` |
| Pay a ride online (end of ride, cash fare, tip) | `supportsRidePayment` | `ridePaymentMode` |

Mode values:
- `cashfree_checkout`: the Cashfree SDK (this document).
- `razorpay_checkout`: the old Razorpay flow.
- `phonepe_redirect`: PhonePe.
- `unsupported`: hide online payment for that feature.

Fetch this when the app starts (and before every payment screen). Don't cache it for long.

---

## 2. Common Cashfree flow (every payment)

SDK: [`flutter_cashfree_pg_sdk`](https://pub.dev/packages/flutter_cashfree_pg_sdk).

```
App                          Backend                         Cashfree
 |  POST .../cashfree/order     |                                 |
 |----------------------------->|  create order (tags, notify_url)|
 |                              |-------------------------------->|
 |  {orderId, paymentSessionId, |                                 |
 |   isProduction, amount}      |                                 |
 |<-----------------------------|                                 |
 |  SDK checkout(sessionId, orderId, env)                         |
 |--------------------------------------------------------------->|
 |  (success / failure / user closed)                             |
 |<---------------------------------------------------------------|
 |  POST .../cashfree/verify {order_id}                           |
 |----------------------------->|  read order status from Cashfree|
 |  200 paid / 400 not paid     |                                 |
 |<-----------------------------|                                 |
```

### Rules
1. **Environment:** `isProduction ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX`. It comes from the order response. Never hardcode it.
2. **Always call verify** after the SDK returns, **whether the result is success, error or user cancel**. Only the server's answer counts. An SDK "success" alone is not proof of payment.
3. **Verify is idempotent.** Calling it twice never charges or credits twice. A repeat call gets the same result.
4. If verify says `400 "Payment not completed (status: ACTIVE)"`, the payment did not go through. Show a failure and let the user retry with a **new** order.
5. Don't reuse a `paymentSessionId`. Create a new order for every attempt.

### SDK sketch
```dart
final session = CFSessionBuilder()
    .setEnvironment(order.isProduction ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX)
    .setOrderId(order.orderId)
    .setPaymentSessionId(order.paymentSessionId)
    .build();

final payment = CFWebCheckoutPaymentBuilder().setSession(session).build();

cfPaymentGatewayService.setCallback(
  (orderId) => verify(orderId),                 // success
  (error, orderId) => verify(orderId),          // failure or closed: still verify
);
cfPaymentGatewayService.doPayment(payment);
```

### Common errors
| HTTP | Message | Meaning |
|---|---|---|
| 400 | `Payment not completed (status: ACTIVE)` | Not paid (or still pending) |
| 403 | `This payment does not belong to your account` | The order belongs to another account |
| 409 | `This payment is being processed. Please try again in a moment.` | Verify and webhook arrived together. Retry after 1–2 s |
| 500 | `Cashfree is not configured...` | Admin hasn't saved the keys |

---

## 3. Rider wallet top-up

🔒 `POST /users/wallet/cashfree/order`
```json
// request
{ "amount": 100 }
// response 200
{ "success": true, "data": {
  "gateway": "cashfree", "orderId": "uwalcf_129ef5ac_mx0ckzna",
  "paymentSessionId": "session_…", "amount": 100, "currency": "INR", "isProduction": false } }
```

🔒 `POST /users/wallet/cashfree/verify`
```json
// request
{ "order_id": "uwalcf_129ef5ac_mx0ckzna" }
// response 200 (same shape as GET wallet)
{ "success": true, "data": { "balance": 271, "currency": "INR", "recentTransactions": [ … ], "alreadyCredited": false } }
```
`alreadyCredited: true` means the webhook had already added the money. Just show the new balance.

---

## 4. Driver wallet top-up

🔒 `POST /drivers/wallet/top-up/cashfree/order`, body `{ "amount": 200 }`. The response has the same shape as the rider's (`orderId`, `paymentSessionId`, `isProduction`, …).
- Admin's minimum top-up applies. Below it you get `400 "Minimum top-up amount is Rs X"`.

🔒 `POST /drivers/wallet/top-up/cashfree/verify`, body `{ "order_id": "dwalcf_…" }`
```json
{ "success": true, "data": { "wallet": { "balance": 302, … }, "transaction": { … }, "alreadyCredited": false } }
```

Driver subscription: there is no separate Cashfree route. The driver tops up the wallet with Cashfree and buys the subscription from the wallet.

---

## 5. Ride payments

All of these are 🔒 rider calls. `:rideId` is the ride's id.

### 5a. Pay at the end of the ride (fare + optional tip + rating)
- **Order:** `POST /rides/:rideId/complete-payment/cashfree/order`
  ```json
  { "rating": 5, "comment": "Great ride", "tipAmount": 10 }
  ```
  ⚠️ **Send `rating` and `comment` here too**, not only in verify. If the app closes after paying, the server uses them to finish the ride from the webhook.
  Response: `orderId`, `paymentSessionId`, `isProduction`, `fare`, `fareDue`, `tipAmount`, `totalCharge`.
- **Verify:** `POST /rides/:rideId/complete-payment/cashfree/verify`
  ```json
  { "order_id": "ucmpcf_…", "rating": 5, "comment": "Great ride", "tipAmount": 10 }
  ```
  Response: the full ride details.

### 5b. Cash ride: pay the fare online instead of cash
- **Order:** `POST /rides/:rideId/fare-payment/cashfree/order` (no body). Response includes `fare`.
- **Verify:** `POST /rides/:rideId/fare-payment/cashfree/verify` with `{ "order_id": "ufarecf_…" }`
- The driver gets the socket event `ride:payment:received`: "Rider paid Rs X online. Do not collect cash."

### 5c. Tip only
- **Order:** `POST /rides/:rideId/tip/cashfree/order`
  ```json
  { "tipAmount": 20, "rating": 4, "comment": "Thanks" }
  ```
  ⚠️ Send `rating` and `comment` here too (same reason as 5a).
- **Verify:** `POST /rides/:rideId/tip/cashfree/verify` with `{ "order_id": "utipcf_…", "tipAmount": 20, "rating": 4, "comment": "Thanks" }`

---

## 6. Rental advance + booking (⚠️ breaking change)

### What changed
Before, `POST /users/rental-bookings` with `paymentStatus: "paid"` was stored **without any check**. Now the server checks the advance payment itself. **Without valid proof the booking is refused.**

### Flow with Cashfree
1. 🔒 `POST /users/rental-advance/cashfree/order`
   ```json
   { "amount": 39.80, "bookingReference": "RNT-ABC123", "vehicleId": "<rentalVehicleTypeId>" }
   ```
   Response: `orderId`, `paymentSessionId`, `isProduction`, `bookingReference`.
   **Use the same `bookingReference` in the booking call (step 3).**
2. SDK checkout, then 🔒 `POST /users/rental-advance/cashfree/verify` with `{ "order_id": "urntcf_…" }`
   ```json
   { "success": true, "data": { "provider": "cashfree", "status": "paid", "amount": 39.8,
     "orderId": "urntcf_…", "paymentId": "urntcf_…", "bookingReference": "RNT-ABC123" } }
   ```
3. 🔒 `POST /users/rental-bookings`, the same body as before, plus `payment`:
   ```json
   {
     "vehicleTypeId": "…",
     "bookingReference": "RNT-ABC123",
     "paymentStatus": "paid",
     "paymentMethod": "online",
     "selectedPackage": { "id": "bike-2h" },
     "pickupDateTime": "…", "returnDateTime": "…",
     "payment": { "provider": "cashfree", "orderId": "urntcf_…" }
   }
   ```
   Passing the whole verify response as `payment` also works.

### `payment` per method
| Method | `payment` object | Before the booking |
|---|---|---|
| Cashfree | `{ "provider": "cashfree", "orderId": "urntcf_…" }` | Order + verify (above) |
| Wallet | `{ "provider": "wallet" }` | 🔒 `POST /users/rental-advance/wallet` `{ amount, bookingReference }` with the **same** `bookingReference` |
| Razorpay | `{ "provider": "razorpay", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }` | Razorpay flow |
| PhonePe | `{ "provider": "phonepe", "merchantTransactionId" }` | PhonePe flow |

### Errors
| HTTP | Message |
|---|---|
| 400 | `Advance payment could not be verified: unknown payment provider` (no `payment.provider`) |
| 400 | `Advance payment could not be verified: payment status is ACTIVE` (not paid) |
| 400 | `Advance payment could not be verified: Rs X was paid but the advance due is Rs Y` |
| 400 | `Advance payment could not be verified: this payment is not a rental advance of this account` |
| 409 | `This payment is already used for another rental booking` |

The advance due is worked out by the server: package price × the vehicle's advance setting. The paid amount must be at least that.

### If the app closes after paying, before the booking
The paid order shows up for admin under **Payments → Unmatched rental advances**. Admin can refund it or make the booking. When the app reopens, you can check the order with the status API (section 7). If it is `PAID` and you still have the booking details, call the booking API again with the same `payment` and `bookingReference`.

---

## 7. When the app closes mid-payment

The server now settles these through **Cashfree's webhook**, even if the app never calls verify:

| Payment | Settled by the webhook? |
|---|---|
| Rider wallet top-up | ✅ wallet credited |
| Driver wallet top-up | ✅ wallet credited |
| End of ride (5a) | ✅ ride finished (if `rating` was sent in the order call) |
| Cash fare online (5b) | ✅ |
| Tip (5c) | ✅ (if `rating` was sent in the order call) |
| Rental advance | ❌ the booking needs the app. It goes on admin's report |

### Status API
- 🔒 Rider: `GET /users/payments/cashfree/:orderId/status`
- 🔒 Driver: `GET /drivers/payments/cashfree/:orderId/status` (driver wallet orders only)
```json
{ "success": true, "data": {
  "orderId": "ufarecf_…", "status": "PAID", "paid": true, "amount": 332,
  "purpose": "rider_fare_online", "rideId": "6b06df…" } }
```
`status` values: `ACTIVE` (not paid yet), `PAID`, `EXPIRED`, `TERMINATED`. `purpose` values: `user_wallet_topup`, `driver_wallet_topup`, `ride_completion`, `rider_fare_online`, `ride_tip`, `rental_advance`.

**Suggested:** save `orderId` (+ purpose, rideId) locally when the order is created. When the app reopens, if a saved order is pending, call the status API. If it is `PAID`, refresh the wallet or ride, or call verify (safe). Then clear the saved order.

---

## 8. Driver logout + push notifications

### 🔒 `POST /drivers/logout`
- Call it **before** wiping storage, with the token that is still valid.
- Body (recommended): `{ "token": "<this device's FCM token>" }`. Only this device's token is cleared, so the driver's other phone keeps getting pushes. Without the body, all of the driver's tokens are cleared.
- It does: `isOnline=false`, clears the push token, disconnects the driver's live sockets, and closes the online session (incentives, today's summary).
- `200 { "message": "Logged out" }`
- `409 "Finish or cancel your current ride before logging out"`: show this and don't log out.
- You don't need to call `PATCH /drivers/offline` separately any more.

### FCM token rules (rider and driver)
- After **every login**, call `POST /drivers/fcm-token` / `POST /users/fcm-token` with the current token, even if it hasn't changed. The server then removes that token from **every other account**. This fixes "the previous driver's ride offer arrives on the new driver's phone", including on old app builds and when logout failed offline.

### `driverId` in the ride offer push
`ride_request` data-push now includes `driverId`. Add a guard in the native `RideRequestMessagingService`:
```kotlin
val target = data["driverId"]
val current = /* driver id saved by setDriverSession */
if (target.isNullOrEmpty() || current.isNullOrEmpty() || target != current) return
```
Clear the saved driver id on logout.

### Socket on account switch (still pending)
On logout, `socket.disconnect()`. On login, `socket.connect()` with the new token. Otherwise Accept goes out with the old driver's identity and you get "This ride is for a different vehicle type than yours".

---

## 9. SOS button

- Number: `GET /users/bootstrap` (public, also works with the driver token) → `data.settings.general.contact_phone_1` (then `contact_phone_2`).
- Admin has set **Contact Us Mobile 1 = 7728055304**. Values that are `0000000000` or have fewer than 5 digits are ignored.
- Open the dialer with that number, and still send the alert: rider `POST /users/sos`, driver `POST /drivers/sos` with `{ rideId, location: { lat, lng } }`.

---

## 10. Other pending app-side items

1. **Driver app package name:** needed if Razorpay is ever turned back on (only the user app is approved there).
2. **KYC screen for approved drivers:** old approved drivers get `approve: true`, `status: "approved"` and all documents approved from `GET /drivers/me`, yet still see "KYC Verification - In Progress". Please share the condition the app checks, and the server will be aligned to it.
3. **Earnings screen:** there is no separate API. Use `GET /rides?limit=100` (`driverEarnings`) and `GET /drivers/me` → `todaySummary`. Old drivers' rides are from Aug–Sep, so "today / this week" show ₹0, which is correct.

---

## 11. Testing checklist

**Sandbox payment:** in Cashfree checkout choose **Net Banking**, pick any bank, enter OTP **`111000`** on the simulator page, choose **SUCCESS**, then Submit. No real money moves. Choose FAILED or USER_DROPPED to test failures.

| # | Test | Expected |
|---|---|---|
| 1 | Rider wallet ₹100 → SUCCESS → verify | Balance +100, `alreadyCredited: false` |
| 2 | Verify the same order again | Same balance, `alreadyCredited: true` |
| 3 | Pay, then kill the app before verify, then reopen | Balance already +100 (webhook) |
| 4 | Simulator FAILED → verify | `400 Payment not completed` |
| 5 | Driver wallet top-up | Wallet credited once |
| 6 | Ride end payment with tip + rating | Ride shows paid, feedback saved, driver wallet credited |
| 7 | Cash ride → pay fare online | Driver gets "Do not collect cash" |
| 8 | Rental: order → pay → verify → booking with `payment` | Booking `paymentStatus: "paid"` |
| 9 | Rental booking with `paymentStatus: "paid"` but no `payment` | `400` |
| 10 | Same rental payment for a second booking | `409` |
| 11 | Driver A logout → driver B login on the same phone → ride offer near the phone | Only B gets it |
| 12 | SOS on a live ride | Dialer opens 7728055304, alert in admin |

---

## 12. What changed for the app (quick list)

- [ ] Choose the gateway from `/common/payment-gateway` (`walletTopUpMode`, `rentalAdvanceMode`, `ridePaymentMode`). Don't hardcode Razorpay.
- [ ] Integrate the Cashfree SDK. Take the environment from `isProduction`.
- [ ] Always call verify after the SDK returns, even on failure or cancel.
- [ ] Send `rating` and `comment` in the order call for ride completion and tip.
- [ ] Rental booking: send the `payment` object as proof, with the same `bookingReference`.
- [ ] Save pending `orderId`s and check them with the status API when the app reopens.
- [ ] Driver logout: `POST /drivers/logout` with the device token, and handle `409`.
- [ ] Call `fcm-token` after every login.
- [ ] Add the `driverId` guard in the native ride-offer service.
- [ ] Reconnect the socket on account switch.
- [ ] SOS: open the dialer with `contact_phone_1`.
- [ ] Share the KYC condition and the driver package name.

> ⚠️ Cashfree is in **test mode** right now. Before release, admin will add live keys and set the environment to `production`. No app change is needed for that, because the environment comes from `isProduction`.
