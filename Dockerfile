FROM node:lts-alpine as builder

# Install build dependencies for native modules and yarn
RUN apk add --no-cache build-base python3 yarn

WORKDIR /app

# Copy dependency definitions first for better layer caching
COPY package.json yarn.lock ./

# Install all dependencies (including devDependencies for build and test)
RUN yarn install --frozen-lockfile

# Copy source code and configuration
COPY tsconfig.json jest.config.js ./
COPY src ./src
COPY test ./test

# Build TypeScript to JavaScript
RUN yarn build

# Set minimal environment variables required for tests
ENV HTTP_SERVER_PORT=3000 \
    HTTP_SERVER_HOST=0.0.0.0 \
    WKC_METRICS_RESET_AT_NIGHT=false

# Run tests to validate build (fails fast if tests don't pass)
RUN yarn test

# Remove devDependencies to reduce final image size
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# ============================================
# Production Stage
# ============================================
FROM node:lts-alpine

# We use Tini to handle signals and PID1 in ECS
# https://github.com/krallin/tini - read why here: https://github.com/krallin/tini/issues/8
# Tini ensures graceful shutdowns when ECS sends SIGTERM
# Using tini-static for Alpine compatibility (musl libc)
ENV TINI_VERSION=v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static /tini
RUN chmod +x /tini

ENV NODE_ENV=production

WORKDIR /app

# Copy only production artifacts from builder stage
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

# Use Tini as entrypoint for proper signal handling (SIGTERM from ECS)
# This ensures graceful shutdowns when ECS stops the container
ENTRYPOINT ["/tini", "--"]

# Start the application with Node.js flags for production
CMD ["node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js"]
