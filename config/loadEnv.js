const path = require('path');
const dotenv = require('dotenv');

const NODE_ENV = process.env.NODE_ENV || 'development';

// 1. Base defaults (all environments)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// 2. Environment-specific (.env.development, .env.staging, .env.production, etc.)
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`),
  override: true,
});

// 3. Local overrides (optional, not committed – for secrets per machine)
/*dotenv.config({
  path: path.resolve(process.cwd(), '.env.local'),
  override: true,
});*/

module.exports = { NODE_ENV };
