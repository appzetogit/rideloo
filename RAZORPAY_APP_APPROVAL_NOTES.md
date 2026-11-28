# Razorpay: "This payment has failed due to an issue with the merchant"

**Date:** 27 Nov 2026
**Kahan aa raha hai:** Rideloo user app aur driver app (Flutter) mein, wallet top-up aur ride payment par
**Website (`https://rideloo.com`) par:** nahi aana chahiye, kyunki domain approved hai

---

## 1. Kya ho raha hai

1. App server se Razorpay order banwati hai. Server order bana deta hai (`201`).
   Server logs mein ye order bante dikh rahe hain:
   - `POST /api/v1/users/wallet/razorpay/order` → 201
   - `POST /api/v1/drivers/wallet/top-up/razorpay/order` → 201
   - `POST /api/v1/rides/:id/fare-payment/razorpay/order` → 201
2. App Razorpay checkout kholti hai. Popup khulta hai, neeche "Secured by Razorpay" likha aata hai.
3. Razorpay check karta hai ki payment kis app se aa raha hai. Ye app uski approved list mein nahi hai, isliye wo payment options dikhane se pehle hi rok deta hai.
4. Koi bhi payment verify step tak nahi pahunchta. Server ke logs mein `.../razorpay/verify` ki ek bhi call nahi aayi.

**Matlab:** server, keys aur order banna, teeno theek hain. Razorpay live mode mein is app ko permission nahi de raha.

---

## 2. Wajah

Razorpay live mode mein sirf approved website aur app se payment leta hai:

| Kya | Razorpay kis se pehchaanta hai | Abhi approved? |
|---|---|---|
| Website | domain | `https://rideloo.com` ✅ |
| Android app | package name (applicationId) | sirf `com.rideloo.user` ✅, yaani purani app |
| Nayi user app (Flutter) | uska package name | package `com.rideloo.user` na ho to ❌ |
| Driver app (Flutter) | uska package name | ❌ list mein nahi hai |
| `https://app.rideloo.com` | domain | ❌ |

`rideloo.com` par switch karne se sirf website ke payment theek hue hain. App ki pehchaan domain se nahi, package name se hoti hai.

---

## 3. Kya karna hai

### Flutter developer
1. User app aur driver app ka `applicationId` (`android/app/build.gradle`) batayein.
2. Checkout kholte waqt key wahi use karein jo server order ke saath bhejta hai, yaani live key `rzp_live_…3LCl`. App mein koi purani ya test key hardcoded nahi honi chahiye.
3. Do mein se ek raasta chunein:
   - **(a)** Nayi user app ko purani `com.rideloo.user` ke update ke roop mein publish karein. Ye pehle se approved hai.
   - **(b)** Naya package rakhna hai to app ko Play Store par daalein (internal testing bhi chalega) aur uska link Razorpay mein jodein.

### Razorpay dashboard (account owner)
**Account & Settings → Business website details → "+ Add additional website/app"** mein ye jodein:
- Driver app ka Play Store link (zaroori)
- User app ka Play Store link, agar package `com.rideloo.user` se alag hai
- `https://app.rideloo.com` (optional)

Razorpay verification mein **24–48 ghante** lagte hain.

### Wajah pakki karne ke liye
Razorpay dashboard → **Transactions → Payments** mein fail hua payment kholein aur **Error reason** dekhein. "website/app not registered" jaisa kuch likha ho to wajah yahi hai.

---

## 4. Tab tak testing ke liye

- **Website se test:** phone ke Chrome mein `https://rideloo.com/taxi/user` kholein, login karke wallet mein ₹1–10 top-up karein. Ye chalna chahiye. Chal gaya to pakka ho jayega ki sirf app ka approval bacha hai.
- **Test mode:** Admin panel → Third-party settings → Razorpay → environment `test` kar sakte hain. Test key pehle se saved hai. Test mode mein app approval ki shart nahi hoti, aur Razorpay ke test card ya UPI se poora flow check ho jata hai. **Launch se pehle wapas `live` karna zaroori hai.**

---

## 5. Server side ki jaankari (reference)

- Razorpay environment: `live`. Keys admin ki Third-party settings (database) mein hain.
- Payment ke baad return URL: `https://rideloo.com/razorpay/status` (`PUBLIC_FRONTEND_URL`)
- Server callback: `https://app.rideloo.com/api/v1/.../razorpay/callback` (`PUBLIC_BACKEND_URL`)
- Server side kuch badalne ki zaroorat nahi hai.
