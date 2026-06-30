# HustleOps n8n Community Node

This package provides an n8n community node for HustleOps incident response workflows.

The current package supports live HustleOps API requests for core alert, incident, observable, knowledge, comment, tag, and custom field operations.

## Supported Resources And Operations

| Resource     | Operations                                                                                                                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alert        | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                 |
| Incident     | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                 |
| Observable   | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                 |
| Knowledge    | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                 |
| Comment      | List, Search, Get Unread Count, Create, Mark Read, Update, Delete, Toggle Reaction, Toggle Pin                                                                                                                                                                                                     |
| Tag          | List, Search, Create, Update Color, Bulk Update Color, Delete, Bulk Delete                                                                                                                                                                                                                         |
| Custom Field | List Groups, Create Group, Update Group, Delete Group, List Definitions, Search Definitions, Create Definition, Update Definition, Bulk Update Definitions, Delete Definition, Bulk Delete Definitions, Get Values, Get Available, Batch Get Values, Replace Values, Update Selected Values Safely |

Search operations call HustleOps `/search` endpoints with a JSON Search Body. Core search paths are `/alerts/search`, `/incidents/search`, `/observables/search`, and `/knowledge/search`. Enable `Return All` to fetch pages until the API response reaches `totalPages`, `Max Items`, or `Max Pages`.

Create and Update operations expose common DTO fields directly in the node. Required create fields appear as normal n8n fields. Optional create fields are available under `Additional Fields`, and update payload fields are available under `Fields to Update`.

Use `Additional JSON` only for advanced supported fields or intentional overrides. `Additional JSON` is merged after structured fields, so duplicate keys in `Additional JSON` win. Unsupported fields still fail before the API request is sent.

Workflows saved with the old `Body` field continue to run through a hidden legacy fallback when no structured fields or `Additional JSON` values are set. New workflows should use structured fields and `Additional JSON`.

## Tag Operations

Core resources expose `Set Tags`, `Add Tags`, and `Remove Tag` operations directly under Alert, Incident, Observable, and Knowledge.

- `Set Tags`: calls `PUT /<resource>/:id/tags` with `{ "values": [...] }`. An empty array clears all tags.
- `Add Tags`: calls `POST /<resource>/:id/tags` and requires at least one value.
- `Remove Tag`: calls `DELETE /<resource>/:id/tags/:tagId`.

Tag values are validated before the API request is sent: at most 20 tags per entity, at most 30 characters per tag, and only letters, numbers, spaces, and `* ! @ # $ : . - _ =`.

The `Tag` resource covers admin tag management:

- `List`: calls `GET /tags`, with optional `withCounts=true` for admin-only counts.
- `Search`: calls `POST /tags/search` with a SearchRequest body.
- `Create`: calls `POST /tags` with `{ "value": "vip", "color": "#0EA5E9" }`.
- `Update Color`: calls `PATCH /tags/:id` with `{ "color": "#A855F7" }`. Tag values are immutable.
- `Bulk Update Color`: calls `PATCH /tags/bulk` with `{ "ids": [...], "color": "#22C55E" }`.
- `Delete`: calls `DELETE /tags/:id?force=true` when Force is enabled.
- `Bulk Delete`: calls `POST /tags/bulk-delete` with `{ "ids": [...], "force": true }`.

## Custom Field Operations

The `Custom Field` resource covers custom field groups, definitions, and values.

Group operations call `/custom-fields/groups`. Definition operations call `/custom-fields/definitions`, `/custom-fields/definitions/search`, `/custom-fields/definitions/bulk`, and `/custom-fields/definitions/bulk-delete`. Definition update rejects `fieldType` because field type is immutable.

Value operations use uppercase entity types: `ALERT`, `INCIDENT`, `OBSERVABLE`, and `KNOWLEDGE`.

- `Get Values`: calls `GET /custom-fields/values/:entityType/:entityId`.
- `Get Available`: calls `GET /custom-fields/available/:entityType/:entityId`.
- `Batch Get Values`: calls `POST /custom-fields/values/batch` with `{ "entityType": "ALERT", "entityIds": [...] }` and allows up to 100 IDs.
- `Replace Values`: calls `PATCH /custom-fields/values/:entityType/:entityId` with the exact attached field set to keep.
- `Update Selected Values Safely`: first reads existing values, merges selected field changes, then patches the complete attached field set so omitted attached fields are preserved.

Custom field values sent to the API are strings or `null`. `MULTI_SELECT` array inputs are serialized with `JSON.stringify`, so `["a", "b"]` is sent as `"[\"a\",\"b\"]"`. BOOLEAN values must be `"true"` or `"false"`; NUMBER, DATE, and URL values are validated before sending.

## Getting an API Key

API keys must be created outside n8n by a HustleOps administrator or another user with access to API-key management.

The n8n node does not create, rotate, or revoke HustleOps API keys.

The API key owner needs the HustleOps permissions required by the operation being run, such as view permission for Search/Get and create or update permission for write operations.

## Authentication

Create a `HustleOps API` credential in n8n with:

- `Base URL`: the full HTTPS URL of your HustleOps instance. Use HTTP only for local development on `localhost`, `127.0.0.1`, or `::1`.
- `API Key`: your HustleOps API key.
- `Ignore SSL Issues`: disabled by default. Enable only for local or private test instances that use a self-signed certificate. For production, install a trusted certificate or add the issuing CA to the n8n/Node trust store.

Requests send:

```text
x-api-key: ho_sk_...
Accept: application/json
Content-Type: application/json
```

API keys act as the user who owns the key, so role and permission checks still apply.

## Create Examples

Set these values through node fields rather than a generic Body editor. The JSON below shows the API payload produced from the structured fields.

Alert field values:

| n8n field     | Value                      |
| ------------- | -------------------------- |
| `Name`        | `Suspicious login`         |
| `Description` | `Okta anomaly`             |
| `Severity`    | `HIGH`                     |
| `TLP`         | `AMBER`                    |
| `Source`      | `okta`                     |
| `Type`        | `identity`                 |
| `Source Ref`  | `evt_12345`                |
| `Detected At` | `2026-06-28T12:00:00.000Z` |

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

Incident field values:

| n8n field     | Value                                               |
| ------------- | --------------------------------------------------- |
| `Name`        | `Credential theft investigation`                    |
| `Description` | `Coordinated response for suspicious Okta activity` |
| `Severity`    | `HIGH`                                              |
| `TLP`         | `AMBER`                                             |
| `Category`    | `identity`                                          |

```json
{
	"name": "Credential theft investigation",
	"description": "Coordinated response for suspicious Okta activity",
	"severity": "HIGH",
	"tlp": "AMBER",
	"category": "identity"
}
```

Observable field values:

| n8n field      | Value                      |
| -------------- | -------------------------- |
| `Value`        | `198.51.100.10`            |
| `Type`         | `ip`                       |
| `Threat Level` | `SUSPICIOUS`               |
| `TLP`          | `AMBER`                    |
| `First Seen`   | `2026-06-28T11:30:00.000Z` |
| `Last Seen`    | `2026-06-28T12:00:00.000Z` |

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

Knowledge field values:

| n8n field     | Value                                      |
| ------------- | ------------------------------------------ |
| `Value`       | `Containment runbook`                      |
| `Type`        | `runbook`                                  |
| `TLP`         | `AMBER`                                    |
| `Description` | `Steps for disabling compromised accounts` |

```json
{
	"value": "Containment runbook",
	"type": "runbook",
	"tlp": "AMBER",
	"description": "Steps for disabling compromised accounts"
}
```

## Update Fields

Update operations keep `ID` as a required field and put editable payload values under `Fields to Update`.

For example, updating an Observable can set `Threat Level`, `Criticality`, and `Version` under `Fields to Update`. If `Additional JSON` also contains `criticality`, the value from `Additional JSON` is sent.

To clear a supported nullable field, set it to `null` in `Additional JSON`, such as `{ "summary": null }`. Blank structured update fields are omitted.

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

Admin-only resources such as webhooks, users, teams, roles, and system settings are not included.

The package is still private and is not published to npm.
