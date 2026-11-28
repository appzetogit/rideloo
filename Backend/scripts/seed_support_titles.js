/**
 * Seed the default support ticket categories for drivers and riders.
 *
 * Usage (from Backend/):  node scripts/seed_support_titles.js
 *
 * Connects through config/database.js, so it writes to the database the app
 * reads (MONGODB_DB_NAME). A bare mongoose.connect(MONGODB_URI) would not: the
 * URI carries no database name, so the rows would land in "test" and the app
 * would still list none.
 *
 * Idempotent: an existing title for the same user type is left as it is.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/database.js';
import { SupportTicketTitle } from '../src/modules/taxi/support/models/SupportTicketTitle.js';

const CATEGORIES = {
  driver: [
    'Ride & Trip Issues',
    'Fare & Earnings Query',
    'Wallet & Withdrawal',
    'Vehicle & Documents',
    'Account & App Issues',
    'Other Issues',
  ],
  user: [
    'Ride & Driver Issues',
    'Fare & Payment Query',
    'Cancellation Charges',
    'Safety or Lost Item',
    'Account & App Issues',
    'Other Issues',
  ],
};

await connectDatabase();

// The titles endpoint lists newest first, so the first category is created
// last: the apps then show them in the order written above.
const base = Date.now();
for (const [userType, titles] of Object.entries(CATEGORIES)) {
  const total = titles.length;
  for (const [index, title] of titles.entries()) {
    const existing = await SupportTicketTitle.findOne({ title, userType });
    if (existing) {
      console.log(`[Exists]  ${userType}: ${title}`);
      continue;
    }
    const at = new Date(base + (total - index) * 1000);
    await SupportTicketTitle.create({ title, userType, supportType: 'general', active: true, createdAt: at, updatedAt: at });
    console.log(`[Created] ${userType}: ${title}`);
  }
}

await mongoose.disconnect();
process.exit(0);
