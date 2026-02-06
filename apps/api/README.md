# AMCore API

> Production-ready NestJS backend with modular architecture, comprehensive error handling, and GDPR-compliant logging.

## Architecture

### Tech Stack

| Component       | Technology           | Purpose                                   |
| --------------- | -------------------- | ----------------------------------------- |
| **Framework**   | NestJS 10            | Modular monolith architecture             |
| **Database**    | PostgreSQL 16        | Primary data store with schema separation |
| **ORM**         | Prisma 7             | Type-safe database access                 |
| **Cache/Queue** | Redis + BullMQ       | Session storage, caching, background jobs |
| **Validation**  | Zod + nestjs-zod     | Request/response validation               |
| **Auth**        | JWT + Refresh Tokens | Stateless authentication                  |
| **Logging**     | Pino (nestjs-pino)   | Structured JSON logging                   |
| **API Docs**    | Swagger (OpenAPI)    | Auto-generated from code                  |

### Module Structure

```
apps/api/src/
├── core/                    # Core infrastructure
│   ├── auth/               # Authentication & authorization
│   └── users/              # User management (future)
├── fitness/                # Fitness module (Phase 1)
├── finance/                # Finance module (Phase 2)
├── subscriptions/          # Subscriptions module (Phase 3)
├── common/                 # Shared utilities
│   ├── exceptions/         # Exception filters & domain exceptions
│   │   ├── filters/        # AllExceptionsFilter, PrismaExceptionFilter, HttpExceptionFilter
│   │   └── domain/         # AppException, NotFoundException, BusinessRuleException
│   └── utils/              # Utilities (IP anonymization, etc.)
├── env/                    # Environment validation (Zod)
├── health/                 # Health check endpoints
├── prisma/                 # Prisma service
└── app.module.ts           # Root module
```

### Database Schemas

PostgreSQL uses schema separation for module isolation:

| Schema          | Module        | Tables                            |
| --------------- | ------------- | --------------------------------- |
| `core`          | Auth, Users   | users, sessions, settings         |
| `fitness`       | Fitness       | exercises, workouts, measurements |
| `finance`       | Finance       | wallets, transactions (future)    |
| `subscriptions` | Subscriptions | services, subscriptions (future)  |

**Cross-module communication:** Via events (Redis pub/sub), NOT direct imports.

## Error Handling

### Exception Filter Hierarchy

The API uses a hierarchical exception filter system for consistent error responses:

```
┌─────────────────────────────────────────┐
│  AllExceptionsFilter                    │  ← Catch-all (last resort)
│  Handles: Everything                    │
│  Returns: Generic 500 or formatted      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  PrismaClientExceptionFilter            │  ← Database errors
│  Handles: PrismaClientKnownRequestError │
│  Maps: P2002→409, P2025→404, etc.      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  HttpExceptionFilter                    │  ← NestJS built-in exceptions
│  Handles: HttpException (400, 401, etc) │
│  Logs: Client errors (warn level)       │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Domain Exceptions                      │  ← Business logic errors
│  - NotFoundException                    │
│  - BusinessRuleException                │
│  - ConflictException                    │
└─────────────────────────────────────────┘
```

### Error Response Format

**Development:**

```json
{
  "statusCode": 404,
  "message": "Workout not found",
  "errorCode": "WORKOUT_NOT_FOUND",
  "timestamp": "2026-02-06T12:30:00.000Z",
  "path": "/api/v1/fitness/workouts/123",
  "method": "GET",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "stack": "Error: Workout not found\n    at WorkoutService.findOne..."
}
```

**Production:**

```json
{
  "statusCode": 404,
  "message": "Workout not found",
  "errorCode": "WORKOUT_NOT_FOUND",
  "timestamp": "2026-02-06T12:30:00.000Z",
  "path": "/api/v1/fitness/workouts/123",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Prisma Error Mapping

| Prisma Code | HTTP Status     | Meaning                       |
| ----------- | --------------- | ----------------------------- |
| P2000       | 400 BAD_REQUEST | Value too long for column     |
| P2002       | 409 CONFLICT    | Unique constraint violation   |
| P2025       | 404 NOT_FOUND   | Record not found              |
| P2003       | 400 BAD_REQUEST | Foreign key constraint failed |

## Logging System

### Structured Logging with Pino

Every log entry includes:

- `correlationId` — Request tracking across services
- `userId` — Auto-injected from JWT (if authenticated)
- `ip` — Anonymized for GDPR compliance
- `userAgent` — For debugging/analytics
- `timestamp` — ISO 8601 format
- `level` — info, warn, error, debug, trace

### Correlation ID Strategy

**Sources (priority order):**

1. `X-Request-ID` — From load balancer (Nginx)
2. `X-Correlation-ID` — From upstream service
3. Generated UUID v4 — If first entry point

**Propagation:**

- HTTP headers → CLS (nestjs-cls) → Logs
- Automatically added to all logs and error responses
- No manual parameter passing needed

### GDPR Compliance

**IP Anonymization:**

- IPv4: `192.168.1.100` → `192.168.0.0` (keeps first 2 octets)
- IPv6: `2001:0db8:85a3::7334` → `2001::` (keeps first segment)

**Sensitive Data Redaction:**

- Passwords, tokens, API keys automatically redacted in logs
- Authorization headers filtered out
- Credit card data never logged

### Log Levels by Environment

| Environment | Level    | Output  | Format                              |
| ----------- | -------- | ------- | ----------------------------------- |
| Development | `debug`  | Console | pino-pretty (colorized)             |
| Test        | `silent` | None    | N/A                                 |
| Production  | `info`   | JSON    | Structured (ready for Graylog/Loki) |

## Authentication

### JWT + Refresh Token Strategy

- Access tokens: 15 minutes (short-lived, stateless)
- Refresh tokens: 7 days (stored in Redis, revocable)
- Password hashing: Argon2id (OWASP recommended)

### Endpoints

| Method | Endpoint                    | Description                             |
| ------ | --------------------------- | --------------------------------------- |
| POST   | `/api/v1/auth/register`     | User registration                       |
| POST   | `/api/v1/auth/login`        | Login (returns access + refresh tokens) |
| POST   | `/api/v1/auth/refresh`      | Refresh access token                    |
| POST   | `/api/v1/auth/logout`       | Logout (revoke refresh token)           |
| POST   | `/api/v1/auth/logout-all`   | Logout from all devices                 |
| GET    | `/api/v1/auth/sessions`     | List active sessions                    |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke specific session                 |
| GET    | `/api/v1/auth/me`           | Get current user profile                |

**Planned:** Google OAuth integration

## API Documentation

### Swagger UI

Interactive API documentation available at:

- **Development:** `http://localhost:3001/api/docs`
- **Production:** `https://api.amcore.alex-morozov.com/api/docs`

Auto-generated from:

- Zod schemas (via `@nestjs/swagger` integration)
- Controller decorators (`@ApiOperation`, `@ApiResponse`)
- DTO classes (via `createZodDto` from `nestjs-zod`)

## Health Checks

Powered by [@nestjs/terminus](https://github.com/nestjs/terminus) with custom health indicators.

### Endpoints

| Endpoint        | Purpose                      | Checks                                      | Status Codes |
| --------------- | ---------------------------- | ------------------------------------------- | ------------ |
| `/health`       | General health check         | Database, Redis, Disk (90%), Memory (300MB) | 200 / 503    |
| `/health/ready` | Readiness probe (Kubernetes) | Database, Redis (external dependencies)     | 200 / 503    |
| `/health/live`  | Liveness probe (Kubernetes)  | Memory heap (500MB threshold)               | 200 / 503    |

### Response Format

**Healthy (200 OK):**

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "disk": { "status": "up" },
    "memory_heap": { "status": "up" }
  }
}
```

**Unhealthy (503 Service Unavailable):**

```json
{
  "status": "error",
  "error": {
    "database": { "status": "down", "message": "Connection refused" }
  }
}
```

### Custom Health Indicators

- **PrismaHealthIndicator** — PostgreSQL connectivity (`SELECT 1`)
- **RedisHealthIndicator** — Redis connectivity (set/get test value)

Built-in indicators: DiskHealthIndicator, MemoryHealthIndicator, HttpHealthIndicator

### Use Cases

- **Load Balancer:** Routes traffic only to healthy nodes
- **Kubernetes:** Readiness/liveness probes for automatic recovery
- **Monitoring:** Prometheus/Grafana scraping for alerts
- **CI/CD:** Verify deployment success before switching traffic

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL, Redis)

### Setup

```bash
# Install dependencies (from root)
pnpm install

# Start infrastructure
docker compose up -d

# Copy environment variables
cp .env.example .env

# Run migrations
pnpm --filter api db:migrate

# Start development server
pnpm --filter api dev
```

### Useful Commands

| Command           | Description                      |
| ----------------- | -------------------------------- |
| `pnpm dev`        | Start dev server with hot reload |
| `pnpm build`      | Build for production             |
| `pnpm test`       | Run unit tests                   |
| `pnpm test:watch` | Run tests in watch mode          |
| `pnpm test:cov`   | Run tests with coverage          |
| `pnpm lint`       | Run ESLint                       |
| `pnpm typecheck`  | TypeScript type checking         |
| `pnpm db:migrate` | Run Prisma migrations            |
| `pnpm db:seed`    | Seed database                    |
| `pnpm db:studio`  | Open Prisma Studio               |

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/amcore

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Server
API_PORT=3001
NODE_ENV=development

# CORS
CORS_ORIGIN=http://localhost:3000
```

See `.env.example` for full list.

## Testing

### Test Structure

```
src/
├── core/auth/
│   ├── auth.service.spec.ts      # Unit tests
│   ├── auth.controller.spec.ts
│   └── auth.integration.spec.ts  # Integration tests
└── common/exceptions/
    └── filters/
        ├── http-exception.filter.spec.ts
        └── prisma-exception.filter.spec.ts
```

### Coverage

- Exception filters: 100%
- IP anonymization utility: 100%
- Auth module: ~80% (in progress)

**Target:** 80% coverage for business logic

## Deployment

### Docker

```bash
# Build image
docker build -t amcore-api .

# Run container
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  -e JWT_SECRET=... \
  amcore-api
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS with actual frontend domain
- [ ] Set strong `JWT_SECRET`
- [ ] Enable HTTPS
- [ ] Configure log aggregation (Graylog/Loki)
- [ ] Set up error monitoring (Sentry)
- [ ] Configure log rotation
- [ ] Set up database backups
- [ ] Enable Redis persistence

## Performance

### Optimizations

- **Caching:** Redis-based caching for frequently accessed data
- **Connection pooling:** Prisma connection pool (default 10 connections)
- **Rate limiting:** Throttler guard (10 req/sec, 100 req/min)
- **Compression:** Response compression middleware
- **Logging:** Pino (fastest Node.js logger, ~5x faster than Winston)

### Multi-Node Deployment

The API is designed for horizontal scaling:

- ✅ Stateless (sessions in Redis, not memory)
- ✅ Correlation ID propagation
- ✅ Shared cache (Redis)
- ✅ Background job queue (BullMQ on Redis)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for:

- Commit message conventions
- PR checklist
- Code style guidelines

## License

[MIT](../../LICENSE)
