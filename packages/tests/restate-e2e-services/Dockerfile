FROM node:20

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /usr/src/app

COPY . .

RUN pnpm install --frozen-lockfile

# Build SDK libraries
RUN pnpm build

# Build e2e-services test package
RUN pnpm --filter restate-e2e-services build

# Install build tools needed for native modules and Tini
RUN apt-get update && apt-get install -y python3 make g++ tini

# Rebuild heapdump native module
RUN cd /usr/src/app/node_modules/.pnpm/heapdump@0.3.15/node_modules/heapdump && npm rebuild

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/tests/restate-e2e-services/dist/app.js"]
