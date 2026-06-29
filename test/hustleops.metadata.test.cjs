const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { HUSTLEOPS_API_KEY_HEADER } = require('../dist/nodes/HustleOps/constants.js');

const LIVE_DESCRIPTION = 'Work with HustleOps incident response objects through the HustleOps API.';

test('HustleOps API credentials expose connection fields', () => {
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
	const ignoreSslIssues = credentials.properties.find(
		(property) => property.name === 'ignoreSslIssues',
	);

	assert.equal(baseUrl.displayName, 'Base URL');
	assert.equal(baseUrl.type, 'string');
	assert.equal(baseUrl.required, true);
	assert.match(baseUrl.description, /HTTPS HustleOps instance URL/);

	assert.equal(apiKey.displayName, 'API Key');
	assert.equal(apiKey.type, 'string');
	assert.equal(apiKey.required, true);
	assert.equal(apiKey.typeOptions.password, true);

	assert.equal(ignoreSslIssues.displayName, 'Ignore SSL Issues');
	assert.equal(ignoreSslIssues.type, 'boolean');
	assert.equal(ignoreSslIssues.default, false);
	assert.equal(
		ignoreSslIssues.description,
		'Whether to connect even if SSL certificate validation is not possible',
	);

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
		['alert', 'incident', 'observable', 'knowledge', 'comment', 'tag', 'customField'],
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
		['search', 'count', 'get', 'create', 'update', 'setTags', 'addTags', 'removeTag'],
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
	const notice = description.properties.find(
		(candidate) => candidate.name === 'metadataFirstNotice',
	);

	assert.equal(notice, undefined);

	assert.equal(id.required, true);
	assert.deepEqual(id.displayOptions.show.operation, [
		'get',
		'update',
		'setTags',
		'addTags',
		'removeTag',
	]);

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

test('HustleOps node exposes comment operations and fields', () => {
	const description = getNodeDescription();
	const operationProperties = description.properties.filter(
		(candidate) => candidate.name === 'operation',
	);
	const commentOperation = operationProperties.find((candidate) =>
		candidate.displayOptions?.show?.resource?.includes('comment'),
	);

	assert.ok(commentOperation, 'Expected comment operation selector');
	assert.deepEqual(
		commentOperation.options.map((option) => option.value),
		[
			'list',
			'search',
			'unreadCount',
			'create',
			'markRead',
			'update',
			'delete',
			'toggleReaction',
			'togglePin',
		],
	);

	const entityType = getProperty(description, 'entityType');
	const entityId = getProperty(description, 'entityId');
	const commentId = getProperty(description, 'commentId');
	const take = getProperty(description, 'take');
	const cursor = getProperty(description, 'cursor');
	const q = getProperty(description, 'q');
	const maxResults = getProperty(description, 'maxResults');
	const commentBody = getProperty(description, 'commentBody');
	const includeCommentPaginationMetadata = getProperty(
		description,
		'includeCommentPaginationMetadata',
	);
	const coreOperation = operationProperties.find((candidate) =>
		candidate.displayOptions?.show?.resource?.includes('incident'),
	);
	const coreResourceValues = ['alert', 'incident', 'observable', 'knowledge'];

	assert.ok(coreOperation, 'Expected core operation selector');
	assert.deepEqual(coreOperation.displayOptions.show.resource, coreResourceValues);
	assert.deepEqual(entityType.displayOptions.show.resource, ['comment', 'customField']);
	assert.deepEqual(entityId.displayOptions.show.resource, ['comment', 'customField']);
	assert.deepEqual(commentId.displayOptions.show.operation, [
		'update',
		'delete',
		'toggleReaction',
		'togglePin',
	]);
	assert.equal(take.default, 50);
	assert.equal(take.typeOptions.minValue, 1);
	assert.equal(take.typeOptions.maxValue, 100);
	assert.deepEqual(cursor.displayOptions.show.operation, ['list']);
	assert.deepEqual(q.displayOptions.show.operation, ['search']);
	assert.equal(maxResults.default, 100);
	assert.equal(maxResults.typeOptions.minValue, 1);
	assert.equal(maxResults.typeOptions.maxValue, 100);
	assert.deepEqual(maxResults.displayOptions.show.operation, ['search']);
	assert.equal(commentBody.type, 'json');
	assert.deepEqual(commentBody.displayOptions.show.operation, [
		'create',
		'update',
		'toggleReaction',
	]);
	assert.deepEqual(includeCommentPaginationMetadata.displayOptions.show.operation, ['list']);

	for (const coreFieldName of [
		'id',
		'body',
		'searchBody',
		'returnAll',
		'maxItems',
		'maxPages',
		'includePaginationMetadata',
	]) {
		assert.deepEqual(
			getProperty(description, coreFieldName).displayOptions.show.resource,
			coreResourceValues,
			`Expected ${coreFieldName} to be hidden for Comment`,
		);
	}
});

test('HustleOps node exposes tag and custom field operations and fields', () => {
	const { HustleOps } = require('../dist/nodes/HustleOps/HustleOps.node.js');
	const node = new HustleOps();
	const description = getNodeDescription();
	const operationProperties = description.properties.filter(
		(candidate) => candidate.name === 'operation',
	);
	const tagOperation = operationProperties.find((candidate) =>
		candidate.displayOptions?.show?.resource?.includes('tag'),
	);
	const customFieldOperation = operationProperties.find((candidate) =>
		candidate.displayOptions?.show?.resource?.includes('customField'),
	);
	const coreOperation = operationProperties.find((candidate) =>
		candidate.displayOptions?.show?.resource?.includes('incident'),
	);

	assert.ok(tagOperation, 'Expected tag operation selector');
	assert.deepEqual(
		tagOperation.options.map((option) => option.value),
		['list', 'search', 'create', 'updateColor', 'bulkUpdateColor', 'delete', 'bulkDelete'],
	);
	assert.ok(customFieldOperation, 'Expected custom field operation selector');
	assert.deepEqual(
		customFieldOperation.options.map((option) => option.value),
		[
			'listGroups',
			'createGroup',
			'updateGroup',
			'deleteGroup',
			'listDefinitions',
			'searchDefinitions',
			'createDefinition',
			'updateDefinition',
			'bulkUpdateDefinitions',
			'deleteDefinition',
			'bulkDeleteDefinitions',
			'getValues',
			'getAvailable',
			'batchGetValues',
			'replaceValues',
			'updateSelectedValuesSafely',
		],
	);
	assert.deepEqual(
		coreOperation.options.map((option) => option.value),
		['search', 'count', 'get', 'create', 'update', 'setTags', 'addTags', 'removeTag'],
	);

	const tagBody = getProperty(description, 'tagBody');
	const tagValues = getProperty(description, 'tagValues');
	const tagId = getProperty(description, 'tagId');
	const force = getProperty(description, 'force');
	const customFieldBody = getProperty(description, 'customFieldBody');
	const customFieldValues = getProperty(description, 'customFieldValues');
	const customFieldGroupId = getProperty(description, 'customFieldGroupId');
	const customFieldDefinitionId = getProperty(description, 'customFieldDefinitionId');
	const entityIds = getProperty(description, 'entityIds');

	assert.equal(tagBody.type, 'json');
	assert.deepEqual(tagBody.displayOptions.show.resource, ['tag']);
	assert.equal(tagValues.type, 'json');
	assert.deepEqual(tagValues.displayOptions.show.operation, ['setTags', 'addTags']);
	assert.equal(tagId.type, 'options');
	assert.deepEqual(tagId.displayOptions.show.operation, ['updateColor', 'delete', 'removeTag']);
	assert.deepEqual(force.displayOptions.show.operation, [
		'delete',
		'bulkDelete',
		'deleteGroup',
		'deleteDefinition',
		'bulkDeleteDefinitions',
	]);

	assert.equal(customFieldBody.type, 'json');
	assert.deepEqual(customFieldBody.displayOptions.show.resource, ['customField']);
	assert.equal(customFieldValues.type, 'json');
	assert.deepEqual(customFieldValues.displayOptions.show.operation, [
		'replaceValues',
		'updateSelectedValuesSafely',
	]);
	assert.deepEqual(customFieldGroupId.displayOptions.show.operation, [
		'updateGroup',
		'deleteGroup',
	]);
	assert.equal(customFieldDefinitionId.type, 'options');
	assert.deepEqual(customFieldDefinitionId.displayOptions.show.operation, [
		'updateDefinition',
		'deleteDefinition',
	]);
	assert.deepEqual(entityIds.displayOptions.show.operation, ['batchGetValues']);
	assert.equal(typeof node.methods.loadOptions.getTagOptions, 'function');
	assert.equal(typeof node.methods.loadOptions.getCustomFieldDefinitionOptions, 'function');
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

test('README documents live HustleOps API core operations', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

	assert.match(readme, /live HustleOps API/i);
	assert.match(readme, /x-api-key/i);
	assert.match(readme, /Search/i);
	assert.match(readme, /Count/i);
	assert.match(readme, /Get/i);
	assert.match(readme, /Create/i);
	assert.match(readme, /Update/i);
	assert.match(readme, /Alert/i);
	assert.match(readme, /Incident/i);
	assert.match(readme, /Observable/i);
	assert.match(readme, /Knowledge/i);
	assert.match(readme, /Return All/i);
	assert.match(readme, /Max Items/i);
	assert.match(readme, /Include Pagination Metadata/i);
	assert.match(readme, /unsupported fields/i);
	assert.match(readme, /Getting an API key/i);
	assert.match(readme, /API keys must be created outside n8n/i);
	assert.match(readme, /Create examples/i);
	assert.match(readme, /sourceRef/i);
	assert.match(readme, /firstSeen/i);
	assert.match(readme, /tlp/i);
	assert.match(readme, /Comment/i);
	assert.match(readme, /List/i);
	assert.match(readme, /Get Unread Count/i);
	assert.match(readme, /Toggle Reaction/i);
	assert.match(readme, /Toggle Pin/i);
	assert.match(readme, /Tag/i);
	assert.match(readme, /Set Tags/i);
	assert.match(readme, /Add Tags/i);
	assert.match(readme, /Remove Tag/i);
	assert.match(readme, /Custom Field/i);
	assert.match(readme, /Replace Values/i);
	assert.match(readme, /Update Selected Values Safely/i);
	assert.match(readme, /COMMENTS:VIEW/i);
	assert.match(readme, /COMMENTS:CREATE/i);
	assert.match(readme, /COMMENTS:UPDATE/i);
	assert.match(readme, /COMMENTS:DELETE/i);
	assert.match(readme, /Entity Type/i);
	assert.match(readme, /Entity ID/i);
	assert.match(readme, /Comment ID/i);
	assert.match(readme, /Search Query/i);
	assert.match(readme, /Max Results/i);
	assert.match(readme, /Include Cursor Metadata/i);
	assert.match(readme, /one item per comment/i);
	assert.match(readme, /\{ "unreadCount": number \}/i);
	assert.match(readme, /Attachment upload and download are not included/i);
	assert.doesNotMatch(readme, /metadata-first/i);
	assert.doesNotMatch(readme, /does not call the HustleOps API/i);
});
