
import mongoose from 'mongoose';

const BookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  trainId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Train',
    required: true,
  },
  passengers: [{
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    age: {
      type: Number,
      required: true,
      min: 1,
      max: 120,
    },
  }],
  totalSeatsBooked: {
    type: Number,
    required: true,
    min: 1,
  },
  classType: {
    type: String,
    enum: ["AC", "Non-AC", "Sleeper", "Seater", "First Class", "Second Class"],
    required: true,
  },
  bookingTime: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['confirmed', 'cancelled', 'completed'],
    default: 'confirmed',
  },
  bookingReference: {
    type: String,
    unique: true,
  },
  payment: {
    orderId: {
      type: String,
    },
    paymentId: {
      type: String,
    },
    signature: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    method: {
      type: String,
      enum: ['card', 'netbanking', 'upi', 'wallet', 'emi'],
    },
    paidAt: {
      type: Date,
    },
  },
}, {
  timestamps: true,
});

BookingSchema.pre('save', function(next) {
  if (this.isNew) {
    this.bookingReference = 'TRB' + Date.now().toString(36).toUpperCase() + 
                           Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  next();
});


export default mongoose.models.Booking || mongoose.model('Booking', BookingSchema);