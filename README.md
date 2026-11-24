# HustleOps n8n Community Node

Use this community node to read and update HustleOps incident response records in n8n.

| Resource                               | Operations                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alert, Incident, Observable, Knowledge | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                                                                      |
| Tag                                    | List, Search, Create, Update Color, Bulk Update Color, Get Deletion Impact, Delete, Bulk Delete                                                                                                                                                                                                                                                         |
| Custom Field                           | List Groups, Create Group, Update Group, Get Group Dependencies, Delete Group, List Definitions, Search Definitions, Create Definition, Update Definition, Bulk Update Definitions, Get Definition Dependencies, Delete Definition, Bulk Delete Definitions, Get Values, Get Available, Batch Get Values, Replace Values, Update Selected Values Safely |

## Authentication

Create a **HustleOps API** credential in n8n and enter the **Base URL**, **Organization ID** and **API Key**. The organization ID is the UUID of the organization the key can access. Create the key in HustleOps with the permissions needed by the workflow. Use HTTPS for deployed instances. HTTP is supported for local development on `localhost`, `127.0.0.1` and `::1`.

The node sends `x-api-key` and `X-Organization-Id` on scoped requests. The credential check uses the operational tag catalog, so testing the connection requires no tag administration grant.

## Search and count

Core Search sends `POST /<resource>/search`. Tag Search and Custom Field Search Definitions use the `GET /tags` and `GET /custom-fields` collections. Results normally emit one item per row. A search JSON Object can contain `filter`, `fields`, `page`, `limit`, `sort` and `include`. For example, a core Search can send:

```json
{
	"filter": {
		"expression": {
			"operator": "AND",
			"groups": [
				{
					"operator": "AND",
					"conditions": [{ "field": "severity", "operator": "eq", "value": "HIGH" }]
				}
			]
		}
	},
	"page": 1,
	"limit": 25,
	"sort": "-createdAt"
}
```

**Include Pagination Metadata** returns the core search page with `data`, `page` and `limit` and requests `itemsTotal` and `filteredCount` unless you supplied your own `include`. When requested, `filteredCount` comes with `totalPages`. **Return All** fetches pages up to **Max Items** or **Max Pages**. **Count** requests a metadata-only search and returns `{ "count": number }` with the exact filtered count.

Saved search parameters for page, page size and sort are translated. Rewrite nested filters that the new two-level expression cannot represent. Workflows using **Exclude IDs** need a revised filter because the collection contract removed that selector. For text search in the Tag and Custom Field collections, use `filter.query`.

## Create and update

**Individual Fields** builds the fields for one command item. Required create values appear as node parameters, optional values under **Additional Fields**, and update values under **Fields to Update**. Updates use **Expected Version** from the record you read. Picklist-backed fields load active values from `GET /picklists/auxiliary/list`.

**JSON Object** accepts a flat field object for a single command. Core Create and Update also accept the native `{ "items": [...] }` envelope. Create items use `clientRequestId` and `data`. Update items use `id`, `expectedVersion` and `changes`. The node generates a correlation ID for single-item creates. A flat update JSON object can clear nullable fields, for example `{ "summary": null }`.

Alert and Incident writes can require versioned relationship references. In Individual Fields mode, use **Command References** for those values. An Alert create with no linked incident sends `incident: null`. To change an Alert's detection time or linked incident, supply `currentIncident` as `{ "id": "...", "expectedVersion": 0 }` or `null` if currently unlinked. Use `destinationIncident` to change the link. For applicable assignee changes, supply `assigneeMembership` with the membership ID and version. With JSON Object mode, put those references on the command item alongside `data` or `changes`.

The node emits the API command response. Read the success IDs and versions from the response, then use **Get** for a full record. Check the failed items in bulk responses because a command can report both successes and failures.

## Tags

**Set Tags**, **Add Tags** and **Remove Tag** use `POST /<resource>/tags/replace`, `/tags/add` and `/tags/remove`. Supply the owning record ID and expected version. Set Tags accepts an empty array to clear all tags. Add Tags requires at least one tag value. Remove Tag takes a tag ID.

Tag administration uses `GET /tags` and the versioned commands `POST /tags`, `/tags/update` and `/tags/delete`. **With Counts** includes per-tag usage counts. **Bulk Update Color** takes items with `id`, `expectedVersion` and `changes.color`. To delete one tag, run **Get Deletion Impact**, review the result, and pass it to **Deletion Impact**. Bulk deletes require `id`, `expectedVersion`, `expectedUsageCounts` and `affectedRecords` per item. Set **Force** when you intend to unlink tags from the reviewed records.

## Custom fields

Definition administration uses `/custom-fields` and group administration uses `/custom-fields/groups`. Both use `POST /update` and `POST /delete` under their respective collection paths. A definition's field type is immutable. Bulk updates take items with `id`, `expectedVersion` and `changes`. For deletion, use the applicable **Get Dependencies** operation to get a version and the affected-record array. Supply that version and the reviewed array when deleting. Bulk definition delete items each require `affectedEntities`. An empty array is valid when the record has no dependencies.

Value operations support `ALERT`, `INCIDENT`, `OBSERVABLE` and `KNOWLEDGE`. **Get Values** returns `{ id, version, values }` from `GET /<resource>/<id>/custom-fields`. **Get Available** also returns the applicable `definitions` read from the operational custom field catalog. **Batch Get Values** reads up to 100 IDs individually and returns their snapshots in `data` in input order.

Both value update operations use `POST /<resource>/custom-fields/update`. **Replace Values** sends a complete set with the expected version you supply. Omitted optional attachments are removed and omitted required attachments are retained by HustleOps. **Update Selected Values Safely** reads the current values and version, merges the selected changes, and submits the version from that same read. A concurrent edit can cause a version conflict.

Custom field values are strings or `null`. The node converts multi-select arrays to JSON strings. A value item contains `fieldId` and `value`.

## Upgrading existing workflows

Set **Organization ID** in each credential and supply **Expected Version** for versioned updates, tag changes and custom field replacements. Update downstream expressions that read a write response as a full record or depend on the old pagination fields. Bulk tag and definition writes require versioned command items. HustleOps removed the Comment endpoints, so saved Comment nodes report that the resource is unavailable.

## Create Examples

With **Input Mode** set to **Individual Fields**, set these values through node fields. The JSON below shows the data inside the generated create command item.

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
