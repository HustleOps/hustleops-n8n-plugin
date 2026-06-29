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
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'knw-1' }, { id: 'knw-2' }],
	);
});

test('search returnAll uses automatic pagination', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'alert',
				operation: 'search',
				searchBody:
					'{"pagination":{"page":1,"pageSize":1,"sortBy":"detectedAt","sortOrder":"desc"}}',
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

	assert.deepEqual(
		calls.map((call) => call.body.pagination.page),
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

test('comment list calls list endpoint and returns one item per comment by default', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'list',
				entityType: 'ALERT',
				entityId,
				take: 2,
				cursor: '',
				includeCommentPaginationMetadata: false,
			},
		],
		() => ({
			items: [{ id: 'comment-1' }, { id: 'comment-2' }],
			nextCursor: '22222222-2222-4222-8222-222222222222',
		}),
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/comments?entityType=ALERT&entityId=${entityId}&take=2`,
	);
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'comment-1' }, { id: 'comment-2' }],
	);
});

test('comment list can return raw cursor metadata', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const response = {
		items: [{ id: 'comment-1' }],
		nextCursor: '22222222-2222-4222-8222-222222222222',
	};
	const { result } = await execute(
		[
			{
				resource: 'comment',
				operation: 'list',
				entityType: 'ALERT',
				entityId,
				take: 1,
				includeCommentPaginationMetadata: true,
			},
		],
		() => response,
	);

	assert.deepEqual(result[0][0].json, response);
});

test('comment search calls search endpoint and returns comments', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'search',
				entityType: 'INCIDENT',
				entityId,
				q: 'containment',
				maxResults: 1,
			},
		],
		() => [
			{ id: 'comment-1', content: 'containment started' },
			{ id: 'comment-2', content: 'containment completed' },
		],
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/comments/search?entityType=INCIDENT&entityId=${entityId}&q=containment`,
	);
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'comment-1', content: 'containment started' }],
	);
});

test('comment unread count wraps numeric response', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'unreadCount',
				entityType: 'KNOWLEDGE',
				entityId,
			},
		],
		() => 3,
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/comments/unread-count?entityType=KNOWLEDGE&entityId=${entityId}`,
	);
	assert.deepEqual(result[0][0].json, { unreadCount: 3 });
});

test('comment create posts sanitized body', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'create',
				entityType: 'OBSERVABLE',
				entityId,
				commentBody: JSON.stringify({
					content: 'Observed in proxy logs',
				}),
			},
		],
		() => ({ id: 'comment-1', autoTransitioned: false }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/comments');
	assert.deepEqual(calls[0].body, {
		entityType: 'OBSERVABLE',
		entityId,
		content: 'Observed in proxy logs',
	});
	assert.deepEqual(result[0][0].json, { id: 'comment-1', autoTransitioned: false });
});

test('comment mark read posts entity body and returns success object', async () => {
	const entityId = '11111111-1111-4111-8111-111111111111';
	const { result, calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'markRead',
				entityType: 'INCIDENT',
				entityId,
			},
		],
		() => undefined,
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/comments/read');
	assert.deepEqual(calls[0].body, { entityType: 'INCIDENT', entityId });
	assert.deepEqual(result[0][0].json, { success: true, entityType: 'INCIDENT', entityId });
});

test('comment update patches comment content', async () => {
	const commentId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'update',
				commentId,
				commentBody: '{"content":"Updated containment note"}',
			},
		],
		() => ({ id: commentId, content: 'Updated containment note' }),
	);

	assert.equal(calls[0].method, 'PATCH');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/comments/${commentId}`);
	assert.deepEqual(calls[0].body, { content: 'Updated containment note' });
});

test('comment delete calls comment detail endpoint', async () => {
	const commentId = '22222222-2222-4222-8222-222222222222';
	const { result, calls } = await execute(
		[{ resource: 'comment', operation: 'delete', commentId }],
		() => ({ id: commentId, entityType: 'ALERT', entityId: 'entity-id' }),
	);

	assert.equal(calls[0].method, 'DELETE');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/comments/${commentId}`);
	assert.deepEqual(result[0][0].json, {
		id: commentId,
		entityType: 'ALERT',
		entityId: 'entity-id',
	});
});

test('comment toggle reaction posts emoji body', async () => {
	const commentId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{
				resource: 'comment',
				operation: 'toggleReaction',
				commentId,
				commentBody: '{"emoji":"OK"}',
			},
		],
		() => ({ id: commentId, reactions: [{ emoji: 'OK', count: 1, users: [] }] }),
	);

	assert.equal(calls[0].method, 'POST');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/comments/${commentId}/reactions`,
	);
	assert.deepEqual(calls[0].body, { emoji: 'OK' });
});

test('comment toggle pin patches pin endpoint', async () => {
	const commentId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[{ resource: 'comment', operation: 'togglePin', commentId }],
		() => ({ id: commentId, isPinned: true }),
	);

	assert.equal(calls[0].method, 'PATCH');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/comments/${commentId}/pin`);
	assert.equal(calls[0].body, undefined);
});

test('comment create rejects empty body before an API request is sent', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'comment',
				operation: 'create',
				entityType: 'ALERT',
				entityId: '11111111-1111-4111-8111-111111111111',
				commentBody: '{}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(
		node.execute.call(context),
		/Comment create requires content or attachmentIds/,
	);
	assert.equal(calls.length, 0);
});

test('comment create rejects entity scope inside Comment Body', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'comment',
				operation: 'create',
				entityType: 'ALERT',
				entityId: '11111111-1111-4111-8111-111111111111',
				commentBody:
					'{"entityType":"INCIDENT","entityId":"22222222-2222-4222-8222-222222222222","content":"wrong target"}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(
		node.execute.call(context),
		/Unsupported Comment create body field: entityType/,
	);
	assert.equal(calls.length, 0);
});

test('comment operations reject unsafe comment IDs before an API request is sent', async () => {
	const { context, calls } = createContext(
		[{ resource: 'comment', operation: 'delete', commentId: '../users' }],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Comment ID must be a valid UUID/);
	assert.equal(calls.length, 0);
});

test('comment operations reject unsupported body fields before credentials are read', async () => {
	let getCredentialsCalled = false;
	const { context, calls } = createContext(
		[
			{
				resource: 'comment',
				operation: 'update',
				commentId: '22222222-2222-4222-8222-222222222222',
				commentBody: '{"content":"Updated note","entityId":"11111111-1111-4111-8111-111111111111"}',
			},
		],
		() => ({ id: 'should-not-run' }),
	);
	context.getCredentials = async () => {
		getCredentialsCalled = true;
		return {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		};
	};

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Unsupported Comment update field: entityId/);
	assert.equal(calls.length, 0);
	assert.equal(getCredentialsCalled, false);
});

test('tag resource operations call the requested admin endpoints', async () => {
	const tagId = '11111111-1111-4111-8111-111111111111';
	const secondTagId = '22222222-2222-4222-8222-222222222222';
	const { calls } = await execute(
		[
			{ resource: 'tag', operation: 'list', withCounts: true },
			{
				resource: 'tag',
				operation: 'search',
				tagBody: '{"filter":{"operator":"AND","groups":[]}}',
			},
			{ resource: 'tag', operation: 'create', tagBody: '{"value":"vip","color":"#0EA5E9"}' },
			{ resource: 'tag', operation: 'updateColor', tagId, tagBody: '{"color":"#A855F7"}' },
			{
				resource: 'tag',
				operation: 'bulkUpdateColor',
				tagBody: JSON.stringify({ ids: [tagId, secondTagId], color: '#22C55E' }),
			},
			{ resource: 'tag', operation: 'delete', tagId, force: true },
			{
				resource: 'tag',
				operation: 'bulkDelete',
				tagBody: JSON.stringify({ ids: [tagId, secondTagId], force: true }),
			},
		],
		(options) =>
			options.url.endsWith('/tags/search')
				? { data: [{ id: 'tag-search-result' }], total: 1, page: 1, pageSize: 25, totalPages: 1 }
				: { ok: true },
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags?withCounts=true');
	assert.equal(calls[0].body, undefined);

	assert.equal(calls[1].method, 'POST');
	assert.equal(calls[1].url, 'https://hustleops.example.com/api/v1/tags/search');
	assert.deepEqual(calls[1].body, { filter: { operator: 'AND', groups: [] } });

	assert.equal(calls[2].method, 'POST');
	assert.equal(calls[2].url, 'https://hustleops.example.com/api/v1/tags');
	assert.deepEqual(calls[2].body, { value: 'vip', color: '#0EA5E9' });

	assert.equal(calls[3].method, 'PATCH');
	assert.equal(calls[3].url, `https://hustleops.example.com/api/v1/tags/${tagId}`);
	assert.deepEqual(calls[3].body, { color: '#A855F7' });

	assert.equal(calls[4].method, 'PATCH');
	assert.equal(calls[4].url, 'https://hustleops.example.com/api/v1/tags/bulk');
	assert.deepEqual(calls[4].body, { ids: [tagId, secondTagId], color: '#22C55E' });

	assert.equal(calls[5].method, 'DELETE');
	assert.equal(calls[5].url, `https://hustleops.example.com/api/v1/tags/${tagId}?force=true`);
	assert.equal(calls[5].body, undefined);

	assert.equal(calls[6].method, 'POST');
	assert.equal(calls[6].url, 'https://hustleops.example.com/api/v1/tags/bulk-delete');
	assert.deepEqual(calls[6].body, { ids: [tagId, secondTagId], force: true });
});

test('entity tag operations are exposed under core resources', async () => {
	const alertId = '11111111-1111-4111-8111-111111111111';
	const incidentId = '22222222-2222-4222-8222-222222222222';
	const observableId = '33333333-3333-4333-8333-333333333333';
	const tagId = '44444444-4444-4444-8444-444444444444';
	const { calls } = await execute(
		[
			{ resource: 'alert', operation: 'setTags', id: alertId, tagValues: '[]' },
			{
				resource: 'incident',
				operation: 'addTags',
				id: incidentId,
				tagValues: '["phishing","vip"]',
			},
			{ resource: 'observable', operation: 'removeTag', id: observableId, tagId },
		],
		() => ({ ok: true }),
	);

	assert.equal(calls[0].method, 'PUT');
	assert.equal(calls[0].url, `https://hustleops.example.com/api/v1/alerts/${alertId}/tags`);
	assert.deepEqual(calls[0].body, { values: [] });

	assert.equal(calls[1].method, 'POST');
	assert.equal(calls[1].url, `https://hustleops.example.com/api/v1/incidents/${incidentId}/tags`);
	assert.deepEqual(calls[1].body, { values: ['phishing', 'vip'] });

	assert.equal(calls[2].method, 'DELETE');
	assert.equal(
		calls[2].url,
		`https://hustleops.example.com/api/v1/observables/${observableId}/tags/${tagId}`,
	);
	assert.equal(calls[2].body, undefined);
});

test('entity add tags rejects empty values before an API request is sent', async () => {
	const { context, calls } = createContext(
		[
			{
				resource: 'knowledge',
				operation: 'addTags',
				id: '11111111-1111-4111-8111-111111111111',
				tagValues: '[]',
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
				tagBody: JSON.stringify({ ids: [tagId], force: 'false' }),
			},
			{
				resource: 'customField',
				operation: 'bulkUpdateDefinitions',
				customFieldBody: JSON.stringify({ ids: [definitionId], isRequired: 'false' }),
			},
		],
		() => ({ id: 'should-not-run' }),
	);

	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	await assert.rejects(node.execute.call(context), /Tag bulk delete force must be a boolean/);
	assert.equal(calls.length, 0);

	const customFieldOnly = createContext(
		[
			{
				resource: 'customField',
				operation: 'bulkUpdateDefinitions',
				customFieldBody: JSON.stringify({ ids: [definitionId], isRequired: 'false' }),
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

test('admin search operations emit one item per paginated data row', async () => {
	const { result, calls } = await execute(
		[
			{
				resource: 'tag',
				operation: 'search',
				tagBody: '{"pagination":{"page":1,"pageSize":2}}',
			},
			{
				resource: 'customField',
				operation: 'searchDefinitions',
				customFieldBody: '{"pagination":{"page":1,"pageSize":1}}',
			},
		],
		(options) => {
			if (options.url.endsWith('/tags/search')) {
				return {
					data: [{ id: 'tag-1' }, { id: 'tag-2' }],
					total: 2,
					page: 1,
					pageSize: 2,
					totalPages: 1,
				};
			}
			return {
				data: [{ id: 'field-1' }],
				total: 1,
				page: 1,
				pageSize: 1,
				totalPages: 1,
			};
		},
	);

	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags/search');
	assert.equal(
		calls[1].url,
		'https://hustleops.example.com/api/v1/custom-fields/definitions/search',
	);
	assert.deepEqual(
		result[0].map((item) => item.json),
		[{ id: 'tag-1' }, { id: 'tag-2' }, { id: 'field-1' }],
	);
});

test('custom field operations call group, definition, and value endpoints', async () => {
	const groupId = '11111111-1111-4111-8111-111111111111';
	const definitionId = '22222222-2222-4222-8222-222222222222';
	const secondDefinitionId = '33333333-3333-4333-8333-333333333333';
	const alertId = '44444444-4444-4444-8444-444444444444';
	const incidentId = '55555555-5555-4555-8555-555555555555';
	const observableId = '66666666-6666-4666-8666-666666666666';
	const knowledgeId = '77777777-7777-4777-8777-777777777777';
	const { calls } = await execute(
		[
			{ resource: 'customField', operation: 'listGroups' },
			{
				resource: 'customField',
				operation: 'createGroup',
				customFieldBody: '{"name":"Classification","description":"Routing","sortOrder":10}',
			},
			{
				resource: 'customField',
				operation: 'updateGroup',
				customFieldGroupId: groupId,
				customFieldBody: '{"name":"Updated Classification"}',
			},
			{
				resource: 'customField',
				operation: 'deleteGroup',
				customFieldGroupId: groupId,
				force: true,
			},
			{ resource: 'customField', operation: 'listDefinitions' },
			{
				resource: 'customField',
				operation: 'searchDefinitions',
				customFieldBody: '{"pagination":{"page":1,"pageSize":25}}',
			},
			{
				resource: 'customField',
				operation: 'createDefinition',
				customFieldBody: JSON.stringify({
					name: 'Business Unit',
					fieldType: 'SELECT',
					options: ['finance', 'ops'],
					entityTypes: ['ALERT', 'INCIDENT'],
					groupId,
				}),
			},
			{
				resource: 'customField',
				operation: 'updateDefinition',
				customFieldDefinitionId: definitionId,
				customFieldBody: '{"name":"Business Impact","isRequired":true}',
			},
			{
				resource: 'customField',
				operation: 'bulkUpdateDefinitions',
				customFieldBody: JSON.stringify({
					ids: [definitionId, secondDefinitionId],
					isRequired: false,
					groupId,
				}),
			},
			{
				resource: 'customField',
				operation: 'deleteDefinition',
				customFieldDefinitionId: definitionId,
				force: true,
			},
			{
				resource: 'customField',
				operation: 'bulkDeleteDefinitions',
				customFieldBody: JSON.stringify({ ids: [definitionId, secondDefinitionId], force: true }),
			},
			{ resource: 'customField', operation: 'getValues', entityType: 'ALERT', entityId: alertId },
			{
				resource: 'customField',
				operation: 'getAvailable',
				entityType: 'INCIDENT',
				entityId: incidentId,
			},
			{
				resource: 'customField',
				operation: 'batchGetValues',
				entityType: 'OBSERVABLE',
				entityIds: JSON.stringify([observableId]),
			},
			{
				resource: 'customField',
				operation: 'replaceValues',
				entityType: 'KNOWLEDGE',
				entityId: knowledgeId,
				customFieldValues: JSON.stringify([
					{ fieldId: definitionId, value: ['pci', 'sox'], fieldType: 'MULTI_SELECT' },
				]),
			},
		],
		(options) =>
			options.url.endsWith('/custom-fields/definitions/search')
				? {
						data: [{ id: 'definition-search-result' }],
						total: 1,
						page: 1,
						pageSize: 25,
						totalPages: 1,
					}
				: { ok: true },
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/custom-fields/groups');

	assert.equal(calls[1].method, 'POST');
	assert.equal(calls[1].url, 'https://hustleops.example.com/api/v1/custom-fields/groups');
	assert.deepEqual(calls[1].body, {
		name: 'Classification',
		description: 'Routing',
		sortOrder: 10,
	});

	assert.equal(calls[2].method, 'PATCH');
	assert.equal(
		calls[2].url,
		`https://hustleops.example.com/api/v1/custom-fields/groups/${groupId}`,
	);
	assert.deepEqual(calls[2].body, { name: 'Updated Classification' });

	assert.equal(calls[3].method, 'DELETE');
	assert.equal(
		calls[3].url,
		`https://hustleops.example.com/api/v1/custom-fields/groups/${groupId}?force=true`,
	);

	assert.equal(calls[4].method, 'GET');
	assert.equal(calls[4].url, 'https://hustleops.example.com/api/v1/custom-fields/definitions');

	assert.equal(calls[5].method, 'POST');
	assert.equal(
		calls[5].url,
		'https://hustleops.example.com/api/v1/custom-fields/definitions/search',
	);
	assert.deepEqual(calls[5].body, { pagination: { page: 1, pageSize: 25 } });

	assert.equal(calls[6].method, 'POST');
	assert.equal(calls[6].url, 'https://hustleops.example.com/api/v1/custom-fields/definitions');
	assert.deepEqual(calls[6].body, {
		name: 'Business Unit',
		fieldType: 'SELECT',
		options: ['finance', 'ops'],
		entityTypes: ['ALERT', 'INCIDENT'],
		groupId,
	});

	assert.equal(calls[7].method, 'PATCH');
	assert.equal(
		calls[7].url,
		`https://hustleops.example.com/api/v1/custom-fields/definitions/${definitionId}`,
	);
	assert.deepEqual(calls[7].body, { name: 'Business Impact', isRequired: true });

	assert.equal(calls[8].method, 'PATCH');
	assert.equal(calls[8].url, 'https://hustleops.example.com/api/v1/custom-fields/definitions/bulk');
	assert.deepEqual(calls[8].body, {
		ids: [definitionId, secondDefinitionId],
		isRequired: false,
		groupId,
	});

	assert.equal(calls[9].method, 'DELETE');
	assert.equal(
		calls[9].url,
		`https://hustleops.example.com/api/v1/custom-fields/definitions/${definitionId}?force=true`,
	);

	assert.equal(calls[10].method, 'POST');
	assert.equal(
		calls[10].url,
		'https://hustleops.example.com/api/v1/custom-fields/definitions/bulk-delete',
	);
	assert.deepEqual(calls[10].body, { ids: [definitionId, secondDefinitionId], force: true });

	assert.equal(calls[11].method, 'GET');
	assert.equal(
		calls[11].url,
		`https://hustleops.example.com/api/v1/custom-fields/values/ALERT/${alertId}`,
	);

	assert.equal(calls[12].method, 'GET');
	assert.equal(
		calls[12].url,
		`https://hustleops.example.com/api/v1/custom-fields/available/INCIDENT/${incidentId}`,
	);

	assert.equal(calls[13].method, 'POST');
	assert.equal(calls[13].url, 'https://hustleops.example.com/api/v1/custom-fields/values/batch');
	assert.deepEqual(calls[13].body, { entityType: 'OBSERVABLE', entityIds: [observableId] });

	assert.equal(calls[14].method, 'PATCH');
	assert.equal(
		calls[14].url,
		`https://hustleops.example.com/api/v1/custom-fields/values/KNOWLEDGE/${knowledgeId}`,
	);
	assert.deepEqual(calls[14].body, {
		values: [{ fieldId: definitionId, value: '["pci","sox"]' }],
	});
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
				customFieldValues: JSON.stringify([{ fieldId: updatedFieldId, value: 'critical' }]),
			},
		],
		(options) => {
			if (options.method === 'GET') {
				return {
					values: [
						{ fieldId: updatedFieldId, value: 'medium' },
						{ fieldId: preservedFieldId, value: 'owner stays attached' },
					],
				};
			}
			return { updated: true };
		},
	);

	assert.equal(calls[0].method, 'GET');
	assert.equal(
		calls[0].url,
		`https://hustleops.example.com/api/v1/custom-fields/values/INCIDENT/${entityId}`,
	);
	assert.equal(calls[1].method, 'PATCH');
	assert.equal(
		calls[1].url,
		`https://hustleops.example.com/api/v1/custom-fields/values/INCIDENT/${entityId}`,
	);
	assert.deepEqual(calls[1].body, {
		values: [
			{ fieldId: updatedFieldId, value: 'critical' },
			{ fieldId: preservedFieldId, value: 'owner stays attached' },
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
				customFieldBody: '{"fieldType":"BOOLEAN"}',
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
				entityIds: JSON.stringify(ids),
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
