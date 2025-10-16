# 🚂 Train Booking System - Advanced Features

A comprehensive, production-ready train booking system with real-time seat availability, PDF ticket generation with QR codes, advanced search filters, and complete user profile management.

## ✨ Features

### 🎫 Email Tickets with QR Code
- Professional PDF ticket generation with QR codes
- Automatic email delivery with ticket attachment
- Beautiful ticket design with all journey details
- E-ticket verification endpoint for fraud prevention

### 🔍 Advanced Search & Filters
- Search trains by origin, destination, and date
- Filter by class (AC, Non-AC, Sleeper, etc.)
- Price range filtering
- Sort by price, duration, or departure time
- Paginated results

### 👤 User Profile Management
- Update profile information (name, email, mobile)
- Change password securely
- Upload/delete profile pictures (Cloudinary)
- Save passenger templates for quick booking
- Manage favorite routes
- View complete travel history

### 🔴 Real-time Seat Availability
- WebSocket integration with Socket.io
- Live seat updates across all connected users
- "X people viewing" indicator
- Real-time booking notifications
- Prevents race conditions visually

### 🔒 Security Features
- JWT-based authentication
- Password hashing with bcrypt
- OTP verification for email
- Password reset functionality
- Rate limiting on API endpoints
- Helmet for security headers

## 🛠️ Tech Stack

### Backend
- **Node.js** & **Express** - Server framework
- **MongoDB** & **Mongoose** - Database
- **Socket.io** - WebSocket for real-time features
- **jsPDF** - PDF generation
- **QRCode** - QR code generation
- **Nodemailer** - Email service
- **Cloudinary** - Image storage
- **Multer** - File upload handling
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication

### Features Implemented
- Transaction-safe bookings (MongoDB sessions)
- Real-time updates via WebSocket
- PDF generation with professional design
- Image upload with optimization
- Advanced filtering and sorting
- Comprehensive error handling

## 📋 Prerequisites

- **Node.js** v16 or higher
- **MongoDB** (local or Atlas)
- **Gmail account** (for emails)
- **Cloudinary account** (for profile pictures)

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd TrainApp
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:
- MongoDB URI
- JWT secret
- Gmail credentials (app password)
- Cloudinary credentials

### 3. Start the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will start on `http://localhost:5000`

### 4. Test the API

```bash
curl http://localhost:5000/api/health
```

## 📚 Documentation

- **[API Documentation](API_DOCUMENTATION.md)** - Complete API reference
- **[Setup Guide](SETUP_GUIDE.md)** - Detailed setup instructions
- **[Features Summary](FEATURES_SUMMARY.md)** - Overview of all features
- **[WebSocket Demo](WEBSOCKET_EXAMPLE.html)** - Interactive demo

## 🎯 Key Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

### Trains
- `GET /api/trains` - Search trains with filters
- `GET /api/trains/:id` - Get train details
- `GET /api/trains/search/routes` - Get available routes

### Bookings
- `POST /api/bookings` - Create booking (sends PDF ticket)
- `GET /api/bookings` - Get user bookings
- `POST /api/bookings/verify-ticket` - Verify QR code
- `PUT /api/bookings/:id/cancel` - Cancel booking

### Profile
- `GET /api/profile` - Get profile with stats
- `PUT /api/profile` - Update profile
- `POST /api/profile/profile-picture` - Upload picture
- `GET /api/profile/saved-passengers` - Get saved passengers
- `POST /api/profile/favorite-routes` - Add favorite route

## 🔌 WebSocket Usage

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

// Join train room
socket.emit('join-train', trainId);

// Listen for updates
socket.on('seat-update', (data) => {
  console.log('Seats available:', data.availableSeats);
});

socket.on('viewer-count', (data) => {
  console.log('Viewers:', data.count);
});
```

## 📁 Project Structure

```
TrainApp/
├── models/              # MongoDB models
│   ├── User.js
│   ├── Train.js
│   └── Booking.js
├── routes/              # API routes
│   ├── auth.js
│   ├── trains.js
│   ├── bookings.js
│   ├── profile.js
│   └── admin.js
├── lib/                 # Core utilities
│   ├── db.js
│   ├── email.js
│   └── otp.js
├── utils/               # Helper functions
│   ├── helpers.js       # PDF generation, etc.
│   └── constants.js
├── middleware/          # Express middleware
│   ├── auth.js
│   └── admin.js
├── server.js            # Main server file
├── package.json
├── .env.example
└── README.md
```

## 🧪 Testing

### Test PDF Generation
1. Create a booking via API
2. Check email for PDF ticket
3. Scan QR code with verification endpoint

### Test WebSocket
1. Open `WEBSOCKET_EXAMPLE.html` in multiple tabs
2. Make a booking
3. See real-time updates in all tabs

### Test Profile Features
```bash
# Upload profile picture
curl -X POST http://localhost:5000/api/profile/profile-picture \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "profilePicture=@image.jpg"
```

## 🔐 Security

- JWT tokens expire after 7 days (configurable)
- Passwords hashed with bcrypt (10 rounds)
- Rate limiting on all endpoints
- CORS configured for specific origins
- Helmet middleware for security headers
- MongoDB transactions for data consistency
- Email verification on registration
- OTP-based authentication available

## 📊 Features Impact

| Feature | Impact | Status |
|---------|--------|--------|
| PDF Tickets with QR | ⭐⭐⭐⭐⭐ | ✅ Complete |
| Advanced Search | ⭐⭐⭐⭐ | ✅ Complete |
| Profile Management | ⭐⭐⭐⭐⭐ | ✅ Complete |
| Real-time WebSocket | ⭐⭐⭐⭐⭐ | ✅ Complete |

## 🚀 Deployment

### Environment Variables for Production

Ensure these are set:
- `NODE_ENV=production`
- Strong `JWT_SECRET`
- Production MongoDB URI with authentication
- HTTPS for `NEXTAUTH_URL`

### Recommended Platforms
- **Heroku** - Easy deployment
- **Railway** - Modern platform
- **DigitalOcean** - VPS option
- **AWS** - Full control

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

## 📝 License

This project is open source and available under the MIT License.

## 👨‍💻 Author

Built with ❤️ by the development team

## 🙏 Acknowledgments

- Socket.io for real-time capabilities
- jsPDF for PDF generation
- Cloudinary for image hosting
- MongoDB for database
- Express.js community

## 📞 Support

For issues or questions:
- Check the [Setup Guide](SETUP_GUIDE.md)
- Review [API Documentation](API_DOCUMENTATION.md)
- Open an issue on GitHub

---

**Happy Coding! 🚂💨**