#!/usr/bin/env bash
# Run app + MySQL with Docker or Podman (no Compose). Use from project root.
# Usage: ./scripts/docker-run.sh
#        CONTAINER_CMD=podman ./scripts/docker-run.sh

set -e
cd "$(dirname "$0")/.."

# Use Podman if CONTAINER_CMD=podman, otherwise docker
CONTAINER_CMD="${CONTAINER_CMD:-docker}"

NETWORK="smartsave-net"
MYSQL_CONTAINER="smartsave-mysql"
APP_CONTAINER="smartsave-app"

# Remove existing containers (and MySQL volume) from a previous run for a clean start
$CONTAINER_CMD rm -f "$APP_CONTAINER" 2>/dev/null || true
$CONTAINER_CMD rm -f -v "$MYSQL_CONTAINER" 2>/dev/null || true

echo "Using $CONTAINER_CMD"
echo "Creating network..."
$CONTAINER_CMD network create "$NETWORK" 2>/dev/null || true

echo "Starting MySQL..."
# Note: --default-authentication-plugin was removed in MySQL 8.4+; do not use it
$CONTAINER_CMD run -d --name "$MYSQL_CONTAINER" \
  --network "$NETWORK" \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=smartsave \
  -e MYSQL_USER=smartsave \
  -e MYSQL_PASSWORD=smartsave \
  -p 3306:3306 \
  mysql:8

echo "Waiting for MySQL to be ready..."
sleep 5

# Check if MySQL container is still running (it often exits with code 1 on Podman if init fails)
MYSQL_STATE=$($CONTAINER_CMD inspect -f '{{.State.Running}}' "$MYSQL_CONTAINER" 2>/dev/null || echo "false")
if [ "$MYSQL_STATE" != "true" ]; then
  echo "ERROR: MySQL container exited. Logs:"
  $CONTAINER_CMD logs "$MYSQL_CONTAINER" 2>&1 || true
  echo ""
  echo "Tip: With Podman, try removing the container and running again. If it keeps failing, use Docker Desktop or run MySQL locally."
  exit 1
fi

# Get MySQL container IP (Docker/Podman use different inspect; try both)
MYSQL_IP=$($CONTAINER_CMD inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MYSQL_CONTAINER" 2>/dev/null)
if [ -z "$MYSQL_IP" ]; then
  MYSQL_IP=$($CONTAINER_CMD inspect -f '{{.NetworkSettings.IPAddress}}' "$MYSQL_CONTAINER" 2>/dev/null)
fi
if [ -z "$MYSQL_IP" ]; then
  # Podman: try network-specific IP
  MYSQL_IP=$($CONTAINER_CMD inspect -f '{{(index .NetworkSettings.Networks "smartsave-net").IPAddress}}' "$MYSQL_CONTAINER" 2>/dev/null)
fi
if [ -z "$MYSQL_IP" ]; then
  echo "Could not get MySQL container IP. Waiting longer..."
  sleep 10
  MYSQL_IP=$($CONTAINER_CMD inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MYSQL_CONTAINER" 2>/dev/null)
fi
if [ -z "$MYSQL_IP" ]; then
  echo "ERROR: Could not get MySQL container IP. Container running? Check: $CONTAINER_CMD ps -a"
  exit 1
fi
echo "MySQL container IP: $MYSQL_IP"
# Wait for MySQL to accept connections (use root for ping; smartsave may not exist yet)
for i in 1 2 3 4 5 6 7 8 9 10; do
  if $CONTAINER_CMD run --rm --network "$NETWORK" -e MYSQL_PWD=root mysql:8 mysqladmin ping -h "$MYSQL_IP" -u root --silent 2>/dev/null; then
    break
  fi
  echo "  waiting for MySQL... ($i/10)"
  sleep 3
done

echo "Running DB schema..."
$CONTAINER_CMD run --rm --network "$NETWORK" \
  -v "$(pwd)/db/schema.sql:/schema.sql" \
  -e MYSQL_PWD=smartsave \
  mysql:8 sh -c "mysql -h $MYSQL_IP -u smartsave smartsave < /schema.sql"

echo "Building app image..."
$CONTAINER_CMD build -t smartsave-app .

echo "Starting app..."
$CONTAINER_CMD run --rm --name "$APP_CONTAINER" \
  --network "$NETWORK" \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DATABASE_URL=mysql://smartsave:smartsave@${MYSQL_IP}:3306/smartsave \
  -e JWT_SECRET="${JWT_SECRET:-change-me-in-production}" \
  -e NODE_ENV=production \
  smartsave-app
