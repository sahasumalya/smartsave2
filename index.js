require('./config/loadEnv');
const express = require('express');
const { error: logError, info } = require('./utils/logger');
const { requestLogger } = require('./middleware/requestLogger');

// Keep process alive on uncaught errors; log and continue (no sensitive data in stack)
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err.stack || err.message);
});

process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', String(reason));
});

const { errorHandler } = require('./middleware/errorHandler');
const { corsMiddleware } = require('./middleware/corsConfig');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const paymentsRoutes = require('./routes/payments');
const investmentsRoutes = require('./routes/investments');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(corsMiddleware);
app.use(express.json());
app.use(requestLogger);

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
  info(`Server running at http://localhost:${PORT}`);
});
