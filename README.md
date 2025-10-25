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

#### Option 1: Docker Compose (Recommended for Local Development)

The easiest way to run the entire stack locally:

1. **Setup Environment**

   ```bash
   cp .env.default .env
   ```

   Update `.env` with your configuration (or use defaults):

   ```bash
   # HTTP Server
   HTTP_SERVER_PORT=3000
   HTTP_SERVER_HOST=0.0.0.0

   # Metrics
   WKC_METRICS_RESET_AT_NIGHT=false

   # Database (overridden in docker compose for container networking)
   CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/postgres

   # SQS (overridden in docker compose for container networking)
   AWS_SQS_QUEUE_URL=http://localhost:4566/000000000000/places_test
   AWS_SQS_ENDPOINT=http://localhost:4566

   # AWS
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=test
   AWS_SECRET_ACCESS_KEY=test
   ```

2. **Start Everything**

   ```bash
   docker compose up
   ```

   This starts:
   - **PostgreSQL** (port 5432) - Database
   - **LocalStack** (port 4566) - SQS emulator
   - **Discovery Server** (port 3000) - The application

   All services include health checks and will wait for dependencies to be ready.

3. **Run Migrations**

   In a new terminal:
   ```bash
   docker compose exec discovery-server yarn migrate up
   ```

4. **View Logs**

   ```bash
   # All services
   docker compose logs -f

   # Specific service
   docker compose logs -f discovery-server
   ```

5. **Stop Everything**

   ```bash
   docker compose down
   ```

#### Option 2: Local Development (Node.js)

For faster iteration during development:

1. **Setup Environment**

   ```bash
   cp .env.default .env
   # Edit .env with your configuration
   ```

2. **Start Infrastructure Only**

   ```bash
   docker compose up db localstack -d
   ```

   LocalStack will automatically create the SQS queue via the initialization hook.

3. **Install & Run Locally**

   ```bash
   yarn install
   yarn migrate up       # Run database migrations
   yarn dev             # Start with auto-reload
   ```

   Or for production mode:
   ```bash
   yarn build
   yarn start
   ```

### Test SQS Integration

Use the provided script to send a test message to the SQS queue:

```bash
# Using default test data
./bin/test-sqs.sh

# Or provide custom entity ID and content server URL
./bin/test-sqs.sh "bafkreixyz789" "https://custom-peer.decentraland.org"
```

The script reads configuration from environment variables (`AWS_SQS_ENDPOINT` and `AWS_SQS_QUEUE_URL`) or uses defaults for LocalStack.

> **Note:** LocalStack resources (SQS queues) are initialized **automatically** when using docker compose via the initialization hook in `localstack-init/init-resources.sh`.

## Healthcheck

The service exposes a status endpoint for health checking:

### `/status` endpoint

Status endpoint with version and deployment information:

```bash
curl http://localhost:3000/status
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-16T12:34:56.789Z",
  "version": "1.0.0",
  "commitHash": "abc123def456"
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
// handler for /status
export async function statusHandler(context: {
  components: Pick<AppComponents, 'config'> // only the components needed
}) {
  const version = await context.components.config.getString('CURRENT_VERSION')
  return { 
    status: 200,
    body: JSON.stringify({ status: 'ok', version, timestamp: new Date() })
  }
}
```

#### src/adapters

The layer that converts external data representations into internal ones, and vice-versa. Acts as buffer to protect the service from changes in the outside world; when a data representation changes, you only need to change how the adapters deal with it.

#### src/components.ts

We use the components abstraction to organize our adapters (e.g. HTTP client, database client, redis client, SQS client) and any other logic that needs to track mutable state or encode dependencies between stateful components. For every environment (e.g. test, e2e, prod, staging...) we have a different version of our component systems, enabling us to easily inject mocks or different implementations for different contexts.

We make components available to incoming HTTP and SQS handlers. For instance, the HTTP server handlers have access to things like the database or HTTP components, and pass them down to the controller level for general use.

## Quick Commands

### Local Development (Node.js)
```bash
yarn install                         # Install dependencies
yarn dev                            # Development server with auto-reload
yarn build                          # Build TypeScript to dist/
yarn start                          # Start production server
yarn test                           # Run tests
yarn migrate up                     # Run database migrations
./bin/test-sqs.sh                   # Send test message to SQS queue
```

### Docker Compose
```bash
docker compose up                   # Start all services (app + infrastructure)
docker compose up -d                # Start all services in background
docker compose up db localstack -d  # Start only infrastructure (for local dev)
docker compose down                 # Stop and remove containers
docker compose logs -f              # View logs (all services)
docker compose logs -f discovery-server  # View logs (specific service)
docker compose ps                   # Show running services
docker compose exec discovery-server sh  # Shell into container
```

### Docker Build & Run
```bash
docker build -t discovery-server:latest .  # Build production image
docker run -p 3000:3000 --env-file .env discovery-server:latest  # Run container
```

