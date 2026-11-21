import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { User } from '../src/modules/taxi/user/models/User.js';

// Usage: node scripts/upsertUserByPhone.js <10-digit-phone> [name]
// Idempotent: upserts a rider account by phone so a demo/test number can log in
// (pair it with DEMO_LOGIN_PHONES so the number accepts a fixed OTP).
const phone = String(process.argv[2] || '').trim();
const name = String(process.argv[3] || `Seed User ${phone.slice(-4)}`).trim();

if (!/^\d{10}$/.test(phone)) {
  throw new Error('Usage: node scripts/upsertUserByPhone.js <10-digit-phone> [name]');
}

const connect = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    dbName: env.mongoDbName,
  });
};

const main = async () => {
  await connect();

  const user = await User.findOneAndUpdate(
    { phone },
    {
      $set: {
        phone,
        name,
        countryCode: '+91',
        role: 'USER',
        isVerified: true,
        isActive: true,
        active: true,
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

  console.log(JSON.stringify({
    ok: true,
    phone,
    userId: String(user._id),
    name: user.name,
    isActive: user.isActive,
  }));
};

main()
  .catch((error) => {
    console.error('[upsertUserByPhone] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
