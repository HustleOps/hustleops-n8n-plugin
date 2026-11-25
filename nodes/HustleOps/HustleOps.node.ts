import { randomUUID } from 'node:crypto';
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
	collectionQueryParams,
	expectedVersion,
	compactObject,
	createHustleOpsApiClient,
	parseJsonArray,
	parseJsonObject,
	parsePositiveInteger,
	safePathSegment,
	testHustleOpsApiCredentials,
} from './GenericFunctions';
import {
	CUSTOM_FIELD_ENTITY_TYPE_OPTIONS,
	CUSTOM_FIELD_OPERATION_OPTIONS,
	CUSTOM_FIELD_RESOURCE_OPTION,
	customFieldBatchBody,
	customFieldEntityScope,
	extractAttachedCustomFieldValues,
	mergeCustomFieldValues,
	parseCustomFieldValues,
	sanitizeCustomFieldDefinitionBody,
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
	buildCollectionRequest,
	getCoreResourceDefinition,
	isFileObservableType,
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
	createAdditionalFieldsParameterName,
	fieldDisplayName,
	structuredFieldParameterName,
	updateFieldsParameterName,
} from './structuredCoreFields';
import {
	PAYLOAD_INPUT_MODE_OPTIONS,
	PAYLOAD_INPUT_MODE_PARAMETER,
	PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	PAYLOAD_MODE_JSON_OBJECT,
	type PayloadInputMode,
	modeDisplayOptions,
	payloadJsonObjectParameterName,
	payloadModeDisplayOptions,
} from './payloadInputMode';

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

const OPERATIONS_WITH_ID: HustleOpsOperation[] = ['get', 'setTags', 'addTags', 'removeTag'];
const CORE_RESOURCE_VALUES = CORE_RESOURCE_OPTIONS.map((option) => option.value) as CoreResource[];
const PAYLOAD_OPERATION_VALUES = [
	'search',
	'count',
	'create',
	'update',
	'setTags',
	'addTags',
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
] as const;
const HUSTLEOPS_RESOURCE_OPTIONS: INodePropertyOptions[] = [
	...CORE_RESOURCE_OPTIONS,
	TAG_RESOURCE_OPTION,
	CUSTOM_FIELD_RESOURCE_OPTION,
];
const PICKLIST_LOAD_OPTIONS_METHODS: Record<string, string> = {
	alertType: 'getAlertTypeOptions',
	alertStatus: 'getAlertStatusOptions',
	incidentStatus: 'getIncidentStatusOptions',
	incidentCategory: 'getIncidentCategoryOptions',
	observableType: 'getObservableTypeOptions',
	threatLevel: 'getThreatLevelOptions',
	criticality: 'getCriticalityOptions',
	knowledgeType: 'getKnowledgeTypeOptions',
};

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
	if (spec.picklistDomain) {
		return 'options';
	}
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

function picklistLoadOptionsMethod(domain: string): string {
	const method = PICKLIST_LOAD_OPTIONS_METHODS[domain];
	if (!method) {
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			`Unsupported HustleOps picklist domain: ${domain}`,
		);
	}
	return method;
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
	if (spec.picklistDomain) {
		constraints.push(`Options load from the HustleOps ${spec.picklistDomain} picklist.`);
	}
	return [`${definition.displayName} ${fieldDisplayName(field)}.`, spec.description, ...constraints]
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
	if (spec.picklistDomain) {
		property.typeOptions = {
			loadOptionsMethod: picklistLoadOptionsMethod(spec.picklistDomain),
		};
		delete property.options;
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
			displayOptions: modeDisplayOptions(
				[definition.resource],
				['create'],
				PAYLOAD_MODE_INDIVIDUAL_FIELDS,
			),
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
		displayOptions: modeDisplayOptions(
			[definition.resource],
			['create'],
			PAYLOAD_MODE_INDIVIDUAL_FIELDS,
		),
	}));
}

function buildCoreUpdateFieldProperties(): INodeProperties[] {
	return Object.values(CORE_RESOURCE_DEFINITIONS).map((definition) => ({
		displayName: 'Fields to Update',
		name: updateFieldsParameterName(definition.resource),
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		options: definition.updateFields
			.filter((field) => field !== 'version')
			.map((field) => buildFieldProperty(definition, field, false)),
		displayOptions: modeDisplayOptions(
			[definition.resource],
			['update'],
			PAYLOAD_MODE_INDIVIDUAL_FIELDS,
		),
	}));
}

const CORE_CREATE_REQUIRED_PROPERTIES = buildCoreCreateRequiredProperties();
const CORE_CREATE_ADDITIONAL_PROPERTIES = buildCoreCreateAdditionalProperties();
const CORE_UPDATE_FIELD_PROPERTIES = buildCoreUpdateFieldProperties();

const JSON_OBJECT_PAYLOAD_OPERATIONS: Record<string, readonly string[]> = {
	alert: ['search', 'count', 'create', 'update', 'setTags', 'addTags'],
	incident: ['search', 'count', 'create', 'update', 'setTags', 'addTags'],
	observable: ['search', 'count', 'create', 'update', 'setTags', 'addTags'],
	knowledge: ['search', 'count', 'create', 'update', 'setTags', 'addTags'],
	tag: ['search', 'create', 'updateColor', 'bulkUpdateColor', 'bulkDelete'],
	customField: [
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
	],
};

function buildPayloadJsonObjectProperties(): INodeProperties[] {
	return Object.entries(JSON_OBJECT_PAYLOAD_OPERATIONS).flatMap(([resource, operations]) =>
		operations.map((operation) => ({
			displayName: `${fieldDisplayName(resource)} ${fieldDisplayName(operation)} JSON Object`,
			name: payloadJsonObjectParameterName(resource, operation),
			type: 'json' as const,
			default: '{}',
			description: 'Complete JSON object to submit as the request body',
			displayOptions: modeDisplayOptions([resource], [operation], PAYLOAD_MODE_JSON_OBJECT),
		})),
	);
}

const PAYLOAD_JSON_OBJECT_PROPERTIES = buildPayloadJsonObjectProperties();
const SEARCH_FIELD_DISPLAY_OPTIONS = modeDisplayOptions(
	[...CORE_RESOURCE_VALUES, 'tag', 'customField'],
	['search', 'count', 'searchDefinitions'],
	PAYLOAD_MODE_INDIVIDUAL_FIELDS,
);
const TAG_SEARCH_REQUEST_DEFINITION = {
	displayName: 'Tag',
	defaultSortBy: 'value',
	defaultSortOrder: 'asc',
	searchFields: ['id', 'usage'],
	sortFields: ['value', 'color', 'createdAt', 'updatedAt'],
} as const;
const CUSTOM_FIELD_DEFINITION_SEARCH_REQUEST_DEFINITION = {
	displayName: 'Custom Field Definition',
	defaultSortBy: 'createdAt',
	defaultSortOrder: 'desc',
	searchFields: ['id', 'entityType', 'fieldType', 'groupId', 'isRequired'],
	sortFields: ['name', 'fieldType', 'isRequired', 'createdAt', 'updatedAt'],
} as const;

function shouldOmitStructuredValue(value: unknown): boolean {
	return value === undefined || value === null || value === '';
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

function payloadMode(context: IExecuteFunctions, itemIndex: number): PayloadInputMode {
	return context.getNodeParameter(
		PAYLOAD_INPUT_MODE_PARAMETER,
		itemIndex,
		PAYLOAD_MODE_INDIVIDUAL_FIELDS,
	) as PayloadInputMode;
}

function optionalStringParameter(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() === ''
		? undefined
		: (value as string | undefined);
}

function jsonObjectPayload(
	context: IExecuteFunctions,
	itemIndex: number,
	resource: string,
	operation: string,
	label: string,
): IDataObject {
	return parseJsonObject(
		context,
		context.getNodeParameter(payloadJsonObjectParameterName(resource, operation), itemIndex, '{}'),
		label,
		itemIndex,
	);
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
		if (
			definition.resource === 'alert' &&
			!shouldOmitStructuredValue(additionalFields.incidentId)
		) {
			throw new NodeOperationError(
				context.getNode(),
				'Set the versioned incident reference in Command References.',
			);
		}
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
		if (
			definition.resource === 'alert' &&
			Object.prototype.hasOwnProperty.call(fieldsToUpdate, 'incidentId')
		) {
			throw new NodeOperationError(
				context.getNode(),
				'Set currentIncident and destinationIncident in Command References.',
			);
		}
		for (const field of definition.updateFields) {
			if (!Object.prototype.hasOwnProperty.call(fieldsToUpdate, field)) {
				continue;
			}
			const value = fieldsToUpdate[field];
			const preserveEmptyString =
				value === '' &&
				(field === 'summary' || (definition.resource === 'knowledge' && field === 'description'));
			assignStructuredField(
				context,
				structuredBody,
				structuredFields,
				definition,
				field,
				value,
				!preserveEmptyString,
				itemIndex,
			);
		}
	}

	const normalizedBody = normalizeMergedDtoBody(context, structuredBody, definition, itemIndex);

	try {
		return sanitizeDtoBody(definition, operation, normalizedBody);
	} catch (error) {
		labelStructuredDtoError(context, error, structuredFields, itemIndex);
	}
}

function buildCoreCommand(
	context: IExecuteFunctions,
	itemIndex: number,
	definition: CoreResourceDefinition,
	operation: DtoOperation,
): IDataObject {
	const isJson = payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT;
	const raw = isJson
		? jsonObjectPayload(context, itemIndex, definition.resource, operation, 'Command JSON Object')
		: undefined;
	if (raw && 'items' in raw) {
		const items = commandItems(raw.items);
		if (operation === 'update') items.forEach(validateTarget);
		return { ...raw, items };
	}
	const fields = raw
		? sanitizeDtoBody(
				definition,
				operation,
				normalizeMergedDtoBody(context, raw, definition, itemIndex),
			)
		: buildStructuredDtoBody(context, itemIndex, definition, operation);
	const references = buildCommandReferences(
		context,
		itemIndex,
		definition.resource,
		operation,
		isJson,
	);
	if (operation === 'create') return createCommand(fields, references);

	const { version, ...changes } = fields;
	if (Object.keys(changes).length === 0 && !('destinationIncident' in references)) {
		throw new NodeOperationError(
			context.getNode(),
			'Update requires at least one field to change.',
		);
	}
	if (
		definition.resource === 'alert' &&
		('detectedAt' in changes || 'destinationIncident' in references) &&
		!('currentIncident' in references)
	) {
		throw new NodeOperationError(
			context.getNode(),
			'Supply currentIncident in Command References. Use null for an unlinked alert.',
		);
	}
	const id = readTargetId(context, itemIndex, 'id', 'Record ID');
	return {
		items: [
			{ id, expectedVersion: nodeVersion(context, itemIndex, version), changes, ...references },
		],
	};
}

function buildCommandReferences(
	context: IExecuteFunctions,
	itemIndex: number,
	resource: CoreResource,
	operation: DtoOperation,
	isJson: boolean,
): IDataObject {
	const allowed =
		resource === 'alert'
			? operation === 'create'
				? ['incident']
				: ['currentIncident', 'destinationIncident', 'assigneeMembership']
			: resource === 'incident'
				? ['assigneeMembership']
				: [];
	const references =
		!isJson && allowed.length
			? parseJsonObject(
					context,
					context.getNodeParameter('payloadCommandReferences', itemIndex, '{}'),
					'Command References',
					itemIndex,
				)
			: {};
	for (const [name, reference] of Object.entries(references)) {
		if (!allowed.includes(name))
			throw new NodeOperationError(context.getNode(), `Unsupported command reference: ${name}.`);
		if (reference === null && name !== 'assigneeMembership') continue;
		if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
			throw new NodeOperationError(
				context.getNode(),
				`${name} must provide id and expectedVersion.`,
			);
		}
		validateTarget(reference as IDataObject);
	}
	return resource === 'alert' && operation === 'create'
		? { incident: null, ...references }
		: references;
}

function createCommand(data: IDataObject, references: IDataObject = {}): IDataObject {
	return { items: [{ clientRequestId: randomUUID(), data, ...references }] };
}

function nodeVersion(context: IExecuteFunctions, itemIndex: number, fallback?: unknown): number {
	const selected = context.getNodeParameter('expectedVersion', itemIndex, -1);
	return expectedVersion(selected === -1 ? fallback : selected);
}

function commandItems(value: unknown): IDataObject[] {
	if (
		!Array.isArray(value) ||
		value.length < 1 ||
		value.length > 100 ||
		value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
	) {
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			'Supply an array of 1 to 100 command items.',
		);
	}
	return value as IDataObject[];
}

function validateTarget(item: IDataObject): void {
	safePathSegment(item.id as string, 'Record ID');
	expectedVersion(item.expectedVersion);
}

function buildSearchFieldsBody(context: IExecuteFunctions, itemIndex: number): IDataObject {
	const filter = parseJsonObject(
		context,
		context.getNodeParameter('payloadSearchFilter', itemIndex, '{}'),
		'Filter',
		itemIndex,
	);
	const excludeIds = parseJsonArray(
		context,
		context.getNodeParameter('payloadSearchExcludeIds', itemIndex, '[]'),
		'Exclude IDs',
		itemIndex,
	);

	return compactObject({
		filter: Object.keys(filter).length === 0 ? undefined : filter,
		excludeIds: excludeIds.length === 0 ? undefined : excludeIds,
		pagination: {
			page: context.getNodeParameter('payloadSearchPage', itemIndex, 1),
			pageSize: context.getNodeParameter('payloadSearchPageSize', itemIndex, 25),
			sortBy: optionalStringParameter(
				context.getNodeParameter('payloadSearchSortBy', itemIndex, ''),
			),
			sortOrder: optionalStringParameter(
				context.getNodeParameter('payloadSearchSortOrder', itemIndex, ''),
			),
		},
	});
}

function buildCoreSearchBody(
	context: IExecuteFunctions,
	itemIndex: number,
	definition: CoreResourceDefinition,
	operation: 'search' | 'count',
): IDataObject {
	const input =
		payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT
			? jsonObjectPayload(
					context,
					itemIndex,
					definition.resource,
					operation,
					`${definition.displayName} ${operation} JSON Object`,
				)
			: buildSearchFieldsBody(context, itemIndex);
	return buildCollectionRequest(definition, input);
}

function buildTagPayload(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: TagOperation,
): IDataObject {
	if (operation === 'search') {
		const input =
			payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT
				? jsonObjectPayload(context, itemIndex, 'tag', operation, 'Tag JSON Object')
				: buildSearchFieldsBody(context, itemIndex);
		return buildCollectionRequest(TAG_SEARCH_REQUEST_DEFINITION, input);
	}
	if (payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT) {
		return jsonObjectPayload(context, itemIndex, 'tag', operation, 'Tag JSON Object');
	}
	if (operation === 'create') {
		return compactObject({
			value: context.getNodeParameter('payloadTagValue', itemIndex, ''),
			color: optionalStringParameter(context.getNodeParameter('payloadTagColor', itemIndex, '')),
		});
	}
	if (operation === 'updateColor') {
		return { color: context.getNodeParameter('payloadTagColor', itemIndex, '') };
	}
	if (operation === 'bulkUpdateColor' || operation === 'bulkDelete') {
		return {
			items: parseJsonArray(
				context,
				context.getNodeParameter('payloadTagItems', itemIndex, '[]'),
				'Command Items',
				itemIndex,
			) as IDataObject[],
			...(operation === 'bulkDelete'
				? { force: context.getNodeParameter('payloadTagForce', itemIndex, false) }
				: {}),
		};
	}
	return {};
}

function buildEntityTagBody(
	context: IExecuteFunctions,
	itemIndex: number,
	resource: CoreResource,
	operation: EntityTagOperation,
): IDataObject {
	const operationLabel = operation === 'setTags' ? 'Set Tags' : 'Add Tags';
	if (payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT) {
		const body = jsonObjectPayload(
			context,
			itemIndex,
			resource,
			operation,
			`${operationLabel} JSON Object`,
		);
		for (const key of Object.keys(body)) {
			if (key !== 'values') {
				throw new NodeOperationError(
					context.getNode(),
					`Unsupported ${operationLabel} JSON Object field: ${key}`,
					{ itemIndex },
				);
			}
		}
		return { values: parseEntityTagValues(context, body.values, operationLabel, itemIndex) };
	}
	return {
		values: parseEntityTagValues(
			context,
			context.getNodeParameter('payloadEntityTagValues', itemIndex, '[]'),
			operationLabel,
			itemIndex,
		),
	};
}

function buildCustomFieldBodyPayload(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: CustomFieldOperation,
): IDataObject {
	if (operation === 'searchDefinitions') {
		const input =
			payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT
				? jsonObjectPayload(
						context,
						itemIndex,
						'customField',
						operation,
						'Custom Field Definition Search JSON Object',
					)
				: buildSearchFieldsBody(context, itemIndex);
		return buildCollectionRequest(CUSTOM_FIELD_DEFINITION_SEARCH_REQUEST_DEFINITION, input);
	}
	if (
		operation === 'batchGetValues' &&
		payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT
	) {
		return customFieldBatchBody(
			context,
			jsonObjectPayload(
				context,
				itemIndex,
				'customField',
				operation,
				'Custom Field Batch Get Values JSON Object',
			),
			itemIndex,
		);
	}
	if (payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT) {
		return jsonObjectPayload(
			context,
			itemIndex,
			'customField',
			operation,
			'Custom Field JSON Object',
		);
	}
	if (operation === 'createGroup' || operation === 'updateGroup') {
		return parseJsonObject(
			context,
			context.getNodeParameter('payloadCustomFieldGroupFields', itemIndex, '{}'),
			'Custom Field Group Fields',
			itemIndex,
		);
	}
	if (operation === 'createDefinition' || operation === 'updateDefinition') {
		return parseJsonObject(
			context,
			context.getNodeParameter('payloadCustomFieldDefinitionFields', itemIndex, '{}'),
			'Custom Field Definition Fields',
			itemIndex,
		);
	}
	if (operation === 'bulkUpdateDefinitions' || operation === 'bulkDeleteDefinitions') {
		return {
			items: parseJsonArray(
				context,
				context.getNodeParameter('payloadCustomFieldItems', itemIndex, '[]'),
				'Command Items',
				itemIndex,
			) as IDataObject[],
			...(operation === 'bulkDeleteDefinitions'
				? { force: context.getNodeParameter('payloadCustomFieldDefinitionForce', itemIndex, false) }
				: {}),
		};
	}
	if (operation === 'batchGetValues') {
		return customFieldBatchBody(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityIds: context.getNodeParameter('payloadCustomFieldEntityIds', itemIndex, '[]'),
			},
			itemIndex,
		);
	}
	return {};
}

function customFieldPayloadRows(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: 'replaceValues' | 'updateSelectedValuesSafely',
): unknown[] {
	if (payloadMode(context, itemIndex) === PAYLOAD_MODE_JSON_OBJECT) {
		const body = jsonObjectPayload(
			context,
			itemIndex,
			'customField',
			operation,
			'Custom Field Values JSON Object',
		);
		if (!Array.isArray(body.values)) {
			throw new NodeOperationError(
				context.getNode(),
				'Custom Field Values JSON Object must include a values array.',
				{
					itemIndex,
				},
			);
		}
		return body.values;
	}
	return parseJsonArray(
		context,
		context.getNodeParameter('payloadCustomFieldValues', itemIndex, '[]'),
		'Custom Field Values',
		itemIndex,
	);
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

function picklistOptionFromRow(
	row: IDataObject,
	fallbackPrefix: string,
	valueTransform?: FieldSpec['picklistValueTransform'],
): INodePropertyOptions | undefined {
	if (typeof row.value !== 'string' || row.value.trim() === '') {
		return undefined;
	}
	const value = valueTransform === 'uppercase' ? row.value.toUpperCase() : row.value;
	const label =
		typeof row.label === 'string' && row.label.trim() !== ''
			? row.label
			: enumOptionDisplayName(value);
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
	const options: INodePropertyOptions[] = [];
	if (path === '/tags/auxiliary/list') {
		let cursor: string | undefined;
		for (let page = 1; page <= 100; page++) {
			const response = await client.request('GET', path, undefined, { limit: 100, cursor });
			if (!Array.isArray(response.data))
				throw new NodeOperationError(
					context.getNode(),
					'Tag catalog response must include a data array.',
				);
			options.push(...extractOptionRows(response).map((row) => optionFromRow(row, fallbackPrefix)));
			const next = response.nextCursor;
			if (typeof next !== 'string' || next === '') break;
			if (next === cursor || page === 100)
				throw new NodeOperationError(
					context.getNode(),
					'The tag catalog could not be loaded completely.',
				);
			cursor = next;
		}
	} else {
		await client.requestEachPage(path, { limit: 100 }, { method: 'GET' }, (row) =>
			options.push(optionFromRow(row, fallbackPrefix)),
		);
	}
	return options.filter((option) => option.value !== '');
}

function fieldFilter(field: string, value: string): IDataObject {
	return {
		expression: {
			operator: 'AND',
			groups: [{ operator: 'AND', conditions: [{ field, operator: 'eq', value }] }],
		},
	};
}

async function loadPicklistOptions(
	context: ILoadOptionsFunctions,
	domain: string,
	fallbackPrefix: string,
	valueTransform?: FieldSpec['picklistValueTransform'],
): Promise<INodePropertyOptions[]> {
	const client = await createHustleOpsApiClient(context, 0);
	const options: INodePropertyOptions[] = [];
	await client.requestEachPage(
		'/picklists/auxiliary/list',
		{
			filter: fieldFilter('domain', domain),
			sort: 'sortOrder',
			limit: 100,
		},
		{ method: 'GET', maxPages: 1000 },
		(row) => {
			const option = picklistOptionFromRow(row, fallbackPrefix, valueTransform);
			if (option) options.push(option);
		},
	);
	return options;
}

function readTargetId(
	context: IExecuteFunctions,
	itemIndex: number,
	name: string,
	label: string,
): string {
	return safePathSegment(context.getNodeParameter(name, itemIndex) as string, label);
}

function deleteCommand(items: IDataObject[], force: unknown): IDataObject {
	items.forEach(validateTarget);
	if (force !== undefined && typeof force !== 'boolean') {
		throw new NodeOperationError(STRUCTURED_CORE_FIELDS_NODE, 'Force must be a boolean.');
	}
	return { items, force };
}

function tagDeleteItem(item: IDataObject): IDataObject {
	const { id, expectedVersion: version, expectedUsageCounts, affectedRecords } = item;
	if (
		!expectedUsageCounts ||
		typeof expectedUsageCounts !== 'object' ||
		Array.isArray(expectedUsageCounts) ||
		!Array.isArray(affectedRecords)
	) {
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			'Each tag delete item requires expectedUsageCounts and affectedRecords from the reviewed deletion impact.',
		);
	}
	return { id, expectedVersion: version, expectedUsageCounts, affectedRecords };
}

async function executeTagOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: TagOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	if (operation === 'list' || operation === 'search') {
		if (operation === 'search') {
			const body = buildTagPayload(context, itemIndex, operation);
			const client = await createHustleOpsApiClient(context, itemIndex);
			pushPaginatedRows(
				returnData,
				await client.request('GET', '/tags', undefined, collectionQueryParams(body)),
				'Tag search response',
				itemIndex,
			);
			return;
		}
		const withCounts = context.getNodeParameter('withCounts', itemIndex, false) as boolean;
		const fields = withCounts
			? 'all'
			: ['id', 'value', 'color', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'];
		const client = await createHustleOpsApiClient(context, itemIndex);
		await client.requestEachPage('/tags', { fields, limit: 100 }, { method: 'GET' }, (row) =>
			pushResponse(returnData, row, itemIndex),
		);
		return;
	}

	const tagId = () => readTargetId(context, itemIndex, 'tagId', 'Tag ID');
	if (operation === 'getDeletionImpact') {
		const id = tagId();
		const client = await createHustleOpsApiClient(context, itemIndex);
		pushResponse(returnData, await client.request('GET', `/tags/${id}/deletion-impact`), itemIndex);
		return;
	}

	let path: string;
	let command: IDataObject;
	if (operation === 'delete') {
		const snapshot = parseJsonObject(
			context,
			context.getNodeParameter('payloadTagDeletionImpact', itemIndex, '{}'),
			'Deletion Impact',
			itemIndex,
		);
		const id = tagId();
		if (typeof snapshot.id !== 'string' || snapshot.id.toLowerCase() !== id.toLowerCase()) {
			throw new NodeOperationError(
				context.getNode(),
				'Deletion Impact must be for the selected tag.',
			);
		}
		const affectedRecords = Array.isArray(snapshot.affectedRecords)
			? snapshot.affectedRecords.map((row) => ({
					id: row?.id,
					entityType: row?.entityType,
					expectedVersion: row?.version,
				}))
			: undefined;
		command = deleteCommand(
			[
				tagDeleteItem({
					id,
					expectedVersion: snapshot.version,
					expectedUsageCounts: snapshot.usageCounts,
					affectedRecords,
				}),
			],
			context.getNodeParameter('force', itemIndex, false),
		);
		path = '/tags/delete';
	} else {
		const body = buildTagPayload(context, itemIndex, operation);
		if (operation === 'create') {
			command = createCommand(sanitizeTagBody(context, 'create', body, itemIndex));
			path = '/tags';
		} else if (operation === 'bulkDelete') {
			command = deleteCommand(commandItems(body.items).map(tagDeleteItem), body.force);
			path = '/tags/delete';
		} else if (operation === 'updateColor') {
			const { version, ...color } = body;
			command = {
				items: [
					{
						id: tagId(),
						expectedVersion: nodeVersion(context, itemIndex, version),
						changes: sanitizeTagBody(context, 'updateColor', color, itemIndex),
					},
				],
			};
			path = '/tags/update';
		} else if (operation === 'bulkUpdateColor') {
			command = {
				items: commandItems(body.items).map((item) => {
					validateTarget(item);
					return {
						id: item.id,
						expectedVersion: item.expectedVersion,
						changes: sanitizeTagBody(
							context,
							'updateColor',
							(item.changes as IDataObject) ?? {},
							itemIndex,
						),
					};
				}),
			};
			path = '/tags/update';
		} else {
			throw new NodeOperationError(context.getNode(), `Unsupported Tag operation: ${operation}`);
		}
	}
	const client = await createHustleOpsApiClient(context, itemIndex);
	pushResponse(returnData, await client.request('POST', path, command), itemIndex);
}

async function executeEntityTagOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	resource: CoreResource,
	operation: EntityTagOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	const definition = getCoreResourceDefinition(resource);
	const id = readTargetId(context, itemIndex, 'id', `${definition.displayName} ID`);
	const version = nodeVersion(context, itemIndex);
	const change =
		operation === 'removeTag'
			? { tagId: readTargetId(context, itemIndex, 'tagId', 'Tag ID') }
			: buildEntityTagBody(context, itemIndex, resource, operation);
	const action = { setTags: 'replace', addTags: 'add', removeTag: 'remove' }[operation];
	const client = await createHustleOpsApiClient(context, itemIndex);
	const response = await client.request('POST', `${definition.path}/tags/${action}`, {
		items: [{ id, expectedVersion: version, ...change }],
	});
	pushResponse(returnData, response, itemIndex);
}

function customFieldRecordPath(entityType: string): string {
	const definition = Object.values(CORE_RESOURCE_DEFINITIONS).find(
		(record) => record.entityType === entityType,
	);
	if (!definition)
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			'Unsupported custom field entity type.',
		);
	return definition.path;
}

function customFieldDeleteItem(item: IDataObject, dependencyKey: string): IDataObject {
	if (!Array.isArray(item[dependencyKey])) {
		throw new NodeOperationError(
			STRUCTURED_CORE_FIELDS_NODE,
			`Each custom field delete item requires an explicit ${dependencyKey} array.`,
		);
	}
	return {
		id: item.id,
		expectedVersion: item.expectedVersion,
		[dependencyKey]: item[dependencyKey],
	};
}

async function executeCustomFieldOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: CustomFieldOperation,
	returnData: INodeExecutionData[],
): Promise<void> {
	if (
		operation === 'listGroups' ||
		operation === 'listDefinitions' ||
		operation === 'searchDefinitions'
	) {
		const path = operation === 'listGroups' ? '/custom-fields/groups' : '/custom-fields';
		if (operation === 'searchDefinitions') {
			const input = buildCustomFieldBodyPayload(context, itemIndex, operation);
			const client = await createHustleOpsApiClient(context, itemIndex);
			pushPaginatedRows(
				returnData,
				await client.request('GET', path, undefined, collectionQueryParams(input)),
				'Custom field search response',
				itemIndex,
			);
		} else {
			const client = await createHustleOpsApiClient(context, itemIndex);
			await client.requestEachPage(path, { limit: 100 }, { method: 'GET' }, (row) =>
				pushResponse(returnData, row, itemIndex),
			);
		}
		return;
	}

	if (operation === 'batchGetValues') {
		const body = buildCustomFieldBodyPayload(context, itemIndex, operation);
		const path = customFieldRecordPath(String(body.entityType));
		const client = await createHustleOpsApiClient(context, itemIndex);
		const data: IDataObject[] = [];
		for (const entityId of body.entityIds as string[]) {
			data.push(
				await client.request(
					'GET',
					`${path}/${safePathSegment(entityId, 'Entity ID')}/custom-fields`,
				),
			);
		}
		pushResponse(returnData, { data }, itemIndex);
		return;
	}

	if (
		operation === 'getValues' ||
		operation === 'getAvailable' ||
		operation === 'replaceValues' ||
		operation === 'updateSelectedValuesSafely'
	) {
		const { entityId, entityType } = customFieldEntityScope(
			context,
			{
				entityType: context.getNodeParameter('entityType', itemIndex),
				entityId: context.getNodeParameter('entityId', itemIndex),
			},
			itemIndex,
		);
		const path = customFieldRecordPath(entityType);
		const id = safePathSegment(entityId, 'Entity ID');
		const readPath = `${path}/${id}/custom-fields`;

		if (operation === 'getValues' || operation === 'getAvailable') {
			const client = await createHustleOpsApiClient(context, itemIndex);
			const snapshot = await client.request('GET', readPath);
			if (operation === 'getValues') {
				pushResponse(returnData, snapshot, itemIndex);
			} else {
				const definitions: IDataObject[] = [];
				await client.requestEachPage(
					'/custom-fields/auxiliary/list',
					{ filter: fieldFilter('entityType', entityType), limit: 100 },
					{ method: 'GET' },
					(row) => definitions.push(row),
				);
				pushResponse(returnData, { ...snapshot, definitions }, itemIndex);
			}
			return;
		}

		const selectedValues = parseCustomFieldValues(
			context,
			customFieldPayloadRows(context, itemIndex, operation),
			itemIndex,
		);
		const merge = operation === 'updateSelectedValuesSafely';
		if (merge && selectedValues.length === 0) {
			throw new NodeOperationError(
				context.getNode(),
				'Update Selected Values Safely requires at least one custom field value.',
			);
		}
		const submittedVersion = merge ? undefined : nodeVersion(context, itemIndex);
		const client = await createHustleOpsApiClient(context, itemIndex);
		const snapshot = merge ? await client.request('GET', readPath) : undefined;
		if (
			snapshot &&
			(typeof snapshot.id !== 'string' || snapshot.id.toLowerCase() !== id.toLowerCase())
		) {
			throw new NodeOperationError(
				context.getNode(),
				'The custom field snapshot does not match the selected entity.',
			);
		}
		const version = snapshot ? expectedVersion(snapshot.version) : submittedVersion;
		const values = snapshot
			? mergeCustomFieldValues(extractAttachedCustomFieldValues(snapshot.values), selectedValues)
			: selectedValues;
		pushResponse(
			returnData,
			await client.request('POST', `${path}/custom-fields/update`, {
				items: [{ id, expectedVersion: version, values }],
			}),
			itemIndex,
		);
		return;
	}

	const group =
		operation === 'createGroup' ||
		operation === 'updateGroup' ||
		operation === 'deleteGroup' ||
		operation === 'getGroupDependencies';
	const path = group ? '/custom-fields/groups' : '/custom-fields';
	const targetId = () =>
		readTargetId(
			context,
			itemIndex,
			group ? 'customFieldGroupId' : 'customFieldDefinitionId',
			group ? 'Custom field group ID' : 'Custom field definition ID',
		);

	if (operation === 'getGroupDependencies' || operation === 'getDefinitionDependencies') {
		const id = targetId();
		const client = await createHustleOpsApiClient(context, itemIndex);
		const target = await client.request('GET', `${path}/${id}`);
		const dependencies: IDataObject[] = [];
		await client.requestEachPage(
			`${path}/${id}/dependencies`,
			{ limit: 100 },
			{ method: 'GET' },
			(row) => dependencies.push(row),
		);
		const affectedRecords = dependencies.map((dependency) => ({
			id: dependency.id,
			expectedVersion: dependency.version,
			...(group ? {} : { entityType: dependency.recordType }),
		}));
		pushResponse(
			returnData,
			{
				id: target.id,
				version: expectedVersion(target.version),
				[group ? 'affectedDefinitions' : 'affectedEntities']: affectedRecords,
			},
			itemIndex,
		);
		return;
	}

	let command: IDataObject;
	let action: string;
	if (operation === 'deleteGroup' || operation === 'deleteDefinition') {
		const dependencyKey = group ? 'affectedDefinitions' : 'affectedEntities';
		const dependencies = parseJsonArray(
			context,
			context.getNodeParameter('payloadCustomFieldDependencies', itemIndex, '[]'),
			'Affected Records',
			itemIndex,
		);
		command = deleteCommand(
			[
				customFieldDeleteItem(
					{
						id: targetId(),
						expectedVersion: nodeVersion(context, itemIndex),
						[dependencyKey]: dependencies as IDataObject[],
					},
					dependencyKey,
				),
			],
			context.getNodeParameter('force', itemIndex, false),
		);
		action = '/delete';
	} else {
		const body = buildCustomFieldBodyPayload(context, itemIndex, operation);
		if (operation === 'createGroup' || operation === 'createDefinition') {
			command = createCommand(
				group
					? sanitizeCustomFieldGroupBody(context, body, true, itemIndex)
					: sanitizeCustomFieldDefinitionBody(context, body, 'create', itemIndex),
			);
			action = '';
		} else if (operation === 'updateGroup' || operation === 'updateDefinition') {
			const { version, ...fields } = body;
			const changes = group
				? sanitizeCustomFieldGroupBody(context, fields, false, itemIndex)
				: sanitizeCustomFieldDefinitionBody(context, fields, 'update', itemIndex);
			command = {
				items: [
					{ id: targetId(), expectedVersion: nodeVersion(context, itemIndex, version), changes },
				],
			};
			action = '/update';
		} else if (operation === 'bulkUpdateDefinitions') {
			command = {
				items: commandItems(body.items).map((item) => {
					validateTarget(item);
					return {
						id: item.id,
						expectedVersion: item.expectedVersion,
						changes: sanitizeCustomFieldDefinitionBody(
							context,
							(item.changes as IDataObject) ?? {},
							'update',
							itemIndex,
						),
					};
				}),
			};
			action = '/update';
		} else if (operation === 'bulkDeleteDefinitions') {
			command = deleteCommand(
				commandItems(body.items).map((item) => customFieldDeleteItem(item, 'affectedEntities')),
				body.force,
			);
			action = '/delete';
		} else {
			throw new NodeOperationError(
				context.getNode(),
				`Unsupported Custom Field operation: ${operation}`,
			);
		}
	}
	const client = await createHustleOpsApiClient(context, itemIndex);
	pushResponse(returnData, await client.request('POST', `${path}${action}`, command), itemIndex);
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
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				default: '',
				required: true,
				description: 'HustleOps object ID',
				displayOptions: modeDisplayOptions(
					CORE_RESOURCE_VALUES,
					['update'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				default: '',
				description:
					'Record ID for a flat update object. The command envelope provides its own target IDs.',
				displayOptions: modeDisplayOptions(
					CORE_RESOURCE_VALUES,
					['update'],
					PAYLOAD_MODE_JSON_OBJECT,
				),
			},
			{
				displayName: 'Expected Version',
				name: 'expectedVersion',
				type: 'number',
				default: -1,
				required: true,
				description:
					'Version from the record read. Enter 0 for a newly created record at version 0.',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
						operation: ['update', 'setTags', 'addTags', 'removeTag'],
					},
				},
			},
			{
				displayName: 'Expected Version',
				name: 'expectedVersion',
				type: 'number',
				default: -1,
				required: true,
				description: 'Version from the corresponding HustleOps read',
				displayOptions: {
					show: {
						resource: ['tag', 'customField'],
						operation: [
							'updateColor',
							'updateGroup',
							'updateDefinition',
							'deleteGroup',
							'deleteDefinition',
							'replaceValues',
						],
					},
				},
			},
			{
				displayName: 'Input Mode',
				name: PAYLOAD_INPUT_MODE_PARAMETER,
				type: 'options',
				default: PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				options: [...PAYLOAD_INPUT_MODE_OPTIONS],
				displayOptions: payloadModeDisplayOptions(
					[...CORE_RESOURCE_VALUES, 'tag', 'customField'],
					PAYLOAD_OPERATION_VALUES,
				),
			},
			{
				displayName: 'Command References',
				name: 'payloadCommandReferences',
				type: 'json',
				default: '{}',
				description:
					'Versioned incident or assignee membership references required by the selected change',
				displayOptions: modeDisplayOptions(
					['alert', 'incident'],
					['create', 'update'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			...CORE_CREATE_REQUIRED_PROPERTIES,
			...CORE_CREATE_ADDITIONAL_PROPERTIES,
			...CORE_UPDATE_FIELD_PROPERTIES,
			...PAYLOAD_JSON_OBJECT_PROPERTIES,
			{
				displayName: 'Filter',
				name: 'payloadSearchFilter',
				type: 'json',
				default: '{}',
				description: 'Collection filter with optional query and expression. Leave {} to omit it.',
				displayOptions: SEARCH_FIELD_DISPLAY_OPTIONS,
			},
			{
				displayName: 'Page',
				name: 'payloadSearchPage',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1,
				description: 'Search result page to request',
				displayOptions: SEARCH_FIELD_DISPLAY_OPTIONS,
			},
			{
				displayName: 'Page Size',
				name: 'payloadSearchPageSize',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 25,
				description: 'Number of search rows to request per page',
				displayOptions: SEARCH_FIELD_DISPLAY_OPTIONS,
			},
			{
				displayName: 'Sort By',
				name: 'payloadSearchSortBy',
				type: 'string',
				default: '',
				description: 'Optional sort field. Leave empty to use the resource default.',
				displayOptions: SEARCH_FIELD_DISPLAY_OPTIONS,
			},
			{
				displayName: 'Sort Order',
				name: 'payloadSearchSortOrder',
				type: 'options',
				default: '',
				options: [
					{
						name: 'Ascending',
						value: 'asc',
					},
					{
						name: 'Default',
						value: '',
					},
					{
						name: 'Descending',
						value: 'desc',
					},
				],
				description: 'Optional sort direction. Leave empty to use the resource default.',
				displayOptions: SEARCH_FIELD_DISPLAY_OPTIONS,
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
					'Whether Search should return the raw paginated response with data, page, limit, itemsTotal, filteredCount, and totalPages instead of only data rows',
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
				description: 'Whether to include usage counts for each tag',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['list'],
					},
				},
			},
			{
				displayName: 'Tag Values',
				name: 'payloadEntityTagValues',
				type: 'json',
				default: '[]',
				description:
					'JSON array of tag values. Set Tags accepts an empty array to clear all tags; Add Tags requires at least one value.',
				displayOptions: modeDisplayOptions(
					CORE_RESOURCE_VALUES,
					['setTags', 'addTags'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Tag Value',
				name: 'payloadTagValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: modeDisplayOptions(['tag'], ['create'], PAYLOAD_MODE_INDIVIDUAL_FIELDS),
			},
			{
				displayName: 'Tag Color',
				name: 'payloadTagColor',
				type: 'color',
				default: '',
				description: 'Optional tag color',
				displayOptions: modeDisplayOptions(
					['tag'],
					['create', 'updateColor'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Command Items',
				name: 'payloadTagItems',
				type: 'json',
				default: '[]',
				description:
					'JSON array of versioned tag targets. Updates need changes.color. Deletes need expectedUsageCounts and affectedRecords.',
				displayOptions: modeDisplayOptions(
					['tag'],
					['bulkUpdateColor', 'bulkDelete'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Force',
				name: 'payloadTagForce',
				type: 'boolean',
				default: false,
				description: 'Whether to force bulk deletion',
				displayOptions: modeDisplayOptions(['tag'], ['bulkDelete'], PAYLOAD_MODE_INDIVIDUAL_FIELDS),
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
						operation: ['updateColor', 'delete', 'getDeletionImpact', 'removeTag'],
					},
				},
			},
			{
				displayName: 'Deletion Impact',
				name: 'payloadTagDeletionImpact',
				type: 'json',
				default: '{}',
				required: true,
				description: 'Reviewed response from Get Deletion Impact for the selected tag',
				displayOptions: { show: { resource: ['tag'], operation: ['delete'] } },
			},
			{
				displayName: 'Affected Records',
				name: 'payloadCustomFieldDependencies',
				type: 'json',
				default: '[]',
				description:
					'Reviewed dependencies with an ID and expected version. Definitions also require the entity type for each record.',
				displayOptions: {
					show: { resource: ['customField'], operation: ['deleteGroup', 'deleteDefinition'] },
				},
			},
			{
				displayName: 'Force',
				name: 'force',
				type: 'boolean',
				default: false,
				description: 'Whether to allow deletion with the reviewed dependencies still in use',
				displayOptions: {
					show: {
						resource: ['tag', 'customField'],
						operation: ['delete', 'deleteGroup', 'deleteDefinition'],
					},
				},
			},
			{
				displayName: 'Custom Field Group Fields',
				name: 'payloadCustomFieldGroupFields',
				type: 'json',
				default: '{}',
				description: 'Custom field group fields as a JSON object',
				displayOptions: modeDisplayOptions(
					['customField'],
					['createGroup', 'updateGroup'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Custom Field Definition Fields',
				name: 'payloadCustomFieldDefinitionFields',
				type: 'json',
				default: '{}',
				description: 'Custom field definition fields as a JSON object',
				displayOptions: modeDisplayOptions(
					['customField'],
					['createDefinition', 'updateDefinition'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Command Items',
				name: 'payloadCustomFieldItems',
				type: 'json',
				default: '[]',
				description:
					'JSON array of versioned definition targets with changes for updates or affectedEntities for deletion',
				displayOptions: modeDisplayOptions(
					['customField'],
					['bulkUpdateDefinitions', 'bulkDeleteDefinitions'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Force',
				name: 'payloadCustomFieldDefinitionForce',
				type: 'boolean',
				default: false,
				description: 'Whether to force bulk deletion of custom field definitions',
				displayOptions: modeDisplayOptions(
					['customField'],
					['bulkDeleteDefinitions'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Custom Field Values',
				name: 'payloadCustomFieldValues',
				type: 'json',
				default: '[]',
				description:
					'JSON array of { fieldId, value, fieldType? } objects. Array values are serialized as MULTI_SELECT JSON strings before sending.',
				displayOptions: modeDisplayOptions(
					['customField'],
					['replaceValues', 'updateSelectedValuesSafely'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
			},
			{
				displayName: 'Entity IDs',
				name: 'payloadCustomFieldEntityIds',
				type: 'json',
				default: '[]',
				required: true,
				description: 'JSON array of up to 100 entity UUIDs for batch custom field values',
				displayOptions: modeDisplayOptions(
					['customField'],
					['batchGetValues'],
					PAYLOAD_MODE_INDIVIDUAL_FIELDS,
				),
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
						operation: ['updateGroup', 'deleteGroup', 'getGroupDependencies'],
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
						operation: ['updateDefinition', 'deleteDefinition', 'getDefinitionDependencies'],
					},
				},
			},
			{
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'options',
				default: 'INCIDENT',
				required: true,
				description: 'Type of HustleOps entity for the custom field operation',
				options: CUSTOM_FIELD_ENTITY_TYPE_OPTIONS,
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: [
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
				description: 'HustleOps entity UUID for the custom field operation',
				displayOptions: {
					show: {
						resource: ['customField'],
						operation: ['getValues', 'getAvailable', 'replaceValues', 'updateSelectedValuesSafely'],
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
				return loadOptionsFromPath(this, '/tags/auxiliary/list', 'Tag');
			},
			async getCustomFieldDefinitionOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				return loadOptionsFromPath(this, '/custom-fields', 'Custom Field');
			},
			async getAlertTypeOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'alertType', 'Alert Type');
			},
			async getAlertStatusOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'alertStatus', 'Alert Status');
			},
			async getIncidentStatusOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'incidentStatus', 'Incident Status');
			},
			async getIncidentCategoryOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'incidentCategory', 'Incident Category');
			},
			async getObservableTypeOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const options = await loadPicklistOptions(this, 'observableType', 'Observable Type');
				return options.filter((option) => !isFileObservableType(option.value));
			},
			async getThreatLevelOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'threatLevel', 'Threat Level', 'uppercase');
			},
			async getCriticalityOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'criticality', 'Criticality', 'uppercase');
			},
			async getKnowledgeTypeOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadPicklistOptions(this, 'knowledgeType', 'Knowledge Type');
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
				const operation = this.getNodeParameter('operation', itemIndex) as HustleOpsOperation;

				if (resource === 'comment') {
					throw new NodeOperationError(
						this.getNode(),
						'HustleOps removed the Comment API. Select a supported resource for this node.',
						{ itemIndex },
					);
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

				if (coreOperation === 'create' || coreOperation === 'update') {
					const body = buildCoreCommand(this, itemIndex, definition, coreOperation);
					const client = await createHustleOpsApiClient(this, itemIndex);
					const path = coreOperation === 'create' ? definition.path : `${definition.path}/update`;
					pushResponse(returnData, await client.request('POST', path, body), itemIndex);
					continue;
				}

				const searchRequestBody = buildCoreSearchBody(this, itemIndex, definition, coreOperation);
				const searchPath = `${definition.path}/search`;
				const client = await createHustleOpsApiClient(this, itemIndex);

				if (coreOperation === 'count') {
					const response = await client.request('POST', searchPath, {
						filter: searchRequestBody.filter,
						fields: 'none',
						include: ['filteredCount'],
					});
					const count = response.filteredCount;
					if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
						throw new NodeOperationError(
							this.getNode(),
							'Search response is missing the requested filtered count.',
							{ itemIndex },
						);
					}
					pushResponse(returnData, { count }, itemIndex);
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
						searchPath,
						searchRequestBody,
						{ maxItems, maxPages },
						(row) => returnData.push({ json: row, pairedItem: { item: itemIndex } }),
					);
					continue;
				}

				const includePaginationMetadata = this.getNodeParameter(
					'includePaginationMetadata',
					itemIndex,
					false,
				) as boolean;
				const body =
					includePaginationMetadata && searchRequestBody.include === undefined
						? { ...searchRequestBody, include: ['itemsTotal', 'filteredCount'] }
						: searchRequestBody;
				const response = assertPaginatedResponse(
					await client.request('POST', searchPath, body),
					`${definition.displayName} search response`,
				);

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
