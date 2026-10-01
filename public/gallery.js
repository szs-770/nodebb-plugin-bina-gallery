'use strict';

define('forum/gallery', ['api', 'alerts', 'helpers', 'hooks'], function (api, alerts, helpers, hooks) {
	const Gallery = {};

	const SHARE_TEMPLATE = [
		'העלו כאן את התמונה (גררו אותה לחלון, או לחצו על כפתור ההעלאה)',
		'',
		'**הכלי / המודל:** ',
		'**הפרומפט:** ',
		'',
	].join('\n');

	let lightbox = null;
	let current = -1;

	Gallery.init = function () {
		const root = $('.bina-gallery');

		root.on('click', '.bg-share', function () {
			hooks.fire('action:composer.topic.new', {
				cid: parseInt($(this).attr('data-cid'), 10),
				title: '',
				body: SHARE_TEMPLATE,
			});
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

		masonry.init(root.find('.bg-grid'));

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
		const sort = $('.bina-gallery').attr('data-sort');
		btn.prop('disabled', true);
		try {
			const res = await fetch(`${config.relative_path}/api/gallery?sort=${encodeURIComponent(sort)}&page=${next}`, {
				credentials: 'same-origin',
			});
			const data = await res.json();
			const cards = data.items.map(item => buildCard(item)[0]);
			if (masonry.grid) {
				masonry.add(cards);
			} else {
				$('.bina-gallery .bg-grid').append(cards);
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
			href: `${config.relative_path}/topic/${item.slug}`,
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
		});
		const img = $('<img loading="lazy" decoding="async">').attr({ src: item.thumb || item.image, alt: decode(item.title) });
		if (item.w > 0 && item.h > 0) {
			img.attr({ width: item.w, height: item.h });
		}
		img.appendTo(a);
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

	/* ------------------------------------------------------- lightbox */

	function openLightbox(cards, index) {
		closeLightbox();
		lightbox = $(`
			<div class="bg-lightbox" role="dialog" aria-modal="true" tabindex="-1">
				<button type="button" class="bg-lb__close" aria-label="סגירה"><i class="fa-solid fa-xmark"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__prev" aria-label="הקודמת"><i class="fa-solid fa-chevron-right"></i></button>
				<button type="button" class="bg-lb__nav bg-lb__next" aria-label="הבאה"><i class="fa-solid fa-chevron-left"></i></button>
				<figure class="bg-lb__figure">
					<img class="bg-lb__img" alt="">
					<figcaption class="bg-lb__caption">
						<div class="bg-lb__title"></div>
						<div class="bg-lb__row">
							<a class="bg-lb__author"></a>
							<div class="bg-lb__actions">
								<button type="button" class="btn btn-sm bg-lb__like"><i class="fa-heart"></i> <span class="bg-lb__count"></span></button>
								<a class="btn btn-sm btn-light bg-lb__topic"><i class="fa-regular fa-comment"></i> <span class="bg-lb__replies"></span> · לנושא המלא</a>
							</div>
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
		$(document).on('keydown.binaGallery', (e) => {
			if (e.key === 'Escape') {
				closeLightbox();
			} else if (e.key === 'ArrowLeft') {
				show(cards, current + 1); // RTL: left is "next"
			} else if (e.key === 'ArrowRight') {
				show(cards, current - 1);
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
		lightbox.find('.bg-lb__title').text(d.title);
		lightbox.find('.bg-lb__author').text(d.author).attr('href', `${config.relative_path}/user/${d.userslug}`);
		lightbox.find('.bg-lb__topic').attr('href', card.attr('href'));
		lightbox.find('.bg-lb__replies').text(d.replies);
		lightbox.find('.bg-lb__prev').toggleClass('invisible', index === 0);
		lightbox.find('.bg-lb__next').toggleClass('invisible', index === cards.length - 1);
		renderLike(card);
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
			if (lightbox) {
				renderLike(card);
			}
		} catch (err) {
			alerts.error(err);
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
