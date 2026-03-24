# SSL certificates for MySQL (e.g. Aiven)

Place your CA certificate here when connecting with `ssl-mode=REQUIRED` to a provider that uses a custom CA.

**Example (Aiven):**

1. Download the CA certificate from your Aiven project (e.g. **Service → MySQL → Connection information → CA certificate**).
2. Save it in this folder as `ca.pem`:
   ```
   certs/ca.pem
   ```
3. Set the path in your environment (in `.env` or `.env.local`):
   ```bash
   MYSQL_SSL_CA=certs/ca.pem
   ```
   Or use an absolute path:
   ```bash
   MYSQL_SSL_CA=/full/path/to/certs/ca.pem
   ```

**Env variables:**

- `MYSQL_SSL_CA` or `MYSQL_SSL_CA_PATH` – path to the CA certificate file (`.pem`). Relative paths are resolved from the project root (current working directory when the app starts).

If you don’t set `MYSQL_SSL_CA`, the app uses the system’s default CA store. For Aiven and similar providers, you typically need to set the CA file.

**Security:** `*.pem` in this folder is gitignored. Do not commit real CA or client certificates.
