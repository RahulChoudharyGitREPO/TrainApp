import * as dotenv from "dotenv";
dotenv.config()
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendOTPSMS = async (mobile, otp, name) => {
  try {
    // In development, just log the OTP
    if (process.env.NODE_ENV === 'development') {
      console.log(`📱 OTP fwor ${mobile}: ${otp}`);
      return;
    }

    // In production, send actual SMS via Twilio
    const message = await client.messages.create({
      body: `Hello ${name}, your OTP for Train Booking System is: ${otp}. Valid for 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: mobile,
    });

    console.log('✅ SMS sent successfully:', message.sid);
  } catch (error) {
    console.error('❌ SMS send error:', error);
    // In development, don't throw error for SMS failures
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('Failed to send SMS');
    }
  }
};
