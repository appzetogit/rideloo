import { ApiError } from '../../../utils/ApiError.js';

// The apps work out the fare and send it, and the server used to store it
// as-is: a rider could book any trip for 0 or 1 rupee, and commission, driver
// earnings and wallet charges all followed that number. This recomputes the
// fare from the same tariff and the server's own route, and refuses a booking
// whose fare is far outside it.
//
// It is a check, not a replacement: the rider is charged the fare they were
// shown. The band is wide because the apps route with their own map provider,
// may apply surge, a price hike, the airport fee or a platform fee, and round
// differently. It exists to stop invented fares, not to second-guess pennies.

// Below this share of the tariff fare a booking is refused. Real bookings
// checked against their tariff (Nov 2026) came in at 0.76-1.06 of it.
const MIN_RATIO = 0.6;
// Headroom over tariff x hike x surge. Wide on purpose: an app routing over a
// longer road than the server's route quoted 1.57x for an honest booking, and
// an overcharge is the rider's call to refuse, not a free ride.
const MAX_RATIO = 2.5;
// Flat headroom in rupees, so short trips priced near the base fare are not
// refused over a few rupees of difference.
const FLAT_TOLERANCE = 20;
// Assumed speed when no route came back and duration has to be estimated.
const FALLBACK_KMPH = 25;
// Road distance is longer than the straight line between two points.
const ROAD_FACTOR = 1.3;

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const straightLineMeters = (from, to) => {
  if (!Array.isArray(from) || !Array.isArray(to)) {
    return 0;
  }
  const [lng1, lat1] = from.map(Number);
  const [lng2, lat2] = to.map(Number);
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) {
    return 0;
  }
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/// The fare the rider app would quote for this tariff, distance and time.
/// Mirrors the formula in the rider app's vehicle picker; outstation trips
/// use the outstation fields when the tariff has them.
export const computeTariffFare = ({ pricingRule, distanceMeters, durationMinutes, serviceType = 'ride' }) => {
  if (!pricingRule) {
    return null;
  }
  const outstation = serviceType === 'intercity' && toNumber(pricingRule.outstation_base_price) > 0;
  const basePrice = toNumber(outstation ? pricingRule.outstation_base_price : pricingRule.base_price);
  const baseDistance = Math.max(0, toNumber(outstation ? pricingRule.outstation_base_distance : pricingRule.base_distance));
  const perKm = toNumber(outstation ? pricingRule.outstation_price_per_distance : pricingRule.price_per_distance);
  const perMinute = toNumber(outstation ? pricingRule.outstation_time_price : pricingRule.time_price);
  const serviceTax = toNumber(pricingRule.service_tax);

  const km = Math.max(0, toNumber(distanceMeters) / 1000);
  const minutes = Math.max(0, toNumber(durationMinutes));
  const subtotal = baseDistance > 0 && km <= baseDistance
    ? basePrice
    : basePrice + Math.max(0, km - baseDistance) * perKm + minutes * perMinute;

  if (!(subtotal > 0)) {
    return null;
  }
  return Math.round(subtotal + (subtotal * serviceTax) / 100);
};

/// Throws 400 when `fare` is implausible for the trip. Returns the bounds it
/// used (or null when there is no tariff to check against).
export const assertFareIsPlausible = ({
  fare,
  pricingRule,
  serviceType = 'ride',
  routedDistanceMeters = 0,
  routedDurationMinutes = 0,
  pickupCoords,
  dropCoords,
  surgeMultiplier = 1,
  priceHikeMultiplier = 1,
  airportFee = 0,
  platformFee = 0,
}) => {
  // Intercity is priced per package (a fixed price per destination, x1.8 for
  // a round trip) and parcels by the delivery tariff, neither of which follows
  // this per-km formula. Checking them here would refuse honest bookings, so
  // they only get the free-trip check until they have their own.
  if (serviceType !== 'ride') {
    if (!(toNumber(fare) > 0)) {
      throw new ApiError(400, 'Fare is missing for this trip. Please refresh and try again.');
    }
    return null;
  }

  const fallbackMeters = straightLineMeters(pickupCoords, dropCoords) * ROAD_FACTOR;
  const distanceMeters = routedDistanceMeters > 0 ? routedDistanceMeters : fallbackMeters;
  const durationMinutes = routedDurationMinutes > 0
    ? routedDurationMinutes
    : (distanceMeters / 1000 / FALLBACK_KMPH) * 60;

  const expected = computeTariffFare({ pricingRule, distanceMeters, durationMinutes, serviceType });
  if (expected === null) {
    // No tariff for this vehicle here: nothing to compare with. Still refuse a
    // free trip, which no tariff produces.
    if (!(toNumber(fare) > 0)) {
      throw new ApiError(400, 'Fare is missing for this trip. Please refresh and try again.');
    }
    return null;
  }

  const minFare = Math.floor(expected * MIN_RATIO);
  const maxFare = Math.ceil(
    expected * Math.max(1, toNumber(priceHikeMultiplier, 1)) * Math.max(1, toNumber(surgeMultiplier, 1)) * MAX_RATIO
      + Math.max(0, toNumber(airportFee)) + Math.max(0, toNumber(platformFee)) + FLAT_TOLERANCE,
  );

  if (fare < minFare || fare > maxFare) {
    console.warn('[fare-guard] refused fare', JSON.stringify({ fare, expected, minFare, maxFare, serviceType, distanceMeters: Math.round(distanceMeters), setPriceId: String(pricingRule?._id || '') }));
    throw new ApiError(400, 'This fare does not match current prices. Please refresh the fare and try again.', {
      expectedFare: expected,
      minFare,
      maxFare,
    });
  }
  return { expected, minFare, maxFare };
};
