import type {
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeParameters,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	assertPaginatedResponse,
	createHustleOpsApiClient,
	parseJsonObject,
	parsePositiveInteger,
	safePathSegment,
	testHustleOpsApiCredentials,
} from './GenericFunctions';
import {
	COMMENT_ENTITY_TYPE_OPTIONS,
	COMMENT_OPERATION_OPTIONS,
	COMMENT_RESOURCE_OPTION,
	assertCommentListResponse,
	buildCommentEntityQuery,
	buildCommentSearchQuery,
	parseCommentMaxResults,
	sanitizeCreateComment,
	sanitizeMarkReadComment,
	sanitizeToggleReaction,
	sanitizeUpdateComment,
	type CommentOperation,
} from './commentDefinitions';
import {
	CUSTOM_FIELD_OPERATION_OPTIONS,
	CUSTOM_FIELD_RESOURCE_OPTION,
	customFieldBatchBody,
	customFieldEntityScope,
	extractAttachedCustomFieldValues,
	mergeCustomFieldValues,
	parseCustomFieldValues,
	sanitizeCustomFieldDefinitionBody,
	sanitizeCustomFieldDefinitionBulkDelete,
	sanitizeCustomFieldDefinitionBulkUpdate,
	sanitizeCustomFieldGroupBody,
	type CustomFieldOperation,
} from './customFieldDefinitions';
import {
	CORE_RESOURCE_DEFINITIONS,
	CORE_RESOURCE_OPTIONS,
	type CoreResource,
	type CoreResourceDefinition,
	type DtoOperation,
	type FieldSpec,
	buildSearchRequest,
	getCoreResourceDefinition,
	sanitizeDtoBody,
} from './resourceDefinitions';
import {
	ENTITY_TAG_OPERATION_OPTIONS,
	TAG_OPERATION_OPTIONS,
	TAG_RESOURCE_OPTION,
	parseEntityTagValues,
	parseTagValues,
	sanitizeTagBody,
	type EntityTagOperation,
	type TagOperation,
} from './tagDefinitions';
import {
	ADDITIONAL_JSON_PARAMETER,
	CORE_WRITE_OPERATIONS,
	LEGACY_BODY_PARAMETER,
	createAdditionalFieldsParameterName,
	fieldDisplayName,
	structuredFieldParameterName,
	updateFieldsParameterName,
} from './structuredCoreFields';

export type CoreOperation = 'search' | 'count' | 'get' | 'create' | 'update';
export type HustleOpsOperation = CoreOperation | EntityTagOperation;
export type HustleOpsResource = CoreResource | 'comment' | 'tag' | 'customField';

const LIVE_DESCRIPTION = 'Work with HustleOps incident response objects through the HustleOps API.';
const STRUCTURED_CORE_FIELDS_NODE: INode = {
	id: 'hustleops-structured-core-fields',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const OPERATIONS_WITH_ID: HustleOpsOperation[] = [
	'get',
	'update',
	'setTags',
	'addTags',
	'removeTag',
];
const OPERATIONS_WITH_SEARCH_BODY: CoreOperation[] = ['search', 'count'];
const CORE_RESOURCE_VALUES = CORE_RESOURCE_OPTIONS.map((option) => option.value) as CoreResource[];
const HUSTLEOPS_RESOURCE_OPTIONS: INodePropertyOptions[] = [
	...CORE_RESOURCE_OPTIONS,
	COMMENT_RESOURCE_OPTION,
	TAG_RESOURCE_OPTION,
	CUSTOM_FIELD_RESOURCE_OPTION,
];

const CORE_OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Search',
		value: 'search',
		description: 'Search HustleOps objects with filters, pagination, and sorting',
		action: 'Search HustleOps objects',
	},
	{
		name: 'Count',
		value: 'count',
		description: 'Count HustleOps objects matching a search request',
		action: 'Count HustleOps objects',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a HustleOps object by ID',
		action: 'Get a HustleOps object',
	},
	{
		name: 'Create',
		value: 'create',
		description: 'Create a HustleOps object',
		action: 'Create a HustleOps object',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a HustleOps object',
		action: 'Update a HustleOps object',
	},
	...ENTITY_TAG_OPERATION_OPTIONS,
];

function fieldDefaultValue(spec: FieldSpec): string | boolean {
	if (spec.type === 'boolean') {
		return false;
	}
	if (spec.type === 'tags') {
		return '[]';
	}
	return '';
}

function fieldType(spec: FieldSpec): INodeProperties['type'] {
	if (spec.type === 'string' || spec.type === 'uuid' || spec.type === 'url') {
		return 'string';
	}
	if (spec.type === 'number') {
		return 'number';
	}
	if (spec.type === 'boolean') {
		return 'boolean';
	}
	if (spec.type === 'enum') {
		return 'options';
	}
	if (spec.type === 'date-time') {
		return 'dateTime';
	}
	if (spec.type === 'tags') {
		return 'json';
	}
	if (spec.type === 'uuid[]') {
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			'Structured core fields do not yet support uuid[] field specs.',
		);
	}
	const _exhaustive: never = spec.type;
	throw new NodeOperationError(
		STRUCTURED_CORE_FIELDS_NODE,
		`Unsupported structured core field type: ${_exhaustive}`,
	);
}

function enumOptionDisplayName(value: string): string {
	return fieldDisplayName(value.toLowerCase().replace(/_/g, ' '));
}

function fieldDescription(
	definition: CoreResourceDefinition,
	field: string,
	spec: FieldSpec,
): string {
	const constraints: string[] = [];
	if (spec.maxLength !== undefined) {
		constraints.push(`Maximum ${spec.maxLength} characters.`);
	}
	if (spec.patternDescription) {
		constraints.push(`${spec.patternDescription}.`);
	}
	if (spec.type === 'tags') {
		return `${definition.displayName} ${fieldDisplayName(field)} as a JSON array of tag names`;
	}
	if (spec.type === 'enum' && spec.allowedValues) {
		constraints.push(`Supported values: ${spec.allowedValues.join(', ')}.`);
	}
	return [
		`${definition.displayName} ${fieldDisplayName(field)}.`,
		spec.description,
		...constraints,
	]
		.filter(Boolean)
		.join(' ');
}

function buildFieldProperty(
	definition: CoreResourceDefinition,
	field: string,
	required: boolean,
	parameterName = field,
): INodeProperties {
	const spec = definition.fieldSpecs[field];
	const property: INodeProperties = {
		displayName: fieldDisplayName(field),
		name: parameterName,
		type: fieldType(spec),
		default: fieldDefaultValue(spec),
		required,
		description: fieldDescription(definition, field, spec),
	};

	if (spec.type === 'enum' && spec.allowedValues) {
		property.options = spec.allowedValues.map((value) => ({
			name: enumOptionDisplayName(value),
			value,
		}));
	}

	return property;
}

function buildCoreCreateRequiredProperties(): INodeProperties[] {
	return Object.values(CORE_RESOURCE_DEFINITIONS).flatMap((definition) =>
		definition.requiredCreateFields.map((field) => ({
			...buildFieldProperty(
				definition,
				field,
				true,
				structuredFieldParameterName(definition.resource, 'create', field),
			),
			displayOptions: {
				show: {
					resource: [definition.resource],
					operation: ['create'],
				},
			},
		})),
	);
}

function buildCoreCreateAdditionalProperties(): INodeProperties[] {
	return Object.values(CORE_RESOURCE_DEFINITIONS).map((definition) => ({
		displayName: 'Additional Fields',
		name: createAdditionalFieldsParameterName(definition.resource),
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: definition.createFields
			.filter((field) => !definition.requiredCreateFields.includes(field))
			.map((field) => buildFieldProperty(definition, field, false)),
		displayOptions: {
			show: {
				resource: [definition.resource],
				operation: ['create'],
			},
		},
	}));
}

function buildCoreUpdateFieldProperties(): INodeProperties[] {
	return Object.values(CORE_RESOURCE_DEFINITIONS).map((definition) => ({
		displayName: 'Fields to Update',
		name: updateFieldsParameterName(definition.resource),
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: definition.updateFields.map((field) => buildFieldProperty(definition, field, false)),
		displayOptions: {
			show: {
				resource: [definition.resource],
				operation: ['update'],
			},
		},
	}));
}

const CORE_CREATE_REQUIRED_PROPERTIES = buildCoreCreateRequiredProperties();
const CORE_CREATE_ADDITIONAL_PROPERTIES = buildCoreCreateAdditionalProperties();
const CORE_UPDATE_FIELD_PROPERTIES = buildCoreUpdateFieldProperties();

function shouldOmitStructuredValue(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

function hasStructuredBodyValue(body: IDataObject): boolean {
	return Object.values(body).some((value) => {
		if (shouldOmitStructuredValue(value)) {
			return false;
		}
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		return true;
	});
}

function normalizeStructuredFieldValue(
	context: IExecuteFunctions,
	spec: FieldSpec,
	value: unknown,
	itemIndex: number,
): unknown {
	if (spec.type === 'tags') {
		const tags = parseTagValues(context, value, fieldDisplayName(spec.name), itemIndex, {
			allowEmpty: true,
		});
		return tags.length === 0 ? undefined : tags;
	}
	return value;
}

function labelStructuredDtoError(
	context: IExecuteFunctions,
	error: unknown,
	fields: Set<string>,
	itemIndex: number,
): never {
	if (!(error instanceof Error)) {
		throw error;
	}

	let message = error.message;
	for (const field of [...fields].sort((left, right) => right.length - left.length)) {
		const displayLabel = `${fieldDisplayName(field)} (${field})`;
		message = message
			.replace(`field ${field}`, `field ${displayLabel}`)
			.replace(`field: ${field}`, `field: ${displayLabel}`)
			.replace(`field ${field} `, `field ${displayLabel} `);
	}

	throw new NodeOperationError(context.getNode(), message, { itemIndex });
}

function assignStructuredField(
	context: IExecuteFunctions,
	body: IDataObject,
	structuredFields: Set<string>,
	definition: CoreResourceDefinition,
	field: string,
	value: unknown,
	omitEmpty: boolean,
	itemIndex: number,
): void {
	const spec = definition.fieldSpecs[field];
	if (omitEmpty && shouldOmitStructuredValue(value)) {
		return;
	}

	const normalizedValue = normalizeStructuredFieldValue(context, spec, value, itemIndex);
	if (omitEmpty && normalizedValue === undefined) {
		return;
	}

	body[field] = normalizedValue as IDataObject[string];
	structuredFields.add(field);
}

function getStructuredCollectionValues(
	context: IExecuteFunctions,
	parameterName: string,
	label: string,
	itemIndex: number,
): INodeParameters {
	return parseJsonObject(
		context,
		context.getNodeParameter(parameterName, itemIndex, {}),
		label,
		itemIndex,
	) as INodeParameters;
}

function normalizeMergedDtoBody(
	context: IExecuteFunctions,
	body: IDataObject,
	definition: CoreResourceDefinition,
	itemIndex: number,
): IDataObject {
	if (
		definition.fieldSpecs.tags?.type === 'tags' &&
		Object.prototype.hasOwnProperty.call(body, 'tags')
	) {
		body.tags = parseTagValues(context, body.tags, 'Tags', itemIndex, {
			allowEmpty: true,
		});
	}
	return body;
}

function buildStructuredDtoBody(
	context: IExecuteFunctions,
	itemIndex: number,
	definition: CoreResourceDefinition,
	operation: DtoOperation,
): IDataObject {
	const structuredBody: IDataObject = {};
	const structuredFields = new Set<string>();

	if (operation === 'create') {
		for (const field of definition.requiredCreateFields) {
			assignStructuredField(
				context,
				structuredBody,
				structuredFields,
				definition,
				field,
				context.getNodeParameter(
					structuredFieldParameterName(definition.resource, 'create', field),
					itemIndex,
					'',
				),
				false,
				itemIndex,
			);
		}

		const additionalFields = getStructuredCollectionValues(
			context,
			createAdditionalFieldsParameterName(definition.resource),
			'Additional Fields',
			itemIndex,
		);
		for (const field of definition.createFields) {
			if (definition.requiredCreateFields.includes(field)) {
				continue;
			}
			assignStructuredField(
				context,
				structuredBody,
				structuredFields,
				definition,
				field,
				additionalFields[field],
				true,
				itemIndex,
			);
		}
	} else {
		const fieldsToUpdate = getStructuredCollectionValues(
			context,
			updateFieldsParameterName(definition.resource),
			'Fields to Update',
			itemIndex,
		);
		for (const field of definition.updateFields) {
			assignStructuredField(
				context,
				structuredBody,
				structuredFields,
				definition,
				field,
				fieldsToUpdate[field],
				true,
				itemIndex,
			);
		}
	}

	const additionalJson = parseJsonObject(
		context,
		context.getNodeParameter(ADDITIONAL_JSON_PARAMETER, itemIndex, '{}'),
		'Additional JSON',
		itemIndex,
	);

	if (!hasStructuredBodyValue(structuredBody) && Object.keys(additionalJson).length === 0) {
		const legacyBody = parseJsonObject(
			context,
			context.getNodeParameter(LEGACY_BODY_PARAMETER, itemIndex, '{}'),
			'Body',
			itemIndex,
		);
		if (Object.keys(legacyBody).length > 0) {
			return sanitizeDtoBody(definition, operation, legacyBody);
		}
	}

	const additionalJsonFields = new Set(Object.keys(additionalJson));
	const structuredOnlyFields = new Set(
		[...structuredFields].filter((field) => !additionalJsonFields.has(field)),
	);
	const mergedBody = normalizeMergedDtoBody(
		context,
		{ ...structuredBody, ...additionalJson },
		definition,
		itemIndex,
	);

	try {
		return sanitizeDtoBody(definition, operation, mergedBody);
	} catch (error) {
		labelStructuredDtoError(context, error, structuredOnlyFields, itemIndex);
	}
}

async function executeCommentOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: CommentOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	if (operation === 'list') {
		const query = buildCommentEntityQuery(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
				take: context.getNodeParameter('take', itemIndex, 50),
				cursor: context.getNodeParameter('cursor', itemIndex, ''),
			},
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = assertCommentListResponse(
			await client.request('GET', '/comments', undefined, query),
			'Comment list response',
		);
		const includeMetadata = context.getNodeParameter(
			'includeCommentPaginationMetadata',
			itemIndex,
			false,
		) as boolean;
		if (includeMetadata) {
			returnData.push({ json: response, pairedItem: { item: itemIndex } });
			return;
		}
		for (const row of response.items) {
			returnData.push({ json: row, pairedItem: { item: itemIndex } });
		}
		return;
	}

	if (operation === 'search') {
		const query = buildCommentSearchQuery(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
				q: context.getNodeParameter('q', itemIndex),
			},
			itemIndex,
		);
		const maxResults = parseCommentMaxResults(
			context,
			context.getNodeParameter('maxResults', itemIndex, 100),
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject[]>(
			'GET',
			'/comments/search',
			undefined,
			query,
		);
		if (!Array.isArray(response)) {
			throw new NodeOperationError(context.getNode(), 'Comment search response must be an array.', {
				itemIndex,
			});
		}
		for (const row of response.slice(0, maxResults)) {
			returnData.push({ json: row, pairedItem: { item: itemIndex } });
		}
		return;
	}

	if (operation === 'unreadCount') {
		const query = buildCommentEntityQuery(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<number>(
			'GET',
			'/comments/unread-count',
			undefined,
			query,
		);
		if (typeof response !== 'number') {
			throw new NodeOperationError(
				context.getNode(),
				'Comment unread count response must be a number.',
				{ itemIndex },
			);
		}
		returnData.push({ json: { unreadCount: response }, pairedItem: { item: itemIndex } });
		return;
	}

	if (operation === 'create') {
		const body = sanitizeCreateComment(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			parseJsonObject(
				context,
				context.getNodeParameter('commentBody', itemIndex),
				'Comment Body',
				itemIndex,
			),
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject>('POST', '/comments', body);
		returnData.push({ json: response, pairedItem: { item: itemIndex } });
		return;
	}

	if (operation === 'markRead') {
		const body = sanitizeMarkReadComment(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		await client.request('POST', '/comments/read', body);
		returnData.push({ json: { success: true, ...body }, pairedItem: { item: itemIndex } });
		return;
	}

	const commentId = safePathSegment(
		context.getNodeParameter('commentId', itemIndex) as string,
		'Comment ID',
	);

	if (operation === 'update') {
		const body = sanitizeUpdateComment(
			context,
			parseJsonObject(
				context,
				context.getNodeParameter('commentBody', itemIndex),
				'Comment Body',
				itemIndex,
			),
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject>('PATCH', `/comments/${commentId}`, body);
		returnData.push({ json: response, pairedItem: { item: itemIndex } });
		return;
	}

	if (operation === 'delete') {
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject>('DELETE', `/comments/${commentId}`);
		returnData.push({ json: response, pairedItem: { item: itemIndex } });
		return;
	}

	if (operation === 'toggleReaction') {
		const body = sanitizeToggleReaction(
			context,
			parseJsonObject(
				context,
				context.getNodeParameter('commentBody', itemIndex),
				'Comment Body',
				itemIndex,
			),
			itemIndex,
		);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject>(
			'POST',
			`/comments/${commentId}/reactions`,
			body,
		);
		returnData.push({ json: response, pairedItem: { item: itemIndex } });
		return;
	}

	if (operation === 'togglePin') {
		const client = await createHustleOpsApiClient(context, itemIndex);
		const response = await client.request<IDataObject>('PATCH', `/comments/${commentId}/pin`);
		returnData.push({ json: response, pairedItem: { item: itemIndex } });
		return;
	}

	throw new NodeOperationError(context.getNode(), `Unsupported Comment operation: ${operation}`, {
		itemIndex,
	});
}

function pushResponse(
	returnData: INodeExecutionData[],
	response: unknown,
	itemIndex: number,
): void {
	if (Array.isArray(response)) {
		for (const row of response) {
			returnData.push({ json: row as IDataObject, pairedItem: { item: itemIndex } });
		}
		return;
	}

	returnData.push({
		json: (response ?? { success: true }) as IDataObject,
		pairedItem: { item: itemIndex },
	});
}

function pushPaginatedRows(
	returnData: INodeExecutionData[],
	response: unknown,
	label: string,
	itemIndex: number,
): void {
	const page = assertPaginatedResponse(response, label);
	for (const row of page.data) {
		returnData.push({ json: row, pairedItem: { item: itemIndex } });
	}
}

function extractOptionRows(response: unknown): IDataObject[] {
	if (Array.isArray(response)) {
		return response.filter(
			(row): row is IDataObject => !!row && typeof row === 'object' && !Array.isArray(row),
		);
	}
	if (response && typeof response === 'object') {
		const objectResponse = response as IDataObject;
		for (const key of ['data', 'items', 'values']) {
			const rows = objectResponse[key];
			if (Array.isArray(rows)) {
				return rows.filter(
					(row): row is IDataObject => !!row && typeof row === 'object' && !Array.isArray(row),
				);
			}
		}
	}
	return [];
}

function optionFromRow(row: IDataObject, fallbackPrefix: string): INodePropertyOptions {
	const value = String(row.id ?? row.value ?? row.name ?? '');
	const label = row.value ?? row.name ?? row.label ?? value;
	const name = String(label || fallbackPrefix);
	return {
		name,
		value,
		description: typeof row.description === 'string' ? row.description : undefined,
	};
}

async function loadOptionsFromPath(
	context: ILoadOptionsFunctions,
	path: string,
	fallbackPrefix: string,
): Promise<INodePropertyOptions[]> {
	const client = await createHustleOpsApiClient(context, 0);
	const response = await client.request('GET', path);
	return extractOptionRows(response)
		.map((row) => optionFromRow(row, fallbackPrefix))
		.filter((option) => option.value !== '');
}

async function executeTagOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: TagOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	const client = await createHustleOpsApiClient(context, itemIndex);

	if (operation === 'list') {
		const response = await client.request<IDataObject[] | IDataObject>('GET', '/tags', undefined, {
			withCounts: context.getNodeParameter('withCounts', itemIndex, false) as boolean,
		});
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'delete') {
		const tagId = safePathSegment(context.getNodeParameter('tagId', itemIndex) as string, 'Tag ID');
		const force = context.getNodeParameter('force', itemIndex, false) as boolean;
		const response = await client.request<IDataObject>('DELETE', `/tags/${tagId}`, undefined, {
			force: force ? true : undefined,
		});
		pushResponse(returnData, response, itemIndex);
		return;
	}

	const body = parseJsonObject(
		context,
		context.getNodeParameter('tagBody', itemIndex, '{}'),
		'Tag Body',
		itemIndex,
	);

	if (operation === 'search') {
		const response = await client.request<IDataObject>('POST', '/tags/search', body);
		pushPaginatedRows(returnData, response, 'Tag search response', itemIndex);
		return;
	}

	if (operation === 'create') {
		const response = await client.request<IDataObject>(
			'POST',
			'/tags',
			sanitizeTagBody(context, operation, body, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'updateColor') {
		const tagId = safePathSegment(context.getNodeParameter('tagId', itemIndex) as string, 'Tag ID');
		const response = await client.request<IDataObject>(
			'PATCH',
			`/tags/${tagId}`,
			sanitizeTagBody(context, operation, body, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'bulkUpdateColor') {
		const response = await client.request<IDataObject>(
			'PATCH',
			'/tags/bulk',
			sanitizeTagBody(context, operation, body, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'bulkDelete') {
		const force = context.getNodeParameter('force', itemIndex, undefined) as boolean | undefined;
		const response = await client.request<IDataObject>(
			'POST',
			'/tags/bulk-delete',
			sanitizeTagBody(
				context,
				operation,
				force === undefined || body.force !== undefined ? body : { ...body, force },
				itemIndex,
			),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	throw new NodeOperationError(context.getNode(), `Unsupported Tag operation: ${operation}`, {
		itemIndex,
	});
}

async function executeEntityTagOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	resource: CoreResource,
	operation: EntityTagOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	const definition = getCoreResourceDefinition(resource);
	const entityId = safePathSegment(
		context.getNodeParameter('id', itemIndex) as string,
		`${definition.displayName} ID`,
	);
	const client = await createHustleOpsApiClient(context, itemIndex);

	if (operation === 'removeTag') {
		const tagId = safePathSegment(context.getNodeParameter('tagId', itemIndex) as string, 'Tag ID');
		const response = await client.request<IDataObject>(
			'DELETE',
			`${definition.path}/${entityId}/tags/${tagId}`,
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	const values = parseEntityTagValues(
		context,
		context.getNodeParameter('tagValues', itemIndex, '[]'),
		operation === 'setTags' ? 'Set Tags' : 'Add Tags',
		itemIndex,
	);
	const response = await client.request<IDataObject>(
		operation === 'setTags' ? 'PUT' : 'POST',
		`${definition.path}/${entityId}/tags`,
		{ values },
	);
	pushResponse(returnData, response, itemIndex);
}

async function executeCustomFieldOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: CustomFieldOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	const client = await createHustleOpsApiClient(context, itemIndex);

	if (operation === 'listGroups') {
		pushResponse(returnData, await client.request('GET', '/custom-fields/groups'), itemIndex);
		return;
	}

	if (operation === 'listDefinitions') {
		pushResponse(returnData, await client.request('GET', '/custom-fields/definitions'), itemIndex);
		return;
	}

	if (operation === 'deleteGroup') {
		const groupId = safePathSegment(
			context.getNodeParameter('customFieldGroupId', itemIndex) as string,
			'Custom field group ID',
		);
		const force = context.getNodeParameter('force', itemIndex, false) as boolean;
		const response = await client.request<IDataObject>(
			'DELETE',
			`/custom-fields/groups/${groupId}`,
			undefined,
			{ force: force ? true : undefined },
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'deleteDefinition') {
		const definitionId = safePathSegment(
			context.getNodeParameter('customFieldDefinitionId', itemIndex) as string,
			'Custom field definition ID',
		);
		const force = context.getNodeParameter('force', itemIndex, false) as boolean;
		const response = await client.request<IDataObject>(
			'DELETE',
			`/custom-fields/definitions/${definitionId}`,
			undefined,
			{ force: force ? true : undefined },
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'getValues' || operation === 'getAvailable') {
		const scope = customFieldEntityScope(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			itemIndex,
		);
		const pathPrefix =
			operation === 'getValues' ? '/custom-fields/values' : '/custom-fields/available';
		const response = await client.request<IDataObject>(
			'GET',
			`${pathPrefix}/${scope.entityType}/${safePathSegment(scope.entityId, 'Custom field entity ID')}`,
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'batchGetValues') {
		const body = customFieldBatchBody(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityIds: context.getNodeParameter('entityIds', itemIndex),
			},
			itemIndex,
		);
		const response = await client.request<IDataObject>('POST', '/custom-fields/values/batch', body);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'replaceValues' || operation === 'updateSelectedValuesSafely') {
		const scope = customFieldEntityScope(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			itemIndex,
		);
		const selectedValues = parseCustomFieldValues(
			context,
			context.getNodeParameter('customFieldValues', itemIndex, '[]'),
			itemIndex,
		);
		if (operation === 'updateSelectedValuesSafely' && selectedValues.length === 0) {
			throw new NodeOperationError(
				context.getNode(),
				'Update Selected Values Safely requires at least one custom field value.',
				{ itemIndex },
			);
		}
		const path = `/custom-fields/values/${scope.entityType}/${safePathSegment(
			scope.entityId,
			'Custom field entity ID',
		)}`;
		const values =
			operation === 'replaceValues'
				? selectedValues
				: mergeCustomFieldValues(
						extractAttachedCustomFieldValues(await client.request('GET', path)),
						selectedValues,
					);
		const response = await client.request<IDataObject>('PATCH', path, { values });
		pushResponse(returnData, response, itemIndex);
		return;
	}

	const body = parseJsonObject(
		context,
		context.getNodeParameter('customFieldBody', itemIndex, '{}'),
		'Custom Field Body',
		itemIndex,
	);

	if (operation === 'searchDefinitions') {
		pushPaginatedRows(
			returnData,
			await client.request('POST', '/custom-fields/definitions/search', body),
			'Custom field definition search response',
			itemIndex,
		);
		return;
	}

	if (operation === 'createGroup') {
		const response = await client.request<IDataObject>(
			'POST',
			'/custom-fields/groups',
			sanitizeCustomFieldGroupBody(context, body, true, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'updateGroup') {
		const groupId = safePathSegment(
			context.getNodeParameter('customFieldGroupId', itemIndex) as string,
			'Custom field group ID',
		);
		const response = await client.request<IDataObject>(
			'PATCH',
			`/custom-fields/groups/${groupId}`,
			sanitizeCustomFieldGroupBody(context, body, false, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'createDefinition') {
		const response = await client.request<IDataObject>(
			'POST',
			'/custom-fields/definitions',
			sanitizeCustomFieldDefinitionBody(context, body, 'create', itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'updateDefinition') {
		const definitionId = safePathSegment(
			context.getNodeParameter('customFieldDefinitionId', itemIndex) as string,
			'Custom field definition ID',
		);
		const response = await client.request<IDataObject>(
			'PATCH',
			`/custom-fields/definitions/${definitionId}`,
			sanitizeCustomFieldDefinitionBody(context, body, 'update', itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'bulkUpdateDefinitions') {
		const response = await client.request<IDataObject>(
			'PATCH',
			'/custom-fields/definitions/bulk',
			sanitizeCustomFieldDefinitionBulkUpdate(context, body, itemIndex),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	if (operation === 'bulkDeleteDefinitions') {
		const force = context.getNodeParameter('force', itemIndex, undefined) as boolean | undefined;
		const response = await client.request<IDataObject>(
			'POST',
			'/custom-fields/definitions/bulk-delete',
			sanitizeCustomFieldDefinitionBulkDelete(
				context,
				force === undefined || body.force !== undefined ? body : { ...body, force },
				itemIndex,
			),
		);
		pushResponse(returnData, response, itemIndex);
		return;
	}

	throw new NodeOperationError(
		context.getNode(),
		`Unsupported Custom Field operation: ${operation}`,
		{ itemIndex },
	);
}

export class HustleOps implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HustleOps',
		name: 'hustleOps',
		icon: { light: 'file:hustleops.svg', dark: 'file:hustleops.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: LIVE_DESCRIPTION,
		defaults: {
			name: 'HustleOps',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'hustleOpsApi',
				required: true,
				testedBy: 'hustleOps',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'incident',
				options: HUSTLEOPS_RESOURCE_OPTIONS,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'search',
				options: CORE_OPERATION_OPTIONS,
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
					},
				},
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'list',
				options: COMMENT_OPERATION_OPTIONS,
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'list',
				options: TAG_OPERATION_OPTIONS,
				displayOptions: {
					show: {
						resource: ['tag'],
					},
				},
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listDefinitions',
				options: CUSTOM_FIELD_OPERATION_OPTIONS,
				displayOptions: {
					show: {
						resource: ['customField'],
					},
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				default: '',
				required: true,
				description: 'HustleOps object ID',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: OPERATIONS_WITH_ID,
					},
				},
			},
			...CORE_CREATE_REQUIRED_PROPERTIES,
			...CORE_CREATE_ADDITIONAL_PROPERTIES,
			...CORE_UPDATE_FIELD_PROPERTIES,
			{
				displayName: 'Additional JSON',
				name: ADDITIONAL_JSON_PARAMETER,
				type: 'json',
				default: '{}',
				description:
					'Additional JSON object for advanced Create or Update payload fields. Values are merged after structured fields and override duplicate structured field names.',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: CORE_WRITE_OPERATIONS,
					},
				},
			},
			{
				displayName: 'Legacy Body',
				name: LEGACY_BODY_PARAMETER,
				type: 'hidden',
				default: '{}',
				description:
					'Hidden legacy compatibility field for workflows saved before structured create and update fields were added',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: CORE_WRITE_OPERATIONS,
					},
				},
			},
			{
				displayName: 'Search Body',
				name: 'searchBody',
				type: 'json',
				default: '{"pagination":{"page":1,"pageSize":25}}',
				description: 'JSON search request for HustleOps Search or Count operations',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: OPERATIONS_WITH_SEARCH_BODY,
					},
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Max Items',
				name: 'maxItems',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1000,
				description: 'Maximum number of search rows to return when Return All is enabled',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['search'],
						returnAll: [true],
					},
				},
			},
			{
				displayName: 'Max Pages',
				name: 'maxPages',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 100,
				description: 'Maximum number of pages to fetch when Return All is enabled',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['search'],
						returnAll: [true],
					},
				},
			},
			{
				displayName: 'Include Pagination Metadata',
				name: 'includePaginationMetadata',
				type: 'boolean',
				default: false,
				description:
					'Whether Search should return the raw paginated response with data, total, page, pageSize, and totalPages instead of only data rows',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['search'],
						returnAll: [false],
					},
				},
			},
			{
				displayName: 'With Counts',
				name: 'withCounts',
				type: 'boolean',
				default: false,
				description:
					'Whether to request tag usage counts. Counts require the HustleOps Admin role.',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['list'],
					},
				},
			},
			{
				displayName: 'Tag Body',
				name: 'tagBody',
				type: 'json',
				default: '{}',
				description:
					'JSON body for tag search, create, color update, bulk color update, or bulk delete operations',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['search', 'create', 'updateColor', 'bulkUpdateColor', 'bulkDelete'],
					},
				},
			},
			{
				displayName: 'Tag Values',
				name: 'tagValues',
				type: 'json',
				default: '[]',
				description:
					'JSON array of tag values. Set Tags accepts an empty array to clear all tags; Add Tags requires at least one value.',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['setTags', 'addTags'],
					},
				},
			},
			{
				displayName: 'Tag Name or ID',
				name: 'tagId',
				type: 'options',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getTagOptions',
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: {
						resource: [...CORE_RESOURCE_VALUES, 'tag'],
						operation: ['updateColor', 'delete', 'removeTag'],
					},
				},
			},
			{
				displayName: 'Force',
				name: 'force',
				type: 'boolean',
				default: false,
				description:
					'Whether to force deletion. Single deletes send force as a query parameter; bulk deletes send force in the JSON body.',
				displayOptions: {
					show: {
						resource: ['tag', 'customField'],
						operation: [
							'delete',
							'bulkDelete',
							'deleteGroup',
							'deleteDefinition',
							'bulkDeleteDefinitions',
						],
					},
				},
			},
			{
				displayName: 'Custom Field Body',
				name: 'customFieldBody',
				type: 'json',
				default: '{}',
				description: 'JSON body for custom field group and definition administration operations',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: [
							'createGroup',
							'updateGroup',
							'searchDefinitions',
							'createDefinition',
							'updateDefinition',
							'bulkUpdateDefinitions',
							'bulkDeleteDefinitions',
						],
					},
				},
			},
			{
				displayName: 'Custom Field Values',
				name: 'customFieldValues',
				type: 'json',
				default: '[]',
				description:
					'JSON array of { fieldId, value, fieldType? } objects. Array values are serialized as MULTI_SELECT JSON strings before sending.',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: ['replaceValues', 'updateSelectedValuesSafely'],
					},
				},
			},
			{
				displayName: 'Custom Field Group ID',
				name: 'customFieldGroupId',
				type: 'string',
				default: '',
				required: true,
				description: 'Custom field group UUID',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: ['updateGroup', 'deleteGroup'],
					},
				},
			},
			{
				displayName: 'Custom Field Definition Name or ID',
				name: 'customFieldDefinitionId',
				type: 'options',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getCustomFieldDefinitionOptions',
				},
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: ['updateDefinition', 'deleteDefinition'],
					},
				},
			},
			{
				displayName: 'Entity IDs',
				name: 'entityIds',
				type: 'json',
				default: '[]',
				required: true,
				description: 'JSON array of up to 100 entity UUIDs for batch custom field values',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: ['batchGetValues'],
					},
				},
			},
			{
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'options',
				default: 'INCIDENT',
				required: true,
				description: 'Type of HustleOps entity for the comment or custom field operation',
				options: COMMENT_ENTITY_TYPE_OPTIONS,
				displayOptions: {
					show: {
						resource: ['comment', 'customField'],
						operation: [
							'list',
							'search',
							'unreadCount',
							'create',
							'markRead',
							'getValues',
							'getAvailable',
							'batchGetValues',
							'replaceValues',
							'updateSelectedValuesSafely',
						],
					},
				},
			},
			{
				displayName: 'Entity ID',
				name: 'entityId',
				type: 'string',
				default: '',
				required: true,
				description: 'HustleOps entity UUID for the comment or custom field operation',
				displayOptions: {
					show: {
						resource: ['comment', 'customField'],
						operation: [
							'list',
							'search',
							'unreadCount',
							'create',
							'markRead',
							'getValues',
							'getAvailable',
							'replaceValues',
							'updateSelectedValuesSafely',
						],
					},
				},
			},
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				description: 'Comment UUID',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['update', 'delete', 'toggleReaction', 'togglePin'],
					},
				},
			},
			{
				displayName: 'Take',
				name: 'take',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Number of comments to request, from 1 to 100',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list'],
					},
				},
			},
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description:
					'Optional comment UUID cursor returned as nextCursor by a previous list response',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list'],
					},
				},
			},
			{
				displayName: 'Search Query',
				name: 'q',
				type: 'string',
				default: '',
				required: true,
				description:
					'Text to search for within the entity comment thread. Keep search text at or below 500 characters.',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Max Results',
				name: 'maxResults',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 100,
				description: 'Maximum number of comment search results to emit',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['search'],
					},
				},
			},
			{
				displayName: 'Comment Body',
				name: 'commentBody',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'JSON body for comment create, update, or reaction operations. Create accepts content, parentId, and attachmentIds. Update accepts content. Toggle Reaction accepts emoji.',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'update', 'toggleReaction'],
					},
				},
			},
			{
				displayName: 'Include Cursor Metadata',
				name: 'includeCommentPaginationMetadata',
				type: 'boolean',
				default: false,
				description:
					'Whether List should return the raw response with items and nextCursor instead of one output item per comment',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list'],
					},
				},
			},
		],
	};

	methods = {
		credentialTest: {
			async hustleOps(
				this: ICredentialTestFunctions,
				credential: { data?: ICredentialDataDecryptedObject },
			): Promise<INodeCredentialTestResult> {
				try {
					await testHustleOpsApiCredentials(this, credential.data ?? {});
					return {
						status: 'OK',
						message: 'HustleOps API credentials are valid.',
					};
				} catch (error) {
					return {
						status: 'Error',
						message: error instanceof Error ? error.message : String(error),
					};
				}
			},
		},
		loadOptions: {
			async getTagOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadOptionsFromPath(this, '/tags', 'Tag');
			},
			async getCustomFieldDefinitionOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				return loadOptionsFromPath(this, '/custom-fields/definitions', 'Custom Field');
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
				const operation = this.getNodeParameter('operation', itemIndex) as
					| HustleOpsOperation
					| CommentOperation;

				if (resource === 'comment') {
					await executeCommentOperation(this, itemIndex, operation as CommentOperation, returnData);
					continue;
				}

				if (resource === 'tag') {
					await executeTagOperation(this, itemIndex, operation as TagOperation, returnData);
					continue;
				}

				if (resource === 'customField') {
					await executeCustomFieldOperation(
						this,
						itemIndex,
						operation as CustomFieldOperation,
						returnData,
					);
					continue;
				}

				if (operation === 'setTags' || operation === 'addTags' || operation === 'removeTag') {
					await executeEntityTagOperation(
						this,
						itemIndex,
						resource,
						operation as EntityTagOperation,
						returnData,
					);
					continue;
				}

				const definition = getCoreResourceDefinition(resource);
				const coreOperation = operation as CoreOperation;

				if (coreOperation === 'get') {
					const id = this.getNodeParameter('id', itemIndex) as string;
					const entityId = safePathSegment(id, `${definition.displayName} ID`);
					const client = await createHustleOpsApiClient(this, itemIndex);
					const response = await client.request<IDataObject>(
						'GET',
						`${definition.path}/${entityId}`,
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				if (coreOperation === 'create') {
					const body = buildStructuredDtoBody(this, itemIndex, definition, 'create');
					const client = await createHustleOpsApiClient(this, itemIndex);
					const response = await client.request<IDataObject>('POST', definition.path, body);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				if (coreOperation === 'update') {
					const id = this.getNodeParameter('id', itemIndex) as string;
					const entityId = safePathSegment(id, `${definition.displayName} ID`);
					const body = buildStructuredDtoBody(this, itemIndex, definition, 'update');
					const client = await createHustleOpsApiClient(this, itemIndex);
					const response = await client.request<IDataObject>(
						'PATCH',
						`${definition.path}/${entityId}`,
						body,
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				const searchBody = buildSearchRequest(
					definition,
					parseJsonObject(
						this,
						this.getNodeParameter('searchBody', itemIndex, '{}'),
						'Search Body',
						itemIndex,
					),
				);

				const client = await createHustleOpsApiClient(this, itemIndex);

				if (coreOperation === 'count') {
					const response = await client.request<IDataObject>(
						'POST',
						`${definition.path}/count`,
						searchBody,
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
				if (returnAll) {
					const maxItems = parsePositiveInteger(
						this,
						this.getNodeParameter('maxItems', itemIndex, 1000),
						'Max Items',
						itemIndex,
					);
					const maxPages = parsePositiveInteger(
						this,
						this.getNodeParameter('maxPages', itemIndex, 100),
						'Max Pages',
						itemIndex,
					);
					await client.requestEachPage(
						`${definition.path}/search`,
						searchBody,
						{ maxItems, maxPages },
						(row) => returnData.push({ json: row, pairedItem: { item: itemIndex } }),
					);
					continue;
				}

				const response = assertPaginatedResponse(
					await client.request('POST', `${definition.path}/search`, searchBody),
					`${definition.displayName} search response`,
				);

				const includePaginationMetadata = this.getNodeParameter(
					'includePaginationMetadata',
					itemIndex,
					false,
				) as boolean;
				if (includePaginationMetadata) {
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				for (const row of response.data) {
					returnData.push({ json: row, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				const nodeError =
					error instanceof NodeOperationError
						? error
						: new NodeOperationError(
								this.getNode(),
								error instanceof Error ? error.message : String(error),
								{ itemIndex },
							);

				if (!this.continueOnFail()) {
					throw nodeError;
				}

				returnData.push({
					json: { error: nodeError.message },
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [returnData];
	}
}
