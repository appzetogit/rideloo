import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { CashfreePaymentOrder } from '../models/CashfreePaymentOrder.js';
import { RentalBookingRequest } from '../models/RentalBookingRequest.js';
import { User } from '../../user/models/User.js';
import { verifyCashfreeOrder } from '../../services/cashfreeService.js';

const RENTAL_PURPOSE = 'rental_advance';
const RECHECK_LIMIT = 50;
// An order younger than this may still be in the rider's hands.
const GRACE_MS = 10 * 60 * 1000;

/**
 * GET /admin/payments/cashfree/unmatched-rental-advances?days=30&recheck=1
 *
 * Rental advances that Cashfree reports as paid but that no rental booking
 * uses - the rider paid and the app closed before the booking was made. Admin
 * refunds these from the Cashfree dashboard or books the rental for the rider.
 *
 * recheck=1 first asks Cashfree again about orders still recorded as unpaid,
 * because a rental order is only marked paid when someone verifies it.
 */
export const getUnmatchedCashfreeRentalAdvances = asyncHandler(async (req, res) => {
  const days = Math.min(180, Math.max(1, Number(req.query?.days) || 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const before = new Date(Date.now() - GRACE_MS);

  let rechecked = 0;
  if (String(req.query?.recheck || '') === '1') {
    const pending = await CashfreePaymentOrder.find({
      purpose: RENTAL_PURPOSE,
      status: { $ne: 'paid' },
      createdAt: { $gte: since, $lte: before },
    })
      .sort({ createdAt: -1 })
      .limit(RECHECK_LIMIT)
      .select('orderId')
      .lean();
    for (const item of pending) {
      // verifyCashfreeOrder updates the record's status itself.
      await verifyCashfreeOrder({ orderId: item.orderId }).catch(() => null);
      rechecked += 1;
    }
  }

  const paid = await CashfreePaymentOrder.find({
    purpose: RENTAL_PURPOSE,
    status: 'paid',
    createdAt: { $gte: since, $lte: before },
  })
    .sort({ paidAt: -1, createdAt: -1 })
    .lean();

  const used = new Set(
    (
      await RentalBookingRequest.find({ 'payment.orderId': { $in: paid.map((item) => item.orderId) } })
        .select('payment.orderId')
        .lean()
    ).map((item) => String(item.payment?.orderId || '')),
  );
  const unmatched = paid.filter((item) => !used.has(item.orderId));

  const users = await User.find({ _id: { $in: unmatched.map((item) => item.userId).filter(Boolean) } })
    .select('name phone')
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  res.json({
    success: true,
    data: {
      days,
      rechecked,
      count: unmatched.length,
      total: Math.round(unmatched.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100,
      results: unmatched.map((item) => {
        const user = userById.get(String(item.userId || '')) || {};
        return {
          orderId: item.orderId,
          amount: Number(item.amount || 0),
          paidAt: item.paidAt,
          createdAt: item.createdAt,
          bookingReference: item.bookingReference || '',
          isProduction: Boolean(item.isProduction),
          user: { id: item.userId, name: user.name || '', phone: user.phone || '' },
        };
      }),
    },
  });
});
