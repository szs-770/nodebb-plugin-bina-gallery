'use strict';

// Profile tab "יצירות בגלריה": the same cards, grid, lightbox and "load more" as the gallery page
define('forum/account/gallery', ['forum/account/header', 'forum/gallery'], function (header, gallery) {
	return {
		init: function () {
			header.init();
			gallery.init();
		},
	};
});
