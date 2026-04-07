const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');

// ==================== WEBHOOK - MUST BE FIRST AND USE RAW BODY ====================
// This route must be defined before any express.json() middleware
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.webhook);

// ==================== NOW APPLY JSON MIDDLEWARE FOR ALL OTHER ROUTES ====================
router.use(express.json());

// ==================== PUBLIC PAGES ====================
router.get('/payment-success', paymentController.paymentSuccess);
router.get('/payment-cancel', paymentController.paymentCancel);
router.get('/payment-status/:pnr', paymentController.paymentStatus);

// Stripe debug endpoints
router.get('/stripe-result', paymentController.stripePaymentResult);
router.get('/stripe-debug', paymentController.stripeDebug);
router.get('/stripe-redirect-debug', paymentController.stripeDebugRedirect);

// Test endpoint
router.get('/test-payment/:pnr', paymentController.testGetPaymentByPNR);

// ==================== PROTECTED API ENDPOINTS ====================
router.post('/create-payment-intent', authMiddleware(), paymentController.createPaymentIntent);
router.post('/create-checkout-session', authMiddleware(), paymentController.createCheckoutSession);
router.post('/confirm-payment', paymentController.confirmPayment);
router.get('/payment/:payment_id', authMiddleware(), paymentController.getPayment);
router.get('/payment/pnr/:pnr', authMiddleware(), paymentController.getPaymentByPNR);
router.get('/my-payments', authMiddleware(), paymentController.getUserPayments);
router.get('/status/:pnr', authMiddleware(), paymentController.getPaymentStatus);
router.post('/refund/:payment_id', authMiddleware(), paymentController.refundPayment);

// Manual confirm (for testing)
router.post('/manual-confirm/:pnr', paymentController.manualConfirmPayment);

module.exports = router;