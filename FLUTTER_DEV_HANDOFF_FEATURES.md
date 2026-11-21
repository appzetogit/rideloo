# Flutter Developer Handoff — New Features & Fixes

What changed, what you (the Flutter dev) must do, and what is "web only". Base URL: `https://app.rideloo.com/api/v1`. Auth header: `Authorization: Bearer <token>`.

> **Hindi (short):** Ye apps React (web) hain jo **Flutter WebView** ke andar chalti hain. Zyada features web layer me already ban chuke hain — unke liye sirf **admin panel / app ka naya build deploy** karna hai, Flutter me naya code nahi. Sirf **Cashfree payment (#5)** ke liye asli native Flutter SDK ka kaam hai. **Abhi tak kuch bhi deploy/commit nahi hua** — pehle backend + frontend build deploy hoga, tab features dikhenge.

---

## 0. Architecture reminder (read first)
- The **user app, driver app, and admin panel are React (Vite) web apps** served from the backend, each shown inside a **Flutter WebView shell**.
- So most "features" live in the **web build**, not in Dart. To ship them you **rebuild the web app and deploy** — the WebView then shows them. No Dart change needed for those.
- **Native Flutter work is only needed where a web page can't do the job** — right now that's the **Cashfree payment SDK (#5)**. Push notifications (optional, for #2/#6 when the app is backgrounded) are the other place native helps.
- **Real-time** features use **Socket.IO** (same socket the apps already use). Events are listed in section 7.

**Nothing below is deployed yet.** Current state = code is written on the server-side repo and web source; it must be committed, the backend deployed, and the web apps rebuilt+deployed before anything is visible.

---

## 1. Admin sees the ride OTP in the trip request — ✅ web only (admin panel)
- The admin Trips screen now shows the **Ride OTP** and the dispatch list inside a trip's details.
- **Backend:** admin ride rows now include `otp` and a `dispatch` object.
- **Flutter action: none.** This is the admin panel (web). Just deploy the rebuilt admin panel.

## 2. Admin popup + sound on a new trip — ✅ web only (admin panel), optional native push
- When a new trip is created the backend emits a socket event and the admin panel shows a **toast + plays a chime** and bumps the unread counter.
- **Backend event:** `new_trip` (admin socket) with `{ rideId, user, pickup, drop, fare, otp, ... }`.
- **Flutter action: none for the in-panel popup.** *Optional:* if the admin uses a wrapped app and should be alerted while backgrounded, add a **push notification** mirroring `new_trip` (FCM). Not required for the web popup.

## 4. Admin sees which drivers the request went to / who rejected — ✅ web only (admin panel)
- Trip details now show **"Request sent to (N)"** and **"Rejected by (N)"** (rejected drivers struck through).
- **Backend:** the `dispatch` object on each ride row carries `notifiedDrivers`, `rejectedDrivers`, `lastAttemptAt` (with driver name/phone/vehicle).
- **Flutter action: none.** Admin panel only.

## 3. Fake / simulated-availability drivers in the user app — ❌ NOT built (by decision)
- Showing drivers who aren't actually online is a deceptive pattern, so this was **intentionally not implemented**.
- If you want visual life on the map, use **clearly decorative** car markers that are not presented as bookable drivers. Ask before building this.

## 6. "Accepted by another driver" popup for other drivers — ✅ web only (driver app)
- When one driver accepts a ride, every **other** driver who got the same request now sees a popup/toast: **"Accepted by another driver"**, and their request card closes.
- **How it works:** the backend emits the existing **`rideRequestClosed`** socket event with **`reason: 'accepted-by-another-driver'`**. The driver web app already handles this reason and shows the toast + clears the request.
- **Flutter action: none for the in-app popup** (handled in the driver web build — just deploy it). *Optional:* a native push for the same, if you want to notify when the app is backgrounded (mirror `rideRequestClosed` + reason).

## 5. Cashfree payment gateway — ⚙️ REAL Flutter work needed
- Cashfree is added **alongside** Razorpay for: driver wallet top-up, user wallet top-up, ride fare, ride completion, and tip.
- This one needs the **native `flutter_cashfree_pg_sdk`** — a web page can't open Cashfree checkout properly.
- **Pattern:** `order (server)` → open SDK with the returned **`paymentSessionId`** → `verify (server)` with `order_id`. Amounts are in **rupees**; `isProduction` picks SANDBOX vs PRODUCTION.
- **Driver "Pay by UPI/Card" for the Daily Subscription** = **Cashfree wallet top-up → then buy the pass by wallet** (`POST /drivers/subscription/purchase` with `paymentMethod: "wallet"`). There is no separate subscription-gateway endpoint.
- 👉 **Full details, endpoints, verify bodies and test steps are in [`CASHFREE_FLUTTER_NOTES.md`](CASHFREE_FLUTTER_NOTES.md).** Read that for #5.
- **Before production:** admin must add **sandbox** Cashfree App ID + Secret in Admin → Payment Gateways, and every flow must be **sandbox-tested**.

---

## 7. Socket.IO events reference (what the apps listen for)

**Driver app** (driver socket):
| Event | Meaning | Payload (key fields) |
|---|---|---|
| `rideRequest` | A ride is offered to this driver | ride details, pickup/drop, fare |
| `rideRequestClosed` | The request is no longer open | `{ rideId, reason }` — reason incl. **`accepted-by-another-driver`**, timeout, cancelled |
| `rideBiddingUpdated` | Rider changed their fare ceiling | bidding info |
| `driver:wallet:updated` | Wallet balance changed | `{ wallet, transaction, notification }` |
| `ride:payment:received` | Rider paid online — don't collect cash | `{ rideId, amount, method, message }` |

**Admin panel** (admin socket, via `emitToAdmins`):
| Event | Meaning |
|---|---|
| `new_trip` | New ride created (**#2** popup + chime) |
| `new_booking` | New delivery/booking |
| `new_sos` / `safety:alert:new` / `safety:alert:updated` | Safety/SOS alerts |
| `rental:tracking:updated` / `rental:tracking:alert` | Rental tracking |

> For **native push** (optional), mirror `new_trip` (admin) and `rideRequestClosed`+reason / `rideRequest` (driver) through FCM so alerts fire when the app is backgrounded. The in-WebView popups work without this.

---

## 8. Deployment checklist (so these actually show up)
1. **Backend:** deploy the updated backend (all the new routes/events + Cashfree). *(Not done yet — currently uncommitted.)*
2. **Admin panel:** rebuild + deploy → gives you **#1, #2, #4**.
3. **Driver web app:** rebuild + deploy → gives you **#6**.
4. **⚠️ Rebuild must keep the Firebase + Google Maps keys** in `.env.production` (a past rebuild dropped them and broke admin maps). Verify maps/login after deploy.
5. **Cashfree (#5):** add sandbox keys in admin → integrate the native SDK per `CASHFREE_FLUTTER_NOTES.md` → **sandbox-test every flow** → only then switch to production keys.

---

## 9. One-line summary per feature
- **#1 OTP in admin trip** — web only, deploy admin panel.
- **#2 New-trip popup** — web only (`new_trip` socket), deploy admin panel; optional FCM push.
- **#3 Fake drivers** — not built (deceptive); decorative-only alternative on request.
- **#4 Dispatch/rejection visibility** — web only, deploy admin panel.
- **#5 Cashfree** — **native SDK work**, see `CASHFREE_FLUTTER_NOTES.md`; subscription online = wallet top-up → pay by wallet.
- **#6 "Accepted by another driver"** — web only (`rideRequestClosed` reason), deploy driver app; optional FCM push.

**Bottom line:** 4 of the 5 built features are **web-build-and-deploy** (no Dart). Only **Cashfree (#5)** needs real Flutter code. Nothing is deployed yet.
