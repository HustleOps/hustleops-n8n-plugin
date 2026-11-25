# HustleOps n8n Community Node

![HustleOps app icon](nodes/HustleOps/hustleops.svg)

Use this community node to read and update HustleOps incident response records in n8n.

Install `@hustleops/n8n-nodes-hustleops` on an n8n instance that allows community nodes.

| Resource                               | Operations                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alert, Incident, Observable, Knowledge | Search, Count, Get, Create, Update, Set Tags, Add Tags, Remove Tag                                                                                                                                                                                                                                                                                      |
| Tag                                    | List, Search, Create, Update Color, Bulk Update Color, Get Deletion Impact, Delete, Bulk Delete                                                                                                                                                                                                                                                         |
| Custom Field                           | List Groups, Create Group, Update Group, Get Group Dependencies, Delete Group, List Definitions, Search Definitions, Create Definition, Update Definition, Bulk Update Definitions, Get Definition Dependencies, Delete Definition, Bulk Delete Definitions, Get Values, Get Available, Batch Get Values, Replace Values, Update Selected Values Safely |

## Authentication

Create a **HustleOps API** credential in n8n and enter the **Base URL**, **Organization ID** and **API Key**. Use the UUIDv4 of the organization the key can access. Create the key in HustleOps with the permissions needed by the workflow. Use HTTPS for deployed instances. HTTP is supported for local development on `localhost`, `127.0.0.1` and `::1`.

The node sends `x-api-key` and `X-Organization-Id` on scoped requests. The credential check uses the operational tag catalog, so testing the connection requires no tag administration grant.

## API endpoint reference

All routes below are relative to `/api/v1`. In core and record custom field routes, `<resource>` expands to `alerts`, `incidents`, `observables`, or `knowledge`. Path IDs are UUIDv4.

The method and path mapping was checked against the app's controllers and OpenAPI source at `1130bcf53286`. The app's backend build generates the domain specifications at `backend/dist/<domain>-openapi.json`. [HustleOps app source](https://github.com/HustleOps/hustleops-app/tree/1130bcf532868d4a88e2d1178fd9ece7a55fbe24/backend/src)

| Node operation                                                            | API request                                                                        | Request details or result                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Core Search and Count                                                     | `POST /<resource>/search`                                                          | Count sends `fields: "none"` and requests `filteredCount`.                                   |
| Core Get                                                                  | `GET /<resource>/{id}`                                                             | Returns the record in the selected organization.                                             |
| Core Create                                                               | `POST /<resource>`                                                                 | Sends `{ items }` with a `clientRequestId` and `data` per item.                              |
| Core Update                                                               | `POST /<resource>/update`                                                          | Sends `{ items }` with `id`, `expectedVersion` and `changes` per item.                       |
| Set Tags                                                                  | `POST /<resource>/tags/replace`                                                    | An empty `values` array clears the record's tags.                                            |
| Add Tags                                                                  | `POST /<resource>/tags/add`                                                        | Supply at least one tag value.                                                               |
| Remove Tag                                                                | `POST /<resource>/tags/remove`                                                     | Supply the tag ID and the record's expected version.                                         |
| Tag List and Search                                                       | `GET /tags`                                                                        | Search sends collection options as query parameters.                                         |
| Tag Create                                                                | `POST /tags`                                                                       | Sends `{ items }` with `clientRequestId` and `data.value`.                                   |
| Tag Update Color and Bulk Update Color                                    | `POST /tags/update`                                                                | Update items include `changes.color` and the expected version.                               |
| Tag Get Deletion Impact                                                   | `GET /tags/{id}/deletion-impact`                                                   | Returns the tag version, usage counts and affected records.                                  |
| Tag Delete and Bulk Delete                                                | `POST /tags/delete`                                                                | Sends the reviewed usage counts and affected record versions.                                |
| Credential check and tag dropdown                                         | `GET /tags/auxiliary/list`                                                         | The credential check requests one row. The dropdown follows `nextCursor`.                    |
| Custom Field List Definitions, Search Definitions and definition dropdown | `GET /custom-fields`                                                               | Uses the administration collection.                                                          |
| Custom Field Create Definition                                            | `POST /custom-fields`                                                              | Create items carry `clientRequestId` and definition `data`.                                  |
| Custom Field Update Definition and Bulk Update Definitions                | `POST /custom-fields/update`                                                       | Update items carry the definition version and `changes`.                                     |
| Custom Field Delete Definition and Bulk Delete Definitions                | `POST /custom-fields/delete`                                                       | Delete items carry `affectedEntities`.                                                       |
| Custom Field Get Definition Dependencies                                  | `GET /custom-fields/{id}` and `GET /custom-fields/{id}/dependencies`               | Reads the definition version and its paged dependencies.                                     |
| Custom Field List Groups                                                  | `GET /custom-fields/groups`                                                        | Returns the administration collection.                                                       |
| Custom Field Create Group                                                 | `POST /custom-fields/groups`                                                       | Create items carry `clientRequestId` and group `data`.                                       |
| Custom Field Update Group                                                 | `POST /custom-fields/groups/update`                                                | Update items carry the group version and `changes`.                                          |
| Custom Field Delete Group                                                 | `POST /custom-fields/groups/delete`                                                | Delete items carry `affectedDefinitions`.                                                    |
| Custom Field Get Group Dependencies                                       | `GET /custom-fields/groups/{id}` and `GET /custom-fields/groups/{id}/dependencies` | Reads the group version and its paged dependencies.                                          |
| Custom Field Get Values and Batch Get Values                              | `GET /<resource>/{id}/custom-fields`                                               | Returns `{ id, version, values }`. Batch Get Values reads each ID in order.                  |
| Custom Field Get Available                                                | `GET /<resource>/{id}/custom-fields` and `GET /custom-fields/auxiliary/list`       | Reads record values and filters applicable definitions by `entityType`.                      |
| Custom Field Replace Values and Update Selected Values Safely             | `POST /<resource>/custom-fields/update`                                            | Sends the record version and complete value set. Safe updates read values and version first. |
| Picklist dropdowns                                                        | `GET /picklists/auxiliary/list`                                                    | Filters by domain and reads choices in `sortOrder`.                                          |

## Search and count

Search normally emits one item per row. A search JSON Object can contain `filter`, `fields`, `page`, `limit`, `sort` and `include`. This core Search example filters for high severity.

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

**Individual Fields** builds one command item. Required create values appear as node parameters, optional values under **Additional Fields**, and update values under **Fields to Update**. Updates use **Expected Version** from the record you read. Observable create and update send JSON. File observables use the app's multipart upload API.

**JSON Object** accepts a flat field object for a single command. Core Create and Update also accept the native `{ "items": [...] }` envelope. Create items use `clientRequestId` and `data`. Update items use `id`, `expectedVersion` and `changes`. The node generates a correlation ID for single-item creates. A flat update JSON object can clear nullable fields, for example `{ "summary": null }`.

Alert and Incident writes can require versioned relationship references. In Individual Fields mode, use **Command References** for those values. Each native Alert create item must include an `incident` reference or `incident: null` for an unlinked alert. To change an Alert's detection time or linked incident, supply `currentIncident` as `{ "id": "...", "expectedVersion": 0 }` or `null` if currently unlinked. Use `destinationIncident` to change the link. For applicable assignee changes, supply `assigneeMembership` with the membership ID and version. With JSON Object mode, put those references on the command item alongside `data` or `changes`.

The node emits the API command response. Read the success IDs and versions from the response, then use **Get** for a full record. Check the failed items in bulk responses because a command can report both successes and failures.

## Tags

Supply the record's expected version for all three tag membership operations. HustleOps allows up to 30 tags per record and up to 30 characters per tag. Tag values accept ASCII letters, digits, spaces, and `* ! @ # $ : . - _ =`.

**With Counts** includes per-tag usage counts. **Bulk Update Color** takes items with `id`, `expectedVersion` and `changes.color`. To delete one tag, run **Get Deletion Impact**, review the result, and pass it to **Deletion Impact**. Bulk deletes require `id`, `expectedVersion`, `expectedUsageCounts` and `affectedRecords` per item. Set **Force** when you intend to unlink tags from the reviewed records.

## Custom fields

A definition's field type is immutable. Bulk updates take items with `id`, `expectedVersion` and `changes`. For deletion, use the applicable **Get Dependencies** operation to get a version and the affected-record array. Supply that version and the reviewed array when deleting. Bulk definition delete items each require `affectedEntities`. An empty array is valid when the record has no dependencies.

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
