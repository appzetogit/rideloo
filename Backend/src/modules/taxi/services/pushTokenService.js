import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { BusDriver } from '../driver/models/BusDriver.js';
import { User } from '../user/models/User.js';
import { Owner } from '../admin/models/Owner.js';
import { PoolingVehicle } from '../admin/models/PoolingVehicle.js';
import { ServiceStore } from '../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../admin/models/ServiceCenterStaff.js';

const MOBILE_PLATFORMS = new Set(['android', 'ios', 'mobile']);
const WEB_PLATFORMS = new Set(['web', 'browser', 'pwa']);

export const normalizePushPlatform = (platform) => {
  const normalized = String(platform || '').trim().toLowerCase();

  if (WEB_PLATFORMS.has(normalized)) {
    return 'web';
  }

  if (MOBILE_PLATFORMS.has(normalized)) {
    return 'mobile';
  }

  throw new ApiError(400, 'platform must be web, android, ios, or mobile');
};

export const normalizePushToken = (token) => {
  const normalized = String(token || '').trim();

  if (!normalized) {
    throw new ApiError(400, 'token is required');
  }

  if (normalized.length < 20) {
    throw new ApiError(400, 'token looks invalid');
  }

  return normalized;
};

export const getPushTokenField = (platform) =>
  normalizePushPlatform(platform) === 'web' ? 'fcmTokenWeb' : 'fcmTokenMobile';

export const assignPushTokenToEntity = (entity, { token, platform }) => {
  const normalizedToken = normalizePushToken(token);
  const normalizedPlatform = normalizePushPlatform(platform);
  const fieldName = getPushTokenField(normalizedPlatform);

  entity[fieldName] = normalizedToken;
  entity.set?.('fcmTokens', undefined, { strict: false });

  return {
    token: normalizedToken,
    platform: normalizedPlatform,
    fieldName,
  };
};

// Every model that can hold an FCM token.
const PUSH_TOKEN_MODELS = [Driver, BusDriver, User, Owner, PoolingVehicle, ServiceStore, ServiceCenterStaff];

// A device token belongs to one app install, so it may only sit on the account
// that is logged in on that install right now. Called when an account saves a
// token: the same token is cleared from every other account (any role) that
// still has it. Without this, when driver A logs out and driver B logs in on
// the same phone, A keeps the token and A's ride offers and trip pushes land
// on B's phone. This also covers old app builds that never call logout, and a
// logout call that failed because the phone was offline.
export const releasePushTokenFromOthers = async (token, entity) => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return 0;
  }

  const ownerId = entity?._id;
  const ownerCollection = entity?.constructor?.collection?.name;

  const results = await Promise.all(
    PUSH_TOKEN_MODELS.flatMap((Model) =>
      ['fcmTokenMobile', 'fcmTokenWeb'].map((field) => {
        const filter = { [field]: normalizedToken };
        if (ownerId && Model.collection.name === ownerCollection) {
          filter._id = { $ne: ownerId };
        }
        // strict: false - not every model declares both fields.
        return Model.updateMany(filter, { $set: { [field]: '' } }, { strict: false })
          .then((result) => result?.modifiedCount || 0)
          .catch(() => 0);
      }),
    ),
  );

  return results.reduce((sum, count) => sum + count, 0);
};

export const listEntityPushTokens = (entity = {}, role = 'unknown') => {
  const mobileToken = String(entity.fcmTokenMobile || '').trim();
  const webToken = String(entity.fcmTokenWeb || '').trim();

  // Prioritize mobile token to prevent double notifications on the same device
  // (e.g. in hybrid/webview wrappers where the same device registers both web & mobile FCM tokens).
  if (mobileToken) {
    return [{ role, field: 'fcmTokenMobile', platform: 'mobile', token: mobileToken }];
  }

  if (webToken) {
    return [{ role, field: 'fcmTokenWeb', platform: 'web', token: webToken }];
  }

  return [];
};
