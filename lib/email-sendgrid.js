import sgMail from '@sendgrid/mail';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export const sendOTPEmail = async (email, otp, name) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.log('⚠️  SendGrid API key missing, skipping email send. OTP:', otp);
      return;
    }

    const msg = {
      to: email,
      from: {
        email: process.env.EMAIL_USER || 'noreply@tixigo.com',
        name: 'Tixigo Train Booking'
      },
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
          <p style="color: #7f8c8d; font-size: 12px;">Tixigo Train Booking System</p>
        </div>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ OTP email sent successfully via SendGrid to', email);
  } catch (error) {
    console.error('❌ SendGrid email send error:', error.response?.body || error.message);
  }
};

export const sendBookingConfirmation = async (email, bookingDetails, pdfAttachment = null) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.log('⚠️  SendGrid API key missing, skipping booking confirmation email');
      return;
    }

    const { booking, train, user } = bookingDetails;

    const passengersHtml = booking.passengers
      .map(p => `<li>${p.name} (Age: ${p.age})</li>`)
      .join('');

    const msg = {
      to: email,
      from: {
        email: process.env.EMAIL_USER || 'noreply@tixigo.com',
        name: 'Tixigo Train Booking'
      },
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
            ${booking.classType ? `<p><strong>Class:</strong> ${booking.classType}</p>` : ''}
          </div>

          <div style="background-color: #e8f5e8; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3>Passengers</h3>
            <ul>${passengersHtml}</ul>
          </div>

          ${pdfAttachment ? `
          <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <p style="margin: 0;"><strong>📎 Your E-Ticket is attached to this email!</strong></p>
            <p style="margin: 10px 0 0 0; font-size: 14px;">Please download and keep it handy for your journey.</p>
          </div>
          ` : ''}

          <p><strong>Important Instructions:</strong></p>
          <ul>
            <li>Please arrive at the station at least 30 minutes before departure</li>
            <li>Carry a valid ID proof along with this ticket</li>
            <li>You can show the PDF ticket or scan the QR code for verification</li>
          </ul>

          <p>Have a safe journey! 🚂</p>

          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">Tixigo Train Booking System</p>
        </div>
      `,
    };

    // Add PDF attachment if provided
    if (pdfAttachment && pdfAttachment.buffer) {
      msg.attachments = [{
        filename: pdfAttachment.filename,
        content: pdfAttachment.buffer.toString('base64'),
        type: 'application/pdf',
        disposition: 'attachment'
      }];
    }

    await sgMail.send(msg);
    console.log('✅ Booking confirmation email sent via SendGrid to', email);
  } catch (error) {
    console.error('❌ SendGrid booking email error:', error.response?.body || error.message);
  }
};

export const sendPasswordResetEmail = async (email, resetToken, name) => {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.log('⚠️  SendGrid API key missing, skipping password reset email');
      throw new Error('Email configuration not available');
    }

    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`;

    const msg = {
      to: email,
      from: {
        email: process.env.EMAIL_USER || 'noreply@tixigo.com',
        name: 'Tixigo Train Booking'
      },
      subject: 'Password Reset Request - Train Booking System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c;">🔒 Password Reset Request</h2>
          <p>Hello ${name},</p>
          <p>We received a request to reset your password for your Train Booking System account.</p>

          <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <p style="margin: 0;"><strong>⚠️ Important:</strong> If you didn't request this password reset, please ignore this email.</p>
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

          <hr>
          <p style="color: #7f8c8d; font-size: 12px;">Tixigo Train Booking System - Security Team</p>
        </div>
      `,
    };

    await sgMail.send(msg);
    console.log('✅ Password reset email sent via SendGrid to', email);
  } catch (error) {
    console.error('❌ SendGrid password reset email error:', error.response?.body || error.message);
    throw new Error('Failed to send password reset email');
  }
};
