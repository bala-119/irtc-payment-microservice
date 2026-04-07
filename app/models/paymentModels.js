const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Payment identifiers
  payment_id: { type: String, unique: true, required: true, index: true },
  stripe_payment_intent_id: { type: String, unique: true, sparse: true },
  stripe_session_id: { type: String, unique: true, sparse: true },
  
  // Booking details
  booking_id: { type: String, required: true, index: true },
  pnr: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  
  // User details
  user_name: { type: String, required: true },
  user_email: { type: String, required: true, index: true },
  user_phone: { type: String },
  
  // Payment details
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  payment_method: {
    type: String,
    enum: ['CARD', 'UPI', 'NET_BANKING', 'WALLET'],
    required: true
  },
  
  // Payment status
  status: {
    type: String,
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED'],
    default: 'PENDING'
  },
  
  // Stripe response details
  stripe_response: {
    type: Object,
    default: {}
  },
  
  // Transaction details
  transaction_id: { type: String },
  failure_reason: { type: String },
  refund_id: { type: String },
  refund_amount: { type: Number },
  
  // Metadata
  metadata: {
    type: Map,
    of: String,
    default: {}
  },
  
  // Timestamps
  payment_date: { type: Date, default: Date.now },
  refund_date: { type: Date },
  
}, { timestamps: true });

// Indexes for faster queries
paymentSchema.index({ user_id: 1, status: 1 });
paymentSchema.index({ pnr: 1, status: 1 });
paymentSchema.index({ created_at: -1 });

// Virtual for formatted amount
paymentSchema.virtual('formatted_amount').get(function() {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: this.currency
  }).format(this.amount);
});

module.exports = mongoose.model('Payment', paymentSchema);