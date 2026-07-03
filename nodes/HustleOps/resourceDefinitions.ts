import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { compactObject } from './GenericFunctions';

export type CoreResource = 'alert' | 'incident' | 'observable' | 'knowledge';
export type DtoOperation = 'create' | 'update';

export type FieldSpec = {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'uuid' | 'uuid[]' | 'enum' | 'date-time' | 'url' | 'tags';
	requiredForCreate?: boolean;
	allowedValues?: readonly string[];
	picklistDomain?: string;
	picklistValueTransform?: 'uppercase';
	maxLength?: number;
	nonEmpty?: boolean;
	pattern?: RegExp;
	patternDescription?: string;
	description?: string;
};

export type CoreResourceDefinition = {
	resource: CoreResource;
	displayName: string;
	description: string;
	entityType: 'ALERT' | 'INCIDENT' | 'OBSERVABLE' | 'KNOWLEDGE';
	path: string;
	defaultSortBy: string;
	defaultSortOrder: 'asc' | 'desc';
	searchFields: readonly string[];
	sortFields: readonly string[];
	createFields: readonly string[];
	updateFields: readonly string[];
	requiredCreateFields: readonly string[];
	fieldSpecs: Readonly<Record<string, FieldSpec>>;
};

const SEARCH_REQUEST_FIELDS = new Set(['filter', 'pagination', 'excludeIds']);
const SEARCH_PAGINATION_FIELDS = new Set(['page', 'pageSize', 'sortBy', 'sortOrder']);
const SEARCH_OPERATORS = new Set([
	'eq',
	'neq',
	'contains',
	'startsWith',
	'in',
	'notIn',
	'gt',
	'gte',
	'lt',
	'lte',
	'isNull',
	'isNotNull',
]);
const SEARCH_GROUP_OPERATORS = new Set(['AND', 'OR']);
const MAX_SEARCH_GROUPS = 20;
const MAX_SEARCH_CONDITIONS = 50;
const MAX_SEARCH_DEPTH = 4;
const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALERT_SOURCE_PATTERN = /^[a-zA-Z0-9:\-_]+$/;
const SEVERITY_VALUES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const TLP_VALUES = ['RED', 'AMBER_STRICT', 'AMBER', 'GREEN', 'CLEAR'] as const;
const THREAT_LEVEL_VALUES = ['MALICIOUS', 'SUSPICIOUS', 'UNKNOWN', 'BENIGN'] as const;
const CRITICALITY_VALUES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const RESOURCE_DEFINITION_NODE: INode = {
	id: 'hustleops-resource-definitions',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const alertSearchFields = [
	'seq',
	'name',
	'description',
	'summary',
	'severity',
	'tlp',
	'source',
	'type',
	'sourceRef',
	'alertRefUrl',
	'status',
	'stage',
	'detectedAt',
	'closedAt',
	'closedById',
	'assigneeId',
	'incidentId',
	'createdById',
	'startedAt',
	'startedById',
	'createdAt',
	'updatedAt',
	'tags',
] as const;

const incidentSearchFields = [
	'seq',
	'name',
	'description',
	'summary',
	'severity',
	'tlp',
	'status',
	'stage',
	'category',
	'closedAt',
	'closedById',
	'assigneeId',
	'createdById',
	'startedAt',
	'startedById',
	'detectedAt',
	'createdAt',
	'updatedAt',
	'tags',
] as const;

const observableSearchFields = [
	'seq',
	'value',
	'description',
	'type',
	'threatLevel',
	'tlp',
	'criticality',
	'firstSeen',
	'lastSeen',
	'createdById',
	'createdAt',
	'updatedAt',
	'tags',
] as const;

const knowledgeSearchFields = [
	'seq',
	'value',
	'description',
	'type',
	'tlp',
	'createdById',
	'updatedById',
	'createdAt',
	'updatedAt',
	'tags',
] as const;

export const CORE_RESOURCE_DEFINITIONS: Record<CoreResource, CoreResourceDefinition> = {
	alert: {
		resource: 'alert',
		displayName: 'Alert',
		description: 'Security alert created by a source system or analyst',
		entityType: 'ALERT',
		path: '/alerts',
		defaultSortBy: 'detectedAt',
		defaultSortOrder: 'desc',
		searchFields: alertSearchFields,
		sortFields: [...alertSearchFields, 'displayId'],
		createFields: [
			'name',
			'description',
			'severity',
			'tlp',
			'source',
			'type',
			'sourceRef',
			'alertRefUrl',
			'status',
			'detectedAt',
			'incidentId',
			'assigneeId',
			'tags',
		],
		updateFields: [
			'name',
			'description',
			'severity',
			'tlp',
			'source',
			'type',
			'sourceRef',
			'alertRefUrl',
			'status',
			'detectedAt',
			'incidentId',
			'assigneeId',
			'summary',
			'version',
		],
		requiredCreateFields: [
			'name',
			'description',
			'severity',
			'tlp',
			'source',
			'type',
			'sourceRef',
			'detectedAt',
		],
		fieldSpecs: {
			name: { name: 'name', type: 'string', requiredForCreate: true, maxLength: 200 },
			description: {
				name: 'description',
				type: 'string',
				requiredForCreate: true,
				maxLength: 15000,
			},
			severity: {
				name: 'severity',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: SEVERITY_VALUES,
			},
			tlp: {
				name: 'tlp',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: TLP_VALUES,
			},
			source: {
				name: 'source',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				maxLength: 50,
				pattern: ALERT_SOURCE_PATTERN,
				patternDescription: 'may only contain letters, digits, colons, hyphens, and underscores',
			},
			type: {
				name: 'type',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				picklistDomain: 'alertType',
				description:
					'Must match an active alertType picklist value in HustleOps, such as authentication, endpoint, email, network, dns, user_activity, or other on a default instance.',
			},
			sourceRef: {
				name: 'sourceRef',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				maxLength: 255,
			},
			alertRefUrl: { name: 'alertRefUrl', type: 'url', maxLength: 2048 },
			status: {
				name: 'status',
				type: 'string',
				nonEmpty: true,
				picklistDomain: 'alertStatus',
				description: 'Must match an active alertStatus picklist value in HustleOps when provided.',
			},
			detectedAt: { name: 'detectedAt', type: 'date-time', requiredForCreate: true },
			incidentId: { name: 'incidentId', type: 'uuid' },
			assigneeId: { name: 'assigneeId', type: 'uuid' },
			summary: { name: 'summary', type: 'string' },
			version: { name: 'version', type: 'number' },
			tags: { name: 'tags', type: 'tags' },
		},
	},
	incident: {
		resource: 'incident',
		displayName: 'Incident',
		description: 'Incident case that groups investigation and response work',
		entityType: 'INCIDENT',
		path: '/incidents',
		defaultSortBy: 'createdAt',
		defaultSortOrder: 'desc',
		searchFields: incidentSearchFields,
		sortFields: [...incidentSearchFields, 'displayId'],
		createFields: [
			'name',
			'description',
			'severity',
			'tlp',
			'status',
			'category',
			'assigneeId',
			'tags',
		],
		updateFields: [
			'name',
			'description',
			'severity',
			'tlp',
			'status',
			'category',
			'assigneeId',
			'detectedAt',
			'closedAt',
			'summary',
			'version',
		],
		requiredCreateFields: ['name', 'description', 'severity', 'tlp', 'category'],
		fieldSpecs: {
			name: { name: 'name', type: 'string', requiredForCreate: true, maxLength: 200 },
			description: {
				name: 'description',
				type: 'string',
				requiredForCreate: true,
				maxLength: 15000,
			},
			severity: {
				name: 'severity',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: SEVERITY_VALUES,
			},
			tlp: {
				name: 'tlp',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: TLP_VALUES,
			},
			status: {
				name: 'status',
				type: 'string',
				nonEmpty: true,
				picklistDomain: 'incidentStatus',
				description:
					'Must match an active incidentStatus picklist value in HustleOps when provided.',
			},
			category: {
				name: 'category',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				picklistDomain: 'incidentCategory',
				description: 'Must match an active incidentCategory picklist value in HustleOps.',
			},
			assigneeId: { name: 'assigneeId', type: 'uuid' },
			detectedAt: { name: 'detectedAt', type: 'date-time' },
			closedAt: { name: 'closedAt', type: 'date-time' },
			summary: { name: 'summary', type: 'string' },
			version: { name: 'version', type: 'number' },
			tags: { name: 'tags', type: 'tags' },
		},
	},
	observable: {
		resource: 'observable',
		displayName: 'Observable',
		description: 'Indicator or artifact observed during detection or investigation',
		entityType: 'OBSERVABLE',
		path: '/observables',
		defaultSortBy: 'lastSeen',
		defaultSortOrder: 'desc',
		searchFields: observableSearchFields,
		sortFields: [...observableSearchFields, 'displayId'],
		createFields: [
			'value',
			'description',
			'type',
			'threatLevel',
			'tlp',
			'criticality',
			'firstSeen',
			'lastSeen',
			'tags',
		],
		updateFields: [
			'value',
			'description',
			'type',
			'threatLevel',
			'tlp',
			'criticality',
			'firstSeen',
			'lastSeen',
			'version',
		],
		requiredCreateFields: ['value', 'type', 'threatLevel', 'tlp', 'firstSeen', 'lastSeen'],
		fieldSpecs: {
			value: { name: 'value', type: 'string', requiredForCreate: true, maxLength: 2048 },
			description: { name: 'description', type: 'string', maxLength: 5000 },
			type: {
				name: 'type',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				picklistDomain: 'observableType',
				description: 'Must match an active observableType picklist value in HustleOps.',
			},
			threatLevel: {
				name: 'threatLevel',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: THREAT_LEVEL_VALUES,
				picklistDomain: 'threatLevel',
				picklistValueTransform: 'uppercase',
			},
			tlp: {
				name: 'tlp',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: TLP_VALUES,
			},
			criticality: {
				name: 'criticality',
				type: 'enum',
				allowedValues: CRITICALITY_VALUES,
				picklistDomain: 'criticality',
				picklistValueTransform: 'uppercase',
			},
			firstSeen: { name: 'firstSeen', type: 'date-time', requiredForCreate: true },
			lastSeen: { name: 'lastSeen', type: 'date-time', requiredForCreate: true },
			version: { name: 'version', type: 'number' },
			tags: { name: 'tags', type: 'tags' },
		},
	},
	knowledge: {
		resource: 'knowledge',
		displayName: 'Knowledge',
		description: 'Reusable knowledge, runbook, or note entry',
		entityType: 'KNOWLEDGE',
		path: '/knowledge',
		defaultSortBy: 'createdAt',
		defaultSortOrder: 'desc',
		searchFields: knowledgeSearchFields,
		sortFields: [...knowledgeSearchFields, 'displayId'],
		createFields: ['value', 'description', 'type', 'tlp', 'tags'],
		updateFields: ['value', 'description', 'type', 'tlp', 'version'],
		requiredCreateFields: ['value', 'type', 'tlp'],
		fieldSpecs: {
			value: {
				name: 'value',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				maxLength: 500,
			},
			description: { name: 'description', type: 'string', maxLength: 15000 },
			type: {
				name: 'type',
				type: 'string',
				requiredForCreate: true,
				nonEmpty: true,
				picklistDomain: 'knowledgeType',
				description: 'Must match an active knowledgeType picklist value in HustleOps.',
			},
			tlp: {
				name: 'tlp',
				type: 'enum',
				requiredForCreate: true,
				allowedValues: TLP_VALUES,
			},
			version: { name: 'version', type: 'number' },
			tags: { name: 'tags', type: 'tags' },
		},
	},
};

export const CORE_RESOURCE_OPTIONS = Object.values(CORE_RESOURCE_DEFINITIONS).map((definition) => ({
	name: definition.displayName,
	value: definition.resource,
	description: definition.description,
}));

function assertSupportedFields(
	definition: CoreResourceDefinition,
	operationLabel: string,
	body: IDataObject,
	allowedFields: readonly string[],
): void {
	for (const field of Object.keys(body)) {
		if (!allowedFields.includes(field)) {
			throw new Error(`Unsupported ${definition.displayName} ${operationLabel} field: ${field}`);
		}
	}
}

function validateDtoField(definition: CoreResourceDefinition, field: string, value: unknown): void {
	const spec = definition.fieldSpecs[field];
	if (!spec || value === undefined || value === null) {
		return;
	}

	if (spec.type === 'string' && typeof value !== 'string') {
		throw new Error(`${definition.displayName} field ${field} must be a string.`);
	}
	if (spec.type === 'number' && typeof value !== 'number') {
		throw new Error(`${definition.displayName} field ${field} must be a number.`);
	}
	if (spec.type === 'uuid' && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
		throw new Error(`${definition.displayName} field ${field} must be a UUID.`);
	}
	if (spec.type === 'date-time' && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
		throw new Error(`${definition.displayName} field ${field} must be an ISO date-time string.`);
	}
	if (spec.type === 'url' && typeof value !== 'string') {
		throw new Error(`${definition.displayName} field ${field} must be a string.`);
	}
	if (spec.type === 'url') {
		try {
			const url = new URL(value);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				throw new Error('Unsupported protocol.');
			}
		} catch {
			throw new NodeOperationError(
				RESOURCE_DEFINITION_NODE,
				`${definition.displayName} field ${field} must be a valid HTTP or HTTPS URL.`,
			);
		}
	}
	if (spec.type === 'enum' && spec.allowedValues && !spec.allowedValues.includes(value as string)) {
		throw new Error(
			`${definition.displayName} field ${field} must be one of: ${spec.allowedValues.join(', ')}.`,
		);
	}
	if (
		spec.type === 'tags' &&
		(!Array.isArray(value) || value.some((tag) => typeof tag !== 'string'))
	) {
		throw new Error(`${definition.displayName} field ${field} must be an array of tag names.`);
	}
	if (typeof value !== 'string') {
		return;
	}
	if (spec.nonEmpty && value === '') {
		throw new Error(`${definition.displayName} field ${field} cannot be empty when provided.`);
	}
	if (spec.maxLength !== undefined && value.length > spec.maxLength) {
		throw new Error(
			`${definition.displayName} field ${field} cannot exceed ${spec.maxLength} characters.`,
		);
	}
	if (spec.pattern && !spec.pattern.test(value)) {
		throw new Error(
			`${definition.displayName} field ${field} ${
				spec.patternDescription ?? 'has an invalid format'
			}.`,
		);
	}
}

function assertRequiredCreateFields(definition: CoreResourceDefinition, body: IDataObject): void {
	for (const field of definition.requiredCreateFields) {
		if (body[field] === undefined || body[field] === null || body[field] === '') {
			throw new Error(`Missing required ${definition.displayName} create field: ${field}`);
		}
	}
}

export function getCoreResourceDefinition(resource: string): CoreResourceDefinition {
	const definition = CORE_RESOURCE_DEFINITIONS[resource as CoreResource];
	if (!definition) {
		throw new Error(`Unsupported HustleOps resource: ${resource}`);
	}
	return definition;
}

export function sanitizeDtoBody(
	definition: CoreResourceDefinition,
	operation: DtoOperation,
	body: IDataObject,
): IDataObject {
	const allowedFields = operation === 'create' ? definition.createFields : definition.updateFields;
	assertSupportedFields(definition, operation, body, allowedFields);
	const compacted = compactObject(body);

	if (operation === 'create') {
		assertRequiredCreateFields(definition, compacted);
	} else if (Object.keys(compacted).length === 0) {
		throw new Error(
			`${definition.displayName} update body must include at least one supported field.`,
		);
	}

	for (const [field, value] of Object.entries(compacted)) {
		validateDtoField(definition, field, value);
	}

	return compacted;
}

function assertAllowedKeys(
	definition: CoreResourceDefinition,
	label: string,
	value: IDataObject,
	allowedKeys: Set<string>,
): void {
	for (const key of Object.keys(value)) {
		if (!allowedKeys.has(key)) {
			throw new Error(`Unsupported ${definition.displayName} ${label} field: ${key}`);
		}
	}
}

function validateExcludeIds(definition: CoreResourceDefinition, value: unknown): void {
	if (value === undefined) {
		return;
	}
	if (
		!Array.isArray(value) ||
		value.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
	) {
		throw new Error(`${definition.displayName} search excludeIds must contain valid UUIDs.`);
	}
}

function validateSearchFilter(
	definition: CoreResourceDefinition,
	value: unknown,
	depth = 0,
	state = { groups: 0, conditions: 0 },
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (depth > MAX_SEARCH_DEPTH) {
		throw new Error(`${definition.displayName} search filter is nested too deeply.`);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${definition.displayName} search filter must be an object.`);
	}

	const objectValue = value as IDataObject;
	if (
		objectValue.operator !== undefined &&
		!SEARCH_GROUP_OPERATORS.has(objectValue.operator as string)
	) {
		throw new Error(`${definition.displayName} search filter operator must be AND or OR.`);
	}

	if (objectValue.groups !== undefined && !Array.isArray(objectValue.groups)) {
		throw new Error(`${definition.displayName} search filter groups must be an array.`);
	}
	if (objectValue.conditions !== undefined && !Array.isArray(objectValue.conditions)) {
		throw new Error(`${definition.displayName} search filter conditions must be an array.`);
	}

	const groups = Array.isArray(objectValue.groups) ? objectValue.groups : [];
	if (depth === 0 && groups.length === 0) {
		throw new Error(`${definition.displayName} search filter must contain at least one group.`);
	}
	state.groups += groups.length;
	if (state.groups > MAX_SEARCH_GROUPS) {
		throw new Error(
			`${definition.displayName} search filter cannot contain more than ${MAX_SEARCH_GROUPS} groups.`,
		);
	}

	const conditions = Array.isArray(objectValue.conditions) ? objectValue.conditions : [];
	if (depth > 0 && conditions.length === 0 && groups.length === 0) {
		throw new Error(
			`${definition.displayName} search filter groups must contain at least one condition.`,
		);
	}
	state.conditions += conditions.length;
	if (state.conditions > MAX_SEARCH_CONDITIONS) {
		throw new Error(
			`${definition.displayName} search filter cannot contain more than ${MAX_SEARCH_CONDITIONS} conditions.`,
		);
	}

	for (const condition of conditions) {
		if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
			throw new Error(`${definition.displayName} search condition must be an object.`);
		}
		const conditionObject = condition as IDataObject;
		if (
			typeof conditionObject.field !== 'string' ||
			!definition.searchFields.includes(conditionObject.field)
		) {
			throw new Error(
				`Unsupported ${definition.displayName} search field: ${conditionObject.field}`,
			);
		}
		if (!SEARCH_OPERATORS.has(conditionObject.operator as string)) {
			throw new Error(
				`Unsupported ${definition.displayName} search operator: ${conditionObject.operator}`,
			);
		}
		if (
			(conditionObject.operator === 'in' || conditionObject.operator === 'notIn') &&
			!Array.isArray(conditionObject.value)
		) {
			throw new Error(
				`${definition.displayName} search operator ${conditionObject.operator} requires an array value.`,
			);
		}
		if (
			conditionObject.operator !== 'isNull' &&
			conditionObject.operator !== 'isNotNull' &&
			!Object.prototype.hasOwnProperty.call(conditionObject, 'value')
		) {
			throw new Error(
				`${definition.displayName} search condition value is required for operator ${conditionObject.operator}.`,
			);
		}
	}

	for (const group of groups) {
		validateSearchFilter(definition, group, depth + 1, state);
	}
}

export function buildSearchRequest(
	definition: CoreResourceDefinition,
	input: IDataObject,
): IDataObject {
	assertAllowedKeys(definition, 'search request', input, SEARCH_REQUEST_FIELDS);
	const pagination = (input.pagination ?? {}) as IDataObject;
	assertAllowedKeys(definition, 'search pagination', pagination, SEARCH_PAGINATION_FIELDS);
	const sortBy =
		typeof pagination.sortBy === 'string' ? pagination.sortBy : definition.defaultSortBy;
	const sortOrder =
		pagination.sortOrder === 'asc' || pagination.sortOrder === 'desc'
			? pagination.sortOrder
			: definition.defaultSortOrder;

	if (!definition.sortFields.includes(sortBy)) {
		throw new Error(`Unsupported ${definition.displayName} search sort field: ${sortBy}`);
	}
	const page = typeof pagination.page === 'number' ? pagination.page : 1;
	const pageSize = typeof pagination.pageSize === 'number' ? pagination.pageSize : 25;
	if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
		throw new Error(
			`${definition.displayName} search pagination.page must be between 1 and ${MAX_PAGE}.`,
		);
	}
	if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
		throw new Error(
			`${definition.displayName} search pagination.pageSize must be between 1 and ${MAX_PAGE_SIZE}.`,
		);
	}

	validateSearchFilter(definition, input.filter);
	validateExcludeIds(definition, input.excludeIds);

	return compactObject({
		...input,
		pagination: {
			...pagination,
			page,
			pageSize,
			sortBy,
			sortOrder,
		},
	});
}
