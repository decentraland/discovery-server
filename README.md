# Discovery Server

The Decentraland Discovery Server processes Catalysts' scenes and Worlds deployments, fetches content from servers, and maintains a database of places for the Decentraland ecosystem.

![decentraland](https://decentraland.org/images/fallback-hero.jpg)

## How It Works

The service receives SQS messages containing entity IDs and content server URLs, fetches scene or world metadata, and creates Place records in the database. It exposes HTTP endpoints for querying this data and provides health check endpoints for monitoring.

## Setup

### Prerequisites

- Docker and Docker Compose
- Node.js (see `.nvmrc` for version)

### Quick Start

1. **Environment**

   ```bash
   cp .env.default .env
   ```

   Update `.env` with your configuration:

   ```bash
   # HTTP Server
   HTTP_SERVER_PORT=3000
   HTTP_SERVER_HOST=0.0.0.0

   # Metrics
   WKC_METRICS_RESET_AT_NIGHT=false

   # Database
   CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/postgres

   # SQS
   AWS_SQS_QUEUE_URL=http://localhost:4566/000000000000/places_test
   AWS_SQS_ENDPOINT=http://localhost:4566

   # AWS
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=test
   AWS_SECRET_ACCESS_KEY=test
   ```

2. **Services**

   ```bash
   docker-compose up -d  # Starts PostgreSQL + LocalStack (SQS)
   yarn install
   yarn migrate up       # Run database migrations
   ```

3. **Run**

   Development mode (with auto-reload):
   ```bash
   yarn dev
   ```

   Production mode:
   ```bash
   yarn build
   yarn start
   ```

### Test SQS Integration

```bash
# Send a test message to the SQS queue
aws --endpoint-url=http://localhost:4566 sqs send-message \
  --queue-url http://localhost:4566/000000000000/places_test \
  --message-body '{"entityId":"bafkreiabc123","contentServerUrl":"https://peer.decentraland.org"}'
```

## Healthcheck

The service exposes two endpoints for health checking:

### `/ping` endpoint

Simple ping endpoint that returns the pathname:

```bash
curl http://localhost:3000/ping
```

**Response:**
```
/ping
```

### `/status` endpoint

Full status endpoint with version information:

```bash
curl http://localhost:3000/status
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-16T12:34:56.789Z",
  "version": "1.0.0",
  "image": "discovery-server:latest"
}
```

## Architecture

This service follows an extension of "ports and adapters architecture", also known as "hexagonal architecture".

Code is organized into several layers: **logic**, **controllers**, **adapters**, and **components** (ports).

### Application lifecycle

1. **Start application lifecycle** - Handled by [src/index.ts](src/index.ts) in only one line of code: `Lifecycle.run({ main, initComponents })`
2. **Create components** - Handled by [src/components.ts](src/components.ts) in the function `initComponents`
3. **Wire application & start components** - Handled by [src/service.ts](src/service.ts) in the function `main`.
   1. First wire HTTP routes and handlers with [controllers](#srccontrollers)
   2. Then call to `startComponents()` to initialize the components (i.e. http-listener)

The same lifecycle is also valid for tests: [test/components.ts](test/components.ts)

### Namespaces

#### src/logic

Deals with pure business logic and shouldn't have side-effects or throw exceptions.

#### src/controllers

The "glue" between all the other layers, orchestrating calls between pure business logic and adapters.

Controllers always receive a hydrated context containing components and parameters to call the business logic e.g:

```ts
// handler for /ping
export async function pingHandler(context: {
  url: URL // parameter added by http-server
  components: AppComponents // components of the app, part of the global context
}) {
  components.metrics.increment("test_ping_counter")
  return { status: 200 }
}
```

#### src/adapters

The layer that converts external data representations into internal ones, and vice-versa. Acts as buffer to protect the service from changes in the outside world; when a data representation changes, you only need to change how the adapters deal with it.

#### src/components.ts

We use the components abstraction to organize our adapters (e.g. HTTP client, database client, redis client, SQS client) and any other logic that needs to track mutable state or encode dependencies between stateful components. For every environment (e.g. test, e2e, prod, staging...) we have a different version of our component systems, enabling us to easily inject mocks or different implementations for different contexts.

We make components available to incoming HTTP and SQS handlers. For instance, the HTTP server handlers have access to things like the database or HTTP components, and pass them down to the controller level for general use.

## Quick Commands

```bash
yarn install           # Install dependencies
yarn dev              # Development server with auto-reload
yarn build            # Build TypeScript to dist/
yarn start            # Start production server
yarn test             # Run tests
yarn migrate up       # Run database migrations
docker-compose up -d  # Start PostgreSQL + LocalStack
```

