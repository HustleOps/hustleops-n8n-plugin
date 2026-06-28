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

test('create sanitizes body and posts to the resource endpoint', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'incident',
				operation: 'create',
				body: JSON.stringify({
					name: 'Credential theft',
					description: 'Okta alerts',
					severity: 'HIGH',
					tlp: 'AMBER',
					category: 'identity',
					status: undefined,
					tags: ['okta'],
				}),
			},
		],
		() => ({ id: 'incident-id-1', displayId: 'INC-1' }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/incidents');
	assert.deepEqual(calls[0].body, {
		name: 'Credential theft',
		description: 'Okta alerts',
		severity: 'HIGH',
		tlp: 'AMBER',
		category: 'identity',
		tags: ['okta'],
	});
	assert.deepEqual(result[0][0].json, { id: 'incident-id-1', displayId: 'INC-1' });
});

test('update sanitizes body and patches the resource detail endpoint', async () => {
	const observableId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'observable',
				operation: 'update',
				id: observableId,
				body: JSON.stringify({
					threatLevel: 'MALICIOUS',
					criticality: 'HIGH',
					version: 4,
				}),
			},
		],
		() => ({ id: observableId, threatLevel: 'MALICIOUS' }),
	);

	assert.equal(calls[0].method, 'PATCH');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/observables/${observableId}`);
	assert.deepEqual(calls[0].body, {
		threatLevel: 'MALICIOUS',
		criticality: 'HIGH',
		version: 4,
	});
});

test('search posts a search request and returns one item per response row', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'knowledge',
				operation: 'search',
				searchBody: JSON.stringify({
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
			total: 2,
			page: 1,
			pageSize: 2,
			totalPages: 1,
		}),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/knowledge/search');
	assert.deepEqual(result[0].map((item) => item.json), [{ id: 'knw-1' }, { id: 'knw-2' }]);
});

test('search returnAll uses automatic pagination', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'search',
				searchBody: '{"pagination":{"page":1,"pageSize":1,"sortBy":"detectedAt","sortOrder":"desc"}}',
				returnAll: true,
				maxItems: 2,
				maxPages: 5,
			},
		],
		(options) => ({
			data: [{ id: `alert-${options.body.pagination.page}` }],
			total: 2,
			page: options.body.pagination.page,
			pageSize: 1,
			totalPages: 2,
		}),
	);

	assert.deepEqual(calls.map((call) => call.body.pagination.page), [1, 2]);
	assert.deepEqual(result[0].map((item) => item.json), [{ id: 'alert-1' }, { id: 'alert-2' }]);
});

test('search can return raw pagination metadata for one page', async () => {
	const response = {
		data: [{ id: 'knw-1' }],
		total: 10,
		page: 1,
		pageSize: 1,
		totalPages: 10,
	};
	const { result } = await execute(
		[
			{
				resource: 'knowledge',
				operation: 'search',
				searchBody: '{"pagination":{"page":1,"pageSize":1}}',
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
				searchBody: '{}',
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
					searchBody: '{}',
				},
			],
			() => ({ data: {}, total: 1, page: 1, pageSize: 25, totalPages: 1 }),
		),
		/Knowledge search response must include a data array/,
	);
});

test('count posts to the count endpoint and returns the count body', async () => {
	const { result, calls } = await execute(
		[{ resource: 'incident', operation: 'count', searchBody: '{}' }],
		() => ({ count: 7 }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/incidents/count');
	assert.deepEqual(result[0][0].json, { count: 7 });
});

test('unsupported body fields fail before an API request is sent', async () => {
	await assert.rejects(
		execute(
			[
				{
					resource: 'alert',
					operation: 'create',
					body: '{"name":"x","createdById":"user-id"}',
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
