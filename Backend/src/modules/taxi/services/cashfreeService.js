import { ApiError } from '../../../utils/ApiError.js';
import { env } from '../../../config/env.js';
import mongoose from 'mongoose';
import { resolveConfiguredGatewayCredentials } from './paymentGatewayService.js';
import { CashfreePaymentOrder } from '../admin/models/CashfreePaymentOrder.js';

const toObjectIdOrNull = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || '')) ? new mongoose.Types.ObjectId(String(value)) : null;

// The order ledger is best-effort: a payment never fails because of it.
const recordOrder = (filter, update) =>
  CashfreePaymentOrder.updateOne(filter, update, { upsert: true }).catch(() => null);

// Cashfree PG ("next gen") REST API. Order create returns a payment_session_id
// the client SDK opens checkout with; the order is verified server-side by its
// status afterwards — same order -> pay -> verify shape as the Razorpay flow.
const CASHFREE_API_VERSION = '2023-08-01';

// Where Cashfree posts payment events for an order. Cashfree only accepts
// https, so nothing is sent while the backend has no public https origin.
const resolveCashfreeNotifyUrl = () => {
  const origin = String(env.paymentCallbackOrigin || env.publicBackendUrl || '').trim().replace(/\/+$/, '');
  return origin.startsWith('https://') ? `${origin}/api/v1/common/payment-gateway/cashfree/webhook` : '';
};

const getCashfreeBaseUrl = (isProduction) =>
  isProduction ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

const cashfreeRequest = async ({ method, path, body, appId, secretKey, isProduction }) => {
  const response = await fetch(`${getCashfreeBaseUrl(isProduction)}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': CASHFREE_API_VERSION,
      'x-client-id': appId,
      'x-client-secret': secretKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status || 502,
      payload?.message || payload?.error_description || 'Cashfree request failed',
    );
  }
  return payload;
};

export const resolveCashfreeCredentials = async () => {
  const { appId, secretKey, isProduction } = await resolveConfiguredGatewayCredentials('cashfree');
  if (!appId || !secretKey) {
    throw new ApiError(500, 'Cashfree is not configured. Add the keys in Admin > Payment Gateways');
  }
  return { appId, secretKey, isProduction };
};

/**
 * Create a Cashfree order. Returns the payment_session_id the app's Cashfree SDK
 * needs to open checkout, plus the order id used to verify the payment later.
 */
export const createCashfreeOrder = async ({ amount, orderId, customer = {}, returnUrl = '', tags = null }) => {
  const { appId, secretKey, isProduction } = await resolveCashfreeCredentials();
  const amountRupees = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;

  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new ApiError(400, 'Invalid Cashfree order amount');
  }
  if (!orderId) {
    throw new ApiError(400, 'A Cashfree order id is required');
  }

  const payload = await cashfreeRequest({
    method: 'POST',
    path: '/orders',
    appId,
    secretKey,
    isProduction,
    body: {
      order_id: String(orderId),
      order_amount: amountRupees,
      order_currency: 'INR',
      customer_details: {
        customer_id: String(customer.id || orderId),
        customer_name: String(customer.name || 'Customer'),
        // Cashfree requires a phone; fall back so sandbox orders still create.
        customer_phone: String(customer.phone || '9999999999'),
        ...(customer.email ? { customer_email: String(customer.email) } : {}),
      },
      order_meta: {
        ...(returnUrl ? { return_url: `${returnUrl}?order_id={order_id}` } : {}),
        ...(resolveCashfreeNotifyUrl() ? { notify_url: resolveCashfreeNotifyUrl() } : {}),
      },
      // order_tags bind the order to its ride/user so verify can confirm the
      // payment is for the right thing (mirrors Razorpay's order notes). Values
      // must be strings.
      ...(tags && typeof tags === 'object'
        ? {
            order_tags: Object.fromEntries(
              Object.entries(tags).map(([key, value]) => [key, String(value ?? '')]),
            ),
          }
        : {}),
    },
  });

  const recordedTags = tags && typeof tags === 'object' ? tags : {};
  await recordOrder(
    { orderId: payload?.order_id || String(orderId) },
    {
      $setOnInsert: {
        purpose: String(recordedTags.source || ''),
        userId: toObjectIdOrNull(recordedTags.userId),
        driverId: toObjectIdOrNull(recordedTags.driverId),
        rideId: toObjectIdOrNull(recordedTags.rideId),
        bookingReference: String(recordedTags.bookingReference || ''),
        amount: amountRupees,
        isProduction,
      },
      $set: { status: String(payload?.order_status || 'active').toLowerCase() },
    },
  );

  return {
    orderId: payload?.order_id || String(orderId),
    paymentSessionId: payload?.payment_session_id || '',
    amount: amountRupees,
    currency: 'INR',
    isProduction,
  };
};

/**
 * Fetch an order's current status. `isPaid` is true only when Cashfree reports
 * order_status === 'PAID' — settle wallet/booking only on that.
 */
export const verifyCashfreeOrder = async ({ orderId }) => {
  if (!orderId) {
    throw new ApiError(400, 'A Cashfree order id is required');
  }
  const { appId, secretKey, isProduction } = await resolveCashfreeCredentials();

  const payload = await cashfreeRequest({
    method: 'GET',
    path: `/orders/${encodeURIComponent(String(orderId))}`,
    appId,
    secretKey,
    isProduction,
  });

  const status = String(payload?.order_status || '').toUpperCase();
  if (status) {
    await recordOrder(
      { orderId: payload?.order_id || String(orderId) },
      {
        $set: { status: status.toLowerCase() },
        $setOnInsert: {
          purpose: String(payload?.order_tags?.source || ''),
          userId: toObjectIdOrNull(payload?.order_tags?.userId),
          amount: Number(payload?.order_amount || 0),
          isProduction,
        },
      },
    );
    if (status === 'PAID') {
      // First time it is seen paid; later checks leave the time alone.
      await CashfreePaymentOrder.updateOne(
        { orderId: payload?.order_id || String(orderId), paidAt: null },
        { $set: { paidAt: new Date() } },
      ).catch(() => null);
    }
  }
  return {
    orderId: payload?.order_id || String(orderId),
    status,
    isPaid: status === 'PAID',
    amount: Number(payload?.order_amount || 0),
    tags: payload?.order_tags && typeof payload.order_tags === 'object' ? payload.order_tags : {},
    raw: payload,
  };
};
