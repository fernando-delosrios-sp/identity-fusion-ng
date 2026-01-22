# Proxy Mode Setup Guide

## Overview
Proxy mode allows an internal connector (deployed in ISC) to delegate processing to an external connector instance that has access to protected resources. **The same connector codebase is used for both**, just configured differently.

## Architecture

```
ISC → Internal Connector (proxy client) → External Connector (proxy server) → Target System
     [proxyEnabled: true]                 [proxyEnabled: true]
     [proxyUrl: http://...]               [PROXY_PASSWORD env var]
```

## How It Works

The same connector code automatically detects its role:

- **Proxy Client Mode**: Has `proxyEnabled: true` AND `proxyUrl` configured
  - Forwards all operations to the external connector via HTTP
  - Does not process operations locally
  
- **Proxy Server Mode**: Has `proxyEnabled: true` AND `PROXY_PASSWORD` environment variable set
  - Automatically starts an HTTP server on startup
  - Receives and processes operations from the internal connector
  - Has access to the target system

## Setup Instructions

### 1. External Connector Setup (Proxy Server)

Deploy the same connector with these settings:

1. **Build the connector**:
   ```bash
   npm run build
   ```

2. **Set environment variable**:
   ```bash
   export PROXY_PASSWORD=your-secret-password
   ```

3. **Configure the connector**:
   ```json
   {
     "proxyEnabled": true,
     // ... other config for accessing your target system ...
   }
   ```
   
   Note: Do NOT set `proxyUrl` on the external connector!

4. **Start the connector**:
   ```bash
   # The connector will automatically start an HTTP server
   npm start
   # or
   PROXY_PORT=3000 npm start
   ```

5. The HTTP server will start automatically and listen on:
   - Port: 3000 (default) or `PROXY_PORT` environment variable
   - Endpoints:
     - `POST /proxy` - Receives proxy requests
     - `POST /` - Also accepts proxy requests
     - `GET /health` - Health check

### 2. Internal Connector Setup (Proxy Client)

1. Configure the ISC source with these parameters:
   ```json
   {
     "proxyEnabled": true,
     "proxyUrl": "http://your-external-connector:3000/proxy",
     "proxyPassword": "your-secret-password"
   }
   ```

2. Set environment variable on the internal connector:
   ```bash
   PROXY_PASSWORD=your-secret-password
   ```

### 3. Configuration Parameters

#### ISC Source Configuration
- `proxyEnabled` (boolean): Enable proxy mode
- `proxyUrl` (string): URL of the external connector's proxy endpoint
- `proxyPassword` (string): Password for authentication

#### Environment Variables
- `PROXY_PASSWORD`: Must be set on internal connector to match `proxyPassword` in config

## How It Works

1. ISC calls the internal connector with a command (e.g., account list)
2. Internal connector detects proxy mode is enabled
3. Internal connector POSTs to external connector's proxy URL with:
   ```json
   {
     "type": "std:account:list",
     "input": { /* command input */ },
     "config": { /* config with proxyEnabled: false */ }
   }
   ```
4. External connector processes the request and returns results as NDJSON
5. Internal connector forwards the results back to ISC

## Troubleshooting

### Infinite Loop
If you see repeated proxy calls, ensure:
- The config sent to external connector has `proxyEnabled: false` (fixed in code)
- External connector is not also configured in proxy mode

### Schema Validation Errors
If ISC reports schema validation errors:
- Check that external connector is returning valid account objects with required fields:
  - `identity` (string)
  - `uuid` (string)
  - `attributes` (object, not null)
- Enable debug logging to see what's being received:
  ```bash
  # Check connector logs for proxy debug messages
  ```

### Connection Errors
- Ensure external connector's proxy server is running and accessible
- Check firewall rules allow traffic between internal and external connectors
- Verify `proxyUrl` is correct

## Response Format

External connector must return data in one of these formats:

### NDJSON (Preferred)
```
{"identity":"user1","uuid":"123","attributes":{"name":"User 1"}}
{"identity":"user2","uuid":"456","attributes":{"name":"User 2"}}
```

### JSON Array
```json
[
  {"identity":"user1","uuid":"123","attributes":{"name":"User 1"}},
  {"identity":"user2","uuid":"456","attributes":{"name":"User 2"}}
]
```

## Security Considerations

1. Use HTTPS for `proxyUrl` in production
2. Keep `PROXY_PASSWORD` secure and rotate regularly
3. Consider additional authentication mechanisms (e.g., API keys, mTLS)
4. Ensure external connector has proper network isolation
