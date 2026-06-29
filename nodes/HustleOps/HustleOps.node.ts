import type {
	ICredentialDataDecryptedObject,
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
	CORE_RESOURCE_OPTIONS,
	type CoreResource,
	buildSearchRequest,
	getCoreResourceDefinition,
	sanitizeDtoBody,
} from './resourceDefinitions';

export type HustleOpsOperation = 'search' | 'count' | 'get' | 'create' | 'update';
export type HustleOpsResource = CoreResource | 'comment';

const LIVE_DESCRIPTION = 'Work with HustleOps incident response objects through the HustleOps API.';

const OPERATIONS_WITH_ID: HustleOpsOperation[] = ['get', 'update'];
const OPERATIONS_WITH_BODY: HustleOpsOperation[] = ['create', 'update'];
const OPERATIONS_WITH_SEARCH_BODY: HustleOpsOperation[] = ['search', 'count'];
const CORE_RESOURCE_VALUES = CORE_RESOURCE_OPTIONS.map((option) => option.value) as CoreResource[];
const HUSTLEOPS_RESOURCE_OPTIONS: INodePropertyOptions[] = [
	...CORE_RESOURCE_OPTIONS,
	COMMENT_RESOURCE_OPTION,
];

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
				options: OPERATION_OPTIONS,
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
				displayName: 'Body',
				name: 'body',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'JSON body for the HustleOps Create or Update request. Unsupported fields fail before an API request is sent. See the README for minimal examples per resource.',
				displayOptions: {
					show: {
						resource: CORE_RESOURCE_VALUES,
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
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'options',
				default: 'INCIDENT',
				required: true,
				description: 'Type of HustleOps entity whose comment thread is being operated on',
				options: COMMENT_ENTITY_TYPE_OPTIONS,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list', 'search', 'unreadCount', 'create', 'markRead'],
					},
				},
			},
			{
				displayName: 'Entity ID',
				name: 'entityId',
				type: 'string',
				default: '',
				required: true,
				description: 'HustleOps entity UUID whose comment thread is being operated on',
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list', 'search', 'unreadCount', 'create', 'markRead'],
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

				const definition = getCoreResourceDefinition(resource);
				const coreOperation = operation as HustleOpsOperation;
				const client = await createHustleOpsApiClient(this, itemIndex);

				if (coreOperation === 'get') {
					const id = this.getNodeParameter('id', itemIndex) as string;
					const response = await client.request<IDataObject>(
						'GET',
						`${definition.path}/${safePathSegment(id, `${definition.displayName} ID`)}`,
					);
					returnData.push({ json: response, pairedItem: { item: itemIndex } });
					continue;
				}

				if (coreOperation === 'create') {
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

				if (coreOperation === 'update') {
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
