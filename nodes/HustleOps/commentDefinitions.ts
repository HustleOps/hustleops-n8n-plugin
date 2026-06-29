import type { IDataObject, IExecuteFunctions, INode, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	assertUuid,
	compactObject,
	parseIntegerInRange,
	type HustleOpsQueryParams,
} from './GenericFunctions';
import { CORE_RESOURCE_DEFINITIONS } from './resourceDefinitions';

export type CommentEntityType = 'ALERT' | 'INCIDENT' | 'OBSERVABLE' | 'KNOWLEDGE';
export type CommentOperation =
	| 'list'
	| 'search'
	| 'unreadCount'
	| 'create'
	| 'markRead'
	| 'update'
	| 'delete'
	| 'toggleReaction'
	| 'togglePin';

export type CommentListResponse = {
	items: IDataObject[];
	nextCursor: string | null;
};

const COMMENT_ENTITY_TYPES = Object.values(CORE_RESOURCE_DEFINITIONS).map(
	(definition) => definition.entityType,
) as CommentEntityType[];
const COMMENT_ENTITY_TYPE_SET = new Set<string>(COMMENT_ENTITY_TYPES);
const MAX_COMMENT_CONTENT_LENGTH = 5000;
const MAX_COMMENT_SEARCH_QUERY_LENGTH = 500;
const MAX_COMMENT_ATTACHMENTS = 3;
const MAX_COMMENT_EMOJI_LENGTH = 16;
const MAX_COMMENT_TAKE = 100;
const DEFAULT_COMMENT_TAKE = 50;
const DEFAULT_COMMENT_MAX_RESULTS = 100;
const COMMENT_CREATE_BODY_FIELDS = new Set(['content', 'parentId', 'attachmentIds']);
const COMMENT_UPDATE_FIELDS = new Set(['content']);
const COMMENT_REACTION_FIELDS = new Set(['emoji']);

const COMMENT_DEFINITION_NODE: INode = {
	id: 'hustleops-comment-definitions',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

type ValidationContext = Pick<IExecuteFunctions, 'getNode'>;

export const COMMENT_RESOURCE_OPTION: INodePropertyOptions = {
	name: 'Comment',
	value: 'comment',
	description: 'Comment thread entries for alerts, incidents, observables, and knowledge',
};

export const COMMENT_OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'List',
		value: 'list',
		description: 'List comments for an entity thread',
		action: 'List comments',
	},
	{
		name: 'Search',
		value: 'search',
		description: 'Search comments within an entity thread',
		action: 'Search comments',
	},
	{
		name: 'Get Unread Count',
		value: 'unreadCount',
		description: 'Get unread comment count for an entity thread',
		action: 'Get unread comment count',
	},
	{
		name: 'Create',
		value: 'create',
		description: 'Create a comment or reply',
		action: 'Create a comment',
	},
	{
		name: 'Mark Read',
		value: 'markRead',
		description: 'Mark an entity comment thread as read',
		action: 'Mark comments as read',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a comment body',
		action: 'Update a comment',
	},
	{
		name: 'Delete',
		value: 'delete',
		description: 'Delete a comment',
		action: 'Delete a comment',
	},
	{
		name: 'Toggle Reaction',
		value: 'toggleReaction',
		description: 'Toggle the current user reaction for a comment',
		action: 'Toggle comment reaction',
	},
	{
		name: 'Toggle Pin',
		value: 'togglePin',
		description: 'Toggle pinned state for a comment',
		action: 'Toggle comment pin',
	},
];

export const COMMENT_ENTITY_TYPE_OPTIONS: INodePropertyOptions[] = COMMENT_ENTITY_TYPES.map(
	(entityType) => ({
		name: entityType.charAt(0) + entityType.slice(1).toLowerCase(),
		value: entityType,
		description: `Comment thread for ${entityType.toLowerCase()} entities`,
	}),
);

function nodeError(
	context: ValidationContext,
	message: string,
	itemIndex: number,
): NodeOperationError {
	return new NodeOperationError(context.getNode?.() ?? COMMENT_DEFINITION_NODE, message, {
		itemIndex,
	});
}

function requireEntityType(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): CommentEntityType {
	if (typeof value !== 'string' || !COMMENT_ENTITY_TYPE_SET.has(value)) {
		throw nodeError(
			context,
			`Comment entity type must be one of: ${COMMENT_ENTITY_TYPES.join(', ')}.`,
			itemIndex,
		);
	}
	return value as CommentEntityType;
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
): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	return requireUuid(context, value, label, itemIndex);
}

function optionalContent(
	context: ValidationContext,
	value: unknown,
	required: boolean,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null) {
		if (required) {
			throw nodeError(context, 'Comment content is required.', itemIndex);
		}
		return undefined;
	}
	if (typeof value !== 'string' || value.trim() === '') {
		throw nodeError(context, 'Comment content is required.', itemIndex);
	}
	if (value.length > MAX_COMMENT_CONTENT_LENGTH) {
		throw nodeError(
			context,
			`Comment content cannot exceed ${MAX_COMMENT_CONTENT_LENGTH} characters.`,
			itemIndex,
		);
	}
	return value;
}

function attachmentIds(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): string[] | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw nodeError(context, 'Comment attachmentIds must be an array of UUIDs.', itemIndex);
	}
	if (value.length > MAX_COMMENT_ATTACHMENTS) {
		throw nodeError(
			context,
			`Comment attachmentIds cannot contain more than ${MAX_COMMENT_ATTACHMENTS} IDs.`,
			itemIndex,
		);
	}
	return value.map((id) => requireUuid(context, id, 'Comment attachment ID', itemIndex));
}

function integerInRange(
	context: ValidationContext,
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
	defaultValue: number,
	itemIndex: number,
): number {
	try {
		return parseIntegerInRange(value, label, minimum, maximum, defaultValue);
	} catch (error) {
		throw nodeError(
			context,
			error instanceof Error
				? error.message
				: `${label} must be between ${minimum} and ${maximum}.`,
			itemIndex,
		);
	}
}

function assertAllowedCommentKeys(
	context: ValidationContext,
	operationLabel: string,
	input: IDataObject,
	allowedKeys: Set<string>,
	itemIndex: number,
): void {
	for (const key of Object.keys(input)) {
		if (!allowedKeys.has(key)) {
			throw nodeError(context, `Unsupported Comment ${operationLabel} field: ${key}`, itemIndex);
		}
	}
}

export function buildCommentEntityQuery(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): HustleOpsQueryParams {
	return compactObject({
		entityType: requireEntityType(context, input.entityType, itemIndex),
		entityId: requireUuid(context, input.entityId, 'Comment entity ID', itemIndex),
		cursor: optionalUuid(context, input.cursor, 'Comment cursor', itemIndex),
		take:
			input.take === undefined
				? undefined
				: integerInRange(
						context,
						input.take,
						'Comment take',
						1,
						MAX_COMMENT_TAKE,
						DEFAULT_COMMENT_TAKE,
						itemIndex,
					),
	}) as HustleOpsQueryParams;
}

export function buildCommentSearchQuery(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): HustleOpsQueryParams {
	const q = input.q;
	if (typeof q !== 'string' || q.trim() === '') {
		throw nodeError(context, 'Comment search query is required.', itemIndex);
	}
	if (q.length > MAX_COMMENT_SEARCH_QUERY_LENGTH) {
		throw nodeError(
			context,
			`Comment search query cannot exceed ${MAX_COMMENT_SEARCH_QUERY_LENGTH} characters.`,
			itemIndex,
		);
	}

	return {
		entityType: requireEntityType(context, input.entityType, itemIndex),
		entityId: requireUuid(context, input.entityId, 'Comment entity ID', itemIndex),
		q,
	};
}

export function parseCommentMaxResults(
	context: ValidationContext,
	value: unknown,
	itemIndex: number,
): number {
	return integerInRange(
		context,
		value,
		'Comment Max Results',
		1,
		MAX_COMMENT_TAKE,
		DEFAULT_COMMENT_MAX_RESULTS,
		itemIndex,
	);
}

export function sanitizeCreateComment(
	context: ValidationContext,
	entityScope: IDataObject,
	body: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedCommentKeys(context, 'create body', body, COMMENT_CREATE_BODY_FIELDS, itemIndex);
	const content = optionalContent(context, body.content, false, itemIndex);
	const ids = attachmentIds(context, body.attachmentIds, itemIndex);
	if (!content && (!ids || ids.length === 0)) {
		throw nodeError(context, 'Comment create requires content or attachmentIds.', itemIndex);
	}

	return compactObject({
		entityType: requireEntityType(context, entityScope.entityType, itemIndex),
		entityId: requireUuid(context, entityScope.entityId, 'Comment entity ID', itemIndex),
		content,
		parentId: optionalUuid(context, body.parentId, 'Comment parent ID', itemIndex),
		attachmentIds: ids,
	});
}

export function sanitizeMarkReadComment(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): IDataObject {
	return {
		entityType: requireEntityType(context, input.entityType, itemIndex),
		entityId: requireUuid(context, input.entityId, 'Comment entity ID', itemIndex),
	};
}

export function sanitizeUpdateComment(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedCommentKeys(context, 'update', input, COMMENT_UPDATE_FIELDS, itemIndex);
	return {
		content: optionalContent(context, input.content, true, itemIndex) as string,
	};
}

export function sanitizeToggleReaction(
	context: ValidationContext,
	input: IDataObject,
	itemIndex: number,
): IDataObject {
	assertAllowedCommentKeys(context, 'reaction', input, COMMENT_REACTION_FIELDS, itemIndex);
	const emoji = input.emoji;
	if (typeof emoji !== 'string' || emoji.trim() === '') {
		throw nodeError(context, 'Comment emoji is required.', itemIndex);
	}
	if (emoji.length > MAX_COMMENT_EMOJI_LENGTH) {
		throw nodeError(
			context,
			`Comment emoji cannot exceed ${MAX_COMMENT_EMOJI_LENGTH} characters.`,
			itemIndex,
		);
	}
	return { emoji };
}

export function assertCommentListResponse(value: unknown, label: string): CommentListResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a comment list response object.`);
	}

	const response = value as Partial<CommentListResponse>;
	if (!Array.isArray(response.items)) {
		throw new Error(`${label} must include an items array.`);
	}
	if (
		response.nextCursor !== undefined &&
		response.nextCursor !== null &&
		typeof response.nextCursor !== 'string'
	) {
		throw new Error(`${label} nextCursor must be a string or null.`);
	}

	return {
		items: response.items,
		nextCursor: response.nextCursor ?? null,
	};
}
