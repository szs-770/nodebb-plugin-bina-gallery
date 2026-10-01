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
