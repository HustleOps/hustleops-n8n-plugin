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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
	assert.match(calls[0].headers['x-request-id'], /^[0-9a-f-]{36}$/);
	assert.equal(calls[0].headers['X-Organization-Id'], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

test('hustleOpsApiRequest maps stringified HustleOps error bodies into node errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		}),
		helpers: {
			httpRequest: async () => {
				const error = new Error('Request failed with status code 400');
				error.response = {
					statusCode: 400,
					body: JSON.stringify({
						statusCode: 400,
						message: ['Invalid value "identity" for picklist "alertType"'],
						path: '/api/v1/alerts',
						requestId: 'req-alert-picklist',
					}),
				};
				throw error;
			},
		},
	};

	await assert.rejects(
		hustleOpsApiRequest(context, 'POST', '/alerts', { type: 'identity' }, 0),
		/HustleOps API error 400.*Invalid value "identity" for picklist "alertType".*req-alert-picklist.*\/api\/v1\/alerts/,
	);
});

test('hustleOpsApiRequest maps response data error bodies into node errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		}),
		helpers: {
			httpRequest: async () => {
				const error = new Error('Request failed with status code 400');
				error.response = {
					status: 400,
					data: {
						statusCode: 400,
						message: ['Invalid value "identity" for picklist "alertType"'],
						path: '/api/v1/alerts',
						requestId: 'req-alert-picklist',
					},
				};
				throw error;
			},
		},
	};

	await assert.rejects(
		hustleOpsApiRequest(context, 'POST', '/alerts', { type: 'identity' }, 0),
		/HustleOps API error 400.*Invalid value "identity" for picklist "alertType".*req-alert-picklist.*\/api\/v1\/alerts/,
	);
});

test('hustleOpsApiRequest redacts secrets from surfaced errors', async () => {
	const { hustleOpsApiRequest } = loadHelpers();
	const context = {
		getNode: () => ({ name: 'HustleOps' }),
		getCredentials: async () => ({
			baseUrl: 'https://hustleops.example.com',
			apiKey: 'fixture-api-key',
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		}),
		helpers: {
			httpRequest: async (options) => {
				calls.push(options.body.page);
				return {
					data: [{ page: options.body.page }],
					filteredCount: 3,
					page: options.body.page,
					limit: 1,
					totalPages: 3,
				};
			},
		},
	};

	await hustleOpsApiRequestEachPage(
		context,
		'/alerts/search',
		{
			page: 1,
			limit: 1,
			sort: '-detectedAt',
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
		() => assertPaginatedResponse({ data: {}, page: 1, limit: 25 }, 'Alert search response'),
		/Alert search response must include a data array/,
	);
	assert.throws(
		() =>
			assertPaginatedResponse(
				{ data: [], page: 1, limit: 25, totalPages: 'invalid' },
				'Alert search response',
			),
		/Alert search response must include a valid integer totalPages/,
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
			type: 'authentication',
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
			type: 'authentication',
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

test('sanitizeDtoBody mirrors alert create DTO string constraints', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		sanitizeDtoBody,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');
	const validAlertCreate = {
		name: 'Suspicious login',
		description: 'Okta anomaly',
		severity: 'HIGH',
		tlp: 'AMBER',
		source: 'okta',
		type: 'authentication',
		sourceRef: 'evt_1',
		detectedAt: '2026-06-28T12:00:00.000Z',
	};

	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				...validAlertCreate,
				source: 'okta source',
			}),
		/Alert field source may only contain letters, digits, colons, hyphens, and underscores/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				...validAlertCreate,
				source: 'x'.repeat(51),
			}),
		/Alert field source cannot exceed 50 characters/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				...validAlertCreate,
				sourceRef: 'x'.repeat(256),
			}),
		/Alert field sourceRef cannot exceed 255 characters/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				...validAlertCreate,
				alertRefUrl: 'ftp://okta.example.com/events/evt_1',
			}),
		/Alert field alertRefUrl must be a valid HTTP or HTTPS URL/,
	);
	assert.throws(
		() =>
			sanitizeDtoBody(CORE_RESOURCE_DEFINITIONS.alert, 'create', {
				...validAlertCreate,
				status: '',
			}),
		/Alert field status cannot be empty when provided/,
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
			type: 'authentication',
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

test('buildCollectionRequest translates legacy pagination and filters into current selectors', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		buildCollectionRequest,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');
	const definition = CORE_RESOURCE_DEFINITIONS.incident;
	const expression = {
		operator: 'AND',
		groups: [
			{ operator: 'AND', conditions: [{ field: 'severity', operator: 'eq', value: 'HIGH' }] },
		],
	};

	assert.deepEqual(buildCollectionRequest(definition, {}), {});
	assert.deepEqual(
		buildCollectionRequest(definition, {
			filter: expression,
			pagination: { page: 2, pageSize: 25, sortBy: 'createdAt', sortOrder: 'desc' },
		}),
		{ filter: { expression }, page: 2, limit: 25, sort: '-createdAt' },
	);
	assert.deepEqual(
		buildCollectionRequest(definition, {
			filter: { query: 'incident' },
			fields: ['id', 'version'],
			include: ['filteredCount'],
		}),
		{ filter: { query: 'incident' }, fields: ['id', 'version'], include: ['filteredCount'] },
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

test('buildCollectionRequest rejects unknown top-level keys, invalid pagination, and unsafe filter size', () => {
	const {
		CORE_RESOURCE_DEFINITIONS,
		buildCollectionRequest,
	} = require('../dist/nodes/HustleOps/resourceDefinitions.js');

	assert.throws(
		() => buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, { where: {} }),
		/Unsupported Alert collection request field: where/,
	);
	assert.throws(
		() => buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, { pagination: { page: 0 } }),
		/Collection page must be an integer between 1 and 10000/,
	);
	assert.throws(
		() =>
			buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, {
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
			buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				filter: { operator: 'AND', groups: [] },
			}),
		/Alert search filter must contain at least one group/,
	);
	assert.throws(
		() =>
			buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, {
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
			buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, {
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
			buildCollectionRequest(CORE_RESOURCE_DEFINITIONS.alert, {
				excludeIds: ['../users'],
			}),
		/no longer supports Exclude IDs/,
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
			organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
		organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		ignoreSslIssues: true,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://hustleops.example.com/api/v1/tags/auxiliary/list?limit=1');
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
		organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
	});

	assert.deepEqual(calls, ['https://hustleops.example.com/api/v1/tags/auxiliary/list?limit=1']);
});

test('collection query serialization encodes only supported query controls', () => {
	const { collectionQueryParams } = loadHelpers();
	const filter = { query: 'tier & status' };
	const query = collectionQueryParams({
		page: 2,
		limit: 10,
		sort: '-value',
		fields: ['id', 'version'],
		include: ['itemsTotal', 'filteredCount'],
		filter,
	});
	assert.deepEqual(query, {
		page: 2,
		limit: 10,
		sort: '-value',
		fields: 'id,version',
		include: 'itemsTotal,filteredCount',
		filter: JSON.stringify(filter),
	});
});
