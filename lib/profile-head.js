'use strict';

/*
 * The gallery's additions to profile pages, before the first paint:
 *  - the "Gallery" link in the profile menu takes the look of the theme's own links ("Topics")
 *    and gets the number of creations next to it (gallery.scss moves it up);
 *  - the "About" page gets two stat boxes: creator score and number of creations.
 *
 * The functions are sent to the browser in a small inline script in <head> (Function#toString,
 * so they must stay self-contained, in plain browser JavaScript) and exposed as
 * window.binaGalleryProfileUI. On a full load of a profile page the server also passes that
 * profile's numbers, and a MutationObserver applies them while the page is parsed, before the
 * browser draws it (the forum's own scripts run only after the page has loaded, so the boxes used
 * to push the content down a moment later). On page changes inside the forum public/profile.js
 * calls the same functions with the page data, on action:ajaxify.contentLoaded.
 */

const nodebb = require.main;
const db = nodebb.require('./src/database');
const user = nodebb.require('./src/user');
const nconf = nodebb.require('nconf');

/* eslint-disable no-var, prefer-arrow-callback, func-names, object-shorthand */
function galleryProfileHead(initial) {
	function stat(label, value, href) {
		var box = document.createElement('div');
		box.className = 'stat bina-gallery-stat';
		var inner = document.createElement(href ? 'a' : 'div');
		inner.className = 'align-items-center justify-content-center card card-header p-3 border-0 rounded-1 h-100 text-decoration-none';
		if (href) {
			inner.href = href;
		}
		var l = document.createElement('span');
		l.className = 'stat-label text-xs fw-semibold';
		l.textContent = label;
		var v = document.createElement('span');
		v.className = 'fs-2 ff-secondary';
		v.textContent = value;
		inner.appendChild(l);
		inner.appendChild(v);
		box.appendChild(inner);
		return box;
	}

	var ui = {
		// data: { creations, active }
		link: function (data) {
			var link = document.getElementById('bina-gallery');
			if (!data || !link || !link.classList.contains('plugin-link') || link.getAttribute('data-bina-done')) {
				return;
			}
			// while the page is parsed, wait until the link's text is in (the count goes after it)
			var label = link.querySelector('.flex-grow-1');
			if (!label || !label.textContent.trim()) {
				return;
			}
			var model = link.parentElement && link.parentElement.querySelectorAll(':scope > a')[2]; // "Topics"
			if (model && model !== link) {
				link.className = model.className;
				link.classList.remove('active');
				link.classList.add('plugin-link', 'public');
				link.classList.toggle('active', !!data.active);
			}
			var count = document.createElement('span');
			count.className = 'flex-shrink-0 text-xs bina-gallery-count';
			count.textContent = data.creations;
			count.title = data.creations;
			link.appendChild(count);
			link.setAttribute('data-bina-done', '1');
		},
		// data: { score, creations, relativePath } – only on the "About" page, for creators
		stats: function (data) {
			var row = document.querySelector('.account-stats .row');
			if (!data || !data.creations || !row || row.querySelector('.bina-gallery-stat')) {
				return;
			}
			// prepend works while the row is still being parsed: later boxes are added after these
			row.insertBefore(stat('יצירות בגלריה', data.creations, null), row.firstChild);
			row.insertBefore(stat('ניקוד יוצר בגלריה', data.score, (data.relativePath || '') + '/gallery?sort=creators'), row.firstChild);
		},
	};
	window.binaGalleryProfileUI = ui;

	if (initial) {
		var apply = function () {
			ui.link(initial);
			if (initial.isProfile) {
				ui.stats(initial);
			}
		};
		var observer = new MutationObserver(apply);
		observer.observe(document.documentElement, { childList: true, subtree: true });
		document.addEventListener('DOMContentLoaded', function () {
			apply();
			observer.disconnect();
		});
	}
}
/* eslint-enable no-var, prefer-arrow-callback, func-names, object-shorthand */

const SOURCE = galleryProfileHead.toString();
const PROFILE_PATH = /^\/user\/([^/?#]+)(?:\/([^/?#]*))?\/?$/;

// JSON inside <script>: "<" is escaped so no value can close the tag
const inline = value => JSON.stringify(value).replace(/</g, '\\u003c');

exports.renderHeader = async (data, keys) => {
	if (!data || !data.templateData || !data.req) {
		return data;
	}
	let initial = null;
	const relativePath = nconf.get('relative_path') || '';
	const path = String(data.req.path || '').slice(relativePath.length);
	const m = PROFILE_PATH.exec(path);
	if (m) {
		let slug = m[1];
		try {
			slug = decodeURIComponent(slug);
		} catch (e) { /* keep as is */ }
		const uid = await user.getUidByUserslug(slug.toLowerCase());
		if (uid) {
			const [score, creations] = await Promise.all([
				db.sortedSetScore(keys.scores, uid),
				db.sortedSetScore(keys.creations, uid),
			]);
			initial = {
				score: parseInt(score, 10) || 0,
				creations: parseInt(creations, 10) || 0,
				active: m[2] === 'gallery',
				isProfile: !m[2],
				relativePath,
			};
		}
	}
	data.templateData.customHTML = `<script>(${SOURCE})(${inline(initial)});</script>${data.templateData.customHTML || ''}`;
	data.templateData.useCustomHTML = true;
	return data;
};
