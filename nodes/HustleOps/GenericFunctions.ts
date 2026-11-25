import { randomUUID } from 'node:crypto';
import type {
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	INode,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { HUSTLEOPS_API_KEY_HEADER } from './constants';

export type HustleOpsRequestContext = Pick<IExecuteFunctions, 'getCredentials' | 'getNode'> & {
	helpers: Pick<IExecuteFunctions['helpers'], 'httpRequest'>;
};
export type HustleOpsHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type HustleOpsQueryParams = Record<string, string | number | boolean | null | undefined>;

type HustleOpsCredentials = {
	baseUrl: string;
	apiKey: string;
	organizationId: string;
	ignoreSslIssues?: boolean | string;
};

type PaginationOptions = {
	method?: 'GET' | 'POST';
	maxItems?: number;
	maxPages?: number;
};

export type HustleOpsApiClient = {
	request: <T = IDataObject>(
		method: HustleOpsHttpMethod,
		path: string,
		body?: IDataObject,
		query?: HustleOpsQueryParams,
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
	page: number;
	limit: number;
	filteredCount?: number;
	itemsTotal?: number;
	totalPages?: number;
};

export const MAX_JSON_PARAMETER_CHARS = 100_000;
const MAX_ERROR_MESSAGE_CHARS = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HELPER_NODE: INode = {
	id: 'hustleops-helper',
	name: 'HustleOps',
	type: 'hustleOps',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

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
		throw new NodeOperationError(HELPER_NODE, 'Base URL must be a valid URL.');
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

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function assertUuid(value: unknown, label: string): string {
	if (!isUuid(value)) {
		throw new Error(`${label} must be a valid UUID.`);
	}
	return value.trim();
}

export function parseIntegerInRange(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
	defaultValue?: number,
): number {
	const numericValue =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: (defaultValue ?? Number.NaN);

	if (!Number.isInteger(numericValue) || numericValue < minimum || numericValue > maximum) {
		throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
	}

	return numericValue;
}

export function safePathSegment(value: string, label: string): string {
	return encodeURIComponent(assertUuid(value, label));
}

export function compactObject<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.filter((item) => item !== undefined).map((item) => compactObject(item)) as T;
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

function organizationId(value: unknown): string {
	if (!isUuid(value)) {
		throw new Error('Set a valid HustleOps Organization ID (UUIDv4) in the credential.');
	}
	return value.trim().toLowerCase();
}

function shouldIgnoreSslIssues(value: unknown): boolean {
	return value === true || value === 'true';
}

function getErrorBody(error: unknown): IDataObject {
	if (error && typeof error === 'object') {
		const maybeError = error as {
			response?: { body?: unknown; data?: unknown; status?: number; statusCode?: number };
		};
		const statusCode = maybeError.response?.statusCode ?? maybeError.response?.status;
		const body = maybeError.response?.body ?? maybeError.response?.data;
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			return {
				...(typeof statusCode === 'number' ? { statusCode } : {}),
				...(body as IDataObject),
			};
		}
		if (typeof body === 'string' && body.trim() !== '') {
			try {
				const parsed = JSON.parse(body) as unknown;
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					return {
						...(typeof statusCode === 'number' ? { statusCode } : {}),
						...(parsed as IDataObject),
					};
				}
			} catch {
				return {
					...(typeof statusCode === 'number' ? { statusCode } : {}),
					message: body,
				};
			}
		}
		if (typeof statusCode === 'number') {
			return { statusCode };
		}
	}

	return {};
}

function redactUrlQuery(value: string): string {
	return value.replace(/(\/api\/v\d+\/[^?\s]+)\?[^,\s}]*/g, '$1?[REDACTED]');
}

export function redactSensitiveText(value: string): string {
	return redactUrlQuery(value)
		.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [REDACTED]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
		.replace(/x-api-key\s*(?:[:=]|\s)\s*[A-Za-z0-9._~+/=-]+/gi, 'x-api-key [REDACTED]')
		.replace(/ho_sk_[A-Za-z0-9._~+/=-]+/g, 'ho_sk_[REDACTED]')
		.replace(/\b(apiKey|token|secret|password)\s*[:=]\s*[^,\s}]+/gi, '$1=[REDACTED]')
		.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

function formatApiError(error: unknown): string {
	const body = getErrorBody(error);
	const statusCode = body.statusCode ?? body.status;
	const itemErrors = Array.isArray(body.failedItems)
		? body.failedItems.flatMap((item) => {
				if (!item || typeof item !== 'object' || !Array.isArray(item.errors)) return [];
				return item.errors.flatMap((reason: unknown) => {
					if (!reason || typeof reason !== 'object') return [];
					const { code, message } = reason as IDataObject;
					return [`[${item.index}] ${code ?? ''} ${message ?? ''}`.trim()];
				});
			})
		: [];
	const message = [
		body.code,
		body.title,
		body.detail,
		Array.isArray(body.message) ? body.message.join(', ') : body.message,
		...itemErrors,
	]
		.filter((value): value is string => typeof value === 'string' && value !== '')
		.join(' ');
	const requestId = typeof body.requestId === 'string' ? ` requestId=${body.requestId}` : '';
	const path = typeof body.path === 'string' ? ` path=${redactUrlQuery(body.path)}` : '';
	const status = typeof statusCode === 'number' ? ` ${statusCode}` : '';
	const fallback = error instanceof Error ? error.message : String(error);

	return redactSensitiveText(
		`HustleOps API error${status}: ${message || fallback}${requestId}${path}`,
	);
}

export function assertPaginatedResponse(value: unknown, label: string): PaginatedResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a paginated response object.`);
	}

	const response = value as Partial<PaginatedResponse>;
	if (!Array.isArray(response.data)) {
		throw new Error(`${label} must include a data array.`);
	}

	for (const field of ['page', 'limit', 'filteredCount', 'itemsTotal', 'totalPages'] as const) {
		const required = field === 'page' || field === 'limit';
		const number = response[field];
		if (
			(required || number !== undefined) &&
			(typeof number !== 'number' || !Number.isSafeInteger(number) || number < (required ? 1 : 0))
		) {
			throw new Error(`${label} must include a valid integer ${field}.`);
		}
	}

	return response as PaginatedResponse;
}

export function collectionQueryParams(body: IDataObject): HustleOpsQueryParams {
	return {
		page: body.page as number | undefined,
		limit: body.limit as number | undefined,
		sort: body.sort as string | undefined,
		fields: Array.isArray(body.fields)
			? body.fields.join(',')
			: (body.fields as string | undefined),
		include: Array.isArray(body.include) ? body.include.join(',') : undefined,
		filter: body.filter === undefined ? undefined : JSON.stringify(body.filter),
	};
}

export function expectedVersion(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
		throw new Error('Expected Version must be an integer between 0 and 2147483647.');
	}
	return value;
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

export function parseJsonArray(
	context: Pick<IExecuteFunctions, 'getNode'>,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): unknown[] {
	if (value === undefined || value === null || value === '') {
		return [];
	}

	if (Array.isArray(value)) {
		return value;
	}

	if (typeof value !== 'string') {
		throw new NodeOperationError(context.getNode(), `${fieldName} must be a JSON array.`, {
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
		if (!Array.isArray(parsed)) {
			throw new Error('not an array');
		}
		return parsed;
	} catch {
		throw new NodeOperationError(context.getNode(), `${fieldName} must be a valid JSON array.`, {
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
	const ignoreSslIssues = shouldIgnoreSslIssues(credentialData.ignoreSslIssues);
	const helpers = context.helpers as {
		httpRequest?: (options: IDataObject) => Promise<unknown>;
		request?: (options: IDataObject) => Promise<unknown>;
	};
	const usesHttpRequest = !!helpers.httpRequest;
	const request = helpers.httpRequest ?? helpers.request;

	if (!request) {
		throw new Error('n8n credential-test HTTP helper is not available.');
	}

	try {
		await request.call(helpers, {
			method: 'GET',
			url: `${baseUrl}/tags/auxiliary/list?limit=1`,
			headers: {
				[HUSTLEOPS_API_KEY_HEADER]: apiKey,
				Accept: 'application/json',
				'x-request-id': randomUUID(),
				'X-Organization-Id': organizationId(credentialData.organizationId),
			},
			json: true,
			...(ignoreSslIssues && usesHttpRequest ? { skipSslCertificateValidation: true } : {}),
			...(ignoreSslIssues && !usesHttpRequest ? { rejectUnauthorized: false } : {}),
		});
	} catch (error) {
		throw new NodeOperationError(HELPER_NODE, formatApiError(error));
	}
}

export async function createHustleOpsApiClient(
	context: HustleOpsRequestContext,
	itemIndex: number,
): Promise<HustleOpsApiClient> {
	const credentials = (await context.getCredentials('hustleOpsApi')) as HustleOpsCredentials;
	const baseUrl = normalizeBaseUrl(credentials.baseUrl);
	const ignoreSslIssues = shouldIgnoreSslIssues(credentials.ignoreSslIssues);
	const organization = organizationId(credentials.organizationId);

	function buildRequestUrl(path: string, query?: HustleOpsQueryParams): string {
		const url = new URL(`${baseUrl}${path}`);

		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined && value !== null && value !== '') {
				url.searchParams.set(key, String(value));
			}
		}

		return url.toString();
	}

	const request = async <T = IDataObject>(
		method: HustleOpsHttpMethod,
		path: string,
		body?: IDataObject,
		query?: HustleOpsQueryParams,
	): Promise<T> => {
		const hasJsonBody = body !== undefined;

		try {
			return (await context.helpers.httpRequest({
				method,
				url: buildRequestUrl(path, query),
				headers: {
					[HUSTLEOPS_API_KEY_HEADER]: credentials.apiKey,
					Accept: 'application/json',
					'x-request-id': randomUUID(),
					'X-Organization-Id': organization,
					...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
				},
				body: hasJsonBody ? compactObject(body) : undefined,
				json: true,
				...(ignoreSslIssues ? { skipSslCertificateValidation: true } : {}),
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
		const method = options.method ?? 'POST';
		const maxItems = options.maxItems ?? Infinity;
		const maxPages = options.maxPages ?? Infinity;
		let emitted = 0;
		const firstPage = typeof initialBody.page === 'number' ? initialBody.page : 1;
		for (
			let page = firstPage;
			page <= 10000 && page - firstPage < maxPages && emitted < maxItems;
			page++
		) {
			const body = { ...initialBody, page, include: ['filteredCount'] };
			const result = assertPaginatedResponse(
				method === 'GET'
					? await request('GET', path, undefined, collectionQueryParams(body))
					: await request('POST', path, body),
				`${path} paginated response`,
			);
			if (result.page !== page || result.totalPages === undefined) {
				throw new Error(`${path} response is missing the requested pagination metadata.`);
			}
			for (const row of result.data.slice(0, maxItems - emitted)) {
				onRow(row);
				emitted++;
			}
			if (result.data.length === 0 || page >= result.totalPages) return;
		}
	};

	return { request, requestEachPage };
}

export async function hustleOpsApiRequest<T = IDataObject>(
	context: HustleOpsRequestContext,
	method: HustleOpsHttpMethod,
	path: string,
	body: IDataObject | undefined,
	itemIndex: number,
	query?: HustleOpsQueryParams,
): Promise<T> {
	const client = await createHustleOpsApiClient(context, itemIndex);
	return client.request<T>(method, path, body, query);
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
