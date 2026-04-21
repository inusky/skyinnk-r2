/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	R2: R2Bucket;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		const method = req.method.toUpperCase();

		const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

		if (!key) {
			return new Response('Missing file path', { status: 400 });
		}

		try {
			if (method === 'PUT') {
				if (!req.body) {
					return new Response('Request body required', { status: 400 });
				}

				const rawType = req.headers.get('content-type') || '';
				const contentType = rawType.split(';')[0].trim() || 'application/octet-stream';

				if (!ALLOWED_TYPES.has(contentType)) {
					return new Response('Unsupported file type', {
						status: 415,
					});
				}

				const [bodyForCheck, bodyForUpload] = req.body.tee();

				const contentLength = req.headers.get('content-length');

				if (contentLength) {
					const size = parseInt(contentLength, 10);

					if (isNaN(size) || size > MAX_FILE_SIZE) {
						return new Response('File too large', {
							status: 413,
						});
					}
				} else {
					const reader = bodyForCheck.getReader();
					let total = 0;

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						total += value.byteLength;

						if (total > MAX_FILE_SIZE) {
							return new Response('File too large', {
								status: 413,
							});
						}
					}
				}

				const existing = await env.R2.get(key);
				if (existing) {
					return new Response('File already exists', {
						status: 409,
					});
				}

				await env.R2.put(key, bodyForUpload, {
					httpMetadata: {
						contentType,
					},
				});

				return new Response('Uploaded', {
					status: 201,
					headers: {
						'Cache-Control': 'no-store',
					},
				});
			}

			if (method === 'GET' || method === 'HEAD') {
				const object = await env.R2.get(key);

				if (!object) {
					return new Response('Not Found', { status: 404 });
				}

				const headers = new Headers();

				headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');

				headers.set('Cache-Control', 'public, max-age=31536000, immutable');

				headers.set('Access-Control-Allow-Origin', '*');

				if (object.httpEtag) {
					headers.set('ETag', object.httpEtag);
				}

				if (object.uploaded) {
					headers.set('Last-Modified', new Date(object.uploaded).toUTCString());
				}

				if (method === 'HEAD') {
					return new Response(null, { headers });
				}

				return new Response(object.body, { headers });
			}

			return new Response('Method Not Allowed', {
				status: 405,
				headers: {
					Allow: 'GET, HEAD, PUT',
				},
			});
		} catch (err: any) {
			return new Response('Internal Error: ' + err.message, {
				status: 500,
			});
		}
	},
};
