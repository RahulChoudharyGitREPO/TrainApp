import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay instance
export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay order
export const createRazorpayOrder = async (amount, currency = 'INR', receipt) => {
  try {
    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency,
      receipt,
      payment_capture: 1, // Auto capture payment
    };

    const order = await razorpayInstance.orders.create(options);
    return {
      success: true,
      order,
    };
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Verify Razorpay payment signature
export const verifyRazorpaySignature = (orderId, paymentId, signature) => {
  try {
    const text = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');

    return generatedSignature === signature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

// Get payment details
export const getPaymentDetails = async (paymentId) => {
  try {
    const payment = await razorpayInstance.payments.fetch(paymentId);
    return {
      success: true,
      payment,
    };
  } catch (error) {
    console.error('Error fetching payment details:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Refund payment
export const refundPayment = async (paymentId, amount = null) => {
  try {
    const refundData = amount ? { amount: amount * 100 } : {}; // Full refund if amount not specified
    const refund = await razorpayInstance.payments.refund(paymentId, refundData);
    return {
      success: true,
      refund,
    };
  } catch (error) {
    console.error('Refund error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};
