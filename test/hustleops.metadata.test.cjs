const assert = require('node:assert/strict');
const { test } = require('node:test');

test('HustleOps API credentials expose base URL and API key fields', () => {
	const { HustleOpsApi } = require('../dist/credentials/HustleOpsApi.credentials.js');
	const credentials = new HustleOpsApi();

	assert.equal(credentials.name, 'hustleOpsApi');
	assert.equal(credentials.displayName, 'HustleOps API');

	const baseUrl = credentials.properties.find((property) => property.name === 'baseUrl');
	const apiKey = credentials.properties.find((property) => property.name === 'apiKey');

	assert.equal(baseUrl.displayName, 'Base URL');
	assert.equal(baseUrl.type, 'string');
	assert.equal(baseUrl.required, true);
	assert.match(baseUrl.description, /HTTPS HustleOps instance URL/);

	assert.equal(apiKey.displayName, 'API Key');
	assert.equal(apiKey.type, 'string');
	assert.equal(apiKey.required, true);
	assert.equal(apiKey.typeOptions.password, true);

	assert.deepEqual(credentials.authenticate, {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	});
});
