import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Train from '../models/Train.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';

dotenv.config();

const addIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Train indexes for faster searches
    await Train.collection.createIndex({ origin: 1, destination: 1, departureTime: 1 });
    await Train.collection.createIndex({ status: 1, departureTime: 1 });
    await Train.collection.createIndex({ trainNumber: 1 }, { unique: true });
    console.log('✅ Train indexes created');

    // Booking indexes for faster queries
    await Booking.collection.createIndex({ userId: 1, createdAt: -1 });
    await Booking.collection.createIndex({ trainId: 1 });
    await Booking.collection.createIndex({ bookingReference: 1 }, { unique: true });
    await Booking.collection.createIndex({ status: 1 });
    await Booking.collection.createIndex({ 'payment.orderId': 1 });
    console.log('✅ Booking indexes created');

    // User indexes
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ mobile: 1 }, { unique: true });
    console.log('✅ User indexes created');

    console.log('✅ All indexes created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  }
};

addIndexes();
