'use strict';

define('forum/gallery', ['api', 'alerts', 'helpers'], function (api, alerts, helpers) {
	const Gallery = {};

	const USAGE_SHOWN = {
		none: { icon: 'fa-lock', text: 'שימוש רק באישור היוצר' },
		personal: { icon: 'fa-user-check', text: 'מותר לשימוש אישי' },
		commercial: { icon: 'fa-circle-check', text: 'מותר לשימוש אישי ומסחרי' },
	};

	let lightbox = null;
	let current = -1;
	const details = new Map(); // tid -> { tool, styles, prompt } loaded for the lightbox

	Gallery.init = function () {
		const root = $('.bina-gallery');

		// The share window lives in public/upload.js, shared with the creation page's edit button
		root.on('click', '.bg-share', async function () {
			const btn = $(this);
			const [upload] = await app.require(['bina-gallery-upload']);
			upload.open({
				cid: parseInt(btn.attr('data-cid'), 10),
				willQueue: btn.attr('data-will-queue') === 'true',
				lastUsage: btn.attr('data-last-usage') || '',
			});
		});

		// /gallery?share=1 (the "new topic" button of the gallery category) opens the share window
		const params = new URLSearchParams(window.location.search);
		if (params.get('share') === '1') {
			params.delete('share');
			const query = params.toString();
			window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : ''));
			root.find('.bg-share').first().trigger('click');
		}

		// The heart on a card (shown on hover) likes without opening the creation (topic 360)
		root.on('click', '.bg-card__like', function (e) {
			e.preventDefault();
			e.stopPropagation();
			toggleLike($(this).closest('.bg-card'));
		});
		root.on('keydown', '.bg-card__like', function (e) {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				e.stopPropagation();
				toggleLike($(this).closest('.bg-card'));
			}
		});

		root.on('click', '.bg-open', function (e) {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
				return;
			}
			// ajaxify handles every link click on the page, so stop the event here
			e.preventDefault();
			e.stopPropagation();
			const cards = orderedCards(root);
			openLightbox(cards, cards.index(this));
		});

		root.on('click', '.bg-load-more', loadMore);

		// Filters: every change reloads the gallery with the chosen tool / style / usage
		root.on('change', '.bg-filters select', function () {
			const params = new URLSearchParams();
			$(this).closest('form').serializeArray().forEach(({ name, value }) => {
				if (value && !(name === 'sort' && value === 'new')) {
					params.set(name, value);
				}
			});
			const qs = params.toString();
			ajaxify.go(`gallery${qs ? `?${qs}` : ''}`);
		});
		root.on('submit', '.bg-filters', e => e.preventDefault());

		masonry.init(root.find('.bg-grid'));
		initSorts(root.find('.bg-sorts'));

		$(window).one('action:ajaxify.start', () => {
			closeLightbox();
			masonry.destroy();
		});
	};

	// Cards in their real order (the order of the list), not the order of the columns:
	// "creation of the day" first, then the grid by data-index. Used by the lightbox and its keys.
	function orderedCards(root) {
		const grid = root.find('.bg-grid .bg-card').toArray()
			.sort((a, b) => (parseInt(a.dataset.index, 10) || 0) - (parseInt(b.dataset.index, 10) || 0));
		return $(root.find('.bg-featured').toArray().concat(grid));
	}

	// On narrow screens the sort tabs scroll sideways. Bring the active tab into view (it can be the
	// last one, e.g. "יוצרים מובילים") and fade the edges so it is clear there is more to scroll.
	function initSorts(list) {
		const el = list[0];
		if (!el) {
			return;
		}
		const update = () => {
			const max = el.scrollWidth - el.clientWidth;
			const pos = Math.abs(el.scrollLeft); // negative in RTL
			el.classList.toggle('is-scrollable', max > 2);
			el.classList.toggle('at-start', pos < 2);
			el.classList.toggle('at-end', pos > max - 2);
		};
		const active = el.querySelector('.nav-link.active');
		if (active && el.scrollWidth > el.clientWidth) {
			const box = el.getBoundingClientRect();
			const tab = active.getBoundingClientRect();
			el.scrollLeft += (tab.left + (tab.width / 2)) - (box.left + (box.width / 2));
		}
		update();
		el.addEventListener('scroll', update, { passive: true });
		$(window).on('resize.binaSorts', update);
		$(window).one('action:ajaxify.start', () => $(window).off('resize.binaSorts'));
	}

	/* -------------------------------------------------------- masonry */

	// Each card goes, in order, into the column that is currently the shortest (ties: the first
	// column, which is the rightmost in RTL). So the newest creations always fill the top row.
	// Card heights are known before the images load, from the width/height attributes the server adds.
	// The layout is rebuilt only when the number of columns changes; "load more" only adds cards.
	const masonry = {
		grid: null,
		cols: [],
		count: 0,
		onResize: null,

		init(grid) {
			this.destroy();
			if (!grid.length) {
				return;
			}
			this.grid = grid;
			this.layout();
			let frame = 0;
			this.onResize = () => {
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					if (this.grid && this.columnCount() !== this.count) {
						this.layout();
					}
				});
			};
			window.addEventListener('resize', this.onResize);
		},

		destroy() {
			if (this.onResize) {
				window.removeEventListener('resize', this.onResize);
			}
			this.grid = null;
			this.cols = [];
			this.count = 0;
			this.onResize = null;
		},

		columnCount() {
			const n = parseInt(getComputedStyle(this.grid[0]).getPropertyValue('--bg-cols'), 10);
			return n > 0 ? n : 1;
		},

		layout() {
			const grid = this.grid;
			const cards = grid.find('.bg-card').toArray()
				.sort((a, b) => (parseInt(a.dataset.index, 10) || 0) - (parseInt(b.dataset.index, 10) || 0));
			this.count = this.columnCount();
			grid.find('.bg-col').remove();
			this.cols = [];
			for (let i = 0; i < this.count; i += 1) {
				this.cols.push($('<div class="bg-col"></div>').appendTo(grid)[0]);
			}
			grid.addClass('bg-grid--masonry');
			this.add(cards);
		},

		add(cards) {
			if (!this.grid) {
				return;
			}
			cards.forEach((card) => {
				let target = this.cols[0];
				let min = Infinity;
				this.cols.forEach((col) => {
					const height = col.getBoundingClientRect().height;
					if (height < min - 0.5) {
						min = height;
						target = col;
					}
				});
				target.appendChild(card);
			});
		},
	};

	/* ------------------------------------------------------ load more */

	async function loadMore() {
		const btn = $(this);
		const next = parseInt(btn.attr('data-next'), 10);
		const root = btn.closest('.bina-gallery');
		// the gallery itself, or another list of creations (the profile tab) that names its own API
		const url = root.attr('data-api') ?
			`${config.relative_path}${root.attr('data-api')}?page=${next}` :
			`${config.relative_path}/api/gallery?sort=${encodeURIComponent(root.attr('data-sort') || 'new')}&page=${next}` +
				(root.attr('data-query') ? `&${root.attr('data-query')}` : '');
		btn.prop('disabled', true);
		try {
			const res = await fetch(url, {
				credentials: 'same-origin',
			});
			const data = await res.json();
			const cards = data.items.map(item => buildCard(item)[0]);
			if (masonry.grid) {
				masonry.add(cards);
			} else {
				root.find('.bg-grid').append(cards);
			}
			if (data.hasMore) {
				btn.attr('data-next', data.nextPage).prop('disabled', false);
			} else {
				btn.closest('.bg-more').remove();
			}
		} catch (err) {
			btn.prop('disabled', false);
			alerts.error('[[error:no-connection]]');
		}
	}

	function decode(html) {
		const t = document.createElement('textarea');
		t.innerHTML = html;
		return t.value;
	}

	function buildCard(item) {
		const a = $('<a class="bg-card bg-open"></a>');
		a.attr({
			href: `${config.relative_path}/gallery/${item.tid}`,
			'data-index': item.index,
			'data-tid': item.tid,
			'data-pid': item.pid,
			'data-image': item.image,
			'data-title': decode(item.title),
			'data-votes': item.votes,
			'data-upvoted': item.upvoted,
			'data-replies': item.replies,
			'data-author': decode(item.user.displayname),
			'data-userslug': item.user.userslug,
			'data-tool': decode(item.tool || ''),
			'data-styles': decode(item.styles || ''),
			'data-has-prompt': String(!!item.hasPrompt),
			'data-usage': item.usage || '',
		});
		const img = $('<img loading="lazy" decoding="async">').attr({ src: item.thumb || item.image, alt: decode(item.title) });
		if (item.w > 0 && item.h > 0) {
			img.attr({ width: item.w, height: item.h });
		}
		img.appendTo(a);
		$('<span class="bg-card__like" role="button" tabindex="0" aria-label="אהבתי"><i class="fa-heart"></i></span>').appendTo(a);
		renderCardLike(a);
		const overlay = $('<div class="bg-card__overlay"></div>').appendTo(a);
		$('<div class="bg-card__title"></div>').html(item.title).appendTo(overlay);
		const meta = $('<div class="bg-card__meta"></div>').appendTo(overlay);
		$('<span class="bg-card__author"></span>')
			.html(`${helpers.buildAvatar(item.user, '20px', true)} `)
			.append(document.createTextNode(decode(item.user.displayname)))
			.appendTo(meta);
		$('<span class="bg-card__stats"></span>').html(
			`<span class="bg-card__votes"><i class="fa-solid fa-heart"></i> <span class="bg-count">${parseInt(item.votes, 10) || 0}</span></span> ` +
			`<span><i class="fa-regular fa-comment"></i> ${parseInt(item.replies, 10) || 0}</span>`
		).appendTo(meta);
		return a;
	}

	function renderCardLike(card) {
		const liked = card[0].dataset.upvoted === 'true';
		card.find('.bg-card__like').toggleClass('is-liked', liked).attr('aria-pressed', String(liked))
			.find('i').toggleClass('fa-solid', liked).toggleClass('fa-regular', !liked);
	}

	/* ------------------------------------------------------- lightbox */

	function openLightbox(cards, index) {
		closeLightbox();
		lightbox = $(`
			<div class="bg-lightbox" role="dialog" aria-modal="true" tabindex="-1">
				<div class="bg-lb__backdrop" aria-hidden="true"></div>
				<i class="fa-solid fa-heart bg-lb__burst" aria-hidden="true"></i>
				<button type="button" class="bg-lb__close" aria-label="סגירה"><i class="fa-solid fa-xmark"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__prev" aria-label="הקודמת"><i class="fa-solid fa-chevron-right"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__next" aria-label="הבאה"><i class="fa-solid fa-chevron-left"></i></button>
				<figure class="bg-lb__figure">
					<img class="bg-lb__img" alt="">
					<figcaption class="bg-lb__caption">
						<div class="bg-lb__title"></div>
						<div class="bg-lb__row">
							<div class="bg-lb__who">
								<a class="bg-lb__author"></a>
								<span class="bg-lb__tool" hidden><i class="fa-solid fa-wand-magic-sparkles"></i> <span></span></span>
								<span class="bg-lb__styles"></span>
							</div>
							<div class="bg-lb__actions">
								<button type="button" class="btn btn-sm btn-outline-light bg-lb__prompt-toggle" aria-expanded="false" hidden><i class="fa-solid fa-terminal"></i> פרומפט</button>
								<button type="button" class="btn btn-sm bg-lb__like"><i class="fa-heart"></i> <span class="bg-lb__count"></span></button>
								<a class="btn btn-sm btn-light bg-lb__topic"><i class="fa-regular fa-comment"></i> <span class="bg-lb__replies"></span> · לעמוד היצירה</a>
							</div>
						</div>
						<div class="bg-lb__usage" hidden><i class="fa-solid"></i> <span></span></div>
						<div class="bg-lb__prompt" hidden>
							<button type="button" class="btn btn-sm btn-outline-light bg-lb__copy"><i class="fa-regular fa-copy"></i> העתקה</button>
							<pre class="bg-lb__prompt-text" dir="auto"></pre>
						</div>
					</figcaption>
				</figure>
			</div>
		`).appendTo('body');
		$('body').addClass('bg-lightbox-open');

		lightbox.on('click', function (e) {
			if (e.target === this || $(e.target).is('.bg-lb__figure')) {
				closeLightbox();
			}
		});
		lightbox.on('click', '.bg-lb__close', closeLightbox);
		lightbox.on('click', '.bg-lb__prev', () => show(cards, current - 1));
		lightbox.on('click', '.bg-lb__next', () => show(cards, current + 1));
		lightbox.on('click', '.bg-lb__like', () => toggleLike(cards.eq(current)));
		lightbox.on('click', '.bg-lb__topic, .bg-lb__author', closeLightbox);
		lightbox.on('click', '.bg-lb__prompt-toggle', function () {
			const open = $(this).attr('aria-expanded') !== 'true';
			$(this).attr('aria-expanded', String(open)).toggleClass('active', open);
			lightbox.find('.bg-lb__prompt').prop('hidden', !open);
			lightbox.toggleClass('bg-lb--prompt', open);
		});
		lightbox.on('click', '.bg-lb__copy', () => copyText(lightbox.find('.bg-lb__prompt-text').text()));
		$(document).on('keydown.binaGallery', (e) => {
			if (e.key === 'Escape') {
				closeLightbox();
			} else if (e.key === 'ArrowLeft') {
				show(cards, current + 1); // RTL: left is "next"
			} else if (e.key === 'ArrowRight') {
				show(cards, current - 1);
			}
		});

		// Double-click (mouse) or double-tap (touch) on the picture likes it (topic 360). It only adds a
		// like, never removes one, so a double tap cannot undo a like by accident.
		let lastTap = 0;
		const likeByGesture = () => {
			const card = cards.eq(current);
			const burst = lightbox.find('.bg-lb__burst').removeClass('is-on');
			void burst[0].offsetWidth; // restart the animation
			burst.addClass('is-on');
			if (card[0].dataset.upvoted !== 'true') {
				toggleLike(card);
			}
		};
		lightbox.on('dblclick', '.bg-lb__img', (e) => {
			e.preventDefault();
			likeByGesture();
		});
		lightbox.on('touchend', '.bg-lb__img', (e) => {
			if (e.originalEvent.changedTouches.length !== 1 || e.originalEvent.touches.length) {
				return;
			}
			const now = Date.now();
			if (now - lastTap < 300) {
				e.preventDefault(); // no zoom / synthetic dblclick
				lastTap = 0;
				likeByGesture();
			} else {
				lastTap = now;
			}
		});

		// Touch: swipe sideways to move between creations, swipe down to close.
		// RTL: the next creation is on the left, so a swipe to the right brings it in.
		let touch = null;
		lightbox.on('touchstart', (e) => {
			const t = e.originalEvent.touches;
			touch = t.length === 1 && !$(e.target).closest('.bg-lb__prompt, .bg-lb__actions').length ?
				{ x: t[0].clientX, y: t[0].clientY } : null;
		});
		lightbox.on('touchend', (e) => {
			const t = e.originalEvent.changedTouches;
			if (!touch || !t.length) {
				return;
			}
			const dx = t[0].clientX - touch.x;
			const dy = t[0].clientY - touch.y;
			touch = null;
			if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				show(cards, current + (dx > 0 ? 1 : -1));
			} else if (dy > 90 && dy > Math.abs(dx) * 1.5) {
				closeLightbox();
			}
		});

		show(cards, index);
		lightbox.trigger('focus');
	}

	function show(cards, index) {
		if (!lightbox || index < 0 || index >= cards.length) {
			return;
		}
		current = index;
		const card = cards.eq(index);
		const d = card[0].dataset;
		lightbox.find('.bg-lb__img').attr({ src: d.image, alt: d.title });
		// blurred copy of the picture behind it, instead of a flat dark background (topic 360)
		lightbox.find('.bg-lb__backdrop').css('background-image', `url(${JSON.stringify(card.find('img').attr('src') || d.image)})`);
		lightbox.find('.bg-lb__title').text(d.title);
		lightbox.find('.bg-lb__author').text(d.author).attr('href', `${config.relative_path}/user/${d.userslug}`);
		lightbox.find('.bg-lb__topic').attr('href', card.attr('href'));
		lightbox.find('.bg-lb__replies').text(d.replies);
		lightbox.find('.bg-lb__prev').toggleClass('invisible', index === 0);
		lightbox.find('.bg-lb__next').toggleClass('invisible', index === cards.length - 1);
		renderLike(card);
		renderDetails(card);
	}

	// Tool and styles come with the card; the prompt (which can be long) is loaded when needed.
	function renderDetails(card) {
		const d = card[0].dataset;
		const usage = USAGE_SHOWN[d.usage];
		const usageEl = lightbox.find('.bg-lb__usage').prop('hidden', !usage).attr('data-usage', d.usage || '');
		if (usage) {
			usageEl.find('i').attr('class', `fa-solid ${usage.icon}`);
			usageEl.find('span').text(usage.text);
		}
		lightbox.find('.bg-lb__tool').prop('hidden', !d.tool).find('span').text(d.tool || '');
		const styles = lightbox.find('.bg-lb__styles').empty();
		(d.styles ? d.styles.split(',') : []).map(st => st.trim()).filter(Boolean)
			.forEach(st => $('<span class="bg-lb__style"></span>').text(st).appendTo(styles));

		const toggle = lightbox.find('.bg-lb__prompt-toggle');
		const panel = lightbox.find('.bg-lb__prompt');
		const text = lightbox.find('.bg-lb__prompt-text').text('');
		const hasPrompt = d.hasPrompt === 'true';
		toggle.prop('hidden', !hasPrompt);
		if (!hasPrompt) {
			panel.prop('hidden', true);
			lightbox.removeClass('bg-lb--prompt');
			toggle.attr('aria-expanded', 'false').removeClass('active');
			return;
		}
		const tid = d.tid;
		loadDetails(tid).then((data) => {
			if (lightbox && current >= 0 && card[0].dataset.tid === tid && data) {
				text.text(data.prompt || '');
			}
		});
	}

	async function loadDetails(tid) {
		if (!details.has(tid)) {
			details.set(tid, api.get(`/plugins/bina-gallery/items/${tid}`, {}).catch(() => {
				details.delete(tid);
				return null;
			}));
		}
		return details.get(tid);
	}

	async function copyText(value) {
		try {
			await navigator.clipboard.writeText(value);
			alerts.success('הפרומפט הועתק.', 2000);
		} catch (err) {
			// older browsers / no permission: select the text so it can be copied by hand
			const range = document.createRange();
			range.selectNodeContents(lightbox.find('.bg-lb__prompt-text')[0]);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}

	function renderLike(card) {
		const d = card[0].dataset;
		const liked = d.upvoted === 'true';
		lightbox.find('.bg-lb__like')
			.toggleClass('btn-danger', liked).toggleClass('btn-outline-light', !liked)
			.attr('aria-pressed', liked)
			.find('i').toggleClass('fa-solid', liked).toggleClass('fa-regular', !liked);
		lightbox.find('.bg-lb__count').text(d.votes);
	}

	async function toggleLike(card) {
		if (!app.user.uid) {
			closeLightbox();
			return ajaxify.go('login');
		}
		const d = card[0].dataset;
		if (d.voting === 'true') {
			return; // a quick second tap would send the same vote twice
		}
		d.voting = 'true';
		const liked = d.upvoted === 'true';
		try {
			if (liked) {
				await api.del(`/posts/${d.pid}/vote`, {});
			} else {
				await api.put(`/posts/${d.pid}/vote`, { delta: 1 });
			}
			const votes = (parseInt(d.votes, 10) || 0) + (liked ? -1 : 1);
			card.attr({ 'data-upvoted': String(!liked), 'data-votes': votes });
			card.find('.bg-count').text(votes);
			renderCardLike(card);
			if (lightbox) {
				renderLike(card);
			}
		} catch (err) {
			alerts.error(err);
		} finally {
			delete d.voting;
		}
	}

	function closeLightbox() {
		if (lightbox) {
			lightbox.remove();
			lightbox = null;
		}
		current = -1;
		$('body').removeClass('bg-lightbox-open');
		$(document).off('keydown.binaGallery');
	}

	return Gallery;
});
