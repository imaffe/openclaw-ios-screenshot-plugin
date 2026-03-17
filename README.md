# OpenClaw iOS Screenshot Plugin

This repository contains a reusable OpenClaw plugin that exposes an authenticated HTTP
endpoint for screenshot uploads. It accepts image files plus an optional text
description, then stores each upload under the OpenClaw workspace.

## What it does

- Registers a plugin-owned HTTP route on the OpenClaw gateway
- Accepts `multipart/form-data` uploads from apps and services
- Also accepts `application/json` with base64-encoded files
- Verifies a shared token before accepting uploads
- Stores files under `<configured OpenClaw workspace>/<destinationDir>/<uploadId>/`
- Writes an `upload.json` sidecar with description and metadata

## Install

From npm:

```bash
openclaw plugins install @imaffe/openclaw-ios-screenshot-plugin
openclaw plugins enable openclaw-ios-screenshot-plugin
```

From a local checkout during development:

```bash
openclaw plugins install ./openclaw-ios-screenshot-plugin
openclaw plugins enable openclaw-ios-screenshot-plugin
```

## Configure

Add plugin config to your OpenClaw config file:

```yaml
plugins:
  entries:
    openclaw-ios-screenshot-plugin:
      enabled: true
      config:
        authToken: "replace-with-a-long-random-secret"
        routePath: "/plugins/openclaw-ios-screenshot-plugin/upload"
        destinationDir: "screenshots/inbox"
        maxPayloadBytes: 26214400
        allowedMimeTypes:
          - "image/png"
          - "image/jpeg"
          - "image/webp"
          - "image/heic"
          - "image/heif"
```

Restart the OpenClaw gateway after config changes.

## Publish

```bash
npm login
npm pack --dry-run
npm publish --access public
```

## Usage

### Multipart upload

```bash
curl \
  -X POST "http://localhost:3100/plugins/openclaw-ios-screenshot-plugin/upload" \
  -H "Authorization: Bearer replace-with-a-long-random-secret" \
  -F "description=Quarterly sales dashboard capture" \
  -F "file=@/path/to/screenshot.png;type=image/png"
```

### JSON upload

```bash
curl \
  -X POST "http://localhost:3100/plugins/openclaw-ios-screenshot-plugin/upload" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Token: replace-with-a-long-random-secret" \
  -d '{
    "description": "Captured from automation",
    "files": [
      {
        "filename": "capture.png",
        "contentType": "image/png",
        "dataBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
      }
    ]
  }'
```

## Stored layout

Each upload gets a unique folder:

```text
<workspace>/screenshots/inbox/<upload-id>/
  01-screenshot.png
  upload.json
```

`upload.json` includes:

- upload ID
- timestamp
- description text
- client IP and user agent when available
- stored file names, MIME types, byte sizes, and relative paths

## Notes

- The route is plugin-authenticated, not gateway-authenticated.
- `Authorization: Bearer <token>` and `X-OpenClaw-Token: <token>` are both supported.
- The plugin rejects non-image MIME types unless you expand `allowedMimeTypes`.
