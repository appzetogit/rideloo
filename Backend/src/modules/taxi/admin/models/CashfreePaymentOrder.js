import mongoose from 'mongoose';

// Every Cashfree order the backend creates, so a payment can be traced even
// when the app never came back to use it (e.g. a rental advance paid, then the
// app closed before the booking was made). Written best-effort: payments never
// fail because this record could not be saved.
const cashfreePaymentOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, trim: true },
    purpose: { type: String, default: '', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, default: null },
    rideId: { type: mongoose.Schema.Types.ObjectId, default: null },
    bookingReference: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    // Cashfree order_status, lower case: active, paid, expired, terminated...
    status: { type: String, default: 'active', index: true },
    paidAt: { type: Date, default: null },
    isProduction: { type: Boolean, default: false },
  },
  { timestamps: true },
);

cashfreePaymentOrderSchema.index({ purpose: 1, status: 1, createdAt: -1 });

export const CashfreePaymentOrder =
  mongoose.models.TaxiCashfreePaymentOrder ||
  mongoose.model('TaxiCashfreePaymentOrder', cashfreePaymentOrderSchema);
