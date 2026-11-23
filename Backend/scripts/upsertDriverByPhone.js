import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';
import { hashPassword } from '../src/modules/taxi/services/passwordService.js';

const DEFAULT_COORDINATES = [75.8577, 22.7196];
const SEEDED_BY = 'Backend/scripts/upsertDriverByPhone.js';

const phone = String(process.argv[2] || '').trim();

if (!/^\d{10}$/.test(phone)) {
  throw new Error('Usage: node scripts/upsertDriverByPhone.js <10-digit-phone>');
}

const connect = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    dbName: env.mongoDbName,
  });
};

const buildReferralCode = (value) => `DRV${String(value || '').slice(-4)}SEED`;
const buildEmail = (value) => `driver.${value}@Appzeto 24.local`;

const ensureServiceLocation = async () => {
  const existing = await ServiceLocation.findOne({
    $or: [
      { legacy_id: 'static-indore' },
      { service_location_name: 'Indore' },
      { name: 'Indore' },
    ],
  });

  if (existing) return existing;

  return ServiceLocation.create({
    name: 'Indore',
    legacy_id: 'static-indore',
    company_key: 'static',
    service_location_name: 'Indore',
    address: 'Indore, Madhya Pradesh, India',
    country: 'India',
    currency_name: 'Indian Rupee',
    currency_symbol: 'Rs',
    currency_code: 'INR',
    timezone: 'Asia/Kolkata',
    unit: 'km',
    latitude: DEFAULT_COORDINATES[1],
    longitude: DEFAULT_COORDINATES[0],
    location: {
      type: 'Point',
      coordinates: DEFAULT_COORDINATES,
    },
    status: 'active',
    active: true,
  });
};

// Rough area of a zone's outer ring, to rank nested zones by size - mirrors
// matchingService.pickMostSpecificZone.
const zoneRingArea = (zone) => {
  const ring = zone?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return Number.POSITIVE_INFINITY;
  }
  let twiceArea = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    twiceArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(twiceArea / 2);
};

// The real, active zone already covering the seed driver's coordinates, resolved
// like a real pickup (smallest containing polygon wins).
const findCoveringZone = async () => {
  try {
    const [lng, lat] = DEFAULT_COORDINATES;
    const covering = await Zone.find({
      active: { $ne: false },
      status: { $ne: 'inactive' },
      geometry: {
        $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } },
      },
    }).lean();
    if (!covering.length) return null;
    return [...covering].sort((a, b) => zoneRingArea(a) - zoneRingArea(b))[0];
  } catch {
    return null;
  }
};

const ensureZone = async (serviceLocationId) => {
  // Prefer an existing real city zone instead of creating a tiny 'Static Seed
  // Zone' box that would shadow it in pickMostSpecificZone(). The seed box is a
  // last resort for an empty database only.
  const realZone = await findCoveringZone();
  if (realZone) return realZone;

  const existing = await Zone.findOne({
    $or: [
      { name: 'Static Seed Zone' },
      { service_location_id: serviceLocationId },
    ],
  });

  if (existing) return existing;

  const [lng, lat] = DEFAULT_COORDINATES;
  const offset = 0.05;

  return Zone.create({
    name: 'Static Seed Zone',
    service_location_id: serviceLocationId,
    unit: 'km',
    active: true,
    status: 'active',
    boundary_mode: 'polygon',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - offset, lat - offset],
        [lng + offset, lat - offset],
        [lng + offset, lat + offset],
        [lng - offset, lat + offset],
        [lng - offset, lat - offset],
      ]],
    },
  });
};

const main = async () => {
  await connect();

  const serviceLocation = await ensureServiceLocation();
  const zone = await ensureZone(serviceLocation._id);
  // Driver's service location follows the resolved zone (real city zone carries
  // its own, often null; only the fallback seed zone carries the seeded one).
  const driverServiceLocationId = zone.service_location_id ?? null;
  const completedAt = new Date();
  const passwordHash = await hashPassword(`driver-${phone}`);

  const driver = await Driver.findOneAndUpdate(
    { phone },
    {
      $set: {
        name: `Seed Driver ${phone.slice(-4)}`,
        phone,
        email: buildEmail(phone),
        gender: 'male',
        password: passwordHash,
        service_location_id: driverServiceLocationId,
        vehicleType: 'car',
        vehicleIconType: 'car',
        vehicleMake: 'Maruti Suzuki',
        vehicleModel: 'WagonR',
        registerFor: 'taxi',
        serviceCategories: ['taxi'],
        vehicleNumber: `MP09${phone.slice(-4)}`,
        vehicleColor: 'White',
        city: 'Indore',
        approve: true,
        status: 'approved',
        isOnline: false,
        isOnRide: false,
        zoneId: zone._id,
        location: {
          type: 'Point',
          coordinates: DEFAULT_COORDINATES,
        },
        referralCode: buildReferralCode(phone),
        documents: {},
        onboarding: {
          registrationId: `seed-driver-${phone}`,
          role: 'driver',
          otpMode: 'seeded',
          otpVerifiedAt: completedAt,
          submittedAt: completedAt,
          completedAt,
          seededBy: SEEDED_BY,
          completed: true,
        },
      },
      $unset: {
        deletedAt: 1,
        deletion_reason: 1,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ).select('+password');

  console.log(JSON.stringify({
    ok: true,
    phone,
    driverId: String(driver._id),
    status: driver.status,
    approve: driver.approve,
    onboarding: driver.onboarding,
    serviceLocationId: String(serviceLocation._id),
    zoneId: String(zone._id),
  }));
};

main()
  .catch((error) => {
    console.error('[upsertDriverByPhone] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => { });
  });
