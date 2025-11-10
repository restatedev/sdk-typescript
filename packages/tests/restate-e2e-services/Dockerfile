FROM node:20

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /usr/src/app

COPY . .

RUN pnpm install --frozen-lockfile

# Build all packages (libs + tests)
RUN echo "=== Building SDK libraries ===" && pnpm build

# Debug: Check if restate-sdk built
RUN echo "=== Checking restate-sdk dist ===" && ls -la /usr/src/app/packages/libs/restate-sdk/dist/ | head -20

# Build e2e-services
RUN echo "=== Building e2e-services ===" && pnpm --filter restate-e2e-services build

# Debug: Check build output
RUN echo "=== Checking e2e-services dist structure ===" && ls -la /usr/src/app/packages/tests/restate-e2e-services/dist/ || echo "dist folder not found!"

# Debug: Find app.js location
RUN echo "=== Looking for app.js ===" && find /usr/src/app/packages/tests/restate-e2e-services/dist -name "app.js" -o -name "*.js" | head -20 || echo "No JS files found!"

# Verify app.js exists
RUN test -f /usr/src/app/packages/tests/restate-e2e-services/dist/app.js || (echo "ERROR: app.js not found at expected location!" && ls -R /usr/src/app/packages/tests/restate-e2e-services/dist/ && exit 1)

# Debug: Test Node can load the module
RUN echo "=== Testing if app.js can be loaded ===" && node --check /usr/src/app/packages/tests/restate-e2e-services/dist/app.js && echo "✅ Syntax check passed"

# Debug: Check module resolution
RUN echo "=== Checking SDK package resolution ===" && cd /usr/src/app/packages/tests/restate-e2e-services && node --input-type=module -e "console.log('Checking SDK...'); await import('@restatedev/restate-sdk'); console.log('✅ SDK loaded successfully')" || echo "❌ SDK failed to load"

# Rebuild heapdump native module (must be done before running the app)
RUN echo "=== Rebuilding heapdump ===" && pnpm rebuild heapdump

# Debug: Try to actually run the app for a few seconds
RUN echo "=== Testing app startup ===" && timeout 5 node /usr/src/app/packages/tests/restate-e2e-services/dist/app.js || echo "App test completed (timeout expected)"

# Install Tini
RUN apt-get update && apt-get -y install tini

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/tests/restate-e2e-services/dist/app.js"]
