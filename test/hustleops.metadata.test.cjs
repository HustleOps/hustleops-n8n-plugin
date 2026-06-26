const assert = require('node:assert/strict');
const { test } = require('node:test');

test('HustleOps API credentials expose base URL and API key fields', () => {
	const { HustleOpsApi } = require('../dist/credentials/HustleOpsApi.credentials.js');
	const credentials = new HustleOpsApi();

	assert.equal(credentials.name, 'hustleOpsApi');
	assert.equal(credentials.displayName, 'HustleOps API');

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

test('HustleOps node exposes the incident-response resources', () => {
	const description = getNodeDescription();
	const resource = getProperty(description, 'resource');

	assert.equal(description.displayName, 'HustleOps');
	assert.equal(description.name, 'hustleOps');
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
