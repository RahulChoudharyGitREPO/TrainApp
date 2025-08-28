import nodemailer from 'nodemailer';

const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

export const sendOTPEmail = async (email, otp, name) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Train Booking System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your OTP for Train Booking System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">OTP Verification</h2>
          <p>Hello ${name},</p>
          <p>Your OTP for verification is:</p>
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; color: #2c3e50; border-radius: 5px;">
            ${otp}
          </div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">Train Booking System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ OTP email sent successfully');
  } catch (error) {
    console.error('❌ Email send error:', error);
    throw new Error('Failed to send email');
  }
};

export const sendBookingConfirmation = async (email, bookingDetails) => {
  try {
    const transporter = createTransporter();
    
    const { booking, train, user } = bookingDetails;
    
    const passengersHtml = booking.passengers
      .map(p => `<li>${p.name} (Age: ${p.age})</li>`)
      .join('');

    const mailOptions = {
      from: `"Train Booking System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Booking Confirmation - ${train.trainName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #27ae60;">🎫 Booking Confirmed!</h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3>Booking Details</h3>
            <p><strong>Booking ID:</strong> ${booking._id}</p>
            <p><strong>Train:</strong> ${train.trainName} (${train.trainNumber})</p>
            <p><strong>Route:</strong> ${train.origin} → ${train.destination}</p>
            <p><strong>Departure:</strong> ${new Date(train.departureTime).toLocaleString()}</p>
            <p><strong>Arrival:</strong> ${new Date(train.arrivalTime).toLocaleString()}</p>
            <p><strong>Seats Booked:</strong> ${booking.totalSeatsBooked}</p>
          </div>

          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3>Passengers</h3>
            <ul>${passengersHtml}</ul>
          </div>

          <p>Please arrive at the station 30 minutes before departure.</p>
          <p>Have a safe journey! 🚂</p>
          
          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">Train Booking System</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Booking confirmation email sent');
  } catch (error) {
    console.error('❌ Email send error:', error);
    throw new Error('Failed to send confirmation email');
  }
};