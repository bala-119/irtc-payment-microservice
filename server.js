require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./app/config/connectDB');
const paymentRoutes = require('./app/routers/paymentRoutes');

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: 'https://bala-119.github.io',
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/payments', paymentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Payment Microservice' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`🚀 Payment Microservice running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});