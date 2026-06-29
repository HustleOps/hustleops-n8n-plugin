import type { IDataObject, IExecuteFunctions, INode, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { assertUuid, compactObject, parseJsonArray } from './GenericFunctions';

export type TagOperation =
	| 'list'
	| 'search'
	| 'create'
	| 'updateColor'
	| 'bulkUpdateColor'
	| 'delete'
	| 'bulkDelete';

export type EntityTagOperation = 'setTags' | 'addTags' | 'removeTag';

type ValidationContext = Pick<IExecuteFunctions, 'getNode'>;

const TAG_VALUE_PATTERN = /^[\p{L}\p{N} *!@#$:._=-]+$/u;
const TAG_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const TAG_BODY_FIELDS_BY_OPERATION: Record<TagOperation, Set<string>> = {
	list: new Set(),
	search: new Set(),
	create: new Set(['value', 'color']),
	updateColor: new Set(['color']),
	bulkUpdateColor: new Set(['ids', 'color']),
	delete: new Set(),
	bulkDelete: new Set(['ids', 'force']),
};
const MAX_TAGS_PER_ENTITY = 20;
const MAX_TAG_VALUE_LENGTH = 30;
const MAX_BULK_TAG_IDS = 100;

const TAG_DEFINITION_NODE: INode = {
	id: 'hustleops-tag-definitions',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export const TAG_RESOURCE_OPTION: INodePropertyOptions = {
	name: 'Tag',
	value: 'tag',
	description: 'HustleOps tags and tag color administration',
};

export const TAG_OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'List',
		value: 'list',
		description: 'List tags, optionally including admin-only usage counts',
		action: 'List tags',
	},
	{
		name: 'Search',
		value: 'search',
		description: 'Search tags with a SearchRequest body. Requires Admin.',
		action: 'Search tags',
	},
	{
		name: 'Create',
		value: 'create',
		description: 'Create a tag. Requires Admin.',
		action: 'Create a tag',
	},
	{
		name: 'Update Color',
		value: 'updateColor',
		description: 'Update a tag color. Tag value is immutable. Requires Admin.',
		action: 'Update a tag color',
	},
	{
		name: 'Bulk Update Color',
		value: 'bulkUpdateColor',
		description: 'Update color for multiple tags. Requires Admin.',
		action: 'Bulk update tag color',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete one tag. Requires Admin.',
		action: 'Delete a tag',
	},
	{
		name: 'Bulk Delete',
		value: 'bulkDelete',
		description: 'Delete multiple tags. Requires Admin.',
		action: 'Bulk delete tags',
	},
];

export const ENTITY_TAG_OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Set Tags',
		value: 'setTags',
		description: 'Replace all tags for the selected entity. Empty values clear all tags.',
		action: 'Set entity tags',
	},
	{
		name: 'Add Tags',
		value: 'addTags',
		description: 'Add one or more tags to the selected entity',
		action: 'Add entity tags',
	},
	{
		name: 'Remove Tag',
		value: 'removeTag',
		description: 'Remove one tag from the selected entity by tag ID',
		action: 'Remove an entity tag',
	},
];

function nodeError(
	context: ValidationContext,
	message: string,
	itemIndex: number,
): NodeOperationError {
	return new NodeOperationError(context.getNode?.() ?? TAG_DEFINITION_NODE, message, {
		itemIndex,
	});
}

function assertAllowedKeys(
	context: ValidationContext,
	operation: TagOperation,
	body: IDataObject,
	itemIndex: number,
): void {
	for (const key of Object.keys(body)) {
		if (!TAG_BODY_FIELDS_BY_OPERATION[operation].has(key)) {
			throw nodeError(context, `Unsupported Tag ${operation} field: ${key}`, itemIndex);
		}
	}
}

function tagValue(context: ValidationContext, value: unknown, itemIndex: number): string {
	if (typeof value !== 'string') {
		throw nodeError(context, 'Tag value must be a string.', itemIndex);
	}
	const normalized = value.trim().replace(/\s+/g, ' ');
	if (normalized === '') {
		throw nodeError(context, 'Tag value is required.', itemIndex);
	}
	if (normalized.length > MAX_TAG_VALUE_LENGTH) {
		throw nodeError(
			context,
			`Tag value cannot exceed ${MAX_TAG_VALUE_LENGTH} characters.`,
			itemIndex,
		);
	}
	if (!TAG_VALUE_PATTERN.test(normalized)) {
		throw nodeError(
			context,
			'Tag values may only contain letters, numbers, spaces, and * ! @ # $ : . - _ =.',
			itemIndex,
		);
	}
	return normalized;
}

function optionalColor(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string' || !TAG_COLOR_PATTERN.test(value)) {
		throw nodeError(context, 'Tag color must be a #RRGGBB hex color.', itemIndex);
	}
	return value;
}

function requiredColor(context: ValidationContext, value: unknown, itemIndex: number): string {
	const color = optionalColor(context, value, itemIndex);
	if (!color) {
		throw nodeError(context, 'Tag color is required.', itemIndex);
	}
	return color;
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

function uuidArray(
	context: ValidationContext,
	value: unknown,
	label: string,
	itemIndex: number,
): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw nodeError(context, `${label} must contain at least one ID.`, itemIndex);
	}
	if (value.length > MAX_BULK_TAG_IDS) {
		throw nodeError(
			context,
			`${label} cannot contain more than ${MAX_BULK_TAG_IDS} IDs.`,
			itemIndex,
		);
	}
	return value.map((id) => {
		try {
			return assertUuid(id, 'Tag ID');
		} catch {
			throw nodeError(context, `${label} must contain valid UUIDs.`, itemIndex);
		}
	});
}

export function parseEntityTagValues(
	context: ValidationContext,
	value: unknown,
	operationLabel: 'Set Tags' | 'Add Tags',
	itemIndex: number,
): string[] {
	const values = parseJsonArray(context, value, 'Tag Values', itemIndex).map((tag) =>
		tagValue(context, tag, itemIndex),
	);

	if (values.length > MAX_TAGS_PER_ENTITY) {
		throw nodeError(
			context,
			`Entity tags cannot contain more than ${MAX_TAGS_PER_ENTITY} values.`,
			itemIndex,
		);
	}
	if (operationLabel === 'Add Tags' && values.length === 0) {
		throw nodeError(context, 'Add Tags requires at least one tag value.', itemIndex);
	}

	return values;
}

export function sanitizeTagBody(
	context: ValidationContext,
	operation: TagOperation,
	body: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedKeys(context, operation, body, itemIndex);

	if (operation === 'search') {
		return body;
	}

	if (operation === 'create') {
		return compactObject({
			value: tagValue(context, body.value, itemIndex),
			color: optionalColor(context, body.color, itemIndex),
		});
	}

	if (operation === 'updateColor') {
		return { color: requiredColor(context, body.color, itemIndex) };
	}

	if (operation === 'bulkUpdateColor') {
		return compactObject({
			ids: uuidArray(context, body.ids, 'Tag bulk update IDs', itemIndex),
			color: optionalColor(context, body.color, itemIndex),
		});
	}

	if (operation === 'bulkDelete') {
		return compactObject({
			ids: uuidArray(context, body.ids, 'Tag bulk delete IDs', itemIndex),
			force: optionalBoolean(context, body.force, 'Tag bulk delete force', itemIndex),
		});
	}

	return {};
}
