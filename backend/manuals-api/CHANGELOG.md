# Changelog

## 1.0.0

- Added Vercel-ready `POST /api/manuals/search` endpoint for LiftControl CZ manuals lookup.
- Added Brave Search backend integration with official-domain filtering for JLG and Genie.
- Added guarded PDF download and text-layer extraction without exposing API keys to the frontend.
- Added CORS, input validation, request-size limits, download timeouts and safe error responses.
- Added optional OpenAI structuring with source-quote validation against the original manual text.
- Added automated tests for validation, CORS, official-domain enforcement, Brave failures, PDF text handling and JSON shape.
