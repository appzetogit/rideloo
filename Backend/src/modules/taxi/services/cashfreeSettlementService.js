import crypto from 'node:crypto';
import { ApiError } from '../../../utils/ApiError.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { Driver } from '../driver/models/Driver.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
import { serializeDriverWallet, topUpDriverWallet } from '../driver/services/walletService.js';
import { resolveCashfreeCredentials, verifyCashfreeOrder } from './cashfreeService.js';
import { runRedisCommand } from '../../../infrastructure/redis/redisClient.js';

// Wallet top-ups paid through Cashfree are settled here, from two places:
// the app's verify call after checkout, and Cashfree's server-to-server
// webhook (which still arrives when the app was closed before it could
// verify). Both re-read the order from Cashfree and credit at most once.

export const CASHFREE_USER_WALLET_SOURCE = 'user_wallet_topup';
export const CASHFREE_DRIVER_WALLET_SOURCE = 'driver_wallet_topup';

const compactId = (id, fallback) => String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || fallback;

export const buildUserWalletOrderId = (userId) => `uwalcf_${compactId(userId, 'usr')}_${Date.now().toString(36)}`;
export const buildDriverWalletOrderId = (driverId) => `dwalcf_${compactId(driverId, 'drv')}_${Date.now().toString(36)}`;

// Who a wallet order belongs to. New orders carry it in order_tags. Orders
// created before the tags existed only have the owner's last 8 id characters
// in the order id, which is enough to check a claim but not to find the owner.
const readWalletOrderOwner = (verification) => {
  const tags = verification.tags || {};
  if (tags.source === CASHFREE_USER_WALLET_SOURCE && tags.userId) {
    return { role: 'user', id: String(tags.userId) };
  }
  if (tags.source === CASHFREE_DRIVER_WALLET_SOURCE && tags.driverId) {
    return { role: 'driver', id: String(tags.driverId) };
  }
  return null;
};

const isLegacyOrderOf = (orderId, role, id) => {
  const prefix = role === 'user' ? 'uwalcf_' : 'dwalcf_';
  return String(orderId).startsWith(`${prefix}${compactId(id, role === 'user' ? 'usr' : 'drv')}_`);
};

// One settle per order at a time, so a verify call and the webhook arriving
// together cannot both pass the "already credited?" check. Inside this process
// a promise chain does it; across processes (more than one backend instance) a
// Redis lock does. If Redis is unreachable only the in-process lock applies.
const inFlight = new Map();
const LOCK_TTL_MS = 30000;
const LOCK_WAIT_MS = 20000;
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const acquireRedisLock = async (key, token) => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const result = await runRedisCommand(
      (client) => client.set(key, token, { NX: true, PX: LOCK_TTL_MS }),
      { label: 'cashfree order lock' },
    );
    if (!result.ok) {
      return false; // Redis unavailable: carry on with the in-process lock only.
    }
    if (result.value === 'OK') {
      return true;
    }
    if (Date.now() > deadline) {
      throw new ApiError(409, 'This payment is being processed. Please try again in a moment.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

export const withOrderLock = async (orderId, task) => {
  while (inFlight.has(orderId)) {
    await inFlight.get(orderId).catch(() => {});
  }
  const run = (async () => {
    const key = `lock:cashfree:order:${orderId}`;
    const token = crypto.randomBytes(12).toString('hex');
    const locked = orderId ? await acquireRedisLock(key, token) : false;
    try {
      return await task();
    } finally {
      if (locked) {
        await runRedisCommand(
          (client) => client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] }),
          { label: 'cashfree order unlock' },
        );
      }
    }
  })();
  inFlight.set(orderId, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(orderId) === run) {
      inFlight.delete(orderId);
    }
  }
};

const creditUserWallet = async ({ userId, amount, orderId }) => {
  const referenceKey = `cashfree:topup:${orderId}`;
  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true },
  );
  // The filter makes the credit and the duplicate check one atomic step.
  const result = await UserWallet.updateOne(
    { userId, 'transactions.referenceKey': { $ne: referenceKey } },
    {
      $inc: { balance: amount },
      $push: {
        transactions: {
          $each: [{ kind: 'credit', amount, title: 'Wallet top-up via Cashfree', referenceKey }],
          $slice: -50,
        },
      },
    },
  );
  return result.modifiedCount > 0;
};

const creditDriverWallet = async ({ driverId, amount, orderId }) => {
  const already = await WalletTransaction.findOne({ driverId, 'metadata.providerOrderId': orderId })
    .select('_id')
    .lean();
  if (already) {
    return { credited: false, result: null };
  }
  const result = await topUpDriverWallet({
    driverId,
    amount,
    metadata: { source: 'cashfree', provider: 'cashfree', providerOrderId: orderId },
  });
  return { credited: true, result };
};

/**
 * Settle a Cashfree wallet top-up order.
 *
 * `claimant` ({ role, id }) is the logged-in account calling verify; the order
 * must be theirs. Without a claimant (webhook) the owner comes from the order
 * tags, and an order without them is left alone.
 *
 * Returns { status, paid, credited, owner, amount, driverResult }.
 */
export const settleCashfreeWalletOrder = async ({ orderId, claimant = null }) => {
  const cleanOrderId = String(orderId || '').trim();
  if (!cleanOrderId) {
    throw new ApiError(400, 'order_id is required');
  }

  return withOrderLock(cleanOrderId, async () => {
    const verification = await verifyCashfreeOrder({ orderId: cleanOrderId });
    let owner = readWalletOrderOwner(verification);

    if (claimant) {
      const claimantId = String(claimant.id || '');
      const ownsTagged = owner && owner.role === claimant.role && owner.id === claimantId;
      const ownsLegacy = !owner && isLegacyOrderOf(cleanOrderId, claimant.role, claimantId);
      if (!ownsTagged && !ownsLegacy) {
        throw new ApiError(403, 'This payment does not belong to your account');
      }
      owner = { role: claimant.role, id: claimantId };
    }

    const base = {
      status: verification.status,
      paid: verification.isPaid,
      credited: false,
      owner,
      amount: verification.amount,
      driverResult: null,
    };

    if (!verification.isPaid || !owner) {
      return base;
    }

    if (owner.role === 'user') {
      const credited = await creditUserWallet({ userId: owner.id, amount: verification.amount, orderId: cleanOrderId });
      return { ...base, credited };
    }

    const { credited, result } = await creditDriverWallet({
      driverId: owner.id,
      amount: verification.amount,
      orderId: cleanOrderId,
    });
    return { ...base, credited, driverResult: result };
  });
};

export const CASHFREE_RENTAL_ADVANCE_SOURCE = 'rental_advance';

/**
 * Express handler factory: GET .../payments/cashfree/:orderId/status.
 * Lets an app that was closed mid-payment ask what happened to its order
 * without settling anything. Only the order's own account may ask.
 */
export const cashfreeOrderStatusHandler = (role) => async (req, res) => {
  const orderId = String(req.params?.orderId || '').trim();
  if (!orderId) {
    throw new ApiError(400, 'orderId is required');
  }
  const accountId = String(req.auth?.sub || '');
  const verification = await verifyCashfreeOrder({ orderId });
  const tags = verification.tags || {};

  const owned = role === 'driver'
    ? (tags.source === CASHFREE_DRIVER_WALLET_SOURCE && String(tags.driverId || '') === accountId)
      || (!tags.source && isLegacyOrderOf(orderId, 'driver', accountId))
    : (Boolean(tags.source) && tags.source !== CASHFREE_DRIVER_WALLET_SOURCE && String(tags.userId || '') === accountId)
      || (!tags.source && isLegacyOrderOf(orderId, 'user', accountId));
  if (!owned) {
    throw new ApiError(403, 'This payment does not belong to your account');
  }

  res.json({
    success: true,
    data: {
      orderId: verification.orderId,
      status: verification.status,
      paid: verification.isPaid,
      amount: verification.amount,
      purpose: tags.source || '',
      rideId: tags.rideId || null,
    },
  });
};

export const loadDriverWalletForResponse = async (driverId) =>
  serializeDriverWallet(await Driver.findById(driverId));

/**
 * Check a Cashfree webhook's signature: base64(HMAC-SHA256(timestamp + raw body))
 * keyed with the client secret of the active environment.
 */
export const isValidCashfreeWebhookSignature = async ({ rawBody, timestamp, signature }) => {
  if (!rawBody || !timestamp || !signature) {
    return false;
  }
  const { secretKey } = await resolveCashfreeCredentials();
  const expected = crypto.createHmac('sha256', secretKey).update(`${timestamp}${rawBody}`).digest('base64');
  const given = Buffer.from(String(signature));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
};
