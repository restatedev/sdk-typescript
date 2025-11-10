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

# Install build tools needed for native modules and Tini
RUN apt-get update && apt-get install -y python3 make g++ tini

# Debug: Show heapdump location
RUN echo "=== Finding heapdump ===" && find /usr/src/app -name "heapdump" -type d

# Try different rebuild approaches
RUN echo "=== Rebuilding heapdump with verbose output ===" && cd /usr/src/app/node_modules/.pnpm/heapdump@0.3.15/node_modules/heapdump && npm rebuild --verbose

# Debug: Check if heapdump was built
RUN echo "=== Checking heapdump build ===" && ls -la /usr/src/app/node_modules/.pnpm/heapdump@0.3.15/node_modules/heapdump/build/ || echo "No build folder found"

# Debug: Try to actually run the app for a few seconds  
RUN echo "=== Testing app startup ===" && timeout 5 node /usr/src/app/packages/tests/restate-e2e-services/dist/app.js && echo "✅ App started successfully" || echo "⚠️ App test completed (timeout or error - check logs above)"

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/tests/restate-e2e-services/dist/app.js"]
