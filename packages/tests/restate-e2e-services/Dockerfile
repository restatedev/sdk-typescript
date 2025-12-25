FROM node:20

WORKDIR /usr/src/app

# Install Tini (node:20 already includes python3, make, g++ for native modules)
RUN apt-get update && apt-get install -y tini

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY . .

# Install dependencies (heapdump will build automatically via onlyBuiltDependencies)
RUN pnpm install --frozen-lockfile --dangerouslyAllowAllBuilds

# Build SDK libraries
RUN pnpm build

# Build e2e-services test package
RUN pnpm --filter restate-e2e-services build

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/tests/restate-e2e-services/dist/app.js"]
