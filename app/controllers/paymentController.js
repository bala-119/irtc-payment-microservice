const paymentService = require('../services/paymentService');
const stripe = require('../utils/stripe');
const axios = require('axios'); 

class PaymentController {

  // Create payment intent for a booking (with PNR validation)
  async createPaymentIntent(req, res) {
    try {
      const { 
        pnr, 
        payment_method = 'CARD', 
        metadata = {},
        user_id,
        user_name,
        user_email,
        user_phone
      } = req.body;
      
      const authUser = req.user;
      const authHeader = req.headers.authorization;
      const user_token = authHeader && authHeader.split(' ')[1];
      
      const finalUserId = user_id || authUser?.id;
      const finalUserName = user_name || authUser?.fullName || authUser?.user_name;
      const finalUserEmail = user_email || authUser?.email;
      const finalUserPhone = user_phone || authUser?.phone;
      
      if (!user_token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication token is required',
          code: 'MISSING_TOKEN'
        });
      }
      
      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: 'PNR is required'
        });
      }
      
      const result = await paymentService.createPaymentIntent({
        pnr,
        payment_method,
        metadata,
        user_id: finalUserId,
        user_name: finalUserName,
        user_email: finalUserEmail,
        user_phone: finalUserPhone,
        user_token
      });
      
      return res.status(200).json(result);
      
    } catch (error) {
      console.error('Create payment intent error:', error);
      
      if (error.message.includes('PNR not found')) {
        return res.status(404).json({
          success: false,
          message: error.message,
          code: 'PNR_NOT_FOUND'
        });
      }
      
      if (error.message.includes('not authorized')) {
        return res.status(403).json({
          success: false,
          message: error.message,
          code: 'UNAUTHORIZED_PNR'
        });
      }
      
      if (error.message.includes('already paid')) {
        return res.status(409).json({
          success: false,
          message: error.message,
          code: 'ALREADY_PAID'
        });
      }
      
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'PAYMENT_ERROR'
      });
    }
  }

  // Create checkout session (for hosted payment page)
  async createCheckoutSession(req, res) {
    try {
      console.log('========================================');
      console.log('📝 Create Checkout Session Request');
      console.log('Request Body:', req.body);
      console.log('========================================');
      
      const { 
        pnr, 
        success_url, 
        cancel_url, 
        metadata = {},
        user_id,
        user_name,
        user_email
      } = req.body;
      
      const authUser = req.user;
      const authHeader = req.headers.authorization;
      const user_token = authHeader && authHeader.split(' ')[1];
      
      const finalUserId = user_id || authUser?.id;
      const finalUserName = user_name || authUser?.fullName || authUser?.user_name;
      const finalUserEmail = user_email || authUser?.email;
      
      console.log('Extracted PNR:', pnr);
      
      if (!user_token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication token is required',
          code: 'MISSING_TOKEN'
        });
      }
      
      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: 'PNR is required. Please provide pnr in request body.',
          code: 'PNR_REQUIRED'
        });
      }
      
      const result = await paymentService.createCheckoutSession({
        pnr,
        user_id: finalUserId,
        user_name: finalUserName,
        user_email: finalUserEmail,
        user_token,
        success_url,
        cancel_url,
        metadata
      });
      
      return res.status(200).json(result);
      
    } catch (error) {
      console.error('Create checkout session error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'CHECKOUT_ERROR'
      });
    }
  }

  // SUCCESS PAGE - After successful payment
// SUCCESS PAGE - After successful payment
async paymentSuccess(req, res) {
  try {
    let session_id = req.query.session_id;
    let pnr = req.query.pnr;
    
    console.log('✅ PAYMENT SUCCESS - Session ID:', session_id, 'PNR:', pnr);
    
    // AUTO UPDATE BOOKING - Call the working endpoint
    if (pnr) {
      try {
        console.log(`📡 Auto-updating payment for PNR: ${pnr}`);
        
        const updateUrl = 'http://localhost:3004/v1/booking/internal/confirm-payment';
        
        const response = await axios.patch(updateUrl, {
          pnr: pnr,
          payment_id: `PAY-${Date.now()}`,
          transaction_id: session_id,
          payment_status: 'PAID',
          payment_date: new Date().toISOString(),
          payment_method: 'CARD',
          stripe_payment_intent_id: session_id
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log('Update response:', response.data);
        
        if (response.data.success) {
          console.log(`✅ Booking updated to PAID for PNR: ${pnr}`);
        }
        
      } catch (error) {
        console.error('Auto-update failed:', error.message);
        if (error.response) {
          console.error('Error response:', error.response.data);
        }
      }
    }
    
    // Show success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Successful</title>
        <style>
          body { font-family: Arial; text-align: center; padding: 50px; }
          .success { color: green; font-size: 50px; }
          button { padding: 10px 20px; margin: 10px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="success">✓</div>
        <h1>Payment Successful!</h1>
        <p><strong>PNR:</strong> ${pnr}</p>
        <p><strong>Status:</strong> PAID ✓</p>
       npm
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error:', error);
    res.send(`<h1>Payment Successful</h1><p>PNR: ${req.query.pnr}</p><p>Your booking will be updated shortly.</p>`);
  }
}
  // CANCELLATION PAGE
  async paymentCancel(req, res) {
    try {
      const { pnr, reason } = req.query;
      
      console.log('❌ PAYMENT CANCELLED - PNR:', pnr);
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Cancelled</title>
        </head>
        <body>
          <h1>Payment Cancelled</h1>
          <hr>
          <p><b>Status:</b> ${reason || 'Cancelled by user'}</p>
          <p><b>PNR:</b> ${pnr || 'N/A'}</p>
          <p><b>Note:</b> Your booking is still active but will expire in 15 minutes if payment is not completed.</p>
          <hr>
          <button onclick="window.location.href='http://localhost:3005/api/payments/create-checkout-session'">Retry Payment</button>
          <button onclick="window.location.href='http://localhost:3000/my-bookings'">View Bookings</button>
          <button onclick="window.close()">Close</button>
        </body>
        </html>
      `);
      
    } catch (error) {
      console.error('Error:', error);
      res.send(`<h1>Error</h1><p>${error.message}</p>`);
    }
  }

  // Payment status page
  async paymentStatus(req, res) {
    try {
      const { pnr } = req.params;
      
      const payment = await paymentService.getPaymentByPNR(pnr);
      
      let statusText = 'NOT FOUND';
      if (payment?.status === 'SUCCESS') statusText = 'SUCCESS - Payment Completed';
      else if (payment?.status === 'PENDING') statusText = 'PENDING - Awaiting Payment';
      else if (payment?.status === 'FAILED') statusText = 'FAILED - Payment Failed';
      else if (payment?.status === 'REFUNDED') statusText = 'REFUNDED - Money Returned';
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Status</title>
        </head>
        <body>
          <h1>Payment Status</h1>
          <hr>
          <p><b>PNR:</b> ${pnr}</p>
          <p><b>Status:</b> ${statusText}</p>
          <p><b>Amount:</b> ₹${payment?.amount || 'N/A'}</p>
          <p><b>Payment Date:</b> ${payment?.payment_date ? new Date(payment.payment_date).toLocaleString() : 'N/A'}</p>
          <p><b>Transaction ID:</b> ${payment?.transaction_id || 'N/A'}</p>
          <hr>
          <a href="http://localhost:3000/my-bookings">Back to My Bookings</a>
        </body>
        </html>
      `);
      
    } catch (error) {
      res.send(`<h1>Error</h1><p>${error.message}</p>`);
    }
  }

async confirmPayment(paymentIntentId, paymentData = {}) {
  try {
    const payment = await Payment.findOne({ 
      $or: [
        { stripe_payment_intent_id: paymentIntentId },
        { stripe_session_id: paymentIntentId }
      ]
    });

    if (!payment) {
      throw new Error('Payment record not found');
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    payment.status = paymentIntent.status === 'succeeded' ? 'SUCCESS' : 'FAILED';
    payment.stripe_response = paymentIntent;
    payment.transaction_id = paymentIntent.latest_charge;
    payment.payment_date = new Date();
    
    if (paymentIntent.status === 'failed') {
      payment.failure_reason = paymentIntent.last_payment_error?.message || 'Payment failed';
    }
    
    await payment.save();

    let bookingUpdateResult = null;
    if (payment.status === 'SUCCESS') {
      bookingUpdateResult = await this.updateBookingStatusInternal(payment);
      console.log("Booking update result:", bookingUpdateResult);
    }

    return {
      success: payment.status === 'SUCCESS',
      data: {
        payment: payment,
        booking: bookingUpdateResult?.data || null  // FIX: Extract booking data
      }
    };

  } catch (error) {
    console.error('Error confirming payment:', error);
    throw new Error(`Payment confirmation failed: ${error.message}`);
  }
}

  async getPayment(req, res) {
    try {
      const { payment_id } = req.params;
      
      if (!payment_id) {
        return res.status(400).json({
          success: false,
          message: 'Payment ID is required'
        });
      }
      
      const payment = await paymentService.getPayment(payment_id);
      
      return res.status(200).json({
        success: true,
        data: payment
      });
      
    } catch (error) {
      console.error('Get payment error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'FETCH_ERROR'
      });
    }
  }

  async getUserPayments(req, res) {
    try {
      const { user_id } = req.body;
      const { page = 1, limit = 10 } = req.query;
      
      const result = await paymentService.getUserPayments(
        user_id, 
        parseInt(page), 
        parseInt(limit)
      );
      
      return res.status(200).json({
        success: true,
        data: result.payments,
        pagination: result.pagination
      });
      
    } catch (error) {
      console.error('Get user payments error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'FETCH_ERROR'
      });
    }
  }

  async getPaymentByPNR(req, res) {
    try {
      const { pnr } = req.params;
      
      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: 'PNR is required'
        });
      }
      
      const payment = await paymentService.getPaymentByPNR(pnr);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found for this PNR',
          code: 'PAYMENT_NOT_FOUND'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: payment
      });
      
    } catch (error) {
      console.error('Get payment by PNR error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'FETCH_ERROR'
      });
    }
  }

  async refundPayment(req, res) {
    try {
      const { payment_id } = req.params;
      const { amount, reason } = req.body;
      
      if (!payment_id) {
        return res.status(400).json({
          success: false,
          message: 'Payment ID is required'
        });
      }
      
      const result = await paymentService.refundPayment(payment_id, amount, reason);
      
      return res.status(200).json(result);
      
    } catch (error) {
      console.error('Refund payment error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'REFUND_ERROR'
      });
    }
  }

  async getPaymentStatus(req, res) {
    try {
      const { pnr } = req.params;
      
      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: 'PNR is required'
        });
      }
      
      const payment = await paymentService.getPaymentByPNR(pnr);
      
      if (!payment) {
        return res.status(200).json({
          success: true,
          data: {
            pnr,
            isPaid: false,
            status: 'NOT_FOUND'
          }
        });
      }
      
      return res.status(200).json({
        success: true,
        data: {
          pnr: payment.pnr,
          isPaid: payment.status === 'SUCCESS',
          status: payment.status,
          amount: payment.amount,
          payment_date: payment.payment_date,
          transaction_id: payment.transaction_id
        }
      });
      
    } catch (error) {
      console.error('Get payment status error:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        code: 'STATUS_CHECK_ERROR'
      });
    }
  }
  async manualConfirmPayment(req, res) {
  try {
    const { pnr } = req.params;
    
    console.log(`🔧 MANUAL CONFIRM for PNR: ${pnr}`);
    
    // Find payment by PNR
    const payment = await paymentService.getPaymentByPNR(pnr);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found for this PNR'
      });
    }
    
    if (payment.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Payment already confirmed'
      });
    }
    
    // Update payment status manually
    payment.status = 'SUCCESS';
    payment.payment_date = new Date();
    payment.transaction_id = `MANUAL-${Date.now()}`;
    await payment.save();
    
    // Call booking service
    const result = await paymentService.updateBookingStatusInternal(payment);
    
    return res.status(200).json({
      success: true,
      message: 'Payment confirmed manually',
      payment: payment,
      bookingUpdate: result
    });
    
  } catch (error) {
    console.error('Manual confirm error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async webhook(req, res) {
  const sig = req.headers['stripe-signature'];
  
  console.log('📡 Webhook received');
  console.log('Body type:', typeof req.body);
  console.log('Is Buffer:', Buffer.isBuffer(req.body));
  console.log('Body length:', req.body?.length);
  
  let event;

  try {
    // req.body is already a Buffer because of express.raw()
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`✅ Webhook event verified: ${event.type}`);
  } catch (err) {
    console.log(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        console.log(`✅ Payment intent succeeded: ${paymentIntent.id}`);
        await paymentService.confirmPayment(paymentIntent.id);
        break;
        
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log(`🛒 Checkout session completed: ${session.id}`);
        if (session.payment_intent) {
          await paymentService.confirmPayment(session.payment_intent);
        }
        break;
        
      case 'charge.succeeded':
        const charge = event.data.object;
        console.log(`💰 Charge succeeded for payment_intent: ${charge.payment_intent}`);
        if (charge.payment_intent) {
          await paymentService.confirmPayment(charge.payment_intent);
        }
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
}

  async stripePaymentResult(req, res) {
    try {
      const sessionId = req.query.session_id;
      const pnr = req.query.pnr;
      
      console.log('Stripe Result - Session ID:', sessionId, 'PNR:', pnr);
     
      if (!sessionId) {
        return res.json({
          success: false,
          message: 'No session_id in URL',
          received_query: req.query
        });
      }
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      const result = {
        success: true,
        payment_status: session.payment_status,
        session_status: session.status,
        session_id: session.id,
        amount: session.amount_total / 100,
        currency: session.currency,
        customer_email: session.customer_details?.email,
        payment_intent_id: session.payment_intent,
        pnr: pnr
      };
      
      res.json(result);
      
    } catch (error) {
      console.error('Error:', error);
      res.json({ success: false, error: error.message });
    }
  }

  async stripeDebug(req, res) {
    console.log('🔍 STRIPE DEBUG');
    console.log('URL:', req.url);
    console.log('Query:', req.query);
    
    res.json({
      message: 'Debug info',
      method: req.method,
      url: req.url,
      query: req.query
    });
  }

  async stripeDebugRedirect(req, res) {
    console.log('🔍 STRIPE REDIRECT DEBUG');
    console.log('URL:', req.url);
    console.log('Query:', req.query);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Debug</title></head>
      <body>
        <h1>Debug Info</h1>
        <pre>URL: ${req.url}</pre>
        <pre>Query: ${JSON.stringify(req.query, null, 2)}</pre>
      </body>
      </html>
    `);
  }

  async testGetPaymentByPNR(req, res) {
    try {
      const { pnr } = req.params;
      
      const payment = await paymentService.getPaymentByPNR(pnr);
      const bookingDetails = await paymentService.getBookingDetails(pnr);
      
      res.json({
        success: true,
        pnr: pnr,
        paymentFound: !!payment,
        payment: payment,
        bookingFound: !!bookingDetails,
        booking: bookingDetails
      });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  }
}

module.exports = new PaymentController();