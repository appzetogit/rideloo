import { Router } from "express";
import {
  buySubscription,
  getMySubscription,
  getMySubscriptionHistory,
} from "../controllers/driverSubscriptionController.js";
import { asyncHandler } from "../../../../utils/asyncHandler.js";
import { authenticate } from "../../middlewares/authMiddleware.js";
import { getPendingRideOffers } from "../controllers/rideOfferController.js";
import {
  loginRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
  paymentOrderRateLimit,
} from "../../middlewares/rateLimitMiddleware.js";
import {
  addDriverEmergencyContact,
  completeOnboarding,
  createOwnerBusService,
  cancelOwnerBusBookingSeats,
  createDriverPaymentQr,
  getDriverPaymentUpi,
  saveDriverPaymentUpi,
  handleDriverRazorpayWalletTopupCallback,
  createServiceCenterStaffMember,
  enrollServiceCenterStaffBiometric,
  updateServiceCenterStaffMember,
  createDriverWithdrawalRequest,
  createServiceCenterVehicle,
  captureServiceCenterBookingFingerprint,
  completePoolingOnboardingRequest,
  createOwnerFleetDriver,
  createOwnerPoolingVehicle,
  updateOwnerFleetDriver,
  updateOwnerPoolingVehicle,
  updateOwnerFleetVehicle,
  deleteServiceCenterBookingFingerprint,
  deleteCurrentDriverAccount,
  deleteServiceCenterVehicle,
  deleteServiceCenterStaffMember,
  updateServiceCenterVehicle,
  deleteDriverEmergencyContact,
  claimDriverIncentiveReward,
  goOffline,
  logoutDriver,
  goOnline,
  createBusDriverReservation,
  getBusDriverLiveTrip,
  updateBusDriverSchedules,
  startBusDriverLiveTrip,
  updateBusDriverLiveLocation,
  updateBusDriverLiveTripStatus,
  getCurrentDriver,
  getPoolingDriverBookings,
  getBusDriverSeatLayout,
  listBusDriverBookings,
  getDriverPaymentQrStatus,
  getDriverApprovalStatus,
  getDriverDocumentTemplates,
  getDriverVehicleFieldTemplates,
  getDriverEmergencyContacts,
  getDriverIncentives,
  getDriverNotifications,
  cancelDriverScheduledRide,
  getDriverScheduledRides,
  getServiceCenterBookings,
  getServiceCenterBookingBiometrics,
  getServiceCenterStaffBiometrics,
  getServiceCenterStaffMembers,
  getServiceCenterVehicles,
  listOwnerBusServices,
  getOwnerPoolingVehicles,
  saveDriverFcmToken,
  getOwnerFleetDrivers,
  getOwnerFleetDashboard,
  getOwnerFleetZones,
  getOwnerBusBookingCalendar,
  getOwnerBusBookings,
  getMyWallet,
  getOnboardingSession,
  getOnboardingSignupOptions,
  getServiceLocations,
  loginDriver,
  startDriverLoginOtpRequest,
  startPoolingOnboardingRequest,
  saveOnboardingDocuments,
  saveOnboardingRoleDetails,
  saveOnboardingRole,
  saveOnboardingPersonal,
  saveOnboardingReferral,
  saveOnboardingVehicle,
  verifyOnboardingLicenseDocument,
  verifyOnboardingVehicleRc,
  registerDriver,
  requestDriverAccountDeletion,
    startOnboarding,
    topUpMyWallet,
    createDriverWalletTopupOrder,
    createDriverPhonePeWalletTopupOrder,
    createDriverCashfreeWalletTopupOrder,
    verifyDriverCashfreeWalletTopup,
  verifyDriverWalletTopup,
  verifyDriverPhonePeWalletTopup,
  verifyCurrentDriverBankDetails,
  verifyCurrentDriverBankDocument,
  verifyCurrentDriverUpiDetails,
  verifyCurrentDriverLicenseDocument,
  verifyCurrentDriverGstinDocument,
  verifyCurrentDriverPanDocument,
  verifyCurrentDriverRcDocument,

  updateCurrentDriver,
  updateDriverVehicle,
  updateOwnerBusService,
  updateServiceCenterBookingBiometrics,
  updateServiceCenterBooking,
  verifyServiceCenterBookingFingerprint,
  verifyOnboardingOtp,
  verifyDriverLoginOtpRequest,
  verifyPoolingOnboardingOtpRequest,
  addOwnerVehicle,
  deleteOwnerBusService,
  deleteOwnerPoolingVehicle,
  getOwnerFleetVehicles,
  deleteOwnerFleetVehicle,
  updateCurrentDriverDocument,
  getPoolingOnboardingSessionRequest,
  savePoolingOnboardingDetailsRequest,
  uploadPoolingOnboardingImageRequest,
} from "../controllers/driverController.js";
import { triggerDriverSosAlert } from '../../safety/controllers/safetyController.js';
import { listActiveSurges } from '../../services/surgeService.js';
import { Driver } from '../models/Driver.js';
import { getOpportunityMap } from '../../services/opportunityMapService.js';
import { getPublicCancellationReasons } from '../../admin/controllers/cancellationReasonController.js';

export const driverRouter = Router();

driverRouter.get('/cancellation-reasons', getPublicCancellationReasons);

driverRouter.post("/register", asyncHandler(registerDriver));
driverRouter.post("/login", loginRateLimit, asyncHandler(loginDriver));
driverRouter.post("/auth/send-otp", otpSendRateLimit, asyncHandler(startDriverLoginOtpRequest));
driverRouter.post(
  "/auth/verify-otp",
  otpVerifyRateLimit,
  asyncHandler(verifyDriverLoginOtpRequest),
);
driverRouter.post(
  "/pooling/onboarding/send-otp",
  otpSendRateLimit,
  asyncHandler(startPoolingOnboardingRequest),
);
driverRouter.post(
  "/pooling/onboarding/verify-otp",
  otpVerifyRateLimit,
  asyncHandler(verifyPoolingOnboardingOtpRequest),
);
driverRouter.get(
  "/pooling/onboarding/session/:registrationId",
  asyncHandler(getPoolingOnboardingSessionRequest),
);
driverRouter.patch(
  "/pooling/onboarding/details",
  asyncHandler(savePoolingOnboardingDetailsRequest),
);
driverRouter.post(
  "/pooling/onboarding/complete",
  asyncHandler(completePoolingOnboardingRequest),
);
driverRouter.post(
  "/pooling/onboarding/upload-image",
  asyncHandler(uploadPoolingOnboardingImageRequest),
);
// Offers dispatched to this driver that the socket may have missed. Polled by
// the app on reconnect and on every `ride_request` push, so a dropped socket
// no longer means a lost ride.
driverRouter.get(
  "/ride-offers",
  authenticate(["driver"]),
  asyncHandler(getPendingRideOffers),
);
driverRouter.get(
  "/me",
  authenticate(["driver", "owner", "pooling_driver", "bus_driver", "service_center", "service_center_staff"], { allowPending: true }),
  asyncHandler(getCurrentDriver),
);
driverRouter.get(
  "/pooling/bookings",
  authenticate(["pooling_driver"], { allowPending: true }),
  asyncHandler(getPoolingDriverBookings),
);
driverRouter.patch(
  "/me",
  authenticate(["driver", "owner"]),
  asyncHandler(updateCurrentDriver),
);
driverRouter.post(
  "/me/bank-details/verify",
  authenticate(["driver"]),
  asyncHandler(verifyCurrentDriverBankDetails),
);
driverRouter.post(
  "/me/upi/verify",
  authenticate(["driver"]),
  asyncHandler(verifyCurrentDriverUpiDetails),
);
driverRouter.get(
  "/bus/seats",
  authenticate(["bus_driver"]),
  asyncHandler(getBusDriverSeatLayout),
);
driverRouter.get(
  "/bus/bookings",
  authenticate(["bus_driver"]),
  asyncHandler(listBusDriverBookings),
);
driverRouter.post(
  "/bus/reservations",
  authenticate(["bus_driver"]),
  asyncHandler(createBusDriverReservation),
);
driverRouter.get(
  "/bus/live-trip",
  authenticate(["bus_driver"]),
  asyncHandler(getBusDriverLiveTrip),
);
driverRouter.post(
  "/bus/live-trip/start",
  authenticate(["bus_driver"]),
  asyncHandler(startBusDriverLiveTrip),
);
driverRouter.patch(
  "/bus/live-trip/location",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverLiveLocation),
);
driverRouter.patch(
  "/bus/live-trip/status",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverLiveTripStatus),
);
driverRouter.patch(
  "/bus/schedules",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverSchedules),
);
driverRouter.delete(
  "/me",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteCurrentDriverAccount),
);
driverRouter.post(
  "/me/delete-request",
  authenticate(["driver"]),
  asyncHandler(requestDriverAccountDeletion),
);
driverRouter.post(
  "/sos",
  authenticate(["driver", "owner"]),
  asyncHandler(triggerDriverSosAlert),
);
driverRouter.get(
  "/emergency-contacts",
  authenticate(["driver"]),
  asyncHandler(getDriverEmergencyContacts),
);
driverRouter.post(
  "/emergency-contacts",
  authenticate(["driver"]),
  asyncHandler(addDriverEmergencyContact),
);
driverRouter.delete(
  "/emergency-contacts/:contactId",
  authenticate(["driver"]),
  asyncHandler(deleteDriverEmergencyContact),
);
driverRouter.patch(
  "/documents/:documentKey",
  authenticate(["driver", "owner"], { allowPending: true }),
  asyncHandler(updateCurrentDriverDocument),
);
driverRouter.post(
  "/documents/:documentKey/verify-license",
  authenticate(["driver"], { allowPending: true }),
  asyncHandler(verifyCurrentDriverLicenseDocument),
);
driverRouter.post(
  "/documents/:documentKey/verify-pan",
  authenticate(["driver"], { allowPending: true }),
  asyncHandler(verifyCurrentDriverPanDocument),
);
driverRouter.post(
  "/documents/:documentKey/verify-gst",
  authenticate(["driver"], { allowPending: true }),
  asyncHandler(verifyCurrentDriverGstinDocument),
);
driverRouter.post(
  "/documents/:documentKey/verify-rc",
  authenticate(["driver"], { allowPending: true }),
  asyncHandler(verifyCurrentDriverRcDocument),
);
driverRouter.post(
  "/documents/:documentKey/verify-bank",
  authenticate(["driver"], { allowPending: true }),
  asyncHandler(verifyCurrentDriverBankDocument),
);
driverRouter.get(
  "/notifications",
  authenticate(["driver"]),
  asyncHandler(getDriverNotifications),
);
driverRouter.get(
  "/scheduled-rides",
  authenticate(["driver"]),
  asyncHandler(getDriverScheduledRides),
);
driverRouter.post(
  "/scheduled-rides/:rideId/cancel",
  authenticate(["driver"]),
  asyncHandler(cancelDriverScheduledRide),
);
driverRouter.post(
  "/fcm-token",
  authenticate([
    "driver",
    "owner",
    "pooling_driver",
    "bus_driver",
    "service_center",
    "service_center_staff",
  ], { allowPending: true }),
  asyncHandler(saveDriverFcmToken),
);
driverRouter.get(
  "/wallet",
  authenticate(["driver"]),
  asyncHandler(getMyWallet),
);
driverRouter.get(
  "/incentives",
  authenticate(["driver"]),
  asyncHandler(getDriverIncentives),
);
driverRouter.post(
  "/incentives/claim",
  authenticate(["driver"]),
  asyncHandler(claimDriverIncentiveReward),
);
// No bare /wallet/top-up: it credited any amount with no payment. Drivers top
// up through the Razorpay and PhonePe routes below, which verify the payment.
driverRouter.post(
  "/wallet/top-up/razorpay/callback",
  asyncHandler(handleDriverRazorpayWalletTopupCallback),
);
driverRouter.get(
  "/wallet/top-up/razorpay/callback",
  asyncHandler(handleDriverRazorpayWalletTopupCallback),
);
driverRouter.post(
    "/wallet/top-up/razorpay/order",
    authenticate(["driver"]),
    paymentOrderRateLimit,
    asyncHandler(createDriverWalletTopupOrder),
);
driverRouter.post(
    "/wallet/top-up/phonepe/order",
    authenticate(["driver"]),
    paymentOrderRateLimit,
    asyncHandler(createDriverPhonePeWalletTopupOrder),
);
  driverRouter.post(
    "/wallet/top-up/razorpay/verify",
    authenticate(["driver"]),
    asyncHandler(verifyDriverWalletTopup),
  );
  driverRouter.get(
    "/wallet/top-up/phonepe/status/:merchantTransactionId",
    authenticate(["driver"]),
    asyncHandler(verifyDriverPhonePeWalletTopup),
  );
  driverRouter.post(
    "/wallet/top-up/cashfree/order",
    authenticate(["driver"]),
    paymentOrderRateLimit,
    asyncHandler(createDriverCashfreeWalletTopupOrder),
  );
  driverRouter.post(
    "/wallet/top-up/cashfree/verify",
    authenticate(["driver"]),
    asyncHandler(verifyDriverCashfreeWalletTopup),
  );
driverRouter.post(
  "/wallet/withdrawals",
  authenticate(["driver"]),
  asyncHandler(createDriverWithdrawalRequest),
);

driverRouter.get(
  "/me/payment-upi",
  authenticate(["driver"]),
  asyncHandler(getDriverPaymentUpi),
);
driverRouter.patch(
  "/me/payment-upi",
  authenticate(["driver"]),
  asyncHandler(saveDriverPaymentUpi),
);
driverRouter.post(
  "/payments/qr",
  authenticate(["driver"]),
  asyncHandler(createDriverPaymentQr),
);
driverRouter.get(
  "/payments/qr/status",
  authenticate(["driver"]),
  asyncHandler(getDriverPaymentQrStatus),
);
driverRouter.patch(
  "/vehicle",
  authenticate(["driver"]),
  asyncHandler(updateDriverVehicle),
);
driverRouter.get("/approval-status", asyncHandler(getDriverApprovalStatus));
driverRouter.get(
  "/fleet/dashboard",
  authenticate(["owner"]),
  asyncHandler(getOwnerFleetDashboard),
);
driverRouter.get(
  "/fleet/bus-services",
  authenticate(["owner"]),
  asyncHandler(listOwnerBusServices),
);
driverRouter.get(
  "/fleet/bus-bookings",
  authenticate(["owner"]),
  asyncHandler(getOwnerBusBookings),
);
driverRouter.get(
  "/fleet/bus-bookings/calendar",
  authenticate(["owner"]),
  asyncHandler(getOwnerBusBookingCalendar),
);
driverRouter.post(
  "/fleet/bus-services",
  authenticate(["owner"]),
  asyncHandler(createOwnerBusService),
);
driverRouter.patch(
  "/fleet/bus-services/:id",
  authenticate(["owner"]),
  asyncHandler(updateOwnerBusService),
);
driverRouter.delete(
  "/fleet/bus-services/:id",
  authenticate(["owner"]),
  asyncHandler(deleteOwnerBusService),
);
driverRouter.post(
  "/fleet/bus-bookings/:id/cancel",
  authenticate(["owner"]),
  asyncHandler(cancelOwnerBusBookingSeats),
);
driverRouter.get(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetDrivers),
);
driverRouter.get(
  "/fleet/zones",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetZones),
);
driverRouter.post(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(createOwnerFleetDriver),
);
driverRouter.patch(
  "/fleet/drivers/:driverId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetDriver),
);
driverRouter.get(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetVehicles),
);
driverRouter.post(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(addOwnerVehicle),
);
driverRouter.patch(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetVehicle),
);
driverRouter.delete(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteOwnerFleetVehicle),
);
driverRouter.get(
  "/fleet/pooling-vehicles",
  authenticate(["owner"]),
  asyncHandler(getOwnerPoolingVehicles),
);
driverRouter.post(
  "/fleet/pooling-vehicles",
  authenticate(["owner"]),
  asyncHandler(createOwnerPoolingVehicle),
);
driverRouter.patch(
  "/fleet/pooling-vehicles/:vehicleId",
  authenticate(["owner"]),
  asyncHandler(updateOwnerPoolingVehicle),
);
driverRouter.delete(
  "/fleet/pooling-vehicles/:vehicleId",
  authenticate(["owner"]),
  asyncHandler(deleteOwnerPoolingVehicle),
);
driverRouter.get(
  "/service-center/staff",
  authenticate(["service_center"]),
  asyncHandler(getServiceCenterStaffMembers),
);
driverRouter.post(
  "/service-center/staff",
  authenticate(["service_center"]),
  asyncHandler(createServiceCenterStaffMember),
);
driverRouter.patch(
  "/service-center/staff/:staffId",
  authenticate(["service_center"]),
  asyncHandler(updateServiceCenterStaffMember),
);
driverRouter.delete(
  "/service-center/staff/:staffId",
  authenticate(["service_center"]),
  asyncHandler(deleteServiceCenterStaffMember),
);
driverRouter.get(
  "/service-center/staff/:staffId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterStaffBiometrics),
);
driverRouter.post(
  "/service-center/staff/biometrics/enroll",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(enrollServiceCenterStaffBiometric),
);
driverRouter.get(
  "/service-center/bookings",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterBookings),
);
driverRouter.get(
  "/service-center/bookings/:bookingId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterBookingBiometrics),
);
driverRouter.patch(
  "/service-center/bookings/:bookingId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(updateServiceCenterBookingBiometrics),
);
driverRouter.post(
  "/service-center/bookings/:bookingId/biometrics/fingers",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(captureServiceCenterBookingFingerprint),
);
driverRouter.delete(
  "/service-center/bookings/:bookingId/biometrics/fingers/:fingerCode",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(deleteServiceCenterBookingFingerprint),
);
driverRouter.post(
  "/service-center/bookings/:bookingId/biometrics/verify",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(verifyServiceCenterBookingFingerprint),
);
driverRouter.patch(
  "/service-center/bookings/:bookingId",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(updateServiceCenterBooking),
);
driverRouter.get(
  "/service-center/vehicles",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterVehicles),
);
driverRouter.post(
  "/service-center/vehicles",
  authenticate(["service_center"]),
  asyncHandler(createServiceCenterVehicle),
);
driverRouter.patch(
  "/service-center/vehicles/:vehicleId",
  authenticate(["service_center"]),
  asyncHandler(updateServiceCenterVehicle),
);
driverRouter.delete(
  "/service-center/vehicles/:vehicleId",
  authenticate(["service_center"]),
  asyncHandler(deleteServiceCenterVehicle),
);
driverRouter.get("/service-locations", asyncHandler(getServiceLocations));
driverRouter.get(
  "/document-templates",
  asyncHandler(getDriverDocumentTemplates),
);
driverRouter.get(
  "/vehicle-field-templates",
  asyncHandler(getDriverVehicleFieldTemplates),
);
// Limited like every other OTP route. These two were not: anyone could send
// unlimited SMS (each one paid for), and guess the 4-digit code with no cap.
driverRouter.post("/onboarding/send-otp", otpSendRateLimit, asyncHandler(startOnboarding));
driverRouter.post("/onboarding/verify-otp", otpVerifyRateLimit, asyncHandler(verifyOnboardingOtp));
driverRouter.patch("/onboarding/role", asyncHandler(saveOnboardingRole));
driverRouter.get("/onboarding/signup-options", asyncHandler(getOnboardingSignupOptions));
driverRouter.patch("/onboarding/role-details", asyncHandler(saveOnboardingRoleDetails));
driverRouter.patch(
  "/onboarding/personal",
  asyncHandler(saveOnboardingPersonal),
);
driverRouter.patch(
  "/onboarding/referral",
  asyncHandler(saveOnboardingReferral),
);
driverRouter.patch("/onboarding/vehicle", asyncHandler(saveOnboardingVehicle));
driverRouter.post("/onboarding/vehicle/verify-rc", asyncHandler(verifyOnboardingVehicleRc));
driverRouter.post(
  "/onboarding/documents/:documentKey/verify-license",
  asyncHandler(verifyOnboardingLicenseDocument),
);
driverRouter.patch(
  "/onboarding/documents",
  asyncHandler(saveOnboardingDocuments),
);
driverRouter.post("/onboarding/complete", asyncHandler(completeOnboarding));
driverRouter.get(
  "/onboarding/session/:registrationId",
  asyncHandler(getOnboardingSession),
);
// The daily pass: what it costs, buying it, and what has been paid before.
driverRouter.get("/subscription", authenticate(["driver"]), asyncHandler(getMySubscription));
driverRouter.post("/subscription/purchase", authenticate(["driver"]), asyncHandler(buySubscription));
driverRouter.get("/subscription/history", authenticate(["driver"]), asyncHandler(getMySubscriptionHistory));

driverRouter.patch("/online", authenticate(["driver"]), asyncHandler(goOnline));
// Surge hexagons near the driver, for the "Surge Fare Area" map: each carries
// its outline, multiplier and minutes left, so the app can draw it without H3.
driverRouter.get(
  "/surge-map",
  authenticate(["driver"]),
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat ?? req.query.latitude);
    const lng = Number(req.query.lng ?? req.query.longitude);
    const radiusKm = Math.min(50, Math.max(1, Number(req.query.radius_km) || 15));
    // Surge is set per vehicle type: show the driver their own vehicles'.
    const driver = await Driver.findById(req.auth.sub).select("vehicleTypeId vehicleTypeIds").lean();
    const vehicleTypeIds = [driver?.vehicleTypeId, ...(driver?.vehicleTypeIds || [])].filter(Boolean).map(String);
    const results = await listActiveSurges({ lat, lng, radiusKm, vehicleTypeIds });
    res.json({ success: true, data: { results, refreshed_at: new Date().toISOString() } });
  }),
);
// The surge & demand map: surging and busy hexagons near the driver, the best
// few places to go with what a trip pays there, and airport demand. Read-only
// over what the surge engine already computed - looking never moves a price.
// Contract: docs/surge-heatmap-implementation.md in the driver app repo.
driverRouter.get(
  "/opportunity-map",
  authenticate(["driver"]),
  asyncHandler(async (req, res) => {
    const data = await getOpportunityMap({
      driverId: req.auth?.sub,
      lat: req.query.lat ?? req.query.latitude,
      lng: req.query.lng ?? req.query.longitude,
      radiusKm: req.query.radius_km,
    });
    res.json({ success: true, data });
  }),
);
driverRouter.patch(
  "/offline",
  authenticate(["driver"]),
  asyncHandler(goOffline),
);
driverRouter.post("/logout", authenticate(["driver"]), asyncHandler(logoutDriver));
