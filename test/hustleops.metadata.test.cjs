const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const STUB_MESSAGE = 'HustleOps API execution is not active in this metadata-first version.';

test('HustleOps API credentials expose base URL and API key fields', () => {
	const { HustleOpsApi } = require('../dist/credentials/HustleOpsApi.credentials.js');
	const credentials = new HustleOpsApi();

	assert.equal(credentials.name, 'hustleOpsApi');
	assert.equal(credentials.displayName, 'HustleOps API');
	assert.deepEqual(credentials.icon, {
		light: 'file:../nodes/HustleOps/hustleops.svg',
		dark: 'file:../nodes/HustleOps/hustleops.dark.svg',
	});

	const baseUrl = credentials.properties.find((property) => property.name === 'baseUrl');
	const apiKey = credentials.properties.find((property) => property.name === 'apiKey');

	assert.equal(baseUrl.displayName, 'Base URL');
	assert.equal(baseUrl.type, 'string');
	assert.equal(baseUrl.required, true);
	assert.match(baseUrl.description, /HTTPS HustleOps instance URL/);

	assert.equal(apiKey.displayName, 'API Key');
	assert.equal(apiKey.type, 'string');
	assert.equal(apiKey.required, true);
	assert.equal(apiKey.typeOptions.password, true);

	assert.deepEqual(credentials.authenticate, {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	});
});

function getNodeDescription() {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	return new HustleOps().description;
}

function getProperty(description, name) {
	const property = description.properties.find((candidate) => candidate.name === name);
	assert.ok(property, `Expected property ${name} to exist`);
	return property;
}

async function executeNode(parametersByItem) {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();

	return node.execute.call({
		getInputData: () => parametersByItem.map((_, index) => ({ json: { item: index } })),
		getNode: () => ({ name: 'HustleOps', type: 'hustleOps' }),
		getNodeParameter: (name, itemIndex, defaultValue) => {
			const value = parametersByItem[itemIndex][name];
			return value === undefined ? defaultValue : value;
		},
		continueOnFail: () => false,
	});
}

test('HustleOps node exposes the incident-response resources', () => {
	const description = getNodeDescription();
	const resource = getProperty(description, 'resource');

	assert.equal(description.displayName, 'HustleOps');
	assert.equal(description.name, 'hustleOps');
	assert.deepEqual(description.credentials, [
		{ name: 'hustleOpsApi', required: true, testedBy: 'hustleOps' },
	]);
	assert.deepEqual(
		resource.options.map((option) => option.value),
		['alert', 'incident', 'observable', 'knowledge'],
	);
});

test('HustleOps node exposes create, update, get, and list operations', () => {
	const description = getNodeDescription();
	const operation = getProperty(description, 'operation');

	assert.equal(operation.default, 'list');
	assert.deepEqual(
		operation.options.map((option) => option.value),
		['create', 'update', 'get', 'list'],
	);
});

test('HustleOps node exposes generic fields for metadata-first operations', () => {
	const description = getNodeDescription();
	const id = getProperty(description, 'id');
	const body = getProperty(description, 'body');
	const filters = getProperty(description, 'filters');
	const notice = getProperty(description, 'metadataFirstNotice');

	assert.equal(notice.type, 'notice');
	assert.match(notice.default, /metadata-first/i);

	assert.equal(id.required, true);
	assert.deepEqual(id.displayOptions.show.operation, ['get', 'update']);

	assert.equal(body.type, 'json');
	assert.equal(body.default, '');
	assert.equal(body.required, true);
	assert.match(body.placeholder, /title/);
	assert.deepEqual(body.displayOptions.show.operation, ['create', 'update']);

	assert.equal(filters.type, 'json');
	assert.deepEqual(filters.displayOptions.show.operation, ['list']);
});

test('HustleOps node codex metadata is present', () => {
	const codex = require('../dist/nodes/HustleOps/HustleOps.node.json');

	assert.equal(codex.node, '@hustleops/n8n-nodes-hustleops');
	assert.equal(codex.nodeVersion, '1.0');
	assert.equal(codex.codexVersion, '1.0');
	assert.equal(codex.categories.includes('Development'), true);
	assert.equal(codex.categories.includes('Security'), true);
});

test('HustleOps create execution returns explicit redacted stub data', async () => {
	const result = await executeNode([
		{
			resource: 'incident',
			operation: 'create',
			body: JSON.stringify({
				title: 'Test incident',
				apiKey: 'secret-key',
				note: 'Authorization: Bearer secret-token',
				nested: { token: 'secret-token' },
				observables: [{ value: '1.2.3.4', password: 'secret-password' }],
			}),
		},
	]);

	assert.equal(result.length, 1);
	assert.equal(result[0].length, 1);
	assert.equal(result[0][0].json.message, STUB_MESSAGE);
	assert.equal(result[0][0].json.resource, 'incident');
	assert.equal(result[0][0].json.operation, 'create');
	assert.deepEqual(result[0][0].json.parameters.body, {
		title: 'Test incident',
		apiKey: '[redacted]',
		note: '[redacted]',
		nested: { token: '[redacted]' },
		observables: [{ value: '1.2.3.4', password: '[redacted]' }],
	});
	assert.deepEqual(result[0][0].pairedItem, { item: 0 });
});

test('HustleOps get, update, and list executions include operation-specific parameters', async () => {
	const result = await executeNode([
		{ resource: 'alert', operation: 'get', id: 'alert-123' },
		{
			resource: 'incident',
			operation: 'update',
			id: 'incident-456',
			body: '{"status":"contained","secret":"case-secret"}',
		},
		{
			resource: 'observable',
			operation: 'list',
			filters: '{"type":"ip","authorization":"Bearer secret"}',
		},
	]);

	assert.equal(result[0].length, 3);
	assert.deepEqual(result[0][0].json.parameters, { id: '[provided]' });
	assert.deepEqual(result[0][1].json.parameters, {
		id: '[provided]',
		body: { status: 'contained', secret: '[redacted]' },
	});
	assert.deepEqual(result[0][2].json.parameters, {
		filters: { type: 'ip', authorization: '[redacted]' },
	});
});

test('HustleOps node reports invalid JSON with field-specific errors', async () => {
	await assert.rejects(
		executeNode([{ resource: 'incident', operation: 'create', body: '{"title":' }]),
		/Body must be valid JSON/,
	);

	await assert.rejects(
		executeNode([{ resource: 'observable', operation: 'list', filters: '{"type":' }]),
		/Filters must be valid JSON/,
	);
});

test('HustleOps node rejects empty create and update bodies', async () => {
	await assert.rejects(
		executeNode([{ resource: 'incident', operation: 'create', body: '' }]),
		/Body is required for Create and Update/,
	);

	await assert.rejects(
		executeNode([{ resource: 'incident', operation: 'update', id: 'incident-456', body: '' }]),
		/Body is required for Create and Update/,
	);
});

test('HustleOps stub output bounds large parameter previews', async () => {
	const result = await executeNode([
		{
			resource: 'observable',
			operation: 'list',
			filters: JSON.stringify({
				values: Array.from({ length: 25 }, (_, index) => `value-${index}`),
				nested: { note: 'token=super-secret' },
			}),
		},
	]);

	assert.equal(result[0][0].json.parameters.filters.values.truncated, true);
	assert.equal(result[0][0].json.parameters.filters.values.omittedItems, 5);
	assert.equal(result[0][0].json.parameters.filters.nested.note, '[redacted]');
});

test('HustleOps node source does not call network helpers', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '..', 'nodes', 'HustleOps', 'HustleOps.node.ts'),
		'utf8',
	);

	const forbiddenPatterns = [
		/httpRequest/,
		/requestWithAuthentication/,
		/this\.helpers\.request/,
		/fetch\(/,
		/axios/,
		/got\(/,
		/undici/,
		/node:http/,
		/node:https/,
		/node:net/,
		/node:tls/,
		/node:dns/,
		/XMLHttpRequest/,
		/WebSocket/,
	];

	for (const pattern of forbiddenPatterns) {
		assert.equal(pattern.test(source), false, `Unexpected network surface: ${pattern}`);
	}

	assert.equal(/from ['"](?!n8n-workflow)/.test(source), false);
});

test('package.json registers the compiled HustleOps node and credentials', () => {
	const packageJson = require('../package.json');

	assert.equal(packageJson.name, '@hustleops/n8n-nodes-hustleops');
	assert.equal(packageJson.private, true);
	assert.equal(packageJson.license, 'MIT');
	assert.deepEqual(packageJson.author, {
		name: 'Dmytro Kosiuk',
		email: 'misterr.minister@gmail.com',
	});
	assert.equal(packageJson.keywords.includes('n8n-community-node-package'), true);
	assert.equal(packageJson.n8n.n8nNodesApiVersion, 1);
	assert.equal(packageJson.n8n.strict, true);
	assert.equal(packageJson.scripts.build, 'n8n-node build');
	assert.equal(packageJson.scripts.dev, 'n8n-node dev');
	assert.equal(packageJson.scripts.format, 'prettier --write .');
	assert.equal(packageJson.scripts['test:unit'], 'node --test test/*.test.cjs');
	assert.equal(packageJson.scripts.release, undefined);
	assert.equal(packageJson.scripts.prepublishOnly, undefined);
	assert.equal(packageJson.devDependencies['@n8n/node-cli'], '0.36.1');
	assert.equal(packageJson.devDependencies['release-it'], undefined);
	assert.equal(packageJson.overrides, undefined);
	assert.equal(packageJson.peerDependencies['n8n-workflow'], '*');
	assert.deepEqual(packageJson.n8n.credentials, ['dist/credentials/HustleOpsApi.credentials.js']);
	assert.deepEqual(packageJson.n8n.nodes, ['dist/nodes/HustleOps/HustleOps.node.js']);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml')),
		false,
	);
});

test('README states that real HustleOps API calls are not active in this version', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

	assert.match(readme, /metadata-first/i);
	assert.match(readme, /does not call the HustleOps API/i);
	assert.match(readme, /Base URL/i);
	assert.match(readme, /HTTPS/i);
	assert.match(readme, /API Key/i);
	assert.match(readme, /npm run dev/i);
	assert.match(readme, /redacted/i);
	assert.match(readme, /not published/i);
	assert.match(readme, /local review/i);
	assert.match(readme, /does not validate or send/i);
});
