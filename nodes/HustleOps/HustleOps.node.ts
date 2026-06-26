import type {
	GenericValue,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

export type HustleOpsResource = 'alert' | 'incident' | 'observable' | 'knowledge';
export type HustleOpsOperation = 'create' | 'update' | 'get' | 'list';

const STUB_MESSAGE = 'HustleOps API execution is not active in this metadata-first version.';

const RESOURCE_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Alert',
		value: 'alert',
		description: 'Alert objects produced by detections or monitoring systems',
	},
	{
		name: 'Incident',
		value: 'incident',
		description: 'Incident objects used for response coordination',
	},
	{
		name: 'Observable',
		value: 'observable',
		description: 'Observable security artifacts such as IPs, domains, hashes, or URLs',
	},
	{
		name: 'Knowledge',
		value: 'knowledge',
		description: 'Knowledge base or response knowledge objects',
	},
];

const OPERATION_OPTIONS: INodePropertyOptions[] = [
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
	{
		name: 'Get',
		value: 'get',
		description: 'Get a HustleOps object by ID',
		action: 'Get a HustleOps object',
	},
	{
		name: 'List',
		value: 'list',
		description: 'List HustleOps objects',
		action: 'List HustleOps objects',
	},
];

const OPERATIONS_WITH_ID: HustleOpsOperation[] = ['get', 'update'];
const OPERATIONS_WITH_BODY: HustleOpsOperation[] = ['create', 'update'];
const OPERATIONS_WITH_FILTERS: HustleOpsOperation[] = ['list'];
const SECRET_KEY_PATTERN = /(api[-_]?key|token|secret|password|authorization|bearer)/i;
const SECRET_VALUE_PATTERN =
	/(authorization\s*:\s*bearer\s+\S+|bearer\s+\S+|(?:api[-_]?key|token|secret|password)=\S+)/i;
const MAX_JSON_PARAMETER_CHARS = 20_000;
const MAX_PREVIEW_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const REDACTED_VALUE = '[redacted]';
const PROVIDED_VALUE = '[provided]';

function parseJsonParameter(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: 'Body' | 'Filters',
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') {
		if (fieldName === 'Body') {
			throw new NodeOperationError(
				context.getNode(),
				'Body is required for Create and Update. HustleOps API execution was not attempted.',
				{ itemIndex },
			);
		}

		return {};
	}

	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}

	if (typeof value !== 'string') {
		return { value };
	}

	if (value.length > MAX_JSON_PARAMETER_CHARS) {
		throw new NodeOperationError(
			context.getNode(),
			`${fieldName} is too large for metadata-first stub preview. HustleOps API execution was not attempted.`,
			{ itemIndex },
		);
	}

	try {
		return JSON.parse(value) as IDataObject;
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			`${fieldName} must be valid JSON. HustleOps API execution was not attempted.`,
			{ itemIndex },
		);
	}
}

function createParameterPreview(value: unknown, depth = 0): GenericValue {
	if (depth >= MAX_PREVIEW_DEPTH) {
		return { truncated: true };
	}

	if (Array.isArray(value)) {
		const preview = value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((item) => createParameterPreview(item, depth + 1));

		if (value.length > MAX_ARRAY_ITEMS) {
			return {
				truncated: true,
				omittedItems: value.length - MAX_ARRAY_ITEMS,
				preview,
			};
		}

		return preview;
	}

	if (value && typeof value === 'object') {
		const redacted: IDataObject = {};
		const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

		for (const [key, childValue] of entries) {
			redacted[key] = SECRET_KEY_PATTERN.test(key)
				? REDACTED_VALUE
				: createParameterPreview(childValue, depth + 1);
		}

		if (Object.keys(value).length > MAX_OBJECT_KEYS) {
			redacted.truncated = true;
			redacted.omittedKeys = Object.keys(value).length - MAX_OBJECT_KEYS;
		}

		return redacted;
	}

	if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
		return REDACTED_VALUE;
	}

	if (
		value === undefined ||
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}

	return String(value);
}

export class HustleOps implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HustleOps',
		name: 'hustleOps',
		icon: { light: 'file:hustleops.svg', dark: 'file:hustleops.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Work with HustleOps incident response objects. This metadata-first version returns stub data only.',
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
				displayName:
					'This metadata-first version does not call the HustleOps API. Executions return stub data only.',
				name: 'metadataFirstNotice',
				type: 'notice',
				default:
					'This metadata-first version does not call the HustleOps API. Executions return stub data only.',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'incident',
				options: RESOURCE_OPTIONS,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'list',
				options: OPERATION_OPTIONS,
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
						operation: OPERATIONS_WITH_ID,
					},
				},
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'json',
				default: '',
				placeholder: '{"title":"Suspicious login","severity":"high"}',
				required: true,
				description: 'JSON body to send in a future HustleOps create or update request',
				displayOptions: {
					show: {
						operation: OPERATIONS_WITH_BODY,
					},
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'json',
				default: '{}',
				description: 'Optional JSON filters for a future HustleOps list request',
				displayOptions: {
					show: {
						operation: OPERATIONS_WITH_FILTERS,
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
				const operation = this.getNodeParameter('operation', itemIndex) as HustleOpsOperation;
				const parameters: IDataObject = {};

				if (OPERATIONS_WITH_ID.includes(operation)) {
					const id = this.getNodeParameter('id', itemIndex) as string;
					if (id === '') {
						throw new NodeOperationError(
							this.getNode(),
							'ID is required. HustleOps API execution was not attempted.',
							{ itemIndex },
						);
					}
					parameters.id = PROVIDED_VALUE;
				}

				if (OPERATIONS_WITH_BODY.includes(operation)) {
					parameters.body = createParameterPreview(
						parseJsonParameter(this, this.getNodeParameter('body', itemIndex), 'Body', itemIndex),
					);
				}

				if (OPERATIONS_WITH_FILTERS.includes(operation)) {
					parameters.filters = createParameterPreview(
						parseJsonParameter(
							this,
							this.getNodeParameter('filters', itemIndex, '{}'),
							'Filters',
							itemIndex,
						),
					);
				}

				returnData.push({
					json: {
						message: STUB_MESSAGE,
						resource,
						operation,
						parameters,
					},
					pairedItem: {
						item: itemIndex,
					},
				});
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
					json: {
						error: nodeError.message,
						message: STUB_MESSAGE,
					},
					pairedItem: {
						item: itemIndex,
					},
				});
			}
		}

		return [returnData];
	}
}
