# Ride Start OTP (PIN) Enforcement — Flutter Developer Notes

**Status:** Implemented on backend + web driver app. **Not yet deployed / not yet run against a
live DB.** Deploy backend and frontend **together** (see §8).

**Hindi (short):** Ride start karne wala 4-digit OTP ab **server pe verify** hota hai. Driver
app ko OTP **bheja hi nahi jaata** — driver ko wahi PIN passenger se poochhna hai jo passenger
ke app me dikh raha hai, aur galat PIN se trip start **nahi** hogi. Pehle OTP sirf driver app ke
andar check hota tha (bypass ho jaata tha) — ab ye hole band hai.

---

## 1. Why this changed (the problem)

Earlier the start OTP was **only checked inside the driver app's JavaScript**, and the backend
sent the correct OTP to the driver inside the ride payload. So:

- Any OTP (or no OTP) could start a trip via a direct API/socket call — the server never checked.
- The driver's own API response literally contained the correct PIN, so the client check was
  cosmetic.

**Now:** the PIN is verified on the **server**, the PIN is a **fresh random 4-digit code per
trip**, and the PIN is **never sent to the driver app**. The driver must get it from the
passenger at pickup.

---

## 2. The contract in one line

> To move a (non-parcel) ride to **`started`**, the driver app must send the 4-digit PIN the
> passenger reads from their app. The server compares it to the ride's PIN and returns `403` if
> it is wrong. Parcels are unaffected (they use pickup photo proof, not a PIN).

---

## 3. What the DRIVER app must do

### 3a. Starting the trip (REST — recommended)

`PATCH /api/v1/rides/:rideId/status`

Headers: `Authorization: Bearer <driverToken>`

Body:

```json
{
  "status": "started",
  "otp": "1234"
}
```

- `otp` = the 4 digits the driver typed in (collected from the passenger).
- Only required for `status: "started"` on normal rides. For `accepted` / `arriving` / `arrived` /
  `completed`, keep sending your existing body (no `otp` needed).

**Success:** `200 OK`

```json
{ "success": true, "data": { "rideId": "...", "status": "ongoing", "liveStatus": "started", ... } }
```

On success, advance the UI to the in-trip screen.

**Failures (do NOT advance the screen; show the message):**

| HTTP | `message` | Meaning | What to show the driver |
|---|---|---|---|
| `403` | `Incorrect start PIN` | Wrong PIN | "Wrong PIN. Ask the passenger for the PIN shown in their app." |
| `429` | `Too many incorrect PIN attempts. Ask the passenger to re-share the PIN.` | 5 wrong tries on this ride | "Too many wrong attempts." (see §7 caveat) |
| `409` | `This ride has no start PIN` | Data issue (shouldn't happen) | Generic error, retry/support |
| `400` | `status must be accepted, arriving, started, arrived, or completed` | Bad `status` value | Fix the request |
| `409` | `Ride cannot move from <x> to <y>` | Illegal transition | Refresh ride state |

Error body shape is always:

```json
{ "success": false, "message": "Incorrect start PIN" }
```

### 3b. Starting the trip (Socket alternative)

If you start via socket instead of REST, include `otp` in the payload:

```
emit "ride:status:update"  { rideId, status: "started", otp: "1234" }
```

A rejected PIN comes back on the **`errorMessage`** socket event: `{ "message": "Incorrect start PIN" }`
(socket errors do not carry an HTTP status code). **Recommendation: use the REST endpoint for
`started`** because you get a clean status code (403/429) to branch on. Do **not** send both REST
and socket for `started` — the second call re-runs the PIN check and will fail.

### 3c. The driver app must NOT expect the PIN anymore

The PIN is intentionally stripped from every driver-facing payload. In all of these the `otp`
field is now an empty string `""` for a driver token:

- `GET /rides/active/me`
- `GET /rides` (history)
- `GET /rides/:rideId`
- `ride:state` socket payloads (shared ride room)
- the Firebase Realtime DB mirror

**Action for Flutter:** remove any code that reads/pre-fills/compares the OTP on the driver side.
The OTP input is a blank 4-box field the driver fills from what the passenger tells them; you do
**not** validate it locally — submit it and trust the server's response.

---

## 4. What the PASSENGER (rider) app shows — unchanged

The rider app still receives the PIN (only the rider role does). The rider sees it on the
searching / tracking screen and reads it aloud to the driver at pickup. Rider-side sources
(`GET /rides/active/me` with a user token, the user-room `rideAccepted` / `ride:state` events, and
the create-ride response) are unchanged. If your passenger app is also native Flutter, no change is
needed there — just confirm the PIN still displays.

---

## 5. Dart / Dio example (driver start)

```dart
Future<void> startTrip({required String rideId, required String pin}) async {
  if (pin.trim().length != 4) {
    throw Exception('Enter the full 4-digit PIN.');
  }
  try {
    await dio.patch(
      '/rides/$rideId/status',
      data: {'status': 'started', 'otp': pin.trim()},
      options: Options(headers: {'Authorization': 'Bearer $driverToken'}),
    );
    // Success → navigate to the in-trip screen.
  } on DioException catch (e) {
    final code = e.response?.statusCode;
    final msg = e.response?.data is Map ? e.response?.data['message'] : null;
    if (code == 403) {
      throw Exception('Wrong PIN. Ask the passenger for the PIN shown in their app.');
    } else if (code == 429) {
      throw Exception('Too many wrong attempts. Ask the passenger to re-share the PIN.');
    } else {
      throw Exception(msg ?? 'Could not start the trip. Please try again.');
    }
  }
}
```

Riverpod/bottom-sheet widgets follow the same pattern as the cancellation-reasons notes: collect 4
digits, call `startTrip`, show the thrown message under the PIN field, clear the field on error.

---

## 6. Behaviour rules (server-side — for your reference)

- **Per-trip PIN:** every ride gets a fresh random 4-digit PIN (`resolveRiderOtp`). It is not the
  same across a rider's trips anymore.
- **Only non-parcel rides** enforce the PIN. Parcels (`serviceType === "parcel"`) are gated by the
  pickup photo proof instead — their displayed "OTP" is a cosmetic client-side number and is not
  checked. Do not send `otp` as a start gate for parcels; keep the photo-upload step.
- **Attempt cap:** 5 wrong PIN attempts on a ride → `429`. The counter resets only on a correct
  PIN (see §7).
- **Only the assigned driver** can start the ride (enforced independently of the PIN).

---

## 7. Known rough edge — attempt cap ⚠️

The 5-wrong-attempt cap is a **hard lock** for that ride: once hit, `started` keeps returning `429`
and the PIN does not change, so re-sharing the same PIN still fails. A clumsy driver + honest
passenger could get stuck. This may be **loosened** (higher cap, or a cooldown instead of a
permanent block) before release — confirm the final number/behaviour with the backend team before
wiring your "too many attempts" UX copy.

---

## 8. Deployment / rollout

- Deploy **backend and the web frontend together.** An old driver build that does not send `otp`
  will get `403` on start.
- Because the driver/rider/admin apps are the React/Vite web build rendered in the Flutter WebView,
  **the driver OTP screen itself is the web screen (`ActiveTrip.jsx`) and is already updated** — it
  ships by rebuilding + redeploying the web app, no Dart change required **unless** your Flutter app
  has its own native OTP-entry screen. If it does, implement §3 there.
- **Preserve the `.env.production` keys on rebuild** (Firebase + Google Maps) — a past rebuild
  dropped them and broke maps. Not related to this change, but applies to every web redeploy.

---

## 9. Test checklist

1. Correct PIN → trip starts (REST and, if used, socket).
2. Wrong PIN → `403`, trip stays `arriving`, no `startedAt`.
3. Empty / missing `otp` → rejected.
4. Direct `curl` with a wrong/empty PIN → rejected (proves server-side enforcement).
5. Driver `GET /rides/active/me`, `GET /rides/:id`, and `ride:state` → `otp` is `""`.
6. Passenger app still shows the PIN; admin ride detail still shows the PIN.
7. 5 wrong attempts → `429` (confirm final cap/behaviour per §7).
8. Parcel delivery still starts via pickup photo, no PIN needed.
9. Two different rides → different PINs.

---

## 10. Files changed (reference)

Backend:
- `Backend/src/modules/taxi/services/rideService.js` — per-trip PIN (`resolveRiderOtp`), PIN check
  in `updateRideLifecycle` (STARTED), `serializeRideRealtime` `includeOtp` option (default off),
  history serializer role-gates `otp`.
- `Backend/src/modules/taxi/user/models/Ride.js` — new `otpAttempts` field.
- `Backend/src/modules/taxi/user/controllers/rideController.js` — `updateRideStatus` passes `otp`;
  `getRideById` strips `otp` for non-riders; `getMyActiveRide` includes `otp` only for the rider.
- `Backend/src/modules/taxi/socket/handlers/rideSocketHandler.js` — status handler passes `otp`;
  `ride:state` emits include `otp` only to the rider's own socket.

Web frontend (driver screen in WebView):
- `frontend/src/modules/driver/pages/ActiveTrip.jsx` — submits the typed PIN to the server, advances
  only on success, shows 403/429 messages; no longer knows or compares the PIN locally.
