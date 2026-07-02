import type { INodeProperties } from 'n8n-workflow';

export const PAYLOAD_INPUT_MODE_PARAMETER = 'payloadInputMode';
export const PAYLOAD_MODE_INDIVIDUAL_FIELDS = 'individualFields';
export const PAYLOAD_MODE_JSON_OBJECT = 'jsonObject';

export type PayloadInputMode =
	| typeof PAYLOAD_MODE_INDIVIDUAL_FIELDS
	| typeof PAYLOAD_MODE_JSON_OBJECT;

export const PAYLOAD_INPUT_MODE_OPTIONS = [
	{
		name: 'Individual Fields',
		value: PAYLOAD_MODE_INDIVIDUAL_FIELDS,
		description: 'Build the request body from visible node fields',
	},
	{
		name: 'JSON Object',
		value: PAYLOAD_MODE_JSON_OBJECT,
		description: 'Submit the JSON object as the complete request body',
	},
] as const;

export const RETIRED_PAYLOAD_PARAMETERS = [
	'additionalJson',
	'body',
	'searchBody',
	'tagBody',
	'tagValues',
	'commentBody',
	'customFieldBody',
	'customFieldValues',
	'entityIds',
] as const;

function toPascalCase(value: string): string {
	return value.replace(/(^|[-_\s]+)([a-z0-9])/g, (_match, _separator, character: string) =>
		character.toUpperCase(),
	);
}

export function payloadJsonObjectParameterName(resource: string, operation: string): string {
	return `payload${toPascalCase(resource)}${toPascalCase(operation)}JsonObject`;
}

export function payloadModeDisplayOptions(
	resources: readonly string[],
	operations: readonly string[],
): INodeProperties['displayOptions'] {
	return {
		show: {
			resource: [...resources],
			operation: [...operations],
		},
	};
}

export function modeDisplayOptions(
	resources: readonly string[],
	operations: readonly string[],
	mode: PayloadInputMode,
): INodeProperties['displayOptions'] {
	return {
		show: {
			resource: [...resources],
			operation: [...operations],
			[PAYLOAD_INPUT_MODE_PARAMETER]: [mode],
		},
	};
}
