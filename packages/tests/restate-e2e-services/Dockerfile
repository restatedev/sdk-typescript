FROM node:20

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /usr/src/app

COPY . .

RUN pnpm install --frozen-lockfile

# Build all packages (libs + tests)
RUN pnpm run build:all
RUN pnpm --filter restate-e2e-services rebuild heapdump

# Install Tini
RUN apt-get update && apt-get -y install tini

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/tests/restate-e2e-services/dist/src/app.js"]
