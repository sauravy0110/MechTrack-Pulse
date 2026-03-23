#!/bin/bash

# MechTrack Pulse — Full E2E Test Runner
# This script sets up the environment and runs all modular tests.

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "🚀 ${GREEN}Starting MechTrack Pulse E2E Testing...${NC}"

# 1. Environment Check
if [ ! -d "backend" ]; then
    echo -e "${RED}Error: Run this from the project root.${NC}"
    exit 1
fi

# 2. Database Setup (Optional: Reset Test DB)
# In our pytest fixtures, we handle DB recreation, so it's best to let pytest do it.

# 3. Run Pytest
echo -e "⚙️ ${GREEN}Running modular tests with pytest...${NC}"
cd backend
if [ -x "venv/bin/pytest" ]; then
    TEST_CMD="venv/bin/pytest"
elif [ -x "../.venv/bin/python" ]; then
    TEST_CMD="../.venv/bin/python -m pytest"
else
    echo -e "${RED}Error: No usable pytest environment found.${NC}"
    exit 1
fi

eval "$TEST_CMD tests/ -v"

# 4. Result Summary
if [ $? -eq 0 ]; then
    echo -e "✅ ${GREEN}E2E Testing PASS. System is solid.${NC}"
    exit 0
else
    echo -e "❌ ${RED}E2E Testing FAIL. Issues detected.${NC}"
    exit 1
fi
