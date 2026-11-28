# Flutter notes: driver logout and push tokens (backend live 28 Nov 2026)

**Backend:** `https://rideloo.com/api/v1` (same server as `https://app.rideloo.com/api/v1`)

## What the backend does now

### 1. `POST /drivers/logout` (new, driver auth)
- Call it with the driver's still-valid access token, **before** you wipe storage. The app already does this.
- Body is optional: `{ "token": "<this device's FCM token>" }`.
  - With `token`: only a stored token that equals it is cleared. Logging out on one phone won't silence the driver's other phone. **Recommended:** send it.
  - Without `token`: both `fcmTokenMobile` and `fcmTokenWeb` are cleared.
- What it does: `isOnline=false`, `socketId=null`. It closes the online session for incentives and today's summary, the same as `PATCH /drivers/offline`. It clears the token and disconnects every live socket of this driver.
- Response `200`: `{ "success": true, "data": { "message": "Logged out" } }`
- **`409`** if the driver is on a ride: `"Finish or cancel your current ride before logging out"`. Show that message and don't log out. If you log out locally anyway, the token dedupe below still protects the next login.
- You can stop calling `PATCH /drivers/offline` before logout, because logout already does it. Keeping it is harmless.

### 2. Token dedupe on save (works for old builds too)
`POST /drivers/fcm-token` and `POST /users/fcm-token` now remove the same token from **every other account**: other drivers, riders, owners, bus drivers and so on. So after driver B logs in on A's phone and saves the token, A no longer has it, even if A's logout call never reached the server.
- **App requirement:** after every login, call `fcm-token` with the current token, even if it hasn't changed. This call is what moves the token to the new account.

### 3. `driverId` in the `ride_request` push
The data payload now has `driverId` (string) next to `rideId`.

**Native guard to add (in `RideRequestMessagingService`):**
```kotlin
val target = data["driverId"]
val current = /* driver id saved by setDriverSession */
if (target.isNullOrEmpty() || current.isNullOrEmpty() || target != current) {
    return // the offer is not for the driver logged in on this phone
}
```
If no driver is logged in (session cleared), don't show the card.
Clear the stored driver id in `setDriverSession` on logout.

## Rider app
- Nothing new is needed on the server side. Rider logout doesn't need an endpoint, because the dedupe in `POST /users/fcm-token` covers it.
- Same rule: after login, always call `POST /users/fcm-token`.

## Not done (on purpose)
- **Heartbeat / grace timer** (taking a driver offline when there is no socket): not added. The driver app shows the native card from push even when it is killed. If the server required a live socket, those drivers would stop getting rides. Please tell us: does the driver app keep sending location in the background (when killed or locked)? If yes, a 15–30 minute "last location" check can be added safely.

## Test checklist
1. A logs in → online → logout. A's token is cleared, A is offline, A's socket is disconnected.
2. B logs in on the same phone and the app saves the token. Only B has the token.
3. Dispatch a ride near the phone. Only B gets the offer. If A's push arrives (old data), the `driverId` guard hides it.
4. Turn off the internet, log out, turn it back on, then log in as B. The token is still removed from A through the save call.
