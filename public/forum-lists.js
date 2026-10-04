'use strict';

/*
 * Keeps new creations out of the "new topics / new posts" bar of the forum's topic lists
 * (/recent, /unread, /popular …). The server already keeps them out of the lists and the unread
 * counters; this only covers the live bar, which is updated in the browser.
 * The bar keeps working as usual inside the gallery category itself.
 */
(function () {
	function galleryCid() {
		return parseInt(window.config && config.binaGallery && config.binaGallery.cid, 10) || 0;
	}

	function galleryIsSelected() {
		const cid = galleryCid();
		const d = window.ajaxify && ajaxify.data;
		if (!d) {
			return false;
		}
		return (d.template && d.template.category && parseInt(d.cid, 10) === cid) ||
			(Array.isArray(d.selectedCids) && d.selectedCids.map(c => parseInt(c, 10)).includes(cid));
	}

	function isGallery(cid) {
		const galleryId = galleryCid();
		return galleryId > 0 && parseInt(cid, 10) === galleryId && !galleryIsSelected();
	}

	// "New topic" on the gallery category page leads to the gallery's share window instead of the
	// composer (the server accepts only creations there)
	document.addEventListener('click', function (e) {
		const btn = e.target.closest && e.target.closest('[component="category/post"]');
		const d = window.ajaxify && ajaxify.data;
		const cid = galleryCid();
		if (!btn || !cid || !d || !d.template || !d.template.category || parseInt(d.cid, 10) !== cid) {
			return;
		}
		e.preventDefault();
		e.stopImmediatePropagation();
		ajaxify.go('gallery?share=1');
	}, true);

	require(['hooks'], function (hooks) {
		hooks.on('filter:topicList.onNewTopic', function (data) {
			if (data && data.topic && isGallery(data.topic.cid)) {
				data.preventAlert = true;
			}
			return data;
		});
		hooks.on('filter:topicList.onNewPost', function (data) {
			if (data && data.post && data.post.topic && isGallery(data.post.topic.cid)) {
				data.preventAlert = true;
			}
			return data;
		});
	});
}());
