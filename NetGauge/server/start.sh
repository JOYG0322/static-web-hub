#!/bin/bash
cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo ""
echo "Starting NetGauge Server..."
node server.js
