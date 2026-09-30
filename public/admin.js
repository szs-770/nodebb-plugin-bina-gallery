'use strict';

import { save, load } from 'settings';
import { success, error } from 'alerts';
import { post } from 'api';

export function init() {
	load('bina-gallery', $('.bina-gallery-settings'));

	$('#save').on('click', () => {
		save('bina-gallery', $('.bina-gallery-settings'), () => {
			success('ההגדרות נשמרו.');
		});
	});

	$('#bina-gallery-rebuild').on('click', async () => {
		try {
			const res = await post('/plugins/bina-gallery/rebuild', {});
			success(`הניקוד חושב מחדש (${res.creators} יוצרים).`);
		} catch (e) {
			error(e.message || e);
		}
	});
}
