declare const ajaxurl: string;

interface WordPressRequest {
	action: string;

	[key: string]: any;
}

export function executeWordPressRequest(data: WordPressRequest) {
	return new Promise<any>((resolve, reject) => {
		jQuery.ajax({
			method: 'POST',
			url: ajaxurl,
			data,
			success: resolve,
			error: reject
		});
	});
}
