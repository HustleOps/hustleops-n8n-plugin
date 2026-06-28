import type {
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
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
} from './GenericFunctions';
import {
	CORE_RESOURCE_OPTIONS,
	type CoreResource as HustleOpsResource,
	buildSearchRequest,
	getCoreResourceDefinition,
	sanitizeDtoBody,
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
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as HustleOpsResource;
				const operation = this.getNodeParameter('operation', itemIndex) as HustleOpsOperation;
				const definition = getCoreResourceDefinition(resource);
				const client = await createHustleOpsApiClient(this, itemIndex);

				if (operation === 'get') {
					const id = this.getNodeParameter('id', itemIndex) as string;
					const response = await client.request<IDataObject>(
						'GET',
						`${definition.path}/${safePathSegment(id, `${definition.displayName} ID`)}`,
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				if (operation === 'create') {
					const body = parseJsonObject(
						this,
						this.getNodeParameter('body', itemIndex),
						'Body',
						itemIndex,
					);
					const response = await client.request<IDataObject>(
						'POST',
						definition.path,
						sanitizeDtoBody(definition, 'create', body),
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				if (operation === 'update') {
					const id = this.getNodeParameter('id', itemIndex) as string;
					const body = parseJsonObject(
						this,
						this.getNodeParameter('body', itemIndex),
						'Body',
						itemIndex,
					);
					const response = await client.request<IDataObject>(
						'PATCH',
						`${definition.path}/${safePathSegment(id, `${definition.displayName} ID`)}`,
						sanitizeDtoBody(definition, 'update', body),
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

				if (operation === 'count') {
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
