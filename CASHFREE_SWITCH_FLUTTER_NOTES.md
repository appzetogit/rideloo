# Cashfree is now the payment gateway (28 Nov 2026)

**Backend:** `https://rideloo.com/api/v1`
**Status:** Cashfree **test (sandbox)** mode is active. Razorpay is turned off; its keys are still saved in admin, so it can be turned back on.

## 1. Which gateway is on
`GET /common/payment-gateway` (public) now returns:
```json
{ "activeGateway": { "slug": "cashfree", "label": "Cashfree",
  "supportsWalletTopUp": true, "walletTopUpMode": "cashfree_checkout",
  "supportsRentalAdvance": false, "rentalAdvanceMode": "unsupported" } }
```
The app should choose its checkout from `slug` / `walletTopUpMode`, not hardcode Razorpay. When `supportsRentalAdvance` is false, hide online payment for the rental advance.

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
| Tip only | `POST /rides/:rideId/tip/cashfree/order` | `POST /rides/:rideId/tip/cashfree/verify` |

## 4. If the app closes mid-payment
For wallet top-ups (rider and driver), Cashfree's webhook now credits the wallet on the server, even if the app never calls verify. The app only needs to refresh the balance when it opens again. For ride payments, verify is still required.

## 5. Not available with Cashfree yet
- **Rental advance:** only Razorpay/PhonePe routes exist, so `supportsRentalAdvance` is false.
- **Driver subscription by gateway:** only Razorpay/PhonePe. Drivers can still pay the subscription from the wallet. Tell us if a Cashfree subscription payment is needed.

## 6. Testing (sandbox)
In the Cashfree sandbox checkout, choose **Net Banking**, pick any bank, enter OTP `111000` on the simulator page and choose **SUCCESS**. No real money is involved.

> ⚠️ Before launch, live Cashfree keys must be added in admin and the environment set to `production`. In test mode any sandbox payment credits the wallet for real.
