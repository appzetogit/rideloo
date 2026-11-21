import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  availableDriversRateLimit,
  paymentOrderRateLimit,
  rideCreationRateLimit,
} from '../../middlewares/rateLimitMiddleware.js';
import {
  acceptRideBid,
  createRazorpayRideCompletionOrder,
  createCashfreeRideCompletionOrder,
  verifyCashfreeRideCompletion,
  createRazorpayRideFareOrder,
  verifyRazorpayRideFare,
  createCashfreeRideFareOrder,
  verifyCashfreeRideFare,
  cancelRide,
  createRazorpayRideTipOrder,
  createCashfreeRideTipOrder,
  verifyCashfreeRideTip,
  createRide,
  getRideBids,
  getRideAppTipSettings,
  getRideBiddingSettings,
  getMyActiveRide,
  getRideById,
  listMyRides,
  listAvailableDrivers,
  payRideCompletionWithWallet,
  submitRideReview,
  updateRideBidCeiling,
  updateRideStatus,
  uploadParcelProof,
  verifyRazorpayRideCompletion,
  verifyRazorpayRideTip,
} from '../controllers/rideController.js';

export const rideRouter = Router();

rideRouter.post('/', authenticate(['user']), rideCreationRateLimit, asyncHandler(createRide));
rideRouter.get('/', authenticate(['user', 'driver']), asyncHandler(listMyRides));
rideRouter.get('/app-settings/tip', asyncHandler(getRideAppTipSettings));
rideRouter.get('/app-settings/bidding', asyncHandler(getRideBiddingSettings));
rideRouter.get('/available-drivers', availableDriversRateLimit, asyncHandler(listAvailableDrivers));
rideRouter.get('/active/me', authenticate(['user', 'driver']), asyncHandler(getMyActiveRide));
rideRouter.patch('/:rideId/cancel', authenticate(['user']), asyncHandler(cancelRide));
rideRouter.get('/:rideId/bids', authenticate(['user']), asyncHandler(getRideBids));
rideRouter.patch('/:rideId/bids/ceiling', authenticate(['user']), asyncHandler(updateRideBidCeiling));
rideRouter.post('/:rideId/bids/:bidId/accept', authenticate(['user']), asyncHandler(acceptRideBid));
rideRouter.get('/:rideId', authenticate(['user', 'driver']), asyncHandler(getRideById));
rideRouter.patch('/:rideId/status', authenticate(['driver']), asyncHandler(updateRideStatus));
// Parcel handover photos. The delivery cannot start or complete without them.
rideRouter.post('/:rideId/parcel-proof', authenticate(['driver']), asyncHandler(uploadParcelProof));
rideRouter.post('/:rideId/complete-payment/razorpay/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createRazorpayRideCompletionOrder));
rideRouter.post('/:rideId/complete-payment/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayRideCompletion));
rideRouter.post('/:rideId/complete-payment/cashfree/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createCashfreeRideCompletionOrder));
rideRouter.post('/:rideId/complete-payment/cashfree/verify', authenticate(['user']), asyncHandler(verifyCashfreeRideCompletion));
rideRouter.post('/:rideId/complete-payment/wallet', authenticate(['user']), asyncHandler(payRideCompletionWithWallet));
// The rider pays a cash ride's fare online (Razorpay) instead of the driver's UPI.
rideRouter.post('/:rideId/fare-payment/razorpay/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createRazorpayRideFareOrder));
rideRouter.post('/:rideId/fare-payment/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayRideFare));
rideRouter.post('/:rideId/fare-payment/cashfree/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createCashfreeRideFareOrder));
rideRouter.post('/:rideId/fare-payment/cashfree/verify', authenticate(['user']), asyncHandler(verifyCashfreeRideFare));
rideRouter.post('/:rideId/tip/razorpay/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createRazorpayRideTipOrder));
rideRouter.post('/:rideId/tip/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayRideTip));
rideRouter.post('/:rideId/tip/cashfree/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createCashfreeRideTipOrder));
rideRouter.post('/:rideId/tip/cashfree/verify', authenticate(['user']), asyncHandler(verifyCashfreeRideTip));
rideRouter.patch('/:rideId/feedback', authenticate(['user']), asyncHandler(submitRideReview));
