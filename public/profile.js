'use strict';

// The gallery's additions to profile pages (the "Gallery" menu link with its count, and the
// creator stat boxes on the "About" page). The functions come from lib/profile-head.js, which
// also applies them before the first paint on a full page load; here they are applied on page
// changes inside the forum, on action:ajaxify.contentLoaded (right after the new page is put in
// the document, before the browser draws it), with the page's data.
$(window).on('action:ajaxify.contentLoaded action:ajaxify.end', function () {
	const ui = window.binaGalleryProfileUI;
	const d = window.ajaxify && ajaxify.data;
	if (!ui || !d || !d.binaGallery || !d.template) {
		return;
	}
	const data = {
		score: d.binaGallery.score,
		creations: d.binaGallery.creations,
		active: d.template.name === 'account/gallery',
		relativePath: config.relative_path,
	};
	ui.link(data);
	if (d.template.name === 'account/profile') {
		ui.stats(data);
	}
});
