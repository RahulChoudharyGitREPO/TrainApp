
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