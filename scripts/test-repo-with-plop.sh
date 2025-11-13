#!/bin/bash
set -e

echo "=========================================="
echo "Testing Monorepo Setup (Using pnpm new/delete)"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to print status
print_status() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo ""
  echo -e "${RED}✗${NC} $1"
  echo ""
  echo "Cleaning up test packages..."
  cleanup_packages
  echo ""
  echo "=========================================="
  echo -e "${RED}✗ Test failed!${NC}"
  echo "=========================================="
  exit 1
}

print_step() {
  echo ""
  echo -e "${YELLOW}>>> $1${NC}"
}

# Cleanup function
cleanup_packages() {
  rm -rf packages/libs packages/examples packages/tests
  mkdir -p packages/libs packages/examples packages/tests
  pnpm install > /dev/null 2>&1
  pnpm generate:configs > /dev/null 2>&1
}

# Trap errors and cleanup
trap 'print_error "Script failed at line $LINENO"' ERR

# Make sure we start clean
print_step "Cleaning up any existing test packages"
cleanup_packages
print_status "Cleaned up"

# Step 1: Create utils (private lib) using pnpm new
print_step "Step 1: Creating utils package (private lib) with pnpm new"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\r"
expect "Package name:"
send "utils\r"
expect "Should this package be publishable"
send "n\r"
expect eof
EOF
print_status "Created utils package"

# Add source code to utils
cat > packages/libs/utils/src/index.ts << 'EOF'
export function transform(input: string): string {
  return input.toUpperCase().trim();
}
EOF

# Step 2: Create public-api (public lib) using pnpm new
print_step "Step 2: Creating public-api package (public lib) with pnpm new"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\r"
expect "Package name:"
send "public-api\r"
expect "Should this package be publishable"
send "\r"
expect eof
EOF
print_status "Created public-api package"

# Add utils dependency and source code
print_step "Adding utils dependency to public-api"
cd packages/libs/public-api
pnpm add @restatedev/utils@workspace:* > /dev/null 2>&1
cd ../../..
print_status "Added utils dependency"

cat > packages/libs/public-api/src/index.ts << 'EOF'
import { transform } from "@restatedev/utils";

export function hello(name: string): string {
  return `Hello, ${transform(name)}!`;
}
EOF

# Step 3: Create demo example using pnpm new
print_step "Step 3: Creating demo example with pnpm new"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\033\[B\033\[B\r"
expect "Package name:"
send "demo\r"
expect eof
EOF
print_status "Created demo example"

# Add public-api dependency and source code
print_step "Adding public-api dependency to demo"
cd packages/examples/demo
pnpm add @restatedev/public-api@workspace:* > /dev/null 2>&1
cd ../../..
print_status "Added public-api dependency"

cat > packages/examples/demo/src/index.ts << 'EOF'
import { hello } from "@restatedev/public-api";

console.log(hello("world"));
EOF

# Step 4: Create api-tests using pnpm new
print_step "Step 4: Creating api-tests package with pnpm new"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\033\[B\r"
expect "Package name:"
send "api-tests\r"
expect eof
EOF
print_status "Created api-tests package"

# Add public-api dependency and test code
print_step "Adding public-api dependency to api-tests"
cd packages/tests/api-tests
pnpm add @restatedev/public-api@workspace:* > /dev/null 2>&1
cd ../../..
print_status "Added public-api dependency"

cat > packages/tests/api-tests/src/index.test.ts << 'EOF'
import { describe, it, expect } from "vitest";
import { hello } from "@restatedev/public-api";

describe("hello", () => {
  it("should return a greeting", () => {
    expect(hello("world")).toBe("Hello, WORLD!");
  });
});
EOF

# Step 4a: Add custom entry point to public-api
print_step "Step 4a: Adding custom entry point 'helpers' to public-api"
expect << 'EOF'
set timeout 30
spawn pnpm add-entry
expect "Select a public lib package:"
send "\r"
expect "Entry point name"
send "helpers\r"
expect eof
EOF
print_status "Added helpers entry point"

# Add code to helpers entry
cat > packages/libs/public-api/src/helpers.ts << 'EOF'
export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

export function reverse(input: string): string {
  return input.split("").reverse().join("");
}
EOF

# Step 4b: Create api-tests-helpers to test the custom entry
print_step "Step 4b: Creating api-tests-helpers package"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\033\[B\r"
expect "Package name:"
send "api-tests-helpers\r"
expect eof
EOF
print_status "Created api-tests-helpers package"

# Add public-api dependency and test code for helpers
print_step "Adding public-api dependency to api-tests-helpers"
cd packages/tests/api-tests-helpers
pnpm add @restatedev/public-api@workspace:* > /dev/null 2>&1
cd ../../..
print_status "Added public-api dependency"

cat > packages/tests/api-tests-helpers/src/index.test.ts << 'EOF'
import { describe, it, expect } from "vitest";
import { capitalize, reverse } from "@restatedev/public-api/helpers";

describe("helpers", () => {
  it("should capitalize strings", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("WORLD")).toBe("World");
  });

  it("should reverse strings", () => {
    expect(reverse("hello")).toBe("olleh");
    expect(reverse("abc")).toBe("cba");
  });
});
EOF

# Step 4c: Create demo-helpers example using custom entry
print_step "Step 4c: Creating demo-helpers example"
expect << 'EOF'
set timeout 30
spawn pnpm new
expect "Package type:"
send "\033\[B\033\[B\r"
expect "Package name:"
send "demo-helpers\r"
expect eof
EOF
print_status "Created demo-helpers example"

# Add public-api dependency and source code
print_step "Adding public-api dependency to demo-helpers"
cd packages/examples/demo-helpers
pnpm add @restatedev/public-api@workspace:* > /dev/null 2>&1
cd ../../..
print_status "Added public-api dependency"

cat > packages/examples/demo-helpers/src/index.ts << 'EOF'
import { capitalize, reverse } from "@restatedev/public-api/helpers";

console.log("Capitalize:", capitalize("hello world"));
console.log("Reverse:", reverse("hello"));
EOF

# Step 5: Test watch mode (verify it starts and runs tests successfully)
print_step "Step 5: Testing pnpm test:watch (running for 5 seconds)"
WATCH_LOG=$(mktemp)
pnpm test:watch > "$WATCH_LOG" 2>&1 &
WATCH_PID=$!
sleep 5
if ! ps -p $WATCH_PID > /dev/null 2>&1; then
  cat "$WATCH_LOG"
  rm "$WATCH_LOG"
  print_error "test:watch failed to start or crashed"
fi
kill $WATCH_PID 2>/dev/null || true
wait $WATCH_PID 2>/dev/null || true

# Check for test failures
if grep -q "FAIL" "$WATCH_LOG" || grep -q "failed" "$WATCH_LOG"; then
  cat "$WATCH_LOG"
  rm "$WATCH_LOG"
  print_error "test:watch has failing tests"
fi

# Check that tests actually ran and passed (should have 2 test files now)
if grep -q "Test Files.*2 passed" "$WATCH_LOG" || grep -q "2 pass" "$WATCH_LOG"; then
  rm "$WATCH_LOG"
  print_status "test:watch works"
else
  cat "$WATCH_LOG"
  rm "$WATCH_LOG"
  print_error "test:watch did not run tests successfully (expected 2 test files)"
fi

# Step 6: Dev mode (verify it starts without errors)
print_step "Step 6: Testing pnpm dev (running for 5 seconds)"
DEV_LOG=$(mktemp)
pnpm dev > "$DEV_LOG" 2>&1 &
DEV_PID=$!
sleep 5
if ! ps -p $DEV_PID > /dev/null 2>&1; then
  cat "$DEV_LOG"
  rm "$DEV_LOG"
  print_error "dev failed to start or crashed"
fi
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
if grep -qi "error" "$DEV_LOG" && ! grep -qi "0 error" "$DEV_LOG"; then
  cat "$DEV_LOG"
  rm "$DEV_LOG"
  print_error "dev reported errors"
fi
rm "$DEV_LOG"
print_status "dev works"

# Step 7: Example dev mode (verify it runs and outputs expected content)
print_step "Step 7: Testing pnpm examples:dev demo (running for 5 seconds)"
EXAMPLE_LOG=$(mktemp)
pnpm examples:dev demo > "$EXAMPLE_LOG" 2>&1 &
EXAMPLE_PID=$!
sleep 5
if ! ps -p $EXAMPLE_PID > /dev/null 2>&1; then
  cat "$EXAMPLE_LOG"
  rm "$EXAMPLE_LOG"
  print_error "examples:dev failed to start or crashed"
fi
kill $EXAMPLE_PID 2>/dev/null || true
wait $EXAMPLE_PID 2>/dev/null || true
if grep -q "Hello, WORLD!" "$EXAMPLE_LOG"; then
  rm "$EXAMPLE_LOG"
  print_status "examples:dev works"
else
  cat "$EXAMPLE_LOG"
  rm "$EXAMPLE_LOG"
  print_error "examples:dev did not produce expected output"
fi

# Step 7a: Test demo-helpers example (custom entry point)
print_step "Step 7a: Testing pnpm examples:dev demo-helpers (running for 5 seconds)"
HELPERS_LOG=$(mktemp)
pnpm examples:dev demo-helpers > "$HELPERS_LOG" 2>&1 &
HELPERS_PID=$!
sleep 5
if ! ps -p $HELPERS_PID > /dev/null 2>&1; then
  cat "$HELPERS_LOG"
  rm "$HELPERS_LOG"
  print_error "examples:dev demo-helpers failed to start or crashed"
fi
kill $HELPERS_PID 2>/dev/null || true
wait $HELPERS_PID 2>/dev/null || true
if grep -q "Capitalize: Hello world" "$HELPERS_LOG" && grep -q "Reverse: olleh" "$HELPERS_LOG"; then
  rm "$HELPERS_LOG"
  print_status "examples:dev demo-helpers works"
else
  cat "$HELPERS_LOG"
  rm "$HELPERS_LOG"
  print_error "examples:dev demo-helpers did not produce expected output"
fi

# Step 8: Check format
print_step "Step 8: Running pnpm check:format"
pnpm check:format || print_error "Failed check:format"
print_status "check:format passed"

# Step 9: Lint
print_step "Step 9: Running pnpm lint"
pnpm lint || print_error "Failed lint"
print_status "lint passed"

# Step 10: Check types
print_step "Step 10: Running pnpm check:types"
pnpm check:types || print_error "Failed check:types"
print_status "check:types passed"

# Step 11: Build
print_step "Step 11: Running pnpm build:all"
pnpm build:all || print_error "Failed build:all"
print_status "build:all passed"

# Step 12: Check exports
print_step "Step 12: Running pnpm check:exports"
pnpm check:exports || print_error "Failed check:exports"
print_status "check:exports passed"

# Step 13: Check API
print_step "Step 13: Running pnpm check:api"
pnpm check:api || print_error "Failed check:api"
print_status "check:api passed"

# Step 14: Test
print_step "Step 14: Running pnpm test"
pnpm test || print_error "Failed test"
print_status "test passed"

# Step 15: Build examples
print_step "Step 15: Building examples"
pnpm --filter @restatedev/demo build || print_error "Failed to build example"
print_status "Example built"

# Step 16: Start examples (verify output)
print_step "Step 16: Starting example (running for 5 seconds)"
START_LOG=$(mktemp)
pnpm --filter @restatedev/demo start > "$START_LOG" 2>&1 &
START_PID=$!
sleep 5
kill $START_PID 2>/dev/null || true
wait $START_PID 2>/dev/null || true
if grep -q "Hello, WORLD!" "$START_LOG"; then
  rm "$START_LOG"
  print_status "Example start works"
else
  cat "$START_LOG"
  rm "$START_LOG"
  print_error "Example start did not produce expected output"
fi

# Step 16a: Build and start demo-helpers example (custom entry point)
print_step "Step 16a: Building and starting demo-helpers example"
pnpm --filter @restatedev/demo-helpers build || print_error "Failed to build demo-helpers"
print_status "demo-helpers built"

HELPERS_START_LOG=$(mktemp)
pnpm --filter @restatedev/demo-helpers start > "$HELPERS_START_LOG" 2>&1 &
HELPERS_START_PID=$!
sleep 5
kill $HELPERS_START_PID 2>/dev/null || true
wait $HELPERS_START_PID 2>/dev/null || true
if grep -q "Capitalize: Hello world" "$HELPERS_START_LOG" && grep -q "Reverse: olleh" "$HELPERS_START_LOG"; then
  rm "$HELPERS_START_LOG"
  print_status "demo-helpers start works"
else
  cat "$HELPERS_START_LOG"
  rm "$HELPERS_START_LOG"
  print_error "demo-helpers start did not produce expected output"
fi

# Step 17: Delete all packages
print_step "Step 17: Deleting all packages"
cleanup_packages
print_status "Deleted all packages"

# Verify all packages are deleted
print_step "Verifying all packages are deleted"
if [ -d "packages/libs/utils" ] || [ -d "packages/libs/public-api" ] || [ -d "packages/examples/demo" ] || [ -d "packages/tests/api-tests" ]; then
  print_error "Some packages were not deleted properly"
fi
print_status "All packages deleted successfully"

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All tests passed!${NC}"
echo "=========================================="
