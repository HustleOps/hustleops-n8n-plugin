const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { HUSTLEOPS_API_KEY_HEADER } = require('../dist/nodes/HustleOps/constants.js');
const {
	PAYLOAD_INPUT_MODE_PARAMETER,
	PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	PAYLOAD_MODE_JSON_OBJECT,
	RETIRED_PAYLOAD_PARAMETERS,
	payloadJsonObjectParameterName,
} = require('../dist/nodes/HustleOps/payloadInputMode.js');

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

function readmePhrasePattern(...parts) {
	return new RegExp(parts.join(' '), 'i');
}

const {
	CORE_WRITE_OPERATIONS,
	createAdditionalFieldsParameterName: createAdditionalFieldsName,
	structuredFieldParameterName: structuredFieldName,
	updateFieldsParameterName: updateFieldsName,
} = require('../dist/nodes/HustleOps/structuredCoreFields.js');

function getDisplayedProperty(description, name, resource, operation) {
	const property = description.properties.find((candidate) => {
		const show = candidate.displayOptions?.show ?? {};
		return (
			candidate.name === name &&
			show.resource?.includes(resource) &&
			show.operation?.includes(operation)
		);
	});
	assert.ok(property, `Expected property ${name} for ${resource} ${operation}`);
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

test('HustleOps node exposes payload input mode for every payload operation', () => {
	const description = getNodeDescription();
	const mode = getProperty(description, PAYLOAD_INPUT_MODE_PARAMETER);

	assert.equal(mode.type, 'options');
	assert.equal(mode.default, PAYLOAD_MODE_INDIVIDUAL_FIELDS);
	assert.deepEqual(
		mode.options.map((option) => option.value),
		[PAYLOAD_MODE_INDIVIDUAL_FIELDS, PAYLOAD_MODE_JSON_OBJECT],
	);
	assert.deepEqual(mode.displayOptions.show.resource, [
		'alert',
		'incident',
		'observable',
		'knowledge',
		'comment',
		'tag',
		'customField',
	]);
	assert.ok(mode.displayOptions.show.operation.includes('create'));
	assert.ok(mode.displayOptions.show.operation.includes('search'));
	assert.ok(mode.displayOptions.show.operation.includes('replaceValues'));
	for (const operation of [
		'search',
		'count',
		'create',
		'update',
		'setTags',
		'addTags',
		'toggleReaction',
		'updateColor',
		'bulkUpdateColor',
		'bulkDelete',
		'searchDefinitions',
		'createGroup',
		'updateGroup',
		'createDefinition',
		'updateDefinition',
		'bulkUpdateDefinitions',
		'bulkDeleteDefinitions',
		'batchGetValues',
		'replaceValues',
		'updateSelectedValuesSafely',
	]) {
		assert.ok(
			mode.displayOptions.show.operation.includes(operation),
			`Expected Input Mode to show for ${operation}`,
		);
	}
});

test('HustleOps node removes retired payload parameters', () => {
	const description = getNodeDescription();
	for (const name of RETIRED_PAYLOAD_PARAMETERS) {
		assert.equal(
			description.properties.some((property) => property.name === name),
			false,
			`Expected retired parameter ${name} to be absent`,
		);
	}
});

test('HustleOps node exposes JSON object payload fields behind JSON Object mode', () => {
	const description = getNodeDescription();
	const alertCreateJson = getProperty(
		description,
		payloadJsonObjectParameterName('alert', 'create'),
	);
	const commentCreateJson = getProperty(
		description,
		payloadJsonObjectParameterName('comment', 'create'),
	);
	const customFieldBatchJson = getProperty(
		description,
		payloadJsonObjectParameterName('customField', 'batchGetValues'),
	);
	const payloadSearchFilter = getProperty(description, 'payloadSearchFilter');

	assert.deepEqual(alertCreateJson.displayOptions.show.resource, ['alert']);
	assert.deepEqual(alertCreateJson.displayOptions.show.operation, ['create']);
	assert.deepEqual(alertCreateJson.displayOptions.show[PAYLOAD_INPUT_MODE_PARAMETER], [
		PAYLOAD_MODE_JSON_OBJECT,
	]);
	assert.equal(payloadSearchFilter.default, '{}');
	assert.deepEqual(payloadSearchFilter.displayOptions.show[PAYLOAD_INPUT_MODE_PARAMETER], [
		PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	]);

	for (const property of [alertCreateJson, commentCreateJson, customFieldBatchJson]) {
		assert.equal(property.type, 'json');
		assert.equal(property.default, '{}');
		assert.deepEqual(property.displayOptions.show[PAYLOAD_INPUT_MODE_PARAMETER], [
			PAYLOAD_MODE_JSON_OBJECT,
		]);
	}
});

test('HustleOps node exposes structured core create and update fields', () => {
	const description = getNodeDescription();
	const { CORE_RESOURCE_DEFINITIONS } = require('../dist/nodes/HustleOps/resourceDefinitions.js');
	const supportedStructuredFieldTypes = new Set([
		'string',
		'number',
		'boolean',
		'uuid',
		'enum',
		'date-time',
		'url',
		'tags',
	]);

	for (const [resource, definition] of Object.entries(CORE_RESOURCE_DEFINITIONS)) {
		for (const field of [...definition.createFields, ...definition.updateFields]) {
			assert.ok(
				supportedStructuredFieldTypes.has(definition.fieldSpecs[field].type),
				`${resource} ${field} uses a supported structured field type`,
			);
		}

		for (const field of definition.requiredCreateFields) {
			const property = getDisplayedProperty(
				description,
				structuredFieldName(resource, 'create', field),
				resource,
				'create',
			);
			assert.equal(property.required, true, `${resource} ${field} should be required`);
			assert.equal(property.displayName.length > 0, true);
		}

		const createAdditionalFields = getDisplayedProperty(
			description,
			createAdditionalFieldsName(resource),
			resource,
			'create',
		);
		const optionalCreateFields = definition.createFields.filter(
			(field) => !definition.requiredCreateFields.includes(field),
		);
		assert.equal(createAdditionalFields.type, 'collection');
		assert.deepEqual(
			createAdditionalFields.options.map((option) => option.name),
			optionalCreateFields,
		);

		const updateFields = getDisplayedProperty(
			description,
			updateFieldsName(resource),
			resource,
			'update',
		);
		assert.equal(updateFields.type, 'collection');
		assert.deepEqual(
			updateFields.options.map((option) => option.name),
			definition.updateFields,
		);
	}

	const alertSeverity = getDisplayedProperty(
		description,
		structuredFieldName('alert', 'create', 'severity'),
		'alert',
		'create',
	);
	assert.equal(alertSeverity.type, 'options');
	assert.deepEqual(
		alertSeverity.options.map((option) => option.value),
		['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
	);
	assert.deepEqual(
		alertSeverity.options.map((option) => option.name),
		['Critical', 'High', 'Medium', 'Low', 'Info'],
	);

	const alertTlp = getDisplayedProperty(
		description,
		structuredFieldName('alert', 'create', 'tlp'),
		'alert',
		'create',
	);
	assert.equal(alertTlp.type, 'options');
	assert.deepEqual(
		alertTlp.options.map((option) => option.value),
		['RED', 'AMBER_STRICT', 'AMBER', 'GREEN', 'CLEAR'],
	);
	assert.deepEqual(
		alertTlp.options.map((option) => option.name),
		['Red', 'Amber Strict', 'Amber', 'Green', 'Clear'],
	);

	assert.equal(
		getDisplayedProperty(
			description,
			structuredFieldName('alert', 'create', 'detectedAt'),
			'alert',
			'create',
		).type,
		'dateTime',
	);
	assert.equal(
		getDisplayedProperty(
			description,
			structuredFieldName('observable', 'create', 'firstSeen'),
			'observable',
			'create',
		).type,
		'dateTime',
	);
	assert.equal(
		getDisplayedProperty(
			description,
			structuredFieldName('observable', 'create', 'lastSeen'),
			'observable',
			'create',
		).type,
		'dateTime',
	);

	const alertAdditionalFields = getDisplayedProperty(
		description,
		createAdditionalFieldsName('alert'),
		'alert',
		'create',
	);
	const alertTags = alertAdditionalFields.options.find((option) => option.name === 'tags');
	assert.ok(alertTags, 'Expected alert tags optional field');
	assert.equal(alertTags.type, 'json');
	assert.equal(alertTags.default, '[]');
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
	const commentContent = getProperty(description, 'payloadCommentContent');
	const commentAttachmentIds = getProperty(description, 'payloadCommentAttachmentIds');
	const commentEmoji = getProperty(description, 'payloadCommentEmoji');
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
	assert.equal(commentContent.type, 'string');
	assert.deepEqual(commentContent.displayOptions.show.operation, ['create', 'update']);
	assert.deepEqual(commentContent.displayOptions.show[PAYLOAD_INPUT_MODE_PARAMETER], [
		PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	]);
	assert.equal(commentAttachmentIds.type, 'json');
	assert.deepEqual(commentAttachmentIds.displayOptions.show.operation, ['create']);
	assert.equal(commentEmoji.type, 'string');
	assert.deepEqual(commentEmoji.displayOptions.show.operation, ['toggleReaction']);
	assert.deepEqual(includeCommentPaginationMetadata.displayOptions.show.operation, ['list']);

	for (const coreFieldName of [
		'id',
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

	const tagValue = getProperty(description, 'payloadTagValue');
	const tagColor = getProperty(description, 'payloadTagColor');
	const tagIds = getProperty(description, 'payloadTagIds');
	const tagForce = getProperty(description, 'payloadTagForce');
	const entityTagValues = getProperty(description, 'payloadEntityTagValues');
	const tagId = getProperty(description, 'tagId');
	const force = getProperty(description, 'force');
	const customFieldGroupFields = getProperty(description, 'payloadCustomFieldGroupFields');
	const customFieldDefinitionFields = getProperty(
		description,
		'payloadCustomFieldDefinitionFields',
	);
	const customFieldDefinitionBulkFields = getProperty(
		description,
		'payloadCustomFieldDefinitionBulkFields',
	);
	const customFieldDefinitionIds = getProperty(description, 'payloadCustomFieldDefinitionIds');
	const customFieldPayloadRows = getProperty(description, 'payloadCustomFieldValues');
	const customFieldGroupId = getProperty(description, 'customFieldGroupId');
	const customFieldDefinitionId = getProperty(description, 'customFieldDefinitionId');
	const entityIds = getProperty(description, 'payloadCustomFieldEntityIds');

	assert.equal(entityTagValues.type, 'json');
	assert.deepEqual(entityTagValues.displayOptions.show.operation, ['setTags', 'addTags']);
	assert.deepEqual(entityTagValues.displayOptions.show[PAYLOAD_INPUT_MODE_PARAMETER], [
		PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	]);
	assert.equal(tagValue.type, 'string');
	assert.deepEqual(tagValue.displayOptions.show.operation, ['create']);
	assert.equal(tagColor.type, 'string');
	assert.deepEqual(tagColor.displayOptions.show.operation, [
		'create',
		'updateColor',
		'bulkUpdateColor',
	]);
	assert.equal(tagIds.type, 'json');
	assert.deepEqual(tagIds.displayOptions.show.operation, ['bulkUpdateColor', 'bulkDelete']);
	assert.equal(tagForce.type, 'boolean');
	assert.deepEqual(tagForce.displayOptions.show.operation, ['bulkDelete']);
	assert.equal(tagId.type, 'options');
	assert.deepEqual(tagId.displayOptions.show.operation, ['updateColor', 'delete', 'removeTag']);
	assert.deepEqual(force.displayOptions.show.operation, [
		'delete',
		'deleteGroup',
		'deleteDefinition',
		'bulkDeleteDefinitions',
	]);

	assert.equal(customFieldGroupFields.type, 'json');
	assert.deepEqual(customFieldGroupFields.displayOptions.show.operation, [
		'createGroup',
		'updateGroup',
	]);
	assert.equal(customFieldDefinitionFields.type, 'json');
	assert.deepEqual(customFieldDefinitionFields.displayOptions.show.operation, [
		'createDefinition',
		'updateDefinition',
	]);
	assert.equal(customFieldDefinitionBulkFields.type, 'json');
	assert.deepEqual(customFieldDefinitionBulkFields.displayOptions.show.operation, [
		'bulkUpdateDefinitions',
	]);
	assert.equal(customFieldDefinitionIds.type, 'json');
	assert.deepEqual(customFieldDefinitionIds.displayOptions.show.operation, [
		'bulkDeleteDefinitions',
	]);
	assert.equal(customFieldPayloadRows.type, 'json');
	assert.deepEqual(customFieldPayloadRows.displayOptions.show.operation, [
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

	assert.equal(codex.node, '@hustleops-n8n/n8n-nodes-hustleops');
	assert.equal(codex.nodeVersion, '1.0');
	assert.equal(codex.codexVersion, '1.0');
	assert.equal(codex.categories.includes('Development'), true);
	assert.equal(codex.categories.includes('Security'), true);
});

test('package.json registers the compiled HustleOps node and credentials', () => {
	const packageJson = require('../package.json');

	assert.equal(packageJson.name, '@hustleops-n8n/n8n-nodes-hustleops');
	assert.equal(packageJson.private, undefined);
	assert.equal(packageJson.license, 'MIT');
	assert.deepEqual(packageJson.author, {
		name: 'Dmytro Kosiuk',
		email: 'misterr.minister@gmail.com',
	});
	assert.deepEqual(packageJson.repository, {
		type: 'git',
		url: 'git+https://github.com/HustleOps/hustleops-n8n-plugin.git',
	});
	assert.deepEqual(packageJson.bugs, {
		url: 'https://github.com/HustleOps/hustleops-n8n-plugin/issues',
	});
	assert.deepEqual(packageJson.publishConfig, {
		access: 'public',
		registry: 'https://registry.npmjs.org/',
	});
	assert.equal(packageJson.dependencies, undefined);
	assert.equal(packageJson.optionalDependencies, undefined);
	assert.equal(packageJson.bundleDependencies, undefined);
	assert.equal(packageJson.bundledDependencies, undefined);
	assert.equal(packageJson.keywords.includes('n8n-community-node-package'), true);
	assert.equal(packageJson.n8n.n8nNodesApiVersion, 1);
	assert.equal(packageJson.n8n.strict, true);
	assert.equal(packageJson.scripts.build, 'n8n-node build');
	assert.equal(packageJson.scripts.dev, 'n8n-node dev');
	assert.equal(packageJson.scripts.format, 'prettier --write .');
	assert.equal(packageJson.scripts.release, 'n8n-node release');
	assert.equal(packageJson.scripts.prepublishOnly, 'n8n-node prerelease');
	assert.equal(packageJson.scripts['test:unit'], 'node --test test/*.test.cjs');
	assert.equal(packageJson.devDependencies['@n8n/node-cli'], '0.37.2');
	assert.equal(packageJson.devDependencies['release-it'], '^20.2.1');
	assert.equal(packageJson.devDependencies['auto-changelog'], '^2.5.0');
	assert.equal(packageJson.overrides, undefined);
	assert.equal(packageJson.peerDependencies['n8n-workflow'], '*');
	assert.deepEqual(packageJson.n8n.credentials, ['dist/credentials/HustleOpsApi.credentials.js']);
	assert.deepEqual(packageJson.n8n.nodes, ['dist/nodes/HustleOps/HustleOps.node.js']);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'pr-check.yml')),
		true,
	);
	assert.equal(fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml')), false);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'commit-metadata.yml')),
		false,
	);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml')),
		true,
	);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml')),
		false,
	);
	assert.equal(fs.existsSync(path.join(__dirname, '..', 'LICENSE')), true);
});

test('PR check workflow enforces pull request and release quality gates', () => {
	const prCheckWorkflow = fs.readFileSync(
		path.join(__dirname, '..', '.github', 'workflows', 'pr-check.yml'),
		'utf8',
	);
	const releaseWorkflow = fs.readFileSync(
		path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
		'utf8',
	);

	assert.match(prCheckWorkflow, /name:\s*PR Check/);
	assert.match(
		prCheckWorkflow,
		/on:\n  pull_request:\n    branches: \[main\]\n  push:\n    branches: \[main\]/,
	);
	assert.match(prCheckWorkflow, /contents:\s*read/);
	assert.match(prCheckWorkflow, /pull-requests:\s*read/);
	assert.ok(prCheckWorkflow.indexOf('validate:') < prCheckWorkflow.indexOf('quality:'));
	assert.match(prCheckWorkflow, /name:\s*PR Check \/ Quality/);
	assert.match(prCheckWorkflow, /npm run format:check/);
	assert.match(prCheckWorkflow, /npm run lint/);
	assert.match(prCheckWorkflow, /npm run typecheck/);
	assert.match(prCheckWorkflow, /npm test/);
	assert.match(prCheckWorkflow, /npm pack --dry-run/);
	assert.match(prCheckWorkflow, /name:\s*PR Check \/ Validate/);
	assert.doesNotMatch(prCheckWorkflow, /if:\s*github\.event_name == 'pull_request'/);
	assert.match(prCheckWorkflow, /path:\s*base/);
	assert.match(
		prCheckWorkflow,
		/repository:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/,
	);
	assert.match(prCheckWorkflow, /PUSH_BEFORE_SHA:\s*\$\{\{ github\.event\.before \}\}/);
	assert.match(prCheckWorkflow, /git log --format=%s "\$PUSH_BEFORE_SHA\.\.\$PUSH_AFTER_SHA"/);
	assert.match(prCheckWorkflow, /node base\/scripts\/ci\/validate-commit-metadata\.cjs/);
	assert.doesNotMatch(prCheckWorkflow, /pull_request_target/);

	assert.match(releaseWorkflow, /name:\s*Release/);
	assert.match(releaseWorkflow, /workflow_dispatch:/);
	assert.match(releaseWorkflow, /release_tag:/);
	assert.match(releaseWorkflow, /contents:\s*write/);
	assert.match(releaseWorkflow, /id-token:\s*write/);
	assert.match(releaseWorkflow, /packages:\s*write/);
	assert.doesNotMatch(prCheckWorkflow, /uses:\s*actions\/checkout@v4/);
	assert.doesNotMatch(prCheckWorkflow, /uses:\s*actions\/setup-node@v4/);
	assert.doesNotMatch(releaseWorkflow, /uses:\s*actions\/checkout@v4/);
	assert.doesNotMatch(releaseWorkflow, /uses:\s*actions\/setup-node@v4/);
	assert.match(prCheckWorkflow, /uses:\s*actions\/checkout@v5/);
	assert.match(prCheckWorkflow, /uses:\s*actions\/setup-node@v5/);
	assert.match(releaseWorkflow, /uses:\s*actions\/checkout@v5/);
	assert.match(releaseWorkflow, /uses:\s*actions\/setup-node@v5/);
	assert.match(releaseWorkflow, /cancel-in-progress:\s*false/);
	assert.match(releaseWorkflow, /name:\s*Require release workflow from main/);
	assert.match(releaseWorkflow, /\$GITHUB_REF" != "refs\/heads\/main"/);
	assert.match(releaseWorkflow, /Release workflow must be run from main/);
	assert.match(releaseWorkflow, /release-prepare\.cjs --release-tag/);
	assert.match(releaseWorkflow, /release_already_prepared/);
	assert.match(
		releaseWorkflow,
		/if:\s*steps\.preflight\.outputs\.release_already_prepared != 'true'/,
	);
	assert.match(releaseWorkflow, /chore\(release\): \$RELEASE_TAG/);
	assert.match(releaseWorkflow, /gh release create "\$RELEASE_TAG" --draft/);
	assert.match(releaseWorkflow, /npm publish --dry-run --registry=https:\/\/npm\.pkg\.github\.com/);
	assert.match(
		releaseWorkflow,
		/npm publish --registry=https:\/\/registry\.npmjs\.org\/ --provenance/,
	);
	assert.match(releaseWorkflow, /steps\.npm_version\.outputs\.published/);
	assert.match(releaseWorkflow, /steps\.github_packages_version\.outputs\.published/);
	assert.match(releaseWorkflow, /npm\.pkg\.github\.com/);
	assert.match(releaseWorkflow, /RELEASE_MODE:\s*'true'/);
	assert.doesNotMatch(releaseWorkflow, /secrets\.NPM_TOKEN/);
	assert.equal(
		fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'publish.yml')),
		false,
	);
});

test('runtime package surface stays compatible with verified community node constraints', () => {
	const packageJson = require('../package.json');
	const runtimeSources = [
		'nodes/HustleOps/HustleOps.node.ts',
		'nodes/HustleOps/GenericFunctions.ts',
		'nodes/HustleOps/commentDefinitions.ts',
		'nodes/HustleOps/customFieldDefinitions.ts',
		'nodes/HustleOps/resourceDefinitions.ts',
		'nodes/HustleOps/structuredCoreFields.ts',
		'nodes/HustleOps/tagDefinitions.ts',
		'credentials/HustleOpsApi.credentials.ts',
	]
		.map((relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'))
		.join('\n');

	assert.equal(packageJson.dependencies, undefined);
	assert.equal(packageJson.optionalDependencies, undefined);
	assert.equal(packageJson.bundleDependencies, undefined);
	assert.equal(packageJson.bundledDependencies, undefined);
	assert.doesNotMatch(runtimeSources, /process\.env/);
	assert.doesNotMatch(runtimeSources, /from ['"](?:node:)?fs(?:\/promises)?['"]/);
	assert.doesNotMatch(runtimeSources, /require\(['"](?:node:)?fs(?:\/promises)?['"]\)/);
	assert.doesNotMatch(
		runtimeSources,
		/\b(readFile|writeFile|createReadStream|createWriteStream)\b/,
	);
	assert.doesNotMatch(runtimeSources, /from ['"](?:node:)?child_process['"]/);
	assert.doesNotMatch(runtimeSources, /require\(['"](?:node:)?child_process['"]\)/);
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
	assert.match(readme, /Input Mode/i);
	assert.match(readme, /Individual Fields/i);
	assert.match(readme, /JSON Object/i);
	assert.match(readme, /full replacement/i);
	assert.match(readme, /Additional Fields/i);
	assert.match(readme, /Fields to Update/i);
	assert.match(readme, /structured fields/i);
	assert.doesNotMatch(readme, readmePhrasePattern('Additional', 'JSON'));
	assert.doesNotMatch(readme, readmePhrasePattern('merged after', 'structured fields'));
	assert.doesNotMatch(readme, readmePhrasePattern('legacy', 'fallback'));
	assert.doesNotMatch(readme, readmePhrasePattern('Search', 'Body'));
	assert.doesNotMatch(readme, readmePhrasePattern('Tag', 'Body'));
	assert.doesNotMatch(readme, readmePhrasePattern('Comment', 'Body'));
	assert.doesNotMatch(readme, readmePhrasePattern('Custom Field', 'Body'));
	assert.match(readme, /summary": null/i);
	assert.match(readme, /Threat Level/i);
	assert.match(readme, /First Seen/i);
	assert.match(readme, /Category/i);
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
	assert.match(readme, /npm install @hustleops-n8n\/n8n-nodes-hustleops/i);
	assert.match(readme, /Community Nodes/i);
	assert.match(readme, /Release workflow/i);
	assert.match(readme, /v0\.1\.2/i);
	assert.match(readme, /Conventional Commits/i);
	assert.match(readme, /Trusted Publishing/i);
	assert.match(readme, /GitHub Packages/i);
	assert.doesNotMatch(readme, /npm run release/i);
	assert.match(readme, /Creator Portal/i);
	assert.doesNotMatch(readme, /metadata-first/i);
	assert.doesNotMatch(readme, /does not call the HustleOps API/i);
});

test('README documents payload input mode contract', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

	assert.match(readme, /Input Mode/i);
	assert.match(readme, /Individual Fields/i);
	assert.match(readme, /JSON Object/i);
	assert.match(readme, /full replacement/i);
	assert.doesNotMatch(readme, readmePhrasePattern('Additional', 'JSON'));
	assert.doesNotMatch(readme, readmePhrasePattern('merged after', 'structured fields'));
	assert.doesNotMatch(readme, readmePhrasePattern('legacy', 'fallback'));
});
