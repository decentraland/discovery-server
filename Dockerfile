# Base image is Debian Trixie (glibc 2.41). The service itself uses @dcl/http-server
# (no uWebSockets), so musl/alpine would technically work — but we standardize on
# trixie-slim to match the org's other new-stack services and stay compatible if
# @dcl/uws-http-server is ever added.
FROM node:24-trixie-slim AS builderenv

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# build the app
COPY . /app
RUN yarn install --frozen-lockfile
RUN yarn build

# remove devDependencies, keep only production dependencies
RUN yarn install --prod --frozen-lockfile

########################## END OF BUILD STAGE ##########################

FROM node:24-trixie-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

# NODE_ENV is used to configure some runtime options, like JSON logger
ENV NODE_ENV=production

ARG COMMIT_HASH=local
ENV COMMIT_HASH=${COMMIT_HASH:-local}

ARG CURRENT_VERSION=Unknown
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

WORKDIR /app
COPY --from=builderenv /app /app

RUN echo "" > /app/.env

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) from reaching the service.
# Migrations run at component start via @dcl/pg-component, so no separate step.
ENTRYPOINT ["tini", "--"]
CMD ["/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js"]
