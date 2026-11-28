# Cashfree is now the payment gateway (28 Nov 2026)

**Backend:** `https://rideloo.com/api/v1`
**Status:** Cashfree **test (sandbox)** mode is active. Razorpay is turned off; its keys are still saved in admin, so it can be turned back on.

## 1. Which gateway is on
`GET /common/payment-gateway` (public) now returns:
```json
{ "activeGateway": { "slug": "cashfree", "label": "Cashfree",
  "supportsWalletTopUp": true,  "walletTopUpMode": "cashfree_checkout",
  "supportsRentalAdvance": true, "rentalAdvanceMode": "cashfree_checkout",
  "supportsRidePayment": true,  "ridePaymentMode": "cashfree_checkout" } }
```
Pick the checkout for each feature from its own flag and mode (`walletTopUpMode`, `rentalAdvanceMode`, `ridePaymentMode`). Don't hardcode Razorpay. When a `supports...` flag is false, hide online payment for that feature.

## 2. Flow (same for every Cashfree payment)
1. **Order:** call the `.../cashfree/order` API. The response has `orderId`, `paymentSessionId`, `amount` and `isProduction`.
2. **Checkout:** open the Cashfree Flutter SDK (`flutter_cashfree_pg_sdk`) with `paymentSessionId` and `orderId`. Environment: `isProduction ? PRODUCTION : SANDBOX`. **Don't** hardcode it.
3. **Verify:** whatever the SDK returns (success, failure or the user closing it), call `.../cashfree/verify` with `{ "order_id": orderId }`. Only this server response decides whether the payment counts.
   - `200`: paid. The response has the new balance, and `alreadyCredited: true` if it was already credited.
   - `400 "Payment not completed (status: ACTIVE)"`: not paid. Show a failure message.
   - `403 "This payment does not belong to your account"`: the order belongs to another account.

## 3. APIs
| What | Order | Verify (body: `order_id`) |
|---|---|---|
| Rider wallet top-up | `POST /users/wallet/cashfree/order` `{amount}` | `POST /users/wallet/cashfree/verify` |
| Driver wallet top-up | `POST /drivers/wallet/top-up/cashfree/order` `{amount}` | `POST /drivers/wallet/top-up/cashfree/verify` |
| Pay at end of ride (+tip) | `POST /rides/:rideId/complete-payment/cashfree/order` `{rating, comment, tipAmount}` | `POST /rides/:rideId/complete-payment/cashfree/verify` `{order_id, rating, comment, tipAmount}` |
| Pay a cash ride's fare online | `POST /rides/:rideId/fare-payment/cashfree/order` | `POST /rides/:rideId/fare-payment/cashfree/verify` |
| Tip only | `POST /rides/:rideId/tip/cashfree/order` `{tipAmount, rating, comment}` | `POST /rides/:rideId/tip/cashfree/verify` `{order_id, tipAmount, rating, comment}` |
| Rental advance | `POST /users/rental-advance/cashfree/order` `{amount, bookingReference, vehicleId}` | `POST /users/rental-advance/cashfree/verify` |
| Order status (rider) | — | `GET /users/payments/cashfree/:orderId/status` |
| Order status (driver) | — | `GET /drivers/payments/cashfree/:orderId/status` |

**Important:** for the end-of-ride payment and the tip, send `rating` and `comment` in the **order** call too, not only in verify. The webhook uses them to finish the ride if the app closes.

## 4. If the app closes mid-payment
Cashfree's webhook now settles these payments on the server, even if the app never calls verify:
- rider and driver wallet top-ups
- end-of-ride payment
- a cash fare paid online
- tips

When the app opens again, it can ask `GET .../payments/cashfree/:orderId/status` what happened. The response looks like `{ status: "PAID", paid: true, purpose, rideId, amount }`. Then refresh the balance or the ride. Calling verify again is also safe: it gives the same result and never charges or credits twice.

## 5. Rental booking: the advance is now checked by the server ⚠️
`POST /users/rental-bookings` with `paymentStatus: "paid"` now **requires payment proof** in the `payment` object. The server checks it itself. Before, it accepted "paid" without checking.
- **Cashfree:** `payment: { provider: "cashfree", orderId }`. Send the order from `rental-advance/cashfree` after verify succeeds.
- **Wallet:** `payment: { provider: "wallet" }`. Call `POST /users/rental-advance/wallet` first, with the same `bookingReference`.
- **Razorpay:** `payment: { provider: "razorpay", razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- **PhonePe:** `payment: { provider: "phonepe", merchantTransactionId }`

The paid amount must be at least the advance. One payment can't be used for two bookings (`409`). Without valid proof the booking is refused with `400 "Advance payment could not be verified: …"`. Use the same `bookingReference` in both the order call and the booking call.

## 5b. Still not available with Cashfree
- **Driver subscription by gateway:** only Razorpay/PhonePe. Drivers can still pay the subscription from the wallet, and the wallet can be topped up with Cashfree.

## 6. Testing (sandbox)
In the Cashfree sandbox checkout, choose **Net Banking**, pick any bank, enter OTP `111000` on the simulator page and choose **SUCCESS**. No real money is involved.

> ⚠️ Before launch, live Cashfree keys must be added in admin and the environment set to `production`. In test mode any sandbox payment credits the wallet for real.
