#!/bin/bash

# TITAN OMEGA v21.0 Startup Script
# =================================

echo "╔══════════════════════════════════════════════════════════════════════════════╗"
echo "║                     TITAN OMEGA v21.0 - STARTUP                              ║"
echo "╚══════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Check for API key
if [ -z "$POLYGON_API_KEY" ]; then
    echo "⚠️  WARNING: POLYGON_API_KEY not set!"
    echo ""
    echo "To run with live data:"
    echo "  export POLYGON_API_KEY='your_api_key_here'"
    echo "  ./run_titan.sh"
    echo ""
    echo "Running in LIMITED MODE (no real-time data)..."
    echo "Press CTRL+C to stop"
    echo ""
fi

# Start the system
python3 titan_omega_v21.py
