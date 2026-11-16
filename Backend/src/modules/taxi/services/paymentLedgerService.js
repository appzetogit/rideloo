import mongoose from 'mongoose';
import { Ride } from '../user/models/Ride.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { User } from '../user/models/User.js';
import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
// Registered here because rows populate driverId, whether or not the rest of
// the app has loaded the Driver model yet.
import '../driver/models/Driver.js';
import { Vehicle } from '../admin/models/Vehicle.js';

/**
 * Every payment the platform takes, in one list for the admin Payments page.
 *
 *   ride            a completed ride's fare - cash to the driver, paid online,
 *                   from the rider's wallet, or covered by a rider subscription
 *   subscription    a driver's subscription pass (usually paid from the wallet)
 *   driver_top_up   a driver topping up their wallet through the gateway
 *   rider_top_up    a rider refilling their wallet through the gateway
 *
 * Money only enters the business once: a pass bought from a wallet that was
 * topped up online is the top-up's money, so the totals count "received
 * online" and "paid from wallet" separately rather than adding them together.
 */

const KIND_LABELS = {
  ride: 'Ride fare',
  subscription: 'Driver subscription',
  driver_top_up: 'Driver wallet top-up',
  rider_top_up: 'Rider wallet top-up',
};

const METHOD_LABELS = {
  cash: 'Cash',
  online: 'Online',
  wallet: 'Wallet',
  subscription: 'Subscription',
};

const GATEWAYS = new Set(['razorpay', 'phonepe', 'cashfree', 'paytm', 'stripe', 'upi']);

const titleCase = (value) => String(value || '').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * How a ride was actually paid, which is not always what it was booked as: a
 * rider can book cash and pay online at the end, and a subscription ride
 * stores "online" though no money changed hands.
 */
export const describeRidePayment = (ride = {}) => {
  const collection = ride.driverPaymentCollection || {};
  const booked = String(ride.paymentMethod || 'cash').toLowerCase();
  const provider = String(collection.provider || '').toLowerCase();
  const paidOnline = collection.status === 'paid' && GATEWAYS.has(provider);

  if (ride.subscriptionUsage?.covered) {
    return {
      method: 'subscription',
      provider: 'subscription',
      status: 'paid',
      reference: String(ride.subscriptionUsage.subscriptionId || ''),
      detail: `Covered by the rider's subscription${ride.subscriptionUsage.planName ? ` (${ride.subscriptionUsage.planName})` : ''}`,
    };
  }
  if (paidOnline) {
    return {
      method: 'online',
      provider,
      status: 'paid',
      reference: collection.providerPaymentId || collection.providerId || collection.providerOrderId || '',
      paidAt: collection.paidAt || null,
      detail: `Paid online via ${titleCase(provider)}${booked === 'cash' ? ' (booked as cash)' : ''}`,
    };
  }
  if (booked === 'wallet') {
    return { method: 'wallet', provider: 'wallet', status: 'paid', reference: '', detail: "Paid from the rider's wallet" };
  }
  if (booked === 'online' || booked === 'upi') {
    return {
      method: 'online',
      provider: provider || 'online',
      status: ride.status === 'completed' ? 'pending' : 'unpaid',
      reference: collection.providerOrderId || '',
      detail: 'Online - payment not received yet',
    };
  }
  return {
    method: 'cash',
    provider: 'cash',
    status: ride.status === 'completed' ? 'paid' : 'unpaid',
    reference: '',
    detail: 'Cash collected by the driver',
  };
};

const toDate = (value, fallback) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
};

const person = (doc, role) => ({
  id: doc?._id ? String(doc._id) : '',
  name: doc?.name || (role === 'driver' ? 'Driver' : 'Rider'),
  phone: doc?.phone || '',
  role,
});

/// Every vehicle type a driver is enrolled in - a pass or a top-up belongs to
/// all of them.
const driverVehicleTypeIds = (driver) =>
  [...new Set([driver?.vehicleTypeId, ...(driver?.vehicleTypeIds || [])].filter(Boolean).map(String))];

const rideRows = async ({ from, to, onlyId }) => {
  const rides = await Ride.find(onlyId ? { _id: onlyId } : {
    status: 'completed',
    $or: [{ completedAt: { $gte: from, $lte: to } }, { completedAt: null, updatedAt: { $gte: from, $lte: to } }],
  })
    .select('fare status paymentMethod driverPaymentCollection subscriptionUsage completedAt updatedAt createdAt userId driverId pickupAddress dropAddress serviceType trip_category vehicleTypeId')
    .populate('userId', 'name phone')
    .populate('driverId', 'name phone')
    .lean();

  return rides.map((ride) => {
    const payment = describeRidePayment(ride);
    return {
      id: `ride:${ride._id}`,
      kind: 'ride',
      record_id: String(ride._id),
      date: payment.paidAt || ride.completedAt || ride.updatedAt,
      amount: Number(ride.fare || 0),
      method: payment.method,
      provider: payment.provider,
      status: payment.status,
      reference: payment.reference,
      detail: payment.detail,
      payer: person(ride.userId, 'rider'),
      payee: person(ride.driverId, 'driver'),
      description: `${ride.pickupAddress || 'Pickup'} -> ${ride.dropAddress || 'Drop'}`,
      vehicle_type_ids: ride.vehicleTypeId ? [String(ride.vehicleTypeId)] : [],
    };
  });
};

const subscriptionRows = async ({ from, to, onlyId }) => {
  const rows = await DriverSubscription.find(onlyId ? { _id: onlyId, paidAt: { $ne: null } } : { paidAt: { $gte: from, $lte: to } })
    .populate('driverId', 'name phone vehicleTypeId vehicleTypeIds')
    .lean();

  return rows.map((row) => {
    const method = String(row.paymentMethod || 'wallet').toLowerCase();
    const viaGateway = GATEWAYS.has(method);
    return {
      id: `subscription:${row._id}`,
      kind: 'subscription',
      record_id: String(row._id),
      date: row.paidAt,
      amount: Number(row.amount || 0),
      method: viaGateway ? 'online' : method === 'wallet' ? 'wallet' : method,
      provider: method,
      status: 'paid',
      reference: row.paymentReference || '',
      detail: viaGateway ? `Paid online via ${titleCase(method)}` : "Paid from the driver's wallet",
      payer: person(row.driverId, 'driver'),
      payee: { id: '', name: 'Rideloo', phone: '', role: 'platform' },
      description: row.planName || row.name || 'Subscription pass',
      vehicle_type_ids: driverVehicleTypeIds(row.driverId),
    };
  });
};

const driverTopUpRows = async ({ from, to, onlyId }) => {
  const rows = await WalletTransaction.find(onlyId ? { _id: onlyId, type: 'top_up' } : { type: 'top_up', createdAt: { $gte: from, $lte: to } })
    .populate('driverId', 'name phone vehicleTypeId vehicleTypeIds')
    .lean();

  return rows.map((row) => {
    const provider = String(row.metadata?.provider || row.metadata?.source || 'online').toLowerCase();
    return {
      id: `driver_top_up:${row._id}`,
      kind: 'driver_top_up',
      record_id: String(row._id),
      date: row.createdAt,
      amount: Number(row.amount || 0),
      method: 'online',
      provider,
      status: 'paid',
      reference: row.metadata?.providerPaymentId || row.metadata?.providerOrderId || '',
      detail: `Wallet top-up via ${titleCase(provider)}`,
      payer: person(row.driverId, 'driver'),
      payee: { id: '', name: 'Rideloo', phone: '', role: 'platform' },
      description: row.description || 'Driver wallet top-up',
      vehicle_type_ids: driverVehicleTypeIds(row.driverId),
    };
  });
};

const riderTopUpRows = async ({ from, to, onlyId }) => {
  const wallets = await UserWallet.aggregate([
    { $unwind: '$transactions' },
    {
      $match: {
        'transactions.kind': 'credit',
        'transactions.provider': { $nin: [null, ''] },
        ...(onlyId
          ? { 'transactions._id': new mongoose.Types.ObjectId(onlyId) }
          : { 'transactions.createdAt': { $gte: from, $lte: to } }),
      },
    },
    { $project: { userId: 1, tx: '$transactions' } },
  ]);
  const users = await User.find({ _id: { $in: wallets.map((w) => w.userId).filter(Boolean) } })
    .select('name phone')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return wallets.map(({ userId, tx }) => {
    const provider = String(tx.provider || 'online').toLowerCase();
    return {
      id: `rider_top_up:${tx._id}`,
      kind: 'rider_top_up',
      record_id: String(tx._id),
      date: tx.createdAt,
      amount: Number(tx.amount || 0),
      method: 'online',
      provider,
      status: 'paid',
      reference: tx.providerPaymentId || tx.providerOrderId || '',
      detail: `Wallet refill via ${titleCase(provider)}`,
      payer: person(userById.get(String(userId)), 'rider'),
      payee: { id: '', name: 'Rideloo', phone: '', role: 'platform' },
      description: tx.title || 'Wallet refill',
      vehicle_type_ids: [],
    };
  });
};

const SOURCES = {
  ride: rideRows,
  subscription: subscriptionRows,
  driver_top_up: driverTopUpRows,
  rider_top_up: riderTopUpRows,
};

/**
 * @param kind     one of KIND_LABELS' keys, or empty for all
 * @param method   cash | online | wallet | subscription, or empty
 * @param from,to  ISO dates; defaults to the last 30 days
 * @param q        matches names, phones, references and ids
 */
export const listPayments = async ({ kind = '', method = '', vehicle_type_id: vehicleTypeId = '', from, to, q = '', page = 1, limit = 25 } = {}) => {
  const end = toDate(to, new Date());
  // A bare date means the whole of that day.
  if (to && String(to).length <= 10) end.setHours(23, 59, 59, 999);
  const start = toDate(from, new Date(end.getTime() - 30 * 864e5));

  const kinds = kind && SOURCES[kind] ? [kind] : Object.keys(SOURCES);
  const batches = await Promise.all(kinds.map((k) => SOURCES[k]({ from: start, to: end })));
  let rows = batches.flat();

  if (method) rows = rows.filter((row) => row.method === method);
  // Payments for one vehicle type: its rides, and the passes and top-ups of
  // the drivers who drive it. Rider wallet top-ups belong to no vehicle.
  const vehicleFilter = String(vehicleTypeId || '').trim();
  if (vehicleFilter) rows = rows.filter((row) => (row.vehicle_type_ids || []).includes(vehicleFilter));
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    rows = rows.filter((row) =>
      [row.payer.name, row.payer.phone, row.payee.name, row.payee.phone, row.reference, row.record_id, row.description]
        .some((value) => String(value || '').toLowerCase().includes(needle)),
    );
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const sum = (filter) => rows.filter(filter).reduce((total, row) => total + row.amount, 0);
  const round = (value) => Math.round(value * 100) / 100;
  const totals = {
    count: rows.length,
    received_online: round(sum((row) => row.method === 'online' && row.status === 'paid')),
    cash_with_drivers: round(sum((row) => row.method === 'cash' && row.status === 'paid')),
    paid_from_wallet: round(sum((row) => row.method === 'wallet')),
    covered_by_subscription: round(sum((row) => row.method === 'subscription')),
    pending_online: round(sum((row) => row.method === 'online' && row.status !== 'paid')),
  };

  const pageNumber = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 25));
  const pageRows = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);

  // Vehicle names for this page only.
  const vehicleIds = [...new Set(pageRows.flatMap((row) => row.vehicle_type_ids || []))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const vehicleNames = new Map(
    (await Vehicle.find({ _id: { $in: vehicleIds } }).select('name').lean())
      .map((vehicle) => [String(vehicle._id), vehicle.name]),
  );

  return {
    results: pageRows.map((row) => ({
      ...row,
      vehicle_names: (row.vehicle_type_ids || []).map((id) => vehicleNames.get(id)).filter(Boolean),
      kind_label: KIND_LABELS[row.kind],
      method_label: METHOD_LABELS[row.method] || titleCase(row.method),
      invoice_number: invoiceNumber(row.kind, row.record_id),
    })),
    totals,
    total: rows.length,
    page: pageNumber,
    limit: pageSize,
    from: start.toISOString(),
    to: end.toISOString(),
  };
};

const INVOICE_PREFIX = { ride: 'R', subscription: 'S', driver_top_up: 'T', rider_top_up: 'W' };

/// A stable, readable number for a payment: ZC-R-6ACCD2BC for a ride.
export const invoiceNumber = (kind, id) =>
  `ZC-${INVOICE_PREFIX[kind] || 'P'}-${String(id || '').slice(-8).toUpperCase()}`;

/// One payment by kind and id, in the list's row shape, for its invoice.
export const getPayment = async (kind, id) => {
  if (!SOURCES[kind] || !mongoose.Types.ObjectId.isValid(id)) return null;
  const [row] = await SOURCES[kind]({ onlyId: String(id) });
  return row
    ? { ...row, kind_label: KIND_LABELS[row.kind], method_label: METHOD_LABELS[row.method] || titleCase(row.method), invoice_number: invoiceNumber(row.kind, row.record_id) }
    : null;
};
