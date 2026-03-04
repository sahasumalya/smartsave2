require('./config/loadEnv');
const express = require('express');

// Keep process alive on uncaught errors; log and continue
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack || err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
});

const { errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const paymentsRoutes = require('./routes/payments');
const investmentsRoutes = require('./routes/investments');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/investments', investmentsRoutes);

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' });
});

// Central exception handler: any unknown error from handlers → 500 Internal Server Error
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
