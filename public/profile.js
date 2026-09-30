'use strict';

// Adds the gallery "creator score" to the stats on a user's profile page
// (only for users who shared at least one creation).
$(window).on('action:ajaxify.end', function (ev, data) {
	if (!data || data.tpl_url !== 'account/profile' || !ajaxify.data.binaGallery) {
		return;
	}
	const { score, creations } = ajaxify.data.binaGallery;
	const row = $('.account-stats .row').first();
	if (!creations || !row.length || row.find('.bina-gallery-stat').length) {
		return;
	}
	const stat = (label, value, href) => $('<div class="stat bina-gallery-stat"></div>').append(
		$(`<${href ? 'a' : 'div'} class="align-items-center justify-content-center card card-header p-3 border-0 rounded-1 h-100 text-decoration-none"></${href ? 'a' : 'div'}>`)
			.attr(href ? { href } : {})
			.append($('<span class="stat-label text-xs fw-semibold"></span>').text(label))
			.append($('<span class="fs-2 ff-secondary"></span>').text(value))
	);
	row.prepend(
		stat('ניקוד יוצר בגלריה', score, `${config.relative_path}/gallery?sort=creators`),
		stat('יצירות בגלריה', creations, null)
	);
});
