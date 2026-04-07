const Payment = require('../models/paymentModels');
const stripe = require('../utils/stripe');
const axios = require('axios');

class PaymentService {

  generatePaymentId() {
    return `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  }
  
  // Add this method to get payment by session ID
  async getPaymentBySessionId(sessionId) {
    try {
      return await Payment.findOne({ stripe_session_id: sessionId });
    } catch (error) {
      console.error('Error getting payment by session ID:', error);
      return null;
    }
  }

  // Add this method to get booking details from booking service
// Get booking details from booking service using internal endpoint
async getBookingDetails(pnr) {
  try {
    // FIX: Use internal endpoint
    const url = `http://localhost:3004/v1/booking/internal/for-payment/${pnr}`;
    
    console.log(`📡 Fetching booking details from: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'x-service-auth': 'internal-secret-key-12345',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log("Booking details response:", response.data);
    
    return response.data?.data || null;
  } catch (error) {
    console.error('Error fetching booking details:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return null;
  }
}

  // Validate PNR and get booking details from Booking Service
// Validate PNR and get booking details from Booking Service
async validateAndGetBooking(pnr, user_id, user_email, user_name, user_phone, user_token, skipPaymentCheck = false) {
  try {
    console.log(`🔍 Validating PNR: ${pnr} for user: ${user_id}`);
    
    const url = `http://localhost:3004/v1/booking/internal/for-payment/${pnr}`;
    
    console.log(`📡 Calling: ${url}`);
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${user_token}`,  // CHANGE: Use Bearer token from user
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    const booking = response.data?.data;
    
    console.log("Booking response:", JSON.stringify(response.data, null, 2));
    
    if (!booking) {
      throw new Error('Booking not found for given PNR');
    }
    
    if (booking.user_id !== user_id) {
      throw new Error('PNR does not belong to this user');
    }
    
    if (booking.booking_status === 'CANCELLED') {
      throw new Error('Cannot pay for cancelled booking');
    }
    
    if (booking.payment_status === 'PAID') {
      throw new Error('Booking already paid for');
    }
    
    if (!skipPaymentCheck) {
      const existingPayment = await Payment.findOne({ 
        pnr, 
        status: { $in: ['PENDING', 'PROCESSING'] } 
      });
      
      if (existingPayment) {
        throw new Error('Payment already in progress for this booking');
      }
    }
    
    console.log(`✅ PNR validation successful: ${pnr}`);
    console.log(`💰 Total fare: ₹${booking.total_fare}`);
    
    return {
      valid: true,
      booking: {
        pnr: booking.pnr,
        booking_id: booking.booking_id,
        schedule_id: booking.schedule_id,
        train_number: booking.train_number,
        train_name: booking.train_name,
        from_station: booking.from_station,
        to_station: booking.to_station,
        class_type: booking.class_type,
        journey_date: booking.journey_date,
        passengers: booking.passengers,
        seat_details: booking.seat_details,
        total_fare: booking.total_fare,
        fare_per_passenger: booking.fare_per_passenger,
        booking_status: booking.booking_status,
        payment_status: booking.payment_status,
        stop_gaps: booking.stop_gaps,
        payment_expires_at: booking.payment_expires_at
      }
    };
    
  } catch (error) {
    console.error('❌ PNR validation failed:', error.message);
    
    if (error.response) {
      console.error('Error response:', error.response.data);
      if (error.response.status === 404) {
        throw new Error('PNR not found. Please check your booking PNR.');
      } else if (error.response.status === 403) {
        throw new Error('You are not authorized to pay for this booking.');
      } else if (error.response.status === 401) {
        throw new Error('Authentication failed. Please login again.');
      }
      throw new Error(`Booking service error: ${error.response.data?.message || error.message}`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('Booking service is unavailable. Please ensure booking service is running on port 3004.');
    }
    
    throw error;
  }
}

  // Create payment intent
  async createPaymentIntent(data) {
    const {
      pnr,
      user_id,
      user_name,
      user_email,
      user_phone,
      user_token,
      payment_method = 'CARD',
      metadata = {}
    } = data;

    try {
      if (!pnr) throw new Error('PNR is required');
      if (!user_id) throw new Error('User ID is required');
      if (!user_email) throw new Error('User email is required');
      if (!user_token) throw new Error('Authentication token is required');

      const { booking } = await this.validateAndGetBooking(
        pnr, user_id, user_email, user_name, user_phone, user_token, false
      );

      if (booking.payment_expires_at && new Date() > new Date(booking.payment_expires_at)) {
        throw new Error('Payment window has expired. Please create a new booking.');
      }

      const amount = booking.total_fare;
      const booking_id = booking.booking_id;

      console.log(` Creating payment intent for PNR: ${pnr}, Amount: ₹${amount}`);

      const payment_id = this.generatePaymentId();
      
      const payment = await Payment.create({
        payment_id,
        booking_id,
        pnr,
        user_id,
        user_name,
        user_email,
        user_phone,
        amount,
        currency: 'INR',
        payment_method,
        status: 'PENDING',
        metadata: new Map(Object.entries({
          ...metadata,
          train_number: booking.train_number,
          train_name: booking.train_name,
          from_station: booking.from_station,
          to_station: booking.to_station,
          class_type: booking.class_type,
          journey_date: booking.journey_date,
          passengers_count: booking.passengers.length
        }))
      });

      console.log(` Payment record created: ${payment_id}`);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'inr',
        payment_method_types: ['card'],
        metadata: {
          payment_id: payment.payment_id,
          booking_id,
          pnr,
          user_id,
          user_email,
          train_number: booking.train_number,
          class_type: booking.class_type,
          from_station: booking.from_station,
          to_station: booking.to_station,
          ...metadata
        },
        receipt_email: user_email,
        description: `Train Ticket Booking - ${pnr} | ${booking.train_number} | ${booking.from_station}→${booking.to_station}`,
      });

      console.log(`✅ Stripe Payment Intent created: ${paymentIntent.id}`);

      payment.stripe_payment_intent_id = paymentIntent.id;
      payment.stripe_response = paymentIntent;
      await payment.save();

      return {
        success: true,
        data: {
          payment_id: payment.payment_id,
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          booking_details: {
            pnr: booking.pnr,
            train_number: booking.train_number,
            train_name: booking.train_name,
            from_station: booking.from_station,
            to_station: booking.to_station,
            class_type: booking.class_type,
            journey_date: booking.journey_date,
            passengers_count: booking.passengers.length,
            booking_status: booking.booking_status,
            payment_status: booking.payment_status
          }
        }
      };

    } catch (error) {
      console.error('❌ Error creating payment intent:', error);
      throw new Error(`Payment intent creation failed: ${error.message}`);
    }
  }

  // ============ CREATE CHECKOUT SESSION (HOSTED PAYMENT PAGE) ============
  async createCheckoutSession(data) {
    const {
      pnr,
      user_id,
      user_name,
      user_email,
      user_token,
      success_url,
      cancel_url,
      metadata = {}
    } = data;

    try {
      console.log(`🏪 Creating checkout session for PNR: ${pnr}`);
      
      if (!pnr) throw new Error('PNR is required');
      if (!user_id) throw new Error('User ID is required');
      if (!user_email) throw new Error('User email is required');
      if (!user_token) throw new Error('Authentication token is required');

      // Validate booking - SKIP payment check for checkout session
      const { booking } = await this.validateAndGetBooking(
        pnr, user_id, user_email, user_name, null, user_token, true
      );

      if (booking.payment_expires_at && new Date() > new Date(booking.payment_expires_at)) {
        throw new Error('Payment window has expired. Please create a new booking.');
      }

      const amount = booking.total_fare;
      const booking_id = booking.booking_id;

      console.log(`💰 Amount: ₹${amount}`);

      // CHECK FOR EXISTING PAYMENT - USE IT IF EXISTS
      let existingPayment = await Payment.findOne({ 
        pnr, 
        status: { $in: ['PENDING', 'PROCESSING'] } 
      });
      
      let payment;
      
      if (existingPayment) {
        console.log(`⚠️ Found existing payment for PNR: ${pnr}, reusing it`);
        payment = existingPayment;
        
        if (payment.stripe_session_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
            
            if (session && session.url) {
              console.log(`✅ Reusing existing checkout session: ${session.id}`);
              return {
                success: true,
                data: {
                  payment_id: payment.payment_id,
                  session_id: session.id,
                  session_url: session.url,
                  amount: payment.amount,
                  currency: payment.currency,
                  booking_details: {
                    pnr: booking.pnr,
                    train_number: booking.train_number,
                    train_name: booking.train_name,
                    from_station: booking.from_station,
                    to_station: booking.to_station,
                    class_type: booking.class_type,
                    journey_date: booking.journey_date,
                    passengers_count: booking.passengers.length
                  }
                }
              };
            }
          } catch (err) {
            console.log('Existing session expired or invalid, creating new one');
          }
        }
      } else {
        const payment_id = this.generatePaymentId();
        
        payment = await Payment.create({
          payment_id,
          booking_id,
          pnr,
          user_id,
          user_name,
          user_email,
          amount,
          currency: 'INR',
          payment_method: 'CARD',
          status: 'PENDING',
          metadata: new Map(Object.entries({
            ...metadata,
            train_number: booking.train_number,
            train_name: booking.train_name,
            from_station: booking.from_station,
            to_station: booking.to_station,
            class_type: booking.class_type
          }))
        });
        
        console.log(`✅ New payment record created: ${payment.payment_id}`);
      }

      // FIXED: Use payment service's success URL, not frontend URL
      const paymentServiceBaseUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005/api/payments';
      
      // Create Stripe Checkout Session with CORRECT URLs
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'inr',
            product_data: {
              name: `Train Ticket - ${booking.train_number} (${booking.train_name})`,
              description: `${booking.from_station} → ${booking.to_station} | ${booking.class_type} | ${booking.passengers.length} passenger(s) | PNR: ${pnr}`,
              metadata: {
                booking_id,
                pnr,
                train_number: booking.train_number,
                class_type: booking.class_type
              }
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        // FIXED: Use payment service endpoints, not frontend
        success_url: success_url || `${paymentServiceBaseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&pnr=${pnr}`,
        cancel_url: cancel_url || `${paymentServiceBaseUrl}/payment-cancel?pnr=${pnr}`,
        customer_email: user_email,
        metadata: {
          payment_id: payment.payment_id,
          booking_id,
          pnr,
          user_id
        },
        payment_intent_data: {
          metadata: {
            payment_id: payment.payment_id,
            booking_id,
            pnr,
            user_id,
            train_number: booking.train_number
          }
        }
      });

      console.log(`✅ Stripe Checkout Session created: ${session.id}`);
      console.log(`🔗 Session URL: ${session.url}`);
      console.log(`📝 Success URL will redirect to: ${success_url || `${paymentServiceBaseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&pnr=${pnr}`}`);

      // Update payment record
      payment.stripe_session_id = session.id;
      payment.stripe_response = session;
      await payment.save();

      return {
        success: true,
        data: {
          payment_id: payment.payment_id,
          session_id: session.id,
          session_url: session.url,
          amount: payment.amount,
          currency: payment.currency,
          booking_details: {
            pnr: booking.pnr,
            train_number: booking.train_number,
            train_name: booking.train_name,
            from_station: booking.from_station,
            to_station: booking.to_station,
            class_type: booking.class_type,
            journey_date: booking.journey_date,
            passengers_count: booking.passengers.length
          }
        }
      };

    } catch (error) {
      console.error('❌ Error creating checkout session:', error);
      throw new Error(`Checkout session creation failed: ${error.message}`);
    }
  }

async updateBookingStatusInternal(payment) {
  try {
    console.log(`📡 Updating booking status for PNR: ${payment.pnr}`);
    
    const url = 'http://localhost:3004/v1/booking/internal/confirm-payment';
    
    const response = await axios.patch(url, {
      pnr: payment.pnr,
      payment_id: payment.payment_id,
      transaction_id: payment.transaction_id,
      payment_status: 'PAID',
      payment_date: payment.payment_date,
      payment_method: payment.payment_method,
      stripe_payment_intent_id: payment.stripe_payment_intent_id
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Booking status updated for PNR: ${payment.pnr}`);
    return response.data;
    
  } catch (error) {
    console.error('❌ Error updating booking status:', error.message);
    return null;
  }
}

async confirmPayment(paymentIntentId, paymentData = {}) {
  try {
    console.log(`🔍 CONFIRMING PAYMENT for Intent: ${paymentIntentId}`);
    
    const payment = await Payment.findOne({ 
      $or: [
        { stripe_payment_intent_id: paymentIntentId },
        { stripe_session_id: paymentIntentId }
      ]
    });

    if (!payment) {
      console.log(`❌ Payment record not found for: ${paymentIntentId}`);
      throw new Error('Payment record not found');
    }

    console.log(`✅ Found payment record: ${payment.payment_id}, PNR: ${payment.pnr}, Status: ${payment.status}`);

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log(`Stripe Payment Intent Status: ${paymentIntent.status}`);
    
    payment.status = paymentIntent.status === 'succeeded' ? 'SUCCESS' : 'FAILED';
    payment.stripe_response = paymentIntent;
    payment.transaction_id = paymentIntent.latest_charge;
    payment.payment_date = new Date();
    
    if (paymentIntent.status === 'failed') {
      payment.failure_reason = paymentIntent.last_payment_error?.message || 'Payment failed';
    }
    
    await payment.save();
    console.log(`✅ Payment record updated to: ${payment.status}`);

    let bookingUpdateResult = null;
    if (payment.status === 'SUCCESS') {
      console.log(`📡 Calling booking service to confirm payment for PNR: ${payment.pnr}`);
      bookingUpdateResult = await this.updateBookingStatusInternal(payment);
      console.log("Booking update result:", JSON.stringify(bookingUpdateResult, null, 2));
    }

    return {
      success: payment.status === 'SUCCESS',
      data: {
        payment: payment,
        booking: bookingUpdateResult?.data || null
      }
    };

  } catch (error) {
    console.error('Error confirming payment:', error);
    throw new Error(`Payment confirmation failed: ${error.message}`);
  }
}

  async getPayment(payment_id) {
    try {
      const payment = await Payment.findOne({ payment_id });
      if (!payment) {
        throw new Error('Payment not found');
      }
      return payment;
    } catch (error) {
      throw new Error(`Failed to get payment: ${error.message}`);
    }
  }

  async getUserPayments(user_id, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;
      
      const payments = await Payment.find({ user_id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
      
      const total = await Payment.countDocuments({ user_id });
      
      return {
        payments,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      throw new Error(`Failed to get user payments: ${error.message}`);
    }
  }

  async getPaymentByPNR(pnr) {
    try {
      return await Payment.findOne({ pnr });
    } catch (error) {
      throw new Error(`Failed to get payment by PNR: ${error.message}`);
    }
  }

  async refundPayment(payment_id, amount = null, reason = 'requested_by_customer') {
    try {
      const payment = await Payment.findOne({ payment_id });
      
      if (!payment) {
        throw new Error('Payment record not found');
      }
      
      if (payment.status !== 'SUCCESS') {
        throw new Error('Only successful payments can be refunded');
      }
      
      if (payment.refund_id) {
        throw new Error('Payment already refunded');
      }
      
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        amount: amount ? Math.round(amount * 100) : undefined,
        reason: reason,
        metadata: {
          payment_id: payment.payment_id,
          refund_reason: reason
        }
      });
      
      payment.status = 'REFUNDED';
      payment.refund_id = refund.id;
      payment.refund_amount = amount || payment.amount;
      payment.refund_date = new Date();
      payment.stripe_response.refund = refund;
      await payment.save();
      
      return {
        success: true,
        data: {
          payment_id: payment.payment_id,
          refund_id: refund.id,
          refund_amount: payment.refund_amount,
          status: payment.status
        }
      };
      
    } catch (error) {
      console.error('Error refunding payment:', error);
      throw new Error(`Refund failed: ${error.message}`);
    }
  }

  async handleWebhook(event) {
    console.log('Received webhook event:', event.type);
    
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        await this.confirmPayment(paymentIntent.id);
        break;
        
      case 'payment_intent.payment_failed':
        const failedIntent = event.data.object;
        await this.confirmPayment(failedIntent.id);
        break;
        
      case 'checkout.session.completed':
        const session = event.data.object;
        if (session.payment_intent) {
          await this.confirmPayment(session.payment_intent);
        }
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    return { received: true };
  }
}

module.exports = new PaymentService();