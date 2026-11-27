#!/bin/bash

# Test graceful shutdown behavior
# This script verifies that the application handles SIGTERM/SIGINT correctly

set -e

echo "🧪 Testing Graceful Shutdown..."
echo ""

# Start the application in the background
echo "1️⃣  Starting application..."
pnpm --filter api dev &
APP_PID=$!

# Wait for the application to start
echo "⏳ Waiting for application to start (5 seconds)..."
sleep 5

# Check if process is running
if ! ps -p $APP_PID > /dev/null; then
  echo "❌ Application failed to start"
  exit 1
fi

echo "✅ Application started (PID: $APP_PID)"
echo ""

# Send SIGTERM
echo "2️⃣  Sending SIGTERM signal..."
kill -TERM $APP_PID

# Wait for graceful shutdown (max 10 seconds)
echo "⏳ Waiting for graceful shutdown..."
TIMEOUT=10
while [ $TIMEOUT -gt 0 ]; do
  if ! ps -p $APP_PID > /dev/null 2>&1; then
    echo "✅ Application shut down gracefully"
    exit 0
  fi
  sleep 1
  TIMEOUT=$((TIMEOUT - 1))
done

# If we reach here, process didn't exit in time
echo "❌ Application did not shut down within timeout"
echo "⚠️  Force killing process..."
kill -9 $APP_PID
exit 1
