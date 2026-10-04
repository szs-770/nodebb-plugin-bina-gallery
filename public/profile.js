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

// The gallery link in the profile menu looks exactly like the theme's own links there ("Posts",
// "Topics" …): the same classes as its neighbour, and the count of creations next to it.
// gallery.scss already moves it up and matches the size, so nothing jumps when this runs.
$(window).on('action:ajaxify.end', function () {
	const link = $('#bina-gallery.plugin-link');
	const gallery = ajaxify.data && ajaxify.data.binaGallery;
	if (!link.length || !gallery) {
		return;
	}
	const model = link.siblings('a').eq(2); // "Topics"
	if (model.length) {
		const active = link.hasClass('active') || ajaxify.data.template.name === 'account/gallery';
		link.attr('class', model.attr('class')).removeClass('active')
			.addClass('plugin-link public')
			.toggleClass('active', active);
	}
	if (!link.find('.bina-gallery-count').length) {
		$('<span class="flex-shrink-0 text-xs bina-gallery-count"></span>')
			.text(gallery.creations)
			.attr('title', gallery.creations)
			.appendTo(link);
	}
});
