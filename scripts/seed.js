
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env.local' });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  mobile: String,
  password: String,
  verified: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: true });

const TrainSchema = new mongoose.Schema({
  trainName: String,
  trainNumber: String,
  origin: String,
  destination: String,
  departureTime: Date,
  arrivalTime: Date,
  totalSeats: Number,
  availableSeats: Number,
  status: { type: String, default: 'active' },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Train = mongoose.models.Train || mongoose.model('Train', TrainSchema);

const seedData = async () => {
  try {
    await connectDB();
    
    console.log('🧹 Cleaning existing data...');
    await User.deleteMany({});
    await Train.deleteMany({});

    console.log('👤 Creating admin user...');
    const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 12);
    
    const admin = new User({
      name: 'Admin User',
      email: process.env.ADMIN_EMAIL || 'admin@trainbooking.com',
      mobile: process.env.ADMIN_MOBILE || '+1234567890',
      password: adminPassword,
      verified: true,
      role: 'admin',
    });
    
    await admin.save();
    console.log('✅ Admin user created');

    console.log('🚂 Creating sample trains...');
    const sampleTrains = [
      {
        trainName: 'Rajdhani Express',
        trainNumber: 'RAJ001',
        origin: 'New Delhi',
        destination: 'Mumbai Central',
        departureTime: new Date('2025-08-26T08:00:00Z'),
        arrivalTime: new Date('2025-08-26T20:30:00Z'),
        totalSeats: 300,
        availableSeats: 300,
      },
      {
        trainName: 'Shatabdi Express',
        trainNumber: 'SHT002',
        origin: 'Chennai Central',
        destination: 'Bangalore City',
        departureTime: new Date('2025-08-26T06:00:00Z'),
        arrivalTime: new Date('2025-08-26T11:30:00Z'),
        totalSeats: 200,
        availableSeats: 200,
      },
      {
        trainName: 'Duronto Express',
        trainNumber: 'DUR003',
        origin: 'Kolkata',
        destination: 'New Delhi',
        departureTime: new Date('2025-08-26T18:45:00Z'),
        arrivalTime: new Date('2025-08-27T12:15:00Z'),
        totalSeats: 400,
        availableSeats: 400,
      },
      {
        trainName: 'Garib Rath',
        trainNumber: 'GAR004',
        origin: 'Mumbai Central',
        destination: 'Ahmedabad',
        departureTime: new Date('2025-08-27T14:20:00Z'),
        arrivalTime: new Date('2025-08-27T22:45:00Z'),
        totalSeats: 250,
        availableSeats: 250,
      },
      {
        trainName: 'Jan Shatabdi',
        trainNumber: 'JAN005',
        origin: 'Pune',
        destination: 'Mumbai Central',
        departureTime: new Date('2025-08-27T07:15:00Z'),
        arrivalTime: new Date('2025-08-27T10:30:00Z'),
        totalSeats: 150,
        availableSeats: 150,
      },
    ];

    await Train.insertMany(sampleTrains);
    console.log('✅ Sample trains created');

    console.log('🎉 Seed data created successfully!');
    console.log('\n📋 Summary:');
    console.log(`👤 Admin Email: ${admin.email}`);
    console.log(`📱 Admin Mobile: ${admin.mobile}`);
    console.log(`🔒 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
    console.log(`🚂 Trains Created: ${sampleTrains.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seedData();