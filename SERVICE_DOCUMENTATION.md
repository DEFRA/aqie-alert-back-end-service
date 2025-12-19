# AQIE Alert Back-End Service

## Overview

The AQIE (Air Quality Information Exchange) Alert Back-End Service is a Node.js microservice that manages air quality alert subscriptions for users. It allows users to set up location-based alerts via SMS or email notifications when air quality conditions change in their specified areas.

## Service Purpose

- **User Alert Management**: Register users for air quality alerts at specific geographic locations
- **Multi-Channel Notifications**: Support both SMS and email alert delivery
- **Location Tracking**: Store and manage multiple locations per user with geographic coordinates
- **Notification Integration**: Integrate with external notification services for alert delivery

## Architecture

- **Framework**: Hapi.js (Node.js)
- **Database**: MongoDB with geographic indexing
- **Authentication**: None (public API)
- **Logging**: Structured logging with Pino
- **Testing**: Vitest with MongoDB Memory Server

## API Endpoints

### Health Check

```
GET /health
```

**Description**: Service health check endpoint
**Response**:

```json
{
  "message": "success"
}
```

### Setup Alert

```
POST /setup-alert
```

**Description**: Register a user for air quality alerts at a specific location

**Request Body**:

```json
{
  "phoneNumber": "07123456789", // Required for SMS alerts
  "emailAddress": "user@email.com", // Required for email alerts
  "alertType": "sms", // Required: "sms" or "email"
  "location": "London, UK", // Required: Human-readable location
  "lat": 51.5074, // Required: Latitude coordinate
  "long": -0.1278 // Required: Longitude coordinate
}
```

**Validation Rules**:

- `alertType`: Must be either "sms" or "email"
- `phoneNumber`: Required when alertType is "sms"
- `emailAddress`: Required when alertType is "email"
- `location`, `lat`, `long`: All required fields
- Duplicate location detection prevents multiple alerts for same coordinates

**Success Response** (201):

```json
{
  "message": "Alert setup successful",
  "userId": "507f1f77bcf86cd799439011"
}
```

**Error Responses**:

- `400 Bad Request`: Invalid payload or missing required fields
- `409 Conflict`: Alert already exists for this location
- `502 Bad Gateway`: Notification service unavailable
- `500 Internal Server Error`: Database or system error

### Example Endpoints (Template - Remove as needed)

```
GET /example
GET /example/{exampleId}
```

## Data Models

### User Document

```javascript
{
  _id: ObjectId,
  user_contact: String,        // Phone number or email address
  alertType: String,           // "sms" or "email"
  createdAt: Date,
  requestId: String,
  locations: [
    {
      location: String,        // Human-readable location name
      coordinates: [Number],   // [longitude, latitude] in GeoJSON format
      createdAt: Date
    }
  ]
}
```

## Configuration

### Environment Variables

| Variable                                | Description                       | Default                                 | Required |
| --------------------------------------- | --------------------------------- | --------------------------------------- | -------- |
| `NODE_ENV`                              | Environment mode                  | development                             | No       |
| `PORT`                                  | Server port                       | 3001                                    | No       |
| `HOST`                                  | Server host                       | 0.0.0.0                                 | No       |
| `MONGO_URI`                             | MongoDB connection string         | mongodb://127.0.0.1:27017/              | No       |
| `MONGO_DATABASE`                        | MongoDB database name             | aqie-alert-back-end-service             | No       |
| `NOTIFICATION_SERVICE_URL`              | External notification service URL | http://localhost:3000/send-notification | No       |
| `SMS_SET_UP_CONFIRMATION_TEMPLATE_ID`   | SMS template ID                   | 73244097-acce-4e7b-84f2-3ddcd0e70fb5    | No       |
| `EMAIL_SET_UP_CONFIRMATION_TEMPLATE_ID` | Email template ID                 | email-template-id                       | No       |
| `LOG_LEVEL`                             | Logging level                     | info                                    | No       |
| `HTTP_PROXY`                            | HTTP proxy URL                    | null                                    | No       |

## Features

### Security & Privacy

- **Data Masking**: Phone numbers and email addresses are masked in logs
- **Request Tracking**: Each request gets a unique ID for traceability
- **Input Validation**: Comprehensive payload validation with detailed error messages

### Database Operations

- **Upsert Operations**: Creates new users or updates existing ones
- **Duplicate Prevention**: Prevents duplicate alerts for same location coordinates
- **Transaction Safety**: Rollback mechanism if notification fails
- **Geographic Indexing**: Supports location-based queries with GeoJSON format

### Monitoring & Observability

- **Structured Logging**: JSON-formatted logs with request correlation
- **Performance Metrics**: Database and notification service timing
- **Error Tracking**: Comprehensive error logging with stack traces
- **Health Monitoring**: Built-in health check endpoint

### Integration

- **Notification Service**: Calls external service for SMS/email delivery
- **Proxy Support**: HTTP proxy configuration for network restrictions
- **Rollback Mechanism**: Automatic cleanup if notification delivery fails

## Development

### Local Setup

```bash
npm install
npm run dev
```

### Testing

```bash
npm test           # Run all tests with coverage
npm run test:watch # Watch mode for development
```

### Docker

```bash
# Development
docker build --target development --tag aqie-alert-service:dev .
docker run -p 3001:3001 aqie-alert-service:dev

# Production
docker build --tag aqie-alert-service .
docker run -p 3001:3001 aqie-alert-service
```

## Dependencies

### Core Dependencies

- `@hapi/hapi`: Web framework
- `mongodb`: Database driver
- `mongoose`: ODM for MongoDB
- `joi`: Schema validation
- `convict`: Configuration management
- `pino`: Structured logging
- `undici`: HTTP client for notifications

### Development Dependencies

- `vitest`: Testing framework
- `mongodb-memory-server`: In-memory MongoDB for testing
- `eslint`: Code linting
- `prettier`: Code formatting

## Error Handling

The service implements comprehensive error handling:

1. **Validation Errors**: Detailed field-level validation with specific error messages
2. **Database Errors**: Proper handling of connection issues and constraint violations
3. **External Service Errors**: Graceful handling of notification service failures
4. **Rollback Operations**: Automatic cleanup when operations fail partway through
5. **Logging**: All errors are logged with context and correlation IDs

## Performance Considerations

- **Database Indexing**: Geographic and user contact indexes for fast queries
- **Connection Pooling**: MongoDB connection pooling for scalability
- **Timeout Management**: Configurable timeouts for external service calls
- **Memory Management**: Efficient data structures and cleanup

## Deployment

The service is designed for containerized deployment with:

- Health check endpoints for load balancer integration
- Graceful shutdown handling
- Environment-based configuration
- Proxy support for corporate networks
- Comprehensive logging for monitoring systems
