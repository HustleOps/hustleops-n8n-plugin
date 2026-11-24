const assert = require('node:assert/strict');
const { test } = require('node:test');

function createContext(parametersByItem, httpResponseFactory) {
	const calls = [];
	return {
		calls,
		context: {
			getInputData: () => parametersByItem.map((_, index) => ({ json: { item: index } })),
			getNode: () => ({ name: 'HustleOps', type: 'hustleOps' }),
			getCredentials: async () => ({
				baseUrl: 'https://hustleops.example.com',
				apiKey: 'fixture-api-key',
				organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			}),
			getNodeParameter: (name, itemIndex, defaultValue) => {
				const value = parametersByItem[itemIndex][name];
				return value === undefined ? defaultValue : value;
			},
			continueOnFail: () => false,
			helpers: {
				httpRequest: async (options) => {
					calls.push(options);
					return httpResponseFactory(options);
				},
			},
		},
	};
}

async function execute(parametersByItem, httpResponseFactory) {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	const { context, calls } = createContext(parametersByItem, httpResponseFactory);
	const result = await node.execute.call(context);
	return { result, calls };
}

const {
	createAdditionalFieldsParameterName: createAdditionalFieldsName,
	structuredFieldParameterName: structuredFieldName,
	updateFieldsParameterName: updateFieldsName,
} = require('../dist/nodes/HustleOps/structuredCoreFields.js');

test('get calls the resource detail endpoint', async () => {
	const alertId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[{ resource: 'alert', operation: 'get', id: alertId }],
		() => ({ id: alertId, displayId: 'ALT-1' }),
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/alerts/${alertId}`);
	assert.equal(calls[0].headers['x-api-key'], 'fixture-api-key');
	assert.deepEqual(result[0][0].json, { id: alertId, displayId: 'ALT-1' });
	assert.deepEqual(result[0][0].pairedItem, { item: 0 });
});

test('create builds structured body and posts to the resource endpoint', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'incident',
				operation: 'create',
				[structuredFieldName('incident', 'create', 'name')]: 'Credential theft',
				[structuredFieldName('incident', 'create', 'description')]: 'Okta alerts',
				[structuredFieldName('incident', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('incident', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('incident', 'create', 'category')]: 'identity',
				[createAdditionalFieldsName('incident')]: {
					status: '',
					tags: '["okta"]',
				},
			},
		],
		() => ({ id: 'incident-id-1', displayId: 'INC-1' }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/incidents');
	assert.match(calls[0].body.items[0].clientRequestId, /^[0-9a-f-]{36}$/);
	assert.deepEqual(calls[0].body.items[0].data, {
		name: 'Credential theft',
		description: 'Okta alerts',
		severity: 'HIGH',
		tlp: 'AMBER',
		category: 'identity',
		tags: ['okta'],
	});
	assert.deepEqual(result[0][0].json, { id: 'incident-id-1', displayId: 'INC-1' });
});

test('update posts changes to the versioned command endpoint', async () => {
	const observableId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'observable',
				operation: 'update',
				id: observableId,
				[updateFieldsName('observable')]: {
					threatLevel: 'MALICIOUS',
					criticality: 'HIGH',
					version: 4,
				},
			},
		],
		() => ({ id: observableId, threatLevel: 'MALICIOUS' }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/observables/update');
	assert.deepEqual(calls[0].body, {
		items: [
			{
				id: observableId,
				expectedVersion: 4,
				changes: { threatLevel: 'MALICIOUS', criticality: 'HIGH' },
			},
		],
	});
});

test('selected picklist dropdown values are sent unchanged in structured payloads', async () => {
	const { calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'create',
				[structuredFieldName('alert', 'create', 'name')]: 'Suspicious login',
				[structuredFieldName('alert', 'create', 'description')]: 'Okta anomaly',
				[structuredFieldName('alert', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('alert', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('alert', 'create', 'source')]: 'okta',
				[structuredFieldName('alert', 'create', 'type')]: 'authentication',
				[structuredFieldName('alert', 'create', 'sourceRef')]: 'evt_12345',
				[structuredFieldName('alert', 'create', 'detectedAt')]: '2026-06-28T12:00:00.000Z',
				[createAdditionalFieldsName('alert')]: {
					status: 'triage',
				},
			},
		],
		() => ({ id: 'alert-id-1', displayId: 'ALT-1' }),
	);

	assert.equal(calls[0].body.items[0].incident, null);
	assert.deepEqual(calls[0].body.items[0].data, {
		name: 'Suspicious login',
		description: 'Okta anomaly',
		severity: 'HIGH',
		tlp: 'AMBER',
		source: 'okta',
		type: 'authentication',
		sourceRef: 'evt_12345',
		detectedAt: '2026-06-28T12:00:00.000Z',
		status: 'triage',
	});
});

test('observable enum picklist selections are sent as API enum values', async () => {
	const observableId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'observable',
				operation: 'update',
				id: observableId,
				expectedVersion: 0,
				[updateFieldsName('observable')]: {
					threatLevel: 'SUSPICIOUS',
					criticality: 'LOW',
				},
			},
		],
		() => ({ id: observableId, threatLevel: 'SUSPICIOUS', criticality: 'LOW' }),
	);

	assert.deepEqual(calls[0].body.items[0].changes, {
		threatLevel: 'SUSPICIOUS',
		criticality: 'LOW',
	});
});

test('flat create JSON ignores hidden structured fields', async () => {
	const { calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'create',
				payloadInputMode: 'jsonObject',
				payloadAlertCreateJsonObject: JSON.stringify({
					name: 'Suspicious login',
					description: 'Okta anomaly',
					severity: 'HIGH',
					tlp: 'AMBER',
					source: 'okta',
					type: 'authentication',
					sourceRef: 'evt_12345',
					detectedAt: '2026-06-28T12:00:00.000Z',
				}),
				[structuredFieldName('alert', 'create', 'name')]: 'Ignored hidden value',
			},
		],
		() => ({ id: 'alert-id-1', displayId: 'ALT-1' }),
	);

	assert.deepEqual(calls[0].body.items[0].data, {
		name: 'Suspicious login',
		description: 'Okta anomaly',
		severity: 'HIGH',
		tlp: 'AMBER',
		source: 'okta',
		type: 'authentication',
		sourceRef: 'evt_12345',
		detectedAt: '2026-06-28T12:00:00.000Z',
	});
});

test('core create individual fields mode ignores JSON object payload', async () => {
	const { calls } = await execute(
		[
			{
				resource: 'incident',
				operation: 'create',
				payloadInputMode: 'individualFields',
				payloadIncidentCreateJsonObject: '{"name":"Ignored JSON"}',
				[structuredFieldName('incident', 'create', 'name')]: 'Credential theft',
				[structuredFieldName('incident', 'create', 'description')]: 'Okta alerts',
				[structuredFieldName('incident', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('incident', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('incident', 'create', 'category')]: 'identity',
			},
		],
		() => ({ id: 'incident-id-1' }),
	);

	assert.equal(calls[0].body.items[0].data.name, 'Credential theft');
	assert.equal(calls[0].body.items[0].data.description, 'Okta alerts');
	assert.equal(calls[0].body.items[0].data.category, 'identity');
	assert.equal(calls[0].body.items[0].data.name === 'Ignored JSON', false);
});

test('empty optional structured create fields are omitted', async () => {
	const { calls } = await execute(
		[
			{
				resource: 'incident',
				operation: 'create',
				[structuredFieldName('incident', 'create', 'name')]: 'Credential theft',
				[structuredFieldName('incident', 'create', 'description')]: 'Okta alerts',
				[structuredFieldName('incident', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('incident', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('incident', 'create', 'category')]: 'identity',
				[createAdditionalFieldsName('incident')]: {
					status: '',
					assigneeId: '',
					tags: '[]',
				},
			},
		],
		() => ({ id: 'incident-id-1', displayId: 'INC-1' }),
	);

	assert.deepEqual(calls[0].body.items[0].data, {
		name: 'Credential theft',
		description: 'Okta alerts',
		severity: 'HIGH',
		tlp: 'AMBER',
		category: 'identity',
	});
});

test('structured tags use entity tag validation before API requests', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'incident',
				operation: 'create',
				[structuredFieldName('incident', 'create', 'name')]: 'Credential theft',
				[structuredFieldName('incident', 'create', 'description')]: 'Okta alerts',
				[structuredFieldName('incident', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('incident', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('incident', 'create', 'category')]: 'identity',
				[createAdditionalFieldsName('incident')]: {
					tags: '["okta",7]',
				},
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Tag value must be a string/);
	assert.equal(calls.length, 0);
});

test('core JSON object mode validates tags before credentials are read', async () => {
	let getCredentialsCalled = false;
	const { context, calls } = createContext(
		[
			{
				resource: 'incident',
				operation: 'create',
				payloadInputMode: 'jsonObject',
				payloadIncidentCreateJsonObject: JSON.stringify({
					name: 'Credential theft',
					description: 'Okta alerts',
					severity: 'HIGH',
					tlp: 'AMBER',
					category: 'identity',
					tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
				}),
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	context.getCredentials = async () => {
		getCredentialsCalled = true;
		return {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		};
	};

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(
		node.execute.call(context),
		/Entity tags cannot contain more than 20 values/,
	);
	assert.equal(calls.length, 0);
	assert.equal(getCredentialsCalled, false);
});

test('structured alert create validates source before API requests', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'alert',
				operation: 'create',
				[structuredFieldName('alert', 'create', 'name')]: 'Suspicious login',
				[structuredFieldName('alert', 'create', 'description')]: 'Okta anomaly',
				[structuredFieldName('alert', 'create', 'severity')]: 'HIGH',
				[structuredFieldName('alert', 'create', 'tlp')]: 'AMBER',
				[structuredFieldName('alert', 'create', 'source')]: 'okta source',
				[structuredFieldName('alert', 'create', 'type')]: 'authentication',
				[structuredFieldName('alert', 'create', 'sourceRef')]: 'evt_12345',
				[structuredFieldName('alert', 'create', 'detectedAt')]: '2026-06-28T12:00:00.000Z',
				[createAdditionalFieldsName('alert')]: {},
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(
		node.execute.call(context),
		/Alert field Source \(source\) may only contain letters, digits, colons, hyphens, and underscores/,
	);
	assert.equal(calls.length, 0);
});

test('core write validation rejects invalid payloads before credentials are read', async () => {
	let getCredentialsCalled = false;
	const { context, calls } = createContext(
		[
			{
				resource: 'alert',
				operation: 'create',
				payloadInputMode: 'jsonObject',
				payloadAlertCreateJsonObject: '{"createdById":"user-id"}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	context.getCredentials = async () => {
		getCredentialsCalled = true;
		return {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		};
	};

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Unsupported Alert create field: createdById/);
	assert.equal(calls.length, 0);
	assert.equal(getCredentialsCalled, false);
});

test('structured field validation errors reference display labels', async () => {
	const validAlertCreate = {
		resource: 'alert',
		operation: 'create',
		[structuredFieldName('alert', 'create', 'name')]: 'Suspicious login',
		[structuredFieldName('alert', 'create', 'description')]: 'Okta anomaly',
		[structuredFieldName('alert', 'create', 'severity')]: 'HIGH',
		[structuredFieldName('alert', 'create', 'tlp')]: 'AMBER',
		[structuredFieldName('alert', 'create', 'source')]: 'okta',
		[structuredFieldName('alert', 'create', 'type')]: 'authentication',
		[structuredFieldName('alert', 'create', 'sourceRef')]: 'evt_12345',
		[structuredFieldName('alert', 'create', 'detectedAt')]: '2026-06-28T12:00:00.000Z',
		[createAdditionalFieldsName('alert')]: {},
	};
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();

	const missingSourceRef = createContext(
		[
			{
				...validAlertCreate,
				[structuredFieldName('alert', 'create', 'sourceRef')]: '',
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	await assert.rejects(
		node.execute.call(missingSourceRef.context),
		/Missing required Alert create field: Source Ref \(sourceRef\)/,
	);
	assert.equal(missingSourceRef.calls.length, 0);

	const invalidDetectedAt = createContext(
		[
			{
				...validAlertCreate,
				[structuredFieldName('alert', 'create', 'detectedAt')]: 'not-a-date',
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	await assert.rejects(
		node.execute.call(invalidDetectedAt.context),
		/Alert field Detected At \(detectedAt\) must be an ISO date-time string/,
	);
	assert.equal(invalidDetectedAt.calls.length, 0);
});

test('search posts a search request and returns one item per response row', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'knowledge',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadKnowledgeSearchJsonObject: JSON.stringify({
					filter: {
						operator: 'AND',
						groups: [
							{
								operator: 'AND',
								conditions: [{ field: 'type', operator: 'eq', value: 'runbook' }],
							},
						],
					},
					pagination: { page: 1, pageSize: 2, sortBy: 'createdAt', sortOrder: 'desc' },
				}),
				returnAll: false,
			},
		],
		() => ({
			data: [{ id: 'knw-1' }, { id: 'knw-2' }],
			filteredCount: 2,
			page: 1,
			limit: 2,
			totalPages: 1,
		}),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/knowledge/search');
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'knw-1' }, { id: 'knw-2' }],
	);
});

test('core search individual fields mode builds a validated search request', async () => {
	const { calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'search',
				payloadInputMode: 'individualFields',
				payloadSearchFilter: JSON.stringify({
					operator: 'AND',
					groups: [
						{
							operator: 'AND',
							conditions: [{ field: 'severity', operator: 'eq', value: 'HIGH' }],
						},
					],
				}),
				payloadSearchPage: 2,
				payloadSearchPageSize: 10,
				payloadSearchSortBy: '',
				payloadSearchSortOrder: '',
			},
		],
		() => ({ data: [], page: 2, limit: 10 }),
	);

	assert.equal(calls[0].body.page, 2);
	assert.equal(calls[0].body.limit, 10);
	assert.deepEqual(calls[0].body.filter.expression.groups[0].conditions, [
		{ field: 'severity', operator: 'eq', value: 'HIGH' },
	]);
});

test('search returnAll uses automatic pagination', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadAlertSearchJsonObject:
					'{"pagination":{"page":1,"pageSize":1,"sortBy":"detectedAt","sortOrder":"desc"}}',
				returnAll: true,
				maxItems: 2,
				maxPages: 5,
			},
		],
		(options) => ({
			data: [{ id: `alert-${options.body.page}` }],
			filteredCount: 2,
			page: options.body.page,
			limit: 1,
			totalPages: 2,
		}),
	);

	assert.deepEqual(
		calls.map((call) => call.body.page),
		[1, 2],
	);
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'alert-1' }, { id: 'alert-2' }],
	);
});

test('search can return raw pagination metadata for one page', async () => {
	const response = {
		data: [{ id: 'knw-1' }],
		filteredCount: 10,
		page: 1,
		limit: 1,
		totalPages: 10,
	};
	const { result } = await execute(
		[
			{
				resource: 'knowledge',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadKnowledgeSearchJsonObject: '{"pagination":{"page":1,"pageSize":1}}',
				returnAll: false,
				includePaginationMetadata: true,
			},
		],
		() => response,
	);

	assert.deepEqual(result[0][0].json, response);
});

test('search rejects invalid Return All limits before an API request is sent', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'alert',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadAlertSearchJsonObject: '{}',
				returnAll: true,
				maxItems: 0,
				maxPages: 5,
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Max Items must be a positive integer/);
	assert.equal(calls.length, 0);
});

test('search rejects malformed paginated API responses clearly', async () => {
	await assert.rejects(
		execute(
			[
				{
					resource: 'knowledge',
					operation: 'search',
					payloadInputMode: 'jsonObject',
					payloadKnowledgeSearchJsonObject: '{}',
				},
			],
			() => ({ data: {}, total: 1, page: 1, pageSize: 25, totalPages: 1 }),
		),
		/Knowledge search response must include a data array/,
	);
});

test('count requests only the exact filtered search count', async () => {
	const { result, calls } = await execute(
		[{ resource: 'incident', operation: 'count', payloadInputMode: 'individualFields' }],
		() => ({ data: [], page: 1, limit: 25, filteredCount: 7, totalPages: 1 }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/incidents/search');
	assert.deepEqual(calls[0].body, { fields: 'none', include: ['filteredCount'] });
	assert.deepEqual(result[0][0].json, { count: 7 });
});

test('unsupported body fields fail before an API request is sent', async () => {
	await assert.rejects(
		execute(
			[
				{
					resource: 'alert',
					operation: 'create',
					payloadInputMode: 'jsonObject',
					payloadAlertCreateJsonObject: '{"createdById":"user-id"}',
				},
			],
			() => ({ id: 'should-not-run' }),
		),
		/Unsupported Alert create field: createdById/,
	);
});

test('unsafe IDs fail before an API request is sent', async () => {
	const { context, calls } = createContext(
		[{ resource: 'alert', operation: 'get', id: '../users' }],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Alert ID must be a valid UUID/);
	assert.equal(calls.length, 0);
});

test('entity tag JSON object mode rejects unsupported fields before credentials are read', async () => {
	let getCredentialsCalled = false;
	const { context, calls } = createContext(
		[
			{
				resource: 'alert',
				operation: 'setTags',
				expectedVersion: 1,
				id: '11111111-1111-4111-8111-111111111111',
				payloadInputMode: 'jsonObject',
				payloadAlertSetTagsJsonObject: JSON.stringify({
					values: ['vip'],
					entityId: '22222222-2222-4222-8222-222222222222',
				}),
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	context.getCredentials = async () => {
		getCredentialsCalled = true;
		return {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		};
	};

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(
		node.execute.call(context),
		/Unsupported Set Tags JSON Object field: entityId/,
	);
	assert.equal(calls.length, 0);
	assert.equal(getCredentialsCalled, false);
});

test('entity add tags rejects empty values before an API request is sent', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'knowledge',
				operation: 'addTags',
				expectedVersion: 1,
				id: '11111111-1111-4111-8111-111111111111',
				payloadInputMode: 'individualFields',
				payloadEntityTagValues: '[]',
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Add Tags requires at least one tag value/);
	assert.equal(calls.length, 0);
});

test('tag and custom field boolean JSON fields reject string values', async () => {
	const tagId = '11111111-1111-4111-8111-111111111111';
	const definitionId = '22222222-2222-4222-8222-222222222222';
	const { context, calls } = createContext(
		[
			{
				resource: 'tag',
				operation: 'bulkDelete',
				payloadInputMode: 'jsonObject',
				payloadTagBulkDeleteJsonObject: JSON.stringify({
					items: [
						{
							id: tagId,
							expectedVersion: 0,
							expectedUsageCounts: {
								alerts: 0,
								incidents: 0,
								observables: 0,
								knowledge: 0,
								templates: 0,
							},
							affectedRecords: [],
						},
					],
					force: 'false',
				}),
			},
			{
				resource: 'customField',
				operation: 'bulkUpdateDefinitions',
				payloadInputMode: 'jsonObject',
				payloadCustomFieldBulkUpdateDefinitionsJsonObject: JSON.stringify({
					items: [{ id: definitionId, expectedVersion: 0, changes: { isRequired: 'false' } }],
				}),
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Force must be a boolean/);
	assert.equal(calls.length, 0);

	const customFieldOnly = createContext(
		[
			{
				resource: 'customField',
				operation: 'bulkUpdateDefinitions',
				payloadInputMode: 'jsonObject',
				payloadCustomFieldBulkUpdateDefinitionsJsonObject: JSON.stringify({
					items: [{ id: definitionId, expectedVersion: 0, changes: { isRequired: 'false' } }],
				}),
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	await assert.rejects(
		node.execute.call(customFieldOnly.context),
		/Custom field definition isRequired must be a boolean/,
	);
	assert.equal(customFieldOnly.calls.length, 0);
});

test('tag search validates JSON object mode before credentials are read', async () => {
	let getCredentialsCalled = false;
	const { context, calls } = createContext(
		[
			{
				resource: 'tag',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadTagSearchJsonObject: '{"limit":0}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	context.getCredentials = async () => {
		getCredentialsCalled = true;
		return {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		};
	};

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Collection limit must be an integer/);
	assert.equal(calls.length, 0);
	assert.equal(getCredentialsCalled, false);
});

test('admin search operations emit one item per paginated data row', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'tag',
				operation: 'search',
				payloadInputMode: 'jsonObject',
				payloadTagSearchJsonObject: '{"pagination":{"page":1,"pageSize":2}}',
			},
			{
				resource: 'customField',
				operation: 'searchDefinitions',
				payloadInputMode: 'jsonObject',
				payloadCustomFieldSearchDefinitionsJsonObject: '{"pagination":{"page":1,"pageSize":1}}',
			},
		],
		(options) => {
			if (new URL(options.url).pathname.endsWith('/tags')) {
				return {
					data: [{ id: 'tag-1' }, { id: 'tag-2' }],
					filteredCount: 2,
					page: 1,
					limit: 2,
					totalPages: 1,
				};
			}
			return {
				data: [{ id: 'field-1' }],
				filteredCount: 1,
				page: 1,
				limit: 1,
				totalPages: 1,
			};
		},
	);

	assert.deepEqual(
		calls.map((call) => call.method),
		['GET', 'GET'],
	);
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags?page=1&limit=2');
	assert.equal(calls[1].url, 'https://hustleops.example.com/api/v1/custom-fields?page=1&limit=1');
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'tag-1' }, { id: 'tag-2' }, { id: 'field-1' }],
	);
});

test('custom field batch get values supports individual fields and JSON object mode', async () => {
	const firstId = '11111111-1111-4111-8111-111111111111';
	const secondId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'customField',
				operation: 'batchGetValues',
				entityType: 'ALERT',
				payloadInputMode: 'individualFields',
				payloadCustomFieldEntityIds: JSON.stringify([firstId]),
			},
			{
				resource: 'customField',
				operation: 'batchGetValues',
				entityType: 'ALERT',
				payloadInputMode: 'jsonObject',
				payloadCustomFieldBatchGetValuesJsonObject: JSON.stringify({
					entityType: 'INCIDENT',
					entityIds: [secondId],
				}),
			},
		],
		() => ({ ok: true }),
	);

	assert.deepEqual(
		calls.map((call) => call.method),
		['GET', 'GET'],
	);
	assert.deepEqual(
		calls.map((call) => new URL(call.url).pathname),
		[`/api/v1/alerts/${firstId}/custom-fields`, `/api/v1/incidents/${secondId}/custom-fields`],
	);
});

test('custom field safe selected updates merge with existing attached fields', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const updatedFieldId = '22222222-2222-4222-8222-222222222222';
	const preservedFieldId = '33333333-3333-4333-8333-333333333333';
	const { result, calls } = await execute(
		[
			{
				resource: 'customField',
				operation: 'updateSelectedValuesSafely',
				entityType: 'INCIDENT',
				entityId,
				payloadInputMode: 'individualFields',
				payloadCustomFieldValues: JSON.stringify([{ fieldId: updatedFieldId, value: 'critical' }]),
			},
		],
		(options) => {
			if (options.method === 'GET') {
				return {
					id: entityId,
					version: 7,
					values: {
						groups: [{ fields: [{ fieldId: preservedFieldId, value: 'owner stays attached' }] }],
						ungrouped: [{ fieldId: updatedFieldId, value: 'medium' }],
					},
				};
			}
			return { updated: true };
		},
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/incidents/${entityId}/custom-fields`,
	);
	assert.equal(calls[1].method, 'POST');
	assert.equal(calls[1].url, 'https://hustleops.example.com/api/v1/incidents/custom-fields/update');
	assert.deepEqual(calls[1].body, {
		items: [
			{
				id: entityId,
				expectedVersion: 7,
				values: [
					{ fieldId: updatedFieldId, value: 'critical' },
					{ fieldId: preservedFieldId, value: 'owner stays attached' },
				],
			},
		],
	});
	assert.deepEqual(result[0][0].json, { updated: true });
});

test('custom field updates reject immutable fieldType changes and oversized batches', async () => {
	const definitionId = '11111111-1111-4111-8111-111111111111';
	const { context, calls } = createContext(
		[
			{
				resource: 'customField',
				operation: 'updateDefinition',
				customFieldDefinitionId: definitionId,
				payloadInputMode: 'individualFields',
				payloadCustomFieldDefinitionFields: '{"fieldType":"BOOLEAN"}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /fieldType is immutable/);
	assert.equal(calls.length, 0);

	const ids = Array.from(
		{ length: 101 },
		(_, index) => `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
	);
	const oversized = createContext(
		[
			{
				resource: 'customField',
				operation: 'batchGetValues',
				entityType: 'ALERT',
				payloadInputMode: 'individualFields',
				payloadCustomFieldEntityIds: JSON.stringify(ids),
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	await assert.rejects(
		node.execute.call(oversized.context),
		/Custom field batch cannot contain more than 100 IDs/,
	);
	assert.equal(oversized.calls.length, 0);
});

test('saved comment nodes report the removed API without sending a request', async () => {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const { context, calls } = createContext([{ resource: 'comment', operation: 'list' }]);
	await assert.rejects(new HustleOps().execute.call(context), /removed the Comment API/);
	assert.equal(calls.length, 0);
});

test('core JSON update accepts a native command and preserves its item results', async () => {
	const id = '11111111-1111-4111-8111-111111111111';
	const body = { items: [{ id, expectedVersion: 0, changes: { summary: null } }] };
	const response = {
		requestId: 'command-id',
		succeeded: 1,
		failed: 0,
		failedItems: [],
		data: [{ index: 0, id, version: 1 }],
	};
	const { calls, result } = await execute(
		[
			{
				resource: 'incident',
				operation: 'update',
				payloadInputMode: 'jsonObject',
				payloadIncidentUpdateJsonObject: JSON.stringify(body),
			},
		],
		() => response,
	);

	assert.equal(new URL(calls[0].url).pathname, '/api/v1/incidents/update');
	assert.deepEqual(calls[0].body, body);
	assert.deepEqual(result[0][0].json, response);
});

test('entity tags use versioned replace, add, and remove commands', async () => {
	const id = '11111111-1111-4111-8111-111111111111';
	const tagId = '22222222-2222-4222-8222-222222222222';
	const scope = { resource: 'incident', id, expectedVersion: 5 };
	const { calls } = await execute(
		[
			{ ...scope, operation: 'setTags', payloadEntityTagValues: '[]' },
			{ ...scope, operation: 'addTags', payloadEntityTagValues: '["vip"]' },
			{ ...scope, operation: 'removeTag', tagId },
		],
		() => ({ succeeded: 1, failed: 0 }),
	);

	assert.deepEqual(
		calls.map(({ method, url }) => [method, new URL(url).pathname]),
		[
			['POST', '/api/v1/incidents/tags/replace'],
			['POST', '/api/v1/incidents/tags/add'],
			['POST', '/api/v1/incidents/tags/remove'],
		],
	);
	assert.deepEqual(
		calls.map(({ body }) => body.items[0]),
		[
			{ id, expectedVersion: 5, values: [] },
			{ id, expectedVersion: 5, values: ['vip'] },
			{ id, expectedVersion: 5, tagId },
		],
	);
});

test('tag deletion uses the reviewed impact and each affected record version', async () => {
	const id = '11111111-1111-4111-8111-111111111111';
	const recordId = '22222222-2222-4222-8222-222222222222';
	const usageCounts = { alerts: 0, incidents: 1, observables: 0, knowledge: 0, templates: 0 };
	const impact = {
		id,
		version: 3,
		usageCounts,
		affectedRecords: [{ entityType: 'INCIDENT', id: recordId, version: 7 }],
	};
	const { calls, result } = await execute(
		[
			{ resource: 'tag', operation: 'getDeletionImpact', tagId: id },
			{
				resource: 'tag',
				operation: 'delete',
				tagId: id,
				force: true,
				payloadTagDeletionImpact: JSON.stringify(impact),
			},
		],
		({ method }) => (method === 'GET' ? impact : { succeeded: 1, failed: 0 }),
	);

	assert.equal(new URL(calls[0].url).pathname, `/api/v1/tags/${id}/deletion-impact`);
	assert.deepEqual(result[0][0].json, impact);
	assert.equal(new URL(calls[1].url).pathname, '/api/v1/tags/delete');
	assert.deepEqual(calls[1].body, {
		force: true,
		items: [
			{
				id,
				expectedVersion: 3,
				expectedUsageCounts: usageCounts,
				affectedRecords: [{ entityType: 'INCIDENT', id: recordId, expectedVersion: 7 }],
			},
		],
	});
});

test('custom field definition update and value replacement carry separate target versions', async () => {
	const fieldId = '11111111-1111-4111-8111-111111111111';
	const entityId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'customField',
				operation: 'updateDefinition',
				customFieldDefinitionId: fieldId,
				expectedVersion: 2,
				payloadCustomFieldDefinitionFields: '{"defaultValue":null}',
			},
			{
				resource: 'customField',
				operation: 'replaceValues',
				entityType: 'KNOWLEDGE',
				entityId,
				expectedVersion: 8,
				payloadCustomFieldValues: JSON.stringify([{ fieldId, value: null }]),
			},
		],
		() => ({ succeeded: 1, failed: 0 }),
	);

	assert.deepEqual(
		calls.map(({ method, url }) => [method, new URL(url).pathname]),
		[
			['POST', '/api/v1/custom-fields/update'],
			['POST', '/api/v1/knowledge/custom-fields/update'],
		],
	);
	assert.deepEqual(calls[0].body, {
		items: [{ id: fieldId, expectedVersion: 2, changes: { defaultValue: null } }],
	});
	assert.deepEqual(calls[1].body, {
		items: [{ id: entityId, expectedVersion: 8, values: [{ fieldId, value: null }] }],
	});
});
