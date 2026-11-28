# Indore Zone Fix (Seed-Zone Cleanup) — Flutter Developer Notes

**Status:** Done on production (`app.rideloo.com`, DB `zicab`). **No Flutter/app code change is
required** — this was a backend data + scripts fix. API contracts are unchanged. This note tells the
mobile team what changed, why, and what to verify from the app.

**Hindi (short):** Indore ka pickup pehle ek galat chhoti "Static Seed Zone" pe resolve ho raha tha
jiska koi fare/pricing nahi tha — isliye Indore me dispatch/pricing inconsistent thi. Ab wo zone
hata (deactivate) diya; Indore pickup ab asli `indore` zone pe jaata hai (sahi fares + 20% commission).
**App me kuch badalna nahi hai** — bas Indore me ek ride book karke confirm kar lena.

---

## 1. What was wrong

A pickup in Indore `[75.884, 22.728]` fell inside **two** zones:

| Zone | Size | Pricing |
|---|---|---|
| `indore` (real) | ~100 km polygon | Has all the setprices (fares + commission) |
| `Static Seed Zone` (test) | ~11×11 km box | **No setprices at all** |

Dispatch resolves a pickup to the **smallest** containing zone
(`matchingService.pickMostSpecificZone`), so every Indore pickup resolved to the tiny seed zone —
which has no fare config. Result: inconsistent dispatch/pricing, and test drivers stuck in a zone with
no setprices.

## 2. What was changed (backend + DB only)

- **DB:** the 2 seed-zone drivers were moved to the `indore` zone; the `Static Seed Zone` and its seed
  service location were **deactivated** (`active:false, status:"inactive"`). `findZoneByPickup`
  ignores inactive zones, so Indore pickups now resolve to `indore` only. (Deactivated, not deleted —
  reversible.)
- **Code (`Backend/scripts/upsertStaticDriver.js`, `upsertDriverByPhone.js`):** these seed/demo
  scripts used to always create the tiny shadow zone. They now reuse the real covering zone first and
  only create the box on an empty DB — so the shadow zone can't come back on the next script run.

**None of this changes any endpoint, request, response, or socket event.**

## 3. Impact on the app — effectively none

- No API/socket changes. No new fields. Nothing to rebuild on the app side for this fix.
- Behavioural improvement only: a driver in Indore is now matched against the correct `indore` zone,
  and rides there price off Indore's setprices (fares + the 20% driver commission). Before, Indore
  pickups hit a zone with no pricing.
- The app already sends pickup coordinates and reads fares/driver data from the API as before — the
  server just resolves the right zone now.

## 4. How pickup → zone → pricing works (for context)

1. User app sends pickup coordinates when booking.
2. Backend resolves the **smallest active zone** whose polygon contains the pickup (`findZoneByPickup`
   → `pickMostSpecificZone`). Inactive zones are skipped.
3. That zone (+ its service location) drives which **setprice** row is used — fares, waiting charges,
   and the driver commission %.
4. Drivers are matched within that zone; commission is applied at completion (see
   `DRIVER_SUBSCRIPTION_COMMISSION_FLOW.md`).

So "which zone a pickup lands in" directly decides fares, commission, and which drivers get the offer.
The app doesn't choose the zone — it just sends coordinates.

## 5. What the app dev should verify

1. Book a cab in the user app with an **Indore** pickup.
2. A driver who is online in Indore should receive the ride offer (dispatch works).
3. The fare estimate should appear normally (Indore setprices resolve).
4. Complete the trip → commission behaves per the hybrid model (pass → 0%, no-pass → 20%).

No special build or flag — just a normal booking flow in Indore.

## 6. Related app-adjacent item (NOT fixed here, worth knowing)

- **Stale `isOnline`:** when the driver app closes/disconnects, the backend clears the driver's
  `socketId` but **not** `isOnline`. So a driver who closed the app can still read as online in the DB
  for a while. This can make a "ghost" driver appear online / get a push for an offer the socket can't
  deliver. If the mobile team wants a clean offline-on-background behaviour, the app should explicitly
  call the offline endpoint (or the backend should clear `isOnline` on socket disconnect). Flagged for
  a future fix; not part of this change.

## 7. Reference

- Backend commit: `fix(scripts): seed scripts reuse the real zone instead of a shadow zone`
  (`1c236cc`).
- Files: `Backend/scripts/upsertStaticDriver.js`, `Backend/scripts/upsertDriverByPhone.js`.
- Related: `DRIVER_SUBSCRIPTION_COMMISSION_FLOW.md`, `HYBRID_SUBSCRIPTION_FLUTTER_NOTES.md`.
