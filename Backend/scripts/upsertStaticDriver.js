import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { Owner } from '../src/modules/taxi/admin/models/Owner.js';
import { ServiceCenterStaff } from '../src/modules/taxi/admin/models/ServiceCenterStaff.js';
import { ServiceStore } from '../src/modules/taxi/admin/models/ServiceStore.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { BusDriver } from '../src/modules/taxi/driver/models/BusDriver.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';
import { hashPassword } from '../src/modules/taxi/services/passwordService.js';

const STATIC_PHONE = String(env.sms?.staticOtpPhone || '7610416911').trim();
const STATIC_OTP = String(env.sms?.staticOtpCode || '0000').trim();
const SEEDED_BY = 'Backend/scripts/upsertStaticDriver.js';
const DEFAULT_COORDINATES = [75.8577, 22.7196];

const connect = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    dbName: env.mongoDbName,
  });
};

const buildReferralCode = (phone) => `DRV${String(phone || '').slice(-4)}STATIC`;
const buildRoleEmail = (role) => `${role}.${STATIC_PHONE}@Appzeto 24.local`;
const now = () => new Date();

const ensureServiceLocation = async () => {
  const existing = await ServiceLocation.findOne({
    $or: [
      { legacy_id: 'static-indore' },
      { service_location_name: 'Indore' },
      { name: 'Indore' },
    ],
  });

  if (existing) {
    return existing;
  }

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
// matchingService.pickMostSpecificZone so this script lands the static driver in
// the SAME zone a real pickup at these coordinates would resolve to.
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

// The real, active zone that already covers the static driver's coordinates, if
// any - resolved the same way dispatch resolves a pickup (smallest containing
// polygon wins).
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

    if (!covering.length) {
      return null;
    }

    return [...covering].sort((a, b) => zoneRingArea(a) - zoneRingArea(b))[0];
  } catch {
    // No geo index yet (fresh local DB) etc. - fall back to the seed zone below.
    return null;
  }
};

const ensureZone = async (serviceLocationId) => {
  // Prefer an existing real city zone (e.g. 'indore'). This is the important
  // change: the script used to always create a tiny 'Static Seed Zone' box,
  // which - being smaller than the real zone - shadowed it in
  // pickMostSpecificZone(), so every pickup resolved to the seed zone (which has
  // no setprices). Reusing the real zone means no shadow is ever created on a
  // configured deployment. The seed box is now only a last resort for an empty
  // database (fresh local dev).
  const realZone = await findCoveringZone();
  if (realZone) {
    return realZone;
  }

  const existing = await Zone.findOne({
    $or: [
      { name: 'Static Seed Zone' },
      { service_location_id: serviceLocationId },
    ],
  });

  if (existing) {
    return existing;
  }

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

const upsertDriver = async (passwordHash, serviceLocationId, zoneId) => {
  const completedAt = now();
  return Driver.findOneAndUpdate(
    { phone: STATIC_PHONE },
    {
      $set: {
        name: 'Static Test Driver',
        phone: STATIC_PHONE,
        email: buildRoleEmail('driver'),
        gender: 'male',
        password: passwordHash,
        service_location_id: serviceLocationId,
        vehicleType: 'car',
        vehicleIconType: 'car',
        vehicleMake: 'Maruti Suzuki',
        vehicleModel: 'WagonR',
        registerFor: 'taxi',
        serviceCategories: ['taxi'],
        vehicleNumber: 'MP09AB1234',
        vehicleColor: 'White',
        city: 'Indore',
        approve: true,
        status: 'approved',
        isOnline: false,
        isOnRide: false,
        zoneId,
        location: {
          type: 'Point',
          coordinates: DEFAULT_COORDINATES,
        },
        referralCode: buildReferralCode(STATIC_PHONE),
        documents: {},
        onboarding: {
          registrationId: `static-driver-${STATIC_PHONE}`,
          role: 'driver',
          otpMode: STATIC_OTP ? 'static' : 'generated',
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
  );
};

const upsertOwner = async (passwordHash, serviceLocationId) => {
  const completedAt = now();
  return Owner.findOneAndUpdate(
    { mobile: STATIC_PHONE },
    {
      $set: {
        company_name: 'Static Fleet',
        owner_name: 'Static Owner',
        name: 'Static Owner',
        mobile: STATIC_PHONE,
        phone: STATIC_PHONE,
        email: buildRoleEmail('owner'),
        password: passwordHash,
        service_location_id: serviceLocationId,
        transport_type: 'taxi',
        address: 'Indore, Madhya Pradesh, India',
        postal_code: '452001',
        city: 'Indore',
        tax_number: 'STATICTAX7610',
        active: true,
        approve: true,
        status: 'approved',
        user_snapshot: {
          source: 'owner_onboarding',
          registrationId: `static-owner-${STATIC_PHONE}`,
          verifiedAt: completedAt,
          submittedAt: completedAt,
          completedAt,
          seededBy: SEEDED_BY,
          completed: true,
        },
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  );
};

const upsertServiceStore = async (serviceLocationId, zoneId) => ServiceStore.findOneAndUpdate(
  { owner_phone: STATIC_PHONE },
  {
    $set: {
      name: 'Static Service Center',
      zone_id: zoneId,
      service_location_id: serviceLocationId,
      address: 'Indore, Madhya Pradesh, India',
      owner_name: 'Static Center Owner',
      owner_phone: STATIC_PHONE,
      latitude: DEFAULT_COORDINATES[1],
      longitude: DEFAULT_COORDINATES[0],
      location: {
        type: 'Point',
        coordinates: DEFAULT_COORDINATES,
      },
      status: 'active',
      active: true,
    },
  },
  {
    returnDocument: 'after',
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  },
);

const upsertServiceStaff = async (serviceCenterId) => ServiceCenterStaff.findOneAndUpdate(
  { phone: STATIC_PHONE },
  {
    $set: {
      serviceCenterId,
      name: 'Static Service Staff',
      phone: STATIC_PHONE,
      active: true,
      status: 'active',
      biometrics: [],
    },
  },
  {
    returnDocument: 'after',
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  },
);

const upsertBusDriver = async () => BusDriver.findOneAndUpdate(
  { phone: STATIC_PHONE },
  {
    $set: {
      name: 'Static Bus Driver',
      phone: STATIC_PHONE,
      email: buildRoleEmail('bus-driver'),
      approve: true,
      active: true,
      status: 'approved',
      operatorName: 'Static Fleet',
      busName: 'Static Express',
      serviceNumber: 'BUS-7610',
      registrationNumber: 'MP09BUS7610',
      routeName: 'Indore Central',
      originCity: 'Indore',
      destinationCity: 'Indore',
      lastLoginAt: null,
    },
  },
  {
    returnDocument: 'after',
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  },
);

const main = async () => {
  if (!STATIC_PHONE) {
    throw new Error('STATIC_OTP_PHONE is missing');
  }

  await connect();

  const passwordHash = await hashPassword(`static-driver-${STATIC_PHONE}`);
  const serviceLocation = await ensureServiceLocation();
  const zone = await ensureZone(serviceLocation._id);

  // The driver's service location must follow whatever zone we resolved: a real
  // city zone (e.g. 'indore') carries its own service_location_id (often null),
  // so matching stays consistent with a real pickup. Only the fallback seed zone
  // carries the seeded 'Indore' service location.
  const driverServiceLocationId = zone.service_location_id ?? null;

  const driver = await upsertDriver(passwordHash, driverServiceLocationId, zone._id);
  const owner = await upsertOwner(passwordHash, serviceLocation._id);
  const serviceCenter = await upsertServiceStore(serviceLocation._id, zone._id);
  const staff = await upsertServiceStaff(serviceCenter._id);
  const busDriver = await upsertBusDriver();

  console.log(
    JSON.stringify(
      {
        ok: true,
        phone: STATIC_PHONE,
        staticOtp: STATIC_OTP,
        serviceLocationId: String(serviceLocation._id),
        zoneId: String(zone._id),
        accounts: {
          driver: {
            id: String(driver._id),
            status: driver.status,
            approve: driver.approve,
          },
          owner: {
            id: String(owner._id),
            status: owner.status,
            approve: owner.approve,
          },
          service_center: {
            id: String(serviceCenter._id),
            status: serviceCenter.status,
            active: serviceCenter.active,
          },
          service_center_staff: {
            id: String(staff._id),
            status: staff.status,
            active: staff.active,
          },
          bus_driver: {
            id: String(busDriver._id),
            status: busDriver.status,
            approve: busDriver.approve,
          },
        },
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
