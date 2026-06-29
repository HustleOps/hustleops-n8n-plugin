# HustleOps n8n Community Node

This package provides an n8n community node for HustleOps incident response workflows.

The current package supports live HustleOps API requests for core alert, incident, observable, knowledge, and comment operations.

## Supported Resources And Operations

| Resource   | Operations                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Alert      | Search, Count, Get, Create, Update                                                             |
| Incident   | Search, Count, Get, Create, Update                                                             |
| Observable | Search, Count, Get, Create, Update                                                             |
| Knowledge  | Search, Count, Get, Create, Update                                                             |
| Comment    | List, Search, Get Unread Count, Create, Mark Read, Update, Delete, Toggle Reaction, Toggle Pin |

Search operations call HustleOps `/search` endpoints with a JSON Search Body. Core search paths are `/alerts/search`, `/incidents/search`, `/observables/search`, and `/knowledge/search`. Enable `Return All` to fetch pages until the API response reaches `totalPages`, `Max Items`, or `Max Pages`.

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

## Comment Operations

Comment operations work against comment threads attached to core entities. Choose `Comment` as the resource, then choose one of:

- `List`: calls `GET /comments` with `entityType`, `entityId`, optional `cursor`, and `take`.
- `Search`: calls `GET /comments/search` with `entityType`, `entityId`, and `q`.
- `Get Unread Count`: calls `GET /comments/unread-count` and returns `{ "unreadCount": number }`.
- `Create`: calls `POST /comments` with a JSON Comment Body.
- `Mark Read`: calls `POST /comments/read` with `entityType` and `entityId`.
- `Update`: calls `PATCH /comments/:id` with `{ "content": "Updated containment note" }`.
- `Delete`: calls `DELETE /comments/:id`.
- `Toggle Reaction`: calls `POST /comments/:id/reactions` with `{ "emoji": "\u2705" }`.
- `Toggle Pin`: calls `PATCH /comments/:id/pin`.

Comment `entityType` must be one of `ALERT`, `INCIDENT`, `OBSERVABLE`, or `KNOWLEDGE`.

List uses cursor pagination. `Take` defaults to `50` and must be between `1` and `100`. Enable `Include Cursor Metadata` to return the raw response containing `items` and `nextCursor` instead of one output item per comment.

Search emits one item per comment and caps emitted rows with `Max Results`, which defaults to `100`.

### n8n Fields and Outputs

| Operation        | Required n8n fields                        | Optional n8n fields                             | Output                                                                                                                        |
| ---------------- | ------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| List             | `Entity Type`, `Entity ID`                 | `Take`, `Cursor`, `Include Cursor Metadata`     | One item per comment, or one raw response item with `items` and `nextCursor` when cursor metadata is enabled                  |
| Search           | `Entity Type`, `Entity ID`, `Search Query` | `Max Results`                                   | One item per matching comment, up to `Max Results`                                                                            |
| Get Unread Count | `Entity Type`, `Entity ID`                 | none                                            | `{ "unreadCount": number }`                                                                                                   |
| Create           | `Entity Type`, `Entity ID`, `Comment Body` | `parentId`, `attachmentIds` inside Comment Body | Created comment plus `autoTransitioned`                                                                                       |
| Mark Read        | `Entity Type`, `Entity ID`                 | none                                            | `{ "success": true, "entityType": "INCIDENT", "entityId": "11111111-1111-4111-8111-111111111111" }`                           |
| Update           | `Comment ID`, `Comment Body`               | none                                            | Updated comment                                                                                                               |
| Delete           | `Comment ID`                               | none                                            | `{ "id": "22222222-2222-4222-8222-222222222222", "entityType": "ALERT", "entityId": "11111111-1111-4111-8111-111111111111" }` |
| Toggle Reaction  | `Comment ID`, `Comment Body`               | none                                            | Updated comment                                                                                                               |
| Toggle Pin       | `Comment ID`                               | none                                            | Updated comment                                                                                                               |

### Comment Body Examples

Create comment. Set `Entity Type` and `Entity ID` in the node fields; put only create-body fields in `Comment Body`:

```json
{
	"content": "Containment started"
}
```

Create reply. Set `Entity Type` and `Entity ID` in the node fields:

```json
{
	"content": "Adding timeline details",
	"parentId": "22222222-2222-4222-8222-222222222222"
}
```

Create comment with staged attachments. Set `Entity Type` and `Entity ID` in the node fields:

```json
{
	"attachmentIds": ["33333333-3333-4333-8333-333333333333"]
}
```

Update comment:

```json
{
	"content": "Updated containment note"
}
```

Toggle reaction:

```json
{
	"emoji": "\u2705"
}
```

### Comment Permissions

API keys inherit the permissions of the key owner.

| Operation                                 | Required permission |
| ----------------------------------------- | ------------------- |
| List, Search, Get Unread Count, Mark Read | `COMMENTS:VIEW`     |
| Create, Toggle Reaction                   | `COMMENTS:CREATE`   |
| Update, Toggle Pin                        | `COMMENTS:UPDATE`   |
| Delete                                    | `COMMENTS:DELETE`   |

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

Attachment upload and download are not included in this implementation slice. Comment create can reference up to three staged attachment IDs when another workflow has already uploaded those files.

Admin-only resources such as webhooks, users, teams, roles, system settings, and custom-field definitions are not included.

The package is still private and is not published to npm.
