
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};

export const MESSAGES = {
  USER_CREATED: 'User created successfully. Please verify your mobile number.',
  OTP_SENT: 'OTP sent successfully.',
  OTP_VERIFIED: 'Mobile number verified successfully.',
  LOGIN_SUCCESS: 'Login successful.',
  BOOKING_SUCCESS: 'Booking confirmed successfully.',
  INVALID_CREDENTIALS: 'Invalid credentials.',
  USER_NOT_FOUND: 'User not found.',
  TRAIN_NOT_FOUND: 'Train not found.',
  INSUFFICIENT_SEATS: 'Insufficient seats available.',
  OTP_EXPIRED: 'OTP has expired.',
  OTP_INVALID: 'Invalid OTP.',
};
