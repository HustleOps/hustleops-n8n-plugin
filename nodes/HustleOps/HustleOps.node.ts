import type {
	ICredentialTestFunctions,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import {
	CORE_RESOURCE_OPTIONS,
	type CoreResource as HustleOpsResource,
} from './resourceDefinitions';

export type HustleOpsOperation = 'search' | 'count' | 'get' | 'create' | 'update';

const LIVE_DESCRIPTION = 'Work with HustleOps incident response objects through the HustleOps API.';

const OPERATIONS_WITH_ID: HustleOpsOperation[] = ['get', 'update'];
const OPERATIONS_WITH_BODY: HustleOpsOperation[] = ['create', 'update'];
const OPERATIONS_WITH_SEARCH_BODY: HustleOpsOperation[] = ['search', 'count'];

const OPERATION_OPTIONS: INodePropertyOptions[] = [
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
];

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
				options: CORE_RESOURCE_OPTIONS,
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'search',
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
				default: '{}',
				required: true,
				description:
					'JSON body for the HustleOps Create or Update request. Unsupported fields fail before an API request is sent. See the README for minimal examples per resource.',
				displayOptions: {
					show: {
						operation: OPERATIONS_WITH_BODY,
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
						operation: OPERATIONS_WITH_SEARCH_BODY,
					},
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to fetch every search result page',
				displayOptions: {
					show: {
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
						operation: ['search'],
						returnAll: [false],
					},
				},
			},
		],
	};

	methods = {
		credentialTest: {
			async hustleOps(this: ICredentialTestFunctions): Promise<INodeCredentialTestResult> {
				return {
					status: 'OK',
					message: 'Credentials accepted for metadata-first stub. HustleOps API was not contacted.',
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
			const operation = this.getNodeParameter('operation', itemIndex) as HustleOpsOperation;

			returnData.push({
				json: {
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
