const assert = require('node:assert/strict');
const { test } = require('node:test');

function loadHelpers() {
	return require('../dist/nodes/HustleOps/GenericFunctions.js');
}

test('normalizeBaseUrl accepts HTTPS instance and API URLs', () => {
	const { normalizeBaseUrl } = loadHelpers();

	assert.equal(
		normalizeBaseUrl('https://hustleops.example.com'),
		'https://hustleops.example.com/api/v1',
	);
	assert.equal(
		normalizeBaseUrl('https://hustleops.example.com/api/v1'),
		'https://hustleops.example.com/api/v1',
	);
	assert.equal(
		normalizeBaseUrl('https://hustleops.example.com///'),
		'https://hustleops.example.com/api/v1',
	);
});

test('normalizeBaseUrl permits localhost HTTP and rejects unsafe URLs', () => {
	const { normalizeBaseUrl } = loadHelpers();

	assert.equal(normalizeBaseUrl('http://localhost:3000'), 'http://localhost:3000/api/v1');
	assert.equal(normalizeBaseUrl('http://127.0.0.1:8080/api/v1'), 'http://127.0.0.1:8080/api/v1');
	assert.equal(normalizeBaseUrl('http://[::1]:3000'), 'http://[::1]:3000/api/v1');

	assert.throws(() => normalizeBaseUrl('ftp://hustleops.example.com'), /must use HTTP or HTTPS/);
	assert.throws(() => normalizeBaseUrl('http://hustleops.example.com'), /HTTPS is required/);
	assert.throws(
		() => normalizeBaseUrl('https://user:pass@hustleops.example.com'),
		/embedded credentials/,
	);
	assert.throws(() => normalizeBaseUrl('https://hustleops.example.com?x=1'), /query strings/);
	assert.throws(() => normalizeBaseUrl('https://hustleops.example.com#fragment'), /fragments/);
});

test('compactObject removes undefined recursively and preserves supported nulls', () => {
	const { compactObject } = loadHelpers();

	assert.deepEqual(
		compactObject({
			a: undefined,
			b: null,
			c: 'value',
			d: { keep: true, drop: undefined },
			e: [1, undefined, { nested: undefined, ok: 'yes' }],
		}),
		{
			b: null,
			c: 'value',
			d: { keep: true },
			e: [1, { ok: 'yes' }],
		},
	);
});

test('hustleOpsApiRequest sends x-api-key, JSON headers, normalized URL, and request id', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const calls = [];
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async (options) => {
				calls.push(options);
				return { ok: true };
			},
		},
	};

	const result = await hustleOpsApiRequest(
		context,
		'POST',
		'/alerts/search',
		{ filter: undefined },
		0,
	);

	assert.deepEqual(result, { ok: true });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/alerts/search');
	assert.equal(calls[0].headers['x-api-key'], 'fixture-api-key');
	assert.equal(calls[0].headers.Accept, 'application/json');
	assert.equal(calls[0].headers['Content-Type'], 'application/json');
	assert.match(calls[0].headers['x-request-id'], /^hustleops-n8n-/);
	assert.deepEqual(calls[0].body, {});
	assert.equal(calls[0].json, true);
	assert.equal(calls[0].skipSslCertificateValidation, undefined);
});

test('hustleOpsApiRequest can skip SSL certificate validation when credentials allow it', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const calls = [];
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			ignoreSslIssues: true,
		}),
		helpers: {
			httpRequest: async (options) => {
				calls.push(options);
				return { ok: true };
			},
		},
	};

	await hustleOpsApiRequest(context, 'GET', '/tags', undefined, 0);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags');
	assert.equal(calls[0].skipSslCertificateValidation, true);
});

test('hustleOpsApiRequest maps HustleOps error bodies into node errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async () => {
				const error = new Error('request failed');
				error.response = {
					statusCode: 409,
					body: {
						statusCode: 409,
						message: 'This record was modified by another user. Refresh and try again.',
						path: '/api/v1/alerts/abc',
						requestId: 'req-123',
					},
				};
				throw error;
			},
		},
	};

	await assert.rejects(
		hustleOpsApiRequest(context, 'PATCH', '/alerts/abc', { version: 1 }, 0),
		/HustleOps API error 409.*This record was modified.*req-123.*\/api\/v1\/alerts\/abc/,
	);
});

test('hustleOpsApiRequest redacts secrets from surfaced errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async () => {
				const error = new Error(
					'Authorization: Bearer fixture-token x-api-key=fixture-api-key token=abc123 password=s3cr3t',
				);
				error.response = {
					statusCode: 401,
					body: {
						statusCode: 401,
						message: 'Bad x-api-key fixture-api-key',
						path: '/api/v1/tags',
						requestId: 'req-401',
					},
				};
				throw error;
			},
		},
	};

	await assert.rejects(hustleOpsApiRequest(context, 'GET', '/tags', undefined, 0), (error) => {
		assert.match(error.message, /HustleOps API error 401/);
		assert.doesNotMatch(error.message, /fixture-api-key/);
		assert.doesNotMatch(error.message, /Bearer\s+\S+/);
		assert.doesNotMatch(error.message, /password=s3cr3t/);
		return true;
	});
});

test('hustleOpsApiRequest appends encoded query parameters and omits empty values', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const calls = [];
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async (options) => {
				calls.push(options);
				return { items: [], nextCursor: null };
			},
		},
	};

	await hustleOpsApiRequest(context, 'GET', '/comments', undefined, 0, {
		entityType: 'ALERT',
		entityId: '11111111-1111-4111-8111-111111111111',
		q: 'failed login',
		cursor: '',
		take: 50,
	});

	assert.equal(
		calls[0].url,
		'https://hustleops.example.com/api/v1/comments?entityType=ALERT&entityId=11111111-1111-4111-8111-111111111111&q=failed+login&take=50',
	);
	assert.equal(calls[0].method, 'GET');
	assert.equal(calls[0].body, undefined);
	assert.equal(calls[0].headers['Content-Type'], undefined);
});

test('hustleOpsApiRequest redacts query strings from surfaced API errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async () => {
				const error = new Error(
					'GET /api/v1/comments/search?entityType=ALERT&q=secret-search-text failed',
				);
				error.response = {
					statusCode: 400,
					body: {
						statusCode: 400,
						message: 'Invalid search',
						path: '/api/v1/comments/search?entityType=ALERT&q=secret-search-text',
						requestId: 'req-comment-search',
					},
				};
				throw error;
			},
		},
	};

	await assert.rejects(
		hustleOpsApiRequest(context, 'GET', '/comments/search', undefined, 0, {
			entityType: 'ALERT',
			entityId: '11111111-1111-4111-8111-111111111111',
			q: 'secret-search-text',
		}),
		(error) => {
			assert.match(error.message, /HustleOps API error 400/);
			assert.match(error.message, /requestId=req-comment-search/);
			assert.match(error.message, /\/api\/v1\/comments\/search\?\[REDACTED\]/);
			assert.doesNotMatch(error.message, /secret-search-text/);
			return true;
		},
	);
});

test('safePathSegment accepts UUIDs and rejects unsafe path segments', () => {
	const { safePathSegment } = loadHelpers();
	const id = '11111111-1111-4111-8111-111111111111';

	assert.equal(safePathSegment(id, 'Alert ID'), id);
	assert.throws(() => safePathSegment('../users', 'Alert ID'), /Alert ID must be a valid UUID/);
	assert.throws(
		() => safePathSegment('abc/linked-alerts', 'Alert ID'),
		/Alert ID must be a valid UUID/,
	);
	assert.throws(() => safePathSegment('id?x=1', 'Alert ID'), /Alert ID must be a valid UUID/);
});

test('hustleOpsApiRequestEachPage streams pages and honors maxItems', async () => {
	const { hustleOpsApiRequestEachPage } = loadHelpers();
	const calls = [];
	const rows = [];
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		helpers: {
			httpRequest: async (options) => {
				calls.push(options.body.pagination.page);
				return {
					data: [{ page: options.body.pagination.page }],
					total: 3,
					page: options.body.pagination.page,
					pageSize: 1,
					totalPages: 3,
				};
			},
		},
	};

	await hustleOpsApiRequestEachPage(
		context,
		'/alerts/search',
		{
			pagination: { page: 1, pageSize: 1, sortBy: 'detectedAt', sortOrder: 'desc' },
		},
		0,
		{ maxItems: 2 },
		(row) => {
			rows.push(row);
		},
	);

	assert.deepEqual(calls, [1, 2]);
	assert.deepEqual(rows, [{ page: 1 }, { page: 2 }]);
});

test('assertPaginatedResponse rejects malformed paginated responses', () => {
	const { assertPaginatedResponse } = loadHelpers();

	assert.throws(
		() =>
			assertPaginatedResponse(
				{ data: {}, total: 1, page: 1, pageSize: 25, totalPages: 1 },
				'Alert search response',
			),
		/Alert search response must include a data array/,
	);
	assert.throws(
		() =>
			assertPaginatedResponse(
				{ data: [], total: 1, page: 1, pageSize: 25 },
				'Alert search response',
			),
		/Alert search response must include integer totalPages/,
	);
});

test('core resource definitions expose API paths and default search sorts', () => {
	const { CORE_RESOURCE_DEFINITIONS } = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.equal(CORE_RESOURCE_DEFINITIONS.alert.path, '/alerts');
	assert.equal(CORE_RESOURCE_DEFINITIONS.alert.defaultSortBy, 'detectedAt');
	assert.equal(CORE_RESOURCE_DEFINITIONS.incident.path, '/incidents');
	assert.equal(CORE_RESOURCE_DEFINITIONS.incident.defaultSortBy, 'createdAt');
	assert.equal(CORE_RESOURCE_DEFINITIONS.observable.path, '/observables');
	assert.equal(CORE_RESOURCE_DEFINITIONS.observable.defaultSortBy, 'lastSeen');
	assert.equal(CORE_RESOURCE_DEFINITIONS.knowledge.path, '/knowledge');
	assert.equal(CORE_RESOURCE_DEFINITIONS.knowledge.defaultSortBy, 'createdAt');
});

test('sanitizeDtoBody rejects unknown fields and strips undefined values', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		sanitizeDtoBody,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.deepEqual(
		sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
			name: 'Suspicious login',
			description: 'Okta anomaly',
			severity: 'HIGH',
			tlp: 'AMBER',
			source: 'okta',
			type: 'identity',
			sourceRef: 'evt_1',
			detectedAt: '2026-06-28T12:00:00.000Z',
			tags: undefined,
		}),
		{
			name: 'Suspicious login',
			description: 'Okta anomaly',
			severity: 'HIGH',
			tlp: 'AMBER',
			source: 'okta',
			type: 'identity',
			sourceRef: 'evt_1',
			detectedAt: '2026-06-28T12:00:00.000Z',
		},
	);

	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				name: 'x',
				createdById: 'user-1',
			}),
		/Unsupported Alert create field: createdById/,
	);
	assert.throws(
		() => sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.incident, 'update', { source: 'okta' }),
		/Unsupported Incident update field: source/,
	);
});

test('sanitizeDtoBody accepts all API-supported severity and TLP enum values', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		sanitizeDtoBody,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.equal(
		sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
			name: 'Informational alert',
			description: 'Routine informational event',
			severity: 'INFO',
			tlp: 'AMBER_STRICT',
			source: 'okta',
			type: 'identity',
			sourceRef: 'evt-info-1',
			detectedAt: '2026-06-28T12:00:00.000Z',
		}).severity,
		'INFO',
	);
	assert.equal(
		sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.incident, 'create', {
			name: 'Strict sharing incident',
			description: 'Incident with strict sharing requirements',
			severity: 'INFO',
			tlp: 'AMBER_STRICT',
			category: 'access',
		}).tlp,
		'AMBER_STRICT',
	);
	assert.equal(
		sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.observable, 'create', {
			value: '198.51.100.10',
			type: 'ip',
			threatLevel: 'UNKNOWN',
			tlp: 'AMBER_STRICT',
			firstSeen: '2026-06-28T12:00:00.000Z',
			lastSeen: '2026-06-28T12:00:00.000Z',
		}).tlp,
		'AMBER_STRICT',
	);
	assert.equal(
		sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.knowledge, 'create', {
			value: 'Escalation runbook',
			type: 'runbook',
			tlp: 'AMBER_STRICT',
		}).tlp,
		'AMBER_STRICT',
	);
});

test('buildSearchRequest defaults pagination and validates sort fields', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		buildSearchRequest,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.deepEqual(buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {}), {
		pagination: {
			page: 1,
			pageSize: 25,
			sortBy: 'detectedAt',
			sortOrder: 'desc',
		},
	});

	assert.deepEqual(
		buildSearchRequest(CORE_RESOURCE_DEFINITIONS.incident, {
			filter: {
				operator: 'AND',
				groups: [
					{
						operator: 'AND',
						conditions: [{ field: 'severity', operator: 'eq', value: 'HIGH' }],
					},
				],
			},
			pagination: { sortBy: 'createdAt', sortOrder: 'asc' },
		}),
		{
			filter: {
				operator: 'AND',
				groups: [
					{
						operator: 'AND',
						conditions: [{ field: 'severity', operator: 'eq', value: 'HIGH' }],
					},
				],
			},
			pagination: {
				page: 1,
				pageSize: 25,
				sortBy: 'createdAt',
				sortOrder: 'asc',
			},
		},
	);

	assert.equal(
		buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
			pagination: { sortBy: 'displayId' },
		}).pagination.sortBy,
		'displayId',
	);

	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.knowledge, {
				pagination: { sortBy: 'severity' },
			}),
		/Unsupported Knowledge search sort field: severity/,
	);
});

test('sanitizeDtoBody enforces required create fields and rejects empty updates', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		sanitizeDtoBody,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.throws(
		() => sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', { name: 'x' }),
		/Missing required Alert create field: description/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.incident, 'create', {
				name: 'x',
				description: 'x',
				severity: 'HIGH',
				tlp: 'AMBER',
			}),
		/Missing required Incident create field: category/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.observable, 'create', {
				value: '198.51.100.10',
				type: 'ip',
			}),
		/Missing required Observable create field: threatLevel/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.knowledge, 'create', {
				value: 'Runbook',
				type: 'runbook',
			}),
		/Missing required Knowledge create field: tlp/,
	);
	assert.throws(
		() => sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.knowledge, 'update', {}),
		/Knowledge update body must include at least one supported field/,
	);
});

test('buildSearchRequest rejects unknown top-level keys, invalid pagination, and unsafe filter size', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		buildSearchRequest,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.throws(
		() => buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, { where: {} }),
		/Unsupported Alert search request field: where/,
	);
	assert.throws(
		() => buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, { pagination: { page: 0 } }),
		/Alert search pagination.page must be between 1 and 10000/,
	);
	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				filter: {
					operator: 'AND',
					groups: new Array(21).fill({
						operator: 'AND',
						conditions: [{ field: 'severity', operator: 'eq', value: 'HIGH' }],
					}),
				},
			}),
		/Alert search filter cannot contain more than 20 groups/,
	);
	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				filter: { operator: 'AND', groups: [] },
			}),
		/Alert search filter must contain at least one group/,
	);
	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				filter: {
					operator: 'AND',
					groups: [
						{
							operator: 'AND',
							conditions: [{ field: 'severity', operator: 'endsWith', value: 'HIGH' }],
						},
					],
				},
			}),
		/Unsupported Alert search operator: endsWith/,
	);
	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				filter: {
					operator: 'AND',
					groups: [
						{
							operator: 'AND',
							conditions: [{ field: 'severity', operator: 'in', value: 'HIGH' }],
						},
					],
				},
			}),
		/Alert search operator in requires an array value/,
	);
	assert.throws(
		() =>
			buildSearchRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				excludeIds: ['../users'],
			}),
		/Alert search excludeIds must contain valid UUIDs/,
	);
});

test('comment helpers build entity queries and sanitize comment bodies', () => {
	const {
		buildCommentEntityQuery,
		buildCommentSearchQuery,
		parseCommentMaxResults,
		sanitizeCreateComment,
		sanitizeUpdateComment,
		sanitizeToggleReaction,
	} = require('../dist/nodes/HustleOps/commentDefinitions.js');
	const context = { getNode: () => ({ name: 'HustleOps' }) };
	const entityId = '11111111-1111-4111-8111-111111111111';
	const parentId = '22222222-2222-4222-8222-222222222222';
	const attachmentId = '33333333-3333-4333-8333-333333333333';

	assert.deepEqual(
		buildCommentEntityQuery(
			context,
			{ entityType: 'ALERT', entityId, take: 25, cursor: parentId },
			0,
		),
		{ entityType: 'ALERT', entityId, take: 25, cursor: parentId },
	);

	assert.deepEqual(
		sanitizeCreateComment(
			context,
			{
				entityType: 'INCIDENT',
				entityId,
			},
			{
				content: 'Escalating for review',
				parentId,
				attachmentIds: [attachmentId],
			},
			0,
		),
		{
			entityType: 'INCIDENT',
			entityId,
			content: 'Escalating for review',
			parentId,
			attachmentIds: [attachmentId],
		},
	);

	assert.deepEqual(sanitizeUpdateComment(context, { content: 'Updated note' }, 0), {
		content: 'Updated note',
	});
	assert.deepEqual(sanitizeToggleReaction(context, { emoji: 'OK' }, 0), { emoji: 'OK' });
	assert.deepEqual(
		buildCommentSearchQuery(context, { entityType: 'INCIDENT', entityId, q: 'timeline' }, 0),
		{ entityType: 'INCIDENT', entityId, q: 'timeline' },
	);
	assert.equal(parseCommentMaxResults(context, 25, 0), 25);
});

test('comment helpers reject invalid comment inputs before requests', () => {
	const {
		buildCommentEntityQuery,
		buildCommentSearchQuery,
		sanitizeCreateComment,
		sanitizeUpdateComment,
		sanitizeToggleReaction,
	} = require('../dist/nodes/HustleOps/commentDefinitions.js');
	const context = { getNode: () => ({ name: 'HustleOps' }) };
	const entityId = '11111111-1111-4111-8111-111111111111';

	assert.throws(
		() => buildCommentEntityQuery(context, { entityType: 'USER', entityId }, 0),
		/Comment entity type must be one of: ALERT, INCIDENT, OBSERVABLE, KNOWLEDGE/,
	);
	assert.throws(
		() => buildCommentEntityQuery(context, { entityType: 'ALERT', entityId, take: 101 }, 0),
		/Comment take must be between 1 and 100/,
	);
	assert.throws(
		() => sanitizeCreateComment(context, { entityType: 'ALERT', entityId }, {}, 0),
		/Comment create requires content or attachmentIds/,
	);
	assert.throws(
		() =>
			sanitizeCreateComment(
				context,
				{
					entityType: 'ALERT',
					entityId,
				},
				{
					attachmentIds: [
						'11111111-1111-4111-8111-111111111111',
						'22222222-2222-4222-8222-222222222222',
						'33333333-3333-4333-8333-333333333333',
						'44444444-4444-4444-8444-444444444444',
					],
				},
				0,
			),
		/Comment attachmentIds cannot contain more than 3 IDs/,
	);
	assert.throws(
		() => sanitizeUpdateComment(context, { content: '' }, 0),
		/Comment content is required/,
	);
	assert.throws(
		() => sanitizeToggleReaction(context, { emoji: '12345678901234567' }, 0),
		/Comment emoji cannot exceed 16 characters/,
	);
	assert.throws(
		() =>
			sanitizeCreateComment(
				context,
				{ entityType: 'ALERT', entityId },
				{ content: 'x', userId: 'u1' },
				0,
			),
		/Unsupported Comment create body field: userId/,
	);
	assert.throws(
		() => sanitizeUpdateComment(context, { content: 'x', entityId }, 0),
		/Unsupported Comment update field: entityId/,
	);
	assert.throws(
		() =>
			buildCommentSearchQuery(context, { entityType: 'ALERT', entityId, q: 'x'.repeat(501) }, 0),
		/Comment search query cannot exceed 500 characters/,
	);
});

test('credential test reports authenticated endpoint failures without leaking the key', async () => {
	const { testHustleOpsApiCredentials } = loadHelpers();
	const calls = [];
	const context = {
		helpers: {
			httpRequest: async () => {
				calls.push('httpRequest');
				const error = new Error('x-api-key=fixture-api-key');
				error.response = {
					statusCode: 401,
					body: { statusCode: 401, message: 'Bad x-api-key fixture-api-key' },
				};
				throw error;
			},
		},
	};

	await assert.rejects(
		testHustleOpsApiCredentials(context, {
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
		}),
		(error) => {
			assert.match(error.message, /HustleOps API error 401/);
			assert.doesNotMatch(error.message, /fixture-api-key/);
			return true;
		},
	);
	assert.deepEqual(calls, ['httpRequest']);
});

test('credential test can skip SSL certificate validation when credentials allow it', async () => {
	const { testHustleOpsApiCredentials } = loadHelpers();
	const calls = [];
	const context = {
		helpers: {
			httpRequest: async (options) => {
				calls.push(options);
				return { ok: true };
			},
		},
	};

	await testHustleOpsApiCredentials(context, {
		baseUrl: 'https://hustleops.example.com',
		apiKey: 'fixture-api-key',
		ignoreSslIssues: true,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags');
	assert.equal(calls[0].skipSslCertificateValidation, true);
});

test('credential test can use legacy request helper when httpRequest is unavailable', async () => {
	const { testHustleOpsApiCredentials } = loadHelpers();
	const calls = [];
	const context = {
		helpers: {
			request: async (options) => {
				calls.push(options.url);
				return { ok: true };
			},
		},
	};

	await testHustleOpsApiCredentials(context, {
		baseUrl: 'https://hustleops.example.com',
		apiKey: 'fixture-api-key',
	});

	assert.deepEqual(calls, ['https://hustleops.example.com/api/v1/tags']);
});
