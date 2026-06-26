import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export type HustleOpsResource = 'alert' | 'incident' | 'observable' | 'knowledge';
export type HustleOpsOperation = 'create' | 'update' | 'get' | 'list';

const STUB_MESSAGE = 'HustleOps API execution is not active in this metadata-first version.';

const RESOURCE_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Alert',
		value: 'alert',
		description: 'Alert objects produced by detections or monitoring systems.',
	},
	{
		name: 'Incident',
		value: 'incident',
		description: 'Incident objects used for response coordination.',
	},
	{
		name: 'Observable',
		value: 'observable',
		description: 'Observable security artifacts such as IPs, domains, hashes, or URLs.',
	},
	{
		name: 'Knowledge',
		value: 'knowledge',
		description: 'Knowledge base or response knowledge objects.',
	},
];

const OPERATION_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a HustleOps object.',
		action: 'Create a HustleOps object',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a HustleOps object.',
		action: 'Update a HustleOps object',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Get a HustleOps object by ID.',
		action: 'Get a HustleOps object',
	},
	{
		name: 'List',
		value: 'list',
		description: 'List HustleOps objects.',
		action: 'List HustleOps objects',
	},
];

const OPERATIONS_WITH_ID: HustleOpsOperation[] = ['get', 'update'];
const OPERATIONS_WITH_BODY: HustleOpsOperation[] = ['create', 'update'];
const OPERATIONS_WITH_FILTERS: HustleOpsOperation[] = ['list'];

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
				description: 'HustleOps object ID.',
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
				description: 'JSON body to send in a future HustleOps create or update request.',
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
				required: false,
				description: 'Optional JSON filters for a future HustleOps list request.',
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
			const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
			const operation = this.getNodeParameter('operation', itemIndex) as HustleOpsOperation;

			returnData.push({
				json: {
					message: STUB_MESSAGE,
					resource,
					operation,
				},
				pairedItem: {
					item: itemIndex,
				},
			});
		}

		return [returnData];
	}
}
