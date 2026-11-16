import { connectDatabase } from '../src/config/database.js';
import { CancellationReason } from '../src/modules/taxi/admin/models/CancellationReason.js';
import { DEFAULT_CANCELLATION_REASONS } from '../src/modules/taxi/admin/controllers/cancellationReasonController.js';

const seed = async () => {
  try {
    await connectDatabase();
    console.log('Connected to MongoDB. Seeding cancellation reasons...');

    for (const reason of DEFAULT_CANCELLATION_REASONS) {
      await CancellationReason.findOneAndUpdate(
        { title: reason.title, audience: reason.audience },
        { $setOnInsert: reason },
        { upsert: true, new: true }
      );
    }

    const total = await CancellationReason.countDocuments();
    console.log(`Successfully ensured cancellation reasons. Total in database: ${total}`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed cancellation reasons:', error);
    process.exit(1);
  }
};

seed();
