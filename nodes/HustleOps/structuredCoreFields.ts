import type { CoreResource, DtoOperation } from './resourceDefinitions';

export const CORE_WRITE_OPERATIONS: DtoOperation[] = ['create', 'update'];
export const ADDITIONAL_JSON_PARAMETER = 'additionalJson';
export const LEGACY_BODY_PARAMETER = 'body';

export function toPascalCase(value: string): string {
	return value.replace(/(^|[-_\s]+)([a-z0-9])/g, (_match, _separator, character: string) =>
		character.toUpperCase(),
	);
}

export function fieldDisplayName(field: string): string {
	return field
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\b\w/g, (character) => character.toUpperCase())
		.replace(/\bId\b/g, 'ID')
		.replace(/\bUrl\b/g, 'URL')
		.replace(/\bTlp\b/g, 'TLP');
}

export function structuredFieldParameterName(
	resource: CoreResource,
	operation: DtoOperation,
	field: string,
): string {
	return `${resource}${toPascalCase(operation)}${toPascalCase(field)}`;
}

export function createAdditionalFieldsParameterName(resource: CoreResource): string {
	return `${resource}CreateAdditionalFields`;
}

export function updateFieldsParameterName(resource: CoreResource): string {
	return `${resource}UpdateFields`;
}
