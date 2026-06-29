import type { IDataObject, IExecuteFunctions, INode, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { assertUuid, compactObject, parseJsonArray } from './GenericFunctions';
import { CORE_RESOURCE_DEFINITIONS } from './resourceDefinitions';

export type CustomFieldOperation =
	| 'listGroups'
	| 'createGroup'
	| 'updateGroup'
	| 'deleteGroup'
	| 'listDefinitions'
	| 'searchDefinitions'
	| 'createDefinition'
	| 'updateDefinition'
	| 'bulkUpdateDefinitions'
	| 'deleteDefinition'
	| 'bulkDeleteDefinitions'
	| 'getValues'
	| 'getAvailable'
	| 'batchGetValues'
	| 'replaceValues'
	| 'updateSelectedValuesSafely';

export type CustomFieldEntityType = 'ALERT' | 'INCIDENT' | 'OBSERVABLE' | 'KNOWLEDGE';
type CustomFieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'URL';
type ValidationContext = Pick<IExecuteFunctions, 'getNode'>;

const CUSTOM_FIELD_ENTITY_TYPES = Object.values(CORE_RESOURCE_DEFINITIONS).map(
	(definition) => definition.entityType,
) as CustomFieldEntityType[];
const CUSTOM_FIELD_ENTITY_TYPE_SET = new Set<string>(CUSTOM_FIELD_ENTITY_TYPES);
const CUSTOM_FIELD_TYPES = new Set<string>([
	'TEXT',
	'NUMBER',
	'BOOLEAN',
	'SELECT',
	'MULTI_SELECT',
	'DATE',
	'URL',
]);
const GROUP_FIELDS = new Set(['name', 'description', 'sortOrder']);
const CREATE_DEFINITION_FIELDS = new Set([
	'name',
	'description',
	'fieldType',
	'isRequired',
	'defaultValue',
	'options',
	'entityTypes',
	'groupId',
	'sortOrder',
]);
const UPDATE_DEFINITION_FIELDS = new Set([
	'name',
	'description',
	'isRequired',
	'defaultValue',
	'options',
	'entityTypes',
	'groupId',
	'sortOrder',
]);
const BULK_UPDATE_DEFINITION_FIELDS = new Set(['ids', 'isRequired', 'groupId']);
const BULK_DELETE_DEFINITION_FIELDS = new Set(['ids', 'force']);
const MAX_BULK_IDS = 100;

const CUSTOM_FIELD_DEFINITION_NODE: INode = {
	id: 'hustleops-custom-field-definitions',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export const CUSTOM_FIELD_RESOURCE_OPTION: INodePropertyOptions = {
	name: 'Custom Field',
	value: 'customField',
	description: 'Custom field groups, definitions, and entity values',
};

export const CUSTOM_FIELD_OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'List Groups',
		value: 'listGroups',
		description: 'List custom field groups',
		action: 'List custom field groups',
	},
	{
		name: 'Create Group',
		value: 'createGroup',
		description: 'Create a custom field group. Requires Admin.',
		action: 'Create a custom field group',
	},
	{
		name: 'Update Group',
		value: 'updateGroup',
		description: 'Update a custom field group. Requires Admin.',
		action: 'Update a custom field group',
	},
	{
		name: 'Delete Group',
		value: 'deleteGroup',
		description: 'Delete a custom field group. Requires Admin.',
		action: 'Delete a custom field group',
	},
	{
		name: 'List Definitions',
		value: 'listDefinitions',
		description: 'List custom field definitions',
		action: 'List custom field definitions',
	},
	{
		name: 'Search Definitions',
		value: 'searchDefinitions',
		description: 'Search custom field definitions. Requires Admin.',
		action: 'Search custom field definitions',
	},
	{
		name: 'Create Definition',
		value: 'createDefinition',
		description: 'Create a custom field definition. Requires Admin.',
		action: 'Create a custom field definition',
	},
	{
		name: 'Update Definition',
		value: 'updateDefinition',
		description: 'Update a custom field definition except immutable fieldType. Requires Admin.',
		action: 'Update a custom field definition',
	},
	{
		name: 'Bulk Update Definitions',
		value: 'bulkUpdateDefinitions',
		description: 'Bulk update custom field definition required state or group. Requires Admin.',
		action: 'Bulk update custom field definitions',
	},
	{
		name: 'Delete Definition',
		value: 'deleteDefinition',
		description: 'Delete one custom field definition. Requires Admin.',
		action: 'Delete a custom field definition',
	},
	{
		name: 'Bulk Delete Definitions',
		value: 'bulkDeleteDefinitions',
		description: 'Delete multiple custom field definitions. Requires Admin.',
		action: 'Bulk delete custom field definitions',
	},
	{
		name: 'Get Values',
		value: 'getValues',
		description: 'Get custom field values for one entity',
		action: 'Get custom field values',
	},
	{
		name: 'Get Available',
		value: 'getAvailable',
		description: 'Get applicable custom field definitions plus values for one entity',
		action: 'Get available custom fields',
	},
	{
		name: 'Batch Get Values',
		value: 'batchGetValues',
		description: 'Get custom field values for up to 100 entity IDs',
		action: 'Batch get custom field values',
	},
	{
		name: 'Replace Values',
		value: 'replaceValues',
		description: 'Replace the attached custom field value set for one entity',
		action: 'Replace custom field values',
	},
	{
		name: 'Update Selected Values Safely',
		value: 'updateSelectedValuesSafely',
		description:
			'Read current values, merge selected field changes, and send the complete attached set',
		action: 'Safely update selected custom field values',
	},
];

export const CUSTOM_FIELD_ENTITY_TYPE_OPTIONS: INodePropertyOptions[] =
	CUSTOM_FIELD_ENTITY_TYPES.map((entityType) => ({
		name: entityType.charAt(0) + entityType.slice(1).toLowerCase(),
		value: entityType,
		description: `Custom fields for ${entityType.toLowerCase()} entities`,
	}));

function nodeError(
	context: ValidationContext,
	message: string,
	itemIndex: number,
): NodeOperationError {
	return new NodeOperationError(context.getNode?.() ?? CUSTOM_FIELD_DEFINITION_NODE, message, {
		itemIndex,
	});
}

function assertAllowedKeys(
	context: ValidationContext,
	label: string,
	body: IDataObject,
	allowedFields: Set<string>,
	itemIndex: number,
): void {
	for (const key of Object.keys(body)) {
		if (!allowedFields.has(key)) {
			throw nodeError(context, `Unsupported Custom Field ${label} field: ${key}`, itemIndex);
		}
	}
}

function requireString(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw nodeError(context, `${label} is required.`, itemIndex);
	}
	return value;
}

function optionalString(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw nodeError(context, `${label} must be a string.`, itemIndex);
	}
	return value;
}

function optionalNumber(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): number | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw nodeError(context, `${label} must be a number.`, itemIndex);
	}
	return value;
}

function optionalBoolean(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'boolean') {
		throw nodeError(context, `${label} must be a boolean.`, itemIndex);
	}
	return value;
}

function requireUuid(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	try {
		return assertUuid(value, label);
	} catch {
		throw nodeError(context, `${label} must be a valid UUID.`, itemIndex);
	}
}

function optionalUuid(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string | null | undefined {
	if (value === undefined || value === '') {
		return undefined;
	}
	if (value === null) {
		return null;
	}
	return requireUuid(context, value, label, itemIndex);
}

function requireEntityType(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): CustomFieldEntityType {
	if (typeof value !== 'string' || !CUSTOM_FIELD_ENTITY_TYPE_SET.has(value)) {
		throw nodeError(
			context,
			`Custom field entity type must be one of: ${CUSTOM_FIELD_ENTITY_TYPES.join(', ')}.`,
			itemIndex,
		);
	}
	return value as CustomFieldEntityType;
}

function entityTypes(
	context: ValidationContext,
	value: unknown,
	required: boolean,
	itemIndex: number,
): CustomFieldEntityType[] | undefined {
	if (value === undefined || value === null) {
		if (required) {
			throw nodeError(context, 'Custom field definition entityTypes is required.', itemIndex);
		}
		return undefined;
	}
	if (!Array.isArray(value) || value.length === 0) {
		throw nodeError(
			context,
			'Custom field definition entityTypes must contain at least one entity type.',
			itemIndex,
		);
	}
	return value.map((entityType) => requireEntityType(context, entityType, itemIndex));
}

function definitionOptions(
	context: ValidationContext,
	value: unknown,
	fieldType: unknown,
	required: boolean,
	itemIndex: number,
): string[] | undefined {
	if (value === undefined || value === null) {
		if (required && (fieldType === 'SELECT' || fieldType === 'MULTI_SELECT')) {
			throw nodeError(
				context,
				'Custom field definition options are required for SELECT and MULTI_SELECT.',
				itemIndex,
			);
		}
		return undefined;
	}
	if (!Array.isArray(value) || value.some((option) => typeof option !== 'string')) {
		throw nodeError(
			context,
			'Custom field definition options must be an array of strings.',
			itemIndex,
		);
	}
	return value;
}

function definitionIds(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw nodeError(context, `${label} must contain at least one ID.`, itemIndex);
	}
	if (value.length > MAX_BULK_IDS) {
		throw nodeError(context, `${label} cannot contain more than ${MAX_BULK_IDS} IDs.`, itemIndex);
	}
	return value.map((id) => requireUuid(context, id, 'Custom field definition ID', itemIndex));
}

function requireFieldType(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): CustomFieldType {
	if (typeof value !== 'string' || !CUSTOM_FIELD_TYPES.has(value)) {
		throw nodeError(context, 'Custom field definition fieldType is required.', itemIndex);
	}
	return value as CustomFieldType;
}

export function sanitizeCustomFieldGroupBody(
	context: ValidationContext,
	body: IDataObject,
	required: boolean,
	itemIndex: number,
): IDataObject {
	assertAllowedKeys(context, 'group', body, GROUP_FIELDS, itemIndex);
	const sanitized = compactObject({
		name: required
			? requireString(context, body.name, 'Custom field group name', itemIndex)
			: optionalString(context, body.name, 'Custom field group name', itemIndex),
		description: optionalString(
			context,
			body.description,
			'Custom field group description',
			itemIndex,
		),
		sortOrder: optionalNumber(context, body.sortOrder, 'Custom field group sortOrder', itemIndex),
	});
	if (!required && Object.keys(sanitized).length === 0) {
		throw nodeError(
			context,
			'Custom field group update body must include at least one field.',
			itemIndex,
		);
	}
	return sanitized;
}

export function sanitizeCustomFieldDefinitionBody(
	context: ValidationContext,
	body: IDataObject,
	operation: 'create' | 'update',
	itemIndex: number,
): IDataObject {
	if (operation === 'update' && Object.prototype.hasOwnProperty.call(body, 'fieldType')) {
		throw nodeError(context, 'Custom field definition fieldType is immutable.', itemIndex);
	}

	const allowedFields =
		operation === 'create' ? CREATE_DEFINITION_FIELDS : UPDATE_DEFINITION_FIELDS;
	assertAllowedKeys(context, 'definition', body, allowedFields, itemIndex);
	const fieldType =
		operation === 'create' ? requireFieldType(context, body.fieldType, itemIndex) : undefined;
	const sanitized = compactObject({
		name:
			operation === 'create'
				? requireString(context, body.name, 'Custom field definition name', itemIndex)
				: optionalString(context, body.name, 'Custom field definition name', itemIndex),
		description: optionalString(
			context,
			body.description,
			'Custom field definition description',
			itemIndex,
		),
		fieldType,
		isRequired: optionalBoolean(
			context,
			body.isRequired,
			'Custom field definition isRequired',
			itemIndex,
		),
		defaultValue: optionalString(
			context,
			body.defaultValue,
			'Custom field definition defaultValue',
			itemIndex,
		),
		options: definitionOptions(context, body.options, fieldType, operation === 'create', itemIndex),
		entityTypes: entityTypes(context, body.entityTypes, operation === 'create', itemIndex),
		groupId: optionalUuid(context, body.groupId, 'Custom field group ID', itemIndex),
		sortOrder: optionalNumber(
			context,
			body.sortOrder,
			'Custom field definition sortOrder',
			itemIndex,
		),
	});

	if (operation === 'update' && Object.keys(sanitized).length === 0) {
		throw nodeError(
			context,
			'Custom field definition update body must include at least one field.',
			itemIndex,
		);
	}

	return sanitized;
}

export function sanitizeCustomFieldDefinitionBulkUpdate(
	context: ValidationContext,
	body: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedKeys(
		context,
		'definition bulk update',
		body,
		BULK_UPDATE_DEFINITION_FIELDS,
		itemIndex,
	);
	return compactObject({
		ids: definitionIds(context, body.ids, 'Custom field definition bulk update IDs', itemIndex),
		isRequired: optionalBoolean(
			context,
			body.isRequired,
			'Custom field definition isRequired',
			itemIndex,
		),
		groupId: optionalUuid(context, body.groupId, 'Custom field group ID', itemIndex),
	});
}

export function sanitizeCustomFieldDefinitionBulkDelete(
	context: ValidationContext,
	body: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedKeys(
		context,
		'definition bulk delete',
		body,
		BULK_DELETE_DEFINITION_FIELDS,
		itemIndex,
	);
	return compactObject({
		ids: definitionIds(context, body.ids, 'Custom field definition bulk delete IDs', itemIndex),
		force: optionalBoolean(
			context,
			body.force,
			'Custom field definition bulk delete force',
			itemIndex,
		),
	});
}

export function parseCustomFieldEntityIds(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): string[] {
	const ids = parseJsonArray(context, value, 'Entity IDs', itemIndex);
	if (ids.length === 0) {
		throw nodeError(context, 'Custom field batch requires at least one entity ID.', itemIndex);
	}
	if (ids.length > MAX_BULK_IDS) {
		throw nodeError(
			context,
			`Custom field batch cannot contain more than ${MAX_BULK_IDS} IDs.`,
			itemIndex,
		);
	}
	return ids.map((id) => requireUuid(context, id, 'Custom field entity ID', itemIndex));
}

function validateFieldValueByType(
	context: ValidationContext,
	fieldType: CustomFieldType | undefined,
	value: string,
	itemIndex: number,
): void {
	if (fieldType === 'BOOLEAN' && value !== 'true' && value !== 'false') {
		throw nodeError(context, 'BOOLEAN custom field values must be "true" or "false".', itemIndex);
	}
	if (fieldType === 'MULTI_SELECT') {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
				throw new Error('not a string array');
			}
		} catch {
			throw nodeError(
				context,
				'MULTI_SELECT custom field values must be a JSON array string.',
				itemIndex,
			);
		}
	}
	if (fieldType === 'NUMBER' && (value.trim() === '' || Number.isNaN(Number(value)))) {
		throw nodeError(context, 'NUMBER custom field values must parse as a number.', itemIndex);
	}
	if (fieldType === 'DATE' && Number.isNaN(Date.parse(value))) {
		throw nodeError(context, 'DATE custom field values must parse as an ISO date.', itemIndex);
	}
	if (fieldType === 'URL') {
		try {
			new URL(value);
		} catch {
			throw nodeError(context, 'URL custom field values must be valid URLs.', itemIndex);
		}
	}
}

function serializeCustomFieldValue(
	context: ValidationContext,
	fieldType: CustomFieldType | undefined,
	value: unknown,
	itemIndex: number,
): string | null {
	if (value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		if (fieldType && fieldType !== 'MULTI_SELECT') {
			throw nodeError(context, 'Only MULTI_SELECT custom fields accept array values.', itemIndex);
		}
		if (value.some((entry) => typeof entry !== 'string')) {
			throw nodeError(
				context,
				'MULTI_SELECT custom field arrays must contain only strings.',
				itemIndex,
			);
		}
		return JSON.stringify(value);
	}
	if (fieldType === 'NUMBER' && typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value !== 'string') {
		throw nodeError(context, 'Custom field values must be strings or null.', itemIndex);
	}
	validateFieldValueByType(context, fieldType, value, itemIndex);
	return value;
}

export function parseCustomFieldValues(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): Array<{ fieldId: string; value: string | null }> {
	return parseJsonArray(context, value, 'Custom Field Values', itemIndex).map((entry) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw nodeError(context, 'Each custom field value must be an object.', itemIndex);
		}
		const valueEntry = entry as IDataObject;
		const fieldType =
			valueEntry.fieldType === undefined
				? undefined
				: requireFieldType(context, valueEntry.fieldType, itemIndex);
		return {
			fieldId: requireUuid(context, valueEntry.fieldId, 'Custom field definition ID', itemIndex),
			value: serializeCustomFieldValue(context, fieldType, valueEntry.value, itemIndex),
		};
	});
}

export function customFieldEntityScope(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): { entityType: CustomFieldEntityType; entityId: string } {
	return {
		entityType: requireEntityType(context, input.entityType, itemIndex),
		entityId: requireUuid(context, input.entityId, 'Custom field entity ID', itemIndex),
	};
}

export function customFieldBatchBody(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): IDataObject {
	return {
		entityType: requireEntityType(context, input.entityType, itemIndex),
		entityIds: parseCustomFieldEntityIds(context, input.entityIds, itemIndex),
	};
}

export function extractAttachedCustomFieldValues(
	value: unknown,
): Array<{ fieldId: string; value: string | null }> {
	const container = value as IDataObject;
	const rows = Array.isArray(value)
		? value
		: Array.isArray(container?.values)
			? container.values
			: Array.isArray(container?.data)
				? container.data
				: [];

	return rows
		.filter((row): row is IDataObject => !!row && typeof row === 'object' && !Array.isArray(row))
		.filter(
			(row) =>
				typeof row.fieldId === 'string' && Object.prototype.hasOwnProperty.call(row, 'value'),
		)
		.map((row) => ({
			fieldId: row.fieldId as string,
			value: row.value === null ? null : String(row.value),
		}));
}

export function mergeCustomFieldValues(
	existing: Array<{ fieldId: string; value: string | null }>,
	updates: Array<{ fieldId: string; value: string | null }>,
): Array<{ fieldId: string; value: string | null }> {
	const updatesByFieldId = new Map(updates.map((value) => [value.fieldId, value]));
	const merged = existing.map((value) => updatesByFieldId.get(value.fieldId) ?? value);
	const existingIds = new Set(existing.map((value) => value.fieldId));
	for (const update of updates) {
		if (!existingIds.has(update.fieldId)) {
			merged.push(update);
		}
	}
	return merged;
}
