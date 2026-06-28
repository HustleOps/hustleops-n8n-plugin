const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { HUSTLEOPS_API_KEY_HEADER } = require('../dist/nodes/HustleOps/constants.js');

const LIVE_DESCRIPTION = 'Work with HustleOps incident response objects through the HustleOps API.';

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
				[HUSTLEOPS_API_KEY_HEADER]: '={{$credentials.apiKey}}',
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
	assert.deepEqual(description.credentials, [
		{ name: 'hustleOpsApi', required: true, testedBy: 'hustleOps' },
	]);
	assert.deepEqual(
		resource.options.map((option) => option.value),
		['alert', 'incident', 'observable', 'knowledge'],
	);
});

test('HustleOps node exposes a live credential test method', () => {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();

	assert.equal(typeof node.methods.credentialTest.hustleOps, 'function');
});

test('HustleOps credential test uses a low-impact authenticated endpoint', () => {
	const nodeSource = fs.readFileSync(
		path.join(__dirname, '..', 'nodes', 'HustleOps', 'HustleOps.node.ts'),
		'utf8',
	);
	const helperSource = fs.readFileSync(
		path.join(__dirname, '..', 'nodes', 'HustleOps', 'GenericFunctions.ts'),
		'utf8',
	);

	assert.match(helperSource, /\/tags/);
	assert.doesNotMatch(`${nodeSource}\n${helperSource}`, /\/picklists/);
	assert.doesNotMatch(`${nodeSource}\n${helperSource}`, /\/auth\/me/);
});

test('HustleOps node exposes live core API operations', () => {
	const description = getNodeDescription();
	const operation = getProperty(description, 'operation');

	assert.equal(description.description, LIVE_DESCRIPTION);
	assert.equal(operation.default, 'search');
	assert.deepEqual(
		operation.options.map((option) => option.value),
		['search', 'count', 'get', 'create', 'update'],
	);
});

test('HustleOps node exposes live request fields', () => {
	const description = getNodeDescription();
	const id = getProperty(description, 'id');
	const body = getProperty(description, 'body');
	const searchBody = getProperty(description, 'searchBody');
	const returnAll = getProperty(description, 'returnAll');
	const maxItems = getProperty(description, 'maxItems');
	const maxPages = getProperty(description, 'maxPages');
	const includePaginationMetadata = getProperty(description, 'includePaginationMetadata');
	const notice = description.properties.find((candidate) => candidate.name === 'metadataFirstNotice');

	assert.equal(notice, undefined);

	assert.equal(id.required, true);
	assert.deepEqual(id.displayOptions.show.operation, ['get', 'update']);

	assert.equal(body.type, 'json');
	assert.equal(body.default, '{}');
	assert.equal(body.required, true);
	assert.match(body.description, /Create or Update/);
	assert.deepEqual(body.displayOptions.show.operation, ['create', 'update']);

	assert.equal(searchBody.type, 'json');
	assert.deepEqual(searchBody.displayOptions.show.operation, ['search', 'count']);

	assert.equal(returnAll.type, 'boolean');
	assert.equal(returnAll.default, false);
	assert.deepEqual(returnAll.displayOptions.show.operation, ['search']);

	assert.equal(maxItems.type, 'number');
	assert.deepEqual(maxItems.displayOptions.show.returnAll, [true]);
	assert.equal(maxPages.type, 'number');
	assert.deepEqual(maxPages.displayOptions.show.returnAll, [true]);

	assert.equal(includePaginationMetadata.type, 'boolean');
	assert.equal(includePaginationMetadata.default, false);
	assert.deepEqual(includePaginationMetadata.displayOptions.show.operation, ['search']);
});

test('HustleOps node codex metadata is present', () => {
	const codex = require('../dist/nodes/HustleOps/HustleOps.node.json');

	assert.equal(codex.node, '@hustleops/n8n-nodes-hustleops');
	assert.equal(codex.nodeVersion, '1.0');
	assert.equal(codex.codexVersion, '1.0');
	assert.equal(codex.categories.includes('Development'), true);
	assert.equal(codex.categories.includes('Security'), true);
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
	assert.match(readme, /x-api-key/i);
	assert.doesNotMatch(readme, /Authorization: Bearer <apiKey>/);
});
