# Train Booking System - Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (running locally or cloud instance)
- Gmail account (for email features)
- Cloudinary account (for profile pictures)

---

## 📋 Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

This will install all required packages including:
- express, mongoose, cors
- socket.io (WebSocket)
- jspdf, qrcode (PDF tickets)
- multer, cloudinary (file uploads)
- nodemailer (emails)
- bcryptjs, jsonwebtoken (security)

---

### 2. Set Up MongoDB

**Option A: Local MongoDB**
```bash
# Install MongoDB
sudo apt-get install mongodb

# Start MongoDB service
sudo systemctl start mongodb

# Verify it's running
sudo systemctl status mongodb
```

**Option B: MongoDB Atlas (Cloud)**
1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Get your connection string
4. Use it in the `.env` file

---

### 3. Configure Gmail for Email Features

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate App Password:**
   - Go to Google Account → Security
   - Under "Signing in to Google", select "App passwords"
   - Generate a new app password for "Mail"
   - Copy the 16-character password

---

### 4. Set Up Cloudinary (for Profile Pictures)

1. Go to https://cloudinary.com and sign up (free tier is sufficient)
2. From the dashboard, copy:
   - Cloud Name
   - API Key
   - API Secret

---

### 5. Create Environment Variables

Create a `.env` file in the root directory:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/train-booking
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/train-booking

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRE=7d

# Email Configuration (Gmail)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-char-app-password

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Frontend URL (for password reset links)
NEXTAUTH_URL=http://localhost:3000

# Twilio (Optional - for SMS features)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=your_twilio_phone

# Server Configuration
PORT=5000
NODE_ENV=development
```

**⚠️ Important Security Notes:**
- Never commit `.env` to version control
- Change JWT_SECRET to a random string in production
- Use strong, unique passwords
- Enable MongoDB authentication in production

---

### 6. Seed Sample Data (Optional)

If you have a seed script:

```bash
node scripts/seed.js
```

This will populate your database with sample trains and users for testing.

---

### 7. Start the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

You should see:
```
🚀 ================================
🚂 Train Booking API Server
📡 Server running on port 5000
🌍 Environment: development
🔗 Health Check: http://localhost:5000/api/health
📚 API Docs: http://localhost:5000/
🔌 WebSocket enabled for real-time updates
🚀 ================================
```

---

### 8. Test the API

**Test health endpoint:**
```bash
curl http://localhost:5000/api/health
```

**Expected response:**
```json
{
  "success": true,
  "message": "Train Booking API is running!",
  "timestamp": "2025-10-16T08:38:14.639Z",
  "environment": "development"
}
```

---

### 9. Test WebSocket Features

1. Open `WEBSOCKET_EXAMPLE.html` in your browser
2. You should see:
   - "🟢 Connected" status
   - Sample trains with seat availability
   - Viewer counts

---

## 🧪 Testing Features

### Test PDF Ticket Generation

1. **Register a user:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "mobile": "+1234567890",
    "password": "password123"
  }'
```

2. **Login and get token:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

3. **Make a booking (PDF will be emailed):**
```bash
curl -X POST http://localhost:5000/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "trainId": "TRAIN_ID_HERE",
    "passengers": [
      {"name": "John Doe", "age": 30},
      {"name": "Jane Doe", "age": 28}
    ]
  }'
```

4. **Check your email** for the PDF ticket with QR code!

---

### Test Advanced Search

```bash
# Search with all filters
curl "http://localhost:5000/api/trains?origin=Mumbai&destination=Delhi&date=2025-10-20&class=AC&minPrice=500&maxPrice=2000&sortBy=price&sortOrder=asc&page=1&limit=10"
```

---

### Test Profile Management

1. **Get profile:**
```bash
curl http://localhost:5000/api/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

2. **Upload profile picture:**
```bash
curl -X POST http://localhost:5000/api/profile/profile-picture \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "profilePicture=@/path/to/image.jpg"
```

3. **Save a passenger template:**
```bash
curl -X POST http://localhost:5000/api/profile/saved-passengers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Frequent Traveler",
    "age": 35,
    "relation": "Self"
  }'
```

---

## 📱 Frontend Integration

### React Example (with Socket.io)

```bash
npm install socket.io-client
```

```javascript
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function TrainDetails({ trainId }) {
  const [seats, setSeats] = useState(null);
  const [viewers, setViewers] = useState(0);

  useEffect(() => {
    const socket = io('http://localhost:5000');

    socket.on('connect', () => {
      socket.emit('join-train', trainId);
    });

    socket.on('viewer-count', (data) => {
      if (data.trainId === trainId) {
        setViewers(data.count);
      }
    });

    socket.on('seat-update', (data) => {
      if (data.trainId === trainId) {
        setSeats(data.availableSeats);
        // Show notification
        alert(`Seats updated: ${data.availableSeats} available`);
      }
    });

    return () => {
      socket.emit('leave-train', trainId);
      socket.disconnect();
    };
  }, [trainId]);

  return (
    <div>
      <p>Available Seats: {seats}</p>
      <p>{viewers} people viewing</p>
    </div>
  );
}
```

---

## 🔧 Troubleshooting

### MongoDB Connection Issues

**Error:** `MongooseError: Connection failed`

**Solution:**
- Check if MongoDB is running: `sudo systemctl status mongodb`
- Verify connection string in `.env`
- Check firewall settings

---

### Email Not Sending

**Error:** `Failed to send email`

**Solution:**
- Verify Gmail App Password is correct
- Enable "Less secure app access" if needed
- Check EMAIL_USER and EMAIL_PASS in `.env`
- Make sure 2FA is enabled and app password is generated

---

### Cloudinary Upload Failing

**Error:** `Invalid credentials`

**Solution:**
- Verify Cloudinary credentials in `.env`
- Check cloud name, API key, and API secret
- Ensure no extra spaces in `.env` values

---

### WebSocket Not Connecting

**Error:** Client shows "Disconnected"

**Solution:**
- Check server is running on correct port
- Verify CORS settings in `server.js`
- Check browser console for errors
- Ensure firewall allows WebSocket connections

---

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::5000`

**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use a different port in .env
PORT=5001
```

---

## 🔐 Security Best Practices

### For Development
- Use strong, unique JWT secrets
- Never commit `.env` to Git
- Use app passwords for email (not main password)

### For Production
1. **Environment Variables:**
   - Use environment variables or secret managers
   - Never hardcode secrets

2. **Database:**
   - Enable authentication
   - Use SSL/TLS for connections
   - Whitelist IP addresses

3. **API:**
   - Use HTTPS only
   - Enable rate limiting (already configured)
   - Use Helmet for security headers (already installed)
   - Implement API key authentication for admin routes

4. **WebSocket:**
   - Validate tokens in WebSocket connections
   - Implement proper authentication middleware

---

## 📚 Additional Resources

- **API Documentation:** See `API_DOCUMENTATION.md`
- **Features Summary:** See `FEATURES_SUMMARY.md`
- **WebSocket Demo:** Open `WEBSOCKET_EXAMPLE.html`
- **MongoDB Docs:** https://docs.mongodb.com
- **Socket.io Docs:** https://socket.io/docs
- **Cloudinary Docs:** https://cloudinary.com/documentation

---

## 🎉 You're All Set!

Your train booking system is now ready with:
- ✅ PDF tickets with QR codes
- ✅ Real-time seat updates
- ✅ Advanced search and filters
- ✅ Complete profile management
- ✅ Production-ready architecture

Happy coding! 🚂
