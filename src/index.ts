export interface Env {
	R2: R2Bucket;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
						return new Response('File too large', { status: 413 });
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
					httpMetadata: { contentType },
				});

				return new Response('Uploaded', {
					status: 201,
					headers: { 'Cache-Control': 'no-store' },
				});
			}

			if (method === 'GET' || method === 'HEAD') {
				const object = await env.R2.get(key);

				if (!object) {
					return new Response('Not Found', { status: 404 });
				}

				const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

				const width = parseInt(url.searchParams.get('w') || '');
				const height = parseInt(url.searchParams.get('h') || '');
				const fit = url.searchParams.get('fit') || undefined;
				const quality = parseInt(url.searchParams.get('q') || '');
				const format = url.searchParams.get('format') || undefined;
				const sharpen = parseFloat(url.searchParams.get('sharpen') || '');
				const blur = parseFloat(url.searchParams.get('blur') || '');

				const isImage = IMAGE_TYPES.has(contentType);

				const hasTransforms = isImage && (width || height || fit || quality || format || sharpen || blur);

				if (method === 'GET' && hasTransforms) {
					const imageURL = new URL(req.url);

					imageURL.search = '';

					const cfImage: Record<string, any> = {};

					if (width) cfImage.width = width;
					if (height) cfImage.height = height;
					if (fit) cfImage.fit = fit;
					if (quality) cfImage.quality = quality;
					if (format) cfImage.format = format;
					if (sharpen) cfImage.sharpen = sharpen;
					if (blur) cfImage.blur = blur;

					return fetch(imageURL.toString(), {
						cf: { image: cfImage },
					});
				}

				const headers = new Headers();

				headers.set('Content-Type', contentType);

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
