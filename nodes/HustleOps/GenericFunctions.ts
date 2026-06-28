import type {
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { HUSTLEOPS_API_KEY_HEADER } from './constants';

export type HustleOpsRequestContext = IExecuteFunctions;
export type HustleOpsHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type HustleOpsCredentials = {
	baseUrl: string;
	apiKey: string;
};

type PaginationOptions = {
	maxItems?: number;
	maxPages?: number;
};

type HustleOpsApiClient = {
	request: <T = IDataObject>(
		method: HustleOpsHttpMethod,
		path: string,
		body?: IDataObject,
	) => Promise<T>;
	requestEachPage: (
		path: string,
		initialBody: IDataObject,
		options: PaginationOptions,
		onRow: (row: IDataObject) => void,
	) => Promise<void>;
};

export type PaginatedResponse = {
	data: IDataObject[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
};

export const MAX_JSON_PARAMETER_CHARS = 100_000;
const MAX_ERROR_MESSAGE_CHARS = 1000;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLocalHttpHost(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '::1' ||
		hostname === '[::1]'
	);
}

export function normalizeBaseUrl(input: string): string {
	const trimmed = input.trim().replace(/\/+$/, '');

	if (trimmed === '') {
		throw new Error('Base URL is required.');
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error('Base URL must be a valid URL.');
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Base URL must use HTTP or HTTPS.');
	}

	if (url.protocol === 'http:' && !isLocalHttpHost(url.hostname)) {
		throw new Error('HTTPS is required unless the Base URL host is localhost, 127.0.0.1, or ::1.');
	}

	if (url.username !== '' || url.password !== '') {
		throw new Error('Base URL must not contain embedded credentials.');
	}

	if (url.search !== '') {
		throw new Error('Base URL must not contain query strings.');
	}

	if (url.hash !== '') {
		throw new Error('Base URL must not contain fragments.');
	}

	const path = url.pathname.replace(/\/+$/, '');
	url.pathname = path.endsWith('/api/v1') ? path : `${path}/api/v1`;

	return url.toString().replace(/\/$/, '');
}

export function safePathSegment(value: string, label: string): string {
	const trimmed = value.trim();
	if (!UUID_PATTERN.test(trimmed)) {
		throw new Error(`${label} must be a valid UUID.`);
	}
	return encodeURIComponent(trimmed);
}

export function compactObject<T>(value: T): T {
	if (Array.isArray(value)) {
		return value
			.filter((item) => item !== undefined)
			.map((item) => compactObject(item)) as T;
	}

	if (value && typeof value === 'object') {
		const output: IDataObject = {};
		for (const [key, child] of Object.entries(value as IDataObject)) {
			if (child !== undefined) {
				output[key] = compactObject(child);
			}
		}
		return output as T;
	}

	return value;
}

function buildRequestId(itemIndex: number): string {
	return `hustleops-n8n-${Date.now()}-${itemIndex}`;
}

function getErrorBody(error: unknown): IDataObject {
	if (error && typeof error === 'object') {
		const maybeError = error as { response?: { body?: unknown; statusCode?: number } };
		if (maybeError.response?.body && typeof maybeError.response.body === 'object') {
			return maybeError.response.body as IDataObject;
		}
		if (maybeError.response?.statusCode) {
			return { statusCode: maybeError.response.statusCode };
		}
	}

	return {};
}

export function redactSensitiveText(value: string): string {
	return value
		.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [REDACTED]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
		.replace(/x-api-key\s*(?:[:=]|\s)\s*[A-Za-z0-9._~+/=-]+/gi, 'x-api-key [REDACTED]')
		.replace(/ho_sk_[A-Za-z0-9._~+/=-]+/g, 'ho_sk_[REDACTED]')
		.replace(/\b(apiKey|token|secret|password)\s*[:=]\s*[^,\s}]+/gi, '$1=[REDACTED]')
		.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

function formatApiError(error: unknown): string {
	const body = getErrorBody(error);
	const statusCode = body.statusCode;
	const message = Array.isArray(body.message)
		? body.message.join(', ')
		: typeof body.message === 'string'
			? body.message
			: error instanceof Error
				? error.message
				: String(error);
	const requestId = typeof body.requestId === 'string' ? ` requestId=${body.requestId}` : '';
	const path = typeof body.path === 'string' ? ` path=${body.path}` : '';
	const status = typeof statusCode === 'number' ? ` ${statusCode}` : '';

	return redactSensitiveText(`HustleOps API error${status}: ${message}${requestId}${path}`);
}

export function assertPaginatedResponse(value: unknown, label: string): PaginatedResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a paginated response object.`);
	}

	const response = value as Partial<PaginatedResponse>;
	if (!Array.isArray(response.data)) {
		throw new Error(`${label} must include a data array.`);
	}

	for (const field of ['total', 'page', 'pageSize', 'totalPages'] as const) {
		const minimum = field === 'total' || field === 'totalPages' ? 0 : 1;
		if (!Number.isInteger(response[field]) || (response[field] as number) < minimum) {
			throw new Error(`${label} must include integer ${field}.`);
		}
	}

	return response as PaginatedResponse;
}

export function parsePositiveInteger(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): number {
	const numericValue =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: Number.NaN;

	if (!Number.isInteger(numericValue) || numericValue < 1) {
		throw new NodeOperationError(context.getNode(), `${label} must be a positive integer.`, {
			itemIndex,
		});
	}

	return numericValue;
}

export function parseJsonObject(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') {
		return {};
	}

	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}

	if (typeof value !== 'string') {
		throw new NodeOperationError(context.getNode(), `${fieldName} must be a JSON object.`, {
			itemIndex,
		});
	}

	if (value.length > MAX_JSON_PARAMETER_CHARS) {
		throw new NodeOperationError(
			context.getNode(),
			`${fieldName} is too large. Keep JSON parameters under ${MAX_JSON_PARAMETER_CHARS} characters.`,
			{ itemIndex },
		);
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('not an object');
		}
		return parsed as IDataObject;
	} catch {
		throw new NodeOperationError(context.getNode(), `${fieldName} must be a valid JSON object.`, {
			itemIndex,
		});
	}
}

export async function testHustleOpsApiCredentials(
	context: ICredentialTestFunctions,
	credentialData: ICredentialDataDecryptedObject,
): Promise<void> {
	const baseUrl = normalizeBaseUrl(String(credentialData.baseUrl ?? ''));
	const apiKey = String(credentialData.apiKey ?? '');
	const helpers = context.helpers as {
		httpRequest?: (options: IDataObject) => Promise<unknown>;
		request?: (options: IDataObject) => Promise<unknown>;
	};
	const request = helpers.httpRequest ?? helpers.request;

	if (!request) {
		throw new Error('n8n credential-test HTTP helper is not available.');
	}

	try {
		await request.call(helpers, {
			method: 'GET',
			url: `${baseUrl}/tags`,
			headers: {
				[HUSTLEOPS_API_KEY_HEADER]: apiKey,
				Accept: 'application/json',
				'x-request-id': buildRequestId(0),
			},
			json: true,
		});
	} catch (error) {
		throw new Error(formatApiError(error));
	}
}

export async function createHustleOpsApiClient(
	context: HustleOpsRequestContext,
	itemIndex: number,
): Promise<HustleOpsApiClient> {
	const credentials = (await context.getCredentials('hustleOpsApi')) as HustleOpsCredentials;
	const baseUrl = normalizeBaseUrl(credentials.baseUrl);

	const request = async <T = IDataObject>(
		method: HustleOpsHttpMethod,
		path: string,
		body?: IDataObject,
	): Promise<T> => {
		const hasJsonBody = body !== undefined;

		try {
			return (await context.helpers.httpRequest({
				method,
				url: `${baseUrl}${path}`,
				headers: {
					[HUSTLEOPS_API_KEY_HEADER]: credentials.apiKey,
					Accept: 'application/json',
					'x-request-id': buildRequestId(itemIndex),
					...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
				},
				body: hasJsonBody ? compactObject(body) : undefined,
				json: true,
			})) as T;
		} catch (error) {
			throw new NodeOperationError(context.getNode(), formatApiError(error), { itemIndex });
		}
	};

	const requestEachPage = async (
		path: string,
		initialBody: IDataObject,
		options: PaginationOptions,
		onRow: (row: IDataObject) => void,
	): Promise<void> => {
		const firstPagination = (initialBody.pagination ?? {}) as IDataObject;
		const pageSize = typeof firstPagination.pageSize === 'number' ? firstPagination.pageSize : 25;
		const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
		const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
		let emitted = 0;
		let pagesFetched = 0;
		let page = typeof firstPagination.page === 'number' ? firstPagination.page : 1;
		let totalPages = 1;

		do {
			if (emitted >= maxItems) {
				return;
			}

			const response = assertPaginatedResponse(
				await request<PaginatedResponse>('POST', path, {
					...initialBody,
					pagination: {
						...firstPagination,
						page,
						pageSize,
					},
				}),
				`${path} paginated response`,
			);

			for (const row of response.data) {
				if (emitted >= maxItems) {
					return;
				}
				onRow(row);
				emitted += 1;
			}

			totalPages = response.totalPages;
			page += 1;
			pagesFetched += 1;
		} while (page <= totalPages && pagesFetched < maxPages);
	};

	return { request, requestEachPage };
}

export async function hustleOpsApiRequest<T = IDataObject>(
	context: HustleOpsRequestContext,
	method: HustleOpsHttpMethod,
	path: string,
	body: IDataObject | undefined,
	itemIndex: number,
): Promise<T> {
	const client = await createHustleOpsApiClient(context, itemIndex);
	return client.request<T>(method, path, body);
}

export async function hustleOpsApiRequestEachPage(
	context: HustleOpsRequestContext,
	path: string,
	initialBody: IDataObject,
	itemIndex: number,
	options: PaginationOptions,
	onRow: (row: IDataObject) => void,
): Promise<void> {
	const client = await createHustleOpsApiClient(context, itemIndex);
	await client.requestEachPage(path, initialBody, options, onRow);
}
