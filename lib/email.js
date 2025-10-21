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
    // Skip email sending if email config is missing
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
      console.log('⚠️  Email config missing, skipping email send. OTP:', otp);
      return;
    }

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

    // Add timeout to email sending (10 seconds max)
    const sendWithTimeout = Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout')), 10000)
      )
    ]);

    await sendWithTimeout;
    console.log('✅ OTP email sent successfully to', email);
  } catch (error) {
    console.error('❌ Email send error:', error.message);
    // Don't throw error - allow the process to continue
    // OTP is saved in DB, user can still verify
  }
};

export const sendBookingConfirmation = async (email, bookingDetails, pdfAttachment = null) => {
  try {
    // Skip email sending if email config is missing
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
      console.log('⚠️  Email config missing, skipping booking confirmation email');
      return;
    }

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
            <p><strong>Booking Reference:</strong> ${booking.bookingReference}</p>
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

          <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <p style="margin: 0;"><strong>📎 Your E-Ticket is attached to this email!</strong></p>
            <p style="margin: 10px 0 0 0; font-size: 14px;">Please download and keep it handy for your journey. You can show the digital ticket or the QR code for verification.</p>
          </div>

          <p><strong>Important Instructions:</strong></p>
          <ul>
            <li>Please arrive at the station at least 30 minutes before departure</li>
            <li>Carry a valid ID proof along with this ticket</li>
            <li>You can show the PDF ticket or scan the QR code for verification</li>
          </ul>

          <p>Have a safe journey! 🚂</p>

          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">Train Booking System</p>
        </div>
      `,
    };

    // Add PDF attachment if provided
    if (pdfAttachment && pdfAttachment.buffer) {
      mailOptions.attachments = [{
        filename: pdfAttachment.filename,
        content: pdfAttachment.buffer,
        contentType: 'application/pdf'
      }];
    }

    // Add timeout to email sending (15 seconds for attachment)
    const sendWithTimeout = Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout')), 15000)
      )
    ]);

    await sendWithTimeout;
    console.log('✅ Booking confirmation email sent with ticket attachment to', email);
  } catch (error) {
    console.error('❌ Booking confirmation email error:', error.message);
    // Don't throw error - booking is already confirmed in DB
  }
};

export const sendPasswordResetEmail = async (email, resetToken, name) => {
  try {
    // Skip email sending if email config is missing
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
      console.log('⚠️  Email config missing, skipping password reset email');
      throw new Error('Email configuration not available');
    }

    const transporter = createTransporter();

    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"Train Booking System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Request - Train Booking System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c;">🔒 Password Reset Request</h2>
          <p>Hello ${name},</p>
          <p>We received a request to reset your password for your Train Booking System account.</p>

          <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <p style="margin: 0;"><strong>⚠️ Important:</strong> If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
          </div>

          <p>To reset your password, click the button below:</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Reset Password
            </a>
          </div>

          <p>Or copy and paste this link into your browser:</p>
          <p style="background-color: #f8f9fa; padding: 10px; word-break: break-all; border-radius: 5px;">
            ${resetUrl}
          </p>

          <div style="background-color: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0;">
            <p style="margin: 0; color: #721c24;"><strong>⏰ This link will expire in 1 hour.</strong></p>
          </div>

          <p>For security reasons, this password reset link can only be used once.</p>

          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">
            If you're having trouble clicking the button, copy and paste the URL above into your web browser.<br>
            Train Booking System - Security Team
          </p>
        </div>
      `,
    };

    // Add timeout to email sending (10 seconds max)
    const sendWithTimeout = Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout')), 10000)
      )
    ]);

    await sendWithTimeout;
    console.log('✅ Password reset email sent successfully to', email);
  } catch (error) {
    console.error('❌ Password reset email error:', error.message);
    throw new Error('Failed to send password reset email');
  }
};