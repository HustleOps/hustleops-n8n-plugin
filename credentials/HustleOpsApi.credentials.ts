import type { IAuthenticateGeneric, ICredentialType, INodeProperties } from 'n8n-workflow';
import { HUSTLEOPS_API_KEY_HEADER } from '../nodes/HustleOps/constants';

export class HustleOpsApi implements ICredentialType {
	name = 'hustleOpsApi';

	displayName = 'HustleOps API';

	icon = {
		light: 'file:../nodes/HustleOps/hustleops.svg',
		dark: 'file:../nodes/HustleOps/hustleops.dark.svg',
	} as const;

	documentationUrl = 'https://hustleops.io/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://hustleops.example.com',
			description: 'Full HTTPS HustleOps instance URL. Use HTTP only for local development.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API key used to authenticate with HustleOps.',
		},
		{
			displayName: 'Ignore SSL Issues',
			name: 'ignoreSslIssues',
			type: 'boolean',
			default: false,
			description: 'Whether to connect even if SSL certificate validation is not possible',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				[HUSTLEOPS_API_KEY_HEADER]: '={{$credentials.apiKey}}',
			},
		},
	};
}
