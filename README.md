# HustleOps n8n Community Node

This package provides an n8n community node for HustleOps incident response workflows.

The current package supports live HustleOps API requests for core alert, incident, observable, and knowledge operations.

## Supported Resources And Operations

| Resource | Operations |
| --- | --- |
| Alert | Search, Count, Get, Create, Update |
| Incident | Search, Count, Get, Create, Update |
| Observable | Search, Count, Get, Create, Update |
| Knowledge | Search, Count, Get, Create, Update |

Search operations call HustleOps `/search` endpoints with a JSON Search Body. Enable `Return All` to fetch pages until the API response reaches `totalPages`, `Max Items`, or `Max Pages`.

Create and Update operations accept JSON bodies. Unsupported fields fail before a request is sent because the HustleOps API rejects unknown DTO fields.

## Getting an API Key

API keys must be created outside n8n by a HustleOps administrator or another user with access to API-key management.

The n8n node does not create, rotate, or revoke HustleOps API keys.

The API key owner needs the HustleOps permissions required by the operation being run, such as view permission for Search/Get and create or update permission for write operations.

## Authentication

Create a `HustleOps API` credential in n8n with:

- `Base URL`: the full HTTPS URL of your HustleOps instance. Use HTTP only for local development on `localhost`, `127.0.0.1`, or `::1`.
- `API Key`: your HustleOps API key.

Requests send:

```text
x-api-key: ho_sk_...
Accept: application/json
Content-Type: application/json
```

API keys act as the user who owns the key, so role and permission checks still apply.

## Create Examples

Alert:

```json
{
  "name": "Suspicious login",
  "description": "Okta anomaly",
  "severity": "HIGH",
  "tlp": "AMBER",
  "source": "okta",
  "type": "identity",
  "sourceRef": "evt_12345",
  "detectedAt": "2026-06-28T12:00:00.000Z"
}
```

Incident:

```json
{
  "name": "Credential theft investigation",
  "description": "Coordinated response for suspicious Okta activity",
  "severity": "HIGH",
  "tlp": "AMBER",
  "category": "identity"
}
```

Observable:

```json
{
  "value": "198.51.100.10",
  "type": "ip",
  "threatLevel": "SUSPICIOUS",
  "tlp": "AMBER",
  "firstSeen": "2026-06-28T11:30:00.000Z",
  "lastSeen": "2026-06-28T12:00:00.000Z"
}
```

Knowledge:

```json
{
  "value": "Containment runbook",
  "type": "runbook",
  "tlp": "AMBER",
  "description": "Steps for disabling compromised accounts"
}
```

## Search Pagination

By default, Search returns one output item per row in the API response `data` array.

Enable `Include Pagination Metadata` to return the raw page object with `data`, `total`, `page`, `pageSize`, and `totalPages`.

Enable `Return All` to fetch multiple pages. `Max Items` and `Max Pages` bound the request so large result sets do not run indefinitely.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run unit tests without rebuilding:

```bash
npm run test:unit
```

Run lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```

Start a local n8n development instance with this node loaded:

```bash
npm run dev
```

## Limitations

Comments and attachments are not included in this implementation slice.

Admin-only resources such as webhooks, users, teams, roles, system settings, and custom-field definitions are not included.

The package is still private and is not published to npm.
