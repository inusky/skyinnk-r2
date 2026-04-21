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

				const contentType = req.headers.get('content-type') || 'application/octet-stream';

				await env.R2.put(key, req.body, {
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
