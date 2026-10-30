/**
 * Escapes text for HTML, in element content and in quoted attribute values.
 *
 * Everything the Entire CLI prints, and anything a person typed into a
 * trail or a prompt, goes through this before it is put in a panel. None of
 * it is trusted to be well formed.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
