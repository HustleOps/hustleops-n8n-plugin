# HustleOps n8n Community Node

This package provides a metadata-first n8n community node for HustleOps, an incident response platform for alerts, incidents, observables, and knowledge workflows.

This version defines the package shell, credentials, node resources, and operation metadata. It does not call the HustleOps API yet.

## Current Status

- Package metadata for an n8n community node.
- `HustleOps API` credentials with a user-entered `Base URL` and secret `API Key`.
- One `HustleOps` action node.
- Resources: `Alert`, `Incident`, `Observable`, and `Knowledge`.
- Operations: `Create`, `Update`, `Get`, and `List`.
- Explicit stub execution that returns the selected resource, operation, and a bounded, redacted parameter preview.
- In-node notice text explaining that this version is metadata-first and stub-only.

## Local Review Status

This metadata-first package is not published to npm yet. Use `npm run dev` for local review in n8n.

Credentials are required in the node to mirror the future live API behavior, but stub execution does not validate or send the `Base URL` or `API Key`.

## Authentication

Create a `HustleOps API` credential in n8n with:

- `Base URL`: the full HTTPS URL of your HustleOps instance. Use HTTP only for local development.
- `API Key`: your HustleOps API key.

Future API requests are expected to send:

```text
Authorization: Bearer <apiKey>
```

If HustleOps uses a different header format, update the credential and request helper design before enabling live API calls.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run unit tests without rebuilding:

```bash
npm run test:unit
```

Run lint:

```bash
npm run lint
```

Format:

```bash
npm run format
```

Start a local n8n development instance with this node loaded:

```bash
npm run dev
```

Open the local n8n URL from the command output, add the HustleOps node to a workflow, and execute the default `List` operation without a payload. The execution output should contain the selected resource and operation, plus a bounded, redacted parameter preview. Secret-like keys such as `apiKey`, `token`, `secret`, `password`, `authorization`, and `bearer`, plus high-confidence credential strings, are redacted in stub output.

## Limitations

This metadata-first version does not call the HustleOps API, does not validate HustleOps object schemas, and does not include trigger nodes or webhooks.

Before live HustleOps API calls are enabled, request helpers must validate the Base URL with `URL`, reject embedded credentials, reject query strings and fragments, normalize trailing slashes, and require HTTPS except for local development.
