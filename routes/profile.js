import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import { authenticate } from '../middleware/auth.js';
import { sendResponse, asyncHandler } from '../utils/helpers.js';
import { HTTP_STATUS } from '../utils/constants.js';

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// All routes require authentication
router.use(authenticate);

// Get user profile
router.get('/', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password -otp -resetPasswordToken -resetPasswordExpires');

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  // Get booking statistics
  const totalBookings = await Booking.countDocuments({ userId: req.user.id });
  const activeBookings = await Booking.countDocuments({ userId: req.user.id, status: 'confirmed' });
  const completedBookings = await Booking.countDocuments({ userId: req.user.id, status: 'completed' });

  sendResponse(res, HTTP_STATUS.OK, true, 'Profile fetched successfully', {
    user,
    stats: {
      totalBookings,
      activeBookings,
      completedBookings,
    },
  });
}));

// Update profile (name, email, mobile)
router.put('/', asyncHandler(async (req, res) => {
  const { name, email, mobile } = req.body;

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  // Check if email is being changed and if it's already taken
  if (email && email !== user.email) {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Email already in use');
    }
    user.email = email;
    user.verified = false; // Require re-verification if email changed
  }

  // Check if mobile is being changed and if it's already taken
  if (mobile && mobile !== user.mobile) {
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Mobile number already in use');
    }
    user.mobile = mobile;
  }

  if (name) user.name = name;

  await user.save();

  const userResponse = user.toObject();
  delete userResponse.password;
  delete userResponse.otp;
  delete userResponse.resetPasswordToken;
  delete userResponse.resetPasswordExpires;

  sendResponse(res, HTTP_STATUS.OK, true, 'Profile updated successfully', userResponse);
}));

// Change password
router.put('/change-password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Current password and new password are required');
  }

  if (newPassword.length < 6) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'New password must be at least 6 characters');
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  // Verify current password
  const isMatch = await bcrypt.compare(currentPassword, user.password);

  if (!isMatch) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Current password is incorrect');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);

  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Password changed successfully');
}));

// Upload profile picture
router.post('/profile-picture', upload.single('profilePicture'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'No file uploaded');
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  // Delete old profile picture from Cloudinary if exists
  if (user.profilePicture?.publicId) {
    try {
      await cloudinary.uploader.destroy(user.profilePicture.publicId);
    } catch (error) {
      console.error('Error deleting old profile picture:', error);
    }
  }

  // Upload to Cloudinary
  const uploadPromise = new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'train-booking/profiles',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto' },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    uploadStream.end(req.file.buffer);
  });

  const result = await uploadPromise;

  user.profilePicture = {
    url: result.secure_url,
    publicId: result.public_id,
  };

  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Profile picture updated successfully', {
    profilePicture: user.profilePicture,
  });
}));

// Delete profile picture
router.delete('/profile-picture', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  if (!user.profilePicture?.publicId) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'No profile picture to delete');
  }

  // Delete from Cloudinary
  try {
    await cloudinary.uploader.destroy(user.profilePicture.publicId);
  } catch (error) {
    console.error('Error deleting profile picture:', error);
  }

  user.profilePicture = undefined;
  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Profile picture deleted successfully');
}));

// Get travel history
router.get('/travel-history', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const bookings = await Booking.find({ userId: req.user.id })
    .populate({
      path: 'trainId',
      select: 'trainName trainNumber origin destination departureTime arrivalTime',
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Booking.countDocuments({ userId: req.user.id });

  sendResponse(res, HTTP_STATUS.OK, true, 'Travel history fetched successfully', {
    bookings,
    pagination: {
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalBookings: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
}));

// Saved passengers (templates)
router.get('/saved-passengers', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('savedPassengers');

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'Saved passengers fetched successfully', {
    savedPassengers: user.savedPassengers,
  });
}));

router.post('/saved-passengers', asyncHandler(async (req, res) => {
  const { name, age, relation } = req.body;

  if (!name || !age) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Name and age are required');
  }

  if (age < 1 || age > 120) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Age must be between 1 and 120');
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  user.savedPassengers.push({ name, age, relation });
  await user.save();

  sendResponse(res, HTTP_STATUS.CREATED, true, 'Passenger saved successfully', {
    savedPassengers: user.savedPassengers,
  });
}));

router.delete('/saved-passengers/:passengerId', asyncHandler(async (req, res) => {
  const { passengerId } = req.params;

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  user.savedPassengers = user.savedPassengers.filter(
    (passenger) => passenger._id.toString() !== passengerId
  );

  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Passenger deleted successfully', {
    savedPassengers: user.savedPassengers,
  });
}));

// Favorite routes
router.get('/favorite-routes', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('favoriteRoutes');

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'Favorite routes fetched successfully', {
    favoriteRoutes: user.favoriteRoutes,
  });
}));

router.post('/favorite-routes', asyncHandler(async (req, res) => {
  const { origin, destination } = req.body;

  if (!origin || !destination) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Origin and destination are required');
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  // Check if route already exists
  const existingRoute = user.favoriteRoutes.find(
    (route) => route.origin === origin && route.destination === destination
  );

  if (existingRoute) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Route already in favorites');
  }

  user.favoriteRoutes.push({ origin, destination });
  await user.save();

  sendResponse(res, HTTP_STATUS.CREATED, true, 'Route added to favorites', {
    favoriteRoutes: user.favoriteRoutes,
  });
}));

router.delete('/favorite-routes/:routeId', asyncHandler(async (req, res) => {
  const { routeId } = req.params;

  const user = await User.findById(req.user.id);

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'User not found');
  }

  user.favoriteRoutes = user.favoriteRoutes.filter(
    (route) => route._id.toString() !== routeId
  );

  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Route removed from favorites', {
    favoriteRoutes: user.favoriteRoutes,
  });
}));

export default router;
