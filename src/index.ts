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

export default {
	async fetch(req: any, env: any): Promise<Response> {
		try {
			const url = new URL(req.url);
			const key = url.searchParams.get('key');

			if (!key) return new Response('Missing key', { status: 400 });

			// Upload
			if (req.method === 'PUT') {
				if (!req.body) return new Response('Empty body', { status: 400 });

				await env.R2.put(key, req.body);
				return new Response('Uploaded', { status: 201 });
			}

			// Download
			if (req.method === 'GET') {
				const obj = await env.R2.get(key);

				if (!obj) return new Response('Not found', { status: 404 });

				return new Response(obj.body, {
					headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' },
				});
			}

			return new Response('Method not allowed', { status: 405 });
		} catch (err) {
			return new Response('Internal error', { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
