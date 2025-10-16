import express from "express";
import connectDB from "../lib/db.js";
import User from "../models/User.js";
import { hashPassword, generateOTP, generateToken, comparePassword, generateResetToken } from "../lib/auth.js";
import { sendOTPEmail, sendPasswordResetEmail } from "../lib/email.js";
import { sendOTPSMS } from "../lib/otp.js";
import { validateSignup, validateLogin, validateOTP, validateForgotPassword, validateResetPassword } from "../lib/validation.js";
import { HTTP_STATUS, MESSAGES } from "../utils/constants.js";
import { sendResponse, asyncHandler } from "../utils/helpers.js";

const router = express.Router();

router.post('/signup', asyncHandler(async (req, res) => {
  const { error } = validateSignup(req.body);
  if (error) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
  }

  const { name, email, mobile, password } = req.body;

  const existingUser = await User.findOne({
    $or: [{ email }, { mobile }]
  });

  if (existingUser) {
    return sendResponse(res, HTTP_STATUS.CONFLICT, false, 'User already exists with this email or mobile');
  }

  const hashedPassword = await hashPassword(password);
  const otp = generateOTP();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const user = new User({
    name,
    email,
    mobile,
    password: hashedPassword,
    otp: {
      code: otp,
      expiresAt: otpExpiresAt,
    },
  });

  await user.save();

  try {
    await Promise.all([
      sendOTPEmail(email, otp, name),
      sendOTPSMS(mobile, otp, name),
    ]);
  } catch (error) {
    console.error('OTP send error:', error);
  }

  sendResponse(res, HTTP_STATUS.CREATED, true, MESSAGES.USER_CREATED);
}));

router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { error } = validateOTP(req.body);
  if (error) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
  }

  const { mobile, otp } = req.body;

  const user = await User.findOne({ mobile });

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, MESSAGES.USER_NOT_FOUND);
  }

  if (!user.otp.code || user.otp.expiresAt < new Date()) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, MESSAGES.OTP_EXPIRED);
  }

  if (user.otp.code !== otp) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, MESSAGES.OTP_INVALID);
  }

  user.verified = true;
  user.otp = undefined;
  await user.save();

  const token = generateToken({
    userId: user._id,
    email: user.email,
    role: user.role,
  });

  const userData = {
    id: user._id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    verified: user.verified,
  };

  sendResponse(res, HTTP_STATUS.OK, true, MESSAGES.OTP_VERIFIED, {
    token,
    user: userData,
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { error } = validateLogin(req.body);
  if (error) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
  }

  const { mobile, password } = req.body;

  const user = await User.findOne({ mobile });

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, MESSAGES.INVALID_CREDENTIALS);
  }

  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, MESSAGES.INVALID_CREDENTIALS);
  }

  const otp = generateOTP();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  user.otp = {
    code: otp,
    expiresAt: otpExpiresAt,
  };
  await user.save();

  try {
    await Promise.all([
      sendOTPEmail(user.email, otp, user.name),
      sendOTPSMS(mobile, otp, user.name),
    ]);
  } catch (error) {
    console.error('OTP send error:', error);
  }

  sendResponse(res, HTTP_STATUS.OK, true, MESSAGES.OTP_SENT);
}));

router.post('/resend-otp', asyncHandler(async (req, res) => {
  const { mobile } = req.body;

  if (!mobile) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Mobile number is required');
  }

  const user = await User.findOne({ mobile });

  if (!user) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, MESSAGES.USER_NOT_FOUND);
  }

  const otp = generateOTP();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  user.otp = {
    code: otp,
    expiresAt: otpExpiresAt,
  };
  await user.save();

  try {
    await Promise.all([
      sendOTPEmail(user.email, otp, user.name),
      sendOTPSMS(mobile, otp, user.name),
    ]);
  } catch (error) {
    console.error('OTP send error:', error);
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'OTP sent successfully');
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { error } = validateForgotPassword(req.body);
  if (error) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
  }

  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return sendResponse(res, HTTP_STATUS.OK, true, 'If an account with that email exists, a password reset link has been sent.');
  }

  const resetToken = generateResetToken();
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = resetExpires;
  await user.save();

  try {
    await sendPasswordResetEmail(email, resetToken, user.name);
  } catch (error) {
    console.error('Password reset email error:', error);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Failed to send password reset email');
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'If an account with that email exists, a password reset link has been sent.');
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const { error } = validateResetPassword(req.body);
  if (error) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
  }

  const { token, newPassword } = req.body;

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Password reset token is invalid or has expired');
  }

  const hashedPassword = await hashPassword(newPassword);
  user.password = hashedPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Password has been reset successfully. You can now login with your new password.');
}));

export default router;